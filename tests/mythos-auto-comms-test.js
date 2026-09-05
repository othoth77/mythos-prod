'use strict';
// =====================================================
// MYTHOS AUTO customer communication layer — tests
// tests/mythos-auto-comms-test.js
//
// Covers projects/automotive/comms/: the provider-independent envelope, the
// multi-project configuration model, the Chatwoot adapter (webhook parsing,
// webhook authorisation, reply egress against a loopback stub), the router
// with its business-handler boundary and reply policy, the CLI, and the
// separation guarantees against the operational notification layer.
// No network beyond 127.0.0.1, no real CRM, no WhatsApp.
//
//   node tests/mythos-auto-comms-test.js
// =====================================================

var http = require('http');
var fs = require('fs');
var os = require('os');
var path = require('path');
var execFile = require('child_process').execFile;

var ROOT = path.resolve(__dirname, '..');
var COMMS = path.join(ROOT, 'projects/automotive/comms');
var envelope = require(path.join(COMMS, 'lib/envelope'));
var projects = require(path.join(COMMS, 'lib/projects'));
var crm = require(path.join(COMMS, 'lib/crm'));
var chatwoot = require(path.join(COMMS, 'lib/crm/chatwoot'));
var router = require(path.join(COMMS, 'lib/router'));
var redact = require(path.join(ROOT, 'projects/mythos-orchestrator/lib/redact'));

var passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.error('FAIL: ' + name); } }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

var EXAMPLE = JSON.parse(fs.readFileSync(path.join(COMMS, 'config/comms.example.json'), 'utf8'));
var TOKEN = 'test-token-not-a-real-credential-0123456789abcdef';
var API_TOKEN = 'test-api-token-not-real-fedcba9876543210';

// A Chatwoot `message_created` delivery, shaped after message.rb#webhook_data
// and the conversation event presenter (verified 2026-09-05).
function webhookFixture(over) {
  var body = {
    event: 'message_created',
    id: 9101,
    content: 'عندي Korando 2020 نحب filtre huile',
    content_type: 'text',
    content_attributes: {},
    message_type: 'incoming',
    private: false,
    source_id: 'wamid.HBgLMjE2MjAwMDAwMDAVAgARGBI3QjQ5RjA4RjQ3REJFQjYyQjEA',
    created_at: '2026-09-05T01:20:00.000Z',
    sender: { id: 77, name: 'Client Test', phone_number: '+216 20 000 123', type: 'contact' },
    account: { id: 1, name: 'MYTHOS AUTO' },
    inbox: { id: 1, name: 'SsangYong WhatsApp' },
    conversation: { id: 42, inbox_id: 1, status: 'open', channel: 'Channel::Whatsapp', contact_inbox: { source_id: '21620000123' }, messages: [] }
  };
  return Object.assign(body, over || {});
}

// ---------- 1. envelope ----------
(function () {
  ok(envelope.normalizeMsisdn('+216 20 000 123') === '21620000123', 'msisdn: spaces and plus stripped');
  ok(envelope.normalizeMsisdn('21620000123@s.whatsapp.net') === '21620000123', 'msisdn: JID reduced to digits');
  ok(envelope.normalizeMsisdn('abc') === null && envelope.normalizeMsisdn(12) === null, 'msisdn: junk → null');
  ok(envelope.eventId('chatwoot', 9101) === envelope.eventId('chatwoot', '9101'), 'event id: deterministic per (adapter, id)');
  ok(envelope.eventId('chatwoot', 1) !== envelope.eventId('other', 1), 'event id: adapter-scoped');
  ok(envelope.providerClass('meta-cloud-api') === 'official' && envelope.providerClass('evolution') === 'unofficial' && envelope.providerClass('nope') === 'unknown', 'provider class table');

  var env = envelope.inbound({
    provider: 'meta-cloud-api',
    crm: { adapter: 'chatwoot', account_id: 1, inbox_id: 1, conversation_id: 42, message_id: 9101, contact_id: 77, channel_type: 'Channel::Whatsapp' },
    customer: { msisdn: '+216 20 000 123', name: 'Client Test' },
    message: { content_type: 'text', text: 'hello', external_id: 'wamid.x', received_at: '2026-09-05T01:20:00Z' }
  });
  ok(envelope.validate(env).length === 0, 'inbound envelope validates');
  ok(env.event_name === 'customer.message.received' && env.producer === 'mythos-auto-comms' && env.privacy_class === 'CUSTOMER_PII', 'envelope: ecosystem event fields');
  ok(env.provider_class === 'official' && env.customer.msisdn === '21620000123' && env.crm.account_id === '1', 'envelope: normalised values');

  var bad = clone(env); bad.provider = 'evolution';
  ok(envelope.validate(bad).indexOf('PROVIDER_CLASS') !== -1, 'validate: provider_class must match provider');
  bad = clone(env); bad.message.text = '';
  ok(envelope.validate(bad).indexOf('MESSAGE_EMPTY') !== -1, 'validate: empty text refused');
  bad = clone(env); bad.crm.conversation_id = '42; rm -rf /';
  ok(envelope.validate(bad).indexOf('CRM_CONVERSATION_ID') !== -1, 'validate: ids are a closed alphabet');
  bad = clone(env); bad.project_id = 'Bad Project';
  ok(envelope.validate(bad).indexOf('PROJECT_ID') !== -1, 'validate: project id alphabet');
  ok(envelope.validate(null)[0] === 'ENVELOPE_NOT_OBJECT', 'validate: null');

  var s = JSON.stringify(envelope.summary(env));
  ok(s.indexOf('hello') === -1 && s.indexOf('Client Test') === -1 && s.indexOf('21620000123') === -1 && s.indexOf('***123') !== -1, 'summary: no text, no name, masked msisdn');
})();

// ---------- 2. configuration model ----------
(function () {
  ok(projects.validate(EXAMPLE).length === 0, 'example config: no problems');
  ok(EXAMPLE.projects.length === 3 && EXAMPLE.projects.map(function (p) { return p.id; }).join(',') === 'ssangyong.autos,piece.autos,casse.autos', 'example config: three projects, nothing hard-coded in code');
  ok(projects.resolve(EXAMPLE, { account_id: 1, inbox_id: '2' }).id === 'piece.autos', 'resolve: (account, inbox) → project');
  ok(projects.resolve(EXAMPLE, { account_id: 1, inbox_id: 99 }) === null && projects.resolve(EXAMPLE, {}) === null, 'resolve: unknown inbox → null');
  var pol = projects.policy({ business: {} });
  ok(pol.handler === 'handoff' && pol.auto_reply === false, 'policy: defaults are handoff + no auto reply');

  var c = clone(EXAMPLE); c.schema = 'x';
  ok(projects.validate(c).indexOf('CONFIG_SCHEMA') !== -1, 'validate: schema');
  c = clone(EXAMPLE); c.crm.adapter = 'hubspot';
  ok(projects.validate(c).indexOf('CRM_ADAPTER_UNKNOWN') !== -1, 'validate: unknown CRM adapter');
  c = clone(EXAMPLE); c.crm.base_url = 'https://crm.example.com';
  ok(projects.validate(c).indexOf('CRM_BASE_URL_NOT_PRIVATE') !== -1, 'validate: public CRM host refused');
  c.crm.allow_public = true;
  ok(projects.validate(c).indexOf('CRM_BASE_URL_NOT_PRIVATE') === -1, 'validate: explicit allow_public');
  c = clone(EXAMPLE); c.crm.api_token = 'literal-token-value-should-not-be-here';
  var probs = projects.validate(c);
  ok(probs.some(function (p) { return p.indexOf('CREDENTIAL_LITERAL:crm.api_token') === 0; }) && probs.join(' ').indexOf('literal-token-value') === -1, 'validate: credential literal refused by NAME, value not echoed');
  c = clone(EXAMPLE); c.crm.api_token_file = 'AbCdEf0123456789AbCdEf0123456789AbCdEf01';
  ok(projects.validate(c).some(function (p) { return p.indexOf('CREDENTIAL_LITERAL:crm.api_token_file') === 0; }), 'validate: *_file that is not a path refused');
  c = clone(EXAMPLE); c.projects[1].id = 'ssangyong.autos';
  ok(projects.validate(c).some(function (p) { return /PROJECT_ID_DUPLICATE/.test(p); }), 'validate: duplicate project id');
  c = clone(EXAMPLE); c.projects[1].crm.inbox_ids = [1];
  ok(projects.validate(c).some(function (p) { return /CRM_INBOX_SHARED:1\/1/.test(p); }), 'validate: one inbox cannot belong to two projects');
  c = clone(EXAMPLE); c.projects[0].whatsapp.provider = 'evolution';
  ok(projects.validate(c).some(function (p) { return /UNOFFICIAL_NOT_ACKNOWLEDGED/.test(p); }), 'validate: unofficial provider needs explicit acknowledgement');
  c.projects[0].whatsapp.unofficial_acknowledged = true;
  ok(projects.validate(c).length === 0, 'validate: acknowledged unofficial provider accepted');
  c = clone(EXAMPLE); c.projects[0].business.handler = 'magic';
  ok(projects.validate(c).some(function (p) { return /BUSINESS_HANDLER_UNKNOWN/.test(p); }), 'validate: unknown handler');
  c = clone(EXAMPLE); c.projects[0].business.catalog_api = 'https://api.example.com';
  ok(projects.validate(c).some(function (p) { return /CATALOG_API_NOT_PRIVATE/.test(p); }), 'validate: public catalogue API refused by default');
  c = clone(EXAMPLE); c.projects = [];
  ok(projects.validate(c).indexOf('PROJECTS_EMPTY') !== -1, 'validate: no projects');

  var d = projects.describe(EXAMPLE);
  ok(d.problems.length === 0 && d.crm.api_token_file_set === true && d.crm.base_url_private === true && d.projects[0].whatsapp_provider_class === 'official', 'describe: shape');
  ok(JSON.stringify(d).indexOf('token_file"') === -1 || JSON.stringify(d).indexOf('.token') === -1, 'describe: file paths are reported as booleans, not paths');
})();

// ---------- 3. Chatwoot adapter: parse + authorise + consistency ----------
(function () {
  ok(crm.get('chatwoot') === chatwoot && crm.get('nope') === null, 'registry');
  var d = chatwoot.describe();
  ok(d.id === 'chatwoot' && Array.isArray(d.providers_behind) && d.providers_behind.length >= 3, 'describe: providers behind the CRM listed');

  var p = chatwoot.parseWebhook(webhookFixture());
  ok(p.accepted === true && p.envelope && envelope.validate(p.envelope).length === 0, 'parse: incoming text accepted, envelope valid');
  ok(p.envelope.crm.account_id === '1' && p.envelope.crm.inbox_id === '1' && p.envelope.crm.conversation_id === '42' && p.envelope.crm.message_id === '9101' && p.envelope.crm.contact_id === '77', 'parse: CRM references');
  ok(p.envelope.customer.msisdn === '21620000123' && p.envelope.message.text.indexOf('Korando') !== -1 && p.envelope.message.external_id.indexOf('wamid.') === 0, 'parse: customer and message');
  ok(p.envelope.provider === 'unknown' && p.envelope.project_id === null, 'parse: provider/project left to configuration');
  ok(p.envelope.crm.channel_type === 'Channel::Whatsapp', 'parse: channel type carried');

  ok(chatwoot.parseWebhook(webhookFixture({ message_type: 'outgoing' })).reason === 'NOT_INCOMING', 'parse: outgoing dropped');
  ok(chatwoot.parseWebhook(webhookFixture({ private: true })).reason === 'PRIVATE_NOTE', 'parse: private note dropped');
  ok(chatwoot.parseWebhook(webhookFixture({ event: 'conversation_status_changed' })).reason.indexOf('EVENT_IGNORED') === 0, 'parse: other events ignored');
  ok(chatwoot.parseWebhook(webhookFixture({ sender: { id: 1, type: 'user', name: 'Agent' } })).reason === 'SENDER_NOT_CONTACT', 'parse: agent-authored dropped');
  ok(chatwoot.parseWebhook(webhookFixture({ id: 'x; drop' })).reason === 'MESSAGE_ID', 'parse: non-numeric id refused');
  ok(chatwoot.parseWebhook('str').reason === 'BODY_NOT_OBJECT' && chatwoot.parseWebhook([]).reason === 'BODY_NOT_OBJECT', 'parse: non-object body');
  var att = chatwoot.parseWebhook(webhookFixture({ content: '', attachments: [{ file_type: 'image' }] }));
  ok(att.accepted && att.envelope.message.content_type === 'attachment' && att.envelope.message.attachments === 1 && envelope.validate(att.envelope).length === 0, 'parse: attachment-only message accepted as attachment');
  var noPhone = chatwoot.parseWebhook(webhookFixture({ sender: { id: 5, name: 'X', type: 'contact' } }));
  ok(noPhone.accepted && noPhone.envelope.customer.msisdn === '21620000123', 'parse: msisdn falls back to contact_inbox.source_id');

  ok(chatwoot.authorizeWebhook({ query: { token: TOKEN }, expectedToken: TOKEN }).ok === true, 'auth: matching token');
  ok(chatwoot.authorizeWebhook({ query: { token: TOKEN + 'x' }, expectedToken: TOKEN }).reason === 'WEBHOOK_TOKEN_MISMATCH', 'auth: mismatch');
  ok(chatwoot.authorizeWebhook({ query: {}, expectedToken: TOKEN }).reason === 'WEBHOOK_TOKEN_MISSING', 'auth: missing');
  ok(chatwoot.authorizeWebhook({ query: { token: 'short' }, expectedToken: 'short' }).reason === 'WEBHOOK_TOKEN_NOT_CONFIGURED', 'auth: a short expected token is not a configuration');
  ok(chatwoot.authorizeWebhook({ query: { token: TOKEN }, expectedToken: null }).reason === 'WEBHOOK_TOKEN_NOT_CONFIGURED', 'auth: unconfigured refuses everything');

  ok(chatwoot.providerConsistency('Channel::Whatsapp', 'meta-cloud-api') === null, 'consistency: official on Channel::Whatsapp');
  ok(chatwoot.providerConsistency('Channel::Whatsapp', 'evolution') === 'PROVIDER_CLASS_CONTRADICTS_CHANNEL', 'consistency: unofficial configured on the official channel refused');
  ok(chatwoot.providerConsistency('Channel::Api', 'evolution') === null && chatwoot.providerConsistency('Channel::Api', 'meta-cloud-api') === null, 'consistency: API inbox defers to configuration');
  ok(chatwoot.providerConsistency('Channel::Email', 'meta-cloud-api') === 'CHANNEL_TYPE_UNSUPPORTED' && chatwoot.providerConsistency(null, 'meta-cloud-api') === null, 'consistency: unsupported channel / unknown channel');
})();

// ---------- 4. router + handler boundary + reply policy ----------
var routed;
var asyncPart = (async function () {
  var env = chatwoot.parseWebhook(webhookFixture()).envelope;

  routed = await router.route(env, EXAMPLE);
  ok(routed.outcome === 'ROUTED' && routed.project_id === 'ssangyong.autos', 'route: inbox 1 → ssangyong.autos');
  ok(routed.decision.action === 'handoff' && routed.decision.reason === 'NO_BUSINESS_ENGINE', 'route: default handler hands off to a human');
  ok(routed.envelope.provider === 'meta-cloud-api' && routed.envelope.provider_class === 'official' && routed.envelope.project_id === 'ssangyong.autos', 'route: envelope enriched from configuration');
  ok(routed.reply.allowed === false && routed.reply.suppressed_reason === null, 'route: handoff carries no reply');
  ok(JSON.stringify(routed.summary).indexOf('Korando') === -1, 'route: summary carries no text');

  var env2 = clone(env); env2.crm.inbox_id = '2';
  var r2 = await router.route(env2, EXAMPLE);
  ok(r2.outcome === 'ROUTED' && r2.project_id === 'piece.autos', 'route: same layer, second project');
  var env9 = clone(env); env9.crm.inbox_id = '9';
  var r9 = await router.route(env9, EXAMPLE);
  ok(r9.outcome === 'UNROUTED' && r9.reason === 'NO_PROJECT_FOR_INBOX' && r9.decision === null, 'route: unknown inbox → UNROUTED, nothing decided');

  var badCfg = clone(EXAMPLE); badCfg.crm.base_url = 'https://crm.example.com';
  var rb = await router.route(env, badCfg);
  ok(rb.outcome === 'REJECTED' && rb.reason.indexOf('CONFIG_INVALID:') === 0, 'route: invalid configuration routes nothing');
  var badEnv = clone(env); badEnv.message.text = '';
  var re = await router.route(badEnv, EXAMPLE);
  ok(re.outcome === 'REJECTED' && re.reason === 'ENVELOPE_INVALID:MESSAGE_EMPTY', 'route: invalid envelope rejected');

  var contra = clone(EXAMPLE); contra.projects[0].whatsapp = { provider: 'evolution', unofficial_acknowledged: true };
  var rc = await router.route(env, contra);
  ok(rc.outcome === 'REJECTED' && rc.reason === 'PROVIDER_CLASS_CONTRADICTS_CHANNEL', 'route: configured unofficial provider on an official channel refused');
  var apiEnv = clone(env); apiEnv.crm.channel_type = 'Channel::Api';
  var ra = await router.route(apiEnv, contra);
  ok(ra.outcome === 'ROUTED' && ra.envelope.provider === 'evolution' && ra.envelope.provider_class === 'unofficial', 'route: unofficial provider is visible on every envelope, never hidden');

  // a business handler that answers
  var seen = null;
  var replyHandler = function (e, ctx) { seen = { project: ctx.project.id, catalog: ctx.catalog_api, text: e.message.text }; return { action: 'reply', reason: 'PART_FOUND', reply_text: 'Filtre à huile Korando 2020: en stock', intent: 'part_request', entities: { model: 'Korando', year: 2020, source_url: ['https://bot', 'not-a-real-pw@catalog.internal/x'].join(':') } }; };   // assembled so no secret-shaped literal sits in this file
  var cfgH = clone(EXAMPLE); cfgH.projects[0].business.handler = 'catalog';
  projects.HANDLERS.push('catalog');   // registered handler name for this test only
  var rr = await router.route(env, cfgH, { handlers: { catalog: replyHandler } });
  ok(rr.outcome === 'ROUTED' && rr.decision.action === 'reply' && rr.decision.intent === 'part_request', 'handler boundary: custom handler decides');
  ok(seen && seen.project === 'ssangyong.autos' && seen.catalog === 'http://127.0.0.1:3080/api' && seen.text.indexOf('Korando') !== -1, 'handler boundary: receives project, catalogue API and message');
  ok(rr.reply.allowed === false && rr.reply.suppressed_reason === 'AUTO_REPLY_DISABLED', 'reply policy: reply suppressed while auto_reply is off (default)');
  ok(rr.decision.entities.source_url === redact.MASK && rr.decision.entities.model === 'Korando', 'handler boundary: decision entities pass the shared redaction');
  cfgH.projects[0].business.auto_reply = true;
  var rr2 = await router.route(env, cfgH, { handlers: { catalog: replyHandler } });
  ok(rr2.reply.allowed === true, 'reply policy: allowed only with explicit auto_reply: true');

  var rt = await router.route(env, cfgH, { handlers: { catalog: function () { throw new Error('boom: ' + API_TOKEN); } } });
  ok(rt.outcome === 'ROUTED' && rt.decision.action === 'handoff' && rt.decision.reason === 'HANDLER_ERROR:ERROR' && JSON.stringify(rt).indexOf('fedcba') === -1, 'handler failure → handoff; a free-text error message never leaves the handler');
  var rn = await router.route(env, cfgH, { handlers: { catalog: function () { return Promise.reject(new Error('CATALOG_UNREACHABLE')); } } });
  ok(rn.decision.reason === 'HANDLER_ERROR:CATALOG_UNREACHABLE', 'handler failure: a bare error NAME is kept');
  var rto = await router.route(env, cfgH, { handlers: { catalog: function () { return new Promise(function () {}); } }, handlerTimeoutMs: 30 });
  ok(rto.decision.action === 'handoff' && rto.decision.reason === 'HANDLER_ERROR:HANDLER_TIMEOUT', 'handler timeout → handoff');
  var rm = await router.route(env, cfgH, { handlers: { catalog: function () { return { action: 'reply' }; } } });
  ok(rm.decision.action === 'handoff' && rm.decision.reason === 'REPLY_TEXT_MISSING', 'malformed reply decision → handoff');
  var ru = await router.route(env, cfgH, { handlers: { catalog: function () { return { action: 'delete_everything' }; } } });
  ok(ru.decision.action === 'handoff' && ru.decision.reason === 'DECISION_ACTION_UNKNOWN', 'unknown action → handoff');
  var cfgMissing = clone(cfgH);
  var rmis = await router.route(env, cfgMissing, {});
  ok(rmis.outcome === 'REJECTED' && rmis.reason === 'HANDLER_UNAVAILABLE', 'configured handler not provided → REJECTED, no default reply');
  projects.HANDLERS.pop();

  // ---------- 5. handleWebhook: the single ingress ----------
  var w = await router.handleWebhook({ cfg: EXAMPLE, body: webhookFixture(), query: { token: 'wrong-token-of-the-right-length-0000000' }, expectedToken: TOKEN });
  ok(w.outcome === 'UNAUTHORIZED' && w.reason === 'WEBHOOK_TOKEN_MISMATCH' && w.routed === null, 'ingress: unauthorised webhook is not parsed');
  w = await router.handleWebhook({ cfg: EXAMPLE, body: webhookFixture({ message_type: 'outgoing' }), query: { token: TOKEN }, expectedToken: TOKEN });
  ok(w.outcome === 'IGNORED' && w.reason === 'NOT_INCOMING', 'ingress: non-customer event ignored');
  w = await router.handleWebhook({ cfg: EXAMPLE, body: webhookFixture(), query: { token: TOKEN }, expectedToken: TOKEN });
  ok(w.outcome === 'ROUTED' && w.routed.project_id === 'ssangyong.autos' && w.routed.decision.action === 'handoff', 'ingress: authorised customer message routed');
  w = await router.handleWebhook({ cfg: { crm: { adapter: 'nope' } }, body: {}, query: {}, expectedToken: TOKEN });
  ok(w.outcome === 'REJECTED' && w.reason === 'CRM_ADAPTER_UNKNOWN', 'ingress: unknown adapter');

  // ---------- 6. deliver: egress against a loopback CRM stub ----------
  var requests = [];
  var status = 200;
  var srv = http.createServer(function (req, res) {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      requests.push({ method: req.method, url: req.url, token: req.headers.api_access_token, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(status === 200 ? JSON.stringify({ id: 555, content: 'x' }) : JSON.stringify({ error: 'boom' }));
    });
  });
  await new Promise(function (r) { srv.listen(0, '127.0.0.1', r); });
  var cfgD = clone(cfgH); cfgD.crm.base_url = 'http://127.0.0.1:' + srv.address().port;

  var dv = await router.deliver({ cfg: cfgD, routed: routed, apiToken: API_TOKEN });
  ok(dv.ok === false && dv.error === 'DECISION_NOT_REPLY' && requests.length === 0, 'deliver: a handoff never sends');
  dv = await router.deliver({ cfg: cfgD, routed: rr, apiToken: API_TOKEN });
  ok(dv.ok === false && dv.error === 'REPLY_NOT_ALLOWED:AUTO_REPLY_DISABLED' && requests.length === 0, 'deliver: suppressed reply never sends');
  dv = await router.deliver({ cfg: cfgD, routed: { outcome: 'UNROUTED' }, apiToken: API_TOKEN });
  ok(dv.ok === false && dv.error === 'NOT_ROUTED' && requests.length === 0, 'deliver: unrouted never sends');

  dv = await router.deliver({ cfg: cfgD, routed: rr2, apiToken: API_TOKEN });
  ok(dv.ok === true && dv.status === 200 && dv.crm_message_id === '555', 'deliver: allowed reply posted');
  ok(requests.length === 1 && requests[0].method === 'POST' && requests[0].url === '/api/v1/accounts/1/conversations/42/messages', 'deliver: Chatwoot messages endpoint for THIS conversation');
  ok(requests[0].token === API_TOKEN, 'deliver: api_access_token header carried');
  var sentBody = JSON.parse(requests[0].body);
  ok(sentBody.content === 'Filtre à huile Korando 2020: en stock' && sentBody.message_type === 'outgoing' && sentBody.private === false, 'deliver: outgoing, non-private, text only');
  ok(JSON.stringify(dv).indexOf(API_TOKEN) === -1, 'deliver: token never in the result');

  status = 500;
  dv = await router.deliver({ cfg: cfgD, routed: rr2, apiToken: API_TOKEN });
  ok(dv.ok === false && dv.status === 500 && /^HTTP 500/.test(dv.error) && dv.error.indexOf(API_TOKEN) === -1, 'deliver: HTTP error → ok:false, no throw');
  status = 200;

  var cfgPub = clone(cfgD); cfgPub.crm.base_url = 'http://203.0.113.10:3000';
  var before = requests.length;
  dv = await router.deliver({ cfg: cfgPub, routed: rr2, apiToken: API_TOKEN });
  ok(dv.ok === false && /not private/.test(dv.error) && requests.length === before, 'deliver: public CRM host refused before any request');
  dv = await router.deliver({ cfg: cfgD, routed: rr2, apiToken: '' });
  ok(dv.ok === false && /credential missing/.test(dv.error) && requests.length === before, 'deliver: missing token refused before any request');
  var closed = clone(cfgD); closed.crm.base_url = 'http://127.0.0.1:1';
  dv = await router.deliver({ cfg: closed, routed: rr2, apiToken: API_TOKEN });
  ok(dv.ok === false && /^TRANSPORT:/.test(dv.error), 'deliver: closed port → TRANSPORT error, no throw');

  // direct adapter guards
  var sr = await chatwoot.sendReply({ baseUrl: cfgD.crm.base_url, accountId: '1', conversationId: '../../admin', apiToken: API_TOKEN, text: 'x' });
  ok(sr.ok === false && /conversation id/.test(sr.error) && requests.length === before, 'sendReply: path-injecting conversation id refused');
  srv.close();

  // ---------- 7. separation guarantees ----------
  // `lib/crm/evolution.js` (#173) speaks the gateway's own `/message/sendText`
  // endpoint; what stays forbidden is the notification module's `.sendText(`
  // function and its provider files.
  var commsFiles = ['lib/envelope.js', 'lib/projects.js', 'lib/crm/index.js', 'lib/crm/chatwoot.js', 'lib/crm/evolution.js', 'lib/router.js', 'lib/intents.js', 'lib/business-data.js', 'lib/ai/index.js', 'lib/handlers/auto-reply.js', 'lib/ledger.js', 'lib/policy.js', 'lib/engine.js', 'bin/mythos-auto-comms', 'bin/mythos-auto-reply-receiver'].map(function (f) { return path.join(COMMS, f); });
  var commsSrc = commsFiles.map(function (f) { return fs.readFileSync(f, 'utf8'); }).join('\n');
  ok(commsSrc.indexOf('providers/evolution') === -1 && commsSrc.indexOf('providers/generic') === -1 && commsSrc.indexOf('.sendText(') === -1, 'separation: the customer layer never uses the notification providers');
  ok(commsSrc.indexOf('MYTHOS_BRIDGE_WHATSAPP') === -1, 'separation: the customer layer reads no bridge notification setting');
  ok(commsSrc.indexOf('onReport') === -1 && commsSrc.indexOf('flush(') === -1, 'separation: the customer layer never touches the notification ledger');
  var notifyDir = path.join(ROOT, 'projects/mythos-ai-executor/bridge/notify');
  var notifySrc = ['whatsapp.js', 'http-json.js', 'providers/evolution.js', 'providers/generic.js'].map(function (f) { return fs.readFileSync(path.join(notifyDir, f), 'utf8'); }).join('\n');
  ok(notifySrc.indexOf('automotive/comms') === -1 && notifySrc.indexOf('chatwoot') === -1, 'separation: the notification layer knows nothing about the customer layer');
  ok(/grow inbound handling, chat sessions, templates or customer messaging/.test(notifySrc), 'separation: the notification scope fence is still declared');
  ok(fs.readFileSync(path.join(ROOT, 'projects/mythos-ai-executor/bridge/github-bridge.js'), 'utf8').indexOf('automotive/comms') === -1, 'separation: github-bridge.js is untouched by this layer');
  // `assigned-secret` matches the source's own `apiToken: o.apiToken`; the
  // literal-shaped kinds (bearer, PEM, provider keys, basic-auth URLs) must be absent.
  var kinds = redact.findSecretKinds(commsSrc + fs.readFileSync(path.join(COMMS, 'config/comms.example.json'), 'utf8')).filter(function (k) { return k !== 'assigned-secret'; });
  ok(kinds.length === 0, 'no credential-shaped literal in the customer layer or its example config');
  ok(redact.findSecretKinds(fs.readFileSync(path.join(COMMS, 'config/comms.example.json'), 'utf8')).length === 0, 'example config carries no assignment of a credential value');
  ok(!/\bsudo\b|docker\.sock|child_process\.exec\(/.test(commsSrc), 'no privilege or shell surface in the customer layer');

  // ---------- 8. CLI ----------
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-comms-test-'));
  var cfgFile = path.join(tmp, 'comms.json');
  var hookFile = path.join(tmp, 'hook.json');
  var tokFile = path.join(tmp, 'webhook.token');
  fs.writeFileSync(tokFile, TOKEN + '\n', { mode: 0o600 });
  var cliCfg = clone(EXAMPLE); cliCfg.crm.webhook_token_file = tokFile;
  fs.writeFileSync(cfgFile, JSON.stringify(cliCfg));
  fs.writeFileSync(hookFile, JSON.stringify(webhookFixture()));
  var CLI = path.join(COMMS, 'bin/mythos-auto-comms');
  function cli(args) { return new Promise(function (resolve) { execFile('node', [CLI].concat(args), { timeout: 20000 }, function (err, so, se) { resolve({ code: err ? err.code : 0, out: so, err: se }); }); }); }
  var r = await cli(['config-check', cfgFile]);
  ok(r.code === 0 && JSON.parse(r.out).problems.length === 0, 'cli: config-check exit 0 on a valid configuration');
  var bad = clone(cliCfg); bad.crm.base_url = 'https://crm.example.com';
  fs.writeFileSync(path.join(tmp, 'bad.json'), JSON.stringify(bad));
  r = await cli(['config-check', path.join(tmp, 'bad.json')]);
  ok(r.code === 2 && JSON.parse(r.out).problems.indexOf('CRM_BASE_URL_NOT_PRIVATE') !== -1, 'cli: config-check exit 2 with problems');
  r = await cli(['dry-run', cfgFile, hookFile]);
  var dr = r.code === 0 ? JSON.parse(r.out) : null;
  ok(dr && dr.outcome === 'ROUTED' && dr.routed.project_id === 'ssangyong.autos' && dr.sent === false && dr.token_file === 'ok', 'cli: dry-run routes the recorded webhook and sends nothing');
  ok(r.out.indexOf(TOKEN) === -1 && r.out.indexOf('Korando') === -1 && r.out.indexOf('Client Test') === -1, 'cli: dry-run output carries neither the token nor customer content');
  fs.chmodSync(tokFile, 0o644);
  r = await cli(['dry-run', cfgFile, hookFile]);
  ok(r.code === 2 && JSON.parse(r.out).token_file === 'TOKEN_FILE_MODE_NOT_0600', 'cli: a 0644 token file is refused');
  r = await cli(['describe']);
  ok(r.code === 0 && JSON.parse(r.out).crm_adapters.chatwoot.id === 'chatwoot' && JSON.parse(r.out).handlers.join(',') === 'handoff,auto-reply', 'cli: describe');
  fs.rmSync(tmp, { recursive: true, force: true });
})();

asyncPart.then(function () {
  console.log('mythos auto comms tests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (e) {
  console.error(e);
  process.exit(1);
});
