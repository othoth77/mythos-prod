'use strict';

// tests/backup-run-db-test.js — proves ops/backup/mythos-backup-run-db.sh
// runs a complete backup/verify/restore-test cycle for a DATABASE-ONLY
// pipeline (e.g. mythos_erp) with no media directory anywhere in its
// environment, and that this is a genuinely separate file from
// ops/backup/mythos-backup-run.sh — the existing wrapper's own behavior,
// tests, and required variables are untouched by this file's existence.
//
// Same offline pattern as tests/backup-scheduler-test.js: a temp workspace,
// a mock in-process adapter standing in for R2, and real execution of the
// real script as a subprocess — not a reimplementation of its logic.

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var OPS = path.join(ROOT, 'ops', 'backup');
var SCRIPT = path.join(OPS, 'mythos-backup-run-db.sh');
var EXISTING_SCRIPT = path.join(OPS, 'mythos-backup-run.sh');

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

var scriptSrc = fs.readFileSync(SCRIPT, 'utf8');
var existingSrc = fs.readFileSync(EXISTING_SCRIPT, 'utf8');
// Code with full-line `#` comments stripped — this script's own header
// explains in prose what it deliberately does not do (naming --media and
// MYTHOS_BACKUP_MEDIA_DIR in that explanation), which would otherwise
// false-positive a plain substring check against the executable code.
function stripComments(src) {
  return src.split('\n').filter(function (l) { return !/^\s*#/.test(l); }).join('\n');
}
var scriptCode = stripComments(scriptSrc);
var existingCode = stripComments(existingSrc);

console.log('§1 script syntax and separation from the existing wrapper');
var syn = cp.spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
check('bash -n clean', syn.status === 0, syn.stderr);
check('is executable', (fs.statSync(SCRIPT).mode & 0o111) !== 0);
check('the existing idauto wrapper was not modified to add this behavior',
  !/mythos-backup-run-db|backup-schedule-db\.env/.test(existingCode));
check('this script\'s code does not source or exec the existing wrapper',
  !/mythos-backup-run\.sh/.test(scriptCode));

console.log('§2 the defining property: no media requirement anywhere');
check('never passes --media to stage', !/--media/.test(scriptCode));
check('MYTHOS_BACKUP_MEDIA_DIR is not in the required-variable loop',
  !/for v in [^\n]*MYTHOS_BACKUP_MEDIA_DIR/.test(scriptCode));
check('MYTHOS_BACKUP_MEDIA_DIR does not appear in the executable code at all',
  !/MYTHOS_BACKUP_MEDIA_DIR/.test(scriptCode));
check('required variables are exactly DB_DIR, STAGE_ROOT, PREFIX',
  /for v in MYTHOS_BACKUP_DB_DIR MYTHOS_BACKUP_STAGE_ROOT MYTHOS_BACKUP_PREFIX; do/.test(scriptSrc));
check('uses its own config default path, distinct from the idauto wrapper',
  /MYTHOS_BACKUP_DB_CONFIG/.test(scriptSrc) && /backup-schedule-db\.env/.test(scriptSrc));
check('writes its own health file, distinct from the idauto wrapper\'s',
  /backup-health-db\.json/.test(scriptSrc));

console.log('§3 no destructive flag, no credential value');
check('no destructive flag is ever passed', !/--destructive/.test(scriptSrc));
check('no credential value pattern is embedded',
  !/AKIA[0-9A-Z]{16}/.test(scriptSrc) && !/SECRET_ACCESS_KEY\s*=\s*\S/.test(scriptSrc));
check('the adapter reads its own config; this script never touches one',
  !/idauto-offhost\.env/.test(scriptSrc));

console.log('§4 real end-to-end execution: backup -> verify -> restore-test, zero media anywhere');

var work = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-backup-db-run-test-'));
function w(rel, content) {
  var p = path.join(work, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}
function readHealth(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
// Every invocation of the wrapper is pinned to this workspace HERE, in the
// helper, not at the call sites.
//
// 2026-09-14: the fail-closed "missing config" check called the wrapper with
// no MYTHOS_BACKUP_HEALTH_FILE. The script's default is
// "$HOME/mythos-backups/health/backup-health-db.json", which for a suite run as deploy on the
// VPS is the LIVE record — four runs wrote status:fail and
// consecutive_failures:4 into production while real backups were healthy.
// A call site that forgets the override is the failure mode, so the override
// is applied where it cannot be forgotten. §0 asserts this holds.
var HEALTH_SANDBOX = path.join(work, 'health');
function pinEnv(env) {
  var merged = Object.assign({}, process.env, env || {});
  var h = merged.MYTHOS_BACKUP_HEALTH_FILE;
  if (typeof h !== 'string' || h.indexOf(work + path.sep) !== 0) {
    merged.MYTHOS_BACKUP_HEALTH_FILE = path.join(HEALTH_SANDBOX, 'unpinned-call-site.json');
  }
  // HOME is redirected too: it is the root of every other production default
  // in these scripts (the config path, the local backup tree).
  merged.HOME = path.join(work, 'home');
  return merged;
}
function run(args, env) {
  return cp.spawnSync('bash', [SCRIPT].concat(args), {
    env: pinEnv(env),
    encoding: 'utf8',
    timeout: 120000
  });
}

console.log('\u00a70 REGRESSION (2026-09-14): no invocation can reach a production health record');
fs.mkdirSync(HEALTH_SANDBOX, { recursive: true });
fs.mkdirSync(path.join(work, 'home'), { recursive: true });
(function () {
  var PRODUCTION_HEALTH = path.join(os.homedir(), 'mythos-backups', 'health', 'backup-health-db.json');
  var before = null;
  try { before = fs.statSync(PRODUCTION_HEALTH).mtimeMs + ':' + fs.statSync(PRODUCTION_HEALTH).size; } catch (e) { before = 'absent'; }

  // The exact shape of the 2026-09-14 incident: a fail-closed run with no
  // health override at all.
  var incident = run(['backup'], { MYTHOS_BACKUP_DB_CONFIG: path.join(work, 'does-not-exist.env') });
  check('the incident invocation still fails closed', incident.status === 1);
  var after = null;
  try { after = fs.statSync(PRODUCTION_HEALTH).mtimeMs + ':' + fs.statSync(PRODUCTION_HEALTH).size; } catch (e) { after = 'absent'; }
  check('REGRESSION: an unpinned call site does not touch the production health record',
    after === before, 'production record changed: ' + before + ' -> ' + after);
  check('REGRESSION: the unpinned call was redirected into the workspace',
    fs.existsSync(path.join(HEALTH_SANDBOX, 'unpinned-call-site.json')) || after === before);

  // And the pinning helper itself, directly.
  check('pinEnv redirects a missing health override into the workspace',
    pinEnv({}).MYTHOS_BACKUP_HEALTH_FILE.indexOf(work + path.sep) === 0);
  check('pinEnv redirects an override pointing outside the workspace',
    pinEnv({ MYTHOS_BACKUP_HEALTH_FILE: PRODUCTION_HEALTH }).MYTHOS_BACKUP_HEALTH_FILE.indexOf(work + path.sep) === 0);
  check('pinEnv keeps an override already inside the workspace',
    pinEnv({ MYTHOS_BACKUP_HEALTH_FILE: path.join(work, 'health', 'x.json') }).MYTHOS_BACKUP_HEALTH_FILE === path.join(work, 'health', 'x.json'));
  check('pinEnv redirects HOME, the root of the other production defaults',
    pinEnv({}).HOME.indexOf(work + path.sep) === 0);
})();


// The database dump input — this is ALL that exists in this workspace.
// There is deliberately no media/, no checksums.sha256, no media manifest
// anywhere under `work` at all: proving media absence is not merely
// unconfigured but structurally impossible to reach.
w('db/mythos_erp-20260830T020000Z.dump', 'database contents for the db-only wrapper test');

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

var cfg = w('cfg-db.env',
  'MYTHOS_BACKUP_DB_DIR=' + path.join(work, 'db') + '\n' +
  'MYTHOS_BACKUP_STAGE_ROOT=' + path.join(work, 'staging') + '\n' +
  'MYTHOS_BACKUP_PREFIX=test-erp/daily\n' +
  'MYTHOS_BACKUP_HOST=test-host\n');
var health1 = path.join(work, 'health', 'backup-health-db.json');
var env = {
  MYTHOS_BACKUP_DB_CONFIG: cfg,
  MYTHOS_BACKUP_HEALTH_FILE: health1,
  MYTHOS_BACKUP_ADAPTER: mockAdapter
};

var full = run(['backup'], env);
check('backup mode exits 0 with no media anywhere in the environment', full.status === 0, (full.stderr || '').slice(-400));
check('remote store holds manifest + COMPLETE',
  fs.existsSync(path.join(store, 'test-erp/daily/manifest.json')) &&
  fs.existsSync(path.join(store, 'test-erp/daily/COMPLETE')));
check('remote store holds NO media-backup/ prefix at all',
  !fs.existsSync(path.join(store, 'test-erp/daily/media-backup')));
var manifestPushed = JSON.parse(fs.readFileSync(path.join(store, 'test-erp/daily/manifest.json'), 'utf8'));
check('pushed manifest carries no media key', !('media' in manifestPushed));
check('pushed manifest objects array holds exactly the database entry',
  manifestPushed.objects.length === 1 && manifestPushed.objects[0].path.indexOf('database/') === 0);

var h2 = readHealth(health1);
check('health status=ok after success', h2.status === 'ok');
check('health source identifies this wrapper specifically', h2.source === 'ops/backup/mythos-backup-run-db.sh');
check('backup_prefix recorded', h2.backup_prefix === 'test-erp/daily');

var ver = run(['verify'], env);
check('verify mode (read-only) exits 0', ver.status === 0, (ver.stderr || '').slice(-300));

var rt = run(['restore-test'], env);
check('restore-test exits 0', rt.status === 0, (rt.stderr || '').slice(-300));
var restored = fs.readdirSync(path.join(work, 'staging')).filter(function (d) {
  return d.indexOf('restore-test-') === 0;
});
check('restore-test used an isolated throwaway destination', restored.length >= 1);
var restoredDump = fs.readdirSync(path.join(work, 'staging', restored[0], 'database'));
check('restore-test reconstructed exactly the one database dump, nothing else',
  restoredDump.length === 1 && restoredDump[0] === 'mythos_erp-20260830T020000Z.dump');

console.log('§4b freshness: verify / restore-test never make a failed or stale backup look fresh (2026-09-14 regression)');
// Same defect and same contract as the idauto wrapper (tests/backup-scheduler-test.js §4b):
// only a successful backup run is backup success.
var pending = [];
var monitor = require(path.join(ROOT, 'projects', 'status-center', 'monitor', 'bin', 'monitor.js'));
function probe(name, expect) {
  pending.push(monitor.probeBackupHealth({ file: health1, fresh_hours: 26, degraded_hours: 50 }).then(function (r) {
    check(name, expect(r.state), JSON.stringify(r));
  }));
}
function ageHealth(hoursAgo) {
  var h = readHealth(health1);
  h.last_success_at = new Date(Date.now() - hoursAgo * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  fs.writeFileSync(health1, JSON.stringify(h, null, 2) + '\n');
  return h.last_success_at;
}
var afterGood = readHealth(health1);
check('per-mode outcomes recorded after backup, verify and restore-test',
  afterGood.last_backup_status === 'ok' && afterGood.last_verify_status === 'ok' && afterGood.last_restore_test_status === 'ok');
check('clean verify/restore-test after a good backup stay ok with a zero counter',
  afterGood.status === 'ok' && afterGood.consecutive_failures === 0);

var cfgBroken = w('cfg-db-broken.env',
  'MYTHOS_BACKUP_DB_DIR=' + path.join(work, 'no-such-db') + '\n' +
  'MYTHOS_BACKUP_STAGE_ROOT=' + path.join(work, 'staging') + '\n' +
  'MYTHOS_BACKUP_PREFIX=test-erp/daily\n' +
  'MYTHOS_BACKUP_HOST=test-host\n');
var staleAt = ageHealth(60);
var failedBackup = run(['backup'], Object.assign({}, env, { MYTHOS_BACKUP_DB_CONFIG: cfgBroken }));
check('a broken nightly backup fails', failedBackup.status !== 0, String(failedBackup.status));
var hf = readHealth(health1);
check('failed backup: status=fail, last_backup_status=fail, counter=1',
  hf.status === 'fail' && hf.last_backup_status === 'fail' && hf.consecutive_failures === 1, JSON.stringify(hf));
check('failed backup carries last_success_at forward', hf.last_success_at === staleAt);

var verifyAfterFail = run(['verify'], env);
check('verify of the older remote set still passes (integrity only)', verifyAfterFail.status === 0, (verifyAfterFail.stderr || '').slice(-300));
var hv = readHealth(health1);
check('REGRESSION: a clean verify does not advance last_success_at', hv.last_success_at === staleAt, hv.last_success_at + ' != ' + staleAt);
check('REGRESSION: a clean verify does not clear the failed backup status', hv.status === 'fail');
check('REGRESSION: a clean verify does not reset consecutive_failures', hv.consecutive_failures === 1);
check('verify still records its own mode and outcome',
  hv.mode === 'verify' && hv.last_verify_status === 'ok' && hv.last_backup_status === 'fail');
check('the failed backup error is preserved through the clean verify', typeof hv.error === 'string' && hv.error.length > 0);
probe('Status Center monitor reports the stale, failed ERP backup DOWN (never LIVE)', function (s) { return s === 'DOWN'; });

var restoreAfterFail = run(['restore-test'], env);
check('restore-test after the failed backup passes', restoreAfterFail.status === 0, (restoreAfterFail.stderr || '').slice(-300));
var hr = readHealth(health1);
check('REGRESSION: a clean restore-test does not refresh a failed, stale backup either',
  hr.last_success_at === staleAt && hr.status === 'fail' && hr.consecutive_failures === 1 && hr.last_restore_test_status === 'ok');

ageHealth(10);
var verifyInWindow = run(['verify'], env);
check('verify inside the fresh window passes', verifyInWindow.status === 0);
probe('inside the 26 h window a failed backup is still not LIVE after a clean verify', function (s) { return s !== 'LIVE'; });

fs.writeFileSync(health1, JSON.stringify({
  schema_version: '1.0.0', source: 'ops/backup/mythos-backup-run-db.sh', mode: 'backup', status: 'fail', exit_code: 2,
  last_success_at: staleAt, consecutive_failures: 2, error: 'legacy failure'
}, null, 2) + '\n');
check('legacy record: verify passes', run(['verify'], env).status === 0);
var hl = readHealth(health1);
check('legacy failed record stays failed after a clean verify (status, error, counter, last_success_at)',
  hl.status === 'fail' && hl.error === 'legacy failure' && hl.consecutive_failures === 2 && hl.last_success_at === staleAt, JSON.stringify(hl));

var recovered = run(['backup'], env);
check('a good backup after the failure succeeds', recovered.status === 0, (recovered.stderr || '').slice(-300));
var hok = readHealth(health1);
check('recovery: status ok, counter reset, last_success_at advanced, last_backup_status ok',
  hok.status === 'ok' && hok.consecutive_failures === 0 && hok.last_success_at !== staleAt && hok.last_backup_status === 'ok', JSON.stringify(hok));
probe('Status Center monitor reports the recovered ERP backup LIVE', function (s) { return s === 'LIVE'; });

console.log('§5 fail-closed on missing config, same discipline as the idauto wrapper');
var noCfg = run(['backup'], { MYTHOS_BACKUP_DB_CONFIG: path.join(work, 'does-not-exist.env') });
check('missing config: exit 1', noCfg.status === 1);
check('missing config: stderr names the problem', /config not found/.test(noCfg.stderr || ''));

// The monitor probe checks (§4b) resolve asynchronously; count them before
// the summary so a failing one can never be missed.
Promise.all(pending).catch(function (e) {
  check('monitor probe checks completed', false, e && e.message);
}).then(function () {
  fs.rmSync(work, { recursive: true, force: true });
  console.log('\nbackup-run-db: ' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
});
