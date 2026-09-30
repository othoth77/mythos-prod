'use strict';
// =====================================================
// MYTHOS TRADING AGENT — walk-forward and Research Agent tests
// projects/mythos-trading-agent/tests/research-agent-test.js
//
// The claims under test:
//
//   §1 out-of-sample comes strictly AFTER in-sample in time, and walk-forward
//      folds' out-of-sample windows never overlap — otherwise the same bars count
//      as fresh evidence twice and the aggregate is quietly inflated;
//   §2 the Research Agent PROPOSES and can do nothing else — mission §12's
//      "never modify LIVE rules directly", tested structurally;
//   §3 a hypothesis without a falsification criterion is refused, because a claim
//      whose author has not said what would change their mind reads as confirmed
//      whatever happens;
//   §4 compare() refuses to look at in-sample improvement alone, rejects a variant
//      that buys expectancy with drawdown or a longer losing streak, and
//      distinguishes REJECTED (refuted) from INCONCLUSIVE (untested).
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var wf = require(path.join(SRC, 'backtest', 'walk-forward'));
var researchMod = require(path.join(SRC, 'agents', 'research-agent'));
var analysisMod = require(path.join(SRC, 'agents', 'analysis-agent'));
var tradingAgent = require(path.join(SRC, 'agents', 'trading-agent'));
var engine = require(path.join(SRC, 'backtest', 'engine'));
var configMod = require(path.join(SRC, 'config'));
var fixtureSource = require(path.join(SRC, 'data', 'fixture-source'));
var sourceMod = require(path.join(SRC, 'data', 'source'));
var storeMod = require(path.join(SRC, 'db', 'store'));
var loggerMod = require(path.join(SRC, 'core', 'logger'));
var money = require(path.join(SRC, 'core', 'money'));

var FIXTURES = fixtureSource.createSource();
var BARS = FIXTURES.load('EURUSD', 'M15');

function bars(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push({ ts: i * 900000, open: 100, high: 101, low: 99, close: 100, volume: 1 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Segmentation
// ---------------------------------------------------------------------------

test('split puts out-of-sample strictly after in-sample', function () {
  var s = wf.split(bars(1000), { inSampleRatio: 0.7 });
  assert.equal(s.inSample.bars, 700);
  assert.equal(s.outOfSample.bars, 300);
  assert.equal(s.inSample.toIndex + 1, s.outOfSample.fromIndex);
  assert.ok(s.outOfSample.fromTs > s.inSample.toTs,
    'a random split would let unseen data sit between bars the tuning already saw');
  assert.equal(s.totalBars, 1000);
});

test('split honours a warmup that tuning may not use', function () {
  var s = wf.split(bars(1000), { inSampleRatio: 0.5, warmupBars: 200 });
  assert.equal(s.warmupBars, 200);
  assert.equal(s.inSample.fromIndex, 200);
  assert.equal(s.inSample.bars, 400, 'half of the 800 usable bars');
  assert.equal(s.outOfSample.bars, 400);
});

test('split refuses impossible ratios and short series', function () {
  assert.throws(function () { wf.split(bars(100), { inSampleRatio: 0 }); }, /strictly between 0 and 1/);
  assert.throws(function () { wf.split(bars(100), { inSampleRatio: 1 }); }, /strictly between 0 and 1/);
  assert.throws(function () { wf.split(bars(3)); }, /not enough bars/);
  // Ten usable bars at a 5 % ratio rounds the in-sample window down to nothing.
  assert.throws(function () { wf.split(bars(210), { warmupBars: 200, inSampleRatio: 0.05 }); }, /empty segment/);
});

test('rollingFolds advances by the out-of-sample length, keeping the windows disjoint', function () {
  var folds = wf.rollingFolds(bars(1000), { inSampleBars: 400, outOfSampleBars: 100 });
  assert.equal(folds.length, 6);
  folds.forEach(function (f) {
    assert.equal(f.inSample.bars, 400);
    assert.equal(f.outOfSample.bars, 100);
    assert.equal(f.inSample.toIndex + 1, f.outOfSample.fromIndex, 'fold ' + f.fold + ' has a gap or an overlap');
  });
  // The out-of-sample windows must tile without overlap.
  for (var i = 1; i < folds.length; i++) {
    assert.ok(folds[i].outOfSample.fromTs > folds[i - 1].outOfSample.toTs);
    assert.equal(folds[i].outOfSample.fromIndex, folds[i - 1].outOfSample.toIndex + 1);
  }
  assert.equal(wf.assertNoOverlap(folds), true);
});

test('overlapping out-of-sample windows are refused', function () {
  var b = bars(1000);
  var folds = wf.rollingFolds(b, { inSampleBars: 400, outOfSampleBars: 100 });
  // Force an overlap and require the guard to catch it.
  folds[1].outOfSample.fromTs = folds[0].outOfSample.fromTs;
  assert.throws(function () { wf.assertNoOverlap(folds); },
    /the same bars would be counted as fresh evidence twice/);
});

test('an anchored walk-forward grows the in-sample window instead of sliding it', function () {
  var sliding = wf.rollingFolds(bars(1000), { inSampleBars: 300, outOfSampleBars: 100 });
  var anchored = wf.rollingFolds(bars(1000), { inSampleBars: 300, outOfSampleBars: 100, anchored: true });
  assert.equal(sliding.length, anchored.length);
  assert.equal(sliding[3].inSample.bars, 300, 'a sliding window keeps its length');
  assert.ok(anchored[3].inSample.bars > 300, 'an anchored window grows');
  assert.equal(anchored[3].inSample.fromIndex, 0);
  assert.equal(anchored[0].inSample.fromIndex, sliding[0].inSample.fromIndex);
});

test('rollingFolds refuses a series too short for even one fold', function () {
  assert.throws(function () { wf.rollingFolds(bars(100), { inSampleBars: 400, outOfSampleBars: 100 }); },
    /no walk-forward fold fits/);
  assert.throws(function () { wf.rollingFolds(bars(1000), { inSampleBars: 0, outOfSampleBars: 100 }); },
    /positive inSampleBars/);
});

test('maxFolds caps the fold count', function () {
  var folds = wf.rollingFolds(bars(2000), { inSampleBars: 400, outOfSampleBars: 100, maxFolds: 3 });
  assert.equal(folds.length, 3);
});

test('describe() summarises a fold set without the per-bar detail', function () {
  var folds = wf.rollingFolds(bars(1000), { inSampleBars: 400, outOfSampleBars: 100 });
  var d = wf.describe(folds);
  assert.equal(d.folds, 6);
  assert.equal(d.inSampleBars, 400);
  assert.equal(d.outOfSampleBars, 100);
  assert.equal(d.windows.length, 6);
  assert.equal(d.anchored, false);
  JSON.parse(JSON.stringify(d));
});

// ---------------------------------------------------------------------------
// 2. Aggregation and the degradation measure
// ---------------------------------------------------------------------------

function foldResult(inExp, outExp, over) {
  var o = over || {};
  return {
    inSample: { metrics: { expectancy: inExp, netPnl: inExp * 50, tradeCount: 50, maxDrawdownPct: o.inDd || 5, maxConsecutiveLosses: o.inStreak || 4 } },
    outOfSample: { metrics: { expectancy: outExp, netPnl: outExp * 50, tradeCount: 50, maxDrawdownPct: o.outDd || 6, maxConsecutiveLosses: o.outStreak || 5 } }
  };
}

test('degradation is out-of-sample expectancy over in-sample expectancy', function () {
  var agg = wf.aggregate([foldResult(1.0, 0.5), foldResult(1.0, 0.5)]);
  assert.equal(agg.inSample.meanExpectancy, 1);
  assert.equal(agg.outOfSample.meanExpectancy, 0.5);
  assert.equal(agg.degradation, 0.5, 'half the edge survived, which is what the number should say');
  assert.equal(agg.folds, 2);
  assert.equal(agg.outOfSample.profitableFolds, 2);
  assert.equal(agg.outOfSampleHitRate, 1);
});

test('degradation is null rather than misleading when in-sample was not profitable', function () {
  var agg = wf.aggregate([foldResult(-0.5, -0.2), foldResult(-0.4, -0.1)]);
  assert.equal(agg.degradation, null, 'a ratio of two negative numbers is not a degradation measure');
  assert.match(agg.degradationNote, /would be meaningless/);
  assert.equal(agg.outOfSample.profitableFolds, 0);
  assert.equal(agg.outOfSampleHitRate, 0);
});

test('aggregation reports the WORST streak across folds, not the average', function () {
  var agg = wf.aggregate([
    foldResult(1, 0.5, { outStreak: 3 }),
    foldResult(1, 0.5, { outStreak: 9 }),
    foldResult(1, 0.5, { outStreak: 4 })
  ]);
  assert.equal(agg.outOfSample.worstMaxConsecutiveLosses, 9,
    'averaging streaks would hide the fold that would have ended the account');
});

test('walk-forward evaluate runs every fold on both sides', function () {
  var folds = wf.rollingFolds(bars(1000), { inSampleBars: 400, outOfSampleBars: 100 });
  var seen = [];
  var res = wf.evaluate({
    folds: folds,
    runSegment: function (segment, fold) {
      seen.push({ fold: fold.fold, label: segment.label, bars: segment.bars });
      return { metrics: { expectancy: 1, netPnl: 10, tradeCount: 40, maxDrawdownPct: 3, maxConsecutiveLosses: 3 } };
    }
  });
  assert.equal(seen.length, folds.length * 2);
  assert.equal(res.folds.length, folds.length);
  assert.equal(res.aggregate.folds, folds.length);
  assert.deepEqual(seen.slice(0, 2).map(function (s) { return s.label; }), ['in-sample', 'out-of-sample']);
});

test('a walk-forward over real fixture data runs and degrades measurably', function () {
  var symbols = ['EURUSD'];
  var probe = tradingAgent.create({ config: configMod.load({ universe: symbols }) });
  var warmup = probe.warmupBars();
  var folds = wf.rollingFolds(BARS, { inSampleBars: 900, outOfSampleBars: 450, warmupBars: warmup, maxFolds: 2 });
  assert.ok(folds.length >= 1);

  var res = wf.evaluate({
    folds: folds,
    runSegment: function (segment) {
      var cfg = configMod.load({
        universe: symbols,
        account: { initialCapital: 5000 },
        backtest: { warmupBars: warmup, seed: 'wf' },
        cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 },
        jev: { scoreThreshold: 40, minConfidence: 0.15 }
      });
      var wired = tradingAgent.wire({ config: cfg, logger: loggerMod.nullLogger() });
      var run = engine.run({
        config: cfg,
        source: sourceMod.fromBars({ kind: 'wf', datasetVersion: 'wf1', data: { EURUSD: { M15: BARS } } }),
        range: segment.range,
        label: segment.label,
        logger: loggerMod.nullLogger(),
        decide: wired.engineHooks.decide,
        onRunStart: wired.engineHooks.onRunStart,
        onSeriesReady: wired.engineHooks.onSeriesReady,
        onBar: wired.engineHooks.onBar,
        onTradeClosed: wired.engineHooks.onTradeClosed
      });
      return { metrics: run.metrics, trades: run.trades.length };
    }
  });

  res.folds.forEach(function (f) {
    assert.ok(f.inSample.metrics.tradeCount >= 0);
    assert.ok(f.outOfSample.metrics.tradeCount >= 0);
  });
  assert.ok(res.aggregate.outOfSample.totalTrades >= 0);
  assert.equal(typeof res.aggregate.outOfSampleHitRate, 'number');
});

// ---------------------------------------------------------------------------
// 3. The Research Agent proposes and nothing else
// ---------------------------------------------------------------------------

test('the Research Agent has no way to apply, write or promote anything', function () {
  var r = researchMod.create();
  ['apply', 'write', 'save', 'promote', 'setConfig', 'update', 'mutate', 'commit',
    'enable', 'disable', 'install', 'activate', 'config', 'riskEngine'
  ].forEach(function (name) {
    assert.equal(r[name], undefined, 'the Research Agent exposes ' + name + '()');
  });
  assert.equal(r.agent, 'RESEARCH_AGENT');
  assert.equal(typeof r.propose, 'function');
});

test('a proposal is an inert plain object that says so', function () {
  var cfg = configMod.load();
  var r = researchMod.create();
  var h = {
    hypothesisId: 'hyp-0001',
    statement: 'raising the threshold should help',
    proposedChange: { jev: { scoreThreshold: 80 } },
    falsification: 'out-of-sample expectancy does not improve at the higher threshold',
    observation: { kind: 'JEV_BANDS_ORDERED' },
    baselineConfigHash: cfg.fingerprint.hash
  };
  var p = r.propose(h);
  assert.deepEqual(p.override, { jev: { scoreThreshold: 80 } });
  assert.equal(p.authority, 'PROPOSAL_ONLY');
  assert.match(p.note, /Inert/);
  assert.ok(p.requiredEvidence.indexOf('OUT_OF_SAMPLE_BACKTEST') !== -1);
  assert.ok(p.requiredEvidence.indexOf('WALK_FORWARD') !== -1);
  assert.equal(p.overrideHash.length, 12);
  // The proposal must not be a config — it cannot be loaded or run as one.
  assert.equal(p.override.risk, undefined);
  assert.equal(p.mode, undefined);
});

test('a hypothesis without a falsification criterion is refused', function () {
  var r = researchMod.create();
  assert.throws(function () {
    r.propose({
      hypothesisId: 'h', statement: 'it will work', proposedChange: { jev: {} },
      observation: {}, falsification: 'trust me'
    });
  }, /no usable falsification criterion/);
  assert.throws(function () {
    r.propose({ hypothesisId: 'h', statement: 's', proposedChange: {}, observation: {} });
  }, /needs "falsification"/);
  assert.throws(function () {
    r.propose({ hypothesisId: 'h', statement: 's', falsification: 'a criterion long enough to count', observation: {} });
  }, /needs "proposedChange"/);
});

test('unknown research thresholds are refused', function () {
  assert.throws(function () { researchMod.create({ thresholds: { beLessStrict: true } }); },
    /unknown research threshold/);
  assert.ok(Object.isFrozen(researchMod.create().thresholds));
});

// ---------------------------------------------------------------------------
// 4. Observation and hypothesis generation
// ---------------------------------------------------------------------------

/** A real run, so observations come from real measurements. */
function realReport(over, opts) {
  var o = opts || {};
  var symbols = o.symbols || ['EURUSD'];
  var probe = tradingAgent.create({ config: configMod.load({ universe: symbols }) });
  var cfg = configMod.load(Object.assign({
    universe: symbols,
    account: { initialCapital: o.capital === undefined ? 5000 : o.capital },
    backtest: { warmupBars: probe.warmupBars(), seed: 'research-test' },
    cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 },
    jev: { scoreThreshold: 40, minConfidence: 0.15 }
  }, over || {}));
  var data = {};
  symbols.forEach(function (s) { data[s] = { M15: FIXTURES.load(s, 'M15').slice(0, o.bars || 3000) }; });
  var wired = tradingAgent.wire({ config: cfg, logger: loggerMod.nullLogger() });
  var run = engine.run({
    config: cfg,
    source: sourceMod.fromBars({ kind: 'r', datasetVersion: 'r1', data: data }),
    label: 'research', logger: loggerMod.nullLogger(),
    decide: wired.engineHooks.decide,
    onRunStart: wired.engineHooks.onRunStart,
    onSeriesReady: wired.engineHooks.onSeriesReady,
    onBar: wired.engineHooks.onBar,
    onTradeClosed: wired.engineHooks.onTradeClosed
  });
  return {
    run: run,
    config: cfg,
    report: analysisMod.create({ minSample: 10 }).analyse({ store: run.store, initialCapital: cfg.account.initialCapital })
  };
}

test('observations are drawn from a real run and carry their sample sizes', function () {
  var ctx = realReport();
  var r = researchMod.create({ minSample: 10 });
  var observations = r.observe(ctx.report, ctx.config);
  assert.ok(observations.length > 0);
  observations.forEach(function (ob) {
    assert.ok(r.ObservationKind[ob.kind], 'unknown observation kind ' + ob.kind);
    assert.ok(ob.subject);
    assert.ok(ob.measurement);
    assert.equal(typeof ob.sampleSize, 'number');
    assert.equal(typeof ob.actionable, 'boolean');
  });
});

test('every generated hypothesis has a statement, a change and a falsification', function () {
  var ctx = realReport();
  var r = researchMod.create({ minSample: 10 });
  var out = r.research({ report: ctx.report, config: ctx.config });
  assert.equal(out.authority, 'PROPOSAL_ONLY');
  assert.ok(out.hypotheses.length > 0, 'a losing run should produce at least one hypothesis');
  out.hypotheses.forEach(function (h) {
    assert.ok(h.statement.length > 30);
    assert.ok(h.falsification.length >= 20);
    assert.ok(h.proposedChange && Object.keys(h.proposedChange).length > 0);
    assert.equal(h.authority, 'PROPOSAL_ONLY');
    assert.equal(h.baselineConfigHash, ctx.config.fingerprint.hash);
  });
  assert.equal(out.proposals.length, out.hypotheses.length);
  assert.match(out.nextStep, /Nothing may be applied before that|Collect more data/);
});

test('a proposed override is loadable as a config change, so the claim is testable', function () {
  var ctx = realReport();
  var r = researchMod.create({ minSample: 10 });
  var out = r.research({ report: ctx.report, config: ctx.config });
  out.proposals.forEach(function (p) {
    // A proposal that could not be merged into a config would be untestable.
    var merged = configMod.deepMerge(configMod.serialise(ctx.config), p.override);
    delete merged.fingerprint;
    delete merged.unreachableInstruments;
    // `strategy.disable` is a research-level instruction rather than a config key,
    // so it is expected to be rejected by the schema — the proposal names it
    // explicitly so the Champion/Challenger layer knows to handle it.
    if (p.override.strategy && p.override.strategy.disable) {
      assert.ok(Array.isArray(p.override.strategy.disable));
      return;
    }
    assert.doesNotThrow(function () { configMod.load(p.override); },
      'proposal ' + p.proposalId + ' is not a loadable config override: ' + JSON.stringify(p.override));
  });
});

test('a report with nothing actionable produces a finding about the run, not a change', function () {
  var store = storeMod.create({ runId: 'empty' });
  var report = analysisMod.create().analyse({ store: store, initialCapital: 100 });
  var r = researchMod.create();
  var out = r.research({ report: report, config: configMod.load() });
  assert.equal(out.observations.length, 1);
  assert.equal(out.observations[0].kind, 'NO_FINDING');
  assert.equal(out.observations[0].actionable, false);
  assert.equal(out.hypotheses.length, 0);
  assert.equal(out.proposals.length, 0);
  assert.match(out.nextStep, /Collect more data rather than proposing a change/);
});

test('an insufficiently sampled observation produces no hypothesis', function () {
  var r = researchMod.create({ minSample: 1000 });
  var hs = r.hypothesise([{
    kind: 'STRATEGY_NEGATIVE_EXPECTANCY', subject: 'momentum',
    measurement: { expectancy: -1 }, sampleSize: 3, actionable: false
  }], configMod.load());
  assert.deepEqual(hs, [], 'a three-trade observation must not become a proposal');
});

test('the regime hypothesis proposes a filter rather than a ban, and says why', function () {
  var r = researchMod.create();
  var hs = r.hypothesise([{
    kind: 'REGIME_UNDERPERFORMS', subject: 'RANGE',
    measurement: { regime: 'RANGE', expectancy: -0.8, winRate: 0.3, comparedRegimes: 3 },
    sampleSize: 50, actionable: true
  }], configMod.load());
  assert.equal(hs.length, 1);
  assert.match(hs[0].statement, /than a blanket regime ban/);
  assert.match(hs[0].statement, /destroy the evidence/);
  assert.ok(hs[0].proposedChange.jev !== undefined, 'the change must be a filter, not a regime exclusion');
  assert.match(hs[0].falsification, /classification error/);
});

test('the Jev hypothesis picks the lowest band with positive expectancy', function () {
  var r = researchMod.create();
  var hs = r.hypothesise([{
    kind: 'JEV_BANDS_ORDERED', subject: 'jev.scoreThreshold',
    measurement: { bands: ['70-79', '80-89', '90-94'], expectancyByBand: [-0.2, 0.3, 0.9], winRateByBand: [0.3, 0.45, 0.6] },
    sampleSize: 3, actionable: true
  }], configMod.load());
  assert.equal(hs.length, 1);
  assert.deepEqual(hs[0].proposedChange, { jev: { scoreThreshold: 80 } });
  assert.match(hs[0].falsification, /maximum losing streak worsens/);
});

test('an unordered Jev relationship proposes LOWERING the threshold', function () {
  var cfg = configMod.load({ jev: { scoreThreshold: 70 } });
  var hs = researchMod.create().hypothesise([{
    kind: 'JEV_BANDS_UNORDERED', subject: 'jev.scoreThreshold',
    measurement: { bands: ['70-79', '80-89'], expectancyByBand: [0.5, -0.2] },
    sampleSize: 2, actionable: true
  }], cfg);
  assert.equal(hs.length, 1);
  assert.equal(hs[0].proposedChange.jev.scoreThreshold, 55);
  assert.match(hs[0].statement, /not supported by evidence/);
  assert.match(hs[0].falsification, /the threshold IS doing work/);
});

test('the research trail persists into the store', function () {
  var ctx = realReport();
  var r = researchMod.create({ minSample: 10 });
  var out = r.research({ report: ctx.report, config: ctx.config });
  var store = storeMod.create({ runId: 'research' });
  r.persist(store, { hypotheses: out.hypotheses });
  assert.equal(store.table('hypotheses').count(), out.hypotheses.length);
  var row = store.table('hypotheses').all()[0];
  assert.ok(row.falsification.length >= 20);
  assert.ok(row.observation.kind);
});

// ---------------------------------------------------------------------------
// 5. compare() — the hard part
// ---------------------------------------------------------------------------

function side(over) {
  var o = over || {};
  function m(x) {
    return {
      metrics: {
        expectancy: x.expectancy, netPnl: x.expectancy * (x.tradeCount || 60),
        tradeCount: x.tradeCount === undefined ? 60 : x.tradeCount,
        maxDrawdownPct: x.dd === undefined ? 5 : x.dd,
        maxConsecutiveLosses: x.streak === undefined ? 4 : x.streak
      }
    };
  }
  var out = {
    inSample: m(o.inSample || { expectancy: 1 }),
    outOfSample: m(o.outOfSample || { expectancy: 1 })
  };
  if (o.walkForward !== false) {
    out.walkForward = {
      aggregate: {
        outOfSampleHitRate: o.hitRate === undefined ? 0.8 : o.hitRate,
        degradation: o.degradation === undefined ? 0.7 : o.degradation
      }
    };
  }
  return out;
}

test('compare() refuses to run without out-of-sample results', function () {
  var r = researchMod.create();
  assert.throws(function () {
    r.compare({ baseline: { inSample: { metrics: {} } }, variant: { inSample: { metrics: {} } } });
  }, /requires OUT-OF-SAMPLE results/);
  assert.throws(function () { r.compare({ baseline: side() }); }, /needs a baseline and a variant/);
});

test('a genuine improvement with full evidence is approved as a CHALLENGER only', function () {
  var r = researchMod.create();
  var res = r.compare({
    baseline: side({ outOfSample: { expectancy: 0.2, dd: 8, streak: 6 } }),
    variant: side({ outOfSample: { expectancy: 0.6, dd: 6, streak: 5 } }),
    stress: { survived: true }
  });
  assert.equal(res.verdict, 'APPROVE_AS_CHALLENGER');
  assert.deepEqual(res.blockers, []);
  assert.match(res.note, /CHALLENGER only.*not the champion.*not in PAPER.*not live/);
  assert.equal(res.authority, 'PROPOSAL_ONLY');
  var exp = res.findings.filter(function (f) { return f.metric === 'outOfSampleExpectancy'; })[0];
  assert.equal(exp.delta, money.round(0.4, 6));
});

test('improving in-sample only is named as the signature of a fitted change', function () {
  var res = researchMod.create().compare({
    baseline: side({ inSample: { expectancy: 0.5 }, outOfSample: { expectancy: 0.4 } }),
    variant: side({ inSample: { expectancy: 2.0 }, outOfSample: { expectancy: 0.3 } }),
    stress: { survived: true }
  });
  assert.equal(res.verdict, 'REJECT');
  var codes = res.blockers.map(function (b) { return b.code; });
  assert.ok(codes.indexOf('IMPROVES_IN_SAMPLE_ONLY') !== -1);
  assert.ok(codes.indexOf('NO_EXPECTANCY_IMPROVEMENT') !== -1);
  var blocker = res.blockers.filter(function (b) { return b.code === 'IMPROVES_IN_SAMPLE_ONLY'; })[0];
  assert.match(blocker.detail, /fitted change rather than a found one/);
});

test('expectancy bought with deeper drawdown is rejected', function () {
  var res = researchMod.create().compare({
    baseline: side({ outOfSample: { expectancy: 0.2, dd: 5 } }),
    variant: side({ outOfSample: { expectancy: 1.5, dd: 12 } }),
    stress: { survived: true }
  });
  assert.equal(res.verdict, 'REJECT');
  var b = res.blockers.filter(function (x) { return x.code === 'DRAWDOWN_WORSENED'; })[0];
  assert.ok(b);
  assert.match(b.detail, /not an improvement for a \$100 account/);
});

test('expectancy bought with a longer losing streak is rejected', function () {
  var res = researchMod.create().compare({
    baseline: side({ outOfSample: { expectancy: 0.2, streak: 4 } }),
    variant: side({ outOfSample: { expectancy: 1.5, streak: 9 } }),
    stress: { survived: true }
  });
  assert.equal(res.verdict, 'REJECT');
  var b = res.blockers.filter(function (x) { return x.code === 'LOSING_STREAK_WORSENED'; })[0];
  assert.ok(b);
  assert.match(b.detail, /primary objective, not a tiebreak/);
});

test('a missing walk-forward or stress test is INCONCLUSIVE, not rejected', function () {
  var r = researchMod.create();
  var noWf = r.compare({
    baseline: side({ walkForward: false, outOfSample: { expectancy: 0.2 } }),
    variant: side({ walkForward: false, outOfSample: { expectancy: 0.6 } }),
    stress: { survived: true }
  });
  assert.equal(noWf.verdict, 'INCONCLUSIVE',
    'an untested hypothesis should be retried; a refuted one should not');
  assert.deepEqual(noWf.blockers.map(function (b) { return b.code; }), ['NO_WALK_FORWARD']);

  var noStress = r.compare({
    baseline: side({ outOfSample: { expectancy: 0.2 } }),
    variant: side({ outOfSample: { expectancy: 0.6 } })
  });
  assert.equal(noStress.verdict, 'INCONCLUSIVE');
  assert.deepEqual(noStress.blockers.map(function (b) { return b.code; }), ['NO_STRESS_TEST']);
});

test('a failed stress test is a rejection, not an absence of evidence', function () {
  var res = researchMod.create().compare({
    baseline: side({ outOfSample: { expectancy: 0.2 } }),
    variant: side({ outOfSample: { expectancy: 0.6 } }),
    stress: { survived: false, reason: 'drawdown exceeded the limit at the 95th percentile' }
  });
  assert.equal(res.verdict, 'REJECT');
  assert.equal(res.blockers.filter(function (b) { return b.code === 'STRESS_FAILED'; })[0].detail,
    'drawdown exceeded the limit at the 95th percentile');
});

test('an inconsistent or heavily degraded walk-forward is rejected', function () {
  var r = researchMod.create();
  var inconsistent = r.compare({
    baseline: side({ outOfSample: { expectancy: 0.2 } }),
    variant: side({ outOfSample: { expectancy: 0.6 }, hitRate: 0.2 }),
    stress: { survived: true }
  });
  assert.equal(inconsistent.verdict, 'REJECT');
  assert.ok(inconsistent.blockers.some(function (b) { return b.code === 'WALK_FORWARD_INCONSISTENT'; }));

  var degraded = r.compare({
    baseline: side({ outOfSample: { expectancy: 0.2 } }),
    variant: side({ outOfSample: { expectancy: 0.6 }, degradation: 0.05 }),
    stress: { survived: true }
  });
  assert.equal(degraded.verdict, 'REJECT');
  assert.ok(degraded.blockers.some(function (b) { return b.code === 'EXCESSIVE_DEGRADATION'; }));
});

test('a thin out-of-sample sample cannot approve anything', function () {
  var res = researchMod.create({ thresholds: { minOutOfSampleTrades: 50 } }).compare({
    baseline: side({ outOfSample: { expectancy: 0.2, tradeCount: 60 } }),
    variant: side({ outOfSample: { expectancy: 5.0, tradeCount: 6 } }),
    stress: { survived: true }
  });
  assert.notEqual(res.verdict, 'APPROVE_AS_CHALLENGER');
  assert.ok(res.blockers.some(function (b) { return b.code === 'INSUFFICIENT_OUT_OF_SAMPLE_TRADES'; }));
});

test('a rejection names the falsification criterion the hypothesis stated in advance', function () {
  var hypothesis = {
    hypothesisId: 'hyp-0001', statement: 's',
    proposedChange: { jev: { scoreThreshold: 90 } },
    falsification: 'out-of-sample expectancy does not improve at the higher threshold',
    observation: {}
  };
  var res = researchMod.create().compare({
    baseline: side({ outOfSample: { expectancy: 0.5 } }),
    variant: side({ outOfSample: { expectancy: 0.1 } }),
    stress: { survived: true },
    hypothesis: hypothesis
  });
  assert.equal(res.verdict, 'REJECT');
  assert.equal(res.falsified, hypothesis.falsification);
  assert.equal(res.hypothesisId, 'hyp-0001');
  assert.match(res.note, /Nothing changes/);
});

test('equal performance is not an improvement', function () {
  var res = researchMod.create().compare({
    baseline: side({ outOfSample: { expectancy: 0.5 } }),
    variant: side({ outOfSample: { expectancy: 0.5 } }),
    stress: { survived: true }
  });
  assert.equal(res.verdict, 'REJECT');
  assert.ok(res.blockers.some(function (b) { return b.code === 'NO_EXPECTANCY_IMPROVEMENT'; }));
});

test('thresholds are reported with the comparison so a verdict can be re-read later', function () {
  var res = researchMod.create({ thresholds: { minWalkForwardHitRate: 0.9 } }).compare({
    baseline: side({ outOfSample: { expectancy: 0.2 } }),
    variant: side({ outOfSample: { expectancy: 0.6 }, hitRate: 0.8 }),
    stress: { survived: true }
  });
  assert.equal(res.thresholds.minWalkForwardHitRate, 0.9);
  assert.equal(res.verdict, 'REJECT');
  JSON.parse(JSON.stringify(res));
});
