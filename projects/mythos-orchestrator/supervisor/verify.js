'use strict';
// =====================================================
// MYTHOS supervisor — deterministic (LOCAL) verification
// projects/mythos-orchestrator/supervisor/verify.js
//
// An acceptance criterion written as `check:<kind>[:<arg>]` is verified
// here, with no model at all:
//
//   check:status_completed        the report status is COMPLETED
//   check:tests_pass              ≥1 test line with counts, and every one says 0 failed
//   check:no_problems             the report lists no problems
//   check:tests_pass_for:<path>   the TARGET suite passed: ≥1 line of the report's tests
//                                 list names <path> as a whole token with counts showing
//                                 ≥1 passed and 0 failed, and no line naming <path> shows
//                                 a failure. Lines about other suites are ignored and the
//                                 summary is never searched, so running a DIFFERENT
//                                 passing suite cannot satisfy it. <path> is repo-relative
//                                 and strictly validated; a malformed <path> makes the
//                                 criterion free text, which is never verified here
//                                 (it can never auto-pass).
//   check:mentions:<text>         the summary/tests/files mention <text> (case-insensitive)
//   check:files_changed:<path>    a changed file starts with <path>
//   check:commit_delivered        GitHub shows the commit on the task branch
//                                 (the supervisor's own git verification)
//
// If EVERY criterion is a known check, the task is verified locally and
// OpenAI is not asked. A free-text criterion needs judgement → OpenAI.
// What this proves is exactly what the report and git show — the same
// evidence a reviewer model would read.
// =====================================================

var CHECK_RE = /^\s*check:([a-z_]+)(?::(.*))?\s*$/i;
var KINDS = ['status_completed', 'tests_pass', 'no_problems', 'mentions', 'files_changed', 'commit_delivered', 'tests_pass_for'];

// check:tests_pass_for target: repo-relative, no leading '/', no '..', no
// whitespace or quotes (the character class excludes them), 1..200 chars.
var TARGET_RE = /^[A-Za-z0-9_][A-Za-z0-9._\/-]{0,199}$/;
var PATH_CHAR = /[A-Za-z0-9._\/-]/;
function validTarget(arg) {
  return typeof arg === 'string' && TARGET_RE.test(arg) && arg.indexOf('..') === -1;
}

function parse(criterion) {
  var m = CHECK_RE.exec(String(criterion || ''));
  if (!m) return null;
  var kind = m[1].toLowerCase();
  if (KINDS.indexOf(kind) === -1) return null;
  var arg = m[2] == null ? null : String(m[2]).trim();
  if ((kind === 'mentions' || kind === 'files_changed') && !arg) return null;
  if (kind === 'tests_pass_for' && !validTarget(arg)) return null;   // malformed → free text, never auto-passed
  return { kind: kind, arg: arg };
}

function allDeterministic(criteria) {
  return Array.isArray(criteria) && criteria.length > 0 && criteria.every(function (c) { return parse(c) !== null; });
}

function testsPass(tests) {
  var counted = 0;
  for (var i = 0; i < (tests || []).length; i++) {
    var line = String(tests[i]);
    var m = /(\d+)\s+passed[,;]?\s*(\d+)\s+failed/i.exec(line);
    if (m) { counted++; if (parseInt(m[2], 10) !== 0) return { met: false, evidence: 'failing: ' + line.slice(0, 200) }; continue; }
    if (/\b(FAIL|FAILED|ERROR)\b/.test(line)) return { met: false, evidence: 'failure reported: ' + line.slice(0, 200) };
  }
  return counted ? { met: true, evidence: counted + ' test line(s), all 0 failed' } : { met: false, evidence: 'no test line with passed/failed counts' };
}

// Whole-token occurrence of `target` in `line`: the characters around it must
// not be path characters, so tests/a.js does not match tests/a.js.bak,
// xtests/a.js or tests/a-test.js. A single trailing '.' that ends the token
// (sentence punctuation: "ran tests/a.js.") is allowed.
function namesTarget(line, target) {
  for (var i = line.indexOf(target); i !== -1; i = line.indexOf(target, i + 1)) {
    var before = i === 0 ? '' : line.charAt(i - 1);
    var j = i + target.length;
    var after = line.charAt(j);
    if (after === '.' && !PATH_CHAR.test(line.charAt(j + 1) || ' ')) after = '';
    if ((before === '' || !PATH_CHAR.test(before)) && (after === '' || !PATH_CHAR.test(after))) return true;
  }
  return false;
}

// Only the report's tests list, only the lines that name the target.
function testsPassFor(tests, target) {
  var lines = (tests || []).map(String).filter(function (l) { return namesTarget(l, target); });
  if (!lines.length) return { met: false, evidence: 'no test line names ' + target };
  var passing = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/\b(FAIL|FAILED|ERROR)\b/.test(line)) return { met: false, evidence: 'failure reported for ' + target + ': ' + line.slice(0, 200) };
    var m = /(\d+)\s+passed[,;]?\s*(\d+)\s+failed/i.exec(line);
    if (m) {
      if (parseInt(m[2], 10) !== 0) return { met: false, evidence: 'failing: ' + line.slice(0, 200) };
      if (parseInt(m[1], 10) > 0) passing++;
    } else if (/\b(fail|failed|failure|failures|error|errors)\b/i.test(line)) {
      return { met: false, evidence: 'failure reported for ' + target + ': ' + line.slice(0, 200) };
    }
  }
  return passing ? { met: true, evidence: target + ': ' + passing + ' line(s) with ≥1 passed and 0 failed' }
    : { met: false, evidence: 'no line for ' + target + ' shows ≥1 passed and 0 failed' };
}

// report: the curated report; delivery: the supervisor's git verification
// ({ verified:[sha…] } or null).
function evaluate(criteria, report, delivery) {
  if (!allDeterministic(criteria)) return { decided: false };
  report = report || {};
  var hay = [report.summary].concat(report.tests || [], report.files_changed || []).join('\n').toLowerCase();
  var results = criteria.map(function (c) {
    var p = parse(c);
    var out;
    if (p.kind === 'status_completed') out = { met: report.status === 'COMPLETED', evidence: 'report status ' + report.status };
    else if (p.kind === 'tests_pass') out = testsPass(report.tests);
    else if (p.kind === 'tests_pass_for') out = testsPassFor(report.tests, p.arg);
    else if (p.kind === 'no_problems') out = { met: !(report.problems || []).length, evidence: (report.problems || []).length + ' problem(s) reported' };
    else if (p.kind === 'mentions') out = { met: hay.indexOf(p.arg.toLowerCase()) !== -1, evidence: (hay.indexOf(p.arg.toLowerCase()) !== -1 ? 'mentions ' : 'does not mention ') + JSON.stringify(p.arg) };
    else if (p.kind === 'files_changed') {
      var hit = (report.files_changed || []).filter(function (f) { return String(f).indexOf(p.arg) === 0; });
      out = { met: hit.length > 0, evidence: hit.length ? 'changed ' + hit.slice(0, 3).join(', ') : 'no changed file under ' + p.arg };
    } else if (p.kind === 'commit_delivered') {
      var v = delivery && delivery.verified || [];
      out = { met: v.length > 0, evidence: v.length ? 'git verified ' + v.length + ' commit(s) on the task branch' : 'no git-verified commit' };
    }
    return { criterion: c, met: !!out.met, evidence: out.evidence };
  });
  return { decided: true, passed: results.every(function (r) { return r.met; }), results: results };
}

module.exports = { parse: parse, allDeterministic: allDeterministic, evaluate: evaluate, KINDS: KINDS, testsPass: testsPass, testsPassFor: testsPassFor, validTarget: validTarget };
