'use strict';
// =====================================================
// MYTHOS TRADING AGENT — Risk Engine and Recovery ×3 tests
// projects/mythos-trading-agent/tests/risk-recovery-test.js
//
// THE MOST SAFETY-CRITICAL SUITE IN THE PLATFORM, and it is written to prove the
// owner's constraint rather than to demonstrate the feature:
//
//   "Recovery ×3 may be implemented ONLY as a capped, fully risk-controlled,
//    opt-in option. It must never override the Risk Engine or the maximum-loss
//    limits."
//
// §3 and §6 are the load-bearing sections. Both are PROPERTY tests over hundreds
// of randomised combinations of equity, stop distance, instrument and requested
// size, and they assert the invariant directly: whatever is asked for, the
// approved size never risks more than the budget, never exceeds the position cap,
// and never exceeds the instrument's own maximum — including at every rung of the
// recovery ladder. An example-based test would prove the cases someone thought
// of; this proves the rule.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var riskMod = require(path.join(SRC, 'risk', 'engine'));
var recoveryMod = require(path.join(SRC, 'recovery', 'engine'));
var accountMod = require(path.join(SRC, 'account', 'account'));
var candidateMod = require(path.join(SRC, 'strategy', 'candidate'));
var costModelMod = require(path.join(SRC, 'cost', 'model'));
var configMod = require(path.join(SRC, 'config'));
var instrumentMod = require(path.join(SRC, 'core', 'instrument'));
var storeMod = require(path.join(SRC, 'db', 'store'));
var rngMod = require(path.join(SRC, 'core', 'rng'));
var money = require(path.join(SRC, 'core', 'money'));
var loggerMod = require(path.join(SRC, 'core', 'logger'));

var CATALOG = instrumentMod.defaultCatalog();
var EUR = CATALOG.get('EURUSD');
var GOLD = CATALOG.get('XAUUSD');
var TS = Date.parse('2024-01-03T10:00:00Z');

function cfg(over) {
  return configMod.load(Object.assign({ cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 } }, over || {}));
}

function account(initial) {
  return accountMod.create({ initialCapital: initial === undefined ? 100 : initial });
}

/** A healthy candidate; tests damage one thing at a time. */
function candidate(over, config) {
  var c = config || cfg();
  var o = over || {};
  var inst = o.instrument || EUR;
  var entry = o.entry === undefined ? 1.08 : o.entry;
  var stopPips = o.stopPips === undefined ? 20 : o.stopPips;
  var targetPips = o.targetPips === undefined ? 60 : o.targetPips;
  return candidateMod.build({
    candidateId: o.candidateId || 'c1',
    ts: TS,
    instrument: inst,
    timeframe: 'M15',
    signal: {
      strategyId: 'trend-following', direction: 'LONG', referencePrice: entry,
      stopLoss: money.round(entry - stopPips * inst.pipSize, inst.digits),
      takeProfit: money.round(entry + targetPips * inst.pipSize, inst.digits),
      confidence: 0.6, reasonCodes: ['TEST'], meta: {}
    },
    strategyFingerprint: { strategyId: 'trend-following', version: 1, paramsHash: 'h' },
    regime: 'TREND', regimeConfidence: 0.7,
    spreadPips: o.spreadPips === undefined ? 1.2 : o.spreadPips,
    costModel: costModelMod.create(c)
  });
}

function assess(over, config, acct, requestedLots) {
  var c = config || cfg();
  var engine = riskMod.create({ config: c });
  return engine.assess({
    candidate: candidate(over, c),
    instrument: (over && over.instrument) || EUR,
    account: acct || account(100),
    requestedLots: requestedLots === undefined ? 0.01 : requestedLots,
    ts: TS
  });
}

function lossTrade(netPnl, ts) {
  return {
    ts: ts === undefined ? TS : ts, netPnl: netPnl, grossPnl: netPnl + 0.2,
    costsMoney: 0.2, outcome: 'LOSS'
  };
}

// ---------------------------------------------------------------------------
// 1. The account-level gate
// ---------------------------------------------------------------------------

test('a healthy account passes the pre-trade gate', function () {
  var g = riskMod.create({ config: cfg() }).preTradeGate({ account: account(100), ts: TS });
  assert.equal(g.allowed, true);
  assert.deepEqual(g.reasonCodes, []);
  assert.ok(g.limitsChecked.length >= 4);
  g.limitsChecked.forEach(function (l) {
    assert.ok(l.limit && l.observed !== undefined && l.limitValue !== undefined);
    assert.equal(typeof l.binding, 'boolean');
  });
});

test('the drawdown limit blocks, and escalates', function () {
  var c = cfg({ risk: { maxDrawdownPct: 10 } });
  var a = account(100);
  a.markToMarket(TS, 0, 0);
  a.applyTrade({ ts: TS, netPnl: -12, grossPnl: -11.8, costsMoney: 0.2, outcome: 'LOSS' });
  var g = riskMod.create({ config: c }).preTradeGate({ account: a, ts: TS });
  assert.equal(g.allowed, false);
  assert.ok(g.reasonCodes.indexOf('MAX_DRAWDOWN_REACHED') !== -1);
  assert.equal(g.escalate, true, 'a drawdown breach ends the run, it is not a bad day');
  var dd = g.limitsChecked.filter(function (l) { return l.limit === 'MAX_DRAWDOWN_PCT'; })[0];
  assert.equal(dd.binding, true);
  assert.equal(dd.limitValue, 10);
  assert.ok(dd.observed >= 10);
});

test('the daily loss limit blocks without escalating', function () {
  var c = cfg({ risk: { maxDailyLossPct: 5, maxDrawdownPct: 50 } });
  var a = account(100);
  a.applyTrade({ ts: TS, netPnl: -6, grossPnl: -5.8, costsMoney: 0.2, outcome: 'LOSS' });
  var g = riskMod.create({ config: c }).preTradeGate({ account: a, ts: TS });
  assert.equal(g.allowed, false);
  assert.ok(g.reasonCodes.indexOf('DAILY_LOSS_LIMIT_REACHED') !== -1);
  assert.equal(g.escalate, false, 'a bad day is not the end of the run');
  // And tomorrow is allowed again.
  var tomorrow = TS + 24 * 3600 * 1000;
  assert.equal(riskMod.create({ config: c }).preTradeGate({ account: a, ts: tomorrow }).allowed, true);
});

test('the consecutive-loss limit blocks', function () {
  // Drawdown and daily loss are set wide so the streak limit is the only one
  // that can bind — the schema caps maxDailyLossPct at 50.
  var c = cfg({ risk: { maxConsecutiveLosses: 3, maxDrawdownPct: 80, maxDailyLossPct: 50 } });
  var a = account(1000);
  for (var i = 0; i < 3; i++) a.applyTrade(lossTrade(-1, TS));
  var g = riskMod.create({ config: c }).preTradeGate({ account: a, ts: TS });
  assert.equal(g.allowed, false);
  assert.ok(g.reasonCodes.indexOf('MAX_CONSECUTIVE_LOSSES_REACHED') !== -1);
  // A win clears it.
  a.applyTrade({ ts: TS, netPnl: 1, grossPnl: 1.2, costsMoney: 0.2, outcome: 'WIN' });
  assert.equal(riskMod.create({ config: c }).preTradeGate({ account: a, ts: TS }).allowed, true);
});

test('the consecutive-loss limit is a BREAKER with a cooling-off, not a deadlock', function () {
  // THIS IS THE TEST FOR A DEFECT THAT WAS MEASURED, NOT IMAGINED. When the limit
  // was a permanent block, hitting it stopped all trading, so no win could occur,
  // so the streak never reset — 2,573 of 2,692 risk blocks in one run were this
  // single condition, frozen for the rest of the run.
  var c = cfg({
    risk: { maxConsecutiveLosses: 3, consecutiveLossCooldownHours: 6, maxDrawdownPct: 80, maxDailyLossPct: 50 }
  });
  var e = riskMod.create({ config: c, logger: loggerMod.nullLogger() });
  var a = account(10000);
  var t0 = Date.parse('2024-01-03T10:00:00Z');
  for (var i = 0; i < 3; i++) a.applyTrade(lossTrade(-1, t0));

  // Immediately after: the breaker trips and blocks.
  var blocked = e.preTradeGate({ account: a, ts: t0 + 60000 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.reasonCodes.indexOf('MAX_CONSECUTIVE_LOSSES_REACHED') !== -1);
  assert.equal(e.streakBreaker().tripped, true);
  var remaining = blocked.limitsChecked.filter(function (l) { return l.limit === 'STREAK_COOLDOWN_REMAINING_MS'; })[0];
  assert.ok(remaining && remaining.observed > 0, 'the record must say how much cooling-off is left');

  // Part way through: still blocked.
  assert.equal(e.preTradeGate({ account: a, ts: t0 + 5 * 3600 * 1000 }).allowed, false);

  // After the cooling-off: allowed again, and the streak is cleared.
  var after = e.preTradeGate({ account: a, ts: t0 + 6 * 3600 * 1000 });
  assert.equal(after.allowed, true, 'the system must be able to resume, or the limit is a kill switch');
  assert.equal(a.consecutiveLosses(), 0);
  assert.equal(e.streakBreaker().tripped, false);
  assert.equal(e.streakBreaker().timesCleared, 1);

  // The HISTORICAL maximum is not erased — the metric still reports what happened.
  assert.equal(a.maxConsecutiveLosses(), 3);
  assert.equal(a.streakClears().length, 1);
  assert.equal(a.streakClears()[0].cleared, 3);
});

test('the cooling-off is measured from the last loss, not from when the gate was asked', function () {
  var c = cfg({ risk: { maxConsecutiveLosses: 2, consecutiveLossCooldownHours: 4, maxDrawdownPct: 80, maxDailyLossPct: 50 } });
  var e = riskMod.create({ config: c, logger: loggerMod.nullLogger() });
  var a = account(10000);
  var lossTs = Date.parse('2024-01-03T10:00:00Z');
  a.applyTrade(lossTrade(-1, lossTs));
  a.applyTrade(lossTrade(-1, lossTs));
  // First consulted five hours after the loss — the cooling-off has already passed.
  var g = e.preTradeGate({ account: a, ts: lossTs + 5 * 3600 * 1000 });
  assert.equal(g.allowed, true, 'the clock must not restart on the first call');
  assert.equal(e.streakBreaker().timesCleared, 1);
});

test('a zero cooling-off makes the streak limit inert, which is allowed only explicitly', function () {
  var c = cfg({ risk: { maxConsecutiveLosses: 2, consecutiveLossCooldownHours: 0, maxDrawdownPct: 80, maxDailyLossPct: 50 } });
  var e = riskMod.create({ config: c, logger: loggerMod.nullLogger() });
  var a = account(10000);
  a.applyTrade(lossTrade(-1, TS));
  a.applyTrade(lossTrade(-1, TS));
  assert.equal(e.preTradeGate({ account: a, ts: TS }).allowed, true);
  assert.equal(a.consecutiveLosses(), 0, 'with no cooling-off the breaker trips and clears in the same instant');
  assert.equal(configMod.load().risk.consecutiveLossCooldownHours, 12, 'the default is NOT zero');
});

test('the breaker records both trip and clear as system events', function () {
  var store = storeMod.create({ runId: 'r' });
  var c = cfg({ risk: { maxConsecutiveLosses: 2, consecutiveLossCooldownHours: 3, maxDrawdownPct: 80, maxDailyLossPct: 50 } });
  var e = riskMod.create({ config: c, store: store, logger: loggerMod.nullLogger() });
  var a = account(10000);
  a.applyTrade(lossTrade(-1, TS));
  a.applyTrade(lossTrade(-1, TS));
  e.preTradeGate({ account: a, ts: TS });
  e.preTradeGate({ account: a, ts: TS + 4 * 3600 * 1000 });
  assert.equal(store.table('system_events').by('kind', 'STREAK_BREAKER_TRIPPED').length, 1);
  var cleared = store.table('system_events').by('kind', 'STREAK_BREAKER_CLEARED');
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0].clearedStreak, 2);
});

test('a configured emergency stop blocks everything from the start', function () {
  var e = riskMod.create({ config: cfg({ risk: { emergencyStop: true } }) });
  assert.equal(e.isEmergencyStopped(), true);
  var g = e.preTradeGate({ account: account(100), ts: TS });
  assert.equal(g.allowed, false);
  assert.ok(g.reasonCodes.indexOf('EMERGENCY_STOP_ACTIVE') !== -1);
});

test('an emergency stop is sticky — nothing inside the run can clear it', function () {
  var e = riskMod.create({ config: cfg() });
  assert.equal(e.isEmergencyStopped(), false);
  assert.equal(e.raiseEmergencyStop('manual'), true);
  assert.equal(e.isEmergencyStopped(), true);
  assert.equal(e.raiseEmergencyStop('again'), false, 'raising twice is a no-op');
  assert.equal(e.emergencyReason(), 'manual', 'the first reason is the one that stands');
  // There is no API to clear it.
  assert.equal(e.clearEmergencyStop, undefined);
  assert.equal(e.resume, undefined);
});

test('monitor raises the emergency stop when the drawdown limit breaks', function () {
  var c = cfg({ risk: { maxDrawdownPct: 10 } });
  var e = riskMod.create({ config: c, logger: loggerMod.nullLogger() });
  var a = account(100);
  a.markToMarket(TS, 0, 0);
  assert.equal(e.monitor({ account: a, ts: TS }).emergencyStop, false);
  a.markToMarket(TS + 1, -15, 0); // open loss alone breaches it
  var m = e.monitor({ account: a, ts: TS + 1 });
  assert.equal(m.emergencyStop, true);
  assert.match(m.reason, /MAX_DRAWDOWN_REACHED/);
  assert.equal(e.isEmergencyStopped(), true);
});

test('an account-level block is recorded at stage ACCOUNT with no size', function () {
  var c = cfg({ risk: { maxDrawdownPct: 5 } });
  var a = account(100);
  a.markToMarket(TS, 0, 0);
  a.applyTrade(lossTrade(-8));
  var res = assess({}, c, a, 0.01);
  assert.equal(res.verdict, 'BLOCK');
  assert.equal(res.approvedLots, 0);
  assert.equal(res.stage, 'ACCOUNT');
  assert.ok(res.reasonCodes.indexOf('MAX_DRAWDOWN_REACHED') !== -1);
});

// ---------------------------------------------------------------------------
// 2. Structural limits
// ---------------------------------------------------------------------------

test('a spread above the configured multiple blocks, with the numbers recorded', function () {
  var c = cfg({ risk: { maxSpreadMultiple: 2 } });
  var res = assess({ spreadPips: 3.0 }, c);
  assert.equal(res.verdict, 'BLOCK');
  assert.equal(res.stage, 'STRUCTURAL');
  assert.ok(res.reasonCodes.indexOf('SPREAD_ABOVE_LIMIT') !== -1);
  var l = res.limitsChecked.filter(function (x) { return x.limit === 'MAX_SPREAD_PIPS'; })[0];
  assert.equal(l.observed, 3);
  assert.equal(l.limitValue, EUR.typicalSpreadPips * 2);
  assert.equal(l.binding, true);
});

test('stops outside the configured bounds block', function () {
  var c = cfg({ risk: { minStopPips: 5, maxStopPips: 100 } });
  assert.ok(assess({ stopPips: 3 }, c).reasonCodes.indexOf('STOP_BELOW_MINIMUM') !== -1);
  assert.ok(assess({ stopPips: 200 }, c).reasonCodes.indexOf('STOP_ABOVE_MAXIMUM') !== -1);
  assert.equal(assess({ stopPips: 3 }, c).verdict, 'BLOCK');
  assert.equal(assess({ stopPips: 200 }, c).verdict, 'BLOCK');
});

test('a reward/risk or expectancy below the minimum blocks', function () {
  var strict = cfg({ risk: { minRewardRisk: 2.5 } });
  var res = assess({ stopPips: 20, targetPips: 30 }, strict);
  assert.equal(res.verdict, 'BLOCK');
  assert.ok(res.reasonCodes.indexOf('REWARD_RISK_BELOW_MINIMUM') !== -1);

  var ev = cfg({ risk: { minNetExpectedValue: 50 } });
  var res2 = assess({}, ev);
  assert.ok(res2.reasonCodes.indexOf('NET_EXPECTANCY_NOT_POSITIVE') !== -1);
});

test('a recovery level above the cap blocks outright', function () {
  var c = cfg({ recovery: { enabled: true, maxRecoveryLevel: 2 } });
  var engine = riskMod.create({ config: c });
  var res = engine.assess({
    candidate: candidate({}, c), instrument: EUR, account: account(100),
    requestedLots: 0.01, ts: TS, recoveryLevel: 3
  });
  assert.equal(res.verdict, 'BLOCK');
  assert.ok(res.reasonCodes.indexOf('RECOVERY_LEVEL_EXCEEDED') !== -1);
  var l = res.limitsChecked.filter(function (x) { return x.limit === 'MAX_RECOVERY_LEVEL'; })[0];
  assert.equal(l.observed, 3);
  assert.equal(l.limitValue, 2);
});

test('assess refuses a caller with nothing to request', function () {
  var engine = riskMod.create({ config: cfg() });
  assert.throws(function () {
    engine.assess({ candidate: candidate(), instrument: EUR, account: account(100), requestedLots: 0, ts: TS });
  }, /needs a positive requestedLots/);
});

// ---------------------------------------------------------------------------
// 3. Sizing — the core arithmetic and the invariant
// ---------------------------------------------------------------------------

test('a request inside every limit is ALLOWED unchanged', function () {
  // $1000 account, 2 % = $20 budget, 20-pip stop at $10/pip/lot → 0.10 lots max.
  var res = assess({ stopPips: 20 }, cfg(), account(1000), 0.05);
  assert.equal(res.verdict, 'ALLOW');
  assert.equal(res.approvedLots, 0.05);
  assert.deepEqual(res.reasonCodes, ['WITHIN_ALL_LIMITS']);
  assert.equal(res.approvedRiskMoney, 10);
});

test('a request above the risk budget is CLAMPED, and the clamp is named', function () {
  var res = assess({ stopPips: 20 }, cfg(), account(1000), 0.5);
  assert.equal(res.verdict, 'CLAMP');
  assert.equal(res.approvedLots, 0.1, '$20 budget over a 20-pip stop is 0.10 lots');
  assert.ok(res.reasonCodes.indexOf('MAX_ACCOUNT_RISK_PER_TRADE') !== -1 ||
            res.reasonCodes.indexOf('MAX_POSITION_SIZE') !== -1);
  assert.equal(res.requestedLots, 0.5);
  assert.ok(res.approvedLots < res.requestedLots);
});

test('the position-size cap binds independently of the risk budget', function () {
  var c = cfg({ risk: { maxPositionSizeLots: 0.02 } });
  var res = assess({ stopPips: 20 }, c, account(10000), 1);
  assert.equal(res.verdict, 'CLAMP');
  assert.equal(res.approvedLots, 0.02);
  assert.ok(res.reasonCodes.indexOf('MAX_POSITION_SIZE') !== -1);
});

test('on a $100 account the minimum lot already exhausts the budget — NO TRADE', function () {
  // This is the defining behaviour of the account size, not an edge case.
  // 2 % of $100 = $2. A 30-pip stop on EURUSD at 0.01 lots risks $3.
  var res = assess({ stopPips: 30 }, cfg(), account(100), 0.01);
  assert.equal(res.verdict, 'BLOCK');
  assert.equal(res.approvedLots, 0);
  assert.ok(res.reasonCodes.indexOf('SIZE_BELOW_MINIMUM') !== -1);
  assert.equal(res.stage, 'SIZING');
  assert.equal(res.riskAtMinLot, 3, 'the record must say what the minimum lot would have risked');
  assert.equal(res.riskBudgetMoney, 2);

  // A 20-pip stop fits exactly.
  var ok = assess({ stopPips: 20 }, cfg(), account(100), 0.01);
  assert.equal(ok.verdict, 'ALLOW');
  assert.equal(ok.approvedRiskMoney, 2);
});

test('the daily loss headroom shrinks the budget', function () {
  var c = cfg({ risk: { maxDailyLossPct: 3, maxAccountRiskPerTradePct: 2, maxDrawdownPct: 50 } });
  var a = account(1000);
  a.applyTrade(lossTrade(-25)); // $25 of a $30 daily allowance used
  var res = assess({ stopPips: 20 }, c, a, 1);
  assert.equal(res.verdict, 'CLAMP');
  assert.ok(res.reasonCodes.indexOf('DAILY_LOSS_HEADROOM') !== -1);
  assert.ok(res.riskBudgetMoney <= 5.001, 'budget was ' + res.riskBudgetMoney + ', headroom is $5');
  assert.ok(res.approvedRiskMoney <= 5);
});

test('the drawdown headroom shrinks the budget', function () {
  var c = cfg({ risk: { maxDrawdownPct: 6, maxAccountRiskPerTradePct: 5, maxDailyLossPct: 5 } });
  var a = account(1000);
  a.markToMarket(TS, 0, 0);
  a.applyTrade({ ts: TS + 24 * 3600 * 1000, netPnl: -50, grossPnl: -49.8, costsMoney: 0.2, outcome: 'LOSS' });
  // Peak 1000, equity 950 → $60 allowance, $50 used, $10 left.
  var res = assess({ stopPips: 20 }, c, a, 1, TS);
  var engine = riskMod.create({ config: c });
  var r2 = engine.assess({
    candidate: candidate({ stopPips: 20 }, c), instrument: EUR, account: a,
    requestedLots: 1, ts: TS + 48 * 3600 * 1000
  });
  assert.ok(r2.riskBudgetMoney <= 10.001, 'budget was ' + r2.riskBudgetMoney);
  assert.ok(r2.reasonCodes.indexOf('DRAWDOWN_HEADROOM') !== -1);
});

test('gold sizes correctly in its own units', function () {
  // 0.01 lots of gold is 1 ounce: $1 per 100 pips (a $1 price move).
  // $20 budget over a 300-pip ($3) stop → 20/(300*1) = 0.066 → floored to 0.06
  var res = assess({ instrument: GOLD, entry: 2300, stopPips: 300, targetPips: 900, spreadPips: 28 },
    cfg(), account(1000), 1);
  assert.equal(res.verdict, 'CLAMP');
  assert.equal(res.approvedLots, 0.06);
  assert.ok(res.approvedRiskMoney <= 20);
});

test('PROPERTY: the approved size never breaches any cap, over 600 random cases', function () {
  var gen = rngMod.create('risk-property');
  var instruments = [EUR, GOLD, CATALOG.get('USDJPY'), CATALOG.get('GBPUSD')];
  var checked = 0, allowed = 0, clamped = 0, blocked = 0;

  for (var i = 0; i < 600; i++) {
    var inst = gen.pick(instruments);
    var equity = gen.uniform(50, 50000);
    var riskPct = gen.uniform(0.1, 20);
    var maxPos = money.round(gen.uniform(0.01, 5), 2);
    var stopPips = gen.uniform(4, 400);
    var requested = money.round(gen.uniform(0.01, 3), 2);
    var entry = inst.referencePrice;

    var c = cfg({
      risk: {
        maxAccountRiskPerTradePct: riskPct,
        maxPositionSizeLots: maxPos,
        minStopPips: 0.1, maxStopPips: 100000,
        minRewardRisk: 0, minNetExpectedValue: -1e6,
        maxDailyLossPct: 49, maxDrawdownPct: 89
      }
    });
    var engine = riskMod.create({ config: c });
    var cand = candidate({
      instrument: inst, entry: entry, stopPips: stopPips, targetPips: stopPips * 3,
      spreadPips: inst.typicalSpreadPips
    }, c);
    var res = engine.assess({
      candidate: cand, instrument: inst, account: account(equity), requestedLots: requested, ts: TS
    });
    checked++;

    if (res.verdict === 'BLOCK') { blocked++; assert.equal(res.approvedLots, 0); continue; }
    if (res.verdict === 'ALLOW') { allowed++; assert.equal(res.approvedLots, requested); }
    else clamped++;

    var approved = res.approvedLots;
    var budget = equity * riskPct / 100;
    var approvedRisk = instrumentMod.riskMoneyForLots(inst, approved, cand.riskPips, entry);

    assert.ok(approved <= requested + 1e-9,
      'approved ' + approved + ' exceeded the request ' + requested);
    assert.ok(approved <= maxPos + 1e-9,
      'approved ' + approved + ' exceeded maxPositionSizeLots ' + maxPos);
    assert.ok(approved <= inst.maxLot + 1e-9,
      'approved ' + approved + ' exceeded ' + inst.symbol + ' maxLot ' + inst.maxLot);
    assert.ok(approved >= inst.minLot - 1e-9,
      'approved ' + approved + ' is below ' + inst.symbol + ' minLot ' + inst.minLot);
    assert.ok(approvedRisk <= budget + 0.01,
      'approved risk $' + approvedRisk.toFixed(4) + ' exceeded the $' + budget.toFixed(4) +
      ' budget (' + inst.symbol + ', stop ' + stopPips.toFixed(1) + ' pips, equity ' + equity.toFixed(0) + ')');
    assert.ok(instrumentMod.isTradableSize(inst, approved),
      approved + ' is not a tradable size for ' + inst.symbol);
  }
  assert.equal(checked, 600);
  assert.ok(allowed > 0 && clamped > 0 && blocked > 0,
    'the property test must exercise all three verdicts: allow ' + allowed + ' clamp ' + clamped + ' block ' + blocked);
});

test('assessments persist with their full limit record', function () {
  var store = storeMod.create({ runId: 'r' });
  var engine = riskMod.create({ config: cfg() });
  var res = engine.assess({
    candidate: candidate(), instrument: EUR, account: account(100), requestedLots: 0.01, ts: TS
  });
  engine.persist(store, 'c1', TS, res);
  var row = store.table('risk_assessments').first('candidateId', 'c1');
  assert.equal(row.verdict, res.verdict);
  assert.equal(row.requestedLots, 0.01);
  assert.ok(Array.isArray(row.limitsChecked) && row.limitsChecked.length > 5);
  assert.equal(row.accountEquity, 100);
});

test('limits() reports every configured hard limit', function () {
  var l = riskMod.create({ config: cfg() }).limits();
  ['maxAccountRiskPerTradePct', 'maxPositionSizeLots', 'maxOpenTrades', 'maxDailyLossPct',
    'maxDrawdownPct', 'maxConsecutiveLosses', 'maxSpreadMultiple', 'maxSlippageMultiple',
    'minStopPips', 'maxStopPips', 'maxRecoveryLevel', 'emergencyStop'
  ].forEach(function (k) {
    assert.ok(l[k] !== undefined, 'limits() omits ' + k);
  });
  assert.equal(l.maxOpenTrades, 1);
});

// ---------------------------------------------------------------------------
// 4. Recovery: the ladder, and its caps
// ---------------------------------------------------------------------------

test('recovery is OFF by default and stays at base through any number of losses', function () {
  var rec = recoveryMod.create({ config: cfg() });
  assert.equal(rec.enabled, false);
  for (var i = 0; i < 10; i++) {
    rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -2, exitTs: TS, tradeId: 't' + i });
    assert.equal(rec.request('EURUSD').requestedLots, 0.01, 'a disabled ladder must never move');
    assert.equal(rec.request('EURUSD').level, 0);
  }
  assert.equal(rec.state('EURUSD').level, 0);
});

test('an enabled ladder is 0.01, 0.03, 0.09 and stops at the cap', function () {
  var c = cfg({ recovery: { enabled: true, maxRecoveryLevel: 2 } });
  var rec = recoveryMod.create({ config: c });
  assert.deepEqual(rec.ladder(), [0.01, 0.03, 0.09]);
  assert.equal(rec.request('EURUSD').requestedLots, 0.01);
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -2, exitTs: TS, tradeId: 't1' });
  assert.equal(rec.request('EURUSD').requestedLots, 0.03);
  assert.equal(rec.request('EURUSD').level, 1);
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -6, exitTs: TS, tradeId: 't2' });
  assert.equal(rec.request('EURUSD').requestedLots, 0.09);
  assert.equal(rec.request('EURUSD').cumulativeLossMoney, 8);
});

test('reaching the cap ABANDONS the ladder rather than escalating', function () {
  var c = cfg({ recovery: { enabled: true, maxRecoveryLevel: 2 } });
  var rec = recoveryMod.create({ config: c, logger: loggerMod.nullLogger() });
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -2, exitTs: TS, tradeId: 't1' });
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -6, exitTs: TS, tradeId: 't2' });
  assert.equal(rec.state('EURUSD').level, 2);
  var t = rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -18, exitTs: TS, tradeId: 't3' });
  assert.equal(t.reason, 'CAP_ABANDONED');
  assert.equal(t.levelAfter, 0, 'a ladder that tries once more at the cap has no cap');
  assert.equal(t.abandonedLossMoney, 26, 'the accumulated loss is realised, not carried');
  assert.equal(rec.state('EURUSD').cumulativeLossMoney, 0);
  assert.equal(rec.request('EURUSD').requestedLots, 0.01);
  assert.equal(rec.stats().abandonedAtCap, 1);
});

test('a win resets, a breakeven holds', function () {
  var c = cfg({ recovery: { enabled: true, maxRecoveryLevel: 3 } });
  var rec = recoveryMod.create({ config: c });
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -2, exitTs: TS, tradeId: 't1' });
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -6, exitTs: TS, tradeId: 't2' });
  assert.equal(rec.state('EURUSD').level, 2);

  var be = rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'BREAKEVEN', netPnl: 0, exitTs: TS, tradeId: 't3' });
  assert.equal(be.reason, 'BREAKEVEN_HELD');
  assert.equal(rec.state('EURUSD').level, 2, 'a scratch must not clear an accumulated loss');
  assert.equal(rec.state('EURUSD').cumulativeLossMoney, 8);

  var win = rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'WIN', netPnl: 9, exitTs: TS, tradeId: 't4' });
  assert.equal(win.reason, 'WIN_RESET');
  assert.equal(rec.state('EURUSD').level, 0);
  assert.equal(rec.state('EURUSD').cumulativeLossMoney, 0);
  assert.equal(rec.stats().resets, 1);
});

test('recovery state is per asset (mission §7)', function () {
  var c = cfg({ recovery: { enabled: true, maxRecoveryLevel: 3 } });
  var rec = recoveryMod.create({ config: c });
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -2, exitTs: TS, tradeId: 'a' });
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -2, exitTs: TS, tradeId: 'b' });
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -2, exitTs: TS, tradeId: 'c' });
  assert.equal(rec.state('EURUSD').level, 3);
  assert.equal(rec.state('XAUUSD').level, 0, 'a loss on one asset must not advance another');
  assert.equal(rec.request('XAUUSD').requestedLots, 0.01);
  assert.deepEqual(rec.states().map(function (s) { return [s.symbol, s.level]; }),
    [['EURUSD', 3], ['XAUUSD', 0]]);
});

test('every ladder transition is persisted with the uncapped size it wanted', function () {
  var store = storeMod.create({ runId: 'r' });
  var c = cfg({ recovery: { enabled: true, maxRecoveryLevel: 2 } });
  var rec = recoveryMod.create({ config: c, store: store, logger: loggerMod.nullLogger() });
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -2, exitTs: TS, tradeId: 't1' });
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -6, exitTs: TS, tradeId: 't2' });
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -18, exitTs: TS, tradeId: 't3' });
  var rows = store.table('recovery_states').all();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(function (r) { return r.reason; }),
    ['LOSS_ESCALATED', 'LOSS_ESCALATED', 'CAP_ABANDONED']);
  // Mission §17: "why did recovery increase?" — including what it wanted.
  assert.equal(rows[1].level, 2);
  assert.equal(rows[1].nextLotsUncapped, 0.09);
  assert.equal(rows[1].cumulativeLossMoney, 8);
});

test('the uncapped ladder is recorded even past the cap, so the cap is visible', function () {
  var c = cfg({ recovery: { enabled: true, maxRecoveryLevel: 2 } });
  var rec = recoveryMod.create({ config: c });
  var r = rec.request('EURUSD');
  assert.equal(r.maxRecoveryLevel, 2);
  assert.equal(r.multiplier, 3);
  assert.deepEqual(rec.ladder(), [0.01, 0.03, 0.09]);
  assert.equal(rec.config().ladder[2], 0.09);
});

// ---------------------------------------------------------------------------
// 5. Recovery take-profit arithmetic (mission §7)
// ---------------------------------------------------------------------------

test('the required take-profit recovers the accumulated loss plus costs', function () {
  var c = cfg({ recovery: { enabled: true, maxRecoveryLevel: 3 } });
  var rec = recoveryMod.create({ config: c });
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -2, exitTs: TS, tradeId: 't1' });
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -3, exitTs: TS, tradeId: 't2' });
  assert.equal(rec.state('EURUSD').cumulativeLossMoney, 5);

  // At 0.01 lots, EURUSD is $0.10 per pip. Recovering $5 plus $0.22 of cost
  // needs 52.2 pips.
  var req = rec.requiredTakeProfitPips({ instrument: EUR, lots: 0.01, price: 1.08, costMoney: 0.22 });
  assert.equal(req.recoverMoney, 5.22);
  assert.equal(req.pipValue, 0.1);
  assert.equal(req.requiredPips, 52.2);

  // At the size the ladder WANTED (0.09) it would only need 5.8 pips — which is
  // precisely why the Risk Engine's clamp makes recovery hard rather than easy.
  var atLadderSize = rec.requiredTakeProfitPips({ instrument: EUR, lots: 0.09, price: 1.08, costMoney: 0.22 });
  assert.ok(atLadderSize.requiredPips < req.requiredPips / 8);
});

test('a target that cannot recover the ladder is refused', function () {
  var c = cfg({ recovery: { enabled: true, maxRecoveryLevel: 3, requireFullRecoveryTp: true } });
  var rec = recoveryMod.create({ config: c });
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -5, exitTs: TS, tradeId: 't1' });

  var short = rec.targetCoversRecovery({
    instrument: EUR, lots: 0.01, price: 1.08, costMoney: 0.22, offeredPips: 30
  });
  assert.equal(short.required, true);
  assert.equal(short.ok, false);
  assert.ok(short.requiredPips > 30);

  var enough = rec.targetCoversRecovery({
    instrument: EUR, lots: 0.01, price: 1.08, costMoney: 0.22, offeredPips: 60
  });
  assert.equal(enough.ok, true);
});

test('at base level no recovery target is required', function () {
  var c = cfg({ recovery: { enabled: true, maxRecoveryLevel: 3 } });
  var rec = recoveryMod.create({ config: c });
  var r = rec.targetCoversRecovery({ instrument: EUR, lots: 0.01, price: 1.08, costMoney: 0.2, offeredPips: 1 });
  assert.equal(r.required, false);
  assert.equal(r.ok, true);
});

test('a Risk Engine block abandons the ladder rather than waiting for a way in', function () {
  var c = cfg({ recovery: { enabled: true, maxRecoveryLevel: 3, abandonOnRiskBlock: true } });
  var rec = recoveryMod.create({ config: c, logger: loggerMod.nullLogger() });
  rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -5, exitTs: TS, tradeId: 't1' });
  assert.equal(rec.state('EURUSD').level, 1);
  var r = rec.onRiskBlocked('EURUSD', TS, ['SIZE_BELOW_MINIMUM']);
  assert.equal(r.reset, true);
  assert.equal(rec.state('EURUSD').level, 0);
  assert.equal(rec.state('EURUSD').cumulativeLossMoney, 0);
  assert.equal(rec.stats().abandonedByRisk, 1);

  var keeps = recoveryMod.create({ config: cfg({ recovery: { enabled: true, maxRecoveryLevel: 3, abandonOnRiskBlock: false } }) });
  keeps.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -5, exitTs: TS, tradeId: 't1' });
  assert.equal(keeps.onRiskBlocked('EURUSD', TS, ['X']).reset, false);
  assert.equal(keeps.state('EURUSD').level, 1);
});

test('the clamping rate is reported, because recovery research is meaningless without it', function () {
  var c = cfg({ recovery: { enabled: true, maxRecoveryLevel: 3 } });
  var rec = recoveryMod.create({ config: c });
  rec.request('EURUSD'); rec.request('EURUSD'); rec.request('EURUSD'); rec.request('EURUSD');
  rec.noteClamped(); rec.noteClamped();
  var s = rec.stats();
  assert.equal(s.requestsMade, 4);
  assert.equal(s.clamped, 2);
  assert.equal(s.clampRate, 0.5);
});

// ---------------------------------------------------------------------------
// 6. THE OWNER'S CONSTRAINT, PROVEN
// ---------------------------------------------------------------------------

test('PROPERTY: recovery can never exceed the risk limits, at any rung, on any account', function () {
  // The owner's instruction, tested directly: "It must never override the Risk
  // Engine or the maximum-loss limits." Every ladder rung, across a range of
  // account sizes, stop distances and instruments, is pushed through the Risk
  // Engine and the approved size is checked against every cap.
  var gen = rngMod.create('recovery-property');
  var instruments = [EUR, GOLD, CATALOG.get('USDJPY')];
  var cases = 0, clampedCases = 0, blockedCases = 0, allowedAtLadderSize = 0;

  for (var i = 0; i < 400; i++) {
    var inst = gen.pick(instruments);
    var equity = gen.uniform(50, 20000);
    var riskPct = gen.uniform(0.5, 10);
    var maxPos = money.round(gen.uniform(0.01, 1), 2);
    var maxLevel = gen.int(1, 5);
    var stopPips = gen.uniform(8, 300);

    var c = cfg({
      risk: {
        maxAccountRiskPerTradePct: riskPct, maxPositionSizeLots: maxPos,
        minStopPips: 0.1, maxStopPips: 100000, minRewardRisk: 0, minNetExpectedValue: -1e6,
        maxDailyLossPct: 49, maxDrawdownPct: 89
      },
      recovery: { enabled: true, maxRecoveryLevel: maxLevel, multiplier: 3, baseLots: 0.01 }
    });
    var riskEngine = riskMod.create({ config: c });
    var rec = recoveryMod.create({ config: c, logger: loggerMod.nullLogger() });
    var acct = account(equity);
    var cand = candidate({
      instrument: inst, entry: inst.referencePrice, stopPips: stopPips,
      targetPips: stopPips * 3, spreadPips: inst.typicalSpreadPips
    }, c);

    for (var level = 0; level <= maxLevel; level++) {
      var request = rec.request(inst.symbol);
      var res = riskEngine.assess({
        candidate: cand, instrument: inst, account: acct,
        requestedLots: request.requestedLots, ts: TS, recoveryLevel: request.level
      });
      cases++;

      if (res.verdict === 'BLOCK') {
        blockedCases++;
        assert.equal(res.approvedLots, 0, 'a blocked recovery trade must have no size at all');
      } else {
        if (res.verdict === 'CLAMP') clampedCases++;
        else if (request.level > 0) allowedAtLadderSize++;
        var approvedRisk = instrumentMod.riskMoneyForLots(inst, res.approvedLots, cand.riskPips, inst.referencePrice);
        var budget = equity * riskPct / 100;
        assert.ok(approvedRisk <= budget + 0.01,
          'recovery level ' + level + ' was approved at $' + approvedRisk.toFixed(4) +
          ' of risk against a $' + budget.toFixed(4) + ' budget');
        assert.ok(res.approvedLots <= maxPos + 1e-9,
          'recovery level ' + level + ' was approved at ' + res.approvedLots + ' lots against a ' + maxPos + ' cap');
        assert.ok(res.approvedLots <= request.requestedLots + 1e-9,
          'the approved size exceeded what recovery even asked for');
        assert.ok(res.approvedLots <= inst.maxLot + 1e-9);
      }

      // Advance the ladder with a loss sized at whatever was actually approved.
      rec.onTradeClosed({
        symbol: inst.symbol, outcome: 'LOSS',
        netPnl: -Math.max(0.01, instrumentMod.riskMoneyForLots(inst, Math.max(res.approvedLots, inst.minLot), cand.riskPips, inst.referencePrice)),
        exitTs: TS, tradeId: 'p' + i + '-' + level
      });
    }
  }

  assert.ok(cases > 1000, 'only ' + cases + ' ladder rungs were tested');
  assert.ok(clampedCases > 0, 'the ladder was never clamped, so the clamp was never exercised');
  assert.ok(blockedCases > 0, 'the ladder was never blocked, so the block was never exercised');
});

test('on the owner\'s $100 account the ladder is clamped to the minimum immediately', function () {
  // The concrete statement in ADR-0002 and COMPLIANCE §3.2, asserted rather than
  // described: at $100 with a 2 % cap and a 20-pip stop, 0.01 lots already risks
  // the entire budget, so levels 1 and 2 are cut straight back to 0.01.
  var c = cfg({ recovery: { enabled: true, maxRecoveryLevel: 2 } });
  var riskEngine = riskMod.create({ config: c });
  var rec = recoveryMod.create({ config: c });
  var acct = account(100);
  var cand = candidate({ stopPips: 20 }, c);

  var approvals = [];
  for (var level = 0; level <= 2; level++) {
    var request = rec.request('EURUSD');
    var res = riskEngine.assess({
      candidate: cand, instrument: EUR, account: acct,
      requestedLots: request.requestedLots, ts: TS, recoveryLevel: request.level
    });
    approvals.push({ requested: request.requestedLots, approved: res.approvedLots, verdict: res.verdict });
    rec.onTradeClosed({ symbol: 'EURUSD', outcome: 'LOSS', netPnl: -2, exitTs: TS, tradeId: 'l' + level });
  }

  assert.deepEqual(approvals.map(function (a) { return a.requested; }), [0.01, 0.03, 0.09]);
  assert.deepEqual(approvals.map(function (a) { return a.approved; }), [0.01, 0.01, 0.01]);
  assert.deepEqual(approvals.map(function (a) { return a.verdict; }), ['ALLOW', 'CLAMP', 'CLAMP']);
});

test('no component other than the Risk Engine exposes a way to set a final size', function () {
  // Structural check of the authority rule: the recovery engine returns a
  // REQUEST, and nothing in its API hands back a size a caller could act on.
  var rec = recoveryMod.create({ config: cfg({ recovery: { enabled: true } }) });
  assert.equal(rec.approvedLots, undefined);
  assert.equal(rec.setLots, undefined);
  assert.equal(rec.forceSize, undefined);
  assert.equal(rec.override, undefined);
  var r = rec.request('EURUSD');
  assert.ok(r.requestedLots !== undefined);
  assert.equal(r.approvedLots, undefined, 'recovery must never speak of an approved size');
});
