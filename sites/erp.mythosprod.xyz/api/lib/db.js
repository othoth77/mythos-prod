'use strict';

/* Database access with tenant context.
 *
 * Every tenant-scoped request runs inside a transaction that sets the RLS GUC
 * `mythos_erp.tenant_id`. That is not a convention the handlers must remember —
 * it is the only way to get a client from this module, so a handler that
 * "forgot" cannot be written.
 *
 * The GUC is set with set_config(..., true) — parameterised and transaction-
 * local. `SET LOCAL x = '<value>'` cannot take a bind parameter, which means
 * string interpolation, which means a tenant id would be reaching a SQL string.
 * set_config avoids the question entirely.
 *
 * If the GUC is never set, current_tenant() is NULL and every RLS policy
 * evaluates to NULL: the connection sees NO rows. Failure is empty, not open.
 */

var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value, what) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new Error('invalid uuid for ' + (what || 'value'));
  }
  return value;
}

function makePool(pg, opts) {
  var o = opts || {};
  var conn = o.connectionString || process.env.ERP_DATABASE_URL;
  if (!conn) throw new Error('ERP_DATABASE_URL is not set');
  return new pg.Pool({
    connectionString: conn,
    max: o.max || 8,
    idleTimeoutMillis: o.idleTimeoutMillis || 30000,
    // A statement timeout is a availability control: one pathological report
    // query must not hold a pool slot until the process is restarted.
    statement_timeout: o.statementTimeout || 15000
  });
}

/* Run fn inside a transaction bound to one tenant. */
async function withTenant(pool, tenantId, fn) {
  assertUuid(tenantId, 'tenant_id');
  var client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('mythos_erp.tenant_id', $1, true)", [tenantId]);
    var out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

/* Platform-level work that legitimately precedes tenant selection: login,
   password reset, listing which tenants a user may enter. No GUC is set, so
   every tenant-scoped table is empty from this client's point of view — which
   is exactly the protection wanted if one of these ever touches one. */
async function withoutTenant(pool, fn) {
  var client = await pool.connect();
  try {
    await client.query('BEGIN');
    var out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  UUID: UUID,
  assertUuid: assertUuid,
  makePool: makePool,
  withTenant: withTenant,
  withoutTenant: withoutTenant
};
