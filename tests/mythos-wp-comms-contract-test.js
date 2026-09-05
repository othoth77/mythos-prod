'use strict';
// =====================================================
// MYTHOS WP — CommunicationProvider contract tests (MYTHOS-COMMS-9, #222)
// Runs the SAME checks against every registered provider (Evolution) and the
// fake provider fixture: describe, capabilities shape, inbound parsing to the
// neutral event (identities included), outbound text contract (fake: real
// send; evolution: config failures without network), media fetch contract,
// webhook verification (token vs HMAC), failure handling (never throws),
// idempotent normalisation, provider-neutral event mapping. No DB, no network.
// =====================================================
var path = require('path');
var crypto = require('crypto');
var ROOT = path.resolve(__dirname, '..');
var WP = path.join(ROOT, 'projects/mythos-wp');
var passed = 0, failed = 0;
function ok(c, n) { if (c) passed++; else { failed++; console.error('FAIL: ' + n); } }
delete process.env.MYTHOS_WP_EVOLUTION_API_KEY_FILE;
var registry = require(path.join(WP, 'reference/comms/provider'));
var events = require(path.join(WP, 'reference/comms/events'));
var evolution = require(path.join(WP, 'reference/comms/providers/evolution'));
var fake = require(path.join(ROOT, 'tests/fixtures/comms/fake-provider'));

// registry
ok(registry.validate(evolution).length === 0, 'evolution satisfies the contract');
ok(registry.validate(fake).length === 0, 'fake satisfies the contract');
ok(registry.validate({ id: 'bad' }).length >= 8, 'incomplete module is rejected with named problems');
ok(registry.validate({ id: 'x', describe: function () {}, capabilities: function () { return { channel: 1 }; }, parseInbound: function () {}, sendText: function () {}, fetchMedia: function () {}, verifyWebhook: function () {}, health: function () {}, payloadHash: function () {}, redactDeep: function () {} }).indexOf('CAPABILITY_CHANNEL') !== -1, 'capability descriptor types are checked');
var threw = false; try { registry.register({ id: 'nope' }); } catch (e) { threw = !!e.problems; } ok(threw, 'register() refuses a non-conforming provider');
registry.register(evolution); registry.register(fake);
ok(registry.ids().indexOf('evolution') !== -1 && registry.ids().indexOf('fake') !== -1, 'both providers registered');
ok(registry.can('fake', 'media.fetch') === true && registry.can('evolution', 'media.fetch') === false && registry.can('evolution', 'templates') === false && registry.can('nope', 'text') === false, 'capability lookup instead of provider-name branching');

var providers = [evolution, fake];
var samples = {
  evolution: { message: { event: 'messages.upsert', instance: 'inst-1', sender: '21600000000@s.whatsapp.net', data: { key: { remoteJid: '123456789012345@lid', senderPn: '21699000001@s.whatsapp.net', fromMe: false, id: 'E1' }, pushName: 'C', message: { conversation: 'hi' }, messageTimestamp: 1788620000 }, apikey: 'SECRET' }, status: { event: 'messages.update', instance: 'inst-1', data: { keyId: 'E1', status: 'READ' } }, connection: { event: 'connection.update', instance: 'inst-1', data: { state: 'open' } }, garbage: { event: 'messages.upsert', instance: 'inst-1', data: { key: { remoteJid: '1@g.us', fromMe: false, id: 'G' } } } },
  fake: { message: { event: 'fake.message', instance: 'inst-1', id: 'F1', from: 'user-1', phone: '21699000001', bsuid: 'BS1', text: 'hi', ts: 1788620000000, secret: 'SECRET' }, status: { event: 'fake.status', instance: 'inst-1', id: 'F1', status: 'read' }, connection: { event: 'fake.connection', instance: 'inst-1', state: 'open' }, garbage: { event: 'fake.other', instance: 'inst-1' } }
};
providers.forEach(function (p) {
  var n = p.id; var S = samples[n];
  var d = p.describe(); ok(d && d.id === n && Array.isArray(d.problems), n + ': describe() shape');
  ok(JSON.stringify(d).indexOf('SECRET') === -1, n + ': describe() carries no secret');
  var c = p.capabilities(); ok(typeof c.official === 'boolean' && Array.isArray(c.delivery_states) && c.media && Array.isArray(c.media.kinds) && Array.isArray(c.limitations), n + ': capabilities() shape');
  var m = p.parseInbound(S.message);
  ok(m.ok && m.kind === 'message' && m.event.provider === n && m.event.instance === 'inst-1' && typeof m.event.provider_message_id === 'string' && typeof m.event.message_type === 'string' && typeof m.event.text === 'string' && Array.isArray(m.event.attachments), n + ': message event shape');
  ok(Array.isArray(m.event.contact.identities) && m.event.contact.identities.length >= 1 && m.event.contact.identities.every(function (i) { return /^(phone|lid|bsuid|provider_user)$/.test(i.kind) && i.value; }), n + ': contact identities present (' + m.event.contact.identities.map(function (i) { return i.kind; }).join(',') + ')');
  ok(m.event.provider_timestamp === null || !isNaN(Date.parse(m.event.provider_timestamp)), n + ': provider_timestamp is ISO or null');
  ok(JSON.stringify(m.event.raw || {}).indexOf('SECRET') === -1, n + ': raw is redacted');
  var m2 = p.parseInbound(S.message); ok(JSON.stringify(m2) === JSON.stringify(m), n + ': parseInbound is deterministic (idempotent normalisation)');
  var st = p.parseInbound(S.status); ok(st.ok && st.kind === 'status' && ['sent', 'delivered', 'read', 'failed', 'queued'].indexOf(st.event.status) !== -1 && events.forStatus(st.event.status).indexOf('message.') === 0, n + ': status event maps to a neutral message.* event');
  var cn = p.parseInbound(S.connection); ok(cn.ok && cn.kind === 'connection' && ['open', 'closed', 'pairing'].indexOf(cn.event.status) !== -1, n + ': connection event');
  var g = p.parseInbound(S.garbage); ok(!g.ok && typeof g.reason === 'string', n + ': irrelevant events refused with a reason');
  ok(!p.parseInbound(null).ok && !p.parseInbound('x').ok && !p.parseInbound([]).ok, n + ': non-object bodies refused, no throw');
  ok(typeof p.payloadHash('abc') === 'string' && p.payloadHash('abc').length === 64, n + ': payloadHash sha256');
  ok(JSON.stringify(p.redactDeep({ apikey: 'SECRET', token: 'SECRET', nested: { mediaKey: 'SECRET', ok: 1 } })).indexOf('SECRET') === -1, n + ': redactDeep strips credentials');
});
// outbound contract
fake.sendText({ baseUrl: 'x', instance: 'inst-1', apiKey: 'k', to: '21699000001', text: 'hello' }).then(function (r) {
  ok(r.ok && r.status === 201 && r.provider_message_id === 'FAKE1' && r.error === null, 'fake: sendText ok shape');
  fake._state.fail = 'transport'; return fake.sendText({ to: '21699000001', text: 'x' });
}).then(function (r) { ok(!r.ok && /^TRANSPORT/.test(r.error), 'fake: transport failure classified'); fake._state.fail = null; return evolution.sendText({}); })
  .then(function (r) { ok(!r.ok && /^CONFIG/.test(r.error) && r.provider_message_id === null, 'evolution: sendText config failure never throws'); return evolution.sendText({ baseUrl: 'http://127.0.0.1:9', instance: 'i', apiKey: 'k', to: '21699000001', text: 'x', timeoutMs: 500 }); })
  .then(function (r) { ok(!r.ok && /^TRANSPORT/.test(r.error), 'evolution: transport failure classified'); return Promise.all([fake.fetchMedia({}), evolution.fetchMedia({})]); })
  .then(function (x) { ok(x[0].ok === true && x[0].mime_type && x[0].size_bytes === 4, 'fake: fetchMedia ok shape'); ok(x[1].ok === false && x[1].reason === 'NOT_SUPPORTED', 'evolution: fetchMedia answers NOT_SUPPORTED (capability media.fetch=false)'); return Promise.all([fake.health({ instance: 'i' }), evolution.health({ instance: 'bad name' }), evolution.health({ instance: 'i' })]); })
  .then(function (x) { ok(x[0].ok && x[0].state === 'open', 'fake: health'); ok(!x[1].ok && x[1].state === 'unknown', 'evolution: health with bad instance → unknown'); ok(!x[2].ok && (x[2].state === 'unknown' || x[2].state === 'unreachable'), 'evolution: health without credential never throws'); })
  .then(function () {
    var tok = 'shared-token-0123456789abcdef';
    ok(evolution.verifyWebhook({ headers: { 'x-mythos-webhook-token': tok } }, { expectedToken: tok }).ok, 'evolution: header token accepted');
    ok(evolution.verifyWebhook({ headers: {} }, { query: { token: tok }, expectedToken: tok }).ok, 'evolution: query token accepted');
    ok(evolution.verifyWebhook({ headers: { 'x-mythos-webhook-token': 'wrong-token-wrong-token' } }, { expectedToken: tok }).reason === 'WEBHOOK_TOKEN_MISMATCH', 'evolution: wrong token refused');
    ok(evolution.verifyWebhook({ headers: {} }, { expectedToken: 'short' }).reason === 'WEBHOOK_TOKEN_NOT_CONFIGURED', 'evolution: short/absent token = not configured');
    var body = '{"event":"fake.message"}'; var sig = crypto.createHmac('sha256', 's3cret').update(body).digest('hex');
    ok(fake.verifyWebhook({ headers: { 'x-fake-signature': sig } }, { rawBody: body, secret: 's3cret' }).ok, 'fake (signed provider): HMAC over raw body accepted');
    ok(!fake.verifyWebhook({ headers: { 'x-fake-signature': sig } }, { rawBody: body + ' ', secret: 's3cret' }).ok, 'fake: tampered body refused');
    ok(events.EVENTS.length >= 25 && events.isEvent('message.received') && !events.isEvent('MESSAGES_UPSERT') && events.forKind('message_in') === 'message.received' && events.forKind('unknown_kind') === 'conversation.updated', 'event catalogue is provider-neutral');
    console.log('mythos-wp-comms-contract: ' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
  })
  .catch(function (e) { console.error('ERROR: ' + (e && e.stack || e)); failed++; console.log('mythos-wp-comms-contract: ' + passed + ' passed, ' + failed + ' failed'); process.exit(1); });
