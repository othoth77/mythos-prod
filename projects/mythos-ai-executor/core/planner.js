'use strict';
// =====================================================
// Mythos Orchestration Core — mission planner (Phase 2E)
// projects/mythos-ai-executor/core/planner.js
//
// Goal → Mission → Task decomposition. Two entry points:
//
//   planMission(goal, hints)   deterministic template-based plan
//   planFromSpec(goal, spec)   accept an EXTERNALLY produced plan (e.g.
//                              from an LLM) — but nothing an LLM writes
//                              executes merely because it was generated:
//                              every plan passes schema, policy and
//                              dependency validation before persistence,
//                              and unknown task types / policy classes /
//                              extra fields are refused, not tolerated.
//
// A plan is INSPECTABLE before execution: explainPlan renders the tree,
// and persistPlan is a separate explicit step.
// =====================================================

var domain = require('./domain');
var store = require('./store');
var dag = require('./dag');

var TASK_TYPES = ['inspection', 'research', 'analysis', 'design', 'coding',
  'testing', 'review', 'integration', 'validation', 'documentation',
  'reporting', 'marketing', 'generic'];

var TYPE_DEFAULTS = {
  inspection:   { capabilities: ['repo_inspection'], policy_classes: ['READ'] },
  research:     { capabilities: ['research'], policy_classes: ['READ', 'EXTERNAL_API'] },
  analysis:     { capabilities: ['analysis'], policy_classes: ['READ'] },
  design:       { capabilities: ['planning'], policy_classes: ['READ'] },
  coding:       { capabilities: ['coding'], policy_classes: ['READ', 'PROJECT_WRITE', 'GIT'] },
  testing:      { capabilities: ['testing'], policy_classes: ['READ', 'PROJECT_WRITE'] },
  review:       { capabilities: ['review'], policy_classes: ['READ'] },
  integration:  { capabilities: ['coding', 'testing'], policy_classes: ['READ', 'PROJECT_WRITE', 'GIT'] },
  validation:   { capabilities: ['review', 'testing'], policy_classes: ['READ'] },
  documentation:{ capabilities: ['documentation'], policy_classes: ['READ', 'PROJECT_WRITE', 'GIT'] },
  reporting:    { capabilities: ['summarization'], policy_classes: ['READ'] },
  marketing:    { capabilities: ['marketing_campaign'], policy_classes: ['EXTERNAL_API', 'MONEY_SPEND'] },
  generic:      { capabilities: [], policy_classes: ['READ'] }
};

var SPEC_TASK_FIELDS = ['key', 'title', 'task_type', 'instruction',
  'capabilities_required', 'policy_classes', 'depends_on', 'max_attempts',
  'budget_usd'];

// --- Template planning ------------------------------------------------------

// The default development template. `hints.components` forks parallel
// implementation branches that merge into integration.
function planMission(goal, hints) {
  hints = hints || {};
  var spec = { title: hints.title || ('Mission: ' + goal.text.slice(0, 120)), tasks: [] };

  spec.tasks.push({ key: 'inspect', title: 'Inspect current state', task_type: 'inspection',
    instruction: 'Inspect the current implementation relevant to: ' + goal.text, depends_on: [] });
  spec.tasks.push({ key: 'analyze', title: 'Analyze findings', task_type: 'analysis',
    instruction: 'Analyze inspection findings for: ' + goal.text, depends_on: ['inspect'] });
  spec.tasks.push({ key: 'design', title: 'Design the change', task_type: 'design',
    instruction: 'Design the smallest coherent change for: ' + goal.text, depends_on: ['analyze'] });

  var implementKeys = [];
  var components = hints.components && hints.components.length ? hints.components : [null];
  components.forEach(function (component, i) {
    var key = component ? 'implement-' + component : 'implement';
    implementKeys.push(key);
    spec.tasks.push({
      key: key,
      title: 'Implement' + (component ? ' ' + component : ''),
      task_type: 'coding',
      instruction: 'Implement the designed change' + (component ? ' for component: ' + component : '') +
        '. Goal: ' + goal.text,
      depends_on: ['design']
    });
  });

  var afterImplement = implementKeys;
  if (implementKeys.length > 1) {
    spec.tasks.push({ key: 'integrate', title: 'Integrate parallel branches', task_type: 'integration',
      instruction: 'Integrate the parallel implementation branches.', depends_on: implementKeys });
    afterImplement = ['integrate'];
  }

  spec.tasks.push({ key: 'test', title: 'Run targeted tests', task_type: 'testing',
    instruction: 'Run targeted tests for the change.', depends_on: afterImplement });
  spec.tasks.push({ key: 'review', title: 'Adversarial review', task_type: 'review',
    instruction: 'Actively search for regressions, missing requirements, security problems, edge cases.',
    depends_on: ['test'] });
  spec.tasks.push({ key: 'report', title: 'Report results', task_type: 'reporting',
    instruction: 'Produce the structured mission report.', depends_on: ['review'] });

  return buildPlan(goal, spec);
}

// --- External (LLM-supplied) plans -------------------------------------------

function planFromSpec(goal, spec) {
  return buildPlan(goal, spec);
}

// Normalises and validates a spec into a plan object (NOT persisted).
function buildPlan(goal, spec) {
  if (!goal || goal.entity_type !== 'goal') throw new Error('PLAN_REQUIRES_GOAL');
  if (!spec || !Array.isArray(spec.tasks) || !spec.tasks.length) {
    throw new Error('PLAN_SPEC_EMPTY: a mission needs at least one task');
  }
  var errors = [];
  var tasks = spec.tasks.map(function (raw, i) {
    Object.keys(raw).forEach(function (f) {
      if (SPEC_TASK_FIELDS.indexOf(f) === -1) {
        errors.push('SPEC_UNKNOWN_FIELD: tasks[' + i + '].' + f + ' — generated plans carry no extra instructions');
      }
    });
    if (!raw.key || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(raw.key)) {
      errors.push('SPEC_BAD_KEY: tasks[' + i + ']');
    }
    if (!raw.title) errors.push('SPEC_MISSING_TITLE: tasks[' + i + ']');
    var type = raw.task_type || 'generic';
    if (TASK_TYPES.indexOf(type) === -1) {
      errors.push('SPEC_UNKNOWN_TASK_TYPE: tasks[' + i + '] → ' + String(type).slice(0, 40));
    }
    var defaults = TYPE_DEFAULTS[type] || TYPE_DEFAULTS.generic;
    var policyClasses = raw.policy_classes || defaults.policy_classes;
    (policyClasses || []).forEach(function (pc) {
      if (domain.POLICY_CLASSES.indexOf(pc) === -1) {
        errors.push('SPEC_UNKNOWN_POLICY_CLASS: tasks[' + i + '] → ' + String(pc).slice(0, 40));
      }
    });
    return {
      key: raw.key,
      title: String(raw.title || '').slice(0, 200),
      task_type: type,
      instruction: String(raw.instruction || '').slice(0, 20000),
      capabilities_required: raw.capabilities_required || defaults.capabilities,
      policy_classes: policyClasses,
      depends_on: raw.depends_on || [],
      max_attempts: raw.max_attempts === undefined ? 3 : raw.max_attempts,
      budget_usd: typeof raw.budget_usd === 'number' ? raw.budget_usd : null
    };
  });

  // Dependency validation over local keys.
  var graphCheck = dag.validateGraph(tasks.map(function (t) {
    return { id: t.key, status: 'QUEUED', depends_on: t.depends_on };
  }));
  if (!graphCheck.valid) errors = errors.concat(graphCheck.errors);

  return {
    goal_id: goal.id,
    correlation_id: goal.correlation_id,
    project: goal.project,
    title: String(spec.title || ('Mission for ' + goal.id)).slice(0, 200),
    tasks: tasks,
    errors: errors,
    valid: errors.length === 0,
    order: graphCheck.valid ? graphCheck.order : null
  };
}

// Full validation gate: structure + (optionally) policy. Every planned
// action must be policy-checkable BEFORE anything executes.
function validatePlan(plan, policyCheck) {
  var errors = plan.errors.slice();
  if (typeof policyCheck === 'function') {
    plan.tasks.forEach(function (t) {
      t.policy_classes.forEach(function (pc) {
        var decision = policyCheck({
          action_class: pc, task_type: t.task_type,
          amount_usd: typeof t.budget_usd === 'number' ? t.budget_usd : undefined
        });
        if (!decision || decision.decision === 'deny') {
          errors.push('PLAN_POLICY_DENIED: task "' + t.key + '" needs ' + pc +
            (decision && decision.reason ? ' — ' + decision.reason : ''));
        }
      });
    });
  }
  return { valid: errors.length === 0, errors: errors };
}

// Human-readable plan tree — the inspectability requirement.
function explainPlan(plan) {
  var lines = ['MISSION: ' + plan.title + '  (goal ' + plan.goal_id + ', ' +
    plan.tasks.length + ' tasks' + (plan.valid ? '' : ', INVALID') + ')'];
  plan.tasks.forEach(function (t) {
    lines.push('  [' + t.task_type + '] ' + t.key + ': ' + t.title +
      (t.depends_on.length ? '   ⇐ after ' + t.depends_on.join(', ') : '   (no dependencies)') +
      '   policy: ' + t.policy_classes.join('+'));
  });
  if (plan.errors.length) {
    lines.push('  ERRORS:');
    plan.errors.forEach(function (e) { lines.push('    - ' + e); });
  }
  return lines.join('\n');
}

// Persists a VALID plan: mission + tasks, dependency keys resolved to
// real task ids, initial statuses derived from the graph.
function persistPlan(plan) {
  if (!plan.valid) throw new Error('PLAN_INVALID: refusing to persist — ' + plan.errors.join('; '));
  var mission = domain.createMission({
    goal_id: plan.goal_id,
    title: plan.title,
    project: plan.project,
    correlation_id: plan.correlation_id,
    parent_id: plan.goal_id,
    plan_explanation: explainPlan(plan)
  });
  var idByKey = {};
  var taskEntities = plan.tasks.map(function (t) {
    var entity = domain.createTask({
      mission_id: mission.id,
      project: plan.project,
      correlation_id: plan.correlation_id,
      parent_id: mission.id,
      title: t.title,
      instruction: t.instruction,
      task_type: t.task_type,
      capabilities_required: t.capabilities_required,
      policy_classes: t.policy_classes,
      max_attempts: t.max_attempts,
      status: t.depends_on.length ? 'WAITING_FOR_DEPENDENCY' : 'QUEUED',
      metadata: t.budget_usd === null
        ? { plan_key: t.key }
        : { plan_key: t.key, budget_usd: t.budget_usd }
    });
    idByKey[t.key] = entity.id;
    return { spec: t, entity: entity };
  });
  taskEntities.forEach(function (pair) {
    pair.entity.depends_on = pair.spec.depends_on.map(function (k) { return idByKey[k]; });
    store.create(pair.entity);
  });
  mission.task_ids = taskEntities.map(function (p) { return p.entity.id; });
  store.create(mission);
  store.appendEventLine({
    event_type: 'MISSION_PLANNED', subject_id: mission.id,
    correlation_id: plan.correlation_id, project: plan.project,
    detail: { goal_id: plan.goal_id, tasks: mission.task_ids.length }
  });
  return { mission: mission, tasks: taskEntities.map(function (p) { return p.entity; }) };
}

module.exports = {
  TASK_TYPES: TASK_TYPES,
  TYPE_DEFAULTS: TYPE_DEFAULTS,
  planMission: planMission,
  planFromSpec: planFromSpec,
  validatePlan: validatePlan,
  explainPlan: explainPlan,
  persistPlan: persistPlan
};
