'use strict';

// tests/backup-scheduler-test.js — validates ops/backup/ (post-audit Phase 1):
// the scheduled wrapper around the pre-existing off-host backup tooling, its
// fail-closed behavior, the health record contract consumed by the Status
// Center monitor, the systemd unit contract, and the absence of secrets or
// destructive flags. Fully offline; uses a temp workspace and a mock adapter.

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var OPS = path.join(ROOT, 'ops', 'backup');
var SCRIPT = path.join(OPS, 'mythos-backup-run.sh');
var INSTALL = path.join(OPS, 'install.sh');
var UNIT_DIR = path.join(OPS, 'systemd');

var passed = 0;
var failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

var work = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-backup-test-'));
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

console.log('§1 script syntax and static safety');
check('entry script exists', fs.existsSync(SCRIPT));
check('installer exists', fs.existsSync(INSTALL));
['mythos-backup-run.sh', 'install.sh'].forEach(function (f) {
  var r = cp.spawnSync('bash', ['-n', path.join(OPS, f)], { encoding: 'utf8' });
  check('bash -n clean: ' + f, r.status === 0, r.stderr);
});
var scriptSrc = fs.readFileSync(SCRIPT, 'utf8');
check('wrapper delegates to the existing tool (no parallel mechanism)',
  scriptSrc.indexOf('projects/infrastructure/ops/offhost-backup.js') >= 0);
check('wrapper never passes --destructive', scriptSrc.indexOf('--destructive') < 0);
check('no credential value patterns in scripts',
  !/AKIA[0-9A-Z]{16}|SECRET_ACCESS_KEY\s*=/.test(scriptSrc + fs.readFileSync(INSTALL, 'utf8')));

console.log('§2 usage + fail-closed config gate');
var badMode = run(['nonsense'], {});
check('unknown mode refused (exit 1)', badMode.status === 1);
var health1 = path.join(work, 'health', 'backup-health.json');
var noCfg = run(['backup'], {
  MYTHOS_BACKUP_CONFIG: path.join(work, 'missing.env'),
  MYTHOS_BACKUP_HEALTH_FILE: health1
});
check('missing config fails closed (exit 1)', noCfg.status === 1, String(noCfg.status));
check('failure still writes a health record', fs.existsSync(health1));
var h1 = readHealth(health1);
check('health status=fail', h1.status === 'fail');
check('health schema fields present',
  ['schema_version', 'mode', 'exit_code', 'started_at', 'finished_at',
   'duration_s', 'last_success_at', 'consecutive_failures', 'error']
    .every(function (k) { return k in h1; }));
check('consecutive_failures counts 1', h1.consecutive_failures === 1);
var noCfg2 = run(['backup'], {
  MYTHOS_BACKUP_CONFIG: path.join(work, 'missing.env'),
  MYTHOS_BACKUP_HEALTH_FILE: health1
});
check('second failure increments counter', noCfg2.status === 1 && readHealth(health1).consecutive_failures === 2);

console.log('§3 incomplete config refused');
var cfgIncomplete = w('cfg-incomplete.env', 'MYTHOS_BACKUP_DB_DIR=' + path.join(work, 'db') + '\n');
var inc = run(['backup'], { MYTHOS_BACKUP_CONFIG: cfgIncomplete, MYTHOS_BACKUP_HEALTH_FILE: health1 });
check('missing required variable refused (exit 1)', inc.status === 1);
check('error names the missing variable', /MYTHOS_BACKUP_/.test(readHealth(health1).error));

console.log('§4 full pipeline via the wrapped tool (mock adapter)');
w('db/dump.sql', 'select 1;\n');
// Media dir follows the IDAUTO-STORAGE-OPS backup format the tool consumes:
// manifest.json + checksums.sha256 + media/<objects>.
var crypto = require('crypto');
var mediaBody = 'binary-media-fixture';
var mediaSha = crypto.createHash('sha256').update(mediaBody).digest('hex');
w('media/media/photo.bin', mediaBody);
w('media/checksums.sha256', mediaSha + '  media/photo.bin\n');
w('media/manifest.json', JSON.stringify({
  created_at_utc: new Date(Date.now() + 60000).toISOString(),
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
var cfg = w('cfg.env',
  'MYTHOS_BACKUP_DB_DIR=' + path.join(work, 'db') + '\n' +
  'MYTHOS_BACKUP_MEDIA_DIR=' + path.join(work, 'media') + '\n' +
  'MYTHOS_BACKUP_STAGE_ROOT=' + path.join(work, 'staging') + '\n' +
  'MYTHOS_BACKUP_PREFIX=test/daily\n' +
  'MYTHOS_BACKUP_HOST=test-host\n');
var env = {
  MYTHOS_BACKUP_CONFIG: cfg,
  MYTHOS_BACKUP_HEALTH_FILE: health1,
  MYTHOS_BACKUP_ADAPTER: mockAdapter
};
var full = run(['backup'], env);
check('backup mode exits 0', full.status === 0, (full.stderr || '').slice(-300));
check('remote store holds manifest + COMPLETE',
  fs.existsSync(path.join(store, 'test/daily/manifest.json')) &&
  fs.existsSync(path.join(store, 'test/daily/COMPLETE')));
var h2 = readHealth(health1);
check('health status=ok after success', h2.status === 'ok');
check('success resets consecutive_failures', h2.consecutive_failures === 0);
check('last_success_at recorded', /^\d{4}-\d{2}-\d{2}T/.test(h2.last_success_at));
check('backup_prefix recorded', h2.backup_prefix === 'test/daily');

var ver = run(['verify'], env);
check('verify mode (read-only) exits 0', ver.status === 0, (ver.stderr || '').slice(-300));
check('verify updates health mode', readHealth(health1).mode === 'verify');

var rt = run(['restore-test'], env);
check('restore-test exits 0', rt.status === 0, (rt.stderr || '').slice(-300));
var restored = fs.readdirSync(path.join(work, 'staging')).filter(function (d) {
  return d.indexOf('restore-test-') === 0;
});
check('restore-test used an isolated throwaway destination', restored.length >= 1);
check('live media fixture untouched by restore-test',
  fs.readFileSync(path.join(work, 'media/media/photo.bin'), 'utf8') === 'binary-media-fixture');

console.log('§5 corruption is detected (verification really verifies)');
fs.writeFileSync(path.join(store, 'test/daily/media-backup/media/photo.bin'), 'tampered');
var bad = run(['verify'], env);
check('tampered remote object fails verify (exit 2)', bad.status === 2, String(bad.status));
check('health records the failure', readHealth(health1).status === 'fail');

console.log('§6 systemd unit contract');
var units = ['mythos-backup.service', 'mythos-backup.timer',
  'mythos-backup-verify.service', 'mythos-backup-verify.timer',
  'mythos-restore-test.service', 'mythos-restore-test.timer'];
units.forEach(function (u) {
  check('unit exists: ' + u, fs.existsSync(path.join(UNIT_DIR, u)));
});
var modeByUnit = {
  'mythos-backup.service': 'backup',
  'mythos-backup-verify.service': 'verify',
  'mythos-restore-test.service': 'restore-test'
};
Object.keys(modeByUnit).forEach(function (u) {
  var s = fs.readFileSync(path.join(UNIT_DIR, u), 'utf8');
  check(u + ' runs as deploy oneshot', /User=deploy/.test(s) && /Type=oneshot/.test(s));
  check(u + ' calls the wrapper with mode ' + modeByUnit[u],
    s.indexOf('ops/backup/mythos-backup-run.sh ' + modeByUnit[u]) >= 0);
  check(u + ' hardened (NoNewPrivileges)', /NoNewPrivileges=yes/.test(s));
});
units.filter(function (u) { return /\.timer$/.test(u); }).forEach(function (u) {
  var s = fs.readFileSync(path.join(UNIT_DIR, u), 'utf8');
  check(u + ' has OnCalendar + Persistent', /OnCalendar=/.test(s) && /Persistent=true/.test(s));
});
var allUnitText = units.map(function (u) {
  return fs.readFileSync(path.join(UNIT_DIR, u), 'utf8');
}).join('\n');
check('no unit carries credentials', !/KEY|SECRET|TOKEN|PASSWORD/i.test(allUnitText.replace(/NoNewPrivileges/g, '')));

fs.rmSync(work, { recursive: true, force: true });
console.log('\nbackup-scheduler: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
