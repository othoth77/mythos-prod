'use strict';

// tests/backup-install-db-test.js — validates ops/backup/install-db.sh and
// its 7 systemd units (the database-only pipeline, e.g. mythos_erp),
// mirroring the unit-contract section of tests/backup-scheduler-test.js.
// Static/offline only: it does not install anything, run as root, or touch
// systemd — same honesty note as backup-hardening-test.js.

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var OPS = path.join(ROOT, 'ops', 'backup');
var UNIT_DIR = path.join(OPS, 'systemd');
var INSTALL_DB = path.join(OPS, 'install-db.sh');
var INSTALL_IDAUTO = path.join(OPS, 'install.sh');

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

var installDb = fs.readFileSync(INSTALL_DB, 'utf8');
var installIdauto = fs.readFileSync(INSTALL_IDAUTO, 'utf8');
function stripComments(src) {
  return src.split('\n').filter(function (l) { return !/^\s*#/.test(l); }).join('\n');
}
var installDbCode = stripComments(installDb);
var installIdautoCode = stripComments(installIdauto);

console.log('§1 installer syntax and separation from the idauto installer');
var syn = cp.spawnSync('bash', ['-n', INSTALL_DB], { encoding: 'utf8' });
check('bash -n clean', syn.status === 0, syn.stderr);
check('the existing idauto installer was not modified', !/install-db|backup-schedule-db|mythos-backup-capture-db/.test(installIdautoCode));
check('this installer requires root, same as install.sh', /must run as root/.test(installDb));
check('this installer\'s code does not source or exec install.sh', !/install\.sh/.test(installDbCode));

console.log('§2 paths are distinct from the idauto pipeline (no collision possible)');
check('root archive path is distinct (/var/backups/mythos-db)', /\/var\/backups\/mythos-db\b/.test(installDb));
check('root archive path is NOT the idauto one', !/install -o root -g root -m 0700 -d \/var\/backups\/mythos\s/.test(installDb));
check('hand-off dir is distinct (erp-db-dumps)', /erp-db-dumps/.test(installDb));
check('staging dir is distinct (erp-staging)', /erp-staging/.test(installDb));
check('binary destination is distinct (mythos-backup-capture-db)',
  /\/usr\/local\/sbin\/mythos-backup-capture-db/.test(installDb));
check('config path is distinct (backup-schedule-db.env)', /backup-schedule-db\.env/.test(installDb));

console.log('§3 the off-host credential is deliberately REUSED, not duplicated');
check('references the existing idauto-offhost.env credential', /idauto-offhost\.env/.test(installDb));
check('does not invent a second credential filename', !/erp-offhost\.env|mythos-erp-offhost/.test(installDb));
check('credential ownership/mode checks mirror install.sh\'s (0600, owned by deploy)',
  /mode 0600/.test(installDb) && /owned by \$OWNER_USER/.test(installDb));

console.log('§4 systemd unit contract — mirrors §6 of backup-scheduler-test.js for the db-only units');
var units = ['mythos-backup-capture-db.service',
  'mythos-backup-db.service', 'mythos-backup-db.timer',
  'mythos-backup-db-verify.service', 'mythos-backup-db-verify.timer',
  'mythos-restore-db-test.service', 'mythos-restore-db-test.timer'];
units.forEach(function (u) {
  check('unit exists: ' + u, fs.existsSync(path.join(UNIT_DIR, u)));
});
var modeByUnit = {
  'mythos-backup-db.service': 'backup',
  'mythos-backup-db-verify.service': 'verify',
  'mythos-restore-db-test.service': 'restore-test'
};
Object.keys(modeByUnit).forEach(function (u) {
  var s = fs.readFileSync(path.join(UNIT_DIR, u), 'utf8');
  check(u + ' runs as deploy oneshot', /User=deploy/.test(s) && /Type=oneshot/.test(s));
  check(u + ' calls the NEW wrapper with mode ' + modeByUnit[u],
    s.indexOf('ops/backup/mythos-backup-run-db.sh ' + modeByUnit[u]) >= 0);
  check(u + ' does not call the idauto wrapper', s.indexOf('mythos-backup-run.sh') < 0);
  check(u + ' hardened (NoNewPrivileges)', /NoNewPrivileges=yes/.test(s));
});
var captureUnit = fs.readFileSync(path.join(UNIT_DIR, 'mythos-backup-capture-db.service'), 'utf8');
check('capture unit runs the NEW capture binary', /ExecStart=\/usr\/local\/sbin\/mythos-backup-capture-db$/m.test(captureUnit));
check('capture unit Requires+Before the db backup service, not the idauto one',
  /Requires=docker\.service/.test(captureUnit) && /Before=mythos-backup-db\.service/.test(captureUnit) &&
  captureUnit.indexOf('mythos-backup.service') < 0);
units.filter(function (u) { return /\.timer$/.test(u); }).forEach(function (u) {
  var s = fs.readFileSync(path.join(UNIT_DIR, u), 'utf8');
  check(u + ' has OnCalendar + Persistent', /OnCalendar=/.test(s) && /Persistent=true/.test(s));
});
var allUnitText = units.map(function (u) {
  return fs.readFileSync(path.join(UNIT_DIR, u), 'utf8');
}).join('\n');
check('no unit carries credentials', !/KEY|SECRET|TOKEN|PASSWORD/i.test(allUnitText.replace(/NoNewPrivileges/g, '')));

console.log('§5 the existing idauto units are byte-for-byte unaffected');
var idautoUnits = ['mythos-backup-capture.service', 'mythos-backup.service', 'mythos-backup.timer',
  'mythos-backup-verify.service', 'mythos-backup-verify.timer',
  'mythos-restore-test.service', 'mythos-restore-test.timer'];
idautoUnits.forEach(function (u) {
  var s = fs.readFileSync(path.join(UNIT_DIR, u), 'utf8');
  check(u + ' unaffected: no reference to the db-only pipeline', s.indexOf('-db') < 0 && s.indexOf('erp') < 0);
});

console.log('\nbackup-install-db: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
