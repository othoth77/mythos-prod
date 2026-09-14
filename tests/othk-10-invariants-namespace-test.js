// =====================================================
// OTHKM strengthening — Phase 1 (core invariants) + Phase 2 (namespaces)
// tests/othk-10-invariants-namespace-test.js
//
// Phase 1 pins the immutable OTHKM guarantees so no later phase can
// weaken them: append-only truth, mandatory provenance, claims != facts,
// supersession-not-overwrite, tombstones-not-deletion, and that
// AI-generated content cannot directly overwrite durable truth.
// Phase 2 verifies the namespace model (global/personal/projects) and
// strict namespace isolation in retrieval. All fixtures synthetic.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');

const ids = require(path.join(BASE, 'lib/ids.js'));
const model = require(path.join(BASE, 'lib/model.js'));
const storeLib = require(path.join(BASE, 'lib/store.js'));
const searchLib = require(path.join(BASE, 'lib/search.js'));
const ns = require(path.join(BASE, 'lib/namespace.js'));

let passed = 0, failed = 0;
function ok(v, label) { if (v) { passed++; console.log('  PASS ' + label); } else { failed++; console.log('  FAIL ' + label); } }
function expectError(fn, re, label) {
  try { fn(); ok(false, label + ' (expected error)'); }
  catch (e) { ok(re.test(e.message), label + (re.test(e.message) ? '' : ' [got: ' + e.message + ']')); }
}
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-test-')); }

const CAP = '2026-08-19T12:00:00Z';
function prov(extra) {
  return Object.assign({ source_class: 'manual', source_collection: 'c1', source_reference: 'manual/c1/x', captured_at: CAP }, extra || {});
}
function claim(seed, statement, extra) {
  return Object.assign({ kind: 'claim', id: ids.recordId('claim', seed), statement, asserted_by: 'tester', provenance: prov() }, extra || {});
}
function fact(seed, statement, extra) {
  return Object.assign({ kind: 'fact', id: ids.recordId('fact', seed), statement, confidence: 'HIGH', provenance: prov() }, extra || {});
}

// ---------------- Phase 1: immutable core invariants ----------------
(function invariants() {
  const s = storeLib.openStore(tmpRoot());

  // append-only: a differing re-append without allowNewVersion is refused.
  const c = claim('inv-1', 'the sky is blue');
  s.appendRecord(c);
  expectError(() => s.appendRecord(claim('inv-1', 'the sky is green')), /OTHK_STORE_VERSION/,
    'P1: cannot silently overwrite durable truth (append-only enforced)');

  // supersession keeps prior version readable in history (not overwritten).
  s.appendRecord(claim('inv-1', 'the sky is green'), { allowNewVersion: true });
  const versions = s.getVersions(ids.recordId('claim', 'inv-1'));
  ok(versions.length === 2, 'P1: supersession preserves prior version (history has 2)');
  ok(versions[0].record.statement === 'the sky is blue', 'P1: original evidence never destroyed');

  // tombstone is a version, not a physical deletion.
  s.tombstone(ids.recordId('claim', 'inv-1'), 'retracted');
  ok(s.getRecord(ids.recordId('claim', 'inv-1')) === null, 'P1: tombstoned record reads as absent');
  ok(s.getVersions(ids.recordId('claim', 'inv-1')).length === 3, 'P1: tombstone kept as history (no data loss)');

  // mandatory provenance on knowledge-bearing kinds.
  expectError(() => model.validateRecord({ kind: 'fact', id: ids.recordId('fact', 'x'), statement: 'y', confidence: 'HIGH' }),
    /OTHK_MODEL_PROVENANCE/, 'P1: provenance is mandatory (fact without provenance refused)');

  // claims != facts: a claim carries asserted_by (an assertion), a fact carries confidence.
  ok(model.validateRecord(claim('inv-2', 'asserted thing')).asserted_by === 'tester', 'P1: claim is an assertion (asserted_by)');
  expectError(() => model.validateRecord({ kind: 'fact', id: ids.recordId('fact', 'z'), statement: 'z', provenance: prov() }),
    /OTHK_MODEL_FIELD/, 'P1: a fact requires confidence — an LLM assertion is a claim, never a bare fact');

  // AI-generated content cannot become durable truth by overwrite: a
  // model-output source is just another provenance; it still cannot
  // overwrite an existing id without an explicit new version, and the
  // trust tier of model-output stays lowest (verified in othk-3-trust).
  const ai = claim('inv-3', 'model asserted X', { provenance: prov({ source_class: 'manual' }) });
  s.appendRecord(ai);
  expectError(() => s.appendRecord(claim('inv-3', 'model asserted NOT X')), /OTHK_STORE_VERSION/,
    'P1: AI content cannot silently overwrite an existing record');
})();

// ---------------- Phase 2: namespaces ----------------
(function namespaces() {
  // grammar
  ok(ns.isValidNamespace('global') && ns.isValidNamespace('personal'), 'P2: global/personal valid');
  ok(ns.isValidNamespace('projects/mythos-prod'), 'P2: projects/<slug> valid');
  ok(!ns.isValidNamespace('projects/'), 'P2: empty project slug invalid');
  ok(!ns.isValidNamespace('projects/UPPER'), 'P2: uppercase slug invalid');
  ok(!ns.isValidNamespace('random'), 'P2: arbitrary namespace invalid');
  ok(ns.namespaceOf({}) === 'global', 'P2: legacy record (no namespace) reads as global');
  ok(ns.projectNamespace('agri-bee') === 'projects/agri-bee', 'P2: projectNamespace helper');

  // model accepts optional namespace and rejects a bad one.
  ok(model.validateRecord(fact('ns-1', 'x', { namespace: 'projects/idauto' })).namespace === 'projects/idauto', 'P2: valid namespace accepted on record');
  expectError(() => model.validateRecord(fact('ns-2', 'x', { namespace: 'nope' })), /OTHK_MODEL_FIELD/, 'P2: invalid namespace refused at write time');

  // strict isolation in retrieval.
  const s = storeLib.openStore(tmpRoot());
  s.appendRecord(fact('g', 'global apple pricing rule', { namespace: 'global' }));
  s.appendRecord(fact('p', 'owner prefers apple over pear', { namespace: 'personal' }));
  s.appendRecord(fact('a', 'idauto vehicle apple lookup rule', { namespace: 'projects/idauto' }));
  s.appendRecord(fact('m', 'mythos apple deployment note', { namespace: 'projects/mythos-prod' }));
  const idx = searchLib.buildIndex(s);

  const proj = searchLib.search(idx, 'apple', { mode: 'lexical', filters: { namespace: 'projects/idauto' } });
  ok(proj.length === 1 && proj[0].id === ids.recordId('fact', 'a'), 'P2: project query returns only that project');
  const pers = searchLib.search(idx, 'apple', { mode: 'lexical', filters: { namespace: 'personal' } });
  ok(pers.length === 1 && pers[0].id === ids.recordId('fact', 'p'), 'P2: personal query isolated');
  const glob = searchLib.search(idx, 'apple', { mode: 'lexical', filters: { namespace: 'global' } });
  ok(glob.length === 1 && glob[0].id === ids.recordId('fact', 'g'), 'P2: global query does not leak project/personal');
  const all = searchLib.search(idx, 'apple', { mode: 'lexical' });
  ok(all.length === 4, 'P2: unfiltered query still sees all (no filter = no isolation)');
  const two = searchLib.search(idx, 'apple', { mode: 'lexical', filters: { namespaces: ['global', 'projects/idauto'] } });
  ok(two.length === 2, 'P2: multi-namespace filter (global + one project)');
})();

console.log('othk-10: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
