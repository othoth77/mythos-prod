// =====================================================
// Mythos Personal Intelligence — Persistence Client
// projects/personal-intelligence/persistence/client.js
//
// Connection, transaction, query-execution and error-mapping contract for the
// mythos_intelligence schema. Implements the interface specified in
// docs/MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md §18.7.
//
// STATUS: scratch implementation (MPI-2B). Validated only against a throwaway
// PostgreSQL 15.18 container. Not wired into any production application and not
// pointed at any production database.
//
// NO DRIVER DEPENDENCY. This repository has no package.json and no node_modules
// by design, so this module takes an injected driver rather than requiring one.
// The driver contract:
//     driver.query({ text, values })   -> Promise<{ rows: Array }>   single statement
//     driver.acquire()                 -> Promise<{ query, release }> transaction-bound
// A node-postgres Pool is adapted automatically through its connect(); a
// query-only driver is REFUSED for transactions rather than assumed to be
// session-affine. See F11 in docs/MPI_CRITICAL_FINDINGS.md.
// =====================================================
'use strict';

// The authoritative logical target. Never 'public' — MYTHOS_MEMORY_ENGINE_
// ARCHITECTURE.md §18.1. Accidental search_path behaviour is exactly the F1
// defect, so the schema is set explicitly on every unit of work.
const DEFAULT_SCHEMA = 'mythos_intelligence';

// PostgreSQL SQLSTATEs this layer understands. Anything else surfaces unmapped.
const SQLSTATE = {
  FOREIGN_KEY_VIOLATION: '23503',
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
  RESTRICT_VIOLATION: '23001', // raised by the F7 append-only triggers
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01'
};

// Only these are safe to retry. A constraint violation is deterministic: it will
// fail identically forever, and retrying it just multiplies load and log noise.
const RETRYABLE = [SQLSTATE.SERIALIZATION_FAILURE, SQLSTATE.DEADLOCK_DETECTED];

class PersistenceError extends Error {
  constructor(message, kind, cause) {
    super(message);
    this.name = 'PersistenceError';
    this.kind = kind;
    this.cause = cause;
    this.sqlstate = cause && cause.code ? cause.code : null;
  }
}

// Named kinds keep callers from string-matching driver messages, which change
// between driver versions and PostgreSQL releases.
const KIND = {
  FOREIGN_KEY: 'FOREIGN_KEY_VIOLATION',
  UNIQUE: 'UNIQUE_VIOLATION',
  CHECK: 'CHECK_VIOLATION',
  NOT_NULL: 'NOT_NULL_VIOLATION',
  APPEND_ONLY: 'APPEND_ONLY_VIOLATION',
  TRANSIENT: 'TRANSIENT',
  UNKNOWN: 'UNKNOWN'
};

function classify(err) {
  const code = err && err.code;
  if (code === SQLSTATE.FOREIGN_KEY_VIOLATION) return KIND.FOREIGN_KEY;
  if (code === SQLSTATE.UNIQUE_VIOLATION) return KIND.UNIQUE;
  if (code === SQLSTATE.CHECK_VIOLATION) return KIND.CHECK;
  if (code === SQLSTATE.NOT_NULL_VIOLATION) return KIND.NOT_NULL;
  if (code === SQLSTATE.RESTRICT_VIOLATION) return KIND.APPEND_ONLY;
  if (RETRYABLE.indexOf(code) !== -1) return KIND.TRANSIENT;
  return KIND.UNKNOWN;
}

function wrap(err) {
  if (err instanceof PersistenceError) return err;
  const kind = classify(err);
  const detail = err && err.message ? err.message : String(err);
  return new PersistenceError('[' + kind + '] ' + detail, kind, err);
}

function createClient(config) {
  const cfg = config || {};
  if (!cfg.driver || typeof cfg.driver.query !== 'function') {
    // Fail loudly at construction rather than at the first write.
    throw new Error('createClient: a driver with .query({text, values}) is required');
  }
  const schema = cfg.schema || DEFAULT_SCHEMA;
  if (schema === 'public') {
    // Guards the exact mistake F1 describes.
    throw new Error('createClient: schema must not be "public" — see MEMORY_ENGINE §18.1');
  }
  // Credentials are never read here. Connection details belong to the injected
  // driver, which is configured from the environment by the composition root.
  const maxAttempts = typeof cfg.maxAttempts === 'number' ? cfg.maxAttempts : 3;
  const driver = cfg.driver;

  // ---------------------------------------------------------------------------
  // OBSERVABILITY MINIMUM CONTRACT (docs/MPI_FINDINGS_REMEDIATION.md):
  // a small INJECTED logger, defaulting to silence. One method:
  //     logger.event(name, fields)   — structured, machine-readable
  // Rules enforced here, not left to callers:
  //   - logging never alters success/failure behaviour (emit() swallows
  //     logger exceptions);
  //   - fields are a flat whitelist assembled at the call site — never raw
  //     memory content, summaries, third-party PII, credentials or SQL text.
  // ---------------------------------------------------------------------------
  if (cfg.logger !== undefined && (cfg.logger === null || typeof cfg.logger.event !== 'function')) {
    throw new Error('createClient: logger must expose .event(name, fields) — omit it for silence');
  }
  const logger = cfg.logger || { event: function () {} };
  function emit(name, fields) {
    try { logger.event(name, fields); } catch (_) { /* observability must never change outcomes */ }
  }

  // Single statement, no transaction. Safe on a pool: one statement, one
  // checkout. Never use this for BEGIN/COMMIT — see acquire() below.
  async function query(text, values) {
    try {
      return await driver.query({ text: text, values: values || [] });
    } catch (err) {
      throw wrap(err);
    }
  }

  // ---------------------------------------------------------------------------
  // F11 — CONNECTION AFFINITY.
  //
  // A transaction must run EVERY statement on ONE physical connection. A
  // node-postgres Pool assigns a different connection to each `pool.query()`
  // call — `pg-pool/index.js` does connect() → query() → client.release() per
  // call, and pg's own README states a transaction "requires a single client
  // for multiple queries". Issuing BEGIN, the work and COMMIT through query()
  // therefore spreads them across connections: the writes autocommit and
  // ROLLBACK becomes a silent no-op.
  //
  // Proven against real PostgreSQL — docs/MPI_CRITICAL_FINDINGS.md F11.
  //
  // A driver must expose acquire() -> { query, release }. A node-postgres Pool
  // is adapted automatically via connect(). Anything else is refused rather
  // than silently assumed to be session-affine.
  // ---------------------------------------------------------------------------
  async function acquire() {
    if (typeof driver.acquire === 'function') {
      const conn = await driver.acquire();
      if (!conn || typeof conn.query !== 'function') {
        throw new Error('createClient: driver.acquire() must return { query, release }');
      }
      return conn;
    }
    if (typeof driver.connect === 'function') {
      const c = await driver.connect();
      if (c && typeof c.query === 'function') {
        return {
          query: function (q) { return c.query(q); },
          release: function () { if (typeof c.release === 'function') c.release(); }
        };
      }
    }
    throw new Error(
      'createClient: a transaction requires driver.acquire() -> { query, release } ' +
      '(a node-postgres Pool is adapted via connect()). Passing a query-only driver ' +
      'would split BEGIN/COMMIT across connections — see F11.');
  }

  async function runOn(conn, text, values) {
    try {
      return await conn.query({ text: text, values: values || [] });
    } catch (err) {
      throw wrap(err);
    }
  }

  function releaseOnce(conn) {
    let done = false;
    return function () {
      if (done) return;
      done = true;
      try { if (typeof conn.release === 'function') conn.release(); } catch (_) { /* already gone */ }
    };
  }

  function assertSchemaIdentifier() {
    // Identifier is validated, not interpolated blindly: schema names never
    // come from user input in this layer.
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('invalid schema identifier');
  }

  async function setSchema() {
    assertSchemaIdentifier();
    await query('SET search_path TO ' + schema);
  }

  // Every multi-statement lifecycle step in §18.7 runs through here, on ONE
  // acquired connection. The whole transaction is retried on a transient
  // failure — retrying one statement inside an aborted transaction cannot work
  // — and each attempt acquires its own connection.
  async function withTransaction(fn) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const conn = await acquire();
      const release = releaseOnce(conn);
      try {
        await runOn(conn, 'BEGIN');
        assertSchemaIdentifier();
        await runOn(conn, 'SET search_path TO ' + schema);
        const result = await fn({ query: function (t, v) { return runOn(conn, t, v); } });
        await runOn(conn, 'COMMIT');
        return result;
      } catch (err) {
        const wrapped = wrap(err);
        // ROLLBACK on the SAME connection that holds the transaction.
        try { await runOn(conn, 'ROLLBACK'); } catch (_) { /* connection already gone */ }
        const willRetry = wrapped.kind === KIND.TRANSIENT && attempt < maxAttempts;
        emit('transaction_failed', {
          kind: wrapped.kind,
          sqlstate: wrapped.sqlstate || null,
          attempt: attempt,
          maxAttempts: maxAttempts,
          willRetry: willRetry
        });
        if (!willRetry) {
          if (wrapped.kind === KIND.TRANSIENT) emit('transaction_retries_exhausted', { attempts: attempt });
          throw wrapped;
        }
        lastError = wrapped;
      } finally {
        release();
      }
    }
    throw lastError;
  }

  // Read path: no transaction, but `SET search_path` and the read must still
  // share one connection or the search_path would apply to a different one.
  async function read(text, values) {
    const conn = await acquire();
    const release = releaseOnce(conn);
    try {
      assertSchemaIdentifier();
      await runOn(conn, 'SET search_path TO ' + schema);
      return await runOn(conn, text, values);
    } finally {
      release();
    }
  }

  return {
    schema: schema,
    query: query,
    read: read,
    acquire: acquire,
    withTransaction: withTransaction,
    setSchema: setSchema,
    // Observability surface. emit() is exception-safe; lifecycles use it for
    // append-only write-failure visibility. Whitelisted flat fields only.
    emit: emit
  };
}

module.exports = {
  createClient: createClient,
  PersistenceError: PersistenceError,
  KIND: KIND,
  SQLSTATE: SQLSTATE,
  DEFAULT_SCHEMA: DEFAULT_SCHEMA,
  classify: classify
};
