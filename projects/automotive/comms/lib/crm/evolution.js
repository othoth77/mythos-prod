'use strict';
// =====================================================
// MYTHOS AUTO customer communication — Evolution gateway channel adapter
// projects/automotive/comms/lib/crm/evolution.js
//
// The lightweight path of Issue #173: no CRM in front of MYTHOS. The ONE
// private Evolution gateway that already exists on this host (#170,
// 127.0.0.1:8080) carries customer conversations on its own, on a
// SEPARATE instance (one WhatsApp number = one instance = one inbox).
// This is not a second gateway and it is not the notification adapter:
//
//   - the operational notification layer (bridge/notify/providers/
//     evolution.js) keeps its own instance, credential file and ledger and
//     is not imported here — the two never share a message path;
//   - the customer instance is configured per project (`crm.inbox_ids`),
//     and a configuration may reserve the notification instance so it can
//     never be claimed by a project (`crm.reserved_inbox_ids`).
//
// The adapter contract is the one of lib/crm/index.js, so the router, the
// business handler, the policy and the ledger do not know which transport
// carried the message. Mapping onto the envelope's CRM references:
//
//   account_id       "gateway"            (there is exactly one gateway)
//   inbox_id         the Evolution instance name
//   conversation_id  the customer's digits-only MSISDN (a WhatsApp 1:1 chat
//                    IS the customer number; groups are refused)
//   message_id       the WhatsApp message key id
//
// Verified against Evolution API v2.3.7 (the deployed version):
//   inbound   webhook event `messages.upsert` (also delivered as
//             MESSAGES_UPSERT when webhookByEvents is on):
//             { event, instance, data: { key: { remoteJid, fromMe, id },
//               pushName, message: {...}, messageType, messageTimestamp },
//               sender, server_url, apikey }
//             The body carries the instance API KEY (`apikey`). It is never
//             copied, never logged, never part of any result of this file.
//   outbound  POST {baseUrl}/message/sendText/{instance}
//             header apikey, body { number, text }
//
// Webhook authentication: Evolution signs nothing. The receiver is bound to
// loopback (private-host fence) AND the webhook URL carries a shared token
// (`?token=`) compared in constant time, exactly like the Chatwoot adapter.
// =====================================================

var crypto = require('crypto');

var envelope = require('../envelope');
var httpJson = require('../../../../mythos-ai-executor/bridge/notify/http-json');
var fence = require('../../../../mythos-ai-executor/bridge/notify/whatsapp');

var ID = 'evolution';
var ACCOUNT_ID = 'gateway';
var TOKEN_QUERY_KEY = 'token';
var TOKEN_HEADER = 'x-mythos-webhook-token';
var INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
var MSG_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
var MSISDN_RE = /^[0-9]{6,20}$/;
var MAX_REPLY = 4096;
var INBOUND_EVENTS = { 'messages.upsert': true, 'MESSAGES_UPSERT': true };

function describe() {
  return {
    id: ID,
    inbound: 'Evolution webhook `messages.upsert` (customer 1:1 text only; fromMe, groups, status and self-chat refused before parsing); shared token in the URL query or ' + TOKEN_HEADER + ' header + loopback fence',
    outbound: 'POST {baseUrl}/message/sendText/{instance} with the instance apikey; text only',
    providers_behind: ['evolution (unofficial: WhatsApp Web session; per-project acknowledgement required)'],
    not_implemented: ['media replies', 'read receipts', 'typing state', 'group chats', 'instance lifecycle', 'QR / pairing'],
    notes: 'same private gateway as the operational notifications, on a separate instance; the notification adapter and ledger are not used'
  };
}

function timingSafeEqualStr(a, b) {
  var ab = Buffer.from(String(a), 'utf8');
  var bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// o = { query: {token}, headers: {}, expectedToken }
function authorizeWebhook(o) {
  o = o || {};
  var expected = o.expectedToken;
  if (typeof expected !== 'string' || expected.length < 16) return { ok: false, reason: 'WEBHOOK_TOKEN_NOT_CONFIGURED' };
  var q = o.query || {};
  var h = o.headers || {};
  var presented = typeof q[TOKEN_QUERY_KEY] === 'string' && q[TOKEN_QUERY_KEY] ? q[TOKEN_QUERY_KEY] : h[TOKEN_HEADER];
  if (typeof presented !== 'string' || !presented) return { ok: false, reason: 'WEBHOOK_TOKEN_MISSING' };
  if (!timingSafeEqualStr(presented, expected)) return { ok: false, reason: 'WEBHOOK_TOKEN_MISMATCH' };
  return { ok: true, reason: null };
}

// WhatsApp wraps disappearing / view-once messages one level deeper.
function unwrap(message) {
  if (!message || typeof message !== 'object') return {};
  var wrappers = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage'];
  for (var i = 0; i < wrappers.length; i++) {
    var w = message[wrappers[i]];
    if (w && typeof w === 'object' && w.message && typeof w.message === 'object') return unwrap(w.message);
  }
  return message;
}

// Reduces the WhatsApp message union to (content_type, text, attachments).
function content(message) {
  var m = unwrap(message);
  if (typeof m.conversation === 'string') return { content_type: 'text', text: m.conversation, attachments: 0 };
  if (m.extendedTextMessage && typeof m.extendedTextMessage.text === 'string') return { content_type: 'text', text: m.extendedTextMessage.text, attachments: 0 };
  var media = ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage'];
  for (var i = 0; i < media.length; i++) {
    var med = m[media[i]];
    if (med && typeof med === 'object') {
      var caption = typeof med.caption === 'string' ? med.caption : '';
      return { content_type: 'attachment', text: caption, attachments: 1 };
    }
  }
  if (m.locationMessage || m.liveLocationMessage) return { content_type: 'location', text: '', attachments: 0 };
  if (m.contactMessage || m.contactsArrayMessage) return { content_type: 'contact', text: '', attachments: 0 };
  return { content_type: 'other', text: '', attachments: 0 };
}

function jidDigits(jid) {
  if (typeof jid !== 'string') return null;
  var at = jid.indexOf('@');
  if (at === -1) return null;
  var digits = jid.slice(0, at).split(':')[0];
  return MSISDN_RE.test(digits) ? digits : null;
}

// Resolves the customer's phone number from the message key. WhatsApp's
// newer LID addressing hides the number behind `xxx@lid`; Evolution then
// carries the phone JID in `senderPn` / `remoteJidAlt`. Without a phone
// number there is nobody to reply to, so the message is refused.
function customerNumber(key) {
  var jid = key.remoteJid;
  if (typeof jid !== 'string') return { error: 'REMOTE_JID_MISSING' };
  if (/@g\.us$/.test(jid)) return { error: 'GROUP_IGNORED' };
  if (/^status@broadcast$/.test(jid) || /@broadcast$/.test(jid)) return { error: 'STATUS_IGNORED' };
  if (/@s\.whatsapp\.net$/.test(jid)) {
    var d = jidDigits(jid);
    return d ? { msisdn: d } : { error: 'REMOTE_JID_INVALID' };
  }
  if (/@lid$/.test(jid)) {
    var alt = jidDigits(key.senderPn) || jidDigits(key.remoteJidAlt);
    return alt ? { msisdn: alt } : { error: 'SENDER_UNRESOLVED' };
  }
  return { error: 'REMOTE_JID_UNSUPPORTED' };
}

// Turns one Evolution webhook delivery into { accepted, reason, envelope }.
// Everything that is not a customer's own 1:1 message is refused by NAME
// before any content is read. The body's `apikey` field is never read.
function parseWebhook(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { accepted: false, reason: 'BODY_NOT_OBJECT', envelope: null };
  if (!INBOUND_EVENTS[body.event]) return { accepted: false, reason: 'EVENT_IGNORED:' + String(body.event || 'none').slice(0, 40), envelope: null };
  if (!INSTANCE_RE.test(String(body.instance || ''))) return { accepted: false, reason: 'INSTANCE_INVALID', envelope: null };
  var data = body.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { accepted: false, reason: 'DATA_NOT_OBJECT', envelope: null };
  var key = data.key;
  if (!key || typeof key !== 'object') return { accepted: false, reason: 'KEY_MISSING', envelope: null };
  // Our own outbound messages come back through the same webhook. Dropping
  // them here is the first of the loop guards (engine + ledger add more).
  if (key.fromMe === true) return { accepted: false, reason: 'OWN_MESSAGE', envelope: null };
  if (!MSG_ID_RE.test(String(key.id || ''))) return { accepted: false, reason: 'MESSAGE_ID', envelope: null };
  var who = customerNumber(key);
  if (who.error) return { accepted: false, reason: who.error, envelope: null };
  // A message in the chat with the instance's own number is not a customer.
  var self = jidDigits(body.sender);
  if (self && self === who.msisdn) return { accepted: false, reason: 'SELF_CHAT_IGNORED', envelope: null };

  var c = content(data.message);
  var ts = Number(data.messageTimestamp);
  var receivedAt = ts > 0 ? new Date((ts < 1e12 ? ts * 1000 : ts)).toISOString() : null;
  var env = envelope.inbound({
    provider: ID,
    crm: {
      adapter: ID,
      account_id: ACCOUNT_ID,
      inbox_id: body.instance,
      conversation_id: who.msisdn,
      message_id: key.id,
      contact_id: who.msisdn,
      channel_type: 'Evolution::Instance'
    },
    customer: {
      msisdn: who.msisdn,
      name: typeof data.pushName === 'string' ? data.pushName : null,
      locale_hint: null
    },
    message: {
      content_type: c.content_type,
      text: c.text,
      attachments: c.attachments,
      external_id: key.id,
      received_at: receivedAt
    }
  });
  return { accepted: true, reason: null, envelope: env };
}

// The transport IS Evolution here, so a project on this adapter must
// declare it — a project configured as "official" on an Evolution instance
// would hide the unofficial transport, which the envelope rules forbid.
function providerConsistency(channelType, provider) {
  if (channelType && channelType !== 'Evolution::Instance') return 'CHANNEL_TYPE_UNSUPPORTED';
  return provider === ID ? null : 'PROVIDER_NOT_EVOLUTION';
}

// o = { baseUrl, allowPublic, accountId, inboxId, conversationId, apiToken, text, timeoutMs }
function sendReply(o) {
  o = o || {};
  var fail = function (error) { return Promise.resolve({ ok: false, status: null, crm_message_id: null, error: error }); };
  if (!o.baseUrl) return fail('CONFIG: base url missing');
  var host;
  try { host = new URL(String(o.baseUrl)).hostname; } catch (e) { return fail('CONFIG: base url invalid'); }
  if (!fence.isPrivateHost(host) && o.allowPublic !== true) return fail('CONFIG: gateway host is not private');
  if (String(o.accountId) !== ACCOUNT_ID) return fail('CONFIG: account id is not the gateway');
  if (!INSTANCE_RE.test(String(o.inboxId || ''))) return fail('CONFIG: instance name is not acceptable');
  if (!MSISDN_RE.test(String(o.conversationId || ''))) return fail('CONFIG: recipient is not a digits-only MSISDN');
  if (!o.apiToken) return fail('CONFIG: credential missing');
  if (typeof o.text !== 'string' || !o.text.trim()) return fail('CONFIG: empty reply');
  if (o.text.length > MAX_REPLY) return fail('CONFIG: reply exceeds ' + MAX_REPLY + ' characters');

  var target = String(o.baseUrl).replace(/\/+$/, '') + '/message/sendText/' + encodeURIComponent(String(o.inboxId));
  var body = { number: String(o.conversationId), text: o.text };
  return httpJson.postJson(target, body, {
    // The key lives only in this object for the lifetime of the request;
    // http-json never logs or returns headers.
    headers: { apikey: o.apiToken },
    timeoutMs: o.timeoutMs || 15000
  }).then(function (res) {
    var id = null;
    if (res.ok) {
      try {
        var parsed = JSON.parse(res.body);
        if (parsed && parsed.key && typeof parsed.key.id === 'string') id = parsed.key.id.slice(0, 120);
        else if (parsed && typeof parsed.id === 'string') id = parsed.id.slice(0, 120);
      } catch (e) { /* not JSON */ }
    }
    return { ok: res.ok, status: res.statusCode, crm_message_id: id, error: res.ok ? null : ('HTTP ' + res.statusCode + ': ' + String(res.body || '').slice(0, 300)) };
  }, function (err) {
    return { ok: false, status: null, crm_message_id: null, error: 'TRANSPORT: ' + String(err.message).slice(0, 300) };
  });
}

module.exports = {
  id: ID,
  ACCOUNT_ID: ACCOUNT_ID,
  TOKEN_QUERY_KEY: TOKEN_QUERY_KEY,
  TOKEN_HEADER: TOKEN_HEADER,
  describe: describe,
  authorizeWebhook: authorizeWebhook,
  parseWebhook: parseWebhook,
  providerConsistency: providerConsistency,
  sendReply: sendReply
};
