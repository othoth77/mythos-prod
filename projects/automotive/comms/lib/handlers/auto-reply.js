'use strict';
// =====================================================
// MYTHOS AUTO auto-reply — the business handler (Issue #173)
// projects/automotive/comms/lib/handlers/auto-reply.js
//
// Implements the router's handler contract:
//   handler(envelope, ctx) → Promise<decision>
//     ctx = { project, policy, catalog_api, business_data, ai }
//
// Per message:  classify (intents.js)  →  gather the facts the intent needs
// (business-data.js)  →  generate (ai/index.js)  →  decision.
//
// Reply / handoff rules (Issue #173 §7, §9):
//   human_request           handoff REQUIRES_HUMAN
//   unsupported             handoff CONTENT_UNSUPPORTED (media, empty …)
//   greeting                reply   (no fact needed)
//   vehicle_identification  reply   echo + ask for the part (no fact needed)
//   ambiguous               reply   ask for vehicle + part (no fact needed)
//   part_inquiry            reply only with catalogue facts; else handoff
//   price_availability      reply only with parts+price+stock; else handoff
//   order_status            reply only with order facts; else handoff
//
// A handoff for missing business data may carry an acknowledgement text
// (action 'reply' with requires_human: true) when the deployment sets
// `auto_reply.send_handoff_ack: true`; that text is a template, promises
// nothing and names no fact. By default nothing is sent and the agent
// answers.
//
// The handler never sends, never reads the provider, never sees a secret.
// Its decision carries names only: intent, entities the customer wrote,
// fact kinds required / available / missing.
// =====================================================

var intents = require('../intents');
var businessData = require('../business-data');
var ai = require('../ai');

var FACT_INTENTS = ['part_inquiry', 'price_availability', 'order_status'];

function handoff(reason, extra) {
  return Object.assign({ action: 'handoff', reason: reason, requires_human: true }, extra || {});
}

function handler(env, ctx) {
  ctx = ctx || {};
  var pol = ctx.policy || {};
  var project = ctx.project || {};
  var engine = ctx.engine || {};
  var msg = (env && env.message) || {};
  var text = typeof msg.text === 'string' ? msg.text : '';
  var cls = intents.classify(text, {
    content_type: msg.content_type || 'text',
    attachments: msg.attachments || 0,
    vehicle_models: pol.vehicle_models,
    languages: pol.languages
  });
  var evidence = { intent: cls.intent, entities: cls.entities, language: cls.language };
  var required = businessData.requiredFor(cls.intent);
  var ports = ctx.business_data || businessData.none();

  return businessData.gather(ports, required, cls.entities, { project_id: project.id }).then(function (facts) {
    var factNames = { required: facts.required, available: facts.available, missing: facts.missing };
    var genInput = {
      intent: cls.intent,
      language: cls.language,
      entities: cls.entities,
      facts: facts,
      business: { display_name: project.display_name || null },
      ai: ctx.ai || engine.ai || null,
      customer_text: text
    };

    if (cls.intent === 'human_request') return handoff('REQUIRES_HUMAN', Object.assign({ facts: factNames }, evidence));
    if (cls.intent === 'unsupported') return handoff('CONTENT_UNSUPPORTED', Object.assign({ facts: factNames }, evidence));

    var needsFacts = FACT_INTENTS.indexOf(cls.intent) !== -1;
    if (needsFacts && facts.missing.length) {
      if (engine.send_handoff_ack !== true) return handoff('BUSINESS_DATA_UNAVAILABLE', Object.assign({ facts: factNames }, evidence));
      // Acknowledge, promise nothing, hand over.
      var ack = ai.template(ai.templateKind(genInput), genInput) || ai.template('handoff_ack', genInput);
      return Object.assign({ action: 'reply', reason: 'BUSINESS_DATA_UNAVAILABLE_ACK', reply_text: ack, requires_human: true, facts: factNames, generator: 'template' }, evidence);
    }

    return ai.generate(genInput).then(function (g) {
      if (!g || typeof g.text !== 'string' || !g.text.trim()) return handoff('REPLY_GENERATION_FAILED', Object.assign({ facts: factNames }, evidence));
      var reason = needsFacts ? 'FACTS_AVAILABLE' : 'NO_FACT_REQUIRED';
      var d = Object.assign({ action: 'reply', reason: reason, reply_text: g.text, facts: factNames, generator: g.generator }, evidence);
      if (g.ai_reason) d.ai_reason = g.ai_reason;
      return d;
    });
  });
}

module.exports = { FACT_INTENTS: FACT_INTENTS, handler: handler };
