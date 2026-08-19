'use strict';
/* =====================================================
   MYTHOS OS COMMAND CENTER — operator audit log (MOS-v2 M-07)
   projects/mythos-os-console/reference/audit.js

   Before this stage the console could start, cancel and dispatch real
   executor missions, and sign an operator in and out, and leave NO
   record that any of it happened. The executor keeps its own task
   events, but they begin at task creation: a refused repo-write, a
   throttled sign-in, a mission rejected at validation and an
   unauthenticated write attempt all left the deployment with nothing to
   read afterwards. That is a governance gap, not a missing feature —
   "who did what, when, and was it allowed" is the first question asked
   after an incident.

   One append-only line of JSON per state-changing action, on stdout, so
   it lands in the journal alongside the startup line and needs no file,
   no rotation policy and no second storage system. There is no reader
   here and no query surface: this module writes, and journalctl reads.

   WHAT IT REFUSES TO WRITE IS THE DESIGN.

     · NEVER a password. No call site passes one and no field could
       carry one: `detail` is filtered against DETAIL_FIELDS below, so a
       future caller that hands this module a credential-shaped key
       writes nothing rather than logging it.
     · NEVER a session identifier in full. An actor is recorded as
       'sess:' plus the first eight hex characters — enough to correlate
       two actions as the same sign-in, far too little to replay one.
       An action with no session is recorded as 'unauthenticated'.
     · NEVER instruction or title text. A mission instruction is
       operator-authored free text that may quote anything the operator
       was looking at; it belongs in the executor's task envelope, not
       in a log line the journal keeps for weeks. `instruction` and
       `title` are simply not in DETAIL_FIELDS, so passing them is a
       no-op rather than a leak.

   The allowlist is the mechanism, not a convention on top of one, for
   the same reason STATIC and PUBLIC_PATHS in server.js are whitelists:
   a field that must never be logged cannot be logged by accident.
   ===================================================== */

// Every key this module will ever serialise inside `detail`. Anything
// else a caller passes is dropped silently -- the log saying less than
// the caller offered is the safe direction.
// MOS-v2 M-09 adds two: `granted` (the boolean verdict an operator gave a
// proposed plan) and `approval_id` (WHICH decision they answered). The
// goal's own objective text is deliberately NOT here, for the same reason
// `instruction` and `title` are not: it is operator-authored free text.
// "Who approved which plan, and did they say yes" is the record; what the
// plan said is in the executor's own campaign file.
// MOS-v2 M-10 adds one more: `decompose`, the boolean recording whether a
// goal asked for its plan to be written by a planner model. WHICH plan the
// model proposed is not log material -- that is in the executor's campaign
// file, where the operator reviewed it. Whether an AI wrote the plan an
// operator then approved is.
// MOS-v2 M-11 adds `routed`: whether an auto-routed mission's provider was
// chosen by core/provider-router.js rather than named by the operator. The
// router's OWN reason text is never here -- `reason` already carries only
// this file's own short refusal codes, same discipline as everywhere else.
var DETAIL_FIELDS = ['profile', 'provider', 'model', 'priority', 'status', 'reason', 'route',
                     'granted', 'approval_id', 'decompose', 'routed'];

// A detail value is a short scalar or it is nothing. Objects, arrays and
// long strings are not log material; truncation is at 64 characters,
// which fits every value the call sites actually pass (a profile name, a
// provider name, a model id, a status word, a reason code).
var MAX_VALUE = 64;

function scalar(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v !== 'string') return null;
  return v.slice(0, MAX_VALUE);
}

/* A session identifier is 64 hex characters (auth.js). Eight of them
   identify a sign-in across several actions without being a credential:
   the remaining 224 bits are not in the journal, so a leaked log is not
   a set of session cookies. Anything that is not a well-formed
   identifier -- including no session at all -- is recorded as
   'unauthenticated' rather than echoed. */
function actorOf(sessionId) {
  if (typeof sessionId !== 'string' || !/^[0-9a-f]{64}$/.test(sessionId)) return 'unauthenticated';
  return 'sess:' + sessionId.slice(0, 8);
}

/* The task id alphabet is the one server.js's route regexes already
   enforce ([a-z0-9-], 8-64 characters), so a logged task id cannot
   carry a newline, a quote or anything else that would forge a second
   log line. Re-checked here rather than assumed, because this module is
   the last thing between a value and the journal. */
function taskIdOf(taskId) {
  if (typeof taskId !== 'string' || !/^[a-z0-9][a-z0-9-]{6,62}[a-z0-9]$/.test(taskId)) return null;
  return taskId;
}

function detailOf(detail) {
  var out = null;
  if (detail && typeof detail === 'object') {
    DETAIL_FIELDS.forEach(function (f) {
      if (!Object.prototype.hasOwnProperty.call(detail, f)) return;
      var v = scalar(detail[f]);
      if (v === null) return;
      if (!out) out = {};
      out[f] = v;
    });
  }
  return out;
}

/* Build the line without writing it. Exported so the shape can be
   asserted directly, and so `record` stays a one-liner whose only job
   is the write itself. */
function line(entry) {
  entry = entry || {};
  return {
    ts: new Date().toISOString(),
    log: 'mos.audit',
    action: scalar(entry.action) || 'unknown',
    outcome: scalar(entry.outcome) || 'unknown',
    actor: actorOf(entry.actor),
    task_id: taskIdOf(entry.task_id),
    detail: detailOf(entry.detail)
  };
}

/* One line, one write, never throws. An audit log that can crash the
   request it is describing is worse than none: the write is wrapped so
   a broken stdout (a closed pipe, a full disk) costs the record and not
   the operator's mission. */
function record(entry) {
  try {
    process.stdout.write(JSON.stringify(line(entry)) + '\n');
  } catch (e) { /* never let the journal break the request */ }
}

module.exports = {
  record: record,
  line: line,
  // MOS-v2 M-09: the same truncation the log uses, exported so that a
  // decider identity sent to the control plane is derived from the SAME
  // function as the audit actor -- one operator, one identity, in the
  // journal and in the executor's approval record alike. A malformed or
  // absent session resolves to 'unauthenticated' here too, so nothing a
  // browser sends can become part of an identity.
  actor: actorOf,
  DETAIL_FIELDS: DETAIL_FIELDS
};
