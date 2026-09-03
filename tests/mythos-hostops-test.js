'use strict';
// =====================================================
// MYTHOS — mythos-hostops v0.1 boundary tests (HOSTOPS-READONLY-0)
// tests/mythos-hostops-test.js
//
// Proves the 15 mission points against the REAL helper binary (dev-mode
// invocation of ops/hostops/mythos-hostops.js — byte-identical to what the
// owner installs). Live docker/systemd probes need root; when run without
// root those specific checks SKIP with a reason rather than fake a pass.
// =====================================================
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var HELPER = path.join(__dirname, '..', 'ops', 'hostops', 'mythos-hostops.js');
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hostops-test-'));
var IS_ROOT = process.getuid() === 0;
var pass = 0, fail = 0, skip = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { if (e && e.__skip) { skip++; console.log('skip - ' + name + ' (' + e.message + ')'); } else { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); } } }
function SKIP(msg) { var e = new Error(msg); e.__skip = true; throw e; }

function call(args, envExtra) {
  var env = Object.assign({}, process.env, { MYTHOS_HOSTOPS_HOME: TMP }, envExtra || {});
  delete env.SUDO_USER; if (envExtra && envExtra.SUDO_USER) env.SUDO_USER = envExtra.SUDO_USER;
  var r = cp.spawnSync('/usr/bin/node', [HELPER].concat(args), { encoding: 'utf8', env: env, timeout: 20000 });
  var body = null; try { body = JSON.parse(r.stdout); } catch (e) { /* leave null */ }
  return { code: r.status, body: body, stderr: r.stderr };
}
function auditLines() {
  try { return fs.readFileSync(path.join(TMP, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); } catch (e) { return []; }
}

// 1 — allowed READ operations succeed
t('1a health succeeds with structured JSON', function () {
  var r = call(['health']);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.class, 'READ');
  assert.ok(r.body.result.mem_available_mib > 0);
  assert.ok(typeof r.body.result.oom_kill === 'number');
});
t('1b resource-guard observes without deciding or writing', function () {
  var st0 = null; try { st0 = fs.statSync('/home/deploy/mythos-ai-executor/resource-guard.json').mtimeMs; } catch (e) {}
  var r = call(['resource-guard']);
  assert.strictEqual(r.code, 0);
  assert.ok(r.body.result.signals.mem_available_mib > 0);
  assert.ok('persisted_level' in r.body.result);
  if (st0 !== null) assert.strictEqual(fs.statSync('/home/deploy/mythos-ai-executor/resource-guard.json').mtimeMs, st0, 'guard state file must not be touched');
});
t('1c file-read succeeds on an allowed, harmless path', function () {
  var r = call(['file-read', '--path', '/home/deploy/projects/mythos-prod/README.md']);
  assert.strictEqual(r.code, 0, JSON.stringify(r.body && r.body.error));
  assert.ok(r.body.result.content.length > 0);
});
t('1d docker-status succeeds on a live container (root only)', function () {
  if (!IS_ROOT) SKIP('needs docker access');
  var r = call(['docker-status', '--container', 'mythos-contextforge']);
  assert.strictEqual(r.code, 0, JSON.stringify(r.body && r.body.error));
  assert.strictEqual(r.body.result.running, true);
});
t('1e systemd-status succeeds read-only', function () {
  var r = call(['systemd-status', '--unit', 'docker.service']);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.body.result.ActiveState, 'active');
});

// 2 — unknown operation
t('2 unknown operation rejected', function () {
  var r = call(['nonsense-verb']);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.body.error.code, 'UNKNOWN_OPERATION');
});

// 3/4/5 — WRITE / RESTART / DEPLOY refused by name with class
[['file-write', 'WRITE'], ['docker-restart', 'RESTART'], ['systemd-restart', 'RESTART'], ['compose-up', 'DEPLOY'], ['compose-rollback', 'DEPLOY'], ['host.docker.deploy', 'DEPLOY']].forEach(function (pair) {
  t('3-5 non-READ verb refused: ' + pair[0] + ' (' + pair[1] + ')', function () {
    var r = call([pair[0], '--path', '/home/deploy/deployments/x/y', '--container', 'mythos-poc-x', '--unit', 'dagu-poc.service', '--project', '/home/deploy/deployments/x']);
    assert.strictEqual(r.code, 2);
    assert.strictEqual(r.body.error.code, 'OPERATION_NOT_READ');
    assert.ok(r.body.error.message.indexOf(pair[1]) !== -1, 'names the class');
  });
});

// 6 — destructive commands are not verbs at all
['rm', 'rm -rf /', 'docker', 'prune', 'mkfs', 'iptables', 'dd'].forEach(function (v) {
  t('6 destructive rejected: ' + JSON.stringify(v), function () {
    var r = call([v]);
    assert.strictEqual(r.code, 2);
    assert.ok(['UNKNOWN_OPERATION'].indexOf(r.body.error.code) !== -1);
  });
});

// 7 — arbitrary shell rejected (as verb and as argument injection)
t('7a shell as verb rejected', function () {
  ['sh', 'bash', '-c', 'sh -c id'].forEach(function (v) {
    var r = call([v]); assert.strictEqual(r.code, 2, v);
  });
});
t('7b injection in container arg rejected', function () {
  ['x;id', 'x|id', 'x$(id)', 'x`id`', 'x&&id', 'x id'].forEach(function (v) {
    var r = call(['docker-status', '--container', v]);
    assert.strictEqual(r.code, 2, v);
    assert.strictEqual(r.body.error.code, 'ARG_INVALID', v);
  });
});
t('7c injection in unit arg rejected', function () {
  var r = call(['systemd-status', '--unit', 'docker.service;reboot']);
  assert.strictEqual(r.code, 2);
});

// 8 — invalid arguments
t('8a unknown flag rejected', function () {
  var r = call(['health', '--frobnicate', 'x']);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.body.error.code, 'ARG_UNKNOWN');
});
t('8b missing required arg rejected', function () {
  var r = call(['docker-status']);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.body.error.code, 'ARG_MISSING');
});
t('8c oversized lines rejected', function () {
  var r = call(['docker-logs', '--container', 'mythos-contextforge', '--lines', '99999']);
  assert.strictEqual(r.code, 2);
});
t('8d duplicate flag rejected', function () {
  var r = call(['docker-status', '--container', 'a', '--container', 'b']);
  assert.strictEqual(r.code, 2);
});
t('8e malformed task identity rejected', function () {
  var r = call(['health', '--task-id', 'x;rm -rf']);
  assert.strictEqual(r.code, 2);
});

// 9 — path traversal and secret paths
t('9a dotdot traversal rejected', function () {
  var r = call(['file-read', '--path', '/home/deploy/deployments/../.ssh/id_ed25519']);
  assert.strictEqual(r.code, 2);
});
t('9b path outside approved trees rejected by pattern', function () {
  ['/etc/mythos/governance.key', '/root/.ssh/id_ed25519', '/home/deploy/.config/mythos-ai-executor/executor.env'].forEach(function (p) {
    var r = call(['file-read', '--path', p]);
    assert.strictEqual(r.code, 2, p);
  });
});
t('9c secret-shaped filename inside an allowed tree rejected', function () {
  var hit = null;
  ['/home/deploy/deployments/mythos-gateway/mcp-http.env', '/home/deploy/deployments/mythos-gateway/contextforge-executor.env'].some(function (p) {
    try { fs.lstatSync(p); hit = p; return true; } catch (e) { return false; }
  });
  if (!hit) SKIP('no live .env fixture found');
  var r = call(['file-read', '--path', hit]);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.body.error.code, 'PATH_REFUSED');
});
t('9d symlink escaping the tree rejected at realpath', function () {
  var linkDir = '/home/deploy/projects/mythos-prod';
  var link = path.join(linkDir, '.hostops-test-link-' + process.pid);
  try { fs.symlinkSync('/etc/hostname', link); } catch (e) { SKIP('cannot create symlink fixture: ' + e.message); }
  try {
    var r = call(['file-read', '--path', link]);
    assert.strictEqual(r.code, 2);
    assert.strictEqual(r.body.error.code, 'PATH_REFUSED');
  } finally { try { fs.unlinkSync(link); } catch (e) {} }
});

// 10 — audit events
t('10a every outcome above produced an audit event, refusals included', function () {
  var lines = auditLines();
  assert.ok(lines.length >= 30, 'audit lines: ' + lines.length);
  assert.ok(lines.some(function (l) { return l.outcome === 'ok' && l.operation === 'host.health.check'; }));
  assert.ok(lines.some(function (l) { return l.outcome === 'refused' && l.error === 'OPERATION_NOT_READ'; }));
});
t('10b audit carries task identity and audit_id matches the response', function () {
  var r = call(['health', '--task-id', 't-20260903-hostops', '--github-task', 'gh-issue-999', '--othmode-task', 'OTH-2026-00099']);
  assert.strictEqual(r.code, 0);
  var last = auditLines().pop();
  assert.strictEqual(last.audit_id, r.body.audit_id);
  assert.strictEqual(last.task.task_id, 't-20260903-hostops');
  assert.strictEqual(last.task.github_task_id, 'gh-issue-999');
  assert.strictEqual(last.task.othmode_task_id, 'OTH-2026-00099');
});
t('10c fail-closed: success without a writable audit store is withheld', function () {
  var dead = path.join(TMP, 'no-audit'); fs.mkdirSync(dead); fs.chmodSync(dead, 0o500);
  if (IS_ROOT) SKIP('root bypasses directory permissions; verified by code path (exit 5) not reproducible as root');
  var r = call(['health'], { MYTHOS_HOSTOPS_HOME: path.join(dead, 'sub') });
  assert.strictEqual(r.code, 5);
  assert.strictEqual(r.body.error.code, 'AUDIT_UNAVAILABLE');
});

// 11 — caller boundary
t('11a unauthorized sudo caller rejected before anything runs', function () {
  var r = call(['health'], { SUDO_USER: 'ubuntu' });
  assert.strictEqual(r.code, 3);
  assert.strictEqual(r.body.error.code, 'CALLER_NOT_ALLOWED');
});
t('11b sudo caller dagu passes the caller gate', function () {
  var r = call(['nonsense-verb'], { SUDO_USER: 'dagu' });
  // reaches validation (2), not the caller gate (3)
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.body.error.code, 'UNKNOWN_OPERATION');
});
t('11c env overrides are ignored under sudo (audit path pinned)', function () {
  var r = call(['health'], { SUDO_USER: 'dagu', MYTHOS_HOSTOPS_HOME: TMP });
  // with the override ignored, audit goes to /var/lib/mythos/hostops which
  // either works (installed host, exit 0) or fails closed (exit 5) — but the
  // TMP ledger must NOT have grown for this call.
  var before = auditLines().length;
  var r2 = call(['health'], { SUDO_USER: 'dagu', MYTHOS_HOSTOPS_HOME: TMP });
  assert.ok([0, 5].indexOf(r2.code) !== -1, 'exit ' + r2.code);
  assert.strictEqual(auditLines().length, before, 'sudo-mode call must not audit into the caller-chosen dir');
});

// 12 — installed artefact ownership/permissions (skip when not installed)
t('12 installed helper is root-owned 0700 and sudoers fragment 0440', function () {
  var st; try { st = fs.statSync('/usr/local/sbin/mythos-hostops'); } catch (e) { SKIP('not installed yet — owner action pending'); }
  assert.strictEqual(st.uid, 0);
  assert.strictEqual(st.mode & 0o777, 0o700);
  var su = fs.statSync('/etc/sudoers.d/60-dagu-hostops');
  assert.strictEqual(su.uid, 0);
  assert.strictEqual(su.mode & 0o777, 0o440);
  var al = fs.statSync('/etc/mythos/hostops-allowlist.json');
  assert.strictEqual(al.uid, 0);
  assert.strictEqual(al.mode & 0o022, 0);
});

// 13 — Dagu remains loopback-only
t('13 Dagu PoC listens on 127.0.0.1:8095 only', function () {
  var r = cp.spawnSync('ss', ['-ltn'], { encoding: 'utf8' });
  var lines = r.stdout.split('\n').filter(function (l) { return l.indexOf(':8095') !== -1; });
  if (!lines.length) SKIP('dagu-poc not running');
  lines.forEach(function (l) { assert.ok(l.indexOf('127.0.0.1:8095') !== -1, l); });
});

// 14 — MYTHOS services stay healthy (through the boundary where possible)
t('14 existing MYTHOS services healthy', function () {
  var r = call(['systemd-status', '--unit', 'mythos-mcp-http.service']);
  assert.strictEqual(r.body.result.ActiveState, 'active');
  var h = cp.spawnSync('curl', ['-sf', '-m', '5', 'http://127.0.0.1:8130/health'], { encoding: 'utf8' });
  assert.strictEqual(h.status, 0, 'executor /health');
  assert.ok(JSON.parse(h.stdout).ok === true);
});

// 15 — Resource Guard remains NORMAL
t('15 Resource Guard persisted level is NORMAL (read-only observation)', function () {
  var r = call(['resource-guard']);
  assert.strictEqual(r.code, 0);
  if (r.body.result.persisted_level === null) SKIP('guard state file unreadable from this uid');
  assert.strictEqual(r.body.result.persisted_level, 'NORMAL');
});

console.log('\nhostops boundary: ' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped');
process.exit(fail ? 1 : 0);
