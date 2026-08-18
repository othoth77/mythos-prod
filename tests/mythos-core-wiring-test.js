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
  // Phase 2 finalization: the core is the DEFAULT path, with an explicit
  // emergency rollback that needs no code change.
  delete process.env.MYTHOS_CORE_ENABLED;
  var core = require(path.join(EXEC, 'core', 'core-wiring'));
  ok(core.coreEnabled() === true, 'flag: default is ON when unset (core is the normal path)');
  ok(core.validateGoalPayload({ text: 'Analyze the repository please' }).valid,
    'flag: goals are accepted with no feature flag set at all');

  // Only the exact string "false" rolls back — a typo can never silently
  // put production on the legacy path.
  var cases = { 'false': false, 'FALSE': false, ' false ': false, 'true': true,
    'TRUE': true, '': true, 'no': true, '0': true, 'yes': true };
  Object.keys(cases).forEach(function (v) {
    process.env.MYTHOS_CORE_ENABLED = v;
    ok(core.coreEnabled() === cases[v],
      'flag: "' + v + '" → ' + (cases[v] ? 'ENABLED' : 'ROLLBACK'));
  });

  // Rollback is total: every entry point refuses.
  process.env.MYTHOS_CORE_ENABLED = 'false';
  throws(function () { core.assertEnabled(); }, /CORE_DISABLED/, 'rollback: assertEnabled refuses');
  throws(function () { core.submitGoal({ text: 'anything at all here' }); },
    /CORE_DISABLED/, 'rollback: submitGoal refuses');
  throws(function () { core.cancelMission('m-aaaaaa-0001'); }, /CORE_DISABLED/,
    'rollback: cancelMission refuses');
  delete process.env.MYTHOS_CORE_ENABLED;

  // The rollback switch must live in configuration the operator can edit
  // without touching application code: the unit reads an EnvironmentFile.
  var unit = fs.readFileSync(path.join(EXEC, 'service', 'mythos-ai-executor.service'), 'utf8');
  ok(/EnvironmentFile=/.test(unit),
    'rollback: the service reads an EnvironmentFile, so the switch needs no code change');
  ok(!/MYTHOS_CORE_ENABLED\s*=\s*false/i.test(unit),
    'flag: the shipped unit does not pin the rollback value');
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
    // Supersession: the pre-resume executor task must not be left
    // WAITING_FOR_QUOTA for the Phase 1 daemon to resume behind us.
    var execState2 = require(path.join(EXEC, 'lib', 'state'));
    var lingering = execState2.listTasks().filter(function (id) {
      var s = execState2.readStatus(id);
      return s && s.status === 'WAITING_FOR_QUOTA';
    });
    ok(lingering.length === 0,
      'quota: superseded executor tasks are retired on resume (no duplicate daemon resume)');
    var done = mission.task_ids.map(function (id) { return store.load('task', id); })[0];
    ok((done.metadata.superseded_executor_tasks || []).length >= 1,
      'quota: supersession is recorded on the core task');
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
// 6b. LIFECYCLE RACE — cancel WHILE the bridge task is still RUNNING
// (found by the independent architecture reviewer, gemini-3.6-flash:
// registration used to happen only in the bridge promise's .then(), so a
// cancel arriving mid-flight saw an empty id list and orphaned the
// executor task — the very resurrection bug this stage must prevent.)
// ===========================================================================
chain = chain.then(function () {
  var core = require(path.join(EXEC, 'core', 'core-wiring'));
  var store = require(path.join(EXEC, 'core', 'store'));
  var execState = require(path.join(EXEC, 'lib', 'state'));

  // 'hang' never resolves: the bridge promise stays pending, so the task
  // is genuinely RUNNING when cancellation arrives.
  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'hang' }]);
  require(path.join(EXEC, 'providers', 'mock')).reset();

  var g = core.submitGoal({ text: 'Cancellation race probe while a task is running.',
    project: 'mythos-prod', requested_by: 'wiring-test' });

  var advancing = core.advanceMission(g.mission_id, { review: false });
  // Give the scheduler time to dispatch and the bridge to create its
  // executor task, but not to finish (it never will).
  return new Promise(function (r) { setTimeout(r, 600); }).then(function () {
    var first = store.load('task', g.mission_id ? store.load('mission', g.mission_id).task_ids[0] : null);
    ok(first.status === 'RUNNING', 'race: the core task is genuinely RUNNING mid-flight');
    var ids = (first.metadata.executor_task_ids || []).concat(
      first.executor_task_id ? [first.executor_task_id] : []);
    ok(ids.length >= 1, 'race: the executor task is discoverable DURING the run (not only after)');

    var result = core.cancelMission(g.mission_id, 'race probe');
    ok(result.executor_tasks_cancelled.length >= 1,
      'race: cancelling mid-flight CANCELS the in-flight executor task');
    var orphans = execState.listTasks().filter(function (id) {
      var st = execState.readStatus(id);
      return st && ['RUNNING', 'WAITING_RETRY', 'QUEUED', 'WAITING_FOR_QUOTA'].indexOf(st.status) !== -1;
    });
    ok(orphans.length === 0, 'race: no orphaned executor task survives the cancellation');
    advancing.catch(function () { /* the hung mission is abandoned by design */ });
  });
});

// ===========================================================================
// 6c. DAEMON / CORE OWNERSHIP — no double dispatch, no resume behind the core
// ===========================================================================
chain = chain.then(function () {
  var executor = require(path.join(EXEC, 'executor'));
  var execState = require(path.join(EXEC, 'lib', 'state'));

  // A core-owned task (as the bridge creates it) must be invisible to the
  // Phase 1 daemon scheduler; an ordinary task must still be picked up.
  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'success', summary: 'ownership probe' }]);
  require(path.join(EXEC, 'providers', 'mock')).reset();

  var coreOwned = executor.createTask({
    project: 'executor-selftest', stage: 'CORE-OWNED', instruction: 'core drives this',
    provider: 'mock', report_to_git: false, requested_by: 'orchestration-core'
  });
  return executor.tick().then(function (actions) {
    var touched = actions.some(function (a) { return a.task_id === coreOwned.task_id; });
    ok(!touched, 'ownership: the daemon never dispatches a core-owned task');
    ok(execState.readStatus(coreOwned.task_id).status === 'QUEUED',
      'ownership: the core-owned task is left QUEUED for the core');

    var normal = executor.createTask({
      project: 'executor-selftest', stage: 'DAEMON-OWNED', instruction: 'daemon drives this',
      provider: 'mock', report_to_git: false
    });
    return executor.tick().then(function (acts2) {
      ok(acts2.some(function (a) { return a.task_id === normal.task_id && a.action === 'start'; }),
        'ownership: ordinary Phase 1 tasks are still dispatched (behaviour unchanged)');
      // Park the core-owned task on quota and prove the daemon leaves it alone.
      execState.transition(coreOwned.task_id, 'RUNNING', { pid: null });
      execState.transition(coreOwned.task_id, 'WAITING_FOR_QUOTA', {
        quota_state: { waits: 1, detected_at: new Date().toISOString(),
          reset_at: null, resume_after: new Date(Date.now() - 1000).toISOString() }
      });
      return executor.tick();
    }).then(function (acts3) {
      ok(!acts3.some(function (a) { return a.task_id === coreOwned.task_id; }),
        'ownership: the daemon never resumes a core-owned quota-parked task behind the core');
      execState.transition(coreOwned.task_id, 'CANCELLED', { next_action: 'test cleanup' });
    });
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

    // Rolled back ⇒ 503 even with a valid token.
    process.env.MYTHOS_CORE_ENABLED = 'false';
    return req('POST', '/goals', { text: 'Analyze the repository for improvements' }, TOKEN);
  }).then(function (res) {
    ok(res.code === 503 && /core disabled/.test(res.body.error),
      'api: rollback → 503 core disabled even when authenticated');
    delete process.env.MYTHOS_CORE_ENABLED;   // back to the default-on path
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
// 9. EMERGENCY ROLLBACK — Phase 1 path with MYTHOS_CORE_ENABLED=false
// ===========================================================================
chain = chain.then(function () {
  var server = require(path.join(EXEC, 'server'));
  var executor = require(path.join(EXEC, 'executor'));
  process.env.MYTHOS_CORE_ENABLED = 'false';   // explicit rollback
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
    ok(res.code === 503, 'rollback: the goal surface is closed while rolled back');
    servers.forEach(function (s) { s.close(); });
    delete process.env.MYTHOS_EXECUTOR_TOKEN;
    delete process.env.MYTHOS_CORE_ENABLED;   // restore the default-on state
    ok(require(path.join(EXEC, 'core', 'core-wiring')).coreEnabled() === true,
      'rollback: removing the override restores the core immediately');
  });
});

// ===========================================================================
// 10. CLI surface
// ===========================================================================
chain = chain.then(function () {
  var bin = path.join(EXEC, 'bin', 'mythos-ai-executor');
  var envOff = Object.assign({}, process.env, { MYTHOS_CORE_ENABLED: 'false' });
  var out = '';
  try {
    cp.execFileSync(process.execPath, [bin, 'goal', 'submit', 'Analyze something safely'],
      { encoding: 'utf8', env: envOff, stdio: ['ignore', 'pipe', 'pipe'] });
    ok(false, 'cli: goal submit should refuse when rolled back');
  } catch (e) {
    ok(/CORE_DISABLED/.test(String(e.stderr || e.stdout || e.message)),
      'cli: goal submit refuses when rolled back');
  }
  // Default-on: no flag needed at all.
  var envOn = Object.assign({}, process.env);
  delete envOn.MYTHOS_CORE_ENABLED;
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
// 11. CONCURRENT DISPATCH (capability Q) — independent DAG branches actually
// overlap through the REAL Phase 1 bridge, not just the injectable mock
// runner other suites use. The mock provider's run() is gated so the FIRST
// branch cannot resolve until the SECOND has also started: if the bridge
// (core-wiring → orchestrator.executorBridge → executor.runTask) secretly
// serialized dispatch, the second call would never happen and this would
// hang — caught by the race timeout below instead of wedging the suite.
// ===========================================================================
chain = chain.then(function () {
  var core = require(path.join(EXEC, 'core', 'core-wiring'));
  var store = require(path.join(EXEC, 'core', 'store'));
  var orchestrator = require(path.join(EXEC, 'core', 'orchestrator'));
  var mockProvider = require(path.join(EXEC, 'providers', 'mock'));

  var submittedProbe = orchestrator.submitGoal('Two independent branches for the concurrency probe.', {
    project: 'mythos-prod', requested_by: 'wiring-test',
    spec: {
      title: 'Concurrent branches probe',
      tasks: [
        { key: 'branch-a', title: 'Independent branch A', task_type: 'analysis', capabilities_required: ['analysis'], depends_on: [] },
        { key: 'branch-b', title: 'Independent branch B', task_type: 'analysis', capabilities_required: ['analysis'], depends_on: [] }
      ]
    }
  });
  ok(!submittedProbe.rejected, 'Q concurrent: two-branch mission planned and validated');
  var missionId = submittedProbe.mission.id;

  var originalRun = mockProvider.run;
  var startedCount = 0;
  var releaseOrder = [];
  var pending = [];
  mockProvider.run = function (task, prompt, sessionId, mode, opts, onSpawn) {
    startedCount += 1;
    if (typeof onSpawn === 'function') onSpawn(process.pid);
    var outcome = {
      exit_code: 0, signal: null, timed_out: false, duration_ms: 1, stdout: '', stderr: '',
      session_id: sessionId, started_pid: process.pid,
      parsed: { is_error: false, result: 'done\n```json\n{"mythos_report": true, ' +
        '"status": "completed", "summary": "concurrent probe ok", "tests": ["mock: pass"], "commit": null}\n```' }
    };
    return new Promise(function (resolve) {
      pending.push(function () { releaseOrder.push(task.task_id); resolve(outcome); });
      if (startedCount >= 2) {
        var toRelease = pending; pending = [];
        toRelease.forEach(function (fn) { fn(); });
      }
    });
  };

  var timedOut = false;
  var timeout = new Promise(function (_res, reject) {
    setTimeout(function () { timedOut = true; reject(new Error('CONCURRENCY_TIMEOUT: second branch never started — dispatch is serialized')); }, 5000);
  });

  return Promise.race([
    core.advanceMission(missionId, { review: false, max_parallel: 2 }),
    timeout
  ]).then(function (mission) {
    mockProvider.run = originalRun;
    ok(!timedOut, 'Q concurrent: the second independent branch started before the first resolved');
    ok(startedCount === 2, 'Q concurrent: both branches actually invoked the real provider');
    ok(mission.status === 'COMPLETED', 'Q concurrent: mission completed through the real bridge');
    var tasks = mission.task_ids.map(function (id) { return store.load('task', id); });
    ok(tasks.every(function (t) { return t.status === 'COMPLETED' && t.executor_task_id; }),
      'Q concurrent: both branches ran as real (non-stubbed) executor tasks');
    ok(mission.metadata.peak_concurrency >= 2,
      'Q concurrent: scheduler recorded genuine parallel dispatch, not just sequential success');
  }, function (err) {
    mockProvider.run = originalRun;
    throw err;
  });
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
