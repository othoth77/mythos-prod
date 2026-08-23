'use strict';

/* Authentication: login, sessions, lockout, password reset.
 *
 * Every branch that can distinguish "no such user" from "wrong password" is
 * deliberately flattened. Stage 1's login page would otherwise be a directory
 * of who works here.
 */

var password = require('./password');
var tokens = require('./tokens');
var audit = require('./audit');
var tenancy = require('./tenancy');

var POLICY = {
  idleSeconds: 8 * 3600,
  absoluteSeconds: 12 * 3600,
  accountFailureThreshold: 5,
  accountLockSeconds: 15 * 60,
  accountLockMaxSeconds: 3600,
  ipFailureThreshold: 20,
  ipWindowSeconds: 15 * 60,
  minResponseMs: 200,
  resetTokenSeconds: 30 * 60,
  minPasswordLength: 12
};

function now(clock) { return clock ? clock() : new Date(); }

/* A fixed floor on the login path. Without it, "unknown user" returns before
   the KDF runs and "wrong password" returns after — a ~100 ms timing oracle
   that enumerates accounts regardless of what the response body says. */
function withFloor(startedAt, value, deps) {
  var sleep = (deps && deps.sleep) || function (ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  };
  var elapsed = ((deps && deps.nowMs) ? deps.nowMs() : Date.now()) - startedAt;
  var wait = POLICY.minResponseMs - elapsed;
  return wait > 0 ? sleep(wait).then(function () { return value; }) : Promise.resolve(value);
}

function recordAttempt(exec, o) {
  return exec.query(
    'INSERT INTO login_attempts (email_tried, user_id, ip, user_agent, outcome) VALUES ($1,$2,$3,$4,$5)',
    [o.email, o.userId || null, o.ip || null, o.userAgent || null, o.outcome]
  ).catch(function () { /* an attempt-log failure must not become a login */ });
}

function ipThrottled(exec, ip) {
  if (!ip) return Promise.resolve(false);
  return exec.query(
    "SELECT count(*)::int AS n FROM login_attempts" +
    " WHERE ip = $1 AND outcome <> 'success' AND attempted_at > now() - ($2 || ' seconds')::interval",
    [ip, String(POLICY.ipWindowSeconds)]
  ).then(function (r) {
    return ((r.rows && r.rows[0] && r.rows[0].n) || 0) >= POLICY.ipFailureThreshold;
  });
}

/* Exponential, capped, and always time-bounded. A permanent lock reachable by
   anyone who knows an email address is a denial-of-service tool. */
function lockSeconds(failedAttempts) {
  var over = Math.max(0, failedAttempts - POLICY.accountFailureThreshold);
  var secs = POLICY.accountLockSeconds * Math.pow(2, over);
  return Math.min(secs, POLICY.accountLockMaxSeconds);
}

function login(deps, input) {
  var db = deps.db;
  var startedAt = (deps.nowMs ? deps.nowMs() : Date.now());
  var email = String(input.email || '').trim().toLowerCase();
  var supplied = String(input.password || '');
  var generic = { ok: false, error: 'invalid_credentials' };

  return ipThrottled(db, input.ip).then(function (throttled) {
    if (throttled) {
      return recordAttempt(db, { email: email, ip: input.ip, userAgent: input.userAgent, outcome: 'rate_limited' })
        .then(function () { return withFloor(startedAt, { ok: false, error: 'rate_limited' }, deps); });
    }

    return db.query(
      'SELECT id, email, display_name, password_hash, password_algo, is_active,' +
      ' failed_attempts, locked_until FROM users WHERE email = $1 AND deleted_at IS NULL', [email]
    ).then(function (r) {
      var user = (r.rows || [])[0];

      if (!user) {
        // Still burn comparable time: returning early here is the oracle.
        return password.verify(supplied, '$scrypt$N=16384,r=8,p=1$AAAA$AAAA')
          .then(function () {
            return recordAttempt(db, { email: email, ip: input.ip, userAgent: input.userAgent, outcome: 'unknown_user' });
          })
          .then(function () { return withFloor(startedAt, generic, deps); });
      }

      var t = now(deps.clock);
      if (user.locked_until && new Date(user.locked_until) > t) {
        return recordAttempt(db, { email: email, userId: user.id, ip: input.ip, userAgent: input.userAgent, outcome: 'locked' })
          .then(function () { return withFloor(startedAt, { ok: false, error: 'locked' }, deps); });
      }
      if (!user.is_active) {
        return recordAttempt(db, { email: email, userId: user.id, ip: input.ip, userAgent: input.userAgent, outcome: 'inactive' })
          .then(function () { return withFloor(startedAt, generic, deps); });
      }
      if (!user.password_hash) {
        return recordAttempt(db, { email: email, userId: user.id, ip: input.ip, userAgent: input.userAgent, outcome: 'bad_password' })
          .then(function () { return withFloor(startedAt, generic, deps); });
      }

      return password.verify(supplied, user.password_hash).then(function (ok) {
        if (!ok) {
          var failed = (user.failed_attempts || 0) + 1;
          var lockUntil = failed >= POLICY.accountFailureThreshold
            ? new Date(t.getTime() + lockSeconds(failed) * 1000) : null;
          return db.query(
            'UPDATE users SET failed_attempts = $2, locked_until = $3 WHERE id = $1',
            [user.id, failed, lockUntil]
          )
            .then(function () { return recordAttempt(db, { email: email, userId: user.id, ip: input.ip, userAgent: input.userAgent, outcome: 'bad_password' }); })
            .then(function () {
              return audit.write(db, {
                actor_id: user.id, actor_label: email, action: 'login.failure',
                entity_table: 'users', entity_id: user.id, outcome: 'denied',
                detail: { failed_attempts: failed, locked: !!lockUntil }, ip: input.ip
              });
            })
            .then(function () { return withFloor(startedAt, generic, deps); });
        }

        return db.query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id])
          .then(function () { return tenancy.membershipsFor(db, user.id); })
          .then(function (memberships) {
            // A user with no active membership authenticates but enters
            // nothing: every tenant-scoped route will refuse. That is the
            // correct state for a deactivated collaborator, not an error.
            var preferred = memberships.filter(function (m) { return m.is_default; })[0] || memberships[0];
            return issueSession(deps, user, input, preferred && preferred.id)
              .then(function (session) { session.memberships = memberships; return session; });
          })
          .then(function (session) {
            return recordAttempt(db, { email: email, userId: user.id, ip: input.ip, userAgent: input.userAgent, outcome: 'success' })
              .then(function () {
                return audit.write(db, {
                  actor_id: user.id, actor_label: email, action: 'login.success',
                  entity_table: 'users', entity_id: user.id, outcome: 'ok',
                  detail: { session_id: session.sessionId }, ip: input.ip
                });
              })
              .then(function () {
                return withFloor(startedAt, {
                  ok: true,
                  user: { id: user.id, email: user.email, display_name: user.display_name },
                  tenants: (session.memberships || []).map(function (m) {
                    return { id: m.id, key: m.key, display_name: m.display_name };
                  }),
                  active_tenant_id: (session.memberships || []).filter(function (m) { return m.is_default; })[0]
                    ? (session.memberships || []).filter(function (m) { return m.is_default; })[0].id
                    : ((session.memberships || [])[0] || {}).id || null,
                  token: session.token, csrf: session.csrf,
                  cookie: tokens.cookieHeader(session.token, POLICY.idleSeconds),
                  needs_rehash: password.needsRehash(user.password_hash)
                }, deps);
              });
          });
      });
    });
  });
}

function issueSession(deps, user, input, activeTenantId) {
  var db = deps.db;
  var token = (deps.makeToken || tokens.generate)();
  var csrf = (deps.makeToken || tokens.generate)();
  var t = now(deps.clock);
  var idle = new Date(t.getTime() + POLICY.idleSeconds * 1000);
  var abs = new Date(t.getTime() + POLICY.absoluteSeconds * 1000);
  return db.query(
    'INSERT INTO sessions (user_id, token_hash, csrf_hash, idle_expires_at, absolute_expires_at, ip, user_agent, active_tenant_id)' +
    ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [user.id, tokens.hashToken(token), tokens.hashToken(csrf), idle, abs,
     input.ip || null, input.userAgent || null, activeTenantId || null]
  ).then(function (r) {
    return { token: token, csrf: csrf, sessionId: (r.rows && r.rows[0] && r.rows[0].id) || null };
  });
}

/* Change the tenant a live session acts inside. Membership is re-checked here
   rather than trusted from login: a membership can be revoked while a session
   is open, and the session must not outlive the grant. */
function switchTenant(deps, session, tenantId) {
  var db = deps.db;
  if (!session) return Promise.resolve({ ok: false, error: 'unauthenticated' });
  return tenancy.isMember(db, session.user.id, tenantId).then(function (member) {
    if (!member) {
      return audit.write(db, {
        actor_id: session.user.id, actor_label: session.user.email,
        action: 'permission.denied', entity_table: 'tenants', entity_id: tenantId,
        outcome: 'denied', detail: { reason: 'not_a_member' }
      }).then(function () { return { ok: false, error: 'forbidden' }; });
    }
    return db.query('UPDATE sessions SET active_tenant_id = $2 WHERE id = $1',
      [session.sessionId, tenantId])
      .then(function () {
        return audit.write(db, {
          actor_id: session.user.id, actor_label: session.user.email,
          action: 'tenant.switched', entity_table: 'tenants', entity_id: tenantId,
          outcome: 'ok', detail: {}
        });
      })
      .then(function () { return { ok: true, tenant_id: tenantId }; });
  });
}

/* Validate on every request. Slides the idle window; never extends absolute. */
function validateSession(deps, token) {
  var db = deps.db;
  if (!token) return Promise.resolve(null);
  var t = now(deps.clock);
  return db.query(
    'SELECT s.id, s.user_id, s.csrf_hash, s.idle_expires_at, s.absolute_expires_at, s.revoked_at,' +
    ' s.active_tenant_id, u.email, u.display_name, u.is_active' +
    ' FROM sessions s JOIN users u ON u.id = s.user_id' +
    ' WHERE s.token_hash = $1', [tokens.hashToken(token)]
  ).then(function (r) {
    var s = (r.rows || [])[0];
    if (!s) return null;
    if (s.revoked_at) return null;
    if (!s.is_active) return null;
    if (new Date(s.idle_expires_at) <= t) return null;
    if (new Date(s.absolute_expires_at) <= t) return null;
    var idle = new Date(t.getTime() + POLICY.idleSeconds * 1000);
    var capped = new Date(Math.min(idle.getTime(), new Date(s.absolute_expires_at).getTime()));
    return db.query('UPDATE sessions SET last_seen_at = now(), idle_expires_at = $2 WHERE id = $1', [s.id, capped])
      .then(function () {
        return {
          sessionId: s.id, csrf_hash: s.csrf_hash,
          activeTenantId: s.active_tenant_id || null,
          user: { id: s.user_id, email: s.email, display_name: s.display_name }
        };
      });
  });
}

function revokeSession(deps, sessionId, reason, actor) {
  var db = deps.db;
  return db.query(
    'UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL',
    [sessionId, reason || 'logout']
  ).then(function () {
    return audit.write(db, {
      actor_id: actor ? actor.id : null, actor_label: actor ? actor.email : 'system',
      action: reason === 'logout' ? 'logout' : 'session.revoked',
      entity_table: 'sessions', entity_id: sessionId, outcome: 'ok', detail: { reason: reason || 'logout' }
    });
  });
}

function revokeAllForUser(deps, userId, reason) {
  return deps.db.query(
    'UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL',
    [userId, reason || 'password_change']
  );
}

/* CSRF: the cookie is not enough on its own. SameSite=Lax still permits
   top-level POSTs from another origin in some browsers, so a token bound to
   the session is required for every unsafe verb. */
function checkCsrf(session, presented) {
  if (!session) return false;
  if (!presented) return false;
  return tokens.safeEqual(session.csrf_hash, tokens.hashToken(presented));
}

function validatePasswordStrength(pw) {
  var s = String(pw || '');
  if (s.length < POLICY.minPasswordLength) {
    return { ok: false, error: 'password must be at least ' + POLICY.minPasswordLength + ' characters' };
  }
  return { ok: true };
}

/* Reset request. The response is identical whether or not the address exists;
   the caller must not branch on the return value either. */
function requestPasswordReset(deps, email, ip) {
  var db = deps.db;
  var addr = String(email || '').trim().toLowerCase();
  return db.query('SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL AND is_active', [addr])
    .then(function (r) {
      var user = (r.rows || [])[0];
      if (!user) return { ok: true, dispatched: false };
      var token = (deps.makeToken || tokens.generate)();
      var expires = new Date(now(deps.clock).getTime() + POLICY.resetTokenSeconds * 1000);
      return db.query(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, issued_ip) VALUES ($1,$2,$3,$4)',
        [user.id, tokens.hashToken(token), expires, ip || null]
      ).then(function () {
        return audit.write(db, {
          actor_id: user.id, actor_label: addr, action: 'password.reset_requested',
          entity_table: 'users', entity_id: user.id, outcome: 'ok', detail: {}, ip: ip || null
        });
      }).then(function () { return { ok: true, dispatched: true, token: token }; });
    });
}

function completePasswordReset(deps, token, newPassword, ip) {
  var db = deps.db;
  var strength = validatePasswordStrength(newPassword);
  if (!strength.ok) return Promise.resolve({ ok: false, error: strength.error });
  var t = now(deps.clock);
  return db.query(
    'SELECT id, user_id, expires_at, consumed_at FROM password_reset_tokens WHERE token_hash = $1',
    [tokens.hashToken(token)]
  ).then(function (r) {
    var row = (r.rows || [])[0];
    if (!row) return { ok: false, error: 'invalid_token' };
    if (row.consumed_at) return { ok: false, error: 'invalid_token' };
    if (new Date(row.expires_at) <= t) return { ok: false, error: 'invalid_token' };
    return password.hash(newPassword).then(function (h) {
      return db.query(
        'UPDATE users SET password_hash = $2, password_algo = $3, password_changed_at = now(),' +
        ' must_change_password = false, failed_attempts = 0, locked_until = NULL WHERE id = $1',
        [row.user_id, h, password.ALGO]
      );
    })
      .then(function () { return db.query('UPDATE password_reset_tokens SET consumed_at = now() WHERE id = $1', [row.id]); })
      // Anyone holding a session from before the reset must lose it: a reset
      // that leaves an attacker's session alive has not recovered the account.
      .then(function () { return revokeAllForUser(deps, row.user_id, 'password_change'); })
      .then(function () {
        return audit.write(db, {
          actor_id: row.user_id, actor_label: 'user:' + row.user_id, action: 'password.reset_completed',
          entity_table: 'users', entity_id: row.user_id, outcome: 'ok', detail: {}, ip: ip || null
        });
      })
      .then(function () { return { ok: true }; });
  });
}

module.exports = {
  POLICY: POLICY,
  login: login,
  issueSession: issueSession,
  switchTenant: switchTenant,
  validateSession: validateSession,
  revokeSession: revokeSession,
  revokeAllForUser: revokeAllForUser,
  checkCsrf: checkCsrf,
  lockSeconds: lockSeconds,
  validatePasswordStrength: validatePasswordStrength,
  requestPasswordReset: requestPasswordReset,
  completePasswordReset: completePasswordReset
};
