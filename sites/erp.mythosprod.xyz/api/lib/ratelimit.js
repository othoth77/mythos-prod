'use strict';

/* General per-IP request rate limit, applied to every route (Phase 14).
 *
 * The login path already has its own account+IP lockout backed by
 * `login_attempts` (lib/auth.js's `ipThrottled`) — that answers "is this
 * credential under attack". This answers a different question: "is this
 * source flooding the API at all", regardless of which route or whether it
 * ever authenticates. A single process, in-memory sliding window is enough
 * here: erp-api runs as one Node process (no clustering), the state is
 * deliberately not persisted (a restart should not carry a ban forward), and
 * a database-backed limiter would need a migration for a concern that must
 * work even when the database is the thing under load.
 *
 * The default is generous by design: this service is loopback-only today
 * (see server.js), so the realistic threat is a scripted flood from a
 * process that can already reach 127.0.0.1, not a public attacker — the
 * limit exists so that changes, not to throttle normal UI or test traffic.
 */

var WINDOW_MS = Number(process.env.ERP_RATE_LIMIT_WINDOW_MS) || 10000;
var MAX_REQUESTS = Number(process.env.ERP_RATE_LIMIT_MAX) || 400;

var buckets = new Map();

function check(ip, now) {
  now = now || Date.now();
  var key = ip || 'unknown';
  var b = buckets.get(key);
  if (!b || now - b.windowStart >= WINDOW_MS) {
    b = { windowStart: now, count: 0 };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > MAX_REQUESTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((b.windowStart + WINDOW_MS - now) / 1000) };
  }
  return { allowed: true };
}

/* Bounded cleanup so a long-running process does not accumulate one entry
   per distinct IP forever (relevant once this is ever behind a public proxy). */
function sweep(now) {
  now = now || Date.now();
  buckets.forEach(function (b, key) {
    if (now - b.windowStart >= WINDOW_MS * 2) buckets.delete(key);
  });
}

function reset() { buckets.clear(); }

module.exports = { check: check, sweep: sweep, reset: reset, WINDOW_MS: WINDOW_MS, MAX_REQUESTS: MAX_REQUESTS };
