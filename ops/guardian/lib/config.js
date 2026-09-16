'use strict';
// =====================================================
// MYTHOS Guardian V0 — configuration and policy
// ops/guardian/lib/config.js
//
// DEFAULTS is the reviewed host policy. An optional override at
// ~/.config/mythos/guardian.json is deep-merged over it; an override that
// fails validation is IGNORED (Guardian keeps observing with the built-in
// defaults and reports config_error), so bad configuration can never widen
// what Guardian does.
//
// Every signal below is READ from a component that already owns it:
//   memory   <- Resource Guard publication (Option C) + /proc + memwatch
//   sessions <- session-guard lifecycle snapshot + /proc + unit state
//   services <- Status Center live-status.json + systemd + docker inspect
//   backup   <- ops/backup health records + restore-test unit results
//   disk     <- statfs + docker system df
// Guardian adds no second prober, no second scheduler and no killer.
// =====================================================

var LEVELS = require('./levels').LEVELS;

var DEFAULTS = {
  version: 1,
  // V0 is observation only. The remediation flags exist so the enablement
  // path is explicit and testable; V0 ships no remediation code and the
  // engine refuses to act on them (see engine.js remediationPosture()).
  observe_only: true,
  allow_memory_remediation: false,
  allow_disk_remediation: false,
  allow_service_restart: false,
  allow_agent_throttling: false,

  interval_seconds: 120,
  hysteresis: { escalate_samples: 2, deescalate_samples: 3, recovery_samples: 3 },
  incidents: { max_bytes: 5 * 1024 * 1024, keep: 3 },

  memory: {
    pressure_file: '/var/lib/mythos/pressure/resource-pressure.json',
    pressure_max_age_seconds: 300,
    memwatch_log: '/opt/mythos-memwatch/memwatch.log',
    memwatch_max_age_seconds: 600,
    // Guardian's own reading of the kernel. These mirror the Resource
    // Guard's ENTER thresholds exactly (resource-guard.js:57-63), so
    // Guardian can never call pressure earlier than the RG would — it can
    // only notice when the RG has stopped agreeing with the kernel.
    kernel_corroboration: { warning_avail_mib: 1200, warning_psi60: 5, critical_avail_mib: 700, critical_psi60: 30 },
    high_avail_mib: 1000,          // with RG WARNING -> HIGH
    high_psi60: 20,
    emergency_avail_mib: 400,      // with RG CRITICAL -> EMERGENCY
    swap_exhausted_pct: 95         // reported; only compounds with low avail
  },

  sessions: {
    snapshot_file: '/var/lib/mythos/lifecycle/host-sessions.json',
    snapshot_max_age_seconds: 900,
    session_guard_unit: 'mythos-session-guard.service',
    session_guard_timer: 'mythos-session-guard.timer',
    session_guard_max_age_seconds: 900,
    remote_cmdline_match: '/.claude/remote/ccd-cli/',
    hard_max_sessions: 8,
    max_concurrency: { NORMAL: 6, RECOVERY: 5, WARNING: 4, HIGH: 3, CRITICAL: 0, EMERGENCY: 0 },
    orphan_comms: ['node', 'npm', 'npx', 'next-server', 'chrome', 'chromium', 'headless_shell', 'esbuild', 'vitest', 'jest', 'tsc'],
    orphan_min_age_seconds: 600,
    orphan_warn_count: 5,
    process_count_warn: 700,
    process_count_high: 900
  },

  disk: {
    path: '/',
    thresholds: { warning_pct: 80, high_pct: 85, critical_pct: 90, emergency_pct: 95 },
    inode_thresholds: { warning_pct: 80, high_pct: 85, critical_pct: 90, emergency_pct: 95 },
    docker_df: true,
    // Collect the Docker breakdown only once disk is at or above this
    // percentage. It costs ~2.8 s per call and is only actionable under
    // pressure; the disk LEVEL always comes from statfs, which is free.
    docker_df_min_pct: 80,
    // Reported growth sources (observation only in V0; the cleanup policy
    // document lists what a future remediation layer may touch).
    watch: [
      { id: 'docker-build-cache', kind: 'docker', field: 'Build Cache' },
      { id: 'docker-images', kind: 'docker', field: 'Images' },
      { id: 'docker-volumes', kind: 'docker', field: 'Local Volumes' }
    ]
  },

  services: {
    live_status_file: '/var/www/status.mythosprod.xyz/data/live-status.json',
    live_status_max_age_seconds: 1200,
    restart_loop: { window_minutes: 30, restarts: 5 },
    units: [
      { id: 'user-manager-deploy', manager: 'system', unit: 'user@1001.service', class: 'critical' },
      { id: 'nginx', manager: 'system', unit: 'nginx.service', class: 'critical' },
      { id: 'docker', manager: 'system', unit: 'docker.service', class: 'critical' },
      { id: 'mariadb', manager: 'system', unit: 'mariadb.service', class: 'production' },
      { id: 'php-fpm', manager: 'system', unit: 'php8.5-fpm.service', class: 'production' },
      { id: 'mcp-http', manager: 'system', unit: 'mythos-mcp-http.service', class: 'production' },
      { id: 'hostops', manager: 'system', unit: 'mythos-hostops.service', class: 'support' },
      { id: 'memwatch', manager: 'system', unit: 'mythos-memwatch.service', class: 'support' },
      { id: 'gh-runner', manager: 'system', unit: 'mythos-gh-runner.service', class: 'support' },
      { id: 'session-guard-timer', manager: 'system', unit: 'mythos-session-guard.timer', class: 'support' },
      { id: 'status-monitor-timer', manager: 'system', unit: 'mythos-status-monitor.timer', class: 'support' },
      { id: 'backup-timer', manager: 'system', unit: 'mythos-backup.timer', class: 'support' },
      { id: 'backup-db-timer', manager: 'system', unit: 'mythos-backup-db.timer', class: 'support' },
      { id: 'erp-api', manager: 'deploy', unit: 'erp-api.service', class: 'critical' },
      { id: 'idauto-api', manager: 'deploy', unit: 'idauto-api.service', class: 'production' },
      { id: 'executor', manager: 'deploy', unit: 'mythos-ai-executor.service', class: 'production' },
      { id: 'command-center', manager: 'deploy', unit: 'mythos-command-center.service', class: 'production' },
      { id: 'os-console', manager: 'deploy', unit: 'mythos-os-console.service', class: 'production' },
      { id: 'mythos-wp', manager: 'deploy', unit: 'mythos-wp.service', class: 'production' },
      { id: 'oth-knowledge', manager: 'deploy', unit: 'oth-knowledge-http.service', class: 'support' },
      { id: 'piece-autos', manager: 'deploy', unit: 'piece-autos.service', class: 'production' },
      { id: 'spy', manager: 'deploy', unit: 'spy.service', class: 'production' },
      { id: 'spy-monitor', manager: 'deploy', unit: 'spy-monitor.service', class: 'support' },
      { id: 'ssangyong-storefront', manager: 'deploy', unit: 'ssangyong-storefront.service', class: 'production' }
    ],
    containers: [
      { id: 'idauto-postgres', container: 'idauto-postgres', class: 'critical' },
      { id: 'darhijama-mysql', container: 'dar-hijama-production-mysql-1', class: 'production' },
      { id: 'contextforge', container: 'mythos-contextforge', class: 'production' },
      { id: 'n8n', container: 'n8n-n8n-1', class: 'production' },
      { id: 'evolution-api', container: 'evolution-api', class: 'production' },
      { id: 'darhijama-app', container: 'dar-hijama-production-app-1', class: 'production' },
      { id: 'omniroute', container: 'omniroute', class: 'support' }
    ]
  },

  backup: {
    records: [
      { id: 'mythos-erp', file: '/home/deploy/mythos-backups/health/backup-health-db.json', fresh_hours: 26, failed_hours: 50, required: true },
      { id: 'idauto-media', file: '/home/deploy/mythos-backups/health/backup-health.json', fresh_hours: 26, failed_hours: 50, required: true },
      { id: 'ssangyong-autos', file: '/home/deploy/mythos-backups/health/backup-health-db-ssangyong.json', fresh_hours: 26, failed_hours: 50, required: false }
    ],
    restore_tests: [
      { id: 'restore-mythos-erp', unit: 'mythos-restore-db-test.service', max_age_days: 40 },
      { id: 'restore-idauto-media', unit: 'mythos-restore-test.service', max_age_days: 40 }
    ]
  }
};

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function deepMerge(base, over) {
  if (!isPlainObject(over)) return clone(over);
  var out = isPlainObject(base) ? clone(base) : {};
  Object.keys(over).forEach(function (k) {
    out[k] = isPlainObject(over[k]) && isPlainObject(out[k]) ? deepMerge(out[k], over[k]) : clone(over[k]);
  });
  return out;
}

function validate(cfg) {
  var errors = [];
  function err(m) { errors.push(m); }
  function posInt(v, name) { if (!(typeof v === 'number' && isFinite(v) && v > 0)) err(name + ' must be a positive number'); }
  function absPath(v, name) { if (typeof v !== 'string' || v[0] !== '/' || v.indexOf('..') >= 0) err(name + ' must be an absolute path without ..'); }

  if (!isPlainObject(cfg)) return ['config is not an object'];
  if (cfg.version !== 1) err('version must be 1');
  posInt(cfg.interval_seconds, 'interval_seconds');
  ['escalate_samples', 'deescalate_samples', 'recovery_samples'].forEach(function (k) { posInt(cfg.hysteresis && cfg.hysteresis[k], 'hysteresis.' + k); });
  if (cfg.hysteresis && cfg.hysteresis.escalate_samples < 2) err('hysteresis.escalate_samples must be at least 2 (one transient sample may never escalate)');

  // V0 invariant: no override may claim remediation.
  if (cfg.observe_only !== true) err('observe_only must be true: this version ships no remediation');
  ['allow_memory_remediation', 'allow_disk_remediation', 'allow_service_restart', 'allow_agent_throttling'].forEach(function (k) {
    if (cfg[k] !== false) err(k + ' must be false: this version ships no remediation');
  });

  absPath(cfg.memory && cfg.memory.pressure_file, 'memory.pressure_file');
  absPath(cfg.memory && cfg.memory.memwatch_log, 'memory.memwatch_log');
  posInt(cfg.memory && cfg.memory.pressure_max_age_seconds, 'memory.pressure_max_age_seconds');

  ['thresholds', 'inode_thresholds'].forEach(function (tk) {
    var t = (cfg.disk || {})[tk] || {};
    var seq = [t.warning_pct, t.high_pct, t.critical_pct, t.emergency_pct];
    if (!seq.every(function (x) { return typeof x === 'number' && x > 0 && x <= 100; }) ||
        !(seq[0] < seq[1] && seq[1] < seq[2] && seq[2] < seq[3])) err('disk.' + tk + ' must ascend warning < high < critical < emergency');
  });

  var ids = {};
  (((cfg.services || {}).units) || []).concat(((cfg.services || {}).containers) || []).forEach(function (e, i) {
    if (!e || typeof e.id !== 'string' || !/^[a-z0-9-]+$/.test(e.id)) { err('services entry ' + i + ' has an invalid id'); return; }
    if (ids[e.id]) err('duplicate service id ' + e.id);
    ids[e.id] = true;
    if (['critical', 'production', 'support'].indexOf(e.class) < 0) err(e.id + ': class must be critical|production|support');
    if (e.unit && !/^[A-Za-z0-9@:._-]+\.(service|timer|socket)$/.test(e.unit)) err(e.id + ': invalid unit name');
    if (e.container && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(e.container)) err(e.id + ': invalid container name');
    if (e.manager && ['system', 'deploy'].indexOf(e.manager) < 0) err(e.id + ': manager must be system|deploy');
  });

  (((cfg.backup || {}).records) || []).forEach(function (r, i) { absPath(r.file, 'backup.records[' + i + '].file'); });
  if (!(((cfg.backup || {}).records) || []).some(function (r) { return r.id === 'mythos-erp' && r.required === true; })) {
    err('backup.records must keep mythos-erp as required');
  }
  LEVELS.forEach(function (l) {
    if (typeof ((cfg.sessions || {}).max_concurrency || {})[l] !== 'number') err('sessions.max_concurrency.' + l + ' missing');
  });
  return errors;
}

function load(io, overridePath) {
  var base = clone(DEFAULTS);
  var baseErrors = validate(base);
  if (baseErrors.length) return { config: base, errors: ['built-in defaults invalid: ' + baseErrors.join('; ')], source: 'defaults' };
  if (!overridePath || !io.exists(overridePath)) return { config: base, errors: [], source: 'defaults' };
  var over = io.readJson(overridePath);
  if (over === null) return { config: base, errors: ['override ' + overridePath + ' is not valid JSON'], source: 'defaults' };
  var merged = deepMerge(base, over);
  var errs = validate(merged);
  if (errs.length) return { config: base, errors: errs.map(function (e) { return 'override rejected: ' + e; }), source: 'defaults' };
  return { config: merged, errors: [], source: overridePath };
}

module.exports = { DEFAULTS: DEFAULTS, validate: validate, load: load, deepMerge: deepMerge };
