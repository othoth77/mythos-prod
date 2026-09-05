'use strict';
// =====================================================
// MYTHOS WP — authentication, sessions, authorisation, CSRF
// projects/mythos-wp/reference/auth.js
//
// Derived from projects/mythos-os-console/reference/auth.js (MOS-v2 M-01),
// the repository's one server-side session boundary, and extended where a
// data-management panel needs more than a single shared password:
//
//   · USERS FILE, NOT AN ENV VALUE. MYTHOS_WP_USERS_FILE names a 0600 JSON
//     file: { "users": [ { "username", "role", "scrypt" } ] }. `scrypt` is
//     "N,r,p$salt_hex$hash_hex" produced by bin/mythos-wp set-password.
//     No plaintext password anywhere; no default credential; a file with a
//     group/other permission bit is REFUSED (same rule as the console).
//   · ROLES. `owner` (everything: delete, settings, projects, auto-reply
//     configuration) and `operator` (read + create/update business data,
//     handoff work; no delete, no settings). Enforced server-side per route
//     by requireRole(); the UI only hides what the server already refuses.
//   · CONSTANT-TIME VERIFY. scrypt with the stored parameters, compared with
//     timingSafeEqual. An unknown username still runs one scrypt against a
//     fixed decoy so "user exists" is not a timing oracle.
//   · SESSIONS in memory, absolute TTL (8 h), httpOnly + SameSite=Strict +
//     Secure cookie, ceiling on the store. A restart signs everyone out,
//     which is the right behaviour for an administration panel.
//   · CSRF. SameSite=Strict already keeps the cookie off cross-site requests.
//     Defence in depth for every state-changing request: the client must
//     send `X-Requested-With: MythosWP` (a custom header a cross-site form
//     cannot set) and, when the browser sends Origin / Sec-Fetch-Site, they
//     must be same-origin. Login itself is exempt from the header only.
//   · LOGIN THROTTLE by socket address (nginx → 127.0.0.1, so global in
//     practice; conservative for a panel with a handful of accounts).
// =====================================================

var crypto = require('crypto');
var fs = require('fs');

var SESSION_COOKIE = 'mythos_wp_session';
var SESSION_ID_RE = /^[0-9a-f]{64}$/;
var USERNAME_RE = /^[a-z][a-z0-9._-]{1,31}$/;
var ROLES = ['owner', 'operator'];
var ROLE_RANK = { operator: 1, owner: 2 };
var CSRF_HEADER = 'x-requested-with';
var CSRF_VALUE = 'MythosWP';

var DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
var MAX_SESSIONS = 256;
var LOGIN_WINDOW_MS = 15 * 60 * 1000;
var LOGIN_MAX_FAILURES = 10;
var MAX_TRACKED_CLIENTS = 1024;
var SCRYPT_DEFAULT = { N: 16384, r: 8, p: 1, keylen: 32 };

var sessions = Object.create(null); // id -> { username, role, expiresAt, createdAt }
var failures = Object.create(null); // client -> { count, first }

// A decoy hash so an unknown user costs the same as a wrong password.
var DECOY = hashPassword('decoy-password-never-valid', SCRYPT_DEFAULT);

function ttlMs() {
  var n = parseInt(process.env.MYTHOS_WP_SESSION_TTL_MS || '', 10);
  return (isNaN(n) || n < 1000) ? DEFAULT_TTL_MS : n;
}

// --- password hashing --------------------------------------------------

function hashPassword(password, params) {
  params = params || SCRYPT_DEFAULT;
  var salt = crypto.randomBytes(16);
  var key = crypto.scryptSync(String(password), salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024 });
  return params.N + ',' + params.r + ',' + params.p + '$' + salt.toString('hex') + '$' + key.toString('hex');
}

function parseHash(stored) {
  var m = /^(\d+),(\d+),(\d+)\$([0-9a-f]{16,64})\$([0-9a-f]{32,128})$/.exec(String(stored || ''));
  if (!m) return null;
  return { N: parseInt(m[1], 10), r: parseInt(m[2], 10), p: parseInt(m[3], 10), salt: Buffer.from(m[4], 'hex'), hash: Buffer.from(m[5], 'hex') };
}

function verifyHash(password, stored) {
  var h = parseHash(stored);
  if (!h) return false;
  var key;
  try {
    key = crypto.scryptSync(String(password), h.salt, h.hash.length, { N: h.N, r: h.r, p: h.p, maxmem: 64 * 1024 * 1024 });
  } catch (e) { return false; }
  return key.length === h.hash.length && crypto.timingSafeEqual(key, h.hash);
}

// --- users file ----------------------------------------------------------

// Returns { ok, users, reason }. Reasons are names for the operator (health),
// never shown to an unauthenticated caller.
function loadUsers() {
  var file = process.env.MYTHOS_WP_USERS_FILE;
  if (!file) return { ok: false, reason: 'unconfigured', users: [] };
  var st;
  try { st = fs.statSync(file); } catch (e) { return { ok: false, reason: 'unreadable', users: [] }; }
  if (!st.isFile()) return { ok: false, reason: 'unreadable', users: [] };
  if ((st.mode & 0o077) !== 0) return { ok: false, reason: 'insecure_mode', users: [] };
  var parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { ok: false, reason: 'invalid', users: [] }; }
  var list = parsed && Array.isArray(parsed.users) ? parsed.users : null;
  if (!list) return { ok: false, reason: 'invalid', users: [] };
  var users = list.filter(function (u) {
    return u && USERNAME_RE.test(String(u.username || '')) && ROLES.indexOf(u.role) !== -1 && parseHash(u.scrypt);
  }).map(function (u) { return { username: u.username, role: u.role, scrypt: u.scrypt }; });
  if (!users.length) return { ok: false, reason: 'no_users', users: [] };
  return { ok: true, reason: null, users: users };
}

function usersState() {
  var l = loadUsers();
  return { provisioned: l.ok, reason: l.reason, count: l.users.length };
}

// verifyCredentials(username, password) → { ok, user: { username, role } } | { ok: false, reason }
function verifyCredentials(username, password) {
  var loaded = loadUsers();
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  if (typeof username !== 'string' || typeof password !== 'string' || !password) return { ok: false, reason: 'invalid' };
  var uname = username.trim().toLowerCase();
  var user = null;
  for (var i = 0; i < loaded.users.length; i++) if (loaded.users[i].username === uname) user = loaded.users[i];
  var good = verifyHash(password, user ? user.scrypt : DECOY);
  if (!user || !good) return { ok: false, reason: 'invalid' };
  return { ok: true, user: { username: user.username, role: user.role } };
}

// --- sessions ------------------------------------------------------------

function sweep(now) {
  Object.keys(sessions).forEach(function (id) { if (sessions[id].expiresAt <= now) delete sessions[id]; });
}

function createSession(user) {
  var now = Date.now();
  sweep(now);
  var ids = Object.keys(sessions);
  if (ids.length >= MAX_SESSIONS) {
    ids.sort(function (x, y) { return sessions[x].expiresAt - sessions[y].expiresAt; })
      .slice(0, ids.length - MAX_SESSIONS + 1)
      .forEach(function (id) { delete sessions[id]; });
  }
  var id = crypto.randomBytes(32).toString('hex');
  var expiresAt = now + ttlMs();
  sessions[id] = { username: user.username, role: user.role, expiresAt: expiresAt, createdAt: now };
  return { id: id, expiresAt: expiresAt };
}

function sessionFor(req) {
  var id = sessionIdFrom(req);
  if (!id) return null;
  var e = sessions[id];
  if (!e) return null;
  if (e.expiresAt <= Date.now()) { delete sessions[id]; return null; }
  return { id: id, username: e.username, role: e.role, expiresAt: e.expiresAt };
}

function destroySession(id) {
  if (id && Object.prototype.hasOwnProperty.call(sessions, id)) { delete sessions[id]; return true; }
  return false;
}

function parseCookies(header) {
  var out = {};
  String(header || '').split(';').forEach(function (part) {
    var i = part.indexOf('=');
    if (i < 1) return;
    var k = part.slice(0, i).trim();
    if (!k || Object.prototype.hasOwnProperty.call(out, k)) return;
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

// Secure is dropped only when MYTHOS_WP_INSECURE_COOKIE=1 (tests over plain
// loopback HTTP). Production runs behind the TLS vhost and never sets it.
function cookieFlags() {
  return '; Path=/; HttpOnly; SameSite=Strict' + (process.env.MYTHOS_WP_INSECURE_COOKIE === '1' ? '' : '; Secure');
}
function sessionCookie(id, maxAgeMs) {
  return SESSION_COOKIE + '=' + id + cookieFlags() + '; Max-Age=' + Math.floor((maxAgeMs === undefined ? ttlMs() : maxAgeMs) / 1000);
}
function clearedCookie() { return SESSION_COOKIE + '=' + cookieFlags() + '; Max-Age=0'; }

// --- authorisation -----------------------------------------------------

// hasRole(session, 'operator') is true for operator AND owner.
function hasRole(session, required) {
  if (!session || !ROLE_RANK[session.role]) return false;
  if (!required || required === 'any') return true;
  return (ROLE_RANK[session.role] || 0) >= (ROLE_RANK[required] || 99);
}

// --- CSRF ----------------------------------------------------------------

// csrfCheck(req) → null when acceptable, else a reason name.
function csrfCheck(req) {
  var h = req.headers || {};
  if (String(h[CSRF_HEADER] || '') !== CSRF_VALUE) return 'csrf_header_missing';
  var host = String(h.host || '');
  if (h.origin) {
    var origin;
    try { origin = new URL(String(h.origin)); } catch (e) { return 'csrf_origin_invalid'; }
    if (!host || origin.host !== host) return 'csrf_origin_mismatch';
  }
  var sfs = h['sec-fetch-site'];
  if (sfs && sfs !== 'same-origin' && sfs !== 'none') return 'csrf_cross_site';
  return null;
}

// --- login throttle ------------------------------------------------------

function clientKey(req) { return (req && req.socket && req.socket.remoteAddress) || 'unknown'; }

function loginAllowed(req) {
  var rec = failures[clientKey(req)];
  if (!rec) return true;
  if (Date.now() - rec.first > LOGIN_WINDOW_MS) return true;
  return rec.count < LOGIN_MAX_FAILURES;
}

function recordLoginFailure(req) {
  var key = clientKey(req);
  var now = Date.now();
  var keys = Object.keys(failures);
  if (keys.length >= MAX_TRACKED_CLIENTS && !failures[key]) {
    keys.forEach(function (k) { if (now - failures[k].first > LOGIN_WINDOW_MS) delete failures[k]; });
  }
  var rec = failures[key];
  if (!rec || now - rec.first > LOGIN_WINDOW_MS) failures[key] = { count: 1, first: now };
  else rec.count++;
}

function clearLoginFailures(req) { delete failures[clientKey(req)]; }
function resetThrottle() { failures = Object.create(null); }
function resetSessions() { sessions = Object.create(null); }

module.exports = {
  SESSION_COOKIE: SESSION_COOKIE,
  USERNAME_RE: USERNAME_RE,
  ROLES: ROLES,
  CSRF_HEADER: CSRF_HEADER,
  CSRF_VALUE: CSRF_VALUE,
  LOGIN_MAX_FAILURES: LOGIN_MAX_FAILURES,
  hashPassword: hashPassword,
  verifyHash: verifyHash,
  loadUsers: loadUsers,
  usersState: usersState,
  verifyCredentials: verifyCredentials,
  createSession: createSession,
  sessionFor: sessionFor,
  sessionIdFrom: sessionIdFrom,
  hasSessionCookie: hasSessionCookie,
  destroySession: destroySession,
  sessionCookie: sessionCookie,
  clearedCookie: clearedCookie,
  ttlMs: ttlMs,
  hasRole: hasRole,
  csrfCheck: csrfCheck,
  loginAllowed: loginAllowed,
  recordLoginFailure: recordLoginFailure,
  clearLoginFailures: clearLoginFailures,
  resetThrottle: resetThrottle,
  resetSessions: resetSessions
};
