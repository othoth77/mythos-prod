'use strict';
// =====================================================
// MYTHOS TRADING AGENT — bar shape and series validation
// projects/mythos-trading-agent/src/data/bar.js
//
// A bar is [ts, open, high, low, close, volume] with ts the bar's OPEN time in
// UTC epoch ms. Storing the open time rather than the close time is the choice
// that keeps look-ahead honest: "the bar at 13:00" then means "the bar that
// starts at 13:00 and whose outcome is not known until 13:15", and a strategy
// evaluating at bar i is evaluating on information that existed by its close.
//
// validateSeries() is strict because every downstream guarantee rests on it. An
// out-of-order timestamp silently reorders an equity curve; a high below a close
// makes a stop-fill test pass that should have failed; a duplicate timestamp
// double-counts a trade's holding period.
// =====================================================

var errors = require('../core/errors');
var clock = require('../core/clock');
var enums = require('../core/enums');

/** Builds a validated bar. */
function make(ts, open, high, low, close, volume) {
  var b = {
    ts: ts, open: open, high: high, low: low, close: close,
    volume: volume === undefined ? 0 : volume
  };
  var problem = barProblem(b);
  if (problem) throw errors.DataError('invalid bar at ' + clock.iso(ts) + ': ' + problem, { bar: b });
  return b;
}

/** Returns a description of what is wrong with a bar, or null. */
function barProblem(b) {
  if (!b || typeof b !== 'object') return 'not an object';
  var nums = ['ts', 'open', 'high', 'low', 'close', 'volume'];
  for (var i = 0; i < nums.length; i++) {
    var v = b[nums[i]];
    if (typeof v !== 'number' || !isFinite(v)) return nums[i] + ' is not a finite number (' + JSON.stringify(v) + ')';
  }
  if (b.high < b.low) return 'high ' + b.high + ' is below low ' + b.low;
  if (b.high < b.open || b.high < b.close) return 'high ' + b.high + ' is below open/close';
  if (b.low > b.open || b.low > b.close) return 'low ' + b.low + ' is above open/close';
  if (b.open <= 0 || b.close <= 0 || b.high <= 0 || b.low <= 0) return 'non-positive price';
  if (b.volume < 0) return 'negative volume';
  return null;
}

/** The bar's full range, high − low. */
function range(b) { return b.high - b.low; }

/** Body size, |close − open|. */
function body(b) { return Math.abs(b.close - b.open); }

/** Upper wick length. */
function upperWick(b) { return b.high - Math.max(b.open, b.close); }

/** Lower wick length. */
function lowerWick(b) { return Math.min(b.open, b.close) - b.low; }

/** True when the bar closed above its open. */
function isBullish(b) { return b.close > b.open; }
function isBearish(b) { return b.close < b.open; }

/** Typical price (H+L+C)/3 — the reference price for cost estimation. */
function typical(b) { return (b.high + b.low + b.close) / 3; }

/**
 * Validates a whole series.
 *
 * @param {object[]} bars
 * @param {object} [opts]
 * @param {string} [opts.timeframe] when given, every bar must sit on that grid
 * @param {boolean} [opts.requireContiguous=false] treat any gap as an error
 * @returns {{bars: number, gaps: Array, firstTs: number, lastTs: number}}
 * @throws {DataError} on the first structural problem
 */
function validateSeries(bars, opts) {
  var o = opts || {};
  if (!Array.isArray(bars)) throw errors.DataError('series must be an array');
  if (bars.length === 0) throw errors.DataError('series is empty');

  var stepMs = null;
  if (o.timeframe) {
    enums.assertEnum(enums.Timeframe, o.timeframe, 'timeframe');
    stepMs = clock.timeframeMinutes(o.timeframe) * clock.MINUTE;
  }

  var gaps = [];
  for (var i = 0; i < bars.length; i++) {
    var b = bars[i];
    var problem = barProblem(b);
    if (problem) {
      throw errors.DataError('bar ' + i + ' is invalid: ' + problem, { index: i, bar: b });
    }
    if (stepMs !== null && b.ts % stepMs !== 0) {
      throw errors.DataError(
        'bar ' + i + ' at ' + clock.iso(b.ts) + ' is not aligned to the ' + o.timeframe + ' grid',
        { index: i, ts: b.ts, timeframe: o.timeframe }
      );
    }
    if (i > 0) {
      var prev = bars[i - 1];
      if (b.ts === prev.ts) {
        throw errors.DataError('duplicate timestamp at index ' + i + ': ' + clock.iso(b.ts), { index: i });
      }
      if (b.ts < prev.ts) {
        throw errors.DataError(
          'series is not ascending: bar ' + i + ' (' + clock.iso(b.ts) + ') precedes bar ' + (i - 1) + ' (' + clock.iso(prev.ts) + ')',
          { index: i }
        );
      }
      if (stepMs !== null && b.ts - prev.ts !== stepMs) {
        var gap = { index: i, fromTs: prev.ts, toTs: b.ts, missingBars: Math.round((b.ts - prev.ts) / stepMs) - 1 };
        if (o.requireContiguous) {
          throw errors.DataError(
            'gap of ' + gap.missingBars + ' bar(s) before index ' + i + ' (' + clock.iso(prev.ts) + ' → ' + clock.iso(b.ts) + ')',
            gap
          );
        }
        gaps.push(gap);
      }
    }
  }

  return {
    bars: bars.length,
    gaps: gaps,
    firstTs: bars[0].ts,
    lastTs: bars[bars.length - 1].ts
  };
}

/** Index of the last bar at or before `ts`, or -1. Binary search. */
function indexAtOrBefore(bars, ts) {
  var lo = 0, hi = bars.length - 1, best = -1;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    if (bars[mid].ts <= ts) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best;
}

/** Bars whose ts is in [fromTs, toTs). Used for in-sample/out-of-sample cuts. */
function slice(bars, fromTs, toTs) {
  return bars.filter(function (b) {
    return (fromTs === undefined || b.ts >= fromTs) && (toTs === undefined || b.ts < toTs);
  });
}

module.exports = {
  make: make,
  barProblem: barProblem,
  range: range,
  body: body,
  upperWick: upperWick,
  lowerWick: lowerWick,
  isBullish: isBullish,
  isBearish: isBearish,
  typical: typical,
  validateSeries: validateSeries,
  indexAtOrBefore: indexAtOrBefore,
  slice: slice
};
