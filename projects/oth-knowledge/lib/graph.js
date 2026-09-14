// =====================================================
// OTH Knowledge — entity/relationship graph (Phase 14)
// projects/oth-knowledge/lib/graph.js
//
// A LIGHTWEIGHT graph derived from OTHKM truth — NOT a graph database.
// Relationships are already records; this builds an in-memory adjacency
// map over the live ones and offers neighbour lookup, alias resolution
// (same_as / same_as_candidate), entity mentions, and a bounded
// build_context-style walk. Rebuildable from the record log; stores
// nothing. No Neo4j, no FalkorDB, no external engine.
// =====================================================
'use strict';

const ALIAS_RELS = ['same_as', 'same_as_candidate'];

function buildAdjacency(store) {
  const adj = new Map(); // id → [{rel_type, dir:'out'|'in', other, rel}]
  const push = (id, edge) => { const l = adj.get(id) || []; l.push(edge); adj.set(id, l); };
  for (const rel of store.allRecords({ kind: 'relationship' })) {
    push(rel.from_id, { rel_type: rel.rel_type, dir: 'out', other: rel.to_id, rel });
    push(rel.to_id, { rel_type: rel.rel_type, dir: 'in', other: rel.from_id, rel });
  }
  return adj;
}

// Direct neighbours of `id`, optionally filtered to certain rel types.
function neighbors(store, id, opts) {
  const o = opts || {};
  const adj = o.adjacency || buildAdjacency(store);
  const edges = adj.get(id) || [];
  return edges
    .filter((e) => !o.relTypes || o.relTypes.indexOf(e.rel_type) !== -1)
    .map((e) => ({ id: e.other, rel_type: e.rel_type, dir: e.dir }));
}

// Alias set for an entity: the entity itself plus anything linked by
// same_as / same_as_candidate (transitively). Deterministic.
function resolveAliases(store, entityId, opts) {
  const adj = (opts && opts.adjacency) || buildAdjacency(store);
  const seen = new Set([entityId]);
  const stack = [entityId];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of adj.get(cur) || []) {
      if (ALIAS_RELS.indexOf(e.rel_type) === -1) continue;
      if (!seen.has(e.other)) { seen.add(e.other); stack.push(e.other); }
    }
  }
  return seen;
}

// Records that mention an entity (via entity_ids), following aliases.
function entityMentions(store, entityId, opts) {
  const aliases = resolveAliases(store, entityId, opts);
  return store.allRecords({ where: (r) => Array.isArray(r.entity_ids) && r.entity_ids.some((e) => aliases.has(e)) });
}

// Bounded breadth-first walk from seed ids over the relationship graph,
// returning the reachable node ids (<= maxNodes) within `depth` hops.
// This is the retrieval primitive behind build_context.
function walk(store, seedIds, opts) {
  const o = opts || {};
  const adj = o.adjacency || buildAdjacency(store);
  const depth = o.depth == null ? 2 : o.depth;
  const maxNodes = o.maxNodes || 100;
  const seen = new Set(seedIds);
  let frontier = seedIds.slice();
  for (let d = 0; d < depth && seen.size < maxNodes; d++) {
    const next = [];
    for (const id of frontier) {
      for (const e of adj.get(id) || []) {
        if (o.relTypes && o.relTypes.indexOf(e.rel_type) === -1) continue;
        if (!seen.has(e.other)) { seen.add(e.other); next.push(e.other); if (seen.size >= maxNodes) break; }
      }
      if (seen.size >= maxNodes) break;
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return seen;
}

module.exports = { ALIAS_RELS, buildAdjacency, neighbors, resolveAliases, entityMentions, walk };
