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
//      of title+body, so an unchanged invalid Issue is answered once.
//
// What this file deliberately does NOT do: run anything, push, merge, touch
// main, honour provider/model/path/tool/credential selection from an Issue
// (requested_action is the only lever, exactly as in the task protocol),
// or execute an Issue that lacks the `task` label or is closed.
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
    }
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
  max_turns: ['max turns', 'max_turns', 'max-turns']
};
var SCALAR_KEYS = ['action', 'priority', 'depends_on', 'timeout', 'max_turns'];
var ACTION_SYNONYMS = {
  investigate: 'investigate', investigation: 'investigate', analyse: 'investigate', analyze: 'investigate', 'تحقيق': 'investigate',
  review: 'review', 'مراجعة': 'review',
  test: 'test', testing: 'test', 'اختبار': 'test',
  document: 'document', docs: 'document', documentation: 'document', 'توثيق': 'document',
  implement: 'implement', implementation: 'implement', build: 'implement', fix: 'implement', 'تنفيذ': 'implement'
};

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

// Splits a body into named sections. Headings (`## Objective`, `Objective:`,
// `**Objective**`) open a section; scalar keys also accept `Key: value` on
// one line anywhere in the body. Text before the first heading is the
// preamble (used as the objective when no objective section exists).
function splitSections(body) {
  var sections = { _preamble: [] };
  var current = '_preamble';
  String(body || '').replace(/\r\n/g, '\n').split('\n').forEach(function (line) {
    var h = /^\s{0,3}#{1,6}\s*(.+?)\s*#*\s*$/.exec(line);
    var b = !h && /^\s{0,3}\*\*([^*]+)\*\*\s*:?\s*(.*)$/.exec(line);
    var c = !h && !b && /^\s{0,3}([^\s:][^:]{0,40}?)\s*:\s*(.*)$/.exec(line);
    var name = null, rest = '';
    if (h) { name = h[1]; }
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
    if (sec && (h || b || SCALAR_KEYS.indexOf(sec) !== -1 || !rest || c)) {
      if (SCALAR_KEYS.indexOf(sec) !== -1 && rest) {
        sections[sec] = (sections[sec] || []).concat([rest]);
        return;
      }
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
  return items.filter(Boolean).map(function (s) { return short(s, 300); });
}

function textOf(lines, max) {
  return short((lines || []).join('\n').replace(/\n{3,}/g, '\n\n').trim(), max);
}

function labelNames(issue) {
  return (issue.labels || []).map(function (l) { return typeof l === 'string' ? l : l.name; }).filter(Boolean);
}

function pickAction(cfg, issue, sections) {
  var fromLabel = labelNames(issue).map(function (l) { var m = /^action:(.+)$/i.exec(l); return m ? m[1].toLowerCase() : null; }).filter(Boolean)[0];
  var fromBody = sections.action && sections.action.length ? normKey(sections.action[0]) : null;
  var raw = fromLabel || fromBody || cfg.defaultAction;
  return { action: ACTION_SYNONYMS[raw] || raw, explicit: !!(fromLabel || fromBody) };
}

function pickPriority(issue, sections) {
  var fromLabel = labelNames(issue).map(function (l) { var m = /^priority:(low|normal|high)$/i.exec(l); return m ? m[1].toLowerCase() : null; }).filter(Boolean)[0];
  var fromBody = sections.priority && sections.priority.length ? normKey(sections.priority[0]) : null;
  var p = fromLabel || fromBody || 'normal';
  return ['low', 'normal', 'high'].indexOf(p) === -1 ? 'normal' : p;
}

function pickDepends(sections) {
  var out = [];
  (sections.depends_on || []).join(',').split(/[,\s]+/).forEach(function (tok) {
    tok = tok.trim().replace(/^[-*]\s*/, '');
    if (!tok) return;
    var m = /^#?(\d+)$/.exec(tok);
    if (m) out.push(issueTaskId(parseInt(m[1], 10), 1));
    else if (bridge.isValidTaskId(tok)) out.push(tok);
  });
  return out.filter(function (x, i) { return out.indexOf(x) === i; });
}

function pickInt(sections, key, min, max) {
  if (!sections[key] || !sections[key].length) return null;
  var n = parseInt(String(sections[key][0]).replace(/[^0-9]/g, ''), 10);
  if (!(n >= min && n <= max)) return null;
  return n;
}

// Pure: Issue payload → { task, errors }. Never throws on user content.
function issueToTask(cfg, issue, attempt) {
  attempt = attempt || 1;
  var n = issue.number;
  var title = String(issue.title || '').replace(/^\s*TASK\s*[:：-]\s*/i, '').trim();
  var body = String(issue.body || '');
  var errors = [];
  var secretKinds = redact.findSecretKinds(title + '\n' + body);
  if (secretKinds.length) {
    return { task: null, errors: ['Issue carries a secret-shaped string (' + secretKinds.join(', ') + '). Credentials never travel in tasks: rotate it and open a new Issue.'], secret: true };
  }
  var sections = splitSections(body);
  var objective = textOf(sections.objective, 8000) || textOf(sections._preamble, 8000) || title;
  if (objective.length < 10) errors.push('objective is too short (add an "Objective" section or a descriptive title)');
  var act = pickAction(cfg, issue, sections);
  if (!bridge.PROFILE_BY_ACTION[act.action]) errors.push('Action "' + short(act.action, 30) + '" is not one of ' + Object.keys(bridge.PROFILE_BY_ACTION).join(', '));
  var taskId = issueTaskId(n, attempt);
  var notesParts = ['Source: GitHub Issue #' + n + ' ' + issue.html_url + (title ? ' — "' + short(title, 200) + '"' : '')];
  if (!act.explicit) notesParts.push('requested_action defaulted to "' + cfg.defaultAction + '" because the Issue did not state one (add `Action: implement|document|test|review|investigate` or a label `action:<x>`).');
  var notes = textOf(sections.notes, 2000);
  if (notes) notesParts.push(notes);
  Object.keys(sections).filter(function (k) { return k.indexOf('_other:') === 0; }).forEach(function (k) {
    var txt = textOf(sections[k], 800);
    if (txt) notesParts.push('[' + k.slice(7) + ']\n' + txt);
  });
  var task = {
    protocol: bridge.PROTOCOL,
    task_id: taskId,
    project: cfg.bridge.project,
    objective: objective,
    scope: listItems(sections.scope),
    constraints: listItems(sections.constraints),
    priority: pickPriority(issue, sections),
    requested_action: act.action,
    validation_requirements: listItems(sections.validation),
    status: 'PENDING',
    created_at: nowIso(),
    created_by: short('github-issue:' + ((issue.user && issue.user.login) || 'unknown'), 64)
  };
  var deps = pickDepends(sections);
  if (deps.length) task.depends_on = deps.filter(function (d) { return d !== taskId; });
  var timeout = pickInt(sections, 'timeout', 60, 21600);
  if (timeout) task.timeout_seconds = timeout;
  var turns = pickInt(sections, 'max_turns', 1, 500);
  if (turns) task.max_turns = turns;
  task.notes = short(notesParts.join('\n\n'), 4000);
  task.source = {
    kind: 'github-issue',
    repo: cfg.repo,
    issue_number: n,
    issue_url: issue.html_url,
    issue_id: issue.id || null,
    issue_node_id: issue.node_id || null,
    issue_title: short(issue.title || '', 300),
    issue_author: (issue.user && issue.user.login) || null,
    issue_created_at: issue.created_at || null,
    issue_updated_at: issue.updated_at || null,
    issue_labels: labelNames(issue).slice(0, 20),
    content_sha256: sha256(String(issue.title || '') + '\n' + body),
    attempt: attempt,
    rerun_of: attempt > 1 ? issueTaskId(n, attempt - 1) : null,
    converted_at: nowIso(),
    converted_by: BY,
    notifications: {}
  };
  errors = errors.concat(bridge.validateTask(cfg.bridge, task, taskId + '.json'));
  return { task: errors.length ? null : task, errors: errors, candidate: task, secret: false };
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
  return [
    marker({ task_id: task.task_id, event: 'created' }),
    '### MYTHOS TASK created — `' + task.task_id + '`',
    '',
    table([
      ['Task file', '[' + rel + '](' + controlFileUrl(cfg, rel) + ') on branch `' + cfg.bridge.branch + '`'],
      ['Status', '**PENDING** — scheduled; the bridge claims it on its next tick and execution starts in the executor'],
      ['Action', '`' + task.requested_action + '` → execution profile `' + bridge.PROFILE_BY_ACTION[task.requested_action] + '`' + (task.requested_action === 'investigate' || task.requested_action === 'review' || task.requested_action === 'test' ? ' (read-only: findings only, no commits)' : ' (may commit on `mythos/gh/' + task.task_id + '`; never merged to main automatically)')],
      ['Priority', task.priority],
      ['Depends on', task.depends_on && task.depends_on.length ? task.depends_on.map(function (d) { return '`' + d + '`'; }).join(', ') : '—'],
      ['Scope items', String(task.scope.length)],
      ['Validation items', String(task.validation_requirements.length)]
    ]),
    '',
    'The task and report files on `' + cfg.bridge.branch + '` are the source of truth; this Issue is the interface. ' +
      'Closing the Issue (or removing the `' + cfg.label + '` label) while the task is active cancels it. ' +
      'This Issue was converted once; to run it again after a change, add the label `' + cfg.rerunLabel + '`.'
  ].join('\n');
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
      ['Execution profile', '`' + (ex.execution_profile || '—') + '`'],
      ['Branch', '`' + (ex.branch || '—') + '`'],
      ['Base commit', '`' + short(ex.base_commit || '—', 12) + '`'],
      ['Claimed at', ex.claimed_at || '—']
    ]),
    '',
    'Progress is tracked in `' + cfg.bridge.prefix + '/state.json`; the result will be posted here when the report exists.'
  ].join('\n');
}

function issueStateOf(task, report) {
  if (!report) return task.status;
  if (report.status === 'BLOCKED') {
    var text = [report.summary, report.next_recommended_action].concat(report.problems || []).join('\n');
    if (APPROVAL_RE.test(text)) return 'HUMAN_APPROVAL';
  }
  return report.status;
}

function reportBody(cfg, task, report, issueState) {
  var rel = cfg.bridge.prefix + '/reports/' + task.task_id + '.json';
  var ex = (report && report.execution) || task.execution || {};
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
      ['Branch', '`' + (ex.branch || '—') + '`'],
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

function rejectedBody(cfg, issue, errors, hash, secret) {
  return [
    marker({ issue: issue.number, event: 'rejected', hash: hash.slice(0, 16) }),
    '### MYTHOS TASK not created — this Issue is not a valid task',
    '',
    list(errors, 'unknown error'),
    '',
    secret
      ? '**A secret-shaped value was detected.** It was not copied anywhere. Rotate it, then open a NEW Issue without it.'
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
  var issues = (await client.listTaskIssues()).filter(function (i) { return !i.pull_request && i.state === 'open'; });
  if (cfg.only.length) issues = issues.filter(function (i) { return cfg.only.indexOf(i.number) !== -1; });
  var idx = loadIssueTasks(cfg);
  var newTasks = [];
  var converted = 0;
  for (var k = 0; k < issues.length; k++) {
    var issue = issues[k];
    var n = issue.number;
    if (labelNames(issue).indexOf(cfg.label) === -1) { actions.push({ action: 'skip_no_label', issue: n }); continue; }
    var existing = idx.byIssue[n] || [];
    var latest = existing.length ? existing[existing.length - 1] : null;
    var attempt = 1;
    if (latest) {
      var wantsRerun = labelNames(issue).indexOf(cfg.rerunLabel) !== -1;
      if (ACTIVE.indexOf(latest.status) !== -1 || !wantsRerun) { actions.push({ action: 'already_converted', issue: n, task_id: latest.task_id, status: latest.status }); continue; }
      var p = parseIssueTaskId(latest.task_id);
      attempt = ((p && p.attempt) || existing.length) + 1;
    }
    if (converted >= cfg.maxIssuesPerTick) { actions.push({ action: 'defer', issue: n, reason: 'per-tick limit' }); continue; }
    var conv = issueToTask(cfg, issue, attempt);
    if (!conv.task) {
      var hash = sha256(String(issue.title || '') + '\n' + String(issue.body || ''));
      var rej = await postOnce(client, n, { issue: n, event: 'rejected', hash: hash.slice(0, 16) }, rejectedBody(cfg, issue, conv.errors, hash, conv.secret));
      if (!rej.existed) await setStatusLabel(cfg, client, issue, 'INVALID');
      actions.push({ action: 'rejected', issue: n, errors: conv.errors, comment: rej, secret: conv.secret });
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
    if (attempt > 1) { try { await client.removeLabel(n, cfg.rerunLabel); } catch (e) { log('rerun_label_not_removed', { issue: n, error: short(e.message, 200) }); } }
    newTasks.push(task);
    converted++;
    actions.push({ action: 'create', issue: n, task_id: task.task_id, attempt: attempt, comment: cm });
    log('created', { issue: n, task_id: task.task_id, attempt: attempt, requested_action: task.requested_action });
  }
  if (newTasks.length) {
    var msg = 'control: issues → ' + newTasks.map(function (t) { return t.task_id + ' (#' + t.source.issue_number + ')'; }).join(', ').slice(0, 180);
    actions.push({ action: 'commit', result: saveAndCommit(cfg, newTasks, [], msg + '\n\nWritten by the MYTHOS GitHub Issues adapter (' + cfg.bridge.claimedBy + '). Delivery: governance relay.', opts) });
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
  splitSections: splitSections,
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
  safeBody: safeBody,
  intake: intake,
  notify: notify,
  issuesTick: issuesTick,
  status: status
};
