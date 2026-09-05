'use strict';
// =====================================================
// MYTHOS WP — CommunicationProvider contract and registry (MYTHOS-COMMS-9)
// projects/mythos-wp/reference/comms/provider.js
//
// Every transport (Evolution today, Meta Cloud API next, Telegram / Messenger /
// web chat later) is a module that satisfies this contract. Nothing above
// the receiver and the outbound module may branch on a provider's name when
// the capability descriptor answers the question.
//
//   id                      'evolution' | 'meta_cloud' | …
//   describe()              → non-secret status { id, channel, version?, configured, problems[] }
//   capabilities()          → CAPABILITY descriptor (below)
//   parseInbound(body)      → { ok, reason?, kind: 'message'|'connection'|'status', event }
//                             message events carry contact.identities: [{ kind, value }]
//   sendText(o)             → Promise<{ ok, status, provider_message_id, error }>; never throws on HTTP errors
//   fetchMedia(o)           → Promise<{ ok, reason?, mime_type?, size_bytes?, bytes?|stream? }> (may answer ok:false NOT_SUPPORTED)
//   verifyWebhook(req, ctx) → { ok, reason } — provider-specific authentication of one delivery
//   health(o)               → Promise<{ ok, state, reason? }> — connection state for the heartbeat
//   payloadHash(raw)        → sha256 hex of the raw body
//   redactDeep(value)       → payload without credentials / media keys
//
// CAPABILITY descriptor (all keys required; unknown keys allowed):
//   { channel, official, text, media: { inbound, outbound, fetch, kinds: [] }, templates, reactions, quotes,
//     conversation_window_hours: number|null, signed_webhooks, webhook_retries, delivery_states: [], limitations: [] }
// =====================================================
var REQUIRED_FUNCTIONS = ['describe', 'capabilities', 'parseInbound', 'sendText', 'fetchMedia', 'verifyWebhook', 'health', 'payloadHash', 'redactDeep'];
var CAPABILITY_KEYS = { channel: 'string', official: 'boolean', text: 'boolean', media: 'object', templates: 'boolean', reactions: 'boolean', quotes: 'boolean', conversation_window_hours: 'number|null', signed_webhooks: 'boolean', webhook_retries: 'boolean', delivery_states: 'array', limitations: 'array' };
var MEDIA_KEYS = { inbound: 'boolean', outbound: 'boolean', fetch: 'boolean', kinds: 'array' };
var ID_RE = /^[a-z][a-z0-9_]{1,23}$/;
var registry = Object.create(null);

function typeOk(v, t) {
  if (t === 'number|null') return v === null || typeof v === 'number';
  if (t === 'array') return Array.isArray(v);
  if (t === 'object') return v && typeof v === 'object' && !Array.isArray(v);
  return typeof v === t;
}
// validate(provider) → [] when the module satisfies the contract, else the list of problems
function validate(p) {
  var problems = [];
  if (!p || typeof p !== 'object') return ['PROVIDER_NOT_OBJECT'];
  if (!ID_RE.test(String(p.id || ''))) problems.push('ID_SHAPE');
  REQUIRED_FUNCTIONS.forEach(function (f) { if (typeof p[f] !== 'function') problems.push('MISSING_' + f.toUpperCase()); });
  if (typeof p.capabilities === 'function') {
    var c = null; try { c = p.capabilities(); } catch (e) { problems.push('CAPABILITIES_THROWS'); }
    if (c) {
      Object.keys(CAPABILITY_KEYS).forEach(function (k) { if (!typeOk(c[k], CAPABILITY_KEYS[k])) problems.push('CAPABILITY_' + k.toUpperCase()); });
      if (c.media && typeof c.media === 'object') Object.keys(MEDIA_KEYS).forEach(function (k) { if (!typeOk(c.media[k], MEDIA_KEYS[k])) problems.push('CAPABILITY_MEDIA_' + k.toUpperCase()); });
    }
  }
  return problems;
}
function register(p) {
  var problems = validate(p);
  if (problems.length) { var e = new Error('provider does not satisfy the contract: ' + problems.join(', ')); e.problems = problems; throw e; }
  registry[p.id] = p;
  return p;
}
function get(id) { return registry[id] || null; }
function all() { return Object.keys(registry).map(function (k) { return registry[k]; }); }
function ids() { return Object.keys(registry); }
// capability lookup helper used by the Core / policy instead of provider-name branching
function can(providerId, path) {
  var p = get(providerId); if (!p) return false;
  var c = p.capabilities(); var cur = c;
  var parts = String(path).split('.');
  for (var i = 0; i < parts.length; i++) { if (cur === null || cur === undefined) return false; cur = cur[parts[i]]; }
  return cur === true;
}
module.exports = { REQUIRED_FUNCTIONS: REQUIRED_FUNCTIONS, CAPABILITY_KEYS: CAPABILITY_KEYS, validate: validate, register: register, get: get, all: all, ids: ids, can: can };
