'use strict';
// =====================================================
// MYTHOS MCP client — transport only
// projects/mythos-gateway/lib/mcp-client.js
//
// Dependency-free JSON-RPC 2.0 client for the two transports MYTHOS runs:
// newline-delimited stdio (a spawned launcher) and Streamable HTTP (POST
// /mcp with a bearer, Mcp-Session-Id echoed back, JSON or SSE answers).
// Three methods matter — initialize, tools/list, tools/call — the same
// three the OTH MCP server implements. The official SDK's 91-package
// footprint was measured and declined for the reason recorded in
// projects/oth-mcp/README.md; this is the client half of that decision.
//
// HOLDS NO POLICY. It does not know which tool is allowed, it does not
// resolve a credential, and it never logs one: the token it is handed is
// used for exactly one Authorization header and is not kept anywhere
// else. Governance lives in projects/mythos-ai-executor/lib/mcp-invoke.js;
// measurement in bin/mcp-registry-check.
//
// EVERY WAIT IS BOUNDED (timeoutMs) and every body is bounded (maxBytes).
// A transport that stops answering is reported as MCP_TIMEOUT, one that
// closes as MCP_TRANSPORT_CLOSED, one that refuses as MCP_UNAUTHORIZED —
// distinct facts, distinct codes, so a caller never has to guess.
// =====================================================

var http = require('http');
var https = require('https');
var spawn = require('child_process').spawn;
var URL = require('url').URL;

var PROTOCOL_VERSION = '2024-11-05';
var DEFAULT_TIMEOUT_MS = 30000;
var DEFAULT_MAX_BYTES = 1024 * 1024;
var STDERR_CAP = 8192;

var CODES = {
  UNREACHABLE: 'MCP_UNREACHABLE',
  UNAUTHORIZED: 'MCP_UNAUTHORIZED',
  TIMEOUT: 'MCP_TIMEOUT',
  BAD_RESPONSE: 'MCP_BAD_RESPONSE',
  TRANSPORT_CLOSED: 'MCP_TRANSPORT_CLOSED',
  TOO_LARGE: 'MCP_RESPONSE_TOO_LARGE',
  RPC_ERROR: 'MCP_RPC_ERROR',
  HTTP_ERROR: 'MCP_HTTP_ERROR'
};

function fail(code, message, extra) {
  var e = new Error(message);
  e.code = code;
  if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
  return e;
}

// The shared surface both transports expose.
function api(impl) {
  return {
    kind: impl.kind,
    request: impl.request,
    notify: impl.notify,
    close: impl.close,
    stderr: impl.stderr || function () { return ''; },
    sessionId: impl.sessionId || function () { return null; },
    initialize: function (clientInfo) {
      return impl.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: clientInfo || { name: 'mythos-mcp-client', version: '1.0.0' }
      }).then(function (res) {
        impl.notify('notifications/initialized');
        return res;
      });
    },
    listTools: function () {
      return impl.request('tools/list').then(function (res) {
        if (!res || !Array.isArray(res.tools)) throw fail(CODES.BAD_RESPONSE, 'tools/list returned no tools array');
        return res.tools;
      });
    },
    callTool: function (name, args) {
      return impl.request('tools/call', { name: name, arguments: args || {} }).then(function (res) {
        if (!res || !Array.isArray(res.content)) throw fail(CODES.BAD_RESPONSE, 'tools/call returned no content array');
        return res;
      });
    }
  };
}

// ---------------------------------------------------------------- stdio

function createStdioClient(opts) {
  var timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  var maxBytes = opts.maxBytes || DEFAULT_MAX_BYTES;
  var child = spawn(opts.command, opts.args || [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: opts.env || process.env,
    cwd: opts.cwd
  });
  var pending = new Map();
  var nextId = 1;
  var buf = '';
  var stderr = '';
  var closed = false;
  var closeErr = null;

  function flush() {
    pending.forEach(function (w) { clearTimeout(w.timer); w.reject(closeErr); });
    pending.clear();
  }

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', function (chunk) {
    buf += chunk;
    if (buf.length > maxBytes) {
      closeErr = fail(CODES.TOO_LARGE, 'stdio reply exceeded ' + maxBytes + ' bytes');
      closed = true; flush(); try { child.kill(); } catch (e) { /* already gone */ }
      return;
    }
    var nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      var line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      var msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      if (!msg || msg.id === undefined || !pending.has(msg.id)) continue;
      var w = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(w.timer);
      if (msg.error) w.reject(fail(CODES.RPC_ERROR, (msg.error && msg.error.message) || 'rpc error', { rpc: msg.error }));
      else w.resolve(msg.result);
    }
  });
  // The child's diagnostics are captured (bounded) for the caller to
  // inspect on failure — never written anywhere by this module.
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', function (d) { if (stderr.length < STDERR_CAP) stderr += d.slice(0, STDERR_CAP - stderr.length); });
  child.on('error', function (err) {
    closed = true;
    closeErr = fail(CODES.UNREACHABLE, 'cannot start MCP process: ' + err.message);
    flush();
  });
  child.on('exit', function (code, signal) {
    closed = true;
    if (!closeErr) closeErr = fail(CODES.TRANSPORT_CLOSED, 'MCP process exited (code=' + code + ' signal=' + signal + ')');
    flush();
  });

  function request(method, params) {
    return new Promise(function (resolve, reject) {
      if (closed) return reject(closeErr || fail(CODES.TRANSPORT_CLOSED, 'MCP process closed'));
      var id = nextId++;
      var timer = setTimeout(function () {
        pending.delete(id);
        reject(fail(CODES.TIMEOUT, method + ' did not answer within ' + timeoutMs + 'ms'));
      }, timeoutMs);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params || {} }) + '\n'); }
      catch (e) { pending.delete(id); clearTimeout(timer); reject(fail(CODES.TRANSPORT_CLOSED, 'stdin unavailable')); }
    });
  }
  function notify(method, params) {
    if (closed) return;
    try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: method, params: params || {} }) + '\n'); }
    catch (e) { /* the exit handler reports it */ }
  }
  function close() {
    if (closed) return Promise.resolve();
    try { child.stdin.end(); } catch (e) { /* already closed */ }
    var t = setTimeout(function () { try { child.kill(); } catch (e) { /* gone */ } }, 500);
    if (t.unref) t.unref();
    return Promise.resolve();
  }
  return api({ kind: 'stdio', request: request, notify: notify, close: close, stderr: function () { return stderr; } });
}

// ------------------------------------------------------- streamable http

function parseSse(text, id) {
  var found = null;
  text.split(/\r?\n\r?\n/).forEach(function (block) {
    var data = block.split(/\r?\n/)
      .filter(function (l) { return l.indexOf('data:') === 0; })
      .map(function (l) { return l.slice(5).trim(); })
      .join('\n');
    if (!data) return;
    try {
      var m = JSON.parse(data);
      if (m && m.id === id) found = m;
    } catch (e) { /* not a JSON event */ }
  });
  return found;
}

function createHttpClient(opts) {
  var url = new URL(opts.url);
  var mod = url.protocol === 'https:' ? https : http;
  var timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  var maxBytes = opts.maxBytes || DEFAULT_MAX_BYTES;
  var token = opts.token || null;
  var sessionId = null;
  var nextId = 1;

  function baseHeaders() {
    var h = { Accept: 'application/json, text/event-stream' };
    if (token) h.Authorization = 'Bearer ' + token;
    if (sessionId) h['Mcp-Session-Id'] = sessionId;
    Object.keys(opts.headers || {}).forEach(function (k) { h[k] = opts.headers[k]; });
    return h;
  }

  function post(payload, expectReply) {
    return new Promise(function (resolve, reject) {
      var body = JSON.stringify(payload);
      var headers = baseHeaders();
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
      var req = mod.request({
        method: 'POST', hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search, headers: headers, timeout: timeoutMs
      }, function (res) {
        var chunks = []; var size = 0; var tooBig = false;
        res.on('data', function (c) {
          size += c.length;
          if (size > maxBytes) { tooBig = true; res.destroy(); return; }
          chunks.push(c);
        });
        res.on('error', function (err) { reject(fail(CODES.UNREACHABLE, err.message)); });
        res.on('end', function () {
          if (tooBig) return reject(fail(CODES.TOO_LARGE, 'response exceeded ' + maxBytes + ' bytes'));
          var sid = res.headers['mcp-session-id'];
          if (sid) sessionId = String(sid);
          if (res.statusCode === 401 || res.statusCode === 403) return reject(fail(CODES.UNAUTHORIZED, 'server answered ' + res.statusCode, { status: res.statusCode }));
          if (res.statusCode === 202 || (res.statusCode === 200 && !expectReply)) return resolve(null);
          if (res.statusCode >= 400) return reject(fail(CODES.HTTP_ERROR, 'server answered ' + res.statusCode, { status: res.statusCode }));
          var text = Buffer.concat(chunks).toString('utf8');
          var ctype = String(res.headers['content-type'] || '');
          var msg = null;
          if (/text\/event-stream/i.test(ctype)) {
            msg = parseSse(text, payload.id);
          } else {
            try { msg = JSON.parse(text); } catch (e) { return reject(fail(CODES.BAD_RESPONSE, 'server did not return JSON')); }
            if (Array.isArray(msg)) msg = msg.filter(function (m) { return m && m.id === payload.id; })[0] || null;
          }
          if (!msg) return reject(fail(CODES.BAD_RESPONSE, 'no reply for request id ' + payload.id));
          if (msg.error) return reject(fail(CODES.RPC_ERROR, (msg.error && msg.error.message) || 'rpc error', { rpc: msg.error }));
          resolve(msg.result);
        });
      });
      req.on('timeout', function () { req.destroy(); reject(fail(CODES.TIMEOUT, payload.method + ' did not answer within ' + timeoutMs + 'ms')); });
      req.on('error', function (err) { reject(fail(CODES.UNREACHABLE, 'unreachable: ' + (err.code || err.message))); });
      req.end(body);
    });
  }

  function request(method, params) { return post({ jsonrpc: '2.0', id: nextId++, method: method, params: params || {} }, true); }
  function notify(method, params) { return post({ jsonrpc: '2.0', method: method, params: params || {} }, false).catch(function () { return null; }); }
  function close() {
    if (!sessionId) return Promise.resolve();
    return new Promise(function (resolve) {
      var req = mod.request({
        method: 'DELETE', hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search, headers: baseHeaders(), timeout: 5000
      }, function (res) { res.resume(); res.on('end', resolve); res.on('error', resolve); });
      req.on('error', function () { resolve(); });
      req.on('timeout', function () { req.destroy(); resolve(); });
      req.end();
    });
  }
  return api({ kind: 'streamable-http', request: request, notify: notify, close: close, sessionId: function () { return sessionId; } });
}

module.exports = {
  PROTOCOL_VERSION: PROTOCOL_VERSION,
  DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
  CODES: CODES,
  createStdioClient: createStdioClient,
  createHttpClient: createHttpClient,
  parseSse: parseSse,
  fail: fail
};
