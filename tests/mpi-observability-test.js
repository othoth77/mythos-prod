// =====================================================
// MPI — Observability minimum contract
// tests/mpi-observability-test.js
//
// Proves the four previously-missing contract items and the two protections:
//   - transaction failure visibility (+ retry/exhaustion)
//   - append-only write-failure visibility (highest priority)
//   - persistence initialisation result / health signal
//   - sensitive payloads and credentials never logged
//   - logging never alters success/failure behaviour
//
// Named mpi-observability (not mpi-2g) deliberately: slice MPI-2G is the
// backup gate, and the 2F name collision is already on record.
//
//   MPI_SCRATCH_CONTAINER=<name> MPI_SCRATCH_DB=<db> node tests/mpi-observability-test.js
// Without those variables the database cases are reported as skipped.
// =====================================================
'use strict';

const path = require('path');
const BASE = path.join(__dirname, '..');
const P = path.join(BASE, 'projects/personal-intelligence/persistence');
const { createClient, PersistenceError } = require(path.join(P, 'client'));
const lifecycles = require(path.join(P, 'lifecycles'));
const health = require(path.join(P, 'health'));
const migrate = require(path.join(P, 'migrate'));

let passed = 0, failed = 0, skipped = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
function capture() {
  const events = [];
  return { events: events, logger: { event: function (n, f) { events.push({ name: n, fields: f || {} }); } } };
}

async function offlineChecks() {
  console.log('\nMPI-OBSERVABILITY CONTRACT (offline)');

  // 1 silent default: no logger, everything works
  const quiet = createClient({ driver: { query: async () => ({ rows: [] }),
    connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) },
    schema: 'mythos_intelligence' });
  await quiet.withTransaction(async e => { await e.query('SELECT 1'); });
  ok(true, '1 no logger -> silent, behaviour unchanged');

  // 2 malformed logger refused at construction
  let threw = false;
  try { createClient({ driver: { query: async () => ({ rows: [] }) }, logger: {}, schema: 'mythos_intelligence' }); }
  catch (_) { threw = true; }
  ok(threw, '2 malformed logger refused at construction (fail loud, not silent)');

  // 3 transaction failure emits structured event AND the error still propagates
  const c1 = capture();
  const failing = createClient({ driver: { query: async () => ({ rows: [] }),
    connect: async () => ({ query: async q => {
      if (/^INSERT/.test(q.text)) throw Object.assign(new Error('x'), { code: '23505' });
      return { rows: [] };
    }, release: () => {} }) },
    schema: 'mythos_intelligence', logger: c1.logger });
  let err = null;
  try { await failing.withTransaction(async e => { await e.query('INSERT 1'); }); } catch (e) { err = e; }
  const tf = c1.events.find(e => e.name === 'transaction_failed');
  ok(err instanceof PersistenceError && err.kind === 'UNIQUE_VIOLATION', '3 error still propagates unchanged');
  ok(!!tf && tf.fields.kind === 'UNIQUE_VIOLATION' && tf.fields.attempt === 1 && tf.fields.willRetry === false,
     '4 transaction_failed carries kind/sqlstate/attempt/willRetry');
  ok(tf && tf.fields.sqlstate === '23505', '5 sqlstate present for operators');

  // 4 retry + exhaustion path visible
  const c2 = capture();
  const transient = createClient({ driver: { query: async () => ({ rows: [] }),
    connect: async () => ({ query: async q => {
      if (/^INSERT/.test(q.text)) throw Object.assign(new Error('x'), { code: '40001' });
      return { rows: [] };
    }, release: () => {} }) },
    schema: 'mythos_intelligence', maxAttempts: 2, logger: c2.logger });
  err = null;
  try { await transient.withTransaction(async e => { await e.query('INSERT 1'); }); } catch (e) { err = e; }
  const fails = c2.events.filter(e => e.name === 'transaction_failed');
  const exhausted = c2.events.filter(e => e.name === 'transaction_retries_exhausted');
  ok(err && err.kind === 'TRANSIENT' && fails.length === 2
     && fails[0].fields.willRetry === true && fails[1].fields.willRetry === false
     && exhausted.length === 1 && exhausted[0].fields.attempts === 2,
     '6 transient retry visible per attempt, exhaustion emitted once');

  // 5 a THROWING logger must not alter behaviour
  const bomb = createClient({ driver: { query: async () => ({ rows: [] }),
    connect: async () => ({ query: async q => {
      if (/^INSERT/.test(q.text)) throw Object.assign(new Error('x'), { code: '23505' });
      return { rows: [] };
    }, release: () => {} }) },
    schema: 'mythos_intelligence', logger: { event: function () { throw new Error('logger exploded'); } } });
  err = null;
  try { await bomb.withTransaction(async e => { await e.query('INSERT 1'); }); } catch (e) { err = e; }
  ok(err && err.kind === 'UNIQUE_VIOLATION' && err.message.indexOf('logger exploded') === -1,
     '7 throwing logger swallowed — outcome and error identical');

  // 6 health: unreachable target reports, never crashes
  const c3 = capture();
  const dead = createClient({ driver: { query: async () => { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); } },
    schema: 'mythos_intelligence', logger: c3.logger });
  const h = await health.checkHealth(dead);
  ok(h.ok === false && h.connectivity === false
     && c3.events.some(e => e.name === 'persistence_health' && e.fields.ok === false),
     '8 checkHealth on an unreachable target: reported, not thrown');
}

async function dbChecks(container, database) {
  const { createPsqlDriver } = require(path.join(P, 'testing', 'psql-driver'));
  const SENSITIVE = 'ULTRA-PRIVATE-PAYLOAD-19a7.invalid';
  const cap = capture();
  const driver = createPsqlDriver({ container: container, database: database });
  const client = createClient({ driver: driver, schema: 'mythos_intelligence', logger: cap.logger });
  const S = '.invalid';

  console.log('\nMPI-OBSERVABILITY (real PostgreSQL)');
  const sysid = (await client.query('SELECT system_identifier::text AS s FROM pg_control_system()', [])).rows[0].s;
  await migrate.apply(client, { expectedDatabase: database, expectedSystemIdentifier: sysid,
    diskOk: true, backupGateClosed: true, pcGateClosed: true, inventoryReconciled: true, applicationReady: true });
  await client.withTransaction(async function (e) {
    await e.query("INSERT INTO pi_domains (domain_id,display_name) VALUES ('DOB" + S + "','d')");
    await e.query("INSERT INTO pi_organisations (organisation_id,organisation_ref,organisation_ref_source,domain_id) VALUES ('OOB" + S + "','r','s','DOB" + S + "')");
    await e.query("INSERT INTO pi_users (user_id,user_ref,user_ref_source,organisation_id) VALUES ('UOB" + S + "','r','s','OOB" + S + "')");
  });

  // 9 successful normal path: result unchanged, no failure events
  const evBefore = cap.events.length;
  const created = await lifecycles.createMemoryWithProvenance(client, {
    memory: { memoryRecordId: 'MOB' + S, userId: 'UOB' + S, organisationId: 'OOB' + S,
              memoryType: 'DECISION', contentSummary: SENSITIVE },
    provenance: { memoryProvenanceId: 'POB' + S, provider: 'mythos', sourceType: 'observation',
                  sourceReference: 'hash://ob' + S } });
  const noise = cap.events.slice(evBefore).filter(e => /failed|exhausted/.test(e.name));
  ok(created.memory.state === 'active' && noise.length === 0,
     '9 successful path unchanged — zero failure events emitted');

  // 10 audit-write failure OBSERVABLE and transaction still atomic:
  // duplicate preference_audit_id forces the audit insert to fail.
  await client.withTransaction(async function (e) {
    await e.query("INSERT INTO pi_learned_preferences (preference_id,user_id,organisation_id,preference_key,preference_value_summary,source,status) " +
                  "VALUES ('PROB" + S + "','UOB" + S + "','OOB" + S + "','k','" + SENSITIVE + "','OBSERVATION','SESSION_OBSERVATION')");
    await e.query("INSERT INTO pi_preference_audit (preference_audit_id,preference_id,actor_ref,actor_type,change_type,new_status) " +
                  "VALUES ('AOB" + S + "','PROB" + S + "','a','HUMAN','CREATED','SESSION_OBSERVATION')");
  });
  let auditErr = null;
  try {
    await lifecycles.changePreferenceStatus(client, {
      preferenceId: 'PROB' + S, preferenceAuditId: 'AOB' + S, // duplicate id -> UNIQUE violation
      actorRef: 'a', actorType: 'HUMAN', changeType: 'PROMOTED',
      previousStatus: 'SESSION_OBSERVATION', newStatus: 'CANDIDATE_PREFERENCE',
      reasonSummary: SENSITIVE });
  } catch (e) { auditErr = e; }
  const aw = cap.events.filter(e => e.name === 'append_only_write_failed');
  ok(auditErr && auditErr.kind === 'UNIQUE_VIOLATION', '10 audit-write failure still fails the transaction (behaviour unchanged)');
  ok(aw.length === 1 && aw[0].fields.table === 'pi_preference_audit'
     && aw[0].fields.kind === 'UNIQUE_VIOLATION' && aw[0].fields.preferenceId === 'PROB' + S,
     '11 append_only_write_failed observable with table/kind/opaque id context');
  const status = (await client.read("SELECT status FROM pi_learned_preferences WHERE preference_id=$1", ['PROB' + S])).rows[0];
  ok(status.status === 'SESSION_OBSERVATION', '12 rollback intact — the preference change did not survive the failed audit');

  // 13 sensitive payloads and credentials never logged
  const logDump = JSON.stringify(cap.events);
  ok(logDump.indexOf(SENSITIVE) === -1, '13 sensitive payload string appears in ZERO logged events');
  ok(!/password|secret_access_key|access_key_id/i.test(logDump), '14 no credential-shaped fields in any event');

  // 15 health on the migrated target
  const h = await health.checkHealth(client);
  const hev = cap.events.filter(e => e.name === 'persistence_health');
  ok(h.ok === true && h.connectivity === true && h.schema.ok === true,
     '15 checkHealth: ok on a migrated target (initialisation-result surface)');
  ok(hev.length >= 1 && hev[hev.length - 1].fields.ok === true && hev[hev.length - 1].fields.failedChecks === 0,
     '16 persistence_health event emitted with failedChecks=0');

  // 17 health on an unmigrated database: fail-closed report
  const { execFileSync } = require('child_process');
  execFileSync('sudo', ['docker', 'exec', container, 'psql', '-U', 'postgres', '-q', '-c', 'CREATE DATABASE obs_empty'], { encoding: 'utf8' });
  const d2 = createPsqlDriver({ container: container, database: 'obs_empty' });
  const cap2 = capture();
  const c2 = createClient({ driver: d2, schema: 'mythos_intelligence', logger: cap2.logger });
  const h2 = await health.checkHealth(c2);
  ok(h2.ok === false && h2.connectivity === true,
     '17 checkHealth on an unmigrated database: connectivity true, ok false — report, not crash');
  await d2.end();
  await driver.end();
}

(async function main() {
  await offlineChecks();
  const container = process.env.MPI_SCRATCH_CONTAINER;
  const database = process.env.MPI_SCRATCH_DB;
  if (!container || !database) {
    skipped = 9;
    console.log('\nMPI-OBSERVABILITY DATABASE CASES: SKIPPED (set MPI_SCRATCH_CONTAINER and MPI_SCRATCH_DB)');
  } else {
    try { await dbChecks(container, database); }
    catch (e) { failed++; console.log('  FAIL suite aborted: ' + (e && e.message)); }
  }
  console.log('\nMPI observability: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
  process.exit(failed === 0 ? 0 : 1);
})();
