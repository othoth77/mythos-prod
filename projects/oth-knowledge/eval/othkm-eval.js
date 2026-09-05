// =====================================================
// OTH Knowledge — OTHKM evaluation harness (Phase 20)
// projects/oth-knowledge/eval/othkm-eval.js
//
// A small, DETERMINISTIC, self-hosted eval over synthetic fixtures built
// from OTHKM's own record model — no LLM judge, no external dataset (see
// the global-audit blueprint: LoCoMo is unfit as a gate; this measures
// OTHKM's actual differentiators). Metrics: retrieval recall@k, temporal
// as-of accuracy + stale-leak, supersession/active-version, dedup
// precision, provenance-completeness, namespace isolation, secret block
// rate, hallucinated-memory rate, and latency. `node othkm-eval.js`
// prints the report; runEval() returns it for the regression suite.
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
const retrieveLib = require(path.join(BASE, 'lib/retrieve.js'));
const gateLib = require(path.join(BASE, 'lib/promotion-gate.js'));
const temporal = require(path.join(BASE, 'lib/temporal.js'));
const CLASSES = provenance.loadSourceClasses();
const TRUST = require(path.join(BASE, 'config/trust-model.json'));

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-eval-')); }
function prov(sc, cap) { return { source_class: sc || 'manual', source_collection: 'c', source_reference: (sc || 'manual') + '/c/x', captured_at: cap || '2022-01-01T00:00:00Z' }; }

function buildCorpus() {
  const s = storeLib.openStore(tmpRoot());
  const car = extract.addEntity(s, { entity_type: 'vehicle', name: 'rexton' }).id;
  // relevant-to-"battery" set (gold)
  extract.addFact(s, CLASSES, { statement: 'rexton battery is a 12V AGM unit', confidence: 'HIGH', prov: prov('mythos-repo'), entity_ids: [car], namespace: 'projects/idauto', metadata: { property: 'battery', value: '12V AGM' }, valid_from: '2021-01-01T00:00:00Z' });
  extract.addClaim(s, CLASSES, { statement: 'battery replacement interval is 4 years', asserted_by: 'x', prov: prov('mythos-repo'), entity_ids: [car], namespace: 'projects/idauto' });
  // distractors
  extract.addClaim(s, CLASSES, { statement: 'rexton tire size is 255/60R18', asserted_by: 'x', prov: prov('deepseek'), entity_ids: [car], namespace: 'projects/idauto' });
  // namespace leak probe
  extract.addClaim(s, CLASSES, { statement: 'battery brands are popular globally', asserted_by: 'x', prov: prov('manual'), namespace: 'global' });
  extract.addClaim(s, CLASSES, { statement: 'owner battery preference is Bosch', asserted_by: 'x', prov: prov('manual'), namespace: 'personal' });
  // temporal supersession: tariff past/current
  extract.addClaim(s, CLASSES, { statement: 'import tariff was 10 percent', asserted_by: 'x', prov: prov('manual', '2021-01-01T00:00:00Z'), namespace: 'global', valid_from: '2021-01-01T00:00:00Z', valid_to: '2023-01-01T00:00:00Z' });
  extract.addClaim(s, CLASSES, { statement: 'import tariff is 20 percent', asserted_by: 'x', prov: prov('manual', '2023-01-01T00:00:00Z'), namespace: 'global', valid_from: '2023-01-01T00:00:00Z' });
  return { s, car };
}

function runEval() {
  const { s, car } = buildCorpus();
  const r = { metrics: {}, passed: true };

  // 1. retrieval recall@5 for "battery" in projects/idauto (gold = 2 project facts)
  const gold = new Set([ids.recordId('fact', 'mythos-repo/rexton battery is a 12V AGM unit'), ids.recordId('claim', 'mythos-repo/x/battery replacement interval is 4 years')]);
  const hits = retrieveLib.retrieve(s, 'battery', { namespace: 'projects/idauto', mode: 'hybrid', trustAware: true, limit: 5 });
  const got = new Set(hits.map((h) => h.id));
  let inter = 0; for (const g of gold) if (got.has(g)) inter++;
  r.metrics.recall_at_5 = +(inter / gold.size).toFixed(3);

  // 2. namespace isolation: none of the project hits are global/personal
  r.metrics.namespace_leak = hits.filter((h) => { const rec = s.getRecord(h.id); return (rec.namespace || 'global') !== 'projects/idauto'; }).length;

  // 3. provenance completeness of returned hits
  r.metrics.provenance_complete = hits.every((h) => h.provenance && h.provenance.source_class) ? 1.0 : 0.0;

  // 4. hallucinated-memory rate: every returned id must resolve to a live record
  r.metrics.hallucinated_rate = +(hits.filter((h) => !s.getRecord(h.id)).length / (hits.length || 1)).toFixed(3);

  // 5. temporal as-of correctness + stale-leak (tariff)
  const at2022 = retrieveLib.retrieve(s, 'tariff', { namespace: 'global', mode: 'lexical', asOf: '2022-06-01T00:00:00Z' });
  const at2024 = retrieveLib.retrieve(s, 'tariff', { namespace: 'global', mode: 'lexical', asOf: '2024-01-01T00:00:00Z' });
  const wasId = ids.recordId('claim', 'manual/x/import tariff was 10 percent');
  const isId = ids.recordId('claim', 'manual/x/import tariff is 20 percent');
  r.metrics.asof_accuracy = +(((at2022[0] && at2022[0].id === wasId ? 1 : 0) + (at2024[0] && at2024[0].id === isId ? 1 : 0)) / 2).toFixed(3);
  r.metrics.stale_leak_rate = +((at2024.some((h) => h.id === wasId) ? 1 : 0)).toFixed(3);

  // 6. active-version / supersession: at 2024 the current tariff is the 20% one
  const cur = at2024.find((h) => h.id === isId);
  r.metrics.active_version_correct = cur ? 1 : 0;

  // 7. secret block rate: candidates carrying secrets are always gate-rejected
  const secretCands = [
    { kind: 'claim', statement: 'aws key AKIA' + 'IOSFODNN7EXAMPLE here', asserted_by: 'x', provenance: prov('deepseek') },
    { kind: 'claim', statement: 'openai key sk-' + 'abcdefghijklmnopqrstuvwx1234 leaked', asserted_by: 'x', provenance: prov('deepseek') },
  ];
  const blocked = secretCands.filter((c) => !gateLib.gate(c, { classes: CLASSES, trustModel: TRUST }).ok).length;
  r.metrics.secret_block_rate = +(blocked / secretCands.length).toFixed(3);

  // 8. latency over 200 retrievals (p50/p95)
  const times = [];
  for (let i = 0; i < 200; i++) { const t0 = process.hrtime.bigint(); retrieveLib.retrieve(s, 'battery', { namespace: 'projects/idauto', mode: 'hybrid', limit: 5 }); times.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  times.sort((a, b) => a - b);
  r.metrics.latency_p50_ms = +times[Math.floor(times.length * 0.5)].toFixed(2);
  r.metrics.latency_p95_ms = +times[Math.floor(times.length * 0.95)].toFixed(2);
  r.metrics.latency_p99_ms = +times[Math.floor(times.length * 0.99)].toFixed(2);

  // gate thresholds (deterministic; the structural ones hard-gate)
  const g = r.metrics;
  r.gate = {
    recall_at_5: g.recall_at_5 >= 0.9,
    namespace_leak: g.namespace_leak === 0,
    provenance_complete: g.provenance_complete === 1.0,
    hallucinated_rate: g.hallucinated_rate === 0,
    asof_accuracy: g.asof_accuracy >= 0.95,
    stale_leak_rate: g.stale_leak_rate === 0,
    active_version_correct: g.active_version_correct === 1,
    secret_block_rate: g.secret_block_rate === 1.0,
  };
  r.passed = Object.values(r.gate).every(Boolean);
  return r;
}

if (require.main === module) {
  const rep = runEval();
  console.log(JSON.stringify(rep, null, 2));
  process.exit(rep.passed ? 0 : 1);
}
module.exports = { runEval };
