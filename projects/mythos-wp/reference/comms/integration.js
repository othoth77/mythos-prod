'use strict';
// =====================================================
// MYTHOS WP — integration module for the MYTHOS AUTO auto-reply receiver
// projects/mythos-wp/reference/comms/integration.js
//
// The receiver (projects/automotive/comms/bin/mythos-auto-reply-receiver)
// accepts `--integration <module>`; this is the module. It gives the
// engine two things, and nothing else:
//
//   ports        the business-data ports of ports.js (verified catalogue /
//                price / stock facts; order not connected)
//   onOutcome    called with the engine's redacted outcome record after each
//                inbound; when the decision is a handoff or requires a human
//                it appends one wp_handoffs row (status REQUIRES_HUMAN), keyed
//                by the engine's event_id so a retried webhook cannot create
//                a second row. The record carries no message text and a
//                masked number — that is all the queue ever stores.
//
// Starting the receiver, pairing an instance, setting `mode: live` remain
// owner actions; loading this module changes nothing about sending.
// =====================================================

var crypto = require('crypto');
var ports = require('./ports');
var store = require('../projects-store');

var HANDOFF_ACTIONS = { handoff: true };

function conversationKey(rec) {
  var env = rec && rec.envelope ? rec.envelope : {};
  var crm = env.crm || {};
  return crypto.createHash('sha256').update([rec.project_id || '', crm.inbox_id || '', crm.conversation_id || ''].join('\0')).digest('hex').slice(0, 32);
}

// isHandoff(record) → boolean
function isHandoff(rec) {
  var d = rec && rec.decision;
  if (!d) return false;
  return HANDOFF_ACTIONS[d.action] === true || d.requires_human === true;
}

// suggestions for the agent: the matching products the ports found, if any
function suggest(resolved, decision) {
  if (!resolved || !resolved.catalogPool || !decision || !decision.entities) return Promise.resolve(null);
  var p = ports.create({ resolveProject: function () { return resolved; } });
  return p.parts(decision.entities, { project_id: resolved.project.id }).then(function (r) {
    return r && r.ok ? { matching_parts: r.data.matches.slice(0, 5) } : { matching_parts: [], parts_reason: r ? r.reason : null };
  }).catch(function () { return null; });
}

// recordHandoff(wpPool, record, resolved) → Promise<{ inserted, id } | null>
function recordHandoff(wpPool, rec, resolved) {
  if (!isHandoff(rec) || !rec.project_id) return Promise.resolve(null);
  var d = rec.decision;
  var env = rec.envelope || {};
  var crm = env.crm || {};
  return suggest(resolved, d).then(function (sugg) {
    var related = sugg && sugg.matching_parts && sugg.matching_parts.length === 1 ? sugg.matching_parts[0].product_uid : null;
    return wpPool.query(
      'INSERT INTO wp_handoffs (project_id, event_id, conversation_key, customer_ref_masked, channel, reason, intent, language, entities, facts, related_product_uid, suggested, status) ' +
      "VALUES ($1,$2,$3,$4,'whatsapp',$5,$6,$7,$8,$9,$10,$11,'REQUIRES_HUMAN') ON CONFLICT (event_id) DO NOTHING RETURNING id",
      [rec.project_id, rec.event_id || null, conversationKey(rec), env.customer_msisdn_masked || crm.conversation_id || null,
        String(d.reason || 'REQUIRES_HUMAN').slice(0, 64), d.intent ? String(d.intent).slice(0, 40) : null, d.language || null,
        d.entities ? JSON.stringify(d.entities) : null, d.facts ? JSON.stringify(d.facts) : null, related, sugg ? JSON.stringify(sugg) : null]
    ).then(function (r) { return { inserted: r.rows.length > 0, id: r.rows.length ? r.rows[0].id : null }; });
  });
}

var sharedPorts = ports.create({ resolveProject: function (id) { return store.resolve(id); } });

function onOutcome(rec) {
  if (!isHandoff(rec) || !rec.project_id) return Promise.resolve(null);
  return store.resolve(rec.project_id).then(function (resolved) {
    if (!resolved) return null;
    return recordHandoff(resolved.wpPool, rec, resolved);
  }).catch(function (e) {
    process.stderr.write(JSON.stringify({ at: new Date().toISOString(), component: 'wp-integration', error: 'HANDOFF_RECORD_FAILED', code: e && e.code ? e.code : null }) + '\n');
    return null;
  });
}

module.exports = {
  name: 'mythos-wp',
  ports: sharedPorts,
  onOutcome: onOutcome,
  isHandoff: isHandoff,
  conversationKey: conversationKey,
  recordHandoff: recordHandoff
};
