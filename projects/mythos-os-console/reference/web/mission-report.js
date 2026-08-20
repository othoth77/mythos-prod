'use strict';
/* =====================================================
   MYTHOS OS COMMAND CENTER — mission report builder
   projects/mythos-os-console/reference/web/mission-report.js

   The ONE place a copyable mission report is ever built. app.js calls
   buildMissionReport() from the execution detail panel's copy button;
   tests/mos-1-console-test.js require()s this file directly and unit-tests
   the same function — the same dual-environment pattern as modules.js.

   Input is exactly what the detail panel already fetched and rendered:

     {
       task:      GET /api/missions/<id> .data.task    (allowlisted fields)
       status:    GET /api/missions/<id> .data.status  (allowlisted fields)
       effective: GET /api/missions/<id> .data.effective
       report:    GET /api/missions/<id>/report .data, or null
     }

   Nothing here fetches, stores or sends anything. The output is plain
   text for the operator's clipboard. Free text (instruction, summary,
   errors) is preserved verbatim and untruncated — with ONE exception:
   values that look like credentials are replaced with [REDACTED], because
   a report built for pasting into another AI conversation must never be
   the step that exfiltrates a token that leaked into an execution log.
   A field that does not exist is written as <not available>, never
   invented.
   ===================================================== */

(function (root) {
  var NOT_AVAILABLE = '<not available>';

  // --- redaction -------------------------------------------------------
  // Three passes, in this order (a labelled bearer header must lose its
  // token before the label rule rewrites the line):
  //   1. "Bearer <token>" anywhere in text.
  //   2. A credential-shaped label directly assigned a value
  //      (key/secret/token/password/... followed by : or =).
  //   3. Bare well-known token shapes (GitHub, AWS key ids, Slack, Google
  //      API keys, three-part JWTs) even when unlabelled.
  // Deliberately narrow: prose that merely mentions the word "token" is
  // not rewritten — only an actual assigned or recognisable value is.
  var BEARER_RE = /\b(bearer)\s+[a-z0-9._~+/=-]{8,}/gi;
  var LABELLED_RE = /\b(api[_-]?key|apikey|access[_-]?key|secret|token|password|passwd|credential|authorization)\b(\s*[:=]\s*)("[^"\n]+"|'[^'\n]+'|[^\s"']+)/gi;
  var KNOWN_TOKEN_RE = /\b(sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,})/g;

  function redactSecrets(text) {
    return String(text)
      .replace(BEARER_RE, '$1 [REDACTED]')
      .replace(LABELLED_RE, '$1$2[REDACTED]')
      .replace(KNOWN_TOKEN_RE, '[REDACTED]');
  }

  // --- helpers ---------------------------------------------------------

  function textOr(v) {
    if (v === undefined || v === null) return NOT_AVAILABLE;
    var s = String(v);
    return s.trim() ? s : NOT_AVAILABLE;
  }

  // "1h 02m 03s" from the two timestamps the status record already
  // carries. Pure arithmetic on the inputs — no clock is read, so the
  // function stays deterministic and testable.
  function durationBetween(startedAt, endedAt) {
    var a = Date.parse(String(startedAt));
    var b = Date.parse(String(endedAt));
    if (isNaN(a) || isNaN(b) || b < a) return null;
    var total = Math.floor((b - a) / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    if (h > 0) return h + 'h ' + pad(m) + 'm ' + pad(s) + 's';
    if (m > 0) return m + 'm ' + pad(s) + 's';
    return s + 's';
  }

  // --- the report ------------------------------------------------------

  function buildMissionReport(mission) {
    mission = mission || {};
    var task = mission.task || {};
    var status = mission.status || {};
    var report = mission.report || {};

    // The console stores the operator's mission title as the task's
    // stage (server.js relays title AS stage) — there is no separate
    // title field in the mission record, so both lines carry it.
    var title = task.stage;
    var skill = task.skill_id
      ? task.skill_id + (task.skill_version ? ' v' + task.skill_version : '')
      : null;
    var duration = durationBetween(status.started_at, status.ended_at);

    function field(label, value) { return label + ':\n' + textOr(value); }

    var head = [
      'MYTHOS MISSION REPORT',
      '=====================',
      '',
      field('Title', title),
      '',
      field('Execution ID', status.execution_id),
      '',
      field('Status', status.status || mission.effective),
      '',
      field('Stage', task.stage),
      '',
      field('Skill', skill),
      '',
      field('Provider', task.provider),
      '',
      field('Model', task.model),
      '',
      field('Execution Profile', task.execution_profile),
      '',
      field('Priority', task.priority),
      '',
      field('Category', task.task_category),
      '',
      field('Created', task.created_at),
      '',
      field('Started', status.started_at),
      '',
      field('Ended', status.ended_at),
      '',
      field('Duration', duration)
    ];

    function section(header, body) {
      var underline = new Array(header.length + 1).join('-');
      return ['---', '', header, underline, textOr(body), ''];
    }

    // The raw tail: every remaining allowlisted execution field the
    // console API already exposes, as key: value lines. Nothing beyond
    // what the detail/report relays serve — a field the API withholds
    // (provider_result_tail, git internals) never appears here.
    var raw = [
      'task_id: ' + textOr(task.task_id),
      'project: ' + textOr(task.project),
      'effective_state: ' + textOr(mission.effective),
      'retry_count: ' + textOr(status.retry_count),
      'report_status: ' + textOr(report.status),
      'report_next_stage: ' + textOr(report.next_stage),
      'report_problems: ' + (report.problems && report.problems.length ? report.problems.join('; ') : NOT_AVAILABLE),
      'mcp_capabilities: ' + (task.mcp_capabilities && task.mcp_capabilities.length ? task.mcp_capabilities.join(', ') : NOT_AVAILABLE)
    ].join('\n');

    var lines = head
      .concat([''])
      .concat(section('INSTRUCTION', task.instruction))
      .concat(section('RESULT SUMMARY', report.summary))
      .concat(section('NEXT ACTION', status.next_action))
      .concat(section('ERROR / BLOCKER', status.last_error))
      // The mission record carries no structured test or change fields;
      // anything the provider reported about tests, commits or files
      // lives verbatim inside RESULT SUMMARY above. Written honestly as
      // not-available rather than re-parsed out of the summary (rule:
      // never invent, never rewrite).
      .concat(section('TEST RESULTS', null))
      .concat(section('CHANGES', null))
      .concat(section('RAW EXECUTION DETAILS', raw));

    // One redaction pass over the whole assembled text, so every field —
    // metadata and free text alike — obeys the same rule.
    return redactSecrets(lines.join('\n').replace(/\s+$/, '') + '\n');
  }

  // The optional second button: only the result summary, same redaction.
  // null (no summary to copy) rather than a <not available> placeholder,
  // so the UI can simply not offer the button.
  function buildResultText(mission) {
    var report = (mission && mission.report) || {};
    if (report.summary === undefined || report.summary === null || !String(report.summary).trim()) return null;
    return redactSecrets(String(report.summary));
  }

  var api = {
    buildMissionReport: buildMissionReport,
    buildResultText: buildResultText,
    redactSecrets: redactSecrets,
    NOT_AVAILABLE: NOT_AVAILABLE
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MythosMissionReport = api;
}(typeof window !== 'undefined' ? window : this));
