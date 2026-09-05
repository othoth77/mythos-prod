#!/usr/bin/env node
'use strict';
/* tests/lib/erp-cookie-proxy.js — loopback reverse proxy that injects one
 * Cookie (and one x-csrf-token) header into every request it forwards, so a
 * headless browser that cannot type into the login form can still render the
 * authenticated application. Test tooling only: binds 127.0.0.1, dies with the
 * drill, and the cookie value arrives through an environment variable read once
 * at start — never through argv. Never point this at production.
 *
 *   ERP_PROXY_COOKIE='__Host-erp_session=…' ERP_PROXY_CSRF='…' \
 *   node erp-cookie-proxy.js <listenPort> <upstreamPort>
 */
var http = require('http');
var listen = Number(process.argv[2]);
var upstream = Number(process.argv[3]);
var cookie = process.env.ERP_PROXY_COOKIE || '';
var csrf = process.env.ERP_PROXY_CSRF || '';
delete process.env.ERP_PROXY_COOKIE; delete process.env.ERP_PROXY_CSRF;
if (!listen || !upstream) { console.error('usage: erp-cookie-proxy.js <listenPort> <upstreamPort>'); process.exit(2); }

http.createServer(function (req, res) {
  var headers = Object.assign({}, req.headers, { host: '127.0.0.1:' + upstream });
  if (cookie) headers.cookie = cookie;
  if (csrf && req.method !== 'GET' && req.method !== 'HEAD') headers['x-csrf-token'] = csrf;
  var out = http.request({ host: '127.0.0.1', port: upstream, method: req.method, path: req.url, headers: headers }, function (up) {
    // The upstream cookie is Secure; the browser talks plain http to this
    // proxy and would drop it. It is not needed: the proxy re-injects ours.
    var h = Object.assign({}, up.headers); delete h['set-cookie'];
    res.writeHead(up.statusCode, h);
    up.pipe(res);
  });
  out.on('error', function () { res.writeHead(502); res.end('proxy error'); });
  req.pipe(out);
}).listen(listen, '127.0.0.1', function () { process.stdout.write('proxy 127.0.0.1:' + listen + ' -> ' + upstream + '\n'); });
