'use strict';
// =====================================================
// OTHMODE — Task Reports (the persistent operational record)
// projects/command-center/reference/othmode/tasks.js
//
// Every command a user explicitly activates with the standalone keyword
// "othmode" is an OTHMODE Task: created RUNNING at activation, finished
// in exactly one terminal status. The FULL report lives here (OTHMODE is
// the detailed operational history); the Claude conversation only ever
// carries a short receipt. No OTHMODE operation may disappear without a
// persistent record — a task that never reached execution is still
// recorded (BLOCKED, REJECTED, CANCELLED…).
//
// This is NOT a second history system: records live in the existing
// OTHMODE store (append-only JSONL, same fail-closed contract as the
// evolution stream) and surface as a fourth source of the existing
// unified Command History read model (history.js). Updates are new
// records folded by task_id — nothing is ever rewritten.
//
// A NORMAL Claude command (no standalone "othmode") is never recorded
// here: createTask refuses non-activated command text, so the guarantee
// "normal Claude creates no task" is enforced at the writer, not by
// caller discipline.
//
// SECURITY: same boundaries as every other OTHMODE write — the routes
// layer authenticates and runs the secret gate over the whole payload;
// this module additionally never accepts free-form top-level keys, only
// the closed report sections below. The keyword grants no permission.
// =====================================================

var store = require('./store.js');
var activation = require('./activation.js');

// Closed vocabularies — extended only by review, like evolution.js.
var STATUSES = ['RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED', 'REJECTED'];
var TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED', 'REJECTED'];
// The simple lifecycle (no workflow engine): a task may stop anywhere.
var PHASES = ['RUNNING', 'PREFLIGHT', 'SEARCH', 'PLAN', 'EXECUTION',
  'VALIDATION', 'DEPLOYMENT', 'VERIFICATION', 'COMPLETED'];
// The report sections of the operational contract. Anything else is refused.
var SECTIONS = ['preflight', 'status_center', 'search_first', 'capabilities',
  'execution', 'changes', 'git', 'validation', 'deployment', 'evidence',
  'problems', 'outcome', 'evolution'];

function vErr(msg) { var e = new Error(msg); e.code = 'OTHMODE_TASK_INPUT'; return e; }

function requireStr(value, label, max) {
  if (typeof value !== 'string' || value.trim() === '') throw vErr(label + ' is required');
  if (value.length > (max || 4000)) throw vErr(label + ' exceeds ' + (max || 4000) + ' characters');
  return value.trim();
}
function requireIn(value, list, label) {
  var v = String(value == null ? '' : value);
  if (list.indexOf(v) === -1) throw vErr(label + ' must be one of: ' + list.join(', '));
  return v;
}
function isoOrNow(value, label) {
  if (value === undefined || value === null) return new Date().toISOString();
  var t = Date.parse(String(value));
  if (isNaN(t)) throw vErr(label + ' must be an ISO-8601 timestamp');
  return new Date(t).toISOString();
}

// Only the closed section list, each value a plain object (structured
// report data) or a string (short prose). Arrays allowed inside objects.
function cleanSections(input) {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw vErr('sections must be an object');
  var out = {};
  Object.keys(input).forEach(function (k) {
    if (SECTIONS.indexOf(k) === -1) throw vErr('unknown report section: ' + k + ' (allowed: ' + SECTIONS.join(', ') + ')');
    var v = input[k];
    if (v === null || v === undefined) return;
    if (typeof v === 'string') { out[k] = v.slice(0, 8000); return; }
    if (typeof v === 'object' && !Array.isArray(v)) {
      var body = JSON.stringify(v);
      if (body.length > 32000) throw vErr('section ' + k + ' exceeds 32000 characters');
      out[k] = v;
      return;
    }
    throw vErr('section ' + k + ' must be an object or a string');
  });
  return out;
}

function putEvidenceTexts(input) {
  var hashes = [];
  if (Array.isArray(input)) {
    input.slice(0, 10).forEach(function (t) { hashes.push(store.putEvidence(String(t))); });
  }
  return hashes;
}

// Task ids follow the receipt format OTH-<year>-<seq>, sequential over the
// store's own fold (single-writer service/CLI; a collision is impossible
// within one store because the fold counts every task record ever written).
function nextId(startedAt) {
  var res = store.readStream('tasks', 100000);
  var count = 0;
  res.rows.forEach(function (r) { if (r.type === 'task') count++; });
  var year = String(startedAt).slice(0, 4);
  var seq = String(count + 1);
  while (seq.length < 5) seq = '0' + seq;
  return 'OTH-' + year + '-' + seq;
}

// ---------------------------------------------------------------------------
// Writers — append-only, refused for normal Claude commands.
// ---------------------------------------------------------------------------

function createTask(input, actor) {
  var command = requireStr(input.command, 'command', 4000);
  if (!activation.isActivated(command)) {
    throw vErr('not an OTHMODE activation — the command has no standalone "' + activation.KEYWORD +
      '" keyword; normal Claude commands are never recorded as OTHMODE tasks');
  }
  var status = input.status === undefined ? 'RUNNING' : requireIn(input.status, STATUSES, 'status');
  var phase = input.phase === undefined ? 'RUNNING' : requireIn(input.phase, PHASES, 'phase');
  var startedAt = isoOrNow(input.started_at, 'started_at');
  var finishedAt = null;
  if (TERMINAL_STATUSES.indexOf(status) !== -1) {
    finishedAt = isoOrNow(input.finished_at, 'finished_at');
  } else if (input.finished_at !== undefined) {
    throw vErr('finished_at is only valid with a terminal status');
  }
  var record = store.appendRecord('tasks', {
    id: nextId(startedAt), // ids are always store-assigned — no caller-carried ids, no collisions
    type: 'task',
    command: command,
    activation: 'othmode',
    actor: String(actor || 'unknown'),
    project: input.project ? requireStr(input.project, 'project', 200) : null,
    source: input.source ? requireStr(input.source, 'source', 200) : null,
    status: status,
    phase: phase,
    started_at: startedAt,
    finished_at: finishedAt,
    sections: cleanSections(input.sections),
    evidence: putEvidenceTexts(input.evidence_texts)
  });
  return getTask(record.id);
}

function updateTask(taskId, input, actor) {
  var task = getTask(taskId);
  if (!task) throw vErr('unknown task: ' + taskId);
  if (TERMINAL_STATUSES.indexOf(task.status) !== -1) {
    throw vErr('task ' + taskId + ' already reached terminal status ' + task.status +
      ' — a correction is a NEW task referencing it');
  }
  var update = {
    type: 'task.update',
    task_id: taskId,
    actor: String(actor || 'unknown'),
    sections: cleanSections(input.sections),
    evidence: putEvidenceTexts(input.evidence_texts)
  };
  if (input.status !== undefined) {
    update.status = requireIn(input.status, STATUSES, 'status');
    if (TERMINAL_STATUSES.indexOf(update.status) !== -1) {
      update.finished_at = isoOrNow(input.finished_at, 'finished_at');
    }
  }
  if (input.phase !== undefined) update.phase = requireIn(input.phase, PHASES, 'phase');
  store.appendRecord('tasks', update);
  return getTask(taskId);
}

// ---------------------------------------------------------------------------
// Read model — fold the append-only stream into task views.
// ---------------------------------------------------------------------------

function fold(cap) {
  var res = store.readStream('tasks', cap || store.LINE_CAP_DEFAULT);
  if (!res.provisioned) return { provisioned: false, reason: res.reason, byId: {}, order: [] };
  var byId = {};
  var order = [];
  res.rows.forEach(function (r) {
    if (r.type === 'task') {
      byId[r.id] = {
        id: r.id, ts: r.ts, command: r.command, activation: r.activation || 'othmode',
        actor: r.actor, project: r.project || null, source: r.source || null,
        status: r.status, phase: r.phase, started_at: r.started_at,
        finished_at: r.finished_at || null,
        sections: r.sections || {}, evidence: r.evidence || [], updates: 0
      };
      order.push(r.id);
    } else if (r.type === 'task.update' && byId[r.task_id]) {
      var task = byId[r.task_id];
      task.updates++;
      if (r.status) task.status = r.status;
      if (r.phase) task.phase = r.phase;
      if (r.finished_at) task.finished_at = r.finished_at;
      if (r.sections) {
        Object.keys(r.sections).forEach(function (k) {
          var prev = task.sections[k];
          var next = r.sections[k];
          // Objects merge shallowly (later fields win); strings replace.
          if (prev && typeof prev === 'object' && next && typeof next === 'object') {
            task.sections[k] = Object.assign({}, prev, next);
          } else {
            task.sections[k] = next;
          }
        });
      }
      if (Array.isArray(r.evidence)) task.evidence = task.evidence.concat(r.evidence);
    }
  });
  Object.keys(byId).forEach(function (id) {
    var task = byId[id];
    if (task.started_at && task.finished_at) {
      var d = Date.parse(task.finished_at) - Date.parse(task.started_at);
      task.duration_ms = !isNaN(d) && d >= 0 ? d : null;
    } else {
      task.duration_ms = null;
    }
    task.terminal = TERMINAL_STATUSES.indexOf(task.status) !== -1;
    var evo = task.sections.evolution;
    task.evolution_ref = evo && typeof evo === 'object' && evo.event_id ? evo.event_id : null;
  });
  return { provisioned: true, reason: null, byId: byId, order: order };
}

function listTasks(options) {
  var opts = options || {};
  var folded = fold();
  if (!folded.provisioned) return { provisioned: false, reason: folded.reason, tasks: [] };
  var tasks = folded.order.map(function (id) { return folded.byId[id]; }).reverse();
  if (opts.status) tasks = tasks.filter(function (t) { return t.status === String(opts.status).toUpperCase(); });
  if (opts.q) {
    var needle = String(opts.q).toLowerCase();
    tasks = tasks.filter(function (t) { return t.command.toLowerCase().indexOf(needle) !== -1 || t.id.toLowerCase().indexOf(needle) !== -1; });
  }
  var limit = Math.min(Math.max(parseInt(opts.limit || 50, 10) || 50, 1), 200);
  return { provisioned: true, total: tasks.length, tasks: tasks.slice(0, limit) };
}

function getTask(id) {
  var folded = fold();
  if (!folded.provisioned) return null;
  return folded.byId[String(id)] || null;
}

// Rows for the unified Command History (history.js) — the fourth source.
function historyRows(limit) {
  var folded = fold();
  if (!folded.provisioned) {
    return { available: false, reason: folded.reason, rows: [] };
  }
  var rows = folded.order.map(function (id) {
    var t = folded.byId[id];
    var outcome = t.sections.outcome;
    var result = null, nextAction = null;
    if (typeof outcome === 'string') result = outcome;
    else if (outcome && typeof outcome === 'object') {
      result = outcome.final_result || outcome.result || null;
      nextAction = outcome.next_action || null;
    }
    return {
      source: 'othmode',
      command: t.command,
      command_ref: t.id,
      timestamp: t.finished_at || t.started_at || t.ts,
      duration_ms: t.duration_ms,
      status: t.status,
      result: result,
      evidence: 'othmode-task:' + t.id,
      next_action: nextAction,
      project: t.project
    };
  }).reverse();
  return { available: true, reason: null, rows: rows.slice(0, limit || 50) };
}

// ---------------------------------------------------------------------------
// PUBLIC READ PROJECTION
//
// Command History and Task Reports are readable without a session. The store
// itself is APPEND-ONLY — there is no update and no delete anywhere in this
// module — so a report cannot be edited after the fact to make it safe to
// publish. The projection therefore happens on READ, and only for callers
// with no identity: an authenticated reader always gets the record verbatim.
//
// What is masked is deliberately narrow. These reports are operational
// narrative, and over-redaction would leave a public page that says nothing.
// Credentials never reach the store at all — the write path's secret gate
// already refuses them — so this is not a secret filter. It masks the
// INFRASTRUCTURE MAP that the narrative unavoidably contains: which
// filesystem paths exist, which account may escalate to what, where services
// listen internally, and what this host is called. Individually harmless;
// published together they are a reconnaissance aid.
//
// The redaction is applied to strings only, recursively, and never changes
// the shape of a record: every field a UI or API consumer expects is still
// present, so the public view degrades in detail, never in structure.
// ---------------------------------------------------------------------------
var REDACTIONS = [
  // Absolute host paths (longest-first so /home/x/... is masked whole).
  [/\/(?:home|var|etc|run|srv|opt|usr\/local)\/[A-Za-z0-9._\-\/]*/g, '/[redacted-path]'],
  // sudo grants — the single most useful line for an attacker.
  [/\(root\)\s*NOPASSWD:[^"'\n]*/g, '[redacted: host permission detail]'],
  [/NOPASSWD/g, '[redacted]'],
  // Internal listeners.
  [/\b(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?/g, '[redacted-endpoint]'],
  // This host's name and process identifiers.
  [/\bvps-[a-z0-9]+\b/gi, '[redacted-host]'],
  [/\b(?:MainPID|PID|pid)\s*[=:]?\s*\d{2,}/g, 'pid [redacted]'],
  // Local account names, including in "operator:<user>" actors.
  [/\b(operator|user):(?:deploy|ubuntu|root|www-data|mythosadmin)\b/g, '$1:[redacted]'],
  [/\bUID\s*\d{3,}\b/g, 'UID [redacted]']
];

function redactString(s) {
  var out = String(s);
  for (var i = 0; i < REDACTIONS.length; i++) {
    out = out.replace(REDACTIONS[i][0], REDACTIONS[i][1]);
  }
  return out;
}

function redactValue(v) {
  if (typeof v === 'string') return redactString(v);
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === 'object') {
    var o = {};
    Object.keys(v).forEach(function (k) { o[k] = redactValue(v[k]); });
    return o;
  }
  return v;
}

// publicTask(task) — the anonymous view of one report. Returns null for null
// so callers can pass a missing task straight through.
function publicTask(task) {
  if (!task) return task;
  var out = redactValue(task);
  out.redacted = true;
  return out;
}

function publicTasks(list) {
  if (!list) return list;
  var out = Object.assign({}, list);
  if (Array.isArray(out.tasks)) out.tasks = out.tasks.map(publicTask);
  return out;
}

function publicHistoryRows(result) {
  if (!result) return result;
  var out = Object.assign({}, result);
  if (Array.isArray(out.rows)) out.rows = out.rows.map(redactValue);
  return out;
}

module.exports = {
  STATUSES: STATUSES,
  TERMINAL_STATUSES: TERMINAL_STATUSES,
  PHASES: PHASES,
  SECTIONS: SECTIONS,
  createTask: createTask,
  updateTask: updateTask,
  listTasks: listTasks,
  getTask: getTask,
  historyRows: historyRows,
  publicTask: publicTask,
  publicTasks: publicTasks,
  publicHistoryRows: publicHistoryRows,
  redactString: redactString
};
