// =====================================================
// OTH Knowledge — provenance audit
// projects/oth-knowledge/lib/audit.js
//
// For every retrievable knowledge item, verifies the Phase-10 questions:
// original source identifiable? artifact identifiable and present?
// evidence identifiable (facts)? import time known? parser/normalizer
// versions recorded for imported records? observation distinguishable
// from inference (assertion_class)? Failing items are reported and can
// be explicitly quarantined (a new tagged version — never a rewrite).
// =====================================================
'use strict';



const AUDITED_KINDS = ['chunk', 'fact', 'claim', 'observation', 'event', 'derived', 'document', 'artifact'];
const ASSERTION_CLASSES = ['OBSERVED', 'EXTRACTED', 'DERIVED', 'INFERRED'];

function assertionClassOf(rec) {
  if (rec.metadata && ASSERTION_CLASSES.indexOf(rec.metadata.assertion_class) !== -1) return rec.metadata.assertion_class;
  if (Array.isArray(rec.tags)) for (const c of ASSERTION_CLASSES) if (rec.tags.indexOf(c) !== -1) return c;
  if (rec.kind === 'derived') return 'DERIVED';
  if (rec.kind === 'observation') return 'OBSERVED';
  return null;
}

function provenanceAudit(store, opts) {
  const o = opts || {};
  const sourcesByClass = new Map();
  for (const s of store.allRecords({ kind: 'source' })) {
    const key = s.source_class + '/' + (s.metadata && s.metadata.collection || 'default');
    sourcesByClass.set(key, s);
  }
  const liveIds = new Set(store.allRecords().map((r) => r.id));
  const findings = [];
  const warnings = []; // retrievable but flagged — not provenance failures
  let audited = 0;

  for (const rec of store.allRecords()) {
    if (AUDITED_KINDS.indexOf(rec.kind) === -1) continue;
    audited++;
    const problems = [];
    const prov = rec.provenance;

    if (!prov) problems.push('no provenance object');
    else {
      // 1. original source identifiable
      const key = prov.source_class + '/' + (prov.source_collection || 'default');
      if (!sourcesByClass.has(key)) problems.push('source record missing for ' + key);
      if (!prov.source_reference) problems.push('no source_reference');
      // 2. artifact identifiable and present
      if (prov.artifact_ref && !store.hasObject(prov.artifact_ref)) problems.push('artifact object missing ' + prov.artifact_ref);
      // 4. import time known
      if (!prov.captured_at) problems.push('no captured_at (import time unknown)');
    }
    // 2b. structural artifact linkage
    if (rec.kind === 'document' && !liveIds.has(rec.artifact_id)) problems.push('document artifact record missing');
    if (rec.kind === 'chunk' && !liveIds.has(rec.document_id)) problems.push('chunk document missing');
    // 3. evidence identifiable — a fact without evidence links is a
    // WARNING unless it carries EXPLICIT provenance confidence (a
    // first-party statement is its own evidence); manually-entered
    // facts stay retrievable but flagged.
    if (rec.kind === 'fact') {
      const ev = store.allRecords({ kind: 'evidence', where: (r) => r.supports_id === rec.id });
      if (ev.length === 0 && !(rec.provenance && rec.provenance.confidence === 'EXPLICIT')) {
        warnings.push({ id: rec.id, kind: rec.kind, warning: 'fact without evidence links (non-EXPLICIT)' });
      }
    }
    // 5. parser/normalizer versions for imported records
    const imported = rec.metadata && (rec.metadata.importer || rec.metadata.parser_version);
    if (rec.kind === 'artifact' && !(rec.metadata && rec.metadata.parser_version && rec.metadata.normalizer_version)) {
      problems.push('artifact without parser/normalizer versions');
    }
    if (imported && rec.kind !== 'artifact' && rec.metadata && !rec.metadata.parser_version) {
      problems.push('imported record without parser_version');
    }
    // 6. observation vs inference distinguishable
    if (['fact', 'claim', 'observation', 'event', 'derived'].indexOf(rec.kind) !== -1) {
      if (!assertionClassOf(rec) && rec.kind !== 'fact' && rec.kind !== 'claim') {
        problems.push('assertion class indeterminable');
      }
    }
    if (problems.length) findings.push({ id: rec.id, kind: rec.kind, problems });
  }

  const report = { audited, failing: findings.length, findings, warnings, ok: findings.length === 0 };
  if (o.quarantine && findings.length) {
    report.quarantined = findings.map((f) => quarantine(store, f.id, f.problems.join('; ')));
  }
  return report;
}

// Marks a record quarantined via a new tagged version — history intact.
function quarantine(store, id, reason) {
  const rec = store.getRecord(id);
  if (!rec) return null;
  // Idempotent: re-auditing a still-failing record must not grow history.
  if (Array.isArray(rec.tags) && rec.tags.indexOf('quarantined') !== -1 &&
      rec.metadata && rec.metadata.quarantine_reason === String(reason).slice(0, 500)) {
    return id;
  }
  const next = JSON.parse(JSON.stringify(rec));
  next.tags = Array.from(new Set([...(next.tags || []), 'quarantined']));
  next.metadata = Object.assign({}, next.metadata || {}, { quarantine_reason: String(reason).slice(0, 500) });
  store.appendRecord(next, { allowNewVersion: true });
  return id;
}

// Retrieval-time provenance correctness check: every search hit must be
// traceable end to end. Used by the evaluation suite.
function auditHits(store, hits) {
  const failures = [];
  for (const h of hits) {
    const rec = store.getRecord(h.id);
    if (!rec) { failures.push({ id: h.id, problem: 'hit not in store' }); continue; }
    if (rec.provenance) {
      if (!h.provenance || h.provenance.source_class !== rec.provenance.source_class) {
        failures.push({ id: h.id, problem: 'hit provenance mismatch' });
      }
      if (rec.provenance.artifact_ref && !store.hasObject(rec.provenance.artifact_ref)) {
        failures.push({ id: h.id, problem: 'artifact bytes missing' });
      }
    }
  }
  return { ok: failures.length === 0, failures, checked: hits.length };
}

module.exports = { AUDITED_KINDS, ASSERTION_CLASSES, assertionClassOf, provenanceAudit, quarantine, auditHits };
