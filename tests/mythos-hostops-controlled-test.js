'use strict';
// =====================================================
// MYTHOS — HostOps v0.2 CONTROLLED tier + security properties
// tests/mythos-hostops-controlled-test.js
//
// Drives the REAL helper (ops/hostops/mythos-hostops.js) and the REAL user
// worker (ops/hostops/mythos-hostops-user-worker.js) in dev mode against a
// throw-away unit directory, a fake systemctl that models daemon-reload
// snapshots, a fake bridge CLI and a fake docker. Nothing on the host is
// touched. Run as root it additionally proves the privilege drop: the
// worker runs as `deploy`, with no supplementary groups, and root never
// writes the drop-in.
//
//   node tests/mythos-hostops-controlled-test.js
// =====================================================
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');

var ROOT = path.join(__dirname, '..');
var HELPER = path.join(ROOT, 'ops', 'hostops', 'mythos-hostops.js');
var WORKER = path.join(ROOT, 'ops', 'hostops', 'mythos-hostops-user-worker.js');
var CATALOG = path.join(ROOT, 'ops', 'dagu-poc', 'hostops-allowlist.json');
var FIX = path.join(__dirname, 'fixtures', 'hostops');
var IS_ROOT = process.getuid() === 0;
var DEPLOY = null;
if (IS_ROOT) { try { var pw = fs.readFileSync('/etc/passwd', 'utf8').split('\n').filter(function (l) { return l.split(':')[0] === 'deploy'; })[0].split(':'); DEPLOY = { uid: +pw[2], gid: +pw[3] }; } catch (e) { DEPLOY = null; } }

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hostops-ctl-'));
fs.chmodSync(TMP, 493);
var UNITS = path.join(TMP, 'units');
var HOME = path.join(TMP, 'ledger');
var SD = path.join(TMP, 'sysd');
var TOOLS = path.join(TMP, 'tools');
var TASKS = path.join(TMP, 'tasks');
var KILL = path.join(TMP, 'kill-switch');
var GUARD = path.join(TMP, 'guard.json');
var DROPIN_DIR = path.join(UNITS, 'mythos-github-bridge.service.d');
var DROPIN = path.join(DROPIN_DIR, '20-whatsapp.conf');
var OLD = '21690000660', NEW = '21690001921';

var pass = 0, fail = 0, skip = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { if (e && e.__skip) { skip++; console.log('skip - ' + name + ' (' + e.message + ')'); } else { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e).toString().split('\n').slice(0, 14).join('\n  ')); } } }
function SKIP(m) { var e = new Error(m); e.__skip = true; throw e; }
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

var DROPIN_TEXT = [
  '# MYTHOS GitHub bridge — WhatsApp drop-in (test copy)',
  '[Service]',
  'Environment=MYTHOS_BRIDGE_WHATSAPP_PROVIDER=evolution',
  'Environment=MYTHOS_BRIDGE_WHATSAPP_BASE_URL=http://127.0.0.1:8080',
  'Environment=MYTHOS_BRIDGE_WHATSAPP_INSTANCE=mythos-bridge',
  'Environment=MYTHOS_BRIDGE_WHATSAPP_TO=' + OLD,
  '',
  '# a blank line right after the TO line must survive the rewrite (real drop-in shape)',
  'Environment=MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE=%h/deployments/evolution/bridge.key',
  'Environment=MYTHOS_BRIDGE_WHATSAPP_ENABLED=1',
  ''
].join('\n');

function wrapper(name, target, stateDir) {
  var p = path.join(TMP, name);
  fs.writeFileSync(p, '#!/bin/sh\nexec /usr/bin/node ' + target + ' ' + stateDir + ' "$@"\n', { mode: 493 });
  return p;
}

function catalog(mutate) {
  var doc = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  Object.keys(doc.tools).forEach(function (k) { doc.tools[k].bin = path.join(TOOLS, 'fake-bridge.js'); });
  doc.tools['selftest.whoami'] = { tier: 'NORMAL', bin: path.join(TOOLS, 'fake-bridge.js'), argv: ['whoami'], timeout_ms: 10000 };
  doc.services.user['testapp.service'] = { actions: ['start', 'stop', 'restart'], verify: 'active' };
  doc.services.user['testjob.service'] = { actions: ['start'], verify: 'oneshot' };
  if (mutate) mutate(doc);
  var p = path.join(TMP, 'catalog-' + crypto.randomBytes(3).toString('hex') + '.json');
  fs.writeFileSync(p, JSON.stringify(doc), { mode: 420 });
  return p;
}
var DEFAULT_CATALOG;

function reset() {
  fs.rmSync(UNITS, { recursive: true, force: true });
  fs.mkdirSync(DROPIN_DIR, { recursive: true });
  fs.writeFileSync(DROPIN, DROPIN_TEXT, { mode: 420 });
  fs.rmSync(SD, { recursive: true, force: true }); fs.mkdirSync(SD);
  fs.writeFileSync(path.join(SD, 'config.json'), JSON.stringify({ unitDir: UNITS }));
  fs.writeFileSync(path.join(SD, 'state.json'), JSON.stringify({ env: {}, units: {
    'testapp.service': { LoadState: 'loaded', ActiveState: 'active', SubState: 'running', Result: 'success', Type: 'simple' },
    'testjob.service': { LoadState: 'loaded', ActiveState: 'inactive', SubState: 'dead', Result: 'success', Type: 'oneshot' },
    'mythos-status-monitor.service': { LoadState: 'loaded', ActiveState: 'inactive', SubState: 'dead', Result: 'success', Type: 'oneshot' }
  } }));
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.rmSync(KILL, { force: true });
  fs.writeFileSync(GUARD, JSON.stringify({ level: 'NORMAL' }));
  if (IS_ROOT && DEPLOY) {
    [TMP, UNITS, DROPIN_DIR, DROPIN, SD, path.join(SD, 'config.json'), path.join(SD, 'state.json')].forEach(function (p) { fs.chownSync(p, DEPLOY.uid, DEPLOY.gid); });
  }
  // the fake systemd starts with the ORIGINAL environment loaded
  cp.spawnSync(SYSTEMCTL, ['--user', 'daemon-reload']);
  if (IS_ROOT && DEPLOY) fs.readdirSync(SD).forEach(function (f) { fs.chownSync(path.join(SD, f), DEPLOY.uid, DEPLOY.gid); });
}

fs.mkdirSync(TOOLS); fs.mkdirSync(TASKS);
fs.copyFileSync(path.join(FIX, 'fake-bridge.js'), path.join(TOOLS, 'fake-bridge.js'));
fs.chmodSync(path.join(TOOLS, 'fake-bridge.js'), 493);
var SYSTEMCTL = wrapper('systemctl', path.join(FIX, 'fake-systemctl.js'), SD);
var DOCKER = wrapper('docker', path.join(FIX, 'fake-docker.js'), SD);
fs.mkdirSync(path.join(TASKS, 't-running')); fs.writeFileSync(path.join(TASKS, 't-running', 'status.json'), JSON.stringify({ status: 'RUNNING' }));
DEFAULT_CATALOG = catalog();
reset();

function call(args, opts) {
  opts = opts || {};
  var env = {
    PATH: '/usr/bin:/bin', HOME: TMP,
    MYTHOS_HOSTOPS_HOME: opts.home || HOME, MYTHOS_HOSTOPS_ALLOWLIST: opts.catalog || DEFAULT_CATALOG,
    MYTHOS_HOSTOPS_WORKER: WORKER, MYTHOS_HOSTOPS_WORKER_MODE: 'direct',
    MYTHOS_HOSTOPS_RUN_AS: IS_ROOT && DEPLOY ? 'deploy' : 'self',
    MYTHOS_HOSTOPS_USER_UNIT_DIR: UNITS, MYTHOS_HOSTOPS_SYSTEMCTL: SYSTEMCTL, MYTHOS_HOSTOPS_DOCKER: DOCKER,
    MYTHOS_HOSTOPS_KILL_SWITCH: KILL, MYTHOS_HOSTOPS_TASKS_DIR: TASKS, MYTHOS_HOSTOPS_GUARD_STATE: GUARD,
    MYTHOS_HOSTOPS_TOOL_ROOT: TOOLS + '/'
  };
  var r = cp.spawnSync('/usr/bin/node', [HELPER].concat(args), { encoding: 'utf8', env: env, timeout: 60000 });
  var body = null; try { body = JSON.parse(r.stdout); } catch (e) { /* leave null */ }
  return { code: r.status, body: body, stdout: r.stdout, stderr: r.stderr };
}
var TID = ['--task-id', 't-running', '--github-task', 'gh-issue-477'];
function audit() { try { return fs.readFileSync(path.join(HOME, 'audit.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch (e) { return []; } }
function errCode(r) { return r.body && r.body.error && r.body.error.code; }
function toLine() { return (/^Environment=MYTHOS_BRIDGE_WHATSAPP_TO=(.*)$/m.exec(fs.readFileSync(DROPIN, 'utf8')) || [])[1]; }

// ---------------------------------------------------------------- NORMAL
t('catalog describe: three tiers, CONTROLLED enabled, highly sensitive list present', function () {
  var r = call(['catalog']);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  assert.deepStrictEqual(Object.keys(r.body.result.tiers).sort(), ['CONTROLLED', 'HIGHLY_SENSITIVE', 'NORMAL']);
  assert.strictEqual(r.body.result.controlled_enabled, true);
  assert.ok(Object.keys(r.body.result.highly_sensitive_operations).length >= 10);
  assert.strictEqual(r.body.tier, 'NORMAL');
});
t('config-get: reads the drop-in through the worker and MASKS the recipient', function () {
  var r = call(['config-get', '--key', 'bridge.whatsapp.to']);
  assert.strictEqual(r.code, 0, r.stdout);
  assert.strictEqual(r.body.result.file_value, '216****0660');
  assert.strictEqual(r.body.result.effective_value, '216****0660');
  assert.strictEqual(r.body.result.in_sync, true);
  assert.ok(r.stdout.indexOf(OLD) === -1, 'full number never returned');
});
t('NORMAL tool (notify-config) runs without CONTROLLED gates and masks recipients in its output', function () {
  var r = call(['tool-run', '--tool', 'bridge.notify-config']);
  assert.strictEqual(r.code, 0, r.stdout);
  assert.strictEqual(r.body.tier, 'NORMAL');
  assert.strictEqual(r.body.result.output.recipients_configured, 1);
  assert.strictEqual(r.body.result.output.debug_to, '216****0660', 'tool echo of the raw number is masked');
  assert.ok(r.stdout.indexOf(OLD) === -1);
  assert.strictEqual(r.body.result.output.credential_file_passed, true, '*_FILE path travels');
  assert.ok(!audit().some(function (e) { return e.phase === 'intent'; }), 'NORMAL tier writes no intent record');
});

// ---------------------------------------------------------------- #477: the recipient change
t('#477 config-set TO=+216… : normalised to digits, only that line changes, reload, verified, audited', function () {
  reset();
  var r = call(['config-set', '--key', 'bridge.whatsapp.to', '--value', '+' + NEW].concat(TID));
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  var res = r.body.result;
  assert.strictEqual(res.outcome, 'changed');
  assert.strictEqual(res.before, '216****0660');
  assert.strictEqual(res.after, '216****1921');
  assert.strictEqual(res.verification.effective_env, true);
  assert.deepStrictEqual(res.verification.tool.problems, []);
  assert.deepStrictEqual(res.verification.tool.recipients_masked, ['216****1921']);
  assert.strictEqual(toLine(), NEW, 'digits-only in the file');
  var expected = DROPIN_TEXT.replace('MYTHOS_BRIDGE_WHATSAPP_TO=' + OLD, 'MYTHOS_BRIDGE_WHATSAPP_TO=' + NEW);
  assert.strictEqual(fs.readFileSync(DROPIN, 'utf8'), expected, 'every other line (FROM/instance/url/key file/enabled) byte-identical');
  assert.ok(r.stdout.indexOf(NEW) === -1 && r.stdout.indexOf(OLD) === -1, 'no full number in the response');
  var a = audit();
  var intent = a.filter(function (e) { return e.phase === 'intent' && e.audit_id === r.body.audit_id; });
  var result = a.filter(function (e) { return e.phase === 'result' && e.audit_id === r.body.audit_id; });
  assert.strictEqual(intent.length, 1, 'intent record before execution');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].outcome, 'changed');
  assert.strictEqual(result[0].task.github_task_id, 'gh-issue-477');
  assert.strictEqual(result[0].task_verified, true, 'task_id resolved to a RUNNING executor task');
  assert.ok(fs.readFileSync(path.join(HOME, 'audit.jsonl'), 'utf8').indexOf(NEW) === -1, 'ledger carries the masked value only');
  var ch = path.join(HOME, 'changes', r.body.audit_id + '.json');
  assert.ok(fs.existsSync(ch), 'backup record exists');
  assert.strictEqual(fs.statSync(ch).mode & 511, 384, 'backup is 0600');
  assert.strictEqual(res.change_id, r.body.audit_id);
});
t('idempotent: the same value again is "unchanged" — no write, no new change record', function () {
  var before = fs.readdirSync(path.join(HOME, 'changes')).length;
  var st0 = fs.statSync(DROPIN).mtimeMs;
  var r = call(['config-set', '--key', 'bridge.whatsapp.to', '--value', NEW].concat(TID));
  assert.strictEqual(r.code, 0, r.stdout);
  assert.strictEqual(r.body.result.outcome, 'unchanged');
  assert.strictEqual(fs.readdirSync(path.join(HOME, 'changes')).length, before);
  assert.strictEqual(fs.statSync(DROPIN).mtimeMs, st0);
});
t('change-list shows the change masked', function () {
  var r = call(['change-list']);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.body.result.changes[0].after, '216****1921');
  assert.ok(r.stdout.indexOf(NEW) === -1);
});
t('rollback restores the exact previous bytes and environment; a second rollback is a no-op', function () {
  var id = call(['change-list']).body.result.changes[0].change_id;
  var r = call(['change-rollback', '--change', id].concat(TID));
  assert.strictEqual(r.code, 0, r.stdout);
  assert.strictEqual(r.body.result.outcome, 'rolled_back');
  assert.strictEqual(sha(fs.readFileSync(DROPIN, 'utf8')), sha(DROPIN_TEXT));
  assert.strictEqual(call(['config-get', '--key', 'bridge.whatsapp.to']).body.result.effective_value, '216****0660');
  var r2 = call(['change-rollback', '--change', id].concat(TID));
  assert.strictEqual(r2.code, 0);
  assert.strictEqual(r2.body.result.outcome, 'unchanged');
});
t('rollback refuses to clobber a LATER change (conflict detection)', function () {
  reset();
  var a = call(['config-set', '--key', 'bridge.whatsapp.to', '--value', NEW].concat(TID)).body.audit_id;
  call(['config-set', '--key', 'bridge.whatsapp.to', '--value', '21611111111'].concat(TID));
  var r = call(['change-rollback', '--change', a].concat(TID));
  assert.strictEqual(r.code, 2);
  assert.strictEqual(errCode(r), 'CHANGE_CONFLICT');
  assert.strictEqual(toLine(), '21611111111');
});
t('automatic rollback when the verify tool rejects the new value', function () {
  reset();
  var r = call(['config-set', '--key', 'bridge.whatsapp.to', '--value', '21600000000'].concat(TID));
  assert.strictEqual(r.code, 4, r.stdout);
  assert.strictEqual(errCode(r), 'VERIFY_FAILED_ROLLED_BACK', r.stdout);
  assert.strictEqual(sha(fs.readFileSync(DROPIN, 'utf8')), sha(DROPIN_TEXT), 'file restored');
  assert.strictEqual(call(['config-get', '--key', 'bridge.whatsapp.to']).body.result.effective_value, '216****0660', 'environment restored');
  var last = audit().filter(function (e) { return e.audit_id === r.body.audit_id && e.phase === 'result'; })[0];
  assert.strictEqual(last.outcome, 'rolled_back');
});
t('automatic rollback when daemon-reload fails after the write', function () {
  reset();
  fs.writeFileSync(path.join(SD, 'fail-reload'), '1');
  var r = call(['config-set', '--key', 'bridge.whatsapp.to', '--value', NEW].concat(TID));
  fs.unlinkSync(path.join(SD, 'fail-reload'));
  assert.strictEqual(r.code, 4, r.stdout);
  assert.ok(/^VERIFY_FAILED_ROLLBACK_FAILED$|^VERIFY_FAILED_ROLLED_BACK$/.test(errCode(r)));
  assert.strictEqual(sha(fs.readFileSync(DROPIN, 'utf8')), sha(DROPIN_TEXT), 'file content restored even though reload is broken');
});

// ---------------------------------------------------------------- validation / fail-closed
t('values are validated per key: short, foreign, too many, empty items refused; nothing written', function () {
  reset();
  ['216123', '33612345678', '21611111111,21622222222,21633333333,21644444444', ',', '+'].forEach(function (v) {
    var r = call(['config-set', '--key', 'bridge.whatsapp.to', '--value', v].concat(TID));
    assert.strictEqual(r.code, 2, v + ' → ' + r.stdout);
  });
  assert.strictEqual(sha(fs.readFileSync(DROPIN, 'utf8')), sha(DROPIN_TEXT));
});
t('injection: newline / systemd specifier / shell metacharacters never reach the file', function () {
  ['21690001921\nExecStart=/bin/sh', '%h', '216$(id)', '21690001921 ExecStart=x', '21690001921;id'].forEach(function (v) {
    var r = call(['config-set', '--key', 'bridge.whatsapp.to', '--value', v].concat(TID));
    assert.strictEqual(r.code, 2, JSON.stringify(v));
    assert.ok(/^ARG_INVALID$|^CONFIG_VALUE_INVALID$/.test(errCode(r)), errCode(r));
  });
  assert.strictEqual(sha(fs.readFileSync(DROPIN, 'utf8')), sha(DROPIN_TEXT));
});
t('fail closed: unknown verb, unknown argument, missing argument, unknown config key', function () {
  assert.strictEqual(errCode(call(['rm-rf', '--path', '/'])), 'UNKNOWN_OPERATION');
  assert.strictEqual(errCode(call(['config-set', '--key', 'bridge.whatsapp.to', '--value', NEW, '--path', '/etc/passwd'])), 'ARG_UNKNOWN');
  assert.strictEqual(errCode(call(['config-set', '--key', 'bridge.whatsapp.to'])), 'ARG_MISSING');
  assert.strictEqual(errCode(call(['config-set', '--key', 'executor.token', '--value', 'x'].concat(TID))), 'CONFIG_KEY_UNKNOWN');
});
t('fail closed: a v0.1 catalog, a non-JSON catalog → refused before anything runs', function () {
  var old = path.join(TMP, 'old.json'); var d = JSON.parse(fs.readFileSync(DEFAULT_CATALOG, 'utf8')); d.schema_version = '0.1.0'; fs.writeFileSync(old, JSON.stringify(d));
  assert.strictEqual(errCode(call(['health'], { catalog: old })), 'ALLOWLIST_SCHEMA');
  var bad = path.join(TMP, 'bad.json'); fs.writeFileSync(bad, '{not json');
  assert.strictEqual(errCode(call(['health'], { catalog: bad })), 'ALLOWLIST_INVALID');
});
t('fail closed: ambiguous drop-in (duplicate or missing line) is refused, never "fixed"', function () {
  reset();
  fs.appendFileSync(DROPIN, 'Environment=MYTHOS_BRIDGE_WHATSAPP_TO=21612345678\n');
  assert.strictEqual(errCode(call(['config-set', '--key', 'bridge.whatsapp.to', '--value', NEW].concat(TID))), 'CONFIG_AMBIGUOUS');
  reset();
  fs.writeFileSync(DROPIN, DROPIN_TEXT.replace(/^Environment=MYTHOS_BRIDGE_WHATSAPP_TO=.*\n/m, ''));
  assert.strictEqual(errCode(call(['config-set', '--key', 'bridge.whatsapp.to', '--value', NEW].concat(TID))), 'CONFIG_AMBIGUOUS');
});
t('fail closed: CONTROLLED refuses when the intent audit cannot be written — and changes nothing', function () {
  reset();
  var blocked = path.join(TMP, 'not-a-dir'); fs.writeFileSync(blocked, 'x');
  var r = call(['config-set', '--key', 'bridge.whatsapp.to', '--value', NEW].concat(TID), { home: blocked });
  assert.strictEqual(r.code, 5, r.stdout);
  assert.strictEqual(errCode(r), 'AUDIT_UNAVAILABLE');
  assert.strictEqual(sha(fs.readFileSync(DROPIN, 'utf8')), sha(DROPIN_TEXT));
});

// ---------------------------------------------------------------- HIGHLY SENSITIVE
t('HIGHLY_SENSITIVE operations are refused by name and audited with their tier', function () {
  ['host.ssh.change', 'host.firewall.change', 'host.secret.read', 'host.secret.export', 'host.user.create', 'host.sudoers.change',
   'host.root.shell', 'host.sandbox.disable', 'host.audit.disable', 'host.backup.delete', 'host.data.destroy', 'host.policy.change', 'host.auth.change', 'host.guard.change'].forEach(function (op) {
    var r = call([op].concat(TID));
    assert.strictEqual(r.code, 2, op);
    assert.strictEqual(errCode(r), 'HIGHLY_SENSITIVE', op);
    var e = audit().pop();
    assert.strictEqual(e.tier, 'HIGHLY_SENSITIVE'); assert.strictEqual(e.outcome, 'refused');
    assert.strictEqual(e.task.github_task_id, 'gh-issue-477', 'refusals are attributed too');
  });
});
t('OWNER-class operations are refused (generic file write, compose deploy/rollback)', function () {
  [['file-write', '--path', '/home/deploy/deployments/x/y'], ['compose-up', '--project', '/home/deploy/deployments/x'], ['host.docker.rollback', '--project', '/home/deploy/deployments/x']].forEach(function (a) {
    assert.strictEqual(errCode(call(a)), 'OWNER_APPROVAL_REQUIRED', a[0]);
  });
});
t('hard invariants hold even against a TAMPERED catalog', function () {
  reset();
  var tamper = catalog(function (d) {
    d.config_keys['xx.token'] = { unit: 'mythos-github-bridge.service', dropin: '20-whatsapp.conf', env: 'MYTHOS_BRIDGE_WHATSAPP_API_KEY', item_pattern: '^[a-z]{1,9}$' };
    d.config_keys['xx.guard'] = { unit: 'mythos-github-bridge.service', dropin: '20-whatsapp.conf', env: 'MYTHOS_RESOURCE_GUARD', item_pattern: '^(on|off)$' };
    d.config_keys['xx.exec'] = { unit: 'mythos-ai-executor.service', dropin: 'memory.conf', env: 'MYTHOS_FOO', item_pattern: '^[a-z]{1,9}$' };
    d.config_keys['xx.path'] = { unit: 'mythos-github-bridge.service', dropin: '../../../x.conf', env: 'MYTHOS_FOO', item_pattern: '^[a-z]{1,9}$' };
    d.config_keys['xx.home'] = { unit: 'mythos-github-bridge.service', dropin: '20-whatsapp.conf', env: 'HOME', item_pattern: '^[a-z]{1,9}$' };
    d.services.user['mythos-ai-executor.service'] = { actions: ['restart', 'stop'] };
    d.services.system['ssh.service'] = { actions: ['restart'] };
    d.services.user['mythos-guardian.service'] = { actions: ['start', 'stop'] };
    d.containers['evolution-postgres'] = { actions: ['restart'] };
    d.tools['evil.root'] = { tier: 'NORMAL', bin: '/usr/bin/id', argv: [] };
    d.tools['evil.hs'] = { tier: 'HIGHLY_SENSITIVE', bin: path.join(TOOLS, 'fake-bridge.js'), argv: ['whoami'] };
  });
  var o = { catalog: tamper };
  assert.strictEqual(errCode(call(['config-set', '--key', 'xx.token', '--value', 'abc'].concat(TID), o)), 'HIGHLY_SENSITIVE');
  assert.strictEqual(errCode(call(['config-set', '--key', 'xx.guard', '--value', 'off'].concat(TID), o)), 'HIGHLY_SENSITIVE');
  assert.strictEqual(errCode(call(['config-set', '--key', 'xx.exec', '--value', 'abc'].concat(TID), o)), 'PROTECTED_UNIT');
  assert.strictEqual(errCode(call(['config-set', '--key', 'xx.path', '--value', 'abc'].concat(TID), o)), 'HARD_DROPIN');
  assert.strictEqual(errCode(call(['config-set', '--key', 'xx.home', '--value', 'abc'].concat(TID), o)), 'HARD_ENV_NAME');
  assert.strictEqual(errCode(call(['service-control', '--unit', 'mythos-ai-executor.service', '--action', 'restart'].concat(TID), o)), 'PROTECTED_UNIT');
  assert.strictEqual(errCode(call(['service-control', '--unit', 'ssh.service', '--action', 'restart'].concat(TID), o)), 'PROTECTED_UNIT');
  assert.strictEqual(errCode(call(['service-control', '--unit', 'mythos-guardian.service', '--action', 'stop'].concat(TID), o)), 'HIGHLY_SENSITIVE');
  assert.strictEqual(errCode(call(['docker-restart', '--container', 'evolution-postgres'].concat(TID), o)), 'PROTECTED_CONTAINER');
  assert.strictEqual(errCode(call(['tool-run', '--tool', 'evil.root'].concat(TID), o)), 'HARD_TOOL_ROOT');
  assert.strictEqual(errCode(call(['tool-run', '--tool', 'evil.hs'].concat(TID), o)), 'HIGHLY_SENSITIVE');
  assert.strictEqual(sha(fs.readFileSync(DROPIN, 'utf8')), sha(DROPIN_TEXT));
});
t('a key-file PATH (absolute or %h/ specifier) is not mistaken for an inline secret', function () {
  reset();
  fs.appendFileSync(DROPIN, 'Environment=MYTHOS_OTHER_TOKEN_FILE=/home/deploy/deployments/x/token\n');
  var r = call(['config-get', '--key', 'bridge.whatsapp.to']);
  assert.strictEqual(r.code, 0, r.stdout);
});
t('a drop-in holding an inline secret is itself HIGHLY_SENSITIVE (owner-only)', function () {
  reset();
  fs.appendFileSync(DROPIN, 'Environment=MYTHOS_BRIDGE_WHATSAPP_API_KEY=abcdef123\n');
  assert.strictEqual(errCode(call(['config-set', '--key', 'bridge.whatsapp.to', '--value', NEW].concat(TID))), 'HIGHLY_SENSITIVE');
  assert.strictEqual(errCode(call(['config-get', '--key', 'bridge.whatsapp.to'])), 'HIGHLY_SENSITIVE');
});
t('raw secret env values are never handed to a tool; *_FILE paths are', function () {
  reset();
  var r = call(['tool-run', '--tool', 'bridge.notify-config']);
  assert.strictEqual(r.body.result.output.raw_key_passed, false);
  assert.strictEqual(r.body.result.output.credential_file_passed, true);
});

// ---------------------------------------------------------------- CONTROLLED gates
t('owner kill switch disables CONTROLLED (READ still works) and changes nothing', function () {
  reset();
  fs.writeFileSync(KILL, 'owner');
  var r = call(['config-set', '--key', 'bridge.whatsapp.to', '--value', NEW].concat(TID));
  assert.strictEqual(errCode(r), 'CONTROLLED_DISABLED');
  assert.strictEqual(call(['health']).code, 0);
  assert.strictEqual(call(['catalog']).body.result.controlled_enabled, false);
  fs.unlinkSync(KILL);
  assert.strictEqual(sha(fs.readFileSync(DROPIN, 'utf8')), sha(DROPIN_TEXT));
});
t('Resource Guard CRITICAL defers config changes but not recovery (service restart)', function () {
  reset();
  fs.writeFileSync(GUARD, JSON.stringify({ level: 'CRITICAL' }));
  assert.strictEqual(errCode(call(['config-set', '--key', 'bridge.whatsapp.to', '--value', NEW].concat(TID))), 'RESOURCE_PRESSURE');
  assert.strictEqual(call(['service-control', '--unit', 'testapp.service', '--action', 'restart'].concat(TID)).code, 0);
  fs.writeFileSync(GUARD, JSON.stringify({ level: 'NORMAL' }));
});
t('single-writer lock: a live holder refuses (LOCKED); a stale lock is reclaimed', function () {
  reset();
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(path.join(HOME, 'controlled.lock'), JSON.stringify({ pid: process.pid, ts: Date.now(), audit_id: 'hostops-test-000000' }));
  assert.strictEqual(errCode(call(['user-daemon-reload'].concat(TID))), 'LOCKED');
  fs.writeFileSync(path.join(HOME, 'controlled.lock'), JSON.stringify({ pid: 999999, ts: Date.now(), audit_id: 'hostops-test-000001' }));
  assert.strictEqual(call(['user-daemon-reload'].concat(TID)).code, 0);
  assert.ok(!fs.existsSync(path.join(HOME, 'controlled.lock')), 'lock released after the operation');
});
t('notify-test: needs --confirm yes; then rate-limited to one per 10 minutes', function () {
  reset();
  assert.strictEqual(errCode(call(['tool-run', '--tool', 'bridge.notify-test'].concat(TID))), 'CONFIRM_REQUIRED');
  var r1 = call(['tool-run', '--tool', 'bridge.notify-test', '--confirm', 'yes'].concat(TID));
  assert.strictEqual(r1.code, 0, r1.stdout);
  assert.strictEqual(r1.body.tier, 'CONTROLLED');
  assert.strictEqual(r1.body.result.output.sent, 1);
  assert.ok(r1.stdout.indexOf(OLD) === -1, 'recipient masked in the result');
  var r2 = call(['tool-run', '--tool', 'bridge.notify-test', '--confirm', 'yes'].concat(TID));
  assert.strictEqual(errCode(r2), 'RATE_LIMITED');
});

// ---------------------------------------------------------------- services / containers
t('service-control: catalogued user service restart executes and is verified', function () {
  reset();
  var r = call(['service-control', '--unit', 'testapp.service', '--action', 'restart'].concat(TID));
  assert.strictEqual(r.code, 0, r.stdout);
  assert.strictEqual(r.body.result.outcome, 'executed');
  assert.strictEqual(r.body.result.scope, 'user');
  assert.strictEqual(r.body.result.after.ActiveState, 'active');
});
t('service-control: stop is idempotent and names its rollback; start restores', function () {
  var r = call(['service-control', '--unit', 'testapp.service', '--action', 'stop'].concat(TID));
  assert.strictEqual(r.body.result.outcome, 'executed');
  assert.ok(/--action start/.test(r.body.result.rollback));
  assert.strictEqual(call(['service-control', '--unit', 'testapp.service', '--action', 'stop'].concat(TID)).body.result.outcome, 'unchanged');
  assert.strictEqual(call(['service-control', '--unit', 'testapp.service', '--action', 'start'].concat(TID)).body.result.after.ActiveState, 'active');
});
t('service-control: oneshot start verified by Result; system scope runs through root systemctl', function () {
  assert.strictEqual(call(['service-control', '--unit', 'testjob.service', '--action', 'start'].concat(TID)).code, 0);
  var r = call(['service-control', '--unit', 'mythos-status-monitor.service', '--action', 'start'].concat(TID));
  assert.strictEqual(r.code, 0, r.stdout);
  assert.strictEqual(r.body.result.scope, 'system');
});
t('service-control refusals: not catalogued, action not allowed, stopping a backup unit', function () {
  assert.strictEqual(errCode(call(['service-control', '--unit', 'nope.service', '--action', 'restart'].concat(TID))), 'SERVICE_NOT_CATALOGUED');
  assert.strictEqual(errCode(call(['service-control', '--unit', 'testjob.service', '--action', 'stop'].concat(TID))), 'ACTION_NOT_ALLOWED');
  assert.strictEqual(errCode(call(['service-control', '--unit', 'mythos-backup.service', '--action', 'stop'].concat(TID))), 'HIGHLY_SENSITIVE');
  assert.strictEqual(errCode(call(['service-control', '--unit', 'mythos-github-bridge.timer', '--action', 'stop'].concat(TID))), 'HIGHLY_SENSITIVE');
});
t('docker-restart: catalogued container executes and is verified; others refused', function () {
  var r = call(['docker-restart', '--container', 'evolution-api'].concat(TID));
  assert.strictEqual(r.code, 0, r.stdout);
  assert.strictEqual(r.body.result.running, true);
  assert.strictEqual(errCode(call(['docker-restart', '--container', 'mythos-dex'].concat(TID))), 'CONTAINER_NOT_CATALOGUED');
});

// ---------------------------------------------------------------- privilege separation
t('the worker refuses to run as root', function () {
  if (!IS_ROOT) SKIP('needs root to demonstrate');
  var r = cp.spawnSync('/usr/bin/node', [WORKER], { input: JSON.stringify({ action: 'file-read', path: '/etc/shadow' }), encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.ok(/WORKER_ROOT_REFUSED/.test(r.stdout));
});
t('privilege drop: deploy-scoped work runs as deploy with NO supplementary groups; root never writes the drop-in', function () {
  if (!IS_ROOT || !DEPLOY) SKIP('needs root + a deploy user');
  reset();
  fs.writeFileSync(path.join(SD, 'calls.log'), ''); fs.chownSync(path.join(SD, 'calls.log'), DEPLOY.uid, DEPLOY.gid);
  var r = call(['tool-run', '--tool', 'selftest.whoami']);
  assert.strictEqual(r.code, 0, r.stdout);
  assert.strictEqual(r.body.result.output.uid, DEPLOY.uid);
  assert.deepStrictEqual(r.body.result.output.groups.filter(function (g) { return g !== DEPLOY.gid; }), [], 'no docker / mythos-hostops / sudo group');
  call(['config-set', '--key', 'bridge.whatsapp.to', '--value', NEW].concat(TID));
  assert.strictEqual(fs.statSync(DROPIN).uid, DEPLOY.uid, 'the rewritten drop-in is owned by deploy (written by deploy)');
  var calls = fs.readFileSync(path.join(SD, 'calls.log'), 'utf8').trim().split('\n').map(JSON.parse).filter(function (c) { return c.scope === 'user'; });
  assert.ok(calls.length > 0 && calls.every(function (c) { return c.uid === DEPLOY.uid; }), 'every systemctl --user ran as deploy');
});
t('symlink swap: a drop-in replaced by a symlink (e.g. to /etc/shadow) is refused, never followed', function () {
  reset();
  fs.unlinkSync(DROPIN);
  fs.symlinkSync('/etc/shadow', DROPIN);
  if (IS_ROOT && DEPLOY) fs.lchownSync(DROPIN, DEPLOY.uid, DEPLOY.gid);
  var r = call(['config-set', '--key', 'bridge.whatsapp.to', '--value', NEW].concat(TID));
  assert.strictEqual(r.code, 4, r.stdout);
  assert.ok(/WORKER_SYMLINK/.test(r.body.error.message), r.body.error.message);
  assert.ok(r.stdout.indexOf('root:') === -1);
});
t('worker compare-and-swap: a write against a stale read is refused', function () {
  reset();
  var body = JSON.stringify({ action: 'file-replace', path: DROPIN, content: 'x', expect_sha256: sha('something else') });
  var o = { input: body, encoding: 'utf8' };
  if (IS_ROOT && DEPLOY) { o.uid = DEPLOY.uid; o.gid = DEPLOY.gid; }
  var r = cp.spawnSync('/usr/bin/node', [WORKER], o);
  assert.ok(/WORKER_CONFLICT/.test(r.stdout), r.stdout + r.stderr);
  assert.strictEqual(sha(fs.readFileSync(DROPIN, 'utf8')), sha(DROPIN_TEXT));
});

// ---------------------------------------------------------------- source invariants
t('source: no shell anywhere in the helper or the worker; fixed binaries only', function () {
  [HELPER, WORKER].forEach(function (f) {
    var src = fs.readFileSync(f, 'utf8');
    assert.ok(!/shell:\s*true/.test(src), f);
    assert.ok(!/execSync\(|(^|[^.\w])exec\(|\/bin\/sh|bash -c/.test(src), f);
  });
  var h = fs.readFileSync(HELPER, 'utf8');
  assert.ok(/'\/usr\/bin\/systemd-run'/.test(h) && /'\/usr\/bin\/node'/.test(h));
});

t('FABLE sessions never inherit the executor\'s raw tokens (claude-code provider env scrub)', function () {
  var cc = require(path.join(ROOT, 'projects', 'mythos-ai-executor', 'providers', 'claude-code.js'));
  var env = cc.sessionEnv({ PATH: '/usr/bin', HOME: '/home/deploy', MYTHOS_EXECUTOR_TOKEN: 's1', MYTHOS_GITHUB_MCP_RW_TOKEN: 's2',
    MYTHOS_MCP_HTTP_TOKEN: 's3', MYTHOS_CONTEXTFORGE_EXECUTOR_TOKEN: 's4', SOME_API_KEY: 's5', DB_PASSWORD: 's6', MYTHOS_MCP_HTTP_PORT: '8765', CLAUDE_CODE_OAUTH_TOKEN: 'cli-login' });
  ['MYTHOS_EXECUTOR_TOKEN', 'MYTHOS_GITHUB_MCP_RW_TOKEN', 'MYTHOS_MCP_HTTP_TOKEN', 'MYTHOS_CONTEXTFORGE_EXECUTOR_TOKEN', 'SOME_API_KEY', 'DB_PASSWORD'].forEach(function (k) { assert.ok(!(k in env), k); });
  assert.strictEqual(env.MYTHOS_MCP_HTTP_PORT, '8765');
  assert.strictEqual(env.CLAUDE_CODE_OAUTH_TOKEN, 'cli-login', 'the CLI keeps its own login');
  var src = fs.readFileSync(path.join(ROOT, 'projects', 'mythos-ai-executor', 'providers', 'claude-code.js'), 'utf8');
  assert.ok(!/env:\s*process\.env\s*,/.test(src) && src.indexOf('env: sessionEnv(process.env)') !== -1, 'spawn uses the scrubbed env');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\nhostops controlled: ' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped');
process.exit(fail ? 1 : 0);
