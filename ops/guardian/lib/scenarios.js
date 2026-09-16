'use strict';
// =====================================================
// MYTHOS Guardian V0 — dry-run scenarios
// ops/guardian/lib/scenarios.js
//
// Synthetic SOURCE data only. A scenario replaces the collectors, so a
// simulation never reads and never touches the real host — and, because
// `simulate` always runs the engine with dry_run, it never writes either.
// (PR #283 had a scenario that executed live ticks; that is structurally
// impossible here: `collectors` is data, `dry_run` is set by the CLI, and
// the engine returns before any write path when `dry_run` is true.)
// =====================================================

var sources = require('./sources');
var envelope = sources.envelope;
var missing = sources.missing;

function iso(nowMs, offsetSec) { return new Date(nowMs - (offsetSec || 0) * 1000).toISOString(); }

// A healthy host, matching the shapes the real collectors return.
function baseline(cfg, nowMs) {
  return {
    memory: {
      publication: envelope(true, { level: 'NORMAL', updated_at: iso(nowMs, 30) }, { age_seconds: 30 }),
      meminfo: envelope(true, { mem_available_mib: 3200, mem_total_mib: 7800, swap_total_mib: 4095, swap_used_pct: 12 }),
      psi: envelope(true, { some_avg60: 0.4 }),
      oom_kill: envelope(true, { count: 6812 }),
      memwatch: envelope(true, { at: iso(nowMs, 60), mem_available_mib: 3200, swap_used_mib: 500, psi_some_avg60: 0.4, oom_kill: 6812 }, { age_seconds: 60 })
    },
    sessions: {
      procs: envelope(true, { total: 420, remote_sessions: 3, remote_rss_mib: 900, oldest_session_hours: 1.2, orphan_count: 0, orphans: [] }),
      snapshot: envelope(true, { sessions: 3, denied: false }, { age_seconds: 120 }),
      guard_unit: envelope(true, { result: 'success', last_run_at: iso(nowMs, 120) }, { age_seconds: 120 })
    },
    disk: {
      fs: envelope(true, { path: '/', used_pct: 61.0, free_gb: 30.2, inode_used_pct: 12.4 }),
      docker: envelope(true, { Images: { size: '12GB', reclaimable: '2GB' }, 'Build Cache': { size: '1GB', reclaimable: '1GB' }, 'Local Volumes': { size: '3GB', reclaimable: '0B' } })
    },
    services: (function () {
      var o = { units: {}, containers: {}, live_status: null, errors: [] };
      cfg.services.units.forEach(function (u) { o.units[u.id] = { observed: true, load: 'loaded', active: 'active', sub: 'running', result: 'success', n_restarts: 0 }; });
      cfg.services.containers.forEach(function (c) { o.containers[c.id] = { observed: true, status: 'running', health: null, restart_count: 0 }; });
      o.live_status = envelope(true, { generated_at: iso(nowMs, 180), summary: { up: 12, down: 0 }, down: [], degraded: [] }, { age_seconds: 180 });
      return o;
    })(),
    backup: (function () {
      var o = { records: {}, restore_tests: {} };
      cfg.backup.records.forEach(function (r) {
        o.records[r.id] = envelope(true, {
          mode: 'verify', status: 'ok', last_success_at: iso(nowMs, 6 * 3600), consecutive_failures: 0,
          last_backup_status: 'ok', last_backup_finished_at: iso(nowMs, 6 * 3600), last_verify_status: 'ok'
        });
      });
      cfg.backup.restore_tests.forEach(function (t) {
        o.restore_tests[t.id] = envelope(true, { result: 'success', exec_status: '0', last_run_ms: nowMs - 5 * 86400000 });
      });
      return o;
    })()
  };
}

function withMemory(level, avail, psi60, extra) {
  return function (raw, cfg, nowMs) {
    raw.memory.publication = envelope(true, { level: level, updated_at: iso(nowMs, 20) }, { age_seconds: 20 });
    raw.memory.meminfo.data.mem_available_mib = avail;
    raw.memory.psi.data.some_avg60 = psi60;
    if (extra) extra(raw, cfg, nowMs);
    return raw;
  };
}

var SCENARIOS = {
  'normal': { why: 'a healthy host', apply: function (r) { return r; }, expect: { host: 'NORMAL', guardian: 'OK' } },

  'memory-warning': { why: 'Resource Guard WARNING with mild pressure', apply: withMemory('WARNING', 1600, 4), expect: { memory: 'WARNING' } },
  'memory-high': { why: 'WARNING plus low MemAvailable — #283 would have stayed at WARNING', apply: withMemory('WARNING', 800, 25), expect: { memory: 'HIGH' } },
  'memory-critical': { why: 'Resource Guard CRITICAL', apply: withMemory('CRITICAL', 700, 45), expect: { memory: 'CRITICAL' } },
  'memory-emergency': { why: 'CRITICAL with MemAvailable under the emergency floor', apply: withMemory('CRITICAL', 300, 60), expect: { memory: 'EMERGENCY', samples: 2 } },
  // An RG-confirmed level commits on sample one (the Resource Guard already
  // applied its own hysteresis), so oscillating RG evidence tracks the peak.
  'memory-oscillating': { why: 'Resource Guard alternating WARNING/CRITICAL — commits immediately, by design', apply: null, expect: { peak_memory: 'CRITICAL' } },
  // The real #283 starvation case needs a domain WITHOUT upstream hysteresis:
  // evidence alternating between two higher levels reset #283's pending
  // counter every sample, so it could never escalate at all.
  'oscillating-evidence': {
    why: 'disk alternating HIGH/CRITICAL — the #283 starvation case (must still escalate)',
    expect: { disk: 'HIGH' }, oscillate: 'disk',
    apply: function (r) { r.disk.fs.data.used_pct = 86; return r; }
  },
  'oom-kill': {
    why: 'the OOM killer fired since the previous tick', expect: { peak_memory: 'CRITICAL' },
    apply: function (r, cfg, nowMs) { r.memory.oom_kill = envelope(true, { count: 6815 }); return r; },
    prevState: { memory: { last_oom_kill: 6812 } }
  },
  'swap-exhausted': {
    why: 'swap fully consumed while memory is still WARNING', expect: { memory: 'WARNING' },
    apply: withMemory('WARNING', 1100, 8, function (r) { r.memory.meminfo.data.swap_used_pct = 100; })
  },
  'pressure-missing': {
    why: 'the Option C publication is absent — Guardian must not read NORMAL',
    apply: function (r) { r.memory.publication = missing('missing'); return r; },
    expect: { guardian: 'DEGRADED', partial: false, memory: 'NORMAL' }
  },
  'pressure-missing-under-real-pressure': {
    why: 'the publication is gone AND the host is genuinely critical — /proc must still be believed',
    expect: { guardian: 'DEGRADED', memory: 'CRITICAL', partial: false },
    apply: function (r) {
      r.memory.publication = missing('missing');
      r.memory.meminfo.data.mem_available_mib = 500;
      r.memory.psi.data.some_avg60 = 48;
      return r;
    }
  },
  'memory-blind': {
    why: 'neither the publication nor /proc is readable — only then is memory unknown',
    expect: { guardian: 'DEGRADED', partial: true },
    apply: function (r) { r.memory.publication = missing('missing'); r.memory.meminfo = missing('unreadable'); r.memory.psi = missing('unreadable'); return r; }
  },
  'pressure-stale': {
    why: 'the publication exists but the executor stopped updating it',
    apply: function (r, cfg, nowMs) { r.memory.publication = envelope(false, { level: 'NORMAL', updated_at: iso(nowMs, 3600) }, { stale: true, age_seconds: 3600, error: 'stale' }); return r; },
    expect: { guardian: 'DEGRADED' }
  },

  'rg-lagging-kernel': {
    why: 'the Resource Guard still publishes NORMAL while the kernel is critical — the masking case',
    expect: { memory: 'CRITICAL', guardian: 'OK' },
    apply: function (r, cfg, nowMs) {
      r.memory.publication = envelope(true, { level: 'NORMAL', updated_at: iso(nowMs, 20) }, { age_seconds: 20 });
      r.memory.meminfo.data.mem_available_mib = 640;
      r.memory.psi.data.some_avg60 = 41;
      return r;
    }
  },
  'rg-lag-is-not-an-alarm': {
    why: 'one sample of disagreement during the RG confirmation delay must not escalate on its own',
    expect: { memory: 'WARNING' }, ticks: 1,
    apply: function (r, cfg, nowMs) {
      r.memory.publication = envelope(true, { level: 'WARNING', updated_at: iso(nowMs, 20) }, { age_seconds: 20 });
      r.memory.meminfo.data.mem_available_mib = 640;
      r.memory.psi.data.some_avg60 = 41;
      return r;
    }
  },
  'session-overload': {
    why: 'more agent sessions than the hard maximum', expect: { sessions: 'WARNING' },
    apply: function (r) { r.sessions.procs.data.remote_sessions = 15; r.sessions.procs.data.remote_rss_mib = 4200; r.sessions.procs.data.oldest_session_hours = 30; return r; }
  },
  'session-overload-under-pressure': {
    why: 'sessions above the CRITICAL ceiling while memory is CRITICAL', expect: { sessions: 'HIGH', memory: 'CRITICAL' },
    apply: function (r, cfg, nowMs) { withMemory('CRITICAL', 650, 48)(r, cfg, nowMs); r.sessions.procs.data.remote_sessions = 12; return r; }
  },
  'orphan-processes': {
    why: 'tool processes reparented to PID 1', expect: { sessions: 'WARNING' },
    apply: function (r) {
      r.sessions.procs.data.orphan_count = 7;
      r.sessions.procs.data.orphans = [{ pid: 1111, comm: 'node', rss_mib: 210, age_seconds: 9000 }];
      return r;
    }
  },
  'session-guard-stale': {
    why: 'the session guard itself stopped running', expect: { sessions: 'WARNING', guardian: 'DEGRADED' },
    apply: function (r) { r.sessions.guard_unit = missing('stale_or_never_run'); return r; }
  },

  'disk-warning': { why: 'filesystem crossing the warning threshold', expect: { disk: 'WARNING' }, apply: function (r) { r.disk.fs.data.used_pct = 82; r.disk.fs.data.free_gb = 13.4; return r; } },
  'disk-critical': { why: 'filesystem nearly full', expect: { disk: 'CRITICAL' }, apply: function (r) { r.disk.fs.data.used_pct = 91.5; r.disk.fs.data.free_gb = 6.1; return r; } },
  'inode-exhaustion': { why: 'inodes exhausted while blocks are fine', expect: { disk: 'CRITICAL' }, apply: function (r) { r.disk.fs.data.inode_used_pct = 93; return r; } },

  'service-down-critical': {
    why: 'a critical unit is down', expect: { services: 'CRITICAL' },
    apply: function (r) { r.services.units['erp-api'] = { observed: true, load: 'loaded', active: 'failed', sub: 'failed', result: 'exit-code', n_restarts: 3 }; return r; }
  },
  'service-down-support': {
    why: 'a support unit is down — must not read as a host emergency', expect: { services: 'WARNING' },
    apply: function (r) { r.services.units['memwatch'] = { observed: true, load: 'loaded', active: 'inactive', sub: 'dead', result: 'success', n_restarts: 0 }; return r; }
  },
  'restart-loop': {
    why: 'a production unit restarting repeatedly', expect: { services: 'HIGH' },
    apply: function (r) { r.services.units['idauto-api'].n_restarts = 12; return r; },
    prevState: { services: { restarts: { 'idauto-api': [{ at: -1, n: 0 }] } } }
  },
  'container-unhealthy': {
    why: 'a critical container reports unhealthy', expect: { services: 'CRITICAL' },
    apply: function (r) { r.services.containers['idauto-postgres'] = { observed: true, status: 'running', health: 'unhealthy', restart_count: 0 }; return r; }
  },
  'status-center-down': {
    why: 'the Status Center reports a public endpoint DOWN — Guardian reports it, it does not re-probe',
    expect: { services: 'HIGH' },
    apply: function (r, cfg, nowMs) { r.services.live_status = envelope(true, { generated_at: iso(nowMs, 60), summary: { up: 10, down: 2 }, down: ['erp-https', 'piece-https'], degraded: [] }, { age_seconds: 60 }); return r; }
  },
  'status-center-stale': {
    why: 'the Status Center stopped publishing', expect: { guardian: 'DEGRADED' },
    apply: function (r) { r.services.live_status = missing('stale'); return r; }
  },

  'backup-stale': {
    why: 'no successful backup within the failure window', expect: { backup: 'HIGH' },
    apply: function (r, cfg, nowMs) { r.backup.records['mythos-erp'].data.last_success_at = iso(nowMs, 80 * 3600); return r; }
  },
  'backup-failed-masked-by-verify': {
    why: 'the #285 case — a clean verify after a failed backup must not read as healthy',
    expect: { backup: 'WARNING' },
    apply: function (r, cfg, nowMs) {
      var d = r.backup.records['mythos-erp'].data;
      d.mode = 'verify'; d.status = 'ok'; d.last_verify_status = 'ok';
      d.last_backup_status = 'fail'; d.consecutive_failures = 2;
      return r;
    }
  },
  'restore-test-overdue': {
    why: 'the restore test has not run inside its window', expect: { backup: 'WARNING' },
    apply: function (r, cfg, nowMs) { r.backup.restore_tests['restore-mythos-erp'].data.last_run_ms = nowMs - 60 * 86400000; return r; }
  },

  'guardian-blind': {
    why: 'every input unavailable — Guardian must say BLIND, not NORMAL',
    expect: { guardian: 'BLIND', host: 'NORMAL', partial: true },
    apply: function (r, cfg) {
      r.memory = { publication: missing('missing'), meminfo: missing('unreadable'), psi: missing('unreadable'), oom_kill: missing('unreadable'), memwatch: missing('unreadable') };
      r.sessions = { procs: missing('unreadable'), snapshot: missing('missing'), guard_unit: missing('systemctl_failed') };
      r.disk = { fs: missing('statfs_failed'), docker: missing('docker_df_failed') };
      r.services = { units: {}, containers: {}, live_status: missing('missing'), errors: ['system manager query failed'] };
      cfg.services.units.forEach(function (u) { r.services.units[u.id] = { observed: false, error: 'not_reported' }; });
      cfg.services.containers.forEach(function (c) { r.services.containers[c.id] = { observed: false, error: 'not_reported' }; });
      r.backup = { records: {}, restore_tests: {} };
      cfg.backup.records.forEach(function (x) { r.backup.records[x.id] = missing('missing'); });
      cfg.backup.restore_tests.forEach(function (x) { r.backup.restore_tests[x.id] = missing('systemctl_failed'); });
      return r;
    }
  },

  'compound-incident': {
    why: 'the real 2026-09-13 shape: memory CRITICAL, sessions over the ceiling, disk high',
    expect: { host: 'CRITICAL' },
    apply: function (r, cfg, nowMs) {
      withMemory('CRITICAL', 620, 50)(r, cfg, nowMs);
      r.memory.meminfo.data.swap_used_pct = 100;
      r.sessions.procs.data.remote_sessions = 14;
      r.sessions.procs.data.remote_rss_mib = 3800;
      r.disk.fs.data.used_pct = 86;
      return r;
    }
  }
};

// Returns collectors that serve the scenario's synthetic data.
function collectorsFor(name, cfg, nowMs) {
  var s = SCENARIOS[name];
  if (!s) return null;
  var raw = baseline(cfg, nowMs);
  if (s.apply) raw = s.apply(raw, cfg, nowMs) || raw;
  return {
    memory: function () { return raw.memory; },
    sessions: function () { return raw.sessions; },
    disk: function () { return raw.disk; },
    services: function () { return raw.services; },
    backup: function () { return raw.backup; },
    _raw: raw
  };
}

// Oscillating scenarios need a different sample each tick, so they get a
// per-tick generator instead of one frozen fixture.
function oscillatingCollectors(name, cfg, nowMs, tickIndex) {
  var raw = baseline(cfg, nowMs);
  var high = tickIndex % 2 === 0;
  if (name === 'oscillating-evidence') {
    // 91 % is CRITICAL, 86 % is HIGH: two different higher levels, never the
    // same one twice in a row.
    raw.disk.fs.data.used_pct = high ? 91.2 : 86.4;
    raw.disk.fs.data.free_gb = high ? 6.0 : 11.0;
  } else {
    withMemory(high ? 'CRITICAL' : 'WARNING', high ? 650 : 900, high ? 45 : 25)(raw, cfg, nowMs);
  }
  return {
    memory: function () { return raw.memory; },
    sessions: function () { return raw.sessions; },
    disk: function () { return raw.disk; },
    services: function () { return raw.services; },
    backup: function () { return raw.backup; }
  };
}

function isOscillating(name) { return name === 'memory-oscillating' || name === 'oscillating-evidence'; }

function names() { return Object.keys(SCENARIOS); }

module.exports = { SCENARIOS: SCENARIOS, baseline: baseline, collectorsFor: collectorsFor, oscillatingCollectors: oscillatingCollectors, isOscillating: isOscillating, names: names };
