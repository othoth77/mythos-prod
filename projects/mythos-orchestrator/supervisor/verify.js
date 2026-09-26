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
var KINDS = ['status_completed', 'tests_pass', 'no_problems', 'mentions', 'files_changed', 'commit_delivered'];

function parse(criterion) {
  var m = CHECK_RE.exec(String(criterion || ''));
  if (!m) return null;
  var kind = m[1].toLowerCase();
  if (KINDS.indexOf(kind) === -1) return null;
  var arg = m[2] == null ? null : String(m[2]).trim();
  if ((kind === 'mentions' || kind === 'files_changed') && !arg) return null;
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

module.exports = { parse: parse, allDeterministic: allDeterministic, evaluate: evaluate, KINDS: KINDS, testsPass: testsPass };
