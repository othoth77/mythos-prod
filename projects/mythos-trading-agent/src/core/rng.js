'use strict';
// =====================================================
// MYTHOS TRADING AGENT — seeded deterministic RNG
// projects/mythos-trading-agent/src/core/rng.js
//
// Every random draw in this platform — synthetic market data, Monte Carlo
// trade reordering, parameter perturbation, slippage sampling — comes from
// here with an explicit seed. Math.random() is never used: a stress test whose
// verdict changes between runs cannot gate a promotion, and mission §14
// requires every result to be reproducible.
//
// Algorithm: mulberry32 (32-bit state, period 2^32). Small state is a feature
// here — the whole generator state is one integer, so a run can be resumed or
// forked deterministically. It is NOT cryptographic and must never be used for
// tokens, keys or anything security-bearing.
// =====================================================

/**
 * cyrb128-derived string hash → 32-bit seed. Lets callers seed from a readable
 * label ('EURUSD-2024-insample') instead of an opaque number.
 */
function seedFromString(str) {
  var s = String(str);
  var h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (var i = 0; i < s.length; i++) {
    var k = s.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return (h1 ^ h2 ^ h3 ^ h4) >>> 0;
}

function normaliseSeed(seed) {
  if (typeof seed === 'number' && isFinite(seed)) return (seed >>> 0) || 1;
  if (typeof seed === 'string' && seed.length > 0) return seedFromString(seed) || 1;
  throw new TypeError('seed must be a finite number or a non-empty string, got ' + JSON.stringify(seed));
}

/**
 * Creates a seeded generator.
 *
 * @param {number|string} seed
 * @returns {object} generator with float/int/bool/normal/pick/shuffle/fork
 */
function create(seed) {
  var state = normaliseSeed(seed);
  var label = String(seed);
  var spare = null; // second Box-Muller deviate, kept so no draw is wasted

  function nextUint32() {
    state = (state + 0x6D2B79F5) >>> 0;
    var t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  var api = {
    /** Uniform in [0, 1). */
    float: function () {
      return nextUint32() / 4294967296;
    },
    /** Uniform in [lo, hi). */
    uniform: function (lo, hi) {
      return lo + (hi - lo) * api.float();
    },
    /** Uniform integer in [lo, hi] inclusive. */
    int: function (lo, hi) {
      if (!(hi >= lo)) throw new RangeError('int range inverted: [' + lo + ', ' + hi + ']');
      return lo + Math.floor(api.float() * (hi - lo + 1));
    },
    /** True with probability p. */
    bool: function (p) {
      return api.float() < (p === undefined ? 0.5 : p);
    },
    /** Standard normal deviate via Box-Muller (polar form). */
    normal: function (mean, sd) {
      var m = mean === undefined ? 0 : mean;
      var s = sd === undefined ? 1 : sd;
      if (spare !== null) {
        var v = spare;
        spare = null;
        return m + s * v;
      }
      var u1 = 0, u2 = 0, r = 0;
      do {
        u1 = api.float() * 2 - 1;
        u2 = api.float() * 2 - 1;
        r = u1 * u1 + u2 * u2;
      } while (r === 0 || r >= 1);
      var f = Math.sqrt(-2 * Math.log(r) / r);
      spare = u2 * f;
      return m + s * (u1 * f);
    },
    /** Uniform element of a non-empty array. */
    pick: function (arr) {
      if (!Array.isArray(arr) || arr.length === 0) throw new RangeError('pick() needs a non-empty array');
      return arr[api.int(0, arr.length - 1)];
    },
    /** Fisher-Yates shuffle returning a NEW array; the input is untouched. */
    shuffle: function (arr) {
      var out = arr.slice();
      for (var i = out.length - 1; i > 0; i--) {
        var j = api.int(0, i);
        var t = out[i]; out[i] = out[j]; out[j] = t;
      }
      return out;
    },
    /**
     * Draws `n` elements WITH replacement — the bootstrap primitive Monte
     * Carlo trade-order resampling needs.
     */
    resample: function (arr, n) {
      if (!Array.isArray(arr) || arr.length === 0) throw new RangeError('resample() needs a non-empty array');
      var count = n === undefined ? arr.length : n;
      var out = [];
      for (var i = 0; i < count; i++) out.push(arr[api.int(0, arr.length - 1)]);
      return out;
    },
    /**
     * A child generator whose stream is independent of this one but fully
     * determined by (this seed, tag). Used to give each asset, each strategy
     * and each Monte Carlo replication its own reproducible stream.
     */
    fork: function (tag) {
      return create(label + '::' + String(tag));
    },
    /** Current internal state — enough to resume this generator exactly. */
    snapshot: function () {
      return { seed: label, state: state, spare: spare };
    },
    restore: function (snap) {
      state = snap.state >>> 0;
      spare = snap.spare === undefined ? null : snap.spare;
      return api;
    },
    seedLabel: label
  };

  return api;
}

module.exports = {
  create: create,
  seedFromString: seedFromString
};
