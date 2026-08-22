'use strict';

/* Authorization.
 *
 * One question, asked in one place: does this user hold this permission key.
 * The answer comes from user_effective_permissions, which already filters on
 * is_active and deleted_at — so disabling a user removes their authority
 * immediately, without a session sweep.
 *
 * Stage 1 found an application whose authentication lived in js/auth.js, in
 * the browser. Nothing here may be reachable from the client: the UI hides
 * what a user cannot do, and the server decides what they may.
 */

var audit = require('./audit');

var REQUIRE = {
  // module      → { GET: key, POST: key, PATCH: key, DELETE: key }
  dashboard:  { GET: 'dashboard.read' },
  clients:    { GET: 'clients.read',    POST: 'clients.write',    PATCH: 'clients.write',    DELETE: 'clients.delete' },
  projects:   { GET: 'projects.read',   POST: 'projects.write',   PATCH: 'projects.write',   DELETE: 'projects.delete' },
  planning:   { GET: 'planning.read',   POST: 'planning.write',   PATCH: 'planning.write' },
  production: { GET: 'production.read', POST: 'production.write', PATCH: 'production.write' },
  finance:    { GET: 'finance.read',    POST: 'finance.write',    PATCH: 'finance.write',    DELETE: 'finance.delete' },
  documents:  { GET: 'documents.read',  POST: 'documents.write',  PATCH: 'documents.write',  DELETE: 'documents.delete' },
  reports:    { GET: 'reports.read' },
  inventory:  { GET: 'inventory.read',  POST: 'inventory.write',  PATCH: 'inventory.write' },
  settings:   { GET: 'settings.read',   POST: 'settings.manage',  PATCH: 'settings.manage' },
  users:      { GET: 'users.read',      POST: 'users.manage',     PATCH: 'users.manage' },
  audit:      { GET: 'audit.read' }
};

/* Deny by default: an unknown module or an unmapped verb has no key, and a
   request with no key is refused rather than allowed. Adding a module without
   declaring its permissions fails closed. */
function requiredPermission(moduleName, method) {
  var m = REQUIRE[String(moduleName || '').toLowerCase()];
  if (!m) return null;
  return m[String(method || '').toUpperCase()] || null;
}

function permissionsFor(exec, userId) {
  return exec.query(
    'SELECT permission_key FROM user_effective_permissions WHERE user_id = $1', [userId]
  ).then(function (r) {
    return (r.rows || []).map(function (row) { return row.permission_key; });
  });
}

function has(exec, userId, key) {
  return exec.query(
    'SELECT 1 FROM user_effective_permissions WHERE user_id = $1 AND permission_key = $2 LIMIT 1',
    [userId, key]
  ).then(function (r) { return (r.rows || []).length > 0; });
}

/* Returns { allowed, key, reason }. A refusal is audited: a system that logs
   only what succeeded cannot show an attack in progress. */
function authorize(exec, ctx) {
  var key = requiredPermission(ctx.module, ctx.method);
  if (!key) {
    return recordDenial(exec, ctx, null, 'no_permission_mapping')
      .then(function () { return { allowed: false, key: null, reason: 'no_permission_mapping' }; });
  }
  if (!ctx.user || !ctx.user.id) {
    return recordDenial(exec, ctx, key, 'unauthenticated')
      .then(function () { return { allowed: false, key: key, reason: 'unauthenticated' }; });
  }
  return has(exec, ctx.user.id, key).then(function (ok) {
    if (ok) return { allowed: true, key: key, reason: null };
    return recordDenial(exec, ctx, key, 'missing_permission')
      .then(function () { return { allowed: false, key: key, reason: 'missing_permission' }; });
  });
}

function recordDenial(exec, ctx, key, reason) {
  return audit.write(exec, {
    actor_id: ctx.user ? ctx.user.id : null,
    actor_label: ctx.user ? ctx.user.email : 'anonymous',
    action: 'permission.denied',
    entity_table: String(ctx.module || 'unknown'),
    outcome: 'denied',
    detail: { method: ctx.method, path: ctx.path, required: key, reason: reason },
    ip: ctx.ip || null
  }).catch(function () { /* never let audit failure convert a denial into a pass */ });
}

module.exports = {
  REQUIRE: REQUIRE,
  requiredPermission: requiredPermission,
  permissionsFor: permissionsFor,
  has: has,
  authorize: authorize
};
