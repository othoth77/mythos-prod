'use strict';
// =====================================================
// MYTHOS bridge notifications — generic HTTP gateway adapter
// projects/mythos-ai-executor/bridge/notify/providers/generic.js
//
// WHY THIS EXISTS
//
// `providers/evolution.js` binds MYTHOS to one gateway's URL shape and body
// shape. Every other candidate gateway (WAHA, wa-evolution, a Baileys
// wrapper, an in-house relay) speaks the same *kind* of interface — POST
// some JSON containing a recipient and a text, with one auth header — and
// differs only in the path, the field names and the header name. Writing a
// new file per gateway makes every provider swap a code change, a review and
// a deploy; that is the coupling the bridge is supposed to be free of.
//
// This adapter takes those four differences as CONFIGURATION and implements
// the same contract as every other adapter. Pointing MYTHOS at a different
// WhatsApp gateway therefore becomes an environment change, not a code
// change — which is exactly what makes the provider decision reversible.
//
// It deliberately does NOT make the layer more powerful: it still sends one
// plain text to one recipient, it still cannot create instances, pair a
// device, send media or receive anything, the gateway host must still pass
// the private-network rule in whatsapp.js, and the credential is still read
// at send time and never logged.
//
// Configuration (all optional; the defaults reproduce the Evolution API
// shape byte for byte, so `generic` can drive the currently-supported
// gateway with no configuration at all):
//
//   MYTHOS_BRIDGE_WHATSAPP_GENERIC_PATH         /message/sendText/{instance}
//   MYTHOS_BRIDGE_WHATSAPP_GENERIC_AUTH_HEADER  apikey
//   MYTHOS_BRIDGE_WHATSAPP_GENERIC_AUTH_PREFIX  (empty; e.g. "Bearer " for a token API)
//   MYTHOS_BRIDGE_WHATSAPP_GENERIC_BODY         {"number":"{{to}}","text":"{{text}}"}
//   MYTHOS_BRIDGE_WHATSAPP_GENERIC_ID_PATH      key.id
//
// SAFETY OF THE TEMPLATES — the part that matters
//
//   - The body template is JSON-parsed FIRST, then `{{to}}` / `{{text}}` /
//     `{{instance}}` are substituted into the already-parsed values. A
//     recipient or a report summary can therefore never inject JSON
//     structure: it lands in a string slot and is re-escaped by
//     JSON.stringify. String substitution into raw JSON text — the obvious
//     implementation — would be a template-injection hole and is not used.
//   - Object KEYS are never substituted.
//   - The path template is validated against a closed alphabet and the two
//     substituted values are URL-encoded, so neither can add a path segment
//     or a query string.
//   - The header NAME is validated; the header VALUE is the credential and
//     is never described, returned or logged.
// =====================================================

var httpJson = require('../http-json');

var ID = 'generic';

// WhatsApp addressing is a protocol fact, not a gateway fact: these are
// intentionally identical to the Evolution adapter's, and duplicated rather
// than shared so that neither adapter can break the other.
var MSISDN_RE = /^[0-9]{6,20}$/;
var JID_RE = /^[0-9]{6,20}@(s\.whatsapp\.net|g\.us)$/;

var INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// A path template: absolute, no query, no scheme, no dot segments. `{instance}`
// and `{to}` are the only placeholders and their values are URL-encoded.
var PATH_RE = /^\/[A-Za-z0-9._~\-/{}]*$/;
var HEADER_RE = /^[A-Za-z][A-Za-z0-9-]{0,39}$/;
var ID_PATH_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

var DEFAULTS = {
  path: '/message/sendText/{instance}',
  authHeader: 'apikey',
  authPrefix: '',
  bodyTemplate: '{"number":"{{to}}","text":"{{text}}"}',
  idPath: 'key.id'
};

function isValidRecipient(to) {
  return typeof to === 'string' && (MSISDN_RE.test(to) || JID_RE.test(to));
}

function options(o) {
  var raw = (o && o.options) || {};
  return {
    path: raw.path || DEFAULTS.path,
    authHeader: raw.authHeader || DEFAULTS.authHeader,
    authPrefix: raw.authPrefix === undefined || raw.authPrefix === null ? DEFAULTS.authPrefix : String(raw.authPrefix),
    bodyTemplate: raw.bodyTemplate || DEFAULTS.bodyTemplate,
    idPath: raw.idPath || DEFAULTS.idPath
  };
}

// Static configuration problems, reported by `notify-config` and enforced by
// the readiness gate BEFORE anything is queued or sent. Names only — this
// function never returns a configured value that could be a credential.
function configProblems(rawOptions) {
  var opt = options({ options: rawOptions });
  var problems = [];
  if (!PATH_RE.test(opt.path)) problems.push('MYTHOS_BRIDGE_WHATSAPP_GENERIC_PATH is not an absolute path over the accepted alphabet');
  else if (opt.path.indexOf('..') !== -1) problems.push('MYTHOS_BRIDGE_WHATSAPP_GENERIC_PATH contains a dot segment');
  if (!HEADER_RE.test(opt.authHeader)) problems.push('MYTHOS_BRIDGE_WHATSAPP_GENERIC_AUTH_HEADER is not a valid header name');
  if (String(opt.authPrefix).length > 32 || /[\r\n]/.test(String(opt.authPrefix))) problems.push('MYTHOS_BRIDGE_WHATSAPP_GENERIC_AUTH_PREFIX is too long or contains a newline');
  var parsed = null;
  try { parsed = JSON.parse(opt.bodyTemplate); } catch (e) { parsed = undefined; }
  if (parsed === undefined) problems.push('MYTHOS_BRIDGE_WHATSAPP_GENERIC_BODY is not valid JSON');
  else if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) problems.push('MYTHOS_BRIDGE_WHATSAPP_GENERIC_BODY is not a JSON object');
  else if (opt.bodyTemplate.indexOf('{{text}}') === -1) problems.push('MYTHOS_BRIDGE_WHATSAPP_GENERIC_BODY does not carry the {{text}} placeholder');
  else if (opt.bodyTemplate.indexOf('{{to}}') === -1 && opt.path.indexOf('{to}') === -1) problems.push('MYTHOS_BRIDGE_WHATSAPP_GENERIC_BODY does not carry the {{to}} placeholder and the path does not either');
  if (!ID_PATH_RE.test(opt.idPath)) problems.push('MYTHOS_BRIDGE_WHATSAPP_GENERIC_ID_PATH is not a dotted field path');
  return problems;
}

function describe(rawOptions) {
  var opt = options({ options: rawOptions });
  return {
    id: ID,
    transport: 'HTTP POST (JSON) over the private network',
    endpoint_shape: 'POST {baseUrl}' + opt.path,
    auth: opt.authHeader + ' request header, read at send time from a 0600 file or the environment; never stored, never logged',
    // The template is a shape, not a value: it holds field names and
    // placeholders only, and the credential never appears in it.
    body_shape: opt.bodyTemplate,
    message_id_path: opt.idPath,
    capabilities: ['sendText'],
    not_implemented: ['instance lifecycle', 'QR / pairing', 'media', 'groups', 'inbound webhooks', 'chat state'],
    notes: 'configuration-driven adapter: a different WhatsApp gateway is an environment change, not a code change'
  };
}

// Substitutes into ALREADY-PARSED values. Structure can never be injected.
function substitute(node, vars) {
  if (typeof node === 'string') {
    return node.replace(/\{\{(to|text|instance)\}\}/g, function (m, k) { return vars[k]; });
  }
  if (Array.isArray(node)) return node.map(function (n) { return substitute(n, vars); });
  if (node && typeof node === 'object') {
    var out = {};
    Object.keys(node).forEach(function (k) { out[k] = substitute(node[k], vars); });
    return out;
  }
  return node;
}

function pick(body, dotted) {
  try {
    var node = JSON.parse(body);
    var parts = dotted.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (!node || typeof node !== 'object') return null;
      node = node[parts[i]];
    }
    return typeof node === 'string' ? node.slice(0, 120) : (typeof node === 'number' ? String(node).slice(0, 120) : null);
  } catch (e) {
    return null;
  }
}

function sendText(o) {
  o = o || {};
  var opt = options(o);
  var problems = configProblems(o.options);
  if (problems.length) return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: ' + problems[0] });
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

  var vars = { to: o.to, text: o.text, instance: String(o.instance) };
  var target = String(o.baseUrl).replace(/\/+$/, '') + opt.path
    .replace(/\{instance\}/g, encodeURIComponent(o.instance))
    .replace(/\{to\}/g, encodeURIComponent(o.to));
  var body = substitute(JSON.parse(opt.bodyTemplate), vars);

  var headers = {};
  headers[opt.authHeader.toLowerCase()] = opt.authPrefix + o.apiKey;

  return httpJson.postJson(target, body, {
    headers: headers,
    timeoutMs: o.timeoutMs || 15000
  }).then(function (res) {
    return {
      ok: res.ok,
      status: res.statusCode,
      provider_message_id: res.ok ? pick(res.body, opt.idPath) : null,
      error: res.ok ? null : ('HTTP ' + res.statusCode + ': ' + String(res.body || '').slice(0, 300))
    };
  }, function (err) {
    return { ok: false, status: null, provider_message_id: null, error: 'TRANSPORT: ' + String(err.message).slice(0, 300) };
  });
}

module.exports = {
  id: ID,
  requirements: ['baseUrl', 'instance', 'apiKey', 'recipients'],
  DEFAULTS: DEFAULTS,
  describe: describe,
  configProblems: configProblems,
  isValidRecipient: isValidRecipient,
  sendText: sendText
};
