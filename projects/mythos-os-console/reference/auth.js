'use strict';
/* =====================================================
   MYTHOS OS COMMAND CENTER — server-side authentication (MOS-v2 M-01)
   projects/mythos-os-console/reference/auth.js

   This module replaces the temporary client-side gate that MOS-1 shipped
   (login-gate.js, deleted by this stage). That gate hid markup; it was
   never a boundary — every /api/ route answered anyone who asked. This
   one is the boundary, and it lives entirely on the server:

     · THE SECRET IS NEVER IN THE PROCESS ENVIRONMENT BY DESIGN.
       MOS_CONSOLE_SECRET is read only from the file named by
       MOS_CONSOLE_SECRET_FILE, and only if that file is mode 0600 (no
       group or other permission bit set at all). A secret exported into
       the environment is IGNORED — `ps eww`, /proc/<pid>/environ and a
       crashing child process all read the environment, and none of them
       may read this. Same shape as MOS_EXECUTOR_TOKEN_FILE in
       upstream.js, one requirement stricter.

     · THE SECRET NEVER LEAVES THIS FILE. verifyPassword() is the only
       exported thing that touches it and it returns a boolean verdict.
       server.js has no way to obtain the value, so it has no way to
       serve it.

     · THE COMPARISON IS CONSTANT-TIME. Both sides are hashed to a
       fixed-width SHA-256 digest first, so timingSafeEqual never sees
       a length mismatch and the comparison leaks neither the secret's
       length nor how many leading characters a guess got right.

     · THE SESSION IDENTIFIER IS NEVER READABLE BY JAVASCRIPT. It is
       issued as an httpOnly, SameSite=Strict, Secure, Path=/ cookie.
       Nothing is written to localStorage or sessionStorage anywhere in
       this console — tests/mos-1-console-test.js asserts that at source
       level over every file the browser loads.

   Sessions are in-memory and deliberately so: the console is a single
   process behind one nginx vhost, and a restart invalidating every
   session is the correct behaviour for an operations console, not a
   defect to engineer around with a session store.
   ===================================================== */

var crypto = require('crypto');
var fs = require('fs');

var SESSION_COOKIE = 'mos_session';
var SESSION_ID_RE = /^[0-9a-f]{64}$/;

// Eight hours: one working day at the console, no silent renewal. The
// lifetime is absolute, not idle-based — an operator who left the tab
// open overnight authenticates again, and a stolen cookie has a ceiling
// that no amount of use extends.
var DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

// A ceiling on concurrent sessions, so an attacker who can reach the
// login route cannot grow the store without bound even when every
// attempt fails to authenticate (they cannot: a session is only ever
// minted after verifyPassword() returns true, but the ceiling is here
// so that fact is a property of the store as well as of the caller).
var MAX_SESSIONS = 256;

// Login throttle. Ten failures from one address in fifteen minutes and
// that address is refused until the window rolls off. The console has
// exactly one credential, so an unthrottled login route is an offline
// brute force with an online oracle attached.
var LOGIN_WINDOW_MS = 15 * 60 * 1000;
var LOGIN_MAX_FAILURES = 10;
var MAX_TRACKED_CLIENTS = 1024;

var sessions = Object.create(null);   // id -> { expiresAt }
var failures = Object.create(null);   // client -> { count, first }

function ttlMs() {
  var n = parseInt(process.env.MOS_SESSION_TTL_MS || '', 10);
  if (isNaN(n) || n < 1000) return DEFAULT_TTL_MS;
  return n;
}

// --- the secret -------------------------------------------------------

// Reasons are returned rather than thrown, and are never sent to the
// browser: an unauthenticated caller learns only that they are
// unauthenticated. The operator reads the reason from /api/health,
// which is itself behind the session, and from the startup line.
function loadSecret() {
  var file = process.env.MOS_CONSOLE_SECRET_FILE;
  if (!file) return { ok: false, reason: 'unconfigured' };

  var st;
  try { st = fs.statSync(file); }
  catch (e) { return { ok: false, reason: 'unreadable' }; }
  if (!st.isFile()) return { ok: false, reason: 'unreadable' };

  // 0600 or tighter. Any group or other permission bit means the file
  // is readable by something that is not this service, and a secret
  // that something else can read is not a secret this service can rely
  // on. Refusing is the whole point of checking.
  if ((st.mode & 0o077) !== 0) return { ok: false, reason: 'insecure_mode' };

  var text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { return { ok: false, reason: 'unreadable' }; }

  var m = /^[ \t]*(?:export[ \t]+)?MOS_CONSOLE_SECRET=(.*)$/m.exec(text);
  if (!m) return { ok: false, reason: 'missing' };

  var value = m[1].trim();
  // systemd's EnvironmentFile accepts a quoted value; strip one matched
  // pair so an operator who quoted the line does not get a secret with
  // quotation marks baked into it.
  var quoted = /^"(.*)"$/.exec(value) || /^'(.*)'$/.exec(value);
  if (quoted) value = quoted[1];
  if (!value) return { ok: false, reason: 'missing' };

  return { ok: true, secret: value };
}

// True only when a usable secret exists. Reported to the authenticated
// operator so a misconfigured deployment is visible rather than merely
// unusable; never reported to an unauthenticated caller.
function secretState() {
  var loaded = loadSecret();
  return { provisioned: loaded.ok, reason: loaded.ok ? null : loaded.reason };
}

/* The only function in this process that compares anything against the
   console secret, and the only one that ever holds it. Returns a plain
   boolean-bearing verdict; the secret is not reachable from the result. */
function verifyPassword(candidate) {
  var loaded = loadSecret();
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return { ok: false, reason: 'invalid' };
  }
  var a = crypto.createHash('sha256').update(candidate, 'utf8').digest();
  var b = crypto.createHash('sha256').update(loaded.secret, 'utf8').digest();
  return crypto.timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'invalid' };
}

// --- sessions ---------------------------------------------------------

function sweep(now) {
  Object.keys(sessions).forEach(function (id) {
    if (sessions[id].expiresAt <= now) delete sessions[id];
  });
}

function createSession() {
  var now = Date.now();
  sweep(now);
  var ids = Object.keys(sessions);
  if (ids.length >= MAX_SESSIONS) {
    // Oldest expiry first: the session closest to ending is the one
    // whose loss costs an operator least.
    ids.sort(function (x, y) { return sessions[x].expiresAt - sessions[y].expiresAt; })
       .slice(0, ids.length - MAX_SESSIONS + 1)
       .forEach(function (id) { delete sessions[id]; });
  }
  var id = crypto.randomBytes(32).toString('hex');
  var expiresAt = now + ttlMs();
  sessions[id] = { expiresAt: expiresAt };
  return { id: id, expiresAt: expiresAt };
}

/* Resolve a request to a live session, or null. An identifier that is
   unknown, malformed or past its expiry is all the same answer here —
   the caller distinguishes only "authenticated" from "not". An expired
   entry is deleted on the way past, so expiry is enforced by this
   function and not merely by the sweep. */
function sessionFor(req) {
  var id = sessionIdFrom(req);
  if (!id) return null;
  var entry = sessions[id];
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { delete sessions[id]; return null; }
  return { id: id, expiresAt: entry.expiresAt };
}

function destroySession(id) {
  if (id && Object.prototype.hasOwnProperty.call(sessions, id)) {
    delete sessions[id];
    return true;
  }
  return false;
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

/* Whether a session cookie was PRESENTED at all, however malformed. This
   is deliberately not sessionIdFrom() !== null: a browser holding a
   garbage value keeps sending it on every request, so the caller needs to
   clear it, and a value that fails the shape check is exactly the case
   sessionIdFrom() reports as absent. */
function hasSessionCookie(req) {
  return parseCookies(req && req.headers && req.headers.cookie)[SESSION_COOKIE] !== undefined;
}

/* Secure is unconditional. The console is served over TLS by its nginx
   vhost and by nothing else, and browsers already exempt http://localhost
   from the Secure requirement, so a loopback operator is not locked out
   by it. httpOnly keeps the identifier out of document.cookie; SameSite
   Strict means no cross-site request ever carries it, which is what
   makes the three POST relays safe without a separate CSRF token. */
function sessionCookie(id, maxAgeMs) {
  return SESSION_COOKIE + '=' + id +
    '; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=' +
    Math.floor((maxAgeMs === undefined ? ttlMs() : maxAgeMs) / 1000);
}

function clearedCookie() {
  return SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0';
}

// --- login throttle ---------------------------------------------------

// The socket address, not a forwarded header: X-Forwarded-For is caller
// -controlled and would let an attacker rotate their own throttle key.
// nginx is the only thing that reaches this port, so every real client
// arrives as 127.0.0.1 and the throttle is global in practice — which
// for a single-credential console is the conservative direction.
function clientKey(req) {
  return (req && req.socket && req.socket.remoteAddress) || 'unknown';
}

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

// Test-only reset, so a suite can exercise the throttle and then the
// happy path without waiting fifteen minutes. It clears state; it
// cannot grant one.
function resetThrottle() { failures = Object.create(null); }

module.exports = {
  SESSION_COOKIE: SESSION_COOKIE,
  secretState: secretState,
  verifyPassword: verifyPassword,
  createSession: createSession,
  sessionFor: sessionFor,
  sessionIdFrom: sessionIdFrom,
  hasSessionCookie: hasSessionCookie,
  destroySession: destroySession,
  sessionCookie: sessionCookie,
  clearedCookie: clearedCookie,
  ttlMs: ttlMs,
  loginAllowed: loginAllowed,
  recordLoginFailure: recordLoginFailure,
  clearLoginFailures: clearLoginFailures,
  resetThrottle: resetThrottle
};
