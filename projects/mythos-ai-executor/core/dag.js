'use strict';
// =====================================================
// Mythos Orchestration Core — task dependency DAG (Phase 2F)
// projects/mythos-ai-executor/core/dag.js
//
// Pure graph logic — no I/O, no clock, no randomness. The scheduler and
// planner feed it task lists (anything with { id, status, depends_on });
// it answers: is this graph sound, what may run now, and what is doomed
// because an ancestor failed. Purity is what makes restart recovery
// trivial: recomputing over persisted statuses IS the recovery.
// =====================================================

var TERMINAL_OK = ['COMPLETED'];
var TERMINAL_BAD = ['FAILED', 'CANCELLED'];

// Structural validation: duplicate ids, unknown/self dependencies, cycles.
// Returns { valid, errors, order } — order is a topological order when valid.
function validateGraph(tasks) {
  var errors = [];
  var byId = {};
  tasks.forEach(function (t) {
    if (byId[t.id]) errors.push('DUPLICATE_TASK: ' + t.id);
    byId[t.id] = t;
  });
  tasks.forEach(function (t) {
    (t.depends_on || []).forEach(function (dep) {
      if (dep === t.id) errors.push('SELF_DEPENDENCY: ' + t.id);
      else if (!byId[dep]) errors.push('UNKNOWN_DEPENDENCY: ' + t.id + ' depends on missing ' + dep);
    });
  });
  if (errors.length) return { valid: false, errors: errors, order: null };

  // Kahn's algorithm; leftovers mean a cycle.
  var indegree = {};
  var dependents = {};
  tasks.forEach(function (t) {
    indegree[t.id] = (t.depends_on || []).length;
    (t.depends_on || []).forEach(function (dep) {
      (dependents[dep] = dependents[dep] || []).push(t.id);
    });
  });
  var queue = tasks.filter(function (t) { return indegree[t.id] === 0; })
    .map(function (t) { return t.id; });
  var order = [];
  while (queue.length) {
    var id = queue.shift();
    order.push(id);
    (dependents[id] || []).forEach(function (next) {
      indegree[next] -= 1;
      if (indegree[next] === 0) queue.push(next);
    });
  }
  if (order.length !== tasks.length) {
    var stuck = tasks.filter(function (t) { return order.indexOf(t.id) === -1; })
      .map(function (t) { return t.id; });
    return { valid: false, errors: ['CYCLE_DETECTED: involving ' + stuck.join(', ')], order: null };
  }
  return { valid: true, errors: [], order: order };
}

// Transitive ancestors of a task id.
function ancestorsOf(taskId, byId, memo) {
  memo = memo || {};
  if (memo[taskId]) return memo[taskId];
  var out = {};
  var t = byId[taskId];
  (t && t.depends_on || []).forEach(function (dep) {
    out[dep] = true;
    var above = ancestorsOf(dep, byId, memo);
    Object.keys(above).forEach(function (a) { out[a] = true; });
  });
  memo[taskId] = out;
  return out;
}

// Failure propagation: every non-terminal task with a FAILED/CANCELLED
// ancestor is doomed — it must never become ready.
function doomedTasks(tasks) {
  var byId = {};
  tasks.forEach(function (t) { byId[t.id] = t; });
  var memo = {};
  return tasks.filter(function (t) {
    if (TERMINAL_OK.concat(TERMINAL_BAD).indexOf(t.status) !== -1) return false;
    var above = ancestorsOf(t.id, byId, memo);
    return Object.keys(above).some(function (a) {
      return byId[a] && TERMINAL_BAD.indexOf(byId[a].status) !== -1;
    });
  }).map(function (t) {
    var above = ancestorsOf(t.id, byId, memo);
    var blocking = Object.keys(above).filter(function (a) {
      return byId[a] && TERMINAL_BAD.indexOf(byId[a].status) !== -1;
    });
    return { id: t.id, blocked_by: blocking };
  });
}

// Tasks whose dependencies are all COMPLETED and which are waiting to run.
// A doomed task is never ready, whatever its own status says.
function readyTasks(tasks) {
  var byId = {};
  tasks.forEach(function (t) { byId[t.id] = t; });
  var doomed = {};
  doomedTasks(tasks).forEach(function (d) { doomed[d.id] = true; });
  return tasks.filter(function (t) {
    if (doomed[t.id]) return false;
    if (['QUEUED', 'WAITING_FOR_DEPENDENCY', 'READY'].indexOf(t.status) === -1) return false;
    return (t.depends_on || []).every(function (dep) {
      return byId[dep] && TERMINAL_OK.indexOf(byId[dep].status) !== -1;
    });
  }).map(function (t) { return t.id; });
}

// One pure scheduling assessment over the current statuses. The caller
// (scheduler / restart recovery) applies the suggested transitions.
function assess(tasks) {
  var check = validateGraph(tasks);
  if (!check.valid) return { valid: false, errors: check.errors };
  var ready = readyTasks(tasks);
  var doomed = doomedTasks(tasks);
  var running = tasks.filter(function (t) { return t.status === 'RUNNING'; }).map(function (t) { return t.id; });
  var waiting = tasks.filter(function (t) {
    return ['WAITING_FOR_DEPENDENCY', 'QUEUED'].indexOf(t.status) !== -1 &&
      ready.indexOf(t.id) === -1 &&
      !doomed.some(function (d) { return d.id === t.id; });
  }).map(function (t) { return t.id; });
  var done = tasks.every(function (t) {
    return TERMINAL_OK.concat(TERMINAL_BAD).indexOf(t.status) !== -1;
  });
  return {
    valid: true,
    order: check.order,
    ready: ready,
    running: running,
    waiting_dependency: waiting,
    doomed: doomed,
    all_terminal: done,
    succeeded: done && tasks.every(function (t) { return t.status === 'COMPLETED'; })
  };
}

module.exports = {
  validateGraph: validateGraph,
  readyTasks: readyTasks,
  doomedTasks: doomedTasks,
  assess: assess
};
