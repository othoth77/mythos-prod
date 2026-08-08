// =====================================================
// Mythos Personal Intelligence — Guard Reference
// projects/personal-intelligence/reference/guard.js
//
// Illustrative, dependency-free implementation of the Guard decision model
// in docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md §11 and
// docs/SKILLS_SECURITY.md. Reuses the automation-level vocabulary from
// docs/AUTOMATION_ARCHITECTURE.md §2.
//
// CRITICAL INVARIANT: a learned/explicit user preference may never move a
// decision from a more restrictive outcome to a less restrictive one. This
// module enforces that invariant structurally, not just by convention.
//
// STATUS: reference only. Not wired into the production application.
// Exercised by tests/mpi-0-personal-intelligence-test.js.
// =====================================================
'use strict';

var DECISIONS = ['DENY', 'REQUIRE_APPROVAL', 'DRY_RUN_ONLY', 'READ_ONLY', 'ALLOW'];
// Ordered from most to least restrictive for comparison purposes.
var RESTRICTIVENESS_RANK = { DENY: 0, REQUIRE_APPROVAL: 1, DRY_RUN_ONLY: 2, READ_ONLY: 3, ALLOW: 4 };

// Mirrors docs/AUTOMATION_APPROVAL_MATRIX.md §2. These are deliberately NOT
// the domain-pack draft-preparation capability ids from docs/MYTHOS_DOMAIN_PACKS.md
// §3 (`estimate.prepare`, `invoice.prepare`, `workorder.manage`) — preparing a
// draft is explicitly not a boundary action (see that document's "Approval
// note"). These are the financial-mutation SUB-ACTIONS a future runtime
// capability would need once a draft is actually committed/sent/mutated —
// they have no runtime implementation yet (MPI-0 is documentation-only), so
// they are illustrative future ids, not currently-reachable capabilities.
// Any future capability id ending in .commit / .send / .financial_mutate (or
// added here explicitly) must resolve to at least REQUIRE_APPROVAL.
var PERMANENT_BOUNDARY_CAPABILITIES = [
  'estimate.commit', 'invoice.send', 'workorder.financial_mutate'
];

// Regulated data classifications never resolve below REQUIRE_APPROVAL, even
// when the underlying permission decision was ALLOW — see
// docs/SKILLS_SECURITY.md §5 ("Data Classification").
var REGULATED_DATA_CLASSIFICATIONS = ['regulated', 'financial'];

// -----------------------------------------------------------------------
// evaluate({ permissionDecision, capabilityId, dataClassification,
//            learnedPreferenceRequestsLevel })
//   -> 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL' | 'READ_ONLY' | 'DRY_RUN_ONLY'
//
// permissionDecision: the decision already produced by the existing Mythos
//   role/permission system for this user/organisation/action/resource — this
//   function never re-derives or widens it, only narrows or passes it through.
//
// Note: automation level is validated upstream at GATE_CHECK (see
// docs/AUTOMATION_ARCHITECTURE.md §3) before Guard is ever called — a request
// that would exceed its automation definition's approved level is rejected
// there, not re-checked here. Guard only takes dataClassification, not
// automationLevel, as an input.
// -----------------------------------------------------------------------
function evaluate(input) {
  var base = input.permissionDecision;
  if (DECISIONS.indexOf(base) === -1) {
    throw new Error('[guard] invalid permissionDecision: ' + base);
  }

  var decision = base;

  // Permanent-boundary capabilities are never less restrictive than
  // REQUIRE_APPROVAL, regardless of anything else supplied.
  if (PERMANENT_BOUNDARY_CAPABILITIES.indexOf(input.capabilityId) !== -1) {
    decision = tightest(decision, 'REQUIRE_APPROVAL');
  }

  // Regulated/financial data classification is never less restrictive than
  // REQUIRE_APPROVAL either, independent of the capability's own default level.
  if (input.dataClassification && REGULATED_DATA_CLASSIFICATIONS.indexOf(input.dataClassification) !== -1) {
    decision = tightest(decision, 'REQUIRE_APPROVAL');
  }

  // A learned/explicit preference may only ever narrow the outcome further
  // (e.g. request DRY_RUN_ONLY for personal caution) — it can never widen it.
  if (input.learnedPreferenceRequestsLevel) {
    var requested = input.learnedPreferenceRequestsLevel;
    if (DECISIONS.indexOf(requested) !== -1) {
      decision = tightest(decision, requested);
    }
  }

  return decision;
}

function restrictivenessOf(decision) {
  return RESTRICTIVENESS_RANK[decision];
}

function tightest(a, b) {
  return restrictivenessOf(a) <= restrictivenessOf(b) ? a : b;
}

module.exports = {
  DECISIONS: DECISIONS,
  PERMANENT_BOUNDARY_CAPABILITIES: PERMANENT_BOUNDARY_CAPABILITIES,
  evaluate: evaluate,
  restrictivenessOf: restrictivenessOf
};
