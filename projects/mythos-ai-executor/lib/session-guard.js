'use strict';
// =====================================================
// MYTHOS Session Guard — Claude Desktop Remote session lifecycle
// projects/mythos-ai-executor/lib/session-guard.js
//
// GitHub Issue #144. Sibling of lib/resource-guard.js, deliberately NOT a
// merge with it: the Resource Guard answers "may a new MYTHOS task start?"
// and never touches a process. This module answers a different question
// about processes MYTHOS does not own:
//
//   Which Claude Desktop Remote sessions are provably finished, and may
//   this host reclaim them?
//
// THE MEASURED PROBLEM (gh-issue-144, confirmed on this VPS 2026-09-03).
// `/root/.claude/remote/srv/<rev>/server --serve` forks one `ccd-cli`
// process per Desktop Remote session. When the client goes away the server
// drops the connection but does NOT reap the session process. 47 sessions
// were started since 2026-08-30, 15 were still resident, ~135-273 MiB RSS
// each (~2.7 GiB total), some days old. There is no idle timeout and no
// concurrency ceiling in that server, and none can be added to it — it is
// not ours. Reclamation from outside is the only available lever.
//
// WHAT THIS MODULE IS NOT ALLOWED TO DO.
//   * It must never signal a MYTHOS executor Claude subprocess. Those run
//     as `deploy` with argv `claude -p --output-format json --session-id
//     <uuid> ...` under mythos-ai-executor.service; a Desktop Remote
//     session runs as root with argv `/root/.claude/remote/ccd-cli/<ver>
//     --output-format stream-json ...` under the root login-session scope.
//     classify() encodes that distinction and gives the EXECUTOR pattern
//     precedence, so an ambiguous process is protected, never reclaimed.
//   * It must never signal the remote server itself, its `--bridge`
//     helper, PID 1, or anything it did not positively classify.
//   * It must never act on a guess. Every termination carries the evidence
//     that produced it (age, idle seconds, cpu ticks unchanged since when,
//     orphan status, live child count) into the ledger, and every refusal
//     to act is recorded as a veto with its reason.
//   * It must never run by default. plan() is pure; enforce() is a no-op
//     unless BOTH cfg.enforce and the operator's enable marker are set.
//
// IDENTITY, NOT PID. A session is keyed by pid + the kernel's `starttime`
// field, so a recycled PID can never inherit a previous session's idle
// history or a pending SIGKILL escalation. Identity is re-verified from
// /proc immediately before every signal.
//
// FAIL-CLOSED, the opposite of resource-guard.js. Unreadable telemetry
// there must not block MYTHOS work, so it fails open. Here, unreadable
// telemetry means we cannot prove a session is dead — so it fails CLOSED:
// no evidence, no signal.
// =====================================================

var fs = require('fs');
var path = require('path');

// --- Configuration ----------------------------------------------------------

// Sessions in this population are days old and hold ~150-270 MiB each, so
// the thresholds are generous: the goal is to stop UNBOUNDED accumulation,
// not to be aggressive about a session someone stepped away from.
var DEFAULTS = {
  proc_root: '/proc',
  clock_ticks: 100,                  // kernel USER_HZ; overridden for fixtures
  // A ccd-cli argv carries an embedded --settings JSON blob several KiB
  // long. Classification reads the whole thing; everything stored or
  // printed is truncated, so neither the state file nor the ledger grows
  // without bound.
  cmdline_limit: 200,
  // Where the Desktop Remote transcripts live. Readable only by root, so
  // this signal is present when the guard runs as root and absent — never
  // wrong — when it does not.
  transcript_root: '/root/.claude/projects',

  // Lifecycle
  idle_seconds: 3600,                // no CPU/RSS movement for an hour => idle
  pressure_idle_seconds: 900,        // the same test under memory pressure
  min_age_seconds: 900,              // never touch a young session, whatever it looks like
  orphan_grace_seconds: 300,         // a reparented session must stay reparented this long
  sigkill_grace_seconds: 120,        // SIGTERM -> SIGKILL escalation window
  rss_activity_mib: 8,               // |RSS delta| above this counts as activity

  // Concurrency
  max_sessions: 6,                   // the configured ceiling
  hard_max_sessions: 8,              // absolute cap; a larger config is clamped
  // The ceiling's own inactivity floor. Being over the cap lets the guard
  // reclaim a QUIET session sooner than the standing idle timeout, but
  // never a busy one: this floor is the "no real activity" proof and is
  // never zero.
  concurrency_idle_seconds: 600,

  // Blast radius
  max_terminations_per_run: 3,
  escalate: true,                    // allow SIGTERM -> SIGKILL at all
  enforce: false,                    // dry run unless explicitly turned on
  protect_pids: [],

  history_limit: 50,
  session_retention_ms: 24 * 60 * 60 * 1000
};

// A Desktop Remote session. Path-anchored: the version segment moves
// (2.1.255 and 2.1.258 both run right now) but the directory does not.
var REMOTE_SESSION_RE = /\/\.claude\/remote\/ccd-cli\//;
// The server that forks them. `--serve` is the listener; `--bridge` is a
// short-lived helper. Neither is ever a reclamation candidate.
var REMOTE_SERVER_RE = /\/\.claude\/remote\/srv\/[^/\s]+\/server\b/;

// The MYTHOS executor's own Claude subprocess (providers/claude-code.js
// buildArgs). Matching this is an absolute protection, checked FIRST.
var EXECUTOR_SESSION_RE = /(^|\/)claude\s+-p(\s|$)/;
var EXECUTOR_MARKERS = [
  '--output-format json --session-id',
  'mythos-ai-executor',
  'mythos-github-bridge'
];

function config(opts) {
  var cfg = {};
  Object.keys(DEFAULTS).forEach(function (k) { cfg[k] = DEFAULTS[k]; });
  // Path override exists so the scanner can be driven over a fixture tree
  // in tests. It selects WHICH read-only directory to parse; it grants
  // nothing and relaxes no fence.
  if (process.env.MYTHOS_SESSION_GUARD_PROC) cfg.proc_root = process.env.MYTHOS_SESSION_GUARD_PROC;
  Object.keys(opts || {}).forEach(function (k) { cfg[k] = opts[k]; });

  // The ceiling is clamped, never trusted. An operator may lower it; a
  // config that tries to raise it past the hard cap is corrected and the
  // correction is visible in the returned config.
  var hard = num(cfg.hard_max_sessions, DEFAULTS.hard_max_sessions);
  if (hard > DEFAULTS.hard_max_sessions) hard = DEFAULTS.hard_max_sessions;
  cfg.hard_max_sessions = hard;
  var max = num(cfg.max_sessions, DEFAULTS.max_sessions);
  cfg.max_sessions_clamped = max > hard;
  cfg.max_sessions = Math.max(1, Math.min(max, hard));

  cfg.protect_pids = (cfg.protect_pids || []).map(Number).filter(function (n) { return n > 0; });
  var envProtect = process.env.MYTHOS_SESSION_GUARD_PROTECT;
  if (envProtect) {
    String(envProtect).split(/[,\s]+/).forEach(function (t) {
      var n = parseInt(t, 10);
      if (n > 0 && cfg.protect_pids.indexOf(n) < 0) cfg.protect_pids.push(n);
    });
  }
  return cfg;
}

function num(v, dflt) {
  var n = typeof v === 'string' ? parseInt(v, 10) : v;
  return (typeof n === 'number' && !isNaN(n)) ? n : dflt;
}

// --- /proc scanning ---------------------------------------------------------

function readFileSafe(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
}

// /proc/<pid>/stat: field 2 is `(comm)` and comm may contain spaces AND
// parentheses, so the only correct split is at the LAST ')'.
function parseStat(text) {
  if (typeof text !== 'string') return null;
  var close = text.lastIndexOf(')');
  if (close < 0) return null;
  var rest = text.slice(close + 1).trim().split(/\s+/);
  // rest[0] is field 3 (state), so field N is rest[N - 3].
  var utime = parseInt(rest[11], 10);      // field 14
  var stime = parseInt(rest[12], 10);      // field 15
  var starttime = parseInt(rest[19], 10);  // field 22
  if (isNaN(utime) || isNaN(stime) || isNaN(starttime)) return null;
  return {
    state: rest[0],
    comm: text.slice(text.indexOf('(') + 1, close),
    cpu_ticks: utime + stime,
    start_ticks: starttime
  };
}

function parseStatus(text) {
  if (typeof text !== 'string') return { ppid: null, uid: null, rss_mib: null };
  var ppid = /^PPid:\s+(\d+)/m.exec(text);
  var uid = /^Uid:\s+(\d+)/m.exec(text);
  var rss = /^VmRSS:\s+(\d+)\s*kB/m.exec(text);
  return {
    ppid: ppid ? parseInt(ppid[1], 10) : null,
    uid: uid ? parseInt(uid[1], 10) : null,
    rss_mib: rss ? Math.round(parseInt(rss[1], 10) / 1024) : null
  };
}

function readUptimeSeconds(cfg) {
  var t = readFileSafe(path.join(cfg.proc_root, 'uptime'));
  if (typeof t !== 'string') return null;
  var v = parseFloat(String(t).trim().split(/\s+/)[0]);
  return isNaN(v) ? null : v;
}

// One process, or null when /proc says it is gone or unreadable. Never
// throws: a process exiting mid-scan is normal, not an error.
function readProcess(pid, cfg) {
  var dir = path.join(cfg.proc_root, String(pid));
  var stat = parseStat(readFileSafe(path.join(dir, 'stat')));
  if (!stat) return null;
  var status = parseStatus(readFileSafe(path.join(dir, 'status')));
  var raw = readFileSafe(path.join(dir, 'cmdline'));
  if (raw === null) return null;
  var cmdline = String(raw).replace(/\0/g, ' ').trim();
  return {
    pid: Number(pid),
    ppid: status.ppid,
    uid: status.uid,
    rss_mib: status.rss_mib,
    comm: stat.comm,
    state: stat.state,
    cpu_ticks: stat.cpu_ticks,
    start_ticks: stat.start_ticks,
    cmdline: cmdline
  };
}

// Full snapshot. `errors` is informational; an unreadable /proc yields an
// empty list, which produces an empty plan — never a signal.
function scan(opts) {
  var cfg = config(opts);
  var now = (opts && opts.now) || Date.now();
  var uptime = readUptimeSeconds(cfg);
  var entries;
  try { entries = fs.readdirSync(cfg.proc_root); }
  catch (e) { return { at: now, uptime_seconds: uptime, procs: [], error: e.code || 'EUNREADABLE' }; }

  var procs = [];
  entries.forEach(function (name) {
    if (!/^\d+$/.test(name)) return;
    var p = readProcess(name, cfg);
    if (p) procs.push(p);
  });
  return { at: now, uptime_seconds: uptime, procs: procs, error: null };
}

// --- Classification ---------------------------------------------------------

function looksExecutor(cmdline) {
  if (EXECUTOR_SESSION_RE.test(cmdline)) return true;
  for (var i = 0; i < EXECUTOR_MARKERS.length; i++) {
    if (cmdline.indexOf(EXECUTOR_MARKERS[i]) >= 0) return true;
  }
  return false;
}

// kinds:
//   'executor'        MYTHOS's own Claude/executor process — ABSOLUTELY protected
//   'remote-server'   the Desktop Remote server / its bridge helper — protected
//   'remote-session'  a Desktop Remote ccd-cli session — the only candidate kind
//   'other'           everything else on the host — protected by omission
//
// Precedence is protective: the executor test runs first, so a process that
// somehow matched both patterns is classified 'executor' and is never a
// candidate. The reverse ordering would be the one dangerous bug in this
// module, and tests/session-guard-test.js pins it.
function classify(proc, byPid, opts) {
  var cfg = config(opts);
  var cmd = (proc && proc.cmdline) || '';
  var reasons = [];

  if (looksExecutor(cmd)) {
    reasons.push('matches executor claude subprocess pattern');
    return { kind: 'executor', reasons: reasons };
  }

  if (REMOTE_SERVER_RE.test(cmd)) {
    reasons.push('matches claude desktop remote server');
    return { kind: 'remote-server', reasons: reasons };
  }

  if (REMOTE_SESSION_RE.test(cmd)) {
    reasons.push('argv path is .claude/remote/ccd-cli/');
    var parent = byPid && proc.ppid ? byPid[proc.ppid] : null;
    var parentIsServer = !!(parent && REMOTE_SERVER_RE.test(parent.cmdline || ''));
    if (parentIsServer) reasons.push('parent pid ' + proc.ppid + ' is the remote server');
    else reasons.push('parent pid ' + proc.ppid + ' is not a live remote server (orphan candidate)');
    return { kind: 'remote-session', reasons: reasons, parent_is_server: parentIsServer };
  }

  if (cfg.protect_pids.indexOf(proc.pid) >= 0) reasons.push('explicitly protected pid');
  return { kind: 'other', reasons: reasons };
}

// Classified view of a snapshot, plus a live child count per pid — a
// session with children is doing something and is never reclaimed.
function inventory(snapshot, opts) {
  var cfg = config(opts);
  var byPid = {};
  (snapshot.procs || []).forEach(function (p) { byPid[p.pid] = p; });

  var children = {};
  (snapshot.procs || []).forEach(function (p) {
    if (p.ppid) children[p.ppid] = (children[p.ppid] || 0) + 1;
  });

  var items = (snapshot.procs || []).map(function (p) {
    // Classification reads the FULL argv; only the stored copy is cut.
    var c = classify(p, byPid, cfg);
    var ref = c.kind === 'remote-session' ? sessionRef(p.cmdline) : null;
    var out = {
      pid: p.pid, ppid: p.ppid, uid: p.uid, rss_mib: p.rss_mib,
      cpu_ticks: p.cpu_ticks, start_ticks: p.start_ticks,
      comm: p.comm, cmdline: truncate(p.cmdline, cfg.cmdline_limit),
      kind: c.kind, classify_reasons: c.reasons,
      parent_is_server: c.parent_is_server === true,
      children: children[p.pid] || 0,
      session_ref: ref,
      transcript_mtime_ms: ref ? transcriptMtimeMs(ref, cfg) : null
    };
    out.key = sessionKey(out);
    return out;
  });

  return {
    at: snapshot.at,
    uptime_seconds: snapshot.uptime_seconds,
    error: snapshot.error || null,
    items: items,
    sessions: items.filter(function (i) { return i.kind === 'remote-session'; }),
    servers: items.filter(function (i) { return i.kind === 'remote-server'; }),
    executor: items.filter(function (i) { return i.kind === 'executor'; })
  };
}

// pid alone is not an identity — PIDs are recycled. start_ticks is the
// kernel's own "which incarnation" field.
function sessionKey(item) {
  return String(item.pid) + ':' + String(item.start_ticks);
}

// The Desktop Remote session's own identity, when the argv carries it:
// a live ccd-cli is launched with `--resume=<uuid>` (observed) or
// `--session-id <uuid>`, and that uuid names the transcript. Returns null
// rather than guessing when the flag is absent.
var SESSION_REF_RE = /--(?:resume|session-id)[= ]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function sessionRef(cmdline) {
  var m = SESSION_REF_RE.exec(String(cmdline || ''));
  return m ? m[1] : null;
}

// Newest mtime of `<ref>.jsonl` under the transcript root (one directory
// level, the layout Claude Code uses: <root>/<project-slug>/<uuid>.jsonl).
// A transcript that grew recently is proof of real work, so this is an
// ACTIVITY signal only: it can keep a session alive, never mark one dead.
// Unreadable (the normal case for a non-root guard) yields null.
function transcriptMtimeMs(ref, cfg) {
  if (!ref || !cfg || !cfg.transcript_root) return null;
  var dirs;
  try { dirs = fs.readdirSync(cfg.transcript_root); } catch (e) { return null; }
  var newest = null;
  for (var i = 0; i < dirs.length; i++) {
    try {
      var st = fs.statSync(path.join(cfg.transcript_root, dirs[i], ref + '.jsonl'));
      if (newest === null || st.mtimeMs > newest) newest = st.mtimeMs;
    } catch (e) { /* not this project directory */ }
  }
  return newest;
}

function truncate(s, limit) {
  var t = String(s || '');
  return t.length > limit ? t.slice(0, limit) : t;
}

// Callers pass anything from a fully resolved config to a bare options
// object, so USER_HZ is defaulted here rather than assumed present: an
// undefined divisor would yield NaN, and a NaN age must never reach the
// fences as "old enough".
function ageSeconds(item, uptimeSeconds, cfg) {
  if (typeof uptimeSeconds !== 'number' || !item || typeof item.start_ticks !== 'number') return null;
  var hz = (cfg && cfg.clock_ticks) || DEFAULTS.clock_ticks;
  var age = uptimeSeconds - (item.start_ticks / hz);
  if (isNaN(age) || age < 0) return null;
  return Math.round(age);
}

// --- Session state tracking -------------------------------------------------

function initialState(now) {
  return {
    version: 1,
    updated_at: new Date(now || Date.now()).toISOString(),
    sessions: {},
    history: []
  };
}

function normaliseState(raw, now) {
  var st = initialState(now);
  if (!raw || typeof raw !== 'object') return st;
  if (raw.sessions && typeof raw.sessions === 'object') st.sessions = raw.sessions;
  if (Array.isArray(raw.history)) st.history = raw.history;
  if (typeof raw.updated_at === 'string') st.updated_at = raw.updated_at;
  return st;
}

// Folds one inventory into the tracked session records and returns the
// observation events (created / exited / state changes) for the ledger.
// Pure: no I/O, so the live daemon, the tests and any replay run the same
// code.
function observe(prevState, inv, opts) {
  var cfg = config(opts);
  var now = inv.at;
  var nowIso = new Date(now).toISOString();
  var st = normaliseState(prevState, now);
  var events = [];
  var seen = {};

  inv.sessions.forEach(function (item) {
    var key = item.key;
    seen[key] = true;
    var rec = st.sessions[key];
    var age = ageSeconds(item, inv.uptime_seconds, cfg);

    if (!rec) {
      // First sighting. last_active_at is NOW, never the process start:
      // we have no history for it, and "no evidence" must never read as
      // "idle since boot".
      rec = {
        key: key, pid: item.pid, start_ticks: item.start_ticks, ppid: item.ppid,
        uid: item.uid, cmdline: item.cmdline, session_ref: item.session_ref,
        first_seen_at: nowIso, last_seen_at: nowIso, last_active_at: nowIso,
        cpu_ticks: item.cpu_ticks, rss_mib: item.rss_mib,
        transcript_mtime_ms: item.transcript_mtime_ms,
        state: 'active', orphan_since: null,
        terminate: null, observations: 1
      };
      st.sessions[key] = rec;
      events.push({
        at: nowIso, event: 'session_seen', key: key, pid: item.pid,
        session_ref: item.session_ref, age_seconds: age, rss_mib: item.rss_mib
      });
    } else {
      rec.observations = (rec.observations || 0) + 1;
      rec.last_seen_at = nowIso;
      rec.ppid = item.ppid;
      // Three independent activity signals, ORed. Any one of them keeps
      // the session alive, so a session is only ever declared idle when
      // EVERY available signal says nothing happened.
      var cpuMoved = typeof item.cpu_ticks === 'number' && item.cpu_ticks !== rec.cpu_ticks;
      var rssMoved = typeof item.rss_mib === 'number' && typeof rec.rss_mib === 'number' &&
        Math.abs(item.rss_mib - rec.rss_mib) >= cfg.rss_activity_mib;
      var transcriptMoved = typeof item.transcript_mtime_ms === 'number' &&
        (typeof rec.transcript_mtime_ms !== 'number' || item.transcript_mtime_ms > rec.transcript_mtime_ms);
      if (cpuMoved || rssMoved || transcriptMoved) rec.last_active_at = nowIso;
      rec.cpu_ticks = item.cpu_ticks;
      rec.rss_mib = item.rss_mib;
      if (typeof item.transcript_mtime_ms === 'number') rec.transcript_mtime_ms = item.transcript_mtime_ms;
    }

    // Orphan = the forking server is gone (reparented to init, or the
    // parent is no longer a live remote server). Tracked with its own
    // clock so a momentary race cannot look like a settled orphan.
    var orphaned = !item.parent_is_server;
    if (orphaned && !rec.orphan_since) rec.orphan_since = nowIso;
    if (!orphaned) rec.orphan_since = null;

    var next = sessionState(rec, item, now, cfg);
    if (next !== rec.state) {
      events.push({ at: nowIso, event: 'session_state', key: key, pid: item.pid, from: rec.state, to: next });
      rec.state = next;
    }
    rec.age_seconds = age;
    rec.idle_seconds = idleSeconds(rec, now);
    rec.children = item.children;
  });

  // Sessions that are gone: record the exit once, keep the record briefly
  // so a confirmed termination stays auditable, then drop it.
  Object.keys(st.sessions).forEach(function (key) {
    var rec = st.sessions[key];
    if (seen[key]) return;
    if (rec.state !== 'exited') {
      events.push({
        at: nowIso, event: 'session_exited', key: key, pid: rec.pid,
        was: rec.state,
        terminated_by_guard: !!(rec.terminate && rec.terminate.signalled_at),
        reason: rec.terminate ? rec.terminate.reason : null
      });
      rec.state = 'exited';
      rec.exited_at = nowIso;
    }
    var since = Date.parse(rec.exited_at || rec.last_seen_at || nowIso);
    if (!isNaN(since) && (now - since) > cfg.session_retention_ms) delete st.sessions[key];
  });

  st.updated_at = nowIso;
  st.history = st.history.concat(events).slice(-cfg.history_limit);
  return { state: st, events: events };
}

function idleSeconds(rec, now) {
  var t = Date.parse(rec.last_active_at);
  if (isNaN(t)) return 0;
  return Math.max(0, Math.round((now - t) / 1000));
}

// active | idle | orphaned | terminating — the four states the issue asks
// for. `terminating` outranks the others: once signalled, a session stays
// terminating until it exits or the escalation window closes.
function sessionState(rec, item, now, cfg) {
  if (rec.terminate && rec.terminate.signalled_at && !rec.terminate.escalated_at) return 'terminating';
  if (rec.terminate && rec.terminate.escalated_at) return 'terminating';
  var orphanFor = rec.orphan_since ? (now - Date.parse(rec.orphan_since)) / 1000 : null;
  if (orphanFor !== null && orphanFor >= cfg.orphan_grace_seconds) return 'orphaned';
  if (idleSeconds(rec, now) >= cfg.idle_seconds) return 'idle';
  return 'active';
}

// --- Planning ---------------------------------------------------------------

// Every fence that can stop a signal, in one place, returning the FIRST
// reason a session must not be touched. A non-null return is a veto.
function veto(rec, item, inv, cfg, now, requiredIdleSeconds) {
  if (!item) return 'not_present';
  if (item.kind !== 'remote-session') return 'not_a_remote_session';
  if (cfg.protect_pids.indexOf(item.pid) >= 0) return 'pid_explicitly_protected';
  if (item.pid <= 1) return 'refuses_init';
  if (item.children > 0) return 'has_child_processes';
  if (typeof item.cpu_ticks !== 'number') return 'cpu_telemetry_unreadable';
  var age = ageSeconds(item, inv.uptime_seconds, cfg);
  if (age === null) return 'age_unknown';
  if (age < cfg.min_age_seconds) return 'below_min_age';
  if (rec.observations < 2) return 'single_observation';
  if (rec.state === 'orphaned') {
    var orphanFor = rec.orphan_since ? (now - Date.parse(rec.orphan_since)) / 1000 : 0;
    if (orphanFor < cfg.orphan_grace_seconds) return 'orphan_grace_not_elapsed';
    return null;
  }
  // The caller supplies the inactivity the rule it is applying requires,
  // so a rule can never be more permissive than its own threshold: the
  // idle rule passes the (possibly pressure-lowered) idle threshold, the
  // concurrency rule its own floor, and the SIGKILL escalation 0 — a
  // session already SIGTERMed may legitimately burn CPU shutting down.
  if (idleSeconds(rec, now) < requiredIdleSeconds) return 'recent_activity';
  return null;
}

// (tracked state, inventory) -> the complete, auditable decision. Pure and
// side-effect free: `plan` is exactly what `enforce` will attempt, and the
// CLI prints it verbatim in dry-run mode.
function plan(state, inv, opts) {
  var cfg = config(opts);
  var now = inv.at;
  var st = normaliseState(state, now);
  var pressureLevel = (opts && opts.pressure_level) || 'NORMAL';
  var pressure = pressureLevel === 'CRITICAL' || pressureLevel === 'WARNING';

  var byKey = {};
  inv.sessions.forEach(function (i) { byKey[i.key] = i; });

  var live = inv.sessions.map(function (item) {
    var rec = st.sessions[item.key] || {
      key: item.key, pid: item.pid, state: 'active', observations: 1,
      last_active_at: new Date(now).toISOString(), orphan_since: null, terminate: null
    };
    return {
      key: item.key, pid: item.pid, ppid: item.ppid, uid: item.uid,
      session_ref: item.session_ref || null,
      transcript_mtime_ms: item.transcript_mtime_ms || null,
      rss_mib: item.rss_mib, children: item.children,
      state: rec.state || 'active',
      age_seconds: ageSeconds(item, inv.uptime_seconds, cfg),
      idle_seconds: idleSeconds(rec, now),
      observations: rec.observations || 1,
      orphan_since: rec.orphan_since || null,
      terminate: rec.terminate || null,
      cmdline: item.cmdline
    };
  });

  var counts = { active: 0, idle: 0, orphaned: 0, terminating: 0, total: live.length };
  live.forEach(function (s) { if (counts[s.state] !== undefined) counts[s.state] += 1; });

  var actions = [];
  var vetoes = [];

  // The idle floor each rule must clear. Pressure lowers the idle rule's
  // floor (that is the whole memory guard); the concurrency rule has its
  // own, lower but never-zero floor, so a ceiling breach can be resolved
  // by reclaiming a quiet session without ever touching a working one.
  var idleThreshold = pressure ? cfg.pressure_idle_seconds : cfg.idle_seconds;
  var concurrencyThreshold = Math.min(cfg.concurrency_idle_seconds, idleThreshold);

  function candidate(s, reason, requiredIdle) {
    var item = byKey[s.key];
    var rec = st.sessions[s.key];
    if (!rec) { vetoes.push({ key: s.key, pid: s.pid, reason: 'untracked', requested: reason }); return false; }
    var v = veto(rec, item, inv, cfg, now, requiredIdle);
    if (v) { vetoes.push({ key: s.key, pid: s.pid, reason: v, requested: reason }); return false; }
    return true;
  }

  // 1. Escalation first: a session already signalled whose grace window
  //    has closed. Nothing else may consume the run's budget ahead of
  //    finishing a termination we already started.
  live.forEach(function (s) {
    if (!s.terminate || !s.terminate.signalled_at || s.terminate.escalated_at) return;
    var waited = (now - Date.parse(s.terminate.signalled_at)) / 1000;
    if (isNaN(waited) || waited < cfg.sigkill_grace_seconds) return;
    if (!cfg.escalate) { vetoes.push({ key: s.key, pid: s.pid, reason: 'escalation_disabled', requested: 'sigkill' }); return; }
    if (!candidate(s, 'sigterm_ignored', 0)) return;
    actions.push({
      key: s.key, pid: s.pid, signal: 'SIGKILL', reason: 'sigterm_ignored',
      evidence: {
        signalled_at: s.terminate.signalled_at, waited_seconds: Math.round(waited),
        grace_seconds: cfg.sigkill_grace_seconds, original_reason: s.terminate.reason,
        rss_mib: s.rss_mib, children: s.children, session_ref: s.session_ref
      }
    });
  });

  // 2. Orphans: the server that forked them is gone, so nothing can ever
  //    reconnect to them. This is the strongest evidence available.
  live.forEach(function (s) {
    if (s.state !== 'orphaned' || (s.terminate && s.terminate.signalled_at)) return;
    if (!candidate(s, 'orphaned', 0)) return;
    actions.push({
      key: s.key, pid: s.pid, signal: 'SIGTERM', reason: 'orphaned',
      evidence: {
        orphan_since: s.orphan_since, ppid: s.ppid,
        age_seconds: s.age_seconds, idle_seconds: s.idle_seconds,
        rss_mib: s.rss_mib, children: s.children, session_ref: s.session_ref
      }
    });
  });

  // 3. Idle timeout. Selected on the MEASURED inactivity against the
  //    effective threshold, not on the `idle` state label — the label is
  //    computed from the standing threshold, so keying off it would make
  //    the pressure-lowered threshold unreachable and the memory guard a
  //    no-op.
  live.filter(function (s) {
    return s.idle_seconds >= idleThreshold && s.state !== 'orphaned' &&
      !(s.terminate && s.terminate.signalled_at);
  })
    .sort(function (a, b) { return b.idle_seconds - a.idle_seconds; })
    .forEach(function (s) {
      if (!candidate(s, 'idle_timeout', idleThreshold)) return;
      actions.push({
        key: s.key, pid: s.pid, signal: 'SIGTERM',
        reason: pressure ? 'idle_timeout_under_pressure' : 'idle_timeout',
        evidence: {
          idle_seconds: s.idle_seconds, threshold_seconds: idleThreshold,
          pressure_level: pressureLevel, age_seconds: s.age_seconds,
          observations: s.observations, rss_mib: s.rss_mib, children: s.children,
          session_ref: s.session_ref
        }
      });
    });

  // 4. Concurrency ceiling. Only ever reclaims sessions that ALREADY pass
  //    every fence above — an over-limit host with nothing idle produces
  //    an over_limit report and no action, which is the correct answer:
  //    the cap must not become a reason to kill working sessions.
  var reclaimable = counts.total - actions.length;
  var overBy = reclaimable - cfg.max_sessions;
  var concurrency = {
    sessions: counts.total, max_sessions: cfg.max_sessions,
    hard_max_sessions: cfg.hard_max_sessions,
    max_sessions_clamped: !!cfg.max_sessions_clamped,
    over_limit: overBy > 0, over_by: Math.max(0, overBy),
    reclaimed_by_plan: 0, unreclaimable: 0
  };
  if (overBy > 0) {
    var chosen = 0;
    var planned = {};
    actions.forEach(function (a) { planned[a.key] = true; });
    live.filter(function (s) { return !planned[s.key] && !(s.terminate && s.terminate.signalled_at); })
      .sort(function (a, b) { return (b.idle_seconds - a.idle_seconds) || (b.age_seconds - a.age_seconds); })
      .forEach(function (s) {
        if (chosen >= overBy) return;
        if (!candidate(s, 'concurrency_limit', concurrencyThreshold)) return;
        chosen += 1;
        actions.push({
          key: s.key, pid: s.pid, signal: 'SIGTERM', reason: 'concurrency_limit',
          evidence: {
            sessions: counts.total, max_sessions: cfg.max_sessions, over_by: overBy,
            idle_seconds: s.idle_seconds, threshold_seconds: concurrencyThreshold,
            age_seconds: s.age_seconds,
            rss_mib: s.rss_mib, children: s.children, session_ref: s.session_ref
          }
        });
      });
    concurrency.reclaimed_by_plan = chosen;
    concurrency.unreclaimable = overBy - chosen;
  }

  // 5. Blast radius. Everything past the budget is deferred to the next
  //    run, recorded, not silently dropped.
  var deferred = [];
  if (actions.length > cfg.max_terminations_per_run) {
    deferred = actions.slice(cfg.max_terminations_per_run).map(function (a) {
      return { key: a.key, pid: a.pid, reason: 'max_terminations_per_run', requested: a.reason };
    });
    actions = actions.slice(0, cfg.max_terminations_per_run);
    vetoes = vetoes.concat(deferred);
  }

  return {
    at: new Date(now).toISOString(),
    enforce: !!cfg.enforce,
    dry_run: !cfg.enforce,
    counts: counts,
    concurrency: concurrency,
    pressure_level: pressureLevel,
    idle_threshold_seconds: idleThreshold,
    sessions: live,
    actions: actions,
    vetoes: vetoes,
    reclaimable_mib: actions.reduce(function (t, a) { return t + (a.evidence.rss_mib || 0); }, 0)
  };
}

// Advisory admission signal for a NEW Desktop Remote session. It is
// ADVISORY on purpose and the docs say so: the remote server is not ours
// and exposes no admission hook, so nothing here can refuse its fork. The
// enforceable half of the concurrency guard is reclamation (plan step 4);
// this is what an operator, a shell profile or a future hook can consult.
function admission(planResult, opts) {
  var cfg = config(opts);
  var counts = (planResult && planResult.counts) || { total: 0 };
  var level = (planResult && planResult.pressure_level) || 'NORMAL';
  if (level === 'CRITICAL') {
    return { admit: false, reason: 'memory_pressure', level: level, sessions: counts.total, max_sessions: cfg.max_sessions, advisory: true };
  }
  if (counts.total >= cfg.max_sessions) {
    return { admit: false, reason: 'concurrency_limit', level: level, sessions: counts.total, max_sessions: cfg.max_sessions, advisory: true };
  }
  return { admit: true, reason: null, level: level, sessions: counts.total, max_sessions: cfg.max_sessions, advisory: true };
}

// --- Enforcement ------------------------------------------------------------

// Re-reads /proc for this exact pid and proves it is STILL the same
// session we planned against, immediately before signalling. Without this,
// a pid recycled between plan() and enforce() would be signalled on the
// strength of a dead process's evidence.
function verifyIdentity(action, cfg) {
  var p = readProcess(action.pid, cfg);
  if (!p) return { ok: false, reason: 'process_gone' };
  var key = String(p.pid) + ':' + String(p.start_ticks);
  if (key !== action.key) return { ok: false, reason: 'pid_reused' };
  if (looksExecutor(p.cmdline)) return { ok: false, reason: 'is_executor_subprocess' };
  if (!REMOTE_SESSION_RE.test(p.cmdline)) return { ok: false, reason: 'no_longer_a_remote_session' };
  return { ok: true, reason: null, proc: p };
}

// Applies a plan. `killFn` is injected so tests exercise the real decision
// path without signalling anything. Returns one result per action and the
// ledger events; the caller persists both.
function enforce(planResult, state, opts, killFn) {
  var cfg = config(opts);
  var now = (opts && opts.now) || Date.parse(planResult.at) || Date.now();
  var nowIso = new Date(now).toISOString();
  var st = normaliseState(state, now);
  var results = [];
  var events = [];

  var send = killFn || function (pid, signal) { process.kill(pid, signal); };

  (planResult.actions || []).forEach(function (action) {
    if (!cfg.enforce) {
      results.push({ key: action.key, pid: action.pid, signal: action.signal, reason: action.reason, applied: false, outcome: 'dry_run' });
      return;
    }
    var check = verifyIdentity(action, cfg);
    if (!check.ok) {
      results.push({ key: action.key, pid: action.pid, signal: action.signal, reason: action.reason, applied: false, outcome: check.reason });
      events.push({ at: nowIso, event: 'terminate_aborted', key: action.key, pid: action.pid, signal: action.signal, why: check.reason });
      return;
    }
    var applied = true;
    var outcome = 'signalled';
    try { send(action.pid, action.signal); }
    catch (e) {
      applied = false;
      outcome = e && e.code === 'ESRCH' ? 'process_gone' : ('signal_failed:' + ((e && e.code) || 'EUNKNOWN'));
    }

    var rec = st.sessions[action.key];
    if (rec && applied) {
      rec.terminate = rec.terminate || {};
      if (action.signal === 'SIGKILL') rec.terminate.escalated_at = nowIso;
      else {
        rec.terminate.signalled_at = nowIso;
        rec.terminate.reason = action.reason;
        rec.terminate.evidence = action.evidence;
      }
      rec.state = 'terminating';
    }

    results.push({ key: action.key, pid: action.pid, signal: action.signal, reason: action.reason, applied: applied, outcome: outcome });
    events.push({
      at: nowIso, event: applied ? 'terminate_signalled' : 'terminate_failed',
      key: action.key, pid: action.pid, signal: action.signal,
      reason: action.reason, outcome: outcome, evidence: action.evidence
    });
  });

  (planResult.vetoes || []).forEach(function (v) {
    events.push({ at: nowIso, event: 'terminate_vetoed', key: v.key, pid: v.pid, reason: v.reason, requested: v.requested });
  });

  st.updated_at = nowIso;
  st.history = st.history.concat(events).slice(-cfg.history_limit);
  return { state: st, results: results, events: events };
}

// --- Persistence ------------------------------------------------------------

function readState(cfg) {
  if (!cfg || !cfg.state_path) return null;
  try { return JSON.parse(fs.readFileSync(cfg.state_path, 'utf8')); } catch (e) { return null; }
}

function writeState(cfg, st) {
  if (!cfg || !cfg.state_path) return false;
  try {
    fs.mkdirSync(path.dirname(cfg.state_path), { recursive: true });
    var tmp = cfg.state_path + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(st, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, cfg.state_path);
    return true;
  } catch (e) { return false; }
}

function appendLedger(cfg, events) {
  if (!cfg || !cfg.ledger_path || !events || !events.length) return false;
  try {
    fs.mkdirSync(path.dirname(cfg.ledger_path), { recursive: true });
    fs.appendFileSync(cfg.ledger_path, events.map(function (e) { return JSON.stringify(e); }).join('\n') + '\n',
      { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (e) { return false; }
}

// The operator's on/off switch, and the rollback. Enforcement needs BOTH
// cfg.enforce (an explicit --enforce or the systemd unit's argv) AND this
// marker file, so installing the timer does not by itself start signalling
// anything, and `rm` on the marker stops it without touching systemd.
function enforcementEnabled(cfg) {
  if (String(process.env.MYTHOS_SESSION_GUARD || '').toLowerCase() === 'off') return { enabled: false, reason: 'kill_switch_env' };
  if (String(process.env.MYTHOS_SESSION_GUARD || '').toLowerCase() === 'on') return { enabled: true, reason: 'env' };
  if (cfg && cfg.enable_marker_path) {
    try { fs.statSync(cfg.enable_marker_path); return { enabled: true, reason: 'marker' }; }
    catch (e) { return { enabled: false, reason: 'marker_absent' }; }
  }
  return { enabled: false, reason: 'not_enabled' };
}

// One full cycle: scan -> classify -> observe -> plan -> (enforce) ->
// persist. Never throws; on any unexpected failure it returns a plan with
// no actions, because "we could not tell" must never become "signal".
function run(opts, killFn) {
  var cfg = config(opts);
  try {
    var inv = inventory(scan(cfg), cfg);
    var prev = readState(cfg);
    var obs = observe(prev, inv, cfg);
    var pr = plan(obs.state, inv, cfg);
    var enf = enforce(pr, obs.state, cfg, killFn);
    writeState(cfg, enf.state);
    appendLedger(cfg, obs.events.concat(enf.events));
    return {
      ok: true, inventory: inv, plan: pr, results: enf.results,
      admission: admission(pr, cfg), events: obs.events.concat(enf.events), state: enf.state
    };
  } catch (e) {
    return {
      ok: false, error: (e && e.message) || String(e),
      inventory: null,
      plan: { at: new Date().toISOString(), enforce: false, dry_run: true, actions: [], vetoes: [{ reason: 'guard_error' }], counts: { active: 0, idle: 0, orphaned: 0, terminating: 0, total: 0 } },
      results: [], admission: { admit: true, reason: null, advisory: true }, events: []
    };
  }
}

// The read-only twin of run(): scan, classify and plan against the state
// ALREADY on disk, writing nothing and signalling nothing. This is what the
// executor's HTTP view and any health check use, so observing the guard can
// never advance its idle clocks, consume a termination budget, or race the
// enforcing process for its state file.
function snapshot(opts) {
  var cfg = config(opts);
  try {
    var inv = inventory(scan(cfg), cfg);
    var st = normaliseState(readState(cfg), inv.at);
    var pr = plan(st, inv, Object.assign({}, cfg, { enforce: false }));
    return { ok: true, plan: pr, admission: admission(pr, cfg), state_tracked: Object.keys(st.sessions).length };
  } catch (e) {
    return {
      ok: false, error: (e && e.message) || String(e),
      plan: { at: new Date().toISOString(), enforce: false, dry_run: true, actions: [], vetoes: [], counts: { active: 0, idle: 0, orphaned: 0, terminating: 0, total: 0 } },
      admission: { admit: true, reason: null, advisory: true }, state_tracked: 0
    };
  }
}

// Compact operator/health view — the observability answer to "how many
// sessions are active / idle / orphaned right now, and what would happen".
function report(runResult) {
  var pr = (runResult && runResult.plan) || {};
  var counts = pr.counts || {};
  return {
    at: pr.at || new Date().toISOString(),
    ok: !!(runResult && runResult.ok),
    enforce: !!pr.enforce,
    counts: counts,
    concurrency: pr.concurrency || null,
    pressure_level: pr.pressure_level || null,
    admission: (runResult && runResult.admission) || null,
    planned_terminations: (pr.actions || []).map(function (a) {
      return { pid: a.pid, signal: a.signal, reason: a.reason, rss_mib: a.evidence && a.evidence.rss_mib };
    }),
    vetoes: (pr.vetoes || []).length,
    reclaimable_mib: pr.reclaimable_mib || 0,
    resident_mib: (pr.sessions || []).reduce(function (t, s) { return t + (s.rss_mib || 0); }, 0)
  };
}

module.exports = {
  DEFAULTS: DEFAULTS,
  REMOTE_SESSION_RE: REMOTE_SESSION_RE,
  REMOTE_SERVER_RE: REMOTE_SERVER_RE,
  EXECUTOR_SESSION_RE: EXECUTOR_SESSION_RE,
  config: config,
  parseStat: parseStat,
  parseStatus: parseStatus,
  readProcess: readProcess,
  scan: scan,
  classify: classify,
  looksExecutor: looksExecutor,
  inventory: inventory,
  sessionKey: sessionKey,
  sessionRef: sessionRef,
  transcriptMtimeMs: transcriptMtimeMs,
  ageSeconds: ageSeconds,
  initialState: initialState,
  observe: observe,
  sessionState: sessionState,
  veto: veto,
  plan: plan,
  admission: admission,
  verifyIdentity: verifyIdentity,
  enforce: enforce,
  readState: readState,
  writeState: writeState,
  appendLedger: appendLedger,
  enforcementEnabled: enforcementEnabled,
  run: run,
  snapshot: snapshot,
  report: report
};
