'use strict';
// =====================================================
// MYTHOS OS v4 — DOTS policy loader (fail closed)
// projects/mythos-os-v4/lib/policy.js
//
// The policy is DOTS's authority in data form. It is validated field by
// field on every load; a missing, mistyped or out-of-range value throws
// POLICY_INVALID and the control plane stops. No default ever stands in
// for a rule the file did not state.
// =====================================================

var fs = require('fs');
var path = require('path');

var DEFAULT_PATH = path.join(__dirname, '..', 'config', 'dots-policy.json');

function isPosInt(n) { return Number.isInteger(n) && n > 0; }
function isStrList(a, min) {
  return Array.isArray(a) && a.length >= (min || 0) && a.every(function (s) { return typeof s === 'string' && s.length > 0; });
}

function validate(p) {
  var errors = [];
  function need(cond, msg) { if (!cond) errors.push(msg); }
  if (!p || typeof p !== 'object') return ['policy is not an object'];

  var a = p.authority || {};
  need(a.general_manager === 'dots', 'authority.general_manager must be "dots"');
  need(a.executive_primary === 'fable', 'authority.executive_primary must be "fable"');
  need(a.executive_failover === 'openai', 'authority.executive_failover must be "openai"');
  need(a.executive_last_resort === 'direct' || a.executive_last_resort === 'none', 'authority.executive_last_resort must be "direct" or "none"');

  var g = p.goal || {};
  need(isStrList(g.priorities, 1), 'goal.priorities must be a non-empty list');
  ['max_title_chars', 'max_objective_chars', 'max_open_goals', 'max_runs_per_goal'].forEach(function (k) {
    need(isPosInt(g[k]), 'goal.' + k + ' must be a positive integer');
  });

  var pl = p.plan || {};
  ['max_steps', 'max_instruction_chars', 'max_acceptance_items', 'min_step_timeout_seconds', 'max_step_timeout_seconds', 'min_work_timeout_seconds'].forEach(function (k) {
    need(isPosInt(pl[k]), 'plan.' + k + ' must be a positive integer');
  });
  need(pl.min_step_timeout_seconds <= pl.max_step_timeout_seconds, 'plan.min_step_timeout_seconds exceeds the maximum');
  need(pl.min_work_timeout_seconds <= pl.max_step_timeout_seconds, 'plan.min_work_timeout_seconds exceeds the maximum');
  need(isStrList(pl.answer_actions, 1), 'plan.answer_actions must be a non-empty list');
  need(isStrList(pl.work_actions, 1), 'plan.work_actions must be a non-empty list');
  need(isStrList(pl.write_actions, 0), 'plan.write_actions must be a list');
  need(isStrList(pl.forbidden_terms, 1), 'plan.forbidden_terms must be a non-empty list');
  if (isStrList(pl.write_actions, 0) && isStrList(pl.work_actions, 1)) {
    pl.write_actions.forEach(function (w) {
      need(pl.work_actions.indexOf(w) !== -1, 'plan.write_actions names "' + w + '", which is not a work action');
    });
  }

  var l = p.loop || {};
  ['max_cycles', 'max_total_steps', 'max_refusals', 'goal_deadline_seconds', 'history_output_chars'].forEach(function (k) {
    need(isPosInt(l[k]), 'loop.' + k + ' must be a positive integer');
  });

  var e = p.executive || {};
  need(isPosInt(e.timeout_seconds), 'executive.timeout_seconds must be a positive integer');
  need(isPosInt(e.attempts_per_engine) && e.attempts_per_engine <= 3, 'executive.attempts_per_engine must be 1..3');
  need(typeof e.fable_model === 'string' && /^claude-fable-/.test(e.fable_model), 'executive.fable_model must name a claude-fable model');
  need(typeof e.openai_role === 'string' && e.openai_role, 'executive.openai_role is required');
  need(isStrList(e.direct_actions, 0), 'executive.direct_actions must be a list');
  need(e.on_no_executive === 'hold' || e.on_no_executive === 'escalate', 'executive.on_no_executive must be "hold" or "escalate"');
  if (isStrList(e.direct_actions, 0) && isStrList(pl.answer_actions, 1)) {
    e.direct_actions.forEach(function (d) {
      need(pl.answer_actions.indexOf(d) !== -1, 'executive.direct_actions names "' + d + '", which is not an answer action (the last resort never writes)');
    });
  }

  var f = p.failover || {};
  ['failure_threshold', 'window_seconds', 'cooldown_seconds', 'cooldown_max_seconds'].forEach(function (k) {
    need(isPosInt(f[k]), 'failover.' + k + ' must be a positive integer');
  });
  need(typeof f.cooldown_factor === 'number' && f.cooldown_factor >= 1, 'failover.cooldown_factor must be >= 1');

  var w = p.watchdog || {};
  need(typeof w.review_write_plans === 'boolean', 'watchdog.review_write_plans must be a boolean');
  need(w.on_review_unavailable === 'escalate' || w.on_review_unavailable === 'proceed', 'watchdog.on_review_unavailable must be "escalate" or "proceed"');
  need(typeof w.openai_review_role === 'string' && w.openai_review_role, 'watchdog.openai_review_role is required');
  need(isPosInt(w.stall_grace_seconds), 'watchdog.stall_grace_seconds must be a positive integer');

  var m = p.models || {};
  need(Array.isArray(m.tier_order) && m.tier_order.length === 3 &&
    ['free', 'local', 'paid'].every(function (t) { return m.tier_order.indexOf(t) !== -1; }),
  'models.tier_order must order exactly free, local and paid');
  var paid = m.paid || {};
  need(typeof paid.allowed === 'boolean', 'models.paid.allowed must be a boolean');
  need(Number.isInteger(paid.max_calls_per_goal) && paid.max_calls_per_goal >= 0, 'models.paid.max_calls_per_goal must be an integer >= 0');
  need(Number.isInteger(paid.max_calls_per_day) && paid.max_calls_per_day >= 0, 'models.paid.max_calls_per_day must be an integer >= 0');
  need(typeof m.static_fallback_model === 'string' && m.static_fallback_model, 'models.static_fallback_model is required');

  var gw = p.gateway || {};
  ['attempt_timeout_seconds', 'retry_base_ms', 'retry_max_ms', 'max_attempts_total', 'max_output_chars'].forEach(function (k) {
    need(isPosInt(gw[k]), 'gateway.' + k + ' must be a positive integer');
  });
  need(Number.isInteger(gw.max_retries_per_model) && gw.max_retries_per_model >= 0 && gw.max_retries_per_model <= 3, 'gateway.max_retries_per_model must be 0..3');

  var j = p.jev || {};
  ['failure_threshold', 'cooldown_seconds', 'cooldown_max_seconds', 'quota_default_cooldown_seconds', 'blocked_cooldown_seconds', 'availability_ttl_seconds'].forEach(function (k) {
    need(isPosInt(j[k]), 'jev.' + k + ' must be a positive integer');
  });
  need(typeof j.cooldown_factor === 'number' && j.cooldown_factor >= 1, 'jev.cooldown_factor must be >= 1');

  var h = p.haddad || {};
  need(typeof h.project === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(h.project), 'haddad.project must be a project id');
  need(typeof h.work_provider === 'string' && h.work_provider, 'haddad.work_provider is required');
  ['poll_interval_seconds', 'enqueue_timeout_seconds', 'supervised_watch_interval_seconds', 'retry_backoff_seconds'].forEach(function (k) {
    need(isPosInt(h[k]), 'haddad.' + k + ' must be a positive integer');
  });
  need(typeof h.work_guidance === 'string' && h.work_guidance.length <= 600, 'haddad.work_guidance must be a string of at most 600 characters');
  need(typeof h.executor_env_file === 'string' && h.executor_env_file, 'haddad.executor_env_file is required');
  need(typeof h.executor_unit === 'string' && /^[A-Za-z0-9@._-]+\.service$/.test(h.executor_unit), 'haddad.executor_unit must be a systemd service name');
  need(typeof h.supervisor_config === 'string' && h.supervisor_config && h.supervisor_config.indexOf('..') === -1 && h.supervisor_config[0] !== '/',
    'haddad.supervisor_config must be a repository-relative path');
  need(isStrList(h.direct_actions, 0), 'haddad.direct_actions must be a list');
  if (isStrList(h.direct_actions, 0) && isStrList(pl.work_actions, 1) && isStrList(pl.write_actions, 0)) {
    h.direct_actions.forEach(function (d) {
      need(pl.work_actions.indexOf(d) !== -1, 'haddad.direct_actions names "' + d + '", which is not a work action');
      // The direct path has no worktree of its own: a write may never take it.
      need(pl.write_actions.indexOf(d) === -1, 'haddad.direct_actions names the write action "' + d + '" — a write only runs through the supervised bridge path');
    });
  }
  need(Number.isInteger(h.work_max_retries) && h.work_max_retries >= 0 && h.work_max_retries <= 3, 'haddad.work_max_retries must be 0..3');

  return errors;
}

// load(opts) -> the validated policy. opts.path / MYTHOS_OS_POLICY override
// the shipped file (tests, a host-specific policy); opts.policy injects one.
function load(opts) {
  opts = opts || {};
  var policy = opts.policy;
  var source = '(injected)';
  if (!policy) {
    source = opts.path || process.env.MYTHOS_OS_POLICY || DEFAULT_PATH;
    var text;
    try { text = fs.readFileSync(source, 'utf8'); } catch (e) {
      throw new Error('POLICY_INVALID: cannot read ' + source);
    }
    try { policy = JSON.parse(text); } catch (e2) {
      throw new Error('POLICY_INVALID: ' + source + ' is not JSON');
    }
  }
  var errors = validate(policy);
  if (errors.length) throw new Error('POLICY_INVALID: ' + errors.join('; '));
  return policy;
}

module.exports = { load: load, validate: validate, DEFAULT_PATH: DEFAULT_PATH };
