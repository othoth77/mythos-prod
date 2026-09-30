'use strict';
// =====================================================
// MYTHOS TRADING AGENT — shared strategy helpers
// projects/mythos-trading-agent/src/strategy/helpers.js
//
// Behaviour every strategy needs, written once so it is right once.
//
// The most important helper is `need()`. Indicators return null during warmup,
// and a strategy that treats null as 0 produces signals from nothing — an ATR of
// null read as 0 gives a zero-width stop, which then divides a position size to
// infinity. need() returns null the moment any requested value is missing, so
// the strategy's own guard clause is a single line and cannot be half-written.
//
// `atrStops()` is the second: stops are placed at a volatility multiple rather
// than a fixed pip distance, because a 20-pip stop is loose on EURUSD and absurd
// on gold, and the whole platform is meant to be measurable across both.
// =====================================================

var instrumentMod = require('../core/instrument');
var money = require('../core/money');
var enums = require('../core/enums');

/**
 * Reads several indicator values at one offset, returning null if ANY is missing.
 * @param {object} view
 * @param {string[]} names
 * @param {number} [offset=0]
 * @returns {object|null} { name: value }
 */
function need(view, names, offset) {
  var out = {};
  for (var i = 0; i < names.length; i++) {
    var v = view.indicator(names[i], offset === undefined ? 0 : offset);
    if (v === null || v === undefined) return null;
    out[names[i]] = v;
  }
  return out;
}

/** Reads one indicator value, or null. */
function value(view, name, offset) {
  var v = view.indicator(name, offset === undefined ? 0 : offset);
  return (v === null || v === undefined) ? null : v;
}

/**
 * Stop and target from an ATR multiple.
 *
 * @param {object} spec
 * @param {object} spec.instrument
 * @param {number} spec.reference entry reference price
 * @param {string} spec.direction
 * @param {number} spec.atr current ATR in price units
 * @param {number} spec.atrMultiple stop distance in ATRs
 * @param {number} spec.rewardRisk target distance as a multiple of the stop
 * @returns {{stopLoss, takeProfit, stopDistance, stopPips}}
 */
function atrStops(spec) {
  var inst = spec.instrument;
  var isLong = spec.direction === enums.Direction.LONG;
  var dist = spec.atr * spec.atrMultiple;
  var stop = isLong ? spec.reference - dist : spec.reference + dist;
  var target = isLong ? spec.reference + dist * spec.rewardRisk : spec.reference - dist * spec.rewardRisk;
  return {
    stopLoss: money.round(stop, inst.digits),
    takeProfit: money.round(target, inst.digits),
    stopDistance: dist,
    stopPips: instrumentMod.toPips(inst, dist)
  };
}

/**
 * Stop just beyond a structural level (a swing high/low), target at a
 * reward/risk multiple of the resulting distance. Returns null when the level is
 * on the wrong side of the entry, which happens legitimately and must not become
 * an inverted trade.
 */
function structureStops(spec) {
  var inst = spec.instrument;
  var isLong = spec.direction === enums.Direction.LONG;
  var buffer = spec.bufferAtr === undefined ? 0 : spec.bufferAtr * spec.atr;
  var stop = isLong ? spec.level - buffer : spec.level + buffer;
  var dist = isLong ? spec.reference - stop : stop - spec.reference;
  if (!(dist > 0)) return null;
  var target = isLong ? spec.reference + dist * spec.rewardRisk : spec.reference - dist * spec.rewardRisk;
  return {
    stopLoss: money.round(stop, inst.digits),
    takeProfit: money.round(target, inst.digits),
    stopDistance: dist,
    stopPips: instrumentMod.toPips(inst, dist)
  };
}

/** Slope of a value series over `lookback` bars, as a fraction of the value. */
function slope(view, indicatorName, lookback) {
  var now = value(view, indicatorName, 0);
  var then = value(view, indicatorName, lookback);
  if (now === null || then === null || then === 0) return null;
  return (now - then) / Math.abs(then);
}

/** True when the last `n` closes are strictly rising. */
function risingCloses(view, n) {
  var w = view.closes(n);
  if (w === null) return false;
  for (var i = 1; i < w.length; i++) if (!(w[i] > w[i - 1])) return false;
  return true;
}

function fallingCloses(view, n) {
  var w = view.closes(n);
  if (w === null) return false;
  for (var i = 1; i < w.length; i++) if (!(w[i] < w[i - 1])) return false;
  return true;
}

/**
 * True when `a` crossed above `b` on this bar: below or equal one bar ago and
 * above now. The "or equal" matters — with rounded prices an exact touch is
 * common, and requiring strict inequality on both sides drops real crosses.
 */
function crossedAbove(view, aName, bName) {
  var aNow = value(view, aName, 0), bNow = value(view, bName, 0);
  var aPrev = value(view, aName, 1), bPrev = value(view, bName, 1);
  if (aNow === null || bNow === null || aPrev === null || bPrev === null) return false;
  return aPrev <= bPrev && aNow > bNow;
}

function crossedBelow(view, aName, bName) {
  var aNow = value(view, aName, 0), bNow = value(view, bName, 0);
  var aPrev = value(view, aName, 1), bPrev = value(view, bName, 1);
  if (aNow === null || bNow === null || aPrev === null || bPrev === null) return false;
  return aPrev >= bPrev && aNow < bNow;
}

/** Distance from `price` to `level`, in ATRs. Useful for proximity tests. */
function atrDistance(price, level, atr) {
  if (!(atr > 0)) return null;
  return Math.abs(price - level) / atr;
}

/** A signal object with the fields base.js expects. */
function signal(direction, stops, opts) {
  var o = opts || {};
  return {
    direction: direction,
    referencePrice: o.reference,
    stopLoss: stops.stopLoss,
    takeProfit: stops.takeProfit,
    confidence: o.confidence,
    reasonCodes: o.reasonCodes || [],
    meta: Object.assign({ stopPips: money.round(stops.stopPips, 3) }, o.meta || {})
  };
}

/** The opposite direction. */
function opposite(direction) {
  return direction === enums.Direction.LONG ? enums.Direction.SHORT : enums.Direction.LONG;
}

module.exports = {
  need: need,
  value: value,
  atrStops: atrStops,
  structureStops: structureStops,
  slope: slope,
  risingCloses: risingCloses,
  fallingCloses: fallingCloses,
  crossedAbove: crossedAbove,
  crossedBelow: crossedBelow,
  atrDistance: atrDistance,
  signal: signal,
  opposite: opposite
};
