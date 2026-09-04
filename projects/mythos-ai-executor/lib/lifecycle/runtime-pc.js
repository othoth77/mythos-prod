'use strict';
// =====================================================
// MYTHOS Execution Lifecycle — PC Agent Runtime (relay-based)
// projects/mythos-ai-executor/lib/lifecycle/runtime-pc.js
//
// The VPS never inspects a Windows/macOS process table. A lightweight
// MYTHOS PC Agent (ops/lifecycle/mythos-pc-agent.js) runs next to Claude on
// the PC, is wired into Claude Code's hooks there, and RELAYS lifecycle
// events to this host through an authenticated channel (the executor's
// POST /lifecycle/events with bearer + HMAC, or any transport that drops
// files into the registry inbox). It also polls its outbox for requests
// this host makes of it (register an execution, request a close).
//
// So on this side a PC session is exactly what the relay told us, aged by
// its heartbeat:
//
//   state as relayed          heartbeat fresh   → that state
//   state as relayed          heartbeat stale   → UNKNOWN   (relay lost ≠ session closed)
//   SESSION_END + process_gone                  → CLOSED
//
// request_close never signals anything: it writes an outbox request the PC
// agent may honour under ITS OWN local policy (a close request is advice
// to another machine, not a command with authority there). verify_closed
// only ever succeeds on the PC agent's explicit process-gone confirmation.
// =====================================================

var registry = require('./registry');

var DEFAULTS = {
  heartbeat_timeout_ms: 5 * 60 * 1000,      // beyond this, relayed state is not believed
  close_request_ttl_ms: 15 * 60 * 1000
};

function config(opts) {
  var cfg = {};
  Object.keys(DEFAULTS).forEach(function (k) { cfg[k] = DEFAULTS[k]; });
  Object.keys(opts || {}).forEach(function (k) { if (opts[k] !== undefined) cfg[k] = opts[k]; });
  if (!cfg.registry) throw new Error('PC_RUNTIME_REGISTRY_REQUIRED');
  return cfg;
}

function getSession(ref, opts) {
  var cfg = config(opts);
  var rec = ref.session_id ? registry.getSession(cfg.registry, ref.session_id) : null;
  if (!rec && ref.pid && ref.host) rec = registry.findByPid(cfg.registry, ref.pid, ref.host)[0] || null;
  return { found: !!rec, source: rec ? 'relay' : null, session_id: rec ? rec.session_id : (ref.session_id || null), pid: rec ? rec.pid : null,
    host: rec ? rec.host : (ref.host || null), record: rec, evidence: rec ? ['relayed record, last event ' + rec.last_event + ' at ' + rec.last_event_at] : ['no relayed record'] };
}

function heartbeatFresh(rec, cfg, now) {
  var last = Date.parse(rec.last_heartbeat_at || rec.last_event_at || rec.updated_at);
  if (isNaN(last)) return false;
  return (now - last) <= cfg.heartbeat_timeout_ms;
}

function getSessionState(ref, opts) {
  var cfg = config(opts);
  var now = (opts && opts.now) || Date.now();
  var obs = getSession(ref, opts);
  var evidence = obs.evidence.slice();
  if (!obs.record) return { state: 'UNKNOWN', evidence: evidence, last_activity_at: null, observation: obs, at: new Date(now).toISOString() };
  var rec = obs.record;
  var state;
  if (rec.state === 'CLOSED') { state = 'CLOSED'; evidence.push('PC agent confirmed closure at ' + rec.closed_at); }
  else if (!heartbeatFresh(rec, cfg, now)) { state = 'UNKNOWN'; evidence.push('relay heartbeat stale (> ' + Math.round(cfg.heartbeat_timeout_ms / 1000) + 's): PC state unverifiable'); }
  else if (rec.state === 'CLOSING') { state = 'CLOSING'; evidence.push('end announced, process exit not yet confirmed'); }
  else { state = rec.state; evidence.push('relayed state ' + rec.state); }
  return { state: state, evidence: evidence, last_activity_at: rec.last_activity_at || null, observation: obs, at: new Date(now).toISOString() };
}

function getLastActivity(ref, opts) {
  var obs = getSession(ref, opts);
  return obs.record ? (obs.record.last_activity_at || null) : null;
}

function registerExecution(exec, opts) {
  var cfg = config(opts);
  var msg = registry.writeOutbox(cfg.registry, 'PC', {
    kind: 'register_execution', execution_id: exec.execution_id, task_id: exec.task_id || null,
    correlation_id: exec.correlation_id || null, github_issue: exec.github_issue || null,
    expires_at: new Date(((opts && opts.now) || Date.now()) + cfg.close_request_ttl_ms).toISOString()
  });
  return { ok: true, location: 'PC', execution_id: exec.execution_id, request_id: msg.request_id };
}

function requestClose(ref, opts) {
  var cfg = config(opts);
  var now = (opts && opts.now) || Date.now();
  if (!(opts && opts.authorized === true)) return { ok: false, signalled: false, reason: 'not_authorized' };
  var obs = getSession(ref, opts);
  if (!obs.record) return { ok: false, signalled: false, reason: 'no_relayed_record' };
  if (obs.record.state === 'CLOSED') return { ok: false, signalled: false, reason: 'already_closed' };
  var force = !!(opts && opts.force === true);
  var policy = (opts && opts.policy) || {};
  if (force && policy.force_kill_enabled !== true) return { ok: false, signalled: false, reason: 'force_kill_disabled_by_policy' };
  if (force && !(opts && opts.force_confirmed === true)) return { ok: false, signalled: false, reason: 'force_not_confirmed' };
  var msg = registry.writeOutbox(cfg.registry, 'PC', {
    kind: force ? 'force_close_request' : 'close_request',
    session_id: obs.record.session_id, execution_id: obs.record.execution_id || null, pid: obs.record.pid || null,
    host: obs.record.host || null, reason: (opts && opts.reason) || 'lifecycle_cleanup',
    expires_at: new Date(now + cfg.close_request_ttl_ms).toISOString()
  });
  return { ok: true, signalled: true, signal: force ? 'force_close_request' : 'close_request', request_id: msg.request_id, session_id: obs.record.session_id, pid: obs.record.pid };
}

function verifyClosed(ref, opts) {
  var obs = getSession(ref, opts);
  if (!obs.record) return { closed: null, reason: 'no_relayed_record' };
  if (obs.record.state === 'CLOSED') return { closed: true, reason: 'pc_agent_confirmed', pid: obs.record.pid };
  var cfg = config(opts);
  if (!heartbeatFresh(obs.record, cfg, (opts && opts.now) || Date.now())) return { closed: null, reason: 'relay_stale' };
  return { closed: false, reason: 'relayed_state_' + obs.record.state, pid: obs.record.pid };
}

module.exports = {
  LOCATION: 'PC',
  DEFAULTS: DEFAULTS,
  config: config,
  register_execution: registerExecution,
  get_session: getSession,
  get_session_state: getSessionState,
  get_last_activity: getLastActivity,
  request_close: requestClose,
  verify_closed: verifyClosed
};
