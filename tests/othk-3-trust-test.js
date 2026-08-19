// =====================================================
// OTH-K3 — knowledge trust model suite
// tests/othk-3-trust-test.js
//
// Offline suite over synthetic fixtures. Covers: fail-closed trust-model
// config (bidirectional closure against source classes), statement
// categories (claim never fact; model-output fact demoted), corroboration
// independence (duplicate evidence never counted; derived never counted;
// self-corroboration excluded; also_present_in labelled not counted),
// contradiction/conflict state as of asOf, staleness (unknown-date fail
// closed, not-yet-true, no negative age), sticky quarantine across BOTH
// tag spellings, superseded losing side, version-at-asOf selection,
// missing-provenance fail-closed, read-only guarantee (store bytes
// unchanged by assessment), service + executor wiring incl. explicit
// asOf, and the executor allowlist holding against a widened service.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');

const storeLib = require(path.join(BASE, 'lib/store.js'));
const provenance = require(path.join(BASE, 'lib/provenance.js'));
const ingest = require(path.join(BASE, 'lib/ingest.js'));
const extract = require(path.join(BASE, 'lib/extract.js'));
const conflict = require(path.join(BASE, 'lib/conflict.js'));
const audit = require(path.join(BASE, 'lib/audit.js'));
const trust = require(path.join(BASE, 'lib/trust.js'));
const service = require(path.join(BASE, 'lib/knowledge-service.js'));
const execKnowledge = require(path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'lib', 'knowledge.js'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
function expectError(fn, re, label) {
  try { fn(); ok(false, label + ' (expected error, but it succeeded)'); }
  catch (e) { ok(re.test(e.message), label + (re.test(e.message) ? '' : ' [got: ' + e.message + ']')); }
}
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk3-')); }

const CAP = '2026-08-01T12:00:00Z';
const ASOF = '2026-08-19T00:00:00Z';
const CLASSES = provenance.loadSourceClasses();
const MODEL = trust.loadTrustModel(undefined, CLASSES);
function pv(cls, ref, observed, confidence) {
  return { source_class: cls, source_collection: 'trust-fix', source_reference: ref, captured_at: CAP, observed_at: observed || CAP, confidence };
}

console.log('§1 trust-model config fail-closed');
{
  ok(Object.keys(MODEL).length === Object.keys(CLASSES).length, 'shipped model covers every registered source class');
  expectError(() => trust.loadTrustModel(undefined, {}), /OTHK_TRUST_CONFIG/, 'empty source registry refused');
  const dir = tmpRoot();
  const w = (o) => { const p = path.join(dir, 'tm.json'); fs.writeFileSync(p, JSON.stringify(o)); return p; };
  expectError(() => trust.loadTrustModel(w({ format: 'nope' }), CLASSES), /invalid trust-model format/, 'wrong format refused');
  expectError(() => trust.loadTrustModel(w({ format: 'othk-trust-model', classes: { 'not-registered': { tier: 'imported', stale_after_days: 10 } } }), CLASSES), /unregistered source class/, 'entry naming unregistered class refused');
  const partial = { format: 'othk-trust-model', classes: {} };
  for (const n of Object.keys(CLASSES)) partial.classes[n] = { tier: 'imported', stale_after_days: 10 };
  delete partial.classes['gemini'];
  expectError(() => trust.loadTrustModel(w(partial), CLASSES), /no trust tier: gemini/, 'registered class without a tier refused (bidirectional closure)');
  const badTier = JSON.parse(JSON.stringify(partial)); badTier.classes.gemini = { tier: 'gospel', stale_after_days: 10 };
  expectError(() => trust.loadTrustModel(w(badTier), CLASSES), /invalid tier/, 'unknown tier refused');
  const badDays = JSON.parse(JSON.stringify(badTier)); badDays.classes.gemini = { tier: 'model-output', stale_after_days: 0 };
  expectError(() => trust.loadTrustModel(w(badDays), CLASSES), /stale_after_days/, 'non-positive horizon refused');
  const cred = JSON.parse(JSON.stringify(badTier)); cred.classes.gemini = { tier: 'model-output', stale_after_days: 10, api_key: 'x' };
  expectError(() => trust.loadTrustModel(w(cred), CLASSES), /credential-shaped/, 'credential-shaped key anywhere refuses the whole model');
  expectError(() => trust.loadTrustModel(path.join(dir, 'missing.json'), CLASSES), /unreadable/, 'unreadable file refused');
}

// Shared corpus.
const ROOT = tmpRoot();
const S = storeLib.openStore(ROOT);
const ownerFact = extract.addFact(S, CLASSES, { statement: 'VPS uses ED25519 deploy key (synthetic)', confidence: 'EXPLICIT', prov: pv('owner-report', 'owner/1', '2026-08-10T00:00:00Z'), tags: ['OBSERVED'], metadata: { assertion_class: 'OBSERVED' } });
const geminiFact = extract.addFact(S, CLASSES, { statement: 'Model-output statement stored as fact (synthetic)', confidence: 'HIGH', prov: pv('gemini', 'gem/1', '2026-08-10T00:00:00Z') });
const importedClaim = extract.addClaim(S, CLASSES, { statement: 'NotebookLM key point (synthetic)', asserted_by: 'notebooklm:note-1', prov: pv('notebooklm', 'nb/1', '2026-08-10T00:00:00Z') });
const ownerClaim = extract.addClaim(S, CLASSES, { statement: 'Owner-asserted preference (synthetic)', asserted_by: 'owner', prov: pv('owner-report', 'owner/2', '2026-08-10T00:00:00Z') });
const staleFact = extract.addFact(S, CLASSES, { statement: 'Old infrastructure detail (synthetic)', confidence: 'HIGH', prov: pv('owner-report', 'owner/3', '2020-01-01T00:00:00Z'), metadata: { assertion_class: 'OBSERVED' } });
const undatedFact = (() => {
  // fact with no observed_at anywhere → unknown-date
  const p = { source_class: 'owner-report', source_collection: 'trust-fix', source_reference: 'owner/4', captured_at: CAP };
  provenance.ensureSource(S, CLASSES, p.source_class, p.source_collection);
  const rec = { kind: 'fact', id: require(path.join(BASE, 'lib/ids.js')).recordId('fact', 'undated'), statement: 'Undated statement (synthetic)', confidence: 'HIGH', provenance: provenance.buildProvenance(CLASSES, p), metadata: { assertion_class: 'OBSERVED' }, tags: [] };
  delete rec.provenance.observed_at;
  S.appendRecord(rec);
  return rec;
})();
const futureEvent = extract.addEvent(S, CLASSES, { title: 'Planned window (synthetic)', occurred_at: '2027-01-01T00:00:00Z', prov: pv('manual', 'plan/1'), metadata: { assertion_class: 'OBSERVED' } });

console.log('§2 statement categories — claim never fact, model-output fact demoted');
{
  const a = trust.assessTrust(S, MODEL, ownerFact.id, { asOf: ASOF });
  ok(a.statement_category === 'accepted-fact', 'first-party OBSERVED fact → accepted-fact');
  ok(a.not_a_truth_value === true, 'report explicitly not a truth value');
  const g = trust.assessTrust(S, MODEL, geminiFact.id, { asOf: ASOF });
  ok(g.statement_category === 'imported-claim', 'a fact record carrying a gemini (model-output) source can NEVER assess as accepted-fact');
  ok(g.trust_summary === 'unverified-assertion', 'model-output fact summary capped at unverified-assertion');
  const ic = trust.assessTrust(S, MODEL, importedClaim.id, { asOf: ASOF });
  ok(ic.statement_category === 'imported-claim' && ic.trust_summary === 'unverified-assertion', 'imported claim stays a claim (never presented as fact)');
  const uc = trust.assessTrust(S, MODEL, ownerClaim.id, { asOf: ASOF });
  ok(uc.statement_category === 'user-provided-claim' && uc.trust_summary === 'unverified-assertion', 'user-provided claim distinguished AND still capped as assertion');
  ok(trust.SUMMARIES.every((s) => !/verified|confirmed|true|accurate/i.test(s) || s === 'unverified-assertion'), 'summary vocabulary is not truth-shaped');
}

console.log('§3 non-statement kinds and unknown/deleted ids');
{
  const src = S.allRecords({ kind: 'source' })[0];
  expectError(() => trust.assessTrust(S, MODEL, src.id, { asOf: ASOF }), /OTHK_TRUST_KIND/, 'source record refused (structural, not a statement)');
  expectError(() => trust.assessTrust(S, MODEL, 'fact-0000000000000000', { asOf: ASOF }), /OTHK_TRUST_UNKNOWN/, 'unknown id → typed error');
  expectError(() => trust.assessTrust(S, MODEL, ownerFact.id, {}), /OTHK_TRUST_INPUT/, 'missing asOf refused — never wall clock');
  const dead = extract.addFact(S, CLASSES, { statement: 'To be tombstoned (synthetic)', confidence: 'HIGH', prov: pv('manual', 'tomb/1') });
  S.tombstone(dead.id);
  expectError(() => trust.assessTrust(S, MODEL, dead.id, { asOf: ASOF }), /OTHK_TRUST_DELETED/, 'tombstoned id → typed error, never a healthy report');
}

console.log('§4 freshness — stale, unknown-date, not-yet-true');
{
  const st = trust.assessTrust(S, MODEL, staleFact.id, { asOf: ASOF });
  ok(st.freshness.stale === true && st.trust_summary === 'stale', 'source beyond horizon → stale (and stale ≠ false: category still accepted-fact)');
  ok(st.statement_category === 'accepted-fact', 'staleness does not demote the statement category');
  const ud = trust.assessTrust(S, MODEL, undatedFact.id, { asOf: ASOF });
  ok(ud.freshness.status === 'unknown-date' && ud.freshness.stale === true, 'unknown-date is stale fail-closed, never fresh');
  const fe = trust.assessTrust(S, MODEL, futureEvent.id, { asOf: ASOF });
  ok(fe.freshness.status === 'not-yet-true' && fe.freshness.age_days === null, 'truth time after asOf → not-yet-true, no negative age');
}

console.log('§5 contradiction — as-of semantics and losing side');
{
  const f1 = extract.addFact(S, CLASSES, { statement: 'Value is A (synthetic)', confidence: 'MEDIUM', prov: pv('manual', 'c/1', '2026-06-01T00:00:00Z'), metadata: { assertion_class: 'OBSERVED' } });
  const f2 = extract.addFact(S, CLASSES, { statement: 'Value is B (synthetic)', confidence: 'EXPLICIT', prov: pv('owner-report', 'c/2', '2026-07-01T00:00:00Z'), metadata: { assertion_class: 'OBSERVED' } });
  const rel = conflict.registerConflict(S, f1.id, f2.id, 'conflicting sources');
  const open1 = trust.assessTrust(S, MODEL, f1.id, { asOf: ASOF });
  ok(open1.trust_summary === 'contested' && open1.contradictions.open.length === 1, 'open contradiction → contested, conflict traceable');
  ok(open1.contradictions.open[0].other_id === f2.id, 'opposing record id reported');
  const open2 = trust.assessTrust(S, MODEL, f2.id, { asOf: ASOF });
  ok(open2.trust_summary === 'contested', 'both sides contested while open — authority does not silently win');
  conflict.resolveConflict(S, rel.id, { state: 'resolved', decided_by: 'owner', decided_at: '2026-08-25T00:00:00Z', winner_id: f2.id, rationale: 'owner statement' });
  const before = trust.assessTrust(S, MODEL, f1.id, { asOf: ASOF });
  ok(before.trust_summary === 'contested', 'resolution decided AFTER asOf does not exist at asOf (still contested)');
  const after = trust.assessTrust(S, MODEL, f1.id, { asOf: '2026-09-01T00:00:00Z' });
  ok(after.trust_summary === 'superseded' && after.contradictions.losing.length === 1, 'losing side after decided_at → superseded ceiling, never healthy');
  const winner = trust.assessTrust(S, MODEL, f2.id, { asOf: '2026-09-01T00:00:00Z' });
  ok(winner.contradictions.winning.length === 1 && winner.trust_summary !== 'superseded', 'winner carries the resolved conflict in trace and is not superseded');
}

console.log('§6 corroboration — independence, duplicates, derived, also_present_in');
{
  // Two artifacts from different collections = two independent sources;
  // the same artifact cited twice = duplicate, not corroboration.
  const b1 = Buffer.from('# Report one\n\nSynthetic corroboration content alpha.');
  const b2 = Buffer.from('# Report two\n\nSynthetic corroboration content beta.');
  const r1 = ingest.ingestArtifact(S, CLASSES, { bytes: b1, filename: 'r1.md', source_class: 'google-takeout', source_collection: 'exp-a', captured_at: CAP });
  const r2 = ingest.ingestArtifact(S, CLASSES, { bytes: b2, filename: 'r2.md', source_class: 'mythos-repo', source_collection: 'docs', captured_at: CAP });
  const f = extract.addFact(S, CLASSES, { statement: 'Corroborated statement (synthetic)', confidence: 'HIGH', prov: pv('owner-report', 'corr/1', '2026-08-10T00:00:00Z'), metadata: { assertion_class: 'OBSERVED' } });
  extract.addEvidence(S, { supports_id: f.id, evidence_ids: [r1.chunks[0].id, r2.chunks[0].id], note: 'independent' });
  extract.addEvidence(S, { supports_id: f.id, evidence_ids: [r1.chunks[0].id], note: 'duplicate citation of source one' });
  const a = trust.assessTrust(S, MODEL, f.id, { asOf: ASOF });
  ok(a.corroboration.independent_sources === 2, 'independent sources counted by (class, collection, content anchor): 2');
  ok(a.corroboration.duplicate_evidence.length === 1, 'duplicate evidence listed, never counted as corroboration');
  ok(a.trust_summary === 'supported', 'well-provenanced first-party fact with evidence → supported (the ceiling label)');

  // Derived evidence never counts.
  const d = extract.addDerived(S, CLASSES, { text: 'AI summary of report one (synthetic)', derivation: 'summary', derived_from: [r1.document.id], prov: pv('gemini', 'sum/1') });
  const f3 = extract.addFact(S, CLASSES, { statement: 'Statement supported only by a derivation (synthetic)', confidence: 'HIGH', prov: pv('owner-report', 'corr/2', '2026-08-10T00:00:00Z'), metadata: { assertion_class: 'OBSERVED' } });
  extract.addEvidence(S, { supports_id: f3.id, evidence_ids: [d.id] });
  const a3 = trust.assessTrust(S, MODEL, f3.id, { asOf: ASOF });
  ok(a3.corroboration.independent_sources === 0 && a3.corroboration.derived_evidence.length === 1, 'derived evidence listed but NEVER counted (a derivation is not a new source)');

  // Self-corroboration excluded: evidence resolving to the record's own source identity.
  const selfFact = extract.addFact(S, CLASSES, { statement: 'Self-cited statement (synthetic)', confidence: 'HIGH', prov: Object.assign(pv('google-takeout', 'corr/3', '2026-08-10T00:00:00Z'), { source_collection: 'exp-a', artifact_ref: r1.artifact.content_ref }), metadata: { assertion_class: 'EXTRACTED' } });
  extract.addEvidence(S, { supports_id: selfFact.id, evidence_ids: [r1.chunks[0].id] });
  const aSelf = trust.assessTrust(S, MODEL, selfFact.id, { asOf: ASOF });
  ok(aSelf.corroboration.independent_sources === 0, 'a record is not its own corroboration (same source identity excluded)');

  // also_present_in: same bytes from a second source → labelled additional_sources, count unchanged.
  ingest.ingestArtifact(S, CLASSES, { bytes: b1, filename: 'r1-copy.md', source_class: 'manual', source_collection: 'notes', captured_at: CAP });
  const aAgain = trust.assessTrust(S, MODEL, selfFact.id, { asOf: ASOF });
  ok(aAgain.corroboration.additional_sources.length === 1 && aAgain.corroboration.independent_sources === 0, 'also_present_in enumerated separately, never silently folded into the count');
  // Unresolved evidence: a referenced record tombstoned after the link
  // was created (write-time orphan refusal makes this the only path).
  const gone = extract.addObservation(S, CLASSES, { statement: 'Ephemeral observation (synthetic)', observed_at: '2026-08-01T00:00:00Z', prov: pv('manual', 'gone/1'), metadata: { assertion_class: 'OBSERVED' } });
  extract.addEvidence(S, { supports_id: f3.id, evidence_ids: [gone.id] });
  S.tombstone(gone.id);
  const a4 = trust.assessTrust(S, MODEL, f3.id, { asOf: ASOF });
  ok(a4.corroboration.unresolved_evidence.length === 1 && a4.corroboration.independent_sources === 0, 'tombstoned evidence reported unresolved, never counted');
}

console.log('§7 missing provenance and provenance strength — fail closed');
{
  // Store-level bypass (writes outside validated paths are the threat model here).
  const s2 = storeLib.openStore(tmpRoot());
  s2.appendRecord({ kind: 'entity', id: require(path.join(BASE, 'lib/ids.js')).recordId('entity', 'x/y'), entity_type: 'x', name: 'y' });
  // observation with provenance naming a class with no source record and no registry entry is
  // impossible via extract; simulate a foreign store record via direct append with a valid shape
  // but an orphaned source. buildProvenance requires registry, so use a raw record:
  const orphan = { kind: 'observation', id: require(path.join(BASE, 'lib/ids.js')).recordId('observation', 'orphan'), statement: 'Orphan-source observation (synthetic)', observed_at: '2026-08-01T00:00:00Z', provenance: { source_class: 'manual', source_collection: 'nowhere', source_reference: 'manual/nowhere/1', captured_at: CAP } };
  s2.appendRecord(orphan);
  const rep = trust.assessTrust(s2, MODEL, orphan.id, { asOf: ASOF });
  ok(rep.provenance_strength.level === 'WEAK' && rep.trust_summary === 'weakly-supported', 'orphaned source record → WEAK strength, weakly-supported (never supported)');
  ok(rep.trace.source_id === null, 'trace shows the missing source honestly');
}

console.log('§8 quarantine — sticky, both spellings, secret-refusal');
{
  // audit-quarantined record ('quarantined')
  const s3 = storeLib.openStore(tmpRoot());
  const q = extract.addFact(s3, CLASSES, { statement: 'Quarantined statement (synthetic)', confidence: 'HIGH', prov: pv('manual', 'q/1', '2026-08-01T00:00:00Z'), metadata: { assertion_class: 'OBSERVED' } });
  audit.quarantine(s3, q.id, 'test quarantine');
  const rq = trust.assessTrust(s3, MODEL, q.id, { asOf: ASOF });
  ok(rq.statement_category === 'quarantined-assertion' && rq.trust_summary === 'quarantined', "audit 'quarantined' tag → quarantined ceiling");
  // sticky: a later version dropping the tag does not un-quarantine at any asOf
  const clean = JSON.parse(JSON.stringify(s3.getRecord(q.id)));
  clean.tags = []; delete clean.metadata.quarantine_reason;
  clean.provenance.captured_at = '2026-08-15T00:00:00Z';
  s3.appendRecord(clean, { allowNewVersion: true });
  const rq2 = trust.assessTrust(s3, MODEL, q.id, { asOf: ASOF });
  ok(rq2.trust_summary === 'quarantined', 'quarantine is sticky: a later version dropping the tag never silently recovers');
  // ingest secret-refusal path ('quarantine' spelling)
  const s4 = storeLib.openStore(tmpRoot());
  try { ingest.ingestArtifact(s4, CLASSES, { bytes: Buffer.from('api_key = "sk-SYNTHETICSYNTHETICSYNTHETIC1234"'), filename: 'creds.txt', source_class: 'manual', captured_at: CAP }); } catch (e) { /* refusal expected */ }
  const refusal = s4.allRecords({ kind: 'observation' })[0];
  ok(!!refusal && refusal.tags.indexOf('quarantine') !== -1, 'secret refusal observation exists with the ingest tag spelling');
  const rr = trust.assessTrust(s4, MODEL, refusal.id, { asOf: ASOF });
  ok(rr.trust_summary === 'quarantined', "ingest 'quarantine' spelling detected — no bypass via the second tag vocabulary");
}

console.log('§9 version-at-asOf selection');
{
  const s5 = storeLib.openStore(tmpRoot());
  const f = extract.addFact(s5, CLASSES, { statement: 'original (synthetic)', confidence: 'HIGH', prov: pv('owner-report', 'v/1', '2026-01-10T00:00:00Z'), metadata: { assertion_class: 'OBSERVED' } });
  const corrected = JSON.parse(JSON.stringify(s5.getRecord(f.id)));
  corrected.statement = 'corrected (synthetic)';
  corrected.provenance.captured_at = '2026-06-01T00:00:00Z';
  s5.appendRecord(corrected, { allowNewVersion: true });
  const early = trust.assessTrust(s5, MODEL, f.id, { asOf: '2026-03-01T00:00:00Z' });
  ok(early.version_assessed === 1, 'assessment at asOf before the correction assesses version 1 — later corrections never leak');
  const late = trust.assessTrust(s5, MODEL, f.id, { asOf: '2026-07-01T00:00:00Z' });
  ok(late.version_assessed === 2, 'assessment after the correction assesses version 2');
}

console.log('§10 read-only guarantee');
{
  const before = fs.readFileSync(path.join(ROOT, 'records.jsonl'));
  trust.assessTrust(S, MODEL, ownerFact.id, { asOf: ASOF });
  trust.assessTrust(S, MODEL, importedClaim.id, { asOf: ASOF });
  const after = fs.readFileSync(path.join(ROOT, 'records.jsonl'));
  ok(before.equals(after), 'store file byte-identical after assessments — no hidden write path');
}

console.log('§11 service wiring');
{
  const svc = service.openService(ROOT);
  expectError(() => svc.assessTrust(ownerFact.id, {}), /asOf required/, 'service refuses assessTrust without asOf');
  const rep = svc.assessTrust(ownerFact.id, { asOf: ASOF });
  ok(rep.statement_category === 'accepted-fact' && rep.not_a_truth_value === true, 'service assessTrust returns the trust report');
  // fail-closed at open: a broken trust model refuses the whole service
  const dir = tmpRoot();
  fs.writeFileSync(path.join(dir, 'tm.json'), '{"format":"othk-trust-model","classes":{}}');
  expectError(() => service.openService(ROOT, { trustModelConfig: path.join(dir, 'tm.json') }), /OTHK_TRUST_CONFIG/, 'service open fails closed on a defective trust model');
}

console.log('§12 executor wiring — allowlist, asOf guard, no write leak');
{
  const k = execKnowledge.openKnowledge({ config: { enabled: true, store_root: ROOT, description: 'othk-3 test store' } });
  ok(k.enabled === true && typeof k.ops.assessTrust === 'function', 'assessTrust reachable through the executor allowlist');
  expectError(() => k.ops.assessTrust(ownerFact.id, {}), /MYTHOS_KNOWLEDGE_ASOF/, 'executor refuses assessTrust without asOf independently of the service');
  const rep = k.ops.assessTrust(ownerFact.id, { asOf: ASOF });
  ok(rep.trust_summary && rep.not_a_truth_value === true, 'executor-side trust report carries not_a_truth_value');
  ok(execKnowledge.READ_OPS.indexOf('assessTrust') !== -1, 'assessTrust is an explicit allowlist entry');
  ok(Object.keys(k.ops).every((n) => execKnowledge.READ_OPS.indexOf(n) !== -1), 'no op outside the allowlist is exposed');
}

console.log('');
console.log('othk-3: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
