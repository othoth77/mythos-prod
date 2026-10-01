'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — Backtest Center tests
// projects/mythos-trading-control-center/tests/backtest-test.js
//
// A backtest request is a set of inputs; a run is the record of what they
// produced. This suite checks both directions:
//
//   INPUTS ARE HONOURED   each input the Backtest Center offers — asset,
//                          timeframe, date range, strategies, Jev, risk,
//                          recovery, spread, commission, slippage, capital —
//                          provably changes the run it should change.
//   THE RECORD IS COMPLETE every run carries its id, timestamps, configuration,
//                          commit, data source, status and label, and can be
//                          reproduced from them.
//   THE CHARTS ADD UP     each chart is the stored rows, re-counted.
//   FAILURE IS VISIBLE    a run that times out or is interrupted says so.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var h = require('./helpers');

var S, owner, viewer;
var BASE = { symbols: ['EURUSD'], data: { kind: 'FIXTURE', bars: 1200 }, initialCapital: 5000,
  jev: { scoreThreshold: 45, minConfidence: 0.15 }, cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 } };

test.before(async function () {
  S = await h.startApp();
  owner = await S.login('owner');
  viewer = await S.login('viewer');
});

test.after(async function () { await S.close(); });

async function run(over) {
  var r = await h.runBacktest(owner, Object.assign({}, BASE, over || {}));
  assert.equal(r.status, 'COMPLETED', JSON.stringify(r.error));
  return r;
}
async function detail(runId) { return (await viewer.get('/api/backtest/' + runId)).body.result; }

var baseline;

// ---------------------------------------------------------------------------
// the record
// ---------------------------------------------------------------------------

test('a run records id, timestamps, configuration, commit, data source, status and label', async function () {
  baseline = await run({ label: 'baseline-run' });
  var d = await detail(baseline.runId);
  assert.match(d.run.runId, /^bt-\d{14}-[0-9a-f]{6}$/);
  assert.equal(d.run.kind, 'BACKTEST');
  assert.equal(d.run.status, 'COMPLETED');
  assert.equal(d.run.label, 'baseline-run');
  assert.ok(Date.parse(d.run.startedAt) <= Date.parse(d.run.finishedAt));
  assert.ok(d.run.durationMs > 0);
  assert.match(d.run.commit, /^[0-9a-f]{40}$/);
  assert.equal(d.run.commit, d.result.commit);
  assert.match(d.run.configHash, /^[0-9a-f]{64}$/);
  assert.equal(d.run.configHash, d.result.configHash);
  assert.equal(d.result.config.fingerprint.hash, d.run.configHash, 'the stored configuration hashes to the recorded hash');
  assert.equal(d.run.actor.id, 'owner');
  assert.equal(d.result.data.kind, 'FIXTURE');
  assert.equal(d.result.data.label, 'SYNTHETIC');
  assert.match(d.result.data.datasetVersion, /^fixtures-[0-9a-f]{12}:1200$/);
  assert.equal(d.result.data.window.bars, 1200);
  assert.equal(d.dataLabel, 'SYNTHETIC');
  assert.deepEqual(d.run.request.symbols, ['EURUSD']);
  assert.equal(d.run.request.initialCapital, 5000);
});

test('the same inputs produce the same store digest; the run says it verified that', async function () {
  var again = await run({ label: 'baseline-run' });
  var a = await detail(baseline.runId);
  var b = await detail(again.runId);
  assert.equal(a.result.reproducible, true);
  assert.equal(b.result.reproducible, true);
  assert.equal(a.result.digest, b.result.digest, 'two runs of one configuration over one dataset must be identical');
  assert.equal(a.result.configHash, b.result.configHash);
  assert.notEqual(a.run.runId, b.run.runId);
  var unverified = await run({ label: 'baseline-run', verifyReproducible: false });
  var c = await detail(unverified.runId);
  assert.equal(c.result.reproducible, null, 'an unverified run must not claim to be reproducible');
  assert.equal(c.result.digest, a.result.digest);
  var check = c.result.health.checks.filter(function (x) { return x.check === 'BACKTEST_REPRODUCIBLE'; })[0];
  assert.equal(check.status, 'UNKNOWN');
});

test('every result block the mission names is present and consistent with the metrics', async function () {
  var d = await detail(baseline.runId);
  var r = d.result.results;
  var m = d.result.metrics;
  assert.equal(r.netPnl, m.netPnl);
  assert.equal(r.returnPct, m.returnPct);
  assert.equal(r.maxDrawdownPct, m.maxDrawdownPct);
  assert.equal(r.winRate, m.winRate);
  assert.equal(r.profitFactor, m.profitFactor);
  assert.equal(r.expectancy, m.expectancy);
  assert.equal(r.trades, m.tradeCount);
  assert.equal(r.avgWin, m.avgWin);
  assert.equal(r.avgLoss, m.avgLoss);
  assert.equal(r.maxConsecutiveLosses, m.maxConsecutiveLosses);
  assert.equal(r.largestPositionLots, m.largestPositionLots);
  assert.ok(typeof r.recoveryFailures.abandonedAtCap === 'number');
  assert.equal(r.costs.total, m.totalCosts);
  var b = r.costs.byComponent;
  assert.ok(Math.abs(b.spreadMoney + b.commissionMoney + b.slippageMoney + b.swapMoney - r.costs.total) < 1e-6, 'cost components must sum to the total');
  assert.ok(Math.abs(m.grossPnl - m.totalCosts - m.netPnl) < 1e-6, 'net = gross − costs');
});

test('the charts are the stored rows, re-counted', async function () {
  var d = await detail(baseline.runId);
  var c = d.charts;
  var tables = S.app.platform.runs.tables(baseline.runId, 'store').tables;
  var m = d.result.metrics;
  assert.equal(c.equity.points, tables.equity_curve.length);
  var last = c.equity.series[c.equity.series.length - 1];
  assert.equal(last.equity, tables.equity_curve[tables.equity_curve.length - 1].equity, 'the curve ends exactly where the store ends');
  assert.equal(c.equity.series[0].equity, 5000);
  assert.ok(Math.max.apply(null, c.equity.series.map(function (p) { return p.drawdownPct; })) <= m.maxDrawdownPct + 1e-9);
  assert.equal(c.tradeDistribution.reduce(function (a, x) { return a + x.count; }, 0), m.tradeCount);
  var contrib = c.strategyContribution.reduce(function (a, x) { return a + x.netPnl; }, 0);
  assert.ok(Math.abs(contrib - m.netPnl) < 1e-3, 'strategy contributions sum to the net result');
  assert.equal(c.strategyContribution.reduce(function (a, x) { return a + x.trades; }, 0), m.tradeCount);
  assert.equal(c.jevBands.reduce(function (a, x) { return a + x.considered; }, 0), tables.jev_decisions.length);
  assert.equal(c.jevBands.reduce(function (a, x) { return a + x.trades; }, 0), m.tradeCount);
  assert.deepEqual(c.jevBands.map(function (x) { return x.band; }), ['70-79', '80-89', '90-94', '95-100', 'BELOW_70']);
  assert.equal(c.regimeDistribution.reduce(function (a, x) { return a + x.count; }, 0), tables.regimes.length);
});

// ---------------------------------------------------------------------------
// inputs are honoured
// ---------------------------------------------------------------------------

test('INPUT initial capital', async function () {
  var r = await run({ initialCapital: 250 });
  var d = await detail(r.runId);
  assert.equal(d.result.config.account.initialCapital, 250);
  assert.equal(d.result.metrics.initialCapital, 250);
  assert.equal(d.charts.equity.series[0].equity, 250);
  assert.notEqual(d.run.configHash, baseline.configHash);
});

test('INPUT asset: a multi-asset run trades more than one instrument and stays one-trade-only', async function () {
  var r = await run({ symbols: ['EURUSD', 'GBPUSD', 'XAUUSD'] });
  var d = await detail(r.runId);
  assert.deepEqual(d.result.data.symbols, ['EURUSD', 'GBPUSD', 'XAUUSD']);
  assert.deepEqual(d.result.config.universe, ['EURUSD', 'GBPUSD', 'XAUUSD']);
  var trades = (await viewer.get('/api/trades?run=' + r.runId + '&limit=500')).body.result.data.items;
  var symbols = {};
  trades.forEach(function (t) { symbols[t.symbol] = true; });
  assert.ok(Object.keys(symbols).length >= 2, 'traded only ' + Object.keys(symbols).join(','));
  var one = d.result.health.checks.filter(function (c) { return c.check === 'ONE_TRADE_ONLY'; })[0];
  assert.equal(one.status, 'OK', one.detail);
  assert.equal(one.numbers.maxConcurrent, 1);
});

test('INPUT strategies: only the chosen families produce candidates', async function () {
  var r = await run({ strategies: ['momentum', 'breakout'] });
  var d = await detail(r.runId);
  assert.deepEqual(d.result.enabledStrategies, ['momentum', 'breakout']);
  var cands = (await viewer.get('/api/candidates?run=' + r.runId + '&limit=500')).body.result.data.items;
  assert.ok(cands.length > 0);
  var seen = {};
  cands.forEach(function (c) { seen[c.strategyId] = true; });
  assert.deepEqual(Object.keys(seen).sort(), ['breakout', 'momentum']);
  assert.notEqual(d.run.configHash, baseline.configHash, 'the strategy set is inside the fingerprint');
});

test('INPUT Jev: a higher threshold enters fewer candidates and never more', async function () {
  var strict = await run({ jev: { scoreThreshold: 60, minConfidence: 0.15 } });
  var a = await detail(baseline.runId);
  var b = await detail(strict.runId);
  assert.equal(b.result.config.jev.scoreThreshold, 60);
  assert.ok(b.result.pipeline.rejectedByJev > a.result.pipeline.rejectedByJev, 'a stricter gate must reject more');
  var verdicts = S.app.platform.runs.tables(strict.runId, 'store').tables.jev_decisions;
  verdicts.forEach(function (v) {
    assert.equal(v.threshold, 60);
    if (v.decision === 'ENTER') assert.ok(v.score >= 60, 'a verdict below the threshold was allowed: ' + v.score);
  });
});

test('INPUT risk: the limits reach the Risk Engine and bind', async function () {
  var r = await run({ risk: { maxPositionSizeLots: 0.02, maxAccountRiskPerTradePct: 0.5, maxDrawdownPct: 15, maxDailyLossPct: 3, maxConsecutiveLosses: 3 },
    recovery: { enabled: true, maxRecoveryLevel: 3 } });
  var d = await detail(r.runId);
  var cfg = d.result.config.risk;
  assert.equal(cfg.maxPositionSizeLots, 0.02);
  assert.equal(cfg.maxAccountRiskPerTradePct, 0.5);
  assert.equal(cfg.maxConsecutiveLosses, 3);
  var trades = (await viewer.get('/api/trades?run=' + r.runId + '&limit=500')).body.result.data.items;
  assert.ok(trades.length > 0);
  trades.forEach(function (t) { assert.ok(t.lots <= 0.02 + 1e-9, 'a trade exceeded the position cap: ' + t.lots); });
  assert.ok(d.result.metrics.largestPositionLots <= 0.02 + 1e-9);
  var risk = (await viewer.get('/api/risk?run=' + r.runId)).body.result.data;
  assert.ok(risk.byVerdict.CLAMP > 0, 'the recovery ladder asked for more than the cap, so clamps are expected');
  risk.clamps.forEach(function (c) { assert.ok(c.approvedLots < c.requestedLots); });
});

test('INPUT recovery: enabling the ladder produces recovery states; disabled produces none above base', async function () {
  var on = await run({ recovery: { enabled: true, maxRecoveryLevel: 2 } });
  var d = await detail(on.runId);
  assert.equal(d.result.config.recovery.enabled, true);
  assert.equal(d.result.config.recovery.maxRecoveryLevel, 2);
  var rec = (await viewer.get('/api/recovery?run=' + on.runId)).body.result.data;
  assert.ok(rec.transitions > 0);
  assert.ok(rec.perAsset[0].maxLevel <= 2, 'the ladder went past its cap');
  var off = (await viewer.get('/api/recovery?run=' + baseline.runId)).body.result.data;
  assert.ok(off.history.every(function (r) { return r.level === 0; }), 'a disabled ladder must stay at base level');
  assert.equal((await detail(baseline.runId)).result.metrics.maxRecoveryLevel, 0);
});

test('INPUT spread, commission, slippage: costs move the way the inputs say', async function () {
  var cheap = await run({ cost: { spreadModel: 'fixed', fixedSpreadPips: 0.5, slippageModel: 'none', includeCommission: true, includeSwap: true } });
  var dear = await run({ cost: { spreadModel: 'fixed', fixedSpreadPips: 2.4, slippageModel: 'fixed', fixedSlippagePips: 1.5, includeCommission: true, includeSwap: true } });
  var a = (await detail(cheap.runId)).result;
  var b = (await detail(dear.runId)).result;
  assert.equal(a.config.cost.fixedSpreadPips, 0.5);
  assert.equal(b.config.cost.fixedSlippagePips, 1.5);
  assert.equal(a.results.costs.byComponent.slippageMoney, 0, 'slippage model "none" must charge no slippage');
  assert.ok(b.results.costs.byComponent.slippageMoney > 0);
  var perTradeA = a.results.costs.total / a.results.trades;
  var perTradeB = b.results.costs.total / b.results.trades;
  assert.ok(perTradeB > perTradeA * 2, 'a wider spread and slippage must cost more per trade (' + perTradeA.toFixed(4) + ' vs ' + perTradeB.toFixed(4) + ')');
  // XAUUSD carries a commission; switching it off must remove exactly that component.
  var withC = await run({ symbols: ['XAUUSD'], cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3, includeCommission: true } });
  var noC = await run({ symbols: ['XAUUSD'], cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3, includeCommission: false } });
  var wc = (await detail(withC.runId)).result;
  var nc = (await detail(noC.runId)).result;
  if (wc.results.trades > 0 && nc.results.trades > 0) {
    assert.equal(nc.results.costs.byComponent.commissionMoney, 0);
    assert.equal(nc.config.cost.includeCommission, false);
  }
});

test('INPUT timeframe and synthetic data: reproducible from the seed, different with another', async function () {
  var a = await run({ symbols: ['AUDUSD'], timeframe: 'H1', data: { kind: 'SYNTHETIC', bars: 900, seed: 'seed-a' } });
  var b = await run({ symbols: ['AUDUSD'], timeframe: 'H1', data: { kind: 'SYNTHETIC', bars: 900, seed: 'seed-a' } });
  var c = await run({ symbols: ['AUDUSD'], timeframe: 'H1', data: { kind: 'SYNTHETIC', bars: 900, seed: 'seed-b' } });
  var da = (await detail(a.runId)).result;
  var db = (await detail(b.runId)).result;
  var dc = (await detail(c.runId)).result;
  assert.equal(da.data.kind, 'SYNTHETIC');
  assert.equal(da.data.label, 'SYNTHETIC');
  assert.equal(da.data.timeframe, 'H1');
  assert.equal(da.config.backtest.baseTimeframe, 'H1');
  assert.equal(da.data.provenance.seed, 'seed-a');
  assert.equal(da.digest, db.digest, 'the same seed must reproduce the same run');
  assert.equal(da.data.datasetVersion, db.data.datasetVersion);
  assert.notEqual(da.data.datasetVersion, dc.data.datasetVersion);
  assert.notEqual(da.digest, dc.digest);
  var bad = await owner.post('/api/backtest', Object.assign({}, BASE, { timeframe: 'H1' }));
  assert.equal(bad.status, 400, 'fixtures exist at M15 only');
});

test('INPUT date range: the run sees only the bars inside it', async function () {
  var fromTs = Date.parse('2023-01-10T00:00:00Z');
  var toTs = Date.parse('2023-01-31T23:59:59Z');
  var r = await run({ data: { kind: 'FIXTURE' }, fromTs: fromTs, toTs: toTs });
  var d = (await detail(r.runId)).result;
  assert.ok(d.data.window.fromTs >= fromTs);
  assert.ok(d.data.window.toTs <= toTs);
  assert.deepEqual(d.data.range, { fromTs: fromTs, toTs: toTs });
  assert.match(d.data.datasetVersion, /:range-/);
  var trades = (await viewer.get('/api/trades?run=' + r.runId + '&limit=500')).body.result.data.items;
  trades.forEach(function (t) { assert.ok(t.entryTs >= fromTs && t.exitTs <= toTs + 1, 'a trade fell outside the requested range'); });
  var tooShort = await owner.post('/api/backtest', Object.assign({}, BASE, { fromTs: fromTs, toTs: fromTs + 3600000 }));
  assert.equal(tooShort.status, 400);
  assert.match(tooShort.body.error.message, /bars in the requested window/);
  var inverted = await owner.post('/api/backtest', Object.assign({}, BASE, { fromTs: toTs, toTs: fromTs }));
  assert.equal(inverted.status, 400);
});

// ---------------------------------------------------------------------------
// labels and claims
// ---------------------------------------------------------------------------

test('every run in the list is labelled, and no dataset is ever labelled HISTORICAL', async function () {
  var list = (await viewer.get('/api/backtest')).body.result;
  assert.ok(list.runs.length >= 10);
  list.runs.forEach(function (r) {
    assert.ok(['SYNTHETIC', 'PAPER'].indexOf(r.label === 'PAPER' ? 'PAPER' : r.data.label) !== -1, r.runId + ' is unlabelled');
    assert.notEqual(r.data.label, 'HISTORICAL');
  });
  var hist = await owner.post('/api/backtest', { data: { kind: 'HISTORICAL' } });
  assert.equal(hist.status, 400);
});

test('a result never claims real-data provenance, and always carries its caveats', async function () {
  var d = (await detail(baseline.runId)).result;
  var prov = d.health.checks.filter(function (c) { return c.check === 'DATA_PROVENANCE'; })[0];
  assert.equal(prov.status, 'WARN');
  assert.match(prov.detail, /no statement about edge or profitability/);
  assert.ok(d.caveats.some(function (c) { return /synthetic|fixture|mechanics/i.test(c); }), 'the caveats must say the data is synthetic');
});

// ---------------------------------------------------------------------------
// failure is visible
// ---------------------------------------------------------------------------

test('a run that exceeds its time limit is recorded as TIMEOUT, not left running', async function () {
  var A = await h.startApp({ jobTimeoutMs: 150 });
  var o = await A.login('owner');
  var res = await o.post('/api/backtest', { symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'], data: { kind: 'FIXTURE', bars: 3000 } });
  assert.equal(res.status, 202);
  var id = res.body.result.run.runId;
  var done = await h.waitFor(async function () {
    var r = (await o.get('/api/jobs/' + id)).body.result.run;
    return r.status !== 'RUNNING' ? r : null;
  }, 30000, 100);
  assert.equal(done.status, 'TIMEOUT');
  assert.equal(done.error.code, 'JOB_TIMEOUT');
  var d = (await o.get('/api/backtest/' + id)).body.result;
  assert.equal(d.result, null, 'a run that did not finish has no result');
  assert.equal(d.charts, null);
  var sys = (await o.get('/api/system')).body.result;
  assert.ok(sys.events.some(function (e) { return e.kind === 'RUN_TIMEOUT'; }), 'the failure must be visible to the operator');
  var next = await o.post('/api/backtest', { symbols: ['EURUSD'], data: { kind: 'FIXTURE', bars: 400 }, verifyReproducible: false });
  assert.equal(next.status, 202, 'a timed-out run must free the worker');
  await h.waitFor(async function () { return (await o.get('/api/jobs/' + next.body.result.run.runId)).body.result.run.status !== 'RUNNING'; }, 30000, 100);
  await A.close();
});

test('a run left RUNNING by a stopped process is reported INTERRUPTED after a restart', async function () {
  var dir = h.tempDir('tcc-interrupted-');
  var A = await h.startApp({ stateDir: dir });
  var o = await A.login('owner');
  var done = await h.runBacktest(o, { symbols: ['EURUSD'], data: { kind: 'FIXTURE', bars: 600 }, verifyReproducible: false });
  await A.app.close();
  // Forge the state a crash would leave behind.
  var file = path.join(dir, 'runs', done.runId, 'run.json');
  var meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  meta.status = 'RUNNING';
  meta.finishedAt = null;
  fs.writeFileSync(file, JSON.stringify(meta));
  var B = await h.startApp({ stateDir: dir });
  var o2 = await B.login('owner');
  var r = (await o2.get('/api/jobs/' + done.runId)).body.result.run;
  assert.equal(r.status, 'INTERRUPTED');
  assert.equal(r.error.code, 'INTERRUPTED');
  assert.equal((await o2.get('/api/backtest')).body.result.active, null);
  await B.app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runs survive a restart, and only the newest are retained', async function () {
  var dir = h.tempDir('tcc-retention-');
  var A = await h.startApp({ stateDir: dir, maxRuns: 2 });
  var o = await A.login('owner');
  var ids = [];
  for (var i = 0; i < 3; i++) {
    var r = await h.runBacktest(o, { symbols: ['EURUSD'], data: { kind: 'FIXTURE', bars: 500 }, verifyReproducible: false, label: 'retention-' + i });
    ids.push(r.runId);
  }
  var list = (await o.get('/api/backtest')).body.result.runs.map(function (r) { return r.runId; });
  assert.deepEqual(list.sort(), ids.slice(1).sort(), 'the oldest run must be pruned');
  assert.equal(fs.existsSync(path.join(dir, 'runs', ids[0])), false, 'a pruned run leaves no directory behind');
  assert.equal((await o.get('/api/backtest/' + ids[0])).status, 404);
  await A.app.close();
  var B = await h.startApp({ stateDir: dir, maxRuns: 2 });
  var o2 = await B.login('owner');
  var after = (await o2.get('/api/backtest')).body.result.runs.map(function (r) { return r.runId; });
  assert.deepEqual(after.sort(), ids.slice(1).sort());
  var d = (await o2.get('/api/backtest/' + ids[2])).body.result;
  assert.equal(d.run.status, 'COMPLETED');
  assert.ok(d.result.metrics.tradeCount >= 0);
  assert.ok(d.charts.equity.series.length > 0, 'a run\'s store is readable after a restart');
  await B.app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('starting a run is audited with what was asked', async function () {
  var e = (await viewer.get('/api/audit?action=backtest.start&outcome=ACCEPTED&limit=1')).body.result.items[0];
  assert.equal(e.actor.id, 'owner');
  assert.match(e.target, /^run:bt-/);
  assert.ok(e.detail.request.symbols);
  var refused = (await viewer.get('/api/audit?action=backtest.start&outcome=REFUSED&limit=5')).body.result.items;
  assert.ok(refused.length > 0, 'refused requests are on the record too');
});
