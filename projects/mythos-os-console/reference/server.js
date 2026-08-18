'use strict';
/* =====================================================
   MYTHOS OS COMMAND CENTER — server
   projects/mythos-os-console/reference/server.js

   A read-only HTTP surface for os.mythosprod.xyz. Built the same way as
   the two production services already in this repository
   (projects/idauto/reference/api.js, projects/ssangyong-autos/) — node
   http, no framework, no build step, no runtime dependency.

   THE READ-ONLY PROPERTY IS STRUCTURAL, NOT POLICY.

     · Only GET and HEAD are answered. Every other method gets 405
       before any route is consulted, so no handler can accidentally
       become a write path.
     · No request body is ever read. There is no readBody() in this
       file to call.
     · The upstream client exposes GET only.
     · tests/mos-1-console-test.js asserts all three at source level, so
       adding a write surface fails the suite rather than shipping
       quietly. Approvals, cancellation and campaign control stay where
       governance put them: owner-operated, on the host.

   STATIC FILES are served from an explicit whitelist, not by resolving
   a request path against a directory. There is no path to traverse.
   ===================================================== */

var fs = require('fs');
var http = require('http');
var path = require('path');

var upstream = require('./upstream');

var VERSION = 'mos-1';
var WEB = path.join(__dirname, 'web');
var REPO_ASSETS = process.env.MOS_ASSETS_DIR || path.join(__dirname, '..', '..', '..', 'assets', 'logos');

var DEFAULT_PORT = parseInt(process.env.MOS_PORT || '8140', 10);
var DEFAULT_BIND = process.env.MOS_BIND || '127.0.0.1';

// Content-Security-Policy.
//
// script-src and object-src are as strict as the sibling command-centre
// service: 'self' only, no inline script anywhere in the shell.
//
// style-src and font-src are deliberately WIDER than that service, and
// the reason is recorded rather than buried: the Mythos OS brand system
// (D-001, css/main.css + index.html:19) is set in Playfair Display and
// Inter, both loaded from Google Fonts by the production application.
// Serving the console in a different typeface to keep a tighter CSP
// would break the one thing this stage exists to preserve. The exposure
// is bounded — two font hosts, no script origin added, and mythos.css
// carries full local fallback stacks so a blocked request costs the
// typeface and nothing else. Self-hosting the two families removes this
// exception entirely and is recorded as the follow-up.
var CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join('; ');

var SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // The console renders live operational state. A cached copy of it is
  // a lie about the present.
  'Cache-Control': 'no-store'
};

var STATIC = {
  '/': { file: path.join(WEB, 'index.html'), type: 'text/html; charset=utf-8' },
  '/index.html': { file: path.join(WEB, 'index.html'), type: 'text/html; charset=utf-8' },
  '/mythos.css': { file: path.join(WEB, 'mythos.css'), type: 'text/css; charset=utf-8' },
  '/console.css': { file: path.join(WEB, 'console.css'), type: 'text/css; charset=utf-8' },
  '/modules.js': { file: path.join(WEB, 'modules.js'), type: 'application/javascript; charset=utf-8' },
  '/app.js': { file: path.join(WEB, 'app.js'), type: 'application/javascript; charset=utf-8' },
  '/login-gate.css': { file: path.join(WEB, 'login-gate.css'), type: 'text/css; charset=utf-8' },
  '/login-gate.js': { file: path.join(WEB, 'login-gate.js'), type: 'application/javascript; charset=utf-8' },
  '/assets/logomythos.png': { file: path.join(REPO_ASSETS, 'logomythos.png'), type: 'image/png' }
};

function head(res, code, type, length) {
  var h = { 'Content-Type': type };
  Object.keys(SECURITY_HEADERS).forEach(function (k) { h[k] = SECURITY_HEADERS[k]; });
  if (length !== undefined) h['Content-Length'] = length;
  res.writeHead(code, h);
}

function sendJSON(res, code, obj) {
  var body = JSON.stringify(obj);
  head(res, code, 'application/json; charset=utf-8', Buffer.byteLength(body));
  res.end(body);
}

function ok(res, data) {
  sendJSON(res, 200, { ok: true, at: new Date().toISOString(), data: data });
}

// One error shape for every failure, so the client has one branch.
// HTTP status carries the class; `error` carries the machine code the
// client renders a specific message for.
function problem(res, err) {
  var code = err && err.code ? err.code : 'internal_error';
  var status =
    code === 'upstream_unauthorized' ? 502 :
    code === 'upstream_unreachable' ? 503 :
    code === 'upstream_error' ? 502 :
    code === 'upstream_bad_json' ? 502 :
    code === 'upstream_too_large' ? 502 :
    code === 'config_unreadable' ? 503 :
    code === 'config_invalid' ? 500 :
    code === 'bad_request' ? 400 : 500;
  sendJSON(res, status, {
    ok: false,
    error: code,
    detail: code === 'internal_error' ? 'internal error' : String(err.message || '')
  });
}

function serveStatic(entry, res, method) {
  fs.readFile(entry.file, function (err, buf) {
    if (err) { sendJSON(res, 404, { ok: false, error: 'not_found', detail: 'not found' }); return; }
    head(res, 200, entry.type, buf.length);
    if (method === 'HEAD') { res.end(); return; }
    res.end(buf);
  });
}

// --- API ------------------------------------------------------------

function clampLimit(raw, def, max) {
  var n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) return def;
  return Math.min(n, max);
}

var API = {
  '/api/health': function (res) {
    upstream.health().then(function (up) {
      ok(res, {
        version: VERSION,
        token_provisioned: !!upstream.loadToken(),
        upstream: {
          ok: up.ok,
          reachable: up.reachable,
          target: up.target,
          error: up.error || null,
          detail: up.detail || null
        }
      });
    }).catch(function (e) { problem(res, e); });
  },

  '/api/missions': function (res) {
    upstream.get('/tasks')
      .then(function (b) { ok(res, { tasks: b.tasks || [] }); })
      .catch(function (e) { problem(res, e); });
  },

  '/api/campaigns': function (res) {
    upstream.get('/campaigns')
      .then(function (b) { ok(res, { campaigns: b.campaigns || [] }); })
      .catch(function (e) { problem(res, e); });
  },

  '/api/events': function (res, query) {
    var limit = clampLimit(query.limit, 50, 500);
    upstream.get('/events?limit=' + limit)
      .then(function (b) { ok(res, { events: (b.events || []).slice(0, limit) }); })
      .catch(function (e) { problem(res, e); });
  },

  '/api/budget': function (res) {
    upstream.budgetAll()
      .then(function (projects) { ok(res, { projects: projects }); })
      .catch(function (e) { problem(res, e); });
  },

  '/api/agents': function (res) {
    upstream.readConfig('agents.json')
      .then(function (agents) { ok(res, { agents: upstream.agentsView(agents) }); })
      .catch(function (e) { problem(res, e); });
  },

  '/api/providers': function (res) {
    Promise.all([upstream.readConfig('router.json'), upstream.readConfig('agents.json')])
      .then(function (r) {
        ok(res, { router: r[0], providers: upstream.providersFrom(r[1]) });
      })
      .catch(function (e) { problem(res, e); });
  },

  '/api/roadmap': function (res) {
    upstream.readConfig('roadmap-state.json')
      .then(function (state) { ok(res, { capabilities: state.capabilities || {} }); })
      .catch(function (e) { problem(res, e); });
  },

  // The module registry, served so that an operator, a monitor or a
  // future MYTHOS OS module can ask the console what modules exist and
  // which are actually built — without scraping the page.
  '/api/modules': function (res) {
    try {
      var registry = require(path.join(WEB, 'modules.js'));
      ok(res, { modules: registry.modules, sections: registry.sections });
    } catch (e) { problem(res, { code: 'internal_error', message: 'registry unavailable' }); }
  }
};

function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Refused before routing. This console has no write surface, and
    // the refusal is the surface's definition rather than a gap in it.
    head(res, 405, 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'read_only', detail: 'This console is read-only; only GET and HEAD are served.' }));
    return;
  }

  var split = String(req.url || '/').split('?');
  var pathname = split[0];
  var query = {};
  (split[1] || '').split('&').forEach(function (kv) {
    if (!kv) return;
    var p = kv.split('=');
    try { query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); } catch (e) { /* ignore */ }
  });

  if (Object.prototype.hasOwnProperty.call(API, pathname)) {
    try { API[pathname](res, query); }
    catch (e) { problem(res, { code: 'internal_error', message: 'internal error' }); }
    return;
  }

  if (Object.prototype.hasOwnProperty.call(STATIC, pathname)) {
    serveStatic(STATIC[pathname], res, req.method);
    return;
  }

  // Client-side routes are hash-based (#/missions), so a deep path is a
  // genuine 404 and is not rewritten to the shell.
  sendJSON(res, 404, { ok: false, error: 'not_found', detail: 'not found' });
}

function start(opts) {
  opts = opts || {};
  var port = opts.port !== undefined ? opts.port : DEFAULT_PORT;
  var bind = opts.bind || DEFAULT_BIND;
  var server = http.createServer(handler);
  return new Promise(function (resolve) {
    server.listen(port, bind, function () { resolve(server); });
  });
}

module.exports = { start: start, handler: handler, CSP: CSP, VERSION: VERSION };

if (require.main === module) {
  start().then(function (server) {
    var a = server.address();
    process.stdout.write('mythos-os-console ' + VERSION + ' listening on ' + a.address + ':' + a.port +
      ' → ' + upstream.target() + (upstream.loadToken() ? '' : ' (NO TOKEN — reads will report unauthorised)') + '\n');
  });
}
