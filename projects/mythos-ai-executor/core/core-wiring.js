'use strict';
// =====================================================
// Mythos Orchestration Core — production wiring (Core Wiring stage)
// projects/mythos-ai-executor/core/core-wiring.js
//
// THE real, non-test call site for orchestrator.executorBridge. Before
// this module the core was proven but unreachable from production: the
// first real mission verified that `bin/mythos-ai-executor serve` loaded
// only server.js + executor.js and executorBridge had zero non-test call
// sites (docs/MYTHOS_FIRST_MISSION_REPORT.md).
//
// Feature flag, load-bearing:
//
//   MYTHOS_CORE_ENABLED  default TRUE (Phase 2 finalization).
//     unset / true → the core is the normal orchestration path.
//     false        → EMERGENCY ROLLBACK: every core entry point refuses
//                    and Phase 1 behaviour is byte-identical (nothing
//                    here runs, no orchestration state is written).
//
// The rollback needs no code change: the service reads
// ~/.config/mythos-ai-executor/executor.env as an EnvironmentFile, so
// adding MYTHOS_CORE_ENABLED=false there and restarting restores the
// Phase 1 path immediately. See docs/MYTHOS_ORCHESTRATION_CORE.md.
//
// This module ADDS a path; it changes no Phase 1 behaviour and owns no
// orchestration state of its own — state lives in core/store.js, exactly
// once (no duplication).
//
// Lifecycle coupling (residual #1 from the first mission): every
// executor task the bridge creates is registered against its core task,
// so cancelling a goal/mission/task cancels the executor tasks it
// spawned instead of leaving them for the Phase 1 daemon to resurrect.
// =====================================================

var fs = require('fs');
var path = require('path');

var domain = require('./domain');
var store = require('./store');
var orchestrator = require('./orchestrator');
var planner = require('./planner');
var policyEngine = require('./policy-engine');
var events = require('./events');
var validation = require('./validation');
var state = require('../lib/state');
var executor = require('../executor');
var redact = require('../../mythos-orchestrator/lib/redact');

var REPO_PATH = process.env.MYTHOS_CORE_REPO_PATH || '/home/deploy/projects/mythos-prod';

// --- Feature flag --------------------------------------------------------------

// Default-on, but explicitly overridable: only the exact string "false"
// (case-insensitive, trimmed) disables the core, so a typo can never
// silently switch production onto the rollback path.
function coreEnabled() {
  var raw = process.env.MYTHOS_CORE_ENABLED;
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  return String(raw).trim().toLowerCase() !== 'false';
}

function assertEnabled() {
  if (!coreEnabled()) {
    var err = new Error('CORE_DISABLED: MYTHOS_CORE_ENABLED is not true — the orchestration core is off by default');
    err.code = 'CORE_DISABLED';
    throw err;
  }
}

// --- Goal intake contract -------------------------------------------------------

// Goal submissions are DATA. Nothing in a payload may select a provider,
// a working directory, an execution profile, or a policy class: those are
// derived here. Only a bounded, named set of fields is accepted.
var GOAL_FIELDS = ['text', 'project', 'requested_by', 'mission_kind', 'max_parallel', 'spec_key'];

// Named, committed mission shapes. A caller picks a KEY; it can never
// supply arbitrary task specs over HTTP (that would be a command channel).
var MISSION_KINDS = {
  'repo-analysis': {
    description: 'Read-only repository analysis producing a recommendation. No writes.',
    build: function (goalText) {
      var common = ' Work READ-ONLY: inspect files with your read tools; never write, never commit, ' +
        'never modify anything. Keep your mythos_report summary dense and complete (max ~1500 characters).';
      return {
        title: 'Repository analysis: ' + goalText.slice(0, 120),
        tasks: [
          { key: 'inspect', title: 'Inspect the repository', task_type: 'inspection',
            capabilities_required: ['repo_inspection'], policy_classes: ['READ'], depends_on: [],
            instruction: 'Inspect the repository for this goal: ' + goalText +
              ' Read the relevant files and state precisely what exists.' + common },
          { key: 'analyze', title: 'Analyze and identify the improvement', task_type: 'analysis',
            capabilities_required: ['analysis', 'repo_inspection'], policy_classes: ['READ'], depends_on: ['inspect'],
            instruction: 'Based on the repository evidence, identify ONE high-value improvement for: ' +
              goalText + ' Ground every claim in a file path. Recommend only; modify nothing.' + common },
          { key: 'report', title: 'Produce the structured report', task_type: 'reporting',
            capabilities_required: ['summarization', 'repo_inspection'], policy_classes: ['READ'], depends_on: ['analyze'],
            instruction: 'Produce the final structured report for: ' + goalText +
              ' Label every claim VERIFIED (evidence read), INFERRED, or RECOMMENDED.' + common }
        ]
      };
    }
  },
  'policy-probe': {
    description: 'Negative security probe: requests a protected action so the policy boundary is proven. Never executes.',
    build: function (goalText) {
      return {
        title: 'Policy probe: ' + goalText.slice(0, 120),
        tasks: [
          { key: 'destructive', title: 'Requested destructive action (must be denied)', task_type: 'generic',
            capabilities_required: ['analysis'], policy_classes: ['DESTRUCTIVE'], depends_on: [],
            instruction: 'This task must never execute: ' + goalText },
          { key: 'deploy', title: 'Requested deployment action (must be gated)', task_type: 'generic',
            capabilities_required: ['analysis'], policy_classes: ['DEPLOY'], depends_on: [],
            instruction: 'This task must never execute without approval: ' + goalText }
        ]
      };
    }
  }
};

function validateGoalPayload(payload) {
  var errors = [];
  if (!payload || typeof payload !== 'object') return { valid: false, errors: ['payload is not an object'] };
  Object.keys(payload).forEach(function (k) {
    if (GOAL_FIELDS.indexOf(k) === -1) errors.push('unexpected field: ' + String(k).slice(0, 40));
  });
  if (typeof payload.text !== 'string' || payload.text.trim().length < 8) {
    errors.push('text (string, >= 8 chars) is required');
  }
  if (payload.text && payload.text.length > 4000) errors.push('text exceeds 4000 characters');
  if (payload.project !== undefined && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(String(payload.project))) {
    errors.push('project must be a lowercase slug');
  }
  var kind = payload.mission_kind || 'repo-analysis';
  if (!MISSION_KINDS[kind]) {
    errors.push('unknown mission_kind: ' + String(kind).slice(0, 40) +
      ' (known: ' + Object.keys(MISSION_KINDS).join(', ') + ')');
  }
  if (payload.max_parallel !== undefined &&
      (!Number.isInteger(payload.max_parallel) || payload.max_parallel < 1 || payload.max_parallel > 4)) {
    errors.push('max_parallel must be an integer 1..4');
  }
  if (payload.text) {
    var kinds = redact.findSecretKinds(String(payload.text));
    if (kinds.length) errors.push('goal text carries secret shapes: ' + kinds.join(', '));
  }
  return { valid: errors.length === 0, errors: errors };
}

// --- Goal submission ---------------------------------------------------------------

// Creates a goal + validated mission through the REAL core. Returns
// { goal_id, mission_id, correlation_id, project, tasks[] } or throws.
function submitGoal(payload) {
  assertEnabled();
  var check = validateGoalPayload(payload);
  if (!check.valid) {
    var err = new Error('GOAL_INVALID: ' + check.errors.join('; '));
    err.code = 'GOAL_INVALID';
    throw err;
  }
  var kind = payload.mission_kind || 'repo-analysis';
  var project = payload.project || 'mythos-prod';
  var spec = MISSION_KINDS[kind].build(payload.text);

  var submitted = orchestrator.submitGoal(payload.text, {
    project: project,
    requested_by: payload.requested_by || 'goal-api',
    spec: spec
  });
  if (submitted.rejected) {
    var rej = new Error('GOAL_REJECTED: ' + submitted.errors.join('; '));
    rej.code = 'GOAL_REJECTED';
    rej.goal_id = submitted.goal.id;
    throw rej;
  }
  if (payload.max_parallel) {
    var mission = store.load('mission', submitted.mission.id);
    mission.max_parallel_agents = payload.max_parallel;
    mission.metadata.mission_kind = kind;
    store.save(mission);
  } else {
    var m2 = store.load('mission', submitted.mission.id);
    m2.metadata.mission_kind = kind;
    store.save(m2);
  }
  return {
    goal_id: submitted.goal.id,
    mission_id: submitted.mission.id,
    correlation_id: submitted.goal.correlation_id,
    project: project,
    mission_kind: kind,
    tasks: submitted.tasks.map(function (t) {
      return { id: t.id, key: t.metadata.plan_key, status: t.status };
    })
  };
}

// --- Executor bridge with lifecycle coupling -----------------------------------------

// Registers an executor task against its core task so cancellation and
// cleanup can reach it (residual #1 from the first mission: an orphaned
// bridge task was resurrected by the Phase 1 daemon after its mission
// had already finished).
function registerExecutorTask(coreTaskId, executorTaskId) {
  var t = store.load('task', coreTaskId);
  if (!t) return;
  t.executor_task_id = executorTaskId;
  t.metadata.executor_task_ids = (t.metadata.executor_task_ids || []).concat([executorTaskId]);
  store.save(t);
}

// Cancels every executor task spawned by a core task that is not already
// terminal. Cooperative: uses the Phase 1 state machine, never SIGKILL.
function cancelExecutorTasksFor(coreTask) {
  // Union of both records, and re-read from the store so an id registered
  // after this task object was loaded is not missed: cancellation must
  // never depend on the caller's snapshot being fresh.
  var fresh = store.load('task', coreTask.id) || coreTask;
  var ids = ((fresh.metadata && fresh.metadata.executor_task_ids) || [])
    .concat((coreTask.metadata && coreTask.metadata.executor_task_ids) || [])
    .concat(fresh.executor_task_id ? [fresh.executor_task_id] : [])
    .concat(coreTask.executor_task_id ? [coreTask.executor_task_id] : [])
    .filter(function (id, i, arr) { return id && arr.indexOf(id) === i; });
  var cancelled = [];
  ids.forEach(function (id) {
    try {
      var st = state.readStatus(id);
      if (!st) return;
      if (['COMPLETED', 'FAILED', 'CANCELLED'].indexOf(st.status) !== -1) return;
      // Never signal ourselves. A recorded pid equal to this process (or
      // its parent) means the record is bogus — signalling it would kill
      // the orchestrator/daemon instead of a worker. Cancel the task
      // record anyway; only the signal is skipped.
      var selfish = st.pid === process.pid || st.pid === process.ppid;
      if (st.status === 'RUNNING' && st.pid && !selfish && state.processAlive(st.pid)) {
        try { process.kill(st.pid, 'SIGTERM'); } catch (e) { /* raced its exit */ }
      }
      state.transition(id, 'CANCELLED', {
        pid: null, ended_at: new Date().toISOString(),
        next_action: 'cancelled with core task ' + coreTask.id
      });
      cancelled.push(id);
    } catch (e) { /* a single stuck executor task never blocks cancellation */ }
  });
  return cancelled;
}

// The production agent runner: routes through orchestrator.executorBridge
// (the real Phase 1 executor) and couples lifecycles.
function buildProductionRunner() {
  var bridge = orchestrator.executorBridge(executor);
  return function productionAgentRunner(agentName, task, ctx) {
    // Supersession: every new attempt creates a NEW executor task, so any
    // executor task from a previous attempt of THIS core task is obsolete.
    // Left alone it stays non-terminal (e.g. WAITING_FOR_QUOTA after a
    // quota pause) and the Phase 1 daemon would eventually resume it —
    // duplicating work and burning quota. Retire them first.
    var superseded = cancelExecutorTasksFor(store.load('task', task.id) || task);
    if (superseded.length) {
      var st = store.load('task', task.id);
      if (st) {
        st.metadata.superseded_executor_tasks =
          (st.metadata.superseded_executor_tasks || []).concat(superseded);
        store.save(st);
      }
    }
    var before = state.listTasks();
    return Promise.resolve(bridge(agentName, task, ctx)).then(function (result) {
      // The bridge records executor_task_id on the task; mirror it into
      // the cancellable list.
      var t = store.load('task', task.id);
      if (t && t.executor_task_id) registerExecutorTask(task.id, t.executor_task_id);
      return result;
    }, function (err) {
      // Even on a bridge error, adopt any executor task that appeared so
      // it can never be orphaned.
      var after = state.listTasks().filter(function (id) { return before.indexOf(id) === -1; });
      after.forEach(function (id) { registerExecutorTask(task.id, id); });
      throw err;
    });
  };
}

// --- Mission advancement ------------------------------------------------------------

// Advances a mission through the real core with the production runner.
// Safe to call repeatedly (quota/approval waits resume).
function advanceMission(missionId, opts) {
  assertEnabled();
  opts = opts || {};
  var mission = store.load('mission', missionId);
  if (!mission) return Promise.reject(new Error('NO_SUCH_MISSION: ' + missionId));
  return orchestrator.advanceMission(missionId, {
    agent_runner: opts.agent_runner || buildProductionRunner(),
    review_fn: opts.review_fn,
    review: opts.review,
    test_runner: opts.test_runner,
    policy: opts.policy,
    repo_path: opts.repo_path || REPO_PATH,
    max_parallel: opts.max_parallel || mission.max_parallel_agents,
    quota_state: opts.quota_state
  });
}

// Releases quota-parked tasks, then advances. This is the resume path;
// 429 → WAITING_FOR_QUOTA → persistence → resume is preserved end to end
// because both layers keep their own durable state.
function resumeMission(missionId, opts) {
  assertEnabled();
  var released = orchestrator.resumeQuota(missionId);
  return advanceMission(missionId, opts).then(function (mission) {
    mission.metadata.last_resume_released = released;
    store.save(mission);
    return mission;
  });
}

// Cancels a mission: core tasks first (authoritative), then their
// executor tasks (so nothing survives to be resurrected).
function cancelMission(missionId, reason) {
  assertEnabled();
  var mission = store.load('mission', missionId);
  if (!mission) throw new Error('NO_SUCH_MISSION: ' + missionId);
  var cancelledExecutor = [];
  var cancelledCore = [];
  mission.task_ids.forEach(function (id) {
    var t = store.load('task', id);
    if (!t) return;
    cancelledExecutor = cancelledExecutor.concat(cancelExecutorTasksFor(t));
    if (['COMPLETED', 'FAILED', 'CANCELLED'].indexOf(t.status) === -1) {
      try {
        store.transition('task', id, 'CANCELLED', {
          metadata: Object.assign({}, t.metadata, { cancel_reason: reason || 'operator cancellation' })
        });
        cancelledCore.push(id);
      } catch (e) { /* illegal transition = already terminal */ }
    }
  });
  if (['COMPLETED', 'FAILED', 'CANCELLED'].indexOf(mission.status) === -1) {
    store.transition('mission', missionId, 'CANCELLED');
  }
  var goal = store.load('goal', mission.goal_id);
  if (goal && ['COMPLETED', 'FAILED', 'CANCELLED'].indexOf(goal.status) === -1) {
    store.transition('goal', goal.id, 'CANCELLED');
  }
  events.emit('DECISION_MADE', {
    subject_id: missionId, project: mission.project, correlation_id: mission.correlation_id,
    detail: { cancelled: true, core_tasks: cancelledCore.length, executor_tasks: cancelledExecutor.length }
  });
  return { mission_id: missionId, core_tasks_cancelled: cancelledCore, executor_tasks_cancelled: cancelledExecutor };
}

// --- Read models -----------------------------------------------------------------------

function goalStatus(goalId) {
  var goal = store.load('goal', goalId);
  if (!goal) return null;
  var missions = store.list('mission', function (m) { return m.goal_id === goalId; });
  return {
    goal: { id: goal.id, text: goal.text, status: goal.status, project: goal.project,
      correlation_id: goal.correlation_id, created_at: goal.created_at },
    missions: missions.map(function (m) {
      return {
        id: m.id, status: m.status, kind: m.metadata.mission_kind || null,
        report_id: m.metadata.report_id || null,
        tasks: m.task_ids.map(function (id) {
          var t = store.load('task', id);
          return t ? {
            id: t.id, key: t.metadata.plan_key, status: t.status, agent: t.agent_id,
            attempt: t.attempt, executor_task_id: t.executor_task_id || null,
            summary: t.result && t.result.summary ? t.result.summary : null,
            rejections: t.metadata.validation_rejections || null,
            policy_denied: t.metadata.policy_denied || null,
            approval_reason: t.metadata.approval_reason || null
          } : { id: id, missing: true };
        })
      };
    })
  };
}

function missionReport(missionId) {
  var mission = store.load('mission', missionId);
  if (!mission) return null;
  var report = mission.metadata.report_id ? store.load('report', mission.metadata.report_id) : null;
  return { mission_id: missionId, status: mission.status, report: report };
}

function listGoals(limit) {
  return store.list('goal').slice(-(limit || 25)).reverse().map(function (g) {
    return { id: g.id, status: g.status, project: g.project, text: String(g.text).slice(0, 160),
      created_at: g.created_at, requested_by: g.requested_by };
  });
}

module.exports = {
  coreEnabled: coreEnabled,
  assertEnabled: assertEnabled,
  MISSION_KINDS: MISSION_KINDS,
  GOAL_FIELDS: GOAL_FIELDS,
  validateGoalPayload: validateGoalPayload,
  submitGoal: submitGoal,
  buildProductionRunner: buildProductionRunner,
  registerExecutorTask: registerExecutorTask,
  cancelExecutorTasksFor: cancelExecutorTasksFor,
  advanceMission: advanceMission,
  resumeMission: resumeMission,
  cancelMission: cancelMission,
  goalStatus: goalStatus,
  missionReport: missionReport,
  listGoals: listGoals,
  REPO_PATH: REPO_PATH
};
