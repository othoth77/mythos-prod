// =====================================================
// OTH-K1 — retrieval suite
// tests/othk-1-search-test.js
//
// Exact / lexical / vector / hybrid retrieval, filter set, provenance
// on hits, determinism, and the reproducible evaluation thresholds.
// Offline; the default embedder is the deterministic pseudo-semantic
// vectorizer. All fixture values are synthetic.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');

const api = require(path.join(BASE, 'lib/api.js'));
const searchLib = require(path.join(BASE, 'lib/search.js'));
const seedLib = require(path.join(BASE, 'lib/seed.js'));
const evalRunner = require(path.join(BASE, 'eval/run-eval.js'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-search-')); }
const CAP = '2026-08-19T12:00:00Z';

// Shared corpus: fixtures + seed via the eval runner's own builder,
// so the suite exercises exactly the evaluated corpus.
const kb = evalRunner.buildCorpus(tmpRoot());

console.log('§1 exact matching');
{
  const factHits = kb.search('51.68.226.211', { mode: 'exact', filters: { kind: 'fact' }, limit: 5 });
  ok(factHits.length >= 1, 'exact literal match finds the VPS fact');
  const byId = kb.search(factHits[0].id, { mode: 'exact', limit: 3 });
  ok(byId.length === 1 && byId[0].id === factHits[0].id, 'exact id lookup');
}

console.log('§2 lexical BM25');
{
  const hits = kb.search('certbot dry run before certificate operation', { mode: 'lexical', limit: 5 });
  ok(hits.length >= 1 && hits[0].kind === 'chunk' && /certbot/.test(hits[0].text), 'distinctive query ranks the right chunk first');
  ok(hits[0].score > 0, 'BM25 scores positive');
  const again = kb.search('certbot dry run before certificate operation', { mode: 'lexical', limit: 5 });
  ok(JSON.stringify(hits) === JSON.stringify(again), 'lexical retrieval deterministic');
  ok(kb.search('zqxwv nonexistent gibberish', { mode: 'lexical', limit: 5 }).length === 0, 'no-match query returns empty, not noise');
}

console.log('§3 filters');
{
  const all = kb.search('notes', { mode: 'lexical', limit: 20 });
  const gemOnly = kb.search('notes', { mode: 'lexical', filters: { source_class: 'gemini' }, limit: 20 });
  ok(gemOnly.length >= 1 && gemOnly.every((h) => h.provenance.source_class === 'gemini'), 'source-class filter');
  ok(all.length > gemOnly.length, 'filter actually narrows');
  const factsOnly = kb.search('rsync', { mode: 'lexical', filters: { kind: 'fact' }, limit: 10 });
  ok(factsOnly.length >= 1 && factsOnly.every((h) => h.kind === 'fact'), 'kind filter');
  const tagged = kb.search('access', { mode: 'lexical', filters: { tag: 'CAPABILITY-LIMITATION' }, limit: 10 });
  ok(tagged.length >= 1, 'tag filter finds capability-limitation records');
  const after = kb.search('verification', { mode: 'lexical', filters: { after: '2026-08-01' }, limit: 20 });
  ok(after.every((h) => {
    const rec = kb.store.getRecord(h.id);
    const t = rec.observed_at || rec.occurred_at || (rec.provenance && (rec.provenance.observed_at || rec.provenance.captured_at));
    return Date.parse(t) >= Date.parse('2026-08-01');
  }), 'temporal after-filter respected');
  const none = kb.search('verification', { mode: 'lexical', filters: { after: '2027-01-01' }, limit: 20 });
  ok(none.length === 0, 'future temporal window returns nothing');
  const vpsEntity = kb.store.allRecords({ kind: 'entity' }).find((e) => e.name === 'vps-51.68.226.211');
  const entHits = kb.search('ssh', { mode: 'lexical', filters: { entity_id: vpsEntity.id }, limit: 10 });
  ok(entHits.length >= 1, 'entity filter retrieval');
  const conf = kb.search('vps', { mode: 'lexical', filters: { confidence: 'EXPLICIT' }, limit: 10 });
  ok(conf.length >= 1, 'confidence filter retrieval');
}

console.log('§4 provenance on hits');
{
  const hits = kb.search('postgres backup restore strategies', { mode: 'hybrid', filters: { kind: 'chunk' }, limit: 3 });
  ok(hits.length >= 1 && hits[0].provenance && hits[0].provenance.source_class === 'google-takeout', 'hit carries source class');
  ok(typeof hits[0].provenance.source_reference === 'string' && hits[0].provenance.source_reference.length > 0, 'hit carries source reference');
  const rec = kb.store.getRecord(hits[0].id);
  ok(rec.provenance.artifact_ref && kb.store.hasObject(rec.provenance.artifact_ref), 'hit traceable to the original artifact bytes');
}

console.log('§5 vector + hybrid');
{
  const v1 = kb.search('evaluating retrieval quality with ranked metrics', { mode: 'vector', limit: 5 });
  ok(v1.length >= 1, 'vector mode returns results');
  const v2 = kb.search('evaluating retrieval quality with ranked metrics', { mode: 'vector', limit: 5 });
  ok(JSON.stringify(v1) === JSON.stringify(v2), 'default embedder deterministic');
  const hy = kb.search('recall mean reciprocal rank', { mode: 'hybrid', limit: 5 });
  const lex = kb.search('recall mean reciprocal rank', { mode: 'lexical', limit: 5 });
  ok(hy.some((h) => h.id === lex[0].id), 'hybrid retains the top lexical hit');
  let threw = false;
  try { kb.search('x', { mode: 'psychic' }); } catch (e) { threw = /OTHK_SEARCH_MODE/.test(e.message); }
  ok(threw, 'unknown mode refused');
  // pluggable embedder: constant vectors → equal scores, still functional
  const kb2 = api.open(tmpRoot(), { embedder: (t) => [1, 0, 0] });
  kb2.addFact({ statement: 'pluggable embedder works', confidence: 'HIGH', prov: { source_class: 'manual', source_reference: 'm/x', captured_at: CAP } });
  ok(kb2.search('pluggable', { mode: 'vector', limit: 1 }).length === 1, 'custom embedder injected without code change');
}

console.log('§6 evaluation thresholds (measured, reproducible)');
{
  const evalSet = JSON.parse(fs.readFileSync(path.join(BASE, 'eval', 'retrieval-eval.json'), 'utf8'));
  const results = evalRunner.evaluate(kb, evalSet);
  console.log('    lexical recall@5=' + results.lexical.recall_at_k + ' mrr=' + results.lexical.mrr +
    ' · vector recall@5=' + results.vector.recall_at_k + ' mrr=' + results.vector.mrr +
    ' · hybrid recall@5=' + results.hybrid.recall_at_k + ' mrr=' + results.hybrid.mrr);
  ok(results.lexical.recall_at_k >= 0.9, 'lexical recall@5 >= 0.9');
  ok(results.lexical.mrr >= 0.8, 'lexical MRR >= 0.8');
  ok(results.vector.recall_at_k >= 0.8, 'vector recall@5 >= 0.8 (pseudo-semantic baseline)');
  ok(results.hybrid.recall_at_k >= 0.9, 'hybrid recall@5 >= 0.9');
  ok(results.hybrid.mrr >= 0.8, 'hybrid MRR >= 0.8');
  ok(kb.verify().ok, 'evaluated corpus integrity OK');
}

console.log('§7 corpus provenance separation');
{
  const classes = new Set(kb.store.allRecords({ kind: 'source' }).map((s) => s.source_class));
  ok(classes.size >= 6, 'independent source records per class (' + classes.size + ' classes)');
  const takeout = kb.store.allRecords({ kind: 'artifact', where: (r) => r.provenance.source_class === 'google-takeout' });
  const manual = kb.store.allRecords({ kind: 'artifact', where: (r) => r.provenance.source_class === 'manual' });
  ok(takeout.length === 3 && manual.length === 1, 'artifacts remain attributed to their own source class (1 K1 fixture + 2 takeout-export files)');
}

console.log('');
console.log('othk-1: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
