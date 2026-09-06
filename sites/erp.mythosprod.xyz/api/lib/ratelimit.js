'use strict';

/* General per-IP request rate limit, decided once per connection in
 * server.js before any routing, body-size, or auth decision (Phase 14).
 *
 * The login path already has its own account+IP lockout backed by
 * `login_attempts` (lib/auth.js's `ipThrottled`) — that answers "is this
 * credential under attack". This answers a different question: "is this
 * source flooding the API at all", regardless of which route or whether it
 * ever authenticates.
 *
 * Algorithm: a FIXED (tumbling) window counter, not a sliding window — a
 * bucket resets wholesale on the first request after WINDOW_MS elapses,
 * there is no rolling/weighted calculation. This is a deliberate choice, not
 * an oversight: a true sliding-window log would need to retain a timestamp
 * per request, for a control that exists as a generous backstop (see below),
 * not the primary defence. The known consequence of a fixed window is a
 * boundary case — up to 2x MAX_REQUESTS can pass in a span just over
 * WINDOW_MS if a client's traffic straddles its own window edge — and that
 * is accepted at these thresholds rather than paid for with more state.
 *
 * IP identity: `server.js` passes `req.socket.remoteAddress`, the raw TCP
 * peer address. No `X-Forwarded-For` / `X-Real-IP` header is read or trusted
 * anywhere in this codebase (there is no reverse proxy in front of erp-api
 * today to make such a header meaningful — see server.js's own comment: this
 * service binds 127.0.0.1 only). One consequence worth stating plainly: in
 * the CURRENT topology every real connection arrives from the loopback
 * address, so this limiter currently behaves as one shared bucket for the
 * whole service, not a per-external-client control. That is accurate for
 * today's deployment and is not "fixed" by trusting a proxy header here —
 * doing so before a specific, trusted reverse proxy exists would only add a
 * spoofable identity source. Revisiting IP derivation is Phase 15's job,
 * once nginx is actually in front of this process.
 *
 * A single process, in-memory structure is enough here: erp-api runs as one
 * Node process (no clustering), the state is deliberately not persisted (a
 * restart should not carry a ban forward), and a database-backed limiter
 * would need a migration for a concern that must work even when the
 * database is the thing under load.
 *
 * The default is generous by design: the realistic threat today is a
 * scripted flood from a process that can already reach 127.0.0.1, not a
 * public attacker — the limit exists so that changes, not to throttle
 * normal UI or test traffic.
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

/* Removes any bucket whose window closed at least one window-length ago —
   i.e. an IP that has sent nothing for a while stops occupying memory. Wired
   to a self-unref'd interval below, so it runs for the life of the process
   without keeping it alive on its own and without any caller needing to
   remember to invoke it (that omission — a cleanup function nobody called —
   is the exact defect this replaces). */
function sweep(now) {
  now = now || Date.now();
  buckets.forEach(function (b, key) {
    if (now - b.windowStart >= WINDOW_MS * 2) buckets.delete(key);
  });
}

function reset() { buckets.clear(); }

// Read-only: how many distinct sources currently hold a bucket. Exists so a
// test can prove sweep() actually removes entries, distinct from check()'s
// own lazy replacement of a stale bucket on that same key's next request —
// a size that doesn't shrink would mean sweep() is a no-op even though a
// subsequent check() on the same key still happens to behave correctly.
function size() { return buckets.size; }

// Runs at most every 2*WINDOW_MS (20 s at the default), doing O(distinct
// IPs seen recently) work — negligible next to the traffic that populated
// the map in the first place. unref() so this timer alone can never keep
// the process, or a short-lived script that merely requires this module
// (e.g. the test suite), running past its natural end.
var sweepTimer = setInterval(sweep, WINDOW_MS * 2);
if (sweepTimer.unref) sweepTimer.unref();

module.exports = { check: check, sweep: sweep, reset: reset, size: size, WINDOW_MS: WINDOW_MS, MAX_REQUESTS: MAX_REQUESTS };
