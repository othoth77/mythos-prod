'use strict';
// =====================================================
// Mythos AI Executor — structured reporting
// projects/mythos-ai-executor/lib/report.js
//
// Every task must end in a structured report (mission §16). The provider
// is INSTRUCTED to finish with a fenced ```json block whose object carries
// "mythos_report": true; this module extracts it, tolerates its absence
// (a malformed/missing report is an explicit, testable condition — never
// a crash), and renders the human-readable form.
//
// Reports carry no secrets: everything is passed through the shared
// redaction before persistence by lib/state.js, and this module never
// touches credential material at all.
// =====================================================

var redact = require('../../mythos-orchestrator/lib/redact');

function tailSnippet(text, n) {
  var t = String(text || '').trim().replace(/\s+/g, ' ');
  return t.length > n ? '…' + t.slice(t.length - n) : t;
}

// Pulls every fenced json block out of a text and returns the parsed
// objects that declare themselves a mythos report. The error string is
// surfaced verbatim as far as report.problems / the Issue comment (mission
// gh-issue-112: a missing report must give a precise, diagnosable reason,
// never just "no structured report" with nothing to act on) — so it always
// names WHICH of the possible failure shapes happened and includes a tail
// of what the provider actually said.
// Every balanced top-level {...} in a text, parsed individually; string
// literals and escapes are honoured so a brace inside a summary cannot open
// or close an object. Unparseable candidates are dropped, never guessed at.
function balancedObjects(text) {
  var out = [];
  var depth = 0, start = -1, inStr = false, esc = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { if (depth > 0) inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; continue; }
    if (c === '}') {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start !== -1) {
        try { out.push(JSON.parse(text.slice(start, i + 1))); } catch (e) { /* not an object after all */ }
        start = -1;
      }
    }
  }
  return out;
}

// A report `summary` is TEXT. A model that writes it as an object or array
// (a local model asked to answer "as one JSON object" did) must never reach
// a reader as "[object Object]": it becomes bounded canonical JSON text —
// keys sorted recursively, depth-limited — so the content survives
// byte-for-byte reproducibly, and anything too large or too deep is replaced
// by an explicit marker that no consumer can mistake for a real answer.
var SUMMARY_MAX = 20000;
var CANON_MAX_DEPTH = 8;

function canonical(v, depth) {
  if (depth > CANON_MAX_DEPTH) throw new Error('depth');
  if (Array.isArray(v)) return v.map(function (x) { return canonical(x, depth + 1); });
  if (v && typeof v === 'object') {
    var out = {};
    Object.keys(v).sort().forEach(function (k) { out[k] = canonical(v[k], depth + 1); });
    return out;
  }
  if (typeof v === 'number' && !isFinite(v)) return null;
  return v;
}

function summaryText(v, max) {
  max = max || SUMMARY_MAX;
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v.length > max ? v.slice(0, max) : v;
  if (typeof v !== 'object') return String(v).slice(0, max);
  var text;
  var kind = Array.isArray(v) ? 'an array' : 'an object';
  try { text = JSON.stringify(canonical(v, 0)); } catch (e) { return '[summary was ' + kind + ' nested deeper than ' + CANON_MAX_DEPTH + ' levels; not rendered]'; }
  if (text.length > max) return '[summary was ' + kind + ' of ' + text.length + ' chars (limit ' + max + '); not rendered]';
  return text;
}

function normalizeReport(report) {
  if (report && typeof report === 'object' && report.summary !== undefined && report.summary !== null && typeof report.summary !== 'string') {
    report.summary_type = Array.isArray(report.summary) ? 'array' : typeof report.summary;
    report.summary = summaryText(report.summary);
  }
  return report;
}

function extractReport(text) {
  if (typeof text !== 'string' || !text || !text.trim()) {
    return { report: null, error: 'the provider ended with no final message text at all (empty result)' };
  }
  var fences = [];
  var re = /```(?:json[^\n]*)\n([\s\S]*?)```/g;
  var m;
  while ((m = re.exec(text)) !== null) fences.push(m[1]);
  // Also accept a bare JSON object as the entire message.
  if (!fences.length) {
    var trimmed = text.trim();
    if (trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}') fences.push(trimmed);
  }
  // Neither a fence nor a whole-message object: the report may still be
  // EMBEDDED — prose before it, prose after it, or a second copy of it.
  // Only well-formed objects that declare mythos_report:true count; prose
  // with a stray brace in it recovers nothing and falls to the error below.
  if (!fences.length) {
    var embedded = balancedObjects(text).filter(function (o) { return o && o.mythos_report === true; });
    if (embedded.length) return { report: normalizeReport(embedded[embedded.length - 1]), error: null };
    return { report: null, error: 'no fenced ```json block (or bare JSON object) in the final message — last 200 chars: "' + tailSnippet(text, 200) + '"' };
  }
  var candidates = [];
  var parseFailures = 0;
  fences.forEach(function (block) {
    try {
      var obj = JSON.parse(block);
      if (obj && obj.mythos_report === true) candidates.push(obj);
      return;
    } catch (e) { /* fall through to recovery */ }
    // RECOVERY, not leniency. A small local model was observed (Haddad,
    // gh-issue-359 attempt 1) emitting the report object TWICE inside one
    // fence — a valid object, a blank line, then the same object again —
    // which JSON.parse rightly refuses as a whole. The report is still in
    // there, intact. Pull out every balanced top-level object and judge
    // each on its own; anything that is not a well-formed object carrying
    // mythos_report:true is still refused, so a corrupt response can never
    // become a false success this way.
    var recovered = balancedObjects(block).filter(function (o) { return o && o.mythos_report === true; });
    if (recovered.length) candidates.push.apply(candidates, recovered);
    else parseFailures++;
  });
  if (!candidates.length) {
    if (parseFailures === fences.length) {
      return { report: null, error: fences.length + ' fenced json block(s) found but none parsed as valid JSON — last 200 chars: "' + tailSnippet(text, 200) + '"' };
    }
    return { report: null, error: fences.length + ' fenced json block(s) found but none declared "mythos_report": true — last 200 chars: "' + tailSnippet(text, 200) + '"' };
  }
  // The last report block wins: providers sometimes emit a draft first.
  return { report: normalizeReport(candidates[candidates.length - 1]), error: null };
}

// Minimal shape check. Missing fields are recorded as problems rather than
// rejected outright — a partially-usable report is still evidence.
var REQUIRED_FIELDS = ['status', 'summary'];
var VALID_REPORT_STATUS = ['completed', 'failed', 'blocked'];

function validateReport(report) {
  var problems = [];
  if (!report || typeof report !== 'object') return ['report is not an object'];
  REQUIRED_FIELDS.forEach(function (f) {
    if (report[f] === undefined || report[f] === null || report[f] === '') {
      problems.push('missing field: ' + f);
    }
  });
  if (report.status && VALID_REPORT_STATUS.indexOf(report.status) === -1) {
    problems.push('invalid status: ' + String(report.status).slice(0, 40));
  }
  return problems;
}

// Human-readable execution report (mission §16 field list).
function renderMarkdown(task, status, report, extras) {
  extras = extras || {};
  var lines = [];
  var r = report || {};
  lines.push('## Task `' + task.task_id + '` — ' + (status.status || 'unknown'));
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push('| Project | ' + task.project + ' |');
  lines.push('| Stage | ' + (task.stage || '—') + ' |');
  lines.push('| Provider / model | ' + (task.provider || 'claude-code') + ' / ' + (task.model || 'default') + ' |');
  lines.push('| Execution profile | ' + (task.execution_profile || '—') + ' |');
  lines.push('| Started | ' + (status.started_at || '—') + ' |');
  lines.push('| Ended | ' + (status.ended_at || '—') + ' |');
  lines.push('| Status | **' + status.status + '** |');
  lines.push('| Claude session | `' + (status.claude_session_id || '—') + '` |');
  lines.push('| Retries | ' + (status.retry_count || 0) + ' |');
  lines.push('| Quota waits | ' + ((status.quota_state && status.quota_state.waits) || 0) + ' |');
  lines.push('| Commit | ' + (r.commit ? '`' + r.commit + '`' : '—') + ' |');
  lines.push('| Remote HEAD | ' + (extras.remote_head ? '`' + extras.remote_head + '`' : '—') + ' |');
  lines.push('| Git verified | ' + (extras.git_verified === undefined ? '—' : String(extras.git_verified)) + ' |');
  lines.push('');
  lines.push('**Summary:** ' + (r.summary || '(no structured report was produced)'));
  lines.push('');
  if (Array.isArray(r.tests) && r.tests.length) {
    lines.push('**Tests:**');
    r.tests.forEach(function (t) {
      lines.push('- ' + (typeof t === 'string' ? t : JSON.stringify(t)));
    });
    lines.push('');
  }
  if (Array.isArray(r.files_changed) && r.files_changed.length) {
    lines.push('**Changed files:** ' + r.files_changed.map(function (f) { return '`' + f + '`'; }).join(', '));
    lines.push('');
  }
  if (Array.isArray(r.residual_risks) && r.residual_risks.length) {
    lines.push('**Residual risks:**');
    r.residual_risks.forEach(function (x) { lines.push('- ' + x); });
    lines.push('');
  }
  if (r.next_stage) {
    lines.push('**Next stage:** ' + r.next_stage);
    lines.push('');
  }
  if (extras.report_problems && extras.report_problems.length) {
    lines.push('**Report problems:** ' + extras.report_problems.join('; '));
    lines.push('');
  }
  return redact.redact(lines.join('\n'));
}

// A structured report for a run that ended WITHOUT a usable provider block —
// or that never reached the provider (a preflight blocker such as
// ACTION_PROFILE_MISMATCH / MODEL_UNAVAILABLE). "provider produced no
// structured report" is never the whole story: the diagnosis, the decision
// the attempt ran under and the exact next action are recorded in the same
// shape the provider would have used, marked synthesized:true so nobody can
// mistake it for the agent's own words.
//
// Field list (the minimum every mythos_report carries from here on):
//   status, task_id, attempt_id, requested_action, action_raw, action_source,
//   execution_profile, model, branch, base_sha, commit, files_changed, tests,
//   blocker { code, reason, retryable, ... }, next_stage, summary
function synthesize(input) {
  input = input || {};
  var st = String(input.status || 'blocked').toLowerCase();
  if (VALID_REPORT_STATUS.indexOf(st) === -1) st = 'blocked';
  var blocker = input.blocker || null;
  var summary = input.summary || (blocker ? blocker.code + ': ' + (blocker.reason || '') : 'no summary');
  return {
    mythos_report: true,
    synthesized: true,
    synthesized_by: input.synthesized_by || 'executor',
    status: st,
    task_id: input.task_id || null,
    attempt_id: input.attempt_id || null,
    requested_action: input.requested_action || null,
    action_raw: input.action_raw || null,
    action_source: input.action_source || null,
    execution_profile: input.execution_profile || null,
    model: input.model || null,
    branch: input.branch || null,
    base_sha: input.base_sha || null,
    commit: input.commit || null,
    remote_head: input.remote_head || null,
    files_changed: Array.isArray(input.files_changed) ? input.files_changed : [],
    tests: Array.isArray(input.tests) ? input.tests : [],
    residual_risks: Array.isArray(input.residual_risks) ? input.residual_risks : [],
    blocker: blocker,
    diagnosis: input.diagnosis || null,
    summary: String(summary).slice(0, 20000),
    next_stage: input.next_stage || (blocker && blocker.retryable === false
      ? 'fix the cause (' + blocker.code + ') and add the `rerun` label / re-queue explicitly — this blocker is never retried automatically'
      : 'review this report')
  };
}

module.exports = {
  extractReport: extractReport,
  summaryText: summaryText,
  synthesize: synthesize,
  validateReport: validateReport,
  renderMarkdown: renderMarkdown,
  VALID_REPORT_STATUS: VALID_REPORT_STATUS
};
