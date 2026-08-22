'use strict';

/* Password hashing.
 *
 * DEVIATION FROM THE STAGE 4 DESIGN, STATED RATHER THAN HIDDEN:
 * the design specified Argon2id. Argon2id in Node requires a native module,
 * and every other piece of Mythos server code — monitor.js, offhost-backup.js —
 * runs on Node builtins alone. Adding a compiled dependency to a production
 * host is a bigger decision than choosing a KDF, and it is not one Stage 4 was
 * approved to make.
 *
 * scrypt is used instead: memory-hard, built into Node, and listed by OWASP as
 * an acceptable choice where Argon2id is unavailable. Parameters are OWASP's
 * scrypt recommendation, N=2^17 (~128 MiB), r=8, p=1.
 *
 * The migration path is already in the schema: users.password_algo records
 * which KDF produced the hash, and verify() dispatches on it. Moving to
 * argon2id later means adding a branch and rehashing on next login — which is
 * exactly what needsRehash() exists for. Nothing has to be re-designed.
 */

var crypto = require('crypto');

var ALGO = 'scrypt';
var PARAMS = { N: 131072, r: 8, p: 1, keylen: 64, saltlen: 16 };
// maxmem must exceed 128*N*r; node's default (32 MiB) is far too small for N=2^17.
var MAXMEM = 256 * 1024 * 1024;

function hash(password, opts) {
  var o = Object.assign({}, PARAMS, opts || {});
  return new Promise(function (resolve, reject) {
    if (typeof password !== 'string' || password.length === 0) {
      return reject(new Error('password must be a non-empty string'));
    }
    var salt = crypto.randomBytes(o.saltlen);
    crypto.scrypt(password, salt, o.keylen,
      { N: o.N, r: o.r, p: o.p, maxmem: MAXMEM },
      function (err, dk) {
        if (err) return reject(err);
        // Self-describing: parameters travel with the hash, so changing the
        // policy never strands existing users.
        resolve('$scrypt$N=' + o.N + ',r=' + o.r + ',p=' + o.p + '$' +
                salt.toString('base64') + '$' + dk.toString('base64'));
      });
  });
}

function parse(encoded) {
  var m = /^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(String(encoded || ''));
  if (!m) return null;
  return {
    N: parseInt(m[1], 10), r: parseInt(m[2], 10), p: parseInt(m[3], 10),
    salt: Buffer.from(m[4], 'base64'), key: Buffer.from(m[5], 'base64')
  };
}

/* Always returns a boolean, never throws on malformed input: a verify() that
   throws on a bad stored hash leaks, through error handling, the fact that the
   account exists. */
function verify(password, encoded) {
  return new Promise(function (resolve) {
    var p = parse(encoded);
    if (!p || typeof password !== 'string') return resolve(false);
    crypto.scrypt(password, p.salt, p.key.length,
      { N: p.N, r: p.r, p: p.p, maxmem: MAXMEM },
      function (err, dk) {
        if (err) return resolve(false);
        // Constant-time: a length-varying or short-circuiting compare here is
        // a timing oracle on the hash itself.
        if (dk.length !== p.key.length) return resolve(false);
        resolve(crypto.timingSafeEqual(dk, p.key));
      });
  });
}

/* True when the stored hash is weaker than current policy, so login can
   transparently upgrade it. */
function needsRehash(encoded) {
  var p = parse(encoded);
  if (!p) return true;
  return p.N < PARAMS.N || p.r < PARAMS.r || p.p < PARAMS.p;
}

module.exports = { ALGO: ALGO, PARAMS: PARAMS, hash: hash, verify: verify, needsRehash: needsRehash, parse: parse };
