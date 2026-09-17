'use strict';
// =====================================================
// MYTHOS Guardian V0 — signal sources (all read-only)
// ops/guardian/lib/sources.js
//
// Every collector returns the same envelope:
//   { ok, stale, age_seconds, data, error }
// `ok:false` means the signal is MISSING or UNUSABLE. The engine turns that
// into Guardian DEGRADED and an explicit `unknown` domain — never into a
// silent NORMAL (Phase 18).
//
// Reuse map (nothing here re-implements an existing component):
//   Resource Guard  -> the Option C publication it already writes
//   memwatch        -> its own 120 s telemetry line
//   session guard   -> its lifecycle snapshot + its unit/timer state
//   Status Center   -> live-status.json (HTTP/TLS/backup probes already run)
//   ops/backup      -> the health records it already writes
//   systemd/docker  -> queried read-only, never mutated
// =====================================================

var path = require('path');

function envelope(ok, data, extra) {
  var e = { ok: !!ok, stale: false, age_seconds: null, data: data === undefined ? null : data, error: null };
  Object.keys(extra || {}).forEach(function (k) { e[k] = extra[k]; });
  return e;
}
function missing(reason) { return envelope(false, null, { error: reason }); }

function ageSeconds(nowMs, iso) {
  var t = Date.parse(iso);
  if (isNaN(t)) return null;
  return Math.round((nowMs - t) / 1000);
}

// --- memory ------------------------------------------------------------
function kbField(text, name) {
  var m = new RegExp('^' + name + ':\\s+(\\d+)\\s*kB', 'm').exec(text || '');
  return m ? parseInt(m[1], 10) : null;
}

function memory(cfg, io, ctx) {
  var out = { publication: null, meminfo: null, psi: null, oom_kill: null, memwatch: null };

  // 1. Resource Guard publication (authoritative level; Option C).
  var pub = io.readJson(cfg.pressure_file);
  if (!pub || typeof pub !== 'object') {
    out.publication = missing(io.exists(cfg.pressure_file) ? 'unreadable_or_invalid' : 'missing');
  } else if (['NORMAL', 'WARNING', 'HIGH', 'CRITICAL', 'EMERGENCY'].indexOf(pub.level) < 0) {
    out.publication = missing('unknown_level');
  } else {
    var age = ageSeconds(ctx.nowMs, pub.updated_at);
    var stale = age === null || age < -60 || age > cfg.pressure_max_age_seconds;
    out.publication = envelope(!stale, { level: pub.level, updated_at: pub.updated_at }, { stale: stale, age_seconds: age, error: stale ? 'stale' : null });
  }

  // 2. Kernel signals, read directly (cheap, no dependency).
  var mi = io.readFile(path.join(io.procRoot, 'meminfo'));
  if (mi === null) out.meminfo = missing('unreadable');
  else {
    var availKb = kbField(mi, 'MemAvailable'), totalKb = kbField(mi, 'MemTotal');
    var swapTotalKb = kbField(mi, 'SwapTotal'), swapFreeKb = kbField(mi, 'SwapFree');
    out.meminfo = envelope(availKb !== null, {
      mem_available_mib: availKb === null ? null : Math.round(availKb / 1024),
      mem_total_mib: totalKb === null ? null : Math.round(totalKb / 1024),
      swap_total_mib: swapTotalKb === null ? null : Math.round(swapTotalKb / 1024),
      swap_used_pct: (swapTotalKb && swapFreeKb !== null) ? Math.round(1000 * (1 - swapFreeKb / swapTotalKb)) / 10 : null
    });
  }
  var psiText = io.readFile(path.join(io.procRoot, 'pressure', 'memory'));
  var pm = /^some\s+.*?avg60=([0-9.]+)/m.exec(psiText || '');
  out.psi = pm ? envelope(true, { some_avg60: parseFloat(pm[1]) }) : missing('unreadable');

  var vm = io.readFile(path.join(io.procRoot, 'vmstat'));
  var om = /^oom_kill\s+(\d+)/m.exec(vm || '');
  out.oom_kill = om ? envelope(true, { count: parseInt(om[1], 10) }) : missing('unreadable');

  // 3. memwatch corroboration: last line only, never the whole log.
  var mwLine = tailLine(io, cfg.memwatch_log);
  if (!mwLine) out.memwatch = missing('unreadable');
  else {
    var mw = /^(\S+)\s+avail=(\d+)M\/(\d+)M\s+swap=(\d+)M\/(\d+)M\s+psi60=([0-9.]+)\s+oom_kills=(\d+)/.exec(mwLine);
    if (!mw) out.memwatch = missing('unparsable');
    else {
      var mwAge = ageSeconds(ctx.nowMs, mw[1]);
      var mwStale = mwAge === null || mwAge > cfg.memwatch_max_age_seconds;
      out.memwatch = envelope(!mwStale, {
        at: mw[1], mem_available_mib: parseInt(mw[2], 10), swap_used_mib: parseInt(mw[4], 10),
        psi_some_avg60: parseFloat(mw[6]), oom_kill: parseInt(mw[7], 10)
      }, { stale: mwStale, age_seconds: mwAge, error: mwStale ? 'stale' : null });
    }
  }
  return out;
}

// Reads only the tail of a file (bounded), never the whole thing.
function tailLine(io, file, maxBytes) {
  var st = io.lstat(file);
  if (!st || !st.size) return null;
  var text = io.readFileTail ? io.readFileTail(file, maxBytes || 4096) : io.readFile(file);
  if (text === null) return null;
  var lines = String(text).trim().split('\n');
  return lines[lines.length - 1] || null;
}

// --- sessions ----------------------------------------------------------
function parseStat(text) {
  if (typeof text !== 'string') return null;
  var close = text.lastIndexOf(')'), open = text.indexOf('(');
  if (open < 0 || close < 0) return null;
  var rest = text.slice(close + 2).split(' ');
  return { comm: text.slice(open + 1, close), ppid: parseInt(rest[1], 10), starttime_ticks: parseInt(rest[19], 10) };
}

function scanProcs(io) {
  var root = io.procRoot;
  var names = io.readdir(root) || [];
  var uptime = parseFloat((io.readFile(path.join(root, 'uptime')) || '0').split(' ')[0]) || 0;
  var out = [];
  for (var i = 0; i < names.length; i++) {
    if (!/^\d+$/.test(names[i])) continue;
    var dir = path.join(root, names[i]);
    var st = parseStat(io.readFile(path.join(dir, 'stat')));
    if (!st) continue;
    var status = io.readFile(path.join(dir, 'status'));
    var rssM = /^VmRSS:\s+(\d+)/m.exec(status || '');
    var uidM = /^Uid:\s+(\d+)/m.exec(status || '');
    var cmd = io.readFile(path.join(dir, 'cmdline'));
    out.push({
      pid: parseInt(names[i], 10), ppid: st.ppid, comm: st.comm,
      uid: uidM ? parseInt(uidM[1], 10) : null,
      rss_mib: rssM ? Math.round(parseInt(rssM[1], 10) / 1024) : 0,
      age_seconds: isNaN(st.starttime_ticks) ? null : Math.max(0, Math.round(uptime - st.starttime_ticks / 100)),
      cmdline: cmd ? cmd.replace(/\0+$/, '').split('\0').join(' ').slice(0, 200) : ''
    });
  }
  return out;
}

function sessions(cfg, io, ctx) {
  var procs = ctx.procs || scanProcs(io);
  var remote = procs.filter(function (p) { return p.cmdline.indexOf(cfg.remote_cmdline_match) >= 0 && !/^(bash|sh|grep|pgrep)$/.test(p.comm); });
  var orphans = procs.filter(function (p) {
    return p.ppid === 1 && cfg.orphan_comms.indexOf(p.comm) >= 0 &&
      (p.age_seconds === null || p.age_seconds >= cfg.orphan_min_age_seconds);
  });

  var out = {
    procs: envelope(procs.length > 0, {
      total: procs.length,
      remote_sessions: remote.length,
      remote_rss_mib: remote.reduce(function (a, p) { return a + p.rss_mib; }, 0),
      oldest_session_hours: remote.length ? Math.round(Math.max.apply(null, remote.map(function (p) { return p.age_seconds || 0; })) / 360) / 10 : null,
      orphan_count: orphans.length,
      orphans: orphans.slice(0, 10).map(function (p) { return { pid: p.pid, comm: p.comm, rss_mib: p.rss_mib, age_seconds: p.age_seconds }; })
    }),
    snapshot: null,
    guard_unit: null
  };

  // The session guard's own snapshot (root writes it, deploy reads it).
  var snap = io.readJson(cfg.snapshot_file);
  if (!snap || !Array.isArray(snap.sessions)) out.snapshot = missing(io.exists(cfg.snapshot_file) ? 'unreadable_or_invalid' : 'missing');
  else {
    var sAge = ageSeconds(ctx.nowMs, snap.at);
    var sStale = sAge === null || sAge > cfg.snapshot_max_age_seconds;
    out.snapshot = envelope(!sStale, {
      sessions: snap.sessions.length,
      denied: !!snap.denied,
      // A snapshot can be complete, or partial because the root runner is
      // restricted to CAP_KILL and cannot read another user's 0700 home.
      // Partial is USABLE: it covers the homes it names.
      partial: !!snap.partial,
      read_homes: snap.read_homes || null,
      denied_homes: snap.denied_homes || null
    }, { stale: sStale, age_seconds: sAge, error: sStale ? 'stale' : null });
  }

  // Is the session guard itself running? (unit + timer state, read-only)
  var show = io.spawn(['systemctl', 'show', '--no-pager', '--timestamp=unix', '-p', 'Result', '-p', 'ExecMainExitTimestamp', '-p', 'InactiveExitTimestamp', '-p', 'ActiveState', '-p', 'SubState', cfg.session_guard_unit], { timeout_ms: 10000 });
  if (show.status !== 0) out.guard_unit = missing(show.error || 'systemctl_failed');
  else {
    var o = {};
    show.stdout.split('\n').forEach(function (l) { var i = l.indexOf('='); if (i > 0) o[l.slice(0, i)] = l.slice(i + 1); });
    // A oneshot that is running RIGHT NOW is the opposite of stale, but
    // systemd clears ExecMainExitTimestamp while the unit is activating — so
    // a tick that lands inside the guard's ~4 s run would otherwise read
    // "never ran". Observed live on 2026-09-16: a Guardian tick at 23:08:40
    // against a guard that started at 23:08:38 and finished at 23:08:42
    // reported `session_guard_stale` while the guard was healthy and on time.
    //
    // So: if it is active or activating, it is running. Otherwise use the
    // exit timestamp, falling back to InactiveExitTimestamp (when this run
    // STARTED), which survives the window in which the exit time is absent.
    var running = ['activating', 'active', 'reloading'].indexOf(o.ActiveState) >= 0;
    var atM = /^@(\d+)/.exec(o.ExecMainExitTimestamp || '');
    var startM = /^@(\d+)/.exec(o.InactiveExitTimestamp || '');
    var lastMs = atM ? parseInt(atM[1], 10) * 1000 : (startM ? parseInt(startM[1], 10) * 1000 : null);
    var gAge = lastMs === null ? null : Math.round((ctx.nowMs - lastMs) / 1000);
    var gStale = running ? false : (gAge === null || gAge > cfg.session_guard_max_age_seconds);
    out.guard_unit = envelope(!gStale, {
      result: o.Result || null,
      running: running,
      active_state: o.ActiveState || null,
      last_run_at: lastMs ? new Date(lastMs).toISOString() : null
    }, { stale: gStale, age_seconds: gAge, error: gStale ? 'stale_or_never_run' : null });
  }
  return out;
}

// --- disk --------------------------------------------------------------
function disk(cfg, io) {
  var out = { fs: null, docker: null };
  var s = io.statfs(cfg.path);
  if (!s) out.fs = missing('statfs_failed');
  else {
    var avail = s.bavail * s.bsize, used = (s.blocks - s.bfree) * s.bsize;
    out.fs = envelope(true, {
      path: cfg.path,
      used_pct: (used + avail) > 0 ? Math.round(1000 * used / (used + avail)) / 10 : null,
      free_gb: Math.round(avail / 1073741824 * 10) / 10,
      inode_used_pct: s.files > 0 ? Math.round(1000 * (s.files - s.ffree) / s.files) / 10 : null
    });
  }
  if (!cfg.docker_df) { out.docker = envelope(false, null, { error: 'disabled' }); return out; }

  // `docker system df` walks the image, volume and build-cache trees and
  // costs ~2.8 s on this host — about 80 % of a whole tick. Its output is a
  // breakdown of WHERE disk is going, which is only actionable once disk is
  // actually under pressure, so it is collected only then. Below the warning
  // threshold Guardian still reports used/free/inodes from statfs, which is
  // what the disk level is computed from; it just does not ask the Docker
  // daemon to inventory itself every two minutes for a number nobody needs.
  var floorPct = typeof cfg.docker_df_min_pct === 'number' ? cfg.docker_df_min_pct : cfg.thresholds.warning_pct;
  if (out.fs.ok && typeof out.fs.data.used_pct === 'number' && out.fs.data.used_pct < floorPct) {
    out.docker = envelope(false, null, { error: 'not_needed', note: 'disk below ' + floorPct + ' %' });
    return out;
  }
  var r = io.spawn(['docker', 'system', 'df', '--format', '{{.Type}}|{{.Size}}|{{.Reclaimable}}'], { timeout_ms: 20000 });
  if (r.status !== 0) out.docker = missing(r.error || 'docker_df_failed');
  else {
    var rows = {};
    r.stdout.trim().split('\n').forEach(function (l) {
      var f = l.split('|');
      if (f.length >= 3) rows[f[0].trim()] = { size: f[1].trim(), reclaimable: f[2].trim() };
    });
    out.docker = envelope(Object.keys(rows).length > 0, rows);
  }
  return out;
}

// --- services ----------------------------------------------------------
function parseShow(text) {
  var out = {};
  (text || '').split(/\n\s*\n/).forEach(function (block) {
    var o = {};
    block.split('\n').forEach(function (l) { var i = l.indexOf('='); if (i > 0) o[l.slice(0, i)] = l.slice(i + 1); });
    if (o.Id) out[o.Id] = o;
  });
  return out;
}

function services(cfg, io, ctx) {
  var out = { units: {}, containers: {}, live_status: null, errors: [] };

  ['system', 'deploy'].forEach(function (mgr) {
    var names = cfg.units.filter(function (u) { return u.manager === mgr; }).map(function (u) { return u.unit; });
    if (!names.length) return;
    var base = mgr === 'deploy' ? ['systemctl', '--user', 'show'] : ['systemctl', 'show'];
    var r = io.spawn(base.concat(['--no-pager', '-p', 'Id', '-p', 'LoadState', '-p', 'ActiveState', '-p', 'SubState', '-p', 'Result', '-p', 'NRestarts']).concat(names), { timeout_ms: 15000 });
    if (r.status !== 0 && !r.stdout) { out.errors.push(mgr + ' manager query failed: ' + (r.error || r.stderr.slice(0, 120))); return; }
    var shown = parseShow(r.stdout);
    cfg.units.filter(function (u) { return u.manager === mgr; }).forEach(function (u) {
      var s = shown[u.unit];
      out.units[u.id] = s
        ? { observed: true, load: s.LoadState, active: s.ActiveState, sub: s.SubState, result: s.Result, n_restarts: s.NRestarts === '' || s.NRestarts === undefined ? null : parseInt(s.NRestarts, 10) }
        : { observed: false, error: 'not_reported' };
    });
  });

  var names = cfg.containers.map(function (c) { return c.container; });
  if (names.length) {
    var d = io.spawn(['docker', 'inspect', '--format', '{{.Name}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}'].concat(names), { timeout_ms: 20000 });
    var seen = {};
    (d.stdout || '').split('\n').forEach(function (l) {
      var f = l.split('|');
      if (f.length === 4) seen[f[0].replace(/^\//, '')] = { status: f[1], health: f[2] || null, restart_count: parseInt(f[3], 10) };
    });
    cfg.containers.forEach(function (c) {
      out.containers[c.id] = seen[c.container] ? Object.assign({ observed: true }, seen[c.container]) : { observed: false, error: 'not_reported' };
    });
  }

  // Status Center output: the HTTP/TLS/backup probes already ran there.
  var ls = io.readJson(cfg.live_status_file);
  if (!ls || !Array.isArray(ls.checks)) out.live_status = missing(io.exists(cfg.live_status_file) ? 'unreadable_or_invalid' : 'missing');
  else {
    var lAge = ageSeconds(ctx.nowMs, ls.generated_at);
    var lStale = lAge === null || lAge > cfg.live_status_max_age_seconds;
    var down = ls.checks.filter(function (c) { return c.state === 'DOWN'; }).map(function (c) { return c.id; });
    var degraded = ls.checks.filter(function (c) { return c.state === 'DEGRADED'; }).map(function (c) { return c.id; });
    out.live_status = envelope(!lStale, { generated_at: ls.generated_at, summary: ls.summary || null, down: down, degraded: degraded },
      { stale: lStale, age_seconds: lAge, error: lStale ? 'stale' : null });
  }
  return out;
}

// --- backup ------------------------------------------------------------
function backup(cfg, io, ctx) {
  var out = { records: {}, restore_tests: {} };
  cfg.records.forEach(function (r) {
    var h = io.readJson(r.file);
    out.records[r.id] = h ? envelope(true, h) : missing(io.exists(r.file) ? 'unreadable_or_invalid' : 'missing');
  });
  cfg.restore_tests.forEach(function (t) {
    var r = io.spawn(['systemctl', 'show', '--no-pager', '--timestamp=unix', '-p', 'Result', '-p', 'ExecMainStatus', '-p', 'ExecMainExitTimestamp', '-p', 'InactiveExitTimestamp', '-p', 'ActiveState', t.unit], { timeout_ms: 10000 });
    if (r.status !== 0) { out.restore_tests[t.id] = missing(r.error || 'systemctl_failed'); return; }
    var o = {};
    r.stdout.split('\n').forEach(function (l) { var i = l.indexOf('='); if (i > 0) o[l.slice(0, i)] = l.slice(i + 1); });
    // Same window as the session guard: while a restore test is running,
    // systemd has cleared its exit timestamp and Result, so a tick landing
    // inside the run would read a healthy test as never-run. A restore test
    // takes minutes, not seconds, so this window is much wider than the
    // guard's — it is the more likely of the two to be hit.
    var m = /^@(\d+)/.exec(o.ExecMainExitTimestamp || '');
    var sm = /^@(\d+)/.exec(o.InactiveExitTimestamp || '');
    var inProgress = ['activating', 'active', 'reloading'].indexOf(o.ActiveState) >= 0;
    out.restore_tests[t.id] = envelope(true, {
      result: o.Result || null, exec_status: o.ExecMainStatus || null,
      running: inProgress,
      last_run_ms: m ? parseInt(m[1], 10) * 1000 : null,
      started_ms: sm ? parseInt(sm[1], 10) * 1000 : null
    });
  });
  return out;
}

module.exports = { memory: memory, sessions: sessions, disk: disk, services: services, backup: backup, scanProcs: scanProcs, parseShow: parseShow, envelope: envelope, missing: missing, ageSeconds: ageSeconds };
