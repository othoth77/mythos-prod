'use strict';
// =====================================================
// MYTHOS Execution Lifecycle — host correlation (Phase 9)
// projects/mythos-ai-executor/lib/lifecycle/correlate.js
//
// Answers, for every agent process on this host and every relayed PC
// session: WHAT IS IT, and what is it doing?
//
//   PID ↔ session_id ↔ execution_id ↔ task_id ↔ GitHub Issue
//
// Classification (the vocabulary the owner asked for):
//
//   ACTIVE     bound to a session; a turn is in progress
//   WAITING    bound; its execution is still open but the agent handed the
//              turn back (waiting for a human / the next prompt)
//   COMPLETED  bound; its execution already has its GitHub outcome — the
//              session outlived the task
//   IDLE       bound; no execution at all; turn ended (an interactive
//              session someone stepped away from)
//   ORPHANED   the process was reparented — nothing can reconnect to it
//   UNKNOWN    cannot be bound to a session id, or its turn cannot be read
//
// The rule that matters: a ccd-cli process by itself is UNKNOWN, not
// ACTIVE. Only evidence promotes it.
// =====================================================

var path = require('path');

var guard = require('../session-guard');
var registry = require('./registry');
var vps = require('./runtime-vps');
var model = require('./model');

var BRIDGE_WORKTREE_RE = /\/worktrees\/gh\/([a-z0-9][a-z0-9-]{4,62}[a-z0-9])(\/|$)/;

// opts: { registry: <registry cfg>, vps: <runtime-vps opts>, executor_statuses: [ {task_id, pid, claude_session_id, status, execution_id} ],
//         now, include_pc }
function hostView(opts) {
  opts = opts || {};
  var now = opts.now || Date.now();
  var vcfg = vps.config(opts.vps || {});
  var reg = opts.registry;

  // 1. Processes (session-guard's classifier: executor | remote-server | remote-session | other)
  var inv = guard.inventory(guard.scan({ proc_root: vcfg.proc_root, now: now }), { proc_root: vcfg.proc_root });
  var procs = inv.items.filter(function (i) { return i.kind === 'remote-session' || i.kind === 'executor'; });

  // 2. Claude's own registry (direct, or root snapshot when not readable)
  var claude = vps.readClaudeSessions(vcfg);
  var snap = null;
  if (claude.denied || (!claude.sessions.length && vcfg.snapshot_path)) snap = vps.loadSnapshot(vcfg, now);
  var byPid = {};
  claude.sessions.forEach(function (s) { byPid[s.pid] = { session_id: s.session_id, proc_start: s.proc_start, cwd: s.cwd, entrypoint: s.entrypoint, source: 'claude-sessions' }; });
  if (snap && !snap.stale) snap.sessions.forEach(function (s) { if (!byPid[s.pid]) byPid[s.pid] = { session_id: s.session_id, proc_start: s.proc_start, cwd: s.cwd, entrypoint: s.entrypoint, source: 'snapshot', transcript: s.transcript, identity_match: s.identity_match }; });

  // 3. Executor statuses (deploy side) — bind `claude -p` pids
  (opts.executor_statuses || []).forEach(function (st) {
    if (st && st.pid && !byPid[st.pid]) byPid[st.pid] = { session_id: st.claude_session_id || null, proc_start: null, cwd: st.working_directory || null, entrypoint: 'executor', source: 'executor-status', executor_task_id: st.task_id, execution_id: st.execution_id || null };
  });

  // 4. Registry sessions by pid (hooks told us)
  var regSessions = reg ? registry.listSessions(reg) : [];
  regSessions.forEach(function (s) {
    if (s.pid && s.state !== 'CLOSED' && (!s.host || s.host === vcfg.host) && (s.location || 'VPS') === 'VPS' && !byPid[s.pid]) {
      byPid[s.pid] = { session_id: s.session_id, proc_start: s.proc_start, cwd: s.cwd, entrypoint: s.entrypoint, source: 'registry' };
    }
  });

  var items = procs.map(function (p) {
    var bind = byPid[p.pid] || null;
    var links = { pid: p.pid, proc_start: String(p.start_ticks), session_id: null, execution_id: null, task_id: null, github_issue: null, correlation_id: null, source: null };
    var reasons = [];
    var identity = null;
    if (bind) {
      if (bind.proc_start != null) identity = String(bind.proc_start) === String(p.start_ticks);
      else if (bind.identity_match != null) identity = bind.identity_match;
      if (identity === false) { reasons.push('binding rejected: start ticks differ (recycled pid)'); bind = null; }
    }
    if (bind && bind.session_id) { links.session_id = bind.session_id; links.source = bind.source; }
    if (bind && bind.cwd) { var m = BRIDGE_WORKTREE_RE.exec(String(bind.cwd)); if (m) links.correlation_id = m[1]; }

    // Execution linkage
    var execs = [];
    if (reg && links.session_id) execs = registry.executionsForSession(reg, links.session_id);
    if (!execs.length && bind && bind.executor_task_id && reg) { var e0 = registry.findByTask(reg, bind.executor_task_id); if (e0) execs = [e0]; }
    if (execs.length) {
      execs.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
      var latest = execs[0];
      links.execution_id = latest.execution_id; links.task_id = latest.task_id; links.github_issue = latest.github_issue || null;
      if (!links.correlation_id) links.correlation_id = latest.correlation_id || null;
    } else if (bind && bind.executor_task_id) {
      links.task_id = bind.executor_task_id; links.execution_id = bind.execution_id || null;
    }
    var anyActive = execs.some(function (e) { return model.isExecutionActive(e.execution_state); });
    var anyTerminalTask = execs.some(function (e) { return model.isTaskTerminal(e.task_state) || e.execution_state === 'VERIFYING' || model.isExecutionTerminalState(e.execution_state); });

    // Turn state
    var turn = 'unknown';
    var tr = null;
    if (links.session_id) {
      if (bind && bind.transcript) tr = bind.transcript;
      else if (!claude.denied) tr = vps.transcriptState(vcfg, links.session_id);
      if (tr && tr.available) turn = tr.turn;
    }
    if (p.kind === 'executor' && turn === 'unknown' && links.session_id) { turn = 'running'; reasons.push('executor subprocess: headless, presumed working'); }
    if (p.kind === 'executor' && !links.session_id) reasons.push('executor-class process without a session binding (daemon or helper)');

    var cls;
    if (!links.session_id) { cls = 'UNKNOWN'; reasons.push('pid not bound to any session id'); }
    else if (p.kind === 'remote-session' && !p.parent_is_server) { cls = 'ORPHANED'; reasons.push('remote server gone'); }
    else if (anyActive) {
      if (turn === 'running') { cls = 'ACTIVE'; reasons.push('execution active; turn in progress'); }
      else if (turn === 'idle') { cls = 'WAITING'; reasons.push('execution active; agent handed the turn back'); }
      else { cls = 'UNKNOWN'; reasons.push('execution active but turn unreadable'); }
    } else if (execs.length && anyTerminalTask) {
      cls = 'COMPLETED'; reasons.push('execution ' + execs[0].execution_state + ', task ' + execs[0].task_state + '; session outlives the task' + (turn === 'running' ? ' (turn in progress: new work?)' : ''));
    } else if (turn === 'running') { cls = 'ACTIVE'; reasons.push('no execution linked; turn in progress (unmanaged work)'); }
    else if (turn === 'idle') { cls = 'IDLE'; reasons.push('no execution linked; turn ended' + (tr && tr.last_record_at ? ' at ' + tr.last_record_at : '')); }
    else { cls = 'UNKNOWN'; reasons.push('bound to session but turn unreadable'); }

    var lastAt = tr && tr.last_record_at ? tr.last_record_at : null;
    if (tr && tr.mtime_ms && (!lastAt || tr.mtime_ms > Date.parse(lastAt))) lastAt = new Date(Math.min(tr.mtime_ms, now)).toISOString();
    return {
      location: 'VPS', host: vcfg.host, class: cls, kind: p.kind, uid: p.uid, rss_mib: p.rss_mib,
      age_seconds: guard.ageSeconds(p, inv.uptime_seconds, { clock_ticks: vcfg.clock_ticks }),
      turn: turn, stop_reason: tr ? tr.stop_reason : null, last_activity_at: lastAt,
      links: links, executions: execs.map(function (e) { return { execution_id: e.execution_id, task_state: e.task_state, execution_state: e.execution_state, session_state: e.session_state }; }),
      cwd: bind ? bind.cwd : null, entrypoint: bind ? bind.entrypoint : null, reasons: reasons
    };
  });

  // Relayed PC sessions
  if (opts.include_pc !== false && reg) {
    regSessions.filter(function (s) { return s.location === 'PC' && s.state !== 'CLOSED'; }).forEach(function (s) {
      var execs = registry.executionsForSession(reg, s.session_id);
      var anyActive = execs.some(function (e) { return model.isExecutionActive(e.execution_state); });
      var fresh = s.last_heartbeat_at && (now - Date.parse(s.last_heartbeat_at)) <= 5 * 60 * 1000;
      var cls;
      var reasons = [];
      if (!fresh) { cls = 'UNKNOWN'; reasons.push('relay heartbeat stale'); }
      else if (anyActive) { cls = s.state === 'IDLE' ? 'WAITING' : 'ACTIVE'; reasons.push('relayed ' + s.state + '; execution active'); }
      else if (execs.length) { cls = 'COMPLETED'; reasons.push('execution done; relayed ' + s.state); }
      else if (s.state === 'IDLE') { cls = 'IDLE'; reasons.push('relayed idle, unlinked'); }
      else if (s.state === 'RUNNING') { cls = 'ACTIVE'; reasons.push('relayed running, unlinked'); }
      else { cls = 'UNKNOWN'; reasons.push('relayed ' + s.state); }
      items.push({ location: 'PC', host: s.host, class: cls, kind: 'pc-session', turn: s.state === 'RUNNING' ? 'running' : (s.state === 'IDLE' ? 'idle' : 'unknown'),
        last_activity_at: s.last_activity_at, links: { pid: s.pid, session_id: s.session_id, execution_id: s.execution_id, task_id: s.task_id, github_issue: execs[0] ? execs[0].github_issue : null, correlation_id: execs[0] ? execs[0].correlation_id : null, source: 'relay' },
        executions: execs.map(function (e) { return { execution_id: e.execution_id, task_state: e.task_state, execution_state: e.execution_state, session_state: e.session_state }; }),
        cwd: s.cwd, entrypoint: s.entrypoint, reasons: reasons });
    });
  }

  var counts = {};
  model.HOST_CLASSES.forEach(function (c) { counts[c] = 0; });
  items.forEach(function (i) { counts[i.class] = (counts[i.class] || 0) + 1; });
  return {
    at: new Date(now).toISOString(), host: vcfg.host,
    claude_registry: claude.denied ? (snap ? (snap.stale ? 'snapshot-stale' : 'snapshot') : 'denied') : 'direct',
    counts: counts, total: items.length, resident_mib: items.reduce(function (t, i) { return t + (i.rss_mib || 0); }, 0),
    sessions: items
  };
}

module.exports = { hostView: hostView, BRIDGE_WORKTREE_RE: BRIDGE_WORKTREE_RE };
