'use strict';
// =====================================================
// OTHMODE — Skill / MCP trust policy engine (SKILL-TRUST-0)
// projects/command-center/reference/othmode/trust/policy.js
//
// Normalised scanner results in (normalize.js), ONE decision out:
//
//   ACCEPT   may be attested and, for a runtime skill, executed
//   REVIEW   recorded, visible, never auto-executed — a human decides
//   BLOCK    never installed, registered as executable, or executed
//
// Deterministic (same inputs → same output, no clock, no I/O), configurable
// (data/skill-trust-policy.json), and bounded by invariants the file
// cannot switch off:
//
//   * a REQUIRED scanner that is missing or failed is never ACCEPT
//     (scanner_failure picks BLOCK or REVIEW — the default is BLOCK)
//   * a result the adapter could not understand is never ACCEPT
//   * SkillSpector DO_NOT_INSTALL is always BLOCK
//   * the MOST RESTRICTIVE applicable rule wins; rules only ever narrow
//
// The engine knows nothing about how a scanner is invoked and nothing
// about ledgers or registries. It is a pure function so that every
// branch below has a test that feeds it a shape and reads a decision.
// =====================================================

var fs = require('fs');
var path = require('path');
var resolve = require('../resolve.js');

var DECISIONS = ['ACCEPT', 'REVIEW', 'BLOCK'];
var DEFAULT_POLICY_PATH = path.join(__dirname, '..', '..', '..', 'data', 'skill-trust-policy.json');

// The policy travels with the repository the read model is pointed at
// (OTHMODE_REPO_ROOT), so a test fixture carries its own; SKILL_TRUST_POLICY
// overrides for an operator experiment.
function defaultPolicyPath() {
  return process.env.SKILL_TRUST_POLICY || resolve.repoPath('projects', 'command-center', 'data', 'skill-trust-policy.json');
}

function rank(d) { return DECISIONS.indexOf(d); }
function narrowest(a, b) { return rank(a) >= rank(b) ? a : b; }
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function isDecision(d) { return DECISIONS.indexOf(d) !== -1; }

// A decision that can never be ACCEPT: used for every "we do not know" path.
function nonAccept(d, fallback) { return (isDecision(d) && d !== 'ACCEPT') ? d : fallback; }

// --- Policy loading (fail closed) ------------------------------------------

function validatePolicyObject(raw) {
  if (!isObj(raw)) return { valid: false, reason: 'policy root is not an object' };
  if (raw.schema_version !== '1.0.0') return { valid: false, reason: 'policy schema_version unsupported: ' + raw.schema_version };
  if (typeof raw.policy_version !== 'string' || !raw.policy_version) return { valid: false, reason: 'policy_version missing' };
  if (!Array.isArray(raw.required_scanners) || !raw.required_scanners.every(function (s) { return typeof s === 'string'; })) {
    return { valid: false, reason: 'required_scanners must be an array of scanner names' };
  }
  if (!isDecision(raw.scanner_failure) || raw.scanner_failure === 'ACCEPT') return { valid: false, reason: 'scanner_failure must be BLOCK or REVIEW' };
  if (!isDecision(raw.unknown_result) || raw.unknown_result === 'ACCEPT') return { valid: false, reason: 'unknown_result must be BLOCK or REVIEW' };
  if (!isObj(raw.skillspector) || !isObj(raw.skillspector.recommendation) || !isObj(raw.skillspector.max_issue_severity)) {
    return { valid: false, reason: 'skillspector section incomplete' };
  }
  if (raw.skillspector.recommendation.DO_NOT_INSTALL !== 'BLOCK') return { valid: false, reason: 'skillspector.recommendation.DO_NOT_INSTALL must be BLOCK' };
  if (!isObj(raw.gitleaks) || !isDecision(raw.gitleaks.any_finding) || raw.gitleaks.any_finding === 'ACCEPT') {
    return { valid: false, reason: 'gitleaks.any_finding must be BLOCK or REVIEW' };
  }
  if (!isObj(raw.skillevaluator) || !isObj(raw.skillevaluator.categories) || !Array.isArray(raw.skillevaluator.checks)) {
    return { valid: false, reason: 'skillevaluator section incomplete' };
  }
  if (!isObj(raw.mcp) || !isObj(raw.mcp.status)) return { valid: false, reason: 'mcp section incomplete' };
  if (!isObj(raw.scan) || !isObj(raw.scan.bins)) return { valid: false, reason: 'scan section incomplete' };
  return { valid: true };
}

function loadPolicy(policyPath) {
  policyPath = policyPath || defaultPolicyPath();
  var raw;
  try { raw = JSON.parse(fs.readFileSync(policyPath, 'utf8')); }
  catch (e) { return { valid: false, reason: 'policy unreadable or not valid JSON: ' + e.message, file: policyPath, policy: null }; }
  var v = validatePolicyObject(raw);
  if (!v.valid) return { valid: false, reason: v.reason, file: policyPath, policy: null };
  return { valid: true, reason: null, file: policyPath, policy: raw };
}

// --- Skill decision ---------------------------------------------------------
//
// decide(results, policy) → { decision, reasons: [], per_scanner: {name: decision} }
// `results` is an array of normalised results (one per scanner that was
// attempted). A required scanner absent from the array is a failure.

function decideSkillspector(r, cfg, reasons) {
  var s = r.summary;
  var rec = String(s.recommendation || '');
  var byRec = cfg.recommendation[rec];
  if (byRec === undefined) { reasons.push('skillspector: unrecognised recommendation "' + rec + '"'); return null; }
  var d = byRec;
  if (rec === 'DO_NOT_INSTALL') d = 'BLOCK'; // invariant, regardless of the file
  var bySev = cfg.max_issue_severity[s.max_issue_severity];
  if (bySev === undefined) { reasons.push('skillspector: unrecognised max_issue_severity "' + s.max_issue_severity + '"'); return null; }
  d = narrowest(d, bySev);
  if (rec === 'CAUTION' && cfg.clean_caution_is_accept === true) {
    var benign = Array.isArray(cfg.benign_partial_reasons) ? cfg.benign_partial_reasons : [];
    var onlyBenign = (s.partial_reasons || []).every(function (x) { return benign.indexOf(x) !== -1; });
    var clean = s.risk_score === 0 && s.issues === 0 && s.max_issue_severity === 'NONE';
    var inspected = (s.uninspected_files === 0 || s.uninspected_files === null) && (s.partially_inspected_files === 0 || s.partially_inspected_files === null);
    if (clean && onlyBenign && inspected && bySev === 'ACCEPT') {
      d = 'ACCEPT';
      reasons.push('skillspector: CAUTION downgraded to ACCEPT — score 0, no issues, partial only for ' + ((s.partial_reasons || []).join(',') || 'nothing'));
    } else if (clean) {
      reasons.push('skillspector: CAUTION kept — partial analysis (' + (s.partial_reasons || []).join(',') + '; uninspected=' + s.uninspected_files + ', partial=' + s.partially_inspected_files + ')');
    }
  }
  if (d !== 'ACCEPT') reasons.push('skillspector: ' + rec + ' score ' + s.risk_score + ' max ' + s.max_issue_severity + ' (' + s.issues + ' issues) → ' + d);
  return d;
}

function decideGitleaks(r, cfg, reasons) {
  if (r.findings.length === 0) return 'ACCEPT';
  var d = cfg.any_finding;
  if (d === 'ACCEPT') d = 'BLOCK';
  reasons.push('gitleaks: ' + r.findings.length + ' credential pattern(s) [' + r.findings.map(function (f) { return f.id; }).join(',') + '] → ' + d);
  return d;
}

function decideSkillevaluator(r, cfg, reasons) {
  var d = 'ACCEPT';
  var inc = r.summary.incomplete_scans || [];
  if (inc.length) {
    var di = nonAccept(cfg.incomplete_scans, 'REVIEW');
    d = narrowest(d, di);
    reasons.push('skillevaluator: incomplete scanner evidence (' + inc.join(',') + ') → ' + di);
  }
  var tally = {};
  r.findings.forEach(function (f) {
    var cat = cfg.categories[f.category];
    if (cat === undefined) {
      // A category the policy never named: unknown → never ACCEPT on its own
      // account, but a single advisory-looking unknown should not block.
      var du = 'REVIEW';
      d = narrowest(d, du);
      tally['unknown:' + f.category] = (tally['unknown:' + f.category] || 0) + 1;
      return;
    }
    var mapped = cat[String(f.severity).toLowerCase()];
    if (mapped === undefined) return; // advisory by configuration
    d = narrowest(d, mapped);
    var key = f.category + '/' + f.severity + '→' + mapped;
    tally[key] = (tally[key] || 0) + 1;
  });
  Object.keys(tally).forEach(function (k) { reasons.push('skillevaluator: ' + k + ' ×' + tally[k]); });
  return d;
}

var SKILL_DECIDERS = { skillspector: decideSkillspector, gitleaks: decideGitleaks, skillevaluator: decideSkillevaluator };

function decide(results, policy) {
  var reasons = [];
  var per = {};
  if (!isObj(policy)) return { decision: 'BLOCK', reasons: ['policy unavailable — fail closed'], per_scanner: per };
  var decision = 'ACCEPT';
  var seen = {};
  (Array.isArray(results) ? results : []).forEach(function (r) {
    if (!isObj(r) || typeof r.scanner !== 'string') return;
    seen[r.scanner] = true;
    var d;
    if (r.status === 'failed') {
      d = nonAccept(policy.scanner_failure, 'BLOCK');
      reasons.push(r.scanner + ': scanner failure (' + r.reason + ') → ' + d);
    } else if (r.status !== 'ok') {
      d = nonAccept(policy.unknown_result, 'REVIEW');
      reasons.push(r.scanner + ': unknown result (' + r.reason + ') → ' + d);
    } else if (SKILL_DECIDERS[r.scanner]) {
      var cfg = policy[r.scanner];
      var got = SKILL_DECIDERS[r.scanner](r, cfg, reasons);
      d = got === null ? nonAccept(policy.unknown_result, 'REVIEW') : got;
    } else {
      d = nonAccept(policy.unknown_result, 'REVIEW');
      reasons.push(r.scanner + ': no policy for this scanner → ' + d);
    }
    per[r.scanner] = d;
    decision = narrowest(decision, d);
  });
  policy.required_scanners.forEach(function (name) {
    if (!seen[name]) {
      var d = nonAccept(policy.scanner_failure, 'BLOCK');
      per[name] = d;
      reasons.push(name + ': required scanner produced no result → ' + d);
      decision = narrowest(decision, d);
    }
  });
  return { decision: decision, reasons: reasons, per_scanner: per };
}

// --- MCP decision -----------------------------------------------------------
//
// decideMcp(normalisedServer, policy, now) — `now` (ms) is injected so the
// staleness rule stays deterministic under test.

function decideMcp(r, policy, nowMs) {
  var reasons = [];
  if (!isObj(policy) || !isObj(policy.mcp)) return { decision: 'BLOCK', reasons: ['policy unavailable — fail closed'] };
  var cfg = policy.mcp;
  var s = r.summary || {};
  var decision = 'ACCEPT';
  if (s.enabled === false) {
    var dd = nonAccept(cfg.disabled_server, 'REVIEW');
    reasons.push('server disabled in the registry → ' + dd);
    decision = narrowest(decision, dd);
  }
  if (r.status !== 'ok') {
    var da = nonAccept(cfg.snapshot_absent, 'REVIEW');
    reasons.push('no measurement (' + r.reason + ') → ' + da);
    return { decision: narrowest(decision, da), reasons: reasons };
  }
  var byStatus = cfg.status[s.measured_status];
  if (byStatus === undefined) {
    reasons.push('unrecognised measured status "' + s.measured_status + '" → REVIEW');
    decision = narrowest(decision, 'REVIEW');
  } else {
    if (byStatus !== 'ACCEPT') reasons.push('measured ' + s.measured_status + ' → ' + byStatus);
    decision = narrowest(decision, byStatus);
  }
  if (typeof cfg.snapshot_max_age_hours === 'number' && s.checked_at) {
    var age = (typeof nowMs === 'number' ? nowMs : Date.now()) - Date.parse(s.checked_at);
    if (!(age <= cfg.snapshot_max_age_hours * 3600000)) {
      var ds = nonAccept(cfg.snapshot_stale, 'REVIEW');
      reasons.push('measurement older than ' + cfg.snapshot_max_age_hours + 'h → ' + ds);
      decision = narrowest(decision, ds);
    }
  }
  if (s.credential_findings > 0) {
    var dc = nonAccept(cfg.credential_findings, 'BLOCK');
    reasons.push(s.credential_findings + ' credential finding(s) → ' + dc);
    decision = narrowest(decision, dc);
  }
  if (s.policy_findings > 0) {
    var dp = nonAccept(cfg.policy_findings, 'REVIEW');
    reasons.push(s.policy_findings + ' permission-matrix finding(s) → ' + dp);
    decision = narrowest(decision, dp);
  }
  if (s.drift_extra > 0) {
    var de = nonAccept(cfg.drift_extra, 'REVIEW');
    reasons.push(s.drift_extra + ' undeclared tool(s) exposed → ' + de);
    decision = narrowest(decision, de);
  }
  if (s.drift_missing > 0) {
    var dm = nonAccept(cfg.drift_missing, 'REVIEW');
    reasons.push(s.drift_missing + ' declared tool(s) absent → ' + dm);
    decision = narrowest(decision, dm);
  }
  return { decision: decision, reasons: reasons };
}

module.exports = {
  DECISIONS: DECISIONS,
  DEFAULT_POLICY_PATH: DEFAULT_POLICY_PATH,
  defaultPolicyPath: defaultPolicyPath,
  narrowest: narrowest,
  validatePolicyObject: validatePolicyObject,
  loadPolicy: loadPolicy,
  decide: decide,
  decideMcp: decideMcp
};
