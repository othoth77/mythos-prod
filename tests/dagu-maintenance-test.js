'use strict';
// =====================================================
// MYTHOS — maintenance layer invariants + behaviour
// tests/dagu-maintenance-test.js
//
// EXEC-ARCH-0: recurring host maintenance (ff-only sync of the shared
// checkout, drift report, governed executor restart, task-worktree GC) is
// expressed as pinned Dagu DAGs (ops/dagu/maintenance/*.yaml) over three
// small shell tools (ops/dagu/bin/*), not as a bespoke reconciler + timer.
// This suite holds the DAG files to the security boundary and exercises the
// tools against a throwaway repository. It needs git and bash only; when
// MYTHOS_DAGU_BIN names a Dagu binary the DAGs are also dry-validated by it.
// =====================================================
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');

var ROOT = path.join(__dirname, '..');
var DAGS = path.join(ROOT, 'ops', 'dagu', 'maintenance');
var BIN = path.join(ROOT, 'ops', 'dagu', 'bin');
var pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e)); } }
function sh(cmd, opts) {
  var r = cp.spawnSync('bash', ['-c', cmd], Object.assign({ encoding: 'utf8' }, opts || {}));
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}
function json(s) { return JSON.parse(String(s).trim().split('\n').pop()); }
function lines(s) { return String(s).trim().split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); }); }

// ---------- static invariants over the DAG files ----------
var dagFiles = fs.readdirSync(DAGS).filter(function (f) { return /\.ya?ml$/.test(f); }).sort();
var dagText = {}; dagFiles.forEach(function (f) { dagText[f] = fs.readFileSync(path.join(DAGS, f), 'utf8'); });

t('exactly the five maintenance DAGs exist', function () {
  assert.deepStrictEqual(dagFiles, ['drift-check.yaml', 'executor-restart.yaml', 'git-sync-main.yaml', 'status-center-review.yaml', 'worktree-gc.yaml']);
});
t('every DAG: chain type, single-run queue, timeout, resource-guard FIRST step, snake_case keys', function () {
  dagFiles.forEach(function (f) {
    var s = dagText[f];
    assert.ok(/^type: chain$/m.test(s), f + ' type chain');
    assert.ok(/^queue: mythos-maintenance$/m.test(s), f + ' queue');
    assert.ok(/^max_active_runs: 1$/m.test(s), f + ' max_active_runs 1');
    assert.ok(/^timeout_sec: \d+$/m.test(s), f + ' timeout');
    var firstStep = /^steps:\n  - name: ([a-z-]+)/m.exec(s);
    assert.ok(firstStep && firstStep[1] === 'resource-guard', f + ' first step is resource-guard');
    assert.ok(/mythos-resource-guard" status/.test(s) && /"admit"/.test(s), f + ' resource-guard uses admit');
    assert.ok(!/maxActiveRuns|timeoutSec|retryPolicy|intervalSec|exitCode/.test(s), f + ' no camelCase keys (Dagu 2.16 rejects them)');
  });
});
t('no DAG can escalate or destroy: no sudo, docker, --force, reset, clean, rebase, stash, rm -rf, branch -D, push', function () {
  var banned = [/\bsudo\b/, /\bdocker\b/, /--force/, /\bgit\b[^\n]*\breset\b/, /\bgit\b[^\n]*\bclean\b/, /\brebase\b/, /\bstash\b/, /rm -rf/, /branch -D/, /\bgit\b[^\n]*\bpush\b/, /nginx/, /user@1001/];
  dagFiles.forEach(function (f) { var code = dagText[f].replace(/^\s*#.*$/mg, ''); banned.forEach(function (re) { assert.ok(!re.test(code), f + ' must not match ' + re); }); });
});
t('no DAG carries a secret shape or a credential path', function () {
  dagFiles.forEach(function (f) {
    assert.ok(!/(ghp_|gho_|github_pat_|sk-ant-|AKIA[0-9A-Z]{12}|BEGIN [A-Z ]*PRIVATE KEY|password\s*[:=])/i.test(dagText[f]), f);
    assert.ok(!/\.env\b|\.ssh\b|sudoers|secrets?:/.test(dagText[f]), f + ' names no credential file / secrets block');
  });
});
t('git-sync-main: scheduled, ff-only tool, apply only behind the owner marker', function () {
  var s = dagText['git-sync-main.yaml'];
  assert.ok(/^schedule: "\*\/5 \* \* \* \*"$/m.test(s), 'every 5 min');
  assert.ok(/mythos-git-sync" "\$REPO" \$\( \[ -f "\$MARKER" \] && echo --apply \)/.test(s), 'apply flag derived from the marker only');
  assert.ok(/MARKER: \/home\/deploy\/mythos-ai-executor\/maintenance\/sync\.enabled/.test(s), 'marker path');
  assert.ok(!/--apply\s*$/m.test(s), 'no unconditional --apply');
});
t('executor-restart: NOT scheduled; guard → no running task → drift gate → approval → approval-verify → restart → verify, in that order', function () {
  var s = dagText['executor-restart.yaml'];
  assert.ok(!/^schedule:/m.test(s), 'a restart is never timer-driven');
  var names = []; s.replace(/^  - name: ([a-z-]+)$/mg, function (_, n) { names.push(n); });
  assert.deepStrictEqual(names, ['resource-guard', 'no-running-task', 'restart-required', 'plan', 'approval-verify', 'restart', 'verify']);
  assert.ok(/--require-restart/.test(s), 'gate exits non-zero unless EXECUTOR_RESTART_REQUIRED');
  var planIdx = s.indexOf('- name: plan'), approvalIdx = s.indexOf('approval:'), restartIdx = s.indexOf('- name: restart\n');
  assert.ok(planIdx < approvalIdx && approvalIdx < restartIdx, 'approval sits on the plan step BEFORE the restart step (Dagu runs a step, then pauses)');
  assert.ok(/required: \[approval_ref\]/.test(s), 'approval_ref is required input');
  assert.ok(/systemctl --user restart mythos-ai-executor\.service/.test(s), 'restarts the deploy user unit only');
  assert.strictEqual((s.replace(/^\s*#.*$/mg, '').match(/^\s*run: .*systemctl/mg) || []).length, 1, 'exactly one systemctl step');
  assert.ok(/--wait-current 90/.test(s), 'verifies identity after restart');
  assert.ok(/"CRITICAL"/.test(s), 'restart refuses under CRITICAL explicitly');
});
t('executor-restart: the Dagu step approval is not the authorisation — approval-verify sits between it and systemctl', function () {
  var s = dagText['executor-restart.yaml'];
  var verifyIdx = s.indexOf('- name: approval-verify'), restartIdx = s.indexOf('- name: restart\n');
  assert.ok(verifyIdx > s.indexOf('approval:') && verifyIdx < restartIdx,
    'approval_ref is verified after the gate and before the restart');
  var verifyRun = /^  - name: approval-verify\n    run: (.+)$/m.exec(s);
  assert.ok(verifyRun, 'approval-verify has a run command');
  assert.ok(/mythos-restart-approval" verify "\$approval_ref"/.test(verifyRun[1]), 'verifies the operator-supplied ref itself');
  assert.ok(/--repo "\$REPO"/.test(verifyRun[1]), 'binds the approval to the checkout the restart targets');
  assert.ok(/--consume/.test(verifyRun[1]), 'one approval buys one restart attempt');
  // The restart step must not be able to re-derive authorisation from the raw input.
  var restartRun = /^  - name: restart\n    run: (.+)$/m.exec(s);
  assert.ok(restartRun && !/\$approval_ref/.test(restartRun[1]), 'the restart step consumes no operator input');
});
t('worktree-gc: bounded (max 5, min age 24 h, mythos/gh/ namespace), apply only behind the owner marker', function () {
  var s = dagText['worktree-gc.yaml'];
  assert.ok(/--max 5 --min-age-hours 24 --namespace mythos\/gh\//.test(s));
  assert.ok(/\$\( \[ -f "\$MARKER" \] && echo --apply \)/.test(s));
  assert.ok(/worktrees\.enabled/.test(s));
});
t('status-center-review is read-only, daily, and calls only the check tool with a served URL', function () {
  var s = dagText['status-center-review.yaml'].replace(/^\s*#.*$/mg, '');
  assert.ok(/^schedule: "17 5 \* \* \*"$/m.test(s), 'daily schedule');
  assert.ok(/mythos-status-center-check" "\$REPO" --served "\$SERVED"/.test(s), 'second step is the check tool');
  assert.ok(!/--apply|deploy-status-center|review\.js|persist|rsync|systemctl|merge/.test(s), 'never persists, publishes or mutates');
  var f = path.join(BIN, 'mythos-status-center-check');
  var code = fs.readFileSync(f, 'utf8').replace(/^\s*#.*$/mg, '');
  assert.ok(/--dry-run --json/.test(code), 'the tool runs the review engine in dry-run only');
  assert.ok(!/--force|reset --hard|git clean|\bstash\b|rm -rf|branch -D|\bdocker\b|systemctl|rsync/.test(code), 'the tool never mutates');
  assert.ok(!/^\s*(sudo\s+)?(bash\s+)?(scripts\/)?deploy-status-center\.sh/m.test(code) && !/^\s*sudo\b/m.test(code), 'the tool never invokes the publish script or sudo (it only names them in its hint)');
  assert.ok((fs.statSync(f).mode & 0o111) !== 0, 'executable');
});
t('drift-check is read-only (no tool flag that mutates)', function () {
  var s = dagText['drift-check.yaml'];
  assert.ok(!/--apply|systemctl|merge/.test(s));
});
t('mythos-restart-approval: no destructive verb, no privilege escalation, no restart of its own', function () {
  var f = path.join(BIN, 'mythos-restart-approval');
  var code = fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/mg, '');
  assert.ok(!/--force|reset --hard|git clean|\bstash\b|rm -rf|branch -D|\bsudo\b|\bdocker\b|systemctl/.test(code),
    'the approval check never mutates anything and never restarts anything itself');
  assert.ok(/core\.hooksPath=\/var\/empty/.test(code), 'its one git call runs with hooks disabled');
  assert.ok((fs.statSync(f).mode & 0o111) !== 0, 'executable');
});
t('the tools themselves never contain a destructive git verb', function () {
  ['mythos-git-sync', 'mythos-drift-check', 'mythos-worktree-gc'].forEach(function (b) {
    var s = fs.readFileSync(path.join(BIN, b), 'utf8');
    assert.ok(!/--force|reset --hard|git clean|\brebase\b(?!-merge|-apply)|\bstash\b|rm -rf|branch -D|\bpush\b|\bsudo\b|\bdocker\b/.test(s.replace(/^\s*#.*$/mg, '')), b);
    assert.ok(/set -u/.test(s) && /core\.hooksPath=\/var\/empty/.test(s), b + ' hooks disabled, unset vars fatal');
    assert.ok((fs.statSync(path.join(BIN, b)).mode & 0o111) !== 0, b + ' executable');
  });
  assert.ok(/merge --ff-only/.test(fs.readFileSync(path.join(BIN, 'mythos-git-sync'), 'utf8')));
  assert.ok(/worktree remove "\$wt"/.test(fs.readFileSync(path.join(BIN, 'mythos-worktree-gc'), 'utf8')) && /branch -d "\$br"/.test(fs.readFileSync(path.join(BIN, 'mythos-worktree-gc'), 'utf8')));
});

// ---------- behaviour against a throwaway repository ----------
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-maint-'));
var ENV = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', HOME: TMP });
function git(cwd, args) { var r = cp.spawnSync('git', args, { cwd: cwd, encoding: 'utf8', env: ENV }); if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr); return String(r.stdout).trim(); }
var ORIGIN = path.join(TMP, 'origin.git'), CO = path.join(TMP, 'co'), OTHER = path.join(TMP, 'other');
git(TMP, ['init', '-q', '--bare', '-b', 'main', 'origin.git']);
git(TMP, ['clone', '-q', ORIGIN, 'co']); git(CO, ['checkout', '-q', '-b', 'main']);
fs.writeFileSync(path.join(CO, 'a'), 'a'); git(CO, ['add', 'a']); git(CO, ['commit', '-qm', 'one']); git(CO, ['push', '-q', 'origin', 'main']);
git(TMP, ['clone', '-q', ORIGIN, 'other']);
fs.writeFileSync(path.join(OTHER, 'b'), 'b'); git(OTHER, ['add', 'b']); git(OTHER, ['commit', '-qm', 'two']); git(OTHER, ['push', '-q', 'origin', 'main']);
var SYNC = path.join(BIN, 'mythos-git-sync'), DRIFT = path.join(BIN, 'mythos-drift-check'), GC = path.join(BIN, 'mythos-worktree-gc');

t('git-sync: dry-run reports WOULD_FAST_FORWARD and changes nothing', function () {
  var before = git(CO, ['rev-parse', 'HEAD']);
  var r = sh('"' + SYNC + '" "' + CO + '"', { env: ENV }); assert.strictEqual(r.code, 0, r.err);
  var j = json(r.out); assert.strictEqual(j.result, 'WOULD_FAST_FORWARD'); assert.strictEqual(j.apply, 0);
  assert.strictEqual(git(CO, ['rev-parse', 'HEAD']), before);
});
t('git-sync --apply: fast-forwards, HEAD verified equal to origin/main; second run is ALREADY_SYNCHRONIZED', function () {
  var r = sh('"' + SYNC + '" "' + CO + '" --apply', { env: ENV }); assert.strictEqual(r.code, 0, r.err);
  var j = json(r.out); assert.strictEqual(j.result, 'FAST_FORWARD'); assert.strictEqual(j.target, git(CO, ['rev-parse', 'origin/main'])); assert.strictEqual(git(CO, ['rev-parse', 'HEAD']), j.target);
  var r2 = sh('"' + SYNC + '" "' + CO + '" --apply', { env: ENV }); assert.strictEqual(json(r2.out).result, 'ALREADY_SYNCHRONIZED');
});
t('git-sync blocks (exit 2, nothing changed) on dirty tree, wrong branch, in-progress merge, local-ahead, diverged', function () {
  fs.appendFileSync(path.join(CO, 'a'), 'x');
  var r = sh('"' + SYNC + '" "' + CO + '" --apply', { env: ENV }); assert.strictEqual(r.code, 2); assert.strictEqual(json(r.out).code, 'DIRTY_CHECKOUT');
  git(CO, ['checkout', '-q', 'a']);
  git(CO, ['checkout', '-q', '-b', 'feature']);
  r = sh('"' + SYNC + '" "' + CO + '" --apply', { env: ENV }); assert.strictEqual(json(r.out).code, 'WRONG_BRANCH');
  git(CO, ['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(CO, '.git', 'MERGE_HEAD'), git(CO, ['rev-parse', 'HEAD']) + '\n');
  r = sh('"' + SYNC + '" "' + CO + '" --apply', { env: ENV }); assert.strictEqual(json(r.out).code, 'GIT_OPERATION_IN_PROGRESS');
  fs.unlinkSync(path.join(CO, '.git', 'MERGE_HEAD'));
  fs.writeFileSync(path.join(CO, 'c'), 'c'); git(CO, ['add', 'c']); git(CO, ['commit', '-qm', 'local']);
  var head = git(CO, ['rev-parse', 'HEAD']);
  r = sh('"' + SYNC + '" "' + CO + '" --apply', { env: ENV }); assert.strictEqual(r.code, 2); assert.strictEqual(json(r.out).code, 'LOCAL_AHEAD');
  fs.writeFileSync(path.join(OTHER, 'd'), 'd'); git(OTHER, ['add', 'd']); git(OTHER, ['commit', '-qm', 'remote2']); git(OTHER, ['push', '-q', 'origin', 'main']);
  r = sh('"' + SYNC + '" "' + CO + '" --apply', { env: ENV }); assert.strictEqual(r.code, 2); assert.strictEqual(json(r.out).code, 'DIVERGED');
  assert.strictEqual(git(CO, ['rev-parse', 'HEAD']), head, 'nothing moved');
});
t('git-sync refuses a bad path and a missing argument', function () {
  assert.strictEqual(sh('"' + SYNC + '"', { env: ENV }).code, 64);
  var r = sh('"' + SYNC + '" "' + TMP + '/nope" --apply', { env: ENV }); assert.strictEqual(r.code, 2); assert.strictEqual(json(r.out).code, 'WRONG_REPOSITORY');
});

// drift-check against a controllable /health served by a CHILD process (the
// tools are invoked synchronously, so an in-process server could never answer).
// The child re-reads HEALTH_FILE on every request; tests rewrite that file.
var HEALTH_FILE = path.join(TMP, 'health.json');
function setHealth(ci) { fs.writeFileSync(HEALTH_FILE, JSON.stringify({ ok: true, checks: { queue: { RUNNING: 0 } }, code_identity: ci })); }
setHealth(null);
var PORT_FILE = path.join(TMP, 'health.port');
var server = cp.spawn(process.execPath, ['-e', "var fs=require('fs');var s=require('http').createServer(function(q,r){r.writeHead(200,{'Content-Type':'application/json'});r.end(fs.readFileSync(process.argv[1]))});s.listen(0,'127.0.0.1',function(){fs.writeFileSync(process.argv[2],String(s.address().port))})", HEALTH_FILE, PORT_FILE], { stdio: 'ignore' });
var PORT = (function waitUp() { for (var i = 0; i < 100; i++) { try { var p = parseInt(fs.readFileSync(PORT_FILE, 'utf8'), 10); if (p > 0 && cp.spawnSync('curl', ['-sf', '-m', '1', 'http://127.0.0.1:' + p + '/health']).status === 0) return p; } catch (e) { /* not yet */ } cp.spawnSync('sleep', ['0.1']); } throw new Error('health child did not start'); })();
rest('http://127.0.0.1:' + PORT + '/health');

function rest(healthUrl) {
var CODE = git(CO, ['rev-parse', 'HEAD']);

t('drift-check: executor without code_identity is EXECUTOR_UNVERIFIED (never CURRENT); --require-restart exits 4', function () {
  var r = sh('"' + DRIFT + '" "' + CO + '" --no-fetch --health ' + healthUrl, { env: ENV }); assert.strictEqual(r.code, 0);
  assert.strictEqual(json(r.out).state, 'EXECUTOR_UNVERIFIED'); assert.strictEqual(json(r.out).code_vs_source, 'CODE_DIVERGED');
  assert.strictEqual(sh('"' + DRIFT + '" "' + CO + '" --no-fetch --health ' + healthUrl + ' --require-restart', { env: ENV }).code, 4);
  assert.strictEqual(json(sh('"' + DRIFT + '" "' + CO + '" --no-fetch --health http://127.0.0.1:1/health', { env: ENV }).out).state, 'EXECUTOR_UNVERIFIED', 'dead executor');
});
t('drift-check: identity equal → code relation; different → EXECUTOR_RESTART_REQUIRED (gate exit 0); unverified identity ignored', function () {
  setHealth({ head: CODE, verified: true });
  var j = json(sh('"' + DRIFT + '" "' + CO + '" --no-fetch --health ' + healthUrl, { env: ENV }).out);
  assert.strictEqual(j.state, 'CODE_DIVERGED'); assert.strictEqual(j.executor, CODE);
  setHealth({ head: 'f'.repeat(40), verified: true });
  var r = sh('"' + DRIFT + '" "' + CO + '" --no-fetch --health ' + healthUrl + ' --require-restart', { env: ENV });
  assert.strictEqual(r.code, 0); assert.strictEqual(json(r.out).state, 'EXECUTOR_RESTART_REQUIRED');
  setHealth({ head: CODE, verified: false, reason: 'x' });
  assert.strictEqual(json(sh('"' + DRIFT + '" "' + CO + '" --no-fetch --health ' + healthUrl, { env: ENV }).out).state, 'EXECUTOR_UNVERIFIED');
});
t('drift-check --wait-current: returns 0 once the executor reports CODE, 5 on timeout', function () {
  setHealth({ head: CODE, verified: true });
  // generous window on the success path (returns as soon as the identity matches; a loaded host can need seconds per probe),
  // minimal window on the timeout path (a non-matching identity can never succeed)
  assert.strictEqual(sh('"' + DRIFT + '" "' + CO + '" --no-fetch --health ' + healthUrl + ' --wait-current 60', { env: ENV }).code, 0);
  setHealth({ head: 'e'.repeat(40), verified: true });
  var r = sh('"' + DRIFT + '" "' + CO + '" --no-fetch --health ' + healthUrl + ' --wait-current 1', { env: ENV });
  assert.strictEqual(r.code, 5); assert.strictEqual(json(r.out).state, 'EXECUTOR_RESTART_REQUIRED');
});
t('drift-check: CURRENT when source == code == executor', function () {
  git(CO, ['fetch', '-q', 'origin']);
  var src = git(CO, ['rev-parse', 'origin/main']);
  git(CO, ['reset', '-q', '--hard', src]); // test fixture only
  setHealth({ head: src, verified: true });
  assert.strictEqual(json(sh('"' + DRIFT + '" "' + CO + '" --no-fetch --health ' + healthUrl, { env: ENV }).out).state, 'CURRENT');
});

// worktree-gc
t('worktree-gc: classifies primary / merged-unused / unmerged / foreign namespace / dirty / too recent; dry-run removes nothing', function () {
  git(CO, ['worktree', 'add', '-q', '-b', 'mythos/gh/gh-issue-1', path.join(TMP, 'wt1'), 'origin/main']);
  git(CO, ['worktree', 'add', '-q', '-b', 'mythos/gh/gh-issue-2', path.join(TMP, 'wt2'), 'origin/main']);
  git(CO, ['worktree', 'add', '-q', '-b', 'other/x', path.join(TMP, 'wt3'), 'origin/main']);
  git(CO, ['worktree', 'add', '-q', '-b', 'mythos/gh/gh-issue-4', path.join(TMP, 'wt4'), 'origin/main']);
  git(CO, ['worktree', 'add', '-q', '-b', 'mythos/gh/gh-issue-5', path.join(TMP, 'wt5'), 'origin/main']);
  fs.writeFileSync(path.join(TMP, 'wt2', 'z'), 'z'); git(path.join(TMP, 'wt2'), ['add', 'z']); git(path.join(TMP, 'wt2'), ['commit', '-qm', 'unique']);
  fs.writeFileSync(path.join(TMP, 'wt4', 'untracked'), 'u');
  var rows = lines(sh('"' + GC + '" "' + CO + '" --no-fetch --min-age-hours 0', { env: ENV }).out);
  var by = {}; rows.forEach(function (r) { if (r.branch) by[r.branch] = r; });
  assert.strictEqual(by['main'].reason, 'PRIMARY_CHECKOUT');
  assert.strictEqual(by['mythos/gh/gh-issue-1'].decision, 'WOULD_REMOVE');
  assert.strictEqual(by['mythos/gh/gh-issue-2'].reason, 'NOT_MERGED');
  assert.strictEqual(by['other/x'].reason, 'NOT_TASK_NAMESPACE');
  assert.strictEqual(by['mythos/gh/gh-issue-4'].reason, 'DIRTY');
  var recent = lines(sh('"' + GC + '" "' + CO + '" --no-fetch --min-age-hours 1', { env: ENV }).out);
  assert.ok(recent.every(function (r) { return r.decision !== 'WOULD_REMOVE' && r.decision !== 'REMOVED'; }), 'nothing removable when younger than min age');
  assert.strictEqual(git(CO, ['worktree', 'list']).split('\n').length, 6, 'dry-run removed nothing');
});
t('worktree-gc --apply: removes only safe worktrees, respects --max, deletes the local branch with -d, never the remote', function () {
  var rows = lines(sh('"' + GC + '" "' + CO + '" --no-fetch --min-age-hours 0 --apply --max 1', { env: ENV }).out);
  var removed = rows.filter(function (r) { return r.decision === 'REMOVED'; });
  assert.strictEqual(removed.length, 1, 'max 1 honoured'); assert.strictEqual(rows.pop().removable, 2);
  var rows2 = lines(sh('"' + GC + '" "' + CO + '" --no-fetch --min-age-hours 0 --apply', { env: ENV }).out);
  assert.strictEqual(rows2.filter(function (r) { return r.decision === 'REMOVED'; }).length, 1);
  var wts = git(CO, ['worktree', 'list']);
  assert.ok(wts.indexOf('wt1') === -1 && wts.indexOf('wt5') === -1 && wts.indexOf('wt2') !== -1 && wts.indexOf('wt3') !== -1 && wts.indexOf('wt4') !== -1);
  var branches = git(CO, ['branch', '--list', 'mythos/gh/*']);
  assert.ok(branches.indexOf('gh-issue-1') === -1 && branches.indexOf('gh-issue-5') === -1 && branches.indexOf('gh-issue-2') !== -1);
  assert.strictEqual(git(OTHER, ['ls-remote', '--heads', 'origin']).split('\n').length, 1, 'remote untouched (main only)');
});
t('worktree-gc: a worktree that is a same-user process cwd is IN_USE', function () {
  var wt = path.join(TMP, 'wt3'); git(CO, ['branch', '-m', 'other/x', 'mythos/gh/gh-issue-3']);
  var child = cp.spawn('sleep', ['30'], { cwd: wt, stdio: 'ignore' });
  try {
    // spawn() returns before the child has chdir'ed; under host load the GC's
    // /proc scan can run first and see no cwd inside wt. Wait for the child to
    // actually sit in the worktree before scanning (bounded, ~5 s).
    var want = fs.realpathSync(wt), deadline = Date.now() + 5000, seen = null;
    while (Date.now() < deadline) {
      try { seen = fs.readlinkSync('/proc/' + child.pid + '/cwd'); } catch (e) { seen = null; }
      if (seen === want) break;
      cp.spawnSync('sleep', ['0.05']);
    }
    assert.strictEqual(seen, want, 'child process never reached cwd ' + want);
    var rows = lines(sh('"' + GC + '" "' + CO + '" --no-fetch --min-age-hours 0', { env: ENV }).out);
    var row = rows.filter(function (r) { return r.branch === 'mythos/gh/gh-issue-3'; })[0];
    assert.strictEqual(row.reason, 'IN_USE');
  } finally { child.kill(); }
});

// executor reports its own identity
t('executor GET /health carries code_identity measured from its own checkout', function () {
  process.env.MYTHOS_EXECUTOR_HOME = path.join(TMP, 'exec-home'); process.env.MYTHOS_RESOURCE_GUARD = 'off';
  var ex = require(path.join(ROOT, 'projects', 'mythos-ai-executor', 'executor'));
  var ci = ex.codeIdentity();
  assert.ok(ci && ci.verified === true, JSON.stringify(ci));
  assert.strictEqual(ci.head, git(ROOT, ['rev-parse', 'HEAD']));
  assert.strictEqual(ci.checkout, git(ROOT, ['rev-parse', '--show-toplevel']));
  assert.ok(ci.pid === process.pid && typeof ci.started_at === 'string');
});

// ---------- approval validation: the restart is authorised by a RECORD, not a string ----------
// GH #161 / EXEC-ARCH-0 follow-up. Every case runs against a throwaway executor
// approval store; nothing here touches the real store, and no service is restarted.
var APPROVAL = path.join(BIN, 'mythos-restart-approval');
var AP_HOME = path.join(TMP, 'approval-home');
var AP_DIR = path.join(AP_HOME, 'orchestration', 'approvals');
var TARGET = git(CO, ['rev-parse', 'HEAD']);
var apSeq = 0;

function ra(args) {
  return sh('node "' + APPROVAL + '" ' + args, { env: Object.assign({}, ENV, { MYTHOS_EXECUTOR_HOME: AP_HOME }) });
}
// A verify run exactly as the DAG issues it.
function verifyRef(ref, extra) {
  return ra('verify "' + ref + '" --repo "' + CO + '" --home "' + AP_HOME + '"' + (extra || ''));
}
// Fixture approvals for the states the lifecycle API cannot reach directly
// (expired, consumed, automated decider, foreign action class).
function putApproval(fields) {
  var id = 'ap-' + (Date.now().toString(36) + '0000').slice(0, 10) + '-' + ('f' + (apSeq++)).padStart(6, '0');
  var rec = Object.assign({
    id: id, entity_type: 'approval', status: 'GRANTED', created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), correlation_id: id, parent_id: null, project: 'mythos-prod',
    metadata: {}, subject_id: TARGET, action_class: 'hostops:executor.restart',
    reason: 'fixture', decided_by: 'Othman Haddad', decided_at: new Date().toISOString()
  }, fields || {});
  fs.mkdirSync(AP_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(AP_DIR, id + '.json'), JSON.stringify(rec, null, 2) + '\n', { mode: 0o600 });
  return id;
}

t('approval 1/6: a requested + human-granted approval for THIS head authorises the restart, once', function () {
  var req = ra('request --repo "' + CO + '" --home "' + AP_HOME + '" --reason "executor is behind the checkout head"');
  assert.strictEqual(req.code, 0, req.err);
  var reqJson = json(req.out);
  assert.strictEqual(reqJson.result, 'REQUESTED');
  assert.strictEqual(reqJson.subject, TARGET);
  assert.strictEqual(reqJson.action, 'hostops:executor.restart');
  // PENDING is not authorisation.
  var pending = verifyRef(reqJson.approval);
  assert.strictEqual(pending.code, 3); assert.strictEqual(json(pending.out).code, 'APPROVAL_NOT_GRANTED');

  var granted = ra('grant ' + reqJson.approval + ' --by "Othman Haddad"');
  assert.strictEqual(granted.code, 0, granted.err);
  assert.strictEqual(json(granted.out).result, 'GRANTED');

  var ok = verifyRef(reqJson.approval, ' --consume');
  assert.strictEqual(ok.code, 0, ok.err);
  var okJson = json(ok.out);
  assert.strictEqual(okJson.result, 'AUTHORIZED');
  assert.strictEqual(okJson.approval, reqJson.approval);
  assert.strictEqual(okJson.subject, TARGET);
  assert.ok(okJson.consumed, 'the approval is stamped consumed before the restart runs');

  // 5/6 (consumed): one approval, one attempt.
  var again = verifyRef(reqJson.approval, ' --consume');
  assert.strictEqual(again.code, 3); assert.strictEqual(json(again.out).code, 'APPROVAL_CONSUMED');
});
t('approval 2/6: a missing approval_ref is rejected', function () {
  var empty = verifyRef('');
  assert.strictEqual(empty.code, 3); assert.strictEqual(json(empty.out).code, 'APPROVAL_REF_MALFORMED');
});
t('approval 3/6: an arbitrary/fake ref is rejected before it can reach the store', function () {
  ['APP-FAKE', 'PR-159', '159', 'ap-' + '../'.repeat(3) + 'etc', 'ap-aaaaaa-bbbb; touch /tmp/pwned'].forEach(function (ref) {
    var r = verifyRef(ref);
    assert.strictEqual(r.code, 3, ref + ' must be rejected');
    assert.strictEqual(json(r.out).code, 'APPROVAL_REF_MALFORMED', ref);
  });
  // Well-shaped but nonexistent is still a refusal, never a default-allow.
  var unknown = verifyRef('ap-zzzzzzzz-999999');
  assert.strictEqual(unknown.code, 3); assert.strictEqual(json(unknown.out).code, 'APPROVAL_UNKNOWN');
});
t('approval 4/6: an approval for another action or another subject does not authorise this restart', function () {
  var otherAction = putApproval({ action_class: 'mcp:github.pull_request' });
  var r1 = verifyRef(otherAction);
  assert.strictEqual(r1.code, 3); assert.strictEqual(json(r1.out).code, 'APPROVAL_WRONG_ACTION');

  var otherSubject = putApproval({ subject_id: 'a'.repeat(40) });
  var r2 = verifyRef(otherSubject);
  assert.strictEqual(r2.code, 3); assert.strictEqual(json(r2.out).code, 'APPROVAL_WRONG_SUBJECT');

  // …and this tool cannot be used to decide a foreign approval either.
  var g = ra('grant ' + otherAction + ' --by "Othman Haddad"');
  assert.strictEqual(g.code, 3); assert.strictEqual(json(g.out).code, 'APPROVAL_WRONG_ACTION');
});
t('approval 5/6: denied, revoked, expired and non-human decisions are all rejected', function () {
  var denied = putApproval({ status: 'DENIED' });
  assert.strictEqual(json(verifyRef(denied).out).code, 'APPROVAL_NOT_GRANTED');

  var toRevoke = putApproval({});
  var rv = ra('revoke ' + toRevoke + ' --by "Othman Haddad"');
  assert.strictEqual(rv.code, 0, rv.err); assert.strictEqual(json(rv.out).result, 'REVOKED');
  var rvr = verifyRef(toRevoke);
  assert.strictEqual(rvr.code, 3); assert.strictEqual(json(rvr.out).code, 'APPROVAL_REVOKED');

  var old = putApproval({ decided_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() });
  var oldr = verifyRef(old);
  assert.strictEqual(oldr.code, 3); assert.strictEqual(json(oldr.out).code, 'APPROVAL_EXPIRED');
  assert.strictEqual(verifyRef(old, ' --max-age-hours 48').code, 0, 'the window is a stated bound, not a hidden one');

  var undated = putApproval({ decided_at: null });
  assert.strictEqual(json(verifyRef(undated).out).code, 'APPROVAL_UNDATED');

  ['mythos-autopilot', 'claude', 'dagu', 'x'].forEach(function (name) {
    var bot = putApproval({ decided_by: name });
    var r = verifyRef(bot);
    assert.strictEqual(r.code, 3, name); assert.strictEqual(json(r.out).code, 'APPROVAL_NEEDS_HUMAN', name);
  });
  // The grant path refuses an automated decider up front (usage error).
  var req = json(ra('request --repo "' + CO + '" --home "' + AP_HOME + '" --reason "another restart request"').out);
  assert.strictEqual(ra('grant ' + req.approval + ' --by "mythos-autopilot"').code, 64);
  assert.strictEqual(json(verifyRef(req.approval).out).code, 'APPROVAL_NOT_GRANTED', 'still undecided');
});
t('approval: fails CLOSED when the subject or the store cannot be measured', function () {
  var noRepo = ra('verify ap-zzzzzzzz-999999 --repo "' + path.join(TMP, 'not-a-repo') + '" --home "' + AP_HOME + '"');
  assert.strictEqual(noRepo.code, 1, 'an unmeasurable HEAD is a tool error, never an authorisation');
  assert.strictEqual(json(noRepo.out).code, 'SUBJECT_UNVERIFIED');
  var noStore = ra('verify ap-zzzzzzzz-999999 --repo "' + CO + '" --home "' + path.join(TMP, 'no-store') + '"');
  assert.strictEqual(noStore.code, 3); assert.strictEqual(json(noStore.out).code, 'APPROVAL_UNKNOWN');
  assert.strictEqual(ra('verify ap-zzzzzzzz-999999 --home "' + AP_HOME + '"').code, 64, 'verify without --repo is a usage error');
});
t('approval 6/6: with an invalid ref the DAG chain never reaches systemctl (stubbed)', function () {
  // The two run commands are taken from the DAG file itself and executed in
  // chain order against a stub `systemctl`, so this asserts the shipped YAML.
  var s = dagText['executor-restart.yaml'];
  var verifyRun = /^  - name: approval-verify\n    run: (.+)$/m.exec(s)[1];
  var restartRun = /^  - name: restart\n    run: (.+)$/m.exec(s)[1];
  var stubDir = path.join(TMP, 'stub-bin');
  var marker = path.join(TMP, 'systemctl-called');
  fs.mkdirSync(stubDir, { recursive: true });
  fs.writeFileSync(path.join(stubDir, 'systemctl'), '#!/bin/sh\necho "$@" >> "' + marker + '"\n', { mode: 0o755 });

  function chainEnv(ref) {
    return Object.assign({}, ENV, {
      PATH: stubDir + ':' + process.env.PATH,
      TOOLS: BIN, REPO: CO, EXECUTOR_HOME: AP_HOME, MYTHOS_EXECUTOR_HOME: AP_HOME,
      approval_ref: ref
    });
  }
  // Refuse to run at all unless the stub really shadows systemctl: this test
  // must never be able to restart the live executor.
  assert.strictEqual(sh('command -v systemctl', { env: chainEnv('') }).out.trim(),
    path.join(stubDir, 'systemctl'), 'the stub must shadow the real systemctl');

  function runChain(ref) {
    var env = chainEnv(ref);
    var gate = sh(verifyRun, { env: env });
    if (gate.code !== 0) return { reached: false, gate: gate };   // type: chain stops here
    return { reached: true, gate: gate, restart: sh(restartRun, { env: env }) };
  }

  ['APP-FAKE', 'ap-zzzzzzzz-999999', putApproval({ status: 'PENDING', decided_by: null, decided_at: null })].forEach(function (ref) {
    var r = runChain(ref);
    assert.strictEqual(r.reached, false, ref + ' must not reach the restart step');
  });
  assert.ok(!fs.existsSync(marker), 'systemctl was never invoked for an invalid approval');

  // Control: a genuine approval does reach the (stubbed) restart, so the test
  // above proves the gate and not merely a broken command.
  var good = json(ra('request --repo "' + CO + '" --home "' + AP_HOME + '" --reason "control case for the chain test"').out).approval;
  assert.strictEqual(ra('grant ' + good + ' --by "Othman Haddad"').code, 0);
  var okRun = runChain(good);
  assert.strictEqual(okRun.reached, true, okRun.gate.out + okRun.gate.err);
  assert.strictEqual(okRun.restart.code, 0, okRun.restart.err);
  assert.ok(fs.existsSync(marker), 'the stub recorded exactly the approved restart');
  assert.strictEqual(fs.readFileSync(marker, 'utf8').trim(), '--user restart mythos-ai-executor.service');
});

// optional: the real Dagu binary validates the DAG files
t('Dagu dry-validates every DAG (skipped unless MYTHOS_DAGU_BIN is set)', function () {
  var bin = process.env.MYTHOS_DAGU_BIN; if (!bin) { console.log('  # skipped: MYTHOS_DAGU_BIN not set'); return; }
  var home = fs.mkdtempSync(path.join(os.tmpdir(), 'dagu-home-'));
  dagFiles.forEach(function (f) {
    var r = cp.spawnSync(bin, ['dry', path.join(DAGS, f)], { encoding: 'utf8', env: Object.assign({}, ENV, { DAGU_HOME: home }) });
    var out = String(r.stdout) + String(r.stderr);
    var expected = f === 'executor-restart.yaml' ? /Result: Waiting/ : /Result: Succeeded/;
    assert.ok(expected.test(out), f + ': ' + out.slice(-300));
  });
});

server.kill();
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
}
