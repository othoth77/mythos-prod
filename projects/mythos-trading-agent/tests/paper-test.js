'use strict';
// =====================================================
// MYTHOS TRADING AGENT — paper trading tests (mission §18 PHASE 14)
// projects/mythos-trading-agent/tests/paper-test.js
//
// §4 IS THE TEST THAT MATTERS. A paper session over replayed bars must produce the
// same trades, in the same order, at the same prices, as engine.run() over the same
// bars. Paper results are only evidence for a promotion if paper and backtest agree;
// if they ever diverge, that test fails here rather than the difference turning up
// inside a promotion case.
//
// §1 tests the gate: a paper session cannot be created without the mode controller
// being in PAPER, and PAPER is only reachable through a single-use owner-approval
// record bound to the running config and commit. An agent cannot get there.
//
// §2 tests the feed's deliberate poverty — no random access, no reading ahead, and
// a refusal when a tick arrives out of order.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var sessionMod = require(path.join(SRC, 'paper', 'session'));
var feedMod = require(path.join(SRC, 'data', 'feed'));
var paperAdapterMod = require(path.join(SRC, 'execution', 'paper-adapter'));
var modeMod = require(path.join(SRC, 'mode', 'mode-controller'));
var gates = require(path.join(SRC, 'mode', 'gates'));
var tradingAgent = require(path.join(SRC, 'agents', 'trading-agent'));
var engine = require(path.join(SRC, 'backtest', 'engine'));
var configMod = require(path.join(SRC, 'config'));
var fixtureSource = require(path.join(SRC, 'data', 'fixture-source'));
var sourceMod = require(path.join(SRC, 'data', 'source'));
var loggerMod = require(path.join(SRC, 'core', 'logger'));
var errors = require(path.join(SRC, 'core', 'errors'));
var enums = require(path.join(SRC, 'core', 'enums'));
var money = require(path.join(SRC, 'core', 'money'));

var FIXTURES = fixtureSource.createSource();
var OWNER = { kind: 'OWNER', id: 'owner:othman' };
var AGENT = { kind: 'AGENT', id: 'agent:executor' };
var COMMIT = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

/**
 * A mode controller legitimately moved into PAPER.
 *
 * Built by presenting a complete owner-approval record rather than by constructing
 * the controller in PAPER — which the controller refuses anyway. This helper is
 * therefore also a demonstration that the gate is passable when it should be.
 */
function approvedPaperController(cfg) {
  var required = gates.REQUIRED['BACKTEST->PAPER'];
  var evidence = {};
  required.forEach(function (g) { evidence[g] = 'evidence for ' + g + ': see docs/VALIDATION_GATES.md'; });
  var mc = modeMod.create({
    mode: 'BACKTEST',
    configFingerprint: cfg.fingerprint.hash,
    commit: COMMIT,
    logger: loggerMod.nullLogger(),
    now: function () { return 0; }
  });
  mc.transition({
    to: 'PAPER',
    principal: OWNER,
    approval: {
      id: 'approval-paper-test',
      fromMode: 'BACKTEST', toMode: 'PAPER', ownerApproval: true,
      approvedBy: OWNER,
      statement: modeMod.requiredStatement('BACKTEST', 'PAPER'),
      approvedAt: '2026-09-30T12:00:00.000Z',
      configFingerprint: cfg.fingerprint.hash, commit: COMMIT,
      gatesPassed: required.slice(), gateEvidence: evidence
    }
  });
  return mc;
}

function bars(symbol, n, from) {
  return FIXTURES.load(symbol, 'M15').slice(from || 0, (from || 0) + n);
}

/** Matched BACKTEST and PAPER configurations that differ only in `mode`. */
function configPair(over, symbols) {
  var syms = symbols || ['EURUSD'];
  var probe = tradingAgent.create({ config: configMod.load({ universe: syms }) });
  var base = Object.assign({
    universe: syms,
    account: { initialCapital: 5000 },
    backtest: { warmupBars: probe.warmupBars(), seed: 'paper-equivalence' },
    // A FIXED slippage model, because the gaussian one draws from an RNG seeded
    // with the run id, which necessarily differs between the two runs. With a fixed
    // model the cost arithmetic is identical and the comparison is about the engine.
    cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 },
    jev: { scoreThreshold: 40, minConfidence: 0.15 }
  }, over || {});
  return {
    backtest: configMod.load(Object.assign({}, base, { mode: 'BACKTEST' })),
    paper: configMod.load(Object.assign({}, base, { mode: 'PAPER' }))
  };
}

/**
 * The feed takes { SYMBOL: bars[] }; a data source takes { SYMBOL: { M15: bars[] } }.
 * One helper converts, so the two runs are driven from literally the same bars.
 */
function asSourceData(data) {
  var out = {};
  Object.keys(data).forEach(function (s) { out[s] = { M15: data[s] }; });
  return out;
}

function runBacktest(cfg, data) {
  var wired = tradingAgent.wire({ config: cfg, logger: loggerMod.nullLogger() });
  return engine.run({
    config: cfg,
    source: sourceMod.fromBars({ kind: 'eq', datasetVersion: 'eq1', data: asSourceData(data) }),
    label: 'equivalence', logger: loggerMod.nullLogger(),
    decide: wired.engineHooks.decide,
    onRunStart: wired.engineHooks.onRunStart,
    onSeriesReady: wired.engineHooks.onSeriesReady,
    onBar: wired.engineHooks.onBar,
    onTradeClosed: wired.engineHooks.onTradeClosed
  });
}

function runPaper(cfg, data, opts) {
  var o = opts || {};
  var mc = o.modeController || approvedPaperController(cfg);
  var wired = tradingAgent.wire({ config: cfg, logger: loggerMod.nullLogger() });
  var t = 1700000000000;
  var session = sessionMod.create({
    modeController: mc,
    feed: feedMod.replay({ data: data, timeframe: 'M15' }),
    logger: loggerMod.nullLogger(),
    now: function () { return t += 1000; },
    heartbeatEveryTicks: o.heartbeatEveryTicks === undefined ? 100 : o.heartbeatEveryTicks,
    arms: [{ label: o.label || 'main', config: cfg, hooks: wired.engineHooks }]
  });
  return { session: session, result: session.run(o.maxTicks), modeController: mc };
}

/** The fields a trade comparison should be about — not ids or run labels. */
function tradeShape(t) {
  return [
    t.symbol, t.direction, t.entryTs, t.exitTs, t.entryPrice, t.exitPrice,
    t.lots, t.grossPnl, t.costsMoney, t.netPnl, t.outcome, t.exitReason,
    t.regime, t.recoveryLevel, t.barsHeld, t.gapped
  ];
}

// ---------------------------------------------------------------------------
// 1. The gate
// ---------------------------------------------------------------------------

test('a paper session cannot be created outside PAPER mode', function () {
  var cfgs = configPair();
  var backtestController = modeMod.create({ mode: 'BACKTEST' });
  var validFeed = feedMod.replay({ data: { EURUSD: bars('EURUSD', 20) }, timeframe: 'M15' });
  assert.throws(function () {
    sessionMod.create({ modeController: backtestController, feed: validFeed, arms: [] });
  }, function (e) {
    assert.equal(e.code, 'MODE_TRANSITION_REFUSED');
    assert.match(e.message, /cannot be created in BACKTEST mode/);
    assert.match(e.message, /owner-approval record/);
    return true;
  });
  assert.throws(function () { sessionMod.create({ feed: null, arms: [] }); }, /requires a modeController/);
});

test('an agent cannot reach PAPER, so it cannot start a paper session', function () {
  var cfgs = configPair();
  var mc = modeMod.create({ mode: 'BACKTEST', configFingerprint: cfgs.paper.fingerprint.hash, commit: COMMIT });
  assert.throws(function () {
    mc.transition({ to: 'PAPER', principal: AGENT, approval: { ownerApproval: true } });
  }, /only an OWNER principal may raise the execution mode/);
  assert.equal(mc.mode(), 'BACKTEST');
});

test('the paper adapter refuses to exist outside PAPER, and checks on every fill', function () {
  var backtestController = modeMod.create({ mode: 'BACKTEST' });
  assert.throws(function () { paperAdapterMod.create({ modeController: backtestController }); },
    /cannot construct a paper adapter: the platform is in BACKTEST/);
  assert.throws(function () { paperAdapterMod.create({}); }, /requires a modeController/);

  // Constructed in PAPER, then the mode is downgraded underneath it.
  var cfgs = configPair();
  var mc = approvedPaperController(cfgs.paper);
  var adapter = paperAdapterMod.create({ modeController: mc, now: function () { return 1; } });
  assert.equal(adapter.supportsMode('PAPER'), true);
  assert.equal(adapter.supportsMode('BACKTEST'), false, 'paper records must not come from a backtest');
  assert.equal(adapter.supportsMode('LIVE'), false);

  mc.transition({ to: 'BACKTEST', principal: AGENT, reason: 'anomaly' });
  var inst = configMod.load().instrument('EURUSD');
  assert.throws(function () {
    adapter.fill({
      kind: 'ENTRY', instrument: inst, direction: 'LONG', lots: 0.01, requestedPrice: 1.08,
      bar: { ts: 1, open: 1.08, high: 1.081, low: 1.079, close: 1.08, volume: 1 }
    });
  }, /cannot fill an order: the platform is in BACKTEST, not PAPER/,
  'a mode downgrade must stop the adapter, not just block its construction');
});

test('a paper session refuses a configuration whose own mode is not PAPER', function () {
  var cfgs = configPair();
  var mc = approvedPaperController(cfgs.paper);
  var wired = tradingAgent.wire({ config: cfgs.backtest, logger: loggerMod.nullLogger() });
  assert.throws(function () {
    sessionMod.create({
      modeController: mc,
      feed: feedMod.replay({ data: { EURUSD: bars('EURUSD', 20) }, timeframe: 'M15' }),
      arms: [{ label: 'x', config: cfgs.backtest, hooks: wired.engineHooks }]
    });
  }, /a paper session must run a PAPER configuration so its records carry the right mode/);
});

test('a session needs one or two arms, not more', function () {
  var cfgs = configPair();
  var mc = approvedPaperController(cfgs.paper);
  var wired = tradingAgent.wire({ config: cfgs.paper, logger: loggerMod.nullLogger() });
  function attempt(n) {
    var arms = [];
    for (var i = 0; i < n; i++) arms.push({ label: 'a' + i, config: cfgs.paper, hooks: wired.engineHooks });
    return function () {
      sessionMod.create({
        modeController: mc,
        feed: feedMod.replay({ data: { EURUSD: bars('EURUSD', 20) }, timeframe: 'M15' }),
        arms: arms
      });
    };
  }
  assert.throws(attempt(0), /needs one or two arms/);
  assert.throws(attempt(3), /more than two would share one feed between competing accounts/);
});

// ---------------------------------------------------------------------------
// 2. The feed is deliberately poorer than an array
// ---------------------------------------------------------------------------

test('a feed exposes no way to read a bar that has not arrived', function () {
  var f = feedMod.replay({ data: { EURUSD: bars('EURUSD', 50) }, timeframe: 'M15' });
  ['at', 'get', 'slice', 'bars', 'all', 'peekAhead'].forEach(function (banned) {
    assert.equal(f[banned], undefined, 'the feed exposes ' + banned);
  });
  assert.equal(f.length, undefined);
  assert.throws(function () {
    feedMod.assertFeed({
      kind: 'leaky', symbols: function () {}, next: function () {}, isDone: function () {},
      describe: function () {}, slice: function () {}
    });
  }, /would let a consumer read bars that have not arrived/);
});

test('a feed emits one tick per timestamp, grouping simultaneous bars', function () {
  var eur = bars('EURUSD', 10);
  var gbp = bars('GBPUSD', 10);
  var f = feedMod.replay({ data: { EURUSD: eur, GBPUSD: gbp }, timeframe: 'M15' });
  assert.deepEqual(f.symbols(), ['EURUSD', 'GBPUSD']);
  var tick = f.next();
  assert.equal(tick.bars.length, 2, 'two instruments printing at one instant is one tick');
  assert.equal(tick.ts, eur[0].ts);
  tick.bars.forEach(function (b) { assert.equal(b.bar.ts, tick.ts); });
  var n = 1;
  while (f.next() !== null) n++;
  assert.equal(f.isDone(), true);
  assert.equal(n, 10);
  assert.equal(f.next(), null, 'an exhausted feed keeps returning null');
});

test('a guarded feed refuses a tick that goes backwards in time', function () {
  var emitted = 0;
  var b = bars('EURUSD', 5);
  var raw = feedMod.assertFeed({
    kind: 'rewinding',
    symbols: function () { return ['EURUSD']; },
    next: function () {
      emitted++;
      if (emitted === 1) return { ts: b[2].ts, bars: [{ symbol: 'EURUSD', bar: b[2] }] };
      if (emitted === 2) return { ts: b[1].ts, bars: [{ symbol: 'EURUSD', bar: b[1] }] };
      return null;
    },
    isDone: function () { return emitted >= 2; },
    describe: function () { return { kind: 'rewinding' }; }
  });
  var g = feedMod.guarded(raw);
  assert.doesNotThrow(function () { g.next(); });
  assert.throws(function () { g.next(); }, /went backwards/);
});

test('a guarded feed refuses a corrupt bar and a mis-stamped tick', function () {
  var b = bars('EURUSD', 3);
  function feedOf(tick) {
    var done = false;
    return feedMod.guarded(feedMod.assertFeed({
      kind: 'bad', symbols: function () { return ['EURUSD']; },
      next: function () { if (done) return null; done = true; return tick; },
      isDone: function () { return done; }, describe: function () { return { kind: 'bad' }; }
    }));
  }
  var broken = Object.assign({}, b[0], { high: 0.5 });
  assert.throws(function () { feedOf({ ts: b[0].ts, bars: [{ symbol: 'EURUSD', bar: broken }] }).next(); },
    /emitted an invalid EURUSD bar/);
  assert.throws(function () { feedOf({ ts: b[1].ts, bars: [{ symbol: 'EURUSD', bar: b[0] }] }).next(); },
    /in a tick stamped/);
  assert.throws(function () { feedOf({ ts: b[0].ts, bars: [] }).next(); }, /emitted a tick with no bars/);
});

// ---------------------------------------------------------------------------
// 3. A paper session runs
// ---------------------------------------------------------------------------

test('a paper session runs, trades, and marks everything as paper', function () {
  var cfgs = configPair();
  var data = { EURUSD: bars('EURUSD', 700) };
  var run = runPaper(cfgs.paper, data);
  var arm = run.result.arms[0];

  assert.equal(run.result.mode, 'PAPER');
  assert.equal(run.result.paper, true);
  assert.equal(run.result.ticks, 700);
  assert.ok(arm.trades.length > 0, 'the session took no trades at all');

  // Every trade, order and position must be marked so paper evidence can never be
  // mistaken for a backtest.
  arm.trades.forEach(function (t) { assert.equal(t.paper, true); });
  arm.store.table('orders').all().forEach(function (o) { assert.equal(o.paper, true); });
  arm.store.table('positions').all().forEach(function (p) { assert.equal(p.paper, true); });
  var bt = arm.store.table('backtests').last();
  assert.equal(bt.mode, 'PAPER');
  assert.equal(bt.paper, true);
  assert.equal(arm.slot.verifyInvariant().ok, true);
});

test('the session emits heartbeats, which a backtest has no need of', function () {
  var cfgs = configPair();
  var run = runPaper(cfgs.paper, { EURUSD: bars('EURUSD', 400) }, { heartbeatEveryTicks: 100 });
  var hbs = run.session.heartbeats();
  assert.ok(hbs.length >= 4, 'only ' + hbs.length + ' heartbeats');
  hbs.forEach(function (h) {
    assert.ok(h.at > 0);
    assert.ok(h.ticks > 0);
    assert.equal(h.arms.length, 1);
    assert.ok(h.arms[0].equity > 0);
  });
  var arm = run.result.arms[0];
  var checks = arm.store.table('health_checks').by('check', 'PAPER_HEARTBEAT');
  assert.equal(checks.length, hbs.length);
  assert.equal(checks[0].status, 'OK');
});

test('fills record both clocks, so a session falling behind its feed is visible', function () {
  var cfgs = configPair();
  var run = runPaper(cfgs.paper, { EURUSD: bars('EURUSD', 500) });
  var arm = run.result.arms[0];
  var filled = arm.store.table('orders').find(function (o) { return o.status === 'FILLED'; });
  assert.ok(filled.length > 0);
  filled.forEach(function (o) {
    assert.ok(o.wallClockAt > 0, 'a paper fill must record when it was actually computed');
    assert.equal(typeof o.latencyMs, 'number');
  });
  assert.ok(arm.adapterStats.fills > 0);
  assert.equal(typeof arm.adapterStats.maxLatencyMs, 'number');
});

test('the session can be advanced tick by tick', function () {
  var cfgs = configPair();
  var mc = approvedPaperController(cfgs.paper);
  var wired = tradingAgent.wire({ config: cfgs.paper, logger: loggerMod.nullLogger() });
  var t = 1;
  var session = sessionMod.create({
    modeController: mc,
    feed: feedMod.replay({ data: { EURUSD: bars('EURUSD', 30) }, timeframe: 'M15' }),
    logger: loggerMod.nullLogger(),
    now: function () { return t++; },
    heartbeatEveryTicks: 0,
    arms: [{ label: 'main', config: cfgs.paper, hooks: wired.engineHooks }]
  });
  assert.equal(session.ticks(), 0);
  assert.ok(session.tick() !== null);
  assert.equal(session.ticks(), 1);
  for (var i = 0; i < 29; i++) session.tick();
  assert.equal(session.ticks(), 30);
  assert.equal(session.tick(), null, 'an exhausted feed ends the session');
  var res = session.finish();
  assert.equal(res.ticks, 30);
});

test('run(maxTicks) stops early and still closes cleanly', function () {
  var cfgs = configPair();
  var run = runPaper(cfgs.paper, { EURUSD: bars('EURUSD', 700) }, { maxTicks: 300 });
  assert.equal(run.result.ticks, 300);
  var arm = run.result.arms[0];
  assert.equal(arm.slot.isFree(), true, 'a session that stops early must not leave the slot held');
  assert.equal(arm.slot.verifyInvariant().ok, true);
});

// ---------------------------------------------------------------------------
// 4. EQUIVALENCE — the test this phase exists for
// ---------------------------------------------------------------------------

test('a paper session produces the SAME trades as the backtest engine over the same bars', function () {
  var cfgs = configPair();
  var data = { EURUSD: bars('EURUSD', 700) };

  var bt = runBacktest(cfgs.backtest, data);
  var paper = runPaper(cfgs.paper, data).result.arms[0];

  assert.ok(bt.trades.length > 5, 'the comparison needs trades; got ' + bt.trades.length);
  assert.equal(
    paper.trades.length, bt.trades.length,
    'paper took ' + paper.trades.length + ' trades and the backtest took ' + bt.trades.length
  );
  assert.deepEqual(
    paper.trades.map(tradeShape),
    bt.trades.map(tradeShape),
    'paper and backtest diverged. Paper results are only evidence for a promotion if the two agree, so this ' +
    'is a defect in one of the two loops rather than an acceptable difference.'
  );

  // The derived metrics must therefore agree too.
  assert.equal(paper.metrics.netPnl, bt.metrics.netPnl);
  assert.equal(paper.metrics.maxDrawdownPct, bt.metrics.maxDrawdownPct);
  assert.equal(paper.metrics.maxConsecutiveLosses, bt.metrics.maxConsecutiveLosses);
  assert.equal(paper.metrics.totalCosts, bt.metrics.totalCosts);
  assert.equal(paper.metrics.expectancy, bt.metrics.expectancy);
});

test('equivalence holds across three instruments, where symbol ordering matters', function () {
  // With one global trade slot, the order simultaneous candidates are considered in
  // decides which one is taken. The paper session must use the config's universe
  // order, not alphabetical, or multi-asset runs diverge for a reason that has
  // nothing to do with the market.
  var syms = ['XAUUSD', 'EURUSD', 'USDJPY'];   // deliberately not alphabetical
  var cfgs = configPair({ account: { initialCapital: 20000 } }, syms);
  var data = {};
  syms.forEach(function (s) { data[s] = bars(s, 500); });

  var bt = runBacktest(cfgs.backtest, data);
  var paper = runPaper(cfgs.paper, data).result.arms[0];

  assert.ok(bt.trades.length > 5);
  var traded = {};
  bt.trades.forEach(function (t) { traded[t.symbol] = true; });
  assert.ok(Object.keys(traded).length > 1, 'only ' + Object.keys(traded) + ' traded');
  assert.deepEqual(paper.trades.map(tradeShape), bt.trades.map(tradeShape));
});

test('equivalence holds with recovery enabled, where sizing is path-dependent', function () {
  var cfgs = configPair({
    account: { initialCapital: 3000 },
    recovery: { enabled: true, maxRecoveryLevel: 2 }
  });
  var data = { EURUSD: bars('EURUSD', 600) };
  var bt = runBacktest(cfgs.backtest, data);
  var paper = runPaper(cfgs.paper, data).result.arms[0];
  assert.ok(bt.trades.length > 5);
  assert.deepEqual(paper.trades.map(tradeShape), bt.trades.map(tradeShape));
  // And the ladder must have moved, or the test proves nothing about recovery.
  var levels = bt.trades.map(function (t) { return t.recoveryLevel; });
  assert.ok(Math.max.apply(null, levels) >= 1, 'recovery never advanced, so path dependence was not exercised');
});

test('a documented divergence: only the backtest can know there is no future bar', function () {
  // The engine records NO_TRADE/EXECUTION for a signal on the final bar because it
  // can see there is no later bar. A live feed cannot know that, so the paper
  // session creates a pending entry and cancels it when the session ends. No trade
  // results either way — the difference is in the records, and it is recorded here
  // rather than left for someone to discover.
  var cfgs = configPair();
  var data = { EURUSD: bars('EURUSD', 400) };
  var paper = runPaper(cfgs.paper, data).result.arms[0];
  var cancelled = paper.store.table('orders').find(function (o) {
    return o.status === 'CANCELLED' && o.rejectReason === 'SESSION_ENDED_PENDING';
  });
  assert.ok(cancelled.length <= 1, 'at most one entry can be pending when a session ends');
  assert.equal(paper.counts.pendingCancelled, cancelled.length);
});

// ---------------------------------------------------------------------------
// 5. A/B — mission §12's DEMO A/B
// ---------------------------------------------------------------------------

test('two arms see identical ticks and keep separate accounts', function () {
  var syms = ['EURUSD'];
  var probe = tradingAgent.create({ config: configMod.load({ universe: syms }) });
  function cfgFor(threshold) {
    return configMod.load({
      mode: 'PAPER', universe: syms, account: { initialCapital: 5000 },
      backtest: { warmupBars: probe.warmupBars(), seed: 'ab' },
      cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 },
      jev: { scoreThreshold: threshold, minConfidence: 0.15 }
    });
  }
  var champion = cfgFor(40);
  var challenger = cfgFor(70);
  var mc = approvedPaperController(champion);
  var t = 1;
  var session = sessionMod.create({
    modeController: mc,
    feed: feedMod.replay({ data: { EURUSD: bars('EURUSD', 700) }, timeframe: 'M15' }),
    logger: loggerMod.nullLogger(),
    now: function () { return t += 1000; },
    heartbeatEveryTicks: 200,
    arms: [
      { label: 'champion', config: champion, hooks: tradingAgent.wire({ config: champion, logger: loggerMod.nullLogger() }).engineHooks },
      { label: 'challenger', config: challenger, hooks: tradingAgent.wire({ config: challenger, logger: loggerMod.nullLogger() }).engineHooks }
    ]
  });
  var res = session.run();

  assert.equal(res.arms.length, 2);
  assert.deepEqual(session.arms(), ['champion', 'challenger']);
  var a = res.arms[0], b = res.arms[1];
  assert.notEqual(a.configHash, b.configHash);
  assert.notEqual(a.store.runId, b.store.runId, 'each arm must keep its own store');
  assert.ok(a.trades.length > 0);
  // The stricter Jev threshold must trade less.
  assert.ok(b.trades.length < a.trades.length,
    'champion took ' + a.trades.length + ' and the stricter challenger took ' + b.trades.length);

  var c = res.comparison;
  assert.ok(c);
  assert.equal(c.armA, 'champion');
  assert.equal(c.armB, 'challenger');
  assert.equal(c.sameFeed, true);
  assert.equal(typeof c.netPnlDelta, 'number');
  assert.equal(c.tradeCountA, a.metrics.tradeCount);
  assert.equal(c.tradeCountB, b.metrics.tradeCount);
  assert.match(c.note, /does NOT call a winner/);
  assert.match(c.note, /Champion\/Challenger gate/);
});

test('a single-arm session reports no comparison', function () {
  var cfgs = configPair();
  var run = runPaper(cfgs.paper, { EURUSD: bars('EURUSD', 300) });
  assert.equal(run.result.comparison, null, 'there is nothing to compare one arm against');
});

test('each arm records its own one-trade-only invariant', function () {
  var syms = ['EURUSD', 'GBPUSD'];
  var probe = tradingAgent.create({ config: configMod.load({ universe: syms }) });
  var cfg = configMod.load({
    mode: 'PAPER', universe: syms, account: { initialCapital: 20000 },
    backtest: { warmupBars: probe.warmupBars(), seed: 'ab2' },
    cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 },
    jev: { scoreThreshold: 40, minConfidence: 0.15 }
  });
  var mc = approvedPaperController(cfg);
  var t = 1;
  var data = { EURUSD: bars('EURUSD', 500), GBPUSD: bars('GBPUSD', 500) };
  var session = sessionMod.create({
    modeController: mc,
    feed: feedMod.replay({ data: data, timeframe: 'M15' }),
    logger: loggerMod.nullLogger(),
    now: function () { return t += 1000; },
    heartbeatEveryTicks: 0,
    arms: [
      { label: 'a', config: cfg, hooks: tradingAgent.wire({ config: cfg, logger: loggerMod.nullLogger() }).engineHooks },
      { label: 'b', config: cfg, hooks: tradingAgent.wire({ config: cfg, logger: loggerMod.nullLogger() }).engineHooks }
    ]
  });
  var res = session.run();
  res.arms.forEach(function (arm) {
    assert.equal(arm.slot.verifyInvariant().ok, true, 'arm ' + arm.label + ' broke the one-trade invariant');
    // Reconstruct occupancy from the stored positions, per arm.
    var events = [];
    arm.store.table('positions').all().forEach(function (p) {
      events.push({ ts: p.status === 'OPEN' ? p.entryTs : p.exitTs, delta: p.status === 'OPEN' ? 1 : -1 });
    });
    events.sort(function (x, y) { return x.ts - y.ts || y.delta - x.delta; });
    var open = 0;
    events.forEach(function (e) {
      open += e.delta;
      assert.ok(open <= 1, 'arm ' + arm.label + ' had two positions open at once');
      assert.ok(open >= 0);
    });
  });
  // Two identical arms on one feed must produce identical trades.
  assert.deepEqual(res.arms[0].trades.map(tradeShape), res.arms[1].trades.map(tradeShape));
  assert.equal(res.comparison.netPnlDelta, 0, 'identical arms cannot differ');
});

// ---------------------------------------------------------------------------
// 6. Safety inside a running session
// ---------------------------------------------------------------------------

test('an emergency stop inside a paper session halts further entries', function () {
  var cfgs = configPair({ account: { initialCapital: 100 }, risk: { maxDrawdownPct: 3, maxDailyLossPct: 3 } });
  var run = runPaper(cfgs.paper, { EURUSD: bars('EURUSD', 1200) });
  var arm = run.result.arms[0];
  if (arm.emergencyStopped) {
    assert.match(arm.emergencyReason, /RISK_ENGINE/);
    var stops = arm.store.table('system_events').by('kind', 'EMERGENCY_STOP');
    assert.equal(stops.length, 1, 'the stop must be recorded once');
    assert.equal(stops[0].arm, 'main');
  } else {
    assert.ok(arm.metrics.maxDrawdownPct < 3.001,
      'the session was not stopped but the drawdown reached ' + arm.metrics.maxDrawdownPct + '%');
  }
});

test('a decision layer that throws stops the session and records why', function () {
  var cfgs = configPair();
  var mc = approvedPaperController(cfgs.paper);
  var thrown = null;
  var session = sessionMod.create({
    modeController: mc,
    feed: feedMod.replay({ data: { EURUSD: bars('EURUSD', 400) }, timeframe: 'M15' }),
    logger: loggerMod.nullLogger(),
    now: function () { return 1; },
    heartbeatEveryTicks: 0,
    arms: [{
      label: 'boom', config: cfgs.paper,
      hooks: { decide: function (ctx) { if (ctx.barIndex > 300) throw new Error('strategy exploded'); return null; } }
    }]
  });
  try { session.run(); } catch (e) { thrown = e; }
  assert.ok(thrown);
  assert.equal(thrown.message, 'strategy exploded');
  var arm = session.arm('boom');
  var events = arm.store.table('system_events').by('kind', 'DECIDE_THREW');
  assert.equal(events.length, 1);
  assert.equal(events[0].arm, 'boom');
});

test('a malformed ENTER is refused in a paper session too', function () {
  var cfgs = configPair();
  var mc = approvedPaperController(cfgs.paper);
  var session = sessionMod.create({
    modeController: mc,
    feed: feedMod.replay({ data: { EURUSD: bars('EURUSD', 300) }, timeframe: 'M15' }),
    logger: loggerMod.nullLogger(), now: function () { return 1; }, heartbeatEveryTicks: 0,
    arms: [{
      label: 'bad', config: cfgs.paper,
      hooks: {
        decide: function (ctx) {
          if (ctx.barIndex !== 250) return null;
          return { decision: 'ENTER', candidateId: 'c1', direction: 'LONG', lots: 0.01 };
        }
      }
    }]
  });
  assert.throws(function () { session.run(); }, /without "stopLoss"/);
});

test('the paper adapter never places an order anywhere, and says so', function () {
  var cfgs = configPair();
  var mc = approvedPaperController(cfgs.paper);
  var d = paperAdapterMod.create({ modeController: mc, now: function () { return 1; } }).describe();
  assert.equal(d.placesRealOrders, false);
  assert.match(d.note, /No order reaches any venue/);
  assert.match(d.note, /LIVE adapter refuses/);
});
