'use strict';
// =====================================================
// MYTHOS TRADING AGENT — indicator library
// projects/mythos-trading-agent/src/indicators/index.js
//
// ONE RULE GOVERNS THIS ENTIRE FILE: every function is CAUSAL. The value at
// index j may depend on inputs 0..j and on nothing at j+1 or later. That is
// what lets src/data/series.js precompute indicators over a whole array and
// still hand strategies a view that cannot see the future.
//
// The rule has exactly one place it is easy to break, and it is handled
// explicitly rather than avoided: SWING PIVOTS. A pivot high at bar j is only
// knowable after `right` further bars have closed. Returning it at index j
// would be look-ahead — a backtest would "recognise" tops in real time that a
// live system could not. swings() therefore publishes a pivot at index
// j + right, the bar on which it actually became known, and the delay is
// visible in the returned `lastHighIndex` array.
//
// Every function returns an array the same length as its input, with `null`
// during warmup. `null` means "not computable yet", never 0 — a zero ATR would
// silently divide a position size to infinity.
// =====================================================

var errors = require('../core/errors');

function assertPeriod(p, name) {
  if (typeof p !== 'number' || p !== Math.floor(p) || p < 1) {
    throw errors.DataError(name + ' period must be a positive integer, got ' + JSON.stringify(p));
  }
  return p;
}

function filled(n, v) {
  var a = new Array(n);
  for (var i = 0; i < n; i++) a[i] = v;
  return a;
}

/** Keeps a percentage-valued indicator inside 0..100 despite float error. */
function clamp100(v) {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

// ---------------------------------------------------------------------------
// Moving averages and dispersion
// ---------------------------------------------------------------------------

/** Simple moving average. First value at index period-1. */
function sma(values, period) {
  assertPeriod(period, 'sma');
  var out = filled(values.length, null);
  var sum = 0;
  for (var i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential moving average, seeded with the SMA of the first `period` values
 * so the series does not depend on how much history happened to be loaded.
 */
function ema(values, period) {
  assertPeriod(period, 'ema');
  var out = filled(values.length, null);
  if (values.length < period) return out;
  var k = 2 / (period + 1);
  var seed = 0;
  for (var i = 0; i < period; i++) seed += values[i];
  var prev = seed / period;
  out[period - 1] = prev;
  for (var j = period; j < values.length; j++) {
    prev = values[j] * k + prev * (1 - k);
    out[j] = prev;
  }
  return out;
}

/** Population standard deviation over a rolling window. */
function stdev(values, period) {
  assertPeriod(period, 'stdev');
  var out = filled(values.length, null);
  var sum = 0, sumSq = 0;
  for (var i = 0; i < values.length; i++) {
    sum += values[i]; sumSq += values[i] * values[i];
    if (i >= period) {
      var drop = values[i - period];
      sum -= drop; sumSq -= drop * drop;
    }
    if (i >= period - 1) {
      var mean = sum / period;
      var varv = sumSq / period - mean * mean;
      out[i] = Math.sqrt(varv > 0 ? varv : 0);
    }
  }
  return out;
}

/** Rate of change over `period` bars, as a fraction. */
function roc(values, period) {
  assertPeriod(period, 'roc');
  var out = filled(values.length, null);
  for (var i = period; i < values.length; i++) {
    var base = values[i - period];
    out[i] = base === 0 ? null : (values[i] - base) / base;
  }
  return out;
}

/** Slope of an ordinary least-squares fit over the last `period` values. */
function linregSlope(values, period) {
  assertPeriod(period, 'linregSlope');
  var out = filled(values.length, null);
  // x is 0..period-1, so sums over x are constant.
  var n = period;
  var sumX = n * (n - 1) / 2;
  var sumXX = (n - 1) * n * (2 * n - 1) / 6;
  var denom = n * sumXX - sumX * sumX;
  if (denom === 0) return out;
  for (var i = period - 1; i < values.length; i++) {
    var sumY = 0, sumXY = 0;
    for (var k = 0; k < n; k++) {
      var y = values[i - n + 1 + k];
      sumY += y; sumXY += k * y;
    }
    out[i] = (n * sumXY - sumX * sumY) / denom;
  }
  return out;
}

/** Bollinger bands: { upper, mid, lower, bandwidth }. */
function bollinger(values, period, mult) {
  var m = mult === undefined ? 2 : mult;
  var mid = sma(values, period);
  var sd = stdev(values, period);
  var upper = filled(values.length, null);
  var lower = filled(values.length, null);
  var bandwidth = filled(values.length, null);
  for (var i = 0; i < values.length; i++) {
    if (mid[i] === null || sd[i] === null) continue;
    upper[i] = mid[i] + m * sd[i];
    lower[i] = mid[i] - m * sd[i];
    bandwidth[i] = mid[i] === 0 ? null : (upper[i] - lower[i]) / mid[i];
  }
  return { upper: upper, mid: mid, lower: lower, bandwidth: bandwidth };
}

// ---------------------------------------------------------------------------
// Volatility
// ---------------------------------------------------------------------------

/** True range. The first bar has no previous close, so it is high − low. */
function trueRange(bars) {
  var out = filled(bars.length, null);
  for (var i = 0; i < bars.length; i++) {
    var b = bars[i];
    if (i === 0) { out[i] = b.high - b.low; continue; }
    var pc = bars[i - 1].close;
    out[i] = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  }
  return out;
}

/**
 * Wilder's smoothing of a value array: seeded with the mean of the first
 * `period` defined values, then avg[i] = (avg[i-1]*(period-1) + v[i]) / period.
 */
function wilderSmooth(values, period, firstDefined) {
  assertPeriod(period, 'wilderSmooth');
  var start = firstDefined === undefined ? 0 : firstDefined;
  var out = filled(values.length, null);
  var seedEnd = start + period - 1;
  if (seedEnd >= values.length) return out;
  var sum = 0;
  for (var i = start; i <= seedEnd; i++) sum += values[i];
  var prev = sum / period;
  out[seedEnd] = prev;
  for (var j = seedEnd + 1; j < values.length; j++) {
    prev = (prev * (period - 1) + values[j]) / period;
    out[j] = prev;
  }
  return out;
}

/** Average True Range (Wilder). */
function atr(bars, period) {
  return wilderSmooth(trueRange(bars), period, 0);
}

/** ATR expressed as a fraction of close — comparable across instruments. */
function atrPercent(bars, period) {
  var a = atr(bars, period);
  var out = filled(bars.length, null);
  for (var i = 0; i < bars.length; i++) {
    if (a[i] === null || bars[i].close === 0) continue;
    out[i] = a[i] / bars[i].close;
  }
  return out;
}

/** Relative Strength Index (Wilder). Range 0-100. */
function rsi(values, period) {
  assertPeriod(period, 'rsi');
  var out = filled(values.length, null);
  if (values.length <= period) return out;
  var gains = 0, losses = 0;
  for (var i = 1; i <= period; i++) {
    var d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  var avgGain = gains / period;
  var avgLoss = losses / period;
  out[period] = rsiFrom(avgGain, avgLoss);
  for (var j = period + 1; j < values.length; j++) {
    var delta = values[j] - values[j - 1];
    var g = delta > 0 ? delta : 0;
    var l = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[j] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiFrom(avgGain, avgLoss) {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  var rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Average Directional Index with its directional components.
 * @returns {{adx: Array, plusDI: Array, minusDI: Array}}
 */
function adx(bars, period) {
  assertPeriod(period, 'adx');
  var n = bars.length;
  var tr = trueRange(bars);
  var plusDM = filled(n, 0);
  var minusDM = filled(n, 0);
  for (var i = 1; i < n; i++) {
    var up = bars[i].high - bars[i - 1].high;
    var down = bars[i - 1].low - bars[i].low;
    plusDM[i] = (up > down && up > 0) ? up : 0;
    minusDM[i] = (down > up && down > 0) ? down : 0;
  }
  // Directional movement is undefined on bar 0, so smoothing starts at bar 1.
  var trS = wilderSmooth(tr, period, 1);
  var plusS = wilderSmooth(plusDM, period, 1);
  var minusS = wilderSmooth(minusDM, period, 1);

  var plusDI = filled(n, null);
  var minusDI = filled(n, null);
  var dx = filled(n, null);
  for (var j = 0; j < n; j++) {
    if (trS[j] === null || trS[j] === 0) continue;
    // Clamped to 0..100 because these are defined as percentages and floating
    // point can land a hair outside (a perfectly directional series produced
    // 100.00000000000001). A caller comparing against a 100 threshold should
    // never have to defend against that.
    plusDI[j] = clamp100(100 * plusS[j] / trS[j]);
    minusDI[j] = clamp100(100 * minusS[j] / trS[j]);
    var denom = plusDI[j] + minusDI[j];
    dx[j] = denom === 0 ? 0 : clamp100(100 * Math.abs(plusDI[j] - minusDI[j]) / denom);
  }
  var firstDx = dx.findIndex(function (v) { return v !== null; });
  var adxArr = firstDx === -1 ? filled(n, null) : wilderSmooth(dx.map(function (v) { return v === null ? 0 : v; }), period, firstDx);
  // Blank the positions where DX itself was undefined, and clamp the smoothed
  // result for the same reason the components are clamped.
  for (var k = 0; k < n; k++) {
    if (dx[k] === null) adxArr[k] = null;
    else if (adxArr[k] !== null) adxArr[k] = clamp100(adxArr[k]);
  }

  return { adx: adxArr, plusDI: plusDI, minusDI: minusDI };
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

/**
 * Donchian channel over `period` bars.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.excludeCurrent=false] when true the channel covers the
 *        `period` bars BEFORE the current one. Breakout strategies need this:
 *        with the current bar included, "close above the highest high" compares
 *        the bar against itself and can never trigger cleanly.
 */
function donchian(bars, period, opts) {
  assertPeriod(period, 'donchian');
  var exclude = !!(opts && opts.excludeCurrent);
  var n = bars.length;
  var upper = filled(n, null);
  var lower = filled(n, null);
  var mid = filled(n, null);
  var offset = exclude ? 1 : 0;
  for (var i = period - 1 + offset; i < n; i++) {
    var hi = -Infinity, lo = Infinity;
    for (var k = 0; k < period; k++) {
      var b = bars[i - offset - k];
      if (b.high > hi) hi = b.high;
      if (b.low < lo) lo = b.low;
    }
    upper[i] = hi; lower[i] = lo; mid[i] = (hi + lo) / 2;
  }
  return { upper: upper, lower: lower, mid: mid };
}

/**
 * Swing pivots, published on the bar they become KNOWN — see the file header.
 *
 * @returns {{
 *   highAt: Array, lowAt: Array,          // pivot confirmed exactly at this bar
 *   lastHigh: Array, lastLow: Array,      // most recent confirmed pivot value
 *   lastHighIndex: Array, lastLowIndex: Array,  // the bar the pivot occurred on
 *   prevHigh: Array, prevLow: Array       // the one before that
 * }}
 */
function swings(bars, left, right) {
  assertPeriod(left, 'swings left');
  assertPeriod(right, 'swings right');
  var n = bars.length;
  var highAt = filled(n, null);
  var lowAt = filled(n, null);
  var lastHigh = filled(n, null);
  var lastLow = filled(n, null);
  var lastHighIndex = filled(n, null);
  var lastLowIndex = filled(n, null);
  var prevHigh = filled(n, null);
  var prevLow = filled(n, null);

  var curH = null, curHi = null, prvH = null;
  var curL = null, curLi = null, prvL = null;

  for (var i = 0; i < n; i++) {
    var p = i - right; // the bar a pivot could be confirmed for, as of bar i
    if (p >= left) {
      var isHigh = true, isLow = true;
      for (var k = 1; k <= left; k++) {
        if (!(bars[p].high > bars[p - k].high)) isHigh = false;
        if (!(bars[p].low < bars[p - k].low)) isLow = false;
      }
      for (var m = 1; m <= right; m++) {
        if (!(bars[p].high >= bars[p + m].high)) isHigh = false;
        if (!(bars[p].low <= bars[p + m].low)) isLow = false;
      }
      if (isHigh) {
        highAt[i] = bars[p].high;
        prvH = curH; curH = bars[p].high; curHi = p;
      }
      if (isLow) {
        lowAt[i] = bars[p].low;
        prvL = curL; curL = bars[p].low; curLi = p;
      }
    }
    lastHigh[i] = curH; lastHighIndex[i] = curHi; prevHigh[i] = prvH;
    lastLow[i] = curL; lastLowIndex[i] = curLi; prevLow[i] = prvL;
  }

  return {
    highAt: highAt, lowAt: lowAt,
    lastHigh: lastHigh, lastLow: lastLow,
    lastHighIndex: lastHighIndex, lastLowIndex: lastLowIndex,
    prevHigh: prevHigh, prevLow: prevLow
  };
}

/**
 * Ratio of short-window ATR to long-window ATR. Above 1 the market is
 * expanding, below 1 it is contracting — the regime engine's volatility axis.
 */
function volatilityRatio(bars, shortPeriod, longPeriod) {
  var s = atr(bars, shortPeriod);
  var l = atr(bars, longPeriod);
  var out = filled(bars.length, null);
  for (var i = 0; i < bars.length; i++) {
    if (s[i] === null || l[i] === null || l[i] === 0) continue;
    out[i] = s[i] / l[i];
  }
  return out;
}

/**
 * Efficiency ratio (Kaufman): |net move| / sum of absolute moves over `period`.
 * 1 is a straight line, near 0 is chop. The cleanest single trend/range signal.
 */
function efficiencyRatio(values, period) {
  assertPeriod(period, 'efficiencyRatio');
  var out = filled(values.length, null);
  for (var i = period; i < values.length; i++) {
    var net = Math.abs(values[i] - values[i - period]);
    var total = 0;
    for (var k = 0; k < period; k++) total += Math.abs(values[i - k] - values[i - k - 1]);
    out[i] = total === 0 ? 0 : net / total;
  }
  return out;
}

module.exports = {
  sma: sma,
  ema: ema,
  stdev: stdev,
  roc: roc,
  linregSlope: linregSlope,
  bollinger: bollinger,
  trueRange: trueRange,
  wilderSmooth: wilderSmooth,
  atr: atr,
  atrPercent: atrPercent,
  rsi: rsi,
  adx: adx,
  donchian: donchian,
  swings: swings,
  volatilityRatio: volatilityRatio,
  efficiencyRatio: efficiencyRatio
};
