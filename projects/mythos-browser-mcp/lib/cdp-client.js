'use strict';
// =====================================================
// MYTHOS Browser MCP — Chrome DevTools Protocol client over ws-min
// projects/mythos-browser-mcp/lib/cdp-client.js
//
// One WebSocket, request ids, per-call timeout, event subscription. Flat
// sessions are supported (`sessionId` on a call) but the Obscura backend
// prefers a per-page WebSocket, which every CDP implementation offers.
// =====================================================
var ws = require('./ws-min');

function connect(wsUrl, opts) {
  opts = opts || {};
  var callTimeout = opts.callTimeoutMs || 30000;
  return ws.connect(wsUrl, { headers: opts.headers, timeoutMs: opts.timeoutMs, maxMessageBytes: opts.maxMessageBytes }).then(function (conn) {
    var nextId = 1;
    var pending = Object.create(null);
    var listeners = [];
    var closedReason = null;
    conn.onMessage(function (text) {
      var msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      if (msg.id !== undefined && pending[msg.id]) {
        var p = pending[msg.id]; delete pending[msg.id]; clearTimeout(p.timer);
        if (msg.error) { var err = new Error('CDP_ERROR: ' + (msg.error.message || 'unknown') + ' (' + p.method + ')'); err.cdp = msg.error; p.reject(err); }
        else p.resolve(msg.result || {});
        return;
      }
      if (msg.method) listeners.forEach(function (l) { if (l.method === msg.method || l.method === '*') { try { l.fn(msg.params || {}, msg.sessionId); } catch (e) { /* listener */ } } });
    });
    conn.onClose(function (reason) {
      closedReason = reason || 'closed';
      Object.keys(pending).forEach(function (id) { var p = pending[id]; delete pending[id]; clearTimeout(p.timer); p.reject(new Error('CDP_CLOSED: ' + closedReason + ' (' + p.method + ')')); });
    });
    var client = {
      send: function (method, params, sessionId, timeoutMs) {
        return new Promise(function (resolve, reject) {
          if (closedReason) return reject(new Error('CDP_CLOSED: ' + closedReason));
          var id = nextId++;
          var msg = { id: id, method: method, params: params || {} };
          if (sessionId) msg.sessionId = sessionId;
          var timer = setTimeout(function () { delete pending[id]; reject(new Error('CDP_TIMEOUT: ' + method + ' did not answer within ' + (timeoutMs || callTimeout) + ' ms')); }, timeoutMs || callTimeout);
          pending[id] = { resolve: resolve, reject: reject, timer: timer, method: method };
          try { conn.send(JSON.stringify(msg)); } catch (e) { delete pending[id]; clearTimeout(timer); reject(new Error('CDP_SEND: ' + e.message)); }
        });
      },
      on: function (method, fn) { var l = { method: method, fn: fn }; listeners.push(l); return function () { var i = listeners.indexOf(l); if (i !== -1) listeners.splice(i, 1); }; },
      // resolve when an event arrives or the timeout elapses (resolves false)
      waitFor: function (method, timeoutMs, predicate) {
        return new Promise(function (resolve) {
          var off = client.on(method, function (params, sid) { if (predicate && !predicate(params, sid)) return; off(); clearTimeout(t); resolve(true); });
          var t = setTimeout(function () { off(); resolve(false); }, timeoutMs);
        });
      },
      close: function () { conn.close(1000); },
      isClosed: function () { return !!closedReason; }
    };
    return client;
  });
}

module.exports = { connect: connect };
