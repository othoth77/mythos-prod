'use strict';
// =====================================================
// MYTHOS — Stage DEVX-2 impact-map integrity tests
// tests/devx-2-impact-map-integrity-test.js
//
// DEVX-1 (tests/devx-1-idauto-test-impact-test.js) verified the test-impact
// map, but 31 of its 34 assertions were ID Auto-specific and were removed
// with the rest of the ID Auto tree in IDA-DECOUPLE-4. This suite preserves
// DEVX-1's one general, non-IDauto safeguard as a small standalone suite:
// no rule in projects/meta/test-impact-map.json may reference a test path
// that does not exist on disk.
//
// Deterministic, offline, no network.
//
// Run with: node tests/devx-2-impact-map-integrity-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

function readJSON(p) { return JSON.parse(fs.readFileSync(path.join(BASE, p), 'utf8')); }

var MAP_PATH = 'projects/meta/test-impact-map.json';
var map;

// ─────────────────────────────────────────────────────────────────────────
console.log('\n1. MAP PARSES AND HAS RULES');
(function () {
  var parsed = null;
  var parseError = null;
  try {
    parsed = readJSON(MAP_PATH);
  } catch (e) {
    parseError = e;
  }
  ok(!parseError, MAP_PATH + ' parses as valid JSON');
  ok(parsed && Array.isArray(parsed.rules) && parsed.rules.length > 0, 'rules is a non-empty array');
  map = parsed;
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n2. EVERY RULE HAS path_prefix AND targeted_tests');
(function () {
  if (!map || !Array.isArray(map.rules)) return;
  var allHavePrefix = map.rules.every(function (r) {
    return typeof r.path_prefix === 'string' && r.path_prefix.length > 0;
  });
  ok(allHavePrefix, 'Every rule has a non-empty string path_prefix');

  var allHaveTargetedTests = map.rules.every(function (r) {
    return Array.isArray(r.targeted_tests);
  });
  ok(allHaveTargetedTests, 'Every rule has a targeted_tests array');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n3. NO RULE REFERENCES A NONEXISTENT TEST PATH');
(function () {
  if (!map || !Array.isArray(map.rules)) return;
  var testFileRe = /tests\/[A-Za-z0-9._-]+\.js/g;
  var missing = [];
  map.rules.forEach(function (r) {
    var strings = (r.targeted_tests || []).concat(r.notes ? [r.notes] : []);
    strings.forEach(function (s) {
      var m = s.match(testFileRe);
      if (!m) return;
      m.forEach(function (token) {
        if (!fs.existsSync(path.join(BASE, token))) missing.push(r.path_prefix + ' -> ' + token);
      });
    });
  });
  ok(missing.length === 0, 'No rule references a nonexistent test path' + (missing.length ? (' (missing: ' + missing.join(', ') + ')') : ''));
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n4. NO DUPLICATE path_prefix VALUES');
(function () {
  if (!map || !Array.isArray(map.rules)) return;
  var prefixes = map.rules.map(function (r) { return r.path_prefix; });
  ok(new Set(prefixes).size === prefixes.length, 'No two rules share an identical path_prefix');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n5. NO RULE POINTS AT THE REMOVED projects/idauto TREE');
(function () {
  if (!map || !Array.isArray(map.rules)) return;
  var idautoRule = map.rules.find(function (r) { return r.path_prefix.indexOf('projects/idauto') === 0; });
  ok(!idautoRule, 'No rule path_prefix starts with projects/idauto (the tree was removed in IDA-DECOUPLE-4)');
})();

console.log('\nDEVX-2: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
