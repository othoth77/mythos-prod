'use strict';
// =====================================================
// MYTHOS WP — HTTP server (loopback only)
// projects/mythos-wp/reference/server.js
//
// Same shape as the sibling MYTHOS services (command-center, os-console,
// ssangyong storefront): Node `http`, no framework, binds 127.0.0.1 and is
// published by an nginx vhost with a certbot certificate. Serves the web
// shell, the shared brand assets straight from assets/brand/ (the canonical
// token and font files — no copy, no drift) and the JSON API of api.js.
//
// Security posture, in one place:
//   · every route except /login, its assets, /healthz and POST /api/login
//     requires a live session (auth.js);
//   · state-changing methods additionally pass auth.csrfCheck();
//   · JSON bodies are capped (256 KiB) and must be application/json;
//   · CSP script-src 'self' (no inline scripts, ES modules from /js/),
//     frame-ancestors 'none', nosniff, no-referrer, no-store on the API;
//   · one error shape { ok:false, error, detail, errors? }; internal errors
//     are logged with a request id and never echoed;
//   · the process logs one JSON line per request outcome that changed
//     state or failed — never a body, never a cookie.
//
//   MYTHOS_WP_PORT (default 8170)  MYTHOS_WP_BIND (default 127.0.0.1;
//   anything but loopback is refused).
// =====================================================

var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var url = require('url');

var db = require('./db');
var auth = require('./auth');
var api = require('./api');
var receiver = require('./comms/receiver');
var assistant = require('./comms/assistant');
var redact = require('../../mythos-orchestrator/lib/redact');

var ROOT = path.resolve(__dirname, '..', '..', '..');
var WEB = path.join(__dirname, 'web');
var BRAND = path.join(ROOT, 'assets', 'brand');
var MAX_BODY = 256 * 1024;

var CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
var SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

var TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };

// Static files: an explicit map. Nothing outside it is served.
var STATIC = {
  '/': { file: path.join(WEB, 'index.html'), auth: true },
  '/index.html': { file: path.join(WEB, 'index.html'), auth: true },
  '/login': { file: path.join(WEB, 'login.html'), auth: false },
  '/login.html': { file: path.join(WEB, 'login.html'), auth: false },
  '/wp.css': { file: path.join(WEB, 'wp.css'), auth: false, cache: true },
  '/brand/tokens.css': { file: path.join(BRAND, 'tokens', 'tokens.css'), auth: false, cache: true },
  '/brand/fonts.css': { file: path.join(BRAND, 'fonts', 'fonts.css'), auth: false, cache: true },
  '/brand/mythos-favicon.svg': { file: path.join(WEB, 'mythos-favicon.svg'), auth: false, cache: true },
  '/js/validate.js': { file: path.join(__dirname, 'validate.js'), auth: false, cache: true },
  '/js/login.js': { file: path.join(WEB, 'js', 'login.js'), auth: false, cache: true }
};
// fonts.css references ../fonts/<file>.woff2 relative to /brand/fonts.css → /brand/../fonts/x → /fonts/x
var FONT_RE = /^\/(?:brand\/)?fonts\/([a-z0-9-]+\.woff2)$/;
var JS_RE = /^\/js\/((?:views\/)?[a-z0-9-]+\.js)$/;

function head(res, code, type, length, extra, cache) {
  var h = { 'Content-Type': type, 'Cache-Control': cache ? 'public, max-age=3600' : 'no-store' };
  Object.keys(SECURITY_HEADERS).forEach(function (k) { h[k] = SECURITY_HEADERS[k]; });
  if (length !== undefined) h['Content-Length'] = length;
  if (extra) Object.keys(extra).forEach(function (k) { if (extra[k] !== undefined) h[k] = extra[k]; });
  res.writeHead(code, h);
}

function sendJSON(res, code, obj, extra) {
  var body = JSON.stringify(obj);
  head(res, code, 'application/json; charset=utf-8', Buffer.byteLength(body), extra);
  res.end(body);
}

function serveFile(file, res, method, cache) {
  fs.readFile(file, function (err, buf) {
    if (err) { sendJSON(res, 404, { ok: false, error: 'not_found', detail: 'not found' }); return; }
    head(res, 200, TYPES[path.extname(file)] || 'application/octet-stream', buf.length, undefined, cache);
    if (method === 'HEAD') { res.end(); return; }
    res.end(buf);
  });
}

function log(v) {
  process.stdout.write(JSON.stringify(redact.redactValue(Object.assign({ at: new Date().toISOString() }, v))) + '\n');
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0;
    req.on('data', function (c) {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('BODY_TOO_LARGE'), { code: 'too_large', status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function problem(res, err, requestId) {
  var status = err && err.status ? err.status : 500;
  var code = err && err.code && status !== 500 ? err.code : 'internal_error';
  if (status === 500) log({ level: 'error', request_id: requestId, error: err && err.message ? String(err.message).slice(0, 200) : 'unknown', code: err && err.code ? err.code : null, stack: err && err.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ') : null });
  var body = { ok: false, error: code, detail: status === 500 ? 'internal error' : (err.detail || err.message || code), request_id: requestId };
  if (err && err.errors) body.errors = err.errors;
  if (err && err.constraint) body.constraint = err.constraint;
  sendJSON(res, status, body);
}

function isMutation(method) { return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'; }

function handle(req, res) {
  var requestId = crypto.randomBytes(6).toString('hex');
  req.requestId = requestId;
  var parsed = url.parse(req.url);
  var pathname = parsed.pathname || '/';
  // Route parameters may arrive percent-encoded (e.g. a product uid with ':'); match on the decoded path.
  if (pathname.indexOf('%') !== -1) { try { pathname = decodeURIComponent(pathname); } catch (e) { return sendJSON(res, 400, { ok: false, error: 'bad_request', detail: 'malformed path encoding' }); } }
  var method = req.method;
  var session = auth.sessionFor(req);
  req.session = session;

  // Public liveness for nginx / monitors: says "up", nothing else.
  if (pathname === '/healthz' && (method === 'GET' || method === 'HEAD')) return sendJSON(res, 200, { ok: true });

  // Provider webhooks (Communication Receiver): token-authenticated, no session, loopback by deployment.
  if (pathname.indexOf('/hooks/') === 0) return receiver.handle(req, res, { pool: db.wp(), log: log, requestId: requestId });

  // Static
  var st = STATIC[pathname];
  var fontMatch = FONT_RE.exec(pathname);
  var jsMatch = JS_RE.exec(pathname);
  if (fontMatch) st = { file: path.join(BRAND, 'fonts', fontMatch[1]), auth: false, cache: true };
  else if (jsMatch && !st) st = { file: path.join(WEB, 'js', jsMatch[1]), auth: true, cache: true };
  if (st) {
    if (method !== 'GET' && method !== 'HEAD') return sendJSON(res, 405, { ok: false, error: 'method_not_allowed', detail: 'method not allowed' });
    if (st.auth && !session) {
      var extra = auth.hasSessionCookie(req) ? { 'Set-Cookie': auth.clearedCookie() } : undefined;
      if (pathname === '/' || pathname === '/index.html') { head(res, 302, 'text/plain', 0, Object.assign({ Location: '/login' }, extra || {})); return res.end(); }
      return sendJSON(res, 401, { ok: false, error: 'unauthenticated', detail: 'sign in' }, extra);
    }
    if ((pathname === '/login' || pathname === '/login.html') && session) { head(res, 302, 'text/plain', 0, { Location: '/' }); return res.end(); }
    return serveFile(st.file, res, method, st.cache);
  }

  if (pathname.indexOf('/api/') !== 0) return sendJSON(res, 404, { ok: false, error: 'not_found', detail: 'not found' });

  var route = null, params = null;
  for (var i = 0; i < api.ROUTES.length; i++) {
    var m = api.ROUTES[i].path.exec(pathname);
    if (m && api.ROUTES[i].method === method) { route = api.ROUTES[i]; params = m; break; }
  }
  if (!route) {
    var pathKnown = api.ROUTES.some(function (r) { return r.path.test(pathname); });
    return sendJSON(res, pathKnown ? 405 : 404, { ok: false, error: pathKnown ? 'method_not_allowed' : 'not_found', detail: pathKnown ? 'method not allowed' : 'not found' });
  }

  if (route.role !== false) {
    if (!session) return sendJSON(res, 401, { ok: false, error: 'unauthenticated', detail: 'sign in' }, auth.hasSessionCookie(req) ? { 'Set-Cookie': auth.clearedCookie() } : undefined);
    if (!auth.hasRole(session, route.role)) {
      log({ level: 'warn', request_id: requestId, actor: session.username, role: session.role, denied: method + ' ' + pathname, needs: route.role });
      return sendJSON(res, 403, { ok: false, error: 'forbidden', detail: 'insufficient role' });
    }
  }
  if (isMutation(method) && route.csrf !== false) {
    var csrf = auth.csrfCheck(req);
    if (csrf) return sendJSON(res, 403, { ok: false, error: 'csrf', detail: csrf });
  }

  var ctx = { params: params, body: null, _status: 200, _cookie: undefined, status: function (c) { this._status = c; }, setCookie: function (c) { this._cookie = c; } };
  var bodyP = isMutation(method) ? readBody(req).then(function (raw) {
    if (!raw) return null;
    var ct = String(req.headers['content-type'] || '');
    if (ct.indexOf('application/json') !== 0) throw Object.assign(new Error('content type must be application/json'), { code: 'unsupported_media_type', status: 415 });
    try { return JSON.parse(raw); } catch (e) { throw Object.assign(new Error('body is not valid JSON'), { code: 'bad_json', status: 400 }); }
  }) : Promise.resolve(null);

  bodyP.then(function (body) {
    ctx.body = body;
    return route.handler(req, res, ctx);
  }).then(function (data) {
    if (route.stream) return; // the handler owns the response (SSE)
    sendJSON(res, ctx._status, { ok: true, at: new Date().toISOString(), data: data }, ctx._cookie ? { 'Set-Cookie': ctx._cookie } : undefined);
    if (isMutation(method)) log({ level: 'info', request_id: requestId, actor: session ? session.username : (pathname === '/api/login' ? 'login' : null), method: method, path: pathname, status: ctx._status });
  }).catch(function (err) {
    problem(res, err, requestId);
    if (isMutation(method) || (err && err.status === 500)) log({ level: err && err.status && err.status < 500 ? 'warn' : 'error', request_id: requestId, actor: session ? session.username : null, method: method, path: pathname, status: err && err.status ? err.status : 500, error: err && err.code ? err.code : 'internal_error' });
  });
}

function createServer() { return http.createServer(handle); }

function start(opts) {
  try { assistant.attach(db.wp(), log); } catch (e) { log({ level: 'warn', assistant: 'attach_failed', reason: String(e && e.message || e) }); }
  opts = opts || {};
  var port = opts.port || parseInt(process.env.MYTHOS_WP_PORT || '8170', 10);
  var bind = opts.bind || process.env.MYTHOS_WP_BIND || '127.0.0.1';
  if (!/^(127\.[0-9.]+|::1|localhost)$/.test(bind)) { process.stderr.write('MYTHOS WP refuses to bind ' + bind + ': loopback only\n'); process.exit(2); }
  var missing = db.missingEnv();
  if (missing.length) { process.stderr.write('MYTHOS WP: missing environment: ' + missing.join(', ') + '\n'); process.exit(2); }
  var users = auth.usersState();
  var server = createServer();
  server.listen(port, bind, function () {
    log({ level: 'info', service: 'mythos-wp', version: api.VERSION, listening: bind + ':' + port, users_provisioned: users.provisioned, users_reason: users.reason, comms_config: process.env.MYTHOS_WP_COMMS_CONFIG ? 'set' : 'absent' });
  });
  function stop() { server.close(function () { db.closeAll().then(function () { process.exit(0); }); }); setTimeout(function () { process.exit(0); }, 3000).unref(); }
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return server;
}

if (require.main === module) start();

module.exports = { createServer: createServer, start: start, handle: handle, CSP: CSP, SECURITY_HEADERS: SECURITY_HEADERS, STATIC: STATIC };
