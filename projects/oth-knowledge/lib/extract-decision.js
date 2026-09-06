// =====================================================
// OTH Knowledge — memory extraction decision (Phase 7)
// projects/oth-knowledge/lib/extract-decision.js
//
// Given CANDIDATE durable knowledge (proposed by an external extractor —
// the engine itself never calls an LLM), decide deterministically what to
// do relative to existing memory:
//
//   ADD      — genuinely new → append a new record
//   UPDATE   — same subject+property, strictly later validity → append a
//              new record AND close the old one's validity (valid_to =
//              new valid_from) + a `supersedes` link. Never overwrites.
//   NOOP     — already present (near-duplicate) → keep existing, write
//              nothing durable
//   CONFLICT — same subject+property, overlapping validity, different
//              value → store the competing record AND register a
//              conflicts_with (both live, resolution open — no winner)
//
// decide()/decideMany() are PURE (no writes). applyDecisions() is the
// single controlled writer and it runs the promotion gate on every
// candidate first: AI proposes, the gate decides, only then OTHKM writes.
// =====================================================
'use strict';

const dedup = require('./dedup.js');
const contradiction = require('./contradiction.js');
const conflict = require('./conflict.js');
const temporal = require('./temporal.js');
const extract = require('./extract.js');
const gateLib = require('./promotion-gate.js');
const namespace = require('./namespace.js');
const ids = require('./ids.js');

const STATEMENT_KINDS = ['fact', 'claim', 'observation'];

function candText(c) { return c.statement || c.title || ''; }
function candSubject(c) { return Array.isArray(c.entity_ids) && c.entity_ids.length ? c.entity_ids[0] : null; }
function candProperty(c) { return c.metadata && typeof c.metadata.property === 'string' ? c.metadata.property : null; }
function candValue(c) { return c.metadata && c.metadata.value !== undefined ? c.metadata.value : null; }

// Existing live statements in the candidate's namespace.
function peers(store, cand) {
  const ns = cand.namespace || namespace.GLOBAL;
  return store.allRecords({ where: (r) => STATEMENT_KINDS.indexOf(r.kind) !== -1 && namespace.namespaceOf(r) === ns });
}

function decide(store, cand, opts) {
  const candSh = dedup.shingles(candText(cand));
  const subj = candSubject(cand), prop = candProperty(cand);
  let bestDup = { id: null, sim: 0 };
  let structuralMatch = null; // existing record with same subject+property

  for (const r of peers(store, cand)) {
    // near-duplicate (lexical)
    const sim = dedup.jaccard(candSh, dedup.shingles(r.statement || r.title || ''));
    if (sim > bestDup.sim) bestDup = { id: r.id, sim: +sim.toFixed(4) };
    // structural subject+property match
    if (subj && prop && contradiction.subjectOf(r) === subj && contradiction.propertyOf(r) === prop) {
      structuralMatch = r;
    }
  }

  if (bestDup.sim >= dedup.DUPLICATE_THRESHOLD) {
    return { action: 'NOOP', candidate: cand, dup_of: bestDup.id, similarity: bestDup.sim };
  }

  if (structuralMatch) {
    const sameValue = JSON.stringify(candValue(cand)) === JSON.stringify(contradiction.valueOf(structuralMatch));
    if (sameValue) return { action: 'NOOP', candidate: cand, dup_of: structuralMatch.id, similarity: bestDup.sim };
    // Different value for the same subject+property. Distinguish temporal
    // SUCCESSION (the world changed → UPDATE) from same-period COMPETING
    // claims (→ CONFLICT). Succession requires the candidate to start
    // strictly later AND the existing record to NOT explicitly claim
    // validity through the candidate's start (open-ended, or already ended
    // by then). An explicit overlap is a genuine contradiction.
    const cFrom = cand.valid_from ? Date.parse(cand.valid_from) : null;
    const eFrom = structuralMatch.valid_from ? Date.parse(structuralMatch.valid_from) : null;
    const eTo = structuralMatch.valid_to ? Date.parse(structuralMatch.valid_to) : null;
    const laterStart = cFrom !== null && eFrom !== null && cFrom > eFrom;
    const oldClaimsThrough = eTo !== null && eTo > cFrom; // explicit end after new start
    if (laterStart && !oldClaimsThrough) {
      return { action: 'UPDATE', candidate: cand, supersede_of: structuralMatch.id };
    }
    return { action: 'CONFLICT', candidate: cand, conflict_with: structuralMatch.id };
  }

  return { action: 'ADD', candidate: cand };
}

function decideMany(store, candidates, opts) {
  return (candidates || []).map((c) => decide(store, c, opts));
}

// ---- controlled writer ----------------------------------------------------
function buildRecord(store, classes, cand) {
  const base = {
    prov: cand.provenance,
    entity_ids: cand.entity_ids, tags: cand.tags, metadata: cand.metadata,
    namespace: cand.namespace, valid_from: cand.valid_from, valid_to: cand.valid_to,
  };
  if (cand.kind === 'claim') return extract.addClaim(store, classes, Object.assign({ statement: cand.statement, asserted_by: cand.asserted_by || 'proposer' }, base));
  if (cand.kind === 'fact') return extract.addFact(store, classes, Object.assign({ statement: cand.statement, confidence: cand.confidence || 'LOW' }, base));
  if (cand.kind === 'observation') return extract.addObservation(store, classes, Object.assign({ statement: cand.statement, observed_at: cand.observed_at || (cand.provenance && cand.provenance.observed_at) || cand.provenance.captured_at }, base));
  throw new Error('OTHK_DECISION_KIND: unsupported candidate kind ' + cand.kind);
}

// Close the event-time validity of the superseded record (append a new
// VERSION with valid_to set — invalidate, never delete) and link supersession.
function closeAndLink(store, newRec, oldId, decidedAt) {
  const old = store.getRecord(oldId);
  if (!old) return;
  const validTo = temporal.suggestValidTo(newRec, old);
  if (validTo && old.valid_to !== validTo) {
    const closed = Object.assign({}, old, { valid_to: validTo });
    store.appendRecord(closed, { allowNewVersion: true });
  }
  const rel = {
    kind: 'relationship',
    id: ids.recordId('relationship', 'supersedes/' + newRec.id + '~' + oldId),
    rel_type: 'supersedes', from_id: newRec.id, to_id: oldId,
    metadata: { decided_at: decidedAt, basis: 'later validity, same subject+property' },
  };
  if (!store.getRecord(rel.id)) store.appendRecord(rel);
}

// applyDecisions(store, decisions, {classes, trustModel, decided_by, decided_at})
function applyDecisions(store, decisions, opts) {
  const o = opts || {};
  const classes = o.classes;
  const decidedAt = o.decided_at || new Date().toISOString();
  const applied = [], rejected = [];
  for (const d of decisions) {
    const g = gateLib.gate(d.candidate, { classes, trustModel: o.trustModel });
    if (!g.ok) { rejected.push({ action: d.action, reasons: g.reasons, candidate_text: candText(d.candidate).slice(0, 120) }); continue; }
    if (d.action === 'NOOP') { applied.push({ action: 'NOOP', dup_of: d.dup_of }); continue; }
    const rec = buildRecord(store, classes, d.candidate);
    if (d.action === 'ADD') { applied.push({ action: 'ADD', id: rec.id, tier: g.tier }); continue; }
    if (d.action === 'UPDATE') { closeAndLink(store, rec, d.supersede_of, decidedAt); applied.push({ action: 'UPDATE', id: rec.id, supersede_of: d.supersede_of }); continue; }
    if (d.action === 'CONFLICT') {
      if (STATEMENT_KINDS.indexOf(rec.kind) !== -1 && store.getRecord(d.conflict_with)) {
        conflict.registerConflict(store, rec.id, d.conflict_with, 'auto-detected: same subject+property, overlapping validity, different value');
      }
      applied.push({ action: 'CONFLICT', id: rec.id, conflict_with: d.conflict_with });
      continue;
    }
  }
  return { applied, rejected };
}

module.exports = { decide, decideMany, applyDecisions, buildRecord, STATEMENT_KINDS };
