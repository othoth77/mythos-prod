'use strict';
// =====================================================
// MYTHOS — START GATES (predecessor dependencies the bridge proves itself)
// tests/v32-start-gate-test.js
//
//   Part 1  start-gates.js against a fixture git repo: A-E one residual
//           missing → gate unmet; F all proven → met; hold/unknown/invalid/
//           foreign-project gates fail closed; overlay is add-only.
//   Part 2  the committed manifests against THIS repository (R2-R5 evidence
//           really is on main; R1 probe stubbed) and their scope (H: Haddad
//           projects are never gated by them).
//   Part 3  the real R1 probe (gates/probes/othk-v32-closeout.js) against a
//           throwaway store seeded from the committed seeds + fake HTTP
//           services: passes, then fails for each broken precondition.
//   Part 4  real bridge ticks: an ungated task is claimed as before (G); a
//           gated task waits while a residual is unproven, and is claimed by
//           the normal tick — once — when all are proven (A/F end to end);
//           a held task never starts; `gate-*` task ids are refused.
//
// Offline and deterministic. Run with: node tests/v32-start-gate-test.js
// =====================================================
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIX = path.join(os.homedir(), 'v32-start-gate-test-' + process.pid);
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
process.env.MYTHOS_BRIDGE_GATES_DIR = path.join(FIX, 'gates');
process.env.OTHMODE_STORE_ROOT = path.join(FIX, 'othstore');
fs.mkdirSync(process.env.OTHMODE_STORE_ROOT, { recursive: true, mode: 0o700 });
delete process.env.MYTHOS_MOCK_SCRIPT;

var gates = require(path.join(EXEC, 'bridge', 'start-gates'));

var passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.error('FAIL: ' + name); } }
function git(cwd, args) {
  return cp.execFileSync('git', args, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' }) }).trim();
}
function writeJson(f, o) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); }

// ---------------------------------------------------------------- fixture repository
var ORIGIN = path.join(FIX, 'origin.git');
var REPO = path.join(FIX, 'repo');
var PLANNER = path.join(FIX, 'planner');
git(FIX, ['init', '--bare', '-q', '-b', 'main', ORIGIN]);
git(FIX, ['clone', '-q', ORIGIN, REPO]);
fs.writeFileSync(path.join(REPO, 'README.md'), '# fixture\n');
fs.writeFileSync(path.join(REPO, 'residuals.md'), '| 2 | R2 | **CLOSED.** |\n| 3 | R3 | **DOCUMENTED.** |\n| 4 | R4 | **CLOSED.** |\n| 5 | R5 | **CLOSED.** |\n');
git(REPO, ['add', '.']);
git(REPO, ['commit', '-q', '-m', 'init with residual evidence']);
var ON_MAIN = git(REPO, ['rev-parse', 'HEAD']);
git(REPO, ['push', '-q', 'origin', 'main']);
// A commit that exists locally but was never merged to main (an unmerged PR).
git(REPO, ['checkout', '-q', '-b', 'side']);
fs.writeFileSync(path.join(REPO, 'side.md'), 'unmerged\n');
git(REPO, ['add', 'side.md']);
git(REPO, ['commit', '-q', '-m', 'unmerged work']);
var OFF_MAIN = git(REPO, ['rev-parse', 'HEAD']);
git(REPO, ['checkout', '-q', 'main']);
git(REPO, ['fetch', '-q', 'origin']);
git(FIX, ['clone', '-q', ORIGIN, PLANNER]);

// Fixture probe: passes iff the flag file says "ok".
var GATES = process.env.MYTHOS_BRIDGE_GATES_DIR;
var FLAG = path.join(FIX, 'r1.flag');
fs.mkdirSync(path.join(GATES, 'probes'), { recursive: true });
fs.writeFileSync(path.join(GATES, 'probes', 'fixture-r1.js'),
  "var a=JSON.parse(process.argv[2]||'{}');var fs=require('fs');var ok=false;try{ok=fs.readFileSync(a.flag,'utf8').trim()==='ok'}catch(e){}\n" +
  "console.log(JSON.stringify({ok:ok,checks:[{name:'r1',ok:ok,detail:ok?'proven':'not proven'}]}));process.exit(ok?0:1);\n");

function residualManifest(id, project, broken, appliesTo) {
  // ev(rid, [proof, missingProof]): the missing variant when `broken` names rid.
  function ev(rid, pair) { return [broken === rid ? pair[1] : pair[0]]; }
  var reqs = [
    { id: 'R1', evidence: [{ type: 'probe', probe: 'fixture-r1', args: { flag: FLAG } }] },
    { id: 'R2', evidence: ev('R2', [{ type: 'file_on_main', path: 'residuals.md', contains: ['| 2 | R2 | **CLOSED.** |'] }, { type: 'file_on_main', path: 'residuals.md', contains: ['| 2 | R2 | **NOT DONE** |'] }]) },
    { id: 'R3', evidence: ev('R3', [{ type: 'file_on_main', path: 'residuals.md', contains: ['**DOCUMENTED.**'] }, { type: 'file_on_main', path: 'missing-doc.md', contains: ['x'] }]) },
    { id: 'R4', evidence: ev('R4', [{ type: 'commit_on_main', commit: ON_MAIN }, { type: 'commit_on_main', commit: OFF_MAIN }]) },
    { id: 'R5', evidence: ev('R5', [{ type: 'commit_on_main', commit: ON_MAIN }, { type: 'commit_on_main', commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }]) }
  ];
  var m = { gate: id, project: project, description: 'fixture', requirements: reqs };
  if (appliesTo) m.applies_to = appliesTo;
  return m;
}
function ctxFor(dir, project) { return gates.context({ project: project || 'executor-selftest', repo: REPO, remote: 'origin' }, { dir: dir }); }

// ================================================================ Part 1: unit
(function () {
  var dir = path.join(FIX, 'unit-gates');
  fs.mkdirSync(path.join(dir, 'probes'), { recursive: true });
  fs.copyFileSync(path.join(GATES, 'probes', 'fixture-r1.js'), path.join(dir, 'probes', 'fixture-r1.js'));
  function evalWith(broken, r1ok) {
    fs.writeFileSync(FLAG, r1ok ? 'ok' : 'no');
    writeJson(path.join(dir, 'gate-unit-v32.json'), residualManifest('gate-unit-v32', 'executor-selftest', broken));
    return gates.evaluate(ctxFor(dir), 'gate-unit-v32');
  }
  var a = evalWith(null, false);
  ok(!a.satisfied && a.reasons.length === 1 && /^R1: probe fixture-r1 failed/.test(a.reasons[0]), 'A: R1 unproven → gate unmet, reason names R1');
  ['R2', 'R3', 'R4', 'R5'].forEach(function (rid, i) {
    var r = evalWith(rid, true);
    ok(!r.satisfied && r.reasons.length === 1 && r.reasons[0].indexOf(rid + ':') === 0, String.fromCharCode(66 + i) + ': ' + rid + ' unproven → gate unmet, reason names ' + rid + ' (' + r.reasons[0] + ')');
  });
  var r4 = evalWith('R4', true);
  ok(/is not on refs\/remotes\/origin\/main/.test(r4.reasons[0]), 'R4 case: a commit that exists but is not merged to main is NOT evidence');
  var f = evalWith(null, true);
  ok(f.satisfied && f.requirements.length === 5 && f.requirements.every(function (x) { return x.satisfied; }), 'F: R1-R5 all proven → gate satisfied');

  // fail-closed shapes
  var c = ctxFor(dir);
  ok(!gates.evaluate(c, 'gate-does-not-exist').satisfied, 'fail-closed: unknown gate is unmet');
  writeJson(path.join(dir, 'gate-unit-hold.json'), { gate: 'gate-unit-hold', project: 'executor-selftest', hold: true, release: 'owner PR' });
  writeJson(path.join(dir, 'gate-unit-empty.json'), { gate: 'gate-unit-empty', project: 'executor-selftest', requirements: [] });
  writeJson(path.join(dir, 'gate-unit-badtype.json'), { gate: 'gate-unit-badtype', project: 'executor-selftest', requirements: [{ id: 'X', evidence: [{ type: 'always_true' }] }] });
  writeJson(path.join(dir, 'gate-unit-foreign.json'), residualManifest('gate-unit-foreign', 'some-other-project', null));
  writeJson(path.join(dir, 'gate-unit-misnamed.json'), residualManifest('gate-unit-elsewhere', 'executor-selftest', null));
  fs.writeFileSync(path.join(dir, 'gate-unit-garbage.json'), '{ not json');
  fs.writeFileSync(path.join(dir, 'probes', 'fixture-crash.js'), 'process.exit(0);\n');
  writeJson(path.join(dir, 'gate-unit-silent.json'), { gate: 'gate-unit-silent', project: 'executor-selftest', requirements: [{ id: 'P', evidence: [{ type: 'probe', probe: 'fixture-crash' }] }] });
  writeJson(path.join(dir, 'gate-unit-noprobe.json'), { gate: 'gate-unit-noprobe', project: 'executor-selftest', requirements: [{ id: 'P', evidence: [{ type: 'probe', probe: 'not-installed' }] }] });
  fs.writeFileSync(FLAG, 'ok');
  c = ctxFor(dir);
  var hold = gates.evaluate(c, 'gate-unit-hold');
  ok(!hold.satisfied && /^HOLD: owner PR/.test(hold.reasons[0]), 'fail-closed: a hold gate never opens and says how it is released');
  ok(!gates.evaluate(c, 'gate-unit-empty').satisfied, 'fail-closed: zero requirements is not "nothing to prove"');
  ok(!gates.evaluate(c, 'gate-unit-badtype').satisfied, 'fail-closed: unknown evidence type');
  ok(/belongs to project some-other-project/.test(gates.evaluate(c, 'gate-unit-foreign').reasons[0]), 'fail-closed: a gate for another project never opens here');
  ok(!gates.evaluate(c, 'gate-unit-elsewhere').satisfied, 'fail-closed: manifest whose file name does not match its gate id');
  ok(c.manifests.problems.some(function (p) { return /gate-unit-garbage/.test(p); }) && !gates.evaluate(c, 'gate-unit-garbage').satisfied, 'fail-closed: unparsable manifest reported, its gate unmet');
  ok(/did not finish|failed/.test(gates.evaluate(c, 'gate-unit-silent').reasons[0]), 'fail-closed: a probe that exits 0 without {"ok":true} is a failure');
  ok(/not installed/.test(gates.evaluate(c, 'gate-unit-noprobe').reasons[0]), 'fail-closed: a probe that is not installed');
  var slow = gates.context({ project: 'executor-selftest', repo: REPO }, { dir: dir, runProbe: function () { return { status: null, signal: 'SIGTERM', stdout: '', stderr: '' }; } });
  ok(/did not finish/.test(gates.evaluate(slow, 'gate-unit-v32').reasons[0]), 'fail-closed: a probe killed by its timeout');
  var noRepo = gates.context({ project: 'executor-selftest', repo: path.join(FIX, 'no-such-repo') }, { dir: dir });
  var nr = gates.evaluate(noRepo, 'gate-unit-v32');
  ok(!nr.satisfied && nr.reasons.length === 4, 'fail-closed: no git repository → every git-evidenced residual unmet');
  var calls = 0;
  // duplicate gate ids: neither copy wins
  writeJson(path.join(dir, 'gate-unit-dup-a.json'), { gate: 'gate-unit-dup', project: 'executor-selftest', hold: true });
  writeJson(path.join(dir, 'gate-unit-dup-b.json'), residualManifest('gate-unit-dup', 'executor-selftest', null));
  var dup = ctxFor(dir);
  ok(!gates.evaluate(dup, 'gate-unit-dup').satisfied && dup.manifests.problems.some(function (p) { return /duplicate gate id gate-unit-dup/.test(p); }), 'fail-closed: two manifests declaring one gate id → invalid, neither wins');
  fs.unlinkSync(path.join(dir, 'gate-unit-dup-a.json')); fs.unlinkSync(path.join(dir, 'gate-unit-dup-b.json'));
  // liveness: evidence merged to main after the checkout last fetched is seen (one bounded fetch per context)
  var late = path.join(FIX, 'late-clone');
  git(FIX, ['clone', '-q', ORIGIN, late]);
  fs.writeFileSync(path.join(late, 'late.md'), 'merged later\n');
  git(late, ['add', 'late.md']); git(late, ['commit', '-q', '-m', 'late evidence']); git(late, ['push', '-q', 'origin', 'main']);
  writeJson(path.join(dir, 'gate-unit-late.json'), { gate: 'gate-unit-late', project: 'executor-selftest', requirements: [{ id: 'L', evidence: [{ type: 'file_on_main', path: 'late.md', contains: ['merged later'] }] }] });
  ok(!gates.evaluate(gates.context({ project: 'executor-selftest', repo: REPO, remote: 'origin' }, { dir: dir, fetchMain: false }), 'gate-unit-late').satisfied, 'liveness: without a fetch the stale ref does not show the new evidence (fail-closed)');
  var fresh = ctxFor(dir);
  ok(gates.evaluate(fresh, 'gate-unit-late').satisfied && fresh.fetched && fresh.fetched.ok, 'liveness: the context fetches main once, so evidence merged since the last fetch is seen');
  var memo = gates.context({ project: 'executor-selftest', repo: REPO }, { dir: dir, runProbe: function () { calls++; return { status: 0, stdout: '{"ok":true}' }; } });
  gates.evaluate(memo, 'gate-unit-v32'); gates.evaluate(memo, 'gate-unit-v32');
  ok(calls === 1, 'a gate is evaluated at most once per tick context');

  // overlay: add-only, project-scoped
  writeJson(path.join(dir, 'gate-unit-v32.json'), residualManifest('gate-unit-v32', 'executor-selftest', null, ['gh-issue-461']));
  c = ctxFor(dir);
  ok(JSON.stringify(gates.effectiveDepends(c, { task_id: 'gh-issue-461', depends_on: ['gh-issue-7'] })) === JSON.stringify(['gh-issue-7', 'gate-unit-v32']), 'overlay: adds the gate and keeps the task\'s own dependencies');
  ok(JSON.stringify(gates.effectiveDepends(c, { task_id: 'gh-issue-462' })) === '[]', 'G (unit): a task no manifest names gets no dependency');
  ok(JSON.stringify(gates.effectiveDepends(c, { task_id: 'gh-issue-462', depends_on: ['gh-issue-7'] })) === JSON.stringify(['gh-issue-7']), 'G (unit): an ungated task keeps exactly its own depends_on');
  ok(gates.overlayFor(ctxFor(dir, 'mythos-haddad'), 'gh-issue-461').length === 0, 'H (unit): a manifest for another project does not gate this bridge\'s tasks');
})();

// ================================================================ Part 2: committed manifests
(function () {
  var realDir = path.join(EXEC, 'bridge', 'gates');
  var probeOk = function () { return { status: 0, stdout: JSON.stringify({ ok: true, checks: [] }) }; };
  var real = gates.context({ project: 'mythos-prod', repo: BASE, remote: 'origin' }, { dir: realDir, runProbe: probeOk, fetchMain: false });
  ok(real.manifests.problems.length === 0 && Object.keys(real.manifests.byId).every(function (k) { return real.manifests.byId[k].errors.length === 0; }), 'committed manifests: all parse and validate');
  var hasMain = cp.spawnSync('git', ['-C', BASE, 'rev-parse', '--verify', '-q', 'refs/remotes/origin/main']).status === 0 &&
    cp.spawnSync('git', ['-C', BASE, 'cat-file', '-e', '9ea47705f8771e6de1051d064332abdfa5de42c3^{commit}']).status === 0;
  if (hasMain) {
    var v = gates.evaluate(real, 'gate-v32-residuals');
    ok(v.satisfied && v.requirements.map(function (r) { return r.id; }).join(',') === 'R1,R2,R3,R4,R5', 'committed gate-v32-residuals: R2-R5 evidence is really on main (R1 probe stubbed): ' + v.reasons.join(' | '));
    var r1fail = gates.context({ project: 'mythos-prod', repo: BASE, remote: 'origin' }, { dir: realDir, fetchMain: false, runProbe: function () { return { status: 1, stdout: JSON.stringify({ ok: false, checks: [{ name: 'project_context', ok: false, detail: 'total=35' }] }) }; } });
    var vf = gates.evaluate(r1fail, 'gate-v32-residuals');
    ok(!vf.satisfied && /^R1: probe othk-v32-closeout failed .*project_context: total=35/.test(vf.reasons[0]), 'committed gate-v32-residuals: an unproven R1 keeps it closed and says why');
  } else {
    console.log('skip: no origin/main history in this checkout (shallow CI clone)');
  }
  ok(!gates.evaluate(real, 'gate-owner-hold').satisfied, 'committed gate-owner-hold never opens');
  ok(JSON.stringify(gates.overlayFor(real, 'gh-issue-461')) === '["gate-v32-residuals"]', 'committed overlay: #461 waits for V3.2');
  ok(JSON.stringify(gates.overlayFor(real, 'gh-issue-196')) === '["gate-owner-hold"]' && JSON.stringify(gates.overlayFor(real, 'gh-issue-389')) === '["gate-owner-hold"]', 'committed overlay: #196 and #389 are held for an owner decision');
  ok(gates.overlayFor(real, 'gh-issue-460').length === 0 && gates.overlayFor(real, 'gh-test-0001').length === 0, 'G: committed manifests gate nothing else');
  ['mythos-haddad', 'oth-knowledge'].forEach(function (p) {
    var h = gates.context({ project: p, repo: BASE, remote: 'origin' }, { dir: realDir, runProbe: probeOk, fetchMain: false });
    ok(gates.overlayFor(h, 'gh-issue-461').length === 0 && gates.overlayFor(h, 'gh-issue-196').length === 0 && gates.effectiveDepends(h, { task_id: 'gh-issue-447', depends_on: ['gh-issue-446'] }).join() === 'gh-issue-446',
      'H: Haddad instance (' + p + ') is not gated by the VPS manifests; its own depends_on is unchanged');
    ok(!gates.evaluate(h, 'gate-v32-residuals').satisfied, 'H: a Haddad task naming the VPS gate stays unmet (foreign project, fail-closed)');
  });
})();

// ================================================================ Part 3: the real R1 probe
function serve(handler) {
  return new Promise(function (resolve) {
    var s = http.createServer(handler);
    s.listen(0, '127.0.0.1', function () { resolve(s); });
  });
}
// Async on purpose: the fake services below live in THIS process, so a
// blocking spawn would starve them and every HTTP check would fail for the
// wrong reason.
function runProbe(args) {
  return new Promise(function (resolve) {
    cp.execFile(process.execPath, [path.join(EXEC, 'bridge', 'gates', 'probes', 'othk-v32-closeout.js'), JSON.stringify(args)], { encoding: 'utf8', timeout: 180000 }, function (err, stdout) {
      var j = null;
      try { j = JSON.parse(String(stdout).trim().split('\n').pop()); } catch (e) { j = null; }
      resolve({ status: err ? (typeof err.code === 'number' ? err.code : 1) : 0, json: j, byName: function (n) { return j && j.checks.filter(function (c) { return c.name === n; })[0]; } });
    });
  });
}

function part3() {
  var tracked = cp.spawnSync('git', ['-C', BASE, 'ls-files', '--', 'projects/oth-knowledge/seeds'], { encoding: 'utf8' }).stdout.split('\n').filter(function (f) { return /\.json$/.test(f); });
  if (tracked.length < 2) { console.log('skip part 3: no committed seeds'); return Promise.resolve(); }
  var CLI = path.join(BASE, 'projects', 'oth-knowledge', 'cli', 'othk-cli.js');
  var store = fs.mkdtempSync(path.join(os.tmpdir(), 'v32-gate-store-'));
  var partial = fs.mkdtempSync(path.join(os.tmpdir(), 'v32-gate-partial-'));
  tracked.forEach(function (f) { cp.execFileSync(process.execPath, [CLI, '--store', store, 'seed', path.join(BASE, f)], { stdio: 'ignore' }); });
  tracked.slice(0, -1).forEach(function (f) { cp.execFileSync(process.execPath, [CLI, '--store', partial, 'seed', path.join(BASE, f)], { stdio: 'ignore' }); });
  var rels = require(path.join(BASE, 'projects', 'oth-knowledge', 'lib', 'store.js')).openStore(store).allRecords({ kind: 'relationship' }).length;
  var health = { status: 'ok', store_available: true };
  var projects = { total: 3, projects: [{ id: 'a' }, { id: 'mythos-haddad', shared_platform_capabilities: ['x'] }, { id: 'c' }] };
  var servers = [];
  return Promise.all([
    serve(function (req, res) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(health)); }),
    serve(function (req, res) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(projects)); })
  ]).then(function (ss) {
    servers = ss;
    var base = { repo: BASE, store: store, min_relationships: rels, expect_tracks: 3,
      health_url: 'http://127.0.0.1:' + ss[0].address().port + '/health', projects_url: 'http://127.0.0.1:' + ss[1].address().port + '/api/othmode/projects',
      search: { query: 'Haddad EXECUTES a second project oth-knowledge', mode: 'hybrid', limit: 5, expect: 'second bridge instance' } };
    function w(over) { return Object.assign({}, base, over); }
    var before = fs.readFileSync(path.join(store, 'records.jsonl'), 'utf8');
    return runProbe(base).then(function (good) {
      ok(good.status === 0 && good.json && good.json.ok === true && good.json.checks.length === 7 && good.json.checks.every(function (c) { return c.ok; }), 'R1 probe: a store closed out from the committed seeds + healthy services passes all 7 checks');
      ok(fs.readFileSync(path.join(store, 'records.jsonl'), 'utf8') === before, 'R1 probe: read-only — the canonical store is byte-identical afterwards');
      return runProbe(w({ store: partial }));
    }).then(function (r) {
      ok(r.status !== 0 && !r.byName('seed_ingestion').ok && r.byName('othk_http_health').ok, 'R1 probe: a store missing one committed seed fails seed_ingestion (and only for that reason)');
      return runProbe(w({ min_relationships: rels + 1 }));
    }).then(function (r) {
      ok(r.status !== 0 && !r.byName('relationships').ok && r.byName('seed_ingestion').ok, 'R1 probe: fewer typed relationships than required fails');
      return runProbe(w({ expect_tracks: 36 }));
    }).then(function (r) {
      ok(r.status !== 0 && !r.byName('project_context').ok && r.byName('othk_http_health').ok, 'R1 probe: a project count other than expected fails');
      return runProbe(w({ search: { query: 'nothing', mode: 'hybrid', limit: 5, expect: 'a phrase that is nowhere' } }));
    }).then(function (r) {
      ok(r.status !== 0 && !r.byName('search_claim').ok && r.byName('project_context').ok, 'R1 probe: the V3.2 claim not retrievable fails');
      health.store_available = false;
      return runProbe(base);
    }).then(function (r) {
      ok(r.status !== 0 && !r.byName('othk_http_health').ok && r.byName('project_context').ok, 'R1 probe: oth-knowledge-http without its store fails');
      health.store_available = true;
      return runProbe(w({ health_url: 'http://127.0.0.1:1/health' }));
    }).then(function (r) {
      ok(r.status !== 0 && !r.byName('othk_http_health').ok, 'R1 probe: service down fails');
      return runProbe(w({ store: path.join(FIX, 'no-store') }));
    }).then(function (r) {
      ok(r.status !== 0 && !r.byName('store_valid').ok, 'R1 probe: missing store fails');
    });
  }).then(function () {
    servers.forEach(function (s) { s.close(); });
    fs.rmSync(store, { recursive: true, force: true });
    fs.rmSync(partial, { recursive: true, force: true });
  });
}

// ================================================================ Part 4: real bridge ticks
function part4() {
  var executor = require(path.join(EXEC, 'executor'));
  var state = require(path.join(EXEC, 'lib', 'state'));
  var bridge = require(path.join(EXEC, 'bridge', 'github-bridge'));
  var cfg = bridge.config();
  bridge.init();
  function relay() { git(REPO, ['push', '-q', 'origin', 'refs/heads/mythos/control:refs/heads/mythos/control']); }
  relay();
  function plannerWrite(name, content) {
    git(PLANNER, ['fetch', '-q', 'origin', 'mythos/control']);
    var has = cp.spawnSync('git', ['rev-parse', '--verify', '-q', 'mythos/control'], { cwd: PLANNER }).status === 0;
    git(PLANNER, has ? ['checkout', '-q', 'mythos/control'] : ['checkout', '-q', '-b', 'mythos/control', 'origin/mythos/control']);
    if (has) git(PLANNER, ['reset', '-q', '--hard', 'origin/mythos/control']);
    writeJson(path.join(PLANNER, 'control', 'tasks', name), content);
    git(PLANNER, ['add', '--', 'control/tasks/' + name]);
    git(PLANNER, ['commit', '-q', '-m', 'planner: ' + name]);
    git(PLANNER, ['push', '-q', 'origin', 'mythos/control']);
  }
  function mkTask(id, over) {
    var t = { protocol: 'mythos-control/1', task_id: id, project: 'executor-selftest', objective: 'Inspect the fixture repository and report its HEAD commit.',
      scope: ['README.md'], constraints: ['read-only'], priority: 'normal', requested_action: 'investigate', validation_requirements: ['git rev-parse HEAD'],
      status: 'PENDING', created_at: '2026-09-25T12:00:00.000Z', created_by: 'gate-test' };
    Object.keys(over || {}).forEach(function (k) { t[k] = over[k]; });
    return t;
  }
  function taskOnDisk(id) { return JSON.parse(fs.readFileSync(path.join(cfg.controlDir, 'control', 'tasks', id + '.json'), 'utf8')); }
  function executorTasksFor(id) { return state.listTasks().filter(function (tid) { var t = state.readJSON(tid, 'task.json'); return t && t.stage === 'github:' + id; }); }
  function actionsOf(r, kind) { return (r.actions || []).filter(function (a) { return a.action === kind; }); }
  function claimed(r, id) { return actionsOf(r, 'claim').filter(function (a) { return a.task_id === id; }).length; }
  function waiting(r, id) { return actionsOf(r, 'wait_dependencies').filter(function (a) { return a.task_id === id; })[0]; }

  // V3.2-shaped gate over an already-queued task (overlay) and one declared by the task itself; one hold.
  fs.writeFileSync(FLAG, 'no');
  writeJson(path.join(GATES, 'gate-fixture-v32.json'), residualManifest('gate-fixture-v32', 'executor-selftest', null, ['gh-gate-queued']));
  writeJson(path.join(GATES, 'gate-fixture-hold.json'), { gate: 'gate-fixture-hold', project: 'executor-selftest', hold: true, release: 'owner PR', applies_to: ['gh-gate-old'] });

  ok(bridge.validateTask(cfg, mkTask('gate-fixture-v32'), 'gate-fixture-v32.json').some(function (e) { return /reserved for start gates/.test(e); }), 'a task can never be named like a gate (gate-* ids refused)');
  ok(bridge.validateTask(cfg, mkTask('gh-gate-body', { depends_on: ['gate-fixture-v32'] }), 'gh-gate-body.json').length === 0, 'a task may declare a gate in depends_on (existing field, existing id shape)');

  plannerWrite('gh-gate-normal.json', mkTask('gh-gate-normal'));
  plannerWrite('gh-gate-queued.json', mkTask('gh-gate-queued'));
  plannerWrite('gh-gate-body.json', mkTask('gh-gate-body', { depends_on: ['gate-fixture-v32'] }));
  plannerWrite('gh-gate-old.json', mkTask('gh-gate-old'));

  var t1 = bridge.tick(executor);
  ok(t1.ok === true, 'tick 1 ok');
  ok(claimed(t1, 'gh-gate-normal') === 1 && taskOnDisk('gh-gate-normal').status === 'CLAIMED', 'G: an ungated task is claimed on the first tick, exactly as before');
  var wq = waiting(t1, 'gh-gate-queued');
  ok(wq && wq.unmet.join() === 'gate-fixture-v32' && /^R1: /.test(wq.gates[0].reasons[0]) && claimed(t1, 'gh-gate-queued') === 0 && taskOnDisk('gh-gate-queued').status === 'PENDING',
    'A (end to end): R1 unproven → the queued task waits (overlay), PENDING, reason names R1');
  ok(waiting(t1, 'gh-gate-body') && claimed(t1, 'gh-gate-body') === 0, 'A (end to end): a task that declares the gate itself waits too');
  ok(executorTasksFor('gh-gate-queued').length === 0 && executorTasksFor('gh-gate-body').length === 0, 'nothing was created for a gated task (no executor task, no worktree)');
  ok(!fs.existsSync(path.join(FIX, 'wt', 'gh-gate-queued')), 'no task worktree for a gated task');
  ok(waiting(t1, 'gh-gate-old') && /^HOLD/.test(waiting(t1, 'gh-gate-old').gates[0].reasons[0]), 'hold: the old task waits with a HOLD reason');
  relay();

  // B: R1 proven, but R2 still missing → still waits.
  fs.writeFileSync(FLAG, 'ok');
  writeJson(path.join(GATES, 'gate-fixture-v32.json'), residualManifest('gate-fixture-v32', 'executor-selftest', 'R2', ['gh-gate-queued']));
  var t2 = bridge.tick(executor);
  ok(waiting(t2, 'gh-gate-queued') && /^R2: /.test(waiting(t2, 'gh-gate-queued').gates[0].reasons[0]) && claimed(t2, 'gh-gate-queued') === 0, 'B (end to end): R1 proven but R2 unproven → still waits, reason names R2');
  relay();

  // F: everything proven → claimed by the normal tick, once.
  writeJson(path.join(GATES, 'gate-fixture-v32.json'), residualManifest('gate-fixture-v32', 'executor-selftest', null, ['gh-gate-queued']));
  var t3 = bridge.tick(executor);
  ok(claimed(t3, 'gh-gate-queued') === 1 && taskOnDisk('gh-gate-queued').status === 'CLAIMED', 'F (end to end): R1-R5 proven → the queued task is claimed by the normal tick');
  ok(claimed(t3, 'gh-gate-body') === 1 && taskOnDisk('gh-gate-body').status === 'CLAIMED', 'F (end to end): the task that declared the gate is claimed too');
  ok(executorTasksFor('gh-gate-queued').length === 1, 'F: exactly one executor task for the released task');
  ok(waiting(t3, 'gh-gate-old') && taskOnDisk('gh-gate-old').status === 'PENDING', 'hold: the old task still waits although claims work and V3.2 is proven');
  relay();
  var t4 = bridge.tick(executor);
  ok(claimed(t4, 'gh-gate-queued') === 0 && claimed(t4, 'gh-gate-body') === 0 && executorTasksFor('gh-gate-queued').length === 1, 'no duplicate claim on the following tick');
  ok(taskOnDisk('gh-gate-normal').status === 'CLAIMED' && executorTasksFor('gh-gate-normal').length === 1, 'G: the ungated task was never disturbed');
  relay();

  // Release of a hold is an owner-reviewed manifest change, nothing else.
  writeJson(path.join(GATES, 'gate-fixture-hold.json'), { gate: 'gate-fixture-hold', project: 'executor-selftest', hold: true, release: 'owner PR', applies_to: [] });
  var t5 = bridge.tick(executor);
  ok(claimed(t5, 'gh-gate-old') === 1, 'hold: removing the task from applies_to (reviewed change) releases it on the next tick');
}

part3().then(part4).catch(function (e) { failed++; console.error('FAIL: exception ' + (e && e.stack || e)); }).then(function () {
  try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  console.log('v32-start-gate: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
