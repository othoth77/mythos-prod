'use strict';
// =====================================================
// MYTHOS Guardian V0 — decision engine
// ops/guardian/lib/engine.js
//
// One tick:
//   lock -> collect -> classify -> hysteresis -> host level -> guardian
//   health -> incidents -> persist -> report
//
// Design rules carried out of the PR #283 review:
//   * OBSERVE ONLY. This file contains no kill, restart, start, stop,
//     delete or cleanup path, and `remediationPosture()` asserts it.
//   * `run()` NEVER writes when `dry_run` is set; a dry tick returns the
//     same report and drops the would-be state.
//   * Mutual exclusion: a tick that cannot take the lock returns
//     `skipped: 'locked'` instead of racing the timer.
//   * HOST HEALTH and GUARDIAN HEALTH are separate. A missing input
//     degrades Guardian and marks the domain `unknown`; it never becomes a
//     silent NORMAL, and it never invents a host level.
//   * A domain whose inputs are all unknown cannot pull the host level
//     down: the host level is computed over KNOWN domains and reported
//     with `partial: true` when any domain is unknown.
// =====================================================

var path = require('path');
var levels = require('./levels');
var configMod = require('./config');
var sources = require('./sources');
var classify = require('./classify');
var remediateMod = require('./remediate');
var actionsMod = require('./actions');

var DOMAINS = ['memory', 'sessions', 'disk', 'services', 'backup'];
var STATE_VERSION = 1;

// The enablement flags exist so the future path is explicit; V0 must never
// act on them. This is asserted every tick, not documented and hoped for.
function remediationPosture(cfg) {
  var enabled = ['allow_memory_remediation', 'allow_disk_remediation', 'allow_service_restart', 'allow_agent_throttling']
    .filter(function (k) { return cfg[k] === true; });
  var observeOnly = cfg.observe_only === true;
  return {
    observe_only: observeOnly,
    remediation_available: !observeOnly && enabled.length > 0,
    enabled_flags: enabled,
    registered_actions: actionsMod.list().length,
    max_actions_per_tick: cfg.remediation ? cfg.remediation.max_actions_per_tick : null,
    restartable_units: (cfg.services && cfg.services.restartable) || [],
    note: observeOnly
      ? (enabled.length
        ? 'observe_only overrides ' + enabled.join(', ') + ': nothing runs'
        : 'observe-only: Guardian reports and takes no action')
      : 'remediation enabled for ' + enabled.join(', ') + '; every action is still gated individually'
  };
}

function emptyState(nowIso) {
  var st = { version: STATE_VERSION, updated_at: nowIso, tick: 0, host: levels.initial(nowIso), domains: {}, incident: null, memory: {}, services: {}, actions: remediateMod.emptyHistory() };
  DOMAINS.forEach(function (d) { st.domains[d] = levels.initial(nowIso); });
  return st;
}

function loadState(io, file, nowIso) {
  var raw = io.readJson(file);
  var st = emptyState(nowIso);
  if (!raw || typeof raw !== 'object' || raw.version !== STATE_VERSION) return st;
  if (typeof raw.tick === 'number' && raw.tick >= 0) st.tick = raw.tick;
  if (raw.host) st.host = raw.host;
  DOMAINS.forEach(function (d) { if (raw.domains && raw.domains[d]) st.domains[d] = raw.domains[d]; });
  if (raw.incident && typeof raw.incident === 'object') st.incident = raw.incident;
  if (raw.memory && typeof raw.memory === 'object') st.memory = raw.memory;
  if (raw.services && typeof raw.services === 'object') st.services = raw.services;
  if (raw.actions && typeof raw.actions === 'object') st.actions = remediateMod.normaliseHistory(raw.actions);
  return st;
}

// --- collection --------------------------------------------------------
// `collectors` is injectable so tests and `simulate` drive a synthetic host
// without touching the real one.
function collect(cfg, io, ctx, collectors) {
  var c = collectors || sources;
  // A tick has a wall-clock budget. Under severe memory pressure every read
  // on this host slows down — a tick during the 2026-09-16 23:38 event took
  // 76 s against a median of 0.8 s, because the host was stalled on memory
  // 57 % of the time. That is precisely when Guardian must still report.
  //
  // So collection stops at the budget and the domains it did not reach are
  // marked unknown, which already means "excluded from the roll-up, host
  // level partial, Guardian degraded". A late verdict about a thrashing host
  // is worth less than a prompt partial one, and a tick that runs past the
  // unit's TimeoutStartSec is worth nothing at all.
  //
  // DOMAINS order is the priority order: memory first, because it is both the
  // cheapest to read and the most likely to be the reason a tick is slow.
  var budgetMs = typeof ctx.budgetMs === 'number' ? ctx.budgetMs : null;
  var startedAt = io.now();
  function overBudget() { return budgetMs !== null && (io.now() - startedAt) > budgetMs; }

  var procs = null;
  try { procs = sources.scanProcs(io); } catch (e) { procs = null; }
  var sub = { nowMs: ctx.nowMs, procs: procs };
  var out = {};
  DOMAINS.forEach(function (d) {
    if (overBudget()) {
      out[d] = { collector_error: 'tick budget of ' + budgetMs + ' ms exhausted before ' + d + ' could be read' };
      return;
    }
    try { out[d] = c[d](cfg[d], io, sub); }
    catch (e) { out[d] = { collector_error: String((e && e.message) || e) }; }
  });
  out._elapsed_ms = io.now() - startedAt;
  return out;
}

// --- one tick ----------------------------------------------------------
function tick(opts) {
  var io = opts.io;
  var cfg = opts.config;
  var nowMs = opts.now_ms;
  var nowIso = new Date(nowMs).toISOString();
  var prev = opts.state || emptyState(nowIso);
  var ctx = { nowMs: nowMs, nowIso: nowIso, budgetMs: cfg.tick_budget_ms };

  var raws = collect(cfg, io, ctx, opts.collectors);
  var collectMs = raws._elapsed_ms;
  var next = emptyState(nowIso);
  next.tick = prev.tick + 1;
  next.memory = prev.memory || {};
  next.services = prev.services || {};
  next.actions = prev.actions || remediateMod.emptyHistory();

  var verdicts = {}, findings = [], transitions = [], guardianIssues = [];
  var memoryLevel = 'NORMAL';

  // Memory first: the session ceiling depends on the committed memory level.
  DOMAINS.forEach(function (d) {
    var src = raws[d];
    var v;
    if (!src || src.collector_error) {
      v = { raw: 'NORMAL', immediate: false, unknown: true, degraded: true, stateOut: {},
        findings: [{ severity: 'WARNING', kind: 'collector_error', trigger: d + ' collector failed: ' + ((src && src.collector_error) || 'no data'), evidence: null }],
        summary: null };
    } else {
      var domainPrev = d === 'memory' ? (prev.memory || {}) : (d === 'services' ? (prev.services || {}) : {});
      try {
        v = classify[d](src, cfg[d], domainPrev, { nowMs: nowMs, memoryLevel: memoryLevel });
      } catch (e) {
        v = { raw: 'NORMAL', immediate: false, unknown: true, degraded: true, stateOut: {},
          findings: [{ severity: 'WARNING', kind: 'classify_error', trigger: d + ' classification failed: ' + String((e && e.message) || e), evidence: null }],
          summary: null };
      }
    }

    var stepped = levels.step(prev.domains[d], v.raw, {
      now: nowIso, immediate: v.immediate, floor: v.floor,
      escalate_samples: cfg.hysteresis.escalate_samples,
      deescalate_samples: cfg.hysteresis.deescalate_samples,
      recovery_samples: cfg.hysteresis.recovery_samples
    });
    next.domains[d] = stepped.state;
    (stepped.transitions || (stepped.transition ? [stepped.transition] : [])).forEach(function (t) {
      transitions.push(Object.assign({ domain: d }, t));
    });
    if (d === 'memory') memoryLevel = stepped.state.level;
    if (d === 'memory') next.memory = Object.assign({}, next.memory, v.stateOut || {});
    if (d === 'services') next.services = Object.assign({}, next.services, v.stateOut || {});

    verdicts[d] = {
      level: stepped.state.level, raw: v.raw, since: stepped.state.since,
      unknown: !!v.unknown, pending: stepped.state.pending_level ? { level: stepped.state.pending_level, count: stepped.state.pending_count } : null,
      summary: v.summary
    };
    (v.findings || []).forEach(function (f) { findings.push(Object.assign({ domain: d }, f)); });
    if (v.degraded || v.unknown) {
      guardianIssues.push(d + ': ' + (v.unknown ? 'signal unavailable' : 'signal degraded'));
    }
  });

  // --- host level: maximum over KNOWN domains --------------------------
  var known = DOMAINS.filter(function (d) { return !verdicts[d].unknown; });
  var hostRaw = levels.maxOf(known.map(function (d) { return verdicts[d].level; }));
  var partial = known.length < DOMAINS.length;
  // Domain hysteresis has already run; the host roll-up commits directly so
  // a confirmed domain escalation is not delayed a second time.
  var hostPrev = prev.host && levels.isLevel(prev.host.level) ? prev.host.level : 'NORMAL';
  next.host = { level: hostRaw, since: hostRaw === hostPrev && prev.host && prev.host.since ? prev.host.since : nowIso, pending_level: null, pending_count: 0 };
  if (hostRaw !== hostPrev) transitions.push({ domain: 'host', at: nowIso, from: hostPrev, to: hostRaw, reason: 'roll-up' });

  // --- Guardian health (separate from host health) ---------------------
  if (typeof collectMs === 'number' && cfg.tick_slow_ms && collectMs > cfg.tick_slow_ms) {
    findings.push({
      domain: 'guardian', severity: 'INFO', kind: 'slow_tick',
      trigger: 'collection took ' + collectMs + ' ms (usual is under ' + cfg.tick_slow_ms + ' ms) — normally a symptom of the host being slow, not of Guardian',
      evidence: { collect_ms: collectMs }
    });
  }

  var cfgErrors = opts.config_errors || [];
  var guardian = {
    state: 'OK', issues: guardianIssues.slice(), observed_domains: known.length, total_domains: DOMAINS.length,
    config_source: opts.config_source || 'defaults', config_errors: cfgErrors,
    remediation: remediationPosture(cfg)
  };
  if (cfgErrors.length) guardian.issues.push('configuration: ' + cfgErrors.join('; '));
  if (guardian.issues.length) guardian.state = known.length === 0 ? 'BLIND' : 'DEGRADED';

  // --- incidents --------------------------------------------------------
  var incidentEvents = [];
  var openIncident = prev.incident && prev.incident.state === 'OPEN' ? prev.incident : null;
  var incidentThreshold = levels.rank('WARNING');
  if (levels.rank(hostRaw) >= incidentThreshold) {
    if (!openIncident) {
      openIncident = {
        id: 'GRD-' + nowIso.replace(/[-:]/g, '').replace(/\..*/, 'Z'),
        state: 'OPEN', opened_at: nowIso, peak_level: hostRaw, level: hostRaw,
        domains: known.filter(function (d) { return levels.rank(verdicts[d].level) >= incidentThreshold; }),
        ticks: 1
      };
      incidentEvents.push({ type: 'incident_opened', incident: openIncident.id, level: hostRaw, at: nowIso });
    } else {
      openIncident.ticks += 1;
      openIncident.level = hostRaw;
      if (levels.rank(hostRaw) > levels.rank(openIncident.peak_level)) {
        openIncident.peak_level = hostRaw;
        incidentEvents.push({ type: 'incident_escalated', incident: openIncident.id, level: hostRaw, at: nowIso });
      }
      known.forEach(function (d) {
        if (levels.rank(verdicts[d].level) >= incidentThreshold && openIncident.domains.indexOf(d) < 0) openIncident.domains.push(d);
      });
    }
    next.incident = openIncident;
  } else if (openIncident) {
    openIncident.state = 'CLOSED';
    openIncident.closed_at = nowIso;
    incidentEvents.push({ type: 'incident_closed', incident: openIncident.id, peak_level: openIncident.peak_level, at: nowIso, duration_seconds: Math.round((nowMs - Date.parse(openIncident.opened_at)) / 1000) });
    next.incident = null;
  } else {
    next.incident = null;
  }

  // --- remediation ------------------------------------------------------
  // The plan is ALWAYS computed, even in observe-only, because "what would
  // Guardian do about this, and why not" is exactly what an operator wants
  // to read during an incident. Execution is a separate, opt-in step.
  var remediation = { plan: null, results: [], history: prev.actions || remediateMod.emptyHistory() };
  try {
    var thePlan = remediateMod.plan(
      { domains: verdicts, host: { level: hostRaw } },
      cfg, io,
      { now_ms: nowMs, history: remediation.history, measure: opts.measure, docker: (raws.disk && raws.disk.docker && raws.disk.docker.ok) ? {
        build_cache_reclaimable_gb: parseReclaimGb(raws.disk.docker.data)
      } : null }
    );
    var dry = !!opts.dry_run || cfg.observe_only === true || opts.execute_actions !== true;
    var results = remediateMod.execute(thePlan, cfg, io, { dry_run: dry });
    remediation.plan = {
      at: thePlan.at, observe_only: thePlan.observe_only,
      decisions: thePlan.decisions.map(function (d) {
        return { action: d.action, target: d.target, title: d.title, domain: d.domain,
          allowed: d.allowed, gate: d.gate, reason: d.reason, argv: d.argv, kind: d.kind };
      })
    };
    remediation.results = results;
    remediation.history = dry ? remediation.history : remediateMod.recordRuns(remediation.history, results, nowMs);
    results.forEach(function (r) {
      if (r.mode !== 'executed') return;
      findings.push({
        domain: 'guardian', severity: r.result === 'failed' ? 'WARNING' : 'INFO', kind: 'action_' + r.result,
        trigger: r.action + (r.target ? ' on ' + r.target : '') + ': ' + (r.verification || r.error || r.result),
        evidence: { argv: r.argv, verified: r.verified }
      });
    });
  } catch (e) {
    findings.push({ domain: 'guardian', severity: 'WARNING', kind: 'remediation_error',
      trigger: 'remediation planning failed: ' + String((e && e.message) || e), evidence: null });
  }
  next.actions = remediation.history;

  next.updated_at = nowIso;

  var report = {
    schema_version: '1.0.0',
    generated_at: nowIso,
    tick: next.tick,
    guardian_version: opts.guardian_version || null,
    mode: opts.dry_run ? 'dry-run' : 'observe',
    host: { level: hostRaw, since: next.host.since, partial: partial, unknown_domains: DOMAINS.filter(function (d) { return verdicts[d].unknown; }) },
    guardian: guardian,
    collect_ms: collectMs === undefined ? null : collectMs,
    domains: verdicts,
    findings: findings.sort(function (a, b) { return levels.rank(b.severity) - levels.rank(a.severity); }),
    transitions: transitions,
    incident: next.incident,
    incident_events: incidentEvents,
    remediation: remediation.plan,
    actions: remediation.results
  };

  return { report: report, state: next, transitions: transitions, incident_events: incidentEvents };
}

// --- persistence + locking (the only writes, all under stateDir) -------
// "3.496GB (67%)" -> 3.496
function parseReclaimGb(rows) {
  var row = rows && rows['Build Cache'];
  if (!row || !row.reclaimable) return null;
  var m = /^([0-9.]+)\s*([KMGT]?B)/i.exec(String(row.reclaimable).trim());
  if (!m) return null;
  var v = parseFloat(m[1]);
  var unit = m[2].toUpperCase();
  if (unit === 'TB') return v * 1024;
  if (unit === 'GB') return v;
  if (unit === 'MB') return v / 1024;
  if (unit === 'KB') return v / (1024 * 1024);
  return v / (1024 * 1024 * 1024);
}

function paths(stateDir) {
  return {
    state: path.join(stateDir, 'state.json'),
    report: path.join(stateDir, 'report.json'),
    lock: path.join(stateDir, 'guardian.lock'),
    incidents: path.join(stateDir, 'incidents.jsonl'),
    ticks: path.join(stateDir, 'ticks.jsonl'),
    actions: path.join(stateDir, 'actions.jsonl')
  };
}

// Rotation keeps `cfg.keep` generations: file.2 -> file.3, file.1 -> file.2,
// file -> file.1. The oldest generation is dropped by being renamed over,
// because Guardian has no delete primitive at all and is not getting one for
// log rotation. Guardian's own history is therefore bounded by
// (keep + 1) * max_bytes and never by a deletion.
function rotate(io, file, cfg) {
  var st = io.lstat(file);
  if (!st || st.size < cfg.max_bytes) return false;
  var keep = typeof cfg.keep === 'number' && cfg.keep > 0 ? cfg.keep : 1;
  for (var i = keep - 1; i >= 1; i--) {
    if (io.exists(file + '.' + i)) io.renameState(file + '.' + i, file + '.' + (i + 1));
  }
  return io.renameState(file, file + '.1');
}

function run(opts) {
  var io = opts.io;
  var stateDir = opts.state_dir;
  io.stateDir = stateDir;
  var p = paths(stateDir);
  var nowMs = opts.now_ms || io.now();
  var nowIso = new Date(nowMs).toISOString();
  var dry = !!opts.dry_run;

  var loaded = opts.config
    ? { config: opts.config, errors: opts.config_errors || [], source: opts.config_source || 'injected' }
    : configMod.load(io, opts.config_path);

  // A dry run must not even take the lock: it changes nothing, so it can
  // never conflict with the timer.
  var lock = null;
  if (!dry) {
    io.mkdirState(stateDir, 0o755);
    lock = io.lock(p.lock);
    if (!lock || !lock.acquired) {
      return { skipped: 'locked', held_by: lock && lock.held_by ? lock.held_by : null, at: nowIso };
    }
  }

  try {
    var state = opts.state || loadState(io, p.state, nowIso);
    var out = tick({
      io: io, config: loaded.config, config_errors: loaded.errors, config_source: loaded.source,
      state: state, now_ms: nowMs, dry_run: dry, collectors: opts.collectors,
      execute_actions: opts.execute_actions, measure: opts.measure,
      guardian_version: opts.guardian_version
    });

    if (dry) return { dry_run: true, report: out.report, state: out.state, written: false };

    var wrote = { state: false, report: false, incidents: true, ticks: true };
    wrote.state = io.writeStateAtomic(p.state, JSON.stringify(out.state, null, 2) + '\n', 0o644);
    wrote.report = io.writeStateAtomic(p.report, JSON.stringify(out.report, null, 2) + '\n', 0o644);
    if (out.incident_events.length) {
      rotate(io, p.incidents, loaded.config.incidents);
      wrote.incidents = io.appendState(p.incidents, out.incident_events.map(function (e) { return JSON.stringify(e); }).join('\n') + '\n', 0o644);
    }
    if (out.report.actions && out.report.actions.length) {
      rotate(io, p.actions, loaded.config.incidents);
      wrote.actions = io.appendState(p.actions, out.report.actions.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n', 0o644);
    }
    rotate(io, p.ticks, loaded.config.incidents);
    wrote.ticks = io.appendState(p.ticks, JSON.stringify({
      at: out.report.generated_at, tick: out.report.tick, host: out.report.host.level, partial: out.report.host.partial,
      guardian: out.report.guardian.state,
      domains: DOMAINS.reduce(function (a, d) { a[d] = out.report.domains[d].level + (out.report.domains[d].unknown ? '?' : ''); return a; }, {}),
      findings: out.report.findings.length, transitions: out.transitions.length
    }) + '\n', 0o644);

    return { report: out.report, state: out.state, written: wrote };
  } finally {
    if (lock) io.unlock(lock);
  }
}

module.exports = {
  DOMAINS: DOMAINS, STATE_VERSION: STATE_VERSION,
  run: run, tick: tick, collect: collect, paths: paths, parseReclaimGb: parseReclaimGb,
  emptyState: emptyState, loadState: loadState, remediationPosture: remediationPosture
};
