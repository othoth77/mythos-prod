'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — paper / demo control room tests
// projects/mythos-trading-control-center/tests/paper-test.js
//
// The control room drives the Trading Agent's OWN paper session. These tests
// prove three things about that:
//
//   IT IS THE REAL ENGINE   a session run through the API produces the same
//                            trades, in the same order, at the same prices, as
//                            a backtest of the same configuration over the
//                            same bars — and two sessions agree with each other.
//   THE CONTROLS ARE A STATE MACHINE   every legal transition works, every
//                            illegal one is refused, and RESET destroys nothing.
//   THE STREAM CAN BE RESUMED   a client that reconnects with its last event id
//                            receives exactly the events it missed — no
//                            duplicate, no hole — and is told when that is no
//                            longer possible.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var http = require('http');

var h = require('./helpers');

var S, owner, operator, viewer;
var DATA = { kind: 'FIXTURE', symbols: ['EURUSD'], bars: 900 };
var SETUP = {
  account: { initialCapital: 5000 },
  jev: { scoreThreshold: 45, minConfidence: 0.15 },
  // Fixed slippage: the gaussian model draws from an RNG seeded by the run id,
  // which necessarily differs between a paper run and a backtest.
  cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 }
};

test.before(async function () {
  S = await h.startApp();
  owner = await S.login('owner');
  operator = await S.login('operator');
  viewer = await S.login('viewer');
  var res = await owner.patch('/api/config', { changes: SETUP, reason: 'paper test setup', confirm: 'CONFIRM' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  await h.enterPaper(owner);
});

test.after(async function () { await S.close(); });

function runAll() { while (S.app.platform.paper.step()) { /* to the end of the feed */ } }
async function state() { return (await viewer.get('/api/paper')).body.result; }
async function reset() { return owner.post('/api/paper/reset', { confirm: 'RESET' }); }
function shape(t) {
  return [t.symbol, t.direction, t.entryTs, t.exitTs, t.entry, t.exit, t.lots, t.grossPnl, t.costs.total, t.netPnl,
    t.outcome, t.exitReason, t.regime, t.recoveryLevel, t.barsHeld].join('|');
}

// ---------------------------------------------------------------------------
// the state machine
// ---------------------------------------------------------------------------

test('the idle control room says what it is and what it is not', async function () {
  var v = await state();
  assert.equal(v.state, 'IDLE');
  assert.equal(v.session, null);
  assert.equal(v.paperModeActive, true);
  assert.equal(v.placesRealOrders, false);
  assert.equal(v.feedKind, 'REPLAY');
  assert.match(v.feedNote, /no order is sent anywhere/);
});

test('controls that need a session are refused when there is none', async function () {
  for (var action of ['pause', 'resume', 'stop']) {
    var res = await operator.post('/api/paper/' + action);
    assert.equal(res.status, 409, action);
    assert.match(res.body.error.code, /^PAPER_NOT_/);
  }
  assert.equal((await operator.post('/api/paper/speed', { ticksPerSecond: 10 })).status, 409);
});

test('START creates a session and every later control follows the state machine', async function () {
  var start = await operator.post('/api/paper/start', { data: DATA, ticksPerSecond: 50 });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  var v = start.body.result;
  assert.equal(v.state, 'RUNNING');
  assert.match(v.session.sessionId, /^pp-\d{14}-[0-9a-f]{6}$/);
  assert.equal(v.session.kind, 'PAPER');
  assert.equal(v.session.label, 'PAPER');
  assert.equal(v.session.startedBy.id, 'operator');
  assert.equal(v.session.data.dataLabel, 'SYNTHETIC');
  assert.equal(v.session.totalTicks, 900);
  assert.equal(v.session.arms.length, 1);
  assert.equal(v.session.arms[0].balance, 5000);

  assert.equal((await operator.post('/api/paper/start', { data: DATA })).body.error.code, 'PAPER_SESSION_ACTIVE');
  assert.equal((await operator.post('/api/paper/resume')).body.error.code, 'PAPER_NOT_PAUSED');

  for (var i = 0; i < 300; i++) S.app.platform.paper.step();
  assert.equal((await state()).session.ticks, 300);

  var paused = await operator.post('/api/paper/pause');
  assert.equal(paused.body.result.state, 'PAUSED');
  assert.equal(S.app.platform.paper.step(), false, 'a paused session does not advance');
  assert.equal((await state()).session.ticks, 300);
  assert.equal((await operator.post('/api/paper/pause')).body.error.code, 'PAPER_NOT_RUNNING');

  var resumed = await operator.post('/api/paper/resume');
  assert.equal(resumed.body.result.state, 'RUNNING');
  for (var j = 0; j < 100; j++) S.app.platform.paper.step();
  assert.equal((await state()).session.ticks, 400);

  var speed = await operator.post('/api/paper/speed', { ticksPerSecond: 200 });
  assert.equal(speed.body.result.session.ticksPerSecond, 200);
  assert.equal((await operator.post('/api/paper/speed', { ticksPerSecond: 100000 })).status, 400);

  var stopped = await operator.post('/api/paper/stop');
  assert.equal(stopped.body.result.state, 'STOPPED');
  assert.equal(stopped.body.result.session.stopReason, 'STOPPED_BY_OPERATOR');
  assert.equal(stopped.body.result.session.arms[0].openPosition, null, 'stopping closes anything open');
  assert.equal((await operator.post('/api/paper/stop')).body.error.code, 'PAPER_NOT_ACTIVE');
  assert.equal((await operator.post('/api/paper/start', { data: DATA })).body.error.code, 'PAPER_RESET_REQUIRED');
});

test('every control is audited with the state before and after', async function () {
  var items = (await viewer.get('/api/audit?action=paper&limit=50')).body.result.items;
  var accepted = items.filter(function (e) { return e.outcome === 'ACCEPTED'; }).map(function (e) { return e.action; });
  ['paper.start', 'paper.pause', 'paper.resume', 'paper.speed', 'paper.stop'].forEach(function (a) {
    assert.ok(accepted.indexOf(a) !== -1, a + ' was not audited');
  });
  var pause = items.filter(function (e) { return e.action === 'paper.pause' && e.outcome === 'ACCEPTED'; })[0];
  assert.deepEqual(pause.oldValue, { state: 'RUNNING' });
  assert.deepEqual(pause.newValue, { state: 'PAUSED' });
  assert.ok(items.some(function (e) { return e.outcome === 'REFUSED' && e.code === 'PAPER_SESSION_ACTIVE'; }));
});

test('RESET needs the confirmation, archives the session as a run, and deletes nothing', async function () {
  var before = await state();
  var sessionId = before.session.sessionId;
  var noConfirm = await operator.post('/api/paper/reset', {});
  assert.equal(noConfirm.status, 409);
  assert.equal(noConfirm.body.error.code, 'CONFIRMATION_REQUIRED');
  assert.equal((await operator.post('/api/paper/reset', { confirm: 'reset' })).status, 409);
  assert.equal((await state()).state, 'STOPPED');

  var done = await operator.post('/api/paper/reset', { confirm: 'RESET' });
  assert.equal(done.status, 200);
  assert.equal(done.body.result.state, 'IDLE');
  assert.equal(done.body.result.session, null);
  assert.equal(done.body.result.lastArchived.sessionId, sessionId);

  var run = (await viewer.get('/api/backtest/' + sessionId)).body.result;
  assert.equal(run.run.kind, 'PAPER');
  assert.equal(run.run.label, 'PAPER');
  assert.equal(run.run.status, 'COMPLETED');
  assert.equal(run.dataLabel, 'PAPER');
  assert.equal(run.result.paper, true);
  assert.equal(run.result.feedKind, 'REPLAY');
  assert.match(run.result.note, /No order was sent anywhere/);
  var trades = (await viewer.get('/api/trades?run=' + sessionId + '&limit=500')).body.result;
  assert.equal(trades.context.label, 'PAPER');
  assert.equal(trades.data.total, run.result.metrics.tradeCount, 'the archived store still holds every trade');
});

test('a viewer cannot drive the control room', async function () {
  for (var action of ['start', 'pause', 'resume', 'stop', 'reset']) {
    assert.equal((await viewer.post('/api/paper/' + action, {})).status, 403, action);
  }
});

// ---------------------------------------------------------------------------
// it is the real engine
// ---------------------------------------------------------------------------

test('a paper session and a backtest of the same configuration produce the same trades', async function () {
  var start = await operator.post('/api/paper/start', { data: DATA });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  var sessionId = start.body.result.session.sessionId;
  runAll();
  var v = await state();
  assert.equal(v.state, 'STOPPED');
  assert.equal(v.session.stopReason, 'FEED_EXHAUSTED');
  var paper = (await viewer.get('/api/trades?run=' + sessionId + '&limit=500')).body.result.data.items;
  assert.ok(paper.length >= 10, 'the session should have traded (' + paper.length + ')');

  var run = await h.runBacktest(owner, { symbols: ['EURUSD'], data: { kind: 'FIXTURE', bars: 900 }, verifyReproducible: false });
  assert.equal(run.status, 'COMPLETED', JSON.stringify(run.error));
  var backtest = (await viewer.get('/api/trades?run=' + run.runId + '&limit=500')).body.result.data.items;

  assert.equal(paper.length, backtest.length, 'paper and backtest disagree on the number of trades');
  assert.deepEqual(paper.map(shape), backtest.map(shape), 'paper and backtest disagree on a trade');
  assert.ok(paper.every(function (t) { return t.paper === true; }));
  assert.ok(backtest.every(function (t) { return t.paper === false; }), 'a backtest trade must never be marked paper');
  test.firstPaperTrades = paper.map(shape);
  await reset();
});

test('two sessions over the same data are identical: the control room adds no randomness', async function () {
  await operator.post('/api/paper/start', { data: DATA, ticksPerSecond: 1 });
  // Drive this one in uneven bursts with a pause in the middle; pacing must not matter.
  for (var i = 0; i < 137; i++) S.app.platform.paper.step();
  await operator.post('/api/paper/pause');
  await operator.post('/api/paper/resume');
  runAll();
  var v = await state();
  var trades = (await viewer.get('/api/trades?run=' + v.session.sessionId + '&limit=500')).body.result.data.items;
  assert.deepEqual(trades.map(shape), test.firstPaperTrades);
  await reset();
});

test('every paper trade ran at the Risk Engine\'s approved size', async function () {
  var runs = (await viewer.get('/api/backtest')).body.result.runs.filter(function (r) { return r.kind === 'PAPER'; });
  assert.ok(runs.length >= 2);
  var trades = (await viewer.get('/api/trades?run=' + runs[0].runId + '&limit=500')).body.result.data.items;
  trades.forEach(function (t) {
    assert.equal(t.lots, t.approvedLots);
    assert.ok(t.approvedLots <= t.requestedLots);
  });
});

// ---------------------------------------------------------------------------
// the event stream
// ---------------------------------------------------------------------------

test('the stream carries every kind of event the mission names, in strictly increasing order', async function () {
  await operator.post('/api/paper/start', { data: DATA });
  var from = S.app.platform.paper.lastEventSeq();
  runAll();
  var seen = [];
  var cursor = from - 1;
  for (;;) {
    var r = (await viewer.get('/api/paper/events?since=' + cursor + '&limit=1000')).body.result;
    seen = seen.concat(r.items);
    if (!r.items.length || !r.more) break;
    cursor = r.items[r.items.length - 1].seq;
  }
  assert.ok(seen.length > 100);
  for (var i = 1; i < seen.length; i++) assert.equal(seen[i].seq, seen[i - 1].seq + 1, 'a hole or a reorder at ' + seen[i].seq);
  var types = {};
  seen.forEach(function (e) { types[e.type] = (types[e.type] || 0) + 1; });
  ['session', 'regime', 'strategy', 'candidate', 'jev', 'risk', 'execution', 'sl', 'tp', 'result'].forEach(function (t) {
    assert.ok(types[t] > 0, 'no "' + t + '" event was emitted; saw ' + Object.keys(types).join(', '));
  });
  var risk = seen.filter(function (e) { return e.type === 'risk'; })[0];
  assert.ok(typeof risk.data.requestedLots === 'number' && typeof risk.data.approvedLots === 'number');
  var result = seen.filter(function (e) { return e.type === 'result'; })[0];
  assert.ok(['WIN', 'LOSS', 'BREAKEVEN'].indexOf(result.data.outcome) !== -1);
  assert.equal(types.sl + (types.tp || 0) + (types.close || 0), types.result, 'every close has exactly one result');
  await reset();
});

/** Reads server-sent events until `want` paper events arrived, then disconnects. */
function readStream(cookie, lastEventId, want, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var headers = { Cookie: cookie, Accept: 'text/event-stream' };
    if (lastEventId !== null) headers['Last-Event-ID'] = String(lastEventId);
    var events = [];
    var other = [];
    var req = http.request({ host: '127.0.0.1', port: S.port, path: '/api/paper/stream', headers: headers, agent: false }, function (res) {
      if (res.statusCode !== 200) { res.resume(); return resolve({ status: res.statusCode, events: [], other: [] }); }
      var buf = '';
      res.on('data', function (d) {
        buf += String(d);
        var frames = buf.split('\n\n');
        buf = frames.pop();
        frames.forEach(function (frame) {
          var ev = { event: 'message', data: '', id: null };
          frame.split('\n').forEach(function (line) {
            if (line.indexOf('event: ') === 0) ev.event = line.slice(7);
            else if (line.indexOf('data: ') === 0) ev.data += line.slice(6);
            else if (line.indexOf('id: ') === 0) ev.id = Number(line.slice(4));
          });
          if (ev.event === 'paper') events.push(Object.assign({ id: ev.id }, JSON.parse(ev.data)));
          else if (ev.event !== 'message') other.push(ev.event);
        });
        if (events.length >= want) { req.destroy(); resolve({ status: 200, events: events, other: other, headers: res.headers }); }
      });
    });
    req.on('error', function (e) { if (events.length >= want) return; reject(e); });
    setTimeout(function () { req.destroy(); resolve({ status: 200, events: events, other: other, timedOut: true }); }, timeoutMs || 6000);
    req.end();
  });
}

test('a client that reconnects with its last event id receives exactly what it missed', async function () {
  await operator.post('/api/paper/start', { data: DATA });
  var base = S.app.platform.paper.lastEventSeq();
  for (var i = 0; i < 320; i++) S.app.platform.paper.step();
  var total = S.app.platform.paper.lastEventSeq() - base;
  assert.ok(total > 60, 'expected a few dozen events, got ' + total);

  var first = await readStream(viewer.cookie(), base, 20);
  assert.equal(first.status, 200);
  assert.match(first.headers['content-type'], /text\/event-stream/);
  assert.equal(first.headers['x-accel-buffering'], 'no', 'the proxy must not buffer the stream');
  assert.equal(first.events.length >= 20, true, 'got ' + first.events.length + ' events; other: ' + first.other.join(',') + (first.timedOut ? ' (timed out)' : ''));
  assert.equal(first.events[0].seq, base + 1, 'the stream resumes immediately after the cursor');
  assert.equal(first.events[0].id, first.events[0].seq, 'the SSE id is the event sequence, so the browser resends it');

  var cut = first.events[19].seq;
  // More happens while the client is away.
  for (var j = 0; j < 80; j++) S.app.platform.paper.step();
  var end = S.app.platform.paper.lastEventSeq();
  var second = await readStream(viewer.cookie(), cut, end - cut);
  var got = second.events.map(function (e) { return e.seq; });
  assert.equal(got[0], cut + 1, 'the first event after reconnecting is the one after the last seen');
  assert.equal(got.length, end - cut);
  for (var k = 1; k < got.length; k++) assert.equal(got[k], got[k - 1] + 1, 'a hole or duplicate at ' + got[k]);
  assert.ok(second.other.indexOf('gap') === -1, 'no gap must be reported when the buffer still holds everything');
  // A client that is fully caught up gets no event and is told the stream is ready.
  var idle = await readStream(viewer.cookie(), end, 1, 1200);
  assert.deepEqual(idle.events, []);
  assert.ok(idle.other.indexOf('ready') !== -1, 'the stream must announce it is ready');
  await owner.post('/api/paper/stop');
  await reset();
});

test('a cursor older than the buffer is answered with an explicit gap, not a silent hole', async function () {
  var paper = S.app.platform.paper;
  await operator.post('/api/paper/start', { data: Object.assign({}, DATA, { bars: 2400 }) });
  runAll();
  var last = paper.lastEventSeq();
  var r = (await viewer.get('/api/paper/events?since=1&limit=10')).body.result;
  assert.ok(last > paper.EVENT_BUFFER, 'the session should have emitted more events than the buffer holds (' + last + ')');
  assert.equal(r.gap, true, 'events were dropped from the buffer; the response must say so');
  assert.ok(r.firstSeq > 2);
  var stream = await readStream(viewer.cookie(), 1, 5);
  assert.ok(stream.other.indexOf('gap') !== -1, 'the stream must send a gap event');
  var fresh = (await viewer.get('/api/paper/events?since=' + last)).body.result;
  assert.equal(fresh.gap, false);
  assert.deepEqual(fresh.items, []);
  await reset();
});

test('the stream is refused without a session and for a signed-out one', async function () {
  var anon = await readStream('tcc_session=' + 'a'.repeat(64), null, 1, 1500);
  assert.equal(anon.status, 401);
  var c = await S.login('viewer');
  var cookie = c.cookie();
  await c.logout();
  assert.equal((await readStream(cookie, null, 1, 1500)).status, 401);
});

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

test('an invalid start request is refused and leaves the room IDLE', async function () {
  var cases = [
    [{ data: { kind: 'HISTORICAL' } }, /HISTORICAL data does not exist/],
    [{ data: { kind: 'FIXTURE', symbols: ['AUDUSD'] } }, /no committed fixture/],
    [{ data: { kind: 'FIXTURE', symbols: ['EURUSD'], timeframe: 'H1' } }, /fixtures exist at M15 only/],
    [{ data: { kind: 'SYNTHETIC', symbols: ['NOPEUSD'] } }, /not in the instrument catalog/]
  ];
  for (var c of cases) {
    var res = await operator.post('/api/paper/start', c[0]);
    assert.equal(res.status, 400, JSON.stringify(c[0]) + ' → ' + res.status + ' ' + JSON.stringify(res.body));
    assert.match(res.body.error.message, c[1]);
    assert.equal((await state()).state, 'IDLE');
  }
  assert.equal((await operator.post('/api/paper/start', { demo: { challengerRecordId: 'chal-999999' } })).status, 404);
});

test('a synthetic session on an asset with no fixture works', async function () {
  var res = await operator.post('/api/paper/start', { data: { kind: 'SYNTHETIC', symbols: ['AUDUSD'], bars: 700, seed: 'paper-test' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.result.session.data.kind, 'SYNTHETIC');
  runAll();
  assert.equal((await state()).state, 'STOPPED');
  await reset();
});

test('the configuration cannot be changed under a running session', async function () {
  await operator.post('/api/paper/start', { data: DATA });
  var cfg = await owner.patch('/api/config', { changes: { jev: { scoreThreshold: 50 } }, reason: 'change during a session' });
  assert.equal(cfg.status, 409);
  assert.equal(cfg.body.error.code, 'PAPER_SESSION_ACTIVE');
  var strat = await owner.post('/api/config/strategies', { enabled: ['momentum'], reason: 'change during a session' });
  assert.equal(strat.body.error.code, 'PAPER_SESSION_ACTIVE');
  assert.equal((await state()).state, 'RUNNING');
});

test('disabling trading stops the running session first — exposure reduction never waits', async function () {
  for (var i = 0; i < 260; i++) S.app.platform.paper.step();
  var res = await operator.post('/api/config/trading', { enabled: false, reason: 'stop everything now' });
  assert.equal(res.status, 200);
  assert.equal(res.body.result.paperSessionStopped, true);
  var v = await state();
  assert.equal(v.state, 'STOPPED');
  assert.equal(v.session.stopReason, 'TRADING_DISABLED');
  assert.equal(v.mode, 'BACKTEST', 'the kill switch changed the configuration, so the PAPER approval no longer applies');
  await reset();
  var blocked = await operator.post('/api/paper/start', { data: DATA });
  assert.equal(blocked.body.error.code, 'PAPER_MODE_REQUIRED');
  await owner.post('/api/config/trading', { enabled: true, reason: 'restore trading for the next tests', confirm: 'ENABLE' });
  await h.enterPaper(owner);
});

test('a session whose mode is pulled from under it halts, is archived, and says why', async function () {
  await operator.post('/api/paper/start', { data: DATA });
  for (var i = 0; i < 250; i++) S.app.platform.paper.step();
  // Lower the mode directly on the agent's controller, behind the platform's back.
  S.app.platform.control.modeController().transition({ to: 'BACKTEST', principal: { kind: 'AGENT', id: 'agent:test' }, reason: 'anomaly' });
  assert.equal(S.app.platform.paper.step(), false);
  var v = await state();
  assert.equal(v.state, 'HALTED');
  assert.equal(v.session.error.code, 'PAPER_MODE_LOST');
  assert.equal(v.session.archived, true);
  var sys = (await viewer.get('/api/system')).body.result;
  assert.ok(sys.events.some(function (e) { return e.kind === 'PAPER_SESSION_HALTED'; }));
  var run = (await viewer.get('/api/backtest/' + v.session.sessionId)).body.result;
  assert.equal(run.run.status, 'FAILED');
  await reset();
  await h.enterPaper(owner);
});

test('with the timer on, a session advances by itself and finishes at the end of the feed', async function () {
  var A = await h.startApp({ paperAutoTick: true });
  var o = await A.login('owner');
  await o.patch('/api/config', { changes: SETUP, reason: 'auto tick setup', confirm: 'CONFIRM' });
  await h.enterPaper(o);
  var start = await o.post('/api/paper/start', { data: { kind: 'FIXTURE', symbols: ['EURUSD'], bars: 420 }, ticksPerSecond: 400 });
  assert.equal(start.status, 200);
  var done = await h.waitFor(async function () {
    var v = (await o.get('/api/paper')).body.result;
    return v.state === 'STOPPED' ? v : null;
  }, 30000, 200);
  assert.equal(done.session.stopReason, 'FEED_EXHAUSTED');
  assert.equal(done.session.ticks, 420);
  assert.equal(done.session.remainingTicks, 0);
  await A.close();
});

test('the dashboard reads the live session while one exists', async function () {
  await operator.post('/api/paper/start', { data: DATA });
  for (var i = 0; i < 400; i++) S.app.platform.paper.step();
  var d = (await viewer.get('/api/dashboard')).body.result;
  assert.equal(d.source.source, 'PAPER_SESSION');
  assert.equal(d.source.label, 'PAPER');
  assert.equal(d.account.source, 'PAPER_SESSION');
  assert.equal(d.agentStatus.state, 'PAPER_SESSION_RUNNING');
  var v = await state();
  assert.equal(d.account.equity, v.session.arms[0].equity);
  var an = (await viewer.get('/api/analysis')).body.result;
  assert.equal(an.computed, 'LIVE');
  await owner.post('/api/paper/stop');
  await reset();
});
