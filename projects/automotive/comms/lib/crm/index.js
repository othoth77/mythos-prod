'use strict';
// =====================================================
// MYTHOS AUTO customer communication — CRM / inbox adapter registry
// projects/automotive/comms/lib/crm/index.js
//
// The CRM is where the conversation lives: shared inbox, agents,
// assignment, contacts, tags, notes, history, templates, permissions. MYTHOS
// does not rebuild any of that. It talks to the CRM through ONE adapter
// contract, so the CRM — and, behind it, the WhatsApp provider the CRM is
// connected to — is replaceable without touching the router or the
// business handlers.
//
// Adapter contract (every adapter exports exactly this):
//
//   id                 string, matches config `crm.adapter`
//   describe()         { id, inbound, outbound, providers_behind, notes } — no secrets
//   authorizeWebhook(o) { ok, reason }   o = { query, headers, expectedToken }
//                      constant-time; the token never appears in the result
//   parseWebhook(body) { accepted, reason, envelope }
//                      accepted=false is NOT an error: it is every event the
//                      CRM emits that is not an incoming customer message
//   sendReply(o)       Promise<{ ok, status, crm_message_id, error }>
//                      o = { baseUrl, accountId, inboxId, conversationId,
//                            apiToken, text, timeoutMs, allowPublic }
//                      MUST NOT throw for an HTTP error status, MUST NOT
//                      return or log the token, MUST refuse a non-private
//                      host unless allowPublic, MUST NOT retry internally.
//
// Two adapters exist:
//   chatwoot   the selected inbox/CRM component (#172; deployment blocked
//              on host resources — docs/MYTHOS_AUTO_WHATSAPP_CRM_ARCHITECTURE.md §4)
//   evolution  the lightweight path (#173): the existing private Evolution
//              gateway on a separate customer instance, no CRM in between
// The rest of the layer is written against the contract, not an adapter;
// swapping the transport is a configuration change (`crm.adapter`).
// =====================================================

var chatwoot = require('./chatwoot');
var evolution = require('./evolution');

var ADAPTERS = { chatwoot: chatwoot, evolution: evolution };

function get(id) {
  return ADAPTERS[id] || null;
}

module.exports = { ADAPTERS: ADAPTERS, get: get };
