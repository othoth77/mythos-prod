'use strict';
// =====================================================
// MYTHOS Guardian — configuration (defaults, override, validation)
// ops/guardian/lib/config.js
//
// DEFAULTS below IS the host policy (reviewed in git). An optional override
// at /etc/mythos-guardian/config.json is deep-merged over it (objects merge,
// arrays replace). An override that fails validation is IGNORED: Guardian
// keeps observing with the built-in defaults, refuses every active action,
// and reports `config_error` — invalid configuration can never widen what
// Guardian does.
// =====================================================

var levels = require('./levels');

var DEFAULTS = {
  version: 1,
  state_dir: '/var/lib/mythos-guardian',
  public_dir: '/var/lib/mythos-guardian/public',
  markers_dir: '/var/lib/mythos-guardian/enable',
  max_actions_per_tick: 3,
  hysteresis: { escalate_samples: 2, deescalate_samples: 3, recovery_samples: 3 },
  incidents: { max_bytes: 5 * 1024 * 1024, keep: 3 },

  memory: {
    resource_guard: {},
    swap_rule: { enabled: true, swap_used_pct_min: 95, mem_available_max_mib: 1200 },
    emergency_avail_mib: 400
  },

  disk: {
    path: '/',
    thresholds: { warning_pct: 80, high_pct: 85, critical_pct: 90, emergency_pct: 95 },
    inode_thresholds: { warning_pct: 80, high_pct: 85, critical_pct: 90, emergency_pct: 95 },
    cleanup_cooldown_minutes: 360,
    cleanup: {
      'npm-cache-root': { enabled: true },
      'runner-diag-old': { enabled: true },
      'runner-old-versions': { enabled: true },
      'vscode-server-old': { enabled: true },
      'ccd-cli-old-versions': { enabled: true },
      'claude-scratch-old': { enabled: true },
      'docker-build-cache': { enabled: true },
      'docker-dangling-images': { enabled: true },
      'journal-vacuum': { enabled: true }
    }
  },

  services: {
    restart_loop: { window_minutes: 30, restarts: 5 },
    recovery_budget: { max_attempts: 3, window_hours: 6 },
    recovery_cooldown_minutes: 10,
    entries: [
      // system manager
      { id: 'user-manager-deploy', manager: 'system', unit: 'user@1001.service', class: 'critical', recover: true },
      { id: 'nginx', manager: 'system', unit: 'nginx.service', class: 'critical', recover: true },
      { id: 'docker', manager: 'system', unit: 'docker.service', class: 'critical', recover: false },
      { id: 'mariadb', manager: 'system', unit: 'mariadb.service', class: 'production', recover: false },
      { id: 'php-fpm', manager: 'system', unit: 'php8.5-fpm.service', class: 'production', recover: true },
      { id: 'mcp-http', manager: 'system', unit: 'mythos-mcp-http.service', class: 'production', recover: true },
      { id: 'hostops', manager: 'system', unit: 'mythos-hostops.service', class: 'support', recover: true },
      { id: 'memwatch', manager: 'system', unit: 'mythos-memwatch.service', class: 'support', recover: true },
      { id: 'gh-runner', manager: 'system', unit: 'mythos-gh-runner.service', class: 'support', recover: false },
      { id: 'session-guard-timer', manager: 'system', unit: 'mythos-session-guard.timer', class: 'support', recover: false },
      { id: 'status-monitor-timer', manager: 'system', unit: 'mythos-status-monitor.timer', class: 'support', recover: false },
      { id: 'backup-timer', manager: 'system', unit: 'mythos-backup.timer', class: 'support', recover: false },
      { id: 'backup-db-timer', manager: 'system', unit: 'mythos-backup-db.timer', class: 'support', recover: false },
      { id: 'backup-db-ssangyong-timer', manager: 'system', unit: 'mythos-backup-db-ssangyong.timer', class: 'support', recover: false },
      { id: 'restore-db-test-timer', manager: 'system', unit: 'mythos-restore-db-test.timer', class: 'support', recover: false },
      { id: 'restore-test-timer', manager: 'system', unit: 'mythos-restore-test.timer', class: 'support', recover: false },
      // deploy user manager (production runs here)
      { id: 'erp-api', manager: 'deploy', unit: 'erp-api.service', class: 'critical', recover: false },
      { id: 'idauto-api', manager: 'deploy', unit: 'idauto-api.service', class: 'production', recover: true },
      { id: 'executor', manager: 'deploy', unit: 'mythos-ai-executor.service', class: 'production', recover: true },
      { id: 'command-center', manager: 'deploy', unit: 'mythos-command-center.service', class: 'production', recover: true },
      { id: 'os-console', manager: 'deploy', unit: 'mythos-os-console.service', class: 'production', recover: true },
      { id: 'mythos-wp', manager: 'deploy', unit: 'mythos-wp.service', class: 'production', recover: true },
      { id: 'oth-knowledge', manager: 'deploy', unit: 'oth-knowledge-http.service', class: 'support', recover: true },
      { id: 'piece-autos', manager: 'deploy', unit: 'piece-autos.service', class: 'production', recover: true },
      { id: 'spy', manager: 'deploy', unit: 'spy.service', class: 'production', recover: true },
      { id: 'spy-monitor', manager: 'deploy', unit: 'spy-monitor.service', class: 'support', recover: true },
      { id: 'ssangyong-storefront', manager: 'deploy', unit: 'ssangyong-storefront.service', class: 'production', recover: true },
      // docker (observed only — Guardian never restarts or recreates containers)
      { id: 'idauto-postgres', manager: 'docker', container: 'idauto-postgres', class: 'critical', recover: false },
      { id: 'contextforge', manager: 'docker', container: 'mythos-contextforge', class: 'production', recover: false },
      { id: 'n8n', manager: 'docker', container: 'n8n-n8n-1', class: 'production', recover: false },
      { id: 'evolution-api', manager: 'docker', container: 'evolution-api', class: 'production', recover: false },
      { id: 'evolution-postgres', manager: 'docker', container: 'evolution-postgres', class: 'production', recover: false },
      { id: 'darhijama-app', manager: 'docker', container: 'dar-hijama-production-app-1', class: 'production', recover: false },
      { id: 'darhijama-web', manager: 'docker', container: 'dar-hijama-production-web-1', class: 'production', recover: false },
      { id: 'darhijama-mysql', manager: 'docker', container: 'dar-hijama-production-mysql-1', class: 'production', recover: false },
      { id: 'omniroute', manager: 'docker', container: 'omniroute', class: 'support', recover: false },
      // loopback health
      { id: 'erp-health', manager: 'http', url: 'http://127.0.0.1:8787/api/v1/health', expect_status: [200], expect_body_substring: '"db":"ready"', class: 'critical', recover: false },
      { id: 'contextforge-health', manager: 'http', url: 'http://127.0.0.1:4444/health', expect_status: [200], class: 'production', recover: false },
      { id: 'idauto-api-health', manager: 'http', url: 'http://127.0.0.1:3001/', expect_status: [200], class: 'production', recover: false }
    ]
  },

  backup: {
    records: [
      { id: 'mythos-erp', file: '/home/deploy/mythos-backups/health/backup-health-db.json', fresh_hours: 26, failed_hours: 50, required: true },
      { id: 'idauto-media', file: '/home/deploy/mythos-backups/health/backup-health.json', fresh_hours: 26, failed_hours: 50, required: true },
      { id: 'ssangyong-autos', file: '/home/deploy/mythos-backups/health/backup-health-db-ssangyong.json', fresh_hours: 26, failed_hours: 50, required: false }
    ],
    restore_tests: [
      { id: 'restore-mythos-erp', unit: 'mythos-restore-db-test.service', max_age_days: 40, fallback_dir: '/home/deploy/mythos-backups/erp-staging' },
      { id: 'restore-idauto-media', unit: 'mythos-restore-test.service', max_age_days: 40, fallback_dir: '/home/deploy/mythos-backups/staging' }
    ]
  },

  sessions: {
    hard_max_sessions: 8,
    max_concurrency: { NORMAL: 6, RECOVERY: 5, WARNING: 4, HIGH: 3, CRITICAL: 0, EMERGENCY: 0 },
    session_guard_state: '/var/lib/mythos-session-guard/session-guard.json',
    session_guard_marker: '/var/lib/mythos-session-guard/session-guard.enabled',
    session_guard_stale_minutes: 15,
    orphan_min_age_seconds: 600,
    orphan_warn_count: 5
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
  function abs(v, name) { if (typeof v !== 'string' || v[0] !== '/' || v.indexOf('..') >= 0) err(name + ' must be an absolute path without ..'); }

  if (!isPlainObject(cfg)) return ['config is not an object'];
  if (cfg.version !== 1) err('version must be 1');
  ['state_dir', 'public_dir', 'markers_dir'].forEach(function (k) { abs(cfg[k], k); });
  posInt(cfg.max_actions_per_tick, 'max_actions_per_tick');
  ['escalate_samples', 'deescalate_samples', 'recovery_samples'].forEach(function (k) { posInt(cfg.hysteresis && cfg.hysteresis[k], 'hysteresis.' + k); });

  var d = cfg.disk || {};
  ['thresholds', 'inode_thresholds'].forEach(function (tk) {
    var t = d[tk] || {};
    var seq = [t.warning_pct, t.high_pct, t.critical_pct, t.emergency_pct];
    if (!seq.every(function (x) { return typeof x === 'number' && x > 0 && x <= 100; }) ||
        !(seq[0] < seq[1] && seq[1] < seq[2] && seq[2] < seq[3])) err('disk.' + tk + ' must be ascending percentages warning < high < critical < emergency');
  });
  var targets = require('./disk').TARGETS;
  Object.keys(d.cleanup || {}).forEach(function (id) {
    if (!targets[id]) err('disk.cleanup.' + id + ' is not a code-defined cleanup target');
    var t = d.cleanup[id] || {};
    if (t.min_level !== undefined && !levels.isLevel(t.min_level)) err('disk.cleanup.' + id + '.min_level invalid');
  });

  var m = cfg.memory || {};
  if (typeof m.emergency_avail_mib !== 'number' || m.emergency_avail_mib < 0) err('memory.emergency_avail_mib must be a number ≥ 0');

  var s = cfg.services || {};
  var ids = {};
  var svc = require('./services');
  (s.entries || []).forEach(function (e, i) {
    var at = 'services.entries[' + i + ']';
    if (!e || typeof e.id !== 'string' || !/^[a-z0-9-]+$/.test(e.id)) { err(at + '.id invalid'); return; }
    if (ids[e.id]) err(at + '.id duplicate ' + e.id);
    ids[e.id] = true;
    if (['system', 'deploy', 'docker', 'http'].indexOf(e.manager) < 0) err(at + '.manager invalid');
    if (['critical', 'production', 'support'].indexOf(e.class) < 0) err(at + '.class invalid');
    if ((e.manager === 'system' || e.manager === 'deploy') && !svc.UNIT_RE.test(e.unit || '')) err(at + '.unit invalid');
    if (e.manager === 'docker' && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(e.container || '')) err(at + '.container invalid');
    if (e.manager === 'http' && !svc.LOOPBACK_URL_RE.test(e.url || '')) err(at + '.url must be a loopback http URL');
    if (e.recover === true && (e.manager === 'docker' || e.manager === 'http')) err(at + ': recovery is only supported for systemd units');
    // Safety invariants that no override may relax.
    if (e.recover === true && /erp|postgres|mysql|mariadb|docker|containerd/i.test(e.id + ' ' + (e.unit || '') + ' ' + (e.container || ''))) {
      err(at + ': ' + e.id + ' is data-bearing or ERP and must never be auto-restarted');
    }
  });
  posInt(s.restart_loop && s.restart_loop.restarts, 'services.restart_loop.restarts');
  posInt(s.recovery_budget && s.recovery_budget.max_attempts, 'services.recovery_budget.max_attempts');

  var b = cfg.backup || {};
  (b.records || []).forEach(function (r, i) { abs(r.file, 'backup.records[' + i + '].file'); });
  if (!(b.records || []).some(function (r) { return r.id === 'mythos-erp' && r.required === true; })) err('backup.records must keep mythos-erp as required');

  var ss = cfg.sessions || {};
  posInt(ss.hard_max_sessions, 'sessions.hard_max_sessions');
  levels.LEVELS.forEach(function (l) {
    if (typeof (ss.max_concurrency || {})[l] !== 'number') err('sessions.max_concurrency.' + l + ' missing');
  });
  return errors;
}

// Returns { config, errors, source }. Never throws.
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
