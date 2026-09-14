'use strict';
// =====================================================
// MYTHOS Guardian — decision engine
// ops/guardian/lib/guardian.js
//
// One tick:
//   1. load + validate config (invalid ⇒ observe-only, config_error)
//   2. one /proc scan, then collect → classify per domain
//   3. hysteresis per domain (levels.step); overall = max(confirmed)
//   4. plan actions from CONFIRMED levels
//   5. gate every action: dry-run → kill switch → config error → marker
//      → cooldown → per-tick cap; only then execute, re-verified
//   6. incidents for transitions and actions; state; public status;
//      the session guard's pressure file
//
// Failure posture. A domain that throws keeps its previous confirmed level
// and plans nothing. A reporting write that fails is recorded in the result
// and never stops protection. Nothing in a failure path performs an action:
// every destructive path requires explicit evidence AND an operator marker.
// =====================================================

var path = require('path');
var os = require('os');
var levels = require('./levels');
var configMod = require('./config');
var report = require('./report');
var procs = require('./procs');
var DOMAINS = {
  memory: require('./memory'),
  disk: require('./disk'),
  services: require('./services'),
  backup: require('./backup'),
  sessions: require('./sessions')
};
var ORDER = ['memory', 'disk', 'services', 'backup', 'sessions'];

var MARKERS = ['disk-cleanup', 'docker-cleanup', 'disk-emergency', 'service-recovery'];

var NEXT_ACTION = {
  memory: 'read /opt/mythos-memwatch/memwatch.log and the session guard ledger; close idle agent sessions',
  disk: 'identify the growth source (docs/guardian/RUNBOOK.md §disk) before any manual removal',
  services: 'journalctl for the affected unit; fix the cause before resetting a DEGRADED unit',
  backup: 'journalctl -u mythos-backup*; run the verify unit by hand once the cause is fixed',
  sessions: 'review sessions in the Desktop app; the session guard reclaims idle ones when enforcing'
};

function readState(io, cfg) {
  var st = io.readJson(path.join(cfg.state_dir, 'state.json'));
  if (!st || st.version !== 1) st = { version: 1, domains: {}, overall: levels.initial(null), action_last_run: {}, observed_plans: {} };
  st.domains = st.domains || {};
  st.action_last_run = st.action_last_run || {};
  st.observed_plans = st.observed_plans || {};
  return st;
}

function markerState(io, cfg, env) {
  var enabled = {};
  MARKERS.forEach(function (m) { enabled[m] = io.exists(path.join(cfg.markers_dir, m)); });
  var killSwitch = String((env || {}).MYTHOS_GUARDIAN || '').toLowerCase() === 'off' || io.exists(path.join(cfg.markers_dir, 'disabled'));
  return { enabled: enabled, kill_switch: killSwitch };
}

function productionImpact(domain, findings, cfg) {
  if (domain !== 'services') return 'none observed';
  var cls = {};
  (cfg.services.entries || []).forEach(function (e) { cls[e.id] = e.class; });
  var hit = findings.filter(function (f) { return f.affected && cls[f.affected] && cls[f.affected] !== 'support'; }).map(function (f) { return f.affected; });
  return hit.length ? 'production/critical affected: ' + hit.join(', ') : 'support services only';
}

// ---------------------------------------------------------------------------

function evaluateDomains(cfg, io, state, ctx, sim) {
  var out = {};
  var memoryLevel = null;
  ORDER.forEach(function (name) {
    var mod = DOMAINS[name];
    var prev = state.domains[name] || {};
    var dctx = Object.assign({}, ctx, { memoryLevel: memoryLevel });
    var res;
    try {
      var measured = mod.collect(cfg[name], io, dctx);
      if (sim && sim.mutate && sim.mutate[name]) sim.mutate[name](measured, sim.tick);
      res = mod.classify(measured, cfg[name], prev.private || {}, dctx);
    } catch (e) {
      res = { raw: prev.level || 'NORMAL', immediate: false, plan: [], stateOut: prev.private || {}, summary: null,
        findings: [{ severity: 'WARNING', kind: 'domain_error', trigger: name + ' evaluation failed: ' + String(e && e.message).slice(0, 200) }], error: true };
    }
    var stepped = levels.step(prev, res.raw, {
      immediate: res.immediate, now: new Date(ctx.nowMs).toISOString(),
      escalate_samples: cfg.hysteresis.escalate_samples, deescalate_samples: cfg.hysteresis.deescalate_samples, recovery_samples: cfg.hysteresis.recovery_samples
    });
    if (res.error) stepped = { state: levels.step(prev, prev.level || 'NORMAL', {}).state, transition: null };
    out[name] = { res: res, stepped: stepped };
    if (name === 'memory') memoryLevel = stepped.state.level;
  });
  return out;
}

function gate(item, ctx) {
  var nowMs = ctx.nowMs;
  if (ctx.dryRun) return 'dry_run';
  if (ctx.markers.kill_switch) return 'disabled_kill_switch';
  if (ctx.configErrors.length) return 'refused_config_error';
  if (!ctx.markers.enabled[item.marker]) return 'observe_only_marker_absent';
  var last = ctx.state.action_last_run[item.id];
  if (last && nowMs - last < item.cooldown_minutes * 60000) return 'skipped_cooldown';
  if (ctx.executed >= ctx.cfg.max_actions_per_tick) return 'deferred_tick_cap';
  return 'execute';
}

function execute(item, io, ctx) {
  if (item.kind === 'restart-unit') return DOMAINS.services.restartUnit(io, item);
  if (item.kind === 'command') {
    var before = DOMAINS.disk.collect(ctx.cfg.disk, io);
    if (item.target_id === 'journal-vacuum') item.evidence = DOMAINS.memory.captureOomEvidence(io, 200);
    var r = io.spawn(item.argv, { timeout_ms: 180000 });
    var after = DOMAINS.disk.collect(ctx.cfg.disk, io);
    return { ok: r.status === 0, detail: { exit: r.status, stdout_tail: (r.stdout || '').slice(-400), free_gb_before: before.free_gb, free_gb_after: after.free_gb } };
  }
  if (item.kind === 'remove-paths') {
    var env = DOMAINS.disk.verificationEnv(io, procs.scan(io), ctx.nowMs);     // fresh evidence right before removal
    var target = DOMAINS.disk.TARGETS[item.target_id];
    var results = item.removable.map(function (v) {
      var again = DOMAINS.disk.verifyPath(io, target, v.path, env);
      if (!again.ok) return { path: v.path, removed: false, reason: 'failed re-verification', checks: again.checks.filter(function (c) { return !c.ok; }) };
      var rm = io.remove(v.path);
      return { path: v.path, removed: rm.ok && !io.exists(v.path), size_bytes: again.size_bytes, error: rm.error || null };
    });
    return { ok: results.every(function (x) { return x.removed; }), detail: results };
  }
  return { ok: false, detail: 'unknown action kind' };
}

function stripForReport(item) {
  var o = {};
  Object.keys(item).forEach(function (k) { if (typeof item[k] !== 'function') o[k] = item[k]; });
  if (o.paths) {
    o.paths = o.paths.map(function (v) { return { path: v.path, ok: v.ok, size_bytes: v.size_bytes, failed_checks: v.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.step + (c.detail ? ': ' + c.detail : ''); }) }; });
    delete o.removable;
    delete o.protected;
  }
  return o;
}

function tick(opts) {
  var io = opts.io;
  var nowMs = opts.nowMs || io.now();
  var loaded = opts.loaded || configMod.load(io, opts.overridePath);
  var cfg = loaded.config;
  if (opts.stateDir) { cfg.state_dir = opts.stateDir; cfg.public_dir = path.join(opts.stateDir, 'public'); cfg.markers_dir = path.join(opts.stateDir, 'enable'); }
  var state = opts.state || readState(io, cfg);
  var markers = markerState(io, cfg, opts.env || process.env);
  var procList = procs.scan(io);
  var ctx = { nowMs: nowMs, procs: procList };
  var t0 = Date.now();

  var evals = evaluateDomains(cfg, io, state, ctx, opts.sim);

  var domainLevels = {};
  var newState = { version: 1, updated_at: new Date(nowMs).toISOString(), domains: {}, overall: state.overall, action_last_run: state.action_last_run, observed_plans: state.observed_plans, last_incident: state.last_incident || null };
  ORDER.forEach(function (n) {
    var s = evals[n].stepped.state;
    newState.domains[n] = Object.assign({}, s, { private: evals[n].res.stateOut });
    domainLevels[n] = s.level;
  });
  var overall = levels.maxOf(ORDER.map(function (n) { return domainLevels[n]; }));
  var prevOverall = (state.overall && state.overall.level) || 'NORMAL';
  newState.overall = { level: overall, since: overall === prevOverall ? (state.overall && state.overall.since) || newState.updated_at : newState.updated_at };

  // --- plan ----------------------------------------------------------------
  var plan = [];
  ORDER.forEach(function (n) { (evals[n].res.plan || []).forEach(function (p) { plan.push(p); }); });
  if (levels.rank(domainLevels.disk) >= levels.rank('HIGH') && !evals.disk.res.error) {
    try {
      var env = DOMAINS.disk.verificationEnv(io, procList, nowMs);
      DOMAINS.disk.planCleanup(io, cfg.disk, domainLevels.disk, {}, env).forEach(function (p) { plan.push(p); });
    } catch (e) {
      evals.disk.res.findings.push({ severity: 'WARNING', kind: 'cleanup_plan_error', trigger: String(e.message).slice(0, 200) });
    }
  }

  // --- gate + execute ------------------------------------------------------
  var gctx = { nowMs: nowMs, dryRun: !!opts.dryRun, markers: markers, configErrors: loaded.errors, state: newState, cfg: cfg, executed: 0 };
  var actions = plan.map(function (item) {
    if (item.kind === 'remove-paths' && !item.removable.length) return { item: stripForReport(item), decision: 'nothing_verifiably_removable' };
    var decision = gate(item, gctx);
    var entry = { item: stripForReport(item), decision: decision };
    if (decision === 'execute') {
      gctx.executed += 1;
      newState.action_last_run[item.id] = nowMs;
      try { entry.result = execute(item, io, gctx); } catch (e) { entry.result = { ok: false, detail: 'execution threw: ' + String(e.message).slice(0, 200) }; }
      if (item.evidence) entry.evidence = item.evidence;
      if (item.domain === 'services') {
        var rec = newState.domains.services.private.recovery;
        rec[item.id.slice('service:'.length)] = (rec[item.id.slice('service:'.length)] || []).concat([nowMs]);
      }
    }
    return entry;
  });

  // --- incidents -----------------------------------------------------------
  var incidents = [];
  var enforcing = MARKERS.filter(function (mk) { return markers.enabled[mk]; });
  var mode = opts.dryRun ? 'dry-run' : (markers.kill_switch ? 'disabled' : (loaded.errors.length ? 'observe (config error)' : (enforcing.length ? 'enforcing: ' + enforcing.join(',') : 'observe')));
  ORDER.forEach(function (n) {
    var tr = evals[n].stepped.transition;
    if (!tr) return;
    var domActions = actions.filter(function (a) { return a.item.domain === n; });
    var evidence = evals[n].res.summary;
    if (n === 'memory' && !opts.dryRun && evals[n].res.findings.some(function (f) { return f.kind === 'oom_kill'; })) {
      evidence = { summary: evidence, kernel: DOMAINS.memory.captureOomEvidence(io, 200) };
    }
    incidents.push(report.createIncident({
      severity: levels.rank(tr.to) >= levels.rank('WARNING') ? tr.to : 'INFO',
      domain: n,
      trigger: evals[n].res.findings.map(function (f) { return f.trigger; }).join(' | ') || (n + ' ' + tr.from + ' → ' + tr.to),
      evidence: evidence,
      affected: evals[n].res.findings.map(function (f) { return f.affected; }).filter(Boolean),
      action: domActions.length ? domActions.map(function (a) { return a.item.id + ':' + a.decision; }) : 'none',
      before: tr.from, after: tr.to, result: 'level ' + tr.reason,
      production_impact: productionImpact(n, evals[n].res.findings, cfg),
      remaining_risk: levels.rank(tr.to) >= levels.rank('WARNING') ? n + ' remains ' + tr.to + ' until evidence clears (hysteresis)' : 'none beyond normal operation',
      next_action: levels.rank(tr.to) >= levels.rank('WARNING') ? NEXT_ACTION[n] : 'none', mode: mode
    }, nowMs));
  });
  actions.forEach(function (a) {
    var id = a.item.id;
    var executed = a.decision === 'execute';
    if (!executed) {
      if (a.decision === 'dry_run' || a.decision === 'skipped_cooldown') return;
      var lastObs = newState.observed_plans[id];
      if (lastObs && nowMs - lastObs < (a.item.cooldown_minutes || 60) * 60000) return;
      newState.observed_plans[id] = nowMs;
    }
    incidents.push(report.createIncident({
      severity: domainLevels[a.item.domain], domain: a.item.domain,
      trigger: a.item.reason, evidence: a.evidence || a.item.paths || a.item.argv || { unit: a.item.unit, attempt: a.item.attempt },
      affected: a.item.unit || a.item.target_id, action: id + ' (' + a.decision + ')',
      before: executed ? 'planned' : 'planned, not executed',
      after: executed ? (a.result && a.result.ok ? 'done' : 'failed') : a.decision,
      result: executed ? a.result : 'not executed: ' + a.decision,
      production_impact: a.item.domain === 'services' ? 'restart of ' + a.item.unit : 'none (allowlisted disposable data only)',
      remaining_risk: executed && !(a.result && a.result.ok) ? 'action failed — manual follow-up needed' : 'see domain level',
      next_action: executed ? 'verify the ' + a.item.domain + ' domain on the next tick' : ('touch ' + path.join(cfg.markers_dir, a.item.marker) + ' to allow this action class'), mode: mode
    }, nowMs));
  });
  if (loaded.errors.length && !state.config_error_reported) {
    incidents.push(report.createIncident({ severity: 'WARNING', domain: 'guardian', trigger: 'configuration error', evidence: loaded.errors, action: 'all active remediation refused; observing with built-in defaults', result: 'observe-only', next_action: 'fix ' + (opts.overridePath || 'the override') + ' then check `mythos-guardian validate`', mode: mode }, nowMs));
  }
  newState.config_error_reported = loaded.errors.length > 0;

  // --- persist / publish -----------------------------------------------------
  var reportErrors = [];
  var sessionsNow = evals.sessions.res.summary ? evals.sessions.res.summary.remote_sessions : null;
  var status = {
    schema: 'mythos-guardian/status@1',
    generated_at: new Date(nowMs).toISOString(),
    host: os.hostname(),
    mode: mode,
    markers: markers.enabled,
    kill_switch: markers.kill_switch,
    config_source: loaded.source,
    config_errors: loaded.errors,
    level: overall,
    since: newState.overall.since,
    domains: {},
    admission: DOMAINS.sessions.admission(overall, cfg.sessions, sessionsNow),
    actions: actions.map(function (a) { return { id: a.item.id, decision: a.decision, ok: a.result ? a.result.ok : null }; }),
    last_incident: null,
    tick_ms: Date.now() - t0
  };
  ORDER.forEach(function (n) {
    status.domains[n] = { level: domainLevels[n], raw: evals[n].res.raw, since: newState.domains[n].since, findings: evals[n].res.findings.map(function (f) { return { severity: f.severity, kind: f.kind, trigger: f.trigger, degraded: !!f.degraded }; }), summary: evals[n].res.summary };
  });
  if (incidents.length) newState.last_incident = { id: incidents[incidents.length - 1].id, time: incidents[incidents.length - 1].time, severity: incidents[incidents.length - 1].severity, trigger: incidents[incidents.length - 1].trigger };
  status.last_incident = newState.last_incident;

  if (!opts.dryRun) {
    io.mkdir(cfg.state_dir, 0o700);
    var ap = report.appendIncidents(io, cfg.state_dir, incidents, cfg.incidents);
    if (!ap.ok) reportErrors.push('incident ledger append failed');
    if (!io.writeFileAtomic(path.join(cfg.state_dir, 'state.json'), JSON.stringify(newState) + '\n', 0o600)) reportErrors.push('state write failed');
    if (!report.writePublicStatus(io, cfg.public_dir, Object.assign({}, status, { report_errors: reportErrors }))) reportErrors.push('public status write failed');
    var rgLevel = evals.memory.res.summary ? evals.memory.res.summary.resource_guard_level : null;
    if (rgLevel && !report.writePressureFile(io, cfg.public_dir, rgLevel, nowMs)) reportErrors.push('pressure file write failed');
  }
  status.report_errors = reportErrors;

  return { status: status, actions: actions, incidents: incidents, state: newState, transitions: ORDER.map(function (n) { return evals[n].stepped.transition && Object.assign({ domain: n }, evals[n].stepped.transition); }).filter(Boolean) };
}

// ---------------------------------------------------------------------------
// Simulations: synthetic evidence overlaid on REAL host collection, run for
// enough ticks to pass hysteresis, always dry-run, state kept in memory.

function setEntry(m, id, obs) { m.entries[id] = Object.assign({ observed: true }, obs); }

var SCENARIOS = {
  'normal': { note: 'real host evidence, no overlay', mutate: {} },
  'high-memory': { note: 'MemAvailable 650 MiB, PSI 12', mutate: { memory: function (m) { m.mem_available_mib = 650; m.psi_some_avg60 = 12; } } },
  'memory-emergency': { note: 'MemAvailable 350 MiB, PSI 40', mutate: { memory: function (m) { m.mem_available_mib = 350; m.psi_some_avg60 = 40; } } },
  'oom-kill': { note: 'oom_kill counter increases by 3', mutate: { memory: function (m, t) { if (typeof m.oom_kill === 'number') m.oom_kill += 3 * t; } } },
  'high-swap': { note: 'swap 99 % with plenty of MemAvailable (the chronic healthy state — must stay NORMAL)', mutate: { memory: function (m) { m.swap_used_pct = 99; m.mem_available_mib = Math.max(m.mem_available_mib || 0, 3000); m.psi_some_avg60 = 0.5; } } },
  'swap-exhaustion': { note: 'swap 99 % AND MemAvailable 1150 MiB', mutate: { memory: function (m) { m.swap_used_pct = 99; m.mem_available_mib = 1150; m.psi_some_avg60 = 1; } } },
  'disk-warning': { note: 'filesystem 82 %', mutate: { disk: function (m) { m.used_pct = 82; } } },
  'disk-high': { note: 'filesystem 86 %', mutate: { disk: function (m) { m.used_pct = 86; } } },
  'disk-critical': { note: 'filesystem 91 %', mutate: { disk: function (m) { m.used_pct = 91; } } },
  'disk-emergency': { note: 'filesystem 96 %', mutate: { disk: function (m) { m.used_pct = 96; } } },
  'failed-service': { note: 'mythos-command-center failed (restart-safe production unit)', mutate: { services: function (m) { setEntry(m, 'command-center', { active: 'failed', sub: 'failed', result: 'exit-code', n_restarts: 5 }); } } },
  'restart-loop': { note: 'mythos-wp restarting 3× per tick', mutate: { services: function (m, t) { setEntry(m, 'mythos-wp', { active: 'activating', sub: 'auto-restart', result: 'exit-code', n_restarts: 400 + 3 * t }); } } },
  'erp-down': { note: 'ERP health endpoint failing (report-only, never restarted)', mutate: { services: function (m) { setEntry(m, 'erp-health', { http_status: 502, ok: false, error: 'HTTP 502' }); } } },
  'agent-concurrency': { note: '11 agent sessions holding 2.6 GiB', mutate: { sessions: function (m) { m.remote_sessions = 11; m.remote_rss_mib = 2650; } } },
  'orphans': { note: '7 orphaned node/chrome processes under login sessions', mutate: { sessions: function (m) { m.orphan_count = 7; m.orphans = [{ pid: 999001, comm: 'node', uid: 0, rss_mib: 80, age_seconds: 7200 }, { pid: 999002, comm: 'chrome', uid: 0, rss_mib: 150, age_seconds: 7200 }]; } } },
  'backup-failed': { note: 'mythos_erp backup: last success 60 h ago, last run failed', mutate: { backup: function (m, t, nowMs) { m.records['mythos-erp'] = { status: 'failed', last_success_at: new Date(Date.now() - 60 * 3600000).toISOString(), consecutive_failures: 3 }; } } },
  'restore-test-failed': { note: 'mythos_erp restore test failed', mutate: { backup: function (m) { m.restore['restore-mythos-erp'] = { result: 'exit-code', exec_status: '1', exit_at_ms: Date.now() - 86400000 }; } } },
  'status-center-down': { note: 'public status file unwritable (Status Center pull side broken): protection must continue', io: function (io) { var w = io.writeFileAtomic; return Object.assign({}, io, { writeFileAtomic: function (p, d, m) { return p.indexOf('/public/') >= 0 ? false : w(p, d, m); } }); }, mutate: {} },
  'beszel-down': { note: 'Beszel unavailable: Guardian has no Beszel dependency, the tick is identical to normal', mutate: {} }
};

function simulate(opts, name) {
  var sc = SCENARIOS[name];
  if (!sc) throw new Error('unknown scenario: ' + name);
  var io = sc.io ? sc.io(opts.io) : opts.io;
  var loaded = configMod.load(opts.io, opts.overridePath);
  var ticks = Math.max(loaded.config.hysteresis.escalate_samples, 2) + 2;
  var state = null, last = null, transitions = [];
  var t0 = opts.nowMs || Date.now();
  for (var t = 1; t <= ticks; t++) {
    last = tick({ io: io, loaded: JSON.parse(JSON.stringify(loaded)), dryRun: name !== 'status-center-down' ? true : !!opts.forceWrites, state: state, nowMs: t0 + (t - 1) * 120000, env: opts.env, stateDir: opts.stateDir, sim: { mutate: sc.mutate, tick: t } });
    state = last.state;
    transitions = transitions.concat(last.transitions);
  }
  last.scenario = { name: name, note: sc.note, ticks: ticks, transitions: transitions };
  return last;
}

module.exports = { tick: tick, simulate: simulate, SCENARIOS: SCENARIOS, MARKERS: MARKERS, gate: gate, readState: readState };
