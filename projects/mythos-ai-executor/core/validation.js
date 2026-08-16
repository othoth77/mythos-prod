'use strict';
// =====================================================
// Mythos Orchestration Core — validation system (Phase 2I)
// projects/mythos-ai-executor/core/validation.js
//
// "No important agent result should be trusted merely because the agent
// reports completed." Every result passes independent validators:
//
//   schema        result shape is structurally sound
//   completeness  required fields / required files actually exist
//   security      no secret shapes anywhere in the result
//   git           claimed commits exist in the task's worktree/repo
//   tests         required checks actually ran and passed (injectable)
//   policy        actions used ⊆ policy classes granted
//
// plus an ADVERSARIAL REVIEWER: an agent DIFFERENT from the author,
// tasked with hunting for what is wrong (regressions, missing
// requirements, security problems, wrong assumptions, edge cases,
// incompleteness) — never with confirming what is right.
//
// validateAndSettle owns the repair loop: VALIDATING → COMPLETED on
// pass; → RETRYING while attempts remain on reject; → FAILED when the
// budget is spent. Rejections carry the findings so the repairing agent
// knows exactly what to fix.
// =====================================================

var fs = require('fs');

var store = require('./store');
var agents = require('./agent-registry');
var gitlib = require('../../mythos-orchestrator/lib/git');
var redact = require('../../mythos-orchestrator/lib/redact');

// --- Individual validators (each returns { name, pass, problems: [] }) --------

function schemaValidator(task, result) {
  var problems = [];
  if (!result || typeof result !== 'object') problems.push('result is not an object');
  else {
    if (!result.summary || typeof result.summary !== 'string') problems.push('missing summary');
    if (['completed', 'failed', 'blocked'].indexOf(result.status) === -1) {
      problems.push('invalid result status: ' + String(result.status).slice(0, 30));
    }
    // A result that REPORTS failure is a valid shape but never a settled
    // success: it must reject into the repair loop, not become COMPLETED.
    // (Found live: an executor-run failure surfaced as a schema-valid
    // "failed" result and only the adversarial reviewer stopped it.)
    if (result.status === 'failed') {
      problems.push('result reports failure — cannot settle as COMPLETED: ' +
        String(result.summary || '').slice(0, 160));
    }
  }
  return { name: 'schema', pass: problems.length === 0, problems: problems };
}

function completenessValidator(task, result) {
  var problems = [];
  var required = (task.metadata && task.metadata.required_fields) || [];
  required.forEach(function (f) {
    if (!result || result[f] === undefined || result[f] === null || result[f] === '') {
      problems.push('required field missing: ' + f);
    }
  });
  var requiredFiles = (task.metadata && task.metadata.required_files) || [];
  requiredFiles.forEach(function (f) {
    if (!fs.existsSync(f)) problems.push('required file missing: ' + f);
  });
  return { name: 'completeness', pass: problems.length === 0, problems: problems };
}

function securityValidator(task, result) {
  var kinds = redact.findSecretKinds(JSON.stringify(result || {}));
  return {
    name: 'security', pass: kinds.length === 0,
    problems: kinds.map(function (k) { return 'secret shape in result: ' + k; })
  };
}

function gitValidator(task, result, opts) {
  var problems = [];
  var repo = (opts && opts.worktree_dir) || (opts && opts.repo_path) || null;
  if (result && result.commit) {
    if (!repo || !gitlib.isRepo(repo)) {
      problems.push('result claims commit ' + String(result.commit).slice(0, 12) + ' but no repository is in scope');
    } else if (!gitlib.commitExists(repo, result.commit)) {
      problems.push('claimed commit does not exist: ' + String(result.commit).slice(0, 12));
    }
  } else if (task.task_type === 'coding' && task.metadata && task.metadata.commit_required) {
    problems.push('coding task required a commit but the result claims none');
  }
  return { name: 'git', pass: problems.length === 0, problems: problems };
}

function testsValidator(task, result, opts) {
  var problems = [];
  var required = (task.metadata && task.metadata.required_tests) || [];
  if (required.length) {
    var runner = opts && opts.test_runner;
    if (typeof runner !== 'function') {
      problems.push('required tests exist but no test runner is available');
    } else {
      required.forEach(function (t) {
        var out;
        try { out = runner(t, task); } catch (e) { out = { pass: false, detail: e.message }; }
        if (!out || out.pass !== true) {
          problems.push('required test failed: ' + t + (out && out.detail ? ' — ' + String(out.detail).slice(0, 200) : ''));
        }
      });
    }
  }
  return { name: 'tests', pass: problems.length === 0, problems: problems };
}

function policyValidator(task, result) {
  var problems = [];
  var used = (result && result.actions_used) || [];
  used.forEach(function (c) {
    if ((task.policy_classes || []).indexOf(c) === -1) {
      problems.push('result used action class ' + String(c).slice(0, 30) + ' that was never granted');
    }
  });
  return { name: 'policy', pass: problems.length === 0, problems: problems };
}

var VALIDATORS = [schemaValidator, completenessValidator, securityValidator,
  gitValidator, testsValidator, policyValidator];

// Runs every validator; any failure rejects.
function validate(task, result, opts) {
  var checks = VALIDATORS.map(function (v) { return v(task, result, opts || {}); });
  var rejections = [];
  checks.forEach(function (c) {
    c.problems.forEach(function (p) { rejections.push(c.name + ': ' + p); });
  });
  return { pass: rejections.length === 0, rejections: rejections, checks: checks };
}

// --- Adversarial review ---------------------------------------------------------

// Selects a reviewer that is NOT the author and runs the review function
// (injectable; production wires an advisory provider). The reviewer's
// brief is destructive by contract: find what is wrong.
function adversarialReview(task, result, opts) {
  opts = opts || {};
  var author = task.agent_id || opts.author_agent || null;
  var candidates = agents.selectCandidates({
    capabilities: ['review'],
    exclude: author ? [author] : []
  }, { include_unavailable: false });
  if (!candidates.length) {
    return { performed: false, verdict: 'no_reviewer_available', findings: [],
      reviewer: null, author: author };
  }
  var reviewer = candidates[0].name;
  if (reviewer === author) {
    // Structurally impossible via exclude, but assert the invariant anyway.
    return { performed: false, verdict: 'reviewer_equals_author_refused', findings: [], reviewer: null, author: author };
  }
  var reviewFn = opts.review_fn;
  if (typeof reviewFn !== 'function') {
    return { performed: false, verdict: 'no_review_function', findings: [], reviewer: reviewer, author: author };
  }
  var outcome;
  try {
    outcome = reviewFn(reviewer, task, result) || {};
  } catch (e) {
    outcome = { verdict: 'reject', findings: ['review crashed: ' + e.message] };
  }
  var verdict = outcome.verdict === 'pass' ? 'pass' : 'reject';
  store.appendEventLine({
    event_type: verdict === 'pass' ? 'REVIEW_PASSED' : 'REVIEW_REJECTED',
    subject_id: task.id, project: task.project,
    detail: { reviewer: reviewer, author: author, findings: (outcome.findings || []).slice(0, 20) }
  });
  return { performed: true, verdict: verdict, findings: outcome.findings || [],
    reviewer: reviewer, author: author };
}

// --- Settlement / repair loop ------------------------------------------------------

// Task must be in VALIDATING. Pass → COMPLETED. Reject → RETRYING while
// attempts remain (findings recorded for the repairing agent), else FAILED.
function validateAndSettle(taskId, result, opts) {
  opts = opts || {};
  var task = store.load('task', taskId);
  if (!task) throw new Error('NO_SUCH_TASK: ' + taskId);
  if (task.status !== 'VALIDATING') {
    throw new Error('NOT_VALIDATING: task ' + taskId + ' is ' + task.status);
  }

  var verdict = validate(task, result, opts);
  var review = { performed: false, verdict: 'skipped', findings: [] };
  if (verdict.pass && opts.review !== false) {
    review = adversarialReview(task, result, opts);
    if (review.performed && review.verdict === 'reject') {
      verdict.pass = false;
      review.findings.forEach(function (f) { verdict.rejections.push('review: ' + f); });
    }
  }

  if (verdict.pass) {
    store.appendEventLine({
      event_type: 'VALIDATION_PASSED', subject_id: taskId, project: task.project,
      detail: { checks: verdict.checks.length, reviewer: review.reviewer || null }
    });
    return store.transition('task', taskId, 'COMPLETED', { result: result });
  }

  store.appendEventLine({
    event_type: 'VALIDATION_FAILED', subject_id: taskId, project: task.project,
    detail: { rejections: verdict.rejections.slice(0, 20) }
  });
  var attemptsLeft = (task.attempt || 0) < (task.max_attempts === undefined ? 3 : task.max_attempts);
  if (attemptsLeft) {
    return store.transition('task', taskId, 'RETRYING', {
      metadata: Object.assign({}, task.metadata, {
        validation_rejections: verdict.rejections,
        repair_hint: 'Fix every rejection listed; the previous result was not accepted.'
      })
    });
  }
  return store.transition('task', taskId, 'FAILED', {
    metadata: Object.assign({}, task.metadata, { validation_rejections: verdict.rejections })
  });
}

module.exports = {
  validate: validate,
  adversarialReview: adversarialReview,
  validateAndSettle: validateAndSettle,
  VALIDATORS: VALIDATORS
};
