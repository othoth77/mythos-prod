'use strict';
// =====================================================
// Mythos Orchestration Core — event engine (Phase 2K)
// projects/mythos-ai-executor/core/events.js
//
// Typed, durable orchestration events. The durable stream (JSONL under
// the orchestration root, written by core/store.js with redaction) is
// the source of truth; in-process subscribers and the optional n8n
// forward are DERIVED views:
//
//   * subscribers run isolated — a throwing handler is recorded, never
//     propagated, and can never corrupt the stream;
//   * the n8n forward is a best-effort fire-and-forget adapter (n8n is
//     an automation adapter, NOT the orchestration state store); it is
//     off unless MYTHOS_EVENTS_WEBHOOK is configured.
//
// replay() reads the durable stream back — that is restart recovery for
// anything event-driven.
// =====================================================

var http = require('http');
var url = require('url');

var domain = require('./domain');
var store = require('./store');

var subscribers = [];   // { type or '*', handler }

function subscribe(type, handler) {
  if (type !== '*' && domain.EVENT_TYPES.indexOf(type) === -1) {
    throw new Error('UNKNOWN_EVENT_TYPE: ' + String(type).slice(0, 60));
  }
  if (typeof handler !== 'function') throw new Error('SUBSCRIBE_NEEDS_HANDLER');
  var entry = { type: type, handler: handler };
  subscribers.push(entry);
  return function unsubscribe() {
    var i = subscribers.indexOf(entry);
    if (i !== -1) subscribers.splice(i, 1);
  };
}

function resetSubscribersForTests() { subscribers = []; }

// Best-effort n8n forward. Never throws, never blocks the emitter, and
// carries no secrets (the event was already redacted on persistence).
function forwardToWebhook(event, forwarder) {
  var target = process.env.MYTHOS_EVENTS_WEBHOOK;
  if (typeof forwarder === 'function') { try { forwarder(event); } catch (e) { /* adapter-only */ } return; }
  if (!target) return;
  try {
    var endpoint = url.parse(target);
    var payload = JSON.stringify(event);
    var req = http.request({
      hostname: endpoint.hostname, port: endpoint.port, path: endpoint.path,
      method: 'POST', timeout: 3000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    });
    req.on('error', function () { /* fire and forget */ });
    req.on('timeout', function () { req.destroy(); });
    req.end(payload);
  } catch (e) { /* adapter failure never reaches orchestration state */ }
}

// Emits one event: durable first, then derived views.
function emit(eventType, fields, opts) {
  fields = fields || {};
  var event = store.appendEventLine({
    event_type: eventType,
    subject_id: fields.subject_id || null,
    correlation_id: fields.correlation_id,
    project: fields.project || null,
    detail: fields.detail || {}
  });
  subscribers.forEach(function (s) {
    if (s.type !== '*' && s.type !== eventType) return;
    try {
      s.handler(event);
    } catch (e) {
      // Recorded, never propagated: a bad subscriber cannot break emit.
      try {
        store.appendEventLine({
          event_type: 'DECISION_MADE', subject_id: event.id,
          detail: { subscriber_error: String(e.message).slice(0, 200), for_event: eventType }
        });
      } catch (e2) { /* give up quietly — durability of the original event is intact */ }
    }
  });
  forwardToWebhook(event, opts && opts.forwarder);
  return event;
}

function replay(sinceIso, limit) {
  return store.readEvents(sinceIso, limit);
}

module.exports = {
  emit: emit,
  subscribe: subscribe,
  replay: replay,
  resetSubscribersForTests: resetSubscribersForTests
};
