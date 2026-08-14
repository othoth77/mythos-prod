// =====================================================
// MPI-2A — Migration runner suite (SCRATCH ONLY)
// tests/mpi-2a-migration-runner-test.js
//
// Validates the migration runner against throwaway PostgreSQL 15 databases.
// The runner has NEVER been executed against a production database.
//
//   MPI_SCRATCH_CONTAINER=<name> node tests/mpi-2a-migration-runner-test.js
// Without it the integration cases are reported as skipped, never as passed.
//
// Each integration case gets its OWN fresh database so a refusal test cannot be
// contaminated by a previous apply.
// =====================================================
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const PERSIST = path.join(__dirname, '..', 'projects/personal-intelligence/persistence');
const migrate = require(path.join(PERSIST, 'migrate'));
const { createClient } = require(path.join(PERSIST, 'client'));

let passed = 0, failed = 0, skipped = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

function offlineChecks() {
  console.log('\nMPI-2A RUNNER CONTRACT (offline)');
  const v = migrate.MIGRATIONS.map(function (m) { return m.version; });
  ok(v.length === 3 && v[0].indexOf('001') === 0 && v[1].indexOf('002') === 0 && v[2].indexOf('003') === 0,
     '1 three inputs in explicit order');
  ok(migrate.MIGRATIONS[1].dependsOn[0] === migrate.MIGRATIONS[0].version
     && migrate.MIGRATIONS[2].dependsOn[0] === migrate.MIGRATIONS[1].version,
     '2 dependency chain 001 -> 002 -> 003');
  ok(migrate.MIGRATIONS[1].stage.indexOf('MPI-2') === 0,
     '3 second input is the MPI-2 delta (there is no MPI-1 schema)');
  const hashes = migrate.MIGRATIONS.map(migrate.sha256OfMigration);
  ok(hashes.every(function (h) { return /^[0-9a-f]{64}$/.test(h); }) && new Set(hashes).size === 3,
     '4 each input has a distinct sha256 for drift detection');
  ok(migrate.TARGET_SCHEMA === 'mythos_intelligence', '5 target schema is mythos_intelligence');
  ok(migrate.VERSION_TABLE.indexOf('pi_') !== 0,
     '6 version table is not pi_-prefixed (keeps the 20-table assertion exact)');
  ok(migrate.REFUSAL_CONDITIONS.length >= 7, '7 refusal conditions enumerated');
  const src = require('fs').readFileSync(path.join(PERSIST, 'migrate.js'), 'utf8');
  ok(!/DROP\s+SCHEMA[\s\S]{0,40}CASCADE/i.test(src) && !/DROP\s+TABLE[\s\S]{0,20}CASCADE/i.test(src),
     '8 runner issues no automatic DROP ... CASCADE recovery');
}

function psql(container, db, sql) {
  return execFileSync('sudo', ['docker', 'exec', container, 'psql', '-U', 'postgres', '-d', db,
    '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
}
function freshDb(container, name) {
  try { execFileSync('sudo', ['docker', 'exec', container, 'psql', '-U', 'postgres', '-q', '-c', 'DROP DATABASE IF EXISTS ' + name], { encoding: 'utf8' }); } catch (_) {}
  execFileSync('sudo', ['docker', 'exec', container, 'psql', '-U', 'postgres', '-q', '-c', 'CREATE DATABASE ' + name], { encoding: 'utf8' });
}
function clientFor(container, db) {
  const { createPsqlDriver } = require(path.join(PERSIST, 'testing', 'psql-driver'));
  const driver = createPsqlDriver({ container: container, database: db });
  return { client: createClient({ driver: driver, schema: 'mythos_intelligence' }), driver: driver };
}
// The three NOLOGIN roles are cluster-wide, so a previous case's apply would
// leave them behind and mask a failure to create them. Dropped between cases.
function dropRoles(container, db) {
  ['mythos_intelligence_app', 'mythos_intelligence_maint', 'mythos_intelligence_owner'].forEach(function (r) {
    try { psql(container, db, 'DROP ROLE IF EXISTS ' + r); } catch (_) {}
  });
}

const GOOD = function (db) {
  // F10: all three external gates must be explicit boolean true.
  return { expectedDatabase: db, expectedSystemIdentifier: null, diskOk: true,
           backupGateClosed: true, pcGateClosed: true, inventoryReconciled: true,
           applicationReady: true };
};

async function integrationChecks(container) {
  console.log('\nMPI-2A RUNNER INTEGRATION (real PostgreSQL)');

  // --- A. clean migration on a fresh database
  freshDb(container, 'mig_clean'); dropRoles(container, 'mig_clean');
  let h = clientFor(container, 'mig_clean');
  const sysid = (await h.client.query('SELECT system_identifier::text AS sysid FROM pg_control_system()', [])).rows[0].sysid;
  const opts = Object.assign(GOOD('mig_clean'), { expectedSystemIdentifier: sysid });

  const pre = await migrate.preflight(h.client, opts);
  ok(pre.ok === true, '9 preflight passes on a clean, correctly identified target');
  ok(pre.checks.some(function (c) { return c.name === 'backup_gate_closed' && c.operatorAsserted; }),
     '10 backup gate is marked operator-asserted, not machine-verified');

  const applied = await migrate.apply(h.client, opts);
  ok(applied.length === 3 && applied.every(function (r) { return r.status === 'applied'; }),
     '11 clean scratch migration applies all three inputs in order');

  const asserts = await migrate.assertSchema(h.client);
  const bad = asserts.results.filter(function (r) { return !r.ok; });
  ok(asserts.ok === true, '12 all post-migration assertions pass'
     + (bad.length ? ' [' + bad.map(function (b) { return b.name + ' exp=' + b.expected + ' got=' + b.actual; }).join('; ') + ']' : ''));

  // Re-run must be a no-op, not a failure and not a duplicate apply.
  const again = await migrate.apply(h.client, Object.assign({}, opts, { allowExistingSchema: true, skipPreflight: true }));
  ok(again.every(function (r) { return r.status === 'already-applied'; }),
     '13 re-run is a no-op via version tracking (inputs themselves are not idempotent)');
  await h.driver.end();

  // --- B. wrong database refusal
  freshDb(container, 'mig_wrongdb'); dropRoles(container, 'mig_wrongdb');
  h = clientFor(container, 'mig_wrongdb');
  const wrong = await migrate.preflight(h.client, Object.assign(GOOD('some_other_database'), { expectedSystemIdentifier: sysid }));
  ok(wrong.ok === false && wrong.checks.some(function (c) { return c.name === 'database_identity' && !c.ok; }),
     '14 refuses when database identity does not match the confirmed target');
  let threwWrongDb = false;
  try { await migrate.apply(h.client, Object.assign(GOOD('some_other_database'), { expectedSystemIdentifier: sysid })); }
  catch (_) { threwWrongDb = true; }
  ok(threwWrongDb, '15 apply() aborts rather than migrating the wrong database');

  // --- C. missing operator assertions
  const noGate = await migrate.preflight(h.client, { expectedDatabase: 'mig_wrongdb', expectedSystemIdentifier: sysid, diskOk: true, pcGateClosed: true, inventoryReconciled: true, applicationReady: true });
  ok(noGate.ok === false && noGate.checks.some(function (c) { return c.name === 'backup_gate_closed' && !c.ok; }),
     '16 refuses when the backup gate is not asserted closed');
  const noId = await migrate.preflight(h.client, { expectedDatabase: 'mig_wrongdb', diskOk: true, backupGateClosed: true, pcGateClosed: true, inventoryReconciled: true, applicationReady: true });
  ok(noId.ok === false && noId.checks.some(function (c) { return c.name === 'server_identity' && !c.ok; }),
     '17 refuses when server identity is ambiguous (fails closed)');
  const noDb = await migrate.preflight(h.client, {});
  ok(noDb.ok === false, '18 refuses when no explicit target database is supplied');
  await h.driver.end();

  // --- D. unexpected pi_* tables already present
  freshDb(container, 'mig_dirty'); dropRoles(container, 'mig_dirty');
  psql(container, 'mig_dirty', 'CREATE TABLE pi_squatter (id int)');
  h = clientFor(container, 'mig_dirty');
  const dirty = await migrate.preflight(h.client, Object.assign(GOOD('mig_dirty'), { expectedSystemIdentifier: sysid }));
  ok(dirty.ok === false && dirty.checks.some(function (c) { return c.name === 'pi_tables_anywhere' && !c.ok; }),
     '19 refuses when unexpected pi_* tables already exist');
  ok(dirty.checks.some(function (c) { return c.name === 'pi_tables_in_public' && !c.ok; }),
     '20 refuses when pi_* tables are found in public');
  await h.driver.end();

  // --- E. transactional DDL rollback — PROVEN, not assumed
  freshDb(container, 'mig_rollback'); dropRoles(container, 'mig_rollback');
  h = clientFor(container, 'mig_rollback');
  let rolled = false;
  try {
    await migrate.apply(h.client, Object.assign(GOOD('mig_rollback'), {
      expectedSystemIdentifier: sysid, failAfter: '002-mpi-2-memory-engine' }));
  } catch (_) { rolled = true; }
  const leftTables = (await h.client.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name LIKE 'pi\\_%'", [])).rows[0].n;
  const leftSchema = (await h.client.query(
    "SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name='mythos_intelligence'", [])).rows[0].n;
  ok(rolled && Number(leftTables) === 0 && Number(leftSchema) === 0,
     '21 mid-migration failure rolls back completely — PostgreSQL DDL is transactional (proven)');
  await h.driver.end();

  // --- F. F4 and F7 survive the migration path
  h = clientFor(container, 'mig_clean');
  let f4 = false;
  try {
    await h.client.withTransaction(async function (exec) {
      await exec.query("INSERT INTO pi_domains (domain_id, display_name) VALUES ('D.invalid','d')");
      await exec.query(`INSERT INTO pi_organisations (organisation_id, organisation_ref, organisation_ref_source, domain_id)
                        VALUES ('O.invalid','r','s','D.invalid')`);
      await exec.query(`INSERT INTO pi_users (user_id, user_ref, user_ref_source, organisation_id)
                        VALUES ('U.invalid','r','s','O.invalid')`);
      await exec.query(`INSERT INTO pi_memory_records (memory_record_id, user_id, organisation_id, memory_type, content_summary)
                        VALUES ('MA.invalid','U.invalid','O.invalid','DECISION','a'),('MB.invalid','U.invalid','O.invalid','DECISION','b')`);
      await exec.query(`INSERT INTO pi_memory_conflicts (memory_conflict_id,user_id,organisation_id,memory_record_id_a,memory_record_id_b,conflict_reason)
                        VALUES ('C1.invalid','U.invalid','O.invalid','MB.invalid','MA.invalid','SAME_KEY_DIFFERENT_VALUE')`);
    });
  } catch (e) { f4 = e.kind === 'CHECK_VIOLATION'; }
  ok(f4, '22 F4 canonical order enforced after migration (uncanonical pair rejected)');

  let f7 = false;
  try {
    await h.client.withTransaction(async function (exec) {
      await exec.query(`INSERT INTO pi_guard_decisions (guard_decision_id,user_id,organisation_id,automation_level_requested,decision)
                        VALUES ('G1.invalid','U.invalid','O.invalid','LEVEL_1_READ_ONLY','ALLOW')`);
    });
    await h.client.withTransaction(async function (exec) {
      await exec.query("UPDATE pi_guard_decisions SET decision='DENY' WHERE guard_decision_id='G1.invalid'");
    });
  } catch (e) { f7 = e.kind === 'APPEND_ONLY_VIOLATION'; }
  ok(f7, '23 F7 append-only enforced after migration');
  await h.driver.end();
}

(async function main() {
  offlineChecks();
  const container = process.env.MPI_SCRATCH_CONTAINER;
  if (!container) {
    skipped = 15;
    console.log('\nMPI-2A RUNNER INTEGRATION: SKIPPED (set MPI_SCRATCH_CONTAINER)');
  } else {
    try { await integrationChecks(container); }
    catch (e) { failed++; console.log('  FAIL runner suite aborted: ' + (e && e.message)); }
  }
  console.log('\nMPI-2A migration runner: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
  process.exit(failed === 0 ? 0 : 1);
})();
