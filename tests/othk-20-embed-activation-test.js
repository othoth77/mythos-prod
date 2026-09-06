// =====================================================
// OTHKM strengthening — P5 embedding activation helper (fast, network-free)
// tests/othk-20-embed-activation-test.js
// The real local model is validated separately by eval/embed-compare.js
// (needs a model download); this gates the always-on activation contract.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');
const storeLib = require(path.join(BASE, 'lib/store.js'));
const extract = require(path.join(BASE, 'lib/extract.js'));
const provenance = require(path.join(BASE, 'lib/provenance.js'));
const searchLib = require(path.join(BASE, 'lib/search.js'));
const emb = require(path.join(BASE, 'lib/embeddings.js'));

let passed = 0, failed = 0;
function ok(v, label) { if (v) { passed++; console.log('  PASS ' + label); } else { failed++; console.log('  FAIL ' + label); } }
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-test-')); }
const CLASSES = provenance.loadSourceClasses();
function prov() { return { source_class: 'manual', source_collection: 'c', source_reference: 'manual/c/x', captured_at: '2022-01-01T00:00:00Z' }; }

(async function () {
  const s = storeLib.openStore(tmpRoot());
  extract.addClaim(s, CLASSES, { statement: 'alpha beta gamma', asserted_by: 'x', prov: prov() });
  extract.addClaim(s, CLASSES, { statement: 'delta epsilon zeta', asserted_by: 'x', prov: prov() });

  // hashed activation: sync embedder usable by buildIndex, persisted under store root
  const e = await emb.buildStoreEmbedder(s, { provider: 'hashed' });
  ok(typeof e === 'function' && e('alpha beta gamma').length === emb.HASHED_DIMS, 'P5: buildStoreEmbedder(hashed) → working sync embedder');
  const idx = searchLib.buildIndex(s, { embedder: e });
  ok(searchLib.search(idx, 'alpha', { mode: 'vector', limit: 2 }).length >= 1, 'P5: buildIndex accepts the activated embedder');
  ok(fs.existsSync(path.join(s.root, 'embeddings')), 'P5: embedding cache persisted beside the store (rebuildable, not in truth log)');

  // local-model activation is a config change; if the optional dep is absent
  // it must fall back to hashed rather than break (fail-open on retrieval).
  const e2 = await emb.buildStoreEmbedder(s, { provider: 'local-model', cacheDir: tmpRoot() });
  ok(typeof e2 === 'function' && Array.isArray(e2('alpha beta gamma')), 'P5: buildStoreEmbedder(local-model) returns a usable embedder (real if installed, else hashed fallback)');

  console.log('othk-20: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
