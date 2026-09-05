'use strict';
// =====================================================
// MYTHOS — unified Telegram sink wiring tests
// tests/mythos-telegram-notify-integration-test.js
//
// Proves the ACTUAL wiring (not just the sink module in isolation):
//   - github-bridge.js finishTask() enqueues a TASK_COMPLETED/FAILED/BLOCKED
//     notification for a plain (n8n/planner-style) control task;
//   - a Telegram-ORIGINATED task's own terminal report does NOT also go
//     through the unified sink (bridge/telegram.js already replies in its
//     own chat — this is the anti-duplication requirement);
//   - github-issues.js enqueues TASK_CREATED on intake and TASK_STARTED on
//     claim, carrying the Issue number.
//
// Offline and deterministic; same fixture shape as
// tests/mythos-github-bridge-test.js and tests/mythos-github-issues-test.js.
// No message is actually sent (MYTHOS_TELEGRAM_NOTIFY_ENABLED enqueues into
// the local ledger only; flush() is exercised elsewhere).
// =====================================================
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIX = path.join(os.homedir(), 'mythos-tg-notify-wiring-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true });

var GH_TOKEN = 'ghp_TESTONLYtoken0123456789ABCDEFGHIJKLMN';

process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIX, 'no-advisory-credential.env');
process.env.MYTHOS_RESOURCE_GUARD = 'off';
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
delete process.env.MYTHOS_GITHUB_MCP_RW_TOKEN;
delete process.env.MYTHOS_GITHUB_ISSUES_TOKEN_FILE;
delete process.env.MYTHOS_MOCK_SCRIPT;
delete process.env.MYTHOS_ISSUES_ENABLED;
delete process.env.MYTHOS_TELEGRAM_ENABLED;
process.env.MYTHOS_TELEGRAM_NOTIFY_ENABLED = '1';
process.env.MYTHOS_TELEGRAM_BOT_TOKEN = '22222222:DDtestTOKENabcdefghijklmnopqrstuv';
process.env.MYTHOS_TELEGRAM_ALLOWED_USER_IDS = '555000111';
fs.mkdirSync(process.env.OTHMODE_STORE_ROOT, { recursive: true, mode: 0o700 });

var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var bridge = require(path.join(EXEC, 'bridge', 'github-bridge'));
var issues = require(path.join(EXEC, 'bridge', 'github-issues'));
var tn = require(path.join(EXEC, 'bridge', 'notify', 'telegram-notify'));
var mockProvider = require(path.join(EXEC, 'providers', 'mock'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }
function git(cwd, args) {
  return cp.execFileSync('git', args, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' }) }).trim();
}
function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }

// --- fixture repositories -------------------------------------------------------------
var ORIGIN = path.join(FIX, 'origin.git');
var REPO = path.join(FIX, 'repo');
var PLANNER = path.join(FIX, 'planner');
git(FIX, ['init', '--bare', '-q', '-b', 'main', ORIGIN]);
git(FIX, ['clone', '-q', ORIGIN, REPO]);
fs.writeFileSync(path.join(REPO, 'README.md'), '# fixture\n');
git(REPO, ['add', 'README.md']);
git(REPO, ['commit', '-q', '-m', 'init']);
git(REPO, ['push', '-q', 'origin', 'main']);
git(FIX, ['clone', '-q', ORIGIN, PLANNER]);

var cfg = bridge.config();
bridge.init();
function relay() {
  git(REPO, ['push', '-q', 'origin', 'refs/heads/mythos/control:refs/heads/mythos/control']);
  git(REPO, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/mythos/gh/']).split('\n').filter(Boolean).forEach(function (b) {
    git(REPO, ['push', '-q', 'origin', 'refs/heads/' + b + ':refs/heads/' + b]);
  });
}
relay();

function plannerWrite(name, content, msg) {
  git(PLANNER, ['fetch', '-q', 'origin', 'mythos/control']);
  var has = cp.spawnSync('git', ['rev-parse', '--verify', '-q', 'mythos/control'], { cwd: PLANNER }).status === 0;
  git(PLANNER, has ? ['checkout', '-q', 'mythos/control'] : ['checkout', '-q', '-b', 'mythos/control', 'origin/mythos/control']);
  if (has) git(PLANNER, ['reset', '-q', '--hard', 'origin/mythos/control']);
  var f = path.join(PLANNER, 'control', 'tasks', name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  git(PLANNER, ['add', '--', 'control/tasks/' + name]);
  git(PLANNER, ['commit', '-q', '-m', msg || ('planner: ' + name)]);
  git(PLANNER, ['push', '-q', 'origin', 'mythos/control']);
}
function mkTask(id, over) {
  var t = {
    protocol: 'mythos-control/1', task_id: id, project: 'executor-selftest',
    objective: 'Inspect the fixture repository and report its HEAD commit.',
    scope: ['README.md'], constraints: ['read-only'], priority: 'normal', requested_action: 'investigate',
    validation_requirements: ['git rev-parse HEAD'], status: 'PENDING',
    created_at: '2026-09-05T18:00:00.000Z', created_by: 'chatgpt-test'
  };
  Object.keys(over || {}).forEach(function (k) { t[k] = over[k]; });
  return t;
}
function executorTasksFor(id) { return state.listTasks().filter(function (tid) { var t = state.readJSON(tid, 'task.json'); return t && t.stage === 'github:' + id; }); }
function runExecutorTicks(n) { var p = Promise.resolve(); for (var i = 0; i < n; i++) p = p.then(function () { return executor.tick(); }); return p; }
function entryFor(taskId, kind) { return tn.readEntry(tn.config(), tn.ledgerKey(taskId, kind)); }

// --- fake GitHub API (Issues adapter) --------------------------------------------------
var store = { issues: {}, comments: {}, nextId: 1000 };
function addIssue(n, over) {
  var it = Object.assign({
    number: n, id: 5000 + n, node_id: 'I_node' + n, html_url: 'https://github.example.test/fixture-org/fixture-repo/issues/' + n,
    title: 'TASK: fixture ' + n, body: 'Objective: inspect the repository and report its HEAD commit.', state: 'open',
    labels: [{ name: 'task' }], user: { login: 'owner-test' }, created_at: '2026-09-05T18:00:00Z', updated_at: '2026-09-05T18:00:00Z', comments: 0
  }, over || {});
  store.issues[n] = it; store.comments[n] = store.comments[n] || [];
  return it;
}
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
      var page = parseInt(u.searchParams.get('page') || '1', 10);
      var list = Object.keys(store.issues).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return store.issues[k]; })
        .filter(function (i) { return i.state === 'open' && want.every(function (w) { return i.labels.some(function (l) { return l.name === w; }); }); });
      return send(200, page === 1 ? list : []);
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/issues\/(\d+)$/.exec(u.pathname))) {
      var it = store.issues[m[1]];
      if (!it) return send(404, { message: 'Not Found' });
      if (req.method === 'GET') return send(200, it);
      if (req.method === 'PATCH') { if (body.state) it.state = body.state; return send(200, it); }
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/issues\/(\d+)\/comments$/.exec(u.pathname))) {
      if (req.method === 'GET') { var pg = parseInt(u.searchParams.get('page') || '1', 10); return send(200, pg === 1 ? (store.comments[m[1]] || []) : []); }
      if (req.method === 'POST') {
        var c = { id: store.nextId++, body: body.body, html_url: '#', created_at: new Date().toISOString() };
        store.comments[m[1]].push(c);
        return send(201, c);
      }
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/issues\/(\d+)\/labels$/.exec(u.pathname)) && req.method === 'POST') {
      var iss = store.issues[m[1]];
      (body.labels || []).forEach(function (name) { if (!iss.labels.some(function (l) { return l.name === name; })) iss.labels.push({ name: name }); });
      return send(200, iss.labels);
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/issues\/(\d+)\/labels\/(.+)$/.exec(u.pathname)) && req.method === 'DELETE') {
      var iss2 = store.issues[m[1]];
      iss2.labels = iss2.labels.filter(function (l) { return l.name !== decodeURIComponent(m[2]); });
      return send(200, iss2.labels);
    }
    send(404, { message: 'unhandled ' + req.method + ' ' + u.pathname });
  });
});

function run() {
  // ================================================================
  // 1. plain (non-Telegram) task → COMPLETED → unified sink notified
  // ================================================================
  plannerWrite('gh-wire-0001.json', mkTask('gh-wire-0001'));
  bridge.tick(executor);
  mockProvider.reset();
  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'success', summary: 'wiring check one' }]);
  return runExecutorTicks(1).then(function () {
    bridge.tick(executor);
    var e = entryFor('gh-wire-0001', 'TASK_COMPLETED');
    ok(e && e.state === 'PENDING' && /wiring check one/.test(e.message), 'wiring: a plain task\'s COMPLETED report enqueues a TASK_COMPLETED notification with the real summary');

    // ================================================================
    // 2. Telegram-originated task → COMPLETED → NOT re-notified by the unified sink
    // ================================================================
    plannerWrite('gh-wire-0002.json', mkTask('gh-wire-0002', { source: { kind: 'telegram', update_id: 42, chat_id: 1, user_id: 1, notifications: {}, events: [] } }));
    bridge.tick(executor);
    mockProvider.reset();
    process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'success', summary: 'wiring check two' }]);
    return runExecutorTicks(1);
  }).then(function () {
    bridge.tick(executor);
    var e2 = entryFor('gh-wire-0002', 'TASK_COMPLETED');
    ok(e2 === null, 'wiring: a Telegram-originated task\'s own report is never duplicated onto the unified sink (bridge/telegram.js already replies in its chat)');

    // ================================================================
    // 3. GitHub Issues adapter: created + claimed
    // ================================================================
    return new Promise(function (resolve) {
      ghServer.listen(0, '127.0.0.1', function () {
        process.env.MYTHOS_GITHUB_API_URL = 'http://127.0.0.1:' + ghServer.address().port;
        addIssue(301);
        issues.issuesTick(executor, {}).then(function (r1) {
          ok(r1.ok === true, 'issues: tick ok');
          var created = entryFor('gh-issue-301', 'TASK_CREATED');
          ok(created && created.state === 'PENDING' && created.message.indexOf('#301') !== -1, 'issues: intake enqueues TASK_CREATED carrying the Issue number');
          var started = entryFor('gh-issue-301', 'TASK_STARTED');
          ok(started && started.message.indexOf('#301') !== -1, 'issues: the same tick\'s claim enqueues TASK_STARTED (bridge tick runs inside issuesTick)');
          resolve();
        });
      });
    });
  });
}

run().then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  ghServer.close();
  fs.rmSync(FIX, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}, function (e) {
  console.error('FATAL', e && e.stack || e);
  ghServer.close();
  process.exit(1);
});
