// =====================================================
// MPI-2H — Ingestion boundary (closed portion) suite
// tests/mpi-2h-ingestion-test.js
//
// Offline contract cases always run. Database cases need a scratch target:
//   MPI_SCRATCH_CONTAINER=<name> MPI_SCRATCH_DB=<db> node tests/mpi-2h-ingestion-test.js
// Without those variables the database cases are reported as skipped, never
// as passed. All fixture values are synthetic `.invalid`. No real data, no
// real R2 — the content store runs on an in-memory adapter.
// =====================================================
'use strict';

const path = require('path');
const crypto = require('crypto');
const BASE = path.join(__dirname, '..');
const P = path.join(BASE, 'projects/personal-intelligence/persistence');
const ingestion = require(path.join(P, 'ingestion'));
const cs = require(path.join(P, 'content-store'));
const { createClient, KIND } = require(path.join(P, 'client'));
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

function fakeStoreAdapter() {
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

function validItem(over) {
  return Object.assign({
    class: 'SYNTHETIC',
    memory: {
      memoryRecordId: 'mem_2h_' + (over && over._id || '1') + '.invalid',
      userId: 'usr_2h.invalid', organisationId: 'org_2h.invalid',
      memoryType: 'A', contentSummary: 'synthetic summary .invalid'
    },
    provenance: {
      memoryProvenanceId: 'prov_2h_' + (over && over._id || '1') + '.invalid',
      provider: 'mythos', sourceType: 'note',
      sourceReference: 'src_2h.invalid', importBatchRef: 'batch_2h.invalid'
    }
  }, over && over.item);
}

(async function main() {
  console.log('\nMPI-2H CONTRACT (offline)');

  ok(ingestion.loadIngestionFlag({ MPI_REAL_MEMORY_INGESTION_ENABLED: 'true' }) === true, '1 flag: exact string true enables');
  ok(['TRUE', '1', 'yes', 'True'].every(function (v) {
    return ingestion.loadIngestionFlag({ MPI_REAL_MEMORY_INGESTION_ENABLED: v }) === false;
  }) && ingestion.loadIngestionFlag({}) === false && ingestion.loadIngestionFlag() === false,
    '2 flag: every non-exact value and absence stay disabled');

  const base = validItem();
  ok(ingestion.validateItem(base) === base, '3 a fully valid synthetic item validates');

  await expectRefusal(function () {
    const i = validItem(); i.entities = [{ name: 'someone.invalid' }];
    return Promise.resolve(ingestion.validateItem(i));
  }, /UNKNOWN_FIELD/, '4 D2 structural: an entity-bearing field does not exist and is refused');

  await expectRefusal(function () {
    const i = validItem(); i.memory.state = 'active';
    return Promise.resolve(ingestion.validateItem(i));
  }, /UNKNOWN_FIELD/, '5 lifecycle-owned columns are not ingestion inputs');

  await expectRefusal(function () {
    const i = validItem(); i.class = 'PRODUCTION';
    return Promise.resolve(ingestion.validateItem(i));
  }, /CLASS_INVALID/, '6 unknown ingestion class refused');

  await expectRefusal(function () {
    const i = validItem(); i.provenance.provider = 'openai';
    return Promise.resolve(ingestion.validateItem(i));
  }, /PROVIDER_NOT_ALLOWED/, '7 external providers are importer territory (post-2H) — refused');

  await expectRefusal(function () {
    const i = validItem(); i.provenance.sourceType = 'contacts';
    return Promise.resolve(ingestion.validateItem(i));
  }, /CONTACTS_EXCLUDED_D1/, '8 D1: contacts source type permanently refused');

  await expectRefusal(function () {
    const i = validItem(); i.provenance.sourceType = 'conversation';
    return Promise.resolve(ingestion.validateItem(i));
  }, /SOURCE_TYPE_NOT_ALLOWED/, '9 source types outside the mythos four refused');

  await expectRefusal(function () {
    const i = validItem(); i.memory.contentSummary = 'x'.repeat(513);
    return Promise.resolve(ingestion.validateItem(i));
  }, /SUMMARY_TOO_LONG/, '10 content_summary bounded at 512');

  await expectRefusal(function () {
    const i = validItem(); delete i.provenance.sourceReference;
    return Promise.resolve(ingestion.validateItem(i));
  }, /SOURCE_REFERENCE_REQUIRED/, '11 source_reference mandatory (F8 keys on it)');

  await expectRefusal(function () {
    const i = validItem(); delete i.provenance.importBatchRef;
    return Promise.resolve(ingestion.validateItem(i));
  }, /BATCH_REF_REQUIRED/, '12 import_batch_ref mandatory (reversibility is not optional)');

  await expectRefusal(function () {
    const i = validItem(); i.content = Buffer.from('x.invalid'); i.memory.contentReference = cs.contentReferenceFor(Buffer.from('x.invalid'));
    return Promise.resolve(ingestion.validateItem(i));
  }, /CONTENT_AND_REFERENCE_EXCLUSIVE/, '13 raw content and pre-minted reference are exclusive');

  await expectRefusal(function () {
    const i = validItem(); i.memory.contentReference = 'https://example.invalid/doc';
    return Promise.resolve(ingestion.validateItem(i));
  }, /content reference/, '14 foreign reference scheme refused (D3 scheme only)');

  ok(ingestion.sensitiveShape('password=hunter2.invalid') === true &&
     ingestion.sensitiveShape('AKIAABCDEFGHIJKLMNOP') === true &&
     ingestion.sensitiveShape('prefers concise summaries') === false,
     '15 sensitive shapes: repo-precedent patterns match, benign text does not');

  const sensItem = validItem();
  sensItem.memory.contentSummary = 'the token=abc123.invalid was mentioned';
  ok(ingestion.classifySensitive(sensItem) === 'credential_shape_in_summary',
     '16 classifySensitive names the kind, not the value');

  console.log('\nMPI-2H REAL-CLASS GATES (offline — writes must never be attempted)');

  function recordingClient() {
    const writes = [];
    return {
      writes: writes,
      withTransaction: async function (fn) {
        return fn({ query: async function (sql, params) { writes.push(sql); return { rows: [{}] }; } });
      },
      emit: function () {}
    };
  }

  const rc1 = recordingClient();
  const ing1 = ingestion.createIngestion({
    client: rc1, contentStore: cs.createContentStore({ adapter: fakeStoreAdapter() }), flagEnabled: false
  });
  const realItem = validItem(); realItem.class = 'REAL';
  await expectRefusal(function () { return ing1.ingestItem(realItem, { realDataAuthorised: true, backupVerified: true }); },
    /REAL_FLAG_DISABLED/, '17 REAL refused while the flag is off, gates notwithstanding');
  ok(rc1.writes.length === 0, '18 refusal happened before any database write');

  const rc2 = recordingClient();
  const ing2 = ingestion.createIngestion({
    client: rc2, contentStore: cs.createContentStore({ adapter: fakeStoreAdapter() }), flagEnabled: true
  });
  await expectRefusal(function () { return ing2.ingestItem(realItem); },
    /REAL_NOT_AUTHORISED/, '19 REAL refused without the per-batch owner authorisation assertion');
  await expectRefusal(function () { return ing2.ingestItem(realItem, { realDataAuthorised: true }); },
    /BACKUP_NOT_VERIFIED/, '20 REAL refused without the backup-verified assertion (§25)');
  ok(rc2.writes.length === 0, '21 gate refusals leave zero writes');

  console.log('\nMPI-2H D3 ORDERING + F8 REPLAY (offline)');

  const order = [];
  const adapter3 = fakeStoreAdapter();
  const store3 = cs.createContentStore({ adapter: adapter3 });
  const origPut = store3.putContent;
  store3.putContent = function (b) { order.push('content'); return origPut.call(store3, b); };
  const client3 = {
    withTransaction: async function (fn) {
      order.push('db');
      return fn({ query: async function () { return { rows: [{ memory_record_id: 'mem.invalid' }] }; } });
    },
    emit: function () {}
  };
  const ing3 = ingestion.createIngestion({ client: client3, contentStore: store3, flagEnabled: false });
  const withContent = validItem({ _id: 'c1' });
  withContent.content = Buffer.from('detail content .invalid');
  const r3 = await ing3.ingestItem(withContent);
  ok(r3.ingested === true && order.length >= 2 && order[0] === 'content' && order.indexOf('db') > 0,
     '22 write-content-before-row: content durable before the transaction runs');
  ok(adapter3.objects.has('content/sha256/' + sha(Buffer.from('detail content .invalid'))),
     '23 content object exists under the D3 key');

  const uniqueErr = new Error('duplicate'); uniqueErr.kind = KIND.UNIQUE;
  const client4 = {
    withTransaction: async function () { throw uniqueErr; },
    emit: function () {}
  };
  const ing4 = ingestion.createIngestion({ client: client4, contentStore: store3, flagEnabled: false });
  const r4 = await ing4.ingestItem(validItem());
  ok(r4.alreadyIngested === true, '24 F8 UNIQUE violation is the idempotent-replay signal, not an error');

  const planted = 'password=planted-secret.invalid';
  const rc5 = recordingClient();
  const ing5 = ingestion.createIngestion({ client: rc5, contentStore: store3, flagEnabled: false });
  const sens5 = validItem({ _id: 's5' });
  sens5.memory.contentSummary = 'contains ' + planted;
  let msg5 = '';
  try { await ing5.ingestItem(sens5); ok(false, '25 sensitive item must be refused'); }
  catch (e) { msg5 = e.message; ok(/SENSITIVE_REJECTED:credential_shape_in_summary/.test(msg5), '25 sensitive item refused with kind only'); }
  ok(msg5.indexOf('planted-secret') === -1, '26 refusal message is value-free');
  ok(rc5.writes.length === 1 && /pi_guard_decisions/.test(rc5.writes[0]),
     '27 exactly one write happened: the standalone guard-decision audit row');

  // ------------------------------------------------------------------
  const container = process.env.MPI_SCRATCH_CONTAINER;
  const database = process.env.MPI_SCRATCH_DB;
  if (!container || !database) {
    skipped = 8;
    console.log('\nMPI-2H DATABASE CASES: SKIPPED (set MPI_SCRATCH_CONTAINER and MPI_SCRATCH_DB)');
  } else {
    console.log('\nMPI-2H DATABASE CASES (scratch: ' + container + '/' + database + ')');
    const { createPsqlDriver } = require(path.join(P, 'testing', 'psql-driver'));
    const driver = createPsqlDriver({ container: container, database: database });
    const client = createClient({ driver: driver, schema: 'mythos_intelligence' });
    const sysid = (await client.query('SELECT system_identifier::text AS s FROM pg_control_system()', [])).rows[0].s;
    await migrate.apply(client, { expectedDatabase: database, expectedSystemIdentifier: sysid,
      diskOk: true, backupGateClosed: true, pcGateClosed: true, inventoryReconciled: true, applicationReady: true });

    await client.withTransaction(async function (exec) {
      await exec.query("INSERT INTO pi_domains (domain_id, display_name) VALUES ('dom_2h.invalid','d')", []);
      await exec.query("INSERT INTO pi_organisations (organisation_id, organisation_ref, organisation_ref_source, domain_id) VALUES ('org_2h.invalid','oref.invalid','test.invalid','dom_2h.invalid')", []);
      await exec.query("INSERT INTO pi_users (user_id, user_ref, user_ref_source, organisation_id) VALUES ('usr_2h.invalid','uref.invalid','test.invalid','org_2h.invalid')", []);
    });

    const adapter = fakeStoreAdapter();
    const store = cs.createContentStore({ adapter: adapter });
    const ing = ingestion.createIngestion({ client: client, contentStore: store, flagEnabled: false });

    const itemA = validItem({ _id: 'dbA' });
    itemA.content = Buffer.from('scratch detail A .invalid');
    const ra = await ing.ingestItem(itemA);
    ok(ra.ingested === true, '28 synthetic item ingests end-to-end (memory + provenance atomic pair)');

    const provRows = (await client.query(
      "SELECT provider, source_type, import_batch_ref FROM pi_memory_provenance WHERE memory_record_id = $1",
      [itemA.memory.memoryRecordId])).rows;
    ok(provRows.length === 1 && provRows[0].provider === 'mythos' && provRows[0].import_batch_ref === 'batch_2h.invalid',
       '29 provenance row present with provider/batch ref');

    const memRow = (await client.query(
      'SELECT content_reference FROM pi_memory_records WHERE memory_record_id = $1',
      [itemA.memory.memoryRecordId])).rows[0];
    ok(!!memRow && /^mpi-content:\/\/sha256\/[a-f0-9]{64}$/.test(memRow.content_reference),
       '30 database holds the D3 reference, never content');

    const replay = await ing.ingestItem(itemA);
    ok(replay.alreadyIngested === true, '31 real F8 index turns replay into alreadyIngested');

    const vc = await cs.verifyConsistency(client, store);
    ok(vc.ok === true && vc.checked >= 1, '32 verifyConsistency green after ingestion');

    const rev = await ing.reverseBatch('batch_2h.invalid', { deletionReason: 'test reversal .invalid' });
    ok(rev.reversed === 1, '33 batch reversal tombstones every batch row');
    const state = (await client.query('SELECT state FROM pi_memory_records WHERE memory_record_id = $1',
      [itemA.memory.memoryRecordId])).rows[0].state;
    ok(state === 'tombstoned', '34 reversed memory is tombstoned, not deleted');
    const rev2 = await ing.reverseBatch('batch_2h.invalid', { deletionReason: 'repeat .invalid' });
    ok(rev2.reversed === 0, '35 reversal is idempotent — nothing left to tombstone');

    await driver.end();
  }

  console.log('\nMPI-2H ingestion: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
  process.exit(failed === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('SUITE ABORTED: ' + (e && e.message));
  process.exit(1);
});
