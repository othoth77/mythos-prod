'use strict';
// =====================================================
// MYTHOS GitHub bridge — provider selection (V2.2 delegation adapter)
// projects/mythos-ai-executor/bridge/provider-selection.js
//
// THE CONNECTION, and nothing more. Before V2.2 the bridge chose its
// provider with one hardcoded expression:
//
//   EXEC_WORKER_PROVIDER || WORKER_PROVIDER || (lane ? 'delegate' : 'claude-code')
//
// which is a configuration read, not a decision: the same provider for every
// task whatever the task was. This file turns that into a routed decision
// taken by machinery that already exists — `core/provider-router.route()`
// choosing an agent from capability, probed availability, quota and the
// registry's risk/cost order, with V2.1's `lib/roles.js` supplying the
// task_type and capabilities the role requires.
//
// It contains NO routing logic of its own. It translates in three steps:
//   role      → what this task needs   (lib/roles.js, V2.1)
//   router    → which AGENT should do it (core/provider-router.js)
//   registry  → which PROVIDER that agent runs on (core/agent-registry.js)
//
// THE FLOOR IS UNCHANGED AND STILL FAIL-CLOSED. `allowed` is the bridge's
// own allow-list (`EXEC_WORKER_PROVIDER_ALLOWED`). A routed provider that is
// not in it is REFUSED, never substituted and never widened: on Haddad the
// list is exactly ['haddad-agent'], so if the local runtime is down and the
// router therefore prefers `claude-code`, this answers DEFER — the task
// stays PENDING and the next tick tries again — rather than quietly handing
// a Haddad Issue to Claude. That refusal is the live proof of "Claude is
// never the executor here", and it is why routing cannot be a silent
// upgrade of authority.
//
// Two corrections to the V2 master plan §11, both measured against the code:
//
//   * Routing does NOT require `MYTHOS_CORE_ENABLED=true`. `provider-router`,
//     `agent-registry`, `reputation` and `validation` contain zero
//     `coreEnabled()` checks; only `core/core-wiring.js` gates, and what it
//     gates is the HTTP goal API. The flag stays false and is untouched.
//   * `wait_for_quota` is UNREACHABLE from here. `route()` only answers it
//     when `opts.quota_state[agent].exhausted` is set, and no production
//     code builds that map. A runtime that is down makes the probe false,
//     the registry filters the agent out, and the answer is `no_provider`.
//     So the honest live behaviour is DEFER-on-no-permitted-provider, which
//     is what this module implements and what its tests assert.
// =====================================================

var roles = require('../lib/roles');
var router = require('../core/provider-router');
var agents = require('../core/agent-registry');

// A decision this module can return. `action` is the bridge's instruction:
//   route  — use `provider`
//   defer  — do not claim this tick; the task stays PENDING, reason recorded
var ACTIONS = { ROUTE: 'route', DEFER: 'defer' };

// Maps a routed AGENT name to the provider it runs on, from the registry —
// never from a table here, so a new agent needs no change in this file.
function providerFor(agentName) {
  var def = agents.getAgent(agentName);
  return def ? def.provider : null;
}

// selectProvider(input) → decision
//
//   input.action        the closed bridge action (implement/test/review/…)
//   input.instruction   used only to resolve the role (debugger vs coder)
//   input.task_id       for the audit record
//   input.project
//   input.allowed       string[] — the bridge's fail-closed allow-list, or
//                       null when the bridge has no restriction configured
//   input.fallback      the provider the bridge would have used before V2.2
//   input.routerOpts    injected in tests (fresh probes, quota_state)
//
// Returns { action, provider, agent, reason, decision } where `decision` is
// the auditable record: what was asked for, what the router answered, and
// why the answer was or was not usable.
function selectProvider(input) {
  input = input || {};
  var fallback = input.fallback || null;
  var allowed = Array.isArray(input.allowed) && input.allowed.length ? input.allowed : null;

  var resolved = roles.resolveRole({ action: input.action, instruction: input.instruction });
  var role = resolved.role;

  // No role means this is not one of the closed bridge actions, so there is
  // nothing to route on. Pre-V2.2 behaviour, unchanged and recorded as such.
  if (!role) {
    return {
      action: ACTIONS.ROUTE, provider: fallback, agent: null,
      reason: 'no_role:' + resolved.reason,
      decision: { routed: false, role: null, role_reason: resolved.reason, provider: fallback,
        why: 'the action resolves to no role, so the configured provider is used unchanged' }
    };
  }

  var routed;
  try {
    routed = router.route({
      id: input.task_id || null,
      project: input.project || null,
      task_type: role.task_type,
      capabilities_required: role.capabilities_required.slice()
    }, input.routerOpts || {});
  } catch (e) {
    // The router failing is not a reason to hand the task to anyone: keep
    // the configured provider, which is what the bridge used before V2.2.
    return {
      action: ACTIONS.ROUTE, provider: fallback, agent: null,
      reason: 'router_error:' + String(e && e.message).slice(0, 80),
      decision: { routed: false, role: role.id, task_type: role.task_type, provider: fallback,
        why: 'the router raised, so the configured provider is used unchanged' }
    };
  }

  var base = {
    routed: true, role: role.id, role_reason: resolved.reason,
    task_type: role.task_type, capabilities_required: role.capabilities_required.slice(),
    router_action: routed.action, router_agent: routed.agent || null,
    router_reason: routed.reason || null, allowed: allowed ? allowed.slice() : null
  };

  // The router found nobody. Not a failure of the task — the agent it wants
  // is simply not available right now (on Haddad: llama-server down, so the
  // probe is false and the registry filtered it out). Defer.
  if (routed.action === 'no_provider' || !routed.agent) {
    return {
      action: ACTIONS.DEFER, provider: null, agent: null,
      reason: 'no_provider:' + String(routed.reason || '').slice(0, 120),
      decision: Object.assign(base, { provider: null,
        why: 'no registered agent is available for ' + role.task_type + ' right now; the task stays PENDING and the next tick tries again' })
    };
  }

  // The router is waiting on quota. Unreachable in production today (nothing
  // builds quota_state) but handled rather than assumed away: waiting is a
  // defer, never a substitution.
  if (routed.action === 'wait_for_quota') {
    return {
      action: ACTIONS.DEFER, provider: null, agent: routed.agent,
      reason: 'wait_for_quota:' + routed.agent,
      decision: Object.assign(base, { provider: null,
        why: 'the routed agent is quota-exhausted; waiting is correct and substituting another is not' })
    };
  }

  var provider = providerFor(routed.agent);
  if (!provider) {
    return {
      action: ACTIONS.DEFER, provider: null, agent: routed.agent,
      reason: 'unknown_agent:' + routed.agent,
      decision: Object.assign(base, { provider: null,
        why: 'the router named an agent the registry does not define' })
    };
  }

  // THE FLOOR. A routed provider outside the bridge's allow-list is refused,
  // not swapped for one that is: swapping is exactly how a routing layer
  // becomes a silent widening of authority.
  if (allowed && allowed.indexOf(provider) === -1) {
    return {
      action: ACTIONS.DEFER, provider: null, agent: routed.agent,
      reason: 'not_permitted:' + provider,
      decision: Object.assign(base, { provider: null,
        why: 'the router chose ' + routed.agent + ' (' + provider + '), which this bridge instance may not use (' +
          allowed.join(', ') + '); refused rather than substituted' })
    };
  }

  return {
    action: ACTIONS.ROUTE, provider: provider, agent: routed.agent,
    reason: 'routed:' + routed.agent + '/' + provider,
    decision: Object.assign(base, { provider: provider,
      authority: routed.authority === undefined ? null : routed.authority,
      why: 'routed by capability from the agent registry' })
  };
}

module.exports = {
  ACTIONS: ACTIONS,
  selectProvider: selectProvider,
  providerFor: providerFor
};
