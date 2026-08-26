'use strict';
// =====================================================
// OTHMODE — browser sessions (token-free UI authentication)
// projects/command-center/reference/othmode/sessions.js
//
// Replaces the UI's paste-a-token workflow. The mechanism:
//
//   1. The OPERATOR mints a one-time login code on the host:
//        node cli/othmode-cli.js login-link [identity]
//      The code is random (256-bit), single-use, expires in 15 minutes,
//      and only its sha256 HASH is stored — the plaintext exists once, on
//      the operator's terminal, inside the printed URL.
//   2. The browser opens https://<host>/auth/<code> ONCE. The server
//      verifies the hash, burns the code, creates a session (another
//      random 256-bit id, again stored only as a hash) and sets it as an
//      HttpOnly; Secure; SameSite=Strict cookie. 90-day expiry.
//   3. Every later visit authenticates automatically via the cookie. The
//      front end never sees, stores, or transmits a secret itself:
//      HttpOnly keeps the cookie out of JavaScript entirely.
//
// Storage: <OTHMODE store>/config/sessions.json, 0600, atomic replace.
// FAIL-CLOSED like everything else in the store: no provisioned store →
// no cookie sessions (the API's bearer path is unaffected and remains
// the mechanism for CLI/agents/automation).
//
// NOTHING here weakens the existing model: identities resolved from a
// session pass through the exact same role logic as bearer identities,
// and a cookie-authenticated WRITE additionally requires same-origin
// proof (CSRF check in api.js) that bearer requests do not need.
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var store = require('./store.js');

var CODE_TTL_MS = 15 * 60 * 1000;          // one-time login codes
var SESSION_TTL_MS = 90 * 24 * 3600 * 1000; // browser sessions
var MAX_SESSIONS = 50;                      // hard cap; oldest pruned

var FILE = 'config/sessions.json';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function filePath() { return path.join(store.root(), FILE); }

function load() {
  if (!store.provisioned()) return null;
  try {
    var parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { codes: [], sessions: [] };
    return { codes: parsed.codes || [], sessions: parsed.sessions || [] };
  } catch (e) {
    return { codes: [], sessions: [] };
  }
}

function save(data) {
  var target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 448 /* 0700 */ });
  var tmp = target + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 384 /* 0600 */ });
  fs.renameSync(tmp, target);
}

function prune(data, now) {
  data.codes = data.codes.filter(function (c) { return c.exp > now; });
  data.sessions = data.sessions.filter(function (s) { return s.exp > now; });
  if (data.sessions.length > MAX_SESSIONS) {
    data.sessions.sort(function (a, b) { return a.exp - b.exp; });
    data.sessions = data.sessions.slice(data.sessions.length - MAX_SESSIONS);
  }
}

// Constant-time hash comparison, same discipline as auth.js.
function hashesEqual(a, b) {
  var ba = Buffer.from(String(a), 'utf8');
  var bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------------------
// Operator side — mint a one-time login code. Returns the PLAINTEXT code
// exactly once; only the hash is persisted. Never called from a route.
// ---------------------------------------------------------------------------
function createLoginCode(identity) {
  var data = load();
  if (data === null) {
    var e = new Error('OTHMODE_STORE_ABSENT: cannot mint a login code without a provisioned store');
    e.code = 'OTHMODE_STORE_ABSENT';
    throw e;
  }
  var now = Date.now();
  prune(data, now);
  var code = crypto.randomBytes(32).toString('base64url');
  data.codes.push({ h: sha256(code), identity: String(identity || 'owner'), exp: now + CODE_TTL_MS });
  save(data);
  return { code: code, expires_at: new Date(now + CODE_TTL_MS).toISOString() };
}

// ---------------------------------------------------------------------------
// Server side — exchange a code for a session (burns the code), resolve a
// session cookie to an identity, revoke.
// ---------------------------------------------------------------------------
function exchangeCode(code) {
  var data = load();
  if (data === null || !code) return null;
  var now = Date.now();
  prune(data, now);
  var h = sha256(code);
  var found = null;
  // No early exit; same reasoning as auth.js token comparison.
  data.codes.forEach(function (c) { if (hashesEqual(c.h, h)) found = c; });
  if (!found) { save(data); return null; }
  data.codes = data.codes.filter(function (c) { return c !== found; }); // single use
  var sessionId = crypto.randomBytes(32).toString('base64url');
  data.sessions.push({ h: sha256(sessionId), identity: found.identity, exp: now + SESSION_TTL_MS, created: now });
  save(data);
  return { sessionId: sessionId, identity: found.identity };
}

function identityForSession(sessionId) {
  var data = load();
  if (data === null || !sessionId) return null;
  var now = Date.now();
  var h = sha256(sessionId);
  var identity = null;
  data.sessions.forEach(function (s) {
    if (s.exp > now && hashesEqual(s.h, h)) identity = s.identity;
  });
  return identity;
}

function revokeSession(sessionId) {
  var data = load();
  if (data === null || !sessionId) return false;
  var h = sha256(sessionId);
  var before = data.sessions.length;
  data.sessions = data.sessions.filter(function (s) { return !hashesEqual(s.h, h); });
  prune(data, Date.now());
  save(data);
  return data.sessions.length < before;
}

function revokeAll() {
  var data = load();
  if (data === null) return 0;
  var n = data.sessions.length;
  data.sessions = [];
  data.codes = [];
  save(data);
  return n;
}

function status() {
  var data = load();
  if (data === null) return { provisioned: false, sessions: 0, pending_codes: 0 };
  var now = Date.now();
  return {
    provisioned: true,
    sessions: data.sessions.filter(function (s) { return s.exp > now; }).length,
    pending_codes: data.codes.filter(function (c) { return c.exp > now; }).length
  };
}

module.exports = {
  createLoginCode: createLoginCode,
  exchangeCode: exchangeCode,
  identityForSession: identityForSession,
  revokeSession: revokeSession,
  revokeAll: revokeAll,
  status: status,
  CODE_TTL_MS: CODE_TTL_MS,
  SESSION_TTL_MS: SESSION_TTL_MS
};
