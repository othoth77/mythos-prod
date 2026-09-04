'use strict';
// =====================================================
// MYTHOS Autopilot — task watchdog
// projects/mythos-ai-executor/lib/autopilot/watchdog.js
//
// Reads the executor's task store and the bridge's claims and states, for
// every task, whether it is where it should be. It does NOT re-implement
// the task state machine (lib/state.js, protected) and it does not start
// tasks: the daemon's tick() owns dispatch, the lifecycle registry owns
// sessions. The watchdog fills the one gap the audit proved: nothing reads
// `status.daemon_pid`, nothing measures "overdue", nothing notices a
// terminal task without a report.
//
// Findings (each with a mode):
//   ORPHANED_RUNNING      RUNNING, provider child alive, owning daemon gone      APPROVAL
//   INTERRUPTED           RUNNING, child gone (daemon's own tick recovers it)     AUTO (recovered by executor.tick)
//   STUCK_RUNNING         RUNNING longer than timeout + grace under a live daemon APPROVAL
//   RETRY_OVERDUE         WAITING_RETRY with retry_at long past                    AUTO (reported; head-of-line blocked)
//   QUOTA_OVERDUE         WAITING_FOR_QUOTA with resume_after long past            AUTO (reported)
//   QUEUED_STALE          QUEUED longer than the stale threshold                   AUTO (reported)
//   TERMINAL_NO_REPORT    COMPLETED/FAILED/BLOCKED without report.json             AUTO (reported)
//   CORRUPT_STATUS        status.json unreadable                                    MANUAL
//   LEASE_EXPIRED         bridge claim lease expired, executor task not terminal   APPROVAL
//   DAEMON_DOWN           daemon.lock pid not alive                                 APPROVAL (restart path)
//
// "Reported" findings are surfaced with a persistent first_seen/count
// stamp per (task, finding) — <task>/autopilot-watchdog.json — so a
// finding is counted once per occurrence, never re-notified every tick,
// and a finding that clears is removed. Nothing here transitions a task:
// the only legal recoveries already live in executor.tick(); what was
// missing was the evidence, not the transition.
// =====================================================

var fs = require('fs');
var path = require('path');

var DEFAULTS = {
  running_grace_ms: 30 * 60 * 1000,      // beyond task.timeout_seconds
  retry_overdue_ms: 15 * 60 * 1000,
  quota_overdue_ms: 15 * 60 * 1000,
  queued_stale_ms: 6 * 60 * 60 * 1000,
  lease_grace_ms: 30 * 60 * 1000
};

var TERMINAL = { COMPLETED: 1, FAILED: 1, BLOCKED: 1, CANCELLED: 1 };
var STAMP_FILE = 'autopilot-watchdog.json';

function processAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function config(opts) {
  opts = opts || {};
  var cfg = {};
  Object.keys(DEFAULTS).forEach(function (k) { cfg[k] = DEFAULTS[k]; });
  cfg.state = opts.state || require('../state');
  cfg.alive = opts.alive || processAlive;
  cfg.now = opts.now || Date.now();
  cfg.claims = opts.claims; // optional: bridge claims map {id: {executor_task_id, ...}}
  cfg.bridge_tasks = opts.bridge_tasks; // optional: [{id, execution:{lease}}]
  Object.keys(opts).forEach(function (k) { if (DEFAULTS.hasOwnProperty(k)) cfg[k] = opts[k]; });
  return cfg;
}

function ms(iso) { var t = Date.parse(iso || ''); return isNaN(t) ? null : t; }

function finding(code, mode, taskId, detail) {
  return { code: code, mode: mode, task_id: taskId, detail: detail };
}

function examineTask(cfg, id, daemonPid) {
  var st = cfg.state.readStatus(id);
  var out = [];
  if (!st) return out;
  if (st.__parseError) { out.push(finding('CORRUPT_STATUS', 'MANUAL', id, { reason: 'status.json unreadable' })); return out; }
  var task = cfg.state.readJSON(id, 'task.json') || {};
  var now = cfg.now;
  var timeoutMs = (parseInt(task.timeout_seconds, 10) || 3600) * 1000;
  switch (st.status) {
    case 'RUNNING': {
      var childAlive = cfg.alive(st.pid);
      var ownerAlive = st.daemon_pid ? cfg.alive(st.daemon_pid) : null;
      var runFor = now - (ms(st.last_run_started_at || st.started_at) || now);
      if (!childAlive) out.push(finding('INTERRUPTED', 'AUTO', id, { pid: st.pid, recovered_by: 'executor.tick interrupted_recovered' }));
      else if (ownerAlive === false || (daemonPid && st.daemon_pid && st.daemon_pid !== daemonPid)) {
        out.push(finding('ORPHANED_RUNNING', 'APPROVAL', id, { pid: st.pid, daemon_pid: st.daemon_pid, current_daemon_pid: daemonPid || null, running_for_ms: runFor, reason: 'provider child alive but the daemon that owns the attempt is gone; its result cannot be harvested' }));
      } else if (runFor > timeoutMs + cfg.running_grace_ms) {
        out.push(finding('STUCK_RUNNING', 'APPROVAL', id, { pid: st.pid, running_for_ms: runFor, timeout_ms: timeoutMs, reason: 'past timeout + grace and the provider timeout did not fire' }));
      }
      break;
    }
    case 'WAITING_RETRY': {
      var ra = ms(st.retry_at);
      if (ra !== null && now - ra > cfg.retry_overdue_ms) out.push(finding('RETRY_OVERDUE', 'AUTO', id, { retry_at: st.retry_at, overdue_ms: now - ra, reason: 'retry due but not restarted; the daemon is busy or blocked' }));
      break;
    }
    case 'WAITING_FOR_QUOTA': {
      var qa = ms(st.quota_state && st.quota_state.resume_after);
      if (qa !== null && now - qa > cfg.quota_overdue_ms) out.push(finding('QUOTA_OVERDUE', 'AUTO', id, { resume_after: st.quota_state.resume_after, overdue_ms: now - qa }));
      break;
    }
    case 'QUEUED': {
      var ca = ms(st.created_at);
      if (ca !== null && now - ca > cfg.queued_stale_ms) out.push(finding('QUEUED_STALE', 'AUTO', id, { created_at: st.created_at, age_ms: now - ca, requested_by: task.requested_by || null }));
      break;
    }
    default: break;
  }
  if (TERMINAL[st.status] && st.status !== 'CANCELLED') {
    var rep = cfg.state.readJSON(id, 'report.json');
    var md = cfg.state.readText(id, 'report.md');
    if (!rep && !md) out.push(finding('TERMINAL_NO_REPORT', 'AUTO', id, { status: st.status, ended_at: st.ended_at || null }));
  }
  return out;
}

function examineLeases(cfg, statusOf) {
  var out = [];
  (cfg.bridge_tasks || []).forEach(function (t) {
    var exec = t && t.execution;
    if (!exec || !exec.lease || !exec.executor_task_id) return;
    var exp = ms(exec.lease.expires_at);
    if (exp === null || cfg.now - exp < cfg.lease_grace_ms) return;
    var st = statusOf(exec.executor_task_id);
    if (!st || TERMINAL[st.status]) return;
    out.push(finding('LEASE_EXPIRED', 'APPROVAL', exec.executor_task_id, { bridge_task: t.id, expires_at: exec.lease.expires_at, expired_for_ms: cfg.now - exp, executor_status: st.status, reason: 'the bridge only records lease expiry; the executor owns recovery' }));
  });
  return out;
}

// stamps: persistent first_seen/count per (task, code); cleared when the
// finding disappears. Returns the findings decorated with stamp info and
// the list of findings that are NEW this run (for at-most-once notification).
function stamp(cfg, findings, opts) {
  opts = opts || {};
  var byTask = {};
  findings.forEach(function (f) { (byTask[f.task_id] = byTask[f.task_id] || []).push(f); });
  var fresh = [];
  var tasks = {};
  findings.forEach(function (f) { tasks[f.task_id] = 1; });
  (opts.previous_tasks || []).forEach(function (id) { tasks[id] = 1; });
  Object.keys(tasks).forEach(function (id) {
    if (!cfg.state.isValidTaskId(id)) return;
    var prev = cfg.state.readJSON(id, STAMP_FILE) || {};
    if (prev.__parseError) prev = {};
    var next = {};
    (byTask[id] || []).forEach(function (f) {
      var p = prev[f.code];
      if (p && p.first_seen) { next[f.code] = { first_seen: p.first_seen, count: (p.count || 0) + 1, last_seen: new Date(cfg.now).toISOString() }; }
      else { next[f.code] = { first_seen: new Date(cfg.now).toISOString(), count: 1, last_seen: new Date(cfg.now).toISOString() }; fresh.push(f); }
      f.first_seen = next[f.code].first_seen; f.count = next[f.code].count;
    });
    if (opts.dry_run) return;
    if (Object.keys(next).length || Object.keys(prev).length) {
      try { cfg.state.writeJSON(id, STAMP_FILE, next); } catch (e) { /* best-effort */ }
    }
  });
  return { findings: findings, fresh: fresh };
}

// scan(opts) → { findings, fresh, counts, daemon }
function scan(opts) {
  var cfg = config(opts);
  var findings = [];
  var daemon = { pid: null, alive: null };
  try {
    var raw = fs.readFileSync(path.join(cfg.state.root(), 'daemon.lock'), 'utf8');
    daemon.pid = parseInt(raw, 10) || null;
    daemon.alive = daemon.pid ? cfg.alive(daemon.pid) : false;
  } catch (e) { daemon.alive = false; daemon.reason = 'daemon.lock missing'; }
  if (!daemon.alive) findings.push(finding('DAEMON_DOWN', 'APPROVAL', null, { pid: daemon.pid, reason: daemon.reason || 'daemon pid not alive (systemd Restart=on-failure should bring it back; if not, the governed restart path applies)' }));
  var ids = cfg.state.listTasks();
  var cache = {};
  ids.forEach(function (id) { examineTask(cfg, id, daemon.alive ? daemon.pid : null).forEach(function (f) { findings.push(f); }); });
  findings.push.apply(findings, examineLeases(cfg, function (id) { return cache[id] || (cache[id] = cfg.state.readStatus(id)); }));
  var previous = ids.filter(function (id) { var s = cfg.state.readJSON(id, STAMP_FILE); return s && !s.__parseError && Object.keys(s).length; });
  var stamped = stamp(cfg, findings.filter(function (f) { return f.task_id; }), { previous_tasks: previous, dry_run: opts && opts.dry_run });
  var counts = {};
  findings.forEach(function (f) { counts[f.code] = (counts[f.code] || 0) + 1; });
  var stuck = findings.filter(function (f) { return f.mode !== 'AUTO' || f.code === 'RETRY_OVERDUE' || f.code === 'QUOTA_OVERDUE'; }).length;
  return { measured_at: new Date(cfg.now).toISOString(), daemon: daemon, tasks_scanned: ids.length, findings: findings, fresh: stamped.fresh, counts: counts, state: findings.length === 0 ? 'HEALTHY' : (stuck ? 'STUCK' : 'ATTENTION') };
}

module.exports = { DEFAULTS: DEFAULTS, STAMP_FILE: STAMP_FILE, scan: scan, examineTask: examineTask, examineLeases: examineLeases, config: config };
