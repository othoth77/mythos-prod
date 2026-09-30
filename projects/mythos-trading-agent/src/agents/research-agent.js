'use strict';
// =====================================================
// MYTHOS TRADING AGENT — Agent 3, the Research Agent
// projects/mythos-trading-agent/src/agents/research-agent.js
//
// Mission §12's pipeline, and its hard constraint:
//
//   OBSERVATION → HYPOTHESIS → CHANGE PROPOSAL → BACKTEST → STRESS TEST
//     → DEMO A/B → COMPARE → APPROVE OR REJECT
//
//   "Never modify LIVE rules directly."
//
// SO THIS AGENT PROPOSES AND NOTHING ELSE. `propose()` returns a plain
// configuration OVERRIDE object. It never loads a config, never writes one, and
// has no reference to a live component. Applying a proposal is the
// Champion/Challenger registry's job, under the promotion gates, and reaching PAPER
// or LIVE with it needs the owner's approval record either way. A test asserts the
// absence of any apply/write/promote method.
//
// WHAT MAKES A HYPOTHESIS HERE DIFFERENT FROM AN OPINION
//
// Every hypothesis carries four things, and is refused without them:
//   observation    — the measured fact it came from, with its sample size
//   statement      — what is claimed, in one sentence
//   proposedChange — a config override, so the claim is testable mechanically
//   falsification  — the result that would REFUTE it, stated before the test runs
//
// The last one is the point. A hypothesis whose author has not said what would
// change their mind is not a hypothesis, and after the fact every result can be
// read as confirmation of something.
//
// AND THE VERDICT IS DELIBERATELY HARD TO EARN. Mission §13: "Never promote based
// on one profitable period." compare() therefore requires out-of-sample evidence,
// refuses to look at in-sample improvement alone, and rejects a variant that
// improves expectancy while making drawdown or the losing streak worse — because
// mission §10 makes streak behaviour a primary objective, not a tiebreak.
// =====================================================

var enums = require('../core/enums');
var errors = require('../core/errors');
var money = require('../core/money');
var hashMod = require('../core/hash');

/** Why an observation was made. Stable strings — they are persisted. */
var ObservationKind = Object.freeze({
  STRATEGY_NEGATIVE_EXPECTANCY: 'STRATEGY_NEGATIVE_EXPECTANCY',
  STRATEGY_POSITIVE_EXPECTANCY: 'STRATEGY_POSITIVE_EXPECTANCY',
  JEV_BANDS_ORDERED: 'JEV_BANDS_ORDERED',
  JEV_BANDS_UNORDERED: 'JEV_BANDS_UNORDERED',
  LOSING_STREAK_EXCEEDS_LIMIT: 'LOSING_STREAK_EXCEEDS_LIMIT',
  COSTS_DOMINATE: 'COSTS_DOMINATE',
  SIZE_BLOCK_DOMINATES: 'SIZE_BLOCK_DOMINATES',
  REGIME_UNDERPERFORMS: 'REGIME_UNDERPERFORMS',
  DRAWDOWN_NEAR_LIMIT: 'DRAWDOWN_NEAR_LIMIT',
  ENTRY_RATE_VERY_LOW: 'ENTRY_RATE_VERY_LOW',
  NO_FINDING: 'NO_FINDING'
});

var Verdict = Object.freeze({
  APPROVE_AS_CHALLENGER: 'APPROVE_AS_CHALLENGER',
  REJECT: 'REJECT',
  INCONCLUSIVE: 'INCONCLUSIVE'
});

/** Tolerances for the comparison. Deliberately asymmetric — see compare(). */
var DEFAULT_THRESHOLDS = Object.freeze({
  minOutOfSampleTrades: 30,
  minExpectancyImprovement: 0,       // must be strictly better, not merely equal
  maxDrawdownWorseningPct: 0,        // no worsening tolerated at all
  maxStreakWorsening: 0,             // nor in the losing streak
  minWalkForwardHitRate: 0.5,        // over half the folds must improve
  minDegradation: 0.3                // out-of-sample must retain 30 % of the edge
});

/**
 * @param {object} [spec]
 * @param {number} [spec.minSample=30]
 * @param {object} [spec.thresholds]
 * @param {object} [spec.logger]
 */
function create(spec) {
  var o = spec || {};
  var minSample = o.minSample === undefined ? 30 : o.minSample;
  var thresholds = {};
  Object.keys(DEFAULT_THRESHOLDS).forEach(function (k) { thresholds[k] = DEFAULT_THRESHOLDS[k]; });
  Object.keys(o.thresholds || {}).forEach(function (k) {
    if (DEFAULT_THRESHOLDS[k] === undefined) {
      throw errors.ConfigError('unknown research threshold "' + k + '"');
    }
    thresholds[k] = o.thresholds[k];
  });
  Object.freeze(thresholds);
  var logger = o.logger || require('../core/logger').nullLogger();
  var seq = 0;

  function nextId(prefix) {
    seq++;
    return prefix + '-' + String(seq).padStart(4, '0');
  }

  // =====================================================================
  // 1. OBSERVATION — facts from an Analysis Agent report
  // =====================================================================

  /**
   * Extracts observations from an analysis report. Facts only: each carries the
   * measurement, its sample size, and whether the sample supports acting on it.
   *
   * @param {object} report from src/agents/analysis-agent.js
   * @param {object} config the configuration the report describes (read only)
   */
  function observe(report, config) {
    var out = [];

    // --- strategies with a measurable record -------------------------
    Object.keys(report.byStrategy || {}).forEach(function (id) {
      var g = report.byStrategy[id];
      if (!g.sufficient) return;
      if (g.expectancy !== null && g.expectancy < 0) {
        out.push({
          kind: ObservationKind.STRATEGY_NEGATIVE_EXPECTANCY,
          subject: id,
          measurement: { expectancy: g.expectancy, winRate: g.winRate, netPnl: g.netPnl, profitFactor: g.profitFactor },
          sampleSize: g.sampleSize,
          actionable: true
        });
      } else if (g.expectancy !== null && g.expectancy > 0) {
        out.push({
          kind: ObservationKind.STRATEGY_POSITIVE_EXPECTANCY,
          subject: id,
          measurement: { expectancy: g.expectancy, winRate: g.winRate, netPnl: g.netPnl, profitFactor: g.profitFactor },
          sampleSize: g.sampleSize,
          actionable: true
        });
      }
    });

    // --- the Jev band question (mission §6) ---------------------------
    var jevI = report.jev && report.jev.interpretation;
    if (jevI) {
      if (jevI.conclusion === 'EXPECTANCY_RISES_WITH_SCORE') {
        out.push({
          kind: ObservationKind.JEV_BANDS_ORDERED,
          subject: 'jev.scoreThreshold',
          measurement: { bands: jevI.bands, expectancyByBand: jevI.expectancyByBand, winRateByBand: jevI.winRateByBand },
          sampleSize: (jevI.bands || []).length,
          actionable: true
        });
      } else if (jevI.conclusion === 'NO_MONOTONIC_RELATIONSHIP') {
        out.push({
          kind: ObservationKind.JEV_BANDS_UNORDERED,
          subject: 'jev.scoreThreshold',
          measurement: { bands: jevI.bands, expectancyByBand: jevI.expectancyByBand },
          sampleSize: (jevI.bands || []).length,
          actionable: true
        });
      }
    }

    // --- streaks (mission §10's primary objective) --------------------
    var streaks = report.losingStreaks;
    if (streaks && config && streaks.maxConsecutiveLosses > config.risk.maxConsecutiveLosses) {
      out.push({
        kind: ObservationKind.LOSING_STREAK_EXCEEDS_LIMIT,
        subject: 'risk.maxConsecutiveLosses',
        measurement: {
          observed: streaks.maxConsecutiveLosses,
          configured: config.risk.maxConsecutiveLosses,
          avgLosingStreak: streaks.avgLosingStreak,
          worstStreak: streaks.worstStreak ? {
            length: streaks.worstStreak.length, netPnl: streaks.worstStreak.netPnl,
            strategies: streaks.worstStreak.strategies
          } : null
        },
        sampleSize: report.overview.trades,
        actionable: report.overview.trades >= minSample
      });
    }

    // --- costs -------------------------------------------------------
    if (report.costs && report.costs.costsFlippedTheSign) {
      out.push({
        kind: ObservationKind.COSTS_DOMINATE,
        subject: 'risk.minRewardRisk',
        measurement: {
          grossPnl: report.costs.grossPnl, totalCosts: report.costs.totalCosts,
          netPnl: report.costs.netPnl, componentShare: report.costs.componentShare
        },
        sampleSize: report.costs.trades,
        actionable: report.costs.trades >= minSample
      });
    }

    // --- the account-size constraint ---------------------------------
    var sizeBlocks = (report.risk && report.risk.topReasons || []).filter(function (r) {
      return r.value === 'SIZE_BELOW_MINIMUM';
    })[0];
    if (sizeBlocks && report.risk.assessments > 0) {
      var share = sizeBlocks.count / report.risk.assessments;
      if (share > 0.25) {
        out.push({
          kind: ObservationKind.SIZE_BLOCK_DOMINATES,
          subject: 'risk.maxStopPips',
          measurement: { sizeBlocks: sizeBlocks.count, assessments: report.risk.assessments, share: money.round(share, 4) },
          sampleSize: report.risk.assessments,
          actionable: true
        });
      }
    }

    // --- drawdown pressure -------------------------------------------
    if (report.drawdown && config && report.drawdown.maxDrawdownPct > config.risk.maxDrawdownPct * 0.8) {
      out.push({
        kind: ObservationKind.DRAWDOWN_NEAR_LIMIT,
        subject: 'risk.maxAccountRiskPerTradePct',
        measurement: {
          observed: report.drawdown.maxDrawdownPct,
          configured: config.risk.maxDrawdownPct,
          episodes: report.drawdown.episodesOverOnePercent,
          neverRecovered: report.drawdown.neverRecovered
        },
        sampleSize: report.overview.trades,
        actionable: report.overview.trades >= minSample
      });
    }

    // --- regimes -----------------------------------------------------
    var byRegime = (report.regimes && report.regimes.performanceByRegime) || {};
    var sufficientRegimes = Object.keys(byRegime).filter(function (r) { return byRegime[r].sufficient; });
    if (sufficientRegimes.length >= 2) {
      var worst = sufficientRegimes.slice().sort(function (a, b) {
        return byRegime[a].expectancy - byRegime[b].expectancy;
      })[0];
      if (byRegime[worst].expectancy < 0) {
        out.push({
          kind: ObservationKind.REGIME_UNDERPERFORMS,
          subject: worst,
          measurement: {
            regime: worst, expectancy: byRegime[worst].expectancy,
            winRate: byRegime[worst].winRate,
            comparedRegimes: sufficientRegimes.length
          },
          sampleSize: byRegime[worst].sampleSize,
          actionable: true,
          caveat: 'regime labels carry classification error (COMPLIANCE §3.7); this observation inherits it'
        });
      }
    }

    // --- opportunity -------------------------------------------------
    if (report.funnel && report.funnel.entryRate !== null && report.funnel.entryRate < 0.05) {
      out.push({
        kind: ObservationKind.ENTRY_RATE_VERY_LOW,
        subject: 'pipeline',
        measurement: {
          entryRate: report.funnel.entryRate,
          candidatesBuilt: report.funnel.candidatesBuilt,
          rejectedByStage: report.funnel.rejectedByStage
        },
        sampleSize: report.funnel.candidatesBuilt,
        actionable: true
      });
    }

    if (out.length === 0) {
      out.push({
        kind: ObservationKind.NO_FINDING,
        subject: 'run',
        measurement: { trades: report.overview.trades },
        sampleSize: report.overview.trades,
        actionable: false,
        note: 'nothing in this report clears the sample threshold; that is a finding about the run, not about the system'
      });
    }
    return out;
  }

  // =====================================================================
  // 2. HYPOTHESIS — a claim with a falsification criterion
  // =====================================================================

  /**
   * Turns actionable observations into hypotheses. Each carries a proposed config
   * override and, crucially, what result would REFUTE it.
   *
   * @param {object[]} observations
   * @param {object} config the configuration observed (read only)
   */
  function hypothesise(observations, config) {
    var out = [];
    observations.forEach(function (obs) {
      if (!obs.actionable) return;
      var h = null;

      switch (obs.kind) {
        case ObservationKind.STRATEGY_NEGATIVE_EXPECTANCY:
          h = {
            statement: 'Strategy ' + obs.subject + ' has negative net expectancy after costs on this data; ' +
              'disabling it should improve the portfolio without materially reducing opportunity.',
            proposedChange: { strategy: { disable: [obs.subject] } },
            falsification: 'Out-of-sample net expectancy does not improve, OR the number of trades falls so far ' +
              'that the remaining sample is below ' + thresholds.minOutOfSampleTrades + ' trades.'
          };
          break;

        case ObservationKind.JEV_BANDS_ORDERED:
          var bands = obs.measurement.bands || [];
          var expectancies = obs.measurement.expectancyByBand || [];
          var firstPositive = null;
          for (var i = 0; i < bands.length; i++) {
            if (expectancies[i] > 0) { firstPositive = bands[i]; break; }
          }
          if (firstPositive) {
            var lowBound = parseInt(firstPositive, 10);
            h = {
              statement: 'Jev expectancy rises with score, and the lowest band with positive expectancy is ' +
                firstPositive + '; raising jev.scoreThreshold to ' + lowBound + ' should improve expectancy.',
              proposedChange: { jev: { scoreThreshold: lowBound } },
              falsification: 'Out-of-sample expectancy does not improve at the higher threshold, or the trade ' +
                'count falls below ' + thresholds.minOutOfSampleTrades + ', or the maximum losing streak worsens.'
            };
          }
          break;

        case ObservationKind.JEV_BANDS_UNORDERED:
          h = {
            statement: 'Jev score does not order outcomes monotonically on this data, so the current threshold ' +
              'is not supported by evidence; a LOWER threshold should perform no worse and would trade more.',
            proposedChange: { jev: { scoreThreshold: Math.max(0, config.jev.scoreThreshold - 15) } },
            falsification: 'Out-of-sample expectancy falls, or drawdown or the maximum losing streak worsens. ' +
              'Either would show the threshold IS doing work the band analysis could not see.'
          };
          break;

        case ObservationKind.LOSING_STREAK_EXCEEDS_LIMIT:
          h = {
            statement: 'The observed losing streak (' + obs.measurement.observed + ') exceeded the configured limit (' +
              obs.measurement.configured + '), so the limit is not binding in time; reducing per-trade risk should ' +
              'cut the damage a streak does without changing its length.',
            proposedChange: {
              risk: { maxAccountRiskPerTradePct: money.round(Math.max(0.01, config.risk.maxAccountRiskPerTradePct * 0.6), 4) }
            },
            falsification: 'Out-of-sample drawdown does not improve, or expectancy per trade falls by more than ' +
              'the drawdown improves (a worse return-over-drawdown).'
          };
          break;

        case ObservationKind.COSTS_DOMINATE:
          h = {
            statement: 'Costs turned a positive gross result into a negative net one; requiring a higher net ' +
              'reward/risk should exclude the trades that could never pay for themselves.',
            proposedChange: { risk: { minRewardRisk: money.round(Math.max(config.risk.minRewardRisk, 1) * 1.5, 4) } },
            falsification: 'Out-of-sample net P&L does not improve, or the trade count falls below ' +
              thresholds.minOutOfSampleTrades + '.'
          };
          break;

        case ObservationKind.SIZE_BLOCK_DOMINATES:
          h = {
            statement: (100 * obs.measurement.share).toFixed(0) + ' % of risk assessments were blocked because the ' +
              'minimum lot exceeded the risk budget; capping the stop distance so the minimum lot fits should convert ' +
              'some of those blocks into trades.',
            proposedChange: { risk: { maxStopPips: money.round(Math.max(5, config.risk.maxStopPips * 0.25), 2) } },
            falsification: 'The extra trades have negative out-of-sample expectancy, which would mean the size ' +
              'block was protecting the account rather than costing it opportunity.'
          };
          break;

        case ObservationKind.DRAWDOWN_NEAR_LIMIT:
          h = {
            statement: 'Drawdown reached ' + obs.measurement.observed + ' % against a ' + obs.measurement.configured +
              ' % limit; reducing per-trade risk should keep the account further from the limit.',
            proposedChange: {
              risk: { maxAccountRiskPerTradePct: money.round(Math.max(0.01, config.risk.maxAccountRiskPerTradePct * 0.5), 4) }
            },
            falsification: 'Return over maximum drawdown does not improve — smaller positions that lose just as ' +
              'often are not an improvement, only a slower version of the same outcome.'
          };
          break;

        case ObservationKind.REGIME_UNDERPERFORMS:
          h = {
            statement: 'Trades taken in the ' + obs.measurement.regime + ' regime had negative expectancy; ' +
              'requiring a higher Jev score should filter them more aggressively than a blanket regime ban, ' +
              'which would also destroy the evidence needed to revisit the question.',
            proposedChange: { jev: { minConfidence: money.round(Math.min(0.95, config.jev.minConfidence + 0.15), 4) } },
            falsification: 'Out-of-sample expectancy does not improve, or the trade count falls below ' +
              thresholds.minOutOfSampleTrades + '. Note the regime label itself carries classification error.'
          };
          break;

        case ObservationKind.ENTRY_RATE_VERY_LOW:
          h = {
            statement: 'Only ' + (100 * obs.measurement.entryRate).toFixed(2) + ' % of candidates became orders, so ' +
              'the sample is thin for reasons other than market conditions; relaxing the Jev confidence floor should ' +
              'produce more evidence without weakening any risk limit.',
            proposedChange: { jev: { minConfidence: money.round(Math.max(0, config.jev.minConfidence - 0.1), 4) } },
            falsification: 'The additional trades have negative out-of-sample expectancy, or drawdown worsens.'
          };
          break;

        default:
          h = null;
      }

      if (!h) return;
      out.push(assertHypothesis({
        hypothesisId: nextId('hyp'),
        state: enums.HypothesisState.HYPOTHESIS,
        observation: obs,
        statement: h.statement,
        proposedChange: h.proposedChange,
        falsification: h.falsification,
        baselineConfigHash: config.fingerprint.hash,
        createdAt: null,
        /** Explicitly: a hypothesis is not permission to change anything. */
        authority: 'PROPOSAL_ONLY'
      }));
    });
    return out;
  }

  /** A hypothesis without a falsification criterion is an opinion. Refuse it. */
  function assertHypothesis(h) {
    ['statement', 'proposedChange', 'falsification', 'observation'].forEach(function (f) {
      if (!h[f]) throw errors.ConfigError('a hypothesis needs "' + f + '"; without it the claim is untestable');
    });
    if (typeof h.falsification !== 'string' || h.falsification.length < 20) {
      throw errors.ConfigError(
        'hypothesis ' + h.hypothesisId + ' has no usable falsification criterion. A claim whose author has not ' +
        'said what would change their mind is not a hypothesis — after the fact, every result reads as confirmation.'
      );
    }
    return h;
  }

  // =====================================================================
  // 3. PROPOSAL — a config override, never an applied change
  // =====================================================================

  /**
   * The change proposal. A PLAIN OBJECT. This agent does not load, write or apply
   * a configuration, and the returned object is inert until the Champion/Challenger
   * registry decides to test it.
   */
  function propose(hypothesis) {
    assertHypothesis(hypothesis);
    var proposal = {
      proposalId: nextId('prop'),
      hypothesisId: hypothesis.hypothesisId,
      baselineConfigHash: hypothesis.baselineConfigHash,
      override: hypothesis.proposedChange,
      overrideHash: hashMod.shortHash(hypothesis.proposedChange),
      statement: hypothesis.statement,
      falsification: hypothesis.falsification,
      requiredEvidence: [
        'IN_SAMPLE_BACKTEST',
        'OUT_OF_SAMPLE_BACKTEST',
        'WALK_FORWARD',
        'STRESS_SUITE',
        'COST_MODEL_APPLIED'
      ],
      authority: 'PROPOSAL_ONLY',
      note: 'Inert. Applying this requires the Champion/Challenger promotion gates; reaching PAPER or LIVE ' +
        'additionally requires the owner\'s approval record (src/mode/).'
    };
    logger.info('research.proposal', {
      proposalId: proposal.proposalId, hypothesisId: hypothesis.hypothesisId, override: proposal.overrideHash
    });
    return proposal;
  }

  // =====================================================================
  // 4. COMPARE — the hard part
  // =====================================================================

  /**
   * Compares a variant against a baseline and returns a verdict.
   *
   * @param {object} q
   * @param {object} q.baseline { inSample: {metrics}, outOfSample: {metrics}, walkForward?: {aggregate} }
   * @param {object} q.variant  same shape
   * @param {object} [q.hypothesis]
   * @param {object} [q.stress] stress-suite summary, when one has been run
   */
  function compare(q) {
    var base = q.baseline;
    var vari = q.variant;
    if (!base || !vari) throw errors.ConfigError('compare() needs a baseline and a variant');
    if (!base.outOfSample || !vari.outOfSample) {
      throw errors.ConfigError(
        'compare() requires OUT-OF-SAMPLE results for both sides. In-sample improvement is not evidence, ' +
        'and accepting it would make this agent a machine for manufacturing confirmations.'
      );
    }

    var findings = [];
    var blockers = [];
    var bOut = base.outOfSample.metrics;
    var vOut = vari.outOfSample.metrics;

    // --- sample sufficiency ------------------------------------------
    if (vOut.tradeCount < thresholds.minOutOfSampleTrades) {
      blockers.push({
        code: 'INSUFFICIENT_OUT_OF_SAMPLE_TRADES',
        detail: vOut.tradeCount + ' out-of-sample trades, need ' + thresholds.minOutOfSampleTrades
      });
    }
    if (bOut.tradeCount < thresholds.minOutOfSampleTrades) {
      blockers.push({
        code: 'INSUFFICIENT_BASELINE_TRADES',
        detail: 'the baseline has only ' + bOut.tradeCount + ' out-of-sample trades, so there is nothing solid to beat'
      });
    }

    // --- expectancy ---------------------------------------------------
    var expDelta = (vOut.expectancy === null || bOut.expectancy === null)
      ? null : money.round(vOut.expectancy - bOut.expectancy, 6);
    findings.push({ metric: 'outOfSampleExpectancy', baseline: bOut.expectancy, variant: vOut.expectancy, delta: expDelta });
    if (expDelta === null || expDelta <= thresholds.minExpectancyImprovement) {
      blockers.push({
        code: 'NO_EXPECTANCY_IMPROVEMENT',
        detail: 'out-of-sample expectancy delta ' + expDelta + ' does not exceed ' + thresholds.minExpectancyImprovement
      });
    }

    // --- drawdown, and the streak family (mission §10) ---------------
    var ddDelta = money.round(vOut.maxDrawdownPct - bOut.maxDrawdownPct, 6);
    findings.push({ metric: 'outOfSampleMaxDrawdownPct', baseline: bOut.maxDrawdownPct, variant: vOut.maxDrawdownPct, delta: ddDelta });
    if (ddDelta > thresholds.maxDrawdownWorseningPct) {
      blockers.push({
        code: 'DRAWDOWN_WORSENED',
        detail: 'maximum drawdown rose by ' + ddDelta + ' percentage points; an expectancy gain paid for with ' +
          'deeper drawdown is not an improvement for a $100 account'
      });
    }

    var streakDelta = vOut.maxConsecutiveLosses - bOut.maxConsecutiveLosses;
    findings.push({ metric: 'outOfSampleMaxConsecutiveLosses', baseline: bOut.maxConsecutiveLosses, variant: vOut.maxConsecutiveLosses, delta: streakDelta });
    if (streakDelta > thresholds.maxStreakWorsening) {
      blockers.push({
        code: 'LOSING_STREAK_WORSENED',
        detail: 'the maximum losing streak rose by ' + streakDelta + '; mission §10 makes streak behaviour a ' +
          'primary objective, not a tiebreak'
      });
    }

    // --- in-sample only? ---------------------------------------------
    if (base.inSample && vari.inSample) {
      var inDelta = (vari.inSample.metrics.expectancy === null || base.inSample.metrics.expectancy === null)
        ? null : money.round(vari.inSample.metrics.expectancy - base.inSample.metrics.expectancy, 6);
      findings.push({ metric: 'inSampleExpectancy', baseline: base.inSample.metrics.expectancy, variant: vari.inSample.metrics.expectancy, delta: inDelta });
      if (inDelta !== null && expDelta !== null && inDelta > 0 && expDelta <= 0) {
        blockers.push({
          code: 'IMPROVES_IN_SAMPLE_ONLY',
          detail: 'in-sample expectancy improved by ' + inDelta + ' while out-of-sample did not (' + expDelta +
            '), which is the signature of a fitted change rather than a found one'
        });
      }
    }

    // --- walk-forward consistency ------------------------------------
    if (vari.walkForward) {
      var wf = vari.walkForward.aggregate;
      findings.push({ metric: 'walkForwardHitRate', baseline: base.walkForward ? base.walkForward.aggregate.outOfSampleHitRate : null, variant: wf.outOfSampleHitRate, delta: null });
      findings.push({ metric: 'walkForwardDegradation', baseline: base.walkForward ? base.walkForward.aggregate.degradation : null, variant: wf.degradation, delta: null });
      if (wf.outOfSampleHitRate !== null && wf.outOfSampleHitRate < thresholds.minWalkForwardHitRate) {
        blockers.push({
          code: 'WALK_FORWARD_INCONSISTENT',
          detail: 'only ' + (100 * wf.outOfSampleHitRate).toFixed(0) + ' % of folds were profitable out of sample, ' +
            'need ' + (100 * thresholds.minWalkForwardHitRate) + ' %'
        });
      }
      if (wf.degradation !== null && wf.degradation < thresholds.minDegradation) {
        blockers.push({
          code: 'EXCESSIVE_DEGRADATION',
          detail: 'out-of-sample retained only ' + wf.degradation + ' of the in-sample expectancy'
        });
      }
    } else {
      blockers.push({
        code: 'NO_WALK_FORWARD',
        detail: 'mission §13 forbids promoting on one profitable period; a walk-forward result is required'
      });
    }

    // --- stress -------------------------------------------------------
    if (!q.stress) {
      blockers.push({
        code: 'NO_STRESS_TEST',
        detail: 'the stress suite has not been run against this variant'
      });
    } else if (q.stress.survived === false) {
      blockers.push({ code: 'STRESS_FAILED', detail: q.stress.reason || 'the stress suite reported failure' });
    }

    var verdict = blockers.length === 0 ? Verdict.APPROVE_AS_CHALLENGER : Verdict.REJECT;
    // A variant blocked ONLY by missing evidence is inconclusive, not refuted —
    // the distinction matters, because a rejected hypothesis should not be retried
    // and an untested one should be.
    var evidenceCodes = ['NO_WALK_FORWARD', 'NO_STRESS_TEST', 'INSUFFICIENT_OUT_OF_SAMPLE_TRADES', 'INSUFFICIENT_BASELINE_TRADES'];
    if (blockers.length > 0 && blockers.every(function (b) { return evidenceCodes.indexOf(b.code) !== -1; })) {
      verdict = Verdict.INCONCLUSIVE;
    }

    var result = {
      verdict: verdict,
      hypothesisId: q.hypothesis ? q.hypothesis.hypothesisId : null,
      findings: findings,
      blockers: blockers,
      thresholds: thresholds,
      falsified: verdict === Verdict.REJECT && q.hypothesis ? q.hypothesis.falsification : null,
      authority: 'PROPOSAL_ONLY',
      note: verdict === Verdict.APPROVE_AS_CHALLENGER
        ? 'Approved as a CHALLENGER only. It is not the champion, it is not in PAPER, and it is not live.'
        : 'Not approved. Nothing changes.'
    };
    logger.info('research.comparison', { verdict: verdict, blockers: blockers.length });
    return result;
  }

  /** Persists the research trail. */
  function persist(store, items) {
    (items.hypotheses || []).forEach(function (h) {
      store.table('hypotheses').insert({
        hypothesisId: h.hypothesisId,
        state: h.state,
        observation: h.observation,
        statement: h.statement,
        proposedChange: h.proposedChange,
        falsification: h.falsification,
        baselineConfigHash: h.baselineConfigHash,
        createdAt: h.createdAt
      });
    });
    (items.experiments || []).forEach(function (e) {
      store.table('experiments').insert({
        experimentId: e.experimentId,
        hypothesisId: e.hypothesisId,
        baselineConfigHash: e.baselineConfigHash,
        variantConfigHash: e.variantConfigHash,
        comparison: e.comparison
      });
    });
    return true;
  }

  /** The whole pipeline, as far as it can go without running backtests. */
  function research(q) {
    var observations = observe(q.report, q.config);
    var hypotheses = hypothesise(observations, q.config);
    var proposals = hypotheses.map(propose);
    return {
      agent: 'RESEARCH_AGENT',
      observations: observations,
      hypotheses: hypotheses,
      proposals: proposals,
      actionable: observations.filter(function (ob) { return ob.actionable; }).length,
      authority: 'PROPOSAL_ONLY',
      nextStep: proposals.length
        ? 'Run each proposal as a variant against the baseline, in-sample and out-of-sample, then walk-forward and ' +
          'stress it, then compare(). Nothing may be applied before that.'
        : 'No actionable observation cleared the sample threshold. Collect more data rather than proposing a change.'
    };
  }

  // A proposing agent. No apply, no write, no promote, no config handle.
  return {
    agent: 'RESEARCH_AGENT',
    minSample: minSample,
    thresholds: thresholds,
    observe: observe,
    hypothesise: hypothesise,
    propose: propose,
    compare: compare,
    research: research,
    persist: persist,
    ObservationKind: ObservationKind,
    Verdict: Verdict
  };
}

module.exports = {
  create: create,
  ObservationKind: ObservationKind,
  Verdict: Verdict,
  DEFAULT_THRESHOLDS: DEFAULT_THRESHOLDS
};
