'use strict';
// =====================================================
// MYTHOS TRADING AGENT — stress suite tests
// projects/mythos-trading-agent/tests/stress-test.js
//
// The claims worth protecting:
//
//   §1 resampling is seeded, so a stress verdict cannot change between runs — a
//      verdict that moved could not gate a promotion;
//   §2 reordering REFUSES a trade set whose sizes were path-dependent (recovery
//      above base), instead of producing percentiles for a system that never
//      existed;
//   §3 the three resampling methods are ordered in honesty about clustering, and
//      the block bootstrap — which preserves it — reports the worst streaks;
//   §4 every re-run scenario is strictly ADVERSE, never favourable;
//   §5 `survived` is a conjunction, and a suite that skipped scenarios says so
//      rather than letting `survived: true` imply coverage it does not have.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var monteCarlo = require(path.join(SRC, 'stress', 'monte-carlo'));
var suiteMod = require(path.join(SRC, 'stress', 'suite'));
var configMod = require(path.join(SRC, 'config'));
var storeMod = require(path.join(SRC, 'db', 'store'));
var metricsMod = require(path.join(SRC, 'backtest', 'metrics'));
var loggerMod = require(path.join(SRC, 'core', 'logger'));
var money = require(path.join(SRC, 'core', 'money'));
var rngMod = require(path.join(SRC, 'core', 'rng'));

function trade(over) {
  var base = {
    tradeId: 't', netPnl: 1, grossPnl: 1.2, costsMoney: 0.2, outcome: 'WIN',
    exitReason: 'TAKE_PROFIT', lots: 0.01, barsHeld: 10, recoveryLevel: 0,
    entryTs: 1, exitTs: 2, symbol: 'EURUSD', strategyId: 's1', regime: 'TREND'
  };
  Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
  return base;
}

/** A deterministic mixed trade set: 60 % winners of +2, 40 % losers of −1.5. */
function mixedTrades(n, seed) {
  var g = rngMod.create(seed || 'mixed');
  var out = [];
  for (var i = 0; i < n; i++) {
    var win = g.bool(0.6);
    out.push(trade({
      tradeId: 't' + i,
      netPnl: win ? 2 : -1.5,
      grossPnl: win ? 2.2 : -1.3,
      outcome: win ? 'WIN' : 'LOSS',
      exitReason: win ? 'TAKE_PROFIT' : 'STOP_LOSS'
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Determinism
// ---------------------------------------------------------------------------

test('reordering is seeded, so the verdict cannot move between runs', function () {
  var trades = mixedTrades(60);
  function go() {
    return monteCarlo.reorder({ trades: trades, initialCapital: 100, replications: 200, seed: 'fixed' });
  }
  assert.deepEqual(go(), go(), 'a stress verdict that changed between runs could not gate a promotion');
  var other = monteCarlo.reorder({ trades: trades, initialCapital: 100, replications: 200, seed: 'other' });
  // The final equity is seed-invariant — reordering cannot change a sum — so the
  // seed's effect shows in the PATH statistics, which is where it matters.
  assert.equal(other.finalEquity.median, go().finalEquity.median);
  assert.notDeepEqual(other.maxDrawdownPct, go().maxDrawdownPct);
});

test('the bootstrap and block bootstrap are seeded too', function () {
  var trades = mixedTrades(60);
  var a = monteCarlo.bootstrap({ trades: trades, initialCapital: 100, replications: 100, seed: 's' });
  var b = monteCarlo.bootstrap({ trades: trades, initialCapital: 100, replications: 100, seed: 's' });
  assert.deepEqual(a, b);
  var c = monteCarlo.blockBootstrap({ trades: trades, initialCapital: 100, replications: 100, seed: 's', blockSize: 5 });
  var d = monteCarlo.blockBootstrap({ trades: trades, initialCapital: 100, replications: 100, seed: 's', blockSize: 5 });
  assert.deepEqual(c, d);
});

// ---------------------------------------------------------------------------
// 2. Path dependence is refused, not approximated
// ---------------------------------------------------------------------------

test('reordering refuses trades taken above base recovery level', function () {
  var trades = mixedTrades(40);
  trades[10] = trade({ tradeId: 'r', netPnl: -4, outcome: 'LOSS', recoveryLevel: 2, lots: 0.03 });
  assert.throws(function () {
    monteCarlo.reorder({ trades: trades, initialCapital: 100, replications: 10 });
  }, /their sizes depended on the order they arrived in/);
  assert.throws(function () {
    monteCarlo.bootstrap({ trades: trades, initialCapital: 100, replications: 10 });
  }, /sizes depended on the order/);
  assert.throws(function () {
    monteCarlo.blockBootstrap({ trades: trades, initialCapital: 100, replications: 10, blockSize: 5 });
  }, /sizes depended on the order/);
  // And the refusal points at the right alternative.
  try {
    monteCarlo.reorder({ trades: trades, initialCapital: 100, replications: 10 });
  } catch (e) {
    assert.match(e.message, /re-run stress scenario/);
  }
});

test('the refusal can be bypassed only explicitly', function () {
  var trades = mixedTrades(40);
  trades[10] = trade({ tradeId: 'r', netPnl: -4, outcome: 'LOSS', recoveryLevel: 2 });
  assert.doesNotThrow(function () {
    monteCarlo.reorder({ trades: trades, initialCapital: 100, replications: 10, allowRecovery: true });
  });
  assert.equal(monteCarlo.assertReorderable(mixedTrades(10)), true);
});

test('reordering needs at least two trades', function () {
  assert.throws(function () { monteCarlo.reorder({ trades: [trade()], initialCapital: 100 }); },
    /needs at least 2 trades/);
  assert.throws(function () { monteCarlo.blockBootstrap({ trades: mixedTrades(5), initialCapital: 100, blockSize: 5 }); },
    /needs at least 10 trades/);
});

// ---------------------------------------------------------------------------
// 3. The methods say different things, and say which to believe
// ---------------------------------------------------------------------------

test('pathStats reproduces the equity path exactly', function () {
  var trades = [
    trade({ netPnl: 10, outcome: 'WIN' }),
    trade({ netPnl: -20, outcome: 'LOSS' }),
    trade({ netPnl: -10, outcome: 'LOSS' }),
    trade({ netPnl: 5, outcome: 'WIN' })
  ];
  var s = monteCarlo.pathStats(trades, 100);
  assert.equal(s.finalEquity, 85);
  assert.equal(s.netPnl, -15);
  assert.equal(s.minEquity, 80);
  assert.equal(s.maxConsecutiveLosses, 2);
  // Peak 110, trough 80 → 27.27 %
  assert.equal(s.maxDrawdownPct, money.round((30 / 110) * 100, 6));
  assert.equal(s.maxDrawdownMoney, 30);
});

test('a breakeven holds the streak, matching the account convention', function () {
  var s = monteCarlo.pathStats([
    trade({ netPnl: -1, outcome: 'LOSS' }),
    trade({ netPnl: 0, outcome: 'BREAKEVEN' }),
    trade({ netPnl: -1, outcome: 'LOSS' })
  ], 100);
  assert.equal(s.maxConsecutiveLosses, 2, 'a scratch must not reset a real losing streak');
});

test('the realised path is reported with its percentile in the distribution', function () {
  var trades = mixedTrades(80);
  var res = monteCarlo.reorder({ trades: trades, initialCapital: 100, replications: 500, seed: 'pct' });
  var actual = monteCarlo.pathStats(trades, 100);
  assert.equal(res.actual.finalEquity, actual.finalEquity);
  // Reordering preserves the sum, so every replication ends at the same equity.
  assert.equal(res.finalEquity.min, res.finalEquity.max,
    'reordering cannot change the total, only the path');
  assert.ok(res.actualPercentile.maxDrawdownPct >= 0 && res.actualPercentile.maxDrawdownPct <= 1);
  assert.ok(res.maxDrawdownPct.p95 >= res.maxDrawdownPct.median);
});

test('the block bootstrap reports worse streaks than the plain bootstrap', function () {
  // Clustered losses: ten blocks of five, alternating all-win and all-loss.
  var trades = [];
  for (var b = 0; b < 12; b++) {
    for (var i = 0; i < 5; i++) {
      var win = b % 2 === 0;
      trades.push(trade({
        tradeId: 'b' + b + '-' + i, netPnl: win ? 2 : -1.5,
        outcome: win ? 'WIN' : 'LOSS'
      }));
    }
  }
  var plain = monteCarlo.bootstrap({ trades: trades, initialCapital: 100, replications: 400, seed: 'clust' });
  var block = monteCarlo.blockBootstrap({
    trades: trades, initialCapital: 100, replications: 400, seed: 'clust', blockSize: 5
  });
  assert.ok(block.maxConsecutiveLosses.median >= plain.maxConsecutiveLosses.median,
    'destroying clustering must not produce WORSE streaks: block ' + block.maxConsecutiveLosses.median +
    ' vs plain ' + plain.maxConsecutiveLosses.median);
  assert.ok(block.maxConsecutiveLosses.p95 > plain.maxConsecutiveLosses.p95,
    'the clustering-preserving method should find longer runs at the tail');
  assert.match(block.caveats.join(' '), /should be believed/);
  assert.match(plain.caveats.join(' '), /most optimistic/);
});

test('every resampling result carries its caveats', function () {
  var trades = mixedTrades(60);
  [
    monteCarlo.reorder({ trades: trades, initialCapital: 100, replications: 50, seed: 'c' }),
    monteCarlo.bootstrap({ trades: trades, initialCapital: 100, replications: 50, seed: 'c' }),
    monteCarlo.blockBootstrap({ trades: trades, initialCapital: 100, replications: 50, seed: 'c', blockSize: 5 })
  ].forEach(function (r) {
    assert.ok(Array.isArray(r.caveats) && r.caveats.length >= 2, r.kind + ' has no caveats');
  });
  var reordered = monteCarlo.reorder({ trades: trades, initialCapital: 100, replications: 50, seed: 'c' });
  assert.match(reordered.caveats.join(' '), /RISK_ENGINE_NOT_SIMULATED/);
  assert.match(reordered.caveats.join(' '), /UNDERSTATES/);
});

test('the bootstrap reports whether the edge survives at the 5th percentile', function () {
  var strong = monteCarlo.bootstrap({
    trades: mixedTrades(300, 'strong'), initialCapital: 1000, replications: 400, seed: 'b1'
  });
  assert.equal(typeof strong.expectancyPositiveAtP5, 'boolean');
  assert.ok(strong.expectancy.p5 <= strong.expectancy.median);

  var weak = monteCarlo.bootstrap({
    trades: [trade({ netPnl: 1, outcome: 'WIN' }), trade({ netPnl: -1, outcome: 'LOSS' }),
             trade({ netPnl: 1, outcome: 'WIN' }), trade({ netPnl: -1, outcome: 'LOSS' })],
    initialCapital: 100, replications: 400, seed: 'b2'
  });
  assert.equal(weak.expectancyPositiveAtP5, false,
    'a break-even sample must not read as a positive edge at any percentile');
});

test('the ruin probability uses a stated ruin equity', function () {
  var trades = [];
  for (var i = 0; i < 30; i++) trades.push(trade({ netPnl: -3, outcome: 'LOSS', tradeId: 't' + i }));
  var res = monteCarlo.reorder({
    trades: trades, initialCapital: 100, replications: 50, seed: 'ruin', ruinEquity: 50
  });
  assert.equal(res.probabilityOfRuin, 1, '30 losses of $3 from $100 always breaches $50');
  assert.equal(res.ruinEquity, 50);
});

// ---------------------------------------------------------------------------
// 4. Streak arithmetic
// ---------------------------------------------------------------------------

test('streak arithmetic says how many losses the account can absorb', function () {
  var trades = [];
  for (var i = 0; i < 10; i++) trades.push(trade({ netPnl: -2, outcome: 'LOSS', tradeId: 'l' + i }));
  for (var j = 0; j < 10; j++) trades.push(trade({ netPnl: 3, outcome: 'WIN', tradeId: 'w' + j }));
  var s = monteCarlo.streakStress({ trades: trades, initialCapital: 100, drawdownLimitPct: 20, maxK: 12 });
  assert.equal(s.averageLossMoney, 2);
  assert.equal(s.worstLossMoney, 2);
  // 20 % of $100 is $20 → the 10th consecutive $2 loss breaches it.
  assert.equal(s.streakToBreachLimitAtAverage, 10);
  assert.equal(s.table.length, 12);
  assert.equal(s.table[9].drawdownPctAtAverage, 20);
  assert.equal(s.table[9].breachesLimitAtAverage, true);
  assert.equal(s.table[8].breachesLimitAtAverage, false);
  assert.match(s.note, /survival bound/);
});

test('streak arithmetic distinguishes the average loss from the worst', function () {
  var trades = [
    trade({ netPnl: -1, outcome: 'LOSS' }),
    trade({ netPnl: -1, outcome: 'LOSS' }),
    trade({ netPnl: -10, outcome: 'LOSS' })
  ];
  var s = monteCarlo.streakStress({ trades: trades, initialCapital: 100, drawdownLimitPct: 20, maxK: 12 });
  assert.equal(s.averageLossMoney, 4);
  assert.equal(s.worstLossMoney, 10);
  assert.ok(s.streakToBreachLimitAtWorst < s.streakToBreachLimitAtAverage,
    'a run of worst-case losses must breach the limit sooner');
});

test('streak arithmetic on a run with no losses says so', function () {
  var s = monteCarlo.streakStress({ trades: [trade({ netPnl: 1, outcome: 'WIN' })], initialCapital: 100 });
  assert.equal(s.losses, 0);
  assert.match(s.note, /no losing trades/);
});

// ---------------------------------------------------------------------------
// 5. The suite
// ---------------------------------------------------------------------------

/** A runVariant stub that records what it was asked and returns shaped metrics. */
function stubRunner(behaviour) {
  var calls = [];
  var fn = function (override, label, opts) {
    calls.push({ override: override, label: label, opts: opts });
    var m = behaviour ? behaviour(override, label, opts) : {};
    return {
      metrics: Object.assign({
        tradeCount: 60, netPnl: 5, expectancy: 0.08, winRate: 0.5, profitFactor: 1.2,
        maxDrawdownPct: 5, maxConsecutiveLosses: 4, totalCosts: 3
      }, m),
      trades: [],
      timeline: { bars: 2800 }
    };
  };
  fn.calls = calls;
  return fn;
}

function baseline(over) {
  var trades = mixedTrades(80, 'baseline');
  return {
    metrics: Object.assign(metricsMod.compute({ trades: trades, initialCapital: 1000 }), over || {}),
    trades: trades
  };
}

test('the suite runs every §15 scenario and reports one verdict', function () {
  var cfg = configMod.load({ account: { initialCapital: 1000 } });
  var runner = stubRunner();
  var suite = suiteMod.create({ config: cfg, runVariant: runner, logger: loggerMod.nullLogger() });
  var res = suite.run({ baseline: baseline() });

  var names = res.scenarios.map(function (s) { return s.scenario; });
  ['SPREAD_EXPANSION', 'SLIPPAGE_EXPANSION', 'EXECUTION_DELAY', 'PARAMETER_PERTURBATION',
    'DATA_GAPS', 'MONTE_CARLO_REORDER', 'BLOCK_BOOTSTRAP', 'BOOTSTRAP', 'STREAK_ARITHMETIC'
  ].forEach(function (n) {
    assert.ok(names.indexOf(n) !== -1, 'the suite omitted ' + n);
  });
  assert.equal(typeof res.survived, 'boolean');
  assert.ok(res.fingerprint.length === 12);
  assert.equal(res.baselineConfigHash, cfg.fingerprint.hash);
  JSON.parse(JSON.stringify(res));
});

test('every re-run scenario makes things WORSE, never better', function () {
  var cfg = configMod.load({ account: { initialCapital: 1000 } });
  var runner = stubRunner();
  var suite = suiteMod.create({ config: cfg, runVariant: runner, logger: loggerMod.nullLogger() });
  suite.run({ baseline: baseline() });

  var byLabel = {};
  runner.calls.forEach(function (c) { byLabel[c.label] = c.override; });

  // Spread and slippage go up.
  assert.ok(byLabel['stress:spread'].cost.fixedSpreadPips > 0);
  assert.equal(byLabel['stress:spread'].cost.spreadModel, 'fixed');
  assert.ok(byLabel['stress:slippage'].cost.fixedSlippagePips > 0);
  // Delay goes up.
  assert.equal(byLabel['stress:delay'].cost.executionDelayBars, suite.severities.executionDelayBars);
  // Parameters move adversely: LESS risk budget, MORE required reward, HIGHER Jev bar.
  var p = byLabel['stress:params'];
  assert.ok(p.risk.maxAccountRiskPerTradePct < cfg.risk.maxAccountRiskPerTradePct);
  assert.ok(p.risk.minRewardRisk > cfg.risk.minRewardRisk);
  assert.ok(p.jev.scoreThreshold > cfg.jev.scoreThreshold);
});

test('a scenario that blows the drawdown limit fails the whole suite', function () {
  var cfg = configMod.load({ account: { initialCapital: 1000 }, risk: { maxDrawdownPct: 10 } });
  var runner = stubRunner(function (override, label) {
    // Only the spread scenario is catastrophic.
    if (label === 'stress:spread') return { maxDrawdownPct: 35, expectancy: -0.5, netPnl: -40 };
    return {};
  });
  var suite = suiteMod.create({ config: cfg, runVariant: runner, logger: loggerMod.nullLogger() });
  // Restricted to the re-run scenarios so the point is isolated: the other
  // scenarios pass, and one failure is still enough to fail the suite.
  var res = suite.run({
    baseline: baseline(),
    only: ['SPREAD_EXPANSION', 'SLIPPAGE_EXPANSION', 'EXECUTION_DELAY', 'PARAMETER_PERTURBATION', 'DATA_GAPS']
  });
  assert.equal(res.survived, false, 'survival must be a conjunction — one blown scenario fails the suite');
  assert.match(res.reason, /SPREAD_EXPANSION/);
  assert.match(res.reason, /maxDrawdownPct 35 > 10/);
  assert.equal(res.scenariosFailed, 1);
  assert.equal(res.scenariosRun, 5);
  var failing = res.scenarios.filter(function (s) { return s.scenario === 'SPREAD_EXPANSION'; })[0];
  assert.equal(failing.passed, false);
  assert.equal(failing.failures[0].limit, 'maxDrawdownPct');
  assert.ok(res.scenarios.filter(function (s) { return s.scenario !== 'SPREAD_EXPANSION'; })
    .every(function (s) { return s.passed; }), 'the other scenarios must have passed');
});

test('a scenario that lengthens the losing streak past the limit fails', function () {
  var cfg = configMod.load({ account: { initialCapital: 1000 }, risk: { maxConsecutiveLosses: 5 } });
  var runner = stubRunner(function (override, label) {
    if (label === 'stress:delay') return { maxConsecutiveLosses: 11 };
    return {};
  });
  var res = suiteMod.create({ config: cfg, runVariant: runner, logger: loggerMod.nullLogger() })
    .run({ baseline: baseline() });
  assert.equal(res.survived, false);
  assert.match(res.reason, /EXECUTION_DELAY/);
  assert.match(res.reason, /maxConsecutiveLosses 11 > 5/);
});

test('expectancy retention can be required, and reports the ratio', function () {
  var cfg = configMod.load({ account: { initialCapital: 1000 } });
  var runner = stubRunner(function (override, label) {
    if (label === 'stress:spread') return { expectancy: 0.001 };
    return { expectancy: 1 };
  });
  var res = suiteMod.create({
    config: cfg, runVariant: runner, logger: loggerMod.nullLogger(),
    limits: { minExpectancyRetention: 0.5 }
  }).run({ baseline: baseline({ expectancy: 1 }) });
  var failing = res.scenarios.filter(function (s) { return s.scenario === 'SPREAD_EXPANSION'; })[0];
  assert.equal(failing.passed, false);
  assert.equal(failing.failures[0].limit, 'minExpectancyRetention');
  assert.ok(failing.failures[0].observed < 0.5);
});

test('a suite that skipped scenarios warns that survival does not cover them', function () {
  var cfg = configMod.load({ account: { initialCapital: 100 } });
  // Too few trades for resampling to mean anything.
  var res = suiteMod.create({ config: cfg, runVariant: stubRunner(), logger: loggerMod.nullLogger() })
    .run({ baseline: { metrics: metricsMod.compute({ trades: mixedTrades(4), initialCapital: 100 }), trades: mixedTrades(4) } });
  assert.ok(res.scenariosSkipped > 0);
  assert.match(res.coverageWarning, /"survived" covers only what actually ran/);
  var mcSkipped = res.scenarios.filter(function (s) { return s.scenario === 'MONTE_CARLO_REORDER'; })[0];
  assert.equal(mcSkipped.skipped, true);
  assert.match(mcSkipped.detail.note, /noise, not evidence/);
});

test('recovery-enabled trades skip the reordering scenarios with the reason stated', function () {
  var cfg = configMod.load({ account: { initialCapital: 100 }, recovery: { enabled: true, maxRecoveryLevel: 2 } });
  var trades = mixedTrades(60);
  trades[5] = trade({ tradeId: 'r', netPnl: -4, outcome: 'LOSS', recoveryLevel: 2 });
  var res = suiteMod.create({ config: cfg, runVariant: stubRunner(), logger: loggerMod.nullLogger() })
    .run({ baseline: { metrics: metricsMod.compute({ trades: trades, initialCapital: 100 }), trades: trades } });
  var skipped = res.scenarios.filter(function (s) { return s.scenario === 'MONTE_CARLO_REORDER'; })[0];
  assert.equal(skipped.skipped, true);
  assert.match(skipped.detail.note, /describe a system that never existed/);
  assert.match(skipped.detail.note, /re-run scenarios cover this configuration instead/);
  assert.ok(res.coverageWarning !== null);
  // The re-run scenarios must still have run.
  assert.ok(res.scenarios.some(function (s) { return s.scenario === 'SPREAD_EXPANSION' && !s.skipped; }));
});

test('the intrabar scenario is skipped when the baseline is already pessimistic', function () {
  var cfg = configMod.load({ account: { initialCapital: 1000 } });
  assert.equal(cfg.backtest.allowIntrabarStopAndTarget, 'STOP_FIRST');
  var res = suiteMod.create({ config: cfg, runVariant: stubRunner(), logger: loggerMod.nullLogger() })
    .run({ baseline: baseline() });
  var s = res.scenarios.filter(function (x) { return x.scenario === 'INTRABAR_PESSIMISM'; })[0];
  assert.equal(s.skipped, true);
  assert.match(s.detail.note, /already uses STOP_FIRST/);

  var optimistic = configMod.load({
    account: { initialCapital: 1000 }, backtest: { allowIntrabarStopAndTarget: 'TARGET_FIRST' }
  });
  var res2 = suiteMod.create({ config: optimistic, runVariant: stubRunner(), logger: loggerMod.nullLogger() })
    .run({ baseline: baseline() });
  var s2 = res2.scenarios.filter(function (x) { return x.scenario === 'INTRABAR_PESSIMISM'; })[0];
  assert.ok(!s2.skipped);
  assert.equal(s2.detail.to, 'STOP_FIRST');
});

test('only the named scenarios run when a subset is requested', function () {
  var cfg = configMod.load({ account: { initialCapital: 1000 } });
  var res = suiteMod.create({ config: cfg, runVariant: stubRunner(), logger: loggerMod.nullLogger() })
    .run({ baseline: baseline(), only: ['SPREAD_EXPANSION', 'STREAK_ARITHMETIC'] });
  assert.deepEqual(res.scenarios.map(function (s) { return s.scenario; }).sort(),
    ['SPREAD_EXPANSION', 'STREAK_ARITHMETIC']);
});

test('the adverse-regime scenario runs only when the caller opts in', function () {
  var cfg = configMod.load({ account: { initialCapital: 1000 } });
  var runner = stubRunner();
  var suite = suiteMod.create({ config: cfg, runVariant: runner, logger: loggerMod.nullLogger() });
  var without = suite.run({ baseline: baseline() });
  assert.ok(!without.scenarios.some(function (s) { return s.scenario === 'ADVERSE_REGIME'; }));
  var withIt = suite.run({ baseline: baseline(), includeAdverseRegime: true, adverseRegime: 'HIGH_VOLATILITY' });
  var s = withIt.scenarios.filter(function (x) { return x.scenario === 'ADVERSE_REGIME'; })[0];
  assert.ok(s);
  assert.equal(s.detail.forcedRegime, 'HIGH_VOLATILITY');
  assert.match(s.detail.note, /read it as a bound/);
});

test('unknown severities and limits are refused', function () {
  var cfg = configMod.load();
  assert.throws(function () {
    suiteMod.create({ config: cfg, runVariant: stubRunner(), severities: { nonsense: 1 } });
  }, /unknown stress severity "nonsense"/);
  assert.throws(function () {
    suiteMod.create({ config: cfg, runVariant: stubRunner(), limits: { nonsense: 1 } });
  }, /unknown stress limit "nonsense"/);
  assert.throws(function () { suiteMod.create({ config: cfg }); },
    /needs a runVariant\(override, label\) function/);
  assert.throws(function () {
    suiteMod.create({ config: cfg, runVariant: stubRunner() }).run({});
  }, /needs a baseline run with metrics/);
});

test('severities and limits are reported with the result so a verdict can be re-read', function () {
  var cfg = configMod.load({ account: { initialCapital: 1000 } });
  var res = suiteMod.create({
    config: cfg, runVariant: stubRunner(), logger: loggerMod.nullLogger(),
    severities: { spreadMultiple: 5 }, limits: { maxDrawdownPct: 15 }
  }).run({ baseline: baseline() });
  assert.equal(res.severities.spreadMultiple, 5);
  assert.equal(res.limits.maxDrawdownPct, 15);
  assert.ok(Object.isFrozen(res.severities));
  // A different severity must produce a different fingerprint.
  var other = suiteMod.create({
    config: cfg, runVariant: stubRunner(), logger: loggerMod.nullLogger(),
    severities: { spreadMultiple: 6 }, limits: { maxDrawdownPct: 15 }
  }).run({ baseline: baseline() });
  assert.notEqual(res.fingerprint, other.fingerprint);
});

test('the suite persists one record per scenario', function () {
  var cfg = configMod.load({ account: { initialCapital: 1000 } });
  var suite = suiteMod.create({ config: cfg, runVariant: stubRunner(), logger: loggerMod.nullLogger() });
  var res = suite.run({ baseline: baseline() });
  var store = storeMod.create({ runId: 'stress' });
  var n = suite.persist(store, 'bt-1', res);
  assert.equal(n, res.scenarios.length);
  assert.equal(store.table('stress_tests').count(), res.scenarios.length);
  var row = store.table('stress_tests').by('kind', 'SPREAD_EXPANSION')[0];
  assert.equal(row.backtestId, 'bt-1');
  assert.equal(row.seed, res.seed);
  assert.ok(row.params.severities.spreadMultiple > 1);
  assert.equal(typeof row.summary.passed, 'boolean');
});

test('the Monte Carlo scenarios judge against the drawdown breach probability', function () {
  var cfg = configMod.load({
    account: { initialCapital: 100 },
    risk: { maxDrawdownPct: 2, maxDailyLossPct: 1 }
  });
  // Losses large enough that almost any ordering breaches a 2 % drawdown cap.
  var trades = [];
  for (var i = 0; i < 40; i++) {
    trades.push(trade({ tradeId: 't' + i, netPnl: i % 2 === 0 ? 3 : -4, outcome: i % 2 === 0 ? 'WIN' : 'LOSS' }));
  }
  var res = suiteMod.create({
    config: cfg, runVariant: stubRunner(), logger: loggerMod.nullLogger(),
    severities: { monteCarloReplications: 200 }
  }).run({
    baseline: { metrics: metricsMod.compute({ trades: trades, initialCapital: 100 }), trades: trades },
    only: ['MONTE_CARLO_REORDER', 'BLOCK_BOOTSTRAP']
  });
  var mc = res.scenarios.filter(function (s) { return s.scenario === 'MONTE_CARLO_REORDER'; })[0];
  assert.equal(mc.passed, false);
  assert.ok(mc.failures.some(function (f) { return /maxDrawdownBreachProbability|maxRuinProbability|maxConsecutiveLosses/.test(f.limit); }));
  assert.ok(mc.detail.probabilityOfBreachingDrawdownLimit > 0);
  assert.ok(mc.detail.caveats.length >= 2);
});
