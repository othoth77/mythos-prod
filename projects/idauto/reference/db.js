'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-2C — database connection
// projects/idauto/reference/db.js
//
// Thin wrapper around node-postgres (`pg`), the repository's first real
// runtime dependency (see projects/idauto/package.json). All connection
// parameters come from environment variables — nothing is hardcoded, and
// no credential value is ever logged, thrown in an error message, or
// returned to a caller.
//
// Scope (IDA-2C): read-only. This module itself does not enforce that —
// callers (projects/idauto/reference/api-read.js) are responsible for only
// issuing SELECT statements. A later slice (IDA-2D) adds write support.
// =====================================================

var Pool = require('pg').Pool;

var pool = null;

function getPool() {
  if (pool) return pool;
  var required = ['IDAUTO_DB_HOST', 'IDAUTO_DB_PORT', 'IDAUTO_DB_USER', 'IDAUTO_DB_PASSWORD', 'IDAUTO_DB_NAME'];
  var missing = required.filter(function (name) { return !process.env[name]; });
  if (missing.length) {
    throw new Error('db.js: missing required environment variable(s): ' + missing.join(', '));
  }
  pool = new Pool({
    host: process.env.IDAUTO_DB_HOST,
    port: parseInt(process.env.IDAUTO_DB_PORT, 10),
    user: process.env.IDAUTO_DB_USER,
    password: process.env.IDAUTO_DB_PASSWORD,
    database: process.env.IDAUTO_DB_NAME,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
  // Never let a pool-level error crash the process silently with a stack
  // trace that might include connection details in some driver versions.
  pool.on('error', function () {
    // Intentionally does not log the error object — it can carry
    // connection-string-shaped detail. Pool-level errors are operational,
    // not this module's concern to report further; callers see errors
    // from their own query() calls.
  });
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
  closePool: closePool
};
