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
process.env.MYTHOS_BRIDGE_PROJECT = 'executor-selftest';
process.env.MYTHOS_BRIDGE_REPO = path.join(FIX, 'repo');
process.env.MYTHOS_BRIDGE_CONTROL_DIR = path.join(FIX, 'control');
process.env.MYTHOS_BRIDGE_TASK_WORKTREES = path.join(FIX, 'wt');
process.env.MYTHOS_BRIDGE_HOME = path.join(FIX, 'home', 'bridge');
process.env.MYTHOS_BRIDGE_PROVIDER = 'mock';
process.env.OTHMODE_STORE_ROOT = path.join(FIX, 'othstore');
fs.mkdirSync(process.env.OTHMODE_STORE_ROOT, { recursive: true, mode: 0o700 });
delete process.env.MYTHOS_MOCK_SCRIPT;

var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var bridge = require(path.join(EXEC, 'bridge', 'github-bridge'));
var othTasks = require(path.join(BASE, 'projects', 'command-center', 'reference', 'othmode', 'tasks.js'));

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
}).catch(function (e) {
  ok(false, 'unexpected error: ' + (e && e.stack || e));
}).then(function () {
  fs.rmSync(FIX, { recursive: true, force: true });
  console.log('github-bridge tests: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.error(failures.join('\n')); process.exit(1); }
});
