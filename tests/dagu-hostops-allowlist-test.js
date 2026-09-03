'use strict';
// =====================================================
// MYTHOS — host-operations allowlist invariants (Dagu Host Control PoC)
// tests/dagu-hostops-allowlist-test.js
//
// The allowlist (ops/dagu-poc/hostops-allowlist.json) is the declared
// policy for what a Dagu host workflow may ask the root-owned helper to do.
// These invariants must hold before any helper is written against it:
//   * every operation names a known class and a helper verb;
//   * READ never needs approval; WRITE/RESTART need governance; DEPLOY
//     needs the owner; DESTRUCTIVE is not an executable class at all;
//   * every argument is pattern-validated (anchored regex, no bare `.*`);
//   * no operation can name a protected unit for restart;
//   * the "denied forever" list covers the boundaries the mission names.
// =====================================================
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var FILE = path.join(__dirname, '..', 'ops', 'dagu-poc', 'hostops-allowlist.json');
var doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
var pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); } }

var CLASSES = ['READ', 'WRITE', 'RESTART', 'DEPLOY', 'DESTRUCTIVE'];
var APPROVAL_BY_CLASS = { READ: 'none', WRITE: 'governance', RESTART: 'governance', DEPLOY: 'owner', DESTRUCTIVE: 'never' };
var NAME_RE = /^host\.[a-z]+\.[a-z_]+$/;

t('classes are exactly the mission classes with the expected approval levels', function () {
  assert.deepStrictEqual(Object.keys(doc.classes).sort(), CLASSES.slice().sort());
  CLASSES.forEach(function (c) { assert.strictEqual(doc.classes[c].approval, APPROVAL_BY_CLASS[c], c); });
});

t('every operation has a valid name, a known class and a helper verb', function () {
  var names = Object.keys(doc.operations);
  assert.ok(names.length >= 5, 'allowlist is not empty');
  names.forEach(function (n) {
    var op = doc.operations[n];
    assert.ok(NAME_RE.test(n), 'name ' + n);
    assert.ok(CLASSES.indexOf(op.class) !== -1, 'class of ' + n);
    assert.ok(/^[a-z][a-z-]{2,30}$/.test(op.helper), 'helper of ' + n);
    assert.ok(op.args && typeof op.args === 'object', 'args of ' + n);
  });
});

t('DESTRUCTIVE is never an executable operation', function () {
  Object.keys(doc.operations).forEach(function (n) {
    assert.notStrictEqual(doc.operations[n].class, 'DESTRUCTIVE', n);
  });
});

t('every argument pattern is an anchored, compilable regex and never a bare wildcard', function () {
  Object.keys(doc.operations).forEach(function (n) {
    var args = doc.operations[n].args;
    Object.keys(args).forEach(function (a) {
      var p = args[a];
      assert.ok(p.charAt(0) === '^' && p.charAt(p.length - 1) === '$', n + '.' + a + ' anchored');
      assert.ok(!/^\^\.\*\$$/.test(p) && p.indexOf('.*') === -1, n + '.' + a + ' no bare wildcard');
      new RegExp(p); // throws if invalid
    });
  });
});

t('restart operations cannot name a protected unit or container', function () {
  var protectedNames = doc.protected_units_never_restartable;
  assert.ok(protectedNames.length >= 8);
  Object.keys(doc.operations).forEach(function (n) {
    var op = doc.operations[n];
    if (op.class !== 'RESTART') return;
    Object.keys(op.args).forEach(function (a) {
      var re = new RegExp(op.args[a]);
      protectedNames.forEach(function (u) {
        assert.ok(!re.test(u) && !re.test(u.replace(/\.service$/, '')), n + ' must not match ' + u);
      });
    });
  });
});

t('READ operations are confined to observation verbs and the file-read path to deploy-owned trees', function () {
  Object.keys(doc.operations).forEach(function (n) {
    var op = doc.operations[n];
    if (op.class !== 'READ') return;
    assert.ok(/^(health|docker-status|docker-logs|systemd-status|file-read|resource-guard)$/.test(op.helper), n);
  });
  var re = new RegExp(doc.operations['host.file.read'].args.path);
  assert.ok(re.test('/home/deploy/deployments/x/y.env.example'));
  assert.ok(!re.test('/etc/mythos/governance.key'));
  assert.ok(!re.test('/home/deploy/.config/mythos-ai-executor/executor.env'));
  assert.ok(!re.test('/root/.ssh/id_ed25519'));
});

t('the denied-forever list covers every boundary named by the mission', function () {
  var joined = doc.denied_forever.join('\n').toLowerCase();
  ['rm -rf', 'docker system prune', 'volume', 'network rm', 'drop', 'mkfs', 'iptables', 'shell as root', 'sshd', 'useradd',
   'credential', 'resource guard', 'governance'].forEach(function (k) {
    assert.ok(joined.indexOf(k) !== -1, 'denied_forever mentions ' + k);
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
