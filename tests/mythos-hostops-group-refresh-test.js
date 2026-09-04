'use strict';
// =====================================================
// MYTHOS — HOSTOPS-2R-FIX tests (GitHub issue #132)
// tests/mythos-hostops-group-refresh-test.js
//
// Proves the actual authorization-refresh mechanism used to fix the live
// production gap: `usermod -aG mythos-hostops deploy` does not update an
// already-running systemd --user manager's supplementary groups, so the
// Executor kept seeing EACCES on the socket even after group membership
// was granted and the executor unit itself restarted — only a restart of
// `user@<uid>.service` (root, system-unit territory) re-reads /etc/group.
// ops/hostops/refresh-group-membership.sh is exercised against a stub
// `systemctl`/`id` (no root, no real systemd instance needed) to prove:
// an active user manager is restarted, an inactive/absent one is left
// alone (idempotent, non-disruptive), and — the concrete regression this
// issue asked for — that the previous `SupplementaryGroups=`/216/GROUP
// workaround is nowhere in this tree and is never reintroduced by it.
// =====================================================
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var SCRIPT = path.join(__dirname, '..', 'ops', 'hostops', 'refresh-group-membership.sh');
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hostops-refresh-'));

var pass = 0, fail = 0, queue = [];
function t(name, fn) {
  queue.push(function () {
    try { fn(); pass++; console.log('ok - ' + name); }
    catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e)); }
  });
}
function runAll() { queue.forEach(function (fn) { fn(); }); }

// A stub `id`/`systemctl` pair that logs every invocation to a file so
// assertions can inspect exactly what the script tried to do, without any
// real systemd instance or root privilege.
function writeStubs(opts) {
  opts = opts || {};
  var uidsByUser = opts.uids || { deploy: '1000', dagu: '1003' };
  var activeUnits = opts.activeUnits || {};
  var log = path.join(TMP, 'calls-' + Math.random().toString(36).slice(2) + '.log');

  var idBin = path.join(TMP, 'stub-id-' + path.basename(log));
  fs.writeFileSync(idBin, [
    '#!/usr/bin/env bash',
    'echo "id $*" >> ' + JSON.stringify(log),
    'if [ "$1" = "-u" ]; then',
    '  case "$2" in'
  ].concat(Object.keys(uidsByUser).map(function (u) {
    return '    ' + u + ') echo ' + uidsByUser[u] + '; exit 0 ;;';
  })).concat([
    '    *) exit 1 ;;',
    '  esac',
    'fi',
    'exit 1'
  ]).join('\n'));
  fs.chmodSync(idBin, 0o755);

  var systemctlBin = path.join(TMP, 'stub-systemctl-' + path.basename(log));
  fs.writeFileSync(systemctlBin, [
    '#!/usr/bin/env bash',
    'echo "systemctl $*" >> ' + JSON.stringify(log),
    'if [ "$1" = "is-active" ]; then',
    '  unit="$3"',
    '  case "$unit" in'
  ].concat(Object.keys(activeUnits).filter(function (u) { return activeUnits[u]; }).map(function (u) {
    return '    ' + u + ') exit 0 ;;';
  })).concat([
    '    *) exit 3 ;;',
    '  esac',
    'fi',
    'if [ "$1" = "restart" ]; then exit 0; fi',
    'exit 0'
  ]).join('\n'));
  fs.chmodSync(systemctlBin, 0o755);

  return { log: log, idBin: idBin, systemctlBin: systemctlBin };
}

function runScript(args, stubs) {
  var env = Object.assign({}, process.env, {
    MYTHOS_HOSTOPS_ID: stubs.idBin,
    MYTHOS_HOSTOPS_SYSTEMCTL: stubs.systemctlBin
  });
  return cp.spawnSync('bash', [SCRIPT].concat(args), { encoding: 'utf8', env: env });
}
function calls(stubs) {
  if (!fs.existsSync(stubs.log)) return [];
  return fs.readFileSync(stubs.log, 'utf8').trim().split('\n').filter(Boolean);
}

t('bash -n: the script is syntactically clean', function () {
  var r = cp.spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});

t('no usage → exit 1 with a usage message, no systemctl/id invoked', function () {
  var stubs = writeStubs();
  var r = runScript([], stubs);
  assert.strictEqual(r.status, 1);
  assert.ok(/usage/i.test(r.stderr));
  assert.deepStrictEqual(calls(stubs), []);
});

t('an active user manager IS restarted — the actual fix for the live EACCES gap', function () {
  var stubs = writeStubs({ activeUnits: { 'user@1000.service': true } });
  var r = runScript(['deploy'], stubs);
  assert.strictEqual(r.status, 0, r.stderr);
  var c = calls(stubs);
  assert.ok(c.indexOf('id -u deploy') !== -1, c.join('\n'));
  assert.ok(c.indexOf('systemctl is-active --quiet user@1000.service') !== -1, c.join('\n'));
  assert.ok(c.indexOf('systemctl restart user@1000.service') !== -1, 'must actually restart the stale manager: ' + c.join('\n'));
  assert.ok(/restarting user@1000.service/.test(r.stdout));
});

t('an inactive/never-started user manager is left alone — idempotent, non-disruptive', function () {
  var stubs = writeStubs({ activeUnits: {} });
  var r = runScript(['dagu'], stubs);
  assert.strictEqual(r.status, 0, r.stderr);
  var c = calls(stubs);
  assert.ok(c.indexOf('systemctl is-active --quiet user@1003.service') !== -1, c.join('\n'));
  assert.strictEqual(c.filter(function (l) { return l.indexOf('restart') !== -1; }).length, 0, 'must never restart a manager that was never active: ' + c.join('\n'));
  assert.ok(/not active, nothing to refresh/.test(r.stdout));
});

t('a nonexistent user is skipped without failing the run for the rest', function () {
  var stubs = writeStubs({ uids: { deploy: '1000' }, activeUnits: { 'user@1000.service': true } });
  var r = runScript(['definitely-not-a-real-user-xyz', 'deploy'], stubs);
  assert.strictEqual(r.status, 0, r.stderr);
  var c = calls(stubs);
  assert.ok(c.indexOf('systemctl restart user@1000.service') !== -1, 'deploy must still be refreshed even though an earlier arg failed: ' + c.join('\n'));
  assert.ok(/no such user/.test(r.stdout));
});

t('multiple users are each independently evaluated (deploy restarted, dagu skipped)', function () {
  var stubs = writeStubs({ activeUnits: { 'user@1000.service': true } });
  var r = runScript(['deploy', 'dagu'], stubs);
  assert.strictEqual(r.status, 0, r.stderr);
  var c = calls(stubs);
  assert.ok(c.indexOf('systemctl restart user@1000.service') !== -1, c.join('\n'));
  assert.ok(c.indexOf('systemctl is-active --quiet user@1003.service') !== -1, c.join('\n'));
  assert.strictEqual(c.indexOf('systemctl restart user@1003.service'), -1, c.join('\n'));
});

// ---- the concrete regression this issue asked for -----------------------
t('HOSTOPS-2R-FIX: SupplementaryGroups= is not used anywhere in this tree (the 216/GROUP workaround is not required)', function () {
  var unitFiles = [
    path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'service', 'mythos-ai-executor.service'),
    path.join(__dirname, '..', 'ops', 'hostops', 'mythos-hostops.socket'),
    path.join(__dirname, '..', 'ops', 'hostops', 'mythos-hostops.service')
  ];
  unitFiles.forEach(function (f) {
    var src = fs.readFileSync(f, 'utf8');
    assert.strictEqual(/^SupplementaryGroups=/m.test(src), false, f + ' must never declare SupplementaryGroups= (fails 216/GROUP on a user unit; not needed with the manager-refresh fix)');
  });
});
t('HOSTOPS-2R-FIX: mythos-ai-executor.service still declares NoNewPrivileges=true (never weakened by this fix)', function () {
  var svc = fs.readFileSync(path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'service', 'mythos-ai-executor.service'), 'utf8');
  assert.ok(/^NoNewPrivileges=true$/m.test(svc));
});
t('HOSTOPS-2R-FIX: the installer runs the group refresh, after granting membership, for both deploy and dagu', function () {
  var installer = fs.readFileSync(path.join(__dirname, '..', 'ops', 'hostops', 'install-hostops.sh'), 'utf8');
  var usermodIdx = installer.indexOf('usermod -aG mythos-hostops deploy');
  var refreshIdx = installer.indexOf('refresh-group-membership.sh');
  assert.ok(usermodIdx !== -1, 'installer must grant deploy membership');
  assert.ok(refreshIdx !== -1, 'installer must call the refresh script');
  assert.ok(refreshIdx > usermodIdx, 'the refresh must run after group membership is granted');
  assert.ok(installer.indexOf('refresh-group-membership.sh" deploy dagu') !== -1, 'both authorized callers must be refreshed');
});
t('HOSTOPS-2R-FIX: the refresh script never sets a SupplementaryGroups= directive (it only documents, in prose, why that workaround was rejected)', function () {
  var src = fs.readFileSync(SCRIPT, 'utf8');
  assert.strictEqual(/^\s*SupplementaryGroups=/m.test(src), false);
  assert.ok(src.indexOf('set -euo pipefail') !== -1, 'fails closed on any unexpected error');
});

runAll();
console.log('\nhostops group refresh: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
