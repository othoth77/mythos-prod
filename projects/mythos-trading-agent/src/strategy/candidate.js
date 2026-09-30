'use strict';
// =====================================================
// MYTHOS TRADING AGENT — candidate construction
// projects/mythos-trading-agent/src/strategy/candidate.js
//
// Mission §4 lists what every candidate must carry: asset, strategy, timeframe,
// direction, entry, stop, target, risk/reward, regime, spread, estimated cost,
// expected net outcome, timestamp. This module builds exactly that record and
// refuses to produce a partial one.
//
// THE KEY DECISION: COSTS ARE EXPRESSED IN PIPS, NOT MONEY.
//
// A candidate exists BEFORE the Risk Engine has decided a size, so any money
// figure would need a size the candidate does not have. Expressing the cost in
// pips makes every derived quantity size-independent:
//
//   netRewardPips  = rewardPips − costPips
//   netRiskPips    = riskPips + costPips
//   netRewardRisk  = netRewardPips / netRiskPips
//   breakevenWinRate = netRiskPips / (netRewardPips + netRiskPips)
//
// The money figures are still recorded, at a stated `costBasisLots` (the
// instrument minimum), so a reader can see the scale — but nothing decides on
// them, and the field name says what they are relative to.
//
// "EXPECTED NET OUTCOME" NEEDS A WIN PROBABILITY, AND WE DO NOT HAVE ONE. So the
// record carries `breakevenWinRate` — the win rate this trade needs merely to
// break even after costs — as the primary honest figure, plus an `expectedNetPips`
// computed from an explicit `winProbability` whose `winProbabilitySource` is
// recorded. Early in a run that source is 'PRIOR_UNINFORMED' and the expected
// value means very little; once the Analysis Agent has per-strategy statistics it
// becomes 'HISTORICAL'. Recording the source is what stops a prior from being
// mistaken for evidence.
// =====================================================

var enums = require('../core/enums');
var errors = require('../core/errors');
var money = require('../core/money');
var instrumentMod = require('../core/instrument');

/**
 * @param {object} spec
 * @param {string} spec.candidateId
 * @param {number} spec.ts
 * @param {object} spec.instrument
 * @param {string} spec.timeframe
 * @param {object} spec.signal validated strategy signal
 * @param {object} spec.strategyFingerprint { strategyId, version, paramsHash }
 * @param {string} spec.regime
 * @param {number} [spec.regimeConfidence]
 * @param {number} spec.spreadPips
 * @param {object} spec.costModel
 * @param {number} [spec.winProbability=0.5]
 * @param {string} [spec.winProbabilitySource='PRIOR_UNINFORMED']
 * @param {number} [spec.estimatedNights=0]
 */
function build(spec) {
  var inst = spec.instrument;
  var sig = spec.signal;
  enums.assertEnum(enums.Direction, sig.direction, 'candidate.direction');
  enums.assertEnum(enums.Regime, spec.regime, 'candidate.regime');

  var entry = sig.referencePrice;
  var isLong = sig.direction === enums.Direction.LONG;
  var riskPrice = isLong ? entry - sig.stopLoss : sig.stopLoss - entry;
  var rewardPrice = isLong ? sig.takeProfit - entry : entry - sig.takeProfit;
  if (!(riskPrice > 0) || !(rewardPrice > 0)) {
    throw errors.CandidateError(
      'candidate ' + spec.candidateId + ' has an inverted level: entry ' + entry +
      ', stop ' + sig.stopLoss + ', target ' + sig.takeProfit + ' for ' + sig.direction
    );
  }

  var riskPips = instrumentMod.toPips(inst, riskPrice);
  var rewardPips = instrumentMod.toPips(inst, rewardPrice);

  // --- cost, in pips ---------------------------------------------------
  var cm = spec.costModel;
  var slip = cm.config.slippageModel === 'none' ? { entry: 0, exit: 0 }
    : cm.config.slippageModel === 'fixed'
      ? { entry: cm.config.fixedSlippagePips, exit: cm.config.fixedSlippagePips }
      : { entry: inst.slippagePips.mean, exit: inst.slippagePips.mean * 1.6 };
  var nights = spec.estimatedNights || 0;
  var swapPips = 0;
  if (nights > 0 && cm.config.includeSwap) {
    var perLot = isLong ? inst.swapLongPerLotPerDay : inst.swapShortPerLotPerDay;
    var pipValue = instrumentMod.pipValuePerLot(inst, entry);
    swapPips = pipValue > 0 ? (-perLot * nights) / pipValue : 0;
  }
  var costPips = money.round(spec.spreadPips + slip.entry + slip.exit + swapPips, 6);

  var netRewardPips = money.round(rewardPips - costPips, 6);
  var netRiskPips = money.round(riskPips + costPips, 6);
  var breakevenWinRate = (netRewardPips + netRiskPips) > 0
    ? money.round(netRiskPips / (netRewardPips + netRiskPips), 6)
    : null;

  var pWin = spec.winProbability === undefined ? 0.5 : spec.winProbability;
  if (!(pWin >= 0 && pWin <= 1)) {
    throw errors.CandidateError('candidate winProbability must be in [0, 1], got ' + pWin);
  }
  var expectedNetPips = money.round(pWin * netRewardPips - (1 - pWin) * netRiskPips, 6);

  // --- money, at a stated reference size -------------------------------
  var basisLots = inst.minLot;
  var pipMoney = instrumentMod.pipValuePerLot(inst, entry) * basisLots;
  var estimatedCostMoney = money.money(costPips * pipMoney);
  var netIfTargetMoney = money.money(netRewardPips * pipMoney);
  var netIfStopMoney = money.money(-netRiskPips * pipMoney);
  var expectedNetMoney = money.money(expectedNetPips * pipMoney);

  var candidate = {
    candidateId: spec.candidateId,
    ts: spec.ts,
    symbol: inst.symbol,
    strategyId: spec.strategyFingerprint.strategyId,
    strategyVersion: spec.strategyFingerprint.version,
    paramsHash: spec.strategyFingerprint.paramsHash,
    timeframe: spec.timeframe,
    direction: sig.direction,
    entry: entry,
    stopLoss: sig.stopLoss,
    takeProfit: sig.takeProfit,

    riskPips: money.round(riskPips, 4),
    rewardPips: money.round(rewardPips, 4),
    /** Gross reward/risk, before costs — the number a chart shows. */
    rewardRisk: money.round(rewardPips / riskPips, 6),
    /** Reward/risk AFTER costs — the number that decides anything. */
    netRewardRisk: netRiskPips > 0 ? money.round(netRewardPips / netRiskPips, 6) : null,

    regime: spec.regime,
    regimeConfidence: spec.regimeConfidence === undefined ? null : spec.regimeConfidence,

    spreadPips: money.round(spec.spreadPips, 4),
    estimatedSlippagePips: money.round(slip.entry + slip.exit, 4),
    estimatedSwapPips: money.round(swapPips, 4),
    costPips: costPips,
    netRewardPips: netRewardPips,
    netRiskPips: netRiskPips,

    costBasisLots: basisLots,
    estimatedCostMoney: estimatedCostMoney,
    netIfTargetMoney: netIfTargetMoney,
    netIfStopMoney: netIfStopMoney,

    breakevenWinRate: breakevenWinRate,
    winProbability: pWin,
    winProbabilitySource: spec.winProbabilitySource || 'PRIOR_UNINFORMED',
    expectedNetPips: expectedNetPips,
    expectedNetMoney: expectedNetMoney,

    strategyConfidence: sig.confidence,
    reasonCodes: sig.reasonCodes.slice(),
    meta: sig.meta
  };

  return candidate;
}

/**
 * True when the candidate cannot pay for itself: the target is closer than the
 * round-trip cost, so even a perfect entry loses money. This is the cost filter's
 * hard floor and it needs no configuration to be correct.
 */
function isUneconomic(candidate) {
  return candidate.netRewardPips <= 0;
}

/** Reason codes describing why a candidate failed the cost filter. */
function costReasons(candidate, config) {
  var out = [];
  if (candidate.netRewardPips <= 0) out.push('TARGET_INSIDE_COST');
  if (candidate.netRewardRisk !== null && candidate.netRewardRisk < config.risk.minRewardRisk) {
    out.push('NET_REWARD_RISK_BELOW_MIN');
  }
  if (candidate.expectedNetPips <= config.risk.minNetExpectedValue) {
    out.push('EXPECTED_NET_NOT_POSITIVE');
  }
  if (candidate.costPips >= candidate.riskPips) {
    out.push('COST_EXCEEDS_RISK');
  }
  return out;
}

module.exports = {
  build: build,
  isUneconomic: isUneconomic,
  costReasons: costReasons
};
