'use strict';
// =====================================================
// MYTHOS AUTO customer communication — routing and the business boundary
// projects/automotive/comms/lib/router.js
//
// The one place where a customer message meets MYTHOS:
//
//   CRM webhook ─► authorizeWebhook ─► parseWebhook ─► envelope
//        ─► resolve project (account, inbox) ─► business HANDLER
//        ─► decision { handoff | reply | ignore }
//        ─► reply policy (auto_reply per project, default OFF)
//        ─► [deliver through the CRM adapter]
//
// The HANDLER is the integration boundary for the automotive business
// engine that does not exist yet (vehicle recognition → catalogue →
// compatible parts → stock → price). Its contract:
//
//   handler(envelope, ctx) → Promise<decision>
//     ctx      = { project, policy, catalog_api }
//     decision = { action: 'handoff' | 'reply' | 'ignore',
//                  reason: string,             // a name, safe to record
//                  reply_text?: string,        // only for action 'reply'
//                  intent?: string, entities?: object }   // evidence
//
// Rules the router enforces, whatever the handler returns:
//   - a malformed decision is a handoff, never a reply;
//   - `reply` is delivered ONLY when the project has `auto_reply: true`;
//     otherwise it is recorded as `reply_suppressed` and the human agent in
//     the CRM answers. Every project starts with auto_reply off;
//   - a handler failure (throw/reject) is a handoff with the error NAME;
//   - the router never sends anything itself; `deliver()` is a separate,
//     explicit call the caller makes after the governed steps it wants.
//
// Nothing here knows ssangyong.autos, Chatwoot or WhatsApp by name.
// =====================================================

var envelope = require('./envelope');
var projects = require('./projects');
var crmRegistry = require('./crm');
var redact = require('../../../mythos-orchestrator/lib/redact');

var ACTIONS = ['handoff', 'reply', 'ignore'];
var HANDLER_TIMEOUT_MS = 10000;

// The only built-in handler: hand every message to a human agent in the
// CRM. It is what a project runs on until its business engine is connected.
function handoffHandler() {
  return Promise.resolve({ action: 'handoff', reason: 'NO_BUSINESS_ENGINE' });
}

var BUILTIN_HANDLERS = { handoff: handoffHandler };

function normalizeDecision(d) {
  if (!d || typeof d !== 'object') return { action: 'handoff', reason: 'DECISION_MALFORMED' };
  if (ACTIONS.indexOf(d.action) === -1) return { action: 'handoff', reason: 'DECISION_ACTION_UNKNOWN' };
  var out = { action: d.action, reason: typeof d.reason === 'string' ? d.reason.slice(0, 80) : 'UNSPECIFIED' };
  if (d.action === 'reply') {
    if (typeof d.reply_text !== 'string' || !d.reply_text.trim()) return { action: 'handoff', reason: 'REPLY_TEXT_MISSING' };
    out.reply_text = d.reply_text.slice(0, envelope.MAX_TEXT);
  }
  if (typeof d.intent === 'string') out.intent = d.intent.slice(0, 80);
  if (d.entities && typeof d.entities === 'object' && !Array.isArray(d.entities)) out.entities = redact.redactValue(d.entities);
  return out;
}

function withTimeout(promise, ms) {
  var timer;
  var timeout = new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error('HANDLER_TIMEOUT')); }, ms); });
  return Promise.race([promise, timeout]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
}

// route(env, cfg, opts) → Promise<result>
//   opts.handlers  { name: fn } merged over the built-ins
//   result         { outcome: 'REJECTED' | 'UNROUTED' | 'ROUTED', reason,
//                    project_id, decision, reply: { allowed, suppressed_reason },
//                    envelope (enriched), summary }
function route(env, cfg, opts) {
  opts = opts || {};
  var handlers = Object.assign({}, BUILTIN_HANDLERS, opts.handlers || {});

  var cfgProblems = projects.validate(cfg);
  if (cfgProblems.length) return Promise.resolve(result('REJECTED', 'CONFIG_INVALID:' + cfgProblems[0], env, null, null));

  var problems = envelope.validate(env);
  if (problems.length) return Promise.resolve(result('REJECTED', 'ENVELOPE_INVALID:' + problems[0], env, null, null));

  var project = projects.resolve(cfg, { account_id: env.crm.account_id, inbox_id: env.crm.inbox_id });
  if (!project) return Promise.resolve(result('UNROUTED', 'NO_PROJECT_FOR_INBOX', env, null, null));

  var adapter = crmRegistry.get(cfg.crm.adapter);
  if (adapter && adapter.id !== env.crm.adapter) return Promise.resolve(result('REJECTED', 'CRM_ADAPTER_MISMATCH', env, project, null));
  if (adapter && typeof adapter.providerConsistency === 'function') {
    var pc = adapter.providerConsistency(env.crm.channel_type, project.whatsapp.provider);
    if (pc) return Promise.resolve(result('REJECTED', pc, env, project, null));
  }

  // Enrich from configuration: the provider is a configured fact about the
  // inbox, recorded on every envelope so an unofficial transport is never
  // invisible downstream.
  var enriched = Object.assign({}, env, {
    project_id: project.id,
    provider: project.whatsapp.provider,
    provider_class: envelope.providerClass(project.whatsapp.provider)
  });

  var pol = projects.policy(project);
  var handler = handlers[pol.handler];
  if (typeof handler !== 'function') return Promise.resolve(result('REJECTED', 'HANDLER_UNAVAILABLE', enriched, project, null));

  var ctx = { project: project, policy: pol, catalog_api: pol.catalog_api };
  var call;
  try { call = Promise.resolve(handler(enriched, ctx)); } catch (e) { call = Promise.reject(e); }
  return withTimeout(call, opts.handlerTimeoutMs || HANDLER_TIMEOUT_MS).then(function (d) {
    return result('ROUTED', null, enriched, project, normalizeDecision(d));
  }, function (e) {
    return result('ROUTED', null, enriched, project, { action: 'handoff', reason: 'HANDLER_ERROR:' + errorName(e) });
  });
}

// Only a NAME leaves a failed handler. A message is kept when it already is
// a bare identifier (HANDLER_TIMEOUT, CATALOG_UNREACHABLE …); anything else
// — which may quote a URL, a token or customer text — is reduced to the
// error's class name.
var ERROR_NAME_RE = /^[A-Z][A-Z0-9_]{2,40}$/;
function errorName(e) {
  var msg = e && typeof e.message === 'string' ? e.message : '';
  if (ERROR_NAME_RE.test(msg)) return msg;
  var cls = e && typeof e.name === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(e.name) ? e.name : 'Error';
  return cls.toUpperCase();
}

function result(outcome, reason, env, project, decision) {
  var pol = project ? projects.policy(project) : null;
  var reply = { allowed: false, suppressed_reason: null };
  if (decision && decision.action === 'reply') {
    if (pol && pol.auto_reply) reply.allowed = true;
    else reply.suppressed_reason = 'AUTO_REPLY_DISABLED';
  }
  return {
    outcome: outcome,
    reason: reason,
    project_id: project ? project.id : null,
    decision: decision,
    reply: reply,
    envelope: env,
    summary: envelope.summary(env)
  };
}

// The single ingress: raw CRM webhook → routed result. This is what an HTTP
// receiver calls; it is kept out of this module so the layer stays
// deployable as a function, a CLI dry-run or a service without change.
//   o = { cfg, body, query, expectedToken, handlers }
function handleWebhook(o) {
  o = o || {};
  var cfg = o.cfg || {};
  var adapter = crmRegistry.get(cfg.crm && cfg.crm.adapter);
  if (!adapter) return Promise.resolve({ outcome: 'REJECTED', reason: 'CRM_ADAPTER_UNKNOWN', authorized: false, accepted: false, routed: null });
  var auth = adapter.authorizeWebhook({ query: o.query, headers: o.headers, expectedToken: o.expectedToken });
  if (!auth.ok) return Promise.resolve({ outcome: 'UNAUTHORIZED', reason: auth.reason, authorized: false, accepted: false, routed: null });
  var parsed = adapter.parseWebhook(o.body);
  if (!parsed.accepted) return Promise.resolve({ outcome: 'IGNORED', reason: parsed.reason, authorized: true, accepted: false, routed: null });
  return route(parsed.envelope, cfg, { handlers: o.handlers, handlerTimeoutMs: o.handlerTimeoutMs }).then(function (r) {
    return { outcome: r.outcome, reason: r.reason, authorized: true, accepted: true, routed: r };
  });
}

// Explicit egress. Sends the routed reply through the CRM adapter and only
// when the router allowed it; a caller cannot use this to send an
// arbitrary text to an arbitrary conversation.
//   o = { cfg, routed, apiToken, timeoutMs }
function deliver(o) {
  o = o || {};
  var r = o.routed;
  var refuse = function (error) { return Promise.resolve({ ok: false, status: null, crm_message_id: null, error: error }); };
  if (!r || r.outcome !== 'ROUTED' || !r.decision) return refuse('NOT_ROUTED');
  if (r.decision.action !== 'reply') return refuse('DECISION_NOT_REPLY');
  if (!r.reply || r.reply.allowed !== true) return refuse('REPLY_NOT_ALLOWED:' + (r.reply && r.reply.suppressed_reason));
  var cfg = o.cfg || {};
  var adapter = crmRegistry.get(cfg.crm && cfg.crm.adapter);
  if (!adapter) return refuse('CRM_ADAPTER_UNKNOWN');
  return adapter.sendReply({
    baseUrl: cfg.crm.base_url,
    allowPublic: cfg.crm.allow_public === true,
    accountId: r.envelope.crm.account_id,
    conversationId: r.envelope.crm.conversation_id,
    apiToken: o.apiToken,
    text: r.decision.reply_text,
    timeoutMs: o.timeoutMs
  });
}

module.exports = {
  ACTIONS: ACTIONS,
  BUILTIN_HANDLERS: BUILTIN_HANDLERS,
  normalizeDecision: normalizeDecision,
  route: route,
  handleWebhook: handleWebhook,
  deliver: deliver
};
