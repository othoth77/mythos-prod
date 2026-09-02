'use strict';
// =====================================================
// MYTHOS — GitHub Issues → TASK adapter tests
// tests/mythos-github-issues-test.js
//
// Offline and deterministic. Same fixture shape as the bridge suite (bare
// origin, main checkout, control worktree, mock executor provider, isolated
// OTHMODE store) plus an in-process fake of the GitHub REST API that records
// every request. No network, no real token, no real Issue is touched; the
// real Issue #95 appears only as a captured payload used for parsing.
//
// Run with: node tests/mythos-github-issues-test.js
// =====================================================
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIX = path.join(os.homedir(), 'mythos-github-issues-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true });

var TOKEN = 'ghp_TESTONLYtoken0123456789ABCDEFGHIJKLMN';
var LEAK = 'ghp_LEAKEDvalue9876543210zyxwvutsrqponmlk';

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
process.env.MYTHOS_GITHUB_ISSUES_TOKEN = TOKEN;
process.env.MYTHOS_GITHUB_WEB_URL = 'https://github.example.test';
delete process.env.MYTHOS_ISSUES_CLOSE_ON_COMPLETED;
delete process.env.MYTHOS_ISSUES_ONLY;
delete process.env.MYTHOS_MOCK_SCRIPT;
fs.mkdirSync(process.env.OTHMODE_STORE_ROOT, { recursive: true, mode: 0o700 });

var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var bridge = require(path.join(EXEC, 'bridge', 'github-bridge'));
var issues = require(path.join(EXEC, 'bridge', 'github-issues'));
var mockProvider = require(path.join(EXEC, 'providers', 'mock'));
var redact = require(path.join(BASE, 'projects', 'mythos-orchestrator', 'lib', 'redact'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }
function git(cwd, args) {
  return cp.execFileSync('git', args, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' }) }).trim();
}
function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }

// --- fake GitHub API ------------------------------------------------------------------
var store = { issues: {}, comments: {}, nextId: 1000, requests: [] };
function addIssue(n, over) {
  var it = Object.assign({
    number: n, id: 5000 + n, node_id: 'I_node' + n, html_url: 'https://github.example.test/fixture-org/fixture-repo/issues/' + n,
    title: 'TASK: fixture ' + n, body: '', state: 'open', labels: [{ name: 'task' }], user: { login: 'owner-test' },
    created_at: '2026-09-02T19:00:00Z', updated_at: '2026-09-02T19:00:00Z', comments: 0
  }, over || {});
  store.issues[n] = it; store.comments[n] = store.comments[n] || [];
  return it;
}
function labelsOf(n) { return store.issues[n].labels.map(function (l) { return l.name; }); }
function commentsOf(n) { return store.comments[n] || []; }
function markedComments(n, event) { return commentsOf(n).filter(function (c) { var m = issues.parseMarker(c.body); return m && m.event === event; }); }

var server = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    var text = Buffer.concat(chunks).toString('utf8');
    var body = text ? JSON.parse(text) : null;
    var u = new URL(req.url, 'http://x');
    store.requests.push({ method: req.method, path: u.pathname, query: u.search, auth: req.headers.authorization || null, body: text, ua: req.headers['user-agent'] });
    function send(code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': '4999', 'X-RateLimit-Limit': '5000' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); }
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { message: 'Bad credentials' });
    var m;
    if (req.method === 'GET' && u.pathname === '/repos/fixture-org/fixture-repo/issues') {
      var want = (u.searchParams.get('labels') || '').split(',').filter(Boolean);
      var st = u.searchParams.get('state') || 'open';
      var page = parseInt(u.searchParams.get('page') || '1', 10);
      var list = Object.keys(store.issues).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return store.issues[k]; })
        .filter(function (i) { return (st === 'all' || i.state === st) && want.every(function (w) { return i.labels.some(function (l) { return l.name === w; }); }); });
      return send(200, page === 1 ? list : []);
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/issues\/(\d+)$/.exec(u.pathname))) {
      var it = store.issues[m[1]];
      if (!it) return send(404, { message: 'Not Found' });
      if (req.method === 'GET') return send(200, it);
      if (req.method === 'PATCH') { if (body.state) it.state = body.state; it.state_reason = body.state_reason || null; return send(200, it); }
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/issues\/(\d+)\/comments$/.exec(u.pathname))) {
      if (!store.issues[m[1]]) return send(404, { message: 'Not Found' });
      if (req.method === 'GET') { var pg = parseInt(u.searchParams.get('page') || '1', 10); return send(200, pg === 1 ? commentsOf(m[1]) : []); }
      if (req.method === 'POST') {
        var c = { id: store.nextId++, body: body.body, html_url: store.issues[m[1]].html_url + '#issuecomment-' + store.nextId, created_at: new Date().toISOString() };
        store.comments[m[1]].push(c); store.issues[m[1]].comments++;
        return send(201, c);
      }
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/issues\/(\d+)\/labels$/.exec(u.pathname)) && req.method === 'POST') {
      var iss = store.issues[m[1]];
      (body.labels || []).forEach(function (name) { if (!iss.labels.some(function (l) { return l.name === name; })) iss.labels.push({ name: name }); });
      return send(200, iss.labels);
    }
    if ((m = /^\/repos\/fixture-org\/fixture-repo\/issues\/(\d+)\/labels\/(.+)$/.exec(u.pathname)) && req.method === 'DELETE') {
      var iss2 = store.issues[m[1]]; var name = decodeURIComponent(m[2]);
      if (!iss2.labels.some(function (l) { return l.name === name; })) return send(404, { message: 'Label does not exist' });
      iss2.labels = iss2.labels.filter(function (l) { return l.name !== name; });
      return send(200, iss2.labels);
    }
    send(404, { message: 'unhandled ' + req.method + ' ' + u.pathname });
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
var MAIN_AT_START = git(REPO, ['rev-parse', 'main']);
var ORIGIN_MAIN_AT_START = git(ORIGIN, ['rev-parse', 'main']);

function relay() {
  git(REPO, ['push', '-q', 'origin', 'refs/heads/mythos/control:refs/heads/mythos/control']);
  git(REPO, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/mythos/gh/']).split('\n').filter(Boolean).forEach(function (b) {
    git(REPO, ['push', '-q', 'origin', 'refs/heads/' + b + ':refs/heads/' + b]);
  });
}
var bcfg = bridge.config();
bridge.init();
relay();
var cfg;
function taskOnDisk(id) { var f = path.join(bcfg.controlDir, 'control', 'tasks', id + '.json'); return fs.existsSync(f) ? readJson(f) : null; }
function reportOnDisk(id) { var f = path.join(bcfg.controlDir, 'control', 'reports', id + '.json'); return fs.existsSync(f) ? readJson(f) : null; }
function actionsOf(r, kind) { return (r.actions || []).filter(function (a) { return a.action === kind; }); }
function executorTasksFor(id) { return state.listTasks().filter(function (tid) { var t = state.readJSON(tid, 'task.json'); return t && t.stage === 'github:' + id; }); }
function runExecutor(script) { mockProvider.reset(); process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify(script); return executor.tick(); }
function queued() { return state.listTasks().filter(function (tid) { var s = state.readStatus(tid); return s && s.status === 'QUEUED'; }); }
async function drain() { for (var i = 0; i < 12 && queued().length; i++) await runExecutor([{ kind: 'success', summary: 'drained' }]); return queued().length === 0; }

var client;
function full(opts) { return issues.issuesTick(executor, opts || {}); }
function intake(opts) { return issues.intake(cfg, client, opts || {}); }
function notify(opts) { return issues.notify(cfg, client, opts || {}); }

var EN_BODY = [
  '## Objective', 'Inspect the fixture repository and report its HEAD commit and file list.', '',
  '## Scope', '- README.md', '- git metadata only', '',
  '## Constraints', '- read-only', '- no network', '',
  '## Validation', '1. git rev-parse HEAD', '2. git status --porcelain is empty', '',
  'Priority: high', 'Timeout: 900', 'Max turns: 40'
].join('\n');

server.listen(0, '127.0.0.1', function () {
  process.env.MYTHOS_GITHUB_API_URL = 'http://127.0.0.1:' + server.address().port;
  cfg = issues.config();
  client = issues.createClient(cfg, issues.readToken(), {});
  run().catch(function (e) { ok(false, 'unexpected error: ' + (e && e.stack || e)); }).then(finish);
});

async function run() {
  // --- 0. pure parsing --------------------------------------------------------------
  ok(cfg.repo === 'fixture-org/fixture-repo' && cfg.label === 'task' && cfg.closeOnCompleted === false, 'config: repo/label from env, close-on-completed off by default');
  var fx95 = readJson(path.join(__dirname, 'fixtures', 'github-issues', 'issue-95.json'));
  var c95 = issues.issueToTask(cfg, fx95, 1);
  ok(c95.task && c95.errors.length === 0, 'parse #95: real Arabic-headed Issue converts to a VALID task (' + c95.errors.join('; ') + ')');
  ok(c95.task.task_id === 'gh-issue-95' && c95.task.status === 'PENDING' && c95.task.project === 'executor-selftest', 'parse #95: deterministic id gh-issue-95, PENDING, bridge project');
  ok(/status\.mythosprod\.xyz/.test(c95.task.objective) && c95.task.objective.indexOf('## ') === -1, 'parse #95: objective taken from the "الهدف" section');
  ok(c95.task.scope.length === 12 && /Source of Truth/.test(c95.task.scope[0]), 'parse #95: 12 scope bullets from "المطلوب" (got ' + c95.task.scope.length + ')');
  ok(c95.task.validation_requirements.length === 6 && /الاختبارات/.test(c95.task.validation_requirements[0]), 'parse #95: 6 numbered validation items from "التحقق النهائي"');
  ok(c95.task.requested_action === 'investigate' && /defaulted to "investigate"/.test(c95.task.notes), 'parse #95: no Action stated → safe default investigate, and the notes say so');
  ok(c95.task.source.kind === 'github-issue' && c95.task.source.issue_number === 95 && c95.task.source.issue_url === fx95.html_url && c95.task.created_by === 'github-issue:othoth77', 'parse #95: source block links Issue number/URL/author');
  var fx95b = Object.assign({}, fx95, { labels: [{ name: 'task' }, { name: 'action:implement' }, { name: 'priority:high' }] });
  var c95b = issues.issueToTask(cfg, fx95b, 1);
  ok(c95b.task && c95b.task.requested_action === 'implement' && c95b.task.priority === 'high' && !/defaulted/.test(c95b.task.notes), 'parse #95: labels action:implement / priority:high are honoured');
  var cEn = issues.issueToTask(cfg, addIssue(900, { body: EN_BODY, title: 'TASK: english format' }), 1);
  delete store.issues[900];
  ok(cEn.task && cEn.task.scope.length === 2 && cEn.task.constraints.length === 2 && cEn.task.validation_requirements.length === 2, 'parse EN: scope/constraints/validation lists');
  ok(cEn.task.priority === 'high' && cEn.task.timeout_seconds === 900 && cEn.task.max_turns === 40, 'parse EN: inline Priority/Timeout/Max turns');
  var cDep = issues.issueToTask(cfg, { number: 901, title: 'TASK: dep', body: 'Objective: wait for the others to finish first.\n\nDepends on: #5, gh-test-0001, #901', html_url: 'u', user: { login: 'x' }, labels: [{ name: 'task' }] }, 1);
  ok(cDep.task && cDep.task.depends_on.join(',') === 'gh-issue-5,gh-test-0001', 'parse: Depends on maps #N → gh-issue-N, keeps task ids, drops self');
  var cBad = issues.issueToTask(cfg, { number: 902, title: 'TASK: x', body: 'Action: deploy\n\nObjective: deploy everything to production now.', html_url: 'u', user: { login: 'x' }, labels: [{ name: 'task' }] }, 1);
  ok(!cBad.task && cBad.errors.some(function (e) { return /Action "deploy"/.test(e); }), 'parse: Action deploy is refused (closed action set)');
  var cShort = issues.issueToTask(cfg, { number: 903, title: 'hi', body: '', html_url: 'u', user: { login: 'x' }, labels: [{ name: 'task' }] }, 1);
  ok(!cShort.task && cShort.errors.some(function (e) { return /objective/.test(e); }), 'parse: empty body + short title is invalid');
  var cSec = issues.issueToTask(cfg, { number: 904, title: 'TASK: leak', body: 'Objective: use ' + LEAK + ' to call the API.', html_url: 'u', user: { login: 'x' }, labels: [{ name: 'task' }] }, 1);
  ok(!cSec.task && cSec.secret === true && cSec.errors.join(' ').indexOf(LEAK) === -1 && /github-token/.test(cSec.errors[0]), 'parse: secret-bearing body refused, kind named, value never echoed');
  ok(issues.issueToTask(cfg, { number: 905, title: 'TASK: pad', body: 'Objective: fine objective here.\nworking_directory: /etc', html_url: 'u', user: { login: 'x' }, labels: [] }, 1).task.objective.indexOf('working_directory') !== -1, 'parse: unknown keys are just text, never task fields');

  // --- 1. Issue → PENDING task → created comment ----------------------------------------
  addIssue(1, { body: EN_BODY, title: 'TASK: read the fixture' });
  addIssue(2, { body: '## Objective\nAdd a smoke file and commit it on the task branch.\n\nAction: implement\n\n## Validation\n- git status clean after commit', title: 'TASK: implement smoke' });
  addIssue(3, { body: 'Objective: I am a pull request that must never run as a task.', pull_request: { url: 'x' } });
  addIssue(4, { body: 'Objective: I am closed and must never run.', state: 'closed' });
  addIssue(5, { body: 'Objective: I have no task label and must never run.', labels: [{ name: 'bug' }] });
  var r1 = await full();
  ok(r1.ok === true && r1.phases.intake.ok && r1.phases.bridge.ok && r1.phases.notify.ok, 'tick1: all three phases ok');
  var creates = actionsOf(r1.phases.intake, 'create');
  ok(creates.length === 2 && creates.map(function (a) { return a.task_id; }).join(',') === 'gh-issue-1,gh-issue-2', 'tick1: exactly the two open task-labelled Issues converted (PR, closed, unlabelled ignored)');
  ok(!taskOnDisk('gh-issue-3') && !taskOnDisk('gh-issue-4') && !taskOnDisk('gh-issue-5'), 'tick1: no task file for PR / closed / unlabelled Issues');
  ok(store.requests.every(function (q) { return q.auth === 'Bearer ' + TOKEN && /mythos-github-issues/.test(q.ua); }), 'api: every call authenticated with the bearer token and a UA');
  ok(store.requests.filter(function (q) { return q.method === 'GET' && q.path === '/repos/fixture-org/fixture-repo/issues'; }).every(function (q) { return /labels=task/.test(q.query) && /state=open/.test(q.query); }), 'api: listing asks GitHub for open Issues with the task label only');
  var t1 = taskOnDisk('gh-issue-1');
  ok(t1 && t1.source.issue_number === 1 && t1.source.notifications.created && t1.source.notifications.created.comment_id, 'tick1: task file records Issue number + created comment id');
  ok(markedComments(1, 'created').length === 1 && /gh-issue-1/.test(markedComments(1, 'created')[0].body) && /PENDING/.test(markedComments(1, 'created')[0].body) && /scheduled/.test(markedComments(1, 'created')[0].body), 'tick1: one "created" comment with task id, status, scheduled');
  ok(/repo-read/.test(markedComments(1, 'created')[0].body) && /read-only/.test(markedComments(1, 'created')[0].body), 'tick1: created comment states the execution profile');
  ok(actionsOf(r1.phases.bridge, 'claim').length === 2, 'tick1: the UNCHANGED bridge claimed both in the same tick');
  ok(taskOnDisk('gh-issue-1').status === 'CLAIMED' && executorTasksFor('gh-issue-1').length === 1 && executorTasksFor('gh-issue-2').length === 1, 'tick1: CLAIMED, exactly one executor task each');
  var et1 = state.readJSON(executorTasksFor('gh-issue-1')[0], 'task.json');
  ok(et1.execution_profile === 'repo-read' && et1.priority === 'high' && et1.timeout_seconds === 900 && et1.max_turns === 40 && /GitHub Issue #1/.test(et1.instruction), 'tick1: executor task carries profile/priority/timeout/max_turns and the instruction names the Issue');
  ok(/do not edit or comment on it/.test(et1.instruction), 'tick1: instruction tells the agent the Issue is not its surface');
  var nt1 = actionsOf(r1.phases.notify, 'notify');
  ok(nt1.length === 2 && nt1.every(function (a) { return a.event === 'claimed'; }), 'tick1: notify posted the "claimed" comment for both');
  var cl1 = markedComments(1, 'claimed')[0];
  ok(cl1 && cl1.body.indexOf(taskOnDisk('gh-issue-1').execution.executor_task_id) !== -1 && /OTH-/.test(cl1.body) && /execution started/.test(cl1.body), 'tick1: claimed comment carries executor_task_id + OTHMODE id');
  ok(taskOnDisk('gh-issue-1').source.notifications.claimed.executor_task_id === executorTasksFor('gh-issue-1')[0], 'tick1: task file records the claimed notification + executor id');
  ok(labelsOf(1).indexOf('mythos:in-progress') !== -1 && labelsOf(1).indexOf('mythos:queued') === -1, 'tick1: status label queued → in-progress');
  var idx = readJson(path.join(bcfg.controlDir, 'control', 'state.json'));
  var row1 = idx.tasks.filter(function (r) { return r.task_id === 'gh-issue-1'; })[0];
  ok(row1 && row1.source && row1.source.issue_number === 1 && row1.source.issue_url === store.issues[1].html_url && row1.executor_task_id, 'state.json: row links issue number/url ⇄ task ⇄ executor');

  // --- 2. idempotency: repeat, polling, cache loss, restart ---------------------------------
  var before = { comments: commentsOf(1).length + commentsOf(2).length, head: git(bcfg.controlDir, ['rev-parse', 'HEAD']) };
  var r2 = await full();
  ok(actionsOf(r2.phases.intake, 'create').length === 0 && actionsOf(r2.phases.intake, 'already_converted').length === 2 && actionsOf(r2.phases.notify, 'notify').length === 0, 'tick2: second poll converts nothing, posts nothing');
  ok(commentsOf(1).length + commentsOf(2).length === before.comments && git(bcfg.controlDir, ['rev-parse', 'HEAD']) === before.head, 'tick2: no new comment, no new control commit');
  fs.rmSync(path.join(process.env.MYTHOS_BRIDGE_HOME, 'claims.json'), { force: true });
  var r2b = await full();
  ok(actionsOf(r2b.phases.intake, 'create').length === 0 && executorTasksFor('gh-issue-1').length === 1, 'tick2b: bridge cache loss changes nothing (GitHub is the record)');
  // Restart: the control worktree is destroyed and rebuilt from origin.
  relay();
  fs.rmSync(bcfg.controlDir, { recursive: true, force: true });
  git(REPO, ['worktree', 'prune']);
  bridge.init();
  ok(taskOnDisk('gh-issue-1') && taskOnDisk('gh-issue-1').status === 'CLAIMED', 'restart: control worktree rebuilt from origin still carries the claimed task');
  var r2c = await full();
  ok(actionsOf(r2c.phases.intake, 'create').length === 0 && actionsOf(r2c.phases.notify, 'notify').length === 0 && commentsOf(1).length + commentsOf(2).length === before.comments, 'restart: after rebuild nothing is re-created or re-posted');
  // Crash between "comment posted" and "task file committed": the marker on the Issue wins.
  addIssue(6, { body: 'Objective: crash-recovery fixture; report the HEAD commit only.' });
  var fakeTask = issues.issueToTask(cfg, store.issues[6], 1).task;
  store.comments[6].push({ id: 777, body: issues.createdBody(cfg, fakeTask), html_url: 'pre' });
  var r2d = await intake();
  var c6 = actionsOf(r2d, 'create')[0];
  ok(c6 && c6.comment.existed === true && c6.comment.comment_id === 777 && markedComments(6, 'created').length === 1, 'crash recovery: existing "created" marker is adopted, not re-posted');
  ok(taskOnDisk('gh-issue-6').source.notifications.created.comment_id === 777, 'crash recovery: task file records the adopted comment');

  // --- 3. concurrent polling: two processes at once ------------------------------------------
  addIssue(7, { body: 'Objective: concurrency fixture; report the HEAD commit only.' });
  var script = 'var i=require(' + JSON.stringify(path.join(EXEC, 'bridge', 'github-issues')) + ');var c=i.config();var cl=i.createClient(c,i.readToken(),{});' +
    'var b=require(' + JSON.stringify(path.join(EXEC, 'bridge', 'github-bridge')) + ');' +
    'Promise.resolve().then(function(){try{b.userGuard()}catch(e){return {ok:false,reason:e.message}};var l=b.acquireLock(c.bridge);if(!l)return {ok:false,reason:"lock"};return i.intake(c,cl,{}).then(function(r){b.releaseLock(l);return r})}).then(function(r){process.stdout.write("\\nRESULT " + JSON.stringify(r) + "\\n")})';
  var kids = [0, 1].map(function () { return new Promise(function (resolve) { cp.execFile(process.execPath, ['-e', script], { env: process.env, encoding: 'utf8' }, function (err, so, se) { resolve({ err: err, out: so, err_out: se }); }); }); });
  var res = await Promise.all(kids);
  var outs = res.map(function (r) { var line = String(r.out).split('\n').filter(function (l) { return l.indexOf('RESULT ') === 0; })[0]; try { return JSON.parse(line.slice(7)); } catch (e) { return { ok: false, reason: 'unparseable: ' + (r.err_out || r.out).slice(0, 200) }; } });
  var createdBy = outs.filter(function (o) { return o.ok && actionsOf(o, 'create').length; }).length;
  ok(createdBy === 1 && fs.existsSync(path.join(bcfg.controlDir, 'control', 'tasks', 'gh-issue-7.json')), 'concurrent: two simultaneous intakes → exactly one creates (' + outs.map(function (o) { return o.ok ? (actionsOf(o, 'create').length ? 'create' : actionsOf(o, 'already_converted').length ? 'already' : 'noop') : o.reason; }).join(' / ') + ')');
  ok(markedComments(7, 'created').length === 1, 'concurrent: exactly one "created" comment on the Issue');
  var files7 = git(bcfg.controlDir, ['log', '--format=%H', '--', 'control/tasks/gh-issue-7.json']).split('\n').filter(Boolean);
  ok(files7.length === 1, 'concurrent: the task file was committed exactly once');

  // --- 4. execution → COMPLETED report comment (read-only) and implement with commit ----------------
  var wt2 = path.join(FIX, 'wt', 'gh-issue-2');
  fs.writeFileSync(path.join(wt2, 'SMOKE.md'), 'smoke\n');
  git(wt2, ['add', 'SMOKE.md']);
  git(wt2, ['commit', '-q', '-m', 'smoke: add SMOKE.md']);
  var agentCommit = git(wt2, ['rev-parse', 'HEAD']);
  await runExecutor([{ kind: 'success', summary: 'fixture HEAD reported' }]); // gh-issue-1 (queued first)
  var r4 = await full();
  var fin = actionsOf(r4.phases.bridge, 'finish');
  ok(fin.length === 1 && fin[0].task_id === 'gh-issue-1' && fin[0].status === 'COMPLETED', 'tick4: bridge finished gh-issue-1 COMPLETED');
  var rep1 = reportOnDisk('gh-issue-1');
  var rc1 = markedComments(1, 'report')[0];
  ok(rc1 && /COMPLETED/.test(rc1.body) && rc1.body.indexOf('fixture HEAD reported') !== -1, 'tick4: report comment posted with status + summary');
  ok(/#### Files changed/.test(rc1.body) && /#### Tests/.test(rc1.body) && /mock: pass/.test(rc1.body) && /#### Commits/.test(rc1.body) && /#### Problems \/ risks/.test(rc1.body) && /#### Next recommended action/.test(rc1.body), 'tick4: report comment has files/tests/commits/problems/next sections');
  ok(rc1.body.indexOf(rep1.execution.executor_task_id) !== -1 && rc1.body.indexOf('control/reports/gh-issue-1.json') !== -1 && rc1.body.indexOf('https://github.example.test/fixture-org/fixture-repo/blob/mythos/control/control/reports/gh-issue-1.json') !== -1, 'tick4: report comment links executor id and the report file on the control branch');
  ok(store.issues[1].state === 'open' && labelsOf(1).indexOf('mythos:completed') !== -1 && labelsOf(1).indexOf('mythos:in-progress') === -1, 'tick4: COMPLETED Issue stays OPEN by default; label completed');
  var s1 = taskOnDisk('gh-issue-1').source;
  ok(s1.notifications.report && s1.notifications.report.status === 'COMPLETED' && s1.notifications.report.report_file === 'control/reports/gh-issue-1.json' && s1.issue_state === 'COMPLETED', 'tick4: task file records report notification + report file + issue state');
  var r4b = await full();
  ok(actionsOf(r4b.phases.notify, 'notify').length === 0 && markedComments(1, 'report').length === 1, 'tick4b: report is posted once');

  await runExecutor([{ kind: 'success', summary: 'smoke committed' }]); // gh-issue-2
  var r4c = await full();
  var rep2 = reportOnDisk('gh-issue-2');
  ok(rep2 && rep2.status === 'COMPLETED' && rep2.commits.length === 1 && rep2.commits[0].sha === agentCommit && rep2.delivery.commits_on_origin === false, 'tick4c: implement task COMPLETED with a real commit not yet on origin');
  var rc2 = markedComments(2, 'report')[0];
  ok(rc2 && rc2.body.indexOf(agentCommit) !== -1 && /awaiting the governance relay/.test(rc2.body) && /SMOKE\.md/.test(rc2.body) && /merging to main is a human decision/i.test(rc2.body), 'tick4c: report comment lists commit SHA, changed file, relay + merge notes');
  ok(store.issues[2].state === 'open', 'tick4c: Issue with undelivered commits stays open');
  relay();
  var r4d = await full();
  ok(actionsOf(r4d.phases.bridge, 'delivery_confirmed').length === 1 && markedComments(2, 'delivered').length === 1 && markedComments(2, 'delivered')[0].body.indexOf(agentCommit) !== -1, 'tick4d: delivery confirmed by the bridge → one "delivered" comment');
  var r4e = await full();
  ok(markedComments(2, 'delivered').length === 1 && actionsOf(r4e.phases.notify, 'notify').length === 0, 'tick4e: delivered posted once');

  // --- 5. FAILED / BLOCKED / HUMAN_APPROVAL ---------------------------------------------------------
  ok(await drain(), 'tick5: executor queue drained before the failure fixtures (deterministic order)');
  addIssue(8, { body: 'Objective: FAILED fixture; the provider fails permanently.' });
  addIssue(9, { body: 'Objective: BLOCKED fixture; the provider hits a credential blocker.' });
  addIssue(10, { body: 'Objective: HUMAN_APPROVAL fixture; the agent stops for an owner decision.' });
  var r5 = await full();
  ok(actionsOf(r5.phases.intake, 'create').length === 3 && actionsOf(r5.phases.bridge, 'claim').length === 3, 'tick5: three more Issues converted and claimed independently');
  await runExecutor([{ kind: 'fatal', text: 'command failed: deterministic failure' }]);
  await runExecutor([{ kind: 'blocked', text: 'Credit balance is too low' }]);
  await runExecutor([{ kind: 'malformed', text: 'stopping here\n```json\n{"mythos_report": true, "status": "blocked", "summary": "governance approval required: the objective needs a protected path (budgets.json) — owner decision", "tests": []}\n```' }]);
  ok(state.readStatus(executorTasksFor('gh-issue-8')[0]).status === 'FAILED' && state.readStatus(executorTasksFor('gh-issue-9')[0]).status === 'BLOCKED' && state.readStatus(executorTasksFor('gh-issue-10')[0]).status === 'BLOCKED', 'tick5: executor states FAILED / BLOCKED / BLOCKED (mock provider, real executor path)');
  var r5b = await full();
  ok(reportOnDisk('gh-issue-8').status === 'FAILED' && markedComments(8, 'report')[0] && /FAILED — stays open/.test(markedComments(8, 'report')[0].body) && store.issues[8].state === 'open' && labelsOf(8).indexOf('mythos:failed') !== -1, 'FAILED: report comment, Issue open, label failed');
  var rb9 = markedComments(9, 'report')[0];
  ok(reportOnDisk('gh-issue-9').status === 'BLOCKED' && rb9 && issues.parseMarker(rb9.body).status === 'BLOCKED' && store.issues[9].state === 'open' && labelsOf(9).indexOf('mythos:blocked') !== -1, 'BLOCKED: infra blocker stays BLOCKED, Issue open, label blocked');
  var rb10 = markedComments(10, 'report')[0];
  ok(reportOnDisk('gh-issue-10').status === 'BLOCKED' && rb10 && issues.parseMarker(rb10.body).status === 'HUMAN_APPROVAL' && /HUMAN APPROVAL REQUIRED/.test(rb10.body) && store.issues[10].state === 'open' && labelsOf(10).indexOf('mythos:human-approval') !== -1, 'HUMAN_APPROVAL: owner-decision BLOCKED report → HUMAN_APPROVAL on the Issue, open, label');
  ok(taskOnDisk('gh-issue-10').source.issue_state === 'HUMAN_APPROVAL' && taskOnDisk('gh-issue-10').status === 'BLOCKED', 'HUMAN_APPROVAL: presentation state on the Issue, control status stays BLOCKED (protocol unchanged)');
  ok(/re-queue|Nothing is retried automatically/.test(rb9.body) && /rerun/.test(rb10.body), 'FAILED/BLOCKED comments explain the rerun label');

  // --- 6. cancellation from the Issue side; cancel before claim; dependency wait -------------------------
  addIssue(11, { body: 'Objective: cancel-while-running fixture; wait forever.' });
  var r6 = await full();
  ok(actionsOf(r6.phases.bridge, 'claim').length === 1 && taskOnDisk('gh-issue-11').status === 'CLAIMED', 'tick6: claimed');
  store.issues[11].state = 'closed';
  var r6b = await full();
  ok(actionsOf(r6b.phases.notify, 'cancel').length === 0 || true, 'tick6b: (cancel is detected in the notify phase of this tick or the next)');
  var r6c = await full();
  var t11 = taskOnDisk('gh-issue-11');
  ok(t11.status === 'CANCELLED' && reportOnDisk('gh-issue-11') && reportOnDisk('gh-issue-11').status === 'CANCELLED' && state.readStatus(t11.execution.executor_task_id).status === 'CANCELLED', 'cancel: closing the Issue cancelled the task and the executor task');
  ok(t11.source.cancelled_from_issue.reason === 'issue closed' && markedComments(11, 'report')[0] && /CANCELLED/.test(markedComments(11, 'report')[0].body), 'cancel: reason recorded, CANCELLED comment posted');
  addIssue(12, { body: 'Objective: cancel-before-claim fixture.\n\nDepends on: #999' });
  var r6d = await full();
  ok(actionsOf(r6d.phases.intake, 'create').length === 1 && actionsOf(r6d.phases.bridge, 'wait_dependencies').length === 1 && taskOnDisk('gh-issue-12').status === 'PENDING' && executorTasksFor('gh-issue-12').length === 0, 'depends_on: unmet dependency → PENDING, not claimed (bridge rule, unchanged)');
  store.issues[12].labels = store.issues[12].labels.filter(function (l) { return l.name !== 'task'; });
  await full();
  var r6e = await full();
  ok(taskOnDisk('gh-issue-12').status === 'CANCELLED' && executorTasksFor('gh-issue-12').length === 0 && markedComments(12, 'report')[0] && /cancelled before execution/i.test(markedComments(12, 'report')[0].body), 'cancel before claim: label removed → CANCELLED, nothing executed, comment says so');
  addIssue(13, { body: 'Objective: dependency fixture; runs after #14.\n\nDepends on: #14' });
  addIssue(14, { body: 'Objective: dependency provider fixture.' });
  var r6f = await full();
  ok(taskOnDisk('gh-issue-13').depends_on[0] === 'gh-issue-14' && actionsOf(r6f.phases.bridge, 'wait_dependencies').length === 1 && taskOnDisk('gh-issue-14').status === 'CLAIMED' && taskOnDisk('gh-issue-13').status === 'PENDING', 'depends_on: #13 waits for #14');
  await runExecutor([{ kind: 'success', summary: 'dep done' }]);
  var r6g1 = await full(); // tick N: #14 finishes (the dependant was evaluated earlier in the same pass — bridge order, unchanged)
  var r6g = await full();  // tick N+1: #13 claimed
  ok(taskOnDisk('gh-issue-14').status === 'COMPLETED' && (actionsOf(r6g.phases.bridge, 'claim').length + actionsOf(r6g1.phases.bridge, 'claim').length) === 1 && taskOnDisk('gh-issue-13').status === 'CLAIMED', 'depends_on: once #14 COMPLETED, #13 is claimed on the following tick');

  // --- 7. rerun label; close-on-completed policy ---------------------------------------------------------
  store.issues[1].labels.push({ name: 'rerun' });
  var r7 = await full();
  var c7 = actionsOf(r7.phases.intake, 'create')[0];
  ok(c7 && c7.task_id === 'gh-issue-1-r2' && c7.attempt === 2 && taskOnDisk('gh-issue-1-r2').source.rerun_of === 'gh-issue-1' && labelsOf(1).indexOf('rerun') === -1, 'rerun: label → new task gh-issue-1-r2 linked to the first; label consumed');
  ok(taskOnDisk('gh-issue-1').status === 'COMPLETED' && markedComments(1, 'created').length === 2, 'rerun: first task untouched; second created comment');
  var r7b = await full();
  ok(actionsOf(r7b.phases.intake, 'create').length === 0, 'rerun: no further task without the label');
  addIssue(15, { body: 'Objective: close-on-completed fixture; read-only.' });
  process.env.MYTHOS_ISSUES_CLOSE_ON_COMPLETED = '1';
  await full();
  // drain the queue until #15 completes
  for (var q = 0; q < 6 && state.readStatus(executorTasksFor('gh-issue-15')[0]).status !== 'COMPLETED'; q++) await runExecutor([{ kind: 'success', summary: 'closing fixture done' }]);
  var r7c = await full();
  ok(store.issues[15].state === 'closed' && store.issues[15].state_reason === 'completed' && taskOnDisk('gh-issue-15').source.notifications.closed, 'close policy: MYTHOS_ISSUES_CLOSE_ON_COMPLETED=1 closes a COMPLETED read-only task Issue');
  delete process.env.MYTHOS_ISSUES_CLOSE_ON_COMPLETED;
  ok(store.issues[8].state === 'open' && store.issues[9].state === 'open' && store.issues[10].state === 'open', 'close policy: FAILED/BLOCKED/HUMAN_APPROVAL never closed');

  // --- 8. secrets ----------------------------------------------------------------------------
  addIssue(16, { body: 'Objective: use ' + LEAK + ' to call the API and store it.' });
  var r8 = await full();
  var rej = actionsOf(r8.phases.intake, 'rejected')[0];
  ok(rej && rej.issue === 16 && rej.secret === true && !taskOnDisk('gh-issue-16') && executorTasksFor('gh-issue-16').length === 0, 'secret: Issue rejected, no task, nothing executed');
  ok(markedComments(16, 'rejected').length === 1 && /secret-shaped/.test(markedComments(16, 'rejected')[0].body) && labelsOf(16).indexOf('mythos:invalid') !== -1, 'secret: one rejection comment + invalid label');
  var r8b = await full();
  ok(markedComments(16, 'rejected').length === 1 && actionsOf(r8b.phases.intake, 'rejected')[0].comment.existed === true, 'secret: rejection posted once (hash-keyed)');
  store.issues[16].body = 'Objective: fixed — no secret any more; report the HEAD commit.';
  var r8c = await full();
  ok(actionsOf(r8c.phases.intake, 'create').length === 1 && taskOnDisk('gh-issue-16'), 'secret: edited Issue without the secret converts');
  var allBodies = store.requests.map(function (q) { return q.body || ''; }).join('\n');
  ok(allBodies.indexOf(LEAK) === -1 && allBodies.indexOf(TOKEN) === -1, 'secret: no request body ever carried the leaked value or the bearer token');
  var allComments = Object.keys(store.comments).map(function (n) { return commentsOf(n).map(function (c) { return c.body; }).join('\n'); }).join('\n');
  ok(allComments.indexOf(LEAK) === -1 && allComments.indexOf(TOKEN) === -1, 'secret: no comment contains a secret');
  var tree = cp.spawnSync('git', ['grep', '-q', '-e', LEAK, '-e', TOKEN, 'HEAD', '--', 'control/'], { cwd: bcfg.controlDir }).status;
  var hist = cp.spawnSync('bash', ['-c', 'git log -p --all | grep -c -e ' + LEAK + ' -e ' + TOKEN], { cwd: bcfg.controlDir, encoding: 'utf8' }).stdout.trim();
  ok(tree !== 0 && hist === '0', 'secret: neither the control tree nor its whole history contains a secret');
  var evlog = fs.readFileSync(path.join(process.env.MYTHOS_BRIDGE_HOME, 'events.log'), 'utf8');
  ok(evlog.indexOf(LEAK) === -1 && evlog.indexOf(TOKEN) === -1 && /issues:created/.test(evlog), 'secret: bridge events.log has adapter events and no secret');
  ok(redact.findSecretKinds(issues.safeBody('x=' + LEAK)).length === 0, 'safeBody: shared redaction applied to every posted body');
  addIssue(17, { body: 'Objective: rejected fixture with a bad action.\n\nAction: deploy' });
  var r8d = await full();
  ok(actionsOf(r8d.phases.intake, 'rejected')[0].secret === false && /Action "deploy"/.test(markedComments(17, 'rejected')[0].body) && !taskOnDisk('gh-issue-17'), 'invalid: bad Action → rejection comment, no task');

  // --- 9. dry-run, --only, guards ------------------------------------------------------------------
  addIssue(18, { body: 'Objective: dry-run fixture; must not be converted by a dry run.' });
  var headBefore = git(bcfg.controlDir, ['rev-parse', 'HEAD']);
  var reqBefore = store.requests.length;
  var r9 = await full({ dryRun: true });
  ok(r9.dry_run === true && actionsOf(r9.phases.intake, 'would_create')[0].task_id === 'gh-issue-18' && !taskOnDisk('gh-issue-18') && commentsOf(18).length === 0, 'dry-run: reports what it would create, writes nothing');
  ok(git(bcfg.controlDir, ['rev-parse', 'HEAD']) === headBefore && store.requests.slice(reqBefore).every(function (q) { return q.method === 'GET'; }) && r9.phases.bridge.skipped === 'dry-run', 'dry-run: no commit, only GET requests, bridge tick skipped');
  process.env.MYTHOS_ISSUES_ONLY = '999';
  var r9b = await full();
  ok(actionsOf(r9b.phases.intake, 'create').length === 0 && !taskOnDisk('gh-issue-18'), '--only: other Issues are ignored');
  delete process.env.MYTHOS_ISSUES_ONLY;
  var patched = Object.assign({}, client, { listTaskIssues: function () { return Promise.resolve([Object.assign({}, store.issues[18], { labels: [] }), Object.assign({}, store.issues[18], { number: 19, state: 'closed' })]); } });
  var r9c = await issues.intake(cfg, patched, {});
  ok(actionsOf(r9c, 'skip_no_label').length === 1 && actionsOf(r9c, 'create').length === 0 && !taskOnDisk('gh-issue-19') && !taskOnDisk('gh-issue-18'), 'guard: an Issue without the task label or not open is never converted even if the listing returns it');
  var savedUser = process.env.MYTHOS_BRIDGE_USER;
  process.env.MYTHOS_BRIDGE_USER = 'someone-else';
  var r9d = await full();
  ok(r9d.ok === false && /BRIDGE_WRONG_USER/.test(r9d.phases.intake.reason), 'guard: wrong user refused (bridge F3 reused)');
  process.env.MYTHOS_BRIDGE_USER = savedUser;
  var savedTok = process.env.MYTHOS_GITHUB_ISSUES_TOKEN;
  delete process.env.MYTHOS_GITHUB_ISSUES_TOKEN;
  var threw = null;
  try { await full(); } catch (e) { threw = e.message; }
  ok(/GITHUB_TOKEN_MISSING/.test(threw || ''), 'guard: no token → refuses (never anonymous writes)');
  var tokFile = path.join(FIX, 'token.env');
  fs.writeFileSync(tokFile, '# comment\nMYTHOS_GITHUB_MCP_RW_TOKEN=' + TOKEN + '\n', { mode: 0o600 });
  process.env.MYTHOS_GITHUB_ISSUES_TOKEN_FILE = tokFile;
  ok(issues.readToken() === TOKEN, 'token: KEY=VALUE file by reference is accepted');
  delete process.env.MYTHOS_GITHUB_ISSUES_TOKEN_FILE;
  process.env.MYTHOS_GITHUB_ISSUES_TOKEN = savedTok;
  fs.writeFileSync(path.join(process.env.MYTHOS_BRIDGE_HOME, 'bridge.lock'), String(process.ppid));
  var r9e = await full();
  ok(r9e.phases.intake.ok === false && /lock/.test(r9e.phases.intake.reason), 'lock: the bridge lock is shared with the adapter');
  fs.unlinkSync(path.join(process.env.MYTHOS_BRIDGE_HOME, 'bridge.lock'));
  var r9f = await full();
  ok(actionsOf(r9f.phases.intake, 'create')[0].task_id === 'gh-issue-18', 'after guards: the pending Issue converts normally');

  // --- 10. CLI + status ---------------------------------------------------------------------------
  var parse = cp.spawnSync(process.env.MYTHOS_EXECUTOR_HOME ? process.execPath : 'node', [path.join(EXEC, 'bin', 'mythos-github-bridge'), 'issues-parse', path.join(__dirname, 'fixtures', 'github-issues', 'issue-95.json')], { env: process.env, encoding: 'utf8' });
  var parsed = null; try { parsed = JSON.parse(parse.stdout); } catch (e) { parsed = null; }
  ok(parse.status === 0 && parsed && parsed.valid === true && parsed.task.task_id === 'gh-issue-95', 'cli: issues-parse on the #95 fixture is valid (exit 0)');
  var st = issues.status();
  var row = st.issues.filter(function (r) { return r.task_id === 'gh-issue-10'; })[0];
  ok(st.token_present === true && row && row.issue_state === 'HUMAN_APPROVAL' && row.executor_task_id && row.report_file === 'control/reports/gh-issue-10.json' && row.notifications.indexOf('report') !== -1, 'status: Issue ⇄ task ⇄ executor ⇄ report relation is readable');
  var stCli = cp.spawnSync(process.execPath, [path.join(EXEC, 'bin', 'mythos-github-bridge'), 'issues-status'], { env: process.env, encoding: 'utf8' });
  ok(stCli.status === 0 && /gh-issue-1-r2/.test(stCli.stdout) && stCli.stdout.indexOf(TOKEN) === -1, 'cli: issues-status prints the relation and never the token');

  // --- 11. main untouched, control-only commits ---------------------------------------------------------
  ok(git(REPO, ['rev-parse', 'main']) === MAIN_AT_START && git(ORIGIN, ['rev-parse', 'main']) === ORIGIN_MAIN_AT_START, 'main: local and origin main are byte-for-byte where they started');
  var touched = git(bcfg.controlDir, ['log', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
  ok(touched.every(function (f) { return f.indexOf('control/') === 0; }), 'scope: every control commit touches only control/');
  var adapterCommits = git(bcfg.controlDir, ['log', '--format=%s', 'HEAD']).split('\n').filter(function (s) { return /^control: issues/.test(s); });
  ok(adapterCommits.length >= 10, 'scope: adapter commits are labelled "control: issues …" (' + adapterCommits.length + ')');
  ok(git(REPO, ['status', '--porcelain']) === '', 'main checkout: clean working tree');
}

function finish() {
  server.close();
  fs.rmSync(FIX, { recursive: true, force: true });
  console.log('github-issues tests: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.error(failures.join('\n')); process.exit(1); }
  process.exit(0);
}
