'use strict';
// =====================================================
// MYTHOS TRADING AGENT — indicator tests
// projects/mythos-trading-agent/tests/indicators-test.js
//
// Section 1 is the important one and it is generic: it proves CAUSALITY for
// every indicator by computing it over the full series and over every prefix,
// and requiring the last value of the prefix to equal the value at that index in
// the full run. An indicator that peeked at a later bar would disagree, and the
// test covers indicators added in future phases automatically because it walks a
// registry rather than a hand-written list.
//
// Sections 2+ check numeric correctness against hand arithmetic, because a
// causal-but-wrong ATR sizes every position wrongly.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var ind = require(path.join(SRC, 'indicators'));
var rng = require(path.join(SRC, 'core', 'rng'));

/** A deterministic bar series with enough variety to exercise every branch. */
function makeBars(n, seed) {
  var g = rng.create(seed || 'indicator-bars');
  var bars = [];
  var price = 100;
  for (var i = 0; i < n; i++) {
    var open = price;
    var close = open * (1 + g.normal(0, 0.004));
    var high = Math.max(open, close) + Math.abs(g.normal(0, 1)) * 0.15;
    var low = Math.min(open, close) - Math.abs(g.normal(0, 1)) * 0.15;
    bars.push({
      ts: i * 900000, open: round5(open), high: round5(high), low: round5(low),
      close: round5(close), volume: 100 + i
    });
    price = close;
  }
  return bars;
}
function round5(v) { return Math.round(v * 100000) / 100000; }

var BARS = makeBars(220, 'causality');
var CLOSES = BARS.map(function (b) { return b.close; });

/**
 * Every indicator, as a function of (bars, closes) → array of numbers|nulls or
 * an object of such arrays. Adding an indicator to src/indicators/ without
 * adding it here leaves a gap; §1.2 asserts the registry covers the module.
 */
var REGISTRY = {
  'sma(20)': function (b, c) { return ind.sma(c, 20); },
  'ema(20)': function (b, c) { return ind.ema(c, 20); },
  'stdev(20)': function (b, c) { return ind.stdev(c, 20); },
  'roc(10)': function (b, c) { return ind.roc(c, 10); },
  'linregSlope(14)': function (b, c) { return ind.linregSlope(c, 14); },
  'bollinger(20,2)': function (b, c) { return ind.bollinger(c, 20, 2); },
  'trueRange': function (b) { return ind.trueRange(b); },
  'wilderSmooth(14)': function (b) { return ind.wilderSmooth(ind.trueRange(b), 14, 0); },
  'atr(14)': function (b) { return ind.atr(b, 14); },
  'atrPercent(14)': function (b) { return ind.atrPercent(b, 14); },
  'rsi(14)': function (b, c) { return ind.rsi(c, 14); },
  'adx(14)': function (b) { return ind.adx(b, 14); },
  'donchian(20)': function (b) { return ind.donchian(b, 20); },
  'donchian(20,excl)': function (b) { return ind.donchian(b, 20, { excludeCurrent: true }); },
  'swings(3,3)': function (b) { return ind.swings(b, 3, 3); },
  'volatilityRatio(5,50)': function (b) { return ind.volatilityRatio(b, 5, 50); },
  'efficiencyRatio(20)': function (b, c) { return ind.efficiencyRatio(c, 20); }
};

function seriesOf(result) {
  if (Array.isArray(result)) return { '': result };
  return result;
}

// ---------------------------------------------------------------------------
// 1. Causality — the property everything else depends on
// ---------------------------------------------------------------------------

test('every indicator is causal: a prefix agrees with the full series', function () {
  var names = Object.keys(REGISTRY);
  var checkedPoints = 0;
  names.forEach(function (name) {
    var full = seriesOf(REGISTRY[name](BARS, CLOSES));
    // Check a spread of cut points, including ones just past each warmup.
    [60, 91, 120, 150, 175, 200, 219].forEach(function (cut) {
      var prefBars = BARS.slice(0, cut + 1);
      var prefCloses = CLOSES.slice(0, cut + 1);
      var pref = seriesOf(REGISTRY[name](prefBars, prefCloses));
      Object.keys(full).forEach(function (key) {
        var a = full[key][cut];
        var b = pref[key][cut];
        assert.deepEqual(
          b, a,
          name + (key ? '.' + key : '') + ' at index ' + cut +
          ' changed when later bars were removed: full=' + JSON.stringify(a) + ' prefix=' + JSON.stringify(b) +
          ' — that is look-ahead.'
        );
        checkedPoints++;
      });
    });
  });
  assert.ok(checkedPoints > 200, 'expected many checks, did ' + checkedPoints);
});

test('the causality registry covers every exported indicator', function () {
  var exported = Object.keys(ind);
  var covered = {};
  Object.keys(REGISTRY).forEach(function (k) { covered[k.replace(/\(.*$/, '')] = true; });
  var uncovered = exported.filter(function (fn) { return !covered[fn]; });
  assert.deepEqual(uncovered, [],
    'these indicators have no causality check: ' + uncovered.join(', '));
});

test('indicators return an array the same length as their input', function () {
  Object.keys(REGISTRY).forEach(function (name) {
    var res = seriesOf(REGISTRY[name](BARS, CLOSES));
    Object.keys(res).forEach(function (k) {
      assert.equal(res[k].length, BARS.length, name + (k ? '.' + k : '') + ' length');
    });
  });
});

test('warmup is null rather than zero', function () {
  // A zero ATR would divide a position size to infinity; null forces the caller
  // to notice.
  assert.equal(ind.atr(BARS, 14)[12], null);
  assert.notEqual(ind.atr(BARS, 14)[13], null);
  assert.equal(ind.sma(CLOSES, 20)[18], null);
  assert.equal(ind.ema(CLOSES, 20)[18], null);
  assert.equal(ind.rsi(CLOSES, 14)[13], null);
  assert.notEqual(ind.rsi(CLOSES, 14)[14], null);
});

test('indicators reject nonsense periods', function () {
  assert.throws(function () { ind.sma(CLOSES, 0); }, /period must be a positive integer/);
  assert.throws(function () { ind.ema(CLOSES, -3); }, /period must be a positive integer/);
  assert.throws(function () { ind.atr(BARS, 1.5); }, /period must be a positive integer/);
});

test('a series shorter than the period yields all nulls, not an exception', function () {
  var few = BARS.slice(0, 5);
  assert.deepEqual(ind.sma(few.map(function (b) { return b.close; }), 20), [null, null, null, null, null]);
  assert.deepEqual(ind.ema(few.map(function (b) { return b.close; }), 20), [null, null, null, null, null]);
  assert.deepEqual(ind.atr(few, 20), [null, null, null, null, null]);
});

// ---------------------------------------------------------------------------
// 2. Numeric correctness
// ---------------------------------------------------------------------------

test('sma matches hand arithmetic', function () {
  var v = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(ind.sma(v, 3), [null, null, 2, 3, 4, 5]);
  assert.deepEqual(ind.sma(v, 1), v);
});

test('ema is seeded with the SMA of the first period', function () {
  var v = [1, 2, 3, 4, 5];
  var e = ind.ema(v, 3);
  assert.equal(e[2], 2, 'seed is the SMA of [1,2,3]');
  // k = 2/(3+1) = 0.5 → next = 4*0.5 + 2*0.5 = 3
  assert.equal(e[3], 3);
  assert.equal(e[4], 4);
});

test('stdev matches the population formula', function () {
  var v = [2, 4, 4, 4, 5, 5, 7, 9];
  var s = ind.stdev(v, 8);
  assert.ok(Math.abs(s[7] - 2) < 1e-12, 'classic example: sd = 2, got ' + s[7]);
  assert.deepEqual(ind.stdev([5, 5, 5, 5], 4)[3], 0);
});

test('roc is a fraction and handles a zero base', function () {
  assert.equal(ind.roc([10, 11], 1)[1], 0.10000000000000009 - 0.00000000000000009 || 0.1);
  assert.ok(Math.abs(ind.roc([10, 12], 1)[1] - 0.2) < 1e-12);
  assert.equal(ind.roc([0, 5], 1)[1], null, 'a zero base is not a 500 % move, it is undefined');
});

test('linregSlope recovers the slope of a straight line', function () {
  var v = [];
  for (var i = 0; i < 30; i++) v.push(5 + 3 * i);
  var s = ind.linregSlope(v, 10);
  assert.ok(Math.abs(s[29] - 3) < 1e-9, 'slope was ' + s[29]);
  var flat = [];
  for (var j = 0; j < 20; j++) flat.push(7);
  assert.ok(Math.abs(ind.linregSlope(flat, 10)[19]) < 1e-12);
});

test('trueRange uses the previous close and the first bar falls back to H-L', function () {
  var bars = [
    { ts: 0, open: 10, high: 11, low: 9, close: 10, volume: 1 },
    { ts: 1, open: 10, high: 12, low: 10.5, close: 11.5, volume: 1 }, // gap up
    { ts: 2, open: 11.5, high: 11.6, low: 8, close: 9, volume: 1 }    // gap down
  ];
  var tr = ind.trueRange(bars);
  assert.equal(tr[0], 2, 'first bar: high - low');
  assert.equal(tr[1], 2, 'max(1.5, |12-10|=2, |10.5-10|=0.5)');
  assert.ok(Math.abs(tr[2] - 3.6) < 1e-12, 'max(3.6, |11.6-11.5|=0.1, |8-11.5|=3.5), got ' + tr[2]);
});

test('atr follows Wilder smoothing exactly', function () {
  var bars = [];
  for (var i = 0; i < 6; i++) {
    bars.push({ ts: i, open: 10, high: 11, low: 9, close: 10, volume: 1 });
  }
  // Every TR is 2, so the ATR must be exactly 2 from the seed onward.
  var a = ind.atr(bars, 3);
  assert.equal(a[1], null);
  assert.equal(a[2], 2);
  assert.equal(a[5], 2);

  // One larger bar, checked by hand: ATR = (2*2 + 5)/3 = 3
  bars.push({ ts: 6, open: 10, high: 14, low: 9, close: 13, volume: 1 });
  var a2 = ind.atr(bars, 3);
  assert.equal(ind.trueRange(bars)[6], 5);
  assert.ok(Math.abs(a2[6] - 3) < 1e-12, 'got ' + a2[6]);
});

test('rsi is 100 in an unbroken advance and 0 in an unbroken decline', function () {
  var up = [], down = [];
  for (var i = 0; i < 30; i++) { up.push(100 + i); down.push(100 - i); }
  assert.equal(ind.rsi(up, 14)[29], 100);
  assert.equal(ind.rsi(down, 14)[29], 0);
  var flat = [];
  for (var j = 0; j < 30; j++) flat.push(100);
  assert.equal(ind.rsi(flat, 14)[29], 50, 'no movement is neutral, not undefined');
});

test('rsi stays inside 0..100 on noisy data', function () {
  var r = ind.rsi(CLOSES, 14);
  r.forEach(function (v, i) {
    if (v === null) return;
    assert.ok(v >= 0 && v <= 100, 'rsi[' + i + '] = ' + v);
  });
});

test('adx components stay in range and trend up on a directional series', function () {
  var bars = [];
  for (var i = 0; i < 80; i++) {
    var base = 100 + i * 0.5;
    bars.push({ ts: i, open: base, high: base + 0.4, low: base - 0.1, close: base + 0.3, volume: 1 });
  }
  var res = ind.adx(bars, 14);
  var last = res.adx[79];
  assert.ok(last !== null && last > 50, 'a clean uptrend should read a high ADX, got ' + last);
  assert.ok(res.plusDI[79] > res.minusDI[79], '+DI must dominate in an uptrend');
  res.adx.forEach(function (v, i) {
    if (v === null) return;
    assert.ok(v >= 0 && v <= 100, 'adx[' + i + '] = ' + v);
  });
});

test('donchian with excludeCurrent ignores the current bar', function () {
  var bars = [];
  for (var i = 0; i < 10; i++) {
    bars.push({ ts: i, open: 10, high: 10 + i, low: 10 - i, close: 10, volume: 1 });
  }
  // Bar 9 has the highest high (19) of all. Including it, upper(3) at index 9 is
  // 19; excluding it, the window is bars 6..8 → 18.
  assert.equal(ind.donchian(bars, 3)[ 'upper' ][9], 19);
  assert.equal(ind.donchian(bars, 3, { excludeCurrent: true }).upper[9], 18);
  assert.equal(ind.donchian(bars, 3, { excludeCurrent: true }).upper[2], null, 'exclusion costs one bar of warmup');
  assert.equal(ind.donchian(bars, 3, { excludeCurrent: true }).upper[3], 12);
});

test('swing pivots are published on the bar they become known, not when they occur', function () {
  // A clean peak at index 5.
  var highs = [1, 2, 3, 4, 5, 9, 5, 4, 3, 2, 1];
  var bars = highs.map(function (h, i) {
    return { ts: i, open: h, high: h, low: h - 0.5, close: h, volume: 1 };
  });
  var sw = ind.swings(bars, 2, 2);
  assert.equal(sw.highAt[5], null, 'the pivot may NOT be visible on the bar it happened');
  assert.equal(sw.highAt[6], null);
  assert.equal(sw.highAt[7], 9, 'it becomes known two bars later (right = 2)');
  assert.equal(sw.lastHigh[6], null);
  assert.equal(sw.lastHigh[7], 9);
  assert.equal(sw.lastHighIndex[7], 5, 'the pivot is attributed to the bar it occurred on');
  assert.equal(sw.lastHigh[10], 9, 'the most recent pivot carries forward');
});

test('swings track the previous pivot as well as the last', function () {
  // Pivot highs at indexes 2 (5), 6 (7) and 10 (3), each confirmed two bars later.
  var seq = [1, 2, 5, 2, 1, 2, 7, 2, 1, 2, 3, 2, 1];
  var bars = seq.map(function (h, i) {
    return { ts: i, open: h, high: h, low: h - 0.5, close: h, volume: 1 };
  });
  var sw = ind.swings(bars, 2, 2);
  var i = bars.length - 1;
  assert.deepEqual([sw.highAt[4], sw.highAt[8], sw.highAt[12]], [5, 7, 3]);
  assert.equal(sw.lastHigh[i], 3, 'the LAST pivot is the most recent one, lower or not');
  assert.equal(sw.prevHigh[i], 7, 'the one before it is retained, so structure can be compared');
  assert.equal(sw.lastHigh[9], 7, 'before the third pivot is confirmed, the second is still current');
  assert.equal(sw.prevHigh[9], 5);
});

test('volatilityRatio is 1 on constant-volatility data', function () {
  var bars = [];
  for (var i = 0; i < 100; i++) bars.push({ ts: i, open: 10, high: 11, low: 9, close: 10, volume: 1 });
  assert.ok(Math.abs(ind.volatilityRatio(bars, 5, 50)[99] - 1) < 1e-9);
});

test('efficiencyRatio is 1 for a straight line and near 0 for pure chop', function () {
  var line = [], chop = [];
  for (var i = 0; i < 40; i++) { line.push(100 + i); chop.push(100 + (i % 2)); }
  assert.ok(Math.abs(ind.efficiencyRatio(line, 20)[39] - 1) < 1e-12);
  assert.ok(ind.efficiencyRatio(chop, 20)[39] < 0.1, 'got ' + ind.efficiencyRatio(chop, 20)[39]);
});
