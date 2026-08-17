'use strict';
// =====================================================
// Mythos Orchestration Core — AF Disaster Recovery: runtime-state gap report
// projects/mythos-ai-executor/core/dr-gap-report.js
//
// Read-only. This module never backs anything up, moves anything, or writes
// outside its own return value — it only enumerates what the orchestration
// store (store.js) currently holds under its root and states, honestly,
// whether an off-host destination exists for that data today.
//
// It deliberately does not extend or call the existing off-host database
// backup tooling (projects/idauto/ops/offhost-backup.js). That path is
// scoped to three named application databases (idauto, coolify,
// darhijama_prod) per docs/OFF_HOST_BACKUP_GATE.md §0/§1 — it has no
// destination, config entry or credential reference for this orchestration
// runtime-state root, and store.js deliberately never writes this data to
// Git. Runtime-state DR (rebuilding queue/memory/state on a new host)
// remains blocked until an owner authorises and configures a destination
// for this specific data; this module exists to make that gap
// machine-checkable instead of only prose in a doc.
// =====================================================

var fs = require('fs');
var path = require('path');
var store = require('./store');

var ENTITY_TYPES = [
  'goal', 'mission', 'task', 'execution', 'approval',
  'report', 'decision', 'artifact', 'memory_entry', 'context'
];

var OFFHOST_GAP_REASON =
  'The R2 off-host destination closed by docs/OFF_HOST_BACKUP_GATE.md is scoped ' +
  'to three named application databases (idauto, coolify, darhijama_prod); it has ' +
  'no configuration entry, credential reference or connector for the orchestration ' +
  'runtime-state root. GitHub carries source code and documentation only — the ' +
  'store is deliberately never written to Git (see store.js header). No off-host ' +
  'copy of queue/memory/state exists today.';

function countEntity(entityType) {
  try {
    return store.list(entityType).length;
  } catch (e) {
    return 0;
  }
}

function eventsLogInfo(root) {
  var full = path.join(root, 'events.log');
  if (!fs.existsSync(full)) return { present: false, bytes: 0 };
  try {
    return { present: true, bytes: fs.statSync(full).size };
  } catch (e) {
    return { present: false, bytes: 0 };
  }
}

// Builds the runtime-state gap report. Read-only: only fs.existsSync/statSync
// and store.list() (itself read-only) are called; nothing is written.
function buildReport() {
  var root = store.root();
  var rootExists = fs.existsSync(root);
  var entities = {};
  var total = 0;

  ENTITY_TYPES.forEach(function (type) {
    var n = countEntity(type);
    entities[type] = n;
    total += n;
  });

  return {
    generated_at: new Date().toISOString(),
    runtime_state_root: root,
    root_exists: rootExists,
    entities: entities,
    total_entities: total,
    events_log: eventsLogInfo(root),
    off_host_destination_configured: false,
    off_host_destination_reason: OFFHOST_GAP_REASON,
    rebuild_on_new_host: 'NOT_POSSIBLE',
    rebuild_blocker: 'NO_OFFHOST_DESTINATION_FOR_RUNTIME_STATE'
  };
}

module.exports = {
  ENTITY_TYPES: ENTITY_TYPES,
  buildReport: buildReport
};
