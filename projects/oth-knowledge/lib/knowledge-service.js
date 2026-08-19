// =====================================================
// OTH Knowledge — knowledge service boundary
// projects/oth-knowledge/lib/knowledge-service.js
//
// The single integration surface the Mythos AI Operating Layer (or any
// other consumer) uses. Provider-neutral by construction: plain
// functions over a store handle — no AI provider, no network, no
// credentials, no provider-specific types anywhere in this module. The
// Operating Layer CONSUMES knowledge through these operations; it never
// owns or mutates the knowledge database directly.
// =====================================================
'use strict';

const storeLib = require('./store.js');
const provenanceLib = require('./provenance.js');
const searchLib = require('./search.js');
const temporal = require('./temporal.js');
const conflictLib = require('./conflict.js');
const auditLib = require('./audit.js');

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

// Opens a read-oriented service over a store root. Write operations are
// deliberately absent from this surface: ingestion/curation go through
// the importer/CLI paths, not through AI-layer calls.
function openService(root, opts) {
  const store = storeLib.openStore(root);
  provenanceLib.loadSourceClasses(opts && opts.sourceClassConfig); // fail-closed registry check at open
  let index = null;
  const getIndex = () => {
    if (!index) index = searchLib.buildIndex(store, { embedder: opts && opts.embedder });
    return index;
  };

  return {
    // search(query, {mode, filters, limit}) → hits with provenance
    search(query, o) { return searchLib.search(getIndex(), query, o); },

    // retrieve(id) → { record, versions, deleted }
    retrieve(id) {
      const versions = store.getVersions(id);
      if (!versions.length) return null;
      return { record: store.getRecord(id), versions: versions.map((v) => ({ version: v.version, written_at: v.written_at, deleted: v.deleted })), deleted: store.getRecord(id) === null };
    },

    // lookupEntity(name) → entities matching the folded name + linked records
    lookupEntity(name) {
      const norm = searchLib.tokenize(String(name)).join(' ');
      if (!norm) throw fail('OTHK_SERVICE_INPUT', 'entity name required');
      const entities = store.allRecords({ kind: 'entity', where: (e) => searchLib.tokenize(e.name).join(' ') === norm });
      return entities.map((e) => ({
        entity: e,
        linked: store.allRecords({ where: (r) => Array.isArray(r.entity_ids) && r.entity_ids.indexOf(e.id) !== -1 }).map((r) => r.id),
      }));
    },

    // lookupEvidence(id) → the evidence chain for a fact/claim
    lookupEvidence(id) {
      const rec = store.getRecord(id);
      if (!rec) return null;
      const links = store.allRecords({ kind: 'evidence', where: (r) => r.supports_id === id });
      return links.map((l) => ({
        evidence_id: l.id,
        note: l.metadata && l.metadata.note,
        records: l.evidence_ids.map((eid) => store.getRecord(eid)).filter(Boolean),
      }));
    },

    // lookupHistory(id) → full version history including tombstones
    lookupHistory(id) { return store.getVersions(id); },

    // lookupProvenance(id) → provenance + artifact availability
    lookupProvenance(id) {
      const rec = store.getRecord(id);
      if (!rec || !rec.provenance) return rec ? { provenance: null } : null;
      return {
        provenance: rec.provenance,
        artifact_available: rec.provenance.artifact_ref ? store.hasObject(rec.provenance.artifact_ref) : null,
        lineage: rec.metadata ? {
          importer: rec.metadata.importer || null,
          parser_version: rec.metadata.parser_version || null,
          normalizer_version: rec.metadata.normalizer_version || null,
          assertion_class: auditLib.assertionClassOf(rec),
        } : null,
      };
    },

    // findContradictions({state?, entity_id?}) → conflict records with both sides
    findContradictions(o) {
      const conflicts = conflictLib.listConflicts(store, o && o.state ? { state: o.state } : undefined);
      return conflicts
        .map((rel) => ({ relationship: rel, a: store.getRecord(rel.from_id), b: store.getRecord(rel.to_id) }))
        .filter((c) => !o || !o.entity_id ||
          (c.a && Array.isArray(c.a.entity_ids) && c.a.entity_ids.indexOf(o.entity_id) !== -1) ||
          (c.b && Array.isArray(c.b.entity_ids) && c.b.entity_ids.indexOf(o.entity_id) !== -1));
    },

    // currentState({asOf, tag?}) → current vs superseded vs planned view
    currentState(o) {
      if (!o || !o.asOf) throw fail('OTHK_SERVICE_INPUT', 'asOf required — the service never reads the wall clock');
      const known = temporal.knownAt(store, o.asOf)
        .filter((r) => !o.tag || (Array.isArray(r.tags) && r.tags.indexOf(o.tag) !== -1));
      return {
        as_of: o.asOf,
        known: known.map((r) => ({ id: r.id, kind: r.kind, truth_time: temporal.truthTimeOf(r), classification: temporal.classify(store, r, { asOf: o.asOf }) })),
        latest_verified: temporal.latestVerified(store, { tag: o && o.tag }).slice(0, 10).map((r) => r.id),
        open_contradictions: conflictLib.listConflicts(store, { state: 'open' }).map((r) => r.id),
      };
    },

    // audit() → provenance audit report (read-only, no quarantine writes)
    audit() { return auditLib.provenanceAudit(store); },

    stats() { return store.stats(); },
  };
}

module.exports = { openService };
