#!/usr/bin/env node
// =====================================================
// MYTHOS MCP HTTP bridge — a TRANSPORT, not a server.
// projects/mythos-gateway/mcp-http-bridge.js
//
// WHAT THIS IS: one adapter that speaks MCP Streamable HTTP on loopback and
// relays, byte for byte, to the EXISTING stdio server launched by
// deployments/oth-mcp/oth-mcp-stdio.sh.
//
// WHAT THIS IS NOT: not a second MCP server. It declares no tool, owns no
// schema, reads no upstream and holds no credential of MYTHOS. Every
// `tools/list` and `tools/call` answer on this port is produced by
// projects/oth-mcp/server.js and returned unmodified. If this file ever
// needs to know what a tool does, it has become the wrong thing.
//
// WHY IT EXISTS: ContextForge federates peers over HTTP. OTH MCP speaks
// stdio and must keep speaking stdio — the SSH launcher stays the supported
// standalone path and is unchanged by this file. The gap is transport only.
//
// WHY NOT `mcpgateway.translate`: the official translator is a Python module
// inside the gateway image; reaching a host-side node process from it would
// mean either installing the full FastAPI dependency tree on the host or
// handing an SSH key to a container. Both add credential surface to solve a
// transport problem. This is ~200 dependency-free lines on the same host,
// under the same account, reading the same launcher.
//
// AUTHORITY: none. It binds loopback only, demands a bearer token that only
// ContextForge holds, and adds no capability the stdio server does not
// already expose. The child is read-only because server.js is read-only.
// =====================================================
'use strict';

var http = require('http');
var crypto = require('crypto');
var { spawn } = require('child_process');

// One listener per address. Loopback serves host-side probes and the
// standalone check; the docker-network gateway address serves ContextForge,
// which cannot reach 127.0.0.1 of the host from inside its container. Both
// are private — nothing here is ever bound to a public interface.
var HOSTS = (process.env.MYTHOS_MCP_HTTP_HOST || '127.0.0.1').split(',').map(function (h) { return h.trim(); }).filter(Boolean);
var PORT = parseInt(process.env.MYTHOS_MCP_HTTP_PORT || '8160', 10);
var LAUNCHER = process.env.MYTHOS_MCP_LAUNCHER || '/home/deploy/deployments/oth-mcp/oth-mcp-stdio.sh';
var TOKEN = process.env.MYTHOS_MCP_HTTP_TOKEN || '';
var MAX_BODY_BYTES = 1024 * 1024;
var CALL_TIMEOUT_MS = 30000;

if (!TOKEN) {
  console.error('mythos-mcp-http: MYTHOS_MCP_HTTP_TOKEN is required — refusing to start unauthenticated');
  process.exit(78);
}

// ------------------------------------------------------------ child process
// One long-lived child, id-multiplexed. Safe because server.js keeps no
// per-session state: every tool resolves to an upstream on each call.

var child = null;
var pending = new Map(); // upstream id -> {resolve, timer}
var nextUpstreamId = 1;
var buf = '';

function startChild() {
  child = spawn('/bin/bash', [LAUNCHER], { stdio: ['pipe', 'pipe', 'pipe'] });
  buf = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', function (chunk) {
    buf += chunk;
    var nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      var line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      var msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      var waiter = pending.get(msg.id);
      if (!waiter) continue;
      pending.delete(msg.id);
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
    }
  });

  // stderr is the child's own diagnostic channel. It is echoed with a prefix
  // and never parsed — the launcher is careful not to print secrets, and this
  // bridge must not become the place that starts.
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', function (d) { process.stderr.write('[oth-mcp] ' + d); });

  child.on('exit', function (code, signal) {
    console.error('mythos-mcp-http: child exited code=' + code + ' signal=' + signal + ' — restarting on next request');
    for (var w of pending.values()) { clearTimeout(w.timer); w.resolve(null); }
    pending.clear();
    child = null;
  });
}

function ensureChild() { if (!child || child.killed) startChild(); }

// Relay one JSON-RPC request and wait for the matching reply. The client's
// own id is restored on the way back so the caller never sees our numbering.
function relay(msg) {
  return new Promise(function (resolve) {
    ensureChild();
    var clientId = msg.id;
    var upstreamId = nextUpstreamId++;
    var out = Object.assign({}, msg, { id: upstreamId });
    var timer = setTimeout(function () {
      pending.delete(upstreamId);
      resolve({ jsonrpc: '2.0', id: clientId, error: { code: -32001, message: 'oth-mcp did not answer within ' + CALL_TIMEOUT_MS + 'ms' } });
    }, CALL_TIMEOUT_MS);
    pending.set(upstreamId, {
      resolve: function (reply) {
        if (reply === null) return resolve({ jsonrpc: '2.0', id: clientId, error: { code: -32001, message: 'oth-mcp child terminated' } });
        resolve(Object.assign({}, reply, { id: clientId }));
      },
      timer: timer,
    });
    try { child.stdin.write(JSON.stringify(out) + '\n'); }
    catch (e) {
      pending.delete(upstreamId); clearTimeout(timer);
      resolve({ jsonrpc: '2.0', id: clientId, error: { code: -32001, message: 'oth-mcp stdin unavailable' } });
    }
  });
}

// A notification has no id and expects no reply — it is forwarded and dropped.
function relayNotification(msg) {
  ensureChild();
  try { child.stdin.write(JSON.stringify(msg) + '\n'); } catch (e) { /* the child restarts on the next request */ }
}

// ------------------------------------------------------------------- server

// Constant-time compare so a wrong token leaks no timing signal.
function tokenOk(header) {
  if (typeof header !== 'string') return false;
  var m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  var a = Buffer.from(m[1]);
  var b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function send(res, status, obj, headers) {
  var body = obj === null ? '' : JSON.stringify(obj);
  var h = Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers || {});
  if (body === '') delete h['Content-Type'];
  res.writeHead(status, h);
  res.end(body);
}

function handleRequest(req, res) {
  var url = req.url.split('?')[0];

  // Liveness only. It states that the bridge process is up — never that an
  // upstream is healthy. system_health is the tool that answers that, and it
  // has an owner. This endpoint is unauthenticated because it reveals nothing.
  if (req.method === 'GET' && url === '/health') {
    return send(res, 200, { status: 'ok', service: 'mythos-mcp-http', child: child ? 'running' : 'idle' });
  }

  if (url !== '/mcp' && url !== '/mcp/') return send(res, 404, { error: 'not found' });

  if (!tokenOk(req.headers.authorization)) {
    return send(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
  }

  // The standalone SSE stream is optional in the Streamable HTTP transport.
  // This bridge answers every request on its own POST, so it declines the
  // stream explicitly rather than holding a connection that carries nothing.
  if (req.method === 'GET') return send(res, 405, { error: 'this transport does not open a standalone stream' }, { Allow: 'POST, DELETE' });
  if (req.method === 'DELETE') return send(res, 200, { status: 'session released' });
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { Allow: 'POST, DELETE' });

  var chunks = [], size = 0, aborted = false;
  req.on('data', function (c) {
    size += c.length;
    if (size > MAX_BODY_BYTES) { aborted = true; send(res, 413, { error: 'body too large' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', async function () {
    if (aborted) return;
    var payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch (e) { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }

    var batch = Array.isArray(payload) ? payload : [payload];
    var requests = batch.filter(function (m) { return m && m.id !== undefined && m.id !== null; });
    var notifications = batch.filter(function (m) { return m && (m.id === undefined || m.id === null); });

    notifications.forEach(relayNotification);

    // Notifications only: the spec's answer is 202 with no body.
    if (requests.length === 0) return send(res, 202, null);

    var replies = await Promise.all(requests.map(relay));
    var headers = {};
    if (requests.some(function (m) { return m.method === 'initialize'; })) {
      headers['Mcp-Session-Id'] = crypto.randomUUID();
    }
    return send(res, 200, Array.isArray(payload) ? replies : replies[0], headers);
  });
}

var servers = HOSTS.map(function (h) {
  var s = http.createServer(handleRequest);
  s.listen(PORT, h, function () {
    console.error('mythos-mcp-http: listening on http://' + h + ':' + PORT + '/mcp (relaying ' + LAUNCHER + ')');
  });
  s.on('error', function (e) {
    console.error('mythos-mcp-http: cannot bind ' + h + ':' + PORT + ' — ' + e.message);
    process.exit(75);
  });
  return s;
});

function shutdown() {
  servers.forEach(function (s) { s.close(); });
  if (child) child.kill();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
