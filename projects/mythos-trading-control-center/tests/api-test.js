'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — API contract tests
// projects/mythos-trading-control-center/tests/api-test.js
//
// Every route the mission names, exercised over HTTP against the real Trading
// Agent. Two halves:
//
//   BEFORE ANY RUN  every read model must say NO DATA with a reason. A number
//                   where there is no source would be a fabricated one.
//   AFTER A RUN     the same routes must carry the values the agent recorded,
//                   and they must agree with each other.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');

var h = require('./helpers');

var S, owner, viewer, run;

test.before(async function () {
  S = await h.startApp();
  owner = await S.login('owner');
  viewer = await S.login('viewer');
});

test.after(async function () { await S.close(); });

var REQUIRED_ROUTES = ['/api/health', '/api/status', '/api/dashboard', '/api/config', '/api/config/history',
  '/api/strategies', '/api/candidates', '/api/decisions', '/api/trades', '/api/jev', '/api/risk', '/api/recovery',
  '/api/paper', '/api/backtest', '/api/analysis', '/api/research', '/api/testing', '/api/activity', '/api/system'];

test('every route the mission names answers 200 for a signed-in viewer', async function () {
  for (var i = 0; i < REQUIRED_ROUTES.length; i++) {
    var r = await viewer.get(REQUIRED_ROUTES[i]);
    assert.equal(r.status, 200, REQUIRED_ROUTES[i] + ' → ' + r.status);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.result !== undefined, REQUIRED_ROUTES[i] + ' has no result');
    assert.equal(r.headers['cache-control'], 'no-store');
  }
});

test('the liveness probe is public and carries no detail when unauthenticated', async function () {
  var r = await S.client().get('/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.result).sort(), ['ok', 'service', 'time']);
  var authed = await viewer.get('/api/health');
  assert.equal(authed.body.result.liveExecutionAvailable, false);
  assert.ok(authed.body.result.health);
});

// ---------------------------------------------------------------------------
// before any run: NO DATA, with a reason
// ---------------------------------------------------------------------------

test('status reports BACKTEST, no LIVE, and trading enabled by default', async function () {
  var s = (await viewer.get('/api/status')).body.result;
  assert.equal(s.mode, 'BACKTEST');
  assert.deepEqual(s.modesAvailable, ['BACKTEST', 'PAPER']);
  assert.equal(s.liveExecution.available, false);
  assert.equal(s.tradingEnabled, true);
  assert.match(s.configFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(s.strategiesTotal, 14);
  assert.equal(s.strategiesEnabled, 14);
  assert.equal(s.paper.state, 'IDLE');
});

test('with no run, the dashboard says NO DATA with a reason and shows no number', async function () {
  var d = (await viewer.get('/api/dashboard')).body.result;
  ['account', 'performance', 'openPosition', 'regime', 'jev', 'risk', 'recovery'].forEach(function (k) {
    assert.equal(d[k].available, false, k + ' must be unavailable before any run');
    assert.ok(typeof d[k].reason === 'string' && d[k].reason.length > 10, k + ' must explain why');
  });
  assert.equal(d.account.balance, undefined);
  assert.equal(d.performance.winRate, undefined);
  assert.equal(d.mode, 'BACKTEST');
  assert.equal(d.tradingStatus, 'ENABLED');
  assert.equal(d.activeStrategies.enabled.length, 14);
  // Configured values are real and are shown even with no run.
  assert.equal(d.jev.configured.scoreThreshold, 70);
  assert.equal(d.risk.limits.maxDrawdownPct, 20);
});

test('with no run, every explorer returns an unavailable context and null data', async function () {
  var paths = ['/api/candidates', '/api/decisions', '/api/trades', '/api/jev', '/api/risk', '/api/recovery'];
  for (var i = 0; i < paths.length; i++) {
    var r = (await viewer.get(paths[i])).body.result;
    assert.equal(r.context.available, false, paths[i]);
    assert.equal(r.data, null, paths[i]);
    assert.match(r.context.reason, /no backtest has completed/);
  }
  var an = (await viewer.get('/api/analysis')).body.result;
  assert.equal(an.analysis, null);
  assert.equal(an.context.available, false);
});

test('health reports UNKNOWN for the nine run checks when no run exists — never OK', async function () {
  var sys = (await viewer.get('/api/system')).body.result;
  assert.equal(sys.health.counts.total, 13);
  assert.equal(sys.health.counts.unknown, 9);
  assert.equal(sys.health.runChecks, null);
  assert.match(sys.health.note, /UNKNOWN is not a pass/);
  assert.notEqual(sys.health.status, 'OK');
  var names = sys.health.staticChecks.map(function (c) { return c.check; });
  assert.deepEqual(names, ['MODE_IS_SAFE', 'LIVE_EXECUTION_REFUSED', 'NO_NETWORK_CLIENT', 'RECOVERY_CAPPED']);
  sys.health.staticChecks.forEach(function (c) { assert.equal(c.status, 'OK', c.check + ': ' + c.detail); });
});

test('the configuration view exposes the fingerprint, the 14 strategies and every catalog asset', async function () {
  var c = (await viewer.get('/api/config')).body.result;
  assert.equal(c.strategies.length, 14);
  assert.ok(c.strategies.every(function (s) { return s.enabled === true; }));
  assert.equal(c.assets.length, 7);
  assert.equal(c.config.mode, 'BACKTEST');
  assert.equal(c.config.risk.maxOpenTrades, 1);
  assert.equal(c.fingerprint, c.config.fingerprint.hash);
  assert.ok(c.ranges['risk.maxDrawdownPct'].max === 90);
  assert.ok(c.editable.indexOf('risk.maxDrawdownPct') !== -1);
  assert.ok(c.editable.indexOf('mode') === -1);
});

test('backtest options name the available data honestly: HISTORICAL is unavailable', async function () {
  var o = (await viewer.get('/api/backtest/options')).body.result;
  var kinds = {};
  o.data.kinds.forEach(function (k) { kinds[k.kind] = k; });
  assert.equal(kinds.FIXTURE.available, true);
  assert.equal(kinds.FIXTURE.label, 'SYNTHETIC');
  assert.equal(kinds.SYNTHETIC.available, true);
  assert.equal(kinds.HISTORICAL.available, false);
  assert.match(kinds.HISTORICAL.reason, /no market-data access/);
  assert.match(o.data.warning, /SYNTHETIC/);
});

// ---------------------------------------------------------------------------
// a run
// ---------------------------------------------------------------------------

test('a backtest runs to completion and records its identity', async function () {
  run = await h.runBacktest(owner, h.FAST_BACKTEST);
  assert.equal(run.status, 'COMPLETED', JSON.stringify(run.error));
  assert.match(run.runId, /^bt-\d{14}-[0-9a-f]{6}$/);
  assert.match(run.configHash, /^[0-9a-f]{64}$/);
  assert.match(run.commit, /^[0-9a-f]{40}$/);
  assert.equal(run.data.label, 'SYNTHETIC');
  assert.equal(run.actor.id, 'owner');
  assert.ok(run.startedAt && run.finishedAt);
  assert.ok(run.summary.headline.trades > 0);
});

test('after a run, the explorers agree with each other and with the run', async function () {
  var cands = (await viewer.get('/api/candidates?limit=500')).body.result;
  assert.equal(cands.context.source, 'BACKTEST_RUN');
  assert.equal(cands.context.runId, run.runId);
  assert.equal(cands.context.label, 'SYNTHETIC');
  assert.ok(cands.data.total > 0);
  assert.equal(cands.data.entered + cands.data.rejected + cands.data.withoutRecordedDecision, cands.data.total);

  var trades = (await viewer.get('/api/trades?limit=500')).body.result;
  assert.equal(trades.data.total, run.summary.headline.trades);
  // Every closed trade came from a candidate the pipeline ENTERED. A candidate
  // can be entered and then cancelled before it fills (emergency stop), so the
  // entered count is an upper bound on trades, never a lower one.
  assert.ok(cands.data.entered >= trades.data.total);

  var rejected = cands.data.items.filter(function (c) { return c.decision === 'NO_TRADE'; });
  assert.ok(rejected.length > 0);
  rejected.forEach(function (c) {
    assert.ok(c.stage, 'a rejected candidate must name its stage');
    assert.ok(c.reasonCodes.length > 0, 'a rejected candidate must show its recorded reason: ' + c.candidateId);
  });
});

test('every trade used the size the Risk Engine approved', async function () {
  var trades = (await viewer.get('/api/trades?limit=500')).body.result.data.items;
  assert.ok(trades.length > 0);
  trades.forEach(function (t) {
    assert.equal(t.lots, t.approvedLots, t.tradeId + ' ran at a size the Risk Engine did not approve');
    assert.ok(t.approvedLots <= t.requestedLots);
    assert.ok(['ALLOW', 'CLAMP'].indexOf(t.riskVerdict) !== -1);
    assert.ok(typeof t.costs.total === 'number' && t.costs.total > 0, 'every trade carries costs');
  });
});

test('a single trade and its decision chain can be fetched by id', async function () {
  var first = (await viewer.get('/api/trades?limit=1')).body.result.data.items[0];
  var one = (await viewer.get('/api/trades/' + encodeURIComponent(first.tradeId))).body.result;
  assert.equal(one.data.tradeId, first.tradeId);
  var chain = (await viewer.get('/api/decisions/' + encodeURIComponent(first.candidateId))).body.result.chain;
  assert.equal(chain.stages.length, 11);
  var by = {};
  chain.stages.forEach(function (s) { by[s.stage] = s; });
  assert.equal(by.RESULT.record.tradeId, first.tradeId);
  assert.equal(by.RISK_ENGINE.record.approvedLots, first.approvedLots);
  assert.equal(by.JEV.record.score, first.jevScore);
  assert.equal(by.ANALYSIS.status, 'RECORDED');
  assert.ok(by.ANALYSIS.record.byStrategy.sampleSize >= 1);
});

test('an unknown trade or candidate is a 404, not an empty success', async function () {
  assert.equal((await viewer.get('/api/trades/trade-nope')).status, 404);
  assert.equal((await viewer.get('/api/decisions/cand-nope')).status, 404);
  assert.equal((await viewer.get('/api/backtest/bt-20000101000000-abcdef')).status, 404);
});

test('explorer filters and pagination work and are validated', async function () {
  var all = (await viewer.get('/api/candidates?limit=500')).body.result.data;
  var longs = (await viewer.get('/api/candidates?direction=LONG&limit=500')).body.result.data;
  var shorts = (await viewer.get('/api/candidates?direction=SHORT&limit=500')).body.result.data;
  assert.equal(longs.total + shorts.total, all.total);
  var page1 = (await viewer.get('/api/candidates?limit=5&offset=0')).body.result.data;
  var page2 = (await viewer.get('/api/candidates?limit=5&offset=5')).body.result.data;
  assert.equal(page1.items.length, 5);
  assert.notEqual(page1.items[0].candidateId, page2.items[0].candidateId);
  assert.equal((await viewer.get('/api/candidates?limit=0')).status, 400);
  assert.equal((await viewer.get('/api/candidates?limit=99999')).status, 400);
  assert.equal((await viewer.get('/api/candidates?direction=UP')).status, 400);
  assert.equal((await viewer.get('/api/candidates?bogus=1')).status, 400);
  assert.equal((await viewer.get('/api/candidates?run=not-a-run')).status, 400);
});

test('the run can be addressed explicitly and an unknown run is refused', async function () {
  var r = (await viewer.get('/api/trades?run=' + run.runId)).body.result;
  assert.equal(r.context.runId, run.runId);
  var missing = await viewer.get('/api/trades?run=bt-20000101000000-abcdef');
  assert.equal(missing.status, 404);
});

test('the dashboard now shows the run\'s real values, labelled with their source', async function () {
  var d = (await viewer.get('/api/dashboard')).body.result;
  assert.equal(d.source.runId, run.runId);
  assert.equal(d.performance.available, true);
  assert.equal(d.performance.trades, run.summary.headline.trades);
  assert.equal(d.performance.netPnl, run.summary.headline.netPnl);
  assert.equal(d.performance.winRate, run.summary.headline.winRate);
  assert.equal(d.performance.maxLosingStreak, run.summary.headline.maxConsecutiveLosses);
  assert.equal(d.account.available, true);
  assert.equal(d.account.label, 'SYNTHETIC');
  assert.match(d.account.note, /not a live account/);
  assert.equal(d.openPosition.available, false, 'a completed run holds no open position');
  assert.equal(d.regime.available, true);
  assert.equal(d.jev.available, true);
  assert.equal(d.risk.available, true);
});

test('the run detail carries results, charts, health and the reproducibility verdict', async function () {
  var r = (await viewer.get('/api/backtest/' + run.runId)).body.result;
  assert.equal(r.dataLabel, 'SYNTHETIC');
  var res = r.result;
  ['netPnl', 'returnPct', 'maxDrawdownPct', 'winRate', 'profitFactor', 'expectancy', 'trades', 'avgWin', 'avgLoss',
    'maxConsecutiveLosses', 'recoveryFailures', 'largestPositionLots', 'costs'].forEach(function (k) {
    assert.ok(res.results[k] !== undefined, 'results.' + k + ' is missing');
  });
  assert.equal(res.reproducible, true, 'two runs of one configuration must produce the same store digest');
  assert.equal(res.digest, res.rerunDigest);
  assert.equal(res.health.counts.total, 13);
  assert.equal(res.health.counts.fail, 0);
  ['equity', 'tradeDistribution', 'strategyContribution', 'jevBands', 'regimeDistribution'].forEach(function (k) {
    assert.ok(r.charts[k], 'chart ' + k + ' is missing');
  });
  assert.ok(r.charts.equity.series.length > 10);
  assert.ok(Array.isArray(res.caveats) && res.caveats.length > 0, 'a result must carry its caveats');
});

test('health now evaluates all thirteen checks from the run, and data provenance is WARN, not OK', async function () {
  var hlt = (await viewer.get('/api/system')).body.result.health;
  assert.equal(hlt.counts.unknown, 0);
  assert.equal(hlt.counts.fail, 0);
  assert.equal(hlt.runChecks.length, 9);
  var prov = hlt.runChecks.filter(function (c) { return c.check === 'DATA_PROVENANCE'; })[0];
  assert.equal(prov.status, 'WARN', 'synthetic data must never be reported as verified real data');
  var repro = hlt.runChecks.filter(function (c) { return c.check === 'BACKTEST_REPRODUCIBLE'; })[0];
  assert.equal(repro.status, 'OK');
});

test('analysis and research reports are served from the run, with sample sizes', async function () {
  var an = (await viewer.get('/api/analysis')).body.result;
  assert.equal(an.computed, 'STORED');
  assert.equal(an.analysis.agent, 'ANALYSIS_AGENT');
  Object.keys(an.analysis.byStrategy).forEach(function (k) {
    var g = an.analysis.byStrategy[k];
    assert.ok(typeof g.sampleSize === 'number');
    assert.ok(typeof g.sufficient === 'boolean');
  });
  var rs = (await viewer.get('/api/research')).body.result;
  assert.equal(rs.report.agent, 'RESEARCH_AGENT');
  assert.equal(rs.report.authority, 'PROPOSAL_ONLY');
  assert.equal(rs.registry.authority, 'PROPOSAL_ONLY');
  assert.equal(rs.registry.champion, null);
  rs.report.hypotheses.forEach(function (hyp) { assert.ok(hyp.falsification.length >= 20); });
});

test('strategies report per-strategy statistics with an explicit sufficiency flag', async function () {
  var s = (await viewer.get('/api/strategies')).body.result;
  assert.equal(s.strategies.length, 14);
  s.strategies.forEach(function (x) {
    assert.ok(typeof x.candidates === 'number');
    assert.ok(typeof x.trades.sampleSize === 'number');
    assert.equal(x.trades.sufficient, x.trades.sampleSize >= 20);
  });
});

test('Jev, risk and recovery state their authority alongside their data', async function () {
  var jev = (await viewer.get('/api/jev')).body.result;
  assert.match(jev.authority, /cannot overrule the Risk Engine/);
  assert.equal(jev.data.bands.length, 5);
  var risk = (await viewer.get('/api/risk')).body.result;
  assert.match(risk.authority, /FINAL/);
  assert.equal(risk.data.byVerdict.ALLOW + risk.data.byVerdict.CLAMP + risk.data.byVerdict.BLOCK, risk.data.assessments);
  assert.ok(risk.data.lastObserved.MAX_DRAWDOWN_PCT);
  var rec = (await viewer.get('/api/recovery')).body.result;
  assert.match(rec.authority, /REQUEST ONLY/);
  assert.equal(rec.configured.enabled, false);
  assert.deepEqual(rec.configured.requestedLadder, [0.01, 0.03, 0.09, 0.27]);
});

test('activity merges operator actions and store events on two labelled clocks', async function () {
  var a = (await viewer.get('/api/activity?limit=500')).body.result;
  assert.ok(a.total > 0);
  assert.ok(a.items.some(function (e) { return e.clock === 'WALL' && e.type === 'backtest'; }));
  assert.ok(a.items.some(function (e) { return e.clock === 'BAR'; }));
  var trades = (await viewer.get('/api/activity?type=trade&limit=500')).body.result;
  assert.ok(trades.items.length > 0);
  assert.ok(trades.items.every(function (e) { return e.type === 'trade'; }));
  var bySym = (await viewer.get('/api/activity?asset=EURUSD&limit=50')).body.result;
  assert.ok(bySym.items.every(function (e) { return e.asset === 'EURUSD'; }));
  assert.equal((await viewer.get('/api/activity?severity=FATAL')).status, 400);
});

test('the system view names version, commit, environment, uptime and ten components', async function () {
  var sys = (await viewer.get('/api/system')).body.result;
  assert.match(sys.commit, /^[0-9a-f]{40}$/);
  assert.equal(sys.version, '1.0.0');
  assert.ok(typeof sys.uptimeSeconds === 'number');
  assert.deepEqual(sys.components.map(function (c) { return c.component; }),
    ['Trading Agent', 'API', 'Store', 'Worker', 'Paper', 'Backtest', 'Analysis', 'Research', 'Jev', 'Risk']);
  assert.equal(sys.liveExecution.available, false);
  assert.equal(sys.liveExecution.refusalVerified, true);
  assert.equal(sys.audit.integrityAtStart.ok, true);
});

test('a second backtest is refused while one is running, then accepted', async function () {
  var first = await owner.post('/api/backtest', h.FAST_BACKTEST);
  assert.equal(first.status, 202);
  var second = await owner.post('/api/backtest', h.FAST_BACKTEST);
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'JOB_ALREADY_RUNNING');
  var id = first.body.result.run.runId;
  await h.waitFor(async function () { return (await owner.get('/api/jobs/' + id)).body.result.run.status !== 'RUNNING'; }, 120000);
  var list = (await viewer.get('/api/backtest')).body.result;
  assert.ok(list.runs.length >= 2);
  assert.equal(list.active, null);
});

test('an invalid backtest request is refused before any process is started', async function () {
  var bad = await owner.post('/api/backtest', { symbols: ['EURUSD'], risk: { maxDrawdownPct: 1, maxDailyLossPct: 40 } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'CONFIG_INVALID');
  var hist = await owner.post('/api/backtest', { data: { kind: 'HISTORICAL' } });
  assert.equal(hist.status, 400);
  assert.match(hist.body.error.message, /HISTORICAL data does not exist/);
  var nofix = await owner.post('/api/backtest', { symbols: ['AUDUSD'], data: { kind: 'FIXTURE' } });
  assert.equal(nofix.status, 400);
  assert.match(nofix.body.error.message, /no committed fixture/);
  var unknown = await owner.post('/api/backtest', { strategies: ['made-up'] });
  assert.equal(unknown.status, 400);
  var extra = await owner.post('/api/backtest', { lots: 5 });
  assert.equal(extra.status, 400, 'a size field must not be accepted by the backtest route');
});
