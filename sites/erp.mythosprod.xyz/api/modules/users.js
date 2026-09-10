'use strict';

/* User creation — the one P0 gap the functional audit found: the ERP has a
 * real role/permission/RLS model but no way to provision a second login.
 *
 * Reuses, unmodified:
 *   - lib/auth.js's requestPasswordReset/completePasswordReset (already
 *     built and tested; never wired to a route before this) for the actual
 *     credential — this module NEVER sets or sees a password.
 *   - the existing users.manage permission gate (route module: 'users'),
 *     already mapped in lib/authz.js — no authorization change needed.
 *   - the existing 'user.created' audit action, already in lib/audit.js's
 *     taxonomy but never emitted before this.
 *
 * Design:
 *   - The new row is created with password_hash = NULL. auth.login() already
 *     handles that (treated as bad_password, same generic error, no oracle).
 *   - Immediately after, this handler calls requestPasswordReset() itself, in
 *     the SAME transaction the pipeline opened, and returns the plaintext
 *     setup token to the calling admin — exactly the "invite a teammate"
 *     handoff, not a secret at rest (only its hash is ever stored, by the
 *     existing library code, in password_reset_tokens). The admin relays it
 *     out of band; the new user consumes it via
 *     POST /auth/password/reset-complete (also new, pure passthrough).
 *   - Role rank cap: users.manage is held by admin and super_admin. Without a
 *     further check, an admin could create a user and hand them a
 *     super_admin role — a privilege-escalation-by-proxy path. A caller may
 *     never grant a role ranked above the highest role they themselves hold
 *     in this tenant.
 */

var auth = require('../lib/auth');
var audit = require('../lib/audit');

// Lowest to highest. Index is used as the rank for the escalation check.
var ROLE_KEYS = ['read_only', 'production_user', 'finance_user', 'manager', 'admin', 'super_admin'];

var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function callerMaxRank(client, userId, tenantId) {
  return client.query(
    'SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id' +
    ' WHERE ur.user_id = $1 AND ur.tenant_id = $2', [userId, tenantId]
  ).then(function (r) {
    var rank = -1;
    (r.rows || []).forEach(function (row) {
      var idx = ROLE_KEYS.indexOf(row.key);
      if (idx > rank) rank = idx;
    });
    return rank;
  });
}

function create(ctx, client) {
  var b = ctx.body || {};
  var email = String(b.email || '').trim().toLowerCase();
  var displayName = String(b.display_name || '').trim();
  var roleKey = String(b.role_key || '').trim();

  if (!EMAIL_RE.test(email)) return Promise.resolve({ status: 422, body: { error: 'validation_failed', detail: 'email is not a valid address' } });
  if (!displayName) return Promise.resolve({ status: 422, body: { error: 'validation_failed', detail: 'display_name is required' } });
  var targetRank = ROLE_KEYS.indexOf(roleKey);
  if (targetRank === -1) return Promise.resolve({ status: 422, body: { error: 'validation_failed', detail: 'role_key must be one of ' + ROLE_KEYS.join('|') } });

  return callerMaxRank(client, ctx.user.id, ctx.tenantId).then(function (myRank) {
    if (targetRank > myRank) {
      return audit.write(client, {
        actor_id: ctx.user.id, actor_label: ctx.user.email, action: 'permission.denied',
        entity_table: 'users', entity_id: null, outcome: 'denied',
        detail: { reason: 'role_exceeds_own_rank', requested: roleKey }, ip: ctx.ip, tenant_id: ctx.tenantId
      }).then(function () {
        return { status: 403, body: { error: 'forbidden', required: 'cannot grant a role above your own' } };
      });
    }

    return client.query('SELECT id FROM roles WHERE key = $1', [roleKey]).then(function (rr) {
      var role = (rr.rows || [])[0];
      if (!role) return { status: 422, body: { error: 'validation_failed', detail: 'unknown role' } };

      return client.query('SELECT id, deleted_at FROM users WHERE email = $1', [email]).then(function (ur) {
        var existing = (ur.rows || [])[0];
        if (existing && !existing.deleted_at) {
          return client.query(
            'SELECT 1 FROM tenant_memberships WHERE user_id = $1 AND tenant_id = $2', [existing.id, ctx.tenantId]
          ).then(function (mr) {
            if ((mr.rows || []).length) return { status: 409, body: { error: 'already_member' } };
            // A real person who already has a login elsewhere: add them to
            // this tenant rather than fail closed on the unique email
            // constraint or silently create a second identity.
            return addMembership(client, existing.id, ctx.tenantId, role.id, ctx.ip, { email: email, displayName: displayName, roleKey: roleKey, isNewUser: false });
          });
        }
        return client.query(
          'INSERT INTO users (email, display_name, is_active) VALUES ($1,$2,true) RETURNING id',
          [email, displayName]
        ).then(function (nr) {
          var newId = nr.rows[0].id;
          return addMembership(client, newId, ctx.tenantId, role.id, ctx.ip, { email: email, displayName: displayName, roleKey: roleKey, isNewUser: true });
        });
      });
    });
  });
}

function addMembership(client, userId, tenantId, roleId, ip, info) {
  return client.query(
    'INSERT INTO tenant_memberships (user_id, tenant_id, status, is_default) VALUES ($1,$2,\'active\',false)' +
    ' ON CONFLICT DO NOTHING', [userId, tenantId]
  ).then(function () {
    return client.query(
      'INSERT INTO user_roles (user_id, tenant_id, role_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [userId, tenantId, roleId]
    );
  }).then(function () {
    return auth.requestPasswordReset({ db: client, tenantId: tenantId }, info.email, ip);
  }).then(function (reset) {
    return {
      status: 201,
      body: {
        user_id: userId,
        email: info.email,
        display_name: info.displayName,
        role_key: info.roleKey,
        setup_token: reset && reset.token ? reset.token : null,
        note: 'Give this setup token to the new user out of band; it is shown once and never stored in plain form.'
      },
      audit: {
        action: 'user.created', entity_table: 'users', entity_id: userId,
        detail: { email: info.email, role: info.roleKey, new_account: info.isNewUser }
      }
    };
  });
}

module.exports = { ROLE_KEYS: ROLE_KEYS, handlers: { create: create } };
