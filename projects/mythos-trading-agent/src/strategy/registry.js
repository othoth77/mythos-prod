'use strict';
// =====================================================
// MYTHOS TRADING AGENT — strategy registry
// projects/mythos-trading-agent/src/strategy/registry.js
//
// Holds every strategy definition and nothing else. It is deliberately not a
// portfolio: the registry knows what exists, the portfolio (portfolio.js) knows
// what is switched on, at which parameters, for this run. Separating them means a
// research run can enable one strategy without the registry being mutated, and
// two runs can disagree about the portfolio while agreeing about what a strategy
// IS.
//
// `family` must be unique per strategy: mission §4 asks for each family to be
// independently measurable, and two strategies sharing a family label would make
// a per-family report ambiguous.
// =====================================================

var errors = require('../core/errors');

/** The families mission §4 names. A strategy outside this list is a new family. */
var FAMILIES = Object.freeze([
  'TREND_FOLLOWING',
  'MULTI_TIMEFRAME_TREND',
  'PULLBACK',
  'BREAKOUT',
  'BREAKOUT_RETEST',
  'MOMENTUM',
  'MARKET_STRUCTURE',
  'SUPPORT_RESISTANCE',
  'LIQUIDITY_SWEEP',
  'VOLATILITY_EXPANSION',
  'MEAN_REVERSION',
  'RANGE_TRADING',
  'PRICE_ACTION',
  'SESSION_BASED'
]);

function create() {
  var byId = Object.create(null);
  var order = [];

  var api = {
    register: function (strategy) {
      if (byId[strategy.strategyId]) {
        throw errors.ConfigError('strategy ' + strategy.strategyId + ' is already registered');
      }
      if (FAMILIES.indexOf(strategy.family) === -1) {
        throw errors.ConfigError(
          'strategy ' + strategy.strategyId + ' declares family ' + strategy.family +
          ', which is not one of the mission §4 families [' + FAMILIES.join(', ') + ']'
        );
      }
      var clash = order.filter(function (id) { return byId[id].family === strategy.family; });
      if (clash.length) {
        throw errors.ConfigError(
          'family ' + strategy.family + ' is already held by ' + clash[0] +
          '; each family must be independently measurable, so labels cannot be shared'
        );
      }
      byId[strategy.strategyId] = strategy;
      order.push(strategy.strategyId);
      return api;
    },
    registerAll: function (list) {
      list.forEach(function (s) { api.register(s); });
      return api;
    },
    get: function (id) {
      var s = byId[id];
      if (!s) throw errors.ConfigError('unknown strategy ' + JSON.stringify(id) + ' (known: ' + order.join(', ') + ')');
      return s;
    },
    has: function (id) { return !!byId[id]; },
    ids: function () { return order.slice(); },
    all: function () { return order.map(function (id) { return byId[id]; }); },
    byFamily: function (family) {
      return api.all().filter(function (s) { return s.family === family; });
    },
    families: function () {
      return api.all().map(function (s) { return s.family; });
    },
    /** Strategies whose declared preference includes this regime. */
    preferring: function (regime) {
      return api.all().filter(function (s) { return s.preferredRegimes.indexOf(regime) !== -1; });
    },
    count: function () { return order.length; },
    /** A serialisable description of the whole registry, for the store. */
    describe: function () {
      return api.all().map(function (s) {
        return {
          strategyId: s.strategyId, family: s.family, name: s.name, version: s.version,
          preferredRegimes: s.preferredRegimes.slice(),
          params: Object.keys(s.defaultParams),
          usesHigherTimeframe: s.usesHigherTimeframe
        };
      });
    }
  };
  return api;
}

/** The registry holding every strategy shipped with the platform. */
function standard() {
  var reg = create();
  reg.registerAll(require('./families/trend'));
  reg.registerAll(require('./families/breakout'));
  reg.registerAll(require('./families/structure'));
  reg.registerAll(require('./families/momentum'));
  reg.registerAll(require('./families/reversion'));
  reg.registerAll(require('./families/session'));
  return reg;
}

module.exports = {
  create: create,
  standard: standard,
  FAMILIES: FAMILIES
};
