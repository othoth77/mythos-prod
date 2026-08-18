'use strict';
// =====================================================
// Mythos Orchestration Core — dashboard read model (capability AE)
// projects/mythos-ai-executor/core/dashboard.js
//
// docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md §AE / docs/MYTHOS_CONTROL_
// CENTER_PRODUCT_SPEC.md: mission/task/agent/provider monitoring plus
// cost/quota/state visibility. This is a pure read model — it aggregates
// existing accessors (store, budget, agent-registry) and never mutates
// state, budget, policy, or events. No new persistence, no new mutation
// path: same single chokepoints as everything else in core/.
// =====================================================

var store = require('./store');
var budget = require('./budget');
var agentRegistry = require('./agent-registry');

var DEFAULT_PROJECT = 'mythos-prod';
var RECENT_LIMIT = 10;
var ACTIVE_MISSION_STATUSES = ['RUNNING', 'WAITING', 'INTEGRATING'];

function countBy(list, key) {
  var counts = {};
  list.forEach(function (item) {
    var v = item[key] || 'UNKNOWN';
    counts[v] = (counts[v] || 0) + 1;
  });
  return counts;
}

function projectFilter(project) {
  return project ? function (e) { return e.project === project; } : null;
}

function pickMission(m) {
  return {
    id: m.id, status: m.status, project: m.project, title: m.title,
    task_count: (m.task_ids || []).length, created_at: m.created_at, updated_at: m.updated_at
  };
}

function pickTask(t) {
  return {
    id: t.id, status: t.status, mission_id: t.mission_id, project: t.project,
    agent: t.agent_id, task_type: t.task_type, attempt: t.attempt,
    created_at: t.created_at, updated_at: t.updated_at
  };
}

function budgetSnapshot(project, opts) {
  try {
    return budget.status(project, { scope: opts.budget_scope, config: opts.budget_config });
  } catch (e) {
    return { project: project, error: e.message };
  }
}

// Cost/quota visibility for currently active missions only — a mission
// that already finished has nothing an operator needs to watch live.
function missionBudgets(missions, project, opts) {
  return missions
    .filter(function (m) { return ACTIVE_MISSION_STATUSES.indexOf(m.status) !== -1; })
    .slice(0, opts.mission_budget_limit || RECENT_LIMIT)
    .map(function (m) {
      try {
        return budget.missionStatus(m.project || project, m.id, { config: opts.budget_config });
      } catch (e) {
        return { mission_id: m.id, error: e.message };
      }
    });
}

// Single point-in-time snapshot, optionally scoped to one project. Every
// figure here is derived on read; nothing is cached or written.
function snapshot(opts) {
  opts = opts || {};
  var project = opts.project || null;
  var missions = store.list('mission', projectFilter(project));
  var tasks = store.list('task', projectFilter(project));
  var agents = agentRegistry.discoverAgents();
  var recentLimit = opts.recent_limit || RECENT_LIMIT;
  var budgetProject = opts.budget_project || project || DEFAULT_PROJECT;

  return {
    generated_at: new Date().toISOString(),
    project: project,
    missions: {
      total: missions.length,
      by_status: countBy(missions, 'status'),
      recent: missions.slice(-recentLimit).reverse().map(pickMission)
    },
    tasks: {
      total: tasks.length,
      by_status: countBy(tasks, 'status'),
      recent: tasks.slice(-recentLimit).reverse().map(pickTask)
    },
    agents: {
      total: agents.length,
      available: agents.filter(function (a) { return a.available; }).length,
      by_provider: countBy(agents, 'provider'),
      list: agents
    },
    budget: budgetSnapshot(budgetProject, opts),
    mission_budgets: missionBudgets(missions, budgetProject, opts)
  };
}

module.exports = {
  DEFAULT_PROJECT: DEFAULT_PROJECT,
  snapshot: snapshot
};
