'use strict';
// =====================================================
// MYTHOS TRADING AGENT — session strategy family
// projects/mythos-trading-agent/src/strategy/families/session.js
//
// Session-based strategies (mission §4): the opening-range break.
//
// A note on a limitation that is real and is not hidden. Session boundaries here
// are UTC hours, so the London and New York opens drift by one hour across
// daylight-saving transitions (docs/COMPLIANCE_AND_RISK.md §3.5). For a strategy
// whose entire premise is "what happens in the first hour after an open", that
// drift is not cosmetic — it means roughly half the year is measured against a
// window shifted by a bar or four. The strategy is still worth having and
// measuring; the result must be read with that caveat attached, and the Research
// Agent should be pointed at it before any conclusion is drawn.
// =====================================================

var base = require('../base');
var h = require('../helpers');
var ind = require('../../indicators');
var clock = require('../../core/clock');

var key = base.key;

var openingRangeBreak = base.define({
  strategyId: 'session-opening-range',
  family: 'SESSION_BASED',
  name: 'Opening-range break after a session open',
  version: 1,
  description:
    'Builds a range from the first `rangeBars` bars after the session open, then ' +
    'trades a close beyond it within `windowBars`. State lives in ctx.state, keyed ' +
    'per run, so nothing leaks between runs or between symbols.',
  preferredRegimes: ['BREAKOUT', 'TREND', 'HIGH_VOLATILITY'],
  defaultParams: {
    sessionHourUtc: 7,      // ~London open in winter; see the header caveat
    rangeBars: 4,
    windowBars: 16,
    atrPeriod: 14,
    atrMultiple: 1,
    rewardRisk: 2,
    minRangeAtr: 0.5
  },
  paramSpace: {
    sessionHourUtc: { min: 0, max: 23, step: 1 },
    rangeBars: { min: 1, max: 24, step: 1 },
    windowBars: { min: 2, max: 96, step: 1 },
    atrPeriod: { min: 7, max: 28, step: 1 },
    atrMultiple: { min: 0.5, max: 4, step: 0.1 },
    rewardRisk: { min: 0.5, max: 5, step: 0.1 },
    minRangeAtr: { min: 0, max: 4, step: 0.1 }
  },
  indicators: function (p) {
    var out = {};
    out[key('atr', p.atrPeriod)] = function (s) { return ind.atr(s.bars(), p.atrPeriod); };
    return out;
  },
  warmupBars: function (p) { return Math.max(p.atrPeriod * 2, p.rangeBars + p.windowBars) + 5; },
  evaluate: function (ctx) {
    var p = ctx.params;
    var atrK = key('atr', p.atrPeriod);
    var atr = h.value(ctx.view, atrK, 0);
    if (atr === null || !(atr > 0)) return null;

    var bar = ctx.view.current();
    var dayKey = clock.dayKey(bar.ts);
    var hour = clock.hour(bar.ts);
    var st = ctx.state;

    // A new session starts on the first bar of the configured hour on a new day.
    if (st.sessionDay !== dayKey && hour === p.sessionHourUtc) {
      st.sessionDay = dayKey;
      st.startIndex = ctx.barIndex;
      st.high = bar.high;
      st.low = bar.low;
      st.rangeComplete = false;
      st.traded = false;
      return null;
    }
    if (st.sessionDay !== dayKey || st.startIndex === undefined) return null;

    var age = ctx.barIndex - st.startIndex;

    // Building the opening range.
    if (age < p.rangeBars) {
      if (bar.high > st.high) st.high = bar.high;
      if (bar.low < st.low) st.low = bar.low;
      return null;
    }
    if (!st.rangeComplete) st.rangeComplete = true;
    if (st.traded) return null;
    if (age > p.rangeBars + p.windowBars) return null;

    var width = st.high - st.low;
    // A range narrower than the noise floor is not a range worth breaking.
    if (!(width >= atr * p.minRangeAtr)) return null;

    var price = bar.close;
    var direction = null, level = null;
    if (price > st.high) { direction = 'LONG'; level = st.low; }
    else if (price < st.low) { direction = 'SHORT'; level = st.high; }
    if (direction === null) return null;

    st.traded = true; // one attempt per session, so a choppy open cannot churn

    // The stop sits at the opposite side of the opening range, capped by an ATR
    // multiple so a very wide opening range cannot demand a huge stop.
    var atrStop = h.atrStops({
      instrument: ctx.instrument, reference: price, direction: direction,
      atr: atr, atrMultiple: p.atrMultiple * 2, rewardRisk: p.rewardRisk
    });
    var structural = h.structureStops({
      instrument: ctx.instrument, reference: price, direction: direction,
      level: level, atr: atr, bufferAtr: 0.1, rewardRisk: p.rewardRisk
    });
    var stops = structural;
    if (structural === null) {
      stops = atrStop;
    } else if (direction === 'LONG' && structural.stopLoss < atrStop.stopLoss) {
      stops = atrStop;
    } else if (direction === 'SHORT' && structural.stopLoss > atrStop.stopLoss) {
      stops = atrStop;
    }

    return h.signal(direction, stops, {
      reference: price,
      confidence: 0.5,
      reasonCodes: ['SESSION_OPEN_' + p.sessionHourUtc + 'UTC', 'OPENING_RANGE_BREAK_' + direction],
      meta: {
        sessionDay: dayKey,
        openingHigh: st.high,
        openingLow: st.low,
        rangeAtr: width / atr,
        barsSinceOpen: age,
        stopSource: stops === atrStop ? 'ATR_CAP' : 'OPPOSITE_RANGE_EDGE'
      }
    });
  }
});

module.exports = [openingRangeBreak];
