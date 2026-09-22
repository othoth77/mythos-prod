'use strict';
// =====================================================
// MYTHOS HADDAD — multi-project task isolation
// tests/mythos-haddad-multi-project-test.js
//
// One worker, several projects. What must hold:
//
//   * a task that owes an INDEPENDENT REVIEW does not reach COMPLETED on
//     the bridge path, because COMPLETED is what releases its dependents —
//     and the policy that decides which tasks owe one is core/validation.js,
//     reused through bridge/review-gate.js, not restated here;
//   * a task stopped for a person holds NOTHING: no worker, no executor
//     slot, and no other project;
//   * a rerun keeps its own single-use id but continues the attempt before
//     it — the previous report travels into the prompt so successful work
//     is verified, not repeated — and carries the owner's approval forward;
//   * with the gate switched off (the VPS default) every one of these
//     paths behaves exactly as it did before.
//
// Offline and deterministic, on the same fixture shape as
// tests/mythos-github-bridge-test.js: a throwaway origin, a control
// worktree, a planner clone and the executor's mock provider. No network,
// no GPU, no real quota. Fixtures never live under /tmp.
//
// Run with: node tests/mythos-haddad-multi-project-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIX = path.join(os.homedir(), 'mythos-multi-project-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true });

process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIX, 'no-advisory-credential.env');
process.env.MYTHOS_RESOURCE_GUARD = 'off';
process.env.MYTHOS_BRIDGE_PROJECT = 'executor-selftest';
process.env.MYTHOS_BRIDGE_REPO = path.join(FIX, 'repo');
process.env.MYTHOS_BRIDGE_CONTROL_DIR = path.join(FIX, 'control');
process.env.MYTHOS_BRIDGE_TASK_WORKTREES = path.join(FIX, 'wt');
process.env.MYTHOS_BRIDGE_HOME = path.join(FIX, 'home', 'bridge');
process.env.MYTHOS_BRIDGE_PROVIDER = 'mock';
process.env.MYTHOS_BRIDGE_USER = os.userInfo().username;
process.env.OTHMODE_STORE_ROOT = path.join(FIX, 'othstore');
fs.mkdirSync(process.env.OTHMODE_STORE_ROOT, { recursive: true, mode: 0o700 });
delete process.env.MYTHOS_MOCK_SCRIPT;
delete process.env.MYTHOS_BRIDGE_REVIEW_GATE;

var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var bridge = require(path.join(EXEC, 'bridge', 'github-bridge'));
var reviewGate = require(path.join(EXEC, 'bridge', 'review-gate'));
var issues = require(path.join(EXEC, 'bridge', 'github-issues'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }
function cleanup() { try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function git(cwd, args) {
  return cp.execFileSync('git', args, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' }) }).trim();
}

function gateOn(on) {
  if (on) process.env.MYTHOS_BRIDGE_REVIEW_GATE = '1';
  else delete process.env.MYTHOS_BRIDGE_REVIEW_GATE;
}

// ===========================================================================
// A — the gate is an ADAPTER: every verdict comes from core/validation.js
// ===========================================================================

function bridgeTask(fields) {
  return Object.assign({
    task_id: 't-sample-one', project: 'executor-selftest', requested_action: 'investigate',
    execution: { execution_profile: 'repo-read', provider: 'mock' }
  }, fields || {});
}
var EMPTY_REPORT = { summary: 'done', files_changed: [], commits: [], tests: [], problems: [] };

(function () {
  gateOn(false);
  var off = reviewGate.evaluate(bridgeTask({ requested_action: 'implement' }), EMPTY_REPORT);
  ok(off.required === false && off.gate === 'off',
    'A gate: OFF by default — a commit-producing task is untouched, exactly as on the VPS today');

  gateOn(true);
  var read = reviewGate.evaluate(bridgeTask({ requested_action: 'investigate' }), EMPTY_REPORT);
  ok(read.required === false,
    'A gate: a read-only investigate owes no review (the policy decides, not the gate)');

  ['implement', 'document'].forEach(function (action) {
    var w = reviewGate.evaluate(bridgeTask({
      task_id: 't-write-one', requested_action: action,
      execution: { execution_profile: 'repo-write', provider: 'mock' }
    }), EMPTY_REPORT);
    ok(w.required === true && w.satisfied === false,
      'A gate: ' + action + ' delivers a commit, so it owes a review');
    ok(w.sensitive === true, 'A gate: ' + action + ' is sensitive (it can change the repository)');
  });

  var claimed = reviewGate.evaluate(bridgeTask({}),
    Object.assign({}, EMPTY_REPORT, { commits: [{ sha: 'a'.repeat(40) }] }));
  ok(claimed.required === true,
    'A gate: a report that CLAIMS a commit owes a review whatever the action said');

  var asked = reviewGate.evaluate(bridgeTask({ review_required: true }), EMPTY_REPORT);
  ok(asked.required === true && asked.reason === 'required_by_task_metadata',
    'A gate: a task may ASK for a review the policy would not demand');

  var cannotWaive = reviewGate.evaluate(bridgeTask({
    review_required: false, requested_action: 'implement',
    execution: { execution_profile: 'repo-write', provider: 'mock' }
  }), EMPTY_REPORT);
  ok(cannotWaive.required === true,
    'A gate SECURITY: review_required=false cannot waive a review the policy requires — escalation only');

  var approved = reviewGate.evaluate(bridgeTask({
    requested_action: 'implement', execution: { execution_profile: 'repo-write', provider: 'mock' },
    continues: { task_id: 't-write-one', status: 'BLOCKED', reason: 'review_required' }
  }), EMPTY_REPORT);
  ok(approved.required === true && approved.satisfied === true && approved.approved_by === 't-write-one',
    'A gate: continuing a review-stopped attempt carries the owner approval, and names it');

  var otherReason = reviewGate.evaluate(bridgeTask({
    requested_action: 'implement', execution: { execution_profile: 'repo-write', provider: 'mock' },
    continues: { task_id: 't-write-one', status: 'FAILED', reason: 'failed' }
  }), EMPTY_REPORT);
  ok(otherReason.satisfied === false,
    'A gate SECURITY: continuing a FAILED attempt is not an approval — only a review stop is');

  // Fail closed: if the policy cannot be loaded, nothing is waved through.
  var Module = require('module');
  var realLoad = Module._load;
  Module._load = function (req) {
    if (String(req).indexOf('core/validation') !== -1) throw new Error('policy module missing');
    return realLoad.apply(this, arguments);
  };
  delete require.cache[require.resolve(path.join(EXEC, 'core', 'validation'))];
  var broken = reviewGate.evaluate(bridgeTask({ requested_action: 'implement' }), EMPTY_REPORT);
  Module._load = realLoad;
  ok(broken.required === true && broken.satisfied === false && /review_policy_unavailable/.test(broken.reason),
    'A gate SECURITY: an unloadable policy fails CLOSED, it never completes the task');
  gateOn(false);
})();

// ===========================================================================
// B — the Issue grammar: asking for review, and continuing an attempt
// ===========================================================================
(function () {
  var cfg = issues.config();
  function convert(body, attempt, previous) {
    return issues.issueToTask(cfg, {
      number: 7, title: 'TASK: sample', body: body, user: { login: 'othman' }, labels: [],
      html_url: 'https://github.com/othoth77/mythos-prod/issues/7'
    }, attempt || 1, previous || null);
  }

  var plain = convert('## Objective\nDo something useful here.\n\nAction: investigate');
  ok(plain.task && plain.task.review_required === undefined,
    'B grammar: nothing is asked for by default — the policy alone decides');

  ['Review: required', 'Review: yes', 'مراجعة مطلوبة: نعم'].forEach(function (line) {
    var asked = convert('## Objective\nDo something useful here.\n\nAction: investigate\n' + line);
    ok(asked.task && asked.task.review_required === true,
      'B grammar: "' + line + '" asks for an independent review');
  });

  ['Review: no', 'Review: none', 'Review: skip'].forEach(function (line) {
    var waived = convert('## Objective\nDo something useful here.\n\nAction: investigate\n' + line);
    ok(waived.task && waived.task.review_required !== false,
      'B grammar SECURITY: "' + line + '" cannot waive anything — no spelling lowers the bar');
  });

  var rerun = convert('## Objective\nDo something useful here.\n\nAction: investigate', 2, {
    task_id: 'gh-issue-7', status: 'BLOCKED', execution: { review_gate: { required: true, reason: 'write_capable_task_type:coding' } }
  });
  ok(rerun.task && rerun.task.continues && rerun.task.continues.task_id === 'gh-issue-7',
    'B grammar: a rerun records the attempt it continues');
  ok(rerun.task.continues.reason === 'review_required',
    'B grammar: continuing a review stop is recorded as such, so the approval can travel');
  ok(rerun.task.task_id !== 'gh-issue-7',
    'B grammar: the rerun still gets its OWN single-use id — nothing is resurrected');

  var afterFail = convert('## Objective\nDo something useful here.\n\nAction: investigate', 2, {
    task_id: 'gh-issue-7', status: 'FAILED', execution: {}
  });
  ok(afterFail.task.continues.reason === 'failed',
    'B grammar: continuing a failure is continuity only, never an approval');
})();

// ===========================================================================
// C — the whole thing, through the REAL bridge and executor:
//     four projects, one worker, one of them stopped for a person
// ===========================================================================

var ORIGIN = path.join(FIX, 'origin.git');
var REPO = path.join(FIX, 'repo');
var PLANNER = path.join(FIX, 'planner');
git(FIX, ['init', '--bare', '-q', '-b', 'main', ORIGIN]);
git(FIX, ['clone', '-q', ORIGIN, REPO]);
fs.writeFileSync(path.join(REPO, 'README.md'), '# fixture\n');
git(REPO, ['add', 'README.md']);
git(REPO, ['commit', '-q', '-m', 'init']);
git(REPO, ['push', '-q', 'origin', 'main']);
git(FIX, ['clone', '-q', ORIGIN, PLANNER]);

var cfg = bridge.config();
bridge.init();
function relay() {
  git(REPO, ['push', '-q', 'origin', 'refs/heads/mythos/control:refs/heads/mythos/control']);
}
relay();

function plannerWrite(name, content) {
  git(PLANNER, ['fetch', '-q', 'origin', 'mythos/control']);
  var has = cp.spawnSync('git', ['rev-parse', '--verify', '-q', 'mythos/control'], { cwd: PLANNER }).status === 0;
  git(PLANNER, has ? ['checkout', '-q', 'mythos/control'] : ['checkout', '-q', '-b', 'mythos/control', 'origin/mythos/control']);
  if (has) git(PLANNER, ['reset', '-q', '--hard', 'origin/mythos/control']);
  var f = path.join(PLANNER, 'control', 'tasks', name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(content, null, 2) + '\n');
  git(PLANNER, ['add', '--', 'control/tasks/' + name]);
  git(PLANNER, ['commit', '-q', '-m', 'planner: ' + name]);
  git(PLANNER, ['push', '-q', 'origin', 'mythos/control']);
}

function task(id, extra) {
  return Object.assign({
    protocol: 'mythos-control/1', task_id: id, project: 'executor-selftest',
    objective: 'Report one fact about the fixture repository for ' + id + '.',
    scope: ['read the repository'], constraints: ['read-only'],
    priority: 'normal', requested_action: 'investigate',
    validation_requirements: ['a fact is reported'], status: 'PENDING',
    created_at: new Date().toISOString(), created_by: 'multi-project-test'
  }, extra || {});
}

function controlTask(id) {
  var f = path.join(cfg.controlDir, 'control', 'tasks', id + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}
function controlReport(id) {
  var f = path.join(cfg.controlDir, 'control', 'reports', id + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}
function statusOf(id) { var t = controlTask(id); return t && t.status; }
function executorIdOf(id) { var t = controlTask(id); return t && t.execution && t.execution.executor_task_id; }

// One "turn of the crank": the bridge sees GitHub, the executor runs at
// most one task. Nothing here is a manual state edit.
function turn() {
  var r = bridge.tick(executor);
  return Promise.resolve(r && r.then ? r : null).then(function () {
    return executor.tick();
  }).then(function () {
    return bridge.tick(executor);
  });
}

function turns(n) {
  var p = Promise.resolve();
  for (var i = 0; i < n; i++) p = p.then(turn);
  return p;
}

gateOn(true);

// PROJECT A: a two-step chain. PROJECT B: one step that owes a review.
// PROJECT C and D: independent single steps.
plannerWrite('t-alpha-one.json', task('t-alpha-one'));
plannerWrite('t-alpha-two.json', task('t-alpha-two', { depends_on: ['t-alpha-one'] }));
plannerWrite('t-beta-one.json', task('t-beta-one', { review_required: true }));
plannerWrite('t-gamma-one.json', task('t-gamma-one'));
plannerWrite('t-delta-one.json', task('t-delta-one'));

turns(8).then(function () {
  // --- the project that owes a review stops, and stops ALONE ---------------
  ok(statusOf('t-beta-one') === 'BLOCKED',
    'C review: the task that owes a review does NOT reach COMPLETED');
  var betaTask = controlTask('t-beta-one');
  ok(betaTask.execution.review_gate && betaTask.execution.review_gate.required === true,
    'C review: the reason it stopped is recorded on the task');
  var betaReport = controlReport('t-beta-one');
  ok(betaReport && (betaReport.problems || []).join(' ').indexOf('independent review required') !== -1,
    'C review: the report says plainly WHY it stopped — unreviewed, not failed');
  ok(betaReport && String(betaReport.summary || '').length > 0,
    'C review: the worker’s own result is still reported, so the person can judge it');
  ok(betaReport && issues.issueStateOf(betaTask, betaReport) === 'HUMAN_APPROVAL',
    'C review: the Issue adapter classifies it as HUMAN APPROVAL, not as an infrastructure blocker');
  ok(betaReport && /rerun/.test(String(betaReport.next_recommended_action || '')),
    'C review: the report tells the person exactly what to do next');

  // --- every other project finished anyway ---------------------------------
  ok(statusOf('t-alpha-one') === 'COMPLETED', 'C isolation: project A step one completed');
  ok(statusOf('t-alpha-two') === 'COMPLETED', 'C isolation: project A step two completed after its dependency');
  ok(statusOf('t-gamma-one') === 'COMPLETED', 'C isolation: project C completed while project B waits');
  ok(statusOf('t-delta-one') === 'COMPLETED', 'C isolation: project D completed while project B waits');

  // --- the waiting task holds no worker ------------------------------------
  var all = executor.summaries();
  var running = all.filter(function (s) { return s.status === 'RUNNING'; });
  ok(running.length === 0, 'C resources: nothing is left RUNNING while a task waits for a person');
  var betaExec = executorIdOf('t-beta-one');
  var betaState = betaExec ? state.readStatus(betaExec) : null;
  ok(!betaState || ['COMPLETED', 'BLOCKED', 'FAILED'].indexOf(betaState.status) !== -1,
    'C resources: the stopped task holds no executor slot — its execution is over');

  // --- the dependent step never ran before its dependency ------------------
  var alphaTwo = controlTask('t-alpha-two');
  var alphaOne = controlTask('t-alpha-one');
  var depDone = (alphaOne.history || []).filter(function (h) { return h.to === 'COMPLETED'; })[0];
  var depClaim = (alphaTwo.history || []).filter(function (h) { return h.to === 'CLAIMED'; })[0];
  ok(depDone && depClaim && Date.parse(depClaim.at) >= Date.parse(depDone.at),
    'C dependency: the dependent step was claimed only after its dependency completed');

  // --- HUMAN INTERVENTION: the owner approves by asking for a rerun --------
  // This is the one deliberate human step; nothing else is touched.
  plannerWrite('t-beta-two.json', task('t-beta-two', {
    review_required: true,
    continues: { task_id: 't-beta-one', status: 'BLOCKED', reason: 'review_required' }
  }));
  return turns(4);
}).then(function () {
  ok(statusOf('t-beta-two') === 'COMPLETED',
    'C resume: after the owner approves, the continuation completes instead of stopping again');
  var t = controlTask('t-beta-two');
  ok(t.execution.review_gate && t.execution.review_gate.satisfied === true &&
     t.execution.review_gate.approved_by === 't-beta-one',
    'C resume: the approval is recorded and names the attempt it came from');

  // --- and it was told what already succeeded, rather than starting over ---
  var eid = executorIdOf('t-beta-two');
  var prompt = eid ? state.readText(eid, 'prompt.md') : null;
  ok(prompt && /## Continuation — this task continues t-beta-one/.test(prompt),
    'C resume: the continuation prompt names the attempt it continues');
  ok(prompt && /Do NOT start from zero/.test(prompt),
    'C resume: the worker is told not to repeat completed work');
  ok(prompt && /What the previous attempt reported/.test(prompt) &&
     prompt.indexOf(String(controlReport('t-beta-one').summary).slice(0, 40)) !== -1,
    'C resume: the previous attempt’s own report travels into the prompt');
  ok(prompt && /VERIFY the above against the worktree/.test(prompt),
    'C resume: and it must be verified, not trusted — a report is a claim, not evidence');

  // --- with the gate off, the same task would simply have completed --------
  gateOn(false);
  var wouldComplete = reviewGate.evaluate(controlTask('t-beta-one'), controlReport('t-beta-one'));
  ok(wouldComplete.required === false,
    'C compatibility: with the gate off the identical task is not held back (VPS default unchanged)');
}).then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) console.error('failures:\n  - ' + failures.join('\n  - '));
  cleanup();
  process.exit(failed ? 1 : 0);
}).catch(function (err) {
  console.error('SUITE ERROR: ' + (err && err.stack || err));
  cleanup();
  process.exit(1);
});
