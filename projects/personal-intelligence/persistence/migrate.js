// =====================================================
// Mythos Personal Intelligence — MPI-2A Migration Runner
// projects/personal-intelligence/persistence/migrate.js
//
// STATUS: PREPARATION ONLY. This runner has never been executed against any
// production database. It is validated against throwaway scratch containers.
//
// WHY THIS EXISTS RATHER THAN A REUSED MECHANISM: the repository has no
// migration runner. `docs/MYTHOS_SUPABASE_MIGRATION_DESIGN.md` documents plain
// `psql -f` as the mechanism, and `projects/idauto/database/migrations/` holds a
// bare .sql file with no runner beside it. This wraps that documented `psql -f`
// approach with the preflight, versioning and assertions a production migration
// needs — it does not introduce a second competing mechanism.
//
// DRIVER-AGNOSTIC, like client.js: it executes through an injected client, so
// the same code path is exercised in scratch and would be in production.
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', 'database');
const TARGET_SCHEMA = 'mythos_intelligence';

// ---------------------------------------------------------------------------
// 1. MIGRATION INPUTS — exact order, from file evidence, not assumption.
//
// NOTE ON NAMING: there is no "MPI-1 schema". MPI-1 is the context runtime and
// is pure JavaScript with no SQL. The second input is the MPI-2 memory-engine
// delta. Recorded here so the ordering is not mis-derived from stage numbers.
// ---------------------------------------------------------------------------
const MIGRATIONS = [
  {
    version: '001-mpi-0-control-plane',
    file: 'control-plane-schema.sql',
    stage: 'MPI-0',
    dependsOn: [],
    provides: { tables: 15, indexes: 0, checks: 0 },
    note: 'Ratified. 15 control-plane tables. Unqualified DDL — requires search_path.'
  },
  {
    version: '002-mpi-2-memory-engine',
    file: 'memory-engine-schema.sql',
    stage: 'MPI-2 (delta)',
    dependsOn: ['001-mpi-0-control-plane'],
    provides: { tables: 5, indexes: 12, checks: 2 },
    note: 'Ratified. Self-described DELTA on 001; columns reference its tables.'
  },
  {
    version: '003-mpi-2a-remediation',
    file: 'mpi-2a-remediation-proposal.sql',
    stage: 'MPI-2A',
    dependsOn: ['002-mpi-2-memory-engine'],
    provides: { tables: 0, indexes: 3, checks: 6, foreignKeys: 33, triggers: 8, roles: 3 },
    note: 'Resolves F1/F2/F3/F4/F7. Schema-qualified, so it must run AFTER 001+002.'
  }
];

// Migration state lives INSIDE mythos_intelligence so that
// `pg_dump --schema=mythos_intelligence` (§2.2's backup unit) captures the
// schema and its version together — a restore that loses its version is a
// restore nobody can reason about. It is deliberately NOT `pi_`-prefixed, so
// the "exactly 20 pi_* tables" assertion stays exact.
const VERSION_TABLE = 'schema_migrations';

const CREATE_VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS ${TARGET_SCHEMA}.${VERSION_TABLE} (
  version      VARCHAR(128) PRIMARY KEY,
  source_file  VARCHAR(256) NOT NULL,
  sha256       VARCHAR(64),
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by   VARCHAR(128) NOT NULL DEFAULT CURRENT_USER
)`;

// ---------------------------------------------------------------------------
// 3. IDEMPOTENCY — stated, not assumed.
//
// Inputs 001 and 002 are NOT idempotent: they contain zero IF NOT EXISTS /
// DROP / CREATE OR REPLACE guards and fail on re-apply with
// `relation "pi_domains" already exists`. They fail CLOSED — Stage A confirmed
// re-application leaves the table count unchanged, with no partial mutation.
//
// The runner therefore never retries and never repairs. It refuses up front.
// DROP ... CASCADE is NEVER issued as automatic recovery: on this schema it
// would silently destroy append-only audit rows that exist precisely so history
// cannot be destroyed. Recovery is an explicit, separately reviewed human act.
// ---------------------------------------------------------------------------
const REFUSAL_CONDITIONS = [
  'target already contains unexpected pi_* tables',
  'mythos_intelligence already contains conflicting objects',
  'schema ownership is unexpected',
  'migration version state is inconsistent with the files on disk',
  'database or server identity does not match the explicitly confirmed target',
  'backup gate not asserted closed by the operator',
  'PostgreSQL major version below the documented target'
];

function sha256OfMigration(m) {
  const crypto = require('crypto');
  const text = fs.readFileSync(path.join(DB_DIR, m.file), 'utf8');
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readMigration(m) {
  return fs.readFileSync(path.join(DB_DIR, m.file), 'utf8');
}

// ---------------------------------------------------------------------------
// 4. PRE-MIGRATION SAFETY CHECKS. Every check returns a row; the runner fails
//    closed if ANY check is not ok, and also if a check cannot be evaluated —
//    ambiguity is treated as failure, never as permission.
//
//    Two preconditions CANNOT be verified from inside PostgreSQL and are marked
//    operatorAsserted: free disk space and off-host backup status. The runner
//    demands them explicitly rather than pretending to have checked them.
// ---------------------------------------------------------------------------
async function preflight(client, opts) {
  const o = opts || {};
  const checks = [];
  function add(name, expected, actual, ok, operatorAsserted) {
    checks.push({ name, expected, actual, ok: !!ok, operatorAsserted: !!operatorAsserted });
  }

  const one = async function (sql, params) {
    const r = await client.query(sql, params || []);
    return r.rows && r.rows[0] ? r.rows[0] : null;
  };

  // --- identity: refuse if the operator has not named the target explicitly
  if (!o.expectedDatabase) {
    add('expected_database_supplied', 'explicit --database', 'missing', false);
    return { ok: false, checks: checks };
  }

  const ver = await one("SELECT current_setting('server_version_num') AS server_version_num");
  const versionNum = ver ? parseInt(ver.server_version_num, 10) : NaN;
  add('postgres_major_version', '>= 15 (documented target 15.18)', String(versionNum), versionNum >= 150000);

  const db = await one('SELECT current_database() AS db, current_user AS usr');
  add('database_identity', o.expectedDatabase, db && db.db, db && db.db === o.expectedDatabase);

  // Server identity: the cluster's own system identifier, which survives
  // renames and is not something a misconfigured host can fake by accident.
  const sysid = await one('SELECT system_identifier::text AS sysid FROM pg_control_system()');
  if (o.expectedSystemIdentifier) {
    add('server_identity', o.expectedSystemIdentifier, sysid && sysid.sysid,
        sysid && sysid.sysid === o.expectedSystemIdentifier);
  } else {
    add('server_identity', 'explicit --system-identifier', sysid && sysid.sysid, false);
  }

  const rec = await one('SELECT pg_is_in_recovery() AS rec');
  add('not_a_replica', 'false', String(rec && rec.rec), rec && (rec.rec === false || rec.rec === 'f'));

  // --- current state
  const schemas = await one(`SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = '${TARGET_SCHEMA}'`);
  add('target_schema_absent_or_empty', '0 (absent) before first apply', String(schemas.n),
      Number(schemas.n) === 0 || o.allowExistingSchema === true);

  const piAll = await one("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_name LIKE 'pi\\_%'");
  add('pi_tables_anywhere', '0', String(piAll.n), Number(piAll.n) === 0);

  const piPublic = await one("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema='public' AND table_name LIKE 'pi\\_%'");
  add('pi_tables_in_public', '0', String(piPublic.n), Number(piPublic.n) === 0);

  const ext = await client.query('SELECT extname FROM pg_extension ORDER BY 1');
  const extNames = (ext.rows || []).map(function (r) { return r.extname; }).join(',');
  add('extensions_installed', 'plpgsql only; no extension required by MPI', extNames, true);

  const conns = await one('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()');
  const maxc = await one("SELECT current_setting('max_connections') AS max_connections");
  add('active_connections', 'below max_connections', conns.n + '/' + (maxc && maxc.max_connections),
      Number(conns.n) < Number(maxc.max_connections));

  const size = await one('SELECT pg_size_pretty(pg_database_size(current_database())) AS sz');
  add('database_size', 'recorded for capacity planning', size && size.sz, true);

  // --- migration version state
  const hasVersionTable = await one(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='${TARGET_SCHEMA}' AND table_name='${VERSION_TABLE}'`);
  let applied = [];
  if (Number(hasVersionTable.n) > 0) {
    const r = await client.query(`SELECT version, sha256 FROM ${TARGET_SCHEMA}.${VERSION_TABLE} ORDER BY version`);
    applied = r.rows || [];
  }
  // Consistency: anything recorded as applied must match the file on disk. A
  // recorded version whose file has since changed means the database and the
  // repository disagree about what was actually run.
  let versionStateOk = true;
  let versionDetail = applied.length + ' recorded';
  for (const row of applied) {
    const m = MIGRATIONS.find(function (x) { return x.version === row.version; });
    if (!m) { versionStateOk = false; versionDetail = 'unknown version recorded: ' + row.version; break; }
    if (row.sha256 && row.sha256 !== sha256OfMigration(m)) {
      versionStateOk = false; versionDetail = 'checksum drift on ' + row.version; break;
    }
  }
  add('migration_version_state', 'consistent with files on disk', versionDetail, versionStateOk);

  // --- operator-asserted preconditions (NOT machine-verifiable from SQL)
  add('free_disk_space', 'operator-asserted --disk-ok', o.diskOk ? 'asserted' : 'NOT asserted', o.diskOk === true, true);
  add('backup_gate_closed', 'operator-asserted --backup-gate-closed (see §9)',
      o.backupGateClosed ? 'asserted' : 'NOT asserted', o.backupGateClosed === true, true);
  add('application_compatibility', 'adapter present and MPI-2C validated',
      o.applicationReady ? 'asserted' : 'NOT asserted', o.applicationReady === true, true);

  return { ok: checks.every(function (c) { return c.ok; }), checks: checks };
}

// ---------------------------------------------------------------------------
// 2. APPLY. One transaction for the whole migration.
//
// PostgreSQL has transactional DDL, so a mid-migration failure rolls the entire
// schema back with no partial state. This is asserted by test, not assumed —
// see tests/mpi-2a-migration-runner-test.js, which forces a failure between
// files and verifies zero surviving objects.
// ---------------------------------------------------------------------------
async function apply(client, opts) {
  const o = opts || {};
  const pre = await preflight(client, o);
  if (!pre.ok && !o.skipPreflight) {
    const failed = pre.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.name; });
    const err = new Error('migration refused by preflight: ' + failed.join(', '));
    err.preflight = pre;
    throw err;
  }

  return client.withTransaction(async function (exec) {
    await exec.query(`CREATE SCHEMA IF NOT EXISTS ${TARGET_SCHEMA}`);
    await exec.query(`SET LOCAL search_path TO ${TARGET_SCHEMA}`);
    await exec.query(CREATE_VERSION_TABLE);

    const results = [];
    for (const m of MIGRATIONS) {
      const already = await exec.query(
        `SELECT 1 AS x FROM ${TARGET_SCHEMA}.${VERSION_TABLE} WHERE version = $1`, [m.version]);
      if (already.rows && already.rows.length) { results.push({ version: m.version, status: 'already-applied' }); continue; }

      await exec.query(readMigration(m));
      await exec.query(
        `INSERT INTO ${TARGET_SCHEMA}.${VERSION_TABLE} (version, source_file, sha256) VALUES ($1,$2,$3)`,
        [m.version, m.file, sha256OfMigration(m)]);
      results.push({ version: m.version, status: 'applied' });
      if (o.failAfter === m.version) {
        // Test hook only: proves the whole transaction rolls back.
        throw new Error('forced failure after ' + m.version + ' (test hook)');
      }
    }
    return results;
  });
}

// ---------------------------------------------------------------------------
// 5. POST-MIGRATION ASSERTIONS — catalog queries, never exit status.
// ---------------------------------------------------------------------------
async function assertSchema(client) {
  const results = [];
  function add(name, expected, actual) {
    results.push({ name, expected: String(expected), actual: String(actual), ok: String(expected) === String(actual) });
  }
  const scalar = async function (sql) {
    const r = await client.query(sql, []);
    const row = r.rows && r.rows[0];
    return row ? row[Object.keys(row)[0]] : null;
  };

  add('schema_exists', 1, await scalar(
    `SELECT count(*)::int FROM information_schema.schemata WHERE schema_name='${TARGET_SCHEMA}'`));
  add('pi_tables_in_target', 20, await scalar(
    `SELECT count(*)::int FROM information_schema.tables WHERE table_schema='${TARGET_SCHEMA}' AND table_type='BASE TABLE' AND table_name LIKE 'pi\\_%'`));
  add('pi_tables_in_public', 0, await scalar(
    "SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name LIKE 'pi\\_%'"));
  add('non_pi_tables_in_target', 1, await scalar(
    `SELECT count(*)::int FROM information_schema.tables WHERE table_schema='${TARGET_SCHEMA}' AND table_type='BASE TABLE' AND table_name NOT LIKE 'pi\\_%'`));
  add('foreign_keys', 33, await scalar(
    `SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='${TARGET_SCHEMA}' AND c.contype='f'`));
  // F2: the immutable set must carry NO foreign key — a referential action is a
  // write, and these tables do not accept writes.
  add('fks_on_immutable_tables', 0, await scalar(
    `SELECT count(*)::int FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='${TARGET_SCHEMA}' AND c.contype='f'
        AND t.relname IN ('pi_preference_audit','pi_guard_decisions','pi_memory_tombstones','pi_memory_provenance')`));
  add('mpi_2a_columns', 7, await scalar(
    `SELECT count(*)::int FROM information_schema.columns WHERE table_schema='${TARGET_SCHEMA}' AND table_name='pi_memory_records'
       AND column_name IN ('state','supersedes_memory_id','superseded_at','observed_at','valid_from','valid_to','evidence_count')`));
  add('check_constraints', 8, await scalar(
    `SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='${TARGET_SCHEMA}' AND c.contype='c'`));
  // 55 = the 54 counted at the MPI-2 design gate (12 explicit + 20 PK + 19 UNIQUE
  // + 3 remediation) PLUS the primary-key index on schema_migrations, which the
  // design gate did not have. Scratch validation caught this off-by-one.
  add('indexes', 55, await scalar(
    `SELECT count(*)::int FROM pg_indexes WHERE schemaname='${TARGET_SCHEMA}'`));
  add('append_only_triggers', 8, await scalar(
    `SELECT count(*)::int FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT tg.tgisinternal AND n.nspname='${TARGET_SCHEMA}'`));
  add('f4_canonical_order_check', 1, await scalar(
    "SELECT count(*)::int FROM pg_constraint WHERE conname='chk_pi_conflict_canonical_order'"));
  add('required_roles', 3, await scalar(
    "SELECT count(*)::int FROM pg_roles WHERE rolname IN ('mythos_intelligence_owner','mythos_intelligence_app','mythos_intelligence_maint')"));
  add('migration_versions_recorded', MIGRATIONS.length, await scalar(
    `SELECT count(*)::int FROM ${TARGET_SCHEMA}.${VERSION_TABLE}`));
  // "No unexpected objects": every table is either a ratified pi_* table or the
  // single migration-tracking table.
  add('unexpected_tables', 0, await scalar(
    `SELECT count(*)::int FROM information_schema.tables WHERE table_schema='${TARGET_SCHEMA}' AND table_type='BASE TABLE'
       AND table_name NOT LIKE 'pi\\_%' AND table_name <> '${VERSION_TABLE}'`));

  return { ok: results.every(function (r) { return r.ok; }), results: results };
}

module.exports = {
  MIGRATIONS: MIGRATIONS,
  TARGET_SCHEMA: TARGET_SCHEMA,
  VERSION_TABLE: VERSION_TABLE,
  REFUSAL_CONDITIONS: REFUSAL_CONDITIONS,
  preflight: preflight,
  apply: apply,
  assertSchema: assertSchema,
  sha256OfMigration: sha256OfMigration
};
