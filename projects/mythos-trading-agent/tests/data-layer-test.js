'use strict';
// =====================================================
// MYTHOS TRADING AGENT — data layer tests
// projects/mythos-trading-agent/tests/data-layer-test.js
//
// The load-bearing sections:
//
//   §2 the series VIEW cannot reach the future. Asking for a negative offset
//      throws with the word LOOK-AHEAD; asking for more history than exists
//      returns null. Those two cases are deliberately different: one is always
//      a bug, the other is normal warmup.
//   §3 resample() never emits a bar that is still forming, and alignCompleted()
//      never hands a strategy the higher-timeframe bar that CONTAINS the current
//      base bar — the single most common source of multi-timeframe look-ahead.
//   §5 the synthetic generator is deterministic, produces structurally valid
//      bars, and respects the instrument's calendar, so no strategy is ever
//      validated on a bar that could not have been traded.
//   §6 a fixture whose bars are edited no longer matches its declared version,
//      so a run that cited the old version is visibly not reproducible.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var fs = require('fs');
var os = require('os');

var SRC = path.join(__dirname, '..', 'src');
var barMod = require(path.join(SRC, 'data', 'bar'));
var seriesMod = require(path.join(SRC, 'data', 'series'));
var resample = require(path.join(SRC, 'data', 'resample'));
var sourceMod = require(path.join(SRC, 'data', 'source'));
var synthetic = require(path.join(SRC, 'data', 'synthetic-source'));
var fixtureSource = require(path.join(SRC, 'data', 'fixture-source'));
var instrument = require(path.join(SRC, 'core', 'instrument'));
var clock = require(path.join(SRC, 'core', 'clock'));
var ind = require(path.join(SRC, 'indicators'));

var CATALOG = instrument.defaultCatalog();
var MONDAY = Date.parse('2024-01-01T00:00:00Z'); // a Monday, mid-session

/** n contiguous M15 bars with a simple deterministic shape. */
function contiguous(n, opts) {
  var o = opts || {};
  var start = o.start === undefined ? MONDAY : o.start;
  var step = (o.stepMinutes || 15) * 60000;
  var bars = [];
  for (var i = 0; i < n; i++) {
    var base = 100 + i;
    bars.push({
      ts: start + i * step,
      open: base,
      high: base + 0.6,
      low: base - 0.4,
      close: base + 0.2,
      volume: 10 + i
    });
  }
  return bars;
}

// ---------------------------------------------------------------------------
// 1. Bar and series validation
// ---------------------------------------------------------------------------

test('bar.make accepts a well-formed bar and rejects impossible ones', function () {
  var b = barMod.make(MONDAY, 1.08, 1.085, 1.079, 1.083, 100);
  assert.equal(b.close, 1.083);
  assert.throws(function () { barMod.make(MONDAY, 1.08, 1.07, 1.06, 1.065); }, /high .* is below open\/close/);
  assert.throws(function () { barMod.make(MONDAY, 1.08, 1.09, 1.085, 1.087); }, /low .* is above open\/close/);
  assert.throws(function () { barMod.make(MONDAY, 1.08, 1.07, 1.09, 1.08); }, /high .* is below low/);
  assert.throws(function () { barMod.make(MONDAY, 0, 1, -1, 0.5); }, /non-positive price/);
  assert.throws(function () { barMod.make(MONDAY, 1, 1, 1, NaN); }, /close is not a finite number/);
  assert.throws(function () { barMod.make(MONDAY, 1, 1, 1, 1, -5); }, /negative volume/);
});

test('validateSeries reports structure and rejects disorder', function () {
  var bars = contiguous(10);
  var summary = barMod.validateSeries(bars, { timeframe: 'M15' });
  assert.equal(summary.bars, 10);
  assert.deepEqual(summary.gaps, []);
  assert.equal(summary.firstTs, MONDAY);

  var dup = contiguous(3);
  dup[2] = Object.assign({}, dup[2], { ts: dup[1].ts });
  assert.throws(function () { barMod.validateSeries(dup, { timeframe: 'M15' }); }, /duplicate timestamp/);

  // Kept on the M15 grid, so the failure is the ordering and not the alignment.
  var backwards = contiguous(3);
  backwards[2] = Object.assign({}, backwards[2], { ts: backwards[0].ts - 15 * 60000 });
  assert.throws(function () { barMod.validateSeries(backwards, { timeframe: 'M15' }); }, /not ascending/);

  var misaligned = contiguous(3);
  misaligned[1] = Object.assign({}, misaligned[1], { ts: misaligned[1].ts + 60000 });
  assert.throws(function () { barMod.validateSeries(misaligned, { timeframe: 'M15' }); }, /not aligned to the M15 grid/);

  assert.throws(function () { barMod.validateSeries([], { timeframe: 'M15' }); }, /series is empty/);
  assert.throws(function () { barMod.validateSeries('nope'); }, /must be an array/);
});

test('gaps are reported by default and fatal when contiguity is required', function () {
  var bars = contiguous(5);
  bars.splice(2, 1); // remove one bar → a one-bar hole
  var summary = barMod.validateSeries(bars, { timeframe: 'M15' });
  assert.equal(summary.gaps.length, 1);
  assert.equal(summary.gaps[0].missingBars, 1);
  assert.throws(function () { barMod.validateSeries(bars, { timeframe: 'M15', requireContiguous: true }); },
    /gap of 1 bar\(s\)/);
});

test('bar geometry helpers agree with the definition', function () {
  var b = { ts: 0, open: 10, high: 12, low: 9, close: 11, volume: 1 };
  assert.equal(barMod.range(b), 3);
  assert.equal(barMod.body(b), 1);
  assert.equal(barMod.upperWick(b), 1);
  assert.equal(barMod.lowerWick(b), 1);
  assert.equal(barMod.isBullish(b), true);
  assert.equal(barMod.isBearish(b), false);
  assert.equal(barMod.typical(b), (12 + 9 + 11) / 3);
});

test('indexAtOrBefore and slice cut a series without shifting it', function () {
  var bars = contiguous(10);
  assert.equal(barMod.indexAtOrBefore(bars, bars[4].ts), 4);
  assert.equal(barMod.indexAtOrBefore(bars, bars[4].ts + 1), 4);
  assert.equal(barMod.indexAtOrBefore(bars, bars[0].ts - 1), -1);
  assert.equal(barMod.indexAtOrBefore(bars, bars[9].ts + 1e9), 9);

  var cut = barMod.slice(bars, bars[3].ts, bars[7].ts);
  assert.equal(cut.length, 4, 'from is inclusive, to is exclusive');
  assert.equal(cut[0].ts, bars[3].ts);
  assert.equal(cut[3].ts, bars[6].ts);
});

// ---------------------------------------------------------------------------
// 2. The look-ahead-proof view
// ---------------------------------------------------------------------------

test('a view exposes only the past, and asking for the future throws', function () {
  var s = seriesMod.create({ symbol: 'EURUSD', timeframe: 'M15', bars: contiguous(20) });
  var v = s.viewAt(10);
  assert.equal(v.index, 10);
  assert.equal(v.size, 11);
  assert.equal(v.bar(0).close, 110.2);
  assert.equal(v.bar(1).close, 109.2);
  assert.throws(function () { v.bar(-1); }, /LOOK-AHEAD/);
  assert.throws(function () { v.indicator('sma', -2); }, /LOOK-AHEAD/);
  assert.throws(function () { v.bar(1.5); }, /needs an integer offset/);
});

test('a view returns null for history it does not have, which is not an error', function () {
  var s = seriesMod.create({ symbol: 'EURUSD', timeframe: 'M15', bars: contiguous(20) });
  var v = s.viewAt(3);
  assert.equal(v.bar(3).ts, MONDAY);
  assert.equal(v.bar(4), null, 'before the series start is absent, not a bug');
  assert.equal(v.closes(4).length, 4);
  assert.equal(v.closes(5), null);
  assert.equal(v.hasHistory(4), true);
  assert.equal(v.hasHistory(5), false);
  assert.throws(function () { v.closes(0); }, /window size must be >= 1/);
});

test('view windows are oldest-to-newest and end on the current bar', function () {
  var s = seriesMod.create({ symbol: 'EURUSD', timeframe: 'M15', bars: contiguous(20) });
  var v = s.viewAt(5);
  assert.deepEqual(v.closes(3), [103.2, 104.2, 105.2]);
  assert.deepEqual(v.highs(2), [104.6, 105.6]);
  assert.deepEqual(v.lows(2), [103.6, 104.6]);
  assert.deepEqual(v.opens(2), [104, 105]);
  assert.equal(v.window(2).length, 2);
  assert.equal(v.window(2)[1].ts, v.ts);
  assert.equal(v.highest(3), 105.6);
  assert.equal(v.lowest(3), 102.6);
  assert.equal(v.close(), 105.2);
});

test('viewAt refuses an index outside the series', function () {
  var s = seriesMod.create({ symbol: 'EURUSD', timeframe: 'M15', bars: contiguous(5) });
  assert.throws(function () { s.viewAt(5); }, /outside the series/);
  assert.throws(function () { s.viewAt(-1); }, /outside the series/);
  assert.throws(function () { s.viewAt(1.5); }, /outside the series/);
});

test('indicators registered on a series are readable through the view only up to now', function () {
  var bars = contiguous(40);
  var s = seriesMod.create({ symbol: 'EURUSD', timeframe: 'M15', bars: bars });
  s.addIndicator('sma5', function (series) { return ind.sma(series.closes(), 5); });
  s.addIndicator('atr14', function (series) { return ind.atr(series.bars(), 14); });
  assert.deepEqual(s.indicatorNames(), ['sma5', 'atr14']);

  var v = s.viewAt(20);
  assert.equal(v.indicator('sma5'), ind.sma(bars.map(function (b) { return b.close; }), 5)[20]);
  assert.equal(v.indicator('sma5', 1), ind.sma(bars.map(function (b) { return b.close; }), 5)[19]);
  assert.equal(v.indicatorWindow('sma5', 3).length, 3);
  // Warmup, through the view, is null rather than an exception.
  assert.equal(s.viewAt(2).indicator('sma5'), null);
  assert.throws(function () { v.indicator('nope'); }, /unknown indicator "nope"/);
});

test('addIndicator refuses an array of the wrong length', function () {
  var s = seriesMod.create({ symbol: 'EURUSD', timeframe: 'M15', bars: contiguous(10) });
  assert.throws(function () { s.addIndicator('short', [1, 2, 3]); }, /must be an array of 10 values/);
  assert.throws(function () { s.addIndicator('nope', 5); }, /must be an array of 10 values/);
});

// ---------------------------------------------------------------------------
// 3. Resampling and multi-timeframe alignment
// ---------------------------------------------------------------------------

test('resample aggregates OHLCV correctly', function () {
  var bars = contiguous(8); // 8 x M15 = 2 complete H1 bars
  var h1 = resample.resample(bars, 'M15', 'H1');
  assert.equal(h1.length, 2);
  assert.equal(h1[0].ts, MONDAY);
  assert.equal(h1[0].open, bars[0].open, 'open comes from the first constituent bar');
  assert.equal(h1[0].close, bars[3].close, 'close comes from the last');
  assert.equal(h1[0].high, Math.max.apply(null, bars.slice(0, 4).map(function (b) { return b.high; })));
  assert.equal(h1[0].low, Math.min.apply(null, bars.slice(0, 4).map(function (b) { return b.low; })));
  assert.equal(h1[0].volume, bars.slice(0, 4).reduce(function (a, b) { return a + b.volume; }, 0));
  assert.equal(h1[0].sourceBars, 4);
  barMod.validateSeries(h1, { timeframe: 'H1' });
});

test('resample drops a bucket that is still forming', function () {
  var h1 = resample.resample(contiguous(9), 'M15', 'H1');
  assert.equal(h1.length, 2, 'the 9th bar starts a third hour that has not finished');
  var kept = resample.resample(contiguous(9), 'M15', 'H1', { keepIncomplete: true });
  assert.equal(kept.length, 3);
  assert.equal(kept[2].sourceBars, 1);
});

test('resample refuses a target smaller than the source', function () {
  assert.throws(function () { resample.resample(contiguous(4), 'H1', 'M15'); }, /the target is smaller/);
  // Every pair in the standard ladder divides evenly (1|5|15|30|60|240|1440),
  // so the divisibility guard is exercised through the module directly rather
  // than through a pair the enum cannot express.
  var enums = require(path.join(SRC, 'core', 'enums'));
  var TF = enums.TIMEFRAME_MINUTES;
  Object.keys(TF).forEach(function (a) {
    Object.keys(TF).forEach(function (b) {
      if (TF[b] >= TF[a]) {
        assert.equal(TF[b] % TF[a], 0, a + ' must divide ' + b + ' for resampling to be exact');
      }
    });
  });
  assert.doesNotThrow(function () { resample.resample(contiguous(16, { stepMinutes: 30 }), 'M30', 'H4'); });
});

test('alignCompleted never returns a higher bar that is still open', function () {
  var base = contiguous(12); // 3 complete hours
  var h1 = resample.resample(base, 'M15', 'H1');
  var align = resample.alignCompleted(base, 'M15', h1, 'H1');
  // Bars 0..2 close before 01:00, so no H1 bar has closed yet.
  assert.deepEqual(align.slice(0, 3), [-1, -1, -1]);
  // Bar 3 closes exactly at 01:00, which is when H1 bar 0 closes.
  assert.equal(align[3], 0);
  assert.deepEqual(align.slice(4, 7), [0, 0, 0]);
  assert.equal(align[7], 1);
  assert.equal(align[11], 2);

  // The invariant, stated directly: the aligned bar must always have closed by
  // the base bar's close.
  var stepBase = 15 * 60000, stepHigher = 60 * 60000;
  align.forEach(function (h, i) {
    if (h < 0) return;
    assert.ok(h1[h].ts + stepHigher <= base[i].ts + stepBase,
      'base bar ' + i + ' was aligned to an H1 bar that had not closed');
    assert.ok(h + 1 >= h1.length || h1[h + 1].ts + stepHigher > base[i].ts + stepBase,
      'base bar ' + i + ' could have used a later completed H1 bar');
  });
});

test('higherTimeframeView bundles the series and its alignment', function () {
  var base = contiguous(24);
  var view = resample.higherTimeframeView(base, 'M15', 'H4');
  assert.equal(view.timeframe, 'H4');
  assert.equal(view.bars.length, 1, '24 x M15 = 6 hours → one complete H4 bar');
  assert.equal(view.align.length, 24);
  assert.equal(view.align[15], 0, 'the first H4 bar closes at the 16th M15 bar');
  assert.equal(view.align[14], -1);
});

test('an instrument calendar gap does not make a bucket look incomplete', function () {
  // XAUUSD trades 01:00-23:00 UTC, so the 00:00 H1 bucket legitimately has no
  // bars and the 23:00 one is absent entirely. Completeness is a clock test.
  var gold = CATALOG.get('XAUUSD');
  var gen = synthetic.generate({ instrument: gold, timeframe: 'M15', bars: 400, seed: 'gold-calendar' });
  var h1 = resample.resample(gen.bars, 'M15', 'H1');
  h1.forEach(function (b) {
    var h = clock.hour(b.ts);
    assert.ok(h >= 1 && h < 23, 'an H1 bar appeared at ' + clock.iso(b.ts) + ', outside the gold session');
  });
  assert.ok(h1.length > 10);
});

// ---------------------------------------------------------------------------
// 4. The source interface
// ---------------------------------------------------------------------------

test('assertSource refuses a source that cannot name its data', function () {
  assert.throws(function () { sourceMod.assertSource(null); }, /must be an object/);
  assert.throws(function () { sourceMod.assertSource({ datasetVersion: 'v1' }); }, /must declare a string `kind`/);
  assert.throws(function () { sourceMod.assertSource({ kind: 'x' }); }, /must declare a datasetVersion/);
  assert.throws(function () {
    sourceMod.assertSource({ kind: 'x', datasetVersion: 'v1', symbols: function () {} });
  }, /missing method timeframes\(\)/);
});

test('fromBars serves in-memory data and ranges', function () {
  var bars = contiguous(10);
  var src = sourceMod.fromBars({ datasetVersion: 'mem-v1', data: { EURUSD: { M15: bars } } });
  assert.deepEqual(src.symbols(), ['EURUSD']);
  assert.deepEqual(src.timeframes('EURUSD'), ['M15']);
  assert.equal(src.load('EURUSD', 'M15').length, 10);
  assert.equal(src.load('EURUSD', 'M15', { fromTs: bars[5].ts }).length, 5);
  assert.throws(function () { src.load('GBPUSD', 'M15'); }, /no data for GBPUSD/);
  assert.throws(function () { src.load('EURUSD', 'H1'); }, /no H1 data for EURUSD/);
  assert.throws(function () { sourceMod.fromBars({ data: {} }); }, /requires a datasetVersion/);
});

test('guarded() validates what a source returns and caches it', function () {
  var calls = 0;
  var bars = contiguous(10);
  var raw = sourceMod.assertSource({
    kind: 'counting', datasetVersion: 'v1',
    symbols: function () { return ['EURUSD']; },
    timeframes: function () { return ['M15']; },
    load: function () { calls++; return bars; },
    describe: function () { return {}; }
  });
  var g = sourceMod.guarded(raw);
  g.load('EURUSD', 'M15');
  g.load('EURUSD', 'M15');
  assert.equal(calls, 1, 'the second load is served from cache');
  g.clearCache();
  g.load('EURUSD', 'M15');
  assert.equal(calls, 2);
  assert.throws(function () { g.load('EURUSD', 'M7'); }, /must be one of/);
});

test('guarded() rejects a source that returns corrupt bars', function () {
  var broken = sourceMod.assertSource({
    kind: 'broken', datasetVersion: 'v1',
    symbols: function () { return ['EURUSD']; },
    timeframes: function () { return ['M15']; },
    load: function () {
      var bars = contiguous(4);
      bars[2] = Object.assign({}, bars[2], { high: 0.5 }); // high below the low
      return bars;
    },
    describe: function () { return {}; }
  });
  assert.throws(function () { sourceMod.guarded(broken).load('EURUSD', 'M15'); }, /bar 2 is invalid/);

  var empty = sourceMod.assertSource({
    kind: 'empty', datasetVersion: 'v1',
    symbols: function () { return ['EURUSD']; },
    timeframes: function () { return ['M15']; },
    load: function () { return []; },
    describe: function () { return {}; }
  });
  assert.throws(function () { sourceMod.guarded(empty).load('EURUSD', 'M15'); }, /has no bars/);
});

test('guarded().meta produces the market_data_meta record shape', function () {
  var src = sourceMod.guarded(sourceMod.fromBars({
    datasetVersion: 'mem-v1', data: { EURUSD: { M15: contiguous(10) } }
  }));
  var meta = src.meta('EURUSD', 'M15');
  assert.equal(meta.barCount, 10);
  assert.equal(meta.datasetVersion, 'mem-v1');
  assert.equal(meta.sourceKind, 'memory');
  assert.equal(meta.gapCount, 0);
  require(path.join(SRC, 'db', 'store')).create({ runId: 'r' }).table('market_data_meta').insert(meta);
});

// ---------------------------------------------------------------------------
// 5. The synthetic generator
// ---------------------------------------------------------------------------

test('the generator is deterministic and seed-sensitive', function () {
  var spec = { instrument: CATALOG.get('EURUSD'), timeframe: 'M15', bars: 200, seed: 'determinism' };
  var a = synthetic.generate(spec);
  var b = synthetic.generate(spec);
  assert.deepEqual(a.bars, b.bars);
  assert.deepEqual(a.regimeTruth, b.regimeTruth);
  var c = synthetic.generate(Object.assign({}, spec, { seed: 'determinism-2' }));
  assert.notDeepEqual(a.bars, c.bars);
});

test('every generated bar is structurally valid', function () {
  ['EURUSD', 'USDJPY', 'XAUUSD'].forEach(function (sym) {
    var res = synthetic.generate({ instrument: CATALOG.get(sym), timeframe: 'M15', bars: 600, seed: 'valid-' + sym });
    barMod.validateSeries(res.bars, { timeframe: 'M15' });
    res.bars.forEach(function (b, i) {
      assert.equal(barMod.barProblem(b), null, sym + ' bar ' + i);
      assert.ok(b.close > 0);
    });
  });
});

test('generated prices are rounded to the instrument precision', function () {
  var jpy = CATALOG.get('USDJPY'); // 3 digits
  var res = synthetic.generate({ instrument: jpy, timeframe: 'M15', bars: 100, seed: 'digits' });
  res.bars.forEach(function (b) {
    ['open', 'high', 'low', 'close'].forEach(function (f) {
      assert.equal(b[f], Math.round(b[f] * 1000) / 1000, f + ' ' + b[f] + ' has more than 3 decimals');
    });
  });
});

test('generated timestamps never fall in the forex weekend', function () {
  var res = synthetic.generate({ instrument: CATALOG.get('EURUSD'), timeframe: 'H1', bars: 500, seed: 'weekend' });
  res.bars.forEach(function (b) {
    assert.equal(clock.isForexWeekend(b.ts), false, 'bar at ' + clock.iso(b.ts) + ' is in the closed weekend');
  });
  // And the series must actually span weekends, or the check proves nothing.
  var days = {};
  res.bars.forEach(function (b) { days[clock.dayKey(b.ts)] = true; });
  assert.ok(Object.keys(days).length > 10, 'series too short to have crossed a weekend');
});

test('generated timestamps respect a declared session window', function () {
  var res = synthetic.generate({ instrument: CATALOG.get('XAUUSD'), timeframe: 'H1', bars: 300, seed: 'session' });
  res.bars.forEach(function (b) {
    var h = clock.hour(b.ts);
    assert.ok(h >= 1 && h < 23, 'gold bar at ' + clock.iso(b.ts) + ' is outside 01:00-23:00 UTC');
  });
});

test('the generator publishes its own regime ground truth', function () {
  var res = synthetic.generate({ instrument: CATALOG.get('EURUSD'), timeframe: 'M15', bars: 800, seed: 'truth' });
  assert.equal(res.regimeTruth.length, 800);
  var counts = {};
  res.regimeTruth.forEach(function (r) { counts[r] = (counts[r] || 0) + 1; });
  assert.ok(Object.keys(counts).length >= 3, 'a long series should visit several regimes, saw ' + Object.keys(counts));
  // Segments must tile the series exactly, with no overlap and no hole.
  var covered = 0;
  res.segments.forEach(function (seg, i) {
    assert.ok(seg.toIndex >= seg.fromIndex);
    if (i > 0) assert.equal(seg.fromIndex, res.segments[i - 1].toIndex + 1);
    covered += seg.bars;
  });
  assert.equal(covered, 800);
  assert.equal(res.segments[0].fromIndex, 0);
  assert.equal(res.segments[res.segments.length - 1].toIndex, 799);
});

test('a forced regime sequence is honoured', function () {
  var res = synthetic.generate({
    instrument: CATALOG.get('EURUSD'), timeframe: 'M15', bars: 400, seed: 'forced',
    regimeSequence: ['LOW_VOLATILITY', 'BREAKOUT', 'TREND']
  });
  assert.equal(res.regimeTruth[0], 'LOW_VOLATILITY');
  var order = [];
  res.segments.forEach(function (s) { if (order[order.length - 1] !== s.regime) order.push(s.regime); });
  assert.deepEqual(order.slice(0, 3), ['LOW_VOLATILITY', 'BREAKOUT', 'TREND']);
});

test('a LOW_VOLATILITY stretch really is quieter than a HIGH_VOLATILITY one', function () {
  function meanRange(regime) {
    var res = synthetic.generate({
      instrument: CATALOG.get('EURUSD'), timeframe: 'M15', bars: 400, seed: 'vol-' + regime,
      regimeSequence: [regime, regime, regime, regime, regime, regime, regime, regime]
    });
    var total = 0;
    res.bars.forEach(function (b) { total += b.high - b.low; });
    return total / res.bars.length;
  }
  var low = meanRange('LOW_VOLATILITY');
  var high = meanRange('HIGH_VOLATILITY');
  assert.ok(high > low * 3, 'HIGH_VOLATILITY (' + high + ') should dwarf LOW_VOLATILITY (' + low + ')');
});

test('the synthetic source derives a per-symbol seed and declares its warning', function () {
  var src = synthetic.createSource({
    catalog: CATALOG, symbols: ['EURUSD', 'GBPUSD'], timeframe: 'M15', bars: 100, seed: 'src-seed'
  });
  assert.deepEqual(src.symbols(), ['EURUSD', 'GBPUSD']);
  assert.notDeepEqual(src.load('EURUSD', 'M15'), src.load('GBPUSD', 'M15'));
  assert.match(src.datasetVersion, /^synthetic-[0-9a-f]{12}$/);
  assert.match(src.describe().warning, /SYNTHETIC DATA/);
  assert.equal(src.truth('EURUSD').regimeTruth.length, 100);
  assert.throws(function () { src.load('EURUSD', 'H1'); }, /resample with src\/data\/resample.js/);
});

test('the synthetic datasetVersion changes with the parameters that shape the data', function () {
  function version(over) {
    return synthetic.createSource(Object.assign({
      catalog: CATALOG, symbols: ['EURUSD'], timeframe: 'M15', bars: 100, seed: 's'
    }, over)).datasetVersion;
  }
  var base = version({});
  assert.equal(base, version({}));
  assert.notEqual(base, version({ seed: 's2' }));
  assert.notEqual(base, version({ bars: 101 }));
  assert.notEqual(base, version({ timeframe: 'H1' }));
  assert.notEqual(base, version({ volMultiplier: 2 }));
});

// ---------------------------------------------------------------------------
// 6. Committed fixtures
// ---------------------------------------------------------------------------

test('the committed fixtures load and are self-consistent', function () {
  var src = fixtureSource.createSource();
  assert.deepEqual(src.symbols(), ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD']);
  assert.deepEqual(src.timeframes('EURUSD'), ['M15']);
  var bars = src.load('EURUSD', 'M15');
  assert.equal(bars.length, 3000);
  barMod.validateSeries(bars, { timeframe: 'M15' });
  assert.match(src.datasetVersion, /^fixtures-[0-9a-f]{12}$/);
  assert.match(src.describe().warning, /still synthetic/);
  assert.equal(src.provenance('EURUSD', 'M15').generator, 'regime-switching-gbm-v1');
});

test('fixtures match the generator spec that produced them', function () {
  // Guards against a fixture being regenerated with a tuned generator but the
  // spec in bin/make-fixtures.js left unchanged, or vice versa.
  var mk = require(path.join(__dirname, '..', 'bin', 'make-fixtures.js'));
  mk.build().forEach(function (fx) {
    var onDisk = fixtureSource.read(mk.fileFor(fx.symbol, fx.timeframe));
    assert.equal(onDisk.datasetVersion, fixtureSource.barsVersion(fx.bars),
      fx.symbol + ' fixture does not match bin/make-fixtures.js — run it and commit the result');
  });
});

test('an edited fixture no longer matches its declared version', function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-fixture-'));
  var file = path.join(dir, 'eurusd-m15.json');
  var bars = contiguous(20);
  var version = fixtureSource.write(file, { symbol: 'EURUSD', timeframe: 'M15', bars: bars });
  assert.equal(fixtureSource.read(file).datasetVersion, version);

  var doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  doc.bars[5][4] = doc.bars[5][4] + 0.0001; // nudge one close
  fs.writeFileSync(file, JSON.stringify(doc));
  assert.throws(function () { fixtureSource.read(file); },
    /was edited without re-versioning; every run that cited the old version is no longer reproducible/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fixture round-trip preserves bars exactly', function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-fixture-rt-'));
  var file = path.join(dir, 'x-m15.json');
  var res = synthetic.generate({ instrument: CATALOG.get('XAUUSD'), timeframe: 'M15', bars: 120, seed: 'rt' });
  fixtureSource.write(file, { symbol: 'XAUUSD', timeframe: 'M15', bars: res.bars, provenance: { seed: 'rt' } });
  var back = fixtureSource.read(file);
  assert.deepEqual(back.bars, res.bars);
  assert.deepEqual(back.provenance, { seed: 'rt' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a malformed fixture document is rejected with a reason', function () {
  assert.throws(function () { fixtureSource.fromDocument({ schemaVersion: 2 }); }, /unsupported schemaVersion/);
  assert.throws(function () { fixtureSource.fromDocument({ schemaVersion: 1, columns: ['ts'] }); }, /must declare columns/);
  assert.throws(function () {
    fixtureSource.fromDocument({ schemaVersion: 1, columns: fixtureSource.COLUMNS, bars: [] });
  }, /contains no bars/);
  assert.throws(function () {
    fixtureSource.fromDocument({ schemaVersion: 1, columns: fixtureSource.COLUMNS, timeframe: 'M15', bars: [[1, 2, 3]] });
  }, /row 0 must have 6 columns/);
});

test('fixture and synthetic sources are interchangeable behind the interface', function () {
  [fixtureSource.createSource(), synthetic.createSource({
    catalog: CATALOG, symbols: ['EURUSD'], timeframe: 'M15', bars: 300, seed: 'iface'
  })].forEach(function (src) {
    sourceMod.assertSource(src);
    var g = sourceMod.guarded(src);
    var bars = g.load('EURUSD', 'M15');
    assert.ok(bars.length > 0);
    assert.equal(typeof g.meta('EURUSD', 'M15').datasetVersion, 'string');
  });
});
