'use strict';
// =====================================================
// OTHMODE — MCP trust layer (SKILL-TRUST-0)
// projects/command-center/reference/othmode/trust/mcp.js
//
// A SEPARATE layer from skill trust, sharing the policy engine and the
// decision vocabulary but nothing else. Its evidence is the estate's own
// measurement: projects/mythos-gateway/bin/mcp-registry-check performs a
// real MCP handshake against every registered server and writes the
// snapshot registries.js already joins onto the registry. This module
// reads one server's row plus its registry entry and asks the policy for
// ACCEPT / REVIEW / BLOCK.
//
// What this layer can see today: liveness, protocol errors, unauthorised
// access, declared-vs-discovered tool drift (an undeclared tool appearing
// on a server is the tool-poisoning shape a registry can detect),
// permission-matrix violations and credential hygiene findings. What it
// cannot see: prompt injection INSIDE tool descriptions — the checker
// records tool names, not descriptions. That gap is recorded in
// docs/OTHMODE_SKILL_TRUST.md as the next phase, not papered over here.
// =====================================================

var normalize = require('./normalize.js');
var policyLib = require('./policy.js');

// decideServer(name, registryEntry, measuredRow, snapshotMeta, loadedPolicy, nowMs)
//   → { decision, reasons, evidence }
function decideServer(name, registryEntry, measured, snapshotMeta, loaded, nowMs) {
  var normalised = normalize.fromMcpSnapshot(name, registryEntry, measured, snapshotMeta);
  if (!loaded || !loaded.valid) {
    return { decision: 'BLOCK', reasons: ['trust policy unavailable: ' + (loaded ? loaded.reason : 'not loaded') + ' — fail closed'], evidence: normalised.summary };
  }
  var d = policyLib.decideMcp(normalised, loaded.policy, nowMs);
  return { decision: d.decision, reasons: d.reasons, evidence: normalised.summary, findings: normalised.findings };
}

module.exports = { decideServer: decideServer };
