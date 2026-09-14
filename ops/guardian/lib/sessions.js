'use strict';
// =====================================================
// MYTHOS Guardian — agent session domain (read-only)
// ops/guardian/lib/sessions.js
//
// REUSES mythos-session-guard: it stays the ONLY component that signals an
// agent session (precise classifier, vetoes, marker-gated enforcement).
// Guardian's part is to
//   * count Desktop Remote ccd-cli sessions and their resident memory,
//   * verify the session guard itself is running and whether it enforces,
//   * feed it a fresh pressure level (memory-level.json — see report.js),
//   * publish an advisory admission ceiling by host level,
//   * REPORT orphaned tool processes reparented to PID 1 inside login
//     session scopes. Reported, never killed: an orphan is not proof of a
//     disposable process.
// =====================================================

var path = require('path');
var levels = require('./levels');

var REMOTE_RE = /\/\.claude\/remote\/ccd-cli\//;
var ORPHAN_COMMS = ['node', 'npm', 'npx', 'next-server', 'chrome', 'chromium', 'headless_shell', 'esbuild', 'vitest', 'jest', 'tsc', 'playwright'];

function collect(cfg, io, ctx) {
  var list = ctx.procs || [];
  var remote = list.filter(function (p) { return REMOTE_RE.test(p.cmdline) && !/^(bash|sh|grep|pgrep)$/.test(p.comm); });
  var orphans = list.filter(function (p) {
    if (p.ppid !== 1 || ORPHAN_COMMS.indexOf(p.comm) < 0 || (p.age_seconds !== null && p.age_seconds < (cfg.orphan_min_age_seconds || 600))) return false;
    var cg = io.readFile(path.join(io.procRoot, String(p.pid), 'cgroup')) || '';
    return /user\.slice\/user-\d+\.slice\/session-\d+\.scope/.test(cg);
  });
  var gs = io.readJson(cfg.session_guard_state || '/var/lib/mythos-session-guard/session-guard.json');
  return {
    remote_sessions: remote.length,
    remote_rss_mib: remote.reduce(function (a, p) { return a + p.rss_mib; }, 0),
    oldest_session_age_hours: remote.length ? Math.round(Math.max.apply(null, remote.map(function (p) { return p.age_seconds || 0; })) / 360) / 10 : null,
    orphans: orphans.slice(0, 20).map(function (p) { return { pid: p.pid, comm: p.comm, uid: p.uid, rss_mib: p.rss_mib, age_seconds: p.age_seconds }; }),
    orphan_count: orphans.length,
    session_guard_updated_at: gs && gs.updated_at || null,
    session_guard_enforcing: io.exists(cfg.session_guard_marker || '/var/lib/mythos-session-guard/session-guard.enabled')
  };
}

function classify(m, cfg, prev, ctx) {
  var findings = [];
  var raw = 'NORMAL';
  var hardMax = cfg.hard_max_sessions || 8;
  if (m.remote_sessions > hardMax) {
    raw = 'WARNING';
    findings.push({ severity: 'WARNING', kind: 'agent_concurrency', trigger: m.remote_sessions + ' agent sessions > hard max ' + hardMax + ' (' + m.remote_rss_mib + ' MiB resident)', evidence: { sessions: m.remote_sessions, rss_mib: m.remote_rss_mib } });
  }
  var memLevel = ctx.memoryLevel || 'NORMAL';
  var ceiling = (cfg.max_concurrency || {})[memLevel];
  if (typeof ceiling === 'number' && levels.rank(memLevel) >= levels.rank('WARNING') && m.remote_sessions > ceiling) {
    var lvl = levels.rank(memLevel) >= levels.rank('CRITICAL') ? 'HIGH' : 'WARNING';
    raw = levels.max(raw, lvl);
    findings.push({ severity: lvl, kind: 'agent_concurrency_under_pressure', trigger: m.remote_sessions + ' agent sessions above the ' + memLevel + ' ceiling ' + ceiling, evidence: { sessions: m.remote_sessions, memory_level: memLevel } });
  }
  var guardAge = m.session_guard_updated_at ? (ctx.nowMs - Date.parse(m.session_guard_updated_at)) / 60000 : Infinity;
  if (!(guardAge <= (cfg.session_guard_stale_minutes || 15))) {
    raw = levels.max(raw, 'WARNING');
    findings.push({ severity: 'WARNING', kind: 'session_guard_stale', affected: 'mythos-session-guard', trigger: 'session guard state not updated for ' + (isFinite(guardAge) ? Math.round(guardAge) + ' min' : 'ever') });
  }
  if (m.orphan_count >= (cfg.orphan_warn_count || 5)) {
    raw = levels.max(raw, 'WARNING');
    findings.push({ severity: 'WARNING', kind: 'orphan_processes', trigger: m.orphan_count + ' orphaned tool processes under login sessions', evidence: m.orphans });
  }
  return { raw: raw, immediate: false, findings: findings, plan: [], stateOut: {}, summary: m };
}

// Advisory only: nothing on this host can refuse a Desktop app session, so
// the ceiling is published for hooks, the executor and humans to honour.
function admission(overallLevel, cfg, sessionsNow) {
  var ceiling = (cfg.max_concurrency || {})[overallLevel];
  if (typeof ceiling !== 'number') ceiling = cfg.hard_max_sessions || 8;
  return { advisory: true, level: overallLevel, max_heavy_sessions: ceiling, sessions: sessionsNow, admit_new_heavy_session: sessionsNow < ceiling };
}

module.exports = { collect: collect, classify: classify, admission: admission, REMOTE_RE: REMOTE_RE };
