'use strict';
// =====================================================
// MYTHOS git / production / governance → Telegram notifier
// projects/mythos-ai-executor/bridge/gov-notify.js
//
// The bridge, the Issues adapter and the Telegram adapter all write their
// events through the same bridge.log() into one shared, append-only
// events.log (MYTHOS_BRIDGE_HOME/events.log). This module tails that file
// (by byte offset, never re-reading what it already saw) for the handful of
// event names that mean "a human should know about this": a control-branch
// sync failure, a preflight/governance block, or a bridge/claim/report
// failure — and turns each NEW one into one unified Telegram notification
// (bridge/notify/telegram-events.js), deduplicated by (event, reason) so a
// standing problem is announced once, not on every tick, while a genuinely
// new or different failure is never swallowed.
//
// Read-only with respect to the bridge: it never claims, commits, or
// touches the control branch. Its only state is its own offset file.
// =====================================================

var fs = require('fs');
var path = require('path');

var bridge = require('./github-bridge');
var telegramEvents = require('./notify/telegram-events');

var BY = 'gov-notify';

// bridge-log event name -> { event, category } in the unified notifier.
// Anything from the 'telegram-events:' or 'telegram:' namespaces is
// deliberately excluded: a Telegram delivery problem cannot reliably be
// reported over Telegram, and including it risks a feedback loop.
var WATCHED = {
  sync_failed: { event: 'sync_blocker' },
  blocked_preflight: { event: 'governance_blocker' },
  lock_takeover: { event: 'bridge_failure' },
  claim_failed: { event: 'bridge_failure' },
  report_failed: { event: 'bridge_failure' },
  lease_expired: { event: 'bridge_failure' },
  'issues:phase_error': { event: 'bridge_failure' },
  'pr-watch:fetch_failed': { event: 'bridge_failure' }
};

function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function config() {
  var b = bridge.config();
  return { bridge: b, home: path.join(b.home, 'gov-notify'), logFile: path.join(b.home, 'events.log') };
}

function ensureHome(cfg) { fs.mkdirSync(cfg.home, { recursive: true, mode: 0o700 }); }
function offsetFile(cfg) { return path.join(cfg.home, 'offset.json'); }
function readOffset(cfg) {
  try { var v = JSON.parse(fs.readFileSync(offsetFile(cfg), 'utf8')); return typeof v.offset === 'number' && v.offset >= 0 ? v.offset : 0; } catch (e) { return 0; }
}
function writeOffset(cfg, offset) {
  ensureHome(cfg);
  var tmp = offsetFile(cfg) + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify({ offset: offset, updated_at: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, offsetFile(cfg));
}

function notifyTelegram(evt) {
  return telegramEvents.notifyEvent(evt).then(function (r) { return r; }, function () { return { sent: false, reason: 'error' }; });
}

function describeReason(fields) {
  if (!fields || typeof fields !== 'object') return '';
  return short(String(fields.reason || fields.error || ''), 300);
}

// Pure: raw new bytes of the log file (since the last offset) -> parsed
// entries whose `bridge` field is one this module watches for.
function parseWatched(text) {
  return text.split('\n').filter(Boolean).map(function (line) {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(function (entry) { return entry && WATCHED.hasOwnProperty(entry.bridge); });
}

async function tick(opts) {
  opts = opts || {};
  var cfg = config();
  var actions = [];
  var size = 0;
  try { size = fs.statSync(cfg.logFile).size; } catch (e) { return { ok: true, actions: [{ action: 'no_log' }] }; }
  var offset = readOffset(cfg);
  if (offset > size) offset = 0; // log rotated/truncated: start over rather than error
  if (offset === size) return { ok: true, actions: [{ action: 'up_to_date', offset: offset }] };
  var fd = fs.openSync(cfg.logFile, 'r');
  var buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  var entries = parseWatched(buf.toString('utf8'));
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var mapping = WATCHED[entry.bridge];
    var reason = describeReason(entry);
    var key = entry.bridge + '|' + reason;
    if (opts.dryRun) { actions.push({ action: 'would_notify', bridge_event: entry.bridge, reason: reason }); continue; }
    var res = await notifyTelegram({
      category: 'git', event: mapping.event, key: key,
      title: entry.bridge.replace(/^[a-z-]+:/, '') + (reason ? ': ' + reason : '')
    });
    actions.push({ action: 'notify', bridge_event: entry.bridge, event: mapping.event, result: res });
  }
  if (!opts.dryRun) writeOffset(cfg, size);
  return { ok: true, actions: actions, scanned_bytes: size - offset };
}

function status() {
  var cfg = config();
  var size = 0;
  try { size = fs.statSync(cfg.logFile).size; } catch (e) { /* no log yet */ }
  return { channel: BY, log_file: cfg.logFile, log_size: size, offset: readOffset(cfg), watched_events: Object.keys(WATCHED) };
}

module.exports = { BY: BY, WATCHED: WATCHED, config: config, parseWatched: parseWatched, tick: tick, status: status };
