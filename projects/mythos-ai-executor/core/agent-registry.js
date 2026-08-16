'use strict';
// =====================================================
// Mythos Orchestration Core — agent registry (Phase 2C)
// projects/mythos-ai-executor/core/agent-registry.js
//
// Provider-independent catalog of agents (vision §6). Agents advertise
// CAPABILITIES; selection is capability-driven, never "Claude by
// default". Claude Code is one registered agent; Gemini is registered
// but reports itself UNCONFIGURED until a real credential reference
// exists — a Gemini Plus subscription is NOT an API credential, and this
// registry never invents one.
//
// Availability is probed, not assumed: each provider has a probe
// function; a probe that throws marks the agent unavailable instead of
// crashing selection. Probes are injectable so tests never shell out.
// =====================================================

var fs = require('fs');
var path = require('path');

var AGENTS_CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'agents.json'), 'utf8'));

var REQUIRED_FIELDS = ['provider', 'capabilities', 'task_types', 'execution_authority', 'risk_level'];

var registry = {};   // name → definition
var probes = {};     // provider → function(def) → bool
var healthCache = {}; // name → { at, available, detail }

var HEALTH_TTL_MS = 5 * 60 * 1000;

function validateDefinition(name, def) {
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(String(name))) {
    throw new Error('INVALID_AGENT_NAME: ' + String(name).slice(0, 60));
  }
  REQUIRED_FIELDS.forEach(function (f) {
    if (def[f] === undefined) throw new Error('AGENT_MISSING_FIELD: ' + name + '.' + f);
  });
  if (!Array.isArray(def.capabilities) || !def.capabilities.length) {
    throw new Error('AGENT_NEEDS_CAPABILITIES: ' + name);
  }
  if (typeof def.execution_authority !== 'boolean') {
    throw new Error('AGENT_EXECUTION_AUTHORITY_MUST_BE_BOOLEAN: ' + name);
  }
}

function registerAgent(name, def) {
  validateDefinition(name, def);
  registry[name] = Object.assign({ name: name, enabled: true }, def);
  delete healthCache[name];
  return registry[name];
}

function registerProbe(provider, fn) { probes[provider] = fn; }

function resetForTests() { registry = {}; healthCache = {}; probes = {}; loadDefaults(); }

function loadDefaults() {
  Object.keys(AGENTS_CONFIG).forEach(function (name) {
    registerAgent(name, AGENTS_CONFIG[name]);
  });
}

// --- Default probes (production paths; tests inject their own) ---------------

function defaultProbe(def) {
  if (def.provider === 'claude-code') {
    return require('../providers/claude-code').available();
  }
  if (def.provider === 'openai-compat') {
    return require('../providers/openai-compat').available({});
  }
  if (def.provider === 'gemini') {
    return require('../providers/gemini').available({});
  }
  return false; // unknown provider: unavailable until a probe is registered
}

function healthCheck(name, opts) {
  opts = opts || {};
  var def = registry[name];
  if (!def) throw new Error('NO_SUCH_AGENT: ' + String(name).slice(0, 60));
  var cached = healthCache[name];
  if (!opts.fresh && cached && Date.now() - cached.at < HEALTH_TTL_MS) return cached;
  var result = { at: Date.now(), available: false, detail: null };
  if (!def.enabled) {
    result.detail = 'disabled';
  } else {
    try {
      var probe = probes[def.provider] || defaultProbe;
      result.available = !!probe(def);
      result.detail = result.available ? 'ok' : 'unavailable_or_unconfigured';
    } catch (e) {
      // A failing provider must degrade selection, never crash it.
      result.available = false;
      result.detail = 'probe_error: ' + String(e.message).slice(0, 120);
    }
  }
  healthCache[name] = result;
  return result;
}

function getAgent(name) { return registry[name] || null; }
function getCapabilities(name) {
  var def = registry[name];
  if (!def) throw new Error('NO_SUCH_AGENT: ' + String(name).slice(0, 60));
  return def.capabilities.slice();
}

function discoverAgents() {
  return Object.keys(registry).sort().map(function (name) {
    var def = registry[name];
    var health = healthCheck(name);
    return {
      name: name, provider: def.provider, capabilities: def.capabilities,
      task_types: def.task_types, model: def.model || null,
      execution_authority: def.execution_authority, risk_level: def.risk_level,
      cost: def.cost || { tier: 'unknown' }, latency: def.latency || { class: 'unknown' },
      enabled: def.enabled, available: health.available, health_detail: health.detail
    };
  });
}

// Capability-driven candidate selection. Requirements:
//   capabilities: every listed capability must be advertised
//   task_type:    must be supported when the agent declares task_types
//   require_execution_authority: hard filter — an advisory agent can never
//     be "promoted" by selection; authority comes from registration only.
// Ranking: available first, then lower risk, then declared cost tier.
var COST_RANK = { free: 0, subscription: 1, metered: 2, unknown: 3 };
var RISK_RANK = { low: 0, medium: 1, high: 2 };

function selectCandidates(requirements, opts) {
  requirements = requirements || {};
  opts = opts || {};
  var caps = requirements.capabilities || [];
  var exclude = requirements.exclude || [];
  var out = [];
  Object.keys(registry).forEach(function (name) {
    var def = registry[name];
    if (!def.enabled) return;
    if (exclude.indexOf(name) !== -1) return;
    if (requirements.require_execution_authority && !def.execution_authority) return;
    if (requirements.forbid_execution_authority && def.execution_authority) return;
    var hasAll = caps.every(function (c) { return def.capabilities.indexOf(c) !== -1; });
    if (!hasAll) return;
    if (requirements.task_type && Array.isArray(def.task_types) &&
        def.task_types.indexOf(requirements.task_type) === -1) return;
    var health = healthCheck(name, opts);
    out.push({
      name: name, definition: def, available: health.available,
      health_detail: health.detail
    });
  });
  function rank(table, key) {
    return table[key] === undefined ? 9 : table[key]; // NB: rank 0 is valid — never use ||
  }
  out.sort(function (a, b) {
    if (a.available !== b.available) return a.available ? -1 : 1;
    var risk = rank(RISK_RANK, a.definition.risk_level) - rank(RISK_RANK, b.definition.risk_level);
    if (risk !== 0) return risk;
    return rank(COST_RANK, (a.definition.cost || {}).tier) - rank(COST_RANK, (b.definition.cost || {}).tier);
  });
  return opts.include_unavailable ? out : out.filter(function (c) { return c.available; });
}

loadDefaults();

module.exports = {
  registerAgent: registerAgent,
  registerProbe: registerProbe,
  resetForTests: resetForTests,
  discoverAgents: discoverAgents,
  getAgent: getAgent,
  getCapabilities: getCapabilities,
  healthCheck: healthCheck,
  selectCandidates: selectCandidates
};
