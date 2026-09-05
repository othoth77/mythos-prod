'use strict';
// =====================================================
// MYTHOS AUTO auto-reply — outbound reply policy (the send gate)
// projects/automotive/comms/lib/policy.js
//
// The explicit boundary of Issue #173 §10 between "a reply was decided"
// and "a message leaves". Every send goes through `evaluate()`; it returns
// ALL the reasons a send is refused (names, never text), so a dry-run
// shows exactly what would block a live run. It is pure: it reads the
// routed result, the effective engine settings, the provider readiness and
// the ledger counters, and touches nothing.
//
// Refusals:
//   NOT_ROUTED                  the message was not routed to a project
//   DECISION_NOT_REPLY          handoff / ignore
//   REQUIRES_HUMAN              a reply that still needs an agent, and
//                               handoff acknowledgements are off
//   AUTO_REPLY_DISABLED         project `business.auto_reply` is not true
//   MODE_DRY_RUN                engine `auto_reply.mode` is not `live`
//   RECIPIENT_MISSING / RECIPIENT_INVALID
//   PROVIDER_NOT_CONFIGURED     no `crm.base_url`
//   CREDENTIAL_MISSING          provider token not loaded
//   PROVIDER_UNAVAILABLE        breaker open after consecutive failures
//   BUSINESS_DATA_MISSING       the decision lists a missing fact kind
//   FACT_GUARD_VIOLATION        the text claims a fact it does not have
//   REPLY_RATE_EXCEEDED         hourly cap for the conversation reached
//   TEXT_EMPTY / TEXT_TOO_LONG
//
// `proposed` is always filled when there is a reply text — that is what a
// dry-run prints: the exact message, the masked recipient, and the list of
// gates it passed or failed.
// =====================================================

var envelope = require('./envelope');
var ai = require('./ai');

var MSISDN_RE = /^[0-9]{6,20}$/;

function mask(msisdn) { return msisdn ? '***' + String(msisdn).slice(-3) : null; }

// evaluate(o) → { allowed, rejections: [names], checks: {name: pass}, proposed }
//   o = { routed, engine, policy, provider: { configured, credential_present, breaker },
//         replies_last_hour, now }
function evaluate(o) {
  o = o || {};
  var r = o.routed || null;
  var engine = o.engine || {};
  var pol = o.policy || {};
  var prov = o.provider || {};
  var now = o.now || Date.now();
  var rej = [];
  var decision = r && r.decision ? r.decision : null;
  var text = decision && typeof decision.reply_text === 'string' ? decision.reply_text : '';
  var recipient = r && r.envelope && r.envelope.crm ? r.envelope.crm.conversation_id : null;

  if (!r || r.outcome !== 'ROUTED' || !decision) rej.push('NOT_ROUTED');
  else {
    if (decision.action !== 'reply') rej.push('DECISION_NOT_REPLY');
    if (decision.requires_human === true && engine.send_handoff_ack !== true) rej.push('REQUIRES_HUMAN');
    // A missing fact blocks every reply except the explicit handoff
    // acknowledgement (action reply + requires_human), which promises nothing
    // and is gated by REQUIRES_HUMAN / send_handoff_ack above.
    var isAck = decision.action === 'reply' && decision.requires_human === true;
    if (decision.facts && Array.isArray(decision.facts.missing) && decision.facts.missing.length && !isAck) rej.push('BUSINESS_DATA_MISSING');
  }
  if (pol.auto_reply !== true) rej.push('AUTO_REPLY_DISABLED');
  if (engine.mode !== 'live') rej.push('MODE_DRY_RUN');
  if (!recipient) rej.push('RECIPIENT_MISSING');
  else if (!MSISDN_RE.test(String(recipient))) rej.push('RECIPIENT_INVALID');
  if (prov.configured !== true) rej.push('PROVIDER_NOT_CONFIGURED');
  if (prov.credential_present !== true) rej.push('CREDENTIAL_MISSING');
  if (prov.breaker && prov.breaker.open_until && prov.breaker.open_until > now) rej.push('PROVIDER_UNAVAILABLE');
  if (decision && decision.action === 'reply') {
    if (!text.trim()) rej.push('TEXT_EMPTY');
    else if (text.length > ai.MAX_REPLY) rej.push('TEXT_TOO_LONG');
    var guard = ai.factGuard(text, decision.facts);
    if (!guard.ok) rej.push('FACT_GUARD_VIOLATION');
  }
  var cap = engine.max_replies_per_conversation_per_hour || 0;
  if (cap && typeof o.replies_last_hour === 'number' && o.replies_last_hour >= cap) rej.push('REPLY_RATE_EXCEEDED');

  var unique = rej.filter(function (x, i) { return rej.indexOf(x) === i; });
  return {
    allowed: unique.length === 0,
    rejections: unique,
    proposed: text ? {
      text: text,
      language: decision.language || null,
      generator: decision.generator || null,
      recipient_masked: mask(recipient),
      intent: decision.intent || null,
      requires_human: decision.requires_human === true,
      facts: decision.facts || null
    } : null,
    mode: engine.mode === 'live' ? 'live' : 'dry-run'
  };
}

module.exports = { MAX_TEXT: envelope.MAX_TEXT, mask: mask, evaluate: evaluate };
