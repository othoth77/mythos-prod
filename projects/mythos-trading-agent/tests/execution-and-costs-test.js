'use strict';
// =====================================================
// MYTHOS TRADING AGENT — cost, account, slot, adapter and metric tests
// projects/mythos-trading-agent/tests/execution-and-costs-test.js
//
// The claims under test, each of which a later phase relies on:
//
//   §1 costs are never favourable and never invisible — slippage cannot be
//      negative, the spread is bounded by the instrument's stated maximum, and
//      the pre-trade estimate assumes the trade dies on its stop rather than
//      reaching its target;
//   §2 drawdown is measured on mark-to-market equity, so it can fire while a
//      losing position is still open, and a breakeven breaks no streak;
//   §3 the one-trade slot is occupied while an entry is merely pending, and
//      every illegal transition throws rather than being tolerated;
//   §4 a bar that gaps through a stop fills at the OPEN, not at the stop, and a
//      bar containing both stop and target resolves by the configured policy;
//   §5 the LIVE adapter refuses every call, including the read-only-looking ones;
//   §6 metrics report gross, costs and net separately and never invent an
//      infinite profit factor from a sample with no losses.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var config = require(path.join(SRC, 'config'));
var costModelMod = require(path.join(SRC, 'cost', 'model'));
var accountMod = require(path.join(SRC, 'account', 'account'));
var slotMod = require(path.join(SRC, 'account', 'one-trade-controller'));
var backtestAdapter = require(path.join(SRC, 'execution', 'backtest-adapter'));
var liveAdapter = require(path.join(SRC, 'execution', 'live-adapter'));
var adapterMod = require(path.join(SRC, 'execution', 'adapter'));
var metricsMod = require(path.join(SRC, 'backtest', 'metrics'));
var instrumentMod = require(path.join(SRC, 'core', 'instrument'));
var rngMod = require(path.join(SRC, 'core', 'rng'));
var loggerMod = require(path.join(SRC, 'core', 'logger'));
var errors = require(path.join(SRC, 'core', 'errors'));
var enums = require(path.join(SRC, 'core', 'enums'));
var clock = require(path.join(SRC, 'core', 'clock'));
var money = require(path.join(SRC, 'core', 'money'));

var CATALOG = instrumentMod.defaultCatalog();
var EUR = CATALOG.get('EURUSD');
var GOLD = CATALOG.get('XAUUSD');
var LONDON = Date.parse('2024-01-03T10:00:00Z'); // a Wednesday, main session

function fixedCostModel(over) {
  var cfg = config.load({
    cost: Object.assign({
      spreadModel: 'instrument-typical',
      slippageModel: 'fixed',
      fixedSlippagePips: 0.3
    }, over || {})
  });
  return { model: costModelMod.create(cfg), config: cfg };
}

// ---------------------------------------------------------------------------
// 1. Cost model
// ---------------------------------------------------------------------------

test('the spread widens at rollover and on the Sunday reopen', function () {
  var m = fixedCostModel().model;
  var main = m.spreadPips(EUR, { ts: LONDON });
  var rollover = m.spreadPips(EUR, { ts: Date.parse('2024-01-03T21:30:00Z') });
  var sunday = m.spreadPips(EUR, { ts: Date.parse('2024-01-07T22:00:00Z') });
  var asia = m.spreadPips(EUR, { ts: Date.parse('2024-01-03T03:00:00Z') });
  assert.equal(main, EUR.typicalSpreadPips);
  assert.ok(rollover > main, 'rollover ' + rollover + ' should exceed main-session ' + main);
  assert.ok(sunday >= rollover, 'the Sunday reopen is the widest hour of the week');
  assert.ok(asia > main && asia < rollover);
});

test('the spread never leaves the instrument instrument-stated bounds', function () {
  var m = fixedCostModel().model;
  // An extreme volatility ratio must not push the spread past maxSpreadPips,
  // because the Risk Engine's MAX_SPREAD limit is expressed against that number.
  var wild = m.spreadPips(GOLD, { ts: Date.parse('2024-01-07T22:00:00Z'), volatilityRatio: 99 });
  assert.equal(wild, GOLD.maxSpreadPips);
  var calm = m.spreadPips(GOLD, { ts: LONDON, volatilityRatio: 0.01 });
  assert.ok(calm >= GOLD.typicalSpreadPips);
});

test('the fixed and bar-derived spread models behave as declared', function () {
  var fixed = costModelMod.create(config.load({ cost: { spreadModel: 'fixed', fixedSpreadPips: 2.5, slippageModel: 'none' } }));
  assert.equal(fixed.spreadPips(EUR, { ts: LONDON }), 2.5);

  var derived = costModelMod.create(config.load({ cost: { spreadModel: 'bar-derived', slippageModel: 'none' } }));
  // 15 % of a 40-pip bar is 6 pips, above the 1.2-pip typical → 6, clamped by max 3.5
  assert.equal(derived.spreadPips(EUR, { ts: LONDON, barRangePips: 40 }), EUR.maxSpreadPips);
  // A quiet bar falls back to the typical spread, never below it.
  assert.equal(derived.spreadPips(EUR, { ts: LONDON, barRangePips: 2 }), EUR.typicalSpreadPips);
});

test('slippage is never favourable, and a resting target never slips', function () {
  var m = costModelMod.create(
    config.load({ cost: { slippageModel: 'gaussian' } }),
    { rng: rngMod.create('slip') }
  );
  for (var i = 0; i < 500; i++) {
    var entry = m.slippagePips(EUR, 'ENTRY');
    var stop = m.slippagePips(EUR, 'STOP');
    assert.ok(entry >= 0, 'entry slippage was negative: ' + entry);
    assert.ok(stop >= 0);
    assert.ok(entry <= EUR.slippagePips.max);
    assert.ok(stop <= EUR.slippagePips.max * 1.6);
    assert.equal(m.slippagePips(EUR, 'TARGET'), 0, 'a limit order fills at its price or better');
  }
});

test('stops slip harder than entries, on average', function () {
  var m = costModelMod.create(
    config.load({ cost: { slippageModel: 'gaussian' } }),
    { rng: rngMod.create('slip-compare') }
  );
  var entrySum = 0, stopSum = 0;
  for (var i = 0; i < 4000; i++) {
    entrySum += m.slippagePips(EUR, 'ENTRY');
    stopSum += m.slippagePips(EUR, 'STOP');
  }
  assert.ok(stopSum > entrySum * 1.3, 'stops must be modelled as slipping more: ' + stopSum + ' vs ' + entrySum);
});

test('the gaussian slippage model refuses to run without a seeded RNG', function () {
  assert.throws(function () { costModelMod.create(config.load({ cost: { slippageModel: 'gaussian' } })); },
    /needs a seeded RNG/);
});

test('commission is charged on both sides and can be switched off', function () {
  var inst = instrumentMod.define(Object.assign({}, EUR, { commissionPerLotPerSide: 3.5 }));
  var on = fixedCostModel().model;
  assert.equal(on.commissionMoney(inst, 1), 7, 'both sides of one lot');
  assert.equal(on.commissionMoney(inst, 0.01), 0.07);
  var off = costModelMod.create(config.load({ cost: { includeCommission: false, slippageModel: 'none' } }));
  assert.equal(off.commissionMoney(inst, 1), 0);
});

test('swap is returned as a COST, so a positive carry is negative', function () {
  var m = fixedCostModel().model;
  // EURUSD: long carry is -1.4/lot/day (a charge) → cost is +1.4 per lot per night
  assert.equal(m.swapMoney(EUR, 'LONG', 1, 1), 1.4);
  // short carry is +0.4/lot/day (earned) → cost is negative
  assert.equal(m.swapMoney(EUR, 'SHORT', 1, 1), -0.4);
  assert.equal(m.swapMoney(EUR, 'LONG', 0.01, 3), money.money(1.4 * 0.01 * 3));
  assert.equal(m.swapMoney(EUR, 'LONG', 1, 0), 0, 'no nights, no swap');
  var off = costModelMod.create(config.load({ cost: { includeSwap: false, slippageModel: 'none' } }));
  assert.equal(off.swapMoney(EUR, 'LONG', 1, 5), 0);
});

test('nightsHeld counts the rollovers actually crossed', function () {
  var m = fixedCostModel().model; // swapChargeHoursUtc = 21
  var entry = Date.parse('2024-01-03T10:00:00Z');
  assert.equal(m.nightsHeld(entry, Date.parse('2024-01-03T20:00:00Z')), 0, 'closed before the rollover');
  assert.equal(m.nightsHeld(entry, Date.parse('2024-01-03T21:00:00Z')), 1, 'the rollover instant counts');
  assert.equal(m.nightsHeld(entry, Date.parse('2024-01-04T22:00:00Z')), 2);
  assert.equal(m.nightsHeld(entry, entry), 0);
  assert.equal(m.nightsHeld(entry, entry - 1000), 0, 'an exit before the entry is not negative nights');
});

test('roundTrip sums its own components exactly', function () {
  var m = fixedCostModel().model;
  var rt = m.roundTrip({
    instrument: EUR, direction: 'LONG', lots: 0.01, price: 1.08,
    spreadPips: 1.2, entrySlippagePips: 0.3, exitSlippagePips: 0.5, nights: 2
  });
  // pip value per lot = $10, so 0.01 lots = $0.10 per pip
  assert.equal(rt.spreadMoney, 0.12);
  assert.equal(rt.commissionMoney, 0);
  assert.equal(rt.slippagePips, 0.8);
  assert.equal(rt.slippageMoney, 0.08);
  assert.equal(rt.swapMoney, money.money(1.4 * 0.01 * 2));
  assert.equal(rt.totalMoney, money.money(0.12 + 0 + 0.08 + 1.4 * 0.01 * 2));
});

test('the pre-trade estimate assumes the stop, not the target', function () {
  var m = costModelMod.create(config.load({ cost: { slippageModel: 'gaussian' } }), { rng: rngMod.create('est') });
  var est = m.estimate({ instrument: EUR, direction: 'LONG', lots: 0.01, price: 1.08, spreadPips: 1.2 });
  // entry slip = mean (0.2), exit slip = mean * 1.6 (0.32) → 0.52 pips total
  assert.equal(est.slippagePips, money.round(EUR.slippagePips.mean * 2.6, 10));
  assert.ok(est.totalMoney > 0);
  // Deterministic: the estimate must not consume a random draw.
  var again = m.estimate({ instrument: EUR, direction: 'LONG', lots: 0.01, price: 1.08, spreadPips: 1.2 });
  assert.deepEqual(again, est);
});

test('cost on a $100 account is a material share of a minimum-size trade', function () {
  // Not a behaviour assertion — a documented scale check. If this ever stops
  // being true the cost model has drifted, and docs/COMPLIANCE_AND_RISK.md §3.1
  // would need revising.
  var m = fixedCostModel().model;
  var rt = m.roundTrip({
    instrument: EUR, direction: 'LONG', lots: 0.01, price: 1.08,
    spreadPips: EUR.typicalSpreadPips, entrySlippagePips: 0.3, exitSlippagePips: 0.5, nights: 0
  });
  var riskOn20Pips = instrumentMod.riskMoneyForLots(EUR, 0.01, 20, 1.08); // $2
  assert.ok(rt.totalMoney / riskOn20Pips > 0.05,
    'round-trip cost is ' + rt.totalMoney + ' against $' + riskOn20Pips + ' of risk');
});

// ---------------------------------------------------------------------------
// 2. Account
// ---------------------------------------------------------------------------

function acct() {
  return accountMod.create({ initialCapital: 100 });
}

test('an account starts flat with no drawdown', function () {
  var a = acct();
  assert.equal(a.balance(), 100);
  assert.equal(a.equity(), 100);
  assert.equal(a.drawdownPct(), 0);
  assert.equal(a.tradeCount(), 0);
  assert.throws(function () { accountMod.create({ initialCapital: 0 }); }, /must be > 0/);
});

test('drawdown is measured on equity, so it fires while a position is still open', function () {
  var a = acct();
  a.markToMarket(LONDON, 0, 0);
  a.markToMarket(LONDON + 1000, -8, 2);   // open loss, nothing closed
  assert.equal(a.balance(), 100, 'balance is untouched by an open position');
  assert.equal(a.equity(), 92);
  assert.equal(a.drawdownPct(), 8);
  assert.equal(a.maxDrawdownPct(), 8);
  a.markToMarket(LONDON + 2000, 0, 0);    // recovered
  assert.equal(a.drawdownPct(), 0);
  assert.equal(a.maxDrawdownPct(), 8, 'the maximum is remembered');
});

test('the equity peak only moves up, so drawdown is measured from the high water mark', function () {
  var a = acct();
  a.markToMarket(1, 10, 0);   // equity 110
  assert.equal(a.peakEquity(), 110);
  a.markToMarket(2, -5, 0);   // equity 95
  assert.equal(a.peakEquity(), 110);
  assert.equal(a.drawdownPct(), money.round((15 / 110) * 100, 6));
});

test('applyTrade moves the balance, the streaks and the daily bucket', function () {
  var a = acct();
  a.applyTrade({ ts: LONDON, netPnl: -2, grossPnl: -1.8, costsMoney: 0.2, outcome: 'LOSS' });
  a.applyTrade({ ts: LONDON + 1, netPnl: -2, grossPnl: -1.8, costsMoney: 0.2, outcome: 'LOSS' });
  assert.equal(a.balance(), 96);
  assert.equal(a.consecutiveLosses(), 2);
  assert.equal(a.dailyLossMoney(LONDON), 4);
  assert.equal(a.dailyLossPct(LONDON), 4);

  a.applyTrade({ ts: LONDON + 2, netPnl: 5, grossPnl: 5.2, costsMoney: 0.2, outcome: 'WIN' });
  assert.equal(a.consecutiveLosses(), 0, 'a win resets the streak');
  assert.equal(a.maxConsecutiveLosses(), 2, 'the worst streak is remembered');
  assert.equal(a.dailyNet(LONDON), 1);
  assert.equal(a.dailyLossMoney(LONDON), 0, 'a positive day has no loss');
});

test('a breakeven trade breaks neither streak', function () {
  var a = acct();
  a.applyTrade({ ts: LONDON, netPnl: -1, grossPnl: -0.8, costsMoney: 0.2, outcome: 'LOSS' });
  a.applyTrade({ ts: LONDON + 1, netPnl: 0, grossPnl: 0.2, costsMoney: 0.2, outcome: 'BREAKEVEN' });
  a.applyTrade({ ts: LONDON + 2, netPnl: -1, grossPnl: -0.8, costsMoney: 0.2, outcome: 'LOSS' });
  assert.equal(a.consecutiveLosses(), 2,
    'a scratch in the middle must not reset a genuine losing streak');
  assert.equal(a.breakevens(), 1);
});

test('the daily bucket is keyed on the UTC day of the exit', function () {
  var a = acct();
  a.applyTrade({ ts: Date.parse('2024-01-03T23:59:00Z'), netPnl: -3, grossPnl: -3, costsMoney: 0, outcome: 'LOSS' });
  a.applyTrade({ ts: Date.parse('2024-01-04T00:01:00Z'), netPnl: -4, grossPnl: -4, costsMoney: 0, outcome: 'LOSS' });
  assert.equal(a.dailyLossMoney(Date.parse('2024-01-03T12:00:00Z')), 3);
  assert.equal(a.dailyLossMoney(Date.parse('2024-01-04T12:00:00Z')), 4);
});

test('the snapshot carries everything the Risk Engine needs', function () {
  var a = acct();
  a.applyTrade({ ts: LONDON, netPnl: -5, grossPnl: -4.8, costsMoney: 0.2, outcome: 'LOSS' });
  var s = a.snapshot();
  ['initialCapital', 'balance', 'equity', 'peakEquity', 'drawdownPct', 'maxDrawdownPct',
    'consecutiveLosses', 'maxConsecutiveLosses', 'tradeCount', 'netProfit', 'returnPct', 'totalCosts'
  ].forEach(function (f) {
    assert.ok(s[f] !== undefined, 'snapshot is missing ' + f);
  });
  assert.equal(s.balance, 95);
  assert.equal(s.netProfit, -5);
  assert.equal(s.returnPct, -5);
  assert.equal(s.totalCosts, 0.2);
});

test('the account records an equity sample on every mark', function () {
  var a = acct();
  a.markToMarket(1, 0, 0);
  a.markToMarket(2, -1, 2);
  var curve = a.equityCurve();
  assert.equal(curve.length, 2);
  assert.equal(curve[1].equity, 99);
  assert.equal(curve[1].openRisk, 2);
  assert.equal(curve[1].drawdownPct, 1);
});

// ---------------------------------------------------------------------------
// 3. One-trade-only slot
// ---------------------------------------------------------------------------

test('the slot walks FREE → RESERVED → OCCUPIED → FREE', function () {
  var s = slotMod.create();
  assert.equal(s.state(), 'FREE');
  s.reserve({ candidateId: 'c1', symbol: 'EURUSD' }, 1);
  assert.equal(s.state(), 'RESERVED');
  assert.equal(s.isFree(), false, 'a pending entry occupies the slot');
  s.occupy({ positionId: 'p1', candidateId: 'c1', symbol: 'EURUSD' }, 2);
  assert.equal(s.state(), 'OCCUPIED');
  assert.equal(s.openPosition().positionId, 'p1');
  s.release('TAKE_PROFIT', 3);
  assert.equal(s.state(), 'FREE');
  assert.equal(s.openPosition(), null);
  assert.equal(s.verifyInvariant().ok, true);
});

test('a second candidate cannot reserve an occupied slot', function () {
  var s = slotMod.create();
  s.reserve({ candidateId: 'c1', symbol: 'EURUSD' }, 1);
  assert.throws(function () { s.reserve({ candidateId: 'c2', symbol: 'XAUUSD' }, 1); },
    /cannot reserve the slot for c2 while it is RESERVED/);
  s.occupy({ positionId: 'p1', candidateId: 'c1', symbol: 'EURUSD' }, 2);
  assert.throws(function () { s.reserve({ candidateId: 'c3', symbol: 'GBPUSD' }, 2); },
    /while it is OCCUPIED/);
});

test('a position cannot occupy a slot reserved for a different candidate', function () {
  var s = slotMod.create();
  s.reserve({ candidateId: 'c1', symbol: 'EURUSD' }, 1);
  assert.throws(function () { s.occupy({ positionId: 'p9', candidateId: 'c9', symbol: 'EURUSD' }, 2); },
    /reserved for c1 but c9 tried to occupy it/);
});

test('occupying without reserving, and releasing a free slot, both throw', function () {
  var s = slotMod.create();
  assert.throws(function () { s.occupy({ positionId: 'p1', symbol: 'EURUSD' }, 1); },
    /may only occupy the slot from RESERVED/);
  assert.throws(function () { s.release('nothing', 1); }, /already FREE/);
});

test('a cancelled reservation releases the slot cleanly', function () {
  var s = slotMod.create();
  s.reserve({ candidateId: 'c1', symbol: 'EURUSD' }, 1);
  assert.equal(s.release('ENTRY_REJECTED', 2), 'RESERVED');
  assert.equal(s.isFree(), true);
  assert.equal(s.verifyInvariant().ok, true);
});

test('blocked candidates are counted so the cost of one-trade-only is visible', function () {
  var s = slotMod.create();
  s.reserve({ candidateId: 'c1', symbol: 'EURUSD' }, 1);
  s.noteBlocked(); s.noteBlocked();
  assert.equal(s.blockedCount(), 2);
});

// ---------------------------------------------------------------------------
// 4. Backtest adapter fills
// ---------------------------------------------------------------------------

function bar(o, h, l, c, ts) {
  return { ts: ts === undefined ? LONDON : ts, open: o, high: h, low: l, close: c, volume: 1 };
}

test('an entry fills at the bar open and nothing else', function () {
  var a = backtestAdapter.create();
  var b = bar(1.08, 1.0850, 1.0790, 1.0830);
  var ok = a.fill({ kind: 'ENTRY', instrument: EUR, direction: 'LONG', lots: 0.01, requestedPrice: 1.08, bar: b });
  assert.equal(ok.status, 'FILLED');
  assert.equal(ok.price, 1.08);

  var bad = a.fill({ kind: 'ENTRY', instrument: EUR, direction: 'LONG', lots: 0.01, requestedPrice: 1.0830, bar: b });
  assert.equal(bad.status, 'REJECTED');
  assert.match(bad.detail, /must execute at the bar open/);
});

test('a stop inside the bar fills at the stop; a gap through it fills at the open', function () {
  var pos = { direction: 'LONG', stopLoss: 1.0800, takeProfit: 1.0900 };
  var a = backtestAdapter.create();

  var touched = a.evaluateExit(pos, bar(1.0850, 1.0860, 1.0795, 1.0840));
  assert.equal(touched.kind, 'STOP');
  assert.equal(touched.price, 1.0800, 'a touched stop fills at the stop');
  assert.equal(touched.gapped, false);

  var gapped = a.evaluateExit(pos, bar(1.0760, 1.0770, 1.0750, 1.0765));
  assert.equal(gapped.kind, 'STOP');
  assert.equal(gapped.price, 1.0760, 'the market was already through the stop at the open');
  assert.equal(gapped.gapped, true);
  assert.ok(gapped.price < pos.stopLoss, 'a gap must be WORSE than the stop, not equal to it');
});

test('a short position gaps the other way', function () {
  var pos = { direction: 'SHORT', stopLoss: 1.0900, takeProfit: 1.0800 };
  var a = backtestAdapter.create();
  var gapped = a.evaluateExit(pos, bar(1.0950, 1.0960, 1.0940, 1.0955));
  assert.equal(gapped.kind, 'STOP');
  assert.equal(gapped.price, 1.0950);
  assert.equal(gapped.gapped, true);
  assert.ok(gapped.price > pos.stopLoss);
});

test('a favourable gap through the target is modelled too', function () {
  var pos = { direction: 'LONG', stopLoss: 1.0800, takeProfit: 1.0900 };
  var a = backtestAdapter.create();
  var g = a.evaluateExit(pos, bar(1.0950, 1.0960, 1.0940, 1.0955));
  assert.equal(g.kind, 'TARGET');
  assert.equal(g.price, 1.0950, 'refusing to model favourable gaps would bias the other way');
  assert.equal(g.gapped, true);
});

test('a bar containing both stop and target resolves by the configured policy', function () {
  var pos = { direction: 'LONG', stopLoss: 1.0800, takeProfit: 1.0900 };
  var wide = bar(1.0850, 1.0950, 1.0750, 1.0860);

  var pessimistic = backtestAdapter.create({ intrabarPolicy: 'STOP_FIRST' }).evaluateExit(pos, wide);
  assert.equal(pessimistic.kind, 'STOP');
  assert.equal(pessimistic.ambiguous, true);

  var optimistic = backtestAdapter.create({ intrabarPolicy: 'TARGET_FIRST' }).evaluateExit(pos, wide);
  assert.equal(optimistic.kind, 'TARGET');
  assert.equal(optimistic.ambiguous, true);

  var skipped = backtestAdapter.create({ intrabarPolicy: 'SKIP' }).evaluateExit(pos, wide);
  assert.equal(skipped.kind, 'AMBIGUOUS');
  assert.equal(skipped.price, null);
});

test('the default intrabar policy is the pessimistic one', function () {
  assert.equal(backtestAdapter.create().intrabarPolicy, 'STOP_FIRST');
  assert.equal(config.load().backtest.allowIntrabarStopAndTarget, 'STOP_FIRST');
});

test('no exit is claimed when neither level is touched', function () {
  var a = backtestAdapter.create();
  assert.equal(a.evaluateExit({ direction: 'LONG', stopLoss: 1.07, takeProfit: 1.10 }, bar(1.08, 1.085, 1.079, 1.083)), null);
});

test('gap pricing is suppressed on the entry bar', function () {
  // The position opened AT this bar's open, so the market cannot have gapped
  // through a level before the position existed.
  var pos = { direction: 'LONG', stopLoss: 1.0850, takeProfit: 1.0900 };
  var a = backtestAdapter.create();
  var b = bar(1.0800, 1.0810, 1.0700, 1.0750); // open already below the stop
  var onEntryBar = a.evaluateExit(pos, b, true);
  assert.equal(onEntryBar.kind, 'STOP');
  assert.equal(onEntryBar.price, 1.0850, 'the stop is honoured at its level, not at the open');
  assert.equal(onEntryBar.gapped, false);
  var laterBar = a.evaluateExit(pos, b, false);
  assert.equal(laterBar.price, 1.0800);
  assert.equal(laterBar.gapped, true);
});

test('a stop or target outside the bar is rejected by fill()', function () {
  var a = backtestAdapter.create();
  var res = a.fill({
    kind: 'STOP', instrument: EUR, direction: 'LONG', lots: 0.01,
    requestedPrice: 1.0500, bar: bar(1.08, 1.085, 1.079, 1.083)
  });
  assert.equal(res.status, 'REJECTED');
  assert.match(res.detail, /outside the bar range/);
});

test('the backtest adapter cannot be constructed in LIVE mode', function () {
  assert.throws(function () { backtestAdapter.create({ mode: 'LIVE' }); },
    function (e) { return e.code === 'LIVE_EXECUTION_REFUSED'; });
  assert.equal(backtestAdapter.create().supportsMode('LIVE'), false);
  assert.equal(backtestAdapter.create().supportsMode('PAPER'), true);
});

test('malformed fill requests are refused before an adapter sees them', function () {
  assert.throws(function () { adapterMod.assertRequest({ kind: 'WAT' }); }, /kind must be one of/);
  assert.throws(function () { adapterMod.assertRequest({ kind: 'ENTRY', direction: 'NEUTRAL' }); }, /cannot be NEUTRAL/);
  assert.throws(function () { adapterMod.assertRequest({ kind: 'ENTRY', direction: 'LONG', lots: 0 }); }, /lots must be > 0/);
  assert.throws(function () {
    adapterMod.assertRequest({ kind: 'ENTRY', direction: 'LONG', lots: 0.01, requestedPrice: 0 });
  }, /requestedPrice must be > 0/);
});

// ---------------------------------------------------------------------------
// 5. The LIVE adapter refuses
// ---------------------------------------------------------------------------

test('the live adapter refuses every operation, including read-only-looking ones', function () {
  var log = loggerMod.create({ level: 'DEBUG', now: function () { return 0; } });
  var a = liveAdapter.create({ logger: log });
  var ops = [
    function () { a.fill({ kind: 'ENTRY', instrument: EUR, direction: 'LONG', lots: 0.01, requestedPrice: 1.08, bar: bar(1.08, 1.08, 1.08, 1.08) }); },
    function () { a.accountState(); },
    function () { a.positions(); },
    function () { a.cancel('order-1'); },
    function () { a.connect(); }
  ];
  ops.forEach(function (op) {
    assert.throws(op, function (e) {
      assert.equal(e.code, 'LIVE_EXECUTION_REFUSED');
      assert.equal(errors.isRefusal(e), true);
      assert.match(e.message, /refused by design/);
      return true;
    });
  });
  assert.equal(a.attempts().length, ops.length);
  assert.equal(log.memory().byEvent('execution.live.refused').length, ops.length);
});

test('the live adapter reports that it supports no mode at all', function () {
  var a = liveAdapter.create();
  enums.values(enums.Mode).forEach(function (m) {
    assert.equal(a.supportsMode(m), false, 'it must not claim to support ' + m);
  });
  var d = a.describe();
  assert.equal(d.implemented, false);
  assert.equal(d.refusesEveryCall, true);
  assert.deepEqual(d.requiredGates, ['LIVE_ADAPTER_IMPLEMENTED', 'VENUE_COSTS_VERIFIED', 'EXTERNAL_LEGAL_REVIEW']);
});

test('no module in src/ contains a network client', function () {
  // The strongest available statement that live trading is impossible here: a
  // repository-level check that nothing can reach a venue at all.
  var fs = require('fs');
  var forbidden = /require\(\s*['"](https?|net|tls|dgram|node:https?|node:net|node:tls)['"]\s*\)|\bfetch\s*\(|XMLHttpRequest|WebSocket/;
  var offenders = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      var p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      if (!/\.js$/.test(e.name)) return;
      var text = fs.readFileSync(p, 'utf8');
      if (forbidden.test(text)) offenders.push(path.relative(SRC, p));
    });
  })(SRC);
  assert.deepEqual(offenders, [], 'network-capable modules found under src/: ' + offenders.join(', '));
});

// ---------------------------------------------------------------------------
// 6. Metrics
// ---------------------------------------------------------------------------

function trade(net, outcome, over) {
  var base = {
    tradeId: 't', netPnl: net, grossPnl: net + 0.2, costsMoney: 0.2,
    outcome: outcome, exitReason: net >= 0 ? 'TAKE_PROFIT' : 'STOP_LOSS',
    lots: 0.01, barsHeld: 10, recoveryLevel: 0, entryTs: 1, exitTs: 2,
    symbol: 'EURUSD', strategyId: 's1', regime: 'TREND'
  };
  Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
  return base;
}

test('metrics separate gross, costs and net', function () {
  var m = metricsMod.compute({
    trades: [trade(4, 'WIN'), trade(-2, 'LOSS'), trade(-2, 'LOSS'), trade(6, 'WIN')],
    initialCapital: 100
  });
  assert.equal(m.tradeCount, 4);
  assert.equal(m.wins, 2);
  assert.equal(m.losses, 2);
  assert.equal(m.winRate, 0.5);
  assert.equal(m.netPnl, 6);
  assert.equal(m.totalCosts, 0.8);
  assert.equal(m.grossPnl, 6.8);
  assert.equal(m.expectancy, 1.5);
  assert.equal(m.profitFactor, money.round(10 / 4, 6));
  assert.equal(m.avgWin, 5);
  assert.equal(m.avgLoss, 2);
  assert.equal(m.payoffRatio, 2.5);
  assert.equal(m.returnPct, 6);
});

test('profit factor is null rather than infinite when nothing lost', function () {
  var m = metricsMod.compute({ trades: [trade(1, 'WIN'), trade(2, 'WIN')], initialCapital: 100 });
  assert.equal(m.profitFactor, null, 'an infinite profit factor from 2 trades is noise wearing a suit');
  assert.equal(m.avgLoss, null);
  assert.equal(m.payoffRatio, null);
  assert.equal(m.maxConsecutiveLosses, 0);
});

test('an empty run produces defined, honest metrics', function () {
  var m = metricsMod.compute({ trades: [], initialCapital: 100 });
  assert.equal(m.tradeCount, 0);
  assert.equal(m.winRate, null);
  assert.equal(m.expectancy, null);
  assert.equal(m.netPnl, 0);
  assert.equal(m.maxDrawdownPct, 0);
  assert.equal(m.maxConsecutiveLosses, 0);
  assert.deepEqual(m.streakProbabilities, []);
});

test('losing streaks are measured, not inferred from the win rate', function () {
  var seq = ['WIN', 'LOSS', 'LOSS', 'LOSS', 'WIN', 'LOSS', 'LOSS', 'WIN'];
  var trades = seq.map(function (o) { return trade(o === 'WIN' ? 3 : -1, o); });
  assert.deepEqual(metricsMod.losingStreaks(trades), [3, 2]);
  assert.deepEqual(metricsMod.winningStreaks(trades), [1, 1, 1]);
  var m = metricsMod.compute({ trades: trades, initialCapital: 100 });
  assert.equal(m.maxConsecutiveLosses, 3);
  assert.equal(m.avgLosingStreak, 2.5);
  assert.equal(m.losingStreakCount, 2);
});

test('P(k consecutive losses) is an empirical window frequency', function () {
  // L L L W → windows of 2: (LL),(LL),(LW) → 2/3
  var trades = [trade(-1, 'LOSS'), trade(-1, 'LOSS'), trade(-1, 'LOSS'), trade(3, 'WIN')];
  var p2 = metricsMod.pConsecutiveLosses(trades, 2);
  assert.equal(p2.windows, 3);
  assert.equal(p2.hits, 2);
  assert.equal(p2.probability, money.round(2 / 3, 6));
  var p3 = metricsMod.pConsecutiveLosses(trades, 3);
  assert.equal(p3.hits, 1);
  assert.equal(p3.windows, 2);
  assert.equal(metricsMod.pConsecutiveLosses(trades, 5), null, 'a sample too short to contain the window reports null, not 0');
});

test('drawdown comes from the mark-to-market curve when one is supplied', function () {
  var trades = [trade(-5, 'LOSS'), trade(3, 'WIN')];
  var withCurve = metricsMod.compute({
    trades: trades, initialCapital: 100,
    equityCurve: [
      { ts: 1, equity: 100 }, { ts: 2, equity: 88 }, // an open loss deeper than the close
      { ts: 3, equity: 95 }, { ts: 4, equity: 98 }
    ]
  });
  assert.equal(withCurve.equityCurveSource, 'MARK_TO_MARKET');
  assert.equal(withCurve.maxDrawdownPct, 12);

  var withoutCurve = metricsMod.compute({ trades: trades, initialCapital: 100 });
  assert.equal(withoutCurve.equityCurveSource, 'TRADE_CLOSES_ONLY');
  assert.equal(withoutCurve.maxDrawdownPct, 5, 'closes alone understate the drawdown');
});

test('drawdownFromCurve reports where the drawdown happened', function () {
  var dd = metricsMod.drawdownFromCurve([
    { ts: 10, equity: 100 }, { ts: 20, equity: 120 },
    { ts: 30, equity: 90 }, { ts: 40, equity: 130 }
  ]);
  assert.equal(dd.maxDrawdownPct, 25);
  assert.equal(dd.maxDrawdownMoney, 30);
  assert.equal(dd.peakTs, 20);
  assert.equal(dd.troughTs, 30);
  assert.equal(dd.recoveredAtTs, 40);
});

test('expectancy in R multiples is reported when trades carry their risk', function () {
  var m = metricsMod.compute({
    trades: [trade(4, 'WIN', { riskMoney: 2 }), trade(-2, 'LOSS', { riskMoney: 2 })],
    initialCapital: 100
  });
  assert.equal(m.expectancyR, 0.5, '(+2R and -1R) / 2');
});

test('recovery level and largest position are reported', function () {
  var m = metricsMod.compute({
    trades: [trade(-2, 'LOSS', { recoveryLevel: 0, lots: 0.01 }),
             trade(-2, 'LOSS', { recoveryLevel: 1, lots: 0.03 }),
             trade(6, 'WIN', { recoveryLevel: 2, lots: 0.09 })],
    initialCapital: 100
  });
  assert.equal(m.maxRecoveryLevel, 2);
  assert.equal(m.largestPositionLots, 0.09);
  assert.deepEqual(m.tradesAtRecoveryLevel, { '0': 1, '1': 1, '2': 1 });
});

test('byGroup splits metrics per strategy, regime or asset', function () {
  var trades = [
    trade(4, 'WIN', { strategyId: 'a', regime: 'TREND' }),
    trade(-2, 'LOSS', { strategyId: 'a', regime: 'RANGE' }),
    trade(-2, 'LOSS', { strategyId: 'b', regime: 'RANGE' })
  ];
  var byStrategy = metricsMod.byGroup({ trades: trades, initialCapital: 100 }, 'strategyId');
  assert.deepEqual(Object.keys(byStrategy), ['a', 'b']);
  assert.equal(byStrategy.a.tradeCount, 2);
  assert.equal(byStrategy.b.netPnl, -2);
  var byRegime = metricsMod.byGroup({ trades: trades, initialCapital: 100 }, 'regime');
  assert.deepEqual(Object.keys(byRegime), ['RANGE', 'TREND']);
});

test('headline always carries the streak and drawdown fields', function () {
  var h = metricsMod.headline(metricsMod.compute({ trades: [trade(-1, 'LOSS')], initialCapital: 100 }));
  ['trades', 'winRate', 'netPnl', 'costs', 'expectancy', 'profitFactor',
    'maxDrawdownPct', 'maxConsecutiveLosses', 'returnOverMaxDrawdown', 'maxRecoveryLevel'
  ].forEach(function (f) {
    assert.ok(Object.prototype.hasOwnProperty.call(h, f), 'headline omits ' + f);
  });
});

test('return over max drawdown is null when there was no drawdown', function () {
  var m = metricsMod.compute({ trades: [trade(5, 'WIN')], initialCapital: 100 });
  assert.equal(m.maxDrawdownPct, 0);
  assert.equal(m.returnOverMaxDrawdown, null);
});
