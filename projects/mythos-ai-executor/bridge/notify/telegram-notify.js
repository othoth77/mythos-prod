'use strict';
// =====================================================
// MYTHOS — unified Telegram notification sink
// projects/mythos-ai-executor/bridge/notify/telegram-notify.js
//
// Expands the existing Telegram channel (bridge/telegram.js, which replies
// only inside the chat that started a Telegram-originated task) into the
// single Telegram destination for every MYTHOS/GitHub event an owner needs
// to see: GitHub Issue/TASK lifecycle, pull request lifecycle, and
// git/governance/bridge blockers. It reuses the SAME bot (no second bot, no
// second gateway) purely as a message sink — it never polls `getUpdates`,
// never authorises anything, and never runs a task.
//
// Two-phase design, identical in spirit to bridge/notify/whatsapp.js:
//
//   enqueue()  synchronous, local-only, never network. Writes at most one
//              durable ledger entry per (subject, kind) and returns. Safe to
//              call from inside a bridge tick — a Telegram outage can never
//              slow or fail the tick that reports the event.
//   flush()    asynchronous, called AFTER the tick has returned. Talks to
//              the Bot API, paces sends, retries, records the outcome.
//
// Anti-spam / anti-duplication (the actual requirement, not decoration):
//   - dedup: the ledger key is (subject, kind); an unchanged message for a
//     key that already reached SENT is never resent. A key whose content
//     changed (a different result, a flipped check state) DOES get a fresh
//     entry — dedup suppresses noise, never a real state change;
//   - rate limiting: flush() paces sends at least `minGapMs` apart and caps
//     entries per flush (`maxPerFlush`), so a burst of events (e.g. every
//     open PR getting an event on first run) cannot flood the chat or trip
//     Telegram's own flood control;
//   - failure/blocker kinds are never dropped by pacing or the per-flush
//     cap — they simply wait for the next flush, exactly like everything
//     else in the queue; nothing in this module silently discards a
//     failure/blocker notification.
//
// Security: no bot token, executor task id, execution id, OTHMODE numeric
// id, or host path is ever placed in a message — callers pass only a
// subject label + number/task id, a short description/result/reason, and
// (optionally) a model name. OTHMODE itself is described only as "نظام
// حماية/مراقبة MYTHOS" per the repository's own convention. Every message is
// redacted before it is stored or sent.
//
// telegram.js is required LAZILY (inside functions), never at module load
// time: telegram.js requires bridge/github-bridge.js, and github-bridge.js
// will require this module, so a top-level require here would form a
// circular require and telegram.js would capture a stale, empty exports
// object. Deferring the require until a function actually runs (after every
// module has finished loading) avoids that entirely.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');

var state = require('../../lib/state');
var redact = require('../../../mythos-orchestrator/lib/redact');

function telegramChannel() { return require('../telegram'); }

var KINDS = [
  'TASK_CREATED', 'TASK_STARTED', 'TASK_COMPLETED', 'TASK_FAILED', 'TASK_BLOCKED', 'HUMAN_APPROVAL',
  'PR_OPENED', 'PR_UPDATED', 'PR_REVIEW', 'PR_CHECKS', 'PR_MERGED', 'PR_CLOSED',
  'GIT_BLOCKER', 'GOVERNANCE_BLOCKER', 'BRIDGE_FAILURE'
];
// Kinds that must never be silently dropped by pacing/backoff exhaustion at
// the low attempt counts used for routine updates.
var CRITICAL_KINDS = ['TASK_FAILED', 'TASK_BLOCKED', 'HUMAN_APPROVAL', 'GIT_BLOCKER', 'GOVERNANCE_BLOCKER', 'BRIDGE_FAILURE'];

var EMOJI = {
  TASK_CREATED: '🟡', TASK_STARTED: '🔵', TASK_COMPLETED: '🟢', TASK_FAILED: '🔴', TASK_BLOCKED: '🔴',
  HUMAN_APPROVAL: '🙋', PR_OPENED: '🔀', PR_UPDATED: '🔁', PR_REVIEW: '👀', PR_CHECKS: '🧪',
  PR_MERGED: '🔀', PR_CLOSED: '⚪', GIT_BLOCKER: '🔴', GOVERNANCE_BLOCKER: '🔴', BRIDGE_FAILURE: '🔴'
};

var MAX_MESSAGE = 3500;
var MAX_FIELD = 700;
var KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,90}__(?:TASK_CREATED|TASK_STARTED|TASK_COMPLETED|TASK_FAILED|TASK_BLOCKED|HUMAN_APPROVAL|PR_OPENED|PR_UPDATED|PR_REVIEW|PR_CHECKS|PR_MERGED|PR_CLOSED|GIT_BLOCKER|GOVERNANCE_BLOCKER|BRIDGE_FAILURE)$/;
var DEFAULT_MIN_GAP_MS = 1200;
var DEFAULT_MAX_PER_FLUSH = 10;
var DEFAULT_MAX_ATTEMPTS = 6;
var DEFAULT_BACKOFF_MS = 20000;
var MAX_BACKOFF_MS = 15 * 60 * 1000;

// --- Configuration -----------------------------------------------------------------

function envList(name) {
  return String(process.env[name] || '').split(/[,\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function bridgeHome() { return process.env.MYTHOS_BRIDGE_HOME || path.join(state.root(), 'bridge'); }

function config() {
  var home = process.env.MYTHOS_TELEGRAM_NOTIFY_HOME || path.join(bridgeHome(), 'telegram-notify');
  var kinds = envList('MYTHOS_TELEGRAM_NOTIFY_EVENTS').map(function (k) { return k.toUpperCase(); }).filter(function (k) { return KINDS.indexOf(k) !== -1; });
  var chatIds = envList('MYTHOS_TELEGRAM_NOTIFY_CHAT_IDS').filter(function (s) { return /^-?\d{1,20}$/.test(s); });
  return {
    // Off by default in every environment, including production, exactly
    // like every other notification sink in this bridge (WhatsApp,
    // Telegram intake). The owner turns it on deliberately.
    enabled: process.env.MYTHOS_TELEGRAM_NOTIFY_ENABLED === '1',
    kinds: kinds.length ? kinds : KINDS.slice(),
    // No new allowlist: the default recipients are the SAME Telegram users
    // already allowed to talk to the bridge. A dedicated list is an
    // explicit override, never an expansion made by this module itself.
    chatIdsOverride: chatIds,
    minGapMs: Math.max(200, parseInt(process.env.MYTHOS_TELEGRAM_NOTIFY_MIN_GAP_MS || String(DEFAULT_MIN_GAP_MS), 10) || DEFAULT_MIN_GAP_MS),
    maxPerFlush: Math.max(1, parseInt(process.env.MYTHOS_TELEGRAM_NOTIFY_MAX_PER_FLUSH || String(DEFAULT_MAX_PER_FLUSH), 10) || DEFAULT_MAX_PER_FLUSH),
    maxAttempts: Math.max(1, parseInt(process.env.MYTHOS_TELEGRAM_NOTIFY_MAX_ATTEMPTS || String(DEFAULT_MAX_ATTEMPTS), 10) || DEFAULT_MAX_ATTEMPTS),
    backoffMs: Math.max(1000, parseInt(process.env.MYTHOS_TELEGRAM_NOTIFY_BACKOFF_MS || String(DEFAULT_BACKOFF_MS), 10) || DEFAULT_BACKOFF_MS),
    home: home,
    ledgerDir: path.join(home, 'ledger'),
    paceFile: path.join(home, 'pace.json')
  };
}

function recipients(cfg, tcfg) {
  if (cfg.chatIdsOverride.length) return cfg.chatIdsOverride.slice();
  return (tcfg.allowedUserIds || []).slice();
}

// --- Small local logger (no dependency on github-bridge.js: see the header) --------

function log(event, fields) {
  try {
    var cfg = config();
    fs.mkdirSync(cfg.home, { recursive: true, mode: 0o700 });
    var entry = Object.assign({ ts: new Date().toISOString(), bridge: 'telegram-notify:' + event }, fields || {});
    fs.appendFileSync(path.join(cfg.home, 'events.log'), JSON.stringify(redact.redactValue ? redact.redactValue(entry) : entry) + '\n', { mode: 0o600 });
  } catch (e) { /* logging must never break a caller */ }
}

// --- Message formatting (plain text, no markup, no secrets) ------------------------

function clip(text, max) {
  var s = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function subjectText(f) {
  var label = f.subjectLabel || 'TASK';
  if (f.number !== undefined && f.number !== null && f.number !== '') return label + ' #' + f.number;
  return label + ' ' + (f.taskId || '?');
}

// Pure. `fields` never carries executor ids, execution ids, OTHMODE numeric
// ids or filesystem paths — callers (github-bridge.js, github-issues.js,
// github-prs.js) build only the fields declared here.
function formatMessage(kind, fields) {
  var f = fields || {};
  var mark = f.mark || EMOJI[kind] || 'ℹ️';
  var subj = subjectText(f);
  var lines = [];
  switch (kind) {
    case 'TASK_CREATED':
      lines.push(mark + ' ' + subj + ' — تم إنشاء المهمة.');
      if (f.description) lines.push('الوصف: ' + clip(f.description, MAX_FIELD));
      break;
    case 'TASK_STARTED':
      lines.push(mark + ' ' + subj + ' — بدأ التنفيذ.');
      if (f.model) lines.push('🤖 ' + f.model);
      break;
    case 'TASK_COMPLETED':
      lines.push(mark + ' ' + subj + ' — اكتملت المهمة.');
      if (f.result) lines.push('النتيجة: ' + clip(f.result, MAX_FIELD));
      if (f.model) lines.push('🤖 ' + f.model);
      break;
    case 'TASK_FAILED':
      lines.push(mark + ' ' + subj + ' — فشلت المهمة.');
      if (f.reason) lines.push('السبب: ' + clip(f.reason, MAX_FIELD));
      lines.push('👉 المطلوب: مراجعة المالك.');
      break;
    case 'TASK_BLOCKED':
      lines.push(mark + ' ' + subj + ' — متوقفة.');
      if (f.reason) lines.push('السبب: ' + clip(f.reason, MAX_FIELD));
      lines.push('👉 المطلوب: تدخل المالك.');
      break;
    case 'HUMAN_APPROVAL':
      lines.push(mark + ' ' + subj + ' — بانتظار قرار المالك.');
      if (f.reason) lines.push('السبب: ' + clip(f.reason, MAX_FIELD));
      lines.push('👉 المطلوب: تدخل المالك.');
      break;
    case 'PR_OPENED':
      lines.push(mark + ' ' + subj + ' — تم فتح Pull Request.');
      if (f.description) lines.push(clip(f.description, 400));
      break;
    case 'PR_UPDATED':
      lines.push(mark + ' ' + subj + ' — تحديث مهم (commits جديدة).');
      if (f.description) lines.push(clip(f.description, 400));
      break;
    case 'PR_REVIEW':
      lines.push(mark + ' ' + subj + ' — مراجعة.');
      if (f.result) lines.push('الحالة: ' + clip(f.result, 400));
      break;
    case 'PR_CHECKS':
      lines.push(mark + ' ' + subj + ' — نتائج الاختبارات.');
      if (f.result) lines.push('الحالة: ' + clip(f.result, 400));
      break;
    case 'PR_MERGED':
      lines.push(mark + ' ' + subj + ' — تم الدمج.');
      if (f.result) lines.push('النتيجة: ' + clip(f.result, 400));
      break;
    case 'PR_CLOSED':
      lines.push(mark + ' ' + subj + ' — أُغلق دون دمج.');
      if (f.reason) lines.push('السبب: ' + clip(f.reason, 400));
      break;
    case 'GIT_BLOCKER':
      lines.push(mark + ' نظام حماية/مراقبة MYTHOS — مزامنة Git متوقفة.');
      if (f.reason) lines.push('السبب: ' + clip(f.reason, MAX_FIELD));
      lines.push('👉 المطلوب: تدخل المالك.');
      break;
    case 'GOVERNANCE_BLOCKER':
      lines.push(mark + ' نظام حماية/مراقبة MYTHOS — منع الحوكمة (Governance).');
      if (f.reason) lines.push('السبب: ' + clip(f.reason, MAX_FIELD));
      lines.push('👉 المطلوب: تدخل المالك.');
      break;
    case 'BRIDGE_FAILURE':
      lines.push(mark + ' نظام حماية/مراقبة MYTHOS — عطل في التنفيذ (bridge/executor).');
      if (f.reason) lines.push('السبب: ' + clip(f.reason, MAX_FIELD));
      lines.push('👉 المطلوب: تدخل المالك.');
      break;
    default:
      lines.push(mark + ' ' + subj + ' — ' + kind);
  }
  if (f.ownerAction && CRITICAL_KINDS.indexOf(kind) === -1) lines.push('التالي: ' + clip(f.ownerAction, 400));
  return redact.redact(lines.join('\n')).slice(0, MAX_MESSAGE);
}

// --- TASK lifecycle → kind mapping (used by github-bridge.js finishTask()) ---------

// Mirrors bridge/notify/whatsapp.js's notificationKind(): HUMAN_APPROVAL is
// the bridge's existing "stopped for a human decision" condition (a BLOCKED
// report the caller has already classified), never a separate control
// status. CANCELLED and every non-terminal status never notify here.
function kindForReport(status, opts) {
  if (opts && opts.human_approval && status === 'BLOCKED') return 'HUMAN_APPROVAL';
  if (status === 'COMPLETED') return 'TASK_COMPLETED';
  if (status === 'FAILED') return 'TASK_FAILED';
  if (status === 'BLOCKED') return 'TASK_BLOCKED';
  return null;
}

// Builds the field set from a bridge report + task, never from a raw
// executing-session string beyond the report's own declared summary/reason
// fields (which are redacted again by formatMessage()).
function fieldsFromReport(task, report) {
  var src = task.source || {};
  var isIssue = src.kind === 'github-issue';
  var reason = null;
  if (report.blocker && report.blocker.reason) reason = report.blocker.reason;
  else if (Array.isArray(report.problems) && report.problems.length) reason = report.problems[0];
  return {
    subjectLabel: 'TASK',
    number: isIssue ? src.issue_number : null,
    taskId: task.task_id,
    result: report.summary || null,
    reason: reason,
    ownerAction: report.next_recommended_action || null,
    model: (report.execution && report.execution.model) || task.model || null
  };
}

// --- Local durable state (outside Git, like every other bridge store) --------------

function ensureHome(cfg) { fs.mkdirSync(cfg.ledgerDir, { recursive: true, mode: 0o700 }); }

function writeAtomic(file, value) {
  var dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  var tmp = file + '.tmp-' + process.pid;
  var fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function sanitizeSubject(subject) {
  return String(subject == null ? '' : subject).replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 80) || 'unknown';
}

function ledgerKey(subject, kind) {
  var key = sanitizeSubject(subject) + '__' + String(kind);
  if (!KEY_RE.test(key)) throw new Error('TELEGRAM_NOTIFY_KEY_INVALID: ' + JSON.stringify(String(subject)).slice(0, 80) + '/' + JSON.stringify(String(kind)).slice(0, 40));
  return key;
}

function entryFile(cfg, key) { return path.join(cfg.ledgerDir, key + '.json'); }

function readEntry(cfg, key) {
  try { return JSON.parse(fs.readFileSync(entryFile(cfg, key), 'utf8')); } catch (e) { return null; }
}

function writeEntry(cfg, entry) { ensureHome(cfg); writeAtomic(entryFile(cfg, entry.key), entry); return entry; }

function listEntries(cfg) {
  var out = [];
  if (!fs.existsSync(cfg.ledgerDir)) return out;
  fs.readdirSync(cfg.ledgerDir).forEach(function (name) {
    if (!/\.json$/.test(name)) return;
    var key = name.replace(/\.json$/, '');
    if (!KEY_RE.test(key)) return;
    var e = readEntry(cfg, key);
    if (e) out.push(e);
  });
  return out.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
}

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

// --- Phase 1: enqueue (synchronous, never throws, never network) -------------------

// Writes a ledger entry when the event is new or its content changed since
// the last entry for the same (subject, kind); does nothing when the
// content is identical to what is already queued or already sent — that IS
// the deduplication requirement, not an incidental side effect.
function enqueue(kind, subject, fields, opts) {
  opts = opts || {};
  try {
    if (KINDS.indexOf(kind) === -1) return { queued: false, error: 'unknown kind ' + kind };
    var cfg = config();
    if (!cfg.enabled) return { queued: false, skipped: 'telegram notifications disabled' };
    if (cfg.kinds.indexOf(kind) === -1) return { queued: false, kind: kind, skipped: 'kind not enabled' };
    var key = ledgerKey(subject, kind);
    var message = formatMessage(kind, fields);
    var sha = sha256(message);
    var existing = readEntry(cfg, key);
    if (existing && existing.message_sha256 === sha && (existing.state === 'SENT' || existing.state === 'PENDING')) {
      return { queued: false, key: key, kind: kind, skipped: 'duplicate (' + existing.state + ', unchanged)' };
    }
    var now = new Date().toISOString();
    writeEntry(cfg, {
      key: key, subject: sanitizeSubject(subject), kind: kind, state: 'PENDING',
      message: message, message_sha256: sha, attempts: 0, delivered_to: [],
      created_at: now, updated_at: now, next_attempt_at: now,
      created_by: 'mythos-ai-executor@' + os.hostname(), last_error: null
    });
    log('enqueued', { key: key, kind: kind, changed: !!existing });
    return { queued: true, key: key, kind: kind };
  } catch (e) {
    return { queued: false, error: redact.redact(String(e && e.message)).slice(0, 300) };
  }
}

// --- Phase 2: flush (asynchronous, called after the tick has returned) -------------

function readPace(cfg) {
  try { var v = JSON.parse(fs.readFileSync(cfg.paceFile, 'utf8')); return (v && v.last_sent_at) || 0; } catch (e) { return 0; }
}
function writePace(cfg, ms) { try { writeAtomic(cfg.paceFile, { last_sent_at: ms }); } catch (e) { /* pacing state loss just costs one extra gap */ } }

function due(entry, nowMs) {
  if (entry.state !== 'PENDING') return false;
  return !entry.next_attempt_at || Date.parse(entry.next_attempt_at) <= nowMs;
}

function backoffFor(cfg, attempts) { return Math.min(cfg.backoffMs * Math.pow(2, Math.max(0, attempts - 1)), MAX_BACKOFF_MS); }

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

// Delivers every due entry, oldest first, respecting a minimum gap between
// sends and a per-flush cap. Always resolves.
function flush(opts) {
  opts = opts || {};
  var cfg;
  try { cfg = config(); } catch (e) { return Promise.resolve({ ok: false, error: redact.redact(String(e && e.message)).slice(0, 300) }); }
  if (!cfg.enabled) return Promise.resolve({ ok: true, enabled: false, attempted: 0, sent: 0, failed: 0, results: [] });

  var tmod, tcfg, token, client;
  try {
    tmod = telegramChannel();
    tcfg = tmod.config();
    token = tmod.readToken();
    client = tmod.createClient(tcfg, token, {});
  } catch (e) {
    return Promise.resolve({ ok: false, enabled: true, attempted: 0, sent: 0, failed: 0, problems: [String(e && e.message).slice(0, 200)], results: [] });
  }
  var chatIds = recipients(cfg, tcfg);
  var problems = [];
  if (!token) problems.push('no Telegram bot token configured');
  if (!chatIds.length) problems.push('no notification recipients (MYTHOS_TELEGRAM_NOTIFY_CHAT_IDS / MYTHOS_TELEGRAM_ALLOWED_USER_IDS)');
  if (problems.length) return Promise.resolve({ ok: false, enabled: true, attempted: 0, sent: 0, failed: 0, problems: problems, results: [] });

  var batch;
  try {
    var now = Date.now();
    batch = listEntries(cfg).filter(function (e) { return due(e, now); }).slice(0, opts.limit || cfg.maxPerFlush);
  } catch (e) {
    return Promise.resolve({ ok: false, enabled: true, error: redact.redact(String(e && e.message)).slice(0, 300), results: [] });
  }
  if (!batch.length) return Promise.resolve({ ok: true, enabled: true, attempted: 0, sent: 0, failed: 0, results: [] });

  var results = [];
  var chain = Promise.resolve();
  batch.forEach(function (entry) {
    chain = chain.then(function () {
      var gap = cfg.minGapMs - (Date.now() - readPace(cfg));
      return (gap > 0 ? sleep(gap) : Promise.resolve()).then(function () {
        var targets = chatIds.filter(function (id) { return (entry.delivered_to || []).indexOf(id) === -1; });
        if (!targets.length) {
          entry.state = 'SENT';
          entry.updated_at = new Date().toISOString();
          writeEntry(cfg, entry);
          results.push({ key: entry.key, sent: true, recipients: 0 });
          return;
        }
        entry.attempts = (entry.attempts || 0) + 1;
        var sendChain = Promise.resolve();
        var errors = [];
        targets.forEach(function (chatId) {
          sendChain = sendChain.then(function () {
            writePace(cfg, Date.now());
            return client.sendMessage(chatId, entry.message).then(function () {
              entry.delivered_to = (entry.delivered_to || []).concat([chatId]);
              writeEntry(cfg, entry);
            }, function (e) {
              errors.push(redact.redact(String(e && e.message)).slice(0, 300));
            });
          });
        });
        return sendChain.then(function () {
          entry.updated_at = new Date().toISOString();
          if (!errors.length) {
            entry.state = 'SENT';
            entry.last_error = null;
            writeEntry(cfg, entry);
            results.push({ key: entry.key, sent: true, kind: entry.kind, attempts: entry.attempts });
            log('sent', { key: entry.key, kind: entry.kind, attempts: entry.attempts });
          } else {
            entry.last_error = errors[0];
            if (entry.attempts >= cfg.maxAttempts) {
              entry.state = 'EXHAUSTED';
              writeEntry(cfg, entry);
              results.push({ key: entry.key, sent: false, exhausted: true, kind: entry.kind, error: entry.last_error });
              log('exhausted', { key: entry.key, kind: entry.kind, error: entry.last_error });
            } else {
              entry.next_attempt_at = new Date(Date.now() + backoffFor(cfg, entry.attempts)).toISOString();
              writeEntry(cfg, entry);
              results.push({ key: entry.key, sent: false, retry_at: entry.next_attempt_at, kind: entry.kind, error: entry.last_error });
            }
          }
        });
      });
    });
  });
  return chain.then(function () {
    return {
      ok: true, enabled: true,
      attempted: results.length,
      sent: results.filter(function (r) { return r.sent; }).length,
      failed: results.filter(function (r) { return r.sent === false; }).length,
      results: results
    };
  });
}

// --- Operator surface ----------------------------------------------------------------

function describe() {
  var cfg = config();
  return {
    enabled: cfg.enabled, kinds: cfg.kinds, min_gap_ms: cfg.minGapMs, max_per_flush: cfg.maxPerFlush,
    max_attempts: cfg.maxAttempts, backoff_ms: cfg.backoffMs,
    recipients_override: cfg.chatIdsOverride.length, ledger_dir: cfg.ledgerDir
  };
}

function ledgerStatus() {
  var cfg = config();
  var counts = { PENDING: 0, SENT: 0, EXHAUSTED: 0 };
  var rows = listEntries(cfg).map(function (e) {
    counts[e.state] = (counts[e.state] || 0) + 1;
    return { key: e.key, subject: e.subject, kind: e.kind, state: e.state, attempts: e.attempts, created_at: e.created_at, updated_at: e.updated_at, last_error: e.last_error || null };
  });
  return { ledger_dir: cfg.ledgerDir, counts: counts, entries: rows };
}

module.exports = {
  KINDS: KINDS,
  CRITICAL_KINDS: CRITICAL_KINDS,
  config: config,
  describe: describe,
  formatMessage: formatMessage,
  kindForReport: kindForReport,
  fieldsFromReport: fieldsFromReport,
  ledgerKey: ledgerKey,
  readEntry: readEntry,
  listEntries: listEntries,
  enqueue: enqueue,
  flush: flush,
  ledgerStatus: ledgerStatus
};
