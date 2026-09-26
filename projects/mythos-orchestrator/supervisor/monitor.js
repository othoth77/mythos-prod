'use strict';
// =====================================================
// MYTHOS supervisor — execution monitor (read-only)
// projects/mythos-orchestrator/supervisor/monitor.js
//
// Looks at what FABLE is actually doing through the executor's OWN CLI
// (`list` / `status`, read-only, no credentials) and at the host, and names
// the situation precisely — these are different states, never collapsed:
//
//   FABLE_RUNNING      executor RUNNING with a live process
//   FABLE_SUCCEEDED    executor COMPLETED
//   FABLE_FAILED       executor FAILED / BLOCKED
//   FABLE_CRASHED      executor RUNNING but its process is gone (INTERRUPTED)
//   FABLE_TIMED_OUT    last failure was a timeout (WAITING_RETRY or FAILED)
//   FABLE_RETRYING     executor WAITING_RETRY for a non-timeout transient
//   FABLE_UNREACHABLE  the executor daemon itself is not active
//   FABLE_QUEUED       executor QUEUED / WAITING_FOR_QUOTA
//   FABLE_UNKNOWN      no executor record (yet) for this attempt
//
// Nothing here writes, signals or restarts anything.
// =====================================================

var cp = require('child_process');
var fs = require('fs');

function run(bin, args, timeoutMs) {
  return new Promise(function (resolve) {
    cp.execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: process.env }, function (err, stdout) {
      if (err) return resolve({ ok: false, error: { code: err.killed ? 'MONITOR_TIMEOUT' : 'MONITOR_EXIT', detail: String(err.code || '') } });
      resolve({ ok: true, stdout: stdout });
    });
  });
}

function create(cfg, opts) {
  opts = opts || {};
  var runner = opts.runner || run;
  var exe = cfg.executor_bin;
  var timeoutMs = (cfg.executor_timeout_seconds || 30) * 1000;

  function executorFor(bridgeTaskId) {
    return Promise.resolve(runner(process.execPath, [exe, 'list'], timeoutMs)).then(function (r) {
      if (!r.ok) return r;
      var list;
      try { list = JSON.parse(r.stdout); } catch (e) { return { ok: false, error: { code: 'MONITOR_MALFORMED' } }; }
      var mine = (list || []).filter(function (t) { return t && t.stage === 'github:' + bridgeTaskId; });
      return { ok: true, task: mine.length ? mine[mine.length - 1] : null };
    });
  }

  function executorStatus(executorTaskId) {
    return Promise.resolve(runner(process.execPath, [exe, 'status', executorTaskId], timeoutMs)).then(function (r) {
      if (!r.ok) return r;
      try { return { ok: true, status: JSON.parse(r.stdout) }; } catch (e) { return { ok: false, error: { code: 'MONITOR_MALFORMED' } }; }
    });
  }

  function daemonActive() {
    return Promise.resolve(runner('systemctl', ['--user', 'is-active', 'mythos-ai-executor.service'], 10000)).then(function (r) {
      return { ok: true, active: !!(r.ok && String(r.stdout).trim() === 'active') };
    });
  }

  function resources() {
    var out = {};
    try {
      var mem = fs.readFileSync('/proc/meminfo', 'utf8');
      var m = /MemAvailable:\s+(\d+) kB/.exec(mem);
      out.mem_available_mib = m ? Math.round(parseInt(m[1], 10) / 1024) : null;
    } catch (e) { out.mem_available_mib = null; }
    try { out.load1 = parseFloat(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); } catch (e) { out.load1 = null; }
    return out;
  }

  // Everything the supervisor needs to classify one attempt, in one call.
  function observe(bridgeTaskId) {
    return Promise.all([bridgeTaskId ? executorFor(bridgeTaskId) : Promise.resolve({ ok: true, task: null }), daemonActive()])
      .then(function (both) {
        var t = both[0].ok ? both[0].task : null;
        var eff = t && (t.effective || t.status);
        // `list` rows carry no failure detail; a timeout is only visible in
        // the full status record, so read it exactly when it matters.
        if (!t || ['WAITING_RETRY', 'FAILED', 'BLOCKED'].indexOf(eff) === -1) return both;
        return executorStatus(t.task_id).then(function (st) {
          if (st.ok && st.status && st.status.status) {
            t.last_error = st.status.status.last_error || null;
          }
          return both;
        });
      })
      .then(function (both) {
        var ex = both[0], daemon = both[1];
        var t = ex.ok ? ex.task : null;
        var state = classify(t, daemon.active);
        return {
          monitor_state: state,
          executor_task_id: t ? t.task_id : null,
          executor_status: t ? t.status : null,
          executor_effective: t ? t.effective : null,
          retry_count: t ? t.retry_count || 0 : null,
          model: t ? t.model || null : null,
          daemon_active: daemon.active,
          executor_read_error: ex.ok ? null : ex.error.code,
          resources: resources()
        };
      });
  }

  return { observe: observe, executorFor: executorFor, executorStatus: executorStatus, daemonActive: daemonActive, resources: resources };
}

function classify(t, daemonActive) {
  if (!daemonActive) return 'FABLE_UNREACHABLE';
  if (!t) return 'FABLE_UNKNOWN';
  var eff = t.effective || t.status;
  var lastTimedOut = !!(t.last_failure && t.last_failure.timed_out) || /timed out|timeout/i.test(String(t.last_error || ''));
  if (eff === 'INTERRUPTED') return 'FABLE_CRASHED';
  if (eff === 'RUNNING') return 'FABLE_RUNNING';
  if (eff === 'COMPLETED') return 'FABLE_SUCCEEDED';
  if (eff === 'WAITING_RETRY') return lastTimedOut ? 'FABLE_TIMED_OUT' : 'FABLE_RETRYING';
  if (eff === 'QUEUED' || eff === 'WAITING_FOR_QUOTA') return 'FABLE_QUEUED';
  if (eff === 'FAILED' || eff === 'BLOCKED' || eff === 'CANCELLED') return lastTimedOut ? 'FABLE_TIMED_OUT' : 'FABLE_FAILED';
  return 'FABLE_UNKNOWN';
}

module.exports = { create: create, classify: classify };
