// =====================================================
// OTH-K2-W — executor-side knowledge-service wiring suite
// tests/othk-2w-executor-wiring-test.js
//
// Offline suite for projects/mythos-ai-executor/lib/knowledge.js — the
// AI Operating Layer's read-only consumption of OTH Knowledge per
// docs/OTH_KNOWLEDGE_INTEGRATION.md. Covers: fail-closed config
// validation (unknown/endpoint/credential-shaped fields, in-repo store
// root), the shipped-disabled default, disabled-vs-enabled open paths,
// the read-only operation allowlist (a write-shaped service operation
// never becomes reachable), explicit-asOf enforcement, and per-hit
// presentation annotations (claim-never-fact, quarantined flag,
// provenance always present). All fixtures synthetic.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const KBASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');
const knowledge = require(path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'lib', 'knowledge.js'));
const storeLib = require(path.join(KBASE, 'lib/store.js'));
const provenance = require(path.join(KBASE, 'lib/provenance.js'));
const takeout = require(path.join(KBASE, 'lib/importers/takeout.js'));
const notebooklm = require(path.join(KBASE, 'lib/importers/notebooklm.js'));
const auditLib = require(path.join(KBASE, 'lib/audit.js'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
function expectError(fn, re, label) {
  try { fn(); ok(false, label + ' (expected error, but it succeeded)'); }
  catch (e) { ok(re.test(e.message), label + (re.test(e.message) ? '' : ' [got: ' + e.message + ']')); }
}
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk2w-')); }

const CAP = '2026-08-19T12:00:00Z';
const CLASSES = provenance.loadSourceClasses();
const FIX = path.join(KBASE, 'fixtures');
const GOOD_DESC = 'test wiring config';
function cfg(over) {
  return Object.assign({ enabled: false, store_root: null, description: GOOD_DESC }, over || {});
}

console.log('§1 Config validation — fail closed');
{
  const v = knowledge.validateConfigObject;
  ok(v(cfg()).valid && !v(cfg()).enabled, 'well-formed disabled config is valid and disabled');
  ok(!v(null).valid, 'null root refused');
  ok(!v([1]).valid, 'array root refused');
  ok(!v(cfg({ extra: 1 })).valid, 'unknown field invalidates the whole config');
  ok(!v(cfg({ enabled: 'true' })).valid, 'string enabled refused (must be boolean)');
  ok(!v({ enabled: false, store_root: null, description: '' }).valid, 'empty description refused');
  ok(!v(cfg({ store_root: 42 })).valid, 'numeric store_root refused');

  // Endpoint/credential-shaped keys are rejected by their presence, at any depth.
  const poisoned = cfg(); poisoned.endpoint = 'http://x';
  ok(!v(poisoned).valid && /endpoint/.test(v(poisoned).reason), 'endpoint key rejected by presence');
  const nested = cfg({ description: 'x' }); nested.store_root = null; nested.enabled = false;
  const deep = { enabled: false, store_root: null, description: { token: 'abc' } };
  ok(!v(deep).valid && /credential|token|rejected/.test(v(deep).reason), 'nested credential-shaped key rejected at depth');

  // Enabled requires a real, absolute, out-of-repo store root.
  ok(!v(cfg({ enabled: true })).valid, 'enabled without store_root refused');
  ok(!v(cfg({ enabled: true, store_root: 'relative/path' })).valid, 'relative store_root refused');
  const inRepo = path.join(__dirname, '..', 'somewhere');
  const inRepoRes = v(cfg({ enabled: true, store_root: path.resolve(inRepo) }));
  ok(!inRepoRes.valid && /inside the repository/.test(inRepoRes.reason), 'store_root inside the repository refused — the store never lives in Git');
  const outOk = v(cfg({ enabled: true, store_root: path.join(os.tmpdir(), 'othk2w-somewhere') }));
  ok(outOk.valid && outOk.enabled, 'absolute out-of-repo store_root accepted');
}

console.log('§2 Shipped default and loadConfig');
{
  const shipped = knowledge.loadConfig();
  ok(shipped.valid === true, 'shipped config/knowledge.json is well-formed');
  ok(shipped.enabled === false, 'shipped config is DISABLED (no persistent private store exists yet)');

  const dir = tmpRoot();
  const badJson = path.join(dir, 'bad.json');
  fs.writeFileSync(badJson, '{not json');
  ok(!knowledge.loadConfig(badJson).valid, 'unparseable config file → invalid, layer closed');
  ok(!knowledge.loadConfig(path.join(dir, 'missing.json')).valid, 'missing config file → invalid, layer closed');
}

console.log('§3 openKnowledge — disabled and defective paths never throw');
{
  const off = knowledge.openKnowledge();
  ok(off.enabled === false && /disabled/.test(off.reason), 'default open → disabled with reason, not an error');
  const bad = knowledge.openKnowledge({ config: cfg({ zzz: 1 }) });
  ok(bad.enabled === false && /unknown field/.test(bad.reason), 'invalid config object → disabled with the validation reason');
  const ghost = knowledge.openKnowledge({ config: cfg({ enabled: true, store_root: path.join(os.tmpdir(), 'othk2w-does-not-exist-' + process.pid) }) });
  ok(ghost.enabled === false && /does not exist/.test(ghost.reason), 'nonexistent store_root → disabled, store never silently created');
  const fileRoot = path.join(tmpRoot(), 'afile');
  fs.writeFileSync(fileRoot, 'x');
  const notDir = knowledge.openKnowledge({ config: cfg({ enabled: true, store_root: fileRoot }) });
  ok(notDir.enabled === false && /not a directory/.test(notDir.reason), 'file store_root → disabled');
}

// Build a real fixture store: takeout events + a NotebookLM note (claims),
// then quarantine one record — the corpus the enabled facade reads.
const ROOT = tmpRoot();
{
  const S = storeLib.openStore(ROOT);
  takeout.importDirectory(S, CLASSES, path.join(FIX, 'takeout-export'), { captured_at: CAP, collection: 'takeout-fixture' });
  const bytes = fs.readFileSync(path.join(FIX, 'notebooklm', 'notebook-note.md'));
  notebooklm.importNote(S, CLASSES, { bytes, filename: 'notebook-note.md', captured_at: CAP, observed_at: '2026-05-01T00:00:00Z', collection: 'notebooklm-fixture' });
  const coolifyEvent = S.allRecords({ kind: 'event', where: (r) => /coolify/.test(r.title || '') })[0];
  auditLib.quarantine(S, coolifyEvent.id, 'synthetic quarantine for wiring test');
}

console.log('§4 Enabled facade — read-only allowlist');
const open = knowledge.openKnowledge({ config: cfg({ enabled: true, store_root: ROOT }) });
{
  ok(open.enabled === true && open.store_root === ROOT, 'enabled open over fixture store');
  const names = Object.keys(open.ops);
  ok(names.every((n) => knowledge.READ_OPS.indexOf(n) !== -1), 'every exposed operation is on the read allowlist');
  ok(!names.some((n) => /create|ingest|write|update|delete|tombstone|quarantine|import/i.test(n)), 'no write-shaped operation is exposed');
  ok(Object.isFrozen(open.ops), 'operation surface is frozen');
  const stats = open.ops.stats();
  ok(stats && typeof stats === 'object', 'stats() answers');
}

console.log('§5 Rule 1 — asOf is always explicit');
{
  expectError(() => open.ops.currentState(), /MYTHOS_KNOWLEDGE_ASOF/, 'currentState() without args refused at the executor boundary');
  expectError(() => open.ops.currentState({}), /MYTHOS_KNOWLEDGE_ASOF/, 'currentState({}) refused');
  const state = open.ops.currentState({ asOf: CAP });
  ok(state.as_of === CAP && Array.isArray(state.known), 'currentState with explicit asOf answers and echoes as_of');
}

console.log('§6 Rules 2–4 — provenance and presentation on every hit');
{
  const hits = open.ops.search('reverse proxies terminate tls', { mode: 'lexical', limit: 20 })
    .concat(open.ops.search('searched coolify deployment', { mode: 'lexical', limit: 20 }));
  ok(hits.length > 0, 'fixture corpus produces hits');
  ok(hits.every((h) => h.provenance && h.provenance.source_class), 'every hit carries provenance with a source class');
  ok(hits.every((h) => h.presentation && typeof h.presentation.is_claim === 'boolean' && typeof h.presentation.quarantined === 'boolean'), 'every hit carries a presentation annotation');

  const claimHits = hits.filter((h) => h.kind === 'claim');
  ok(claimHits.length > 0, 'NotebookLM-derived claims are in the corpus');
  ok(claimHits.every((h) => h.presentation.is_claim === true && /never present as fact/.test(h.presentation.statement_class)), 'claims are stamped claim-never-fact');
  const nonClaim = hits.filter((h) => h.kind !== 'claim');
  ok(nonClaim.every((h) => h.presentation.is_claim === false), 'non-claims are not stamped as claims');

  const qHits = open.ops.search('searched coolify deployment', { mode: 'lexical', limit: 50 }).filter((h) => h.presentation.quarantined);
  ok(qHits.length >= 1, 'the quarantined record surfaces with quarantined=true, never silently clean');

  // Regression (OTH-K3 review finding): the ingest secret-refusal path
  // tags 'quarantine' (not 'quarantined'); that spelling must flag too.
  {
    const target = hits.find((h) => !h.presentation.quarantined);
    const S2 = storeLib.openStore(ROOT);
    const rec = S2.getRecord(target.id);
    const next = JSON.parse(JSON.stringify(rec));
    next.tags = Array.from(new Set([...(next.tags || []), 'quarantine']));
    S2.appendRecord(next, { allowNewVersion: true });
    const reopened = knowledge.openKnowledge({ config: cfg({ enabled: true, store_root: ROOT }) });
    const hit2 = reopened.ops.search('reverse proxies terminate tls', { mode: 'lexical', limit: 50 })
      .concat(reopened.ops.search('searched coolify deployment', { mode: 'lexical', limit: 50 }))
      .filter((h) => h.id === target.id);
    ok(hit2.length >= 1 && hit2.every((h) => h.presentation.quarantined === true),
      "ingest-spelled 'quarantine' tag also presents quarantined=true (no bypass via the second tag vocabulary)");
  }
}

console.log('§7 Allowlist holds against a widened service');
{
  // A stub service that grew a write operation: the facade must not expose it.
  const stubDir = tmpRoot();
  const stubPath = path.join(stubDir, 'stub-service.js');
  fs.writeFileSync(stubPath, 'module.exports = { openService: function () { return { ' +
    'search: function () { return []; }, stats: function () { return {}; }, ' +
    'currentState: function (q) { return { as_of: q.asOf, known: [] }; }, ' +
    'destroyEverything: function () { throw new Error("must never be reachable"); }, ' +
    'ingest: function () { throw new Error("must never be reachable"); } }; } };');
  const widened = knowledge.openKnowledge({ config: cfg({ enabled: true, store_root: stubDir }), servicePath: stubPath });
  ok(widened.enabled === true, 'stub service opens');
  ok(!('destroyEverything' in widened.ops) && !('ingest' in widened.ops), 'write-shaped operations on the service are NOT exposed by the facade');
  ok(Object.keys(widened.ops).every((n) => knowledge.READ_OPS.indexOf(n) !== -1), 'only allowlisted names exposed even when the service widens');
}

console.log('');
console.log('othk-2w: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
