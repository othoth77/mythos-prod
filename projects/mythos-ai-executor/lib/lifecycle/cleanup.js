'use strict';
// =====================================================
// MYTHOS Execution Lifecycle — lifecycle-aware safe cleanup (Phase 6)
// projects/mythos-ai-executor/lib/lifecycle/cleanup.js
//
// NOT "age > X → kill". A session becomes eligible for a close only when
// ALL of the following hold, on the same tick, from the registry and the
// runtime — never from a process list alone:
//
//   1. the session is bound to at least one execution                (linked)
//   2. NO execution bound to it is still active                      (no active execution)
//   3. the execution it belongs to has its GitHub report              (task completed)
//   4. the runtime observes the session IDLE / COMPLETED / ORPHANED   (not mid-turn, not unknown)
//   5. no activity for `idle_seconds`                                  (no recent activity)
//   6. the session is at least `min_session_age_seconds` old
//
// Phases, one per tick at most, every step written to the ledger:
//
//   OBSERVE → ELIGIBLE → GRACE → CLOSE_REQUESTED → VERIFYING → CLOSED
//                                              ╰──── failure ────▶ HUMAN_REVIEW
//
// Any activity, any new active execution, or any doubt drops the session
// back to OBSERVE. The close signal is the runtime's SAFE one (SIGTERM on
// the VPS; a close request in the PC agent's outbox). Force kill is:
//   disabled by default (policy.force_kill_enabled=false), a separate
//   explicit call (forceClose) that requires HUMAN_REVIEW phase, the
//   enforcement marker, and a confirmation flag — and it is audited.
//
// Dry-run by default: without enforcement the phases advance up to GRACE
// and stop, recording what WOULD happen. This is what makes the tick safe
// to run before the owner decides to enforce.
//
// Executor-owned `claude -p` sessions are never closed here: the executor
// owns their lifetime (timeout + SIGTERM/SIGKILL of its own child).
// =====================================================

var registry = require('./registry');
var model = require('./model');

var POLICY = {
  enabled: false,                    // enforcement; observe-only otherwise
  idle_seconds: 1800,                // no activity for 30 min
  grace_seconds: 600,                // stay eligible for 10 min before a close is requested
  min_session_age_seconds: 900,
  close_verify_timeout_seconds: 300, // wait this long for the process to go after a request
  max_close_attempts: 2,             // safe-signal attempts before HUMAN_REVIEW
  max_closes_per_run: 2,             // blast radius per tick
  force_kill_enabled: false          // the last resort, off unless the owner says otherwise
};

function policy(opts) {
  var p = {};
  Object.keys(POLICY).forEach(function (k) { p[k] = POLICY[k]; });
  Object.keys(opts || {}).forEach(function (k) { if (opts[k] !== undefined && POLICY.hasOwnProperty(k)) p[k] = opts[k]; });
  return p;
}

function sec(a, b) { var x = Date.parse(a), y = Date.parse(b); return (isNaN(x) || isNaN(y)) ? null : Math.round((y - x) / 1000); }

// Pure: (session record, its executions, the runtime observation, now, policy) -> decision
function evaluate(sess, execs, observed, now, pol) {
  var nowIso = new Date(now).toISOString();
  var vetoes = [];
  if (!execs.length) vetoes.push('unlinked_session');
  var active = execs.filter(function (e) { return model.isExecutionActive(e.execution_state); });
  if (active.length) vetoes.push('active_execution:' + active.map(function (e) { return e.execution_id; }).join(','));
  var own = execs.filter(function (e) { return e.session_id === sess.session_id; });
  var reported = own.filter(function (e) { return !!e.report_submitted_at || model.isTaskTerminal(e.task_state); });
  if (execs.length && !reported.length) vetoes.push('no_report_for_own_execution');
  var unfinishedTask = own.filter(function (e) { return !model.isTaskTerminal(e.task_state) && e.task_state !== 'VERIFICATION'; });
  if (unfinishedTask.length) vetoes.push('task_not_terminal:' + unfinishedTask.map(function (e) { return e.execution_id; }).join(','));

  var st = observed ? observed.state : 'UNKNOWN';
  if (st === 'RUNNING' || st === 'CLOSING') vetoes.push('session_' + st.toLowerCase());
  if (st === 'UNKNOWN') vetoes.push('session_unobservable');
  if (st === 'CLOSED') vetoes.push('already_closed');

  var lastAct = sess.last_activity_at;
  if (observed && observed.last_activity_at && (!lastAct || observed.last_activity_at > lastAct)) lastAct = observed.last_activity_at;
  var idle = lastAct ? sec(lastAct, nowIso) : null;
  if (idle === null) vetoes.push('activity_unknown');
  else if (idle < pol.idle_seconds) vetoes.push('recent_activity');

  var age = sess.started_at ? sec(sess.started_at, nowIso) : (sess.first_seen_at ? sec(sess.first_seen_at, nowIso) : null);
  if (age === null || age < pol.min_session_age_seconds) vetoes.push('below_min_age');

  if (observed && observed.observation && observed.observation.process && observed.observation.process.kind === 'executor') vetoes.push('executor_owned_session');

  return { eligible: vetoes.length === 0, vetoes: vetoes, idle_seconds: idle, age_seconds: age, observed_state: st, executions: execs.map(function (e) { return e.execution_id; }) };
}

// One tick over every open, linked session. `enforcement` is the operator
// marker decision (index.js); without it nothing past GRACE happens.
// runtimes/runtimeOpts as in verify.js. killFn injectable for tests.
function run(reg, runtimes, runtimeOpts, opts, killFn) {
  opts = opts || {};
  var now = opts.now || Date.now();
  var nowIso = new Date(now).toISOString();
  var pol = policy(opts.policy);
  var enforce = !!(opts.enforcement && opts.enforcement.enabled) && pol.enabled === true;
  var actions = [];
  var vetoes = [];
  var closes = 0;

  var sessions = registry.listSessions(reg).filter(function (s) { return s.state !== 'CLOSED' && s.close_phase !== 'CLOSED'; });
  sessions.forEach(function (sess) {
    var loc = sess.location || 'VPS';
    var rt = runtimes[loc];
    var execs = registry.executionsForSession(reg, sess.session_id);
    if (!execs.length && sess.execution_id) { var e1 = registry.getExecution(reg, sess.execution_id); if (e1) execs = [e1]; }
    var observed = null;
    if (rt) {
      try { observed = rt.get_session_state({ session_id: sess.session_id, pid: sess.pid, proc_start: sess.proc_start, host: sess.host }, Object.assign({ now: now }, runtimeOpts[loc] || {})); }
      catch (e) { observed = { state: 'UNKNOWN', evidence: ['runtime error'], last_activity_at: null }; }
    }
    // A session whose process is provably gone is closed regardless of phase.
    if (observed && observed.state === 'CLOSED' && sess.state !== 'CLOSED') {
      var requested = sess.close_phase === 'CLOSE_REQUESTED' || sess.close_phase === 'VERIFYING';
      registry.ingest(reg, { type: requested ? 'SESSION_CLOSED' : 'PROCESS_GONE', session_id: sess.session_id, execution_id: sess.execution_id || undefined, at: nowIso, source: 'cleanup',
        event_id: (requested ? 'closed:' : 'gone:') + sess.session_id + ':' + (sess.pid || 0) + ':' + (sess.proc_start || 0),
        reason: requested ? 'lifecycle_cleanup:' + (sess.close_reason || 'policy') : ((observed.evidence || [])[0] || 'process gone'),
        evidence: { verify: (observed.evidence || [])[0] || null } });
      actions.push({ session_id: sess.session_id, action: requested ? 'closed' : 'observed_closed', phase_from: sess.close_phase, phase_to: 'CLOSED', verify: (observed.evidence || [])[0] || null });
      return;
    }
    if (observed && observed.state === 'ORPHANED' && sess.state !== 'ORPHANED') {
      registry.ingest(reg, { type: 'SESSION_ORPHANED', session_id: sess.session_id, at: nowIso, source: 'cleanup', event_id: 'orphan:' + sess.session_id + ':' + nowIso.slice(0, 16), reason: 'runtime observed reparented process' });
    }

    var d = evaluate(sess, execs, observed, now, pol);
    var phase = sess.close_phase || 'OBSERVE';
    var fresh = registry.getSession(reg, sess.session_id) || sess;
    var event = { type: 'cleanup', at: nowIso, source: 'cleanup' };
    var lines = [];

    function setPhase(to, reason) {
      var t = model.setClosePhase(fresh, to, event, reason);
      if (t) { lines.push(Object.assign({ kind: 'transition' }, t)); actions.push({ session_id: sess.session_id, action: 'phase', phase_from: phase, phase_to: to, reason: reason, execution_id: fresh.execution_id }); }
      phase = to;
    }

    if (phase === 'HUMAN_REVIEW') {
      vetoes.push({ session_id: sess.session_id, phase: phase, reason: 'awaiting_human_review' });
    } else if (phase === 'CLOSE_REQUESTED' || phase === 'VERIFYING') {
      // We asked; did it go?
      var vc = rt ? rt.verify_closed({ session_id: sess.session_id, pid: sess.pid, proc_start: sess.proc_start, host: sess.host }, Object.assign({ now: now }, runtimeOpts[loc] || {})) : { closed: null, reason: 'no_runtime' };
      if (vc.closed === true) {
        registry.ingest(reg, { type: 'SESSION_CLOSED', session_id: sess.session_id, execution_id: sess.execution_id || undefined, at: nowIso, source: 'cleanup', reason: 'lifecycle_cleanup:' + (fresh.close_reason || 'policy'), event_id: 'closed:' + sess.session_id + ':' + (sess.close_attempts || 0), evidence: { verify: vc.reason } });
        actions.push({ session_id: sess.session_id, action: 'closed', phase_from: phase, phase_to: 'CLOSED', verify: vc.reason });
        return;
      }
      if (phase === 'CLOSE_REQUESTED') setPhase('VERIFYING', 'close requested; awaiting exit');
      var waited = fresh.close_requested_at ? sec(fresh.close_requested_at, nowIso) : 0;
      if (waited !== null && waited >= pol.close_verify_timeout_seconds) {
        if ((fresh.close_attempts || 0) < pol.max_close_attempts && enforce && closes < pol.max_closes_per_run) {
          var again = rt.request_close({ session_id: sess.session_id, pid: sess.pid, proc_start: sess.proc_start, host: sess.host }, Object.assign({ now: now, authorized: true, policy: pol, reason: fresh.close_reason || 'lifecycle_cleanup' }, runtimeOpts[loc] || {}), killFn);
          closes++;
          registry.ingest(reg, { type: again.signalled ? 'SESSION_CLOSE_REQUESTED' : 'SESSION_CLOSE_FAILED', session_id: sess.session_id, execution_id: sess.execution_id || undefined, at: nowIso, source: 'cleanup',
            reason: again.signalled ? ('retry ' + again.signal) : again.reason, event_id: 'close:' + sess.session_id + ':' + ((fresh.close_attempts || 0) + 1), evidence: { attempt: (fresh.close_attempts || 0) + 1, signal: again.signal || null } });
          actions.push({ session_id: sess.session_id, action: again.signalled ? 'close_retry' : 'close_failed', detail: again.reason || again.signal });
          if (!again.signalled) return;
          fresh = registry.getSession(reg, sess.session_id) || fresh;
          fresh.close_phase = 'CLOSE_REQUESTED'; fresh.close_phase_since = nowIso; fresh.updated_at = nowIso;
          registry.putSession(reg, fresh);
          return;
        }
        registry.ingest(reg, { type: 'SESSION_CLOSE_FAILED', session_id: sess.session_id, execution_id: sess.execution_id || undefined, at: nowIso, source: 'cleanup',
          reason: 'still present ' + waited + 's after ' + (fresh.close_attempts || 0) + ' close request(s)', event_id: 'closefail:' + sess.session_id + ':' + (fresh.close_attempts || 0) });
        actions.push({ session_id: sess.session_id, action: 'human_review', reason: 'close_failed' });
        return;
      }
      vetoes.push({ session_id: sess.session_id, phase: phase, reason: 'awaiting_exit', waited_seconds: waited });
      if (lines.length) { registry.putSession(reg, fresh); registry.appendLedger(reg, lines); }
    } else if (!d.eligible) {
      if (phase !== 'OBSERVE') setPhase('OBSERVE', 'no longer eligible: ' + d.vetoes.join(','));
      vetoes.push({ session_id: sess.session_id, phase: phase, reason: d.vetoes.join(','), idle_seconds: d.idle_seconds, observed: d.observed_state });
      if (lines.length) { registry.putSession(reg, fresh); registry.appendLedger(reg, lines); }
    } else if (phase === 'OBSERVE') {
      setPhase('ELIGIBLE', 'task completed, report on GitHub, no active execution, session ' + d.observed_state + ', idle ' + d.idle_seconds + 's');
      registry.putSession(reg, fresh); registry.appendLedger(reg, lines);
    } else if (phase === 'ELIGIBLE') {
      setPhase('GRACE', 'still eligible; grace ' + pol.grace_seconds + 's begins');
      registry.putSession(reg, fresh); registry.appendLedger(reg, lines);
    } else if (phase === 'GRACE') {
      var inGrace = fresh.close_phase_since ? sec(fresh.close_phase_since, nowIso) : 0;
      if (inGrace < pol.grace_seconds) {
        vetoes.push({ session_id: sess.session_id, phase: phase, reason: 'grace_not_elapsed', remaining_seconds: pol.grace_seconds - inGrace });
      } else if (!enforce) {
        vetoes.push({ session_id: sess.session_id, phase: phase, reason: 'dry_run', would: 'request_close', execution_id: fresh.execution_id, idle_seconds: d.idle_seconds });
      } else if (closes >= pol.max_closes_per_run) {
        vetoes.push({ session_id: sess.session_id, phase: phase, reason: 'max_closes_per_run' });
      } else {
        var res = rt ? rt.request_close({ session_id: sess.session_id, pid: sess.pid, proc_start: sess.proc_start, host: sess.host }, Object.assign({ now: now, authorized: true, policy: pol, reason: 'lifecycle_cleanup' }, runtimeOpts[loc] || {}), killFn) : { ok: false, signalled: false, reason: 'no_runtime' };
        closes++;
        if (res.signalled) {
          registry.ingest(reg, { type: 'SESSION_CLOSE_REQUESTED', session_id: sess.session_id, execution_id: sess.execution_id || undefined, at: nowIso, source: 'cleanup', reason: 'lifecycle_cleanup', event_id: 'close:' + sess.session_id + ':1', evidence: { signal: res.signal, pid: res.pid || null, idle_seconds: d.idle_seconds, executions: d.executions.join(',') } });
          fresh = registry.getSession(reg, sess.session_id) || fresh;
          var t2 = model.setClosePhase(fresh, 'CLOSE_REQUESTED', event, 'safe close signal ' + res.signal + ' sent');
          registry.putSession(reg, fresh);
          if (t2) registry.appendLedger(reg, [Object.assign({ kind: 'transition' }, t2)]);
          actions.push({ session_id: sess.session_id, action: 'close_requested', signal: res.signal, pid: res.pid || null, execution_id: fresh.execution_id });
        } else if (['process_absent', 'process_gone', 'pid_recycled'].indexOf(res.reason) >= 0) {
          // Raced its own exit between observation and signal: that is a
          // closure, not a failure.
          registry.ingest(reg, { type: 'PROCESS_GONE', session_id: sess.session_id, execution_id: sess.execution_id || undefined, at: nowIso, source: 'cleanup', reason: res.reason, event_id: 'gone:' + sess.session_id + ':' + (sess.pid || 0) + ':' + (sess.proc_start || 0) });
          actions.push({ session_id: sess.session_id, action: 'observed_closed', phase_from: phase, phase_to: 'CLOSED', reason: res.reason });
        } else {
          registry.ingest(reg, { type: 'SESSION_CLOSE_FAILED', session_id: sess.session_id, execution_id: sess.execution_id || undefined, at: nowIso, source: 'cleanup', reason: res.reason, event_id: 'closefail:' + sess.session_id + ':0' });
          actions.push({ session_id: sess.session_id, action: 'close_failed', reason: res.reason });
        }
      }
    }
  });

  return { at: nowIso, enforce: enforce, dry_run: !enforce, policy: pol, actions: actions, vetoes: vetoes, sessions_considered: sessions.length };
}

// The explicit, audited last resort. Refuses unless every gate is open.
function forceClose(reg, runtimes, runtimeOpts, sessionId, opts, killFn) {
  opts = opts || {};
  var now = opts.now || Date.now();
  var nowIso = new Date(now).toISOString();
  var pol = policy(opts.policy);
  var sess = registry.getSession(reg, sessionId);
  var refuse = function (why) {
    registry.appendLedger(reg, [{ at: nowIso, kind: 'force_close_refused', session_id: sessionId, reason: why, operator: opts.operator || null }]);
    return { ok: false, reason: why };
  };
  if (!sess) return refuse('no_such_session');
  if (pol.force_kill_enabled !== true) return refuse('force_kill_disabled_by_policy');
  if (!(opts.enforcement && opts.enforcement.enabled)) return refuse('enforcement_not_enabled');
  if (sess.close_phase !== 'HUMAN_REVIEW') return refuse('phase_not_human_review:' + sess.close_phase);
  if (opts.confirm !== true) return refuse('not_confirmed');
  var execs = registry.executionsForSession(reg, sessionId);
  if (execs.some(function (e) { return model.isExecutionActive(e.execution_state); })) return refuse('active_execution');
  var loc = sess.location || 'VPS';
  var rt = runtimes[loc];
  if (!rt) return refuse('no_runtime');
  var res = rt.request_close({ session_id: sessionId, pid: sess.pid, proc_start: sess.proc_start, host: sess.host },
    Object.assign({ now: now, authorized: true, force: true, force_confirmed: true, policy: pol, reason: 'force_close:' + (opts.reason || 'operator') }, runtimeOpts[loc] || {}), killFn);
  registry.appendLedger(reg, [{ at: nowIso, kind: 'force_close', session_id: sessionId, execution_id: sess.execution_id || null, operator: opts.operator || null, result: res.signalled ? res.signal : res.reason, pid: sess.pid || null }]);
  if (res.signalled) {
    registry.ingest(reg, { type: 'SESSION_CLOSE_REQUESTED', session_id: sessionId, execution_id: sess.execution_id || undefined, at: nowIso, source: 'force', reason: 'force_close:' + (opts.reason || 'operator'), event_id: 'force:' + sessionId + ':' + nowIso });
    var fresh = registry.getSession(reg, sessionId);
    var t = model.setClosePhase(fresh, 'CLOSE_REQUESTED', { at: nowIso, type: 'force_close', source: 'force' }, 'force close by operator');
    registry.putSession(reg, fresh);
    if (t) registry.appendLedger(reg, [Object.assign({ kind: 'transition' }, t)]);
  }
  return { ok: res.signalled, reason: res.reason || null, signal: res.signal || null };
}

module.exports = { POLICY: POLICY, policy: policy, evaluate: evaluate, run: run, forceClose: forceClose };
