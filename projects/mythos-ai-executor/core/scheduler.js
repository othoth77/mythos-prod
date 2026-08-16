'use strict';
// =====================================================
// Mythos Orchestration Core — mission scheduler (Phase 2G)
// projects/mythos-ai-executor/core/scheduler.js
//
// Drives one mission's task DAG to a terminal state with SAFE parallel
// execution:
//
//   * bounded concurrency (mission.max_parallel_agents, capped by the
//     scheduler option — never unlimited processes)
//   * policy gate before every dispatch (allow / WAITING_FOR_APPROVAL /
//     refuse) through the central policy engine
//   * isolated git worktrees for every write-capable task when a repo is
//     involved; two concurrent tasks can never share a writable tree —
//     write tasks without isolation are serialized as a hard rule
//   * failure isolation: one branch failing dooms only its descendants;
//     independent branches finish
//
// The actual task execution is an injectable runner (tests use mocks;
// Phase 2M bridges to the Phase 1 executor). The runner returns the
// core-state outcome for the task; the scheduler owns every transition.
// =====================================================

var store = require('./store');
var dag = require('./dag');
var worktrees = require('./worktrees');
var policyEngine = require('./policy-engine');

var WRITE_TASK_TYPES = ['coding', 'integration', 'documentation'];
var HARD_MAX_PARALLEL = 8;

function loadMissionTasks(mission) {
  return mission.task_ids.map(function (id) { return store.load('task', id); });
}

// Applies DAG readiness to persisted states.
function promoteReady(tasks) {
  var ready = dag.readyTasks(tasks);
  ready.forEach(function (id) {
    var t = tasks.filter(function (x) { return x.id === id; })[0];
    if (t && ['QUEUED', 'WAITING_FOR_DEPENDENCY'].indexOf(t.status) !== -1) {
      store.transition('task', id, 'READY');
    }
  });
  return ready;
}

// Runs a mission until terminal, waiting-for-approval, or quota-parked.
// opts: { runner(task, ctx) → Promise<{status, result?, error?}>,
//         policy (engine), repo_path?, max_parallel?, on_dispatch? }
function runMission(missionId, opts) {
  opts = opts || {};
  if (typeof opts.runner !== 'function') {
    return Promise.reject(new Error('SCHEDULER_NEEDS_RUNNER'));
  }
  var policy = opts.policy || policyEngine.createEngine();
  var mission = store.load('mission', missionId);
  if (!mission) return Promise.reject(new Error('NO_SUCH_MISSION: ' + missionId));
  if (mission.status === 'PLANNED') {
    return Promise.reject(new Error('MISSION_NOT_VALIDATED: validate the plan before running'));
  }
  if (['VALIDATED', 'WAITING'].indexOf(mission.status) !== -1) {
    mission = store.transition('mission', missionId, 'RUNNING');
    store.appendEventLine({
      event_type: 'MISSION_STARTED', subject_id: missionId,
      correlation_id: mission.correlation_id, project: mission.project, detail: {}
    });
  }
  var maxParallel = Math.min(
    opts.max_parallel || mission.max_parallel_agents || 2,
    HARD_MAX_PARALLEL
  );

  var active = {};        // taskId → Promise
  var activeDirs = {};    // taskId → working dir occupied
  var peak = { concurrent: 0 };

  function occupiedDirs() {
    return Object.keys(activeDirs).map(function (k) { return activeDirs[k]; });
  }

  function dispatch(task) {
    // Policy gate — aggregate over the task's declared classes. A
    // declared budget travels into MONEY_SPEND checks; no declared
    // budget means the spend gate sees no amount and denies.
    var gate = policy.checkClasses(task.policy_classes, {
      task_type: task.task_type, project: task.project,
      amount_usd: task.metadata && typeof task.metadata.budget_usd === 'number'
        ? task.metadata.budget_usd : undefined
    });
    if (gate.decision === 'deny') {
      store.transition('task', task.id, 'CANCELLED', {
        metadata: Object.assign({}, task.metadata, { policy_denied: gate.reason })
      });
      store.appendEventLine({
        event_type: 'POLICY_DENIED', subject_id: task.id,
        project: task.project, detail: { reason: gate.reason, class: gate.class }
      });
      return null;
    }
    if (gate.decision === 'require_approval') {
      // A granted approval recorded on the task satisfies the gate — the
      // owner decided once; the state machine remembers, it never re-asks.
      var priorApproval = task.metadata && task.metadata.approval_id
        ? store.load('approval', task.metadata.approval_id) : null;
      if (!(priorApproval && priorApproval.status === 'GRANTED')) {
        var existing = policyEngine.pendingApprovals(task.id);
        if (!existing.length) {
          policyEngine.requestApproval(task.id, gate.class, gate.reason, task.project);
        }
        if (task.status !== 'WAITING_FOR_APPROVAL') {
          store.transition('task', task.id, 'WAITING_FOR_APPROVAL', {
            metadata: Object.assign({}, task.metadata, { approval_reason: gate.reason })
          });
        }
        return null;
      }
    }

    // Isolation: write-capable tasks get their own worktree when a repo
    // is in play; otherwise a shared writable dir is a serialization
    // constraint, never a shared concurrent surface.
    var ctx = { mission: mission, policy_decision: gate };
    var workDir = opts.repo_path || null;
    if (WRITE_TASK_TYPES.indexOf(task.task_type) !== -1 && opts.repo_path) {
      if (opts.isolate_worktrees !== false) {
        var wt = worktrees.create(opts.repo_path, mission.id, task.id);
        ctx.worktree = wt;
        workDir = wt.dir;
      } else if (occupiedDirs().indexOf(workDir) !== -1) {
        return null; // shared tree already occupied → wait for next round
      }
    }
    if (workDir && occupiedDirs().indexOf(workDir) !== -1 &&
        WRITE_TASK_TYPES.indexOf(task.task_type) !== -1) {
      return null; // never two writers in one tree, whatever the flags say
    }

    store.transition('task', task.id, 'RUNNING', { attempt: (task.attempt || 0) + 1 });
    if (typeof opts.on_dispatch === 'function') opts.on_dispatch(task, ctx);
    activeDirs[task.id] = workDir;
    var p = Promise.resolve().then(function () {
      return opts.runner(store.load('task', task.id), ctx);
    }).then(function (outcome) {
      return { task_id: task.id, outcome: outcome || { status: 'FAILED', error: 'runner returned nothing' } };
    }, function (err) {
      return { task_id: task.id, outcome: { status: 'FAILED', error: String(err && err.message) } };
    });
    active[task.id] = p;
    peak.concurrent = Math.max(peak.concurrent, Object.keys(active).length);
    return p;
  }

  function settle(result) {
    delete active[result.task_id];
    delete activeDirs[result.task_id];
    var task = store.load('task', result.task_id);
    var outcome = result.outcome;
    var to = outcome.status;
    var allowed = ['COMPLETED', 'FAILED', 'WAITING_FOR_QUOTA', 'RETRYING', 'VALIDATING'];
    if (allowed.indexOf(to) === -1) to = 'FAILED';
    store.transition('task', task.id, to, {
      result: outcome.result || null,
      metadata: Object.assign({}, task.metadata,
        outcome.error ? { last_error: String(outcome.error).slice(0, 400) } : {})
    });
  }

  function finishMission(assessment) {
    if (assessment.succeeded) {
      mission = store.transition('mission', missionId, 'COMPLETED');
      store.appendEventLine({
        event_type: 'MISSION_COMPLETED', subject_id: missionId,
        correlation_id: mission.correlation_id, project: mission.project, detail: {}
      });
    } else {
      mission = store.transition('mission', missionId, 'FAILED', {
        metadata: Object.assign({}, mission.metadata, {
          doomed: assessment.doomed, failed: assessment.failed_ids || []
        })
      });
      store.appendEventLine({
        event_type: 'MISSION_FAILED', subject_id: missionId,
        correlation_id: mission.correlation_id, project: mission.project,
        detail: { doomed: assessment.doomed }
      });
    }
    mission.metadata.peak_concurrency = peak.concurrent;
    store.save(mission);
    return mission;
  }

  function step() {
    // Integration hooks (Phase 2M): settle VALIDATING tasks through the
    // injected validator, then re-dispatch repairs (RETRYING → READY).
    if (typeof opts.validator === 'function') {
      loadMissionTasks(mission).forEach(function (t) {
        if (t.status === 'VALIDATING' && !active[t.id]) {
          try {
            opts.validator(t);
          } catch (e) {
            store.transition('task', t.id, 'FAILED', {
              metadata: Object.assign({}, t.metadata, { validator_error: String(e.message).slice(0, 300) })
            });
          }
        }
      });
    }
    loadMissionTasks(mission).forEach(function (t) {
      if (t.status === 'RETRYING' && !active[t.id]) {
        var budget = t.max_attempts === undefined ? 3 : t.max_attempts;
        if ((t.attempt || 0) < budget) store.transition('task', t.id, 'READY');
        else store.transition('task', t.id, 'FAILED', {
          metadata: Object.assign({}, t.metadata, { retry_budget_exhausted: true })
        });
      }
    });

    var tasks = loadMissionTasks(mission);
    var assessment = dag.assess(tasks);
    if (!assessment.valid) {
      return Promise.resolve(store.transition('mission', missionId, 'FAILED', {
        metadata: { graph_errors: assessment.errors }
      }));
    }

    // Terminal check counts doomed/waiting-approval tasks as unreachable.
    var openStates = tasks.filter(function (t) {
      return ['COMPLETED', 'FAILED', 'CANCELLED'].indexOf(t.status) === -1;
    });
    var waitingApproval = openStates.filter(function (t) { return t.status === 'WAITING_FOR_APPROVAL'; });
    var waitingQuota = openStates.filter(function (t) { return t.status === 'WAITING_FOR_QUOTA'; });
    var doomedIds = assessment.doomed.map(function (d) { return d.id; });

    if (!openStates.length) {
      assessment.failed_ids = tasks.filter(function (t) { return t.status === 'FAILED'; })
        .map(function (t) { return t.id; });
      return Promise.resolve(finishMission(assessment));
    }

    promoteReady(tasks);
    var refreshed = loadMissionTasks(mission);
    var readyNow = refreshed.filter(function (t) {
      return t.status === 'READY' && !active[t.id];
    });
    var capacity = maxParallel - Object.keys(active).length;
    for (var i = 0; i < readyNow.length && capacity > 0; i++) {
      if (dispatch(readyNow[i])) capacity -= 1;
    }

    if (Object.keys(active).length === 0) {
      // Nothing running and nothing dispatched: either everyone is
      // waiting on something external, or the remainder is doomed.
      var undoomedOpen = loadMissionTasks(mission).filter(function (t) {
        return ['COMPLETED', 'FAILED', 'CANCELLED'].indexOf(t.status) === -1 &&
          doomedIds.indexOf(t.id) === -1;
      });
      if (waitingApproval.length || waitingQuota.length) {
        mission = store.transition('mission', missionId, 'WAITING', {
          metadata: Object.assign({}, mission.metadata, {
            waiting_approval: waitingApproval.map(function (t) { return t.id; }),
            waiting_quota: waitingQuota.map(function (t) { return t.id; })
          })
        });
        return Promise.resolve(mission);
      }
      if (!undoomedOpen.length || doomedIds.length) {
        var finalAssessment = dag.assess(loadMissionTasks(mission));
        finalAssessment.failed_ids = loadMissionTasks(mission)
          .filter(function (t) { return t.status === 'FAILED'; })
          .map(function (t) { return t.id; });
        return Promise.resolve(finishMission(finalAssessment));
      }
      // Defensive: open, undoomed, but nothing dispatchable — stall out
      // as WAITING rather than spinning forever.
      mission = store.transition('mission', missionId, 'WAITING', {
        metadata: Object.assign({}, mission.metadata, { stalled: true })
      });
      return Promise.resolve(mission);
    }

    return Promise.race(Object.keys(active).map(function (k) { return active[k]; }))
      .then(function (result) {
        settle(result);
        return step();
      });
  }

  return step().then(function (finalMission) {
    finalMission.metadata.peak_concurrency = peak.concurrent;
    store.save(finalMission);
    return finalMission;
  });
}

// Applies a granted approval: the task returns to READY so the next
// runMission call (or daemon tick) dispatches it. Approval is a state
// transition, never a prompt.
function applyApproval(approvalId, decidedBy) {
  var approval = policyEngine.decideApproval(approvalId, true, decidedBy);
  var task = store.load('task', approval.subject_id);
  if (task && task.status === 'WAITING_FOR_APPROVAL') {
    store.transition('task', task.id, 'READY', {
      metadata: Object.assign({}, task.metadata, {
        approved_by: decidedBy, approval_id: approvalId
      })
    });
  }
  return approval;
}

module.exports = {
  runMission: runMission,
  applyApproval: applyApproval,
  WRITE_TASK_TYPES: WRITE_TASK_TYPES,
  HARD_MAX_PARALLEL: HARD_MAX_PARALLEL
};
