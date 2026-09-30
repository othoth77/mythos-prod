'use strict';
// =====================================================
// MYTHOS — structured-report normalization (small-model output shapes)
// tests/mythos-report-normalization-test.js
//
// Haddad's local 7B model was observed emitting its mythos_report TWICE —
// a valid object, a blank line, the same object again — which JSON.parse
// rightly refuses as one blob, and the task ended NO_STRUCTURED_REPORT
// (gh-issue-359, attempt 1). The report was in there, intact.
//
// lib/report.js now recovers every balanced top-level object and judges
// each on its own. What must hold, in this order of importance:
//
//   1. a corrupt response is STILL refused — recovery is never leniency;
//   2. the shapes a small model actually produces are accepted;
//   3. every behaviour the existing executor suite pins is unchanged.
//
// Run with: node tests/mythos-report-normalization-test.js
// =====================================================

var path = require('path');
var reporting = require(path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'lib', 'report'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }

var GOOD = '{"mythos_report": true, "status": "completed", "summary": "real summary", "tests": [], "commit": null, "files_changed": []}';

// --- 1. corrupt input stays refused ------------------------------------------
(function () {
  var r = reporting.extractReport('```json\nnot actually json {{\n```');
  ok(r.report === null && /none parsed as valid JSON/.test(r.error),
    'refuse: an unparsable fence is still an error, with the same diagnosis as before');

  r = reporting.extractReport('```json\n{"mythos_report": true, "status": "completed", "summary": "cut off mid');
  ok(r.report === null, 'refuse: a truncated object (no closing brace) recovers nothing');

  r = reporting.extractReport('```json\n{"mythos_report": true, "status": "completed"\n```');
  ok(r.report === null && /none parsed as valid JSON/.test(r.error),
    'refuse: an unbalanced fence recovers nothing');

  r = reporting.extractReport('{"mythos_report": true, "status": "completed", "summary": "x",}');
  ok(r.report === null, 'refuse: a trailing comma is not repaired into a report');

  r = reporting.extractReport('Done. The braces { in this prose } are not a report.');
  ok(r.report === null && /no fenced/.test(r.error),
    'refuse: prose with braces in it is not mistaken for a report');

  r = reporting.extractReport('```json\n{"unrelated": 1}\n```\n{"also_unrelated": {"nested": true}}');
  ok(r.report === null && /none declared "mythos_report": true/.test(r.error),
    'refuse: well-formed objects without the flag are still ignored, fenced or embedded');

  r = reporting.extractReport('{"mythos_report": "true", "status": "completed", "summary": "string flag"}');
  ok(r.report === null, 'refuse: the flag must be the boolean true, not the string');
})();

// --- 2. the shapes a small model actually produces ---------------------------
(function () {
  // The real gh-issue-359 attempt-1 shape: one fence, two copies inside it.
  var duplicated = '```json\n' + GOOD + '\n\n' + GOOD + '\n```';
  var r = reporting.extractReport(duplicated);
  ok(r.report && r.report.summary === 'real summary',
    'accept: the report duplicated inside ONE fence is recovered (the live gh-issue-359 failure)');

  var rawTwice = GOOD + '\n\n' + GOOD;
  r = reporting.extractReport(rawTwice);
  ok(r.report && r.report.status === 'completed', 'accept: two raw copies with no fence');

  var fencedThenRaw = '```json\n' + GOOD + '\n```\n\n' + GOOD;
  r = reporting.extractReport(fencedThenRaw);
  ok(r.report && r.report.status === 'completed', 'accept: a fenced copy followed by a raw copy (the gh-issue-362 shape)');

  var prose = 'Here is my final report:\n\n' + GOOD + '\n\nLet me know if you need more.';
  r = reporting.extractReport(prose);
  ok(r.report && r.report.summary === 'real summary', 'accept: a raw object with prose before and after it');

  var braceInString = '{"mythos_report": true, "status": "completed", "summary": "config uses {braces} and a \\"quoted\\" {word}"}';
  r = reporting.extractReport(braceInString + '\n' + braceInString);
  ok(r.report && /braces/.test(r.report.summary),
    'accept: braces and escaped quotes INSIDE a string never open or close an object');

  var draftThenFinal = '```json\n{"mythos_report": true, "status": "failed", "summary": "draft"}\n\n' +
    '{"mythos_report": true, "status": "completed", "summary": "final"}\n```';
  r = reporting.extractReport(draftThenFinal);
  ok(r.report && r.report.summary === 'final', 'accept: with two DIFFERENT reports in one fence, the last still wins');
})();

// --- 3. everything the executor suite already pins is unchanged ------------
(function () {
  var good = '```json\n' + GOOD + '\n```';
  ok(reporting.extractReport(good).report.status === 'completed', 'unchanged: a normal fenced block');
  var two = good + '\n```json\n{"mythos_report": true, "status": "failed", "summary": "second"}\n```';
  ok(reporting.extractReport(two).report.status === 'failed', 'unchanged: last block wins across fences');
  ok(reporting.extractReport('no fence at all').report === null, 'unchanged: absent → null');
  ok(reporting.extractReport(GOOD).report.summary === 'real summary', 'unchanged: bare object accepted');
  var empty = reporting.extractReport('');
  ok(empty.report === null && /no final message text/.test(empty.error), 'unchanged: empty output diagnosis');
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) console.error('failures:\n  - ' + failures.join('\n  - '));
process.exit(failed ? 1 : 0);
