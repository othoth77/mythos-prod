'use strict';
// =====================================================
// Mythos AI Executor — persistent task state
// projects/mythos-ai-executor/lib/state.js
//
// The executor's queue, checkpoints and reports all live OUTSIDE the
// Git-tracked source tree but are still persistent (AGENTS.md §4 forbids
// leaving real work in /tmp):
//
//   /home/ubuntu/mythos-ai-executor/tasks/<task-id>/
//       task.json        immutable task definition (redacted on write)
//       status.json      mutable execution state (single writer: the daemon)
//       checkpoint.json  last durable checkpoint (§15 of the mission)
//       report.json      structured result report
//       report.md        human-readable report
//       prompt.md        last prompt sent to the provider
//       stdout.log / stderr.log   redacted provider output
//       events.log       append-only JSONL of state transitions
//
// Path handling reuses the exact traversal guards proven in
// projects/mythos-orchestrator/lib/store.js: a task id is never joined
// into a path without passing the slug check, and every resolved path is
// re-verified to still be inside the tasks root.
//
// Writes are atomic (tmp + rename) so a crash mid-write can never leave
// a half-written status file — the daemon recovers from the previous
// consistent state instead.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

// Reuse the orchestrator's redaction — one secret-scrubbing implementation
// in the repository, not two competing ones.
var redact = require('../../mythos-orchestrator/lib/redact');

var DEFAULT_ROOT = path.join(os.homedir(), 'mythos-ai-executor');

// Task lifecycle. WAITING_FOR_QUOTA is deliberately a first-class state:
// quota exhaustion is not a failure and must never be recorded as one.
var STATUSES = [
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_QUOTA',
  'WAITING_RETRY',
  'COMPLETED',
  'FAILED',
  'BLOCKED',
  'CANCELLED'
];

// Legal transitions. Anything not listed here is a bug, and transition()
// refuses it loudly rather than silently corrupting the queue.
var TRANSITIONS = {
  QUEUED:            ['RUNNING', 'CANCELLED', 'BLOCKED'],
  RUNNING:           ['COMPLETED', 'FAILED', 'BLOCKED', 'WAITING_FOR_QUOTA', 'WAITING_RETRY', 'CANCELLED'],
  WAITING_FOR_QUOTA: ['RUNNING', 'CANCELLED', 'BLOCKED'],
  WAITING_RETRY:     ['RUNNING', 'CANCELLED', 'BLOCKED', 'FAILED'],
  COMPLETED:         [],
  FAILED:            ['QUEUED'],   // explicit re-queue only
  BLOCKED:           ['QUEUED'],   // explicit unblock only
  CANCELLED:         []
};

var TASK_ID_RE = /^[a-z0-9][a-z0-9-]{6,62}[a-z0-9]$/;
var FILE_NAME_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;

function root() {
  return process.env.MYTHOS_EXECUTOR_HOME || DEFAULT_ROOT;
}

function tasksRoot() { return path.join(root(), 'tasks'); }

function isValidTaskId(id) {
  return typeof id === 'string' && TASK_ID_RE.test(id) && id.indexOf('..') === -1;
}

function taskDir(taskId) {
  if (!isValidTaskId(taskId)) {
    throw new Error('INVALID_TASK_ID: refusing to resolve a path for ' + JSON.stringify(String(taskId)).slice(0, 80));
  }
  var dir = path.join(tasksRoot(), taskId);
  var parent = path.resolve(tasksRoot());
  if (path.dirname(path.resolve(dir)) !== parent) {
    throw new Error('TASK_PATH_ESCAPE: resolved task directory left the task root');
  }
  return dir;
}

function taskFile(taskId, name) {
  if (typeof name !== 'string' || !FILE_NAME_RE.test(name) || name.indexOf('..') !== -1) {
    throw new Error('INVALID_TASK_FILENAME: ' + JSON.stringify(String(name)).slice(0, 80));
  }
  var dir = taskDir(taskId);
  var full = path.join(dir, name);
  if (path.dirname(path.resolve(full)) !== path.resolve(dir)) {
    throw new Error('TASK_FILE_ESCAPE: resolved file left its task directory');
  }
  return full;
}

function ensureTaskDir(taskId) {
  var dir = taskDir(taskId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (e) { /* pre-existing dirs: best effort */ }
  return dir;
}

// Atomic write: the rename is the commit point. A reader either sees the
// previous complete file or the new complete file, never a torn one.
//
// A crash or reboot right after renameSync() is not enough on its own: on
// most filesystems (ext4 included) neither the tmp file's data nor the
// rename itself is guaranteed durable until fsynced. Without this, a
// power loss immediately after a status transition could revert
// status.json/checkpoint.json to their pre-transition content on reboot
// even though the daemon already acted on the transition — silently
// breaking the "survives reboots" half of durable execution. fsync the
// file before the rename and the containing directory after it so the
// commit point is actually on disk, not just visible to this process.
function writeAtomic(full, data) {
  var dir = path.dirname(full);
  var tmp = full + '.tmp-' + process.pid;
  var fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, data, 0, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, full);
  try {
    var dirFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch (e) { /* directory fsync unsupported on this filesystem: best effort */ }
}

function writeJSON(taskId, name, value) {
  var full = taskFile(taskId, name);
  writeAtomic(full, JSON.stringify(redact.redactValue(value), null, 2) + '\n');
  return full;
}

function readJSON(taskId, name) {
  var full = taskFile(taskId, name);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    return { __parseError: true, error: e.message };
  }
}

function writeText(taskId, name, text) {
  var full = taskFile(taskId, name);
  writeAtomic(full, redact.redact(String(text)));
  return full;
}

function readText(taskId, name) {
  var full = taskFile(taskId, name);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

// Structured event log (§22 of the mission): every transition carries the
// identifying fields so downstream tooling can filter without parsing prose.
function appendEvent(taskId, event, fields) {
  var entry = { ts: new Date().toISOString(), task_id: taskId, event: event };
  Object.keys(fields || {}).forEach(function (k) { entry[k] = fields[k]; });
  var line = JSON.stringify(redact.redactValue(entry)) + '\n';
  fs.appendFileSync(taskFile(taskId, 'events.log'), line, { encoding: 'utf8', mode: 0o600 });
}

function listTasks() {
  var dir = tasksRoot();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(isValidTaskId).sort();
}

function processAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function readStatus(taskId) {
  return readJSON(taskId, 'status.json');
}

// The single mutation chokepoint for task status. Refuses illegal
// transitions, stamps the change, and records it in events.log.
function transition(taskId, to, fields) {
  if (STATUSES.indexOf(to) === -1) {
    throw new Error('UNKNOWN_STATUS: ' + String(to));
  }
  var status = readStatus(taskId);
  if (!status) throw new Error('NO_STATUS: task ' + taskId + ' has no status.json');
  var from = status.status;
  if (from !== to && (TRANSITIONS[from] || []).indexOf(to) === -1) {
    throw new Error('ILLEGAL_TRANSITION: ' + from + ' -> ' + to + ' for task ' + taskId);
  }
  status.status = to;
  status.updated_at = new Date().toISOString();
  Object.keys(fields || {}).forEach(function (k) { status[k] = fields[k]; });
  writeJSON(taskId, 'status.json', status);
  appendEvent(taskId, 'transition', { from: from, to: to });
  return status;
}

// A RUNNING status whose recorded pid is gone means the execution was
// interrupted (crash, reboot, kill). The daemon converts these to
// WAITING_RETRY on startup so work resumes instead of hanging forever.
function effectiveStatus(status) {
  if (!status) return 'unknown';
  if (status.status !== 'RUNNING') return status.status;
  if (processAlive(status.pid)) return 'RUNNING';
  return 'INTERRUPTED';
}

module.exports = {
  root: root,
  tasksRoot: tasksRoot,
  STATUSES: STATUSES,
  TRANSITIONS: TRANSITIONS,
  isValidTaskId: isValidTaskId,
  taskDir: taskDir,
  taskFile: taskFile,
  ensureTaskDir: ensureTaskDir,
  writeJSON: writeJSON,
  readJSON: readJSON,
  writeText: writeText,
  readText: readText,
  appendEvent: appendEvent,
  listTasks: listTasks,
  processAlive: processAlive,
  readStatus: readStatus,
  transition: transition,
  effectiveStatus: effectiveStatus,
  TASK_ID_RE: TASK_ID_RE
};
