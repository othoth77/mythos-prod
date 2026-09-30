'use strict';
// =====================================================
// MYTHOS TRADING AGENT — record store tests
// projects/mythos-trading-agent/tests/store-test.js
//
// Two properties carry the audit and reproducibility claims, and both are
// tested here rather than asserted in a document:
//
//   * a stored row cannot be changed or removed, and a sealed run cannot grow;
//   * two identical runs produce the same digest, and any difference in the
//     records changes it.
//
// §3 also checks the isolation rule this repository learned the hard way: a
// store constructed without a directory must never touch the filesystem.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var fs = require('fs');
var os = require('os');

var SRC = path.join(__dirname, '..', 'src');
var store = require(path.join(SRC, 'db', 'store'));
var dbSchema = require(path.join(SRC, 'db', 'schema'));

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-trading-store-' + tag + '-'));
}

function candidate(over) {
  var base = {
    candidateId: 'cand-1', ts: 1700000000000, symbol: 'EURUSD', strategyId: 'trend-following',
    timeframe: 'M15', direction: 'LONG', entry: 1.085, stopLoss: 1.0835, takeProfit: 1.088,
    rewardRisk: 2, regime: 'TREND', spreadPips: 1.2, estimatedCostMoney: 0.14,
    expectedNetMoney: 0.42
  };
  Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
  return base;
}

// --- 1. required fields ----------------------------------------------------
test('every table in the schema exists on a new store', function () {
  var s = store.create({ runId: 'r1' });
  assert.deepEqual(s.tableNames(), dbSchema.TABLE_NAMES);
  assert.equal(s.rowCount(), 0);
  assert.deepEqual(s.counts(), {}, 'counts list only non-empty tables');
  assert.throws(function () { s.table('not_a_table'); }, /unknown table/);
});

test('a record missing a required field is refused where it was created', function () {
  var s = store.create({ runId: 'r1' });
  var c = candidate();
  delete c.expectedNetMoney;
  delete c.regime;
  assert.throws(function () { s.table('candidates').insert(c); },
    /missing required field\(s\): regime, expectedNetMoney/);
  assert.equal(s.table('candidates').count(), 0);
});

test('a non-object record is refused', function () {
  var s = store.create({ runId: 'r1' });
  assert.throws(function () { s.table('candidates').insert([candidate()]); }, /requires an object record, got array/);
  assert.throws(function () { s.table('candidates').insert('nope'); }, /requires an object record, got string/);
});

test('every table documents the §17 question it answers', function () {
  dbSchema.TABLE_NAMES.forEach(function (n) {
    var def = dbSchema.definition(n);
    assert.ok(def.answers && def.answers.length > 10, n + ' has no documented purpose');
    assert.ok(Array.isArray(def.required) && def.required.length > 0, n + ' declares no required fields');
    assert.ok(Array.isArray(def.indexed), n + ' declares no index list');
  });
});

// --- 2. append-only, frozen rows ------------------------------------------
test('rows are frozen and carry a monotonic sequence number', function () {
  var s = store.create({ runId: 'r1' });
  var a = s.table('candidates').insert(candidate({ candidateId: 'c1' }));
  var b = s.table('candidates').insert(candidate({ candidateId: 'c2' }));
  assert.equal(a._seq, 1);
  assert.equal(b._seq, 2);
  assert.equal(a._table, 'candidates');
  assert.ok(Object.isFrozen(a));
  assert.throws(function () { 'use strict'; a.entry = 9; }, TypeError);
  assert.equal(a.entry, 1.085);
});

test('the sequence is global across tables, so causal order is preserved', function () {
  var s = store.create({ runId: 'r1' });
  var c = s.table('candidates').insert(candidate());
  var j = s.table('jev_decisions').insert({
    candidateId: 'cand-1', ts: 1, score: 81, confidence: 0.6, decision: 'ENTER',
    reasonCodes: [], riskFlags: [], model: 'heuristic-v1', threshold: 70
  });
  assert.ok(j._seq > c._seq, 'the Jev decision must be provably after the candidate');
});

test('there is no update or delete on a table handle', function () {
  var t = store.create({ runId: 'r1' }).table('candidates');
  assert.equal(t.update, undefined);
  assert.equal(t.delete, undefined);
  assert.equal(t.remove, undefined);
  assert.equal(typeof t.insert, 'function');
});

test('all() returns a copy, so a caller cannot splice the audit trail', function () {
  var s = store.create({ runId: 'r1' });
  s.table('candidates').insert(candidate());
  var rows = s.table('candidates').all();
  rows.length = 0;
  assert.equal(s.table('candidates').count(), 1);
});

// --- 3. indexes and queries ----------------------------------------------
test('indexed lookups and linear scans agree', function () {
  var s = store.create({ runId: 'r1' });
  var t = s.table('candidates');
  t.insert(candidate({ candidateId: 'c1', symbol: 'EURUSD', regime: 'TREND' }));
  t.insert(candidate({ candidateId: 'c2', symbol: 'XAUUSD', regime: 'RANGE' }));
  t.insert(candidate({ candidateId: 'c3', symbol: 'EURUSD', regime: 'RANGE' }));

  assert.equal(t.isIndexed('symbol'), true);
  assert.equal(t.isIndexed('entry'), false);
  assert.deepEqual(t.by('symbol', 'EURUSD').map(function (r) { return r.candidateId; }), ['c1', 'c3']);
  assert.deepEqual(t.by('regime', 'RANGE').map(function (r) { return r.candidateId; }), ['c2', 'c3']);
  // Non-indexed field falls back to a scan and must give the same answer.
  assert.deepEqual(t.by('timeframe', 'M15').length, 3);
  assert.equal(t.first('symbol', 'XAUUSD').candidateId, 'c2');
  assert.equal(t.first('symbol', 'NZDUSD'), null);
  assert.equal(t.last().candidateId, 'c3');
  assert.equal(t.find(function (r) { return r.regime === 'TREND'; }).length, 1);
});

// --- 4. digest and reproducibility ---------------------------------------
test('two identical runs produce the same digest', function () {
  function build(runId) {
    var s = store.create({ runId: runId });
    s.table('candidates').insert(candidate({ candidateId: 'c1' }));
    s.table('candidates').insert(candidate({ candidateId: 'c2', direction: 'SHORT' }));
    return s;
  }
  assert.equal(build('run-a').digest(), build('run-a').digest());
  assert.equal(build('run-a').digest(), build('run-b').digest(),
    'the digest covers records, not the run label');
});

test('any difference in the records changes the digest', function () {
  var a = store.create({ runId: 'r' });
  a.table('candidates').insert(candidate({ takeProfit: 1.088 }));
  var b = store.create({ runId: 'r' });
  b.table('candidates').insert(candidate({ takeProfit: 1.0881 }));
  assert.notEqual(a.digest(), b.digest());

  var c = store.create({ runId: 'r' });
  c.table('candidates').insert(candidate({ candidateId: 'c2' }));
  c.table('candidates').insert(candidate({ candidateId: 'c1' }));
  var d = store.create({ runId: 'r' });
  d.table('candidates').insert(candidate({ candidateId: 'c1' }));
  d.table('candidates').insert(candidate({ candidateId: 'c2' }));
  assert.notEqual(c.digest(), d.digest(), 'insertion order is part of the evidence');
});

// --- 5. sealing ----------------------------------------------------------
test('a sealed store refuses further inserts', function () {
  var s = store.create({ runId: 'r1', now: function () { return 42; } });
  s.table('candidates').insert(candidate());
  var m = s.seal();
  assert.equal(m.sealed, true);
  assert.equal(m.sealedAt, 42);
  assert.equal(m.rows, 1);
  assert.deepEqual(m.counts, { candidates: 1 });
  assert.equal(s.isSealed(), true);
  assert.throws(function () { s.table('candidates').insert(candidate({ candidateId: 'c2' })); },
    /is sealed; cannot insert into candidates/);
  assert.equal(s.table('candidates').count(), 1);
});

test('sealing twice is idempotent', function () {
  var s = store.create({ runId: 'r1', now: function () { return 7; } });
  var m1 = s.seal();
  var m2 = s.seal();
  assert.deepEqual(m1, m2);
});

// --- 6. filesystem isolation --------------------------------------------
test('a store without a directory never touches the filesystem', function () {
  var s = store.create({ runId: 'r1' });
  s.table('candidates').insert(candidate());
  assert.equal(s.dir, null);
  assert.throws(function () { s.flush(); }, /needs a store directory/);
  // Sealing without a directory must also be a pure in-memory operation.
  var m = s.seal();
  assert.equal(m.sealed, true);
});

test('flush writes one JSONL file per non-empty table plus a manifest', function () {
  var dir = tmpDir('flush');
  var s = store.create({ runId: 'run-1', dir: dir, now: function () { return 1000; }, meta: { configHash: 'abc' } });
  s.table('candidates').insert(candidate());
  s.table('system_events').insert({ ts: 1, kind: 'START', severity: 'INFO', message: 'run started' });
  var res = s.seal();

  var files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['candidates.jsonl', 'manifest.json', 'system_events.jsonl'],
    'empty tables must not produce empty files');
  var manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.runId, 'run-1');
  assert.equal(manifest.sealed, true);
  assert.equal(manifest.digest, res.digest);
  assert.deepEqual(manifest.meta, { configHash: 'abc' });

  var reread = store.readDir(dir);
  assert.equal(reread.manifest.digest, s.digest());
  assert.equal(reread.tables.candidates.length, 1);
  assert.equal(reread.tables.candidates[0].candidateId, 'cand-1');
  assert.equal(reread.tables.candidates[0]._seq, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('flushed files are byte-identical for two identical runs', function () {
  function run(dir) {
    var s = store.create({ runId: 'same', dir: dir, now: function () { return 5; } });
    s.table('candidates').insert(candidate({ candidateId: 'c1' }));
    s.table('trades').insert({
      tradeId: 't1', positionId: 'p1', candidateId: 'c1', symbol: 'EURUSD',
      strategyId: 'trend-following', direction: 'LONG', entryTs: 1, exitTs: 2,
      entryPrice: 1.085, exitPrice: 1.088, lots: 0.01, grossPnl: 3, costsMoney: 0.14,
      netPnl: 2.86, outcome: 'WIN', exitReason: 'TAKE_PROFIT', regime: 'TREND',
      jevScore: 81, recoveryLevel: 0, barsHeld: 12, equityAfter: 102.86
    });
    s.seal();
  }
  var d1 = tmpDir('rep1');
  var d2 = tmpDir('rep2');
  run(d1); run(d2);
  ['candidates.jsonl', 'trades.jsonl', 'manifest.json'].forEach(function (f) {
    assert.equal(fs.readFileSync(path.join(d1, f), 'utf8'), fs.readFileSync(path.join(d2, f), 'utf8'), f + ' differed');
  });
  fs.rmSync(d1, { recursive: true, force: true });
  fs.rmSync(d2, { recursive: true, force: true });
});

test('readDir refuses a directory that is not a Mythos store', function () {
  var dir = tmpDir('bogus');
  assert.throws(function () { store.readDir(dir); }, /not a Mythos trading store/);
  fs.rmSync(dir, { recursive: true, force: true });
});
