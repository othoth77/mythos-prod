// Unattended autonomous policy (MVP night mode).
//
// The owner requirement is that a started MVP runs for hours without being
// asked anything. The naive way to get there is to loosen the gates so fewer
// things need asking. That is the one thing this module must never do.
//
// Instead the gates keep firing exactly as before and the ANSWER becomes
// deterministic: an operation that would have waited for a human is DENIED,
// the reason is recorded, and the campaign continues with other work. A
// denial is strictly more conservative than an approval, so making the
// answer automatic can only ever reduce what the loop is allowed to do.
//
// Read that sentence again before changing anything here: the safety of this
// whole design rests on "the automatic answer is always the restrictive one".
// If a future edit ever makes an automatic ANSWER grant something, this stops
// being an unattended-operation policy and becomes a governance bypass.
//
// What this module is NOT allowed to become:
//   - a way to auto-approve anything;
//   - a place where a caged/protected path is reclassified as ordinary;
//   - a second permission model competing with policy.js / self-improve.js.
// It decides only what to DO with a decision those layers already made.

'use strict';

// Every reason a mission can stop for something outside itself, and the
// deterministic unattended answer. Ordered by precedence: the first match
// wins, so a governance breach is never re-read as an ordinary failure.
//
// `terminal_for_capability` means the capability is recorded as denied and
// must not be re-proposed in this campaign; the loop moves on. Where it is
// false the capability may be selected again later (a quota pause is not a
// verdict about the work).
var DECISIONS = [
  {
    kind: 'GOVERNANCE',
    match: /governance violation|caged|protected path|self-protected/i,
    action: 'DENY',
    terminal_for_capability: true,
    preserve_evidence: true,
    detail: 'governance-protected path touched — denied automatically, branch preserved unmerged'
  },
  {
    kind: 'DESTRUCTIVE',
    match: /destructive|ROOT|sudo|credential rotation|DNS|firewall|backup deletion|money|payment/i,
    action: 'DENY',
    terminal_for_capability: true,
    preserve_evidence: true,
    detail: 'destructive/root/external-side-effect class — never auto-approved'
  },
  {
    kind: 'POLICY',
    match: /approval required|requires approval|policy/i,
    action: 'DENY',
    terminal_for_capability: true,
    preserve_evidence: true,
    detail: 'operation requires an approval that unattended mode will not grant'
  },
  {
    kind: 'REPAIR_EXHAUSTED',
    match: /repair budget exhausted/i,
    action: 'REJECT_MISSION',
    terminal_for_capability: true,
    preserve_evidence: true,
    detail: 'repair budget spent — mission rejected, work preserved on its branch'
  },
  {
    kind: 'AMBIGUOUS',
    match: /ambiguous|unclear|needs a human design decision|cannot determine/i,
    action: 'SKIP',
    terminal_for_capability: true,
    preserve_evidence: false,
    detail: 'ambiguous objective — parked with a structured reason, not asked about'
  }
];

// Quota and transient infrastructure failures are NOT decisions. They are
// waits, they already have durable resumable states, and turning them into
// denials would throw away recoverable work. They are listed here only so
// that a reader can see they were considered and deliberately excluded.
var NEVER_DENIED = ['WAITING_FOR_QUOTA', 'WAITING_RETRY', 'transient', 'rate_limited'];

function classify(reason) {
  var text = String(reason == null ? '' : reason);
  for (var i = 0; i < DECISIONS.length; i++) {
    if (DECISIONS[i].match.test(text)) {
      return {
        kind: DECISIONS[i].kind,
        action: DECISIONS[i].action,
        terminal_for_capability: DECISIONS[i].terminal_for_capability,
        preserve_evidence: DECISIONS[i].preserve_evidence,
        detail: DECISIONS[i].detail
      };
    }
  }
  // Unrecognised is the dangerous case: something asked for a human and we
  // do not know why. Deny it — an unknown reason to stop is never a reason
  // to proceed — but do NOT mark it terminal, so a transient or
  // misclassified condition is not permanently written off.
  return {
    kind: 'UNCLASSIFIED',
    action: 'DENY',
    terminal_for_capability: false,
    preserve_evidence: true,
    detail: 'unrecognised approval reason — denied by default, capability not written off'
  };
}

// Unattended mode is OFF unless explicitly switched on, and it is an
// environment/config decision, never a task payload field. A caller cannot
// turn it on by passing an option.
function enabled() {
  return String(process.env.MYTHOS_UNATTENDED || '').toLowerCase() === 'true';
}

// The invariant this whole module exists to hold. Exposed so tests can
// assert it directly rather than inferring it from behaviour.
function grantsAnything(decision) {
  return ['DENY', 'REJECT_MISSION', 'SKIP'].indexOf(decision.action) === -1;
}

module.exports = {
  DECISIONS: DECISIONS,
  NEVER_DENIED: NEVER_DENIED,
  classify: classify,
  enabled: enabled,
  grantsAnything: grantsAnything
};
