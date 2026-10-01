'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — end-to-end, through the HTTP API
// projects/mythos-trading-control-center/tests/e2e-test.js
//
// ONE operator journey, start to finish, over HTTP against the real server
// and the real Trading Agent, with the paper session ticking on the real
// timer. Each test continues from the state the previous one left — that is
// the point: the journey is the unit.
//
//   sign in → nothing to show → configure → backtest → read the trade and
//   its whole decision chain → analysis and research → owner approves PAPER
//   → paper session runs and is archived → kill switch → LIVE refused →
//   the audit chain holds the whole journey → restart
//
// The browser suite (e2e-browser-test.js) walks the same system through the
// interface; this one needs no browser and so always runs.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');

var h = require('./helpers');

var S, owner, operator, viewer, stateDir;
var run, paperRunId, fingerprint;

test.before(async function () {
  stateDir = h.tempDir('tcc-e2e-state-');
  S = await h.startApp({ stateDir: stateDir, paperAutoTick: true });
});

test.after(async function () {
  await S.close();
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

async function result(c, p) {
  var r = await c.get(p);
  assert.equal(r.status, 200, p + ' → ' + r.status + ' ' + JSON.stringify(r.body));
  return r.body.result;
}

test('1. nothing is readable before signing in, except that the service is alive', async function () {
  var anon = S.client();
  assert.equal((await anon.get('/api/health')).status, 200);
  for (var p of ['/api/status', '/api/dashboard', '/api/config', '/api/trades', '/api/audit', '/api/system', '/api/testing', '/api/research']) {
    assert.equal((await anon.get(p)).status, 401, p);
  }
  assert.equal((await anon.post('/api/backtest', {})).status, 401);
  owner = await S.login('owner');
  operator = await S.login('operator');
  viewer = await S.login('viewer');
  assert.deepEqual((await result(owner, '/api/auth/session')).can, { read: true, operate: true, own: true });
});

test('2. a fresh platform is in BACKTEST and shows NO DATA with a reason — not zeros', async function () {
  var s = await result(viewer, '/api/status');
  assert.equal(s.mode, 'BACKTEST');
  assert.equal(s.liveExecution.available, false);
  var d = await result(viewer, '/api/dashboard');
  ['account', 'performance', 'regime', 'jev', 'risk', 'recovery'].forEach(function (k) {
    assert.equal(d[k].available, false, k);
    assert.ok(d[k].reason.length > 10, k);
  });
  for (var p of ['/api/trades', '/api/candidates', '/api/decisions', '/api/analysis', '/api/jev', '/api/risk', '/api/recovery']) {
    assert.equal((await result(viewer, p)).context.available, false, p);
  }
});

test('3. the owner configures the platform; the change is validated, fingerprinted and audited', async function () {
  var before = (await result(viewer, '/api/status')).configFingerprint;
  var denied = await operator.patch('/api/config', { changes: { risk: { maxDrawdownPct: 15 } }, reason: 'operator tries to change a limit' });
  assert.equal(denied.status, 403);
  var res = await owner.patch('/api/config', {
    changes: { universe: ['EURUSD'], account: { initialCapital: 5000 }, jev: { scoreThreshold: 45, minConfidence: 0.15 },
      risk: { maxPositionSizeLots: 0.05 }, recovery: { enabled: true, maxRecoveryLevel: 2 }, cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 } },
    reason: 'end-to-end journey setup', confirm: 'CONFIRM'
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  fingerprint = (await result(viewer, '/api/status')).configFingerprint;
  assert.notEqual(fingerprint, before);
  assert.equal(res.body.audit.seq > 0, true);
  var cfg = await result(viewer, '/api/config');
  assert.equal(cfg.config.risk.maxPositionSizeLots, 0.05);
  assert.equal((await result(viewer, '/api/config/history')).items[0].reason, 'end-to-end journey setup');
});

test('4. the operator runs a backtest; it completes, reproduces, and is labelled SYNTHETIC', async function () {
  assert.equal((await viewer.post('/api/backtest', {})).status, 403);
  run = await h.runBacktest(operator, { data: { kind: 'FIXTURE', bars: 2400 } });
  assert.equal(run.status, 'COMPLETED', JSON.stringify(run.error));
  assert.equal(run.data.label, 'SYNTHETIC');
  assert.equal(run.summary.reproducible, true);
  assert.equal(run.configHash, fingerprint, 'the run used the configuration the owner set');
  var d = await result(viewer, '/api/dashboard');
  assert.equal(d.performance.available, true);
  assert.equal(d.source.label, 'SYNTHETIC');
  assert.equal(d.source.runId, run.runId);
  assert.equal(d.performance.trades, run.summary.headline.trades);
});

test('5. a trade is read back with its whole decision chain, and its size is the Risk Engine\'s', async function () {
  var trades = (await result(viewer, '/api/trades?limit=200')).data;
  assert.equal(trades.total, run.summary.headline.trades);
  assert.ok(trades.total > 20, 'the journey needs trades: ' + trades.total);
  trades.items.forEach(function (t) {
    assert.ok(t.lots <= 0.05 + 1e-9, 'a trade above the configured position cap: ' + t.lots);
    assert.equal(t.lots, t.approvedLots, 'a trade ran at a size the Risk Engine did not approve');
    assert.ok(t.recoveryLevel <= 2);
  });
  var t = trades.items[0];
  var detail = await result(viewer, '/api/trades/' + t.tradeId);
  assert.equal(detail.data.tradeId, t.tradeId);
  assert.equal(detail.data.netPnl, t.netPnl);
  var chain = (await result(viewer, '/api/decisions/' + t.candidateId)).chain;
  assert.deepEqual(chain.stages.map(function (s) { return s.stage; }),
    ['MARKET', 'REGIME', 'STRATEGY', 'CANDIDATE', 'JEV', 'COST', 'RISK_ENGINE', 'RECOVERY', 'EXECUTION', 'RESULT', 'ANALYSIS']);
  chain.stages.forEach(function (s) { assert.equal(s.status, 'RECORDED', s.stage + ' of an executed trade'); });
  assert.equal(chain.decision, 'ENTER');
  // and a rejected candidate stops where the pipeline stopped
  var rejected = (await result(viewer, '/api/candidates?decision=NO_TRADE&limit=1')).data.items[0];
  var stopped = (await result(viewer, '/api/decisions/' + rejected.candidateId)).chain;
  assert.ok(stopped.stoppedAt, 'a rejected candidate names the stage that stopped it');
  assert.ok(stopped.reasonCodes.length > 0);
  assert.equal(stopped.stages.filter(function (s) { return s.stage === 'EXECUTION'; })[0].status, 'NOT_REACHED');
});

test('6. analysis carries sample sizes and caveats; research proposes and changes nothing', async function () {
  var an = await result(viewer, '/api/analysis');
  assert.equal(an.analysis.overview.trades, run.summary.headline.trades);
  assert.ok(an.analysis.caveats.some(function (c) { return /^SYNTHETIC_DATA/.test(c); }));
  Object.keys(an.analysis.byStrategy).forEach(function (k) { assert.equal(typeof an.analysis.byStrategy[k].sufficient, 'boolean'); });
  var rs = await result(viewer, '/api/research');
  assert.equal(rs.report.authority, 'PROPOSAL_ONLY');
  assert.equal(rs.registry.champion, null);
  assert.equal((await result(viewer, '/api/status')).configFingerprint, fingerprint);
});

test('7. PAPER needs the owner\'s approval bound to this configuration and commit', async function () {
  assert.equal((await operator.post('/api/paper/start', {})).body.error.code, 'PAPER_MODE_REQUIRED');
  var approval = await h.paperApproval(owner);
  assert.equal((await operator.post('/api/config/mode', { to: 'PAPER', reason: 'operator tries to approve paper', approval: approval })).status, 403);
  var stale = await owner.post('/api/config/mode', { to: 'PAPER', reason: 'approval for another configuration',
    approval: Object.assign({}, approval, { configFingerprint: 'f'.repeat(64) }) });
  assert.equal(stale.status, 403);
  assert.equal((await result(viewer, '/api/status')).mode, 'BACKTEST');
  var ok = await owner.post('/api/config/mode', { to: 'PAPER', reason: 'owner approves paper for the journey', approval: approval });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await result(viewer, '/api/status')).mode, 'PAPER');
  // an approval is single-use: back in BACKTEST, the same record opens nothing
  assert.equal((await operator.post('/api/config/mode', { to: 'BACKTEST', reason: 'lower the mode to test the approval' })).status, 200);
  var replay = await owner.post('/api/config/mode', { to: 'PAPER', reason: 'the same approval, used again', approval: approval });
  assert.equal(replay.status, 403);
  assert.equal(replay.body.error.code, 'APPROVAL_ALREADY_USED');
  assert.equal((await result(viewer, '/api/status')).mode, 'BACKTEST');
  await h.enterPaper(owner, 'owner approves paper again, with a new record');
  assert.equal((await result(viewer, '/api/status')).mode, 'PAPER');
});

test('8. a paper session runs on the real timer, is watched live, and is archived as a PAPER run', async function () {
  var started = await operator.post('/api/paper/start', { data: { kind: 'FIXTURE', symbols: ['EURUSD'], bars: 900 }, ticksPerSecond: 400 });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  var live = await h.waitFor(async function () {
    var v = await result(viewer, '/api/paper');
    return v.session && v.session.ticks > 50 ? v : null;
  }, 20000, 50);
  assert.equal(live.state, 'RUNNING');
  assert.equal((await result(viewer, '/api/dashboard')).source.source, 'PAPER_SESSION', 'the dashboard follows the live session');
  var blocked = await owner.patch('/api/config', { changes: { jev: { scoreThreshold: 50 } }, reason: 'change during the session' });
  assert.equal(blocked.status, 409);
  var done = await h.waitFor(async function () {
    var v = await result(viewer, '/api/paper');
    return v.state === 'STOPPED' ? v : null;
  }, 60000, 100);
  assert.equal(done.session.stopReason, 'FEED_EXHAUSTED');
  assert.equal(done.session.archived, true);
  paperRunId = done.session.sessionId;
  var events = (await result(viewer, '/api/paper/events?since=0')).items;
  assert.ok(events.length > 50);
  for (var i = 1; i < events.length; i++) assert.ok(events[i].seq > events[i - 1].seq, 'event order');
  assert.equal((await owner.post('/api/paper/reset', { confirm: 'RESET' })).status, 200);
  var listed = (await result(viewer, '/api/backtest')).runs.filter(function (r) { return r.runId === paperRunId; })[0];
  assert.equal(listed.kind, 'PAPER');
  assert.equal(listed.label, 'PAPER');
  var trades = (await result(viewer, '/api/trades?run=' + paperRunId)).data;
  assert.equal(trades.total, listed.summary.headline.trades, 'the archived session can still be explored');
});

test('9. the kill switch stops trading at once and drops the mode; turning it back on is the owner\'s', async function () {
  var off = await operator.post('/api/config/trading', { enabled: false, reason: 'stop everything now' });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  var s = await result(viewer, '/api/status');
  assert.equal(s.tradingEnabled, false);
  assert.equal(s.mode, 'BACKTEST', 'the configuration changed, so the PAPER approval no longer applies');
  var blockedRun = await h.runBacktest(operator, { data: { kind: 'FIXTURE', bars: 1200 }, verifyReproducible: false });
  assert.equal(blockedRun.status, 'COMPLETED');
  assert.equal(blockedRun.summary.headline.trades, 0, 'with trading disabled the Risk Engine blocks every candidate');
  assert.equal((await operator.post('/api/config/trading', { enabled: true, reason: 'operator turns it back on', confirm: 'ENABLE' })).status, 403);
  assert.equal((await owner.post('/api/config/trading', { enabled: true, reason: 'owner turns it back on' })).body.error.code, 'CONFIRMATION_REQUIRED');
  assert.equal((await owner.post('/api/config/trading', { enabled: true, reason: 'owner turns it back on', confirm: 'ENABLE' })).status, 200);
  assert.equal((await result(viewer, '/api/status')).tradingEnabled, true);
});

test('10. LIVE is refused by name to every role, and no route offers it', async function () {
  assert.equal((await viewer.post('/api/config/mode', { to: 'LIVE', reason: 'go live for the journey' })).status, 403);
  for (var c of [operator, owner]) {
    var res = await c.post('/api/config/mode', { to: 'LIVE', reason: 'go live for the journey', approval: await h.paperApproval(owner) });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'LIVE_NOT_AVAILABLE');
  }
  assert.equal((await result(viewer, '/api/status')).mode, 'BACKTEST');
  for (var p of ['/api/live', '/api/live/start', '/api/orders', '/api/execute', '/api/broker', '/api/positions/open']) {
    assert.equal((await owner.post(p, {})).status, 404, p);
    assert.equal((await owner.get(p)).status, 404, p);
  }
});

test('11. the audit chain holds the whole journey, in order, and verifies', async function () {
  var audit = await result(owner, '/api/audit?limit=500');
  var accepted = audit.items.filter(function (e) { return e.outcome === 'ACCEPTED'; }).map(function (e) { return e.action; }).reverse();
  var journey = ['config.update', 'backtest.start', 'mode.set', 'mode.set', 'mode.set', 'paper.start', 'paper.reset', 'trading.set', 'backtest.start', 'trading.set'];
  var at = 0;
  accepted.forEach(function (a) { if (a === journey[at]) at++; });
  assert.equal(at, journey.length, 'the journey is not in the audit log in order: ' + accepted.join(' → '));
  var refused = audit.items.filter(function (e) { return e.outcome === 'REFUSED'; });
  assert.ok(refused.some(function (e) { return e.action === 'mode.set' && /LIVE/.test(JSON.stringify(e)); }), 'the refused LIVE requests are recorded');
  assert.ok(refused.length >= 6);
  audit.items.forEach(function (e) { assert.equal(JSON.stringify(e).indexOf(h.PASSWORDS.owner), -1); });
  var verify = await result(viewer, '/api/audit/verify');
  assert.equal(verify.ok, true);
  assert.equal(verify.entries, audit.total);
});

test('12. signing out ends the session; a restart keeps the record and returns to BACKTEST', async function () {
  await owner.post('/api/config/mode', { to: 'PAPER', reason: 'approve paper before the restart', approval: await h.paperApproval(owner) });
  assert.equal((await result(viewer, '/api/status')).mode, 'PAPER');
  var head = (await result(owner, '/api/audit?limit=1')).head;
  assert.equal((await owner.logout()).status, 200);
  assert.equal((await owner.get('/api/status')).status, 401);
  await S.close();
  S = await h.startApp({ stateDir: stateDir, paperAutoTick: true });
  viewer = await S.login('viewer');
  var s = await result(viewer, '/api/status');
  assert.equal(s.mode, 'BACKTEST', 'a restart never comes up in PAPER');
  assert.equal(s.tradingEnabled, true);
  var runs = (await result(viewer, '/api/backtest')).runs.map(function (r) { return r.runId; });
  assert.ok(runs.indexOf(run.runId) !== -1 && runs.indexOf(paperRunId) !== -1, 'the runs survive the restart');
  assert.equal((await result(viewer, '/api/trades?run=' + run.runId)).data.total, run.summary.headline.trades);
  var verify = await result(viewer, '/api/audit/verify');
  assert.equal(verify.ok, true);
  assert.ok(verify.entries >= head.seq, 'the audit log was kept and continues');
});
