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
var dag = require('./dag');
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

// Agents sometimes fill a "commit" field with a placeholder string —
// "null", "none", "N/A" — instead of omitting it. That is an ABSENT
// commit, not an invented one; treating it as a fabricated hash failed
// analysis tasks that never produce commits at all (observed live: an
// AF research task blocked a campaign on `commit: "null"`).
var PLACEHOLDER_COMMIT = /^(null|none|n\/a|na|undefined|nil|-|tbd|pending)$/i;
var SHA_SHAPE = /^[0-9a-f]{7,40}$/i;

function normalizeCommitClaim(raw) {
  if (raw === undefined || raw === null) return { present: false, value: null, malformed: false };
  var v = String(raw).trim();
  if (!v || PLACEHOLDER_COMMIT.test(v)) return { present: false, value: null, malformed: false };
  if (!SHA_SHAPE.test(v)) return { present: true, value: v, malformed: true };
  return { present: true, value: v, malformed: false };
}

function commitRequired(task) {
  return task.task_type === 'coding' ||
    (task.metadata && task.metadata.commit_required === true);
}

function gitValidator(task, result, opts) {
  var problems = [];
  var repo = (opts && opts.worktree_dir) || (opts && opts.repo_path) || null;
  var claim = normalizeCommitClaim(result && result.commit);
  if (claim.malformed) {
    // A garbled hash is only a failure where a commit was actually due.
    if (commitRequired(task)) {
      problems.push('commit claim is not a valid hash: ' + String(claim.value).slice(0, 40));
    }
    return { name: 'git', pass: problems.length === 0, problems: problems };
  }
  if (!claim.present) {
    if (commitRequired(task)) {
      problems.push('this task must produce a commit but the result claims none');
    }
    return { name: 'git', pass: problems.length === 0, problems: problems };
  }
  if (result && result.commit) {
    if (!repo || !gitlib.isRepo(repo)) {
      problems.push('result claims commit ' + String(result.commit).slice(0, 12) + ' but no repository is in scope');
    } else if (!gitlib.commitExists(repo, result.commit)) {
      problems.push('claimed commit does not exist: ' + String(result.commit).slice(0, 12));
    }
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

// --- Review policy --------------------------------------------------------------
//
// This system has TWO legitimate review mechanisms, and the policy below
// exists to make them add up instead of leaving a hole between them:
//
//   1. the DAG review task — a real task with task_type 'review', put into
//      every plan by core/planner.js, core/campaign.js and
//      core/self-improve.js, routed to a reviewer agent like any other task;
//   2. the in-process reviewer — adversarialReview() below, driven by the
//      injectable review_fn.
//
// What was missing was never a reviewer: it was the REQUIREMENT. A task
// whose result must be reviewed settled COMPLETED anyway whenever no
// review_fn was wired, silently and with no record that review had been
// skipped. reviewRequirement() decides whether review is OWED, from data
// the task already carries; reviewAssured() decides whether mechanism (1)
// will supply it. Neither invents a reviewer, and neither fires for work
// that owes no review.

// Types that always owe a review: they change the repository. 'documentation'
// is deliberately NOT here — it owes a review only when it actually produces
// a commit, which the commit rules below catch.
var REVIEW_REQUIRING_TASK_TYPES = ['coding', 'integration'];

// Sensitive = the result can change the system, not merely describe it.
// Sensitivity does not decide WHETHER review is owed; it decides WHO may
// perform it (see reviewScopeOf).
var SENSITIVE_POLICY_CLASSES = ['PROJECT_WRITE', 'GIT', 'SERVICE', 'DEPLOY',
  'ROOT', 'DESTRUCTIVE', 'MONEY_SPEND'];

function isSensitive(task, result) {
  var classes = (task && task.policy_classes) || [];
  return classes.some(function (c) { return SENSITIVE_POLICY_CLASSES.indexOf(c) !== -1; }) ||
    commitRequired(task || {}) ||
    normalizeCommitClaim(result && result.commit).present;
}

// Pure. Returns { required, sensitive, reason } — the reason is recorded, so
// "why did this need review?" and "why did it not?" are both answerable.
function reviewRequirement(task, result) {
  task = task || {};
  var sensitive = isSensitive(task, result);
  // Structural invariant, above any metadata: the adversarial review task is
  // never itself re-reviewed. Grading a reviewer's findings against an
  // implementation contract is a category error — observed live, where a
  // valid review was rejected for "tests pending" and burned the whole
  // repair budget (see core/campaign-runner.js).
  if (task.task_type === 'review') {
    return { required: false, sensitive: sensitive, reason: 'review_task_is_never_re_reviewed' };
  }
  var explicit = task.metadata ? task.metadata.review_required : undefined;
  if (explicit === true) {
    return { required: true, sensitive: sensitive, reason: 'required_by_task_metadata' };
  }
  if (explicit === false) {
    return { required: false, sensitive: sensitive, reason: 'waived_by_task_metadata' };
  }
  if (REVIEW_REQUIRING_TASK_TYPES.indexOf(task.task_type) !== -1) {
    return { required: true, sensitive: sensitive, reason: 'write_capable_task_type:' + task.task_type };
  }
  if (commitRequired(task)) {
    return { required: true, sensitive: sensitive, reason: 'task_must_produce_a_commit' };
  }
  if (normalizeCommitClaim(result && result.commit).present) {
    return { required: true, sensitive: sensitive, reason: 'result_claims_a_commit' };
  }
  return { required: false, sensitive: sensitive, reason: 'no_reviewable_change' };
}

// Is mechanism (1) going to review this task?
//
// The question is ASSURANCE, not completion, and the difference is a
// deadlock: the mission's review task DEPENDS on this task, so it cannot
// possibly have run by the time this task settles. Requiring a completed
// review here would freeze every plan the planner produces. What must be
// true is that a review task downstream of this one still exists and can
// still run — neither failed, nor cancelled, nor doomed by a failed
// ancestor. Reverse edges are read from depends_on; doom comes from the
// existing DAG analysis, not from a second opinion about it.
function reviewAssured(task) {
  var none = { assured: false, reviewer_task_id: null };
  if (!task || !task.mission_id) return none;
  var mission;
  try { mission = store.load('mission', task.mission_id); } catch (e) { return none; }
  if (!mission || !Array.isArray(mission.task_ids)) return none;
  var siblings = mission.task_ids.map(function (id) {
    try { return store.load('task', id); } catch (e) { return null; }
  }).filter(Boolean);

  var doomed = {};
  try {
    dag.doomedTasks(siblings).forEach(function (d) { doomed[d.id] = true; });
  } catch (e) { /* an unsound graph assures nothing — the filter below still applies */ }

  var downstream = {};
  var changed = true;
  while (changed) {
    changed = false;
    siblings.forEach(function (t) {
      if (downstream[t.id]) return;
      var follows = (t.depends_on || []).some(function (d) { return d === task.id || downstream[d]; });
      if (follows) { downstream[t.id] = true; changed = true; }
    });
  }

  var reviewer = siblings.filter(function (t) {
    return downstream[t.id] && t.task_type === 'review' &&
      ['FAILED', 'CANCELLED'].indexOf(t.status) === -1 && !doomed[t.id];
  })[0];
  return reviewer ? { assured: true, reviewer_task_id: reviewer.id } : none;
}

// An agent's review scope is a PRIVILEGE DECLARATION, so it fails closed:
// an agent that does not explicitly declare 'sensitive' reviews standard
// work only. This is what stops a small or free-tier model from becoming
// the reviewer of a commit-producing change merely because it happens to
// be the only reviewer available. Any review-capable agent may review
// standard work; nothing may review sensitive work by default.
var REVIEW_SCOPES = ['standard', 'sensitive'];

function reviewScopeOf(definition) {
  var raw = definition && definition.review_scope;
  if (!Array.isArray(raw)) return ['standard'];
  var clean = raw.filter(function (s) { return REVIEW_SCOPES.indexOf(s) !== -1; });
  return clean.length ? clean : ['standard'];
}

function reviewerEligible(candidate, sensitive) {
  if (!sensitive) return true;
  return reviewScopeOf(candidate && candidate.definition).indexOf('sensitive') !== -1;
}

// --- Adversarial review ---------------------------------------------------------

// Selects a reviewer that is NOT the author and runs the review function
// (injectable; production wires an advisory provider). The reviewer's
// brief is destructive by contract: find what is wrong.
// opts.sensitive gates WHO is allowed to be that reviewer.
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
  var eligible = candidates.filter(function (c) { return reviewerEligible(c, opts.sensitive === true); });
  if (!eligible.length) {
    return { performed: false, verdict: 'reviewer_not_trusted_for_sensitive', findings: [],
      reviewer: null, author: author,
      refused_candidates: candidates.map(function (c) { return c.name; }).slice(0, 10) };
  }
  var reviewer = eligible[0].name;
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
  var requirement = reviewRequirement(task, result);
  var waived = opts.review === false;
  var review = { performed: false, verdict: waived ? 'waived_by_caller' : 'skipped', findings: [] };
  if (verdict.pass && !waived) {
    review = adversarialReview(task, result, Object.assign({}, opts, { sensitive: requirement.sensitive }));
    if (review.performed && review.verdict === 'reject') {
      verdict.pass = false;
      review.findings.forEach(function (f) { verdict.rejections.push('review: ' + f); });
    }
  }

  if (verdict.pass) {
    // FAIL CLOSED — but only where a review is actually owed. A task that
    // owes one settles COMPLETED on exactly three grounds: an in-process
    // reviewer passed it, a review task downstream in its own mission will
    // review it, or the caller explicitly waived review. Anything else is
    // unreviewed work, and unreviewed work parks instead of completing.
    // It is NOT a failure: the evidence was sound, the review was not had.
    var reviewed = review.performed && review.verdict === 'pass';
    var assurance = { assured: false, reviewer_task_id: null };
    if (requirement.required && !reviewed && !waived) {
      assurance = reviewAssured(task);
      if (!assurance.assured) {
        store.appendEventLine({
          event_type: 'REVIEW_REQUIRED', subject_id: taskId, project: task.project,
          detail: {
            reason: review.verdict, requirement: requirement.reason,
            sensitive: requirement.sensitive,
            refused_candidates: review.refused_candidates || []
          }
        });
        return store.transition('task', taskId, 'REVIEW_REQUIRED', {
          result: result,
          metadata: Object.assign({}, task.metadata, {
            review_block_reason: review.verdict,
            review_requirement: requirement.reason,
            review_sensitive: requirement.sensitive,
            review_refused_candidates: review.refused_candidates || []
          })
        });
      }
    }
    store.appendEventLine({
      event_type: 'VALIDATION_PASSED', subject_id: taskId, project: task.project,
      detail: {
        checks: verdict.checks.length, reviewer: review.reviewer || null,
        review_required: requirement.required,
        review_source: reviewed ? 'in_process_reviewer'
          : assurance.assured ? 'mission_review_task'
            : requirement.required ? 'waived_by_caller' : 'not_required'
      }
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

// The one way out of REVIEW_REQUIRED: a RECORDED review verdict. There is
// no timer, no daemon and no "assume pass" — a parked task stays parked
// until someone with a verdict says otherwise, which is the whole point.
// A rejection re-enters the existing repair loop with the findings
// attached, exactly like a rejection at validation time.
function resolveReview(taskId, decision) {
  decision = decision || {};
  var task = store.load('task', taskId);
  if (!task) throw new Error('NO_SUCH_TASK: ' + taskId);
  if (task.status !== 'REVIEW_REQUIRED') {
    throw new Error('NOT_REVIEW_REQUIRED: task ' + taskId + ' is ' + task.status);
  }
  var author = task.agent_id || null;
  var reviewer = decision.reviewer || null;
  // The author-is-not-the-reviewer invariant does not weaken just because
  // the verdict arrives late and by another route.
  if (reviewer && author && reviewer === author) {
    throw new Error('REVIEWER_EQUALS_AUTHOR: ' + String(reviewer).slice(0, 60));
  }
  // Fail closed on the verdict itself: only an explicit 'pass' passes.
  var pass = decision.verdict === 'pass';
  var findings = Array.isArray(decision.findings) ? decision.findings : [];
  var decidedBy = decision.decided_by || reviewer || 'owner';

  store.appendEventLine({
    event_type: pass ? 'REVIEW_PASSED' : 'REVIEW_REJECTED',
    subject_id: taskId, project: task.project,
    detail: { reviewer: reviewer, author: author, decided_by: decidedBy,
      findings: findings.slice(0, 20), resolved_from: 'REVIEW_REQUIRED' }
  });

  if (pass) {
    store.appendEventLine({
      event_type: 'VALIDATION_PASSED', subject_id: taskId, project: task.project,
      detail: { review_required: true, review_source: 'resolved_review', reviewer: reviewer }
    });
    return store.transition('task', taskId, 'COMPLETED', {
      metadata: Object.assign({}, task.metadata, {
        review_resolved_by: decidedBy, review_block_reason: null
      })
    });
  }

  var rejections = (findings.length ? findings : ['review rejected without findings'])
    .map(function (f) { return 'review: ' + f; });
  store.appendEventLine({
    event_type: 'VALIDATION_FAILED', subject_id: taskId, project: task.project,
    detail: { rejections: rejections.slice(0, 20) }
  });
  var attemptsLeft = (task.attempt || 0) < (task.max_attempts === undefined ? 3 : task.max_attempts);
  var carried = Object.assign({}, task.metadata, {
    validation_rejections: rejections,
    review_resolved_by: decidedBy,
    review_block_reason: null,
    repair_hint: 'Fix every rejection listed; the previous result was not accepted.'
  });
  if (attemptsLeft) return store.transition('task', taskId, 'RETRYING', { metadata: carried });
  return store.transition('task', taskId, 'FAILED', { metadata: carried });
}

module.exports = {
  validate: validate,
  adversarialReview: adversarialReview,
  validateAndSettle: validateAndSettle,
  reviewRequirement: reviewRequirement,
  reviewAssured: reviewAssured,
  reviewScopeOf: reviewScopeOf,
  reviewerEligible: reviewerEligible,
  resolveReview: resolveReview,
  REVIEW_REQUIRING_TASK_TYPES: REVIEW_REQUIRING_TASK_TYPES,
  SENSITIVE_POLICY_CLASSES: SENSITIVE_POLICY_CLASSES,
  VALIDATORS: VALIDATORS
};
