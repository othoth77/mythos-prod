'use strict';
// =====================================================
// MYTHOS AI COMMAND CENTER — database connection
// projects/command-center/reference/db.js
//
// Thin wrapper around node-postgres (`pg`), following the established
// repository convention in projects/idauto/reference/db.js and
// projects/ssangyong-autos/reference/db.js. All connection parameters come
// from environment variables — nothing is hardcoded, and no credential
// value is ever logged, thrown in an error message, or returned to a
// caller. The operational credential lives at
// /home/deploy/deployments/mythos-command-center/.env (0600, outside the
// git worktree); this module never reads that file, only the environment.
//
// DIFFERENCE FROM ssangyong-autos/db.js, and why:
// that module pins `default_transaction_read_only=on` because SYA-API-1 is
// a consumption stage with no write path. The Command Center is a library
// the owner edits from the browser, so it MUST write. Read-only-by-
// construction is therefore not available here, and the safety guarantee is
// carried elsewhere instead:
//
//   * every statement is parameterized — this module exposes no raw SQL
//     escape hatch, exactly as its siblings do;
//   * writes are confined to the `mcc` schema, pinned below as the sole
//     search_path, so a query in this application cannot reach the
//     `idauto` or `ssangyong_autos` databases' objects even by accident;
//   * destructive SQL (DROP/TRUNCATE/DELETE of a command) has no caller:
//     archiving is a status change, and version history is append-only.
// =====================================================

var Pool = require('pg').Pool;

var pool = null;

var REQUIRED_ENV = [
  'MCC_DB_HOST',
  'MCC_DB_PORT',
  'MCC_DB_USER',
  'MCC_DB_PASSWORD',
  'MCC_DB_NAME'
];

function getPool() {
  if (pool) return pool;
  var missing = REQUIRED_ENV.filter(function (name) { return !process.env[name]; });
  if (missing.length) {
    throw new Error('db.js: missing required environment variable(s): ' + missing.join(', '));
  }
  pool = new Pool({
    host: process.env.MCC_DB_HOST,
    port: parseInt(process.env.MCC_DB_PORT, 10),
    user: process.env.MCC_DB_USER,
    password: process.env.MCC_DB_PASSWORD,
    database: process.env.MCC_DB_NAME,
    // Confine every connection to this product's schema. `mcc` only —
    // `public` is deliberately absent so an unqualified name cannot
    // silently resolve to something outside this product.
    options: '-c search_path=mcc',
    max: 8,
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

// Multi-statement writes that must not half-apply — saving a command
// writes the previous version snapshot, the row, and its tag/relation sets
// together. Callers must not BEGIN/COMMIT by hand.
async function transaction(fn) {
  var client = await getPool().connect();
  try {
    await client.query('BEGIN');
    var result = await fn(function (text, params) {
      return client.query(text, params || []);
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rollbackErr) { /* original error wins */ }
    throw err;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  query: query,
  transaction: transaction,
  closePool: closePool,
  REQUIRED_ENV: REQUIRED_ENV
};
