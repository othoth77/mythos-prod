// =====================================================
// MPI-2H — Record-anchored events (O-EV-1a, spec §34) suite
// tests/mpi-2h-events-test.js
//
// Offline contract cases always run. Database cases need a scratch target:
//   MPI_SCRATCH_CONTAINER=<name> MPI_SCRATCH_DB=<db> node tests/mpi-2h-events-test.js
// Without those variables the database cases are reported as skipped, never
// as passed. All fixtures synthetic `.invalid`; content store is in-memory.
// =====================================================
'use strict';

const path = require('path');
const crypto = require('crypto');
const BASE = path.join(__dirname, '..');
const P = path.join(BASE, 'projects/personal-intelligence/persistence');
const ingestion = require(path.join(P, 'ingestion'));
const cs = require(path.join(P, 'content-store'));
const cli = require(path.join(BASE, 'projects/personal-intelligence/cli/mpi-ingest-cli.js'));
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
function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }

function fakeAdapter() {
  const objects = new Map();
  return {
    objects: objects,
    put: async function (k, b, m) { objects.set(k, { bytes: Buffer.from(b), sha256: m.sha256 }); },
    get: async function (k) { if (!objects.has(k)) throw new Error('missing object'); return objects.get(k).bytes; },
    head: async function (k) {
      if (!objects.has(k)) throw new Error('missing object');
      const o = objects.get(k); return { size: o.bytes.length, sha256: o.sha256 };
    }
  };
}

function eventItem(id, over) {
  return Object.assign({
    class: 'SYNTHETIC',
    memory: {
      memoryRecordId: 'mem_ev_' + id + '.invalid',
      userId: 'usr_ev.invalid', organisationId: 'org_ev.invalid',
      memoryType: 'DECISION', contentSummary: 'anchored decision ' + id + ' .invalid'
    },
    event: {
      memoryEventId: 'evt_' + id + '.invalid',
      eventType: 'MILESTONE',
      eventSummary: 'milestone ' + id + ' .invalid',
      occurredAt: '2026-08-15T00:00:00Z'
    },
    provenance: {
      memoryProvenanceId: 'prov_ev_' + id + '.invalid',
      provider: 'mythos', sourceType: 'note',
      sourceReference: 'src_ev_' + id + '.invalid', importBatchRef: 'batch_ev.invalid'
    }
  }, over || {});
}

(async function main() {
  console.log('\nMPI-2H EVENTS CONTRACT (offline)');

  ok(ingestion.validateItem(eventItem('v1')) !== undefined, '1 valid record-anchored event item validates');

  await expectRefusal(function () {
    const i = eventItem('v2'); i.event.memoryRecordId = 'mem_other.invalid';
    return Promise.resolve(ingestion.validateItem(i));
  }, /UNKNOWN_FIELD/, '2 caller-supplied anchor refused — memoryRecordId is derived, never an input');

  await expectRefusal(function () {
    const i = eventItem('v3'); i.event.eventType = 'RELEASE';
    return Promise.resolve(ingestion.validateItem(i));
  }, /EVENT_TYPE_INVALID/, '3 event_type outside the ratified five refused');

  await expectRefusal(function () {
    const i = eventItem('v4'); delete i.event.occurredAt;
    return Promise.resolve(ingestion.validateItem(i));
  }, /OCCURRED_AT_REQUIRED/, '4 missing occurred_at refused');

  await expectRefusal(function () {
    const i = eventItem('v5'); i.event.occurredAt = 'not-a-date';
    return Promise.resolve(ingestion.validateItem(i));
  }, /OCCURRED_AT_REQUIRED/, '5 unparseable occurred_at refused');

  await expectRefusal(function () {
    const i = eventItem('v6'); delete i.event.memoryEventId;
    return Promise.resolve(ingestion.validateItem(i));
  }, /EVENT_ID_REQUIRED/, '6 missing event id refused');

  await expectRefusal(function () {
    const i = eventItem('v7'); i.event.content = 'x.invalid'; i.event.contentReference = cs.contentReferenceFor(Buffer.from('x.invalid'));
    return Promise.resolve(ingestion.validateItem(i));
  }, /EVENT_CONTENT_AND_REFERENCE_EXCLUSIVE/, '7 event content XOR reference');

  await expectRefusal(function () {
    const i = eventItem('v8'); i.event.contentReference = 'https://example.invalid/x';
    return Promise.resolve(ingestion.validateItem(i));
  }, /EVENT_CONTENT_REFERENCE_INVALID/, '8 foreign event reference scheme refused (D3)');

  await expectRefusal(function () {
    const i = eventItem('v9'); delete i.memory;
    return Promise.resolve(ingestion.validateItem(i));
  }, /MEMORY_REQUIRED/, '9 standalone event impossible — an item without its memory record refuses');

  const sens = eventItem('v10'); sens.event.eventSummary = 'password=planted-ev.invalid';
  ok(ingestion.classifySensitive(sens) === 'credential_shape_in_event_summary',
    '10 sensitive shapes detected in event summaries (kind only)');

  console.log('\nMPI-2H EVENTS — D3 ordering, gates, idempotency (offline)');

  const order = [];
  const adapter = fakeAdapter();
  const store = cs.createContentStore({ adapter: adapter });
  const origPut = store.putContent;
  store.putContent = function (b) { order.push('content'); return origPut.call(store, b); };
  const writes = [];
  const client = {
    withTransaction: async function (fn) {
      order.push('db');
      return fn({ query: async function (sql, params) {
        writes.push(sql);
        if (/INSERT INTO pi_memory_records/.test(sql)) return { rows: [{ memory_record_id: params[0] }] };
        if (/INSERT INTO pi_memory_provenance/.test(sql)) return { rows: [{ memory_provenance_id: params[0] }] };
        if (/INSERT INTO pi_memory_events/.test(sql)) return { rows: [{ memory_event_id: params[0] }] };
        return { rows: [{}] };
      } });
    },
    emit: function () {}
  };
  const ing = ingestion.createIngestion({ client: client, contentStore: store, flagEnabled: false });

  const withContent = eventItem('c1');
  withContent.event.content = 'milestone detail .invalid';
  const r1 = await ing.ingestItem(withContent);
  ok(r1.ingested === true && r1.event && order[0] === 'content' && order.indexOf('db') > 0,
    '11 event content durable before the transaction (D3 ordering)');
  ok(adapter.objects.has('content/sha256/' + sha(Buffer.from('milestone detail .invalid'))),
    '12 event content object under the D3 key');
  ok(writes.some(function (s) { return /INSERT INTO pi_memory_events/.test(s); }) &&
     writes.filter(function (s) { return /INSERT INTO/.test(s); }).length === 3,
    '13 one transaction wrote exactly memory + provenance + event');

  const gateClient = { withTransaction: async function () { throw new Error('must not write'); }, emit: function () {} };
  const ingGate = ingestion.createIngestion({ client: gateClient, contentStore: store, flagEnabled: false });
  const realEv = eventItem('g1'); realEv.class = 'REAL';
  await expectRefusal(function () { return ingGate.ingestItem(realEv, { realDataAuthorised: true, backupVerified: true }); },
    /REAL_FLAG_DISABLED/, '14 REAL event item refused with flag off — batch gates unchanged');

  const uniqueErr = new Error('dup'); uniqueErr.kind = require(path.join(P, 'client')).KIND.UNIQUE;
  const replayClient = { withTransaction: async function () { throw uniqueErr; }, emit: function () {} };
  const ingReplay = ingestion.createIngestion({ client: replayClient, contentStore: store, flagEnabled: false });
  const rr = await ingReplay.ingestItem(eventItem('r1'));
  ok(rr.alreadyIngested === true, '15 UNIQUE rollback = alreadyIngested; the atomic trio never half-lands');

  const lines = [];
  const fs2 = require('fs'); const os2 = require('os');
  const tmp = fs2.mkdtempSync(path.join(os2.tmpdir(), 'mpi-ev-'));
  const itemsFile = path.join(tmp, 'ev.json');
  fs2.writeFileSync(itemsFile, JSON.stringify([eventItem('cli1')]));
  const dr = await cli.run(['dry-run', '--items', itemsFile], { out: function (l) { lines.push(l); } });
  ok(dr.ok === true && lines.some(function (l) { return /\+event MILESTONE, record-anchored/.test(l); }),
    '16 CLI accepts the paired structure and reports the anchored event in dry-run');

  // ------------------------------------------------------------------
  const container = process.env.MPI_SCRATCH_CONTAINER;
  const database = process.env.MPI_SCRATCH_DB;
  if (!container || !database) {
    skipped = 7;
    console.log('\nMPI-2H EVENTS DATABASE CASES: SKIPPED (set MPI_SCRATCH_CONTAINER and MPI_SCRATCH_DB)');
  } else {
    console.log('\nMPI-2H EVENTS DATABASE CASES (scratch: ' + container + '/' + database + ')');
    const { createPsqlDriver } = require(path.join(P, 'testing', 'psql-driver'));
    const driver = createPsqlDriver({ container: container, database: database });
    const dbClient = createClient({ driver: driver, schema: 'mythos_intelligence' });
    const sysid = (await dbClient.query('SELECT system_identifier::text AS s FROM pg_control_system()', [])).rows[0].s;
    await migrate.apply(dbClient, { expectedDatabase: database, expectedSystemIdentifier: sysid,
      diskOk: true, backupGateClosed: true, pcGateClosed: true, inventoryReconciled: true, applicationReady: true });
    await dbClient.withTransaction(async function (exec) {
      await exec.query("INSERT INTO pi_domains (domain_id, display_name) VALUES ('dom_ev.invalid','d')", []);
      await exec.query("INSERT INTO pi_organisations (organisation_id, organisation_ref, organisation_ref_source, domain_id) VALUES ('org_ev.invalid','r','s','dom_ev.invalid')", []);
      await exec.query("INSERT INTO pi_users (user_id, user_ref, user_ref_source, organisation_id) VALUES ('usr_ev.invalid','r','s','org_ev.invalid')", []);
    });

    const dbAdapter = fakeAdapter();
    const dbStore = cs.createContentStore({ adapter: dbAdapter });
    const dbIng = ingestion.createIngestion({ client: dbClient, contentStore: dbStore, flagEnabled: false });

    const itemA = eventItem('dbA');
    itemA.event.content = 'scratch milestone detail .invalid';
    const ra = await dbIng.ingestItem(itemA);
    ok(ra.ingested === true && ra.event, '17 record+provenance+event ingest end-to-end');

    const evRow = (await dbClient.query(
      'SELECT memory_record_id, event_type, content_reference FROM pi_memory_events WHERE memory_event_id = $1',
      [itemA.event.memoryEventId])).rows[0];
    ok(!!evRow && evRow.memory_record_id === itemA.memory.memoryRecordId && evRow.event_type === 'MILESTONE',
      '18 event row anchored to the item own memory record');
    ok(/^mpi-content:\/\/sha256\//.test(evRow.content_reference), '19 event content stored by D3 reference');

    const replay = await dbIng.ingestItem(itemA);
    const evCount = (await dbClient.query('SELECT count(*)::int AS c FROM pi_memory_events', [])).rows[0].c;
    ok(replay.alreadyIngested === true && evCount === 1, '20 replay: alreadyIngested, event count stays 1 (F8 via parent)');

    const vc = await cs.verifyConsistency(dbClient, dbStore);
    ok(vc.ok === true && vc.columns >= 2, '21 verifyConsistency discovers the events column and passes');

    const rev = await dbIng.reverseBatch('batch_ev.invalid', { deletionReason: 'test .invalid' });
    const state = (await dbClient.query('SELECT state FROM pi_memory_records WHERE memory_record_id = $1',
      [itemA.memory.memoryRecordId])).rows[0].state;
    const evStill = (await dbClient.query('SELECT count(*)::int AS c FROM pi_memory_events', [])).rows[0].c;
    ok(rev.reversed === 1 && state === 'tombstoned' && evStill === 1,
      '22 F14 via parent: reversal tombstones the record; the event remains, anchored to a tombstoned parent');

    const itemB = eventItem('dbB');
    itemB.event.memoryEventId = itemA.event.memoryEventId; // force event-level UNIQUE inside the trio
    const rColl = await dbIng.ingestItem(itemB);
    // The event-level UNIQUE rolled back the whole trio: re-ingesting the same
    // record id WITHOUT the event must succeed — proving no orphan memory row
    // survived the failed transaction (and no F8 hit exists for it).
    const rB = await dbIng.ingestItem(Object.assign({}, itemB, { event: undefined }));
    ok(rColl.alreadyIngested === true && rB.ingested === true,
      '23 atomicity: a failed trio leaves no orphan memory row behind');

    await driver.end();
  }

  console.log('\nMPI-2H events: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
  process.exit(failed === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('SUITE ABORTED: ' + (e && e.message));
  process.exit(1);
});
