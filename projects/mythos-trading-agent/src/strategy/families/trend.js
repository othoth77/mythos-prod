'use strict';
// =====================================================
// MYTHOS TRADING AGENT — trend strategy families
// projects/mythos-trading-agent/src/strategy/families/trend.js
//
// Three of the fourteen families in mission §4: trend following, multi-timeframe
// trend, and pullback.
//
// NONE OF THESE IS ASSUMED TO WORK. Mission §4 is explicit about that, and it
// matters for how they are written: each is the simplest honest expression of its
// idea, with its parameters exposed in a declared search space, so the Research
// Agent can find out whether the idea survives costs rather than inheriting a
// conclusion from whoever tuned it first. A strategy that arrived here already
// optimised would be untestable — every result would be in-sample.
// =====================================================

var base = require('../base');
var h = require('../helpers');
var ind = require('../../indicators');

var key = base.key;

// ---------------------------------------------------------------------------
// 1. Trend following — the canonical moving-average cross with a trend filter
// ---------------------------------------------------------------------------
var trendFollowing = base.define({
  strategyId: 'trend-following',
  family: 'TREND_FOLLOWING',
  name: 'EMA cross with ADX trend filter',
  version: 1,
  description:
    'Enters on a fast/slow EMA cross, but only when ADX says a trend exists. The ' +
    'ADX filter is the whole point: an EMA cross in a range fires constantly and ' +
    'loses the spread every time.',
  preferredRegimes: ['TREND', 'BREAKOUT'],
  defaultParams: { fast: 20, slow: 50, adxPeriod: 14, adxMin: 22, atrPeriod: 14, atrMultiple: 1.5, rewardRisk: 2 },
  paramSpace: {
    fast: { min: 5, max: 50, step: 1 },
    slow: { min: 20, max: 200, step: 5 },
    adxPeriod: { min: 7, max: 28, step: 1 },
    adxMin: { min: 0, max: 40, step: 1 },
    atrPeriod: { min: 7, max: 28, step: 1 },
    atrMultiple: { min: 0.5, max: 4, step: 0.1 },
    rewardRisk: { min: 0.5, max: 5, step: 0.1 }
  },
  indicators: function (p) {
    var out = {};
    out[key('ema', p.fast)] = function (s) { return ind.ema(s.closes(), p.fast); };
    out[key('ema', p.slow)] = function (s) { return ind.ema(s.closes(), p.slow); };
    out[key('adx', p.adxPeriod)] = function (s) { return ind.adx(s.bars(), p.adxPeriod).adx; };
    out[key('atr', p.atrPeriod)] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
    return out;
  },
  warmupBars: function (p) { return Math.max(p.slow, p.adxPeriod * 3, p.atrPeriod * 2) + 5; },
  evaluate: function (ctx) {
    var p = ctx.params;
    var fastK = key('ema', p.fast), slowK = key('ema', p.slow);
    var v = h.need(ctx.view, [fastK, slowK, key('adx', p.adxPeriod), key('atr', p.atrPeriod)]);
    if (v === null) return null;

    var adx = v[key('adx', p.adxPeriod)];
    if (adx < p.adxMin) return null;

    var up = h.crossedAbove(ctx.view, fastK, slowK);
    var down = h.crossedBelow(ctx.view, fastK, slowK);
    if (!up && !down) return null;

    var direction = up ? 'LONG' : 'SHORT';
    var reference = ctx.view.close();
    var stops = h.atrStops({
      instrument: ctx.instrument, reference: reference, direction: direction,
      atr: v[key('atr', p.atrPeriod)], atrMultiple: p.atrMultiple, rewardRisk: p.rewardRisk
    });
    return h.signal(direction, stops, {
      reference: reference,
      // Confidence rises with ADX but is capped well below 1: this is a
      // heuristic, and a strategy claiming near-certainty would mislead the Jev
      // gate that consumes it.
      confidence: Math.min(0.8, 0.35 + (adx - p.adxMin) / 100),
      reasonCodes: ['EMA_CROSS_' + (up ? 'UP' : 'DOWN'), 'ADX_' + Math.round(adx)],
      meta: { adx: adx, fast: v[fastK], slow: v[slowK] }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Multi-timeframe trend — the base signal must agree with the higher frame
// ---------------------------------------------------------------------------
var mtfTrend = base.define({
  strategyId: 'mtf-trend',
  family: 'MULTI_TIMEFRAME_TREND',
  name: 'Base-timeframe pullback entry in the higher-timeframe trend direction',
  version: 1,
  description:
    'Direction comes from a completed higher-timeframe EMA relationship; timing ' +
    'comes from the base timeframe. The higher-timeframe bar used is always one ' +
    'that has CLOSED (src/data/resample.js), which is where multi-timeframe ' +
    'backtests normally acquire look-ahead.',
  preferredRegimes: ['TREND'],
  defaultParams: { htfFast: 10, htfSlow: 30, baseEma: 20, atrPeriod: 14, atrMultiple: 1.5, rewardRisk: 2.5, maxPullbackAtr: 1 },
  paramSpace: {
    htfFast: { min: 3, max: 30, step: 1 },
    htfSlow: { min: 10, max: 100, step: 5 },
    baseEma: { min: 5, max: 100, step: 1 },
    atrPeriod: { min: 7, max: 28, step: 1 },
    atrMultiple: { min: 0.5, max: 4, step: 0.1 },
    rewardRisk: { min: 0.5, max: 5, step: 0.1 },
    maxPullbackAtr: { min: 0.1, max: 3, step: 0.1 }
  },
  indicators: function (p) {
    var out = {};
    out[key('ema', p.baseEma)] = function (s) { return ind.ema(s.closes(), p.baseEma); };
    out[key('atr', p.atrPeriod)] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
    return out;
  },
  higherIndicators: function (p) {
    var out = {};
    out[key('ema', p.htfFast)] = function (s) { return ind.ema(s.closes(), p.htfFast); };
    out[key('ema', p.htfSlow)] = function (s) { return ind.ema(s.closes(), p.htfSlow); };
    return out;
  },
  warmupBars: function (p) { return Math.max(p.baseEma, p.atrPeriod * 2) + 5; },
  evaluate: function (ctx) {
    if (!ctx.higherView) return null; // no completed higher bar yet
    var p = ctx.params;
    var hv = h.need(ctx.higherView, [key('ema', p.htfFast), key('ema', p.htfSlow)]);
    if (hv === null) return null;
    var v = h.need(ctx.view, [key('ema', p.baseEma), key('atr', p.atrPeriod)]);
    if (v === null) return null;

    var htfFast = hv[key('ema', p.htfFast)];
    var htfSlow = hv[key('ema', p.htfSlow)];
    if (htfFast === htfSlow) return null;
    var direction = htfFast > htfSlow ? 'LONG' : 'SHORT';

    // Timing: price has pulled back to within maxPullbackAtr of the base EMA,
    // on the correct side of it. Entering at any distance would mean chasing.
    var ema = v[key('ema', p.baseEma)];
    var atr = v[key('atr', p.atrPeriod)];
    var price = ctx.view.close();
    var dist = h.atrDistance(price, ema, atr);
    if (dist === null || dist > p.maxPullbackAtr) return null;
    if (direction === 'LONG' && price < ema) return null;
    if (direction === 'SHORT' && price > ema) return null;

    var stops = h.atrStops({
      instrument: ctx.instrument, reference: price, direction: direction,
      atr: atr, atrMultiple: p.atrMultiple, rewardRisk: p.rewardRisk
    });
    return h.signal(direction, stops, {
      reference: price,
      confidence: 0.55,
      reasonCodes: ['HTF_TREND_' + direction, 'PULLBACK_TO_EMA'],
      meta: { htfTimeframe: ctx.higherTimeframe, htfFast: htfFast, htfSlow: htfSlow, pullbackAtr: dist }
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Pullback — buy the dip inside an established trend
// ---------------------------------------------------------------------------
var pullback = base.define({
  strategyId: 'pullback',
  family: 'PULLBACK',
  name: 'RSI pullback inside a long-EMA trend',
  version: 1,
  description:
    'In an uptrend (price above a long EMA with a positive slope), waits for RSI ' +
    'to dip into a pullback band and then turn back up. The turn is required: ' +
    'buying a falling RSI is catching a knife, and the two look identical until ' +
    'afterwards.',
  preferredRegimes: ['TREND'],
  defaultParams: { trendEma: 100, rsiPeriod: 14, rsiLow: 40, rsiHigh: 60, atrPeriod: 14, atrMultiple: 1.2, rewardRisk: 2, minSlope: 0.0005 },
  paramSpace: {
    trendEma: { min: 20, max: 400, step: 10 },
    rsiPeriod: { min: 5, max: 28, step: 1 },
    rsiLow: { min: 20, max: 50, step: 1 },
    rsiHigh: { min: 50, max: 80, step: 1 },
    atrPeriod: { min: 7, max: 28, step: 1 },
    atrMultiple: { min: 0.5, max: 4, step: 0.1 },
    rewardRisk: { min: 0.5, max: 5, step: 0.1 },
    minSlope: { min: 0, max: 0.01, step: 0.0001 }
  },
  indicators: function (p) {
    var out = {};
    out[key('ema', p.trendEma)] = function (s) { return ind.ema(s.closes(), p.trendEma); };
    out[key('rsi', p.rsiPeriod)] = function (s) { return ind.rsi(s.closes(), p.rsiPeriod); };
    out[key('atr', p.atrPeriod)] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
    return out;
  },
  warmupBars: function (p) { return Math.max(p.trendEma + 20, p.rsiPeriod * 3, p.atrPeriod * 2) + 5; },
  evaluate: function (ctx) {
    var p = ctx.params;
    var emaK = key('ema', p.trendEma), rsiK = key('rsi', p.rsiPeriod), atrK = key('atr', p.atrPeriod);
    var v = h.need(ctx.view, [emaK, rsiK, atrK]);
    if (v === null) return null;
    var prev = h.need(ctx.view, [rsiK], 1);
    if (prev === null) return null;

    var slope = h.slope(ctx.view, emaK, 20);
    if (slope === null) return null;
    var price = ctx.view.close();
    var ema = v[emaK];
    var rsi = v[rsiK];
    var rsiPrev = prev[rsiK];

    var uptrend = price > ema && slope >= p.minSlope;
    var downtrend = price < ema && slope <= -p.minSlope;
    if (!uptrend && !downtrend) return null;

    // The turn: RSI was in the pullback band and is now rising (falling for a short).
    var direction = null;
    if (uptrend && rsiPrev <= p.rsiLow && rsi > rsiPrev) direction = 'LONG';
    if (downtrend && rsiPrev >= p.rsiHigh && rsi < rsiPrev) direction = 'SHORT';
    if (direction === null) return null;

    var stops = h.atrStops({
      instrument: ctx.instrument, reference: price, direction: direction,
      atr: v[atrK], atrMultiple: p.atrMultiple, rewardRisk: p.rewardRisk
    });
    return h.signal(direction, stops, {
      reference: price,
      confidence: 0.5,
      reasonCodes: ['TREND_' + direction, 'RSI_PULLBACK_TURN'],
      meta: { rsi: rsi, rsiPrev: rsiPrev, emaSlope: slope }
    });
  }
});

module.exports = [trendFollowing, mtfTrend, pullback];
