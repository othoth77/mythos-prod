'use strict';
// =====================================================
// MYTHOS TRADING AGENT — configuration tests
// projects/mythos-trading-agent/tests/config-test.js
//
// The configuration surface is where every safety limit is set, so the tests
// that matter most here are the REFUSALS: an unknown key, an out-of-range
// limit, and above all a config that tries to select LIVE mode.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var config = require(path.join(SRC, 'config'));
var schema = require(path.join(SRC, 'config', 'schema'));

test('the shipped defaults are valid and load', function () {
  var cfg = config.load();
  assert.equal(cfg.mode, 'BACKTEST', 'the default mode must be BACKTEST');
  assert.equal(cfg.account.initialCapital, 100, 'owner approval §5: initial capital $100');
  assert.equal(cfg.risk.maxOpenTrades, 1);
  assert.equal(cfg.recovery.enabled, false, 'recovery x3 must be opt-in, off by default');
  assert.equal(cfg.recovery.multiplier, 3);
  assert.ok(cfg.recovery.maxRecoveryLevel >= 1);
  assert.equal(cfg.universe.length, 7);
});

test('a config file can never select LIVE mode', function () {
  assert.throws(function () { config.load({ mode: 'LIVE' }); },
    /mode must be one of \[BACKTEST, PAPER\]/,
    'LIVE must be unreachable by editing configuration');
  assert.doesNotThrow(function () { config.load({ mode: 'PAPER' }); });
});

test('unknown configuration keys are rejected, not ignored', function () {
  assert.throws(function () { config.load({ risk: { maxDrawdownPCT: 10 } }); },
    /not a known configuration key/,
    'a misspelt limit must fail loudly rather than silently not exist');
  assert.throws(function () { config.load({ totallyNew: 1 }); }, /not a known configuration key/);
});

test('every numeric limit has an enforced range', function () {
  assert.throws(function () { config.load({ risk: { maxDrawdownPct: 0 } }); }, /must be >= 0.5/);
  assert.throws(function () { config.load({ risk: { maxDrawdownPct: 99 } }); }, /must be <= 90/);
  assert.throws(function () { config.load({ risk: { maxAccountRiskPerTradePct: 200 } }); }, /must be <= 25/);
  assert.throws(function () { config.load({ risk: { maxConsecutiveLosses: 2.5 } }); }, /must be an integer/);
  assert.throws(function () { config.load({ account: { initialCapital: 0 } }); }, /must be >= 1/);
});

test('maxOpenTrades is pinned to 1 by the schema itself', function () {
  assert.throws(function () { config.load({ risk: { maxOpenTrades: 2 } }); },
    /must be <= 1/,
    'mission §7: only one trade may be open globally — not a tunable');
});

test('recovery multiplier and level are bounded', function () {
  assert.throws(function () { config.load({ recovery: { multiplier: 10 } }); }, /must be <= 5/);
  assert.throws(function () { config.load({ recovery: { maxRecoveryLevel: 20 } }); }, /must be <= 8/);
  assert.throws(function () { config.load({ recovery: { enabled: true, maxRecoveryLevel: 0 } }); },
    /either disable recovery or allow at least one level/);
});

test('cross-field invariants are checked', function () {
  assert.throws(function () { config.load({ risk: { minStopPips: 600 } }); },
    /minStopPips .* must be below maxStopPips/);
  assert.throws(function () { config.load({ risk: { maxDailyLossPct: 30 } }); },
    /exceeds maxDrawdownPct/);
  assert.throws(function () { config.load({ backtest: { baseTimeframe: 'H4', higherTimeframe: 'M15' } }); },
    /must be >= baseTimeframe/);
  assert.throws(function () { config.load({ cost: { spreadModel: 'fixed' } }); },
    /required when cost.spreadModel is "fixed"/);
  assert.doesNotThrow(function () { config.load({ cost: { spreadModel: 'fixed', fixedSpreadPips: 1.5 } }); });
});

test('the universe must be known to the instrument catalog', function () {
  assert.throws(function () { config.load({ universe: ['DOGEUSD'] }); },
    /not in the instrument catalog/);
  assert.throws(function () { config.load({ universe: ['EURUSD', 'EURUSD'] }); }, /duplicate symbol/);
  assert.throws(function () { config.load({ schedule: { perAsset: { NOPE: { enabled: false } } } }); },
    /unknown instrument NOPE/);
});

test('arrays replace on merge instead of concatenating', function () {
  var cfg = config.load({ universe: ['EURUSD'] });
  assert.deepEqual(cfg.universe, ['EURUSD']);
  var cfg2 = config.load({ schedule: { blockedWeekdaysUtc: [0, 6] } });
  assert.deepEqual(cfg2.schedule.blockedWeekdaysUtc, [0, 6]);
});

test('objects merge deeply, leaving untouched siblings at their defaults', function () {
  var cfg = config.load({ risk: { maxDrawdownPct: 10 } });
  assert.equal(cfg.risk.maxDrawdownPct, 10);
  assert.equal(cfg.risk.maxConsecutiveLosses, 5, 'sibling defaults survive a partial override');
});

test('a loaded config is deep frozen so nothing can rewrite a limit mid-run', function () {
  var cfg = config.load();
  assert.throws(function () { 'use strict'; cfg.risk.maxDrawdownPct = 99; }, TypeError);
  assert.throws(function () { 'use strict'; cfg.universe.push('BTCUSD'); }, TypeError);
  assert.equal(cfg.risk.maxDrawdownPct, 20);
});

test('the fingerprint changes with meaning and not with key order', function () {
  var a = config.load({ risk: { maxDrawdownPct: 10 }, jev: { scoreThreshold: 80 } });
  var b = config.load({ jev: { scoreThreshold: 80 }, risk: { maxDrawdownPct: 10 } });
  assert.equal(a.fingerprint.hash, b.fingerprint.hash, 'override key order is not meaning');
  var c = config.load({ risk: { maxDrawdownPct: 11 }, jev: { scoreThreshold: 80 } });
  assert.notEqual(a.fingerprint.hash, c.fingerprint.hash);
  assert.equal(a.fingerprint.shortHash.length, 12);
});

test('the catalog helper is present but excluded from the fingerprint payload', function () {
  var cfg = config.load();
  assert.equal(typeof cfg.instrument, 'function');
  assert.equal(cfg.instrument('EURUSD').symbol, 'EURUSD');
  var serialised = config.serialise(cfg);
  assert.equal(serialised.catalog, undefined);
  assert.equal(serialised.instrument, undefined);
  assert.equal(serialised.fingerprint.hash, cfg.fingerprint.hash);
});

test('instruments whose minimum lot exceeds the position cap are reported', function () {
  var cfg = config.load({ risk: { maxPositionSizeLots: 0.01 } });
  assert.deepEqual(cfg.unreachableInstruments, [], '0.01 is exactly the minimum, so nothing is unreachable');
  // Every instrument in the shipped catalog has minLot 0.01, so a cap below it
  // is impossible to express (the schema floor is 0.01) — assert that floor.
  assert.throws(function () { config.load({ risk: { maxPositionSizeLots: 0.005 } }); }, /must be >= 0.01/);
});

test('schema.check reports every problem at once rather than the first', function () {
  var res = schema.check({
    schemaVersion: 1, mode: 'LIVE', label: 'x',
    account: { currency: 'USD', initialCapital: -5 },
    universe: [], risk: {}, recovery: {}, jev: {}, cost: {}, schedule: {}, backtest: {}, observability: {}
  });
  assert.equal(res.ok, false);
  assert.ok(res.problems.length > 5, 'got ' + res.problems.length + ' problems');
  var paths = res.problems.map(function (p) { return p.path; });
  assert.ok(paths.indexOf('mode') !== -1);
  assert.ok(paths.indexOf('account.initialCapital') !== -1);
  assert.ok(paths.indexOf('universe') !== -1);
});

test('loadFile surfaces a readable error for a missing or broken file', function () {
  assert.throws(function () { config.loadFile('/nonexistent/mythos-trading.json'); },
    /cannot read config file/);
});
