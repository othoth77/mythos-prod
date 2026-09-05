'use strict';
// =====================================================
// MYTHOS WP — Communication provider: Evolution API (inbound normalisation)
// projects/mythos-wp/reference/comms/providers/evolution.js
//
// Turns one Evolution webhook body (v2.3.7, `messages.upsert` /
// `connection.update`) into the provider-neutral event the Communication
// Core persists. Rules:
//   - everything that is not a customer's own 1:1 message is refused BY NAME
//     before any content is read (own messages, groups, status broadcasts,
//     self chat, unresolved LID);
//   - `raw` is the provider `data` object with credentials and media keys
//     removed (apikey, token, mediaKey, fileEncSha256, url, directPath,
//     thumbnails, base64) — the message stays replayable for audit, never
//     decryptable from the database;
//   - media BYTES are never read here; attachments carry metadata only.
// The reply/decision rules of projects/automotive/comms (#173) are untouched:
// its `lib/crm/evolution.js` keeps parsing for the auto-reply engine.
// =====================================================
var crypto = require('crypto');
var http = require('http');
var https = require('https');
var fs = require('fs');
var ID = 'evolution';
var INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
var MSG_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
var MSISDN_RE = /^[0-9]{6,20}$/;
var LID_RE = /^[0-9]{6,32}$/;
var MAX_TEXT = 8000;
var MESSAGE_EVENTS = { 'messages.upsert': true, 'MESSAGES_UPSERT': true };
var CONNECTION_EVENTS = { 'connection.update': true, 'CONNECTION_UPDATE': true };
var STATUS_EVENTS = { 'messages.update': true, 'MESSAGES_UPDATE': true };
var STATUS_MAP = { SERVER_ACK: 'sent', DELIVERY_ACK: 'delivered', READ: 'read', PLAYED: 'read', ERROR: 'failed', PENDING: 'queued' };
var STRIP_KEYS = /^(apikey|api_key|token|authorization|mediakey|mediaKey|fileEncSha256|url|directPath|jpegThumbnail|thumbnail|thumbnailDirectPath|thumbnailSha256|thumbnailEncSha256|base64|streamingSidecar|waveform)$/i;
var WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage'];
var MEDIA = { imageMessage: 'image', audioMessage: 'audio', videoMessage: 'video', documentMessage: 'document', stickerMessage: 'sticker' };

function redactDeep(v, depth) {
  depth = depth || 0;
  if (depth > 12) return null;
  if (Array.isArray(v)) return v.slice(0, 50).map(function (x) { return redactDeep(x, depth + 1); });
  if (v && typeof v === 'object') {
    var out = {};
    Object.keys(v).forEach(function (k) {
      if (STRIP_KEYS.test(k)) return;
      out[k] = redactDeep(v[k], depth + 1);
    });
    return out;
  }
  if (typeof v === 'string' && v.length > 4096) return v.slice(0, 4096) + '…';
  return v;
}
function unwrap(message, depth) {
  if (!message || typeof message !== 'object' || (depth || 0) > 6) return {};
  for (var i = 0; i < WRAPPERS.length; i++) {
    var w = message[WRAPPERS[i]];
    if (w && typeof w === 'object' && w.message && typeof w.message === 'object') return unwrap(w.message, (depth || 0) + 1);
  }
  return message;
}
function b64hex(s) {
  if (typeof s !== 'string' || !s) return null;
  try { var h = Buffer.from(s, 'base64').toString('hex'); return h.length === 64 ? h : null; } catch (e) { return null; }
}
// (message_type, text, attachments[]) from the WhatsApp message union
function content(message) {
  var m = unwrap(message);
  if (typeof m.conversation === 'string') return { message_type: 'text', text: m.conversation, attachments: [] };
  if (m.extendedTextMessage && typeof m.extendedTextMessage.text === 'string') return { message_type: 'text', text: m.extendedTextMessage.text, attachments: [] };
  var keys = Object.keys(MEDIA);
  for (var i = 0; i < keys.length; i++) {
    var med = m[keys[i]];
    if (med && typeof med === 'object') {
      return {
        message_type: MEDIA[keys[i]], text: typeof med.caption === 'string' ? med.caption : '',
        attachments: [{ kind: MEDIA[keys[i]], mime_type: typeof med.mimetype === 'string' ? med.mimetype.slice(0, 120) : null, size_bytes: Number(med.fileLength) > 0 ? Number(med.fileLength) : null, file_name: typeof med.fileName === 'string' ? med.fileName.slice(0, 255) : null, sha256: b64hex(med.fileSha256) }]
      };
    }
  }
  if (m.locationMessage || m.liveLocationMessage) return { message_type: 'location', text: '', attachments: [] };
  if (m.contactMessage || m.contactsArrayMessage) return { message_type: 'contact', text: '', attachments: [] };
  if (m.reactionMessage) return { message_type: 'reaction', text: typeof m.reactionMessage.text === 'string' ? m.reactionMessage.text : '', attachments: [] };
  return { message_type: 'other', text: '', attachments: [] };
}
function jidDigits(jid, re) {
  if (typeof jid !== 'string') return null;
  var at = jid.indexOf('@');
  if (at === -1) return null;
  var d = jid.slice(0, at).split(':')[0];
  return (re || MSISDN_RE).test(d) ? d : null;
}
function customer(key) {
  var jid = key.remoteJid;
  if (typeof jid !== 'string') return { error: 'REMOTE_JID_MISSING' };
  if (/@g\.us$/.test(jid)) return { error: 'GROUP_IGNORED' };
  if (/@broadcast$/.test(jid)) return { error: 'STATUS_IGNORED' };
  if (/@s\.whatsapp.net$/.test(jid)) { var d = jidDigits(jid); return d ? { wa_id: d, lid: jidDigits(key.senderLid || key.remoteJidAlt, LID_RE) && /@lid$/.test(String(key.senderLid || key.remoteJidAlt || '')) ? jidDigits(key.senderLid || key.remoteJidAlt, LID_RE) : null } : { error: 'REMOTE_JID_INVALID' }; }
  if (/@lid$/.test(jid)) {
    var alt = jidDigits(key.senderPn) || jidDigits(key.remoteJidAlt);
    var lid = jidDigits(jid, LID_RE);
    return alt ? { wa_id: alt, lid: lid } : { error: 'SENDER_UNRESOLVED' };
  }
  return { error: 'REMOTE_JID_UNSUPPORTED' };
}
function quotedId(message) {
  var m = unwrap(message);
  var ctx = m.extendedTextMessage && m.extendedTextMessage.contextInfo;
  if (!ctx) { var ks = Object.keys(m); for (var i = 0; i < ks.length; i++) { if (m[ks[i]] && m[ks[i]].contextInfo) { ctx = m[ks[i]].contextInfo; break; } } }
  return ctx && MSG_ID_RE.test(String(ctx.stanzaId || '')) ? String(ctx.stanzaId) : null;
}
// parseInbound(body) → { ok, reason, kind: 'message'|'connection', event }
function parseInbound(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, reason: 'BODY_NOT_OBJECT' };
  var instance = String(body.instance || '');
  if (!INSTANCE_RE.test(instance)) return { ok: false, reason: 'INSTANCE_INVALID' };
  var data = body.data;
  if (CONNECTION_EVENTS[body.event]) {
    var state = data && typeof data === 'object' ? String(data.state || data.status || '') : '';
    var map = { open: 'open', close: 'closed', connecting: 'pairing' };
    if (!map[state]) return { ok: false, reason: 'CONNECTION_STATE_UNKNOWN', instance: instance };
    return { ok: true, kind: 'connection', event: { provider: ID, instance: instance, status: map[state], provider_state: state } };
  }
  if (STATUS_EVENTS[body.event]) {
    var d = data && typeof data === 'object' ? data : {};
    var mid = (d.key && typeof d.key.id === 'string' && d.key.id) || (typeof d.keyId === 'string' && d.keyId) || (typeof d.messageId === 'string' && d.messageId) || null;
    var st = STATUS_MAP[String(d.status || '').toUpperCase()] || null;
    if (!mid || !MSG_ID_RE.test(mid)) return { ok: false, reason: 'STATUS_MESSAGE_ID', instance: instance };
    if (!st) return { ok: false, reason: 'STATUS_UNKNOWN:' + String(d.status || '').slice(0, 20), instance: instance };
    return { ok: true, kind: 'status', event: { provider: ID, instance: instance, provider_message_id: mid, status: st, from_me: d.fromMe === true || (d.key && d.key.fromMe === true) } };
  }
  if (!MESSAGE_EVENTS[body.event]) return { ok: false, reason: 'EVENT_IGNORED:' + String(body.event || 'none').slice(0, 40), instance: instance };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'DATA_NOT_OBJECT', instance: instance };
  var key = data.key;
  if (!key || typeof key !== 'object') return { ok: false, reason: 'KEY_MISSING', instance: instance };
  if (key.fromMe === true) return { ok: false, reason: 'OWN_MESSAGE', instance: instance };
  if (!MSG_ID_RE.test(String(key.id || ''))) return { ok: false, reason: 'MESSAGE_ID', instance: instance };
  var who = customer(key);
  if (who.error) return { ok: false, reason: who.error, instance: instance };
  var self = jidDigits(body.sender);
  if (self && self === who.wa_id) return { ok: false, reason: 'SELF_CHAT_IGNORED', instance: instance };
  var c = content(data.message);
  var ts = Number(data.messageTimestamp);
  var at = ts > 0 ? new Date(ts < 1e12 ? ts * 1000 : ts) : null;
  return {
    ok: true, kind: 'message',
    event: {
      provider: ID, instance: instance,
      provider_message_id: String(key.id),
      contact: { wa_id: who.wa_id, lid: who.lid || null, display_name: typeof data.pushName === 'string' ? data.pushName.slice(0, 120) : null },
      chat_id: who.wa_id,
      message_type: c.message_type,
      text: typeof c.text === 'string' ? c.text.slice(0, MAX_TEXT) : '',
      quoted_provider_message_id: quotedId(data.message),
      provider_timestamp: at && !isNaN(at.getTime()) ? at.toISOString() : null,
      attachments: c.attachments,
      raw: redactDeep(data)
    }
  };
}
// ---- outbound ----------------------------------------------------------
// sendText({ baseUrl, instance, apiKey, to, text, timeoutMs }) → { ok, status, provider_message_id, error }
// Never throws on HTTP errors; never puts the key in the error text.
function sendText(o) {
  o = o || {};
  if (!o.baseUrl || !INSTANCE_RE.test(String(o.instance || ''))) return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: base url / instance' });
  if (!MSISDN_RE.test(String(o.to || ''))) return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: recipient' });
  if (!o.apiKey) return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: credential missing' });
  if (typeof o.text !== 'string' || !o.text.trim() || o.text.length > 4096) return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: text' });
  var u = new URL(String(o.baseUrl).replace(/\/+$/, '') + '/message/sendText/' + encodeURIComponent(o.instance));
  var payload = JSON.stringify({ number: o.to, text: o.text });
  var mod = u.protocol === 'https:' ? https : http;
  return new Promise(function (resolve) {
    var done = false; var finish = function (r) { if (!done) { done = true; resolve(r); } };
    var req = mod.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), apikey: o.apiKey }, timeout: o.timeoutMs || 15000 }, function (res) {
      var b = ''; res.on('data', function (c) { if (b.length < 65536) b += c; });
      res.on('end', function () {
        var parsed = null; try { parsed = JSON.parse(b); } catch (e) {}
        var ok = res.statusCode >= 200 && res.statusCode < 300;
        var id = parsed && parsed.key && typeof parsed.key.id === 'string' ? parsed.key.id.slice(0, 128) : null;
        finish({ ok: ok, status: res.statusCode, provider_message_id: id, error: ok ? null : ('HTTP ' + res.statusCode + ': ' + String(b || '').replace(/[A-Za-z0-9._-]{20,}/g, '…').slice(0, 200)) });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function (e) { finish({ ok: false, status: null, provider_message_id: null, error: 'TRANSPORT: ' + String(e && e.message || e).slice(0, 120) }); });
    req.end(payload);
  });
}
function readApiKey() {
  var f = process.env.MYTHOS_WP_EVOLUTION_API_KEY_FILE;
  if (!f) return { present: false, reason: 'MYTHOS_WP_EVOLUTION_API_KEY_FILE not set' };
  try { var st = fs.statSync(f); if ((st.mode & 0o077) !== 0) return { present: false, reason: 'key file must be 0600' }; var v = fs.readFileSync(f, 'utf8').trim(); return v.length >= 8 ? { present: true, value: v } : { present: false, reason: 'key too short' }; } catch (e) { return { present: false, reason: 'key file unreadable' }; }
}
function baseUrl() { return String(process.env.MYTHOS_WP_EVOLUTION_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, ''); }
function payloadHash(rawBody) { return crypto.createHash('sha256').update(String(rawBody)).digest('hex'); }
module.exports = { ID: ID, parseInbound: parseInbound, sendText: sendText, readApiKey: readApiKey, baseUrl: baseUrl, redactDeep: redactDeep, payloadHash: payloadHash, content: content, STRIP_KEYS: STRIP_KEYS };
