'use strict';

// tests/runner-workspace-repair-test.js — static contract for
// ops/runner/inspect-and-repair-workspace.sh (Step-0 tooling of the
// production-closure mission). Pins: syntax, inspect-first default,
// minimal-correction repair (no blind recursive chown), scoped reset,
// and that it never touches runner service config, sudoers, privileges,
// or governance controls.

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var SCRIPT = path.resolve(__dirname, '..', 'ops', 'runner', 'inspect-and-repair-workspace.sh');
var src = fs.readFileSync(SCRIPT, 'utf8');
var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

var syn = cp.spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
check('bash -n clean', syn.status === 0, syn.stderr);
check('root-gated', /id -u.*-eq 0/.test(src));
check('default mode is read-only inspect', /MODE="\$\{1:-inspect\}"/.test(src));
check('runner user derived from evidence, not hardcoded', /stat -c %U "\$RUNNER_ROOT"/.test(src));
check('inspects the full failing path chain', /\.git\/objects/.test(src) && /_work/.test(src));
check('checks ACLs and immutable attributes', /getfacl/.test(src) && /lsattr/.test(src));
check('disambiguates EACCES vs ENOSPC (df + inodes)', /df -h/.test(src) && /df -i/.test(src));
check('repair chowns ONLY foreign-owned entries via find ! -user', /find "\$WORKSPACE" ! -user "\$RUNNER_USER" -exec chown/.test(src));
check('no blind recursive chown of the runner root', !/chown -R/.test(src) && !/chown[^\n]*\$RUNNER_ROOT/.test(src));
check('repair refuses when nothing is foreign-owned', /REFUSED: no foreign-owned entries/.test(src));
check('reset scoped strictly to the disposable workspace', /rm -rf "\$WORKSPACE"/.test(src) && !/rm -rf "\$RUNNER_ROOT"/.test(src));
// Executable lines only — the header comment legitimately names the things
// the script must never touch.
var execLines = src.split('\n').filter(function (l) {
  var t = l.trim();
  return t && t.charAt(0) !== '#' && !/^echo\b/.test(t);
}).join('\n');
check('never edits service config / sudoers / privileges', !/systemctl (edit|set-property|enable|disable|mask)/.test(execLines) && !/sudoers|visudo|NoNewPrivileges|usermod|gpasswd/.test(execLines));
check('verifies repair result before declaring OK', /remaining foreign-owned entries/.test(src));

console.log('\nrunner-workspace-repair: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
