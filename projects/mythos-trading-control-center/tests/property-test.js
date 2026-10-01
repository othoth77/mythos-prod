'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — property tests
// projects/mythos-trading-control-center/tests/property-test.js
//
// The Trading Agent proves, with randomised unit properties, that the Risk
// Engine's approved size never breaches a cap. These properties ask the same
// question one level up: through the API, with randomised limits chosen the
// way an operator could choose them, does the END-TO-END system keep them?
//
// Every case is generated from a seeded generator, so a failure names the
// case that failed and can be replayed exactly.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');

var h = require('./helpers');
var validate = require('../server/validate');
var views = require('../server/views');

/** mulberry32 — a small seeded generator, so every case is reproducible. */
function rng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(r, list) { return list[Math.floor(r() * list.length)]; }
function between(r, lo, hi, dp) { var f = Math.pow(10, dp); return Math.round((lo + r() * (hi - lo)) * f) / f; }

var S, owner, viewer;

test.before(async function () {
  S = await h.startApp();
  owner = await S.login('owner');
  viewer = await S.login('viewer');
});

test.after(async function () { await S.close(); });

test('PROPERTY: over randomised limits, no trade exceeds the position cap, its request, or its recovery cap', async function () {
  var r = rng(20261001);
  var symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];
  var totals = { runs: 0, trades: 0, assessments: 0, clamps: 0, blocks: 0 };
  for (var i = 0; i < 8; i++) {
    var c = {
      symbols: [pick(r, symbols)],
      initialCapital: pick(r, [100, 500, 2000, 5000, 50000]),
      data: { kind: 'FIXTURE', bars: 900 + Math.floor(r() * 900) },
      jev: { scoreThreshold: between(r, 35, 60, 0), minConfidence: between(r, 0.1, 0.35, 2) },
      risk: {
        maxPositionSizeLots: pick(r, [0.01, 0.02, 0.05, 0.1, 0.5]),
        maxAccountRiskPerTradePct: between(r, 0.2, 5, 2),
        maxConsecutiveLosses: 2 + Math.floor(r() * 6)
      },
      recovery: { enabled: r() < 0.75, maxRecoveryLevel: 1 + Math.floor(r() * 4) },
      cost: { slippageModel: 'fixed', fixedSlippagePips: between(r, 0, 1, 1) },
      verifyReproducible: false
    };
    var label = 'case ' + i + ' ' + JSON.stringify(c);
    var run = await h.runBacktest(owner, c);
    assert.equal(run.status, 'COMPLETED', label + ' → ' + JSON.stringify(run.error));
    var t = S.app.platform.runs.tables(run.runId, 'store').tables;
    var approved = {};
    (t.risk_assessments || []).forEach(function (a) {
      totals.assessments++;
      if (a.verdict === 'CLAMP') totals.clamps++;
      if (a.verdict === 'BLOCK') totals.blocks++;
      approved[a.candidateId] = a;
      assert.ok(a.approvedLots <= a.requestedLots + 1e-9, label + ': approved above the request');
      assert.ok(a.approvedLots <= c.risk.maxPositionSizeLots + 1e-9, label + ': approved above the position cap');
      if (a.verdict === 'BLOCK') assert.equal(a.approvedLots, 0, label + ': a BLOCK approved a size');
      else assert.ok(a.approvedLots >= 0.01 - 1e-9, label + ': a non-tradable size was approved');
    });
    (t.trades || []).forEach(function (x) {
      totals.trades++;
      assert.equal(x.lots, approved[x.candidateId].approvedLots, label + ': a trade ran at an unapproved size');
      assert.ok(x.lots <= c.risk.maxPositionSizeLots + 1e-9, label + ': a trade above the position cap');
      assert.ok(x.recoveryLevel <= (c.recovery.enabled ? c.recovery.maxRecoveryLevel : 0), label + ': a trade above the recovery cap');
      assert.ok(Math.abs(x.netPnl - (x.grossPnl - x.costsMoney)) < 1e-6, label + ': net != gross - costs');
    });
    (t.recovery_states || []).forEach(function (s) {
      assert.ok(s.level <= c.recovery.maxRecoveryLevel, label + ': recovery level above its cap');
    });
    // one trade at a time, in every case
    var open = 0;
    var events = [];
    (t.positions || []).forEach(function (p) { events.push({ ts: p.status === 'OPEN' ? p.entryTs : p.exitTs, d: p.status === 'OPEN' ? 1 : -1 }); });
    events.sort(function (a, b) { return a.ts - b.ts || b.d - a.d; });
    events.forEach(function (e) { open += e.d; assert.ok(open <= 1, label + ': more than one position open'); });
    totals.runs++;
  }
  assert.equal(totals.runs, 8);
  assert.ok(totals.trades > 100, 'the property was exercised on too few trades: ' + totals.trades);
  assert.ok(totals.clamps > 0 && totals.blocks > 0, 'both the clamp and the block path must be exercised: ' + JSON.stringify(totals));
});

test('PROPERTY: a value outside a declared range is never accepted, whatever the key', async function () {
  var cfg = (await viewer.get('/api/config')).body.result;
  var r = rng(77);
  var before = cfg.fingerprint;
  var tried = 0;
  for (var path of Object.keys(cfg.ranges)) {
    var range = cfg.ranges[path];
    if (range.type !== 'number' && range.type !== 'integer') continue;
    for (var bad of [range.max + 1 + Math.floor(r() * 1000), range.min - 1 - Math.floor(r() * 1000)]) {
      var changes = {};
      var parts = path.split('.');
      var cur = changes;
      parts.forEach(function (p, i) { cur[p] = i === parts.length - 1 ? bad : {}; cur = cur[p]; });
      var res = await owner.patch('/api/config', { changes: changes, reason: 'property: out-of-range value', confirm: 'CONFIRM' });
      assert.equal(res.status, 400, path + '=' + bad + ' was accepted (' + res.status + ')');
      tried++;
    }
  }
  assert.ok(tried >= 30, 'only ' + tried + ' out-of-range values were tried');
  assert.equal((await viewer.get('/api/config')).body.result.fingerprint, before, 'the configuration must be untouched');
});

test('PROPERTY: random junk bodies never change the mode, the configuration or the trading switch', async function () {
  var r = rng(4242);
  var junk = [null, true, 0, -1, 1e308, '', 'LIVE', 'PAPER', [], {}, [1, 2], { a: 1 }, 'x'.repeat(300), { to: 'LIVE' }];
  var keys = ['to', 'mode', 'enabled', 'changes', 'reason', 'approval', 'confirm', 'lots', 'live', 'risk', 'ownerApproval', 'statement'];
  var routes = [['POST', '/api/config/mode'], ['PATCH', '/api/config'], ['POST', '/api/config/trading'], ['POST', '/api/config/strategies'],
    ['POST', '/api/paper/start'], ['POST', '/api/research/champion/seed']];
  var before = (await viewer.get('/api/status')).body.result;
  for (var i = 0; i < 150; i++) {
    var body = {};
    var n = 1 + Math.floor(r() * 4);
    for (var k = 0; k < n; k++) body[pick(r, keys)] = pick(r, junk);
    var route = pick(r, routes);
    var res = await owner.request(route[0], route[1], body);
    assert.ok(res.status >= 400 && res.status < 500, route[1] + ' ' + JSON.stringify(body).slice(0, 120) + ' → ' + res.status);
  }
  var after = (await viewer.get('/api/status')).body.result;
  assert.equal(after.mode, 'BACKTEST');
  assert.equal(after.mode, before.mode);
  assert.equal(after.configFingerprint, before.configFingerprint);
  assert.equal(after.tradingEnabled, before.tradingEnabled);
  assert.equal((await viewer.get('/api/audit/verify')).body.result.ok, true, 'the audit chain survives 150 refused requests');
});

test('PROPERTY: the validator accepts exactly the values inside a numeric range', function () {
  var r = rng(9);
  for (var i = 0; i < 400; i++) {
    var lo = between(r, -1000, 1000, 2);
    var hi = lo + between(r, 0, 500, 2);
    var v = between(r, lo - 300, hi + 300, 3);
    assert.equal(validate.check(validate.num(lo, hi), v).ok, v >= lo && v <= hi, 'num(' + lo + ',' + hi + ') on ' + v);
    var iv = Math.round(v);
    assert.equal(validate.check(validate.int(Math.ceil(lo), Math.floor(hi)), iv).ok, iv >= Math.ceil(lo) && iv <= Math.floor(hi));
  }
});

test('PROPERTY: every score falls in exactly one Jev band', function () {
  var r = rng(31337);
  var keys = views.JEV_BANDS.map(function (b) { return b.key; }).concat(['BELOW_70']);
  for (var i = 0; i < 2000; i++) {
    var score = between(r, 0, 100, 4);
    var band = views.bandOf(score);
    assert.ok(keys.indexOf(band) !== -1, score + ' → ' + band);
    var matches = views.JEV_BANDS.filter(function (b) { return score >= b.low && score < b.high + 1; });
    assert.ok(matches.length <= 1, score + ' falls in two bands');
    assert.equal(band, matches.length ? matches[0].key : 'BELOW_70');
  }
});

test('PROPERTY: downsampling never invents a sample and always keeps the first and the last', function () {
  var r = rng(555);
  for (var i = 0; i < 200; i++) {
    var n = 1 + Math.floor(r() * 5000);
    var max = 2 + Math.floor(r() * 600);
    var rows = [];
    for (var k = 0; k < n; k++) rows.push({ k: k });
    var out = views.downsample(rows, max);
    assert.ok(out.length <= max + 1, n + ' → ' + out.length + ' with max ' + max);
    assert.equal(out[0], rows[0]);
    assert.equal(out[out.length - 1], rows[n - 1]);
    out.forEach(function (x, idx) { assert.ok(rows.indexOf(x) !== -1); if (idx) assert.ok(x.k > out[idx - 1].k, 'order must be preserved'); });
  }
});
