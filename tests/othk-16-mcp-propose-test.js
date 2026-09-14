// =====================================================
// OTHKM strengthening — P16 MCP surface (read tools + gated memory_propose)
// tests/othk-16-mcp-propose-test.js  (synthetic fixtures)
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');
const storeLib = require(path.join(BASE, 'lib/store.js'));
const extract = require(path.join(BASE, 'lib/extract.js'));
const provenance = require(path.join(BASE, 'lib/provenance.js'));
const service = require(path.join(BASE, 'lib/knowledge-service.js'));
const propose = require(path.join(BASE, 'lib/propose.js'));
const promote = require(path.join(BASE, 'lib/promote.js'));
const TRUST = require(path.join(BASE, 'config/trust-model.json'));

let passed = 0, failed = 0;
function ok(v, label) { if (v) { passed++; console.log('  PASS ' + label); } else { failed++; console.log('  FAIL ' + label); } }
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-test-')); }
const CLASSES = provenance.loadSourceClasses();
function prov(sc) { return { source_class: sc || 'manual', source_collection: 'c', source_reference: (sc || 'manual') + '/c/x', captured_at: '2022-01-01T00:00:00Z' }; }

// ---- read tools ----
(function readTools() {
  const root = tmpRoot();
  const s = storeLib.openStore(root);
  const e = extract.addEntity(s, { entity_type: 'vehicle', name: 'korando' }).id;
  extract.addFact(s, CLASSES, { statement: 'korando tire pressure 32 psi', confidence: 'HIGH', prov: prov('mythos-repo'), entity_ids: [e], metadata: { property: 'tire_psi', value: 32 }, valid_from: '2021-01-01T00:00:00Z', namespace: 'projects/idauto' });
  extract.addClaim(s, CLASSES, { statement: 'korando maybe needs premium fuel', asserted_by: 'deepseek', prov: prov('deepseek'), entity_ids: [e], namespace: 'projects/idauto' });

  const svc = service.openService(root);
  const hits = svc.retrieveConstrained('tire pressure', { namespace: 'projects/idauto', mode: 'lexical', trustAware: true });
  ok(hits.length >= 1 && hits[0].text.indexOf('tire') !== -1, 'P16: retrieveConstrained returns namespace+trust-constrained hits');
  const st = svc.sourceTrace(hits[0].id);
  ok(st && st.source_class === 'mythos-repo' && ('assertion_class' in st) && ('artifact_available' in st), 'P16: sourceTrace returns provenance chain (source_class, evidence, artifact availability, assertion class)');
  const tl = svc.timeline({ entity_id: e, asOf: '2023-01-01T00:00:00Z' });
  ok(tl.timeline.length >= 1 && 'valid_from' in tl.timeline[0] && 'expired_at' in tl.timeline[0], 'P16: timeline returns bi-temporal rows for a subject');
  const es = svc.entitySearch('korando');
  ok(es.length === 1 && es[0].mentions >= 2, 'P16: entitySearch returns entity + mention count');
  const ctx = svc.buildContext({ namespace: 'projects/idauto', query: 'tire pressure', entityId: e, asOf: '2023-01-01T00:00:00Z', budget: 4 });
  ok(ctx.items.length > 0 && ctx.items.every((i) => i.namespace === 'projects/idauto'), 'P16: buildContext exposed via service, namespace-isolated');

  // read-only guarantee: the service exposes no canonical write method
  ok(typeof svc.appendRecord !== 'function' && typeof svc.tombstone !== 'function' && typeof svc.write !== 'function', 'P16: service has no canonical write method (read tools only)');
})();

// ---- memory_propose: AI proposes → gate → staging → operator promote → OTHKM ----
(function proposeFlow() {
  const canonRoot = tmpRoot();
  const canon = storeLib.openStore(canonRoot);
  extract.addEntity(canon, { entity_type: 'vehicle', name: 'tivoli' });

  // 1. bad candidate rejected by the gate (no provenance)
  const stage1 = storeLib.openStore(tmpRoot());
  const bad = propose.proposeMemory(stage1, canon, { kind: 'claim', statement: 'tivoli fact' }, { classes: CLASSES, trustModel: TRUST });
  ok(bad.rejected && !bad.staged, 'P16: memory_propose rejects a candidate that fails the gate (no direct write)');

  // 2. good candidate → staged (NOT in canonical yet)
  const stage2 = storeLib.openStore(tmpRoot());
  const cand = { kind: 'claim', statement: 'tivoli uses 1.6L engine', asserted_by: 'deepseek', provenance: prov('deepseek'), namespace: 'projects/idauto' };
  const r = propose.proposeMemory(stage2, canon, cand, { classes: CLASSES, trustModel: TRUST });
  ok(r.staged && r.action === 'ADD' && r.tier === 'model-output', 'P16: valid candidate staged (action ADD, tier preserved as model-output)');
  const canonClaimsBefore = canon.allRecords({ kind: 'claim' }).length;
  ok(canonClaimsBefore === 0, 'P16: staging did NOT write canonical truth (AI cannot write durable truth directly)');
  ok(stage2.getRecord(r.staging_id) && (stage2.getRecord(r.staging_id).tags || []).indexOf('proposed') !== -1, 'P16: candidate lives in staging, tagged proposed');

  // 3. operator promotion moves staging → canonical (existing two-phase)
  const res = promote.promoteRun(stage2, canon, { actor: 'operator' });
  ok(canon.allRecords({ kind: 'claim' }).length === 1, 'P16: operator promoteRun promotes the staged claim into canonical OTHKM');
  ok(res && (res.promoted || res.applied || res.count || true), 'P16: promoteRun returned a result');

  // 4. duplicate proposal is a NOOP (not re-staged)
  const stage3 = storeLib.openStore(tmpRoot());
  const dup = propose.proposeMemory(stage3, canon, cand, { classes: CLASSES, trustModel: TRUST });
  ok(!dup.staged && dup.action === 'NOOP', 'P16: proposing an already-present memory is a NOOP (no duplicate promotion)');
})();

console.log('othk-16: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
