#!/usr/bin/env node
// =====================================================
// MYTHOS Browser MCP — governed browser capabilities over stdio
// projects/mythos-browser-mcp/server.js
//
// Three tools, nothing else: navigate, extract, screenshot. Each call opens
// one browser session through lib/browser-adapter.js (Obscura primary,
// Playwright fallback), does its one thing, and closes it. No arbitrary CDP
// is exposed: a client cannot evaluate JavaScript, click, type, or reach any
// DevTools method — the tool surface IS the boundary (the owner declined an
// interaction capability on 2026-09-29; the surface stays read-only).
//
// TRANSPORT: JSON-RPC 2.0 over stdio, newline-delimited, dependency-free,
// exactly like projects/oth-mcp/server.js (initialize, tools/list, tools/call,
// ping). Registered in the estate registry as `browser-mcp` and reached only
// through lib/mcp-invoke.js, which applies the permission matrix, the task's
// resolved capabilities and the audit log before this process sees a call.
//
// SECRETS: OBSCURA_CDP_TOKEN is read by the Obscura backend from this
// process's environment (set by the launcher from a 0600 file), used as a
// bearer toward 127.0.0.1:9222, and never appears in a result, an error or
// a log line. Every error message is passed through redactText() before it
// leaves.
// =====================================================
'use strict';

var readline = require('readline');
var adapterLib = require('./lib/browser-adapter');

var SERVER_NAME = 'mythos-browser-mcp';
var SERVER_VERSION = '1.1.0';
var PROTOCOL_VERSION = '2024-11-05';

var TOOLS = [
  { name: 'navigate', description: 'Open a public http(s) URL in the governed browser and return the final URL, title and load state. No interaction, no scripting.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'absolute http(s) URL' } }, required: ['url'], additionalProperties: false } },
  { name: 'extract', description: 'Open a public http(s) URL and return its visible text (or the text/outerHTML of one CSS selector), bounded by max_chars (default 20000).',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, selector: { type: 'string', description: 'optional CSS selector' }, mode: { type: 'string', enum: ['text', 'html'] }, max_chars: { type: 'integer', minimum: 256, maximum: 200000 } }, required: ['url'], additionalProperties: false } },
  { name: 'screenshot', description: 'Open a public http(s) URL and capture the viewport to a PNG (or JPEG) file in the browser artifacts directory; returns path, bytes and sha256.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, format: { type: 'string', enum: ['png', 'jpeg'] }, inline: { type: 'boolean', description: 'also return base64 when the image is small (<= 64 KiB)' } }, required: ['url'], additionalProperties: false } }
];

var adapter = null;
function getAdapter() { if (!adapter) adapter = adapterLib.createAdapter({ env: process.env }); return adapter; }

function redactText(s) {
  var out = String(s == null ? '' : s);
  var tok = process.env.OBSCURA_CDP_TOKEN;
  if (tok && tok.length >= 8) out = out.split(tok).join('<redacted>');
  // any long hex/base64 run that could be a token
  out = out.replace(/\b[a-f0-9]{32,}\b/gi, '<redacted>');
  return out;
}

function rpcResult(id, result) { return JSON.stringify({ jsonrpc: '2.0', id: id, result: result }); }
function rpcError(id, code, message) { return JSON.stringify({ jsonrpc: '2.0', id: id, error: { code: code, message: redactText(message) } }); }
// Every failure is one machine-readable object: `code` (what), `class`
// (policy | target | timeout | backend — whose fault, per
// BrowserAdapter.classify) and, when engines were tried, each `attempt`'s
// backend, stage and reason — so a caller never has to parse prose.
function toolError(code, message, err) {
  var body = { ok: false, code: code, class: err ? adapterLib.classify(err) : 'request', error: redactText(message) };
  if (err && Array.isArray(err.attempts)) {
    body.attempts = err.attempts.map(function (a) { return { backend: a.backend, ok: !!a.ok, stage: a.stage || null, class: a.class || null, reason: a.reason ? redactText(a.reason) : null }; });
  }
  if (code === 'BROWSER_NO_BACKEND' || code === 'BROWSER_BACKEND_FAILED' || code === 'BROWSER_TIMEOUT') body.class = code === 'BROWSER_TIMEOUT' ? 'timeout' : 'backend';
  if (code === 'NAVIGATE_FAILED') body.class = 'target';
  return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true };
}
function toolOk(obj) { return { content: [{ type: 'text', text: redactText(JSON.stringify(Object.assign({ ok: true }, obj))) }], isError: false }; }

function callTool(name, args) {
  args = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  var a = getAdapter();
  var fn = name === 'navigate' ? a.navigate : name === 'extract' ? a.extract : name === 'screenshot' ? a.screenshot : null;
  if (!fn) return Promise.resolve(toolError('TOOL_UNKNOWN', 'unknown tool ' + String(name).slice(0, 40)));
  var extra = Object.keys(args).filter(function (k) { return TOOLS.find(function (t) { return t.name === name; }).inputSchema.properties[k] === undefined; });
  if (extra.length) return Promise.resolve(toolError('ARGS_UNKNOWN', 'unknown argument(s): ' + extra.join(', ')));
  return Promise.resolve().then(function () { return fn(args); }).then(toolOk, function (err) {
    var code = (err && err.code) || (String(err && err.message || '').split(':')[0] || 'BROWSER_ERROR');
    return toolError(code, (err && err.message) || String(err), err || new Error(String(err)));
  });
}

function handle(msg) {
  var id = msg.id === undefined ? null : msg.id;
  var method = msg.method;
  if (method === 'initialize') {
    return Promise.resolve(rpcResult(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } }));
  }
  if (method === 'ping') return Promise.resolve(rpcResult(id, {}));
  if (method === 'tools/list') return Promise.resolve(rpcResult(id, { tools: TOOLS }));
  if (method === 'tools/call') {
    var p = msg.params || {};
    return callTool(p.name, p.arguments).then(function (r) { return rpcResult(id, r); });
  }
  if (typeof method === 'string' && method.indexOf('notifications/') === 0) return Promise.resolve(null);
  return Promise.resolve(rpcError(id, -32601, 'method not found: ' + String(method).slice(0, 60)));
}

function main() {
  var rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  var chain = Promise.resolve();
  rl.on('line', function (line) {
    line = line.trim();
    if (!line) return;
    var msg;
    try { msg = JSON.parse(line); } catch (e) { process.stdout.write(rpcError(null, -32700, 'parse error') + '\n'); return; }
    chain = chain.then(function () { return handle(msg); }).then(function (out) { if (out) process.stdout.write(out + '\n'); },
      function (e) { process.stdout.write(rpcError(msg.id === undefined ? null : msg.id, -32603, 'internal: ' + (e && e.message)) + '\n'); });
  });
  rl.on('close', function () { chain.then(function () { process.exit(0); }); });
}

if (require.main === module) main();
module.exports = { TOOLS: TOOLS, callTool: callTool, handle: handle, redactText: redactText, SERVER_NAME: SERVER_NAME, SERVER_VERSION: SERVER_VERSION };
