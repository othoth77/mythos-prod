// =====================================================
// OTHKM strengthening — P20 evaluation · P21 security
// tests/othk-18-eval-security-test.js
// Runs the deterministic eval harness and asserts the security invariants.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');
const storeLib = require(path.join(BASE, 'lib/store.js'));
const extract = require(path.join(BASE, 'lib/extract.js'));
const provenance = require(path.join(BASE, 'lib/provenance.js'));
const retrieveLib = require(path.join(BASE, 'lib/retrieve.js'));
const gateLib = require(path.join(BASE, 'lib/promotion-gate.js'));
const propose = require(path.join(BASE, 'lib/propose.js'));
const service = require(path.join(BASE, 'lib/knowledge-service.js'));
const evalHarness = require(path.join(BASE, 'eval/othkm-eval.js'));
const TRUST = require(path.join(BASE, 'config/trust-model.json'));

let passed = 0, failed = 0;
function ok(v, label) { if (v) { passed++; console.log('  PASS ' + label); } else { failed++; console.log('  FAIL ' + label); } }
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-test-')); }
const CLASSES = provenance.loadSourceClasses();
function prov(sc) { return { source_class: sc || 'manual', source_collection: 'c', source_reference: (sc || 'manual') + '/c/x', captured_at: '2022-01-01T00:00:00Z' }; }

// ---- P20 eval harness ----
(function evalP20() {
  const rep = evalHarness.runEval();
  console.log('  eval metrics: ' + JSON.stringify(rep.metrics));
  ok(rep.passed, 'P20: OTHKM eval harness passes all structural gates');
  ok(rep.metrics.recall_at_5 >= 0.9, 'P20: retrieval recall@5 >= 0.9');
  ok(rep.metrics.asof_accuracy >= 0.95 && rep.metrics.stale_leak_rate === 0, 'P20: temporal as-of correct, no stale leak');
  ok(rep.metrics.provenance_complete === 1 && rep.metrics.hallucinated_rate === 0, 'P20: provenance complete, zero hallucinated memories');
  ok(rep.metrics.secret_block_rate === 1, 'P20: secret block rate 1.0');
  ok(rep.metrics.latency_p95_ms < 100, 'P20: p95 latency within budget (' + rep.metrics.latency_p95_ms + 'ms)');
})();

// ---- P21 security ----
(function securityP21() {
  // cross-project leakage
  const s = storeLib.openStore(tmpRoot());
  extract.addClaim(s, CLASSES, { statement: 'secret project alpha budget is X', asserted_by: 'x', prov: prov(), namespace: 'projects/alpha' });
  extract.addClaim(s, CLASSES, { statement: 'project beta budget is Y', asserted_by: 'x', prov: prov(), namespace: 'projects/beta' });
  const betaView = retrieveLib.retrieve(s, 'budget', { namespace: 'projects/beta', mode: 'lexical' });
  ok(betaView.every((h) => (s.getRecord(h.id).namespace) === 'projects/beta'), 'P21: no cross-project leakage (beta query cannot see alpha)');

  // unauthorized canonical write: service exposes no write; propose stages only
  const svc = service.openService(s.root);
  ok(!('appendRecord' in svc) && !('tombstone' in svc) && !('importRecords' in svc), 'P21: read service has no unauthorized canonical write surface');
  const canon = storeLib.openStore(tmpRoot());
  const staging = storeLib.openStore(tmpRoot());
  propose.proposeMemory(staging, canon, { kind: 'claim', statement: 'x fact', asserted_by: 'ai', provenance: prov('deepseek') }, { classes: CLASSES, trustModel: TRUST });
  ok(canon.stats().records === 0, 'P21: AI proposal never writes canonical (no unauthorized write)');

  // secret / PII leakage blocked
  ok(!gateLib.gate({ kind: 'claim', statement: 'ghp_' + 'abcdefghijklmnopqrstuvwxyz012345 leaked', asserted_by: 'x', provenance: prov('deepseek') }, { classes: CLASSES }).ok, 'P21: secret-shaped memory blocked at the gate');

  // memory poisoning: low-trust cannot outrank authoritative on similarity
  const s2 = storeLib.openStore(tmpRoot());
  s2.appendRecord({ kind: 'claim', id: require(path.join(BASE, 'lib/ids.js')).recordId('claim', 'op'), statement: 'brake pad spec is ABS-9', asserted_by: 'x', provenance: prov('owner-report') });
  s2.appendRecord({ kind: 'claim', id: require(path.join(BASE, 'lib/ids.js')).recordId('claim', 'ai'), statement: 'brake pad spec is ABS-9', asserted_by: 'x', provenance: prov('deepseek') });
  const ranked = retrieveLib.retrieve(s2, 'brake pad spec', { mode: 'lexical', trustAware: true });
  ok(ranked[0].tier === 'first-party', 'P21: memory poisoning resisted — first-party outranks model-output at equal similarity');

  // false promotion: unprovenanced / unregistered candidate rejected
  ok(!gateLib.gate({ kind: 'claim', statement: 'no prov' }, { classes: CLASSES }).ok, 'P21: false promotion prevented (unprovenanced rejected)');
  ok(!gateLib.gate({ kind: 'claim', statement: 'x', asserted_by: 'a', provenance: prov('forged-class') }, { classes: CLASSES }).ok, 'P21: unregistered source class rejected');

  // trust escalation: a model-context proposal cannot claim a first-party class
  const escalate = gateLib.gate({ kind: 'claim', statement: 'owner said secret', asserted_by: 'ai', provenance: prov('owner-report') }, { classes: CLASSES, trustModel: TRUST, maxTier: 'model-output' });
  ok(!escalate.ok && escalate.reasons.some((r) => /escalation/.test(r)), 'P21: trust escalation refused (AI cannot self-declare first-party)');
  // but the same candidate with its true model-output class is fine
  ok(gateLib.gate({ kind: 'claim', statement: 'owner said secret', asserted_by: 'ai', provenance: prov('deepseek') }, { classes: CLASSES, trustModel: TRUST, maxTier: 'model-output' }).ok, 'P21: honest model-output candidate accepted under the cap');

  // temporal manipulation: asOf discipline cannot be bypassed
  let threw = false;
  try { svc.currentState({}); } catch (e) { threw = /asOf required/.test(e.message); }
  ok(threw, 'P21: temporal queries refuse to run without an explicit asOf (no wall-clock manipulation)');
})();

console.log('othk-18: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
