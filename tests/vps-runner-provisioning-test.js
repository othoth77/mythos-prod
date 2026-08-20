'use strict';
// =====================================================
// Mythos — VPS runner provisioning test
// tests/vps-runner-provisioning-test.js
//
// Guards the self-hosted runner provisioning package
// (projects/infrastructure/github-runner/) against the failure observed
// on the VPS 2026-08-20 and against forbidden "fixes":
//
//   Failure: mktemp -d ran as root (0700, root-owned), then
//   `sudo -u mythos-runner tar -xzf` could not open the tarball inside it
//   ("Cannot open: Permission denied"). The fix hands the temp dir (and
//   tarball) to mythos-runner BEFORE the unprivileged extraction.
//
// Forbidden fixes this suite rejects: chmod 777, extracting as root,
// docker group membership, sudoers grants, dropping NoNewPrivileges.
// Also asserts rerun-safety invariants for the partial-install state the
// failure left behind (account exists, no binaries, no .runner).
//
// Run with: node tests/vps-runner-provisioning-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var { spawnSync } = require('child_process');

var BASE = path.join(__dirname, '..', 'projects', 'infrastructure', 'github-runner');
var PROVISION = path.join(BASE, 'provision-runner.sh');
var VERIFY = path.join(BASE, 'verify-runner.sh');
var UNIT = path.join(BASE, 'mythos-gh-runner.service');

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

var provision = fs.readFileSync(PROVISION, 'utf8');
var unit = fs.readFileSync(UNIT, 'utf8');
var lines = provision.split('\n');

function lineIndex(re) {
  for (var i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

console.log('--- syntax ---');
[PROVISION, VERIFY].forEach(function (f) {
  var r = spawnSync('bash', ['-n', f], { encoding: 'utf8' });
  ok(r.status === 0, 'bash -n clean: ' + path.basename(f) + (r.status !== 0 ? ' :: ' + r.stderr : ''));
});

console.log('--- regression: temp dir handed to runner before unprivileged tar ---');
var iMktemp = lineIndex(/TMP="\$\(mktemp -d\)"/);
var iChownTmp = lineIndex(/chown "\$RUNNER_USER:\$RUNNER_USER" "\$TMP"$/);
var iChownTarball = lineIndex(/chown "\$RUNNER_USER:\$RUNNER_USER" "\$TMP\/\$TARBALL"/);
var iTar = lineIndex(/sudo -u "\$RUNNER_USER" tar -xzf/);
ok(iMktemp >= 0, 'temp dir still created with mktemp -d');
ok(iChownTmp > iMktemp, 'temp dir chowned to $RUNNER_USER after mktemp');
ok(iTar > iChownTmp && iChownTmp >= 0, 'temp dir chown happens BEFORE unprivileged tar');
ok(iTar > iChownTarball && iChownTarball >= 0, 'tarball chown happens BEFORE unprivileged tar');
ok(iTar >= 0, 'extraction still runs unprivileged as $RUNNER_USER (not root)');
var iChownHome = lineIndex(/chown -R "\$RUNNER_USER:\$RUNNER_USER" "\$RUNNER_HOME"/);
ok(iChownHome >= 0 && iChownHome < iTar, 'runner home re-owned before extraction (clears root-owned fragments)');

console.log('--- forbidden remediations absent ---');
ok(!/chmod\s+-?R?\s*0?777/.test(provision), 'no chmod 777 anywhere');
ok(!/usermod\s+-aG?\s+.*docker/.test(provision), 'no docker group membership granted');
ok(!/NOPASSWD|>>\s*\/etc\/sudoers/.test(provision), 'no sudoers grant written');
ok(!/^\s*tar -xzf/m.test(provision), 'no root-privileged tar extraction path');
ok(!/echo[^\n]*\$RUNNER_TOKEN/.test(provision), 'token never echoed');

console.log('--- rerun safety after partial install ---');
ok(/NEED_DOWNLOAD/.test(provision) && /NEED_CONFIG/.test(provision),
  'download and registration tracked independently (resumes any partial state)');
var iFiAccount = lineIndex(/^fi$/);
var iPasswdLock = lineIndex(/^passwd -l "\$RUNNER_USER"/);
ok(iPasswdLock > iFiAccount && iPasswdLock >= 0, 'password locked unconditionally on every run (not only at creation)');
ok(/EXISTING_HOME/.test(provision) && /refusing to adopt/.test(provision),
  'pre-existing account with unexpected home is rejected, not adopted');
ok(/--replace/.test(provision), 'config.sh --replace: reruns survive a stale GitHub-side registration');
ok(/if \[ ! -f "\$RUNNER_HOME\/\.runner" \]; then\n\s*\[ -n "\$\{RUNNER_TOKEN:-\}" \]/.test(provision),
  'RUNNER_TOKEN only required when registration is still needed');

console.log('--- regression: registration token actually reaches config.sh ---');
// The former `sudo -u … bash -c "…" RUNNER_TOKEN=…` pattern never
// delivered the token: the trailing word becomes the child shell's $0
// (and shows in the process list), while sudo env_reset strips the real
// variable — config.sh received an EMPTY token (verified empirically
// 2026-08-20). runuser inherits the exported env instead.
ok(!/bash -c "[\s\S]*?" RUNNER_TOKEN=/.test(provision),
  'token is never a bash -c trailing word (that is $0, not an env var)');
ok(/export RUNNER_TOKEN/.test(provision),
  'token exported so the unprivileged child shell inherits it');
ok(/runuser -u "\$RUNNER_USER" -- bash -c '[\s\S]*?--token "\$RUNNER_TOKEN"[\s\S]*?'/.test(provision),
  'registration runs via runuser; child expands $RUNNER_TOKEN from its own env');
ok(!/sudo -u "\$RUNNER_USER" bash -c/.test(provision),
  'no sudo-based registration call remains (env_reset would strip the token)');

console.log('--- security invariants preserved ---');
ok(/passwd -l/.test(provision), 'locked password');
ok(/for banned in docker sudo mythos-gov root/.test(provision), 'banned-group hard-fail retained');
ok(/User=mythos-runner/.test(unit), 'unit runs as mythos-runner');
ok(/NoNewPrivileges=yes/.test(unit), 'NoNewPrivileges=yes');
ok(/^CapabilityBoundingSet=$/m.test(unit), 'empty capability bounding set');
ok(/ProtectSystem=full/.test(unit) && /ProtectHome=read-only/.test(unit), 'unit filesystem hardening intact');
ok(/--url "\$2"/.test(provision) && /_ "\$RUNNER_HOME" "\$REPO_URL"/.test(provision)
    && /REPO_URL=https:\/\/github\.com\/othoth77\/mythos-prod/.test(provision),
  'registration stays repo-scoped to othoth77/mythos-prod (URL via positional arg)');

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
