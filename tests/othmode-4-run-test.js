'use strict';
// =====================================================
// OTHMODE V2 — command runs (Command → Task → Executor → Provider → Result)
// tests/othmode-4-run-test.js
//
// Deterministic and offline: the executor is a local stub HTTP server, the
// command library is a stub db, the OTHMODE store and the executor task
// directory are fixtures under $HOME (never /tmp, never production paths).
//
// Run with: node tests/othmode-4-run-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');

var BASE = path.join(__dirname, '..');
var FIX = fs.mkdtempSync(path.join(os.homedir(), '.othmode-4-run-'));
var STORE = path.join(FIX, 'store');
var TASKS = path.join(FIX, 'tasks');
var TOKEN_FILE = path.join(FIX, 'executor.env');
fs.mkdirSync(STORE, { mode: 448 });
fs.mkdirSync(TASKS, { recursive: true });
fs.writeFileSync(TOKEN_FILE, 'MYTHOS_EXECUTOR_TOKEN=test-token-not-a-secret\n', { mode: 384 });

// Pin every production-default sink BEFORE requiring modules.
process.env.OTHMODE_STORE_ROOT = STORE;
process.env.OTHMODE_EXECUTOR_TASKS_DIR = TASKS;
process.env.OTHMODE_EXECUTOR_TOKEN_FILE = TOKEN_FILE;
process.env.OTHMODE_EXECUTOR_PROJECT = 'mythos-prod';

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function section(t) { console.log('\n§ ' + t); }
function cleanup() { try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

var run = require(path.join(BASE, 'projects', 'command-center', 'reference', 'othmode', 'run.js'));
var routesMod = require(path.join(BASE, 'projects', 'command-center', 'reference', 'othmode', 'routes.js'));
var history = require(path.join(BASE, 'projects', 'command-center', 'reference', 'othmode', 'history.js'));

// ── stub executor ───────────────────────────────────────────────────────
var seen = { route: [], tasks: [], auth: [] };
var stub = { routeStatus: 200, routeBody: { action: 'route', agent: 'free-llm-pool', provider: 'free-llm-pool', authority: false }, taskStatus: 201 };
var counter = 0;
var server = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    seen.auth.push(req.headers.authorization || null);
    var body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    if (req.url === '/route') {
      seen.route.push(body);
      res.writeHead(stub.routeStatus, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(stub.routeBody));
    }
    if (req.url === '/tasks') {
      seen.tasks.push(body);
      if (stub.taskStatus !== 201) { res.writeHead(stub.taskStatus, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'refused by stub' })); }
      var id = 't-2026091700000' + (counter++) + '-abcdef';
      fs.mkdirSync(path.join(TASKS, id), { recursive: true });
      fs.writeFileSync(path.join(TASKS, id, 'status.json'), JSON.stringify({ task_id: id, status: 'QUEUED', provider: body.provider, created_at: '2026-09-17T10:00:00.000Z', retry_count: 0 }));
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ task_id: id, status: 'QUEUED' }));
    }
    res.writeHead(404); res.end('{}');
  });
});

// ── stub command library ────────────────────────────────────────────────
var COMMANDS = {
  'audit-readme': { id: 7, slug: 'audit-readme', title: 'Audit README', body: 'Review the README of {{project}} and list gaps.', variables: [{ name: 'project' }], safety_level: 'READ_ONLY', status: 'ACTIVE', project_slug: 'mythos-prod' },
  'plain': { id: 8, slug: 'plain', title: 'Plain', body: 'Say hello.', variables: [], safety_level: 'SAFE', status: 'ACTIVE', project_slug: null },
  'dangerous': { id: 9, slug: 'dangerous', title: 'Wipe', body: 'rm -rf everything', variables: [], safety_level: 'DESTRUCTIVE', status: 'ACTIVE', project_slug: null },
  'archived': { id: 10, slug: 'archived', title: 'Old', body: 'x', variables: [], safety_level: 'SAFE', status: 'ARCHIVED', project_slug: null }
};
var db = { query: function (sql, params) { var c = COMMANDS[params[0]]; return Promise.resolve({ rows: c ? [c] : [] }); } };
var stubAuth = { identityFromRequest: function (req) { return req && req.identity ? req.identity : null; } };
var routes = routesMod.buildRoutes(db, stubAuth);
function findRoute(method, p) { return routes.filter(function (r) { return r.method === method && r.pattern.test(p); })[0]; }
function fakeRes() { return { statusCode: null, body: null, writeHead: function (s) { this.statusCode = s; }, end: function (b) { this.body = b ? JSON.parse(b) : null; } }; }

server.listen(0, '127.0.0.1', function () {
  var url = 'http://127.0.0.1:' + server.address().port;
  process.env.OTHMODE_EXECUTOR_URL = url;
  var cfg = run.config();

  section('config — disabled without a token file, loopback by default');
  var off = run.config({});
  ok(off.enabled === false && /OTHMODE_EXECUTOR_TOKEN_FILE/.test(run.disabledReason(off)), 'no token file → disabled, and it says why');
  ok(run.config({ OTHMODE_EXECUTOR_TOKEN_FILE: '/x' }).url === 'http://127.0.0.1:8130', 'default executor URL is loopback');
  ok(cfg.enabled === true && cfg.url === url, 'fixture config enabled against the stub');

  var chain = Promise.resolve();
  chain = chain.then(function () { section('validation — closed vocabularies, safety gate, placeholders'); });
  function expectInput(p, re, label) {
    return p.then(function () { ok(false, label + ' (resolved)'); }, function (e) {
      var m = e.code === 'OTHMODE_RUN_INPUT' && re.test(e.message);
      ok(m, label + (m ? '' : ' (got ' + e.code + ': ' + e.message + ')'));
    });
  }
  chain = chain.then(function () { return expectInput(run.startRun(db, 'plain', { provider: 'claude-code' }, 'u'), /provider must be one of/, 'execution-authority provider refused as a run choice'); });
  chain = chain.then(function () { return expectInput(run.startRun(db, 'plain', { task_type: 'coding' }, 'u'), /task_type must be one of/, 'non-advisory task type refused'); });
  chain = chain.then(function () { return expectInput(run.startRun(db, 'plain', { timeout_seconds: 5 }, 'u'), /timeout_seconds/, 'timeout outside 30..1800 refused'); });
  chain = chain.then(function () { return expectInput(run.startRun(db, '../etc', {}, 'u'), /invalid command reference/, 'slug traversal refused'); });
  chain = chain.then(function () { return expectInput(run.startRun(db, 'dangerous', {}, 'u'), /only SAFE or READ_ONLY/, 'DESTRUCTIVE command never runs here'); });
  chain = chain.then(function () { return expectInput(run.startRun(db, 'archived', {}, 'u'), /only ACTIVE commands/, 'archived command refused'); });
  chain = chain.then(function () { return expectInput(run.startRun(db, 'audit-readme', {}, 'u'), /unresolved placeholders: project/, 'unresolved placeholder refused with its name'); });
  chain = chain.then(function () {
    return run.startRun(db, 'nope', {}, 'u').then(function () { ok(false, 'unknown command'); }, function (e) { ok(e.code === 'OTHMODE_RUN_NOT_FOUND', 'unknown command → not found'); });
  });
  chain = chain.then(function () { ok(seen.tasks.length === 0 && seen.route.length === 0, 'no executor call happened for any refused run'); });

  chain = chain.then(function () { section('auto selection — the router picks, the pool is the safe default'); });
  chain = chain.then(function () {
    return run.startRun(db, 'audit-readme', { values: { project: 'mythos-prod' } }, 'editor-x').then(function (r) {
      ok(/^t-/.test(r.task_id) && r.provider === 'free-llm-pool' && r.route.action === 'route', 'router answer used (route → free-llm-pool)');
      var t = seen.tasks[0];
      ok(t.instruction === 'Review the README of mythos-prod and list gaps.', 'placeholders rendered through the library renderer');
      ok(t.report_to_git === false && t.requested_by === 'othmode:editor-x' && t.project === 'mythos-prod', 'advisory task: no Git report, actor recorded, project set');
      ok(t.stage === 'OTHMODE-RUN-audit-readme' && t.max_retries === 1 && t.timeout_seconds === 300, 'stage/retry/timeout defaults');
      ok(seen.route[0].task_type === 'research' && seen.route[0].execution_profile === 'repo-read', 'router asked for an advisory repo-read route');
      ok(seen.auth[0] === 'Bearer test-token-not-a-secret', 'token read from the file and sent only as a header');
      ok(!JSON.stringify(r).match(/test-token-not-a-secret/), 'token never appears in the run result');
      ok(r.run.type === 'run' && r.run.command_slug === 'audit-readme' && r.run.actor === 'editor-x' && r.run.task_id === r.task_id, 'run record appended to the store');
    });
  });
  chain = chain.then(function () {
    stub.routeBody = { action: 'route', agent: 'claude-code', provider: 'claude-code', authority: true };
    return run.startRun(db, 'plain', {}, 'u').then(function (r) {
      ok(r.provider === 'free-llm-pool' && r.route.action === 'default', 'an execution-authority route is never accepted for a run → pool');
    });
  });
  chain = chain.then(function () {
    stub.routeStatus = 503; stub.routeBody = { error: 'core disabled' };
    return run.startRun(db, 'plain', {}, 'u').then(function (r) {
      ok(r.provider === 'free-llm-pool' && /HTTP 503/.test(r.route.reason), 'router off → pool, with the reason kept');
    });
  });
  chain = chain.then(function () {
    stub.routeStatus = 200; stub.routeBody = { action: 'no_provider', reason: 'nothing' };
    return run.startRun(db, 'plain', { provider: 'openai-compat' }, 'u').then(function (r) {
      ok(r.provider === 'openai-compat' && r.route.action === 'requested' && seen.route.length === 3, 'explicit provider skips the router');
    });
  });
  chain = chain.then(function () {
    stub.taskStatus = 500;
    return run.startRun(db, 'plain', {}, 'u').then(function () { ok(false, 'executor refusal'); }, function (e) {
      ok(e.code === 'OTHMODE_RUN_INPUT' && /executor refused/.test(e.message), 'executor refusal surfaces as a clear error, no record written');
      stub.taskStatus = 201;
    });
  });

  chain = chain.then(function () { section('lifecycle — executor state on disk folded into a simple status'); });
  var firstId;
  chain = chain.then(function () {
    firstId = seen.tasks.length ? run.listRuns(10).runs.slice(-1)[0].task_id : null;
    var l = run.lifecycleOf(firstId);
    ok(l.status === 'queued' && l.terminal === false && l.provider === 'free-llm-pool', 'QUEUED → queued (not terminal)');
    var p = path.join(TASKS, firstId, 'status.json');
    fs.writeFileSync(p, JSON.stringify({ task_id: firstId, status: 'COMPLETED', provider: 'free-llm-pool', provider_used: 'free-llm-pool', model_used: 'groq/compound',
      attempts: [{ provider: 'cerebras', ok: false }, { provider: 'groq', ok: true }], fallback: true,
      created_at: '2026-09-17T10:00:00.000Z', started_at: '2026-09-17T10:00:05.000Z', ended_at: '2026-09-17T10:00:08.500Z', retry_count: 0 }));
    fs.writeFileSync(path.join(TASKS, firstId, 'report.json'), JSON.stringify({ task_id: firstId, structured: { status: 'COMPLETED', summary: 'README lacks a runbook. Key /home/deploy/x' } }));
    l = run.lifecycleOf(firstId);
    ok(l.status === 'completed' && l.terminal === true && l.duration_ms === 3500, 'COMPLETED → completed with duration');
    ok(l.provider_used === 'free-llm-pool' && l.model_used === 'groq/compound' && l.attempts === 2 && l.fallback === true, 'provider used, model, attempts and fallback visible');
    ok(l.result && /runbook/.test(l.result.summary), 'result summary comes from the executor report');
    fs.writeFileSync(p, JSON.stringify({ task_id: firstId, status: 'FAILED', provider: 'free-llm-pool', last_error: 'provider error at /home/deploy/mythos-ai-executor/tasks/x: boom', retry_count: 1, next_action: 'check the key' }));
    l = run.lifecycleOf(firstId);
    ok(l.status === 'failed' && l.error === 'provider error at [path]: boom' && l.next_action === 'check the key', 'FAILED → failed, error kept, filesystem paths blanked');
    ok(run.lifecycleOf('t-99999999999999-zzzzzz').status === 'unknown', 'unknown task → unknown, never a throw');
    ok(run.lifecycleOf('../../etc/passwd').status === 'unknown', 'task id traversal refused');
    var list = run.listRuns(10);
    ok(list.provisioned && list.runs.length === 4 && list.runs[0].task_id !== firstId, 'listRuns: newest first, lifecycle attached');
    ok(run.getRun(firstId).lifecycle.status === 'failed' && run.getRun('t-00000000000000-nonexs') === null, 'getRun by task id');
  });

  chain = chain.then(function () { section('history — runs are the fifth source of the ONE timeline'); });
  chain = chain.then(function () {
    var rows = run.historyRows(50).rows;
    ok(rows.length === 4 && rows.every(function (r) { return r.source === 'run'; }), 'historyRows: one row per run, source run');
    var fr = rows.filter(function (r) { return r.evidence === 'executor-task:' + firstId; })[0];
    ok(fr && fr.status === 'FAILED' && fr.command === 'Audit README' && fr.project === 'mythos-prod', 'row carries command, status, project, evidence');
    return history.unified({ query: function () { return Promise.reject(new Error('no db')); } }, { source: 'run', limit: 50 }).then(function (u) {
      ok(u.rows.length === 4 && u.sources.run === 'loaded', 'unified history filters by source=run and reports the source loaded');
    });
  });

  chain = chain.then(function () { section('routes — run creation is authenticated and secret-gated; reads are public'); });
  chain = chain.then(function () {
    var create = findRoute('POST', '/api/othmode/commands/plain/run');
    ok(create && create.auth === true, 'POST /commands/:slug/run requires a session');
    ok(findRoute('GET', '/api/othmode/runs').auth === false && findRoute('GET', '/api/othmode/runs/t-1').auth === false && findRoute('GET', '/api/othmode/run-config').auth === false, 'run reads are public');
    var resS = fakeRes();
    create.handler({ identity: 'editor-x' }, resS, ['', 'plain'], {}, { values: { project: 'aws key AKIAIOSFODNN7EXAMPLE' } });
    ok(resS.statusCode === 422, 'credential-shaped placeholder value refused by the secret gate (' + resS.statusCode + ')');
    var before = seen.tasks.length;
    var resC = fakeRes();
    return create.handler({ identity: 'editor-x' }, resC, ['', 'plain'], {}, { provider: 'free-llm-pool' }).then(function () {
      ok(resC.statusCode === 201 && /^t-/.test(resC.body.task_id) && seen.tasks.length === before + 1, 'clean run accepted through the route (201 + task id)');
      var resN = fakeRes();
      return findRoute('POST', '/api/othmode/commands/nope/run').handler({ identity: 'e' }, resN, ['', 'nope'], {}, {}).then(function () {
        ok(resN.statusCode === 404, 'unknown command → 404 through the route');
        var resB = fakeRes();
        return findRoute('POST', '/api/othmode/commands/dangerous/run').handler({ identity: 'e' }, resB, ['', 'dangerous'], {}, {}).then(function () {
          ok(resB.statusCode === 400 && /SAFE or READ_ONLY/.test(resB.body.error), 'safety gate answers 400 with the rule');
          var resL = fakeRes();
          findRoute('GET', '/api/othmode/runs').handler({}, resL, [], { limit: '10' });
          ok(resL.statusCode === 200 && resL.body.runs.length === 5, 'GET /runs lists runs');
          var resG = fakeRes();
          findRoute('GET', '/api/othmode/runs/' + firstId).handler({}, resG, ['', firstId]);
          ok(resG.statusCode === 200 && resG.body.lifecycle.status === 'failed' && resG.body.run.command_slug === 'audit-readme', 'GET /runs/:id returns record + lifecycle');
          var resCfg = fakeRes();
          findRoute('GET', '/api/othmode/run-config').handler({}, resCfg, [], {});
          ok(resCfg.statusCode === 200 && resCfg.body.enabled === true && resCfg.body.runnable_safety.join() === 'SAFE,READ_ONLY', 'run-config exposes the rule, never the token');
          ok(!JSON.stringify(resCfg.body).match(/token/i), 'run-config carries no token material');
        });
      });
    });
  });

  chain = chain.then(function () { section('web — Run button, runs screens, i18n parity, no innerHTML'); });
  chain = chain.then(function () {
    var web = path.join(BASE, 'projects', 'command-center', 'reference', 'web');
    var app = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
    var oth = fs.readFileSync(path.join(web, 'othmode.js'), 'utf8');
    var i18n = fs.readFileSync(path.join(web, 'othmode-i18n.js'), 'utf8');
    ok(/registerCommandActions: function/.test(app) && /extensions\.commandActions\.map/.test(app), 'app.js exposes the command-action extension point');
    ok(/A\.registerCommandActions\(function \(command\)/.test(oth) && /\['SAFE', 'READ_ONLY'\]\.indexOf\(command\.safety_level\)/.test(oth), 'othmode.js adds Run only for SAFE/READ_ONLY commands');
    ok(/'runs': function \(\) \{ renderRuns\(\); \}/.test(oth) && /'run': function \(segments\)/.test(oth), 'runs + run routes registered');
    ok(/oth\.group\.command/.test(oth) && /oth\.group\.tasks/.test(oth) && /oth\.group\.ai/.test(oth) && /oth\.group\.more/.test(oth), 'simplified navigation groups in place');
    ok(!/\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\s*\(/.test(oth), 'othmode.js still never assigns markup from strings');
    ['oth.run.button', 'oth.run.status.completed', 'oth.ov.key_missing', 'oth.group.more', 'oth.state.invalid_credentials'].forEach(function (k) {
      var n = i18n.split("'" + k + "'").length - 1;
      ok(n === 3, k + ' present in EN/FR/AR (' + n + ')');
    });
  });

  chain.then(function () {
    server.close();
    cleanup();
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  }).catch(function (e) {
    server.close(); cleanup();
    console.error('SUITE ERROR', e && e.stack || e);
    process.exit(1);
  });
});
