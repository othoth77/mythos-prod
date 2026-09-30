'use strict';
// =====================================================
// MYTHOS TRADING AGENT — backtest engine tests
// projects/mythos-trading-agent/tests/backtest-engine-test.js
//
// The engine's four honesty rules, each tested directly:
//
//   §2 a signal decided on bar i fills at the OPEN of bar i+1 — never at the
//      close that produced it;
//   §3 at most one position exists at any instant, across all assets, including
//      during the bar between decision and fill;
//   §4 equity is marked to market on every bar, so a drawdown limit could fire
//      while a losing position is still open;
//   §5 two runs of one configuration produce the same store digest — the
//      reproducibility check mission §14 asks for.
//
// Plus the arithmetic that everything downstream trusts: every trade's net P&L
// equals its gross minus its own recorded costs, and the metrics agree with the
// trade list.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var configMod = require(path.join(SRC, 'config'));
var engine = require(path.join(SRC, 'backtest', 'engine'));
var fixtureSource = require(path.join(SRC, 'data', 'fixture-source'));
var sourceMod = require(path.join(SRC, 'data', 'source'));
var instrumentMod = require(path.join(SRC, 'core', 'instrument'));
var money = require(path.join(SRC, 'core', 'money'));
var enums = require(path.join(SRC, 'core', 'enums'));
var loggerMod = require(path.join(SRC, 'core', 'logger'));
var metricsMod = require(path.join(SRC, 'backtest', 'metrics'));
var indicators = require(path.join(SRC, 'indicators'));

var FIXTURES = fixtureSource.createSource();

/** A short deterministic window of the committed fixtures. */
function window(symbols, bars) {
  var n = bars || 700;
  var data = {};
  symbols.forEach(function (s) {
    data[s] = { M15: FIXTURES.load(s, 'M15').slice(0, n) };
  });
  return sourceMod.fromBars({ kind: 'fixture-window', datasetVersion: FIXTURES.datasetVersion + ':0-' + n, data: data });
}

function cfg(over) {
  return configMod.load(Object.assign({
    universe: ['EURUSD'],
    backtest: { warmupBars: 50, seed: 'engine-test' },
    cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 }
  }, over || {}));
}

/**
 * A mechanical decision function: go LONG every `every` bars with a stop of
 * `stopPips` and a target of stopPips * rr. It has no edge and is not supposed
 * to — its job is to exercise execution, not to make money.
 */
function everyNth(opts) {
  var o = opts || {};
  var every = o.every || 25;
  var rr = o.rr === undefined ? 2 : o.rr;
  var lots = o.lots === undefined ? 0.01 : o.lots;
  var direction = o.direction || 'LONG';
  var seen = [];
  var fn = function (ctx) {
    seen.push({ ts: ctx.ts, symbol: ctx.symbol, barIndex: ctx.barIndex });
    if (ctx.barIndex % every !== 0) {
      return { decision: 'NO_TRADE', stage: 'STRATEGY', reasonCodes: ['NOT_MY_BAR'] };
    }
    var inst = ctx.instrument;
    var stopPips = o.stopPips === undefined ? inst.typicalSpreadPips * 15 : o.stopPips;
    var px = ctx.view.close();
    var stopDist = instrumentMod.toPrice(inst, stopPips);
    var sign = direction === 'LONG' ? 1 : -1;
    return {
      decision: 'ENTER',
      candidateId: ctx.ids.next('cand'),
      strategyId: 'every-' + every,
      direction: direction,
      lots: lots,
      stopLoss: money.round(px - sign * stopDist, inst.digits),
      takeProfit: money.round(px + sign * stopDist * rr, inst.digits),
      riskMoney: instrumentMod.riskMoneyForLots(inst, lots, stopPips, px),
      regime: 'TREND',
      jevScore: 80,
      recoveryLevel: 0,
      reasonCodes: ['MECHANICAL_TEST_SIGNAL']
    };
  };
  fn.seen = seen;
  return fn;
}

function runWith(over, decideFn, symbols) {
  var syms = symbols || ['EURUSD'];
  var c = cfg(Object.assign({ universe: syms }, over || {}));
  return engine.run({
    config: c,
    source: window(syms),
    decide: decideFn,
    label: 'test',
    logger: loggerMod.nullLogger()
  });
}

// ---------------------------------------------------------------------------
// 1. Basic shape
// ---------------------------------------------------------------------------

test('a run with a decision function that never trades produces no trades and full accounting', function () {
  var res = runWith({}, function () { return null; });
  assert.equal(res.trades.length, 0);
  assert.equal(res.account.balance(), 100);
  assert.equal(res.metrics.tradeCount, 0);
  assert.equal(res.metrics.netPnl, 0);
  assert.ok(res.counts.decisionsRequested > 0, 'the engine must still have asked');
  assert.equal(res.counts.entriesFilled, 0);
  assert.equal(res.store.table('equity_curve').count(), res.timeline.bars,
    'equity is marked on every bar even with nothing open');
});

test('the engine refuses to run without a decision function', function () {
  assert.throws(function () {
    engine.run({ config: cfg(), source: window(['EURUSD']) });
  }, /requires a decide\(ctx\) function/);
});

test('a run produces trades, and every trade reconciles gross minus costs', function () {
  var res = runWith({}, everyNth({ every: 25 }));
  assert.ok(res.trades.length >= 5, 'expected several trades, got ' + res.trades.length);
  res.trades.forEach(function (t) {
    assert.equal(t.netPnl, money.money(t.grossPnl - t.costsMoney), 'trade ' + t.tradeId + ' does not reconcile');
    assert.equal(t.costsMoney, money.money(t.spreadMoney + t.commissionMoney + t.slippageMoney + t.swapMoney));
    assert.ok(t.costsMoney !== 0, 'a trade with no cost at all means the cost model was bypassed');
    assert.ok(enums.isValid(enums.TradeOutcome, t.outcome));
    assert.ok(enums.isValid(enums.ExitReason, t.exitReason));
  });
  // The account balance must equal the initial capital plus the sum of net P&L.
  var sum = money.sum(res.trades.map(function (t) { return t.netPnl; }));
  assert.equal(res.account.balance(), money.money(100 + sum));
});

test('metrics computed by the engine agree with a recomputation from its trades', function () {
  var res = runWith({}, everyNth({ every: 25 }));
  var again = metricsMod.compute({
    trades: res.trades,
    initialCapital: 100,
    equityCurve: res.account.equityCurve()
  });
  assert.equal(again.netPnl, res.metrics.netPnl);
  assert.equal(again.maxDrawdownPct, res.metrics.maxDrawdownPct);
  assert.equal(again.maxConsecutiveLosses, res.metrics.maxConsecutiveLosses);
  assert.equal(again.profitFactor, res.metrics.profitFactor);
});

// ---------------------------------------------------------------------------
// 2. The one-bar execution delay
// ---------------------------------------------------------------------------

test('an entry fills at the OPEN of the bar after the decision', function () {
  var res = runWith({}, everyNth({ every: 40 }));
  var bars = window(['EURUSD']).load('EURUSD', 'M15');
  var byTs = Object.create(null);
  bars.forEach(function (b, i) { byTs[b.ts] = { bar: b, index: i }; });

  var orders = res.store.table('orders').find(function (r) { return r.status === 'FILLED'; });
  assert.ok(orders.length > 0);
  orders.forEach(function (o) {
    var entryBar = byTs[o.ts];
    assert.ok(entryBar, 'the fill landed on a bar that does not exist');
    assert.equal(o.filledPrice, money.round(entryBar.bar.open, 5),
      'the fill price must be the bar open, not a close');
  });

  // And the decision bar is exactly one earlier.
  var pending = res.store.table('orders').find(function (r) { return r.status === 'PENDING'; });
  pending.forEach(function (p) {
    var decisionBar = byTs[p.ts];
    var execBar = byTs[p.executeAtTs];
    assert.equal(execBar.index, decisionBar.index + 1, 'exactly one bar of mandatory delay');
  });
});

test('executionDelayBars adds delay on top of the mandatory bar, never removes it', function () {
  var res = runWith({ cost: { executionDelayBars: 3, slippageModel: 'fixed', fixedSlippagePips: 0.3 } }, everyNth({ every: 40 }));
  var bars = window(['EURUSD']).load('EURUSD', 'M15');
  var byTs = Object.create(null);
  bars.forEach(function (b, i) { byTs[b.ts] = i; });
  var pending = res.store.table('orders').find(function (r) { return r.status === 'PENDING'; });
  assert.ok(pending.length > 0);
  pending.forEach(function (p) {
    assert.equal(byTs[p.executeAtTs], byTs[p.ts] + 4, '1 mandatory + 3 configured');
  });
});

test('a signal on the final bar is recorded as NO_TRADE rather than filled from nowhere', function () {
  var bars = FIXTURES.load('EURUSD', 'M15').slice(0, 120);
  var src = sourceMod.fromBars({ kind: 'tiny', datasetVersion: 'tiny-v1', data: { EURUSD: { M15: bars } } });
  var lastIndex = bars.length - 1;
  var res = engine.run({
    config: cfg({ backtest: { warmupBars: 10, seed: 's' } }),
    source: src,
    label: 'last-bar',
    logger: loggerMod.nullLogger(),
    decide: function (ctx) {
      if (ctx.barIndex !== lastIndex) return null;
      return {
        decision: 'ENTER', candidateId: 'c-last', direction: 'LONG', lots: 0.01,
        stopLoss: money.round(ctx.view.close() * 0.999, 5),
        takeProfit: money.round(ctx.view.close() * 1.002, 5)
      };
    }
  });
  assert.equal(res.trades.length, 0);
  var noTrade = res.store.table('decisions').find(function (d) {
    return d.reasonCodes.indexOf('NO_FUTURE_BAR_TO_EXECUTE_ON') !== -1;
  });
  assert.equal(noTrade.length, 1);
  assert.equal(noTrade[0].stage, 'EXECUTION');
});

// ---------------------------------------------------------------------------
// 3. One trade only, globally
// ---------------------------------------------------------------------------

test('across four assets there is never more than one open position', function () {
  var syms = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];
  var res = runWith({}, everyNth({ every: 10 }), syms);
  assert.ok(res.trades.length > 5, 'got ' + res.trades.length + ' trades');

  // Reconstruct occupancy from the position records and require it never exceeds 1.
  var events = [];
  res.store.table('positions').all().forEach(function (p) {
    if (p.status === 'OPEN') events.push({ ts: p.entryTs, delta: 1, id: p.positionId });
    else events.push({ ts: p.exitTs, delta: -1, id: p.positionId });
  });
  // For equal timestamps the OPEN must be ordered first: a position may open and
  // close on the same bar (the entry bar can hit a level), and sorting the close
  // first would show a spurious −1.
  events.sort(function (a, b) { return a.ts - b.ts || b.delta - a.delta; });
  var open = 0;
  events.forEach(function (e) {
    open += e.delta;
    assert.ok(open <= 1, 'two positions were open at once around ' + new Date(e.ts).toISOString());
    assert.ok(open >= 0);
  });

  assert.equal(res.slot.verifyInvariant().ok, true);
  assert.ok(res.counts.slotBlocked > 0, 'with four assets signalling often, the slot must have refused some');

  // Trades must span more than one symbol, or the test proves nothing.
  var symbolsTraded = {};
  res.trades.forEach(function (t) { symbolsTraded[t.symbol] = true; });
  assert.ok(Object.keys(symbolsTraded).length > 1, 'only ' + Object.keys(symbolsTraded) + ' traded');
});

test('trades never overlap in time', function () {
  var res = runWith({}, everyNth({ every: 10 }), ['EURUSD', 'XAUUSD']);
  var sorted = res.trades.slice().sort(function (a, b) { return a.entryTs - b.entryTs; });
  for (var i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].entryTs >= sorted[i - 1].exitTs,
      'trade ' + sorted[i].tradeId + ' opened at ' + new Date(sorted[i].entryTs).toISOString() +
      ' before ' + sorted[i - 1].tradeId + ' closed at ' + new Date(sorted[i - 1].exitTs).toISOString());
  }
});

// ---------------------------------------------------------------------------
// 4. Mark-to-market and the audit trail
// ---------------------------------------------------------------------------

test('equity is marked on every bar of the timeline, plus once per trade close', function () {
  var res = runWith({}, everyNth({ every: 25 }));
  var curve = res.account.equityCurve();
  // One sample per bar, and one extra at each trade close — the post-trade
  // balance is recorded as its own point so a closing loss is visible in the
  // curve even if the next bar recovers.
  assert.equal(curve.length, res.timeline.bars + res.trades.length);
  for (var i = 1; i < curve.length; i++) {
    assert.ok(curve[i].ts >= curve[i - 1].ts, 'the equity curve must be ascending in time');
  }
  // Every bar timestamp must appear.
  var seen = Object.create(null);
  curve.forEach(function (s) { seen[s.ts] = true; });
  assert.equal(Object.keys(seen).length, res.timeline.bars);
});

test('mark-to-market equity differs from balance while a position is open', function () {
  var res = runWith({}, everyNth({ every: 25 }));
  var diverged = res.account.equityCurve().filter(function (s) { return s.equity !== s.balance; });
  assert.ok(diverged.length > 0,
    'equity never diverged from balance, so nothing was ever marked while open');
});

test('the run writes a complete audit trail', function () {
  var res = runWith({}, everyNth({ every: 25 }));
  var counts = res.store.counts();
  ['market_data_meta', 'orders', 'positions', 'trades', 'decisions', 'equity_curve', 'backtests', 'cost_assessments']
    .forEach(function (t) {
      assert.ok(counts[t] > 0, 'nothing was recorded in ' + t);
    });
  // Every trade must be traceable back to its order and its decision.
  res.trades.forEach(function (t) {
    assert.ok(res.store.table('orders').by('candidateId', t.candidateId).length >= 2,
      'trade ' + t.tradeId + ' has no PENDING+FILLED order pair');
    assert.ok(res.store.table('decisions').by('candidateId', t.candidateId).length >= 1);
    assert.ok(res.store.table('positions').by('positionId', t.positionId).length === 2,
      'a position must be recorded both OPEN and CLOSED');
  });
});

test('the backtest record cites its config hash, dataset version and seed', function () {
  var res = runWith({}, everyNth({ every: 25 }));
  var bt = res.store.table('backtests').last();
  assert.equal(bt.configHash, res.config.fingerprint.hash);
  assert.equal(bt.datasetVersion, res.datasetVersion);
  assert.equal(bt.seed, 'engine-test');
  assert.equal(bt.mode, 'BACKTEST');
  assert.equal(bt.label, 'test');
  assert.equal(bt.segment.bars, res.timeline.bars);
  assert.equal(bt.metrics.tradeCount, res.trades.length);
});

test('NO_TRADE decisions are recorded with the stage that produced them', function () {
  var res = runWith({}, everyNth({ every: 25 }));
  var noTrades = res.store.table('decisions').by('decision', 'NO_TRADE');
  assert.ok(noTrades.length > 10);
  noTrades.forEach(function (d) {
    assert.ok(enums.isValid(enums.PipelineStage, d.stage));
    assert.ok(Array.isArray(d.reasonCodes));
  });
  assert.ok(res.counts.noTradeByStage.STRATEGY > 0);
});

// ---------------------------------------------------------------------------
// 5. Reproducibility
// ---------------------------------------------------------------------------

test('two runs of one configuration produce the same store digest', function () {
  var a = runWith({}, everyNth({ every: 25 }));
  var b = runWith({}, everyNth({ every: 25 }));
  assert.equal(a.digest(), b.digest());
  assert.equal(a.runId, b.runId, 'the run id is derived from the label and the config fingerprint');
  assert.deepEqual(a.metrics, b.metrics);
});

test('changing the configuration changes the run id and the result', function () {
  var a = runWith({}, everyNth({ every: 25 }));
  var b = runWith({ backtest: { warmupBars: 60, seed: 'engine-test' } }, everyNth({ every: 25 }));
  assert.notEqual(a.runId, b.runId);
  assert.notEqual(a.digest(), b.digest());
});

test('a gaussian cost model is still reproducible because its RNG is seeded', function () {
  function go() {
    return engine.run({
      config: configMod.load({ universe: ['EURUSD'], backtest: { warmupBars: 50, seed: 'gauss' }, cost: { slippageModel: 'gaussian' } }),
      source: window(['EURUSD']),
      decide: everyNth({ every: 25 }),
      label: 'gauss',
      logger: loggerMod.nullLogger()
    });
  }
  var a = go(), b = go();
  assert.equal(a.digest(), b.digest());
  assert.ok(a.trades.length > 0);
  // And the slippage actually varied, or the seed proves nothing.
  var slips = {};
  a.trades.forEach(function (t) { slips[t.slippagePips] = true; });
  assert.ok(Object.keys(slips).length > 1, 'gaussian slippage produced a single value');
});

// ---------------------------------------------------------------------------
// 6. Exits
// ---------------------------------------------------------------------------

test('a position still open at the end of the data is closed as END_OF_DATA', function () {
  var bars = FIXTURES.load('EURUSD', 'M15').slice(0, 300);
  var src = sourceMod.fromBars({ kind: 'eod', datasetVersion: 'eod-v1', data: { EURUSD: { M15: bars } } });
  var lastIndex = bars.length - 1;
  var res = engine.run({
    config: cfg({ backtest: { warmupBars: 10, seed: 's', maxBarsInTrade: 100000 } }),
    source: src,
    label: 'eod',
    logger: loggerMod.nullLogger(),
    decide: function (ctx) {
      // One trade, far from the end, with levels so wide nothing else can close it.
      if (ctx.barIndex !== lastIndex - 5) return null;
      var px = ctx.view.close();
      return {
        decision: 'ENTER', candidateId: 'c-eod', direction: 'LONG', lots: 0.01,
        stopLoss: money.round(px * 0.5, 5), takeProfit: money.round(px * 1.5, 5)
      };
    }
  });
  assert.equal(res.trades.length, 1);
  assert.equal(res.trades[0].exitReason, 'END_OF_DATA');
  assert.equal(res.trades[0].exitTs, bars[lastIndex].ts);
});

test('the time stop closes a position that neither level reaches', function () {
  var res = runWith({
    backtest: { warmupBars: 50, seed: 'time', maxBarsInTrade: 4 }
  }, everyNth({ every: 30, rr: 40, stopPips: 400 }));
  assert.ok(res.trades.length > 0);
  var timed = res.trades.filter(function (t) { return t.exitReason === 'TIME_STOP'; });
  assert.ok(timed.length > 0, 'no time stop fired');
  timed.forEach(function (t) { assert.equal(t.barsHeld, 4); });
});

test('exits are distributed across stop, target and time — not all one branch', function () {
  var res = runWith({ backtest: { warmupBars: 50, seed: 'mix', maxBarsInTrade: 60 } }, everyNth({ every: 12, rr: 1.5 }));
  var reasons = Object.keys(res.metrics.exitReasons);
  assert.ok(reasons.length >= 2, 'only saw ' + reasons.join(', '));
  assert.ok(res.metrics.exitReasons.STOP_LOSS > 0);
});

test('the SKIP intrabar policy leaves ambiguous bars unresolved and says so', function () {
  var res = runWith({
    backtest: { warmupBars: 50, seed: 'skip', allowIntrabarStopAndTarget: 'SKIP', maxBarsInTrade: 30 }
  }, everyNth({ every: 12, rr: 1, stopPips: 4 }));
  // A 4-pip stop with a 4-pip target on M15 bars is ambiguous often.
  assert.ok(res.counts.ambiguousBars > 0, 'expected ambiguous bars with tight symmetric levels');
  var events = res.store.table('system_events').by('kind', 'INTRABAR_AMBIGUOUS');
  assert.equal(events.length, res.counts.ambiguousBars);
});

test('STOP_FIRST and TARGET_FIRST give different answers, which is why the default is pessimistic', function () {
  function go(policy) {
    return runWith({
      backtest: { warmupBars: 50, seed: 'policy', allowIntrabarStopAndTarget: policy, maxBarsInTrade: 30 }
    }, everyNth({ every: 12, rr: 1, stopPips: 4 }));
  }
  var pess = go('STOP_FIRST');
  var opt = go('TARGET_FIRST');
  assert.notEqual(pess.metrics.netPnl, opt.metrics.netPnl);
  assert.ok(opt.metrics.netPnl > pess.metrics.netPnl,
    'the optimistic policy must be the flattering one: ' + opt.metrics.netPnl + ' vs ' + pess.metrics.netPnl);
});

// ---------------------------------------------------------------------------
// 7. Warmup, range, emergency stop, and malformed decisions
// ---------------------------------------------------------------------------

test('no decision is requested before the warmup is satisfied', function () {
  var decide = everyNth({ every: 25 });
  var c = cfg({ backtest: { warmupBars: 120, seed: 's' } });
  engine.run({ config: c, source: window(['EURUSD']), decide: decide, label: 'warm', logger: loggerMod.nullLogger() });
  var minIndex = Math.min.apply(null, decide.seen.map(function (s) { return s.barIndex; }));
  assert.equal(minIndex, 120);
});

test('a range restricts the bars the engine sees', function () {
  var bars = FIXTURES.load('EURUSD', 'M15');
  var res = engine.run({
    config: cfg(), source: FIXTURES, decide: function () { return null; },
    range: { fromTs: bars[100].ts, toTs: bars[400].ts },
    label: 'range', logger: loggerMod.nullLogger()
  });
  assert.equal(res.timeline.bars, 300);
  assert.equal(res.timeline.fromTs, bars[100].ts);
  assert.equal(res.store.table('market_data_meta').last().barCount, 300);
});

test('an emergency stop from the decision context halts every further entry', function () {
  var stoppedAt = null;
  var res = runWith({}, function (ctx) {
    // The first decision at or after bar 200 — not exactly bar 200, because the
    // slot may be occupied on that bar and no decision would be requested.
    if (ctx.barIndex >= 200 && stoppedAt === null) {
      stoppedAt = ctx.barIndex;
      ctx.emergencyStop('TEST_KILL_SWITCH');
      return null;
    }
    if (ctx.barIndex % 20 !== 0) return null;
    var px = ctx.view.close();
    return {
      decision: 'ENTER', candidateId: ctx.ids.next('cand'), direction: 'LONG', lots: 0.01,
      stopLoss: money.round(px * 0.998, 5), takeProfit: money.round(px * 1.004, 5)
    };
  });
  assert.equal(res.emergencyStopped, true);
  assert.equal(res.emergencyReason, 'TEST_KILL_SWITCH');
  var stopEvents = res.store.table('system_events').by('kind', 'EMERGENCY_STOP');
  assert.equal(stopEvents.length, 1, 'the stop is recorded once and cannot be re-armed');
  // Nothing may be entered after the stop — including an entry that had already
  // been decided but not yet filled.
  var bars = window(['EURUSD']).load('EURUSD', 'M15');
  var stopTs = bars[stoppedAt].ts;
  res.trades.forEach(function (t) {
    assert.ok(t.entryTs <= stopTs, 'a trade was entered at or after the emergency stop at bar ' + stoppedAt);
  });
  assert.ok(res.trades.length > 0, 'the run must have traded before the stop, or it proves nothing');
});

test('an emergency stop cancels an entry that has been decided but not filled', function () {
  // The kill switch fires from onBar, which runs on every bar — the place a
  // per-bar Risk Engine check belongs. It lands while the entry decided on the
  // previous bar is still pending, and nothing has been transacted, so the order
  // must be cancelled rather than allowed through.
  var c = cfg();
  var res = engine.run({
    config: c,
    source: window(['EURUSD']),
    label: 'cancel-pending',
    logger: loggerMod.nullLogger(),
    decide: function (ctx) {
      if (ctx.barIndex !== 100) return null;
      var px = ctx.view.close();
      return {
        decision: 'ENTER', candidateId: 'c-pending', direction: 'LONG', lots: 0.01,
        stopLoss: money.round(px * 0.99, 5), takeProfit: money.round(px * 1.01, 5)
      };
    },
    onBar: function (b) {
      if (b.pendingEntry && b.pendingEntry.candidateId === 'c-pending' && !b.emergencyStopped) {
        b.emergencyStop('CANCEL_THE_PENDING_ENTRY');
      }
    }
  });
  assert.equal(res.emergencyStopped, true);
  assert.equal(res.counts.pendingCancelled, 1);
  assert.equal(res.trades.length, 0, 'nothing may be transacted after the kill switch');
  var cancelled = res.store.table('orders').find(function (o) { return o.status === 'CANCELLED'; });
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].rejectReason, 'EMERGENCY_STOP');
  assert.equal(res.store.table('orders').find(function (o) { return o.status === 'FILLED'; }).length, 0);
  assert.equal(res.store.table('system_events').by('kind', 'EMERGENCY_STOP')[0].cancelledPendingEntry, 'c-pending');
  assert.equal(res.slot.isFree(), true, 'the slot must be handed back');
  assert.equal(res.slot.verifyInvariant().ok, true);
});

test('onBar runs on every bar, including while a position is open', function () {
  var seen = [];
  var whileOpen = 0;
  engine.run({
    config: cfg(),
    source: window(['EURUSD']),
    label: 'onbar',
    logger: loggerMod.nullLogger(),
    decide: everyNth({ every: 25 }),
    onBar: function (b) {
      seen.push(b.ts);
      if (b.openPosition) whileOpen++;
    }
  });
  assert.equal(seen.length, 700);
  assert.ok(whileOpen > 0, 'onBar never saw an open position, so a per-bar risk check could not work');
});

test('a malformed ENTER is a programming error and stops the run', function () {
  assert.throws(function () {
    runWith({}, function (ctx) {
      if (ctx.barIndex !== 60) return null;
      return { decision: 'ENTER', candidateId: 'c1', direction: 'LONG', lots: 0.01 }; // no levels
    });
  }, /without "stopLoss"/);

  assert.throws(function () {
    runWith({}, function (ctx) {
      if (ctx.barIndex !== 60) return null;
      return { decision: 'ENTER', candidateId: 'c1', direction: 'LONG', lots: 0, stopLoss: 1, takeProfit: 2 };
    });
  }, /must have lots > 0/);

  assert.throws(function () {
    runWith({}, function (ctx) {
      if (ctx.barIndex !== 60) return null;
      return { decision: 'ENTER', candidateId: 'c1', direction: 'NEUTRAL', lots: 0.01, stopLoss: 1, takeProfit: 2 };
    });
  }, /cannot be NEUTRAL/);
});

test('a decision function that throws stops the run and records why', function () {
  var thrown = null;
  try {
    runWith({}, function (ctx) {
      if (ctx.barIndex === 80) throw new Error('strategy exploded');
      return null;
    });
  } catch (e) { thrown = e; }
  assert.ok(thrown);
  assert.equal(thrown.message, 'strategy exploded');
});

// ---------------------------------------------------------------------------
// 8. The series preparation hook
// ---------------------------------------------------------------------------

test('onSeriesReady lets a strategy register indicators the view can then read', function () {
  var registered = [];
  var seenAtr = [];
  var c = cfg();
  engine.run({
    config: c,
    source: window(['EURUSD']),
    label: 'ind',
    logger: loggerMod.nullLogger(),
    onSeriesReady: function (s) {
      registered.push(s.symbol);
      s.series.addIndicator('atr14', function (series) { return indicators.atr(series.bars(), 14); });
      s.series.addIndicator('volRatio', function (series) { return indicators.volatilityRatio(series.bars(), 5, 50); });
      assert.ok(s.higherSeries, 'a higher-timeframe series must be supplied');
      assert.equal(s.higherSeries.timeframe, c.backtest.higherTimeframe);
    },
    decide: function (ctx) {
      var v = ctx.view.indicator('atr14');
      if (v !== null) seenAtr.push(v);
      // The cost model must pick up the volRatio indicator we registered.
      if (ctx.barIndex === 300) {
        assert.ok(ctx.spreadPips() >= ctx.instrument.typicalSpreadPips);
      }
      return null;
    }
  });
  assert.deepEqual(registered, ['EURUSD']);
  assert.ok(seenAtr.length > 100);
});

test('the higher-timeframe view never shows a bar that has not closed', function () {
  var checks = 0;
  var c = cfg();
  engine.run({
    config: c,
    source: window(['EURUSD']),
    label: 'htf',
    logger: loggerMod.nullLogger(),
    decide: function (ctx) {
      if (ctx.higherView) {
        var hBar = ctx.higherView.current();
        var stepHigher = require(path.join(SRC, 'core', 'clock')).timeframeMinutes(ctx.higherTimeframe) * 60000;
        var baseClose = ctx.ts + 15 * 60000;
        assert.ok(hBar.ts + stepHigher <= baseClose,
          'the H4 bar at ' + new Date(hBar.ts).toISOString() + ' had not closed by ' + new Date(baseClose).toISOString());
        checks++;
      }
      return null;
    }
  });
  assert.ok(checks > 300, 'only checked ' + checks + ' bars');
});
