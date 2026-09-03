'use strict';
// =====================================================
// MYTHOS — Executor -> hostops adapter tests (HOSTOPS-1, HOSTOPS-2R)
// tests/mythos-hostops-executor-test.js
//
// Proves the governed order (allowlist -> class READ -> args -> Resource
// Guard -> boundary), the failure behaviours, identity/audit propagation
// and the no-shell/no-sudo invariant of lib/hostops.js — with an injected
// boundary, so no live socket, daemon or root is needed. Real socket I/O
// against the actual daemon is covered separately by
// tests/mythos-hostops-daemon-test.js.
//
// HOSTOPS-2R (GitHub issue #130): invoke() now returns a Promise (the
// boundary is a Unix socket call, inherently async) — every test awaits it.
// =====================================================
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

process.env.MYTHOS_EXECUTOR_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hostops-exec-'));
delete process.env.MYTHOS_HOSTOPS;
var hostops = require('../projects/mythos-ai-executor/lib/hostops');
var state = require('../projects/mythos-ai-executor/lib/state');

var pass = 0, fail = 0, queue = [];
function t(name, fn) {
  queue.push(function () {
    return Promise.resolve().then(fn).then(function () {
      pass++; console.log('ok - ' + name);
    }, function (e) {
      fail++; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e));
    });
  });
}
function runAll() {
  return queue.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve());
}

var ADMIT = function () { return { admit: true, level: 'NORMAL', reason: null }; };
var DENY = function () { return { admit: false, level: 'CRITICAL', reason: 'mem_available' }; };
function okBoundary(calls) {
  return function (verb, args, ids) {
    calls.push({ verb: verb, args: args, ids: ids });
    return Promise.resolve({ status: 0, stdout: JSON.stringify({ ok: true, audit_id: 'hostops-test-1', result: { echo: args }, version: '0.1.1' }), stderr: '' });
  };
}
function mkTask(id) {
  state.ensureTaskDir(id);
  state.writeJSON(id, 'status.json', { task_id: id, status: 'RUNNING', created_at: new Date().toISOString() });
}

// ---- 1. successful READ ------------------------------------------------
t('1 successful READ returns normalized result with audit_id and null dagu_run_id', function () {
  var calls = [];
  return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: okBoundary(calls) }).then(function (r) {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.operation, 'host.health.check');
    assert.strictEqual(r.class, 'READ');
    assert.strictEqual(r.audit_id, 'hostops-test-1');
    assert.strictEqual(r.dagu_run_id, null);
    assert.strictEqual(r.hostops_exit, 0);
    assert.strictEqual(r.http_status, 200);
    assert.strictEqual(calls.length, 1);
  });
});
t('1b operation name form (host.docker.status) resolves to the helper verb', function () {
  var calls = [];
  return hostops.invoke({ operation: 'host.docker.status', arguments: { container: 'mythos-contextforge' } }, { guardGate: ADMIT, callBoundary: okBoundary(calls) }).then(function (r) {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(calls[0].verb, 'docker-status');
  });
});

// ---- the no-shell / no-sudo invariant -----------------------------------
t('boundary is invoked with a verb + validated args object over the socket, never a shell or sudo', function () {
  var calls = [];
  return hostops.invoke({ operation: 'docker-logs', arguments: { container: 'mythos-contextforge', lines: '50' } }, { guardGate: ADMIT, callBoundary: okBoundary(calls) }).then(function () {
    assert.strictEqual(calls[0].verb, 'docker-logs');
    assert.deepStrictEqual(calls[0].args, { container: 'mythos-contextforge', lines: '50' });
    var src = fs.readFileSync(require.resolve('../projects/mythos-ai-executor/lib/hostops'), 'utf8');
    // Code invariants, not prose: the file's own comments narrate the
    // HOSTOPS-1 sudo history (including the literal old call), so this
    // checks for the ACTUAL invocation shapes, not any mention of the words.
    ['shell: true', 'execSync', 'exec(', "require('child_process')", 'spawnSync(SUDO', 'spawnSync(process'].forEach(function (bad) {
      assert.strictEqual(src.indexOf(bad), -1, 'must not contain "' + bad + '"');
    });
    assert.ok(src.indexOf("require('net')") !== -1, 'adapter reaches the boundary over net (the Unix socket)');
  });
});

// ---- 2. invalid operation ---------------------------------------------
t('2 unknown operation refused without touching the boundary', function () {
  var calls = [];
  return hostops.invoke({ operation: 'nonsense' }, { guardGate: ADMIT, callBoundary: okBoundary(calls) }).then(function (r) {
    assert.strictEqual(r.code, 'HOSTOPS_UNKNOWN_OPERATION');
    assert.strictEqual(r.http_status, 404);
    assert.strictEqual(calls.length, 0);
  });
});
t('2b arbitrary shell shapes are not operations', function () {
  var calls = [];
  return Promise.all(['sh', 'bash -c id', 'rm -rf /', 'docker system prune'].map(function (v) {
    return hostops.invoke({ operation: v }, { guardGate: ADMIT, callBoundary: okBoundary(calls) }).then(function (r) {
      assert.strictEqual(r.ok, false, v);
      assert.ok(['HOSTOPS_UNKNOWN_OPERATION', 'HOSTOPS_INPUT'].indexOf(r.code) !== -1, v);
    });
  })).then(function () { assert.strictEqual(calls.length, 0); });
});

// ---- 3. governance denial (class gate, declared policy) ----------------
t('3 WRITE / RESTART / DEPLOY refused by name with class, before any boundary call', function () {
  var calls = [];
  return Promise.all([['host.file.write', 'WRITE'], ['file-write', 'WRITE'], ['docker-restart', 'RESTART'], ['systemd-restart', 'RESTART'], ['compose-up', 'DEPLOY'], ['host.docker.rollback', 'DEPLOY']].map(function (pair) {
    return hostops.invoke({ operation: pair[0] }, { guardGate: ADMIT, callBoundary: okBoundary(calls) }).then(function (r) {
      assert.strictEqual(r.code, 'HOSTOPS_NOT_READ', pair[0]);
      assert.strictEqual(r.class, pair[1], pair[0]);
      assert.strictEqual(r.http_status, 403);
    });
  })).then(function () { assert.strictEqual(calls.length, 0); });
});
t('3b allowlist unavailable fails closed', function () {
  var calls = [];
  return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: okBoundary(calls), allowlist_path: '/nonexistent/allowlist.json' }).then(function (r) {
    // falls through to the installed/repo copy if present; force by pointing at a bad file AND hiding the others is not possible here,
    // so assert the explicit code path with a corrupt override only when no system copy exists.
    if (fs.existsSync('/etc/mythos/hostops-allowlist.json') || fs.existsSync(path.join(__dirname, '..', 'ops', 'dagu-poc', 'hostops-allowlist.json'))) {
      assert.strictEqual(r.ok, true, 'fallback copies exist; lookup still succeeds');
    } else {
      assert.strictEqual(r.code, 'HOSTOPS_ALLOWLIST_UNAVAILABLE');
    }
  });
});

// ---- 4. Resource Guard denial ------------------------------------------
t('4 guard CRITICAL defers before the boundary; order guard-after-validation', function () {
  var calls = [], order = [];
  var gate = function () { order.push('guard'); return DENY(); };
  var cb = function (verb, args, ids) { order.push('boundary'); return okBoundary(calls)(verb, args, ids); };
  return hostops.invoke({ operation: 'health' }, { guardGate: gate, callBoundary: cb }).then(function (r) {
    assert.strictEqual(r.code, 'RESOURCE_PRESSURE');
    assert.strictEqual(r.deferred, true);
    assert.strictEqual(r.resource_level, 'CRITICAL');
    assert.strictEqual(r.http_status, 503);
    assert.deepStrictEqual(order, ['guard']);
    assert.strictEqual(calls.length, 0);
  });
});
t('4b guard is NOT consulted for an invalid request (nothing to admit)', function () {
  var guardCalls = 0;
  return hostops.invoke({ operation: 'nonsense' }, { guardGate: function () { guardCalls++; return ADMIT(); } }).then(function () {
    assert.strictEqual(guardCalls, 0);
  });
});

// ---- 5. hostops rejection ----------------------------------------------
t('5 helper exit 2 maps to HOSTOPS_REFUSED with the helper code and audit id', function () {
  var cb = function () { return Promise.resolve({ status: 2, stdout: JSON.stringify({ ok: false, audit_id: 'hostops-ref-1', error: { code: 'ARG_INVALID', message: 'argument "container" fails the allowlist pattern' } }), stderr: '' }); };
  return hostops.invoke({ operation: 'docker-status', arguments: { container: 'mythos-contextforge' } }, { guardGate: ADMIT, callBoundary: cb }).then(function (r) {
    assert.strictEqual(r.code, 'HOSTOPS_REFUSED');
    assert.strictEqual(r.hostops_code, 'ARG_INVALID');
    assert.strictEqual(r.audit_id, 'hostops-ref-1');
  });
});
t('5b helper exit 3 (caller) maps to HOSTOPS_CALLER_REFUSED', function () {
  var cb = function () { return Promise.resolve({ status: 3, stdout: JSON.stringify({ ok: false, audit_id: 'x', error: { code: 'CALLER_NOT_ALLOWED', message: 'no' } }), stderr: '' }); };
  return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: cb }).then(function (r) {
    assert.strictEqual(r.code, 'HOSTOPS_CALLER_REFUSED');
  });
});
t('5c the daemon\'s own SO_PEERCRED refusal also maps to HOSTOPS_CALLER_REFUSED (before the helper ever ran)', function () {
  var cb = function () { return Promise.resolve({ error: { code: 'HOSTOPS_CALLER_REFUSED', message: 'peer uid 9999 is not authorized' } }); };
  return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: cb }).then(function (r) {
    assert.strictEqual(r.code, 'HOSTOPS_CALLER_REFUSED');
    assert.strictEqual(r.http_status, 403);
    assert.ok(r.error.indexOf('9999') !== -1);
  });
});

// ---- 6. Dagu not in the READ path (documented decision) ----------------
t('6 the adapter has no Dagu client and reports dagu_run_id null by design', function () {
  var src = fs.readFileSync(require.resolve('../projects/mythos-ai-executor/lib/hostops'), 'utf8');
  assert.ok(src.indexOf('8095') === -1 && src.indexOf('require(\'http\')') === -1 && src.indexOf('require("http")') === -1, 'no Dagu/network client in the READ path');
  return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: okBoundary([]) }).then(function (r) {
    assert.strictEqual(r.dagu_run_id, null);
    assert.ok(hostops.describe().dagu.indexOf('not in the READ path') !== -1);
  });
});

// ---- 7. boundary unavailable --------------------------------------------
t('7 socket ENOENT (daemon/socket not installed) maps to HOSTOPS_UNAVAILABLE (no fallback of any kind)', function () {
  var cb = function () { return Promise.resolve({ error: { code: 'ENOENT', message: 'connect ENOENT /run/mythos-hostops/hostops.sock' } }); };
  return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: cb }).then(function (r) {
    assert.strictEqual(r.code, 'HOSTOPS_UNAVAILABLE');
    assert.strictEqual(r.http_status, 503);
  });
});
t('7b connection refused (daemon not running) is HOSTOPS_UNAVAILABLE, not a crash', function () {
  var cb = function () { return Promise.resolve({ error: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' } }); };
  return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: cb }).then(function (r) {
    assert.strictEqual(r.code, 'HOSTOPS_UNAVAILABLE');
    assert.ok(String(r.error).indexOf('ECONNREFUSED') !== -1);
  });
});
t('7c the boundary closing the connection without any response is HOSTOPS_UNAVAILABLE', function () {
  var cb = function () { return Promise.resolve({ error: { code: 'HOSTOPS_EMPTY_RESPONSE', message: 'the boundary closed the connection without a response' } }); };
  return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: cb }).then(function (r) {
    assert.strictEqual(r.code, 'HOSTOPS_UNAVAILABLE');
  });
});

// ---- 8. timeout ---------------------------------------------------------
t('8 boundary timeout maps to HOSTOPS_TIMEOUT', function () {
  var cb = function () { return Promise.resolve({ error: { code: 'ETIMEDOUT', message: 'timed out' }, signal: 'SIGTERM' }); };
  return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: cb }).then(function (r) {
    assert.strictEqual(r.code, 'HOSTOPS_TIMEOUT');
    assert.strictEqual(r.http_status, 504);
  });
});

// ---- 9. malformed response ---------------------------------------------
t('9 exit 0 without parseable JSON is HOSTOPS_MALFORMED, never a success', function () {
  var cb = function () { return Promise.resolve({ status: 0, stdout: 'not json at all', stderr: '' }); };
  return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: cb }).then(function (r) {
    assert.strictEqual(r.code, 'HOSTOPS_MALFORMED');
    assert.strictEqual(r.ok, false);
  });
});

// ---- 10. audit failure --------------------------------------------------
t('10 helper exit 5 (fail-closed audit) maps to HOSTOPS_AUDIT_UNAVAILABLE', function () {
  var cb = function () { return Promise.resolve({ status: 5, stdout: JSON.stringify({ ok: false, audit_id: 'a5', error: { code: 'AUDIT_UNAVAILABLE', message: 'withheld' } }), stderr: '' }); };
  return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: cb }).then(function (r) {
    assert.strictEqual(r.code, 'HOSTOPS_AUDIT_UNAVAILABLE');
    assert.strictEqual(r.http_status, 503);
  });
});

// ---- identity + record --------------------------------------------------
t('identity: task ids validated, passed to the boundary, echoed back', function () {
  var calls = [];
  mkTask('t-hostops-id-1');
  return hostops.invoke({
    operation: 'health', task_id: 't-hostops-id-1',
    othmode_task_id: 'OTH-2026-00099', github_task_id: 'gh-issue-999', requested_by: 'test-suite'
  }, { guardGate: ADMIT, callBoundary: okBoundary(calls) }).then(function (r) {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(calls[0].ids.task_id, 't-hostops-id-1');
    assert.strictEqual(calls[0].ids.othmode_task_id, 'OTH-2026-00099');
    assert.strictEqual(calls[0].ids.github_task_id, 'gh-issue-999');
    assert.deepStrictEqual(r.task, { task_id: 't-hostops-id-1', othmode_task_id: 'OTH-2026-00099', github_task_id: 'gh-issue-999' });
  });
});
t('identity: malformed ids refused before anything else', function () {
  return hostops.invoke({ operation: 'health', task_id: 'x;rm -rf' }, { guardGate: ADMIT, callBoundary: okBoundary([]) }).then(function (r) {
    assert.strictEqual(r.code, 'HOSTOPS_INPUT');
  });
});
t('record: events.log and hostops.json carry the invocation with audit_id', function () {
  mkTask('t-hostops-rec-1');
  return hostops.invoke({ operation: 'health', task_id: 't-hostops-rec-1' }, { guardGate: ADMIT, callBoundary: okBoundary([]) }).then(function () {
    var events = state.readText('t-hostops-rec-1', 'events.log');
    assert.ok(events.indexOf('hostops_invoked') !== -1);
    assert.ok(events.indexOf('hostops-test-1') !== -1);
    var list = state.readJSON('t-hostops-rec-1', 'hostops.json');
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].audit_id, 'hostops-test-1');
    assert.strictEqual(list[0].dagu_run_id, null);
    assert.strictEqual(list[0].outcome, 'ok');
  });
});
t('record: a guard deferral is recorded on the task too', function () {
  mkTask('t-hostops-rec-2');
  return hostops.invoke({ operation: 'health', task_id: 't-hostops-rec-2' }, { guardGate: DENY, callBoundary: okBoundary([]) }).then(function () {
    var list = state.readJSON('t-hostops-rec-2', 'hostops.json');
    assert.strictEqual(list[0].outcome, 'deferred');
    assert.strictEqual(list[0].code, 'RESOURCE_PRESSURE');
  });
});
t('record: status.json is never mutated by the adapter (transition stays the chokepoint)', function () {
  mkTask('t-hostops-rec-3');
  var before = JSON.stringify(state.readStatus('t-hostops-rec-3'));
  return hostops.invoke({ operation: 'health', task_id: 't-hostops-rec-3' }, { guardGate: ADMIT, callBoundary: okBoundary([]) }).then(function () {
    assert.strictEqual(JSON.stringify(state.readStatus('t-hostops-rec-3')), before);
  });
});

// ---- argument validation in the adapter (defense in depth) --------------
t('args: injection and unknown args refused before the boundary is called', function () {
  var calls = [];
  return Promise.all([
    { operation: 'docker-status', arguments: { container: 'x;id' } },
    { operation: 'docker-status', arguments: { container: 'x id' } },
    { operation: 'file-read', arguments: { path: '/etc/mythos/governance.key' } },
    { operation: 'file-read', arguments: { path: '/home/deploy/deployments/../.ssh/id' } },
    { operation: 'health', arguments: { frobnicate: 'x' } }
  ].map(function (p) {
    return hostops.invoke(p, { guardGate: ADMIT, callBoundary: okBoundary(calls) }).then(function (r) {
      assert.strictEqual(r.ok, false, JSON.stringify(p));
      assert.strictEqual(r.code, 'HOSTOPS_ARG_INVALID', JSON.stringify(p));
    });
  })).then(function () { assert.strictEqual(calls.length, 0); });
});
t('kill switch: MYTHOS_HOSTOPS=off refuses everything', function () {
  process.env.MYTHOS_HOSTOPS = 'off';
  return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: okBoundary([]) }).then(function (r) {
    delete process.env.MYTHOS_HOSTOPS;
    assert.strictEqual(r.ok, false);
  });
});

// ---- route + environment invariants -------------------------------------
t('route: server.js wires POST /hostops/run behind the bearer gate and awaits the Promise', function () {
  var src = fs.readFileSync(path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'server.js'), 'utf8');
  var authIdx = src.indexOf('if (!authorized(req, token))');
  var routeIdx = src.indexOf("url === '/hostops/run'");
  var invokeIdx = src.indexOf('hostops.invoke(payload).then(');
  assert.ok(authIdx !== -1 && routeIdx !== -1 && routeIdx > authIdx, 'route exists after the auth gate');
  assert.ok(invokeIdx !== -1 && invokeIdx > routeIdx, 'route awaits hostops.invoke() rather than treating it as synchronous');
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
t('installed root boundary intact (0700 root:root helper, 0440 dagu sudoers)', function () {
  var st = fs.statSync('/usr/local/sbin/mythos-hostops');
  assert.strictEqual(st.uid, 0); assert.strictEqual(st.mode & 511, 448);
  var su = fs.statSync('/etc/sudoers.d/60-dagu-hostops');
  assert.strictEqual(su.uid, 0); assert.strictEqual(su.mode & 511, 288);
});
t('HOSTOPS-2R: the obsolete deploy sudoers fragment is gone from the repo', function () {
  assert.strictEqual(fs.existsSync(path.join(__dirname, '..', 'ops', 'hostops', '61-deploy-hostops')), false);
  var installer = fs.readFileSync(path.join(__dirname, '..', 'ops', 'hostops', 'install-hostops.sh'), 'utf8');
  assert.strictEqual(installer.indexOf('/etc/sudoers.d/61-deploy-hostops'), -1, 'installer no longer installs the deploy sudo path');
  assert.ok(installer.indexOf('mythos-hostops.socket') !== -1 && installer.indexOf('mythos-hostops.service') !== -1, 'installer installs the HOSTOPS-2R socket boundary');
  assert.ok(installer.indexOf('groupadd -f mythos-hostops') !== -1, 'installer creates the socket access group');
});
t('HOSTOPS-2R: mythos-ai-executor.service still declares NoNewPrivileges=true (never weakened)', function () {
  var svc = fs.readFileSync(path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'service', 'mythos-ai-executor.service'), 'utf8');
  assert.ok(/^NoNewPrivileges=true$/m.test(svc));
});
t('HOSTOPS-2R: the socket unit is root-owned with the mythos-hostops group and 0660 socket mode', function () {
  var socketUnit = fs.readFileSync(path.join(__dirname, '..', 'ops', 'hostops', 'mythos-hostops.socket'), 'utf8');
  assert.ok(socketUnit.indexOf('SocketUser=root') !== -1);
  assert.ok(socketUnit.indexOf('SocketGroup=mythos-hostops') !== -1);
  assert.ok(socketUnit.indexOf('SocketMode=0660') !== -1);
  var serviceUnit = fs.readFileSync(path.join(__dirname, '..', 'ops', 'hostops', 'mythos-hostops.service'), 'utf8');
  assert.ok(/^NoNewPrivileges=true$/m.test(serviceUnit), 'the new root daemon is hardened too');
  assert.ok(serviceUnit.indexOf('User=root') !== -1);
});

// ---- PR #127 review hardening -------------------------------------------
t('review: a helper success WITHOUT an audit_id is refused as untraceable', function () {
  var cb1 = function () { return Promise.resolve({ status: 0, stdout: JSON.stringify({ ok: true, result: { x: 1 } }), stderr: '' }); };
  return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: cb1 }).then(function (r) {
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'HOSTOPS_MALFORMED');
    var cb2 = function () { return Promise.resolve({ status: 0, stdout: JSON.stringify({ ok: true, audit_id: '', result: {} }), stderr: '' }); };
    return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: cb2 });
  }).then(function (r2) {
    assert.strictEqual(r2.code, 'HOSTOPS_MALFORMED');
  });
});
t('review: task_recorded surfaces recording state (true / false / null), never silent', function () {
  mkTask('t-hostops-tr-1');
  return hostops.invoke({ operation: 'health', task_id: 't-hostops-tr-1' }, { guardGate: ADMIT, callBoundary: okBoundary([]) }).then(function (ok) {
    assert.strictEqual(ok.task_recorded, true);
    return hostops.invoke({ operation: 'health', task_id: 't-hostops-does-not-exist' }, { guardGate: ADMIT, callBoundary: okBoundary([]) });
  }).then(function (unknown) {
    assert.strictEqual(unknown.ok, true, 'the READ result itself still returns (root ledger traces it)');
    assert.strictEqual(unknown.task_recorded, false, 'but the missing executor-side record is visible');
    return hostops.invoke({ operation: 'health' }, { guardGate: ADMIT, callBoundary: okBoundary([]) });
  }).then(function (noTask) {
    assert.strictEqual(noTask.task_recorded, null);
    return hostops.invoke({ operation: 'health', task_id: 't-hostops-tr-1' }, { guardGate: DENY, callBoundary: okBoundary([]) });
  }).then(function (deferred) {
    assert.strictEqual(deferred.task_recorded, true, 'deferrals are recorded too');
  });
});

runAll().then(function () {
  console.log('\nhostops executor adapter: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
