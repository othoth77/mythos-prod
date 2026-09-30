'use strict';
// =====================================================
// MYTHOS TRADING AGENT — timeframe aggregation and alignment
// projects/mythos-trading-agent/src/data/resample.js
//
// Multi-timeframe strategies are where look-ahead usually enters a backtest,
// and it enters through a single mistake: reading the H4 bar that CONTAINS the
// current M15 bar. That H4 bar has not closed yet. Its high, low and close are
// partly in the future, so a "trend filter" built on it is reading tomorrow's
// newspaper.
//
// alignCompleted() is the fix, and it is the reason this file exists rather
// than a one-line group-by. For each base bar it returns the index of the last
// higher-timeframe bar that had already CLOSED by the base bar's close —
// never the bar in progress. Strategies receive that index and cannot reach
// the in-progress bar at all.
//
// resample() likewise drops a trailing incomplete bucket rather than emitting a
// half-formed bar that would later change.
// =====================================================

var clock = require('../core/clock');
var enums = require('../core/enums');
var errors = require('../core/errors');

/**
 * Aggregates bars into a higher timeframe.
 *
 * @param {object[]} bars ascending bars of `fromTf`
 * @param {string} fromTf
 * @param {string} toTf must be a whole multiple of fromTf
 * @param {object} [opts]
 * @param {boolean} [opts.keepIncomplete=false] emit the trailing partial bucket
 * @returns {object[]} higher-timeframe bars
 */
function resample(bars, fromTf, toTf, opts) {
  var o = opts || {};
  enums.assertEnum(enums.Timeframe, fromTf, 'fromTf');
  enums.assertEnum(enums.Timeframe, toTf, 'toTf');
  var fromMin = clock.timeframeMinutes(fromTf);
  var toMin = clock.timeframeMinutes(toTf);
  if (toMin < fromMin) {
    throw errors.DataError('cannot resample ' + fromTf + ' up to ' + toTf + ': the target is smaller');
  }
  if (toMin % fromMin !== 0) {
    throw errors.DataError(fromTf + ' does not divide ' + toTf + ' evenly (' + fromMin + ' into ' + toMin + ')');
  }
  if (bars.length === 0) return [];

  var stepFrom = fromMin * clock.MINUTE;
  var stepTo = toMin * clock.MINUTE;
  var perBucket = toMin / fromMin;

  var out = [];
  var cur = null;
  var count = 0;

  for (var i = 0; i < bars.length; i++) {
    var b = bars[i];
    var bucketTs = Math.floor(b.ts / stepTo) * stepTo;
    if (cur === null || bucketTs !== cur.ts) {
      if (cur !== null) out.push(finish(cur, count, perBucket));
      cur = { ts: bucketTs, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, lastTs: b.ts };
      count = 1;
    } else {
      if (b.high > cur.high) cur.high = b.high;
      if (b.low < cur.low) cur.low = b.low;
      cur.close = b.close;
      cur.volume += b.volume;
      cur.lastTs = b.ts;
      count++;
    }
  }
  if (cur !== null) out.push(finish(cur, count, perBucket));

  // The trailing bucket is complete only when its last constituent bar ends at
  // the bucket boundary. A market that is closed for part of a bucket (the FX
  // weekend, an instrument's session window) legitimately produces fewer bars,
  // so completeness is tested against the CLOCK, not against the bar count.
  var last = out[out.length - 1];
  if (last && !o.keepIncomplete) {
    var expectedEnd = last.ts + stepTo;
    if (last.lastTs + stepFrom < expectedEnd) out.pop();
  }
  return out.map(function (b) {
    return { ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, sourceBars: b.sourceBars };
  });
}

function finish(cur, count, perBucket) {
  cur.sourceBars = count;
  cur.partial = count < perBucket;
  return cur;
}

/**
 * For each base bar, the index of the last higher-timeframe bar that had
 * already closed by that base bar's close. -1 until the first one closes.
 *
 * @param {object[]} baseBars
 * @param {string} baseTf
 * @param {object[]} higherBars
 * @param {string} higherTf
 * @returns {number[]} same length as baseBars
 */
function alignCompleted(baseBars, baseTf, higherBars, higherTf) {
  var stepBase = clock.timeframeMinutes(baseTf) * clock.MINUTE;
  var stepHigher = clock.timeframeMinutes(higherTf) * clock.MINUTE;
  var out = new Array(baseBars.length);
  var h = -1;
  for (var i = 0; i < baseBars.length; i++) {
    var baseClose = baseBars[i].ts + stepBase;
    // Advance while the NEXT higher bar has also finished by this moment.
    while (h + 1 < higherBars.length && higherBars[h + 1].ts + stepHigher <= baseClose) h++;
    out[i] = h;
  }
  return out;
}

/**
 * Convenience: build the higher series and its alignment in one call.
 * @returns {{bars: object[], align: number[], timeframe: string}}
 */
function higherTimeframeView(baseBars, baseTf, higherTf) {
  var hb = resample(baseBars, baseTf, higherTf);
  return { bars: hb, align: alignCompleted(baseBars, baseTf, hb, higherTf), timeframe: higherTf };
}

module.exports = {
  resample: resample,
  alignCompleted: alignCompleted,
  higherTimeframeView: higherTimeframeView
};
