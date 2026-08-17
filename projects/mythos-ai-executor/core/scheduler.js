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
//     write tasks without isolation are serialized as a hard rule. This
//     occupancy guard is process-global, not per-mission: two DIFFERENT
//     missions running concurrently in this process can never collide
//     on the same unisolated surface either
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
var MAX_OCCUPANCY_POLLS = 200; // bounded poll-retry for cross-mission surface contention
var OCCUPANCY_POLL_MS = 25;    // ~5s worst case before falling back to a defensive stall

// Occupancy registry for write-capable working surfaces (worktree dir,
// shared repo dir, or the synthetic no-repo marker). Module-level and
// shared across every runMission() call in this process — occupancy
// scoped to a single mission's closure would let two DIFFERENT missions
// dispatch onto the same unisolated surface at once, which is exactly
// the collision this capability exists to prevent. Keyed by
// "<missionId>::<taskId>" so concurrent missions never clash on the key
// space itself.
var globalActiveDirs = {};
function occupiedWorkDirs() {
  return Object.keys(globalActiveDirs).map(function (k) { return globalActiveDirs[k]; });
}

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
  var heartbeats = {};    // taskId → interval handle for its budget lease
  var peak = { concurrent: 0 };
  var occupancyPolls = 0; // bounds retries when blocked by another mission's occupancy

  // Startup lease sweep: budget held by a crashed holder is recovered
  // before this mission plans around "remaining". No second scheduler and
  // no daemon of its own — recovery rides the existing lifecycle.
  if (opts.recover_leases !== false) {
    try {
      var ledgerForSweep = (policy && policy.ledger) || require('./budget');
      if (typeof ledgerForSweep.recoverAll === 'function') {
        var swept = ledgerForSweep.recoverAll({});
        if (swept.recovered.length) {
          store.appendEventLine({
            event_type: 'RESERVATION_RECOVERED', subject_id: missionId,
            project: mission.project,
            detail: { swept_at_startup: swept.recovered.length, ledgers: swept.ledgers }
          });
        }
      }
    } catch (e) {
      // A sweep failure must never block a mission — but it must never be
      // invisible either, or budget could stay held with no explanation.
      try {
        store.appendEventLine({
          event_type: 'RESERVATION_EXPIRED', subject_id: missionId, project: mission.project,
          detail: { sweep_failed: String(e.message).slice(0, 200) }
        });
      } catch (e2) { /* nothing further to do */ }
    }
  }

  function dispatch(task) {
    // Release any budget hold left by a previous attempt of THIS task
    // BEFORE the policy gate runs: a crash between reserve and settle
    // would otherwise leave the task blocked by its own leaked hold for
    // the rest of the period (independent review). Releasing is safe —
    // a settled reservation refuses release by design.
    if ((task.policy_classes || []).indexOf('MONEY_SPEND') !== -1) {
      var priorHold = task.metadata && task.metadata.budget_reservation_id;
      var nextRid = ((policy && policy.ledger) || require('./budget'))
        .reservationIdFor(task.id, (task.attempt || 0) + 1, 'spend');
      if (priorHold && priorHold !== nextRid) {
        try {
          (function (L) { return L.releaseScoped || L.release; })((policy && policy.ledger) || require('./budget')).call(null, {
            project: task.project, reservation_id: priorHold,
            mission_id: mission.id,
            reason: 'superseded by attempt ' + ((task.attempt || 0) + 1)
          });
          var cleaned = store.load('task', task.id);
          cleaned.metadata.superseded_budget_reservations =
            (cleaned.metadata.superseded_budget_reservations || []).concat([priorHold]);
          delete cleaned.metadata.budget_reservation_id;
          store.save(cleaned);
          task = store.load('task', task.id);
        } catch (e) { /* already terminal or ledger down — the gate decides */ }
      }
    }

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
    // constraint, never a shared concurrent surface. A write-capable task
    // dispatched with no repo_path at all still targets exactly one
    // implicit surface (the runner's own cwd/default) — that surface gets
    // the same mandatory occupancy tracking as a real shared dir, so it
    // can never be handed to two agents at once. This occupancy check is
    // read from globalActiveDirs (module scope, not this closure's), so
    // the guard holds across every concurrently running mission in the
    // process — two DIFFERENT missions sharing an unisolated repo_path or
    // the no-repo marker can never collide either, not just two tasks
    // inside the same mission.
    var ctx = { mission: mission, policy_decision: gate };
    var isWriteTask = WRITE_TASK_TYPES.indexOf(task.task_type) !== -1;
    var workDir = opts.repo_path || null;
    if (isWriteTask) {
      if (opts.repo_path) {
        if (opts.isolate_worktrees !== false) {
          // worktrees.create() throws synchronously (NOT_A_REPO,
          // WORKTREE_CONFLICT) — left uncaught, that throw would escape
          // dispatch() into step()'s dispatch loop and crash the whole
          // runMission() promise chain synchronously, dooming every task
          // in the mission over one task's isolation failure. That
          // directly contradicts this scheduler's own failure-isolation
          // guarantee (one branch failing dooms only its descendants).
          // Fail just this task instead, the same way a policy denial
          // already does, and let the rest of the mission proceed.
          try {
            var wt = worktrees.create(opts.repo_path, mission.id, task.id);
          } catch (e) {
            store.transition('task', task.id, 'CANCELLED', {
              metadata: Object.assign({}, task.metadata, {
                worktree_create_failed: String(e && e.message).slice(0, 200)
              })
            });
            store.appendEventLine({
              event_type: 'TASK_FAILED', subject_id: task.id,
              project: task.project,
              detail: { reason: 'worktree_create_failed', error: String(e && e.message).slice(0, 200) }
            });
            return null;
          }
          ctx.worktree = wt;
          workDir = wt.dir;
        }
      } else {
        workDir = 'UNISOLATED_WRITE_SURFACE';
      }
    }
    if (isWriteTask && occupiedWorkDirs().indexOf(workDir) !== -1) {
      return null; // never two writers in one tree, whatever the flags say — across every mission, not just this one
    }

    // Cumulative budget: RESERVE before execution so two parallel tasks
    // can never both spend the same remaining balance. Settled on
    // success, released on failure (see settle() below).
    var reservation = null;
    if ((task.policy_classes || []).indexOf('MONEY_SPEND') !== -1) {
      var ledger = (policy && policy.ledger) || require('./budget');
      var amount = task.metadata && typeof task.metadata.budget_usd === 'number'
        ? task.metadata.budget_usd : null;
      var rid = ledger.reservationIdFor(task.id, (task.attempt || 0) + 1, 'spend');
      var held;
      try {
        held = (ledger.reserveScoped || ledger.reserve).call(ledger, {
          project: task.project, amount: amount === null ? NaN : amount,
          reservation_id: rid,
          mission_limit: typeof mission.metadata.mission_budget_usd === 'number'
            ? mission.metadata.mission_budget_usd : undefined,
          cost_basis: (task.metadata && task.metadata.cost_basis) || 'estimated',
          provider: null, agent: task.agent_id || null,
          mission_id: mission.id, task_id: task.id,
          allow_approval: gate.decision === 'require_approval'
        });
      } catch (e) {
        // An unusable ledger (missing/corrupt config, lock timeout) must
        // never crash a mission into an undefined state — it fails closed.
        held = { decision: 'deny', reason: 'budget ledger unavailable: ' + String(e.message).slice(0, 160) };
      }
      if (held.decision !== 'allow') {
        var toState = held.decision === 'require_approval' ? 'WAITING_FOR_APPROVAL' : 'CANCELLED';
        if (toState === 'WAITING_FOR_APPROVAL') {
          if (!policyEngine.pendingApprovals(task.id).length) {
            // The approver must see the full picture, not just a sentence
            // (Phase order §10; independent review): requested amount,
            // spent, reserved, remaining, limit, mission, task, agent.
            var b = held.budget || {};
            var detail = held.reason +
              ' [requested ' + amount + ' ' + (b.currency || '') +
              ' · limit ' + b.limit + ' · spent ' + b.spent + ' · reserved ' + b.reserved +
              ' · remaining ' + b.remaining + ' · period ' + b.period_key +
              ' · mission ' + mission.id + ' · task ' + task.id +
              ' · agent ' + (task.agent_id || 'unassigned') + ']';
            policyEngine.requestApproval(task.id, 'MONEY_SPEND', detail, task.project);
          }
          store.transition('task', task.id, 'WAITING_FOR_APPROVAL', {
            metadata: Object.assign({}, task.metadata, {
              approval_reason: held.reason, budget_snapshot: held.budget || null })
          });
        } else {
          store.transition('task', task.id, 'CANCELLED', {
            metadata: Object.assign({}, task.metadata, {
              policy_denied: held.reason, budget_snapshot: held.budget || null })
          });
          store.appendEventLine({ event_type: 'POLICY_DENIED', subject_id: task.id,
            project: task.project, detail: { reason: held.reason, class: 'MONEY_SPEND' } });
        }
        return null;
      }
      reservation = { id: rid, amount: amount, project: task.project, ledger: ledger };
      var scopesNote = (held.scopes_enforced || []).join('+');
      var stTask = store.load('task', task.id);
      stTask.metadata.budget_scopes_enforced = scopesNote;
      if (held.mission_budget) stTask.metadata.mission_budget_snapshot = held.mission_budget;
      store.save(stTask);
      task = store.load('task', task.id);
    }

    store.transition('task', task.id, 'RUNNING', Object.assign(
      { attempt: (task.attempt || 0) + 1 },
      reservation ? { metadata: Object.assign({}, task.metadata, {
        budget_reservation_id: reservation.id,
        budget_snapshot: null
      }) } : {}));
    if (typeof opts.on_dispatch === 'function') opts.on_dispatch(task, ctx);
    // Recorded for every dispatched task (not just write tasks): any
    // occupant of a shared dir — reader or writer — must still block a
    // later write dispatch onto that same surface, matching the prior
    // per-mission behavior this replaces.
    globalActiveDirs[missionId + '::' + task.id] = workDir;
    // Keep the reservation's lease alive for as long as this task really
    // runs, so a slow-but-healthy task is never recovered from under it.
    if (reservation && typeof reservation.ledger.heartbeat === 'function') {
      var beatMs = opts.heartbeat_ms ||
        Math.max(30000, Math.floor((reservation.ledger.LEASE_MS || 900000) / 3));
      heartbeats[task.id] = setInterval(function () {
        try {
          reservation.ledger.heartbeat({
            project: reservation.project, reservation_id: reservation.id,
            mission_id: mission.id
          });
          if (mission.id) {
            reservation.ledger.heartbeat({
              project: reservation.project, reservation_id: reservation.id,
              scope: 'MISSION', period_key: mission.id
            });
          }
        } catch (e) { /* a missed beat only shortens the lease */ }
      }, beatMs);
      if (heartbeats[task.id].unref) heartbeats[task.id].unref();
    }
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
    delete globalActiveDirs[missionId + '::' + result.task_id];
    if (heartbeats[result.task_id]) {
      clearInterval(heartbeats[result.task_id]);
      delete heartbeats[result.task_id];
    }
    var task = store.load('task', result.task_id);
    var outcome = result.outcome;
    var to = outcome.status;

    // Settle or release the budget reservation this attempt held. Success
    // settles the ACTUAL amount when the runner reports one (falling back
    // to the reserved amount); anything else releases the hold so the
    // money is not silently consumed by work that did not happen.
    var rid = task.metadata && task.metadata.budget_reservation_id;
    if (rid) {
      var ledger = (policy && policy.ledger) || require('./budget');
      var settledOk = ['COMPLETED', 'VALIDATING'].indexOf(to) !== -1;
      try {
        var res = settledOk
          ? (ledger.settleScoped || ledger.settle).call(ledger, {
            project: task.project, reservation_id: rid, mission_id: task.mission_id,
            actual_amount: outcome.result && typeof outcome.result.actual_cost_usd === 'number'
              ? outcome.result.actual_cost_usd : undefined,
            cost_basis: outcome.result && outcome.result.actual_cost_usd !== undefined ? 'known' : undefined,
            external_reference: outcome.result && outcome.result.external_reference
          })
          : (ledger.releaseScoped || ledger.release).call(ledger, { project: task.project, reservation_id: rid,
            mission_id: task.mission_id, reason: 'task ended ' + to });
        var t2 = store.load('task', result.task_id);
        t2.metadata.budget_settlement = {
          settled: settledOk, ok: res.ok !== false,
          amount: res.settled_amount === undefined ? null : res.settled_amount,
          capped: !!res.capped, budget: res.budget || null
        };
        store.save(t2);
        task = store.load('task', result.task_id);
      } catch (e) {
        store.appendEventLine({ event_type: 'BUDGET_DENIED', subject_id: task.id,
          project: task.project, detail: { settlement_error: String(e.message).slice(0, 200) } });
      }
    }
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
      // A task left in READY here was attempted and refused only by the
      // occupancy guard (policy denial and approval-required both move a
      // task OUT of READY before returning null) — i.e. another mission
      // is holding the shared surface right now. That surface frees up
      // asynchronously as the other mission's task settles, so this is a
      // transient conflict, not a real stall: poll briefly instead of
      // giving up, bounded so a genuine deadlock still resolves to WAITING.
      var stillReady = loadMissionTasks(mission).filter(function (t) { return t.status === 'READY'; });
      if (stillReady.length && occupancyPolls < MAX_OCCUPANCY_POLLS) {
        occupancyPolls += 1;
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(step()); }, OCCUPANCY_POLL_MS);
        });
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
