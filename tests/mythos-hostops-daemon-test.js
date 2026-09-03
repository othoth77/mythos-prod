'use strict';
// =====================================================
// MYTHOS — mythos-hostops-daemon tests (HOSTOPS-2R, GitHub issue #130)
// tests/mythos-hostops-daemon-test.js
//
// Runs the REAL Python daemon (ops/hostops/mythos-hostops-daemon.py)
// against a temp socket and a stub helper (no root, no live install
// required) to prove: peer-credential authorization via SO_PEERCRED (never
// a caller-supplied field), a fixed argument array with shell=False (no
// shell/docker/systemctl/sudo anywhere in this file), malformed/oversized
// requests refused before any subprocess is spawned, and unavailable-socket
// behaviour end to end through lib/hostops.js's real (non-injected) socket
// client. The daemon's own authorization function is additionally unit
// tested in the Python interpreter directly, since only one real uid (this
// test process's own) is available to dial the socket with in CI.
// =====================================================
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var net = require('net');
var os = require('os');
var path = require('path');

var DAEMON = path.join(__dirname, '..', 'ops', 'hostops', 'mythos-hostops-daemon.py');
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hostops-daemon-'));
var SOCK = path.join(TMP, 'hostops.sock');
var MARKER = path.join(TMP, 'invoked.marker');
var STUB_HELPER = path.join(TMP, 'stub-helper.js');

// A stub for /usr/local/sbin/mythos-hostops: echoes its own argv and the
// SUDO_USER it was invoked with, and records that it ran (so tests can
// assert it was NEVER reached for refused requests).
fs.writeFileSync(STUB_HELPER, [
  '#!/usr/bin/env node',
  'var fs = require("fs");',
  'fs.appendFileSync(' + JSON.stringify(MARKER) + ', JSON.stringify(process.argv.slice(2)) + "\\n");',
  'process.stdout.write(JSON.stringify({ ok: true, version: "stub-1", audit_id: "stub-audit-1", result: { argv: process.argv.slice(2), sudo_user: process.env.SUDO_USER || null } }));',
  ''
].join('\n'));
fs.chmodSync(STUB_HELPER, 0o755);

process.env.MYTHOS_HOSTOPS = 'on';
var hostops = require('../projects/mythos-ai-executor/lib/hostops');

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
function runAll() { return queue.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve()); }

var daemonProc = null;
function startDaemon() {
  return new Promise(function (resolve, reject) {
    var env = Object.assign({}, process.env, {
      MYTHOS_HOSTOPS_DAEMON_SOCKET: SOCK,
      MYTHOS_HOSTOPS_DAEMON_HELPER: STUB_HELPER
    });
    delete env.LISTEN_FDS; delete env.LISTEN_PID;
    daemonProc = cp.spawn('python3', [DAEMON], { env: env, stdio: ['ignore', 'pipe', 'pipe'] });
    var settled = false;
    daemonProc.on('error', function (e) { if (!settled) { settled = true; reject(e); } });
    daemonProc.on('exit', function (code) {
      if (!settled) { settled = true; reject(new Error('daemon exited early with code ' + code)); }
    });
    var deadline = Date.now() + 5000;
    (function poll() {
      if (settled) return;
      if (fs.existsSync(SOCK)) { settled = true; return resolve(); }
      if (Date.now() > deadline) { settled = true; return reject(new Error('daemon did not create the socket in time')); }
      setTimeout(poll, 50);
    })();
  });
}
function stopDaemon() {
  if (daemonProc) { try { daemonProc.kill('SIGTERM'); } catch (e) { /* already gone */ } }
}

// One raw newline-delimited-JSON round trip against the real daemon socket.
function rawCall(line, socketPath) {
  return new Promise(function (resolve) {
    var chunks = [];
    var conn = net.createConnection({ path: socketPath || SOCK });
    conn.setTimeout(4000);
    conn.on('timeout', function () { conn.destroy(); resolve({ timeout: true }); });
    conn.on('error', function (e) { resolve({ error: e }); });
    conn.on('connect', function () { conn.end(line); });
    conn.on('data', function (d) { chunks.push(d); });
    conn.on('close', function () { resolve({ raw: Buffer.concat(chunks).toString('utf8') }); });
  });
}
function markerCalls() {
  if (!fs.existsSync(MARKER)) return [];
  return fs.readFileSync(MARKER, 'utf8').trim().split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
}

t('setup: real daemon starts and creates the socket', function () {
  return startDaemon();
});

// ---- 1. real round trip: peer-cred accepted (this test's own uid = deploy)
t('1 a legitimate connection (this process\'s real uid) is answered by the stub helper with a fixed argv and SUDO_USER set', function () {
  return rawCall(JSON.stringify({ verb: 'health', args: {} }) + '\n').then(function (res) {
    assert.ok(res.raw, 'got a response: ' + JSON.stringify(res));
    var body = JSON.parse(res.raw.trim().split('\n')[0]);
    assert.strictEqual(body.status, 0);
    var inner = JSON.parse(body.stdout);
    assert.strictEqual(inner.ok, true);
    assert.deepStrictEqual(inner.result.argv, ['health']);
    assert.ok(['deploy', 'root'].indexOf(inner.result.sudo_user) !== -1 || inner.result.sudo_user === null, 'sudo_user reflects the verified peer identity, not a client-supplied field: ' + inner.result.sudo_user);
  });
});
t('1b args and task ids become a fixed --flag argv array, sorted, never a shell string', function () {
  fs.writeFileSync(MARKER, '');
  return rawCall(JSON.stringify({ verb: 'docker-status', args: { container: 'x' }, task_id: 't-1', othmode_task_id: 'OTH-1', github_task_id: 'gh-1' }) + '\n').then(function (res) {
    var body = JSON.parse(res.raw.trim().split('\n')[0]);
    var inner = JSON.parse(body.stdout);
    assert.deepStrictEqual(inner.result.argv, ['docker-status', '--container', 'x', '--task-id', 't-1', '--othmode-task', 'OTH-1', '--github-task', 'gh-1']);
  });
});

// ---- 2. malformed/oversized/unexpected requests never reach the helper --
t('2 malformed JSON is refused without spawning the helper', function () {
  fs.writeFileSync(MARKER, '');
  return rawCall('not json at all\n').then(function (res) {
    var body = JSON.parse(res.raw.trim().split('\n')[0]);
    assert.strictEqual(body.error.code, 'HOSTOPS_INPUT');
    assert.strictEqual(markerCalls().length, 0);
  });
});
t('2b an unexpected field is refused without spawning the helper', function () {
  fs.writeFileSync(MARKER, '');
  return rawCall(JSON.stringify({ verb: 'health', args: {}, evil: 'x' }) + '\n').then(function (res) {
    var body = JSON.parse(res.raw.trim().split('\n')[0]);
    assert.strictEqual(body.error.code, 'HOSTOPS_INPUT');
    assert.strictEqual(markerCalls().length, 0);
  });
});
t('2c an argument value with shell metacharacters is refused without spawning the helper', function () {
  fs.writeFileSync(MARKER, '');
  return rawCall(JSON.stringify({ verb: 'docker-status', args: { container: 'x;id' } }) + '\n').then(function (res) {
    var body = JSON.parse(res.raw.trim().split('\n')[0]);
    assert.strictEqual(body.error.code, 'HOSTOPS_INPUT');
    assert.strictEqual(markerCalls().length, 0);
  });
});
t('2d an invalid verb shape is refused without spawning the helper', function () {
  fs.writeFileSync(MARKER, '');
  return rawCall(JSON.stringify({ verb: 'rm -rf /', args: {} }) + '\n').then(function (res) {
    var body = JSON.parse(res.raw.trim().split('\n')[0]);
    assert.strictEqual(body.error.code, 'HOSTOPS_INPUT');
    assert.strictEqual(markerCalls().length, 0);
  });
});

// ---- 3. no shell / no docker / no systemctl / no sudo in this file ------
t('3 the daemon source never uses a shell, and spawns with shell=False', function () {
  var src = fs.readFileSync(DAEMON, 'utf8');
  ['shell=True', 'os.system(', 'os.popen(', '/bin/sh', '/bin/bash', 'subprocess.call(', '/usr/bin/sudo'].forEach(function (bad) {
    assert.strictEqual(src.indexOf(bad), -1, 'daemon must not contain "' + bad + '"');
  });
  assert.ok(src.indexOf('shell=False') !== -1, 'subprocess.run is explicitly shell=False');
  assert.ok(src.indexOf('SO_PEERCRED') !== -1, 'daemon verifies the peer via SO_PEERCRED');
});

// ---- 4. unavailable-service behaviour, end to end through lib/hostops ---
t('4 lib/hostops.js against a socket path with nothing listening returns HOSTOPS_UNAVAILABLE (real client, real ENOENT)', function () {
  return hostops.invoke({ operation: 'health' }, { guardGate: function () { return { admit: true, level: 'NORMAL' }; }, socketPath: path.join(TMP, 'nothing-here.sock') }).then(function (r) {
    assert.strictEqual(r.code, 'HOSTOPS_UNAVAILABLE');
    assert.strictEqual(r.http_status, 503);
  });
});
t('4b lib/hostops.js end to end against the real daemon and the stub helper: full success, Resource Guard admits before the socket is touched', function () {
  var order = [];
  var gate = function () { order.push('guard'); return { admit: true, level: 'NORMAL' }; };
  return hostops.invoke({ operation: 'health' }, { guardGate: gate, socketPath: SOCK }).then(function (r) {
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.audit_id, 'stub-audit-1');
    assert.deepStrictEqual(order, ['guard']);
  });
});
t('4c Resource Guard CRITICAL defers before the socket is ever touched (real client)', function () {
  fs.writeFileSync(MARKER, '');
  var gate = function () { return { admit: false, level: 'CRITICAL' }; };
  return hostops.invoke({ operation: 'health' }, { guardGate: gate, socketPath: SOCK }).then(function (r) {
    assert.strictEqual(r.code, 'RESOURCE_PRESSURE');
    assert.strictEqual(markerCalls().length, 0);
  });
});

// ---- 5. the daemon's own authorization logic (pure functions, Python) ---
t('5 resolve_caller() trusts only SO_PEERCRED-resolved uids — root, the real deploy uid, and nothing else', function () {
  var script = [
    'import importlib.util, sys, pwd',
    'spec = importlib.util.spec_from_file_location("hostops_daemon", ' + JSON.stringify(DAEMON) + ')',
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
    'allowed = m.resolve_allowed_uids()',
    'deploy_uid = pwd.getpwnam("deploy").pw_uid',
    'assert m.resolve_caller(0, allowed) == "root", "root must be trusted like the direct/owner path"',
    'assert m.resolve_caller(deploy_uid, allowed) == "deploy", "the real deploy uid must resolve to deploy"',
    'assert m.resolve_caller(999999, allowed) is None, "an arbitrary uid must never be trusted"',
    'req, err = m.validate_request({"verb": "health", "args": {}})',
    'assert err is None and req["verb"] == "health"',
    'req2, err2 = m.validate_request({"verb": "health", "args": {}, "identity": "dagu"})',
    'assert err2 is not None, "a client-supplied identity field must be REFUSED, never trusted"',
    'argv = m.build_argv({"verb": "health", "args": {"b": "2", "a": "1"}, "ids": {}}, helper="/x/helper")',
    'assert argv == ["/x/helper", "health", "--a", "1", "--b", "2"], argv',
    'print("PYOK")'
  ].join('\n');
  var r = cp.spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'stdout=' + r.stdout + ' stderr=' + r.stderr);
  assert.ok(r.stdout.indexOf('PYOK') !== -1);
});
t('5b resolve_allowed_uids() never crashes when a configured caller (e.g. a not-yet-created dagu) is missing', function () {
  var script = [
    'import importlib.util',
    'spec = importlib.util.spec_from_file_location("hostops_daemon", ' + JSON.stringify(DAEMON) + ')',
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
    'uids = m.resolve_allowed_uids(("definitely-not-a-real-user-xyz", "deploy"))',
    'assert "deploy" in uids.values()',
    'print("PYOK")'
  ].join('\n');
  var r = cp.spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'stdout=' + r.stdout + ' stderr=' + r.stderr);
});

t('teardown: stop the daemon', function () { stopDaemon(); });

runAll().then(function () {
  stopDaemon();
  console.log('\nhostops daemon: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
