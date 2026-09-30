'use strict';
// =====================================================
// MYTHOS TRADING AGENT — Analysis Agent tests
// projects/mythos-trading-agent/tests/analysis-agent-test.js
//
// The properties worth protecting here are about HONESTY rather than arithmetic:
//
//   §1 the agent cannot change anything — mission §12 forbids it, and the test is
//      structural rather than a promise in a comment;
//   §2 every group carries its sample size and is marked insufficient below the
//      threshold, so a four-trade win rate is never presented as evidence;
//   §3 drawdown is NOT reported per subset, because the drawdown of a subset of
//      interleaved trades is not a quantity that existed;
//   §4 the Jev band interpretation reports direction and refuses to conclude from
//      too small a sample;
//   §5 the caveats are computed from the report, so a small or losing run reads
//      differently from a large or winning one.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
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

/** A real run, so the analysis is exercised against a real store. */
function realRun(over, opts) {
  var o = opts || {};
  var symbols = o.symbols || ['EURUSD'];
  var probe = tradingAgent.create({ config: configMod.load({ universe: symbols }) });
  var cfg = configMod.load(Object.assign({
    universe: symbols,
    account: { initialCapital: o.capital === undefined ? 5000 : o.capital },
    backtest: { warmupBars: probe.warmupBars(), seed: 'analysis-test' },
    cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 },
    jev: { scoreThreshold: 40, minConfidence: 0.15 }
  }, over || {}));
  var data = {};
  symbols.forEach(function (s) { data[s] = { M15: FIXTURES.load(s, 'M15').slice(0, o.bars || 3000) }; });
  var wired = tradingAgent.wire({ config: cfg, logger: loggerMod.nullLogger() });
  var res = engine.run({
    config: cfg,
    source: sourceMod.fromBars({ kind: 'w', datasetVersion: 'w1', data: data }),
    label: 'analysis', logger: loggerMod.nullLogger(),
    decide: wired.engineHooks.decide,
    onRunStart: wired.engineHooks.onRunStart,
    onSeriesReady: wired.engineHooks.onSeriesReady,
    onBar: wired.engineHooks.onBar,
    onTradeClosed: wired.engineHooks.onTradeClosed
  });
  res.agent = wired.agent;
  return res;
}

/** A hand-built store, for the cases a real run cannot be made to produce. */
function syntheticStore(trades, extras) {
  var store = storeMod.create({ runId: 'synthetic' });
  trades.forEach(function (t) { store.table('trades').insert(t); });
  (extras || []).forEach(function (e) { store.table(e.table).insert(e.row); });
  return store;
}

function trade(over) {
  var base = {
    tradeId: 't1', positionId: 'p1', candidateId: 'c1', symbol: 'EURUSD',
    strategyId: 'trend-following', direction: 'LONG', entryTs: 1, exitTs: 2,
    entryPrice: 1.08, exitPrice: 1.085, lots: 0.01, grossPnl: 5, costsMoney: 0.3,
    netPnl: 4.7, outcome: 'WIN', exitReason: 'TAKE_PROFIT', regime: 'TREND',
    jevScore: 80, recoveryLevel: 0, barsHeld: 10, equityAfter: 104.7,
    spreadMoney: 0.12, commissionMoney: 0, slippageMoney: 0.08, swapMoney: 0.1
  };
  Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
  return base;
}

function repeat(n, fn) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(fn(i));
  return out;
}

// ---------------------------------------------------------------------------
// 1. Read-only by construction
// ---------------------------------------------------------------------------

test('the Analysis Agent has no way to change anything', function () {
  var a = analysisMod.create();
  // Mission §12: "It must NOT directly modify production trading rules."
  ['set', 'setConfig', 'update', 'apply', 'promote', 'write', 'save', 'mutate',
    'setThreshold', 'enable', 'disable', 'configure', 'riskEngine', 'jev', 'config'
  ].forEach(function (name) {
    assert.equal(a[name], undefined, 'the Analysis Agent exposes ' + name + '()');
  });
  assert.equal(a.agent, 'ANALYSIS_AGENT');
  assert.equal(typeof a.analyse, 'function');
});

test('analysing a store does not modify it', function () {
  var res = realRun();
  var before = res.store.digest();
  var counts = JSON.stringify(res.store.counts());
  analysisMod.create().analyse({ store: res.store, initialCapital: 5000 });
  assert.equal(res.store.digest(), before, 'the analysis wrote to the store');
  assert.equal(JSON.stringify(res.store.counts()), counts);
});

test('a sealed store can still be analysed', function () {
  var res = realRun();
  res.store.seal();
  assert.equal(res.store.isSealed(), true);
  var report = analysisMod.create().analyse({ store: res.store, initialCapital: 5000 });
  assert.ok(report.overview.trades >= 0);
});

// ---------------------------------------------------------------------------
// 2. Sample sizes and sufficiency
// ---------------------------------------------------------------------------

test('every group carries its sample size and its sufficiency', function () {
  var res = realRun();
  var report = analysisMod.create({ minSample: 20 }).analyse({ store: res.store, initialCapital: 5000 });
  ['byStrategy', 'bySymbol', 'byDirection', 'byExitReason'].forEach(function (section) {
    var groups = report[section];
    assert.ok(Object.keys(groups).length > 0, section + ' is empty');
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      assert.equal(typeof g.sampleSize, 'number');
      assert.equal(g.sufficient, g.sampleSize >= 20, section + '.' + k + ' sufficiency is wrong');
    });
  });
});

test('a small group is marked insufficient rather than quietly reported', function () {
  var store = syntheticStore(
    repeat(30, function (i) { return trade({ tradeId: 'a' + i, strategyId: 'big' }); })
      .concat(repeat(3, function (i) { return trade({ tradeId: 'b' + i, strategyId: 'tiny' }); }))
  );
  var report = analysisMod.create({ minSample: 20 }).analyse({ store: store, initialCapital: 100 });
  assert.equal(report.byStrategy.big.sufficient, true);
  assert.equal(report.byStrategy.tiny.sufficient, false);
  assert.equal(report.byStrategy.tiny.sampleSize, 3);
  // The figures are still present — the point is that they are labelled.
  assert.ok(report.byStrategy.tiny.winRate !== undefined);
});

test('minSample is configurable and reported', function () {
  var strict = analysisMod.create({ minSample: 100 });
  assert.equal(strict.minSample, 100);
  var store = syntheticStore(repeat(50, function (i) { return trade({ tradeId: 't' + i }); }));
  var report = strict.analyse({ store: store, initialCapital: 100 });
  assert.equal(report.minSample, 100);
  assert.equal(report.byStrategy['trend-following'].sufficient, false);
  assert.equal(analysisMod.create().minSample, analysisMod.DEFAULT_MIN_SAMPLE);
});

// ---------------------------------------------------------------------------
// 3. Drawdown is not reported per subset
// ---------------------------------------------------------------------------

test('per-group reports omit drawdown and say why', function () {
  var res = realRun();
  var report = analysisMod.create().analyse({ store: res.store, initialCapital: 5000 });
  Object.keys(report.byStrategy).forEach(function (k) {
    var g = report.byStrategy[k];
    assert.equal(g.maxDrawdownPct, undefined,
      'a per-group drawdown is not a quantity — those trades were interleaved with others');
    assert.equal(g.maxDrawdownMoney, undefined);
    assert.match(g.drawdownNote, /path-dependent/);
    // Streaks ARE legitimate per group: they preserve order within the subset.
    assert.equal(typeof g.maxConsecutiveLosses, 'number');
  });
  // And drawdown is reported once, for the run.
  assert.ok(report.drawdown.maxDrawdownPct >= 0);
  assert.equal(report.drawdown.curveSource, 'MARK_TO_MARKET');
});

test('drawdown episodes are listed, not just the worst one', function () {
  var store = syntheticStore([], []);
  // A curve with two distinct drawdowns, 10 % then 20 %.
  [100, 110, 99, 112, 90, 115].forEach(function (eq, i) {
    store.table('equity_curve').insert({ ts: i * 1000, equity: eq, balance: eq, openRisk: 0, drawdownPct: 0 });
  });
  var report = analysisMod.create().analyse({ store: store, initialCapital: 100 });
  assert.equal(report.drawdown.episodesOverOnePercent, 2);
  assert.equal(money.round(report.drawdown.maxDrawdownPct, 4), money.round((112 - 90) / 112 * 100, 4));
  assert.equal(report.drawdown.episodes[0].depthPct, 10);
  assert.ok(report.drawdown.episodes[0].recoveredAtTs !== null);
  assert.equal(report.drawdown.neverRecovered, false);
});

test('a drawdown that never recovered is flagged', function () {
  var store = syntheticStore([]);
  [100, 120, 80].forEach(function (eq, i) {
    store.table('equity_curve').insert({ ts: i * 1000, equity: eq, balance: eq, openRisk: 0, drawdownPct: 0 });
  });
  var report = analysisMod.create().analyse({ store: store, initialCapital: 100 });
  assert.equal(report.drawdown.neverRecovered, true);
  assert.equal(report.drawdown.recoveredAtTs, null);
});

// ---------------------------------------------------------------------------
// 4. The Jev band question (mission §6)
// ---------------------------------------------------------------------------

test('the Jev interpretation refuses to conclude from too few bands', function () {
  var i = analysisMod.create({ minSample: 20 }).interpretJevBands({
    '70-79': { sampleSize: 4, sufficient: false, expectancy: 1, winRate: 0.5, maxConsecutiveLosses: 2 }
  });
  assert.equal(i.conclusion, 'INSUFFICIENT_SAMPLE');
  assert.equal(i.bandsWithEnoughData, 0);
  assert.match(i.detail, /no relationship between Jev score and outcome can be claimed in either direction/);
});

test('the Jev interpretation reports the direction when the sample allows', function () {
  var agent = analysisMod.create({ minSample: 10 });
  var rising = agent.interpretJevBands({
    '70-79': { sampleSize: 20, sufficient: true, expectancy: -0.5, winRate: 0.3, maxConsecutiveLosses: 6 },
    '80-89': { sampleSize: 20, sufficient: true, expectancy: 0.2, winRate: 0.45, maxConsecutiveLosses: 4 },
    '90-94': { sampleSize: 20, sufficient: true, expectancy: 1.1, winRate: 0.6, maxConsecutiveLosses: 3 }
  });
  assert.equal(rising.conclusion, 'EXPECTANCY_RISES_WITH_SCORE');
  assert.equal(rising.expectancyMonotonic, 1);
  assert.equal(rising.winRateMonotonic, 1);
  assert.deepEqual(rising.maxLosingStreakByBand, [6, 4, 3]);
  // And it still refuses to call this a statistical result.
  assert.match(rising.detail, /not a significance test/);
  assert.match(rising.detail, /out of sample/);

  var falling = agent.interpretJevBands({
    '70-79': { sampleSize: 20, sufficient: true, expectancy: 1.0, winRate: 0.6, maxConsecutiveLosses: 3 },
    '80-89': { sampleSize: 20, sufficient: true, expectancy: -0.3, winRate: 0.4, maxConsecutiveLosses: 5 }
  });
  assert.equal(falling.conclusion, 'EXPECTANCY_FALLS_WITH_SCORE');

  var noisy = agent.interpretJevBands({
    '70-79': { sampleSize: 20, sufficient: true, expectancy: 0.5, winRate: 0.5, maxConsecutiveLosses: 3 },
    '80-89': { sampleSize: 20, sufficient: true, expectancy: -0.2, winRate: 0.4, maxConsecutiveLosses: 5 },
    '90-94': { sampleSize: 20, sufficient: true, expectancy: 0.8, winRate: 0.6, maxConsecutiveLosses: 2 }
  });
  assert.equal(noisy.conclusion, 'NO_MONOTONIC_RELATIONSHIP');
});

test('monotonic() handles ties, nulls and short lists', function () {
  var m = analysisMod.create().monotonic;
  assert.equal(m([1, 2, 3]), 1);
  assert.equal(m([3, 2, 1]), -1);
  assert.equal(m([1, 3, 2]), 0);
  assert.equal(m([2, 2, 2]), 0, 'a flat series is neither rising nor falling');
  assert.equal(m([1]), 0);
  assert.equal(m([null, null]), 0);
  assert.equal(m([1, null, 3]), 1, 'nulls are ignored rather than treated as zero');
});

test('the Jev analysis reports which components actually discriminate', function () {
  var res = realRun();
  var report = analysisMod.create().analyse({ store: res.store, initialCapital: 5000 });
  assert.ok(report.jev.verdicts > 0);
  assert.equal(Object.keys(report.jev.components).length, 6);
  Object.keys(report.jev.components).forEach(function (k) {
    var c = report.jev.components[k];
    assert.ok(c.weight > 0);
    assert.ok(c.min <= c.mean && c.mean <= c.max);
    assert.equal(c.discriminates, c.spread > 0.05);
  });
  // A component that never varies decided nothing; at least one must vary or the
  // gate is a constant.
  var varying = Object.keys(report.jev.components).filter(function (k) {
    return report.jev.components[k].discriminates;
  });
  assert.ok(varying.length >= 3, 'only ' + varying.length + ' Jev components varied at all');
});

test('the Jev analysis records the score distribution and the band split', function () {
  var res = realRun();
  var report = analysisMod.create().analyse({ store: res.store, initialCapital: 5000 });
  var d = report.jev.scoreDistribution;
  assert.ok(d.min <= d.median && d.median <= d.max);
  assert.ok(d.p25 <= d.median && d.median <= d.p75);
  assert.ok(report.jev.enterRate > 0 && report.jev.enterRate <= 1);
  assert.ok(Object.keys(report.jev.byBand).length > 0);
  Object.keys(report.jev.byBand).forEach(function (b) {
    assert.ok(report.jev.byBand[b].considered >= report.jev.byBand[b].entered);
  });
});

// ---------------------------------------------------------------------------
// 5. The funnel, costs, streaks, risk and recovery
// ---------------------------------------------------------------------------

test('the funnel accounts for everything the system considered', function () {
  var res = realRun();
  var report = analysisMod.create().analyse({ store: res.store, initialCapital: 5000 });
  var f = report.funnel;
  assert.ok(f.candidatesBuilt > 0);
  assert.ok(f.entered > 0);
  assert.ok(f.entryRate > 0 && f.entryRate < 1,
    'on a real run the entry rate must be a small fraction, got ' + f.entryRate);
  assert.ok(Object.keys(f.rejectedByStage).length >= 2);
  Object.keys(f.rejectedByStage).forEach(function (s) {
    var stage = f.rejectedByStage[s];
    assert.ok(stage.rejected > 0);
    assert.ok(stage.topReasons.length > 0, 'stage ' + s + ' rejected things with no reason codes');
    stage.topReasons.forEach(function (r) { assert.ok(r.count > 0 && typeof r.value === 'string'); });
  });
});

test('the cost analysis reconciles with the trades and names the dominant component', function () {
  var res = realRun();
  var report = analysisMod.create().analyse({ store: res.store, initialCapital: 5000 });
  var c = report.costs;
  assert.equal(c.trades, res.trades.length);
  assert.equal(c.netPnl, money.money(c.grossPnl - c.totalCosts));
  assert.equal(c.totalCosts, money.money(
    c.byComponent.spreadMoney + c.byComponent.commissionMoney +
    c.byComponent.slippageMoney + c.byComponent.swapMoney));
  var shares = c.componentShare;
  var total = shares.spread + shares.commission + shares.slippage + shares.swap;
  assert.ok(Math.abs(total - 1) < 0.001, 'component shares must sum to 1, got ' + total);
  assert.ok(c.avgCostPerTrade > 0);
  assert.equal(typeof c.costsFlippedTheSign, 'boolean');
});

test('the cost analysis shows when costs alone turned a profit into a loss', function () {
  var store = syntheticStore(repeat(10, function (i) {
    // Gross +1 each, costs 1.5 each → net negative.
    return trade({ tradeId: 't' + i, grossPnl: 1, costsMoney: 1.5, netPnl: -0.5, outcome: 'LOSS',
      spreadMoney: 1.2, commissionMoney: 0, slippageMoney: 0.3, swapMoney: 0 });
  }));
  var report = analysisMod.create().analyse({ store: store, initialCapital: 100 });
  assert.equal(report.costs.grossPnl, 10);
  assert.equal(report.costs.netPnl, -5);
  assert.equal(report.costs.costsFlippedTheSign, true);
  assert.equal(report.costs.netIfCostless, 10);
  assert.ok(report.costs.componentShare.spread > 0.7, 'the spread was the dominant cost and should show it');
});

test('the streak analysis finds the worst run and what was in it', function () {
  var outcomes = ['WIN', 'LOSS', 'LOSS', 'LOSS', 'LOSS', 'WIN', 'LOSS', 'LOSS', 'WIN'];
  var store = syntheticStore(outcomes.map(function (o, i) {
    return trade({
      tradeId: 't' + i, outcome: o, netPnl: o === 'WIN' ? 3 : -1,
      strategyId: i < 5 ? 'alpha' : 'beta', regime: i < 5 ? 'TREND' : 'RANGE',
      entryTs: i * 1000, exitTs: i * 1000 + 500
    });
  }));
  var report = analysisMod.create().analyse({ store: store, initialCapital: 100 });
  var s = report.losingStreaks;
  assert.equal(s.maxConsecutiveLosses, 4);
  assert.deepEqual(s.histogram, { '4': 1, '2': 1 });
  assert.equal(s.streakCount, 2);
  assert.equal(s.worstStreak.length, 4);
  assert.equal(s.worstStreak.netPnl, -4);
  assert.deepEqual(s.worstStreak.strategies, [{ value: 'alpha', count: 4 }]);
  assert.deepEqual(s.worstStreak.regimes, [{ value: 'TREND', count: 4 }]);
  assert.match(s.note, /NOT win-rate\^k/);
});

test('the risk analysis names the limits that actually bound', function () {
  var res = realRun({ account: { initialCapital: 100 } }, { capital: 100 });
  var report = analysisMod.create().analyse({ store: res.store, initialCapital: 100 });
  var r = report.risk;
  assert.ok(r.assessments > 0);
  assert.ok(r.blockRate > 0 && r.blockRate <= 1);
  assert.ok(r.topReasons.length > 0);
  assert.ok(r.topBindingLimits.length > 0, 'no limit was ever recorded as binding');
  r.topBindingLimits.forEach(function (l) { assert.ok(l.count > 0); });
});

test('the recovery analysis insists on being read beside the clamp rate', function () {
  var res = realRun({ recovery: { enabled: true, maxRecoveryLevel: 2 }, account: { initialCapital: 100 } }, { capital: 100 });
  var report = analysisMod.create().analyse({ store: res.store, initialCapital: 100 });
  assert.match(report.recovery.note, /the ladder that ran is not the ladder that was requested/);
  assert.ok(report.recovery.maxLevelReached <= 2);
  assert.ok(report.recovery.transitions >= 0);
  assert.ok(report.recovery.shareAboveBase === null || report.recovery.shareAboveBase >= 0);
});

test('the regime analysis cross-tabulates strategy against regime', function () {
  var res = realRun({}, { bars: 3000 });
  var report = analysisMod.create().analyse({ store: res.store, initialCapital: 5000 });
  assert.ok(report.regimes.barsClassified > 1000);
  assert.ok(report.regimes.distribution.length >= 2);
  assert.ok(Object.keys(report.regimes.performanceByRegime).length >= 1);
  var cells = Object.keys(report.regimes.strategyByRegime);
  assert.ok(cells.length >= 1);
  cells.forEach(function (k) {
    assert.ok(k.indexOf('|') !== -1, 'a cross-tab key must name both the strategy and the regime');
  });
  assert.match(report.regimes.note, /classification error/);
});

test('the failure analysis separates gapped exits and quantifies what they cost', function () {
  var store = syntheticStore(
    repeat(10, function (i) { return trade({ tradeId: 'g' + i, gapped: true, netPnl: -3, outcome: 'LOSS' }); })
      .concat(repeat(10, function (i) { return trade({ tradeId: 'n' + i, gapped: false, netPnl: -1, outcome: 'LOSS' }); }))
  );
  var f = analysisMod.create().analyseFailures(store, store.table('trades').all());
  assert.equal(f.gappedExits, 10);
  assert.equal(f.gappedShare, 0.5);
  assert.equal(f.gappedMeanNet, -3);
  assert.equal(f.nonGappedMeanNet, -1);
  assert.ok(f.gappedMeanNet < f.nonGappedMeanNet, 'gapped exits must be shown to be worse');
  assert.equal(f.worstTrades.length, 10);
  assert.equal(f.worstTrades[0].netPnl, -3, 'worst trades are ordered worst first');
});

// ---------------------------------------------------------------------------
// 6. Caveats are computed, not boilerplate
// ---------------------------------------------------------------------------

test('a run with no trades says so first and claims nothing', function () {
  var report = analysisMod.create().analyse({ store: syntheticStore([]), initialCapital: 100 });
  assert.equal(report.overview.trades, 0);
  assert.match(report.caveats[0], /^NO_TRADES/);
  assert.equal(report.caveats.length, 1, 'with no trades there is nothing else to caveat');
  assert.equal(report.metrics.winRate, null);
});

test('a small sample and a negative result are both called out', function () {
  var store = syntheticStore(repeat(5, function (i) {
    return trade({ tradeId: 't' + i, netPnl: -1, grossPnl: -0.7, outcome: 'LOSS' });
  }));
  var report = analysisMod.create({ minSample: 20 }).analyse({ store: store, initialCapital: 100 });
  var joined = report.caveats.join(' | ');
  assert.match(joined, /SMALL_SAMPLE: 5 trades/);
  assert.match(joined, /NEGATIVE_RESULT/);
  assert.match(joined, /DRAWDOWN_UNDERSTATED/);
  assert.match(joined, /SYNTHETIC_DATA/);
});

test('recovery being active adds its own caveat', function () {
  var store = syntheticStore(repeat(25, function (i) {
    return trade({ tradeId: 't' + i, recoveryLevel: i % 3, netPnl: 1, outcome: 'WIN' });
  }));
  var report = analysisMod.create({ minSample: 20 }).analyse({ store: store, initialCapital: 100 });
  assert.match(report.caveats.join(' | '), /RECOVERY_ACTIVE/);
  assert.ok(report.caveats.join(' | ').indexOf('NEGATIVE_RESULT') === -1);
});

// ---------------------------------------------------------------------------
// 7. Provenance and the summary line
// ---------------------------------------------------------------------------

test('the report records which store it came from, and its digest', function () {
  var res = realRun();
  var report = analysisMod.create().analyse({ store: res.store, initialCapital: 5000, label: 'in-sample' });
  assert.equal(report.label, 'in-sample');
  assert.equal(report.generatedFrom.storeRunId, res.store.runId);
  assert.equal(report.generatedFrom.digest, res.store.digest());
  assert.equal(report.generatedFrom.trades, res.trades.length);
  assert.ok(report.generatedFrom.tables.trades > 0);
  assert.equal(report.data.totalBars > 0, true);
  assert.match(report.data.note, /mechanics only/);
});

test('the summary line is one string carrying the figures that matter', function () {
  var res = realRun();
  var agent = analysisMod.create();
  var line = agent.summarise(agent.analyse({ store: res.store, initialCapital: 5000 }));
  ['trades=', 'winRate=', 'net=', 'costs=', 'expectancy=', 'PF=', 'maxDD=', 'maxLossStreak=', 'entryRate=']
    .forEach(function (field) {
      assert.ok(line.indexOf(field) !== -1, 'the summary omits ' + field);
    });
});

test('the report is JSON-serialisable, so it can be stored and compared', function () {
  var res = realRun();
  var report = analysisMod.create().analyse({ store: res.store, initialCapital: 5000 });
  var round = JSON.parse(JSON.stringify(report));
  assert.equal(round.overview.trades, report.overview.trades);
  assert.equal(round.generatedFrom.digest, report.generatedFrom.digest);
  // And two analyses of the same store agree exactly.
  var again = analysisMod.create().analyse({ store: res.store, initialCapital: 5000 });
  assert.equal(JSON.stringify(again), JSON.stringify(report));
});
