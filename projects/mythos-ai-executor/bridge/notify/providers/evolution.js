'use strict';
// =====================================================
// MYTHOS bridge notifications — Evolution API adapter
// projects/mythos-ai-executor/bridge/notify/providers/evolution.js
//
// ONE capability: send a plain text message to one recipient. Nothing else
// of the Evolution API surface is reachable from here — no instance
// creation, no QR/session handling, no media, no group management, no
// inbound webhook. This is the WhatsApp *notification* layer of the GitHub
// bridge, not a WhatsApp integration (MYTHOS AUTO customer chat is
// explicitly out of scope and must not be built on this adapter).
//
// Adapter contract (implement these to add WAHA / WhatsApp Business Cloud
// API later without touching github-bridge.js or whatsapp.js):
//
//   id            string, matches the MYTHOS_BRIDGE_WHATSAPP_PROVIDER value
//   requirements  array of config keys that must be present before enabling
//   describe()    { id, transport, endpoint_shape, notes } — no secrets
//   sendText(o)   Promise<{ ok, status, provider_message_id, error }>
//                 o = { baseUrl, instance, apiKey, to, text, timeoutMs,
//                       apiVersion }
//                 MUST NOT throw for an HTTP error status, MUST NOT return
//                 or log the credential, MUST NOT retry internally (retry
//                 and idempotency belong to the ledger in whatsapp.js).
//
// Endpoint used (self-hosted Evolution API, private network):
//   POST {baseUrl}/message/sendText/{instance}
//   header: apikey: <instance or global key>
//   body v2: { number, text }
//   body v1: { number, textMessage: { text } }
// =====================================================

var httpJson = require('../http-json');

var ID = 'evolution';

// Digits-only MSISDN, or an explicit WhatsApp JID. Anything else is refused
// before a request is built, so a malformed recipient can never become a
// path/query injection into the provider URL.
var MSISDN_RE = /^[0-9]{6,20}$/;
var JID_RE = /^[0-9]{6,20}@(s\.whatsapp\.net|g\.us)$/;

// The instance name becomes a URL path segment. Keep it to a safe alphabet.
var INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function isValidRecipient(to) {
  return typeof to === 'string' && (MSISDN_RE.test(to) || JID_RE.test(to));
}

function describe() {
  return {
    id: ID,
    transport: 'HTTP POST (JSON) over the private network',
    endpoint_shape: 'POST {baseUrl}/message/sendText/{instance}',
    auth: 'apikey request header, read at send time from a 0600 file or the environment; never stored, never logged',
    capabilities: ['sendText'],
    not_implemented: ['instance lifecycle', 'QR / pairing', 'media', 'groups', 'inbound webhooks', 'chat state']
  };
}

// Extracts a provider-side message id when the response carries one, so a
// delivery can be correlated later. Shape-tolerant on purpose: the id is
// evidence, never a control value.
function messageId(body) {
  try {
    var parsed = JSON.parse(body);
    if (parsed && parsed.key && typeof parsed.key.id === 'string') return parsed.key.id.slice(0, 120);
    if (parsed && typeof parsed.id === 'string') return parsed.id.slice(0, 120);
  } catch (e) { /* a non-JSON body is not an error here */ }
  return null;
}

function sendText(o) {
  o = o || {};
  if (!o.baseUrl) return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: base url missing' });
  if (!INSTANCE_RE.test(String(o.instance || ''))) {
    return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: instance name is not acceptable' });
  }
  if (!isValidRecipient(o.to)) {
    return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: recipient is not a digits-only MSISDN or a WhatsApp JID' });
  }
  if (!o.apiKey) return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: credential missing' });
  if (typeof o.text !== 'string' || !o.text) {
    return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: empty message' });
  }

  var target = String(o.baseUrl).replace(/\/+$/, '') + '/message/sendText/' + encodeURIComponent(o.instance);
  var body = o.apiVersion === 'v1'
    ? { number: o.to, textMessage: { text: o.text } }
    : { number: o.to, text: o.text };

  return httpJson.postJson(target, body, {
    // The credential lives only in this object, for the lifetime of the
    // request. http-json never logs or returns headers.
    headers: { apikey: o.apiKey },
    timeoutMs: o.timeoutMs || 15000
  }).then(function (res) {
    return {
      ok: res.ok,
      status: res.statusCode,
      provider_message_id: res.ok ? messageId(res.body) : null,
      // The body is already redacted by http-json; truncate again for the ledger.
      error: res.ok ? null : ('HTTP ' + res.statusCode + ': ' + String(res.body || '').slice(0, 300))
    };
  }, function (err) {
    return { ok: false, status: null, provider_message_id: null, error: 'TRANSPORT: ' + String(err.message).slice(0, 300) };
  });
}

module.exports = {
  id: ID,
  requirements: ['baseUrl', 'instance', 'apiKey', 'recipients'],
  describe: describe,
  isValidRecipient: isValidRecipient,
  sendText: sendText
};
