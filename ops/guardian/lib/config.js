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
var PROTECTED_UNITS = require('./actions').PROTECTED.units;

var DEFAULTS = {
  version: 1,
  // Remediation exists as of V1 and is OFF by default. observe_only wins
  // over every flag below it: with observe_only true, an enabled flag still
  // takes no action. Turning any of this on is a deliberate edit to
  // ~/.config/mythos/guardian.json, and every action is still gated
  // individually (see ops/guardian/lib/remediate.js).
  observe_only: true,
  allow_memory_remediation: false,
  allow_disk_remediation: false,
  allow_service_restart: false,
  allow_agent_throttling: false,

  remediation: {
    // Where ACTION_PUBLISH_ADMISSION_ADVISORY writes. The same deploy-owned
    // directory the Resource Guard publishes into (#286), and the only path
    // outside Guardian's state directory it may write at all.
    publish_dir: '/var/lib/mythos/pressure',
    // At most this many actions in one tick, whatever else is true. A host
    // in trouble should get one careful change and another look, not a burst.
    max_actions_per_tick: 1,
    // May the SCHEDULED tick act, or only `remediate --execute`?
    // False means remediation exists but only ever runs when a human asks.
    // True is what makes it automation, and it is a separate decision from
    // enabling any individual flag — so "Guardian may clear a cache" and
    // "Guardian may do so unattended at 4am" are never the same checkbox.
    on_schedule: false,
    action_timeout_ms: 120000,
    // After this many restarts of one unit, it is DEGRADED and left alone.
    max_attempts: 3,
    // docker builder prune keeps cache newer than this.
    docker_build_cache_keep_hours: 168
  },

  interval_seconds: 120,
  // Wall-clock budget for one collection pass. Well under the unit's
  // TimeoutStartSec=120 s, so a tick always finishes and reports rather than
  // being killed. Domains not reached in time are unknown, not NORMAL.
  tick_budget_ms: 45000,
  tick_slow_ms: 5000,
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
    // Read-only, used by ACTION_CLEAR_NPM_CACHE's precondition.
    npm_cache_dir: '/home/deploy/.npm/_cacache',
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
    // EMPTY by default. Adding a unit here AND setting allow_service_restart
    // are two separate deliberate edits, and validation still refuses
    // anything that is not a support-class deploy user unit.
    restartable: [],
    containers: [
      { id: 'idauto-postgres', container: 'idauto-postgres', class: 'critical' },
      { id: 'darhijama-mysql', container: 'dar-hijama-production-mysql-1', class: 'production' },
      { id: 'contextforge', container: 'mythos-contextforge', class: 'production' },
      { id: 'n8n', container: 'n8n-n8n-1', class: 'production' },
      { id: 'evolution-api', container: 'evolution-api', class: 'production' },
      { id: 'darhijama-app', container: 'dar-hijama-production-app-1', class: 'production' },
      { id: 'darhijama-web', container: 'dar-hijama-production-web-1', class: 'production' },
      { id: 'darhijama-queue', container: 'dar-hijama-production-queue-1', class: 'production' },
      { id: 'darhijama-scheduler', container: 'dar-hijama-production-scheduler-1', class: 'production' },
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

// JSON.stringify(undefined) is undefined, and JSON.parse(undefined) throws.
// A JSON file can never produce an undefined value, but deepMerge is exported
// and callable with one, and a configuration helper that throws is a
// configuration helper that can take Guardian down at startup.
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function deepMerge(base, over) {
  if (!isPlainObject(over)) return clone(over);
  var out = isPlainObject(base) ? clone(base) : {};
  Object.keys(over).forEach(function (k) {
    if (over[k] === undefined) { delete out[k]; return; }
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
  posInt(cfg.tick_budget_ms, 'tick_budget_ms');
  if (cfg.tick_budget_ms >= 120000) err('tick_budget_ms must stay under the unit TimeoutStartSec of 120 s');
  ['escalate_samples', 'deescalate_samples', 'recovery_samples'].forEach(function (k) { posInt(cfg.hysteresis && cfg.hysteresis[k], 'hysteresis.' + k); });
  if (cfg.hysteresis && cfg.hysteresis.escalate_samples < 2) err('hysteresis.escalate_samples must be at least 2 (one transient sample may never escalate)');

  // Remediation policy. observe_only may now be false, but only coherently.
  if (typeof cfg.observe_only !== 'boolean') err('observe_only must be a boolean');
  ['allow_memory_remediation', 'allow_disk_remediation', 'allow_service_restart', 'allow_agent_throttling'].forEach(function (k) {
    if (typeof cfg[k] !== 'boolean') err(k + ' must be a boolean');
  });
  var rem = cfg.remediation || {};
  absPath(rem.publish_dir, 'remediation.publish_dir');
  posInt(rem.max_actions_per_tick, 'remediation.max_actions_per_tick');
  if (rem.max_actions_per_tick > 3) err('remediation.max_actions_per_tick must be at most 3: a host in trouble gets one careful change and another look');
  if (typeof rem.on_schedule !== 'boolean') err('remediation.on_schedule must be a boolean');
  if (rem.on_schedule === true && cfg.observe_only === true) {
    // Not an error — observe_only correctly wins — but say so, because a
    // configuration that looks like automation and is not is worth a line.
    err('remediation.on_schedule is true while observe_only is true: nothing will run');
  }
  posInt(rem.action_timeout_ms, 'remediation.action_timeout_ms');
  posInt(rem.max_attempts, 'remediation.max_attempts');
  if (rem.max_attempts > 5) err('remediation.max_attempts must be at most 5, or a restart loop is just slower');
  posInt(rem.docker_build_cache_keep_hours, 'remediation.docker_build_cache_keep_hours');
  if (rem.docker_build_cache_keep_hours < 24) err('remediation.docker_build_cache_keep_hours must be at least 24');

  // A unit is restartable only if it is configured, support-class, a deploy
  // user unit, and not protected. Configuration cannot promote a unit past
  // any of those.
  var unitsById = {};
  ((cfg.services || {}).units || []).forEach(function (u) { unitsById[u.id] = u; });
  ((cfg.services || {}).restartable || []).forEach(function (id) {
    var u = unitsById[id];
    if (!u) { err('services.restartable names an unknown unit: ' + id); return; }
    if (u.class !== 'support') err('services.restartable: ' + id + ' is ' + u.class + '-class; only support units may be restarted');
    if (u.manager !== 'deploy') err('services.restartable: ' + id + ' is a system unit; Guardian is unprivileged');
    if (PROTECTED_UNITS.indexOf(u.unit) >= 0) err('services.restartable: ' + u.unit + ' is protected and may never be restarted');
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
