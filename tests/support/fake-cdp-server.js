'use strict';
// =====================================================
// Test support — a fake CDP endpoint that behaves like Obscura's front door
// tests/support/fake-cdp-server.js
//
// HTTP: /json/version, /json/new, /json/close/<id>, bearer-protected when a
// token is given (401 without it). WS: a minimal RFC 6455 server answering
// the handful of DevTools methods the backend uses. It records every method
// it saw so a test can assert the exact protocol conversation. Offline.
// =====================================================
var http = require('http');
var crypto = require('crypto');

var GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(text) {
  var payload = Buffer.from(text, 'utf8');
  var len = payload.length, header;
  if (len < 126) { header = Buffer.from([0x81, len]); }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
  return Buffer.concat([header, payload]);
}

function decodeFrames(buf, onText) {
  for (;;) {
    if (buf.length < 2) return buf;
    var fin = (buf[0] & 0x80) !== 0, opcode = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
    var len = buf[1] & 0x7f, off = 2;
    if (len === 126) { if (buf.length < 4) return buf; len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (buf.length < 10) return buf; len = buf.readUInt32BE(6); off = 10; }
    var key = null;
    if (masked) { if (buf.length < off + 4) return buf; key = buf.slice(off, off + 4); off += 4; }
    if (buf.length < off + len) return buf;
    var payload = buf.slice(off, off + len);
    if (key) { var un = Buffer.alloc(len); for (var i = 0; i < len; i++) un[i] = payload[i] ^ key[i & 3]; payload = un; }
    buf = buf.slice(off + len);
    if (opcode === 0x1 && fin) onText(payload.toString('utf8'));
    if (opcode === 0x8) return null;
  }
}

// start({ token, port?, pages?: { title, text, href }, mode: 'legacy'|'target', pngBase64, failMethods?: {method: message} }) -> Promise<{ url, port, seen: [], close() }>
function start(opts) {
  opts = opts || {};
  var token = opts.token || null;
  var pages = Object.create(null);
  var seen = [];
  var sockets = [];
  var pngBase64 = opts.pngBase64 || Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201cbf1d0f60000000049454e44ae426082', 'hex').toString('base64');
  var server = http.createServer(function (req, res) {
    var auth = req.headers.authorization || '';
    seen.push({ http: req.method + ' ' + req.url, auth: auth ? 'bearer' : 'none' });
    if (token && auth !== 'Bearer ' + token) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"unauthorized"}'); }
    var port = server.address().port;
    if (req.url === '/json/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ Browser: 'FakeObscura/0.2.3', 'Protocol-Version': '1.3', 'User-Agent': 'fake', webSocketDebuggerUrl: 'ws://127.0.0.1:' + port + '/devtools/browser/b1' }));
    }
    if (req.url.indexOf('/json/new') === 0) {
      if (opts.mode === 'target') { res.writeHead(404); return res.end('not found'); }
      var id = 'p' + (Object.keys(pages).length + 1);
      pages[id] = { id: id, url: 'about:blank' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id: id, type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:' + port + '/devtools/page/' + id }));
    }
    if (req.url.indexOf('/json/close/') === 0) {
      var cid = req.url.slice('/json/close/'.length);
      seen.push({ closed: cid });
      delete pages[cid];
      res.writeHead(200); return res.end('Target is closing');
    }
    res.writeHead(404); res.end('nf');
  });
  server.on('upgrade', function (req, socket) {
    var auth = req.headers.authorization || '';
    seen.push({ ws: req.url, auth: auth ? 'bearer' : 'none' });
    if (token && auth !== 'Bearer ' + token) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    var key = req.headers['sec-websocket-key'];
    var accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    sockets.push(socket);
    var state = { url: 'about:blank', sessions: {} };
    var buf = Buffer.alloc(0);
    function send(obj) { try { socket.write(encodeFrame(JSON.stringify(obj))); } catch (e) { /* closed */ } }
    function pageFor(url) {
      var p = (opts.pages && opts.pages[url]) || { title: 'Fake page', text: 'Hello from ' + url, href: url };
      return p;
    }
    socket.on('data', function (chunk) {
      buf = Buffer.concat([buf, chunk]);
      var rest = decodeFrames(buf, function (text) {
        var msg; try { msg = JSON.parse(text); } catch (e) { return; }
        seen.push({ method: msg.method, sessionId: msg.sessionId || null });
        var sid = msg.sessionId;
        if (opts.failMethods && opts.failMethods[msg.method]) {
          var fm = opts.failMethods[msg.method];
          if (fm === 'hang') return;                                   // never answers: the caller's deadline must fire
          if (fm === 'drop') { socket.destroy(); return; }             // the engine goes away mid-call
          var er = { id: msg.id, error: { code: -32000, message: fm } }; if (sid) er.sessionId = sid; return send(er);
        }
        var reply = function (result) { var r = { id: msg.id, result: result }; if (sid) r.sessionId = sid; send(r); };
        switch (msg.method) {
          case 'Target.createTarget': { var tid = 't' + Math.random().toString(36).slice(2, 8); state.sessions[tid] = { url: msg.params.url }; return reply({ targetId: tid }); }
          case 'Target.attachToTarget': return reply({ sessionId: 's-' + msg.params.targetId });
          case 'Target.closeTarget': seen.push({ closed: msg.params.targetId }); return reply({ success: true });
          case 'Page.enable': case 'Runtime.enable': return reply({});
          case 'Page.navigate': {
            state.url = msg.params.url;
            reply({ frameId: 'f1', loaderId: 'l1' });
            var ev = { method: 'Page.loadEventFired', params: { timestamp: 1 } }; if (sid) ev.sessionId = sid;
            return setTimeout(function () { send(ev); }, 20);
          }
          case 'Runtime.evaluate': {
            var p = pageFor(state.url);
            var expr = msg.params.expression;
            var value;
            if (/readyState/.test(expr) && /title/.test(expr)) value = JSON.stringify({ href: p.href, title: p.title, readyState: 'complete' });
            else if (expr === 'document.readyState') value = 'complete';
            else if (/function extractInPage/.test(expr)) {
              // lib/page-text.js: the arguments are the JSON object the function is called with
              var am = /\)\((\{[^}]*\})\)\)$/.exec(expr);
              var ea = am ? JSON.parse(am[1]) : {};
              var esel = ea.selector || null;
              var efound = !esel || esel === 'h1' || esel === 'body';
              var etxt = esel === 'h1' ? p.title : p.text;
              var emax = ea.max || 20000;
              value = JSON.stringify(efound ? { found: true, chars: etxt.length, text: etxt.slice(0, emax), truncated: etxt.length > emax, title: p.title, href: p.href } : { found: false });
            }
            else if (/querySelector|document\.body/.test(expr)) {
              var m = /querySelector\(("[^"]*")\)/.exec(expr);
              var sel = m ? JSON.parse(m[1]) : null;
              var found = !sel || sel === 'h1' || sel === 'body';
              var txt = sel === 'h1' ? p.title : p.text;
              var max = Number((/slice\(0,(\d+)\)/.exec(expr) || [])[1]) || 20000;
              value = JSON.stringify(found ? { found: true, chars: txt.length, text: txt.slice(0, max), truncated: txt.length > max, title: p.title, href: p.href } : { found: false });
            } else value = null;
            return reply({ result: { type: typeof value, value: value } });
          }
          case 'Page.captureScreenshot': return reply({ data: pngBase64 });
          default: return send({ id: msg.id, error: { code: -32601, message: "'" + msg.method + "' wasn't found" } });
        }
      });
      if (rest === null) { socket.end(); return; }
      buf = rest;
    });
    socket.on('error', function () {});
  });
  return new Promise(function (resolve) {
    server.listen(opts.port || 0, '127.0.0.1', function () {
      var port = server.address().port;
      resolve({ url: 'http://127.0.0.1:' + port, port: port, seen: seen, pages: pages,
        close: function () { sockets.forEach(function (s) { try { s.destroy(); } catch (e) {} }); return new Promise(function (r) { server.close(function () { r(); }); }); } });
    });
  });
}

module.exports = { start: start };
