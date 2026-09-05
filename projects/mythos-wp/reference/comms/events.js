'use strict';
// =====================================================
// MYTHOS WP — provider-neutral event catalogue (MYTHOS-COMMS-9)
// projects/mythos-wp/reference/comms/events.js
//
// Stable names the Core writes to wp_inbound_events.event_name and
// wp_conversation_events.event_name and publishes on the SSE bus (`event`
// field; the legacy `type` field is kept for the UI). No provider name and no
// payload shape appears in these names.
// =====================================================
var EVENTS = [
  'message.received', 'message.sent', 'message.delivered', 'message.read', 'message.failed', 'message.status', 'message.duplicate', 'message.dry_run', 'message.note',
  'conversation.created', 'conversation.updated', 'conversation.assigned', 'conversation.resolved', 'conversation.reopened', 'conversation.read',
  'contact.created', 'contact.identity_added', 'contact.merged',
  'handoff.created', 'handoff.resolved',
  'ai.run', 'ai.suggested', 'ai.decided', 'ai.sent', 'ai.refused',
  'delivery.alarm', 'inbox.status', 'inbox.heartbeat', 'event.rejected', 'event.replayed'
];
var SET = {}; EVENTS.forEach(function (e) { SET[e] = true; });
// journal kind → event name (kept for the existing `kind` column)
var KIND_TO_EVENT = { created: 'conversation.created', message_in: 'message.received', message_out: 'message.sent', send_failed: 'message.failed', note: 'message.note', status: 'conversation.updated', assigned: 'conversation.assigned', tag: 'conversation.updated', ai_run: 'ai.run', ai_decision: 'ai.decided', ai_refused: 'ai.refused', handoff: 'handoff.created', delivery_alarm: 'delivery.alarm', replay: 'event.replayed', heartbeat: 'inbox.heartbeat', identity: 'contact.identity_added' };
// legacy SSE `type` → event name
var TYPE_TO_EVENT = { 'message.in': 'message.received', 'message.out': 'message.sent', 'message.status': 'message.status', 'message.note': 'message.note', 'conversation.updated': 'conversation.updated', 'conversation.read': 'conversation.read', 'inbox.status': 'inbox.status', 'ai.run': 'ai.run' };
var STATUS_TO_EVENT = { sent: 'message.sent', delivered: 'message.delivered', read: 'message.read', failed: 'message.failed', queued: 'message.status' };
function isEvent(name) { return SET[name] === true; }
function forKind(kind) { return KIND_TO_EVENT[kind] || 'conversation.updated'; }
function forType(type) { return TYPE_TO_EVENT[type] || null; }
function forStatus(status) { return STATUS_TO_EVENT[status] || 'message.status'; }
module.exports = { EVENTS: EVENTS, isEvent: isEvent, forKind: forKind, forType: forType, forStatus: forStatus, KIND_TO_EVENT: KIND_TO_EVENT };
