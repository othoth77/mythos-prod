'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — explorer and decision-chain integrity tests
// projects/mythos-trading-control-center/tests/decision-test.js
//
// The explorers and the decision chain are read models. The only thing that
// can be wrong with a read model is that it says something the store does not.
// So this suite takes ONE real run and checks EVERY candidate in it — not a
// sample — against the raw rows of the sealed store:
//
//   · the chain has the eleven stages, in the mission's order, for all of them
//   · every value shown equals the stored value it came from
//   · a stage after the one that stopped the pipeline is NOT_REACHED, never
//     filled in
//   · a stage with no stored row is NOT_RECORDED, never reconstructed
//   · a rejected candidate carries the reason codes recorded when it was
//     rejected, and the explorers repeat exactly those
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');

var h = require('./helpers');

var S, owner, viewer, run, tables, analysis;
var ORDER = ['MARKET', 'REGIME', 'STRATEGY', 'CANDIDATE', 'JEV', 'COST', 'RISK_ENGINE', 'RECOVERY', 'EXECUTION', 'RESULT', 'ANALYSIS'];

test.before(async function () {
  S = await h.startApp();
  owner = await S.login('owner');
  viewer = await S.login('viewer');
  run = await h.runBacktest(owner, {
    symbols: ['EURUSD', 'XAUUSD'], initialCapital: 5000, data: { kind: 'FIXTURE', bars: 1500 },
    jev: { scoreThreshold: 50, minConfidence: 0.2 }, recovery: { enabled: true, maxRecoveryLevel: 3 },
    cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 }
  });
  assert.equal(run.status, 'COMPLETED', JSON.stringify(run.error));
  tables = S.app.platform.runs.tables(run.runId, 'store').tables;
  analysis = S.app.platform.runs.readDoc(run.runId, 'analysis.json');
});

test.after(async function () { await S.close(); });

function byCandidate(rows) {
  var m = {};
  rows.forEach(function (r) { if (r.candidateId) (m[r.candidateId] = m[r.candidateId] || []).push(r); });
  return m;
}
async function all(path) {
  var out = [];
  for (var offset = 0; ; offset += 500) {
    var r = (await viewer.get(path + (path.indexOf('?') === -1 ? '?' : '&') + 'run=' + run.runId + '&limit=500&offset=' + offset)).body.result;
    out = out.concat(r.data.items);
    if (out.length >= r.data.total) return { items: out, data: r.data, context: r.context };
  }
}

test('the run used for this suite exercises every outcome: entered, and rejected at several stages', function () {
  var stages = {};
  tables.decisions.forEach(function (d) { stages[d.decision === 'ENTER' ? 'ENTER' : d.stage] = true; });
  ['ENTER', 'COST', 'JEV', 'RISK'].forEach(function (s) { assert.ok(stages[s], 'the run has no decision at ' + s); });
  assert.ok(tables.candidates.length > 200);
  assert.ok(tables.trades.length > 30);
  assert.ok(tables.recovery_states.length > 0, 'recovery was enabled; the ladder should have moved');
});

test('EVERY candidate\'s chain has the eleven stages in order, with statuses that follow from its decision', function () {
  var views = require('../server/views');
  var t = views.fromTables(tables);
  var decisions = {};
  tables.decisions.forEach(function (d) { if (d.candidateId) decisions[d.candidateId] = d; });
  var trades = {};
  tables.trades.forEach(function (x) { trades[x.candidateId] = x; });
  var counts = { entered: 0, rejected: 0 };

  tables.candidates.forEach(function (c) {
    var chain = views.chain(t, c.candidateId, analysis);
    assert.deepEqual(chain.stages.map(function (s) { return s.stage; }), ORDER, c.candidateId);
    assert.deepEqual(chain.integrity.order, ORDER);
    var by = {};
    chain.stages.forEach(function (s) {
      by[s.stage] = s;
      assert.ok(['RECORDED', 'NOT_REACHED', 'NOT_RECORDED'].indexOf(s.status) !== -1);
      if (s.status === 'NOT_REACHED') assert.equal(s.record, null, c.candidateId + ' ' + s.stage + ' is NOT_REACHED but carries a record');
      if (s.status !== 'RECORDED') assert.ok(s.note && s.note.length > 10, c.candidateId + ' ' + s.stage + ' gives no reason');
    });
    var d = decisions[c.candidateId];
    assert.ok(d, 'every candidate in this run has a decision row');
    assert.equal(chain.decision, d.decision);
    assert.deepEqual(chain.reasonCodes, d.reasonCodes);

    // The first four stages are always recorded for a built candidate.
    ['MARKET', 'REGIME', 'STRATEGY', 'CANDIDATE', 'COST'].forEach(function (s) { assert.equal(by[s].status, 'RECORDED', c.candidateId + ' ' + s); });

    if (d.decision === 'ENTER') {
      counts.entered++;
      assert.equal(chain.stoppedAt, null);
      ['JEV', 'RISK_ENGINE', 'EXECUTION'].forEach(function (s) { assert.equal(by[s].status, 'RECORDED', c.candidateId + ' ' + s); });
      if (trades[c.candidateId]) {
        assert.equal(by.RESULT.status, 'RECORDED');
        assert.equal(by.ANALYSIS.status, 'RECORDED');
      } else {
        // Entered and then cancelled before it filled: no trade exists, and none is invented.
        assert.equal(by.RESULT.status, 'NOT_RECORDED');
        assert.equal(by.RESULT.record, null);
      }
      return;
    }
    counts.rejected++;
    assert.equal(chain.stoppedAt, d.stage);
    assert.ok(chain.reasonCodes.length > 0, 'a rejected candidate must show its recorded reason: ' + c.candidateId);
    assert.equal(by.EXECUTION.status, 'NOT_REACHED');
    assert.equal(by.RESULT.status, 'NOT_REACHED');
    assert.equal(by.ANALYSIS.status, 'NOT_REACHED');
    if (d.stage === 'COST') {
      ['JEV', 'RISK_ENGINE', 'RECOVERY'].forEach(function (s) { assert.equal(by[s].status, 'NOT_REACHED', c.candidateId + ' ' + s); });
      assert.equal(by.COST.record.passed, false);
    } else if (d.stage === 'JEV') {
      assert.equal(by.JEV.status, 'RECORDED');
      assert.equal(by.JEV.record.decision, 'REJECT');
      assert.equal(by.RISK_ENGINE.status, 'NOT_REACHED');
      assert.equal(by.RECOVERY.status, 'NOT_REACHED');
    } else if (d.stage === 'RISK') {
      assert.equal(by.JEV.record.decision, 'ENTER');
      assert.equal(by.RISK_ENGINE.status, 'RECORDED');
      assert.equal(by.RISK_ENGINE.record.verdict, 'BLOCK');
    } else if (d.stage === 'RECOVERY') {
      assert.equal(by.RISK_ENGINE.status, 'RECORDED');
      assert.equal(by.RECOVERY.status, 'RECORDED');
      assert.equal(by.RECOVERY.record.reason, 'TP_UNREACHABLE');
    }
  });
  assert.ok(counts.entered > 30 && counts.rejected > 100, JSON.stringify(counts));
});

test('EVERY value a chain shows is the stored value, for every candidate', function () {
  var views = require('../server/views');
  var t = views.fromTables(tables);
  var jev = byCandidate(tables.jev_decisions);
  var risk = byCandidate(tables.risk_assessments);
  var cost = byCandidate(tables.cost_assessments.filter(function (c) { return c.phase !== 'REALISED'; }));
  var orders = byCandidate(tables.orders);
  var trades = byCandidate(tables.trades);

  tables.candidates.forEach(function (c) {
    var chain = views.chain(t, c.candidateId, analysis);
    var by = {};
    chain.stages.forEach(function (s) { by[s.stage] = s; });

    ['entry', 'stopLoss', 'takeProfit', 'direction', 'strategyId', 'regime', 'rewardRisk', 'expectedNetMoney', 'spreadPips'].forEach(function (f) {
      assert.deepEqual(by.CANDIDATE.record[f], c[f], c.candidateId + ' candidate.' + f);
    });
    var regimeRow = tables.regimes.filter(function (r) { return r.ts === c.ts && r.symbol === c.symbol; })[0];
    assert.equal(by.REGIME.record.regime, regimeRow.regime);
    assert.equal(by.REGIME.record.confidence, regimeRow.confidence);

    if (jev[c.candidateId]) {
      var j = jev[c.candidateId][0];
      ['score', 'confidence', 'decision', 'threshold'].forEach(function (f) { assert.equal(by.JEV.record[f], j[f], c.candidateId + ' jev.' + f); });
      assert.deepEqual(by.JEV.record.reasonCodes, j.reasonCodes);
      assert.deepEqual(by.JEV.record.components, j.components);
    } else assert.notEqual(by.JEV.status, 'RECORDED');

    if (risk[c.candidateId]) {
      var r = risk[c.candidateId][0];
      ['verdict', 'requestedLots', 'approvedLots', 'accountEquity'].forEach(function (f) { assert.equal(by.RISK_ENGINE.record[f], r[f], c.candidateId + ' risk.' + f); });
      assert.deepEqual(by.RISK_ENGINE.record.limitsChecked, r.limitsChecked);
      assert.deepEqual(by.RISK_ENGINE.record.reasonCodes, r.reasonCodes);
    } else assert.notEqual(by.RISK_ENGINE.status, 'RECORDED');

    var pre = cost[c.candidateId][0];
    assert.equal(by.COST.record.totalCostMoney, pre.totalCostMoney);
    assert.equal(by.COST.record.passed, pre.passed);

    if (orders[c.candidateId]) {
      assert.equal(by.EXECUTION.record.orders.length, orders[c.candidateId].length);
      orders[c.candidateId].forEach(function (o, i) {
        assert.equal(by.EXECUTION.record.orders[i].status, o.status);
        assert.equal(by.EXECUTION.record.orders[i].lots, o.lots);
      });
    } else assert.notEqual(by.EXECUTION.status, 'RECORDED');

    if (trades[c.candidateId]) {
      var tr = trades[c.candidateId][0];
      ['netPnl', 'grossPnl', 'costsMoney', 'lots', 'entryPrice', 'exitPrice', 'outcome', 'exitReason'].forEach(function (f) {
        assert.equal(by.RESULT.record[f], tr[f], c.candidateId + ' trade.' + f);
      });
      // The executed size is the Risk Engine's approved size, on every trade.
      assert.equal(tr.lots, by.RISK_ENGINE.record.approvedLots, c.candidateId + ' ran at a size the Risk Engine did not approve');
      assert.deepEqual(by.ANALYSIS.record.byStrategy, analysis.byStrategy[tr.strategyId]);
      assert.deepEqual(by.ANALYSIS.record.bySymbol, analysis.bySymbol[tr.symbol]);
    } else assert.notEqual(by.RESULT.status, 'RECORDED');
  });
});

test('a recovery stage shows the ladder state at or before the bar — never a later one', function () {
  var views = require('../server/views');
  var t = views.fromTables(tables);
  var shown = 0;
  tables.candidates.forEach(function (c) {
    var rec = views.chain(t, c.candidateId, analysis).stages[7];
    if (rec.status !== 'RECORDED') return;
    shown++;
    assert.equal(rec.record.symbol, c.symbol, 'recovery state is per asset');
    assert.ok(rec.record.stateTs <= c.ts, 'the chain showed a recovery state from the future of this bar');
  });
  assert.ok(shown > 20);
});

test('removing a row from the store makes its stage NOT_RECORDED — it is not rebuilt from the others', function () {
  var views = require('../server/views');
  var entered = tables.trades[5].candidateId;
  function without(table) {
    var copy = {};
    Object.keys(tables).forEach(function (k) { copy[k] = tables[k]; });
    copy[table] = tables[table].filter(function (r) { return r.candidateId !== entered; });
    return views.fromTables(copy);
  }
  var noRisk = views.chain(without('risk_assessments'), entered, analysis);
  var risk = noRisk.stages.filter(function (s) { return s.stage === 'RISK_ENGINE'; })[0];
  assert.equal(risk.status, 'NOT_RECORDED');
  assert.equal(risk.record, null, 'the size must not be recovered from the trade row');
  assert.ok(noRisk.integrity.notRecorded.indexOf('RISK_ENGINE') !== -1);

  var noJev = views.chain(without('jev_decisions'), entered, analysis);
  var jev = noJev.stages.filter(function (s) { return s.stage === 'JEV'; })[0];
  assert.equal(jev.status, 'NOT_RECORDED');
  assert.equal(jev.record, null, 'the score must not be recovered from the trade row');

  var noTrade = views.chain(without('trades'), entered, analysis);
  assert.equal(noTrade.stages[9].status, 'NOT_RECORDED');
  assert.equal(noTrade.stages[10].status, 'NOT_RECORDED');

  var noAnalysis = views.chain(views.fromTables(tables), entered, null);
  assert.equal(noAnalysis.stages[10].status, 'NOT_RECORDED');
  assert.equal(noAnalysis.stages[10].record, null);
});

// ---------------------------------------------------------------------------
// the explorers, over HTTP
// ---------------------------------------------------------------------------

test('the chain route returns exactly what the read model computes', async function () {
  var views = require('../server/views');
  var id = tables.trades[0].candidateId;
  var res = (await viewer.get('/api/decisions/' + encodeURIComponent(id) + '?run=' + run.runId)).body.result;
  assert.equal(res.context.runId, run.runId);
  assert.deepEqual(res.chain, JSON.parse(JSON.stringify(views.chain(views.fromTables(tables), id, analysis))));
});

test('the candidate explorer lists every candidate once, with the recorded decision and reason', async function () {
  var res = await all('/api/candidates');
  assert.equal(res.items.length, tables.candidates.length);
  var ids = {};
  res.items.forEach(function (c) { assert.ok(!ids[c.candidateId], 'duplicate ' + c.candidateId); ids[c.candidateId] = true; });
  var decisions = {};
  tables.decisions.forEach(function (d) { if (d.candidateId) decisions[d.candidateId] = d; });
  res.items.forEach(function (c) {
    var d = decisions[c.candidateId];
    assert.equal(c.decision, d.decision);
    assert.equal(c.stage, d.stage);
    assert.deepEqual(c.reasonCodes, d.reasonCodes);
    if (c.decision === 'NO_TRADE') assert.ok(c.reasonCodes.length > 0);
  });
  assert.equal(res.data.entered + res.data.rejected, res.data.total);
  assert.equal(res.data.withoutRecordedDecision, 0);
});

test('the trade explorer lists every trade with requested and approved size, costs and R', async function () {
  var res = await all('/api/trades');
  assert.equal(res.items.length, tables.trades.length);
  var risk = {};
  tables.risk_assessments.forEach(function (r) { risk[r.candidateId] = r; });
  var raw = {};
  tables.trades.forEach(function (t) { raw[t.tradeId] = t; });
  var clamped = 0;
  res.items.forEach(function (t) {
    var r = raw[t.tradeId];
    assert.equal(t.requestedLots, risk[r.candidateId].requestedLots);
    assert.equal(t.approvedLots, risk[r.candidateId].approvedLots);
    assert.equal(t.lots, t.approvedLots);
    if (t.requestedLots > t.approvedLots) { clamped++; assert.equal(t.riskVerdict, 'CLAMP'); }
    assert.equal(t.netPnl, r.netPnl);
    assert.equal(t.costs.total, r.costsMoney);
    assert.equal(t.entry, r.entryPrice);
    assert.equal(t.exit, r.exitPrice);
    assert.equal(t.stopLoss, r.stopLoss);
    assert.equal(t.takeProfit, r.takeProfit);
    assert.equal(t.rMultiple, Math.round((r.netPnl / r.riskMoney) * 10000) / 10000);
    assert.equal(t.recoveryLevel, r.recoveryLevel);
  });
  assert.ok(clamped > 0, 'with the ladder enabled, some trades were clamped — and the explorer must show it');
});

test('filters select exactly the rows the store has for them', async function () {
  var xau = await all('/api/trades?symbol=XAUUSD');
  assert.equal(xau.items.length, tables.trades.filter(function (t) { return t.symbol === 'XAUUSD'; }).length);
  var losses = await all('/api/trades?outcome=LOSS');
  assert.equal(losses.items.length, tables.trades.filter(function (t) { return t.outcome === 'LOSS'; }).length);
  var decisions = {};
  tables.decisions.forEach(function (d) { if (d.candidateId) decisions[d.candidateId] = d; });
  var atRisk = await all('/api/candidates?decision=NO_TRADE&stage=RISK');
  assert.equal(atRisk.items.length, tables.candidates.filter(function (c) { return decisions[c.candidateId].stage === 'RISK' && decisions[c.candidateId].decision === 'NO_TRADE'; }).length);
  var mom = await all('/api/candidates?strategy=momentum');
  assert.equal(mom.items.length, tables.candidates.filter(function (c) { return c.strategyId === 'momentum'; }).length);
  var decs = await all('/api/decisions?decision=ENTER');
  assert.equal(decs.items.length, tables.decisions.filter(function (d) { return d.decision === 'ENTER'; }).length);
});

test('the decision list shows stored rows as they are, including the verdicts with no candidate', async function () {
  var res = await all('/api/decisions');
  assert.equal(res.items.length, tables.decisions.length, 'the list is the decisions table, row for row');
  var seqs = res.items.map(function (d) { return d.seq; });
  var raw = tables.decisions.map(function (d) { return d._seq; }).reverse();
  assert.deepEqual(seqs, raw, 'newest first, nothing merged or dropped');
});

test('an open position in a live session has no RESULT, and the chain says so', async function () {
  var A = await h.startApp();
  var o = await A.login('owner');
  await o.patch('/api/config', { changes: { account: { initialCapital: 5000 }, jev: { scoreThreshold: 45, minConfidence: 0.15 } }, reason: 'live chain test', confirm: 'CONFIRM' });
  await h.enterPaper(o);
  await o.post('/api/paper/start', { data: { kind: 'FIXTURE', symbols: ['EURUSD'], bars: 900 } });
  var paper = A.app.platform.paper;
  var open = null;
  for (var i = 0; i < 880 && !open; i++) {
    paper.step();
    var v = paper.view();
    if (v.session.arms[0].openPosition) open = v.session.arms[0].openPosition;
  }
  assert.ok(open, 'the session should have opened a position');
  var store = paper.liveStore().store;
  var candidateId = store.table('positions').last().candidateId;
  var res = (await o.get('/api/decisions/' + encodeURIComponent(candidateId))).body.result;
  assert.equal(res.context.source, 'PAPER_SESSION');
  assert.equal(res.context.live, true);
  var by = {};
  res.chain.stages.forEach(function (s) { by[s.stage] = s; });
  assert.equal(by.EXECUTION.status, 'RECORDED');
  assert.equal(by.EXECUTION.record.orders[by.EXECUTION.record.orders.length - 1].paper, true);
  assert.equal(by.RESULT.status, 'NOT_RECORDED');
  assert.equal(by.RESULT.record, null, 'an open position has no result, and none may be shown');
  assert.match(by.RESULT.note, /still open/);
  assert.equal(by.ANALYSIS.status, 'NOT_RECORDED');
  await A.close();
});
