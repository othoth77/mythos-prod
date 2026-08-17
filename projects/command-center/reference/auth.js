'use strict';
// =====================================================
// MYTHOS AI COMMAND CENTER — write authorisation
// projects/command-center/reference/auth.js
//
// Follows projects/idauto/reference/identity.js (IDA-2E-PRE): a small,
// explicit, config-defined map of bearer tokens to stable identity
// strings. It is NOT a `mythos_auth` integration — that service still does
// not exist in this codebase — and it does not pretend to be one. No login
// flow, no session, no JWT, no user table.
//
// THE SPLIT, and why it is where it is:
//
//   READS are public. Owner requirement §7 is explicit — "do not require
//   login for basic copying" — and the library holds no PII and no secret
//   (secrets.js refuses credential-shaped content at the write boundary,
//   so by construction there is nothing here to protect from a reader).
//
//   WRITES require a token. The site is on a public domain. Without this
//   gate, anyone reaching ordre.mythosprod.xyz could edit or archive the
//   owner's command library. The library is the artefact that matters, so
//   the gate sits on everything that changes it.
//
//   ...with ONE deliberate exception: POST /api/commands/:id/usage. A copy
//   event must record without a token, because copying is the unauthenticated
//   action §7 requires and usage tracking (§7, §8) is the whole point of it.
//   That endpoint can therefore only increment a counter and append a usage
//   row — it cannot touch command content. The worst a stranger can do is
//   skew a leaderboard, which is worth accepting to keep copying frictionless.
//
// TIMING: tokens are compared as fixed-length SHA-256 digests through
// crypto.timingSafeEqual, so a wrong token takes the same time to reject
// regardless of how many leading characters were right.
// =====================================================

var crypto = require('crypto');

var _tokens = null;

// Parses MCC_ADMIN_TOKENS once per process. Format: JSON object,
// { "<bearer token>": "<stable identity string>", ... }. A parse failure
// reports only THAT it failed — never the (secret-containing) input.
function loadTokens() {
  if (_tokens !== null) return _tokens;
  var raw = process.env.MCC_ADMIN_TOKENS;
  if (!raw) {
    _tokens = {};
    return _tokens;
  }
  try {
    var parsed = JSON.parse(raw);
    _tokens = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (e) {
    _tokens = {};
  }
  return _tokens;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest();
}

// Returns the identity string for a raw bearer token, or null when the
// token is unrecognised. Never log the token alongside the identity.
function resolveIdentity(token) {
  if (!token) return null;
  var tokens = loadTokens();
  var names = Object.keys(tokens);
  var candidate = digest(token);
  var identity = null;
  // Every configured token is compared, with no early exit, so the work
  // done does not reveal WHICH token matched or how many were checked.
  for (var i = 0; i < names.length; i++) {
    if (crypto.timingSafeEqual(candidate, digest(names[i]))) {
      identity = tokens[names[i]];
    }
  }
  return identity;
}

// Extracts a bearer token from a request. `Authorization: Bearer <token>`
// is the only accepted carrier: not a query string (it would land in nginx
// access logs and browser history) and not a cookie (nothing here needs
// ambient authority, and avoiding cookies avoids CSRF entirely).
function tokenFromRequest(req) {
  var header = req && req.headers ? req.headers['authorization'] : null;
  if (!header || typeof header !== 'string') return null;
  var match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function identityFromRequest(req) {
  return resolveIdentity(tokenFromRequest(req));
}

// True when no token is configured at all. The server refuses to start in
// that state (see server.js) rather than silently exposing an open
// write surface on a public domain.
function isUnconfigured() {
  return Object.keys(loadTokens()).length === 0;
}

// Test/ops helper — forces a re-parse on the next call.
function clearTokenCache() {
  _tokens = null;
}

module.exports = {
  resolveIdentity: resolveIdentity,
  tokenFromRequest: tokenFromRequest,
  identityFromRequest: identityFromRequest,
  isUnconfigured: isUnconfigured,
  clearTokenCache: clearTokenCache
};
