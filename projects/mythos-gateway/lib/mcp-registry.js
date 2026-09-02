'use strict';
// =====================================================
// MYTHOS MCP estate registry — loader and validator
// projects/mythos-gateway/lib/mcp-registry.js
//
// WHAT THIS IS: the one place that names every MCP server MYTHOS runs or
// consumes — purpose, direction, transport, authentication REQUIREMENT,
// declared tools, enabled state, consumers — as metadata. It is the
// discovery index the OTHMODE read model, bin/mcp-registry-check and the
// executor's governed invoke (lib/mcp-invoke.js) all read.
//
// WHAT THIS IS NOT: not a runtime registry (ContextForge stays
// authoritative for what the gateway serves) and not the outbound skill
// governance (config/mcp-capabilities.json stays authoritative for what a
// skill may name). It indexes both; it replaces neither.
//
// REGISTRATION IS A CLAIM. Nothing here proves a server answers;
// bin/mcp-registry-check measures that and writes a snapshot.
//
// FAIL CLOSED, the discipline of lib/mcp-capabilities.js: an unknown
// field, a value where a reference belongs, an embedded credential in a
// URL, or ANY secret-shaped string anywhere in the document invalidates
// the whole registry rather than trusting part of a malformed file.
// Credentials are named by Vault reference (cred_…) only —
// MYTHOS_VAULT_ARCHITECTURE §4: references in the platform, values only
// in the vault.
// =====================================================

var fs = require('fs');
var path = require('path');
var redact = require('../../mythos-orchestrator/lib/redact');

var VERSION = '1.0.0';
var DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'registry', 'mcp-registry.json');

// The measured health vocabulary. A server is exactly one of these after
// a check; before a check it has no status at all (null), never a guess.
var STATUSES = ['ONLINE', 'DEGRADED', 'OFFLINE', 'UNAUTHORIZED', 'ERROR'];
var DIRECTIONS = ['inbound', 'outbound', 'gateway'];
var TRANSPORT_KINDS = ['stdio', 'streamable-http', 'gateway-http'];
var SCHEMES = ['host-access', 'bearer', 'bearer-per-request', 'jwt', 'none'];

var CRED_REF_RE = /^cred_[a-z0-9][a-z0-9_-]{2,62}$/;
var SERVER_NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
var TOOL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

var TOP_FIELDS = ['schema_version', 'note', 'servers'];
var SERVER_FIELDS = ['purpose', 'owner', 'direction', 'transport', 'source', 'version', 'protocol_version',
  'auth', 'credentials', 'tools', 'tools_note', 'toolsets', 'relays', 'peers', 'write_capable', 'enabled',
  'enabled_note', 'public', 'consumers', 'outbound_capability_server', 'gateway_name', 'admin_credential', 'note'];
var TRANSPORT_FIELDS = {
  'stdio': ['kind', 'launcher'],
  'streamable-http': ['kind', 'url', 'health_url', 'gateway_url'],
  'gateway-http': ['kind', 'url', 'health_url', 'mcp_url', 'public_url']
};
var AUTH_FIELDS = ['required', 'scheme', 'credential', 'note'];
var STRING_FIELDS = ['owner', 'source', 'version', 'protocol_version', 'tools_note', 'enabled_note', 'gateway_name', 'note'];

// A key that NAMES a secret may hold only a reference, or nothing.
var VALUE_KEY_RE = /(token|secret|password|passwd|api_?key|private_?key|credential)$/i;

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
// http(s) URL with no `user:pass@` — an embedded credential is a value.
function isHttpUrl(u) { return typeof u === 'string' && /^https?:\/\/[^\s@/]+(\/[^\s]*)?$/.test(u); }
function unknownFields(obj, allowed) {
  return Object.keys(obj).filter(function (k) { return allowed.indexOf(k) === -1; });
}
function isRef(v) { return typeof v === 'string' && CRED_REF_RE.test(v); }
function isRefList(v) { return Array.isArray(v) && v.every(isRef); }

function scanValueKeys(obj, where, errors) {
  if (!obj || typeof obj !== 'object') return;
  Object.keys(obj).forEach(function (k) {
    var v = obj[k];
    if (!Array.isArray(obj) && VALUE_KEY_RE.test(k) && !(v === null || isRef(v) || isRefList(v))) {
      errors.push(where + '.' + k + ': a key that names a secret may hold only a cred_ reference, never a value');
    }
    scanValueKeys(v, where + '.' + k, errors);
  });
}

function validateServer(name, s, all, errors) {
  var w = 'servers.' + name;
  if (!SERVER_NAME_RE.test(name)) { errors.push(w + ': invalid server name'); return null; }
  if (!isObj(s)) { errors.push(w + ': not an object'); return null; }
  unknownFields(s, SERVER_FIELDS).forEach(function (k) { errors.push(w + ': unknown field ' + k); });
  if (typeof s.purpose !== 'string' || !s.purpose.trim()) errors.push(w + '.purpose must be a non-empty string');
  if (DIRECTIONS.indexOf(s.direction) === -1) errors.push(w + '.direction must be one of ' + DIRECTIONS.join('|'));

  if (!isObj(s.transport) || TRANSPORT_KINDS.indexOf(s.transport.kind) === -1) {
    errors.push(w + '.transport.kind must be one of ' + TRANSPORT_KINDS.join('|'));
  } else {
    unknownFields(s.transport, TRANSPORT_FIELDS[s.transport.kind]).forEach(function (k) { errors.push(w + '.transport: unknown field ' + k); });
    if (s.transport.kind === 'stdio') {
      if (typeof s.transport.launcher !== 'string' || !path.isAbsolute(s.transport.launcher)) errors.push(w + '.transport.launcher must be an absolute path');
    } else if (!isHttpUrl(s.transport.url)) {
      errors.push(w + '.transport.url must be an http(s) URL without embedded credentials');
    }
    ['health_url', 'gateway_url', 'mcp_url', 'public_url'].forEach(function (k) {
      if (s.transport[k] !== undefined && s.transport[k] !== null && !isHttpUrl(s.transport[k])) {
        errors.push(w + '.transport.' + k + ' must be an http(s) URL without embedded credentials');
      }
    });
  }

  if (!isObj(s.auth)) {
    errors.push(w + '.auth must be an object');
  } else {
    unknownFields(s.auth, AUTH_FIELDS).forEach(function (k) { errors.push(w + '.auth: unknown field ' + k); });
    if (typeof s.auth.required !== 'boolean') errors.push(w + '.auth.required must be a boolean');
    if (SCHEMES.indexOf(s.auth.scheme) === -1) errors.push(w + '.auth.scheme must be one of ' + SCHEMES.join('|'));
    if (s.auth.credential !== undefined && s.auth.credential !== null && !isRef(s.auth.credential)) errors.push(w + '.auth.credential must be a cred_ reference or null');
    if ((s.auth.scheme === 'bearer' || s.auth.scheme === 'jwt') && !isRef(s.auth.credential)) errors.push(w + '.auth: a ' + s.auth.scheme + ' scheme must name the credential reference it uses');
    if (s.auth.note !== undefined && typeof s.auth.note !== 'string') errors.push(w + '.auth.note must be a string');
  }

  if (!isRefList(s.credentials)) errors.push(w + '.credentials must be an array of cred_ references');
  // A gateway is verified with an ADMIN credential (the checker's) and used
  // with a CLIENT credential (an issued token). They are never the same
  // reference: an admin password is not a client identity.
  if (s.admin_credential !== undefined && s.admin_credential !== null) {
    if (!isRef(s.admin_credential)) errors.push(w + '.admin_credential must be a cred_ reference or null');
    else if (s.transport && s.transport.kind !== 'gateway-http') errors.push(w + '.admin_credential is only meaningful for a gateway');
    else if (s.auth && s.auth.credential === s.admin_credential) errors.push(w + '.admin_credential must differ from auth.credential — an admin password is not a client token');
  }
  if (!Array.isArray(s.tools) || !s.tools.every(function (t) { return typeof t === 'string' && TOOL_NAME_RE.test(t); })) errors.push(w + '.tools must be an array of tool names');
  if (s.toolsets !== undefined && (!Array.isArray(s.toolsets) || !s.toolsets.every(function (t) { return typeof t === 'string'; }))) errors.push(w + '.toolsets must be an array of strings');
  if (typeof s.write_capable !== 'boolean') errors.push(w + '.write_capable must be a boolean');
  if (typeof s.enabled !== 'boolean') errors.push(w + '.enabled must be a boolean');
  if (s.public !== undefined && typeof s.public !== 'boolean') errors.push(w + '.public must be a boolean');
  if (!Array.isArray(s.consumers) || !s.consumers.every(function (c) { return typeof c === 'string'; })) errors.push(w + '.consumers must be an array of strings');
  if (s.outbound_capability_server !== undefined && s.outbound_capability_server !== null && typeof s.outbound_capability_server !== 'string') errors.push(w + '.outbound_capability_server must be a string or null');
  if (s.relays !== undefined && s.relays !== null) {
    if (typeof s.relays !== 'string') errors.push(w + '.relays must be a server name');
    else if (!all[s.relays]) errors.push(w + '.relays names an unregistered server ' + s.relays);
  }
  if (s.peers !== undefined) {
    if (!Array.isArray(s.peers) || !s.peers.every(function (p) { return typeof p === 'string'; })) errors.push(w + '.peers must be an array of server names');
    else s.peers.forEach(function (p) { if (!all[p]) errors.push(w + '.peers names an unregistered server ' + p); });
  }
  STRING_FIELDS.forEach(function (k) {
    if (s[k] !== undefined && s[k] !== null && typeof s[k] !== 'string') errors.push(w + '.' + k + ' must be a string');
  });
  return s;
}

// Validates a parsed registry. `text`, when given, is the raw document and
// is scanned for secret shapes with the orchestrator's own detector — the
// same patterns that redact task logs decide what may never be committed.
function validateRegistryObject(raw, text) {
  var errors = [];
  if (typeof text === 'string') {
    var kinds = redact.findSecretKinds(text);
    if (kinds.length) return { valid: false, reason: 'secret-shaped content in registry: ' + kinds.join(',') };
  }
  if (!isObj(raw)) return { valid: false, reason: 'registry root is not an object' };
  unknownFields(raw, TOP_FIELDS).forEach(function (k) { errors.push('root: unknown field ' + k); });
  if (raw.schema_version !== '1.0.0') errors.push('root: schema_version must be 1.0.0');
  if (!isObj(raw.servers)) errors.push('servers must be an object');
  scanValueKeys(raw, 'root', errors);
  if (errors.length) return { valid: false, reason: errors.join('; ') };

  var out = {};
  Object.keys(raw.servers).forEach(function (name) {
    var s = validateServer(name, raw.servers[name], raw.servers, errors);
    if (s) out[name] = s;
  });
  if (errors.length) return { valid: false, reason: errors.join('; ') };
  return { valid: true, servers: out, schema_version: raw.schema_version };
}

function loadRegistry(registryPath) {
  registryPath = registryPath || process.env.MYTHOS_MCP_REGISTRY_FILE || DEFAULT_REGISTRY_PATH;
  var text;
  try { text = fs.readFileSync(registryPath, 'utf8'); }
  catch (e) { return { valid: false, servers: {}, reason: 'registry unreadable: ' + e.message, path: registryPath }; }
  var raw;
  try { raw = JSON.parse(text); }
  catch (e) { return { valid: false, servers: {}, reason: 'registry is not valid JSON: ' + e.message, path: registryPath }; }
  var r = validateRegistryObject(raw, text);
  if (!r.valid) return { valid: false, servers: {}, reason: r.reason, path: registryPath };
  return { valid: true, servers: r.servers, reason: null, path: registryPath };
}

// The declared tool set of a server, following one relay hop to the server
// that actually defines the tools (the bridge declares none of its own).
function declaredTools(servers, name) {
  var s = servers[name];
  if (!s) return [];
  if (s.relays && servers[s.relays]) return servers[s.relays].tools.slice();
  return s.tools.slice();
}

function toolKey(server, tool) { return server + '.' + tool; }

module.exports = {
  VERSION: VERSION,
  DEFAULT_REGISTRY_PATH: DEFAULT_REGISTRY_PATH,
  STATUSES: STATUSES,
  DIRECTIONS: DIRECTIONS,
  TRANSPORT_KINDS: TRANSPORT_KINDS,
  CRED_REF_RE: CRED_REF_RE,
  SERVER_NAME_RE: SERVER_NAME_RE,
  TOOL_NAME_RE: TOOL_NAME_RE,
  validateRegistryObject: validateRegistryObject,
  loadRegistry: loadRegistry,
  declaredTools: declaredTools,
  toolKey: toolKey
};
