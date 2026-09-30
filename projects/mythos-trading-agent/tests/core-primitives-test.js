'use strict';
// =====================================================
// MYTHOS TRADING AGENT — core primitive tests
// projects/mythos-trading-agent/tests/core-primitives-test.js
//
// These cover the arithmetic every later phase trusts silently: rounding,
// pip/lot/account-currency conversion, seeded randomness and canonical hashing.
// A defect here does not announce itself — it shows up as a backtest that
// disagrees with itself, or as a USDJPY equity curve overstated 150-fold.
//
// Run: npm test  (i.e. node --test tests/*-test.js)
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var money = require(path.join(SRC, 'core', 'money'));
var rng = require(path.join(SRC, 'core', 'rng'));
var hashMod = require(path.join(SRC, 'core', 'hash'));
var clock = require(path.join(SRC, 'core', 'clock'));
var enums = require(path.join(SRC, 'core', 'enums'));
var ids = require(path.join(SRC, 'core', 'ids'));
var logger = require(path.join(SRC, 'core', 'logger'));
var instrument = require(path.join(SRC, 'core', 'instrument'));

// ---------------------------------------------------------------------------
test('money.round is half-away-from-zero and symmetric for negatives', function () {
  assert.equal(money.round(1.005, 2), 1.01);
  assert.equal(money.round(-1.005, 2), -1.01, 'losses must round like wins, mirrored');
  assert.equal(money.round(2.675, 2), 2.68);
  assert.equal(money.round(-2.675, 2), -2.68);
  assert.equal(money.round(0.5, 0), 1);
  assert.equal(money.round(-0.5, 0), -1, 'Math.round(-0.5) is -0; ours must be -1');
  assert.equal(money.round(-0.0000001, 2), 0, '-0 is normalised to 0');
  assert.ok(!Object.is(money.round(-0.0000001, 2), -0));
});

test('money.round rejects non-finite input rather than poisoning a ledger', function () {
  assert.throws(function () { money.round(NaN, 2); }, TypeError);
  assert.throws(function () { money.round(Infinity, 2); }, TypeError);
  assert.throws(function () { money.round('1.5', 2); }, TypeError);
});

test('money.floorToStep always rounds sizing DOWN', function () {
  assert.equal(money.floorToStep(0.0299, 0.01), 0.02);
  assert.equal(money.floorToStep(0.03, 0.01), 0.03, 'an exact multiple must not fall a step');
  assert.equal(money.floorToStep(0.09999999, 0.01), 0.09);
  assert.equal(money.floorToStep(0.009, 0.01), 0, 'below one step is not tradable, not rounded up');
  assert.equal(money.floorToStep(1.23456, 0.01), 1.23);
  assert.throws(function () { money.floorToStep(1, 0); }, RangeError);
});

test('money.clamp and money.fraction behave at the edges', function () {
  assert.equal(money.clamp(5, 1, 3), 3);
  assert.equal(money.clamp(-5, 1, 3), 1);
  assert.equal(money.clamp(2, 1, 3), 2);
  assert.throws(function () { money.clamp(2, 3, 1); }, RangeError);
  assert.equal(money.fraction(5, 100), 0.05);
  assert.equal(money.fraction(5, 0), 0, 'a drawdown on zero equity is absent, not infinite');
});

// ---------------------------------------------------------------------------
test('rng is reproducible from a seed and independent across forks', function () {
  var a = rng.create('seed-1');
  var b = rng.create('seed-1');
  var seqA = [], seqB = [];
  for (var i = 0; i < 50; i++) { seqA.push(a.float()); seqB.push(b.float()); }
  assert.deepEqual(seqA, seqB, 'same seed must give the same stream');

  var c = rng.create('seed-2');
  assert.notEqual(c.float(), rng.create('seed-1').float());

  var parent = rng.create('run');
  var f1 = parent.fork('EURUSD').float();
  var f2 = parent.fork('XAUUSD').float();
  assert.notEqual(f1, f2, 'forks by tag must differ');
  assert.equal(rng.create('run').fork('EURUSD').float(), f1, 'a fork is a pure function of (seed, tag)');
});

test('rng draws stay inside their declared ranges', function () {
  var g = rng.create(12345);
  for (var i = 0; i < 2000; i++) {
    var f = g.float();
    assert.ok(f >= 0 && f < 1);
    var n = g.int(3, 7);
    assert.ok(n >= 3 && n <= 7 && n === Math.floor(n));
    var u = g.uniform(-2, 2);
    assert.ok(u >= -2 && u < 2);
  }
  assert.throws(function () { g.int(5, 1); }, RangeError);
  assert.throws(function () { rng.create(''); }, TypeError);
});

test('rng.normal has approximately the requested mean and sd', function () {
  var g = rng.create('normal-check');
  var n = 20000, sum = 0, sumSq = 0;
  for (var i = 0; i < n; i++) {
    var v = g.normal(5, 2);
    sum += v; sumSq += v * v;
  }
  var mean = sum / n;
  var sd = Math.sqrt(sumSq / n - mean * mean);
  assert.ok(Math.abs(mean - 5) < 0.08, 'mean was ' + mean);
  assert.ok(Math.abs(sd - 2) < 0.08, 'sd was ' + sd);
});

test('rng.shuffle does not mutate its input and is seed-stable', function () {
  var src = [1, 2, 3, 4, 5, 6, 7, 8];
  var s1 = rng.create('shuffle').shuffle(src);
  var s2 = rng.create('shuffle').shuffle(src);
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(s1, s2);
  assert.deepEqual(s1.slice().sort(function (a, b) { return a - b; }), src);
});

test('rng.snapshot/restore resumes the exact stream', function () {
  var g = rng.create('resume');
  g.float(); g.float();
  var snap = g.snapshot();
  var after = [g.float(), g.float(), g.float()];
  var h = rng.create('resume').restore(snap);
  assert.deepEqual([h.float(), h.float(), h.float()], after);
});

// ---------------------------------------------------------------------------
test('hash.canonical is independent of key insertion order', function () {
  var a = { b: 1, a: { d: 4, c: 3 }, arr: [1, { y: 2, x: 1 }] };
  var b = { arr: [1, { x: 1, y: 2 }], a: { c: 3, d: 4 }, b: 1 };
  assert.equal(hashMod.canonical(a), hashMod.canonical(b));
  assert.equal(hashMod.sha256(a), hashMod.sha256(b));
});

test('hash.canonical refuses values JSON cannot round-trip', function () {
  assert.throws(function () { hashMod.canonical({ x: NaN }); }, /non-finite/);
  assert.throws(function () { hashMod.canonical({ x: Infinity }); }, /non-finite/);
  assert.throws(function () { hashMod.canonical({ x: function () {} }); }, /unserialisable/);
  // undefined members vanish, exactly as JSON.stringify does
  assert.equal(hashMod.canonical({ a: 1, b: undefined }), '{"a":1}');
});

test('hash.canonical treats array order as significant', function () {
  assert.notEqual(hashMod.sha256([1, 2]), hashMod.sha256([2, 1]));
});

test('hash.fingerprint reports a stable short hash and byte length', function () {
  var fp = hashMod.fingerprint({ mode: 'BACKTEST', risk: { maxDrawdownPct: 20 } });
  assert.equal(fp.shortHash.length, 12);
  assert.equal(fp.hash.length, 64);
  assert.equal(fp.hash.slice(0, 12), fp.shortHash);
  assert.equal(fp.bytes, Buffer.byteLength(fp.canonical, 'utf8'));
});

// ---------------------------------------------------------------------------
test('clock floors to timeframe boundaries in UTC', function () {
  var t = clock.parse('2024-03-05T13:07:31.500Z');
  assert.equal(clock.iso(clock.floorToTimeframe(t, 'M15')), '2024-03-05T13:00:00.000Z');
  assert.equal(clock.iso(clock.floorToTimeframe(t, 'H1')), '2024-03-05T13:00:00.000Z');
  assert.equal(clock.iso(clock.floorToTimeframe(t, 'H4')), '2024-03-05T12:00:00.000Z');
  assert.equal(clock.iso(clock.floorToTimeframe(t, 'D1')), '2024-03-05T00:00:00.000Z');
  assert.equal(clock.iso(clock.addBars(clock.floorToTimeframe(t, 'M15'), 'M15', 4)), '2024-03-05T14:00:00.000Z');
});

test('clock identifies the forex weekend conservatively', function () {
  assert.equal(clock.isForexWeekend(clock.parse('2024-03-08T20:59:00Z')), false, 'Friday 20:59 is open');
  assert.equal(clock.isForexWeekend(clock.parse('2024-03-08T21:00:00Z')), true, 'Friday 21:00 is closed');
  assert.equal(clock.isForexWeekend(clock.parse('2024-03-09T12:00:00Z')), true, 'Saturday');
  assert.equal(clock.isForexWeekend(clock.parse('2024-03-10T20:00:00Z')), true, 'Sunday before 21:00');
  assert.equal(clock.isForexWeekend(clock.parse('2024-03-10T21:00:00Z')), false, 'Sunday 21:00 reopens');
  assert.equal(clock.isForexWeekend(clock.parse('2024-03-06T12:00:00Z')), false, 'Wednesday');
});

test('clock hour windows handle the midnight wrap', function () {
  var t = clock.parse('2024-03-05T23:30:00Z');
  assert.equal(clock.inHourWindow(t, 22, 6), true);
  assert.equal(clock.inHourWindow(t, 6, 22), false);
  assert.equal(clock.inHourWindow(t, 0, 0), true, 'start === end means 24 hours');
  assert.equal(clock.inHourWindow(clock.parse('2024-03-05T05:59:00Z'), 22, 6), true);
  assert.equal(clock.inHourWindow(clock.parse('2024-03-05T06:00:00Z'), 22, 6), false);
});

test('clock day and week keys are UTC and ISO-week correct', function () {
  assert.equal(clock.dayKey(clock.parse('2024-03-05T23:59:59Z')), '2024-03-05');
  assert.equal(clock.weekKey(clock.parse('2024-01-01T00:00:00Z')), '2024-W01');
  assert.equal(clock.weekKey(clock.parse('2023-01-01T00:00:00Z')), '2022-W52', 'a Sunday belongs to the previous ISO week');
  assert.equal(clock.weekKey(clock.parse('2024-12-30T00:00:00Z')), '2025-W01');
});

test('clock.parse rejects unparseable input', function () {
  assert.throws(function () { clock.parse('not-a-date'); }, TypeError);
  assert.throws(function () { clock.parse(null); }, TypeError);
  assert.equal(clock.parse(1700000000000), 1700000000000);
});

// ---------------------------------------------------------------------------
test('enums.assertEnum names the legal values when it throws', function () {
  assert.equal(enums.assertEnum(enums.Mode, 'BACKTEST', 'mode'), 'BACKTEST');
  assert.throws(function () { enums.assertEnum(enums.Mode, 'DEMO', 'mode'); }, /must be one of \[BACKTEST, PAPER, LIVE\]/);
  assert.equal(enums.isValid(enums.Regime, 'UNSTABLE'), true);
  assert.equal(enums.isValid(enums.Regime, 'SIDEWAYS'), false);
});

test('enum objects are frozen so a typo cannot add a member at runtime', function () {
  assert.throws(function () { 'use strict'; enums.Mode.SANDBOX = 'SANDBOX'; }, TypeError);
  assert.equal(enums.Mode.SANDBOX, undefined);
});

// ---------------------------------------------------------------------------
test('ids are counter-based, so two runs of one config agree', function () {
  var s1 = ids.createSequence('run.abc123');
  var s2 = ids.createSequence('run.abc123');
  assert.equal(s1.next('cand'), 'cand-run.abc123-000001');
  assert.equal(s1.next('cand'), 'cand-run.abc123-000002');
  assert.equal(s1.next('trade'), 'trade-run.abc123-000001', 'sequences are per prefix');
  assert.equal(s2.next('cand'), 'cand-run.abc123-000001');
  assert.equal(s1.peek('cand'), 2);
  assert.deepEqual(s1.counters(), { cand: 2, trade: 1 });
  assert.throws(function () { ids.createSequence(''); }, TypeError);
});

test('ids.runId is derived from label and config hash', function () {
  assert.equal(ids.runId('in sample/2024', 'abc123def456'), 'in-sample-2024.abc123def456');
});

// ---------------------------------------------------------------------------
test('logger writes structured records to memory and never to disk by default', function () {
  var t = 1700000000000;
  var log = logger.create({ level: 'DEBUG', now: function () { return t; }, bindings: { run: 'r1' } });
  log.info('candidate.created', { symbol: 'EURUSD', score: 81 });
  log.child({ symbol: 'XAUUSD' }).warn('risk.blocked', { limit: 'MAX_DRAWDOWN' });
  var lines = log.memory().lines();
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { ts: t, level: 'INFO', event: 'candidate.created', run: 'r1', symbol: 'EURUSD', score: 81 });
  assert.equal(lines[1].symbol, 'XAUUSD');
  assert.equal(lines[1].limit, 'MAX_DRAWDOWN');
  assert.equal(log.sinks().length, 1);
  assert.equal(log.sinks()[0].kind, 'memory');
});

test('logger respects its level and redacts secret-shaped fields', function () {
  var log = logger.create({ level: 'WARN', now: function () { return 0; } });
  log.debug('a'); log.info('b'); log.warn('c'); log.error('d');
  assert.deepEqual(log.memory().lines().map(function (l) { return l.event; }), ['c', 'd']);

  var log2 = logger.create({ level: 'INFO', now: function () { return 0; } });
  log2.info('venue.connect', { apiKey: 'shhh', nested: { token: 'abc', keep: 1 } });
  var rec = log2.memory().lines()[0];
  assert.equal(rec.apiKey, '[redacted]');
  assert.equal(rec.nested.token, '[redacted]');
  assert.equal(rec.nested.keep, 1);
});

test('logger memory sink drops oldest beyond its cap and counts the loss', function () {
  var log = logger.create({ level: 'INFO', sinks: [logger.memorySink(3)], now: function () { return 0; } });
  ['a', 'b', 'c', 'd', 'e'].forEach(function (e) { log.info(e); });
  assert.deepEqual(log.memory().lines().map(function (l) { return l.event; }), ['c', 'd', 'e']);
  assert.equal(log.memory().dropped(), 2);
});

// ---------------------------------------------------------------------------
test('instrument catalog loads the shipped research universe', function () {
  var cat = instrument.defaultCatalog();
  assert.equal(cat.accountCurrency, 'USD');
  assert.deepEqual(cat.symbols.slice().sort(), ['AUDUSD', 'EURUSD', 'GBPUSD', 'USDCAD', 'USDCHF', 'USDJPY', 'XAUUSD']);
  assert.equal(cat.get('EURUSD').pipSize, 0.0001);
  assert.throws(function () { cat.get('NOPE'); }, /unknown instrument/);
});

test('instrument specs are frozen and validated', function () {
  var cat = instrument.defaultCatalog();
  var eur = cat.get('EURUSD');
  assert.ok(Object.isFrozen(eur));
  assert.throws(function () { instrument.define({ symbol: 'X' }); }, /missing field/);
  assert.throws(function () {
    instrument.define(Object.assign({}, eur, { minLot: 0.001 }));
  }, /minLot .* below lotStep/);
  assert.throws(function () {
    instrument.define(Object.assign({}, eur, { maxSpreadPips: 0.5 }));
  }, /maxSpreadPips below typicalSpreadPips/);
  assert.throws(function () {
    instrument.define(Object.assign({}, eur, { quoteConversion: 'FIXED' }));
  }, /requires a positive fixedQuoteRate/);
});

test('pip value per lot is 10 for a USD-quoted FX pair, price-independent', function () {
  var cat = instrument.defaultCatalog();
  var eur = cat.get('EURUSD');
  assert.equal(money.round(instrument.pipValuePerLot(eur, 1.08), 6), 10);
  assert.equal(money.round(instrument.pipValuePerLot(eur, 1.42), 6), 10);
});

test('pip value per lot for USDJPY divides by the rate — the 150x trap', function () {
  var cat = instrument.defaultCatalog();
  var jpy = cat.get('USDJPY');
  assert.equal(money.round(instrument.pipValuePerLot(jpy, 150), 4), 6.6667);
  assert.equal(money.round(instrument.pipValuePerLot(jpy, 100), 4), 10);
  assert.throws(function () { instrument.pipValuePerLot(jpy, 0); }, /positive price/);
});

test('gold pip value per lot follows its 100-ounce contract', function () {
  var gold = instrument.defaultCatalog().get('XAUUSD');
  assert.equal(money.round(instrument.pipValuePerLot(gold, 2300), 6), 1);
});

test('grossPnl matches hand arithmetic for long, short, DIRECT and INVERSE', function () {
  var cat = instrument.defaultCatalog();
  var eur = cat.get('EURUSD');
  // 50 pips on 0.01 lots at $10/pip/lot = $5.00
  assert.equal(instrument.grossPnl(eur, 'LONG', 1.08, 1.085, 0.01), 5);
  assert.equal(instrument.grossPnl(eur, 'SHORT', 1.08, 1.085, 0.01), -5);
  assert.equal(instrument.grossPnl(eur, 'SHORT', 1.085, 1.08, 0.01), 5);

  var jpy = cat.get('USDJPY');
  // 50 pips (0.50) on 0.01 lots, converted at the exit rate 150.50
  assert.equal(instrument.grossPnl(jpy, 'LONG', 150.0, 150.5, 0.01), money.money(500 / 150.5));
  assert.ok(Math.abs(instrument.grossPnl(jpy, 'LONG', 150.0, 150.5, 0.01) - 3.3223) < 0.001);

  var gold = cat.get('XAUUSD');
  // $10 move on 0.01 lots (1 ounce) = $10 * 1 = $10
  assert.equal(instrument.grossPnl(gold, 'LONG', 2300, 2310, 0.01), 10);

  assert.throws(function () { instrument.grossPnl(eur, 'NEUTRAL', 1, 1.1, 0.01); }, /LONG or SHORT/);
});

test('lotsForRisk rounds down and returns 0 when even the minimum lot is too big', function () {
  var cat = instrument.defaultCatalog();
  var eur = cat.get('EURUSD');
  // $2 risk over a 20-pip stop at $10/pip/lot → exactly 0.01 lots
  assert.equal(instrument.lotsForRisk(eur, 2, 20, 1.08), 0.01);
  // $1.50 risk over the same stop → 0.0075 lots, which is not tradable at all
  assert.equal(instrument.lotsForRisk(eur, 1.5, 20, 1.08), 0);
  // $20 risk over a 10-pip stop → 0.20 lots
  assert.equal(instrument.lotsForRisk(eur, 20, 10, 1.08), 0.2);
  assert.throws(function () { instrument.lotsForRisk(eur, 2, 0, 1.08); }, /must be > 0 pips/);
});

test('riskMoneyForLots is the exact inverse of lotsForRisk at a tradable size', function () {
  var eur = instrument.defaultCatalog().get('EURUSD');
  var lots = instrument.lotsForRisk(eur, 2, 20, 1.08);
  assert.equal(instrument.riskMoneyForLots(eur, lots, 20, 1.08), 2);
});

test('isTradableSize enforces min, max and step', function () {
  var eur = instrument.defaultCatalog().get('EURUSD');
  assert.equal(instrument.isTradableSize(eur, 0.01), true);
  assert.equal(instrument.isTradableSize(eur, 0.005), false);
  assert.equal(instrument.isTradableSize(eur, 0.015), false);
  assert.equal(instrument.isTradableSize(eur, 0), false);
  assert.equal(instrument.isTradableSize(eur, 1000), false);
});
