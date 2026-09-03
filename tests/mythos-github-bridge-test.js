'use strict';
// =====================================================
// MYTHOS — GitHub control bridge tests
// tests/mythos-github-bridge-test.js
//
// Offline and deterministic: a throwaway bare "origin", a main checkout, a
// control worktree, a "planner" clone standing in for ChatGPT, the executor
// with its mock provider (no real quota), and an isolated OTHMODE store.
// The relay is stood in for by explicit pushes from the test.
//
// Fixtures never live under /tmp (the task schema refuses it).
// Run with: node tests/mythos-github-bridge-test.js
// =====================================================
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIX = path.join(os.homedir(), 'mythos-github-bridge-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true });

process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIX, 'no-advisory-credential.env');
// gh-issue-101: this suite drives executor.tick() and expects bridge tasks
// to start; the Resource Guard is entitled to defer exactly those starts
// when the HOST is short of memory, which would make the suite depend on
// the machine's mood. Guard behaviour is covered deterministically in
// tests/resource-guard-test.js.
process.env.MYTHOS_RESOURCE_GUARD = 'off';
process.env.MYTHOS_BRIDGE_PROJECT = 'executor-selftest';
process.env.MYTHOS_BRIDGE_REPO = path.join(FIX, 'repo');
process.env.MYTHOS_BRIDGE_CONTROL_DIR = path.join(FIX, 'control');
process.env.MYTHOS_BRIDGE_TASK_WORKTREES = path.join(FIX, 'wt');
process.env.MYTHOS_BRIDGE_HOME = path.join(FIX, 'home', 'bridge');
process.env.MYTHOS_BRIDGE_PROVIDER = 'mock';
// F3: the suite is user-agnostic (it may run as deploy or as a CI user); the
// guard itself is exercised explicitly below by pointing it at another name.
process.env.MYTHOS_BRIDGE_USER = os.userInfo().username;
process.env.OTHMODE_STORE_ROOT = path.join(FIX, 'othstore');
fs.mkdirSync(process.env.OTHMODE_STORE_ROOT, { recursive: true, mode: 0o700 });
delete process.env.MYTHOS_MOCK_SCRIPT;

var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var bridge = require(path.join(EXEC, 'bridge', 'github-bridge'));
var othTasks = require(path.join(BASE, 'projects', 'command-center', 'reference', 'othmode', 'tasks.js'));
var mockProvider = require(path.join(EXEC, 'providers', 'mock'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }

function git(cwd, args) {
  return cp.execFileSync('git', args, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' }) }).trim();
}
function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }

// --- fixture repositories ------------------------------------------------------------
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

// --- bootstrap the control channel ---------------------------------------------------------
var cfg = bridge.config();
var init = bridge.init();
ok(fs.existsSync(path.join(cfg.controlDir, 'control', 'README.md')), 'init: README copied to control/');
ok(fs.existsSync(path.join(cfg.controlDir, 'control', 'schemas', 'task.schema.json')), 'init: task schema copied');
ok(init.commit.committed === true, 'init: bootstrap commit made');
ok(git(cfg.controlDir, ['rev-parse', '--abbrev-ref', 'HEAD']) === 'mythos/control', 'init: control worktree on mythos/control');
ok(git(cfg.controlDir, ['ls-tree', '--name-only', 'HEAD']).split('\n').join(',') === 'control', 'init: orphan branch carries ONLY control/');
var init2 = bridge.init();
ok(init2.commit.committed === false, 'init: idempotent (second run commits nothing)');

// Relay stand-in: deliver the control branch to origin.
function relay() {
  git(REPO, ['push', '-q', 'origin', 'refs/heads/mythos/control:refs/heads/mythos/control']);
  git(REPO, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/mythos/gh/']).split('\n').filter(Boolean).forEach(function (b) {
    git(REPO, ['push', '-q', 'origin', 'refs/heads/' + b + ':refs/heads/' + b]);
  });
}
relay();

// Planner stand-in (ChatGPT): writes a task on the control branch and pushes it.
function plannerWrite(name, content, msg) {
  git(PLANNER, ['fetch', '-q', 'origin', 'mythos/control']);
  var has = cp.spawnSync('git', ['rev-parse', '--verify', '-q', 'mythos/control'], { cwd: PLANNER }).status === 0;
  git(PLANNER, has ? ['checkout', '-q', 'mythos/control'] : ['checkout', '-q', '-b', 'mythos/control', 'origin/mythos/control']);
  if (has) git(PLANNER, ['reset', '-q', '--hard', 'origin/mythos/control']);
  var f = path.join(PLANNER, 'control', 'tasks', name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  git(PLANNER, ['add', '--', 'control/tasks/' + name]);
  git(PLANNER, ['commit', '-q', '-m', msg || ('planner: ' + name)]);
  git(PLANNER, ['push', '-q', 'origin', 'mythos/control']);
}
function plannerRead(name) {
  git(PLANNER, ['fetch', '-q', 'origin', 'mythos/control']);
  git(PLANNER, ['checkout', '-q', 'mythos/control']);
  git(PLANNER, ['reset', '-q', '--hard', 'origin/mythos/control']);
  var f = path.join(PLANNER, 'control', name);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}
function mkTask(id, over) {
  var t = {
    protocol: 'mythos-control/1', task_id: id, project: 'executor-selftest',
    objective: 'Inspect the fixture repository and report its HEAD commit.',
    scope: ['README.md'], constraints: ['read-only'], priority: 'normal', requested_action: 'investigate',
    validation_requirements: ['git rev-parse HEAD'], status: 'PENDING',
    created_at: '2026-09-02T18:00:00.000Z', created_by: 'chatgpt-test'
  };
  Object.keys(over || {}).forEach(function (k) { t[k] = over[k]; });
  return t;
}
function taskOnDisk(id) { return readJson(path.join(cfg.controlDir, 'control', 'tasks', id + '.json')); }
function reportOnDisk(id) { var f = path.join(cfg.controlDir, 'control', 'reports', id + '.json'); return fs.existsSync(f) ? readJson(f) : null; }
function executorTasksFor(id) {
  return state.listTasks().filter(function (tid) { var t = state.readJSON(tid, 'task.json'); return t && t.stage === 'github:' + id; });
}
function actionsOf(r, kind) { return (r.actions || []).filter(function (a) { return a.action === kind; }); }

// --- validation unit checks --------------------------------------------------------------
ok(bridge.validateTask(cfg, mkTask('gh-unit-0001'), 'gh-unit-0001.json').length === 0, 'validate: well-formed task passes');
ok(bridge.validateTask(cfg, mkTask('gh-unit-0001'), 'other.json').some(function (e) { return /file name/.test(e); }), 'validate: file name must equal task_id');
ok(bridge.validateTask(cfg, mkTask('my-secret-task'), 'my-secret-task.json').some(function (e) { return /task_id/.test(e); }), 'validate: governance word in id refused');
ok(bridge.validateTask(cfg, mkTask('gh-unit-0002', { requested_action: 'deploy' }), 'gh-unit-0002.json').some(function (e) { return /requested_action|enum/.test(e); }), 'validate: deploy is not a requested_action');
ok(bridge.validateTask(cfg, mkTask('gh-unit-0003', { status: 'COMPLETED' }), 'gh-unit-0003.json').some(function (e) { return /cannot be set by the creator/.test(e); }), 'validate: creator cannot forge a terminal status');
ok(bridge.validateTask(cfg, mkTask('gh-unit-0004', { execution: { executor_task_id: 'x' } }), 'gh-unit-0004.json').some(function (e) { return /bridge-owned/.test(e); }), 'validate: creator cannot write execution block');
ok(bridge.validateTask(cfg, mkTask('gh-unit-0005', { project: 'mythos-prod' }), 'gh-unit-0005.json').some(function (e) { return /not served/.test(e); }), 'validate: foreign project refused');
ok(bridge.validateTask(cfg, mkTask('gh-unit-0006', { notes: 'token ghp_abcdefghijklmnopqrstuvwxyz123456' }), 'gh-unit-0006.json').some(function (e) { return /secret shape/.test(e); }), 'validate: secret shape refused');
ok(bridge.validateTask(cfg, mkTask('gh-unit-0007', { working_directory: '/x' }), 'gh-unit-0007.json').some(function (e) { return /additional|not allowed|unknown/i.test(e); }), 'validate: unknown field (working_directory) refused');
ok(bridge.validateTask(cfg, mkTask('gh-unit-0008', { depends_on: ['gh-unit-0008'] }), 'gh-unit-0008.json').some(function (e) { return /depend on itself/.test(e); }), 'validate: self-dependency refused');
var instr = bridge.buildInstruction(cfg, mkTask('gh-unit-0009'), { othmode_task_id: 'OTH-2026-00001', worktree: '/w', branch: 'mythos/gh/gh-unit-0009', base_commit: 'abc' });
ok(/^othmode /.test(instr), 'instruction: opens with the standalone othmode keyword');
ok(instr.indexOf('OTH-2026-00001') !== -1 && instr.indexOf('Never run `git push`') !== -1, 'instruction: names the OTHMODE record and forbids push');
ok(/MUST NOT set a terminal `status`/.test(instr) && /bridge is the only component that closes/.test(instr), 'instruction (F2): session may not close the OTHMODE record');

// --- F3: user guard --------------------------------------------------------------------
(function () {
  var saved = process.env.MYTHOS_BRIDGE_USER;
  process.env.MYTHOS_BRIDGE_USER = 'someone-else';
  var r = bridge.tick(executor);
  ok(r.ok === false && /BRIDGE_WRONG_USER/.test(r.reason) && /someone-else/.test(r.reason), 'user guard (F3): tick refuses to run as the wrong user with a clear error');
  var threw = false;
  try { bridge.init(); } catch (e) { threw = /BRIDGE_WRONG_USER/.test(e.message); }
  ok(threw, 'user guard (F3): init refuses as the wrong user');
  process.env.MYTHOS_BRIDGE_USER = saved;
  ok(bridge.userGuard() === saved, 'user guard (F3): passes for the executor user');
})();

// --- 1. task → claim ------------------------------------------------------------------
plannerWrite('gh-test-0001.json', mkTask('gh-test-0001'));
var r1 = bridge.tick(executor);
ok(r1.ok === true, 'tick1: ok');
ok(actionsOf(r1, 'sync')[0].result.action === 'fast-forwarded', 'tick1: control branch fast-forwarded from origin');
ok(actionsOf(r1, 'claim').length === 1 && actionsOf(r1, 'claim')[0].recovered === false, 'tick1: one fresh claim');
var t1 = taskOnDisk('gh-test-0001');
ok(t1.status === 'CLAIMED', 'tick1: task file status CLAIMED');
ok(t1.history.length === 1 && t1.history[0].from === 'PENDING' && t1.history[0].to === 'CLAIMED', 'tick1: history records PENDING→CLAIMED');
var e1 = executorTasksFor('gh-test-0001');
ok(e1.length === 1 && e1[0] === t1.execution.executor_task_id, 'tick1: exactly one executor task, referenced by the claim');
var et1 = state.readJSON(e1[0], 'task.json');
ok(et1.execution_profile === 'repo-read' && et1.provider === 'mock' && et1.requested_by === 'github-bridge', 'tick1: investigate → repo-read profile, bridge-owned');
ok(et1.working_directory === path.join(FIX, 'wt', 'gh-test-0001') && et1.branch === 'mythos/gh/gh-test-0001', 'tick1: isolated worktree + mythos/gh branch');
ok(/^othmode /.test(et1.instruction) && et1.report_to_git === false, 'tick1: instruction is an OTHMODE activation; executor report stays out of main');
ok(git(et1.working_directory, ['rev-parse', '--abbrev-ref', 'HEAD']) === 'mythos/gh/gh-test-0001', 'tick1: worktree really is on the task branch');
ok(state.readStatus(e1[0]).status === 'QUEUED', 'tick1: executor task QUEUED (bridge never runs it)');
// F1: push guard on the task worktree — push impossible, fetch intact, shared checkout untouched.
ok(git(et1.working_directory, ['remote', 'get-url', '--push', 'origin']) === bridge.NO_PUSH_URL, 'push guard (F1): task worktree push url is the no-push target');
ok(git(et1.working_directory, ['remote', 'get-url', 'origin']) === ORIGIN, 'push guard (F1): task worktree fetch url is the real origin');
var pushTry = cp.spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/mythos/gh/should-never-land'], { cwd: et1.working_directory, encoding: 'utf8' });
ok(pushTry.status !== 0 && /no_push/.test(pushTry.stderr), 'push guard (F1): git push from the task worktree fails');
ok(cp.spawnSync('git', ['ls-remote', '--heads', ORIGIN, 'mythos/gh/should-never-land'], { encoding: 'utf8' }).stdout.trim() === '', 'push guard (F1): nothing landed on origin');
ok(cp.spawnSync('git', ['fetch', 'origin'], { cwd: et1.working_directory }).status === 0, 'push guard (F1): git fetch from the task worktree still works');
ok(git(REPO, ['remote', 'get-url', '--push', 'origin']) === ORIGIN, 'push guard (F1): the main checkout push url is unchanged');
ok(git(REPO, ['config', '--get', 'extensions.worktreeConfig']) === 'true', 'push guard (F1): extensions.worktreeConfig enabled once on the repository');
ok(git(cfg.controlDir, ['remote', 'get-url', '--push', 'origin']) === ORIGIN, 'push guard (F1): the control worktree is not guarded (the relay reads its ref; it never pushes itself)');
ok(typeof t1.execution.othmode_task_id === 'string' && /^OTH-/.test(t1.execution.othmode_task_id), 'tick1: OTHMODE Task record opened');
var oth1 = othTasks.getTask(t1.execution.othmode_task_id);
ok(oth1 && oth1.status === 'RUNNING' && oth1.source.indexOf('github-bridge') === 0, 'tick1: OTHMODE record RUNNING with github-bridge source');
ok(actionsOf(r1, 'commit')[0].result.committed === true, 'tick1: claim committed on the control branch');
var idx1 = readJson(path.join(cfg.controlDir, 'control', 'state.json'));
ok(idx1.active.indexOf('gh-test-0001') !== -1 && idx1.pending.length === 0, 'tick1: state.json lists the task as active');
var r1b = bridge.tick(executor);
ok(actionsOf(r1b, 'claim').length === 0 && actionsOf(r1b, 'commit').length === 0, 'tick1b: idempotent — nothing to claim, nothing to commit');
ok(executorTasksFor('gh-test-0001').length === 1, 'tick1b: still exactly one executor task');

// --- 2. crash between createTask and claim commit → recovered, not duplicated ----------------------
plannerWrite('gh-test-0002.json', mkTask('gh-test-0002', { requested_action: 'implement', objective: 'Add a smoke file and commit it on the task branch.' }));
// Simulate: the bridge had created the executor task, then died before committing the claim.
var crashed = executor.createTask({
  project: 'executor-selftest', stage: 'github:gh-test-0002', instruction: 'othmode simulated pre-crash task', priority: 'normal',
  requested_by: 'github-bridge', provider: 'mock', execution_profile: 'repo-write', working_directory: path.join(FIX, 'wt', 'gh-test-0002'),
  branch: 'mythos/gh/gh-test-0002', expected_delivery: 'commit', report_to_git: false
});
fs.rmSync(path.join(process.env.MYTHOS_BRIDGE_HOME, 'claims.json'), { force: true }); // cache lost too
var r2 = bridge.tick(executor);
ok(actionsOf(r2, 'sync')[0].result.action === 'rebased', 'tick2: local claim commit rebased onto the planner\'s new commit (no divergence left behind)');
var c2 = actionsOf(r2, 'claim');
ok(c2.length === 1 && c2[0].recovered === true && c2[0].executor_task_id === crashed.task_id, 'tick2: PENDING task with an existing executor record is RE-CLAIMED, not re-created');
ok(executorTasksFor('gh-test-0002').length === 1, 'tick2: no duplicate executor task after crash recovery');
ok(taskOnDisk('gh-test-0002').execution.execution_profile === 'repo-write', 'tick2: implement → repo-write');

// --- 3. execution by the executor (mock), then reports ----------------------------------------------
// The "agent" commits on the task branch for the implement task.
var wt2 = path.join(FIX, 'wt', 'gh-test-0002');
fs.writeFileSync(path.join(wt2, 'SMOKE.md'), 'smoke\n');
git(wt2, ['add', 'SMOKE.md']);
git(wt2, ['commit', '-q', '-m', 'smoke: add SMOKE.md']);
var agentCommit = git(wt2, ['rev-parse', 'HEAD']);
relay(); // relay delivers mythos/gh/* and mythos/control

process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'success', summary: 'mock run one' }, { kind: 'success', summary: 'mock run two' }]);
function runExecutorTicks(n) {
  var p = Promise.resolve();
  for (var i = 0; i < n; i++) p = p.then(function () { return executor.tick(); });
  return p;
}

runExecutorTicks(2).then(function () {
  ok(state.readStatus(e1[0]).status === 'COMPLETED' && state.readStatus(crashed.task_id).status === 'COMPLETED', 'executor: both bridge tasks COMPLETED by the daemon path');
  var r3 = bridge.tick(executor);
  ok(actionsOf(r3, 'finish').length === 2, 'tick3: both tasks finished');
  var rep1 = reportOnDisk('gh-test-0001');
  var rep2 = reportOnDisk('gh-test-0002');
  ok(rep1 && rep1.status === 'COMPLETED' && rep1.summary === 'mock run one', 'tick3: report 0001 carries the agent summary');
  ok(rep1.execution.executor_task_id === e1[0] && rep1.execution.othmode_task_id === t1.execution.othmode_task_id, 'tick3: report links executor + OTHMODE ids');
  ok(rep1.tests.length === 1 && rep1.tests[0] === 'mock: pass', 'tick3: tests copied from the structured report');
  ok(rep2 && rep2.commits.length === 1 && rep2.commits[0].sha === agentCommit && rep2.commits[0].on_origin === true, 'tick3: report 0002 lists the real commit, verified on origin');
  ok(rep2.files_changed.indexOf('SMOKE.md') !== -1, 'tick3: files_changed derived from git');
  ok(rep2.validation.report_problems.some(function (p) { return /expected a commit/.test(p); }), 'tick3: executor verifyGit problems surface in validation');
  ok(taskOnDisk('gh-test-0001').status === 'COMPLETED' && taskOnDisk('gh-test-0002').status === 'COMPLETED', 'tick3: task files terminal');
  var h = taskOnDisk('gh-test-0001').history.map(function (x) { return x.to; });
  ok(h.join('>') === 'CLAIMED>VALIDATING>COMPLETED', 'tick3: history CLAIMED>VALIDATING>COMPLETED');
  ok(fs.existsSync(path.join(cfg.controlDir, 'control', 'reports', 'gh-test-0001.md')), 'tick3: markdown twin written');
  var oth1b = othTasks.getTask(t1.execution.othmode_task_id);
  ok(oth1b.status === 'COMPLETED' && oth1b.terminal === true, 'tick3: OTHMODE record closed COMPLETED');
  var sec = Object.keys(oth1b.sections || {});
  ok(['outcome', 'git', 'changes', 'validation', 'evidence', 'problems', 'execution'].every(function (k) { return sec.indexOf(k) !== -1; }), 'F2: bridge closure carries outcome/git/changes/validation/evidence/problems/execution sections');
  ok(oth1b.sections.validation.tests[0] === 'mock: pass' && oth1b.sections.outcome.status === 'COMPLETED' && oth1b.sections.outcome.closed_by === 'github-bridge', 'F2: OTHMODE evidence matches the report and names the bridge as closer');
  ok(rep1.execution.othmode_closed_by_bridge === true && rep1.problems.length === 0, 'F2: report records the bridge as the closer');
  var idx3 = readJson(path.join(cfg.controlDir, 'control', 'state.json'));
  ok(idx3.awaiting_review.length === 2 && idx3.counts.COMPLETED === 2, 'tick3: state.json awaiting_review has both');
  var r3b = bridge.tick(executor);
  ok(actionsOf(r3b, 'finish').length === 0 && actionsOf(r3b, 'commit').length === 0, 'tick3b: terminal tasks are left alone (no re-report, no commit)');
  relay();
  ok(plannerRead('reports/gh-test-0001.json') !== null, 'planner: report readable from origin after relay');
  ok(JSON.parse(plannerRead('state.json')).awaiting_review.indexOf('gh-test-0002') !== -1, 'planner: state.json on origin lists reviewable task');

  // --- 4. invalid tasks never execute ----------------------------------------------------------------
  plannerWrite('gh-test-0003.json', mkTask('gh-test-0003', { requested_action: 'deploy' }));
  plannerWrite('gh-test-0004.json', mkTask('gh-test-0004', { status: 'COMPLETED' }));
  plannerWrite('gh-test-0005.json', mkTask('gh-test-0005', { notes: 'use ghp_abcdefghijklmnopqrstuvwxyz123456 please' }));
  plannerWrite('Bad Name.json', '{ not json');
  plannerWrite('gh-test-0006.json', mkTask('gh-test-0007'));
  var r4 = bridge.tick(executor);
  ok(actionsOf(r4, 'claim').length === 0, 'tick4: nothing claimed');
  ok(actionsOf(r4, 'reject_invalid').length === 4 && actionsOf(r4, 'reject_unparseable').length === 1, 'tick4: four invalid + one unparseable rejected');
  ok(reportOnDisk('gh-test-0003').status === 'FAILED' && reportOnDisk('gh-test-0003').problems.length > 0, 'tick4: FAILED report explains the deploy rejection');
  ok(taskOnDisk('gh-test-0004').status === 'FAILED', 'tick4: forged COMPLETED became FAILED');
  var saved5 = fs.readFileSync(path.join(cfg.controlDir, 'control', 'tasks', 'gh-test-0005.json'), 'utf8');
  ok(saved5.indexOf('ghp_abcdefghijklmnopqrstuvwxyz123456') === -1 && taskOnDisk('gh-test-0005').status === 'FAILED', 'tick4: secret-bearing task rewritten redacted and FAILED');
  ok(fs.existsSync(path.join(cfg.controlDir, 'control', 'reports', 'invalid-bad-name.json')), 'tick4: unparseable file gets a report under a safe name');
  ok(fs.existsSync(path.join(cfg.controlDir, 'control', 'reports', 'invalid-gh-test-0006.json')), 'tick4: file/id mismatch reported under a safe name');
  ok(executorTasksFor('gh-test-0003').length === 0 && executorTasksFor('gh-test-0004').length === 0 && executorTasksFor('gh-test-0005').length === 0, 'tick4: no executor task for any rejected file');
  var r4b = bridge.tick(executor);
  ok(actionsOf(r4b, 'reject_invalid').length === 0 && actionsOf(r4b, 'reject_unparseable').length === 0 && actionsOf(r4b, 'commit').length === 0, 'tick4b: rejections are recorded once (hash-keyed), no churn');

  // --- 5. dependency wait ------------------------------------------------------------------------
  plannerWrite('gh-test-0008.json', mkTask('gh-test-0008', { depends_on: ['gh-test-0999'] }));
  var r5 = bridge.tick(executor);
  ok(actionsOf(r5, 'wait_dependencies').length === 1 && executorTasksFor('gh-test-0008').length === 0, 'tick5: unmet dependency → not claimed');

  // --- 6. creator cancellation of a claimed task ---------------------------------------------------------
  plannerWrite('gh-test-0009.json', mkTask('gh-test-0009'));
  var r6 = bridge.tick(executor);
  ok(actionsOf(r6, 'claim').length === 1, 'tick6: claimed');
  relay();
  var claimed9 = JSON.parse(plannerRead('tasks/gh-test-0009.json'));
  claimed9.status = 'CANCELLED';
  plannerWrite('gh-test-0009.json', claimed9, 'planner: cancel gh-test-0009');
  var r6b = bridge.tick(executor);
  ok(actionsOf(r6b, 'cancel').length === 1 && actionsOf(r6b, 'cancel')[0].executor.cancelled === true, 'tick6b: executor task cancelled on creator request');
  ok(state.readStatus(claimed9.execution.executor_task_id).status === 'CANCELLED', 'tick6b: executor store shows CANCELLED');
  ok(reportOnDisk('gh-test-0009').status === 'CANCELLED', 'tick6b: CANCELLED report written');

  // --- 7. claim exists, executor record gone → BLOCKED, never re-run ------------------------------------------
  plannerWrite('gh-test-0010.json', mkTask('gh-test-0010'));
  var r7 = bridge.tick(executor);
  var eid10 = actionsOf(r7, 'claim')[0].executor_task_id;
  fs.rmSync(state.taskDir(eid10), { recursive: true, force: true });
  var r7b = bridge.tick(executor);
  ok(actionsOf(r7b, 'blocked_missing_executor').length === 1, 'tick7: missing executor record → BLOCKED');
  ok(taskOnDisk('gh-test-0010').status === 'BLOCKED' && /NOT re-executed/.test(reportOnDisk('gh-test-0010').summary), 'tick7: report says it was not re-executed');
  ok(executorTasksFor('gh-test-0010').length === 0, 'tick7: no new executor task was created');

  // --- 7b. F2: session closes the OTHMODE record early → detected, evidence on the REPORT ------------------
  plannerWrite('gh-test-0011.json', mkTask('gh-test-0011'));
  var r7c = bridge.tick(executor);
  var t11 = taskOnDisk('gh-test-0011');
  ok(actionsOf(r7c, 'claim').length === 1 && /^OTH-/.test(t11.execution.othmode_task_id), 'F2 premature: claimed with an OTHMODE record');
  othTasks.updateTask(t11.execution.othmode_task_id, { status: 'COMPLETED' }, 'operator:session'); // the session misbehaves
  mockProvider.reset();
  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'success', summary: 'mock run three' }]);
  return executor.tick().then(function () {
    var r7d = bridge.tick(executor);
    ok(actionsOf(r7d, 'finish').length === 1, 'F2 premature: task finished');
    var rep11 = reportOnDisk('gh-test-0011');
    ok(rep11.status === 'COMPLETED' && rep11.execution.othmode_closed_by_bridge === false, 'F2 premature: bridge did not (could not) close the record');
    ok(rep11.problems.some(function (p) { return /^othmode: .*closed COMPLETED by the executing session before the bridge verified/.test(p); }), 'F2 premature: early closure recorded as a problem on the REPORT');
    ok(/CLOSED PREMATURELY/.test(taskOnDisk('gh-test-0011').history.slice(-1)[0].note), 'F2 premature: task history says so');
    ok(othTasks.getTask(t11.execution.othmode_task_id).status === 'COMPLETED', 'F2 premature: append-only record untouched');
  });
}).then(function () {
  // --- 8. process lock -------------------------------------------------------------------------------
  fs.writeFileSync(path.join(process.env.MYTHOS_BRIDGE_HOME, 'bridge.lock'), String(process.ppid));
  var r8 = bridge.tick(executor);
  ok(r8.ok === false && /lock/.test(r8.reason), 'lock: a second live bridge process is refused');
  fs.unlinkSync(path.join(process.env.MYTHOS_BRIDGE_HOME, 'bridge.lock'));

  // --- 9. secrets never reach the control branch -------------------------------------------------------------
  // The planner's own commit (ChatGPT's side) carried the token; every TREE
  // the bridge committed afterwards must be clean (a `-p` diff would show the
  // redaction removing it, which is the opposite of a leak).
  var bridgeCommits = git(cfg.controlDir, ['log', '--format=%H', '--author=MYTHOS GitHub Bridge']).split('\n').filter(Boolean);
  var leakingTrees = bridgeCommits.filter(function (sha) {
    return cp.spawnSync('git', ['grep', '-q', 'ghp_abcdefghijklmnopqrstuvwxyz123456', sha, '--', 'control/'], { cwd: cfg.controlDir }).status === 0;
  });
  ok(bridgeCommits.length > 5 && leakingTrees.length === 0, 'redaction: no tree committed by the bridge contains the token (' + leakingTrees.length + ' leaking of ' + bridgeCommits.length + ')');

  // --- 10. control commits only ever touch control/ ---------------------------------------------------------
  var touched = git(cfg.controlDir, ['log', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
  ok(touched.every(function (f) { return f.indexOf('control/') === 0; }), 'scope: bridge commits touch only control/');
  var threw = false;
  try { bridge.commitControl(cfg, ['README.md'], 'x'); } catch (e) { threw = /CONTROL_COMMIT_SCOPE/.test(e.message); }
  ok(threw, 'scope: staging outside control/ is refused');
}).then(function () {
  // --- 11. Action → profile invariant at the bridge (gh-issue-111/114/117/118) ------------------------
  var engine = bridge.engine;
  ok(bridge.PROFILE_BY_ACTION === engine.PROFILE_BY_ACTION, 'invariant: the bridge re-exports the engine\'s map — one source of truth');
  // J — a planner task with implement lands on repo-write with the decision recorded.
  plannerWrite('gh-inv-0001.json', mkTask('gh-inv-0001', { requested_action: 'implement', action_source: 'explicit_current_issue', action_raw: 'IMPLEMENT', objective: 'Implement the invariant smoke change on the task branch.' }));
  var rJ = bridge.tick(executor);
  var tJ = taskOnDisk('gh-inv-0001');
  ok(actionsOf(rJ, 'claim').length === 1 && tJ.execution.execution_profile === 'repo-write' && tJ.execution.expected_profile === 'repo-write' && tJ.execution.action_source === 'explicit_current_issue' && tJ.execution.action_raw === 'IMPLEMENT' && tJ.execution.attempt_id === 'gh-inv-0001#1',
    'J: implement → repo-write, action_source/action_raw/attempt_id recorded on the claim');
  var eJ = state.readJSON(tJ.execution.executor_task_id, 'task.json');
  ok(eJ.execution_profile === 'repo-write' && eJ.task_category === 'implement' && eJ.action_source === 'explicit_current_issue' && eJ.attempt_id === 'gh-inv-0001#1' && /^[0-9a-f]{64}$/.test(eJ.snapshot_sha256) && /source explicit_current_issue, written "IMPLEMENT"/.test(eJ.instruction),
    'J: the executor task carries the same decision, a sealed snapshot, and the instruction states the source');
  ok(typeof tJ.execution.fence === 'number' && tJ.execution.lease && tJ.execution.lease.fence === tJ.execution.fence && Date.parse(tJ.execution.lease.expires_at) > Date.now() && /^[0-9a-f]{64}$/.test(tJ.execution.snapshot_sha256),
    'J: the claim carries a fence token, a lease and the attempt snapshot');
  ok(tJ.execution.runtime && typeof tJ.execution.runtime.verified === 'boolean' && tJ.execution.runtime.module.indexOf('github-bridge.js') !== -1, 'J: the claim records the runtime identity of the bridge that made it');

  // K — crash-recovery finds an executor record whose profile contradicts the action → BLOCKED, no run.
  plannerWrite('gh-inv-0002.json', mkTask('gh-inv-0002', { requested_action: 'implement', objective: 'Implement something but the recovered record says repo-read.' }));
  var wrong = executor.createTask({
    project: 'executor-selftest', stage: 'github:gh-inv-0002', instruction: 'othmode stale record with the wrong profile', priority: 'normal',
    requested_by: 'github-bridge', provider: 'mock', execution_profile: 'repo-read', working_directory: path.join(FIX, 'wt', 'gh-inv-0002'),
    branch: 'mythos/gh/gh-inv-0002', expected_delivery: 'report', report_to_git: false
  });
  var rK = bridge.tick(executor);
  var bK = actionsOf(rK, 'blocked_preflight')[0];
  ok(bK && bK.task_id === 'gh-inv-0002' && bK.code === 'ACTION_PROFILE_MISMATCH' && actionsOf(rK, 'claim').every(function (a) { return a.task_id !== 'gh-inv-0002'; }),
    'K: implement + a repo-read executor record → ACTION_PROFILE_MISMATCH, not claimed');
  var tK = taskOnDisk('gh-inv-0002');
  var repK = reportOnDisk('gh-inv-0002');
  ok(tK.status === 'BLOCKED' && tK.execution.blocker.code === 'ACTION_PROFILE_MISMATCH' && tK.execution.executor_task_id === null, 'K: task BLOCKED with the blocker on the execution block, no executor task bound');
  ok(repK && repK.status === 'BLOCKED' && repK.blocker.code === 'ACTION_PROFILE_MISMATCH' && repK.blocker.expected_profile === 'repo-write' && repK.blocker.actual_profile === 'repo-read' && repK.blocker.attempt_id === 'gh-inv-0002#1' && repK.blocker.retryable === false,
    'K: the report carries requested_action/expected/actual/attempt_id and retryable:false');
  ok(repK.structured_report && repK.structured_report.mythos_report === true && repK.structured_report.synthesized === true && repK.structured_report.status === 'blocked' && repK.resolution.requested_action === 'implement' && repK.resolution.expected_profile === 'repo-write',
    'K: a structured mythos_report exists although nothing executed');
  ok(state.readStatus(wrong.task_id).status === 'QUEUED' && executorTasksFor('gh-inv-0002').length === 1, 'K: the contradicting record was neither run nor duplicated');
  ok(/ACTION_PROFILE_MISMATCH/.test(fs.readFileSync(path.join(cfg.controlDir, 'control', 'reports', 'gh-inv-0002.md'), 'utf8')), 'K: the markdown report names the code');
  var rK2 = bridge.tick(executor);
  ok(actionsOf(rK2, 'blocked_preflight').length === 0 && actionsOf(rK2, 'claim').every(function (a) { return a.task_id !== 'gh-inv-0002'; }), 'K: a non-retryable blocker is not retried on the next tick');

  // M — MODEL_UNAVAILABLE at the bridge, before any executor task.
  var modelPolicy = require(path.join(EXEC, 'lib', 'model-policy'));
  var f51 = modelPolicy.DEFAULT_LOADED.policy.catalog['fable-5.1'];
  var savedEnabled = f51.enabled;
  plannerWrite('gh-inv-0003.json', mkTask('gh-inv-0003', { requested_action: 'implement', model: 'Fable 5.1', model_raw: 'Fable 5.1', model_source: 'explicit_current_issue', objective: 'Implement with an explicit model that this host cannot run.' }));
  f51.enabled = false;
  var rM = bridge.tick(executor);
  f51.enabled = savedEnabled;
  var bM = actionsOf(rM, 'blocked_preflight')[0];
  ok(bM && bM.task_id === 'gh-inv-0003' && bM.code === 'MODEL_UNAVAILABLE', 'M: an explicit unavailable model → MODEL_UNAVAILABLE at claim');
  var repM = reportOnDisk('gh-inv-0003');
  ok(repM && repM.blocker.code === 'MODEL_UNAVAILABLE' && repM.blocker.requested_model === 'Fable 5.1' && repM.blocker.model_id === 'claude-fable-5-1' && repM.blocker.actual_model === null && repM.blocker.available_models.indexOf('Fable 5.1') === -1 && /NOT replaced/.test(repM.blocker.reason),
    'M: requested_model / available_models / actual_model / reason are on the report');
  ok(executorTasksFor('gh-inv-0003').length === 0 && repM.resolution.model_requested === 'Fable 5.1' && repM.resolution.model_source === 'explicit_current_issue' && repM.execution.model === null,
    'M: no executor task, no substitute model, the request stays visible');

  // L — the same task runs once the model is available: explicit Fable 5.1 reaches the executor.
  plannerWrite('gh-inv-0004.json', mkTask('gh-inv-0004', { requested_action: 'implement', model: 'Fable 5.1', model_raw: 'Fable 5.1', model_source: 'explicit_current_issue', objective: 'Implement with an explicit Fable 5.1 while the host serves it.' }));
  var rL = bridge.tick(executor);
  var tL = taskOnDisk('gh-inv-0004');
  ok(actionsOf(rL, 'claim').some(function (a) { return a.task_id === 'gh-inv-0004' && a.model === 'claude-fable-5-1'; }) && tL.execution.model === 'claude-fable-5-1' && tL.execution.model_key === 'fable-5.1' && tL.execution.model_requested === 'Fable 5.1' && tL.execution.model_source === 'explicit_current_issue',
    'L: explicit Fable 5.1 → executor model claude-fable-5-1, requested/source recorded');
  ok(state.readJSON(tL.execution.executor_task_id, 'task.json').model === 'claude-fable-5-1', 'L: the executor record pins claude-fable-5-1');

  // Q — duplicate claim: claiming an already-claimed task again binds the same executor task.
  var entryQ = { task: JSON.parse(JSON.stringify(tL)), file: 'gh-inv-0004.json' };
  entryQ.task.status = 'PENDING';
  delete entryQ.task.execution; delete entryQ.task.history;
  var byId = {};
  var cQ = (function () { var lock = bridge.acquireLock(cfg); try { return require(path.join(EXEC, 'bridge', 'github-bridge')).tick === bridge.tick ? bridge.tick(executor) : null; } finally { bridge.releaseLock(lock); } })();
  ok(executorTasksFor('gh-inv-0004').length === 1 && cQ && actionsOf(cQ, 'claim').every(function (a) { return a.task_id !== 'gh-inv-0004'; }), 'Q: a second tick never claims an already-claimed task twice');
  fs.rmSync(path.join(process.env.MYTHOS_BRIDGE_HOME, 'claims.json'), { force: true });
  var pf = bridge.preflight(cfg, tL, state.readJSON(tL.execution.executor_task_id, 'task.json'));
  ok(pf === null, 'Q: preflight accepts re-binding to the existing, consistent executor record');
  ok(bridge.findExecutorTask(cfg, 'gh-inv-0004') === tL.execution.executor_task_id, 'Q: after the cache is lost, the executor store scan still finds the one record (no duplicate on recovery)');

  // R — stale worker / fencing.
  var lockA = bridge.acquireLock(cfg);
  var fenceA = bridge.currentFence();
  ok(lockA && typeof fenceA === 'number' && bridge.readLock(lockA).fence === fenceA && bridge.readLock(lockA).pid === process.pid, 'R: acquiring the lock issues a fence token');
  ok(bridge.assertLockOwned(cfg).owned === true, 'R: the owner passes the fencing check');
  // A newer worker takes the lock over (the old owner is "hung": heartbeat too old).
  var held = bridge.readLock(lockA);
  held.heartbeat_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(lockA, JSON.stringify(held));
  var savedStale = process.env.MYTHOS_BRIDGE_LOCK_STALE_MS;
  process.env.MYTHOS_BRIDGE_LOCK_STALE_MS = '1000';
  var cfgFresh = bridge.config();
  // Simulate the takeover exactly as acquireLock does it, from "another process".
  var fenceB = fenceA + 1;
  fs.writeFileSync(lockA, JSON.stringify({ pid: process.ppid, host: 'other', fence: fenceB, acquired_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() }));
  var stale = null;
  try { bridge.commitControl(cfgFresh, ['control/state.json'], 'stale worker must not land'); } catch (e) { stale = e; }
  ok(stale && stale.code === 'STALE_WORKER' && /STALE_WORKER/.test(stale.message) && /fence/.test(stale.message), 'R: a fenced-out worker cannot commit to the control branch');
  ok(bridge.heartbeatLock(cfgFresh) === false, 'R: a fenced-out worker cannot heartbeat the lock either');
  bridge.releaseLock(lockA);
  ok(fs.existsSync(lockA) && bridge.readLock(lockA).fence === fenceB, 'R: releasing does not delete a lock a newer worker owns');
  // The newer worker's lock, with a dead pid, is taken over by the next acquirer.
  fs.writeFileSync(lockA, JSON.stringify({ pid: 999999, host: 'other', fence: fenceB, acquired_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() }));
  var lockC = bridge.acquireLock(cfgFresh);
  ok(lockC && bridge.currentFence() > fenceB, 'R: a lock held by a dead process is taken over with a higher fence');
  bridge.releaseLock(lockC);
  // A live, fresh lock is respected (legacy bare-pid format included).
  fs.writeFileSync(lockA, String(process.ppid));
  ok(bridge.acquireLock(cfgFresh) === null, 'R: a live legacy (bare pid) lock is still respected');
  fs.unlinkSync(lockA);
  if (savedStale === undefined) delete process.env.MYTHOS_BRIDGE_LOCK_STALE_MS; else process.env.MYTHOS_BRIDGE_LOCK_STALE_MS = savedStale;

  // V — runtime identity mismatch / stale runtime.
  var rt = bridge.runtimeIdentity(cfg);
  ok(rt && typeof rt.verified === 'boolean' && rt.module.indexOf('github-bridge.js') !== -1 && rt.host && rt.measured_at, 'V: runtime identity is measured from the module location');
  if (rt.verified) {
    process.env.MYTHOS_BRIDGE_EXPECTED_HEAD = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    var rtM = bridge.runtimeIdentity(bridge.config());
    ok(rtM.code === 'RUNTIME_IDENTITY_MISMATCH' && rtM.stale === true && /deadbeefdead/.test(rtM.reason), 'V: a checkout other than the expected HEAD is RUNTIME_IDENTITY_MISMATCH');
    process.env.MYTHOS_BRIDGE_STRICT_RUNTIME = '1';
    plannerWrite('gh-inv-0005.json', mkTask('gh-inv-0005', { objective: 'Must not be claimed by a stale runtime under strict mode.' }));
    var rV = bridge.tick(executor);
    ok(actionsOf(rV, 'runtime')[0].code === 'RUNTIME_IDENTITY_MISMATCH' && actionsOf(rV, 'defer').some(function (a) { return a.task_id === 'gh-inv-0005'; }) && executorTasksFor('gh-inv-0005').length === 0,
      'V: strict mode refuses new claims on a runtime identity mismatch (deferred, not run)');
    delete process.env.MYTHOS_BRIDGE_STRICT_RUNTIME;
    delete process.env.MYTHOS_BRIDGE_EXPECTED_HEAD;
    var rV2 = bridge.tick(executor);
    ok(actionsOf(rV2, 'claim').some(function (a) { return a.task_id === 'gh-inv-0005'; }), 'V: once the identity matches again the task is claimed');
    ok(taskOnDisk('gh-inv-0005').execution.runtime.head === rt.head && taskOnDisk('gh-inv-0005').execution.runtime.verified === true, 'V: the claim records the verified HEAD');
  } else {
    ok(rt.code === 'RUNTIME_IDENTITY_UNVERIFIED' && /cannot resolve/.test(rt.reason), 'V: an unresolvable checkout is reported as RUNTIME_IDENTITY_UNVERIFIED, never as success (' + rt.reason.slice(0, 60) + ')');
    ok(repK.runtime_identity && repK.runtime_identity.code === 'RUNTIME_IDENTITY_UNVERIFIED', 'V: the report carries RUNTIME_IDENTITY_UNVERIFIED');
  }

  // W — gh-issue-118 §9: the runtime gate (pure). An unverifiable or
  // mismatched runtime never claims; a merely stale checkout claims unless
  // strict. The decision is data, so the tick, the log and the CLI agree.
  var gcfg = bridge.config();
  var gUnv = { code: 'RUNTIME_IDENTITY_UNVERIFIED', reason: 'cannot resolve the git checkout/HEAD of /x' };
  var gW = bridge.runtimeGate(gUnv, gcfg);
  ok(gW.claims_allowed === false && gW.code === 'RUNTIME_IDENTITY_UNVERIFIED' && /no new claims/.test(gW.reason) && gW.mode === 'default', 'W: RUNTIME_IDENTITY_UNVERIFIED refuses claims by default');
  process.env.MYTHOS_BRIDGE_ALLOW_UNVERIFIED_RUNTIME = '1';
  var gW2 = bridge.runtimeGate(gUnv, bridge.config());
  ok(gW2.claims_allowed === true && /MYTHOS_BRIDGE_ALLOW_UNVERIFIED_RUNTIME=1/.test(gW2.reason), 'W: MYTHOS_BRIDGE_ALLOW_UNVERIFIED_RUNTIME=1 is the explicit, recorded opt-out');
  delete process.env.MYTHOS_BRIDGE_ALLOW_UNVERIFIED_RUNTIME;
  ok(bridge.runtimeGate({ code: 'RUNTIME_IDENTITY_MISMATCH', reason: 'running from aaaa but expected bbbb' }, bridge.config()).claims_allowed === false, 'W: RUNTIME_IDENTITY_MISMATCH refuses claims even without strict mode');
  var gStale = { code: 'RUNTIME_STALE_CHECKOUT', reason: 'behind origin/main' };
  ok(bridge.runtimeGate(gStale, bridge.config()).claims_allowed === true, 'W: RUNTIME_STALE_CHECKOUT alone keeps claiming (deploy lag must not stall the channel)');
  process.env.MYTHOS_BRIDGE_STRICT_RUNTIME = '1';
  var gW3 = bridge.runtimeGate(gStale, bridge.config());
  ok(gW3.claims_allowed === false && gW3.mode === 'strict' && /MYTHOS_BRIDGE_STRICT_RUNTIME=1/.test(gW3.reason), 'W: strict mode refuses a stale checkout, naming the switch');
  delete process.env.MYTHOS_BRIDGE_STRICT_RUNTIME;
  ok(bridge.runtimeGate({ code: null }, bridge.config()).claims_allowed === true && bridge.runtimeGate(null, bridge.config()).claims_allowed === true, 'W: a verified runtime claims');
  if (rt.verified) {
    // The tick applies the gate: a mismatch (no strict mode) defers with the reason on the action and in the bridge log.
    process.env.MYTHOS_BRIDGE_EXPECTED_HEAD = 'cafef00dcafef00dcafef00dcafef00dcafef00d';
    plannerWrite('gh-inv-0006.json', mkTask('gh-inv-0006', { objective: 'Must not be claimed by a mismatched runtime, strict or not.' }));
    var rW = bridge.tick(executor);
    var dW = actionsOf(rW, 'defer').filter(function (a) { return a.task_id === 'gh-inv-0006'; })[0];
    ok(dW && dW.reason === 'runtime:RUNTIME_IDENTITY_MISMATCH' && /no new claims/.test(dW.detail) && executorTasksFor('gh-inv-0006').length === 0,
      'W: tick defers with reason runtime:RUNTIME_IDENTITY_MISMATCH without MYTHOS_BRIDGE_STRICT_RUNTIME');
    var rtW = actionsOf(rW, 'runtime')[0];
    ok(rtW && rtW.claims_allowed === false && rtW.gate_mode === 'default', 'W: the runtime action on the tick shows claims_allowed=false');
    var blog = fs.readFileSync(path.join(process.env.MYTHOS_BRIDGE_HOME, 'events.log'), 'utf8');
    ok(/"bridge":"claim_deferred"/.test(blog) && /gh-inv-0006/.test(blog) && /runtime:RUNTIME_IDENTITY_MISMATCH/.test(blog), 'W: claim_deferred is in the durable bridge log with the reason');
    delete process.env.MYTHOS_BRIDGE_EXPECTED_HEAD;
    var rW2 = bridge.tick(executor);
    ok(actionsOf(rW2, 'claim').some(function (a) { return a.task_id === 'gh-inv-0006'; }), 'W: the first verifying tick claims it');
    var cliGate = cp.spawnSync(process.execPath, [path.join(EXEC, 'bin', 'mythos-github-bridge'), 'runtime'], { env: process.env, encoding: 'utf8' });
    ok(cliGate.status === 0 && /"gate"/.test(cliGate.stdout) && /"claims_allowed": true/.test(cliGate.stdout), 'W: the runtime CLI prints the gate decision');

    // X — gh-issue-118 §4: lease expiry is observed once, recorded on the
    // task and in the log, and never turns into a re-claim or a second run.
    relay();
    var leased = JSON.parse(plannerRead('tasks/gh-inv-0006.json'));
    ok(leased.execution.lease && leased.execution.lease.expires_at && leased.execution.lease.fence === leased.execution.fence, 'X: the claim carries a lease with an expiry and the claim fence');
    leased.execution.lease.expires_at = new Date(Date.now() - 5 * 60000).toISOString();
    plannerWrite('gh-inv-0006.json', leased, 'test: age the lease of gh-inv-0006');
    var rX = bridge.tick(executor);
    var lx = actionsOf(rX, 'lease_expired');
    ok(lx.length === 1 && lx[0].task_id === 'gh-inv-0006' && lx[0].executor_status === 'QUEUED', 'X: an expired lease on a non-terminal attempt is reported as lease_expired');
    var tX = taskOnDisk('gh-inv-0006');
    ok(tX.execution.lease.expired_noted_at && tX.execution.lease.expired_executor_status === 'QUEUED' && tX.history.some(function (h) { return /^LEASE_EXPIRED:/.test(h.note) && /not re-claimed or re-run/.test(h.note); }),
      'X: the expiry is durable on the task (expired_noted_at + history note)');
    ok(executorTasksFor('gh-inv-0006').length === 1 && actionsOf(rX, 'claim').every(function (a) { return a.task_id !== 'gh-inv-0006'; }), 'X: no re-claim, no second executor task');
    var rX2 = bridge.tick(executor);
    ok(actionsOf(rX2, 'lease_expired').length === 0 && taskOnDisk('gh-inv-0006').execution.lease.expired_noted_at === tX.execution.lease.expired_noted_at, 'X: observed exactly once');
    ok(/"bridge":"lease_expired"/.test(fs.readFileSync(path.join(process.env.MYTHOS_BRIDGE_HOME, 'events.log'), 'utf8')), 'X: lease_expired is in the durable bridge log');
  }

  // Trail — the whole chain is reconstructible from durable records.
  var tr = bridge.trail('gh-inv-0002');
  var stages = tr.events.map(function (e) { return e.stage; });
  ok(tr.found && tr.decision.requested_action === 'implement' && tr.decision.blocker.code === 'ACTION_PROFILE_MISMATCH' && stages.indexOf('report_generated') !== -1 && stages.indexOf('task_created') !== -1,
    'trail: a blocked task shows created → blocked decision → report with reasons (' + stages.join(',') + ')');
  var trJ = bridge.trail('gh-inv-0001');
  var sJ = trJ.events.map(function (e) { return e.stage; });
  ok(sJ.indexOf('task_claimed') !== -1 && sJ.indexOf('executor_task_created') !== -1 && sJ.indexOf('model_selected') !== -1 && trJ.events.every(function (e) { return e.source; }),
    'trail: a claimed task shows claimed → executor created → model selected, each with its source record (' + sJ.join(',') + ')');
  var cli = cp.spawnSync(process.execPath, [path.join(EXEC, 'bin', 'mythos-github-bridge'), 'trail', 'gh-inv-0002'], { env: process.env, encoding: 'utf8' });
  ok(cli.status === 0 && /ACTION_PROFILE_MISMATCH/.test(cli.stdout) && /report_generated/.test(cli.stdout), 'trail: the CLI prints it');
  var cliRt = cp.spawnSync(process.execPath, [path.join(EXEC, 'bin', 'mythos-github-bridge'), 'runtime'], { env: process.env, encoding: 'utf8' });
  ok(cliRt.status === 0 && /"module"/.test(cliRt.stdout) && /"verified"/.test(cliRt.stdout), 'runtime: the CLI prints the identity');
}).catch(function (e) {
  ok(false, 'unexpected error: ' + (e && e.stack || e));
}).then(function () {
  fs.rmSync(FIX, { recursive: true, force: true });
  console.log('github-bridge tests: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.error(failures.join('\n')); process.exit(1); }
});
