'use strict';
// =====================================================
// Mythos Orchestration Core — project data layer (vision §5 / capability G)
// projects/mythos-ai-executor/core/project-data.js
//
// Uniform access to project-specific data sources (PostgreSQL, sheets,
// files, APIs — vision §5). Today's precursors are individual product
// databases (`ssangyong_autos`, `mythos_command_center`) each reached by
// product-specific code (projects/*/reference/db.js) that callers had to
// know about individually. This module is the registry step: one place
// to discover what data sources exist and their contract (kind,
// read-only, required env), and one uniform `query(name, ...)` entry
// point that does not care which product or storage kind sits behind it —
// mirroring the tool-registry split of declarative catalog vs. wired
// adapter (core/tool-registry.js).
//
// This module never opens a connection itself and ships no database
// driver dependency: an adapter (e.g. a thin wrapper around an existing
// projects/*/reference/db.js) is wired in with registerAdapter() by the
// process that actually has the credentials. A source with no adapter
// wired is still discoverable (declarative-only), exactly like a
// provider-less tool in the tool registry.
// =====================================================

var fs = require('fs');
var path = require('path');

var redact = require('../../mythos-orchestrator/lib/redact');

var SOURCES_CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'data-sources.json'), 'utf8'));

var KINDS = ['postgres', 'sheet', 'file', 'api'];

// Statements a read-only source refuses even if a wired adapter would
// technically allow them. Defense in depth, not the sole control — the
// deployed ssangyong_autos adapter already enforces read-only at the
// connection level (default_transaction_read_only=on); this catches a
// future read_only:true source whose adapter forgets to.
var WRITE_SHAPED = /^\s*(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i;

var registry = {};   // name → definition (metadata only, never values)
var adapters = {};   // name → { query: function(text, params) }

function validateDefinition(name, def) {
  if (!/^[a-z][a-z0-9_]*$/.test(String(name))) {
    throw new Error('INVALID_DATA_SOURCE_NAME: "' + String(name).slice(0, 60) + '"');
  }
  ['project', 'kind', 'description', 'read_only', 'required_env'].forEach(function (f) {
    if (def[f] === undefined) throw new Error('DATA_SOURCE_MISSING_FIELD: ' + name + '.' + f);
  });
  if (KINDS.indexOf(def.kind) === -1) {
    throw new Error('DATA_SOURCE_UNKNOWN_KIND: ' + name + ' → ' + def.kind);
  }
  if (typeof def.read_only !== 'boolean') {
    throw new Error('DATA_SOURCE_READ_ONLY_MUST_BE_BOOLEAN: ' + name);
  }
  if (!Array.isArray(def.required_env) || def.required_env.some(function (e) { return typeof e !== 'string'; })) {
    throw new Error('DATA_SOURCE_REQUIRED_ENV_MUST_BE_STRING_ARRAY: ' + name);
  }
  // A descriptor is metadata (names, not values) by contract. Refuse
  // anything secret-shaped so a source definition can never smuggle a
  // credential in — the same refusal memory.js applies to remembered
  // content.
  var secretKinds = redact.findSecretKinds(JSON.stringify(def));
  if (secretKinds.length) {
    throw new Error('DATA_SOURCE_REFUSES_SECRETS: ' + name + ' matches ' + secretKinds.join(', ') +
      ' — descriptors declare env var NAMES, never credential values');
  }
}

function registerSource(name, def) {
  validateDefinition(name, def);
  registry[name] = {
    name: name, project: def.project, kind: def.kind, description: def.description,
    read_only: def.read_only, required_env: def.required_env.slice(),
    reference_module: def.reference_module || null
  };
  return registry[name];
}

function registerAdapter(name, adapter) {
  if (!registry[name]) throw new Error('UNKNOWN_DATA_SOURCE: ' + String(name).slice(0, 60));
  if (!adapter || typeof adapter.query !== 'function') {
    throw new Error('DATA_SOURCE_ADAPTER_NEEDS_QUERY: ' + name);
  }
  adapters[name] = adapter;
}

function envConfigured(names) {
  return names.every(function (n) { return !!process.env[n]; });
}

// Metadata only — configured/available are booleans, never the values
// that made them true.
function describeSource(name) {
  var def = registry[name];
  if (!def) return null;
  return {
    name: def.name, project: def.project, kind: def.kind, description: def.description,
    read_only: def.read_only, required_env: def.required_env.slice(),
    configured: envConfigured(def.required_env),
    available: !!adapters[name]
  };
}

function listSources(project) {
  return Object.keys(registry).sort()
    .filter(function (n) { return !project || registry[n].project === project; })
    .map(describeSource);
}

// Uniform entry point: callers never branch on `kind` — they name a
// source and pass a source-shaped request, exactly like tool-registry's
// invoke() does for actions.
function query(name, text, params) {
  var def = registry[name];
  if (!def) return Promise.reject(new Error('UNKNOWN_DATA_SOURCE: ' + String(name).slice(0, 60)));
  var adapter = adapters[name];
  if (!adapter) {
    return Promise.reject(new Error('DATA_SOURCE_HAS_NO_ADAPTER: ' + name +
      ' is declarative-only — call registerAdapter() before querying'));
  }
  if (def.read_only && WRITE_SHAPED.test(String(text))) {
    return Promise.reject(new Error('DATA_SOURCE_READ_ONLY: ' + name + ' refuses write-shaped statements'));
  }
  return Promise.resolve(adapter.query(text, params));
}

function loadDefaults() {
  registry = {};
  adapters = {};
  Object.keys(SOURCES_CONFIG).forEach(function (name) {
    registerSource(name, SOURCES_CONFIG[name]);
  });
}

function resetForTests() { loadDefaults(); }

loadDefaults();

module.exports = {
  KINDS: KINDS,
  registerSource: registerSource,
  registerAdapter: registerAdapter,
  describeSource: describeSource,
  listSources: listSources,
  query: query,
  resetForTests: resetForTests
};
