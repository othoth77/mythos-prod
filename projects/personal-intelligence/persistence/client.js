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
// The driver contract is deliberately the node-postgres shape:
//     driver.query({ text, values }) -> Promise<{ rows: Array }>
// so a real `pg` Pool/Client satisfies it unchanged when a driver is adopted.
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

  async function query(text, values) {
    try {
      return await driver.query({ text: text, values: values || [] });
    } catch (err) {
      throw wrap(err);
    }
  }

  async function setSchema() {
    // Explicit, per unit of work. Identifier is validated, not interpolated
    // blindly: schema names never come from user input in this layer.
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('invalid schema identifier');
    await query('SET search_path TO ' + schema);
  }

  // Every multi-statement lifecycle step in §18.7 runs through here. The whole
  // transaction is retried on a transient failure — retrying one statement
  // inside an aborted transaction cannot work.
  async function withTransaction(fn) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await query('BEGIN');
        await setSchema();
        const result = await fn({ query: query });
        await query('COMMIT');
        return result;
      } catch (err) {
        const wrapped = wrap(err);
        try { await query('ROLLBACK'); } catch (_) { /* connection already gone */ }
        if (wrapped.kind !== KIND.TRANSIENT || attempt === maxAttempts) throw wrapped;
        lastError = wrapped;
      }
    }
    throw lastError;
  }

  // Read path: no transaction, but the schema is still set explicitly.
  async function read(text, values) {
    await setSchema();
    return query(text, values);
  }

  return {
    schema: schema,
    query: query,
    read: read,
    withTransaction: withTransaction,
    setSchema: setSchema
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
