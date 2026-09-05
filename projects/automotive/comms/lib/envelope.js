'use strict';
// =====================================================
// MYTHOS AUTO customer communication — provider-independent envelope
// projects/automotive/comms/lib/envelope.js
//
// ONE shape for every customer message that enters or leaves MYTHOS,
// whatever WhatsApp provider carried it and whatever CRM/inbox holds the
// conversation. Business logic (vehicle recognition, catalogue, stock,
// price, orders) is written against THIS shape and nothing else, so a
// provider or CRM swap never reaches it.
//
// It follows the ecosystem event envelope of
// docs/AUTOMOTIVE_INTEGRATION_CONTRACTS.md §2.2 (event_id, event_name,
// producer, version, correlation_id, source_id, payload, published_at,
// privacy_class) so a customer message is an ordinary automotive domain
// event, not a special case.
//
// Two rules the whole layer depends on:
//   - `provider` / `provider_class` are DATA. Nothing downstream may branch
//     on them; they exist so that an unofficial transport is visible in
//     every record instead of being a hidden dependency (Issue #172 §6).
//   - PII stays in its owner (the CRM). The envelope carries the CRM
//     references needed to reply and the minimum customer fields needed to
//     reason; `summary()` is the only thing that may be logged.
//
// This module is pure: no I/O, no network, no dependency.
// =====================================================

var crypto = require('crypto');

var VERSION = 'mythos-auto-comms/1';
var PRODUCER = 'mythos-auto-comms';

var EVENTS = {
  received: 'customer.message.received',
  reply: 'customer.message.reply'
};
var DIRECTIONS = ['inbound', 'outbound'];
var CHANNELS = ['whatsapp'];

// Transport providers a CRM inbox can sit on. `official` = WhatsApp
// Business Platform (Meta Cloud API directly or through a BSP); `unofficial`
// = a WhatsApp Web automation gateway (session-based, ToS-exposed).
var PROVIDERS = {
  'meta-cloud-api': 'official',
  '360dialog': 'official',
  'twilio': 'official',
  'evolution': 'unofficial',
  'waha': 'unofficial',
  'unknown': 'unknown'
};
var PROVIDER_CLASSES = ['official', 'unofficial', 'unknown'];

var CONTENT_TYPES = ['text', 'attachment', 'location', 'contact', 'other'];

var MAX_TEXT = 4096;
var MAX_NAME = 120;
var MSISDN_RE = /^[0-9]{6,20}$/;
var PROJECT_ID_RE = /^[a-z0-9][a-z0-9.-]{1,62}$/;
var ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function clip(s, max) {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max) : s;
}

// "+216 20 000 000", "216-20…" and "21620000000@s.whatsapp.net" all become
// the digits-only MSISDN the notification adapters already validate against.
function normalizeMsisdn(raw) {
  if (typeof raw !== 'string') return null;
  var at = raw.indexOf('@');
  var digits = (at === -1 ? raw : raw.slice(0, at)).replace(/[^0-9]/g, '');
  return MSISDN_RE.test(digits) ? digits : null;
}

function providerClass(provider) {
  return PROVIDERS[provider] || 'unknown';
}

// Deterministic id per (adapter, crm message id): the same webhook delivered
// twice yields the same event_id, which is what makes de-duplication a
// property of the envelope rather than of each consumer.
function eventId(adapter, crmMessageId) {
  var h = crypto.createHash('sha256').update(String(adapter) + '\u0000' + String(crmMessageId)).digest('hex');
  return 'cm-' + h.slice(0, 24);
}

function inbound(o) {
  o = o || {};
  var crm = o.crm || {};
  var customer = o.customer || {};
  var message = o.message || {};
  var provider = PROVIDERS[o.provider] ? o.provider : 'unknown';
  var msgId = crm.message_id !== undefined && crm.message_id !== null ? String(crm.message_id) : '';
  return {
    envelope: VERSION,
    event_id: msgId ? eventId(crm.adapter || 'unknown', msgId) : null,
    event_name: EVENTS.received,
    producer: PRODUCER,
    version: 1,
    correlation_id: o.correlation_id || null,
    source_id: msgId ? String(crm.adapter || 'unknown') + ':' + msgId : null,
    published_at: o.published_at || new Date().toISOString(),
    privacy_class: 'CUSTOMER_PII',
    direction: 'inbound',
    channel: o.channel || 'whatsapp',
    provider: provider,
    provider_class: providerClass(provider),
    project_id: o.project_id || null,
    crm: {
      adapter: crm.adapter || null,
      account_id: crm.account_id !== undefined && crm.account_id !== null ? String(crm.account_id) : null,
      inbox_id: crm.inbox_id !== undefined && crm.inbox_id !== null ? String(crm.inbox_id) : null,
      conversation_id: crm.conversation_id !== undefined && crm.conversation_id !== null ? String(crm.conversation_id) : null,
      message_id: msgId || null,
      contact_id: crm.contact_id !== undefined && crm.contact_id !== null ? String(crm.contact_id) : null,
      channel_type: crm.channel_type || null
    },
    customer: {
      msisdn: normalizeMsisdn(customer.msisdn),
      name: clip(customer.name, MAX_NAME) || null,
      locale_hint: customer.locale_hint || null
    },
    message: {
      content_type: CONTENT_TYPES.indexOf(message.content_type) === -1 ? 'other' : message.content_type,
      text: clip(message.text, MAX_TEXT),
      attachments: Number(message.attachments) > 0 ? Number(message.attachments) : 0,
      external_id: message.external_id ? clip(String(message.external_id), 128) : null,
      received_at: message.received_at || null
    }
  };
}

// Problems are names, never values: safe to log, safe to return to a
// webhook caller, and enough to fix the configuration that produced them.
function validate(env) {
  var p = [];
  if (!env || typeof env !== 'object') return ['ENVELOPE_NOT_OBJECT'];
  if (env.envelope !== VERSION) p.push('ENVELOPE_VERSION');
  if (env.event_name !== EVENTS.received && env.event_name !== EVENTS.reply) p.push('EVENT_NAME');
  if (!env.event_id || !/^cm-[0-9a-f]{24}$/.test(env.event_id)) p.push('EVENT_ID');
  if (DIRECTIONS.indexOf(env.direction) === -1) p.push('DIRECTION');
  if (CHANNELS.indexOf(env.channel) === -1) p.push('CHANNEL');
  if (!PROVIDERS.hasOwnProperty(env.provider)) p.push('PROVIDER');
  if (PROVIDER_CLASSES.indexOf(env.provider_class) === -1 || env.provider_class !== providerClass(env.provider)) p.push('PROVIDER_CLASS');
  if (env.project_id !== null && env.project_id !== undefined && !PROJECT_ID_RE.test(String(env.project_id))) p.push('PROJECT_ID');
  var crm = env.crm || {};
  if (!crm.adapter || !ID_RE.test(String(crm.adapter))) p.push('CRM_ADAPTER');
  if (!crm.account_id || !ID_RE.test(String(crm.account_id))) p.push('CRM_ACCOUNT_ID');
  if (!crm.inbox_id || !ID_RE.test(String(crm.inbox_id))) p.push('CRM_INBOX_ID');
  if (!crm.conversation_id || !ID_RE.test(String(crm.conversation_id))) p.push('CRM_CONVERSATION_ID');
  if (!crm.message_id || !ID_RE.test(String(crm.message_id))) p.push('CRM_MESSAGE_ID');
  var cust = env.customer || {};
  if (cust.msisdn !== null && cust.msisdn !== undefined && !MSISDN_RE.test(String(cust.msisdn))) p.push('CUSTOMER_MSISDN');
  var msg = env.message || {};
  if (CONTENT_TYPES.indexOf(msg.content_type) === -1) p.push('CONTENT_TYPE');
  if (typeof msg.text !== 'string' || msg.text.length > MAX_TEXT) p.push('MESSAGE_TEXT');
  if (msg.content_type === 'text' && !msg.text.trim()) p.push('MESSAGE_EMPTY');
  return p;
}

// The only representation of an envelope that may reach a log, a task
// record or a chat: no message text, no name, the MSISDN masked to its last
// three digits.
function summary(env) {
  env = env || {};
  var crm = env.crm || {};
  var cust = env.customer || {};
  var msg = env.message || {};
  var msisdn = cust.msisdn ? '***' + String(cust.msisdn).slice(-3) : null;
  return {
    event_id: env.event_id || null,
    event_name: env.event_name || null,
    direction: env.direction || null,
    channel: env.channel || null,
    provider: env.provider || null,
    provider_class: env.provider_class || null,
    project_id: env.project_id || null,
    crm: { adapter: crm.adapter || null, account_id: crm.account_id || null, inbox_id: crm.inbox_id || null, conversation_id: crm.conversation_id || null, message_id: crm.message_id || null },
    customer_msisdn_masked: msisdn,
    content_type: msg.content_type || null,
    text_length: typeof msg.text === 'string' ? msg.text.length : 0,
    attachments: msg.attachments || 0
  };
}

module.exports = {
  VERSION: VERSION,
  PRODUCER: PRODUCER,
  EVENTS: EVENTS,
  PROVIDERS: PROVIDERS,
  PROVIDER_CLASSES: PROVIDER_CLASSES,
  CONTENT_TYPES: CONTENT_TYPES,
  MAX_TEXT: MAX_TEXT,
  PROJECT_ID_RE: PROJECT_ID_RE,
  normalizeMsisdn: normalizeMsisdn,
  providerClass: providerClass,
  eventId: eventId,
  inbound: inbound,
  validate: validate,
  summary: summary
};
