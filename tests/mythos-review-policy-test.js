'use strict';
// =====================================================
// MYTHOS — review policy tests (fail-closed independent review)
// tests/mythos-review-policy-test.js
//
// Covers the gap found in the FABLE completion audit: core/validation.js
// skipped the adversarial review whenever no review_fn was wired and
// settled the task COMPLETED anyway — silently. A result that must be
// reviewed and was not is now parked in REVIEW_REQUIRED with a traceable
// reason, and ONLY where review is actually owed: read-only work, and the
// review task itself, settle exactly as before.
//
// Deterministic and offline: no provider is contacted, no quota consumed.
// Agent availability is driven through the registry's injectable probes,
// Git evidence through a throwaway repository under the fixture root.
//
// Run with: node tests/mythos-review-policy-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIXTURES = path.join(os.homedir(), 'mythos-review-policy-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');

var domain = require(path.join(EXEC, 'core', 'domain'));
var store = require(path.join(EXEC, 'core', 'store'));
var validation = require(path.join(EXEC, 'core', 'validation'));
var agents = require(path.join(EXEC, 'core', 'agent-registry'));
var scheduler = require(path.join(EXEC, 'core', 'scheduler'));
var planner = require(path.join(EXEC, 'core', 'planner'));
var coreWiring = require(path.join(EXEC, 'core', 'core-wiring'));

var passed = 0;
var failed = 0;
var failures = [];

function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

function throws(fn, re, name) {
  try { fn(); ok(false, name + ' (did not throw)'); }
  catch (e) { ok(re.test(e.message), name + ' (threw: ' + e.message.slice(0, 90) + ')'); }
}

function cleanup() {
  try { fs.rmSync(FIXTURES, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

// --- Helpers ----------------------------------------------------------------

// Drives a task to VALIDATING through legal transitions only — never by
// writing the status directly, so the tests exercise the real state machine.
function driveToValidating(id) {
  store.transition('task', id, 'READY');
  store.transition('task', id, 'RUNNING', { attempt: 1 });
  store.transition('task', id, 'VALIDATING');
  return store.load('task', id);
}

function toValidating(task) {
  store.create(task);
  return driveToValidating(task.id);
}

function newTask(fields) {
  return domain.createTask(Object.assign({ title: 'work', project: 'core-test' }, fields));
}

// Availability is a PROBE, never a guess: every provider in the catalogue
// is answered explicitly so a test can say exactly which reviewers exist.
function availableAgents(names) {
  agents.resetForTests();
  var wanted = {};
  names.forEach(function (n) { wanted[n] = true; });
  ['claude-code', 'openai-compat', 'gemini', 'free-llm-pool'].forEach(function (provider) {
    agents.registerProbe(provider, function (def) { return !!wanted[def.name]; });
  });
}

function eventsWith(type, subjectId) {
  var file = path.join(store.root(), 'events.log');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(function (l) {
    try { return JSON.parse(l); } catch (e) { return null; }
  }).filter(function (e) {
    return e && e.event_type === type && (!subjectId || e.subject_id === subjectId);
  });
}

// ===========================================================================
// A — reviewRequirement: WHO owes a review (pure, no store)
// ===========================================================================
(function () {
  var coding = newTask({ task_type: 'coding' });
  ok(validation.reviewRequirement(coding, { status: 'completed' }).required === true,
    'A requirement: a coding task owes a review');

  var integration = newTask({ task_type: 'integration' });
  ok(validation.reviewRequirement(integration, { status: 'completed' }).required === true,
    'A requirement: an integration task owes a review');

  var generic = newTask({ task_type: 'generic', metadata: { commit_required: true } });
  ok(validation.reviewRequirement(generic, { status: 'completed' }).required === true,
    'A requirement: any task that must produce a commit owes a review');

  var claimed = newTask({ task_type: 'generic' });
  ok(validation.reviewRequirement(claimed, { status: 'completed', commit: 'a'.repeat(40) }).required === true,
    'A requirement: a result that CLAIMS a commit owes a review, whatever the type');

  ['analysis', 'research', 'reporting', 'inspection', 'planning'].forEach(function (t) {
    var ro = newTask({ task_type: t });
    ok(validation.reviewRequirement(ro, { status: 'completed', summary: 'x' }).required === false,
      'A requirement: read-only ' + t + ' owes no review (existing behaviour preserved)');
  });

  var placeholder = newTask({ task_type: 'analysis' });
  ok(validation.reviewRequirement(placeholder, { status: 'completed', commit: 'none' }).required === false,
    'A requirement: a placeholder commit string is an ABSENT commit, not a reviewable change');

  var reviewTask = newTask({ task_type: 'review' });
  ok(validation.reviewRequirement(reviewTask, { status: 'completed' }).required === false,
    'A requirement: the adversarial review task is never itself re-reviewed');
  var forcedReview = newTask({ task_type: 'review', metadata: { review_required: true } });
  ok(validation.reviewRequirement(forcedReview, {}).required === false,
    'A requirement: not even metadata can make a review task re-reviewable (category error)');

  var forced = newTask({ task_type: 'analysis', metadata: { review_required: true } });
  var forcedOut = validation.reviewRequirement(forced, {});
  ok(forcedOut.required === true && forcedOut.reason === 'required_by_task_metadata',
    'A requirement: explicit review_required=true forces a review on read-only work');

  var waived = newTask({ task_type: 'coding', metadata: { review_required: false } });
  var waivedOut = validation.reviewRequirement(waived, {});
  ok(waivedOut.required === false && waivedOut.reason === 'waived_by_task_metadata',
    'A requirement: explicit review_required=false waives it, and the reason is recorded');

  ok(validation.reviewRequirement(newTask({ task_type: 'coding' }), {}).sensitive === true,
    'A requirement: a commit-producing task is SENSITIVE');
  ok(validation.reviewRequirement(newTask({ task_type: 'generic', policy_classes: ['DEPLOY'] }), {}).sensitive === true,
    'A requirement: a DEPLOY-class task is SENSITIVE');
  ok(validation.reviewRequirement(newTask({ task_type: 'analysis', policy_classes: ['READ'] }), {}).sensitive === false,
    'A requirement: read-only work is not sensitive');
})();

// ===========================================================================
// B — review_scope: WHO may review (privilege declaration, fails closed)
// ===========================================================================
(function () {
  ok(validation.reviewScopeOf({ review_scope: ['standard', 'sensitive'] }).indexOf('sensitive') !== -1,
    'B scope: a declared sensitive scope is honoured');
  ok(validation.reviewScopeOf({}).join() === 'standard',
    'B scope: an agent that declares nothing reviews standard work only');
  ok(validation.reviewScopeOf({ review_scope: 'sensitive' }).join() === 'standard',
    'B scope: a malformed (non-array) scope falls back to standard — fail closed');
  ok(validation.reviewScopeOf({ review_scope: ['root', 'everything'] }).join() === 'standard',
    'B scope: unknown scope values are discarded, never trusted');
  ok(validation.reviewScopeOf({ review_scope: [] }).join() === 'standard',
    'B scope: an empty scope is standard, not "anything"');

  var weak = { name: 'small-local', definition: { review_scope: ['standard'] } };
  var strong = { name: 'frontier', definition: { review_scope: ['standard', 'sensitive'] } };
  ok(validation.reviewerEligible(weak, false) === true,
    'B scope: a standard-scope reviewer may review standard work');
  ok(validation.reviewerEligible(weak, true) === false,
    'B scope: a standard-scope reviewer may NOT review sensitive work');
  ok(validation.reviewerEligible(strong, true) === true,
    'B scope: a sensitive-scope reviewer may review sensitive work');
  ok(validation.reviewerEligible({ name: 'undeclared', definition: {} }, true) === false,
    'B scope: an undeclared reviewer is refused sensitive work (unknown capability → fail closed)');

  var catalogue = JSON.parse(fs.readFileSync(path.join(EXEC, 'config', 'agents.json'), 'utf8'));
  ok(validation.reviewScopeOf(catalogue['free-llm-pool']).indexOf('sensitive') === -1,
    'B scope: the free-tier pool is NOT trusted with sensitive review in the shipped catalogue');
  ok(validation.reviewScopeOf(catalogue['claude-code']).indexOf('sensitive') !== -1,
    'B scope: claude-code is trusted with sensitive review in the shipped catalogue');
})();

// ===========================================================================
// C — state machine: REVIEW_REQUIRED is reachable only from validation
// ===========================================================================
(function () {
  ok(domain.TASK_STATES.indexOf('REVIEW_REQUIRED') !== -1, 'C states: REVIEW_REQUIRED exists');
  ok(domain.taskTransitionAllowed('VALIDATING', 'REVIEW_REQUIRED'),
    'C states: validation may park a task for review');
  ok(domain.taskTransitionAllowed('REVIEW_REQUIRED', 'COMPLETED'),
    'C states: a passing verdict completes a parked task');
  ok(domain.taskTransitionAllowed('REVIEW_REQUIRED', 'RETRYING'),
    'C states: a rejecting verdict re-enters the repair loop');
  ok(domain.taskTransitionAllowed('REVIEW_REQUIRED', 'FAILED'),
    'C states: a parked task can still be failed');
  throws(function () { domain.taskTransitionAllowed('RUNNING', 'REVIEW_REQUIRED'); },
    /ILLEGAL_TRANSITION/, 'C states SECURITY: an agent cannot park ITSELF for review from RUNNING');
  throws(function () { domain.taskTransitionAllowed('REVIEW_REQUIRED', 'RUNNING'); },
    /ILLEGAL_TRANSITION/, 'C states SECURITY: a parked task cannot re-execute itself out of its own gate');
  throws(function () { domain.taskTransitionAllowed('REVIEW_REQUIRED', 'VALIDATING'); },
    /ILLEGAL_TRANSITION/, 'C states SECURITY: a parked task cannot re-enter validation to try again');
  ok(domain.TASK_STATE_COMPAT.toExecutor.REVIEW_REQUIRED === 'BLOCKED',
    'C states: the executor compat view reports it as BLOCKED, never COMPLETED');
})();

// ===========================================================================
// D — settlement: fail closed, but only where review is owed
// ===========================================================================

// D1 — read-only work still settles with no reviewer anywhere. This is the
// regression guard for "do not break tasks that never needed a review".
(function () {
  availableAgents([]);
  var t = toValidating(newTask({ task_type: 'analysis', policy_classes: ['READ'] }));
  var out = validation.validateAndSettle(t.id, { status: 'completed', summary: 'read-only finding' });
  ok(out.status === 'COMPLETED',
    'D1: read-only work completes with no reviewer available — unchanged behaviour');
})();

// D2 — work that owes a review does NOT complete without one.
(function () {
  availableAgents([]);
  var t = toValidating(newTask({ task_type: 'integration', policy_classes: ['READ', 'PROJECT_WRITE'] }));
  var out = validation.validateAndSettle(t.id, { status: 'completed', summary: 'merged the branches' });
  ok(out.status === 'REVIEW_REQUIRED',
    'D2 FAIL-CLOSED: unreviewed write work parks in REVIEW_REQUIRED, it does not complete');
  ok(out.status !== 'FAILED',
    'D2: it is NOT failed — the execution was sound, only the review is missing');
  ok(out.metadata.review_block_reason === 'no_reviewer_available',
    'D2: the blocking reason is recorded on the task');
  ok(out.result && out.result.summary === 'merged the branches',
    'D2: the result is preserved for the reviewer, not discarded');
  ok((out.attempt || 0) === 1, 'D2: parking does not consume a repair attempt');
  ok(eventsWith('REVIEW_REQUIRED', t.id).length === 1,
    'D2: a REVIEW_REQUIRED event is on the durable stream');
  ok(eventsWith('VALIDATION_PASSED', t.id).length === 0,
    'D2: validation is never recorded as passed when the review never happened');
})();

// D3 — a reviewer exists but no review function is wired: the real
// production case that made the audit finding.
(function () {
  availableAgents(['omniroute-advisory']);
  var t = toValidating(newTask({ task_type: 'integration', policy_classes: ['READ', 'PROJECT_WRITE'] }));
  var out = validation.validateAndSettle(t.id, { status: 'completed', summary: 'integrated' });
  ok(out.status === 'REVIEW_REQUIRED' && out.metadata.review_block_reason === 'no_review_function',
    'D3: a reviewer with no review function parks the task and says exactly why');
})();

// D4 — sensitive work is never handed to a reviewer that is not trusted
// with it, even when that reviewer is the only one available.
(function () {
  availableAgents(['free-llm-pool']);
  var t = toValidating(newTask({ task_type: 'integration', policy_classes: ['READ', 'GIT'] }));
  var reviewed = { called: 0 };
  var out = validation.validateAndSettle(t.id, { status: 'completed', summary: 'touched the repo' }, {
    review_fn: function () { reviewed.called += 1; return { verdict: 'pass', findings: [] }; }
  });
  ok(out.status === 'REVIEW_REQUIRED' &&
    out.metadata.review_block_reason === 'reviewer_not_trusted_for_sensitive',
    'D4 SECURITY: a standard-scope reviewer is refused sensitive work, with the reason recorded');
  ok(reviewed.called === 0,
    'D4 SECURITY: the untrusted reviewer is never even asked');
  ok((out.metadata.review_refused_candidates || []).indexOf('free-llm-pool') !== -1,
    'D4: the refused candidate is named, so the block is diagnosable');
})();

// D5 — the same reviewer IS accepted for standard (non-sensitive) work.
(function () {
  availableAgents(['free-llm-pool']);
  var t = toValidating(newTask({
    task_type: 'analysis', policy_classes: ['READ'], metadata: { review_required: true }
  }));
  var seen = { reviewer: null };
  var out = validation.validateAndSettle(t.id, { status: 'completed', summary: 'analysed' }, {
    review_fn: function (reviewer) { seen.reviewer = reviewer; return { verdict: 'pass', findings: [] }; }
  });
  ok(out.status === 'COMPLETED' && seen.reviewer === 'free-llm-pool',
    'D5: a standard-scope reviewer reviews standard work and the task completes');
})();

// D6 — Claude is a FALLBACK, not a dependency.
(function () {
  availableAgents(['omniroute-advisory', 'claude-code']);
  var seen = { reviewer: null };
  var t1 = toValidating(newTask({ task_type: 'integration', policy_classes: ['READ', 'GIT'] }));
  validation.validateAndSettle(t1.id, { status: 'completed', summary: 'x' }, {
    review_fn: function (reviewer) { seen.reviewer = reviewer; return { verdict: 'pass', findings: [] }; }
  });
  ok(seen.reviewer === 'omniroute-advisory',
    'D6: with a cheaper reviewer available, Claude is NOT selected — no Claude dependency');

  availableAgents(['claude-code']);
  var seen2 = { reviewer: null };
  var t2 = toValidating(newTask({ task_type: 'integration', policy_classes: ['READ', 'GIT'] }));
  var out2 = validation.validateAndSettle(t2.id, { status: 'completed', summary: 'x' }, {
    review_fn: function (reviewer) { seen2.reviewer = reviewer; return { verdict: 'pass', findings: [] }; }
  });
  ok(seen2.reviewer === 'claude-code' && out2.status === 'COMPLETED',
    'D6: with nothing else available, Claude IS the fallback reviewer');
})();

// D7 — the author never reviews their own work.
(function () {
  availableAgents(['claude-code']);
  var t = toValidating(newTask({
    task_type: 'integration', policy_classes: ['READ', 'GIT'], agent_id: 'claude-code'
  }));
  var out = validation.validateAndSettle(t.id, { status: 'completed', summary: 'self-graded' }, {
    review_fn: function () { return { verdict: 'pass', findings: [] }; }
  });
  ok(out.status === 'REVIEW_REQUIRED' && out.metadata.review_block_reason === 'no_reviewer_available',
    'D7 SECURITY: the only reviewer being the author leaves the task unreviewed, never self-approved');
})();

// D8 — an in-process rejection still goes to repair, not to the new state.
(function () {
  availableAgents(['omniroute-advisory']);
  var t = toValidating(newTask({ task_type: 'integration', policy_classes: ['READ'] }));
  var out = validation.validateAndSettle(t.id, { status: 'completed', summary: 'x' }, {
    review_fn: function () { return { verdict: 'reject', findings: ['edge case: empty input crashes'] }; }
  });
  ok(out.status === 'RETRYING' &&
    out.metadata.validation_rejections.join(' ').indexOf('empty input crashes') !== -1,
    'D8: a rejected review still repairs through the existing loop, unchanged');
})();

// D9 — an explicit caller waiver completes, but is recorded.
(function () {
  availableAgents([]);
  var t = toValidating(newTask({ task_type: 'integration', policy_classes: ['READ'] }));
  var out = validation.validateAndSettle(t.id, { status: 'completed', summary: 'x' }, { review: false });
  ok(out.status === 'COMPLETED', 'D9 compat: review:false still completes (the existing escape hatch)');
  var ev = eventsWith('VALIDATION_PASSED', t.id);
  ok(ev.length === 1 && ev[0].detail.review_source === 'waived_by_caller',
    'D9: the waiver is written to the event stream — allowed, never silent');
})();

// D10 — a coding task with REAL git evidence: validation passes on the
// commit and the task still parks for the review it never had.
(function () {
  var repo = path.join(FIXTURES, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  var git = function (args) {
    return cp.execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'Review Policy Test']);
  fs.writeFileSync(path.join(repo, 'file.txt'), 'content\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'real commit']);
  var sha = git(['rev-parse', 'HEAD']).trim();

  availableAgents([]);
  var t = toValidating(newTask({ task_type: 'coding', policy_classes: ['READ', 'GIT'] }));
  var out = validation.validateAndSettle(t.id,
    { status: 'completed', summary: 'implemented', commit: sha },
    { worktree_dir: repo });
  ok(out.status === 'REVIEW_REQUIRED',
    'D10: a coding task with a verified real commit still does not complete unreviewed');
  ok(out.metadata.review_requirement === 'write_capable_task_type:coding',
    'D10: the requirement reason names why the review was owed');
})();

// ===========================================================================
// E — assurance: the mission's own review task satisfies the requirement
// (and the check must not deadlock the DAG it depends on)
// ===========================================================================

function missionWithReview(opts) {
  opts = opts || {};
  var goal = domain.createGoal({ text: 'assurance goal', project: 'core-test' });
  store.create(goal);
  var mission = domain.createMission({
    goal_id: goal.id, title: 'assurance mission', project: 'core-test',
    correlation_id: goal.correlation_id, parent_id: goal.id
  });
  store.create(mission);
  var impl = newTask({ task_type: 'integration', mission_id: mission.id, policy_classes: ['READ'] });
  store.create(impl);
  var test = newTask({ title: 'test', task_type: 'testing', mission_id: mission.id, depends_on: [impl.id] });
  store.create(test);
  var ids = [impl.id, test.id];
  if (opts.withReview !== false) {
    var rev = domain.createTask({
      title: 'Adversarial review', task_type: 'review', project: 'core-test',
      mission_id: mission.id, depends_on: [test.id]
    });
    store.create(rev);
    if (opts.reviewStatus) {
      store.transition('task', rev.id, 'CANCELLED');   // only terminal-bad state reachable directly
    }
    ids.push(rev.id);
    opts.review_id = rev.id;
  }
  mission.task_ids = ids;
  store.save(mission);
  opts.impl = impl;
  return opts;
}

(function () {
  availableAgents([]);
  var built = missionWithReview({});
  var assurance = validation.reviewAssured(store.load('task', built.impl.id));
  ok(assurance.assured === true && assurance.reviewer_task_id === built.review_id,
    'E assurance: a downstream review task in the same mission assures the review');

  var t = driveToValidating(built.impl.id);
  var out = validation.validateAndSettle(t.id, { status: 'completed', summary: 'integrated' });
  ok(out.status === 'COMPLETED',
    'E NO DEADLOCK: the implementing task completes so the review task it feeds can run');
  var ev = eventsWith('VALIDATION_PASSED', t.id);
  ok(ev.length === 1 && ev[0].detail.review_source === 'mission_review_task',
    'E assurance: the event records WHICH mechanism supplied the review');
})();

(function () {
  availableAgents([]);
  var built = missionWithReview({ reviewStatus: 'CANCELLED' });
  ok(validation.reviewAssured(store.load('task', built.impl.id)).assured === false,
    'E assurance: a CANCELLED review task assures nothing');
  var t = driveToValidating(built.impl.id);
  ok(validation.validateAndSettle(t.id, { status: 'completed', summary: 'x' }).status === 'REVIEW_REQUIRED',
    'E assurance: with the review task gone, the write task parks');
})();

(function () {
  availableAgents([]);
  var built = missionWithReview({ withReview: false });
  ok(validation.reviewAssured(store.load('task', built.impl.id)).assured === false,
    'E assurance: a mission with no review task assures nothing');
  var orphan = newTask({ task_type: 'integration' });
  ok(validation.reviewAssured(orphan).assured === false,
    'E assurance: a task with no mission assures nothing — fail closed, not "assume fine"');
})();

// ===========================================================================
// F — resolveReview: the one way out of REVIEW_REQUIRED
// ===========================================================================
(function () {
  availableAgents([]);
  var t = toValidating(newTask({ task_type: 'integration', policy_classes: ['READ'] }));
  validation.validateAndSettle(t.id, { status: 'completed', summary: 'x' });

  var out = validation.resolveReview(t.id, { verdict: 'pass', reviewer: 'othman', decided_by: 'othman' });
  ok(out.status === 'COMPLETED', 'F resolve: a passing verdict completes the parked task');
  ok(out.metadata.review_resolved_by === 'othman' && out.metadata.review_block_reason === null,
    'F resolve: who decided is recorded and the block is cleared');
  ok(eventsWith('REVIEW_PASSED', t.id).length === 1, 'F resolve: REVIEW_PASSED is on the event stream');
  throws(function () { validation.resolveReview(t.id, { verdict: 'pass' }); },
    /NOT_REVIEW_REQUIRED/, 'F resolve: a settled task cannot be resolved again');
})();

(function () {
  availableAgents([]);
  var t = toValidating(newTask({ task_type: 'integration', policy_classes: ['READ'] }));
  validation.validateAndSettle(t.id, { status: 'completed', summary: 'x' });
  var out = validation.resolveReview(t.id, {
    verdict: 'reject', reviewer: 'othman',
    findings: ['the new branch is never merged back', 'no test covers the failure path']
  });
  ok(out.status === 'RETRYING', 'F resolve: a rejecting verdict re-enters the repair loop');
  ok(out.metadata.validation_rejections.length === 2 &&
    out.metadata.validation_rejections[0].indexOf('review: ') === 0,
    'F resolve: the findings travel to the repairing agent, prefixed as review rejections');
  ok(/Fix every rejection/.test(out.metadata.repair_hint),
    'F resolve: the existing repair hint is reused, not reinvented');
})();

(function () {
  availableAgents([]);
  var t = toValidating(newTask({ task_type: 'integration', policy_classes: ['READ'], max_attempts: 0 }));
  validation.validateAndSettle(t.id, { status: 'completed', summary: 'x' });
  ok(validation.resolveReview(t.id, { verdict: 'reject', findings: ['broken'] }).status === 'FAILED',
    'F resolve: with no attempts left a rejection fails the task');
})();

(function () {
  availableAgents([]);
  var t = toValidating(newTask({ task_type: 'integration', policy_classes: ['READ'], agent_id: 'implementer-1' }));
  validation.validateAndSettle(t.id, { status: 'completed', summary: 'x' });
  throws(function () { validation.resolveReview(t.id, { verdict: 'pass', reviewer: 'implementer-1' }); },
    /REVIEWER_EQUALS_AUTHOR/, 'F resolve SECURITY: the author cannot sign off their own parked task');
  ok(validation.resolveReview(t.id, {}).status === 'RETRYING',
    'F resolve SECURITY: a verdict that is not an explicit pass is a rejection — fail closed');
})();

(function () {
  var running = newTask({ task_type: 'integration' });
  store.create(running);
  store.transition('task', running.id, 'READY');
  throws(function () { validation.resolveReview(running.id, { verdict: 'pass' }); },
    /NOT_REVIEW_REQUIRED/, 'F resolve: a task that never parked cannot be resolved into COMPLETED');
})();

// ===========================================================================
// G — scheduler: the mission WAITS, and the work never runs twice
// ===========================================================================

function buildMission(goalText, specTasks, project) {
  var goal = domain.createGoal({ text: goalText, project: project || 'core-test' });
  store.create(goal);
  var plan = planner.planFromSpec(goal, { title: goalText, tasks: specTasks });
  if (!plan.valid) throw new Error('test mission invalid: ' + plan.errors.join('; '));
  var persisted = planner.persistPlan(plan);
  store.transition('mission', persisted.mission.id, 'VALIDATED');
  return persisted;
}

var chain = Promise.resolve();

chain = chain.then(function () {
  availableAgents([]);
  var m = buildMission('unreviewable change', [
    { key: 'implement', title: 'Implement', task_type: 'integration', depends_on: [] }
  ]);
  var runs = { count: 0 };
  var runner = function () {
    runs.count += 1;
    return Promise.resolve({ status: 'VALIDATING', result: { status: 'completed', summary: 'done' } });
  };
  var validator = function (task) { return validation.validateAndSettle(task.id, task.result, {}); };
  return scheduler.runMission(m.mission.id, { runner: runner, validator: validator })
    .then(function (mission) {
      var task = store.load('task', m.tasks[0].id);
      ok(task.status === 'REVIEW_REQUIRED', 'G scheduler: the task parks for review');
      ok(mission.status === 'WAITING',
        'G scheduler: the mission WAITS — it does not fail because a reviewer was missing');
      ok(!mission.metadata.stalled,
        'G scheduler: it is an explicit wait, not the defensive stall branch');
      ok((mission.metadata.waiting_review || []).indexOf(task.id) !== -1,
        'G scheduler: the parked task is named on the mission');
      // Re-running must not re-execute work that is waiting on a decision.
      return scheduler.runMission(m.mission.id, { runner: runner, validator: validator })
        .then(function (again) {
          ok(runs.count === 1,
            'G scheduler NO DUPLICATE EXECUTION: a parked task is never dispatched again');
          ok(again.status === 'WAITING', 'G scheduler: it keeps waiting across runs');
          // …and the recorded verdict releases it through the normal loop.
          validation.resolveReview(task.id, { verdict: 'pass', reviewer: 'othman' });
          ok(store.load('task', task.id).status === 'COMPLETED',
            'G scheduler: an owner verdict releases the parked task');
          return scheduler.runMission(m.mission.id, { runner: runner, validator: validator });
        });
    }).then(function (finished) {
      ok(finished.status === 'COMPLETED' && runs.count === 1,
        'G scheduler: the mission finishes with the work executed exactly once');
    });
});

// Budget: the hold is settled ONCE, when the work actually ran — parking
// for review and resolving it later must never settle it a second time.
// Ledger and policy are injected exactly as tests/mythos-budget-ledger-test
// does it: no real money, no shipped limit touched.
chain = chain.then(function () {
  var budget = require(path.join(EXEC, 'core', 'budget'));
  var policyEngine = require(path.join(EXEC, 'core', 'policy-engine'));
  var CFG = JSON.parse(fs.readFileSync(path.join(EXEC, 'config', 'budgets.json'), 'utf8'));
  CFG.projects['review-budget'] = { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 10 };
  var withCfg = function (fn) { return function (req) { return fn(Object.assign({ config: CFG }, req)); }; };
  var ledgerShim = {
    check: withCfg(budget.check), reserve: withCfg(budget.reserve),
    settle: withCfg(budget.settle), release: withCfg(budget.release),
    reserveScoped: withCfg(budget.reserveScoped), settleScoped: withCfg(budget.settleScoped),
    releaseScoped: withCfg(budget.releaseScoped), reservationIdFor: budget.reservationIdFor
  };
  var engine = policyEngine.createEngine({
    policy_id: 'review-budget-v1',
    classes: { READ: 'allow', PROJECT_WRITE: 'allow', GIT: 'allow', SERVICE: 'require_approval',
      DEPLOY: 'require_approval', ROOT: 'deny', EXTERNAL_API: 'allow', DESTRUCTIVE: 'deny' },
    money_spend: { enabled: true, daily_limit_usd: 10 }
  }, { ledger: ledgerShim });

  availableAgents([]);
  var m = buildMission('paid change that cannot be reviewed', [
    { key: 'implement', title: 'Implement', task_type: 'integration',
      policy_classes: ['EXTERNAL_API', 'MONEY_SPEND'], budget_usd: 2, depends_on: [] }
  ], 'review-budget');
  var validator = function (task) { return validation.validateAndSettle(task.id, task.result, {}); };
  var runner = function () {
    return Promise.resolve({ status: 'VALIDATING',
      result: { status: 'completed', summary: 'done', actual_cost_usd: 2 } });
  };
  return scheduler.runMission(m.mission.id, { runner: runner, validator: validator, policy: engine })
    .then(function () {
      var task = store.load('task', m.tasks[0].id);
      ok(task.status === 'REVIEW_REQUIRED', 'G budget: the paid task parks for review');
      ok(task.metadata.budget_settlement && task.metadata.budget_settlement.settled === true,
        'G budget: the reservation was settled when the work actually ran');
      var spentBefore = budget.status('review-budget', { config: CFG }).spent;
      var settledBefore = eventsWith('BUDGET_SETTLED').length;
      validation.resolveReview(task.id, { verdict: 'pass', reviewer: 'othman' });
      ok(store.load('task', task.id).status === 'COMPLETED', 'G budget: the verdict completes it');
      ok(eventsWith('BUDGET_SETTLED').length === settledBefore,
        'G budget NO DOUBLE SETTLEMENT: resolving a review settles nothing further');
      ok(budget.status('review-budget', { config: CFG }).spent === spentBefore,
        'G budget: the ledger total is unchanged by the review verdict');
    });
});

// ===========================================================================
// H — E2E through the PRODUCTION orchestrator wiring
// (orchestrator.advanceMission → scheduler → validation), mock agent
// runner, no quota consumed, no production endpoint added.
// ===========================================================================
var orchestrator = require(path.join(EXEC, 'core', 'orchestrator'));

function submitWorkMission(project) {
  return orchestrator.submitGoal('E2E review gate for ' + project, {
    project: project,
    spec: {
      title: 'E2E mission',
      tasks: [{ key: 'implement', title: 'Implement', task_type: 'integration',
        capabilities_required: ['coding'], policy_classes: ['READ', 'PROJECT_WRITE'], depends_on: [] }]
    }
  });
}

// H1 — the only review-capable agent is the AUTHOR: the mission waits.
chain = chain.then(function () {
  availableAgents(['claude-code']);
  var s = submitWorkMission('e2e-park');
  var runs = { n: 0 };
  return orchestrator.advanceMission(s.mission.id, {
    agent_runner: function (agentName, task) {
      runs.n += 1;
      return Promise.resolve({ status: 'completed', summary: task.title + ' done' });
    },
    review_fn: function () { return { verdict: 'pass', findings: [] }; }
  }).then(function (mission) {
    var t = store.load('task', s.tasks[0].id);
    ok(mission.status === 'WAITING' && t.status === 'REVIEW_REQUIRED',
      'H1 E2E: production wiring parks unreviewed work instead of completing it');
    ok(t.metadata.review_block_reason === 'no_reviewer_available',
      'H1 E2E: the author cannot be their own reviewer, and the reason says so');
    ok(t.result && t.result.summary === 'Implement done', 'H1 E2E: the evidence is kept for the reviewer');

    validation.resolveReview(t.id, { verdict: 'pass', reviewer: 'othman', decided_by: 'othman' });
    return orchestrator.advanceMission(s.mission.id, {
      agent_runner: function () { runs.n += 1; return Promise.resolve({ status: 'completed' }); },
      review_fn: function () { return { verdict: 'pass', findings: [] }; }
    }).then(function (mission2) {
      ok(mission2.status === 'COMPLETED' && runs.n === 1,
        'H1 E2E: an owner verdict finishes the mission with the work executed exactly ONCE');
    });
  });
});

// H2 — with an independent reviewer available the review REALLY runs, once.
chain = chain.then(function () {
  availableAgents(['claude-code', 'omniroute-advisory']);
  var s = submitWorkMission('e2e-reviewed');
  var seen = { reviewer: null, calls: 0 };
  return orchestrator.advanceMission(s.mission.id, {
    agent_runner: function (agentName, task) {
      return Promise.resolve({ status: 'completed', summary: task.title + ' done' });
    },
    review_fn: function (reviewer) {
      seen.reviewer = reviewer; seen.calls += 1;
      return { verdict: 'pass', findings: [] };
    }
  }).then(function (mission) {
    var t = store.load('task', s.tasks[0].id);
    ok(mission.status === 'COMPLETED' && t.status === 'COMPLETED',
      'H2 E2E: with an independent reviewer the mission completes');
    ok(seen.calls === 1, 'H2 E2E: review_fn was invoked EXACTLY ONCE (before this policy it was never called)');
    ok(seen.reviewer === 'omniroute-advisory' && t.agent_id !== seen.reviewer,
      'H2 E2E: the reviewer is a real agent and is not the author');
  });
});

// H3 — a rejecting reviewer repairs through the existing loop, not the gate.
chain = chain.then(function () {
  availableAgents(['claude-code', 'omniroute-advisory']);
  var s = submitWorkMission('e2e-repair');
  var attempts = { n: 0 };
  return orchestrator.advanceMission(s.mission.id, {
    agent_runner: function (agentName, task) {
      attempts.n += 1;
      return Promise.resolve({ status: 'completed', summary: task.title + ' attempt ' + attempts.n });
    },
    review_fn: function () {
      return attempts.n < 2
        ? { verdict: 'reject', findings: ['the failure path is untested'] }
        : { verdict: 'pass', findings: [] };
    }
  }).then(function (mission) {
    var t = store.load('task', s.tasks[0].id);
    ok(mission.status === 'COMPLETED' && t.status === 'COMPLETED' && attempts.n === 2,
      'H3 E2E: a rejected review repairs once and then completes — the repair loop is unchanged');
  });
});

// ===========================================================================
// I — provenance: the review requirement cannot be injected from outside
// ===========================================================================
chain = chain.then(function () {
  var bad = coreWiring.validateGoalPayload({
    text: 'do something useful in the repository', metadata: { review_required: false }
  });
  ok(bad.valid === false && bad.errors.join(' ').indexOf('unexpected field: metadata') !== -1,
    'I SECURITY: POST /goals cannot carry metadata at all, so review_required cannot be injected');

  var goal = domain.createGoal({ text: 'injection attempt', project: 'core-test' });
  store.create(goal);
  var plan = planner.planFromSpec(goal, {
    title: 'injection attempt',
    tasks: [{ key: 'implement', title: 'Implement', task_type: 'coding', depends_on: [],
      metadata: { review_required: false } }]
  });
  ok(plan.valid === false && plan.errors.join(' ').indexOf('SPEC_UNKNOWN_FIELD') !== -1,
    'I SECURITY: a generated plan cannot set task metadata either — the waiver has no path in from data');
});

// ===========================================================================
chain.then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.error('failures:\n  - ' + failures.join('\n  - ')); }
  cleanup();
  process.exit(failed ? 1 : 0);
}).catch(function (err) {
  console.error('SUITE ERROR: ' + (err && err.stack || err));
  cleanup();
  process.exit(1);
});
