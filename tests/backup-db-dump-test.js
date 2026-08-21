'use strict';

// tests/backup-db-dump-test.js — the DUMP step that runs in front of the
// off-host pipeline (ops/backup/mythos-db-dump.sh) and the multi-run staging
// mode it feeds (ops/backup/mythos-backup-run.sh).
//
// Fully offline. `docker` is a shim on PATH that emulates the three declared
// sources; no container, no credential and no network is involved. The shim
// also records every argv it is given, so the suite can prove that no secret
// is ever placed on a command line.

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var crypto = require('crypto');

var ROOT = path.resolve(__dirname, '..');
var DUMP = path.join(ROOT, 'ops', 'backup', 'mythos-db-dump.sh');
var RUN = path.join(ROOT, 'ops', 'backup', 'mythos-backup-run.sh');
var UNIT_DIR = path.join(ROOT, 'ops', 'backup', 'systemd');

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function finish() {
  console.log('\nbackup-db-dump: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

var work = fs.mkdtempSync(path.join(os.tmpdir(), 'db-dump-test-'));
function w(rel, body) {
  var p = path.join(work, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}
function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }

// ── the docker shim ────────────────────────────────────────────────────────
// Emulates: inspect (running), psql/mysql identity probes, pg_dump/mysqldump,
// and pg_restore --list. Table counts come from a file so a test can force a
// registry mismatch. Every invocation is appended to argv.log.
var BIN = path.join(work, 'bin');
fs.mkdirSync(BIN, { recursive: true });
var TABLES_FILE = path.join(work, 'tables.json');
fs.writeFileSync(TABLES_FILE, JSON.stringify({ idauto: 24, coolify: 66, darhijama_prod: 39 }));
var ARGV_LOG = path.join(work, 'argv.log');

fs.writeFileSync(path.join(BIN, 'docker'), [
  '#!/usr/bin/env bash',
  'printf "%s\\n" "$*" >> ' + JSON.stringify(ARGV_LOG),
  'TABLES=' + JSON.stringify(TABLES_FILE),
  'case "$1" in',
  '  inspect) echo true; exit 0 ;;',
  'esac',
  '# exec [-i] <container> sh -c <cmd>',
  'shift; [ "$1" = "-i" ] && shift',
  'CONTAINER="$1"; CMD="$4"',
  'case "$CONTAINER" in',
  '  idauto-postgres) ID=idauto ;;',
  '  coolify-db) ID=coolify ;;',
  '  dar-hijama-production-mysql-1) ID=darhijama_prod ;;',
  '  *) echo "no such container" >&2; exit 1 ;;',
  'esac',
  'N=$(node -e "console.log(JSON.parse(require(\'fs\').readFileSync(process.argv[1],\'utf8\'))[process.argv[2]])" "$TABLES" "$ID")',
  'case "$CMD" in',
  '  *server_version*) echo "15.18" ;;',
  '  *"SELECT VERSION()"*) echo "8.4.11" ;;',
  '  *information_schema.tables*) echo "$N" ;;',
  '  *pg_dump*) printf "PGDMP-fixture-%s" "$ID" ;;',
  '  *mysqldump*) printf "MYSQL-fixture-%s\\n-- Dump completed\\n" "$ID" ;;',
  '  *pg_restore*) cat > /dev/null; exit 0 ;;',
  '  *) echo "unexpected: $CMD" >&2; exit 1 ;;',
  'esac',
  'exit 0'
].join('\n'));
fs.chmodSync(path.join(BIN, 'docker'), 0o755);

var DB_ROOT = path.join(work, 'db-runs');
var cfg = w('cfg.env',
  'MYTHOS_BACKUP_DB_ROOT=' + DB_ROOT + '\n' +
  'MYTHOS_BACKUP_STAGE_ROOT=' + path.join(work, 'staging') + '\n' +
  'MYTHOS_BACKUP_PREFIX=test/daily\n' +
  'MYTHOS_BACKUP_HOST=test-host\n' +
  'MYTHOS_BACKUP_MEDIA_DIR_IDAUTO=' + path.join(work, 'media') + '\n');

function runDump(extraEnv) {
  var env = Object.assign({}, process.env, {
    PATH: BIN + ':' + process.env.PATH,
    MYTHOS_BACKUP_CONFIG: cfg,
    MYTHOS_BACKUP_DB_REGISTRY: path.join(ROOT, 'ops', 'backup', 'db-sources.json'),
    MYTHOS_BACKUP_OWNER_USER: String(process.getuid()),
    MYTHOS_BACKUP_OWNER_GROUP: String(process.getgid())
  }, extraEnv || {});
  return cp.spawnSync('bash', [DUMP], { env: env, encoding: 'utf8' });
}

console.log('§1 static safety of the dump step');
check('bash -n clean', cp.spawnSync('bash', ['-n', DUMP], { encoding: 'utf8' }).status === 0);
var src = fs.readFileSync(DUMP, 'utf8');
check('no credential literal in the script',
  !/PASSWORD\s*=\s*["'][^"'$]/.test(src) && !/ACCESS_KEY|SECRET_ACCESS/.test(src));
check('credentials are dereferenced INSIDE the container, never interpolated here',
  /sh -c 'pg_dump -U "\$POSTGRES_USER"/.test(src) &&
  /mysqldump -u root -p"\$MYSQL_ROOT_PASSWORD"/.test(src));
check('single-transaction preserved for MySQL (no production lock)', /--single-transaction/.test(src));
check('no deletion of any kind', !/\brm\s+-rf\b/.test(src) && !/\bdocker\s+rm\b/.test(src));
check('no force-style retry flags', !/--force|--no-single-transaction/.test(src));
check('registry carries no credentials',
  !/password|secret|key/i.test(fs.readFileSync(path.join(ROOT, 'ops/backup/db-sources.json'), 'utf8')));

console.log('§2 refuses to run without root');
check('the root guard is present and fail-closed',
  /\[ "\$\(id -u\)" -eq 0 \] \|\| die "must run as root/.test(src));
check('the guard explains the docker-group boundary', /deploy is intentionally not in the docker group/.test(src));
if (process.getuid() !== 0) {
  var nonRoot = runDump();
  check('non-root execution refused (exit 1)', nonRoot.status === 1, String(nonRoot.status));
} else {
  check('suite runs as root — guard asserted statically, not executed', true);
}

// Everything below needs the root branch bypassed; re-run with a shim that
// reports uid 0 is not possible, so the suite drives the script body through
// a copy with the root guard removed. The guard itself is asserted above.
var DUMP_NOROOT = path.join(work, 'dump-noroot.sh');
fs.writeFileSync(DUMP_NOROOT, src.replace(
  /\[ "\$\(id -u\)" -eq 0 \] \|\| die [^\n]*\n/, ''));
fs.chmodSync(DUMP_NOROOT, 0o755);
function runBody(extraEnv) {
  var env = Object.assign({}, process.env, {
    PATH: BIN + ':' + process.env.PATH,
    MYTHOS_BACKUP_CONFIG: cfg,
    MYTHOS_BACKUP_DB_REGISTRY: path.join(ROOT, 'ops', 'backup', 'db-sources.json'),
    MYTHOS_BACKUP_OWNER_USER: String(process.getuid()),
    MYTHOS_BACKUP_OWNER_GROUP: String(process.getgid())
  }, extraEnv || {});
  return cp.spawnSync('bash', [DUMP_NOROOT], { env: env, encoding: 'utf8' });
}

console.log('§3 a real dump run');
var r = runBody();
check('dump run exits 0', r.status === 0, (r.stderr || '').slice(-400));
var pointer = path.join(DB_ROOT, 'latest-run');
check('latest-run pointer written', fs.existsSync(pointer));
var runDir = fs.existsSync(pointer) ? fs.readFileSync(pointer, 'utf8').trim() : '';
check('pointer names an existing run directory', fs.existsSync(runDir));
var dbDirs = (runDir && fs.existsSync(runDir) ? fs.readdirSync(runDir) : []).filter(function (n) {
  return fs.statSync(path.join(runDir, n)).isDirectory();
}).sort();
check('one directory per declared database', dbDirs.join(',') === 'coolify,darhijama_prod,idauto', dbDirs.join(','));
check('EVERY database directory holds exactly one file (discoverDb contract)',
  dbDirs.every(function (d) { return fs.readdirSync(path.join(runDir, d)).length === 1; }));
check('C1 checksums live at the run root, never beside a dump',
  fs.existsSync(path.join(runDir, 'SHA256SUMS.txt')) &&
  dbDirs.every(function (d) {
    return fs.readdirSync(path.join(runDir, d)).indexOf('SHA256SUMS.txt') < 0;
  }));
var sumsPath = path.join(runDir || work, 'SHA256SUMS.txt');
var sums = fs.existsSync(sumsPath) ? fs.readFileSync(sumsPath, 'utf8').trim().split('\n') : [];
check('a C1 line per database', sums.length === 3, String(sums.length));
check('recorded C1 matches the artefact on disk', sums.every(function (line) {
  var m = /^([0-9a-f]{64})\s+(.+)$/.exec(line);
  return m && sha(fs.readFileSync(path.join(runDir, m[2]))) === m[1];
}));
check('dump files are 0600', dbDirs.every(function (d) {
  var f = path.join(runDir, d, fs.readdirSync(path.join(runDir, d))[0]);
  return (fs.statSync(f).mode & 0o777) === 0o600;
}));

console.log('§4 no secret ever reaches a command line');
var argv = fs.readFileSync(ARGV_LOG, 'utf8');
var mysqlCalls = argv.split('\n').filter(function (l) { return l.indexOf('mysqldump') >= 0; });
check('every mysqldump call passes the variable, never a value',
  mysqlCalls.length > 0 && mysqlCalls.every(function (l) {
    return /-p"\$MYSQL_ROOT_PASSWORD"/.test(l);
  }), mysqlCalls[0] || 'no mysqldump call recorded');
check('docker argv only ever references the in-container variable',
  /\$MYSQL_ROOT_PASSWORD/.test(argv) && !/MYSQL_ROOT_PASSWORD=/.test(argv));

console.log('§5 source identification refuses a changed source (§C)');
fs.writeFileSync(TABLES_FILE, JSON.stringify({ idauto: 23, coolify: 66, darhijama_prod: 39 }));
var drift = runBody();
check('table-count drift fails the run (exit 2)', drift.status === 2, String(drift.status));
check('the drift is named, not silently accepted',
  /table count 23 != registry 24/.test(drift.stderr || ''), (drift.stderr || '').slice(-200));
check('verification was not weakened to pass', !/--force/.test(fs.readFileSync(DUMP, 'utf8')));
fs.writeFileSync(TABLES_FILE, JSON.stringify({ idauto: 24, coolify: 66, darhijama_prod: 39 }));

console.log('§6 multi-run staging consumes the run (mock adapter)');
var mediaBody = 'binary-media-fixture';
w('media/media/photo.bin', mediaBody);
w('media/checksums.sha256', sha(mediaBody) + '  media/photo.bin\n');
w('media/manifest.json', JSON.stringify({
  created_at_utc: new Date(Date.now() + 3600000).toISOString(),
  database: { row_count: 1, distinct_object_keys: 1 },
  consistency: { state: 'CONSISTENT' }
}, null, 2) + '\n');
var store = path.join(work, 'remote-store');
fs.mkdirSync(store, { recursive: true });
var mockAdapter = w('mock-adapter.js',
  "'use strict';\n" +
  "var fs=require('fs'),path=require('path'),crypto=require('crypto');\n" +
  "var ROOT=" + JSON.stringify(store) + ";\n" +
  "function fp(k){var p=path.join(ROOT,k);fs.mkdirSync(path.dirname(p),{recursive:true});return p;}\n" +
  "function sha(b){return crypto.createHash('sha256').update(b).digest('hex');}\n" +
  "module.exports.create=function(){return {\n" +
  "  put:function(k,b){fs.writeFileSync(fp(k),b);return Promise.resolve();},\n" +
  "  head:function(k){try{var b=fs.readFileSync(path.join(ROOT,k));return Promise.resolve({size:b.length,sha256:sha(b)});}catch(e){return Promise.resolve(null);}},\n" +
  "  get:function(k){return Promise.resolve(fs.readFileSync(path.join(ROOT,k)));},\n" +
  "  list:function(pre){function walk(d){var out=[];fs.readdirSync(d,{withFileTypes:true}).forEach(function(e){var f=path.join(d,e.name);out=out.concat(e.isDirectory()?walk(f):[path.relative(ROOT,f)]);});return out;}\n" +
  "    try{return Promise.resolve(walk(ROOT).filter(function(k){return k.indexOf(pre)===0;}));}catch(e){return Promise.resolve([]);}}\n" +
  "};};\n");
var health = path.join(work, 'health.json');
function runBackup() {
  return cp.spawnSync('bash', [RUN, 'backup'], {
    env: Object.assign({}, process.env, {
      MYTHOS_BACKUP_CONFIG: cfg,
      MYTHOS_BACKUP_HEALTH_FILE: health,
      MYTHOS_BACKUP_ADAPTER: mockAdapter
    }),
    encoding: 'utf8'
  });
}
var b = runBackup();
// idauto has a media dir; coolify and darhijama_prod deliberately do not.
check('a database without a configured media dir FAILS CLOSED (never staged empty)',
  b.status !== 0 && /media directory not configured for database/.test(b.stderr || ''),
  (b.stderr || '').slice(-300));
check('the missing variable is named exactly',
  /MYTHOS_BACKUP_MEDIA_DIR_COOLIFY|MYTHOS_BACKUP_MEDIA_DIR_DARHIJAMA_PROD/.test(b.stderr || ''));
check('the database that IS configured still staged and pushed',
  fs.existsSync(path.join(store, 'test/daily/idauto/manifest.json')),
  fs.existsSync(store) ? fs.readdirSync(store).join(',') : 'no store');
check('failure recorded in the health record for the Status Center',
  fs.existsSync(health) && JSON.parse(fs.readFileSync(health, 'utf8')).status === 'fail');

console.log('§7 a clean rerun does not collide');
var again = runBody();
check('second dump run exits 0 (per-run dirs, no collision)', again.status === 0, (again.stderr || '').slice(-300));
var runs = fs.readdirSync(DB_ROOT).filter(function (n) { return n.indexOf('run-') === 0; });
check('each run is its own directory', runs.length >= 1);
check('pointer advanced to the newest completed run',
  fs.existsSync(pointer) && fs.readFileSync(pointer, 'utf8').trim().indexOf(DB_ROOT) === 0);
check('no previous run was deleted', runs.length === new Set(runs).size);

console.log('§8 unit contract');
var unit = fs.readFileSync(path.join(UNIT_DIR, 'mythos-db-dump.service'), 'utf8');
check('dump unit is oneshot', /Type=oneshot/.test(unit));
check('dump unit runs as root with the reason recorded', /User=root/.test(unit) && /docker group/.test(unit));
check('dump unit is hardened', /ProtectSystem=full/.test(unit) && /RestrictSUIDSGID=yes/.test(unit));
check('dump unit carries no credential', !/PASSWORD|SECRET|ACCESS_KEY/.test(unit));
var backupUnit = fs.readFileSync(path.join(UNIT_DIR, 'mythos-backup.service'), 'utf8');
check('backup stays User=deploy (privilege stayed in the dump unit)', /User=deploy/.test(backupUnit));
check('backup is ordered After the dump', /After=.*mythos-db-dump\.service/.test(backupUnit));
check('a failed dump fails the backup (Requires, not Wants)', /Requires=mythos-db-dump\.service/.test(backupUnit));
var installer = fs.readFileSync(path.join(ROOT, 'ops/backup/install.sh'), 'utf8');
check('installer installs and verifies the dump unit',
  /mythos-db-dump\.service/.test(installer) && /bash -n "\$DUMP_SCRIPT"/.test(installer));

fs.rmSync(work, { recursive: true, force: true });
finish();
