// =====================================================
// OTHKM strengthening — P17 OTHMODE integration · P18 project namespaces · P26 hardening
// tests/othk-19-integration-hardening-test.js
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
const othmode = require(path.join(BASE, 'lib/othmode-memory.js'));
const promote = require(path.join(BASE, 'lib/promote.js'));
const TRUST = require(path.join(BASE, 'config/trust-model.json'));

let passed = 0, failed = 0;
function ok(v, label) { if (v) { passed++; console.log('  PASS ' + label); } else { failed++; console.log('  FAIL ' + label); } }
function expectError(fn, re, label) { try { fn(); ok(false, label + ' (expected error)'); } catch (e) { ok(re.test(e.message), label); } }
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-test-')); }
const CLASSES = provenance.loadSourceClasses();
function prov(sc) { return { source_class: sc || 'manual', source_collection: 'c', source_reference: (sc || 'manual') + '/c/x', captured_at: '2022-01-01T00:00:00Z' }; }

// ---- P17/P18 OTHMODE consumes OTHKM via scoped namespaces ----
(function integration() {
  const canonRoot = tmpRoot();
  const canon = storeLib.openStore(canonRoot);
  // seed some project + global memory
  extract.addClaim(canon, CLASSES, { statement: 'mythos gateway is deliberately private', asserted_by: 'x', prov: prov('mythos-repo'), namespace: 'projects/mythos-prod' });
  extract.addClaim(canon, CLASSES, { statement: 'idauto vehicle passport spec', asserted_by: 'x', prov: prov('mythos-repo'), namespace: 'projects/idauto' });
  extract.addClaim(canon, CLASSES, { statement: 'owner prefers concise summaries', asserted_by: 'x', prov: prov('owner-report'), namespace: 'personal' });

  const svc = service.openService(canonRoot);
  const staging = storeLib.openStore(tmpRoot());
  const mem = othmode.bind({ service: svc, canonicalStore: canon, stagingStore: staging, classes: CLASSES, trustModel: TRUST });

  // project scope reads only its namespace
  const mythos = mem.project('mythos-prod');
  const hits = mythos.search('gateway', { mode: 'lexical' });
  ok(hits.length === 1 && canon.getRecord(hits[0].id).namespace === 'projects/mythos-prod', 'P17/P18: OTHMODE project scope reads only its namespace');

  // OTHMODE proposes new memory → staged (not canonical), capped at model-output
  const r = mythos.propose({ kind: 'claim', statement: 'gateway uses mcp-auth-proxy + Dex', asserted_by: 'othmode', provenance: prov('deepseek') });
  ok(r.staged && r.tier === 'model-output', 'P17: OTHMODE proposes via gated staging (no competing store, capped tier)');
  ok(canon.allRecords({ kind: 'claim', where: (c) => c.statement.indexOf('mcp-auth-proxy') !== -1 }).length === 0, 'P17: OTHMODE proposal did not write canonical (OTHKM stays source of truth)');

  // trust escalation blocked even through the OTHMODE binding
  const esc = mythos.propose({ kind: 'claim', statement: 'owner personally approved X', asserted_by: 'othmode', provenance: prov('owner-report') });
  ok(esc.rejected && esc.reasons.some((x) => /escalation/.test(x)), 'P17: OTHMODE cannot self-declare owner authority (escalation blocked)');

  // personal scope isolated from project
  ok(mem.personal().search('gateway', { mode: 'lexical' }).length === 0, 'P18: personal scope does not see project memory');
})();

// ---- P26 hardening ----
(function hardening() {
  // restart recovery: reopen a store from disk → all records intact
  const root = tmpRoot();
  const s = storeLib.openStore(root);
  const id = extract.addClaim(s, CLASSES, { statement: 'persisted across restart', asserted_by: 'x', prov: prov() }).id;
  s.appendRecord({ kind: 'claim', id, statement: 'persisted across restart v2', asserted_by: 'x', provenance: prov() }, { allowNewVersion: true });
  const reopened = storeLib.openStore(root); // simulate process restart
  ok(reopened.getRecord(id).statement === 'persisted across restart v2' && reopened.getVersions(id).length === 2, 'P26: restart recovery — records + versions intact after reopen');

  // idempotency: re-appending an identical record is a no-op (no new version)
  const before = reopened.getVersions(id).length;
  const res = reopened.appendRecord(reopened.getRecord(id));
  ok(res.deduplicated === true && reopened.getVersions(id).length === before, 'P26: idempotent re-append (identical record = no-op)');

  // corruption handling: a corrupt log line fails closed on open (never silent)
  fs.appendFileSync(path.join(root, 'records.jsonl'), 'THIS IS NOT JSON\n');
  expectError(() => storeLib.openStore(root), /OTHK_STORE_CORRUPT/, 'P26: corruption detected on open (fail-closed, never silent data loss)');

  // audit trail intact: promotion + tombstone preserved as history
  const s2 = storeLib.openStore(tmpRoot());
  const cid = extract.addClaim(s2, CLASSES, { statement: 'to retire', asserted_by: 'x', prov: prov() }).id;
  s2.tombstone(cid, 'retired');
  ok(s2.getRecord(cid) === null && s2.getVersions(cid).length === 2, 'P26: tombstone recorded as history (auditable, no physical delete)');

  // store integrity check available
  ok(s2.verify().ok === true, 'P26: store.verify() confirms referential + object integrity');
})();

console.log('othk-19: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
