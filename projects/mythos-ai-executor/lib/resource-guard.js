'use strict';
// =====================================================
// MYTHOS Resource Guard — host memory pressure state machine
// projects/mythos-ai-executor/lib/resource-guard.js
//
// Decides whether the host is safe enough to ADMIT a new AI task, from
// three signals only:
//
//   MemAvailable        /proc/meminfo      — what a new process can get
//   PSI memory some/60  /proc/pressure/memory — how hard reclaim is working
//   oom_kill delta      /proc/vmstat       — kills that already happened
//
// SWAP IS REPORTED, NEVER A TRIGGER. Measured on this host (gh-issue-101
// investigation): swap sits at 97-100% used for days while MemAvailable is
// ~2.5 GiB and PSI is 0.00 — a swap-percentage trigger would park a
// provably healthy host in CRITICAL forever. Swap is carried in the sample
// for the message body and for humans, and no threshold reads it.
//
// States: NORMAL → WARNING → CRITICAL, and RECOVERED as the one-shot alert
// kind emitted on the degraded → NORMAL edge (it is an alert kind, not a
// resting state; the resting state after recovery is NORMAL).
//
// Hysteresis: separate enter/exit thresholds, plus a confirmation count —
// 2 consecutive samples to escalate (~4 min at the 2-min sampler cadence),
// 5 to de-escalate (~10 min). One exception: an oom_kill delta escalates
// to CRITICAL immediately, because a kill is a confirmed event, not a
// noisy gauge; leaving CRITICAL still costs the full 5-sample de-escalation.
//
// Alerts: at most one per kind per cooldown window (default 30 min). A
// state transition is ALWAYS recorded even when its alert is suppressed —
// the ledger stays truthful, only the notification is rate-limited.
//
// Failure posture: FAIL-OPEN. Unreadable /proc, a corrupt state file, an
// unwritable state directory — none of them may block task admission; the
// guard exists to protect the host from MYTHOS, not to become a new way
// for MYTHOS to stop working. Sustained unreadable telemetry (5 samples)
// drops a degraded level back to NORMAL rather than blocking forever.
//
// Nothing here kills a process, changes a cgroup, or touches systemd.
// The only enforcement is "do not START new work" (executor.js).
// =====================================================

var fs = require('fs');
var path = require('path');

var LEVELS = ['NORMAL', 'WARNING', 'CRITICAL'];

// Thresholds derived from the gh-issue-101 replay over ~30h of
// /opt/mythos-memwatch telemetry containing the 2026-09-01 22:16 mass-kill
// episode: CRITICAL is entered 6.7 minutes before the kill and never
// entered across the healthy hours.
var DEFAULTS = {
  meminfo_path: '/proc/meminfo',
  pressure_path: '/proc/pressure/memory',
  vmstat_path: '/proc/vmstat',

  critical_enter_avail_mib: 700,
  critical_enter_psi60: 30,
  critical_exit_avail_mib: 1100,
  critical_exit_psi60: 10,

  warning_enter_avail_mib: 1200,
  warning_enter_psi60: 5,
  warning_exit_avail_mib: 1600,
  warning_exit_psi60: 2,

  escalate_samples: 2,
  deescalate_samples: 5,

  alert_cooldown_ms: 30 * 60 * 1000,
  // How long a persisted sample stays usable for an admission decision
  // before current() takes a fresh one. The daemon samples every tick
  // (15s), so this only matters for out-of-band callers.
  sample_max_age_ms: 60 * 1000,

  history_limit: 50
};

function config(opts) {
  var cfg = {};
  Object.keys(DEFAULTS).forEach(function (k) { cfg[k] = DEFAULTS[k]; });
  // Path overrides exist so the guard can be replayed against fixtures and
  // recorded telemetry. They select WHICH read-only file to parse for
  // numbers; they grant nothing and change no threshold.
  if (process.env.MYTHOS_RESOURCE_GUARD_MEMINFO) cfg.meminfo_path = process.env.MYTHOS_RESOURCE_GUARD_MEMINFO;
  if (process.env.MYTHOS_RESOURCE_GUARD_PRESSURE) cfg.pressure_path = process.env.MYTHOS_RESOURCE_GUARD_PRESSURE;
  if (process.env.MYTHOS_RESOURCE_GUARD_VMSTAT) cfg.vmstat_path = process.env.MYTHOS_RESOURCE_GUARD_VMSTAT;
  Object.keys(opts || {}).forEach(function (k) { cfg[k] = opts[k]; });
  return cfg;
}

function rank(level) {
  var i = LEVELS.indexOf(level);
  return i < 0 ? 0 : i;
}

// --- Signal reading ---------------------------------------------------------

function readFileSafe(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
}

function kbField(text, name) {
  var m = new RegExp('^' + name + ':\\s+(\\d+)\\s*kB', 'm').exec(text);
  return m ? parseInt(m[1], 10) : null;
}

function mib(kb) {
  return kb === null ? null : Math.round(kb / 1024);
}

function parseMeminfo(text) {
  if (typeof text !== 'string') return { mem_available_mib: null, mem_total_mib: null, swap_total_mib: null, swap_used_mib: null, swap_used_pct: null };
  var availKb = kbField(text, 'MemAvailable');
  var totalKb = kbField(text, 'MemTotal');
  var swapTotalKb = kbField(text, 'SwapTotal');
  var swapFreeKb = kbField(text, 'SwapFree');
  var swapUsedKb = (swapTotalKb === null || swapFreeKb === null) ? null : Math.max(0, swapTotalKb - swapFreeKb);
  return {
    mem_available_mib: mib(availKb),
    mem_total_mib: mib(totalKb),
    swap_total_mib: mib(swapTotalKb),
    swap_used_mib: mib(swapUsedKb),
    // Reported only. No threshold in this module reads this field.
    swap_used_pct: (swapUsedKb === null || !swapTotalKb) ? null : Math.round((swapUsedKb / swapTotalKb) * 1000) / 10
  };
}

// "some avg10=0.00 avg60=0.00 avg300=0.00 total=..." — the `some` line
// only: `full` means every task is stalled, which on a healthy host is
// always 0 and would never fire in time.
function parsePressureSome60(text) {
  if (typeof text !== 'string') return null;
  var m = /^some\s+.*?avg60=([0-9.]+)/m.exec(text);
  if (!m) return null;
  var v = parseFloat(m[1]);
  return isNaN(v) ? null : v;
}

function parseOomKill(text) {
  if (typeof text !== 'string') return null;
  var m = /^oom_kill\s+(\d+)/m.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

// Never throws. Every field degrades to null independently, so a kernel
// without PSI still gets MemAvailable-based protection.
function readSignals(opts) {
  var cfg = config(opts);
  var mem = parseMeminfo(readFileSafe(cfg.meminfo_path));
  var sig = {
    at: (opts && opts.now) || Date.now(),
    mem_available_mib: mem.mem_available_mib,
    mem_total_mib: mem.mem_total_mib,
    swap_total_mib: mem.swap_total_mib,
    swap_used_mib: mem.swap_used_mib,
    swap_used_pct: mem.swap_used_pct,
    psi_some_avg60: parsePressureSome60(readFileSafe(cfg.pressure_path)),
    oom_kill: parseOomKill(readFileSafe(cfg.vmstat_path))
  };
  return sig;
}

// A sample can drive the machine only if it carries the primary signal.
// PSI and oom_kill are optional refinements.
function usable(sig) {
  return !!sig && typeof sig.mem_available_mib === 'number' && !isNaN(sig.mem_available_mib);
}

// --- State machine ----------------------------------------------------------

function initialState(now) {
  return {
    version: 1,
    level: 'NORMAL',
    since: new Date(now || Date.now()).toISOString(),
    updated_at: new Date(now || Date.now()).toISOString(),
    pending_level: null,
    pending_count: 0,
    unreadable_streak: 0,
    sample_count: 0,
    last_oom_kill: null,
    last_alert_at: {},
    last_sample: null,
    history: []
  };
}

function normaliseState(raw, now) {
  var st = initialState(now);
  if (!raw || typeof raw !== 'object') return st;
  if (LEVELS.indexOf(raw.level) >= 0) st.level = raw.level;
  if (typeof raw.since === 'string') st.since = raw.since;
  if (LEVELS.indexOf(raw.pending_level) >= 0) st.pending_level = raw.pending_level;
  if (typeof raw.pending_count === 'number' && raw.pending_count >= 0) st.pending_count = raw.pending_count;
  if (typeof raw.unreadable_streak === 'number' && raw.unreadable_streak >= 0) st.unreadable_streak = raw.unreadable_streak;
  if (typeof raw.sample_count === 'number' && raw.sample_count >= 0) st.sample_count = raw.sample_count;
  if (typeof raw.last_oom_kill === 'number') st.last_oom_kill = raw.last_oom_kill;
  if (raw.last_alert_at && typeof raw.last_alert_at === 'object') st.last_alert_at = raw.last_alert_at;
  if (raw.last_sample && typeof raw.last_sample === 'object') st.last_sample = raw.last_sample;
  if (Array.isArray(raw.history)) st.history = raw.history;
  return st;
}

// The level this sample argues for, given where we are now. Hysteresis
// lives here: exit thresholds are only consulted when we are already in
// the level being left.
function rawLevel(sig, current, cfg, killDelta) {
  var avail = sig.mem_available_mib;
  var psi = sig.psi_some_avg60;
  function psiAtLeast(x) { return psi !== null && psi >= x; }
  // A missing PSI reading must not block a recovery: absent evidence of
  // stall counts as "not stalled" for exit tests, exactly as it counts as
  // "no evidence" for enter tests above.
  function psiAtMost(x) { return psi === null || psi <= x; }

  if (killDelta > 0) return 'CRITICAL';
  if (avail <= cfg.critical_enter_avail_mib || psiAtLeast(cfg.critical_enter_psi60)) return 'CRITICAL';
  if (current === 'CRITICAL' &&
      !(avail >= cfg.critical_exit_avail_mib && psiAtMost(cfg.critical_exit_psi60))) return 'CRITICAL';

  if (avail <= cfg.warning_enter_avail_mib || psiAtLeast(cfg.warning_enter_psi60)) return 'WARNING';
  if (current !== 'NORMAL' &&
      !(avail >= cfg.warning_exit_avail_mib && psiAtMost(cfg.warning_exit_psi60))) return 'WARNING';

  return 'NORMAL';
}

function sampleSummary(sig, killDelta) {
  return {
    at: new Date(sig.at).toISOString(),
    mem_available_mib: sig.mem_available_mib,
    psi_some_avg60: sig.psi_some_avg60,
    oom_kill: sig.oom_kill,
    oom_kill_delta: killDelta,
    // Display only — see the header.
    swap_used_mib: sig.swap_used_mib,
    swap_total_mib: sig.swap_total_mib,
    swap_used_pct: sig.swap_used_pct
  };
}

// Pure: (previous state, one sample) → (next state, transition or null).
// No I/O, so the same code drives the live daemon, the tests and the
// historical replay.
function evaluate(prev, sig, opts) {
  var cfg = config(opts);
  var st = normaliseState(prev, sig.at);
  var nowIso = new Date(sig.at).toISOString();
  st.sample_count += 1;
  st.updated_at = nowIso;

  if (!usable(sig)) {
    st.unreadable_streak += 1;
    st.pending_level = null;
    st.pending_count = 0;
    st.last_sample = sampleSummary(sig, 0);
    // Fail-open: telemetry we cannot read must not hold the queue shut.
    if (st.level !== 'NORMAL' && st.unreadable_streak >= cfg.deescalate_samples) {
      return commit(st, st.level, 'NORMAL', 'telemetry_unavailable', null, cfg, nowIso);
    }
    return { state: st, transition: null, alert: null };
  }
  st.unreadable_streak = 0;

  var killDelta = 0;
  if (typeof sig.oom_kill === 'number') {
    if (typeof st.last_oom_kill === 'number') killDelta = Math.max(0, sig.oom_kill - st.last_oom_kill);
    st.last_oom_kill = sig.oom_kill;
  }

  var raw = rawLevel(sig, st.level, cfg, killDelta);
  st.last_sample = sampleSummary(sig, killDelta);

  if (raw === st.level) {
    st.pending_level = null;
    st.pending_count = 0;
    return { state: st, transition: null, alert: null };
  }

  if (st.pending_level === raw) st.pending_count += 1;
  else { st.pending_level = raw; st.pending_count = 1; }

  var needed = killDelta > 0 && raw === 'CRITICAL'
    ? 1
    : (rank(raw) > rank(st.level) ? cfg.escalate_samples : cfg.deescalate_samples);

  if (st.pending_count < needed) return { state: st, transition: null, alert: null };

  var reason = killDelta > 0 && raw === 'CRITICAL' ? 'oom_kill' : (rank(raw) > rank(st.level) ? 'escalation' : 'de-escalation');
  return commit(st, st.level, raw, reason, st.last_sample, cfg, nowIso);
}

// Applies a confirmed level change: records it in history, decides whether
// its alert is inside the per-kind cooldown, and returns the alert to
// deliver (or null when suppressed / not alertable).
function commit(st, from, to, reason, sampleView, cfg, nowIso) {
  st.level = to;
  st.since = nowIso;
  st.pending_level = null;
  st.pending_count = 0;

  // WARNING and CRITICAL alert as themselves; the degraded → NORMAL edge
  // alerts once as RECOVERED. A telemetry-driven drop is a state change,
  // not an all-clear, so it is recorded without an alert.
  var kind = null;
  if (reason !== 'telemetry_unavailable') kind = (to === 'NORMAL') ? 'RECOVERED' : to;

  var alert = null;
  var suppressed = null;
  if (kind) {
    var last = st.last_alert_at[kind] ? Date.parse(st.last_alert_at[kind]) : null;
    if (last !== null && !isNaN(last) && (Date.parse(nowIso) - last) < cfg.alert_cooldown_ms) {
      suppressed = 'cooldown';
    } else {
      st.last_alert_at[kind] = nowIso;
      alert = {
        kind: kind, at: nowIso, from: from, to: to, reason: reason,
        sample: sampleView || st.last_sample
      };
    }
  }

  var transition = {
    at: nowIso, from: from, to: to, reason: reason,
    alert_kind: kind, alert_sent: !!alert, alert_suppressed: suppressed,
    sample: sampleView || st.last_sample
  };
  st.history.push(transition);
  if (st.history.length > cfg.history_limit) st.history = st.history.slice(-cfg.history_limit);

  return { state: st, transition: transition, alert: alert };
}

// --- Persistence ------------------------------------------------------------

function statePath(cfg) {
  return cfg.state_path || null;
}

function readState(cfg) {
  var p = statePath(cfg);
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function writeState(cfg, st) {
  var p = statePath(cfg);
  if (!p) return false;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    var tmp = p + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(st, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, p);
    return true;
  } catch (e) {
    // A guard that cannot persist still guards this process; it must never
    // throw into the scheduler.
    return false;
  }
}

function appendAlert(cfg, alert) {
  if (!cfg.alerts_path || !alert) return false;
  try {
    fs.mkdirSync(path.dirname(cfg.alerts_path), { recursive: true });
    fs.appendFileSync(cfg.alerts_path, JSON.stringify(alert) + '\n', { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (e) { return false; }
}

// One live sample: read → evaluate → persist → hand back the decision.
// Never throws.
function sample(opts) {
  var cfg = config(opts);
  var sig;
  try { sig = readSignals(cfg); }
  catch (e) { sig = { at: (opts && opts.now) || Date.now(), mem_available_mib: null, psi_some_avg60: null, oom_kill: null }; }

  var result;
  try { result = evaluate(readState(cfg), sig, cfg); }
  catch (e) {
    // A corrupt or unexpected state must not stop admission decisions:
    // restart the machine from NORMAL rather than propagate.
    result = { state: initialState(sig.at), transition: null, alert: null };
  }
  writeState(cfg, result.state);
  if (result.alert) appendAlert(cfg, result.alert);

  return {
    level: result.state.level,
    changed: !!result.transition,
    transition: result.transition,
    alert: result.alert,
    signals: result.state.last_sample,
    state: result.state
  };
}

// The admission decision without necessarily re-reading /proc: reuses the
// persisted sample while it is fresh, samples when it is not.
function current(opts) {
  var cfg = config(opts);
  var st = readState(cfg);
  if (st && st.updated_at) {
    var age = Date.now() - Date.parse(st.updated_at);
    if (!isNaN(age) && age >= 0 && age < cfg.sample_max_age_ms) {
      var norm = normaliseState(st, Date.now());
      return { level: norm.level, changed: false, transition: null, alert: null, signals: norm.last_sample, state: norm };
    }
  }
  return sample(cfg);
}

// The one enforcement primitive: may a NEW task start right now?
// WARNING deliberately still admits — it is the "watch it" band; only
// CRITICAL, which is 2 confirmed samples or a real kill, closes the door.
function admission(status) {
  var level = (status && status.level) || 'NORMAL';
  if (level === 'CRITICAL') {
    return {
      admit: false, level: level, reason: 'resource_pressure',
      signals: (status && status.signals) || null
    };
  }
  return { admit: true, level: level, reason: null, signals: (status && status.signals) || null };
}

function describe(status) {
  var s = (status && status.signals) || {};
  return 'level=' + ((status && status.level) || 'UNKNOWN') +
    ' avail=' + (s.mem_available_mib === undefined ? '?' : s.mem_available_mib) + 'M' +
    ' psi60=' + (s.psi_some_avg60 === undefined ? '?' : s.psi_some_avg60) +
    ' oom_kills=' + (s.oom_kill === undefined ? '?' : s.oom_kill) +
    ' swap=' + (s.swap_used_pct === undefined || s.swap_used_pct === null ? '?' : s.swap_used_pct + '%') +
    ' (swap is reported, never a trigger)';
}

// --- Replay -----------------------------------------------------------------

// Drives the SAME evaluate() over a list of recorded samples. Used by
// bin/mythos-resource-guard replay and by the tests, so what is validated
// against history is the production decision function itself.
function replay(samples, opts) {
  var cfg = config(opts);
  var st = null;
  var transitions = [];
  var levels = {};
  (samples || []).forEach(function (sig) {
    var r = evaluate(st, sig, cfg);
    st = r.state;
    levels[st.level] = (levels[st.level] || 0) + 1;
    if (r.transition) transitions.push(r.transition);
  });
  return { transitions: transitions, level_counts: levels, final: st, samples: (samples || []).length };
}

// Parses the /opt/mythos-memwatch/memwatch.log line format:
//   2026-09-01T22:10:01Z avail=758M/7746M swap=4095M/4095M psi60=36.74 oom_kills=984 | ...
// Anything after the first `|` is host-local process/cgroup detail and is
// deliberately ignored.
var MEMWATCH_RE = /^(\S+)\s+avail=(\d+)M\/(\d+)M\s+swap=(\d+)M\/(\d+)M\s+psi60=([0-9.]+)\s+oom_kills=(\d+)/;

function parseMemwatchLine(line) {
  var m = MEMWATCH_RE.exec(String(line || '').trim());
  if (!m) return null;
  var at = Date.parse(m[1]);
  if (isNaN(at)) return null;
  var swapUsed = parseInt(m[4], 10);
  var swapTotal = parseInt(m[5], 10);
  return {
    at: at,
    mem_available_mib: parseInt(m[2], 10),
    mem_total_mib: parseInt(m[3], 10),
    swap_used_mib: swapUsed,
    swap_total_mib: swapTotal,
    swap_used_pct: swapTotal ? Math.round((swapUsed / swapTotal) * 1000) / 10 : null,
    psi_some_avg60: parseFloat(m[6]),
    oom_kill: parseInt(m[7], 10)
  };
}

function parseMemwatchLog(text) {
  return String(text || '').split('\n').map(parseMemwatchLine).filter(Boolean);
}

module.exports = {
  LEVELS: LEVELS,
  DEFAULTS: DEFAULTS,
  config: config,
  readSignals: readSignals,
  parseMeminfo: parseMeminfo,
  parsePressureSome60: parsePressureSome60,
  parseOomKill: parseOomKill,
  initialState: initialState,
  evaluate: evaluate,
  rawLevel: rawLevel,
  sample: sample,
  current: current,
  admission: admission,
  describe: describe,
  replay: replay,
  parseMemwatchLine: parseMemwatchLine,
  parseMemwatchLog: parseMemwatchLog,
  readState: readState
};
