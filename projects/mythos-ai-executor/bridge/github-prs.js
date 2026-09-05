'use strict';
// =====================================================
// MYTHOS GitHub Pull Request → Telegram notifications
// projects/mythos-ai-executor/bridge/github-prs.js
//
// A third, read-only channel next to github-issues.js and telegram.js: it
// polls the repository's pull requests and turns state changes into
// notifications on the unified Telegram sink (bridge/notify/telegram-notify.js).
// It never writes to the control branch, never creates a control task, never
// comments on GitHub, and never has any authority over a PR (no merge, no
// review, no label, no close) — it only reads and reports.
//
//   GET /repos/:repo/pulls?state=all   (this file, every tick)
//        │  diff against the last-seen state (this adapter's own small
//        │  local ledger, outside Git — the same store convention as every
//        │  other bridge sink)
//        ▼
//   opened / updated (new commits) / review (approved / changes requested) /
//   checks (passing / failing) / merged / closed without merge
//        │
//        ▼
//   bridge/notify/telegram-notify.js enqueue() → flush() (unchanged, out of band)
//
// API budget: only PRs whose head commit changed since the last poll (or
// that are new) get the extra review/check-run calls, and the whole tick is
// capped by maxPerTick — a large backlog is simply picked up over several
// ticks, never in one burst that could exhaust the rate limit or flood the
// chat with an event per open PR on first run.
// =====================================================

var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');
var url = require('url');

var EXEC_ROOT = path.join(__dirname, '..');
var bridge = require('./github-bridge');
var redact = require(path.join(EXEC_ROOT, '..', 'mythos-orchestrator', 'lib', 'redact'));
var telegramNotify = require('./notify/telegram-notify');
function issuesModule() { return require('./github-issues'); }

var BY = 'github-prs';

function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function nowIso() { return new Date().toISOString(); }

// --- Configuration -------------------------------------------------------------

function config() {
  var b = bridge.config();
  return {
    bridge: b,
    enabled: process.env.MYTHOS_PR_NOTIFY_ENABLED === '1',
    repo: process.env.MYTHOS_ISSUES_REPO || issuesModule().config().repo,
    apiUrl: (process.env.MYTHOS_GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
    timeoutMs: parseInt(process.env.MYTHOS_PR_HTTP_TIMEOUT_MS || '20000', 10),
    maxPerTick: Math.max(1, parseInt(process.env.MYTHOS_PR_MAX_PER_TICK || '15', 10) || 15),
    maxDetailCalls: Math.max(1, parseInt(process.env.MYTHOS_PR_MAX_DETAIL_CALLS || '10', 10) || 10),
    userAgent: 'mythos-github-prs/1 (+' + BY + ')',
    home: path.join(b.home, 'prs'),
    stateFile: path.join(b.home, 'prs', 'state.json')
  };
}

// Same credential as the Issues adapter: a read-only poll of public
// repository metadata needs no separate token or scope.
function readToken() { return issuesModule().readToken(); }

// --- GitHub API client (GET only; no dependency, token in closure) -----------------

function createClient(cfg, token) {
  var base = url.parse(cfg.apiUrl);
  var mod = base.protocol === 'http:' ? http : https;
  var calls = [];

  function request(apiPath) {
    return new Promise(function (resolve, reject) {
      var headers = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': cfg.userAgent };
      if (token) headers.Authorization = 'Bearer ' + token;
      var req = mod.request({
        protocol: base.protocol, hostname: base.hostname, port: base.port,
        path: (base.pathname === '/' ? '' : base.pathname.replace(/\/+$/, '')) + apiPath,
        method: 'GET', headers: headers, timeout: cfg.timeoutMs
      }, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          var text = Buffer.concat(chunks).toString('utf8');
          var parsed = null;
          try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = null; }
          calls.push({ path: apiPath, status: res.statusCode });
          resolve({ status: res.statusCode, body: parsed, text: text });
        });
      });
      req.on('timeout', function () { req.destroy(new Error('GITHUB_TIMEOUT: GET ' + apiPath)); });
      req.on('error', function (e) { reject(new Error('GITHUB_HTTP: GET ' + apiPath + ': ' + redact.redact(String(e.message)).slice(0, 200))); });
      req.end();
    });
  }

  function must(r, what) {
    if (r.status >= 200 && r.status < 300) return r.body;
    throw new Error('GITHUB_API ' + r.status + ' on ' + what + ': ' + redact.redact(short(r.text, 300)));
  }

  var repo = '/repos/' + cfg.repo;

  async function pages(apiPath, cap) {
    var out = [];
    for (var page = 1; page <= (cap || 3); page++) {
      var sep = apiPath.indexOf('?') === -1 ? '?' : '&';
      var r = await request(apiPath + sep + 'per_page=50&page=' + page);
      var items = must(r, apiPath);
      if (!Array.isArray(items)) break;
      out = out.concat(items);
      if (items.length < 50) break;
    }
    return out;
  }

  return {
    calls: calls,
    listPulls: function () { return pages(repo + '/pulls?state=all&sort=updated&direction=desc', 3); },
    listReviews: async function (n) { return must(await request(repo + '/pulls/' + n + '/reviews?per_page=50'), 'pr #' + n + ' reviews'); },
    // The real endpoint wraps the array as { total_count, check_runs: [...] }.
    listCheckRuns: async function (sha) {
      var body = must(await request(repo + '/commits/' + sha + '/check-runs?per_page=50'), 'check-runs ' + sha);
      return (body && Array.isArray(body.check_runs)) ? body.check_runs : [];
    }
  };
}

// --- Pure decisions (testable without the network) ---------------------------------

// Latest review per user, then the most recent decisive state overall.
// Comments (state COMMENTED) never override an approval/changes-requested.
function reviewDecision(reviews) {
  if (!Array.isArray(reviews) || !reviews.length) return null;
  var byUser = {};
  reviews.forEach(function (r) {
    if (!r || !r.user || !r.state) return;
    if (r.state === 'COMMENTED' || r.state === 'PENDING') return;
    var login = r.user.login || String(r.user.id);
    var prev = byUser[login];
    if (!prev || Date.parse(r.submitted_at || 0) >= Date.parse(prev.submitted_at || 0)) byUser[login] = r;
  });
  var states = Object.keys(byUser).map(function (u) { return byUser[u].state; });
  if (!states.length) return null;
  if (states.indexOf('CHANGES_REQUESTED') !== -1) return 'CHANGES_REQUESTED';
  if (states.indexOf('APPROVED') !== -1) return 'APPROVED';
  return states[0];
}

// success / failure / pending, from a check-runs list. An empty list is "no
// checks configured", which never notifies (not a failure).
function checksDecision(checkRuns) {
  if (!Array.isArray(checkRuns) || !checkRuns.length) return null;
  var anyFailed = checkRuns.some(function (c) { return c.status === 'completed' && ['failure', 'timed_out', 'cancelled'].indexOf(c.conclusion) !== -1; });
  if (anyFailed) return 'failure';
  var allDone = checkRuns.every(function (c) { return c.status === 'completed'; });
  if (allDone) return checkRuns.every(function (c) { return c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral'; }) ? 'success' : 'failure';
  return 'pending';
}

// --- Local durable state (outside Git) -----------------------------------------------

function ensureHome(cfg) { fs.mkdirSync(cfg.home, { recursive: true, mode: 0o700 }); }

function readState(cfg) {
  try { var v = JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8')); return (v && typeof v === 'object') ? v : {}; } catch (e) { return {}; }
}

function writeState(cfg, value) {
  ensureHome(cfg);
  var tmp = cfg.stateFile + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, cfg.stateFile);
}

// --- One poll: PRs → diffed state → Telegram notifications -------------------------

async function pollOnce(cfg, client, opts) {
  opts = opts || {};
  var st = readState(cfg);
  var pulls = await client.listPulls();
  var actions = [];
  var detailCalls = 0;
  var touched = 0;

  for (var i = 0; i < pulls.length && touched < cfg.maxPerTick; i++) {
    var pr = pulls[i];
    if (!pr || typeof pr.number !== 'number') continue;
    var key = String(pr.number);
    var prev = st[key] || null;
    var headSha = pr.head && pr.head.sha;
    var subject = 'PR-' + pr.number;
    var events = [];

    if (!prev) {
      touched++;
      if (pr.merged_at) events.push({ kind: 'PR_MERGED', fields: { result: 'دُمج مباشرة (لم يُرصد وهو مفتوحًا).' } });
      else if (pr.state === 'closed') events.push({ kind: 'PR_CLOSED', fields: { reason: 'أُغلق دون دمج (لم يُرصد وهو مفتوحًا).' } });
      else events.push({ kind: 'PR_OPENED', fields: { description: pr.title } });
    } else {
      if (pr.state === 'closed' && prev.state !== 'closed') {
        touched++;
        if (pr.merged_at) events.push({ kind: 'PR_MERGED', fields: { result: short(pr.title || '', 300) } });
        else events.push({ kind: 'PR_CLOSED', fields: { reason: short(pr.title || '', 300) } });
      } else if (pr.state === 'open' && headSha && headSha !== prev.head_sha) {
        touched++;
        events.push({ kind: 'PR_UPDATED', fields: { description: short(pr.title || '', 300) } });
      }
    }

    var reviewState = prev ? prev.review_state : undefined;
    var checksState = prev ? prev.checks_state : undefined;
    var headChanged = !prev || headSha !== prev.head_sha;
    if (pr.state === 'open' && headChanged && detailCalls < cfg.maxDetailCalls && !opts.skipDetail) {
      detailCalls++;
      try {
        var reviews = await client.listReviews(pr.number);
        var decided = reviewDecision(reviews);
        if (decided && decided !== reviewState) {
          events.push({ kind: 'PR_REVIEW', fields: { result: decided === 'APPROVED' ? 'تمت الموافقة.' : decided === 'CHANGES_REQUESTED' ? 'طُلبت تعديلات.' : decided } });
        }
        reviewState = decided;
      } catch (e) { actions.push({ action: 'review_lookup_failed', pr: pr.number, error: short(e.message, 200) }); }
      try {
        var checks = headSha ? await client.listCheckRuns(headSha) : null;
        var cdecided = checksDecision(checks);
        if (cdecided && cdecided !== checksState) {
          events.push({
            kind: 'PR_CHECKS',
            fields: { mark: cdecided === 'success' ? '✅' : cdecided === 'failure' ? '❌' : '⏳', result: cdecided === 'success' ? 'كل الاختبارات ناجحة.' : cdecided === 'failure' ? 'اختبار مهم فشل.' : 'قيد التنفيذ.' }
          });
        }
        checksState = cdecided;
      } catch (e) { actions.push({ action: 'checks_lookup_failed', pr: pr.number, error: short(e.message, 200) }); }
    }

    events.forEach(function (ev) {
      var fields = Object.assign({ subjectLabel: 'PR', number: pr.number }, ev.fields);
      var res = telegramNotify.enqueue(ev.kind, subject, fields);
      actions.push({ action: res.queued ? 'notify' : 'skip', event: ev.kind, pr: pr.number, result: res });
    });

    st[key] = {
      state: pr.state, merged: !!pr.merged_at, head_sha: headSha || (prev && prev.head_sha) || null,
      review_state: reviewState || null, checks_state: checksState || null, title: short(pr.title || '', 200), updated_at: nowIso()
    };
  }

  writeState(cfg, st);
  return { ok: true, actions: actions, prs_seen: pulls.length, touched: touched, api_calls: client.calls.length };
}

function clientFor(cfg, opts) {
  var token = readToken();
  if (!token && !(opts && opts.allowAnonymous)) throw new Error('GITHUB_TOKEN_MISSING: no MYTHOS_GITHUB_ISSUES_TOKEN / MYTHOS_GITHUB_MCP_RW_TOKEN in the environment');
  return createClient(cfg, token);
}

async function tick(opts) {
  opts = opts || {};
  var cfg = config();
  if (!cfg.enabled) return { ok: true, enabled: false, skipped: 'MYTHOS_PR_NOTIFY_ENABLED is not 1' };
  var client = clientFor(cfg, opts);
  var r = await pollOnce(cfg, client, opts);
  r.repo = cfg.repo;
  return r;
}

function status() {
  var cfg = config();
  var st = readState(cfg);
  return {
    repo: cfg.repo, enabled: cfg.enabled, token_present: !!readToken(),
    prs: Object.keys(st).map(Number).sort(function (a, b) { return a - b; }).map(function (n) { return Object.assign({ number: n }, st[String(n)]); })
  };
}

module.exports = {
  BY: BY,
  config: config,
  readToken: readToken,
  createClient: createClient,
  reviewDecision: reviewDecision,
  checksDecision: checksDecision,
  readState: readState,
  writeState: writeState,
  pollOnce: pollOnce,
  clientFor: clientFor,
  tick: tick,
  status: status
};
