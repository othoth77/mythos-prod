'use strict';

// tests/backup-capture-db-hardening-test.js — pins the security properties of
// the new database-only root-side capture step
// (ops/backup/mythos-backup-capture-db.sh), mirroring
// tests/backup-hardening-test.js's approach for the existing idauto script.
//
// Same scope and honesty note as that suite: the capture step refuses to run
// as non-root by design, so this does NOT execute the full pipeline. It runs
// `bash -n`, and asserts structurally that the same hardening patterns proven
// in mythos-backup-capture.sh are present here too, plus the properties
// specific to this script: MYTHOS_BACKUP_DB_NAME is required (no silent
// fallback to a container default), the target database's existence is
// preflighted before pg_dump ever runs, and it carries no media-consistency
// logic — proving it was not accidentally coupled to idauto's storage model.

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var OPS = path.join(ROOT, 'ops', 'backup');
var CAPTURE_DB = path.join(OPS, 'mythos-backup-capture-db.sh');
var CAPTURE_IDAUTO = path.join(OPS, 'mythos-backup-capture.sh');

var capture = fs.readFileSync(CAPTURE_DB, 'utf8');
var idautoCapture = fs.readFileSync(CAPTURE_IDAUTO, 'utf8');
// Code with full-line `#` comments stripped — the header of this script
// deliberately explains, in prose, what it does NOT do and why (naming the
// idauto script, idauto_observation_media, and manifest.json in that
// explanation), which would otherwise false-positive a plain substring check.
// The properties below must hold of the executable code, not the prose.
var code = capture.split('\n').filter(function (l) {
  return !/^\s*#/.test(l);
}).join('\n');

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// ---------------------------------------------------------------------------
console.log('§1 the script is syntactically valid');
var syn = cp.spawnSync('bash', ['-n', CAPTURE_DB], { encoding: 'utf8' });
check('bash -n clean', syn.status === 0, syn.stderr);
check('is executable', (fs.statSync(CAPTURE_DB).mode & 0o111) !== 0);

// ---------------------------------------------------------------------------
console.log('§2 this is a separate script, not a mode flag on the idauto one');

check('mythos-backup-capture.sh (idauto script) was not modified to add db-only support',
  !/mythos-backup-capture-db|DUMP_PREFIX/.test(idautoCapture));
check('the new script\'s code does not invoke, source, or exec the idauto script',
  !/mythos-backup-capture\.sh/.test(code));

// ---------------------------------------------------------------------------
console.log('§3 no media-consistency coupling — proves this is genuinely database-only');

check('no query against idauto_observation_media in the executable code',
  !/idauto_observation_media/.test(code));
check('no media metadata snapshot step', !/REPEATABLE READ READ ONLY/.test(capture));
check('no media fingerprinting', !/fingerprint\(\)/.test(capture));
check('no manifest.json write in the executable code (that is offhost-backup.js\'s job now)',
  !/manifest\.json/.test(code));
check('no MYTHOS_BACKUP_MEDIA_* config keys accepted',
  !/MYTHOS_BACKUP_MEDIA_(SOURCE|DIR)/.test(capture));

// ---------------------------------------------------------------------------
console.log('§4 the config is data, never code — same discipline as the idauto script (B1)');

check('config is never sourced with `.`', !/^\s*\.\s+"\$CONFIG_FILE"/m.test(capture));
check('config is never sourced with `source`', !/^\s*source\s+"\$CONFIG_FILE"/m.test(capture));
check('config is parsed as KEY=VALUE instead', /CONFIG_KEYS=/.test(capture));
check('unrecognised keys are refused', /unrecognised key/.test(capture));
check('values are charset-checked', /unacceptable characters/.test(capture));
check('config ownership is checked', /config must be owned by root or/.test(capture));
check('config symlinks are refused', /config must not be a symlink/.test(capture));
check('config write-permissions are checked', /config must not be group\/world-writable/.test(capture));
check('uses its OWN config file path, distinct from the idauto script\'s default',
  /backup-schedule-db\.env/.test(capture) && !/backup-schedule-db\.env/.test(idautoCapture));

// ---------------------------------------------------------------------------
console.log('§5 root never runs a path or binary the config chose freely (same as N1/N2 in the idauto script)');

check('paths are allowlisted', /ALLOWED_ROOTS=/.test(capture));
check('allowlist is enforced by a function', /require_safe_path/.test(capture));
['MYTHOS_BACKUP_DB_ARCHIVE', 'MYTHOS_BACKUP_DB_DIR'].forEach(function (v) {
  check('allowlist is applied to ' + v,
    new RegExp('require_safe_path\\s+"' + v + '"').test(capture));
});
check('traversal is refused', /without '\.' or '\.\.'/.test(capture));
check('the docker CLI is resolved, not named by config',
  /command -v docker/.test(capture) && !/MYTHOS_BACKUP_DOCKER/.test(capture));
check('the resolved docker binary must be root-owned', /docker CLI must be owned by root/.test(capture));
check('the container name is shape-checked', /unacceptable container name/.test(capture));
check('it refuses to run as non-root', /must run as root/.test(capture));

// ---------------------------------------------------------------------------
console.log('§6 the properties specific to this script');

check('MYTHOS_BACKUP_DB_NAME is a required key (no silent container-default fallback)',
  /for v in .*MYTHOS_BACKUP_DB_NAME.*; do/.test(capture) &&
  !/DB_NAME="\$\{CFG\[MYTHOS_BACKUP_DB_NAME\]:-\}"/.test(capture));
check('the database name is shape-checked the same way the idauto script checks its optional one',
  /unacceptable database name/.test(capture));
check('the target database is preflighted for existence before pg_dump runs',
  /database not found or not connectable/.test(capture));
check('the existence preflight runs BEFORE the dump attempt',
  capture.indexOf('database not found or not connectable') <
  capture.indexOf("dumping $CONTAINER db="));
check('credentials/target expand inside the container, never on a command line',
  /sh -c 'pg_dump -U "\$POSTGRES_USER"/.test(capture));
check('the dump filename prefix is shape-checked (no path/command injection via config)',
  /unacceptable dump filename prefix/.test(capture));

// ---------------------------------------------------------------------------
console.log('§7 the capture step stays inside its boundary — same as §7 of the idauto suite');

check('it never reads any off-host credential file', !/offhost\.env/.test(capture));
check('it never uploads', !/(curl|wget|aws |s3:)/.test(capture));
check('no credential value pattern is embedded',
  !/AKIA[0-9A-Z]{16}/.test(capture) && !/SECRET_ACCESS_KEY\s*=\s*\S/.test(capture));
check('the dump is validated before it is trusted', /pg_restore --list/.test(capture));
check('no dump is ever deleted, only retired', /cannot retire previous dump/.test(capture));
check('publication requires exactly one file in the hand-off directory',
  /must hold exactly one file/.test(capture));

console.log('\nbackup-capture-db-hardening: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
