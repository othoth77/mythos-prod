'use strict';
// =====================================================
// MYTHOS HADDAD — V0 base server invariants
// tests/mythos-haddad-v0-test.js
//
// Machine-independent: it validates the V0 tooling itself (syntax, report
// contract, safety properties), not the state of the machine it runs on.
// The machine is verified by projects/mythos-haddad/bin/haddad-health.js.
//   * every script parses (node --check, bash -n, python compile);
//   * the health check always emits a well-formed report covering every V0
//     acceptance item, and its exit code agrees with the report;
//   * the tooling is user-level: no sudo, no host-key-check bypass;
//   * the systemd unit template and the documentation are complete.
// =====================================================
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var DIR = path.join(__dirname, '..', 'projects', 'mythos-haddad');
var BIN = path.join(DIR, 'bin');
var pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); } }
function read(rel) { return fs.readFileSync(path.join(DIR, rel), 'utf8'); }
function run(cmd, args, opts) { return cp.spawnSync(cmd, args, Object.assign({ encoding: 'utf8', timeout: 120000 }, opts || {})); }

var SCRIPTS = ['haddad-health.js', 'haddad-diagnostics.sh', 'haddad-setup.sh', 'gpu-vulkan-test.py'];
var V0_CHECKS = ['os', 'resources', 'systemd', 'ssh', 'tailscale', 'git', 'node', 'claude_code', 'runtime', 'logs'];

t('every script exists, is executable and parses', function () {
  SCRIPTS.forEach(function (s) {
    var p = path.join(BIN, s);
    assert.ok(fs.statSync(p).mode & 0o100, s + ' is executable');
    var r = /\.js$/.test(s) ? run(process.execPath, ['--check', p])
      : /\.sh$/.test(s) ? run('bash', ['-n', p])
        : run('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', p]);
    assert.strictEqual(r.status, 0, s + ': ' + r.stderr);
  });
});

t('health check emits a well-formed report whose exit code matches it', function () {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'haddad-test-'));
  var r = run(process.execPath, [path.join(BIN, 'haddad-health.js'), '--quick', '--json'],
    { env: Object.assign({}, process.env, { HADDAD_STATE_DIR: tmp, HADDAD_DATA_DIR: path.join(tmp, 'data') }) });
  var rep = JSON.parse(r.stdout);
  assert.strictEqual(rep.schema, 'mythos-haddad-health/1');
  assert.strictEqual(rep.mode, 'quick');
  assert.ok(['PASS', 'WARN', 'FAIL'].indexOf(rep.status) !== -1);
  var ids = rep.checks.map(function (c) { return c.id; });
  V0_CHECKS.forEach(function (id) { assert.ok(ids.indexOf(id) !== -1, 'report covers ' + id); });
  assert.ok(ids.indexOf('gpu_detect') !== -1 || ids.indexOf('gpu') !== -1, 'report covers the GPU');
  rep.checks.forEach(function (c) {
    assert.ok(['PASS', 'WARN', 'FAIL'].indexOf(c.status) !== -1, c.id + ' status');
    assert.ok(typeof c.detail === 'string' && c.detail.length, c.id + ' detail');
    assert.ok(!/NaN|undefined/.test(c.detail), c.id + ' detail has no NaN/undefined: ' + c.detail);
  });
  var fails = rep.checks.filter(function (c) { return c.status === 'FAIL'; }).length;
  assert.strictEqual(rep.counts.FAIL, fails);
  assert.strictEqual(r.status, fails ? 1 : 0, 'exit code agrees with the report');
  assert.ok(fs.existsSync(path.join(tmp, 'health-latest.json')), 'latest report written');
  assert.ok(/ (PASS|WARN|FAIL) quick /.test(fs.readFileSync(path.join(tmp, 'logs', 'health.log'), 'utf8')), 'one-line log written');
  fs.rmSync(tmp, { recursive: true, force: true });
});

t('health report never carries account identity', function () {
  var src = read('bin/haddad-health.js');
  assert.ok(!/\.(email|orgId|orgName)\b/.test(src), 'auth identity fields are not read into the report');
});

t('tooling is user-level: no sudo execution, no host key check bypass', function () {
  SCRIPTS.forEach(function (s) {
    var heredoc = null; // heredoc bodies are printed text (operator hints), not executed code
    read('bin/' + s).split('\n').forEach(function (line, i) {
      if (heredoc) { if (line.trim() === heredoc) heredoc = null; return; }
      var m = /<<-?\s*['"]?([A-Za-z_]+)['"]?\s*$/.exec(line); if (m) heredoc = m[1];
      var code = line.replace(/#.*$/, '').replace(/say ".*$/, '');
      assert.ok(!/(^|[\s;&|(])sudo\s/.test(code), s + ':' + (i + 1) + ' executes sudo');
      assert.ok(!/StrictHostKeyChecking\s*=?\s*no|UserKnownHostsFile\s*=?\s*\/dev\/null/i.test(line), s + ':' + (i + 1) + ' weakens host key checking');
    });
  });
});

t('setup takes known_hosts entries from the local host key file only', function () {
  var src = read('bin/haddad-setup.sh');
  assert.ok(/\/etc\/ssh\/ssh_host_ed25519_key\.pub/.test(src));
  assert.ok(!/ssh-keyscan/.test(src), 'never trusts a key fetched over the network');
});

t('GPU test refuses software rasterizers', function () {
  var src = read('bin/gpu-vulkan-test.py');
  assert.ok(/dtype in \(1, 2\)/.test(src), 'only integrated/discrete device types are accepted');
});

t('systemd units: oneshot service template + persistent timer', function () {
  var svc = read('systemd/mythos-haddad-health.service'), timer = read('systemd/mythos-haddad-health.timer');
  assert.ok(/Type=oneshot/.test(svc) && /@HADDAD_DIR@\/bin\/haddad-health\.js/.test(svc));
  assert.ok(/%h\/\.local\/bin/.test(svc), 'claude in ~/.local/bin is on the unit PATH');
  assert.ok(/OnUnitActiveSec=/.test(timer) && /Persistent=true/.test(timer) && /WantedBy=timers\.target/.test(timer));
});

t('documentation covers setup, operation, recovery and verification', function () {
  var readme = read('README.md');
  ['## Setup', '## Operation', '## Recovery', '## Verification', '## Layout'].forEach(function (h) {
    assert.ok(readme.indexOf(h) !== -1, 'README has "' + h + '"');
  });
  SCRIPTS.forEach(function (s) { assert.ok(readme.indexOf(s) !== -1, 'README mentions ' + s); });
  assert.ok(fs.existsSync(path.join(DIR, 'STATUS.md')), 'STATUS.md exists');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
