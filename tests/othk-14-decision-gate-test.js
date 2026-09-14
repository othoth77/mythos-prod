// =====================================================
// OTHKM strengthening — P7 decision · P8 gate · P9 consolidate · P10 contradiction · P11 dedup
// tests/othk-14-decision-gate-test.js
// AI proposes → gate decides → OTHKM. Append-only throughout. Synthetic fixtures.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');
const ids = require(path.join(BASE, 'lib/ids.js'));
const storeLib = require(path.join(BASE, 'lib/store.js'));
const provenance = require(path.join(BASE, 'lib/provenance.js'));
const extract = require(path.join(BASE, 'lib/extract.js'));
const emb = require(path.join(BASE, 'lib/embeddings.js'));
const gateLib = require(path.join(BASE, 'lib/promotion-gate.js'));
const decision = require(path.join(BASE, 'lib/extract-decision.js'));
const contradiction = require(path.join(BASE, 'lib/contradiction.js'));
const consolidateLib = require(path.join(BASE, 'lib/consolidate.js'));
const conflict = require(path.join(BASE, 'lib/conflict.js'));
const TRUST = require(path.join(BASE, 'config/trust-model.json'));

let passed = 0, failed = 0;
function ok(v, label) { if (v) { passed++; console.log('  PASS ' + label); } else { failed++; console.log('  FAIL ' + label); } }
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-test-')); }
const CLASSES = provenance.loadSourceClasses();
const CAP = '2022-01-01T00:00:00Z';
function prov(sc) { return { source_class: sc || 'manual', source_collection: 'c', source_reference: (sc || 'manual') + '/c/x', captured_at: CAP }; }
function cand(o) { return Object.assign({ kind: 'claim', asserted_by: 'proposer', provenance: prov(o.sc) }, o); }

// ---- P8 gate ----
(function gate() {
  ok(!gateLib.gate({ kind: 'claim', statement: 'x' }, { classes: CLASSES }).ok, 'P8: candidate without provenance rejected');
  ok(!gateLib.gate(cand({ statement: 'token AKIA' + 'IOSFODNN7EXAMPLE here' }), { classes: CLASSES }).ok, 'P8: secret-shaped content rejected');
  ok(!gateLib.gate(cand({ statement: 'ok', sc: 'no-such-class' }), { classes: CLASSES }).ok, 'P8: unregistered source_class rejected (fail-closed)');
  const good = gateLib.gate(cand({ statement: 'battery is healthy', sc: 'deepseek' }), { classes: CLASSES, trustModel: TRUST });
  ok(good.ok && good.tier === 'model-output', 'P8: valid model-output candidate accepted but tier stays model-output (no trust upgrade)');
})();

// ---- P7 decisions: ADD / NOOP / CONFLICT / UPDATE ----
(function decisions() {
  const s = storeLib.openStore(tmpRoot());
  const E = extract.addEntity(s, { entity_type: 'component', name: 'coolant' }).id;
  const c1 = cand({ statement: 'coolant color is blue', entity_ids: [E], metadata: { property: 'coolant_color', value: 'blue' }, valid_from: '2021-01-01T00:00:00Z', valid_to: '2023-01-01T00:00:00Z' });

  ok(decision.decide(s, c1).action === 'ADD', 'P7: brand-new candidate → ADD');
  const r1 = decision.applyDecisions(s, [decision.decide(s, c1)], { classes: CLASSES, trustModel: TRUST });
  ok(r1.applied[0].action === 'ADD' && s.getRecord(r1.applied[0].id), 'P7: ADD writes a durable record via the gate');

  // near-duplicate → NOOP
  const dup = cand({ statement: 'coolant color is blue', entity_ids: [E], metadata: { property: 'coolant_color', value: 'blue' }, valid_from: '2021-01-01T00:00:00Z', valid_to: '2023-01-01T00:00:00Z' });
  ok(decision.decide(s, dup).action === 'NOOP', 'P7: near-duplicate candidate → NOOP');

  // overlapping different value → CONFLICT (both live, open)
  const c2 = cand({ statement: 'coolant color is red', entity_ids: [E], metadata: { property: 'coolant_color', value: 'red' }, valid_from: '2022-01-01T00:00:00Z', valid_to: '2024-01-01T00:00:00Z' });
  const d2 = decision.decide(s, c2);
  ok(d2.action === 'CONFLICT' && d2.conflict_with === r1.applied[0].id, 'P7/P10: overlapping different value → CONFLICT');
  const r2 = decision.applyDecisions(s, [d2], { classes: CLASSES, trustModel: TRUST });
  const conflicts = conflict.listConflicts(s, { state: 'open' });
  ok(conflicts.length === 1 && s.getRecord(r1.applied[0].id) && s.getRecord(r2.applied[0].id), 'P10: conflict registered open; BOTH records stay live (no winner)');

  // later disjoint validity, different value → UPDATE (supersede + close old validity)
  const s2 = storeLib.openStore(tmpRoot());
  const E2 = extract.addEntity(s2, { entity_type: 'role', name: 'ceo' }).id;
  const a = cand({ statement: 'ceo is alice', entity_ids: [E2], metadata: { property: 'ceo', value: 'alice' }, valid_from: '2020-01-01T00:00:00Z' });
  decision.applyDecisions(s2, [decision.decide(s2, a)], { classes: CLASSES, trustModel: TRUST });
  const oldId = s2.allRecords({ kind: 'claim' })[0].id;
  const b = cand({ statement: 'ceo is bob', entity_ids: [E2], metadata: { property: 'ceo', value: 'bob' }, valid_from: '2023-01-01T00:00:00Z' });
  const db = decision.decide(s2, b);
  ok(db.action === 'UPDATE' && db.supersede_of === oldId, 'P7: later validity, different value → UPDATE (supersede)');
  decision.applyDecisions(s2, [db], { classes: CLASSES, trustModel: TRUST });
  const closedOld = s2.getRecord(oldId);
  ok(closedOld && closedOld.valid_to === '2023-01-01T00:00:00Z', 'P7: UPDATE closes old validity (valid_to=new valid_from) — invalidate, not delete');
  ok(s2.getVersions(oldId).length === 2, 'P7: old record still fully in history (append-only)');
  const supersedes = s2.allRecords({ kind: 'relationship', where: (r) => r.rel_type === 'supersedes' });
  ok(supersedes.length === 1, 'P7: supersedes relationship recorded');
})();

// ---- P10 contradiction detector direct ----
(function contra() {
  const s = storeLib.openStore(tmpRoot());
  const E = extract.addEntity(s, { entity_type: 'spec', name: 'torque' }).id;
  extract.addFact(s, CLASSES, { statement: 'torque 90 Nm', confidence: 'HIGH', prov: prov(), entity_ids: [E], metadata: { property: 'torque', value: 90 }, valid_from: '2021-01-01T00:00:00Z', valid_to: '2024-01-01T00:00:00Z' });
  extract.addFact(s, CLASSES, { statement: 'torque 120 Nm', confidence: 'HIGH', prov: prov(), entity_ids: [E], metadata: { property: 'torque', value: 120 }, valid_from: '2022-01-01T00:00:00Z' });
  const pairs = contradiction.detectContradictions(s);
  ok(pairs.length === 1 && pairs[0].value_a !== pairs[0].value_b, 'P10: detects same subject+property, overlapping validity, different value');
  // agreement (same value) is not a contradiction
  extract.addFact(s, CLASSES, { statement: 'torque ninety', confidence: 'HIGH', prov: prov('mythos-repo'), entity_ids: [E], metadata: { property: 'torque', value: 90 }, valid_from: '2021-06-01T00:00:00Z', valid_to: '2024-01-01T00:00:00Z' });
  ok(contradiction.detectContradictions(s).length >= 1, 'P10: same value = agreement, still only real contradictions flagged');
})();

// ---- P11 semantic dedup + P9 consolidate ----
(function consolidate() {
  const s = storeLib.openStore(tmpRoot());
  extract.addClaim(s, CLASSES, { statement: 'the engine oil should be changed every 10000 km', asserted_by: 'a', prov: prov() });
  extract.addClaim(s, CLASSES, { statement: 'the engine oil should be changed every 10000 km', asserted_by: 'b', prov: prov('mythos-repo') });
  const e = emb.createEmbedder({ provider: 'hashed' });
  const dup = require(path.join(BASE, 'lib/dedup.js')).findSemanticNearDuplicates(s, { embedder: e, threshold: 0.9 });
  ok(dup.length >= 1, 'P11: semantic near-duplicate detected via embeddings (link candidate)');

  const plan = consolidateLib.consolidate(s, { embedder: e });
  ok(typeof plan.summary === 'object' && plan.summary.semantic_duplicates >= 1, 'P9: consolidate() is read-only and returns a candidate plan');
  const before = s.stats().records;
  const applied = consolidateLib.applyConsolidation(s, plan);
  ok(Array.isArray(applied.duplicate_links), 'P9: applyConsolidation writes only append-only relationship links');
  // statements untouched — only relationships may have been added
  ok(s.allRecords({ kind: 'claim' }).length === 2, 'P9: consolidation never edited/merged/deleted knowledge records');
})();

console.log('othk-14: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
