// =====================================================
// MPI-2H — Operator CLI composition-root suite
// tests/mpi-2h-cli-test.js
//
// Fully offline: the deps seam injects fake activation/client/store; no
// database, no network, no R2. All fixture values are synthetic `.invalid`.
// The production path (no deps) is asserted structurally: real modules only,
// no mock fallback.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..');
const cli = require(path.join(BASE, 'projects/personal-intelligence/cli/mpi-ingest-cli.js'));
const cs = require(path.join(BASE, 'projects/personal-intelligence/persistence/content-store.js'));
const { KIND } = require(path.join(BASE, 'projects/personal-intelligence/persistence/client.js'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
async function expectRefusal(fn, re, label) {
  try { await fn(); ok(false, label + ' (expected refusal, but it succeeded)'); }
  catch (e) { ok(e.refused === true && re.test(e.message), label + (re.test(e.message) ? '' : ' [got: ' + e.message + ']')); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpi-2h-cli-'));
function writeJson(name, data) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

function item(over) {
  const base = {
    class: 'SYNTHETIC',
    memory: {
      memoryRecordId: 'mem_cli_' + Math.random().toString(36).slice(2) + '.invalid',
      userId: 'usr_cli.invalid', organisationId: 'org_cli.invalid',
      memoryType: 'A', contentSummary: 'synthetic cli summary .invalid'
    },
    provenance: {
      memoryProvenanceId: 'prov_cli_' + Math.random().toString(36).slice(2) + '.invalid',
      provider: 'mythos', sourceType: 'note',
      sourceReference: 'src_cli.invalid', importBatchRef: 'batch_cli.invalid'
    }
  };
  return Object.assign(base, over || {});
}

// Fake client good enough for lifecycles inserts + verifyConsistency reads.
function fakeClient(opts) {
  const refs = [];
  const writes = [];
  const o = opts || {};
  async function query(sql, params) {
    writes.push(sql);
    if (/information_schema\.columns/.test(sql)) return { rows: [{ table_name: 'pi_memory_records' }] };
    if (/SELECT DISTINCT content_reference/.test(sql)) {
      return { rows: refs.filter(Boolean).map(function (r) { return { ref: r }; }) };
    }
    if (/INSERT INTO pi_memory_records/.test(sql)) {
      if (o.throwUniqueOnMemory) { const e = new Error('dup'); e.kind = KIND.UNIQUE; throw e; }
      refs.push(params[7] || null); // contentReference position in repositories.memory.create
      return { rows: [{ memory_record_id: params[0], state: 'active', evidence_count: 1 }] };
    }
    if (/INSERT INTO pi_memory_provenance/.test(sql)) return { rows: [{ memory_provenance_id: params[0] }] };
    if (/INSERT INTO pi_guard_decisions/.test(sql)) return { rows: [{ guard_decision_id: params[0] }] };
    return { rows: [{}] };
  }
  return {
    refs: refs, writes: writes,
    query: query,
    withTransaction: async function (fn) { return fn({ query: query }); },
    emit: function () {}
  };
}

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

function deps(over) {
  const client = (over && over.client) || fakeClient(over && over.clientOpts);
  const calls = { activate: 0 };
  return Object.assign({
    calls: calls,
    client: client,
    env: { MPI_REAL_MEMORY_INGESTION_ENABLED: (over && over.flag) || undefined },
    out: function () {},
    activate: async function () { calls.activate++; return { enabled: true, client: client }; },
    store: cs.createContentStore({ adapter: (over && over.adapter) || fakeStoreAdapter() }),
    checkReady: async function () { return true; }
  }, over || {});
}

const C1 = 'a'.repeat(64);

(async function main() {
  console.log('\nMPI-2H CLI — dry run');

  const goodItems = writeJson('good.json', [item(), item()]);
  const dr = await cli.run(['dry-run', '--items', goodItems], { out: function () {} });
  ok(dr.ok === true && dr.dryRun === true && dr.scope.importBatchRef === 'batch_cli.invalid',
    '1 valid dry run passes and identifies the batch scope');

  const noActivate = { out: function () {}, activate: async function () { throw new Error('must not be called'); } };
  const dr2 = await cli.run(['dry-run', '--items', goodItems], noActivate);
  ok(dr2.ok === true, '2 dry run performs no activation, no connection, no writes');

  const obsItem = item(); obsItem.provenance.sourceType = 'observation';
  const drObs = await cli.run(['dry-run', '--items', writeJson('obs.json', [obsItem])], { out: function () {} });
  ok(drObs.ok === false, '3 O-2H-1: observation is module-valid but outside the ratified initial source — refused');

  const entItem = item(); entItem.entities = [{ name: 'third-party.invalid' }];
  const drEnt = await cli.run(['dry-run', '--items', writeJson('ent.json', [entItem])], { out: function () {} });
  ok(drEnt.ok === false, '4 D2: entity-origination attempt refused in validation');

  const noProv = item(); delete noProv.provenance;
  await expectRefusal(function () {
    return cli.run(['dry-run', '--items', writeJson('noprov.json', [noProv])], { out: function () {} });
  }, /BATCH_REF_NOT_UNIQUE/, '5 missing provenance leaves the batch scope underivable — refused');

  const contactsItem = item(); contactsItem.provenance.sourceType = 'contacts';
  const drC = await cli.run(['dry-run', '--items', writeJson('contacts.json', [contactsItem])], { out: function () {} });
  ok(drC.ok === false, '6 D1: contacts refused');

  const secretItem = item(); secretItem.memory.contentSummary = 'password=planted-cli-secret.invalid';
  let drS;
  const lines = [];
  drS = await cli.run(['dry-run', '--items', writeJson('secret.json', [secretItem])], { out: function (l) { lines.push(l); } });
  ok(drS.ok === false && lines.join('\n').indexOf('planted-cli-secret') === -1,
    '7 credential-shaped item refused; CLI output is value-free');

  console.log('\nMPI-2H CLI — REAL gates are argument-bound, never standing');

  const realItems = writeJson('real.json', [(function () { const i = item(); i.class = 'REAL'; return i; })()]);
  const evGood = writeJson('ev-good.json', { for_batch: 'batch_cli.invalid', c1: C1, c2: C1, restore_result: 'PASS', completed_at_utc: new Date().toISOString() });
  const evWrongBatch = writeJson('ev-old.json', { for_batch: 'batch_previous.invalid', c1: C1, c2: C1, restore_result: 'PASS', completed_at_utc: new Date().toISOString() });
  const evMismatch = writeJson('ev-c1c2.json', { for_batch: 'batch_cli.invalid', c1: C1, c2: 'b'.repeat(64), restore_result: 'PASS', completed_at_utc: new Date().toISOString() });
  const evNoRestore = writeJson('ev-norestore.json', { for_batch: 'batch_cli.invalid', c1: C1, c2: C1, restore_result: 'FAIL', completed_at_utc: new Date().toISOString() });

  const d1 = deps({ flag: 'true' });
  await expectRefusal(function () {
    return cli.run(['ingest', '--items', realItems, '--content-config', '/nonexistent.env',
      '--backup-evidence', evGood, '--assert-first-party-only'], d1);
  }, /REAL_ORDER_REQUIRED/, '8 missing owner order refused');
  ok(d1.calls.activate === 0, '9 refusal happened before any activation attempt');

  await expectRefusal(function () {
    return cli.run(['ingest', '--items', realItems, '--content-config', '/nonexistent.env',
      '--real-order', 'batch_some_other.invalid', '--backup-evidence', evGood, '--assert-first-party-only'], deps({ flag: 'true' }));
  }, /ORDER_SCOPE_MISMATCH/, '10 owner order naming a different batch refused (wrong scope)');

  await expectRefusal(function () {
    return cli.run(['ingest', '--items', realItems, '--content-config', '/nonexistent.env',
      '--real-order', 'batch_cli.invalid', '--assert-first-party-only'], deps({ flag: 'true' }));
  }, /BACKUP_EVIDENCE_REQUIRED/, '11 missing same-session backup evidence refused');

  await expectRefusal(function () {
    return cli.run(['ingest', '--items', realItems, '--content-config', '/nonexistent.env',
      '--real-order', 'batch_cli.invalid', '--backup-evidence', evWrongBatch, '--assert-first-party-only'], deps({ flag: 'true' }));
  }, /WRONG_BATCH/, '12 stale/reused backup evidence (previous batch) refused');

  await expectRefusal(function () {
    return cli.run(['ingest', '--items', realItems, '--content-config', '/nonexistent.env',
      '--real-order', 'batch_cli.invalid', '--backup-evidence', evMismatch, '--assert-first-party-only'], deps({ flag: 'true' }));
  }, /C1_NE_C2/, '13 backup evidence with C1 != C2 refused');

  await expectRefusal(function () {
    return cli.run(['ingest', '--items', realItems, '--content-config', '/nonexistent.env',
      '--real-order', 'batch_cli.invalid', '--backup-evidence', evNoRestore, '--assert-first-party-only'], deps({ flag: 'true' }));
  }, /RESTORE_NOT_PASS/, '14 backup evidence without a passed isolated restore refused');

  await expectRefusal(function () {
    return cli.run(['ingest', '--items', realItems, '--content-config', '/nonexistent.env',
      '--real-order', 'batch_cli.invalid', '--backup-evidence', evGood], deps({ flag: 'true' }));
  }, /FIRST_PARTY_ATTESTATION_REQUIRED/, '15 D1/O-2H-1 first-party attestation is per-batch and required');

  await expectRefusal(function () {
    return cli.run(['ingest', '--items', realItems, '--content-config', '/nonexistent.env',
      '--real-order', 'batch_cli.invalid', '--backup-evidence', evGood, '--assert-first-party-only'], deps({}));
  }, /REAL_FLAG_DISABLED/, '16 ingestion flag off refuses REAL even with every argument present');

  console.log('\nMPI-2H CLI — activation and synthetic execution');

  const dDisabled = deps({});
  dDisabled.activate = async function () { return { enabled: false, reason: 'flag off' }; };
  await expectRefusal(function () {
    return cli.run(['ingest', '--items', goodItems, '--content-config', '/nonexistent.env'], dDisabled);
  }, /PERSISTENCE_DISABLED/, '17 disabled production activation is a refusal, never a fallback');

  const adapter = fakeStoreAdapter();
  const dOk = deps({ adapter: adapter });
  const contentItem = item(); contentItem.content = 'detail body .invalid';
  const synth = writeJson('synth.json', [item(), contentItem]);
  const r = await cli.run(['ingest', '--items', synth, '--content-config', '/nonexistent.env'], dOk);
  ok(r.ok === true && r.ingested === 2, '18 successful synthetic batch through the full composition');
  ok(adapter.objects.size === 1 && dOk.client.refs.filter(Boolean).length === 1 &&
     /^mpi-content:\/\/sha256\//.test(dOk.client.refs.filter(Boolean)[0]),
    '19 D3: content object stored, database received the reference only');

  const dReplay = deps({ clientOpts: { throwUniqueOnMemory: true } });
  const rr = await cli.run(['ingest', '--items', goodItems, '--content-config', '/nonexistent.env'], dReplay);
  ok(rr.ok === true && rr.replayed === 2 && rr.ingested === 0,
    '20 F8: UNIQUE replay surfaces as replayed, batch still succeeds idempotently');

  console.log('\nMPI-2H CLI — batch scope and fail-closed structure');

  const mixed = writeJson('mixed.json', [item(), (function () { const i = item(); i.provenance.importBatchRef = 'batch_other.invalid'; return i; })()]);
  await expectRefusal(function () { return cli.run(['dry-run', '--items', mixed], { out: function () {} }); },
    /BATCH_REF_NOT_UNIQUE/, '21 one invocation = one batch scope (mixed refs refused)');

  await expectRefusal(function () { return cli.run(['nonsense'], {}); },
    /UNKNOWN_COMMAND/, '22 unknown command fails closed');

  const source = fs.readFileSync(path.join(BASE, 'projects/personal-intelligence/cli/mpi-ingest-cli.js'), 'utf8');
  ok(/require\('\.\.\/persistence\/activation'\)/.test(source) &&
     /require\('pg'\)/.test(source) &&
     !/in-?memory|fallback\s+store|mockClient/i.test(source.replace(/\/\/[^\n]*\n/g, '\n')),
    '23 production path wires real activation + real pg; no mock/memory fallback exists');
  ok(!/setInterval|setTimeout|cron|schedule/i.test(source),
    '24 no scheduling of any kind (O-2H-2a: on-demand only)');

  console.log('\nMPI-2H CLI: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('SUITE ABORTED: ' + (e && e.message));
  process.exit(1);
});
