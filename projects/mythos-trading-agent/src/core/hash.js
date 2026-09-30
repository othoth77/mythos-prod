'use strict';
// =====================================================
// MYTHOS TRADING AGENT — canonical serialisation and hashing
// projects/mythos-trading-agent/src/core/hash.js
//
// Mission §14 requires every backtest to record a configuration hash and a
// dataset version, and to be reproducible from them. That only holds if the
// hash is stable under things that do not change meaning — chiefly object key
// order, which JSON.stringify preserves as insertion order and therefore
// varies with how a config was assembled.
//
// canonical() sorts keys recursively and rejects values JSON cannot round-trip
// (NaN, Infinity, functions, undefined inside objects). A config that cannot
// be canonicalised cannot be hashed, and a run it produced cannot be claimed
// reproducible — so it fails loudly instead.
// =====================================================

var crypto = require('crypto');

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * Deterministic JSON: object keys sorted, no insignificant whitespace.
 * @param {*} value
 * @param {string} [path] internal — the JSON path used in error messages
 */
function canonical(value, path) {
  var p = path || '$';
  var t = typeName(value);

  if (t === 'number') {
    if (!isFinite(value)) {
      throw new TypeError('canonical(): non-finite number at ' + p + ' (' + String(value) + ')');
    }
    // -0 and 0 are the same value for hashing purposes.
    return JSON.stringify(value === 0 ? 0 : value);
  }
  if (t === 'string' || t === 'boolean' || t === 'null') return JSON.stringify(value);
  if (t === 'array') {
    var parts = [];
    for (var i = 0; i < value.length; i++) parts.push(canonical(value[i], p + '[' + i + ']'));
    return '[' + parts.join(',') + ']';
  }
  if (t === 'object') {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    var keys = Object.keys(value).sort();
    var out = [];
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var v = value[key];
      if (v === undefined) continue; // matches JSON.stringify: undefined members vanish
      out.push(JSON.stringify(key) + ':' + canonical(v, p + '.' + key));
    }
    return '{' + out.join(',') + '}';
  }
  throw new TypeError('canonical(): unserialisable ' + t + ' at ' + p);
}

/** Full hex SHA-256 of the canonical form. */
function sha256(value) {
  return crypto.createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

/**
 * Short hash for labels and filenames. 12 hex chars = 48 bits; collisions are
 * not a correctness concern because the full hash is always stored beside it.
 */
function shortHash(value) {
  return sha256(value).slice(0, 12);
}

/**
 * Config fingerprint: { hash, shortHash, canonical }. Stored on every backtest,
 * stress test and champion record so a result can be tied back to its inputs.
 */
function fingerprint(value) {
  var c = canonical(value);
  var h = crypto.createHash('sha256').update(c, 'utf8').digest('hex');
  return { hash: h, shortHash: h.slice(0, 12), canonical: c, bytes: Buffer.byteLength(c, 'utf8') };
}

module.exports = {
  canonical: canonical,
  sha256: sha256,
  shortHash: shortHash,
  fingerprint: fingerprint
};
