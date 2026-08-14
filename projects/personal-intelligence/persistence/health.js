// =====================================================
// Mythos Personal Intelligence — Persistence Health / Readiness
// projects/personal-intelligence/persistence/health.js
//
// The two remaining items of the observability minimum contract
// (docs/MPI_FINDINGS_REMEDIATION.md): the persistence-initialisation result
// and the health/readiness signal. Per that contract this is deliberately
// small — "a checkHealth() returning the assertSchema() result" — and is the
// startup probe the activation plan (§20.6) sequences before repository
// initialisation: connection test → schema assertions → ready.
//
// STATUS: scratch implementation. Not wired into any application; never
// pointed at a production database.
// =====================================================
'use strict';

const migrate = require('./migrate');

// checkHealth(client) -> { ok, connectivity, schema }
//   connectivity — a single probe statement reached the database
//   schema       — the full assertSchema() result (expected vs actual per row)
// Emits one structured 'persistence_health' event via the client's injected
// logger (silent by default). Never throws for an unhealthy target — an
// unreachable or unmigrated database is a REPORT, not a crash — but the
// activation plan treats ok !== true as "do not start the MPI feature".
async function checkHealth(client) {
  const result = { ok: false, connectivity: false, schema: null };
  try {
    await client.query('SELECT 1');
    result.connectivity = true;
  } catch (e) {
    client.emit('persistence_health', {
      ok: false, connectivity: false,
      kind: (e && e.kind) || 'UNKNOWN'
    });
    return result;
  }
  try {
    result.schema = await migrate.assertSchema(client);
    result.ok = result.schema.ok === true;
  } catch (e) {
    // e.g. the schema does not exist at all — report, never crash.
    result.schema = { ok: false, results: [], error: (e && e.kind) || 'UNKNOWN' };
  }
  client.emit('persistence_health', {
    ok: result.ok,
    connectivity: result.connectivity,
    failedChecks: result.schema && result.schema.results
      ? result.schema.results.filter(function (r) { return !r.ok; }).length
      : null
  });
  return result;
}

module.exports = { checkHealth: checkHealth };
