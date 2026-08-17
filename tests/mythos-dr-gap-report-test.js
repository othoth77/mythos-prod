'use strict';
// =====================================================
// MYTHOS — AF Disaster Recovery: runtime-state gap report tests
// tests/mythos-dr-gap-report-test.js
//
// Covers projects/mythos-ai-executor/core/dr-gap-report.js and the
// read-only `dr-report` CLI verb. Deterministic and offline: the report
// only reads a throwaway fixture store root (never the real
// /home/.../mythos-ai-executor/orchestration/), never writes, and consumes
// no provider quota.
//
// Run with: node tests/mythos-dr-gap-report-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIXTURES = path.join(os.homedir(), 'mythos-dr-gap-report-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');

var domain = require(path.join(EXEC, 'core', 'domain'));
var store = require(path.join(EXEC, 'core', 'store'));
var drReport = require(path.join(EXEC, 'core', 'dr-gap-report'));

var passed = 0;
var failed = 0;
var failures = [];

function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

// --- Empty store: honest zero-state report -----------------------------------
(function () {
  var report = drReport.buildReport();
  ok(report.runtime_state_root === store.root(),
    'DR-0: report root matches store.root()');
  ok(drReport.ENTITY_TYPES.every(function (t) { return report.entities[t] === 0; }),
    'DR-0: every entity type counts zero before anything is created');
  ok(report.total_entities === 0, 'DR-0: total_entities zero on an empty store');
  ok(report.events_log.present === false && report.events_log.bytes === 0,
    'DR-0: no events.log yet on an empty store');
})();

// --- Populated store: counts reflect real persisted entities -----------------
(function () {
  var goal = domain.createGoal({ text: 'dr coverage goal', project: 'mythos-prod' });
  store.create(goal);
  var task1 = domain.createTask({ title: 'dr coverage task 1', correlation_id: goal.id });
  var task2 = domain.createTask({ title: 'dr coverage task 2', correlation_id: goal.id });
  store.create(task1);
  store.create(task2);
  store.appendEventLine({ event_type: 'GOAL_CREATED', subject_id: goal.id });

  var report = drReport.buildReport();
  ok(report.root_exists === true, 'DR-1: root_exists true once entities are written');
  ok(report.entities.goal === 1, 'DR-1: goal count reflects the one created goal');
  ok(report.entities.task === 2, 'DR-1: task count reflects both created tasks');
  ok(report.entities.mission === 0, 'DR-1: untouched entity type still counts zero');
  ok(report.total_entities === 3, 'DR-1: total_entities sums across all entity types');
  ok(report.events_log.present === true && report.events_log.bytes > 0,
    'DR-1: events.log now present and non-empty');
})();

// --- The gap is always reported honestly, regardless of store contents ------
(function () {
  var report = drReport.buildReport();
  ok(report.off_host_destination_configured === false,
    'DR-2: off_host_destination_configured is false — no destination exists for this data');
  ok(typeof report.off_host_destination_reason === 'string' &&
     /idauto, coolify, darhijama_prod/.test(report.off_host_destination_reason),
    'DR-2: reason names the existing off-host tooling and why it does not cover this root');
  ok(report.rebuild_on_new_host === 'NOT_POSSIBLE',
    'DR-2: rebuild_on_new_host is NOT_POSSIBLE while the gap stands');
  ok(report.rebuild_blocker === 'NO_OFFHOST_DESTINATION_FOR_RUNTIME_STATE',
    'DR-2: rebuild_blocker names the exact blocker');
  ok(typeof report.generated_at === 'string' && !isNaN(Date.parse(report.generated_at)),
    'DR-2: generated_at is a valid ISO timestamp');
})();

// --- CLI surface: `dr-report` is read-only and matches the module directly --
(function () {
  var bin = path.join(EXEC, 'bin', 'mythos-ai-executor');
  var out = cp.execFileSync(process.execPath, [bin, 'dr-report'], {
    env: Object.assign({}, process.env, { MYTHOS_EXECUTOR_HOME: process.env.MYTHOS_EXECUTOR_HOME }),
    encoding: 'utf8'
  });
  var parsed;
  try { parsed = JSON.parse(out); } catch (e) { parsed = null; }
  ok(parsed !== null, 'DR-3: `dr-report` CLI prints parseable JSON');
  ok(parsed && parsed.off_host_destination_configured === false,
    'DR-3: CLI output carries the same honest gap as the direct module call');
  ok(parsed && parsed.total_entities === 3,
    'DR-3: CLI output reflects the same fixture store as the direct module call');

  var before = drReport.buildReport();
  cp.execFileSync(process.execPath, [bin, 'dr-report'], {
    env: Object.assign({}, process.env), encoding: 'utf8'
  });
  var after = drReport.buildReport();
  ok(before.total_entities === after.total_entities,
    'DR-3: running the CLI report does not itself change the store contents');
})();

fs.rmSync(FIXTURES, { recursive: true, force: true });

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.error('\nFailures:\n' + failures.map(function (f) { return '  - ' + f; }).join('\n'));
  process.exit(1);
}
process.exit(0);
