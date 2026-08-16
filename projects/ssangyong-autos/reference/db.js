'use strict';
// =====================================================
// MYTHOS — SsangYong Parts (SSANGYONG.AUTOS) — database connection
// projects/ssangyong-autos/reference/db.js
//
// Thin wrapper around node-postgres (`pg`), mirroring the established
// repository convention in projects/idauto/reference/db.js. All connection
// parameters come from environment variables — nothing is hardcoded, and no
// credential value is ever logged, thrown in an error message, or returned
// to a caller. The operational credential for the live catalog lives at
// /home/deploy/deployments/ssangyong-autos-postgres/.env (0600, outside the
// git worktree — see docs/AI_HANDOVER.md, Stage 5 Phase 1+2 record); this
// module never reads that file itself, it only reads the environment.
//
// TWO DIFFERENCES FROM idauto/db.js, both deliberate:
//
//  1. READ-ONLY BY CONSTRUCTION. Every connection this pool opens is started
//     with `-c default_transaction_read_only=on` as a *connection option* —
//     the same mechanism Stage 5 Phase 3 used to supply search_path. The
//     server itself then refuses INSERT/UPDATE/DELETE/DDL on this pool, so
//     read-only is not merely a convention this file's callers are trusted
//     to honour. SYA-API-1 is a consumption stage: nothing in it writes to
//     the catalog, and nothing built on this module can start to.
//
//  2. No getClientForTransaction(). There is no write path to make atomic.
//     If a later stage is authorised to write to the catalog, it must add
//     its own connection path with its own audit contract, rather than
//     widening this one.
//
// search_path is already pinned per-database on the ssangyong_autos_owner
// role (Stage 5 Phase 2), so unqualified sya_* names resolve correctly
// without this module setting it.
// =====================================================

var Pool = require('pg').Pool;

var pool = null;

var REQUIRED_ENV = [
  'SSANGYONG_DB_HOST',
  'SSANGYONG_DB_PORT',
  'SSANGYONG_DB_USER',
  'SSANGYONG_DB_PASSWORD',
  'SSANGYONG_DB_NAME'
];

function getPool() {
  if (pool) return pool;
  var missing = REQUIRED_ENV.filter(function (name) { return !process.env[name]; });
  if (missing.length) {
    throw new Error('db.js: missing required environment variable(s): ' + missing.join(', '));
  }
  pool = new Pool({
    host: process.env.SSANGYONG_DB_HOST,
    port: parseInt(process.env.SSANGYONG_DB_PORT, 10),
    user: process.env.SSANGYONG_DB_USER,
    password: process.env.SSANGYONG_DB_PASSWORD,
    database: process.env.SSANGYONG_DB_NAME,
    options: '-c default_transaction_read_only=on',
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
  // Never log the pool-level error object — in some driver versions it can
  // carry connection-string-shaped detail. Callers see errors raised by
  // their own query() calls; pool-level errors are operational.
  pool.on('error', function () {});
  return pool;
}

// Always parameterized — callers pass `params`, never build SQL by string
// concatenation. This is the only query path in the module; there is no
// raw/unparameterized escape hatch.
function query(text, params) {
  return getPool().query(text, params || []);
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  query: query,
  closePool: closePool,
  REQUIRED_ENV: REQUIRED_ENV
};
