'use strict';
// =====================================================
// MYTHOS TRADING AGENT — strategy interface
// projects/mythos-trading-agent/src/strategy/base.js
//
// Mission §4: "Implement an extensible strategy interface … Do not assume any
// strategy is profitable. Every strategy must be independently measurable."
//
// The interface is shaped by what a strategy is NOT allowed to do, because those
// exclusions are what make the measurement trustworthy:
//
//  * A STRATEGY DOES NOT SIZE POSITIONS. It returns a direction and protective
//    levels. Size is the Risk Engine's, and only the Risk Engine's (ADR-0002).
//    There is no `lots` field in a signal, so a strategy cannot express a view
//    about size even by accident.
//  * A STRATEGY DOES NOT SEE THE FUTURE. It receives a view (src/data/series.js)
//    whose offsets only run backwards, and indicators it DECLARES rather than
//    computes, so every value it reads has been through the causality test in
//    tests/indicators-test.js.
//  * A STRATEGY DOES NOT DECIDE WHETHER TO TRADE. It proposes. The Jev gate, the
//    cost filter, the Risk Engine, the recovery engine and the one-trade slot all
//    sit between a signal and an order, and each can answer NO_TRADE.
//  * A STRATEGY DECLARES ITS OWN WARMUP. An indicator read before its warmup
//    returns null, and a strategy that ignores that would emit signals based on
//    nothing. warmupBars() is checked against the declared indicators so the
//    number cannot quietly fall behind the parameters.
//
// Every strategy also declares `preferredRegimes`, which is a HYPOTHESIS and not
// a fact. Phase 11's Research Agent exists to test whether a strategy actually
// performs better in the regimes it claims to like; until then the field only
// influences prioritisation and never suppresses measurement.
// =====================================================

var enums = require('../core/enums');
var errors = require('../core/errors');
var hashMod = require('../core/hash');

var REQUIRED = ['strategyId', 'family', 'name', 'version', 'defaultParams', 'paramSpace', 'indicators', 'warmupBars', 'evaluate'];

/** Canonical indicator key, so two strategies asking for ema(20) share one array. */
function key() {
  var parts = Array.prototype.slice.call(arguments).map(function (a) {
    return typeof a === 'number' ? String(a) : String(a).replace(/[^A-Za-z0-9]+/g, '');
  });
  return parts.join('_');
}

/**
 * Validates and freezes a strategy definition.
 *
 * @param {object} spec
 * @param {string} spec.strategyId stable, unique, kebab-case
 * @param {string} spec.family one of the mission §4 families
 * @param {string} spec.name human-readable
 * @param {number} spec.version bump when behaviour changes
 * @param {object} spec.defaultParams
 * @param {object} spec.paramSpace { param: {min, max, step} } — the Research
 *        Agent's search space, and the bounds the parameters are validated against
 * @param {function} spec.indicators (params) => { key: (series) => array }
 * @param {function} spec.warmupBars (params) => number
 * @param {string[]} [spec.preferredRegimes] a hypothesis, never a filter
 * @param {function} spec.evaluate (ctx) => signal | null
 */
function define(spec) {
  REQUIRED.forEach(function (f) {
    if (spec[f] === undefined) {
      throw errors.ConfigError('strategy ' + (spec.strategyId || '?') + ' is missing "' + f + '"');
    }
  });
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(spec.strategyId)) {
    throw errors.ConfigError('strategyId must be kebab-case, got ' + JSON.stringify(spec.strategyId));
  }
  if (typeof spec.evaluate !== 'function') throw errors.ConfigError(spec.strategyId + ': evaluate must be a function');
  if (typeof spec.indicators !== 'function') throw errors.ConfigError(spec.strategyId + ': indicators must be a function');
  if (typeof spec.warmupBars !== 'function') throw errors.ConfigError(spec.strategyId + ': warmupBars must be a function');
  (spec.preferredRegimes || []).forEach(function (r) {
    enums.assertEnum(enums.Regime, r, spec.strategyId + '.preferredRegimes');
  });

  // Every default must sit inside its declared search space, or the search space
  // is describing a different strategy from the one that runs.
  Object.keys(spec.paramSpace).forEach(function (p) {
    if (spec.defaultParams[p] === undefined) {
      throw errors.ConfigError(spec.strategyId + ': paramSpace declares "' + p + '" but defaultParams does not');
    }
    var range = spec.paramSpace[p];
    var v = spec.defaultParams[p];
    if (typeof v === 'number' && (v < range.min || v > range.max)) {
      throw errors.ConfigError(spec.strategyId + ': default ' + p + '=' + v + ' is outside its paramSpace [' + range.min + ', ' + range.max + ']');
    }
  });
  Object.keys(spec.defaultParams).forEach(function (p) {
    if (spec.paramSpace[p] === undefined) {
      throw errors.ConfigError(spec.strategyId + ': defaultParams has "' + p + '" with no paramSpace entry; an unsearchable parameter is an undocumented one');
    }
  });

  var api = {
    strategyId: spec.strategyId,
    family: spec.family,
    name: spec.name,
    version: spec.version,
    description: spec.description || '',
    defaultParams: Object.freeze(shallow(spec.defaultParams)),
    paramSpace: Object.freeze(spec.paramSpace),
    preferredRegimes: Object.freeze((spec.preferredRegimes || []).slice()),

    /** Merges overrides onto the defaults and validates every bound. */
    params: function (overrides) {
      var p = shallow(spec.defaultParams);
      Object.keys(overrides || {}).forEach(function (k) {
        if (p[k] === undefined) {
          throw errors.ConfigError(spec.strategyId + ': unknown parameter "' + k + '" (known: ' + Object.keys(p).join(', ') + ')');
        }
        p[k] = overrides[k];
      });
      Object.keys(spec.paramSpace).forEach(function (k) {
        var r = spec.paramSpace[k];
        var v = p[k];
        if (typeof v === 'number' && (v < r.min || v > r.max)) {
          throw errors.ConfigError(spec.strategyId + ': ' + k + '=' + v + ' is outside [' + r.min + ', ' + r.max + ']');
        }
      });
      return Object.freeze(p);
    },

    indicators: function (params) { return spec.indicators(params || api.defaultParams); },
    /**
     * Indicators the strategy needs on the HIGHER timeframe series. Separate from
     * indicators() because the two series have different lengths and different
     * bars; registering an H4 EMA on the M15 array would silently compute
     * something that looks plausible and means nothing.
     */
    higherIndicators: function (params) {
      return spec.higherIndicators ? spec.higherIndicators(params || api.defaultParams) : {};
    },
    usesHigherTimeframe: !!spec.higherIndicators,
    warmupBars: function (params) { return spec.warmupBars(params || api.defaultParams); },

    /**
     * Evaluates one bar. Returns a signal or null.
     * Wrapped so a malformed signal fails at the strategy that produced it.
     */
    evaluate: function (ctx) {
      var sig = spec.evaluate(ctx);
      if (sig === null || sig === undefined) return null;
      return validateSignal(sig, spec.strategyId, ctx);
    },

    /** Identity of this strategy at these parameters — the version a result cites. */
    fingerprint: function (params) {
      var p = api.params(params);
      return {
        strategyId: spec.strategyId,
        version: spec.version,
        paramsHash: hashMod.shortHash(p),
        params: p
      };
    }
  };
  return Object.freeze(api);
}

/**
 * A signal must be internally coherent BEFORE anything downstream trusts it.
 * The stop must be on the losing side of the entry and the target on the winning
 * side — a strategy that swaps them would otherwise produce a "trade" whose risk
 * and reward are inverted, and the Risk Engine's arithmetic would be meaningless.
 */
function validateSignal(sig, strategyId, ctx) {
  enums.assertEnum(enums.Direction, sig.direction, strategyId + '.signal.direction');
  if (sig.direction === enums.Direction.NEUTRAL) {
    throw errors.CandidateError(strategyId + ': a signal cannot be NEUTRAL — return null instead');
  }
  ['stopLoss', 'takeProfit'].forEach(function (f) {
    if (typeof sig[f] !== 'number' || !isFinite(sig[f]) || sig[f] <= 0) {
      throw errors.CandidateError(strategyId + ': signal.' + f + ' must be a positive finite price, got ' + JSON.stringify(sig[f]));
    }
  });
  if (sig.lots !== undefined || sig.size !== undefined) {
    throw errors.CandidateError(
      strategyId + ': a signal must not carry a size. Position sizing belongs to the Risk Engine alone (ADR-0002).'
    );
  }
  var ref = sig.referencePrice === undefined ? ctx.view.close() : sig.referencePrice;
  var isLong = sig.direction === enums.Direction.LONG;
  if (isLong && !(sig.stopLoss < ref)) {
    throw errors.CandidateError(strategyId + ': a LONG stop (' + sig.stopLoss + ') must be below the reference price (' + ref + ')');
  }
  if (isLong && !(sig.takeProfit > ref)) {
    throw errors.CandidateError(strategyId + ': a LONG target (' + sig.takeProfit + ') must be above the reference price (' + ref + ')');
  }
  if (!isLong && !(sig.stopLoss > ref)) {
    throw errors.CandidateError(strategyId + ': a SHORT stop (' + sig.stopLoss + ') must be above the reference price (' + ref + ')');
  }
  if (!isLong && !(sig.takeProfit < ref)) {
    throw errors.CandidateError(strategyId + ': a SHORT target (' + sig.takeProfit + ') must be below the reference price (' + ref + ')');
  }
  if (sig.confidence !== undefined && !(sig.confidence >= 0 && sig.confidence <= 1)) {
    throw errors.CandidateError(strategyId + ': signal.confidence must be in [0, 1], got ' + sig.confidence);
  }

  return {
    strategyId: strategyId,
    direction: sig.direction,
    referencePrice: ref,
    stopLoss: sig.stopLoss,
    takeProfit: sig.takeProfit,
    confidence: sig.confidence === undefined ? 0.5 : sig.confidence,
    reasonCodes: (sig.reasonCodes || []).slice(),
    meta: sig.meta || {}
  };
}

function shallow(o) {
  var out = {};
  Object.keys(o).forEach(function (k) { out[k] = o[k]; });
  return out;
}

module.exports = {
  define: define,
  validateSignal: validateSignal,
  key: key,
  REQUIRED: REQUIRED
};
