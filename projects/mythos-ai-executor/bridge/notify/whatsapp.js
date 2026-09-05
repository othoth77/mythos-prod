'use strict';
// =====================================================
// MYTHOS GitHub bridge — WhatsApp notification layer
// projects/mythos-ai-executor/bridge/notify/whatsapp.js
//
// Sends ONE WhatsApp message when a GitHub control task reaches a state a
// human has to know about. It is a notification sink bolted to the side of
// the bridge; it is NOT part of the bridge's execution semantics and can
// never change them.
//
// The two-phase design is what makes that guarantee real:
//
//   phase 1  onReport()   synchronous, local, never network.
//                         Writes ONE durable ledger entry per
//                         (task_id, kind) under the executor's own store
//                         and returns. Called from the bridge tick, right
//                         after the REPORT was written.
//
//   phase 2  flush()      asynchronous, out of band, driven by the CLI /
//                         daemon AFTER tick() has already returned.
//                         Talks to the provider, retries with backoff,
//                         records the outcome.
//
// Consequences, each one a requirement of this stage:
//   - a provider outage, a hung socket or a wrong credential cannot slow,
//     fail or alter a tick: the tick was already over;
//   - the GitHub task status and the REPORT are written before any
//     notification exists, and are never rewritten by this module — the
//     control branch has no notification state at all;
//   - restart safety and duplicate-poll safety are the same property: the
//     ledger key is (task_id, kind), a SENT recipient is recorded, and a
//     recipient already in `delivered_to` is never re-sent;
//   - concurrent ticks are safe: an O_EXCL per-key lock file serialises
//     delivery attempts, and a stale lock (dead pid, expired lease) is
//     reclaimed rather than deadlocking.
//
// Storage: the existing executor store convention (a directory of small
// atomic JSON files under MYTHOS_BRIDGE_HOME), exactly like the bridge's
// claims cache. No database is added.
//
// Secrets: the credential is read from a 0600 file (preferred) or the
// environment at send time only. It is never written to the ledger, never
// returned by describe()/status(), never put in a message, never logged.
// Every message and every provider error passes the shared redaction.
//
// Scope fence: terminal *bridge* notifications only. This module must not
// grow inbound handling, chat sessions, templates or customer messaging —
// MYTHOS AUTO WhatsApp is a separate, unstarted project.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');

var state = require('../../lib/state');
var redact = require('../../../mythos-orchestrator/lib/redact');
var presenter = require('./presenter');
var evolution = require('./providers/evolution');
var generic = require('./providers/generic');

// Provider registry. Adding WAHA or the official WhatsApp Business Cloud
// API is a new file here plus one line — github-bridge.js does not change.
//
// `generic` goes one step further: it is a configuration-driven adapter, so
// pointing MYTHOS at a different HTTP WhatsApp gateway (wa-evolution, WAHA,
// an in-house relay) is an environment change and needs no new file at all.
// `evolution` stays the default because it is the only shape that has been
// verified against a real gateway contract in this repository.
var PROVIDERS = { evolution: evolution, generic: generic };

var KINDS = ['COMPLETED', 'FAILED', 'BLOCKED', 'HUMAN_APPROVAL'];
var LEDGER_STATES = ['PENDING', 'SENDING', 'SENT', 'EXHAUSTED'];
// task_id is 6-64 chars (github-bridge.js TASK_ID_RE); the ledger key must
// accept every valid task_id or a notification silently vanishes in
// onReport()'s try/catch for any task_id over the old 40-char cap.
var KEY_RE = /^[a-z0-9][a-z0-9-]{4,62}[a-z0-9]__(?:COMPLETED|FAILED|BLOCKED|HUMAN_APPROVAL)$/;

var MAX_MESSAGE = 3500;          // WhatsApp text limit is ~4096; stay well under
var MAX_SUMMARY = 700;
var MAX_BACKOFF_MS = 30 * 60 * 1000;
var DEFAULT_LEASE_MS = 120000;   // a SENDING claim older than this is stale
// Deliveries per flush. Kept small on purpose: `mythos-github-bridge tick`
// flushes before it exits, and the systemd unit allows 600 s, so the worst
// case (limit x recipients x TIMEOUT_MS) must stay well inside that. A
// backlog simply drains over the following ticks — the ledger is durable.
var DEFAULT_FLUSH_LIMIT = 5;
// Wall-clock ceiling for one flush. `mythos-github-bridge tick` waits for
// the flush before it exits, so without this a dead gateway costs the tick
// FLUSH_LIMIT x recipients x TIMEOUT_MS on EVERY 2-minute run. Work that
// does not fit the budget is simply left PENDING for the next flush.
var DEFAULT_FLUSH_BUDGET_MS = 60000;
// Consecutive PROVIDER-level failures (transport, timeout, 5xx) after which
// the circuit opens. A 4xx is a message problem, not a provider outage, and
// never trips it.
var DEFAULT_BREAKER_THRESHOLD = 3;
var DEFAULT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000;

var MARK = { COMPLETED: '✅', FAILED: '❌', BLOCKED: '⛔', HUMAN_APPROVAL: '🙋' };

// --- Configuration (environment only; nothing here is ever committed) ---------------

function envList(name) {
  return String(process.env[name] || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

function bridgeHome() {
  return process.env.MYTHOS_BRIDGE_HOME || path.join(state.root(), 'bridge');
}

// Per-provider options, so an adapter can be driven entirely from the
// environment without the layer knowing anything about its shape. Only the
// selected provider's block is ever read. No value here is a credential —
// the credential has its own path (credential()) and never passes through
// config().
function providerOptions() {
  return {
    evolution: null,
    generic: {
      path: process.env.MYTHOS_BRIDGE_WHATSAPP_GENERIC_PATH || generic.DEFAULTS.path,
      authHeader: process.env.MYTHOS_BRIDGE_WHATSAPP_GENERIC_AUTH_HEADER || generic.DEFAULTS.authHeader,
      authPrefix: process.env.MYTHOS_BRIDGE_WHATSAPP_GENERIC_AUTH_PREFIX === undefined
        ? generic.DEFAULTS.authPrefix : process.env.MYTHOS_BRIDGE_WHATSAPP_GENERIC_AUTH_PREFIX,
      bodyTemplate: process.env.MYTHOS_BRIDGE_WHATSAPP_GENERIC_BODY || generic.DEFAULTS.bodyTemplate,
      idPath: process.env.MYTHOS_BRIDGE_WHATSAPP_GENERIC_ID_PATH || generic.DEFAULTS.idPath
    }
  };
}

function config() {
  var home = process.env.MYTHOS_BRIDGE_WHATSAPP_HOME || path.join(bridgeHome(), 'notify');
  var kinds = envList('MYTHOS_BRIDGE_WHATSAPP_EVENTS')
    .map(function (k) { return k.toUpperCase(); })
    .filter(function (k) { return KINDS.indexOf(k) !== -1; });
  return {
    // Disabled until explicitly turned on. This is the default in every
    // environment, including production, until the owner configures it.
    enabled: process.env.MYTHOS_BRIDGE_WHATSAPP_ENABLED === '1',
    provider: process.env.MYTHOS_BRIDGE_WHATSAPP_PROVIDER || 'evolution',
    baseUrl: String(process.env.MYTHOS_BRIDGE_WHATSAPP_BASE_URL || '').replace(/\/+$/, ''),
    instance: process.env.MYTHOS_BRIDGE_WHATSAPP_INSTANCE || '',
    apiVersion: process.env.MYTHOS_BRIDGE_WHATSAPP_API_VERSION === 'v1' ? 'v1' : 'v2',
    recipients: envList('MYTHOS_BRIDGE_WHATSAPP_TO'),
    kinds: kinds.length ? kinds : KINDS.slice(),
    allowPublic: process.env.MYTHOS_BRIDGE_WHATSAPP_ALLOW_PUBLIC === '1',
    timeoutMs: parseInt(process.env.MYTHOS_BRIDGE_WHATSAPP_TIMEOUT_MS || '15000', 10),
    maxAttempts: Math.max(1, parseInt(process.env.MYTHOS_BRIDGE_WHATSAPP_MAX_ATTEMPTS || '5', 10)),
    backoffMs: Math.max(1000, parseInt(process.env.MYTHOS_BRIDGE_WHATSAPP_BACKOFF_MS || '60000', 10)),
    leaseMs: Math.max(10000, parseInt(process.env.MYTHOS_BRIDGE_WHATSAPP_LEASE_MS || String(DEFAULT_LEASE_MS), 10)),
    flushLimit: Math.max(1, parseInt(process.env.MYTHOS_BRIDGE_WHATSAPP_FLUSH_LIMIT || String(DEFAULT_FLUSH_LIMIT), 10)),
    flushBudgetMs: Math.max(1000, parseInt(process.env.MYTHOS_BRIDGE_WHATSAPP_FLUSH_BUDGET_MS || String(DEFAULT_FLUSH_BUDGET_MS), 10)),
    breakerEnabled: process.env.MYTHOS_BRIDGE_WHATSAPP_BREAKER !== 'off',
    breakerThreshold: Math.max(1, parseInt(process.env.MYTHOS_BRIDGE_WHATSAPP_BREAKER_THRESHOLD || String(DEFAULT_BREAKER_THRESHOLD), 10)),
    breakerCooldownMs: Math.max(1000, parseInt(process.env.MYTHOS_BRIDGE_WHATSAPP_BREAKER_COOLDOWN_MS || String(DEFAULT_BREAKER_COOLDOWN_MS), 10)),
    providerOptions: providerOptions(),
    home: home,
    ledgerDir: path.join(home, 'ledger'),
    breakerFile: path.join(home, 'breaker.json')
  };
}

// The options block for the selected provider, or null.
function selectedOptions(cfg) {
  return (cfg.providerOptions && cfg.providerOptions[cfg.provider]) || null;
}

// The credential, read as late as possible and held only for the duration
// of one request. A file is preferred: it can be 0600 and root-owned-ish,
// it never appears in `systemctl show`, and it is not inherited by child
// processes the way an environment variable is.
function credential(cfg) {
  var file = process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE;
  if (file) {
    try { return fs.readFileSync(file, 'utf8').trim(); } catch (e) { return ''; }
  }
  return String(process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY || '').trim();
}

// A host is acceptable without MYTHOS_BRIDGE_WHATSAPP_ALLOW_PUBLIC=1 only
// when it is loopback, RFC1918/RFC6598 private, or a single-label name (a
// container/service name on a private Docker or Podman network). Reaching
// a WhatsApp gateway across the public internet is a deliberate decision,
// not a default.
function isPrivateHost(host) {
  var h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  var m = /^172\.(\d{1,3})\./.exec(h);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  var c = /^100\.(\d{1,3})\./.exec(h);
  if (c && +c[1] >= 64 && +c[1] <= 127) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;              // IPv6 unique-local
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;        // any other literal IPv4 is public
  if (h.indexOf(':') !== -1) return false;                    // any other literal IPv6 is public
  if (h.indexOf('.') === -1) return true;                     // single-label: container network
  return /\.(internal|local|localdomain)$/.test(h);
}

// Everything that must be true before a message can be attempted, each
// problem tagged with the phase that actually needs it. Returns
// human-readable problems that are safe to log — never a value, only the
// name of what is missing.
//
// The two scopes are the point, not decoration:
//
//   queue    every static, structural decision: the provider registration,
//            the gateway address and the private-network fence, the instance
//            name, the recipient list and the adapter's own configuration.
//            All of these come from the same systemd drop-in, are wrong only
//            because a human made them wrong, and stay wrong until a human
//            fixes them. Refusing to queue on any of them is the documented
//            behaviour (§5.2: a non-private gateway queues NOTHING) and it
//            is preserved exactly.
//
//   delivery the credential, and only the credential. It is the one input
//            that is not an environment value but a file read at send time,
//            and therefore the one that can fail transiently.
//
// Splitting exactly there fixes a real, silent data-loss path: a REPORT is
// written once and never revisited, so when onReport() refused to queue
// because that 0600 file happened to be unreadable for a moment, the
// terminal notification was gone forever — no retry exists at that layer.
// The credential is now re-read on every flush, where being unreadable costs
// a retry instead of the message.
function problemsFor(cfg, hasCredential) {
  var problems = [];
  var provider = PROVIDERS[cfg.provider];
  if (!provider) {
    problems.push({ scope: 'queue', text: 'provider "' + String(cfg.provider).slice(0, 40) + '" is not registered (known: ' + Object.keys(PROVIDERS).join(', ') + ')' });
    return problems;
  }
  if (!cfg.baseUrl) problems.push({ scope: 'queue', text: 'MYTHOS_BRIDGE_WHATSAPP_BASE_URL is not set' });
  else {
    var host = null;
    try { host = new (require('url').URL)(cfg.baseUrl).hostname; } catch (e) { problems.push({ scope: 'queue', text: 'MYTHOS_BRIDGE_WHATSAPP_BASE_URL is not a valid URL' }); }
    if (host && !isPrivateHost(host) && !cfg.allowPublic) {
      problems.push({ scope: 'queue', text: 'base url host is not private and MYTHOS_BRIDGE_WHATSAPP_ALLOW_PUBLIC is not 1' });
    }
  }
  if (!cfg.instance) problems.push({ scope: 'queue', text: 'MYTHOS_BRIDGE_WHATSAPP_INSTANCE is not set' });
  if (!cfg.recipients.length) problems.push({ scope: 'queue', text: 'MYTHOS_BRIDGE_WHATSAPP_TO is not set' });
  else {
    var bad = cfg.recipients.filter(function (r) { return !provider.isValidRecipient(r); }).length;
    if (bad) problems.push({ scope: 'queue', text: bad + ' recipient(s) are not a digits-only MSISDN or a WhatsApp JID' });
  }
  if (!hasCredential) problems.push({ scope: 'delivery', text: 'no credential (set MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE, or MYTHOS_BRIDGE_WHATSAPP_API_KEY)' });
  // An adapter may declare its own static configuration problems. Optional:
  // an adapter without options (evolution) simply does not implement it.
  if (typeof provider.configProblems === 'function') {
    provider.configProblems(selectedOptions(cfg)).forEach(function (t) {
      problems.push({ scope: 'queue', text: String(t).slice(0, 200) });
    });
  }
  return problems;
}

// Full readiness, in the original order. This is what `notify-config`
// reports and what flush() gates on.
function readiness(cfg, hasCredential) {
  return problemsFor(cfg, hasCredential).map(function (p) { return p.text; });
}

// Only what must be true to write a ledger entry: everything except the
// credential.
function queueReadiness(cfg) {
  return problemsFor(cfg, true).filter(function (p) { return p.scope === 'queue'; }).map(function (p) { return p.text; });
}

// Operator-facing view. Deliberately carries no value that could be a
// secret: recipients are counted, never printed; the credential is a
// boolean; the base url is host+port only.
function describe() {
  var cfg = config();
  var provider = PROVIDERS[cfg.provider];
  var hasCred = !!credential(cfg);
  var host = null;
  try { var u = new (require('url').URL)(cfg.baseUrl); host = u.protocol + '//' + u.host; } catch (e) { host = cfg.baseUrl ? '(unparseable)' : null; }
  return {
    enabled: cfg.enabled,
    provider: cfg.provider,
    provider_known: !!provider,
    providers_available: Object.keys(PROVIDERS),
    provider_contract: provider ? provider.describe(selectedOptions(cfg)) : null,
    base_url_host: host,
    base_url_private: host ? (function () { try { return isPrivateHost(new (require('url').URL)(cfg.baseUrl).hostname); } catch (e) { return null; } })() : null,
    instance_set: !!cfg.instance,
    recipients_configured: cfg.recipients.length,
    credential_present: hasCred,
    credential_source: process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE ? 'file' : (process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY ? 'environment' : null),
    kinds: cfg.kinds,
    max_attempts: cfg.maxAttempts,
    backoff_ms: cfg.backoffMs,
    timeout_ms: cfg.timeoutMs,
    flush_limit: cfg.flushLimit,
    flush_budget_ms: cfg.flushBudgetMs,
    breaker: breakerStatus(cfg),
    ledger_dir: cfg.ledgerDir,
    problems: readiness(cfg, hasCred),
    queue_problems: queueReadiness(cfg)
  };
}

// --- Provider circuit breaker ---------------------------------------------------
//
// The bridge's `tick` waits for the flush before it exits. Without a
// breaker, a gateway that is down or hung costs every single tick
// FLUSH_LIMIT x recipients x TIMEOUT_MS — 150 s of a 120 s tick interval
// for two recipients on the defaults — and burns MAX_ATTEMPTS on every
// queued notification, so a long outage does not delay the messages, it
// destroys them (they reach EXHAUSTED and are never sent).
//
// The breaker turns both of those into one cheap decision: after
// BREAKER_THRESHOLD consecutive PROVIDER-level failures the flush stops
// touching the ledger at all until a cooldown expires, then lets exactly one
// entry through as a probe. Nothing is dropped and no attempt is consumed
// while the circuit is open — the notifications simply wait, which is the
// correct behaviour for an outage.
//
// Only provider-level failures count: a transport error, a timeout, or a 5xx.
// A 4xx is the gateway rejecting THIS message (bad recipient, bad body) and
// says nothing about the gateway's health, so it never opens the circuit.
function isProviderFailure(result) {
  if (!result || result.ok) return false;
  if (result.status === null || result.status === undefined) return true;   // transport / timeout
  return result.status >= 500;
}

function readBreaker(cfg) {
  var empty = { state: 'closed', failures: 0, opened_at: null, open_until: null, cooldown_ms: cfg.breakerCooldownMs, last_error: null, probes: 0 };
  try {
    var raw = JSON.parse(fs.readFileSync(cfg.breakerFile, 'utf8'));
    if (!raw || typeof raw !== 'object') return empty;
    return {
      state: raw.state === 'open' ? 'open' : 'closed',
      failures: Math.max(0, parseInt(raw.failures, 10) || 0),
      opened_at: raw.opened_at || null,
      open_until: raw.open_until || null,
      cooldown_ms: Math.max(1000, parseInt(raw.cooldown_ms, 10) || cfg.breakerCooldownMs),
      last_error: raw.last_error || null,
      probes: Math.max(0, parseInt(raw.probes, 10) || 0)
    };
  } catch (e) {
    // An unreadable or corrupt breaker file must never suppress delivery:
    // fail CLOSED, i.e. towards attempting the send.
    return empty;
  }
}

function writeBreaker(cfg, b) {
  try {
    fs.mkdirSync(cfg.home, { recursive: true, mode: 0o700 });
    var tmp = cfg.breakerFile + '.tmp-' + process.pid;
    var fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeSync(fd, JSON.stringify(b, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, cfg.breakerFile);
  } catch (e) {
    // Losing the breaker state degrades to today's behaviour (always try);
    // it must never abort a flush.
  }
  return b;
}

// Decides whether this flush may touch the provider at all.
function breakerGate(cfg, nowMs) {
  if (!cfg.breakerEnabled) return { allow: true, probe: false, state: 'disabled' };
  var b = readBreaker(cfg);
  if (b.state !== 'open') return { allow: true, probe: false, state: b.state, failures: b.failures };
  var until = Date.parse(b.open_until || 0) || 0;
  if (nowMs < until) {
    return { allow: false, probe: false, state: 'open', open_until: b.open_until, failures: b.failures, last_error: b.last_error, retry_in_ms: until - nowMs };
  }
  // Cooldown expired: half-open. Exactly ONE entry is allowed through.
  return { allow: true, probe: true, state: 'half-open', failures: b.failures, open_until: b.open_until };
}

// Folds one attempt's outcome into the breaker. `providerFailed` is the
// aggregate of isProviderFailure() over the attempt's recipient results.
function recordBreaker(cfg, providerFailed, error) {
  if (!cfg.breakerEnabled) return null;
  var b = readBreaker(cfg);
  var now = Date.now();
  if (!providerFailed) {
    return writeBreaker(cfg, { state: 'closed', failures: 0, opened_at: null, open_until: null, cooldown_ms: cfg.breakerCooldownMs, last_error: null, probes: b.probes });
  }
  b.failures += 1;
  b.last_error = error ? String(error).slice(0, 200) : b.last_error;
  if (b.failures >= cfg.breakerThreshold) {
    // Each consecutive open doubles the cooldown, capped like the per-entry
    // backoff, so a multi-hour outage costs a handful of probes, not one
    // probe per tick.
    var cooldown = b.state === 'open' ? Math.min(b.cooldown_ms * 2, MAX_BACKOFF_MS) : cfg.breakerCooldownMs;
    b.state = 'open';
    b.opened_at = new Date(now).toISOString();
    b.open_until = new Date(now + cooldown).toISOString();
    b.cooldown_ms = cooldown;
    b.probes = (b.probes || 0) + 1;
  }
  return writeBreaker(cfg, b);
}

// Operator-facing snapshot; never mutates.
function breakerStatus(cfg) {
  cfg = cfg || config();
  if (!cfg.breakerEnabled) return { enabled: false, state: 'disabled' };
  var b = readBreaker(cfg);
  var until = Date.parse(b.open_until || 0) || 0;
  return {
    enabled: true,
    state: b.state === 'open' && Date.now() >= until ? 'half-open' : b.state,
    failures: b.failures,
    threshold: cfg.breakerThreshold,
    open_until: b.open_until,
    cooldown_ms: b.cooldown_ms,
    last_error: b.last_error
  };
}

// --- Which report states notify -------------------------------------------------

// COMPLETED / FAILED / BLOCKED / HUMAN_APPROVAL only.
//
// HUMAN_APPROVAL is not a control status — it is the bridge's existing
// "this stops here until a person decides" condition, which the bridge
// already records as BLOCKED with a human decision as the next action (the
// claim exists but the executor record is gone, so the task must never be
// silently re-executed). It gets its own notification kind because that is
// precisely the case where a message on a phone is the point.
//
// CANCELLED never notifies: it is the human's own action, already known to
// them. Non-terminal states (PENDING, CLAIMED, IN_PROGRESS, VALIDATING)
// never notify — the whole layer only ever sees terminal reports.
function notificationKind(status, opts) {
  if (opts && opts.human_approval && status === 'BLOCKED') return 'HUMAN_APPROVAL';
  if (status === 'COMPLETED' || status === 'FAILED' || status === 'BLOCKED') return status;
  return null;
}

// --- Message ---------------------------------------------------------------

function clip(text, max) {
  var s = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Built from the REPORT the bridge already wrote and validated, rendered by
// the shared presenter (gh-issue-191: short, owner-facing, simple Arabic
// explanation, no branch/file/commit/id detail). The presenter strips
// internal identifiers and redacts secret shapes; the message goes to a
// third-party gateway, so it is redacted once more here, on the way out.
function buildMessage(report, kind) {
  var exec = report.execution || {};
  var presented = presenter.presentReport(report, kind, { model: exec.model || null, details_ref: 'path' });
  return redact.redact(presented.text).slice(0, MAX_MESSAGE);
}

// --- Ledger ------------------------------------------------------------------

function ledgerKey(taskId, kind) {
  var key = String(taskId) + '__' + String(kind);
  if (!KEY_RE.test(key)) throw new Error('NOTIFY_KEY_INVALID: ' + JSON.stringify(key).slice(0, 80));
  return key;
}

function ensureLedger(cfg) {
  fs.mkdirSync(cfg.ledgerDir, { recursive: true, mode: 0o700 });
  return cfg.ledgerDir;
}

function entryFile(cfg, key) {
  if (!KEY_RE.test(key)) throw new Error('NOTIFY_KEY_INVALID');
  return path.join(cfg.ledgerDir, key + '.json');
}

function readEntry(cfg, key) {
  try { return JSON.parse(fs.readFileSync(entryFile(cfg, key), 'utf8')); } catch (e) { return null; }
}

// Best-effort: fsync the directory entry so the rename itself survives a
// crash, not just the file's bytes. Not every platform allows opening a
// directory for reading (notably Windows) or fsyncing it once open, so a
// failure here is swallowed — the fsync on the file's own fd above already
// guarantees the entry's bytes are on disk before the rename is attempted.
function fsyncDir(dir) {
  var fd;
  try { fd = fs.openSync(dir, 'r'); } catch (e) { return; }
  try { fs.fsyncSync(fd); } catch (e) { /* not fsync-able on this platform */ }
  try { fs.closeSync(fd); } catch (e) { /* already closed */ }
}

function writeEntry(cfg, entry) {
  var dir = ensureLedger(cfg);
  var file = entryFile(cfg, entry.key);
  var tmp = file + '.tmp-' + process.pid;
  var fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(entry, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fsyncDir(dir);
  return entry;
}

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

// O_EXCL lock, one per ledger key. This is what makes two concurrent ticks
// (or a tick racing a manual `notify-flush`) safe even though they share
// the same ledger: only one of them ever performs the send.
function lockFile(cfg, key) { return path.join(cfg.ledgerDir, key + '.lock'); }

// A lock is stale only when its holder is demonstrably gone. Age alone is
// not enough: a slow provider is not a dead process, and stealing a live
// claim is precisely how a duplicate message gets sent. The age check
// survives only as a pid-reuse guard at 10× the lease.
//
// The holder's own pid is treated like any other live pid, so two flushes
// racing inside one process (CLI and daemon, or two chained promises) are
// serialised exactly like two processes would be.
function lockIsStale(cfg, file) {
  try {
    var st = fs.statSync(file);
    var pid = parseInt(fs.readFileSync(file, 'utf8'), 10);
    if (!pid) return true;
    if (!state.processAlive(pid)) return true;
    return (Date.now() - st.mtimeMs) > cfg.leaseMs * 10;
  } catch (e) {
    return true;
  }
}

function acquireKeyLock(cfg, key) {
  ensureLedger(cfg);
  var file = lockFile(cfg, key);
  var fd = null;
  try {
    fd = fs.openSync(file, 'wx', 0o600);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (!lockIsStale(cfg, file)) return null;
    try { fs.unlinkSync(file); } catch (e2) { /* another process reclaimed it first */ }
    try { fd = fs.openSync(file, 'wx', 0o600); } catch (e3) { return null; }
  }
  try { fs.writeSync(fd, String(process.pid)); } finally { try { fs.closeSync(fd); } catch (e) { /* closed */ } }
  return file;
}

function releaseKeyLock(file) { try { if (file) fs.unlinkSync(file); } catch (e) { /* already gone */ } }

function backoffFor(cfg, attempts) {
  return Math.min(cfg.backoffMs * Math.pow(2, Math.max(0, attempts - 1)), MAX_BACKOFF_MS);
}

// --- Phase 1: enqueue (synchronous, called from the bridge tick) --------------------

// Never throws. Never performs I/O beyond the executor's own store. The
// caller's return value is diagnostic only; the bridge ignores failures.
function onReport(report, opts) {
  var cfg;
  try {
    cfg = config();
    if (!cfg.enabled) return { queued: false, skipped: 'whatsapp notifications disabled' };
    if (!report || typeof report !== 'object' || !report.task_id) return { queued: false, skipped: 'no report' };

    var kind = notificationKind(report.status, opts);
    if (!kind) return { queued: false, skipped: 'status ' + String(report.status) + ' does not notify' };
    if (cfg.kinds.indexOf(kind) === -1) return { queued: false, kind: kind, skipped: 'kind not enabled' };

    // Only QUEUE-scope readiness gates the enqueue. Delivery-scope
    // configuration (gateway address, instance, credential) is re-checked on
    // every flush, so a transient credential-read failure delays the message
    // instead of destroying it — the REPORT is written once and this is the
    // only moment the notification could ever have been created.
    var problems = queueReadiness(cfg);
    if (problems.length) return { queued: false, kind: kind, skipped: 'not configured', problems: problems };

    var key = ledgerKey(report.task_id, kind);
    var existing = readEntry(cfg, key);
    if (existing) {
      return { queued: false, key: key, kind: kind, skipped: 'already in the ledger (' + existing.state + ')', state: existing.state };
    }

    var message = buildMessage(report, kind);
    var now = new Date().toISOString();
    writeEntry(cfg, {
      key: key,
      task_id: report.task_id,
      kind: kind,
      report_status: report.status,
      state: 'PENDING',
      provider: cfg.provider,
      attempts: 0,
      recipients: cfg.recipients.slice(),
      delivered_to: [],
      message: message,
      message_sha256: crypto.createHash('sha256').update(message).digest('hex'),
      created_at: now,
      updated_at: now,
      next_attempt_at: now,
      created_by: 'github-bridge@' + os.hostname(),
      last_error: null,
      results: []
    });
    return { queued: true, key: key, kind: kind, recipients: cfg.recipients.length };
  } catch (e) {
    // A notification is never allowed to interrupt the bridge, not even by
    // throwing out of its own bookkeeping.
    return { queued: false, error: redact.redact(String(e && e.message)).slice(0, 300) };
  }
}

// --- Phase 2: flush (asynchronous, called AFTER the tick returned) -----------------

function due(entry, nowMs) {
  if (entry.state !== 'PENDING') return false;
  return !entry.next_attempt_at || Date.parse(entry.next_attempt_at) <= nowMs;
}

function pendingRecipients(entry) {
  var done = entry.delivered_to || [];
  return (entry.recipients || []).filter(function (r) { return done.indexOf(r) === -1; });
}

// Sends one entry. The lock is held for the whole attempt, and the entry is
// marked SENDING on disk first, so a crash mid-send leaves a claim that the
// next flush reclaims (lease expiry) instead of a silent duplicate.
function deliverEntry(cfg, entry, provider, apiKey, deadlineMs) {
  var lock = acquireKeyLock(cfg, entry.key);
  if (!lock) return Promise.resolve({ key: entry.key, skipped: 'locked by another process' });

  // Re-read under the lock: another process may have completed it between
  // listEntries() and the lock acquisition.
  var fresh = readEntry(cfg, entry.key) || entry;
  if (fresh.state === 'SENT' || fresh.state === 'EXHAUSTED') {
    releaseKeyLock(lock);
    return Promise.resolve({ key: fresh.key, skipped: 'already ' + fresh.state });
  }
  if (!due(fresh, Date.now()) && fresh.state !== 'SENDING') {
    releaseKeyLock(lock);
    return Promise.resolve({ key: fresh.key, skipped: 'not due' });
  }

  var targets = pendingRecipients(fresh);
  if (!targets.length) {
    fresh.state = 'SENT';
    fresh.updated_at = new Date().toISOString();
    writeEntry(cfg, fresh);
    releaseKeyLock(lock);
    return Promise.resolve({ key: fresh.key, sent: true, recipients: 0, note: 'nothing left to deliver' });
  }

  fresh.state = 'SENDING';
  fresh.attempts = (fresh.attempts || 0) + 1;
  fresh.sending_pid = process.pid;
  fresh.updated_at = new Date().toISOString();
  writeEntry(cfg, fresh);

  // Each recipient is written to the ledger the instant its own send is
  // acknowledged, not batched until every recipient in this attempt is
  // done. That is the whole difference between "at-least-once" and a
  // duplicate: batching the write left a window where the provider had
  // already accepted the message for recipient N but a crash before the
  // *next* recipient's promise settled would lose that fact, and a
  // reclaimed retry would re-send to N. Writing immediately shrinks the
  // unavoidable risk window to the time between the provider's ACK and this
  // write's synchronous fsync-then-rename (writeEntry() fsyncs the tmp
  // file's own fd before the rename, and best-effort fsyncs the ledger
  // directory after it, so the recorded fact is on disk, not just handed to
  // the OS's page cache) — as small as a single-host ledger can make it
  // without provider-side idempotency keys (Evolution API's sendText has
  // none; see docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md §6). This is
  // at-least-once delivery with best-effort de-duplication, not a proven
  // exactly-once guarantee.
  var results = [];
  var deferred = 0;
  var chain = Promise.resolve();
  targets.forEach(function (to) {
    chain = chain.then(function () {
      // The flush budget is checked between recipients as well as between
      // entries: one entry with many recipients must not be able to consume
      // the whole tick on its own. A recipient skipped here is simply not in
      // `delivered_to`, which is already the retry rule.
      if (deadlineMs && Date.now() >= deadlineMs) { deferred++; return null; }
      return provider.sendText({
        baseUrl: cfg.baseUrl,
        instance: cfg.instance,
        apiKey: apiKey,
        to: to,
        text: fresh.message,
        timeoutMs: cfg.timeoutMs,
        apiVersion: cfg.apiVersion,
        options: selectedOptions(cfg)
      }).then(function (r) {
        results.push({ ok: !!r.ok, status: r.status || null, provider_message_id: r.provider_message_id || null, error: r.error ? redact.redact(String(r.error)).slice(0, 300) : null });
        if (r.ok) {
          fresh.delivered_to = (fresh.delivered_to || []).concat([to]);
          fresh.updated_at = new Date().toISOString();
          writeEntry(cfg, fresh);
        }
      });
    });
  });

  return chain.then(function () {
    var failed = results.filter(function (r) { return !r.ok; });
    var providerFailed = results.some(isProviderFailure);
    var now = new Date().toISOString();
    fresh.updated_at = now;
    delete fresh.sending_pid;
    // Evidence only: recipients are never written back, only counts and the
    // provider's own message ids.
    fresh.results = (fresh.results || []).concat([{ at: now, attempt: fresh.attempts, delivered: results.length - failed.length, failed: failed.length, deferred: deferred, detail: results }]).slice(-10);
    if (results.length) recordBreaker(cfg, providerFailed, providerFailed ? (failed[0] && failed[0].error) : null);
    // SENT means EVERY recipient is in `delivered_to`. Deriving it from
    // "this attempt had no failure" would mark an entry delivered whose
    // remaining recipients were cut by the flush budget.
    var remaining = pendingRecipients(fresh);
    if (!failed.length && !remaining.length) {
      fresh.state = 'SENT';
      fresh.sent_at = now;
      fresh.last_error = null;
      writeEntry(cfg, fresh);
      releaseKeyLock(lock);
      return { key: fresh.key, sent: true, kind: fresh.kind, task_id: fresh.task_id, attempts: fresh.attempts, recipients: results.length };
    }
    if (!failed.length) {
      // Nothing failed; the flush simply ran out of wall clock. That is a
      // local scheduling decision, not a delivery attempt, so it must not
      // consume one of MAX_ATTEMPTS, and the remainder is due immediately.
      fresh.attempts = Math.max(0, (fresh.attempts || 1) - 1);
      fresh.state = 'PENDING';
      fresh.next_attempt_at = now;
      fresh.last_error = null;
      writeEntry(cfg, fresh);
      releaseKeyLock(lock);
      return { key: fresh.key, sent: false, deferred: remaining.length, budget_exhausted: true, kind: fresh.kind, task_id: fresh.task_id, attempts: fresh.attempts, recipients: results.length };
    }
    fresh.last_error = failed[0].error || ('HTTP ' + failed[0].status);
    if (fresh.attempts >= cfg.maxAttempts) {
      fresh.state = 'EXHAUSTED';
      fresh.exhausted_at = now;
      writeEntry(cfg, fresh);
      releaseKeyLock(lock);
      return { key: fresh.key, sent: false, exhausted: true, kind: fresh.kind, task_id: fresh.task_id, attempts: fresh.attempts, error: fresh.last_error };
    }
    fresh.state = 'PENDING';
    fresh.next_attempt_at = new Date(Date.now() + backoffFor(cfg, fresh.attempts)).toISOString();
    writeEntry(cfg, fresh);
    releaseKeyLock(lock);
    return { key: fresh.key, sent: false, retry_at: fresh.next_attempt_at, kind: fresh.kind, task_id: fresh.task_id, attempts: fresh.attempts, error: fresh.last_error };
  }, function (err) {
    // A provider adapter is contractually not allowed to reject; if one
    // does, treat it exactly like a failed attempt rather than losing the
    // entry or propagating into the caller.
    var now = new Date().toISOString();
    fresh.state = fresh.attempts >= cfg.maxAttempts ? 'EXHAUSTED' : 'PENDING';
    fresh.next_attempt_at = new Date(Date.now() + backoffFor(cfg, fresh.attempts)).toISOString();
    fresh.last_error = redact.redact(String(err && err.message)).slice(0, 300);
    fresh.updated_at = now;
    delete fresh.sending_pid;
    writeEntry(cfg, fresh);
    // A misbehaving adapter that rejects is a provider-level fault.
    recordBreaker(cfg, true, fresh.last_error);
    releaseKeyLock(lock);
    return { key: fresh.key, sent: false, kind: fresh.kind, task_id: fresh.task_id, attempts: fresh.attempts, error: fresh.last_error };
  });
}

// Reclaims SENDING entries whose lease expired and whose owner is gone —
// the restart-recovery path. A SENT entry is never touched, so a crash
// after a successful send can never produce a second message.
function reclaimStale(cfg) {
  var reclaimed = 0;
  listEntries(cfg).forEach(function (e) {
    if (e.state !== 'SENDING') return;
    var age = Date.now() - Date.parse(e.updated_at || e.created_at || 0);
    if (age < cfg.leaseMs) return;
    if (e.sending_pid && state.processAlive(e.sending_pid)) return;
    e.state = e.attempts >= cfg.maxAttempts ? 'EXHAUSTED' : 'PENDING';
    e.next_attempt_at = new Date().toISOString();
    e.last_error = 'interrupted mid-send (lease expired); requeued';
    e.updated_at = new Date().toISOString();
    delete e.sending_pid;
    writeEntry(cfg, e);
    reclaimed++;
  });
  return reclaimed;
}

// Delivers every due entry. Always resolves — never rejects — so the caller
// can chain it after tick() without any guard of its own.
function flush(opts) {
  opts = opts || {};
  var cfg;
  try {
    cfg = config();
  } catch (e) {
    return Promise.resolve({ ok: false, error: redact.redact(String(e && e.message)).slice(0, 300) });
  }
  if (!cfg.enabled) return Promise.resolve({ ok: true, enabled: false, attempted: 0, sent: 0, failed: 0, results: [] });
  var provider = PROVIDERS[cfg.provider];
  var apiKey = credential(cfg);
  var problems = readiness(cfg, !!apiKey);
  if (problems.length) return Promise.resolve({ ok: false, enabled: true, attempted: 0, sent: 0, failed: 0, problems: problems, results: [] });

  var reclaimed = 0;
  try { reclaimed = reclaimStale(cfg); } catch (e) { /* a reclaim failure must not stop delivery */ }

  var now = Date.now();

  // The provider circuit. While it is open nothing is attempted, no attempt
  // is consumed and no entry is touched, so an outage postpones the
  // notifications instead of exhausting them.
  var gate = breakerGate(cfg, now);
  if (!gate.allow) {
    return Promise.resolve({
      ok: true, enabled: true, reclaimed: reclaimed, attempted: 0, sent: 0, failed: 0,
      skipped: 'provider circuit breaker is open', breaker: gate, results: []
    });
  }

  var limit = opts.limit || cfg.flushLimit;
  if (gate.probe) limit = 1;   // half-open: exactly one entry decides the circuit
  var batch;
  try {
    batch = listEntries(cfg).filter(function (e) { return due(e, now); }).slice(0, limit);
  } catch (e) {
    return Promise.resolve({ ok: false, enabled: true, error: redact.redact(String(e && e.message)).slice(0, 300), results: [] });
  }
  if (!batch.length) return Promise.resolve({ ok: true, enabled: true, reclaimed: reclaimed, attempted: 0, sent: 0, failed: 0, breaker: breakerStatus(cfg), results: [] });

  // Wall-clock ceiling for the whole flush. `tick` waits for this before it
  // exits, so it must be bounded independently of how many recipients or
  // entries are due.
  var deadline = now + (opts.budgetMs || cfg.flushBudgetMs);
  var results = [];
  var chain = Promise.resolve();
  batch.forEach(function (entry) {
    chain = chain.then(function () {
      if (Date.now() >= deadline) {
        results.push({ key: entry.key, skipped: 'flush budget exhausted' });
        return null;
      }
      // Re-check the circuit between entries: once this flush has itself
      // established that the gateway is down, the remaining entries must not
      // each pay another timeout to re-establish it.
      if (cfg.breakerEnabled && !breakerGate(cfg, Date.now()).allow) {
        results.push({ key: entry.key, skipped: 'provider circuit breaker is open' });
        return null;
      }
      return deliverEntry(cfg, entry, provider, apiKey, deadline).then(function (r) { results.push(r); }, function (e) {
        results.push({ key: entry.key, sent: false, error: redact.redact(String(e && e.message)).slice(0, 300) });
      });
    });
  });
  return chain.then(function () {
    return {
      ok: true,
      enabled: true,
      reclaimed: reclaimed,
      attempted: results.filter(function (r) { return !r.skipped; }).length,
      sent: results.filter(function (r) { return r.sent; }).length,
      // A budget cut is not a failure: nothing failed, the flush simply ran
      // out of wall clock and the remainder is due immediately.
      failed: results.filter(function (r) { return r.sent === false && !r.budget_exhausted; }).length,
      deferred: results.filter(function (r) { return r.skipped === 'flush budget exhausted' || r.budget_exhausted; }).length,
      breaker: breakerStatus(cfg),
      results: results
    };
  });
}

// --- Operator surface -----------------------------------------------------------

// Ledger view, without message bodies (a summary written by an executing
// session is not something `notify-status` should splash into a terminal).
function ledgerStatus() {
  var cfg = config();
  var counts = {};
  LEDGER_STATES.forEach(function (s) { counts[s] = 0; });
  var rows = listEntries(cfg).map(function (e) {
    counts[e.state] = (counts[e.state] || 0) + 1;
    return {
      key: e.key, task_id: e.task_id, kind: e.kind, state: e.state, attempts: e.attempts,
      recipients: (e.recipients || []).length, delivered: (e.delivered_to || []).length,
      created_at: e.created_at, updated_at: e.updated_at, next_attempt_at: e.next_attempt_at,
      sent_at: e.sent_at || null, last_error: e.last_error || null, message_sha256: e.message_sha256
    };
  });
  return { ledger_dir: cfg.ledgerDir, counts: counts, breaker: breakerStatus(cfg), entries: rows };
}

// Operator override: force the circuit closed after a gateway has been
// repaired, instead of waiting out the cooldown. It only clears breaker
// state — it never sends, never touches the ledger and never changes an
// entry's attempts.
function resetBreaker() {
  var cfg = config();
  writeBreaker(cfg, { state: 'closed', failures: 0, opened_at: null, open_until: null, cooldown_ms: cfg.breakerCooldownMs, last_error: null, probes: 0 });
  return breakerStatus(cfg);
}

// The controlled real smoke test. Deliberately NOT reachable from the tick
// path and NOT part of any automated suite: it is invoked by a human, once,
// after the automated suites are green (`mythos-github-bridge notify-test
// --confirm`). It bypasses the ledger because it is not a task notification.
function smokeTest(opts) {
  opts = opts || {};
  var cfg = config();
  var provider = PROVIDERS[cfg.provider];
  var apiKey = credential(cfg);
  var problems = readiness(cfg, !!apiKey);
  if (!cfg.enabled) problems.unshift('MYTHOS_BRIDGE_WHATSAPP_ENABLED is not 1');
  if (problems.length) return Promise.resolve({ ok: false, sent: 0, problems: problems });
  var text = redact.redact(
    '🧪 MYTHOS bridge notification smoke test — ' + new Date().toISOString() + '\n' +
    'Sent by ' + os.hostname() + ' via the ' + cfg.provider + ' adapter.\n' +
    'This is the one controlled real message of the notification stage; it carries no task data.'
  ).slice(0, MAX_MESSAGE);
  var results = [];
  var chain = Promise.resolve();
  cfg.recipients.forEach(function (to) {
    chain = chain.then(function () {
      return provider.sendText({
        baseUrl: cfg.baseUrl, instance: cfg.instance, apiKey: apiKey, to: to,
        text: text, timeoutMs: cfg.timeoutMs, apiVersion: cfg.apiVersion,
        options: selectedOptions(cfg)
      }).then(function (r) {
        results.push({ ok: !!r.ok, status: r.status || null, provider_message_id: r.provider_message_id || null, error: r.error || null });
      });
    });
  });
  return chain.then(function () {
    return { ok: results.length > 0 && results.every(function (r) { return r.ok; }), sent: results.filter(function (r) { return r.ok; }).length, attempted: results.length, results: results };
  });
}

module.exports = {
  KINDS: KINDS,
  PROVIDERS: PROVIDERS,
  config: config,
  describe: describe,
  readiness: readiness,
  queueReadiness: queueReadiness,
  breakerGate: breakerGate,
  breakerStatus: breakerStatus,
  resetBreaker: resetBreaker,
  isProviderFailure: isProviderFailure,
  isPrivateHost: isPrivateHost,
  notificationKind: notificationKind,
  buildMessage: buildMessage,
  ledgerKey: ledgerKey,
  readEntry: readEntry,
  listEntries: listEntries,
  reclaimStale: reclaimStale,
  onReport: onReport,
  flush: flush,
  ledgerStatus: ledgerStatus,
  smokeTest: smokeTest
};
