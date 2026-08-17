'use strict';
// =====================================================
// projects/mythos-ai-executor/core/dr-readiness.js
//
// AF. Disaster Recovery — runtime-state gap report (read-only).
//
// docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md §AF names the open half of
// Disaster Recovery: "Runtime-state DR (rebuilding queue/memory/state on a
// new host) is future work; a known blocker is that no off-host destination
// beyond GitHub exists yet." The existing off-host backup gate
// (docs/OFF_HOST_BACKUP_GATE.md, INF-BACKUP-AUTO-0) only ever covered three
// product databases (idauto, coolify-db, darhijama_prod) — it never touched
// this orchestrator's own runtime state under store.root(), which is
// explicitly never committed to Git (core/store.js header) and has no
// off-host copy of any kind.
//
// Building an actual backup needs a credential and a scheduled runner,
// both out of scope for a CORE-implement task under these hard limits.
// What is in scope, and what every later DR stage needs first, is an
// honest inventory of what would be lost on host failure. This module
// makes that gap inspectable: no network call, no mutation, no write.
// =====================================================

var fs = require('fs');
var path = require('path');

var store = require('./store');

var ENTITY_DIRS = [
  'goals', 'missions', 'tasks', 'executions', 'approvals',
  'reports', 'decisions', 'artifacts', 'memory', 'contexts'
];

var KNOWN_OFFHOST_TARGETS = [
  'idauto (PostgreSQL, off-host via R2 idauto/ prefix)',
  'coolify-db (PostgreSQL, off-host via R2 coolify-db/ prefix)',
  'darhijama_prod (MySQL, off-host via R2 darhijama-prod/ prefix)'
];

function dirStats(dir) {
  if (!fs.existsSync(dir)) return { exists: false, files: 0, bytes: 0, newest: null };
  var files = fs.readdirSync(dir).filter(function (f) {
    return fs.statSync(path.join(dir, f)).isFile();
  });
  var bytes = 0;
  var newest = null;
  files.forEach(function (f) {
    var st = fs.statSync(path.join(dir, f));
    bytes += st.size;
    var m = st.mtime.toISOString();
    if (!newest || m > newest) newest = m;
  });
  return { exists: true, files: files.length, bytes: bytes, newest: newest };
}

function eventsLogStats(root) {
  var full = path.join(root, 'events.log');
  if (!fs.existsSync(full)) return { exists: false, bytes: 0, lines: 0 };
  var st = fs.statSync(full);
  var lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean).length;
  return { exists: true, bytes: st.size, lines: lines };
}

// Local, read-only snapshot of what lives under the orchestration runtime
// root — no assertion about backup status, just what is physically present.
function inventory() {
  var root = store.root();
  var rootExists = fs.existsSync(root);
  var entities = {};
  ENTITY_DIRS.forEach(function (name) {
    entities[name] = dirStats(path.join(root, name));
  });
  var eventsLog = eventsLogStats(root);
  var totalFiles = Object.keys(entities).reduce(function (n, k) {
    return n + entities[k].files;
  }, 0) + (eventsLog.exists ? 1 : 0);

  return {
    generated_at: new Date().toISOString(),
    runtime_state_root: root,
    root_exists: rootExists,
    entities: entities,
    events_log: eventsLog,
    total_local_files: totalFiles
  };
}

// The DR readiness report: inventory plus the honest gap statement the
// AF section names. gap is true whenever local runtime state exists that
// has no off-host destination configured for it.
function report() {
  var inv = inventory();
  return {
    capability: 'AF. Disaster Recovery',
    scope: 'runtime-state gap visibility only — no backup performed, no credential used, no network call made',
    inventory: inv,
    off_host_backup: {
      configured: false,
      reason: 'OFF_HOST_BACKUP_GATE.md / INF-BACKUP-AUTO-0 cover the idauto, ' +
        'coolify-db and darhijama_prod product databases only; no off-host ' +
        'destination is wired for this orchestration runtime-state directory.',
      known_offhost_targets: KNOWN_OFFHOST_TARGETS
    },
    gap: inv.root_exists && inv.total_local_files > 0
  };
}

module.exports = {
  ENTITY_DIRS: ENTITY_DIRS,
  KNOWN_OFFHOST_TARGETS: KNOWN_OFFHOST_TARGETS,
  dirStats: dirStats,
  inventory: inventory,
  report: report
};
