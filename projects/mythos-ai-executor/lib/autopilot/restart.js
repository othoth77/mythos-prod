'use strict';
// =====================================================
// MYTHOS Autopilot — governed executor restart
// projects/mythos-ai-executor/lib/autopilot/restart.js
//
//   restart-required ──▶ approval ──▶ pre-checks ──▶ restart ──▶ health ──▶ identity
//
// Restart is NOT part of git sync. Sync fast-forwards the checkout; that
// yields EXECUTOR_RESTART_REQUIRED (drift.js) and this module turns it into
// a durable REQUEST record keyed by the expected SHA. Nothing restarts until
// an APPROVAL exists for exactly that SHA, and one approval buys exactly
// one attempt:
//
//   REQUIRED ──approve──▶ APPROVED ──apply──▶ RESTARTING ──▶ VERIFYING ──▶ HEALTHY
//                                                              └──────────▶ FAILED (stop; human)
//
// Pre-checks before the signal (all fail-closed):
//   1. the reason still holds: a fresh drift report says EXECUTOR_RESTART_REQUIRED
//      with the same expected SHA (the checkout must equal it);
//   2. the resource guard is not CRITICAL (state file read with a staleness bound —
//      never recomputed here: two opinions eventually disagree);
//   3. no daemon-owned task is RUNNING (an in-flight provider session would be
//      orphaned by the restart);
//   4. the approval is GRANTED, unconsumed, fresh (24h), signed by a HUMAN name,
//      and names this SHA.
//
// The restart itself is an injected runner (default: `systemctl --user restart
// mythos-ai-executor.service` — the unit is a deploy USER unit, reachable from
// any deploy process; no root, no sudo). Then poll /health until ok and
// require `code_identity.head === expected`. On any failure the record goes
// FAILED with the evidence and NO further attempt is made: a second restart
// needs a second approval. The whole thing is idempotent — a request for a
// SHA that already has a record returns that record.
//
// Policy marker `restart.auto.enabled` (owner-created) lets the tick approve
// its own request with decided_by 'policy:restart.auto' — that is a LEVEL_4
// decision by the owner, off by default, and every other check still runs.
// =====================================================

var fs = require('fs');
var path = require('path');

var STATES = ['REQUIRED', 'APPROVED', 'RESTARTING', 'VERIFYING', 'HEALTHY', 'FAILED', 'SUPERSEDED', 'REJECTED'];
var APPROVAL_MAX_AGE_MS = 24 * 3600 * 1000;
var AUTOMATED_NAME_RE = /^(claude|agent|automation|bot|system|n8n|mythos|autopilot)\b/i;
var SHA_RE = /^[0-9a-f]{40}$/;
var RG_MAX_AGE_MS = 5 * 60 * 1000;

function nowIso(t) { return new Date(t || Date.now()).toISOString(); }
function dir(root) { return path.join(root, 'restart'); }
function requestFile(root, sha) { return path.join(dir(root), 'requests', sha + '.json'); }
function approvalFile(root, sha) { return path.join(dir(root), 'approvals', sha + '.json'); }
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }
function writeAtomic(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  var tmp = f + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, f);
}
function appendLedger(root, rec) {
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(root, 'ledger.jsonl'), JSON.stringify(Object.assign({ at: nowIso(), op: 'restart' }, rec)) + '\n', { mode: 0o600 });
  } catch (e) { /* best-effort */ }
}

function autoPolicy(root) {
  var env = String(process.env.MYTHOS_AUTOPILOT_RESTART || '').toLowerCase();
  if (env === 'off') return { enabled: false, reason: 'kill_switch_env' };
  if (env === 'on') return { enabled: true, reason: 'env' };
  try { fs.statSync(path.join(root, 'restart.auto.enabled')); return { enabled: true, reason: 'marker' }; }
  catch (e) { return { enabled: false, reason: 'marker_absent' }; }
}

// request(root, drift) — durable, idempotent: one record per expected SHA.
function request(root, drift, opts) {
  opts = opts || {};
  if (!drift || drift.state !== 'EXECUTOR_RESTART_REQUIRED') return { created: false, reason: 'not_required', state: drift && drift.state };
  var sha = drift.code && drift.code.sha;
  if (!SHA_RE.test(String(sha))) return { created: false, reason: 'expected_sha_unverified' };
  var f = requestFile(root, sha);
  var existing = readJson(f);
  if (existing) return { created: false, reason: 'already_requested', record: existing };
  var rec = {
    expected_sha: sha, state: 'REQUIRED', reason: 'EXECUTOR_RESTART_REQUIRED',
    running_sha: drift.executor && drift.executor.sha, running_source: drift.executor && drift.executor.source,
    executor_pid: drift.executor && drift.executor.pid, requested_at: nowIso(opts.now), attempts: [], history: [{ at: nowIso(opts.now), to: 'REQUIRED' }]
  };
  writeAtomic(f, rec);
  // Earlier open requests for other SHAs are superseded: the checkout moved on.
  listRequests(root).forEach(function (r) {
    if (r.expected_sha !== sha && ['REQUIRED', 'APPROVED'].indexOf(r.state) !== -1) {
      r.state = 'SUPERSEDED'; r.superseded_by = sha; r.history.push({ at: nowIso(opts.now), to: 'SUPERSEDED', by: sha });
      writeAtomic(requestFile(root, r.expected_sha), r);
      appendLedger(root, { event: 'superseded', expected_sha: r.expected_sha, by: sha });
    }
  });
  appendLedger(root, { event: 'requested', expected_sha: sha, running_sha: rec.running_sha });
  return { created: true, record: rec };
}

function listRequests(root) {
  var d = path.join(dir(root), 'requests');
  var out = [];
  try { fs.readdirSync(d).forEach(function (n) { if (/^[0-9a-f]{40}\.json$/.test(n)) { var r = readJson(path.join(d, n)); if (r) out.push(r); } }); } catch (e) { /* none */ }
  return out.sort(function (a, b) { return String(a.requested_at).localeCompare(String(b.requested_at)); });
}

function openRequest(root) {
  var open = listRequests(root).filter(function (r) { return ['REQUIRED', 'APPROVED', 'RESTARTING', 'VERIFYING'].indexOf(r.state) !== -1; });
  return open.length ? open[open.length - 1] : null;
}

// approve(root, sha, {by, reason}) — a HUMAN decision, recorded once.
function approve(root, sha, opts) {
  opts = opts || {};
  if (!SHA_RE.test(String(sha))) return { ok: false, code: 'SHA_INVALID' };
  var by = String(opts.by || '').trim();
  if (by.length < 3) return { ok: false, code: 'APPROVAL_NEEDS_DECIDER', reason: '--by must name the human who decided' };
  if (AUTOMATED_NAME_RE.test(by) && by !== 'policy:restart.auto') return { ok: false, code: 'APPROVAL_NEEDS_HUMAN', reason: 'an automated identity cannot approve a restart' };
  if (String(opts.reason || '').trim().length < 10) return { ok: false, code: 'APPROVAL_NEEDS_REASON' };
  var req = readJson(requestFile(root, sha));
  if (!req) return { ok: false, code: 'NO_SUCH_REQUEST', reason: 'no restart request for ' + sha.slice(0, 12) + '; approvals are bound to a recorded request' };
  var existing = readJson(approvalFile(root, sha));
  if (existing && !existing.consumed_at && req.state === 'APPROVED') return { ok: true, duplicate: true, approval: existing, record: req };
  if (req.state !== 'REQUIRED') return { ok: false, code: 'REQUEST_NOT_OPEN', state: req.state };
  var ap = { expected_sha: sha, decision: 'GRANTED', decided_by: by, reason: String(opts.reason).slice(0, 1000), decided_at: nowIso(opts.now), consumed_at: null, consumed_by: null };
  writeAtomic(approvalFile(root, sha), ap);
  req.state = 'APPROVED'; req.approved_at = ap.decided_at; req.approved_by = by; req.history.push({ at: ap.decided_at, to: 'APPROVED', by: by });
  writeAtomic(requestFile(root, sha), req);
  appendLedger(root, { event: 'approved', expected_sha: sha, by: by });
  return { ok: true, approval: ap, record: req };
}

function reject(root, sha, opts) {
  opts = opts || {};
  var req = readJson(requestFile(root, sha));
  if (!req) return { ok: false, code: 'NO_SUCH_REQUEST' };
  req.state = 'REJECTED'; req.history.push({ at: nowIso(opts.now), to: 'REJECTED', by: opts.by || null, reason: opts.reason || null });
  writeAtomic(requestFile(root, sha), req);
  appendLedger(root, { event: 'rejected', expected_sha: sha, by: opts.by || null });
  return { ok: true, record: req };
}

function verifyApproval(root, sha, now) {
  var ap = readJson(approvalFile(root, sha));
  if (!ap) return { ok: false, code: 'APPROVAL_MISSING' };
  if (ap.decision !== 'GRANTED') return { ok: false, code: 'APPROVAL_NOT_GRANTED' };
  if (ap.expected_sha !== sha) return { ok: false, code: 'APPROVAL_SHA_MISMATCH' };
  if (ap.consumed_at) return { ok: false, code: 'APPROVAL_CONSUMED', consumed_by: ap.consumed_by };
  if (!ap.decided_by) return { ok: false, code: 'APPROVAL_NEEDS_DECIDER' };
  var age = (now || Date.now()) - Date.parse(ap.decided_at || 0);
  if (isNaN(age) || age > APPROVAL_MAX_AGE_MS) return { ok: false, code: 'APPROVAL_EXPIRED' };
  return { ok: true, approval: ap };
}

function resourceGuardLevel(executorHome, now) {
  var st = readJson(path.join(executorHome, 'resource-guard.json'));
  if (!st || !st.updated_at) return { level: 'UNKNOWN', reason: 'state file missing or unreadable' };
  var age = (now || Date.now()) - Date.parse(st.updated_at);
  if (isNaN(age) || age > RG_MAX_AGE_MS) return { level: 'STALE', reason: 'sample older than ' + RG_MAX_AGE_MS / 1000 + 's', recorded: st.level };
  return { level: st.level || 'NORMAL' };
}

function runningTasks(state) {
  var out = [];
  try {
    state.listTasks().forEach(function (id) {
      var s = state.readStatus(id);
      if (s && s.status === 'RUNNING') out.push({ task_id: id, pid: s.pid, core_owned: !!s.core_owned });
    });
  } catch (e) { /* store unreadable → treated as unknown below */ }
  return out;
}

// preflight(ctx) — every veto, first reason wins; all recorded.
function preflight(ctx) {
  var vetoes = [];
  var d = ctx.drift;
  if (!d || d.state !== 'EXECUTOR_RESTART_REQUIRED') vetoes.push({ code: 'REASON_GONE', reason: 'fresh drift state is ' + (d && d.state) + ', not EXECUTOR_RESTART_REQUIRED' });
  else if (d.code.sha !== ctx.expected_sha) vetoes.push({ code: 'CHECKOUT_MOVED', reason: 'checkout is ' + String(d.code.sha).slice(0, 12) + ', request expects ' + ctx.expected_sha.slice(0, 12) });
  var rg = ctx.resource_guard;
  if (!rg || rg.level === 'CRITICAL') vetoes.push({ code: 'RESOURCE_CRITICAL', reason: 'resource guard is CRITICAL' });
  else if (rg.level === 'UNKNOWN' || rg.level === 'STALE') vetoes.push({ code: 'RESOURCE_UNVERIFIED', reason: 'resource guard state ' + rg.level + ': ' + rg.reason });
  if (!ctx.running || ctx.running.length) vetoes.push({ code: 'ACTIVE_EXECUTION', reason: (ctx.running ? ctx.running.length : '?') + ' RUNNING task(s); a restart would orphan them' });
  var ap = ctx.approval;
  if (!ap || !ap.ok) vetoes.push({ code: (ap && ap.code) || 'APPROVAL_MISSING', reason: 'no usable approval' });
  return { ok: vetoes.length === 0, vetoes: vetoes };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// apply(root, opts) — the governed restart. opts: expected_sha, detect() →
// Promise<drift>, restartFn() → {ok, error}, executor_home, state, now,
// health_wait_ms, health_poll_ms, approval_auto (policy) — everything
// injectable so the suite drives every path without a real service.
function apply(root, opts) {
  opts = opts || {};
  var sha = opts.expected_sha;
  var req = readJson(requestFile(root, sha));
  if (!req) return Promise.resolve({ ok: false, code: 'NO_SUCH_REQUEST' });
  if (['HEALTHY', 'FAILED', 'SUPERSEDED', 'REJECTED'].indexOf(req.state) !== -1) return Promise.resolve({ ok: false, code: 'REQUEST_CLOSED', state: req.state, record: req });
  if (req.state === 'RESTARTING' || req.state === 'VERIFYING') return Promise.resolve({ ok: false, code: 'RESTART_IN_PROGRESS', state: req.state, record: req });
  if (req.attempts.length >= 1) return fail(root, req, 'ATTEMPT_CAP', 'one restart attempt per approval; a new approval is required');

  var now = opts.now || Date.now();
  // Policy auto-approval: owner-enabled marker, still subject to every other veto.
  if (req.state === 'REQUIRED' && opts.approval_auto && opts.approval_auto.enabled) {
    var a = approve(root, sha, { by: 'policy:restart.auto', reason: 'policy marker restart.auto.enabled (' + opts.approval_auto.reason + ')', now: now });
    if (a.ok) req = a.record;
  }
  return opts.detect().then(function (drift) {
    var ctx = {
      expected_sha: sha, drift: drift,
      resource_guard: process.env.MYTHOS_RESOURCE_GUARD === 'off' ? { level: 'DISABLED' } : resourceGuardLevel(opts.executor_home, now),
      running: runningTasks(opts.state),
      approval: verifyApproval(root, sha, now)
    };
    var pf = preflight(ctx);
    if (!pf.ok) {
      appendLedger(root, { event: 'vetoed', expected_sha: sha, vetoes: pf.vetoes });
      req.last_preflight = { at: nowIso(now), vetoes: pf.vetoes };
      writeAtomic(requestFile(root, sha), req);
      return { ok: false, code: 'PREFLIGHT_VETO', vetoes: pf.vetoes, record: req };
    }
    // Consume the approval BEFORE signalling: a crash between the two must not
    // leave an approval that buys a second restart.
    var ap = ctx.approval.approval;
    ap.consumed_at = nowIso(now); ap.consumed_by = 'restart:' + sha.slice(0, 12) + ':' + (req.attempts.length + 1);
    writeAtomic(approvalFile(root, sha), ap);
    var attempt = { n: req.attempts.length + 1, started_at: nowIso(now), approved_by: ap.decided_by, pre_restart_pid: drift.executor && drift.executor.pid, running_sha_before: drift.executor && drift.executor.sha };
    req.attempts.push(attempt);
    req.state = 'RESTARTING'; req.history.push({ at: attempt.started_at, to: 'RESTARTING', attempt: attempt.n });
    writeAtomic(requestFile(root, sha), req);
    appendLedger(root, { event: 'restarting', expected_sha: sha, attempt: attempt.n, by: ap.decided_by });
    var r;
    try { r = opts.restartFn(); } catch (e) { r = { ok: false, error: e.message }; }
    if (!r || !r.ok) { attempt.restart_error = (r && r.error) || 'unknown'; return fail(root, req, 'RESTART_COMMAND_FAILED', attempt.restart_error); }
    req.state = 'VERIFYING'; req.history.push({ at: nowIso(), to: 'VERIFYING' });
    writeAtomic(requestFile(root, sha), req);
    return waitHealthy(opts, sha, attempt).then(function (v) {
      attempt.verification = v;
      if (!v.ok) return fail(root, req, v.code, v.reason);
      req.state = 'HEALTHY'; req.completed_at = nowIso(); req.history.push({ at: req.completed_at, to: 'HEALTHY', pid: v.pid });
      writeAtomic(requestFile(root, sha), req);
      appendLedger(root, { event: 'healthy', expected_sha: sha, attempt: attempt.n, pid: v.pid });
      return { ok: true, code: 'HEALTHY', record: req };
    });
  });
}

function waitHealthy(opts, sha, attempt) {
  var deadline = Date.now() + (opts.health_wait_ms || 90000);
  var poll = opts.health_poll_ms || 3000;
  var last = null;
  function step() {
    return opts.detect().then(function (d) {
      last = d;
      var h = d.executor && d.executor.health;
      var newPid = d.executor && d.executor.pid;
      if (h && h.ok && d.executor.sha === sha && d.executor.source === 'health') return { ok: true, pid: newPid, sha: d.executor.sha };
      if (h && h.ok && d.executor.sha && d.executor.sha !== sha) return { ok: false, code: 'IDENTITY_MISMATCH_AFTER_RESTART', reason: 'executor came back healthy but reports ' + String(d.executor.sha).slice(0, 12) + ', expected ' + sha.slice(0, 12) };
      if (Date.now() >= deadline) return { ok: false, code: 'HEALTH_TIMEOUT', reason: 'executor not healthy with the expected identity within ' + (opts.health_wait_ms || 90000) + 'ms', last: { health: h, sha: d.executor && d.executor.sha, source: d.executor && d.executor.source } };
      return sleep(poll).then(step);
    });
  }
  return step();
}

function fail(root, req, code, reason) {
  req.state = 'FAILED'; req.failure = { code: code, reason: reason, at: nowIso() };
  req.history.push({ at: req.failure.at, to: 'FAILED', code: code });
  writeAtomic(requestFile(root, req.expected_sha), req);
  appendLedger(root, { event: 'failed', expected_sha: req.expected_sha, code: code, reason: reason });
  return Promise.resolve({ ok: false, code: code, reason: reason, record: req });
}

function status(root) {
  var open = openRequest(root);
  return { auto_policy: autoPolicy(root), open: open, requests: listRequests(root).slice(-10) };
}

module.exports = { STATES: STATES, APPROVAL_MAX_AGE_MS: APPROVAL_MAX_AGE_MS, request: request, approve: approve, reject: reject, apply: apply, preflight: preflight, verifyApproval: verifyApproval, status: status, openRequest: openRequest, listRequests: listRequests, autoPolicy: autoPolicy, resourceGuardLevel: resourceGuardLevel, requestFile: requestFile, approvalFile: approvalFile };
