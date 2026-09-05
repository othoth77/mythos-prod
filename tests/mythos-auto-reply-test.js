'use strict';
// =====================================================
// MYTHOS AUTO lightweight auto-reply engine — tests (Issue #173)
// tests/mythos-auto-reply-test.js
//
// Covers the Evolution channel adapter (inbound normalisation, own/group/
// status refusal, egress against a loopback stub), intent classification,
// the business data port, the reply generators and the fact guard, the
// auto-reply handler, the ledger (duplicate inbound, own-outbound echo,
// rate cap, provider breaker), the outbound policy, the engine end to end
// in dry-run and live mode (against the stub, never a real gateway), the
// receiver on a loopback port, the CLI, secret redaction and the
// separation from the operational notification layer.
// No network beyond 127.0.0.1. No WhatsApp. No real customer.
//
//   node tests/mythos-auto-reply-test.js
// =====================================================

var http = require('http');
var fs = require('fs');
var os = require('os');
var path = require('path');
var spawn = require('child_process').spawn;
var execFile = require('child_process').execFile;

var ROOT = path.resolve(__dirname, '..');
var COMMS = path.join(ROOT, 'projects/automotive/comms');
var envelope = require(path.join(COMMS, 'lib/envelope'));
var projects = require(path.join(COMMS, 'lib/projects'));
var crm = require(path.join(COMMS, 'lib/crm'));
var evolution = require(path.join(COMMS, 'lib/crm/evolution'));
var router = require(path.join(COMMS, 'lib/router'));
var intents = require(path.join(COMMS, 'lib/intents'));
var businessData = require(path.join(COMMS, 'lib/business-data'));
var ai = require(path.join(COMMS, 'lib/ai'));
var autoReply = require(path.join(COMMS, 'lib/handlers/auto-reply'));
var ledgerLib = require(path.join(COMMS, 'lib/ledger'));
var policy = require(path.join(COMMS, 'lib/policy'));
var engine = require(path.join(COMMS, 'lib/engine'));
var redact = require(path.join(ROOT, 'projects/mythos-orchestrator/lib/redact'));

var passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.error('FAIL: ' + name); } }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

var EXAMPLE = JSON.parse(fs.readFileSync(path.join(COMMS, 'config/comms.evolution.example.json'), 'utf8'));
var TOKEN = 'test-webhook-token-not-a-real-credential-0123456789';
var API_KEY = 'test-instance-apikey-not-real-fedcba9876543210';
var BODY_APIKEY = 'test-body-apikey-never-to-be-copied-ABCDEF0123';
var CUSTOMER = '21698765432';

// An Evolution v2 `messages.upsert` delivery (shape verified against the
// running gateway's webhook contract, 2026-09-05).
function hook(over) {
  over = over || {};
  var body = {
    event: 'messages.upsert',
    instance: 'ssangyong-autos',
    data: {
      key: Object.assign({ remoteJid: CUSTOMER + '@s.whatsapp.net', fromMe: false, id: over.id || 'MSG0001' }, over.key || {}),
      pushName: 'Client Test',
      message: over.message || { conversation: over.text !== undefined ? over.text : 'Bonjour' },
      messageType: 'conversation',
      messageTimestamp: 1757030000
    },
    sender: '21600000000@s.whatsapp.net',
    server_url: 'http://127.0.0.1:8080',
    apikey: BODY_APIKEY
  };
  if (over.event) body.event = over.event;
  if (over.instance) body.instance = over.instance;
  return body;
}

function baseCfg(over) {
  var c = clone(EXAMPLE);
  c.crm.api_token_file = '/tmp/does-not-exist.apikey';
  c.crm.webhook_token_file = '/tmp/does-not-exist.token';
  delete c.auto_reply.state_dir;
  if (over) over(c);
  return c;
}

function q() { return { token: TOKEN }; }

// ---------- 1. adapter: inbound normalisation ----------
(function () {
  ok(crm.get('evolution') === evolution && evolution.id === 'evolution', 'registry: evolution adapter registered');
  var a = evolution.authorizeWebhook({ query: q(), expectedToken: TOKEN });
  ok(a.ok === true, 'authorize: query token accepted');
  ok(evolution.authorizeWebhook({ headers: { 'x-mythos-webhook-token': TOKEN }, expectedToken: TOKEN }).ok === true, 'authorize: header token accepted');
  ok(evolution.authorizeWebhook({ query: { token: 'wrong' }, expectedToken: TOKEN }).reason === 'WEBHOOK_TOKEN_MISMATCH', 'authorize: mismatch refused');
  ok(evolution.authorizeWebhook({ query: q(), expectedToken: 'short' }).reason === 'WEBHOOK_TOKEN_NOT_CONFIGURED', 'authorize: a short expected token is "not configured"');
  ok(evolution.authorizeWebhook({ query: {}, expectedToken: TOKEN }).reason === 'WEBHOOK_TOKEN_MISSING', 'authorize: missing token refused');

  var p = evolution.parseWebhook(hook({ text: 'Bonjour, prix plaquettes Korando 2015' }));
  ok(p.accepted === true, 'parse: customer text accepted');
  var env = p.envelope;
  ok(envelope.validate(env).length === 0, 'parse: envelope valid');
  ok(env.crm.adapter === 'evolution' && env.crm.account_id === 'gateway' && env.crm.inbox_id === 'ssangyong-autos' && env.crm.conversation_id === CUSTOMER && env.crm.message_id === 'MSG0001' && env.crm.channel_type === 'Evolution::Instance', 'parse: crm references = gateway/instance/number/id');
  ok(env.customer.msisdn === CUSTOMER && env.customer.name === 'Client Test' && env.message.text.indexOf('Korando') !== -1 && env.message.content_type === 'text', 'parse: customer and message');
  ok(env.provider === 'evolution' && env.provider_class === 'unofficial', 'parse: provider recorded as unofficial');
  ok(env.event_id === envelope.eventId('evolution', 'MSG0001'), 'parse: event id deterministic per provider message id');
  ok(JSON.stringify(env).indexOf(BODY_APIKEY) === -1, 'parse: the apikey the gateway puts in the body is never copied');

  ok(evolution.parseWebhook(hook({ key: { fromMe: true } })).reason === 'OWN_MESSAGE', 'parse: fromMe refused (loop guard 1)');
  ok(evolution.parseWebhook(hook({ key: { remoteJid: '120363000000000000@g.us' } })).reason === 'GROUP_IGNORED', 'parse: group refused');
  ok(evolution.parseWebhook(hook({ key: { remoteJid: 'status@broadcast' } })).reason === 'STATUS_IGNORED', 'parse: status refused');
  ok(evolution.parseWebhook(hook({ event: 'connection.update' })).reason.indexOf('EVENT_IGNORED') === 0, 'parse: other events ignored');
  ok(evolution.parseWebhook(hook({ instance: '../etc' })).reason === 'INSTANCE_INVALID', 'parse: instance alphabet');
  ok(evolution.parseWebhook(hook({ key: { id: 'x y' } })).reason === 'MESSAGE_ID', 'parse: message id alphabet');
  ok(evolution.parseWebhook(hook({ key: { remoteJid: '123456789012345@lid' } })).reason === 'SENDER_UNRESOLVED', 'parse: lid without phone refused');
  ok(evolution.parseWebhook(hook({ key: { remoteJid: '123456789012345@lid', senderPn: CUSTOMER + '@s.whatsapp.net' } })).envelope.customer.msisdn === CUSTOMER, 'parse: lid resolved through senderPn');
  var selfBody = hook(); selfBody.sender = CUSTOMER + '@s.whatsapp.net';
  ok(evolution.parseWebhook(selfBody).reason === 'SELF_CHAT_IGNORED', 'parse: self chat refused');
  ok(evolution.parseWebhook('nope').reason === 'BODY_NOT_OBJECT' && evolution.parseWebhook(hook({ message: {} })).envelope.message.content_type === 'other', 'parse: junk body / unknown message type');
  var img = evolution.parseWebhook(hook({ message: { imageMessage: { caption: 'photo de la pièce' } } })).envelope;
  ok(img.message.content_type === 'attachment' && img.message.attachments === 1 && img.message.text === 'photo de la pièce', 'parse: media with caption');
  var eph = evolution.parseWebhook(hook({ message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'salut' } } } } })).envelope;
  ok(eph.message.text === 'salut', 'parse: ephemeral wrapper unwrapped');
  ok(evolution.providerConsistency('Evolution::Instance', 'evolution') === null && evolution.providerConsistency('Evolution::Instance', 'meta-cloud-api') === 'PROVIDER_NOT_EVOLUTION' && evolution.providerConsistency('Channel::Whatsapp', 'evolution') === 'CHANNEL_TYPE_UNSUPPORTED', 'provider consistency');
  var s = JSON.stringify(envelope.summary(env));
  ok(s.indexOf(CUSTOMER) === -1 && s.indexOf('***432') !== -1 && s.indexOf('Korando') === -1, 'summary: number masked in conversation_id too, no text');
})();

// ---------- 2. configuration (multi-project) ----------
(function () {
  var c = baseCfg();
  ok(projects.validate(c).length === 0, 'config: evolution example valid');
  var e = projects.engine(c);
  ok(e.mode === 'dry-run' && e.send_handoff_ack === false && e.ai.generator === 'template' && e.receiver.bind === '127.0.0.1', 'config: engine defaults are OFF/dry-run/template');
  ok(projects.engine({}).mode === 'dry-run' && projects.engine({ auto_reply: { mode: 'LIVE' } }).mode === 'dry-run' && projects.engine({ auto_reply: { mode: 'live' } }).mode === 'live', 'config: only the literal "live" turns live on');
  var r = baseCfg(function (x) { x.projects[0].crm.inbox_ids = ['mythos-bridge']; });
  ok(projects.validate(r).some(function (p) { return /CRM_INBOX_RESERVED:mythos-bridge/.test(p); }), 'config: the notification instance cannot be claimed by a project');
  r = baseCfg(function (x) { x.auto_reply.receiver.bind = '0.0.0.0'; });
  ok(projects.validate(r).indexOf('AUTO_REPLY_RECEIVER_BIND_NOT_PRIVATE') !== -1, 'config: public receiver bind refused');
  r = baseCfg(function (x) { x.auto_reply.ai.generator = 'advisory'; x.auto_reply.ai.base_url = 'https://api.example.com/v1'; });
  ok(projects.validate(r).indexOf('AUTO_REPLY_AI_BASE_URL_NOT_PRIVATE') !== -1, 'config: public AI base url refused');
  r = baseCfg(function (x) { x.auto_reply.mode = 'maybe'; });
  ok(projects.validate(r).indexOf('AUTO_REPLY_MODE') !== -1, 'config: unknown mode refused');
  r = baseCfg(function (x) { x.projects[0].business.vehicle_models = ['Actyon; drop']; });
  ok(projects.validate(r).some(function (p) { return /BUSINESS_VEHICLE_MODELS/.test(p); }), 'config: vehicle model alphabet');
  r = baseCfg(function (x) { x.projects[0].whatsapp.unofficial_acknowledged = false; });
  ok(projects.validate(r).length > 0, 'config: evolution project must acknowledge the unofficial transport');
  var d = projects.describe(c);
  ok(d.auto_reply && d.auto_reply.mode === 'dry-run' && d.auto_reply.ai.key_file_set === true && JSON.stringify(d).indexOf('advisory.env') === -1, 'describe: engine settings without paths');
  ok(projects.resolve(c, { account_id: 'gateway', inbox_id: 'piece-autos' }).id === 'piece.autos' && projects.resolve(c, { account_id: 'gateway', inbox_id: 'casse-autos' }).id === 'casse.autos' && projects.resolve(c, { account_id: 'gateway', inbox_id: 'mythos-bridge' }) === null, 'resolve: three projects on three instances, the notification instance routes nowhere');
  ok(projects.policy(c.projects[0]).handler === 'auto-reply' && projects.policy(c.projects[0]).auto_reply === false && projects.policy(c.projects[0]).vehicle_models.indexOf('Korando') !== -1, 'policy: auto-reply handler, auto_reply off, vocabulary');
})();

// ---------- 3. intents ----------
(function () {
  var o = { vehicle_models: ['Actyon', 'Korando', 'Rexton', 'Tivoli'], languages: ['fr', 'ar-TN', 'en'] };
  var c = function (t) { return intents.classify(t, o); };
  ok(c('Bonjour').intent === 'greeting' && c('Bonjour').language === 'fr', 'intent: greeting fr');
  ok(c('السلام عليكم').intent === 'greeting' && c('السلام عليكم').language === 'ar', 'intent: greeting ar');
  ok(c('Hello').intent === 'greeting' && c('Hello').language === 'en', 'intent: greeting en');
  var v = c("J'ai une Korando 2015");
  ok(v.intent === 'vehicle_identification' && v.entities.vehicle_model === 'Korando' && v.entities.vehicle_year === '2015', 'intent: vehicle identification + entities');
  var p = c('Je cherche des plaquettes de frein pour Actyon 2012');
  ok(p.intent === 'part_inquiry' && p.entities.parts.length >= 1 && p.entities.vehicle_model === 'Actyon', 'intent: part inquiry');
  ok(c('prix plaquettes de frein Actyon').intent === 'price_availability', 'intent: price + part');
  ok(c('شحال البطارية').intent === 'price_availability' && c('شحال البطارية').language === 'ar', 'intent: price ar');
  ok(c('b9adech filtre huile').intent === 'price_availability', 'intent: price arabizi');
  ok(c('où est ma commande ?').intent === 'order_status', 'intent: order status');
  ok(c('je veux parler à quelqu un').intent === 'human_request' && c('kalemni').intent === 'human_request' && c('call me please').intent === 'human_request', 'intent: human request fr/arabizi/en');
  ok(intents.classify('', { content_type: 'attachment', attachments: 1 }).intent === 'unsupported' && c('').intent === 'unsupported', 'intent: media without caption / empty → unsupported');
  ok(c('عندي مشكلة').intent === 'ambiguous' && c('xyz 123').intent === 'ambiguous', 'intent: unplaceable → ambiguous');
  var vin = c('VIN KPTA0B1ES9P123456 phare avant');
  ok(vin.entities.vin === 'KPTA0B1ES9P123456' && vin.intent === 'part_inquiry', 'intent: VIN extracted');
  ok(c('ref: 4841009000 dispo ?').entities.reference === '4841009000', 'intent: reference extracted');
  ok(JSON.stringify(c('Bonjour')).indexOf('undefined') === -1, 'intent: result serialisable');
})();

// ---------- 4. business data port ----------
var asyncPart = (async function () {
  ok(businessData.requiredFor('price_availability').join(',') === 'parts,price,stock' && businessData.requiredFor('greeting').length === 0 && businessData.requiredFor('order_status').join(',') === 'order', 'port: required kinds per intent');
  var g = await businessData.gather(businessData.none(), ['parts', 'price'], {}, {});
  ok(g.missing.join(',') === 'parts,price' && g.available.length === 0 && g.errors.parts === 'PORT_NOT_CONNECTED', 'port: nothing connected → everything missing');
  g = await businessData.gather({ parts: function () { return { ok: true, data: [{ ref: 'X' }] }; }, price: function () { throw new Error('boom'); }, stock: function () { return null; } }, ['parts', 'price', 'stock'], {}, {});
  ok(g.available.join(',') === 'parts' && g.missing.join(',') === 'price,stock' && g.errors.price === 'PORT_ERROR' && g.errors.stock === 'PORT_NO_DATA' && g.data.parts[0].ref === 'X', 'port: partial answers count as missing, throw is a name');
  g = await businessData.gather({ order: function () { return new Promise(function () {}); } }, ['order'], {}, {}, { timeoutMs: 20 });
  ok(g.missing.join(',') === 'order' && g.errors.order === 'PORT_TIMEOUT', 'port: timeout is missing');

  // ---------- 5. generation + fact guard ----------
  var inp = { intent: 'greeting', language: 'fr', entities: {}, facts: { available: [] }, business: { display_name: 'SsangYong Autos' } };
  var t = ai.template('greeting', inp);
  ok(/SsangYong Autos/.test(t) && /véhicule/.test(t), 'template: fr greeting with business name');
  ok(/مرحبا/.test(ai.template('greeting', Object.assign({}, inp, { language: 'ar' }))) && /welcome/.test(ai.template('greeting', Object.assign({}, inp, { language: 'en' }))), 'template: ar / en');
  ok(ai.template('vehicle_identification', inp) === null && /Korando 2015/.test(ai.template('vehicle_identification', Object.assign({}, inp, { entities: { vehicle_model: 'Korando', vehicle_year: '2015' } }))), 'template: vehicle echo only with a vehicle');
  ok(ai.factGuard('Bonjour, un conseiller vous répond', { available: [] }).ok === true, 'guard: neutral text passes');
  ok(ai.factGuard('Les plaquettes coûtent 120 DT', { available: [] }).violations[0].kind === 'price', 'guard: price claim without price fact');
  ok(ai.factGuard('Les plaquettes coûtent 120 DT', { available: ['price'] }).ok === true, 'guard: price claim with price fact');
  ok(ai.factGuard('Oui, en stock, livraison sous 2 jours', { available: [] }).violations.length >= 1, 'guard: stock / delivery claim');
  ok(ai.factGuard('Cette pièce est compatible avec votre Korando', { available: [] }).violations[0].kind === 'vehicle', 'guard: compatibility claim');
  ok(ai.factGuard('Votre commande a été expédiée', { available: [] }).violations[0].kind === 'order', 'guard: order status claim');
  ok(ai.factGuard('السعر هو 300 دينار', { available: [] }).violations[0].kind === 'price', 'guard: arabic price claim');
  var gen = await ai.generate(Object.assign({}, inp, { ai: { generator: 'template' } }));
  ok(gen.generator === 'template' && gen.text === t, 'generate: template generator');
  // advisory generator through a fake provider: a hallucinated price is caught
  var fake = { run: function () { return Promise.resolve({ parsed: { is_error: false, result: 'Bonjour! Les plaquettes coûtent 120 DT, en stock.' } }); } };
  gen = await ai.generate(Object.assign({}, inp, { intent: 'part_inquiry', entities: { parts: ['plaquettes'] }, ai: { generator: 'advisory', base_url: 'http://127.0.0.1:1', key_file: '/tmp/none' } }), { provider: fake });
  ok(gen.generator === 'template' && gen.ai_reason === 'AI_FACT_GUARD' && gen.text.indexOf('120') === -1, 'generate: AI text with an invented price is replaced by the template');
  var seenPrompt = null;
  var fake2 = { run: function (task, prompt) { seenPrompt = prompt; return Promise.resolve({ parsed: { is_error: false, result: 'Bonjour, merci pour votre message. Un conseiller confirme la disponibilité rapidement.' } }); } };
  gen = await ai.generate(Object.assign({}, inp, { customer_text: 'SECRET-CUSTOMER-TEXT plaquettes', ai: { generator: 'advisory', base_url: 'http://127.0.0.1:1', key_file: '/tmp/none', share_customer_text: false } }), { provider: fake2 });
  ok(gen.generator === 'advisory' && seenPrompt.indexOf('SECRET-CUSTOMER-TEXT') === -1, 'generate: AI reply accepted when neutral; customer text not shared by default');
  gen = await ai.generate(Object.assign({}, inp, { ai: { generator: 'advisory', base_url: 'http://127.0.0.1:1', key_file: '/tmp/none' } }), { provider: { run: function () { return Promise.resolve({ parsed: { is_error: true, result: 'HTTP 503' } }); } } });
  ok(gen.generator === 'template' && gen.ai_reason === 'AI_ERROR', 'generate: AI failure falls back to template');
  gen = await ai.generate(Object.assign({}, inp, { ai: { generator: 'advisory' } }));
  ok(gen.generator === 'template' && gen.ai_reason === 'AI_NOT_CONFIGURED', 'generate: advisory without base_url/key_file never calls out');
  ok(/NEVER state or imply a price/.test(ai.SYSTEM_PROMPT), 'generate: the system prompt forbids invented business facts');

  // ---------- 6. handler ----------
  var cfg = baseCfg();
  var pr = cfg.projects[0];
  var ctx = { project: pr, policy: projects.policy(pr), engine: projects.engine(cfg) };
  var envOf = function (text, over) { return evolution.parseWebhook(hook(Object.assign({ text: text }, over || {}))).envelope; };
  var d = await autoReply.handler(envOf('Bonjour'), ctx);
  ok(d.action === 'reply' && d.intent === 'greeting' && d.reason === 'NO_FACT_REQUIRED' && /SsangYong Autos/.test(d.reply_text) && d.facts.required.length === 0, 'handler: greeting → template reply');
  d = await autoReply.handler(envOf('J ai une Rexton 2018'), ctx);
  ok(d.action === 'reply' && d.intent === 'vehicle_identification' && /Rexton 2018/.test(d.reply_text), 'handler: vehicle → echo + ask for part');
  d = await autoReply.handler(envOf('prix plaquettes frein Actyon 2012'), ctx);
  ok(d.action === 'handoff' && d.reason === 'BUSINESS_DATA_UNAVAILABLE' && d.requires_human === true && d.facts.missing.join(',') === 'parts,price,stock' && !d.reply_text, 'handler: price without data → handoff, no text, no invented price');
  d = await autoReply.handler(envOf('où est ma commande'), ctx);
  ok(d.action === 'handoff' && d.reason === 'BUSINESS_DATA_UNAVAILABLE' && d.facts.missing.join(',') === 'order', 'handler: order status without data → handoff');
  d = await autoReply.handler(envOf('je veux un conseiller'), ctx);
  ok(d.action === 'handoff' && d.reason === 'REQUIRES_HUMAN' && d.requires_human === true, 'handler: human request → handoff');
  d = await autoReply.handler(envOf('', { message: { audioMessage: {} } }), ctx);
  ok(d.action === 'handoff' && d.reason === 'CONTENT_UNSUPPORTED', 'handler: voice note → handoff');
  d = await autoReply.handler(envOf('عندي مشكلة'), ctx);
  ok(d.action === 'reply' && d.intent === 'ambiguous' && /الكرهبة/.test(d.reply_text), 'handler: ambiguous → ask for details in Arabic');
  var ackCtx = Object.assign({}, ctx, { engine: Object.assign({}, ctx.engine, { send_handoff_ack: true }) });
  d = await autoReply.handler(envOf('prix plaquettes frein Actyon 2012'), ackCtx);
  ok(d.action === 'reply' && d.reason === 'BUSINESS_DATA_UNAVAILABLE_ACK' && d.requires_human === true && /plaquettes/.test(d.reply_text) && ai.factGuard(d.reply_text, { available: [] }).ok, 'handler: with send_handoff_ack the ack echoes the request and claims nothing');
  // connected port → the reply may carry the verified fact
  var ports = { parts: function () { return { ok: true, data: [{ ref: '4841009000', label: 'plaquettes avant' }] }; }, price: function () { return { ok: true, data: { amount: 120, currency: 'TND' } }; }, stock: function () { return { ok: true, data: { available: true } }; } };
  d = await autoReply.handler(envOf('prix plaquettes frein Actyon 2012'), Object.assign({}, ctx, { business_data: ports }));
  ok(d.action === 'reply' && d.reason === 'FACTS_AVAILABLE' && d.facts.available.join(',') === 'parts,price,stock' && d.facts.missing.length === 0, 'handler: with every fact connected the reply is allowed');
  // a routed decision carries names only
  var rr = await router.route(envOf('prix plaquettes frein Actyon 2012'), cfg);
  ok(rr.outcome === 'ROUTED' && rr.decision.action === 'handoff' && rr.decision.facts.missing.length === 3 && rr.decision.requires_human === true && rr.reply.allowed === false, 'router: built-in auto-reply handler, facts as names, reply not allowed');
  ok(Object.keys(router.BUILTIN_HANDLERS).join(',') === 'handoff,auto-reply', 'router: handlers');

  // ---------- 7. ledger ----------
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-reply-test-'));
  [ledgerLib.open({ memory: true }), ledgerLib.open({ dir: path.join(tmp, 'state') })].forEach(function (L) {
    var k = L.kind;
    ok(L.claim('cm-abc123').ok === true && L.claim('cm-abc123').reason === 'DUPLICATE_INBOUND', 'ledger ' + k + ': second claim of the same event is a duplicate');
    ok(L.claim('../evil').reason === 'EVENT_ID_INVALID', 'ledger ' + k + ': event id alphabet');
    ok(L.update('cm-abc123', { state: 'SENT' }).state === 'SENT' && L.get('cm-abc123').state === 'SENT', 'ledger ' + k + ': state update');
    var threw = false; try { L.update('cm-abc123', { state: 'WHATEVER' }); } catch (e) { threw = true; }
    ok(threw, 'ledger ' + k + ': unknown state refused');
    L.recordOutbound('evolution', 'OUT-1', 'cm-abc123');
    ok(L.isOwnOutbound('evolution', 'OUT-1') === true && L.isOwnOutbound('evolution', 'OUT-2') === false && L.isOwnOutbound('chatwoot', 'OUT-1') === false, 'ledger ' + k + ': own outbound ids');
    var now = Date.now();
    ok(L.countReplies('conv', ledgerLib.HOUR_MS, now) === 0, 'ledger ' + k + ': no replies yet');
    L.recordReply('conv', now - 10); L.recordReply('conv', now - 2 * ledgerLib.HOUR_MS);
    ok(L.countReplies('conv', ledgerLib.HOUR_MS, now) === 1, 'ledger ' + k + ': hourly window');
    ok(L.provider().open_until === 0, 'ledger ' + k + ': breaker closed');
    L.recordProviderFailure('HTTP 500', 2, 60000, now); var b = L.recordProviderFailure('HTTP 500', 2, 60000, now);
    ok(b.failures === 2 && b.open_until > now, 'ledger ' + k + ': breaker opens at the threshold');
    ok(L.recordProviderSuccess().open_until === 0, 'ledger ' + k + ': success closes the breaker');
  });
  var names = fs.readdirSync(path.join(tmp, 'state', 'conversations')).concat(fs.readdirSync(path.join(tmp, 'state', 'outbound')));
  ok(names.every(function (n) { return /^[0-9a-f]{32}(\.json)?$/.test(n); }), 'ledger file: no customer data in file names');

  // ---------- 8. policy ----------
  var routedReply = await router.route(envOf('Bonjour'), cfg);
  var live = Object.assign({}, projects.engine(cfg), { mode: 'live' });
  var onPol = Object.assign({}, projects.policy(pr), { auto_reply: true });
  var provOk = { configured: true, credential_present: true, breaker: { open_until: 0 } };
  var ev = policy.evaluate({ routed: routedReply, engine: live, policy: onPol, provider: provOk, replies_last_hour: 0 });
  ok(ev.allowed === true && ev.rejections.length === 0 && ev.proposed.recipient_masked === '***432' && ev.proposed.text === routedReply.decision.reply_text, 'policy: everything on → allowed, exact text, masked recipient');
  ev = policy.evaluate({ routed: routedReply, engine: projects.engine(cfg), policy: projects.policy(pr), provider: { configured: true, credential_present: false, breaker: {} }, replies_last_hour: 0 });
  ok(ev.allowed === false && ev.rejections.indexOf('AUTO_REPLY_DISABLED') !== -1 && ev.rejections.indexOf('MODE_DRY_RUN') !== -1 && ev.rejections.indexOf('CREDENTIAL_MISSING') !== -1 && ev.proposed && ev.proposed.text, 'policy: defaults → disabled + dry-run + credential, text still proposed');
  var routedHandoff = await router.route(envOf('prix plaquettes Actyon'), cfg);
  ev = policy.evaluate({ routed: routedHandoff, engine: live, policy: onPol, provider: provOk, replies_last_hour: 0 });
  ok(ev.allowed === false && ev.rejections.indexOf('DECISION_NOT_REPLY') !== -1 && ev.rejections.indexOf('REQUIRES_HUMAN') !== -1 && ev.rejections.indexOf('BUSINESS_DATA_MISSING') !== -1 && ev.proposed === null, 'policy: handoff → not reply + requires human + business data missing');
  ev = policy.evaluate({ routed: routedReply, engine: live, policy: onPol, provider: { configured: false, credential_present: true, breaker: { open_until: Date.now() + 1000 } }, replies_last_hour: 0 });
  ok(ev.rejections.indexOf('PROVIDER_NOT_CONFIGURED') !== -1 && ev.rejections.indexOf('PROVIDER_UNAVAILABLE') !== -1, 'policy: provider not configured / breaker open');
  ev = policy.evaluate({ routed: routedReply, engine: live, policy: onPol, provider: provOk, replies_last_hour: 6 });
  ok(ev.rejections.join(',') === 'REPLY_RATE_EXCEEDED', 'policy: hourly cap');
  var badRecipient = clone(routedReply); badRecipient.envelope.crm.conversation_id = 'not-a-number';
  ok(policy.evaluate({ routed: badRecipient, engine: live, policy: onPol, provider: provOk, replies_last_hour: 0 }).rejections.join(',') === 'RECIPIENT_INVALID', 'policy: invalid recipient');
  var invented = clone(routedReply); invented.decision.reply_text = 'Oui, en stock, 120 DT';
  ok(policy.evaluate({ routed: invented, engine: live, policy: onPol, provider: provOk, replies_last_hour: 0 }).rejections.join(',') === 'FACT_GUARD_VIOLATION', 'policy: the send gate re-checks invented facts');
  ok(policy.evaluate({ routed: null, engine: live, policy: onPol, provider: provOk }).rejections.indexOf('NOT_ROUTED') !== -1, 'policy: not routed');

  // ---------- 9. engine: dry-run, duplicates, loops, secrets ----------
  var L = ledgerLib.open({ memory: true });
  var run = function (over, extra) { return engine.process(Object.assign({ cfg: cfg, body: hook(over), query: q(), expectedToken: TOKEN, ledger: L }, extra || {})); };
  var rec = await run({ id: 'E1', text: 'Bonjour' });
  ok(rec.outcome === 'DECIDED' && rec.sent === false && rec.mode === 'dry-run' && rec.policy.rejections.indexOf('AUTO_REPLY_DISABLED') !== -1 && rec.proposed.text.indexOf('SsangYong Autos') !== -1 && rec.ledger_state === 'SUPPRESSED', 'engine: dry-run produces the exact proposed message and sends nothing');
  var recS = JSON.stringify(rec);
  ok(recS.indexOf(BODY_APIKEY) === -1 && recS.indexOf(TOKEN) === -1 && recS.indexOf(CUSTOMER) === -1 && recS.indexOf('Client Test') === -1, 'engine: record carries no body apikey, no webhook token, no full number, no name');
  rec = await run({ id: 'E1', text: 'Bonjour' });
  ok(rec.outcome === 'IGNORED' && rec.reason === 'DUPLICATE_INBOUND', 'engine: duplicate inbound (provider retry) ignored');
  rec = await run({ id: 'E2', text: 'Bonjour', key: { fromMe: true } });
  ok(rec.outcome === 'IGNORED' && rec.reason === 'OWN_MESSAGE', 'engine: own message ignored');
  L.recordOutbound('evolution', 'OUT-99', 'cm-x');
  rec = await run({ id: 'OUT-99', text: 'Bonjour' });
  ok(rec.outcome === 'IGNORED' && rec.reason === 'ECHO_OF_OWN_OUTBOUND', 'engine: an inbound with our own outbound id is an echo');
  rec = await run({ id: 'E3', text: 'Bonjour' }, { query: { token: 'nope' } });
  ok(rec.outcome === 'UNAUTHORIZED' && rec.event_id === null, 'engine: unauthorized before parsing');
  rec = await run({ id: 'E4', text: 'Bonjour', instance: 'mythos-bridge' });
  ok(rec.outcome === 'UNROUTED' && rec.reason === 'NO_PROJECT_FOR_INBOX' && rec.sent === false, 'engine: a message on the notification instance routes nowhere (separation)');
  rec = await run({ id: 'E5', text: 'prix plaquettes Actyon' });
  ok(rec.outcome === 'DECIDED' && rec.decision.action === 'handoff' && rec.proposed === null && rec.policy.rejections.indexOf('BUSINESS_DATA_MISSING') !== -1, 'engine: missing business data → handoff, nothing proposed');
  rec = await run({ id: 'E6', text: 'je veux parler à un responsable' });
  ok(rec.decision.reason === 'REQUIRES_HUMAN' && rec.policy.rejections.indexOf('REQUIRES_HUMAN') !== -1, 'engine: human handoff');
  rec = await run({ id: 'E7', text: 'Bonjour', instance: 'piece-autos' });
  ok(rec.project_id === 'piece.autos' && rec.decision.reason === 'NO_BUSINESS_ENGINE', 'engine: second project on its own instance keeps the handoff handler');
  // forceDryRun beats a live config
  var liveCfg = baseCfg(function (x) { x.auto_reply.mode = 'live'; x.projects[0].business.auto_reply = true; });
  rec = await engine.process({ cfg: liveCfg, body: hook({ id: 'E8', text: 'Bonjour' }), query: q(), expectedToken: TOKEN, ledger: L, apiToken: API_KEY, forceDryRun: true });
  ok(rec.mode === 'dry-run' && rec.sent === false && rec.policy.rejections.join(',') === 'MODE_DRY_RUN', 'engine: forceDryRun overrides a live configuration; the only gate left is the mode');

  // ---------- 10. engine: live against a loopback stub (never a real gateway) ----------
  var requests = [];
  var stubMode = 'ok';
  var stub = http.createServer(function (req, res) {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      requests.push({ url: req.url, apikey: req.headers.apikey, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      if (stubMode === 'fail') { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"status":500,"error":"Internal Server Error"}'); }
      if (stubMode === 'hang') return;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ key: { remoteJid: CUSTOMER + '@s.whatsapp.net', fromMe: true, id: 'SENT-' + requests.length }, status: 'PENDING' }));
    });
  });
  await new Promise(function (r) { stub.listen(0, '127.0.0.1', r); });
  var liveCfgStub = clone(liveCfg); liveCfgStub.crm.base_url = 'http://127.0.0.1:' + stub.address().port;
  var L2 = ledgerLib.open({ dir: path.join(tmp, 'live') });
  var runLive = function (over, extra) { return engine.process(Object.assign({ cfg: liveCfgStub, body: hook(over), query: q(), expectedToken: TOKEN, ledger: L2, apiToken: API_KEY, timeoutMs: 500 }, extra || {})); };
  rec = await runLive({ id: 'L1', text: 'Bonjour' });
  ok(rec.outcome === 'SENT' && rec.sent === true && rec.send.crm_message_id === 'SENT-1' && rec.ledger_state === 'SENT' && requests.length === 1, 'engine live: reply sent through the adapter');
  ok(requests[0].url === '/message/sendText/ssangyong-autos' && requests[0].apikey === API_KEY && requests[0].body.number === CUSTOMER && requests[0].body.text === rec.proposed.text, 'engine live: Evolution sendText on the customer instance with the proposed text');
  ok(JSON.stringify(rec).indexOf(API_KEY) === -1, 'engine live: the apikey never appears in the record');
  rec = await runLive({ id: 'L1', text: 'Bonjour' });
  ok(rec.outcome === 'IGNORED' && rec.reason === 'DUPLICATE_INBOUND' && requests.length === 1, 'engine live: provider retry of a sent message sends nothing');
  rec = await runLive({ id: 'SENT-1', text: 'Bonjour', key: { fromMe: false } });
  ok(rec.outcome === 'IGNORED' && rec.reason === 'ECHO_OF_OWN_OUTBOUND' && requests.length === 1, 'engine live: our own sent id coming back (even without fromMe) is not replied to');
  rec = await runLive({ id: 'L2', text: 'prix plaquettes Actyon' });
  ok(rec.outcome === 'DECIDED' && rec.sent === false && requests.length === 1, 'engine live: no data → no send');
  rec = await runLive({ id: 'L3', text: 'Bonjour' }, { apiToken: null });
  ok(rec.outcome === 'DECIDED' && rec.policy.rejections.join(',') === 'CREDENTIAL_MISSING' && requests.length === 1, 'engine live: missing provider credential → no send');
  // hourly cap
  for (var i = 0; i < 5; i++) await runLive({ id: 'CAP' + i, text: 'Bonjour' });
  ok(requests.length === 6, 'engine live: five more greetings sent (cap is 6)');
  rec = await runLive({ id: 'CAP9', text: 'Bonjour' });
  ok(rec.outcome === 'DECIDED' && rec.policy.rejections.join(',') === 'REPLY_RATE_EXCEEDED' && requests.length === 6, 'engine live: seventh reply in the hour refused');
  // provider failure → SEND_FAILED, never auto-resent, breaker after threshold
  var L3 = ledgerLib.open({ memory: true });
  var runFail = function (id) { return engine.process({ cfg: liveCfgStub, body: hook({ id: id, text: 'Bonjour' }), query: q(), expectedToken: TOKEN, ledger: L3, apiToken: API_KEY, timeoutMs: 300 }); };
  stubMode = 'fail';
  rec = await runFail('F1');
  ok(rec.outcome === 'SEND_FAILED' && rec.sent === false && rec.ledger_state === 'SEND_FAILED' && /HTTP 500/.test(rec.send.error), 'engine live: provider 500 → SEND_FAILED recorded');
  rec = await runFail('F1');
  ok(rec.outcome === 'IGNORED' && rec.reason === 'DUPLICATE_INBOUND', 'engine live: a failed send is never retried by a replayed webhook');
  stubMode = 'hang';
  rec = await runFail('F2');
  ok(rec.outcome === 'SEND_FAILED' && /TRANSPORT/.test(rec.send.error), 'engine live: provider timeout → SEND_FAILED');
  stubMode = 'fail';
  rec = await runFail('F3');
  ok(rec.outcome === 'SEND_FAILED' && rec.provider_breaker.open === true, 'engine live: third failure opens the breaker');
  stubMode = 'ok';
  var before = requests.length;
  rec = await runFail('F4');
  ok(rec.outcome === 'DECIDED' && rec.policy.rejections.join(',') === 'PROVIDER_UNAVAILABLE' && requests.length === before, 'engine live: breaker open → PROVIDER_UNAVAILABLE, no request');
  // gateway down entirely
  var downCfg = clone(liveCfg); downCfg.crm.base_url = 'http://127.0.0.1:1';
  rec = await engine.process({ cfg: downCfg, body: hook({ id: 'D1', text: 'Bonjour' }), query: q(), expectedToken: TOKEN, ledger: ledgerLib.open({ memory: true }), apiToken: API_KEY, timeoutMs: 300 });
  ok(rec.outcome === 'SEND_FAILED' && /TRANSPORT/.test(rec.send.error) && JSON.stringify(rec).indexOf(API_KEY) === -1, 'engine live: gateway unreachable → SEND_FAILED, no secret in the record');
  // public gateway host refused by the adapter fence even in live mode
  var pubCfg = clone(liveCfg); pubCfg.crm.base_url = 'http://203.0.113.10:8080';
  ok(projects.validate(pubCfg).indexOf('CRM_BASE_URL_NOT_PRIVATE') !== -1, 'engine live: public gateway host refused by configuration');
  var sr = await evolution.sendReply({ baseUrl: 'http://203.0.113.10:8080', accountId: 'gateway', inboxId: 'x', conversationId: CUSTOMER, apiToken: API_KEY, text: 'hi' });
  ok(sr.ok === false && /not private/.test(sr.error), 'sendReply: public host refused by the adapter itself');
  sr = await evolution.sendReply({ baseUrl: liveCfgStub.crm.base_url, accountId: 'gateway', inboxId: 'mythos-bridge/../x', conversationId: CUSTOMER, apiToken: API_KEY, text: 'hi' });
  ok(sr.ok === false && /instance/.test(sr.error), 'sendReply: instance alphabet enforced at egress');
  stub.close();

  // ---------- 11. receiver (loopback) ----------
  var tokFile = path.join(tmp, 'hook.token'); fs.writeFileSync(tokFile, TOKEN + '\n', { mode: 0o600 });
  var rcvCfg = baseCfg(function (x) { x.crm.webhook_token_file = tokFile; x.auto_reply.state_dir = path.join(tmp, 'rcv-state'); });
  var rcvCfgFile = path.join(tmp, 'rcv.json'); fs.writeFileSync(rcvCfgFile, JSON.stringify(rcvCfg));
  var RCV = path.join(COMMS, 'bin/mythos-auto-reply-receiver');
  var rport = 18790 + Math.floor(Math.random() * 1000);
  var child = spawn('node', [RCV, rcvCfgFile, '--dry-run', '--port', String(rport)], { stdio: ['ignore', 'pipe', 'pipe'] });
  var rcvOut = '';
  child.stdout.on('data', function (d) { rcvOut += d; });
  child.stderr.on('data', function (d) { rcvOut += d; });
  await new Promise(function (resolve) { var t = setInterval(function () { if (/listening/.test(rcvOut)) { clearInterval(t); resolve(); } }, 30); setTimeout(function () { clearInterval(t); resolve(); }, 5000); });
  function post(p, body, headers) {
    return new Promise(function (resolve) {
      var data = typeof body === 'string' ? body : JSON.stringify(body);
      var req = http.request({ host: '127.0.0.1', port: rport, path: p, method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers || {}) }, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: b }); }); });
      req.on('error', function () { resolve({ status: 0, body: '' }); });
      req.end(data);
    });
  }
  function get(p) { return new Promise(function (resolve) { http.get({ host: '127.0.0.1', port: rport, path: p }, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: b }); }); }).on('error', function () { resolve({ status: 0, body: '' }); }); }); }
  var h = await get('/healthz');
  ok(h.status === 200 && JSON.parse(h.body).mode === 'dry-run' && JSON.parse(h.body).can_send === false && h.body.indexOf(TOKEN) === -1, 'receiver: healthz reports dry-run, cannot send, no secret');
  var w = await post('/webhook/evolution?token=' + TOKEN, hook({ id: 'R1', text: 'Bonjour' }));
  ok(w.status === 200 && JSON.parse(w.body).outcome === 'DECIDED' && JSON.parse(w.body).sent === false && w.body.indexOf('Bonjour') === -1, 'receiver: webhook accepted, outcome names only, nothing sent');
  w = await post('/webhook/evolution?token=' + TOKEN, hook({ id: 'R1', text: 'Bonjour' }));
  ok(w.status === 200 && JSON.parse(w.body).reason === 'DUPLICATE_INBOUND', 'receiver: replayed webhook is a duplicate (file ledger)');
  w = await post('/webhook/evolution?token=wrong', hook({ id: 'R2' }));
  ok(w.status === 401, 'receiver: wrong token → 401');
  w = await post('/webhook/evolution?token=' + TOKEN, '{not json');
  ok(w.status === 400, 'receiver: bad JSON → 400');
  w = await post('/webhook/evolution?token=' + TOKEN, JSON.stringify({ pad: 'x'.repeat(300000) }));
  ok(w.status === 413 || w.status === 0, 'receiver: oversized body refused');
  w = await post('/other', {});
  ok(w.status === 404, 'receiver: unknown path → 404');
  child.kill('SIGTERM');
  await new Promise(function (r) { child.on('exit', r); setTimeout(r, 2000); });
  ok(rcvOut.indexOf(TOKEN) === -1 && rcvOut.indexOf(BODY_APIKEY) === -1 && rcvOut.indexOf(CUSTOMER) === -1 && rcvOut.indexOf('Client Test') === -1, 'receiver: log lines carry no token, no apikey, no number, no name');
  ok(fs.existsSync(path.join(tmp, 'rcv-state', 'events')), 'receiver: file ledger created under state_dir');

  // ---------- 12. CLI ----------
  var CLI = path.join(COMMS, 'bin/mythos-auto-comms');
  function cli(args) { return new Promise(function (resolve) { execFile('node', [CLI].concat(args), { timeout: 20000 }, function (err, so, se) { resolve({ code: err ? err.code : 0, out: so, err: se }); }); }); }
  var cfgFile = path.join(tmp, 'cfg.json'); fs.writeFileSync(cfgFile, JSON.stringify(rcvCfg));
  var hookFile = path.join(tmp, 'hook.json'); fs.writeFileSync(hookFile, JSON.stringify(hook({ id: 'C1', text: 'Bonjour, prix plaquettes Korando 2015' })));
  var r = await cli(['config-check', cfgFile]);
  ok(r.code === 0 && JSON.parse(r.out).problems.length === 0 && JSON.parse(r.out).auto_reply.mode === 'dry-run', 'cli: config-check on the evolution example');
  r = await cli(['simulate', cfgFile, hookFile]);
  var sim = r.code === 0 ? JSON.parse(r.out) : null;
  ok(sim && sim.outcome === 'DECIDED' && sim.sent === false && sim.decision.action === 'handoff' && sim.decision.intent === 'price_availability' && sim.token_file === 'ok', 'cli: simulate runs the engine in dry-run and sends nothing');
  ok(r.out.indexOf(TOKEN) === -1 && r.out.indexOf(BODY_APIKEY) === -1 && r.out.indexOf(CUSTOMER) === -1 && r.out.indexOf('Korando 2015') === -1, 'cli: simulate output carries no token, no apikey, no number, no customer text');
  fs.writeFileSync(hookFile, JSON.stringify(hook({ id: 'C2', text: 'Bonjour' })));
  r = await cli(['simulate', cfgFile, hookFile]);
  sim = r.code === 0 ? JSON.parse(r.out) : null;
  ok(sim && sim.proposed && /SsangYong Autos/.test(sim.proposed.text) && sim.proposed.recipient_masked === '***432' && sim.policy.rejections.indexOf('MODE_DRY_RUN') !== -1, 'cli: simulate shows the exact proposed message and the gates');
  r = await cli(['classify', cfgFile, 'ssangyong.autos', 'شحال فلتر الزيت Tivoli 2019']);
  var cl = r.code === 0 ? JSON.parse(r.out) : null;
  ok(cl && cl.intent === 'price_availability' && cl.language === 'ar' && cl.entities.vehicle_model === 'Tivoli' && cl.facts_required.join(',') === 'parts,price,stock', 'cli: classify');
  r = await cli(['readiness', cfgFile]);
  var rd = r.code === 0 ? JSON.parse(r.out) : null;
  ok(rd && rd.can_send === false && rd.webhook_token === 'present' && rd.api_token === 'FILE_UNREADABLE' && rd.projects_auto_reply_on.length === 0 && r.out.indexOf(TOKEN) === -1, 'cli: readiness reports presence only');
  r = await cli(['describe']);
  ok(r.code === 0 && JSON.parse(r.out).crm_adapters.evolution.id === 'evolution' && JSON.parse(r.out).handlers.join(',') === 'handoff,auto-reply', 'cli: describe lists the evolution adapter and the auto-reply handler');

  // ---------- 13. secret redaction ----------
  var poisoned = hook({ id: 'S1', text: 'mon token: Bearer abcdefghijklmnopqrstuvwxyz0123456789 et apikey=' + BODY_APIKEY });
  rec = await engine.process({ cfg: cfg, body: poisoned, query: q(), expectedToken: TOKEN, ledger: ledgerLib.open({ memory: true }) });
  var rs = JSON.stringify(rec);
  ok(rs.indexOf('abcdefghijklmnopqrstuvwxyz0123456789') === -1 && rs.indexOf(BODY_APIKEY) === -1, 'redaction: credential-shaped customer text never reaches the record');
  ok(redact.findSecretKinds(fs.readFileSync(path.join(COMMS, 'config/comms.evolution.example.json'), 'utf8')).length === 0, 'redaction: the evolution example carries no credential value');

  // ---------- 14. separation from the operational notification layer ----------
  var files = ['lib/envelope.js', 'lib/projects.js', 'lib/crm/index.js', 'lib/crm/chatwoot.js', 'lib/crm/evolution.js', 'lib/router.js', 'lib/intents.js', 'lib/business-data.js', 'lib/ai/index.js', 'lib/handlers/auto-reply.js', 'lib/ledger.js', 'lib/policy.js', 'lib/engine.js', 'bin/mythos-auto-comms', 'bin/mythos-auto-reply-receiver'];
  var src = files.map(function (f) { return fs.readFileSync(path.join(COMMS, f), 'utf8'); }).join('\n');
  ok(src.indexOf('providers/evolution') === -1 && src.indexOf('providers/generic') === -1 && src.indexOf('.sendText(') === -1, 'separation: the auto-reply layer never requires the notification providers');
  ok(src.indexOf('MYTHOS_BRIDGE_WHATSAPP') === -1 && src.indexOf('onReport') === -1 && src.indexOf('flush(') === -1, 'separation: no notification setting, no notification ledger');
  ok(/isPrivateHost/.test(src) && !/whatsapp'\)\.(send|notify|report)/.test(src), 'separation: the only thing borrowed from bridge/notify is the private-host fence and the JSON poster');
  var notifyDir = path.join(ROOT, 'projects/mythos-ai-executor/bridge/notify');
  var notifySrc = ['whatsapp.js', 'http-json.js', 'providers/evolution.js', 'providers/generic.js'].map(function (f) { return fs.readFileSync(path.join(notifyDir, f), 'utf8'); }).join('\n');
  ok(notifySrc.indexOf('automotive/comms') === -1 && notifySrc.indexOf('auto-reply') === -1 && notifySrc.indexOf('ssangyong-autos') === -1, 'separation: the notification layer knows nothing about the auto-reply engine');
  ok(/grow inbound handling, chat sessions, templates or customer messaging/.test(notifySrc), 'separation: the notification scope fence is still declared');
  ok(EXAMPLE.crm.reserved_inbox_ids.indexOf('mythos-bridge') !== -1 && EXAMPLE.projects.every(function (p) { return p.crm.inbox_ids.indexOf('mythos-bridge') === -1; }), 'separation: the example reserves the notification instance');
  ok(EXAMPLE.projects.every(function (p) { return p.business.auto_reply === false; }) && EXAMPLE.auto_reply.mode === 'dry-run' && EXAMPLE.auto_reply.send_handoff_ack === false, 'defaults: example ships with every send switch off');
  ok(!/\bsudo\b|docker\.sock|child_process/.test(src), 'no privilege or shell surface in the auto-reply layer');

  fs.rmSync(tmp, { recursive: true, force: true });
})();

asyncPart.then(function () {
  console.log('mythos auto reply tests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (e) {
  console.error(e);
  process.exit(1);
});
