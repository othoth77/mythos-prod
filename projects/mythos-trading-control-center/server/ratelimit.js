'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — rate limiting
// projects/mythos-trading-control-center/server/ratelimit.js
//
// Fixed-window counters, one per (bucket, key). Three buckets are used by the
// server: reads, mutations, and heavy jobs (backtests, test runs). The heavy
// bucket is the one that matters on this host — a backtest is a process, and a
// loop that starts thirty of them is an outage — and it is deliberately far
// lower than the other two.
//
// The key is the session's user when there is one and the client address
// otherwise, so one signed-in operator cannot be starved by another client.
//
// The store is bounded: past MAX_KEYS, expired windows are swept, and if that
// is not enough the oldest are dropped. A limiter that grows without bound is
// its own denial of service.
// =====================================================

var MAX_KEYS = 4096;

/**
 * @param {object} [spec]
 * @param {object} [spec.buckets] { name: { limit, windowMs } }
 * @param {function} [spec.now]
 */
function create(spec) {
  var o = spec || {};
  var now = typeof o.now === 'function' ? o.now : function () { return Date.now(); };
  var buckets = Object.assign({
    read: { limit: 600, windowMs: 60 * 1000 },
    write: { limit: 60, windowMs: 60 * 1000 },
    heavy: { limit: 12, windowMs: 60 * 1000 },
    login: { limit: 20, windowMs: 60 * 1000 }
  }, o.buckets || {});
  var counters = new Map();

  function sweep(t) {
    counters.forEach(function (rec, k) {
      if (t - rec.start >= rec.windowMs) counters.delete(k);
    });
    if (counters.size > MAX_KEYS) {
      var drop = counters.size - MAX_KEYS;
      var it = counters.keys();
      for (var i = 0; i < drop; i++) counters.delete(it.next().value);
    }
  }

  /**
   * Counts one request.
   * @returns {{allowed, limit, remaining, retryAfterSeconds}}
   */
  function hit(bucket, key) {
    var b = buckets[bucket];
    if (!b) throw new Error('ratelimit: unknown bucket ' + bucket);
    var t = now();
    var k = bucket + '|' + String(key || 'unknown').slice(0, 96);
    var rec = counters.get(k);
    if (!rec || t - rec.start >= b.windowMs) {
      if (counters.size >= MAX_KEYS) sweep(t);
      rec = { start: t, count: 0, windowMs: b.windowMs };
      counters.set(k, rec);
    }
    rec.count++;
    var allowed = rec.count <= b.limit;
    return {
      allowed: allowed,
      limit: b.limit,
      remaining: Math.max(0, b.limit - rec.count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((rec.start + b.windowMs - t) / 1000))
    };
  }

  return {
    hit: hit,
    buckets: function () { return JSON.parse(JSON.stringify(buckets)); },
    size: function () { return counters.size; },
    reset: function () { counters.clear(); }
  };
}

module.exports = { create: create };
