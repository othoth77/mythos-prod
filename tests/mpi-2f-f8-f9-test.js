// =====================================================
// MPI-2F — F8 (concurrent reinforcement integrity) + F9 (audit subject index)
// tests/mpi-2f-f8-f9-test.js
//
// Regression suite for the ratified F8/F9 implementations.
//
//   MPI_SCRATCH_CONTAINER=<name> MPI_SCRATCH_DB=<db> node tests/mpi-2f-f8-f9-test.js
// Without those variables the database cases are reported as skipped, never
// as passed. Concurrency cases use SEPARATE psql driver instances — each is
// its own real PostgreSQL session.
//
// All fixture values are synthetic `.invalid`.
// =====================================================
'use strict';

const path = require('path');
const BASE = path.join(__dirname, '..');
const P = path.join(BASE, 'projects/personal-intelligence/persistence');
const { createClient } = require(path.join(P, 'client'));
const lifecycles = require(path.join(P, 'lifecycles'));
const migrate = require(path.join(P, 'migrate'));

let passed = 0, failed = 0, skipped = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

function offlineChecks() {
  console.log('\nMPI-2F CONTRACT (offline)');
  const fs = require('fs');
  const sql = fs.readFileSync(path.join(P, '..', 'database', 'mpi-2a-remediation-proposal.sql'), 'utf8');
  ok(/CREATE UNIQUE INDEX idx_pi_provenance_observation[\s\S]{0,200}NULLS NOT DISTINCT/.test(sql),
     '1 F8 index in schema input: UNIQUE + NULLS NOT DISTINCT on (memory_record_id, source_reference, observed_at)');
  ok(/CREATE INDEX idx_pi_preference_audit_subject[\s\S]{0,80}\(preference_id\)/.test(sql),
     '2 F9 index in schema input: (preference_id) exactly — no rejected variants');
  ok(!/preference_audit[\s\S]{0,120}\(preference_id, preference_audit_pk\)/.test(sql),
     '3 rejected two-column F9 variant absent');
  const repo = fs.readFileSync(path.join(P, 'repositories.js'), 'utf8');
  const body = /async reinforce\(id, observation\) \{[\s\S]*?\n    \}/.exec(repo)[0];
  ok(body.indexOf('FOR UPDATE') !== -1 && body.indexOf('FOR UPDATE') < body.indexOf('pi_memory_provenance'),
     '4 F8 lock ordering: FOR UPDATE precedes the provenance read in reinforce()');
  // Mandatory provenance refuses BEFORE any transaction — no driver call at all.
  let calls = 0;
  const spy = createClient({ driver: { query: async function () { calls++; return { rows: [] }; },
    connect: async function () { calls++; return { query: async () => ({ rows: [] }), release: () => {} }; } },
    schema: 'mythos_intelligence' });
  return lifecycles.reinforceMemory(spy, { memoryRecordId: 'M.invalid', observation: { sourceReference: 'x' } })
    .then(function () { ok(false, '5 reinforcement without provenance refused'); })
    .catch(function (e) {
      ok(/provenance is required/.test(e.message), '5 reinforcement without provenance refused (F8)');
      ok(calls === 0, '6 refusal happens before any database contact');
    });
}

async function dbChecks(container, database) {
  const { createPsqlDriver } = require(path.join(P, 'testing', 'psql-driver'));
  const mk = function () {
    const d = createPsqlDriver({ container: container, database: database });
    return { d: d, c: createClient({ driver: d, schema: 'mythos_intelligence' }) };
  };
  const main = mk();
  const c = main.c;
  const S = '.invalid';

  console.log('\nMPI-2F SETUP — migrate the full ratified input set');
  const sysid = (await c.query('SELECT system_identifier::text AS s FROM pg_control_system()', [])).rows[0].s;
  await migrate.apply(c, { expectedDatabase: database, expectedSystemIdentifier: sysid,
    diskOk: true, backupGateClosed: true, pcGateClosed: true, inventoryReconciled: true, applicationReady: true });
  const asserts = await migrate.assertSchema(c);
  const bad = asserts.results.filter(function (r) { return !r.ok; });
  ok(asserts.ok === true, '7 assertSchema passes with 57 indexes + named F8/F9 checks'
     + (bad.length ? ' [' + bad.map(function (b) { return b.name + ' exp=' + b.expected + ' got=' + b.actual; }).join('; ') + ']' : ''));

  await c.withTransaction(async function (e) {
    await e.query("INSERT INTO pi_domains (domain_id,display_name) VALUES ('D2F" + S + "','d')");
    await e.query("INSERT INTO pi_organisations (organisation_id,organisation_ref,organisation_ref_source,domain_id) VALUES ('O2F" + S + "','r','s','D2F" + S + "')");
    await e.query("INSERT INTO pi_users (user_id,user_ref,user_ref_source,organisation_id) VALUES ('U2F" + S + "','r','s','O2F" + S + "')");
    await e.query("INSERT INTO pi_memory_records (memory_record_id,user_id,organisation_id,memory_type,content_summary) " +
                  "VALUES ('M1" + S + "','U2F" + S + "','O2F" + S + "','DECISION','a'),('M2" + S + "','U2F" + S + "','O2F" + S + "','DECISION','b')");
  });
  const state = async function (m) {
    const ec = (await c.read('SELECT evidence_count FROM pi_memory_records WHERE memory_record_id=$1', [m])).rows[0].evidence_count;
    const pv = (await c.read('SELECT count(*)::int AS n FROM pi_memory_provenance WHERE memory_record_id=$1', [m])).rows[0].n;
    return { ec: Number(ec), prov: Number(pv) };
  };
  const prov = function (tag, src, obs) {
    return { memoryProvenanceId: 'P' + tag + Math.random().toString(36).slice(2, 8) + S,
             provider: 'mythos', sourceType: 'observation', sourceReference: src, observedAt: obs };
  };

  console.log('\nMPI-2F F8 — uniqueness boundary (through the real lifecycle)');
  // first observation of source A
  const r1 = await lifecycles.reinforceMemory(c, { memoryRecordId: 'M1' + S,
    observation: { sourceReference: 'hash://A' }, provenance: prov('a', 'hash://A', '2026-01-01T00:00:00Z') });
  ok(r1.reinforced === true, '8 first observation reinforces (evidence 1 -> 2)');
  // duplicate: same source, application-level rejection (lock + read path)
  const r2 = await lifecycles.reinforceMemory(c, { memoryRecordId: 'M1' + S,
    observation: { sourceReference: 'hash://A', materiallyLater: false }, provenance: prov('b', 'hash://A', '2026-01-01T00:00:00Z') });
  ok(r2.reinforced === false, '9 exact duplicate rejected by the application decision');
  // materially later: same source, later observed_at — MUST count (ratified boundary)
  const r3 = await lifecycles.reinforceMemory(c, { memoryRecordId: 'M1' + S,
    observation: { sourceReference: 'hash://A', materiallyLater: true }, provenance: prov('c', 'hash://A', '2026-09-01T00:00:00Z') });
  const s3 = await state('M1' + S);
  ok(r3.reinforced === true && s3.ec === 3 && s3.prov === 2, '10 same source at a MATERIALLY LATER observed_at counts (ec=' + s3.ec + ', prov=' + s3.prov + ')');
  // index backstop: bypass the application decision, insert the same tuple raw
  let backstop = null;
  try {
    await c.withTransaction(function (e) {
      return e.query("INSERT INTO pi_memory_provenance (memory_provenance_id,memory_record_id,provider,source_type,source_reference,observed_at) " +
                     "VALUES ('PRAW" + S + "','M1" + S + "','mythos','observation','hash://A','2026-09-01T00:00:00Z')");
    });
  } catch (e) { backstop = e.kind; }
  ok(backstop === 'UNIQUE_VIOLATION', '11 index backstop rejects a raw duplicate tuple even when the application is bypassed');
  // NULL observed_at: first accepted, second rejected (NULLS NOT DISTINCT)
  let nullDup = null;
  await c.withTransaction(function (e) {
    return e.query("INSERT INTO pi_memory_provenance (memory_provenance_id,memory_record_id,provider,source_type,source_reference,observed_at) " +
                   "VALUES ('PN1" + S + "','M1" + S + "','mythos','observation','hash://N',NULL)");
  });
  try {
    await c.withTransaction(function (e) {
      return e.query("INSERT INTO pi_memory_provenance (memory_provenance_id,memory_record_id,provider,source_type,source_reference,observed_at) " +
                     "VALUES ('PN2" + S + "','M1" + S + "','mythos','observation','hash://N',NULL)");
    });
  } catch (e) { nullDup = e.kind; }
  ok(nullDup === 'UNIQUE_VIOLATION', '12 NULL observed_at duplicates rejected — NULLS NOT DISTINCT working');

  console.log('\nMPI-2F F8 — concurrency (separate real sessions)');
  const A = mk(), B = mk();
  const before = await state('M2' + S);
  const results = await Promise.all([
    lifecycles.reinforceMemory(A.c, { memoryRecordId: 'M2' + S,
      observation: { sourceReference: 'hash://R' }, provenance: prov('x', 'hash://R', '2026-02-01T00:00:00Z') })
      .catch(function (e) { return { err: e.kind }; }),
    lifecycles.reinforceMemory(B.c, { memoryRecordId: 'M2' + S,
      observation: { sourceReference: 'hash://R' }, provenance: prov('y', 'hash://R', '2026-02-01T00:00:00Z') })
      .catch(function (e) { return { err: e.kind }; })
  ]);
  const after = await state('M2' + S);
  const winners = results.filter(function (r) { return r.reinforced === true; }).length;
  ok(after.ec === before.ec + 1 && after.prov === 1,
     '13 two concurrent identical reinforcements count ONCE (ec ' + before.ec + '->' + after.ec + ', prov=' + after.prov + ', winners=' + winners + ')');
  // three-way, fresh memory row target via distinct source
  const results3 = await Promise.all([A, B, main].map(function (h, i) {
    return lifecycles.reinforceMemory(h.c, { memoryRecordId: 'M2' + S,
      observation: { sourceReference: 'hash://T' }, provenance: prov('t' + i, 'hash://T', '2026-03-01T00:00:00Z') })
      .catch(function (e) { return { err: e.kind }; });
  }));
  const after3 = await state('M2' + S);
  ok(after3.ec === after.ec + 1 && after3.prov === 2,
     '14 three concurrent identical reinforcements count ONCE (ec=' + after3.ec + ', prov=' + after3.prov + ')');
  await A.d.end(); await B.d.end();

  console.log('\nMPI-2F F9 — index present and correct');
  const idx = (await c.read(
    "SELECT indexdef FROM pg_indexes WHERE schemaname='mythos_intelligence' AND indexname='idx_pi_preference_audit_subject'", [])).rows;
  ok(idx.length === 1 && /\(preference_id\)/.test(idx[0].indexdef) && !/preference_audit_pk/.test(idx[0].indexdef),
     '15 idx_pi_preference_audit_subject exists on (preference_id) only');
  const f8idx = (await c.read(
    "SELECT indexdef FROM pg_indexes WHERE schemaname='mythos_intelligence' AND indexname='idx_pi_provenance_observation'", [])).rows;
  ok(f8idx.length === 1 && /UNIQUE/.test(f8idx[0].indexdef) && /NULLS NOT DISTINCT/.test(f8idx[0].indexdef),
     '16 idx_pi_provenance_observation is UNIQUE NULLS NOT DISTINCT');

  await main.d.end();
}

(async function main() {
  await offlineChecks();
  const container = process.env.MPI_SCRATCH_CONTAINER;
  const database = process.env.MPI_SCRATCH_DB;
  if (!container || !database) {
    skipped = 10;
    console.log('\nMPI-2F DATABASE CASES: SKIPPED (set MPI_SCRATCH_CONTAINER and MPI_SCRATCH_DB)');
  } else {
    try { await dbChecks(container, database); }
    catch (e) { failed++; console.log('  FAIL suite aborted: ' + (e && e.message)); }
  }
  console.log('\nMPI-2F F8/F9: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
  process.exit(failed === 0 ? 0 : 1);
})();
