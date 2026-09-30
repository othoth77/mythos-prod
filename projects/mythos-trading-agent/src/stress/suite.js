'use strict';
// =====================================================
// MYTHOS TRADING AGENT — stress suite
// projects/mythos-trading-agent/src/stress/suite.js
//
// Mission §15's scenarios, and the verdict the Research Agent's compare() and the
// Champion/Challenger promotion gate both consume.
//
// TWO FAMILIES OF SCENARIO, AND THE DIFFERENCE MATTERS
//
//  * TRADE-LEVEL (Monte Carlo, bootstrap, streak arithmetic) reuses the trades a
//    run already produced. Cheap, and limited to "what if these trades had arrived
//    differently".
//
//  * RE-RUN scenarios replay the whole pipeline with something made worse: wider
//    spreads, heavier slippage, added execution delay, perturbed parameters,
//    missing bars, a forced adverse regime. Expensive, and the only kind that can
//    tell you whether the STRATEGY survives — because the strategy gets to react,
//    the Risk Engine gets to intervene, and the recovery ladder gets to respond to
//    the new sequence.
//
// Every scenario is worse than the baseline, never better. A "stress test" that
// included a favourable variation would let a system pass by being lucky in one
// direction, and the point of the exercise is the other direction.
//
// THE VERDICT IS A CONJUNCTION. `survived` is true only when EVERY scenario stayed
// inside the limits. One scenario that blows the drawdown cap fails the suite, even
// if the other seven are fine — because in live trading the scenarios are not
// alternatives, they are things that can all happen.
// =====================================================

var money = require('../core/money');
var errors = require('../core/errors');
var hashMod = require('../core/hash');
var monteCarlo = require('./monte-carlo');

/** The scenarios mission §15 names. */
var Scenario = Object.freeze({
  SPREAD_EXPANSION: 'SPREAD_EXPANSION',
  SLIPPAGE_EXPANSION: 'SLIPPAGE_EXPANSION',
  EXECUTION_DELAY: 'EXECUTION_DELAY',
  PARAMETER_PERTURBATION: 'PARAMETER_PERTURBATION',
  DATA_GAPS: 'DATA_GAPS',
  ADVERSE_REGIME: 'ADVERSE_REGIME',
  INTRABAR_PESSIMISM: 'INTRABAR_PESSIMISM',
  MONTE_CARLO_REORDER: 'MONTE_CARLO_REORDER',
  BLOCK_BOOTSTRAP: 'BLOCK_BOOTSTRAP',
  BOOTSTRAP: 'BOOTSTRAP',
  STREAK_ARITHMETIC: 'STREAK_ARITHMETIC'
});

/**
 * Default severities. Each is a DOCUMENTED ESTIMATE of a bad-but-not-absurd
 * condition, not a measurement. They are configuration so a reviewer can argue
 * with them, which is the only way a number like "spreads triple" gets better.
 */
var DEFAULT_SEVERITIES = Object.freeze({
  spreadMultiple: 3,
  slippageMultiple: 3,
  executionDelayBars: 3,
  parameterPerturbationPct: 20,
  dataGapFraction: 0.05,
  monteCarloReplications: 1000,
  blockSize: 5
});

/**
 * Creates the suite.
 *
 * @param {object} spec
 * @param {object} spec.config the baseline configuration
 * @param {function} spec.runVariant (configOverride, label, opts) => { metrics, trades, ... }
 *        Supplied by the caller so this module never constructs an engine or a
 *        data source of its own — it perturbs inputs and reads results.
 * @param {object} [spec.severities]
 * @param {object} [spec.limits] pass/fail thresholds; defaults derive from config.risk
 * @param {string|number} [spec.seed]
 * @param {object} [spec.logger]
 */
function create(spec) {
  var config = spec.config;
  var runVariant = spec.runVariant;
  if (typeof runVariant !== 'function') {
    throw errors.ConfigError('the stress suite needs a runVariant(override, label) function; it does not build engines itself');
  }
  var severities = merge(DEFAULT_SEVERITIES, spec.severities || {}, 'severity');
  var seed = spec.seed === undefined ? 'stress' : spec.seed;
  var logger = spec.logger || require('../core/logger').nullLogger();

  var limits = merge({
    maxDrawdownPct: config.risk.maxDrawdownPct,
    maxConsecutiveLosses: config.risk.maxConsecutiveLosses,
    /** Fraction of the baseline expectancy a scenario must retain. */
    minExpectancyRetention: 0,
    /** Probability of breaching the drawdown limit that is still acceptable. */
    maxDrawdownBreachProbability: 0.05,
    maxRuinProbability: 0
  }, spec.limits || {}, 'limit');

  function merge(defaults, over, what) {
    var out = {};
    Object.keys(defaults).forEach(function (k) { out[k] = defaults[k]; });
    Object.keys(over).forEach(function (k) {
      if (defaults[k] === undefined) throw errors.ConfigError('unknown stress ' + what + ' "' + k + '"');
      out[k] = over[k];
    });
    return Object.freeze(out);
  }

  /** One scenario result, judged against the limits. */
  function judge(name, detail, metrics, baselineMetrics) {
    var failures = [];
    if (metrics) {
      if (metrics.maxDrawdownPct > limits.maxDrawdownPct) {
        failures.push({
          limit: 'maxDrawdownPct', observed: metrics.maxDrawdownPct, allowed: limits.maxDrawdownPct
        });
      }
      if (metrics.maxConsecutiveLosses > limits.maxConsecutiveLosses) {
        failures.push({
          limit: 'maxConsecutiveLosses', observed: metrics.maxConsecutiveLosses, allowed: limits.maxConsecutiveLosses
        });
      }
      if (baselineMetrics && baselineMetrics.expectancy !== null && baselineMetrics.expectancy > 0 &&
          metrics.expectancy !== null) {
        var retention = metrics.expectancy / baselineMetrics.expectancy;
        if (retention < limits.minExpectancyRetention) {
          failures.push({
            limit: 'minExpectancyRetention', observed: money.round(retention, 4),
            allowed: limits.minExpectancyRetention
          });
        }
      }
    }
    return {
      scenario: name,
      passed: failures.length === 0,
      failures: failures,
      detail: detail,
      metrics: metrics ? summary(metrics) : null
    };
  }

  function summary(m) {
    return {
      trades: m.tradeCount,
      netPnl: m.netPnl,
      expectancy: m.expectancy,
      winRate: m.winRate,
      profitFactor: m.profitFactor,
      maxDrawdownPct: m.maxDrawdownPct,
      maxConsecutiveLosses: m.maxConsecutiveLosses,
      totalCosts: m.totalCosts
    };
  }

  // =====================================================================
  // re-run scenarios
  // =====================================================================

  /** Spreads widened by `spreadMultiple`, as a fixed spread. */
  function spreadExpansion(baseline) {
    var typical = averageTypicalSpread();
    var override = {
      cost: { spreadModel: 'fixed', fixedSpreadPips: money.round(typical * severities.spreadMultiple, 4) }
    };
    var res = runVariant(override, 'stress:spread', { scenario: Scenario.SPREAD_EXPANSION });
    return judge(Scenario.SPREAD_EXPANSION, {
      spreadMultiple: severities.spreadMultiple,
      baselineTypicalSpreadPips: money.round(typical, 4),
      appliedSpreadPips: override.cost.fixedSpreadPips,
      note: 'A single fixed spread across instruments is crude — it over-penalises the tight pairs and ' +
        'under-penalises gold. It is the pessimistic direction for the majority of the universe.'
    }, res.metrics, baseline.metrics);
  }

  /** Slippage multiplied, applied to entries and stops alike. */
  function slippageExpansion(baseline) {
    var base = averageSlippage();
    var override = {
      cost: { slippageModel: 'fixed', fixedSlippagePips: money.round(base * severities.slippageMultiple, 4) }
    };
    var res = runVariant(override, 'stress:slippage', { scenario: Scenario.SLIPPAGE_EXPANSION });
    return judge(Scenario.SLIPPAGE_EXPANSION, {
      slippageMultiple: severities.slippageMultiple,
      appliedSlippagePips: override.cost.fixedSlippagePips
    }, res.metrics, baseline.metrics);
  }

  /** Extra bars between the decision and the fill. */
  function executionDelay(baseline) {
    var override = { cost: { executionDelayBars: severities.executionDelayBars } };
    var res = runVariant(override, 'stress:delay', { scenario: Scenario.EXECUTION_DELAY });
    return judge(Scenario.EXECUTION_DELAY, {
      additionalDelayBars: severities.executionDelayBars,
      note: 'On top of the one mandatory bar the engine always applies, so the total is ' +
        (1 + severities.executionDelayBars) + ' bars.'
    }, res.metrics, baseline.metrics);
  }

  /**
   * Risk and gate parameters moved in the ADVERSE direction by the perturbation
   * percentage. Perturbing them in both directions would let a system pass on the
   * favourable half, which is not what a stress test is for.
   */
  function parameterPerturbation(baseline) {
    var pct = severities.parameterPerturbationPct / 100;
    var override = {
      risk: {
        // A tighter risk budget and a stricter reward requirement both reduce
        // opportunity — the direction that hurts.
        maxAccountRiskPerTradePct: money.round(Math.max(0.01, config.risk.maxAccountRiskPerTradePct * (1 - pct)), 4),
        minRewardRisk: money.round(config.risk.minRewardRisk * (1 + pct) + 0.1, 4)
      },
      jev: {
        scoreThreshold: money.round(Math.min(100, config.jev.scoreThreshold * (1 + pct)), 4)
      }
    };
    var res = runVariant(override, 'stress:params', { scenario: Scenario.PARAMETER_PERTURBATION });
    return judge(Scenario.PARAMETER_PERTURBATION, {
      perturbationPct: severities.parameterPerturbationPct,
      applied: override,
      note: 'Perturbed in the ADVERSE direction only. A two-sided perturbation would let a configuration ' +
        'pass on its favourable half.'
    }, res.metrics, baseline.metrics);
  }

  /** A fraction of bars removed, simulating a feed outage. */
  function dataGaps(baseline) {
    var res = runVariant({}, 'stress:gaps', {
      scenario: Scenario.DATA_GAPS,
      dropFraction: severities.dataGapFraction,
      seed: String(seed) + '::gaps'
    });
    return judge(Scenario.DATA_GAPS, {
      dropFraction: severities.dataGapFraction,
      note: 'The caller\'s runVariant is responsible for removing the bars; this scenario passes the fraction ' +
        'and the seed so the removal is reproducible.',
      barsSeen: res.timeline ? res.timeline.bars : null
    }, res.metrics, baseline.metrics);
  }

  /** The pessimistic intrabar policy, if it was not already in force. */
  function intrabarPessimism(baseline) {
    if (config.backtest.allowIntrabarStopAndTarget === 'STOP_FIRST') {
      return {
        scenario: Scenario.INTRABAR_PESSIMISM,
        passed: true,
        failures: [],
        detail: { note: 'the baseline already uses STOP_FIRST, the pessimistic policy; nothing to worsen' },
        metrics: null,
        skipped: true
      };
    }
    var res = runVariant({ backtest: { allowIntrabarStopAndTarget: 'STOP_FIRST' } }, 'stress:intrabar',
      { scenario: Scenario.INTRABAR_PESSIMISM });
    return judge(Scenario.INTRABAR_PESSIMISM, {
      from: config.backtest.allowIntrabarStopAndTarget, to: 'STOP_FIRST'
    }, res.metrics, baseline.metrics);
  }

  /** A run over data forced into an adverse regime, when the caller supports it. */
  function adverseRegime(baseline, regime) {
    var res = runVariant({}, 'stress:regime', {
      scenario: Scenario.ADVERSE_REGIME,
      forcedRegime: regime || 'UNSTABLE',
      seed: String(seed) + '::regime'
    });
    return judge(Scenario.ADVERSE_REGIME, {
      forcedRegime: regime || 'UNSTABLE',
      note: 'Synthetic data forced into one regime for the whole run. Says how the system behaves in a ' +
        'market that never changes character — a condition real markets do not sustain, so read it as a bound.'
    }, res.metrics, baseline.metrics);
  }

  // =====================================================================
  // trade-level scenarios
  // =====================================================================

  function monteCarloScenarios(baseline) {
    var trades = baseline.trades || [];
    var out = [];
    var capital = config.account.initialCapital;
    var ruinEquity = money.money(capital * (1 - config.risk.maxDrawdownPct / 100));
    var recoveryActive = trades.some(function (t) { return (t.recoveryLevel || 0) > 0; });

    if (trades.length < 10) {
      out.push({
        scenario: Scenario.MONTE_CARLO_REORDER, passed: true, skipped: true, failures: [],
        detail: { note: 'only ' + trades.length + ' trades; a resampling distribution from that is noise, not evidence' },
        metrics: null
      });
      return out;
    }
    if (recoveryActive) {
      // Refusing here is the honest answer: the sizes were path-dependent.
      out.push({
        scenario: Scenario.MONTE_CARLO_REORDER, passed: true, skipped: true, failures: [],
        detail: {
          note: 'skipped because trades were taken above base recovery level, so their sizes depended on the ' +
            'order they arrived in; reordering them would describe a system that never existed. The re-run ' +
            'scenarios cover this configuration instead.'
        },
        metrics: null
      });
      return out;
    }

    var reorder = monteCarlo.reorder({
      trades: trades, initialCapital: capital,
      replications: severities.monteCarloReplications,
      seed: String(seed) + '::reorder',
      drawdownLimitPct: limits.maxDrawdownPct,
      ruinEquity: ruinEquity
    });
    out.push(judgeDistribution(Scenario.MONTE_CARLO_REORDER, reorder));

    var block = monteCarlo.blockBootstrap({
      trades: trades, initialCapital: capital,
      replications: severities.monteCarloReplications,
      blockSize: severities.blockSize,
      seed: String(seed) + '::block',
      drawdownLimitPct: limits.maxDrawdownPct,
      ruinEquity: ruinEquity
    });
    out.push(judgeDistribution(Scenario.BLOCK_BOOTSTRAP, block));

    var boot = monteCarlo.bootstrap({
      trades: trades, initialCapital: capital,
      replications: severities.monteCarloReplications,
      seed: String(seed) + '::boot',
      ruinEquity: ruinEquity
    });
    out.push({
      scenario: Scenario.BOOTSTRAP,
      passed: boot.probabilityOfRuin <= limits.maxRuinProbability,
      failures: boot.probabilityOfRuin > limits.maxRuinProbability
        ? [{ limit: 'maxRuinProbability', observed: boot.probabilityOfRuin, allowed: limits.maxRuinProbability }] : [],
      detail: {
        expectancy: boot.expectancy,
        expectancyPositiveAtP5: boot.expectancyPositiveAtP5,
        probabilityOfRuin: boot.probabilityOfRuin,
        caveats: boot.caveats
      },
      metrics: null
    });

    var streak = monteCarlo.streakStress({
      trades: trades, initialCapital: capital, drawdownLimitPct: limits.maxDrawdownPct, maxK: 12
    });
    out.push({
      scenario: Scenario.STREAK_ARITHMETIC,
      // Informational: the arithmetic cannot "fail", it states a survival bound.
      passed: true,
      failures: [],
      detail: {
        averageLossMoney: streak.averageLossMoney,
        worstLossMoney: streak.worstLossMoney,
        observedMaxStreak: streak.observedMaxStreak,
        streakToBreachLimitAtAverage: streak.streakToBreachLimitAtAverage,
        streakToBreachLimitAtWorst: streak.streakToBreachLimitAtWorst,
        note: streak.note
      },
      metrics: null
    });
    return out;
  }

  function judgeDistribution(name, dist) {
    var failures = [];
    if (dist.probabilityOfBreachingDrawdownLimit !== null &&
        dist.probabilityOfBreachingDrawdownLimit > limits.maxDrawdownBreachProbability) {
      failures.push({
        limit: 'maxDrawdownBreachProbability',
        observed: dist.probabilityOfBreachingDrawdownLimit,
        allowed: limits.maxDrawdownBreachProbability
      });
    }
    if (dist.probabilityOfRuin > limits.maxRuinProbability) {
      failures.push({
        limit: 'maxRuinProbability', observed: dist.probabilityOfRuin, allowed: limits.maxRuinProbability
      });
    }
    if (dist.maxConsecutiveLosses.p95 > limits.maxConsecutiveLosses) {
      failures.push({
        limit: 'maxConsecutiveLosses(p95)',
        observed: dist.maxConsecutiveLosses.p95, allowed: limits.maxConsecutiveLosses
      });
    }
    return {
      scenario: name,
      passed: failures.length === 0,
      failures: failures,
      detail: {
        replications: dist.replications,
        blockSize: dist.blockSize,
        finalEquity: dist.finalEquity,
        maxDrawdownPct: dist.maxDrawdownPct,
        maxConsecutiveLosses: dist.maxConsecutiveLosses,
        probabilityOfRuin: dist.probabilityOfRuin,
        probabilityOfBreachingDrawdownLimit: dist.probabilityOfBreachingDrawdownLimit,
        actual: dist.actual,
        actualPercentile: dist.actualPercentile,
        caveats: dist.caveats
      },
      metrics: null
    };
  }

  // =====================================================================
  // the suite
  // =====================================================================

  /**
   * Runs every scenario and returns a single verdict.
   *
   * @param {object} q
   * @param {object} q.baseline { metrics, trades } from the unstressed run
   * @param {string[]} [q.only] restrict to named scenarios
   * @param {boolean} [q.includeAdverseRegime=false] the caller must support it
   */
  function run(q) {
    var baseline = q.baseline;
    if (!baseline || !baseline.metrics) {
      throw errors.ConfigError('the stress suite needs a baseline run with metrics to compare against');
    }
    var wanted = q.only || null;
    function want(name) { return !wanted || wanted.indexOf(name) !== -1; }

    var results = [];
    if (want(Scenario.SPREAD_EXPANSION)) results.push(spreadExpansion(baseline));
    if (want(Scenario.SLIPPAGE_EXPANSION)) results.push(slippageExpansion(baseline));
    if (want(Scenario.EXECUTION_DELAY)) results.push(executionDelay(baseline));
    if (want(Scenario.PARAMETER_PERTURBATION)) results.push(parameterPerturbation(baseline));
    if (want(Scenario.DATA_GAPS)) results.push(dataGaps(baseline));
    if (want(Scenario.INTRABAR_PESSIMISM)) results.push(intrabarPessimism(baseline));
    if (q.includeAdverseRegime && want(Scenario.ADVERSE_REGIME)) {
      results.push(adverseRegime(baseline, q.adverseRegime));
    }
    monteCarloScenarios(baseline).forEach(function (r) { if (want(r.scenario)) results.push(r); });

    var failed = results.filter(function (r) { return !r.passed; });
    var skipped = results.filter(function (r) { return r.skipped; });

    var out = {
      // `survived` is a CONJUNCTION: one blown scenario fails the suite, because in
      // live trading the scenarios are not alternatives.
      survived: failed.length === 0,
      reason: failed.length === 0 ? null
        : failed.map(function (f) {
            return f.scenario + ' (' + f.failures.map(function (x) {
              return x.limit + ' ' + x.observed + ' > ' + x.allowed;
            }).join('; ') + ')';
          }).join(' | '),
      scenarios: results,
      scenariosRun: results.length,
      scenariosFailed: failed.length,
      scenariosSkipped: skipped.length,
      severities: severities,
      limits: limits,
      seed: String(seed),
      baselineConfigHash: config.fingerprint.hash,
      baseline: summary(baseline.metrics),
      /**
       * A suite that skipped its resampling scenarios has not tested sequence
       * risk, and a caller must not read `survived: true` as if it had.
       */
      coverageWarning: skipped.length
        ? skipped.length + ' scenario(s) were skipped; "survived" covers only what actually ran'
        : null,
      fingerprint: hashMod.shortHash({
        config: config.fingerprint.hash, severities: severities, limits: limits, seed: String(seed)
      })
    };
    logger.info('stress.suite', {
      survived: out.survived, run: out.scenariosRun, failed: out.scenariosFailed, skipped: out.scenariosSkipped
    });
    return out;
  }

  /** Records a suite result. */
  function persist(store, backtestId, result) {
    result.scenarios.forEach(function (s) {
      store.table('stress_tests').insert({
        stressId: 'stress-' + result.fingerprint + '-' + s.scenario,
        backtestId: backtestId,
        kind: s.scenario,
        params: { severities: result.severities, limits: result.limits },
        seed: result.seed,
        replications: (s.detail && s.detail.replications) || null,
        summary: { passed: s.passed, failures: s.failures, detail: s.detail, metrics: s.metrics }
      });
    });
    return result.scenarios.length;
  }

  function averageTypicalSpread() {
    var total = 0;
    config.universe.forEach(function (s) { total += config.instrument(s).typicalSpreadPips; });
    return total / config.universe.length;
  }

  function averageSlippage() {
    var total = 0;
    config.universe.forEach(function (s) { total += config.instrument(s).slippagePips.mean; });
    return total / config.universe.length;
  }

  return {
    Scenario: Scenario,
    severities: severities,
    limits: limits,
    run: run,
    persist: persist,
    // Individual scenarios, so a caller can run one cheaply.
    spreadExpansion: spreadExpansion,
    slippageExpansion: slippageExpansion,
    executionDelay: executionDelay,
    parameterPerturbation: parameterPerturbation,
    dataGaps: dataGaps,
    intrabarPessimism: intrabarPessimism,
    adverseRegime: adverseRegime,
    monteCarloScenarios: monteCarloScenarios
  };
}

module.exports = {
  create: create,
  Scenario: Scenario,
  DEFAULT_SEVERITIES: DEFAULT_SEVERITIES
};
