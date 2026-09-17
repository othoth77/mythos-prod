'use strict';
// =====================================================
// MYTHOS Guardian — service domain
// ops/guardian/lib/services.js
//
// Watches systemd units (system manager and the deploy user manager),
// Docker containers and loopback HTTP health endpoints.
//
// Recovery is deliberately narrow:
//   * only entries with "recover": true in config, only systemd units;
//   * only when the unit is `failed` (systemd's own Restart= gave up) or
//     inactive while it must be active;
//   * never while a restart loop is detected (a loop is DEGRADED, not
//     something to feed more restarts);
//   * at most `max_attempts` per `window_hours` per unit, then DEGRADED
//     and the Guardian stops touching it until the window passes.
// ERP is report-only by config (recover: false) — Guardian verifies its
// health, database readiness and that no migration is running; it never
// restarts or modifies it.
// =====================================================

var UNIT_RE = /^[A-Za-z0-9@:._-]+\.(service|timer|socket)$/;
var CONTAINER_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
var LOOPBACK_URL_RE = /^http:\/\/127\.0\.0\.1:\d{2,5}\/[A-Za-z0-9/._-]*$/;

var CLASS_LEVEL = { critical: 'CRITICAL', production: 'HIGH', support: 'WARNING' };

function parseShow(text) {
  var out = {};
  (text || '').split(/\n\s*\n/).forEach(function (block) {
    var o = {};
    block.split('\n').forEach(function (l) {
      var i = l.indexOf('=');
      if (i > 0) o[l.slice(0, i)] = l.slice(i + 1);
    });
    if (o.Id) out[o.Id] = o;
  });
  return out;
}

function showUnits(io, manager, units) {
  if (!units.length) return {};
  var base = manager === 'deploy' ? ['systemctl', '--user', '-M', 'deploy@'] : ['systemctl'];
  var r = io.spawn(base.concat(['show', '--no-pager', '-p', 'Id', '-p', 'LoadState', '-p', 'ActiveState', '-p', 'SubState', '-p', 'Result', '-p', 'NRestarts']).concat(units), { timeout_ms: 10000 });
  if (r.status !== 0 && !r.stdout) return { __error: r.error || r.stderr.slice(0, 200) || ('exit ' + r.status) };
  return parseShow(r.stdout);
}

function inspectContainers(io, names) {
  if (!names.length) return {};
  var r = io.spawn(['docker', 'inspect', '--format', '{{.Name}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}'].concat(names), { timeout_ms: 15000 });
  var out = {};
  (r.stdout || '').split('\n').forEach(function (l) {
    var f = l.split('|');
    if (f.length === 4) out[f[0].replace(/^\//, '')] = { status: f[1], health: f[2] || null, restart_count: parseInt(f[3], 10) };
  });
  if (!r.stdout && r.status !== 0) out.__error = r.error || r.stderr.slice(0, 200);
  return out;
}

function httpCheck(io, e) {
  var r = io.spawn(['curl', '-sS', '-m', String(e.timeout_s || 5), '-o', '-', '-w', '\n__HTTP__%{http_code}', e.url], { timeout_ms: ((e.timeout_s || 5) + 3) * 1000, max_buffer: 1024 * 1024 });
  var idx = r.stdout.lastIndexOf('\n__HTTP__');
  var code = idx >= 0 ? parseInt(r.stdout.slice(idx + 9), 10) : 0;
  var body = idx >= 0 ? r.stdout.slice(0, idx) : '';
  var okStatus = (e.expect_status || [200]).indexOf(code) >= 0;
  var okBody = !e.expect_body_substring || body.indexOf(e.expect_body_substring) >= 0;
  return { http_status: code, ok: okStatus && okBody, error: okStatus ? (okBody ? null : 'body missing ' + e.expect_body_substring) : ('HTTP ' + code + (r.stderr ? ' ' + r.stderr.trim().slice(0, 120) : '')) };
}

function collect(cfg, io, ctx) {
  var entries = cfg.entries || [];
  var sys = entries.filter(function (e) { return e.manager === 'system' && UNIT_RE.test(e.unit); }).map(function (e) { return e.unit; });
  var usr = entries.filter(function (e) { return e.manager === 'deploy' && UNIT_RE.test(e.unit); }).map(function (e) { return e.unit; });
  var cons = entries.filter(function (e) { return e.manager === 'docker' && CONTAINER_RE.test(e.container); }).map(function (e) { return e.container; });
  var shown = { system: showUnits(io, 'system', sys), deploy: showUnits(io, 'deploy', usr) };
  var docker = inspectContainers(io, cons);
  var m = { entries: {} };
  entries.forEach(function (e) {
    if (e.manager === 'system' || e.manager === 'deploy') {
      var u = shown[e.manager][e.unit];
      if (shown[e.manager].__error) m.entries[e.id] = { observed: false, error: 'manager query failed: ' + shown[e.manager].__error };
      else if (!u || u.LoadState === 'not-found') m.entries[e.id] = { observed: true, state: 'MISSING' };
      else m.entries[e.id] = { observed: true, active: u.ActiveState, sub: u.SubState, result: u.Result, n_restarts: u.NRestarts === '' || u.NRestarts === undefined ? null : parseInt(u.NRestarts, 10) };
    } else if (e.manager === 'docker') {
      var c = docker[e.container];
      if (docker.__error && !c) m.entries[e.id] = { observed: false, error: 'docker inspect failed: ' + docker.__error };
      else if (!c) m.entries[e.id] = { observed: true, state: 'MISSING' };
      else m.entries[e.id] = { observed: true, status: c.status, health: c.health, restart_count: c.restart_count };
    } else if (e.manager === 'http' && LOOPBACK_URL_RE.test(e.url)) {
      m.entries[e.id] = Object.assign({ observed: true }, httpCheck(io, e));
    } else {
      m.entries[e.id] = { observed: false, error: 'entry rejected by validation' };
    }
  });
  // ERP: a migration running unexpectedly is reported, never interfered with.
  m.erp_migration_processes = (ctx.procs || []).filter(function (p) {
    return /migrat/i.test(p.cmdline) && /erp/i.test(p.cmdline) && !/mythos-guardian/.test(p.cmdline);
  }).map(function (p) { return { pid: p.pid, cmdline: p.cmdline.slice(0, 120) }; });
  return m;
}

function entryStatus(e, obs) {
  if (!obs || obs.observed === false) return 'UNKNOWN';
  if (obs.state === 'MISSING') return 'MISSING';
  if (e.manager === 'system' || e.manager === 'deploy') {
    if (obs.active === 'failed') return 'FAILED';
    if (obs.active === 'active' || obs.active === 'activating' || obs.active === 'reloading') return 'OK';
    return e.expect_active === false ? 'OK' : 'INACTIVE';
  }
  if (e.manager === 'docker') {
    if (obs.status !== 'running') return 'INACTIVE';
    if (obs.health === 'unhealthy') return 'UNHEALTHY';
    return 'OK';
  }
  if (e.manager === 'http') return obs.ok ? 'OK' : 'UNHEALTHY';
  return 'UNKNOWN';
}

function classify(m, cfg, prev, ctx) {
  var p = prev || {};
  var nowMs = ctx.nowMs;
  var loopCfg = cfg.restart_loop || { window_minutes: 30, restarts: 5 };
  var budget = cfg.recovery_budget || { max_attempts: 3, window_hours: 6 };
  var restarts = {}, recovery = {};
  var findings = [], plan = [], raw = 'NORMAL', immediate = false;
  var table = {};

  (cfg.entries || []).forEach(function (e) {
    var obs = m.entries[e.id];
    var status = entryStatus(e, obs);
    var counter = obs ? (typeof obs.n_restarts === 'number' ? obs.n_restarts : obs.restart_count) : null;

    // restart-loop window (systemd NRestarts / docker RestartCount deltas)
    var hist = (p.restarts && p.restarts[e.id]) || [];
    hist = hist.filter(function (h) { return nowMs - h.at <= loopCfg.window_minutes * 60000; });
    if (typeof counter === 'number' && !isNaN(counter)) hist.push({ at: nowMs, n: counter });
    restarts[e.id] = hist.slice(-60);
    var delta = hist.length ? Math.max(0, hist[hist.length - 1].n - hist[0].n) : 0;
    var looping = delta >= loopCfg.restarts;

    var attempts = ((p.recovery && p.recovery[e.id]) || []).filter(function (t) { return nowMs - t <= budget.window_hours * 3600000; });
    recovery[e.id] = attempts;

    var degraded = looping || (status !== 'OK' && status !== 'UNKNOWN' && e.recover && attempts.length >= budget.max_attempts);
    table[e.id] = { status: looping ? 'LOOP' : status, degraded: degraded, class: e.class, restarts_in_window: delta, recovery_attempts: attempts.length };

    var lvl = null;
    if (looping) lvl = e.class === 'support' ? 'WARNING' : 'HIGH';
    if (status === 'FAILED' || status === 'INACTIVE' || status === 'MISSING' || status === 'UNHEALTHY') lvl = levels_max(lvl, CLASS_LEVEL[e.class] || 'WARNING');
    if (status === 'UNKNOWN') lvl = levels_max(lvl, 'WARNING');
    if (lvl) {
      raw = levels_max(raw, lvl);
      if (e.class === 'critical' && status !== 'UNKNOWN') immediate = true;
      findings.push({
        severity: lvl, kind: looping ? 'restart_loop' : 'service_' + status.toLowerCase(), affected: e.id,
        trigger: e.id + ' ' + (looping ? 'restarted ' + delta + '× in ' + loopCfg.window_minutes + ' min' : status) + (obs && obs.error ? ' (' + obs.error + ')' : ''),
        evidence: obs, degraded: degraded
      });
    }

    var recoverable = e.recover === true && (e.manager === 'system' || e.manager === 'deploy') &&
      (status === 'FAILED' || (status === 'INACTIVE' && e.expect_active !== false));
    if (recoverable && !looping) {
      if (attempts.length >= budget.max_attempts) {
        findings.push({ severity: 'HIGH', kind: 'restart_budget_exhausted', affected: e.id, degraded: true,
          trigger: e.id + ': ' + attempts.length + ' recovery attempts in ' + budget.window_hours + ' h — Guardian stops restarting it (DEGRADED)' });
      } else {
        plan.push({ id: 'service:' + e.id, domain: 'services', kind: 'restart-unit', manager: e.manager, unit: e.unit,
          marker: 'service-recovery', cooldown_minutes: cfg.recovery_cooldown_minutes || 10,
          reason: e.unit + ' is ' + status + ' and classified restart-safe', attempt: attempts.length + 1, max_attempts: budget.max_attempts });
      }
    }
  });

  if (m.erp_migration_processes && m.erp_migration_processes.length) {
    raw = levels_max(raw, 'WARNING');
    findings.push({ severity: 'WARNING', kind: 'erp_migration_running', affected: 'erp', trigger: 'ERP migration process running', evidence: m.erp_migration_processes });
  }

  return { raw: raw, immediate: immediate, findings: findings, plan: plan, stateOut: { restarts: restarts, recovery: recovery }, summary: table };
}

var levels = require('./levels');
function levels_max(a, b) { return a ? levels.max(a, b) : b; }

// Executes one planned restart. `reset-failed` first so a unit that hit its
// StartLimit can be started once; argv only, validated unit name.
function restartUnit(io, item) {
  if (!UNIT_RE.test(item.unit)) return { ok: false, detail: 'invalid unit name' };
  var base = item.manager === 'deploy' ? ['systemctl', '--user', '-M', 'deploy@'] : ['systemctl'];
  io.spawn(base.concat(['reset-failed', item.unit]), { timeout_ms: 10000 });
  var r = io.spawn(base.concat(['start', item.unit]), { timeout_ms: 60000 });
  var after = showUnits(io, item.manager, [item.unit])[item.unit] || {};
  return { ok: r.status === 0 && after.ActiveState === 'active', detail: { exit: r.status, stderr: (r.stderr || '').slice(0, 200), active_after: after.ActiveState || null } };
}

module.exports = { collect: collect, classify: classify, restartUnit: restartUnit, parseShow: parseShow, entryStatus: entryStatus, UNIT_RE: UNIT_RE, LOOPBACK_URL_RE: LOOPBACK_URL_RE };
