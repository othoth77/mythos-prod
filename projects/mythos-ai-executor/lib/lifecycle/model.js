'use strict';
// =====================================================
// MYTHOS Execution Lifecycle — the model
// projects/mythos-ai-executor/lib/lifecycle/model.js
//
// Three vocabularies that are deliberately NOT one:
//
//   TASK       what is happening to the unit of work (GitHub is the truth)
//   EXECUTION  who is doing it, where, under which attempt
//   SESSION    whether the agent's conversation/process is still alive
//
// Relationship:
//
//   GitHub Issue ─▶ control task ─▶ execution_id ─▶ agent/provider ─▶ session_id ─▶ pid
//
// A GitHub REPORT is EVIDENCE that the task finished. It says nothing about
// the session: a session may outlive its report (Desktop Remote sessions do,
// every time) or die before it (a crash between "work done" and "report
// written"). The reducer below therefore never collapses REPORT_SUBMITTED
// into SESSION_CLOSED; the two are separate transitions driven by separate
// events, and "COMPLETED + session open" is a legitimate, first-class state.
//
// This module is PURE: no I/O, no clock of its own (every event carries
// `at`), so the daemon, the tests and any replay run the same code. Storage
// is registry.js; signals are the runtimes.
// =====================================================

var TASK_STATES = ['QUEUED', 'RUNNING', 'REPORT_SUBMITTED', 'VERIFICATION', 'COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'];
var TASK_TERMINAL = ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'];

var EXECUTION_STATES = ['CREATED', 'DISPATCHED', 'RUNNING', 'REPORTING', 'VERIFYING', 'FINISHED', 'FAILED', 'UNKNOWN'];
var EXECUTION_TERMINAL = ['FINISHED', 'FAILED'];
// "active" = a session attached to it must not be closed by anyone.
var EXECUTION_ACTIVE = ['CREATED', 'DISPATCHED', 'RUNNING', 'REPORTING'];

var SESSION_STATES = ['CREATED', 'RUNNING', 'IDLE', 'COMPLETED', 'CLOSING', 'CLOSED', 'ORPHANED', 'UNKNOWN'];
var SESSION_OPEN = ['CREATED', 'RUNNING', 'IDLE', 'COMPLETED', 'CLOSING', 'ORPHANED', 'UNKNOWN'];

// Cleanup phases (Phase 6). A session record carries exactly one.
var CLOSE_PHASES = ['OBSERVE', 'ELIGIBLE', 'GRACE', 'CLOSE_REQUESTED', 'VERIFYING', 'CLOSED', 'HUMAN_REVIEW'];

// Host classification for the operator view (Phase 9).
var HOST_CLASSES = ['ACTIVE', 'WAITING', 'COMPLETED', 'IDLE', 'ORPHANED', 'UNKNOWN'];

var LOCATIONS = ['VPS', 'PC'];

var EVENTS = [
  'EXECUTION_CREATED',
  'EXECUTION_DISPATCHED',
  'SESSION_STARTED',
  'TASK_STARTED',
  'SESSION_ACTIVITY',
  'SESSION_IDLE',
  'TASK_COMPLETED',
  'REPORT_SUBMITTED',
  'EXECUTION_VERIFIED',
  'SESSION_END',
  'SESSION_CLOSE_REQUESTED',
  'SESSION_CLOSED',
  'SESSION_CLOSE_FAILED',
  'SESSION_ORPHANED',
  'SESSION_UNKNOWN',
  'PROCESS_GONE',
  'EXECUTION_FAILED',
  'HEARTBEAT'
];

// Events that may arrive from OUTSIDE the host (a PC relay, an HTTP
// ingest). Everything else is produced by a local, trusted component. A
// relay can report what it observed; it can never request or confirm a
// close on this host's behalf — those are decisions, not observations.
var RELAY_EVENTS = [
  'SESSION_STARTED', 'TASK_STARTED', 'SESSION_ACTIVITY', 'SESSION_IDLE',
  'TASK_COMPLETED', 'SESSION_END', 'SESSION_CLOSED', 'PROCESS_GONE', 'HEARTBEAT'
];

var ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/; // uuid or provider-specific id

function isTaskTerminal(s) { return TASK_TERMINAL.indexOf(s) >= 0; }
function isExecutionActive(s) { return EXECUTION_ACTIVE.indexOf(s) >= 0; }
function isSessionOpen(s) { return SESSION_OPEN.indexOf(s) >= 0; }

function validId(v) { return typeof v === 'string' && ID_RE.test(v); }
function validSessionId(v) { return typeof v === 'string' && SESSION_ID_RE.test(v); }

function newExecution(event) {
  return {
    version: 1,
    execution_id: event.execution_id,
    task_id: event.task_id || null,
    correlation_id: event.correlation_id || null,
    github_issue: event.github_issue || null,
    github_pr: event.github_pr || null,
    github_report: null,
    agent: event.agent || null,
    provider: event.provider || null,
    location: event.location || null,
    host: event.host || null,
    session_id: event.session_id || null,
    pid: null,
    proc_start: null,
    cwd: event.cwd || null,
    started_at: null,
    created_at: event.at,
    last_activity_at: event.at,
    task_state: 'QUEUED',
    execution_state: 'CREATED',
    session_state: event.session_id ? 'CREATED' : 'CREATED',
    report_status: null,
    report_submitted_at: null,
    agent_completed_at: null,
    session_ended_at: null,
    session_closed_at: null,
    session_open_after_report: null,
    finished_at: null,
    last_event: event.type,
    last_event_at: event.at,
    close_reason: null,
    verification: { attempts: 0, next_check_at: null, last_checked_at: null, session_open: null, verified_at: null },
    updated_at: event.at
  };
}

function newSession(event) {
  return {
    version: 1,
    session_id: event.session_id,
    execution_id: event.execution_id || null,
    task_id: event.task_id || null,
    agent: event.agent || null,
    provider: event.provider || null,
    location: event.location || null,
    host: event.host || null,
    pid: event.pid || null,
    proc_start: event.proc_start || null,
    cwd: event.cwd || null,
    entrypoint: event.entrypoint || null,
    started_at: event.type === 'SESSION_STARTED' ? event.at : null,
    first_seen_at: event.at,
    last_activity_at: event.at,
    last_heartbeat_at: null,
    state: 'CREATED',
    stop_reason: null,
    ended_at: null,
    end_reason: null,
    closed_at: null,
    close_phase: 'OBSERVE',
    close_phase_since: event.at,
    close_reason: null,
    close_requested_at: null,
    close_attempts: 0,
    last_event: event.type,
    last_event_at: event.at,
    updated_at: event.at
  };
}

// One transition record — the audit answer to "why is this session still
// open?" and "why was it closed?". No secrets ever enter: only ids, states,
// the event name and a bounded reason string.
function transition(record, field, from, to, event, reason) {
  return {
    at: event.at,
    execution_id: record.execution_id || event.execution_id || null,
    session_id: record.session_id || event.session_id || null,
    task_id: record.task_id || event.task_id || null,
    event: event.type,
    event_id: event.event_id || null,
    field: field,
    previous_state: from,
    new_state: to,
    reason: String(reason || event.reason || '').slice(0, 300),
    source: event.source || null,
    location: record.location || event.location || null
  };
}

function setState(record, field, to, event, reason, out) {
  var from = record[field];
  if (from === to) return false;
  record[field] = to;
  out.push(transition(record, field, from, to, event, reason));
  return true;
}

// Task outcome from a report status. GitHub is the truth for the TASK.
function taskStateForReport(status) {
  var s = String(status || '').toUpperCase();
  if (s === 'COMPLETED' || s === 'COMPLETED_WITH_WARNINGS') return 'COMPLETED';
  if (s === 'FAILED') return 'FAILED';
  if (s === 'BLOCKED') return 'BLOCKED';
  if (s === 'CANCELLED') return 'CANCELLED';
  return 'COMPLETED';
}

// --- The reducer -------------------------------------------------------------
//
// applyToExecution(entry, event) -> { entry, transitions, noop }
// Idempotent by construction: re-applying an event that already had its
// effect produces no transition. Illegal orderings (a SESSION_END for an
// execution that never started) are recorded as UNKNOWN, never thrown.

function applyToExecution(entry, event) {
  var out = [];
  var e = entry;
  var t = event.type;
  var touched = false;

  function touch() { touched = true; e.last_event = t; e.last_event_at = event.at; e.updated_at = event.at; }

  switch (t) {
    case 'EXECUTION_CREATED':
      // Re-creation is a no-op except for filling blanks.
      ['task_id', 'correlation_id', 'github_issue', 'github_pr', 'agent', 'provider', 'location', 'host', 'cwd'].forEach(function (k) {
        if (e[k] == null && event[k] != null) { e[k] = event[k]; touched = true; }
      });
      if (touched) touch();
      break;

    case 'EXECUTION_DISPATCHED':
      if (e.execution_state === 'CREATED') { setState(e, 'execution_state', 'DISPATCHED', event, 'dispatched to ' + (event.location || e.location || 'runtime'), out); touch(); }
      break;

    case 'SESSION_STARTED':
      if (event.session_id && e.session_id !== event.session_id) {
        if (e.session_id) out.push(transition(e, 'session_id', e.session_id, event.session_id, event, 'session rotated (resume/recreate)'));
        e.session_id = event.session_id;
      }
      if (event.pid) e.pid = event.pid;
      if (event.proc_start) e.proc_start = event.proc_start;
      if (event.host) e.host = event.host;
      if (event.location) e.location = event.location;
      if (event.cwd && !e.cwd) e.cwd = event.cwd;
      if (!e.started_at) e.started_at = event.at;
      e.last_activity_at = event.at;
      setState(e, 'session_state', 'RUNNING', event, 'session started', out);
      if (!isTaskTerminal(e.task_state) && e.task_state !== 'VERIFICATION' && e.task_state !== 'REPORT_SUBMITTED') setState(e, 'task_state', 'RUNNING', event, 'session started', out);
      if (['CREATED', 'DISPATCHED', 'UNKNOWN'].indexOf(e.execution_state) >= 0) setState(e, 'execution_state', 'RUNNING', event, 'session started', out);
      touch();
      break;

    case 'TASK_STARTED':
      if (e.task_state === 'QUEUED') { setState(e, 'task_state', 'RUNNING', event, 'task started', out); touch(); }
      break;

    case 'SESSION_ACTIVITY':
    case 'HEARTBEAT':
      if (event.at > (e.last_activity_at || '') && t === 'SESSION_ACTIVITY') e.last_activity_at = event.at;
      if (t === 'HEARTBEAT') e.last_heartbeat_at = event.at;
      if (e.session_state === 'IDLE' && t === 'SESSION_ACTIVITY') setState(e, 'session_state', 'RUNNING', event, 'activity after idle', out);
      if (e.session_state === 'UNKNOWN' && t !== 'HEARTBEAT') setState(e, 'session_state', 'RUNNING', event, 'activity observed', out);
      touch();
      break;

    case 'SESSION_IDLE':
      if (e.session_state === 'RUNNING' || e.session_state === 'CREATED' || e.session_state === 'UNKNOWN') {
        setState(e, 'session_state', 'IDLE', event, event.stop_reason ? 'stop_reason=' + event.stop_reason : 'agent turn ended', out);
      }
      if (event.stop_reason) e.stop_reason = event.stop_reason;
      touch();
      break;

    case 'TASK_COMPLETED':
      // The AGENT says its work is done. Not the task's truth (GitHub), not
      // the session's (still running). Repeats are absorbed.
      if (!e.agent_completed_at) e.agent_completed_at = event.at;
      if (event.report_status && !e.report_status) e.report_status = event.report_status;
      if (['RUNNING', 'DISPATCHED', 'CREATED'].indexOf(e.execution_state) >= 0) setState(e, 'execution_state', 'REPORTING', event, 'agent reported completion; awaiting the GitHub report', out);
      touch();
      break;

    case 'REPORT_SUBMITTED':
      // Evidence, never a command. The task moves; the session does not.
      var firstReport = !e.report_submitted_at;
      if (firstReport) e.report_submitted_at = event.at;
      if (event.report_status) e.report_status = event.report_status;
      if (event.github_pr) e.github_pr = event.github_pr;
      if (event.github_issue && !e.github_issue) e.github_issue = event.github_issue;
      if (event.report_ref) e.github_report = event.report_ref;
      if (firstReport && !isTaskTerminal(e.task_state)) {
        setState(e, 'task_state', 'REPORT_SUBMITTED', event, 'report on GitHub', out);
        setState(e, 'task_state', 'VERIFICATION', event, 'verifying the session after the report', out);
      }
      if (!isExecutionTerminalState(e.execution_state)) setState(e, 'execution_state', 'VERIFYING', event, 'report submitted; session verification pending', out);
      if (e.verification && !e.verification.next_check_at && !e.verification.verified_at) e.verification.next_check_at = event.at;
      if (firstReport || out.length) touch();
      break;

    case 'EXECUTION_VERIFIED':
      // Produced by verify.js after it LOOKED at the session. Carries the
      // truth it found; the task's outcome comes from the report, the
      // execution's from the session.
      e.verification = e.verification || { attempts: 0 };
      e.verification.attempts = (e.verification.attempts || 0) + 1;
      e.verification.last_checked_at = event.at;
      e.verification.session_open = event.session_open === true;
      e.verification.session_state_observed = event.session_state || null;
      e.verification.next_check_at = event.next_check_at || null;
      if (e.task_state === 'VERIFICATION' || e.task_state === 'REPORT_SUBMITTED') {
        setState(e, 'task_state', taskStateForReport(event.report_status || e.report_status), event, 'task outcome from the GitHub report', out);
      }
      if (event.session_open === true) {
        e.session_open_after_report = true;
        if (event.session_state && SESSION_STATES.indexOf(event.session_state) >= 0 && e.session_state !== 'CLOSED') {
          setState(e, 'session_state', event.session_state, event, 'observed after report', out);
        }
        // execution stays VERIFYING: COMPLETED + SESSION_OPEN
      } else {
        if (e.session_open_after_report === null) e.session_open_after_report = false;
        e.verification.verified_at = event.at;
        e.verification.next_check_at = null;
        if (e.session_state !== 'CLOSED') setState(e, 'session_state', 'CLOSED', event, 'verified closed after report', out);
        if (!e.session_closed_at) e.session_closed_at = event.at;
        if (!isExecutionTerminalState(e.execution_state)) { setState(e, 'execution_state', 'FINISHED', event, 'report submitted and session closed', out); e.finished_at = event.at; }
      }
      touch();
      break;

    case 'SESSION_END':
      // The agent announced its end (hook SessionEnd / provider close). The
      // process may still be exiting: CLOSING until a process-gone proof
      // arrives, unless the event carries that proof itself.
      if (!e.session_ended_at) e.session_ended_at = event.at;
      if (event.end_reason) e.session_end_reason = event.end_reason;
      if (event.process_gone === true) {
        setState(e, 'session_state', 'CLOSED', event, 'session ended and process gone', out);
        if (!e.session_closed_at) e.session_closed_at = event.at;
      } else if (e.session_state !== 'CLOSED') {
        setState(e, 'session_state', 'CLOSING', event, 'session end announced; awaiting process exit', out);
      }
      finishIfSettled(e, event, out);
      touch();
      break;

    case 'SESSION_CLOSE_REQUESTED':
      if (e.session_state !== 'CLOSED') setState(e, 'session_state', 'CLOSING', event, 'close requested: ' + (event.reason || 'policy'), out);
      e.close_reason = event.reason || e.close_reason || 'policy';
      touch();
      break;

    case 'SESSION_CLOSED':
    case 'PROCESS_GONE':
      if (e.session_state !== 'CLOSED') setState(e, 'session_state', 'CLOSED', event, t === 'PROCESS_GONE' ? 'process disappeared' : 'session closed', out);
      if (!e.session_closed_at) e.session_closed_at = event.at;
      if (event.reason && !e.close_reason) e.close_reason = event.reason;
      if (t === 'PROCESS_GONE' && !isTaskTerminal(e.task_state) && e.task_state !== 'VERIFICATION' && !e.report_submitted_at) {
        // Died mid-work with no report: recovery (Phase 10) decides; until
        // then the execution is UNKNOWN, never silently FAILED.
        setState(e, 'execution_state', 'UNKNOWN', event, 'process gone before any report', out);
      }
      finishIfSettled(e, event, out);
      touch();
      break;

    case 'SESSION_CLOSE_FAILED':
      setState(e, 'session_state', 'UNKNOWN', event, 'close failed: ' + (event.reason || 'unknown'), out);
      touch();
      break;

    case 'SESSION_ORPHANED':
      if (e.session_state !== 'CLOSED') setState(e, 'session_state', 'ORPHANED', event, event.reason || 'parent gone', out);
      touch();
      break;

    case 'SESSION_UNKNOWN':
      if (e.session_state !== 'CLOSED') setState(e, 'session_state', 'UNKNOWN', event, event.reason || 'cannot be observed', out);
      touch();
      break;

    case 'EXECUTION_FAILED':
      if (!isExecutionTerminalState(e.execution_state)) { setState(e, 'execution_state', 'FAILED', event, event.reason || 'execution failed', out); e.finished_at = event.at; }
      if (!isTaskTerminal(e.task_state)) setState(e, 'task_state', event.task_state && TASK_TERMINAL.indexOf(event.task_state) >= 0 ? event.task_state : 'FAILED', event, event.reason || 'execution failed', out);
      touch();
      break;

    default:
      // Unknown event names are ignored, not applied: a relay cannot invent
      // a transition by inventing a name.
      break;
  }

  return { entry: e, transitions: out, noop: !touched && out.length === 0 };
}

function isExecutionTerminalState(s) { return EXECUTION_TERMINAL.indexOf(s) >= 0; }

// An execution is FINISHED when the task has its GitHub outcome AND the
// session is closed. Either alone is not enough.
function finishIfSettled(e, event, out) {
  if (e.session_state !== 'CLOSED') return;
  if (isExecutionTerminalState(e.execution_state)) return;
  if (e.task_state === 'VERIFICATION' || e.task_state === 'REPORT_SUBMITTED') {
    setState(e, 'task_state', taskStateForReport(e.report_status), event, 'task outcome from the GitHub report', out);
  }
  if (isTaskTerminal(e.task_state)) {
    setState(e, 'execution_state', 'FINISHED', event, 'task terminal and session closed', out);
    e.finished_at = event.at;
    if (e.verification) { e.verification.next_check_at = null; if (!e.verification.verified_at) e.verification.verified_at = event.at; }
  }
}

// --- Session records (independent of executions) -----------------------------
// Every session the system has heard of, linked or not. This is what lets
// the host view say UNKNOWN for a real ccd-cli process instead of ACTIVE.

function applyToSession(sess, event) {
  var out = [];
  var s = sess;
  var t = event.type;
  var touched = false;
  function touch() { touched = true; s.last_event = t; s.last_event_at = event.at; s.updated_at = event.at; }

  if (event.execution_id && !s.execution_id) { s.execution_id = event.execution_id; touched = true; }
  if (event.task_id && !s.task_id) { s.task_id = event.task_id; touched = true; }
  if (event.pid && s.pid !== event.pid) { s.pid = event.pid; touched = true; }
  if (event.proc_start && s.proc_start !== event.proc_start) { s.proc_start = event.proc_start; touched = true; }
  ['agent', 'provider', 'location', 'host', 'cwd', 'entrypoint'].forEach(function (k) { if (s[k] == null && event[k] != null) { s[k] = event[k]; touched = true; } });

  switch (t) {
    case 'SESSION_STARTED':
      if (!s.started_at) s.started_at = event.at;
      s.last_activity_at = event.at;
      if (s.state !== 'CLOSED') setState(s, 'state', 'RUNNING', event, 'session started', out);
      touch();
      break;
    case 'SESSION_ACTIVITY':
    case 'TASK_STARTED':
      if (event.at > (s.last_activity_at || '')) s.last_activity_at = event.at;
      if (['IDLE', 'UNKNOWN', 'CREATED', 'COMPLETED'].indexOf(s.state) >= 0) setState(s, 'state', 'RUNNING', event, 'activity', out);
      if (s.close_phase !== 'OBSERVE' && s.close_phase !== 'CLOSED' && s.close_phase !== 'HUMAN_REVIEW' && s.close_phase !== 'CLOSE_REQUESTED' && s.close_phase !== 'VERIFYING') {
        var prev = s.close_phase; s.close_phase = 'OBSERVE'; s.close_phase_since = event.at;
        out.push(transition(s, 'close_phase', prev, 'OBSERVE', event, 'activity resets eligibility'));
      }
      touch();
      break;
    case 'HEARTBEAT':
      s.last_heartbeat_at = event.at;
      touch();
      break;
    case 'SESSION_IDLE':
      if (event.stop_reason) s.stop_reason = event.stop_reason;
      if (['RUNNING', 'CREATED', 'UNKNOWN'].indexOf(s.state) >= 0) setState(s, 'state', 'IDLE', event, event.stop_reason ? 'stop_reason=' + event.stop_reason : 'turn ended', out);
      touch();
      break;
    case 'TASK_COMPLETED':
      if (['RUNNING', 'IDLE', 'CREATED', 'UNKNOWN'].indexOf(s.state) >= 0) setState(s, 'state', 'COMPLETED', event, 'agent reported completion', out);
      touch();
      break;
    case 'SESSION_END':
      if (!s.ended_at) s.ended_at = event.at;
      if (event.end_reason) s.end_reason = event.end_reason;
      if (event.process_gone === true) { setState(s, 'state', 'CLOSED', event, 'ended and process gone', out); if (!s.closed_at) s.closed_at = event.at; }
      else if (s.state !== 'CLOSED') setState(s, 'state', 'CLOSING', event, 'end announced', out);
      touch();
      break;
    case 'SESSION_CLOSE_REQUESTED':
      s.close_requested_at = event.at;
      s.close_attempts = (s.close_attempts || 0) + 1;
      s.close_reason = event.reason || s.close_reason || 'policy';
      if (s.state !== 'CLOSED') setState(s, 'state', 'CLOSING', event, 'close requested', out);
      touch();
      break;
    case 'SESSION_CLOSED':
    case 'PROCESS_GONE':
      if (s.state !== 'CLOSED') setState(s, 'state', 'CLOSED', event, t === 'PROCESS_GONE' ? 'process gone' : 'closed', out);
      if (!s.closed_at) s.closed_at = event.at;
      if (event.reason && !s.close_reason) s.close_reason = event.reason;
      if (s.close_phase !== 'CLOSED') { var p = s.close_phase; s.close_phase = 'CLOSED'; s.close_phase_since = event.at; out.push(transition(s, 'close_phase', p, 'CLOSED', event, 'session closed')); }
      touch();
      break;
    case 'SESSION_CLOSE_FAILED':
      setState(s, 'state', 'UNKNOWN', event, 'close failed', out);
      if (s.close_phase !== 'HUMAN_REVIEW') { var q = s.close_phase; s.close_phase = 'HUMAN_REVIEW'; s.close_phase_since = event.at; out.push(transition(s, 'close_phase', q, 'HUMAN_REVIEW', event, event.reason || 'close failed')); }
      touch();
      break;
    case 'SESSION_ORPHANED':
      if (s.state !== 'CLOSED') setState(s, 'state', 'ORPHANED', event, event.reason || 'parent gone', out);
      touch();
      break;
    case 'SESSION_UNKNOWN':
      if (s.state !== 'CLOSED') setState(s, 'state', 'UNKNOWN', event, event.reason || 'unobservable', out);
      touch();
      break;
    default:
      if (touched) touch();
      break;
  }
  return { session: s, transitions: out, noop: !touched && out.length === 0 };
}

// Close-phase transition helper used by cleanup.js (kept here so the phase
// vocabulary has one owner). Returns a transition record or null.
function setClosePhase(sess, to, event, reason) {
  if (CLOSE_PHASES.indexOf(to) < 0) throw new Error('UNKNOWN_CLOSE_PHASE: ' + to);
  var from = sess.close_phase;
  if (from === to) return null;
  sess.close_phase = to;
  sess.close_phase_since = event.at;
  sess.updated_at = event.at;
  return transition(sess, 'close_phase', from, to, event, reason);
}

module.exports = {
  TASK_STATES: TASK_STATES, TASK_TERMINAL: TASK_TERMINAL,
  EXECUTION_STATES: EXECUTION_STATES, EXECUTION_TERMINAL: EXECUTION_TERMINAL, EXECUTION_ACTIVE: EXECUTION_ACTIVE,
  SESSION_STATES: SESSION_STATES, SESSION_OPEN: SESSION_OPEN,
  CLOSE_PHASES: CLOSE_PHASES, HOST_CLASSES: HOST_CLASSES, LOCATIONS: LOCATIONS,
  EVENTS: EVENTS, RELAY_EVENTS: RELAY_EVENTS,
  ID_RE: ID_RE, UUID_RE: UUID_RE,
  validId: validId, validSessionId: validSessionId,
  isTaskTerminal: isTaskTerminal, isExecutionActive: isExecutionActive, isSessionOpen: isSessionOpen,
  isExecutionTerminalState: isExecutionTerminalState,
  taskStateForReport: taskStateForReport,
  newExecution: newExecution, newSession: newSession,
  applyToExecution: applyToExecution, applyToSession: applyToSession,
  setClosePhase: setClosePhase, transition: transition
};
