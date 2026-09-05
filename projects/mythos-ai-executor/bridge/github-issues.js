'use strict';
// =====================================================
// MYTHOS GitHub Issues → TASK adapter
// projects/mythos-ai-executor/bridge/github-issues.js
//
// The thin layer that makes GitHub Issues the official task intake of MYTHOS
// WITHOUT changing the control protocol, the bridge, the executor or OTHMODE:
//
//   GitHub Issue (open, label `task`)
//        │  intake (this file): parse → validate (bridge rules) →
//        │  control/tasks/gh-issue-<n>.json  (status PENDING, source.kind=github-issue)
//        │  one commit on mythos/control, one "created" comment on the Issue
//        ▼
//   github-bridge.tick()   ← unchanged: claim, OTHMODE record, worktree, executor
//        │
//   mythos-ai-executor daemon runs the task (claude -p, othmode contract)
//        │
//   github-bridge.tick()   ← unchanged: control/reports/<id>.json when terminal
//        │
//        │  notify (this file): "claimed" comment (executor_task_id), then the
//        │  report comment (status, summary, files, tests, commits, problems,
//        ▼  risks, next action), status labels, optional close on COMPLETED
//   GitHub Issue updated
//
// Source of truth: the control branch (task + report files). The Issue is
// the human interface only. Every fact posted to an Issue is read back from
// those files; nothing is ever derived from a comment. The relation
// Issue ⇄ task_id ⇄ executor_task_id ⇄ report lives in the task file
// (`source` block + bridge-owned `execution` block) and in state.json.
//
// Idempotency (restart, polling, retries, concurrent runs), in layers:
//   1. deterministic task_id `gh-issue-<n>` (+ `-r<k>` for an explicit rerun);
//      after syncing the control branch, an existing file means "done";
//   2. the bridge process lock (one adapter/bridge process per store);
//   3. every Issue comment carries a hidden marker
//      `<!-- mythos-control task_id=… event=… -->`; before posting, the
//      adapter lists the Issue's comments and records an existing marker
//      instead of posting again (covers a crash between "posted" and
//      "recorded on the control branch");
//   4. rejections (invalid / secret-bearing Issues) are keyed by the sha256
//      of title+body, so an unchanged invalid Issue is answered once;
//   5. the `rerun` label IS the rerun request, so it is consumed only after the
//      control commit that carries the new attempt succeeds. A tick that dies
//      before that commit leaves the label in place and the request survives.
//      A rerun asked for while the previous attempt is still ACTIVE keeps the
//      label too and is honoured on the first tick after that attempt ends.
//
// What this file deliberately does NOT do: run anything, push, merge, touch
// main, honour provider/path/tool/credential selection from an Issue
// (requested_action is the only privilege lever, exactly as in the task
// protocol), or execute an Issue that lacks the `task` label or is closed.
// `Model:` (Issue #100) is the one other value an Issue may set: it selects
// a key in the server-side catalog (config/model-policy.json) and is
// rejected at intake if unknown — it never travels on as a raw string, and
// it changes nothing about what the run is allowed to do. A KNOWN but
// disabled model is kept as written (task.model = its key) and the bridge
// stops the attempt as MODEL_UNAVAILABLE before any provider starts: an
// explicit choice is never quietly replaced by another model.
//
// Action / Model resolution (gh-issue-111/114/117/118 root cause): every
// scalar field is read by bridge/action-resolution.js extractFields(), which
// understands `Key: value`, bulleted/numbered/bold variants, `## Key: value`
// headings, `## Key` followed by the value after any number of blank lines,
// and `| Key | value |` table rows. The decision (requested_action,
// action_raw, action_source; model, model_raw, model_source) is recorded on
// the task so it can be audited without re-parsing the Issue.
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var http = require('http');
var https = require('https');
var url = require('url');

var EXEC_ROOT = path.join(__dirname, '..');
var bridge = require('./github-bridge');
var state = require(path.join(EXEC_ROOT, 'lib', 'state'));
var redact = require(path.join(EXEC_ROOT, '..', 'mythos-orchestrator', 'lib', 'redact'));
var modelPolicy = require(path.join(EXEC_ROOT, 'lib', 'model-policy'));
// ONE engine decides requested_action / execution_profile / model for every
// surface (Issue, task file, executor). This adapter never re-implements it.
var engine = require('./action-resolution');
// Unified Telegram event notifier (gh-issue-187): best-effort, disabled
// unless MYTHOS_TELEGRAM_ENABLED=1 with a token and an allowlist, exactly
// like the Telegram channel itself. A failure here must never affect the
// Issue/task lifecycle, so every call is wrapped by notifyTelegram() below.
var telegramEvents = require('./notify/telegram-events');

var BY = 'github-issues';
var MARKER_PREFIX = '<!-- mythos-control ';
var ISSUE_TASK_RE = /^gh-issue-(\d+)(?:-r(\d+))?$/;
var ACTIVE = ['PENDING', 'CLAIMED', 'IN_PROGRESS', 'VALIDATING'];
var TERMINAL = ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'];

// Issue-facing states. HUMAN_APPROVAL is a presentation state derived from a
// BLOCKED report whose text says a human decision / approval is needed; the
// control protocol itself has no such status.
var ISSUE_STATES = ['PENDING', 'CLAIMED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'BLOCKED', 'HUMAN_APPROVAL', 'CANCELLED', 'INVALID'];
// Only a BLOCKED report in which the agent (or the relay) stopped for a decision
// counts: "owner decision required: …" (executor, agent report status blocked),
// governance / protected-path / approval / DENIED wording. Infrastructure
// blockers (credit balance, missing executor record, no structured report)
// stay BLOCKED.
var APPROVAL_RE = /approv|governance|protected path|owner decision|DENIED/i;

var STATUS_LABEL = {
  PENDING: 'queued', CLAIMED: 'in-progress', IN_PROGRESS: 'in-progress', VALIDATING: 'in-progress',
  COMPLETED: 'completed', FAILED: 'failed', BLOCKED: 'blocked', HUMAN_APPROVAL: 'human-approval',
  CANCELLED: 'cancelled', INVALID: 'invalid'
};

// Issue-facing terminal state → unified Telegram event name (gh-issue-187).
var REPORT_EVENT_BY_STATE = {
  COMPLETED: 'completed', FAILED: 'failed', BLOCKED: 'blocked', HUMAN_APPROVAL: 'human_approval', CANCELLED: 'cancelled'
};

// --- Configuration -------------------------------------------------------------

function deriveRepo(repoDir) {
  try {
    var out = require('child_process').execFileSync('git', ['-C', repoDir, 'remote', 'get-url', 'origin'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    var m = /github\.com[:\/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(out);
    return m ? m[1] + '/' + m[2] : null;
  } catch (e) { return null; }
}

function config() {
  var b = bridge.config();
  var only = process.env.MYTHOS_ISSUES_ONLY ? String(process.env.MYTHOS_ISSUES_ONLY).split(',').map(function (s) { return parseInt(s, 10); }).filter(function (n) { return n > 0; }) : [];
  return {
    bridge: b,
    enabled: process.env.MYTHOS_ISSUES_ENABLED === '1',
    repo: process.env.MYTHOS_ISSUES_REPO || deriveRepo(b.repo) || 'othoth77/mythos-prod',
    apiUrl: (process.env.MYTHOS_GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
    webUrl: (process.env.MYTHOS_GITHUB_WEB_URL || 'https://github.com').replace(/\/+$/, ''),
    label: process.env.MYTHOS_ISSUES_LABEL || 'task',
    rerunLabel: process.env.MYTHOS_ISSUES_RERUN_LABEL || 'rerun',
    labelPrefix: process.env.MYTHOS_ISSUES_LABEL_PREFIX || 'mythos:',
    closeOnCompleted: process.env.MYTHOS_ISSUES_CLOSE_ON_COMPLETED === '1',
    defaultAction: process.env.MYTHOS_ISSUES_DEFAULT_ACTION || 'investigate',
    maxIssuesPerTick: parseInt(process.env.MYTHOS_ISSUES_MAX_PER_TICK || '20', 10),
    only: only,
    timeoutMs: parseInt(process.env.MYTHOS_ISSUES_HTTP_TIMEOUT_MS || '20000', 10),
    userAgent: 'mythos-github-issues/1 (+' + BY + ')'
  };
}

// The token is read from the environment (the systemd drop-in binds the
// deploy-owned 0600 file by reference, exactly like the executor's
// github-mcp-rw.conf) or from a KEY=VALUE file named by
// MYTHOS_GITHUB_ISSUES_TOKEN_FILE. It is held in a closure, never logged,
// never written, never passed to a child process.
function readToken() {
  var direct = process.env.MYTHOS_GITHUB_ISSUES_TOKEN || process.env.MYTHOS_GITHUB_MCP_RW_TOKEN;
  if (direct) return String(direct).trim();
  var file = process.env.MYTHOS_GITHUB_ISSUES_TOKEN_FILE;
  if (!file || !fs.existsSync(file)) return null;
  var want = process.env.MYTHOS_GITHUB_ISSUES_TOKEN_VAR || 'MYTHOS_GITHUB_MCP_RW_TOKEN';
  var lines = fs.readFileSync(file, 'utf8').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(lines[i]);
    if (m && (m[1] === want || m[1] === 'MYTHOS_GITHUB_ISSUES_TOKEN')) return m[2].replace(/^["']|["']$/g, '');
  }
  return null;
}

// --- Helpers -------------------------------------------------------------------

function nowIso() { return new Date().toISOString(); }
function sha256(text) { return crypto.createHash('sha256').update(String(text)).digest('hex'); }
function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function log(event, fields) {
  bridge.log('issues:' + event, fields);
}

// Best-effort: a Telegram outage or misconfiguration is never allowed to
// affect Issue/task processing. Resolves even on failure.
function notifyTelegram(evt) {
  return telegramEvents.notifyEvent(evt).then(function (r) { return r; }, function (e) {
    log('telegram_notify_error', { event: evt && evt.event, error: short(String(e && e.message || e), 200) });
    return { sent: false, reason: 'error' };
  });
}

function issueTaskId(n, attempt) { return 'gh-issue-' + n + (attempt > 1 ? '-r' + attempt : ''); }

function parseIssueTaskId(id) {
  var m = ISSUE_TASK_RE.exec(String(id || ''));
  return m ? { issue_number: parseInt(m[1], 10), attempt: m[2] ? parseInt(m[2], 10) : 1 } : null;
}

// Every task file on the control branch that came from an Issue, by number.
function loadIssueTasks(cfg) {
  var byIssue = {};
  var all = {};
  bridge.listTaskFiles(cfg.bridge).forEach(function (f) {
    var e = bridge.loadTask(cfg.bridge, f);
    var t = e.task;
    if (!t || !bridge.isValidTaskId(t.task_id) || f !== t.task_id + '.json') return;
    all[t.task_id] = t;
    var src = t.source && typeof t.source === 'object' ? t.source : null;
    var n = src && src.kind === 'github-issue' ? parseInt(src.issue_number, 10) : null;
    if (!n) { var p = parseIssueTaskId(t.task_id); n = p ? p.issue_number : null; }
    if (!n) return;
    byIssue[n] = byIssue[n] || [];
    byIssue[n].push(t);
  });
  Object.keys(byIssue).forEach(function (n) {
    byIssue[n].sort(function (a, b) {
      var pa = parseIssueTaskId(a.task_id), pb = parseIssueTaskId(b.task_id);
      return ((pa && pa.attempt) || 1) - ((pb && pb.attempt) || 1);
    });
  });
  return { byIssue: byIssue, all: all };
}

function reportFor(cfg, taskId) {
  var p = bridge.paths(cfg.bridge);
  return bridge.readJsonFile(path.join(p.reports, taskId + '.json'));
}

// --- GitHub API client (no dependency, token in closure) ---------------------------------

function createClient(cfg, token, opts) {
  opts = opts || {};
  var base = url.parse(cfg.apiUrl);
  var mod = base.protocol === 'http:' ? http : https;
  var calls = [];
  var rate = { remaining: null, limit: null };

  function request(method, apiPath, body) {
    return new Promise(function (resolve, reject) {
      var payload = body === undefined ? null : JSON.stringify(body);
      var headers = {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': cfg.userAgent
      };
      if (token) headers.Authorization = 'Bearer ' + token;
      if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
      var req = mod.request({
        protocol: base.protocol, hostname: base.hostname, port: base.port,
        path: (base.pathname === '/' ? '' : base.pathname.replace(/\/+$/, '')) + apiPath,
        method: method, headers: headers, timeout: cfg.timeoutMs
      }, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          var text = Buffer.concat(chunks).toString('utf8');
          var parsed = null;
          try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = null; }
          if (res.headers['x-ratelimit-remaining'] !== undefined) {
            rate.remaining = parseInt(res.headers['x-ratelimit-remaining'], 10);
            rate.limit = parseInt(res.headers['x-ratelimit-limit'], 10);
          }
          calls.push({ method: method, path: apiPath, status: res.statusCode });
          resolve({ status: res.statusCode, body: parsed, text: text, headers: res.headers });
        });
      });
      req.on('timeout', function () { req.destroy(new Error('GITHUB_TIMEOUT: ' + method + ' ' + apiPath)); });
      req.on('error', function (e) { reject(new Error('GITHUB_HTTP: ' + method + ' ' + apiPath + ': ' + redact.redact(String(e.message)).slice(0, 200))); });
      if (payload) req.write(payload);
      req.end();
    });
  }

  function must(r, what) {
    if (r.status >= 200 && r.status < 300) return r.body;
    // Error bodies are GitHub's own text; redacted anyway before it can reach a log.
    throw new Error('GITHUB_API ' + r.status + ' on ' + what + ': ' + redact.redact(short(r.text, 300)));
  }

  var repo = '/repos/' + cfg.repo;

  async function pages(apiPath, cap) {
    var out = [];
    for (var page = 1; page <= (cap || 5); page++) {
      var sep = apiPath.indexOf('?') === -1 ? '?' : '&';
      var r = await request('GET', apiPath + sep + 'per_page=100&page=' + page);
      var items = must(r, apiPath);
      if (!Array.isArray(items)) break;
      out = out.concat(items);
      if (items.length < 100) break;
    }
    return out;
  }

  return {
    calls: calls,
    rate: rate,
    authenticated: !!token,
    listTaskIssues: function () {
      return pages(repo + '/issues?state=open&labels=' + encodeURIComponent(cfg.label) + '&sort=created&direction=asc');
    },
    getIssue: async function (n) { return must(await request('GET', repo + '/issues/' + n), 'issue #' + n); },
    listComments: function (n) { return pages(repo + '/issues/' + n + '/comments'); },
    createComment: async function (n, body) {
      if (opts.dryRun) return { id: null, dry_run: true };
      return must(await request('POST', repo + '/issues/' + n + '/comments', { body: body }), 'comment on #' + n);
    },
    addLabels: async function (n, labels) {
      if (opts.dryRun || !labels.length) return [];
      return must(await request('POST', repo + '/issues/' + n + '/labels', { labels: labels }), 'labels on #' + n);
    },
    removeLabel: async function (n, name) {
      if (opts.dryRun) return true;
      var r = await request('DELETE', repo + '/issues/' + n + '/labels/' + encodeURIComponent(name));
      if (r.status === 404) return false;
      must(r, 'remove label on #' + n);
      return true;
    },
    closeIssue: async function (n) {
      if (opts.dryRun) return { state: 'closed', dry_run: true };
      return must(await request('PATCH', repo + '/issues/' + n, { state: 'closed', state_reason: 'completed' }), 'close #' + n);
    },
    // Pull-request read endpoints, added for the PR lifecycle watcher
    // (gh-issue-187, bridge/pr-watch.js). Read-only: this adapter still
    // never merges, comments on, or otherwise mutates a pull request.
    listPulls: function (cap) {
      return pages(repo + '/pulls?state=all&sort=updated&direction=desc', cap || 1);
    },
    getPull: async function (n) { return must(await request('GET', repo + '/pulls/' + n), 'pull #' + n); },
    listReviews: function (n) { return pages(repo + '/pulls/' + n + '/reviews', 2); },
    getCombinedStatus: async function (ref) { return must(await request('GET', repo + '/commits/' + ref + '/status'), 'status ' + ref); }
  };
}

// --- Issue body → task ----------------------------------------------------------

var SECTION_ALIASES = {
  objective: ['objective', 'goal', 'the goal', 'الهدف', 'هدف', 'المهمة'],
  scope: ['scope', 'requirements', 'required', 'المطلوب', 'النطاق', 'نطاق', 'in scope'],
  constraints: ['constraints', 'constraint', 'القيود', 'قيود', 'limits', 'rules'],
  validation: ['validation', 'verification', 'acceptance', 'acceptance criteria', 'tests', 'التحقق', 'التحقق النهائي', 'الاختبارات', 'معايير القبول'],
  notes: ['notes', 'context', 'background', 'ملاحظات', 'السياق', 'خلفية'],
  action: ['action', 'requested action', 'requested_action', 'الإجراء', 'نوع المهمة'],
  priority: ['priority', 'الأولوية'],
  depends_on: ['depends on', 'depends_on', 'depends-on', 'dependencies', 'يعتمد على', 'الاعتماديات'],
  timeout: ['timeout', 'timeout seconds', 'timeout_seconds', 'المهلة'],
  max_turns: ['max turns', 'max_turns', 'max-turns'],
  model: ['model', 'claude model', 'النموذج', 'نموذج']
};
var SCALAR_KEYS = ['action', 'priority', 'depends_on', 'timeout', 'max_turns', 'model'];

// Size limits applied to Issue-derived text. They exist so a task file stays
// a reviewable record and the executor prompt stays within its schema — NOT
// to shorten a mission silently: every cut is recorded in `source.truncated`
// (field, original length, kept length) and announced in the created
// comment, so lost text is always visible. Long objectives/notes/scope of
// executive Issues (#117: 17 scope items, #118: 4 KB body) fit untouched.
var LIMITS = { objective: 20000, notes: 16000, item: 2000, other: 6000, title: 300 };

function normKey(s) {
  return String(s || '').trim().replace(/^[#*_\s]+|[*_:\s]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
}

function sectionFor(name) {
  var k = normKey(name);
  var keys = Object.keys(SECTION_ALIASES);
  for (var i = 0; i < keys.length; i++) {
    if (SECTION_ALIASES[keys[i]].indexOf(k) !== -1) return keys[i];
  }
  return null;
}

// A field written as a list item (`- Action: implement`, `* Model: opus`) is
// as common as a bare `Key: value` line and MUST resolve the same way — a
// bulleted `Action:` that silently fails to parse is indistinguishable from
// no Action at all, which is exactly how an executive Issue fell back to the
// safe (read-only) default with no error to explain why (gh-issue-112).
var BULLET_PREFIX_RE = /^\s{0,3}(?:[-*+•]|\d+[.)])\s+/;

// Splits a body into named sections. Headings (`## Objective`, `Objective:`,
// `**Objective**`) open a section; scalar keys also accept `Key: value` on
// one line anywhere in the body, including as a single bulleted item. Text
// before the first heading is the preamble (used as the objective when no
// objective section exists).
function splitSections(body) {
  var sections = { _preamble: [] };
  var current = '_preamble';
  String(body || '').replace(/\r\n/g, '\n').split('\n').forEach(function (line) {
    var stripped = line.replace(BULLET_PREFIX_RE, '');
    var h = /^\s{0,3}#{1,6}\s*(.+?)\s*#*\s*$/.exec(line);
    var tr = !h && /^\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/.exec(line);
    var b = !h && !tr && /^\s{0,3}\*\*([^*]+)\*\*\s*:?\s*(.*)$/.exec(stripped);
    var c = !h && !tr && !b && /^\s{0,3}([^\s:|][^:|]{0,40}?)\s*[:：]\s*(.*)$/.exec(stripped);
    var name = null, rest = '';
    if (h) {
      name = h[1];
      // `## Action: implement` / `## Objective: ship it` — a heading that
      // carries its value inline. Before this the whole text was looked up
      // as one unknown heading and fell into `_other:` (gh-issue-117/118).
      var hc = /^([^:：]{1,40}?)\s*[:：]\s*(.*)$/.exec(name);
      if (hc && sectionFor(hc[1])) { name = hc[1]; rest = hc[2]; }
    }
    else if (tr) { if (sectionFor(tr[1])) { name = tr[1]; rest = tr[2]; } }
    else if (b) { name = b[1]; rest = b[2]; }
    else if (c) { name = c[1]; rest = c[2]; }
    var sec = name ? sectionFor(name) : null;
    if (!sec && h) {
      // An unknown markdown heading closes the current section: its text is
      // kept under `_other` (appended to notes) and never leaks into a list.
      current = '_other:' + normKey(name);
      sections[current] = sections[current] || [];
      return;
    }
    if (sec && (h || tr || b || SCALAR_KEYS.indexOf(sec) !== -1 || !rest || c)) {
      if (SCALAR_KEYS.indexOf(sec) !== -1 && rest) {
        sections[sec] = (sections[sec] || []).concat([rest]);
        return;
      }
      if (tr && rest) { sections[sec] = (sections[sec] || []).concat([rest]); return; }
      current = sec;
      sections[current] = sections[current] || [];
      if (rest) sections[current].push(rest);
      return;
    }
    sections[current].push(line);
  });
  return sections;
}

function listItems(lines) {
  var items = [];
  var bulletRe = /^\s*(?:[-*+•]|\d+[.)])\s+(.*)$/;
  var hasBullets = (lines || []).some(function (l) { return bulletRe.test(l); });
  (lines || []).forEach(function (l) {
    var m = bulletRe.exec(l);
    if (m) items.push(m[1].trim());
    else if (!hasBullets && l.trim()) items.push(l.trim());
    else if (hasBullets && l.trim() && items.length && /^\s{2,}/.test(l)) items[items.length - 1] += ' ' + l.trim();
  });
  return items.filter(Boolean).map(function (s) { return short(s, LIMITS.item); });
}

function textOf(lines, max) {
  return short((lines || []).join('\n').replace(/\n{3,}/g, '\n\n').trim(), max);
}

function labelNames(issue) {
  return (issue.labels || []).map(function (l) { return typeof l === 'string' ? l : l.name; }).filter(Boolean);
}

// requested_action, model and the other scalars come from the engine's
// field extraction over the RAW body (every accepted form), never from
// `sections.<key>[0]` — that access returned "" for `## Action` followed by
// a blank line and never saw `## Action: implement` at all. Precedence and
// the recorded decision (action_raw / action_source) live in
// bridge/action-resolution.js; see that file for the rules.
function pickAction(cfg, issue, fields, previous) {
  return engine.resolveAction({ fields: fields, labels: labelNames(issue), previous: previous, defaultAction: cfg.defaultAction });
}

function scalar(fields, key) {
  var f = engine.firstField(fields, key);
  return f ? f.raw : null;
}

function pickPriority(issue, fields) {
  var fromLabel = engine.labelValue(labelNames(issue), 'priority');
  var fromBody = scalar(fields, 'priority');
  var p = normKey(fromLabel || fromBody || 'normal');
  return ['low', 'normal', 'high'].indexOf(p) === -1 ? 'normal' : p;
}

function pickDepends(fields) {
  var out = [];
  (fields.depends_on || []).map(function (f) { return f.raw; }).join(',').split(/[,\s]+/).forEach(function (tok) {
    tok = tok.trim().replace(/^[-*]\s*/, '');
    if (!tok) return;
    var m = /^#?(\d+)$/.exec(tok);
    if (m) out.push(issueTaskId(parseInt(m[1], 10), 1));
    else if (bridge.isValidTaskId(tok)) out.push(tok);
  });
  return out.filter(function (x, i) { return out.indexOf(x) === i; });
}

// Issue #100 — `Model: Sonnet` (or a `model:<x>` label) is OPTIONAL and, on a
// rerun that names none, inherited from the previous attempt like every other
// decision. A name the catalog does not know is an intake error listing the
// accepted ones (a typo must not run on a guessed model). A name the catalog
// knows but has disabled is KEPT (task.model = its key, model_source recorded)
// and the bridge stops the attempt as MODEL_UNAVAILABLE at claim time — never
// a silent substitution, never a raw string travelling on to the CLI.
function pickModel(issue, fields, previous, errors) {
  var r = engine.resolveModel({ fields: fields, labels: labelNames(issue), previous: previous, policy: modelPolicy });
  if (r.error) errors.push(r.error);
  return r;
}

function pickInt(fields, key, min, max) {
  var raw = scalar(fields, key);
  if (!raw) return null;
  var n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
  if (!(n >= min && n <= max)) return null;
  return n;
}

// Pure: Issue payload → { task, errors }. Never throws on user content.
// `previous` is the preceding attempt's task object on a rerun (attempt > 1);
// it is the ONLY source of inheritance and is ignored on a first attempt.
function issueToTask(cfg, issue, attempt, previous) {
  attempt = attempt || 1;
  previous = (attempt > 1 && previous && typeof previous === 'object') ? previous : null;
  var n = issue.number;
  var title = String(issue.title || '').replace(/^\s*TASK\s*[:：-]\s*/i, '').trim();
  var body = String(issue.body || '');
  var errors = [];
  var truncated = [];
  function cut(field, text, max) {
    var t = String(text == null ? '' : text);
    if (t.length <= max) return t;
    truncated.push({ field: field, original_length: t.length, kept_length: max });
    return t.slice(0, max - 1) + '…';
  }
  // Secret gate. The shared classifier reports the KIND, the assignment KEY
  // and the LINE of every hit — never the value — so a false positive
  // (an example such as `TOKEN: configured`) is locatable and fixable by
  // rewriting the value as an explicit placeholder (`TOKEN=<EXAMPLE_TOKEN>`),
  // while a real credential is still refused. Title and body are scanned as
  // one text; the title is line 1.
  var secretHits = redact.findSecretMatches(title + '\n' + body);
  if (secretHits.length) {
    var secretKinds = [];
    var where = secretHits.slice(0, 8).map(function (h) {
      if (secretKinds.indexOf(h.kind) === -1) secretKinds.push(h.kind);
      return h.kind + (h.key ? ' `' + short(h.key, 40) + '`' : '') + (h.line === 1 ? ' in the title' : ' at body line ' + (h.line - 1));
    });
    return {
      task: null,
      secret: true,
      errors: [
        'Issue carries a secret-shaped string (' + secretKinds.join(', ') + '): ' + where.join('; ') + (secretHits.length > 8 ? '; … ' + (secretHits.length - 8) + ' more' : '') + '. Credentials never travel in tasks: rotate it and open a new Issue.',
        'Examples and status lines must state a non-secret value as an explicit placeholder, e.g. `TOKEN=<EXAMPLE_TOKEN>`, `API_KEY=<EXAMPLE_VALUE>`, `PASSWORD=${DB_PASSWORD}`, `Secrets: <none>`. Plain words after `KEY:` / `KEY=` are treated as credential material by design (docs/MYTHOS_GITHUB_ISSUES.md §Secrets and placeholders).'
      ]
    };
  }
  var sections = splitSections(body);
  var fields = engine.extractFields(body);
  var objective = cut('objective', (sections.objective || []).join('\n').replace(/\n{3,}/g, '\n\n').trim() || (sections._preamble || []).join('\n').replace(/\n{3,}/g, '\n\n').trim() || title, LIMITS.objective);
  if (objective.length < 10) errors.push('objective is too short (add an "Objective" section or a descriptive title)');
  var act = pickAction(cfg, issue, fields, previous);
  if (act.error) errors.push(act.error);
  var taskId = issueTaskId(n, attempt);
  var attemptId = taskId + '#' + attempt;

  // A rerun re-parses the CURRENT body. When an edited body drops a structured
  // section — or heads it with a wording the aliases do not know, so it lands in
  // `_other:` and becomes prose — the section would come back empty and the
  // attempt would run with less definition than the one it repeats. Any section
  // the new body leaves empty is therefore inherited from the previous attempt.
  // The objective is deliberately NOT inherited: it is what a rerun edits.
  var inherited = { requested_action: act.action_source === 'inherited_previous_attempt', model: false, scope: false, constraints: false, validation_requirements: false };
  var scope = listItems(sections.scope);
  var constraints = listItems(sections.constraints);
  var validation = listItems(sections.validation);
  if (previous) {
    if (!scope.length && Array.isArray(previous.scope) && previous.scope.length) { scope = previous.scope.slice(); inherited.scope = true; }
    if (!constraints.length && Array.isArray(previous.constraints) && previous.constraints.length) { constraints = previous.constraints.slice(); inherited.constraints = true; }
    if (!validation.length && Array.isArray(previous.validation_requirements) && previous.validation_requirements.length) { validation = previous.validation_requirements.slice(); inherited.validation_requirements = true; }
  }
  var model = pickModel(issue, fields, previous, errors);
  inherited.model = model.model_source === 'inherited_previous_attempt';
  var profile = act.requested_action ? engine.profileFor(act.requested_action) : null;

  var notesParts = ['Source: GitHub Issue #' + n + ' ' + issue.html_url + (title ? ' — "' + short(title, 200) + '"' : '')];
  notesParts.push('requested_action: ' + (act.requested_action || '(invalid)') + ' — source ' + act.action_source + ' (written as "' + short(act.action_raw, 40) + '")' +
    (act.action_source === 'inherited_previous_attempt' ? ': inherited from ' + previous.task_id + ' ("' + act.requested_action + '") because this rerun body states no Action. State `Action: <x>` (or a label `action:<x>`) to change it.' : '') +
    (act.action_source === 'default' ? ': defaulted to "' + act.requested_action + '" because the Issue did not state one (add `Action: implement|document|test|review|investigate` or a label `action:<x>`).' : '') +
    (act.conflict ? ' — other candidates ignored: ' + act.conflict : '') +
    (act.candidates || []).filter(function (c) { return c.eligible === false; }).map(function (c) { return ' — not inherited: ' + short(c.ignored_reason, 160); }).join('') +
    (profile ? ' → execution profile ' + profile : ''));
  if (model.model_key) {
    notesParts.push('model: ' + model.model_key + ' — source ' + model.model_source + ' (written as "' + short(model.model_raw, 40) + '")' +
      (model.available ? '' : '. NOT AVAILABLE on this host: the attempt will stop as MODEL_UNAVAILABLE before any provider starts; it is never substituted.'));
  }
  var inheritedSections = Object.keys(inherited).filter(function (k) { return k !== 'requested_action' && k !== 'model' && inherited[k]; });
  if (inheritedSections.length) {
    notesParts.push('Inherited from ' + previous.task_id + ' because this body left them empty: ' + inheritedSections.join(', ') + '. Restate a section under a recognised heading to replace it.');
  }
  var notes = (sections.notes || []).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (notes) notesParts.push(notes);
  Object.keys(sections).filter(function (k) { return k.indexOf('_other:') === 0; }).forEach(function (k) {
    var txt = (sections[k] || []).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (txt) notesParts.push('[' + k.slice(7) + ']\n' + cut('notes[' + k.slice(7) + ']', txt, LIMITS.other));
  });
  var task = {
    protocol: bridge.PROTOCOL,
    task_id: taskId,
    project: cfg.bridge.project,
    objective: objective,
    scope: scope,
    constraints: constraints,
    priority: pickPriority(issue, fields),
    requested_action: act.requested_action || String(act.action_raw || '').slice(0, 30),
    action_raw: short(act.action_raw == null ? '' : act.action_raw, 100),
    action_source: act.action_source,
    validation_requirements: validation,
    status: 'PENDING',
    created_at: nowIso(),
    created_by: short('github-issue:' + ((issue.user && issue.user.login) || 'unknown'), 64)
  };
  var deps = pickDepends(fields);
  if (deps.length) task.depends_on = deps.filter(function (d) { return d !== taskId; });
  var timeout = pickInt(fields, 'timeout', 60, 21600);
  if (timeout) task.timeout_seconds = timeout;
  var turns = pickInt(fields, 'max_turns', 1, 500);
  if (turns) task.max_turns = turns;
  if (model.model_key) {
    task.model = model.model_key;
    task.model_raw = short(model.model_raw, 100);
    task.model_source = model.model_source;
  }
  task.notes = cut('notes', notesParts.join('\n\n'), LIMITS.notes);
  if (truncated.length) {
    var note = 'TRUNCATED (limits: objective ' + LIMITS.objective + ', notes ' + LIMITS.notes + ', list item ' + LIMITS.item + ' chars): ' +
      truncated.map(function (t) { return t.field + ' ' + t.original_length + '→' + t.kept_length; }).join(', ') + '. The full text is on the Issue.';
    task.notes = task.notes.length + note.length + 2 <= LIMITS.notes ? task.notes + '\n\n' + note : task.notes.slice(0, LIMITS.notes - note.length - 3) + '…\n\n' + note;
  }
  var contentHash = sha256(String(issue.title || '') + '\n' + body);
  task.source = {
    kind: 'github-issue',
    repo: cfg.repo,
    issue_number: n,
    issue_url: issue.html_url,
    issue_id: issue.id || null,
    issue_node_id: issue.node_id || null,
    issue_title: short(issue.title || '', LIMITS.title),
    issue_author: (issue.user && issue.user.login) || null,
    issue_created_at: issue.created_at || null,
    issue_updated_at: issue.updated_at || null,
    issue_labels: labelNames(issue).slice(0, 20),
    content_sha256: contentHash,
    attempt: attempt,
    attempt_id: attemptId,
    // One key per (repo, issue, attempt, content): a duplicate delivery of the
    // same Issue state — a second webhook, a repeated listing page, a tick that
    // died after posting — resolves to the same task, never a second one.
    idempotency_key: engine.idempotencyKey([cfg.repo, '#', n, '@', attempt, ':', contentHash]),
    rerun_of: previous ? previous.task_id : (attempt > 1 ? issueTaskId(n, attempt - 1) : null),
    inherited_from: previous ? previous.task_id : null,
    inherited: inherited,
    // The audited decision, as the engine made it (candidates in precedence order).
    resolution: {
      requested_action: act.requested_action,
      action_raw: act.action_raw,
      action_source: act.action_source,
      action_conflict: act.conflict,
      action_candidates: act.candidates.map(function (c) {
        var row = { source: c.source, raw: short(c.raw, 60), action: c.action, form: c.form || null, line: c.line || null };
        if (c.eligible === false) { row.eligible = false; row.ignored_reason = short(c.ignored_reason, 200); }
        return row;
      }),
      execution_profile: profile,
      expected_delivery: act.requested_action ? engine.deliveryFor(act.requested_action) : null,
      model_key: model.model_key,
      model_id: model.model_id,
      model_raw: model.model_raw,
      model_source: model.model_source,
      model_available: model.available,
      model_reason: model.reason,
      available_models: model.available_models,
      resolved_at: nowIso(),
      resolved_by: 'bridge/action-resolution.js'
    },
    truncated: truncated,
    events: [
      { at: nowIso(), event: 'issue_received', reason: 'open Issue #' + n + ' with label ' + cfg.label + (attempt > 1 ? ' and label ' + cfg.rerunLabel + ' (attempt ' + attempt + ')' : ''), content_sha256: contentHash },
      { at: nowIso(), event: 'action_resolved', reason: act.action_source + ' → ' + (act.requested_action || 'invalid') + ' (raw "' + short(act.action_raw, 40) + '")' },
      { at: nowIso(), event: 'profile_resolved', reason: (act.requested_action || '?') + ' → ' + (profile || 'none') + ' (server-side map)' },
      { at: nowIso(), event: 'model_resolved', reason: model.model_key ? model.model_source + ' → ' + model.model_key + (model.available ? ' (available)' : ' (NOT available)') : 'none named — executor scores the task' }
    ],
    converted_at: nowIso(),
    converted_by: BY,
    notifications: {}
  };
  errors = errors.concat(bridge.validateTask(cfg.bridge, task, taskId + '.json'));
  return { task: errors.length ? null : task, errors: errors, candidate: task, secret: false, resolution: task.source.resolution };
}

// --- Issue comments ---------------------------------------------------------------

function marker(fields) {
  return MARKER_PREFIX + Object.keys(fields).map(function (k) { return k + '=' + fields[k]; }).join(' ') + ' -->';
}

function parseMarker(body) {
  var m = /<!--\s*mythos-control\s+([^>]*?)\s*-->/.exec(String(body || ''));
  if (!m) return null;
  var out = {};
  m[1].split(/\s+/).forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1); });
  return out;
}

function findMarked(comments, want) {
  for (var i = 0; i < comments.length; i++) {
    var mk = parseMarker(comments[i].body);
    if (!mk) continue;
    var ok = Object.keys(want).every(function (k) { return String(mk[k]) === String(want[k]); });
    if (ok) return comments[i];
  }
  return null;
}

function controlFileUrl(cfg, rel) {
  return cfg.webUrl + '/' + cfg.repo + '/blob/' + cfg.bridge.branch + '/' + rel;
}

function table(rows) {
  return ['| Field | Value |', '|---|---|'].concat(rows.map(function (r) { return '| ' + r[0] + ' | ' + String(r[1]).replace(/\|/g, '\\|').replace(/\n/g, ' ') + ' |'; })).join('\n');
}

function list(items, empty, max) {
  if (!Array.isArray(items) || !items.length) return '- ' + (empty || 'none');
  var shown = items.slice(0, max || 40).map(function (x) { return '- ' + short(String(x).replace(/\n/g, ' '), 400); });
  if (items.length > (max || 40)) shown.push('- … ' + (items.length - (max || 40)) + ' more (see the report file)');
  return shown.join('\n');
}

function safeBody(text) {
  var out = redact.redact(String(text));
  if (redact.findSecretKinds(out).length) {
    // Belt and braces: never post a body the shared redaction still flags.
    out = out.split('\n').filter(function (l) { return !redact.findSecretKinds(l).length; }).join('\n');
  }
  if (out.length > 60000) out = out.slice(0, 59900) + '\n\n… (truncated; the full record is the report file on the control branch)';
  return out;
}

function createdBody(cfg, task) {
  var rel = cfg.bridge.prefix + '/tasks/' + task.task_id + '.json';
  var src = task.source || {};
  var inh = src.inherited || {};
  var res = src.resolution || {};
  var inheritedFields = Object.keys(inh).filter(function (k) { return inh[k]; });
  var rows = [
      ['Task file', '[' + rel + '](' + controlFileUrl(cfg, rel) + ') on branch `' + cfg.bridge.branch + '`'],
      ['Status', '**PENDING** — scheduled; the bridge claims it on its next tick and execution starts in the executor'],
      ['Action', '`' + task.requested_action + '` → execution profile `' + engine.profileFor(task.requested_action) + '`' + (task.requested_action === 'investigate' || task.requested_action === 'review' || task.requested_action === 'test' ? ' (read-only: findings only, no commits)' : ' (may commit on `mythos/gh/' + task.task_id + '`; never merged to main automatically)') + (inh.requested_action ? ' — **inherited** from `' + src.inherited_from + '` (this body states no Action)' : '')],
      ['Action source', '`' + (task.action_source || 'task_file') + '`' + (task.action_raw ? ' — written as `' + task.action_raw + '`' : '') + (res.action_conflict ? ' (ignored: ' + res.action_conflict + ')' : '')],
      ['Priority', task.priority],
      ['Model', task.model
        ? '`' + task.model + '` (' + (task.model_source || 'requested') + ', written as `' + (task.model_raw || task.model) + '`' + (res.model_available === false ? ') — **NOT available on this host**: the attempt will stop as `MODEL_UNAVAILABLE` before any provider starts; it is never replaced by another model' : ' — honoured as written, never substituted)')
        : 'automatic — the executor scores this task and picks Haiku, Sonnet or Opus; the report names the model and the reason. Add `Model: ' +
          modelPolicy.allowedLabels().join(' | ') + '` to pin one'],
      ['Depends on', task.depends_on && task.depends_on.length ? task.depends_on.map(function (d) { return '`' + d + '`'; }).join(', ') : '—'],
      ['Scope items', String(task.scope.length) + (inh.scope ? ' (inherited)' : '')],
      ['Constraints', String(task.constraints.length) + (inh.constraints ? ' (inherited)' : '')],
      ['Validation items', String(task.validation_requirements.length) + (inh.validation_requirements ? ' (inherited)' : '')]
  ];
  if (src.rerun_of) rows.splice(1, 0, ['Attempt', String(src.attempt) + ' — rerun of `' + src.rerun_of + '` (that task is untouched)']);
  var lines = [
    marker({ task_id: task.task_id, event: 'created' }),
    '### MYTHOS TASK created — `' + task.task_id + '`',
    '',
    table(rows),
    ''
  ];
  if (inheritedFields.length) {
    lines.push('This rerun body left ' + inheritedFields.join(', ') + ' unstated, so ' + (inheritedFields.length === 1 ? 'it was' : 'they were') +
      ' **inherited from `' + src.inherited_from + '`** rather than dropped or defaulted. Restate a section under a recognised heading (`Objective`, `Scope`, `Constraints`, `Validation`, `Action`) to replace it.', '');
  }
  if (Array.isArray(src.truncated) && src.truncated.length) {
    lines.push('**Some text was truncated** to fit the task record: ' + src.truncated.map(function (t) { return '`' + t.field + '` ' + t.original_length + '→' + t.kept_length + ' chars'; }).join(', ') +
      '. The Issue keeps the full text; the executor receives the truncated record.', '');
  }
  lines.push('The task and report files on `' + cfg.bridge.branch + '` are the source of truth; this Issue is the interface. ' +
    'Closing the Issue (or removing the `' + cfg.label + '` label) while the task is active cancels it. ' +
    'Editing this Issue does NOT re-run it; to run it again after a change, add the label `' + cfg.rerunLabel + '`.');
  return lines.join('\n');
}

function claimedBody(cfg, task) {
  var ex = task.execution || {};
  return [
    marker({ task_id: task.task_id, event: 'claimed' }),
    '### MYTHOS TASK claimed — `' + task.task_id + '` · execution started',
    '',
    table([
      ['Status', '**' + task.status + '**' + (ex.executor_status ? ' (executor ' + ex.executor_status + ')' : '')],
      ['executor_task_id', '`' + (ex.executor_task_id || '—') + '`'],
      ['OTHMODE record', '`' + (ex.othmode_task_id || '—') + '`'],
      ['Action', '`' + task.requested_action + '` (source `' + (ex.action_source || task.action_source || 'task_file') + '`) → profile `' + (ex.execution_profile || '—') + '`'],
      ['Model', '`' + (ex.model || 'automatic') + '`' + (ex.model_requested ? ' (requested `' + ex.model_requested + '`)' : '')],
      ['Attempt', '`' + (ex.attempt_id || task.task_id + '#1') + '`'],
      ['Branch', '`' + (ex.branch || '—') + '`'],
      ['Base commit', '`' + short(ex.base_commit || '—', 12) + '`'],
      ['Claimed at', ex.claimed_at || '—'],
      ['Runtime', ex.runtime ? '`' + short(ex.runtime.head || '?', 12) + '` on `' + (ex.runtime.branch || '?') + '`' + (ex.runtime.code ? ' **' + ex.runtime.code + '**' : '') : '—']
    ]),
    '',
    'Progress is tracked in `' + cfg.bridge.prefix + '/state.json`; the result will be posted here when the report exists.'
  ].join('\n');
}

function issueStateOf(task, report) {
  if (!report) return task.status;
  if (report.status === 'BLOCKED' && report.blocker && report.blocker.code) {
    // A classified blocker is authoritative: a permission / governance /
    // owner-decision stop needs a human; a resolution stop (profile mismatch,
    // unavailable model, mutated attempt) is a BLOCKED fact to fix and rerun.
    var code = String(report.blocker.code);
    if (code === 'HUMAN_APPROVAL' || code === 'GOVERNANCE_DENIED' || code === 'PERMISSION_DENIED') return 'HUMAN_APPROVAL';
    if (code === 'ACTION_PROFILE_MISMATCH' || code === 'MODEL_UNAVAILABLE' || code === 'ATTEMPT_SNAPSHOT_MUTATED' || code === 'STALE_WORKER') return 'BLOCKED';
  }
  if (report.status === 'BLOCKED') {
    var text = [report.summary, report.next_recommended_action].concat(report.problems || []).join('\n');
    if (APPROVAL_RE.test(text)) return 'HUMAN_APPROVAL';
  }
  return report.status;
}

function reportBody(cfg, task, report, issueState) {
  var rel = cfg.bridge.prefix + '/reports/' + task.task_id + '.json';
  var ex = (report && report.execution) || task.execution || {};
  var res = (report && report.resolution) || (task.source && task.source.resolution) || {};
  var commits = (report && report.commits) || [];
  var headline = {
    COMPLETED: 'COMPLETED', FAILED: 'FAILED — stays open', BLOCKED: 'BLOCKED — stays open, needs a human',
    HUMAN_APPROVAL: 'HUMAN APPROVAL REQUIRED — stays open', CANCELLED: 'CANCELLED'
  }[issueState] || issueState;
  var lines = [
    marker({ task_id: task.task_id, event: 'report', status: issueState }),
    '### MYTHOS TASK ' + headline + ' — `' + task.task_id + '`',
    '',
    table([
      ['Status', '**' + issueState + '**' + (report && report.status !== issueState ? ' (control status ' + report.status + ')' : '')],
      ['Report', report ? '[' + rel + '](' + controlFileUrl(cfg, rel) + ')' + ' · [markdown](' + controlFileUrl(cfg, rel.replace(/\.json$/, '.md')) + ')' : '— (no report: cancelled before execution)'],
      ['executor_task_id', '`' + (ex.executor_task_id || '—') + '`'],
      ['OTHMODE record', '`' + (ex.othmode_task_id || '—') + '`'],
      ['Action', '`' + (res.requested_action || task.requested_action || '—') + '` (source `' + (res.action_source || task.action_source || 'task_file') + '`' + (res.action_raw || task.action_raw ? ', written as `' + (res.action_raw || task.action_raw) + '`' : '') + ') → profile `' + (res.execution_profile || ex.execution_profile || '—') + '`'],
      ['Model', '`' + (ex.model || '—') + '`' + (ex.model_requested ? ' (requested `' + ex.model_requested + '`' + (ex.model_source ? ' via ' + ex.model_source : '') + ')' : ' (' + (ex.model_selection_reason || 'automatic') + ')')],
      ['Blocker', report && report.blocker ? '`' + report.blocker.code + '` — ' + short(report.blocker.reason || '', 400) + (report.blocker.retryable === false ? ' (not retried automatically)' : '') : '—'],
      ['Branch', '`' + (ex.branch || '—') + '` @ `' + short(ex.base_commit || '—', 12) + '`'],
      ['Commits on origin', report && report.delivery ? String(report.delivery.commits_on_origin) : '—'],
      ['Git verified', report && report.validation ? String(report.validation.git_verified) : '—'],
      ['Completed at', (report && report.completed_at) || '—']
    ]),
    '',
    '#### Summary', '', short((report && report.summary) || 'Cancelled by the Issue (closed or label removed) before execution.', 6000), '',
    '#### Files changed', '', list(report && report.files_changed, 'none'), '',
    '#### Tests', '', list(report && report.tests, 'none reported'), '',
    '#### Commits', '', commits.length ? commits.map(function (c) { return '- `' + c.sha + '` ' + short(c.subject, 200) + (c.on_origin ? ' (on origin)' : ' (awaiting the governance relay)'); }).join('\n') : '- none', '',
    '#### Problems / risks', '', list(report && report.problems, 'no problems'), list(report && report.risks, 'no risks reported'), '',
    '#### Next recommended action', '', short((report && report.next_recommended_action) || 'none', 3000), ''
  ];
  if (issueState === 'COMPLETED') {
    lines.push(commits.length
      ? 'Commits live on the task branch and are delivered by the governance relay; **merging to main is a human decision** (open a PR from `' + ex.branch + '`).'
      : 'No commits were produced (read-only action or nothing to change).');
  } else if (issueState === 'HUMAN_APPROVAL') {
    lines.push('A human must decide or approve before this can continue. When done, add the label `' + cfg.rerunLabel + '` to run again as a new task, or close the Issue.');
  } else if (issueState === 'FAILED' || issueState === 'BLOCKED') {
    lines.push('Nothing is retried automatically. Fix the cause, then add the label `' + cfg.rerunLabel + '` to run again (new task id), or close the Issue.');
  }
  return lines.join('\n');
}

function deliveredBody(cfg, task, report) {
  return [
    marker({ task_id: task.task_id, event: 'delivered' }),
    '### Delivery confirmed — `' + task.task_id + '`',
    '',
    'All ' + report.commits.length + ' commit(s) on `' + report.delivery.branch + '` are now on origin (confirmed ' + (report.delivery.confirmed_on_origin_at || nowIso()) + ').',
    report.commits.map(function (c) { return '- `' + c.sha + '` ' + short(c.subject, 200); }).join('\n')
  ].join('\n');
}

// A rerun was asked for while the previous attempt is still running. The label
// is NOT consumed — the request stays pending and converts as soon as that
// attempt reaches a terminal status. Keyed by the running task_id, so a rerun
// deferred across twenty ticks produces exactly one comment.
function rerunDeferredBody(cfg, latest) {
  var src = latest.source || {};
  return [
    marker({ task_id: latest.task_id, event: 'rerun_deferred' }),
    '### Rerun deferred — attempt ' + (src.attempt || 1) + ' (`' + latest.task_id + '`) is still running',
    '',
    table([
      ['Running task', '`' + latest.task_id + '`'],
      ['Control status', '**' + latest.status + '**'],
      ['executor_task_id', '`' + ((latest.execution && latest.execution.executor_task_id) || '—') + '`']
    ]),
    '',
    'The `' + cfg.rerunLabel + '` label has been **kept**: nothing was lost. The rerun is created automatically as a new task ' +
      '(`' + issueTaskId(src.issue_number || 0, (src.attempt || 1) + 1) + '`) on the first tick after `' + latest.task_id + '` reaches ' +
      'COMPLETED, FAILED, BLOCKED or CANCELLED. Two attempts of the same Issue never run at once. ' +
      'To abandon the running attempt instead, close the Issue or remove the `' + cfg.label + '` label.'
  ].join('\n');
}

// An Issue was edited after it had already been converted, and no rerun was
// asked for. Editing is not a re-run trigger — saying nothing here is what
// makes a working adapter look broken. Keyed by the sha256 of the NEW content,
// so one comment per distinct edit and none for an unchanged Issue.
function staleEditBody(cfg, latest, hash) {
  var src = latest.source || {};
  return [
    marker({ issue: src.issue_number, event: 'stale_edit', hash: hash.slice(0, 16) }),
    '### This edit did not start anything',
    '',
    'This Issue was already converted to `' + latest.task_id + '` (attempt ' + (src.attempt || 1) + ', control status **' + latest.status + '**), ' +
      'and its text has changed since. A task is a **snapshot**: the running or finished attempt keeps the text it was created from, ' +
      'and an edit alone never creates a new one.',
    '',
    'To run the current text, add the label `' + cfg.rerunLabel + '`. That creates a NEW independent task ' +
      '(`' + issueTaskId(src.issue_number || 0, (src.attempt || 1) + 1) + '`) and leaves `' + latest.task_id + '` and its report untouched. ' +
      'A rerun body that omits `Action`, `Scope`, `Constraints` or `Validation` inherits them from this attempt rather than losing them.'
  ].join('\n');
}

function rejectedBody(cfg, issue, errors, hash, secret) {
  return [
    marker({ issue: issue.number, event: 'rejected', hash: hash.slice(0, 16) }),
    '### MYTHOS TASK not created — this Issue is not a valid task',
    '',
    list(errors, 'unknown error'),
    '',
    secret
      ? '**A secret-shaped value was detected.** It was not copied anywhere. If it is a real credential: rotate it, then open a NEW Issue without it. If it is an example or a status line: edit the value into an explicit placeholder (`<EXAMPLE_VALUE>`, `${VAR}`, `[REDACTED]`) — the adapter re-evaluates an edited Issue automatically.'
      : 'Edit the Issue to fix this (the adapter re-evaluates an edited Issue automatically) — see `docs/MYTHOS_GITHUB_ISSUES.md` for the expected format.'
  ].join('\n');
}

// Posts once: an existing marker on the Issue wins over a new comment.
async function postOnce(client, issueNumber, want, body) {
  var comments = await client.listComments(issueNumber);
  var existing = findMarked(comments, want);
  if (existing) return { comment_id: existing.id, url: existing.html_url || null, existed: true };
  var created = await client.createComment(issueNumber, safeBody(body));
  return { comment_id: created.id || null, url: created.html_url || null, existed: false, dry_run: !!created.dry_run };
}

async function setStatusLabel(cfg, client, issue, issueState) {
  var want = cfg.labelPrefix + STATUS_LABEL[issueState];
  var have = labelNames(issue);
  var result = { added: [], removed: [] };
  try {
    if (have.indexOf(want) === -1) { await client.addLabels(issue.number, [want]); result.added.push(want); }
    for (var i = 0; i < have.length; i++) {
      if (have[i].indexOf(cfg.labelPrefix) === 0 && have[i] !== want) { await client.removeLabel(issue.number, have[i]); result.removed.push(have[i]); }
    }
  } catch (e) {
    // Labels are cosmetics; the comment is the record. Never fail the tick on them.
    result.error = short(e.message, 200);
    log('label_failed', { issue: issue.number, error: result.error });
  }
  return result;
}

function saveAndCommit(cfg, tasks, files, message, opts) {
  if (opts && opts.dryRun) return { committed: false, dry_run: true };
  var idx = loadIssueTasks(cfg);
  tasks.forEach(function (t) { bridge.saveTask(cfg.bridge, t); idx.all[t.task_id] = t; });
  var all = files.slice();
  tasks.forEach(function (t) { all.push(bridge.taskFile(cfg.bridge, t.task_id)); });
  bridge.writeIndex(cfg.bridge, idx.all, {}).forEach(function (f) { all.push(f); });
  return bridge.commitControl(cfg.bridge, all.filter(function (x, i) { return all.indexOf(x) === i; }), message);
}

// --- Phase 1: intake (Issue → PENDING task) --------------------------------------------------

async function intake(cfg, client, opts) {
  opts = opts || {};
  var actions = [];
  var sync = bridge.syncControl(cfg.bridge);
  actions.push({ action: 'sync', result: sync });
  if (!sync.ok) { actions.push({ action: 'defer_all', reason: sync.reason }); return { ok: true, actions: actions }; }
  var listed = (await client.listTaskIssues()).filter(function (i) { return !i.pull_request && i.state === 'open'; });
  // Duplicate event protection: GitHub can return the same Issue twice across
  // pages (a list that shifts while it is paged) and a replayed delivery is a
  // duplicate by definition. One Issue number is handled once per tick; the
  // deterministic task id + idempotency key catch the rest across ticks.
  var seen = {};
  var issues = listed.filter(function (i) {
    if (seen[i.number]) { actions.push({ action: 'duplicate_event_ignored', issue: i.number }); return false; }
    seen[i.number] = true;
    return true;
  });
  if (cfg.only.length) issues = issues.filter(function (i) { return cfg.only.indexOf(i.number) !== -1; });
  var idx = loadIssueTasks(cfg);
  var newTasks = [];
  var pendingRerunLabel = [];
  var converted = 0;
  for (var k = 0; k < issues.length; k++) {
    var issue = issues[k];
    var n = issue.number;
    if (labelNames(issue).indexOf(cfg.label) === -1) { actions.push({ action: 'skip_no_label', issue: n }); continue; }
    var existing = idx.byIssue[n] || [];
    var latest = existing.length ? existing[existing.length - 1] : null;
    var attempt = 1;
    var previous = null;
    if (latest) {
      var wantsRerun = labelNames(issue).indexOf(cfg.rerunLabel) !== -1;
      var stillActive = ACTIVE.indexOf(latest.status) !== -1;
      var contentHash = sha256(String(issue.title || '') + '\n' + String(issue.body || ''));
      if (wantsRerun && stillActive) {
        // Two attempts of one Issue never run at once. The label is the request
        // and stays on the Issue until it is honoured; say so once, or a working
        // deferral is indistinguishable from a lost one.
        if (opts.dryRun) { actions.push({ action: 'would_defer_rerun', issue: n, task_id: latest.task_id, status: latest.status }); continue; }
        var dc = await postOnce(client, n, { task_id: latest.task_id, event: 'rerun_deferred' }, rerunDeferredBody(cfg, latest));
        actions.push({ action: 'rerun_deferred', issue: n, task_id: latest.task_id, status: latest.status, comment: dc });
        log('rerun_deferred', { issue: n, task_id: latest.task_id, status: latest.status, existed: dc.existed });
        continue;
      }
      if (!wantsRerun) {
        // Steady state: nothing to do and nothing to say. The exception is an
        // Issue edited since its attempt was created — that is a user who
        // expects something to happen, so answer that edit exactly once.
        var edited = !!(latest.source && latest.source.content_sha256 && latest.source.content_sha256 !== contentHash);
        var se = null;
        if (edited && !opts.dryRun) {
          se = await postOnce(client, n, { issue: n, event: 'stale_edit', hash: contentHash.slice(0, 16) }, staleEditBody(cfg, latest, contentHash));
        }
        actions.push({ action: 'already_converted', issue: n, task_id: latest.task_id, status: latest.status, edited: edited, comment: se });
        log('already_converted', { issue: n, task_id: latest.task_id, status: latest.status, edited: edited, notified: !!(se && !se.existed) });
        continue;
      }
      previous = latest;
      var p = parseIssueTaskId(latest.task_id);
      attempt = ((p && p.attempt) || existing.length) + 1;
    }
    if (converted >= cfg.maxIssuesPerTick) { actions.push({ action: 'defer', issue: n, reason: 'per-tick limit' }); continue; }
    var conv = issueToTask(cfg, issue, attempt, previous);
    if (!conv.task) {
      var hash = sha256(String(issue.title || '') + '\n' + String(issue.body || ''));
      var rej = await postOnce(client, n, { issue: n, event: 'rejected', hash: hash.slice(0, 16) }, rejectedBody(cfg, issue, conv.errors, hash, conv.secret));
      if (!rej.existed) await setStatusLabel(cfg, client, issue, 'INVALID');
      actions.push({ action: 'rejected', issue: n, errors: conv.errors, comment: rej, secret: conv.secret, resolution: conv.resolution || null });
      log('rejected', { issue: n, errors: conv.errors, existed: rej.existed });
      continue;
    }
    var task = conv.task;
    if (opts.dryRun) { actions.push({ action: 'would_create', issue: n, task_id: task.task_id, task: task }); continue; }
    // Comment first, file second: the marker is the recovery key if the
    // process dies between the two (next tick finds the marker, no repost).
    var cm = await postOnce(client, n, { task_id: task.task_id, event: 'created' }, createdBody(cfg, task));
    task.source.notifications.created = { comment_id: cm.comment_id, url: cm.url, at: nowIso(), existed: cm.existed };
    task.source.labels = await setStatusLabel(cfg, client, issue, 'PENDING');
    // The rerun label is the REQUEST, not a bookkeeping flag: it is consumed
    // only after the control commit below reports committed=true. A tick that
    // dies here (timeout, OOM, an exception raised by a later Issue) leaves the
    // label in place, so the next tick sees the request again and re-creates the
    // same attempt — adopting the "created" comment it already posted.
    if (attempt > 1) pendingRerunLabel.push(n);
    newTasks.push(task);
    converted++;
    task.source.events.push({ at: nowIso(), event: 'task_created', reason: 'control/tasks/' + task.task_id + '.json PENDING; created comment ' + (cm.existed ? 'adopted' : 'posted') });
    actions.push({ action: 'create', issue: n, task_id: task.task_id, attempt: attempt, comment: cm, requested_action: task.requested_action, action_source: task.action_source, model: task.model || null });
    log('created', { issue: n, task_id: task.task_id, attempt: attempt, requested_action: task.requested_action, action_source: task.action_source, action_raw: task.action_raw, execution_profile: engine.profileFor(task.requested_action), model: task.model || null, model_source: task.model_source || null });
    await notifyTelegram({
      category: 'task', event: 'created', key: task.task_id, id: '#' + n, status: 'PENDING',
      title: short(String(issue.title || ''), 200), model: task.model || null
    });
  }
  if (newTasks.length) {
    var msg = 'control: issues → ' + newTasks.map(function (t) { return t.task_id + ' (#' + t.source.issue_number + ')'; }).join(', ').slice(0, 180);
    var committed = saveAndCommit(cfg, newTasks, [], msg + '\n\nWritten by the MYTHOS GitHub Issues adapter (' + cfg.bridge.claimedBy + '). Delivery: governance relay.', opts);
    actions.push({ action: 'commit', result: committed });
    if (pendingRerunLabel.length) {
      if (committed && committed.committed) {
        for (var c = 0; c < pendingRerunLabel.length; c++) {
          var rn = pendingRerunLabel[c];
          try {
            await client.removeLabel(rn, cfg.rerunLabel);
            actions.push({ action: 'rerun_label_consumed', issue: rn, commit: committed.commit });
          } catch (e) {
            // Worst case the label survives a committed rerun: the next tick
            // sees the request, finds the attempt already on disk and defers or
            // creates the next one. Never the other way round.
            log('rerun_label_not_removed', { issue: rn, error: short(e.message, 200) });
            actions.push({ action: 'rerun_label_not_removed', issue: rn, error: short(e.message, 200) });
          }
        }
      } else {
        log('rerun_label_kept', { issues: pendingRerunLabel, reason: (committed && committed.reason) || 'control commit not confirmed' });
        actions.push({ action: 'rerun_label_kept', issues: pendingRerunLabel, reason: (committed && committed.reason) || 'control commit not confirmed' });
      }
    }
  }
  return { ok: true, actions: actions };
}

// --- Phase 2: notify (task/report → Issue) ----------------------------------------------------

async function notify(cfg, client, opts) {
  opts = opts || {};
  var actions = [];
  var idx = loadIssueTasks(cfg);
  var dirty = [];
  var extraFiles = [];
  var numbers = Object.keys(idx.byIssue).map(Number).filter(function (n) { return !cfg.only.length || cfg.only.indexOf(n) !== -1; }).sort(function (a, b) { return a - b; });
  for (var i = 0; i < numbers.length; i++) {
    var n = numbers[i];
    var tasks = idx.byIssue[n];
    for (var j = 0; j < tasks.length; j++) {
      var t = tasks[j];
      var src = t.source && t.source.kind === 'github-issue' ? t.source : null;
      if (!src) continue; // planner-written task that merely looks like an issue id: not ours
      src.notifications = src.notifications || {};
      var report = TERMINAL.indexOf(t.status) !== -1 ? reportFor(cfg, t.task_id) : null;
      var changed = false;
      var issue = null;
      async function getIssue() { if (!issue) issue = await client.getIssue(n); return issue; }

      // Cancellation from the Issue side: closed, or `task` label removed.
      if (ACTIVE.indexOf(t.status) !== -1) {
        var is = await getIssue();
        var lost = is.state !== 'open' || labelNames(is).indexOf(cfg.label) === -1;
        if (lost) {
          if (opts.dryRun) { actions.push({ action: 'would_cancel', issue: n, task_id: t.task_id }); }
          else {
            t.status = 'CANCELLED';
            src.cancelled_from_issue = { at: nowIso(), reason: is.state !== 'open' ? 'issue closed' : 'label removed' };
            changed = true;
            actions.push({ action: 'cancel', issue: n, task_id: t.task_id, reason: src.cancelled_from_issue.reason });
            log('cancel', { issue: n, task_id: t.task_id, reason: src.cancelled_from_issue.reason });
          }
        }
      }

      // Claimed / in progress → one comment with the executor id.
      if (!changed && ['CLAIMED', 'IN_PROGRESS', 'VALIDATING'].indexOf(t.status) !== -1 && !src.notifications.claimed && t.execution && t.execution.executor_task_id) {
        if (opts.dryRun) actions.push({ action: 'would_notify', event: 'claimed', issue: n, task_id: t.task_id });
        else {
          var c1 = await postOnce(client, n, { task_id: t.task_id, event: 'claimed' }, claimedBody(cfg, t));
          src.notifications.claimed = { comment_id: c1.comment_id, url: c1.url, at: nowIso(), existed: c1.existed, executor_task_id: t.execution.executor_task_id };
          await setStatusLabel(cfg, client, await getIssue(), 'IN_PROGRESS');
          changed = true;
          actions.push({ action: 'notify', event: 'claimed', issue: n, task_id: t.task_id, comment: c1 });
          await notifyTelegram({
            category: 'task', event: 'claimed', key: t.task_id + ':claimed', id: '#' + n, status: 'IN_PROGRESS',
            title: short(String(t.objective || ''), 200), model: t.model || null, guard: true
          });
        }
      }

      // Terminal → the report comment (or the cancelled-before-claim notice).
      var terminalReady = TERMINAL.indexOf(t.status) !== -1 && (report || (t.status === 'CANCELLED' && !(t.execution && t.execution.executor_task_id)));
      if (!changed && terminalReady && !src.notifications.report) {
        var istate = issueStateOf(t, report);
        if (opts.dryRun) actions.push({ action: 'would_notify', event: 'report', issue: n, task_id: t.task_id, status: istate });
        else {
          var c2 = await postOnce(client, n, { task_id: t.task_id, event: 'report' }, reportBody(cfg, t, report, istate));
          src.notifications.report = {
            comment_id: c2.comment_id, url: c2.url, at: nowIso(), existed: c2.existed, status: istate,
            control_status: t.status, report_file: report ? cfg.bridge.prefix + '/reports/' + t.task_id + '.json' : null,
            commits_on_origin: report && report.delivery ? report.delivery.commits_on_origin : null
          };
          src.issue_state = istate;
          var is2 = await getIssue();
          await setStatusLabel(cfg, client, is2, istate);
          var closable = istate === 'COMPLETED' && cfg.closeOnCompleted && !(report && report.delivery && report.delivery.commits_on_origin === false) && is2.state === 'open';
          if (closable) { await client.closeIssue(n); src.notifications.closed = { at: nowIso(), by: BY }; }
          changed = true;
          actions.push({ action: 'notify', event: 'report', issue: n, task_id: t.task_id, status: istate, closed: !!closable, comment: c2 });
          log('report_posted', { issue: n, task_id: t.task_id, status: istate, closed: !!closable, existed: c2.existed });
          await notifyTelegram({
            category: 'task', event: REPORT_EVENT_BY_STATE[istate] || 'completed', key: t.task_id + ':report', id: '#' + n, status: istate,
            title: report ? short(String(report.summary || ''), 500) : 'cancelled before it was claimed',
            result: report && Array.isArray(report.tests) && report.tests.length ? report.tests.slice(0, 3).map(function (x) { return short(String(x), 120); }).join(' | ') : null,
            next_action: report && report.next_recommended_action ? short(String(report.next_recommended_action), 300) : null,
            model: (report && report.execution && report.execution.model) || t.model || null,
            guard: true
          });
        }
      }

      // Delivery follow-up: the bridge re-measured on_origin → true after the relay.
      if (!changed && report && src.notifications.report && src.notifications.report.commits_on_origin === false &&
          report.delivery && report.delivery.commits_on_origin === true && !src.notifications.delivered) {
        if (opts.dryRun) actions.push({ action: 'would_notify', event: 'delivered', issue: n, task_id: t.task_id });
        else {
          var c3 = await postOnce(client, n, { task_id: t.task_id, event: 'delivered' }, deliveredBody(cfg, t, report));
          src.notifications.delivered = { comment_id: c3.comment_id, url: c3.url, at: nowIso(), existed: c3.existed };
          var is3 = await getIssue();
          if (src.issue_state === 'COMPLETED' && cfg.closeOnCompleted && is3.state === 'open' && !src.notifications.closed) {
            await client.closeIssue(n); src.notifications.closed = { at: nowIso(), by: BY };
          }
          changed = true;
          actions.push({ action: 'notify', event: 'delivered', issue: n, task_id: t.task_id, comment: c3 });
        }
      }
      if (changed) dirty.push(t);
    }
  }
  if (dirty.length) {
    var msg = 'control: issues ← ' + dirty.map(function (t) { return t.task_id; }).join(', ').slice(0, 180);
    actions.push({ action: 'commit', result: saveAndCommit(cfg, dirty, extraFiles, msg + '\n\nIssue notifications recorded by the MYTHOS GitHub Issues adapter (' + cfg.bridge.claimedBy + ').', opts) });
  }
  return { ok: true, actions: actions };
}

// --- Orchestration ---------------------------------------------------------------------

function withLock(cfg, fn) {
  return Promise.resolve().then(function () {
    try { bridge.userGuard(); } catch (e) { return { ok: false, reason: e.message }; }
    var lock = bridge.acquireLock(cfg.bridge);
    if (!lock) return { ok: false, reason: 'another bridge process holds the lock' };
    return Promise.resolve().then(fn).then(function (r) { bridge.releaseLock(lock); return r; }, function (e) {
      bridge.releaseLock(lock);
      log('phase_error', { error: redact.redact(String(e && e.stack || e)).slice(0, 800) });
      return { ok: false, reason: redact.redact(String(e && e.message || e)).slice(0, 400) };
    });
  });
}

function clientFor(cfg, opts) {
  var token = readToken();
  if (!token && !opts.allowAnonymous) throw new Error('GITHUB_TOKEN_MISSING: no MYTHOS_GITHUB_ISSUES_TOKEN / MYTHOS_GITHUB_MCP_RW_TOKEN in the environment and no MYTHOS_GITHUB_ISSUES_TOKEN_FILE');
  return createClient(cfg, token, opts);
}

// intake → bridge.tick → notify. Each phase holds the bridge lock for itself.
async function issuesTick(executor, opts) {
  opts = opts || {};
  var cfg = config();
  var client = clientFor(cfg, opts);
  var out = { ok: true, repo: cfg.repo, dry_run: !!opts.dryRun, only: cfg.only, phases: {} };
  out.phases.intake = await withLock(cfg, function () { return intake(cfg, client, opts); });
  if (!opts.skipBridge) out.phases.bridge = opts.dryRun ? { skipped: 'dry-run' } : bridge.tick(executor, { forceIndex: !!opts.forceIndex });
  out.phases.notify = await withLock(cfg, function () { return notify(cfg, client, opts); });
  out.api_calls = client.calls.length;
  out.rate_limit_remaining = client.rate.remaining;
  out.ok = out.phases.intake.ok !== false && out.phases.notify.ok !== false && (!out.phases.bridge || out.phases.bridge.ok !== false || /lock/.test(out.phases.bridge.reason || ''));
  return out;
}

function status() {
  var cfg = config();
  var idx = loadIssueTasks(cfg);
  return {
    repo: cfg.repo, label: cfg.label, enabled: cfg.enabled, close_on_completed: cfg.closeOnCompleted, token_present: !!readToken(),
    issues: Object.keys(idx.byIssue).map(Number).sort(function (a, b) { return a - b; }).map(function (n) {
      return idx.byIssue[n].map(function (t) {
        var rep = TERMINAL.indexOf(t.status) !== -1 ? reportFor(cfg, t.task_id) : null;
        return {
          issue: n, issue_url: t.source ? t.source.issue_url : null, task_id: t.task_id, status: t.status,
          requested_action: t.requested_action, action_source: t.action_source || null, action_raw: t.action_raw || null,
          execution_profile: t.execution ? (t.execution.execution_profile || null) : engine.profileFor(t.requested_action),
          model: t.model || null, model_source: t.model_source || null,
          issue_state: t.source && t.source.issue_state ? t.source.issue_state : (rep ? issueStateOf(t, rep) : t.status),
          executor_task_id: t.execution ? t.execution.executor_task_id || null : null,
          report_file: rep ? cfg.bridge.prefix + '/reports/' + t.task_id + '.json' : null,
          notifications: t.source ? Object.keys(t.source.notifications || {}) : []
        };
      });
    }).reduce(function (a, b) { return a.concat(b); }, [])
  };
}

module.exports = {
  BY: BY,
  ISSUE_STATES: ISSUE_STATES,
  STATUS_LABEL: STATUS_LABEL,
  config: config,
  readToken: readToken,
  createClient: createClient,
  LIMITS: LIMITS,
  splitSections: splitSections,
  extractFields: engine.extractFields,
  issueToTask: issueToTask,
  issueTaskId: issueTaskId,
  parseIssueTaskId: parseIssueTaskId,
  loadIssueTasks: loadIssueTasks,
  issueStateOf: issueStateOf,
  marker: marker,
  parseMarker: parseMarker,
  createdBody: createdBody,
  claimedBody: claimedBody,
  reportBody: reportBody,
  rejectedBody: rejectedBody,
  rerunDeferredBody: rerunDeferredBody,
  staleEditBody: staleEditBody,
  safeBody: safeBody,
  intake: intake,
  notify: notify,
  issuesTick: issuesTick,
  status: status
};
