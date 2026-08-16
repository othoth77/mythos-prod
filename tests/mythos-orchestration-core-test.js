'use strict';
// =====================================================
// MYTHOS — Phase 2 Orchestration Core tests
// tests/mythos-orchestration-core-test.js
//
// Grows with each Phase 2 sub-stage (2A → 2M); every commit runs the
// whole file, so later stages are permanent regression cover for earlier
// ones. Deterministic and offline: providers, money, advertising, image
// generation and external APIs are mocks; Git behaviour runs against
// throwaway repositories; NO real AI quota is consumed.
//
// Fixture root lives under the home directory (never /tmp — the same
// contract as the Phase 1 suites) and is removed at the end.
//
// Run with: node tests/mythos-orchestration-core-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIXTURES = path.join(os.homedir(), 'mythos-core-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');

var domain = require(path.join(EXEC, 'core', 'domain'));
var store = require(path.join(EXEC, 'core', 'store'));

var passed = 0;
var failed = 0;
var failures = [];

function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

function throws(fn, re, name) {
  try { fn(); ok(false, name + ' (did not throw)'); }
  catch (e) { ok(re.test(e.message), name + ' (threw: ' + e.message.slice(0, 90) + ')'); }
}

// ===========================================================================
// PHASE 2A — domain model + persistent orchestration state
// ===========================================================================

// --- Identity and construction ---------------------------------------------
(function () {
  var id = domain.newId('task');
  ok(/^tk-/.test(id) && domain.isValidId(id), '2A id: task ids are prefixed and valid');
  ok(!domain.isValidId('../../etc/passwd'), '2A id: traversal is not a valid id');
  ok(!domain.isValidId('tk-UPPER-case'), '2A id: uppercase refused');
  throws(function () { domain.newId('nonsense'); }, /UNKNOWN_ENTITY_TYPE/, '2A id: unknown entity type refused');

  var goal = domain.createGoal({ text: 'Improve product search', project: 'ssangyong-autos' });
  ok(goal.status === 'RECEIVED' && goal.correlation_id === goal.id, '2A goal: constructed with defaults');
  throws(function () { domain.createGoal({}); }, /MISSING_FIELD: text/, '2A goal: empty text refused');

  var mission = domain.createMission({
    goal_id: goal.id, title: 'Search improvement', correlation_id: goal.correlation_id, parent_id: goal.id
  });
  ok(mission.correlation_id === goal.id && mission.parent_id === goal.id, '2A mission: correlation threads through');

  var task = domain.createTask({ title: 'Inspect current search', mission_id: mission.id });
  ok(task.status === 'QUEUED' && task.max_attempts === 3, '2A task: defaults sane');
  throws(function () { domain.createEvent({ event_type: 'NOT_A_REAL_EVENT' }); },
    /UNKNOWN_EVENT_TYPE/, '2A event: unknown type refused');
})();

// --- Transition tables -----------------------------------------------------
(function () {
  ok(domain.taskTransitionAllowed('QUEUED', 'READY'), '2A transitions: QUEUED→READY legal');
  ok(domain.taskTransitionAllowed('RUNNING', 'WAITING_FOR_QUOTA'), '2A transitions: RUNNING→WAITING_FOR_QUOTA legal');
  ok(domain.taskTransitionAllowed('WAITING_FOR_QUOTA', 'RUNNING'), '2A transitions: quota resume legal');
  ok(domain.taskTransitionAllowed('VALIDATING', 'RETRYING'), '2A transitions: validation rejection → repair legal');
  throws(function () { domain.taskTransitionAllowed('QUEUED', 'COMPLETED'); },
    /ILLEGAL_TRANSITION/, '2A transitions: QUEUED cannot jump to COMPLETED');
  throws(function () { domain.taskTransitionAllowed('COMPLETED', 'RUNNING'); },
    /ILLEGAL_TRANSITION/, '2A transitions: COMPLETED is terminal');
  throws(function () { domain.taskTransitionAllowed('NOWHERE', 'READY'); },
    /UNKNOWN_STATE/, '2A transitions: unknown state refused');

  // Compat adapter: Phase 1 executor vocabulary maps both ways, and an
  // executor COMPLETED enters core VALIDATING — never trusted directly.
  ok(domain.TASK_STATE_COMPAT.fromExecutor.COMPLETED === 'VALIDATING',
    '2A compat: executor COMPLETED → core VALIDATING');
  ok(domain.TASK_STATE_COMPAT.fromExecutor.WAITING_RETRY === 'RETRYING' &&
     domain.TASK_STATE_COMPAT.toExecutor.RETRYING === 'WAITING_RETRY',
    '2A compat: retry states round-trip');
  Object.keys(domain.TASK_STATE_COMPAT.fromExecutor).forEach(function (k) {
    ok(domain.TASK_STATES.indexOf(domain.TASK_STATE_COMPAT.fromExecutor[k]) !== -1,
      '2A compat: fromExecutor["' + k + '"] lands in a real core state');
  });
})();

// --- Persistence, duplicates, transitions through the store -----------------
(function () {
  var goal = domain.createGoal({ text: 'persist me', project: 'mythos-prod' });
  store.create(goal);
  var loaded = store.load('goal', goal.id);
  ok(loaded && loaded.text === 'persist me', '2A store: goal persists and loads');
  throws(function () { store.create(goal); }, /DUPLICATE_ENTITY/, '2A store: duplicate id refused');

  var task = domain.createTask({ title: 'stored task', correlation_id: goal.id });
  store.create(task);
  store.transition('task', task.id, 'READY');
  store.transition('task', task.id, 'RUNNING');
  ok(store.load('task', task.id).status === 'RUNNING', '2A store: transitions persist');
  throws(function () { store.transition('task', task.id, 'READY'); },
    /ILLEGAL_TRANSITION/, '2A store: illegal transition refused at the store');
  throws(function () { store.transition('task', 'tk-000000-zzzz', 'READY'); },
    /NO_SUCH_ENTITY/, '2A store: missing entity refused');

  // Secrets never persist raw.
  var dirty = domain.createTask({ title: 'leaky', instruction: 'use TOKEN=ghp_abcdefghijklmnopqrstuv123' });
  store.create(dirty);
  var raw = fs.readFileSync(store.entityFile('task', dirty.id), 'utf8');
  ok(raw.indexOf('ghp_abcdefghijklmnop') === -1 && raw.indexOf('[REDACTED]') !== -1,
    '2A store: persisted entities are redacted');

  // Store root is never /tmp in production.
  var saved = process.env.MYTHOS_EXECUTOR_HOME;
  delete process.env.MYTHOS_EXECUTOR_HOME;
  ok(store.root().indexOf('/tmp') !== 0, '2A store: production root not under /tmp');
  process.env.MYTHOS_EXECUTOR_HOME = saved;
})();

// --- Durable events ----------------------------------------------------------
(function () {
  var before = store.readEvents().length;
  store.appendEventLine({ event_type: 'GOAL_CREATED', subject_id: 'g-abc123-def4', detail: { note: 'x' } });
  store.appendEventLine({ event_type: 'QUOTA_EXHAUSTED', subject_id: 'tk-abc123-def4' });
  var events = store.readEvents();
  ok(events.length === before + 2, '2A events: appended durably');
  ok(events[events.length - 1].event_type === 'QUOTA_EXHAUSTED', '2A events: order preserved');
  throws(function () { store.appendEventLine({ event_type: 'FAKE' }); },
    /UNKNOWN_EVENT_TYPE/, '2A events: type enum enforced');

  // A torn tail line (crash mid-append) must not break reading.
  fs.appendFileSync(path.join(store.root(), 'events.log'), '{"half":');
  ok(store.readEvents().length === before + 2, '2A events: torn tail line tolerated');
  // Clean the torn line so later stages append valid JSONL.
  var content = fs.readFileSync(path.join(store.root(), 'events.log'), 'utf8');
  fs.writeFileSync(path.join(store.root(), 'events.log'),
    content.slice(0, content.lastIndexOf('{"half":')));
})();

// --- Restart recovery: a fresh process sees identical state -------------------
(function () {
  var goal = domain.createGoal({ text: 'survive restart', project: 'mythos-prod' });
  store.create(goal);
  var task = domain.createTask({ title: 'restartable', correlation_id: goal.id });
  store.create(task);
  store.transition('task', task.id, 'READY');

  var script =
    'var s = require(' + JSON.stringify(path.join(EXEC, 'core', 'store')) + ');' +
    'var t = s.load("task", ' + JSON.stringify(task.id) + ');' +
    'var g = s.load("goal", ' + JSON.stringify(goal.id) + ');' +
    'console.log(JSON.stringify({t: t.status, g: g.text, ev: s.readEvents().length > 0}));';
  var out = JSON.parse(cp.execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8', env: Object.assign({}, process.env)
  }).trim());
  ok(out.t === 'READY' && out.g === 'survive restart' && out.ev === true,
    '2A restart: fresh process recovers entities and events');
})();

// ===========================================================================
// Summary
// ===========================================================================
Promise.resolve().then(function () {
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
