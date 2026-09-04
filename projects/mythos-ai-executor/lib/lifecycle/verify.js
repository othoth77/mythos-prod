'use strict';
// =====================================================
// MYTHOS Execution Lifecycle — post-completion session verification (Phase 5)
// projects/mythos-ai-executor/lib/lifecycle/verify.js
//
// When a GitHub REPORT lands (REPORT_SUBMITTED), the task has its outcome
// but the execution is only VERIFYING: we do not know whether the agent's
// session is still alive. This module looks — through the runtime that
// owns the session's location — and records what it found as an
// EXECUTION_VERIFIED event:
//
//   session closed          → execution FINISHED   (COMPLETED + SESSION_CLOSED)
//   session still open      → execution VERIFYING  (COMPLETED + SESSION_OPEN), re-check later
//   session unobservable    → treated as OPEN (fail-closed: we cannot prove it is gone)
//
// Re-checks follow a bounded exponential backoff and never a busy loop:
// 1m, 2m, 5m, 15m, 30m, then hourly. After `attention_after` attempts the
// record is flagged for a human — it is not closed, not failed, not
// forgotten. Idempotent: the event id is derived from the attempt number,
// so a tick replayed twice produces one verification.
//
// Verification OBSERVES. It never closes a session; cleanup.js decides
// that, separately, with its own fences.
// =====================================================

var registry = require('./registry');
var model = require('./model');

var BACKOFF_SECONDS = [60, 120, 300, 900, 1800, 3600];
var DEFAULTS = { attention_after: 24, max_per_tick: 10 };

function nextDelaySeconds(attempts) {
  var i = Math.min(Math.max(attempts, 0), BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[i];
}

function due(reg, now) {
  return registry.listExecutions(reg).filter(function (e) {
    if (e.execution_state !== 'VERIFYING') return false;
    var v = e.verification || {};
    if (!v.next_check_at) return true;
    var t = Date.parse(v.next_check_at);
    return isNaN(t) || t <= now;
  }).sort(function (a, b) { return String(a.verification && a.verification.next_check_at || '').localeCompare(String(b.verification && b.verification.next_check_at || '')); });
}

// runtimes: { VPS: runtime, PC: runtime }; runtimeOpts: { VPS: {...}, PC: {...} }
function verifyOne(reg, exec, runtimes, runtimeOpts, now, opts) {
  opts = opts || {};
  var loc = exec.location || 'VPS';
  var rt = runtimes[loc];
  var attempts = (exec.verification && exec.verification.attempts) || 0;
  var evidence = [];
  var observed = { state: 'UNKNOWN', evidence: ['no runtime for location ' + loc], last_activity_at: null };
  if (exec.session_state === 'CLOSED' && exec.session_closed_at) {
    // Proof already on record (a headless child's exit observed by the
    // executor, a PC agent's process-gone confirmation): the session cannot
    // be re-observed alive, and looking would only find a recycled pid.
    observed = { state: 'CLOSED', evidence: ['registry: session closed at ' + exec.session_closed_at + ' (' + (exec.session_end_reason || exec.close_reason || 'proof recorded') + ')'], last_activity_at: null };
  } else if (rt) {
    try {
      observed = rt.get_session_state({ session_id: exec.session_id, pid: exec.pid, proc_start: exec.proc_start, host: exec.host,
        executor_status: opts.executor_status || null }, Object.assign({ now: now }, runtimeOpts[loc] || {}));
    } catch (e) { observed = { state: 'UNKNOWN', evidence: ['runtime error: ' + String(e && e.message).slice(0, 120)], last_activity_at: null }; }
  }
  evidence = evidence.concat(observed.evidence || []);

  // Is this session ALSO attached to another, still-active execution?
  var shared = exec.session_id ? registry.executionsForSession(reg, exec.session_id).filter(function (o) {
    return o.execution_id !== exec.execution_id && model.isExecutionActive(o.execution_state);
  }) : [];
  if (shared.length) evidence.push('session shared with active execution(s): ' + shared.map(function (s) { return s.execution_id; }).join(','));

  var closed = observed.state === 'CLOSED';
  var sessionOpen = !closed; // UNKNOWN counts as open: no proof of absence
  var next = null;
  if (sessionOpen) next = new Date(now + nextDelaySeconds(attempts) * 1000).toISOString();

  var ev = {
    type: 'EXECUTION_VERIFIED', execution_id: exec.execution_id, task_id: exec.task_id || null, session_id: exec.session_id || null,
    at: new Date(now).toISOString(), source: 'verify', event_id: 'verify:' + exec.execution_id + ':' + (attempts + 1),
    session_open: sessionOpen, session_state: observed.state, report_status: exec.report_status || null,
    next_check_at: next, reason: sessionOpen ? 'session ' + observed.state + ' after report' : 'session closed after report',
    evidence: { attempt: attempts + 1, observed: observed.state, shared_active: shared.length, note: evidence.slice(0, 3).join(' | ').slice(0, 200) }
  };
  var r = registry.ingest(reg, ev);
  var updated = registry.getExecution(reg, exec.execution_id) || exec;
  if (sessionOpen && attempts + 1 >= (opts.attention_after || DEFAULTS.attention_after) && !updated.verification.attention) {
    updated.verification.attention = true;
    updated.verification.attention_reason = 'session still ' + observed.state + ' after ' + (attempts + 1) + ' checks';
    registry.putExecution(reg, updated);
    registry.appendLedger(reg, [{ at: new Date(now).toISOString(), kind: 'attention', execution_id: exec.execution_id, session_id: exec.session_id || null, task_id: exec.task_id || null, reason: updated.verification.attention_reason }]);
  }
  return { execution_id: exec.execution_id, session_id: exec.session_id || null, session_open: sessionOpen, observed: observed.state,
    next_check_at: next, duplicate: r.duplicate === true, shared_active: shared.length, evidence: evidence, transitions: r.transitions || [] };
}

function run(reg, runtimes, runtimeOpts, opts) {
  opts = opts || {};
  var now = opts.now || Date.now();
  var list = due(reg, now).slice(0, opts.max_per_tick || DEFAULTS.max_per_tick);
  var statuses = opts.executor_statuses || {};
  return {
    at: new Date(now).toISOString(),
    checked: list.map(function (e) { return verifyOne(reg, e, runtimes, runtimeOpts, now, Object.assign({}, opts, { executor_status: e.task_id ? statuses[e.task_id] : null })); })
  };
}

module.exports = { BACKOFF_SECONDS: BACKOFF_SECONDS, DEFAULTS: DEFAULTS, nextDelaySeconds: nextDelaySeconds, due: due, verifyOne: verifyOne, run: run };
