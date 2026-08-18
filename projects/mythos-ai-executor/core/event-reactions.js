'use strict';
// =====================================================
// Mythos Orchestration Core — event bus reactions (Phase 6 precursor)
// projects/mythos-ai-executor/core/event-reactions.js
//
// Roadmap capability Y (Event Bus / Event Engine, docs/
// MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md §14) calls for typed events
// driving reactive automation. The precursors already exist: the durable
// per-task JSONL event stream and typed subscribe() API (core/events.js,
// unmodified by this module), and the best-effort ntfy notifier
// (projects/mythos-orchestrator/notify.sh, unmodified by this module).
// This module is the missing wire between them: a read-only consumer of
// the public events.subscribe() API that reacts to a curated set of
// high-signal event types with a best-effort notification.
//
// Deliberately NOT wired into the daemon or campaign runner here — that
// is an owner-scheduled follow-up. This module only registers reactions
// when a caller explicitly asks it to.
// =====================================================

var path = require('path');
var childProcess = require('child_process');

var DEFAULT_NOTIFY_SCRIPT = path.join(__dirname, '..', '..', 'mythos-orchestrator', 'notify.sh');

// event_type -> notify.sh <event> name. Reacting to every event type
// (BUDGET_CHECKED, RESERVATION_HEARTBEAT, ...) would turn a notification
// channel into noise, so only the small set that already denotes "an
// owner probably wants to know" is wired up here.
var EVENT_MAP = {
  MISSION_FAILED: 'task_failed',
  MISSION_COMPLETED: 'task_completed',
  APPROVAL_REQUESTED: 'approval_required',
  POLICY_DENIED: 'orchestrator_error',
  QUOTA_EXHAUSTED: 'orchestrator_error',
  PROVIDER_UNAVAILABLE: 'orchestrator_error',
  ROLLBACK: 'orchestrator_error'
};

function buildStage(event) {
  return (event.project ? event.project + '/' : '') + (event.subject_id || event.event_type);
}

function buildDetail(event) {
  try { return JSON.stringify(event.detail || {}).slice(0, 240); }
  catch (e) { return ''; }
}

// Registers ntfy reactions on an events module (the real core/events.js in
// production, a fake in tests). Returns an unregister() function that
// removes every subscription this call added. Never throws — a spawn
// failure is swallowed the same way notify.sh itself swallows a network
// failure, so a notification outage can never affect orchestration state.
function registerNtfyReactions(eventsModule, opts) {
  opts = opts || {};
  var notifyScript = opts.notifyScript || DEFAULT_NOTIFY_SCRIPT;
  var spawn = opts.spawn || childProcess.spawn;
  var unsubscribers = [];

  Object.keys(EVENT_MAP).forEach(function (eventType) {
    var notifyEvent = EVENT_MAP[eventType];
    unsubscribers.push(eventsModule.subscribe(eventType, function (event) {
      try {
        var child = spawn(notifyScript, [notifyEvent, buildStage(event), buildDetail(event)],
          { stdio: 'ignore', detached: true });
        if (child && child.on) child.on('error', function () { /* best-effort, never propagate */ });
        if (child && typeof child.unref === 'function') child.unref();
      } catch (e) { /* notification is never allowed to affect orchestration state */ }
    }));
  });

  return function unregister() {
    unsubscribers.forEach(function (unsubscribe) { unsubscribe(); });
  };
}

module.exports = {
  EVENT_MAP: EVENT_MAP,
  registerNtfyReactions: registerNtfyReactions
};
