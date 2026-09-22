'use strict';

// =====================================================
// MYTHOS HADDAD — node telemetry contract and state derivation
// projects/status-center/haddad/lib/node-state.js
//
// ONE place decides what a telemetry envelope may contain and what node
// state it implies. The ingest receiver uses it; the tests drive it
// directly; the browser re-derives only the STALENESS half (a frozen file
// must never keep painting a node green — see assets/haddad.js).
//
// Zero dependencies, no I/O, no clock of its own: every function takes
// `now` so the tests are deterministic.
//
// SECURITY: sanitize() is an ALLOW-LIST. A field that is not named here
// never reaches the published document, so a compromised or buggy agent
// cannot publish a secret through this path by adding a key.
// =====================================================

var SCHEMA = 'mythos-node-telemetry/1';
var PUBLISHED_SCHEMA = 'mythos-haddad-node/1';

// Node states, worst first. The UI renders these verbatim.
var STATES = ['OFFLINE', 'DEGRADED', 'BUSY', 'WAITING', 'ONLINE', 'UNKNOWN'];

// Worker states, worst first.
var WORKER_STATES = ['STOPPED', 'DEGRADED', 'BUSY', 'RUNNING', 'READY', 'UNKNOWN'];

// Thresholds. Written here, documented in docs/TELEMETRY.md, and published
// inside the snapshot so the browser applies the SAME numbers.
var DEFAULT_THRESHOLDS = {
  heartbeat_s: 10,        // the agent's beat
  degraded_after_s: 30,   // 3 missed beats — reported, node still answers
  offline_after_s: 45,    // 4.5 missed beats — the node is gone
  max_skew_s: 120,        // reject an envelope whose clock is this far off
  max_body_bytes: 65536,
  max_events: 100,
  // History is DOWNSAMPLED. One row per beat would be ~78 MB a month on a
  // host that has been disk-pressured before, for a resolution nobody
  // reads back. One row a minute, plus every state change unconditionally,
  // keeps the trend and costs ~13 MB. The live file is the live file.
  history_interval_s: 60,
  history_keep_months: 6
};

var NODE_ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
var ID_RE = /^[a-z][a-z0-9_-]{0,63}$/i;
var SEVERITIES = ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'CRITICAL'];

// EVERY control character is stripped from every string, newlines and
// tabs included: a telemetry value ends up in a journal line, a JSONL
// row and a DOM text node. Each of those is single-line by construction,
// and an escape sequence from a node must never reach a terminal.
var CONTROL_RE = /[\x00-\x1f\x7f]/g;

// ── primitives ─────────────────────────────────────────────────────
// Each coercer returns null rather than throwing: a malformed field is
// ABSENT (the UI renders N/A), never a guess and never a crash.
function str(v, max) {
  if (typeof v !== 'string') return null;
  var s = v.replace(CONTROL_RE, '').trim();
  return s ? s.slice(0, max || 200) : null;
}
function num(v) {
  return (typeof v === 'number' && isFinite(v)) ? v : null;
}
function int(v) {
  var n = num(v);
  return n === null ? null : Math.round(n);
}
function bool(v) { return typeof v === 'boolean' ? v : null; }
function iso(v) {
  var s = str(v, 40);
  if (!s) return null;
  var t = Date.parse(s);
  return isFinite(t) ? new Date(t).toISOString() : null;
}
function oneOf(v, list) {
  var s = str(v, 40);
  return s && list.indexOf(s.toUpperCase()) !== -1 ? s.toUpperCase() : null;
}
function arr(v, max, fn) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, max).map(fn).filter(function (x) { return x !== null; });
}
function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }

// ── allow-listed shapes ────────────────────────────────────────────
function pick(source, spec) {
  var src = obj(source);
  var out = {};
  Object.keys(spec).forEach(function (k) { out[k] = spec[k](src[k]); });
  return out;
}

function sanitizeWorker(v) {
  var w = obj(v);
  var id = str(w.id, 40);
  if (!id || !ID_RE.test(id)) return null;
  return {
    id: id,
    name: str(w.name, 60) || id,
    state: oneOf(w.state, WORKER_STATES) || 'UNKNOWN',
    detail: str(w.detail, 200)
  };
}

function sanitizeEvent(v) {
  var e = obj(v);
  var at = iso(e.ts || e.at);
  var event = str(e.event, 80);
  if (!at || !event) return null;
  return {
    ts: at,
    source: str(e.source, 40) || 'node',
    event: event,
    task_id: str(e.task_id, 64),
    severity: oneOf(e.severity, SEVERITIES) || 'INFO',
    detail: str(e.detail, 300)
  };
}

function sanitizeIncident(v) {
  var i = obj(v);
  var at = iso(i.at);
  var kind = str(i.kind, 60);
  if (!at || !kind) return null;
  return {
    id: str(i.id, 64) || (kind + '@' + at),
    at: at,
    kind: kind,
    severity: oneOf(i.severity, SEVERITIES) || 'WARNING',
    // OPEN / RESOLVED only — and only because the agent observed it. The
    // receiver never upgrades an incident to RESOLVED on its own.
    state: oneOf(i.state, ['OPEN', 'RESOLVED']) || 'OPEN',
    detail: str(i.detail, 300)
  };
}

function sanitizeTask(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  var t = obj(v);
  var id = str(t.task_id, 64);
  if (!id) return null;
  return {
    task_id: id,
    issue: int(t.issue),
    project: str(t.project, 80),
    action: str(t.action, 60),
    profile: str(t.profile, 60),
    provider: str(t.provider, 60),
    model: str(t.model, 120),
    attempt: int(t.attempt),
    attempts_max: int(t.attempts_max),
    status: str(t.status, 40),
    effective: str(t.effective, 40),
    activity: function (x) { return oneOf(x, ['EXECUTING', 'PENDING', 'AT_REST', 'TERMINAL', 'UNKNOWN']); }(t.activity),
    started_at: iso(t.started_at),
    elapsed_s: int(t.elapsed_s),
    // A short structured verdict, not the validator's prose.
    validation: str(t.validation, 60),
    review: str(t.review, 60)
    // next_action is deliberately NOT published. It is free text written
    // per task and this document is served without authentication; the
    // owner's field list for the task view does not include it.
  };
}

// The full allow-list. Anything absent from this function cannot be published.
function sanitize(envelope) {
  var e = obj(envelope);
  var rawHealth = obj(e.health);
  var hc = obj(rawHealth.counts);
  var health = pick(rawHealth, {
    schema: function (x) { return str(x, 60); },
    generated_at: iso,
    mode: function (x) { return str(x, 20); },
    status: function (x) { return oneOf(x, ['PASS', 'WARN', 'FAIL']); }
  });
  health.counts = { PASS: int(hc.PASS) || 0, WARN: int(hc.WARN) || 0, FAIL: int(hc.FAIL) || 0 };
  health.failing = arr(rawHealth.failing, 30, function (x) { return str(x, 40); });
  health.warning = arr(rawHealth.warning, 30, function (x) { return str(x, 40); });

  return {
    schema: SCHEMA,
    node: str(e.node, 32),
    sent_at: iso(e.sent_at),
    seq: int(e.seq),
    agent_version: str(e.agent_version, 20),
    node_info: pick(e.node_info, {
      hostname: function (x) { return str(x, 64); },
      os: function (x) { return str(x, 80); },
      kernel: function (x) { return str(x, 60); },
      uptime_s: int,
      boot_at: iso,
      last_restart: iso
    }),
    health: health,
    workers: arr(e.workers, 20, sanitizeWorker),
    runtime: pick(e.runtime, {
      state: function (x) { return oneOf(x, WORKER_STATES) || 'UNKNOWN'; },
      endpoint: function (x) { return str(x, 80); },
      model: function (x) { return str(x, 120); },
      context: int,
      slots_idle: int,
      slots_total: int,
      slots_processing: int,
      gpu_layers: int,
      gpu_layers_total: int,
      vram_model_mib: int,
      vram_projected_mib: int,
      vram_source: function (x) { return str(x, 80); },
      tokens_per_s: num,
      last_ready: iso,
      last_restart: iso
    }),
    gpu: pick(e.gpu, {
      model: function (x) { return str(x, 80); },
      driver: function (x) { return str(x, 80); },
      vram_total_mib: int,
      vram_used_mib: int,
      utilization_pct: num,
      temperature_c: num,
      power_w: num,
      process: function (x) { return str(x, 80); },
      unavailable_reason: function (x) { return str(x, 200); }
    }),
    resources: pick(e.resources, {
      cpus: int, load1: num, load5: num, load15: num,
      mem_used_mib: int, mem_total_mib: int,
      swap_used_mib: int, swap_total_mib: int,
      disk_used_gb: num, disk_total_gb: num, disk_used_pct: num,
      process_count: int,
      psi_cpu_avg10: num, psi_mem_avg10: num, psi_io_avg10: num
    }),
    current_task: sanitizeTask(e.current_task),
    activity_counts: (function () {
      var c = obj(e.activity_counts), out = {};
      ['EXECUTING', 'PENDING', 'AT_REST', 'TERMINAL', 'UNKNOWN'].forEach(function (k) {
        if (c[k] !== undefined) out[k] = int(c[k]) || 0;
      });
      return Object.keys(out).length ? out : null;
    })(),
    task_counts: (function () {
      var c = obj(e.task_counts), out = {};
      Object.keys(c).slice(0, 20).forEach(function (k) {
        if (/^[A-Z_]{2,32}$/.test(k)) out[k] = int(c[k]) || 0;
      });
      return out;
    })(),
    events: arr(e.events, DEFAULT_THRESHOLDS.max_events, sanitizeEvent),
    incidents: arr(e.incidents, 30, sanitizeIncident),
    repo: pick(e.repo, {
      head: function (x) { return str(x, 40); },
      branch: function (x) { return str(x, 80); },
      dirty: bool
    })
  };
}

// ── state derivation ───────────────────────────────────────────────
// Precedence is fixed and total: OFFLINE > DEGRADED > BUSY > WAITING >
// ONLINE, with UNKNOWN reserved for "never reported". Every branch names
// its reason, so the UI never shows a state without saying why.
//
// `snap` is a sanitized envelope plus `received_at`. `now` is epoch ms.
function deriveState(snap, now, thresholds) {
  var th = thresholds || DEFAULT_THRESHOLDS;
  if (!snap || !snap.received_at) {
    return { state: 'UNKNOWN', reason: 'no telemetry has ever been received from this node', age_s: null };
  }
  var parsed = Date.parse(snap.received_at);
  if (!isFinite(parsed)) {
    return { state: 'UNKNOWN', reason: 'the stored receipt timestamp is unreadable', age_s: null };
  }
  var age = Math.max(0, Math.round((now - parsed) / 1000));

  if (age >= th.offline_after_s) {
    return { state: 'OFFLINE', reason: 'no heartbeat for ' + age + 's (threshold ' + th.offline_after_s + 's)', age_s: age };
  }

  // A late-but-arriving beat is a real degradation of the link, not a lie
  // about the node: say so instead of painting it green.
  if (age >= th.degraded_after_s) {
    return { state: 'DEGRADED', reason: 'heartbeat late: ' + age + 's since the last beat (threshold ' + th.degraded_after_s + 's)', age_s: age };
  }

  var health = snap.health || {};
  var counts = health.counts || {};
  if (counts.FAIL > 0) {
    return { state: 'DEGRADED', reason: 'node health reports ' + counts.FAIL + ' failing check(s): ' + (health.failing || []).join(', '), age_s: age };
  }

  var workers = snap.workers || [];
  var stopped = workers.filter(function (w) { return w.state === 'STOPPED'; });
  var degraded = workers.filter(function (w) { return w.state === 'DEGRADED'; });
  if (stopped.length) {
    return { state: 'DEGRADED', reason: 'worker stopped: ' + stopped.map(function (w) { return w.id; }).join(', '), age_s: age };
  }
  if (degraded.length) {
    return { state: 'DEGRADED', reason: 'worker degraded: ' + degraded.map(function (w) { return w.id; }).join(', '), age_s: age };
  }

  // The node classifies its own work against the executor's state machine and
  // a live pid, and that classification WINS. The status-name fallback below
  // is only for an older agent that does not send one: a new executing-like
  // status that is not literally 'RUNNING' would otherwise be read as idle,
  // and the page would say ONLINE while the node was working.
  var task = snap.current_task;
  var ac = snap.activity_counts;

  if (task && task.activity === 'EXECUTING') {
    return { state: 'BUSY', reason: 'executing task ' + task.task_id, age_s: age };
  }
  if (ac) {
    if (ac.EXECUTING > 0) {
      return { state: 'BUSY', reason: ac.EXECUTING + ' task(s) executing', age_s: age };
    }
    if (ac.PENDING > 0) {
      return { state: 'WAITING', reason: ac.PENDING + ' task(s) waiting to run, none executing', age_s: age };
    }
    return { state: 'ONLINE', reason: 'all checks pass, no work in flight', age_s: age };
  }

  // ── fallback: agent older than the activity classification ──
  if (task && (task.effective === 'RUNNING' || task.status === 'RUNNING')) {
    return { state: 'BUSY', reason: 'executing task ' + task.task_id, age_s: age };
  }
  var tc = snap.task_counts || {};
  var waiting = (tc.QUEUED || 0) + (tc.WAITING_FOR_QUOTA || 0) + (tc.WAITING_RETRY || 0);
  if (waiting > 0) {
    return { state: 'WAITING', reason: waiting + ' task(s) queued or waiting, none executing', age_s: age };
  }

  return { state: 'ONLINE', reason: 'all checks pass, no work in flight', age_s: age };
}

// Rank for sorting/summarising a fleet — worst node first.
function rank(state) {
  var i = STATES.indexOf(state);
  return i === -1 ? STATES.length : i;
}

module.exports = {
  SCHEMA: SCHEMA,
  PUBLISHED_SCHEMA: PUBLISHED_SCHEMA,
  STATES: STATES,
  WORKER_STATES: WORKER_STATES,
  SEVERITIES: SEVERITIES,
  DEFAULT_THRESHOLDS: DEFAULT_THRESHOLDS,
  NODE_ID_RE: NODE_ID_RE,
  sanitize: sanitize,
  deriveState: deriveState,
  rank: rank
};
