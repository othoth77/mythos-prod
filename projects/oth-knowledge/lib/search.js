// =====================================================
// OTH Knowledge — retrieval
// projects/oth-knowledge/lib/search.js
//
// Exact matching, lexical BM25 over an inverted index, pluggable
// provider-agnostic vector retrieval, hybrid reciprocal-rank fusion,
// and metadata/entity/temporal/provenance filters. Every hit carries
// its provenance. The default embedder is a deterministic offline
// hashed n-gram vectorizer, explicitly labeled pseudo-semantic; a real
// embedding provider replaces it via configuration, not code change.
// =====================================================
'use strict';

const crypto = require('crypto');

const SEARCHABLE_KINDS = Object.freeze(['chunk', 'fact', 'claim', 'observation', 'event', 'entity', 'derived']);

function textOf(rec) {
  switch (rec.kind) {
    case 'chunk': case 'derived': return rec.text;
    case 'fact': case 'claim': case 'observation': return rec.statement;
    case 'event': return rec.title;
    case 'entity': return rec.entity_type + ' ' + rec.name;
    default: return '';
  }
}

// Unicode-folded tokenization.
function tokenize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

// ---- default offline embedder (pseudo-semantic, deterministic) --------
const DEFAULT_DIMS = 256;
function defaultEmbedder(text) {
  const vec = new Float64Array(DEFAULT_DIMS);
  const tokens = tokenize(text);
  const grams = [];
  for (const t of tokens) {
    grams.push(t);
    for (let i = 0; i + 3 <= t.length; i++) grams.push('#' + t.slice(i, i + 3));
  }
  for (const g of grams) {
    const h = crypto.createHash('sha1').update(g).digest();
    vec[h.readUInt16BE(0) % DEFAULT_DIMS] += (h[2] & 1) ? 1 : -1;
  }
  let norm = 0;
  for (let i = 0; i < DEFAULT_DIMS; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}
defaultEmbedder.label = 'hashed-ngram-pseudo-semantic';

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

// ---- index -------------------------------------------------------------
// buildIndex(store, {embedder}) → SearchIndex over latest live records.
function buildIndex(store, opts) {
  const embedder = (opts && opts.embedder) || defaultEmbedder;
  const docs = [];      // {rec, tokens, len, vector}
  const df = new Map(); // term → doc frequency
  for (const rec of store.allRecords()) {
    if (SEARCHABLE_KINDS.indexOf(rec.kind) === -1) continue;
    const text = textOf(rec);
    const tokens = tokenize(text);
    if (!tokens.length) continue;
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    docs.push({ rec, text, tf, len: tokens.length, vector: embedder(text) });
  }
  const avgLen = docs.length ? docs.reduce((s, d) => s + d.len, 0) / docs.length : 0;
  return { docs, df, avgLen, N: docs.length, embedder };
}

// ---- filters -----------------------------------------------------------
function timeOf(rec) {
  return rec.observed_at || rec.occurred_at ||
    (rec.provenance && (rec.provenance.observed_at || rec.provenance.captured_at)) || null;
}

function passesFilters(rec, f) {
  if (!f) return true;
  if (f.kind && rec.kind !== f.kind) return false;
  if (f.kinds && f.kinds.indexOf(rec.kind) === -1) return false;
  if (f.source_class && !(rec.provenance && rec.provenance.source_class === f.source_class)) return false;
  if (f.source_collection && !(rec.provenance && rec.provenance.source_collection === f.source_collection)) return false;
  if (f.entity_id && !(Array.isArray(rec.entity_ids) && rec.entity_ids.indexOf(f.entity_id) !== -1)) return false;
  if (f.tag && !(Array.isArray(rec.tags) && rec.tags.indexOf(f.tag) !== -1)) return false;
  if (f.confidence && rec.confidence !== f.confidence && !(rec.provenance && rec.provenance.confidence === f.confidence)) return false;
  if (f.after || f.before) {
    const t = timeOf(rec);
    if (!t) return false;
    if (f.after && Date.parse(t) < Date.parse(f.after)) return false;
    if (f.before && Date.parse(t) > Date.parse(f.before)) return false;
  }
  if (typeof f.metadata === 'object' && f.metadata) {
    for (const k of Object.keys(f.metadata)) {
      if (!rec.metadata || rec.metadata[k] !== f.metadata[k]) return false;
    }
  }
  return true;
}

function hit(rec, score, mode) {
  return {
    id: rec.id, kind: rec.kind, score, mode,
    text: textOf(rec).slice(0, 400),
    provenance: rec.provenance ? {
      source_class: rec.provenance.source_class,
      source_collection: rec.provenance.source_collection,
      source_reference: rec.provenance.source_reference,
      artifact_ref: rec.provenance.artifact_ref || null,
    } : null,
  };
}

// ---- exact -------------------------------------------------------------
function exactSearch(index, literal, filters, limit) {
  const needle = String(literal);
  const out = [];
  for (const d of index.docs) {
    if (!passesFilters(d.rec, filters)) continue;
    if (d.rec.id === needle || d.text.indexOf(needle) !== -1) out.push(hit(d.rec, 1, 'exact'));
  }
  return out.slice(0, limit || 10);
}

// ---- lexical BM25 --------------------------------------------------------
const K1 = 1.5, B = 0.75;
function lexicalSearch(index, query, filters, limit) {
  const qTokens = Array.from(new Set(tokenize(query)));
  const scored = [];
  for (const d of index.docs) {
    if (!passesFilters(d.rec, filters)) continue;
    let score = 0;
    for (const t of qTokens) {
      const tf = d.tf.get(t);
      if (!tf) continue;
      const n = index.df.get(t) || 0;
      const idf = Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
      score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (d.len / (index.avgLen || 1))));
    }
    if (score > 0) scored.push({ d, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.d.rec.id < b.d.rec.id ? -1 : 1));
  return scored.slice(0, limit || 10).map((s) => hit(s.d.rec, s.score, 'lexical'));
}

// ---- vector --------------------------------------------------------------
function vectorSearch(index, query, filters, limit) {
  const qv = index.embedder(query);
  const scored = [];
  for (const d of index.docs) {
    if (!passesFilters(d.rec, filters)) continue;
    const score = cosine(qv, d.vector);
    if (score > 0) scored.push({ d, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.d.rec.id < b.d.rec.id ? -1 : 1));
  return scored.slice(0, limit || 10).map((s) => hit(s.d.rec, s.score, 'vector'));
}

// ---- hybrid: reciprocal-rank fusion ---------------------------------------
const RRF_K = 60;
function hybridSearch(index, query, filters, limit) {
  const lim = limit || 10;
  const lex = lexicalSearch(index, query, filters, lim * 3);
  const vec = vectorSearch(index, query, filters, lim * 3);
  const fused = new Map();
  const add = (list, weight) => list.forEach((h, rank) => {
    const cur = fused.get(h.id) || { hit: h, score: 0 };
    cur.score += weight / (RRF_K + rank + 1);
    fused.set(h.id, cur);
  });
  add(lex, 1.0);
  add(vec, 0.8);
  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score || (a.hit.id < b.hit.id ? -1 : 1))
    .slice(0, lim)
    .map((f) => Object.assign({}, f.hit, { score: f.score, mode: 'hybrid' }));
}

function search(index, query, opts) {
  const o = opts || {};
  const mode = o.mode || 'hybrid';
  if (mode === 'exact') return exactSearch(index, query, o.filters, o.limit);
  if (mode === 'lexical') return lexicalSearch(index, query, o.filters, o.limit);
  if (mode === 'vector') return vectorSearch(index, query, o.filters, o.limit);
  if (mode === 'hybrid') return hybridSearch(index, query, o.filters, o.limit);
  throw new Error('OTHK_SEARCH_MODE: unknown mode ' + String(mode).slice(0, 30));
}

module.exports = {
  SEARCHABLE_KINDS, tokenize, textOf, defaultEmbedder, cosine,
  buildIndex, passesFilters, exactSearch, lexicalSearch, vectorSearch, hybridSearch, search,
};
