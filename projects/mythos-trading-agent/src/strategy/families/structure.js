'use strict';
// =====================================================
// MYTHOS TRADING AGENT — market-structure strategy families
// projects/mythos-trading-agent/src/strategy/families/structure.js
//
// Market structure, support/resistance and liquidity sweep (mission §4).
//
// All three read swing pivots, which is the one indicator family where
// look-ahead is almost unavoidable if you are not deliberate. A pivot high at
// bar j is only knowable after `right` more bars have closed, and
// src/indicators/index.js publishes it at bar j+right for exactly that reason.
// The consequence is visible here and is not a bug: these strategies react to
// structure a few bars LATE, because that is when structure actually becomes
// knowable. A backtest that reacted on bar j would be trading information that
// did not exist, and it would look considerably better.
// =====================================================

var base = require('../base');
var h = require('../helpers');
var ind = require('../../indicators');

var key = base.key;

function swingKeys(p) {
  var suffix = key(p.swingLeft, p.swingRight);
  return {
    lastHigh: 'swingLastHigh_' + suffix,
    lastLow: 'swingLastLow_' + suffix,
    prevHigh: 'swingPrevHigh_' + suffix,
    prevLow: 'swingPrevLow_' + suffix,
    highAt: 'swingHighAt_' + suffix,
    lowAt: 'swingLowAt_' + suffix
  };
}

function swingIndicators(p) {
  var k = swingKeys(p);
  var out = {};
  function pick(field) {
    return function (s) { return ind.swings(s.bars(), p.swingLeft, p.swingRight)[field]; };
  }
  out[k.lastHigh] = pick('lastHigh');
  out[k.lastLow] = pick('lastLow');
  out[k.prevHigh] = pick('prevHigh');
  out[k.prevLow] = pick('prevLow');
  out[k.highAt] = pick('highAt');
  out[k.lowAt] = pick('lowAt');
  return out;
}

// ---------------------------------------------------------------------------
// 1. Market structure — higher highs and higher lows, or the mirror
// ---------------------------------------------------------------------------
var marketStructure = base.define({
  strategyId: 'market-structure',
  family: 'MARKET_STRUCTURE',
  name: 'Higher-high / higher-low continuation',
  version: 1,
  description:
    'Long when the last confirmed swing high exceeds the previous one AND the last ' +
    'swing low exceeds the previous one. Requiring both is what distinguishes ' +
    'structure from a single impulse that has not changed anything.',
  preferredRegimes: ['TREND'],
  defaultParams: { swingLeft: 3, swingRight: 3, atrPeriod: 14, atrMultiple: 1, rewardRisk: 2, bufferAtr: 0.25 },
  paramSpace: {
    swingLeft: { min: 2, max: 10, step: 1 },
    swingRight: { min: 1, max: 10, step: 1 },
    atrPeriod: { min: 7, max: 28, step: 1 },
    atrMultiple: { min: 0.5, max: 4, step: 0.1 },
    rewardRisk: { min: 0.5, max: 5, step: 0.1 },
    bufferAtr: { min: 0, max: 1.5, step: 0.05 }
  },
  indicators: function (p) {
    var out = swingIndicators(p);
    out[key('atr', p.atrPeriod)] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
    return out;
  },
  warmupBars: function (p) { return (p.swingLeft + p.swingRight) * 6 + p.atrPeriod * 2 + 10; },
  evaluate: function (ctx) {
    var p = ctx.params;
    var k = swingKeys(p);
    var atrK = key('atr', p.atrPeriod);
    var v = h.need(ctx.view, [k.lastHigh, k.lastLow, k.prevHigh, k.prevLow, atrK]);
    if (v === null) return null;

    // Only act on the bar a new pivot was confirmed: otherwise the same
    // structure fires on every subsequent bar and the strategy is really
    // "always in", which measures the exit rules and nothing else.
    var newHigh = h.value(ctx.view, k.highAt, 0);
    var newLow = h.value(ctx.view, k.lowAt, 0);
    if (newHigh === null && newLow === null) return null;

    var hh = v[k.lastHigh] > v[k.prevHigh];
    var hl = v[k.lastLow] > v[k.prevLow];
    var lh = v[k.lastHigh] < v[k.prevHigh];
    var ll = v[k.lastLow] < v[k.prevLow];

    var direction = null;
    var level = null;
    if (hh && hl) { direction = 'LONG'; level = v[k.lastLow]; }
    else if (lh && ll) { direction = 'SHORT'; level = v[k.lastHigh]; }
    if (direction === null) return null;

    var price = ctx.view.close();
    var stops = h.structureStops({
      instrument: ctx.instrument, reference: price, direction: direction,
      level: level, atr: v[atrK], bufferAtr: p.bufferAtr, rewardRisk: p.rewardRisk
    });
    if (stops === null) return null; // the structural level is already breached
    return h.signal(direction, stops, {
      reference: price,
      confidence: 0.55,
      reasonCodes: direction === 'LONG' ? ['HIGHER_HIGH', 'HIGHER_LOW'] : ['LOWER_HIGH', 'LOWER_LOW'],
      meta: { lastHigh: v[k.lastHigh], prevHigh: v[k.prevHigh], lastLow: v[k.lastLow], prevLow: v[k.prevLow], structureLevel: level }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Support / resistance — a reaction at a prior swing level
// ---------------------------------------------------------------------------
var supportResistance = base.define({
  strategyId: 'support-resistance',
  family: 'SUPPORT_RESISTANCE',
  name: 'Rejection at a confirmed swing level',
  version: 1,
  description:
    'Price trades into a confirmed swing low (support) and closes back above it ' +
    'with a lower wick. The wick requirement is what makes it a rejection rather ' +
    'than a level that simply has not broken yet.',
  preferredRegimes: ['RANGE', 'LOW_VOLATILITY'],
  defaultParams: { swingLeft: 3, swingRight: 3, proximityAtr: 0.4, minWickFraction: 0.35, atrPeriod: 14, atrMultiple: 1, rewardRisk: 2, bufferAtr: 0.3 },
  paramSpace: {
    swingLeft: { min: 2, max: 10, step: 1 },
    swingRight: { min: 1, max: 10, step: 1 },
    proximityAtr: { min: 0.05, max: 2, step: 0.05 },
    minWickFraction: { min: 0, max: 0.8, step: 0.05 },
    atrPeriod: { min: 7, max: 28, step: 1 },
    atrMultiple: { min: 0.5, max: 4, step: 0.1 },
    rewardRisk: { min: 0.5, max: 5, step: 0.1 },
    bufferAtr: { min: 0, max: 1.5, step: 0.05 }
  },
  indicators: function (p) {
    var out = swingIndicators(p);
    out[key('atr', p.atrPeriod)] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
    return out;
  },
  warmupBars: function (p) { return (p.swingLeft + p.swingRight) * 6 + p.atrPeriod * 2 + 10; },
  evaluate: function (ctx) {
    var p = ctx.params;
    var k = swingKeys(p);
    var atrK = key('atr', p.atrPeriod);
    var v = h.need(ctx.view, [k.lastHigh, k.lastLow, atrK]);
    if (v === null) return null;

    var bar = ctx.view.current();
    var atr = v[atrK];
    var range = bar.high - bar.low;
    if (!(range > 0) || !(atr > 0)) return null;

    var lowerWick = Math.min(bar.open, bar.close) - bar.low;
    var upperWick = bar.high - Math.max(bar.open, bar.close);

    // Support: the bar's LOW reached the level, and the close is back above it.
    var touchedSupport = bar.low <= v[k.lastLow] + atr * p.proximityAtr && bar.close > v[k.lastLow];
    var touchedResistance = bar.high >= v[k.lastHigh] - atr * p.proximityAtr && bar.close < v[k.lastHigh];

    var direction = null, level = null;
    if (touchedSupport && lowerWick / range >= p.minWickFraction) { direction = 'LONG'; level = Math.min(bar.low, v[k.lastLow]); }
    else if (touchedResistance && upperWick / range >= p.minWickFraction) { direction = 'SHORT'; level = Math.max(bar.high, v[k.lastHigh]); }
    if (direction === null) return null;

    var stops = h.structureStops({
      instrument: ctx.instrument, reference: bar.close, direction: direction,
      level: level, atr: atr, bufferAtr: p.bufferAtr, rewardRisk: p.rewardRisk
    });
    if (stops === null) return null;
    return h.signal(direction, stops, {
      reference: bar.close,
      confidence: 0.5,
      reasonCodes: [direction === 'LONG' ? 'SUPPORT_REJECTION' : 'RESISTANCE_REJECTION', 'WICK_CONFIRMED'],
      meta: {
        level: level,
        wickFraction: (direction === 'LONG' ? lowerWick : upperWick) / range,
        swingHigh: v[k.lastHigh], swingLow: v[k.lastLow]
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Liquidity sweep — a stop run beyond a level that immediately reverses
// ---------------------------------------------------------------------------
var liquiditySweep = base.define({
  strategyId: 'liquidity-sweep',
  family: 'LIQUIDITY_SWEEP',
  name: 'Sweep of a swing extreme with an immediate close back inside',
  version: 1,
  description:
    'A bar trades through a confirmed swing low by a minimum margin and closes back ' +
    'above it. The margin requirement separates a genuine sweep from a level being ' +
    'grazed, and the close-back-inside requirement is what makes it a failed break ' +
    'rather than a break.',
  preferredRegimes: ['RANGE', 'UNSTABLE', 'HIGH_VOLATILITY'],
  defaultParams: { swingLeft: 3, swingRight: 3, minPenetrationAtr: 0.15, maxPenetrationAtr: 1.5, atrPeriod: 14, atrMultiple: 1, rewardRisk: 2, bufferAtr: 0.2 },
  paramSpace: {
    swingLeft: { min: 2, max: 10, step: 1 },
    swingRight: { min: 1, max: 10, step: 1 },
    minPenetrationAtr: { min: 0.02, max: 1, step: 0.01 },
    maxPenetrationAtr: { min: 0.2, max: 5, step: 0.1 },
    atrPeriod: { min: 7, max: 28, step: 1 },
    atrMultiple: { min: 0.5, max: 4, step: 0.1 },
    rewardRisk: { min: 0.5, max: 5, step: 0.1 },
    bufferAtr: { min: 0, max: 1.5, step: 0.05 }
  },
  indicators: function (p) {
    var out = swingIndicators(p);
    out[key('atr', p.atrPeriod)] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
    return out;
  },
  warmupBars: function (p) { return (p.swingLeft + p.swingRight) * 6 + p.atrPeriod * 2 + 10; },
  evaluate: function (ctx) {
    var p = ctx.params;
    var k = swingKeys(p);
    var atrK = key('atr', p.atrPeriod);
    var v = h.need(ctx.view, [k.lastHigh, k.lastLow, atrK]);
    if (v === null) return null;
    var atr = v[atrK];
    if (!(atr > 0)) return null;

    var bar = ctx.view.current();
    var direction = null, level = null, penetration = null;

    var lowSweep = (v[k.lastLow] - bar.low) / atr;
    if (bar.low < v[k.lastLow] && bar.close > v[k.lastLow] &&
        lowSweep >= p.minPenetrationAtr && lowSweep <= p.maxPenetrationAtr) {
      direction = 'LONG'; level = bar.low; penetration = lowSweep;
    }
    var highSweep = (bar.high - v[k.lastHigh]) / atr;
    if (direction === null && bar.high > v[k.lastHigh] && bar.close < v[k.lastHigh] &&
        highSweep >= p.minPenetrationAtr && highSweep <= p.maxPenetrationAtr) {
      direction = 'SHORT'; level = bar.high; penetration = highSweep;
    }
    if (direction === null) return null;

    var stops = h.structureStops({
      instrument: ctx.instrument, reference: bar.close, direction: direction,
      level: level, atr: atr, bufferAtr: p.bufferAtr, rewardRisk: p.rewardRisk
    });
    if (stops === null) return null;
    return h.signal(direction, stops, {
      reference: bar.close,
      confidence: 0.55,
      reasonCodes: ['LIQUIDITY_SWEEP_' + (direction === 'LONG' ? 'LOW' : 'HIGH'), 'CLOSED_BACK_INSIDE'],
      meta: { sweptLevel: direction === 'LONG' ? v[k.lastLow] : v[k.lastHigh], penetrationAtr: penetration, extreme: level }
    });
  }
});

module.exports = [marketStructure, supportResistance, liquiditySweep];
