// =====================================================
// OTH Knowledge — knowledge record construction
// projects/oth-knowledge/lib/extract.js
//
// Helpers to create entities, facts, claims, observations, events,
// relationships, evidence and derived records with mandatory
// traceability. Extraction here is structural (from explicitly
// structured seed/records), never invention: a derived record always
// names what it derives from.
// =====================================================
'use strict';

const ids = require('./ids.js');
const provenance = require('./provenance.js');

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

function put(store, rec, allowNewVersion) {
  const existing = store.getRecord(rec.id);
  if (existing && JSON.stringify(existing) === JSON.stringify(rec)) return existing;
  store.appendRecord(rec, existing ? { allowNewVersion: true } : (allowNewVersion ? { allowNewVersion: true } : undefined));
  return rec;
}

function addEntity(store, { entity_type, name, metadata }) {
  return put(store, {
    kind: 'entity',
    id: ids.recordId('entity', entity_type + '/' + name.toLowerCase()),
    entity_type, name, metadata: metadata || {},
  });
}

// Builds provenance AND guarantees the (class, collection) source record
// exists, so no extraction path can create orphaned provenance.
function makeProv(store, classes, prov) {
  provenance.ensureSource(store, classes, prov.source_class, prov.source_collection);
  return provenance.buildProvenance(classes, prov);
}

function addFact(store, classes, { statement, confidence, prov, entity_ids, tags, metadata }) {
  return put(store, {
    kind: 'fact',
    id: ids.recordId('fact', prov.source_class + '/' + statement),
    statement, confidence,
    provenance: makeProv(store, classes, prov),
    entity_ids: entity_ids || [], tags: tags || [], metadata: metadata || {},
  });
}

function addClaim(store, classes, { statement, asserted_by, prov, entity_ids, tags }) {
  return put(store, {
    kind: 'claim',
    id: ids.recordId('claim', prov.source_class + '/' + asserted_by + '/' + statement),
    statement, asserted_by,
    provenance: makeProv(store, classes, prov),
    entity_ids: entity_ids || [], tags: tags || [],
  });
}

function addObservation(store, classes, { statement, observed_at, prov, entity_ids, tags, metadata }) {
  return put(store, {
    kind: 'observation',
    id: ids.recordId('observation', prov.source_class + '/' + observed_at + '/' + statement),
    statement, observed_at,
    provenance: makeProv(store, classes, prov),
    entity_ids: entity_ids || [], tags: tags || [], metadata: metadata || {},
  });
}

// `key`: optional caller-supplied identity discriminator. Importers pass
// their per-entry source reference so two distinct entries sharing a
// title and timestamp never collapse into one id (and re-imports stay
// idempotent); without it, identity falls back to class/time/title.
function addEvent(store, classes, { title, occurred_at, prov, entity_ids, tags, metadata, key }) {
  return put(store, {
    kind: 'event',
    id: ids.recordId('event', key ? prov.source_class + '/key/' + key : prov.source_class + '/' + occurred_at + '/' + title),
    title, occurred_at,
    provenance: makeProv(store, classes, prov),
    entity_ids: entity_ids || [], tags: tags || [], metadata: metadata || {},
  });
}

function addRelationship(store, { rel_type, from_id, to_id, metadata }) {
  if (rel_type === 'conflicts_with') throw fail('OTHK_EXTRACT_INPUT', 'use conflict.registerConflict for conflicts');
  for (const rid of [from_id, to_id]) if (!store.getRecord(rid)) throw fail('OTHK_EXTRACT_ORPHAN', 'unknown record ' + rid);
  return put(store, {
    kind: 'relationship',
    id: ids.recordId('relationship', rel_type + '/' + from_id + '/' + to_id),
    rel_type, from_id, to_id, metadata: metadata || {},
  });
}

// Links a fact/claim to the records that support it (traceability).
function addEvidence(store, { supports_id, evidence_ids, note }) {
  if (!store.getRecord(supports_id)) throw fail('OTHK_EXTRACT_ORPHAN', 'unknown record ' + supports_id);
  for (const rid of evidence_ids) if (!store.getRecord(rid)) throw fail('OTHK_EXTRACT_ORPHAN', 'unknown evidence record ' + rid);
  return put(store, {
    kind: 'evidence',
    id: ids.recordId('evidence', supports_id + '/' + evidence_ids.slice().sort().join(',')),
    supports_id, evidence_ids,
    metadata: { note: typeof note === 'string' ? note.slice(0, 1000) : '' },
  });
}

// A derived record (summary/extraction) — never an original fact.
function addDerived(store, classes, { text, derivation, derived_from, prov, tags }) {
  for (const rid of derived_from) if (!store.getRecord(rid)) throw fail('OTHK_EXTRACT_ORPHAN', 'unknown derivation source ' + rid);
  return put(store, {
    kind: 'derived',
    id: ids.recordId('derived', derivation + '/' + derived_from.slice().sort().join(',')),
    text, derivation, derived_from,
    provenance: makeProv(store, classes, prov),
    tags: tags || [],
  });
}

module.exports = { addEntity, addFact, addClaim, addObservation, addEvent, addRelationship, addEvidence, addDerived };
