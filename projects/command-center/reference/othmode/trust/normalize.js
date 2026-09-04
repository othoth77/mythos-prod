'use strict';
// =====================================================
// OTHMODE — scanner result normalisation (SKILL-TRUST-0)
// projects/command-center/reference/othmode/trust/normalize.js
//
// One adapter per reused scanner, each turning that tool's own JSON into
// the ONE internal shape the policy engine reads:
//
//   { scanner, version, status: 'ok'|'failed'|'unknown', summary: {...},
//     findings: [{ id, category, severity, file, line }], reason }
//
// The adapters are the whole of OTHMODE's coupling to the tools. Nothing
// downstream knows a SkillSpector field name, a Gitleaks rule id shape or
// a SkillEvaluator validator title. A tool that changes its contract
// breaks HERE, in one file, with a test.
//
// NO CONTENT IS COPIED. A finding keeps an id, a category, a severity, a
// file and a line. Gitleaks' `Secret` / `Match` / `Line` values and
// SkillEvaluator's `line_content` are dropped on purpose — a trust ledger
// that stored the leaked value would itself be the leak.
//
// Status vocabulary:
//   ok       the tool ran and produced a report this adapter understood
//   failed   the tool did not run, crashed, timed out, or refused the input
//   unknown  the tool ran but the report is unparseable / off-contract
// (policy.js maps `failed` to scanner_failure and `unknown` to unknown_result.)
// =====================================================

var SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'NONE'];

function upper(s) { return String(s || '').toUpperCase(); }
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function normSeverity(s) {
  var u = upper(s);
  return SEVERITIES.indexOf(u) === -1 ? 'UNKNOWN' : u;
}

function failure(scanner, reason, version) {
  return { scanner: scanner, version: version || null, status: 'failed', summary: {}, findings: [], reason: String(reason) };
}

function unknown(scanner, reason, version) {
  return { scanner: scanner, version: version || null, status: 'unknown', summary: {}, findings: [], reason: String(reason) };
}

// --- NVIDIA SkillSpector (`skillspector scan --no-llm --format json`) ------

function fromSkillspector(report) {
  if (!isObj(report)) return unknown('skillspector', 'report is not an object');
  var ra = report.risk_assessment;
  var meta = isObj(report.metadata) ? report.metadata : {};
  var version = typeof meta.skillspector_version === 'string' ? meta.skillspector_version : null;
  if (!isObj(ra)) return unknown('skillspector', 'risk_assessment missing', version);
  if (typeof ra.score !== 'number' || !isFinite(ra.score)) return unknown('skillspector', 'risk_assessment.score is not a number', version);
  if (typeof ra.recommendation !== 'string') return unknown('skillspector', 'risk_assessment.recommendation missing', version);
  if (report.execution_successful === false) return failure('skillspector', 'execution_successful=false', version);

  var completeness = isObj(report.analysis_completeness) ? report.analysis_completeness : {};
  var exceptions = Array.isArray(completeness.ledger_exceptions) ? completeness.ledger_exceptions : [];
  var partialReasons = [];
  exceptions.forEach(function (x) {
    var code = isObj(x) && typeof x.reason_code === 'string' ? x.reason_code : 'unspecified';
    if (partialReasons.indexOf(code) === -1) partialReasons.push(code);
  });

  var issues = Array.isArray(report.issues) ? report.issues : [];
  var findings = issues.map(function (i) {
    var loc = isObj(i) && isObj(i.location) ? i.location : {};
    return {
      id: isObj(i) && typeof i.id === 'string' ? i.id : 'unknown',
      category: isObj(i) && typeof i.category === 'string' ? i.category : 'unknown',
      severity: normSeverity(isObj(i) ? i.severity : null),
      file: typeof loc.file === 'string' ? loc.file : null,
      line: typeof loc.start_line === 'number' ? loc.start_line : null
    };
  });

  return {
    scanner: 'skillspector',
    version: version,
    status: 'ok',
    summary: {
      risk_score: ra.score,
      severity: normSeverity(ra.severity),
      recommendation: upper(ra.recommendation).replace(/\s+/g, '_'),
      max_issue_severity: normSeverity(ra.max_issue_severity || (findings.length ? null : 'NONE')),
      issues: findings.length,
      suppressed: typeof report.suppressed_count === 'number' ? report.suppressed_count : 0,
      llm_requested: meta.llm_requested === true,
      completeness: typeof completeness.status === 'string' ? completeness.status : 'unknown',
      is_complete: completeness.is_complete === true,
      uninspected_files: typeof completeness.entirely_uninspected_files === 'number' ? completeness.entirely_uninspected_files : null,
      partially_inspected_files: typeof completeness.partially_inspected_files === 'number' ? completeness.partially_inspected_files : null,
      partial_reasons: partialReasons,
      has_executable_scripts: meta.has_executable_scripts === true
    },
    findings: findings,
    reason: null
  };
}

// --- Gitleaks (`gitleaks dir <path> --report-format json`) -----------------
// The report is a JSON ARRAY of findings (empty array when clean).

function fromGitleaks(report, version) {
  if (!Array.isArray(report)) return unknown('gitleaks', 'report is not an array', version);
  var findings = report.map(function (f) {
    return {
      id: isObj(f) && typeof f.RuleID === 'string' ? f.RuleID : 'unknown',
      category: 'Secret',
      severity: 'CRITICAL',
      file: isObj(f) && typeof f.File === 'string' ? f.File : null,
      line: isObj(f) && typeof f.StartLine === 'number' ? f.StartLine : null,
      fingerprint: isObj(f) && typeof f.Fingerprint === 'string' ? f.Fingerprint : null
    };
  });
  return { scanner: 'gitleaks', version: version || null, status: 'ok',
    summary: { findings: findings.length }, findings: findings, reason: null };
}

// --- NVIDIA SkillEvaluator Tier 1 (`skillevaluator validate -r json`) -----

function fromSkillevaluator(report, version) {
  if (!isObj(report)) return unknown('skillevaluator', 'report is not an object', version);
  if (typeof report.overall_status !== 'string') return unknown('skillevaluator', 'overall_status missing', version);
  if (!Array.isArray(report.results)) return unknown('skillevaluator', 'results missing', version);
  var incomplete = Array.isArray(report.incomplete_scans) ? report.incomplete_scans.slice() : [];
  var checks = {};
  var findings = [];
  report.results.forEach(function (r) {
    if (!isObj(r)) return;
    var name = typeof r.validator === 'string' ? r.validator : 'unknown';
    checks[name] = { status: typeof r.status === 'string' ? r.status : 'unknown',
      findings: Array.isArray(r.findings) ? r.findings.length : 0,
      incomplete: Array.isArray(r.incomplete_scans) ? r.incomplete_scans : [] };
    (Array.isArray(r.incomplete_scans) ? r.incomplete_scans : []).forEach(function (s) { if (incomplete.indexOf(s) === -1) incomplete.push(s); });
    (Array.isArray(r.findings) ? r.findings : []).forEach(function (f) {
      if (!isObj(f)) return;
      findings.push({
        id: typeof f.check_name === 'string' ? f.check_name : 'unknown',
        category: upper(f.category || 'unknown'),
        severity: normSeverity(f.severity),
        file: typeof f.file_path === 'string' ? f.file_path.replace(/^.*\//, '') : null,
        line: typeof f.line_number === 'number' ? f.line_number : null
      });
    });
  });
  return {
    scanner: 'skillevaluator',
    version: version || null,
    status: 'ok',
    summary: { overall_status: report.overall_status, incomplete_scans: incomplete, checks: checks, findings: findings.length },
    findings: findings,
    reason: null
  };
}

// --- Gateway mcp-registry-check snapshot (one server) ----------------------
// Not a scanner adapter in the strict sense: the snapshot is already a
// measurement the estate produces (bin/mcp-registry-check). This shapes one
// server's row into the same vocabulary so the MCP policy reads one thing.

function fromMcpSnapshot(name, registryEntry, measured, snapshotMeta) {
  var m = isObj(measured) ? measured : null;
  var findings = [];
  if (m) {
    (Array.isArray(m.policy_findings) ? m.policy_findings : []).forEach(function (f) {
      findings.push({ id: 'policy', category: 'MCP_POLICY', severity: 'MEDIUM', file: null, line: null, detail: String(f).slice(0, 200) });
    });
    (Array.isArray(m.credential_findings) ? m.credential_findings : []).forEach(function (f) {
      findings.push({ id: 'credential', category: 'MCP_CREDENTIAL', severity: 'HIGH', file: null, line: null, detail: String(f).slice(0, 200) });
    });
    var drift = isObj(m.drift) ? m.drift : {};
    (Array.isArray(drift.extra) ? drift.extra : []).forEach(function (t) {
      findings.push({ id: 'drift_extra', category: 'MCP_DRIFT', severity: 'MEDIUM', file: null, line: null, detail: 'undeclared tool exposed: ' + t });
    });
    (Array.isArray(drift.missing) ? drift.missing : []).forEach(function (t) {
      findings.push({ id: 'drift_missing', category: 'MCP_DRIFT', severity: 'LOW', file: null, line: null, detail: 'declared tool absent: ' + t });
    });
  }
  return {
    scanner: 'mcp-registry-check',
    version: snapshotMeta && typeof snapshotMeta.checker_version === 'string' ? snapshotMeta.checker_version : null,
    status: m ? 'ok' : 'failed',
    summary: {
      server: name,
      enabled: !!(registryEntry && registryEntry.enabled),
      measured_status: m ? upper(m.status) : null,
      reachable: m ? m.reachable === true : null,
      checked_at: m && typeof m.checked_at === 'string' ? m.checked_at : (snapshotMeta && snapshotMeta.generated_at) || null,
      policy_findings: m ? (m.policy_findings || []).length : null,
      credential_findings: m ? (m.credential_findings || []).length : null,
      drift_extra: m && isObj(m.drift) ? (m.drift.extra || []).length : null,
      drift_missing: m && isObj(m.drift) ? (m.drift.missing || []).length : null
    },
    findings: findings,
    reason: m ? null : 'no measurement for ' + name + ' in the snapshot'
  };
}

module.exports = {
  SEVERITIES: SEVERITIES,
  failure: failure,
  unknown: unknown,
  fromSkillspector: fromSkillspector,
  fromGitleaks: fromGitleaks,
  fromSkillevaluator: fromSkillevaluator,
  fromMcpSnapshot: fromMcpSnapshot
};
