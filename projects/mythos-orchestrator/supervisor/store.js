'use strict';
// =====================================================
// MYTHOS supervisor — durable state
// projects/mythos-orchestrator/supervisor/store.js
//
//   <home>/tasks/<TASK_ID>.json   one file per supervisor task (atomic write)
//   <home>/journal.jsonl          append-only event log, correlation ids on
//                                 every line — the trace of what happened
//   <home>/budget.json            OpenAI calls per UTC day and per root
//   <home>/tick.lock              one tick at a time (stale locks are taken
//                                 over only when their process is gone)
//
// <home> = $MYTHOS_SUPERVISOR_HOME or /home/deploy/mythos-orchestrator/supervisor.
// Everything is written 0600 inside a 0700 directory and passes through the
// shared redaction first, so a secret-shaped string in a report or an error
// is never persisted verbatim.
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var redact = require('../lib/redact');

var DEFAULT_HOME = '/home/deploy/mythos-orchestrator/supervisor';
var TASK_ID_RE = /^SUP-[A-Z0-9]{6,12}(-R[0-9]{1,2})*$/;

function home() { return process.env.MYTHOS_SUPERVISOR_HOME || DEFAULT_HOME; }
function tasksDir() { return path.join(home(), 'tasks'); }

function ensureDirs() {
  [home(), tasksDir()].forEach(function (d) {
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(d, 0o700); } catch (e) { /* best effort */ }
  });
}

function isValidTaskId(id) { return typeof id === 'string' && TASK_ID_RE.test(id); }

function newId(prefix, len) {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var bytes = crypto.randomBytes(len || 8);
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return prefix + out;
}

// write → fsync → rename: a crash leaves the old file or the new one, never half.
function atomicWrite(file, text) {
  var tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  var fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function taskFile(id) {
  if (!isValidTaskId(id)) throw new Error('INVALID_TASK_ID: ' + JSON.stringify(String(id)).slice(0, 60));
  return path.join(tasksDir(), id + '.json');
}

function saveTask(task) {
  ensureDirs();
  task.revision = (task.revision || 0) + 1;
  task.updated_at = task.updated_at || new Date().toISOString();
  atomicWrite(taskFile(task.task_id), JSON.stringify(redact.redactValue(task), null, 2) + '\n');
  return task;
}

function loadTask(id) {
  var f = taskFile(id);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function listTasks() {
  if (!fs.existsSync(tasksDir())) return [];
  return fs.readdirSync(tasksDir())
    .filter(function (f) { return /\.json$/.test(f) && isValidTaskId(f.slice(0, -5)); })
    .map(function (f) { return JSON.parse(fs.readFileSync(path.join(tasksDir(), f), 'utf8')); })
    .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)) || String(a.task_id).localeCompare(String(b.task_id)); });
}

function journal(event) {
  ensureDirs();
  var line = Object.assign({ ts: new Date().toISOString() }, event);
  fs.appendFileSync(path.join(home(), 'journal.jsonl'), JSON.stringify(redact.redactValue(line)) + '\n', { mode: 0o600 });
  return line;
}

function readJournal(filter) {
  var f = path.join(home(), 'journal.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(function (l) {
    try { return JSON.parse(l); } catch (e) { return { unparseable: true }; }
  }).filter(function (e) { return !filter || filter(e); });
}

// ---------------------------------------------------------------------------
// Single-tick lock
// ---------------------------------------------------------------------------

function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function acquireLock() {
  ensureDirs();
  var file = path.join(home(), 'tick.lock');
  var body = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  for (var i = 0; i < 2; i++) {
    try {
      var fd = fs.openSync(file, 'wx', 0o600);
      fs.writeSync(fd, body);
      fs.closeSync(fd);
      return function release() {
        try {
          var cur = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (cur.pid === process.pid) fs.unlinkSync(file);
        } catch (e) { /* already gone */ }
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      var holder = null;
      try { holder = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (r) { holder = null; }
      if (holder && processAlive(holder.pid)) return null; // a live tick owns it
      try { fs.unlinkSync(file); } catch (u) { /* raced */ }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// OpenAI call budget
// ---------------------------------------------------------------------------

function budgetFile() { return path.join(home(), 'budget.json'); }

function readBudget() {
  try { return JSON.parse(fs.readFileSync(budgetFile(), 'utf8')); } catch (e) { return { days: {}, roots: {} }; }
}

function today() { return new Date().toISOString().slice(0, 10); }

function budgetState(rootId) {
  var b = readBudget();
  return { day: (b.days || {})[today()] || 0, root: (b.roots || {})[rootId] || 0 };
}

function countCall(rootId) {
  ensureDirs();
  var b = readBudget();
  b.days = b.days || {};
  b.roots = b.roots || {};
  b.days[today()] = (b.days[today()] || 0) + 1;
  b.roots[rootId] = (b.roots[rootId] || 0) + 1;
  atomicWrite(budgetFile(), JSON.stringify(b, null, 2) + '\n');
  return budgetState(rootId);
}

module.exports = {
  home: home,
  tasksDir: tasksDir,
  ensureDirs: ensureDirs,
  isValidTaskId: isValidTaskId,
  newId: newId,
  atomicWrite: atomicWrite,
  saveTask: saveTask,
  loadTask: loadTask,
  listTasks: listTasks,
  journal: journal,
  readJournal: readJournal,
  acquireLock: acquireLock,
  processAlive: processAlive,
  budgetState: budgetState,
  countCall: countCall,
  TASK_ID_RE: TASK_ID_RE
};
