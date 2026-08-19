// =====================================================
// OTH Knowledge — deterministic deduplication
// projects/oth-knowledge/lib/dedup.js
//
// Exact duplicates are already impossible at the byte level (content
// addressing) and at the record level (deterministic ids). This module
// finds NEAR duplicates and entity-alias candidates, and links them —
// it never merges, never deletes, never touches provenance.
//
// Documented thresholds:
//   similarity >= 0.95 → relationship `duplicate_of` (still both live)
//   similarity >= 0.80 → relationship `possible_duplicate_of`
//   below 0.80         → no link
// Merging identities is a human/owner decision recorded as an explicit
// conflict-style resolution, never automatic.
// =====================================================
'use strict';

const ids = require('./ids.js');
const search = require('./search.js');

const DUPLICATE_THRESHOLD = 0.95;
const POSSIBLE_THRESHOLD = 0.80;
const SHINGLE_SIZE = 4;

function shingles(text) {
  const tokens = search.tokenize(text);
  const out = new Set();
  if (tokens.length < SHINGLE_SIZE) { if (tokens.length) out.add(tokens.join(' ')); return out; }
  for (let i = 0; i + SHINGLE_SIZE <= tokens.length; i++) out.add(tokens.slice(i, i + SHINGLE_SIZE).join(' '));
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const s of small) if (large.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

// Scans documents (per default) for near-duplicate pairs across or
// within source classes. Returns pairs sorted by similarity, descending.
function findNearDuplicates(store, opts) {
  const o = opts || {};
  const kind = o.kind || 'document';
  const docs = store.allRecords({ kind }).map((rec) => ({
    rec, sh: shingles(rec.text || rec.statement || ''),
  })).filter((d) => d.sh.size > 0);
  const pairs = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const sim = jaccard(docs[i].sh, docs[j].sh);
      if (sim >= (o.threshold || POSSIBLE_THRESHOLD)) {
        pairs.push({ a: docs[i].rec.id, b: docs[j].rec.id, similarity: +sim.toFixed(4) });
      }
    }
  }
  pairs.sort((x, y) => y.similarity - x.similarity || (x.a < y.a ? -1 : 1));
  return pairs;
}

// Links a near-duplicate pair. Never deletes anything.
function linkDuplicates(store, pairs) {
  const linked = [];
  for (const p of pairs) {
    const relType = p.similarity >= DUPLICATE_THRESHOLD ? 'duplicate_of' : 'possible_duplicate_of';
    const key = [p.a, p.b].sort();
    const rel = {
      kind: 'relationship',
      id: ids.recordId('relationship', relType + '/' + key.join('~')),
      rel_type: relType,
      from_id: key[0], to_id: key[1],
      metadata: { similarity: p.similarity, threshold_doc: 'dedup.js header', decided: 'automatic-link-only-never-merge' },
    };
    if (!store.getRecord(rel.id)) { store.appendRecord(rel); linked.push(rel.id); }
  }
  return linked;
}

// Entity alias candidates: same normalized name, different entity ids
// (e.g. differing entity_type or spelling variants after folding).
function findEntityAliasCandidates(store) {
  const entities = store.allRecords({ kind: 'entity' });
  const byNorm = new Map();
  for (const e of entities) {
    const norm = search.tokenize(e.name).join(' ');
    if (!norm) continue;
    const list = byNorm.get(norm) || [];
    list.push(e);
    byNorm.set(norm, list);
  }
  const candidates = [];
  for (const [norm, list] of byNorm) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        candidates.push({ a: list[i].id, b: list[j].id, normalized_name: norm });
      }
    }
  }
  return candidates;
}

function linkEntityAliases(store, candidates) {
  const linked = [];
  for (const c of candidates) {
    const key = [c.a, c.b].sort();
    const rel = {
      kind: 'relationship',
      id: ids.recordId('relationship', 'same_as_candidate/' + key.join('~')),
      rel_type: 'same_as_candidate',
      from_id: key[0], to_id: key[1],
      metadata: { normalized_name: c.normalized_name, decided: 'candidate-only-never-auto-merged' },
    };
    if (!store.getRecord(rel.id)) { store.appendRecord(rel); linked.push(rel.id); }
  }
  return linked;
}

module.exports = {
  DUPLICATE_THRESHOLD, POSSIBLE_THRESHOLD, SHINGLE_SIZE,
  shingles, jaccard, findNearDuplicates, linkDuplicates,
  findEntityAliasCandidates, linkEntityAliases,
};
