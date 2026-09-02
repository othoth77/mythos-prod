'use strict';
// =====================================================
// Mythos AI Executor — governed MCP invocation (MCP-ECOSYSTEM-1)
// projects/mythos-ai-executor/lib/mcp-invoke.js
//
// The Executor is MYTHOS' only execution engine, so this is where an MCP
// tool is actually CALLED on the platform's behalf. M-12 built the
// governance half (lib/mcp-capabilities.js: which server.tool a skill may
// name) and left "a real MCP client" as a distinct, later change. This is
// that change, and it adds no authority of its own: every call passes,
// in order,
//
//   1. the estate registry        — is the server registered and enabled
//   2. the permission matrix      — may THIS subject name THAT tool
//      (CONTROLLED ⇒ a recorded, GRANTED, unconsumed approval is required)
//   3. outbound capability gate   — a server governed by mcp-capabilities
//      is callable only from a task whose resolved capabilities name the tool
//   4. the declared tool set      — an undeclared tool is not callable here
//   5. the Vault reference        — the credential is resolved by NAME from
//      this process' own environment and used for one header; the caller
//      never receives it (MYTHOS_VAULT_ARCHITECTURE §6: broker, do not dispense)
//   6. the transport              — bounded by timeout and size
//   7. verification               — a result is a content array with
//      isError false, or it is an execution error, never a silent success
//   8. audit                      — every outcome, including every denial,
//      is appended to the MCP audit log through the redact layer
//
// The subject is FIXED to 'executor'. A caller may describe itself
// (requested_by) and that is recorded, but it grants nothing: the matrix
// row that applies is the executor's own, because the executor is what
// is acting.
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var os = require('os');

var state = require('./state');
var redact = require('../../mythos-orchestrator/lib/redact');
var registryLib = require('../../mythos-gateway/lib/mcp-registry');
var policyLib = require('../../mythos-gateway/lib/mcp-policy');
var clientLib = require('../../mythos-gateway/lib/mcp-client');
var inventoryLib = require('../../mythos-vault/lib/inventory');
var store = require('../core/store');

var VERSION = '1.0.0';
var SUBJECT = 'executor';
var AGENT = 'mythos-ai-executor';
var DEFAULT_TIMEOUT_MS = 30000;
var MAX_ARGS_BYTES = 64 * 1024;
var MAX_RESULT_BYTES = 512 * 1024;
var APPROVAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
var SERVER_RE = registryLib.SERVER_NAME_RE;
var TOOL_RE = registryLib.TOOL_NAME_RE;
var APPROVAL_RE = /^[a-z0-9][a-z0-9-]{3,63}$/;

var HTTP_STATUS = {
  MCP_INPUT: 400, MCP_REGISTRY_INVALID: 500, MCP_SERVER_UNREGISTERED: 404, MCP_SERVER_DISABLED: 409,
  MCP_DENIED: 403, MCP_APPROVAL_REQUIRED: 403, MCP_APPROVAL_INVALID: 403, MCP_CAPABILITY_NOT_RESOLVED: 403,
  MCP_TOOL_UNREGISTERED: 404, MCP_CREDENTIAL_UNAVAILABLE: 503, MCP_UNREACHABLE: 503, MCP_TRANSPORT_CLOSED: 503,
  MCP_UNAUTHORIZED: 502, MCP_TIMEOUT: 504, MCP_TOOL_ERROR: 502, MCP_BAD_RESPONSE: 502, MCP_RPC_ERROR: 502,
  MCP_HTTP_ERROR: 502, MCP_RESPONSE_TOO_LARGE: 502
};

function auditPath() { return process.env.MYTHOS_MCP_AUDIT_FILE || path.join(state.root(), 'orchestration', 'mcp-audit.jsonl'); }
function statusFile() { return process.env.MYTHOS_MCP_STATUS_FILE || '/home/deploy/deployments/mythos-gateway/mcp-registry-status.json'; }

function appendAudit(entry) {
  var file = auditPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, JSON.stringify(redact.redactValue(entry)) + '\n', { encoding: 'utf8', mode: 0o600 });
}

function newAuditId() { return 'mcpa-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'); }

function str(v, max) { return typeof v === 'string' && v.length && v.length <= max ? v : null; }

// A GRANTED approval whose action_class is exactly 'mcp:<capability>',
// decided by a human within 24 h, and never consumed. One approval, one
// call: it is marked consumed on use so it cannot be replayed.
function verifyApproval(approvalId, capability, auditId) {
  var approval;
  try { approval = store.load('approval', approvalId); } catch (e) { approval = null; }
  if (!approval) return { ok: false, reason: 'no such approval' };
  if (approval.status !== 'GRANTED') return { ok: false, reason: 'approval is ' + approval.status };
  if (approval.action_class !== 'mcp:' + capability) return { ok: false, reason: 'approval is for ' + approval.action_class + ', not mcp:' + capability };
  if (!approval.decided_by) return { ok: false, reason: 'approval records no decider' };
  if (!approval.decided_at || Date.now() - new Date(approval.decided_at).getTime() > APPROVAL_MAX_AGE_MS) return { ok: false, reason: 'approval is older than 24h' };
  if (approval.consumed_at) return { ok: false, reason: 'approval already consumed by ' + approval.consumed_by };
  approval.consumed_at = new Date().toISOString();
  approval.consumed_by = auditId;
  store.save(approval);
  return { ok: true, decided_by: approval.decided_by };
}

function openClient(server, token, timeoutMs) {
  if (server.transport.kind === 'stdio') {
    return clientLib.createStdioClient({ command: '/bin/bash', args: [server.transport.launcher], timeoutMs: timeoutMs, maxBytes: MAX_RESULT_BYTES });
  }
  var url = server.transport.kind === 'gateway-http' ? (server.transport.mcp_url || server.transport.url + '/mcp') : server.transport.url;
  return clientLib.createHttpClient({ url: url, token: token, timeoutMs: timeoutMs, maxBytes: MAX_RESULT_BYTES });
}

// request: { server, tool, arguments, task_id, approval_id, requested_by }
// opts:    { registryPath, permissionsPath, inventoryPath, timeoutMs, env }
function invoke(request, opts) {
  opts = opts || {};
  var started = Date.now();
  var auditId = newAuditId();
  var env = opts.env || process.env;
  var req = request && typeof request === 'object' ? request : {};

  var audit = {
    ts: new Date().toISOString(), audit_id: auditId, actor: str(req.requested_by, 64) || 'unspecified', agent: AGENT,
    subject: SUBJECT, server: str(req.server, 64), tool: str(req.tool, 64), action: null, target: null,
    task_id: str(req.task_id, 64), approval_id: str(req.approval_id, 64),
    authorization: { decision: null, capability: null, reason: null },
    execution: { ok: false, status: 'NOT_ATTEMPTED', latency_ms: null },
    error: null
  };

  function finish(out) {
    audit.execution.latency_ms = Date.now() - started;
    if (!out.ok) { audit.error = { code: out.code, message: out.message }; }
    audit.execution.ok = out.ok;
    audit.execution.status = out.status;
    try { appendAudit(audit); } catch (e) { out.audit_error = 'audit write failed: ' + e.code; }
    if (audit.task_id && state.isValidTaskId(audit.task_id)) {
      try {
        state.appendEvent(audit.task_id, 'mcp_invoke', {
          audit_id: auditId, server: audit.server, tool: audit.tool, decision: audit.authorization.decision,
          capability: audit.authorization.capability, ok: out.ok, status: out.status, code: out.code || null
        });
      } catch (e) { /* the audit log is the record of truth; the task event is a courtesy */ }
    }
    out.audit_id = auditId;
    out.http_status = out.ok ? 200 : (HTTP_STATUS[out.code] || 500);
    return out;
  }
  function refuse(code, message, status) {
    return Promise.resolve(finish({ ok: false, code: code, message: message, status: status || 'DENIED' }));
  }

  // ---- 0. input
  if (!SERVER_RE.test(String(req.server || ''))) return refuse('MCP_INPUT', 'server must match ' + SERVER_RE.source, 'INVALID');
  if (!TOOL_RE.test(String(req.tool || ''))) return refuse('MCP_INPUT', 'tool must match ' + TOOL_RE.source, 'INVALID');
  var args = req.arguments === undefined ? {} : req.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return refuse('MCP_INPUT', 'arguments must be an object', 'INVALID');
  var argText;
  try { argText = JSON.stringify(args); } catch (e) { return refuse('MCP_INPUT', 'arguments must be JSON-serialisable', 'INVALID'); }
  if (Buffer.byteLength(argText) > MAX_ARGS_BYTES) return refuse('MCP_INPUT', 'arguments exceed ' + MAX_ARGS_BYTES + ' bytes', 'INVALID');
  if (redact.findSecretKinds(argText).length) return refuse('MCP_INPUT', 'arguments carry secret-shaped content and were refused', 'INVALID');
  if (req.task_id !== undefined && req.task_id !== null && !state.isValidTaskId(req.task_id)) return refuse('MCP_INPUT', 'task_id is not a valid task id', 'INVALID');
  if (req.approval_id !== undefined && req.approval_id !== null && !APPROVAL_RE.test(String(req.approval_id))) return refuse('MCP_INPUT', 'approval_id is malformed', 'INVALID');
  if (req.requested_by !== undefined && req.requested_by !== null && !str(req.requested_by, 64)) return refuse('MCP_INPUT', 'requested_by must be a string of at most 64 characters', 'INVALID');

  // ---- 1. registry
  var registry = registryLib.loadRegistry(opts.registryPath);
  if (!registry.valid) return refuse('MCP_REGISTRY_INVALID', 'estate registry invalid: ' + registry.reason, 'ERROR');
  var server = registry.servers[req.server];
  if (!server) return refuse('MCP_SERVER_UNREGISTERED', 'server ' + req.server + ' is not registered', 'UNAVAILABLE');
  audit.target = server.transport.kind + ':' + req.server;
  if (!server.enabled) return refuse('MCP_SERVER_DISABLED', 'server ' + req.server + ' is registered but disabled' + (server.enabled_note ? ' — ' + server.enabled_note : ''), 'UNAVAILABLE');

  // ---- 2. permission matrix
  var perms = policyLib.loadPermissions(opts.permissionsPath);
  var decision = policyLib.authorize(perms.valid ? perms.policy : null, { subject: SUBJECT, server: req.server, tool: req.tool });
  audit.authorization = { decision: decision.decision, capability: decision.capability, reason: decision.reason };
  audit.action = decision.capability;
  if (decision.decision === 'DENY') return refuse('MCP_DENIED', decision.reason, 'DENIED');
  if (decision.decision === 'CONTROLLED') {
    if (!req.approval_id) return refuse('MCP_APPROVAL_REQUIRED', decision.capability + ' is CONTROLLED: a granted approval (action_class mcp:' + decision.capability + ') is required', 'DENIED');
    var ap = verifyApproval(req.approval_id, decision.capability, auditId);
    if (!ap.ok) return refuse('MCP_APPROVAL_INVALID', ap.reason, 'DENIED');
    audit.authorization.approved_by = ap.decided_by;
  }

  // ---- 3. outbound capability gate (M-12)
  if (server.outbound_capability_server) {
    var spec = server.outbound_capability_server + '.' + req.tool;
    if (!req.task_id) return refuse('MCP_CAPABILITY_NOT_RESOLVED', req.server + ' is governed by mcp-capabilities: a task whose resolved capabilities include ' + spec + ' is required', 'DENIED');
    var task = null;
    try { task = state.readJSON(req.task_id, 'task.json'); } catch (e) { task = null; }
    if (!task) return refuse('MCP_CAPABILITY_NOT_RESOLVED', 'task ' + req.task_id + ' not found', 'DENIED');
    if (!Array.isArray(task.mcp_capabilities) || task.mcp_capabilities.indexOf(spec) === -1) {
      return refuse('MCP_CAPABILITY_NOT_RESOLVED', 'task ' + req.task_id + ' did not resolve ' + spec, 'DENIED');
    }
  }

  // ---- 4. declared tool set
  var declared = registryLib.declaredTools(registry.servers, req.server);
  if (declared.length && declared.indexOf(req.tool) === -1) return refuse('MCP_TOOL_UNREGISTERED', req.tool + ' is not a declared tool of ' + req.server, 'UNAVAILABLE');

  // ---- 5. credential by reference, from this process' own environment
  var token = null;
  if (server.auth && server.auth.required && server.auth.scheme !== 'host-access') {
    var inventory = inventoryLib.loadInventory(opts.inventoryPath);
    token = server.auth.credential ? inventoryLib.valueFromEnv(inventory, server.auth.credential, env) : null;
    if (!token) return refuse('MCP_CREDENTIAL_UNAVAILABLE', 'credential ' + (server.auth.credential || '(none named)') + ' is not available to the executor', 'UNAUTHORIZED');
  }

  // ---- 6/7. call and verify
  var timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  var client;
  try { client = openClient(server, token, timeoutMs); }
  catch (e) { return refuse('MCP_UNREACHABLE', 'cannot open transport: ' + e.message, 'UNAVAILABLE'); }
  token = null;
  var callStarted = Date.now();
  return client.initialize({ name: AGENT + '/mcp-invoke', version: VERSION })
    .then(function () { return client.callTool(req.tool, args); })
    .then(function (result) {
      var text = JSON.stringify(result);
      if (Buffer.byteLength(text) > MAX_RESULT_BYTES) throw clientLib.fail(clientLib.CODES.TOO_LARGE, 'tool result exceeded ' + MAX_RESULT_BYTES + ' bytes');
      var out = { ok: !result.isError, latency_ms: Date.now() - callStarted, content: result.content };
      if (result.isError) {
        var first = result.content.filter(function (c) { return c && c.type === 'text'; })[0];
        out.code = 'MCP_TOOL_ERROR';
        out.message = first ? String(first.text).slice(0, 400) : 'tool reported an error';
        out.status = 'TOOL_ERROR';
      } else {
        out.status = 'OK';
      }
      return out;
    })
    .catch(function (err) {
      var code = err && err.code && /^MCP_/.test(err.code) ? err.code : 'MCP_BAD_RESPONSE';
      var status = code === clientLib.CODES.UNAUTHORIZED ? 'UNAUTHORIZED'
        : (code === clientLib.CODES.UNREACHABLE || code === clientLib.CODES.TRANSPORT_CLOSED) ? 'UNAVAILABLE'
        : code === clientLib.CODES.TIMEOUT ? 'TIMEOUT' : 'ERROR';
      return { ok: false, code: code, message: String(err && err.message || 'failed').slice(0, 400), status: status };
    })
    .then(function (out) { return Promise.resolve(client.close()).catch(function () { return null; }).then(function () { return finish(out); }); });
}

// What the executor can say about MCP without calling anything: the
// registry it consults (metadata only, no path, no URL) and the latest
// measured snapshot if the registry check has written one.
function describeRegistry(opts) {
  opts = opts || {};
  var registry = registryLib.loadRegistry(opts.registryPath);
  var perms = policyLib.loadPermissions(opts.permissionsPath);
  var snapshot = null;
  try { snapshot = JSON.parse(fs.readFileSync(opts.statusFile || statusFile(), 'utf8')); } catch (e) { snapshot = null; }
  var servers = [];
  if (registry.valid) {
    Object.keys(registry.servers).forEach(function (name) {
      var s = registry.servers[name];
      var measured = snapshot && snapshot.servers && snapshot.servers[name] ? snapshot.servers[name] : null;
      servers.push({
        name: name, purpose: s.purpose, direction: s.direction, transport: s.transport.kind, version: s.version || null,
        enabled: s.enabled, write_capable: s.write_capable, auth_required: !!(s.auth && s.auth.required),
        credential_ref: s.auth && s.auth.credential ? s.auth.credential : null,
        governed_by_capabilities: s.outbound_capability_server || null,
        tools: registryLib.declaredTools(registry.servers, name).map(function (t) {
          var d = policyLib.authorize(perms.valid ? perms.policy : null, { subject: SUBJECT, server: name, tool: t });
          return { name: t, capability: d.capability, decision: d.decision, requires_approval: d.requires_approval,
            available: measured ? measured.tools_discovered.indexOf(t) !== -1 : null };
        }),
        status: measured ? measured.status : null,
        checked_at: snapshot ? snapshot.generated_at : null
      });
    });
  }
  return {
    subject: SUBJECT, registry_valid: registry.valid, registry_reason: registry.reason,
    permissions_valid: perms.valid, permissions_reason: perms.reason,
    snapshot_present: !!snapshot, snapshot_generated_at: snapshot ? snapshot.generated_at : null,
    servers: servers, audit_file: auditPath(), host: os.hostname()
  };
}

module.exports = { VERSION: VERSION, SUBJECT: SUBJECT, invoke: invoke, describeRegistry: describeRegistry, auditPath: auditPath, verifyApproval: verifyApproval, HTTP_STATUS: HTTP_STATUS };
