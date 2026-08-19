// =====================================================
// MPI — Activation readiness
// tests/mpi-activation-test.js
//
// Proves the §20.5/§20.6 activation contract: strict flag, fail-closed
// environment validation with no secret leakage, real driver adoption via
// injected pg, the abort-no-fallback startup sequence, and the
// readiness/liveness distinction.
//
//   MPI_SCRATCH_CONTAINER=<name> MPI_SCRATCH_DB=<db> node tests/mpi-activation-test.js
// The real-pg case uses MPI's own (gitignored) node_modules/pg when installed
// and SKIPS honestly when absent — it never fakes the real module.
// =====================================================
'use strict';

const path = require('path');
const fs = require('fs');
const BASE = path.join(__dirname, '..');
const P = path.join(BASE, 'projects/personal-intelligence/persistence');
const activation = require(path.join(P, 'activation'));
const migrate = require(path.join(P, 'migrate'));

let passed = 0, failed = 0, skipped = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

const GOOD_ENV = {
  MPI_PERSISTENCE_ENABLED: 'true',
  MPI_PG_HOST: 'db.internal.invalid',
  MPI_PG_PORT: '5432',
  MPI_PG_DATABASE: 'mythos',
  MPI_PG_USER: 'mythos_intelligence_app',
  MPI_PG_PASSWORD: 'SECRET-VALUE-MUST-NEVER-APPEAR-8c41.invalid',
  MPI_PG_STATEMENT_TIMEOUT_MS: '30000'
};

async function offlineChecks() {
  console.log('\nMPI-ACTIVATION CONTRACT (offline)');

  // 1 flag default false, strict string semantics
  ok(activation.loadActivationConfig({}).enabled === false, '1 flag absent -> disabled (default false)');
  for (const v of ['TRUE', '1', 'yes', 'True', ' true']) {
    if (activation.loadActivationConfig({ MPI_PERSISTENCE_ENABLED: v }).enabled !== false) {
      ok(false, '2 only exact "true" enables (leaked on ' + JSON.stringify(v) + ')'); return;
    }
  }
  ok(true, '2 only the exact string "true" enables — TRUE/1/yes all stay disabled');

  // 3 fail closed on missing config, names only, never values
  let err = null;
  try { activation.loadActivationConfig({ MPI_PERSISTENCE_ENABLED: 'true' }); } catch (e) { err = e; }
  ok(err && err.code === 'ACTIVATION_CONFIG_REFUSED'
     && err.missing.indexOf('MPI_PG_HOST') !== -1 && err.missing.indexOf('MPI_PG_PASSWORD') !== -1
     && err.missing.indexOf('MPI_PG_STATEMENT_TIMEOUT_MS') !== -1,
     '3 enabled without config -> refused, missing variables NAMED');

  // 4 statement timeout is REQUIRED (no unbounded timeout in production)
  const noTimeout = Object.assign({}, GOOD_ENV); delete noTimeout.MPI_PG_STATEMENT_TIMEOUT_MS;
  err = null; try { activation.loadActivationConfig(noTimeout); } catch (e) { err = e; }
  ok(err && err.missing.indexOf('MPI_PG_STATEMENT_TIMEOUT_MS') !== -1,
     '4 unbounded statement timeout refused — the §20.5 line is enforced');

  // 5 invalid numerics / ssl refused
  err = null;
  try { activation.loadActivationConfig(Object.assign({}, GOOD_ENV, { MPI_PG_PORT: 'not-a-port', MPI_PG_SSL: 'maybe' })); }
  catch (e) { err = e; }
  ok(err && err.invalid.indexOf('MPI_PG_PORT') !== -1 && err.invalid.indexOf('MPI_PG_SSL') !== -1,
     '5 malformed port/SSL refused as invalid');

  // 6 the secret value can never appear in a refusal message
  err = null;
  try { activation.loadActivationConfig(Object.assign({}, GOOD_ENV, { MPI_PG_PORT: 'bad' })); } catch (e) { err = e; }
  ok(err && err.message.indexOf(GOOD_ENV.MPI_PG_PASSWORD) === -1,
     '6 password value absent from every refusal message');

  // 7 valid config maps to driver options; password passed through untouched
  const cfg = activation.loadActivationConfig(GOOD_ENV);
  ok(cfg.enabled === true && cfg.pg.host === GOOD_ENV.MPI_PG_HOST && cfg.pg.port === 5432
     && cfg.pg.statement_timeout === 30000 && cfg.pg.max === 5 && cfg.pg.ssl === false
     && cfg.pg.password === GOOD_ENV.MPI_PG_PASSWORD,
     '7 valid env -> complete driver config (explicit defaults only where documented)');

  // 8 driver source required — no silent mock
  err = null; try { activation.buildDriver(cfg, undefined); } catch (e) { err = e; }
  ok(err && err.code === 'ACTIVATION_DRIVER_REFUSED', '8 missing pg module -> refused, never a silent mock');

  // 9 REAL driver adoption: MPI's own pg, when installed (node_modules is gitignored)
  const pgPath = path.join(BASE, 'projects/personal-intelligence/node_modules/pg');
  if (fs.existsSync(pgPath)) {
    const pg = require(pgPath);
    const pool = activation.buildDriver(cfg, pg);
    ok(typeof pool.connect === 'function' && typeof pool.query === 'function' && pool.options.max === 5,
       '9 real pg.Pool built from the contract config (connect() present — the F11-safe path)');
    await pool.end();
  } else {
    skipped++; console.log('  SKIP 9 MPI pg not installed on this checkout (gitignored) — not faked');
  }

  // 10 flag off -> activate() returns disabled without touching anything
  const act = await activation.activate({ env: {} });
  ok(act.enabled === false, '10 activate() with flag off -> {enabled:false}, nothing constructed');

  // 11 activation aborts on dead target — and there is NO fallback
  const dead = {
    query: async function () { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); }
  };
  err = null;
  try { await activation.activate({ env: GOOD_ENV, driver: dead }); } catch (e) { err = e; }
  ok(err && err.code === 'ACTIVATION_CONNECTION_FAILED' && /No fallback/.test(err.message),
     '11 dead target -> activation ABORTS loudly; no in-memory fallback path exists');
}

async function dbChecks(container, database) {
  const { createPsqlDriver } = require(path.join(P, 'testing', 'psql-driver'));
  const { createClient } = require(path.join(P, 'client'));
  console.log('\nMPI-ACTIVATION (real PostgreSQL)');

  // migrate the target first (full ratified input set via the runner)
  const setup = createPsqlDriver({ container: container, database: database });
  const sc = createClient({ driver: setup, schema: 'mythos_intelligence' });
  const sysid = (await sc.query('SELECT system_identifier::text AS s FROM pg_control_system()', [])).rows[0].s;
  await migrate.apply(sc, { expectedDatabase: database, expectedSystemIdentifier: sysid,
    diskOk: true, backupGateClosed: true, pcGateClosed: true, inventoryReconciled: true, applicationReady: true });

  // 12 full activation sequence succeeds on a migrated target
  const driver = createPsqlDriver({ container: container, database: database });
  const act = await activation.activate({ env: GOOD_ENV, driver: driver });
  ok(act.enabled === true && act.health.ok === true,
     '12 activate() on a migrated target -> enabled, health ok: applicationReady TRUTHFULLY assertable');
  ok(await activation.isAlive(act.client) === true && await activation.isReady(act.client) === true,
     '13 liveness AND readiness true on the migrated target');
  await driver.end();

  // 14 readiness vs liveness separation on an UNMIGRATED database
  const { execFileSync } = require('child_process');
  try { execFileSync('sudo', ['docker', 'exec', container, 'psql', '-U', 'postgres', '-q', '-c', 'CREATE DATABASE act_empty']); } catch (_) {}
  const d2 = createPsqlDriver({ container: container, database: 'act_empty' });
  const bare = createClient({ driver: d2, schema: 'mythos_intelligence' });
  const alive = await activation.isAlive(bare);
  const ready = await activation.isReady(bare);
  ok(alive === true && ready === false,
     '14 unmigrated target: ALIVE but NOT READY — the two are distinct answers');

  // 15 activation against the live-but-not-ready target aborts with named checks
  let err = null;
  try { await activation.activate({ env: GOOD_ENV, driver: d2 }); } catch (e) { err = e; }
  ok(err && err.code === 'ACTIVATION_NOT_READY' && /No fallback/.test(err.message),
     '15 live-but-unmigrated -> activation ABORTS (fail closed), still no fallback');
  await d2.end();
  await setup.end();
}

(async function main() {
  await offlineChecks();
  const container = process.env.MPI_SCRATCH_CONTAINER;
  const database = process.env.MPI_SCRATCH_DB;
  if (!container || !database) {
    skipped += 4;
    console.log('\nMPI-ACTIVATION DATABASE CASES: SKIPPED (set MPI_SCRATCH_CONTAINER and MPI_SCRATCH_DB)');
  } else {
    try { await dbChecks(container, database); }
    catch (e) { failed++; console.log('  FAIL suite aborted: ' + (e && e.message)); }
  }
  console.log('\nMPI activation: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
  process.exit(failed === 0 ? 0 : 1);
})();
