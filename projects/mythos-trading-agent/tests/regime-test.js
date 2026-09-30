'use strict';
// =====================================================
// MYTHOS TRADING AGENT — market regime engine tests
// projects/mythos-trading-agent/tests/regime-test.js
//
// §4 is the unusual one: the classifier is scored against the synthetic
// generator's PUBLISHED GROUND TRUTH, which is only possible because we wrote the
// generator. The thresholds asserted there are the measured values minus a small
// margin — they exist to catch a regression, not as targets to tune toward.
// Tuning a classifier until a number computed from a process we authored looks
// good would be fitting to our own fiction.
//
// The weak classes are asserted too, at their honest values. UNSTABLE recall is
// around 7 % and the test says 4 %, not 50 %. A test that demanded a number the
// system does not achieve would simply be deleted by whoever hit it next.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var regimeMod = require(path.join(SRC, 'regime', 'engine'));
var synthetic = require(path.join(SRC, 'data', 'synthetic-source'));
var seriesMod = require(path.join(SRC, 'data', 'series'));
var instrumentMod = require(path.join(SRC, 'core', 'instrument'));
var enums = require(path.join(SRC, 'core', 'enums'));

var CATALOG = instrumentMod.defaultCatalog();
var EUR = CATALOG.get('EURUSD');

/** Builds a series with the regime engine's indicators registered. */
function prepared(bars, engine) {
  var s = seriesMod.create({ symbol: 'EURUSD', timeframe: 'M15', bars: bars, validate: false });
  var declared = engine.indicators();
  Object.keys(declared).forEach(function (k) { s.addIndicator(k, declared[k]); });
  return s;
}

/** Classifies a whole generated series, returning classifications and truth. */
function classifyAll(spec) {
  var engine = regimeMod.create(spec.params);
  var gen = synthetic.generate({
    instrument: spec.instrument || EUR, timeframe: 'M15',
    bars: spec.bars || 6000, seed: spec.seed,
    regimeSequence: spec.regimeSequence
  });
  var series = prepared(gen.bars, engine);
  var state = engine.newState();
  var out = [];
  for (var i = engine.warmupBars(); i < gen.bars.length; i++) {
    var c = engine.classify(series.viewAt(i), state);
    if (c) out.push({ index: i, classification: c, truth: gen.regimeTruth[i] });
  }
  return { engine: engine, gen: gen, series: series, rows: out };
}

/** Confusion matrix and recall per true regime. */
function confusion(rows) {
  var mat = {}, totals = {};
  rows.forEach(function (r) {
    mat[r.truth] = mat[r.truth] || {};
    mat[r.truth][r.classification.regime] = (mat[r.truth][r.classification.regime] || 0) + 1;
    totals[r.truth] = (totals[r.truth] || 0) + 1;
  });
  var recall = {};
  Object.keys(mat).forEach(function (t) { recall[t] = (mat[t][t] || 0) / totals[t]; });
  var correct = rows.filter(function (r) { return r.classification.regime === r.truth; }).length;
  return { matrix: mat, totals: totals, recall: recall, accuracy: correct / rows.length, n: rows.length };
}

// ---------------------------------------------------------------------------
// 1. Shape and contract
// ---------------------------------------------------------------------------

test('the engine declares indicators, a warmup, and rejects unknown parameters', function () {
  var e = regimeMod.create();
  var names = Object.keys(e.indicators());
  assert.ok(names.length >= 9);
  assert.ok(names.indexOf('volRatio') !== -1, 'the cost model reads volRatio from this engine');
  assert.ok(e.warmupBars() > 200, 'the ATR percentile needs a long lookback');
  assert.throws(function () { regimeMod.create({ nonsense: 1 }); }, /unknown regime parameter "nonsense"/);
  assert.ok(Object.isFrozen(e.params));
});

test('classify returns null until every feature is available', function () {
  var e = regimeMod.create();
  var gen = synthetic.generate({ instrument: EUR, timeframe: 'M15', bars: 800, seed: 'warm' });
  var s = prepared(gen.bars, e);
  var state = e.newState();
  assert.equal(e.classify(s.viewAt(10), state), null);
  assert.equal(e.classify(s.viewAt(100), state), null);
  assert.notEqual(e.classify(s.viewAt(e.warmupBars()), state), null);
});

test('a classification carries a valid regime, direction, confidence and its evidence', function () {
  var res = classifyAll({ seed: 'shape', bars: 1200 });
  assert.ok(res.rows.length > 300);
  res.rows.forEach(function (r) {
    var c = r.classification;
    assert.ok(enums.isValid(enums.Regime, c.regime), 'bad regime ' + c.regime);
    assert.ok(enums.isValid(enums.Direction, c.direction));
    assert.ok(c.confidence >= 0 && c.confidence <= 1, 'confidence ' + c.confidence);
    assert.ok(c.margin >= 0);
    assert.ok(enums.isValid(enums.Regime, c.topRegime));
    assert.equal(Object.keys(c.scores).length, 6, 'every regime must be scored, not just the winner');
    enums.values(enums.Regime).forEach(function (rg) {
      assert.ok(c.scores[rg] >= 0 && c.scores[rg] <= 1, rg + ' scored ' + c.scores[rg]);
    });
    // Mission §17: the classification must be explainable from its own record.
    ['adx', 'efficiencyRatio', 'efficiencyRatioShort', 'volRatio', 'atrRank', 'flipRate'].forEach(function (f) {
      assert.ok(c.features[f] !== undefined, 'feature ' + f + ' is not recorded');
    });
  });
});

test('flipRate is recorded as evidence but carries no weight in the score', function () {
  // It was measured at 0.49-0.54 for every regime, so it discriminates nothing.
  // Changing it must not change any score.
  var e = regimeMod.create();
  var f = {
    adx: 25, efficiencyRatio: 0.2, efficiencyRatioShort: 0.35, volRatio: 1.2,
    atrRank: 0.6, flipRate: 0.1, plusDI: 20, minusDI: 15, breakAge: 3
  };
  var low = e.score(f);
  f.flipRate = 0.9;
  var high = e.score(f);
  assert.deepEqual(high, low, 'flipRate must not influence the score while it is known not to discriminate');
});

test('the classifier is deterministic', function () {
  var a = classifyAll({ seed: 'determinism', bars: 1500 });
  var b = classifyAll({ seed: 'determinism', bars: 1500 });
  assert.deepEqual(
    a.rows.map(function (r) { return [r.index, r.classification.regime, r.classification.confidence]; }),
    b.rows.map(function (r) { return [r.index, r.classification.regime, r.classification.confidence]; })
  );
});

// ---------------------------------------------------------------------------
// 2. Hysteresis
// ---------------------------------------------------------------------------

test('a regime persists for at least the minimum dwell', function () {
  var res = classifyAll({ seed: 'dwell', bars: 3000 });
  var runs = [];
  var current = null, length = 0;
  res.rows.forEach(function (r) {
    if (r.classification.regime === current) { length++; return; }
    if (current !== null) runs.push({ regime: current, length: length });
    current = r.classification.regime; length = 1;
  });
  runs.push({ regime: current, length: length });
  // Every completed run except possibly the first and last must meet the dwell.
  var short = runs.slice(1, -1).filter(function (r) { return r.length < res.engine.params.minBarsInRegime; });
  assert.deepEqual(short, [], 'runs shorter than the dwell: ' + JSON.stringify(short));
  assert.ok(runs.length > 5, 'the regime never changed, so hysteresis proves nothing');
});

test('hysteresis actually reduces switching', function () {
  function switches(minBars, margin) {
    var res = classifyAll({ seed: 'switching', bars: 3000, params: { minBarsInRegime: minBars, switchMargin: margin } });
    var n = 0, prev = null;
    res.rows.forEach(function (r) {
      if (prev !== null && r.classification.regime !== prev) n++;
      prev = r.classification.regime;
    });
    return n;
  }
  var loose = switches(1, 0);
  var tight = switches(20, 0.15);
  assert.ok(tight < loose, 'hysteresis changed nothing: ' + tight + ' vs ' + loose);
  assert.ok(loose > 50, 'the raw classifier should be jumpy, or hysteresis is solving nothing');
});

test('holding a regime against the evidence lowers the reported confidence', function () {
  var res = classifyAll({ seed: 'held', bars: 3000 });
  var held = res.rows.filter(function (r) { return r.classification.held && r.classification.regime !== r.classification.topRegime; });
  assert.ok(held.length > 0, 'nothing was ever held against a better-scoring challenger');
  held.forEach(function (r) {
    assert.ok(r.classification.confidence < 1);
    assert.notEqual(r.classification.regime, r.classification.topRegime);
  });
});

test('confidence is penalised by a narrow margin and by a low absolute score', function () {
  var e = regimeMod.create();
  // Two features that produce a clear winner vs a muddle.
  var clear = e.score({ adx: 40, efficiencyRatio: 0.9, efficiencyRatioShort: 0.9, volRatio: 1, atrRank: 0.5, flipRate: 0.5, plusDI: 30, minusDI: 5, breakAge: null });
  var muddle = e.score({ adx: 23, efficiencyRatio: 0.25, efficiencyRatioShort: 0.4, volRatio: 1.1, atrRank: 0.45, flipRate: 0.5, plusDI: 18, minusDI: 17, breakAge: null });
  function margin(s) {
    var v = Object.keys(s).map(function (k) { return s[k]; }).sort(function (a, b) { return b - a; });
    return v[0] - v[1];
  }
  assert.ok(margin(clear) > margin(muddle), 'a clear reading must produce a wider margin');
});

// ---------------------------------------------------------------------------
// 3. Direction
// ---------------------------------------------------------------------------

test('direction follows the directional indicators and is NEUTRAL when aimless', function () {
  var res = classifyAll({ seed: 'direction', bars: 3000 });
  var seen = {};
  res.rows.forEach(function (r) {
    var c = r.classification;
    seen[c.direction] = (seen[c.direction] || 0) + 1;
    if (c.direction === 'LONG') assert.ok(c.features.plusDI > c.features.minusDI);
    if (c.direction === 'SHORT') assert.ok(c.features.minusDI > c.features.plusDI);
  });
  assert.ok(seen.LONG > 0 && seen.SHORT > 0, 'both directions must occur: ' + JSON.stringify(seen));
  assert.ok(seen.NEUTRAL > 0, 'an aimless market must be able to read NEUTRAL');
});

// ---------------------------------------------------------------------------
// 4. Scored against the generator's ground truth
// ---------------------------------------------------------------------------

test('the classifier beats chance substantially against published ground truth', function () {
  var all = [];
  ['regime-a', 'regime-b', 'regime-c'].forEach(function (seed) {
    all = all.concat(classifyAll({ seed: seed, bars: 6000 }).rows);
  });
  var c = confusion(all);
  assert.ok(c.n > 15000, 'sample was only ' + c.n);
  // Measured 40.7 % against a 16.7 % chance baseline; asserted at 35 % so a real
  // regression fails while ordinary drift does not.
  assert.ok(c.accuracy > 0.35,
    'accuracy fell to ' + (100 * c.accuracy).toFixed(1) + '% (chance is 16.7%)');
  assert.ok(c.accuracy > 2 * (1 / 6), 'the classifier must be at least twice chance');

  // Per-class floors, set below the measured recalls (55/54/34/28/19/7).
  var floors = {
    RANGE: 0.45, LOW_VOLATILITY: 0.45, HIGH_VOLATILITY: 0.25,
    TREND: 0.20, BREAKOUT: 0.12, UNSTABLE: 0.04
  };
  Object.keys(floors).forEach(function (regime) {
    assert.ok(c.recall[regime] >= floors[regime],
      regime + ' recall fell to ' + (100 * c.recall[regime]).toFixed(0) + '%, floor ' + (100 * floors[regime]) + '%');
  });
});

test('the volatility extremes are never confused with each other', function () {
  // This is the discrimination the engine is genuinely good at, and the one a
  // strategy filter most depends on: trading a low-volatility rule in a violent
  // market is how a range strategy dies.
  var all = [];
  ['regime-a', 'regime-b'].forEach(function (seed) {
    all = all.concat(classifyAll({ seed: seed, bars: 6000 }).rows);
  });
  var c = confusion(all);
  var lowAsHigh = (c.matrix.LOW_VOLATILITY.HIGH_VOLATILITY || 0) / c.totals.LOW_VOLATILITY;
  var highAsLow = (c.matrix.HIGH_VOLATILITY.LOW_VOLATILITY || 0) / c.totals.HIGH_VOLATILITY;
  assert.ok(lowAsHigh < 0.02, 'quiet markets read as violent ' + (100 * lowAsHigh).toFixed(1) + '% of the time');
  assert.ok(highAsLow < 0.02, 'violent markets read as quiet ' + (100 * highAsLow).toFixed(1) + '% of the time');
});

test('UNSTABLE is poorly separated, and the engine says so rather than pretending', function () {
  // Documented limitation, asserted so it cannot silently get worse and cannot
  // silently be "fixed" by a change that damages the classes that do work.
  var all = classifyAll({ seed: 'regime-a', bars: 6000 }).rows;
  var c = confusion(all);
  assert.ok(c.recall.UNSTABLE < 0.35,
    'UNSTABLE recall is now ' + (100 * c.recall.UNSTABLE).toFixed(0) + '% — if this is genuinely better, ' +
    'update the limitation recorded in src/regime/engine.js and docs/COMPLIANCE_AND_RISK.md rather than just this number');
});

test('the volatility labels are RELATIVE, and say nothing about a market that never changes regime', function () {
  // This is the engine's most important limitation and it is asserted rather
  // than described, because it decides how the labels may be used.
  //
  // The ATR measure is a PERCENTILE within a rolling window. Over a series with
  // NO regime change, the mean percentile is 0.5 by construction, so the labels
  // partition the market's own noise: a uniformly violent stretch reads
  // LOW_VOLATILITY about a quarter of the time, and a uniformly quiet one reads
  // HIGH_VOLATILITY about a tenth. Neither is a defect — "high volatility" here
  // means "loud FOR THIS MARKET LATELY", which is what a regime is. But it means
  // a consumer must never read the label as an absolute statement, and the
  // adjacent test shows the labels are sharp exactly when a change does occur.
  function shares(regime, seed) {
    var seq = [];
    for (var i = 0; i < 8; i++) seq.push(regime);
    var res = classifyAll({ seed: seed, bars: 2000, regimeSequence: seq });
    var rows = res.rows.filter(function (r) { return r.truth === regime; });
    var counts = {};
    rows.forEach(function (r) { counts[r.classification.regime] = (counts[r.classification.regime] || 0) + 1; });
    var out = {};
    Object.keys(counts).forEach(function (k) { out[k] = counts[k] / rows.length; });
    return out;
  }

  var quiet = shares('LOW_VOLATILITY', 'forced-quiet');
  var violent = shares('HIGH_VOLATILITY', 'forced-violent');

  // Uniformly quiet still produces some HIGH_VOLATILITY bars, and vice versa.
  assert.ok((quiet.HIGH_VOLATILITY || 0) > 0.01,
    'the relativity claim is false: a uniformly quiet market produced no HIGH_VOLATILITY at all');
  assert.ok((violent.LOW_VOLATILITY || 0) > 0.05,
    'the relativity claim is false: a uniformly violent market produced almost no LOW_VOLATILITY');

  // Both nonetheless read predominantly "aimless", which is correct: with no
  // trend and no regime change, RANGE is the honest answer for either.
  assert.ok((quiet.RANGE || 0) + (quiet.LOW_VOLATILITY || 0) > 0.6,
    'a quiet aimless market should read calm: ' + JSON.stringify(quiet));
  assert.ok((violent.RANGE || 0) + (violent.LOW_VOLATILITY || 0) + (violent.HIGH_VOLATILITY || 0) > 0.6,
    'a violent aimless market read as something directional: ' + JSON.stringify(violent));
});

test('the ATR percentile is relative, so gold and a yen pair are comparable', function () {
  // An absolute ATR threshold would call gold permanently volatile — a statement
  // about contract size, not about regime.
  var ranks = {};
  ['EURUSD', 'USDJPY', 'XAUUSD'].forEach(function (sym) {
    var res = classifyAll({ seed: 'rank-' + sym, bars: 2000, instrument: CATALOG.get(sym) });
    var sum = 0;
    res.rows.forEach(function (r) { sum += r.classification.features.atrRank; });
    ranks[sym] = sum / res.rows.length;
  });
  var values = Object.keys(ranks).map(function (k) { return ranks[k]; });
  var spread = Math.max.apply(null, values) - Math.min.apply(null, values);
  assert.ok(spread < 0.15,
    'mean ATR percentile differs by ' + spread.toFixed(3) + ' across instruments: ' + JSON.stringify(ranks));
});

// ---------------------------------------------------------------------------
// 5. The supporting feature functions
// ---------------------------------------------------------------------------

test('atrRank is a genuine percentile within its own lookback', function () {
  var bars = [];
  for (var i = 0; i < 300; i++) {
    // The last 20 bars are far wider than everything before them.
    var w = i >= 280 ? 5 : 1;
    bars.push({ ts: i * 900000, open: 100, high: 100 + w, low: 100 - w, close: 100, volume: 1 });
  }
  var rank = regimeMod.atrRank(bars, 14, 100);
  assert.equal(rank[150], 1, 'a constant-volatility stretch ranks at the top of ties');
  assert.ok(rank[299] === 1, 'the widest bars must rank highest');
  assert.equal(rank[50], null, 'before the lookback is filled there is no percentile');
});

test('breakAge reports how long ago the channel broke, and nothing when it has not', function () {
  var bars = [];
  for (var i = 0; i < 100; i++) {
    bars.push({ ts: i * 900000, open: 100, high: 100.5, low: 99.5, close: 100, volume: 1 });
  }
  // One decisive break well past the channel warmup.
  bars[60] = { ts: 60 * 900000, open: 100, high: 110, low: 99.5, close: 109, volume: 1 };
  var age = regimeMod.breakAge(bars, 40, 10);
  assert.equal(age[59], null, 'nothing had broken yet');
  assert.equal(age[60], 0, 'the break is fresh on its own bar');
  assert.equal(age[65], 5);
  assert.equal(age[71], null, 'beyond the lookback the break stops counting');
});

test('flipRate measures bar-to-bar direction reversals', function () {
  var alternating = [], trending = [];
  for (var i = 0; i < 60; i++) {
    alternating.push({ ts: i, open: 100, high: 101, low: 99, close: 100 + (i % 2), volume: 1 });
    trending.push({ ts: i, open: 100, high: 101, low: 99, close: 100 + i, volume: 1 });
  }
  assert.equal(regimeMod.flipRate(alternating, 20)[50], 1, 'a perfect zigzag flips every bar');
  assert.equal(regimeMod.flipRate(trending, 20)[50], 0, 'a straight line never flips');
});

test('norm clamps at both ends', function () {
  assert.equal(regimeMod.norm(5, 0, 10), 0.5);
  assert.equal(regimeMod.norm(-5, 0, 10), 0);
  assert.equal(regimeMod.norm(50, 0, 10), 1);
  assert.equal(regimeMod.norm(5, 3, 3), 0, 'a degenerate range does not divide by zero');
});
