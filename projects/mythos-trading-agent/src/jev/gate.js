'use strict';
// =====================================================
// MYTHOS TRADING AGENT — the Jev decision gate
// projects/mythos-trading-agent/src/jev/gate.js
//
// Mission §6 is explicit about what Jev is and is not:
//
//   "Jev is NOT a separate trading agent. Jev is a decision gate inside Trading
//    Agent. … Never treat Jev's score as a guarantee. Do not assume a fixed
//    threshold."
//
// So this module has exactly one job: take a structured candidate and return a
// structured verdict — score, confidence, decision, reason codes, risk flags. It
// does not size, it does not execute, and it cannot overrule anything downstream.
// A candidate Jev loves is still subject to the cost filter, the Risk Engine, the
// recovery cap and the one-trade slot, any of which can answer NO_TRADE.
//
// FOUR DESIGN DECISIONS WORTH DEFENDING
//
//  1. THE SCORE IS A WEIGHTED SUM OF NAMED COMPONENTS, AND EVERY COMPONENT IS
//     RETURNED. "Why did Jev reject it?" (mission §17) has to be answerable from
//     the record, so the verdict carries each component's value and weight.
//     A single opaque number would make the gate unauditable, and an unauditable
//     gate in front of a risk system is just a coin flip with a reputation.
//
//  2. SCORE AND CONFIDENCE ARE DIFFERENT THINGS. The score says how good the
//     setup looks. The confidence says how much the inputs are worth. A
//     high-scoring candidate whose regime reading is uncertain and whose strategy
//     has no track record gets a high score and a LOW confidence, and the
//     threshold test requires both. Collapsing them would let a confident-sounding
//     number rest on nothing.
//
//  3. THE THRESHOLD IS CONFIGURATION, NOT A CONSTANT. Mission §6 asks whether
//     70-79 / 80-89 / 90-94 / 95-100 actually differ in win rate, expectancy,
//     losing streak and drawdown. That research is only possible if the threshold
//     is a knob and every candidate's band is recorded — including the ones that
//     were rejected, which is where the counterfactual lives.
//
//  4. SOME CHECKS ARE DELIBERATELY DUPLICATED WITH THE RISK ENGINE. Jev flags a
//     spread above the configured multiple, and so does the Risk Engine. That is
//     defence in depth, not an oversight: Jev's copy explains a rejection in
//     research terms, the Risk Engine's copy is AUTHORITATIVE. If they ever
//     disagree, the Risk Engine wins — see ADR-0002.
// =====================================================

var enums = require('../core/enums');
var errors = require('../core/errors');
var money = require('../core/money');
var instrumentMod = require('../core/instrument');

/** Reason codes explaining what pushed the score up or down. */
var ReasonCode = Object.freeze({
  STRONG_NET_REWARD_RISK: 'STRONG_NET_REWARD_RISK',
  WEAK_NET_REWARD_RISK: 'WEAK_NET_REWARD_RISK',
  COST_EFFICIENT: 'COST_EFFICIENT',
  COST_HEAVY: 'COST_HEAVY',
  REGIME_ALIGNED: 'REGIME_ALIGNED',
  REGIME_MISALIGNED: 'REGIME_MISALIGNED',
  REGIME_UNCERTAIN: 'REGIME_UNCERTAIN',
  STRATEGY_CONVICTION_HIGH: 'STRATEGY_CONVICTION_HIGH',
  STRATEGY_CONVICTION_LOW: 'STRATEGY_CONVICTION_LOW',
  STOP_WELL_PLACED: 'STOP_WELL_PLACED',
  STOP_GEOMETRY_POOR: 'STOP_GEOMETRY_POOR',
  HISTORY_FAVOURABLE: 'HISTORY_FAVOURABLE',
  HISTORY_UNFAVOURABLE: 'HISTORY_UNFAVOURABLE',
  NO_HISTORY: 'NO_HISTORY',
  BELOW_SCORE_THRESHOLD: 'BELOW_SCORE_THRESHOLD',
  BELOW_CONFIDENCE_THRESHOLD: 'BELOW_CONFIDENCE_THRESHOLD',
  HARD_FLAG_PRESENT: 'HARD_FLAG_PRESENT'
});

/**
 * Risk flags. The HARD ones force REJECT regardless of score — they describe a
 * candidate that is not merely unattractive but structurally unsound.
 */
var RiskFlag = Object.freeze({
  NEGATIVE_NET_REWARD: 'NEGATIVE_NET_REWARD',     // hard
  SPREAD_ABOVE_LIMIT: 'SPREAD_ABOVE_LIMIT',       // hard
  STOP_BELOW_MINIMUM: 'STOP_BELOW_MINIMUM',       // hard
  STOP_ABOVE_MAXIMUM: 'STOP_ABOVE_MAXIMUM',       // hard
  REWARD_RISK_BELOW_MINIMUM: 'REWARD_RISK_BELOW_MINIMUM', // hard
  SPREAD_ELEVATED: 'SPREAD_ELEVATED',
  COST_HEAVY: 'COST_HEAVY',
  THIN_SESSION: 'THIN_SESSION',
  OFF_REGIME: 'OFF_REGIME',
  LOW_REGIME_CONFIDENCE: 'LOW_REGIME_CONFIDENCE',
  NO_STRATEGY_HISTORY: 'NO_STRATEGY_HISTORY',
  RECOVERY_ACTIVE: 'RECOVERY_ACTIVE'
});

var HARD_FLAGS = Object.freeze([
  RiskFlag.NEGATIVE_NET_REWARD,
  RiskFlag.SPREAD_ABOVE_LIMIT,
  RiskFlag.STOP_BELOW_MINIMUM,
  RiskFlag.STOP_ABOVE_MAXIMUM,
  RiskFlag.REWARD_RISK_BELOW_MINIMUM
]);

/** Component weights. They must sum to 1, and a test asserts it. */
var WEIGHTS = Object.freeze({
  netRewardRisk: 0.28,
  costEfficiency: 0.18,
  regimeFit: 0.18,
  strategyConviction: 0.12,
  stopGeometry: 0.10,
  history: 0.14
});

function norm(v, lo, hi) {
  if (hi === lo) return 0;
  return money.clamp((v - lo) / (hi - lo), 0, 1);
}

/** Which of the configured bands a score falls in, or null if none. */
function bandOf(score, bands) {
  for (var i = 0; i < bands.length; i++) {
    if (score >= bands[i][0] && score <= bands[i][1]) return bands[i][0] + '-' + bands[i][1];
  }
  return null;
}

/**
 * Creates the gate.
 *
 * @param {object} spec
 * @param {object} spec.config validated platform config
 * @param {object} [spec.priors] historical statistics provider; see priorsFrom()
 * @param {object} [spec.logger]
 */
function create(spec) {
  var config = spec.config;
  var jevCfg = config.jev;
  var priors = spec.priors || emptyPriors();
  var logger = spec.logger || require('../core/logger').nullLogger();
  var model = jevCfg.model;
  if (model !== 'heuristic-v1') {
    throw errors.ConfigError('unknown Jev model "' + model + '"; this build ships "heuristic-v1"');
  }

  /**
   * Evaluates one candidate.
   *
   * @param {object} input
   * @param {object} input.candidate built by src/strategy/candidate.js
   * @param {object} input.instrument
   * @param {boolean} input.regimeAligned strategy's declared preference matched
   * @param {number} [input.atr] current ATR in price units, for stop geometry
   * @param {number} [input.recoveryLevel=0]
   * @param {number} [input.sessionQuality=1] 1 = main session, lower = thin
   * @returns {object} verdict
   */
  function evaluate(input) {
    var c = input.candidate;
    var inst = input.instrument;
    if (!c || !inst) throw errors.CandidateError('jev.evaluate() needs a candidate and its instrument');

    var reasonCodes = [];
    var riskFlags = [];

    // ---- hard structural checks ---------------------------------------
    if (c.netRewardPips <= 0) riskFlags.push(RiskFlag.NEGATIVE_NET_REWARD);
    var spreadLimit = inst.typicalSpreadPips * config.risk.maxSpreadMultiple;
    if (c.spreadPips > spreadLimit) riskFlags.push(RiskFlag.SPREAD_ABOVE_LIMIT);
    else if (c.spreadPips > inst.typicalSpreadPips * 1.5) riskFlags.push(RiskFlag.SPREAD_ELEVATED);
    if (c.riskPips < config.risk.minStopPips) riskFlags.push(RiskFlag.STOP_BELOW_MINIMUM);
    if (c.riskPips > config.risk.maxStopPips) riskFlags.push(RiskFlag.STOP_ABOVE_MAXIMUM);
    if (c.netRewardRisk !== null && c.netRewardRisk < config.risk.minRewardRisk) {
      riskFlags.push(RiskFlag.REWARD_RISK_BELOW_MINIMUM);
    }

    // ---- soft flags ---------------------------------------------------
    var costRatio = c.riskPips > 0 ? c.costPips / c.riskPips : 1;
    if (costRatio > 0.25) riskFlags.push(RiskFlag.COST_HEAVY);
    if (input.sessionQuality !== undefined && input.sessionQuality < 0.6) riskFlags.push(RiskFlag.THIN_SESSION);
    if (input.regimeAligned === false) riskFlags.push(RiskFlag.OFF_REGIME);
    if (c.regimeConfidence !== null && c.regimeConfidence < 0.35) riskFlags.push(RiskFlag.LOW_REGIME_CONFIDENCE);
    if ((input.recoveryLevel || 0) > 0) riskFlags.push(RiskFlag.RECOVERY_ACTIVE);

    // ---- components ---------------------------------------------------
    var prior = priors.lookup({
      strategyId: c.strategyId, symbol: c.symbol, regime: c.regime, direction: c.direction
    });
    if (prior.sampleSize === 0) riskFlags.push(RiskFlag.NO_STRATEGY_HISTORY);

    var components = {
      /** Net reward/risk after costs. 0.5 scores 0, 3.0 scores 1. */
      netRewardRisk: {
        value: norm(c.netRewardRisk === null ? 0 : c.netRewardRisk, 0.5, 3.0),
        weight: WEIGHTS.netRewardRisk,
        raw: c.netRewardRisk
      },
      /** What share of the risk the round trip costs. Lower is better. */
      costEfficiency: {
        value: 1 - norm(costRatio, 0.05, 0.6),
        weight: WEIGHTS.costEfficiency,
        raw: money.round(costRatio, 4)
      },
      /**
       * Regime fit, scaled by how sure the regime engine is. A misaligned
       * strategy scores 0.35 rather than 0, because mission §5 wants the
       * Research Agent to DISCOVER which strategies suit which regime — zeroing
       * off-regime candidates would prevent the evidence ever being collected.
       */
      regimeFit: {
        value: (input.regimeAligned ? 1 : 0.35) *
               (0.5 + 0.5 * (c.regimeConfidence === null ? 0.5 : c.regimeConfidence)),
        weight: WEIGHTS.regimeFit,
        raw: { aligned: !!input.regimeAligned, regimeConfidence: c.regimeConfidence }
      },
      /** The strategy's own stated confidence. Capped by design at source. */
      strategyConviction: {
        value: money.clamp(c.strategyConfidence, 0, 1),
        weight: WEIGHTS.strategyConviction,
        raw: c.strategyConfidence
      },
      /**
       * Stop geometry: a stop between 0.5 and 3 ATRs is sane. Tighter gets
       * stopped by noise; wider makes the minimum lot unaffordable on a $100
       * account long before it makes the trade sensible.
       */
      stopGeometry: {
        value: stopGeometryScore(input.atr, c.riskPips, inst),
        weight: WEIGHTS.stopGeometry,
        raw: input.atr ? money.round(c.riskPips / instrumentMod.toPips(inst, input.atr), 3) : null
      },
      /**
       * Historical performance of this strategy in this regime. Defaults to a
       * NEUTRAL 0.5 with sampleSize 0 — never to an optimistic value, and never
       * silently: NO_STRATEGY_HISTORY is flagged and the confidence drops.
       */
      history: {
        value: prior.score,
        weight: WEIGHTS.history,
        raw: { expectancyR: prior.expectancyR, winRate: prior.winRate, sampleSize: prior.sampleSize }
      }
    };

    var score = 0;
    Object.keys(components).forEach(function (k) {
      score += components[k].value * components[k].weight;
    });
    score = money.round(money.clamp(score * 100, 0, 100), 4);

    // ---- confidence: how much the inputs are worth --------------------
    // Deliberately separate from the score. A beautiful setup read off an
    // uncertain regime by a strategy with no record is a high score on thin
    // evidence, and the threshold test requires both to clear.
    var evidence = [
      c.regimeConfidence === null ? 0.5 : c.regimeConfidence,
      norm(prior.sampleSize, 0, 40),
      1 - norm(c.spreadPips / inst.typicalSpreadPips, 1, config.risk.maxSpreadMultiple),
      input.sessionQuality === undefined ? 1 : money.clamp(input.sessionQuality, 0, 1)
    ];
    var confidence = money.round(money.clamp(mean(evidence), 0, 1), 4);

    // ---- reason codes --------------------------------------------------
    if (components.netRewardRisk.value >= 0.6) reasonCodes.push(ReasonCode.STRONG_NET_REWARD_RISK);
    else if (components.netRewardRisk.value <= 0.25) reasonCodes.push(ReasonCode.WEAK_NET_REWARD_RISK);
    if (components.costEfficiency.value >= 0.7) reasonCodes.push(ReasonCode.COST_EFFICIENT);
    else if (components.costEfficiency.value <= 0.3) reasonCodes.push(ReasonCode.COST_HEAVY);
    reasonCodes.push(input.regimeAligned ? ReasonCode.REGIME_ALIGNED : ReasonCode.REGIME_MISALIGNED);
    if (c.regimeConfidence !== null && c.regimeConfidence < 0.4) reasonCodes.push(ReasonCode.REGIME_UNCERTAIN);
    if (components.strategyConviction.value >= 0.6) reasonCodes.push(ReasonCode.STRATEGY_CONVICTION_HIGH);
    else if (components.strategyConviction.value <= 0.35) reasonCodes.push(ReasonCode.STRATEGY_CONVICTION_LOW);
    if (components.stopGeometry.value >= 0.7) reasonCodes.push(ReasonCode.STOP_WELL_PLACED);
    else if (components.stopGeometry.value <= 0.35) reasonCodes.push(ReasonCode.STOP_GEOMETRY_POOR);
    if (prior.sampleSize === 0) reasonCodes.push(ReasonCode.NO_HISTORY);
    else if (prior.score >= 0.6) reasonCodes.push(ReasonCode.HISTORY_FAVOURABLE);
    else if (prior.score <= 0.4) reasonCodes.push(ReasonCode.HISTORY_UNFAVOURABLE);

    // ---- decision -------------------------------------------------------
    var hard = riskFlags.filter(function (f) { return HARD_FLAGS.indexOf(f) !== -1; });
    var decision = enums.JevDecision.ENTER;
    if (hard.length) {
      decision = enums.JevDecision.REJECT;
      reasonCodes.push(ReasonCode.HARD_FLAG_PRESENT);
    } else {
      if (score < jevCfg.scoreThreshold) {
        decision = enums.JevDecision.REJECT;
        reasonCodes.push(ReasonCode.BELOW_SCORE_THRESHOLD);
      }
      if (confidence < jevCfg.minConfidence) {
        decision = enums.JevDecision.REJECT;
        reasonCodes.push(ReasonCode.BELOW_CONFIDENCE_THRESHOLD);
      }
    }

    var verdict = {
      candidateId: c.candidateId,
      ts: c.ts,
      score: score,
      confidence: confidence,
      decision: decision,
      reasonCodes: reasonCodes,
      riskFlags: riskFlags,
      hardFlags: hard,
      model: model,
      threshold: jevCfg.scoreThreshold,
      minConfidence: jevCfg.minConfidence,
      band: bandOf(score, jevCfg.thresholdBands),
      components: components,
      priorSampleSize: prior.sampleSize
    };

    logger.debug('jev.evaluated', {
      candidateId: c.candidateId, score: score, confidence: confidence,
      decision: decision, flags: riskFlags.length
    });
    return verdict;
  }

  return {
    model: model,
    evaluate: evaluate,
    bandOf: function (score) { return bandOf(score, jevCfg.thresholdBands); },
    weights: WEIGHTS,
    threshold: jevCfg.scoreThreshold,
    minConfidence: jevCfg.minConfidence
  };
}

/**
 * Stop geometry in ATRs. Returns 0.5 (neutral) when no ATR is available, rather
 * than a flattering 1 — an unmeasured component must not add score.
 */
function stopGeometryScore(atr, riskPips, inst) {
  if (!atr || !(atr > 0)) return 0.5;
  var atrPips = instrumentMod.toPips(inst, atr);
  if (!(atrPips > 0)) return 0.5;
  var ratio = riskPips / atrPips;
  if (ratio < 0.5) return money.clamp(ratio / 0.5, 0, 1) * 0.6;      // too tight: noise stops it
  if (ratio > 3) return money.clamp(1 - (ratio - 3) / 4, 0, 1) * 0.6; // too wide: unaffordable
  return 1;
}

function mean(list) {
  var s = 0;
  for (var i = 0; i < list.length; i++) s += list[i];
  return list.length ? s / list.length : 0;
}

/** A priors provider that knows nothing. Neutral score, zero sample size. */
function emptyPriors() {
  return {
    lookup: function () { return { score: 0.5, expectancyR: null, winRate: null, sampleSize: 0 }; }
  };
}

/**
 * Builds a priors provider from closed trades.
 *
 * Lookup is most-specific-first: (strategy, symbol, regime) → (strategy, regime)
 * → (strategy) → nothing. `minSample` guards the obvious trap of concluding
 * anything from four trades; below it the level is skipped rather than used with
 * a caveat nobody reads.
 *
 * @param {object[]} trades
 * @param {object} [opts] { minSample = 12 }
 */
function priorsFrom(trades, opts) {
  var o = opts || {};
  var minSample = o.minSample === undefined ? 12 : o.minSample;
  var buckets = Object.create(null);

  function add(key, t) {
    if (!buckets[key]) buckets[key] = { n: 0, wins: 0, rSum: 0, rCount: 0 };
    var b = buckets[key];
    b.n++;
    if (t.outcome === enums.TradeOutcome.WIN) b.wins++;
    if (typeof t.riskMoney === 'number' && t.riskMoney > 0) {
      b.rSum += t.netPnl / t.riskMoney;
      b.rCount++;
    }
  }

  (trades || []).forEach(function (t) {
    add('s:' + t.strategyId, t);
    add('sr:' + t.strategyId + '|' + t.regime, t);
    add('ssr:' + t.strategyId + '|' + t.symbol + '|' + t.regime, t);
  });

  function summarise(b) {
    if (!b || b.n < minSample) return null;
    var expectancyR = b.rCount ? b.rSum / b.rCount : null;
    var winRate = b.wins / b.n;
    // Map expectancy in R to 0..1 around break-even. -0.5R scores 0, +0.5R
    // scores 1, 0R scores 0.5 — deliberately symmetric, so a losing history
    // subtracts exactly as much as a winning one adds.
    var score = expectancyR === null
      ? money.clamp(winRate, 0, 1)
      : money.clamp(0.5 + expectancyR, 0, 1);
    return { score: score, expectancyR: expectancyR, winRate: winRate, sampleSize: b.n };
  }

  return {
    minSample: minSample,
    lookup: function (q) {
      return summarise(buckets['ssr:' + q.strategyId + '|' + q.symbol + '|' + q.regime]) ||
             summarise(buckets['sr:' + q.strategyId + '|' + q.regime]) ||
             summarise(buckets['s:' + q.strategyId]) ||
             { score: 0.5, expectancyR: null, winRate: null, sampleSize: 0 };
    },
    buckets: function () { return buckets; }
  };
}

module.exports = {
  create: create,
  priorsFrom: priorsFrom,
  emptyPriors: emptyPriors,
  bandOf: bandOf,
  stopGeometryScore: stopGeometryScore,
  ReasonCode: ReasonCode,
  RiskFlag: RiskFlag,
  HARD_FLAGS: HARD_FLAGS,
  WEIGHTS: WEIGHTS
};
