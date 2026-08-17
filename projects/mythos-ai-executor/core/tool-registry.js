'use strict';
// =====================================================
// Mythos Orchestration Core — tool registry (Phase 2D)
// projects/mythos-ai-executor/core/tool-registry.js
//
// Tools represent ACTIONS, separate from agents (vision §7). Every tool
// carries metadata (capabilities, schemas, policy class, risk, provider,
// availability) and grants are LEAST-PRIVILEGE: an agent receives only
// the tools its task needs AND policy allows — never the whole registry.
//
// Invocation is grant-checked and schema-checked. Tools whose provider
// is "mock" never perform real side effects: they exist so missions,
// tests and the §18 campaign scenario can exercise orchestration without
// spending money, publishing anything, or calling external APIs.
// =====================================================

var fs = require('fs');
var path = require('path');

var schema = require('../../mythos-orchestrator/lib/schema');
var gitlib = require('../../mythos-orchestrator/lib/git');
var domain = require('./domain');

var TOOLS_CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'tools.json'), 'utf8'));

var RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

var registry = {};   // name → definition
var adapters = {};   // name → function(input) → result (real or mock executable)

function validateDefinition(name, def) {
  if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(String(name))) {
    throw new Error('INVALID_TOOL_NAME: "' + String(name).slice(0, 60) + '" (expected namespace.action)');
  }
  ['version', 'capabilities', 'policy_class', 'risk', 'provider'].forEach(function (f) {
    if (def[f] === undefined) throw new Error('TOOL_MISSING_FIELD: ' + name + '.' + f);
  });
  if (domain.POLICY_CLASSES.indexOf(def.policy_class) === -1) {
    throw new Error('TOOL_UNKNOWN_POLICY_CLASS: ' + name + ' → ' + def.policy_class);
  }
  if (RISK_LEVELS.indexOf(def.risk) === -1) {
    throw new Error('TOOL_UNKNOWN_RISK: ' + name + ' → ' + def.risk);
  }
  // Schemas must be valid for the in-repo validator (unknown keywords fail
  // loudly there, so a bad schema is caught at registration, not at call).
  ['input_schema', 'output_schema'].forEach(function (key) {
    if (def[key]) {
      var probe = schema.validate({}, def[key]);
      probe.errors.forEach(function (err) {
        if (/unsupported schema keyword/.test(err)) {
          throw new Error('TOOL_SCHEMA_UNSUPPORTED: ' + name + '.' + key + ': ' + err);
        }
      });
    }
  });
}

function registerTool(name, def, adapter) {
  validateDefinition(name, def);
  registry[name] = Object.assign({ name: name, available: true }, def);
  if (adapter) adapters[name] = adapter;
  return registry[name];
}

function resetForTests() { registry = {}; adapters = {}; loadDefaults(); }

function getTool(name) { return registry[name] || null; }

function discoverTools() {
  return Object.keys(registry).sort().map(function (n) {
    var d = registry[n];
    return {
      name: n, version: d.version, capabilities: d.capabilities,
      policy_class: d.policy_class, risk: d.risk, provider: d.provider,
      available: d.available !== false && (d.provider !== 'external' || !!adapters[n]),
      cost: d.cost || { tier: 'unknown' }
    };
  });
}

// Least-privilege grant computation: intersect required capabilities,
// then filter through the caller-supplied policy check. Returns tool
// NAMES — the agent never sees definitions of tools it was not granted.
function grantTools(required, policyCheck) {
  if (typeof policyCheck !== 'function') {
    throw new Error('GRANT_REQUIRES_POLICY: grantTools must receive a policy check function');
  }
  var grants = [];
  Object.keys(registry).forEach(function (name) {
    var def = registry[name];
    var needed = (required || []).some(function (cap) {
      return def.capabilities.indexOf(cap) !== -1;
    });
    if (!needed) return;
    var decision = policyCheck({ action_class: def.policy_class, tool: name, risk: def.risk });
    if (decision && decision.decision === 'allow') grants.push(name);
  });
  return grants.sort();
}

// A tool "mutates" when its policy class is anything but READ (vision §12).
// This is the single source of truth for what dry run must intercept.
function isMutating(name) {
  var def = registry[name];
  return !!def && def.policy_class !== 'READ';
}

// Grant-checked, schema-checked invocation. `options.dryRun` (vision §V) makes
// this a first-class execution mode for ANY mutating tool: input is still
// grant- and schema-checked, but the adapter never runs, so there is no real
// side effect regardless of provider. READ tools are unaffected — they have
// no side effect to withhold.
function invoke(name, input, grants, options) {
  var def = registry[name];
  if (!def) return { ok: false, error: 'NO_SUCH_TOOL: ' + String(name).slice(0, 60) };
  if (!Array.isArray(grants) || grants.indexOf(name) === -1) {
    return { ok: false, error: 'TOOL_NOT_GRANTED: ' + name + ' is not in this task\'s grant set' };
  }
  if (def.available === false) {
    return { ok: false, error: 'TOOL_UNAVAILABLE: ' + name };
  }
  if (def.input_schema) {
    var check = schema.validate(input || {}, def.input_schema);
    if (!check.valid) {
      return { ok: false, error: 'TOOL_INPUT_INVALID: ' + check.errors.join('; ') };
    }
  }
  var dryRun = !!(options && options.dryRun);
  if (dryRun && isMutating(name)) {
    return {
      ok: true,
      dry_run: true,
      result: null,
      would_execute: { tool: name, input: input || {}, policy_class: def.policy_class, risk: def.risk },
      mocked: def.provider === 'mock'
    };
  }
  var adapter = adapters[name];
  if (!adapter) return { ok: false, error: 'TOOL_HAS_NO_ADAPTER: ' + name + ' is declarative-only' };
  try {
    var result = adapter(input || {});
    return { ok: true, result: result, mocked: def.provider === 'mock' };
  } catch (e) {
    return { ok: false, error: 'TOOL_EXECUTION_FAILED: ' + String(e.message).slice(0, 200) };
  }
}

// --- Built-in adapters -----------------------------------------------------------

function loadDefaults() {
  Object.keys(TOOLS_CONFIG).forEach(function (name) {
    registerTool(name, TOOLS_CONFIG[name]);
  });

  // Real, safe, read-only adapters.
  adapters['git.read'] = function (input) {
    var repo = String(input.repo_path || '');
    if (!gitlib.isRepo(repo)) throw new Error('not a git repository');
    return {
      branch: gitlib.currentBranch(repo),
      head: gitlib.head(repo),
      dirty: gitlib.isDirty(repo)
    };
  };
  adapters['filesystem.read'] = function (input) {
    var p = path.resolve(String(input.path || ''));
    var roots = (process.env.MYTHOS_TOOL_FS_ROOTS ||
      '/home/deploy/projects/mythos-prod,/home/ubuntu/mythos-ai-executor').split(',');
    var inside = roots.some(function (r) { return p.indexOf(path.resolve(r.trim()) + path.sep) === 0; });
    if (!inside) throw new Error('path outside allowed roots');
    return { path: p, content: fs.readFileSync(p, 'utf8').slice(0, 65536) };
  };

  // Mock adapters: no side effects, deterministic, clearly labelled.
  adapters['web.search'] = function (input) {
    return { mocked: true, query: input.query, results: [] };
  };
  adapters['image.generate'] = function (input) {
    return { mocked: true, prompt: input.prompt, image_ref: 'mock://image/' + Date.now() };
  };
  adapters['image.validate'] = function (input) {
    return { mocked: true, image_ref: input.image_ref, valid: true };
  };
  adapters['meta.create_campaign'] = function (input) {
    // NEVER a real spend path: the adapter is a mock by registration and
    // by construction — it fabricates a sandbox campaign id and echoes
    // the budget back for policy assertions.
    return {
      mocked: true, sandbox: true,
      campaign_id: 'sandbox-campaign-' + Date.now(),
      daily_budget_usd: input.daily_budget_usd,
      duration_days: input.duration_days,
      published: false
    };
  };
}

loadDefaults();

module.exports = {
  RISK_LEVELS: RISK_LEVELS,
  registerTool: registerTool,
  resetForTests: resetForTests,
  getTool: getTool,
  discoverTools: discoverTools,
  grantTools: grantTools,
  invoke: invoke,
  isMutating: isMutating
};
