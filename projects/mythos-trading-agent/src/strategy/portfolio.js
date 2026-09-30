'use strict';
// =====================================================
// MYTHOS TRADING AGENT — strategy portfolio
// projects/mythos-trading-agent/src/strategy/portfolio.js
//
// What is switched on for THIS run, at which parameters, and what it needs from
// the data layer. Three responsibilities:
//
//  1. INDICATOR DEDUPLICATION. Six strategies asking for atr(14) get one array.
//     Keys are canonical (src/strategy/base.js key()), so sharing is automatic
//     and a strategy cannot accidentally see a differently-parameterised
//     indicator under a name it recognises.
//
//  2. PER-RUN STATE. Strategies that need memory across bars (breakout-retest,
//     the session opener) get a bag scoped to (run, symbol, strategy). Module-level
//     state would leak between runs and make two runs of one configuration
//     disagree — the reproducibility property everything else rests on.
//
//  3. EVALUATION WITHOUT SUPPRESSION. evaluate() asks EVERY enabled strategy,
//     even ones whose declared preferredRegimes do not include the current
//     regime, and returns all their signals. Regime only affects ORDERING and a
//     recorded `regimeAligned` flag. This is deliberate: mission §5 wants the
//     Research Agent to discover which strategies work in which regime, and a
//     portfolio that silenced off-regime strategies would destroy the evidence
//     needed to find out. Suppression, if it is ever justified, belongs in the
//     Jev gate where it is recorded as a decision.
// =====================================================

var errors = require('../core/errors');
var enums = require('../core/enums');

/**
 * @param {object} spec
 * @param {object} spec.registry
 * @param {string[]} [spec.enabled] strategy ids; defaults to every registered one
 * @param {object} [spec.params] { strategyId: overrides }
 * @param {number} [spec.signalCooldownBars=0] see the cooldown note below
 */
function create(spec) {
  var registry = spec.registry;
  var cooldown = spec.signalCooldownBars === undefined ? 0 : spec.signalCooldownBars;
  var suppressed = 0;
  var enabledIds = spec.enabled ? spec.enabled.slice() : registry.ids();
  enabledIds.forEach(function (id) { registry.get(id); });
  if (enabledIds.length === 0) {
    throw errors.ConfigError('a portfolio with no enabled strategies would produce no candidates; enable at least one');
  }
  var paramOverrides = spec.params || {};
  Object.keys(paramOverrides).forEach(function (id) {
    if (enabledIds.indexOf(id) === -1) {
      throw errors.ConfigError('params supplied for "' + id + '", which is not enabled in this portfolio');
    }
  });

  // Resolve every strategy's parameters once, up front, so a bad override fails
  // before the run starts rather than on bar 4000.
  var resolved = enabledIds.map(function (id) {
    var s = registry.get(id);
    var params = s.params(paramOverrides[id] || {});
    return {
      strategy: s,
      params: params,
      fingerprint: s.fingerprint(paramOverrides[id] || {}),
      warmup: s.warmupBars(params),
      indicators: s.indicators(params),
      higherIndicators: s.higherIndicators(params)
    };
  });

  var state = Object.create(null); // (symbol|strategyId) → bag

  var api = {
    enabled: function () { return enabledIds.slice(); },
    count: function () { return resolved.length; },
    resolved: function () { return resolved.slice(); },

    /** The largest warmup any enabled strategy needs. */
    warmupBars: function () {
      return resolved.reduce(function (m, r) { return Math.max(m, r.warmup); }, 0);
    },

    /** True when any enabled strategy reads the higher timeframe. */
    usesHigherTimeframe: function () {
      return resolved.some(function (r) { return Object.keys(r.higherIndicators).length > 0; });
    },

    /**
     * Registers every needed indicator on the base and higher series.
     * Wired into engine.run({ onSeriesReady }).
     */
    prepareSeries: function (ready) {
      var baseCount = 0, higherCount = 0;
      resolved.forEach(function (r) {
        Object.keys(r.indicators).forEach(function (k) {
          if (!ready.series.hasIndicator(k)) { ready.series.addIndicator(k, r.indicators[k]); baseCount++; }
        });
        if (ready.higherSeries) {
          Object.keys(r.higherIndicators).forEach(function (k) {
            if (!ready.higherSeries.hasIndicator(k)) { ready.higherSeries.addIndicator(k, r.higherIndicators[k]); higherCount++; }
          });
        }
      });
      return { base: baseCount, higher: higherCount };
    },

    /** Clears per-run strategy memory. Called once before a run. */
    resetState: function () { state = Object.create(null); suppressed = 0; },

    /** The state bag for one (symbol, strategy) pair. */
    stateFor: function (symbol, strategyId) {
      var k = symbol + '|' + strategyId;
      if (!state[k]) state[k] = {};
      return state[k];
    },

    /**
     * Asks every enabled strategy for a signal on this bar.
     *
     * @param {object} ctx the engine's decide() context, plus `regime`
     * @returns {object[]} signals, each with its strategy fingerprint attached
     */
    evaluate: function (ctx) {
      var regime = ctx.regime;
      if (regime !== undefined && regime !== null) {
        enums.assertEnum(enums.Regime, regime, 'portfolio.evaluate regime');
      }
      var out = [];
      for (var i = 0; i < resolved.length; i++) {
        var r = resolved[i];
        if (ctx.barIndex < r.warmup) continue;
        var sig;
        try {
          sig = r.strategy.evaluate({
            symbol: ctx.symbol,
            strategyId: r.strategy.strategyId,
            instrument: ctx.instrument,
            view: ctx.view,
            higherView: ctx.higherView,
            higherTimeframe: ctx.higherTimeframe,
            barIndex: ctx.barIndex,
            ts: ctx.ts,
            params: r.params,
            regime: regime,
            state: api.stateFor(ctx.symbol, r.strategy.strategyId),
            config: ctx.config
          });
        } catch (e) {
          // A strategy that throws is a defect in that strategy. Naming it in the
          // error is the difference between a five-minute fix and an afternoon.
          e.message = 'strategy ' + r.strategy.strategyId + ' failed on ' + ctx.symbol +
            ' bar ' + ctx.barIndex + ': ' + e.message;
          throw e;
        }
        if (!sig) continue;

        // THE COOLDOWN. Some strategies are state-based rather than event-based:
        // range-trading fires on every bar price sits in its buy zone, which is
        // not the same as thirty separate opportunities. When a cooldown is
        // configured, a near-duplicate is dropped — and COUNTED, so the number
        // removed is always visible next to the number kept.
        var bag = api.stateFor(ctx.symbol, r.strategy.strategyId);
        if (cooldown > 0 && bag.__lastSignalIndex !== undefined &&
            ctx.barIndex - bag.__lastSignalIndex < cooldown) {
          suppressed++;
          continue;
        }
        bag.__lastSignalIndex = ctx.barIndex;

        out.push({
          signal: sig,
          strategy: r.strategy,
          fingerprint: r.fingerprint,
          regimeAligned: regime ? r.strategy.preferredRegimes.indexOf(regime) !== -1 : null
        });
      }
      return out;
    },

    /** How many signals the cooldown removed, and the setting that removed them. */
    cooldownStats: function () {
      return { signalCooldownBars: cooldown, suppressedSignals: suppressed };
    },

    /**
     * Orders signals for consideration: regime-aligned first, then by the
     * strategy's own confidence. Ordering only decides which candidate is
     * OFFERED first when the single trade slot is free — every signal is still
     * built into a candidate and recorded, so nothing is lost from the evidence.
     */
    prioritise: function (signals) {
      return signals.slice().sort(function (a, b) {
        if (a.regimeAligned !== b.regimeAligned) return a.regimeAligned ? -1 : 1;
        if (b.signal.confidence !== a.signal.confidence) return b.signal.confidence - a.signal.confidence;
        return a.strategy.strategyId < b.strategy.strategyId ? -1 : 1; // stable, deterministic
      });
    },

    /** Records the portfolio's composition into a store. */
    persist: function (store) {
      resolved.forEach(function (r) {
        store.table('strategies').insert({
          strategyId: r.strategy.strategyId,
          family: r.strategy.family,
          name: r.strategy.name,
          version: r.strategy.version,
          preferredRegimes: r.strategy.preferredRegimes.slice(),
          warmupBars: r.warmup,
          usesHigherTimeframe: Object.keys(r.higherIndicators).length > 0
        });
        store.table('strategy_versions').insert({
          strategyId: r.strategy.strategyId,
          version: r.strategy.version,
          paramsHash: r.fingerprint.paramsHash,
          params: r.params
        });
      });
      return resolved.length;
    }
  };

  return api;
}

module.exports = { create: create };
