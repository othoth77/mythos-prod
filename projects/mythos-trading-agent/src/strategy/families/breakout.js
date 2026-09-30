'use strict';
// =====================================================
// MYTHOS TRADING AGENT — breakout strategy families
// projects/mythos-trading-agent/src/strategy/families/breakout.js
//
// Breakout, breakout-retest and volatility-expansion (mission §4).
//
// Every channel here uses `donchian(..., { excludeCurrent: true })`. With the
// current bar inside the channel, "close above the highest high of the last N
// bars" compares the bar against itself and can never trigger cleanly — the kind
// of off-by-one that produces a strategy which appears to work and is actually
// measuring nothing.
//
// The retest variant needs memory across bars, and it uses `ctx.state` — a bag
// the portfolio creates per (run, symbol, strategy) and hands in. It is NOT module
// state: module state would leak between runs and make two runs of one
// configuration disagree, which is the reproducibility property the whole
// platform rests on. It also cannot reach forward, because it is only ever
// written on the bar being evaluated.
// =====================================================

var base = require('../base');
var h = require('../helpers');
var ind = require('../../indicators');
var instrumentMod = require('../../core/instrument');

var key = base.key;

// ---------------------------------------------------------------------------
// 1. Breakout — close beyond the prior N-bar extreme, with expansion
// ---------------------------------------------------------------------------
var breakout = base.define({
  strategyId: 'breakout',
  family: 'BREAKOUT',
  name: 'Donchian channel break with volatility expansion',
  version: 1,
  description:
    'Requires both a close beyond the prior N-bar extreme AND volatility that is ' +
    'expanding. A break on contracting volatility is usually the last tick of a ' +
    'range rather than the first of a move.',
  preferredRegimes: ['BREAKOUT', 'HIGH_VOLATILITY'],
  defaultParams: { channel: 40, atrPeriod: 14, atrMultiple: 1.5, rewardRisk: 2, volRatioMin: 1.05, volShort: 5, volLong: 50 },
  paramSpace: {
    channel: { min: 10, max: 200, step: 5 },
    atrPeriod: { min: 7, max: 28, step: 1 },
    atrMultiple: { min: 0.5, max: 4, step: 0.1 },
    rewardRisk: { min: 0.5, max: 5, step: 0.1 },
    volRatioMin: { min: 0.5, max: 3, step: 0.05 },
    volShort: { min: 2, max: 20, step: 1 },
    volLong: { min: 20, max: 200, step: 5 }
  },
  indicators: function (p) {
    var out = {};
    out[key('donchHi', p.channel)] = function (s) { return ind.donchian(s.bars(), p.channel, { excludeCurrent: true }).upper; };
    out[key('donchLo', p.channel)] = function (s) { return ind.donchian(s.bars(), p.channel, { excludeCurrent: true }).lower; };
    out[key('atr', p.atrPeriod)] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
    out[key('volRatio', p.volShort, p.volLong)] = function (s) { return ind.volatilityRatio(s.bars(), p.volShort, p.volLong); };
    return out;
  },
  warmupBars: function (p) { return Math.max(p.channel + 2, p.volLong + 5, p.atrPeriod * 2) + 5; },
  evaluate: function (ctx) {
    var p = ctx.params;
    var hiK = key('donchHi', p.channel), loK = key('donchLo', p.channel);
    var atrK = key('atr', p.atrPeriod), volK = key('volRatio', p.volShort, p.volLong);
    var v = h.need(ctx.view, [hiK, loK, atrK, volK]);
    if (v === null) return null;
    if (v[volK] < p.volRatioMin) return null;

    var price = ctx.view.close();
    var direction = null;
    if (price > v[hiK]) direction = 'LONG';
    else if (price < v[loK]) direction = 'SHORT';
    if (direction === null) return null;

    var stops = h.atrStops({
      instrument: ctx.instrument, reference: price, direction: direction,
      atr: v[atrK], atrMultiple: p.atrMultiple, rewardRisk: p.rewardRisk
    });
    return h.signal(direction, stops, {
      reference: price,
      confidence: Math.min(0.75, 0.4 + (v[volK] - p.volRatioMin) * 0.3),
      reasonCodes: ['CHANNEL_BREAK_' + direction, 'VOL_EXPANDING'],
      meta: { channelHigh: v[hiK], channelLow: v[loK], volRatio: v[volK] }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Breakout retest — wait for price to come back to the broken level
// ---------------------------------------------------------------------------
var breakoutRetest = base.define({
  strategyId: 'breakout-retest',
  family: 'BREAKOUT_RETEST',
  name: 'Break of an N-bar extreme, entered on the retest of the broken level',
  version: 1,
  description:
    'Records a break, then waits up to `retestBars` for price to return to the ' +
    'broken level and hold it. Trades fewer breaks than the naive version and ' +
    'misses the ones that never look back — which is the trade-off being measured, ' +
    'not a flaw.',
  preferredRegimes: ['BREAKOUT', 'TREND'],
  defaultParams: { channel: 40, retestBars: 12, retestAtr: 0.35, atrPeriod: 14, atrMultiple: 1.2, rewardRisk: 2.5 },
  paramSpace: {
    channel: { min: 10, max: 200, step: 5 },
    retestBars: { min: 2, max: 50, step: 1 },
    retestAtr: { min: 0.05, max: 2, step: 0.05 },
    atrPeriod: { min: 7, max: 28, step: 1 },
    atrMultiple: { min: 0.5, max: 4, step: 0.1 },
    rewardRisk: { min: 0.5, max: 5, step: 0.1 }
  },
  indicators: function (p) {
    var out = {};
    out[key('donchHi', p.channel)] = function (s) { return ind.donchian(s.bars(), p.channel, { excludeCurrent: true }).upper; };
    out[key('donchLo', p.channel)] = function (s) { return ind.donchian(s.bars(), p.channel, { excludeCurrent: true }).lower; };
    out[key('atr', p.atrPeriod)] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
    return out;
  },
  warmupBars: function (p) { return Math.max(p.channel + 2, p.atrPeriod * 2) + 5; },
  evaluate: function (ctx) {
    var p = ctx.params;
    var hiK = key('donchHi', p.channel), loK = key('donchLo', p.channel), atrK = key('atr', p.atrPeriod);
    var v = h.need(ctx.view, [hiK, loK, atrK]);
    if (v === null) return null;

    var price = ctx.view.close();
    var atr = v[atrK];
    var state = ctx.state.pendingBreak || null;

    // A fresh break replaces any stale pending one: the newer level is the one
    // the market is actually reacting to.
    if (price > v[hiK]) {
      ctx.state.pendingBreak = { direction: 'LONG', level: v[hiK], atIndex: ctx.barIndex };
      return null;
    }
    if (price < v[loK]) {
      ctx.state.pendingBreak = { direction: 'SHORT', level: v[loK], atIndex: ctx.barIndex };
      return null;
    }

    if (state === null) return null;
    var age = ctx.barIndex - state.atIndex;
    if (age <= 0) return null;
    if (age > p.retestBars) {
      ctx.state.pendingBreak = null;
      return null;
    }

    // The retest: price has come back within retestAtr of the level, and is still
    // on the breakout side of it.
    var dist = h.atrDistance(price, state.level, atr);
    if (dist === null || dist > p.retestAtr) return null;
    if (state.direction === 'LONG' && price < state.level) { ctx.state.pendingBreak = null; return null; }
    if (state.direction === 'SHORT' && price > state.level) { ctx.state.pendingBreak = null; return null; }

    ctx.state.pendingBreak = null;
    var stops = h.atrStops({
      instrument: ctx.instrument, reference: price, direction: state.direction,
      atr: atr, atrMultiple: p.atrMultiple, rewardRisk: p.rewardRisk
    });
    return h.signal(state.direction, stops, {
      reference: price,
      confidence: 0.6,
      reasonCodes: ['BREAK_' + state.direction, 'RETEST_HELD'],
      meta: { brokenLevel: state.level, barsSinceBreak: age, retestDistanceAtr: dist }
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Volatility expansion — trade the direction of a sudden range expansion
// ---------------------------------------------------------------------------
var volatilityExpansion = base.define({
  strategyId: 'volatility-expansion',
  family: 'VOLATILITY_EXPANSION',
  name: 'Range expansion bar with a decisive close',
  version: 1,
  description:
    'A bar whose range is a large multiple of recent ATR, closing in the top or ' +
    'bottom third of its own range. Both conditions are needed: a wide bar that ' +
    'closes mid-range is indecision, not direction.',
  preferredRegimes: ['HIGH_VOLATILITY', 'BREAKOUT'],
  defaultParams: { atrPeriod: 14, rangeMultiple: 1.8, closeFraction: 0.66, atrMultiple: 1.5, rewardRisk: 2 },
  paramSpace: {
    atrPeriod: { min: 7, max: 28, step: 1 },
    rangeMultiple: { min: 1, max: 5, step: 0.1 },
    closeFraction: { min: 0.5, max: 0.95, step: 0.01 },
    atrMultiple: { min: 0.5, max: 4, step: 0.1 },
    rewardRisk: { min: 0.5, max: 5, step: 0.1 }
  },
  indicators: function (p) {
    var out = {};
    out[key('atr', p.atrPeriod)] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
    return out;
  },
  warmupBars: function (p) { return p.atrPeriod * 3 + 5; },
  evaluate: function (ctx) {
    var p = ctx.params;
    var atrK = key('atr', p.atrPeriod);
    // ATR one bar back, so the current bar's own range is not part of the
    // baseline it is being compared against.
    var prevAtr = h.value(ctx.view, atrK, 1);
    if (prevAtr === null || !(prevAtr > 0)) return null;

    var bar = ctx.view.current();
    var range = bar.high - bar.low;
    if (!(range >= prevAtr * p.rangeMultiple)) return null;
    if (range === 0) return null;

    var position = (bar.close - bar.low) / range;
    var direction = null;
    if (position >= p.closeFraction) direction = 'LONG';
    else if (position <= 1 - p.closeFraction) direction = 'SHORT';
    if (direction === null) return null;

    var stops = h.atrStops({
      instrument: ctx.instrument, reference: bar.close, direction: direction,
      atr: prevAtr, atrMultiple: p.atrMultiple, rewardRisk: p.rewardRisk
    });
    return h.signal(direction, stops, {
      reference: bar.close,
      confidence: 0.5,
      reasonCodes: ['RANGE_EXPANSION', 'CLOSE_' + (direction === 'LONG' ? 'HIGH' : 'LOW')],
      meta: {
        rangeAtrMultiple: range / prevAtr,
        closePositionInBar: position,
        rangePips: instrumentMod.toPips(ctx.instrument, range)
      }
    });
  }
});

module.exports = [breakout, breakoutRetest, volatilityExpansion];
