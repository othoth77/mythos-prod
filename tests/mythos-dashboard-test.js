'use strict';
// =====================================================
// MYTHOS — Dashboard read model tests (capability AE)
// tests/mythos-dashboard-test.js
//
// Covers projects/mythos-ai-executor/core/dashboard.js: mission/task
// counts and recency, project scoping, agent/provider visibility, and
// cost/quota (budget) visibility. Deterministic and offline — entities
// are written directly through domain+store, budget uses an injected
// config so no real budgets.json or provider quota is touched. Fixture
// root lives under the home directory (never /tmp) and is removed at
// the end, per the same contract as the other core suites.
//
// Run with: node tests/mythos-dashboard-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIXTURES = path.join(os.homedir(), 'mythos-dashboard-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');

var domain = require(path.join(EXEC, 'core', 'domain'));
var store = require(path.join(EXEC, 'core', 'store'));
var dashboard = require(path.join(EXEC, 'core', 'dashboard'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

var BUDGET_CFG = {
  config_id: 'dashboard-test-budgets',
  defaults: { currency: 'USD', timezone: 'UTC' },
  projects: {
    'proj-a': { daily_limit: 10, request_limit: 5, mission_limit: 8 }
  }
};

function makeGoalMissionTask(project, missionStatus, taskStatus) {
  var goal = domain.createGoal({ text: 'Dashboard fixture goal for ' + project, project: project });
  store.create(goal);
  var mission = domain.createMission({ goal_id: goal.id, title: 'Fixture mission', project: project });
  store.create(mission);
  var task = domain.createTask({ mission_id: mission.id, title: 'Fixture task', project: project, agent_id: 'claude-code' });
  store.create(task);
  mission.task_ids = [task.id];
  store.save(mission);
  if (missionStatus && missionStatus !== mission.status) {
    mission = store.transition('mission', mission.id, missionStatus);
  }
  if (taskStatus && taskStatus !== task.status) {
    task = store.transition('task', task.id, taskStatus);
  }
  return { goal: goal, mission: mission, task: task };
}

// ===========================================================================
// 1. Empty state — never crashes with nothing recorded yet
// ===========================================================================
(function () {
  var snap = dashboard.snapshot({ project: 'nothing-recorded-yet', budget_config: BUDGET_CFG });
  ok(snap.missions.total === 0 && snap.tasks.total === 0, 'empty: zero missions/tasks for an unused project');
  ok(Array.isArray(snap.missions.recent) && snap.missions.recent.length === 0, 'empty: no recent missions');
  ok(snap.agents.total > 0, 'empty: the agent registry is populated even with no orchestration activity');
  ok(!!snap.generated_at, 'empty: snapshot is timestamped');
})();

// ===========================================================================
// 2. Mission/task counts and project scoping
// ===========================================================================
(function () {
  makeGoalMissionTask('proj-a', 'VALIDATED', 'READY');
  makeGoalMissionTask('proj-a', null, null);          // stays PLANNED / QUEUED
  makeGoalMissionTask('proj-b', 'VALIDATED', 'READY');

  var all = dashboard.snapshot({ budget_config: BUDGET_CFG });
  ok(all.missions.total === 3, 'scope: unscoped snapshot counts every project\'s missions');
  ok(all.tasks.total === 3, 'scope: unscoped snapshot counts every project\'s tasks');

  var scoped = dashboard.snapshot({ project: 'proj-a', budget_config: BUDGET_CFG });
  ok(scoped.missions.total === 2, 'scope: project filter narrows mission count');
  ok(scoped.tasks.total === 2, 'scope: project filter narrows task count');
  ok(scoped.missions.recent.every(function (m) { return m.project === 'proj-a'; }),
    'scope: recent missions all belong to the scoped project');

  ok(scoped.missions.by_status.VALIDATED === 1 && scoped.missions.by_status.PLANNED === 1,
    'counts: missions grouped by status');
  ok(scoped.tasks.by_status.READY === 1 && scoped.tasks.by_status.QUEUED === 1,
    'counts: tasks grouped by status');
})();

// ===========================================================================
// 3. Agent / provider visibility
// ===========================================================================
(function () {
  var snap = dashboard.snapshot({ budget_config: BUDGET_CFG });
  var names = snap.agents.list.map(function (a) { return a.name; });
  ok(names.indexOf('claude-code') !== -1, 'agents: claude-code is listed');
  ok(names.indexOf('gemini-advisor') !== -1, 'agents: gemini-advisor is listed');
  ok(typeof snap.agents.by_provider['claude-code'] === 'number', 'agents: grouped by provider');
  ok(snap.agents.available <= snap.agents.total, 'agents: available count never exceeds total');
})();

// ===========================================================================
// 4. Cost / quota visibility
// ===========================================================================
(function () {
  var snap = dashboard.snapshot({ project: 'proj-a', budget_project: 'proj-a', budget_config: BUDGET_CFG });
  ok(snap.budget.configured === true, 'budget: configured project reports its limits');
  ok(snap.budget.limit === 10, 'budget: daily limit reflects the injected config');
  ok(snap.budget.remaining === 10, 'budget: remaining equals the limit with nothing spent yet');

  var unconfigured = dashboard.snapshot({ project: 'proj-b', budget_project: 'proj-b', budget_config: BUDGET_CFG });
  ok(unconfigured.budget.configured === false, 'budget: an unlisted project is reported unconfigured, never a default allowance');

  var running = makeGoalMissionTask('proj-a', 'VALIDATED', null);
  running.mission = store.transition('mission', running.mission.id, 'RUNNING');
  var withActive = dashboard.snapshot({ project: 'proj-a', budget_project: 'proj-a', budget_config: BUDGET_CFG });
  ok(withActive.mission_budgets.some(function (mb) { return mb.mission_id === running.mission.id; }),
    'budget: an active (RUNNING) mission gets its own per-mission budget entry');
  ok(withActive.mission_budgets.every(function (mb) { return !mb.error; }),
    'budget: per-mission budget lookups succeed for real missions');
})();

// ===========================================================================
// Summary
// ===========================================================================
fs.rmSync(FIXTURES, { recursive: true, force: true });
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failures.length) {
  console.log('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
process.exit(0);
