// =====================================================
// OTH Knowledge — context builder (Phase 15)
// projects/oth-knowledge/lib/context.js
//
// Given a namespace + topic (and/or an entity), assemble a COMPACT,
// directly-usable context for OTHMODE / an AI provider: the most relevant
// current, trusted memories — never the whole store. Retrieval is
// constrained (namespace, bi-temporal asOf, supersession, trust) and a
// shallow graph expansion pulls directly-related records. Bounded by a
// budget. Read-only; returns provenance with every item so the consumer
// can cite/trace. No LLM here — this only selects and orders records.
// =====================================================
'use strict';

const retrieveLib = require('./retrieve.js');
const graph = require('./graph.js');
const temporal = require('./temporal.js');
const search = require('./search.js');

function itemOf(store, id, extra) {
  const rec = store.getRecord(id);
  if (!rec) return null;
  return Object.assign({
    id: rec.id, kind: rec.kind,
    text: (search.textOf(rec) || '').slice(0, 500),
    namespace: rec.namespace || 'global',
    valid_from: rec.valid_from || null, valid_to: rec.valid_to || null,
    provenance: rec.provenance ? {
      source_class: rec.provenance.source_class,
      source_reference: rec.provenance.source_reference,
    } : null,
  }, extra || {});
}

// buildContext(store, opts)
//   opts: { namespace, query, entityId, asOf, budget=12, trustAware=true,
//           halfLifeDays, embedder, expandDepth=1 }
function buildContext(store, opts) {
  const o = opts || {};
  const budget = o.budget || 12;
  const asOf = o.asOf || null;
  const trustAware = o.trustAware !== false;
  const seen = new Map(); // id → item (dedup)

  // 1. primary relevance retrieval (already namespace/temporal/trust-constrained)
  if (o.query) {
    const hits = retrieveLib.retrieve(store, o.query, {
      mode: o.mode || 'hybrid', namespace: o.namespace, asOf,
      trustAware, halfLifeDays: o.halfLifeDays, embedder: o.embedder,
      limit: budget,
    });
    for (const h of hits) {
      const it = itemOf(store, h.id, { score: h.score, tier: h.tier, via: 'retrieval' });
      if (it) seen.set(h.id, it);
    }
  }

  // 2. entity-centric mentions (valid + known at asOf, not superseded)
  if (o.entityId) {
    const losers = asOf ? temporal.losingIds(store, asOf) : temporal.losingIds(store);
    for (const rec of graph.entityMentions(store, o.entityId)) {
      if (o.namespace && (rec.namespace || 'global') !== o.namespace) continue;
      if (losers.has(rec.id)) continue;
      if (asOf && temporal.STATEMENT_KINDS.indexOf(rec.kind) !== -1 && !temporal.validAndKnownAt(store, rec, asOf)) continue;
      if (!seen.has(rec.id)) seen.set(rec.id, itemOf(store, rec.id, { via: 'entity' }));
    }
  }

  // 3. shallow graph expansion of what we already have (directly related)
  if ((o.expandDepth == null ? 1 : o.expandDepth) > 0 && seen.size) {
    const adj = graph.buildAdjacency(store);
    const related = graph.walk(store, Array.from(seen.keys()), { adjacency: adj, depth: o.expandDepth == null ? 1 : o.expandDepth, maxNodes: budget * 2 });
    for (const id of related) {
      if (seen.has(id)) continue;
      const rec = store.getRecord(id);
      if (!rec || rec.kind === 'relationship') continue; // relationships are edges, not context items
      if (o.namespace && (rec.namespace || 'global') !== o.namespace) continue;
      seen.set(id, itemOf(store, id, { via: 'related' }));
    }
  }

  // rank: retrieval score first, then keep deterministic order; trim to budget.
  const items = Array.from(seen.values())
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (a.id < b.id ? -1 : 1));
  const truncated = items.length > budget;
  const chosen = items.slice(0, budget);
  return {
    namespace: o.namespace || null,
    as_of: asOf,
    query: o.query || null,
    entity_id: o.entityId || null,
    item_count: chosen.length,
    truncated,
    items: chosen,
  };
}

module.exports = { buildContext };
