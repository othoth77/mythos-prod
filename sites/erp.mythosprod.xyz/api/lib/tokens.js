'use strict';

/* Opaque token generation and storage hashing.
 *
 * Session tokens, CSRF tokens and password-reset tokens are all the same
 * primitive: 256 bits of CSPRNG output, handed to the client once, and stored
 * only as a sha256 digest. A database dump must not yield live sessions or
 * usable reset links — the same reason password_hash exists.
 *
 * sha256 is correct here and bcrypt/scrypt would be wrong: these are
 * high-entropy random values, not low-entropy human secrets, so there is
 * nothing to brute-force and no reason to pay a KDF's cost on every request.
 */

var crypto = require('crypto');

var TOKEN_BYTES = 32; // 256 bits

function generate() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/* Constant-time compare for anything derived from a secret. */
function safeEqual(a, b) {
  var ba = Buffer.from(String(a), 'utf8');
  var bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* Session cookie. __Host- is not decoration: the prefix is only honoured when
   the cookie is Secure, Path=/ and has no Domain, which is precisely what stops
   a sibling subdomain from setting a session cookie for this one. */
var COOKIE_NAME = '__Host-erp_session';

function cookieHeader(token, maxAgeSeconds) {
  return COOKIE_NAME + '=' + token +
    '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(maxAgeSeconds);
}

function clearCookieHeader() {
  return COOKIE_NAME + '=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';
}

function readCookie(cookieHeaderValue, name) {
  var want = name || COOKIE_NAME;
  var parts = String(cookieHeaderValue || '').split(';');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].trim();
    var eq = kv.indexOf('=');
    if (eq < 0) continue;
    if (kv.slice(0, eq).trim() === want) return kv.slice(eq + 1).trim();
  }
  return null;
}

module.exports = {
  TOKEN_BYTES: TOKEN_BYTES,
  COOKIE_NAME: COOKIE_NAME,
  generate: generate,
  hashToken: hashToken,
  safeEqual: safeEqual,
  cookieHeader: cookieHeader,
  clearCookieHeader: clearCookieHeader,
  readCookie: readCookie
};
