'use strict';

// tests/monitor-coverage-test.js — guards the Status Center's coverage
// contract rather than its mechanics (stc-2 covers the mechanics).
//
// The rule this file exists to enforce: a production surface may be
// unmonitored, but never SILENTLY unmonitored. Every probe that is switched
// off must carry a note that says why, and the systems the platform depends
// on must be switched on. A registry that quietly drops a service is the
// same failure as a dashboard that paints it green.
//
// Fully offline: reads the registry, opens no socket.

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var REG = path.join(ROOT, 'projects', 'status-center', 'monitor', 'probes.json');
var registry = JSON.parse(fs.readFileSync(REG, 'utf8'));
var probes = registry.probes;

var passed = 0;
var failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function byId(id) { return probes.filter(function (p) { return p.id === id; })[0]; }

// ---------------------------------------------------------------------------
console.log('§1 registry shape');

check('registry declares a config_version', typeof registry.config_version === 'string');
check('every probe has id, name and type',
  probes.every(function (p) { return p.id && p.name && p.type; }));
check('probe ids are unique',
  new Set(probes.map(function (p) { return p.id; })).size === probes.length);
check('every probe declares enabled explicitly',
  probes.every(function (p) { return typeof p.enabled === 'boolean'; }),
  probes.filter(function (p) { return typeof p.enabled !== 'boolean'; }).map(function (p) { return p.id; }).join(','));

// ---------------------------------------------------------------------------
console.log('§2 nothing is unmonitored by accident');

var silent = probes.filter(function (p) {
  return !p.enabled && (!p.note || p.note.trim().length < 40);
});
check('every disabled probe explains itself in a note', silent.length === 0,
  silent.map(function (p) { return p.id; }).join(','));

var vague = probes.filter(function (p) {
  return !p.enabled && !/RETIRED|OPERATOR|blocked|absent|not exist/i.test(p.note || '');
});
check('a disabled probe states a disposition (retired / blocked / operator action)',
  vague.length === 0, vague.map(function (p) { return p.id; }).join(','));

// ---------------------------------------------------------------------------
console.log('§3 the platform\'s own dependencies are monitored');

// These are the surfaces the platform cannot be declared healthy without.
// Adding to this list is how a future service becomes closure-relevant.
var REQUIRED = [
  'hub-apex',              // the entry point itself
  'hub-dashboard-health',  // its deploy stamp
  'hub-status-endpoint',   // the feed the dashboard reads
  'os-console',
  'ordre',
  'status-center',
  'vps-resources',
  'backup-system',
  'database'               // the store the backup chain depends on
];
REQUIRED.forEach(function (id) {
  var p = byId(id);
  check('required surface monitored: ' + id, !!p && p.enabled === true,
    p ? 'present but disabled' : 'missing from the registry');
});

// ---------------------------------------------------------------------------
console.log('§4 database probe is safe by construction');

var db = byId('database');
check('database probe exists', !!db);
check('database probe is a plain TCP connect', !!db && db.type === 'tcp');
check('database probe targets loopback only', !!db && db.host === '127.0.0.1',
  db ? String(db.host) : '');
check('database probe targets the postgres port', !!db && db.port === 5432);
check('database probe carries no credential field',
  !!db && !Object.keys(db).some(function (k) { return /user|pass|secret|token|dsn|conn/i.test(k); }),
  db ? Object.keys(db).join(',') : '');
check('database probe issues no query',
  !!db && !('query' in db) && !('sql' in db));
check('database note records why enabling is safe',
  !!db && /no startup packet|reads no business data|TCP connect only/i.test(db.note || ''));

// ---------------------------------------------------------------------------
console.log('§5 SYA API retirement is documented, not assumed');

var sya = byId('sya-api');
check('sya-api probe is retained for the record', !!sya);
check('sya-api is disabled', !!sya && sya.enabled === false);
check('sya-api is documented as RETIRED', !!sya && /RETIRED/.test(sya.note || ''));
check('retirement cites on-host evidence',
  !!sya && /byte-identical|no \/api proxy_pass|try_files/i.test(sya.note || ''));
check('the SPA-fallback guard is retained for any future restore',
  !!sya && sya.expect_content_type === 'application/json');

// ---------------------------------------------------------------------------
console.log('§6 no probe can leak a secret');

check('no probe embeds a credential-shaped field',
  !probes.some(function (p) {
    return Object.keys(p).some(function (k) { return /password|secret|token|api_key/i.test(k); });
  }));
check('no probe URL carries userinfo or a query secret',
  !probes.some(function (p) { return /:\/\/[^/@]*@|[?&](token|key|secret)=/i.test(p.url || ''); }));

console.log('\nmonitor-coverage: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
