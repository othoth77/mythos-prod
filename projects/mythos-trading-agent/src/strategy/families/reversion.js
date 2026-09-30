'use strict';
// =====================================================
// MYTHOS TRADING AGENT — mean-reversion strategy families
// projects/mythos-trading-agent/src/strategy/families/reversion.js
//
// Mean reversion and range trading (mission §4).
//
// These two are the platform's most dangerous strategies and the comment belongs
// here rather than in a document. A mean-reversion rule wins often and loses
// badly, which makes its equity curve look excellent right up to the trade that
// ends it. Two consequences are built in:
//
//  * BOTH REQUIRE A TREND FILTER THAT VETOES THEM. Selling an extreme inside a
//    strong trend is the classic way to lose a year of gains in a week, so
//    mean-reversion refuses to fire when ADX says a trend is running, and
//    range-trading refuses unless the efficiency ratio says the market is
//    actually going nowhere.
//  * NEITHER IS ALLOWED A REWARD/RISK BELOW ITS SEARCH FLOOR. A 0.3 R target with
//    an 85 % win rate is a bet that the eighth loss never comes, and mission §10
//    makes streak behaviour a primary objective precisely to catch that shape.
//    The Analysis Agent will report their streak distributions separately.
// =====================================================

var base = require('../base');
var h = require('../helpers');
var ind = require('../../indicators');

var key = base.key;

// ---------------------------------------------------------------------------
// 1. Mean reversion — Bollinger extreme with an anti-trend veto
// ---------------------------------------------------------------------------
var meanReversion = base.define({
  strategyId: 'mean-reversion',
  family: 'MEAN_REVERSION',
  name: 'Bollinger band extreme with RSI confirmation and an ADX veto',
  version: 1,
  description:
    'Fades a close outside a Bollinger band when RSI agrees and ADX says no trend ' +
    'is running. The ADX veto is not a refinement — without it this strategy sells ' +
    'every new high in a trend.',
  preferredRegimes: ['RANGE', 'LOW_VOLATILITY'],
  defaultParams: {
    bbPeriod: 20, bbMult: 2.2, rsiPeriod: 14, rsiExtreme: 72,
    adxPeriod: 14, adxMax: 25, atrPeriod: 14, atrMultiple: 1.2, rewardRisk: 1.2
  },
  paramSpace: {
    bbPeriod: { min: 10, max: 100, step: 1 },
    bbMult: { min: 1, max: 4, step: 0.1 },
    rsiPeriod: { min: 5, max: 28, step: 1 },
    rsiExtreme: { min: 55, max: 90, step: 1 },
    adxPeriod: { min: 7, max: 28, step: 1 },
    adxMax: { min: 10, max: 50, step: 1 },
    atrPeriod: { min: 7, max: 28, step: 1 },
    atrMultiple: { min: 0.5, max: 4, step: 0.1 },
    // The floor is 0.8 deliberately: see the file header on 0.3 R targets.
    rewardRisk: { min: 0.8, max: 4, step: 0.1 }
  },
  indicators: function (p) {
    var out = {};
    var bbKey = key('bb', p.bbPeriod, Math.round(p.bbMult * 10));
    out[bbKey + '_upper'] = function (s) { return ind.bollinger(s.closes(), p.bbPeriod, p.bbMult).upper; };
    out[bbKey + '_lower'] = function (s) { return ind.bollinger(s.closes(), p.bbPeriod, p.bbMult).lower; };
    out[bbKey + '_mid'] = function (s) { return ind.bollinger(s.closes(), p.bbPeriod, p.bbMult).mid; };
    out[key('rsi', p.rsiPeriod)] = function (s) { return ind.rsi(s.closes(), p.rsiPeriod); };
    out[key('adx', p.adxPeriod)] = function (s) { return ind.adx(s.bars(), p.adxPeriod).adx; };
    out[key('atr', p.atrPeriod)] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
    return out;
  },
  warmupBars: function (p) { return Math.max(p.bbPeriod, p.rsiPeriod * 3, p.adxPeriod * 3, p.atrPeriod * 2) + 5; },
  evaluate: function (ctx) {
    var p = ctx.params;
    var bbKey = key('bb', p.bbPeriod, Math.round(p.bbMult * 10));
    var upK = bbKey + '_upper', loK = bbKey + '_lower', midK = bbKey + '_mid';
    var rsiK = key('rsi', p.rsiPeriod), adxK = key('adx', p.adxPeriod), atrK = key('atr', p.atrPeriod);
    var v = h.need(ctx.view, [upK, loK, midK, rsiK, adxK, atrK]);
    if (v === null) return null;

    if (v[adxK] > p.adxMax) return null; // the veto

    var price = ctx.view.close();
    var direction = null;
    if (price > v[upK] && v[rsiK] >= p.rsiExtreme) direction = 'SHORT';
    else if (price < v[loK] && v[rsiK] <= 100 - p.rsiExtreme) direction = 'LONG';
    if (direction === null) return null;

    var stops = h.atrStops({
      instrument: ctx.instrument, reference: price, direction: direction,
      atr: v[atrK], atrMultiple: p.atrMultiple, rewardRisk: p.rewardRisk
    });
    return h.signal(direction, stops, {
      reference: price,
      // Capped low on purpose. This family's win rate flatters it, and a high
      // confidence here would propagate that flattery into the Jev gate.
      confidence: 0.4,
      reasonCodes: ['BB_EXTREME_' + (direction === 'SHORT' ? 'UPPER' : 'LOWER'), 'RSI_EXTREME', 'ADX_BELOW_VETO'],
      meta: { rsi: v[rsiK], adx: v[adxK], bbUpper: v[upK], bbLower: v[loK], bbMid: v[midK] }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Range trading — buy the low third, sell the high third of a real range
// ---------------------------------------------------------------------------
var rangeTrading = base.define({
  strategyId: 'range-trading',
  family: 'RANGE_TRADING',
  name: 'Position within a Donchian range, gated by a low efficiency ratio',
  version: 1,
  description:
    'Requires the market to be measurably going nowhere (Kaufman efficiency ratio ' +
    'below a threshold) before treating a channel as a range. Without that gate, ' +
    'the "range low" in a downtrend is just a price on the way past.',
  preferredRegimes: ['RANGE', 'LOW_VOLATILITY'],
  defaultParams: {
    channel: 40, erPeriod: 30, erMax: 0.3, zoneFraction: 0.25,
    atrPeriod: 14, atrMultiple: 1, rewardRisk: 1.5
  },
  paramSpace: {
    channel: { min: 10, max: 200, step: 5 },
    erPeriod: { min: 10, max: 100, step: 5 },
    erMax: { min: 0.05, max: 0.8, step: 0.01 },
    zoneFraction: { min: 0.05, max: 0.45, step: 0.05 },
    atrPeriod: { min: 7, max: 28, step: 1 },
    atrMultiple: { min: 0.5, max: 4, step: 0.1 },
    rewardRisk: { min: 0.8, max: 4, step: 0.1 }
  },
  indicators: function (p) {
    var out = {};
    out[key('donchHi', p.channel)] = function (s) { return ind.donchian(s.bars(), p.channel, { excludeCurrent: true }).upper; };
    out[key('donchLo', p.channel)] = function (s) { return ind.donchian(s.bars(), p.channel, { excludeCurrent: true }).lower; };
    out[key('er', p.erPeriod)] = function (s) { return ind.efficiencyRatio(s.closes(), p.erPeriod); };
    out[key('atr', p.atrPeriod)] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
    return out;
  },
  warmupBars: function (p) { return Math.max(p.channel + 2, p.erPeriod + 5, p.atrPeriod * 2) + 5; },
  evaluate: function (ctx) {
    var p = ctx.params;
    var hiK = key('donchHi', p.channel), loK = key('donchLo', p.channel);
    var erK = key('er', p.erPeriod), atrK = key('atr', p.atrPeriod);
    var v = h.need(ctx.view, [hiK, loK, erK, atrK]);
    if (v === null) return null;

    if (v[erK] > p.erMax) return null; // not a range, just a slow trend
    var width = v[hiK] - v[loK];
    if (!(width > 0)) return null;

    var price = ctx.view.close();
    var position = (price - v[loK]) / width;
    // Outside the channel entirely means the range has broken, not that it is
    // deeply oversold.
    if (position < 0 || position > 1) return null;

    var direction = null, level = null;
    if (position <= p.zoneFraction) { direction = 'LONG'; level = v[loK]; }
    else if (position >= 1 - p.zoneFraction) { direction = 'SHORT'; level = v[hiK]; }
    if (direction === null) return null;

    var stops = h.structureStops({
      instrument: ctx.instrument, reference: price, direction: direction,
      level: level, atr: v[atrK], bufferAtr: p.atrMultiple * 0.5, rewardRisk: p.rewardRisk
    });
    if (stops === null) return null;
    return h.signal(direction, stops, {
      reference: price,
      confidence: 0.45,
      reasonCodes: ['RANGE_CONFIRMED_ER', direction === 'LONG' ? 'AT_RANGE_LOW' : 'AT_RANGE_HIGH'],
      meta: { efficiencyRatio: v[erK], rangeHigh: v[hiK], rangeLow: v[loK], positionInRange: position }
    });
  }
});

module.exports = [meanReversion, rangeTrading];
