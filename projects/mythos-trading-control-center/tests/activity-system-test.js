'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — activity, audit and system tests
// projects/mythos-trading-control-center/tests/activity-system-test.js
//
// The three views an operator uses to answer "what happened, and what is
// running": the activity timeline, the audit chain and the system page.
//
// What must hold:
//   · the timeline never mixes its two clocks, and every filter is exact;
//   · an audit-derived event points at a real entry of the chain;
//   · UNKNOWN is not a pass, and synthetic data is never a healthy provenance;
//   · a log altered on disk is reported as broken, at the entry it broke at;
//   · none of these views leaks a credential.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var h = require('./helpers');

var S, owner, operator, viewer, stateDir, run;

async function get(c, p) {
  var r = await c.get(p);
  assert.equal(r.status, 200, p + ' → ' + r.status + ' ' + JSON.stringify(r.body));
  return r.body.result;
}
async function all(c, query) {
  var out = [];
  var total = null;
  for (var offset = 0; total === null || offset < total; offset += 500) {
    var page = await get(c, '/api/activity?limit=500&offset=' + offset + (query ? '&' + query : ''));
    total = page.total;
    out = out.concat(page.items);
  }
  assert.equal(out.length, total, 'paging returns every event exactly once');
  return out;
}

test.before(async function () {
  stateDir = h.tempDir('tcc-activity-state-');
  S = await h.startApp({ stateDir: stateDir });
  owner = await S.login('owner');
  operator = await S.login('operator');
  viewer = await S.login('viewer');
});

test.after(async function () {
  await S.close();
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

// ---------------------------------------------------------------------------
// before anything has run
// ---------------------------------------------------------------------------

test('with no run, the system page says UNKNOWN — not OK — and the timeline has no store events', async function () {
  var s = await get(viewer, '/api/system');
  assert.equal(s.health.counts.total, 13);
  assert.equal(s.health.counts.unknown, 9, 'nine checks have nothing to evaluate');
  assert.notEqual(s.health.status, 'OK', 'UNKNOWN is not a pass');
  assert.match(s.health.note, /UNKNOWN is not a pass/);
  assert.equal(s.health.runChecks, null);
  assert.match(s.health.runChecksReason, /no backtest has completed/);
  var by = {};
  s.components.forEach(function (c) { by[c.component] = c; });
  assert.deepEqual(Object.keys(by), ['Trading Agent', 'API', 'Store', 'Worker', 'Paper', 'Backtest', 'Analysis', 'Research', 'Jev', 'Risk']);
  assert.equal(by.Backtest.status, 'UNKNOWN');
  assert.equal(by.Analysis.status, 'UNKNOWN');
  assert.equal(by.Paper.status, 'UNAVAILABLE');
  assert.equal(by['Trading Agent'].status, 'OK');
  var a = await get(viewer, '/api/activity');
  assert.equal(a.storeSource.available, false);
  assert.match(a.storeSource.reason, /no backtest has completed/);
  assert.ok(a.items.length >= 3, 'the three sign-ins are already on the timeline');
  a.items.forEach(function (e) { assert.equal(e.clock, 'WALL'); });
  assert.equal(a.types.length, 14);
});

// ---------------------------------------------------------------------------
// the timeline
// ---------------------------------------------------------------------------

test('SETUP: a configuration change, a refused change, a run, a paper session and a test run', async function () {
  var cfg = await owner.patch('/api/config', { changes: { universe: ['EURUSD', 'XAUUSD'], account: { initialCapital: 5000 },
    jev: { scoreThreshold: 45, minConfidence: 0.15 }, recovery: { enabled: true, maxRecoveryLevel: 2 } }, reason: 'activity test setup', confirm: 'CONFIRM' });
  assert.equal(cfg.status, 200, JSON.stringify(cfg.body));
  assert.equal((await operator.patch('/api/config', { changes: { risk: { maxDrawdownPct: 50 } }, reason: 'operator tries to loosen a limit' })).status, 403);
  assert.equal((await owner.post('/api/config/mode', { to: 'LIVE', reason: 'owner asks for live' })).status, 403);
  run = await h.runBacktest(operator, { data: { kind: 'FIXTURE', bars: 1800 } });
  assert.equal(run.status, 'COMPLETED', JSON.stringify(run.error));
  await h.enterPaper(owner);
  assert.equal((await operator.post('/api/paper/start', { data: { kind: 'FIXTURE', symbols: ['EURUSD'], bars: 600 } })).status, 200);
  while (S.app.platform.paper.step()) { /* to the end of the feed */ }
  assert.equal((await owner.post('/api/paper/reset', { confirm: 'RESET' })).status, 200);
  var t = await operator.post('/api/testing/run', { scope: 'test', file: 'agent:core-primitives-test.js',
    name: (await get(viewer, '/api/testing')).categories[0].files[0].tests[0] });
  assert.equal(t.status, 202, JSON.stringify(t.body));
  await h.waitFor(async function () { return (await get(viewer, '/api/testing')).active === null; }, 60000, 100);
});

test('the timeline keeps its two clocks apart: wall-clock events first, then store events, each newest first', async function () {
  var items = await all(viewer, 'run=' + run.runId);
  var firstBar = items.findIndex(function (e) { return e.clock === 'BAR'; });
  assert.ok(firstBar > 0, 'there are events on both clocks');
  items.forEach(function (e, i) {
    assert.equal(e.clock, i < firstBar ? 'WALL' : 'BAR', 'the clocks are interleaved at ' + i);
    if (e.clock === 'WALL') { assert.ok(e.at && e.ts === null); } else { assert.ok(typeof e.ts === 'number' && e.at === null); }
  });
  for (var i = 1; i < firstBar; i++) assert.ok(items[i].at <= items[i - 1].at, 'wall-clock events are newest first');
  for (var j = firstBar + 1; j < items.length; j++) assert.ok(items[j].ts <= items[j - 1].ts, 'store events are newest bar first');
  // every type the mission names is produced by something real
  var seen = {};
  items.forEach(function (e) { seen[e.type] = (seen[e.type] || 0) + 1; });
  ['configuration', 'candidate', 'decision', 'trade', 'risk', 'jev', 'recovery', 'test', 'backtest', 'paper', 'warning', 'system'].forEach(function (t) {
    assert.ok(seen[t] > 0, 'no "' + t + '" event on the timeline: ' + JSON.stringify(seen));
  });
  // the store's events are exactly the store's rows
  var t = S.app.platform.runs.tables(run.runId, 'store').tables;
  assert.equal(seen.trade, t.trades.length);
});

test('every filter is exact, and filters combine', async function () {
  var base = 'run=' + run.runId;
  for (var type of ['configuration', 'trade', 'risk', 'jev', 'recovery', 'test', 'backtest', 'paper', 'decision', 'candidate']) {
    var only = await all(viewer, base + '&type=' + type);
    assert.ok(only.length > 0, type);
    only.forEach(function (e) { assert.equal(e.type, type); });
  }
  for (var sev of ['INFO', 'WARN']) {
    (await all(viewer, base + '&severity=' + sev)).forEach(function (e) { assert.equal(e.severity, sev); });
  }
  var xau = await all(viewer, base + '&asset=XAUUSD');
  assert.ok(xau.length > 0);
  xau.forEach(function (e) { assert.equal(e.asset, 'XAUUSD'); assert.equal(e.clock, 'BAR', 'only store rows carry an asset'); });
  var trades = S.app.platform.runs.tables(run.runId, 'store').tables.trades;
  var strategy = trades[0].strategyId;
  var both = await all(viewer, base + '&type=trade&strategy=' + strategy + '&asset=' + trades[0].symbol);
  assert.equal(both.length, trades.filter(function (x) { return x.strategyId === strategy && x.symbol === trades[0].symbol; }).length);
  var losses = await all(viewer, base + '&type=trade&severity=WARN');
  assert.equal(losses.length, trades.filter(function (x) { return x.outcome === 'LOSS'; }).length, 'a losing trade is a WARN event');
  assert.deepEqual(await all(viewer, base + '&type=trade&asset=USDJPY'), []);
});

test('a date range is applied to each event on its own clock', async function () {
  var base = 'run=' + run.runId;
  var today = Date.now();
  var recent = await all(viewer, base + '&fromTs=' + (today - 3600000) + '&toTs=' + (today + 3600000));
  assert.ok(recent.length > 0);
  recent.forEach(function (e) { assert.equal(e.clock, 'WALL', 'a fixture bar from the past matched a filter for the last hour'); });
  var past = await all(viewer, base + '&toTs=' + Date.parse('2024-01-01T00:00:00Z'));
  assert.ok(past.length > 0);
  past.forEach(function (e) { assert.equal(e.clock, 'BAR'); assert.ok(e.ts <= Date.parse('2024-01-01T00:00:00Z')); });
  var total = (await get(viewer, '/api/activity?' + base + '&limit=1')).total;
  assert.equal(recent.length + past.length, total, 'the two ranges partition the timeline');
  var mid = past[Math.floor(past.length / 2)].ts;
  (await all(viewer, base + '&fromTs=' + mid + '&toTs=' + mid)).forEach(function (e) { assert.equal(e.ts, mid); });
});

test('an audit-derived event points at a real entry of the chain; refusals are WARN', async function () {
  var items = (await all(viewer, 'type=configuration'));
  var audit = (await get(owner, '/api/audit?limit=500')).items;
  var bySeq = {};
  audit.forEach(function (e) { bySeq[e.seq] = e; });
  assert.ok(items.length >= 4);
  items.forEach(function (e) {
    assert.equal(e.source, 'AUDIT');
    var entry = bySeq[e.ref.auditSeq];
    assert.ok(entry, 'activity names audit #' + e.ref.auditSeq + ', which does not exist');
    assert.equal(entry.hash, e.ref.hash);
    assert.equal(e.at, entry.ts);
    assert.equal(e.severity, entry.outcome === 'ACCEPTED' ? 'INFO' : 'WARN');
    assert.ok(e.message.indexOf(entry.action) === 0);
  });
  var refused = items.filter(function (e) { return e.severity === 'WARN'; });
  assert.ok(refused.some(function (e) { return /config\.update REFUSED \(FORBIDDEN\) by operator/.test(e.message); }));
  assert.ok(refused.some(function (e) { return /mode\.set REFUSED \(LIVE_NOT_AVAILABLE\) by owner/.test(e.message); }), 'the refused LIVE request is on the timeline');
});

test('the activity query is validated: unknown keys, oversize pages and malformed values are refused', async function () {
  for (var q of ['limit=501', 'limit=0', 'offset=-1', 'type=Trade', 'severity=FATAL', 'asset=../../etc', 'strategy=a%20b', 'fromTs=yesterday', 'run=nope', 'sort=at', 'type[]=trade']) {
    assert.equal((await viewer.get('/api/activity?' + q)).status, 400, q);
  }
  // a run that does not exist leaves the operator's own events readable, and says why the store's are absent
  var gone = await get(viewer, '/api/activity?run=bt-20200101000000-aaaaaa');
  assert.equal(gone.storeSource.available, false);
  assert.match(gone.storeSource.reason, /bt-20200101000000-aaaaaa/);
  gone.items.forEach(function (e) { assert.equal(e.clock, 'WALL'); });
  assert.equal((await S.client().get('/api/activity')).status, 401);
});

test('a run that fails is an ERROR on the timeline and in the system events', async function () {
  var A = await h.startApp({ jobTimeoutMs: 30 });
  try {
    var op = await A.login('operator');
    var failed = await h.runBacktest(op, { symbols: ['EURUSD'], data: { kind: 'FIXTURE', bars: 3000 } });
    assert.equal(failed.status, 'TIMEOUT');
    var errors = (await get(op, '/api/activity?severity=ERROR')).items;
    assert.ok(errors.some(function (e) { return e.type === 'backtest' && e.ref.runId === failed.runId && /TIMEOUT/.test(e.message); }));
    assert.ok(errors.some(function (e) { return e.type === 'error' && /RUN_TIMEOUT/.test(e.message); }));
    var s = await get(op, '/api/system');
    assert.equal(s.events[0].severity, 'ERROR');
    assert.match(s.events[0].kind, /RUN_TIMEOUT/);
    assert.equal(s.health.counts.unknown, 9, 'a run that did not complete evaluates no check');
  } finally { await A.close(); }
});

// ---------------------------------------------------------------------------
// the system page
// ---------------------------------------------------------------------------

test('the system page reports version, commit, environment, uptime, deployment and the LIVE lock', async function () {
  var s = await get(viewer, '/api/system');
  var st = await get(viewer, '/api/status');
  assert.match(s.version, /^\d+\.\d+\.\d+$/);
  assert.equal(s.commit, st.commit);
  assert.equal(s.commitKnown, true);
  assert.match(s.commit, /^[0-9a-f]{40}$/);
  assert.equal(typeof s.environment, 'string');
  assert.match(s.node, /^v\d+/);
  assert.ok(s.uptimeSeconds >= 0 && Date.parse(s.startedAt) <= Date.now());
  assert.equal(s.mode, 'PAPER');
  assert.equal(s.configFingerprint, st.configFingerprint);
  assert.equal(s.deployment.service, 'mythos-trading-control-center');
  assert.equal(s.deployment.bind.port, S.port);
  assert.equal(s.deployment.releaseCommit, s.commit);
  assert.equal(s.deployment.webBuild.built, false, 'the tests serve the unbuilt sources, and the page says so');
  assert.deepEqual(s.liveExecution, { available: false, adapter: 'live-refusing-stub', refusalVerified: true });
  assert.equal(s.persistence.persistence, 'PERSISTENT');
  assert.deepEqual([s.auth.provisioned, s.auth.users, s.auth.hasOwner], [true, 3, true]);
  assert.equal(s.sessions, 3);
  assert.ok(s.memory.rssMb > 10);
  assert.equal(s.runs.retained, 2);
  var by = {};
  s.components.forEach(function (c) { by[c.component] = c; assert.ok(['OK', 'WARN', 'FAIL', 'BUSY', 'UNKNOWN', 'UNAVAILABLE', 'STOPPED'].indexOf(c.status) !== -1, c.component + ' ' + c.status); });
  assert.equal(by.Paper.status, 'OK');
  assert.equal(by.Backtest.status, 'OK');
  assert.match(by.Risk.detail, /final authority on size/);
  assert.equal((await viewer.get('/api/system?verbose=1')).status, 400);
  assert.equal((await S.client().get('/api/system')).status, 401);
});

test('after a run all thirteen checks are evaluated, and synthetic data keeps the health at WARN', async function () {
  var s = await get(viewer, '/api/system');
  var hlt = s.health;
  assert.equal(hlt.counts.unknown, 0);
  assert.equal(hlt.counts.ok + hlt.counts.warn + hlt.counts.fail, 13);
  assert.equal(hlt.staticChecks.length + hlt.runChecks.length, 13);
  var prov = hlt.runChecks.filter(function (c) { return c.check === 'DATA_PROVENANCE'; })[0];
  assert.equal(prov.status, 'WARN');
  assert.equal(hlt.status, 'WARN', 'the health of a platform running on synthetic data is never OK');
  assert.equal(hlt.note, null);
  assert.equal(hlt.runChecksSource.runId, run.runId, 'a paper session does not replace the backtest the checks are read from');
  assert.equal(hlt.runChecksSource.configCurrent, true);
  hlt.staticChecks.concat(hlt.runChecks).forEach(function (c) { assert.ok(c.detail && c.detail.length > 5, c.check + ' gives no detail'); });
  // a configuration change makes the run checks stale, and the page says so
  await owner.patch('/api/config', { changes: { jev: { scoreThreshold: 50 } }, reason: 'make the run checks stale' });
  var stale = (await get(viewer, '/api/system')).health;
  assert.equal(stale.runChecksSource.configCurrent, false);
  assert.equal((await get(viewer, '/api/system')).mode, 'BACKTEST');
});

test('the system and activity views carry no credential, cookie, token or file path of the state', async function () {
  var blobs = [JSON.stringify(await get(owner, '/api/system')), JSON.stringify(await all(owner, 'run=' + run.runId)),
    JSON.stringify(await get(owner, '/api/audit?limit=500'))];
  blobs.forEach(function (text) {
    [h.PASSWORDS.owner, h.PASSWORDS.operator, h.PASSWORDS.viewer, owner.cookie().split('=')[1], owner.csrf(), 'scrypt', stateDir].forEach(function (secret) {
      assert.equal(text.indexOf(secret), -1, 'a view contains "' + String(secret).slice(0, 12) + '…"');
    });
    assert.doesNotMatch(text, /passwordHash|"salt"|tcc_session=/);
  });
});

// ---------------------------------------------------------------------------
// the audit chain
// ---------------------------------------------------------------------------

test('the audit log is filtered by action prefix, outcome and actor, and pages without gaps', async function () {
  var full = await get(viewer, '/api/audit?limit=500');
  assert.equal(full.total, full.head.seq);
  assert.equal(full.items[0].hash, full.head.hash, 'the head is the newest entry');
  for (var i = 1; i < full.items.length; i++) {
    assert.equal(full.items[i].seq, full.items[i - 1].seq - 1);
    assert.equal(full.items[i - 1].prevHash, full.items[i].hash, 'each entry carries the hash of the one before it');
  }
  (await get(viewer, '/api/audit?action=config.')).items.forEach(function (e) { assert.ok(e.action.indexOf('config.') === 0); });
  var refused = (await get(viewer, '/api/audit?outcome=REFUSED')).items;
  assert.ok(refused.length >= 2);
  refused.forEach(function (e) { assert.equal(e.outcome, 'REFUSED'); assert.ok(e.code, 'a refusal records why'); });
  (await get(viewer, '/api/audit?actor=operator')).items.forEach(function (e) { assert.equal(e.actor.id, 'operator'); });
  var paged = [];
  for (var off = 0; off < full.total; off += 4) paged = paged.concat((await get(viewer, '/api/audit?limit=4&offset=' + off)).items);
  assert.deepEqual(paged.map(function (e) { return e.seq; }), full.items.map(function (e) { return e.seq; }));
  var s = await get(viewer, '/api/system');
  assert.deepEqual([s.audit.entries, s.audit.head.hash, s.audit.integrityAtStart.ok], [full.total, full.head.hash, true]);
  var v = await get(viewer, '/api/audit/verify');
  assert.deepEqual([v.ok, v.entries, v.head], [true, full.total, full.head.hash]);
  for (var q of ['action=DROP', 'outcome=MAYBE', 'actor=../x', 'limit=501', 'seq=1']) assert.equal((await viewer.get('/api/audit?' + q)).status, 400, q);
  assert.equal((await owner.post('/api/audit', {})).status, 405, 'the log has no write route');
  assert.equal((await owner.request('DELETE', '/api/audit')).status, 405);
  assert.equal((await owner.request('PATCH', '/api/audit', { seq: 1 })).status, 405);
});

test('a log altered on disk is reported broken at the entry it broke at — at start-up and on verify', async function () {
  await S.close();
  var file = path.join(stateDir, 'audit.jsonl');
  var lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  var target = lines.findIndex(function (l) { var e = JSON.parse(l); return e.action === 'config.update' && e.outcome === 'REFUSED' && e.actor.id === 'operator'; });
  assert.ok(target > 0);
  var entry = JSON.parse(lines[target]);
  entry.outcome = 'ACCEPTED';           // rewrite a refusal as an acceptance
  entry.code = null;
  lines[target] = JSON.stringify(entry);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  S = await h.startApp({ stateDir: stateDir });
  viewer = await S.login('viewer');
  var s = await get(viewer, '/api/system');
  assert.equal(s.audit.integrityAtStart.ok, false);
  assert.equal(s.audit.integrityAtStart.brokenAtSeq, entry.seq);
  var v = await get(viewer, '/api/audit/verify');
  assert.equal(v.ok, false);
  assert.equal(v.brokenAtSeq, entry.seq);
  assert.ok(v.problem.length > 5);
  // the log keeps working — a broken chain is reported, not hidden and not fatal
  assert.ok((await get(viewer, '/api/audit?limit=1')).head.seq > lines.length, 'the sign-in after the restart was still recorded');
});
