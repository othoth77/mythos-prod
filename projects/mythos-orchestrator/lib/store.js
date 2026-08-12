'use strict';
// =====================================================
// Mythos Orchestrator — persistent task store
// projects/mythos-orchestrator/lib/store.js
//
// Runtime state lives OUTSIDE the Git-tracked source tree but is still
// persistent (AGENTS.md §4 forbids leaving real work in /tmp):
//
//   /home/deploy/mythos-orchestrator/tasks/<task-id>/
//       task.json  prompt.md  stdout.log  stderr.log  result.json  status.json
//
// Every path is resolved through taskDir()/taskFile(), which reject any
// id or filename that could escape the task directory. A task id is
// never concatenated into a path without passing that check first.
// =====================================================

var fs = require('fs');
var path = require('path');
var redact = require('./redact');

var DEFAULT_ROOT = '/home/deploy/mythos-orchestrator';

function root() {
  return process.env.MYTHOS_ORCHESTRATOR_HOME || DEFAULT_ROOT;
}

function tasksRoot() { return path.join(root(), 'tasks'); }

// A task id must be a plain slug. This is the single chokepoint that makes
// path traversal impossible — '..', '/', '\' and absolute paths all fail.
var TASK_ID_RE = /^[a-z0-9][a-z0-9-]{6,62}[a-z0-9]$/;

function isValidTaskId(id) {
  return typeof id === 'string' && TASK_ID_RE.test(id) && id.indexOf('..') === -1;
}

function taskDir(taskId) {
  if (!isValidTaskId(taskId)) {
    throw new Error('INVALID_TASK_ID: refusing to resolve a path for ' + JSON.stringify(String(taskId)).slice(0, 80));
  }
  var dir = path.join(tasksRoot(), taskId);
  // Defence in depth: the resolved directory must still be directly
  // inside tasksRoot() even if the regex is ever loosened.
  var parent = path.resolve(tasksRoot());
  if (path.dirname(path.resolve(dir)) !== parent) {
    throw new Error('TASK_PATH_ESCAPE: resolved task directory left the task root');
  }
  return dir;
}

// Resolves a file inside a task directory. `name` must be a bare filename;
// anything containing a separator is rejected so a task cannot redirect its
// own prompt or result outside its directory.
var FILE_NAME_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;

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
  try { fs.chmodSync(dir, 0o700); } catch (e) { /* best effort on pre-existing dirs */ }
  return dir;
}

function writeJSON(taskId, name, value) {
  var full = taskFile(taskId, name);
  fs.writeFileSync(full, JSON.stringify(redact.redactValue(value), null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
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
  fs.writeFileSync(full, redact.redact(String(text)), { encoding: 'utf8', mode: 0o600 });
  return full;
}

function readText(taskId, name) {
  var full = taskFile(taskId, name);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

function listTasks() {
  var dir = tasksRoot();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(isValidTaskId).sort();
}

// A task is 'orphaned' when its status says running but the recorded
// process is gone. A missing terminal is never treated as failure on its
// own — the status file and the process are the evidence.
function processAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists but owned by another user
  }
}

function effectiveStatus(status) {
  if (!status) return 'unknown';
  if (status.state !== 'running') return status.state;
  if (processAlive(status.pid)) return 'running';
  return 'orphaned';
}

module.exports = {
  root: root,
  tasksRoot: tasksRoot,
  isValidTaskId: isValidTaskId,
  taskDir: taskDir,
  taskFile: taskFile,
  ensureTaskDir: ensureTaskDir,
  writeJSON: writeJSON,
  readJSON: readJSON,
  writeText: writeText,
  readText: readText,
  listTasks: listTasks,
  processAlive: processAlive,
  effectiveStatus: effectiveStatus,
  TASK_ID_RE: TASK_ID_RE
};
