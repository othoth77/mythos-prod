'use strict';
// =====================================================
// MYTHOS AUTO auto-reply — idempotency & loop-safety ledger
// projects/automotive/comms/lib/ledger.js
//
// Small file-based state (no database, no service) that makes the engine
// safe to run behind a provider that retries webhooks:
//
//   events/<event_id>.json         one record per inbound, created with
//                                  O_EXCL → the second delivery of the same
//                                  message is DUPLICATE_INBOUND, whatever
//                                  the first one is doing right now.
//                                  States: RECEIVED → DECIDED →
//                                  SUPPRESSED | SENDING → SENT | SEND_FAILED.
//                                  A SEND_FAILED is final: the engine never
//                                  re-sends by itself (no duplicate on a
//                                  provider timeout that actually delivered).
//   outbound/<hash>                marker per provider message id WE sent;
//                                  an inbound carrying that id is our echo.
//   conversations/<hash>.json      reply timestamps per (project,
//                                  conversation) for the hourly cap.
//   provider.json                  consecutive send failures + cooldown
//                                  (breaker) — PROVIDER_UNAVAILABLE while open.
//
// Nothing in a file name is customer data: event ids are hashes already,
// conversation keys and outbound ids are hashed here. Records hold names,
// timestamps and the masked recipient — never message text, never a token.
//
// Independent of the notification ledger in bridge/notify (different data,
// different directory, different rules); it only shares the technique.
//
// open({ dir }) → file ledger   |   open({ memory: true }) → in-process
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var STATES = ['RECEIVED', 'DECIDED', 'SUPPRESSED', 'SENDING', 'SENT', 'SEND_FAILED'];
var EVENT_ID_RE = /^[A-Za-z0-9._-]{4,80}$/;
var HOUR_MS = 3600000;

function hash(s) { return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 32); }

function atomicWrite(file, obj) {
  var tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  var fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(obj, null, 0));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// ------------------------------------------------------------ file ledger

function fileLedger(dir) {
  ['events', 'outbound', 'conversations'].forEach(function (d) { fs.mkdirSync(path.join(dir, d), { recursive: true, mode: 0o700 }); });
  var eventFile = function (id) { return path.join(dir, 'events', id + '.json'); };
  var providerFile = path.join(dir, 'provider.json');

  return {
    kind: 'file',
    dir: dir,
    claim: function (eventId, record) {
      if (!EVENT_ID_RE.test(String(eventId))) return { ok: false, reason: 'EVENT_ID_INVALID' };
      var rec = Object.assign({ event_id: eventId, state: 'RECEIVED', received_at: new Date().toISOString() }, record || {});
      var fd;
      try { fd = fs.openSync(eventFile(eventId), 'wx', 0o600); } catch (e) {
        if (e && e.code === 'EEXIST') return { ok: false, reason: 'DUPLICATE_INBOUND', existing: readJson(eventFile(eventId)) };
        throw e;
      }
      try { fs.writeSync(fd, JSON.stringify(rec)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      return { ok: true, reason: null };
    },
    get: function (eventId) { return EVENT_ID_RE.test(String(eventId)) ? readJson(eventFile(eventId)) : null; },
    update: function (eventId, patch) {
      if (!EVENT_ID_RE.test(String(eventId))) return null;
      var cur = readJson(eventFile(eventId)) || { event_id: eventId };
      if (patch && patch.state && STATES.indexOf(patch.state) === -1) throw new Error('LEDGER_STATE_INVALID');
      var next = Object.assign({}, cur, patch || {}, { updated_at: new Date().toISOString() });
      atomicWrite(eventFile(eventId), next);
      return next;
    },
    recordOutbound: function (adapter, providerMessageId, eventId) {
      if (!providerMessageId) return false;
      var f = path.join(dir, 'outbound', hash(adapter + '\0' + providerMessageId));
      try { fs.writeFileSync(f, JSON.stringify({ event_id: eventId, at: new Date().toISOString() }), { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      return true;
    },
    isOwnOutbound: function (adapter, providerMessageId) {
      if (!providerMessageId) return false;
      return fs.existsSync(path.join(dir, 'outbound', hash(adapter + '\0' + providerMessageId)));
    },
    countReplies: function (conversationKey, windowMs, now) {
      now = now || Date.now();
      var f = path.join(dir, 'conversations', hash(conversationKey) + '.json');
      var rec = readJson(f) || { sent: [] };
      return (rec.sent || []).filter(function (t) { return now - t < (windowMs || HOUR_MS); }).length;
    },
    recordReply: function (conversationKey, now) {
      now = now || Date.now();
      var f = path.join(dir, 'conversations', hash(conversationKey) + '.json');
      var rec = readJson(f) || { sent: [] };
      rec.sent = (rec.sent || []).filter(function (t) { return now - t < 24 * HOUR_MS; }).concat([now]);
      atomicWrite(f, rec);
      return rec.sent.length;
    },
    provider: function () { return readJson(providerFile) || { failures: 0, open_until: 0, last_error: null }; },
    recordProviderFailure: function (error, threshold, cooldownMs, now) {
      now = now || Date.now();
      var p = readJson(providerFile) || { failures: 0, open_until: 0, last_error: null };
      p.failures = (p.failures || 0) + 1;
      p.last_error = typeof error === 'string' ? error.slice(0, 80) : 'SEND_FAILED';
      p.last_failure_at = new Date(now).toISOString();
      if (p.failures >= threshold) p.open_until = now + cooldownMs;
      atomicWrite(providerFile, p);
      return p;
    },
    recordProviderSuccess: function () {
      var p = { failures: 0, open_until: 0, last_error: null, last_success_at: new Date().toISOString() };
      atomicWrite(providerFile, p);
      return p;
    }
  };
}

// ---------------------------------------------------------- memory ledger

function memoryLedger() {
  var events = {}, outbound = {}, conv = {}, provider = { failures: 0, open_until: 0, last_error: null };
  return {
    kind: 'memory',
    dir: null,
    claim: function (eventId, record) {
      if (!EVENT_ID_RE.test(String(eventId))) return { ok: false, reason: 'EVENT_ID_INVALID' };
      if (events[eventId]) return { ok: false, reason: 'DUPLICATE_INBOUND', existing: events[eventId] };
      events[eventId] = Object.assign({ event_id: eventId, state: 'RECEIVED', received_at: new Date().toISOString() }, record || {});
      return { ok: true, reason: null };
    },
    get: function (eventId) { return events[eventId] || null; },
    update: function (eventId, patch) {
      if (patch && patch.state && STATES.indexOf(patch.state) === -1) throw new Error('LEDGER_STATE_INVALID');
      events[eventId] = Object.assign({}, events[eventId] || { event_id: eventId }, patch || {}, { updated_at: new Date().toISOString() });
      return events[eventId];
    },
    recordOutbound: function (adapter, id, eventId) { if (!id) return false; outbound[hash(adapter + '\0' + id)] = eventId; return true; },
    isOwnOutbound: function (adapter, id) { return !!id && Object.prototype.hasOwnProperty.call(outbound, hash(adapter + '\0' + id)); },
    countReplies: function (key, windowMs, now) {
      now = now || Date.now();
      return (conv[hash(key)] || []).filter(function (t) { return now - t < (windowMs || HOUR_MS); }).length;
    },
    recordReply: function (key, now) { now = now || Date.now(); var k = hash(key); conv[k] = (conv[k] || []).concat([now]); return conv[k].length; },
    provider: function () { return Object.assign({}, provider); },
    recordProviderFailure: function (error, threshold, cooldownMs, now) {
      now = now || Date.now();
      provider.failures += 1;
      provider.last_error = typeof error === 'string' ? error.slice(0, 80) : 'SEND_FAILED';
      if (provider.failures >= threshold) provider.open_until = now + cooldownMs;
      return Object.assign({}, provider);
    },
    recordProviderSuccess: function () { provider = { failures: 0, open_until: 0, last_error: null }; return Object.assign({}, provider); }
  };
}

function open(o) {
  o = o || {};
  if (o.memory || !o.dir) return memoryLedger();
  return fileLedger(o.dir);
}

module.exports = { STATES: STATES, EVENT_ID_RE: EVENT_ID_RE, HOUR_MS: HOUR_MS, hash: hash, open: open };
