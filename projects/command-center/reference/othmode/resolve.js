'use strict';
// =====================================================
// OTHMODE — path resolution and safe file reading
// projects/command-center/reference/othmode/resolve.js
//
// Every OTHMODE read model is file-backed: it reads existing stores that
// other engines own (executor configs, projects/meta, status-center
// output, the knowledge store) and never writes them. This module is the
// one place that knows where those files are, so tests can repoint
// everything with environment variables and production paths live in
// exactly one file.
//
// FAIL-SOFT vs FAIL-CLOSED:
//  * A read model over someone else's data fails SOFT: an absent file
//    yields an empty result plus a `reason`, never a crash — the UI shows
//    an informative empty state.
//  * The OTHMODE store (evolution memory, recovery records, the OthMode
//    switch) fails CLOSED: absent store means the feature reports itself
//    unprovisioned and refuses writes. A disabled layer is a normal,
//    reportable state — same contract as the oth-knowledge boundary.
// =====================================================

var fs = require('fs');
var path = require('path');

// reference/othmode → reference → command-center → projects → repo root
var REPO_ROOT = process.env.OTHMODE_REPO_ROOT ||
  path.resolve(__dirname, '..', '..', '..', '..');

// The OTHMODE-owned runtime store. Outside Git, provisioned by the
// operator (0700, deploy-owned) — see docs/othmode/OTHMODE_EVOLUTION.md.
function storeRoot() {
  return process.env.OTHMODE_STORE_ROOT || '/home/deploy/oth-evolution-store';
}

function repoPath() {
  var parts = Array.prototype.slice.call(arguments);
  return path.join.apply(path, [REPO_ROOT].concat(parts));
}

// Status Center live output on the production host (owner-controlled
// surface; OTHMODE only ever reads it).
function statusDataDir() {
  return process.env.OTHMODE_STATUS_DATA_DIR || '/var/www/status.mythosprod.xyz/data';
}

// Executor / orchestrator runtime state (their own stores; read-only here).
function executorTasksDir() {
  return process.env.OTHMODE_EXECUTOR_TASKS_DIR || '/home/ubuntu/mythos-ai-executor/tasks';
}
function orchestratorTasksDir() {
  return process.env.OTHMODE_ORCHESTRATOR_TASKS_DIR || '/home/deploy/mythos-orchestrator/tasks';
}

function readJson(file) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(file, 'utf8')), file: file };
  } catch (e) {
    return { ok: false, data: null, file: file, reason: e.code === 'ENOENT' ? 'absent' : 'unreadable' };
  }
}

function readText(file) {
  try {
    return { ok: true, data: fs.readFileSync(file, 'utf8'), file: file };
  } catch (e) {
    return { ok: false, data: null, file: file, reason: e.code === 'ENOENT' ? 'absent' : 'unreadable' };
  }
}

// JSONL reader with a hard line cap: OTHMODE never loads an unbounded
// history into one response (performance rule §40 of the implementation
// order). Reads the LAST `cap` parseable lines.
function readJsonlTail(file, cap) {
  var res = readText(file);
  if (!res.ok) return { ok: false, rows: [], reason: res.reason, file: file };
  var lines = res.data.split('\n');
  var rows = [];
  for (var i = lines.length - 1; i >= 0 && rows.length < cap; i--) {
    var line = lines[i].trim();
    if (!line) continue;
    try { rows.unshift(JSON.parse(line)); } catch (e) { /* torn line — skip */ }
  }
  return { ok: true, rows: rows, file: file };
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(function (d) { return d.isDirectory(); })
      .map(function (d) { return d.name; });
  } catch (e) { return []; }
}

function exists(file) {
  try { fs.accessSync(file); return true; } catch (e) { return false; }
}

// Tiny mtime-keyed cache so hot read models do not re-read and re-parse
// unchanged files on every request, without ever serving a stale parse of
// a changed file.
var _cache = {};
function cachedJson(file) {
  var stat;
  try { stat = fs.statSync(file); } catch (e) {
    delete _cache[file];
    return { ok: false, data: null, file: file, reason: e.code === 'ENOENT' ? 'absent' : 'unreadable' };
  }
  var entry = _cache[file];
  if (entry && entry.mtimeMs === stat.mtimeMs) return entry.result;
  var result = readJson(file);
  _cache[file] = { mtimeMs: stat.mtimeMs, result: result };
  return result;
}

module.exports = {
  REPO_ROOT: REPO_ROOT,
  repoPath: repoPath,
  storeRoot: storeRoot,
  statusDataDir: statusDataDir,
  executorTasksDir: executorTasksDir,
  orchestratorTasksDir: orchestratorTasksDir,
  readJson: readJson,
  readText: readText,
  readJsonlTail: readJsonlTail,
  listDirs: listDirs,
  exists: exists,
  cachedJson: cachedJson
};
