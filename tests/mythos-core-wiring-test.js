'use strict';
// =====================================================
// MYTHOS — Core Wiring stage tests
// tests/mythos-core-wiring-test.js
//
// Covers the production integration only (the core internals are covered
// by tests/mythos-orchestration-core-test.js and Phase 1 by
// tests/mythos-ai-executor-test.js):
//
//   feature flag safety · Goal API schema + auth · goal→mission wiring ·
//   executor-task lifecycle coupling and cancellation · quota semantics
//   through the bridge (429 → WAITING_FOR_QUOTA, never FAILED) ·
//   policy denial through the production path · restart recovery ·
//   report/memory · Phase 1 backward compatibility with the flag off.
//
// Deterministic and offline: the mock provider stands in for real agents
// and NO real AI quota is consumed. Fixtures live under the home
// directory (never /tmp) and are removed at the end.
//
// Run with: node tests/mythos-core-wiring-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIXTURES = path.join(os.homedir(), 'mythos-wiring-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.MYTHOS_CORE_REPO_PATH = BASE;
delete process.env.MYTHOS_MOCK_SCRIPT;

var passed = 0, failed = 0, failures = [];
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}
function throws(fn, re, name) {
  try { fn(); ok(false, name + ' (did not throw)'); }
  catch (e) { ok(re.test(e.message), name + ' (threw: ' + e.message.slice(0, 90) + ')'); }
}

// ===========================================================================
// 1. FEATURE FLAG — default OFF, and OFF means truly inert
// ===========================================================================
(function () {
  delete process.env.MYTHOS_CORE_ENABLED;
  var core = require(path.join(EXEC, 'core', 'core-wiring'));
  ok(core.coreEnabled() === false, 'flag: default is OFF when unset');
  throws(function () { core.assertEnabled(); }, /CORE_DISABLED/, 'flag: assertEnabled refuses when off');
  throws(function () { core.submitGoal({ text: 'anything at all here' }); },
    /CORE_DISABLED/, 'flag: submitGoal refuses when off');
  throws(function () { core.cancelMission('m-aaaaaa-0001'); }, /CORE_DISABLED/,
    'flag: cancelMission refuses when off');

  ['false', 'FALSE', '0', 'no', 'yes', 'True '].forEach(function (v) {
    process.env.MYTHOS_CORE_ENABLED = v;
    var expected = v.toLowerCase().trim() === 'true' && v === 'true';
    ok(core.coreEnabled() === (String(v).toLowerCase() === 'true'),
      'flag: "' + v + '" → ' + (String(v).toLowerCase() === 'true'));
  });
  process.env.MYTHOS_CORE_ENABLED = 'true';
  ok(core.coreEnabled() === true, 'flag: "true" enables');
  delete process.env.MYTHOS_CORE_ENABLED;

  // The committed default in the shipped service unit must be off (or absent).
  var unit = fs.readFileSync(path.join(EXEC, 'service', 'mythos-ai-executor.service'), 'utf8');
  var enabledLine = /MYTHOS_CORE_ENABLED\s*=\s*true/i.test(unit);
  ok(!enabledLine, 'flag: shipped systemd unit never sets MYTHOS_CORE_ENABLED=true');
})();

// ===========================================================================
// 2. GOAL PAYLOAD SCHEMA — instruction is data, not a command channel
// ===========================================================================
(function () {
  process.env.MYTHOS_CORE_ENABLED = 'true';
  var core = require(path.join(EXEC, 'core', 'core-wiring'));

  ok(core.validateGoalPayload({ text: 'Analyze the repository please' }).valid,
    'schema: minimal valid payload accepted');
  ok(!core.validateGoalPayload({ text: 'short' }).valid, 'schema: too-short text refused');
  ok(!core.validateGoalPayload({}).valid, 'schema: missing text refused');
  ok(!core.validateGoalPayload({ text: 'x'.repeat(4100) }).valid, 'schema: oversized text refused');

  var injected = core.validateGoalPayload({
    text: 'Analyze the repository', provider: 'mock', working_directory: '/etc',
    execution_profile: 'autonomous', policy_classes: ['ROOT']
  });
  ok(!injected.valid, 'schema: provider/working_directory/profile/policy injection refused');
  ok(injected.errors.filter(function (e) { return /unexpected field/.test(e); }).length === 4,
    'schema: every injected field named as unexpected');

  ok(!core.validateGoalPayload({ text: 'Analyze the repo', mission_kind: 'arbitrary-shell' }).valid,
    'schema: unknown mission_kind refused (no arbitrary task specs over the wire)');
  ok(!core.validateGoalPayload({ text: 'Analyze the repo', project: '../etc/passwd' }).valid,
    'schema: non-slug project refused');
  ok(!core.validateGoalPayload({ text: 'Analyze the repo', max_parallel: 99 }).valid,
    'schema: unbounded parallelism refused');
  ok(!core.validateGoalPayload({ text: 'Use token ghp_abcdefghijklmnopqrstuv12 to fix' }).valid,
    'schema: secret-shaped goal text refused');
})();

// ===========================================================================
// 3. GOAL → MISSION WIRING through the real core
// ===========================================================================
var submitted;
(function () {
  var core = require(path.join(EXEC, 'core', 'core-wiring'));
  var store = require(path.join(EXEC, 'core', 'store'));
  submitted = core.submitGoal({
    text: 'Analyze the current Mythos repository and identify one high-value improvement.',
    project: 'mythos-prod', requested_by: 'wiring-test'
  });
  ok(/^g-/.test(submitted.goal_id) && /^m-/.test(submitted.mission_id),
    'wiring: goal and mission created');
  ok(submitted.correlation_id === submitted.goal_id, 'wiring: correlation id threads from the goal');
  ok(submitted.tasks.length === 3 && submitted.tasks[0].key === 'inspect',
    'wiring: named mission kind produced its committed task shape');
  var mission = store.load('mission', submitted.mission_id);
  ok(mission.status === 'VALIDATED' && mission.metadata.mission_kind === 'repo-analysis',
    'wiring: mission persisted VALIDATED with its kind');
  ok(store.load('goal', submitted.goal_id).status === 'ACTIVE', 'wiring: goal ACTIVE');
  var tasks = mission.task_ids.map(function (id) { return store.load('task', id); });
  ok(tasks.every(function (t) { return t.policy_classes.join(',') === 'READ'; }),
    'wiring: repo-analysis tasks are READ-only by construction');
  ok(tasks[1].depends_on[0] === tasks[0].id, 'wiring: DAG dependencies resolved to real ids');
})();

// ===========================================================================
// 4. FULL PRODUCTION PATH with the mock provider (no real quota)
// ===========================================================================
var chain = Promise.resolve();

chain = chain.then(function () {
  var core = require(path.join(EXEC, 'core', 'core-wiring'));
  var store = require(path.join(EXEC, 'core', 'store'));
  var memory = require(path.join(EXEC, 'core', 'memory'));
  var executor = require(path.join(EXEC, 'executor'));

  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'success', summary: 'wiring path ok' }]);
  // Force the mock provider for every bridge dispatch by registering a
  // mock-backed agent; the registry (not the payload) decides.
  var agents = require(path.join(EXEC, 'core', 'agent-registry'));
  agents.registerAgent('wiring-mock-agent', {
    provider: 'mock',
    capabilities: ['repo_inspection', 'analysis', 'summarization', 'review', 'planning'],
    task_types: ['inspection', 'analysis', 'reporting', 'review', 'validation', 'generic'],
    execution_authority: true, risk_level: 'low', cost: { tier: 'free' }
  });
  agents.registerProbe('mock', function () { return true; });
  agents.registerProbe('claude-code', function () { return false; });
  agents.registerProbe('openai-compat', function () { return false; });
  agents.registerProbe('gemini', function () { return false; });

  return core.advanceMission(submitted.mission_id, {
    review: false
  }).then(function (mission) {
    ok(mission.status === 'COMPLETED', 'production path: mission completed through the real bridge');
    var tasks = mission.task_ids.map(function (id) { return store.load('task', id); });
    ok(tasks.every(function (t) { return t.status === 'COMPLETED'; }),
      'production path: every task completed');
    ok(tasks.every(function (t) { return t.executor_task_id; }),
      'production path: every task ran through a REAL executor task (bridge, not a stub)');
    ok(tasks.every(function (t) {
      return (t.metadata.executor_task_ids || []).length >= 1;
    }), 'lifecycle: executor tasks registered against their core tasks');
    ok(store.load('goal', submitted.goal_id).status === 'COMPLETED', 'production path: goal closed');
    ok(mission.metadata.report_id && store.load('report', mission.metadata.report_id),
      'production path: report entity produced');
    ok(memory.recall('mythos-prod', 'repository analysis').length >= 1,
      'production path: memory updated through the real memory layer');
    var report = core.missionReport(submitted.mission_id);
    ok(report && report.report && /completed/i.test(report.report.summary),
      'production path: missionReport read model works');
  });
});

// ===========================================================================
// 5. QUOTA SEMANTICS through the production bridge — 429 never FAILED
// ===========================================================================
chain = chain.then(function () {
  var core = require(path.join(EXEC, 'core', 'core-wiring'));
  var store = require(path.join(EXEC, 'core', 'store'));

  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([
    { kind: 'quota', reset_epoch: Math.floor(Date.now() / 1000) + 3600 }
  ]);
  require(path.join(EXEC, 'providers', 'mock')).reset();

  var g = core.submitGoal({ text: 'Quota semantics probe through the production bridge.',
    project: 'mythos-prod', requested_by: 'wiring-test' });
  return core.advanceMission(g.mission_id, { review: false }).then(function (mission) {
    var first = store.load('task', mission.task_ids[0]);
    ok(first.status === 'WAITING_FOR_QUOTA',
      'quota: 429 through the bridge → WAITING_FOR_QUOTA (never FAILED)');
    ok(mission.status === 'WAITING', 'quota: mission waits rather than failing');

    // The Phase 1 executor task kept its own quota state + session.
    var execState = require(path.join(EXEC, 'lib', 'state'));
    var execIds = first.metadata.executor_task_ids || [];
    var execSt = execIds.length ? execState.readStatus(execIds[execIds.length - 1]) : null;
    ok(execSt && execSt.status === 'WAITING_FOR_QUOTA' && execSt.claude_session_id,
      'quota: Phase 1 executor preserved its own WAITING_FOR_QUOTA + session for resume');

    // Restart recovery while parked.
    var script = 'var s=require(' + JSON.stringify(path.join(EXEC, 'core', 'store')) + ');' +
      'console.log(JSON.stringify({t: s.load("task", ' + JSON.stringify(first.id) + ').status,' +
      'm: s.load("mission", ' + JSON.stringify(mission.id) + ').status}));';
    var fresh = JSON.parse(cp.execFileSync(process.execPath, ['-e', script],
      { encoding: 'utf8', env: Object.assign({}, process.env) }).trim());
    ok(fresh.t === 'WAITING_FOR_QUOTA' && fresh.m === 'WAITING',
      'restart: quota-parked state survives a process restart');

    // Resume when the window reopens.
    process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'success', summary: 'resumed after quota' }]);
    require(path.join(EXEC, 'providers', 'mock')).reset();
    return core.resumeMission(g.mission_id, { review: false });
  }).then(function (mission) {
    ok(mission.status === 'COMPLETED', 'quota: resumeMission completed the mission after the window reopened');
    ok((mission.metadata.last_resume_released || []).length >= 1,
      'quota: resume released the parked task through the core');
  });
});

// ===========================================================================
// 6. LIFECYCLE COUPLING — cancellation reaches spawned executor tasks
// ===========================================================================
chain = chain.then(function () {
  var core = require(path.join(EXEC, 'core', 'core-wiring'));
  var store = require(path.join(EXEC, 'core', 'store'));
  var execState = require(path.join(EXEC, 'lib', 'state'));

  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([
    { kind: 'quota', reset_epoch: Math.floor(Date.now() / 1000) + 3600 }
  ]);
  require(path.join(EXEC, 'providers', 'mock')).reset();

  var g = core.submitGoal({ text: 'Cancellation propagation probe for the wiring stage.',
    project: 'mythos-prod', requested_by: 'wiring-test' });
  return core.advanceMission(g.mission_id, { review: false }).then(function (mission) {
    var parked = store.load('task', mission.task_ids[0]);
    var execIds = parked.metadata.executor_task_ids || [];
    ok(execIds.length >= 1, 'lifecycle: parked task has a registered executor task');
    ok(execState.readStatus(execIds[0]).status === 'WAITING_FOR_QUOTA',
      'lifecycle: the executor task is non-terminal before cancellation');

    var result = core.cancelMission(g.mission_id, 'wiring test cancellation');
    ok(result.executor_tasks_cancelled.indexOf(execIds[0]) !== -1,
      'lifecycle: cancelling the mission CANCELS the spawned executor task (no resurrection)');
    ok(execState.readStatus(execIds[0]).status === 'CANCELLED',
      'lifecycle: Phase 1 executor task is terminal after core cancellation');
    ok(store.load('mission', g.mission_id).status === 'CANCELLED' &&
       store.load('goal', g.goal_id).status === 'CANCELLED',
      'lifecycle: mission and goal cancelled together');

    // The Phase 1 daemon must find nothing to resurrect.
    var revivable = execState.listTasks().filter(function (id) {
      var st = execState.readStatus(id);
      return st && ['RUNNING', 'WAITING_RETRY', 'QUEUED'].indexOf(st.status) !== -1;
    });
    ok(revivable.length === 0,
      'lifecycle: no non-terminal executor tasks remain for the daemon to resurrect');
  });
});

// ===========================================================================
// 7. POLICY BOUNDARY through the production path
// ===========================================================================
chain = chain.then(function () {
  var core = require(path.join(EXEC, 'core', 'core-wiring'));
  var store = require(path.join(EXEC, 'core', 'store'));

  var probe;
  var threw = null;
  try {
    probe = core.submitGoal({
      text: 'Drop the production database and deploy to production immediately.',
      mission_kind: 'policy-probe', project: 'mythos-prod', requested_by: 'wiring-test'
    });
  } catch (e) { threw = e; }

  // DESTRUCTIVE is denied at the plan gate, so the whole goal is refused
  // before anything persists — the strongest possible outcome.
  ok(threw && /GOAL_REJECTED/.test(threw.message) && /DESTRUCTIVE/.test(threw.message),
    'policy: destructive goal REFUSED at the plan gate through the production entry point');

  // A DEPLOY-only probe plans, then parks for approval at dispatch.
  var deployOnly = require(path.join(EXEC, 'core', 'planner'));
  var domain = require(path.join(EXEC, 'core', 'domain'));
  var goal = domain.createGoal({ text: 'Deploy to production via the core path.', project: 'mythos-prod' });
  store.create(goal);
  var plan = deployOnly.planFromSpec(goal, {
    title: 'deploy probe',
    tasks: [{ key: 'deploy', title: 'Deploy', task_type: 'generic',
      capabilities_required: ['analysis'], policy_classes: ['DEPLOY'], depends_on: [] }]
  });
  var persisted = deployOnly.persistPlan(plan);
  store.transition('mission', persisted.mission.id, 'VALIDATED');
  var ran = 0;
  return core.advanceMission(persisted.mission.id, {
    agent_runner: function () { ran += 1; throw new Error('must never execute'); },
    review: false
  }).then(function (mission) {
    var t = store.load('task', persisted.tasks[0].id);
    ok(mission.status === 'WAITING' && t.status === 'WAITING_FOR_APPROVAL' && ran === 0,
      'policy: DEPLOY parks WAITING_FOR_APPROVAL through the production path, runner never called');
    ok(/require_approval/.test(String(t.metadata.approval_reason)),
      'policy: the approval reason is recorded');
  });
});

// ===========================================================================
// 8. GOAL API over HTTP — auth, flag gate, schema, read models
// ===========================================================================
chain = chain.then(function () {
  var server = require(path.join(EXEC, 'server'));
  process.env.MYTHOS_EXECUTOR_TOKEN = 'wiring-test-token-0123456789';
  var servers = server.start({ port: 8207, binds: ['127.0.0.1'] });

  function req(method, urlPath, body, token) {
    return new Promise(function (resolve, reject) {
      var payload = body ? JSON.stringify(body) : null;
      var r = http.request({
        host: '127.0.0.1', port: 8207, path: urlPath, method: method,
        headers: Object.assign(
          payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
          token ? { 'Authorization': 'Bearer ' + token } : {})
      }, function (res) {
        var data = '';
        res.on('data', function (d) { data += d; });
        res.on('end', function () {
          resolve({ code: res.statusCode, body: data ? JSON.parse(data) : {} });
        });
      });
      r.on('error', reject);
      if (payload) r.write(payload);
      r.end();
    });
  }
  var TOKEN = 'wiring-test-token-0123456789';

  return new Promise(function (r) { setTimeout(r, 150); }).then(function () {
    return req('POST', '/goals', { text: 'Analyze the repository for improvements' }, null);
  }).then(function (res) {
    ok(res.code === 401, 'api: POST /goals without a token → 401 (reuses the Phase 1 security model)');
    return req('POST', '/goals', { text: 'Analyze the repository for improvements' }, 'wrong-token');
  }).then(function (res) {
    ok(res.code === 401, 'api: wrong token → 401');

    // Flag OFF ⇒ 503 even with a valid token.
    delete process.env.MYTHOS_CORE_ENABLED;
    return req('POST', '/goals', { text: 'Analyze the repository for improvements' }, TOKEN);
  }).then(function (res) {
    ok(res.code === 503 && /core disabled/.test(res.body.error),
      'api: flag OFF → 503 core disabled even when authenticated');
    process.env.MYTHOS_CORE_ENABLED = 'true';
    return req('POST', '/goals', { text: 'x' }, TOKEN);
  }).then(function (res) {
    ok(res.code === 400, 'api: invalid payload → 400');
    return req('POST', '/goals', {
      text: 'Analyze the repository via the HTTP goal API', requested_by: 'api-test'
    }, TOKEN);
  }).then(function (res) {
    ok(res.code === 201 && /^g-/.test(res.body.goal_id) && /^m-/.test(res.body.mission_id),
      'api: authenticated valid goal → 201 with goal and mission ids');
    var goalId = res.body.goal_id;
    return req('GET', '/goals/' + goalId, null, TOKEN).then(function (res2) {
      ok(res2.code === 200 && res2.body.goal.status === 'ACTIVE' && res2.body.missions.length === 1,
        'api: GET /goals/<id> read model works');
      return req('POST', '/goals/' + goalId + '/cancel', null, TOKEN);
    }).then(function (res3) {
      ok(res3.code === 200 && res3.body.core_tasks_cancelled.length >= 1,
        'api: cancel endpoint cancels core tasks');
      return req('GET', '/goals/g-000000-nope', null, TOKEN);
    }).then(function (res4) {
      ok(res4.code === 404, 'api: unknown goal → 404');
      // Injection attempt over the wire.
      return req('POST', '/goals', {
        text: 'Analyze the repo', working_directory: '/etc', provider: 'mock'
      }, TOKEN);
    }).then(function (res5) {
      ok(res5.code === 400 && /unexpected field/.test(res5.body.error),
        'api: field injection refused over HTTP');
      servers.forEach(function (s) { s.close(); });
      delete process.env.MYTHOS_EXECUTOR_TOKEN;
    });
  });
});

// ===========================================================================
// 9. PHASE 1 BACKWARD COMPATIBILITY with the flag OFF
// ===========================================================================
chain = chain.then(function () {
  var server = require(path.join(EXEC, 'server'));
  var executor = require(path.join(EXEC, 'executor'));
  delete process.env.MYTHOS_CORE_ENABLED;
  process.env.MYTHOS_EXECUTOR_TOKEN = 'wiring-test-token-0123456789';
  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'success', summary: 'phase 1 still fine' }]);
  require(path.join(EXEC, 'providers', 'mock')).reset();

  var servers = server.start({ port: 8208, binds: ['127.0.0.1'] });
  function req(method, urlPath, body) {
    return new Promise(function (resolve, reject) {
      var payload = body ? JSON.stringify(body) : null;
      var r = http.request({
        host: '127.0.0.1', port: 8208, path: urlPath, method: method,
        headers: Object.assign(
          payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
          { 'Authorization': 'Bearer wiring-test-token-0123456789' })
      }, function (res) {
        var data = '';
        res.on('data', function (d) { data += d; });
        res.on('end', function () { resolve({ code: res.statusCode, body: data ? JSON.parse(data) : {} }); });
      });
      r.on('error', reject);
      if (payload) r.write(payload);
      r.end();
    });
  }
  return new Promise(function (r) { setTimeout(r, 150); }).then(function () {
    return req('POST', '/tasks', {
      project: 'executor-selftest', stage: 'COMPAT', instruction: 'phase 1 path with core off',
      provider: 'mock', report_to_git: false
    });
  }).then(function (res) {
    ok(res.code === 201 && /^t-/.test(res.body.task_id),
      'compat: Phase 1 POST /tasks still works with the core flag OFF');
    var taskId = res.body.task_id;
    return executor.runTask(taskId).then(function (st) {
      ok(st.status === 'COMPLETED', 'compat: Phase 1 task executes unchanged with the core OFF');
      return req('GET', '/tasks/' + taskId);
    });
  }).then(function (res) {
    ok(res.code === 200 && res.body.status.status === 'COMPLETED',
      'compat: Phase 1 read model unchanged');
    return req('GET', '/health');
  }).then(function (res) {
    ok(res.code === 200 || res.code === 503, 'compat: /health unchanged and unauthenticated');
    return req('GET', '/goals');
  }).then(function (res) {
    ok(res.code === 503, 'compat: goal surface stays closed while the flag is off');
    servers.forEach(function (s) { s.close(); });
    delete process.env.MYTHOS_EXECUTOR_TOKEN;
  });
});

// ===========================================================================
// 10. CLI surface
// ===========================================================================
chain = chain.then(function () {
  var bin = path.join(EXEC, 'bin', 'mythos-ai-executor');
  var envOff = Object.assign({}, process.env);
  delete envOff.MYTHOS_CORE_ENABLED;
  var out = '';
  try {
    cp.execFileSync(process.execPath, [bin, 'goal', 'submit', 'Analyze something safely'],
      { encoding: 'utf8', env: envOff, stdio: ['ignore', 'pipe', 'pipe'] });
    ok(false, 'cli: goal submit should refuse with the flag off');
  } catch (e) {
    ok(/CORE_DISABLED/.test(String(e.stderr || e.stdout || e.message)),
      'cli: goal submit refuses with the flag off');
  }
  var envOn = Object.assign({}, process.env, { MYTHOS_CORE_ENABLED: 'true' });
  out = cp.execFileSync(process.execPath, [bin, 'goal', 'list'], { encoding: 'utf8', env: envOn });
  var listed = JSON.parse(out);
  ok(listed.core_enabled === true && Array.isArray(listed.goals) &&
     listed.mission_kinds.indexOf('repo-analysis') !== -1,
    'cli: goal list reports flag state, goals and mission kinds');
  out = cp.execFileSync(process.execPath,
    [bin, 'goal', 'submit', 'Analyze the repository from the CLI entry point'],
    { encoding: 'utf8', env: envOn });
  var created = JSON.parse(out);
  ok(/^g-/.test(created.goal_id), 'cli: goal submit creates a real goal through the core');
  out = cp.execFileSync(process.execPath, [bin, 'goal', 'status', created.goal_id],
    { encoding: 'utf8', env: envOn });
  ok(JSON.parse(out).missions.length === 1, 'cli: goal status reads the mission back');
  out = cp.execFileSync(process.execPath, [bin, 'goal', 'cancel', created.goal_id],
    { encoding: 'utf8', env: envOn });
  ok(JSON.parse(out).core_tasks_cancelled.length >= 1, 'cli: goal cancel works');
});

// ===========================================================================
chain.then(function () {
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failures.length) {
    console.log('Failures:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  process.exit(0);
}).catch(function (err) {
  console.error('SUITE ERROR: ' + (err && err.stack || err));
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  process.exit(1);
});
