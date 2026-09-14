'use strict';

/* Tenant resolution and module enablement.
 *
 * Two questions, both answered server-side on every request:
 *   1. May this user act inside this tenant at all? (membership)
 *   2. Is this module turned on for that tenant?     (tenant_modules)
 *
 * The second is enforced here rather than in the UI. Hiding a nav item is
 * presentation; a 404 from the API is the control. A tenant that has not bought
 * Invoices must not be able to reach /api/v1/invoices by typing it.
 */

var MODULES = [
  'dashboard', 'clients', 'prospects', 'projects', 'planning', 'production', 'finance', 'agenda',
  'invoices', 'accounting', 'documents', 'reports', 'inventory', 'settings', 'users', 'audit'
];

/* Which tenants may this user enter? Platform-level: runs without a tenant
   GUC, so it reads tenant_memberships joined to tenants directly. */
function membershipsFor(exec, userId) {
  // Announce who is asking, so the RLS policy on tenant_memberships can return
  // this user's own rows outside any tenant. Transaction-local: it cannot leak
  // into the next request on a pooled connection.
  return exec.query("SELECT set_config('mythos_erp.user_id', $1, true)", [userId]).then(function () {
  return exec.query(
    'SELECT t.id, t.key, t.display_name, tm.is_default' +
    ' FROM tenant_memberships tm JOIN tenants t ON t.id = tm.tenant_id' +
    " WHERE tm.user_id = $1 AND tm.status = 'active'" +
    "   AND t.status = 'active' AND t.deleted_at IS NULL" +
    ' ORDER BY tm.is_default DESC, t.display_name', [userId]
  ).then(function (r) { return r.rows || []; });
  });
}

/* Deny by default: an unknown tenant, a suspended membership and a
   never-granted tenant are all the same answer. */
function isMember(exec, userId, tenantId) {
  return exec.query("SELECT set_config('mythos_erp.user_id', $1, true)", [userId]).then(function () {
  return exec.query(
    'SELECT 1 FROM tenant_memberships tm JOIN tenants t ON t.id = tm.tenant_id' +
    " WHERE tm.user_id = $1 AND tm.tenant_id = $2 AND tm.status = 'active'" +
    "   AND t.status = 'active' AND t.deleted_at IS NULL LIMIT 1",
    [userId, tenantId]
  ).then(function (r) { return (r.rows || []).length > 0; });
  });
}

/* Runs inside the tenant transaction, so RLS already restricts the row to the
   active tenant. A module with no row is disabled — absence is not permission. */
function isModuleEnabled(exec, moduleKey) {
  if (MODULES.indexOf(moduleKey) < 0) return Promise.resolve(false);
  return exec.query(
    'SELECT enabled FROM tenant_modules WHERE module_key = $1 LIMIT 1', [moduleKey]
  ).then(function (r) {
    var row = (r.rows || [])[0];
    return !!(row && row.enabled);
  });
}

function tenantSettings(exec) {
  return exec.query(
    'SELECT id, key, display_name, legal_name, logo_storage_key, brand_primary,' +
    ' brand_accent, locale, timezone, currency, invoice_prefix, invoice_pattern,' +
    ' tax_identifier, address, settings FROM tenants LIMIT 1'
  ).then(function (r) { return (r.rows || [])[0] || null; });
}

/* Invoice numbering is per tenant and must not collide under concurrency.
   The counter is claimed with UPDATE ... RETURNING inside the caller's
   transaction, so two simultaneous invoices cannot take the same number —
   a SELECT-then-UPDATE here would be a race that only shows up in production. */
function claimInvoiceNumber(exec) {
  return exec.query(
    'UPDATE tenants SET invoice_next_seq = invoice_next_seq + 1' +
    ' RETURNING invoice_prefix, invoice_pattern, invoice_next_seq - 1 AS seq'
  ).then(function (r) {
    var t = (r.rows || [])[0];
    if (!t) throw new Error('no active tenant row to number against');
    return formatInvoiceNumber(t.invoice_pattern, t.invoice_prefix, t.seq, new Date());
  });
}

function formatInvoiceNumber(pattern, prefix, seq, now) {
  return String(pattern || '{prefix}{year}-{seq:4}')
    .replace('{prefix}', prefix || '')
    .replace('{year}', String(now.getUTCFullYear()))
    .replace('{month}', String(now.getUTCMonth() + 1).padStart(2, '0'))
    .replace(/\{seq:(\d+)\}/, function (_, w) { return String(seq).padStart(Number(w), '0'); })
    .replace('{seq}', String(seq));
}

/* Phase 5 — the tenant's fiscal-stamp policy (Tunisian droit de timbre,
   CDET art. 117 n°6: 1,000 dinar per invoice since 1 Jan 2023), read from
   tenants.settings->'fiscal_stamp' = { enabled, amount }. Absent or malformed
   → disabled: enabling it is a decision the tenant makes in Paramètres,
   never a silent change to what an invoice totals. The amount defaults to the
   legal 1,000 when enabled without one. Runs inside the tenant transaction,
   so RLS hands back the one tenant row. */
var STAMP_MAX = 1000; // sanity ceiling: the legal duty is 1,000 (2,000 at most for grandes surfaces)
function fiscalStamp(exec) {
  return exec.query('SELECT settings FROM tenants LIMIT 1').then(function (r) {
    var s = ((r.rows || [])[0] || {}).settings;
    var fs = (s && typeof s === 'object' && s.fiscal_stamp && typeof s.fiscal_stamp === 'object') ? s.fiscal_stamp : {};
    var amount = (fs.amount === null || fs.amount === undefined || fs.amount === '') ? NaN : Number(fs.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > STAMP_MAX) amount = 1;
    return { enabled: fs.enabled === true, amount: Number(amount.toFixed(3)) };
  });
}

module.exports = {
  MODULES: MODULES,
  membershipsFor: membershipsFor,
  isMember: isMember,
  isModuleEnabled: isModuleEnabled,
  tenantSettings: tenantSettings,
  fiscalStamp: fiscalStamp,
  STAMP_MAX: STAMP_MAX,
  claimInvoiceNumber: claimInvoiceNumber,
  formatInvoiceNumber: formatInvoiceNumber
};
