'use strict';
// =====================================================
// MYTHOS TRADING AGENT — momentum and price-action families
// projects/mythos-trading-agent/src/strategy/families/momentum.js
//
// Momentum and price action (mission §4).
//
// The price-action family is the one most likely to be over-fitted by anyone
// writing it, because candlestick patterns are infinitely parameterisable. It is
// therefore restricted to two patterns with numerically stated definitions —
// engulfing and pin bar — and each threshold is exposed in the search space so a
// tuned value has to be justified by out-of-sample evidence rather than by having
// been typed here first.
// =====================================================

var base = require('../base');
var h = require('../helpers');
var ind = require('../../indicators');
var barMod = require('../../data/bar');

var key = base.key;

// ---------------------------------------------------------------------------
// 1. Momentum — rate of change with an RSI regime check
// ---------------------------------------------------------------------------
var momentum = base.define({
  strategyId: 'momentum',
  family: 'MOMENTUM',
  name: 'Rate-of-change momentum with an RSI ceiling',
  version: 1,
  description:
    'Enters when N-bar rate of change exceeds a threshold, but NOT when RSI is ' +
    'already extreme. The ceiling is the difference between joining a move and ' +
    'arriving at the end of one.',
  preferredRegimes: ['TREND', 'BREAKOUT'],
  defaultParams: { rocPeriod: 20, rocThreshold: 0.0025, rsiPeriod: 14, rsiCeiling: 78, atrPeriod: 14, atrMultiple: 1.5, rewardRisk: 2 },
  paramSpace: {
    rocPeriod: { min: 3, max: 100, step: 1 },
    rocThreshold: { min: 0.0002, max: 0.05, step: 0.0001 },
    rsiPeriod: { min: 5, max: 28, step: 1 },
    rsiCeiling: { min: 55, max: 95, step: 1 },
    atrPeriod: { min: 7, max: 28, step: 1 },
    atrMultiple: { min: 0.5, max: 4, step: 0.1 },
    rewardRisk: { min: 0.5, max: 5, step: 0.1 }
  },
  indicators: function (p) {
    var out = {};
    out[key('roc', p.rocPeriod)] = function (s) { return ind.roc(s.closes(), p.rocPeriod); };
    out[key('rsi', p.rsiPeriod)] = function (s) { return ind.rsi(s.closes(), p.rsiPeriod); };
    out[key('atr', p.atrPeriod)] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
    return out;
  },
  warmupBars: function (p) { return Math.max(p.rocPeriod, p.rsiPeriod * 3, p.atrPeriod * 2) + 5; },
  evaluate: function (ctx) {
    var p = ctx.params;
    var rocK = key('roc', p.rocPeriod), rsiK = key('rsi', p.rsiPeriod), atrK = key('atr', p.atrPeriod);
    var v = h.need(ctx.view, [rocK, rsiK, atrK]);
    if (v === null) return null;

    var roc = v[rocK], rsi = v[rsiK];
    var direction = null;
    if (roc >= p.rocThreshold && rsi < p.rsiCeiling) direction = 'LONG';
    else if (roc <= -p.rocThreshold && rsi > 100 - p.rsiCeiling) direction = 'SHORT';
    if (direction === null) return null;

    var price = ctx.view.close();
    var stops = h.atrStops({
      instrument: ctx.instrument, reference: price, direction: direction,
      atr: v[atrK], atrMultiple: p.atrMultiple, rewardRisk: p.rewardRisk
    });
    return h.signal(direction, stops, {
      reference: price,
      confidence: Math.min(0.75, 0.4 + Math.abs(roc) / (p.rocThreshold * 10)),
      reasonCodes: ['ROC_' + direction, 'RSI_NOT_EXTREME'],
      meta: { roc: roc, rsi: rsi }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Price action — engulfing and pin bar, numerically defined
// ---------------------------------------------------------------------------
var priceAction = base.define({
  strategyId: 'price-action',
  family: 'PRICE_ACTION',
  name: 'Engulfing bar or pin bar in the direction of the short-term trend',
  version: 1,
  description:
    'Two patterns only, each with a stated numeric definition, and both filtered ' +
    'by a short EMA so the pattern has to agree with context. Candlestick patterns ' +
    'are the easiest thing in trading to over-fit; the restraint here is the point.',
  preferredRegimes: ['RANGE', 'TREND'],
  defaultParams: {
    trendEma: 50, minBodyAtr: 0.6, pinWickFraction: 0.6, pinBodyFraction: 0.3,
    atrPeriod: 14, atrMultiple: 1.2, rewardRisk: 2
  },
  paramSpace: {
    trendEma: { min: 10, max: 200, step: 5 },
    minBodyAtr: { min: 0.1, max: 3, step: 0.05 },
    pinWickFraction: { min: 0.4, max: 0.9, step: 0.05 },
    pinBodyFraction: { min: 0.05, max: 0.5, step: 0.05 },
    atrPeriod: { min: 7, max: 28, step: 1 },
    atrMultiple: { min: 0.5, max: 4, step: 0.1 },
    rewardRisk: { min: 0.5, max: 5, step: 0.1 }
  },
  indicators: function (p) {
    var out = {};
    out[key('ema', p.trendEma)] = function (s) { return ind.ema(s.closes(), p.trendEma); };
    out[key('atr', p.atrPeriod)] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
    return out;
  },
  warmupBars: function (p) { return Math.max(p.trendEma, p.atrPeriod * 2) + 5; },
  evaluate: function (ctx) {
    var p = ctx.params;
    var emaK = key('ema', p.trendEma), atrK = key('atr', p.atrPeriod);
    var v = h.need(ctx.view, [emaK, atrK]);
    if (v === null) return null;
    var bar = ctx.view.bar(0);
    var prev = ctx.view.bar(1);
    if (!prev) return null;
    var atr = v[atrK];
    if (!(atr > 0)) return null;

    var range = barMod.range(bar);
    if (!(range > 0)) return null;
    var body = barMod.body(bar);
    var upTrend = ctx.view.close() > v[emaK];

    var pattern = null;
    var direction = null;

    // Engulfing: a decisive body that fully covers the previous bar's body.
    var engulfs = body >= atr * p.minBodyAtr &&
      Math.min(bar.open, bar.close) <= Math.min(prev.open, prev.close) &&
      Math.max(bar.open, bar.close) >= Math.max(prev.open, prev.close);
    if (engulfs && barMod.isBullish(bar) && barMod.isBearish(prev) && upTrend) {
      pattern = 'BULLISH_ENGULFING'; direction = 'LONG';
    } else if (engulfs && barMod.isBearish(bar) && barMod.isBullish(prev) && !upTrend) {
      pattern = 'BEARISH_ENGULFING'; direction = 'SHORT';
    }

    // Pin bar: one long wick, a small body, and the wick on the rejected side.
    if (pattern === null) {
      var lower = barMod.lowerWick(bar) / range;
      var upper = barMod.upperWick(bar) / range;
      var smallBody = body / range <= p.pinBodyFraction;
      if (smallBody && lower >= p.pinWickFraction && upTrend) { pattern = 'BULLISH_PIN'; direction = 'LONG'; }
      else if (smallBody && upper >= p.pinWickFraction && !upTrend) { pattern = 'BEARISH_PIN'; direction = 'SHORT'; }
    }
    if (pattern === null) return null;

    // The stop goes beyond the pattern's own extreme, which is the level the
    // pattern claims will hold. If it does not hold, the reason to be in the
    // trade is gone.
    var level = direction === 'LONG' ? bar.low : bar.high;
    var stops = h.structureStops({
      instrument: ctx.instrument, reference: bar.close, direction: direction,
      level: level, atr: atr, bufferAtr: 0.1, rewardRisk: p.rewardRisk
    });
    if (stops === null) return null;
    return h.signal(direction, stops, {
      reference: bar.close,
      confidence: 0.45,
      reasonCodes: [pattern, upTrend ? 'ABOVE_EMA' : 'BELOW_EMA'],
      meta: { pattern: pattern, bodyAtr: body / atr, rangeAtr: range / atr, patternExtreme: level }
    });
  }
});

module.exports = [momentum, priceAction];
