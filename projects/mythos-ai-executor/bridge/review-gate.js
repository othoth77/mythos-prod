'use strict';
// =====================================================
// MYTHOS GitHub bridge — review gate (adapter, not an engine)
// projects/mythos-ai-executor/bridge/review-gate.js
//
// The bridge releases a task's dependents when it reaches COMPLETED. Until
// now COMPLETED meant "the executor finished and the report validated" —
// the independent-review policy that core/validation.js owns was never
// consulted on this path at all, because the bridge/executor path does not
// go through the orchestration core.
//
// This file is the CONNECTION, and nothing more. It contains no review
// logic of its own: it translates a bridge task + its report into the
// shapes core/validation.js already reads, and returns that module's own
// verdict. Whether a task owes a review, what counts as sensitive, and
// which reasons are recorded are all decided there (docs/MYTHOS_REVIEW_POLICY.md).
//
// The core is required LAZILY, the same convention bin/mythos-ai-executor
// uses, so a bridge that never enables the gate never loads the core.
//
// WHO REVIEWS. No automated reviewer is wired into this path: whether an
// LLM may judge another LLM's work is an open owner decision, and this
// file does not pre-empt it. A task that owes a review therefore stops for
// a PERSON — the existing BLOCKED + human_approval path, which the Issue
// adapter already renders as HUMAN_APPROVAL. Approval is expressed the way
// this system already expresses it: the owner adds the rerun label, and the
// continuation attempt carries that approval forward (see `continues`).
//
// Disabled by default. With MYTHOS_BRIDGE_REVIEW_GATE unset, evaluate()
// returns {required:false, reason:'gate_disabled'} without loading the
// core, so the production VPS bridge behaves byte-for-byte as before.
// =====================================================

var DELIVERY_BY_ACTION = require('./action-resolution').DELIVERY_BY_ACTION;

// Execution profiles that can change the repository. They decide
// SENSITIVITY (who may review), never whether a review is owed — that is
// core/validation.js's decision.
var WRITE_PROFILES = ['repo-write', 'autonomous', 'deploy'];

function enabled() {
  var raw = process.env.MYTHOS_BRIDGE_REVIEW_GATE;
  return raw !== undefined && String(raw).trim() !== '' &&
    ['1', 'true', 'yes', 'on'].indexOf(String(raw).trim().toLowerCase()) !== -1;
}

// A bridge task expressed in the shape core/validation.js reads.
//
// The mapping is deliberately derived from the EXISTING action table
// rather than a second list: an action whose delivery is a `commit`
// produces a reviewable change (core calls that task type 'coding'); an
// action that delivers a `report` does not. `review_required` on the task
// can only ESCALATE — an Issue may ask for more review than the policy
// demands, never for less, so nothing an Issue says can waive a review.
function asCoreTask(task) {
  var delivery = DELIVERY_BY_ACTION[task && task.requested_action] || 'report';
  var profile = (task && task.execution && task.execution.execution_profile) || null;
  var writes = WRITE_PROFILES.indexOf(profile) !== -1 || delivery === 'commit';
  return {
    id: task && task.task_id,
    task_type: delivery === 'commit' ? 'coding' : 'analysis',
    policy_classes: writes ? ['READ', 'PROJECT_WRITE', 'GIT'] : ['READ'],
    agent_id: (task && task.execution && task.execution.provider) || null,
    metadata: task && task.review_required === true ? { review_required: true } : {}
  };
}

// A bridge report expressed as a core result. Only the fields core's
// requirement rules read are carried: a claimed commit is what makes an
// otherwise unremarkable task owe a review.
function asCoreResult(report) {
  var commit = report && Array.isArray(report.commits) && report.commits.length
    ? (report.commits[0] && (report.commits[0].sha || report.commits[0].commit || report.commits[0])) : null;
  return {
    status: 'completed',
    summary: (report && report.summary) || '',
    commit: typeof commit === 'string' ? commit : null
  };
}

// Did a person already review this work? The owner approves by adding the
// rerun label to an Issue that stopped for review; the adapter records the
// attempt it continues, and that record is the approval. It is carried
// forward explicitly and named in the report — never inferred from the
// mere fact that a task ran twice.
function humanApproval(task) {
  var c = task && task.continues;
  if (!c || !c.task_id) return null;
  return c.reason === 'review_required' ? c.task_id : null;
}

// evaluate(task, report) → { required, satisfied, reason, sensitive, approved_by, gate }
// `required && !satisfied` is the only combination that holds a task back.
function evaluate(task, report) {
  if (!enabled()) {
    return { required: false, satisfied: true, reason: 'gate_disabled', sensitive: false, approved_by: null, gate: 'off' };
  }
  var validation;
  try {
    validation = require('../core/validation');
  } catch (e) {
    // The gate cannot decide, so it must not let the task through as
    // reviewed: fail closed, with the cause named.
    return { required: true, satisfied: false, reason: 'review_policy_unavailable: ' + String(e.message).slice(0, 120),
      sensitive: true, approved_by: null, gate: 'error' };
  }
  var requirement = validation.reviewRequirement(asCoreTask(task), asCoreResult(report));
  if (!requirement.required) {
    return { required: false, satisfied: true, reason: requirement.reason,
      sensitive: requirement.sensitive, approved_by: null, gate: 'on' };
  }
  var approvedBy = humanApproval(task);
  return {
    required: true,
    satisfied: !!approvedBy,
    reason: requirement.reason,
    sensitive: requirement.sensitive,
    approved_by: approvedBy,
    gate: 'on'
  };
}

module.exports = {
  enabled: enabled,
  evaluate: evaluate,
  asCoreTask: asCoreTask,
  asCoreResult: asCoreResult,
  humanApproval: humanApproval,
  WRITE_PROFILES: WRITE_PROFILES
};
