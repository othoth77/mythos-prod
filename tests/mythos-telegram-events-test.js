'use strict';
// =====================================================
// MYTHOS — unified Telegram event notifications (gh-issue-187)
// tests/mythos-telegram-events-test.js
//
// Offline and deterministic. Same fixture shape as the Issues and Telegram
// channel suites (bare origin, main checkout, control worktree, mock
// executor provider, isolated OTHMODE store) plus TWO in-process fakes: the
// GitHub REST API (Issues + pull requests) and the Telegram Bot API. No
// network, no real token, no real message.
//
// Sections:
//   1. unified formatter + internal-id / secret stripping (pure)
//   2. deduplication (same event key never sent twice)
//   3. rate limiting (routine events throttled; critical events never are)
//   4. GitHub Issue task lifecycle -> Telegram (created/claimed/completed/
//      failed/blocked/human_approval), end to end through issuesTick()
//   5. pull-request lifecycle -> Telegram (opened/review/checks/merged/
//      closed_without_merge/conflict)
//   6. git/governance/bridge failure -> Telegram (gov-notify tailing the
//      shared events.log), deduplicated by (event, reason)
//   7. disabled by default; WhatsApp and the existing per-chat Telegram
//      lifecycle replies are unaffected
//
// Run with: node tests/mythos-telegram-events-test.js
// =====================================================
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIX = path.join(os.homedir(), 'mythos-telegram-events-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true });

var GH_TOKEN = 'ghp_TESTONLYtoken0123456789ABCDEFGHIJKLMN';
var TG_TOKEN = '123456789:AAtestTOKENabcdefghijklmnopqrstuvwxy';
var OWNER = 111222333;

process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIX, 'no-advisory-credential.env');
process.env.MYTHOS_BRIDGE_PROJECT = 'executor-selftest';
process.env.MYTHOS_BRIDGE_REPO = path.join(FIX, 'repo');
process.env.MYTHOS_BRIDGE_CONTROL_DIR = path.join(FIX, 'control');
process.env.MYTHOS_BRIDGE_TASK_WORKTREES = path.join(FIX, 'wt');
process.env.MYTHOS_BRIDGE_HOME = path.join(FIX, 'home', 'bridge');
process.env.MYTHOS_BRIDGE_PROVIDER = 'mock';
process.env.MYTHOS_BRIDGE_USER = os.userInfo().username;
process.env.OTHMODE_STORE_ROOT = path.join(FIX, 'othstore');
process.env.MYTHOS_ISSUES_REPO = 'fixture-org/fixture-repo';
process.env.MYTHOS_GITHUB_ISSUES_TOKEN = GH_TOKEN;
process.env.MYTHOS_GITHUB_WEB_URL = 'https://github.example.test';
delete process.env.MYTHOS_GITHUB_MCP_RW_TOKEN;
delete process.env.MYTHOS_GITHUB_ISSUES_TOKEN_FILE;
delete process.env.MYTHOS_ISSUES_CLOSE_ON_COMPLETED;
delete process.env.MYTHOS_ISSUES_ONLY;
delete process.env.MYTHOS_MOCK_SCRIPT;
delete process.env.MYTHOS_TELEGRAM_ALLOWED_ACTIONS;
delete process.env.MYTHOS_TELEGRAM_DEFAULT_ACTION;
// Telegram (unified notifier) disabled until section 4: proves the default
// posture first (section 7 checks this explicitly too).
delete process.env.MYTHOS_TELEGRAM_ENABLED;
delete process.env.MYTHOS_TELEGRAM_BOT_TOKEN;
delete process.env.MYTHOS_TELEGRAM_ALLOWED_USER_IDS;
delete process.env.MYTHOS_PR_WATCH_ENABLED;
fs.mkdirSync(process.env.OTHMODE_STORE_ROOT, { recursive: true, mode: 0o700 });

var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var bridge = require(path.join(EXEC, 'bridge', 'github-bridge'));
var issues = require(path.join(EXEC, 'bridge', 'github-issues'));
var telegram = require(path.join(EXEC, 'bridge', 'telegram'));
var telegramEvents = require(path.join(EXEC, 'bridge', 'notify', 'telegram-events'));
var prWatch = require(path.join(EXEC, 'bridge', 'pr-watch'));
var govNotify = require(path.join(EXEC, 'bridge', 'gov-notify'));
var mockProvider = require(path.join(EXEC, 'providers', 'mock'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }
function git(cwd, args) {
  return cp.execFileSync('git', args, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' }) }).trim();
}
function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// --- fake GitHub REST API (Issues + pull requests) --------------------------------------
var gh = { issues: {}, comments: {}, pulls: {}, reviews: {}, statuses: {}, nextId: 1000 };
function addIssue(n, over) {
  var it = Object.assign({
    number: n, id: 5000 + n, html_url: 'https://github.example.test/fixture-org/fixture-repo/issues/' + n,
    title: 'TASK: fixture ' + n, body: '', state: 'open', labels: [{ name: 'task' }], user: { login: 'owner-test' },
    created_at: '2026-09-05T09:00:00Z', updated_at: '2026-09-05T09:00:00Z', comments: 0
  }, over || {});
  gh.issues[n] = it; gh.comments[n] = gh.comments[n] || [];
  return it;
}
function addPull(n, over) {
  var pr = Object.assign({
    number: n, title: 'PR fixture ' + n, state: 'open', draft: false, merged_at: null,
    mergeable_state: 'clean', head: { sha: 'sha' + n + '-1' }, updated_at: '2026-09-05T09:00:00Z'
  }, over || {});
  gh.pulls[n] = pr; gh.reviews[n] = gh.reviews[n] || [];
  return pr;
}
function setStatus(sha, state, count) { gh.statuses[sha] = { state: state, total_count: count === undefined ? 1 : count }; }

var ghServer = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    var text = Buffer.concat(chunks).toString('utf8');
    var body = text ? JSON.parse(text) : null;
    var u = new URL(req.url, 'http://x');
    function send(code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': '4999', 'X-RateLimit-Limit': '5000' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); }
    if (req.headers.authorization !== 'Bearer ' + GH_TOKEN) return send(401, { message: 'Bad credentials' });
    var m;
    if (req.method === 'GET' && u.pathname === '/repos/fixture-org/fixture-repo/issues') {
      var want = (u.searchParams.get('labels') || '').split(',').filter(Boolean);
      var st = u.searchParams.get('state') || 'open';
      var page = parseInt(u.searchParams.get('page') || '1', 10);
      var list = Object.keys(gh.issues).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return gh.issues[k]; })
        .filter(function (i) { return (st === 'all' || i.state === st) && want.every(function (w) { return i.labels.some(function (l) { return l.name === w; }); }); });
      return send(200, page === 1 ? list : []);
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/issues\/(\d+)$/.exec(u.pathname))) {
      var it = gh.issues[m[1]];
      if (!it) return send(404, { message: 'Not Found' });
      if (req.method === 'GET') return send(200, it);
      if (req.method === 'PATCH') { if (body.state) it.state = body.state; it.state_reason = body.state_reason || null; return send(200, it); }
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/issues\/(\d+)\/comments$/.exec(u.pathname))) {
      if (!gh.issues[m[1]]) return send(404, { message: 'Not Found' });
      if (req.method === 'GET') { var pg = parseInt(u.searchParams.get('page') || '1', 10); return send(200, pg === 1 ? (gh.comments[m[1]] || []) : []); }
      if (req.method === 'POST') {
        var c = { id: gh.nextId++, body: body.body, html_url: gh.issues[m[1]].html_url + '#issuecomment-' + gh.nextId, created_at: new Date().toISOString() };
        gh.comments[m[1]].push(c); gh.issues[m[1]].comments++;
        return send(201, c);
      }
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/issues\/(\d+)\/labels$/.exec(u.pathname)) && req.method === 'POST') {
      var iss = gh.issues[m[1]];
      (body.labels || []).forEach(function (name) { if (!iss.labels.some(function (l) { return l.name === name; })) iss.labels.push({ name: name }); });
      return send(200, iss.labels);
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/issues\/(\d+)\/labels\/(.+)$/.exec(u.pathname)) && req.method === 'DELETE') {
      var iss2 = gh.issues[m[1]]; var name = decodeURIComponent(m[2]);
      if (!iss2.labels.some(function (l) { return l.name === name; })) return send(404, { message: 'Label does not exist' });
      iss2.labels = iss2.labels.filter(function (l) { return l.name !== name; });
      return send(200, iss2.labels);
    }
    if (req.method === 'GET' && u.pathname === '/repos/fixture-org/fixture-repo/pulls') {
      var plist = Object.keys(gh.pulls).map(Number).sort(function (a, b) { return b - a; }).map(function (k) { return gh.pulls[k]; });
      var pg2 = parseInt(u.searchParams.get('page') || '1', 10);
      return send(200, pg2 === 1 ? plist : []);
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/pulls\/(\d+)$/.exec(u.pathname)) && req.method === 'GET') {
      var pr = gh.pulls[m[1]];
      return pr ? send(200, pr) : send(404, { message: 'Not Found' });
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/pulls\/(\d+)\/reviews$/.exec(u.pathname)) && req.method === 'GET') {
      var pg3 = parseInt(u.searchParams.get('page') || '1', 10);
      return send(200, pg3 === 1 ? (gh.reviews[m[1]] || []) : []);
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/commits\/([^/]+)\/status$/.exec(u.pathname)) && req.method === 'GET') {
      var s = gh.statuses[m[1]] || { state: 'pending', total_count: 0 };
      return send(200, s);
    }
    send(404, { message: 'unhandled ' + req.method + ' ' + u.pathname });
  });
});

// --- fake Telegram Bot API ---------------------------------------------------------------
var tg = { sent: [], failSend: false };
function sentTexts() { return tg.sent.map(function (m) { return m.text; }); }
var tgServer = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    var text = Buffer.concat(chunks).toString('utf8');
    var body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
    var u = new URL(req.url, 'http://x');
    function send(code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
    var m = /^\/bot([^/]+)\/(\w+)$/.exec(u.pathname);
    if (!m) return send(404, { ok: false, error_code: 404, description: 'Not Found' });
    if (m[1] !== TG_TOKEN) return send(401, { ok: false, error_code: 401, description: 'Unauthorized' });
    if (m[2] === 'getMe') return send(200, { ok: true, result: { id: 1, is_bot: true, username: 'fixture_bot' } });
    if (m[2] === 'sendMessage') {
      if (tg.failSend) return send(500, { ok: false, error_code: 500, description: 'fixture outage' });
      var msg = { message_id: 9000 + tg.sent.length, chat_id: body.chat_id, text: body.text };
      tg.sent.push(msg);
      return send(200, { ok: true, result: msg });
    }
    send(404, { ok: false, error_code: 404, description: 'unhandled ' + m[2] });
  });
});

// --- fixture repositories ---------------------------------------------------------------
var ORIGIN = path.join(FIX, 'origin.git');
var REPO = path.join(FIX, 'repo');
git(FIX, ['init', '--bare', '-q', '-b', 'main', ORIGIN]);
git(FIX, ['clone', '-q', ORIGIN, REPO]);
fs.writeFileSync(path.join(REPO, 'README.md'), '# fixture\n');
git(REPO, ['add', 'README.md']);
git(REPO, ['commit', '-q', '-m', 'init']);
git(REPO, ['push', '-q', 'origin', 'main']);

function relay() {
  git(REPO, ['push', '-q', 'origin', 'refs/heads/mythos/control:refs/heads/mythos/control']);
  git(REPO, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/mythos/gh/']).split('\n').filter(Boolean).forEach(function (b) {
    git(REPO, ['push', '-q', 'origin', 'refs/heads/' + b + ':refs/heads/' + b]);
  });
}
bridge.init();
relay();

function queued() { return state.listTasks().filter(function (tid) { var s = state.readStatus(tid); return s && s.status === 'QUEUED'; }); }
async function drain() { for (var i = 0; i < 12 && queued().length; i++) await runExecutor([{ kind: 'success', summary: 'drained' }]); return queued().length === 0; }
function runExecutor(script) { mockProvider.reset(); process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify(script); return executor.tick(); }

var icfg, iclient;
function issuesFull(opts) { return issues.issuesTick(executor, opts || {}); }

async function run() {
  // --- 1. unified formatter + stripping (pure) -------------------------------------
  var txt = telegramEvents.formatEvent({ category: 'task', event: 'completed', id: '#42', status: 'COMPLETED', title: 'did the thing', result: 'tests: 3/3', model: 'claude-haiku-4-5', guard: true });
  ok(txt.indexOf('MYTHOS TASK: completed #42 (COMPLETED)') === 0, 'formatEvent: unified header');
  ok(txt.indexOf('did the thing') !== -1, 'formatEvent: title included');
  ok(txt.indexOf('result: tests: 3/3') !== -1, 'formatEvent: result included');
  ok(txt.indexOf('model claude-haiku-4-5') !== -1, 'formatEvent: model included');
  ok(txt.indexOf('guard: MYTHOS protection/monitoring active') !== -1, 'formatEvent: generic guard line, no OTHMODE wording');
  ok(txt.toUpperCase().indexOf('OTHMODE') === -1, 'formatEvent: OTHMODE never named');

  var dirty = telegramEvents.stripInternal('see t-20260905103610-6n12xs and OTH-2026-00172 and x-mtnr1kuq at /home/deploy/mythos-ai-executor/secrets/telegram-bot.env');
  ok(dirty.indexOf('t-20260905103610-6n12xs') === -1, 'stripInternal: executor task id removed');
  ok(dirty.indexOf('OTH-2026-00172') === -1, 'stripInternal: OTHMODE numeric id removed');
  ok(dirty.indexOf('x-mtnr1kuq') === -1, 'stripInternal: execution id removed');
  ok(dirty.indexOf('/home/deploy') === -1, 'stripInternal: filesystem path removed');

  // --- enable the channel for the rest of the suite ---------------------------------
  await new Promise(function (resolve) { ghServer.listen(0, '127.0.0.1', resolve); });
  await new Promise(function (resolve) { tgServer.listen(0, '127.0.0.1', resolve); });
  process.env.MYTHOS_GITHUB_API_URL = 'http://127.0.0.1:' + ghServer.address().port;
  process.env.MYTHOS_TELEGRAM_API_BASE = 'http://127.0.0.1:' + tgServer.address().port;
  process.env.MYTHOS_TELEGRAM_ENABLED = '1';
  process.env.MYTHOS_TELEGRAM_BOT_TOKEN = TG_TOKEN;
  process.env.MYTHOS_TELEGRAM_ALLOWED_USER_IDS = String(OWNER);
  icfg = issues.config();
  iclient = issues.createClient(icfg, issues.readToken(), {});

  // --- 2. deduplication ---------------------------------------------------------------
  var before = tg.sent.length;
  var r1 = await telegramEvents.notifyEvent({ category: 'git', event: 'bridge_failure', key: 'dedup-test-1', title: 'first' });
  ok(r1.sent === true, 'dedup: first send delivered');
  var r2 = await telegramEvents.notifyEvent({ category: 'git', event: 'bridge_failure', key: 'dedup-test-1', title: 'second attempt, same key' });
  ok(r2.sent === false && r2.reason === 'duplicate', 'dedup: identical key is never sent twice');
  ok(tg.sent.length === before + 1, 'dedup: exactly one message left the fixture');

  // --- 3. rate limiting -----------------------------------------------------------------
  process.env.MYTHOS_TELEGRAM_NOTIFY_RATE_MAX = '2';
  process.env.MYTHOS_TELEGRAM_NOTIFY_RATE_WINDOW_SECONDS = '60';
  var rateBase = tg.sent.length;
  var a1 = await telegramEvents.notifyEvent({ category: 'task', event: 'claimed', key: 'rate-a' });
  var a2 = await telegramEvents.notifyEvent({ category: 'task', event: 'claimed', key: 'rate-b' });
  var a3 = await telegramEvents.notifyEvent({ category: 'task', event: 'claimed', key: 'rate-c' });
  ok(a1.sent && a2.sent, 'rate limit: first two routine events within the cap are sent');
  ok(a3.sent === false && a3.reason === 'rate_limited', 'rate limit: the third routine event is suppressed');
  ok(tg.sent.length === rateBase + 2, 'rate limit: exactly two messages left the fixture');
  var crit = await telegramEvents.notifyEvent({ category: 'git', event: 'governance_blocker', key: 'rate-critical-1', title: 'must not be hidden' });
  ok(crit.sent === true, 'rate limit: a critical event bypasses the limiter even when the window is full');
  delete process.env.MYTHOS_TELEGRAM_NOTIFY_RATE_MAX;
  delete process.env.MYTHOS_TELEGRAM_NOTIFY_RATE_WINDOW_SECONDS;

  // --- secret redaction (belt-and-suspenders on top of stripInternal) ------------------
  var secretBefore = tg.sent.length;
  await telegramEvents.notifyEvent({ category: 'task', event: 'completed', key: 'secret-test-1', title: 'token AKIAABCDEFGHIJKLMNOP leaked in a report' });
  var lastText = tg.sent[tg.sent.length - 1] && tg.sent[tg.sent.length - 1].text;
  ok(tg.sent.length === secretBefore + 1, 'redaction: event still delivered (redacted, not dropped)');
  ok(lastText && lastText.indexOf('AKIAABCDEFGHIJKLMNOP') === -1, 'redaction: AWS-shaped secret never reaches the fixture');

  // --- 4. GitHub Issue task lifecycle -> Telegram, end to end --------------------------
  var EN_BODY = ['## Objective', 'Inspect the fixture repository and report its HEAD commit.', '', 'Priority: high'].join('\n');
  addIssue(801, { body: EN_BODY });
  var r4a = await issuesFull({});
  ok(r4a.ok, 'task lifecycle: issuesTick (created) ok');
  var createdMsgs = sentTexts().filter(function (t) { return /^MYTHOS TASK: created #801/.test(t); });
  ok(createdMsgs.length === 1, 'task lifecycle: exactly one "created" Telegram notification for #801');

  await drain();
  var r4b = await issuesFull({});
  ok(r4b.ok, 'task lifecycle: issuesTick (claimed/report) ok');
  var claimedMsgs = sentTexts().filter(function (t) { return /^MYTHOS TASK: claimed #801/.test(t); });
  ok(claimedMsgs.length === 1, 'task lifecycle: exactly one "claimed" Telegram notification');
  ok(claimedMsgs[0].indexOf('guard: MYTHOS protection/monitoring active') !== -1, 'task lifecycle: claimed message carries the generic guard line');
  var reportMsgs = sentTexts().filter(function (t) { return /^MYTHOS TASK: (completed|blocked|failed) #801/.test(t); });
  ok(reportMsgs.length === 1, 'task lifecycle: exactly one terminal Telegram notification');
  ok(!/t-\d{8,}-[a-z0-9]+/.test(reportMsgs[0]), 'task lifecycle: no executor task id in the Telegram text');
  ok(!/OTH-\d{4}-\d+/.test(reportMsgs[0]), 'task lifecycle: no OTHMODE id in the Telegram text');
  ok(!/\/home\//.test(reportMsgs[0]), 'task lifecycle: no filesystem path in the Telegram text');

  // A repeated tick (nothing changed) must not resend anything already sent.
  var beforeRepeat = tg.sent.length;
  await issuesFull({});
  ok(tg.sent.length === beforeRepeat, 'task lifecycle: an unchanged re-tick sends nothing new');

  // --- a FAILED/BLOCKED task is always notified (critical) even under a full rate window --
  // The window already holds several non-critical sends from the steps
  // above, so max:1 guarantees it reads as full for what follows.
  process.env.MYTHOS_TELEGRAM_NOTIFY_RATE_MAX = '1';
  process.env.MYTHOS_TELEGRAM_NOTIFY_RATE_WINDOW_SECONDS = '60';
  var modelPolicy = require(path.join(EXEC, 'lib', 'model-policy'));
  var f51 = modelPolicy.DEFAULT_LOADED.policy.catalog['fable-5.1'];
  var savedEnabled = f51.enabled;
  f51.enabled = false;
  addIssue(802, { body: '## Objective\nSecond fixture task.\n\n## Model\nFable 5.1\n\n## Action\nimplement\n' });
  var r4c = await issuesFull({});
  f51.enabled = savedEnabled;
  ok(r4c.ok, 'blocker visibility: issuesTick (#802, model unavailable) ok');
  ok(sentTexts().some(function (t) { return /^MYTHOS TASK: blocked #802/.test(t); }), 'blocker visibility: a BLOCKED task is notified even with the rate window full');
  delete process.env.MYTHOS_TELEGRAM_NOTIFY_RATE_MAX;
  delete process.env.MYTHOS_TELEGRAM_NOTIFY_RATE_WINDOW_SECONDS;

  // --- 5. pull-request lifecycle --------------------------------------------------------
  process.env.MYTHOS_PR_WATCH_ENABLED = '1';
  addPull(1, { title: 'Add feature' });
  var prClient = prWatch.clientFor({});
  var p1 = await prWatch.tick(prClient, {});
  ok(p1.ok, 'pr lifecycle: first tick ok');
  ok(sentTexts().some(function (t) { return /^MYTHOS PR: opened #1/.test(t); }), 'pr lifecycle: opened notified');

  gh.reviews[1].push({ id: 501, state: 'APPROVED', user: { login: 'reviewer-a' } });
  gh.pulls[1].updated_at = '2026-09-05T09:05:00Z';
  var p2 = await prWatch.tick(prClient, {});
  ok(p2.ok, 'pr lifecycle: review tick ok');
  ok(sentTexts().some(function (t) { return /^MYTHOS PR: review #1/.test(t) && t.indexOf('approved') !== -1; }), 'pr lifecycle: approval notified');

  setStatus('sha1-1', 'failure', 3);
  gh.pulls[1].updated_at = '2026-09-05T09:06:00Z';
  var p3 = await prWatch.tick(prClient, {});
  ok(sentTexts().some(function (t) { return /^MYTHOS PR: checks_failed #1/.test(t); }), 'pr lifecycle: failing checks notified as checks_failed');

  gh.pulls[1].mergeable_state = 'dirty';
  gh.pulls[1].updated_at = '2026-09-05T09:07:00Z';
  var p4 = await prWatch.tick(prClient, {});
  ok(sentTexts().some(function (t) { return /^MYTHOS PR: conflict #1/.test(t); }), 'pr lifecycle: merge conflict notified');

  gh.pulls[1].mergeable_state = 'clean';
  gh.pulls[1].merged_at = '2026-09-05T09:08:00Z';
  gh.pulls[1].state = 'closed';
  gh.pulls[1].updated_at = '2026-09-05T09:08:01Z';
  var p5 = await prWatch.tick(prClient, {});
  ok(sentTexts().some(function (t) { return /^MYTHOS PR: merged #1/.test(t); }), 'pr lifecycle: merged notified');

  addPull(2, { title: 'Dead-end branch' });
  var p6 = await prWatch.tick(prClient, {});
  ok(sentTexts().some(function (t) { return /^MYTHOS PR: opened #2/.test(t); }), 'pr lifecycle: second PR opened notified independently');
  gh.pulls[2].state = 'closed';
  gh.pulls[2].updated_at = '2026-09-05T09:09:00Z';
  var p7 = await prWatch.tick(prClient, {});
  ok(sentTexts().some(function (t) { return /^MYTHOS PR: closed_without_merge #2/.test(t); }), 'pr lifecycle: closed without merge notified');

  var prStatus = prWatch.status();
  ok(prStatus.tracked_prs === 2, 'pr lifecycle: status tracks both pull requests');

  // --- 6. git/governance/bridge failure -> Telegram (gov-notify) -----------------------
  var gcfg = govNotify.config();
  fs.mkdirSync(path.dirname(gcfg.logFile), { recursive: true });
  function appendLog(entry) { fs.appendFileSync(gcfg.logFile, JSON.stringify(Object.assign({ ts: new Date().toISOString() }, entry)) + '\n'); }

  appendLog({ bridge: 'blocked_preflight', reason: 'DENIED: protected path' });
  appendLog({ bridge: 'telegram:phase_error', error: 'must never trigger gov-notify (excluded namespace)' });
  var g1 = await govNotify.tick({});
  ok(g1.ok, 'gov-notify: first tick ok');
  ok(sentTexts().some(function (t) { return /^MYTHOS SYSTEM: governance_blocker/.test(t) && t.indexOf('protected path') !== -1; }), 'gov-notify: governance blocker notified');
  ok(!sentTexts().some(function (t) { return t.indexOf('must never trigger gov-notify') !== -1; }), 'gov-notify: telegram-namespace log lines are never notified (no feedback loop)');

  var beforeRepeatGov = tg.sent.length;
  appendLog({ bridge: 'blocked_preflight', reason: 'DENIED: protected path' }); // identical reason, new line
  var g2 = await govNotify.tick({});
  ok(tg.sent.length === beforeRepeatGov, 'gov-notify: an identical (event, reason) is deduplicated, not resent');

  appendLog({ bridge: 'lease_expired', task_id: 'gh-issue-999', reason: 'claim lease overrun' });
  var g3 = await govNotify.tick({});
  ok(sentTexts().some(function (t) { return /^MYTHOS SYSTEM: bridge_failure/.test(t) && t.indexOf('claim lease overrun') !== -1; }), 'gov-notify: a distinct bridge failure is still notified');

  var beforeUpToDate = tg.sent.length;
  var g4 = await govNotify.tick({});
  ok(g4.ok, 'gov-notify: a tick with nothing new to scan still returns ok');
  ok(tg.sent.length === beforeUpToDate, 'gov-notify: nothing new in the log -> nothing sent');
  // A clean run (no notification of its own) does report up_to_date.
  var g5 = await govNotify.tick({});
  ok((g5.actions || []).some(function (a) { return a.action === 'up_to_date'; }), 'gov-notify: reports up_to_date once its own prior tick has nothing left to notify');

  // --- 7. disabled by default; existing channels unaffected ----------------------------
  delete process.env.MYTHOS_TELEGRAM_ENABLED;
  var describeOff = telegramEvents.describe();
  ok(describeOff.enabled === false, 'disabled by default: describe() reports enabled:false once MYTHOS_TELEGRAM_ENABLED is unset');
  var r7 = await telegramEvents.notifyEvent({ category: 'git', event: 'bridge_failure', key: 'should-not-send' });
  ok(r7.sent === false && r7.reason === 'disabled', 'disabled by default: notifyEvent is a strict no-op when the channel is off');
  process.env.MYTHOS_TELEGRAM_ENABLED = '1'; // restore for describe() below

  var describeOn = telegramEvents.describe();
  ok(describeOn.home.indexOf('secret') === -1 && JSON.stringify(describeOn).indexOf(TG_TOKEN) === -1, 'security: describe() never leaks the bot token');
}

function finish() {
  ghServer.close(); tgServer.close();
  console.log((failed === 0 ? '' : failures.join('\n') + '\n') + 'telegram-events tests: ' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed === 0 ? 0 : 1;
}

run().catch(function (e) { ok(false, 'unexpected error: ' + (e && e.stack || e)); }).then(finish);
