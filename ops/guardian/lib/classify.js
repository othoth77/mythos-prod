'use strict';
// =====================================================
// MYTHOS Guardian V0 — classification (pure)
// ops/guardian/lib/classify.js
//
// Each domain turns source envelopes into:
//   { raw, immediate, unknown, degraded, findings[], summary, stateOut }
//
// `unknown:true` means a required signal was missing or stale. The engine
// never converts that into NORMAL: it marks Guardian DEGRADED and reports
// the host level as partial (Phase 18).
// =====================================================

var levels = require('./levels');
var max = levels.max;

function finding(severity, kind, trigger, evidence, extra) {
  return Object.assign({ severity: severity, kind: kind, trigger: trigger, evidence: evidence === undefined ? null : evidence }, extra || {});
}

// --- memory ------------------------------------------------------------
// Guardian's independent reading of the kernel, using the Resource Guard's
// own enter thresholds. Never called earlier than the RG would call it.
function kernelLevel(avail, psi60, t) {
  if (avail === null && psi60 === null) return null;
  if ((avail !== null && avail <= t.critical_avail_mib) || (psi60 !== null && psi60 >= t.critical_psi60)) return 'CRITICAL';
  if ((avail !== null && avail <= t.warning_avail_mib) || (psi60 !== null && psi60 >= t.warning_psi60)) return 'WARNING';
  return 'NORMAL';
}

function memory(src, cfg, prev, ctx) {
  var findings = [], unknown = false, immediate = false, floor = null;
  var pub = src.publication, mi = src.meminfo, psi = src.psi, oom = src.oom_kill, mw = src.memwatch;
  var avail = mi && mi.ok ? mi.data.mem_available_mib : null;
  var psi60 = psi && psi.ok ? psi.data.some_avg60 : null;
  var swapPct = mi && mi.ok ? mi.data.swap_used_pct : null;
  var oomCount = oom && oom.ok ? oom.data.count : null;

  var raw = 'NORMAL';
  var rgLevel = null;

  var kernel = kernelLevel(avail, psi60, cfg.kernel_corroboration);

  if (pub && pub.ok) {
    rgLevel = pub.data.level;
    raw = rgLevel === 'EMERGENCY' ? 'EMERGENCY' : rgLevel;
    immediate = true;   // the Resource Guard already applied its own hysteresis

    // Disagreement detector. The RG's confirmation count makes it lag the
    // kernel by design, and a wedged or mis-thresholded RG would otherwise
    // hold Guardian at NORMAL while the host is starving — the masking
    // defect class the PR #283 review called out. Guardian reports the
    // higher kernel level, but it does NOT inherit the RG's immediacy for
    // it: the upstream-confirmed level commits at once as a floor, and
    // Guardian's own higher reading still has to earn its samples.
    if (kernel && levels.rank(kernel) > levels.rank(raw)) {
      floor = raw;
      immediate = false;
      raw = kernel;
      findings.push(finding(kernel, 'pressure_disagreement',
        'the kernel reads ' + kernel + ' while the Resource Guard publishes ' + rgLevel +
        ' (MemAvailable ' + avail + ' MiB, PSI60 ' + psi60 + ') — normal during the RG confirmation delay, sustained means the RG is not tracking the host',
        { published: rgLevel, kernel: kernel, avail: avail, psi60: psi60, publication_age_seconds: pub.age_seconds }));
    }
  } else {
    // The publication is the authoritative level, but its absence must not
    // blind the memory domain: /proc is read directly and still carries
    // usable evidence. `unknown` is reserved for NO usable signal at all
    // (below), so a real CRITICAL is never dropped from the host roll-up
    // merely because the executor stopped publishing.
    findings.push(finding('WARNING', 'pressure_source_unavailable',
      'Resource Guard publication ' + ((pub && pub.error) || 'unavailable') + ' (' + cfg.pressure_file + ')',
      pub ? { error: pub.error, age_seconds: pub.age_seconds } : null));
    // Fall back to kernel signals so a missing publication cannot read NORMAL.
    if (kernel !== null) {
      raw = kernel;
    } else {
      unknown = true;   // no publication AND no /proc: genuinely blind
    }
  }

  // Escalations layered on the authoritative level.
  if (rgLevel === 'WARNING' && ((avail !== null && avail <= cfg.high_avail_mib) || (psi60 !== null && psi60 >= cfg.high_psi60))) {
    raw = max(raw, 'HIGH');
    findings.push(finding('HIGH', 'memory_sustained', 'WARNING with MemAvailable ' + avail + ' MiB / PSI60 ' + psi60, { avail: avail, psi60: psi60 }));
  }
  if (rgLevel === 'CRITICAL' && avail !== null && avail <= cfg.emergency_avail_mib) {
    raw = 'EMERGENCY';
    immediate = false;    // EMERGENCY needs its own confirmation
    findings.push(finding('EMERGENCY', 'memory_emergency', 'CRITICAL with MemAvailable ' + avail + ' MiB <= ' + cfg.emergency_avail_mib, { avail: avail }));
  }

  // An OOM kill is a confirmed event, not a gauge.
  var prevOom = prev && typeof prev.last_oom_kill === 'number' ? prev.last_oom_kill : null;
  var oomDelta = (oomCount !== null && prevOom !== null) ? Math.max(0, oomCount - prevOom) : 0;
  if (oomDelta > 0) {
    raw = max(raw, 'CRITICAL');
    immediate = true;
    findings.push(finding('CRITICAL', 'oom_kill', oomDelta + ' new OOM kill(s) since the previous tick', { oom_kill: oomCount, delta: oomDelta }));
  }

  if (swapPct !== null && swapPct >= cfg.swap_exhausted_pct) {
    findings.push(finding(avail !== null && avail <= 1200 ? 'WARNING' : 'INFO', 'swap_exhausted',
      'swap ' + swapPct + ' % used with MemAvailable ' + avail + ' MiB', { swap_used_pct: swapPct, avail: avail }));
  }
  if (rgLevel && rgLevel !== 'NORMAL') {
    findings.push(finding(rgLevel, 'resource_guard_level', 'Resource Guard reports ' + rgLevel, { avail: avail, psi60: psi60, swap_used_pct: swapPct }));
  }
  if (mw && !mw.ok) {
    findings.push(finding('WARNING', 'memwatch_unavailable', 'memwatch telemetry ' + (mw.error || 'unavailable'), null));
  }

  var pubBad = !(pub && pub.ok);
  return {
    raw: raw, immediate: immediate, floor: floor, unknown: unknown, degraded: unknown || pubBad || (mw && !mw.ok),
    findings: findings,
    stateOut: { last_oom_kill: oomCount },
    summary: {
      resource_guard_level: rgLevel, mem_available_mib: avail, psi_some_avg60: psi60,
      swap_used_pct: swapPct, oom_kill: oomCount, oom_kill_delta: oomDelta,
      kernel_level: kernel,
      publication_age_seconds: pub ? pub.age_seconds : null,
      memwatch_age_seconds: mw ? mw.age_seconds : null
    }
  };
}

// --- sessions ----------------------------------------------------------
function sessions(src, cfg, prev, ctx) {
  var findings = [], unknown = false, degraded = false;
  var p = src.procs, snap = src.snapshot, guard = src.guard_unit;
  var raw = 'NORMAL';

  if (!p || !p.ok) {
    unknown = true;
    findings.push(finding('WARNING', 'process_scan_unavailable', 'process table unreadable', null));
    return { raw: 'NORMAL', immediate: false, unknown: true, degraded: true, findings: findings, stateOut: {}, summary: null };
  }
  var d = p.data;
  if (d.remote_sessions > cfg.hard_max_sessions) {
    raw = max(raw, 'WARNING');
    findings.push(finding('WARNING', 'agent_concurrency',
      d.remote_sessions + ' agent sessions > hard max ' + cfg.hard_max_sessions + ' (' + d.remote_rss_mib + ' MiB resident)',
      { sessions: d.remote_sessions, rss_mib: d.remote_rss_mib, oldest_hours: d.oldest_session_hours }));
  }
  var memLevel = ctx.memoryLevel || 'NORMAL';
  var ceiling = cfg.max_concurrency[memLevel];
  if (typeof ceiling === 'number' && levels.rank(memLevel) >= levels.rank('WARNING') && d.remote_sessions > ceiling) {
    var lvl = levels.rank(memLevel) >= levels.rank('CRITICAL') ? 'HIGH' : 'WARNING';
    raw = max(raw, lvl);
    findings.push(finding(lvl, 'agent_concurrency_under_pressure',
      d.remote_sessions + ' agent sessions above the ' + memLevel + ' ceiling ' + ceiling + ' — admission should be closed',
      { sessions: d.remote_sessions, ceiling: ceiling, memory_level: memLevel }));
  }
  if (d.orphan_count >= cfg.orphan_warn_count) {
    raw = max(raw, 'WARNING');
    findings.push(finding('WARNING', 'orphan_processes', d.orphan_count + ' orphaned tool processes reparented to PID 1', d.orphans));
  }
  if (d.total >= cfg.process_count_high) {
    raw = max(raw, 'HIGH');
    findings.push(finding('HIGH', 'process_count', d.total + ' processes >= ' + cfg.process_count_high, { total: d.total }));
  } else if (d.total >= cfg.process_count_warn) {
    raw = max(raw, 'WARNING');
    findings.push(finding('WARNING', 'process_count', d.total + ' processes >= ' + cfg.process_count_warn, { total: d.total }));
  }
  if (guard && !guard.ok) {
    degraded = true;
    raw = max(raw, 'WARNING');
    findings.push(finding('WARNING', 'session_guard_stale',
      'the session guard has not run recently (' + (guard.error || 'unknown') + ')', { age_seconds: guard.age_seconds }));
  }
  if (snap && !snap.ok) {
    degraded = true;
    findings.push(finding('INFO', 'session_snapshot_unavailable',
      'session-guard lifecycle snapshot ' + (snap.error || 'unavailable') + ' — Guardian used its own process scan', null));
  }
  return {
    raw: raw, immediate: false, unknown: unknown, degraded: degraded, findings: findings, stateOut: {},
    summary: {
      remote_sessions: d.remote_sessions, remote_rss_mib: d.remote_rss_mib, oldest_session_hours: d.oldest_session_hours,
      orphan_count: d.orphan_count, process_count: d.total,
      session_guard_last_run: guard && guard.ok ? guard.data.last_run_at : null,
      snapshot_sessions: snap && snap.ok ? snap.data.sessions : null,
      admission_ceiling: typeof ceiling === 'number' ? ceiling : cfg.hard_max_sessions
    }
  };
}

// --- disk --------------------------------------------------------------
function thresholdLevel(pct, t) {
  if (typeof pct !== 'number') return 'NORMAL';
  if (pct >= t.emergency_pct) return 'EMERGENCY';
  if (pct >= t.critical_pct) return 'CRITICAL';
  if (pct >= t.high_pct) return 'HIGH';
  if (pct >= t.warning_pct) return 'WARNING';
  return 'NORMAL';
}

function disk(src, cfg, prev, ctx) {
  var findings = [], unknown = false;
  var fs = src.fs, dk = src.docker;
  if (!fs || !fs.ok) {
    return { raw: 'NORMAL', immediate: false, unknown: true, degraded: true,
      findings: [finding('WARNING', 'disk_unreadable', 'statfs failed on ' + cfg.path, null)], stateOut: {}, summary: null };
  }
  var d = fs.data;
  var raw = max(thresholdLevel(d.used_pct, cfg.thresholds), thresholdLevel(d.inode_used_pct, cfg.inode_thresholds));
  if (levels.rank(raw) >= levels.rank('WARNING')) {
    findings.push(finding(raw, 'disk_pressure',
      'filesystem ' + d.path + ' ' + d.used_pct + ' % used, ' + d.free_gb + ' GB free, inodes ' + d.inode_used_pct + ' %', d));
  }
  var dockerSummary = null;
  if (dk && dk.ok) {
    dockerSummary = dk.data;
    if (levels.rank(raw) >= levels.rank('WARNING')) {
      findings.push(finding('INFO', 'disk_growth_sources',
        'Docker: ' + Object.keys(dk.data).map(function (k) { return k + ' ' + dk.data[k].size + ' (reclaimable ' + dk.data[k].reclaimable + ')'; }).join(', '),
        dk.data));
    }
  } else if (dk && !dk.ok && dk.error !== 'disabled') {
    findings.push(finding('INFO', 'docker_df_unavailable', 'docker system df ' + dk.error, null));
  }
  return {
    raw: raw, immediate: raw === 'EMERGENCY', unknown: unknown, degraded: false, findings: findings, stateOut: {},
    summary: { used_pct: d.used_pct, free_gb: d.free_gb, inode_used_pct: d.inode_used_pct, docker: dockerSummary }
  };
}

// --- services ----------------------------------------------------------
var CLASS_LEVEL = { critical: 'CRITICAL', production: 'HIGH', support: 'WARNING' };

function services(src, cfg, prev, ctx) {
  var findings = [], unknown = false, degraded = false, raw = 'NORMAL', immediate = false;
  var table = {}, restarts = {};
  var p = prev || {};
  var loopCfg = cfg.restart_loop;

  cfg.units.forEach(function (u) {
    var obs = src.units[u.id];
    var status, counter = null;
    if (!obs || obs.observed === false) { status = 'UNKNOWN'; unknown = true; }
    else if (obs.load === 'not-found') status = 'MISSING';
    else {
      counter = typeof obs.n_restarts === 'number' && !isNaN(obs.n_restarts) ? obs.n_restarts : null;
      if (obs.active === 'failed') status = 'FAILED';
      else if (obs.active === 'active' || obs.active === 'activating' || obs.active === 'reloading') status = 'OK';
      else status = 'INACTIVE';
    }
    // restart-loop window
    var hist = ((p.restarts && p.restarts[u.id]) || []).filter(function (h) { return ctx.nowMs - h.at <= loopCfg.window_minutes * 60000; });
    if (counter !== null) hist.push({ at: ctx.nowMs, n: counter });
    restarts[u.id] = hist.slice(-40);
    var delta = hist.length ? Math.max(0, hist[hist.length - 1].n - hist[0].n) : 0;
    var looping = delta >= loopCfg.restarts;

    table[u.id] = { status: looping ? 'LOOP' : status, class: u.class, restarts_in_window: delta };
    var lvl = null;
    if (looping) lvl = u.class === 'support' ? 'WARNING' : 'HIGH';
    if (status === 'FAILED' || status === 'INACTIVE' || status === 'MISSING') lvl = max(lvl || 'NORMAL', CLASS_LEVEL[u.class]);
    if (status === 'UNKNOWN') { lvl = max(lvl || 'NORMAL', 'WARNING'); degraded = true; }
    if (lvl && lvl !== 'NORMAL') {
      raw = max(raw, lvl);
      if (u.class === 'critical' && status !== 'UNKNOWN') immediate = true;
      findings.push(finding(lvl, looping ? 'restart_loop' : 'service_' + status.toLowerCase(),
        u.id + ' (' + u.class + ') ' + (looping ? 'restarted ' + delta + 'x in ' + loopCfg.window_minutes + ' min' : status),
        obs, { affected: u.id, degraded: looping }));
    }
  });

  cfg.containers.forEach(function (c) {
    var obs = src.containers[c.id];
    var status;
    if (!obs || obs.observed === false) { status = 'UNKNOWN'; unknown = true; }
    else if (obs.status !== 'running') status = 'INACTIVE';
    else if (obs.health === 'unhealthy') status = 'UNHEALTHY';
    else status = 'OK';
    table[c.id] = { status: status, class: c.class, restart_count: obs && obs.restart_count };
    if (status !== 'OK') {
      var lvl = status === 'UNKNOWN' ? 'WARNING' : CLASS_LEVEL[c.class];
      raw = max(raw, lvl);
      if (c.class === 'critical' && status !== 'UNKNOWN') immediate = true;
      if (status === 'UNKNOWN') degraded = true;
      findings.push(finding(lvl, 'container_' + status.toLowerCase(), c.id + ' (' + c.class + ') ' + status, obs, { affected: c.id }));
    }
  });

  // Status Center probes (already running; Guardian does not re-probe).
  var ls = src.live_status;
  if (ls && ls.ok) {
    if (ls.data.down.length) {
      raw = max(raw, 'HIGH');
      findings.push(finding('HIGH', 'status_center_down', 'Status Center reports DOWN: ' + ls.data.down.join(', '), ls.data.down));
    }
    if (ls.data.degraded.length) {
      findings.push(finding('INFO', 'status_center_degraded', 'Status Center reports DEGRADED: ' + ls.data.degraded.join(', '), ls.data.degraded));
    }
  } else if (ls) {
    degraded = true;
    findings.push(finding('WARNING', 'status_center_unavailable', 'Status Center live status ' + (ls.error || 'unavailable'), null));
  }
  if (src.errors && src.errors.length) {
    degraded = true;
    src.errors.forEach(function (e) { findings.push(finding('WARNING', 'service_query_failed', e, null)); });
  }

  return { raw: raw, immediate: immediate, unknown: unknown, degraded: degraded, findings: findings,
    stateOut: { restarts: restarts },
    summary: { table: table, status_center: ls && ls.ok ? ls.data.summary : null } };
}

// --- backup ------------------------------------------------------------
function backup(src, cfg, prev, ctx) {
  var findings = [], unknown = false, raw = 'NORMAL';
  var recStates = {}, resStates = {};

  cfg.records.forEach(function (r) {
    var env = src.records[r.id];
    var st, why = null;
    if (!env || !env.ok) {
      st = r.required ? 'BACKUP_FAILED' : 'BACKUP_WARNING';
      why = 'health record ' + ((env && env.error) || 'unavailable');
      unknown = true;
    } else {
      var h = env.data;
      var last = Date.parse(h.last_success_at || '');
      var ageH = isNaN(last) ? Infinity : (ctx.nowMs - last) / 3600000;
      // Post-#285 the record separates per-mode outcomes: `status` is the last
      // run of ANY mode, so a clean verify must not vouch for the backup.
      var backupOk = (h.last_backup_status !== undefined && h.last_backup_status !== '')
        ? h.last_backup_status === 'ok'
        : (h.mode === 'backup' ? h.status === 'ok' : h.status !== 'fail');
      if (ageH > r.failed_hours) { st = 'BACKUP_FAILED'; why = isFinite(ageH) ? 'no successful backup for ' + Math.round(ageH) + ' h' : 'no successful backup recorded'; }
      else if (!backupOk) { st = 'BACKUP_WARNING'; why = 'last backup run failed (' + (h.last_backup_status || h.status) + '); last success ' + Math.round(ageH) + ' h ago'; }
      else if (ageH > r.fresh_hours) { st = 'BACKUP_WARNING'; why = 'last success ' + Math.round(ageH) + ' h ago'; }
      else st = 'BACKUP_OK';
      recStates[r.id] = { state: st, detail: why, last_success_at: h.last_success_at || null, consecutive_failures: h.consecutive_failures,
        last_backup_status: h.last_backup_status === undefined ? null : h.last_backup_status, last_verify_status: h.last_verify_status === undefined ? null : h.last_verify_status };
    }
    if (!recStates[r.id]) recStates[r.id] = { state: st, detail: why };
    if (st !== 'BACKUP_OK') {
      var sev = st === 'BACKUP_FAILED' ? 'HIGH' : 'WARNING';
      raw = max(raw, sev);
      findings.push(finding(sev, st.toLowerCase(), r.id + ': ' + why, null, { affected: r.id }));
    }
  });

  cfg.restore_tests.forEach(function (t) {
    var env = src.restore_tests[t.id];
    var st, why = null;
    if (!env || !env.ok) { st = 'RESTORE_TEST_UNVERIFIED'; why = 'unit state unavailable'; unknown = true; }
    else {
      var o = env.data, maxMs = t.max_age_days * 86400000;
      if (o.last_run_ms && o.result) {
        if (o.result !== 'success' || (o.exec_status && o.exec_status !== '0')) { st = 'RESTORE_TEST_FAILED'; why = 'last run result ' + o.result + ' status ' + o.exec_status; }
        else if (ctx.nowMs - o.last_run_ms > maxMs) { st = 'RESTORE_TEST_FAILED'; why = 'no restore test in ' + t.max_age_days + ' days'; }
        else st = 'RESTORE_TEST_OK';
      } else { st = 'RESTORE_TEST_UNVERIFIED'; why = 'no systemd result recorded (host rebooted?)'; }
    }
    resStates[t.id] = { state: st, detail: why };
    if (st !== 'RESTORE_TEST_OK') {
      raw = max(raw, 'WARNING');
      findings.push(finding('WARNING', st.toLowerCase(), t.id + ': ' + why, null, { affected: t.id }));
    }
  });

  var recList = Object.keys(recStates).map(function (k) { return recStates[k].state; });
  var resList = Object.keys(resStates).map(function (k) { return resStates[k].state; });
  var backupState = recList.indexOf('BACKUP_FAILED') >= 0 ? 'BACKUP_FAILED' : (recList.indexOf('BACKUP_WARNING') >= 0 ? 'BACKUP_WARNING' : 'BACKUP_OK');
  var restoreState = resList.indexOf('RESTORE_TEST_FAILED') >= 0 ? 'RESTORE_TEST_FAILED' : (resList.indexOf('RESTORE_TEST_UNVERIFIED') >= 0 ? 'RESTORE_TEST_UNVERIFIED' : 'RESTORE_TEST_OK');
  if (backupState === 'BACKUP_OK' && restoreState !== 'RESTORE_TEST_OK') backupState = 'BACKUP_WARNING';

  return { raw: raw, immediate: false, unknown: unknown, degraded: unknown, findings: findings, stateOut: {},
    summary: { backup_state: backupState, restore_test_state: restoreState, records: recStates, restore_tests: resStates } };
}

module.exports = { memory: memory, kernelLevel: kernelLevel, sessions: sessions, disk: disk, services: services, backup: backup, thresholdLevel: thresholdLevel, CLASS_LEVEL: CLASS_LEVEL };
