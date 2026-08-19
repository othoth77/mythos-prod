'use strict';
// =====================================================
// Mythos AI Executor — MCP capability foundation (M-12 PART 6+7)
// projects/mythos-ai-executor/lib/mcp-capabilities.js
//
// NO NETWORK CODE, NO CLIENT, NO CREDENTIALS live here. This is the
// governance layer that decides WHICH server.tool names a skill running
// under a given execution profile is permitted to name — nothing in this
// file ever calls out to one. A future stage that adds a real MCP client
// is a distinct, later change; this file exists so that stage has an
// already-governed capability list to consult rather than inventing
// authorization from scratch.
//
// FAIL CLOSED, same discipline as lib/skills.js: an invalid registry
// (unknown field, or ANY 'endpoint'/'url' key anywhere in the document)
// disables capability resolution entirely rather than trusting part of a
// malformed file. An 'endpoint'/'url' field is rejected by its very
// presence — that is a code-level concern for a future stage, and its
// appearance in config today is exactly the kind of accidental credential
// surface this stage is designed to prevent.
// =====================================================

var fs = require('fs');
var path = require('path');

var DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'config', 'mcp-capabilities.json');

var ALLOWED_SERVER_FIELDS = ['enabled', 'description', 'tools', 'required_execution_profiles'];
var ALLOWED_TOOL_FIELDS = ['description'];
var FORBIDDEN_KEY_RE = /^(endpoint|url)$/i;

// Recursively rejects any 'endpoint'/'url' key anywhere in the parsed
// document, at any depth — by design, not by allowlist, so a future field
// added under a nested object cannot smuggle one back in unnoticed.
function scanForbiddenKeys(obj, where, errors) {
  if (!obj || typeof obj !== 'object') return;
  Object.keys(obj).forEach(function (k) {
    if (FORBIDDEN_KEY_RE.test(k)) {
      errors.push(where + '.' + k + ': endpoint/url fields are rejected by design — this is a config-time registry, not a client');
    }
    scanForbiddenKeys(obj[k], where + '.' + k, errors);
  });
}

function validateRegistryObject(raw) {
  var errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, reason: 'registry root is not an object' };
  }
  scanForbiddenKeys(raw, 'root', errors);
  if (errors.length) return { valid: false, reason: errors.join('; ') };

  var topKeys = Object.keys(raw);
  if (topKeys.length !== 1 || topKeys[0] !== 'servers') {
    return { valid: false, reason: 'registry must have exactly one top-level key: servers' };
  }
  var servers = raw.servers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    return { valid: false, reason: 'servers must be an object' };
  }

  var out = {};
  Object.keys(servers).forEach(function (name) {
    var s = servers[name];
    if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push(name + ': not an object'); return; }
    var unknown = Object.keys(s).filter(function (k) { return ALLOWED_SERVER_FIELDS.indexOf(k) === -1; });
    if (unknown.length) { errors.push(name + ': unknown field(s) ' + unknown.join(',')); return; }
    if (typeof s.enabled !== 'boolean') { errors.push(name + ': enabled must be a boolean'); return; }
    if (typeof s.description !== 'string' || !s.description.trim()) { errors.push(name + ': description must be a non-empty string'); return; }
    if (!s.tools || typeof s.tools !== 'object' || Array.isArray(s.tools)) { errors.push(name + ': tools must be an object'); return; }
    Object.keys(s.tools).forEach(function (t) {
      var td = s.tools[t];
      if (!td || typeof td !== 'object' || Array.isArray(td)) { errors.push(name + '.' + t + ': not an object'); return; }
      var unk2 = Object.keys(td).filter(function (k) { return ALLOWED_TOOL_FIELDS.indexOf(k) === -1; });
      if (unk2.length) { errors.push(name + '.' + t + ': unknown field(s) ' + unk2.join(',')); }
      if (typeof td.description !== 'string' || !td.description.trim()) { errors.push(name + '.' + t + ': description must be a non-empty string'); }
    });
    if (!Array.isArray(s.required_execution_profiles) || !s.required_execution_profiles.length ||
        !s.required_execution_profiles.every(function (p) { return typeof p === 'string'; })) {
      errors.push(name + ': required_execution_profiles must be a non-empty array of strings'); return;
    }
    out[name] = s;
  });

  if (errors.length) return { valid: false, reason: errors.join('; ') };
  return { valid: true, servers: out };
}

function loadRegistry(registryPath) {
  registryPath = registryPath || DEFAULT_REGISTRY_PATH;
  var raw;
  try {
    raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (e) {
    var readReason = 'registry unreadable or not valid JSON: ' + e.message;
    console.error('[mythos-ai-executor] mcp-capabilities registry disabled: ' + readReason);
    return { valid: false, servers: {}, reason: readReason };
  }
  var result = validateRegistryObject(raw);
  if (!result.valid) {
    console.error('[mythos-ai-executor] mcp-capabilities registry disabled: ' + result.reason);
    return { valid: false, servers: {}, reason: result.reason };
  }
  return { valid: true, servers: result.servers, reason: null };
}

var DEFAULT_REGISTRY = loadRegistry();

// Computes the intersection of what a skill declares it may use, what the
// registry actually has enabled, and what the given execution profile is
// permitted for that server. Empty on any failure, always with a specific
// denied_reason: 'server_disabled' | 'profile_incompatible' |
// 'skill_not_allowed' | 'unavailable'.
function resolveCapabilities(skill, executionProfile, registry) {
  registry = registry || DEFAULT_REGISTRY;

  if (!skill || !Array.isArray(skill.allowed_mcp_servers) || !skill.allowed_mcp_servers.length ||
      !Array.isArray(skill.allowed_mcp_tools) || !skill.allowed_mcp_tools.length) {
    return { allowed: [], denied_reason: 'skill_not_allowed' };
  }
  if (!registry.valid) {
    return { allowed: [], denied_reason: 'unavailable' };
  }

  var allowed = [];
  var reason = null;
  function setReason(r) { if (!reason) reason = r; }

  // FIX (M-12 security review #3): the skill's OWN declared
  // compatible_execution_profiles must gate resolution too — not only the
  // server's required_execution_profiles. Before this, a skill declaring
  // itself incompatible with 'autonomous' still resolved capabilities under
  // 'autonomous'. A skill can never widen access to a profile it disclaims.
  if (Array.isArray(skill.compatible_execution_profiles) &&
      skill.compatible_execution_profiles.indexOf(executionProfile) === -1) {
    return { allowed: [], denied_reason: 'profile_incompatible' };
  }

  skill.allowed_mcp_tools.forEach(function (spec) {
    var parts = String(spec).split('.');
    if (parts.length !== 2) { setReason('unavailable'); return; }
    var srv = parts[0], tool = parts[1];

    if (skill.allowed_mcp_servers.indexOf(srv) === -1) { setReason('skill_not_allowed'); return; }
    var serverDef = registry.servers[srv];
    if (!serverDef) { setReason('unavailable'); return; }
    if (!serverDef.enabled) { setReason('server_disabled'); return; }
    if (serverDef.required_execution_profiles.indexOf(executionProfile) === -1) { setReason('profile_incompatible'); return; }
    if (!serverDef.tools || !Object.prototype.hasOwnProperty.call(serverDef.tools, tool)) { setReason('unavailable'); return; }

    allowed.push(srv + '.' + tool);
  });

  if (!allowed.length && !reason) reason = 'skill_not_allowed';
  return { allowed: allowed, denied_reason: allowed.length ? null : reason };
}

module.exports = {
  DEFAULT_REGISTRY_PATH: DEFAULT_REGISTRY_PATH,
  validateRegistryObject: validateRegistryObject,
  loadRegistry: loadRegistry,
  DEFAULT_REGISTRY: DEFAULT_REGISTRY,
  resolveCapabilities: resolveCapabilities
};
