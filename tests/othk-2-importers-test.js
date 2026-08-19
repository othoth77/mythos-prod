// =====================================================
// OTH-K2 — importers / dedup / temporal / audit / service suite
// tests/othk-2-importers-test.js
//
// Offline suite. Covers: the four source importers (Takeout, Gemini,
// NotebookLM, Contacts-metadata-only), versioned import lineage,
// near-duplicate detection and linking, entity alias candidates,
// temporal classification (truth time vs ingest time), provenance
// audit + quarantine, security guards (size/depth/CSV abuse), and the
// provider-neutral knowledge-service boundary. All fixtures synthetic.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');

const storeLib = require(path.join(BASE, 'lib/store.js'));
const provenance = require(path.join(BASE, 'lib/provenance.js'));
const normalize = require(path.join(BASE, 'lib/normalize.js'));
const ingest = require(path.join(BASE, 'lib/ingest.js'));
const extract = require(path.join(BASE, 'lib/extract.js'));
const conflict = require(path.join(BASE, 'lib/conflict.js'));
const dedup = require(path.join(BASE, 'lib/dedup.js'));
const temporal = require(path.join(BASE, 'lib/temporal.js'));
const audit = require(path.join(BASE, 'lib/audit.js'));
const takeout = require(path.join(BASE, 'lib/importers/takeout.js'));
const gemini = require(path.join(BASE, 'lib/importers/gemini.js'));
const notebooklm = require(path.join(BASE, 'lib/importers/notebooklm.js'));
const contacts = require(path.join(BASE, 'lib/importers/contacts.js'));
const service = require(path.join(BASE, 'lib/knowledge-service.js'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
function expectError(fn, re, label) {
  try { fn(); ok(false, label + ' (expected error, but it succeeded)'); }
  catch (e) { ok(re.test(e.message), label + (re.test(e.message) ? '' : ' [got: ' + e.message + ']')); }
}
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk2-')); }

const CAP = '2026-08-19T12:00:00Z';
const CLASSES = provenance.loadSourceClasses();
const FIX = path.join(BASE, 'fixtures');

// Shared corpus store used across import sections, then analyzed.
const ROOT = tmpRoot();
const S = storeLib.openStore(ROOT);

console.log('§1 Takeout importer');
{
  const report = takeout.importDirectory(S, CLASSES, path.join(FIX, 'takeout-export'), { captured_at: CAP, collection: 'takeout-fixture' });
  ok(report.imported === 2, 'imports the two supported files (json, txt)');
  ok(report.skipped.length === 1 && /unsupported/.test(report.skipped[0].reason), 'unsupported .jpg skipped with reason, not silently');
  ok(report.events === 3, 'three activity events extracted (entry without time skipped)');
  const events = S.allRecords({ kind: 'event', where: (r) => r.provenance.source_class === 'google-takeout' });
  ok(events.length === 3, 'events persisted under google-takeout');
  ok(events.every((e) => e.occurred_at !== CAP), 'event truth time is the entry time, never the ingestion time');
  ok(events.every((e) => e.metadata.assertion_class === 'EXTRACTED' && e.metadata.parser_version === takeout.PARSER_VERSION), 'events stamped EXTRACTED + parser version');
  const art = S.allRecords({ kind: 'artifact', where: (r) => r.provenance.source_class === 'google-takeout' && /MyActivity/.test(r.filename) })[0];
  ok(art && art.metadata.parser_version === takeout.PARSER_VERSION && art.metadata.normalizer_version === normalize.NORMALIZER_VERSION, 'artifact carries parser + normalizer versions');
  ok(events.every((e) => e.provenance.artifact_ref === art.content_ref), 'events traceable to original artifact bytes');
  const replay = takeout.importDirectory(S, CLASSES, path.join(FIX, 'takeout-export'), { captured_at: CAP, collection: 'takeout-fixture' });
  ok(replay.imported === 0 && replay.deduplicated === 2, 're-import is a pure dedup replay');
  ok(S.allRecords({ kind: 'event', where: (r) => r.provenance.source_class === 'google-takeout' }).length === 3, 'replay creates no duplicate events');
}

console.log('§2 Gemini importer');
{
  const bytes = fs.readFileSync(path.join(FIX, 'gemini', 'gemini-conversations.json'));
  const report = gemini.importExport(S, CLASSES, { bytes, filename: 'gemini-conversations.json', captured_at: CAP, collection: 'gemini-fixture' });
  ok(report.conversations === 2 && report.events === 2, 'two valid conversations → two EXTRACTED events');
  ok(report.skipped.length === 1 && /create_time/.test(report.skipped[0].reason), 'conversation without create_time skipped, not fabricated');
  const evs = S.allRecords({ kind: 'event', where: (r) => r.provenance.source_class === 'gemini' });
  ok(evs.length === 2 && evs.every((e) => e.metadata.message_count === 2), 'events carry message counts');
  ok(evs.every((e) => e.occurred_at.indexOf('2026-04') === 0), 'truth time from conversation create_time');
  expectError(() => gemini.importExport(S, CLASSES, { bytes: Buffer.from('{"nope":1}'), filename: 'x.json', captured_at: CAP }), /OTHK_IMPORT_FORMAT/, 'wrong shape refused before anything is stored');
  expectError(() => gemini.importExport(S, CLASSES, { bytes: Buffer.from('not json'), filename: 'x.json', captured_at: CAP }), /OTHK_IMPORT_FORMAT/, 'non-JSON refused');
}

console.log('§3 NotebookLM importer');
{
  const bytes = fs.readFileSync(path.join(FIX, 'notebooklm', 'notebook-note.md'));
  const report = notebooklm.importNote(S, CLASSES, { bytes, filename: 'notebook-note.md', captured_at: CAP, observed_at: '2026-05-01T00:00:00Z', collection: 'notebooklm-fixture' });
  ok(report.claims === 2 && report.title === 'Infrastructure research notebook', 'two key points extracted as claims with note title');
  const claims = S.allRecords({ kind: 'claim', where: (r) => r.provenance.source_class === 'notebooklm' });
  ok(claims.length === 2, 'claims persisted under notebooklm class');
  ok(claims.every((c) => /^notebooklm:/.test(c.asserted_by)), 'model-assisted output is CLAIM asserted by notebooklm — never fact');
  ok(S.allRecords({ kind: 'fact', where: (r) => r.provenance.source_class === 'notebooklm' }).length === 0, 'no notebooklm statement promoted to fact');
  const ev = S.allRecords({ kind: 'evidence', where: (r) => r.supports_id === claims[0].id });
  ok(ev.length === 1 && /synthetic-runbook/.test(ev[0].metadata.note), 'claims evidenced to the note document with cited sources preserved');
}

console.log('§4 Contacts importer — metadata only');
{
  const bytesA = fs.readFileSync(path.join(FIX, 'google-contacts', 'contacts-synthetic-a.csv'));
  const bytesB = fs.readFileSync(path.join(FIX, 'google-contacts', 'contacts-synthetic-b.csv'));
  const a = contacts.importMetadata(S, CLASSES, { bytes: bytesA, filename: 'contacts-synthetic-a.csv', captured_at: CAP, collection: 'contacts-fixture' });
  ok(a.rows === 4 && a.columns === 5 && a.duplicate_rows === 1, 'aggregates: rows/columns/exact-duplicate rows');
  const b = contacts.importMetadata(S, CLASSES, { bytes: bytesB, filename: 'contacts-synthetic-b.csv', captured_at: CAP, collection: 'contacts-fixture', compare_with: a.analysis });
  ok(b.overlap_with_compare === 1, 'cross-file overlap measured (Beta row shared)');
  const everything = JSON.stringify(S.allRecords());
  ok(everything.indexOf('Fixture Person') === -1 && everything.indexOf('+00000000000') === -1 &&
     everything.indexOf('alpha@') === -1 && everything.indexOf('delta@') === -1, 'NO contact content anywhere in the store — names/phones/emails absent');
  ok(S.allRecords({ kind: 'artifact', where: (r) => r.provenance.source_class === 'google-contacts' }).length === 0, 'no contacts artifact stored (metadata-only policy holds)');
  const obs = S.allRecords({ kind: 'observation', where: (r) => r.provenance.source_class === 'google-contacts' });
  ok(obs.length === 2 && obs.every((o) => o.metadata.content_hash.length === 64), 'two metadata observations with content hashes');
  ok(obs.every((o) => o.provenance.source_reference.indexOf('google-contacts/sha256/') === 0), 'opaque hash identity as source reference');
}

console.log('§5 dedup');
{
  // Two near-identical manual documents (small edit), one unrelated.
  const t1 = 'The deployment pipeline copies the release, switches the symlink, reloads the service, and verifies the health endpoint after every rollout across environments.';
  const t2 = 'The deployment pipeline copies the release, switches the symlink, reloads the service, and verifies the health endpoint after every rollout across regions.';
  ingest.ingestArtifact(S, CLASSES, { bytes: Buffer.from('# A\n\n' + t1), filename: 'dup-a.md', source_class: 'manual', source_collection: 'dedup', captured_at: CAP });
  ingest.ingestArtifact(S, CLASSES, { bytes: Buffer.from('# B\n\n' + t2), filename: 'dup-b.md', source_class: 'manual', source_collection: 'dedup', captured_at: CAP });
  const pairs = dedup.findNearDuplicates(S, { threshold: 0.5 });
  ok(pairs.length >= 1 && pairs[0].similarity >= 0.5 && pairs[0].similarity < 1, 'near-duplicate pair detected with similarity < 1');
  const linked = dedup.linkDuplicates(S, pairs);
  ok(linked.length === pairs.length, 'pairs linked');
  const rels = S.allRecords({ kind: 'relationship', where: (r) => /duplicate_of$/.test(r.rel_type) });
  ok(rels.length >= 1 && rels.every((r) => S.getRecord(r.from_id) && S.getRecord(r.to_id)), 'both sides stay live — link, never merge/delete');
  ok(dedup.linkDuplicates(S, pairs).length === 0, 'duplicate linking idempotent');
  // entity aliases
  extract.addEntity(S, { entity_type: 'host', name: 'VPS Alpha' });
  extract.addEntity(S, { entity_type: 'system', name: 'vps alpha' });
  const aliases = dedup.findEntityAliasCandidates(S);
  ok(aliases.length >= 1, 'same folded name across entities → alias candidate');
  const aliasLinks = dedup.linkEntityAliases(S, aliases);
  ok(aliasLinks.length >= 1 && S.getRecord(aliasLinks[0]).rel_type === 'same_as_candidate', 'alias candidates linked, never auto-merged');
}

console.log('§6 conflict engine on realistic contradictions');
{
  const provA = { source_class: 'manual', source_collection: 'crm', source_reference: 'manual/crm/card-1', captured_at: CAP, observed_at: '2024-06-01T00:00:00Z' };
  const provB = { source_class: 'owner-report', source_collection: 'crm', source_reference: 'owner-report/crm/update-7', captured_at: CAP, observed_at: '2026-08-01T00:00:00Z' };
  const f1 = extract.addFact(S, CLASSES, { statement: 'Supplier hotline number ends in 0001 (synthetic)', confidence: 'MEDIUM', prov: provA, tags: ['crm'] });
  const f2 = extract.addFact(S, CLASSES, { statement: 'Supplier hotline number ends in 0009 (synthetic)', confidence: 'EXPLICIT', prov: provB, tags: ['crm'] });
  const rel = conflict.registerConflict(S, f1.id, f2.id, 'different phone numbers from different sources');
  ok(rel.resolution_state === 'open' && rel.metadata.from_source_class !== rel.metadata.to_source_class, 'conflict captures both sources');
  ok(rel.metadata.from_observed_at !== rel.metadata.to_observed_at, 'conflict captures both truth timestamps');
  // Documented auto-resolution rule: newer EXPLICIT owner statement wins;
  // applied EXPLICITLY, never silently.
  const resolved = conflict.resolveConflict(S, rel.id, { state: 'resolved', decided_by: 'rule:newer-explicit-owner-statement', decided_at: CAP, winner_id: f2.id, rationale: 'EXPLICIT owner statement with later observed_at supersedes MEDIUM older source' });
  ok(resolved.metadata.resolution.winner_id === f2.id && S.getRecord(f1.id) !== null, 'documented rule resolves; loser still readable');
  // Ambiguous case stays open.
  const f3 = extract.addFact(S, CLASSES, { statement: 'Project Atlas started 2026-02 (synthetic)', confidence: 'MEDIUM', prov: provA });
  const f4 = extract.addFact(S, CLASSES, { statement: 'Project Atlas started 2026-03 (synthetic)', confidence: 'MEDIUM', prov: Object.assign({}, provB, { confidence: undefined }) });
  const rel2 = conflict.registerConflict(S, f3.id, f4.id, 'different dates, equal confidence');
  ok(S.getRecord(rel2.id).resolution_state === 'open', 'ambiguous contradiction left unresolved');
}

console.log('§7 temporal knowledge');
{
  const asOf = '2026-08-19T23:59:59Z';
  const planned = extract.addEvent(S, CLASSES, { title: 'Planned synthetic migration window', occurred_at: '2027-01-15T00:00:00Z', prov: { source_class: 'manual', source_collection: 'plan', source_reference: 'manual/plan/1', captured_at: CAP }, metadata: { assertion_class: 'OBSERVED' }, tags: ['OBSERVED'] });
  ok(temporal.classify(S, planned, { asOf }) === 'planned', 'future truth time → planned');
  const f2 = S.allRecords({ kind: 'fact', where: (r) => /0009/.test(r.statement) })[0];
  const f1 = S.allRecords({ kind: 'fact', where: (r) => /0001/.test(r.statement) })[0];
  ok(temporal.classify(S, f2, { asOf }) === 'current', 'winning fact → current');
  ok(temporal.classify(S, f1, { asOf }) === 'superseded', 'losing side of resolved conflict → superseded');
  const noDate = extract.addClaim(S, CLASSES, { statement: 'Undated synthetic claim', asserted_by: 'fixture', prov: { source_class: 'manual', source_collection: 'plan', source_reference: 'manual/plan/2', captured_at: CAP } });
  ok(temporal.classify(S, noDate, { asOf }) === 'unknown-date', 'missing truth time → unknown-date, never guessed');
  const known2024 = temporal.knownAt(S, '2024-12-31T23:59:59Z');
  ok(known2024.some((r) => r.id === f1.id) && !known2024.some((r) => r.id === f2.id), '"what was true in 2024" includes the 2024 observation, excludes 2026 knowledge');
  ok(!known2024.some((r) => r.id === planned.id), '2024 view excludes planned 2027 event');
  const changed = temporal.whatChanged(S, { after: '2026-04-01T00:00:00Z', before: '2026-04-30T23:59:59Z' });
  ok(changed.truth_time_changes.length === 2 && changed.ingest_time_changes.length === 0, 'truth-time window (April: 2 Gemini conversations) separate from ingest-time window (empty — ingested in August)');
  const latest = temporal.latestVerified(S, { tag: 'crm' });
  ok(latest.length === 1 && latest[0].id === f2.id, 'latest verified fact = newest EXPLICIT truth time, loser excluded');
  ok(temporal.truthTimeOf(S.allRecords({ kind: 'event', where: (r) => r.provenance.source_class === 'gemini' })[0]) !== CAP, 'newest ingestion timestamp never used as truth timestamp');
}

console.log('§8 provenance audit');
{
  const report = audit.provenanceAudit(S);
  ok(report.ok, 'imported corpus passes the full provenance audit (' + report.audited + ' items)');
  ok(report.warnings.length >= 3 && report.warnings.every((w) => /fact without evidence/.test(w.warning)), 'manually-entered non-EXPLICIT facts flagged as warnings, not failures');
  // Break one on purpose in a scratch store.
  const s2 = storeLib.openStore(tmpRoot());
  s2.appendRecord({ kind: 'observation', id: require(path.join(BASE, 'lib/ids.js')).recordId('observation', 'bad'), statement: 'no source record exists for me', observed_at: CAP, provenance: { source_class: 'manual', source_collection: 'ghost', source_reference: 'manual/ghost/x', captured_at: CAP } });
  const bad = audit.provenanceAudit(s2);
  ok(!bad.ok && /source record missing/.test(bad.findings[0].problems[0]), 'orphan source detected');
  const q = audit.provenanceAudit(s2, { quarantine: true });
  ok(q.quarantined.length === 1, 'failing item quarantined');
  const rec = s2.getRecord(q.quarantined[0]);
  ok(rec.tags.indexOf('quarantined') !== -1 && s2.getVersions(rec.id).length === 2, 'quarantine is a new tagged version — history intact');
  ok(audit.assertionClassOf({ kind: 'derived', derived_from: ['x'] }) === 'DERIVED', 'derived defaults to DERIVED class');
}

console.log('§9 security guards');
{
  const s3 = storeLib.openStore(tmpRoot());
  const big = Buffer.alloc(ingest.MAX_ARTIFACT_BYTES + 1, 97);
  expectError(() => ingest.ingestArtifact(s3, CLASSES, { bytes: big, filename: 'big.txt', source_class: 'manual', captured_at: CAP }), /OTHK_INGEST_TOO_LARGE/, 'oversized artifact refused');
  let deep = '1'; for (let i = 0; i < 70; i++) deep = '[' + deep + ']';
  expectError(() => normalize.normalize(Buffer.from(deep), 'bomb.json'), /depth/, 'JSON depth bomb refused');
  expectError(() => normalize.parseCsv('a,b\n"unterminated'), /quoted field/, 'unterminated CSV quote refused');
  expectError(() => normalize.parseCsv(Array(600).fill('x').join(',')), /fields/, 'CSV field-count bomb refused');
  // secret gate still active through importer paths
  expectError(() => notebooklm.importNote(s3, CLASSES, { bytes: Buffer.from('# n\n\n-----BEGIN OPENSSH PRIVATE KEY-----\nAAA\n-----END OPENSSH PRIVATE KEY-----'), filename: 'leak.md', captured_at: CAP }), /OTHK_INGEST_SECRET/, 'importer path enforces credential gate');
  ok(s3.allRecords({ kind: 'artifact' }).length === 0, 'nothing stored by refused imports');
  // log-leak shape: contacts statements never include cell values (checked in §4 store-wide)
  const contactsObs = S.allRecords({ kind: 'observation', where: (r) => r.provenance.source_class === 'google-contacts' });
  ok(contactsObs.every((o) => o.statement.length < 600), 'contacts observations bounded');
}

console.log('§10 knowledge-service boundary');
{
  const svc = service.openService(ROOT);
  const hits = svc.search('backup restore tested', { mode: 'hybrid', limit: 5 });
  ok(hits.length >= 1 && hits[0].provenance, 'service search returns provenance-carrying hits');
  const hitAudit = audit.auditHits(S, hits);
  ok(hitAudit.ok, 'every service hit passes retrieval-time provenance audit');
  const f2 = S.allRecords({ kind: 'fact', where: (r) => /0009/.test(r.statement) })[0];
  const retrieved = svc.retrieve(f2.id);
  ok(retrieved.record.id === f2.id && retrieved.versions.length >= 1, 'retrieve returns record + version envelope info');
  const ent = svc.lookupEntity('vps alpha');
  ok(ent.length === 2, 'entity lookup folds names and returns all alias entities');
  const evidence = svc.lookupEvidence(S.allRecords({ kind: 'claim', where: (r) => r.provenance && r.provenance.source_class === 'notebooklm' })[0].id);
  ok(evidence.length === 1 && evidence[0].records[0].kind === 'document', 'evidence lookup resolves records');
  const provInfo = svc.lookupProvenance(S.allRecords({ kind: 'event', where: (r) => r.provenance.source_class === 'gemini' })[0].id);
  ok(provInfo.provenance.source_class === 'gemini' && provInfo.artifact_available === true && provInfo.lineage.assertion_class === 'EXTRACTED', 'provenance lookup includes lineage + artifact availability');
  const contradictions = svc.findContradictions({ state: 'open' });
  ok(contradictions.length === 1 && contradictions[0].a && contradictions[0].b, 'open contradictions returned with both sides');
  const state = svc.currentState({ asOf: '2026-08-19T23:59:59Z', tag: 'crm' });
  ok(state.latest_verified.length === 1 && state.known.every((k) => k.classification !== 'planned'), 'currentState: latest verified + no planned items in known set');
  expectError(() => svc.currentState({}), /asOf required/, 'service refuses wall-clock defaults');
  ok(!('ingestArtifact' in svc) && !('addFact' in svc), 'service surface is read-only — the AI layer consumes, never owns');
}

console.log('');
console.log('othk-2: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
