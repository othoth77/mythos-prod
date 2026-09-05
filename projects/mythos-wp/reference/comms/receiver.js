'use strict';
// =====================================================
// MYTHOS WP — Communication Receiver (Evolution webhook endpoint)
// projects/mythos-wp/reference/comms/receiver.js
//
//   POST /hooks/evolution        (loopback, no session; token-authenticated)
//
// Pipeline: enabled? → body limit → JSON → token (constant time, from the
// 0600 file named by MYTHOS_WP_WEBHOOK_TOKEN_FILE) → provider parse →
// inbox lookup (wp_inboxes) → connection state | message → per-inbox flag:
//   inbound_enabled=false → DRY-RUN: validated, ledgered, NOT persisted
//   inbound_enabled=true  → core.ingest (exactly once)
// Every delivery leaves one wp_inbound_events row; failures keep a redacted
// payload copy there (dead-letter). Nothing here reads media bytes, sends a
// message or depends on the front end.
//
// Feature flag: MYTHOS_WP_RECEIVER_ENABLED=1 — absent means the route does
// not exist (404), which is the production default until COMMS-3/4.
// =====================================================
var fs = require('fs');
var crypto = require('crypto');
var url = require('url');
var evolution = require('./providers/evolution');
var core = require('./core');
var bus = require('./bus');
var TOKEN_HEADER = 'x-mythos-webhook-token';
var PROVIDERS = { evolution: evolution };

function config() {
  return {
    enabled: process.env.MYTHOS_WP_RECEIVER_ENABLED === '1',
    tokenFile: process.env.MYTHOS_WP_WEBHOOK_TOKEN_FILE || null,
    maxBody: Math.min(4 * 1024 * 1024, Math.max(16 * 1024, parseInt(process.env.MYTHOS_WP_RECEIVER_MAX_BODY || '524288', 10) || 524288))
  };
}
function readToken(file) {
  if (!file) return { present: false, reason: 'MYTHOS_WP_WEBHOOK_TOKEN_FILE not set' };
  try {
    var st = fs.statSync(file);
    if ((st.mode & 0o077) !== 0) return { present: false, reason: 'token file must be 0600' };
    var v = fs.readFileSync(file, 'utf8').trim();
    if (v.length < 16) return { present: false, reason: 'token too short' };
    return { present: true, value: v };
  } catch (e) { return { present: false, reason: 'token file unreadable' }; }
}
function timingSafeEqualStr(a, b) {
  var ab = Buffer.from(String(a), 'utf8'), bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
function authorize(req, query, expected) {
  var presented = typeof query.token === 'string' && query.token ? query.token : req.headers[TOKEN_HEADER];
  if (typeof presented !== 'string' || !presented) return 'WEBHOOK_TOKEN_MISSING';
  return timingSafeEqualStr(presented, expected) ? null : 'WEBHOOK_TOKEN_MISMATCH';
}
function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0;
    var over = false;
    req.on('data', function (c) { if (over) return; size += c.length; if (size > limit) { over = true; chunks = []; reject(new Error('BODY_TOO_LARGE')); return; } chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}
function send(res, code, obj) {
  var s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s), 'Cache-Control': 'no-store', 'Connection': code === 413 ? 'close' : 'keep-alive' });
  res.end(s);
}
// describe() → non-secret status for the panel / verify scripts
function describe() {
  var c = config(); var t = readToken(c.tokenFile);
  return { enabled: c.enabled, token_present: t.present, token_problem: t.present ? null : t.reason, max_body_bytes: c.maxBody, providers: Object.keys(PROVIDERS), route: '/hooks/evolution' };
}
// handle(req, res, deps) — deps: { pool, log, requestId }
function handle(req, res, deps) {
  var c = config();
  var u = url.parse(req.url, true);
  var log = deps.log || function () {};
  if (!c.enabled) return send(res, 404, { ok: false, error: 'not_found', detail: 'not found' });
  var m = /^\/hooks\/([a-z_]+)$/.exec(u.pathname || '');
  var provider = m && PROVIDERS[m[1]] ? PROVIDERS[m[1]] : null;
  if (!provider) return send(res, 404, { ok: false, error: 'not_found', detail: 'not found' });
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  var token = readToken(c.tokenFile);
  if (!token.present) { log({ level: 'error', receiver: 'token', reason: token.reason }); return send(res, 503, { ok: false, error: 'receiver_not_configured' }); }
  var authErr = authorize(req, u.query, token.value);
  if (authErr) { log({ level: 'warn', receiver: 'unauthorized', reason: authErr, request_id: deps.requestId }); return send(res, 401, { ok: false, error: 'unauthorized', reason: authErr }); }
  return readBody(req, c.maxBody).then(function (raw) {
    var body;
    try { body = JSON.parse(raw); } catch (e) { return send(res, 400, { ok: false, error: 'bad_request', reason: 'BODY_NOT_JSON' }); }
    var sha = provider.payloadHash(raw);
    var parsed = provider.parseInbound(body);
    var instance = parsed.instance || (parsed.event && parsed.event.instance) || null;
    var eventName = typeof body.event === 'string' ? body.event : 'unknown';
    var pmid = body && body.data && body.data.key && typeof body.data.key.id === 'string' ? body.data.key.id.slice(0, 128) : null;
    var pool = deps.pool;
    if (!parsed.ok) {
      var ignorable = /^(EVENT_IGNORED|OWN_MESSAGE|GROUP_IGNORED|STATUS_IGNORED|SELF_CHAT_IGNORED)/.test(parsed.reason);
      return core.recordInbound(pool, { instance: instance, event: eventName, provider_message_id: pmid, status: ignorable ? 'ignored' : 'rejected', reason: parsed.reason, payload_sha256: sha, payload: ignorable ? null : provider.redactDeep(body) })
        .then(function () { log({ level: ignorable ? 'info' : 'warn', receiver: ignorable ? 'ignored' : 'rejected', reason: parsed.reason, instance: instance, event: eventName, request_id: deps.requestId }); return send(res, 200, { ok: true, accepted: false, reason: parsed.reason }); });
    }
    return core.findInbox(pool, provider.ID, parsed.event.instance).then(function (inbox) {
      if (!inbox) {
        return core.recordInbound(pool, { instance: instance, event: eventName, provider_message_id: pmid, status: 'rejected', reason: 'INBOX_UNKNOWN', payload_sha256: sha, payload: provider.redactDeep(body) })
          .then(function () { log({ level: 'warn', receiver: 'rejected', reason: 'INBOX_UNKNOWN', instance: instance, request_id: deps.requestId }); return send(res, 202, { ok: true, accepted: false, reason: 'INBOX_UNKNOWN' }); });
      }
      if (parsed.kind === 'connection') {
        return core.setInboxState(pool, inbox.id, parsed.event.status, null)
          .then(function () { return core.recordInbound(pool, { instance: instance, inbox_id: inbox.id, event: eventName, status: 'persisted', reason: 'CONNECTION:' + parsed.event.status, payload_sha256: sha }); })
          .then(function () { bus.publish({ type: 'inbox.status', project_id: inbox.project_id, inbox_id: inbox.id, status: parsed.event.status }); log({ level: 'info', receiver: 'connection', instance: instance, status: parsed.event.status, request_id: deps.requestId }); return send(res, 200, { ok: true, accepted: true, kind: 'connection', status: parsed.event.status }); });
      }
      if (!inbox.inbound_enabled) {
        return core.recordInbound(pool, { instance: instance, inbox_id: inbox.id, event: eventName, provider_message_id: pmid, status: 'dry_run', reason: 'INBOX_INBOUND_DISABLED', payload_sha256: sha })
          .then(function () { log({ level: 'info', receiver: 'dry_run', instance: instance, message_type: parsed.event.message_type, request_id: deps.requestId }); return send(res, 200, { ok: true, accepted: true, mode: 'dry_run', persisted: false }); });
      }
      return core.ingest(pool, inbox, parsed.event).then(function (r) {
        return core.recordInbound(pool, { instance: instance, inbox_id: inbox.id, event: eventName, provider_message_id: pmid, status: r.duplicate ? 'duplicate' : 'persisted', reason: r.duplicate ? 'DUPLICATE' : null, message_id: r.message_id || null, payload_sha256: sha })
          .then(function () {
            log({ level: 'info', receiver: r.duplicate ? 'duplicate' : 'persisted', instance: instance, message_type: parsed.event.message_type, message_id: r.message_id || null, conversation_id: r.conversation_id, opened: r.opened, request_id: deps.requestId });
            return send(res, 200, { ok: true, accepted: true, persisted: r.persisted, duplicate: r.duplicate, message_id: r.message_id || null, conversation_id: r.conversation_id });
          });
      }, function (e) {
        return core.recordInbound(pool, { instance: instance, inbox_id: inbox.id, event: eventName, provider_message_id: pmid, status: 'failed', reason: 'INGEST:' + String(e && e.code || e && e.message || 'error').slice(0, 60), payload_sha256: sha, payload: provider.redactDeep(body) })
          .then(function () { log({ level: 'error', receiver: 'failed', instance: instance, reason: String(e && e.message || e).slice(0, 120), request_id: deps.requestId }); return send(res, 500, { ok: false, error: 'ingest_failed' }); });
      });
    });
  }).catch(function (e) {
    var reason = e && e.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'RECEIVER_ERROR';
    log({ level: 'warn', receiver: 'error', reason: reason, request_id: deps.requestId });
    if (!res.headersSent) { if (reason === 'BODY_TOO_LARGE') res.once('finish', function () { try { req.socket.destroy(); } catch (x) {} }); send(res, reason === 'BODY_TOO_LARGE' ? 413 : 500, { ok: false, error: reason.toLowerCase() }); }
  });
}
module.exports = { handle: handle, describe: describe, config: config, readToken: readToken, TOKEN_HEADER: TOKEN_HEADER };
