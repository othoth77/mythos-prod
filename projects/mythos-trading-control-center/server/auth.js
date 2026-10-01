'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — authentication and authorization
// projects/mythos-trading-control-center/server/auth.js
//
// Same shape as projects/mythos-os-console/reference/auth.js, extended from one
// shared secret to named users with roles, because this console can change a
// risk limit and "who" has to be a person rather than "somebody with the
// password".
//
//  * CREDENTIALS LIVE IN A FILE THIS PROCESS ONLY READS. The users file holds
//    scrypt hashes, never passwords, and is refused unless it is mode 0600. No
//    credential is read from the environment: /proc/<pid>/environ and every
//    child process see the environment, and none of them may see this.
//  * VERIFICATION COSTS THE SAME WHETHER OR NOT THE USER EXISTS. An unknown
//    user is checked against a dummy record, so response time does not reveal
//    which user names are real.
//  * THE SESSION IS AN httpOnly, SameSite=Strict, Secure COOKIE. JavaScript
//    cannot read it. Every mutation additionally requires the session's CSRF
//    token in a request header — a second, independent check, so a browser bug
//    in one mechanism does not open the write surface.
//  * SESSIONS HAVE AN ABSOLUTE AND AN IDLE LIMIT, and live in memory: a
//    restart signs everyone out, which is the right behaviour for a console
//    that controls a trading agent.
//
// ROLES
//   VIEWER    read everything, change nothing
//   OPERATOR  run backtests and tests, drive an already-approved paper
//             session, and take any action that REDUCES exposure
//   OWNER     everything an operator can, plus configuration changes, raising
//             the execution mode (still subject to the Trading Agent's own
//             owner-approval record) and champion decisions
//
// No role can execute LIVE. That is not a permission this file withholds; the
// capability does not exist anywhere behind it.
// =====================================================

var crypto = require('crypto');
var fs = require('fs');

var SESSION_COOKIE = 'tcc_session';
var SESSION_ID_RE = /^[0-9a-f]{64}$/;
var USER_ID_RE = /^[a-z][a-z0-9._-]{1,31}$/;

var Role = Object.freeze({ VIEWER: 'VIEWER', OPERATOR: 'OPERATOR', OWNER: 'OWNER' });
var ROLE_RANK = Object.freeze({ VIEWER: 1, OPERATOR: 2, OWNER: 3 });

var DEFAULT_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000;
var DEFAULT_IDLE_TTL_MS = 60 * 60 * 1000;
var MAX_SESSIONS = 64;

var LOGIN_WINDOW_MS = 15 * 60 * 1000;
var LOGIN_MAX_FAILURES = 8;
var MAX_TRACKED = 2048;

var SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 64 });
var MIN_PASSWORD_LENGTH = 12;

function hashPassword(password, saltHex) {
  var salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  var hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return { algo: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('hex'), hash: hash.toString('hex') };
}

/** Builds a user record for the users file. Used by bin/tcc-user.js and tests. */
function makeUser(id, role, password) {
  if (!USER_ID_RE.test(String(id))) throw new Error('user id must match ' + USER_ID_RE);
  if (!Role[role]) throw new Error('role must be one of ' + Object.keys(Role).join(', '));
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error('password must be at least ' + MIN_PASSWORD_LENGTH + ' characters');
  }
  var h = hashPassword(password);
  return { id: id, role: role, algo: h.algo, N: h.N, r: h.r, p: h.p, salt: h.salt, hash: h.hash };
}

function validUserRecord(u) {
  return u && typeof u === 'object' && USER_ID_RE.test(String(u.id)) && !!Role[u.role] &&
    u.algo === 'scrypt' && /^[0-9a-f]{32}$/.test(String(u.salt)) && /^[0-9a-f]{128}$/.test(String(u.hash));
}

/**
 * @param {object} [spec]
 * @param {string} [spec.usersFile] path to the 0600 users file
 * @param {object[]} [spec.users] user records supplied directly (tests)
 * @param {function} [spec.now]
 * @param {number} [spec.absoluteTtlMs]
 * @param {number} [spec.idleTtlMs]
 */
function create(spec) {
  var o = spec || {};
  var now = typeof o.now === 'function' ? o.now : function () { return Date.now(); };
  var absoluteTtl = o.absoluteTtlMs || DEFAULT_ABSOLUTE_TTL_MS;
  var idleTtl = o.idleTtlMs || DEFAULT_IDLE_TTL_MS;

  var sessions = Object.create(null);
  var failures = Object.create(null);
  // One dummy record, built once, so verifying an unknown user costs one scrypt.
  var dummy = hashPassword(crypto.randomBytes(24).toString('hex'));

  // --- users -----------------------------------------------------------

  function loadUsers() {
    if (Array.isArray(o.users)) {
      var direct = o.users.filter(validUserRecord);
      return direct.length ? { ok: true, users: direct } : { ok: false, reason: 'no_valid_users' };
    }
    var file = o.usersFile;
    if (!file) return { ok: false, reason: 'unconfigured' };
    var st;
    try { st = fs.statSync(file); } catch (e) { return { ok: false, reason: 'unreadable' }; }
    if (!st.isFile()) return { ok: false, reason: 'unreadable' };
    if ((st.mode & 0o077) !== 0) return { ok: false, reason: 'insecure_mode' };
    var doc;
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e2) { return { ok: false, reason: 'malformed' }; }
    var list = doc && Array.isArray(doc.users) ? doc.users.filter(validUserRecord) : [];
    if (!list.length) return { ok: false, reason: 'no_valid_users' };
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      if (seen[list[i].id]) return { ok: false, reason: 'duplicate_user' };
      seen[list[i].id] = true;
    }
    return { ok: true, users: list };
  }

  function userState() {
    var loaded = loadUsers();
    return {
      provisioned: loaded.ok,
      reason: loaded.ok ? null : loaded.reason,
      users: loaded.ok ? loaded.users.length : 0,
      hasOwner: loaded.ok ? loaded.users.some(function (u) { return u.role === Role.OWNER; }) : false
    };
  }

  /** Returns { ok, user:{id, role} } or { ok:false, reason }. Never returns a hash. */
  function verifyCredentials(id, password) {
    var loaded = loadUsers();
    var candidate = typeof password === 'string' ? password : '';
    var user = null;
    if (loaded.ok && typeof id === 'string') {
      user = loaded.users.filter(function (u) { return u.id === id; })[0] || null;
    }
    var rec = user || dummy;
    var derived;
    try {
      derived = crypto.scryptSync(candidate, Buffer.from(rec.salt, 'hex'), SCRYPT.keylen,
        { N: rec.N || SCRYPT.N, r: rec.r || SCRYPT.r, p: rec.p || SCRYPT.p });
    } catch (e) {
      return { ok: false, reason: 'invalid' };
    }
    var match = crypto.timingSafeEqual(derived, Buffer.from(rec.hash, 'hex'));
    if (!loaded.ok) return { ok: false, reason: loaded.reason };
    if (!user || !match || candidate.length === 0) return { ok: false, reason: 'invalid' };
    return { ok: true, user: { id: user.id, role: user.role } };
  }

  // --- sessions --------------------------------------------------------

  function sweep(t) {
    Object.keys(sessions).forEach(function (id) {
      var s = sessions[id];
      if (s.expiresAt <= t || t - s.lastSeenAt > idleTtl) delete sessions[id];
    });
  }

  function createSession(user, client) {
    var t = now();
    sweep(t);
    var ids = Object.keys(sessions);
    if (ids.length >= MAX_SESSIONS) {
      ids.sort(function (a, b) { return sessions[a].expiresAt - sessions[b].expiresAt; })
        .slice(0, ids.length - MAX_SESSIONS + 1).forEach(function (id) { delete sessions[id]; });
    }
    var id = crypto.randomBytes(32).toString('hex');
    sessions[id] = {
      userId: user.id, role: user.role, client: client || null,
      csrf: crypto.randomBytes(32).toString('hex'),
      createdAt: t, lastSeenAt: t, expiresAt: t + absoluteTtl
    };
    return publicSession(id);
  }

  function publicSession(id) {
    var s = sessions[id];
    if (!s) return null;
    return {
      id: id, userId: s.userId, role: s.role, csrf: s.csrf,
      createdAt: s.createdAt, expiresAt: s.expiresAt,
      idleExpiresAt: s.lastSeenAt + idleTtl
    };
  }

  function parseCookies(header) {
    var out = {};
    String(header || '').split(';').forEach(function (part) {
      var i = part.indexOf('=');
      if (i < 1) return;
      var k = part.slice(0, i).trim();
      if (!k || Object.prototype.hasOwnProperty.call(out, k)) return; // first wins
      out[k] = part.slice(i + 1).trim();
    });
    return out;
  }

  function sessionIdFrom(req) {
    var raw = parseCookies(req && req.headers && req.headers.cookie)[SESSION_COOKIE];
    return raw && SESSION_ID_RE.test(raw) ? raw : null;
  }

  function hasSessionCookie(req) {
    return parseCookies(req && req.headers && req.headers.cookie)[SESSION_COOKIE] !== undefined;
  }

  /** Resolves a request to a live session and refreshes its idle clock. */
  function sessionFor(req) {
    var id = sessionIdFrom(req);
    if (!id) return null;
    var s = sessions[id];
    if (!s) return null;
    var t = now();
    if (s.expiresAt <= t || t - s.lastSeenAt > idleTtl) { delete sessions[id]; return null; }
    // The role is re-read from the users file on every request: a user removed
    // or demoted there loses the old authority immediately, not at next login.
    var loaded = loadUsers();
    var user = loaded.ok ? loaded.users.filter(function (u) { return u.id === s.userId; })[0] : null;
    if (!user) { delete sessions[id]; return null; }
    s.role = user.role;
    s.lastSeenAt = t;
    return publicSession(id);
  }

  function destroySession(id) {
    if (id && Object.prototype.hasOwnProperty.call(sessions, id)) { delete sessions[id]; return true; }
    return false;
  }

  function destroyUserSessions(userId) {
    var n = 0;
    Object.keys(sessions).forEach(function (id) {
      if (sessions[id].userId === userId) { delete sessions[id]; n++; }
    });
    return n;
  }

  /** Constant-time CSRF comparison. */
  function csrfMatches(session, presented) {
    if (!session || typeof presented !== 'string' || presented.length !== session.csrf.length) return false;
    return crypto.timingSafeEqual(Buffer.from(presented, 'utf8'), Buffer.from(session.csrf, 'utf8'));
  }

  function sessionCookie(id) {
    return SESSION_COOKIE + '=' + id + '; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=' +
      Math.floor(absoluteTtl / 1000);
  }

  function clearedCookie() {
    return SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0';
  }

  // --- login throttle --------------------------------------------------
  // Two keys: the client address and the user name. The address throttle stops
  // one client guessing many names; the name throttle stops many clients
  // guessing one.

  function throttleKeys(client, userId) {
    var keys = ['c:' + (client || 'unknown')];
    if (typeof userId === 'string' && userId.length && userId.length <= 64) keys.push('u:' + userId.toLowerCase());
    return keys;
  }

  function loginAllowed(client, userId) {
    var t = now();
    return throttleKeys(client, userId).every(function (k) {
      var rec = failures[k];
      if (!rec) return true;
      if (t - rec.first > LOGIN_WINDOW_MS) return true;
      return rec.count < LOGIN_MAX_FAILURES;
    });
  }

  function recordLoginFailure(client, userId) {
    var t = now();
    var keys = Object.keys(failures);
    if (keys.length >= MAX_TRACKED) {
      keys.forEach(function (k) { if (t - failures[k].first > LOGIN_WINDOW_MS) delete failures[k]; });
      if (Object.keys(failures).length >= MAX_TRACKED) failures = Object.create(null);
    }
    throttleKeys(client, userId).forEach(function (k) {
      var rec = failures[k];
      if (!rec || t - rec.first > LOGIN_WINDOW_MS) failures[k] = { count: 1, first: t };
      else rec.count++;
    });
  }

  function clearLoginFailures(client, userId) {
    throttleKeys(client, userId).forEach(function (k) { delete failures[k]; });
  }

  return {
    Role: Role,
    userState: userState,
    verifyCredentials: verifyCredentials,
    createSession: createSession,
    sessionFor: sessionFor,
    sessionIdFrom: sessionIdFrom,
    hasSessionCookie: hasSessionCookie,
    destroySession: destroySession,
    destroyUserSessions: destroyUserSessions,
    csrfMatches: csrfMatches,
    sessionCookie: sessionCookie,
    clearedCookie: clearedCookie,
    loginAllowed: loginAllowed,
    recordLoginFailure: recordLoginFailure,
    clearLoginFailures: clearLoginFailures,
    sessionCount: function () { sweep(now()); return Object.keys(sessions).length; },
    limits: function () { return { absoluteTtlMs: absoluteTtl, idleTtlMs: idleTtl, maxSessions: MAX_SESSIONS }; }
  };
}

/** True when `role` is at least `required`. */
function roleAtLeast(role, required) {
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[required] || 99);
}

module.exports = {
  create: create,
  makeUser: makeUser,
  hashPassword: hashPassword,
  roleAtLeast: roleAtLeast,
  Role: Role,
  ROLE_RANK: ROLE_RANK,
  SESSION_COOKIE: SESSION_COOKIE,
  USER_ID_RE: USER_ID_RE,
  MIN_PASSWORD_LENGTH: MIN_PASSWORD_LENGTH,
  LOGIN_MAX_FAILURES: LOGIN_MAX_FAILURES
};
