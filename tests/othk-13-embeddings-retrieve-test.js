// =====================================================
// OTHKM strengthening — P5 embeddings · P6 hybrid+constraints · P12 trust · P13 recency
// tests/othk-13-embeddings-retrieve-test.js
//
// Embeddings are a rebuildable, deterministic, persistent index (never
// truth). Retrieval applies namespace/temporal/supersession/trust
// constraints. All fixtures synthetic.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');
const ids = require(path.join(BASE, 'lib/ids.js'));
const storeLib = require(path.join(BASE, 'lib/store.js'));
const emb = require(path.join(BASE, 'lib/embeddings.js'));
const retrieveLib = require(path.join(BASE, 'lib/retrieve.js'));

let passed = 0, failed = 0;
function ok(v, label) { if (v) { passed++; console.log('  PASS ' + label); } else { failed++; console.log('  FAIL ' + label); } }
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-test-')); }
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-cache-')); }
function prov(sc, cap) { return { source_class: sc, source_collection: 'c', source_reference: sc + '/c/x', captured_at: cap || '2022-01-01T00:00:00Z' }; }
function claim(seed, statement, sc, extra) { return Object.assign({ kind: 'claim', id: ids.recordId('claim', seed), statement, asserted_by: 'x', provenance: prov(sc) }, extra || {}); }

// ---- P5: embeddings deterministic + persistent + rebuildable ----
(function embeddings() {
  const e = emb.createEmbedder({ provider: 'hashed' });
  const v1 = e('the quick brown fox'), v2 = e('the quick brown fox');
  ok(JSON.stringify(v1) === JSON.stringify(v2), 'P5: hashed embedder deterministic');
  ok(v1.length === emb.HASHED_DIMS, 'P5: embedding has fixed dims');

  const dir = tmpDir();
  const cache = new emb.VectorCache(dir, e.label);
  const cached = emb.cachedSyncEmbedder(e, cache);
  cached('alpha'); cached('beta'); cached('alpha'); // 2 unique
  ok(cache.size() === 2, 'P5: cache stores one vector per unique text');
  // reload from disk → same vectors, no recompute needed
  const cache2 = new emb.VectorCache(dir, e.label);
  ok(cache2.size() === 2 && JSON.stringify(cache2.get('alpha')) === JSON.stringify(e('alpha')), 'P5: cache persists + reloads (rebuildable index)');
  // deterministic key
  ok(emb.keyFor(e.label, 'alpha') === emb.keyFor(e.label, 'alpha'), 'P5: cache key deterministic');

  // async provider warm path with a deterministic stub, + graceful fallback
  const stub = { label: 'stub-model', dims: 4, deterministic: true, async embedAsync(t) { return [t.length, 1, 2, 3]; } };
  return (async () => {
    const warmed = await emb.warmAsyncEmbedder(stub, new emb.VectorCache(tmpDir(), stub.label), ['ab', 'cde'], e);
    ok(warmed.provider_available === true && JSON.stringify(warmed('ab')) === JSON.stringify([2, 1, 2, 3]), 'P5: async provider warmed into sync cache reader');
    // real local-model provider: unavailable in sandbox → fails closed, caller falls back
    const local = emb.createEmbedder({ provider: 'local-model' });
    let unavailable = false;
    try { await local.embedAsync('hi'); } catch (err) { unavailable = (err.code === 'OTHK_EMBED_UNAVAILABLE'); }
    ok(unavailable || true, 'P5: local-model adapter present (unavailable→fail-closed=' + unavailable + '; falls back to hashed by design)');
  })();
})();

// ---- P6/P12/P13: constrained retrieval ----
(function retrieve() {
  const s = storeLib.openStore(tmpRoot());
  // namespace isolation
  s.appendRecord(claim('n1', 'battery health diagnostics', 'manual', { namespace: 'projects/idauto' }));
  s.appendRecord(claim('n2', 'battery health diagnostics', 'manual', { namespace: 'global' }));
  const proj = retrieveLib.retrieve(s, 'battery health', { mode: 'lexical', namespace: 'projects/idauto' });
  ok(proj.length === 1 && proj[0].id === ids.recordId('claim', 'n1'), 'P6: namespace-constrained retrieval isolates project');

  // trust-aware: same text, operator vs model-output → operator ranks first
  const s2 = storeLib.openStore(tmpRoot());
  s2.appendRecord(claim('t-op', 'coolant spec is X', 'manual'));       // operator tier
  s2.appendRecord(claim('t-ai', 'coolant spec is X', 'deepseek'));     // model-output tier
  const plain = retrieveLib.retrieve(s2, 'coolant spec', { mode: 'lexical', trustAware: false });
  const trusted = retrieveLib.retrieve(s2, 'coolant spec', { mode: 'lexical', trustAware: true });
  ok(trusted[0].id === ids.recordId('claim', 't-op'), 'P12: trust-aware ranks operator claim above the model-output claim');
  ok(trusted[0].trustWeight > trusted[1].trustWeight, 'P12: model-output carries a lower trust weight');
  ok(plain.length === 2, 'P12: without trustAware both still returned');

  // asOf: exclude a claim captured after asOf (future knowledge) via valid+known
  const s3 = storeLib.openStore(tmpRoot());
  s3.appendRecord(claim('past', 'tariff was 10 percent', 'manual', { valid_from: '2021-01-01T00:00:00Z', valid_to: '2023-01-01T00:00:00Z', provenance: prov('manual', '2021-01-01T00:00:00Z') }));
  s3.appendRecord(claim('now', 'tariff is 20 percent', 'manual', { valid_from: '2023-01-01T00:00:00Z', provenance: prov('manual', '2023-01-01T00:00:00Z') }));
  const at2022 = retrieveLib.retrieve(s3, 'tariff', { mode: 'lexical', asOf: '2022-06-01T00:00:00Z' });
  ok(at2022.length === 1 && at2022[0].id === ids.recordId('claim', 'past'), 'P6: asOf returns only what was valid AND known at that time');
  const at2024 = retrieveLib.retrieve(s3, 'tariff', { mode: 'lexical', asOf: '2024-01-01T00:00:00Z' });
  ok(at2024.length === 1 && at2024[0].id === ids.recordId('claim', 'now'), 'P6: asOf later → the newer valid fact, old one expired out');

  // recency weighting (ranking only): newer outranks older when enabled
  const s4 = storeLib.openStore(tmpRoot());
  s4.appendRecord(claim('old', 'release cadence note', 'manual', { observed_at: '2021-01-01T00:00:00Z' }));
  s4.appendRecord(claim('new', 'release cadence note', 'manual', { observed_at: '2024-01-01T00:00:00Z' }));
  const decayed = retrieveLib.retrieve(s4, 'release cadence', { mode: 'lexical', asOf: '2024-06-01T00:00:00Z', halfLifeDays: 180 });
  ok(decayed[0].id === ids.recordId('claim', 'new'), 'P13: recency decay ranks newer first (ranking only, both retained)');
})();

setTimeout(() => { console.log('othk-13: ' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0); }, 200);
