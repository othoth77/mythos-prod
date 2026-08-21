'use strict';

// tests/production-sync-audit-test.js — static contract for
// scripts/production-sync-audit.sh (post-audit Phase 3): syntax-clean,
// strictly read-only, prints values never secrets, and covers the audit's
// recorded delta list. The script targets the VPS; behavior there is
// operator-verified — here we pin what it is allowed to do.

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var SCRIPT = path.resolve(__dirname, '..', 'scripts', 'production-sync-audit.sh');
var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

var src = fs.readFileSync(SCRIPT, 'utf8');
var syntax = cp.spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
check('bash -n clean', syntax.status === 0, syntax.stderr);

console.log('§ read-only guarantees');
// Test executable lines only: mentions of tools inside comments and
// user-facing say/drift/info messages are documentation, not invocations.
var exec = src.split('\n').filter(function (l) {
  var t = l.trim();
  return t && t.charAt(0) !== '#' && !/^(say|drift|info|ok)\b/.test(t);
}).join('\n');
[
  ['no rsync', /\brsync\b/],
  ['no git checkout/reset/pull', /git[^\n]*\b(checkout|reset|pull|merge|push)\b/],
  ['no systemctl mutation', /systemctl[^\n]*\b(start|stop|restart|reload|enable|disable)\b/],
  ['no rm/mv/cp of system paths', /\b(rm|mv|cp)\s+\/(etc|var|usr|home)/],
  ['no sudo', /\bsudo\b/],
  ['no nginx mutation', /nginx\s+-s/]
].forEach(function (pair) {
  check(pair[0], !pair[1].test(exec));
});
check('git fetch is the only permitted remote touch', /git -C "\$CHECKOUT" fetch origin main --quiet/.test(src));
check('never prints config values (presence + mode only)', /names only, values never printed/.test(src) && !/cat "\$P"/.test(src));

console.log('§ coverage of the audited surfaces');
[
  ['checkout vs origin/main', /origin\/main/],
  ['stale-process detection', /ExecMainStartTimestamp/],
  ['status webroot content hashes', /sha256sum "\$STATUS_DOCROOT/],
  ['live monitor snapshot presence', /live-status\.json/],
  ['backup credential + schedule config presence', /idauto-offhost\.env/],
  ['expected timers', /mythos-status-monitor\.timer/],
  ['recorded deltas: MIG migrations', /MIG-1\/2\/3/],
  ['recorded deltas: hub', /mythosprod\.xyz hub/],
  ['recorded deltas: M-12', /M-12/],
  ['recorded deltas: PR #58', /PR #58/],
  ['recorded deltas: SYA nginx drift', /ssangyong\.autos nginx drift/]
].forEach(function (pair) {
  check(pair[0] + ' covered', pair[1].test(src));
});

console.log('\nproduction-sync-audit: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
