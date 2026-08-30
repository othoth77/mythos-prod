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
function run(args, env) {
  return cp.spawnSync('bash', [SCRIPT].concat(args), {
    env: Object.assign({}, process.env, env || {}),
    encoding: 'utf8',
    timeout: 120000
  });
}

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

console.log('§5 fail-closed on missing config, same discipline as the idauto wrapper');
var noCfg = run(['backup'], { MYTHOS_BACKUP_DB_CONFIG: path.join(work, 'does-not-exist.env') });
check('missing config: exit 1', noCfg.status === 1);
check('missing config: stderr names the problem', /config not found/.test(noCfg.stderr || ''));

fs.rmSync(work, { recursive: true, force: true });

console.log('\nbackup-run-db: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
