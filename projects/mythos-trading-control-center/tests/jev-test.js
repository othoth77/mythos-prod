'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — Jev and Strategies view tests
// projects/mythos-trading-control-center/tests/jev-test.js
//
// Jev is a decision gate with no authority over size. The page shows its
// score, its confidence, ALLOW / BLOCK, and the four reporting bands. This
// suite checks those against the raw store, and checks the two properties the
// gate itself promises: the threshold is honoured, and a hard flag cannot be
// outscored.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');

var h = require('./helpers');
var views = require('../server/views');

var S, owner, viewer, run, tables;
var BASE = { symbols: ['EURUSD', 'XAUUSD'], initialCapital: 5000, data: { kind: 'FIXTURE', bars: 1800 },
  cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 } };

test.before(async function () {
  S = await h.startApp();
  owner = await S.login('owner');
  viewer = await S.login('viewer');
  run = await h.runBacktest(owner, Object.assign({}, BASE, { jev: { scoreThreshold: 55, minConfidence: 0.2 } }));
  assert.equal(run.status, 'COMPLETED', JSON.stringify(run.error));
  tables = S.app.platform.runs.tables(run.runId, 'store').tables;
});

test.after(async function () { await S.close(); });

async function jev(runId) { return (await viewer.get('/api/jev?run=' + runId)).body.result; }

test('the Jev view reports the configuration and states that the gate has no authority over size', async function () {
  var r = await jev(run.runId);
  assert.equal(r.configured.enabled, true);
  assert.equal(r.configured.model, 'heuristic-v1');
  assert.deepEqual(r.configured.thresholdBands, [[70, 79], [80, 89], [90, 94], [95, 100]]);
  assert.match(r.authority, /carries no size/);
  assert.match(r.authority, /cannot overrule the Risk Engine/);
  assert.equal(r.data.threshold, 55, 'the threshold shown for the source is the one the run used');
  assert.equal(r.data.minConfidence, 0.2);
});

test('verdict totals are the store\'s; ALLOW and BLOCK are the stored ENTER and REJECT', async function () {
  var d = (await jev(run.runId)).data;
  assert.equal(d.verdicts, tables.jev_decisions.length);
  assert.equal(d.allowed, tables.jev_decisions.filter(function (v) { return v.decision === 'ENTER'; }).length);
  assert.equal(d.blocked, tables.jev_decisions.filter(function (v) { return v.decision === 'REJECT'; }).length);
  assert.equal(d.allowed + d.blocked, d.verdicts);
  assert.deepEqual(d.vocabulary, { ENTER: 'ALLOW', REJECT: 'BLOCK' });
  assert.ok(d.blocked > 0 && d.allowed > 0);
});

test('the four score bands are 70–79, 80–89, 90–94 and 95–100, and partition every verdict', async function () {
  var d = (await jev(run.runId)).data;
  assert.deepEqual(d.bands.map(function (b) { return b.band; }), ['70-79', '80-89', '90-94', '95-100', 'BELOW_70']);
  var ranges = { '70-79': [70, 80], '80-89': [80, 90], '90-94': [90, 95], '95-100': [95, 100.0001], BELOW_70: [-Infinity, 70] };
  d.bands.forEach(function (b) {
    var lo = ranges[b.band][0], hi = ranges[b.band][1];
    var mine = tables.jev_decisions.filter(function (v) { return v.score >= lo && v.score < hi; });
    assert.equal(b.considered, mine.length, b.band + ' considered');
    assert.equal(b.allowed, mine.filter(function (v) { return v.decision === 'ENTER'; }).length, b.band + ' allowed');
    assert.equal(b.blocked, mine.filter(function (v) { return v.decision === 'REJECT'; }).length, b.band + ' blocked');
    var trades = tables.trades.filter(function (t) { return t.jevScore >= lo && t.jevScore < hi; });
    assert.equal(b.trades.sampleSize, trades.length, b.band + ' trades');
    assert.equal(b.trades.sufficient, trades.length >= 20);
    if (trades.length === 0) {
      assert.equal(b.trades.winRate, null, 'an empty band has no win rate');
      assert.equal(b.trades.expectancy, null);
    }
  });
  assert.equal(d.bands.reduce(function (a, b) { return a + b.considered; }, 0), d.verdicts, 'the bands must cover every verdict exactly once');
  assert.equal(d.bands.reduce(function (a, b) { return a + b.trades.sampleSize; }, 0), tables.trades.length);
});

test('the threshold and the confidence gate are both honoured by every ALLOW', function () {
  tables.jev_decisions.forEach(function (v) {
    if (v.decision !== 'ENTER') return;
    assert.ok(v.score >= 55, 'an ALLOW below the score threshold: ' + v.score);
    assert.ok(v.confidence >= 0.2, 'an ALLOW below the confidence floor: ' + v.confidence);
    assert.equal((v.hardFlags || []).length, 0, 'an ALLOW with a hard flag');
  });
  tables.jev_decisions.filter(function (v) { return v.decision === 'REJECT'; }).forEach(function (v) {
    assert.ok(v.reasonCodes.some(function (c) { return /BELOW_SCORE_THRESHOLD|BELOW_CONFIDENCE_THRESHOLD|HARD_FLAG_PRESENT/.test(c); }),
      'a BLOCK with no stated reason: ' + JSON.stringify(v.reasonCodes));
  });
});

test('every trade was allowed by Jev first; a blocked candidate never traded', function () {
  var verdict = {};
  tables.jev_decisions.forEach(function (v) { verdict[v.candidateId] = v; });
  tables.trades.forEach(function (t) {
    assert.ok(verdict[t.candidateId], 'trade ' + t.tradeId + ' has no Jev verdict');
    assert.equal(verdict[t.candidateId].decision, 'ENTER');
    assert.equal(t.jevScore, verdict[t.candidateId].score, 'the trade carries the score it was taken under');
  });
  var blocked = {};
  tables.jev_decisions.filter(function (v) { return v.decision === 'REJECT'; }).forEach(function (v) { blocked[v.candidateId] = true; });
  tables.risk_assessments.forEach(function (r) { assert.ok(!blocked[r.candidateId], 'the Risk Engine was consulted for a candidate Jev blocked'); });
});

test('a Jev verdict carries no size and no execution instruction', function () {
  tables.jev_decisions.forEach(function (v) {
    ['lots', 'size', 'approvedLots', 'requestedLots', 'order', 'execute'].forEach(function (k) {
      assert.equal(v[k], undefined, 'a Jev verdict carries ' + k);
    });
  });
});

test('a hard flag blocks even with the threshold at zero: it cannot be outscored', async function () {
  var open = await h.runBacktest(owner, Object.assign({}, BASE, { jev: { scoreThreshold: 0, minConfidence: 0 } }));
  assert.equal(open.status, 'COMPLETED', JSON.stringify(open.error));
  var t = S.app.platform.runs.tables(open.runId, 'store').tables;
  var rejects = t.jev_decisions.filter(function (v) { return v.decision === 'REJECT'; });
  rejects.forEach(function (v) {
    assert.ok(v.reasonCodes.indexOf('HARD_FLAG_PRESENT') !== -1, 'with no threshold, the only possible BLOCK is a hard flag: ' + JSON.stringify(v.reasonCodes));
    assert.ok(v.hardFlags.length > 0);
  });
  var d = (await jev(open.runId)).data;
  assert.equal(d.threshold, 0);
  assert.equal(d.blocked, rejects.length);
});

test('the latest verdicts are the newest rows, each with its band, and they open a decision chain', async function () {
  var d = (await jev(run.runId)).data;
  assert.equal(d.recent.length, Math.min(60, tables.jev_decisions.length));
  var newest = tables.jev_decisions[tables.jev_decisions.length - 1];
  assert.equal(d.recent[0].candidateId, newest.candidateId);
  assert.equal(d.last.candidateId, newest.candidateId);
  d.recent.forEach(function (v) {
    assert.equal(v.band, views.bandOf(v.score));
    assert.ok(v.symbol && v.strategyId, 'a verdict row names its asset and strategy');
  });
  var chain = (await viewer.get('/api/decisions/' + encodeURIComponent(d.recent[0].candidateId) + '?run=' + run.runId)).body.result.chain;
  assert.equal(chain.stages[4].record.score, d.recent[0].score);
});

test('the reason-code and risk-flag frequencies are counted from the store', async function () {
  var d = (await jev(run.runId)).data;
  var counts = {};
  tables.jev_decisions.forEach(function (v) { v.reasonCodes.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
  d.topReasonCodes.forEach(function (r) { assert.equal(r.count, counts[r.value], r.value); });
  for (var i = 1; i < d.topReasonCodes.length; i++) assert.ok(d.topReasonCodes[i - 1].count >= d.topReasonCodes[i].count);
});

// ---------------------------------------------------------------------------
// strategies
// ---------------------------------------------------------------------------

test('the strategies view lists all fourteen families with counts from the store and a sample size on each', async function () {
  var s = (await viewer.get('/api/strategies?run=' + run.runId)).body.result;
  assert.equal(s.strategies.length, 14);
  assert.equal(s.enabled.length, 14);
  var decisions = {};
  tables.decisions.forEach(function (d) { if (d.candidateId) decisions[d.candidateId] = d; });
  var total = 0;
  s.strategies.forEach(function (x) {
    var cands = tables.candidates.filter(function (c) { return c.strategyId === x.strategyId; });
    var trades = tables.trades.filter(function (t) { return t.strategyId === x.strategyId; });
    assert.equal(x.candidates, cands.length, x.strategyId + ' candidates');
    assert.equal(x.entered, cands.filter(function (c) { return decisions[c.candidateId] && decisions[c.candidateId].decision === 'ENTER'; }).length);
    assert.equal(x.trades.sampleSize, trades.length, x.strategyId + ' trades');
    assert.equal(x.trades.sufficient, trades.length >= 20);
    if (trades.length) {
      var net = trades.reduce(function (a, t) { return a + t.netPnl; }, 0);
      assert.ok(Math.abs(x.trades.netPnl - net) < 1e-3);
      assert.equal(x.trades.wins, trades.filter(function (t) { return t.outcome === 'WIN'; }).length);
    } else {
      assert.equal(x.trades.winRate, null);
      assert.equal(x.trades.netPnl, null, 'a strategy with no trades has no P&L, not a zero one');
    }
    assert.ok(x.family && x.name);
    total += trades.length;
  });
  assert.equal(total, tables.trades.length);
});

test('a strategy disabled on the platform is shown as disabled, while a past run still shows its record', async function () {
  var all = (await viewer.get('/api/config')).body.result.strategies.map(function (s) { return s.strategyId; });
  await owner.post('/api/config/strategies', { enabled: all.filter(function (id) { return id !== 'momentum'; }), reason: 'disable momentum for the view test' });
  var s = (await viewer.get('/api/strategies?run=' + run.runId)).body.result;
  var mom = s.strategies.filter(function (x) { return x.strategyId === 'momentum'; })[0];
  assert.equal(mom.enabled, false);
  assert.equal(s.enabled.length, 13);
  assert.ok(mom.candidates > 0, 'the run was made when momentum was enabled, and its record stands');
  await owner.post('/api/config/strategies', { enabled: all, reason: 'restore all strategies' });
});
