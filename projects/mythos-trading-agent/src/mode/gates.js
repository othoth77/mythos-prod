'use strict';
// =====================================================
// MYTHOS TRADING AGENT — validation gates for mode progression
// projects/mythos-trading-agent/src/mode/gates.js
//
// The owner's lifecycle is backtest → paper → controlled live, with the owner
// approving each step (owner approval §3/§4). This file is the machine-readable
// form of what "ready for the next step" means, so that the claim can be
// checked instead of asserted.
//
// TWO GATES ARE DELIBERATELY UNSATISFIABLE IN THIS BUILD:
//   LIVE_ADAPTER_IMPLEMENTED and EXTERNAL_LEGAL_REVIEW.
// The live execution adapter is a stub that always refuses, and no part of this
// repository can satisfy a legal review of anything. They are listed rather
// than omitted because an absent requirement is one nobody argues about,
// whereas an unsatisfiable listed one makes the block explicit and auditable.
// =====================================================

/** Gate identifiers. Stable strings — they appear in persisted approvals. */
var Gate = Object.freeze({
  UNIT_TESTS_PASS: 'UNIT_TESTS_PASS',
  BACKTEST_REPRODUCIBLE: 'BACKTEST_REPRODUCIBLE',
  COST_MODEL_APPLIED: 'COST_MODEL_APPLIED',
  RISK_LIMITS_ENFORCED: 'RISK_LIMITS_ENFORCED',
  RECOVERY_CAPPED: 'RECOVERY_CAPPED',
  ONE_TRADE_ONLY: 'ONE_TRADE_ONLY',
  AUDIT_TRAIL_COMPLETE: 'AUDIT_TRAIL_COMPLETE',
  OUT_OF_SAMPLE_TESTED: 'OUT_OF_SAMPLE_TESTED',
  WALK_FORWARD_TESTED: 'WALK_FORWARD_TESTED',
  MONTE_CARLO_SURVIVED: 'MONTE_CARLO_SURVIVED',
  STRESS_SUITE_SURVIVED: 'STRESS_SUITE_SURVIVED',
  DRAWDOWN_WITHIN_LIMIT: 'DRAWDOWN_WITHIN_LIMIT',
  LOSING_STREAK_WITHIN_LIMIT: 'LOSING_STREAK_WITHIN_LIMIT',
  POSITIVE_NET_EXPECTANCY: 'POSITIVE_NET_EXPECTANCY',
  PAPER_FORWARD_TESTED: 'PAPER_FORWARD_TESTED',
  CHAMPION_PROMOTION_RECORDED: 'CHAMPION_PROMOTION_RECORDED',
  LIVE_ADAPTER_IMPLEMENTED: 'LIVE_ADAPTER_IMPLEMENTED',
  EXTERNAL_LEGAL_REVIEW: 'EXTERNAL_LEGAL_REVIEW',
  VENUE_COSTS_VERIFIED: 'VENUE_COSTS_VERIFIED',
  OWNER_CAPITAL_DECISION: 'OWNER_CAPITAL_DECISION'
});

/** Gates that no code in this repository can satisfy. */
var UNSATISFIABLE_IN_BUILD = Object.freeze([
  Gate.LIVE_ADAPTER_IMPLEMENTED,
  Gate.EXTERNAL_LEGAL_REVIEW,
  Gate.VENUE_COSTS_VERIFIED
]);

var GATE_DESCRIPTIONS = Object.freeze({
  UNIT_TESTS_PASS: 'The platform test suite passes on the commit being approved.',
  BACKTEST_REPRODUCIBLE: 'Re-running a recorded backtest from its config fingerprint and dataset version reproduces its metrics exactly.',
  COST_MODEL_APPLIED: 'Reported results are net of spread, commission, slippage and swap — no gross figure is presented as profitability.',
  RISK_LIMITS_ENFORCED: 'Every hard limit in config.risk is proven to bind in tests, including against the recovery ladder.',
  RECOVERY_CAPPED: 'Recovery sizing is proven unable to exceed MAX_RECOVERY_LEVEL, max position size or max account risk.',
  ONE_TRADE_ONLY: 'At most one account-level position is open at any simulated instant, proven over a multi-asset run.',
  AUDIT_TRAIL_COMPLETE: 'Every candidate, gate decision, trade and block is persisted with its reason codes.',
  OUT_OF_SAMPLE_TESTED: 'Results hold on a data segment never used for selection or tuning.',
  WALK_FORWARD_TESTED: 'Rolling in-sample/out-of-sample walk-forward completed with per-fold results recorded.',
  MONTE_CARLO_SURVIVED: 'Trade-order randomisation keeps drawdown and streaks inside limits at the agreed confidence level.',
  STRESS_SUITE_SURVIVED: 'Spread expansion, slippage expansion, execution delay, parameter perturbation and data-gap stress all completed within limits.',
  DRAWDOWN_WITHIN_LIMIT: 'Observed maximum drawdown is inside config.risk.maxDrawdownPct across every tested segment.',
  LOSING_STREAK_WITHIN_LIMIT: 'Observed maximum consecutive losses is inside config.risk.maxConsecutiveLosses.',
  POSITIVE_NET_EXPECTANCY: 'Net expectancy per trade is positive after costs, with the sample size stated.',
  PAPER_FORWARD_TESTED: 'A paper run of the agreed duration completed, with its results compared against the backtest expectation.',
  CHAMPION_PROMOTION_RECORDED: 'The configuration being promoted has a champion/challenger promotion record with its comparison evidence.',
  LIVE_ADAPTER_IMPLEMENTED: 'A real venue execution adapter exists and has been reviewed. NOT SATISFIABLE IN THIS BUILD — the live adapter is a stub that always refuses.',
  EXTERNAL_LEGAL_REVIEW: 'Independent legal/regulatory review of operating this system in the intended jurisdiction. NOT SATISFIABLE FROM THIS REPOSITORY.',
  VENUE_COSTS_VERIFIED: 'Spread, commission, swap and slippage figures replaced with the actual venue\'s published values. NOT SATISFIABLE FROM THIS REPOSITORY — the shipped numbers are documented estimates.',
  OWNER_CAPITAL_DECISION: 'The owner has stated the capital at risk for this stage in writing.'
});

/** Gates required for each transition. Downgrades require none (see below). */
var REQUIRED = Object.freeze({
  'BACKTEST->PAPER': Object.freeze([
    Gate.UNIT_TESTS_PASS,
    Gate.BACKTEST_REPRODUCIBLE,
    Gate.COST_MODEL_APPLIED,
    Gate.RISK_LIMITS_ENFORCED,
    Gate.RECOVERY_CAPPED,
    Gate.ONE_TRADE_ONLY,
    Gate.AUDIT_TRAIL_COMPLETE,
    Gate.OUT_OF_SAMPLE_TESTED,
    Gate.DRAWDOWN_WITHIN_LIMIT,
    Gate.LOSING_STREAK_WITHIN_LIMIT
  ]),
  'PAPER->LIVE': Object.freeze([
    Gate.UNIT_TESTS_PASS,
    Gate.BACKTEST_REPRODUCIBLE,
    Gate.COST_MODEL_APPLIED,
    Gate.RISK_LIMITS_ENFORCED,
    Gate.RECOVERY_CAPPED,
    Gate.ONE_TRADE_ONLY,
    Gate.AUDIT_TRAIL_COMPLETE,
    Gate.OUT_OF_SAMPLE_TESTED,
    Gate.WALK_FORWARD_TESTED,
    Gate.MONTE_CARLO_SURVIVED,
    Gate.STRESS_SUITE_SURVIVED,
    Gate.DRAWDOWN_WITHIN_LIMIT,
    Gate.LOSING_STREAK_WITHIN_LIMIT,
    Gate.POSITIVE_NET_EXPECTANCY,
    Gate.PAPER_FORWARD_TESTED,
    Gate.CHAMPION_PROMOTION_RECORDED,
    Gate.VENUE_COSTS_VERIFIED,
    Gate.LIVE_ADAPTER_IMPLEMENTED,
    Gate.EXTERNAL_LEGAL_REVIEW,
    Gate.OWNER_CAPITAL_DECISION
  ])
});

/** Required gate list for a transition key, or null when the key is unknown. */
function requiredFor(fromMode, toMode) {
  var key = fromMode + '->' + toMode;
  return REQUIRED[key] || null;
}

/** Gates in `required` that `claimed` does not cover. */
function missing(required, claimed) {
  var have = {};
  (claimed || []).forEach(function (g) { have[g] = true; });
  return required.filter(function (g) { return !have[g]; });
}

/** True when this gate can never be satisfied by code in this repository. */
function isUnsatisfiable(gate) {
  return UNSATISFIABLE_IN_BUILD.indexOf(gate) !== -1;
}

module.exports = {
  Gate: Gate,
  GATE_DESCRIPTIONS: GATE_DESCRIPTIONS,
  REQUIRED: REQUIRED,
  UNSATISFIABLE_IN_BUILD: UNSATISFIABLE_IN_BUILD,
  requiredFor: requiredFor,
  missing: missing,
  isUnsatisfiable: isUnsatisfiable
};
