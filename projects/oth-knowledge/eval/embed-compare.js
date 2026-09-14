// =====================================================
// OTH Knowledge — embedding provider comparison (Phase 5/6 validation)
// projects/oth-knowledge/eval/embed-compare.js
//
// Compares the zero-dep hashed pseudo-semantic provider against the real
// local sentence-embedding model on PARAPHRASE retrieval — where semantic
// meaning, not shared tokens, decides relevance. Deterministic corpus with
// gold answers; reports recall@3 / MRR / latency for each provider. If the
// real provider is unavailable it says so and exits 0 (the engine still
// works on hashed). Run: node embed-compare.js
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..');
const ids = require(path.join(BASE, 'lib/ids.js'));
const storeLib = require(path.join(BASE, 'lib/store.js'));
const extract = require(path.join(BASE, 'lib/extract.js'));
const provenance = require(path.join(BASE, 'lib/provenance.js'));
const searchLib = require(path.join(BASE, 'lib/search.js'));
const emb = require(path.join(BASE, 'lib/embeddings.js'));
const CLASSES = provenance.loadSourceClasses();

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-embcmp-')); }
function prov() { return { source_class: 'manual', source_collection: 'c', source_reference: 'manual/c/x', captured_at: '2022-01-01T00:00:00Z' }; }

// Paraphrase fixtures: the query and its gold record share MEANING but few
// tokens, so lexical BM25 / hashed n-grams struggle and real embeddings win.
const FIXTURES = [
  { seed: 'oil', text: 'engine oil should be renewed every ten thousand kilometres', query: 'how frequently must I change the motor lubricant' },
  { seed: 'battery', text: 'the vehicle uses a twelve volt absorbed glass mat accumulator', query: 'what kind of car battery is fitted' },
  { seed: 'tyre', text: 'recommended cold inflation is thirty two psi front and rear', query: 'correct tire pressure for the wheels' },
  { seed: 'brake', text: 'front stopping components should be inspected annually', query: 'how often to check the brakes' },
  { seed: 'coolant', text: 'antifreeze mixture protects the radiator down to minus forty', query: 'engine cooling fluid freeze protection' },
];
const DISTRACTORS = [
  'the owner prefers the colour metallic grey for the bodywork',
  'the infotainment system supports wireless smartphone mirroring',
  'the boot capacity is generous for a compact sport utility vehicle',
];

function buildStore() {
  const s = storeLib.openStore(tmpRoot());
  for (const f of FIXTURES) extract.addClaim(s, CLASSES, { statement: f.text, asserted_by: 'x', prov: prov() });
  for (let i = 0; i < DISTRACTORS.length; i++) extract.addClaim(s, CLASSES, { statement: DISTRACTORS[i], asserted_by: 'x', prov: prov() });
  return s;
}
function goldId(f) { return ids.recordId('claim', 'manual/x/' + f.text); }

function scoreProvider(s, embedder, label) {
  const index = searchLib.buildIndex(s, { embedder });
  let recallHits = 0, mrrSum = 0; const lat = [];
  for (const f of FIXTURES) {
    const t0 = process.hrtime.bigint();
    const hits = searchLib.search(index, f.query, { mode: 'vector', limit: 3 });
    lat.push(Number(process.hrtime.bigint() - t0) / 1e6);
    const gold = goldId(f);
    const rank = hits.findIndex((h) => h.id === gold);
    if (rank !== -1 && rank < 3) recallHits++;
    if (rank !== -1) mrrSum += 1 / (rank + 1);
  }
  lat.sort((a, b) => a - b);
  return {
    provider: label,
    recall_at_3: +(recallHits / FIXTURES.length).toFixed(3),
    mrr: +(mrrSum / FIXTURES.length).toFixed(3),
    latency_p50_ms: +lat[Math.floor(lat.length * 0.5)].toFixed(2),
  };
}

(async function main() {
  const s = buildStore();
  const allText = FIXTURES.flatMap((f) => [f.text, f.query]).concat(DISTRACTORS);

  // hashed baseline
  const hashed = emb.createEmbedder({ provider: 'hashed' });
  const hashedCached = emb.cachedSyncEmbedder(hashed, new emb.VectorCache(tmpRoot(), hashed.label));
  const A = scoreProvider(s, hashedCached, 'hashed-pseudo-semantic');

  // real local model
  const provider = emb.createEmbedder({ provider: 'local-model' });
  const cache = new emb.VectorCache(tmpRoot(), provider.label);
  const t0 = Date.now();
  const warmed = await emb.warmAsyncEmbedder(provider, cache, allText, hashed);
  const warmMs = Date.now() - t0;
  const report = { hashed: A };
  if (warmed.provider_available) {
    const B = scoreProvider(s, warmed, provider.label);
    B.model = provider.label; B.warm_ms = warmMs; B.cached_vectors = cache.size();
    report.real = B;
    report.improvement = { recall_at_3: +(B.recall_at_3 - A.recall_at_3).toFixed(3), mrr: +(B.mrr - A.mrr).toFixed(3) };
    report.available = true;
  } else {
    report.available = false;
    report.note = 'real local-model provider unavailable (@xenova/transformers not installed) — engine runs on hashed';
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
})();
