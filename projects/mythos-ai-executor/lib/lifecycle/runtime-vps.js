'use strict';
// =====================================================
// MYTHOS Execution Lifecycle — VPS Agent Runtime
// projects/mythos-ai-executor/lib/lifecycle/runtime-vps.js
//
// The runtime contract every location implements (Phase 7):
//
//   register_execution(exec)        acknowledge an execution for this runtime
//   get_session(ref)                observe one session (never guesses)
//   get_session_state(ref)          RUNNING | IDLE | COMPLETED | CLOSED | ORPHANED | UNKNOWN + evidence
//   get_last_activity(ref)          newest activity timestamp, or null
//   request_close(ref, opts, kill)  the SAFE close signal, policy-gated
//   verify_closed(ref)              proof of disappearance, identity-checked
//
// On the VPS the signals are all local and all real:
//
//   1. /proc/<pid>          existence, start ticks (identity), argv (class), cpu, rss
//   2. ~/.claude/sessions/<pid>.json     Claude Code's OWN per-process registry:
//                           { pid, sessionId, procStart, cwd, startedAt, entrypoint, kind }
//                           procStart == /proc start ticks, so a recycled PID is caught.
//   3. ~/.claude/projects/<slug>/<sessionId>.jsonl   the transcript. Its last
//                           conversational record says whether the agent is
//                           mid-turn (tool_use / user tool result) or has
//                           handed the turn back (stop_reason end_turn).
//                           This is the "idle vs running" truth ACP calls
//                           state_update; here it is read, not received.
//   4. the executor's status.json (pid + claude_session_id) for `claude -p`
//
// A process alone is NEVER evidence of activity (Phase 0 rule). A pid we
// cannot bind to a session id through (2) or (4) is UNKNOWN.
//
// Privilege. Reading /root/.claude needs root. When this module runs as
// deploy it reads the host snapshot the root guard runner exports instead
// (see snapshot()/loadSnapshot()); a stale or absent snapshot yields
// UNKNOWN, never a state.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

// In the repository this file lives next to lib/session-guard.js's parent;
// installed for the root runner it sits beside a copy of session-guard.js.
var guard = (function () {
  try { return require('../session-guard'); } catch (e) { return require('./session-guard'); }
})();

var DEFAULTS = {
  proc_root: '/proc',
  clock_ticks: 100,
  claude_homes: null,             // resolved below
  snapshot_path: null,            // deploy-readable export written by the root runner
  snapshot_max_age_ms: 10 * 60 * 1000,
  transcript_tail_bytes: 96 * 1024,
  idle_after_end_turn_ms: 0,      // end_turn is idle immediately (the human has the turn)
  host: null
};

function config(opts) {
  var cfg = {};
  Object.keys(DEFAULTS).forEach(function (k) { cfg[k] = DEFAULTS[k]; });
  Object.keys(opts || {}).forEach(function (k) { if (opts[k] !== undefined) cfg[k] = opts[k]; });
  if (process.env.MYTHOS_SESSION_GUARD_PROC && !opts.proc_root) cfg.proc_root = process.env.MYTHOS_SESSION_GUARD_PROC;
  if (!cfg.claude_homes) {
    cfg.claude_homes = process.env.MYTHOS_LIFECYCLE_CLAUDE_HOMES
      ? String(process.env.MYTHOS_LIFECYCLE_CLAUDE_HOMES).split(':').filter(Boolean)
      : uniq(['/root/.claude', '/home/deploy/.claude', path.join(os.homedir(), '.claude')]);
  }
  if (!cfg.host) cfg.host = process.env.MYTHOS_LIFECYCLE_HOST || os.hostname();
  return cfg;
}

function uniq(list) { var seen = {}; return list.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; }); }
function readSafe(f) { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; }
}
function statSafe(f) { try { return fs.statSync(f); } catch (e) { return null; } }

// --- Signal 2: Claude's own per-pid session registry -------------------------------

function readClaudeSessions(cfg) {
  var out = [];
  var denied = false;
  cfg.claude_homes.forEach(function (home) {
    var dir = path.join(home, 'sessions');
    var names;
    try { names = fs.readdirSync(dir); }
    catch (e) { if (e && (e.code === 'EACCES' || e.code === 'EPERM')) denied = true; return; }
    names.forEach(function (n) {
      var m = /^(\d+)\.json$/.exec(n);
      if (!m) return;
      var raw = readSafe(path.join(dir, n));
      if (!raw) return;
      try {
        var j = JSON.parse(raw);
        if (!j || !j.sessionId) return;
        out.push({
          pid: parseInt(m[1], 10), session_id: String(j.sessionId), proc_start: j.procStart != null ? String(j.procStart) : null,
          cwd: j.cwd || null, started_at: j.startedAt ? new Date(j.startedAt).toISOString() : null,
          entrypoint: j.entrypoint || null, kind: j.kind || null, version: j.version || null, claude_home: home
        });
      } catch (e) { /* skip */ }
    });
  });
  return { sessions: out, denied: denied };
}

// --- Signal 3: transcript turn state ---------------------------------------------------

function transcriptPath(cfg, sessionId) {
  for (var h = 0; h < cfg.claude_homes.length; h++) {
    var root = path.join(cfg.claude_homes[h], 'projects');
    var dirs;
    try { dirs = fs.readdirSync(root); } catch (e) { continue; }
    for (var i = 0; i < dirs.length; i++) {
      var f = path.join(root, dirs[i], sessionId + '.jsonl');
      if (statSafe(f)) return f;
    }
  }
  return null;
}

// Reads only the tail. Returns { turn: 'running'|'idle'|'unknown', stop_reason,
// last_record_at, mtime_ms, last_role }.
function transcriptState(cfg, sessionId) {
  var f = transcriptPath(cfg, sessionId);
  if (!f) return { available: false, turn: 'unknown', stop_reason: null, last_record_at: null, mtime_ms: null, path: null };
  var st = statSafe(f);
  var fd;
  var text = '';
  try {
    fd = fs.openSync(f, 'r');
    var size = st.size;
    var len = Math.min(size, cfg.transcript_tail_bytes);
    var buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    text = buf.toString('utf8');
  } catch (e) { return { available: false, turn: 'unknown', stop_reason: null, last_record_at: null, mtime_ms: st ? st.mtimeMs : null, path: f }; }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* ignore */ } } }
  var lines = text.split('\n');
  var turn = 'unknown';
  var stop = null;
  var lastAt = null;
  var lastRole = null;
  for (var i = lines.length - 1; i >= 0; i--) {
    var l = lines[i];
    if (!l || l[0] !== '{') continue;
    var o;
    try { o = JSON.parse(l); } catch (e) { continue; }
    if (o.type !== 'assistant' && o.type !== 'user') continue;
    if (o.isSidechain === true) continue; // subagent traffic is not the main turn
    lastAt = o.timestamp || null;
    lastRole = o.type;
    if (o.type === 'assistant') {
      var sr = o.message && o.message.stop_reason;
      stop = sr || null;
      var hasToolUse = Array.isArray(o.message && o.message.content) && o.message.content.some(function (c) { return c && c.type === 'tool_use'; });
      if (sr === 'tool_use' || hasToolUse) turn = 'running';
      else if (sr === 'end_turn' || sr === 'stop_sequence' || sr === 'max_tokens' || sr === 'refusal') turn = 'idle';
      else if (sr === null || sr === undefined) turn = 'running'; // streaming partial
      else turn = 'idle';
    } else {
      // A user record (prompt or tool_result) after which no assistant
      // record exists: the model has the turn.
      turn = 'running';
    }
    break;
  }
  return { available: true, turn: turn, stop_reason: stop, last_record_at: lastAt, last_role: lastRole, mtime_ms: st ? st.mtimeMs : null, path: f };
}

// --- Signal 1: process ---------------------------------------------------------------

function readProc(cfg, pid) {
  var p = guard.readProcess(pid, { proc_root: cfg.proc_root });
  if (!p) return null;
  var byPid = {};
  if (p.ppid) { var parent = guard.readProcess(p.ppid, { proc_root: cfg.proc_root }); if (parent) byPid[p.ppid] = parent; }
  var c = guard.classify(p, byPid, {});
  return { pid: p.pid, ppid: p.ppid, uid: p.uid, rss_mib: p.rss_mib, cpu_ticks: p.cpu_ticks, start_ticks: String(p.start_ticks),
    kind: c.kind, parent_is_server: c.parent_is_server === true, cmdline: String(p.cmdline || '').slice(0, 160) };
}

function uptime(cfg) {
  var t = readSafe(path.join(cfg.proc_root, 'uptime'));
  var v = t ? parseFloat(String(t).trim().split(/\s+/)[0]) : NaN;
  return isNaN(v) ? null : v;
}

// --- Snapshot (privilege bridge) --------------------------------------------------------

// Everything a non-root observer needs, computed by whoever CAN read the
// Claude homes (the root guard runner) and written to a deploy-readable
// file. No argv, no secrets, no transcript content: ids, pids, identity
// ticks, turn state, timestamps.
function snapshot(opts) {
  var cfg = config(opts || {});
  var now = (opts && opts.now) || Date.now();
  var reg = readClaudeSessions(cfg);
  var up = uptime(cfg);
  var items = reg.sessions.map(function (s) {
    var proc = readProc(cfg, s.pid);
    var identity = proc ? (s.proc_start === null || String(proc.start_ticks) === String(s.proc_start)) : false;
    var tr = transcriptState(cfg, s.session_id);
    return {
      session_id: s.session_id, pid: s.pid, proc_start: s.proc_start, identity_match: identity,
      process_present: !!proc, kind: proc ? proc.kind : null, parent_is_server: proc ? proc.parent_is_server : null,
      uid: proc ? proc.uid : null, rss_mib: proc ? proc.rss_mib : null, cpu_ticks: proc ? proc.cpu_ticks : null,
      age_seconds: proc && up !== null ? Math.max(0, Math.round(up - (parseInt(proc.start_ticks, 10) / cfg.clock_ticks))) : null,
      cwd: s.cwd, started_at: s.started_at, entrypoint: s.entrypoint, session_kind: s.kind,
      transcript: { available: tr.available, turn: tr.turn, stop_reason: tr.stop_reason, last_record_at: tr.last_record_at, mtime_ms: tr.mtime_ms }
    };
  });
  return { at: new Date(now).toISOString(), host: cfg.host, location: 'VPS', denied: reg.denied, uptime_seconds: up, sessions: items };
}

function writeSnapshot(cfg, snap) {
  if (!cfg.snapshot_path) return false;
  try {
    fs.mkdirSync(path.dirname(cfg.snapshot_path), { recursive: true });
    var tmp = cfg.snapshot_path + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(snap) + '\n', { encoding: 'utf8', mode: 0o640 });
    fs.renameSync(tmp, cfg.snapshot_path);
    return true;
  } catch (e) { return false; }
}

function loadSnapshot(cfg, now) {
  if (!cfg.snapshot_path) return null;
  var raw = readSafe(cfg.snapshot_path);
  if (!raw) return null;
  try {
    var s = JSON.parse(raw);
    var age = (now || Date.now()) - Date.parse(s.at);
    if (isNaN(age) || age > cfg.snapshot_max_age_ms) return { stale: true, at: s.at, sessions: [] };
    return s;
  } catch (e) { return null; }
}

// --- The observation ----------------------------------------------------------------------

// ref: { session_id?, pid?, proc_start?, executor_status? }
// executor_status is the task's status.json when the caller has it (deploy
// side) — it binds a `claude -p` pid to its session id without /root access.
function getSession(ref, opts) {
  var cfg = config(opts || {});
  var now = (opts && opts.now) || Date.now();
  var reg = readClaudeSessions(cfg);
  var fromSnap = null;
  if (reg.denied || (!reg.sessions.length && cfg.snapshot_path)) {
    fromSnap = loadSnapshot(cfg, now);
  }

  var out = { found: false, source: null, session_id: ref.session_id || null, pid: ref.pid || null, proc_start: ref.proc_start || null,
    identity_match: null, process: null, claude: null, transcript: null, evidence: [] };

  // Bind via Claude's registry (direct or snapshot).
  var bound = null;
  var usurped = null; // the pid is alive but registered to ANOTHER session
  function pick(list) {
    var bySid = ref.session_id ? list.filter(function (s) { return s.session_id === ref.session_id; })[0] : null;
    if (bySid) return bySid;
    var byPid = ref.pid ? list.filter(function (s) { return s.pid === ref.pid; })[0] : null;
    if (byPid && ref.session_id && byPid.session_id !== ref.session_id) { usurped = byPid; return null; }
    return byPid || null;
  }
  if (!reg.denied && reg.sessions.length) {
    bound = pick(reg.sessions);
    if (bound) { out.source = 'claude-sessions'; out.claude = bound; }
  }
  if (usurped) {
    out.identity_match = false;
    out.evidence.push('pid ' + ref.pid + ' now belongs to session ' + usurped.session_id + ': recycled pid');
  }
  if (!bound && !usurped && fromSnap && !fromSnap.stale) {
    var sn = pick(fromSnap.sessions);
    if (sn) {
      out.source = 'snapshot'; out.found = true;
      out.session_id = sn.session_id; out.pid = sn.pid; out.proc_start = sn.proc_start; out.identity_match = sn.identity_match;
      out.process = sn.process_present ? { pid: sn.pid, kind: sn.kind, parent_is_server: sn.parent_is_server, rss_mib: sn.rss_mib, cpu_ticks: sn.cpu_ticks, start_ticks: sn.proc_start, age_seconds: sn.age_seconds } : null;
      out.claude = { cwd: sn.cwd, started_at: sn.started_at, entrypoint: sn.entrypoint, kind: sn.session_kind };
      out.transcript = sn.transcript;
      out.evidence.push('bound via root snapshot at ' + fromSnap.at);
      return out;
    }
  }
  if (fromSnap && fromSnap.stale) out.evidence.push('root snapshot stale (' + fromSnap.at + ')');

  // Bind via the executor's own record.
  if (!bound && ref.executor_status && ref.executor_status.pid && (!ref.session_id || ref.executor_status.claude_session_id === ref.session_id)) {
    bound = { pid: ref.executor_status.pid, session_id: ref.executor_status.claude_session_id || ref.session_id, proc_start: null, cwd: null };
    out.source = 'executor-status';
    out.evidence.push('pid from executor status.json');
  }

  if (bound) {
    out.found = true;
    out.session_id = bound.session_id || out.session_id;
    out.pid = bound.pid;
    out.proc_start = bound.proc_start || out.proc_start;
  }

  // Process identity.
  var pid = out.pid;
  if (pid) {
    var proc = readProc(cfg, pid);
    if (proc) {
      out.process = proc;
      var up = uptime(cfg);
      if (up !== null) out.process.age_seconds = Math.max(0, Math.round(up - (parseInt(proc.start_ticks, 10) / cfg.clock_ticks)));
      if (usurped) out.identity_match = false;
      else if (out.proc_start) out.identity_match = String(proc.start_ticks) === String(out.proc_start);
      else if (out.source === 'executor-status') out.identity_match = guard.looksExecutor(proc.cmdline) || proc.kind === 'executor';
      else out.identity_match = null;
      if (out.identity_match === false) out.evidence.push('pid ' + pid + ' has different start ticks: recycled pid');
    } else {
      out.evidence.push('pid ' + pid + ' absent from /proc');
    }
  }

  // Transcript.
  if (out.session_id && !reg.denied) {
    out.transcript = transcriptState(cfg, out.session_id);
  }
  if (!out.found && out.session_id && out.transcript && out.transcript.available) {
    out.found = true; out.source = out.source || 'transcript-only';
    out.evidence.push('session known only by transcript (no pid binding)');
  }
  return out;
}

// RUNNING | IDLE | COMPLETED | CLOSED | ORPHANED | UNKNOWN, with the evidence.
function getSessionState(ref, opts) {
  var obs = getSession(ref, opts);
  var now = (opts && opts.now) || Date.now();
  var evidence = obs.evidence.slice();
  var state = 'UNKNOWN';

  var processAlive = !!(obs.process && obs.identity_match !== false);
  if (obs.pid && !obs.process) { state = 'CLOSED'; evidence.push('process gone'); }
  else if (obs.pid && obs.process && obs.identity_match === false) { state = 'CLOSED'; evidence.push('pid recycled by another process'); }
  else if (processAlive) {
    if (obs.process.kind === 'remote-session' && obs.process.parent_is_server === false) { state = 'ORPHANED'; evidence.push('remote session reparented: server gone'); }
    else if (obs.transcript && obs.transcript.available) {
      if (obs.transcript.turn === 'running') { state = 'RUNNING'; evidence.push('transcript: turn in progress (' + (obs.transcript.stop_reason || 'streaming') + ')'); }
      else if (obs.transcript.turn === 'idle') { state = 'IDLE'; evidence.push('transcript: turn ended (' + obs.transcript.stop_reason + ') at ' + obs.transcript.last_record_at); }
      else { state = 'UNKNOWN'; evidence.push('transcript unreadable turn'); }
    } else if (obs.process.kind === 'executor') { state = 'RUNNING'; evidence.push('executor subprocess alive (headless, no transcript access)'); }
    else { state = 'UNKNOWN'; evidence.push('process alive but no transcript: cannot tell running from idle'); }
  } else if (!obs.found) { state = 'UNKNOWN'; evidence.push('session not observable'); }
  else if (!obs.pid) {
    if (obs.transcript && obs.transcript.available) { state = 'UNKNOWN'; evidence.push('transcript exists but no process binding'); }
  }

  var last = getLastActivityFrom(obs, now);
  return { state: state, evidence: evidence, last_activity_at: last, observation: obs, at: new Date(now).toISOString() };
}

function getLastActivityFrom(obs, now) {
  var t = null;
  if (obs.transcript && obs.transcript.mtime_ms) t = obs.transcript.mtime_ms;
  if (obs.transcript && obs.transcript.last_record_at) { var r = Date.parse(obs.transcript.last_record_at); if (!isNaN(r) && (t === null || r > t)) t = r; }
  return t === null ? null : new Date(Math.min(t, now)).toISOString();
}

function getLastActivity(ref, opts) { return getLastActivityFrom(getSession(ref, opts), (opts && opts.now) || Date.now()); }

// The SAFE close signal, and nothing else, and only when the caller proves
// it holds the authority (cleanup.js with enforcement enabled). Force is a
// separate, explicit, audited path that this function refuses unless the
// policy object says so in so many words.
function requestClose(ref, opts, killFn) {
  var cfg = config(opts || {});
  var authorized = !!(opts && opts.authorized === true);
  var force = !!(opts && opts.force === true);
  var policy = (opts && opts.policy) || {};
  var obs = getSession(ref, opts);
  var send = killFn || function (pid, sig) { process.kill(pid, sig); };
  if (!authorized) return { ok: false, signalled: false, reason: 'not_authorized' };
  if (!obs.pid || !obs.process) return { ok: false, signalled: false, reason: 'process_absent' };
  if (obs.identity_match === false) return { ok: false, signalled: false, reason: 'pid_recycled' };
  if (obs.identity_match === null && obs.process.kind !== 'executor') return { ok: false, signalled: false, reason: 'identity_unverified' };
  if (obs.process.kind !== 'remote-session') return { ok: false, signalled: false, reason: 'not_a_closable_kind:' + obs.process.kind };
  if (obs.pid <= 1) return { ok: false, signalled: false, reason: 'refuses_init' };
  // A process owned by another account (root's Desktop Remote sessions,
  // seen from deploy) cannot be signalled from here and must not be tried:
  // the request is DELEGATED — the registry's CLOSE_REQUESTED phase is the
  // request, and the root Session Guard (which reads the registry and owns
  // CAP_KILL) applies the safe signal under its own fences.
  var me = process.getuid ? process.getuid() : null;
  if (me !== null && me !== 0 && typeof obs.process.uid === 'number' && obs.process.uid !== me) {
    return { ok: true, signalled: true, delegated: true, signal: force ? 'delegated:SIGKILL' : 'delegated:SIGTERM', pid: obs.pid, session_id: obs.session_id, proc_start: obs.proc_start, reason: 'delegated_to_root_session_guard' };
  }
  var signal = 'SIGTERM';
  if (force) {
    if (policy.force_kill_enabled !== true) return { ok: false, signalled: false, reason: 'force_kill_disabled_by_policy' };
    if (!(opts && opts.force_confirmed === true)) return { ok: false, signalled: false, reason: 'force_not_confirmed' };
    signal = 'SIGKILL';
  }
  try { send(obs.pid, signal); }
  catch (e) { return { ok: false, signalled: false, reason: e && e.code === 'ESRCH' ? 'process_gone' : 'signal_failed:' + ((e && e.code) || 'EUNKNOWN') }; }
  return { ok: true, signalled: true, signal: signal, pid: obs.pid, session_id: obs.session_id, proc_start: obs.proc_start };
}

function verifyClosed(ref, opts) {
  var obs = getSession(ref, opts);
  if (!obs.pid) {
    if (obs.claude && obs.claude.pid) return { closed: false, reason: 'registry_still_lists_pid' };
    return { closed: null, reason: 'no_pid_to_verify' };
  }
  if (!obs.process) return { closed: true, reason: 'process_gone', pid: obs.pid };
  if (obs.identity_match === false) return { closed: true, reason: 'pid_recycled', pid: obs.pid };
  return { closed: false, reason: 'process_present', pid: obs.pid, kind: obs.process.kind };
}

function registerExecution(exec) { return { ok: true, location: 'VPS', execution_id: exec && exec.execution_id }; }

module.exports = {
  LOCATION: 'VPS',
  DEFAULTS: DEFAULTS,
  config: config,
  readClaudeSessions: readClaudeSessions,
  transcriptPath: transcriptPath,
  transcriptState: transcriptState,
  readProc: readProc,
  snapshot: snapshot,
  writeSnapshot: writeSnapshot,
  loadSnapshot: loadSnapshot,
  register_execution: registerExecution,
  get_session: getSession,
  get_session_state: getSessionState,
  get_last_activity: getLastActivity,
  request_close: requestClose,
  verify_closed: verifyClosed
};
