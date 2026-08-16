'use strict';
// =====================================================
// Mythos Orchestration Core — integration facade (Phase 2M)
// projects/mythos-ai-executor/core/orchestrator.js
//
// Wires every Phase 2 component into the target flow:
//
//   GOAL → plan → validate → persist → CONTEXT → DAG → POLICY →
//   ROUTE (agents/tools) → EXECUTE (parallel, worktrees) →
//   VALIDATE (+ adversarial review, repair loop) → REPORT →
//   MEMORY → EVENTS → NEXT DECISION
//
// Execution itself stays injectable: tests use mock agent runners; the
// executorBridge below dispatches through the UNCHANGED Phase 1
// executor (which is how the real Claude runs — and how the mock
// provider runs in integration tests, consuming zero quota).
// =====================================================

var domain = require('./domain');
var store = require('./store');
var memory = require('./memory');
var context = require('./context');
var planner = require('./planner');
var scheduler = require('./scheduler');
var policyEngine = require('./policy-engine');
var validation = require('./validation');
var router = require('./provider-router');
var reputation = require('./reputation');
var events = require('./events');
var tools = require('./tool-registry');
var agents = require('./agent-registry');

// --- Goal intake -------------------------------------------------------------

// Accepts a goal, plans it, validates the plan, persists the mission.
// Returns { goal, mission, tasks, plan } with mission in VALIDATED.
function submitGoal(text, opts) {
  opts = opts || {};
  var engine = opts.policy || policyEngine.createEngine();
  var goal = domain.createGoal({
    text: text,
    project: opts.project || 'mythos-prod',
    requested_by: opts.requested_by || 'owner'
  });
  store.create(goal);
  events.emit('GOAL_CREATED', { subject_id: goal.id, project: goal.project,
    correlation_id: goal.correlation_id, detail: { text: text.slice(0, 200) } });
  store.transition('goal', goal.id, 'PLANNING');

  var plan = opts.spec
    ? planner.planFromSpec(goal, opts.spec)
    : planner.planMission(goal, opts.hints);
  var vetted = planner.validatePlan(plan, function (req) {
    return engine.checkPolicy({
      action_class: req.action_class, project: goal.project, amount_usd: req.amount_usd
    });
  });
  if (!plan.valid || !vetted.valid) {
    store.transition('goal', goal.id, 'FAILED', {
      metadata: { plan_errors: plan.errors.concat(vetted.errors) }
    });
    return { goal: goal, plan: plan, errors: plan.errors.concat(vetted.errors), rejected: true };
  }
  var persisted = planner.persistPlan(plan);
  store.transition('mission', persisted.mission.id, 'VALIDATED');
  store.transition('goal', goal.id, 'ACTIVE');
  // Return FRESH copies — transitions mutate the store, not local objects.
  return {
    goal: store.load('goal', goal.id),
    mission: store.load('mission', persisted.mission.id),
    tasks: persisted.tasks.map(function (t) { return store.load('task', t.id); }),
    plan: plan,
    rejected: false
  };
}

// --- Task runner assembly -------------------------------------------------------

// Builds the scheduler runner for a mission: route → context → tool
// grants → agent execution. `opts.agent_runner(agentName, task, ctx)`
// performs the actual work (mock in tests; executorBridge in production)
// and resolves { status: 'completed'|'failed', summary, commit?, ... }.
function buildRunner(opts) {
  var engine = opts.policy || policyEngine.createEngine();
  return function runner(task, ctx) {
    var decision = router.route(task, {
      quota_state: opts.quota_state, fresh: opts.fresh_health, exclude: opts.exclude_agents
    });
    if (decision.action === 'wait_for_quota') {
      return Promise.resolve({ status: 'WAITING_FOR_QUOTA' });
    }
    if (decision.action === 'no_provider') {
      return Promise.resolve({ status: 'FAILED', error: decision.reason });
    }
    var agentName = decision.agent;
    var t = store.load('task', task.id);
    t.agent_id = agentName;
    if (decision.action === 'fallback') t.metadata.fallback_from = decision.from;
    store.save(t);

    var assembled = context.assembleContext({
      project: task.project || 'mythos-prod',
      instruction: task.instruction,
      repo_path: (ctx.worktree && ctx.worktree.dir) || opts.repo_path
    });
    // Re-read the task: the scheduler has just written this attempt's
    // budget reservation and any prior validation findings onto it.
    var freshTask = store.load('task', task.id) || task;
    var grants = tools.grantTools(task.capabilities_required, function (req) {
      return engine.checkPolicy({
        action_class: req.action_class, tool: req.tool, project: task.project,
        // A declared task budget travels into MONEY_SPEND checks; no
        // budget declared means the spend gate sees no amount and denies.
        amount_usd: task.metadata && typeof task.metadata.budget_usd === 'number'
          ? task.metadata.budget_usd : undefined,
        // The scheduler already reserved this task's spend before
        // dispatch; its own hold must not block granting its own tools.
        exclude_reservation_id: freshTask.metadata && freshTask.metadata.budget_reservation_id
      });
    });
    // Repair feedback channel: a repairing agent must SEE what was
    // rejected, or the repair loop converges only by luck. (Found live in
    // the first real mission: three blind retries, all rejected.)
    var repairNotes = null;
    if (freshTask.metadata && Array.isArray(freshTask.metadata.validation_rejections) &&
        freshTask.metadata.validation_rejections.length) {
      repairNotes = '## REPAIR REQUIRED (attempt ' + (freshTask.attempt || 1) + ')\n' +
        'Your previous attempt was REJECTED by independent validation/review. ' +
        'Fix every finding below in this attempt:\n' +
        freshTask.metadata.validation_rejections.map(function (r) { return '- ' + r; }).join('\n');
    }
    var runCtx = Object.assign({}, ctx, {
      agent: agentName, context: assembled, tool_grants: grants, tools: tools,
      repair_notes: repairNotes
    });
    return Promise.resolve(opts.agent_runner(agentName, store.load('task', task.id), runCtx))
      .then(function (result) {
        if (result && result.__core_status === 'WAITING_FOR_QUOTA') {
          return { status: 'WAITING_FOR_QUOTA' };
        }
        if (result && result.commit) {
          events.emit('COMMIT_CREATED', {
            subject_id: task.id, project: task.project,
            detail: { commit: result.commit, agent: agentName }
          });
        }
        return { status: 'VALIDATING', result: result };
      });
  };
}

// --- Mission advancement -----------------------------------------------------------

// Runs a mission through the scheduler with validation and repair wired
// in. Safe to call repeatedly: WAITING missions (quota/approval) resume.
function advanceMission(missionId, opts) {
  opts = opts || {};
  if (typeof opts.agent_runner !== 'function') {
    return Promise.reject(new Error('ORCHESTRATOR_NEEDS_AGENT_RUNNER'));
  }
  var validatorOpts = {
    review_fn: opts.review_fn,
    review: opts.review !== false,
    test_runner: opts.test_runner,
    repo_path: opts.repo_path
  };
  return scheduler.runMission(missionId, {
    runner: buildRunner(opts),
    policy: opts.policy,
    repo_path: opts.repo_path,
    max_parallel: opts.max_parallel,
    isolate_worktrees: opts.isolate_worktrees,
    validator: function (task) {
      var settled = validation.validateAndSettle(task.id, task.result, Object.assign({}, validatorOpts, {
        worktree_dir: task.metadata && task.metadata.worktree_dir
      }));
      if (task.agent_id) {
        reputation.recordOutcome(task.agent_id,
          (task.capabilities_required || [])[0] || task.task_type,
          settled.status === 'COMPLETED');
      }
      return settled;
    }
  }).then(function (mission) {
    if (['COMPLETED', 'FAILED'].indexOf(mission.status) !== -1) {
      return finalizeMission(mission, opts);
    }
    return mission;
  });
}

// Releases quota-parked tasks back to READY (router/scheduler re-gate).
function resumeQuota(missionId) {
  var mission = store.load('mission', missionId);
  var released = [];
  mission.task_ids.forEach(function (id) {
    var t = store.load('task', id);
    if (t.status === 'WAITING_FOR_QUOTA') {
      store.transition('task', id, 'READY');
      events.emit('TASK_RESUMED', { subject_id: id, project: t.project, detail: { from: 'WAITING_FOR_QUOTA' } });
      released.push(id);
    }
  });
  return released;
}

// --- Completion: report, memory, goal state, next decision -------------------------

function finalizeMission(mission, opts) {
  opts = opts || {};
  var tasks = mission.task_ids.map(function (id) { return store.load('task', id); });
  var summary = mission.status === 'COMPLETED'
    ? 'Mission completed: ' + tasks.filter(function (t) { return t.status === 'COMPLETED'; }).length + '/' + tasks.length + ' tasks.'
    : 'Mission failed: ' + tasks.filter(function (t) { return t.status === 'FAILED'; }).length + ' failed, ' +
      (mission.metadata.doomed || []).length + ' blocked by dependencies.';

  var report = domain.createReport({
    subject_id: mission.id, project: mission.project,
    correlation_id: mission.correlation_id, status: 'FINAL',
    summary: summary,
    details: {
      tasks: tasks.map(function (t) {
        return { id: t.id, title: t.title, status: t.status, agent: t.agent_id, attempt: t.attempt };
      }),
      peak_concurrency: mission.metadata.peak_concurrency || null
    }
  });
  store.create(report);

  if (mission.project) {
    try {
      memory.remember({
        project: mission.project,
        category: mission.status === 'COMPLETED' ? 'completed_work' : 'known_issue',
        title: mission.title.slice(0, 180),
        content: summary + ' (mission ' + mission.id + ', report ' + report.id + ')',
        source: 'mission:' + mission.id,
        confidence: 1.0,
        correlation_id: mission.correlation_id
      });
    } catch (e) { /* memory refusal (e.g. secret shape) must not lose the mission result */ }
  }

  var goal = store.load('goal', mission.goal_id);
  if (goal && goal.status === 'ACTIVE') {
    store.transition('goal', goal.id, mission.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED');
  }
  var decision = domain.createDecision({
    subject_id: mission.id, project: mission.project, correlation_id: mission.correlation_id,
    decision: mission.status === 'COMPLETED'
      ? 'Mission succeeded; next decision belongs to the control layer.'
      : 'Mission did not complete; inspect the report and doomed tasks before re-planning.',
    rationale: summary, decided_by: 'orchestrator'
  });
  store.create(decision);
  events.emit('DECISION_MADE', {
    subject_id: mission.id, project: mission.project, correlation_id: mission.correlation_id,
    detail: { decision_id: decision.id, report_id: report.id, mission_status: mission.status }
  });
  mission.metadata.report_id = report.id;
  store.save(mission);
  return mission;
}

// --- Phase 1 executor bridge ---------------------------------------------------------

// Dispatches a core task through the UNCHANGED Phase 1 executor. The
// executor keeps everything it already proved: headless sessions, quota
// lifecycle, retries, redaction, report delivery. Core states map
// through TASK_STATE_COMPAT; an executor COMPLETED comes back as a
// result for core VALIDATION — never trusted directly.
function executorBridge(executorModule, profileByType) {
  profileByType = profileByType || { coding: 'repo-write', integration: 'repo-write' };
  return function (agentName, task, ctx) {
    var agentDef = agents.getAgent(agentName);
    var provider = agentDef ? agentDef.provider : 'claude-code';
    var created = executorModule.createTask({
      project: 'mythos-prod',
      stage: 'CORE-' + (task.metadata.plan_key || task.id),
      instruction: task.instruction + '\n\n' + context.renderContext(ctx.context) +
        (ctx.repair_notes ? '\n\n' + ctx.repair_notes : ''),
      provider: provider,
      execution_profile: agentDef && agentDef.execution_authority
        ? (profileByType[task.task_type] || 'repo-read') : undefined,
      working_directory: ctx.worktree ? ctx.worktree.dir : undefined,
      report_to_git: false,
      requested_by: 'orchestration-core'
    });
    var t = store.load('task', task.id);
    t.executor_task_id = created.task_id;
    // Registered SYNCHRONOUSLY, before the run starts: a cancellation that
    // arrives mid-flight must be able to find and stop this executor task.
    // (Deferring this to the run promise's .then() orphaned in-flight tasks
    // — found by independent architecture review, regression-tested.)
    t.metadata.executor_task_ids = (t.metadata.executor_task_ids || []).concat([created.task_id]);
    if (ctx.worktree) t.metadata.worktree_dir = ctx.worktree.dir;
    store.save(t);
    return executorModule.runTask(created.task_id).then(function (execStatus) {
      var coreState = domain.TASK_STATE_COMPAT.fromExecutor[execStatus.status] || 'FAILED';
      if (coreState === 'WAITING_FOR_QUOTA') {
        // Surface quota to the core state machine; the executor keeps
        // its own session/checkpoint for the eventual resume.
        return { status: 'failed_quota_bridge', __core_status: 'WAITING_FOR_QUOTA' };
      }
      var reportJson = require('./../lib/state').readJSON(created.task_id, 'report.json');
      var r = (reportJson && reportJson.report) || {};
      return {
        status: r.status || (coreState === 'VALIDATING' ? 'completed' : 'failed'),
        summary: r.summary || ('executor task ' + created.task_id + ' → ' + execStatus.status),
        commit: r.commit || null,
        tests: r.tests || [],
        executor_task_id: created.task_id
      };
    });
  };
}

module.exports = {
  submitGoal: submitGoal,
  buildRunner: buildRunner,
  advanceMission: advanceMission,
  resumeQuota: resumeQuota,
  finalizeMission: finalizeMission,
  executorBridge: executorBridge
};
