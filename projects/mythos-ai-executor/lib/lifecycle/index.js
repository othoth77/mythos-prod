'use strict';
// =====================================================
// MYTHOS Execution Lifecycle — facade
// projects/mythos-ai-executor/lib/lifecycle/index.js
//
// The one entry point the executor, the bridge, the server, the CLI and
// the root guard runner use. Everything is best-effort from the caller's
// point of view: emit() never throws into the executor's control flow (a
// broken registry must never fail a task), tick() is bounded (inbox batch,
// verification cap, close cap) and cheap (a few small JSON files), and no
// function here starts a session to inspect another.
//
// Location of the registry:  MYTHOS_LIFECYCLE_HOME, else <executor home>/lifecycle
//   (i.e. /home/deploy/mythos-ai-executor/lifecycle on this host).
// Enforcement marker:        <registry>/cleanup.enabled   (rm = rollback)
// Kill switch:               MYTHOS_LIFECYCLE_CLEANUP=off
// Root snapshot:             /var/lib/mythos/lifecycle/host-sessions.json (written by
//                            the root guard runner; read by everyone else)
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var model = require('./model');
var registry = require('./registry');
var verify = require('./verify');
var cleanup = require('./cleanup');
var correlate = require('./correlate');
var vpsRuntime = require('./runtime-vps');
var pcRuntime = require('./runtime-pc');

var TICK_MIN_INTERVAL_MS = 60 * 1000;
var lastTickAt = 0;
var lastPruneAt = 0;

function executorHome() {
  if (process.env.MYTHOS_EXECUTOR_HOME) return process.env.MYTHOS_EXECUTOR_HOME;
  try { return require('../state').root(); } catch (e) { return path.join(os.homedir(), 'mythos-ai-executor'); }
}

function root() { return process.env.MYTHOS_LIFECYCLE_HOME || path.join(executorHome(), 'lifecycle'); }

function registryConfig(extra) {
  return registry.config(Object.assign({ root: root() }, extra || {}));
}

// Written by the ROOT guard runner (its unit may write /var/lib/mythos/lifecycle,
// not /home/deploy), read by everyone else.
function snapshotPath() { return process.env.MYTHOS_LIFECYCLE_SNAPSHOT || '/var/lib/mythos/lifecycle/host-sessions.json'; }

function enforcement() {
  var env = String(process.env.MYTHOS_LIFECYCLE_CLEANUP || '').toLowerCase();
  if (env === 'off') return { enabled: false, reason: 'kill_switch_env' };
  if (env === 'on') return { enabled: true, reason: 'env' };
  try { fs.statSync(path.join(root(), 'cleanup.enabled')); return { enabled: true, reason: 'marker' }; }
  catch (e) { return { enabled: false, reason: 'marker_absent' }; }
}

function policyFromEnv(extra) {
  var p = {};
  var num = function (name) { var v = parseInt(process.env[name] || '', 10); return isNaN(v) ? undefined : v; };
  p.idle_seconds = num('MYTHOS_LIFECYCLE_IDLE_SECONDS');
  p.grace_seconds = num('MYTHOS_LIFECYCLE_GRACE_SECONDS');
  p.enabled = enforcement().enabled;
  // Force kill is NEVER enabled from the environment: it is a config file
  // decision (policy.json) plus an explicit CLI confirmation.
  try {
    var pj = JSON.parse(fs.readFileSync(path.join(root(), 'policy.json'), 'utf8'));
    Object.keys(pj || {}).forEach(function (k) { if (cleanup.POLICY.hasOwnProperty(k)) p[k] = pj[k]; });
  } catch (e) { /* defaults */ }
  Object.keys(extra || {}).forEach(function (k) { if (extra[k] !== undefined) p[k] = extra[k]; });
  return cleanup.policy(p);
}

function runtimes() { return { VPS: vpsRuntime, PC: pcRuntime }; }
function runtimeOpts(reg) {
  return {
    VPS: { snapshot_path: snapshotPath(), host: process.env.MYTHOS_LIFECYCLE_HOST || os.hostname() },
    PC: { registry: reg }
  };
}

function hostname() { return process.env.MYTHOS_LIFECYCLE_HOST || os.hostname(); }

// --- emit: the executor/bridge-facing call --------------------------------------------
// Fills location/host/agent/provider defaults for local events. Never throws.
function emit(event) {
  try {
    var ev = Object.assign({}, event);
    if (!ev.at) ev.at = new Date().toISOString();
    if (!ev.location) ev.location = 'VPS';
    if (ev.location === 'VPS' && !ev.host) ev.host = hostname();
    if (!ev.source) ev.source = 'local';
    return registry.ingest(registryConfig(), ev);
  } catch (e) {
    return { ok: false, error: String(e && e.message).slice(0, 200), transitions: [] };
  }
}

// GitHub linkage for a task (bridge, claim time). Never throws.
function linkTask(taskId, link) {
  try { return registry.putTaskLink(registryConfig(), taskId, link); } catch (e) { return null; }
}

// --- executor statuses (deploy side) ---------------------------------------------------
function executorStatuses(taskIds) {
  var out = {};
  var st;
  try { st = require('../state'); } catch (e) { return out; }
  (taskIds || []).forEach(function (id) {
    try { var s = st.readStatus(id); if (s) out[id] = s; } catch (e) { /* invalid id */ }
  });
  return out;
}

// --- recovery (Phase 10) -----------------------------------------------------------------
// For every execution that believes it is running/reporting on THIS host,
// check the session through the runtime. A vanished process becomes
// PROCESS_GONE → UNKNOWN (never silently FAILED); an older UNKNOWN attempt
// superseded by a newer execution of the same task is closed out as such;
// an execution the executor itself already finished is caught up.
function recover(reg, rts, ropts, now, statuses) {
  var actions = [];
  var nowIso = new Date(now).toISOString();
  var all = registry.listExecutions(reg);
  var byTask = {};
  all.forEach(function (e) { if (e.task_id) (byTask[e.task_id] = byTask[e.task_id] || []).push(e); });

  all.forEach(function (e) {
    var loc = e.location || 'VPS';
    if (['RUNNING', 'REPORTING', 'DISPATCHED'].indexOf(e.execution_state) >= 0 && e.session_id && loc === 'VPS' && e.pid) {
      var st = statuses[e.task_id] || null;
      var obs;
      try { obs = rts.VPS.get_session_state({ session_id: e.session_id, pid: e.pid, proc_start: e.proc_start, executor_status: st }, Object.assign({ now: now }, ropts.VPS)); }
      catch (err) { obs = { state: 'UNKNOWN', evidence: [] }; }
      if (obs.state === 'CLOSED') {
        // Executor already knows? Catch up from its record before declaring UNKNOWN.
        if (st && ['COMPLETED', 'FAILED', 'BLOCKED'].indexOf(st.status) >= 0) {
          registry.ingest(reg, { type: 'TASK_COMPLETED', execution_id: e.execution_id, task_id: e.task_id, session_id: e.session_id, at: st.ended_at || nowIso, source: 'recover', report_status: st.status.toLowerCase(), event_id: 'recover-done:' + e.execution_id });
          registry.ingest(reg, { type: 'SESSION_CLOSED', execution_id: e.execution_id, task_id: e.task_id, session_id: e.session_id, at: st.ended_at || nowIso, source: 'recover', reason: 'executor recorded ' + st.status, event_id: 'recover-closed:' + e.execution_id });
          actions.push({ execution_id: e.execution_id, action: 'caught_up_from_executor', status: st.status });
        } else {
          registry.ingest(reg, { type: 'PROCESS_GONE', execution_id: e.execution_id, task_id: e.task_id, session_id: e.session_id, at: nowIso, source: 'recover', reason: (obs.evidence || [])[0] || 'process gone', event_id: 'recover-gone:' + e.execution_id + ':' + (e.pid || 0) });
          actions.push({ execution_id: e.execution_id, action: 'process_gone', executor_status: st ? st.status : null });
        }
      }
    }
  });

  // Superseded attempts: an UNKNOWN execution of a task that has a newer execution.
  Object.keys(byTask).forEach(function (taskId) {
    var list = byTask[taskId].slice().sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
    for (var i = 0; i < list.length - 1; i++) {
      var old = list[i];
      if (old.execution_state === 'UNKNOWN' || (old.execution_state === 'RUNNING' && old.session_state === 'CLOSED')) {
        var fresh = registry.getExecution(reg, old.execution_id);
        if (!fresh || fresh.superseded_by) continue;
        var ev = { at: nowIso, type: 'recover', source: 'recover' };
        var t = model.transition(fresh, 'execution_state', fresh.execution_state, 'FAILED', ev, 'attempt superseded by ' + list[list.length - 1].execution_id + ' (resume/recreate)');
        fresh.execution_state = 'FAILED';
        fresh.superseded_by = list[list.length - 1].execution_id;
        fresh.finished_at = nowIso;
        fresh.updated_at = nowIso;
        registry.putExecution(reg, fresh);
        registry.appendLedger(reg, [Object.assign({ kind: 'transition' }, t)]);
        actions.push({ execution_id: old.execution_id, action: 'superseded', by: fresh.superseded_by });
      }
    }
  });
  return actions;
}

// --- tick ---------------------------------------------------------------------------------------
// opts: { now, force (ignore min interval), killFn, policy, snapshot (write the root snapshot when readable) }
function tick(opts) {
  opts = opts || {};
  var now = opts.now || Date.now();
  if (!opts.force && now - lastTickAt < TICK_MIN_INTERVAL_MS) return { skipped: true, reason: 'min_interval' };
  lastTickAt = now;
  var reg = registryConfig(opts.registry);
  var rts = runtimes();
  var ropts = runtimeOpts(reg);
  if (opts.runtime_opts) Object.keys(opts.runtime_opts).forEach(function (k) { ropts[k] = Object.assign({}, ropts[k], opts.runtime_opts[k]); });
  var out = { at: new Date(now).toISOString(), inbox: null, recovered: [], verified: null, cleanup: null, pruned: null, snapshot_written: false };
  try {
    out.inbox = registry.drainInbox(reg);
    var taskIds = registry.listExecutions(reg).filter(function (e) { return e.task_id && !model.isExecutionTerminalState(e.execution_state); }).map(function (e) { return e.task_id; });
    var statuses = opts.executor_statuses || executorStatuses(taskIds);
    out.recovered = recover(reg, rts, ropts, now, statuses);
    out.verified = verify.run(reg, rts, ropts, { now: now, executor_statuses: statuses, max_per_tick: opts.max_verify });
    out.cleanup = cleanup.run(reg, rts, ropts, { now: now, policy: policyFromEnv(opts.policy), enforcement: opts.enforcement || enforcement() }, opts.killFn);
    if (opts.snapshot) {
      var snap = vpsRuntime.snapshot(Object.assign({ now: now }, ropts.VPS));
      if (!snap.denied) out.snapshot_written = vpsRuntime.writeSnapshot(ropts.VPS, snap) && chownToDirOwner(ropts.VPS.snapshot_path);
    }
    if (now - lastPruneAt > 3600 * 1000) { out.pruned = registry.prune(reg); lastPruneAt = now; }
  } catch (e) {
    out.error = String(e && e.message).slice(0, 200);
  }
  return out;
}

// The registry directory belongs to deploy; a root writer hands the file to
// that owner so the non-root readers can use it.
function chownToDirOwner(file) {
  try {
    var st = fs.statSync(path.dirname(file));
    if (process.getuid && process.getuid() === 0) fs.chownSync(file, st.uid, st.gid);
    return true;
  } catch (e) { return false; }
}

// --- views -----------------------------------------------------------------------------------------
function status(opts) {
  opts = opts || {};
  var reg = registryConfig();
  var execs = registry.listExecutions(reg);
  var sess = registry.listSessions(reg);
  var count = function (list, key) { var c = {}; list.forEach(function (r) { c[r[key]] = (c[r[key]] || 0) + 1; }); return c; };
  var now = opts.now || Date.now();
  return {
    at: new Date(now).toISOString(),
    root: reg.root,
    enforcement: enforcement(),
    policy: policyFromEnv(),
    executions: { total: execs.length, by_task_state: count(execs, 'task_state'), by_execution_state: count(execs, 'execution_state'), by_session_state: count(execs, 'session_state'),
      completed_session_open: execs.filter(function (e) { return e.task_state === 'COMPLETED' && e.execution_state === 'VERIFYING'; }).map(function (e) { return { execution_id: e.execution_id, task_id: e.task_id, session_id: e.session_id, github_issue: e.github_issue, next_check_at: e.verification && e.verification.next_check_at, attempts: e.verification && e.verification.attempts }; }),
      attention: execs.filter(function (e) { return e.verification && e.verification.attention; }).map(function (e) { return e.execution_id; }),
      unknown: execs.filter(function (e) { return e.execution_state === 'UNKNOWN'; }).map(function (e) { return e.execution_id; }) },
    sessions: { total: sess.length, by_state: count(sess, 'state'), by_close_phase: count(sess, 'close_phase'), by_location: count(sess, 'location'),
      human_review: sess.filter(function (s) { return s.close_phase === 'HUMAN_REVIEW'; }).map(function (s) { return s.session_id; }) },
    verification_due: verify.due(reg, now).length,
    host: opts.host === false ? null : safeHostView({ now: now })
  };
}

function safeHostView(opts) {
  try { return hostView(opts); } catch (e) { return { error: String(e && e.message).slice(0, 120) }; }
}

function hostView(opts) {
  opts = opts || {};
  var reg = registryConfig();
  var ropts = runtimeOpts(reg);
  var statuses = null;
  try {
    var st = require('../state');
    statuses = st.listTasks().map(function (id) { var s = st.readStatus(id); return s && s.status === 'RUNNING' && s.pid ? { task_id: id, pid: s.pid, claude_session_id: s.claude_session_id, execution_id: s.execution_id, working_directory: null } : null; }).filter(Boolean);
  } catch (e) { statuses = []; }
  return correlate.hostView({ registry: reg, vps: Object.assign({}, ropts.VPS, opts.vps || {}), executor_statuses: statuses, now: opts.now });
}

// "Why is this session still open?" / "Why was it closed?"
function explain(id) {
  var reg = registryConfig();
  var exec = model.validId(id) ? registry.getExecution(reg, id) : null;
  var sess = model.validSessionId(id) ? registry.getSession(reg, id) : null;
  if (!exec && !sess) {
    var byTask = registry.findByTask(reg, id);
    if (byTask) exec = byTask;
  }
  if (exec && !sess && exec.session_id) sess = registry.getSession(reg, exec.session_id);
  if (sess && !exec && sess.execution_id) exec = registry.getExecution(reg, sess.execution_id);
  var lines = registry.ledgerFor(reg, id, 200);
  var answer = [];
  if (exec) {
    answer.push('task ' + exec.task_state + ', execution ' + exec.execution_state + ', session ' + exec.session_state + (exec.location ? ' on ' + exec.location : ''));
    if (exec.report_submitted_at) answer.push('GitHub report at ' + exec.report_submitted_at + (exec.github_issue ? ' (issue #' + exec.github_issue + ')' : ''));
    if (exec.session_open_after_report) answer.push('session was still open after the report; verification attempts: ' + (exec.verification && exec.verification.attempts));
    if (exec.session_closed_at) answer.push('session closed at ' + exec.session_closed_at + (exec.close_reason ? ' — ' + exec.close_reason : ''));
  }
  if (sess) {
    answer.push('session ' + sess.session_id + ' state ' + sess.state + ', close phase ' + sess.close_phase + ' since ' + sess.close_phase_since);
    if (sess.close_reason) answer.push('close reason: ' + sess.close_reason);
  }
  var lastVeto = lines.filter(function (l) { return l.kind === 'transition' && l.field === 'close_phase'; }).slice(-1)[0];
  if (lastVeto) answer.push('last phase change: ' + lastVeto.previous_state + ' → ' + lastVeto.new_state + ' (' + lastVeto.reason + ')');
  return { id: id, execution: exec, session: sess, ledger: lines, answer: answer };
}

module.exports = {
  TICK_MIN_INTERVAL_MS: TICK_MIN_INTERVAL_MS,
  model: model, registry: registry, verify: verify, cleanup: cleanup, correlate: correlate,
  runtimes: runtimes, runtimeOpts: runtimeOpts, vpsRuntime: vpsRuntime, pcRuntime: pcRuntime,
  root: root, registryConfig: registryConfig, snapshotPath: snapshotPath,
  enforcement: enforcement, policyFromEnv: policyFromEnv,
  emit: emit, linkTask: linkTask, tick: tick, recover: recover, status: status, hostView: hostView, explain: explain,
  _resetTimers: function () { lastTickAt = 0; lastPruneAt = 0; }
};
