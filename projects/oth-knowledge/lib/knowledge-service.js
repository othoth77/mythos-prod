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
const trustLib = require('./trust.js');
const retrieveLib = require('./retrieve.js');
const graphLib = require('./graph.js');
const contextLib = require('./context.js');

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

// Opens a read-oriented service over a store root. Write operations are
// deliberately absent from this surface: ingestion/curation go through
// the importer/CLI paths, not through AI-layer calls.
function openService(root, opts) {
  const store = storeLib.openStore(root);
  const classes = provenanceLib.loadSourceClasses(opts && opts.sourceClassConfig); // fail-closed registry check at open
  // Trust model loads at open too (fail closed): a service that cannot
  // assess trust refuses to open rather than failing at first call.
  const trustModel = trustLib.loadTrustModel(opts && opts.trustModelConfig, classes);
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
      const rec = store.getRecord(id);
      return { record: rec, versions: versions.map((v) => ({ version: v.version, written_at: v.written_at, deleted: v.deleted })), deleted: rec === null, quarantined: rec ? temporal.isQuarantined(rec) : false };
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
        quarantined: temporal.isQuarantined(rec),
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
        known: known.map((r) => ({ id: r.id, kind: r.kind, truth_time: temporal.truthTimeOf(r), classification: temporal.classify(store, r, { asOf: o.asOf }), quarantined: temporal.isQuarantined(r) })),
        latest_verified: temporal.latestVerified(store, { tag: o && o.tag, asOf: o.asOf }).slice(0, 10).map((r) => r.id),
        open_contradictions: conflictLib.listConflicts(store, { state: 'open' }).map((r) => r.id),
      };
    },

    // assessTrust(id, {asOf}) → OTH-K3 trust report (read-only, traceable,
    // never a truth value; asOf explicit — same rule as currentState)
    assessTrust(id, o) {
      if (!o || !o.asOf) throw fail('OTHK_SERVICE_INPUT', 'asOf required — trust is never assessed against the wall clock');
      return trustLib.assessTrust(store, trustModel, id, { asOf: o.asOf });
    },

    // audit() → provenance audit report (read-only, no quarantine writes)
    audit() { return auditLib.provenanceAudit(store); },

    stats() { return store.stats(); },

    // ---- Phase 16 read tools (all read-only) ----

    // retrieveConstrained(query, {namespace, asOf, trustAware, halfLifeDays, limit})
    // hybrid retrieval with OTHKM constraints applied (namespace, bi-temporal,
    // supersession, trust). The AI-facing "search that respects the truth model".
    retrieveConstrained(query, o) {
      return retrieveLib.retrieve(store, query, Object.assign({ embedder: opts && opts.embedder }, o || {}));
    },

    // sourceTrace(id) → the full provenance chain statement→evidence→document
    // →artifact→bytes-availability, plus trust tier. Nothing external exposes
    // this; OTHKM already holds the data.
    sourceTrace(id) {
      const rec = store.getRecord(id);
      if (!rec) return null;
      const chain = [];
      const evid = store.allRecords({ kind: 'evidence', where: (r) => r.supports_id === id });
      for (const e of evid) for (const eid of e.evidence_ids) {
        const er = store.getRecord(eid);
        if (er) chain.push({ id: er.id, kind: er.kind });
      }
      // walk artifact ref if the record (or its document) points at bytes
      const artifact_ref = rec.provenance && rec.provenance.artifact_ref;
      return {
        id, kind: rec.kind,
        source_class: rec.provenance ? rec.provenance.source_class : null,
        source_reference: rec.provenance ? rec.provenance.source_reference : null,
        captured_at: rec.provenance ? rec.provenance.captured_at : null,
        evidence: chain,
        artifact_ref: artifact_ref || null,
        artifact_available: artifact_ref ? store.hasObject(artifact_ref) : null,
        assertion_class: auditLib.assertionClassOf(rec),
      };
    },

    // timeline({entity_id, property?, asOf?}) → statements about a subject in
    // validity order, each marked current/expired at asOf. This is the
    // bi-temporal "what did we know / what was valid, over time" view.
    timeline(o) {
      if (!o || !o.entity_id) throw fail('OTHK_SERVICE_INPUT', 'entity_id required for timeline');
      const asOf = o.asOf || null;
      const losers = asOf ? temporal.losingIds(store, asOf) : temporal.losingIds(store);
      const recs = graphLib.entityMentions(store, o.entity_id)
        .filter((r) => temporal.STATEMENT_KINDS.indexOf(r.kind) !== -1)
        .filter((r) => !o.property || (r.metadata && r.metadata.property === o.property));
      const rows = recs.map((r) => ({
        id: r.id, kind: r.kind,
        text: (searchLib.textOf(r) || '').slice(0, 300),
        valid_from: r.valid_from || temporal.truthTimeOf(r) || null,
        valid_to: r.valid_to || null,
        expired_at: temporal.expiredAt(store, r.id),
        superseded: losers.has(r.id),
        current_at_asOf: asOf ? temporal.validAndKnownAt(store, r, asOf) : null,
      }));
      rows.sort((a, b) => (Date.parse(a.valid_from || 0) || 0) - (Date.parse(b.valid_from || 0) || 0) || (a.id < b.id ? -1 : 1));
      return { entity_id: o.entity_id, property: o.property || null, as_of: asOf, timeline: rows };
    },

    // entitySearch(query, {namespace}) → entities whose name matches, with a
    // live-mention count (entity-centric complement to knowledge_search).
    entitySearch(query, o) {
      const q = searchLib.tokenize(String(query || ''));
      if (!q.length) return [];
      const ns = o && o.namespace;
      const ents = store.allRecords({ kind: 'entity' }).filter((e) => {
        const toks = searchLib.tokenize(e.name);
        return q.every((t) => toks.indexOf(t) !== -1) || toks.some((t) => q.indexOf(t) !== -1);
      });
      return ents.map((e) => ({
        id: e.id, entity_type: e.entity_type, name: e.name,
        mentions: graphLib.entityMentions(store, e.id).filter((r) => !ns || (r.namespace || 'global') === ns).length,
      })).sort((a, b) => b.mentions - a.mentions || (a.id < b.id ? -1 : 1));
    },

    // buildContext(opts) → compact usable context (Phase 15) for OTHMODE/AI.
    buildContext(o) { return contextLib.buildContext(store, Object.assign({ embedder: opts && opts.embedder }, o || {})); },
  };
}

module.exports = { openService };
