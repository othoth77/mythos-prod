'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — Risk and Recovery view tests
// projects/mythos-trading-control-center/tests/risk-recovery-test.js
//
// The Risk and Recovery pages make one claim above all: the Risk Engine is
// authoritative, and the recovery ladder only requests. This suite checks that
// what the API reports is consistent with that claim, on real runs, against
// the raw store — and that no route offers a way around it.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');

var h = require('./helpers');

var S, owner, viewer, ladder, flat, tables;
var COMMON = { symbols: ['EURUSD', 'GBPUSD'], initialCapital: 5000, data: { kind: 'FIXTURE', bars: 1800 },
  jev: { scoreThreshold: 45, minConfidence: 0.15 }, cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 } };

test.before(async function () {
  S = await h.startApp();
  owner = await S.login('owner');
  viewer = await S.login('viewer');
  ladder = await h.runBacktest(owner, Object.assign({}, COMMON, { recovery: { enabled: true, maxRecoveryLevel: 3 }, risk: { maxPositionSizeLots: 0.05 } }));
  assert.equal(ladder.status, 'COMPLETED', JSON.stringify(ladder.error));
  flat = await h.runBacktest(owner, Object.assign({}, COMMON, { recovery: { enabled: false, maxRecoveryLevel: 3 } }));
  assert.equal(flat.status, 'COMPLETED', JSON.stringify(flat.error));
  tables = S.app.platform.runs.tables(ladder.runId, 'store').tables;
});

test.after(async function () { await S.close(); });

async function risk(runId) { return (await viewer.get('/api/risk?run=' + runId)).body.result; }
async function recovery(runId) { return (await viewer.get('/api/recovery?run=' + runId)).body.result; }

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

test('the risk view reports the configured limits and states the Risk Engine\'s authority', async function () {
  var r = await risk(ladder.runId);
  var cfg = (await viewer.get('/api/config')).body.result.config.risk;
  ['maxAccountRiskPerTradePct', 'maxPositionSizeLots', 'maxDailyLossPct', 'maxDrawdownPct', 'maxConsecutiveLosses', 'maxOpenTrades'].forEach(function (k) {
    assert.equal(r.limits[k], cfg[k], k);
  });
  assert.equal(r.limits.maxOpenTrades, 1);
  assert.match(r.authority, /FINAL/);
  assert.match(r.authority, /no route in this API sets a size/);
  assert.equal(r.tradingEnabled, true);
});

test('verdict counts are the store\'s, and every verdict is one of ALLOW, CLAMP, BLOCK', async function () {
  var d = (await risk(ladder.runId)).data;
  assert.equal(d.assessments, tables.risk_assessments.length);
  ['ALLOW', 'CLAMP', 'BLOCK'].forEach(function (v) {
    assert.equal(d.byVerdict[v], tables.risk_assessments.filter(function (r) { return r.verdict === v; }).length, v);
  });
  assert.equal(d.byVerdict.ALLOW + d.byVerdict.CLAMP + d.byVerdict.BLOCK, d.assessments);
  assert.ok(d.byVerdict.CLAMP > 0, 'the ladder asked for more than the 0.05 cap, so clamps are expected');
  assert.ok(d.byVerdict.BLOCK > 0);
});

test('a CLAMP approves less than was requested and never more than the cap', async function () {
  var d = (await risk(ladder.runId)).data;
  assert.ok(d.clamps.length > 0);
  d.clamps.forEach(function (c) {
    assert.ok(c.approvedLots < c.requestedLots, 'a clamp must reduce the size');
    assert.ok(c.approvedLots > 0);
    assert.ok(c.approvedLots <= 0.05 + 1e-9, 'approved above the position cap: ' + c.approvedLots);
    assert.ok(c.reasonCodes.length > 0, 'a clamp must be named');
  });
  tables.risk_assessments.forEach(function (r) {
    assert.ok(r.approvedLots <= r.requestedLots + 1e-9, 'the Risk Engine approved more than was requested');
    assert.ok(r.approvedLots <= 0.05 + 1e-9);
  });
});

test('a BLOCK approves nothing, and a blocked candidate never becomes a trade', async function () {
  var d = (await risk(ladder.runId)).data;
  d.blocks.forEach(function (b) {
    assert.equal(b.approvedLots, 0);
    assert.ok(b.reasonCodes.length > 0, 'a block must give its reason');
  });
  var blocked = {};
  tables.risk_assessments.filter(function (r) { return r.verdict === 'BLOCK'; }).forEach(function (r) { blocked[r.candidateId] = true; });
  tables.trades.forEach(function (t) { assert.ok(!blocked[t.candidateId], 'trade ' + t.tradeId + ' came from a blocked candidate'); });
  tables.orders.forEach(function (o) { assert.ok(!blocked[o.candidateId], 'an order was placed for a blocked candidate'); });
});

test('every trade ran at exactly the size the Risk Engine approved', function () {
  var approved = {};
  tables.risk_assessments.forEach(function (r) { approved[r.candidateId] = r.approvedLots; });
  assert.ok(tables.trades.length > 20);
  tables.trades.forEach(function (t) { assert.equal(t.lots, approved[t.candidateId], t.tradeId); });
});

test('the last-observed block shows budget, exposure, drawdown, daily loss, consecutive losses and position limits', async function () {
  var d = (await risk(ladder.runId)).data;
  ['RISK_BUDGET_MONEY', 'MAX_DRAWDOWN_PCT', 'MAX_DAILY_LOSS_PCT', 'MAX_CONSECUTIVE_LOSSES', 'MAX_POSITION_SIZE_LOTS', 'EMERGENCY_STOP'].forEach(function (k) {
    assert.ok(d.lastObserved[k], 'no ' + k + ' in the last-observed limits');
  });
  // Each limit shows its MOST RECENT stored measurement, with the bar it was taken at.
  Object.keys(d.lastObserved).forEach(function (name) {
    var found = null;
    for (var i = tables.risk_assessments.length - 1; i >= 0 && !found; i--) {
      var row = tables.risk_assessments[i];
      var l = row.limitsChecked.filter(function (x) { return x.limit === name; })[0];
      if (l) found = { observed: l.observed, limit: l.limitValue, binding: l.binding, ts: row.ts };
    }
    assert.deepEqual(d.lastObserved[name], found, name);
  });
  var eq = tables.equity_curve[tables.equity_curve.length - 1];
  assert.deepEqual(d.exposure, { ts: eq.ts, equity: eq.equity, balance: eq.balance, openRiskMoney: eq.openRisk, drawdownPct: eq.drawdownPct });
});

test('risk events are the stored breaker and emergency-stop events', async function () {
  var d = (await risk(ladder.runId)).data;
  var stored = tables.system_events.filter(function (e) { return /EMERGENCY_STOP|STREAK_BREAKER|RISK/.test(e.kind); });
  assert.equal(d.events.length, Math.min(40, stored.length));
  d.events.forEach(function (e) { assert.ok(/EMERGENCY_STOP|STREAK_BREAKER|RISK/.test(e.kind)); });
});

test('with trading disabled the Risk Engine blocks every candidate, naming the emergency stop', async function () {
  await owner.post('/api/config/trading', { enabled: false, reason: 'risk test: disable trading' });
  var run = await h.runBacktest(owner, { symbols: ['EURUSD'], data: { kind: 'FIXTURE', bars: 900 }, verifyReproducible: false });
  assert.equal(run.summary.headline.trades, 0);
  var r = await risk(run.runId);
  assert.equal(r.tradingEnabled, false);
  assert.equal(r.limits.emergencyStop, true);
  var t = S.app.platform.runs.tables(run.runId, 'store').tables;
  assert.equal((t.trades || []).length, 0);
  assert.equal((t.orders || []).length, 0, 'no order may be placed while the emergency stop is set');
  var stops = (t.system_events || []).filter(function (e) { return /EMERGENCY_STOP/.test(e.kind); });
  assert.ok(stops.length > 0, 'the stop must be on the record');
  await owner.post('/api/config/trading', { enabled: true, reason: 'risk test: enable trading again', confirm: 'ENABLE' });
});

test('no route accepts a size, an override or a verdict', async function () {
  for (var body of [{ approvedLots: 1 }, { lots: 1 }, { verdict: 'ALLOW' }, { override: true }, { forceSize: 0.5 }]) {
    assert.equal((await owner.post('/api/backtest', body)).status, 400, JSON.stringify(body));
    assert.equal((await owner.post('/api/paper/start', body)).status, 400, JSON.stringify(body));
  }
  for (var changes of [{ risk: { approvedLots: 1 } }, { risk: { override: true } }, { recovery: { approvedLots: 1 } }, { recovery: { forceSize: 1 } }]) {
    var res = await owner.patch('/api/config', { changes: changes, reason: 'attempt to set a size', confirm: 'CONFIRM' });
    assert.equal(res.status, 400, JSON.stringify(changes));
  }
  assert.equal((await owner.post('/api/risk', { verdict: 'ALLOW' })).status, 405);
  assert.equal((await owner.post('/api/recovery', { level: 0 })).status, 405);
});

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

test('the recovery view shows the configured ladder and that it only requests', async function () {
  var r = await recovery(ladder.runId);
  assert.match(r.authority, /REQUEST ONLY/);
  var c = r.configured;
  assert.deepEqual(c.requestedLadder, [0.01, 0.03, 0.09, 0.27]);
  assert.equal(c.multiplier, 3);
  assert.equal(c.enabled, false, 'the PLATFORM default is off; the run enabled it for itself');
});

test('recovery state is per asset, never exceeds the cap, and matches the store', async function () {
  var d = (await recovery(ladder.runId)).data;
  assert.equal(d.transitions, tables.recovery_states.length);
  assert.ok(d.transitions > 10);
  assert.equal(d.perAsset.length, 2);
  d.perAsset.forEach(function (a) {
    var rows = tables.recovery_states.filter(function (r) { return r.symbol === a.symbol; });
    if (!rows.length) { assert.equal(a.recorded, false); return; }
    var last = rows[rows.length - 1];
    assert.equal(a.level, last.level);
    assert.equal(a.cumulativeLossMoney, last.cumulativeLossMoney);
    assert.equal(a.lastReason, last.reason);
    assert.equal(a.transitions, rows.length);
    assert.equal(a.maxLevel, Math.max.apply(null, rows.map(function (r) { return r.level; })));
    assert.ok(a.maxLevel <= 3, a.symbol + ' went past maxRecoveryLevel');
    assert.equal(a.resets, rows.filter(function (r) { return r.reason === 'WIN_RESET'; }).length);
  });
  tables.recovery_states.forEach(function (r) { assert.ok(r.level <= 3, 'a recovery state above the cap was recorded'); });
});

test('requested versus approved: the ladder asks, the Risk Engine answers, and the answer is never larger', async function () {
  var d = (await recovery(ladder.runId)).data;
  var cands = {};
  tables.candidates.forEach(function (c) { cands[c.candidateId] = c; });
  d.perAsset.forEach(function (a) {
    if (a.requestedLots === null) return;
    assert.ok(a.approvedLots <= a.requestedLots);
    var mine = tables.risk_assessments.filter(function (r) { return cands[r.candidateId].symbol === a.symbol; });
    var last = mine[mine.length - 1];
    assert.equal(a.requestedLots, last.requestedLots);
    assert.equal(a.approvedLots, last.approvedLots);
    assert.equal(a.riskVerdict, last.verdict);
  });
  // The ladder really did ask for more than base at some point.
  assert.ok(tables.risk_assessments.some(function (r) { return r.requestedLots >= 0.03; }), 'recovery never escalated in this run');
  assert.ok(tables.recovery_states.some(function (r) { return r.nextLotsUncapped > 0.05; }), 'the uncapped wish must be recorded even past the cap');
});

test('with recovery disabled the ladder never leaves the base level', async function () {
  var d = (await recovery(flat.runId)).data;
  var t = S.app.platform.runs.tables(flat.runId, 'store').tables;
  (t.recovery_states || []).forEach(function (r) { assert.equal(r.level, 0); });
  t.risk_assessments.forEach(function (r) { assert.equal(r.requestedLots, 0.01, 'a disabled ladder must always request the base size'); });
  t.trades.forEach(function (x) { assert.equal(x.recoveryLevel, 0); });
  d.perAsset.forEach(function (a) { if (a.recorded) assert.equal(a.maxLevel, 0); });
});

test('recovery failures are counted, not hidden', async function () {
  var d = (await recovery(ladder.runId)).data;
  var cap = tables.recovery_states.filter(function (r) { return r.reason === 'CAP_ABANDONED'; }).length;
  var byRisk = tables.recovery_states.filter(function (r) { return r.reason === 'RISK_BLOCK_ABANDONED'; }).length;
  assert.equal(d.perAsset.reduce(function (a, x) { return a + (x.abandonedAtCap || 0); }, 0), cap);
  assert.equal(d.perAsset.reduce(function (a, x) { return a + (x.abandonedByRisk || 0); }, 0), byRisk);
  var result = (await viewer.get('/api/backtest/' + ladder.runId)).body.result.result;
  assert.equal(result.results.recoveryFailures.abandonedAtCap, cap);
  assert.equal(result.results.recoveryFailures.abandonedByRisk, byRisk);
  var reasons = {};
  d.byReason.forEach(function (r) { reasons[r.value] = r.count; });
  assert.equal(reasons.CAP_ABANDONED || 0, cap);
});

test('enabling recovery on the platform is a loosening that needs the owner\'s confirmation', async function () {
  var res = await owner.patch('/api/config', { changes: { recovery: { enabled: true } }, reason: 'enable the ladder' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'CONFIRMATION_REQUIRED');
  assert.deepEqual(res.body.error.loosened.map(function (l) { return l.path; }), ['recovery.enabled']);
  var up = await owner.patch('/api/config', { changes: { recovery: { maxRecoveryLevel: 5 } }, reason: 'raise the cap' });
  assert.equal(up.status, 409, 'raising the recovery cap is a loosening too');
  assert.equal((await viewer.get('/api/config')).body.result.config.recovery.enabled, false);
  var zero = await owner.patch('/api/config', { changes: { recovery: { enabled: true, maxRecoveryLevel: 0 } }, reason: 'enabled with no level', confirm: 'CONFIRM' });
  assert.equal(zero.status, 400, 'the agent refuses an enabled ladder with no level');
});
