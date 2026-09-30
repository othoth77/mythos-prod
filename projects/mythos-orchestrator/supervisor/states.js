'use strict';
// =====================================================
// MYTHOS supervisor — task states and the ONLY legal transitions
// projects/mythos-orchestrator/supervisor/states.js
//
// A supervisor task moves through these states and nothing else:
//
//   PLANNED   objective recorded; OpenAI plan pending or plan ready, not dispatched
//   READY     dispatched to the bridge (GitHub Issue exists), not yet claimed
//   WAITING   the bridge/executor is waiting (retry back-off, report not yet
//             pushed by the relay) — not running, not failed
//   RUNNING   the bridge claimed it; FABLE is executing
//   VERIFYING a report says COMPLETED; OpenAI + deterministic checks decide
//   FAILED    execution failed, crashed, timed out, was rejected or verification
//             rejected it — a diagnosis is owed
//   RECOVERY  a child recovery task is active; this task waits for it
//   COMPLETED verified; the GitHub Issue is closed                  (terminal)
//   BLOCKED   a person is needed; exact reason recorded           (terminal
//             for automation — only an explicit human `resume` leaves it)
//
// Every change goes through transition(): an illegal move throws, so no
// code path can mutate state arbitrarily, and every move is recorded with
// its reason and actor in the task's own history.
// =====================================================

var STATES = ['PLANNED', 'READY', 'WAITING', 'RUNNING', 'VERIFYING', 'FAILED', 'RECOVERY', 'COMPLETED', 'BLOCKED'];

var TRANSITIONS = {
  PLANNED: ['READY', 'BLOCKED'],
  READY: ['RUNNING', 'WAITING', 'VERIFYING', 'FAILED', 'BLOCKED'],
  WAITING: ['RUNNING', 'READY', 'VERIFYING', 'FAILED', 'BLOCKED'],
  RUNNING: ['WAITING', 'VERIFYING', 'FAILED', 'BLOCKED'],
  // READY from VERIFYING: a parent resumed after a recovery whose evidence
  // does not yet satisfy the parent is re-dispatched (a new attempt).
  VERIFYING: ['COMPLETED', 'FAILED', 'BLOCKED', 'READY'],
  FAILED: ['RECOVERY', 'BLOCKED'],
  RECOVERY: ['VERIFYING', 'BLOCKED'],
  COMPLETED: [],
  // Human only (supervisor CLI `resume`), never automatic.
  BLOCKED: ['PLANNED']
};

var TERMINAL = ['COMPLETED', 'BLOCKED'];
var ACTIVE = STATES.filter(function (s) { return TERMINAL.indexOf(s) === -1; });

function isState(s) { return STATES.indexOf(s) !== -1; }

function canTransition(from, to) {
  return isState(from) && isState(to) && TRANSITIONS[from].indexOf(to) !== -1;
}

// Mutates `task`: status, updated_at and an appended history row.
// Throws ILLEGAL_TRANSITION rather than ever writing an unlisted move.
function transition(task, to, reason, actor) {
  var from = task.status;
  actor = actor || 'supervisor';
  if (!canTransition(from, to)) {
    var e = new Error('ILLEGAL_TRANSITION: ' + from + ' -> ' + to + ' (' + (reason || 'no reason') + ')');
    e.code = 'ILLEGAL_TRANSITION';
    throw e;
  }
  if (from === 'BLOCKED' && actor !== 'human') {
    var h = new Error('ILLEGAL_TRANSITION: only a person may resume a BLOCKED task');
    h.code = 'ILLEGAL_TRANSITION';
    throw h;
  }
  var at = new Date().toISOString();
  task.status = to;
  task.updated_at = at;
  task.history = task.history || [];
  task.history.push({ from: from, to: to, at: at, reason: String(reason || '').slice(0, 500), actor: actor });
  return task;
}

module.exports = {
  STATES: STATES,
  TRANSITIONS: TRANSITIONS,
  TERMINAL: TERMINAL,
  ACTIVE: ACTIVE,
  isState: isState,
  canTransition: canTransition,
  transition: transition
};
