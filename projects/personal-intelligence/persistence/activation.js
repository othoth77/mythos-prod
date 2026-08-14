// =====================================================
// Mythos Personal Intelligence — Activation Readiness
// projects/personal-intelligence/persistence/activation.js
//
// Implements EXACTLY the activation contract of MYTHOS_MEMORY_ENGINE_
// ARCHITECTURE.md §20.5 (environment configuration) and §20.6 (activation
// sequence). Nothing here connects to anything unless the composition root
// calls activate() with the flag enabled and a driver source.
//
// STATUS: scratch implementation. Not wired into any application; never
// pointed at a production database. This module makes `applicationReady`
// TRUTHFULLY assertable — it does not assert it for anyone.
//
// DRIVER: `pg` is deliberately NOT an MPI dependency (this repository has no
// root package.json, and idauto's vendored copy is gitignored). The
// composition root injects the pg module (`activate({ pg: require('pg') })`)
// or a prebuilt driver. A missing driver source is a refusal, never a
// silent mock.
// =====================================================
'use strict';

const { createClient } = require('./client');
const { checkHealth } = require('./health');

// ---------------------------------------------------------------------------
// §20.5 environment contract. Names are the implementation of the documented
// table. Host/port/database/user have NO defaults — absent means refuse to
// start. The password is read only to be handed to the driver; it is never
// logged, never echoed in errors, and never appears in any thrown message.
// The statement timeout is REQUIRED: "no unbounded statement timeout in
// production" is a contract line, not advice.
// ---------------------------------------------------------------------------
const ENV = {
  flag: 'MPI_PERSISTENCE_ENABLED',
  required: ['MPI_PG_HOST', 'MPI_PG_PORT', 'MPI_PG_DATABASE', 'MPI_PG_USER', 'MPI_PG_PASSWORD',
             'MPI_PG_STATEMENT_TIMEOUT_MS'],
  optional: ['MPI_PG_POOL_SIZE', 'MPI_PG_CONNECT_TIMEOUT_MS', 'MPI_PG_SSL']
};

const POSITIVE_INT = ['MPI_PG_PORT', 'MPI_PG_STATEMENT_TIMEOUT_MS', 'MPI_PG_POOL_SIZE', 'MPI_PG_CONNECT_TIMEOUT_MS'];

function fail(missing, invalid) {
  const parts = [];
  if (missing.length) parts.push('missing: ' + missing.join(', '));
  if (invalid.length) parts.push('invalid: ' + invalid.join(', '));
  // Variable NAMES only — never values. A password value must not be able to
  // reach this string even by operator mistake.
  const err = new Error('MPI ACTIVATION REFUSED (' + parts.join('; ') + ') — ' +
    'the §20.5 environment contract is fail-closed: absent or malformed configuration refuses to start.');
  err.code = 'ACTIVATION_CONFIG_REFUSED';
  err.missing = missing;
  err.invalid = invalid;
  throw err;
}

// loadActivationConfig(env) -> { enabled:false } | { enabled:true, pg:{...} }
// Strict flag semantics, matching the F10 gate discipline: only the exact
// string 'true' enables. Anything else — unset, 'TRUE', '1', 'yes' — is
// disabled, because a persistence layer switched on by a stray truthy value
// is not a switch.
function loadActivationConfig(env) {
  const e = env || {};
  if (e[ENV.flag] !== 'true') return { enabled: false, reason: ENV.flag + ' is not exactly "true"' };

  const missing = ENV.required.filter(function (k) { return !e[k]; });
  const invalid = [];
  POSITIVE_INT.forEach(function (k) {
    if (e[k] !== undefined && !(/^[0-9]+$/.test(e[k]) && Number(e[k]) > 0)) invalid.push(k);
  });
  if (e.MPI_PG_SSL !== undefined && e.MPI_PG_SSL !== 'true' && e.MPI_PG_SSL !== 'false') invalid.push('MPI_PG_SSL');
  if (missing.length || invalid.length) fail(missing, invalid);

  return {
    enabled: true,
    pg: {
      host: e.MPI_PG_HOST,
      port: Number(e.MPI_PG_PORT),
      database: e.MPI_PG_DATABASE,
      user: e.MPI_PG_USER,
      password: e.MPI_PG_PASSWORD, // handed to the driver, never logged
      statement_timeout: Number(e.MPI_PG_STATEMENT_TIMEOUT_MS),
      max: e.MPI_PG_POOL_SIZE ? Number(e.MPI_PG_POOL_SIZE) : 5,
      connectionTimeoutMillis: e.MPI_PG_CONNECT_TIMEOUT_MS ? Number(e.MPI_PG_CONNECT_TIMEOUT_MS) : 10000,
      ssl: e.MPI_PG_SSL === 'true'
    }
  };
}

// buildDriver(config, pgModule) -> a real pg.Pool. The Pool satisfies
// client.js's acquire() contract through its connect() — the F11-safe path.
// Construction does not open a connection; the first acquire does.
function buildDriver(config, pgModule) {
  if (!pgModule || typeof pgModule.Pool !== 'function') {
    const err = new Error('MPI ACTIVATION REFUSED: a pg module with .Pool is required — ' +
      'pg is deliberately not an MPI dependency; the composition root must inject require("pg").');
    err.code = 'ACTIVATION_DRIVER_REFUSED';
    throw err;
  }
  return new pgModule.Pool(config.pg);
}

// Liveness vs readiness — distinct questions, distinct answers:
//   isAlive : can the database be reached at all? (connectivity only)
//   isReady : is it reachable AND migrated AND passing every schema
//             assertion? (full checkHealth)
// A live-but-not-ready target must never be treated as ready.
async function isAlive(client) {
  try { await client.query('SELECT 1'); return true; } catch (_) { return false; }
}
async function isReady(client) {
  const h = await checkHealth(client);
  return h.ok === true;
}

// activate({ env, pg, driver, logger }) — the §20.6 startup sequence:
//   flag (default false) → config (fail closed) → driver → client
//   → connection test → assertSchema → ready.
// ANY failure aborts with a thrown error. There is deliberately NO fallback —
// §20.6: a silent in-memory fallback would accept writes that are then lost
// and bypass the F7 audit trail entirely.
// Returns { enabled:false } when the flag is off (the pure reference modules
// remain usable independently), or { enabled:true, client, health } when the
// full sequence passed — at which point applicationReady is TRUTHFULLY
// assertable, and not before.
async function activate(opts) {
  const o = opts || {};
  const config = loadActivationConfig(o.env);
  if (!config.enabled) return { enabled: false, reason: config.reason };

  const driver = o.driver || buildDriver(config, o.pg);
  const client = createClient({ driver: driver, schema: 'mythos_intelligence', logger: o.logger });

  const health = await checkHealth(client);
  if (!health.connectivity) {
    const err = new Error('MPI ACTIVATION ABORTED: connection test failed. No fallback exists by design (§20.6).');
    err.code = 'ACTIVATION_CONNECTION_FAILED';
    err.health = health;
    throw err;
  }
  if (!health.ok) {
    const failed = health.schema && health.schema.results
      ? health.schema.results.filter(function (r) { return !r.ok; }).map(function (r) { return r.name; })
      : ['schema assertions unavailable'];
    const err = new Error('MPI ACTIVATION ABORTED: schema assertions failed (' + failed.join(', ') + '). ' +
      'The target is alive but not ready; refusing to start. No fallback exists by design (§20.6).');
    err.code = 'ACTIVATION_NOT_READY';
    err.health = health;
    throw err;
  }
  return { enabled: true, client: client, health: health };
}

module.exports = {
  ENV: ENV,
  loadActivationConfig: loadActivationConfig,
  buildDriver: buildDriver,
  isAlive: isAlive,
  isReady: isReady,
  activate: activate
};
