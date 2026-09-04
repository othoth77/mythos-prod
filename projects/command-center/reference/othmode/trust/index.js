'use strict';
// =====================================================
// OTHMODE — trust read model (SKILL-TRUST-0)
// projects/command-center/reference/othmode/trust/index.js
//
// What the registries and the API show. Pure reads: the current subject
// hash is recomputed from disk and verified against the ledger by the
// executor's own verifier, so the UI can never claim a trust the executor
// would not grant. A STALE row here is exactly the row the executor has
// already stopped rendering.
// =====================================================

var path = require('path');
var resolve = require('../resolve.js');
var subjects = require('./subjects.js');
var ledgerMod = require('./ledger.js');
var policyLib = require('./policy.js');
var mcp = require('./mcp.js');

function policyPath() { return policyLib.defaultPolicyPath(); }

function loadLedgers() {
  return { claude: ledgerMod.load('claude'), executor: ledgerMod.load('executor') };
}

// skillTrust(registry, id, ledgers?) → the trust row for one skill
function skillTrust(registry, id, ledgers) {
  ledgers = ledgers || loadLedgers();
  var lib = subjects.executorLib();
  var subj = subjects.subject(registry, id);
  var ledger = ledgers[registry];
  var v = lib.verify(ledger, subj.ok ? { id: id, registry: registry, content_sha256: subj.content_sha256 } : { id: id, registry: registry, content_sha256: null });
  var entry = v.entry || (ledger && ledger.valid ? ledger.skills[id] : null) || null;
  var ss = entry && entry.scanners && entry.scanners.skillspector ? entry.scanners.skillspector : null;
  var row = {
    status: v.status,                 // ACCEPT | REVIEW | BLOCK | UNATTESTED | STALE | LEDGER_INVALID | UNHASHABLE
    trusted: v.trusted,
    executable: registry === 'executor' ? v.trusted : null,
    reason: v.reason,
    decision: entry ? entry.decision : null,
    scanned_at: entry ? entry.scanned_at : null,
    scanned_by: entry ? entry.scanned_by : null,
    policy_version: entry ? entry.policy_version : null,
    content_sha256: subj.ok ? subj.content_sha256 : null,
    attested_sha256: entry ? entry.content_sha256 : null,
    scanners: entry ? Object.keys(entry.scanners || {}).reduce(function (o, k) { o[k] = { version: entry.scanners[k].version, status: entry.scanners[k].status }; return o; }, {}) : {},
    risk_score: ss && ss.summary ? ss.summary.risk_score : null,
    severity: ss && ss.summary ? ss.summary.severity : null,
    recommendation: ss && ss.summary ? ss.summary.recommendation : null,
    findings_total: entry ? entry.findings_total : null,
    ledger: ledger && ledger.valid ? path.relative(resolve.REPO_ROOT, ledger.file) : (ledger ? 'invalid: ' + ledger.reason : null)
  };
  if (!subj.ok) row.subject_error = subj.reason;
  return row;
}

// mcpTrust(name, registryEntry, measured, snapshotMeta) → { decision, reasons, evidence }
function mcpTrust(name, registryEntry, measured, snapshotMeta) {
  var loaded = policyLib.loadPolicy(policyPath());
  return mcp.decideServer(name, registryEntry, measured, snapshotMeta, loaded, Date.now());
}

function policyInfo() {
  var loaded = policyLib.loadPolicy(policyPath());
  return { valid: loaded.valid, reason: loaded.reason, file: path.relative(resolve.REPO_ROOT, loaded.file),
    policy_version: loaded.valid ? loaded.policy.policy_version : null,
    required_scanners: loaded.valid ? loaded.policy.required_scanners : null };
}

function summarise(rows) {
  var counts = {};
  rows.forEach(function (r) { var k = r.trust ? r.trust.status : 'UNATTESTED'; counts[k] = (counts[k] || 0) + 1; });
  return counts;
}

module.exports = {
  policyPath: policyPath,
  loadLedgers: loadLedgers,
  skillTrust: skillTrust,
  mcpTrust: mcpTrust,
  policyInfo: policyInfo,
  summarise: summarise
};
