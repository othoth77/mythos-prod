'use strict';

/* Audit writer.
 *
 * The design rule is that an unaudited state change must not be expressible.
 * That is enforced two ways, and neither is "remember to call the logger":
 *
 *   1. write() takes an executor, not a pool. Inside a transaction the caller
 *      passes the transaction client, so the audit row commits with the change
 *      or not at all.
 *   2. The database rejects an action name outside the taxonomy (CHECK on
 *      audit_log.action), so the vocabulary cannot rot silently as code grows.
 *
 * The application role has INSERT and SELECT on audit_log and no UPDATE or
 * DELETE, so a compromised application cannot rewrite its own history.
 */

var ACTIONS = [
  'login.success', 'login.failure', 'logout', 'session.revoked',
  'password.reset_requested', 'password.reset_completed', 'password.changed',
  'mfa.enabled', 'mfa.disabled',
  'record.created', 'record.updated', 'record.deleted', 'record.restored',
  'permission.denied', 'role.assigned', 'role.revoked',
  'user.created', 'user.disabled', 'user.enabled',
  'export', 'backup.created', 'backup.restored',
  // Tenancy: switching company, and administering one. A cross-tenant attempt
  // is recorded as permission.denied like any other refusal.
  'tenant.switched', 'tenant.created', 'tenant.updated',
  'module.enabled', 'module.disabled',
  'membership.granted', 'membership.revoked'
];
var OUTCOMES = ['ok', 'denied', 'error'];

/* Redact before anything reaches the detail column. An audit trail that
   captures the credential it was auditing is a liability, not a control. */
var SECRET_KEYS = /^(password|new_password|current_password|token|secret|mfa_secret|csrf|authorization|cookie)$/i;

function redact(value, depth) {
  var d = depth || 0;
  if (d > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(function (v) { return redact(v, d + 1); });
  var out = {};
  Object.keys(value).forEach(function (k) {
    out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(value[k], d + 1);
  });
  return out;
}

function assertAction(action) {
  if (ACTIONS.indexOf(action) < 0) {
    throw new Error('unknown audit action: ' + action);
  }
}

/* exec: anything with .query(sql, params). Pass the transaction client to bind
   the audit row to the change. */
function write(exec, entry) {
  var e = entry || {};
  assertAction(e.action);
  if (OUTCOMES.indexOf(e.outcome) < 0) throw new Error('unknown audit outcome: ' + e.outcome);
  if (!e.actor_label) throw new Error('audit entry requires actor_label');
  if (!e.entity_table) throw new Error('audit entry requires entity_table');

  // tenant_id is nullable by design: a login happens before a tenant is
  // chosen. The RLS insert policy uses IS NOT DISTINCT FROM, so a platform row
  // is only insertable when no tenant is active, and a tenant row only when
  // that tenant is — the database refuses a mislabelled audit entry.
  return exec.query(
    'INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, outcome, detail, ip, tenant_id)' +
    ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      e.actor_id || null,
      String(e.actor_label),
      e.action,
      String(e.entity_table),
      e.entity_id || null,
      e.outcome,
      JSON.stringify(redact(e.detail || {})),
      e.ip || null,
      e.tenant_id || null
    ]
  );
}

module.exports = { ACTIONS: ACTIONS, OUTCOMES: OUTCOMES, write: write, redact: redact, assertAction: assertAction };
