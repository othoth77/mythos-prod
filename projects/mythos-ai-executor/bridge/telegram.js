'use strict';
// =====================================================
// MYTHOS Telegram → TASK channel adapter
// projects/mythos-ai-executor/bridge/telegram.js
//
// A second inbound channel next to GitHub Issues, built the same way and
// for the same reason: a channel is a BOUNDARY, never an engine. It turns a
// Telegram private message into a control TASK and a control REPORT into a
// Telegram reply — and nothing else. It does not run anything, decides no
// permission, and holds no execution authority.
//
//   Telegram private message (Bot API, long polling `getUpdates`)
//        │  intake (this file): normalise → allowlist → validate (bridge
//        │  rules, secret scan) → control/tasks/tg-<update_id>.json (PENDING,
//        │  source.kind=telegram) → one commit on mythos/control → one
//        │  "queued" reply in the same chat
//        ▼
//   github-bridge.tick()   ← UNCHANGED: claim → OTHMODE Task record → worktree →
//        │                   executor.createTask (profile bounded by requested_action)
//   mythos-ai-executor daemon runs the task (claude -p, OTHMODE contract, Resource
//        │                   Guard admission, lib/policy.js tool permissions)
//   github-bridge.tick()   ← UNCHANGED: control/reports/tg-<update_id>.json when terminal
//        │
//        │  notify (this file): "started" reply (executor id, OTHMODE id), then the
//        ▼  report reply (status, summary, tests, problems, next action)
//   Telegram chat updated
//
// Governance: a Telegram message can set exactly what an Issue can set —
// `Action:` (restricted further by MYTHOS_TELEGRAM_ALLOWED_ACTIONS, default
// investigate,review = READ only) and `Model:`. requested_action maps to an
// execution profile server-side (bridge/action-resolution.js) and the bridge
// refuses any mismatch before a provider starts. Nothing in a message can
// select a provider, a path, a tool or a credential. The executing session
// runs under the same OTHMODE contract, the same policy, the same Resource
// Guard and the same governance relay as every other task. There is no
// Telegram → shell path: the adapter's only outputs are control files and
// Bot API replies.
//
// Authorisation: MYTHOS_TELEGRAM_ALLOWED_USER_IDS (numeric Telegram user ids,
// comma-separated) is the allowlist. Empty allowlist = nothing is accepted.
// Only private chats are accepted (chat.id === from.id). A message from
// anyone else is dropped without a reply (the bot does not reveal itself)
// and recorded in the bridge log by user id only.
//
// Secrets: the bot token is read at call time from MYTHOS_TELEGRAM_BOT_TOKEN
// (environment, bound by the systemd drop-in from a 0600 file) or from a
// KEY=VALUE / raw file named by MYTHOS_TELEGRAM_BOT_TOKEN_FILE. It lives in a
// closure, is part of the Bot API URL only, and is scrubbed from every
// error, log line, task file and reply by scrub() in addition to the shared
// redaction. A message that carries a secret shape (including a bot token
// shape) is refused without echoing it.
//
// Idempotency: task_id `tg-<update_id>` is deterministic (an update seen
// twice is the same task); the poll offset is advanced only after the
// control commit; every reply is keyed (task_id, event) in a local ledger
// under the bridge home BEFORE it is sent, so a tick that dies between the
// send and the control commit does not repeat the reply.
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var EXEC_ROOT = path.join(__dirname, '..');
var bridge = require('./github-bridge');
var httpJson = require('./notify/http-json');
var redact = require(path.join(EXEC_ROOT, '..', 'mythos-orchestrator', 'lib', 'redact'));
var modelPolicy = require(path.join(EXEC_ROOT, 'lib', 'model-policy'));
var engine = require('./action-resolution');
var presenter = require('./notify/presenter');

var BY = 'telegram';
var TASK_RE = /^tg-(\d{1,20})$/;
var TERMINAL = ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'];
// Telegram bot token shape: <bot id>:<35 chars>. Not in the shared redaction
// list (that file is governance-protected), so it is scanned and scrubbed here.
var TOKEN_RE = /\b\d{6,12}:[A-Za-z0-9_-]{30,50}\b/g;
var LIMITS = { objective: 20000, notes: 16000, reply: 3500, summary: 2500 };
var DEFAULT_ALLOWED_ACTIONS = ['investigate', 'review'];

// --- Configuration ---------------------------------------------------------------

function parseIds(raw) {
  return String(raw || '').split(/[,\s]+/).map(function (s) { return s.trim(); }).filter(function (s) { return /^\d{1,20}$/.test(s); });
}

function parseActions(raw) {
  var list = String(raw || '').split(/[,\s]+/).map(function (s) { return engine.normalizeAction(s); }).filter(Boolean);
  return list.filter(function (a, i) { return list.indexOf(a) === i; });
}

function config() {
  var b = bridge.config();
  var allowedActions = process.env.MYTHOS_TELEGRAM_ALLOWED_ACTIONS ? parseActions(process.env.MYTHOS_TELEGRAM_ALLOWED_ACTIONS) : DEFAULT_ALLOWED_ACTIONS.slice();
  if (!allowedActions.length) allowedActions = DEFAULT_ALLOWED_ACTIONS.slice();
  var defaultAction = engine.normalizeAction(process.env.MYTHOS_TELEGRAM_DEFAULT_ACTION || 'investigate') || 'investigate';
  var pollSeconds = parseInt(process.env.MYTHOS_TELEGRAM_POLL_SECONDS || '0', 10);
  if (!(pollSeconds >= 0 && pollSeconds <= 50)) pollSeconds = 0;
  var timeoutMs = parseInt(process.env.MYTHOS_TELEGRAM_HTTP_TIMEOUT_MS || '20000', 10);
  if (timeoutMs < (pollSeconds + 5) * 1000) timeoutMs = (pollSeconds + 5) * 1000;
  return {
    bridge: b,
    enabled: process.env.MYTHOS_TELEGRAM_ENABLED === '1',
    apiBase: (process.env.MYTHOS_TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, ''),
    allowedUserIds: parseIds(process.env.MYTHOS_TELEGRAM_ALLOWED_USER_IDS),
    allowedActions: allowedActions,
    defaultAction: defaultAction,
    maxPerTick: Math.min(100, Math.max(1, parseInt(process.env.MYTHOS_TELEGRAM_MAX_PER_TICK || '10', 10) || 10)),
    pollSeconds: pollSeconds,
    timeoutMs: timeoutMs,
    home: path.join(b.home, 'telegram'),
    tokenSource: process.env.MYTHOS_TELEGRAM_BOT_TOKEN ? 'env' : (process.env.MYTHOS_TELEGRAM_BOT_TOKEN_FILE ? 'file' : 'none')
  };
}

// The token is held in a closure by the client; it is never returned by
// config()/status(), never logged, never written, never passed to a child.
var TOKEN_FILE_PROBLEM = null;
function readToken() {
  TOKEN_FILE_PROBLEM = null;
  var direct = process.env.MYTHOS_TELEGRAM_BOT_TOKEN;
  if (direct && String(direct).trim()) return String(direct).trim();
  var file = process.env.MYTHOS_TELEGRAM_BOT_TOKEN_FILE;
  if (!file) return null;
  var text;
  try {
    var st = fs.statSync(file);
    // A credential the running user cannot read, or that others can read,
    // is reported as a configuration problem (never as a crash and never
    // with its content).
    if ((st.mode & 0o077) !== 0) TOKEN_FILE_PROBLEM = 'token file mode is ' + (st.mode & 0o777).toString(8) + ' (must be 0600)';
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    TOKEN_FILE_PROBLEM = 'token file ' + (e && e.code === 'ENOENT' ? 'does not exist' : 'is not readable by ' + (process.env.USER || 'this user') + ' (' + (e && e.code) + ')');
    return null;
  }
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(lines[i]);
    // MYTHOS_TELEGRAM_BOT_TOKEN is the documented name; TELEGRAM_BOT_TOKEN
    // (the plain BotFather convention) is accepted so an owner-written file
    // does not have to be edited.
    if (m && (m[1] === 'MYTHOS_TELEGRAM_BOT_TOKEN' || m[1] === 'TELEGRAM_BOT_TOKEN')) return m[2].replace(/^["']|["']$/g, '');
  }
  var raw = text.trim();
  return raw && raw.indexOf('=') === -1 && raw.indexOf('\n') === -1 ? raw : null;
}

// --- Helpers ----------------------------------------------------------------------

function nowIso() { return new Date().toISOString(); }
function sha256(text) { return crypto.createHash('sha256').update(String(text)).digest('hex'); }
function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// Removes the bot token (and anything shaped like one) from a string, then
// applies the shared redaction. Every string that leaves this module passes
// through here.
function scrub(text, token) {
  if (typeof text !== 'string' || !text) return text;
  var out = text;
  if (token) out = out.split(token).join(redact.MASK);
  out = out.replace(TOKEN_RE, redact.MASK);
  return redact.redact(out);
}

function scrubValue(value, token) {
  if (typeof value === 'string') return scrub(value, token);
  if (Array.isArray(value)) return value.map(function (v) { return scrubValue(v, token); });
  if (value && typeof value === 'object') {
    var out = {};
    Object.keys(value).forEach(function (k) { out[k] = scrubValue(value[k], token); });
    return out;
  }
  return value;
}

var CURRENT_TOKEN = null;
function log(event, fields) {
  bridge.log('telegram:' + event, scrubValue(fields || {}, CURRENT_TOKEN));
}

// Zero-padded to 9 digits so the id is always ≥ 6 chars (bridge rule) and sorts chronologically.
function taskIdFor(updateId) { var d = String(updateId); while (d.length < 9) d = '0' + d; return 'tg-' + d; }
function parseTaskId(id) { var m = TASK_RE.exec(String(id || '')); return m ? { update_id: parseInt(m[1], 10) } : null; }

// Every task file on the control branch that came from Telegram, by update id.
function loadTelegramTasks(cfg) {
  var byUpdate = {};
  var all = {};
  bridge.listTaskFiles(cfg.bridge).forEach(function (f) {
    var e = bridge.loadTask(cfg.bridge, f);
    var t = e.task;
    if (!t || !bridge.isValidTaskId(t.task_id) || f !== t.task_id + '.json') return;
    all[t.task_id] = t;
    var src = t.source && typeof t.source === 'object' ? t.source : null;
    var u = src && src.kind === 'telegram' ? parseInt(src.update_id, 10) : null;
    if (!u) { var p = parseTaskId(t.task_id); u = p ? p.update_id : null; }
    if (u) byUpdate[u] = t;
  });
  return { byUpdate: byUpdate, all: all };
}

function reportFor(cfg, taskId) {
  var p = bridge.paths(cfg.bridge);
  return bridge.readJsonFile(path.join(p.reports, taskId + '.json'));
}

// --- Local durable state (bridge home, outside Git) --------------------------------

function ensureHome(cfg) { fs.mkdirSync(cfg.home, { recursive: true, mode: 0o700 }); }
function offsetFile(cfg) { return path.join(cfg.home, 'offset.json'); }
function ledgerFile(cfg) { return path.join(cfg.home, 'replies.json'); }

function readOffset(cfg) {
  var v = bridge.readJsonFile(offsetFile(cfg));
  return v && typeof v.next_offset === 'number' && v.next_offset >= 0 ? v.next_offset : 0;
}

function writeAtomic(file, value) {
  var tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function writeOffset(cfg, next) {
  ensureHome(cfg);
  writeAtomic(offsetFile(cfg), { next_offset: next, updated_at: nowIso() });
}

function readLedger(cfg) { return bridge.readJsonFile(ledgerFile(cfg)) || {}; }
function writeLedger(cfg, ledger) { ensureHome(cfg); writeAtomic(ledgerFile(cfg), ledger); }

// Sends one reply at most once per (task_id, event). The ledger entry is
// written BEFORE the request so a crash after the send cannot repeat it; a
// failed send clears the entry so the next tick retries.
async function replyOnce(cfg, client, chatId, key, text) {
  var ledger = readLedger(cfg);
  if (ledger[key] && ledger[key].message_id !== undefined) return { existed: true, message_id: ledger[key].message_id, at: ledger[key].at };
  if (ledger[key] && ledger[key].sending && Date.now() - Date.parse(ledger[key].sending) < 10 * 60 * 1000) {
    return { existed: true, message_id: null, at: ledger[key].sending, in_flight: true };
  }
  ledger[key] = { sending: nowIso() };
  writeLedger(cfg, ledger);
  var sent;
  try {
    sent = await client.sendMessage(chatId, text);
  } catch (e) {
    ledger = readLedger(cfg);
    delete ledger[key];
    writeLedger(cfg, ledger);
    throw e;
  }
  ledger = readLedger(cfg);
  ledger[key] = { message_id: sent && sent.message_id !== undefined ? sent.message_id : null, at: nowIso() };
  writeLedger(cfg, ledger);
  return { existed: false, message_id: ledger[key].message_id, at: ledger[key].at };
}

// --- Bot API client (no dependency, token in closure) ---------------------------

function createClient(cfg, token, opts) {
  opts = opts || {};
  if (!token) throw new Error('TELEGRAM_TOKEN_MISSING: no MYTHOS_TELEGRAM_BOT_TOKEN in the environment and no MYTHOS_TELEGRAM_BOT_TOKEN_FILE');
  var calls = [];
  function call(method, body, timeoutMs) {
    var target = cfg.apiBase + '/bot' + token + '/' + method;
    return httpJson.postJson(target, body, { timeoutMs: timeoutMs || cfg.timeoutMs }).then(function (r) {
      var parsed = null;
      try { parsed = JSON.parse(r.body); } catch (e) { parsed = null; }
      calls.push({ method: method, status: r.statusCode, ok: !!(r.ok && parsed && parsed.ok === true) });
      if (!r.ok || !parsed || parsed.ok !== true) {
        throw new Error('TELEGRAM_API_' + r.statusCode + ': ' + scrub(String((parsed && parsed.description) || r.body || '').slice(0, 200), token));
      }
      return parsed.result;
    }, function (e) {
      calls.push({ method: method, status: null, ok: false, error: true });
      throw new Error('TELEGRAM_TRANSPORT: ' + scrub(String(e && e.message || e).slice(0, 200), token));
    });
  }
  return {
    calls: calls,
    getMe: function () { return call('getMe', {}); },
    getUpdates: function (offset) {
      return call('getUpdates', { offset: offset, limit: cfg.maxPerTick, timeout: cfg.pollSeconds, allowed_updates: ['message'] }, (cfg.pollSeconds + 10) * 1000 > cfg.timeoutMs ? (cfg.pollSeconds + 10) * 1000 : cfg.timeoutMs);
    },
    sendMessage: function (chatId, text) {
      return call('sendMessage', { chat_id: chatId, text: short(scrub(String(text), token), LIMITS.reply), disable_web_page_preview: true });
    }
  };
}

// --- Normalisation: Telegram update → MYTHOS inbound message ------------------------

// Pure. Accepts only a private text message. Returns { ok, message } or
// { ok:false, reason }. Never throws on foreign input.
function normalizeUpdate(update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return { ok: false, reason: 'update is not an object' };
  if (typeof update.update_id !== 'number' || !(update.update_id >= 0) || update.update_id % 1 !== 0) return { ok: false, reason: 'update_id missing or not an integer' };
  var msg = update.message;
  if (!msg || typeof msg !== 'object') return { ok: false, reason: 'no message (edited messages, channel posts and other update kinds are ignored)', update_id: update.update_id };
  var chat = msg.chat;
  var from = msg.from;
  if (!chat || typeof chat !== 'object' || typeof chat.id !== 'number') return { ok: false, reason: 'message.chat.id missing', update_id: update.update_id };
  if (!from || typeof from !== 'object' || typeof from.id !== 'number') return { ok: false, reason: 'message.from.id missing', update_id: update.update_id };
  if (chat.type !== 'private') return { ok: false, reason: 'chat is not private (' + String(chat.type).slice(0, 20) + ')', update_id: update.update_id, user_id: from.id };
  if (from.is_bot === true) return { ok: false, reason: 'sender is a bot', update_id: update.update_id, user_id: from.id };
  if (chat.id !== from.id) return { ok: false, reason: 'private chat id does not match the sender id', update_id: update.update_id, user_id: from.id };
  if (typeof msg.text !== 'string' || !msg.text.trim()) return { ok: false, reason: 'message has no text', update_id: update.update_id, user_id: from.id };
  if (typeof msg.message_id !== 'number') return { ok: false, reason: 'message_id missing', update_id: update.update_id, user_id: from.id };
  return {
    ok: true,
    message: {
      channel: BY,
      update_id: update.update_id,
      chat_id: chat.id,
      user_id: from.id,
      message_id: msg.message_id,
      date: typeof msg.date === 'number' ? new Date(msg.date * 1000).toISOString() : null,
      text: msg.text
    }
  };
}

function isAllowed(cfg, userId) {
  return cfg.allowedUserIds.indexOf(String(userId)) !== -1;
}

// Pure: normalised message → { task, errors }. Never throws on user content.
function messageToTask(cfg, message) {
  var errors = [];
  var text = String(message.text || '');
  var secretKinds = redact.findSecretKinds(text);
  if (TOKEN_RE.test(text)) secretKinds.push('telegram-bot-token');
  TOKEN_RE.lastIndex = 0;
  if (secretKinds.length) {
    return { task: null, errors: ['message carries a secret-shaped string (' + secretKinds.join(', ') + '). Credentials never travel in tasks: rotate it and send a new message.'], secret: true };
  }
  var fields = engine.extractFields(text);
  var act = engine.resolveAction({ fields: fields, labels: [], previous: null, defaultAction: cfg.defaultAction });
  if (act.error) errors.push(act.error);
  else if (cfg.allowedActions.indexOf(act.requested_action) === -1) {
    errors.push('Action "' + act.requested_action + '" is not allowed on the Telegram channel (allowed: ' + cfg.allowedActions.join(', ') + ')');
  }
  var model = engine.resolveModel({ fields: fields, labels: [], previous: null, policy: modelPolicy });
  if (model.error) errors.push(model.error);
  // The objective is the message minus its scalar field lines (`Action: …`,
  // `Model: …`), which extractFields() reports by 1-based line number.
  var fieldLines = {};
  Object.keys(fields).forEach(function (k) { (fields[k] || []).forEach(function (f) { if (f.line) fieldLines[f.line] = true; }); });
  var objective = text.replace(/\r\n/g, '\n').split('\n').filter(function (line, i) { return !fieldLines[i + 1]; }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (objective.length < 10) errors.push('objective is too short (write what you want investigated, at least 10 characters)');
  objective = short(objective, LIMITS.objective);
  var taskId = taskIdFor(message.update_id);
  var profile = act.requested_action ? engine.profileFor(act.requested_action) : null;
  var contentHash = sha256(text);
  var task = {
    protocol: bridge.PROTOCOL,
    task_id: taskId,
    project: cfg.bridge.project,
    objective: objective,
    scope: [],
    constraints: ['Telegram channel task: READ-style unless the Action says otherwise; the channel allows only ' + cfg.allowedActions.join(', ') + '.'],
    priority: 'normal',
    requested_action: act.requested_action || String(act.action_raw || '').slice(0, 30),
    action_raw: short(act.action_raw == null ? '' : act.action_raw, 100),
    action_source: act.action_source === 'explicit_current_issue' ? 'explicit_current_issue' : 'default',
    validation_requirements: [],
    status: 'PENDING',
    created_at: nowIso(),
    created_by: short('telegram:' + message.user_id, 64),
    notes: short('Source: Telegram private message (update_id ' + message.update_id + ', chat_id ' + message.chat_id + ', message_id ' + message.message_id + ', user_id ' + message.user_id + (message.date ? ', sent ' + message.date : '') + ').\n\n' +
      'requested_action: ' + (act.requested_action || '(invalid)') + ' — source ' + act.action_source + ' (written as "' + short(act.action_raw, 40) + '")' +
      (act.action_source === 'default' ? ': defaulted because the message did not state one (write `Action: investigate|review` on its own line)' : '') +
      (profile ? ' → execution profile ' + profile : ''), LIMITS.notes)
  };
  if (model.model_key) {
    task.model = model.model_key;
    task.model_raw = short(model.model_raw, 100);
    task.model_source = model.model_source === 'explicit_current_issue' ? 'explicit_current_issue' : 'none';
  }
  task.source = {
    kind: BY,
    update_id: message.update_id,
    chat_id: message.chat_id,
    user_id: message.user_id,
    message_id: message.message_id,
    message_date: message.date,
    content_sha256: contentHash,
    idempotency_key: engine.idempotencyKey([BY, ':', message.chat_id, '@', message.update_id, ':', contentHash]),
    resolution: {
      requested_action: act.requested_action,
      action_raw: act.action_raw,
      action_source: act.action_source,
      execution_profile: profile,
      expected_delivery: act.requested_action ? engine.deliveryFor(act.requested_action) : null,
      channel_allowed_actions: cfg.allowedActions.slice(),
      model_key: model.model_key || null,
      model_source: model.model_source || null,
      resolved_at: nowIso(),
      resolved_by: 'bridge/action-resolution.js'
    },
    events: [
      { at: nowIso(), event: 'telegram_received', reason: 'private message update_id ' + message.update_id + ' from allowlisted user ' + message.user_id, content_sha256: contentHash },
      { at: nowIso(), event: 'action_resolved', reason: act.action_source + ' → ' + (act.requested_action || 'invalid') },
      { at: nowIso(), event: 'profile_resolved', reason: (act.requested_action || '?') + ' → ' + (profile || 'none') + ' (server-side map)' }
    ],
    converted_at: nowIso(),
    converted_by: BY,
    notifications: {}
  };
  errors = errors.concat(bridge.validateTask(cfg.bridge, task, taskId + '.json'));
  return { task: errors.length ? null : task, errors: errors, candidate: task, secret: false };
}

// Convenience for the CLI and tests: raw update → task decision.
function updateToTask(cfg, update) {
  var norm = normalizeUpdate(update);
  if (!norm.ok) return { task: null, errors: ['malformed update: ' + norm.reason], malformed: true, secret: false };
  if (!isAllowed(cfg, norm.message.user_id)) return { task: null, errors: ['sender ' + norm.message.user_id + ' is not allowlisted'], unauthorized: true, secret: false, message: norm.message };
  var conv = messageToTask(cfg, norm.message);
  conv.message = norm.message;
  return conv;
}

// --- Reply texts (plain text, no markup, no secrets) ----------------------------------

function queuedText(task) {
  return 'MYTHOS: queued ' + task.task_id + '\n' +
    'action ' + task.requested_action + ' → profile ' + engine.profileFor(task.requested_action) + (task.model ? ', model ' + task.model : '') + '\n' +
    'I will reply here when the task starts and when the report is ready.';
}

// Owner-facing lifecycle texts (decision 2026-09-05): short and simple — task
// id, state, a brief description and the result / what is needed. The Claude
// model name is shown when known. Internal identifiers stay OUT of the chat:
// no executor task id, no execution id, no OTHMODE number, no host path; the
// MYTHOS guard is only described. The full correlation lives in the task file
// (`source.notifications`) and `telegram-status` / `trail` for the operator.
function guardLine(execution) {
  return (execution && execution.othmode_task_id) ? 'guard: MYTHOS protection/monitoring active' : null;
}

function startedText(task) {
  var ex = task.execution || {};
  var lines = ['MYTHOS: started ' + task.task_id,
    'profile ' + (ex.execution_profile || engine.profileFor(task.requested_action)) + (ex.model ? ', model ' + ex.model : '')];
  var g = guardLine(ex);
  if (g) lines.push(g);
  return lines.join('\n');
}

function reportText(task, report) {
  // Shared presenter (gh-issue-191): same short owner-facing format as the
  // WhatsApp channel. No report path in a chat reply (details_ref 'none'),
  // model name when recorded, guard only described.
  var ex = report.execution || {};
  var kind = report.blocker && report.blocker.code === 'HUMAN_APPROVAL' ? 'HUMAN_APPROVAL' : report.status;
  return presenter.presentReport(report, kind, { model: ex.model || null, guard: !!guardLine(task.execution), details_ref: 'none' }).text;
}

function rejectedText(taskId, errors, secret) {
  return 'MYTHOS: rejected ' + taskId + '\n' +
    (secret ? 'the message carries a secret-shaped string; it was not stored. Rotate it and send a new message.' : errors.slice(0, 4).map(function (e) { return '- ' + short(e, 300); }).join('\n')) + '\n' +
    'Send a new message (each message is a new task).';
}

// --- Control commit ----------------------------------------------------------------

function saveAndCommit(cfg, tasks, message, opts) {
  if (opts && opts.dryRun) return { committed: false, dry_run: true };
  var idx = loadTelegramTasks(cfg);
  tasks.forEach(function (t) { bridge.saveTask(cfg.bridge, t); idx.all[t.task_id] = t; });
  var files = [];
  // Every Telegram task file is named, so a file left uncommitted by a tick
  // that died before its commit is picked up by the next one (unchanged
  // files stage nothing).
  Object.keys(idx.all).forEach(function (id) { if (idx.all[id].source && idx.all[id].source.kind === BY) files.push(bridge.taskFile(cfg.bridge, id)); });
  bridge.writeIndex(cfg.bridge, idx.all, {}).forEach(function (f) { files.push(f); });
  return bridge.commitControl(cfg.bridge, files.filter(function (x, i) { return files.indexOf(x) === i; }), message);
}

// --- Phase 1: intake (Telegram update → PENDING task) -------------------------------

async function intake(cfg, client, opts) {
  opts = opts || {};
  var actions = [];
  if (!cfg.allowedUserIds.length) {
    actions.push({ action: 'refuse_all', reason: 'MYTHOS_TELEGRAM_ALLOWED_USER_IDS is empty — the channel accepts nobody (fail closed); updates are not fetched' });
    return { ok: true, actions: actions, fetched: 0 };
  }
  var sync = bridge.syncControl(cfg.bridge);
  actions.push({ action: 'sync', result: sync });
  if (!sync.ok) { actions.push({ action: 'defer_all', reason: sync.reason }); return { ok: true, actions: actions, fetched: 0 }; }
  var offset = readOffset(cfg);
  var updates = await client.getUpdates(offset);
  if (!Array.isArray(updates)) updates = [];
  updates = updates.filter(function (u) { return u && typeof u.update_id === 'number'; }).sort(function (a, b) { return a.update_id - b.update_id; });
  var idx = loadTelegramTasks(cfg);
  var newTasks = [];
  var maxSeen = offset - 1;
  for (var k = 0; k < updates.length; k++) {
    var u = updates[k];
    if (u.update_id > maxSeen) maxSeen = u.update_id;
    var taskId = taskIdFor(u.update_id);
    if (idx.all[taskId]) { actions.push({ action: 'already_converted', update_id: u.update_id, task_id: taskId, status: idx.all[taskId].status }); continue; }
    var norm = normalizeUpdate(u);
    if (!norm.ok) { actions.push({ action: 'skip_malformed', update_id: u.update_id, reason: norm.reason }); log('skip_malformed', { update_id: u.update_id, reason: norm.reason, user_id: norm.user_id || null }); continue; }
    var m = norm.message;
    if (!isAllowed(cfg, m.user_id)) {
      // No reply: the bot does not reveal itself to strangers. Logged by id.
      actions.push({ action: 'unauthorized', update_id: u.update_id, user_id: m.user_id });
      log('unauthorized', { update_id: u.update_id, user_id: m.user_id, chat_id: m.chat_id });
      continue;
    }
    var conv = messageToTask(cfg, m);
    if (!conv.task) {
      if (opts.dryRun) { actions.push({ action: 'would_reject', update_id: u.update_id, errors: conv.errors, secret: !!conv.secret }); continue; }
      var rj = await replyOnce(cfg, client, m.chat_id, taskId + ':rejected', rejectedText(taskId, conv.errors, conv.secret));
      actions.push({ action: 'rejected', update_id: u.update_id, task_id: taskId, errors: conv.errors, secret: !!conv.secret, reply: rj });
      log('rejected', { update_id: u.update_id, user_id: m.user_id, errors: conv.errors, secret: !!conv.secret, reply_message_id: rj.message_id });
      continue;
    }
    var task = conv.task;
    if (opts.dryRun) { actions.push({ action: 'would_create', update_id: u.update_id, task_id: taskId, requested_action: task.requested_action }); continue; }
    if (newTasks.length >= cfg.maxPerTick) { actions.push({ action: 'defer', update_id: u.update_id, reason: 'per-tick limit' }); maxSeen = u.update_id - 1; break; }
    // Reply first, file second: the ledger key is the recovery key if the
    // process dies between the two.
    var qr = await replyOnce(cfg, client, m.chat_id, taskId + ':queued', queuedText(task));
    task.source.notifications.queued = { message_id: qr.message_id, at: qr.at, existed: qr.existed };
    task.source.events.push({ at: nowIso(), event: 'task_created', reason: 'control/tasks/' + taskId + '.json PENDING; queued reply ' + (qr.existed ? 'adopted' : 'sent') + ' (message_id ' + qr.message_id + ')' });
    newTasks.push(task);
    actions.push({ action: 'create', update_id: u.update_id, task_id: taskId, chat_id: m.chat_id, user_id: m.user_id, requested_action: task.requested_action, action_source: task.action_source, execution_profile: engine.profileFor(task.requested_action), model: task.model || null, reply: qr });
    log('created', { update_id: u.update_id, task_id: taskId, chat_id: m.chat_id, user_id: m.user_id, message_id: m.message_id, requested_action: task.requested_action, action_source: task.action_source, execution_profile: engine.profileFor(task.requested_action), model: task.model || null, reply_message_id: qr.message_id });
  }
  var committed = null;
  if (newTasks.length) {
    var msg = 'control: telegram → ' + newTasks.map(function (t) { return t.task_id; }).join(', ').slice(0, 180);
    committed = saveAndCommit(cfg, newTasks, msg + '\n\nWritten by the MYTHOS Telegram channel adapter (' + cfg.bridge.claimedBy + '). Delivery: governance relay.', opts);
    actions.push({ action: 'commit', result: committed });
  }
  // The offset advances only when everything fetched was either converted
  // and committed, dropped, or deferred at a known boundary.
  if (!opts.dryRun && maxSeen >= offset && (!newTasks.length || (committed && committed.committed))) {
    writeOffset(cfg, maxSeen + 1);
    actions.push({ action: 'offset', next_offset: maxSeen + 1 });
  }
  return { ok: true, actions: actions, fetched: updates.length };
}

// --- Phase 2: notify (task/report → Telegram reply) --------------------------------------

async function notify(cfg, client, opts) {
  opts = opts || {};
  var actions = [];
  var sync = bridge.syncControl(cfg.bridge);
  actions.push({ action: 'sync', result: sync });
  if (!sync.ok) { actions.push({ action: 'defer_all', reason: sync.reason }); return { ok: true, actions: actions }; }
  var idx = loadTelegramTasks(cfg);
  var dirty = [];
  var ids = Object.keys(idx.all).filter(function (id) { return idx.all[id].source && idx.all[id].source.kind === BY; }).sort();
  for (var i = 0; i < ids.length; i++) {
    var t = idx.all[ids[i]];
    var src = t.source;
    src.notifications = src.notifications || {};
    var chatId = src.chat_id;
    var changed = false;
    var ex = t.execution || {};
    if (ex.executor_task_id && !src.notifications.started) {
      if (opts.dryRun) actions.push({ action: 'would_notify', event: 'started', task_id: t.task_id });
      else {
        var c1 = await replyOnce(cfg, client, chatId, t.task_id + ':started', startedText(t));
        src.notifications.started = { message_id: c1.message_id, at: c1.at, existed: c1.existed, executor_task_id: ex.executor_task_id, othmode_task_id: ex.othmode_task_id || null };
        src.events.push({ at: nowIso(), event: 'started_notified', reason: 'executor ' + ex.executor_task_id + ', OTHMODE ' + (ex.othmode_task_id || 'none') + '; reply message_id ' + c1.message_id });
        changed = true;
        actions.push({ action: 'notify', event: 'started', task_id: t.task_id, reply: c1 });
        log('notify_started', { task_id: t.task_id, update_id: src.update_id, chat_id: chatId, executor_task_id: ex.executor_task_id, othmode_task_id: ex.othmode_task_id || null, reply_message_id: c1.message_id });
      }
    }
    var report = TERMINAL.indexOf(t.status) !== -1 ? reportFor(cfg, t.task_id) : null;
    if (report && !src.notifications.report) {
      if (opts.dryRun) actions.push({ action: 'would_notify', event: 'report', task_id: t.task_id, status: report.status });
      else {
        var c2 = await replyOnce(cfg, client, chatId, t.task_id + ':report', reportText(t, report));
        src.notifications.report = { message_id: c2.message_id, at: c2.at, existed: c2.existed, status: report.status, report_file: cfg.bridge.prefix + '/reports/' + t.task_id + '.json' };
        src.events.push({ at: nowIso(), event: 'report_notified', reason: report.status + '; reply message_id ' + c2.message_id });
        changed = true;
        actions.push({ action: 'notify', event: 'report', task_id: t.task_id, status: report.status, reply: c2 });
        log('notify_report', { task_id: t.task_id, update_id: src.update_id, chat_id: chatId, status: report.status, executor_task_id: (report.execution && report.execution.executor_task_id) || null, othmode_task_id: ex.othmode_task_id || null, reply_message_id: c2.message_id });
      }
    }
    if (changed) dirty.push(t);
  }
  if (dirty.length) {
    var msg = 'control: telegram ← ' + dirty.map(function (t) { return t.task_id; }).join(', ').slice(0, 180);
    actions.push({ action: 'commit', result: saveAndCommit(cfg, dirty, msg + '\n\nTelegram replies recorded by the MYTHOS Telegram channel adapter (' + cfg.bridge.claimedBy + ').', opts) });
  }
  return { ok: true, actions: actions };
}

// --- Orchestration ------------------------------------------------------------------

function withLock(cfg, fn) {
  return Promise.resolve().then(function () {
    try { bridge.userGuard(); } catch (e) { return { ok: false, reason: e.message }; }
    var lock = bridge.acquireLock(cfg.bridge);
    if (!lock) return { ok: false, reason: 'another bridge process holds the lock' };
    return Promise.resolve().then(fn).then(function (r) { bridge.releaseLock(lock); return r; }, function (e) {
      bridge.releaseLock(lock);
      log('phase_error', { error: scrub(String(e && e.stack || e), CURRENT_TOKEN).slice(0, 800) });
      return { ok: false, reason: scrub(String(e && e.message || e), CURRENT_TOKEN).slice(0, 400) };
    });
  });
}

function clientFor(cfg, opts) {
  var token = readToken();
  CURRENT_TOKEN = token;
  return createClient(cfg, token, opts || {});
}

// intake → bridge.tick → notify. Each phase holds the bridge lock for itself,
// exactly like the Issues adapter; the bridge tick in the middle is the
// unchanged one.
async function telegramTick(executor, opts) {
  opts = opts || {};
  var cfg = config();
  var client = clientFor(cfg, opts);
  var out = { ok: true, channel: BY, dry_run: !!opts.dryRun, phases: {} };
  out.phases.intake = await withLock(cfg, function () { return intake(cfg, client, opts); });
  if (!opts.skipBridge) out.phases.bridge = opts.dryRun ? { skipped: 'dry-run' } : bridge.tick(executor, { forceIndex: !!opts.forceIndex });
  out.phases.notify = await withLock(cfg, function () { return notify(cfg, client, opts); });
  out.api_calls = client.calls.length;
  out.ok = out.phases.intake.ok !== false && out.phases.notify.ok !== false && (!out.phases.bridge || out.phases.bridge.ok !== false || /lock/.test(out.phases.bridge.reason || ''));
  return out;
}

// Intake-only and notify-only entry points for the combined `tick` (which
// runs the Issues phases or the plain bridge tick in between).
function intakeOnly(opts) {
  var cfg = config();
  var client = clientFor(cfg, opts);
  return withLock(cfg, function () { return intake(cfg, client, opts || {}); });
}
function notifyOnly(opts) {
  var cfg = config();
  var client = clientFor(cfg, opts);
  return withLock(cfg, function () { return notify(cfg, client, opts || {}); });
}

// Configuration + readiness, never a value.
function describe() {
  var cfg = config();
  var token = readToken();
  var problems = [];
  if (!cfg.enabled) problems.push('MYTHOS_TELEGRAM_ENABLED is not 1 (the combined tick skips the channel)');
  if (!token) problems.push('no bot token: set MYTHOS_TELEGRAM_BOT_TOKEN_FILE to a 0600 file containing MYTHOS_TELEGRAM_BOT_TOKEN=<token>' + (TOKEN_FILE_PROBLEM ? ' — ' + TOKEN_FILE_PROBLEM : ''));
  else if (TOKEN_FILE_PROBLEM) problems.push(TOKEN_FILE_PROBLEM);
  if (!cfg.allowedUserIds.length) problems.push('MYTHOS_TELEGRAM_ALLOWED_USER_IDS is empty: nobody is accepted');
  return {
    channel: BY, enabled: cfg.enabled, api_base: cfg.apiBase, token_present: !!token, token_source: cfg.tokenSource,
    allowed_user_ids: cfg.allowedUserIds.length, allowed_actions: cfg.allowedActions, default_action: cfg.defaultAction,
    poll_seconds: cfg.pollSeconds, max_per_tick: cfg.maxPerTick, next_offset: readOffset(cfg), home: cfg.home,
    ready: problems.length === 0, problems: problems
  };
}

function status() {
  var cfg = config();
  var idx = loadTelegramTasks(cfg);
  return {
    channel: BY, enabled: cfg.enabled, token_present: !!readToken(), allowed_user_ids: cfg.allowedUserIds.length, next_offset: readOffset(cfg),
    tasks: Object.keys(idx.all).filter(function (id) { return idx.all[id].source && idx.all[id].source.kind === BY; }).sort().map(function (id) {
      var t = idx.all[id];
      var rep = TERMINAL.indexOf(t.status) !== -1 ? reportFor(cfg, id) : null;
      return {
        task_id: id, update_id: t.source.update_id, chat_id: t.source.chat_id, user_id: t.source.user_id, status: t.status,
        requested_action: t.requested_action, action_source: t.action_source || null,
        execution_profile: t.execution ? (t.execution.execution_profile || null) : engine.profileFor(t.requested_action),
        executor_task_id: t.execution ? t.execution.executor_task_id || null : null,
        othmode_task_id: t.execution ? t.execution.othmode_task_id || null : null,
        report_file: rep ? cfg.bridge.prefix + '/reports/' + id + '.json' : null,
        report_status: rep ? rep.status : null,
        notifications: Object.keys(t.source.notifications || {}).reduce(function (o, k) { o[k] = t.source.notifications[k].message_id; return o; }, {})
      };
    })
  };
}

module.exports = {
  BY: BY,
  TOKEN_RE: TOKEN_RE,
  LIMITS: LIMITS,
  DEFAULT_ALLOWED_ACTIONS: DEFAULT_ALLOWED_ACTIONS,
  config: config,
  readToken: readToken,
  scrub: scrub,
  createClient: createClient,
  normalizeUpdate: normalizeUpdate,
  isAllowed: isAllowed,
  messageToTask: messageToTask,
  updateToTask: updateToTask,
  taskIdFor: taskIdFor,
  parseTaskId: parseTaskId,
  loadTelegramTasks: loadTelegramTasks,
  queuedText: queuedText,
  startedText: startedText,
  reportText: reportText,
  rejectedText: rejectedText,
  readOffset: readOffset,
  intake: intake,
  notify: notify,
  intakeOnly: intakeOnly,
  notifyOnly: notifyOnly,
  telegramTick: telegramTick,
  describe: describe,
  status: status
};
