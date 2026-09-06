// =====================================================
// OTH Knowledge — lightweight consolidation (Phase 9)
// projects/oth-knowledge/lib/consolidate.js
//
// A small, deterministic maintenance pass — NOT a "dreaming" engine, NOT
// a second store. consolidate() is READ-ONLY: it scans live records and
// returns a plan of candidates (near-duplicates, semantic duplicates,
// entity aliases, contradictions). It never rewrites truth and never
// picks a winner. applyConsolidation() performs only the safe,
// append-only relationship writes (duplicate_of / same_as_candidate /
// conflicts_with) through the existing dedup/conflict mechanisms; it never
// edits, merges, or deletes a knowledge record. Any change to durable
// statements still goes through the promotion gate elsewhere.
// =====================================================
'use strict';

const dedup = require('./dedup.js');
const contradiction = require('./contradiction.js');
const conflict = require('./conflict.js');

function consolidate(store, opts) {
  const o = opts || {};
  const plan = {
    near_duplicates: dedup.findNearDuplicates(store, { kind: o.kind || 'document' }),
    entity_aliases: dedup.findEntityAliasCandidates(store),
    contradictions: contradiction.detectContradictions(store),
    semantic_duplicates: [],
  };
  if (typeof o.embedder === 'function') {
    plan.semantic_duplicates = dedup.findSemanticNearDuplicates(store, { embedder: o.embedder, threshold: o.semanticThreshold });
  }
  plan.summary = {
    near_duplicates: plan.near_duplicates.length,
    semantic_duplicates: plan.semantic_duplicates.length,
    entity_aliases: plan.entity_aliases.length,
    contradictions: plan.contradictions.length,
  };
  return plan;
}

// Applies ONLY relationship links from a plan (append-only, idempotent).
// Statement records are never touched. Contradictions are registered with
// resolution_state 'open' — a human/operator still decides any winner.
function applyConsolidation(store, plan, opts) {
  const o = opts || {};
  const out = { duplicate_links: [], alias_links: [], conflicts: [] };
  if (o.linkDuplicates !== false) out.duplicate_links = dedup.linkDuplicates(store, plan.near_duplicates || []);
  if (o.linkAliases !== false) out.alias_links = dedup.linkEntityAliases(store, plan.entity_aliases || []);
  if (o.registerContradictions !== false) {
    for (const c of plan.contradictions || []) {
      const rel = conflict.registerConflict(store, c.a, c.b, c.note);
      out.conflicts.push(rel.id);
    }
  }
  return out;
}

module.exports = { consolidate, applyConsolidation };
