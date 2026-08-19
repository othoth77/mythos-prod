// =====================================================
// OTH-K1 — knowledge core suite
// tests/othk-0-knowledge-core-test.js
//
// Offline suite over the file-backed store in a temp directory.
// Covers: ids, model validation, store versioning/tombstones/integrity,
// source classes + policy, ingestion pipeline, dedup, secret gate,
// data-quality refusals, extraction traceability, conflicts, seeds.
// All fixture values are synthetic.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');

const ids = require(path.join(BASE, 'lib/ids.js'));
const model = require(path.join(BASE, 'lib/model.js'));
const storeLib = require(path.join(BASE, 'lib/store.js'));
const provenance = require(path.join(BASE, 'lib/provenance.js'));
const normalize = require(path.join(BASE, 'lib/normalize.js'));
const ingest = require(path.join(BASE, 'lib/ingest.js'));
const extract = require(path.join(BASE, 'lib/extract.js'));
const conflict = require(path.join(BASE, 'lib/conflict.js'));
const seedLib = require(path.join(BASE, 'lib/seed.js'));
const api = require(path.join(BASE, 'lib/api.js'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
function expectError(fn, re, label) {
  try { fn(); ok(false, label + ' (expected error, but it succeeded)'); }
  catch (e) { ok(re.test(e.message), label + (re.test(e.message) ? '' : ' [got: ' + e.message + ']')); }
}
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-test-')); }

const CAP = '2026-08-19T12:00:00Z';
const CLASSES = provenance.loadSourceClasses();
function prov(extra) {
  return Object.assign({ source_class: 'manual', source_collection: 'c1', source_reference: 'manual/c1/x', captured_at: CAP }, extra || {});
}

// ---------- ids ----------
console.log('§1 ids');
{
  const b = Buffer.from('hello othk', 'utf8');
  ok(ids.contentRef(b) === ids.contentRef(Buffer.from('hello othk')), 'contentRef deterministic');
  ok(ids.isContentRef(ids.contentRef(b)), 'contentRef shape valid');
  ok(!ids.isContentRef('othk://sha256/xyz'), 'malformed ref rejected');
  ok(ids.recordId('fact', 'a') === ids.recordId('fact', 'a'), 'recordId deterministic');
  ok(ids.recordId('fact', 'a') !== ids.recordId('claim', 'a'), 'recordId kind-scoped');
  expectError(() => ids.hashFromRef('nope'), /OTHK_ID_INPUT/, 'hashFromRef refuses garbage');
}

// ---------- model ----------
console.log('§2 model validation');
{
  ok(model.validateRecord({ kind: 'entity', id: ids.recordId('entity', 'host/x'), entity_type: 'host', name: 'x' }), 'valid entity accepted');
  expectError(() => model.validateRecord({ kind: 'wisdom', id: 'wisdom-1' }), /OTHK_MODEL_KIND/, 'unknown kind refused');
  expectError(() => model.validateRecord({ kind: 'fact', id: 'claim-123', statement: 's', confidence: 'HIGH', provenance: prov() }), /OTHK_MODEL_RECORD/, 'id prefix must match kind');
  expectError(() => model.validateRecord({ kind: 'fact', id: ids.recordId('fact', 's'), statement: 's', confidence: 'HIGH' }), /OTHK_MODEL_PROVENANCE/, 'fact without provenance refused');
  expectError(() => model.validateRecord({ kind: 'fact', id: ids.recordId('fact', 's'), statement: 's', confidence: 'SURE', provenance: prov() }), /OTHK_MODEL_FIELD/, 'invalid confidence refused');
  expectError(() => model.validateRecord({ kind: 'observation', id: ids.recordId('observation', 's'), statement: 's', observed_at: 'not-a-date', provenance: prov() }), /OTHK_MODEL_FIELD/, 'invalid observed_at refused');
  expectError(() => model.validateRecord({ kind: 'observation', id: ids.recordId('observation', 's'), statement: 's', observed_at: '2150-01-01T00:00:00Z', provenance: prov() }), /OTHK_MODEL_FIELD/, 'out-of-range timestamp refused');
  expectError(() => model.validateRecord({ kind: 'derived', id: ids.recordId('derived', 'x'), text: 't', derivation: 'summary', derived_from: [], provenance: prov() }), /never an original fact/, 'derived without sources refused');
  expectError(() => model.validateRecord({ kind: 'relationship', id: ids.recordId('relationship', 'x'), rel_type: 'conflicts_with', from_id: 'a', to_id: 'b' }), /resolution_state/, 'conflict without resolution_state refused');
  expectError(() => model.validateRecord({ kind: 'entity', id: ids.recordId('entity', 'h'), entity_type: 'host', name: 'a\u0000b' }), /contains NUL/, 'NUL in field refused');
}

// ---------- store ----------
console.log('§3 store');
{
  const root = tmpRoot();
  const s = storeLib.openStore(root);
  const put1 = s.putObject(Buffer.from('bytes-1'));
  const put2 = s.putObject(Buffer.from('bytes-1'));
  ok(put1.ref === put2.ref && put2.deduplicated === true, 'object dedup by content address');
  ok(s.getObject(put1.ref).toString() === 'bytes-1', 'object round-trip');

  const fact = { kind: 'fact', id: ids.recordId('fact', 'manual/f1'), statement: 'f1', confidence: 'HIGH', provenance: prov() };
  const r1 = s.appendRecord(fact);
  ok(r1.created === true && r1.envelope.version === 1, 'first append version 1');
  const r2 = s.appendRecord(JSON.parse(JSON.stringify(fact)));
  ok(r2.created === false && r2.deduplicated === true, 'identical re-append is idempotent no-op');
  const factV2 = Object.assign({}, fact, { statement: 'f1 corrected' });
  expectError(() => s.appendRecord(factV2), /OTHK_STORE_VERSION/, 'silent overwrite refused');
  const r3 = s.appendRecord(factV2, { allowNewVersion: true });
  ok(r3.envelope.version === 2 && r3.envelope.supersedes === r1.envelope.seq, 'explicit supersession versions correctly');
  ok(s.getRecord(fact.id).statement === 'f1 corrected', 'latest version served');
  ok(s.getVersions(fact.id).length === 2, 'history preserved');

  s.tombstone(fact.id, 'test');
  ok(s.getRecord(fact.id) === null, 'tombstoned record no longer live');
  ok(s.getVersions(fact.id).length === 3, 'tombstone kept as version, nothing rewritten');

  // persistence across reopen
  const s2 = storeLib.openStore(root);
  ok(s2.getVersions(fact.id).length === 3, 'reopen replays full history');

  // integrity: orphan reference detection
  const chunk = { kind: 'chunk', id: ids.recordId('chunk', 'doc-x#0'), document_id: 'document-ffffffffffffffff', text: 't', position: 0, provenance: prov() };
  s2.appendRecord(chunk);
  const v = s2.verify();
  ok(!v.ok && v.problems.some((p) => /orphan reference/.test(p.problem)), 'verify catches orphan reference');

  // corrupt object detection
  const root2 = tmpRoot();
  const s3 = storeLib.openStore(root2);
  const put3 = s3.putObject(Buffer.from('artifact bytes'));
  const art = { kind: 'artifact', id: ids.recordId('artifact', put3.ref), content_ref: put3.ref, filename: 'a.txt', byte_size: 14, provenance: prov() };
  s3.appendRecord(art);
  const objPath = path.join(root2, 'objects', 'sha256', ids.hashFromRef(put3.ref).slice(0, 2), ids.hashFromRef(put3.ref));
  fs.writeFileSync(objPath, 'tampered');
  expectError(() => s3.getObject(put3.ref), /OTHK_STORE_CORRUPT/, 'tampered object refused on read');
  ok(s3.verify().problems.some((p) => /hash mismatch|OTHK_STORE_CORRUPT/.test(p.problem)) || !s3.verify().ok, 'verify flags tampered object');
}

// ---------- export / import ----------
console.log('§4 export / import round-trip');
{
  const s = storeLib.openStore(tmpRoot());
  s.appendRecord({ kind: 'fact', id: ids.recordId('fact', 'manual/e1'), statement: 'export me', confidence: 'HIGH', provenance: prov() });
  s.appendRecord({ kind: 'entity', id: ids.recordId('entity', 'host/e'), entity_type: 'host', name: 'e' });
  const exp = s.exportRecords({});
  ok(exp.count === 2, 'export counts latest live records');
  const s2 = storeLib.openStore(tmpRoot());
  const imp = s2.importRecords(exp.jsonl);
  ok(imp.imported + imp.skipped === 2 && s2.allRecords().length === 2, 'import restores records');
  ok(s2.exportRecords({}).jsonl.split('\n').filter(Boolean).length === 2, 'round-trip lossless at record level');
  const expClass = s.exportRecords({ source_class: 'manual' });
  ok(expClass.count === 1, 'export filters by source class');
}

// ---------- source classes / policy ----------
console.log('§5 source classes and policy');
{
  ok(CLASSES['google-takeout'] && CLASSES['google-takeout'].policy === 'content', 'google-takeout registered as content class');
  ok(CLASSES['google-contacts'].policy === 'metadata-only', 'google-contacts is metadata-only (D1-deferential)');
  ok(CLASSES['external-provider'].policy === 'metadata-only', 'unclassified external providers fail closed');
  expectError(() => provenance.requireClass(CLASSES, 'facebook'), /OTHK_SOURCE_UNKNOWN/, 'unregistered class refused');
  const badCfg = path.join(tmpRoot(), 'bad.json');
  fs.writeFileSync(badCfg, JSON.stringify({ format: 'othk-source-classes', classes: { x: { title: 'x', policy: 'everything' } } }));
  expectError(() => provenance.loadSourceClasses(badCfg), /OTHK_SOURCE_CONFIG/, 'invalid policy invalidates whole registry');
  const s = storeLib.openStore(tmpRoot());
  expectError(() => ingest.ingestArtifact(s, CLASSES, {
    bytes: Buffer.from('# contact notes\n\nsome text'), filename: 'contacts.md',
    source_class: 'google-contacts', captured_at: CAP,
  }), /OTHK_INGEST_POLICY/, 'metadata-only class refuses content ingestion');
  ok(s.allRecords({ kind: 'artifact' }).length === 0, 'refused ingest stored no artifact');
}

// ---------- normalization ----------
console.log('§6 normalization');
{
  const md = normalize.normalize(Buffer.from('# T\n\npara one\n\npara two'), 'x.md');
  ok(md.media_type === 'text/markdown' && /para one/.test(md.text), 'markdown normalized');
  const html = normalize.normalize(Buffer.from('<html><script>evil()</script><body><p>visible&amp;ok</p></body></html>'), 'x.html');
  ok(/visible&ok/.test(html.text) && !/evil/.test(html.text), 'html stripped incl. scripts');
  const json = normalize.normalize(Buffer.from('{"a":{"b":"deep value"},"n":[1,2]}'), 'x.json');
  ok(/a\.b: deep value/.test(json.text), 'json flattened with paths');
  expectError(() => normalize.normalize(Buffer.from('{oops'), 'x.json'), /OTHK_NORMALIZE_MALFORMED/, 'malformed json refused');
  expectError(() => normalize.normalize(Buffer.from([0xff, 0xfe, 0x41]), 'x.txt'), /OTHK_NORMALIZE_ENCODING/, 'invalid utf-8 refused');
  expectError(() => normalize.normalize(Buffer.from('a\u0000b'), 'x.txt'), /OTHK_NORMALIZE_ENCODING/, 'NUL byte refused');
  expectError(() => normalize.normalize(Buffer.from('x'), 'x.exe'), /OTHK_NORMALIZE_UNSUPPORTED/, 'unsupported type refused');
  expectError(() => normalize.normalize(Buffer.from('   '), 'x.txt'), /OTHK_NORMALIZE_EMPTY/, 'empty text refused');
  const chunks = normalize.chunkText(Array.from({ length: 10 }, (_, i) => 'paragraph ' + i + ' ' + 'x'.repeat(300)).join('\n\n'));
  ok(chunks.length > 1, 'long text chunked');
  ok(JSON.stringify(chunks) === JSON.stringify(normalize.chunkText(Array.from({ length: 10 }, (_, i) => 'paragraph ' + i + ' ' + 'x'.repeat(300)).join('\n\n'))), 'chunking deterministic');
}

// ---------- ingestion pipeline ----------
console.log('§7 ingestion');
{
  const s = storeLib.openStore(tmpRoot());
  const res = ingest.ingestArtifact(s, CLASSES, {
    bytes: Buffer.from('# Note\n\nalpha content here\n\nbeta content here'), filename: 'note.md',
    source_class: 'manual', source_collection: 'batch-1', captured_at: CAP, observed_at: '2026-08-18T10:00:00Z',
  });
  ok(res.source.kind === 'source' && res.artifact.kind === 'artifact' && res.document.kind === 'document', 'source→artifact→document created');
  ok(res.chunks.length >= 1 && res.chunks[0].document_id === res.document.id, 'chunks linked to document');
  ok(res.artifact.provenance.source_class === 'manual' && res.artifact.provenance.artifact_ref === res.artifact.content_ref, 'provenance carries source class + artifact ref');
  ok(s.getObject(res.artifact.content_ref).toString().indexOf('alpha content') !== -1, 'original bytes preserved verbatim');
  const replay = ingest.ingestArtifact(s, CLASSES, {
    bytes: Buffer.from('# Note\n\nalpha content here\n\nbeta content here'), filename: 'note-again.md',
    source_class: 'manual', source_collection: 'batch-1', captured_at: CAP,
  });
  ok(replay.deduplicated === true && s.allRecords({ kind: 'artifact' }).length === 1, 'identical bytes deduplicate, no new records');
  const v = s.verify();
  ok(v.ok, 'store integrity after ingest (' + v.records + ' records)');
}

// ---------- secret gate ----------
console.log('§8 secret gate');
{
  const s = storeLib.openStore(tmpRoot());
  const cases = [
    ['private key block', '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----'],
    ['github token', 'deploy uses ghp_' + 'a1B2'.repeat(9) + ' for api calls'],
    ['password assignment', 'config: password = "hunter22secret"'],
    ['aws key', 'key AKIA' + 'ABCDEFGHIJKLMNOP' + ' present'],
  ];
  for (const [label, text] of cases) {
    expectError(() => ingest.ingestArtifact(s, CLASSES, {
      bytes: Buffer.from('notes\n\n' + text), filename: 'leak.txt', source_class: 'manual', captured_at: CAP,
    }), /OTHK_INGEST_SECRET/, 'refuses ' + label);
  }
  ok(s.allRecords({ kind: 'artifact' }).length === 0, 'no secret-bearing artifact stored');
  const refusals = s.allRecords({ kind: 'observation' });
  ok(refusals.length === cases.length, 'each refusal recorded as observation');
  ok(refusals.every((r) => r.statement.indexOf('hunter22') === -1 && r.statement.indexOf('AKIA') === -1 && r.statement.indexOf('ghp_a1B2') === -1), 'refusal observations never contain the secret text');
}

// ---------- extraction + traceability ----------
console.log('§9 extraction and traceability');
{
  const s = storeLib.openStore(tmpRoot());
  const host = extract.addEntity(s, { entity_type: 'host', name: 'vps-test' });
  const obs = extract.addObservation(s, CLASSES, { statement: 'TEST: probe RESULT: success', observed_at: CAP, prov: prov(), entity_ids: [host.id] });
  const fact = extract.addFact(s, CLASSES, { statement: 'the probe works', confidence: 'HIGH', prov: prov(), entity_ids: [host.id] });
  const ev = extract.addEvidence(s, { supports_id: fact.id, evidence_ids: [obs.id], note: 'probe run' });
  ok(ev.supports_id === fact.id && ev.evidence_ids[0] === obs.id, 'fact traceable to its evidence');
  expectError(() => extract.addEvidence(s, { supports_id: fact.id, evidence_ids: ['observation-0000000000000000'] }), /OTHK_EXTRACT_ORPHAN/, 'evidence to unknown record refused');
  const derived = extract.addDerived(s, CLASSES, { text: 'summary of the fact', derivation: 'summary', derived_from: [fact.id], prov: prov() });
  ok(derived.kind === 'derived' && derived.derived_from[0] === fact.id, 'derived record names its sources');
  expectError(() => extract.addDerived(s, CLASSES, { text: 'x', derivation: 'summary', derived_from: ['fact-ffffffffffffffff'], prov: prov() }), /OTHK_EXTRACT_ORPHAN/, 'derived from unknown record refused');
  const claim = extract.addClaim(s, CLASSES, { statement: 'source says so', asserted_by: 'fixture-source', prov: prov() });
  ok(claim.kind === 'claim', 'claim distinct from fact');
  expectError(() => extract.addRelationship(s, { rel_type: 'conflicts_with', from_id: fact.id, to_id: claim.id }), /use conflict.registerConflict/, 'conflict edges only via conflict module');
  ok(s.verify().ok, 'integrity after extraction');
}

// ---------- conflicts ----------
console.log('§10 conflicts');
{
  const s = storeLib.openStore(tmpRoot());
  const f1 = extract.addFact(s, CLASSES, { statement: 'rsync is available on the owner machine', confidence: 'MEDIUM', prov: prov({ observed_at: '2026-07-01T00:00:00Z' }) });
  const f2 = extract.addFact(s, CLASSES, { statement: 'rsync is NOT available on the owner machine', confidence: 'EXPLICIT', prov: prov({ observed_at: CAP, source_reference: 'manual/c1/y' }) });
  const rel = conflict.registerConflict(s, f1.id, f2.id, 'later verification contradicts earlier assumption');
  ok(rel.resolution_state === 'open', 'conflict registered open');
  ok(s.getRecord(f1.id) && s.getRecord(f2.id), 'both competing facts remain live — no silent overwrite');
  ok(conflict.registerConflict(s, f2.id, f1.id).id === rel.id, 'duplicate registration idempotent (order-insensitive)');
  expectError(() => conflict.resolveConflict(s, rel.id, { state: 'resolved' }), /decided_by required/, 'resolution requires decided_by');
  const resolved = conflict.resolveConflict(s, rel.id, { state: 'resolved', decided_by: 'owner', decided_at: CAP, winner_id: f2.id, rationale: 'verified 2026-08-19' });
  ok(resolved.resolution_state === 'resolved' && resolved.metadata.resolution.winner_id === f2.id, 'explicit resolution recorded');
  ok(s.getVersions(rel.id).length === 2, 'resolution is a new version, history preserved');
  ok(s.getRecord(f1.id) !== null, 'losing fact still readable after resolution');
  ok(conflict.listConflicts(s, { state: 'resolved' }).length === 1 && conflict.listConflicts(s, { state: 'open' }).length === 0, 'conflict listing by state');
}

// ---------- seed loader ----------
console.log('§11 infrastructure seed');
{
  const s = storeLib.openStore(tmpRoot());
  const seedPath = path.join(BASE, 'seeds', 'infrastructure-2026-08-19.json');
  const created = seedLib.loadSeed(s, CLASSES, seedPath);
  ok(created.entities === 4 && created.facts === 8 && created.observations === 3 && created.events === 1, 'seed creates expected record counts');
  ok(created.evidence >= 4, 'seed links facts to evidence');
  const before = s.stats().records;
  seedLib.loadSeed(s, CLASSES, seedPath);
  ok(s.stats().records === before, 'seed reload idempotent');
  ok(s.verify().ok, 'seeded store integrity OK');
  const capFact = s.allRecords({ kind: 'fact' }).find((f) => /CAPABILITY LIMITATION/.test(f.statement));
  ok(!!capFact, 'capability-limitation fact present');
  const evs = s.allRecords({ kind: 'evidence', where: (r) => r.supports_id === capFact.id });
  ok(evs.length === 1 && s.getRecord(evs[0].evidence_ids[0]).statement.indexOf('NOT available') !== -1, 'capability limitation traceable to the AI-env test observation');
  const secretsInStore = JSON.stringify(s.allRecords());
  ok(ingest.detectSecretShapes(secretsInStore).length === 0, 'seeded knowledge contains no credential-shaped content');
}

// ---------- api facade ----------
console.log('§12 api facade');
{
  const kb = api.open(tmpRoot());
  kb.ingestArtifact({ bytes: Buffer.from('facade check\n\ncontent'), filename: 'f.txt', source_class: 'manual', captured_at: CAP });
  ok(kb.stats().records >= 3, 'facade ingests');
  ok(kb.verify().ok, 'facade verify');
  ok(kb.search('facade check', { mode: 'lexical', limit: 3 }).length >= 1, 'facade search');
}

console.log('');
console.log('othk-0: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
