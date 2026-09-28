'use strict';
// =====================================================
// MYTHOS Browser MCP — minimal RFC 6455 WebSocket client
// projects/mythos-browser-mcp/lib/ws-min.js
//
// WHY NOT the global WebSocket (undici): the WHATWG constructor cannot send
// custom request headers, and the CDP endpoint is authenticated with a
// bearer header. A CDP session needs exactly: text frames both ways, ping/
// pong, close, and payloads up to a few megabytes (a screenshot). That is
// ~150 lines over http.request, dependency-free like the rest of the estate.
// Not a general WebSocket: no extensions, no subprotocols, no binary API.
// =====================================================
var http = require('http');
var https = require('https');
var crypto = require('crypto');
var { URL } = require('url');

var GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
var DEFAULT_MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

function mask(payload) {
  var key = crypto.randomBytes(4);
  var out = Buffer.allocUnsafe(payload.length);
  for (var i = 0; i < payload.length; i++) out[i] = payload[i] ^ key[i & 3];
  return { key: key, data: out };
}

function frame(opcode, payload) {
  payload = payload || Buffer.alloc(0);
  var m = mask(payload);
  var len = payload.length;
  var header;
  if (len < 126) { header = Buffer.allocUnsafe(2); header[1] = 0x80 | len; }
  else if (len < 65536) { header = Buffer.allocUnsafe(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.allocUnsafe(10); header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, m.key, m.data]);
}

// connect(url, { headers, timeoutMs, maxMessageBytes }) -> Promise<conn>
// conn: send(text), onMessage(fn), onClose(fn), close(code), readyState
function connect(url, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var u;
    try { u = new URL(url); } catch (e) { return reject(new Error('WS_URL: not a URL')); }
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return reject(new Error('WS_URL: scheme must be ws or wss'));
    var key = crypto.randomBytes(16).toString('base64');
    var headers = Object.assign({
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key
    }, opts.headers || {});
    var mod = u.protocol === 'wss:' ? https : http;
    var settled = false;
    var req = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'wss:' ? 443 : 80),
      path: u.pathname + u.search, method: 'GET', headers: headers, timeout: opts.timeoutMs || 10000
    });
    req.on('timeout', function () { req.destroy(new Error('WS_TIMEOUT: no upgrade within the timeout')); });
    req.on('error', function (e) { if (!settled) { settled = true; reject(new Error('WS_CONNECT: ' + e.message)); } });
    req.on('response', function (res) {
      if (!settled) { settled = true; reject(new Error('WS_UPGRADE_REFUSED: HTTP ' + res.statusCode)); }
      res.resume();
    });
    req.on('upgrade', function (res, socket, head) {
      var expect = crypto.createHash('sha1').update(key + GUID).digest('base64');
      if (res.headers['sec-websocket-accept'] !== expect) {
        socket.destroy();
        if (!settled) { settled = true; reject(new Error('WS_UPGRADE_BAD_ACCEPT')); }
        return;
      }
      settled = true;
      resolve(wrap(socket, head, opts));
    });
    req.end();
  });
}

function wrap(socket, head, opts) {
  var maxBytes = opts.maxMessageBytes || DEFAULT_MAX_MESSAGE_BYTES;
  var buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
  var fragments = [];
  var fragOpcode = 0;
  var messageHandlers = [];
  var closeHandlers = [];
  var closed = false;
  var conn = {
    readyState: 'open',
    send: function (text) {
      if (closed) throw new Error('WS_CLOSED');
      socket.write(frame(0x1, Buffer.from(String(text), 'utf8')));
    },
    onMessage: function (fn) { messageHandlers.push(fn); },
    onClose: function (fn) { closeHandlers.push(fn); },
    close: function (code) {
      if (closed) return;
      var p = Buffer.allocUnsafe(2); p.writeUInt16BE(code || 1000, 0);
      try { socket.write(frame(0x8, p)); } catch (e) { /* closing anyway */ }
      setTimeout(function () { try { socket.destroy(); } catch (e) { /* gone */ } }, 200);
    }
  };
  function emitClose(reason) {
    if (closed) return;
    closed = true; conn.readyState = 'closed';
    closeHandlers.forEach(function (fn) { try { fn(reason); } catch (e) { /* listener error */ } });
  }
  socket.setNoDelay(true);
  socket.on('data', function (chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    // parse as many complete frames as the buffer holds
    for (;;) {
      if (buf.length < 2) return;
      var b0 = buf[0], b1 = buf[1];
      var fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      var len = b1 & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; var hi = buf.readUInt32BE(2), lo = buf.readUInt32BE(6); len = hi * 4294967296 + lo; off = 10; }
      if (masked) off += 4;
      if (len > maxBytes) { socket.destroy(); emitClose('WS_MESSAGE_TOO_LARGE'); return; }
      if (buf.length < off + len) return;
      var payload = buf.slice(off, off + len);
      if (masked) { var k = buf.slice(off - 4, off); var un = Buffer.allocUnsafe(len); for (var i = 0; i < len; i++) un[i] = payload[i] ^ k[i & 3]; payload = un; }
      buf = buf.slice(off + len);
      if (opcode === 0x8) { conn.close(1000); emitClose('peer closed'); return; }
      if (opcode === 0x9) { try { socket.write(frame(0xA, payload)); } catch (e) { /* closing */ } continue; }
      if (opcode === 0xA) continue;
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        if (opcode !== 0x0) fragOpcode = opcode;
        fragments.push(payload);
        var total = 0; for (var j = 0; j < fragments.length; j++) total += fragments[j].length;
        if (total > maxBytes) { socket.destroy(); emitClose('WS_MESSAGE_TOO_LARGE'); return; }
        if (fin) {
          var whole = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments);
          fragments = [];
          if (fragOpcode === 0x1) {
            var text = whole.toString('utf8');
            messageHandlers.forEach(function (fn) { try { fn(text); } catch (e) { /* listener error */ } });
          }
        }
      }
    }
  });
  socket.on('error', function (e) { emitClose('socket error: ' + e.message); });
  socket.on('close', function () { emitClose('socket closed'); });
  socket.on('end', function () { emitClose('socket ended'); });
  return conn;
}

module.exports = { connect: connect, _frame: frame };
