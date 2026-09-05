'use strict';
// Fake CommunicationProvider for contract tests: deterministic, in-memory, no network.
var crypto = require('crypto');
var state = { sent: [], fail: null, health: 'open' };
function parseInbound(body) {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'BODY_NOT_OBJECT' };
  if (body.event === 'fake.connection') return { ok: true, kind: 'connection', event: { provider: 'fake', instance: String(body.instance), status: body.state === 'open' ? 'open' : 'closed', provider_state: body.state } };
  if (body.event === 'fake.status') return { ok: true, kind: 'status', event: { provider: 'fake', instance: String(body.instance), provider_message_id: String(body.id), status: body.status, from_me: true } };
  if (body.event !== 'fake.message') return { ok: false, reason: 'EVENT_IGNORED:' + String(body.event), instance: body.instance };
  if (!body.id || !body.from) return { ok: false, reason: 'MESSAGE_ID' };
  var ids = [{ kind: 'provider_user', value: String(body.from) }];
  if (body.phone) ids.push({ kind: 'phone', value: String(body.phone) });
  if (body.bsuid) ids.push({ kind: 'bsuid', value: String(body.bsuid) });
  return { ok: true, kind: 'message', event: { provider: 'fake', instance: String(body.instance), provider_message_id: String(body.id), contact: { wa_id: body.phone ? String(body.phone) : null, lid: null, display_name: body.name || null, identities: ids }, chat_id: String(body.from), message_type: body.type || 'text', text: String(body.text || ''), quoted_provider_message_id: null, provider_timestamp: body.ts ? new Date(body.ts).toISOString() : null, attachments: [], raw: { id: body.id } } };
}
module.exports = {
  id: 'fake', channel: 'test',
  describe: function () { return { id: 'fake', channel: 'test', credential_present: true, problems: [] }; },
  capabilities: function () { return { channel: 'test', official: true, text: true, media: { inbound: true, outbound: true, fetch: true, kinds: ['image'] }, templates: true, reactions: false, quotes: true, conversation_window_hours: 24, signed_webhooks: true, webhook_retries: true, delivery_states: ['sent', 'delivered', 'read', 'failed'], limitations: [] }; },
  parseInbound: parseInbound,
  sendText: function (o) { if (state.fail) return Promise.resolve({ ok: false, status: state.fail === 'transport' ? null : 500, provider_message_id: null, error: state.fail === 'transport' ? 'TRANSPORT: refused' : 'HTTP 500: fake' }); var id = 'FAKE' + (state.sent.length + 1); state.sent.push({ to: o.to, text: o.text, id: id }); return Promise.resolve({ ok: true, status: 201, provider_message_id: id, error: null }); },
  fetchMedia: function (o) { return Promise.resolve({ ok: true, mime_type: 'image/png', size_bytes: 4, bytes: Buffer.from([1, 2, 3, 4]) }); },
  verifyWebhook: function (req, ctx) { var sig = req && req.headers ? req.headers['x-fake-signature'] : null; var exp = crypto.createHmac('sha256', String((ctx && ctx.secret) || 'fake-secret')).update(String((ctx && ctx.rawBody) || '')).digest('hex'); return sig === exp ? { ok: true, reason: null } : { ok: false, reason: 'SIGNATURE_MISMATCH' }; },
  health: function () { return Promise.resolve({ ok: state.health === 'open', state: state.health }); },
  payloadHash: function (raw) { return crypto.createHash('sha256').update(String(raw)).digest('hex'); },
  redactDeep: function (v) { var s = JSON.stringify(v || null, function (k, x) { return /secret|token|apikey|mediakey/i.test(k) ? undefined : x; }); return JSON.parse(s); },
  _state: state
};
