'use strict';
// =====================================================
// Mythos Orchestration Core — provider router (Phase 2J)
// projects/mythos-ai-executor/core/provider-router.js
//
// Chooses an agent for a task from: capability match, availability
// (probed), quota state, cost/risk ranking (agent registry), and
// historical reputation (tiebreak only, and only with sufficient
// evidence — never from one result).
//
// QUOTA IS NEVER GENERIC FAILURE. When the chosen agent's provider is
// quota-exhausted the router answers one of exactly two things:
//
//   { action: 'wait_for_quota' }      — the default, always correct
//   { action: 'fallback', agent }     — only when config permits the
//                                       task type AND the fallback has
//                                       THE SAME execution authority
//
// Fallback never silently increases (or changes) security authority:
// an execution task can only fall back to another execution-authority
// agent, and by default it cannot fall back at all.
// =====================================================

var fs = require('fs');
var path = require('path');

var agents = require('./agent-registry');
var reputation = require('./reputation');
var store = require('./store');

var ROUTER_CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'router.json'), 'utf8'));

var EXECUTION_TASK_TYPES = ['coding', 'integration', 'testing', 'documentation'];

function needsExecutionAuthority(task) {
  return EXECUTION_TASK_TYPES.indexOf(task.task_type) !== -1;
}

// Ranks candidates; reputation acts only as a tiebreak among equally
// available candidates and only with sufficient evidence.
function rankWithReputation(candidates, capability) {
  return candidates.slice().sort(function (a, b) {
    var sa = reputation.stats(a.name, capability);
    var sb = reputation.stats(b.name, capability);
    if (sa.sufficient && sb.sufficient && sa.rate !== sb.rate) {
      return sb.rate - sa.rate;
    }
    return 0; // preserve the registry's risk/cost ordering
  });
}

// Selects the primary agent for a task.
// opts.quota_state: { [agentName]: { exhausted: bool, resume_after? } }
// Returns { action: 'route', agent } | { action: 'wait_for_quota', agent }
//        | { action: 'fallback', agent, from } | { action: 'no_provider', reason }
function route(task, opts) {
  opts = opts || {};
  var requireExec = needsExecutionAuthority(task);
  var requirements = {
    capabilities: task.capabilities_required || [],
    task_type: task.task_type,
    exclude: opts.exclude || []
  };
  if (requireExec) requirements.require_execution_authority = true;
  else requirements.forbid_execution_authority = opts.allow_execution_for_advisory ? undefined : undefined;

  var candidates = agents.selectCandidates(requirements, { fresh: opts.fresh });
  var capability = (task.capabilities_required || [])[0] || task.task_type;
  candidates = rankWithReputation(candidates, capability);

  if (!candidates.length) {
    var all = agents.selectCandidates(requirements, { include_unavailable: true, fresh: opts.fresh });
    store.appendEventLine({
      event_type: 'PROVIDER_UNAVAILABLE', subject_id: task.id, project: task.project,
      detail: { task_type: task.task_type, considered: all.map(function (c) { return c.name + ':' + c.health_detail; }) }
    });
    return {
      action: 'no_provider',
      reason: all.length
        ? 'no available agent (considered: ' + all.map(function (c) { return c.name; }).join(', ') + ')'
        : 'no agent advertises the required capabilities'
    };
  }

  var quotaState = opts.quota_state || {};
  var primary = candidates[0];

  if (!quotaState[primary.name] || !quotaState[primary.name].exhausted) {
    return { action: 'route', agent: primary.name, authority: primary.definition.execution_authority };
  }

  // Primary is quota-exhausted → wait, or policy-permitted same-authority fallback.
  var fb = ROUTER_CONFIG.fallback || {};
  var typeAllowed = fb.enabled && (fb.allowed_task_types || []).indexOf(task.task_type) !== -1;
  var authorityBlocked = primary.definition.execution_authority && fb.never_for_execution_authority !== false;

  if (typeAllowed && !authorityBlocked) {
    var alternates = candidates.slice(1).filter(function (c) {
      return (!quotaState[c.name] || !quotaState[c.name].exhausted) &&
        c.definition.execution_authority === primary.definition.execution_authority;
    });
    if (alternates.length) {
      store.appendEventLine({
        event_type: 'PROVIDER_FALLBACK', subject_id: task.id, project: task.project,
        detail: {
          from: primary.name, to: alternates[0].name,
          same_authority: true, reason: 'quota_exhausted'
        }
      });
      return {
        action: 'fallback', agent: alternates[0].name, from: primary.name,
        authority: alternates[0].definition.execution_authority
      };
    }
  }

  return {
    action: 'wait_for_quota', agent: primary.name,
    resume_after: (quotaState[primary.name] || {}).resume_after || null,
    reason: authorityBlocked
      ? 'execution-authority tasks never fall back — same session resumes when quota returns'
      : (typeAllowed ? 'no same-authority fallback candidate available' : 'fallback not permitted for task type ' + task.task_type)
  };
}

module.exports = {
  route: route,
  needsExecutionAuthority: needsExecutionAuthority,
  EXECUTION_TASK_TYPES: EXECUTION_TASK_TYPES,
  ROUTER_CONFIG: ROUTER_CONFIG
};
