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

// The ONE deliberate exception to "GET/HEAD only", named here so it is
// never confused with an accident. MOS-2 adds a single narrow relay: the
// browser sends {title, instruction, provider, model?} and nothing else;
// this file fixes every other field (project, execution_profile, mode,
// working_directory) server-side and forwards to the executor's own,
// unmodified, already-safe /tasks and /tasks/<id>/resume endpoints. The
// browser never talks to a provider, never sees a credential, and cannot
// widen scope beyond what is hard-coded below.
var WRITE_ROUTES = { '/api/missions/start': true };

// --- MOS-2: the one write relay --------------------------------------

var START_MISSION_MAX_BODY = 32 * 1024;
var REAL_PROVIDERS = ['claude-code', 'openai-compat']; // the real, currently
  // runnable enum -- excludes 'mock' (test-only, unreachable in production)
  // and excludes 'gemini' (registered in the agent registry but genuinely
  // unconfigured -- no credential exists -- and not in the Phase 1 provider
  // enum at all). Never invent a name beyond what actually runs.
var START_MISSION_FIELDS = ['title', 'instruction', 'provider', 'model'];

function readBoundedBody(req, maxBytes) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on('data', function (d) {
      size += d.length;
      if (size > maxBytes) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function badRequest(res, detail) {
  sendJSON(res, 400, { ok: false, error: 'bad_request', detail: detail });
}

// Everything not in this function is fixed here, server-side, and never
// read from the request: project ('mythos-prod' -- the only project this
// console operates on), execution_profile ('repo-read' -- Write/Edit/
// NotebookEdit structurally disallowed by lib/policy.js regardless of what
// the instruction says), requested_by (identifies the console, distinct
// from 'orchestration-core' so this task is never mistaken for one the
// Phase 2 core owns and drives itself), mode (the executor's own existing
// default). The browser supplies only title/instruction/provider/model.
function handleStartMission(req, res) {
  readBoundedBody(req, START_MISSION_MAX_BODY).then(function (raw) {
    var payload;
    try { payload = JSON.parse(raw || '{}'); }
    catch (e) { return badRequest(res, 'body is not valid JSON'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return badRequest(res, 'body must be a JSON object');
    }
    var unexpected = Object.keys(payload).filter(function (k) { return START_MISSION_FIELDS.indexOf(k) === -1; });
    if (unexpected.length) return badRequest(res, 'unexpected field: ' + unexpected[0].slice(0, 40));

    var title = payload.title;
    if (typeof title !== 'string' || !title.trim() || title.length > 200) {
      return badRequest(res, 'title (string, 1-200 chars) is required');
    }
    var instruction = payload.instruction;
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 20000) {
      return badRequest(res, 'instruction (string, 1-20000 chars) is required');
    }
    var provider = payload.provider;
    if (REAL_PROVIDERS.indexOf(provider) === -1) {
      return badRequest(res, 'provider must be one of: ' + REAL_PROVIDERS.join(', '));
    }
    var model = payload.model;
    if (model !== undefined && model !== null && (typeof model !== 'string' || model.length > 100)) {
      return badRequest(res, 'model must be a string of at most 100 characters');
    }

    return upstream.post('/tasks', {
      project: 'mythos-prod',
      stage: title.trim().slice(0, 200),
      instruction: instruction,
      provider: provider,
      model: model || null,
      requested_by: 'mos-console',
      execution_profile: 'repo-read',
      expected_delivery: 'report'
    }).then(function (created) {
      var taskId = created && created.task_id;
      if (!taskId) return problem(res, { code: 'upstream_error', message: 'executor did not return a task id' });
      // Fire the explicit start now, independent of the daemon's own
      // 15-second tick and its own one-at-a-time policy for automatic
      // pickups -- this is what makes two missions genuinely concurrent:
      // runTask() itself has no cross-task lock, only the tick loop's own
      // background policy does, and an explicit /resume bypasses it.
      return upstream.post('/tasks/' + taskId + '/resume', {})
        .then(function () { ok(res, { task_id: taskId, status: 'RUNNING', provider: provider, model: model || null }); })
        .catch(function () {
          // Created but the explicit start call failed (e.g. a race with
          // the daemon's own tick). The task is still safely QUEUED and
          // will run on the next tick or a later manual resume -- this is
          // not a failure to report as one.
          ok(res, { task_id: taskId, status: 'QUEUED', provider: provider, model: model || null,
            note: 'created; the explicit start call did not confirm, but the task is queued and will run' });
        });
    }).catch(function (e) { problem(res, e); });
  }).catch(function (e) {
    if (e && e.message === 'BODY_TOO_LARGE') return badRequest(res, 'request body too large');
    problem(res, { code: 'internal_error', message: 'internal error' });
  });
}

function handler(req, res) {
  var isWriteRoute = req.method === 'POST' && Object.prototype.hasOwnProperty.call(WRITE_ROUTES, String(req.url || '').split('?')[0]);
  if (req.method !== 'GET' && req.method !== 'HEAD' && !isWriteRoute) {
    // Refused before routing. Every path but the one named above has no
    // write surface, and the refusal is the surface's definition rather
    // than a gap in it.
    head(res, 405, 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'read_only', detail: 'This console is read-only except for POST /api/missions/start.' }));
    return;
  }
  if (isWriteRoute) return handleStartMission(req, res);

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
