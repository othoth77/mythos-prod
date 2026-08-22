#!/usr/bin/env node
// =====================================================
// OTH-KNOWLEDGE LIVE GATE — canonical production-readiness gate
// tests/othk-live-gate.js
//
// One executable that proves, with first-hand evidence, every condition
// the OTH-KNOWLEDGE live activation depends on:
//
//   A. Knowledge core        — othk-0 suite (model/store/provenance/
//                              ingest/conflict/seed invariants), 0 failures.
//   B. Retrieval             — othk-1 suite + eval/run-eval.js measured
//                              thresholds re-enforced here from the JSON
//                              report (recall/MRR/provenance/integrity).
//   C. Service boundary      — the knowledge-service surface is EXACTLY
//                              the documented read allowlist; nothing
//                              write/ingest/mutate/tombstone-shaped is
//                              reachable; every hit carries provenance.
//   D. Trust boundary        — currentState/assessTrust refuse a missing
//                              asOf; trust reports are never truth
//                              values; claims are never presented as
//                              facts; quarantined state is preserved.
//   E. Executor boundary     — fail-closed config validation (unknown,
//                              credential/endpoint-shaped, relative and
//                              in-repo store roots, unreadable store);
//                              the executor facade is exactly READ_OPS,
//                              frozen.
//   F. Persistence           — the SHIPPED config decides the mode:
//                              enabled + store present on this host →
//                              open and read the real private store and
//                              prove reads leave it byte-identical;
//                              enabled + store absent (activated config,
//                              off the production host) → prove the
//                              fail-closed disable, then mechanics mode;
//                              disabled → record the owner-only
//                              provisioning blocker and prove the
//                              read/write separation mechanics on a
//                              gate-local out-of-repo store (operator
//                              CLI ingests; the executor facade cannot).
//   G. Data-source policy    — the closed source-class registry keeps
//                              google-contacts and external-provider
//                              metadata-only; Gemini/NotebookLM output
//                              never contains a `fact` record (claims
//                              are not silently promoted); the OTH-K2
//                              discovery record exists.
//
// Verdict:
//   exit 0, "LIVE PASS"           — every section green AND the shipped
//                                   config points at a real, readable,
//                                   out-of-repo private store.
//   exit 0, "READY — NOT LIVE"    — every executable section green, but
//                                   no readable live store on THIS host:
//                                   either the config is disabled (store
//                                   provisioning is an owner-only decision
//                                   this gate must never take) or it is
//                                   activated and the store lives on the
//                                   production host — run the gate there.
//                                   The gate never invents a store or
//                                   flips the config.
//   exit 1                        — any check failed.
//   exit 2 with --require-live    — all checks green but not LIVE (for
//                                   the owner's final activation run).
//
// The gate creates stores only under os.tmpdir() (outside the repo) and
// removes them; it never writes inside the repository and never touches
// projects/mythos-ai-executor/config/knowledge.json.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const KBASE = path.join(ROOT, 'projects', 'oth-knowledge');
const knowledge = require(path.join(ROOT, 'projects', 'mythos-ai-executor', 'lib', 'knowledge.js'));
const serviceLib = require(path.join(KBASE, 'lib', 'knowledge-service.js'));
const storeLib = require(path.join(KBASE, 'lib', 'store.js'));
const auditLib = require(path.join(KBASE, 'lib', 'audit.js'));
const provenanceLib = require(path.join(KBASE, 'lib', 'provenance.js'));
const gemini = require(path.join(KBASE, 'lib', 'importers', 'gemini.js'));
const notebooklm = require(path.join(KBASE, 'lib', 'importers', 'notebooklm.js'));
const { buildCorpus } = require(path.join(KBASE, 'eval', 'run-eval.js'));

let passed = 0, failed = 0;
const sections = [];
let current = null;
function section(name) { current = { name, passed: 0, failed: 0 }; sections.push(current); console.log('\n' + name); }
function ok(v, label) {
  if (v) { passed++; current.passed++; console.log('  PASS ' + label); }
  else { failed++; current.failed++; console.log('  FAIL ' + label); }
}
function expectError(fn, re, label) {
  try { fn(); ok(false, label + ' (expected refusal, but it succeeded)'); }
  catch (e) { ok(re.test(e.message), label + (re.test(e.message) ? '' : ' [got: ' + e.message + ']')); }
}
function tmpRoot(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-live-' + tag + '-')); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function storeFingerprint(root) {
  const records = path.join(root, 'records.jsonl');
  const objects = path.join(root, 'objects');
  const objectHashes = [];
  if (fs.existsSync(objects)) {
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p); else objectHashes.push(e.name + ':' + sha256(p));
      }
    })(objects);
  }
  return (fs.existsSync(records) ? sha256(records) : 'absent') + '|' + crypto.createHash('sha256').update(objectHashes.join('\n')).digest('hex');
}
function runSuite(file) {
  const out = execFileSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8' });
  const m = out.match(/(\d+) passed, (\d+) failed/);
  return { passed: m ? +m[1] : 0, failed: m ? +m[2] : (out ? 1 : 1), tail: out.trim().split('\n').pop() };
}

const ASOF = '2026-08-20T12:00:00Z';
// The documented read allowlist (docs/OTH_KNOWLEDGE_INTEGRATION.md §2).
const SERVICE_ALLOWLIST = [
  'search', 'retrieve', 'lookupEntity', 'lookupEvidence', 'lookupHistory',
  'lookupProvenance', 'findContradictions', 'currentState', 'assessTrust',
  'audit', 'stats',
];
const WRITE_SHAPED = /write|ingest|import|mutate|tombstone|delete|remove|create|update|put|set[A-Z]|seed|resolve|quarantine|append/i;

// ---------- A. Knowledge core ----------
section('§A knowledge core (othk-0 delegated)');
{
  const r = runSuite('othk-0-knowledge-core-test.js');
  ok(r.failed === 0 && r.passed > 0, 'othk-0 core invariants: ' + r.tail);
}

// ---------- B. Retrieval ----------
section('§B retrieval (othk-1 delegated + measured eval thresholds)');
{
  const r = runSuite('othk-1-search-test.js');
  ok(r.failed === 0 && r.passed > 0, 'othk-1 retrieval suite: ' + r.tail);

  const report = JSON.parse(execFileSync(process.execPath, [path.join(KBASE, 'eval', 'run-eval.js'), '--json'], { encoding: 'utf8' }));
  ok(report.integrity_ok === true, 'eval corpus integrity OK (' + report.corpus.records + ' records)');
  const R = report.results;
  ok(R.lexical.recall_at_k >= 0.9, 'lexical recall@5 >= 0.9 (measured ' + R.lexical.recall_at_k + ')');
  ok(R.lexical.mrr >= 0.8, 'lexical MRR >= 0.8 (measured ' + R.lexical.mrr + ')');
  ok(R.vector.recall_at_k >= 0.8, 'vector recall@5 >= 0.8 (measured ' + R.vector.recall_at_k + ')');
  ok(R.hybrid.recall_at_k >= 0.9, 'hybrid recall@5 >= 0.9 (measured ' + R.hybrid.recall_at_k + ')');
  ok(R.hybrid.mrr >= 0.8, 'hybrid MRR >= 0.8 (measured ' + R.hybrid.mrr + ')');
  ok(['lexical', 'vector', 'hybrid'].every((m) => R[m].provenance_ok), 'provenance present and valid on every evaluated hit, all modes');
  // exact-mode retrieval on a live-opened service (othk-1 §-covered, re-proven on this corpus below in §C/§D setup)
}

// ---------- shared corpus for C/D (out-of-repo temp store) ----------
const corpusRoot = tmpRoot('corpus');
const kb = buildCorpus(corpusRoot);
// One deliberately quarantined record for the §D preservation checks.
const anyFact = kb.store.allRecords({ kind: 'fact' })[0];
auditLib.quarantine(kb.store, anyFact.id, 'live-gate synthetic quarantine');

// ---------- C. Service boundary ----------
section('§C service boundary (read allowlist only, provenance on every hit)');
{
  const service = serviceLib.openService(corpusRoot);
  const names = Object.keys(service);
  ok(names.length === SERVICE_ALLOWLIST.length && SERVICE_ALLOWLIST.every((n) => typeof service[n] === 'function'),
    'service surface is exactly the ' + SERVICE_ALLOWLIST.length + '-operation documented read allowlist');
  ok(!names.some((n) => WRITE_SHAPED.test(n)), 'no write/import/ingest/mutate/tombstone-shaped operation is exposed');

  const hits = service.search('deployment coolify', { mode: 'hybrid', limit: 10 });
  ok(hits.length > 0, 'hybrid search returns hits on the corpus');
  // Provenance is mandatory on every knowledge-bearing kind; `entity`
  // records are identity nodes and the only kind outside the audit set.
  ok(hits.every((h) => auditLib.AUDITED_KINDS.indexOf(h.kind) === -1 || (h.provenance && h.provenance.source_class)),
    'every knowledge-bearing service hit carries provenance with a source class');
  ok(hits.some((h) => h.provenance && h.provenance.source_class), 'provenance-bearing hits present in the result set');
  const exact = service.search('rsync', { mode: 'exact', limit: 10 });
  const lex = service.search('storage pipeline', { mode: 'lexical', limit: 10 });
  ok(exact.length > 0 && lex.length > 0, 'exact and lexical modes both retrieve on the corpus');
  const audited = auditLib.auditHits(kb.store, hits);
  ok(audited.failures.length === 0, 'provenance audit of returned hits: 0 failures (' + audited.checked + ' checked)');
}

// ---------- D. Trust boundary ----------
section('§D trust boundary (explicit asOf, claims never facts, quarantine preserved)');
{
  const service = serviceLib.openService(corpusRoot);
  expectError(() => service.currentState({}), /asOf required/, 'currentState refuses a missing asOf');
  expectError(() => service.assessTrust(anyFact.id, {}), /asOf required/, 'assessTrust refuses a missing asOf');

  const trust = service.assessTrust(anyFact.id, { asOf: ASOF });
  ok(trust && trust.not_a_truth_value === true, 'trust report is explicitly not a truth value');

  const claims = kb.store.allRecords({ kind: 'claim' });
  ok(claims.length > 0, 'corpus contains claim records (NotebookLM-derived)');
  const claimTrust = service.assessTrust(claims[0].id, { asOf: ASOF });
  ok(claimTrust.statement_category !== 'fact' && /claim/i.test(String(claimTrust.statement_category)),
    'a claim is categorised as a claim, never as a fact (' + claimTrust.statement_category + ')');

  const quarantined = service.retrieve(anyFact.id);
  ok(quarantined && quarantined.quarantined === true, 'quarantined record retrieves WITH its quarantine state');
  const prov = service.lookupProvenance(anyFact.id);
  ok(prov && prov.quarantined === true, 'lookupProvenance preserves quarantine state');
  const history = service.lookupHistory(anyFact.id);
  ok(history.length >= 2, 'quarantine is a new version — history preserved (' + history.length + ' versions)');
}

// ---------- E. Executor boundary ----------
section('§E executor boundary (fail-closed config, READ_OPS only, frozen)');
{
  const v = knowledge.validateConfigObject;
  const base = { enabled: false, store_root: null, description: 'live-gate config' };
  ok(v(base).valid && !v(base).enabled, 'shipped-shaped disabled config is valid and disabled');
  ok(!v(Object.assign({}, base, { extra_field: 1 })).valid, 'unknown field fails the WHOLE config closed');
  const nestedCred = Object.assign({}, base, { description: 'x' });
  nestedCred.enabled = false; nestedCred.store_root = null; nestedCred.description = 'y';
  const poisoned = { enabled: false, store_root: null, description: 'y', nested: { api_token: 'x' } };
  ok(!v(poisoned).valid, 'credential-shaped key at depth fails closed (api_token)');
  ok(!v({ enabled: true, store_root: 'relative/store', description: 'y' }).valid, 'relative store_root fails closed');
  ok(!v({ enabled: true, store_root: path.join(ROOT, 'projects', 'oth-knowledge', 'data'), description: 'y' }).valid,
    'in-repository store_root fails closed');
  ok(!v({ enabled: true, store_root: 'https://example.invalid/kb', description: 'y' }).valid, 'url-shaped store_root fails closed (not absolute path)');

  const missing = knowledge.openKnowledge({ config: { enabled: true, store_root: path.join(os.tmpdir(), 'othk-live-definitely-missing-' + process.pid), description: 'y' } });
  ok(missing.enabled === false && /does not exist/.test(missing.reason), 'unreadable/absent store opens fail-closed, not partially');

  const open = knowledge.openKnowledge({ config: { enabled: true, store_root: corpusRoot, description: 'live-gate corpus' } });
  ok(open.enabled === true, 'executor facade opens over a valid out-of-repo store');
  const opNames = Object.keys(open.ops).sort();
  ok(opNames.join(',') === knowledge.READ_OPS.slice().sort().join(','), 'executor surface is EXACTLY the READ_OPS allowlist (' + opNames.length + ' ops)');
  ok(Object.isFrozen(open.ops), 'executor op surface is frozen');
  ok(!opNames.some((n) => WRITE_SHAPED.test(n)), 'no write-shaped operation reachable from the executor');
  expectError(() => open.ops.currentState({}), /MYTHOS_KNOWLEDGE_ASOF/, 'executor-side currentState asOf guard holds');
  expectError(() => open.ops.assessTrust(anyFact.id, {}), /MYTHOS_KNOWLEDGE_ASOF/, 'executor-side assessTrust asOf guard holds');
  const hits = open.ops.search('deployment coolify', { mode: 'hybrid', limit: 10 });
  ok(hits.length > 0 && hits.every((h) => h.presentation && (auditLib.AUDITED_KINDS.indexOf(h.kind) === -1 || h.provenance)),
    'every executor hit carries a presentation annotation; knowledge-bearing hits carry provenance');
  ok(hits.every((h) => typeof h.presentation.is_claim === 'boolean'), 'is_claim stamped on every hit (claims never presentable as facts)');
  const qHit = open.ops.search('rsync windows deployment', { mode: 'hybrid', limit: 50 }).find((h) => h.id === anyFact.id);
  ok(!qHit || qHit.presentation.quarantined === true, 'quarantined record never surfaces without its quarantine flag');
}

// ---------- F. Persistence (read/write separation; live store if configured) ----------
section('§F persistence — private store separation' );
let live = false;
let liveBlocker = null;
{
  const shipped = knowledge.loadConfig();
  ok(shipped.valid, 'shipped config/knowledge.json parses and validates');

  let mechanicsMode = false;
  if (shipped.enabled && fs.existsSync(shipped.store_root)) {
    // LIVE MODE: the activated config points at a store present on THIS host.
    const real = knowledge.openKnowledge();
    ok(real.enabled === true, 'configured private store opens: ' + (real.store_root || real.reason));
    if (real.enabled) {
      ok(real.store_root.indexOf(ROOT + path.sep) !== 0 && real.store_root !== ROOT, 'configured store lives OUTSIDE the repository');
      const before = storeFingerprint(real.store_root);
      const st = real.ops.stats();
      ok(st && typeof st.records === 'number' && st.records > 0, 'real store readable: ' + st.records + ' records');
      real.ops.search('mythos', { mode: 'hybrid', limit: 5 });
      real.ops.currentState({ asOf: ASOF });
      real.ops.audit();
      const after = storeFingerprint(real.store_root);
      ok(before === after, 'full read pass leaves the real store byte-identical (executor cannot mutate it)');
      live = failed === 0;
    }
  } else if (shipped.enabled) {
    // ACTIVATED, but the canonical store lives on the production host and
    // this is not it. The designed behavior is a fail-closed disable —
    // prove it, then prove the separation mechanics locally. LIVE PASS can
    // only be produced by running this gate on the host that has the store.
    ok(path.isAbsolute(shipped.store_root) && shipped.store_root.indexOf(ROOT + path.sep) !== 0 && shipped.store_root !== ROOT,
      'activated store_root is absolute and outside the repository: ' + shipped.store_root);
    const offHost = knowledge.openKnowledge();
    ok(offHost.enabled === false && /does not exist/.test(offHost.reason),
      'activated config + absent store on this host → layer disables fail-closed, not an error');
    liveBlocker = 'activated store_root (' + shipped.store_root + ') is not present on this host — run this gate ON the production host (`node tests/othk-live-gate.js --require-live`) for the LIVE PASS verdict';
    console.log('  INFO activated config, store on another host — mechanics mode; on-host run required for LIVE');
    mechanicsMode = true;
  } else {
    liveBlocker = 'persistent private store unprovisioned — config ships enabled=false/store_root=null; provisioning the store root (outside Git, e.g. /home/deploy/othk-store on the VPS) and flipping config/knowledge.json is an OWNER-ONLY action this gate must not take';
    console.log('  INFO shipped config is disabled — live-store checks run in mechanics mode; blocker recorded');
    mechanicsMode = true;
  }
  if (mechanicsMode) {
    // Mechanics mode: prove the separation contract on a gate-local,
    // out-of-repo store, provisioned the way the operator would (CLI).
    const opRoot = tmpRoot('operator');
    const cli = path.join(KBASE, 'cli', 'othk-cli.js');
    execFileSync(process.execPath, [cli, '--store', opRoot, 'seed', path.join(KBASE, 'seeds', 'infrastructure-2026-08-19.json')], { encoding: 'utf8' });
    const validate1 = JSON.parse(execFileSync(process.execPath, [cli, '--store', opRoot, 'validate'], { encoding: 'utf8' }));
    ok(validate1.ok === true, 'operator CLI provisions and seeds a store; validate ok=true');

    const facade = knowledge.openKnowledge({ config: { enabled: true, store_root: opRoot, description: 'live-gate operator store' } });
    ok(facade.enabled === true, 'executor opens the operator-provisioned store read-only');
    const before = storeFingerprint(opRoot);
    const st = facade.ops.stats();
    facade.ops.search('rsync windows', { mode: 'hybrid', limit: 5 });
    facade.ops.currentState({ asOf: ASOF });
    facade.ops.audit();
    facade.ops.findContradictions({ state: 'open' });
    const after = storeFingerprint(opRoot);
    ok(before === after, 'every executor read op leaves records.jsonl + objects/ byte-identical');
    ok(st.records > 0, 'executor reads the seeded knowledge (' + st.records + ' records)');

    // The CLI remains the only ingestion path: it CAN grow the store...
    execFileSync(process.execPath, [cli, '--store', opRoot, 'ingest', path.join(KBASE, 'fixtures', 'manual', 'deploy-notes.md'), '--class', 'manual'], { encoding: 'utf8' });
    const validate2 = JSON.parse(execFileSync(process.execPath, [cli, '--store', opRoot, 'validate'], { encoding: 'utf8' }));
    const grown = storeFingerprint(opRoot);
    ok(validate2.ok === true && grown !== after, 'operator CLI ingestion path works and is the only path that changes the store');
    fs.rmSync(opRoot, { recursive: true, force: true });
  }
}

// ---------- G. Data-source policy (OTH-K2 discovery decisions) ----------
section('§G data-source policy (no silent promotion to fact status)');
{
  const registry = provenanceLib.loadSourceClasses();
  const cls = registry.classes || registry;
  ok(!!cls['google-contacts'] && cls['google-contacts'].policy === 'metadata-only', 'google-contacts remains metadata-only (fail-closed PII policy)');
  ok(!!cls['external-provider'] && cls['external-provider'].policy === 'metadata-only', 'external-provider default remains metadata-only (fail-closed)');
  ok(!!cls['gemini'] && !!cls['notebooklm'] && !!cls['google-takeout'], 'Gemini, NotebookLM and Takeout remain independent declared source classes');
  ok(Object.keys(cls).every((k) => ['content', 'metadata-only'].indexOf(cls[k].policy) !== -1), 'every class carries an explicit closed-enum policy');

  const gRoot = tmpRoot('sources');
  try {
    const S = storeLib.openStore(gRoot);
    const classes = provenanceLib.loadSourceClasses();
    gemini.importExport(S, classes, { bytes: fs.readFileSync(path.join(KBASE, 'fixtures', 'gemini', 'gemini-conversations.json')), filename: 'gemini-conversations.json', captured_at: ASOF, collection: 'gate-gemini' });
    ok(S.allRecords({ kind: 'fact' }).length === 0 && S.allRecords({ kind: 'claim' }).length === 0,
      'Gemini import produces NO fact and NO claim records (artifacts/chunks only — model output is never promoted)');
    notebooklm.importNote(S, classes, { bytes: fs.readFileSync(path.join(KBASE, 'fixtures', 'notebooklm', 'notebook-note.md')), filename: 'notebook-note.md', captured_at: ASOF, observed_at: '2026-05-01T00:00:00Z', collection: 'gate-nblm' });
    const nblmFacts = S.allRecords({ kind: 'fact' });
    const nblmClaims = S.allRecords({ kind: 'claim' });
    ok(nblmClaims.length > 0 && nblmFacts.length === 0,
      'NotebookLM import yields claims only (' + nblmClaims.length + ' claims, 0 facts) — claim status is never silently promoted');
  } finally { fs.rmSync(gRoot, { recursive: true, force: true }); }

  ok(fs.existsSync(path.join(ROOT, 'docs', 'OTH_K2_DATA_DISCOVERY.md')), 'OTH-K2 discovery evidence record present');
}

fs.rmSync(corpusRoot, { recursive: true, force: true });

// ---------- verdict ----------
console.log('\n================ OTH-KNOWLEDGE LIVE GATE ================');
for (const s of sections) console.log('  ' + (s.failed ? 'FAIL' : 'PASS') + '  ' + s.name + ' (' + s.passed + '/' + (s.passed + s.failed) + ')');
console.log('  totals: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.log('  VERDICT: FAIL — executable evidence incomplete; OTH-KNOWLEDGE is NOT live-ready.');
  process.exit(1);
}
if (live) {
  console.log('  VERDICT: LIVE PASS — core, retrieval, service read-only boundary, trust boundary,');
  console.log('           executor fail-closed boundary, persistent-store separation and data-source');
  console.log('           policy all proven against the CONFIGURED private store.');
  process.exit(0);
}
console.log('  VERDICT: READY — NOT LIVE.');
console.log('  All executable evidence is green; the single remaining blocker is owner-only:');
console.log('  ' + liveBlocker);
process.exit(process.argv.indexOf('--require-live') !== -1 ? 2 : 0);
