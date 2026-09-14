// =====================================================
// OTH Knowledge — controlled memory proposal (Phase 16 write path)
// projects/oth-knowledge/lib/propose.js
//
// The ONLY write an AI is allowed: propose a candidate into a STAGING
// store. It never touches canonical truth. The flow is exactly:
//
//   AI → memory_propose → candidate → promotion gate → staging
//        → (operator) promoteRun → OTHKM
//
// proposeMemory() gates the candidate (provenance, secret/PII, namespace,
// temporal, registered class), decides its action against canonical for
// information, and — if it passes and is not a duplicate — writes it to a
// separate staging store tagged `proposed`, recording the suggested
// action. Promotion into canonical remains the existing operator
// two-phase promoteRun(). AI proposes; OTHKM (operator) decides.
// =====================================================
'use strict';

const gateLib = require('./promotion-gate.js');
const decisionLib = require('./extract-decision.js');

// Stage a candidate as a real record in the STAGING store, tagged/annotated
// as proposed. Reuses the single record builder (extract-decision.buildRecord)
// so staging and operator-apply construct records identically.
function stageRecord(stagingStore, classes, candidate, proposed) {
  const augmented = Object.assign({}, candidate, {
    tags: (candidate.tags || []).concat('proposed'),
    metadata: Object.assign({}, candidate.metadata || {}, { proposed }),
  });
  return decisionLib.buildRecord(stagingStore, classes, augmented);
}

// proposeMemory(stagingStore, canonicalStore, candidate, {classes, trustModel})
function proposeMemory(stagingStore, canonicalStore, candidate, opts) {
  const o = opts || {};
  // Callers acting for an AI/conversation pass maxTier:'model-output' so a
  // proposal can never self-declare a higher-authority source class.
  const g = gateLib.gate(candidate, { classes: o.classes, trustModel: o.trustModel, maxTier: o.maxTier });
  if (!g.ok) return { staged: false, rejected: true, reasons: g.reasons };

  const decision = decisionLib.decide(canonicalStore, candidate, o);
  if (decision.action === 'NOOP') {
    return { staged: false, action: 'NOOP', dup_of: decision.dup_of, note: 'already present in canonical memory — nothing to promote' };
  }
  const proposed = {
    action: decision.action,
    supersede_of: decision.supersede_of || null,
    conflict_with: decision.conflict_with || null,
    tier: g.tier,
    proposed_at: o.proposed_at || new Date().toISOString(),
  };
  const rec = stageRecord(stagingStore, o.classes, candidate, proposed);
  return { staged: true, staging_id: rec.id, action: decision.action, tier: g.tier, proposed };
}

module.exports = { proposeMemory };
