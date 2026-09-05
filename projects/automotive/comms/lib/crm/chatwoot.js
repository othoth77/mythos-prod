'use strict';
// =====================================================
// MYTHOS AUTO customer communication — Chatwoot adapter
// projects/automotive/comms/lib/crm/chatwoot.js
//
// Chatwoot (MIT core, chatwoot/chatwoot) is the inbox/CRM component in
// front of MYTHOS: it owns the WhatsApp connection (native WhatsApp Cloud
// API channel, or an API-channel inbox fed by Evolution / WAHA), the
// agents, the assignment, the contact and the history. MYTHOS sees it
// through two narrow surfaces, both verified against the Chatwoot source
// on 2026-09-05 (`app/models/message.rb#webhook_data`,
// `app/presenters/conversations/event_data_presenter.rb#webhook_data`,
// `app/models/channel/whatsapp.rb` PROVIDERS = default | whatsapp_cloud):
//
//   inbound   the account webhook, event `message_created`, kept only when
//             message_type = incoming and private = false — i.e. a customer
//             wrote something. Outgoing, template, activity and private
//             notes are dropped BEFORE any parsing of content.
//
//   outbound  POST /api/v1/accounts/{account}/conversations/{conv}/messages
//             header `api_access_token`, body { content, message_type:
//             "outgoing", private: false }. The reply is posted INTO the
//             conversation, so the CRM — not MYTHOS — delivers it over
//             whatever WhatsApp provider that inbox is connected to. That is
//             the provider boundary: MYTHOS never addresses WhatsApp.
//
// Chatwoot webhooks carry no signature. Authentication is therefore (1) the
// private-network fence (Chatwoot and MYTHOS on the same host / network)
// and (2) a per-webhook shared token in the URL query, compared in constant
// time against a 0600 file — the only mechanism Chatwoot's webhook
// configuration can carry.
// =====================================================

var crypto = require('crypto');

var envelope = require('../envelope');
var httpJson = require('../../../../mythos-ai-executor/bridge/notify/http-json');
var fence = require('../../../../mythos-ai-executor/bridge/notify/whatsapp');

var ID = 'chatwoot';
var TOKEN_QUERY_KEY = 'token';
var ID_RE = /^[0-9]{1,18}$/;
var MAX_REPLY = 4096;

// Chatwoot channel type → the provider CLASS the conversation runs on.
// `Channel::Whatsapp` is Chatwoot's own WhatsApp Business Platform channel
// (Cloud API or 360dialog); `Channel::Api` is an API inbox that an external
// gateway (Evolution's built-in Chatwoot integration, WAHA's) feeds. The
// exact provider comes from the project configuration; this is only the
// consistency check that refuses "official" configured on an API inbox.
var CHANNEL_CLASS = {
  'Channel::Whatsapp': 'official',
  'Channel::Api': null            // unknown here: decided by configuration
};

function describe() {
  return {
    id: ID,
    inbound: 'account webhook `message_created` (incoming, non-private only); shared token in the URL query + private-network fence',
    outbound: 'POST /api/v1/accounts/{account}/conversations/{conversation}/messages with api_access_token; text only',
    providers_behind: ['meta-cloud-api (Channel::Whatsapp, provider whatsapp_cloud)', '360dialog (Channel::Whatsapp, provider default)', 'evolution / waha (Channel::Api inbox fed by the gateway)'],
    not_implemented: ['media replies', 'templates', 'contact/label mutation', 'conversation status changes', 'agent-bot handover API'],
    notes: 'the CRM delivers over WhatsApp; MYTHOS never addresses a WhatsApp provider for customer messages'
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
  var presented = q[TOKEN_QUERY_KEY];
  if (typeof presented !== 'string' || !presented) return { ok: false, reason: 'WEBHOOK_TOKEN_MISSING' };
  if (!timingSafeEqualStr(presented, expected)) return { ok: false, reason: 'WEBHOOK_TOKEN_MISMATCH' };
  return { ok: true, reason: null };
}

function contentType(body) {
  var atts = Array.isArray(body.attachments) ? body.attachments.length : 0;
  var text = typeof body.content === 'string' ? body.content : '';
  if (atts && !text.trim()) return 'attachment';
  if (body.content_type && body.content_type !== 'text' && body.content_type !== 'input_select') {
    if (body.content_type === 'location') return 'location';
    if (body.content_type === 'contact') return 'contact';
    return atts ? 'attachment' : 'other';
  }
  return 'text';
}

// Turns one Chatwoot webhook delivery into { accepted, reason, envelope }.
// Everything that is not an incoming customer message is refused by NAME
// before any content is read; nothing about the body is logged.
function parseWebhook(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { accepted: false, reason: 'BODY_NOT_OBJECT', envelope: null };
  if (body.event !== 'message_created') return { accepted: false, reason: 'EVENT_IGNORED:' + String(body.event || 'none').slice(0, 40), envelope: null };
  if (body.message_type !== 'incoming') return { accepted: false, reason: 'NOT_INCOMING', envelope: null };
  if (body.private === true) return { accepted: false, reason: 'PRIVATE_NOTE', envelope: null };
  var sender = body.sender || {};
  if (sender.type && sender.type !== 'contact') return { accepted: false, reason: 'SENDER_NOT_CONTACT', envelope: null };
  var conv = body.conversation || {};
  var account = body.account || {};
  var inbox = body.inbox || {};
  if (!ID_RE.test(String(body.id))) return { accepted: false, reason: 'MESSAGE_ID', envelope: null };
  if (!ID_RE.test(String(account.id))) return { accepted: false, reason: 'ACCOUNT_ID', envelope: null };
  var inboxId = inbox.id !== undefined ? inbox.id : conv.inbox_id;
  if (!ID_RE.test(String(inboxId))) return { accepted: false, reason: 'INBOX_ID', envelope: null };
  if (!ID_RE.test(String(conv.id))) return { accepted: false, reason: 'CONVERSATION_ID', envelope: null };

  var contactInbox = conv.contact_inbox || {};
  var env = envelope.inbound({
    provider: 'unknown',                 // configuration decides; see router
    crm: {
      adapter: ID,
      account_id: account.id,
      inbox_id: inboxId,
      conversation_id: conv.id,
      message_id: body.id,
      contact_id: sender.id,
      channel_type: typeof conv.channel === 'string' ? conv.channel.slice(0, 40) : null
    },
    customer: {
      msisdn: sender.phone_number || contactInbox.source_id || null,
      name: typeof sender.name === 'string' ? sender.name : null,
      locale_hint: null
    },
    message: {
      content_type: contentType(body),
      text: typeof body.content === 'string' ? body.content : '',
      attachments: Array.isArray(body.attachments) ? body.attachments.length : 0,
      external_id: body.source_id || null,
      received_at: body.created_at ? String(body.created_at).slice(0, 40) : null
    }
  });
  return { accepted: true, reason: null, envelope: env };
}

// Refuses a project whose configured provider class contradicts the channel
// the conversation actually runs on. Returns a reason or null.
function providerConsistency(channelType, provider) {
  var expected = CHANNEL_CLASS.hasOwnProperty(channelType) ? CHANNEL_CLASS[channelType] : undefined;
  if (expected === undefined) return channelType ? 'CHANNEL_TYPE_UNSUPPORTED' : null;
  if (expected === null) return null;
  return envelope.providerClass(provider) === expected ? null : 'PROVIDER_CLASS_CONTRADICTS_CHANNEL';
}

function sendReply(o) {
  o = o || {};
  var fail = function (error) { return Promise.resolve({ ok: false, status: null, crm_message_id: null, error: error }); };
  if (!o.baseUrl) return fail('CONFIG: base url missing');
  var host;
  try { host = new URL(String(o.baseUrl)).hostname; } catch (e) { return fail('CONFIG: base url invalid'); }
  if (!fence.isPrivateHost(host) && o.allowPublic !== true) return fail('CONFIG: CRM host is not private');
  if (!ID_RE.test(String(o.accountId))) return fail('CONFIG: account id is not acceptable');
  if (!ID_RE.test(String(o.conversationId))) return fail('CONFIG: conversation id is not acceptable');
  if (!o.apiToken) return fail('CONFIG: credential missing');
  if (typeof o.text !== 'string' || !o.text.trim()) return fail('CONFIG: empty reply');
  if (o.text.length > MAX_REPLY) return fail('CONFIG: reply exceeds ' + MAX_REPLY + ' characters');

  var target = String(o.baseUrl).replace(/\/+$/, '') + '/api/v1/accounts/' + encodeURIComponent(String(o.accountId)) +
    '/conversations/' + encodeURIComponent(String(o.conversationId)) + '/messages';
  var body = { content: o.text, message_type: 'outgoing', private: false };
  return httpJson.postJson(target, body, {
    // The token lives only in this object for the lifetime of the request;
    // http-json never logs or returns headers.
    headers: { api_access_token: o.apiToken },
    timeoutMs: o.timeoutMs || 15000
  }).then(function (res) {
    var id = null;
    if (res.ok) { try { var parsed = JSON.parse(res.body); if (parsed && parsed.id !== undefined) id = String(parsed.id).slice(0, 40); } catch (e) { /* not JSON */ } }
    return { ok: res.ok, status: res.statusCode, crm_message_id: id, error: res.ok ? null : ('HTTP ' + res.statusCode + ': ' + String(res.body || '').slice(0, 300)) };
  }, function (err) {
    return { ok: false, status: null, crm_message_id: null, error: 'TRANSPORT: ' + String(err.message).slice(0, 300) };
  });
}

module.exports = {
  id: ID,
  TOKEN_QUERY_KEY: TOKEN_QUERY_KEY,
  describe: describe,
  authorizeWebhook: authorizeWebhook,
  parseWebhook: parseWebhook,
  providerConsistency: providerConsistency,
  sendReply: sendReply
};
