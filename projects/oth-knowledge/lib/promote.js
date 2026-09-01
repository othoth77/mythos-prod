// =====================================================
// OTH Knowledge — extraction-run promotion
// projects/oth-knowledge/lib/promote.js
//
// Moves a completed extraction run's record graph into the canonical
// store, operator-only, offline. Not a second persistence mechanism:
// every write goes through store.js's existing appendRecord()/putObject(),
// which are already idempotent by id and by content hash. This module
// adds only what those primitives do not already provide — referential
// closure across the incoming graph, and a fail-closed conflict check —
// and it adds nothing else.
//
// Two-phase by construction: planPromotion() is pure analysis (never
// writes) and is the SAME function promoteRun() calls before making a
// single write, so "what dry-run reports" and "what promotion enforces"
// cannot drift apart. Because the full graph is validated before any
// write happens, a refusal never leaves a partial promotion behind.
// =====================================================
'use strict';

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

// The exact reference fields store.js's own verify() already enumerates
// (document->artifact_id, chunk->document_id, relationship->from_id/to_id,
// evidence->supports_id+evidence_ids, derived->derived_from), extended with
// entity_ids: model.js validates its SHAPE on any record but verify() never
// checks it referentially. Promotion imports a graph from outside the
// store's own history, so that graph's cross-record identity must be
// self-consistent before anything is written -- checked here, once.
function refsOf(rec) {
  const refs = [];
  if (rec.kind === 'document') refs.push(rec.artifact_id);
  if (rec.kind === 'chunk') refs.push(rec.document_id);
  if (rec.kind === 'relationship') refs.push(rec.from_id, rec.to_id);
  if (rec.kind === 'evidence') refs.push(rec.supports_id, ...rec.evidence_ids);
  if (rec.kind === 'derived') refs.push(...rec.derived_from);
  if (Array.isArray(rec.entity_ids)) refs.push(...rec.entity_ids);
  return refs;
}

// written_at (and the envelope's seq/version/supersedes/deleted) are
// store-local bookkeeping, not semantic content: a claim promoted twice is
// the same claim even though each store wrote it at a different instant.
// Comparing RECORD payloads only is what "identical, excluding non-semantic
// timestamps" means in practice.
function sameContent(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Explicit seq order rather than relying on Map iteration order: robust
// even if allRecords()'s internal ordering ever changes, and it is what
// actually proves "dependency order preserved" rather than assuming it.
function seqOrdered(store) {
  return store.allRecords()
    .map((rec) => {
      const versions = store.getVersions(rec.id);
      return { rec, seq: versions[versions.length - 1].seq };
    })
    .sort((a, b) => a.seq - b.seq)
    .map((x) => x.rec);
}

// Read-only. Verifies the run store, walks its graph in dependency order,
// and classifies every record as fresh / already-promoted (identical) /
// conflicting. Never writes to either store. Throws on the first
// structural problem it cannot recover from; a conflict is not resolved
// by silence, it is refused.
function planPromotion(runStore, canonicalStore) {
  const runVerify = runStore.verify();
  if (!runVerify.ok) {
    throw fail('OTHK_PROMOTE_INVALID_RUN',
      'the run store failed verification: ' + JSON.stringify(runVerify.problems));
  }

  const ordered = seqOrdered(runStore);
  const resolved = new Set(); // ids resolvable so far: canonical union earlier-in-batch
  const danglingRefs = [];
  const conflicts = [];
  const fresh = [];
  const identical = [];

  for (const rec of ordered) {
    for (const ref of refsOf(rec)) {
      if (canonicalStore.getRecord(ref) === null && !resolved.has(ref)) {
        danglingRefs.push(rec.id + ' -> ' + ref);
      }
    }
    const existing = canonicalStore.getRecord(rec.id);
    if (existing === null) fresh.push(rec);
    else if (sameContent(existing, rec)) identical.push(rec);
    else conflicts.push(rec.id);
    resolved.add(rec.id);
  }

  if (danglingRefs.length) {
    throw fail('OTHK_PROMOTE_DANGLING_REF',
      danglingRefs.length + ' reference(s) resolve in neither canonical storage nor an earlier record of this batch: '
      + danglingRefs.join('; '));
  }
  if (conflicts.length) {
    throw fail('OTHK_PROMOTE_CONFLICT',
      conflicts.length + ' record id(s) already exist in canonical storage with different content, and are never overwritten: '
      + conflicts.join(', '));
  }

  const blobs = fresh
    .filter((r) => r.kind === 'artifact' && r.content_ref)
    .map((r) => r.content_ref);

  return { ordered, fresh, identical, blobs };
}

// Writes. Re-runs planPromotion() first (so a caller can never promote
// without the same checks dry-run performs), then copies artifact blobs
// (content-addressed, already deduplicated by store.putObject) and appends
// every fresh record in dependency order via the store's own
// appendRecord() -- never with allowNewVersion, so an accidental overwrite
// of an existing canonical record is refused by store.js itself, not by
// a promise made here. Identical records are skipped, not re-written.
function promoteRun(runStore, canonicalStore, opts) {
  opts = opts || {};
  const plan = planPromotion(runStore, canonicalStore);

  if (opts.dryRun) {
    return {
      dry_run: true,
      would_add: plan.fresh.length,
      already_promoted: plan.identical.length,
      blobs_to_copy: plan.blobs.filter((ref) => !canonicalStore.hasObject(ref)).length,
      record_ids: plan.fresh.map((r) => r.id),
    };
  }

  const before = canonicalStore.stats();
  const added = [];

  try {
    for (const ref of plan.blobs) {
      if (!canonicalStore.hasObject(ref)) canonicalStore.putObject(runStore.getObject(ref));
    }
    for (const rec of plan.fresh) {
      const res = canonicalStore.appendRecord(rec);
      if (res.created) added.push(rec.id);
    }
  } catch (e) {
    if (e.code && e.code.indexOf('OTHK_PROMOTE_') === 0) throw e;
    throw fail('OTHK_PROMOTE_WRITE_FAILED', 'writing to canonical storage failed: ' + e.message);
  }

  const after = canonicalStore.stats();

  const postVerify = canonicalStore.verify();
  if (!postVerify.ok) {
    throw fail('OTHK_PROMOTE_POSTFLIGHT_FAILED',
      'canonical storage failed verification after promotion: ' + JSON.stringify(postVerify.problems));
  }

  return {
    dry_run: false,
    added: added.length,
    already_promoted: plan.identical.length,
    record_ids: added,
    before,
    after,
  };
}

module.exports = { refsOf, sameContent, planPromotion, promoteRun };
