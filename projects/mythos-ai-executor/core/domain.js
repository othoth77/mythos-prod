'use strict';
// =====================================================
// Mythos Orchestration Core — domain model (Phase 2A)
// projects/mythos-ai-executor/core/domain.js
//
// The internal domain model for the orchestration core, implementing
// docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md §3 on top of the Phase 1
// executor — incrementally, NOT as a rewrite. The Phase 1 executor keeps
// its own task states untouched; TASK_STATE_COMPAT below is the explicit
// adapter between the two vocabularies.
//
// Every entity carries: stable id, type, status, created_at/updated_at,
// correlation_id (threads one goal's causality through every derived
// entity), parent linkage, and open metadata. Constructors validate;
// nothing here performs I/O — persistence lives in core/store.js.
// =====================================================

var crypto = require('crypto');

// --- Entity types -----------------------------------------------------------

var ENTITY_TYPES = [
  'goal', 'mission', 'task', 'task_dependency', 'agent', 'tool', 'provider',
  'context', 'policy', 'execution', 'artifact', 'event', 'report', 'decision',
  'memory_entry', 'approval'
];

// --- Status vocabularies ------------------------------------------------------

var GOAL_STATES = ['RECEIVED', 'PLANNING', 'ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED'];

var MISSION_STATES = ['PLANNED', 'VALIDATED', 'RUNNING', 'WAITING', 'INTEGRATING',
  'COMPLETED', 'FAILED', 'CANCELLED'];

// Phase 2 task states (§5 of the Phase 2 order). The Phase 1 executor's
// states remain valid for its own queue; these are the orchestration-core
// states used by DAG scheduling.
var TASK_STATES = [
  'QUEUED',
  'PLANNING',
  'READY',
  'RUNNING',
  'WAITING_FOR_DEPENDENCY',
  'WAITING_FOR_QUOTA',
  'WAITING_FOR_APPROVAL',
  'RETRYING',
  'VALIDATING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
];

var TASK_TRANSITIONS = {
  QUEUED:                 ['PLANNING', 'READY', 'WAITING_FOR_DEPENDENCY', 'CANCELLED'],
  PLANNING:               ['READY', 'WAITING_FOR_DEPENDENCY', 'FAILED', 'CANCELLED'],
  READY:                  ['RUNNING', 'WAITING_FOR_APPROVAL', 'CANCELLED'],
  RUNNING:                ['VALIDATING', 'WAITING_FOR_QUOTA', 'RETRYING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  WAITING_FOR_DEPENDENCY: ['READY', 'FAILED', 'CANCELLED'],
  WAITING_FOR_QUOTA:      ['RUNNING', 'READY', 'CANCELLED'],
  WAITING_FOR_APPROVAL:   ['READY', 'RUNNING', 'CANCELLED', 'FAILED'],
  RETRYING:               ['RUNNING', 'READY', 'FAILED', 'CANCELLED'],
  VALIDATING:             ['COMPLETED', 'RETRYING', 'FAILED'],
  COMPLETED:              [],
  FAILED:                 ['QUEUED'],   // explicit re-queue only
  CANCELLED:              []
};

// Adapter between Phase 1 executor states and core task states. The
// executor is not modified; when the core dispatches a task through the
// Phase 1 engine it maps the resulting state back through this table.
var TASK_STATE_COMPAT = {
  fromExecutor: {
    QUEUED: 'QUEUED',
    RUNNING: 'RUNNING',
    WAITING_FOR_QUOTA: 'WAITING_FOR_QUOTA',
    WAITING_RETRY: 'RETRYING',
    COMPLETED: 'VALIDATING',   // executor "done" enters core validation, never trusted directly
    FAILED: 'FAILED',
    BLOCKED: 'WAITING_FOR_APPROVAL',
    CANCELLED: 'CANCELLED'
  },
  toExecutor: {
    READY: 'QUEUED',
    RUNNING: 'RUNNING',
    WAITING_FOR_QUOTA: 'WAITING_FOR_QUOTA',
    RETRYING: 'WAITING_RETRY',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    WAITING_FOR_APPROVAL: 'BLOCKED',
    CANCELLED: 'CANCELLED'
  }
};

var EXECUTION_STATES = ['STARTED', 'SUCCEEDED', 'FAILED', 'INTERRUPTED', 'TIMED_OUT'];

var EVENT_TYPES = [
  'GOAL_CREATED', 'MISSION_PLANNED', 'MISSION_STARTED', 'MISSION_COMPLETED', 'MISSION_FAILED',
  'TASK_CREATED', 'TASK_STARTED', 'TASK_COMPLETED', 'TASK_FAILED', 'TASK_RETRYING',
  'TASK_WAITING', 'TASK_RESUMED', 'QUOTA_EXHAUSTED', 'PROVIDER_UNAVAILABLE',
  'PROVIDER_FALLBACK', 'VALIDATION_FAILED', 'VALIDATION_PASSED', 'REVIEW_REJECTED',
  'REVIEW_PASSED', 'COMMIT_CREATED', 'DEPLOY_STARTED', 'DEPLOY_COMPLETED', 'ROLLBACK',
  'POLICY_DENIED', 'APPROVAL_REQUESTED', 'APPROVAL_GRANTED', 'MEMORY_UPDATED',
  'WORKTREE_CREATED', 'WORKTREE_REMOVED', 'DECISION_MADE',
  // Cumulative spend ledger (budget ≠ provider quota; see core/budget.js)
  'BUDGET_CHECKED', 'BUDGET_RESERVED', 'BUDGET_RELEASED', 'BUDGET_SETTLED',
  'BUDGET_DENIED', 'BUDGET_APPROVAL_REQUIRED', 'BUDGET_PERIOD_RESET'
];

// Policy classes (§12 of the Phase 2 order). DESTRUCTIVE and ROOT exist so
// they can be explicitly DENIED — they are never grantable surfaces.
var POLICY_CLASSES = ['READ', 'PROJECT_WRITE', 'GIT', 'SERVICE', 'DEPLOY', 'ROOT',
  'EXTERNAL_API', 'MONEY_SPEND', 'DESTRUCTIVE'];

// --- Identity ------------------------------------------------------------------

var ID_PREFIX = {
  goal: 'g', mission: 'm', task: 'tk', agent: 'ag', tool: 'tl', provider: 'pv',
  context: 'cx', policy: 'po', execution: 'ex', artifact: 'ar', event: 'ev',
  report: 'rp', decision: 'dc', memory_entry: 'me', approval: 'ap',
  task_dependency: 'td'
};

var ID_RE = /^[a-z]{1,2}-[a-z0-9]{6,12}-[a-z0-9]{4,8}$/;

function newId(entityType) {
  var prefix = ID_PREFIX[entityType];
  if (!prefix) throw new Error('UNKNOWN_ENTITY_TYPE: ' + String(entityType));
  var ts = Date.now().toString(36);
  var rand = crypto.randomBytes(4).toString('hex').slice(0, 6);
  return prefix + '-' + ts + '-' + rand;
}

function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id) && id.indexOf('..') === -1;
}

// --- Construction ----------------------------------------------------------------

function nowIso() { return new Date().toISOString(); }

// Base envelope every entity shares.
function baseEntity(entityType, fields) {
  fields = fields || {};
  var id = fields.id || newId(entityType);
  if (!isValidId(id)) throw new Error('INVALID_ID: ' + String(id).slice(0, 60));
  return {
    id: id,
    entity_type: entityType,
    status: fields.status || null,
    created_at: fields.created_at || nowIso(),
    updated_at: fields.updated_at || nowIso(),
    correlation_id: fields.correlation_id || id,
    parent_id: fields.parent_id || null,
    project: fields.project || null,
    metadata: fields.metadata || {}
  };
}

function requireString(fields, key, max) {
  var v = fields[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error('MISSING_FIELD: ' + key);
  if (max && v.length > max) throw new Error('FIELD_TOO_LONG: ' + key);
  return v;
}

function createGoal(fields) {
  var e = baseEntity('goal', fields);
  e.status = fields.status || 'RECEIVED';
  e.text = requireString(fields, 'text', 4000);
  e.requested_by = fields.requested_by || 'owner';
  return e;
}

function createMission(fields) {
  var e = baseEntity('mission', fields);
  e.status = fields.status || 'PLANNED';
  e.goal_id = requireString(fields, 'goal_id');
  e.title = requireString(fields, 'title', 200);
  e.task_ids = fields.task_ids || [];
  e.max_parallel_agents = fields.max_parallel_agents || 2;
  e.plan_explanation = fields.plan_explanation || null;
  return e;
}

function createTask(fields) {
  var e = baseEntity('task', fields);
  e.status = fields.status || 'QUEUED';
  e.mission_id = fields.mission_id || null;
  e.title = requireString(fields, 'title', 200);
  e.instruction = fields.instruction || '';
  e.task_type = fields.task_type || 'generic';  // coding|research|review|testing|integration|generic|...
  e.capabilities_required = fields.capabilities_required || [];
  e.depends_on = fields.depends_on || [];        // task ids
  e.policy_classes = fields.policy_classes || ['READ'];
  e.agent_id = fields.agent_id || null;
  e.tool_grants = fields.tool_grants || [];
  e.executor_task_id = fields.executor_task_id || null;  // Phase 1 bridge
  e.attempt = fields.attempt || 0;
  e.max_attempts = fields.max_attempts === undefined ? 3 : fields.max_attempts;
  e.result = fields.result || null;
  return e;
}

function createExecution(fields) {
  var e = baseEntity('execution', fields);
  e.status = fields.status || 'STARTED';
  e.task_id = requireString(fields, 'task_id');
  e.agent_id = fields.agent_id || null;
  e.provider = fields.provider || null;
  e.model = fields.model || null;
  e.attempt = fields.attempt || 1;
  e.quota_state = fields.quota_state || null;
  e.output_ref = fields.output_ref || null;   // never inline output — reference only
  return e;
}

function createMemoryEntry(fields) {
  var e = baseEntity('memory_entry', fields);
  e.status = 'ACTIVE';
  e.project = requireString(fields, 'project', 100);
  e.category = requireString(fields, 'category', 40);
  e.title = requireString(fields, 'title', 200);
  e.content = requireString(fields, 'content', 20000);
  e.source = fields.source || 'unrecorded';
  e.confidence = typeof fields.confidence === 'number' ? fields.confidence : 0.7;
  e.tags = fields.tags || [];
  return e;
}

function createEvent(fields) {
  if (EVENT_TYPES.indexOf(fields.event_type) === -1) {
    throw new Error('UNKNOWN_EVENT_TYPE: ' + String(fields.event_type).slice(0, 60));
  }
  var e = baseEntity('event', fields);
  e.status = 'EMITTED';
  e.event_type = fields.event_type;
  e.subject_id = fields.subject_id || null;
  e.detail = fields.detail || {};
  return e;
}

function createDecision(fields) {
  var e = baseEntity('decision', fields);
  e.status = 'RECORDED';
  e.subject_id = fields.subject_id || null;
  e.decision = requireString(fields, 'decision', 2000);
  e.rationale = fields.rationale || null;
  e.decided_by = fields.decided_by || 'orchestrator';
  return e;
}

function createReport(fields) {
  var e = baseEntity('report', fields);
  e.status = fields.status || 'DRAFT';
  e.subject_id = requireString(fields, 'subject_id');
  e.summary = requireString(fields, 'summary', 8000);
  e.details = fields.details || {};
  return e;
}

function createArtifact(fields) {
  var e = baseEntity('artifact', fields);
  e.status = 'STORED';
  e.task_id = fields.task_id || null;
  e.kind = requireString(fields, 'kind', 60);
  e.path = fields.path || null;
  e.digest = fields.digest || null;
  return e;
}

function createApproval(fields) {
  var e = baseEntity('approval', fields);
  e.status = fields.status || 'PENDING'; // PENDING | GRANTED | DENIED | EXPIRED
  e.subject_id = requireString(fields, 'subject_id');
  e.action_class = requireString(fields, 'action_class', 40);
  e.reason = fields.reason || null;
  e.decided_by = fields.decided_by || null;
  e.decided_at = fields.decided_at || null;
  return e;
}

// --- Transition helpers ---------------------------------------------------------

function checkTransition(table, from, to, subject) {
  if (from === to) return true;
  var allowed = table[from];
  if (!allowed) throw new Error('UNKNOWN_STATE: ' + String(from) + ' for ' + subject);
  if (allowed.indexOf(to) === -1) {
    throw new Error('ILLEGAL_TRANSITION: ' + from + ' -> ' + to + ' for ' + subject);
  }
  return true;
}

function taskTransitionAllowed(from, to) {
  return checkTransition(TASK_TRANSITIONS, from, to, 'task');
}

module.exports = {
  ENTITY_TYPES: ENTITY_TYPES,
  GOAL_STATES: GOAL_STATES,
  MISSION_STATES: MISSION_STATES,
  TASK_STATES: TASK_STATES,
  TASK_TRANSITIONS: TASK_TRANSITIONS,
  TASK_STATE_COMPAT: TASK_STATE_COMPAT,
  EXECUTION_STATES: EXECUTION_STATES,
  EVENT_TYPES: EVENT_TYPES,
  POLICY_CLASSES: POLICY_CLASSES,
  newId: newId,
  isValidId: isValidId,
  createGoal: createGoal,
  createMission: createMission,
  createTask: createTask,
  createExecution: createExecution,
  createMemoryEntry: createMemoryEntry,
  createEvent: createEvent,
  createDecision: createDecision,
  createReport: createReport,
  createArtifact: createArtifact,
  createApproval: createApproval,
  taskTransitionAllowed: taskTransitionAllowed,
  checkTransition: checkTransition
};
