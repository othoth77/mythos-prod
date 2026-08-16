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
  /hit your usage limit/i,
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

// Classifies a finished provider run. `text` should combine the structured
// result message and raw stderr/stdout tails. Precedence: quota > blocked >
// transient > fatal. Success is decided by the caller from the structured
// result, never here.
function classifyFailure(text) {
  if (isQuota(text)) return 'quota';
  if (isBlocked(text)) return 'blocked';
  if (isTransient(text)) return 'transient';
  return 'fatal';
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

// Bounded exponential backoff for transient failures: 1m, 4m, 16m — then the
// task fails rather than looping forever (mission §8 forbids infinite retry).
var RETRY_BASE_MS = 60 * 1000;
var RETRY_FACTOR = 4;

function retryDelayMs(retryCount) {
  return RETRY_BASE_MS * Math.pow(RETRY_FACTOR, Math.max(0, retryCount));
}

module.exports = {
  QUOTA_PATTERNS: QUOTA_PATTERNS,
  TRANSIENT_PATTERNS: TRANSIENT_PATTERNS,
  BLOCKED_PATTERNS: BLOCKED_PATTERNS,
  isQuota: isQuota,
  isTransient: isTransient,
  isBlocked: isBlocked,
  classifyFailure: classifyFailure,
  parseResetTime: parseResetTime,
  quotaResumeAt: quotaResumeAt,
  retryDelayMs: retryDelayMs,
  RESET_GRACE_MS: RESET_GRACE_MS,
  QUOTA_BACKOFF_MS: QUOTA_BACKOFF_MS
};
