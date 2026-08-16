'use strict';
// =====================================================
// Mythos Orchestration Core — policy engine (Phase 2H)
// projects/mythos-ai-executor/core/policy-engine.js
//
// The central authorization chokepoint, independent of every agent
// (Phase 2 order §12). Every tool/action request passes checkPolicy();
// the answer is allow / deny / require_approval — approval is a STATE
// (WAITING_FOR_APPROVAL + a persisted approval entity), never a repeated
// CLI prompt.
//
// Self-protection, enforced structurally:
//   * ROOT and DESTRUCTIVE are HARD-FLOORED to deny in code. A config
//     file that says otherwise is overridden and the override is
//     reported in the decision reason.
//   * This module exposes NO mutation API: policy comes from the
//     committed config file (or an explicit test injection), so an agent
//     holding this module can read policy but never rewrite it.
//   * Spending limits are configuration, never hard-coded: disabled
//     means deny, within-limit means allow, above-limit means approval.
// =====================================================

var fs = require('fs');
var path = require('path');

var domain = require('./domain');
var store = require('./store');

var CONFIG_PATH = path.join(__dirname, '..', 'config', 'policy.json');
var VALID_DECISIONS = ['allow', 'deny', 'require_approval'];

// Classes no configuration can ever loosen.
var HARD_FLOOR = { ROOT: 'deny', DESTRUCTIVE: 'deny' };

function loadConfig(injected) {
  var cfg = injected || JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!cfg.classes) throw new Error('POLICY_CONFIG_INVALID: missing classes');
  domain.POLICY_CLASSES.forEach(function (c) {
    if (c === 'MONEY_SPEND') return; // governed by money_spend block
    var d = cfg.classes[c];
    if (VALID_DECISIONS.indexOf(d) === -1) {
      throw new Error('POLICY_CONFIG_INVALID: class ' + c + ' has decision "' + d + '"');
    }
  });
  return cfg;
}

// Creates an immutable policy engine over a config. Object.freeze is a
// guard against casual mutation; the real protection is that nothing
// here writes the config back and no setter exists.
function createEngine(injectedConfig, opts) {
  var config = loadConfig(injectedConfig);
  // The cumulative spend ledger. Injectable for tests; defaults to the
  // real one so production always gets cumulative enforcement.
  var ledger = opts && opts.ledger !== undefined ? opts.ledger : require('./budget');

  function classDecision(actionClass, project) {
    var floored = HARD_FLOOR[actionClass];
    var overrides = (config.project_overrides || {})[project] || {};
    var configured = overrides[actionClass] !== undefined
      ? overrides[actionClass] : config.classes[actionClass];
    if (floored && configured !== floored) {
      return { decision: floored, floored: true, configured: configured };
    }
    if (floored) return { decision: floored, floored: false };
    return { decision: configured, floored: false };
  }

  // request: { action_class, tool?, task_type?, project?, amount_usd? }
  function checkPolicy(request) {
    request = request || {};
    var actionClass = request.action_class;
    if (domain.POLICY_CLASSES.indexOf(actionClass) === -1) {
      return { decision: 'deny', class: actionClass, policy_id: config.policy_id,
        reason: 'unknown action class "' + String(actionClass).slice(0, 40) + '" — unknown means deny' };
    }

    if (actionClass === 'MONEY_SPEND') {
      var money = config.money_spend || { enabled: false };
      if (!money.enabled) {
        return { decision: 'deny', class: actionClass, policy_id: config.policy_id,
          reason: 'spending is disabled by configuration (money_spend.enabled=false); no personal limit is hard-coded' };
      }
      var amount = request.amount_usd;
      if (typeof amount !== 'number' || !(amount >= 0)) {
        return { decision: 'deny', class: actionClass, policy_id: config.policy_id,
          reason: 'spend requests must declare a non-negative amount_usd' };
      }
      // Per-request threshold first…
      var perRequest = amount <= money.daily_limit_usd
        ? { decision: 'allow', class: actionClass, policy_id: config.policy_id,
          reason: 'within configured per-request limit (' + amount + ' <= ' + money.daily_limit_usd + ' USD)' }
        : { decision: 'require_approval', class: actionClass, policy_id: config.policy_id,
          reason: 'amount ' + amount + ' USD exceeds configured per-request limit ' + money.daily_limit_usd + ' USD' };

      // …then the CUMULATIVE ledger. The stricter boundary always wins: a
      // request that passes the per-request threshold must still fit the
      // remaining budget for the period (the gap the first production
      // mission found). No ledger configured ⇒ per-request only, and the
      // ledger's own default is "no budget" so that cannot open spending.
      if (!ledger || !request.project) return perRequest;
      var cumulative;
      try {
        cumulative = ledger.check({ project: request.project, amount: amount,
          at: request.at, task_id: request.task_id,
          exclude_reservation_id: request.exclude_reservation_id });
      } catch (e) {
        return { decision: 'deny', class: actionClass, policy_id: config.policy_id,
          reason: 'budget ledger unavailable: ' + String(e.message).slice(0, 120) + ' — spending fails closed' };
      }
      if (cumulative.affordable) {
        return { decision: perRequest.decision, class: actionClass, policy_id: config.policy_id,
          reason: perRequest.reason + '; cumulative ' + cumulative.reason +
            ' (remaining ' + cumulative.budget.remaining + ' ' + cumulative.budget.currency +
            ' of ' + cumulative.budget.limit + ', period ' + cumulative.budget.period_key + ')',
          budget: cumulative.budget };
      }
      // Cumulative failure is at least as strict as the per-request result.
      var cumulativeDecision = money.approval_on_budget_exceeded ? 'require_approval' : 'deny';
      if (perRequest.decision === 'require_approval' && cumulativeDecision === 'deny') cumulativeDecision = 'deny';
      return { decision: cumulativeDecision, class: actionClass, policy_id: config.policy_id,
        reason: 'CUMULATIVE BUDGET: ' + cumulative.reason +
          ' (limit ' + cumulative.budget.limit + ', reserved ' + cumulative.budget.reserved +
          ', spent ' + cumulative.budget.spent + ', period ' + cumulative.budget.period_key + ')',
        budget: cumulative.budget };
    }

    var cd = classDecision(actionClass, request.project);
    var reason = 'class ' + actionClass + ' → ' + cd.decision +
      (cd.floored ? ' (HARD FLOOR: configuration attempted "' + cd.configured + '" and was overridden)' : ' (by ' + config.policy_id + ')');
    return { decision: cd.decision, class: actionClass, policy_id: config.policy_id, reason: reason };
  }

  // Aggregates a decision over several classes: any deny wins, then any
  // approval requirement, then allow. Used to gate a whole task.
  function checkClasses(classes, requestBase) {
    var decisions = (classes || []).map(function (c) {
      return checkPolicy(Object.assign({}, requestBase, { action_class: c }));
    });
    var deny = decisions.filter(function (d) { return d.decision === 'deny'; });
    if (deny.length) return Object.assign({}, deny[0], { all: decisions });
    var approval = decisions.filter(function (d) { return d.decision === 'require_approval'; });
    if (approval.length) return Object.assign({}, approval[0], { all: decisions });
    return { decision: 'allow', class: (classes || []).join('+'), policy_id: config.policy_id,
      reason: 'all classes allowed', all: decisions };
  }

  function explainPolicyDecision(request) {
    var d = checkPolicy(request);
    return 'Policy ' + d.policy_id + ' decided "' + d.decision + '" for class ' +
      d.class + (request.tool ? ' (tool ' + request.tool + ')' : '') + ': ' + d.reason;
  }

  return Object.freeze({
    policy_id: config.policy_id,
    checkPolicy: checkPolicy,
    checkClasses: checkClasses,
    explainPolicyDecision: explainPolicyDecision,
    ledger: ledger
  });
}

// --- Approval lifecycle (approval is a state, not a prompt) ---------------------

function requestApproval(subjectId, actionClass, reason, project) {
  var approval = domain.createApproval({
    subject_id: subjectId, action_class: actionClass, reason: reason, project: project || null
  });
  store.create(approval);
  store.appendEventLine({
    event_type: 'APPROVAL_REQUESTED', subject_id: subjectId, project: project,
    detail: { approval_id: approval.id, action_class: actionClass, reason: reason }
  });
  return approval;
}

function decideApproval(approvalId, granted, decidedBy) {
  var approval = store.load('approval', approvalId);
  if (!approval) throw new Error('NO_SUCH_APPROVAL: ' + approvalId);
  if (approval.status !== 'PENDING') {
    throw new Error('APPROVAL_ALREADY_DECIDED: ' + approvalId + ' is ' + approval.status);
  }
  if (!decidedBy || typeof decidedBy !== 'string') {
    throw new Error('APPROVAL_NEEDS_DECIDER: a human identity must be recorded');
  }
  approval.status = granted ? 'GRANTED' : 'DENIED';
  approval.decided_by = decidedBy;
  approval.decided_at = new Date().toISOString();
  store.save(approval);
  if (granted) {
    store.appendEventLine({
      event_type: 'APPROVAL_GRANTED', subject_id: approval.subject_id,
      detail: { approval_id: approval.id, decided_by: decidedBy }
    });
  }
  return approval;
}

function pendingApprovals(subjectId) {
  return store.list('approval', function (a) {
    return a.status === 'PENDING' && (!subjectId || a.subject_id === subjectId);
  });
}

module.exports = {
  createEngine: createEngine,
  requestApproval: requestApproval,
  decideApproval: decideApproval,
  pendingApprovals: pendingApprovals,
  HARD_FLOOR: HARD_FLOOR,
  CONFIG_PATH: CONFIG_PATH
};
