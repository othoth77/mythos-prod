'use strict';
// =====================================================
// MYTHOS pull-request lifecycle watcher
// projects/mythos-ai-executor/bridge/pr-watch.js
//
// Read-only poller over the repository's pull requests, reusing the same
// GitHub REST client and token as bridge/github-issues.js (no new
// credential). It never merges, comments, labels or closes a pull request —
// its only outputs are unified Telegram notifications
// (bridge/notify/telegram-events.js) for the events gh-issue-187 asks for:
// opened, an important update (ready-for-review, retitled), a review
// (approved / changes requested), a checks/tests conclusion, merged, closed
// without merge, and a merge conflict.
//
// State: one small JSON ledger under the bridge home
// (MYTHOS_BRIDGE_HOME/pr-watch/state.json), keyed by PR number, holding just
// enough of the previous snapshot to detect a transition. Never the source
// of truth — GitHub is — only a durable "what did we already see" cache so
// a tick that only fetches the most recently updated PRs still notices
// exactly the events that changed since the last poll.
//
// Disabled by default (MYTHOS_PR_WATCH_ENABLED=1 required), exactly like
// the Issues and Telegram channels before it: a new poller against the
// GitHub API is an explicit opt-in, not a silent behavior change to
// production.
// =====================================================

var fs = require('fs');
var path = require('path');

var bridge = require('./github-bridge');
var issues = require('./github-issues');
var telegramEvents = require('./notify/telegram-events');

var BY = 'pr-watch';

function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function nowIso() { return new Date().toISOString(); }

function config() {
  var icfg = issues.config();
  return {
    issues: icfg,
    enabled: process.env.MYTHOS_PR_WATCH_ENABLED === '1',
    home: path.join(icfg.bridge.home, 'pr-watch'),
    maxPerTick: Math.min(100, Math.max(1, parseInt(process.env.MYTHOS_PR_WATCH_MAX_PER_TICK || '30', 10) || 30))
  };
}

function log(event, fields) { bridge.log('pr-watch:' + event, fields || {}); }

function notifyTelegram(evt) {
  return telegramEvents.notifyEvent(evt).then(function (r) { return r; }, function (e) {
    log('telegram_notify_error', { event: evt && evt.event, error: short(String(e && e.message || e), 200) });
    return { sent: false, reason: 'error' };
  });
}

function ensureHome(cfg) { fs.mkdirSync(cfg.home, { recursive: true, mode: 0o700 }); }
function stateFile(cfg) { return path.join(cfg.home, 'state.json'); }
function readState(cfg) { try { return JSON.parse(fs.readFileSync(stateFile(cfg), 'utf8')); } catch (e) { return {}; } }
function writeState(cfg, value) {
  ensureHome(cfg);
  var tmp = stateFile(cfg) + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, stateFile(cfg));
}

function snapshot(pr) {
  return {
    state: pr.state, merged: !!pr.merged_at, draft: !!pr.draft, title: pr.title,
    head_sha: pr.head && pr.head.sha, mergeable_state: pr.mergeable_state || null,
    last_review_id: null, checks_state: null, updated_at: pr.updated_at
  };
}

// Pure: previous snapshot (or null for "never seen") + current PR payload →
// a list of unified events to notify (before reviews/checks are consulted).
function transitionsFor(prev, pr) {
  var out = [];
  var n = pr.number;
  if (!prev) {
    if (pr.state === 'open' && !pr.draft) out.push({ event: 'opened', title: short(String(pr.title || ''), 200) });
    return out;
  }
  if (!prev.merged && !!pr.merged_at) {
    out.push({ event: 'merged', title: short(String(pr.title || ''), 200) });
    return out; // a merged PR cannot also be "closed without merge"
  }
  if (prev.state === 'open' && pr.state === 'closed' && !pr.merged_at) {
    out.push({ event: 'closed_without_merge', title: short(String(pr.title || ''), 200) });
    return out;
  }
  if (pr.state !== 'open') return out; // no further lifecycle events once closed
  if (prev.draft && !pr.draft) out.push({ event: 'updated', title: 'ready for review: ' + short(String(pr.title || ''), 180) });
  else if (prev.title !== pr.title) out.push({ event: 'updated', title: 'title changed: ' + short(String(pr.title || ''), 180) });
  if (prev.mergeable_state !== 'dirty' && pr.mergeable_state === 'dirty') out.push({ event: 'conflict', title: short(String(pr.title || ''), 200) });
  return out;
}

async function reviewEvent(client, pr, prev) {
  var reviews;
  try { reviews = await client.listReviews(pr.number); } catch (e) { return { event: null, lastReviewId: prev ? prev.last_review_id : null }; }
  var notable = reviews.filter(function (r) { return r && (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED'); });
  if (!notable.length) return { event: null, lastReviewId: prev ? prev.last_review_id : null };
  var last = notable[notable.length - 1];
  var already = prev && prev.last_review_id;
  if (already && notable.some(function (r) { return r.id === already; }) && notable[notable.length - 1].id === already) {
    return { event: null, lastReviewId: already };
  }
  var reviewer = (last.user && (last.user.login)) || 'a reviewer';
  return {
    event: { event: 'review', title: reviewer + ': ' + (last.state === 'APPROVED' ? 'approved' : 'changes requested') },
    lastReviewId: last.id
  };
}

async function checksEvent(client, pr, prev) {
  var sha = pr.head && pr.head.sha;
  if (!sha) return { event: null, checksState: prev ? prev.checks_state : null };
  var combined;
  try { combined = await client.getCombinedStatus(sha); } catch (e) { return { event: null, checksState: prev ? prev.checks_state : null }; }
  var state = combined && combined.state; // 'success' | 'failure' | 'error' | 'pending'
  if (!state || state === 'pending') return { event: null, checksState: state || (prev ? prev.checks_state : null) };
  var shaChanged = !prev || prev.head_sha !== sha;
  if (!shaChanged && prev.checks_state === state) return { event: null, checksState: state };
  var failed = state === 'failure' || state === 'error';
  return { event: { event: failed ? 'checks_failed' : 'checks', title: (failed ? 'checks failed' : 'checks passed') + ' (' + combined.total_count + ' check' + (combined.total_count === 1 ? '' : 's') + ')' }, checksState: state };
}

async function tick(client, opts) {
  opts = opts || {};
  var cfg = config();
  var actions = [];
  if (!cfg.enabled) { actions.push({ action: 'disabled' }); return { ok: true, actions: actions }; }
  var pulls;
  try { pulls = await client.listPulls(); } catch (e) { actions.push({ action: 'fetch_failed', error: short(String(e && e.message || e), 300) }); return { ok: false, actions: actions }; }
  pulls = pulls.slice(0, cfg.maxPerTick);
  var state = readState(cfg);
  var changed = false;
  for (var i = 0; i < pulls.length; i++) {
    var pr = pulls[i];
    var prev = state[pr.number] || null;
    if (prev && prev.updated_at === pr.updated_at && prev.state === pr.state && !!prev.merged === !!pr.merged_at) {
      actions.push({ action: 'unchanged', pr: pr.number });
      continue;
    }
    // The list endpoint used above does not reliably carry `mergeable_state`
    // (GitHub computes it asynchronously and only returns it from the
    // single-PR endpoint); fetch full details for every PR that changed.
    try { pr = await client.getPull(pr.number); } catch (e) { actions.push({ action: 'get_pull_failed', pr: pr.number, error: short(String(e && e.message || e), 200) }); continue; }
    var events = transitionsFor(prev, pr);
    var snap = snapshot(pr);
    if (pr.state === 'open') {
      var rv = await reviewEvent(client, pr, prev);
      if (rv.event) events.push(rv.event);
      snap.last_review_id = rv.lastReviewId;
      var ck = await checksEvent(client, pr, prev);
      if (ck.event) events.push(ck.event);
      snap.checks_state = ck.checksState;
    }
    for (var j = 0; j < events.length; j++) {
      var ev = events[j];
      if (opts.dryRun) { actions.push({ action: 'would_notify', pr: pr.number, event: ev.event }); continue; }
      var res = await notifyTelegram({
        category: 'pr', event: ev.event, key: pr.number + ':' + ev.event + ':' + (snap.head_sha || snap.updated_at),
        id: '#' + pr.number, title: ev.title
      });
      actions.push({ action: 'notify', pr: pr.number, event: ev.event, result: res });
      log('event', { pr: pr.number, event: ev.event, sent: !!res.sent });
    }
    if (!opts.dryRun) { state[pr.number] = snap; changed = true; }
  }
  if (changed) writeState(cfg, state);
  return { ok: true, actions: actions, fetched: pulls.length };
}

function clientFor(opts) {
  var icfg = issues.config();
  var token = issues.readToken();
  return issues.createClient(icfg, token, opts || {});
}

async function prWatchTick(opts) {
  opts = opts || {};
  try { bridge.userGuard(); } catch (e) { return { ok: false, reason: e.message }; }
  var lock = bridge.acquireLock(config().issues.bridge);
  if (!lock) return { ok: false, reason: 'another bridge process holds the lock' };
  try {
    var client = clientFor(opts);
    var r = await tick(client, opts);
    bridge.releaseLock(lock);
    return r;
  } catch (e) {
    bridge.releaseLock(lock);
    return { ok: false, reason: short(String(e && e.message || e), 400) };
  }
}

function status() {
  var cfg = config();
  var state = readState(cfg);
  return {
    channel: BY, enabled: cfg.enabled, tracked_prs: Object.keys(state).length,
    prs: Object.keys(state).sort(function (a, b) { return Number(a) - Number(b); }).map(function (n) {
      var s = state[n];
      return { pr: Number(n), state: s.state, merged: s.merged, draft: s.draft, mergeable_state: s.mergeable_state, checks_state: s.checks_state };
    })
  };
}

module.exports = {
  BY: BY,
  config: config,
  snapshot: snapshot,
  transitionsFor: transitionsFor,
  reviewEvent: reviewEvent,
  checksEvent: checksEvent,
  tick: tick,
  clientFor: clientFor,
  prWatchTick: prWatchTick,
  status: status
};
