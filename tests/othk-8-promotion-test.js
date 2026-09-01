// =====================================================
// OTH-K8 — extraction-run promotion suite
// tests/othk-8-promotion-test.js
//
// Covers projects/oth-knowledge/lib/promote.js and the othk-cli.js
// `promote-run` verb: pre-flight verification, referential closure
// (including entity_ids, which store.verify() validates the SHAPE of
// but never checks referentially), a fail-closed conflict check that
// never overwrites an existing canonical record, dependency-ordered
// writes via the existing appendRecord()/putObject() primitives,
// dry-run (zero writes), and post-flight verification.
//
// Entirely offline. Every fixture is a throwaway store built with the
// same lib/extract.js and lib/ingest.js helpers real extraction and
// othk-6 already use. No network, no OmniRoute, no model, no real
// canonical store, and the real proven run at
// /home/ubuntu/othk-extraction-runs/20260831-23a12fd2/ is never touched.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = path.join(__dirname, '..');
const OTHK = path.join(BASE, 'projects', 'oth-knowledge');

const storeLib = require(path.join(OTHK, 'lib/store.js'));
const provenanceLib = require(path.join(OTHK, 'lib/provenance.js'));
const ingestLib = require(path.join(OTHK, 'lib/ingest.js'));
const extract = require(path.join(OTHK, 'lib/extract.js'));
const promote = require(path.join(OTHK, 'lib/promote.js'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
function expectError(fn, code, label) {
  try { fn(); ok(false, label + ' (expected ' + code + ', but it succeeded)'); }
  catch (e) {
    ok(e.code === code, label + (e.code === code ? '' : ' [got code=' + e.code + ' msg=' + e.message + ']'));
  }
}

const CLASSES = provenanceLib.loadSourceClasses();
const CAP = '2026-08-31T00:00:00Z';
const OBS = '2026-01-05T19:08:57.655Z';

function tmpRoot(name) { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk8-' + name + '-')); }
function openStore(name) { return storeLib.openStore(tmpRoot(name)); }

// Builds a run-store-shaped graph mirroring the real proven run:
// source -> artifact -> document -> chunks, N claims each with one
// evidence record pointing at the document, and one derived marker.
// Returns { store, claimIds, documentId, artifactRef }.
function buildRunGraph(store, opts) {
  opts = opts || {};
  const n = opts.claimCount === undefined ? 3 : opts.claimCount;
  const bytes = Buffer.from(JSON.stringify({ schema: 'test-conversation/1.0.0', text: 'synthetic ' + Math.random() }), 'utf8');
  const res = ingestLib.ingestArtifact(store, CLASSES, {
    bytes, filename: 'conv-' + (opts.tag || 'x') + '.json',
    source_class: 'claude', source_collection: 'oth-db',
    captured_at: CAP, observed_at: OBS,
  });
  const claimIds = [];
  for (let i = 0; i < n; i++) {
    const claim = extract.addClaim(store, CLASSES, {
      statement: 'synthetic claim ' + (opts.tag || 'x') + ' #' + i,
      asserted_by: 'omniroute-advisory',
      prov: { source_class: 'claude', source_collection: 'oth-db', source_reference: 'claude/oth-db/' + (opts.tag || 'x'), captured_at: CAP, observed_at: OBS },
      entity_ids: [],
    });
    claimIds.push(claim.id);
    extract.addEvidence(store, { supports_id: claim.id, evidence_ids: [res.document.id], note: 'k8 fixture' });
  }
  extract.addDerived(store, CLASSES, {
    text: 'derived marker', derivation: 'extraction-marker-' + (opts.tag || 'x'),
    derived_from: [res.document.id],
    prov: { source_class: 'claude', source_collection: 'oth-db', source_reference: 'claude/oth-db/' + (opts.tag || 'x'), captured_at: CAP },
  });
  return { store, claimIds, documentId: res.document.id, artifactRef: res.artifact.content_ref, artifactId: res.artifact.id };
}

(function run() {
  console.log('\nA. a valid run promotes successfully, in dependency order');
  {
    const run = buildRunGraph(openStore('a-run'), { tag: 'a' });
    const canonical = openStore('a-canon');
    const before = canonical.stats();

    const res = promote.promoteRun(run.store, canonical);
    ok(res.dry_run === false, 'A1: a real promotion reports dry_run:false');
    ok(res.added === run.store.stats().records, 'A2: every run record was added (' + res.added + ')');
    ok(res.already_promoted === 0, 'A3: nothing was already promoted on a first run');
    ok(canonical.stats().records === before.records + run.store.stats().records, 'A4: canonical record count grew by exactly the run size');

    for (const id of run.claimIds) {
      ok(canonical.getRecord(id) !== null, 'A5: claim ' + id + ' is retrievable from canonical');
    }
    const evidence = canonical.allRecords({ kind: 'evidence' });
    ok(evidence.length === run.claimIds.length, 'A6: every evidence record was promoted');
    ok(evidence.every((e) => run.claimIds.indexOf(e.supports_id) !== -1), 'A7: evidence still supports the promoted claims');

    // Dependency order: a chunk/document/evidence record can only be
    // appended after what it references already exists in canonical, so
    // if promotion succeeded at all, order was necessarily respected —
    // assert it directly by requiring every record's seq to be no less
    // than the seq of everything it references.
    const bySeq = {};
    for (const rec of canonical.allRecords()) {
      bySeq[rec.id] = canonical.getVersions(rec.id).slice(-1)[0].seq;
    }
    let orderOk = true;
    for (const rec of canonical.allRecords()) {
      for (const ref of promote.refsOf(rec)) {
        if (bySeq[ref] !== undefined && bySeq[ref] > bySeq[rec.id]) orderOk = false;
      }
    }
    ok(orderOk, 'A8: every record was written after everything it references');

    const postVerify = canonical.verify();
    ok(postVerify.ok, 'A9: canonical storage passes verify() after promotion');
  }

  console.log('\nB. repeated promotion is idempotent');
  {
    const run = buildRunGraph(openStore('b-run'), { tag: 'b' });
    const canonical = openStore('b-canon');
    const first = promote.promoteRun(run.store, canonical);
    const afterFirst = canonical.stats();

    const second = promote.promoteRun(run.store, canonical);
    ok(second.added === 0, 'B1: a second promotion of the same run adds nothing new');
    ok(second.already_promoted === first.added, 'B2: every previously-added record is now reported as already_promoted');
    ok(canonical.stats().records === afterFirst.records, 'B3: canonical record count is unchanged after the repeat');
    ok(JSON.stringify(canonical.stats()) === JSON.stringify(afterFirst), 'B4: canonical stats() are byte-identical before and after the repeat');
  }

  console.log('\nC. a malformed run is rejected before any canonical write');
  {
    const runRoot = tmpRoot('c-run');
    const run = buildRunGraph(storeLib.openStore(runRoot), { tag: 'c' });
    // Hand-inject a structurally-parseable but semantically invalid
    // envelope directly into the log -- a claim missing its required
    // `asserted_by` field. _load() only checks envelope shape, so this
    // loads fine; model.validateRecord() rejects it inside verify().
    const badEnv = {
      seq: 9999, version: 1, supersedes: null, deleted: false,
      written_at: new Date().toISOString(),
      record: { kind: 'claim', id: 'claim-deliberately-malformed-0000', statement: 'no asserted_by', provenance: { source_class: 'claude', source_reference: 'x', captured_at: CAP } },
    };
    fs.appendFileSync(path.join(runRoot, 'records.jsonl'), JSON.stringify(badEnv) + '\n');
    const corruptRun = storeLib.openStore(runRoot);

    const canonical = openStore('c-canon');
    const before = canonical.stats();
    expectError(() => promote.promoteRun(corruptRun, canonical), 'OTHK_PROMOTE_INVALID_RUN', 'C1: promoteRun refuses a run store that fails verify()');
    ok(JSON.stringify(canonical.stats()) === JSON.stringify(before), 'C2: canonical storage is completely untouched after the refusal');
  }

  console.log('\nD. a dangling reference is rejected — including one store.verify() itself does not catch');
  {
    // entity_ids is validated for SHAPE by model.js but never checked
    // referentially by store.verify() (it only walks document/chunk/
    // relationship/evidence/derived refs). A claim naming an entity that
    // exists nowhere therefore passes the run store's OWN verify() —
    // this is exactly why promote.js extends refsOf() beyond it.
    const runStore = openStore('d-run');
    const res = ingestLib.ingestArtifact(runStore, CLASSES, {
      bytes: Buffer.from('{"note":"fixture content"}'), filename: 'd.json', source_class: 'claude', source_collection: 'oth-db', captured_at: CAP,
    });
    const claim = extract.addClaim(runStore, CLASSES, {
      statement: 'a claim about a ghost entity', asserted_by: 'omniroute-advisory',
      prov: { source_class: 'claude', source_collection: 'oth-db', source_reference: 'x', captured_at: CAP },
      entity_ids: ['entity-does-not-exist-anywhere-00'],
    });
    ok(runStore.verify().ok, 'D1: the run store\'s OWN verify() does not catch the dangling entity_ids reference');

    const canonical = openStore('d-canon');
    const before = canonical.stats();
    expectError(() => promote.promoteRun(runStore, canonical), 'OTHK_PROMOTE_DANGLING_REF', 'D2: promoteRun refuses the dangling entity_ids reference');
    ok(JSON.stringify(canonical.stats()) === JSON.stringify(before), 'D3: canonical storage is untouched after the refusal');

    // A reference that resolves in CANONICAL (not the batch) must be
    // accepted -- promotion is not required to be self-contained.
    const ghost = extract.addEntity(canonical, { entity_type: 'test', name: 'ghost' });
    const ghostId = ghost.id;
    const runStore2 = openStore('d-run2');
    const res2 = ingestLib.ingestArtifact(runStore2, CLASSES, {
      bytes: Buffer.from('{"note":"fixture content"}'), filename: 'd2.json', source_class: 'claude', source_collection: 'oth-db', captured_at: CAP,
    });
    extract.addClaim(runStore2, CLASSES, {
      statement: 'a claim about a real entity', asserted_by: 'omniroute-advisory',
      prov: { source_class: 'claude', source_collection: 'oth-db', source_reference: 'y', captured_at: CAP },
      entity_ids: [ghostId],
    });
    const okRes = promote.promoteRun(runStore2, canonical);
    ok(okRes.added > 0, 'D4: a reference that resolves in canonical (not the batch) is accepted');
  }

  console.log('\nE. a conflicting existing record is rejected; an identical one is skipped');
  {
    // Build two independently-run stores that both mint the SAME record
    // id via a real duplicate extraction path, but with different
    // statement text -- id collision by construction, not by hand-editing.
    const canonical = openStore('e-canon');
    const seedRes = ingestLib.ingestArtifact(canonical, CLASSES, {
      bytes: Buffer.from('{"note":"fixture content"}'), filename: 'e.json', source_class: 'claude', source_collection: 'oth-db', captured_at: CAP,
    });
    const seeded = extract.addClaim(canonical, CLASSES, {
      statement: 'the original statement', asserted_by: 'omniroute-advisory',
      prov: { source_class: 'claude', source_collection: 'oth-db', source_reference: 'e', captured_at: CAP },
      entity_ids: [],
    });
    const before = canonical.stats();

    // CONFLICT: same id (ids.recordId is deterministic from kind+seed —
    // asserted_by + statement), different content is impossible via
    // addClaim itself (statement is part of the seed), so construct the
    // colliding record directly at the store level to isolate exactly
    // the conflict path, independent of id-derivation mechanics.
    const runConflict = openStore('e-run-conflict');
    ingestLib.ingestArtifact(runConflict, CLASSES, {
      bytes: Buffer.from('{"note":"fixture content"}'), filename: 'e.json', source_reference: 'claude/oth-db/e.json', source_class: 'claude', source_collection: 'oth-db', captured_at: CAP,
    });
    runConflict.appendRecord({
      kind: 'claim', id: seeded.id, statement: 'a DIFFERENT statement at the same id', asserted_by: 'omniroute-advisory',
      provenance: seeded.provenance, entity_ids: [],
    });
    expectError(() => promote.promoteRun(runConflict, canonical), 'OTHK_PROMOTE_CONFLICT', 'E1: a same-id, different-content record is refused');
    ok(JSON.stringify(canonical.stats()) === JSON.stringify(before), 'E2: canonical storage is untouched after a conflict refusal');
    ok(JSON.parse(JSON.stringify(canonical.getRecord(seeded.id))).statement === 'the original statement', 'E3: the canonical record was never overwritten');

    // IDENTICAL: same id, byte-identical content (ignoring written_at,
    // which is not part of the record payload at all) -> skipped, not
    // written, not an error.
    const runIdentical = openStore('e-run-identical');
    ingestLib.ingestArtifact(runIdentical, CLASSES, {
      bytes: Buffer.from('{"note":"fixture content"}'), filename: 'e.json', source_reference: 'claude/oth-db/e.json', source_class: 'claude', source_collection: 'oth-db', captured_at: CAP,
    });
    runIdentical.appendRecord(seeded);
    const idRes = promote.promoteRun(runIdentical, canonical);
    ok(idRes.added === 0, 'E4: an identical record at an existing id adds nothing');
    ok(idRes.already_promoted >= 1, 'E5: it is reported as already_promoted, not silently dropped');
    ok(JSON.stringify(canonical.stats()) === JSON.stringify(before), 'E6: canonical storage is unchanged (no duplicate version)');
  }

  console.log('\nF. artifact blob deduplication');
  {
    const bytes = Buffer.from(JSON.stringify({ shared: 'blob', n: Math.random() }), 'utf8');
    const canonical = openStore('f-canon');
    const canonRes = ingestLib.ingestArtifact(canonical, CLASSES, {
      bytes, filename: 'shared.json', source_class: 'claude', source_collection: 'oth-db', captured_at: CAP,
    });
    ok(canonical.hasObject(canonRes.artifact.content_ref), 'F1: the blob already exists in canonical before promotion');

    const runStore = openStore('f-run');
    const runRes = ingestLib.ingestArtifact(runStore, CLASSES, {
      bytes, filename: 'shared.json', source_class: 'claude', source_collection: 'oth-db', captured_at: CAP,
    });
    ok(runRes.artifact.content_ref === canonRes.artifact.content_ref, 'F2: the same bytes hash to the same content ref in both stores');
    extract.addClaim(runStore, CLASSES, {
      statement: 'a claim that reuses the shared artifact', asserted_by: 'omniroute-advisory',
      prov: { source_class: 'claude', source_collection: 'oth-db', source_reference: 'f', captured_at: CAP },
      entity_ids: [],
    });

    const plan = promote.planPromotion(runStore, canonical);
    // The artifact record itself differs by id from the seeded one (different
    // filename -> different id derivation upstream is irrelevant here; what
    // matters is the BLOB is already present, so nothing new is copied).
    ok(plan.blobs.every((ref) => canonical.hasObject(ref)), 'F3: every blob this batch would need is already present in canonical');

    promote.promoteRun(runStore, canonical);
    const objCount1 = fs.readdirSync(path.join(canonical.root, 'objects', 'sha256'), { recursive: true }).filter((f) => !fs.statSync(path.join(canonical.root, 'objects', 'sha256', f)).isDirectory()).length;
    // Re-promote a second independent run with the SAME bytes again.
    const runStore2 = openStore('f-run2');
    ingestLib.ingestArtifact(runStore2, CLASSES, {
      bytes, filename: 'shared.json', source_class: 'claude', source_collection: 'oth-db', captured_at: CAP,
    });
    extract.addClaim(runStore2, CLASSES, {
      statement: 'another claim, same shared bytes', asserted_by: 'omniroute-advisory',
      prov: { source_class: 'claude', source_collection: 'oth-db', source_reference: 'f2', captured_at: CAP },
      entity_ids: [],
    });
    promote.promoteRun(runStore2, canonical);
    const objCount2 = fs.readdirSync(path.join(canonical.root, 'objects', 'sha256'), { recursive: true }).filter((f) => !fs.statSync(path.join(canonical.root, 'objects', 'sha256', f)).isDirectory()).length;
    ok(objCount2 === objCount1, 'F4: no duplicate blob was ever written for equivalent bytes (' + objCount1 + ' -> ' + objCount2 + ')');
  }

  console.log('\nG. dry-run performs zero writes');
  {
    const run = buildRunGraph(openStore('g-run'), { tag: 'g' });
    const canonical = openStore('g-canon');
    const before = canonical.stats();
    const beforeObjDir = fs.existsSync(path.join(canonical.root, 'objects'));

    const res = promote.promoteRun(run.store, canonical, { dryRun: true });
    ok(res.dry_run === true, 'G1: the result reports dry_run:true');
    ok(res.would_add === run.store.stats().records, 'G2: would_add reflects the full run graph');
    ok(res.record_ids.length === res.would_add, 'G3: record_ids lists exactly what would be added');
    ok(JSON.stringify(canonical.stats()) === JSON.stringify(before), 'G4: canonical record count is unchanged after dry-run');
    ok(fs.existsSync(path.join(canonical.root, 'objects')) === beforeObjDir, 'G5: no blob directory was created by dry-run');
    ok(!fs.existsSync(path.join(canonical.root, 'records.jsonl')), 'G6: dry-run never even creates the canonical log file');

    // A dry-run over an already-conflicted batch must analyse and refuse,
    // not write partial results either.
    const seeded = extract.addClaim(canonical, CLASSES, {
      statement: 'seed', asserted_by: 'omniroute-advisory',
      prov: { source_class: 'claude', source_collection: 'oth-db', source_reference: 'g', captured_at: CAP }, entity_ids: [],
    });
    const conflictRun = openStore('g-conflict-run');
    conflictRun.appendRecord({ kind: 'claim', id: seeded.id, statement: 'conflicting', asserted_by: 'omniroute-advisory', provenance: seeded.provenance, entity_ids: [] });
    const afterSeed = canonical.stats();
    expectError(() => promote.promoteRun(conflictRun, canonical, { dryRun: true }), 'OTHK_PROMOTE_CONFLICT', 'G7: dry-run still refuses a conflicting batch');
    ok(JSON.stringify(canonical.stats()) === JSON.stringify(afterSeed), 'G8: dry-run refusal touches nothing');
  }

  console.log('\nH. post-flight verification failure is surfaced distinctly');
  {
    const run = buildRunGraph(openStore('h-run'), { tag: 'h' });
    const canonical = openStore('h-canon');
    const res = promote.promoteRun(run.store, canonical);
    ok(res.added > 0, 'H1: sanity — the happy path promotes normally before this test corrupts anything');

    // Corrupt the just-promoted artifact's bytes directly on disk (bypassing
    // the store entirely, the way an out-of-band disk fault would), then run
    // a second, unrelated promotion against the SAME canonical store. Its own
    // writes are fine; canonical's pre-existing corruption is what post-flight
    // verify() must still catch — proving post-flight checks the WHOLE store,
    // not just what this call just wrote.
    const hash = run.artifactRef.slice(-64);
    const objPath = path.join(canonical.root, 'objects', 'sha256', hash.slice(0, 2), hash);
    fs.writeFileSync(objPath, Buffer.from('corrupted'));

    const run2 = buildRunGraph(openStore('h-run2'), { tag: 'h2' });
    expectError(() => promote.promoteRun(run2.store, canonical), 'OTHK_PROMOTE_POSTFLIGHT_FAILED',
      'H2: pre-existing canonical corruption is surfaced as a postflight failure, not a silent success');
  }

  console.log('\nI. unrelated canonical records remain untouched');
  {
    const canonical = openStore('i-canon');
    const unrelated1 = extract.addEntity(canonical, { entity_type: 'test', name: 'unrelated-one' });
    const unrelatedIngest = ingestLib.ingestArtifact(canonical, CLASSES, {
      bytes: Buffer.from('{"unrelated":true}'), filename: 'unrelated.json', source_class: 'claude', source_collection: 'oth-db', captured_at: CAP,
    });
    const unrelated2 = extract.addClaim(canonical, CLASSES, {
      statement: 'an unrelated pre-existing claim', asserted_by: 'someone-else',
      prov: { source_class: 'claude', source_collection: 'oth-db', source_reference: 'unrelated', captured_at: CAP }, entity_ids: [],
    });
    const before = { entity: JSON.stringify(canonical.getRecord(unrelated1.id)), claim: JSON.stringify(canonical.getRecord(unrelated2.id)), artifact: JSON.stringify(canonical.getRecord(unrelatedIngest.artifact.id)) };

    const run = buildRunGraph(openStore('i-run'), { tag: 'i' });
    promote.promoteRun(run.store, canonical);

    ok(JSON.stringify(canonical.getRecord(unrelated1.id)) === before.entity, 'I1: the unrelated entity is byte-identical after promotion');
    ok(JSON.stringify(canonical.getRecord(unrelated2.id)) === before.claim, 'I2: the unrelated pre-existing claim is byte-identical after promotion');
    ok(JSON.stringify(canonical.getRecord(unrelatedIngest.artifact.id)) === before.artifact, 'I3: the unrelated artifact record is byte-identical after promotion');
    ok(canonical.getVersions(unrelated1.id).length === 1, 'I4: the unrelated entity has exactly one version — never touched, let alone superseded');
  }

  console.log('');
  console.log('othk-8: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
