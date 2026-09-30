'use strict';
// =====================================================
// MYTHOS bridge notifications — minimal JSON HTTP client
// projects/mythos-ai-executor/bridge/notify/http-json.js
//
// One tiny request helper (POST to send, GET for a read-only health check)
// shared by every notification provider adapter, so a
// new adapter (WAHA, WhatsApp Business Cloud API, …) does not have to bring
// its own transport or a new dependency. Node core only: the VPS is under
// swap pressure and the executor tree deliberately has no runtime npm
// dependencies.
//
// Security properties this helper is responsible for:
//   - headers are NEVER logged, echoed, or returned to the caller;
//   - the response body is truncated and passed through the shared
//     redaction before it can reach any error string;
//   - a hung provider cannot hang the bridge: the socket has a hard timeout
//     and the request is destroyed when it fires.
// =====================================================

var http = require('http');
var https = require('https');
var url = require('url');

var redact = require('../../../mythos-orchestrator/lib/redact');

var MAX_BODY = 2000;

// Sends one JSON request and resolves with { ok, statusCode, body }.
// It never rejects for an HTTP error status — only for a transport failure,
// and even then the error message is redacted first.
function request(method, target, body, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var parsed;
    try {
      parsed = new url.URL(target);
    } catch (e) {
      reject(new Error('INVALID_URL'));
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new Error('UNSUPPORTED_PROTOCOL: ' + parsed.protocol));
      return;
    }
    var payload = method === 'GET' ? null : Buffer.from(JSON.stringify(body === undefined ? {} : body), 'utf8');
    var headers = Object.assign({
      'accept': 'application/json',
      'user-agent': 'mythos-github-bridge-notify/1'
    }, payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}, opts.headers || {});

    var mod = parsed.protocol === 'https:' ? https : http;
    var req = mod.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: method,
      headers: headers
    }, function (res) {
      var chunks = [];
      var size = 0;
      res.on('data', function (c) {
        size += c.length;
        if (size <= MAX_BODY * 4) chunks.push(c);
      });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8').slice(0, MAX_BODY);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          body: redact.redact(text)
        });
      });
    });

    var settled = false;
    function fail(err) {
      if (settled) return;
      settled = true;
      try { req.destroy(); } catch (e) { /* already gone */ }
      reject(new Error(redact.redact(String((err && err.message) || err)).slice(0, 300)));
    }

    req.setTimeout(opts.timeoutMs || 15000, function () { fail(new Error('TIMEOUT')); });
    req.on('error', fail);
    if (payload) req.write(payload);
    req.end();
  });
}

function postJson(target, body, opts) { return request('POST', target, body, opts); }

// Read-only: used only for a provider's connection-state health check.
function getJson(target, opts) { return request('GET', target, undefined, opts); }

module.exports = { postJson: postJson, getJson: getJson, MAX_BODY: MAX_BODY };
