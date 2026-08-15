// =====================================================
// MPI-3 Stage R1 — §10 retrieval adapter suite
// tests/mpi-3-retrieval-test.js
//
// Offline contract cases always run. Database cases need a scratch target:
//   MPI_SCRATCH_CONTAINER=<name> MPI_SCRATCH_DB=<db> node tests/mpi-3-retrieval-test.js
// Without those variables the database cases are reported as skipped, never
// as passed. All fixtures synthetic `.invalid`; the content store is
// in-memory. Every adapter statement is a SELECT — read-only by construction.
// =====================================================
'use strict';

const path = require('path');
const BASE = path.join(__dirname, '..');
const P = path.join(BASE, 'projects/personal-intelligence/persistence');
const retrieval = require(path.join(P, 'retrieval'));
const cs = require(path.join(P, 'content-store'));
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

const noClient = { withTransaction: async function () { throw new Error('must not reach the database'); }, emit: function () {} };
const baseQ = { userId: 'u.invalid', organisationId: 'o.invalid', permissions: {}, limit: 10 };

(async function main() {
  console.log('\nMPI-3 R1 CONTRACT (offline — refusals happen before any connection)');

  await expectRefusal(function () { return retrieval.retrieveMemory(noClient, Object.assign({}, baseQ, { limit: undefined })); },
    /LIMIT_REQUIRED/, '1 limit is required — no unbounded retrieval');
  await expectRefusal(function () { return retrieval.retrieveMemory(noClient, Object.assign({}, baseQ, { limit: 0 })); },
    /LIMIT_REQUIRED/, '2 zero/negative limit refused');
  await expectRefusal(function () { return retrieval.retrieveMemory(noClient, Object.assign({}, baseQ, { permissions: undefined })); },
    /PERMISSIONS_REQUIRED/, '3 permissions object is required — filtering, not decoration');
  await expectRefusal(function () { return retrieval.retrieveMemory(noClient, Object.assign({}, baseQ, { includeStates: ['active', 'tombstoned'] })); },
    /TOMBSTONED_INVISIBLE/, '4 O-R1(b): includeStates with tombstoned is refused, never honoured');
  await expectRefusal(function () { return retrieval.retrieveMemory(noClient, Object.assign({}, baseQ, { minConfidence: 'ABSOLUTE' })); },
    /MIN_CONFIDENCE_INVALID/, '5 minConfidence outside the ratified vocabulary refused');
  await expectRefusal(function () { return retrieval.retrieveMemory(noClient, Object.assign({}, baseQ, { timeRange: { from: 'nope' } })); },
    /TIMERANGE_INVALID/, '6 malformed timeRange refused');
  await expectRefusal(function () { return retrieval.retrieveEvents(noClient, Object.assign({}, baseQ, { eventTypes: ['RELEASE'] })); },
    /EVENT_TYPES_INVALID/, '7 event types outside the ratified five refused');
  await expectRefusal(function () { return retrieval.hydrateContent(null, { content_reference: '' }); },
    /NO_CONTENT_REFERENCE/, '8 hydration without a reference refused');

  // ------------------------------------------------------------------
  const container = process.env.MPI_SCRATCH_CONTAINER;
  const database = process.env.MPI_SCRATCH_DB;
  if (!container || !database) {
    skipped = 18;
    console.log('\nMPI-3 R1 DATABASE CASES: SKIPPED (set MPI_SCRATCH_CONTAINER and MPI_SCRATCH_DB)');
  } else {
    console.log('\nMPI-3 R1 DATABASE CASES (scratch: ' + container + '/' + database + ')');
    const { createPsqlDriver } = require(path.join(P, 'testing', 'psql-driver'));
    const driver = createPsqlDriver({ container: container, database: database });
    const client = createClient({ driver: driver, schema: 'mythos_intelligence' });
    const sysid = (await client.query('SELECT system_identifier::text AS s FROM pg_control_system()', [])).rows[0].s;
    await migrate.apply(client, { expectedDatabase: database, expectedSystemIdentifier: sysid,
      diskOk: true, backupGateClosed: true, pcGateClosed: true, inventoryReconciled: true, applicationReady: true });

    const U = 'usr_r1.invalid', O = 'org_r1.invalid', D = 'dom_r1.invalid';
    await client.withTransaction(async function (exec) {
      await exec.query("INSERT INTO pi_domains (domain_id, display_name) VALUES ($1,'d')", [D]);
      await exec.query("INSERT INTO pi_organisations (organisation_id, organisation_ref, organisation_ref_source, domain_id) VALUES ($1,'r','s',$2)", [O, D]);
      await exec.query("INSERT INTO pi_users (user_id, user_ref, user_ref_source, organisation_id) VALUES ($1,'r','s',$2)", [U, O]);
    });

    // Fixture matrix. mem() creates memory+provenance through the proven lifecycle.
    async function mem(id, over, prov) {
      return lifecycles.createMemoryWithProvenance(client, {
        memory: Object.assign({
          memoryRecordId: id, userId: U, organisationId: O,
          memoryType: 'DECISION', contentSummary: 'fixture ' + id
        }, over || {}),
        provenance: Object.assign({
          memoryProvenanceId: 'p_' + id, provider: 'mythos', sourceType: 'note',
          sourceReference: 'src_' + id, importBatchRef: 'b_r1.invalid'
        }, prov || {})
      });
    }

    const adapterStore = (function () {
      const objects = new Map();
      return {
        calls: [],
        store: cs.createContentStore({ adapter: {
          put: async (k, b, m) => { objects.set(k, { bytes: Buffer.from(b), sha256: m.sha256 }); },
          get: async (k) => { if (!objects.has(k)) throw new Error('missing object'); return objects.get(k).bytes; },
          head: async (k) => { if (!objects.has(k)) throw new Error('missing object'); const o = objects.get(k); return { size: o.bytes.length, sha256: o.sha256 }; }
        } })
      };
    })();

    // A: EXPLICIT confidence, newest, user scope, with content + tag + anchored event.
    const contentA = Buffer.from('content A .invalid');
    const refA = (await adapterStore.store.putContent(contentA)).contentReference;
    await mem('mA', { observedAt: '2026-08-10T00:00:00Z', contentReference: refA }, { confidence: 'EXPLICIT' });
    await client.withTransaction(async function (exec) {
      await exec.query("INSERT INTO pi_memory_tags (memory_tag_id, memory_record_id, tag_key) VALUES ('tag1','mA','alpha')", []);
    });
    await lifecycles.createMemoryWithProvenanceAndEvent(client, {
      memory: { memoryRecordId: 'mA_ev', userId: U, organisationId: O, memoryType: 'PROJECT_STATE', contentSummary: 'anchored ev parent' },
      provenance: { memoryProvenanceId: 'p_mA_ev', provider: 'mythos', sourceType: 'note', sourceReference: 'src_mA_ev', importBatchRef: 'b_r1.invalid' },
      event: { memoryEventId: 'evA', eventType: 'MILESTONE', eventSummary: 'ms A', occurredAt: '2026-08-12T00:00:00Z', projectRef: 'proj_x.invalid' }
    });
    // B: LOW confidence, older, organisation scope.
    await mem('mB', { observedAt: '2026-08-01T00:00:00Z', scope: 'organisation' }, { confidence: 'LOW' });
    // C: HIGH confidence, mid-date, domain-scoped row in domain D with validity window.
    await mem('mC', { observedAt: '2026-08-05T00:00:00Z', domainId: D, validFrom: '2026-07-01T00:00:00Z', validTo: '2026-07-31T00:00:00Z' }, { confidence: 'HIGH' });
    // D: no provenance at all (direct repository insert).
    await client.withTransaction(async function (exec) {
      await exec.query("INSERT INTO pi_memory_records (memory_record_id, user_id, organisation_id, memory_type, content_summary) VALUES ('mD',$1,$2,'DECISION','no provenance')", [U, O]);
    });
    // E: tombstoned.
    await mem('mE', { observedAt: '2026-08-09T00:00:00Z' }, { confidence: 'EXPLICIT' });
    await lifecycles.tombstoneMemory(client, { tombstone: {
      memoryTombstoneId: 'tsE', memoryRecordId: 'mE', userId: U, organisationId: O, deletionReason: 'test' } });
    // F/G: conflict pair (moves both to disputed).
    await mem('mF', { observedAt: '2026-08-07T00:00:00Z' }, { confidence: 'MEDIUM' });
    await mem('mG', { observedAt: '2026-08-08T00:00:00Z' }, { confidence: 'MEDIUM' });
    await lifecycles.createConflict(client, { conflict: {
      memoryConflictId: 'cFG', userId: U, organisationId: O,
      memoryRecordIdA: 'mF', memoryRecordIdB: 'mG', conflictReason: 'SAME_KEY_DIFFERENT_VALUE' } });

    const Q = { userId: U, organisationId: O, permissions: {}, limit: 20 };

    const r1 = await retrieval.retrieveMemory(client, Q);
    const ids1 = r1.items.map(function (i) { return i.memory_record_id; });
    ok(ids1.indexOf('mE') === -1 && ids1.indexOf('mF') === -1 && ids1.indexOf('mG') === -1 &&
       ids1.indexOf('mD') === -1 && ids1.indexOf('mA') !== -1,
      '9 default retrieval: active-with-provenance only — tombstoned, disputed, provenance-less all absent');

    // mA EXPLICIT(4) -> mC HIGH(3) -> mB LOW(1, observed 08-01) -> mA_ev LOW(1, observed NULL, NULLS LAST)
    ok(JSON.stringify(ids1) === JSON.stringify(['mA', 'mC', 'mB', 'mA_ev']),
      '10 deterministic ordering: confidence rank, then observed_at DESC NULLS LAST [got: ' + ids1.join(',') + ']');
    const r1b = await retrieval.retrieveMemory(client, Q);
    ok(JSON.stringify(ids1) === JSON.stringify(r1b.items.map(function (i) { return i.memory_record_id; })),
      '11 identical inputs return identical order');

    const rPerm = await retrieval.retrieveMemory(client, Object.assign({}, Q, { permissions: { allowedScopes: ['organisation'] }, limit: 1 }));
    ok(rPerm.items.length === 1 && rPerm.items[0].memory_record_id === 'mB',
      '12 permission filtering before ranking: excluded scopes never occupy a limit slot');

    const rProv = await retrieval.retrieveMemory(client, Object.assign({}, Q, { requireProvenance: false }));
    ok(rProv.items.some(function (i) { return i.memory_record_id === 'mD'; }),
      '13 requireProvenance:false admits the provenance-less row (default excludes it)');
    ok(r1.items.every(function (i) { return Array.isArray(i.provenance) && i.provenance.length >= 1; }),
      '14 provenance travels with every returned item');

    const rConf = await retrieval.retrieveMemory(client, Object.assign({}, Q, { minConfidence: 'HIGH' }));
    const idsConf = rConf.items.map(function (i) { return i.memory_record_id; });
    ok(idsConf.indexOf('mB') === -1 && idsConf.indexOf('mA') !== -1 && idsConf.indexOf('mC') !== -1,
      '15 minConfidence floor filters below-threshold rows');

    const rTime = await retrieval.retrieveMemory(client, Object.assign({}, Q, { timeRange: { from: '2026-07-10T00:00:00Z', to: '2026-07-20T00:00:00Z' } }));
    ok(rTime.items.length === 1 && rTime.items[0].memory_record_id === 'mC',
      '16 timeRange: validity-window overlap matches; observed_at outside range excluded');

    const rDom = await retrieval.retrieveMemory(client, Object.assign({}, Q, { domainId: D }));
    ok(rDom.items.length === 1 && rDom.items[0].memory_record_id === 'mC', '17 domain narrowing');

    const rProj = await retrieval.retrieveMemory(client, Object.assign({}, Q, { projectRef: 'proj_x.invalid' }));
    ok(rProj.items.length === 1 && rProj.items[0].memory_record_id === 'mA_ev',
      '18 projectRef narrows through record-anchored events (no schema change)');

    const rTag = await retrieval.retrieveMemory(client, Object.assign({}, Q, { tags: ['alpha'] }));
    ok(rTag.items.length === 1 && rTag.items[0].memory_record_id === 'mA' && rTag.items[0].tags.indexOf('alpha') !== -1,
      '19 tag filtering and tag hydration');

    const rDisp = await retrieval.retrieveMemory(client, Object.assign({}, Q, { includeStates: ['active', 'disputed'] }));
    const idsDisp = rDisp.items.map(function (i) { return i.memory_record_id; });
    ok(idsDisp.indexOf('mF') !== -1 && idsDisp.indexOf('mG') !== -1 &&
       rDisp.conflicts.length === 1 && rDisp.conflicts[0].memory_conflict_id === 'cFG',
      '20 disputed on explicit request; the conflict returned ALONGSIDE, both rows present');
    ok(r1.conflicts.length === 0, '21 default retrieval returns no conflicts (disputed rows absent)');

    ok(r1.diagnostics.returned === r1.items.length && r1.diagnostics.ordering.indexOf('confidence') === 0,
      '22 diagnostics report counts and the ordering rule');

    const rEv = await retrieval.retrieveEvents(client, Object.assign({}, Q, { eventTypes: ['MILESTONE'] }));
    ok(rEv.items.length === 1 && rEv.items[0].memory_event_id === 'evA',
      '23 event retrieval with type filter');
    await lifecycles.tombstoneMemory(client, { tombstone: {
      memoryTombstoneId: 'tsAev', memoryRecordId: 'mA_ev', userId: U, organisationId: O, deletionReason: 'test' } });
    const rEv2 = await retrieval.retrieveEvents(client, Q);
    ok(rEv2.items.length === 0, '24 event of a tombstoned parent disappears from retrieval (F14 via anchor)');

    const rA = await retrieval.retrieveMemory(client, Object.assign({}, Q, { tags: ['alpha'] }));
    const hydrated = await retrieval.hydrateContent(adapterStore.store, rA.items[0]);
    ok(Buffer.compare(hydrated, contentA) === 0, '25 D3 hydration is explicit and byte-identical');
    ok(!('content' in rA.items[0]) && typeof rA.items[0].content_reference === 'string',
      '26 retrieval returns references only — content bodies never fetched implicitly');

    await driver.end();
  }

  console.log('\nMPI-3 R1 retrieval: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
  process.exit(failed === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('SUITE ABORTED: ' + (e && e.message));
  process.exit(1);
});
