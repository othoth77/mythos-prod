'use strict';
// =====================================================
// DEVX-1 — ID Auto test-impact mapping regression.
//
// Proves that impact analysis selects the correct ID Auto suites from
// changed files, that the selection is derived from the real require
// graph rather than a wildcard, and that the previous P0 gap (a
// projects/idauto/ rule matching but selecting ZERO tests, silently
// leaving every ID Auto change untested) cannot reappear.
//
// STATIC ONLY. Reads the impact map and the ID Auto sources; never
// connects to a database, never opens a socket, never runs a suite.
// =====================================================

var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;

function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

var MAP = JSON.parse(read('projects/meta/test-impact-map.json'));

// Mirrors matchRule() in scripts/mythos-stage.js exactly: first-match-wins
// over the rules array, prefix compared with indexOf === 0.
function matchRule(f) {
  for (var i = 0; i < MAP.rules.length; i++) {
    if (f.indexOf(MAP.rules[i].path_prefix) === 0) return MAP.rules[i];
  }
  return null;
}
function select(f) {
  var r = matchRule(f);
  if (!r) return null; // fallback
  return (r.targeted_tests || []).slice().sort();
}
function short(t) { return t.replace('node tests/', '').replace('-test.js', ''); }
function selectShort(f) { var s = select(f); return s === null ? null : s.map(short); }
function has(f, name) { var s = selectShort(f); return !!s && s.indexOf(name) !== -1; }

var A = 'ida-2a-schema-and-plate-validation';
var C = 'ida-2c-readonly-api';
var D = 'ida-2d-write-api-and-audit';
var F = 'ida-2f-object-storage';
var G = 'ida-2g-admin-manual-entry-ui';
var H = 'ida-2h-review-queue-ui';
var IC = 'mythos-identity-core-0-contract';
var API_SUITES = [C, D, F, G, H];

console.log('DEVX-1 — ID Auto test-impact mapping\n');

// ---------------------------------------------------------------------
console.log('1. The P0 gap is closed');
var idautoGeneral = MAP.rules.filter(function (r) { return r.path_prefix === 'projects/idauto/'; });
ok(idautoGeneral.length === 1, 'exactly one general projects/idauto/ rule exists');
ok(idautoGeneral.length === 1 && (idautoGeneral[0].targeted_tests || []).length > 0,
  'the general projects/idauto/ rule selects at least one suite (was ZERO before DEVX-1)');
ok(selectShort('projects/idauto/README.md') !== null, 'an arbitrary ID Auto file does not fall through to the fallback');

console.log('\n2. No fallback for any ID Auto path');
['projects/idauto/reference/api.js', 'projects/idauto/database/schema.sql',
 'projects/idauto/config/idauto.example.json', 'projects/idauto/package.json',
 'projects/idauto/README.md'].forEach(function (f) {
  ok(matchRule(f) !== null, 'no FULL_SUITE_REQUIRED fallback for ' + f);
});

// ---------------------------------------------------------------------
console.log('\n3. API change selects every API/write dependent suite');
API_SUITES.forEach(function (s) { ok(has('projects/idauto/reference/api.js', s), 'api.js selects ' + s); });
ok(!has('projects/idauto/reference/api.js', A), 'api.js does NOT select IDA-2A (2A never loads api.js)');

console.log('\n4. storage.js selects storage + transitively dependent suites');
// Justification: api.js requires storage.js and writes.js requires storage.js,
// so every api-loading suite can break on a storage change. Confirmed
// empirically — IDA-2H fails a media assertion when storage is misconfigured.
ok(has('projects/idauto/reference/storage.js', F), 'storage.js selects IDA-2F');
ok(has('projects/idauto/reference/storage.js', H), 'storage.js selects IDA-2H (media metadata path)');
ok(has('projects/idauto/reference/storage.js', C), 'storage.js selects IDA-2C (api.js requires storage.js)');
ok(!has('projects/idauto/reference/storage.js', A), 'storage.js does NOT select IDA-2A');

console.log('\n5. Admin UI change selects ONLY IDA-2G');
ok(JSON.stringify(selectShort('projects/idauto/reference/admin-ui.js')) === JSON.stringify([G]),
  'admin-ui.js selects exactly [IDA-2G] and nothing else');
ok(JSON.stringify(selectShort('projects/idauto/reference/admin.css')) === JSON.stringify([G]),
  'admin.css selects exactly [IDA-2G]');

console.log('\n6. Review UI change selects ONLY IDA-2H');
ok(JSON.stringify(selectShort('projects/idauto/reference/review-ui.js')) === JSON.stringify([H]),
  'review-ui.js selects exactly [IDA-2H] and nothing else');

console.log('\n7. Identity boundary selects identity-core + affected ID Auto suites');
ok(has('projects/idauto/reference/identity.js', IC), 'identity.js selects the identity-core contract suite');
API_SUITES.forEach(function (s) { ok(has('projects/idauto/reference/identity.js', s), 'identity.js selects ' + s); });
ok(has('projects/idauto/database/schema.sql', IC), 'idauto schema selects the identity-core contract suite');
ok(has('projects/mythos-core/reference/identity-contract.js', IC), 'identity-contract.js selects its own contract suite');
// Honest dependency statement: no ID Auto module imports identity-contract.js
// today (identity.js is unchanged), so it must NOT pull in ID Auto suites.
// This assertion is expected to be revisited when the adapter actually lands.
ok(!has('projects/mythos-core/reference/identity-contract.js', C),
  'identity-contract.js does NOT select ID Auto suites (no ID Auto module imports it yet)');

console.log('\n8. Schema change selects every DB-backed suite');
[A, C, D, F, G, H].forEach(function (s) { ok(has('projects/idauto/database/schema.sql', s), 'schema.sql selects ' + s); });

console.log('\n9. plate-validator is correctly isolated to IDA-2A');
ok(JSON.stringify(selectShort('projects/idauto/reference/plate-validator.js')) === JSON.stringify([A]),
  'plate-validator.js selects exactly [IDA-2A]');
var refFiles = ['api.js', 'writes.js', 'db.js', 'storage.js', 'identity.js'];
var importers = refFiles.filter(function (f) {
  return read('projects/idauto/reference/' + f).indexOf('plate-validator') !== -1;
});
ok(importers.length === 0, 'no runtime reference module imports plate-validator (isolation is real, not assumed)');

console.log('\n10. Unrelated files never select ID Auto suites');
['js/app.js', 'css/style.css', 'index.html', 'docs/AI_HANDOVER.md',
 'projects/personal-intelligence/database/control-plane-schema.sql',
 'projects/automation/database/control-plane-schema.sql'].forEach(function (f) {
  var s = selectShort(f) || [];
  var leaked = s.filter(function (t) { return t.indexOf('ida-2') === 0; });
  ok(leaked.length === 0, f + ' selects no ID Auto suite');
});
ok(!has('projects/idauto/reference/IDENTITY_ADAPTER.md', C), 'the adapter spec document selects no runtime suite');

// ---------------------------------------------------------------------
console.log('\n11. Every mapped test path exists');
var missing = [];
MAP.rules.forEach(function (r) {
  (r.targeted_tests || []).forEach(function (t) {
    if (t === 'FULL_SUITE_REQUIRED') return;
    // Commands may carry arguments (e.g. "node scripts/project-intelligence.js
    // validate"), so take the first .js token as the script path.
    var m = /(\S+\.js)\b/.exec(t);
    if (!m) { missing.push(t + ' (no script path found)'); return; }
    if (!fs.existsSync(path.join(BASE, m[1]))) missing.push(m[1]);
  });
});
ok(missing.length === 0, 'no rule references a nonexistent test path' + (missing.length ? ': ' + missing.join(', ') : ''));

console.log('\n12. Rule ORDER is correct (matching is first-match-wins)');
var generalIdx = MAP.rules.findIndex(function (r) { return r.path_prefix === 'projects/idauto/'; });
var specific = [];
MAP.rules.forEach(function (r, i) {
  if (r.path_prefix.indexOf('projects/idauto/') === 0 && r.path_prefix !== 'projects/idauto/') {
    specific.push({ p: r.path_prefix, i: i });
  }
});
ok(specific.length > 0, 'specific ID Auto rules exist (' + specific.length + ')');
var mispositioned = specific.filter(function (s) { return s.i > generalIdx; });
ok(mispositioned.length === 0,
  'every specific ID Auto rule sits ABOVE the general rule — otherwise it is unreachable dead config' +
  (mispositioned.length ? ' (offenders: ' + mispositioned.map(function (s) { return s.p; }).join(', ') + ')' : ''));
// A specific rule that resolves to the general rule is dead config.
var deadConfig = specific.filter(function (s) { return matchRule(s.p).path_prefix === 'projects/idauto/'; });
ok(deadConfig.length === 0, 'no specific ID Auto rule is shadowed by the general rule');

console.log('\n13. Mappings stay minimal — no rule selects the whole repository');
MAP.rules.forEach(function (r) {
  if (r.path_prefix.indexOf('projects/idauto/') !== 0) return;
  var t = (r.targeted_tests || []);
  ok(t.indexOf('FULL_SUITE_REQUIRED') === -1, r.path_prefix + ' does not demand the full suite');
  ok(t.length <= 7, r.path_prefix + ' selects a bounded set (' + t.length + ' <= 7)');
});

console.log('\n14. Runbook exists and matches the real environment contract');
var RB = 'docs/IDAUTO_TEST_RUNBOOK.md';
ok(fs.existsSync(path.join(BASE, RB)), 'docs/IDAUTO_TEST_RUNBOOK.md exists');
if (fs.existsSync(path.join(BASE, RB))) {
  var rb = read(RB);
  ['IDAUTO_DB_HOST', 'IDAUTO_DB_PORT', 'IDAUTO_DB_USER', 'IDAUTO_DB_PASSWORD',
   'IDAUTO_DB_NAME', 'IDAUTO_MEDIA_STORAGE_PATH'].forEach(function (v) {
    ok(rb.indexOf(v) !== -1, 'runbook documents ' + v);
  });
  ok(/POSTGRES_USER/.test(rb) && /POSTGRES_PASSWORD/.test(rb) && /POSTGRES_DB/.test(rb),
    'runbook documents the POSTGRES_* -> IDAUTO_DB_* mapping');
  ok(rb.indexOf('deploy') !== -1, 'runbook states media tests must run as deploy');
  // The variables db.js actually reads must all be documented.
  var dbSrc = read('projects/idauto/reference/db.js');
  var required = (dbSrc.match(/IDAUTO_DB_[A-Z]+/g) || []).filter(function (v, i, a) { return a.indexOf(v) === i; });
  var undocumented = required.filter(function (v) { return rb.indexOf(v) === -1; });
  ok(undocumented.length === 0, 'every IDAUTO_DB_* variable db.js reads is documented' +
    (undocumented.length ? ' (missing: ' + undocumented.join(', ') + ')' : ''));
  var stSrc = read('projects/idauto/reference/storage.js');
  var stVar = (stSrc.match(/IDAUTO_MEDIA_[A-Z_]+/g) || [])[0];
  ok(!stVar || rb.indexOf(stVar) !== -1, 'the media path variable storage.js reads is documented');
  // The runbook must never contain a credential VALUE. Same-line matching,
  // with an optional opening quote consumed first. These must all PASS:
  //   POSTGRES_PASSWORD=<newline>          empty placeholder in the .env excerpt
  //   IDAUTO_DB_PASSWORD="$POSTGRES_..."   shell indirection
  //   grep '^POSTGRES_PASSWORD='           a grep pattern, not an assignment
  // While a real leak, quoted or bare, must FAIL:
  //   POSTGRES_PASSWORD=hunter2  /  POSTGRES_PASSWORD="hunter2"
  var LEAK = /(?:POSTGRES_PASSWORD|IDAUTO_DB_PASSWORD)=["']?(?![\s$^"'])[^\r\n]/;
  ok(!LEAK.test(rb), 'runbook contains no assigned credential value');
  // Self-check the detector: it must actually catch a planted leak, otherwise
  // the assertion above is worthless.
  ok(LEAK.test('POSTGRES_PASSWORD=hunter2') && LEAK.test('IDAUTO_DB_PASSWORD="hunter2"'),
    'the credential-leak detector actually detects a planted leak');
}

console.log('\nDEVX-1: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
