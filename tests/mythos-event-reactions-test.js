'use strict';
// =====================================================
// MYTHOS — Event Bus reactions test (roadmap capability Y precursor)
// tests/mythos-event-reactions-test.js
//
// Offline and deterministic: exercises core/event-reactions.js against the
// REAL core/events.js + core/store.js (so the subscribe() contract is
// proven, not assumed) with a mocked child_process.spawn so no real ntfy
// notification, network call, or shell script ever runs.
//
// Run with: node tests/mythos-event-reactions-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIXTURES = path.join(os.homedir(), 'mythos-event-reactions-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');

var events = require(path.join(EXEC, 'core', 'events'));
var reactions = require(path.join(EXEC, 'core', 'event-reactions'));

var passed = 0;
var failed = 0;
var failures = [];

function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

function fakeSpawn(calls, opts) {
  return function spawn(cmd, args) {
    calls.push({ cmd: cmd, args: args });
    if (opts && opts.throwOn && opts.throwOn(cmd, args)) throw new Error('spawn failed');
    return { on: function () {}, unref: function () {} };
  };
}

// --- Only the curated event types get wired up ------------------------------
(function () {
  events.resetSubscribersForTests();
  var calls = [];
  var unregister = reactions.registerNtfyReactions(events, { spawn: fakeSpawn(calls) });

  events.emit('MISSION_FAILED', { subject_id: 'ms-aaaaaa-0001', project: 'demo', detail: { reason: 'boom' } });
  ok(calls.length === 1, 'Y events: mapped event type triggers exactly one notify call');
  ok(/notify\.sh$/.test(calls[0].cmd), 'Y events: notify.sh is invoked');
  ok(calls[0].args[0] === 'task_failed', 'Y events: MISSION_FAILED maps to task_failed');
  ok(calls[0].args[1] === 'demo/ms-aaaaaa-0001', 'Y events: stage carries project + subject');
  ok(/"reason":"boom"/.test(calls[0].args[2]), 'Y events: detail is forwarded as JSON');

  events.emit('BUDGET_CHECKED', { subject_id: 'ms-aaaaaa-0001' });
  ok(calls.length === 1, 'Y events: unmapped event types produce no notification');

  unregister();
})();

// --- unregister() actually removes the subscriptions -------------------------
(function () {
  events.resetSubscribersForTests();
  var calls = [];
  var unregister = reactions.registerNtfyReactions(events, { spawn: fakeSpawn(calls) });
  unregister();
  events.emit('MISSION_COMPLETED', { subject_id: 'ms-aaaaaa-0002' });
  ok(calls.length === 0, 'Y events: unregister removes every subscription');
})();

// --- every mapped event type is a real, valid EVENT_TYPE --------------------
(function () {
  var domain = require(path.join(EXEC, 'core', 'domain'));
  var allValid = Object.keys(reactions.EVENT_MAP).every(function (type) {
    return domain.EVENT_TYPES.indexOf(type) !== -1;
  });
  ok(allValid, 'Y events: every EVENT_MAP key is a real domain event type');
})();

// --- a throwing spawn never propagates (mirrors notify.sh's own contract) ---
(function () {
  events.resetSubscribersForTests();
  var calls = [];
  var unregister = reactions.registerNtfyReactions(events, {
    spawn: fakeSpawn(calls, { throwOn: function () { return true; } })
  });
  var threw = false;
  try { events.emit('APPROVAL_REQUESTED', { subject_id: 'ms-aaaaaa-0003' }); }
  catch (e) { threw = true; }
  ok(threw === false, 'Y events: a failing notification never breaks emit');
  unregister();
})();

// --- durable emission is unaffected by having reactions registered ----------
(function () {
  events.resetSubscribersForTests();
  var before = events.replay().length;
  var unregister = reactions.registerNtfyReactions(events, { spawn: fakeSpawn([]) });
  events.emit('ROLLBACK', { subject_id: 'ms-aaaaaa-0004' });
  ok(events.replay().length === before + 1, 'Y events: emission stays durable with reactions registered');
  unregister();
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
fs.rmSync(FIXTURES, { recursive: true, force: true });
if (failures.length) {
  console.log('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
process.exit(0);
