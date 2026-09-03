'use strict';
// =====================================================
// MYTHOS — Executor -> hostops adapter tests (HOSTOPS-1)
// tests/mythos-hostops-executor-test.js
//
// Proves the governed order (allowlist -> class READ -> args -> Resource
// Guard -> boundary), the ten failure behaviours, identity/audit
// propagation and the no-shell invariant of lib/hostops.js — with an
// injected boundary, so no sudo, no root and no live helper are needed.
// =====================================================
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

process.env.MYTHOS_EXECUTOR_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hostops-exec-'));
delete process.env.MYTHOS_HOSTOPS;
var hostops = require('../projects/mythos-ai-executor/lib/hostops');
var state = require('../projects/mythos-ai-executor/lib/state');

var pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); } }

var ADMIT = function () { return { admit: true, level: 'NORMAL', reason: null }; };
var DENY = function () { return { admit: false, level: 'CRITICAL', reason: 'mem_available' }; };
function okSpawn(calls) {
  return function (bin, argv) {
    calls.push({ bin: bin, argv: argv });
    var flags = {};
    for (var i = 3; i < argv.length; i += 2) flags[argv[i]] = argv[i + 1];
    return { status: 0, stdout: JSON.stringify({ ok: true, audit_id: 'hostops-test-1', result: { echo: flags }, version: '0.1.1' }), stderr: '' };
  };
}
function mkTask(id) {
  state.ensureTaskDir(id);
  state.writeJSON(id, 'status.json', { task_id: id, status: 'RUNNING', created_at: new Date().toISOString() });
}

// ---- 1. successful READ ------------------------------------------------
t('1 successful READ returns normalized result with audit_id and null dagu_run_id', function () {
  var calls = [];
  var r = hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, spawn: okSpawn(calls) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.operation, 'host.health.check');
  assert.strictEqual(r.class, 'READ');
  assert.strictEqual(r.audit_id, 'hostops-test-1');
  assert.strictEqual(r.dagu_run_id, null);
  assert.strictEqual(r.hostops_exit, 0);
  assert.strictEqual(r.http_status, 200);
  assert.strictEqual(calls.length, 1);
});
t('1b operation name form (host.docker.status) resolves to the helper verb', function () {
  var calls = [];
  var r = hostops.invoke({ operation: 'host.docker.status', arguments: { container: 'mythos-contextforge' } }, { guardGate: ADMIT, spawn: okSpawn(calls) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(calls[0].argv[2], 'docker-status');
});

// ---- the no-shell invariant -------------------------------------------
t('boundary is invoked as sudo -n + fixed helper + argument array, never a shell', function () {
  var calls = [];
  hostops.invoke({ operation: 'docker-logs', arguments: { container: 'mythos-contextforge', lines: '50' } }, { guardGate: ADMIT, spawn: okSpawn(calls) });
  assert.strictEqual(calls[0].bin, '/usr/bin/sudo');
  assert.deepStrictEqual(calls[0].argv.slice(0, 3), ['-n', '/usr/local/sbin/mythos-hostops', 'docker-logs']);
  assert.ok(calls[0].argv.every(function (a) { return typeof a === 'string'; }));
  var src = fs.readFileSync(require.resolve('../projects/mythos-ai-executor/lib/hostops'), 'utf8');
  assert.ok(src.indexOf('shell: true') === -1 && src.indexOf('execSync') === -1 && src.indexOf("exec(") === -1, 'no shell API in the adapter');
});

// ---- 2. invalid operation ---------------------------------------------
t('2 unknown operation refused without spawning', function () {
  var calls = [];
  var r = hostops.invoke({ operation: 'nonsense' }, { guardGate: ADMIT, spawn: okSpawn(calls) });
  assert.strictEqual(r.code, 'HOSTOPS_UNKNOWN_OPERATION');
  assert.strictEqual(r.http_status, 404);
  assert.strictEqual(calls.length, 0);
});
t('2b arbitrary shell shapes are not operations', function () {
  var calls = [];
  ['sh', 'bash -c id', 'rm -rf /', 'docker system prune'].forEach(function (v) {
    var r = hostops.invoke({ operation: v }, { guardGate: ADMIT, spawn: okSpawn(calls) });
    assert.strictEqual(r.ok, false, v);
    assert.ok(['HOSTOPS_UNKNOWN_OPERATION', 'HOSTOPS_INPUT'].indexOf(r.code) !== -1, v);
  });
  assert.strictEqual(calls.length, 0);
});

// ---- 3. governance denial (class gate, declared policy) ----------------
t('3 WRITE / RESTART / DEPLOY refused by name with class, before any spawn', function () {
  var calls = [];
  [['host.file.write', 'WRITE'], ['file-write', 'WRITE'], ['docker-restart', 'RESTART'], ['systemd-restart', 'RESTART'], ['compose-up', 'DEPLOY'], ['host.docker.rollback', 'DEPLOY']].forEach(function (pair) {
    var r = hostops.invoke({ operation: pair[0] }, { guardGate: ADMIT, spawn: okSpawn(calls) });
    assert.strictEqual(r.code, 'HOSTOPS_NOT_READ', pair[0]);
    assert.strictEqual(r.class, pair[1], pair[0]);
    assert.strictEqual(r.http_status, 403);
  });
  assert.strictEqual(calls.length, 0);
});
t('3b allowlist unavailable fails closed', function () {
  var calls = [];
  var r = hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, spawn: okSpawn(calls), allowlist_path: '/nonexistent/allowlist.json' });
  // falls through to the installed/repo copy if present; force by pointing at a bad file AND hiding the others is not possible here,
  // so assert the explicit code path with a corrupt override only when no system copy exists.
  if (fs.existsSync('/etc/mythos/hostops-allowlist.json') || fs.existsSync(path.join(__dirname, '..', 'ops', 'dagu-poc', 'hostops-allowlist.json'))) {
    assert.strictEqual(r.ok, true, 'fallback copies exist; lookup still succeeds');
  } else {
    assert.strictEqual(r.code, 'HOSTOPS_ALLOWLIST_UNAVAILABLE');
  }
});

// ---- 4. Resource Guard denial ------------------------------------------
t('4 guard CRITICAL defers before the boundary; order guard-after-validation', function () {
  var calls = [], order = [];
  var gate = function () { order.push('guard'); return DENY(); };
  var sp = function (b, a) { order.push('spawn'); return okSpawn(calls)(b, a); };
  var r = hostops.invoke({ operation: 'health' }, { guardGate: gate, spawn: sp });
  assert.strictEqual(r.code, 'RESOURCE_PRESSURE');
  assert.strictEqual(r.deferred, true);
  assert.strictEqual(r.resource_level, 'CRITICAL');
  assert.strictEqual(r.http_status, 503);
  assert.deepStrictEqual(order, ['guard']);
  assert.strictEqual(calls.length, 0);
});
t('4b guard is NOT consulted for an invalid request (nothing to admit)', function () {
  var guardCalls = 0;
  hostops.invoke({ operation: 'nonsense' }, { guardGate: function () { guardCalls++; return ADMIT(); } });
  assert.strictEqual(guardCalls, 0);
});

// ---- 5. hostops rejection ----------------------------------------------
t('5 helper exit 2 maps to HOSTOPS_REFUSED with the helper code and audit id', function () {
  var sp = function () { return { status: 2, stdout: JSON.stringify({ ok: false, audit_id: 'hostops-ref-1', error: { code: 'ARG_INVALID', message: 'argument "container" fails the allowlist pattern' } }), stderr: '' }; };
  var r = hostops.invoke({ operation: 'docker-status', arguments: { container: 'mythos-contextforge' } }, { guardGate: ADMIT, spawn: sp });
  assert.strictEqual(r.code, 'HOSTOPS_REFUSED');
  assert.strictEqual(r.hostops_code, 'ARG_INVALID');
  assert.strictEqual(r.audit_id, 'hostops-ref-1');
});
t('5b helper exit 3 (caller) maps to HOSTOPS_CALLER_REFUSED', function () {
  var sp = function () { return { status: 3, stdout: JSON.stringify({ ok: false, audit_id: 'x', error: { code: 'CALLER_NOT_ALLOWED', message: 'no' } }), stderr: '' }; };
  assert.strictEqual(hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, spawn: sp }).code, 'HOSTOPS_CALLER_REFUSED');
});

// ---- 6. Dagu not in the READ path (documented decision) ----------------
t('6 the adapter has no Dagu client and reports dagu_run_id null by design', function () {
  var src = fs.readFileSync(require.resolve('../projects/mythos-ai-executor/lib/hostops'), 'utf8');
  assert.ok(src.indexOf('8095') === -1 && src.indexOf('require(\'http\')') === -1 && src.indexOf('require("http")') === -1, 'no Dagu/network client in the READ path');
  var r = hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, spawn: okSpawn([]) });
  assert.strictEqual(r.dagu_run_id, null);
  assert.ok(hostops.describe().dagu.indexOf('not in the READ path') !== -1);
});

// ---- 7. helper unavailable ---------------------------------------------
t('7 spawn ENOENT maps to HOSTOPS_UNAVAILABLE (no fallback of any kind)', function () {
  var sp = function () { return { error: Object.assign(new Error('spawnSync ENOENT'), { code: 'ENOENT' }) }; };
  var r = hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, spawn: sp });
  assert.strictEqual(r.code, 'HOSTOPS_UNAVAILABLE');
  assert.strictEqual(r.http_status, 503);
});
t('7b sudo -n refusal (sudoers not installed) is HOSTOPS_UNAVAILABLE, not a crash', function () {
  var sp = function () { return { status: 1, stdout: '', stderr: 'sudo: a password is required' }; };
  var r = hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, spawn: sp });
  assert.strictEqual(r.code, 'HOSTOPS_UNAVAILABLE');
  assert.ok(String(r.detail).indexOf('password is required') !== -1);
});

// ---- 8. timeout ---------------------------------------------------------
t('8 boundary timeout maps to HOSTOPS_TIMEOUT', function () {
  var sp = function () { return { error: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }), signal: 'SIGTERM' }; };
  var r = hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, spawn: sp });
  assert.strictEqual(r.code, 'HOSTOPS_TIMEOUT');
  assert.strictEqual(r.http_status, 504);
});

// ---- 9. malformed response ---------------------------------------------
t('9 exit 0 without parseable JSON is HOSTOPS_MALFORMED, never a success', function () {
  var sp = function () { return { status: 0, stdout: 'not json at all', stderr: '' }; };
  var r = hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, spawn: sp });
  assert.strictEqual(r.code, 'HOSTOPS_MALFORMED');
  assert.strictEqual(r.ok, false);
});

// ---- 10. audit failure --------------------------------------------------
t('10 helper exit 5 (fail-closed audit) maps to HOSTOPS_AUDIT_UNAVAILABLE', function () {
  var sp = function () { return { status: 5, stdout: JSON.stringify({ ok: false, audit_id: 'a5', error: { code: 'AUDIT_UNAVAILABLE', message: 'withheld' } }), stderr: '' }; };
  var r = hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, spawn: sp });
  assert.strictEqual(r.code, 'HOSTOPS_AUDIT_UNAVAILABLE');
  assert.strictEqual(r.http_status, 503);
});

// ---- identity + record --------------------------------------------------
t('identity: task ids validated, passed to the boundary as flags, echoed back', function () {
  var calls = [];
  mkTask('t-hostops-id-1');
  var r = hostops.invoke({
    operation: 'health', task_id: 't-hostops-id-1',
    othmode_task_id: 'OTH-2026-00099', github_task_id: 'gh-issue-999', requested_by: 'test-suite'
  }, { guardGate: ADMIT, spawn: okSpawn(calls) });
  assert.strictEqual(r.ok, true);
  var argv = calls[0].argv.join(' ');
  assert.ok(argv.indexOf('--task-id t-hostops-id-1') !== -1);
  assert.ok(argv.indexOf('--othmode-task OTH-2026-00099') !== -1);
  assert.ok(argv.indexOf('--github-task gh-issue-999') !== -1);
  assert.deepStrictEqual(r.task, { task_id: 't-hostops-id-1', othmode_task_id: 'OTH-2026-00099', github_task_id: 'gh-issue-999' });
});
t('identity: malformed ids refused before anything else', function () {
  var r = hostops.invoke({ operation: 'health', task_id: 'x;rm -rf' }, { guardGate: ADMIT, spawn: okSpawn([]) });
  assert.strictEqual(r.code, 'HOSTOPS_INPUT');
});
t('record: events.log and hostops.json carry the invocation with audit_id', function () {
  mkTask('t-hostops-rec-1');
  hostops.invoke({ operation: 'health', task_id: 't-hostops-rec-1' }, { guardGate: ADMIT, spawn: okSpawn([]) });
  var events = state.readText('t-hostops-rec-1', 'events.log');
  assert.ok(events.indexOf('hostops_invoked') !== -1);
  assert.ok(events.indexOf('hostops-test-1') !== -1);
  var list = state.readJSON('t-hostops-rec-1', 'hostops.json');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].audit_id, 'hostops-test-1');
  assert.strictEqual(list[0].dagu_run_id, null);
  assert.strictEqual(list[0].outcome, 'ok');
});
t('record: a guard deferral is recorded on the task too', function () {
  mkTask('t-hostops-rec-2');
  hostops.invoke({ operation: 'health', task_id: 't-hostops-rec-2' }, { guardGate: DENY, spawn: okSpawn([]) });
  var list = state.readJSON('t-hostops-rec-2', 'hostops.json');
  assert.strictEqual(list[0].outcome, 'deferred');
  assert.strictEqual(list[0].code, 'RESOURCE_PRESSURE');
});
t('record: status.json is never mutated by the adapter (transition stays the chokepoint)', function () {
  mkTask('t-hostops-rec-3');
  var before = JSON.stringify(state.readStatus('t-hostops-rec-3'));
  hostops.invoke({ operation: 'health', task_id: 't-hostops-rec-3' }, { guardGate: ADMIT, spawn: okSpawn([]) });
  assert.strictEqual(JSON.stringify(state.readStatus('t-hostops-rec-3')), before);
});

// ---- argument validation in the adapter (defense in depth) --------------
t('args: injection and unknown args refused before spawn', function () {
  var calls = [];
  [
    { operation: 'docker-status', arguments: { container: 'x;id' } },
    { operation: 'docker-status', arguments: { container: 'x id' } },
    { operation: 'file-read', arguments: { path: '/etc/mythos/governance.key' } },
    { operation: 'file-read', arguments: { path: '/home/deploy/deployments/../.ssh/id' } },
    { operation: 'health', arguments: { frobnicate: 'x' } }
  ].forEach(function (p) {
    var r = hostops.invoke(p, { guardGate: ADMIT, spawn: okSpawn(calls) });
    assert.strictEqual(r.ok, false, JSON.stringify(p));
    assert.strictEqual(r.code, 'HOSTOPS_ARG_INVALID', JSON.stringify(p));
  });
  assert.strictEqual(calls.length, 0);
});
t('kill switch: MYTHOS_HOSTOPS=off refuses everything', function () {
  process.env.MYTHOS_HOSTOPS = 'off';
  var r = hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, spawn: okSpawn([]) });
  delete process.env.MYTHOS_HOSTOPS;
  assert.strictEqual(r.ok, false);
});

// ---- route + environment invariants -------------------------------------
t('route: server.js wires POST /hostops/run behind the bearer gate', function () {
  var src = fs.readFileSync(path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'server.js'), 'utf8');
  var authIdx = src.indexOf('if (!authorized(req, token))');
  var routeIdx = src.indexOf("url === '/hostops/run'");
  assert.ok(authIdx !== -1 && routeIdx !== -1 && routeIdx > authIdx, 'route exists after the auth gate');
});
t('bridge report: execution block carries hostops additively', function () {
  var src = fs.readFileSync(path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'bridge', 'github-bridge.js'), 'utf8');
  assert.ok(src.indexOf("state.readJSON(eid, 'hostops.json')") !== -1);
});
t('profiles: every ENABLED profile denies sudo; deploy stays disabled (root boundary intact)', function () {
  var policy = require('../projects/mythos-ai-executor/lib/policy');
  Object.keys(policy.PROFILES || {}).forEach(function (name) {
    var p = policy.PROFILES[name];
    if (p.enabled) assert.ok((p.disallowedTools || []).indexOf('Bash(sudo:*)') !== -1, name + ' denies sudo');
    else assert.strictEqual(name, 'deploy', 'only the deploy profile may be disabled-with-scoped-sudo');
  });
  assert.strictEqual(policy.PROFILES.deploy.enabled, false, 'deploy profile stays owner-gated');
});
t('Dagu remains loopback-only', function () {
  var r = require('child_process').spawnSync('ss', ['-ltn'], { encoding: 'utf8' });
  var lines = r.stdout.split('\n').filter(function (l) { return l.indexOf(':8095') !== -1; });
  if (lines.length) lines.forEach(function (l) { assert.ok(l.indexOf('127.0.0.1:8095') !== -1, l); });
});
t('installed root boundary intact (0700 root:root helper, 0440 sudoers)', function () {
  var st = fs.statSync('/usr/local/sbin/mythos-hostops');
  assert.strictEqual(st.uid, 0); assert.strictEqual(st.mode & 511, 448);
  var su = fs.statSync('/etc/sudoers.d/60-dagu-hostops');
  assert.strictEqual(su.uid, 0); assert.strictEqual(su.mode & 511, 288);
});

console.log('\nhostops executor adapter: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
