'use strict';
// =====================================================
// MYTHOS OS — the verification matrix never reports what it did not measure
// tests/mythos-verify-matrix-test.js
//
// Runs bin/mythos-verify-matrix.js against a repository that does not exist
// and an empty executor store: every gate whose evidence comes from the
// repository must answer something other than PASS, and the verdict must be
// NOT 100 %. Also checks the exclusion config is well-formed (every entry has
// a known reason class and evidence).
//
// Run: node tests/mythos-verify-matrix-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var SCRIPT = path.join(BASE, 'projects', 'mythos-haddad', 'bin', 'mythos-verify-matrix.js');
var CFG = JSON.parse(fs.readFileSync(path.join(BASE, 'projects', 'mythos-haddad', 'config', 'verify-matrix.json'), 'utf8'));
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

console.log('\n§1 the exclusion config');
var CLASSES = ['host_scoped', 'external_db', 'missing_deps', 'browser_only', 'deliberate_target', 'load_sensitive'];
var ex = CFG.regression_exclusions;
ok(Object.keys(ex).length > 0, 'exclusions are listed');
ok(Object.keys(ex).every(function (k) { return CLASSES.indexOf(ex[k].class) !== -1 && typeof ex[k].evidence === 'string' && ex[k].evidence.length > 10; }),
  'every exclusion has a known reason class and evidence');
ok(Object.keys(ex).every(function (k) { return fs.existsSync(path.join(BASE, 'tests', k)); }), 'every excluded suite exists');
ok(!ex['mythos-ai-executor-test.js'] && !ex['mythos-github-bridge-test.js'] && !ex['mythos-supervisor-test.js'],
  'no core orchestration suite is excluded');

console.log('\n§2 absence of evidence is never PASS');
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-matrix-'));
var r = cp.spawnSync(process.execPath, [SCRIPT, '--repo', path.join(tmp, 'no-such-repo'), '--json'], {
  encoding: 'utf8', timeout: 300000,
  env: Object.assign({}, process.env, { MYTHOS_EXECUTOR_HOME: path.join(tmp, 'no-store') })
});
var report = null;
try { report = JSON.parse(r.stdout); } catch (e) { report = null; }
ok(report && Array.isArray(report.gates) && report.gates.length === 36, 'the report has 36 gates (' + (report ? report.gates.length : 'no JSON: ' + String(r.stderr).slice(0, 120)) + ')');
ok(r.status === 1 && report && report.verdict === 'NOT 100%', 'exit 1 and NOT 100%');
var REPO_GATES = [1, 2, 3, 4, 5, 6, 7, 9, 10, 16, 17, 18, 19, 20, 22, 28, 29, 32, 33, 34, 35];
var wrong = report ? report.gates.filter(function (g) { return REPO_GATES.indexOf(g.gate) !== -1 && g.status === 'PASS'; }) : [];
ok(report && wrong.length === 0, 'no repository-derived gate is PASS without a repository' + (wrong.length ? ' — PASS: ' + wrong.map(function (g) { return g.gate; }).join(',') : ''));
ok(report && report.gates.every(function (g) { return ['PASS', 'FAIL', 'BLOCKED', 'UNMEASURED'].indexOf(g.status) !== -1; }), 'every gate answers one of PASS/FAIL/BLOCKED/UNMEASURED');

console.log('\n§3 --quick can never be 100 %');
var q = cp.spawnSync(process.execPath, [SCRIPT, '--quick', '--json'], { encoding: 'utf8', timeout: 300000 });
var qr = null; try { qr = JSON.parse(q.stdout); } catch (e) { qr = null; }
// Gates measured by suites alone: a quick run skipped them, so none may be PASS.
var SUITE_ONLY = [4, 5, 6, 7, 9, 10, 16, 18, 19, 28];
var qBad = qr ? qr.gates.filter(function (g) { return SUITE_ONLY.indexOf(g.gate) !== -1 && g.status !== 'UNMEASURED'; }) : [];
ok(qr && qr.verdict === 'NOT 100%' && qBad.length === 0,
  'a quick run reports every suite-only gate UNMEASURED and is NOT 100%' + (qBad.length ? ' — not UNMEASURED: ' + qBad.map(function (g) { return g.gate + ' ' + g.status; }).join(', ') : ''));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
