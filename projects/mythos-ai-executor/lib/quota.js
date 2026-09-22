'use strict';
// =====================================================
// Mythos AI Executor — quota and failure classification
// projects/mythos-ai-executor/lib/quota.js
//
// CORE REQUIREMENT (mission §7): quota exhaustion is NOT a failure. This
// module is the single place that decides whether a provider outcome is
//
//   quota      → WAITING_FOR_QUOTA, resume the SAME session later
//   transient  → WAITING_RETRY with bounded exponential backoff
//   blocked    → BLOCKED, a human/owner decision is genuinely required
//   fatal      → FAILED, state preserved for inspection and re-queue
//
// Detection is pattern-based over the provider's structured result text
// and raw stdout/stderr. Patterns are ordered: quota wins over transient
// (a quota message often also contains the word "limit"), and blocked
// wins over fatal.
// =====================================================

// Claude Code / Anthropic API quota shapes observed in the wild:
//   "Claude AI usage limit reached|1735689600"      (epoch after the pipe)
//   "5-hour limit reached ∙ resets 3am"
//   "Weekly limit reached ∙ resets Oct 14"
//   "You've hit your usage limit"
//   "usage limit reached"
//   "Session limit reached ∙ resets 7pm"
var QUOTA_PATTERNS = [
  /usage limit reached/i,
  // "You've hit your session limit · resets 9:20pm (UTC)" — observed live
  // (api_error_status 429) during the first real orchestration mission.
  /hit your (?:usage|session) limit/i,
  /\b(?:5-hour|session|weekly|monthly) limit reached/i,
  /out of extra usage/i,
  /usage.{0,20}quota.{0,20}exhaust/i,
  /exceeded your.{0,30}quota/i
];

// Transient provider/network shapes: retry with backoff, do not burn the task.
var TRANSIENT_PATTERNS = [
  /\boverloaded\b/i,
  /\b529\b/,
  /\b50[023]\b/,
  /rate.?limit/i,                 // per-minute 429s, distinct from usage quota
  /too many requests/i,
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/,
  /fetch failed/i,
  /network error/i,
  /internal server error/i,
  /connection (?:closed|reset|refused)/i
];

// Genuine human blockers: retrying cannot help, but the task is not broken.
var BLOCKED_PATTERNS = [
  /credit balance is too low/i,
  /billing/i,
  /payment required/i,
  /account.{0,30}(?:disabled|suspended)/i,
  /invalid api key|authentication_error|not logged in|please run \/login/i,
  /OAuth token has expired/i
];

// Permission denials from the headless CLI (a tool call, edit or command the
// permission mode refused, or an approval prompt nobody could answer). They
// are BLOCKED (a human grants, or the task is re-scoped) and carry the code
// PERMISSION_DENIED: never retried automatically.
var PERMISSION_PATTERNS = [
  /permission (?:denied|required|prompt)/i,
  /requires? approval/i,
  /(?:tool|command|edit|write) .{0,40}(?:was |is )?(?:denied|not allowed|refused)/i,
  /\bDENIED\b/,
  /EACCES/
];

// Governance denials: MYTHOS's own rules refused the operation (protected
// path, policy, the relay, a control-commit scope, an invariant). Distinct
// from a CLI permission prompt because the fix is a decision (re-scope the
// task or the owner changes the rule), never a grant — and, like every
// blocker, never a retry. Checked BEFORE the permission patterns because a
// governance refusal is usually also worded as a denial.
var GOVERNANCE_PATTERNS = [
  /denied by (?:policy|governance)/i,
  /governance[- ]protected/i,
  /governance (?:relay |policy )?(?:refused|denied|rejected|blocked)/i,
  /protected path/i,
  /PROTECTED_PATH|GOVERNANCE_DENIED|CONTROL_COMMIT_SCOPE|ACTION_PROFILE_MISMATCH|ATTEMPT_SNAPSHOT_MUTATED/,
  /(?:push|commit) (?:to|on) .{0,40}(?:refused|rejected|forbidden|not allowed)/i
];

function matchAny(patterns, text) {
  if (typeof text !== 'string' || !text) return false;
  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].test(text)) return true;
  }
  return false;
}

function isQuota(text) { return matchAny(QUOTA_PATTERNS, text); }
function isTransient(text) { return matchAny(TRANSIENT_PATTERNS, text); }
function isBlocked(text) { return matchAny(BLOCKED_PATTERNS, text); }
function isPermissionDenied(text) { return matchAny(PERMISSION_PATTERNS, text); }
function isGovernanceDenied(text) { return matchAny(GOVERNANCE_PATTERNS, text); }

// --- Outcome classification (the single decision) ------------------------------
//
// Every failed provider run is one of six CATEGORIES. The category decides
// the retry policy; the code is what the structured report and the Issue
// carry. Precedence: quota > governance > permission > human > transient >
// permanent — a quota message often also says "limit", a governance refusal
// is usually worded as a denial, and a permanent error may mention a 5xx in
// passing. Success is decided by the caller from the structured result,
// never here.
//
//   category    kind        code                retry
//   quota       quota       —                   resume the SAME session after the window
//   transient   transient   —                   exponential backoff + jitter, bounded by max_retries
//   permission  blocked     PERMISSION_DENIED   never (a human grants or re-scopes)
//   governance  blocked     GOVERNANCE_DENIED   never (a decision, not a grant)
//   human       blocked     PROVIDER_BLOCKED    never (billing / credential / account)
//   permanent   fatal       PROVIDER_FAILED     never (inspect, re-queue explicitly)
//
// Patterns from Temporal / Hatchet / Trigger.dev / Svix: classify before
// retrying, retry only what a retry can change, back off with jitter, cap
// the attempts — implemented locally, no runtime dependency.
var CATEGORIES = ['quota', 'transient', 'permission', 'governance', 'human', 'permanent'];
var KIND_BY_CATEGORY = { quota: 'quota', transient: 'transient', permission: 'blocked', governance: 'blocked', human: 'blocked', permanent: 'fatal' };
var CODE_BY_CATEGORY = { quota: null, transient: null, permission: 'PERMISSION_DENIED', governance: 'GOVERNANCE_DENIED', human: 'PROVIDER_BLOCKED', permanent: 'PROVIDER_FAILED' };

function categorize(text) {
  if (isQuota(text)) return 'quota';
  if (isGovernanceDenied(text)) return 'governance';
  if (isPermissionDenied(text)) return 'permission';
  if (isBlocked(text)) return 'human';
  if (isTransient(text)) return 'transient';
  return 'permanent';
}

// { category, kind, code, retryable, policy } — `retryable` means the
// executor itself will try again (quota resume or transient backoff); every
// blocker category is false and is surfaced for a human/rerun instead.
function classifyOutcome(text, opts) {
  opts = opts || {};
  var category = opts.timed_out ? 'transient' : categorize(text);
  return {
    category: category,
    kind: KIND_BY_CATEGORY[category],
    code: CODE_BY_CATEGORY[category],
    retryable: category === 'quota' || category === 'transient',
    policy: RETRY_POLICY[category]
  };
}

// Kept for callers that only need the coarse kind. Precedence is the same.
function classifyFailure(text) { return KIND_BY_CATEGORY[categorize(text)]; }

// Same decision, plus the blocker code the structured report carries.
// { kind, code, category }  — code is null for quota/transient (they are
// continuations, not blockers).
function classifyFailureDetail(text) {
  var c = classifyOutcome(text);
  return { kind: c.kind, code: c.code, category: c.category };
}

// A provider that ENDED CLEANLY with a `status: blocked` report: which kind
// of blocker is it? The report text decides — governance first, then a
// permission grant, otherwise a genuine owner decision (HUMAN_APPROVAL).
function classifyBlockedReport(text) {
  if (isGovernanceDenied(text)) return 'GOVERNANCE_DENIED';
  if (isPermissionDenied(text)) return 'PERMISSION_DENIED';
  return 'HUMAN_APPROVAL';
}

// --- Reset-time extraction -------------------------------------------------

// "Claude AI usage limit reached|1735689600" — epoch seconds after a pipe.
function parseEpochAfterPipe(text) {
  var m = /limit reached\|(\d{9,12})\b/i.exec(text);
  if (!m) return null;
  var epoch = parseInt(m[1], 10) * 1000;
  return isFinite(epoch) ? epoch : null;
}

// "resets 3am", "resets 10:30pm", "resets at 7pm" — same-day-or-next clock time.
function parseClockReset(text, nowMs) {
  var m = /resets(?: at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (!m) return null;
  var hour = parseInt(m[1], 10) % 12;
  if (/pm/i.test(m[3])) hour += 12;
  var minute = m[2] ? parseInt(m[2], 10) : 0;
  var d = new Date(nowMs);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// ISO-ish timestamp anywhere near the word "reset".
function parseIsoReset(text) {
  var m = /reset[^.\n]{0,40}?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)/i.exec(text);
  if (!m) return null;
  var t = Date.parse(m[1]);
  return isNaN(t) ? null : t;
}

// Best-effort reset time in epoch ms, or null when the provider gave none.
function parseResetTime(text, nowMs) {
  if (typeof text !== 'string' || !text) return null;
  nowMs = nowMs || Date.now();
  return parseEpochAfterPipe(text) || parseIsoReset(text) || parseClockReset(text, nowMs);
}

// --- Resume scheduling ------------------------------------------------------

// Jitter keeps a fleet of resumes from stampeding the instant a window opens.
var RESET_GRACE_MS = 3 * 60 * 1000;          // resume 3 minutes after the stated reset
var QUOTA_BACKOFF_MS = [                      // conservative polling when no reset time is known
  30 * 60 * 1000,   // 30 min
  60 * 60 * 1000,   // 1 h
  2 * 60 * 60 * 1000, // 2 h
  4 * 60 * 60 * 1000  // 4 h, then stays at 4 h
];

// When to try resuming a WAITING_FOR_QUOTA task. `waits` counts previous
// unsuccessful resume attempts for this quota episode.
function quotaResumeAt(resetAtMs, waits, nowMs) {
  nowMs = nowMs || Date.now();
  if (resetAtMs && resetAtMs > nowMs) {
    return resetAtMs + RESET_GRACE_MS;
  }
  var idx = Math.min(waits || 0, QUOTA_BACKOFF_MS.length - 1);
  return nowMs + QUOTA_BACKOFF_MS[idx];
}

// Bounded exponential backoff for transient failures: 1m, 4m, 16m (capped at
// RETRY_MAX_MS) — then the task fails rather than looping forever (mission §8
// forbids infinite retry). The scheduled delay carries ADDITIVE JITTER —
// never shorter than the base step, up to half a step longer — so a fleet of
// tasks that failed on the same outage does not retry in lock-step against
// the same provider while a provider that asked for a minute still gets its
// minute; the pure schedule stays available as retryBaseDelayMs() for callers
// that need the deterministic figure (reports, tests).
var RETRY_BASE_MS = 60 * 1000;
var RETRY_FACTOR = 4;
var RETRY_MAX_MS = 30 * 60 * 1000;

function retryBaseDelayMs(retryCount) {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.pow(RETRY_FACTOR, Math.max(0, retryCount)));
}

// `random` (0 ≤ r < 1) is injectable so the schedule is testable; it defaults
// to Math.random. The result is always within [base, 1.5 × base], where base
// is itself capped at RETRY_MAX_MS.
function retryDelayMs(retryCount, random) {
  var base = retryBaseDelayMs(retryCount);
  var r = typeof random === 'function' ? random() : (typeof random === 'number' ? random : Math.random());
  if (!(r >= 0 && r < 1)) r = 0;
  return Math.round(base + r * (base / 2));
}

// The policy per category, as data — recorded on the task status and printed
// in the docs, so the answer to "will this be retried, and when?" is never
// implied by code paths alone.
var RETRY_POLICY = {
  quota: { retry: true, strategy: 'resume same session after the quota window (RESET_GRACE_MS after the stated reset, else QUOTA_BACKOFF_MS steps)', max_attempts: null },
  transient: { retry: true, strategy: 'exponential backoff with additive jitter', base_ms: RETRY_BASE_MS, factor: RETRY_FACTOR, max_ms: RETRY_MAX_MS, jitter: 'additive (delay in [base, 1.5 × base])', max_attempts: 'task.max_retries' },
  permission: { retry: false, strategy: 'BLOCKED PERMISSION_DENIED — a human grants or the task is re-scoped, then `rerun`' },
  governance: { retry: false, strategy: 'BLOCKED GOVERNANCE_DENIED — a decision (re-scope, or the owner changes the rule), then `rerun`' },
  human: { retry: false, strategy: 'BLOCKED PROVIDER_BLOCKED — billing / credential / account, resolved by a human' },
  permanent: { retry: false, strategy: 'FAILED PROVIDER_FAILED — inspect stderr.log, re-queue explicitly' }
};

module.exports = {
  QUOTA_PATTERNS: QUOTA_PATTERNS,
  TRANSIENT_PATTERNS: TRANSIENT_PATTERNS,
  BLOCKED_PATTERNS: BLOCKED_PATTERNS,
  PERMISSION_PATTERNS: PERMISSION_PATTERNS,
  GOVERNANCE_PATTERNS: GOVERNANCE_PATTERNS,
  CATEGORIES: CATEGORIES,
  RETRY_POLICY: RETRY_POLICY,
  isQuota: isQuota,
  isTransient: isTransient,
  isBlocked: isBlocked,
  isPermissionDenied: isPermissionDenied,
  isGovernanceDenied: isGovernanceDenied,
  categorize: categorize,
  classifyOutcome: classifyOutcome,
  classifyFailure: classifyFailure,
  classifyFailureDetail: classifyFailureDetail,
  classifyBlockedReport: classifyBlockedReport,
  parseResetTime: parseResetTime,
  quotaResumeAt: quotaResumeAt,
  retryBaseDelayMs: retryBaseDelayMs,
  retryDelayMs: retryDelayMs,
  RESET_GRACE_MS: RESET_GRACE_MS,
  QUOTA_BACKOFF_MS: QUOTA_BACKOFF_MS,
  RETRY_BASE_MS: RETRY_BASE_MS,
  RETRY_FACTOR: RETRY_FACTOR,
  RETRY_MAX_MS: RETRY_MAX_MS
};
