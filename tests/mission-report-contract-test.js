'use strict';
// =====================================================
// MYTHOS — Mission Report contract tests
// tests/mission-report-contract-test.js
//
// Reproduces and guards the production failure of 2026-09-07:
//
//   Status: COMPLETED
//   Result Summary: <not available>
//   report_status: completed
//   report_problems: missing field: summary
//
// The execution genuinely succeeded and the provider genuinely emitted a
// mythos_report block — but the block carried no `summary`, so the whole
// downstream chain (executor report.json → bridge control report → OS
// Console mission report) rendered "<not available>" while still calling
// the mission COMPLETED.
//
// Three things must hold, and they are distinct:
//   1. execution COMPLETED  — did the provider process succeed?
//   2. report VALID         — does the report satisfy the contract?
//   3. a completed execution does NOT imply a valid report.
//
// Nothing here fabricates content. A summary may only be recovered from
// text the provider itself produced; when there is none, the report stays
// INVALID and the mission does not land green.
//
// Deterministic and offline. Run with:
//   node tests/mission-report-contract-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var reporting = require(path.join(EXEC, 'lib', 'report.js'));

// The provider's real shape in the production incident: prose, then a
// mythos_report block that declares completion but carries no summary.
var PROSE = 'I reviewed projects/mythos-delegate/lib/delegate.js. The review lane ' +
  'resolves to the claude implementer on this host, and ok requires both a terminal ' +
  'completed status and a zero exit code. I changed nothing.';
var NO_SUMMARY_BLOCK = '```json\n{"mythos_report": true, "status": "completed", "tests": [], "commit": null}\n```';
var INCIDENT_TEXT = PROSE + '\n' + NO_SUMMARY_BLOCK;

console.log('\n§1 the incident, at the unit level');

var extracted = reporting.extractReport(INCIDENT_TEXT);
ok(extracted.report !== null, 'the provider block IS found — this was never a "no report" case');
ok(extracted.report.status === 'completed', 'and it declares status completed');
ok(extracted.report.summary === undefined, 'but it carries no summary — the exact defect');

var problems = reporting.validateReport(extracted.report);
ok(problems.indexOf('missing field: summary') !== -1,
  'validateReport detects it, producing the exact production string');

// The gap: detection existed, but nothing acted on it.
ok(typeof reporting.isValidReport === 'function',
  'report.js exposes an explicit validity predicate (execution state != report validity)');
ok(reporting.isValidReport(extracted.report) === false,
  'a report missing summary is explicitly INVALID');
ok(reporting.isValidReport({ mythos_report: true, status: 'completed', summary: 'did it' }) === true,
  'a complete report is explicitly VALID');

console.log('\n§2 normalization recovers a summary from the provider\'s OWN words');

ok(typeof reporting.normalize === 'function', 'report.js exposes normalize()');

var n = reporting.normalize({ report: extracted.report, text: INCIDENT_TEXT });
ok(n.valid === true, 'after normalization the report is VALID');
ok(typeof n.report.summary === 'string' && n.report.summary.length > 0, 'it now has a summary');
ok(/review lane|resolves to the claude implementer|reviewed/i.test(n.report.summary),
  'and the summary is the provider\'s own words, not an invented sentence (' +
  JSON.stringify(String(n.report.summary).slice(0, 80)) + ')');
ok(n.report.summary.indexOf('mythos_report') === -1 && n.report.summary.indexOf('```') === -1,
  'the JSON block itself is never used as the summary');
ok(n.summary_source === 'derived_from_text', 'the recovery is labelled, never passed off as the provider\'s structured field');
ok(n.normalized === true, 'and the report is marked as repaired');
ok(n.problems.indexOf('missing field: summary') !== -1,
  'the original problem is still recorded — the repair hides nothing');
ok(n.report.status === 'completed', 'the declared status is untouched');

console.log('\n§3 a report that is already valid is left completely alone');

var goodReport = { mythos_report: true, status: 'completed', summary: 'did the thing', tests: ['a'] };
var g = reporting.normalize({ report: goodReport, text: 'prose that must NOT become the summary' });
ok(g.valid === true, 'a good report stays valid');
ok(g.normalized === false, 'and is not marked as repaired');
ok(g.report.summary === 'did the thing', 'its own summary is preserved verbatim');
ok(g.summary_source === 'provider', 'and is attributed to the provider');
ok(g.problems.length === 0, 'with no problems recorded');

console.log('\n§4 nothing is fabricated — no usable text means the report stays INVALID');

var noText = reporting.normalize({ report: { mythos_report: true, status: 'completed' }, text: '' });
ok(noText.valid === false, 'a report with no summary and no text to recover from stays INVALID');
ok(!noText.report.summary, 'and no summary is invented');
ok(noText.summary_source === null, 'with no false attribution');

var blockOnly = reporting.normalize({
  report: { mythos_report: true, status: 'completed' },
  text: NO_SUMMARY_BLOCK   // the fence is the ENTIRE message: no prose at all
});
ok(blockOnly.valid === false,
  'when the only text is the JSON block itself there is nothing to derive — still INVALID');

var whitespace = reporting.normalize({ report: { mythos_report: true, status: 'completed' }, text: '   \n\n  \t ' });
ok(whitespace.valid === false, 'whitespace is not a summary');

console.log('\n§5 an invalid status is still rejected');

var badStatus = reporting.normalize({
  report: { mythos_report: true, status: 'sort-of-done', summary: 'x' }, text: 'prose'
});
ok(badStatus.valid === false, 'an out-of-vocabulary status makes the report INVALID');
ok(badStatus.problems.some(function (p) { return /invalid status/.test(p); }), 'and says so');

console.log('\n§6 end-to-end through the executor — the production scenario');

process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
var harness = require(path.join(__dirname, 'support', 'report-harness.js'));

harness.run([
  // (a) THE INCIDENT: successful execution, report block present, no summary,
  //     usable prose. Must land COMPLETED with a VALID, summarised report.
  { name: 'incident', script: { kind: 'malformed', text: INCIDENT_TEXT },
    check: function (st, rep) {
      ok(st.status === 'COMPLETED', 'incident: the execution still completes (it genuinely succeeded)');
      ok(rep.report_valid === true, 'incident: and the report is now explicitly VALID');
      ok(rep.structured && typeof rep.structured.summary === 'string' && rep.structured.summary.length > 0,
        'incident: the structured report carries a summary — no more <not available>');
      ok(/reviewed|review lane/i.test(rep.structured.summary),
        'incident: the summary is the provider\'s own words');
      ok((rep.problems || []).indexOf('missing field: summary') !== -1,
        'incident: the original contract violation is still reported, not swallowed');
      ok(rep.summary_source === 'derived_from_text',
        'incident: the recovery is labelled in the persisted record');
      var md = fs.readFileSync(path.join(rep.__dir, 'report.md'), 'utf8');
      ok(md.indexOf('(no structured report was produced)') === -1,
        'incident: report.md no longer claims no report was produced — one WAS produced');
      ok(/reviewed|review lane/i.test(md), 'incident: report.md shows the recovered summary');
    } },

  // (b) A report with no summary AND no recoverable text must NOT go green.
  { name: 'unrecoverable', script: { kind: 'malformed', text: NO_SUMMARY_BLOCK },
    check: function (st, rep) {
      ok(st.status === 'BLOCKED',
        'unrecoverable: a completed execution with an unusable report does NOT land COMPLETED');
      ok(rep.report_valid === false, 'unrecoverable: the report is explicitly INVALID');
      ok((rep.problems || []).indexOf('missing field: summary') !== -1, 'unrecoverable: the reason is recorded');
      ok(!/<not available>/.test(JSON.stringify(rep.structured || {})),
        'unrecoverable: the structured report still explains itself rather than leaving holes');
    } },

  // (c) PRESERVED V1 BEHAVIOUR: prose with no block at all stays BLOCKED.
  { name: 'no-block', script: { kind: 'malformed', text: 'I did things but forgot the block' },
    check: function (st, rep) {
      ok(st.status === 'BLOCKED', 'no-block: unchanged — still BLOCKED');
      ok(rep.report === null && rep.blocker && rep.blocker.code === 'NO_STRUCTURED_REPORT',
        'no-block: unchanged — NO_STRUCTURED_REPORT');
      ok(rep.report_valid === false, 'no-block: reported as INVALID');
      ok(/forgot the block/.test(rep.structured.summary || rep.structured.diagnosis || ''),
        'no-block: the provider\'s own words reach the summary/diagnosis, so nothing renders empty');
    } },

  // (d) PRESERVED V1 BEHAVIOUR: a complete provider report is untouched.
  { name: 'good', script: { kind: 'success', summary: 'structured on completed' },
    check: function (st, rep) {
      ok(st.status === 'COMPLETED', 'good: still COMPLETED');
      ok(rep.report_valid === true, 'good: VALID');
      ok(rep.structured.summary === 'structured on completed', 'good: the provider\'s summary is preserved verbatim');
      ok(!rep.structured.synthesized, 'good: not synthesised');
      ok(rep.summary_source === 'provider', 'good: attributed to the provider');
    } }
]).then(function () {
  console.log('\n' + (fail === 0 ? 'OK' : 'FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}).catch(function (e) {
  console.log('  FAIL harness error: ' + (e && e.stack || e));
  process.exit(1);
});
