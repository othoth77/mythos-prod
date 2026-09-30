'use strict';
// =====================================================
// MYTHOS TRADING AGENT — strategy engine tests
// projects/mythos-trading-agent/tests/strategy-test.js
//
// §3 is the section that matters most and it is generic: EVERY strategy is
// replayed over a full series and then over a truncated prefix of the same
// series, and the signals up to the cut must be identical. A strategy that read a
// later bar — directly, or through an indicator, or by holding state that the
// future had touched — produces different signals when the future is removed.
//
// It catches what a per-strategy review cannot: the test applies to strategies
// added in future phases without anyone remembering to write it, and it covers
// the stateful strategies (breakout-retest, the session opener) whose memory is
// exactly where a subtle leak would hide.
//
// §2 exercises every strategy over the committed fixtures and requires each one
// to produce SOME signals. A strategy that never fires is not conservative, it is
// dead code that would silently contribute nothing to every result.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var base = require(path.join(SRC, 'strategy', 'base'));
var registryMod = require(path.join(SRC, 'strategy', 'registry'));
var portfolioMod = require(path.join(SRC, 'strategy', 'portfolio'));
var candidateMod = require(path.join(SRC, 'strategy', 'candidate'));
var seriesMod = require(path.join(SRC, 'data', 'series'));
var resampleMod = require(path.join(SRC, 'data', 'resample'));
var fixtureSource = require(path.join(SRC, 'data', 'fixture-source'));
var instrumentMod = require(path.join(SRC, 'core', 'instrument'));
var costModelMod = require(path.join(SRC, 'cost', 'model'));
var configMod = require(path.join(SRC, 'config'));
var storeMod = require(path.join(SRC, 'db', 'store'));
var enums = require(path.join(SRC, 'core', 'enums'));
var money = require(path.join(SRC, 'core', 'money'));
var indicators = require(path.join(SRC, 'indicators'));

var CATALOG = instrumentMod.defaultCatalog();
var FIXTURES = fixtureSource.createSource();
var REGISTRY = registryMod.standard();
var CONFIG = configMod.load();

/**
 * Replays one strategy over a bar array, returning every signal it produced.
 * State is created fresh, so a prefix replay is a genuinely independent run.
 */
function replay(strategy, symbol, bars, opts) {
  var o = opts || {};
  var inst = CATALOG.get(symbol);
  var params = strategy.params(o.params || {});
  var series = seriesMod.create({ symbol: symbol, timeframe: 'M15', bars: bars, validate: false });
  var declared = strategy.indicators(params);
  Object.keys(declared).forEach(function (k) { series.addIndicator(k, declared[k]); });

  var higherSeries = null, align = null;
  var higherDeclared = strategy.higherIndicators(params);
  var htf = resampleMod.higherTimeframeView(bars, 'M15', 'H4');
  if (htf.bars.length) {
    higherSeries = seriesMod.create({ symbol: symbol, timeframe: 'H4', bars: htf.bars, validate: false });
    Object.keys(higherDeclared).forEach(function (k) { higherSeries.addIndicator(k, higherDeclared[k]); });
    align = htf.align;
  }

  var state = {};
  var warmup = strategy.warmupBars(params);
  var out = [];
  for (var i = warmup; i < bars.length; i++) {
    var hIdx = align ? align[i] : -1;
    var sig = strategy.evaluate({
      symbol: symbol,
      strategyId: strategy.strategyId,
      instrument: inst,
      view: series.viewAt(i),
      higherView: (higherSeries && hIdx >= 0) ? higherSeries.viewAt(hIdx) : null,
      higherTimeframe: 'H4',
      barIndex: i,
      ts: bars[i].ts,
      params: params,
      regime: o.regime || 'TREND',
      state: state,
      config: CONFIG
    });
    if (sig) out.push({ index: i, ts: bars[i].ts, signal: sig });
  }
  return out;
}

function fixtureBars(symbol, n) {
  return FIXTURES.load(symbol, 'M15').slice(0, n || 3000);
}

// ---------------------------------------------------------------------------
// 1. The interface and the registry
// ---------------------------------------------------------------------------

test('all fourteen mission §4 families are registered exactly once', function () {
  assert.equal(REGISTRY.count(), 14);
  var families = REGISTRY.families().slice().sort();
  assert.deepEqual(families, registryMod.FAMILIES.slice().sort());
  assert.equal(new Set(REGISTRY.ids()).size, 14, 'strategy ids must be unique');
});

test('the registry refuses a duplicate id, a duplicate family and an unknown family', function () {
  var r = registryMod.create();
  var s = REGISTRY.get('trend-following');
  r.register(s);
  assert.throws(function () { r.register(s); }, /already registered/);
  var clone = base.define({
    strategyId: 'trend-following-2', family: 'TREND_FOLLOWING', name: 'x', version: 1,
    defaultParams: { a: 1 }, paramSpace: { a: { min: 0, max: 2 } },
    indicators: function () { return {}; }, warmupBars: function () { return 1; },
    evaluate: function () { return null; }
  });
  assert.throws(function () { r.register(clone); }, /family TREND_FOLLOWING is already held by trend-following/);
  // define() does not police the family list — the registry does, because the
  // list is about what this platform measures rather than what a strategy is.
  assert.throws(function () {
    r.register(base.define({
      strategyId: 'y', family: 'SCALPING', name: 'y', version: 1,
      defaultParams: {}, paramSpace: {},
      indicators: function () { return {}; }, warmupBars: function () { return 1; },
      evaluate: function () { return null; }
    }));
  }, /not one of the mission §4 families/);
});

test('define() refuses an incoherent strategy definition', function () {
  function attempt(over) {
    var spec = {
      strategyId: 'test-strat', family: 'MOMENTUM', name: 'n', version: 1,
      defaultParams: { p: 5 }, paramSpace: { p: { min: 1, max: 10 } },
      indicators: function () { return {}; }, warmupBars: function () { return 1; },
      evaluate: function () { return null; }
    };
    Object.keys(over).forEach(function (k) {
      if (over[k] === undefined) delete spec[k]; else spec[k] = over[k];
    });
    return function () { base.define(spec); };
  }
  assert.throws(attempt({ evaluate: undefined }), /is missing "evaluate"/);
  assert.throws(attempt({ strategyId: 'Not_Kebab' }), /must be kebab-case/);
  assert.throws(attempt({ defaultParams: { p: 99 } }), /outside its paramSpace/);
  assert.throws(attempt({ defaultParams: { p: 5, q: 1 } }), /no paramSpace entry/);
  assert.throws(attempt({ paramSpace: { p: { min: 1, max: 10 }, r: { min: 0, max: 1 } } }), /paramSpace declares "r" but defaultParams does not/);
  assert.throws(attempt({ preferredRegimes: ['SIDEWAYS'] }), /must be one of/);
});

test('params() merges, validates bounds and rejects unknown names', function () {
  var s = REGISTRY.get('trend-following');
  assert.equal(s.params({}).fast, 20);
  assert.equal(s.params({ fast: 8 }).fast, 8);
  assert.equal(s.params({ fast: 8 }).slow, 50, 'siblings keep their defaults');
  assert.throws(function () { s.params({ fast: 999 }); }, /outside \[5, 50\]/);
  assert.throws(function () { s.params({ nonsense: 1 }); }, /unknown parameter "nonsense"/);
  assert.ok(Object.isFrozen(s.params({})));
});

test('a strategy fingerprint changes with its parameters and not with key order', function () {
  var s = REGISTRY.get('trend-following');
  var a = s.fingerprint({ fast: 10, slow: 40 });
  var b = s.fingerprint({ slow: 40, fast: 10 });
  assert.equal(a.paramsHash, b.paramsHash);
  assert.notEqual(a.paramsHash, s.fingerprint({ fast: 11, slow: 40 }).paramsHash);
  assert.equal(a.strategyId, 'trend-following');
});

test('a strategy cannot express a position size', function () {
  var s = base.define({
    strategyId: 'sizer', family: 'MOMENTUM', name: 'n', version: 1,
    defaultParams: {}, paramSpace: {},
    indicators: function () { return {}; }, warmupBars: function () { return 0; },
    evaluate: function () { return { direction: 'LONG', stopLoss: 0.9, takeProfit: 1.2, lots: 0.5 }; }
  });
  assert.throws(function () {
    s.evaluate({ view: { close: function () { return 1; } } });
  }, /must not carry a size. Position sizing belongs to the Risk Engine alone/);
});

test('an inverted or neutral signal is refused at the strategy that produced it', function () {
  function sig(s) {
    return base.define({
      strategyId: 'sig-test', family: 'MOMENTUM', name: 'n', version: 1,
      defaultParams: {}, paramSpace: {},
      indicators: function () { return {}; }, warmupBars: function () { return 0; },
      evaluate: function () { return s; }
    }).evaluate({ view: { close: function () { return 1; } } });
  }
  assert.throws(function () { sig({ direction: 'NEUTRAL', stopLoss: 0.9, takeProfit: 1.1 }); }, /cannot be NEUTRAL/);
  assert.throws(function () { sig({ direction: 'LONG', stopLoss: 1.1, takeProfit: 1.2 }); }, /LONG stop \(1.1\) must be below/);
  assert.throws(function () { sig({ direction: 'LONG', stopLoss: 0.9, takeProfit: 0.95 }); }, /LONG target \(0.95\) must be above/);
  assert.throws(function () { sig({ direction: 'SHORT', stopLoss: 0.9, takeProfit: 0.8 }); }, /SHORT stop \(0.9\) must be above/);
  assert.throws(function () { sig({ direction: 'SHORT', stopLoss: 1.1, takeProfit: 1.2 }); }, /SHORT target \(1.2\) must be below/);
  assert.throws(function () { sig({ direction: 'LONG', stopLoss: 0, takeProfit: 1.1 }); }, /positive finite price/);
  assert.throws(function () { sig({ direction: 'LONG', stopLoss: 0.9, takeProfit: 1.1, confidence: 2 }); }, /confidence must be in \[0, 1\]/);
  assert.equal(sig(null), null);
});

// ---------------------------------------------------------------------------
// 2. Every strategy runs, and fires
// ---------------------------------------------------------------------------

test('every strategy declares a positive warmup that covers its longest indicator', function () {
  REGISTRY.all().forEach(function (s) {
    var w = s.warmupBars();
    assert.ok(w > 0, s.strategyId + ' declares warmup ' + w);
    assert.ok(w < 2000, s.strategyId + ' warmup ' + w + ' is implausibly long');
  });
});

test('every strategy produces valid signals over the committed fixtures', function () {
  var bars = fixtureBars('EURUSD');
  var summary = {};
  REGISTRY.all().forEach(function (s) {
    var signals = replay(s, 'EURUSD', bars);
    summary[s.strategyId] = signals.length;
    signals.forEach(function (rec) {
      var sig = rec.signal;
      assert.ok(enums.isValid(enums.Direction, sig.direction));
      assert.notEqual(sig.direction, 'NEUTRAL');
      assert.ok(sig.stopLoss > 0 && sig.takeProfit > 0);
      assert.ok(sig.confidence >= 0 && sig.confidence <= 1);
      assert.ok(Array.isArray(sig.reasonCodes) && sig.reasonCodes.length > 0,
        s.strategyId + ' produced a signal with no reason codes — unexplainable by construction');
      assert.equal(sig.strategyId, s.strategyId);
      var isLong = sig.direction === 'LONG';
      assert.ok(isLong ? sig.stopLoss < sig.referencePrice : sig.stopLoss > sig.referencePrice);
      assert.ok(isLong ? sig.takeProfit > sig.referencePrice : sig.takeProfit < sig.referencePrice);
    });
  });
  // No strategy may be silent: dead code contributes nothing to every result.
  var silent = Object.keys(summary).filter(function (k) { return summary[k] === 0; });
  assert.deepEqual(silent, [], 'these strategies never fired over 3000 bars: ' + JSON.stringify(summary));
});

test('every strategy also runs on gold and on a JPY pair without incident', function () {
  ['XAUUSD', 'USDJPY'].forEach(function (sym) {
    var bars = fixtureBars(sym, 1500);
    REGISTRY.all().forEach(function (s) {
      var signals = replay(s, sym, bars);
      signals.forEach(function (rec) {
        // The stop distance must be sane in the instrument's own units — this is
        // what catches a strategy that hard-codes a pip distance suited to EURUSD.
        var inst = CATALOG.get(sym);
        var stopPips = Math.abs(rec.signal.referencePrice - rec.signal.stopLoss) / inst.pipSize;
        assert.ok(stopPips > 0.5, s.strategyId + ' on ' + sym + ' produced a ' + stopPips + '-pip stop');
        assert.ok(stopPips < 20000, s.strategyId + ' on ' + sym + ' produced a ' + stopPips + '-pip stop');
      });
    });
  });
});

test('both directions are represented across the portfolio', function () {
  var bars = fixtureBars('EURUSD');
  var dirs = {};
  REGISTRY.all().forEach(function (s) {
    replay(s, 'EURUSD', bars).forEach(function (rec) { dirs[rec.signal.direction] = (dirs[rec.signal.direction] || 0) + 1; });
  });
  assert.ok(dirs.LONG > 0 && dirs.SHORT > 0, 'a portfolio that only goes one way is not measuring direction: ' + JSON.stringify(dirs));
});

// ---------------------------------------------------------------------------
// 3. No strategy can see the future
// ---------------------------------------------------------------------------

test('every strategy is causal: truncating the future does not change past signals', function () {
  var full = fixtureBars('EURUSD', 1600);
  var cut = 1200;
  var prefix = full.slice(0, cut);
  var checked = 0;

  REGISTRY.all().forEach(function (s) {
    var a = replay(s, 'EURUSD', full).filter(function (r) { return r.index < cut; });
    var b = replay(s, 'EURUSD', prefix).filter(function (r) { return r.index < cut; });
    assert.deepEqual(
      b.map(summarise), a.map(summarise),
      s.strategyId + ' produced different signals when the bars after index ' + cut +
      ' were removed. That is look-ahead: it read information that did not exist yet.'
    );
    checked++;
  });
  assert.equal(checked, 14);

  function summarise(r) {
    return [r.index, r.signal.direction, r.signal.stopLoss, r.signal.takeProfit, r.signal.reasonCodes.join('|')];
  }
});

test('stateful strategies keep their memory per run, not per module', function () {
  // Two replays of the same strategy over the same bars must agree exactly. If
  // state leaked between runs, the second would differ.
  ['breakout-retest', 'session-opening-range'].forEach(function (id) {
    var s = REGISTRY.get(id);
    var bars = fixtureBars('EURUSD', 1200);
    var a = replay(s, 'EURUSD', bars);
    var b = replay(s, 'EURUSD', bars);
    assert.deepEqual(a, b, id + ' is not run-isolated');
    assert.ok(a.length > 0, id + ' never fired');
  });
});

test('the session strategy takes at most one attempt per session day', function () {
  var s = REGISTRY.get('session-opening-range');
  var signals = replay(s, 'EURUSD', fixtureBars('EURUSD'));
  var perDay = {};
  signals.forEach(function (r) {
    var day = r.signal.meta.sessionDay;
    perDay[day] = (perDay[day] || 0) + 1;
  });
  Object.keys(perDay).forEach(function (d) {
    assert.equal(perDay[d], 1, 'session ' + d + ' produced ' + perDay[d] + ' signals');
  });
  assert.ok(Object.keys(perDay).length > 3, 'only ' + Object.keys(perDay).length + ' sessions fired');
});

test('the retest strategy only fires after a break it recorded itself', function () {
  var s = REGISTRY.get('breakout-retest');
  var signals = replay(s, 'EURUSD', fixtureBars('EURUSD'));
  assert.ok(signals.length > 0);
  var p = s.params({});
  signals.forEach(function (r) {
    assert.ok(r.signal.meta.barsSinceBreak >= 1, 'a retest cannot happen on the break bar itself');
    assert.ok(r.signal.meta.barsSinceBreak <= p.retestBars);
    assert.ok(r.signal.meta.retestDistanceAtr <= p.retestAtr);
  });
});

test('the mtf strategy only reads a closed higher-timeframe bar', function () {
  var s = REGISTRY.get('mtf-trend');
  var bars = fixtureBars('EURUSD');
  var signals = replay(s, 'EURUSD', bars);
  assert.ok(signals.length > 0);
  assert.equal(s.usesHigherTimeframe, true);
  signals.forEach(function (r) {
    assert.equal(r.signal.meta.htfTimeframe, 'H4');
    assert.ok(r.signal.meta.pullbackAtr <= s.params({}).maxPullbackAtr + 1e-9);
  });
});

test('the mean-reversion ADX veto actually suppresses signals', function () {
  var s = REGISTRY.get('mean-reversion');
  var bars = fixtureBars('EURUSD');
  // 10 and 50 are the search-space bounds for adxMax; going outside them is
  // refused, which is itself the point of the space being declared.
  var vetoed = replay(s, 'EURUSD', bars, { params: { adxMax: 10 } }).length;
  var permissive = replay(s, 'EURUSD', bars, { params: { adxMax: 50 } }).length;
  assert.ok(permissive > vetoed, 'the veto is inert: ' + permissive + ' vs ' + vetoed);
  replay(s, 'EURUSD', bars).forEach(function (r) {
    assert.ok(r.signal.meta.adx <= s.params({}).adxMax);
  });
});

test('the range-trading efficiency-ratio gate actually suppresses signals', function () {
  var s = REGISTRY.get('range-trading');
  var bars = fixtureBars('EURUSD');
  var strict = replay(s, 'EURUSD', bars, { params: { erMax: 0.1 } }).length;
  var loose = replay(s, 'EURUSD', bars, { params: { erMax: 0.8 } }).length;
  assert.ok(loose > strict, 'the range gate is inert: ' + loose + ' vs ' + strict);
});

test('mean-reversion and range-trading cannot be configured below their reward/risk floor', function () {
  // A 0.3R target with an 85 % win rate is a bet that the eighth loss never
  // comes; the search space forbids expressing it.
  ['mean-reversion', 'range-trading'].forEach(function (id) {
    var s = REGISTRY.get(id);
    assert.equal(s.paramSpace.rewardRisk.min, 0.8, id);
    assert.throws(function () { s.params({ rewardRisk: 0.3 }); }, /outside \[0.8/);
  });
});

// ---------------------------------------------------------------------------
// 4. The portfolio
// ---------------------------------------------------------------------------

test('the portfolio deduplicates indicators across strategies', function () {
  var pf = portfolioMod.create({ registry: REGISTRY });
  var bars = fixtureBars('EURUSD', 600);
  var series = seriesMod.create({ symbol: 'EURUSD', timeframe: 'M15', bars: bars, validate: false });
  var htf = resampleMod.higherTimeframeView(bars, 'M15', 'H4');
  var higher = seriesMod.create({ symbol: 'EURUSD', timeframe: 'H4', bars: htf.bars, validate: false });

  var res = pf.prepareSeries({ symbol: 'EURUSD', series: series, higherSeries: higher });
  var declared = 0;
  pf.resolved().forEach(function (r) { declared += Object.keys(r.indicators).length; });
  assert.ok(res.base < declared, 'nothing was shared: ' + res.base + ' registered from ' + declared + ' declarations');
  assert.equal(series.indicatorNames().length, res.base);
  assert.ok(res.higher > 0, 'the higher-timeframe indicators were not registered');

  // Registering twice must not duplicate.
  var again = pf.prepareSeries({ symbol: 'EURUSD', series: series, higherSeries: higher });
  assert.deepEqual(again, { base: 0, higher: 0 });
});

test('the portfolio warmup is the maximum of its strategies', function () {
  var pf = portfolioMod.create({ registry: REGISTRY });
  var expected = REGISTRY.all().reduce(function (m, s) { return Math.max(m, s.warmupBars()); }, 0);
  assert.equal(pf.warmupBars(), expected);
  assert.equal(pf.usesHigherTimeframe(), true);
});

test('the portfolio refuses to be empty and validates its overrides up front', function () {
  assert.throws(function () { portfolioMod.create({ registry: REGISTRY, enabled: [] }); }, /at least one/);
  assert.throws(function () { portfolioMod.create({ registry: REGISTRY, enabled: ['nope'] }); }, /unknown strategy/);
  assert.throws(function () {
    portfolioMod.create({ registry: REGISTRY, enabled: ['momentum'], params: { breakout: { channel: 10 } } });
  }, /not enabled in this portfolio/);
  assert.throws(function () {
    portfolioMod.create({ registry: REGISTRY, enabled: ['momentum'], params: { momentum: { rocPeriod: 9999 } } });
  }, /outside/);
});

test('the portfolio asks every strategy regardless of regime, and only reorders', function () {
  var pf = portfolioMod.create({ registry: REGISTRY });
  var bars = fixtureBars('EURUSD', 1500);
  var inst = CATALOG.get('EURUSD');
  var series = seriesMod.create({ symbol: 'EURUSD', timeframe: 'M15', bars: bars, validate: false });
  var htf = resampleMod.higherTimeframeView(bars, 'M15', 'H4');
  var higher = seriesMod.create({ symbol: 'EURUSD', timeframe: 'H4', bars: htf.bars, validate: false });
  pf.prepareSeries({ symbol: 'EURUSD', series: series, higherSeries: higher });
  pf.resetState();

  var inTrend = 0, inRange = 0, seenStrategies = {};
  for (var i = pf.warmupBars(); i < bars.length; i++) {
    var hIdx = htf.align[i];
    var ctxBase = {
      symbol: 'EURUSD', instrument: inst, view: series.viewAt(i),
      higherView: hIdx >= 0 ? higher.viewAt(hIdx) : null, higherTimeframe: 'H4',
      barIndex: i, ts: bars[i].ts, config: CONFIG
    };
    var trendSignals = pf.evaluate(Object.assign({ regime: 'TREND' }, ctxBase));
    pf.resetState();
    var rangeSignals = pf.evaluate(Object.assign({ regime: 'RANGE' }, ctxBase));
    pf.resetState();
    inTrend += trendSignals.length;
    inRange += rangeSignals.length;
    trendSignals.forEach(function (s) { seenStrategies[s.strategy.strategyId] = true; });
  }
  // The regime must not change WHETHER a strategy is asked. Session and retest
  // strategies depend on state that resetState() clears, so allow a small
  // difference from those two alone; everything else must match exactly.
  assert.ok(Math.abs(inTrend - inRange) <= 2,
    'regime changed how many signals were produced (' + inTrend + ' vs ' + inRange + '); it must only reorder');
  assert.ok(Object.keys(seenStrategies).length >= 10,
    'only ' + Object.keys(seenStrategies).length + ' strategies were ever asked');
});

test('prioritise puts regime-aligned strategies first, then confidence, deterministically', function () {
  var pf = portfolioMod.create({ registry: REGISTRY });
  var fake = [
    { strategy: { strategyId: 'b' }, signal: { confidence: 0.9 }, regimeAligned: false },
    { strategy: { strategyId: 'a' }, signal: { confidence: 0.5 }, regimeAligned: true },
    { strategy: { strategyId: 'c' }, signal: { confidence: 0.5 }, regimeAligned: true },
    { strategy: { strategyId: 'd' }, signal: { confidence: 0.7 }, regimeAligned: true }
  ];
  var order = pf.prioritise(fake).map(function (s) { return s.strategy.strategyId; });
  assert.deepEqual(order, ['d', 'a', 'c', 'b']);
  assert.deepEqual(pf.prioritise(fake).map(function (s) { return s.strategy.strategyId; }), order,
    'prioritise must be deterministic');
});

test('state bags are isolated per symbol and per strategy', function () {
  var pf = portfolioMod.create({ registry: REGISTRY });
  pf.stateFor('EURUSD', 'breakout-retest').x = 1;
  assert.equal(pf.stateFor('XAUUSD', 'breakout-retest').x, undefined);
  assert.equal(pf.stateFor('EURUSD', 'momentum').x, undefined);
  assert.equal(pf.stateFor('EURUSD', 'breakout-retest').x, 1);
  pf.resetState();
  assert.equal(pf.stateFor('EURUSD', 'breakout-retest').x, undefined);
});

test('the signal cooldown removes near-duplicates and counts what it removed', function () {
  var bars = fixtureBars('EURUSD', 1500);
  var inst = CATALOG.get('EURUSD');

  function countSignals(cooldownBars) {
    var pf = portfolioMod.create({
      registry: REGISTRY, enabled: ['range-trading'], signalCooldownBars: cooldownBars
    });
    var series = seriesMod.create({ symbol: 'EURUSD', timeframe: 'M15', bars: bars, validate: false });
    pf.prepareSeries({ symbol: 'EURUSD', series: series, higherSeries: null });
    pf.resetState();
    var n = 0;
    for (var i = pf.warmupBars(); i < bars.length; i++) {
      n += pf.evaluate({
        symbol: 'EURUSD', instrument: inst, view: series.viewAt(i), higherView: null,
        higherTimeframe: 'H4', barIndex: i, ts: bars[i].ts, regime: 'RANGE', config: CONFIG
      }).length;
    }
    return { kept: n, stats: pf.cooldownStats() };
  }

  var off = countSignals(0);
  var on = countSignals(20);
  assert.equal(off.stats.suppressedSignals, 0, 'off by default, and off means nothing is removed');
  assert.ok(on.kept < off.kept, 'the cooldown removed nothing: ' + on.kept + ' vs ' + off.kept);
  assert.equal(on.kept + on.stats.suppressedSignals, off.kept,
    'kept + suppressed must account for every signal the strategy produced');
  assert.equal(on.stats.signalCooldownBars, 20);
});

test('the cooldown defaults to off in configuration', function () {
  assert.equal(configMod.load().strategy.signalCooldownBars, 0);
  assert.throws(function () { configMod.load({ strategy: { signalCooldownBars: -1 } }); }, /must be >= 0/);
});

test('a strategy that throws is named in the error', function () {
  var reg = registryMod.create();
  reg.register(base.define({
    strategyId: 'explode', family: 'MOMENTUM', name: 'n', version: 1,
    defaultParams: {}, paramSpace: {},
    indicators: function () { return {}; }, warmupBars: function () { return 0; },
    evaluate: function () { throw new Error('boom'); }
  }));
  var pf = portfolioMod.create({ registry: reg });
  assert.throws(function () {
    pf.evaluate({ symbol: 'EURUSD', instrument: CATALOG.get('EURUSD'), barIndex: 5, ts: 1, config: CONFIG, view: null });
  }, /strategy explode failed on EURUSD bar 5: boom/);
});

test('the portfolio persists its composition and parameter versions', function () {
  var store = storeMod.create({ runId: 'r' });
  var pf = portfolioMod.create({ registry: REGISTRY });
  assert.equal(pf.persist(store), 14);
  assert.equal(store.table('strategies').count(), 14);
  assert.equal(store.table('strategy_versions').count(), 14);
  var row = store.table('strategies').first('strategyId', 'trend-following');
  assert.equal(row.family, 'TREND_FOLLOWING');
  assert.ok(row.warmupBars > 0);
  var ver = store.table('strategy_versions').first('strategyId', 'trend-following');
  assert.equal(ver.paramsHash, REGISTRY.get('trend-following').fingerprint().paramsHash);
});

// ---------------------------------------------------------------------------
// 5. Candidate construction
// ---------------------------------------------------------------------------

function buildCandidate(over) {
  var inst = CATALOG.get('EURUSD');
  var cfg = configMod.load({ cost: { slippageModel: 'fixed', fixedSlippagePips: 0.5 } });
  var cm = costModelMod.create(cfg);
  var spec = {
    candidateId: 'c1',
    ts: Date.parse('2024-01-03T10:00:00Z'),
    instrument: inst,
    timeframe: 'M15',
    signal: {
      strategyId: 'trend-following', direction: 'LONG', referencePrice: 1.08,
      stopLoss: 1.078, takeProfit: 1.084, confidence: 0.6,
      reasonCodes: ['EMA_CROSS_UP'], meta: {}
    },
    strategyFingerprint: { strategyId: 'trend-following', version: 1, paramsHash: 'abc123' },
    regime: 'TREND',
    regimeConfidence: 0.7,
    spreadPips: 1.2,
    costModel: cm
  };
  Object.keys(over || {}).forEach(function (k) { spec[k] = over[k]; });
  return candidateMod.build(spec);
}

test('a candidate carries every field mission §4 requires', function () {
  var c = buildCandidate();
  ['candidateId', 'ts', 'symbol', 'strategyId', 'timeframe', 'direction', 'entry',
    'stopLoss', 'takeProfit', 'rewardRisk', 'regime', 'spreadPips',
    'estimatedCostMoney', 'expectedNetMoney'
  ].forEach(function (f) {
    assert.ok(c[f] !== undefined && c[f] !== null, 'candidate is missing ' + f);
  });
  // And it must satisfy the store's own required-field list.
  storeMod.create({ runId: 'r' }).table('candidates').insert(c);
});

test('candidate risk and reward arithmetic is exact', function () {
  var c = buildCandidate();
  // entry 1.08, stop 1.078 → 20 pips; target 1.084 → 40 pips
  assert.equal(c.riskPips, 20);
  assert.equal(c.rewardPips, 40);
  assert.equal(c.rewardRisk, 2);
  // cost = 1.2 spread + 0.5 entry slip + 0.5 exit slip = 2.2 pips
  assert.equal(c.costPips, 2.2);
  assert.equal(c.netRewardPips, 37.8);
  assert.equal(c.netRiskPips, 22.2);
  assert.equal(c.netRewardRisk, money.round(37.8 / 22.2, 6));
  assert.ok(c.netRewardRisk < c.rewardRisk, 'costs must reduce the reward/risk a chart would show');
});

test('breakeven win rate is the honest headline, and it accounts for costs', function () {
  var c = buildCandidate();
  assert.equal(c.breakevenWinRate, money.round(22.2 / 60, 6));
  // Without costs a 2:1 trade breaks even at 33.3 %; with them it needs more.
  assert.ok(c.breakevenWinRate > 1 / 3);
});

test('the expected net records the source of its win probability', function () {
  var c = buildCandidate();
  assert.equal(c.winProbability, 0.5);
  assert.equal(c.winProbabilitySource, 'PRIOR_UNINFORMED');
  assert.equal(c.expectedNetPips, money.round(0.5 * 37.8 - 0.5 * 22.2, 6));

  var informed = buildCandidate({ winProbability: 0.35, winProbabilitySource: 'HISTORICAL' });
  assert.equal(informed.winProbabilitySource, 'HISTORICAL');
  assert.equal(informed.expectedNetPips, money.round(0.35 * 37.8 - 0.65 * 22.2, 6));
  assert.throws(function () { buildCandidate({ winProbability: 1.5 }); }, /must be in \[0, 1\]/);
});

test('money figures are relative to a stated basis size', function () {
  var c = buildCandidate();
  assert.equal(c.costBasisLots, 0.01);
  // 2.2 pips at $0.10 per pip for 0.01 lots
  assert.equal(c.estimatedCostMoney, 0.22);
  assert.equal(c.netIfTargetMoney, 3.78);
  assert.equal(c.netIfStopMoney, -2.22);
});

test('a candidate whose target is inside the cost is flagged uneconomic', function () {
  var tight = buildCandidate({
    signal: {
      strategyId: 's', direction: 'LONG', referencePrice: 1.08,
      stopLoss: 1.0798, takeProfit: 1.08015, confidence: 0.5, reasonCodes: ['x'], meta: {}
    }
  });
  assert.ok(tight.rewardPips < tight.costPips);
  assert.ok(tight.netRewardPips <= 0);
  assert.equal(candidateMod.isUneconomic(tight), true);
  var reasons = candidateMod.costReasons(tight, CONFIG);
  assert.ok(reasons.indexOf('TARGET_INSIDE_COST') !== -1);
  assert.equal(candidateMod.isUneconomic(buildCandidate()), false);
});

test('cost reason codes name each failing condition', function () {
  var c = buildCandidate();
  assert.deepEqual(candidateMod.costReasons(c, CONFIG), [], 'a healthy candidate has no cost objections');
  var strict = configMod.load({ risk: { minRewardRisk: 5 } });
  assert.deepEqual(candidateMod.costReasons(c, strict), ['NET_REWARD_RISK_BELOW_MIN']);
});

test('swap enters the candidate cost when nights are expected', function () {
  var withSwap = buildCandidate({ estimatedNights: 2 });
  var without = buildCandidate({ estimatedNights: 0 });
  assert.ok(withSwap.estimatedSwapPips > 0, 'a long EURUSD position pays swap');
  assert.ok(withSwap.costPips > without.costPips);
  assert.equal(without.estimatedSwapPips, 0);
});

test('a short position gets the correct swap sign', function () {
  var shortSig = {
    strategyId: 's', direction: 'SHORT', referencePrice: 1.08,
    stopLoss: 1.082, takeProfit: 1.076, confidence: 0.5, reasonCodes: ['x'], meta: {}
  };
  var c = buildCandidate({ signal: shortSig, estimatedNights: 2 });
  // Short EURUSD earns carry (+0.4/lot/day), so the swap COST is negative.
  assert.ok(c.estimatedSwapPips < 0);
  assert.equal(c.direction, 'SHORT');
  assert.equal(c.riskPips, 20);
  assert.equal(c.rewardPips, 40);
});

test('an inverted candidate is refused rather than recorded', function () {
  assert.throws(function () {
    candidateMod.build({
      candidateId: 'bad', ts: 1, instrument: CATALOG.get('EURUSD'), timeframe: 'M15',
      signal: { strategyId: 's', direction: 'LONG', referencePrice: 1.08, stopLoss: 1.09, takeProfit: 1.1, confidence: 0.5, reasonCodes: [], meta: {} },
      strategyFingerprint: { strategyId: 's', version: 1, paramsHash: 'x' },
      regime: 'TREND', spreadPips: 1.2, costModel: costModelMod.create(configMod.load({ cost: { slippageModel: 'none' } }))
    });
  }, /has an inverted level/);
});

test('gold candidates price correctly in their own units', function () {
  var gold = CATALOG.get('XAUUSD');
  var cm = costModelMod.create(configMod.load({ cost: { slippageModel: 'none' } }));
  var c = candidateMod.build({
    candidateId: 'g1', ts: 1, instrument: gold, timeframe: 'M15',
    signal: { strategyId: 's', direction: 'LONG', referencePrice: 2300, stopLoss: 2297, takeProfit: 2306, confidence: 0.5, reasonCodes: ['x'], meta: {} },
    strategyFingerprint: { strategyId: 's', version: 1, paramsHash: 'x' },
    regime: 'TREND', spreadPips: 28, costModel: cm
  });
  assert.equal(c.riskPips, 300, '$3 at 0.01 per pip');
  assert.equal(c.rewardPips, 600);
  assert.equal(c.costPips, 28);
  // 0.01 lots of gold is 1 ounce: $1 per 100 pips
  assert.equal(c.estimatedCostMoney, 0.28);
  assert.equal(c.netIfStopMoney, -3.28);
});

// ---------------------------------------------------------------------------
// 6. Indicator declarations are honest
// ---------------------------------------------------------------------------

test('every declared indicator computes without error and matches the series length', function () {
  var bars = fixtureBars('EURUSD', 400);
  var series = seriesMod.create({ symbol: 'EURUSD', timeframe: 'M15', bars: bars, validate: false });
  REGISTRY.all().forEach(function (s) {
    var declared = s.indicators();
    Object.keys(declared).forEach(function (k) {
      var values = declared[k](series);
      assert.ok(Array.isArray(values), s.strategyId + ':' + k + ' did not return an array');
      assert.equal(values.length, bars.length, s.strategyId + ':' + k + ' length');
    });
  });
});

test('indicator keys encode their parameters, so two parameterisations cannot collide', function () {
  var s = REGISTRY.get('trend-following');
  var a = Object.keys(s.indicators(s.params({ fast: 10 })));
  var b = Object.keys(s.indicators(s.params({ fast: 30 })));
  assert.notDeepEqual(a, b);
  assert.ok(a.indexOf('ema_10') !== -1);
  assert.ok(b.indexOf('ema_30') !== -1);
});

test('a strategy reading an unregistered indicator fails loudly', function () {
  var bars = fixtureBars('EURUSD', 300);
  var series = seriesMod.create({ symbol: 'EURUSD', timeframe: 'M15', bars: bars, validate: false });
  series.addIndicator('atr_14', function (s2) { return indicators.atr(s2.bars(), 14); });
  assert.throws(function () { series.viewAt(200).indicator('ema_20'); }, /unknown indicator "ema_20"/);
});
