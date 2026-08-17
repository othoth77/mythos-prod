'use strict';
// =====================================================
// Mythos Orchestration Core — provider health (Phase 2N)
// projects/mythos-ai-executor/core/provider-health.js
//
// Closes the gap recorded in the master vision (capability N): the
// executor's `GET /health` already probes real operational dependencies
// (n8n, OmniRoute) but that result was consumed nowhere — agent-registry
// probes only checked credential presence, never actual reachability.
//
// This module is the connecting piece: a small in-memory snapshot of
// "is dependency X actually reachable right now", written by whichever
// code already performs the real probe (executor.js health()) and read
// by agent-registry's provider probes during selection. It duplicates
// no probing logic of its own — it only records and serves results.
//
// Fail-open by design: a dependency that has never been probed, or
// whose last result is stale, reads as reachable. A provider must never
// be silently excluded from selection just because nothing has refreshed
// its health yet (e.g. a fresh process before the first health tick).
// Only an actual observed failure, still fresh, blocks selection.
// =====================================================

var HEALTH_TTL_MS = 5 * 60 * 1000;

var snapshot = {}; // name -> { at, ok }

function record(name, ok) {
  snapshot[String(name)] = { at: Date.now(), ok: !!ok };
}

function isReachable(name) {
  var s = snapshot[String(name)];
  if (!s || Date.now() - s.at > HEALTH_TTL_MS) return true; // fail-open
  return s.ok;
}

function status(name) {
  var s = snapshot[String(name)];
  if (!s) return { known: false, ok: null, at: null };
  return { known: Date.now() - s.at <= HEALTH_TTL_MS, ok: s.ok, at: s.at };
}

function resetForTests() { snapshot = {}; }

module.exports = {
  record: record,
  isReachable: isReachable,
  status: status,
  resetForTests: resetForTests,
  HEALTH_TTL_MS: HEALTH_TTL_MS
};
