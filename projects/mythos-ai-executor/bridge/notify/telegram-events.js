'use strict';
// =====================================================
// MYTHOS unified Telegram event notifier
// projects/mythos-ai-executor/bridge/notify/telegram-events.js
//
// Extends the existing Telegram Lifecycle Notifications (bridge/telegram.js,
// which replies inside the chat that STARTED a Telegram-origin task) into a
// single, generic outbound channel for every important MYTHOS/GitHub event,
// regardless of where the task came from: a GitHub Issue, a control-branch
// planner task, a pull request, or the bridge/governance layer itself.
//
// This module owns exactly three things:
//   1. an importance filter (only events explicitly classified as notable);
//   2. deduplication + rate limiting, so the same fact is never sent twice
//      and a burst of routine events cannot flood the chat — while a
//      critical event (failure, blocker, governance/production problem)
//      always bypasses the rate limiter, because hiding those is worse than
//      spamming for them;
//   3. one unified, minimal message format.
//
// It does NOT talk to the Bot API directly: it reuses bridge/telegram.js's
// existing config()/readToken()/createClient()/scrub() (same bot, same
// token, same MYTHOS_TELEGRAM_ALLOWED_USER_IDS allowlist — no second bot,
// no allowlist expansion, no new credential). It broadcasts to every
// allowlisted owner id, because these are system-wide events, not replies
// to a specific chat.
//
// Security (gh-issue-187 §6): a message built here NEVER carries a bot
// token, another secret shape, an executor task id, an execution id, an
// OTHMODE numeric id, or a filesystem path — stripInternal() removes those
// shapes as defense in depth even if a caller's `title`/`next_action` text
// accidentally contains one, in addition to the shared secret redaction and
// telegram.js's own token scrub. OTHMODE is described only as "MYTHOS
// protection/monitoring", exactly like the existing lifecycle texts.
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var telegram = require('../telegram');
var bridge = require('../github-bridge');
var redact = require(path.join(__dirname, '..', '..', '..', 'mythos-orchestrator', 'lib', 'redact'));

var CATEGORY_LABEL = { task: 'TASK', pr: 'PR', git: 'SYSTEM' };

// Every event this module knows how to send. `critical: true` events bypass
// the rate limiter (never suppressed) and are notified even when the caller
// does not say so explicitly.
var EVENT_DEFS = {
  'task:created': { critical: false },
  'task:claimed': { critical: false },
  'task:completed': { critical: false },
  'task:failed': { critical: true },
  'task:blocked': { critical: true },
  'task:human_approval': { critical: true },
  'task:cancelled': { critical: false },
  'pr:opened': { critical: false },
  'pr:updated': { critical: false },
  'pr:review': { critical: false },
  'pr:checks': { critical: false },
  'pr:checks_failed': { critical: true },
  'pr:merged': { critical: false },
  'pr:closed_without_merge': { critical: false },
  'pr:conflict': { critical: true },
  'git:deploy': { critical: false },
  'git:sync_blocker': { critical: true },
  'git:governance_blocker': { critical: true },
  'git:bridge_failure': { critical: true }
};
var DEFAULT_EVENTS = Object.keys(EVENT_DEFS);

// Identifier/path stripping lives in the shared presenter (gh-issue-191);
// kept exported here for compatibility.
var presenter = require('./presenter');
var stripInternal = presenter.stripInternal;

function nowIso() { return new Date().toISOString(); }
function nowMs() { return Date.now(); }
function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

function parseEventList(raw) {
  var v = String(raw || '').trim();
  if (!v || v.toLowerCase() === 'all') return DEFAULT_EVENTS.slice();
  return v.split(/[,\s]+/).map(function (s) { return s.trim(); }).filter(function (s) { return EVENT_DEFS.hasOwnProperty(s); });
}

function clampInt(v, def, min, max) {
  var n = parseInt(v, 10);
  if (!(n >= min && n <= max)) return def;
  return n;
}

function config() {
  var t = telegram.config();
  var events = process.env.MYTHOS_TELEGRAM_NOTIFY_EVENTS ? parseEventList(process.env.MYTHOS_TELEGRAM_NOTIFY_EVENTS) : DEFAULT_EVENTS.slice();
  if (!events.length) events = DEFAULT_EVENTS.slice();
  return {
    telegram: t,
    enabled: t.enabled,
    allowedUserIds: t.allowedUserIds,
    home: path.join(t.bridge.home, 'telegram-events'),
    events: events,
    rateMax: clampInt(process.env.MYTHOS_TELEGRAM_NOTIFY_RATE_MAX, 20, 1, 500),
    rateWindowSeconds: clampInt(process.env.MYTHOS_TELEGRAM_NOTIFY_RATE_WINDOW_SECONDS, 60, 10, 3600)
  };
}

function ensureHome(cfg) { fs.mkdirSync(cfg.home, { recursive: true, mode: 0o700 }); }
function ledgerFile(cfg) { return path.join(cfg.home, 'ledger.json'); }
function rateFile(cfg) { return path.join(cfg.home, 'rate.json'); }

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }
function writeAtomic(file, value) {
  var tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readLedger(cfg) { return readJson(ledgerFile(cfg)) || {}; }
function writeLedger(cfg, ledger) { ensureHome(cfg); writeAtomic(ledgerFile(cfg), ledger); }

// Sliding window of send timestamps (ms), pruned on every check. One shared
// bucket: the requirement is "do not flood the channel", not per-category
// quotas.
function readRate(cfg) { var v = readJson(rateFile(cfg)); return (v && Array.isArray(v.sent)) ? v.sent : []; }
function writeRate(cfg, sent) { ensureHome(cfg); writeAtomic(rateFile(cfg), { sent: sent }); }

function rateLimited(cfg) {
  var windowMs = cfg.rateWindowSeconds * 1000;
  var cutoff = nowMs() - windowMs;
  var sent = readRate(cfg).filter(function (ts) { return ts > cutoff; });
  return { limited: sent.length >= cfg.rateMax, sent: sent };
}
function recordSend(cfg, sent) { writeRate(cfg, sent.concat([nowMs()])); }

function log(event, fields) { bridge.log('telegram-events:' + event, fields || {}); }

// --- Message format (unified, plain text, no secrets, no internal ids) --------------

// Rendered by the shared presenter (gh-issue-191): level icon, unified
// header, short title/result, simple Arabic explanation, what the owner must
// do, model/guard tail. Identical presentation logic to WhatsApp.
function formatEvent(evt) {
  return presenter.presentEvent(evt).text;
}

// --- Send -----------------------------------------------------------------------------

// evt = { category: 'task'|'pr'|'git', event: string (without category
// prefix), key: string (unique dedup key), id, status, title, result,
// next_action, model, guard, critical (optional override) }
async function notifyEvent(evt, opts) {
  opts = opts || {};
  var cfg = config();
  if (!cfg.enabled) return { sent: false, reason: 'disabled' };
  if (!cfg.allowedUserIds.length) return { sent: false, reason: 'no allowlisted recipients' };
  var fullEvent = evt.category + ':' + evt.event;
  var def = EVENT_DEFS[fullEvent];
  if (!def) return { sent: false, reason: 'unknown event ' + fullEvent };
  if (cfg.events.indexOf(fullEvent) === -1) return { sent: false, reason: 'filtered by MYTHOS_TELEGRAM_NOTIFY_EVENTS' };
  if (!evt.key) return { sent: false, reason: 'missing dedup key' };
  var critical = evt.critical !== undefined ? !!evt.critical : def.critical;

  var ledger = readLedger(cfg);
  var dedupKey = sha256(fullEvent + '' + evt.key);
  if (ledger[dedupKey]) return { sent: false, reason: 'duplicate', existed: true, at: ledger[dedupKey].at };

  if (!critical) {
    var rl = rateLimited(cfg);
    if (rl.limited) {
      log('rate_limited', { event: fullEvent, key: evt.key });
      return { sent: false, reason: 'rate_limited' };
    }
  }

  if (opts.dryRun) return { sent: false, reason: 'dry_run', would_send: true, text: formatEvent(evt) };

  var text = stripInternal(formatEvent(evt));
  var token = telegram.readToken();
  var client = telegram.createClient(cfg.telegram, token, {});
  var sentTo = {};
  var errors = [];
  for (var i = 0; i < cfg.allowedUserIds.length; i++) {
    var chatId = cfg.allowedUserIds[i];
    try {
      var res = await client.sendMessage(Number(chatId), text);
      sentTo[chatId] = res && res.message_id !== undefined ? res.message_id : null;
    } catch (e) {
      errors.push(telegram.scrub(String(e && e.message || e), token));
    }
  }
  var delivered = Object.keys(sentTo).length > 0;
  if (delivered) {
    ledger[dedupKey] = { at: nowIso(), event: fullEvent, key: evt.key, message_ids: sentTo };
    writeLedger(cfg, ledger);
    if (!critical) { var rl2 = rateLimited(cfg); recordSend(cfg, rl2.sent); }
    log('sent', { event: fullEvent, key: evt.key, recipients: Object.keys(sentTo).length, critical: critical });
  } else {
    log('send_failed', { event: fullEvent, key: evt.key, errors: errors });
  }
  return { sent: delivered, message_ids: sentTo, errors: errors.length ? errors : undefined };
}

function describe() {
  var cfg = config();
  var rl = rateLimited(cfg);
  var ledger = readLedger(cfg);
  return {
    enabled: cfg.enabled, allowed_recipients: cfg.allowedUserIds.length, events: cfg.events,
    rate_max: cfg.rateMax, rate_window_seconds: cfg.rateWindowSeconds,
    rate_used: rl.sent.length, ledger_entries: Object.keys(ledger).length, home: cfg.home
  };
}

module.exports = {
  EVENT_DEFS: EVENT_DEFS,
  DEFAULT_EVENTS: DEFAULT_EVENTS,
  config: config,
  formatEvent: formatEvent,
  stripInternal: stripInternal,
  notifyEvent: notifyEvent,
  describe: describe
};
