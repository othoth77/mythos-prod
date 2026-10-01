'use strict';
// =====================================================
// MYTHOS — ops/live-e2e/live-e2e-fable.sh: who talks to which systemd manager
// tests/live-e2e-fable-script-test.js
//
// Found live on the VPS (2026-09-30): launched as root, the script asked
// ROOT's user manager for mythos-ai-executor.service — a deploy USER unit —
// and refused with "no start timestamp". These tests pin the fix with shims
// for `id`, `sudo` and `systemctl` on PATH (nothing real is called):
//   * run_deploy_user_systemctl talks to deploy's manager from deploy AND
//     from root (sudo -u deploy XDG_RUNTIME_DIR=/run/user/<uid>, the uid
//     resolved by the caller);
//   * launched as root, the whole script re-runs as deploy (the supervisor it
//     starts must be deploy too); from stdin it refuses with the command to use;
//   * no user-unit operation bypasses the helper.
// Run with: node tests/live-e2e-fable-script-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var SCRIPT = path.join(__dirname, '..', 'ops', 'live-e2e', 'live-e2e-fable.sh');
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'live-e2e-script-'));
var BIN = path.join(TMP, 'bin');
var LOG = path.join(TMP, 'calls.log');
fs.mkdirSync(BIN);

var passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('ok - ' + name); } else { failed++; console.error('FAIL: ' + name); }
}

function shim(name, body) {
  fs.writeFileSync(path.join(BIN, name), '#!/bin/bash\n' + body + '\n', { mode: 0o755 });
}
// id: -un → SHIM_UN, -u → SHIM_U, -u <user> → SHIM_DEPLOY_UID
shim('id', [
  'if [ "$1" = "-un" ]; then echo "$SHIM_UN"; exit 0; fi',
  'if [ "$1" = "-u" ] && [ -n "$2" ]; then [ "$2" = "deploy" ] && { echo "$SHIM_DEPLOY_UID"; exit 0; }; exit 1; fi',
  'if [ "$1" = "-u" ]; then echo "$SHIM_U"; exit 0; fi',
  'exit 1'
].join('\n'));
shim('sudo', 'printf "sudo %s\\n" "$*" >> "$SHIM_LOG"; exit 0');
shim('systemctl', 'printf "systemctl %s\\n" "$*" >> "$SHIM_LOG"; echo "Wed 2026-09-30 21:56:42 UTC"; exit 0');

function run(identity, cmd, opts) {
  opts = opts || {};
  try { fs.unlinkSync(LOG); } catch (e) { /* first run */ }
  var env = Object.assign({}, process.env, {
    PATH: BIN + ':' + process.env.PATH, SHIM_LOG: LOG, SHIM_DEPLOY_UID: '1001',
    SHIM_UN: identity === 'root' ? 'root' : identity, SHIM_U: identity === 'root' ? '0' : (identity === 'deploy' ? '1001' : '1500'),
    FIX_COMMIT: 'c89227ef12d01f7492478a76b2079a063166fe4e'
  }, opts.env || {});
  var r = cp.spawnSync('bash', opts.args || ['-c', cmd], { env: env, encoding: 'utf8', input: opts.input, timeout: 20000 });
  var calls = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), calls: calls };
}
var SRC = 'MYTHOS_E2E_SOURCE_ONLY=1 source ' + JSON.stringify(SCRIPT) + '; ';

ok(cp.spawnSync('bash', ['-n', SCRIPT]).status === 0, 'bash -n: the script parses');

var asDeploy = run('deploy', SRC + 'run_deploy_user_systemctl show mythos-ai-executor.service -p ExecMainStartTimestamp --value');
ok(asDeploy.status === 0 && asDeploy.calls.length === 1 && asDeploy.calls[0] === 'systemctl --user show mythos-ai-executor.service -p ExecMainStartTimestamp --value',
  'as deploy: the helper runs systemctl --user directly (' + asDeploy.calls.join(' | ') + ')');

var asRoot = run('root', SRC + 'run_deploy_user_systemctl show mythos-ai-executor.service -p ExecMainStartTimestamp --value');
ok(asRoot.status === 0 && asRoot.calls.length === 1 &&
  asRoot.calls[0] === 'sudo -u deploy XDG_RUNTIME_DIR=/run/user/1001 systemctl --user show mythos-ai-executor.service -p ExecMainStartTimestamp --value',
  'as root: the helper reaches DEPLOY\'s manager via sudo -u deploy XDG_RUNTIME_DIR=/run/user/<deploy uid> (' + asRoot.calls.join(' | ') + ')');

var asOther = run('someone', SRC + 'run_deploy_user_systemctl is-active mythos-ai-executor.service');
ok(asOther.status !== 0 && asOther.calls.length === 0, 'as any other user: the helper refuses and calls nothing');

var stdinRoot = run('root', null, { args: ['-s'], input: fs.readFileSync(SCRIPT, 'utf8') });
ok(stdinRoot.status === 3 && /REFUSED: running as root from stdin/.test(stdinRoot.out) && stdinRoot.calls.length === 0,
  'root + stdin: refuses with the file command to use, runs nothing');

var fileRoot = run('root', null, { args: [SCRIPT] });
ok(fileRoot.calls.length === 1 && /^sudo -u deploy -H env XDG_RUNTIME_DIR=\/run\/user\/1001 FIX_COMMIT=c89227ef12d01f7492478a76b2079a063166fe4e .*MYTHOS_DEPLOY_USER=deploy .*bash \//.test(fileRoot.calls[0]) &&
  fileRoot.calls[0].indexOf(fs.realpathSync(SCRIPT)) !== -1,
  'root + file: the whole script re-runs as deploy with its runtime dir and FIX_COMMIT (' + (fileRoot.calls[0] || 'no call') + ')');

var other = run('someone', null, { args: [SCRIPT] });
ok(other.status === 3 && /REFUSED: run as deploy/.test(other.out), 'any other user: refused before any check');

// No user-unit operation may bypass the helper: every `systemctl --user` in
// code is inside run_deploy_user_systemctl itself.
var lines = fs.readFileSync(SCRIPT, 'utf8').split('\n');
var bare = lines.map(function (l, i) { return { l: l, n: i + 1 }; }).filter(function (x) {
  var code = x.l.replace(/#.*$/, '');
  return /systemctl --user/.test(code) && !/^\s+(systemctl --user "\$@"|sudo -u "\$DEPLOY_USER" XDG_RUNTIME_DIR="\/run\/user\/\$\{uid\}" systemctl --user "\$@")\s*$/.test(code);
});
ok(bare.length === 0, 'every systemctl --user call goes through run_deploy_user_systemctl' + (bare.length ? ' — bare at line ' + bare.map(function (x) { return x.n; }).join(', ') : ''));
ok(/run_deploy_user_systemctl show mythos-ai-executor\.service -p ExecMainStartTimestamp/.test(lines.join('\n')) &&
  /run_deploy_user_systemctl is-active --quiet mythos-ai-executor\.service/.test(lines.join('\n')),
  'ExecMainStartTimestamp and is-active both use the helper');

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }
console.log('\nlive-e2e script tests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
