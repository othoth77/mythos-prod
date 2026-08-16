'use strict';
// =====================================================
// Mythos Orchestration Core — persistent entity store (Phase 2A)
// projects/mythos-ai-executor/core/store.js
//
// Durable orchestration state, separate from (and beside) the Phase 1
// executor's per-task store:
//
//   /home/ubuntu/mythos-ai-executor/orchestration/
//       goals/<id>.json  missions/<id>.json  tasks/<id>.json
//       executions/<id>.json  approvals/<id>.json  reports/<id>.json
//       decisions/<id>.json  artifacts/<id>.json
//       events.log                (global durable JSONL event stream)
//
// Same battle-tested rules as the Phase 1 store: never /tmp, never Git,
// 0700 dirs / 0600 files, atomic tmp+rename writes, redaction on every
// byte persisted, and path assembly only through validated ids.
//
// Status changes go through transition(), which enforces the domain
// transition tables — the single mutation chokepoint (duplicate-creation
// protection lives in create(), which refuses an existing id).
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var domain = require('./domain');
var redact = require('../../mythos-orchestrator/lib/redact');

var ENTITY_DIRS = {
  goal: 'goals', mission: 'missions', task: 'tasks', execution: 'executions',
  approval: 'approvals', report: 'reports', decision: 'decisions',
  artifact: 'artifacts', memory_entry: 'memory', context: 'contexts'
};

var TRANSITION_TABLES = {
  task: domain.TASK_TRANSITIONS,
  goal: {
    RECEIVED: ['PLANNING', 'CANCELLED'],
    PLANNING: ['ACTIVE', 'FAILED', 'CANCELLED'],
    ACTIVE: ['COMPLETED', 'FAILED', 'CANCELLED'],
    COMPLETED: [], FAILED: ['PLANNING'], CANCELLED: []
  },
  mission: {
    PLANNED: ['VALIDATED', 'CANCELLED', 'FAILED'],
    VALIDATED: ['RUNNING', 'CANCELLED'],
    RUNNING: ['WAITING', 'INTEGRATING', 'COMPLETED', 'FAILED', 'CANCELLED'],
    WAITING: ['RUNNING', 'FAILED', 'CANCELLED'],
    INTEGRATING: ['COMPLETED', 'FAILED', 'RUNNING'],
    COMPLETED: [], FAILED: ['PLANNED'], CANCELLED: []
  }
};

function root() {
  return path.join(
    process.env.MYTHOS_EXECUTOR_HOME || path.join(os.homedir(), 'mythos-ai-executor'),
    'orchestration'
  );
}

function entityDir(entityType) {
  var dir = ENTITY_DIRS[entityType];
  if (!dir) throw new Error('UNSTORABLE_ENTITY_TYPE: ' + String(entityType));
  return path.join(root(), dir);
}

function entityFile(entityType, id) {
  if (!domain.isValidId(id)) {
    throw new Error('INVALID_ID: refusing path for ' + JSON.stringify(String(id)).slice(0, 60));
  }
  var dir = entityDir(entityType);
  var full = path.join(dir, id + '.json');
  if (path.dirname(path.resolve(full)) !== path.resolve(dir)) {
    throw new Error('PATH_ESCAPE: resolved entity file left its directory');
  }
  return full;
}

function writeAtomic(full, data) {
  fs.mkdirSync(path.dirname(full), { recursive: true, mode: 0o700 });
  var tmp = full + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, full);
}

function save(entity) {
  entity.updated_at = new Date().toISOString();
  var full = entityFile(entity.entity_type, entity.id);
  writeAtomic(full, JSON.stringify(redact.redactValue(entity), null, 2) + '\n');
  return entity;
}

// Creation refuses an existing id — duplicate-task protection at the
// persistence boundary, not just in caller logic.
function create(entity) {
  var full = entityFile(entity.entity_type, entity.id);
  if (fs.existsSync(full)) {
    throw new Error('DUPLICATE_ENTITY: ' + entity.entity_type + ' ' + entity.id + ' already exists');
  }
  return save(entity);
}

function load(entityType, id) {
  var full = entityFile(entityType, id);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    return { __parseError: true, id: id, entity_type: entityType, error: e.message };
  }
}

function list(entityType, filter) {
  var dir = entityDir(entityType);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(function (f) { return /\.json$/.test(f); })
    .map(function (f) { return load(entityType, f.replace(/\.json$/, '')); })
    .filter(function (e) { return e && !e.__parseError && (!filter || filter(e)); })
    .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
}

// The single status-mutation chokepoint for stored entities.
function transition(entityType, id, to, fields) {
  var entity = load(entityType, id);
  if (!entity) throw new Error('NO_SUCH_ENTITY: ' + entityType + ' ' + id);
  var table = TRANSITION_TABLES[entityType];
  if (table) domain.checkTransition(table, entity.status, to, entityType + ' ' + id);
  var from = entity.status;
  entity.status = to;
  Object.keys(fields || {}).forEach(function (k) { entity[k] = fields[k]; });
  save(entity);
  appendEventLine({
    event_type: entityType === 'task' ? inferTaskEvent(from, to) : 'DECISION_MADE',
    subject_id: id,
    detail: { entity_type: entityType, from: from, to: to }
  });
  return entity;
}

function inferTaskEvent(from, to) {
  if (to === 'RUNNING' && from !== 'RUNNING') return from === 'WAITING_FOR_QUOTA' ? 'TASK_RESUMED' : 'TASK_STARTED';
  if (to === 'COMPLETED') return 'TASK_COMPLETED';
  if (to === 'FAILED') return 'TASK_FAILED';
  if (to === 'RETRYING') return 'TASK_RETRYING';
  if (to === 'WAITING_FOR_QUOTA') return 'QUOTA_EXHAUSTED';
  if (to.indexOf('WAITING') === 0) return 'TASK_WAITING';
  return 'DECISION_MADE';
}

// --- Durable global event stream ------------------------------------------------

function eventsFile() { return path.join(root(), 'events.log'); }

function appendEventLine(fields) {
  var event = domain.createEvent({
    event_type: fields.event_type,
    subject_id: fields.subject_id,
    correlation_id: fields.correlation_id,
    project: fields.project,
    detail: fields.detail
  });
  fs.mkdirSync(root(), { recursive: true, mode: 0o700 });
  fs.appendFileSync(eventsFile(), JSON.stringify(redact.redactValue(event)) + '\n',
    { encoding: 'utf8', mode: 0o600 });
  return event;
}

function readEvents(sinceIso, limit) {
  if (!fs.existsSync(eventsFile())) return [];
  var lines = fs.readFileSync(eventsFile(), 'utf8').trim().split('\n').filter(Boolean);
  var events = [];
  for (var i = 0; i < lines.length; i++) {
    try {
      var e = JSON.parse(lines[i]);
      if (!sinceIso || e.created_at > sinceIso) events.push(e);
    } catch (err) { /* torn tail line during crash — skip, never crash */ }
  }
  return limit ? events.slice(-limit) : events;
}

module.exports = {
  root: root,
  entityFile: entityFile,
  save: save,
  create: create,
  load: load,
  list: list,
  transition: transition,
  appendEventLine: appendEventLine,
  readEvents: readEvents,
  TRANSITION_TABLES: TRANSITION_TABLES
};
