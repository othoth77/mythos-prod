// =====================================================
// MPI-3 Stage R3 — context runtime (assembler on the real adapter) suite
// tests/mpi-3-context-runtime-test.js
//
// Offline cases run against a fake client that answers the R1 adapter's
// SQL shapes. Database cases need a scratch target:
//   MPI_SCRATCH_CONTAINER=<name> MPI_SCRATCH_DB=<db> node tests/mpi-3-context-runtime-test.js
// All fixtures synthetic `.invalid`. No network, no R2, no production.
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');
const P = path.join(BASE, 'projects/personal-intelligence/persistence');
const runtime = require(path.join(P, 'context-runtime'));
const lifecycles = require(path.join(P, 'lifecycles'));
const { createClient } = require(path.join(P, 'client'));
const migrate = require(path.join(P, 'migrate'));

let passed = 0, failed = 0, skipped = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
async function expectRefusal(fn, re, label) {
  try { await fn(); ok(false, label + ' (expected refusal, but it succeeded)'); }
  catch (e) { ok(e.refused === true && re.test(e.message), label + (re.test(e.message) ? '' : ' [got: ' + e.message + ']')); }
}

function row(id, over) {
  return Object.assign({
    memory_record_id: id, user_id: 'u.invalid', organisation_id: 'o.invalid',
    domain_id: null, session_id: null, scope: 'user', memory_type: 'DECISION',
    content_summary: 'summary ' + id, state: 'active', evidence_count: 1,
    observed_at: '2026-08-10T00:00:00Z', created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z', content_reference: null,
    provenance: [{ memory_record_id: id, source_reference: 'src_' + id, provider: 'mythos', source_type: 'note', confidence: 'EXPLICIT' }],
    tags: []
  }, over || {});
}

function fakeClient(rows) {
  const statements = [];
  return {
    statements: statements,
    withTransaction: async function (fn) {
      return fn({ query: async function (sql, params) {
        statements.push(sql);
        if (/FROM pi_memory_records m/.test(sql)) return { rows: rows };
        if (/FROM pi_memory_provenance WHERE memory_record_id = ANY/.test(sql)) {
          const out = [];
          rows.forEach(function (r) { (r.provenance || []).forEach(function (p) { out.push(p); }); });
          return { rows: out };
        }
        if (/FROM pi_memory_tags/.test(sql)) return { rows: [] };
        if (/FROM pi_memory_conflicts/.test(sql)) return { rows: [] };
        return { rows: [] };
      } });
    },
    emit: function () {}
  };
}

const baseQ = { userId: 'u.invalid', organisationId: 'o.invalid', permissions: {}, limit: 10 };

(async function main() {
  console.log('\nMPI-3 R3 CONTRACT (offline)');

  const c1 = fakeClient([row('m1'), row('m2', { observed_at: '2026-08-12T00:00:00Z' })]);
  const r1 = await runtime.retrieveRelevantMemory(c1, baseQ);
  ok(r1.items.length === 2 && r1.items[0].memoryRecordId === 'm2' && r1.items[1].memoryRecordId === 'm1',
    '1 real-adapter -> assembler integration: mapped records, recency ranking applied');
  ok(r1.items[0].provenance.reference === 'src_m2' && r1.items[0].provenanceRecords.length === 1,
    '2 provenance preserved through mapping (reference + full records)');
  ok(r1.diagnostics.retrieval.ordering.indexOf('confidence') === 0 && r1.diagnostics.assembler.ranking.indexOf('recency') !== -1,
    '3 diagnostics carry both retrieval and assembler layers');

  const r1b = await runtime.retrieveRelevantMemory(fakeClient([row('m1'), row('m2', { observed_at: '2026-08-12T00:00:00Z' })]), baseQ);
  ok(JSON.stringify(r1.items.map(function (i) { return i.memoryRecordId; })) ===
     JSON.stringify(r1b.items.map(function (i) { return i.memoryRecordId; })),
    '4 deterministic: identical inputs, identical composed order');

  // Timestamp tie: stable sort must preserve the adapter's deterministic order.
  const tie = [row('mA', { observed_at: '2026-08-10T00:00:00Z' }), row('mB', { observed_at: '2026-08-10T00:00:00Z' })];
  const rTie = await runtime.retrieveRelevantMemory(fakeClient(tie), baseQ);
  ok(rTie.items[0].memoryRecordId === 'mA' && rTie.items[1].memoryRecordId === 'mB',
    '5 timestamp ties preserve the adapter deterministic order (stable sort)');

  await expectRefusal(function () { return runtime.retrieveRelevantMemory(fakeClient([]), Object.assign({}, baseQ, { limit: undefined })); },
    /LIMIT_REQUIRED/, '6 bounded limit required — no exhaustive loading is expressible');
  await expectRefusal(function () { return runtime.retrieveRelevantMemory(fakeClient([]), Object.assign({}, baseQ, { permissions: undefined })); },
    /PERMISSIONS_REQUIRED/, '7 permissions required (filtering, not decoration)');
  await expectRefusal(function () { return runtime.retrieveRelevantMemory(fakeClient([]), Object.assign({}, baseQ, { includeStates: ['active', 'tombstoned'] })); },
    /TOMBSTONED_INVISIBLE/, '8 O-R1(b) inherited: tombstoned request refused before any query');

  const cScope = fakeClient([row('m1')]);
  await runtime.retrieveRelevantMemory(cScope, Object.assign({}, baseQ, { permissions: { allowedScopes: ['user'] } }));
  ok(cScope.statements.some(function (s) { return /m\.scope = ANY/.test(s); }),
    '9 permission scope filter lands in the SQL WHERE — before ranking, structurally');

  const rEmpty = await runtime.retrieveRelevantMemory(fakeClient([]), baseQ);
  ok(rEmpty.items.length === 0 && rEmpty.conflicts.length === 0 && rEmpty.diagnostics.assembler.candidates === 0,
    '10 empty result: empty items/conflicts with honest diagnostics');

  const cIntent = fakeClient([row('m1')]);
  const rIntent = await runtime.retrieveRelevantMemory(cIntent, Object.assign({}, baseQ, { intent: 'why', entities: ['a'] }));
  const rNoIntent = await runtime.retrieveRelevantMemory(fakeClient([row('m1')]), baseQ);
  ok(rIntent.diagnostics.assembler.intentEcho === 'why' &&
     JSON.stringify(rIntent.items.map(function (i) { return i.memoryRecordId; })) ===
     JSON.stringify(rNoIntent.items.map(function (i) { return i.memoryRecordId; })),
    '11 intent/entities are echoed, never silently consumed as ranking');

  const rTask = await runtime.retrieveRelevantMemory(fakeClient([
    row('m1', { relatedCapabilities: undefined }),
    row('m2')
  ]), baseQ, { task: { capabilityId: 'cap.x' } });
  ok(rTask.items.length === 2 && rTask.diagnostics.assembler.task === 'cap.x',
    '12 task passthrough honours the assembler contract (rows without capability links admitted, as written)');

  const withRef = row('m1', { content_reference: 'mpi-content://sha256/' + 'a'.repeat(64) });
  const rRef = await runtime.retrieveRelevantMemory(fakeClient([withRef]), baseQ);
  ok(rRef.items[0].contentReference === withRef.content_reference && !('content' in rRef.items[0]),
    '13 D3: records carry the reference only; no content field exists');
  const src = fs.readFileSync(path.join(P, 'context-runtime.js'), 'utf8').replace(/\/\/[^\n]*\n/g, '\n');
  ok(!/getContent|putContent|hydrate/.test(src) && !/\b(INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM)\b/i.test(src),
    '14 structurally read-only and hydration-free: no content calls, no SQL writes');

  // ------------------------------------------------------------------
  const container = process.env.MPI_SCRATCH_CONTAINER;
  const database = process.env.MPI_SCRATCH_DB;
  if (!container || !database) {
    skipped = 6;
    console.log('\nMPI-3 R3 DATABASE CASES: SKIPPED (set MPI_SCRATCH_CONTAINER and MPI_SCRATCH_DB)');
  } else {
    console.log('\nMPI-3 R3 DATABASE CASES (scratch: ' + container + '/' + database + ')');
    const { createPsqlDriver } = require(path.join(P, 'testing', 'psql-driver'));
    const driver = createPsqlDriver({ container: container, database: database });
    const client = createClient({ driver: driver, schema: 'mythos_intelligence' });
    const sysid = (await client.query('SELECT system_identifier::text AS s FROM pg_control_system()', [])).rows[0].s;
    await migrate.apply(client, { expectedDatabase: database, expectedSystemIdentifier: sysid,
      diskOk: true, backupGateClosed: true, pcGateClosed: true, inventoryReconciled: true, applicationReady: true });
    const U = 'usr_r3.invalid', O = 'org_r3.invalid', D = 'dom_r3.invalid';
    await client.withTransaction(async function (exec) {
      await exec.query("INSERT INTO pi_domains (domain_id, display_name) VALUES ($1,'d')", [D]);
      await exec.query("INSERT INTO pi_organisations (organisation_id, organisation_ref, organisation_ref_source, domain_id) VALUES ($1,'r','s',$2)", [O, D]);
      await exec.query("INSERT INTO pi_users (user_id, user_ref, user_ref_source, organisation_id) VALUES ($1,'r','s',$2)", [U, O]);
    });
    async function mem(id, over, prov) {
      return lifecycles.createMemoryWithProvenance(client, {
        memory: Object.assign({ memoryRecordId: id, userId: U, organisationId: O, memoryType: 'DECISION', contentSummary: 's ' + id }, over || {}),
        provenance: Object.assign({ memoryProvenanceId: 'p_' + id, provider: 'mythos', sourceType: 'note', sourceReference: 'src_' + id, importBatchRef: 'b_r3.invalid' }, prov || {})
      });
    }
    await mem('n1', { observedAt: '2026-08-10T00:00:00Z' }, { confidence: 'EXPLICIT' });
    await mem('n2', { observedAt: '2026-08-12T00:00:00Z' }, { confidence: 'LOW' });
    await mem('n3', { observedAt: '2026-08-05T00:00:00Z' }, { confidence: 'HIGH' });
    await mem('nT', { observedAt: '2026-08-11T00:00:00Z' }, { confidence: 'EXPLICIT' });
    await lifecycles.tombstoneMemory(client, { tombstone: {
      memoryTombstoneId: 'tsT', memoryRecordId: 'nT', userId: U, organisationId: O, deletionReason: 'test' } });

    const Q = { userId: U, organisationId: O, permissions: {}, limit: 10 };
    const e1 = await runtime.retrieveRelevantMemory(client, Q);
    ok(e1.items.length === 3 && e1.items.map(function (i) { return i.memoryRecordId; }).indexOf('nT') === -1,
      '15 end-to-end: tombstoned memory invisible through the whole pipeline');
    ok(e1.items[0].memoryRecordId === 'n2',
      '16 end-to-end ranking: assembler recency over the adapter set (n2 newest)');
    const e2 = await runtime.retrieveRelevantMemory(client, Q);
    ok(JSON.stringify(e1.items.map(function (i) { return i.memoryRecordId; })) ===
       JSON.stringify(e2.items.map(function (i) { return i.memoryRecordId; })),
      '17 end-to-end determinism across runs');
    const eConf = await runtime.retrieveRelevantMemory(client, Object.assign({}, Q, { minConfidence: 'HIGH' }));
    ok(eConf.items.every(function (i) { return i.memoryRecordId !== 'n2'; }),
      '18 confidence floor flows through the composition');
    const eTime = await runtime.retrieveRelevantMemory(client, Object.assign({}, Q, { timeRange: { from: '2026-08-09T00:00:00Z', to: '2026-08-11T00:00:00Z' } }));
    ok(eTime.items.length === 1 && eTime.items[0].memoryRecordId === 'n1',
      '19 temporal filtering flows through (and the tombstoned row in-range stays invisible)');
    ok(e1.items.every(function (i) { return i.provenanceRecords.length === 1 && i.provenance.reference.indexOf('src_') === 0; }),
      '20 provenance preserved end-to-end on real rows');
    await driver.end();
  }

  console.log('\nMPI-3 R3 context runtime: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
  process.exit(failed === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('SUITE ABORTED: ' + (e && e.message));
  process.exit(1);
});
