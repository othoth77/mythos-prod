'use strict';
// =====================================================
// MYTHOS — Stage MYTHOS-MULTI-AGENT-ORCHESTRATOR-0 tests
// tests/mythos-orchestrator-0-test.js
//
// Deterministic and offline. No real provider is ever launched: provider
// behaviour (exit codes, missing/malformed results, timeouts) is exercised
// through a stub swapped into runner.PROVIDERS, and Git behaviour is
// exercised against throwaway repositories created per test.
//
// Fixtures cannot live under /tmp: the task contract forbids a /tmp working
// directory outright, so a /tmp fixture could not exercise the runner at all.
// The fixture root is therefore probed for writability, because this suite
// must also run inside a delegated worker sandbox, where only the workspace
// (and any explicitly added directory) is writable — ~/.cache is not. They
// are disposable and removed at the end of the run. Test 16 separately proves
// the PRODUCTION task store never defaults to /tmp.
//
// Run with: node tests/mythos-orchestrator-0-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var ORCH = path.join(BASE, 'projects', 'mythos-orchestrator');

var orchestrator = require(path.join(ORCH, 'orchestrator.js'));
var router = require(path.join(ORCH, 'router.js'));
var runner = require(path.join(ORCH, 'runner.js'));
var verifier = require(path.join(ORCH, 'verifier.js'));
var store = require(path.join(ORCH, 'lib', 'store.js'));
var redact = require(path.join(ORCH, 'lib', 'redact.js'));
var schemaLib = require(path.join(ORCH, 'lib', 'schema.js'));
var codexProvider = require(path.join(ORCH, 'providers', 'codex.js'));

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
// First writable candidate wins. `.test-fixtures/` inside the repository is
// the sandbox-friendly fallback: a delegated worker can always write to its
// own workspace, even when the home directory is read-only.
function pickFixtureBase() {
  var candidates = [
    process.env.MYTHOS_TEST_FIXTURE_ROOT,
    path.join(os.homedir(), '.cache'),
    path.join(BASE, '.test-fixtures')
  ].filter(Boolean);

  for (var i = 0; i < candidates.length; i++) {
    try {
      fs.mkdirSync(candidates[i], { recursive: true });
      var probe = path.join(candidates[i], '.write-probe-' + process.pid);
      fs.writeFileSync(probe, 'x');
      fs.unlinkSync(probe);
      return candidates[i];
    } catch (e) { /* not writable here — try the next candidate */ }
  }
  throw new Error('NO_WRITABLE_FIXTURE_ROOT: tried ' + candidates.join(', '));
}

var FIXTURE_BASE = pickFixtureBase();
var TMP_ROOT = fs.mkdtempSync(path.join(FIXTURE_BASE, 'mythos-orch-test-'));
var CLEANUP = [TMP_ROOT];

function tmpdir(name) {
  var d = path.join(TMP_ROOT, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function g(args, cwd) {
  return cp.execFileSync('git', args, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// A throwaway repository with one commit on a non-main branch.
function mkRepo(name, opts) {
  opts = opts || {};
  var dir = tmpdir(name);
  g(['init', '--quiet', '--initial-branch=work'], dir);
  g(['config', 'user.email', 'test@example.invalid'], dir);
  g(['config', 'user.name', 'Mythos Test'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  g(['add', 'README.md'], dir);
  g(['commit', '--quiet', '-m', 'fixture: initial'], dir);
  var sha = g(['rev-parse', 'HEAD'], dir);
  if (opts.second) {
    fs.writeFileSync(path.join(dir, 'second.md'), '# second\n');
    g(['add', 'second.md'], dir);
    g(['commit', '--quiet', '-m', 'fixture: second'], dir);
  }
  return { dir: dir, sha: sha, head: g(['rev-parse', 'HEAD'], dir) };
}

function baseTask(over) {
  var t = {
    schema_version: '1.0.0',
    task_id: 'orch-test-000001',
    project: 'mythos-prod',
    stage: 'MYTHOS-MULTI-AGENT-ORCHESTRATOR-0',
    created_at: '2026-08-12T00:00:00.000Z',
    requested_by: 'claude',
    assigned_provider: 'codex',
    repository: 'othoth77/mythos-prod',
    working_directory: '/home/deploy/projects/worktrees/example',
    branch: 'agent/example/0001',
    baseline_commit: 'a'.repeat(40),
    objective: 'Implement the requested change in an isolated branch.',
    instructions: 'Follow the task instructions exactly and report a structured result.',
    constraints: [],
    required_tests: [{ name: 'orchestrator', command: 'node tests/mythos-orchestrator-0-test.js' }],
    delivery: { commit_required: true, push_required: true, handover_required: false, tests_required: true },
    timeout_seconds: 1800,
    risk_class: 'CODE_IMPLEMENTATION',
    execution_level: 2,
    allow_production_mutation: false,
    result_path: 'result.json'
  };
  Object.assign(t, over || {});
  // The declared execution level must agree with the router, so derive it
  // from the (possibly overridden) delivery requirements unless a test is
  // deliberately exercising a mismatch by passing one explicitly.
  if (!over || over.execution_level === undefined) {
    t.execution_level = router.routeTask(t).execution_level;
  }
  return t;
}

function baseResult(over) {
  var r = {
    task_id: 'orch-test-000001',
    provider: 'codex',
    status: 'completed',
    blocked_reason: null,
    baseline: 'a'.repeat(40),
    branch: 'agent/example/0001',
    implementation_commit: null,
    handover_commit: null,
    remote_head: null,
    tests: [{ name: 'orchestrator', command: 'node tests/mythos-orchestrator-0-test.js', passed: true, output_summary: '35/35 passed' }],
    files_changed: [],
    blockers: [],
    warnings: [],
    next_stage: null,
    summary: 'Implemented the requested change and verified it locally.'
  };
  return Object.assign(r, over || {});
}

// Stub provider — lets exit codes, missing results and timeouts be tested
// without launching a real CLI or making a network call.
function withStubProvider(behaviour, fn) {
  var real = runner.PROVIDERS.codex;
  runner.PROVIDERS.codex = {
    PROVIDER_ID: 'codex',
    version: function () { return 'stub-codex 0.0.0'; },
    available: function () { return true; },
    buildArgs: function () { return ['exec', '--stub']; },
    renderPrompt: function () { return 'stub prompt'; },
    run: function (task, paths) {
      if (behaviour.writeResult !== undefined && behaviour.writeResult !== null) {
        fs.writeFileSync(paths.result, behaviour.writeResult);
      }
      return {
        provider: 'codex',
        command: 'stub',
        exit_code: behaviour.exit_code === undefined ? 0 : behaviour.exit_code,
        signal: null,
        timed_out: !!behaviour.timed_out,
        duration_ms: 5,
        spawn_error: null
      };
    }
  };
  try { return fn(); } finally { runner.PROVIDERS.codex = real; }
}

// The runner writes into MYTHOS_ORCHESTRATOR_HOME; point it at a fixture.
var SAVED_HOME = process.env.MYTHOS_ORCHESTRATOR_HOME;
process.env.MYTHOS_ORCHESTRATOR_HOME = tmpdir('state');

// ---------------------------------------------------------------------------
console.log('\n1. TASK CONTRACT — valid task accepted');
(function () {
  var v = runner.validateTask(baseTask());
  ok(v.valid, 'A well-formed implementation task validates cleanly');
})();

console.log('\n2. TASK CONTRACT — malformed task rejected');
(function () {
  ok(!runner.validateTask({ task_id: 'x' }).valid, 'A task missing required fields is rejected');
  ok(!runner.validateTask(baseTask({ task_id: 'BAD ID!' })).valid, 'A task id violating the slug pattern is rejected');
  ok(!runner.validateTask(baseTask({ timeout_seconds: 5 })).valid, 'A timeout below the permitted minimum is rejected');
  ok(!runner.validateTask(baseTask({ branch: 'main' })).valid, 'A task targeting main is rejected by the schema');
  ok(!runner.validateTask(baseTask({ working_directory: '/tmp/somewhere' })).valid, 'A /tmp working directory is rejected by the schema');
  var extra = baseTask(); extra.unexpected_field = true;
  ok(!runner.validateTask(extra).valid, 'An unexpected additional property is rejected (strict contract)');
})();

console.log('\n3. GIT PREFLIGHT — missing baseline rejected');
(function () {
  var repo = mkRepo('repo-missing-baseline');
  var pre = orchestrator.git.preflight(baseTask({
    working_directory: repo.dir, branch: 'work', baseline_commit: 'b'.repeat(40)
  }), { skipFetch: true });
  ok(!pre.ok, 'Preflight fails when the declared baseline does not exist');
  ok(pre.blockers.some(function (b) { return b.indexOf('BASELINE_MISSING') === 0; }), 'BASELINE_MISSING is reported');
})();

console.log('\n4. GIT PREFLIGHT — branch collision detected');
(function () {
  var repo = mkRepo('repo-collision');
  var other = path.join(TMP_ROOT, 'repo-collision-wt2');
  g(['worktree', 'add', '-b', 'agent/collide/0001', other, 'HEAD'], repo.dir);
  var pre = orchestrator.git.preflight(baseTask({
    working_directory: repo.dir, branch: 'agent/collide/0001', baseline_commit: repo.head
  }), { skipFetch: true });
  ok(pre.blockers.some(function (b) { return b.indexOf('BRANCH_COLLISION') === 0; }),
    'A branch already checked out in another worktree is reported as BRANCH_COLLISION');
})();

console.log('\n5. GIT PREFLIGHT — dirty worktree detected');
(function () {
  var repo = mkRepo('repo-dirty');
  fs.writeFileSync(path.join(repo.dir, 'untracked.txt'), 'uncommitted\n');
  var pre = orchestrator.git.preflight(baseTask({
    working_directory: repo.dir, branch: 'work', baseline_commit: repo.head
  }), { skipFetch: true });
  ok(!pre.ok, 'Preflight fails on a dirty worktree');
  ok(pre.blockers.some(function (b) { return b.indexOf('DIRTY_WORKTREE') === 0; }),
    'DIRTY_WORKTREE is reported rather than overwriting another agent\'s work');
})();

console.log('\n6. TASK CONTRACT — secret in task rejected');
(function () {
  var withToken = baseTask({ instructions: 'Use ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8 to authenticate.' });
  var v = runner.validateTask(withToken);
  ok(!v.valid, 'A task carrying a GitHub token is refused');
  ok(v.errors.some(function (e) { return e.indexOf('SECRET_IN_TASK') === 0; }), 'The refusal names SECRET_IN_TASK');
  ok(v.errors.every(function (e) { return e.indexOf('ghp_A1b2') === -1; }), 'The rejection message never echoes the secret itself');

  var dbUrl = baseTask({ objective: 'Migrate postgres://user:hunter2@db.internal:5432/app to the new host.' });
  ok(!runner.validateTask(dbUrl).valid, 'A task carrying a credentialed connection string is refused');
})();

console.log('\n7. ROUTER — implementation goes to Codex');
(function () {
  router.CODEX_CLASSES.forEach(function (c) {
    var r = router.route(c, { commitRequired: true });
    ok(r.decision === 'CODEX' && r.provider === 'codex', 'Implementation class ' + c + ' routes to Codex');
  });
})();

console.log('\n8. ROUTER — architecture stays with Claude');
(function () {
  router.CLAUDE_CLASSES.forEach(function (c) {
    var r = router.route(c);
    ok(r.decision === 'CLAUDE' && r.provider === 'claude', 'Judgement class ' + c + ' stays with Claude');
  });
})();

console.log('\n9. ROUTER — high-risk operations require user approval');
(function () {
  router.APPROVAL_CLASSES.forEach(function (c) {
    var r = router.route(c);
    ok(r.decision === 'USER_APPROVAL_REQUIRED' && r.execution_level === 3,
      'High-risk class ' + c + ' requires user approval at level 3');
  });
  ok(router.route('NOT_A_REAL_CLASS').decision === 'USER_APPROVAL_REQUIRED', 'An unknown class fails closed to approval');
  ok(router.route(null).decision === 'USER_APPROVAL_REQUIRED', 'A missing class fails closed to approval');
})();

console.log('\n10. RUNNER — exit 0 with a valid result is completed');
(function () {
  var repo = mkRepo('repo-exec-ok');
  var task = baseTask({
    task_id: 'orch-exec-ok-0001', working_directory: repo.dir, branch: 'work',
    baseline_commit: repo.head, delivery: { commit_required: false, push_required: false, handover_required: false, tests_required: true }
  });
  var result = baseResult({ task_id: 'orch-exec-ok-0001', branch: 'work', baseline: repo.head });
  var out = withStubProvider({ exit_code: 0, writeResult: JSON.stringify(result) }, function () {
    return runner.execute(task, { skipFetch: true });
  });
  ok(out.status === 'completed', 'A zero exit plus a schema-valid result yields completed');
  ok(out.dispatched === true, 'The task is recorded as dispatched');
})();

console.log('\n11. RUNNER — nonzero exit is failed');
(function () {
  var repo = mkRepo('repo-exec-fail');
  var task = baseTask({
    task_id: 'orch-exec-fail-001', working_directory: repo.dir, branch: 'work', baseline_commit: repo.head,
    delivery: { commit_required: false, push_required: false, handover_required: false, tests_required: true }
  });
  var result = baseResult({ task_id: 'orch-exec-fail-001', branch: 'work', baseline: repo.head });
  var out = withStubProvider({ exit_code: 3, writeResult: JSON.stringify(result) }, function () {
    return runner.execute(task, { skipFetch: true });
  });
  ok(out.status === 'failed', 'A nonzero provider exit is failed even when the result claims completed');
  ok(out.blockers.some(function (b) { return b.indexOf('NONZERO_EXIT') === 0; }), 'NONZERO_EXIT is reported');
})();

console.log('\n12. RUNNER — a missing result is never success');
(function () {
  var repo = mkRepo('repo-exec-noresult');
  var task = baseTask({
    task_id: 'orch-exec-nores-01', working_directory: repo.dir, branch: 'work', baseline_commit: repo.head,
    delivery: { commit_required: false, push_required: false, handover_required: false, tests_required: true }
  });
  var out = withStubProvider({ exit_code: 0, writeResult: null }, function () {
    return runner.execute(task, { skipFetch: true });
  });
  ok(out.status === 'failed', 'Exit 0 with no structured result is failed, never completed');
  ok(out.blockers.some(function (b) { return b.indexOf('MISSING_RESULT') === 0; }), 'MISSING_RESULT is reported explicitly');
})();

console.log('\n13. RUNNER — malformed and invalid results rejected');
(function () {
  var repo = mkRepo('repo-exec-malformed');
  function runWith(body, id) {
    var task = baseTask({
      task_id: id, working_directory: repo.dir, branch: 'work', baseline_commit: repo.head,
      delivery: { commit_required: false, push_required: false, handover_required: false, tests_required: true }
    });
    return withStubProvider({ exit_code: 0, writeResult: body }, function () {
      return runner.execute(task, { skipFetch: true });
    });
  }
  var bad = runWith('{ this is not json', 'orch-malformed-001');
  ok(bad.status === 'failed' && bad.blockers.some(function (b) { return b.indexOf('MALFORMED_RESULT') === 0; }),
    'Unparsable JSON is failed with MALFORMED_RESULT');

  var invalid = runWith(JSON.stringify({ task_id: 'orch-invalid-0001', status: 'completed' }), 'orch-invalid-0001');
  ok(invalid.status === 'failed' && invalid.blockers.some(function (b) { return b.indexOf('INVALID_RESULT') === 0; }),
    'A result missing contract fields is failed with INVALID_RESULT');

  var mismatched = runWith(JSON.stringify(baseResult({ task_id: 'someone-else-0001', branch: 'work', baseline: repo.head })), 'orch-mismatch-0001');
  ok(mismatched.status === 'failed', 'A result carrying a different task_id is rejected');

  var badStatus = runWith(JSON.stringify(baseResult({ task_id: 'orch-badstatus-01', status: 'finished', branch: 'work', baseline: repo.head })), 'orch-badstatus-01');
  ok(badStatus.status === 'failed', 'A status outside the permitted enum is rejected');
})();

console.log('\n14. RUNNER / PROVIDER — timeout handled');
(function () {
  // Runner mapping: a timed-out provider is failed regardless of exit code.
  var repo = mkRepo('repo-timeout');
  var task = baseTask({
    task_id: 'orch-timeout-0001', working_directory: repo.dir, branch: 'work', baseline_commit: repo.head,
    delivery: { commit_required: false, push_required: false, handover_required: false, tests_required: true }
  });
  var out = withStubProvider({ exit_code: null, timed_out: true, writeResult: null }, function () {
    return runner.execute(task, { skipFetch: true });
  });
  ok(out.status === 'failed', 'A timed-out provider run is failed');
  ok(out.blockers.some(function (b) { return b.indexOf('TIMEOUT') === 0; }), 'TIMEOUT is reported');

  // Provider adapter: a real subprocess exceeding its budget is terminated
  // and reported as timed_out. Uses a 1-second budget for speed.
  var fakeBin = path.join(TMP_ROOT, 'fake-slow-provider');
  fs.writeFileSync(fakeBin, '#!/bin/sh\nsleep 30\n', { mode: 0o700 });
  var paths = {
    prompt: path.join(TMP_ROOT, 'timeout-prompt.md'),
    stdout: path.join(TMP_ROOT, 'timeout-stdout.log'),
    stderr: path.join(TMP_ROOT, 'timeout-stderr.log'),
    result: path.join(TMP_ROOT, 'timeout-result.json'),
    resultSchema: path.join(ORCH, 'schemas', 'result.schema.json')
  };
  fs.writeFileSync(paths.prompt, 'prompt');
  var res = codexProvider.run(
    { working_directory: repo.dir, timeout_seconds: 1, execution_level: 1, delivery: { commit_required: false } },
    paths, { bin: fakeBin }
  );
  ok(res.timed_out === true, 'The provider adapter terminates and reports a real subprocess timeout');
  ok(res.duration_ms < 20000, 'The timed-out subprocess is killed at its budget rather than running to completion');
})();

console.log('\n15. LOGGING — task artefacts persist');
(function () {
  var repo = mkRepo('repo-logs');
  var task = baseTask({
    task_id: 'orch-logs-000001', working_directory: repo.dir, branch: 'work', baseline_commit: repo.head,
    delivery: { commit_required: false, push_required: false, handover_required: false, tests_required: true }
  });
  var result = baseResult({ task_id: 'orch-logs-000001', branch: 'work', baseline: repo.head });
  withStubProvider({ exit_code: 0, writeResult: JSON.stringify(result) }, function () {
    return runner.execute(task, { skipFetch: true });
  });
  var dir = store.taskDir('orch-logs-000001');
  ok(fs.existsSync(path.join(dir, 'task.json')), 'task.json persists');
  ok(fs.existsSync(path.join(dir, 'prompt.md')), 'prompt.md persists');
  ok(fs.existsSync(path.join(dir, 'status.json')), 'status.json persists');
  ok(fs.existsSync(path.join(dir, 'result.json')), 'result.json persists');
  var st = store.readJSON('orch-logs-000001', 'status.json');
  ok(st && st.exit_code === 0 && typeof st.duration_ms === 'number', 'status.json records exit code and duration');
  ok(st.provider === 'codex' && st.branch === 'work' && st.baseline === repo.head, 'status.json records provider, branch and baseline');
  ok(!!st.started_at && !!st.finished_at, 'status.json records start and finish timestamps');
})();

console.log('\n16. STATE — /tmp is never the authoritative task store');
(function () {
  var saved = process.env.MYTHOS_ORCHESTRATOR_HOME;
  delete process.env.MYTHOS_ORCHESTRATOR_HOME;
  var root = store.root();
  process.env.MYTHOS_ORCHESTRATOR_HOME = saved;
  ok(root.indexOf('/tmp') !== 0, 'The default orchestrator state root is not under /tmp (' + root + ')');
  ok(root.indexOf('/home/deploy') === 0, 'The default state root is a persistent deploy-owned path');
  var src = fs.readFileSync(path.join(ORCH, 'schemas', 'task.schema.json'), 'utf8');
  ok(src.indexOf('tmp/') !== -1, 'The task schema explicitly encodes the /tmp working-directory prohibition');
})();

console.log('\n17. CONCURRENCY — two writers cannot share a worktree');
(function () {
  var repo = mkRepo('repo-two-writers');
  var wt2 = path.join(TMP_ROOT, 'repo-two-writers-wt2');
  g(['worktree', 'add', '-b', 'agent/shared/0001', wt2, 'HEAD'], repo.dir);

  // Second task claiming the same branch from a different directory.
  var pre = orchestrator.git.preflight(baseTask({
    working_directory: repo.dir, branch: 'agent/shared/0001', baseline_commit: repo.head
  }), { skipFetch: true });
  ok(!pre.ok, 'A second task cannot claim a branch already checked out elsewhere');

  // A task whose target worktree is mid-edit by another agent.
  fs.writeFileSync(path.join(wt2, 'in-progress.txt'), 'another agent is working here\n');
  var pre2 = orchestrator.git.preflight(baseTask({
    working_directory: wt2, branch: 'agent/shared/0001', baseline_commit: repo.head
  }), { skipFetch: true });
  ok(!pre2.ok && pre2.blockers.some(function (b) { return b.indexOf('DIRTY_WORKTREE') === 0; }),
    'An in-progress worktree owned by another task is never entered');

  // A linked worktree keeps its Git directory in the main repository, which
  // a sandboxed worker must be granted before it can fetch or commit.
  ok(orchestrator.git.gitDirIsExternal(wt2) === true,
    'A linked worktree is detected as keeping its Git directory outside itself');
  ok(orchestrator.git.gitDirIsExternal(repo.dir) === false,
    'A primary worktree is not misreported as linked');
  ok(String(orchestrator.git.commonDir(wt2)).indexOf(path.resolve(repo.dir)) === 0,
    'The shared Git directory of a linked worktree resolves into the main repository');
})();

console.log('\n18. GIT — baseline mismatch stops the task');
(function () {
  var repo = mkRepo('repo-baseline-mismatch', { second: true });
  var pre = orchestrator.git.preflight(baseTask({
    working_directory: repo.dir, branch: 'work', baseline_commit: repo.sha
  }), { skipFetch: true });
  ok(!pre.ok, 'Preflight fails when HEAD has moved past the declared baseline');
  ok(pre.blockers.some(function (b) { return b.indexOf('BASELINE_MISMATCH') === 0; }), 'BASELINE_MISMATCH is reported');

  var out = withStubProvider({ exit_code: 0, writeResult: JSON.stringify(baseResult()) }, function () {
    return runner.execute(baseTask({
      task_id: 'orch-baseline-0001', working_directory: repo.dir, branch: 'work', baseline_commit: repo.sha
    }), { skipFetch: true });
  });
  ok(out.dispatched === false && out.status === 'blocked', 'The provider is never launched on a baseline mismatch');
})();

console.log('\n19. VERIFIER — a fabricated commit SHA is rejected');
(function () {
  var repo = mkRepo('repo-fake-sha');
  var task = baseTask({ working_directory: repo.dir, branch: 'work', baseline_commit: repo.head });
  var result = baseResult({
    branch: 'work', baseline: repo.head,
    implementation_commit: 'f'.repeat(40), remote_head: 'f'.repeat(40)
  });
  var ver = verifier.verify(task, result, { skipFetch: true });
  ok(!ver.verified, 'A result claiming a nonexistent commit never verifies');
  ok(ver.failures.some(function (f) { return f.indexOf('implementation_commit_exists') === 0; }),
    'The verifier names the nonexistent commit check');

  var shortSha = verifier.verify(task, baseResult({ branch: 'work', baseline: repo.head, implementation_commit: 'abc123' }), { skipFetch: true });
  ok(!shortSha.verified, 'A malformed (non-40-character) SHA is rejected');

  // A passing check must not carry failure text, or the report reads as
  // though it failed.
  ok(ver.checks.filter(function (c) { return c.passed; }).every(function (c) { return c.detail === ''; }),
    'Passing checks carry no failure detail');
  ok(ver.checks.filter(function (c) { return !c.passed; }).length === ver.failures.length,
    'Every failed check is reflected exactly once in failures');
})();

console.log('\n20. VERIFIER — a failing test prevents completion');
(function () {
  var repo = mkRepo('repo-test-failure');
  var task = baseTask({
    working_directory: repo.dir, branch: 'work', baseline_commit: repo.head,
    delivery: { commit_required: false, push_required: false, handover_required: false, tests_required: true }
  });
  var result = baseResult({
    branch: 'work', baseline: repo.head,
    tests: [{ name: 'orchestrator', command: 'node tests/mythos-orchestrator-0-test.js', passed: false, output_summary: '34/35 passed' }]
  });
  var ver = verifier.verify(task, result, { skipFetch: true });
  ok(!ver.verified, 'A reported test failure prevents verification');
  ok(ver.failures.some(function (f) { return f.indexOf('all_reported_tests_passed') === 0; }), 'The failing test check is named');

  var missing = verifier.verify(task, baseResult({ branch: 'work', baseline: repo.head, tests: [] }), { skipFetch: true });
  ok(!missing.verified, 'A result reporting no tests at all never verifies when tests are required');
})();

console.log('\n21. VERIFIER — remote state must be confirmed');
(function () {
  var repo = mkRepo('repo-remote');
  var task = baseTask({
    working_directory: repo.dir, branch: 'work', baseline_commit: repo.head,
    delivery: { commit_required: true, push_required: true, handover_required: false, tests_required: true }
  });
  var result = baseResult({
    branch: 'work', baseline: repo.head,
    implementation_commit: repo.head, remote_head: repo.head
  });
  var ver = verifier.verify(task, result, { skipFetch: true });
  ok(!ver.verified, 'A push-required task never verifies without a real remote branch');
  ok(ver.failures.some(function (f) { return f.indexOf('remote_branch_exists') === 0; }),
    'The verifier requires the branch to exist on origin, not merely locally');

  // Pushing is an orchestrator action: worker sandboxes are local-only, and
  // mutating shared remote state is a level 2 responsibility.
  var noCommit = orchestrator.pushDeliveredBranch(task, baseResult({ implementation_commit: null }));
  ok(noCommit.pushed === false && noCommit.error === 'NO_VERIFIABLE_COMMIT_TO_PUSH',
    'The orchestrator refuses to push when there is no verifiable commit');
  var fakeCommit = orchestrator.pushDeliveredBranch(task, baseResult({ implementation_commit: 'f'.repeat(40) }));
  ok(fakeCommit.pushed === false, 'The orchestrator refuses to push a fabricated commit');

  var orchSrc = fs.readFileSync(path.join(ORCH, 'orchestrator.js'), 'utf8');
  ok(orchSrc.indexOf('--force') === -1 && orchSrc.indexOf('force-with-lease') === -1,
    'The delivery push never force-pushes');

  var template = fs.readFileSync(path.join(ORCH, 'templates', 'codex-task.md'), 'utf8');
  ok(/no network access/i.test(template), 'The worker prompt states that the sandbox has no network access');
  ok(/orchestrator pushes/i.test(template), 'The worker prompt tells the worker not to push');
})();

console.log('\n22. NOTIFICATIONS — failure is non-fatal');
(function () {
  var repo = mkRepo('repo-notify');
  var savedUrl = process.env.MYTHOS_NTFY_URL;
  var savedCfg = process.env.MYTHOS_NOTIFY_CONFIG;
  process.env.MYTHOS_NTFY_URL = 'http://127.0.0.1:9/blackhole';
  process.env.MYTHOS_NOTIFY_CONFIG = path.join(TMP_ROOT, 'no-such-notify.env');

  var task = baseTask({
    task_id: 'orch-notify-00001', working_directory: repo.dir, branch: 'work', baseline_commit: repo.head,
    delivery: { commit_required: false, push_required: false, handover_required: false, tests_required: true }
  });
  var result = baseResult({ task_id: 'orch-notify-00001', branch: 'work', baseline: repo.head });
  var out = withStubProvider({ exit_code: 0, writeResult: JSON.stringify(result) }, function () {
    return runner.execute(task, { skipFetch: true });
  });
  ok(out.status === 'completed', 'An unreachable notification endpoint does not change task status');

  var n = runner.notify('task_completed', 'TEST', 'unreachable endpoint');
  ok(n && typeof n === 'object', 'notify() returns an outcome object rather than throwing');

  if (savedUrl === undefined) { delete process.env.MYTHOS_NTFY_URL; } else { process.env.MYTHOS_NTFY_URL = savedUrl; }
  if (savedCfg === undefined) { delete process.env.MYTHOS_NOTIFY_CONFIG; } else { process.env.MYTHOS_NOTIFY_CONFIG = savedCfg; }
})();

console.log('\n23. PATH SAFETY — task ids cannot traverse');
(function () {
  ['../evil', '../../etc/passwd', '/etc/passwd', 'a/b', 'foo\\bar', '..', 'UPPER-CASE', 'sh', ''].forEach(function (bad) {
    var threw = false;
    try { store.taskDir(bad); } catch (e) { threw = true; }
    ok(threw, 'taskDir refuses the unsafe id ' + JSON.stringify(bad));
  });
  ok(!store.isValidTaskId('../../evil-task-id'), 'isValidTaskId rejects a traversal attempt');
  ok(store.isValidTaskId('orch-test-000001'), 'A well-formed slug is accepted');
})();

console.log('\n24. PATH SAFETY — the prompt path cannot escape the task directory');
(function () {
  ['../prompt.md', '/etc/passwd', 'sub/prompt.md', '..'].forEach(function (bad) {
    var threw = false;
    try { store.taskFile('orch-test-000001', bad); } catch (e) { threw = true; }
    ok(threw, 'taskFile refuses the prompt filename ' + JSON.stringify(bad));
  });
  var good = store.taskFile('orch-test-000001', 'prompt.md');
  ok(path.dirname(good) === store.taskDir('orch-test-000001'), 'A valid prompt path resolves inside the task directory');
})();

console.log('\n25. PATH SAFETY — the result path cannot escape the task directory');
(function () {
  ok(!runner.validateTask(baseTask({ result_path: '../result.json' })).valid, 'A traversing result_path is rejected by the schema');
  ok(!runner.validateTask(baseTask({ result_path: '/etc/passwd' })).valid, 'An absolute result_path is rejected by the schema');
  ok(!runner.validateTask(baseTask({ result_path: 'sub/result.json' })).valid, 'A nested result_path is rejected by the schema');
  var threw = false;
  try { store.taskFile('orch-test-000001', '../../escape.json'); } catch (e) { threw = true; }
  ok(threw, 'The store independently refuses a traversing result filename');
})();

console.log('\n26. SAFETY GATES — unsafe command classes require approval');
(function () {
  ['PRODUCTION_DEPLOYMENT', 'DNS_MUTATION', 'DESTRUCTIVE_DB', 'SECRET_ROTATION', 'AUTH', 'HIGH_RISK_INFRA'].forEach(function (c) {
    var t = baseTask({ risk_class: c, execution_level: 3 });
    var v = runner.validateTask(t);
    ok(!v.valid, c + ' can never be dispatched by the runner');
  });
  var prodMutation = router.route('CODE_IMPLEMENTATION', { allowProductionMutation: true });
  ok(prodMutation.decision === 'USER_APPROVAL_REQUIRED',
    'Requesting production mutation escalates even an implementation-class task to approval');
})();

console.log('\n27. SAFETY GATES — level 1 runs automatically');
(function () {
  var r = router.route('STATIC_ANALYSIS', { commitRequired: false, pushRequired: false });
  ok(r.execution_level === 1 && r.decision === 'CODEX', 'A read-only analysis task is level 1 and runs automatically');
  var t = baseTask({
    risk_class: 'STATIC_ANALYSIS', execution_level: 1,
    delivery: { commit_required: false, push_required: false, handover_required: false, tests_required: true }
  });
  ok(runner.validateTask(t).valid, 'A level 1 task validates for automatic execution');
  ok(codexProvider.sandboxForTask(t) === 'read-only', 'A level 1 non-committing task runs in the read-only sandbox');
})();

console.log('\n28. SAFETY GATES — level 2 is Claude-controlled');
(function () {
  var r = router.route('CODE_IMPLEMENTATION', { commitRequired: true, pushRequired: true });
  ok(r.execution_level === 2, 'Committing and pushing raises the task to level 2');
  ok(runner.validateTask(baseTask()).valid, 'A level 2 task validates');
  ok(!runner.validateTask(baseTask({ execution_level: 1 })).valid,
    'A task understating its execution level is rejected (declared level must match the router)');
  ok(codexProvider.sandboxForTask(baseTask()) === 'workspace-write',
    'A level 2 task runs in workspace-write, never danger-full-access');

  // Committing from a linked worktree requires the shared Git directory to
  // be writable; without it the sandbox denies every commit and the worker
  // correctly stops with approval_required.
  var stubPaths = { result: '/state/result.json', resultSchema: '/orch/result.schema.json' };
  var args = codexProvider.buildArgs(baseTask(), stubPaths, { addDirs: ['/home/deploy/projects/mythos-prod/.git'] });
  ok(args.indexOf('--add-dir') !== -1 &&
    args[args.indexOf('--add-dir') + 1] === '/home/deploy/projects/mythos-prod/.git',
    'A linked-worktree task grants the worker the shared Git directory');
  ok(args.join(' ').indexOf('danger-full-access') === -1, 'The adapter never requests danger-full-access');
  ok(args.join(' ').indexOf('--dangerously-bypass-approvals-and-sandbox') === -1,
    'The adapter never bypasses approvals or the sandbox');

  var noExtra = codexProvider.buildArgs(baseTask(), stubPaths, {});
  ok(noExtra.indexOf('--add-dir') === -1, 'No extra directory is granted when none is required');
})();

console.log('\n29. SAFETY GATES — level 3 never auto-executes');
(function () {
  var t = baseTask({ risk_class: 'PRODUCTION_DEPLOYMENT', execution_level: 3 });
  var v = runner.validateTask(t);
  ok(!v.valid, 'A level 3 task is refused by the runner');
  ok(v.errors.some(function (e) { return e.indexOf('LEVEL_3_NOT_AUTOMATIC') === 0 || e.indexOf('APPROVAL_REQUIRED') === 0; }),
    'The refusal cites the approval requirement');
  var out = runner.execute(t, { skipFetch: true });
  ok(out.dispatched === false && out.status === 'rejected', 'execute() never dispatches a level 3 task');
  var delegated = orchestrator.delegate(t, { skipFetch: true });
  ok(delegated.status === 'user_approval_required', 'delegate() escalates a level 3 task to the user');
  ok(!runner.validateTask(baseTask({ allow_production_mutation: true })).valid,
    'A task requesting production mutation is refused regardless of class');
})();

console.log('\n30. CONCURRENCY — an active task is never killed');
(function () {
  var src = fs.readFileSync(path.join(ORCH, 'orchestrator.js'), 'utf8');
  // Match the signal as it would actually be used (a quoted argument or a
  // numeric kill), not the bare word, which legitimately appears in the
  // comment explaining why force-killing is refused.
  ok(!/['"]SIGKILL['"]|kill\s+-9/.test(src), 'The orchestrator never sends SIGKILL');
  ok(/['"]SIGTERM['"]/.test(src), 'Cancellation is cooperative (SIGTERM only)');

  var res = orchestrator.cancelSafe('orch-logs-000001');
  ok(res.cancelled === false, 'cancel-safe refuses to signal a task that is not running');
  ok(String(res.reason).indexOf('NOT_RUNNING') === 0, 'The refusal explains that the task is not running');
  ok(orchestrator.cancelSafe('no-such-task-0001').cancelled === false, 'cancel-safe on an unknown task is a no-op');

  // A live foreign process must never be signalled via a stale status file.
  var st = store.readJSON('orch-logs-000001', 'status.json');
  ok(st.pid === null, 'A finished task records no live pid, so no foreign process can be signalled through it');
})();

console.log('\n31. PROHIBITED OPERATIONS — Jellyfin is never touched');
(function () {
  var sources = ['orchestrator.js', 'runner.js', 'router.js', 'verifier.js', 'notify.sh',
    'providers/codex.js', 'providers/claude.js', 'lib/git.js', 'lib/store.js'];
  var emits = sources.some(function (f) {
    var text = fs.readFileSync(path.join(ORCH, f), 'utf8');
    return /(?:systemctl|docker)\s+\w*\s*jellyfin/i.test(text);
  });
  ok(!emits, 'No orchestrator source constructs a Jellyfin command');
  ok(verifier.isProhibitedPath('config/jellyfin/system.xml'), 'A Jellyfin path is classified as prohibited by the verifier');
  var template = fs.readFileSync(path.join(ORCH, 'templates', 'codex-task.md'), 'utf8');
  ok(/Jellyfin/i.test(template), 'The delegated-task prompt explicitly forbids touching Jellyfin');
})();

console.log('\n32. PROHIBITED OPERATIONS — no Docker group mutation');
(function () {
  var sources = ['orchestrator.js', 'runner.js', 'router.js', 'verifier.js', 'notify.sh',
    'providers/codex.js', 'providers/claude.js', 'lib/git.js', 'lib/store.js'];
  var mutates = sources.some(function (f) {
    var text = fs.readFileSync(path.join(ORCH, f), 'utf8');
    return /usermod|gpasswd|groupadd|adduser\s+\w+\s+docker/i.test(text);
  });
  ok(!mutates, 'No orchestrator source mutates group membership');
  var template = fs.readFileSync(path.join(ORCH, 'templates', 'codex-task.md'), 'utf8');
  // Whitespace-tolerant: the prompt is prose and may wrap across lines.
  ok(/Docker\s+membership/i.test(template), 'The delegated-task prompt forbids changing Docker membership');
})();

console.log('\n33. LOGGING — credentials never reach disk');
(function () {
  // Labels name the KIND, never the value: test output is itself written to
  // task logs, and printing secret-shaped strings there defeats the purpose
  // (and trips any log scanner looking for exactly these patterns).
  var secrets = [
    { kind: 'a provider token', value: 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8' },
    { kind: 'a credentialed connection string', value: 'postgres://app:hunter2@db.internal:5432/mythos' },
    { kind: 'an assigned cloud secret', value: 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
    { kind: 'an ntfy capability URL', value: 'https://ntfy.sh/mythos-secret-topic-name' }
  ];
  secrets.forEach(function (s) {
    var out = redact.redact('log line containing ' + s.value + ' end');
    ok(out.indexOf(s.value) === -1, 'redact() masks ' + s.kind);
  });

  store.ensureTaskDir('orch-redact-00001');
  store.writeText('orch-redact-00001', 'stdout.log', 'token=' + secrets[0].value + '\n');
  var written = fs.readFileSync(store.taskFile('orch-redact-00001', 'stdout.log'), 'utf8');
  ok(written.indexOf('ghp_A1b2') === -1, 'Text written through the store is redacted on disk');

  store.writeJSON('orch-redact-00001', 'status.json', { summary: 'connect via ' + secrets[1].value });
  var json = fs.readFileSync(store.taskFile('orch-redact-00001', 'status.json'), 'utf8');
  ok(json.indexOf('hunter2') === -1, 'JSON written through the store is deep-redacted');

  ok(redact.findSecretKinds('nothing sensitive here').length === 0, 'Ordinary text is not flagged as secret');

  // The notification topic is a capability secret and is never committed.
  var notifySrc = fs.readFileSync(path.join(ORCH, 'notify.sh'), 'utf8');
  ok(!/https?:\/\/ntfy\.[A-Za-z0-9.-]+\/[A-Za-z0-9_-]+/.test(notifySrc),
    'notify.sh contains no hard-coded notification topic');
})();

console.log('\n34. DETERMINISM — task construction is deterministic');
(function () {
  var input = {
    task_id: 'determinism-00001', stage: 'MYTHOS-MULTI-AGENT-ORCHESTRATOR-0',
    created_at: '2026-08-12T00:00:00.000Z',
    working_directory: '/home/deploy/projects/worktrees/example',
    branch: 'agent/example/0001', baseline_commit: 'a'.repeat(40),
    objective: 'Deterministic construction check for the task envelope.',
    instructions: 'Produce an identical envelope on every call.',
    risk_class: 'CODE_IMPLEMENTATION',
    delivery: { commit_required: true, push_required: true, handover_required: false, tests_required: true }
  };
  var a = JSON.stringify(orchestrator.buildTask(input));
  var b = JSON.stringify(orchestrator.buildTask(input));
  ok(a === b, 'buildTask produces byte-identical JSON for identical input');
  ok(JSON.parse(a).execution_level === 2, 'The derived execution level is stable');
  ok(runner.validateTask(JSON.parse(a)).valid, 'The constructed envelope satisfies the task contract');
})();

console.log('\n35. DETERMINISM — routing is deterministic');
(function () {
  var classes = router.CLAUDE_CLASSES.concat(router.CODEX_CLASSES, router.APPROVAL_CLASSES);
  var stable = classes.every(function (c) {
    var first = JSON.stringify(router.route(c, { commitRequired: true }));
    for (var i = 0; i < 25; i++) {
      if (JSON.stringify(router.route(c, { commitRequired: true })) !== first) return false;
    }
    return true;
  });
  ok(stable, 'Every work class routes identically across repeated calls');

  var schemaClasses = JSON.parse(fs.readFileSync(path.join(ORCH, 'schemas', 'task.schema.json'), 'utf8'))
    .properties.risk_class.enum;
  ok(schemaClasses.length === classes.length && classes.every(function (c) { return schemaClasses.indexOf(c) !== -1; }),
    'The router and the task schema agree on the full set of work classes');
  ok(schemaLib.validate({ a: 1 }, { type: 'object', properties: {}, additionalProperties: false }).valid === false,
    'The schema validator rejects unexpected properties (contract strictness is real)');
})();

console.log('\n36. VERIFIER — a mismatched files_changed claim is rejected');
(function () {
  var repo = mkRepo('repo-files-mismatch', { second: true });
  var task = baseTask({
    working_directory: repo.dir, branch: 'work', baseline_commit: repo.sha,
    delivery: { commit_required: true, push_required: false, handover_required: false, tests_required: false }
  });
  var result = baseResult({
    branch: 'work', baseline: repo.sha,
    implementation_commit: repo.head,
    files_changed: ['not-the-real-file.md']
  });
  var ver = verifier.verify(task, result, { skipFetch: true });
  ok(!ver.verified, 'A files_changed claim that does not match the real diff never verifies');
  ok(ver.failures.some(function (f) { return f.indexOf('files_changed_matches_diff') === 0; }),
    'The verifier names the mismatched diff check');
})();

console.log('\n37. VERIFIER — a secret in the diff is caught regardless of the summary');
(function () {
  var repo = mkRepo('repo-secret-diff');
  var baseline = repo.head;
  fs.writeFileSync(path.join(repo.dir, 'config.env'), 'AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP\n');
  g(['add', 'config.env'], repo.dir);
  g(['commit', '--quiet', '-m', 'fixture: add config'], repo.dir);
  var implSha = g(['rev-parse', 'HEAD'], repo.dir);

  var task = baseTask({
    working_directory: repo.dir, branch: 'work', baseline_commit: baseline,
    delivery: { commit_required: true, push_required: false, handover_required: false, tests_required: false }
  });
  var result = baseResult({
    branch: 'work', baseline: baseline,
    implementation_commit: implSha,
    files_changed: ['config.env'],
    summary: 'Added configuration.'
  });
  var ver = verifier.verify(task, result, { skipFetch: true });
  ok(!ver.verified, 'A commit that introduces a credential-shaped string never verifies, even when the rest of the report is honest');
  ok(ver.failures.some(function (f) { return f.indexOf('no_secret_in_diff') === 0; }),
    'The verifier names the secret-in-diff check');
})();

console.log('\n38. VERIFIER — an implementation commit from unrelated history is rejected');
(function () {
  var repo = mkRepo('repo-unrelated-history');
  var baseline = repo.head;
  g(['checkout', '--quiet', '--orphan', 'unrelated'], repo.dir);
  fs.writeFileSync(path.join(repo.dir, 'other.md'), '# other\n');
  g(['add', 'other.md'], repo.dir);
  g(['commit', '--quiet', '-m', 'fixture: unrelated history'], repo.dir);
  var unrelatedSha = g(['rev-parse', 'HEAD'], repo.dir);

  var task = baseTask({
    working_directory: repo.dir, branch: 'work', baseline_commit: baseline,
    delivery: { commit_required: true, push_required: false, handover_required: false, tests_required: false }
  });
  var result = baseResult({
    branch: 'work', baseline: baseline,
    implementation_commit: unrelatedSha,
    files_changed: ['other.md']
  });
  var ver = verifier.verify(task, result, { skipFetch: true });
  ok(!ver.verified, 'A commit that does not descend from the declared baseline never verifies');
  ok(ver.failures.some(function (f) { return f.indexOf('baseline_is_ancestor_of_commit') === 0; }),
    'The verifier names the ancestry check');
})();

console.log('\n39. VERIFIER — a remote head that omits the implementation commit is rejected');
(function () {
  var bare = tmpdir('repo-push-bare.git');
  g(['init', '--quiet', '--bare', bare]);
  var repo = mkRepo('repo-push-work');
  g(['remote', 'add', 'origin', bare], repo.dir);
  g(['push', '--quiet', 'origin', 'work'], repo.dir);
  var realRemoteHead = g(['rev-parse', 'HEAD'], repo.dir); // what origin actually has

  fs.writeFileSync(path.join(repo.dir, 'second.md'), '# second\n');
  g(['add', 'second.md'], repo.dir);
  g(['commit', '--quiet', '-m', 'fixture: unpushed implementation'], repo.dir);
  var implSha = g(['rev-parse', 'HEAD'], repo.dir);

  var task = baseTask({
    working_directory: repo.dir, branch: 'work', baseline_commit: realRemoteHead,
    delivery: { commit_required: true, push_required: true, handover_required: false, tests_required: false }
  });
  var result = baseResult({
    branch: 'work', baseline: realRemoteHead,
    implementation_commit: implSha,
    remote_head: realRemoteHead, // honestly reports what origin actually has
    files_changed: ['second.md']
  });
  var ver = verifier.verify(task, result, { skipFetch: true });
  ok(!ver.verified, 'A claimed remote head that does not actually contain the implementation commit never verifies');
  ok(ver.failures.some(function (f) { return f.indexOf('commit_reachable_from_remote_head') === 0; }),
    'The verifier names the unreachable-commit check, catching a push that silently failed to deliver the real work');
})();

// ---------------------------------------------------------------------------
if (SAVED_HOME === undefined) { delete process.env.MYTHOS_ORCHESTRATOR_HOME; } else { process.env.MYTHOS_ORCHESTRATOR_HOME = SAVED_HOME; }
CLEANUP.forEach(function (d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* fixture cleanup is best effort */ }
});

console.log('\nStage MYTHOS-MULTI-AGENT-ORCHESTRATOR-0 orchestrator: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
