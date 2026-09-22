#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS HADDAD — HAD-3: probe the installed OTH MCP launcher as a client
// projects/mythos-haddad/bin/haddad-mcp-probe.js
//
//   haddad-mcp-probe.js [launcher] [--call <tool> [json-args]]
//
// Not a client implementation: it drives the EXISTING MYTHOS MCP client
// (projects/mythos-gateway/lib/mcp-client.js, stdio transport) against the
// launcher — initialize, tools/list, then one real tools/call (default:
// execution_status, the Haddad executor chain) — and prints one JSON
// report. Used by haddad-health.js (check id `mcp`) and by the setup
// script's verification; usable by hand.
//
// Why a separate process: the health check is synchronous by design, and
// a stdio MCP server exits when its stdin closes — a client has to keep
// stdin open until the answer arrives, which this does through the shared
// client's bounded request/close lifecycle.
//
// Exit 0 when the handshake and tools/list succeed (the tool call's own
// outcome is in the report — an UNCONFIGURED upstream is a real answer,
// not a probe failure); 1 otherwise. Never prints a credential: nothing
// here reads one.
// =====================================================
var path = require('path');
var os = require('os');
var mcpClient = require(path.join(__dirname, '..', '..', 'mythos-gateway', 'lib', 'mcp-client.js'));

var argv = process.argv.slice(2);
var launcher = argv[0] && argv[0].charAt(0) !== '-' ? argv.shift() : path.join(os.homedir(), '.local', 'bin', 'haddad-mcp-stdio.sh');
var tool = 'execution_status';
var args = {};
var i = argv.indexOf('--call');
if (i !== -1) {
  tool = argv[i + 1] || tool;
  if (argv[i + 2]) { try { args = JSON.parse(argv[i + 2]); } catch (e) { console.error('bad json args'); process.exit(2); } }
}

var report = { launcher: launcher, ok: false, server: null, protocol: null, tools: [], call: { tool: tool, ok: false, error: null, sample: null } };
var client = mcpClient.createStdioClient({ command: launcher, args: [], timeoutMs: 30000 });

client.initialize({ name: 'haddad-mcp-probe', version: '1.0.0' })
  .then(function (init) {
    report.server = init.serverInfo ? init.serverInfo.name + ' ' + init.serverInfo.version : null;
    report.protocol = init.protocolVersion || null;
    return client.listTools();
  })
  .then(function (tools) {
    report.tools = tools.map(function (t) { return t.name; });
    report.ok = true;
    return client.callTool(tool, args);
  })
  .then(function (res) {
    var text = res.content[0] && res.content[0].text || '';
    if (res.isError) { report.call.error = text.slice(0, 200); return; }
    report.call.ok = true;
    try { var j = JSON.parse(text); report.call.sample = Array.isArray(j.tasks) ? { tasks: j.tasks.length } : Object.keys(j).slice(0, 8); }
    catch (e) { report.call.sample = text.slice(0, 80); }
  })
  .catch(function (e) {
    report.error = (e && e.code || 'ERROR') + ': ' + (e && e.message || e);
    var se = client.stderr(); if (se) report.stderr = se.slice(0, 400);
  })
  .then(function () {
    return client.close();
  })
  .then(function () {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exit(report.ok ? 0 : 1);
  });
