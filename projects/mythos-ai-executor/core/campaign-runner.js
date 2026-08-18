'use strict';
// =====================================================
// Mythos Orchestration Core — autonomous campaign runner
// projects/mythos-ai-executor/core/campaign-runner.js
//
// Drives one step of a campaign to its next durable state. Every call is
// resumable: state lives in the store, so a quota pause, an approval wait
// or a restart continues rather than restarting.
//
//   advanceCampaign(id)
//     PLANNING/READY → propose + start the next mission
//     RUNNING        → execute the mission DAG (parallel, worktrees,
//                      policy, budget, validation, independent review)
//     REPAIRING      → bounded repair cycles, then approval
//     REVIEWING      → acceptance on EVIDENCE, memory + roadmap closure
//     → COMPLETED / WAITING_FOR_QUOTA / WAITING_FOR_APPROVAL / BLOCKED
//
// Execution itself is the already-proven path: core-wiring's production
// runner (real Phase 1 executor + real Claude) unless a runner is
// injected for tests.
// =====================================================

var campaign = require('./campaign');
var store = require('./store');
var events = require('./events');
var orchestrator = require('./orchestrator');
var coreWiring = require('./core-wiring');
var policyEngine = require('./policy-engine');
var selfImprove = require('./self-improve');

// One step. Returns { state, action, detail }.
// How long a RUNNING task whose liveness cannot be established is left alone
// before it is treated as orphaned. A task mid-dispatch has been transitioned
// to RUNNING but may not have recorded its executor id yet, so recovering
// instantly could steal a task that is genuinely starting.
var ORPHAN_GRACE_MS = 5 * 60 * 1000;

// Crash recovery for tasks, the counterpart to the reservation lease.
//
// A restart mid-mission used to leave its tasks in RUNNING forever: the
// process executing them was gone, but nothing ever said so, and the DAG
// waited on them for eternity. Campaign state survived the restart and the
// continuation lease cleared correctly, yet the campaign could not actually
// make progress — recovery looked complete and was not. Found by killing the
// executor mid-mission rather than by any unit test.
//
// The rule is the lease's rule: never reclaim what cannot be PROVEN dead.
// A live pid is left alone; an unverifiable task is left alone until it ages
// past the grace window; only then is it re-queued, and only within its
// existing attempt budget, so recovery can never loop forever.
function recoverOrphanedTasks(missionId) {
  var execState = require('../lib/state');
  var mission;
  try { mission = store.load('mission', missionId); } catch (e) { return []; }
  if (!mission) return [];
  var recovered = [];

  (mission.task_ids || []).forEach(function (id) {
    var t;
    try { t = store.load('task', id); } catch (e) { return; }
    if (!t || t.status !== 'RUNNING') return;

    var alive = null;   // true | false | null (unverifiable)
    if (t.executor_task_id) {
      var st = null;
      try { st = execState.readJSON(t.executor_task_id, 'status.json'); } catch (e) { st = null; }
      if (st && st.pid) alive = execState.processAlive(st.pid);
      else if (st && ['COMPLETED', 'FAILED', 'CANCELLED'].indexOf(st.status) !== -1) alive = false;
    }
    if (alive === true) return;                       // genuinely still running

    var age = Date.now() - Date.parse(t.updated_at || t.created_at || 0);
    if (alive === null && !(age > ORPHAN_GRACE_MS)) return;   // fail safe

    var attempt = t.attempt || 1;
    var maxAttempts = t.max_attempts || 3;
    var detail = {
      orphan_recovered: true,
      reason: alive === false ? 'executing process is gone' : 'unverifiable past the grace window',
      recovered_at: new Date().toISOString()
    };
    try {
      store.transition('task', id, 'RETRYING', {
        metadata: Object.assign({}, t.metadata, detail)
      });
      if (attempt >= maxAttempts) {
        store.transition('task', id, 'FAILED', {
          metadata: Object.assign({}, t.metadata, detail,
            { failure: 'orphaned by a restart and out of attempts' })
        });
        recovered.push({ task_id: id, plan_key: t.metadata && t.metadata.plan_key, outcome: 'FAILED' });
      } else {
        store.transition('task', id, 'READY', {
          attempt: attempt + 1,
          metadata: Object.assign({}, t.metadata, detail)
        });
        recovered.push({ task_id: id, plan_key: t.metadata && t.metadata.plan_key, outcome: 'REQUEUED' });
      }
      store.appendEventLine({
        event_type: 'TASK_RESUMED', subject_id: id, project: t.project,
        detail: detail
      });
    } catch (e) { /* a task that raced to a terminal state needs no recovery */ }
  });

  return recovered;
}

function advanceCampaign(campaignId, opts) {
  opts = opts || {};
  coreWiring.assertEnabled();
  var c = campaign.loadCampaign(campaignId);
  if (!c) return Promise.reject(new Error('NO_SUCH_CAMPAIGN: ' + campaignId));

  // Before deciding anything, reclaim tasks stranded RUNNING by a crash or
  // restart. Without this a single interruption wedges the mission forever.
  if (c.current_mission && c.current_mission.mission_id) {
    var reclaimed = recoverOrphanedTasks(c.current_mission.mission_id);
    if (reclaimed.length) {
      store.appendEventLine({
        event_type: 'TASK_RESUMED', subject_id: c.current_mission.mission_id,
        project: c.project,
        detail: { orphans_recovered: reclaimed.length, tasks: reclaimed }
      });
    }
  }

  // Terminal or operator-held states never act on their own.
  if (['COMPLETED', 'PAUSED'].indexOf(c.state) !== -1) {
    return Promise.resolve({ state: c.state, action: 'noop',
      detail: 'campaign is ' + c.state.toLowerCase() });
  }
  if (c.state === 'WAITING_FOR_APPROVAL' && !opts.approval_granted) {
    return Promise.resolve({ state: c.state, action: 'waiting',
      detail: 'human approval required: ' +
        (c.approval_required || []).slice(-1).map(function (a) { return a.reason; }).join('') });
  }
  if (c.state === 'BLOCKED' && !opts.unblock) {
    return Promise.resolve({ state: c.state, action: 'blocked',
      detail: (c.blocked_missions || []).slice(-1).map(function (m) { return m.reason; }).join('') });
  }

  // 1. No current mission → select and start the next one.
  if (!c.current_mission) {
    // Always pass through READY: PLANNING → RUNNING is not a legal
    // transition, and the state machine is the authority here.
    if (c.state !== 'READY') campaign.transition(campaignId, 'READY', {});
    var proposal = campaign.proposeNextMission(campaignId);
    if (!proposal.proposal) {
      // Nothing left that is autonomously safe: the campaign is done, and
      // whatever remains is recorded as needing human approval.
      campaign.transition(campaignId, 'COMPLETED', {
        completion_reason: proposal.reason,
        approval_candidates: proposal.approval_candidates || []
      });
      return Promise.resolve({ state: 'COMPLETED', action: 'completed', detail: proposal.reason });
    }
    var started = campaign.startMission(campaignId, proposal.proposal, opts);
    if (started.requires_approval) {
      return Promise.resolve({ state: 'WAITING_FOR_APPROVAL', action: 'approval_required',
        detail: started.reason, approval_id: started.approval_id });
    }
    if (started.blocked) {
      return Promise.resolve({ state: 'BLOCKED', action: 'blocked', detail: started.reason });
    }
    if (campaign.loadCampaign(campaignId).state !== 'RUNNING') {
      campaign.transition(campaignId, 'RUNNING', {});
    }
    return Promise.resolve({ state: 'RUNNING', action: 'mission_started',
      detail: proposal.proposal.capability_key + '. ' + proposal.proposal.title,
      mission_id: started.mission_id, proposal: proposal.proposal });
  }

  // 2. A mission is in flight → advance it.
  var cm = c.current_mission;
  if (['RUNNING', 'REPAIRING', 'REVIEWING'].indexOf(c.state) === -1) {
    campaign.transition(campaignId, 'RUNNING', {});
  }
  // The adversarial reviewer judges DELIVERABLES. It must never be pointed
  // at the mission's own 'review' task: that task IS the adversarial
  // review, and grading a reviewer's findings against an implementation
  // contract is a category error — observed live, where a valid review was
  // rejected for "tests pending" and burned the whole repair budget.
  var reviewFn = opts.review_fn ? function (reviewer, task, result) {
    if (task.metadata && task.metadata.plan_key === 'review') {
      return { verdict: 'pass',
        findings: ['this task IS the adversarial review; it is not re-reviewed'] };
    }
    return opts.review_fn(reviewer, task, result);
  } : undefined;

  return orchestrator.advanceMission(cm.mission_id, {
    agent_runner: opts.agent_runner || coreWiring.buildProductionRunner(),
    review_fn: reviewFn,
    review: opts.review,
    test_runner: opts.test_runner,
    policy: opts.policy,
    repo_path: opts.repo_path || c.repo_path,
    max_parallel: opts.max_parallel || 2,
    quota_state: opts.quota_state
  }).then(function (mission) {
    return settleMission(campaignId, mission, opts);
  }, function (err) {
    return handleFailure(campaignId, String(err && err.message), opts);
  });
}

function settleMission(campaignId, mission, opts) {
  var c = campaign.loadCampaign(campaignId);
  var cm = c.current_mission;
  var tasks = mission.task_ids.map(function (id) { return store.load('task', id); });

  // Quota: pause the whole campaign, never fail it.
  var quotaParked = tasks.filter(function (t) { return t.status === 'WAITING_FOR_QUOTA'; });
  if (mission.status === 'WAITING' && quotaParked.length) {
    campaign.transition(campaignId, 'WAITING_FOR_QUOTA', {});
    events.emit('QUOTA_EXHAUSTED', {
      subject_id: cm.mission_id, project: c.project,
      detail: { campaign_id: campaignId, parked_tasks: quotaParked.length }
    });
    return { state: 'WAITING_FOR_QUOTA', action: 'quota_pause',
      detail: quotaParked.length + ' task(s) parked; the campaign resumes from this checkpoint' };
  }

  // Approval: a task hit a policy/budget boundary mid-mission.
  var approvalParked = tasks.filter(function (t) { return t.status === 'WAITING_FOR_APPROVAL'; });
  if (mission.status === 'WAITING' && approvalParked.length) {
    var reasons = approvalParked.map(function (t) {
      return (t.metadata.plan_key || t.id) + ': ' + (t.metadata.approval_reason || 'approval required');
    });
    campaign.parkForApproval(campaignId, {
      mission_id: cm.mission_id, capability_key: cm.capability_key,
      objective: cm.objective, reason: reasons.join(' | '), action_class: 'POLICY'
    });
    return { state: 'WAITING_FOR_APPROVAL', action: 'approval_required', detail: reasons.join(' | ') };
  }

  // The mission finished (either way) → acceptance on evidence.
  if (['COMPLETED', 'FAILED'].indexOf(mission.status) !== -1) {
    campaign.transition(campaignId, 'REVIEWING', {});
    var verdict = campaign.acceptMission(campaignId, opts);
    if (verdict.accepted) {
      campaign.finishMission(campaignId, true, 'accepted on evidence');
      var after = campaign.loadCampaign(campaignId);
      campaign.transition(campaignId, 'READY', {});
      return { state: 'READY', action: 'mission_accepted',
        detail: 'commit ' + String(verdict.commit).slice(0, 12) +
          ', ' + (after.completed_missions || []).length + ' mission(s) completed' };
    }
    // Not accepted → repair, bounded.
    var governanceViolation = (verdict.problems || []).some(function (p) {
      return /GOVERNANCE VIOLATION/.test(p);
    });
    if (governanceViolation) {
      // Never repair a governance breach automatically — stop and escalate.
      var gKey = cm.capability_key, gObjective = cm.objective, gMission = cm.mission_id;
      campaign.finishMission(campaignId, false, verdict.problems.join('; '));
      campaign.parkForApproval(campaignId, {
        mission_id: gMission, capability_key: gKey, objective: gObjective,
        reason: 'governance violation detected in the real diff: ' + verdict.problems.join('; '),
        action_class: 'GOVERNANCE'
      });
      return { state: 'WAITING_FOR_APPROVAL', action: 'governance_violation',
        detail: verdict.problems.join('; ') };
    }
    // Classify against the REAL task errors when we have them: the
    // acceptance summary says "tasks not completed", which would mask an
    // infrastructure or quota cause behind a generic code-failure verdict.
    var taskErrors = tasks.filter(function (t) {
      return t.metadata && (t.metadata.last_error || t.metadata.policy_denied);
    }).map(function (t) {
      return (t.metadata.plan_key || t.id) + ': ' +
        (t.metadata.last_error || t.metadata.policy_denied);
    });
    // Classify the REAL task errors ALONE when they exist: concatenating
    // the acceptance summary would match on unrelated task names (a
    // pending "review" task must not make this a REVIEW failure).
    var diagnosis = taskErrors.length ? taskErrors.join(' | ') : verdict.problems.join('; ');
    var detail = taskErrors.length
      ? diagnosis + ' || ' + verdict.problems.join('; ')
      : diagnosis;
    return repairOrEscalate(campaignId, diagnosis, opts, detail);
  }

  // Still waiting on something else (stalled) — keep the state honest.
  return { state: campaign.loadCampaign(campaignId).state, action: 'mission_in_progress',
    detail: 'mission ' + mission.status };
}

// Bounded repair: retry the mission up to max_repair_cycles, then escalate
// to approval instead of looping forever.
function repairOrEscalate(campaignId, problems, opts, detailOverride) {
  var c = campaign.loadCampaign(campaignId);
  var cm = c.current_mission;
  var cycles = (cm.repair_cycles || 0) + 1;
  var kind = campaign.classifyFailure(problems);
  problems = detailOverride || problems;
  var behaviour = campaign.FAILURE_BEHAVIOUR[kind];

  if (behaviour === 'WAITING_FOR_QUOTA') {
    campaign.transition(campaignId, 'WAITING_FOR_QUOTA', {});
    return { state: 'WAITING_FOR_QUOTA', action: 'quota_pause', detail: problems, failure_kind: kind };
  }
  if (behaviour === 'WAITING_FOR_APPROVAL') {
    campaign.finishMission(campaignId, false, kind + ': ' + problems);
    campaign.transition(campaignId, 'WAITING_FOR_APPROVAL', {});
    return { state: 'WAITING_FOR_APPROVAL', action: 'approval_required',
      detail: problems, failure_kind: kind };
  }
  if (behaviour === 'BLOCKED') {
    campaign.finishMission(campaignId, false, kind + ': ' + problems);
    campaign.transition(campaignId, 'BLOCKED', {});
    return { state: 'BLOCKED', action: 'blocked', detail: problems, failure_kind: kind };
  }

  if (cycles > (c.max_repair_cycles || campaign.MAX_REPAIR_CYCLES)) {
    var rKey = cm.capability_key, rObjective = cm.objective, rMission = cm.mission_id;
    campaign.finishMission(campaignId, false,
      'repair budget exhausted after ' + (cycles - 1) + ' cycles: ' + problems);
    campaign.parkForApproval(campaignId, {
      mission_id: rMission, capability_key: rKey, objective: rObjective,
      reason: 'repair budget exhausted after ' + (cycles - 1) + ' cycles: ' + problems,
      action_class: 'POLICY'
    });
    return { state: 'WAITING_FOR_APPROVAL', action: 'repair_exhausted',
      detail: problems, repair_cycles: cycles - 1, failure_kind: kind };
  }

  cm.repair_cycles = cycles;
  cm.last_problems = problems;
  campaign.saveCampaign(c);
  campaign.transition(campaignId, 'REPAIRING', {});
  // Re-queue the failed tasks so the next advance re-runs them with the
  // findings attached (the orchestrator's repair channel does the rest).
  var mission = store.load('mission', cm.mission_id);
  mission.task_ids.forEach(function (id) {
    var t = store.load('task', id);
    if (t.status === 'FAILED') {
      try {
        store.transition('task', id, 'QUEUED', {
          metadata: Object.assign({}, t.metadata, {
            validation_rejections: (t.metadata.validation_rejections || [])
              .concat(['campaign repair cycle ' + cycles + ': ' + problems])
          })
        });
      } catch (e) { /* already terminal in a way we cannot re-queue */ }
    }
  });
  if (['FAILED', 'CANCELLED'].indexOf(mission.status) !== -1) {
    try {
      store.transition('mission', mission.id, 'PLANNED');
      store.transition('mission', mission.id, 'VALIDATED');
    } catch (e) { /* leave as-is; the next advance will report honestly */ }
  }
  return { state: 'REPAIRING', action: 'repair_scheduled',
    detail: problems, repair_cycles: cycles, failure_kind: kind };
}

function handleFailure(campaignId, message, opts) {
  var kind = campaign.classifyFailure(message);
  campaign.note(campaign.loadCampaign(campaignId), { event: 'advance_error', kind: kind,
    message: String(message).slice(0, 300) });
  return repairOrEscalate(campaignId, message, opts);
}

// Runs advance steps until the campaign reaches a state that needs
// something external (quota, approval, blocked, completed) or the step
// budget is spent. Bounded by construction — never an infinite loop.
function runCampaign(campaignId, opts) {
  opts = opts || {};
  var maxSteps = opts.max_steps || 12;
  var steps = [];
  function step(n) {
    if (n >= maxSteps) {
      return Promise.resolve({ steps: steps, stopped: 'step budget reached',
        state: campaign.loadCampaign(campaignId).state });
    }
    return advanceCampaign(campaignId, opts).then(function (out) {
      steps.push(out);
      var halt = ['COMPLETED', 'WAITING_FOR_QUOTA', 'WAITING_FOR_APPROVAL', 'BLOCKED', 'PAUSED'];
      if (halt.indexOf(out.state) !== -1 || out.action === 'noop') {
        return { steps: steps, stopped: out.action, state: out.state };
      }
      return step(n + 1);
    });
  }
  return step(0);
}

// Resume after a quota pause: release parked tasks, then continue.
function resumeCampaign(campaignId, opts) {
  opts = opts || {};
  var c = campaign.loadCampaign(campaignId);
  if (!c) return Promise.reject(new Error('NO_SUCH_CAMPAIGN: ' + campaignId));
  if (c.state === 'WAITING_FOR_QUOTA' && c.current_mission) {
    var released = orchestrator.resumeQuota(c.current_mission.mission_id);
    campaign.transition(campaignId, 'RUNNING', {});
    campaign.note(campaign.loadCampaign(campaignId),
      { event: 'quota_resumed', released: released.length });
  } else if (c.state === 'WAITING_FOR_APPROVAL' && opts.approval_granted) {
    campaign.transition(campaignId, c.current_mission ? 'RUNNING' : 'READY', {});
  } else if (c.state === 'PAUSED') {
    campaign.transition(campaignId, 'READY', {});
  }
  return advanceCampaign(campaignId, Object.assign({}, opts, { approval_granted: true }));
}

// Read model for CLI/API.
function campaignStatus(campaignId) {
  var c = campaign.loadCampaign(campaignId);
  if (!c) return null;
  var current = null;
  if (c.current_mission) {
    var m = store.load('mission', c.current_mission.mission_id);
    current = Object.assign({}, c.current_mission, {
      mission_status: m ? m.status : null,
      tasks: m ? m.task_ids.map(function (id) {
        var t = store.load('task', id);
        return t ? { key: t.metadata.plan_key, status: t.status, agent: t.agent_id,
          attempt: t.attempt } : null;
      }).filter(Boolean) : []
    });
  }
  return {
    campaign_id: c.campaign_id, project: c.project, objective: c.objective,
    state: c.state, current_mission: current,
    completed_missions: c.completed_missions || [],
    blocked_missions: c.blocked_missions || [],
    approval_required: c.approval_required || [],
    completion_reason: c.completion_reason || null,
    created_at: c.created_at, updated_at: c.updated_at,
    history: (c.history || []).slice(-15)
  };
}

module.exports = {
  advanceCampaign: advanceCampaign,
  recoverOrphanedTasks: recoverOrphanedTasks,
  ORPHAN_GRACE_MS: ORPHAN_GRACE_MS,
  runCampaign: runCampaign,
  resumeCampaign: resumeCampaign,
  campaignStatus: campaignStatus,
  repairOrEscalate: repairOrEscalate,
  settleMission: settleMission
};
