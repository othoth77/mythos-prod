'use strict';
// =====================================================
// MYTHOS — AF. Disaster Recovery: runtime-state gap report tests
// tests/mythos-dr-readiness-test.js
//
// Covers projects/mythos-ai-executor/core/dr-readiness.js: a read-only
// inventory of the orchestrator's own runtime state (store.root()) and
// the honest statement that none of it has an off-host destination —
// distinct from the idauto/coolify/darhijama product-database backup
// gate. Fixture root lives under the home directory (never /tmp), removed
// at the end. No network call, no credential, no mutation.
//
// Run with: node tests/mythos-dr-readiness-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIXTURES = path.join(os.homedir(), 'mythos-dr-readiness-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');

var store = require(path.join(EXEC, 'core', 'store'));
var domain = require(path.join(EXEC, 'core', 'domain'));
var dr = require(path.join(EXEC, 'core', 'dr-readiness'));

var passed = 0;
var failed = 0;
var failures = [];

function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

// --- Empty root: no runtime state has ever been written --------------------
(function () {
  var inv = dr.inventory();
  ok(inv.root_exists === false, 'empty: root does not exist yet');
  ok(inv.total_local_files === 0, 'empty: no local files counted');
  ok(inv.events_log.exists === false, 'empty: no events.log');

  var rep = dr.report();
  ok(rep.gap === false, 'empty: no gap when there is nothing local to lose');
  ok(rep.off_host_backup.configured === false, 'empty: off-host backup honestly reported as not configured');
  ok(rep.capability === 'AF. Disaster Recovery', 'empty: report is tagged to the AF capability');
})();

// --- Populated root: entities and an events log exist -----------------------
(function () {
  var goal = { entity_type: 'goal', id: domain.newId('goal'), status: 'RECEIVED', created_at: new Date().toISOString() };
  store.create(goal);
  store.appendEventLine({ event_type: 'GOAL_CREATED', subject_id: goal.id, detail: {} });

  var inv = dr.inventory();
  ok(inv.root_exists === true, 'populated: root exists once a store write happened');
  ok(inv.entities.goals.files === 1, 'populated: exactly one goal file counted');
  ok(inv.entities.goals.bytes > 0, 'populated: goal file byte size recorded');
  ok(typeof inv.entities.goals.newest === 'string', 'populated: newest mtime recorded as ISO string');
  ok(inv.events_log.exists === true, 'populated: events.log exists after appendEventLine');
  ok(inv.events_log.lines === 1, 'populated: events.log line count matches writes');
  ok(inv.total_local_files === 2, 'populated: total local files counts the goal and the events log');

  var rep = dr.report();
  ok(rep.gap === true, 'populated: gap is true once local-only state exists');
  ok(Array.isArray(rep.off_host_backup.known_offhost_targets) && rep.off_host_backup.known_offhost_targets.length === 3,
    'populated: known off-host targets names the three product databases, not this directory');
})();

// --- Read-only contract: dr-readiness never writes anything ----------------
(function () {
  var before = fs.readdirSync(store.root()).sort();
  dr.inventory();
  dr.report();
  var after = fs.readdirSync(store.root()).sort();
  ok(JSON.stringify(before) === JSON.stringify(after), 'read-only: root directory listing unchanged after inventory()/report()');
})();

// --- dirStats on a missing directory ----------------------------------------
(function () {
  var missing = dr.dirStats(path.join(store.root(), 'no-such-dir'));
  ok(missing.exists === false && missing.files === 0 && missing.bytes === 0 && missing.newest === null,
    'dirStats: missing directory reports a clean zero shape, not a throw');
})();

fs.rmSync(FIXTURES, { recursive: true, force: true });

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.error('Failures: ' + failures.join(', '));
  process.exit(1);
}
