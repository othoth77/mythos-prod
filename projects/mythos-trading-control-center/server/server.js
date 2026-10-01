'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — HTTP server
// projects/mythos-trading-control-center/server/server.js
//
// The web surface for trading.mythosprod.xyz. Built the way every other
// service in this repository is: node http, no framework, no build-time
// dependency, no runtime dependency.
//
// WHAT THIS FILE GUARANTEES, STRUCTURALLY
//
//  * EVERYTHING IS BEHIND A SERVER-SIDE SESSION except the login page, the
//    assets it needs, POST /api/auth/login and the liveness probe. Nothing
//    under /api/ answers an unauthenticated caller with data.
//  * EVERY MUTATION RUNS THE SAME PIPELINE, here, not in each handler:
//      authenticate → CSRF + origin → rate limit → authorize → validate
//      → execute → audit → deterministic JSON
//    A handler cannot skip a step, because it is never called before them.
//  * EVERY MUTATION ATTEMPT IS AUDITED — accepted, refused or failed —
//    including ones turned away for a missing session or the wrong role.
//  * STATIC FILES COME FROM A WHITELIST built at start-up. A request path is
//    looked up in a map; it is never resolved against a directory, so there is
//    no path to traverse.
//  * THE API IS SAME-ORIGIN ONLY. No Access-Control-Allow-Origin header is
//    ever sent, and a state-changing request carrying a foreign Origin is
//    refused before authentication is even considered.
//  * AN ERROR NEVER LEAKS INTERNALS. Designed refusals carry their code and
//    message; anything unexpected becomes a generic 500 with an id, and the
//    detail goes to the journal.
//  * THE BROWSER NEVER TOUCHES THE STORE. It sees JSON read models from
//    server/views.js and nothing else.
// =====================================================

var crypto = require('crypto');
var fs = require('fs');
var http = require('http');
var path = require('path');

var authMod = require('./auth');
var auditMod = require('./audit');
var rateMod = require('./ratelimit');
var validate = require('./validate');
var platformMod = require('./platform');
var apiMod = require('./api');

var PROJECT_ROOT = path.join(__dirname, '..');
var MAX_BODY_BYTES = 64 * 1024;
var MAX_URL_LENGTH = 2048;
var SSE_HEARTBEAT_MS = 15000;

var CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join('; ');

var SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow'
};

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

/** The client-side routes. Each serves the application shell. */
var APP_ROUTES = ['/', '/dashboard', '/control', '/paper', '/backtest', '/trades', '/candidates', '/decisions',
  '/strategies', '/jev', '/risk', '/recovery', '/analysis', '/research', '/testing', '/activity', '/system'];

/** Files an unauthenticated browser may fetch: the login page and what it needs. */
var PUBLIC_FILE_RE = new RegExp('^/assets/(?:' + [
  '(?:tokens|fonts|base|components|login)(?:\\.[0-9a-f]{8,16})?\\.css',
  'js/(?:theme|login)(?:\\.[0-9a-f]{8,16})?\\.js',
  'fonts/[a-z0-9-]+(?:\\.[0-9a-f]{8,16})?\\.woff2',
  'favicon(?:\\.[0-9a-f]{8,16})?\\.svg'
].join('|') + ')$');

function httpError(status, code, message, extra) {
  var e = new Error(message);
  e.http = status;
  e.code = code;
  if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
  return e;
}

/** Builds the static whitelist: request path → { file, type, etag, size }. */
function buildStatic(webDir) {
  var map = Object.create(null);
  (function walk(dir, prefix) {
    var entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    entries.forEach(function (e) {
      if (e.name[0] === '.') return;
      var p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p, prefix + e.name + '/');
      var ext = path.extname(e.name);
      if (!MIME[ext]) return;
      var buf = fs.readFileSync(p);
      map[prefix + e.name] = {
        file: p, type: MIME[ext], size: buf.length,
        etag: '"' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 20) + '"',
        immutable: /\.[0-9a-f]{8,16}\.(css|js|svg|woff2)$/.test(e.name)
      };
    });
  })(webDir, '/');
  return map;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.stateDir]
 * @param {string} [opts.usersFile]
 * @param {object[]} [opts.users] user records (tests)
 * @param {string} [opts.publicOrigin] e.g. https://trading.mythosprod.xyz
 * @param {boolean} [opts.trustProxy] trust X-Real-IP from a loopback peer
 * @param {string} [opts.webDir]
 * @param {object} [opts.platform] an existing platform (tests)
 * @param {function} [opts.log] (line) => void; null silences
 * @param {object} [opts.rateBuckets]
 */
function create(opts) {
  var o = opts || {};
  var log = o.log === undefined ? function (line) { try { process.stdout.write(line + '\n'); } catch (e) { /* ignore */ } } : o.log;
  var publicOrigin = o.publicOrigin || null;
  var trustProxy = !!o.trustProxy;

  var platform = o.platform || platformMod.create({
    stateDir: o.stateDir, agentRoot: o.agentRoot, commit: o.commit, now: o.now,
    paperAutoTick: o.paperAutoTick, maxRuns: o.maxRuns, testEnv: o.testEnv, jobTimeoutMs: o.jobTimeoutMs,
    testRoots: o.testRoots, testFileTimeoutMs: o.testFileTimeoutMs
  });
  var audit = auditMod.create({ state: platform.state, now: o.now, sink: o.auditSink === undefined ? (log || null) : o.auditSink });
  platform.attachAudit(audit);
  var auth = authMod.create({ usersFile: o.usersFile, users: o.users, now: o.now,
    absoluteTtlMs: o.sessionTtlMs, idleTtlMs: o.sessionIdleMs });
  var limiter = rateMod.create({ buckets: o.rateBuckets, now: o.now });

  var webDir = o.webDir || (fs.existsSync(path.join(PROJECT_ROOT, 'dist', 'index.html'))
    ? path.join(PROJECT_ROOT, 'dist') : path.join(PROJECT_ROOT, 'web'));
  var statics = buildStatic(webDir);
  var webBuild = null;
  try { webBuild = JSON.parse(fs.readFileSync(path.join(webDir, 'build.json'), 'utf8')); } catch (e) { webBuild = { built: false }; }

  var bindInfo = { host: null, port: null };
  var routeTable = apiMod.routes({ platform: platform, audit: audit, auth: auth }).map(compileRoute);

  var integrity = audit.loadedIntegrity();
  if (!integrity.ok) {
    platform.systemEvent({ kind: 'AUDIT_CHAIN_BROKEN', severity: 'ERROR',
      message: 'the audit chain failed verification at entry ' + integrity.brokenAtSeq + ': ' + integrity.problem });
  }
  var us = auth.userState();
  if (!us.provisioned) {
    platform.systemEvent({ kind: 'AUTH_NOT_PROVISIONED', severity: 'ERROR',
      message: 'no usable users file (' + us.reason + '); every sign-in is refused' });
  } else if (!us.hasOwner) {
    platform.systemEvent({ kind: 'AUTH_NO_OWNER', severity: 'WARN', message: 'the users file defines no OWNER; configuration cannot be changed' });
  }

  function compileRoute(r) {
    var names = [];
    var pattern = r.path.replace(/:([A-Za-z]+)/g, function (_, name) { names.push(name); return '([^/]+)'; });
    r.regex = new RegExp('^' + pattern + '$');
    r.paramNames = names;
    return r;
  }

  // =====================================================================
  // helpers
  // =====================================================================

  function clientKey(req) {
    var addr = (req.socket && req.socket.remoteAddress) || 'unknown';
    if (trustProxy && /^(127\.|::1$|::ffff:127\.)/.test(addr)) {
      var real = req.headers['x-real-ip'];
      if (typeof real === 'string' && /^[0-9a-fA-F:.]{3,45}$/.test(real)) return real;
    }
    return addr;
  }

  function baseHeaders(extra) {
    var h = {};
    Object.keys(SECURITY_HEADERS).forEach(function (k) { h[k] = SECURITY_HEADERS[k]; });
    Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function sendJSON(req, res, status, body, extra) {
    var text = JSON.stringify(body);
    var headers = baseHeaders(Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      'Cache-Control': 'no-store',
      'X-Request-Id': req.tccId
    }, extra || {}));
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : text);
    req.tccStatus = status;
  }

  function sendError(req, res, status, code, message, extra, headers) {
    var error = { code: code, message: message };
    Object.keys(extra || {}).forEach(function (k) { error[k] = extra[k]; });
    sendJSON(req, res, status, { ok: false, error: error, requestId: req.tccId }, headers);
  }

  function redirect(req, res, location) {
    res.writeHead(302, baseHeaders({ Location: location, 'Cache-Control': 'no-store', 'Content-Length': 0 }));
    res.end();
    req.tccStatus = 302;
  }

  function serveFile(req, res, entry, cacheControl) {
    var headers = baseHeaders({
      'Content-Type': entry.type, 'ETag': entry.etag,
      'Cache-Control': cacheControl || (entry.immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
    });
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers);
      res.end();
      req.tccStatus = 304;
      return;
    }
    var buf;
    try { buf = fs.readFileSync(entry.file); }
    catch (e) { return sendError(req, res, 404, 'NOT_FOUND', 'not found'); }
    headers['Content-Length'] = buf.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : buf);
    req.tccStatus = 200;
  }

  function readBody(req) {
    return new Promise(function (resolve, reject) {
      var type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      var declared = parseInt(req.headers['content-length'] || '0', 10);
      if (declared > MAX_BODY_BYTES) return reject(httpError(413, 'BODY_TOO_LARGE', 'request body exceeds ' + MAX_BODY_BYTES + ' bytes'));
      var chunks = [];
      var size = 0;
      var done = false;
      req.on('data', function (c) {
        if (done) return;
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          done = true;
          reject(httpError(413, 'BODY_TOO_LARGE', 'request body exceeds ' + MAX_BODY_BYTES + ' bytes'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('error', function () { if (!done) { done = true; reject(httpError(400, 'BAD_REQUEST', 'request aborted')); } });
      req.on('end', function () {
        if (done) return;
        done = true;
        if (size === 0) return resolve({});
        if (type !== 'application/json') return reject(httpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'the request body must be application/json'));
        var parsed;
        try {
          // Keys that address an object's prototype are refused wherever they
          // appear. Nothing here needs them, and a deep merge that met one
          // would be merging into a prototype.
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'), function (key, value) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
              throw httpError(400, 'BAD_REQUEST', 'the request body contains a forbidden key');
            }
            return value;
          });
        } catch (e) {
          return reject(e && e.http ? e : httpError(400, 'BAD_REQUEST', 'the request body is not valid JSON'));
        }
        if (!validate.isPlainObject(parsed)) return reject(httpError(400, 'BAD_REQUEST', 'the request body must be a JSON object'));
        resolve(parsed);
      });
    });
  }

  /** Query string → { key: value | [values] }, bounded. */
  function parseQuery(search) {
    var out = {};
    var n = 0;
    new URLSearchParams(search).forEach(function (value, key) {
      if (++n > 40) return;
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        out[key] = [].concat(out[key], value);
      } else out[key] = value;
    });
    return out;
  }

  /**
   * Same-origin check for state-changing requests. A browser sends Origin on
   * every cross-origin POST; refusing a foreign one means a page on another
   * site cannot drive this API even if a cookie rule were ever loosened.
   */
  function originAllowed(req) {
    var site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return false;
    var origin = req.headers.origin;
    if (!origin) return true;      // non-browser client; the session + CSRF token still apply
    if (publicOrigin) return origin === publicOrigin;
    var host = req.headers.host;
    return origin === 'http://' + host || origin === 'https://' + host;
  }

  function actorOf(session, req) {
    return session
      ? { id: session.userId, role: session.role, sessionId: session.id, client: clientKey(req) }
      : { id: null, role: null, sessionId: null, client: clientKey(req) };
  }

  function statusFor(e) {
    if (e.http) return e.http;
    switch (e.code) {
      case 'CONFIG_INVALID': case 'DATA_INVALID': case 'CANDIDATE_INVALID':
      case 'CONFIG_CHANGE_NOT_ALLOWED': case 'UNKNOWN_STRATEGY': case 'NO_STRATEGY_ENABLED':
      case 'UNKNOWN_CATEGORY': case 'UNKNOWN_SCOPE': case 'UNKNOWN_TEST': case 'UNKNOWN_TEST_FILE':
      case 'NO_DATA_FOR_UNIVERSE':
        return 400;
      case 'RUN_NOT_FOUND': case 'PROPOSAL_NOT_FOUND': case 'CHALLENGER_NOT_FOUND': case 'NO_TEST_RUN':
        return 404;
      case 'LIVE_NOT_AVAILABLE': case 'LIVE_EXECUTION_REFUSED': case 'MODE_TRANSITION_REFUSED':
      case 'PROMOTION_REFUSED': case 'RISK_AUTHORITY_VIOLATION': case 'APPROVAL_REQUIRED':
      case 'APPROVAL_ALREADY_USED': case 'COMMIT_UNKNOWN': case 'SAFETY_CHECK_FAILED':
        return 403;
      case 'JOB_ALREADY_RUNNING': case 'CONFIG_STALE': case 'TEST_RUN_IN_PROGRESS':
        return 409;
      default:
        return e.refusal ? 409 : 500;
    }
  }

  function errorPayload(e) {
    var extra = {};
    if (e.problems) extra.problems = e.problems;
    else if (e.details && Array.isArray(e.details.problems)) extra.problems = e.details.problems;
    ['loosened', 'wouldResetMode', 'activeRunId', 'approvalId', 'mode'].forEach(function (k) {
      if (e[k] !== undefined) extra[k] = e[k];
    });
    if (e.details && Array.isArray(e.details.blockers)) extra.blockers = e.details.blockers;
    return extra;
  }

  function respondError(req, res, e) {
    var status = statusFor(e);
    if (status >= 500) {
      var id = crypto.randomBytes(6).toString('hex');
      if (log) log(JSON.stringify({ log: 'tcc.error', errorId: id, requestId: req.tccId, path: req.tccPath,
        message: String(e && e.message).slice(0, 500), stack: String(e && e.stack).split('\n').slice(0, 6).join(' | ') }));
      platform.systemEvent({ kind: 'INTERNAL_ERROR', severity: 'ERROR', message: 'error ' + id + ' on ' + req.method + ' ' + req.tccPath });
      return sendError(req, res, 500, 'INTERNAL', 'an internal error occurred', { errorId: id });
    }
    sendError(req, res, status, e.code || 'ERROR', String(e.message).slice(0, 2000), errorPayload(e));
  }

  // =====================================================================
  // authentication routes
  // =====================================================================

  function handleLogin(req, res) {
    var client = clientKey(req);
    var rl = limiter.hit('login', client);
    if (!rl.allowed) {
      audit.record({ actor: { client: client }, action: 'auth.login', outcome: 'REFUSED', code: 'RATE_LIMITED' });
      return sendError(req, res, 429, 'RATE_LIMITED', 'too many requests', null, { 'Retry-After': rl.retryAfterSeconds });
    }
    if (!originAllowed(req)) {
      audit.record({ actor: { client: client }, action: 'auth.login', outcome: 'REFUSED', code: 'CROSS_ORIGIN' });
      return sendError(req, res, 403, 'CROSS_ORIGIN', 'cross-origin requests are not accepted');
    }
    readBody(req).then(function (body) {
      var check = validate.check(validate.obj({
        user: validate.str({ minLength: 1, maxLength: 64 }),
        password: validate.str({ minLength: 1, maxLength: 256 })
      }), body);
      if (!check.ok) return sendError(req, res, 400, 'VALIDATION_FAILED', 'invalid sign-in request', { problems: check.problems });
      var userId = body.user.toLowerCase();
      if (!auth.loginAllowed(client, userId)) {
        audit.record({ actor: { id: userId, client: client }, action: 'auth.login', outcome: 'REFUSED', code: 'THROTTLED' });
        return sendError(req, res, 429, 'THROTTLED', 'too many failed sign-in attempts; try again later', null, { 'Retry-After': 900 });
      }
      var verdict = auth.verifyCredentials(userId, body.password);
      if (!verdict.ok) {
        auth.recordLoginFailure(client, userId);
        // The reason is audited; the caller is told only that it failed.
        audit.record({ actor: { id: userId, client: client }, action: 'auth.login', outcome: 'REFUSED',
          code: verdict.reason === 'invalid' ? 'INVALID_CREDENTIALS' : 'AUTH_UNAVAILABLE', detail: { reason: verdict.reason } });
        return sendError(req, res, 401, 'INVALID_CREDENTIALS', 'the user name or password is not correct');
      }
      auth.clearLoginFailures(client, userId);
      var session = auth.createSession(verdict.user, client);
      audit.record({ actor: { id: verdict.user.id, role: verdict.user.role, sessionId: session.id, client: client },
        action: 'auth.login', outcome: 'ACCEPTED' });
      sendJSON(req, res, 200, {
        ok: true,
        result: { user: { id: session.userId, role: session.role }, csrf: session.csrf, expiresAt: new Date(session.expiresAt).toISOString() }
      }, { 'Set-Cookie': auth.sessionCookie(session.id) });
    }).catch(function (e) { respondError(req, res, e); });
  }

  function handleLogout(req, res, session) {
    if (session) {
      if (!originAllowed(req) || !auth.csrfMatches(session, req.headers['x-tcc-csrf'])) {
        audit.record({ actor: actorOf(session, req), action: 'auth.logout', outcome: 'REFUSED', code: 'CSRF' });
        return sendError(req, res, 403, 'CSRF', 'the request did not carry a valid CSRF token');
      }
      auth.destroySession(session.id);
      audit.record({ actor: actorOf(session, req), action: 'auth.logout', outcome: 'ACCEPTED' });
    }
    sendJSON(req, res, 200, { ok: true, result: { signedOut: true } }, { 'Set-Cookie': auth.clearedCookie() });
  }

  function handleSession(req, res, session) {
    if (!session) {
      var headers = auth.hasSessionCookie(req) ? { 'Set-Cookie': auth.clearedCookie() } : null;
      return sendJSON(req, res, 200, { ok: true, result: { authenticated: false } }, headers);
    }
    sendJSON(req, res, 200, {
      ok: true,
      result: {
        authenticated: true,
        user: { id: session.userId, role: session.role },
        csrf: session.csrf,
        expiresAt: new Date(session.expiresAt).toISOString(),
        idleExpiresAt: new Date(session.idleExpiresAt).toISOString(),
        can: {
          read: true,
          operate: authMod.roleAtLeast(session.role, 'OPERATOR'),
          own: authMod.roleAtLeast(session.role, 'OWNER')
        }
      }
    });
  }

  // =====================================================================
  // server-sent events for the paper control room
  // =====================================================================

  function handleStream(req, res, session, query) {
    var since = 0;
    var lastId = req.headers['last-event-id'];
    if (typeof lastId === 'string' && /^\d{1,15}$/.test(lastId)) since = parseInt(lastId, 10);
    else if (typeof query.since === 'string' && /^\d{1,15}$/.test(query.since)) since = parseInt(query.since, 10);

    var closed = false;
    function write(chunk) {
      if (closed) return;
      try { res.write(chunk); } catch (e) { close(); }
    }
    var sub = {
      send: function (ev) { write('id: ' + ev.seq + '\nevent: paper\ndata: ' + JSON.stringify(ev) + '\n\n'); },
      close: function () { close(); }
    };
    function close() {
      if (closed) return;
      closed = true;
      clearInterval(hb);
      platform.paper.unsubscribe(sub);
      try { res.end(); } catch (e) { /* already closed */ }
    }
    if (!platform.paper.subscribe(sub)) {
      return sendError(req, res, 503, 'TOO_MANY_STREAMS', 'too many open event streams');
    }
    res.writeHead(200, baseHeaders({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Request-Id': req.tccId
    }));
    req.tccStatus = 200;
    write('retry: 3000\n\n');
    var backlog = platform.paper.eventsSince(since, 1000);
    // A cursor older than the buffer means events were lost to the client. Say
    // so explicitly; the client reloads the state instead of trusting the stream.
    if (backlog.gap) write('event: gap\ndata: ' + JSON.stringify({ firstSeq: backlog.firstSeq, lastSeq: backlog.lastSeq }) + '\n\n');
    backlog.items.forEach(function (ev) { sub.send(ev); });
    write('event: ready\ndata: ' + JSON.stringify({ lastSeq: platform.paper.lastEventSeq(), state: platform.paper.state() }) + '\n\n');

    var hb = setInterval(function () {
      // The stream outlives the request that opened it, so the session is
      // re-checked on every beat: signing out closes the stream.
      if (!auth.sessionFor(req)) return close();
      write(': hb ' + Date.now() + '\n\n');
    }, SSE_HEARTBEAT_MS);
    if (hb.unref) hb.unref();
    req.on('close', close);
    res.on('error', close);
  }

  // =====================================================================
  // the API pipeline
  // =====================================================================

  function matchRoute(method, pathname) {
    var pathMatched = false;
    for (var i = 0; i < routeTable.length; i++) {
      var r = routeTable[i];
      var m = r.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      var params = {};
      for (var j = 0; j < r.paramNames.length; j++) {
        var raw;
        try { raw = decodeURIComponent(m[j + 1]); } catch (e) { return { bad: true }; }
        var pat = r.params && r.params[r.paramNames[j]];
        if (pat && !pat.test(raw)) return { bad: true };
        params[r.paramNames[j]] = raw;
      }
      return { route: r, params: params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }

  function handleApi(req, res, pathname, query, session) {
    var method = req.method;
    var isMutation = method !== 'GET' && method !== 'HEAD';

    if (pathname === '/api/auth/login') {
      if (method !== 'POST') return sendError(req, res, 405, 'METHOD_NOT_ALLOWED', 'method not allowed', null, { Allow: 'POST' });
      return handleLogin(req, res);
    }
    if (pathname === '/api/auth/logout') {
      if (method !== 'POST') return sendError(req, res, 405, 'METHOD_NOT_ALLOWED', 'method not allowed', null, { Allow: 'POST' });
      return handleLogout(req, res, session);
    }
    if (pathname === '/api/auth/session') {
      if (isMutation) return sendError(req, res, 405, 'METHOD_NOT_ALLOWED', 'method not allowed', null, { Allow: 'GET' });
      return handleSession(req, res, session);
    }

    var matched = matchRoute(method, pathname);
    if (pathname === '/api/paper/stream') matched = { stream: true };
    if (!matched) return sendError(req, res, 404, 'NOT_FOUND', 'no such API route');
    if (matched.bad) return sendError(req, res, 400, 'BAD_REQUEST', 'malformed path parameter');
    if (matched.methodNotAllowed) return sendError(req, res, 405, 'METHOD_NOT_ALLOWED', 'method not allowed for this route');

    var route = matched.route || { role: 'VIEWER', bucket: 'read', audit: null, path: '/api/paper/stream', method: 'GET' };
    var actor = actorOf(session, req);

    function refuseAudit(code) {
      if (isMutation && route.audit) {
        audit.record({ actor: actor, action: route.audit, target: route.path, outcome: 'REFUSED', code: code,
          fingerprintBefore: platform.control.config().fingerprint.hash, commit: platform.commit() });
      }
    }

    // 1. authenticate
    if (route.role !== null && !session) {
      refuseAudit('UNAUTHENTICATED');
      var h = auth.hasSessionCookie(req) ? { 'Set-Cookie': auth.clearedCookie() } : null;
      return sendError(req, res, 401, 'UNAUTHENTICATED', 'sign in to use this API', null, h);
    }
    // 2. CSRF + origin, for anything that is not a read
    if (isMutation) {
      if (!originAllowed(req)) {
        refuseAudit('CROSS_ORIGIN');
        return sendError(req, res, 403, 'CROSS_ORIGIN', 'cross-origin requests are not accepted');
      }
      if (!auth.csrfMatches(session, req.headers['x-tcc-csrf'])) {
        refuseAudit('CSRF');
        return sendError(req, res, 403, 'CSRF', 'the request did not carry a valid CSRF token');
      }
    }
    // 3. rate limit
    var rl = limiter.hit(route.bucket || (isMutation ? 'write' : 'read'), session ? 'u:' + session.userId : 'c:' + clientKey(req));
    if (!rl.allowed) {
      refuseAudit('RATE_LIMITED');
      return sendError(req, res, 429, 'RATE_LIMITED', 'too many requests; slow down', null, { 'Retry-After': rl.retryAfterSeconds });
    }
    // 4. authorize
    if (route.role !== null && !authMod.roleAtLeast(session.role, route.role)) {
      refuseAudit('FORBIDDEN');
      return sendError(req, res, 403, 'FORBIDDEN', 'this action requires the ' + route.role + ' role');
    }

    if (matched.stream) {
      if (isMutation) return sendError(req, res, 405, 'METHOD_NOT_ALLOWED', 'method not allowed');
      return handleStream(req, res, session, query);
    }

    // 5. validate, 6. execute, 7. audit, 8. respond
    var bodyPromise = isMutation ? readBody(req) : Promise.resolve(null);
    bodyPromise.then(function (body) {
      var ctx = {
        req: req, params: matched.params, actor: session ? actor : null, session: session, body: body, query: {},
        systemDeps: { audit: audit, auth: auth, bind: bindInfo, publicOrigin: publicOrigin, webBuild: webBuild }
      };
      if (route.query) {
        var qv = validate.query(route.query, query);
        if (!qv.ok) throw httpError(400, 'VALIDATION_FAILED', 'invalid query parameters', { problems: qv.problems });
        ctx.query = qv.value;
      } else if (Object.keys(query).length) {
        throw httpError(400, 'VALIDATION_FAILED', 'this route takes no query parameters',
          { problems: Object.keys(query).slice(0, 5).map(function (k) { return { path: k.slice(0, 40), message: 'is not a known field' }; }) });
      }
      if (isMutation) {
        var bv = validate.check(route.body || validate.obj({}), body);
        if (!bv.ok) throw httpError(400, 'VALIDATION_FAILED', 'the request body is not valid', { problems: bv.problems });
      }

      var out = route.handler(ctx);
      if (!isMutation) return sendJSON(req, res, 200, { ok: true, result: out });

      var a = out.audit || {};
      var entry = null;
      if (!route.auditRefusalsOnly) {
        entry = audit.record({
          actor: actor, action: route.audit, target: a.target || route.path, outcome: 'ACCEPTED',
          reason: a.reason || (body && body.reason) || null, oldValue: a.oldValue, newValue: a.newValue, detail: a.detail,
          fingerprintBefore: a.fingerprintBefore || platform.control.config().fingerprint.hash,
          fingerprintAfter: a.fingerprintAfter || platform.control.config().fingerprint.hash,
          commit: platform.commit()
        });
      }
      sendJSON(req, res, out.status || 200, {
        ok: true, result: out.result, audit: entry ? { seq: entry.seq, hash: entry.hash, ts: entry.ts } : null
      });
    }).catch(function (e) {
      var status = statusFor(e);
      if (isMutation && route.audit) {
        audit.record({
          actor: actor, action: route.audit, target: route.path, outcome: status >= 500 ? 'FAILED' : 'REFUSED',
          code: status >= 500 ? 'INTERNAL' : (e.code || 'ERROR'),
          // The refusal's own message is the record of WHY, for designed refusals.
          detail: status >= 500 ? null : { message: String(e.message).slice(0, 600), problems: e.problems || null },
          fingerprintBefore: platform.control.config().fingerprint.hash, commit: platform.commit()
        });
      }
      respondError(req, res, e);
    });
  }

  // =====================================================================
  // the request handler
  // =====================================================================

  function onRequest(req, res) {
    req.tccId = crypto.randomBytes(8).toString('hex');
    req.tccStart = Date.now();
    res.on('finish', function () { access(req); });

    var method = req.method;
    if (['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'].indexOf(method) === -1) {
      return sendError(req, res, 405, 'METHOD_NOT_ALLOWED', 'method not allowed', null, { Allow: 'GET, HEAD, POST, PATCH' });
    }
    var raw = req.url || '/';
    if (raw.length > MAX_URL_LENGTH) return sendError(req, res, 414, 'URI_TOO_LONG', 'request URI too long');
    var qIndex = raw.indexOf('?');
    var pathname = qIndex === -1 ? raw : raw.slice(0, qIndex);
    var search = qIndex === -1 ? '' : raw.slice(qIndex + 1);
    req.tccPath = pathname.slice(0, 200);
    // Anything that is not a plain absolute path is refused outright. Static
    // files are looked up in a map, so this is belt and braces, not the guard.
    if (pathname[0] !== '/' || /[\0\\]|\/\/|\.\.|%2e|%2f|%5c|%00/i.test(pathname)) {
      return sendError(req, res, 400, 'BAD_REQUEST', 'malformed request path');
    }

    if (method === 'OPTIONS') {
      // No CORS: a preflight gets no Access-Control-* header, so the browser
      // blocks the cross-origin request it was asking about.
      res.writeHead(204, baseHeaders({ Allow: 'GET, HEAD, POST, PATCH', 'Content-Length': 0, 'Cache-Control': 'no-store' }));
      res.end();
      req.tccStatus = 204;
      return;
    }

    var session = auth.sessionFor(req);
    var query = parseQuery(search);

    if (pathname === '/api' || pathname.indexOf('/api/') === 0) {
      return handleApi(req, res, pathname, query, session);
    }

    if (method !== 'GET' && method !== 'HEAD') {
      return sendError(req, res, 405, 'METHOD_NOT_ALLOWED', 'method not allowed', null, { Allow: 'GET, HEAD' });
    }

    if (pathname === '/login') {
      if (session) return redirect(req, res, '/dashboard');
      return statics['/login.html'] ? serveFile(req, res, statics['/login.html'], 'no-store')
        : sendError(req, res, 404, 'NOT_FOUND', 'not found');
    }
    if (pathname === '/robots.txt' && !statics['/robots.txt']) {
      res.writeHead(200, baseHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }));
      res.end('User-agent: *\nDisallow: /\n');
      req.tccStatus = 200;
      return;
    }
    if (APP_ROUTES.indexOf(pathname) !== -1) {
      if (!session) return redirect(req, res, '/login');
      if (pathname === '/') return redirect(req, res, '/dashboard');
      return statics['/index.html'] ? serveFile(req, res, statics['/index.html'], 'no-store')
        : sendError(req, res, 404, 'NOT_FOUND', 'not found');
    }
    var entry = statics[pathname];
    if (!entry || pathname === '/index.html' || pathname === '/login.html' || pathname === '/build.json') {
      return sendError(req, res, 404, 'NOT_FOUND', 'not found');
    }
    if (!session && !PUBLIC_FILE_RE.test(pathname)) {
      return sendError(req, res, 401, 'UNAUTHENTICATED', 'sign in to use this console');
    }
    serveFile(req, res, entry);
  }

  function access(req) {
    if (!log) return;
    var status = req.tccStatus || 0;
    var mutation = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    if (!mutation && status < 400) return;      // quiet on successful reads
    log(JSON.stringify({ log: 'tcc.http', id: req.tccId, method: req.method, path: req.tccPath,
      status: status, ms: Date.now() - req.tccStart }));
  }

  var server = http.createServer(function (req, res) {
    try { onRequest(req, res); }
    catch (e) {
      try { respondError(req, res, e); } catch (e2) { try { res.destroy(); } catch (e3) { /* nothing left to do */ } }
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 64;
  server.maxConnections = 256;
  server.on('clientError', function (err, socket) {
    try { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); } catch (e) { /* socket already gone */ }
  });

  function listen(port, host) {
    return new Promise(function (resolve, reject) {
      server.once('error', reject);
      server.listen(port === undefined ? 0 : port, host || '127.0.0.1', function () {
        server.removeListener('error', reject);
        var a = server.address();
        bindInfo.host = a.address;
        bindInfo.port = a.port;
        resolve(a);
      });
    });
  }

  function close() {
    return new Promise(function (resolve) {
      platform.shutdown();
      server.close(function () { resolve(); });
      if (server.closeAllConnections) server.closeAllConnections();
    });
  }

  return {
    server: server,
    platform: platform,
    audit: audit,
    auth: auth,
    limiter: limiter,
    routes: routeTable,
    statics: statics,
    webDir: webDir,
    listen: listen,
    close: close
  };
}

function main() {
  var env = process.env;
  var port = parseInt(env.TCC_PORT || '8210', 10);
  var bind = env.TCC_BIND || '127.0.0.1';
  var app = create({
    stateDir: env.TCC_STATE_DIR || null,
    usersFile: env.TCC_USERS_FILE || null,
    publicOrigin: env.TCC_PUBLIC_ORIGIN || null,
    trustProxy: env.TCC_TRUST_PROXY === '1',
    testEnv: env.TCC_CHROME ? { TCC_CHROME: env.TCC_CHROME } : {}
  });
  app.listen(port, bind).then(function (addr) {
    var us = app.auth.userState();
    process.stdout.write(JSON.stringify({
      log: 'tcc.start', bind: addr.address, port: addr.port, commit: app.platform.commit(),
      mode: app.platform.control.mode(), web: path.basename(app.webDir),
      persistence: app.platform.state.describe().persistence, authProvisioned: us.provisioned, authReason: us.reason,
      liveExecution: 'NOT AVAILABLE'
    }) + '\n');
  }).catch(function (e) {
    process.stderr.write('mythos-trading-control-center: cannot listen: ' + e.message + '\n');
    process.exit(1);
  });
  function stop() {
    app.close().then(function () { process.exit(0); });
    setTimeout(function () { process.exit(0); }, 5000).unref();
  }
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) main();

module.exports = {
  create: create,
  CSP: CSP,
  SECURITY_HEADERS: SECURITY_HEADERS,
  APP_ROUTES: APP_ROUTES,
  PUBLIC_FILE_RE: PUBLIC_FILE_RE,
  MAX_BODY_BYTES: MAX_BODY_BYTES
};
