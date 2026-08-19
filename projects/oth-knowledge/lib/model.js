// =====================================================
// OTH Knowledge — canonical knowledge model
// projects/oth-knowledge/lib/model.js
//
// Closed record-kind enum + fail-closed validation. A record that does
// not validate is never written. See docs/OTH_KNOWLEDGE_ARCHITECTURE.md §3.
// =====================================================
'use strict';

const ids = require('./ids.js');

const KINDS = Object.freeze([
  'source', 'artifact', 'document', 'chunk', 'entity', 'fact', 'claim',
  'observation', 'event', 'relationship', 'evidence', 'derived',
]);

const CONFIDENCE = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'EXPLICIT']);

const RESOLUTION_STATES = Object.freeze(['open', 'resolved', 'superseded', 'coexisting']);

// ISO-8601 UTC timestamp check (strict enough to refuse garbage).
function isIsoTimestamp(v) {
  if (typeof v !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2}))?$/.test(v)) return false;
  const t = Date.parse(v.length === 10 ? v + 'T00:00:00Z' : v);
  return Number.isFinite(t) && t > Date.parse('1970-01-01') && t < Date.parse('2100-01-01');
}

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function requireString(rec, field, max) {
  const v = rec[field];
  if (typeof v !== 'string' || !v.trim()) throw fail('OTHK_MODEL_FIELD', rec.kind + ' requires string ' + field);
  if (v.includes('\u0000')) throw fail('OTHK_MODEL_FIELD', field + ' contains NUL');
  if (max && v.length > max) throw fail('OTHK_MODEL_FIELD', field + ' exceeds ' + max + ' chars');
}

// Provenance is mandatory on every knowledge-bearing record.
const PROVENANCE_REQUIRED = Object.freeze([
  'artifact', 'document', 'chunk', 'fact', 'claim', 'observation', 'event', 'derived',
]);

function validateProvenance(prov, kind) {
  if (!isPlainObject(prov)) throw fail('OTHK_MODEL_PROVENANCE', kind + ' requires a provenance object');
  for (const f of ['source_class', 'source_reference', 'captured_at']) {
    if (typeof prov[f] !== 'string' || !prov[f]) throw fail('OTHK_MODEL_PROVENANCE', 'provenance.' + f + ' required');
  }
  if (!isIsoTimestamp(prov.captured_at)) throw fail('OTHK_MODEL_PROVENANCE', 'provenance.captured_at invalid timestamp');
  if (prov.observed_at !== undefined && prov.observed_at !== null && !isIsoTimestamp(prov.observed_at)) {
    throw fail('OTHK_MODEL_PROVENANCE', 'provenance.observed_at invalid timestamp');
  }
  if (prov.confidence !== undefined && CONFIDENCE.indexOf(prov.confidence) === -1) {
    throw fail('OTHK_MODEL_PROVENANCE', 'provenance.confidence must be one of ' + CONFIDENCE.join('/'));
  }
}

// Per-kind structural requirements beyond the common envelope.
const KIND_RULES = {
  source(rec) { requireString(rec, 'source_class'); requireString(rec, 'title', 500); },
  artifact(rec) {
    if (!ids.isContentRef(rec.content_ref)) throw fail('OTHK_MODEL_FIELD', 'artifact.content_ref must be an othk content reference');
    requireString(rec, 'filename', 500);
    if (!Number.isInteger(rec.byte_size) || rec.byte_size < 0) throw fail('OTHK_MODEL_FIELD', 'artifact.byte_size must be a non-negative integer');
  },
  document(rec) { requireString(rec, 'artifact_id'); requireString(rec, 'text'); requireString(rec, 'media_type', 100); },
  chunk(rec) {
    requireString(rec, 'document_id'); requireString(rec, 'text', 20000);
    if (!Number.isInteger(rec.position) || rec.position < 0) throw fail('OTHK_MODEL_FIELD', 'chunk.position must be a non-negative integer');
  },
  entity(rec) { requireString(rec, 'entity_type', 100); requireString(rec, 'name', 500); },
  fact(rec) { requireString(rec, 'statement', 4000); if (CONFIDENCE.indexOf(rec.confidence) === -1) throw fail('OTHK_MODEL_FIELD', 'fact.confidence required (' + CONFIDENCE.join('/') + ')'); },
  claim(rec) { requireString(rec, 'statement', 4000); requireString(rec, 'asserted_by', 500); },
  observation(rec) {
    requireString(rec, 'statement', 4000);
    if (!isIsoTimestamp(rec.observed_at)) throw fail('OTHK_MODEL_FIELD', 'observation.observed_at required valid timestamp');
  },
  event(rec) {
    requireString(rec, 'title', 500);
    if (!isIsoTimestamp(rec.occurred_at)) throw fail('OTHK_MODEL_FIELD', 'event.occurred_at required valid timestamp');
  },
  relationship(rec) {
    requireString(rec, 'rel_type', 100); requireString(rec, 'from_id'); requireString(rec, 'to_id');
    if (rec.rel_type === 'conflicts_with' && RESOLUTION_STATES.indexOf(rec.resolution_state) === -1) {
      throw fail('OTHK_MODEL_FIELD', 'conflicts_with requires resolution_state ∈ ' + RESOLUTION_STATES.join('/'));
    }
  },
  evidence(rec) {
    requireString(rec, 'supports_id');
    if (!Array.isArray(rec.evidence_ids) || rec.evidence_ids.length === 0 || !rec.evidence_ids.every((x) => typeof x === 'string' && x)) {
      throw fail('OTHK_MODEL_FIELD', 'evidence.evidence_ids must be a non-empty string array');
    }
  },
  derived(rec) {
    requireString(rec, 'text');
    requireString(rec, 'derivation', 200); // e.g. 'summary', 'extraction'
    if (!Array.isArray(rec.derived_from) || rec.derived_from.length === 0) {
      throw fail('OTHK_MODEL_FIELD', 'derived.derived_from must name its source records — a derived record is never an original fact');
    }
  },
};

// Validates the full record envelope; returns the record on success.
function validateRecord(rec) {
  if (!isPlainObject(rec)) throw fail('OTHK_MODEL_RECORD', 'record must be a plain object');
  if (KINDS.indexOf(rec.kind) === -1) throw fail('OTHK_MODEL_KIND', 'unknown kind: ' + String(rec.kind).slice(0, 50));
  if (typeof rec.id !== 'string' || rec.id.indexOf(rec.kind + '-') !== 0) throw fail('OTHK_MODEL_RECORD', 'id must start with kind prefix');
  if (rec.metadata !== undefined && !isPlainObject(rec.metadata)) throw fail('OTHK_MODEL_FIELD', 'metadata must be a plain object');
  if (rec.tags !== undefined && (!Array.isArray(rec.tags) || !rec.tags.every((t) => typeof t === 'string' && t))) {
    throw fail('OTHK_MODEL_FIELD', 'tags must be a string array');
  }
  if (rec.entity_ids !== undefined && (!Array.isArray(rec.entity_ids) || !rec.entity_ids.every((t) => typeof t === 'string' && t))) {
    throw fail('OTHK_MODEL_FIELD', 'entity_ids must be a string array');
  }
  if (PROVENANCE_REQUIRED.indexOf(rec.kind) !== -1) validateProvenance(rec.provenance, rec.kind);
  KIND_RULES[rec.kind](rec);
  return rec;
}

module.exports = { KINDS, CONFIDENCE, RESOLUTION_STATES, PROVENANCE_REQUIRED, isIsoTimestamp, validateRecord, isPlainObject };
