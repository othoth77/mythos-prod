'use strict';
// =====================================================
// MYTHOS — Autopilot tests
// tests/mythos-autopilot-test.js
//
// Offline and deterministic. Git scenarios run against real temporary
// repositories (a bare "origin", a "checkout" clone and a "dev" clone that
// pushes to origin); nothing touches the shared checkout or the network.
// The executor is a tiny local HTTP server whose /health payload the test
// controls; restarts are an injected function; process liveness is injected.
//
// Sections: lock · git-sync · drift · restart · watchdog · worktrees ·
// test-impact · evidence · status · tick (integration, idempotency,
// concurrency, fail-closed) · CLI smoke.
//
// Run with: node tests/mythos-autopilot-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-autopilot-test-'));

process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'executor-home');
process.env.MYTHOS_AUTOPILOT_HOME = path.join(FIX, 'autopilot');
process.env.MYTHOS_BRIDGE_CONTROL_DIR = path.join(FIX, 'no-control');
process.env.MYTHOS_RESOURCE_GUARD = 'off';
delete process.env.MYTHOS_AUTOPILOT; delete process.env.MYTHOS_AUTOPILOT_SYNC; delete process.env.MYTHOS_AUTOPILOT_WORKTREES; delete process.env.MYTHOS_AUTOPILOT_RESTART;
fs.mkdirSync(process.env.MYTHOS_EXECUTOR_HOME, { recursive: true });

var A = require(path.join(EXEC, 'lib', 'autopilot'));
var lock = A.lock, G = A.gitReconcile, D = A.drift, R = A.restart, W = A.watchdog, WT = A.worktrees, TI = A.testImpact, EV = A.evidence, ST = A.status;
var state = require(path.join(EXEC, 'lib', 'state'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }
function eq(a, b, name) { ok(a === b, name + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function section(t) { console.log('--- ' + t); }

// --- git fixture -------------------------------------------------------------------------
var GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
function sh(cwd, args) { var r = cp.spawnSync('git', args, { cwd: cwd, encoding: 'utf8', env: Object.assign({}, process.env, GIT_ENV) }); if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr); return String(r.stdout).trim(); }
var git = function (cwd, args, opts) { return G.defaultGit(cwd, args, Object.assign({}, opts || {}, { env: GIT_ENV })); };
var seq = 0;
function fixture(name) {
  var root = path.join(FIX, name + '-' + (++seq));
  fs.mkdirSync(root, { recursive: true });
  var origin = path.join(root, 'origin.git'), dev = path.join(root, 'dev'), co = path.join(root, 'checkout');
  sh(root, ['init', '--bare', '-b', 'main', origin]);
  sh(root, ['clone', '-q', origin, dev]);
  fs.writeFileSync(path.join(dev, 'README.md'), 'v1\n'); fs.mkdirSync(path.join(dev, 'projects'), { recursive: true }); fs.writeFileSync(path.join(dev, 'projects', 'a.js'), '1\n');
  sh(dev, ['add', '-A']); sh(dev, ['commit', '-q', '-m', 'c1']); sh(dev, ['push', '-q', 'origin', 'main']);
  sh(root, ['clone', '-q', origin, co]);
  return { root: root, origin: origin, dev: dev, co: co, commit: function (msg, file) { fs.writeFileSync(path.join(dev, file || 'README.md'), msg + '\n'); sh(dev, ['add', '-A']); sh(dev, ['commit', '-q', '-m', msg]); sh(dev, ['push', '-q', 'origin', 'main']); return sh(dev, ['rev-parse', 'HEAD']); } };
}
function cfgFor(f, extra) { return G.config(Object.assign({ repo: f.co, git: git, expected_remote_url: f.origin }, extra || {})); }

// =========================================================================================
section('lock');
(function () {
  var root = path.join(FIX, 'lock');
  var a = lock.acquire(root, 'op1');
  ok(a.acquired && a.lock.fence >= 1, 'lock acquired with fence');
  var b = lock.acquire(root, 'op1');
  ok(!b.acquired && b.reason === 'already_running', 'second acquire of same op refused');
  ok(lock.acquire(root, 'op2').acquired, 'different op is independent');
  ok(lock.stillHeld(a.lock), 'stillHeld true while held');
  ok(lock.heartbeat(a.lock), 'heartbeat ok');
  ok(lock.release(a.lock), 'release ok');
  ok(!lock.stillHeld(a.lock), 'not held after release');
  var c = lock.acquire(root, 'op1');
  ok(c.acquired && c.lock.fence > a.lock.fence, 'fence strictly increases');
  // stale takeover: holder reported dead
  var d = lock.acquire(root, 'op1', { alive: function () { return false; } });
  ok(d.acquired && d.lock.takeover && d.lock.takeover.previous_pid === process.pid, 'dead holder taken over');
  ok(!lock.stillHeld(c.lock), 'fenced-out holder sees it lost the lock');
  ok(!lock.release(c.lock), 'fenced-out holder cannot release the new lock');
  var w = lock.withLock(root, 'op1', function () { return 'ran'; });
  ok(w.skipped === true && w.reason === 'already_running', 'withLock skips when held');
  lock.release(d.lock);
  eq(lock.withLock(root, 'op1', function () { return 'ran'; }), 'ran', 'withLock runs when free');
})();

// =========================================================================================
section('git-sync');
(function () {
  var f = fixture('sync');
  var cfg = cfgFor(f);
  var r0 = G.reconcile(cfg, { apply: true });
  eq(r0.code, G.CODES.NOOP, 'already synchronized → NOOP'); ok(!r0.applied, 'NOOP applies nothing');
  var c2 = f.commit('c2'); var c3 = f.commit('c3', 'projects/a.js');
  var plan = G.plan(G.inspect(cfg), cfg);
  eq(plan.decision, 'AUTO', 'behind → AUTO'); eq(plan.target, c3, 'target = origin/main'); eq(plan.human_approval, false, 'AUTO needs no approval');
  var dry = G.reconcile(cfg, { apply: false });
  eq(dry.code, G.CODES.DRY_RUN, 'dry run by default'); ok(!dry.applied, 'dry run applies nothing');
  eq(sh(f.co, ['rev-parse', 'HEAD']) !== c3, true, 'checkout untouched by dry run');
  var r1 = G.reconcile(cfg, { apply: true });
  ok(r1.applied && r1.verified && r1.head_after === c3, 'clean sync: fast-forward applied + verified');
  eq(sh(f.co, ['rev-parse', 'HEAD']), c3, 'HEAD == target after sync');
  var r2 = G.reconcile(cfg, { apply: true });
  eq(r2.code, G.CODES.NOOP, 'idempotent: second run NOOP');
  eq(sh(f.co, ['rev-list', '--count', 'HEAD']), '3', 'no duplicate commits');
  // dirty checkout
  fs.writeFileSync(path.join(f.co, 'README.md'), 'local edit\n');
  f.commit('c4');
  var rd = G.reconcile(cfg, { apply: true });
  eq(rd.code, G.CODES.DIRTY, 'dirty checkout → BLOCKED DIRTY'); ok(!rd.applied, 'nothing applied on dirty'); ok(rd.plan.human_approval, 'BLOCKED → human approval');
  eq(fs.readFileSync(path.join(f.co, 'README.md'), 'utf8'), 'local edit\n', 'local modification preserved');
  sh(f.co, ['checkout', '--', 'README.md']);
  // untracked files do not block (they are not overwritten by ff)
  fs.writeFileSync(path.join(f.co, 'scratch.txt'), 'x');
  var ru = G.reconcile(cfg, { apply: true });
  ok(ru.applied, 'untracked file does not block a fast-forward'); fs.unlinkSync(path.join(f.co, 'scratch.txt'));
  // local ahead
  fs.writeFileSync(path.join(f.co, 'local.txt'), 'l'); sh(f.co, ['add', '-A']); sh(f.co, ['commit', '-q', '-m', 'local']);
  var ra = G.reconcile(cfg, { apply: true });
  eq(ra.code, G.CODES.AHEAD, 'local ahead → BLOCKED (relay territory)');
  // divergent
  f.commit('c5');
  var rv = G.reconcile(cfg, { apply: true });
  eq(rv.code, G.CODES.DIVERGED, 'divergent → BLOCKED DIVERGED'); ok(!rv.applied, 'no merge on divergence');
  eq(sh(f.co, ['log', '-1', '--format=%s']), 'local', 'divergent local commit untouched');
  sh(f.co, ['reset', '-q', '--hard', 'origin/main']); // test fixture only
  // wrong branch
  sh(f.co, ['checkout', '-q', '-b', 'feature']);
  var rb = G.reconcile(cfg, { apply: true });
  eq(rb.code, G.CODES.WRONG_BRANCH, 'wrong branch → BLOCKED');
  sh(f.co, ['checkout', '-q', 'main']);
  // in-progress operation
  fs.writeFileSync(path.join(f.co, '.git', 'MERGE_HEAD'), 'deadbeef\n');
  var ri = G.reconcile(cfg, { apply: true });
  eq(ri.code, G.CODES.IN_PROGRESS, 'in-progress merge → BLOCKED');
  fs.unlinkSync(path.join(f.co, '.git', 'MERGE_HEAD'));
  // wrong remote
  var rw = G.reconcile(cfgFor(f, { expected_remote_url: '/nonexistent/repo.git' }), { apply: true });
  eq(rw.code, G.CODES.WRONG_REPO, 'unexpected remote url → BLOCKED');
  // fetch failure (fail-closed)
  sh(f.co, ['remote', 'set-url', 'origin', path.join(f.root, 'gone.git')]);
  f.commit('c6');
  var rf = G.reconcile(cfgFor(f, { expected_remote_url: path.join(f.root, 'gone.git') }), { apply: true });
  eq(rf.code, G.CODES.FETCH_FAILED, 'fetch failure → BLOCKED, nothing applied'); ok(!rf.applied, 'fetch failure applies nothing');
  sh(f.co, ['remote', 'set-url', 'origin', f.origin]);
  // target moved between plan and apply
  var ins = G.inspect(cfg); var p = G.plan(ins, cfg); eq(p.decision, 'AUTO', 'plan AUTO before move');
  f.commit('c7'); sh(f.co, ['fetch', '-q', 'origin']);
  var rm = G.apply(cfg, p, { apply: true });
  eq(rm.code, G.CODES.MOVED, 'remote moved since plan → re-plan, no apply');
  // fenced out
  var p2 = G.plan(G.inspect(cfg), cfg);
  var rfen = G.apply(cfg, p2, { apply: true, stillHeld: function () { return false; } });
  eq(rfen.code, G.CODES.FENCED, 'lost lock → no apply');
  ok(G.reconcile(cfg, { apply: true }).verified, 'then a normal run syncs');
  // not a repo
  var rn = G.plan(G.inspect(G.config({ repo: path.join(f.root, 'nope'), git: git })), G.config({ repo: path.join(f.root, 'nope'), git: git }));
  eq(rn.code, G.CODES.WRONG_REPO, 'missing repo → BLOCKED WRONG_REPOSITORY');
})();

// =========================================================================================
section('drift');
(function () {
  eq(D.verdict('a', 'a', { sha: 'a' }, 'same'), 'CURRENT', 'verdict CURRENT');
  eq(D.verdict('b', 'a', { sha: 'a' }, 'behind'), 'CODE_BEHIND_SOURCE', 'verdict behind');
  eq(D.verdict('b', 'a', { sha: 'a' }, 'ahead'), 'CODE_AHEAD', 'verdict ahead');
  eq(D.verdict('b', 'a', { sha: 'a' }, 'diverged'), 'CODE_DIVERGED', 'verdict diverged');
  eq(D.verdict('a', 'a', { sha: 'z' }, 'same'), 'EXECUTOR_RESTART_REQUIRED', 'verdict restart required');
  eq(D.verdict('a', 'a', { sha: null }, 'same'), 'EXECUTOR_UNVERIFIED', 'verdict unverified (fail-closed)');
  eq(D.verdict(null, 'a', { sha: 'a' }, null), 'SOURCE_UNVERIFIED', 'verdict source unverified');
  eq(D.nextAction({ state: 'EXECUTOR_RESTART_REQUIRED', executor: { sha: 'a' }, code: { sha: 'b' } }).mode, 'APPROVAL', 'restart is APPROVAL');
  eq(D.nextAction({ state: 'CODE_BEHIND_SOURCE', code: { sha: 'a' }, source: { sha: 'b' } }).mode, 'AUTO', 'sync is AUTO');
  eq(D.nextAction({ state: 'CODE_DIVERGED' }).mode, 'MANUAL', 'diverged is MANUAL');
  // reflog inference with a fake git
  var fakeGit = function (cwd, args) { return { ok: true, out: 'a'.repeat(40) + ' main@{2026-09-04T10:00:00+00:00}\n' + 'b'.repeat(40) + ' main@{2026-09-03T10:00:00+00:00}\n' + 'c'.repeat(40) + ' main@{2026-09-02T10:00:00+00:00}' }; };
  eq(D.reflogHeadAt(fakeGit, '/x', 'main', Date.parse('2026-09-03T12:00:00Z')).sha, 'b'.repeat(40), 'reflog entry in force at process start');
  eq(D.reflogHeadAt(fakeGit, '/x', 'main', Date.parse('2026-09-05T00:00:00Z')).sha, 'a'.repeat(40), 'newest entry when start is after all');
  ok(D.reflogHeadAt(fakeGit, '/x', 'main', Date.parse('2026-09-01T00:00:00Z')).oldest, 'start before oldest → oldest, flagged');
  // procStartMs from a synthetic /proc
  var proc = path.join(FIX, 'proc'); fs.mkdirSync(path.join(proc, '4242'), { recursive: true });
  fs.writeFileSync(path.join(proc, 'stat'), 'cpu 1 2 3\nbtime 1700000000\n');
  var fields = []; for (var i = 0; i < 52; i++) fields.push(String(i)); fields[21] = '500'; // starttime = 500 ticks = 5s
  fs.writeFileSync(path.join(proc, '4242', 'stat'), '4242 (node) S ' + fields.slice(3).join(' ') + '\n');
  eq(D.procStartMs(4242, { proc_root: proc }), (1700000000 + 5) * 1000, 'process start from btime + starttime');
})();

// A controllable executor /health server.
var HEALTH = { ok: true, code_identity: null };
var healthServer = http.createServer(function (req, res) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: HEALTH.ok, time: new Date().toISOString(), code_identity: HEALTH.code_identity })); });
function withHealth(fn) { return new Promise(function (resolve) { healthServer.listen(0, '127.0.0.1', function () { resolve('http://127.0.0.1:' + healthServer.address().port + '/health'); }); }).then(fn); }

var f2 = fixture('drift');
var driftCfg = cfgFor(f2);

withHealth(function (healthUrl) {
  var HEAD = sh(f2.co, ['rev-parse', 'HEAD']);
  // executor reports identity via /health
  HEALTH.code_identity = { head: HEAD, started_at: '2026-09-04T00:00:00Z', pid: 777 };
  return D.detect({ inspection: G.inspect(driftCfg), git: git, repo: f2.co, executor_home: process.env.MYTHOS_EXECUTOR_HOME, health_url: healthUrl }).then(function (d) {
    eq(d.state, 'CURRENT', 'health identity equal → CURRENT'); eq(d.executor.source, 'health', 'identity source = health');
    HEALTH.code_identity = { head: 'f'.repeat(40) };
    return D.detect({ inspection: G.inspect(driftCfg), git: git, repo: f2.co, executor_home: process.env.MYTHOS_EXECUTOR_HOME, health_url: healthUrl });
  }).then(function (d) {
    eq(d.state, 'EXECUTOR_RESTART_REQUIRED', 'health identity differs → EXECUTOR_RESTART_REQUIRED');
    // stale runtime via reflog inference: no code_identity, executor pid alive, start time before the last ff
    HEALTH.code_identity = null;
    fs.writeFileSync(path.join(process.env.MYTHOS_EXECUTOR_HOME, 'daemon.lock'), String(process.pid));
    var before = sh(f2.co, ['rev-parse', 'HEAD']);
    f2.commit('later'); G.reconcile(driftCfg, { apply: true });
    return D.detect({ inspection: G.inspect(driftCfg), git: git, repo: f2.co, executor_home: process.env.MYTHOS_EXECUTOR_HOME, health_url: healthUrl, proc_start_ms: Date.now() - 3600 * 1000 }).then(function (d2) {
      eq(d2.executor.source, 'reflog_inference', 'no health identity → reflog inference');
      eq(d2.executor.sha, before, 'inferred identity = HEAD in force at process start');
      eq(d2.state, 'EXECUTOR_RESTART_REQUIRED', 'stale runtime detected');
    });
  }).then(function () {
    // dead executor → unverified
    fs.writeFileSync(path.join(process.env.MYTHOS_EXECUTOR_HOME, 'daemon.lock'), '999999');
    return D.detect({ inspection: G.inspect(driftCfg), git: git, repo: f2.co, executor_home: process.env.MYTHOS_EXECUTOR_HOME, health_url: 'http://127.0.0.1:1/health' }).then(function (d3) {
      eq(d3.state, 'EXECUTOR_UNVERIFIED', 'dead executor + no health → EXECUTOR_UNVERIFIED');
      eq(d3.next_action.mode, 'MANUAL', 'unverified is never auto-restarted');
    });
  }).then(function () {
    // =====================================================================================
    section('restart');
    var root = path.join(FIX, 'restart-root');
    var sha = 'a'.repeat(40), sha2 = 'b'.repeat(40);
    var drift = function (st, running, code) { return { state: st, code: { sha: code || sha }, executor: { sha: running || 'c'.repeat(40), source: 'health', pid: 1, health: { ok: true } } }; };
    eq(R.request(root, drift('CURRENT')).created, false, 'no request when CURRENT');
    var rq = R.request(root, drift('EXECUTOR_RESTART_REQUIRED'));
    ok(rq.created && rq.record.state === 'REQUIRED', 'request created REQUIRED');
    eq(R.request(root, drift('EXECUTOR_RESTART_REQUIRED')).reason, 'already_requested', 'request idempotent');
    eq(R.approve(root, sha, { by: 'claude-agent', reason: 'long enough reason' }).code, 'APPROVAL_NEEDS_HUMAN', 'automated identity cannot approve');
    eq(R.approve(root, sha, { by: 'Othman', reason: 'short' }).code, 'APPROVAL_NEEDS_REASON', 'reason required');
    eq(R.approve(root, sha2, { by: 'Othman', reason: 'long enough reason' }).code, 'NO_SUCH_REQUEST', 'approval bound to a recorded request');
    // preflight vetoes
    var vet = R.preflight({ expected_sha: sha, drift: drift('CURRENT'), resource_guard: { level: 'NORMAL' }, running: [], approval: { ok: false, code: 'APPROVAL_MISSING' } });
    ok(!vet.ok && vet.vetoes.some(function (v) { return v.code === 'REASON_GONE'; }) && vet.vetoes.some(function (v) { return v.code === 'APPROVAL_MISSING'; }), 'preflight vetoes: reason gone + approval missing');
    vet = R.preflight({ expected_sha: sha, drift: drift('EXECUTOR_RESTART_REQUIRED'), resource_guard: { level: 'CRITICAL' }, running: [{ task_id: 't' }], approval: { ok: true } });
    ok(vet.vetoes.some(function (v) { return v.code === 'RESOURCE_CRITICAL'; }) && vet.vetoes.some(function (v) { return v.code === 'ACTIVE_EXECUTION'; }), 'preflight vetoes: resource critical + active execution');
    vet = R.preflight({ expected_sha: sha, drift: drift('EXECUTOR_RESTART_REQUIRED', null, sha2), resource_guard: { level: 'STALE', reason: 'old' }, running: [], approval: { ok: true } });
    ok(vet.vetoes.some(function (v) { return v.code === 'CHECKOUT_MOVED'; }) && vet.vetoes.some(function (v) { return v.code === 'RESOURCE_UNVERIFIED'; }), 'preflight vetoes: checkout moved + resource unverified (fail-closed)');
    var fakeState = { listTasks: function () { return []; }, readStatus: function () { return null; } };
    // apply without approval → vetoed, nothing restarted
    var restarted = 0;
    return R.apply(root, { expected_sha: sha, detect: function () { return Promise.resolve(drift('EXECUTOR_RESTART_REQUIRED')); }, restartFn: function () { restarted++; return { ok: true }; }, executor_home: FIX, state: fakeState }).then(function (r) {
      eq(r.code, 'PREFLIGHT_VETO', 'unapproved apply → PREFLIGHT_VETO'); eq(restarted, 0, 'no restart without approval');
      var ap = R.approve(root, sha, { by: 'Othman Haddad', reason: 'merged the PR, restart wanted' });
      ok(ap.ok && ap.record.state === 'APPROVED', 'human approval recorded');
      ok(R.approve(root, sha, { by: 'Othman Haddad', reason: 'merged the PR, restart wanted' }).duplicate, 'duplicate approval is a no-op');
      // failed restart command → FAILED, approval consumed, no retry
      return R.apply(root, { expected_sha: sha, detect: function () { return Promise.resolve(drift('EXECUTOR_RESTART_REQUIRED')); }, restartFn: function () { restarted++; return { ok: false, error: 'boom' }; }, executor_home: FIX, state: fakeState });
    }).then(function (r) {
      eq(r.code, 'RESTART_COMMAND_FAILED', 'failed restart → FAILED'); eq(r.record.state, 'FAILED', 'record FAILED'); eq(restarted, 1, 'exactly one attempt');
      ok(R.verifyApproval(root, sha).code === 'APPROVAL_CONSUMED', 'approval consumed by the attempt');
      return R.apply(root, { expected_sha: sha, detect: function () { return Promise.resolve(drift('EXECUTOR_RESTART_REQUIRED')); }, restartFn: function () { restarted++; return { ok: true }; }, executor_home: FIX, state: fakeState });
    }).then(function (r) {
      eq(r.code, 'REQUEST_CLOSED', 'a FAILED request never restarts again'); eq(restarted, 1, 'no second attempt');
      // successful path on a fresh root
      var root2 = path.join(FIX, 'restart-root-2');
      R.request(root2, drift('EXECUTOR_RESTART_REQUIRED'));
      R.approve(root2, sha, { by: 'Othman Haddad', reason: 'merged the PR, restart wanted' });
      var phase = 0;
      var detect = function () { phase++; return Promise.resolve(phase <= 1 ? drift('EXECUTOR_RESTART_REQUIRED') : (phase === 2 ? { state: 'EXECUTOR_UNVERIFIED', code: { sha: sha }, executor: { sha: null, health: { ok: false, error: 'ECONNREFUSED' } } } : { state: 'CURRENT', code: { sha: sha }, executor: { sha: sha, source: 'health', pid: 2, health: { ok: true } } })); };
      return R.apply(root2, { expected_sha: sha, detect: detect, restartFn: function () { return { ok: true }; }, executor_home: FIX, state: fakeState, health_poll_ms: 5, health_wait_ms: 2000 }).then(function (r2) {
        eq(r2.code, 'HEALTHY', 'approved restart → health → identity verified → HEALTHY');
        eq(r2.record.attempts[0].verification.pid, 2, 'post-restart pid recorded');
        ok(fs.existsSync(path.join(root2, 'ledger.jsonl')) && fs.readFileSync(path.join(root2, 'ledger.jsonl'), 'utf8').indexOf('"healthy"') > 0, 'restart ledgered');
        return R.apply(root2, { expected_sha: sha, detect: detect, restartFn: function () { throw new Error('must not run'); }, executor_home: FIX, state: fakeState });
      }).then(function (r3) { eq(r3.code, 'REQUEST_CLOSED', 'idempotent: HEALTHY request is closed'); });
    }).then(function () {
      // health timeout → FAILED; identity mismatch → FAILED
      var root3 = path.join(FIX, 'restart-root-3');
      R.request(root3, drift('EXECUTOR_RESTART_REQUIRED')); R.approve(root3, sha, { by: 'Othman Haddad', reason: 'merged the PR, restart wanted' });
      var n = 0;
      return R.apply(root3, { expected_sha: sha, detect: function () { n++; return Promise.resolve(n === 1 ? drift('EXECUTOR_RESTART_REQUIRED') : { state: 'EXECUTOR_UNVERIFIED', code: { sha: sha }, executor: { sha: null, health: { ok: false } } }); }, restartFn: function () { return { ok: true }; }, executor_home: FIX, state: fakeState, health_poll_ms: 5, health_wait_ms: 60 }).then(function (r) {
        eq(r.code, 'HEALTH_TIMEOUT', 'never healthy → FAILED HEALTH_TIMEOUT'); eq(r.record.state, 'FAILED', 'stops, does not loop');
        var root4 = path.join(FIX, 'restart-root-4');
        R.request(root4, drift('EXECUTOR_RESTART_REQUIRED')); R.approve(root4, sha, { by: 'Othman Haddad', reason: 'merged the PR, restart wanted' });
        var m = 0;
        return R.apply(root4, { expected_sha: sha, detect: function () { m++; return Promise.resolve(m === 1 ? drift('EXECUTOR_RESTART_REQUIRED') : { state: 'EXECUTOR_RESTART_REQUIRED', code: { sha: sha }, executor: { sha: sha2, source: 'health', health: { ok: true } } }); }, restartFn: function () { return { ok: true }; }, executor_home: FIX, state: fakeState, health_poll_ms: 5, health_wait_ms: 60 });
      }).then(function (r) { eq(r.code, 'IDENTITY_MISMATCH_AFTER_RESTART', 'wrong identity after restart → FAILED'); });
    }).then(function () {
      // supersede + policy auto-approval + running-task veto
      var root5 = path.join(FIX, 'restart-root-5');
      R.request(root5, drift('EXECUTOR_RESTART_REQUIRED'));
      R.request(root5, drift('EXECUTOR_RESTART_REQUIRED', null, sha2));
      eq(R.listRequests(root5).filter(function (r) { return r.expected_sha === sha; })[0].state, 'SUPERSEDED', 'older request superseded when the checkout moves on');
      eq(R.openRequest(root5).expected_sha, sha2, 'open request = newest');
      eq(R.autoPolicy(root5).enabled, false, 'auto policy off by default');
      var busyState = { listTasks: function () { return ['t1']; }, readStatus: function () { return { status: 'RUNNING', pid: 1 }; } };
      return R.apply(root5, { expected_sha: sha2, detect: function () { return Promise.resolve(drift('EXECUTOR_RESTART_REQUIRED', null, sha2)); }, restartFn: function () { throw new Error('no'); }, executor_home: FIX, state: busyState, approval_auto: { enabled: true, reason: 'marker' } }).then(function (r) {
        eq(r.code, 'PREFLIGHT_VETO', 'policy approval still vetoed by a RUNNING task');
        ok(r.vetoes.some(function (v) { return v.code === 'ACTIVE_EXECUTION'; }), 'veto = ACTIVE_EXECUTION');
        eq(R.listRequests(root5).filter(function (x) { return x.expected_sha === sha2; })[0].state, 'APPROVED', 'policy auto-approval recorded as APPROVED');
      });
    });
  }).then(function () {
    // =====================================================================================
    section('watchdog');
    var now = Date.now();
    function mk(id, status, task) {
      state.ensureTaskDir(id);
      state.writeJSON(id, 'task.json', Object.assign({ task_id: id, timeout_seconds: 60, requested_by: 'n8n' }, task || {}));
      state.writeJSON(id, 'status.json', Object.assign({ task_id: id, created_at: new Date(now - 1000).toISOString() }, status));
    }
    var DEAD = 999990, LIVE = 999991, DAEMON = 999992;
    var alive = function (pid) { return pid === LIVE || pid === DAEMON || pid === process.pid; };
    fs.writeFileSync(path.join(process.env.MYTHOS_EXECUTOR_HOME, 'daemon.lock'), String(DAEMON));
    mk('wd-orphaned-1', { status: 'RUNNING', pid: LIVE, daemon_pid: DEAD, started_at: new Date(now - 10000).toISOString() });
    mk('wd-interrupt-1', { status: 'RUNNING', pid: DEAD, daemon_pid: DAEMON });
    mk('wd-stuck-run-1', { status: 'RUNNING', pid: LIVE, daemon_pid: DAEMON, started_at: new Date(now - 3 * 3600 * 1000).toISOString() });
    mk('wd-fine-run-1', { status: 'RUNNING', pid: LIVE, daemon_pid: DAEMON, started_at: new Date(now - 5000).toISOString() });
    mk('wd-retry-late', { status: 'WAITING_RETRY', retry_at: new Date(now - 3600 * 1000).toISOString() });
    mk('wd-retry-soon', { status: 'WAITING_RETRY', retry_at: new Date(now + 60000).toISOString() });
    mk('wd-quota-late', { status: 'WAITING_FOR_QUOTA', quota_state: { resume_after: new Date(now - 3600 * 1000).toISOString() } });
    mk('wd-queued-old', { status: 'QUEUED', created_at: new Date(now - 10 * 3600 * 1000).toISOString() });
    mk('wd-queued-new', { status: 'QUEUED', created_at: new Date(now - 60000).toISOString() });
    mk('wd-done-norep', { status: 'COMPLETED', ended_at: new Date(now - 1000).toISOString() });
    mk('wd-done-rep-1', { status: 'COMPLETED' }); state.writeJSON('wd-done-rep-1', 'report.json', { status: 'COMPLETED' });
    mk('wd-cancelled-1', { status: 'CANCELLED' });
    state.ensureTaskDir('wd-corrupt-11'); fs.writeFileSync(path.join(state.taskDir('wd-corrupt-11'), 'status.json'), '{not json');
    var bridgeTasks = [{ id: 'gh-1', execution: { executor_task_id: 'wd-fine-run-1', lease: { expires_at: new Date(now - 2 * 3600 * 1000).toISOString() } } }, { id: 'gh-2', execution: { executor_task_id: 'wd-done-rep-1', lease: { expires_at: new Date(now - 2 * 3600 * 1000).toISOString() } } }];
    var scan = W.scan({ state: state, alive: alive, bridge_tasks: bridgeTasks, now: now });
    var codes = {}; scan.findings.forEach(function (f) { codes[f.code + ':' + f.task_id] = f.mode; });
    eq(codes['ORPHANED_RUNNING:wd-orphaned-1'], 'APPROVAL', 'orphaned RUNNING (daemon dead, child alive) detected, APPROVAL');
    eq(codes['INTERRUPTED:wd-interrupt-1'], 'AUTO', 'interrupted (child dead) detected, AUTO (executor recovers)');
    eq(codes['STUCK_RUNNING:wd-stuck-run-1'], 'APPROVAL', 'stuck RUNNING past timeout+grace');
    ok(!Object.keys(codes).some(function (k) { return k.indexOf(':wd-fine-run-1') > 0 && k.indexOf('LEASE') !== 0; }), 'healthy RUNNING task has no task finding');
    eq(codes['RETRY_OVERDUE:wd-retry-late'], 'AUTO', 'retry overdue detected');
    ok(!codes['RETRY_OVERDUE:wd-retry-soon'], 'future retry not flagged');
    eq(codes['QUOTA_OVERDUE:wd-quota-late'], 'AUTO', 'quota overdue detected');
    eq(codes['QUEUED_STALE:wd-queued-old'], 'AUTO', 'stale queued detected');
    ok(!codes['QUEUED_STALE:wd-queued-new'], 'fresh queued not flagged');
    eq(codes['TERMINAL_NO_REPORT:wd-done-norep'], 'AUTO', 'terminal without report detected');
    ok(!codes['TERMINAL_NO_REPORT:wd-done-rep-1'] && !codes['TERMINAL_NO_REPORT:wd-cancelled-1'], 'reported / cancelled tasks not flagged');
    eq(codes['CORRUPT_STATUS:wd-corrupt-11'], 'MANUAL', 'corrupt status.json → MANUAL');
    eq(codes['LEASE_EXPIRED:wd-fine-run-1'], 'APPROVAL', 'expired bridge lease on a non-terminal task');
    ok(!codes['LEASE_EXPIRED:wd-done-rep-1'], 'expired lease on a terminal task ignored');
    ok(scan.daemon.alive, 'daemon alive'); eq(scan.state, 'STUCK', 'state STUCK with approval-mode findings');
    eq(scan.fresh.length, scan.findings.filter(function (f) { return f.task_id; }).length, 'first scan: every task finding is fresh');
    var scan2 = W.scan({ state: state, alive: alive, bridge_tasks: bridgeTasks, now: now + 1000 });
    eq(scan2.fresh.length, 0, 'second scan: nothing fresh (at-most-once notification)');
    eq(scan2.findings.filter(function (f) { return f.code === 'ORPHANED_RUNNING'; })[0].count, 2, 'stamp count increments');
    state.writeJSON('wd-done-norep', 'report.json', { status: 'COMPLETED' });
    var scan3 = W.scan({ state: state, alive: alive, bridge_tasks: bridgeTasks, now: now + 2000 });
    ok(!scan3.findings.some(function (f) { return f.task_id === 'wd-done-norep'; }), 'finding clears when the report appears');
    eq(state.readJSON('wd-done-norep', W.STAMP_FILE) && Object.keys(state.readJSON('wd-done-norep', W.STAMP_FILE)).length, 0, 'stamp removed when the finding clears');
    fs.writeFileSync(path.join(process.env.MYTHOS_EXECUTOR_HOME, 'daemon.lock'), String(DEAD));
    var scan4 = W.scan({ state: state, alive: alive, now: now + 3000, dry_run: true });
    ok(scan4.findings.some(function (f) { return f.code === 'DAEMON_DOWN'; }), 'daemon down detected');
    fs.writeFileSync(path.join(process.env.MYTHOS_EXECUTOR_HOME, 'daemon.lock'), String(DAEMON));
    // cleanup fixture tasks so the tick integration below sees a clean store
    state.listTasks().forEach(function (id) { fs.rmSync(state.taskDir(id), { recursive: true, force: true }); });
  }).then(function () {
    // =====================================================================================
    section('worktrees');
    var f = fixture('wt');
    var taskRoot = path.join(f.root, 'tasks-wt');
    fs.mkdirSync(taskRoot, { recursive: true });
    var old = Date.now() - 3 * 24 * 3600 * 1000;
    function taskWt(id, opts) {
      opts = opts || {};
      var dir = path.join(taskRoot, id), branch = 'mythos/gh/' + id;
      sh(f.co, ['worktree', 'add', '-q', '-b', branch, dir, 'origin/main']);
      if (opts.commit) { fs.writeFileSync(path.join(dir, id + '.txt'), 'w'); sh(dir, ['add', '-A']); sh(dir, ['commit', '-q', '-m', 'work ' + id]); }
      if (opts.push) sh(dir, ['push', '-q', 'origin', branch]);
      if (opts.merge) { sh(f.dev, ['fetch', '-q', 'origin', branch]); sh(f.dev, ['merge', '-q', '--no-ff', '-m', 'merge ' + id, 'origin/' + branch]); sh(f.dev, ['push', '-q', 'origin', 'main']); sh(f.co, ['fetch', '-q', 'origin']); }
      if (opts.dirty) fs.writeFileSync(path.join(dir, 'README.md'), 'dirty');
      if (!opts.recent) fs.utimesSync(dir, old / 1000, old / 1000);
      return dir;
    }
    var wSafe = taskWt('t-safe', { commit: true, push: true, merge: true });
    var wEmpty = taskWt('t-empty', {});                              // no commits: head == base, trivially merged
    var wActive = taskWt('t-active', { commit: true, push: true, merge: true });
    var wDirty = taskWt('t-dirty', { commit: true, push: true, merge: true, dirty: true });
    var wUnmerged = taskWt('t-unmerged', { commit: true, push: true });
    var wNotOrigin = taskWt('t-local', { commit: true, merge: false });
    var wRecent = taskWt('t-recent', { commit: true, push: true, merge: true, recent: true });
    var wInUse = taskWt('t-inuse', { commit: true, push: true, merge: true });
    var mission = path.join(f.root, 'mission-wt'); sh(f.co, ['worktree', 'add', '-q', '-b', 'mythos/mission-x', mission, 'origin/main']); fs.utimesSync(mission, old / 1000, old / 1000);
    sh(f.co, ['branch', 'mythos/gh/t-orphan-branch', 'origin/main']);           // merged, on origin? no remote → NOT_ON_ORIGIN
    sh(f.co, ['fetch', '-q', 'origin']);
    var claims = { 't-active': { executor_task_id: 'x-active' }, 't-safe': { executor_task_id: 'x-safe' } };
    var statusOf = function (id) { return id === 'x-active' ? { status: 'RUNNING' } : { status: 'COMPLETED' }; };
    var wcfg = { repo: f.co, git: git, task_root: taskRoot, claims: claims, status_of: statusOf, live_cwds: [wInUse + '/sub'] };
    var plan = WT.plan(wcfg);
    var by = {}; plan.worktrees.forEach(function (w) { by[path.basename(w.path)] = w; });
    eq(by['checkout'].code, 'PRIMARY_CHECKOUT', 'primary checkout kept');
    eq(by['t-safe'].decision, 'AUTO', 'merged+delivered+clean+unused+old task worktree → AUTO'); ok(by['t-safe'].merged && by['t-safe'].on_origin && by['t-safe'].unique_commits === 0, 'evidence recorded');
    eq(by['t-empty'].decision, 'AUTO', 'task worktree with no commits → AUTO');
    eq(by['t-active'].code, 'TASK_ACTIVE', 'active task → KEEP');
    eq(by['t-dirty'].code, 'DIRTY_OR_UNREADABLE', 'dirty → MANUAL'); eq(by['t-dirty'].decision, 'MANUAL', 'dirty decision MANUAL');
    eq(by['t-unmerged'].code, 'NOT_MERGED', 'unmerged → APPROVAL');
    eq(by['t-local'].code, 'NOT_MERGED', 'local-only commits → APPROVAL (not merged, unique)');
    eq(by['t-recent'].code, 'TOO_RECENT', 'recent → KEEP');
    eq(by['t-inuse'].code, 'IN_USE', 'cwd of a live process → KEEP');
    eq(by['mission-wt'].code, 'OWNERSHIP_AMBIGUOUS', 'non-task worktree → APPROVAL even when safe');
    var br = {}; plan.branches.forEach(function (b) { br[b.branch] = b; });
    eq(br['mythos/gh/t-orphan-branch'].code, 'SAFE_MERGED_DELIVERED', 'task branch pointing inside origin/main (no unique state) → AUTO branch -d');
    sh(f.co, ['branch', 'mythos/gh/t-ahead-branch', 'origin/main']); fs.writeFileSync(path.join(f.co, 'zz.txt'), 'z'); sh(f.co, ['checkout', '-q', 'mythos/gh/t-ahead-branch']); sh(f.co, ['add', '-A']); sh(f.co, ['commit', '-q', '-m', 'unique']); sh(f.co, ['checkout', '-q', 'main']);
    var planB = WT.plan(wcfg); var brB = {}; planB.branches.forEach(function (b) { brB[b.branch] = b; });
    eq(brB['mythos/gh/t-ahead-branch'].code, 'NOT_MERGED', 'branch with a unique local commit → APPROVAL, never deleted');
    plan = planB;
    eq(br['mythos/gh/t-safe'].code, 'WORKTREE_ATTACHED', 'attached branch deferred to the worktree decision');
    eq(plan.state, 'STALE', 'plan state STALE');
    var dry = WT.apply(wcfg, plan, { apply: false });
    ok(!dry.applied && dry.would_remove.length === 2 && fs.existsSync(wSafe), 'dry run removes nothing');
    var ap = WT.apply(wcfg, plan, { apply: true, stillHeld: function () { return true; } });
    ok(ap.applied && ap.records.filter(function (r) { return r.outcome === 'removed'; }).length === 2, 'apply removes exactly the AUTO worktrees');
    ok(!fs.existsSync(wSafe) && !fs.existsSync(wEmpty), 'AUTO worktrees gone');
    ok(fs.existsSync(wActive) && fs.existsSync(wDirty) && fs.existsSync(wUnmerged) && fs.existsSync(wNotOrigin) && fs.existsSync(mission), 'everything else untouched');
    ok(ap.records.filter(function (r) { return r.kind === 'worktree'; }).every(function (r) { return r.branch_deleted === true; }), 'local branches of removed worktrees deleted with -d');
    ok(!git(f.co, ['rev-parse', '--verify', '--quiet', 'refs/heads/mythos/gh/t-safe']).ok, 'local branch gone');
    ok(git(f.co, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/mythos/gh/t-safe']).ok, 'remote branch never deleted');
    ok(ap.records.some(function (r) { return r.kind === 'branch' && r.branch === 'mythos/gh/t-orphan-branch' && r.outcome === 'deleted'; }), 'AUTO branch deleted with -d');
    ok(git(f.co, ['rev-parse', '--verify', '--quiet', 'refs/heads/mythos/gh/t-ahead-branch']).ok, 'branch with unique commit untouched');
    var plan2 = WT.plan(wcfg);
    eq(plan2.worktrees.filter(function (w) { return w.decision === 'AUTO'; }).length, 0, 'idempotent: nothing left to remove');
    // fenced-out apply
    var lost = WT.apply(wcfg, plan2, { apply: true, stillHeld: function () { return false; } });
    ok(lost.records.every(function (r) { return r.outcome === 'skipped'; }), 'lost lock → every action skipped');
  }).then(function () {
    // =====================================================================================
    section('test-impact');
    var map = TI.buildMap(BASE);
    ok(Object.keys(map.suites).length > 100, 'map covers the suites');
    ok(map.suites['tests/erp-acceptance-test.js'].excluded, 'ERP acceptance suite excluded (production DB)');
    var sel = TI.select(map, ['projects/mythos-ai-executor/lib/lifecycle/registry.js']);
    ok(sel.suites.some(function (s) { return s.suite === 'tests/mythos-lifecycle-test.js'; }), 'lifecycle change → lifecycle suite');
    ok(!sel.full, 'lifecycle change is targeted, not full');
    sel = TI.select(map, ['projects/mythos-ai-executor/bridge/github-issues.js']);
    ok(sel.suites.some(function (s) { return s.suite === 'tests/mythos-github-issues-test.js'; }), 'issues adapter change → issues suite');
    sel = TI.select(map, ['projects/mythos-ai-executor/lib/autopilot/drift.js']);
    ok(sel.suites.some(function (s) { return s.suite === 'tests/mythos-autopilot-test.js'; }), 'autopilot change → autopilot suite');
    sel = TI.select(map, ['projects/mythos-ai-executor/service/governance-verify.js']);
    ok(sel.full && /sensitive/.test(sel.full_reason), 'governance change → FULL regression');
    sel = TI.select(map, ['projects/mythos-ai-executor/executor.js']);
    ok(sel.full, 'executor.js change → FULL regression');
    sel = TI.select(map, ['docs/MYTHOS_AUTOPILOT.md']);
    ok(sel.doc_only && !sel.full, 'doc-only change flagged');
    sel = TI.select(map, ['tests/mythos-autopilot-test.js']);
    ok(sel.suites.some(function (s) { return s.suite === 'tests/mythos-autopilot-test.js'; }), 'a changed suite selects itself');
    sel = TI.select(map, ['sites/erp.mythosprod.xyz/api/server.js']);
    ok(sel.excluded.some(function (e) { return /erp-acceptance/.test(e.suite); }) || sel.unmatched.length || sel.suites.length, 'ERP change reports exclusion or match, never silently nothing');
    ok(TI.covers('projects/x/lib', 'projects/x/lib/a.js') && !TI.covers('projects/x/lib', 'projects/y/a.js'), 'covers: directory prefix');
    eq(TI.parseCounts('passed: 12, failed: 0').passed, 12, 'parseCounts a');
    eq(TI.parseCounts('12 passed, 3 failed').failed, 3, 'parseCounts b');
    // run: a passing and a failing synthetic suite, stop on fail
    var tdir = path.join(FIX, 'tsuite', 'tests'); fs.mkdirSync(tdir, { recursive: true });
    fs.writeFileSync(path.join(tdir, 'a-test.js'), 'console.log("2 passed, 0 failed");');
    fs.writeFileSync(path.join(tdir, 'b-test.js'), 'console.log("1 passed, 1 failed"); process.exit(1);');
    fs.writeFileSync(path.join(tdir, 'c-test.js'), 'console.log("never");');
    var run = TI.run(path.join(FIX, 'tsuite'), ['tests/a-test.js', 'tests/b-test.js', 'tests/c-test.js']);
    ok(!run.ok && run.stopped_at === 'tests/b-test.js' && run.ran === 2, 'runner STOPs at the first failure');
    eq(run.results[0].passed, 2, 'runner parses counts');
  }).then(function () {
    // =====================================================================================
    section('evidence');
    var f = fixture('ev');
    var wt = path.join(f.root, 'feature'); sh(f.co, ['worktree', 'add', '-q', '-b', 'mythos/feature-1', wt, 'origin/main']);
    fs.writeFileSync(path.join(wt, 'new.txt'), 'n'); sh(wt, ['add', '-A']); sh(wt, ['commit', '-q', '-m', 'feat: new']);
    var ev = EV.collect({ cwd: wt, git: git, fetch: false, drift: { state: 'CURRENT', source: { sha: 'a' }, code: { sha: 'a' }, executor: { sha: 'a', source: 'health' } } });
    eq(ev.branch, 'mythos/feature-1', 'evidence: branch from git'); eq(ev.head, sh(wt, ['rev-parse', 'HEAD']), 'evidence: head');
    eq(ev.base, sh(f.co, ['rev-parse', 'origin/main']), 'evidence: base = merge-base'); eq(ev.commits.length, 1, 'evidence: commits over base');
    eq(ev.files_changed[0].path, 'new.txt', 'evidence: files changed'); eq(ev.branch_on_origin, false, 'evidence: not on origin yet'); eq(ev.merged_into_main, false, 'evidence: not merged');
    ok(ev.not_verified.some(function (n) { return n.field === 'tests'; }), 'missing test artifact → NOT_VERIFIED, not invented');
    ok(/relay/.test(ev.next_action), 'next action: relay delivers');
    var md = EV.renderMarkdown(ev);
    ok(md.indexOf('| Branch | `mythos/feature-1` |') >= 0 && md.indexOf('NOT_VERIFIED') >= 0, 'markdown renders facts and NOT_VERIFIED');
    var ev2 = EV.collect({ cwd: wt, git: git, fetch: false, tests: { results: [{ suite: 'tests/x-test.js', ok: true, passed: 5, failed: 0 }] } });
    ok(EV.renderMarkdown(ev2).indexOf('x-test.js **5/0**') > 0, 'test counts come from the artifact');
  }).then(function () {
    // =====================================================================================
    section('status');
    var s1 = ST.build({ drift: { state: 'EXECUTOR_RESTART_REQUIRED', source: { ref: 'origin/main', sha: 'a' }, code: { sha: 'a' }, bridge: { sha: 'a' }, executor: { sha: 'b', source: 'health', alive: true, pid: 1, health: { ok: true } }, next_action: { mode: 'APPROVAL', text: 'restart' } }, inspection: { head: 'a', current_branch: 'main', clean: true, relation: 'same', fetch_ok: true }, watchdog: { state: 'HEALTHY', counts: {}, findings: [], tasks_scanned: 3 }, worktrees: { state: 'STALE', summary: { AUTO: 2 }, worktrees: [{ decision: 'AUTO' }, { decision: 'AUTO' }, { decision: 'KEEP' }], branches: [] }, executor_home: process.env.MYTHOS_EXECUTOR_HOME, enablement: { sync: 'disabled', worktrees: 'disabled', restart_auto: 'disabled', autopilot: 'enabled' } });
    eq(s1.DEPLOYMENT.state, 'DRIFTED', 'restart required → DEPLOYMENT DRIFTED'); eq(s1.EXECUTOR.state, 'RESTART_REQUIRED', 'EXECUTOR RESTART_REQUIRED'); eq(s1.WORKTREES.auto_removable, 2, 'auto-removable count'); eq(s1.CLEANUP.git_sync, 'disabled', 'cleanup flags');
    eq(s1.RESOURCE.level, 'UNKNOWN', 'no guard file → UNKNOWN (never guessed)');
    var s2 = ST.build({ drift: { state: 'CURRENT', source: { sha: 'a' }, code: { sha: 'a' }, executor: { sha: 'a', alive: true, health: { ok: true } } }, inspection: {}, watchdog: {}, worktrees: {}, executor_home: process.env.MYTHOS_EXECUTOR_HOME });
    eq(s2.DEPLOYMENT.state, 'CURRENT', 'CURRENT → DEPLOYMENT CURRENT'); eq(s2.EXECUTOR.state, 'HEALTHY', 'EXECUTOR HEALTHY');
    ok(ST.fingerprint(s1) !== ST.fingerprint(s2) && ST.fingerprint(s1) === ST.fingerprint(ST.build({ drift: { state: 'EXECUTOR_RESTART_REQUIRED', source: { sha: 'a' }, code: { sha: 'a' }, executor: { sha: 'b', alive: true, health: { ok: true } } }, inspection: { head: 'a' }, watchdog: { state: 'HEALTHY', counts: {} }, worktrees: { state: 'STALE', worktrees: [{ decision: 'AUTO' }, { decision: 'AUTO' }] }, executor_home: process.env.MYTHOS_EXECUTOR_HOME, enablement: { sync: 'disabled', worktrees: 'disabled' } })), 'fingerprint stable for the same state, differs across states');
  }).then(function () {
    // =====================================================================================
    section('tick (integration)');
    var f = fixture('tick');
    var R0 = process.env.MYTHOS_AUTOPILOT_HOME;
    var healthUrl = 'http://127.0.0.1:' + healthServer.address().port + '/health';
    var HEAD0 = sh(f.co, ['rev-parse', 'HEAD']);
    HEALTH.code_identity = { head: HEAD0, pid: 4321, started_at: new Date().toISOString() };
    var gitConfig = { repo: f.co, git: git, expected_remote_url: f.origin };
    var driftExtra = { health_url: healthUrl };
    var ledger = function () { return A.ledgerTail(200); };
    var ledgerCount = function (op, code) { return ledger().filter(function (e) { return e.op === op && (!code || e.code === code); }).length; };
    var restarts = 0;
    var restartFn = function () { restarts++; HEALTH.code_identity = { head: sh(f.co, ['rev-parse', 'HEAD']), pid: 4322 }; return { ok: true }; };
    var tickOpts = { git_config: gitConfig, drift: driftExtra, restartFn: restartFn, alive: function () { return true; }, live_cwds: [], health_poll_ms: 5, health_wait_ms: 500, state: state };
    return A.tick(tickOpts).then(function (s) {
      eq(s.drift, 'CURRENT', 'tick #1: CURRENT'); eq(s.sync.code, G.CODES.NOOP, 'tick #1: sync NOOP');
      ok(fs.existsSync(path.join(R0, 'state.json')), 'state.json written'); eq(ledgerCount('state-change'), 1, 'first state ledgered once');
      return A.tick(tickOpts);
    }).then(function (s) {
      eq(ledgerCount('state-change'), 1, 'idempotent: unchanged state not re-ledgered');
      f.commit('c2');
      return A.tick(tickOpts);
    }).then(function (s) {
      eq(s.sync.code, G.CODES.DRY_RUN, 'no marker → sync is a DRY_RUN'); eq(sh(f.co, ['rev-parse', 'HEAD']), HEAD0, 'checkout untouched in observe mode');
      eq(s.drift, 'CODE_BEHIND_SOURCE', 'drift CODE_BEHIND_SOURCE'); eq(s.state.DEPLOYMENT.state, 'DRIFTED', 'DEPLOYMENT DRIFTED');
      eq(ledgerCount('git-sync', 'DRY_RUN'), 1, 'dry-run decision ledgered');
      return A.tick(tickOpts);
    }).then(function (s) {
      eq(ledgerCount('git-sync', 'DRY_RUN'), 1, 'same dry-run decision not re-ledgered');
      fs.mkdirSync(R0, { recursive: true }); fs.writeFileSync(path.join(R0, 'sync.enabled'), '');
      return A.tick(tickOpts);
    }).then(function (s) {
      var HEAD1 = sh(f.co, ['rev-parse', 'HEAD']);
      ok(s.actions.some(function (a) { return a.op === 'git-sync' && a.verified; }), 'marker → sync applied + verified');
      eq(HEAD1, sh(f.dev, ['rev-parse', 'HEAD']), 'checkout == origin/main');
      eq(s.drift, 'EXECUTOR_RESTART_REQUIRED', 'after sync: EXECUTOR_RESTART_REQUIRED (not a vague failure)');
      ok(s.actions.some(function (a) { return a.op === 'restart-request'; }), 'restart request created');
      eq(A.restart.openRequest(R0).expected_sha, HEAD1, 'request keyed by the new SHA');
      eq(restarts, 0, 'no restart without approval');
      eq(s.state.EXECUTOR.state, 'RESTART_REQUIRED', 'unified state says RESTART_REQUIRED');
      return A.tick(tickOpts);
    }).then(function (s) {
      eq(restarts, 0, 'still no restart (idempotent request, no approval)'); ok(!s.actions.some(function (a) { return a.op === 'restart-request'; }), 'no duplicate request');
      var HEAD1 = sh(f.co, ['rev-parse', 'HEAD']);
      var ap = A.restart.approve(R0, HEAD1, { by: 'Othman Haddad', reason: 'merged PR, restart to load it' });
      ok(ap.ok, 'owner approves');
      return A.tick(tickOpts);
    }).then(function (s) {
      eq(restarts, 1, 'approved → exactly one restart'); ok(s.actions.some(function (a) { return a.op === 'restart' && a.code === 'HEALTHY'; }), 'restart HEALTHY');
      eq(s.drift, 'CURRENT', 'after restart: CURRENT'); eq(s.state.DEPLOYMENT.state, 'CURRENT', 'DEPLOYMENT CURRENT');
      return A.tick(tickOpts);
    }).then(function (s) {
      eq(restarts, 1, 'idempotent: no duplicate restart');
      // concurrent reconciler: hold the tick lock, tick must skip
      var held = lock.acquire(R0, 'tick');
      ok(held.acquired, 'test holds the tick lock');
      return A.tick(tickOpts).then(function (sk) { ok(sk.skipped && sk.reason === 'already_running', 'concurrent tick skipped, never parallel'); lock.release(held.lock); });
    }).then(function () {
      // fail-closed: dirty checkout + new commit → BLOCKED, no mutation, no restart request
      fs.writeFileSync(path.join(f.co, 'README.md'), 'operator edit\n');
      f.commit('c3');
      return A.tick(tickOpts).then(function (s) {
        eq(s.sync.code, G.CODES.DIRTY, 'dirty → BLOCKED even with the marker'); eq(fs.readFileSync(path.join(f.co, 'README.md'), 'utf8'), 'operator edit\n', 'local edit preserved');
        eq(s.state.DEPLOYMENT.state, 'DRIFTED', 'DRIFTED while blocked'); eq(restarts, 1, 'no restart on a blocked sync');
        eq(ledgerCount('git-sync', G.CODES.DIRTY), 1, 'BLOCKED decision ledgered once');
        sh(f.co, ['checkout', '--', 'README.md']);
      });
    }).then(function () {
      // kill switch: everything observes
      process.env.MYTHOS_AUTOPILOT = 'off';
      return A.tick(tickOpts).then(function (s) {
        eq(s.sync.code, G.CODES.DRY_RUN, 'MYTHOS_AUTOPILOT=off → dry run despite marker'); delete process.env.MYTHOS_AUTOPILOT;
      });
    });
  }).then(function () {
    // =====================================================================================
    section('CLI smoke');
    var r = cp.spawnSync(process.execPath, [path.join(EXEC, 'bin', 'mythos-autopilot')], { encoding: 'utf8' });
    eq(r.status, 2, 'usage exits 2');
    var m = cp.spawnSync(process.execPath, [path.join(EXEC, 'bin', 'mythos-autopilot'), 'map'], { encoding: 'utf8', cwd: BASE });
    ok(m.status === 0 && JSON.parse(m.stdout).suites['tests/mythos-autopilot-test.js'], 'map command lists this suite');
    var st = cp.spawnSync(process.execPath, [path.join(EXEC, 'bin', 'mythos-autopilot'), 'status'], { encoding: 'utf8', env: Object.assign({}, process.env) });
    ok(st.status === 0 && JSON.parse(st.stdout).DEPLOYMENT, 'status command reads the last state');
    var rs = cp.spawnSync(process.execPath, [path.join(EXEC, 'bin', 'mythos-autopilot'), 'restart', 'approve', 'z'.repeat(40), '--by', 'claude', '--reason', 'automated attempt here'], { encoding: 'utf8' });
    eq(rs.status, 3, 'CLI refuses an automated approver');
    // executor health carries code_identity (module contract)
    var ex = require(path.join(EXEC, 'executor.js'));
    var ci = ex.codeIdentity();
    var sameOwner = (function () { try { return fs.statSync(EXEC).uid === process.getuid(); } catch (e) { return false; } })();
    if (sameOwner) ok(ci && ci.verified && /^[0-9a-f]{40}$/.test(ci.head), 'executor exposes a verified code identity');
    else ok(ci && ci.verified === false && ci.reason, 'executor code identity fails closed (verified:false + reason) when git refuses the checkout (foreign owner)');
    ok(ci && ci.started_at && ci.pid === process.pid, 'code identity carries pid + start time');
  }).then(done, function (e) { console.error('UNEXPECTED: ' + (e && e.stack || e)); failed++; failures.push('unexpected: ' + (e && e.message)); done(); });
}).catch(function (e) { console.error(e); process.exit(1); });

function done() {
  try { healthServer.close(); } catch (e) { /* */ }
  try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) { /* */ }
  console.log('\nmythos-autopilot-test: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('failures:\n - ' + failures.join('\n - ')); }
  process.exit(failed ? 1 : 0);
}
