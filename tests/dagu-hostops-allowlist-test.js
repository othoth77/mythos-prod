'use strict';
// =====================================================
// MYTHOS — host-operations allowlist invariants (Dagu Host Control PoC)
// tests/dagu-hostops-allowlist-test.js
//
// The catalog (ops/dagu-poc/hostops-allowlist.json, schema v0.2) is the
// declared policy for what FABLE, Dagu and the owner may ask the root-owned
// helper to do. These invariants must hold for every catalog revision:
//   * three tiers — NORMAL (autonomous), CONTROLLED (autonomous under
//     policy + audit), HIGHLY_SENSITIVE (owner, never executed by HostOps);
//   * every operation names a known class, a helper verb, a timeout, an
//     idempotency flag and a rollback statement;
//   * READ never needs approval; OWNER needs the owner; DESTRUCTIVE is not
//     an executable class at all;
//   * every argument is pattern-validated (anchored regex, no bare `.*`);
//   * no catalogued service/container can name a protected unit or data store;
//   * config keys never target secrets or security toggles;
//   * tools have fixed argv and binaries under the approved root;
//   * the "denied forever" and highly-sensitive lists cover the boundaries
//     the permission model names.
// =====================================================
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var FILE = path.join(__dirname, '..', 'ops', 'dagu-poc', 'hostops-allowlist.json');
var doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
var pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); } }

var CLASSES = ['READ', 'CONTROLLED', 'OWNER', 'DESTRUCTIVE'];
var TIER_BY_CLASS = { READ: 'NORMAL', CONTROLLED: 'CONTROLLED', OWNER: 'HIGHLY_SENSITIVE', DESTRUCTIVE: 'HIGHLY_SENSITIVE' };
var APPROVAL_BY_CLASS = { READ: 'none', CONTROLLED: 'policy', OWNER: 'owner', DESTRUCTIVE: 'never' };
var NAME_RE = /^host\.[a-z]+\.[a-z_]+$/;

t('schema v0.2 with exactly three tiers; only NORMAL and CONTROLLED are autonomous', function () {
  assert.ok(/^0\.2\./.test(doc.schema_version));
  assert.deepStrictEqual(Object.keys(doc.tiers).sort(), ['CONTROLLED', 'HIGHLY_SENSITIVE', 'NORMAL']);
  assert.strictEqual(doc.tiers.NORMAL.autonomous, true);
  assert.strictEqual(doc.tiers.CONTROLLED.autonomous, true);
  assert.strictEqual(doc.tiers.HIGHLY_SENSITIVE.autonomous, false);
});

t('classes map to tiers with the expected approval levels', function () {
  assert.deepStrictEqual(Object.keys(doc.classes).sort(), CLASSES.slice().sort());
  CLASSES.forEach(function (c) {
    assert.strictEqual(doc.classes[c].approval, APPROVAL_BY_CLASS[c], c);
    assert.strictEqual(doc.classes[c].tier, TIER_BY_CLASS[c], c);
  });
});

t('every operation has a valid name, class, helper verb, timeout, idempotency and rollback', function () {
  var names = Object.keys(doc.operations);
  assert.ok(names.length >= 10, 'catalog is not empty');
  var helpers = {};
  names.forEach(function (n) {
    var op = doc.operations[n];
    assert.ok(NAME_RE.test(n), 'name ' + n);
    assert.ok(CLASSES.indexOf(op.class) !== -1, 'class of ' + n);
    assert.ok(/^[a-z][a-z-]{2,30}$/.test(op.helper), 'helper of ' + n);
    assert.ok(!helpers[op.helper], 'helper verb unique: ' + op.helper); helpers[op.helper] = true;
    assert.ok(op.args && typeof op.args === 'object', 'args of ' + n);
    assert.ok(Number.isInteger(op.timeout_ms) && op.timeout_ms > 0 && op.timeout_ms <= 60000, 'timeout of ' + n + ' within the daemon ceiling');
    assert.strictEqual(typeof op.idempotent, 'boolean', 'idempotency of ' + n);
    assert.ok(typeof op.rollback === 'string' && op.rollback.length > 3, 'rollback statement of ' + n);
  });
});

t('DESTRUCTIVE is never an executable operation', function () {
  Object.keys(doc.operations).forEach(function (n) {
    assert.notStrictEqual(doc.operations[n].class, 'DESTRUCTIVE', n);
  });
});

t('every argument pattern is an anchored, compilable regex and never a bare wildcard', function () {
  function check(where, p) {
    assert.ok(p.charAt(0) === '^' && p.charAt(p.length - 1) === '$', where + ' anchored');
    assert.ok(!/^\^\.\*\$$/.test(p) && p.indexOf('.*') === -1 && p.indexOf('.+') === -1, where + ' no bare wildcard');
    new RegExp(p); // throws if invalid
  }
  Object.keys(doc.operations).forEach(function (n) {
    Object.keys(doc.operations[n].args).forEach(function (a) { check(n + '.' + a, doc.operations[n].args[a]); });
  });
  Object.keys(doc.config_keys).forEach(function (k) { check('config_keys.' + k, doc.config_keys[k].item_pattern); });
});

t('no catalogued service can be a protected unit; security/backup/control units are never stoppable', function () {
  var protectedNames = doc.protected_units_never_restartable;
  assert.ok(protectedNames.length >= 8);
  ['user', 'system'].forEach(function (scope) {
    Object.keys(doc.services[scope]).forEach(function (u) {
      assert.ok(protectedNames.indexOf(u) === -1 && protectedNames.indexOf(u.replace(/\.service$/, '')) === -1, scope + ' ' + u + ' is protected');
      assert.ok(!/^(mythos-hostops|mythos-ai-executor|mythos-git-push|mythos-session-guard|mythos-memwatch|ssh|docker|nginx|user@)/.test(u), u);
      var acts = doc.services[scope][u].actions;
      assert.ok(acts.length && acts.every(function (x) { return /^(start|stop|restart)$/.test(x); }), u + ' actions');
      if (/^(mythos-guardian|mythos-backup|mythos-restore|mythos-status-monitor|mythos-github-bridge)/.test(u)) assert.ok(acts.indexOf('stop') === -1, u + ' must not be stoppable');
    });
  });
});

t('no catalogued container is a data or identity store', function () {
  Object.keys(doc.containers).forEach(function (c) {
    assert.ok(!/(postgres|mysql|mariadb|redis|mongo|dex|auth|contextforge|vault)/.test(c), c);
    assert.deepStrictEqual(doc.containers[c].actions, ['restart'], c);
  });
});

t('config keys never target a secret, a security toggle or a protected unit', function () {
  Object.keys(doc.config_keys).forEach(function (k) {
    var e = doc.config_keys[k];
    assert.ok(/^MYTHOS_[A-Z0-9_]+$/.test(e.env), k);
    assert.ok(!/(TOKEN|SECRET|PASSW|CREDENTIAL|PRIVATE|API_?KEY|_KEY$|AUTH|GUARD|GOVERN|POLICY|HOSTOPS|APPROV|AUDIT|ALLOW)/.test(e.env), k + ' env ' + e.env);
    assert.ok(!/^(mythos-ai-executor|mythos-hostops|mythos-guardian|mythos-session-guard)/.test(e.unit), k + ' unit');
    assert.ok(/^[0-9a-z][a-z0-9-]{0,40}\.conf$/.test(e.dropin), k + ' dropin');
  });
  assert.ok(doc.config_keys['bridge.whatsapp.to'], 'the #477 key exists');
  var re = new RegExp(doc.config_keys['bridge.whatsapp.to'].item_pattern);
  assert.ok(re.test('+21690001921') && re.test('21690001921'));
  assert.ok(!re.test('33612345678') && !re.test('216123'));
});

t('tools: fixed argv, binary under the approved root, a real tier, outward tools gated', function () {
  Object.keys(doc.tools).forEach(function (n) {
    var tl = doc.tools[n];
    assert.ok(/^(NORMAL|CONTROLLED)$/.test(tl.tier), n);
    assert.ok(tl.bin.indexOf('/home/deploy/projects/mythos-prod/') === 0 && tl.bin.indexOf('..') === -1, n + ' bin root');
    assert.ok(Array.isArray(tl.argv) && tl.argv.every(function (a) { return /^[A-Za-z0-9._=:,+\/-]{1,64}$/.test(a); }), n + ' argv');
  });
  assert.strictEqual(doc.tools['bridge.notify-test'].tier, 'CONTROLLED');
  assert.strictEqual(doc.tools['bridge.notify-test'].requires_confirm, true);
  assert.deepStrictEqual(doc.tools['bridge.notify-test'].rate_limit, { max: 1, per_seconds: 600 });
});

t('READ operations are confined to observation verbs and the file-read path to deploy-owned trees', function () {
  Object.keys(doc.operations).forEach(function (n) {
    var op = doc.operations[n];
    if (op.class !== 'READ') return;
    assert.ok(/^(health|docker-status|docker-logs|systemd-status|file-read|resource-guard|catalog|user-unit-status|config-get|change-list)$/.test(op.helper), n);
  });
  var re = new RegExp(doc.operations['host.file.read'].args.path);
  assert.ok(re.test('/home/deploy/deployments/x/y.env.example'));
  assert.ok(!re.test('/etc/mythos/governance.key'));
  assert.ok(!re.test('/home/deploy/.config/mythos-ai-executor/executor.env'));
  assert.ok(!re.test('/root/.ssh/id_ed25519'));
});

t('the highly-sensitive list names every owner-only boundary', function () {
  ['host.auth.change', 'host.ssh.change', 'host.firewall.change', 'host.secret.read', 'host.secret.export', 'host.user.create',
   'host.sudoers.change', 'host.root.shell', 'host.sandbox.disable', 'host.audit.disable', 'host.backup.delete', 'host.data.destroy',
   'host.policy.change'].forEach(function (k) {
    assert.ok(doc.highly_sensitive_operations[k], k);
    assert.ok(!doc.operations[k], k + ' must not be an executable operation');
  });
});

t('the denied-forever list covers every boundary named by the mission', function () {
  var joined = doc.denied_forever.join('\n').toLowerCase();
  ['rm -rf', 'docker system prune', 'volume', 'network rm', 'drop', 'mkfs', 'iptables', 'shell as root', 'sshd', 'useradd',
   'credential', 'resource guard', 'governance', 'audit', 'backups', 'hostops'].forEach(function (k) {
    assert.ok(joined.indexOf(k) !== -1, 'denied_forever mentions ' + k);
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
