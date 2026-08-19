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

   EVERY ROUTE IS BEHIND A SERVER-SIDE SESSION (MOS-v2 M-01).

     · The MOS-1 login gate was client-side markup. It hid the console
       from a browser and hid nothing at all from `curl` — every /api/
       route answered anyone who asked. It is deleted, not extended.
     · auth.js resolves each request to a live session before any route
       is consulted. Without one, every /api/ path answers 401 and every
       other path answers 401 or, for the two navigable HTML paths, a
       302 to /login. Nothing under /api/ is exempt, including
       /api/health.
     · The four exceptions are the login page itself and the assets it
       needs to render: /login, /login.css, /login.js, /mythos.css and
       the logo. They are static files carrying no operational state,
       and they are named in PUBLIC_PATHS rather than pattern-matched.
     · POST /api/login is the one write route that may be called
       unauthenticated -- it is what authentication is. It is registered
       in the same explicit WRITE_ROUTES list as the other four, so the
       write surface is still one readable list and still cannot grow
       silently.
   ===================================================== */

var fs = require('fs');
var http = require('http');
var path = require('path');

var auth = require('./auth');
var upstream = require('./upstream');
var modelCatalog = require('./model-catalog');

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
  '/login': { file: path.join(WEB, 'login.html'), type: 'text/html; charset=utf-8' },
  '/login.html': { file: path.join(WEB, 'login.html'), type: 'text/html; charset=utf-8' },
  '/login.css': { file: path.join(WEB, 'login.css'), type: 'text/css; charset=utf-8' },
  '/login.js': { file: path.join(WEB, 'login.js'), type: 'application/javascript; charset=utf-8' },
  '/assets/logomythos.png': { file: path.join(REPO_ASSETS, 'logomythos.png'), type: 'image/png' }
};

// The only paths an unauthenticated request may read: the login page,
// the two stylesheets it composes from, its script, and the logo. Every
// one is a static file with no operational state in it. This is a
// membership check against a fixed list -- never a prefix, never a
// pattern -- for the same reason STATIC is a whitelist.
var PUBLIC_PATHS = {
  '/login': true,
  '/login.html': true,
  '/login.css': true,
  '/login.js': true,
  '/mythos.css': true,
  '/assets/logomythos.png': true
};

// `extra` exists for exactly two headers -- Set-Cookie and Location --
// and is applied after the security headers so a caller can add to them
// but the ordering never lets one be dropped by accident.
function head(res, code, type, length, extra) {
  var h = { 'Content-Type': type };
  Object.keys(SECURITY_HEADERS).forEach(function (k) { h[k] = SECURITY_HEADERS[k]; });
  if (length !== undefined) h['Content-Length'] = length;
  if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
  res.writeHead(code, h);
}

function sendJSON(res, code, obj, extra) {
  var body = JSON.stringify(obj);
  head(res, code, 'application/json; charset=utf-8', Buffer.byteLength(body), extra);
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
      // secretState() reports whether a usable console secret exists and,
      // if not, WHY -- 'unconfigured', 'unreadable', 'insecure_mode' or
      // 'missing'. Those are names of failure modes, never any part of a
      // value, and this route is itself behind the session, so only an
      // authenticated operator ever sees them.
      var secret = auth.secretState();
      ok(res, {
        version: VERSION,
        token_provisioned: !!upstream.loadToken(),
        auth: {
          secret_provisioned: secret.provisioned,
          secret_problem: secret.reason,
          session_ttl_ms: auth.ttlMs()
        },
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

  // MOS-3A: the dispatcher's own capacity/queue state, mirroring the
  // executor's GET /dispatcher through an explicit field pick. providers
  // comes from REAL_PROVIDERS -- this server's own single source of truth
  // for what actually runs, not the executor -- so the UI has one place to
  // read the runnable provider set from (removing the UI's own hardcoded
  // copy is stage MOS-3B, not this one).
  // MOS-v2 M-04: `profiles` names the three console-offered execution
  // profiles in safest-first order, each with the authorization the
  // browser is allowed to act on. repo-read and repo-test are always
  // authorized (read-only/test-only per the executor's own policy.js);
  // repo-write is authorized only when MOS_ALLOW_REPO_WRITE is exactly
  // 'true' in this process's environment, read fresh on every request so
  // the switch takes effect without a restart. The browser never computes
  // this itself -- it renders exactly what this field says.
  // MOS-v2 M-05: `models` is model-catalog.js's own enabledModels(), field-
  // picked to { provider, id, label, capability, recommended_task_types }.
  // A disabled entry (today, only gemini-2.5-pro) is never included, and
  // the `enabled` flag itself is never included either -- everything
  // served here is enabled by definition, so the field would say nothing
  // a caller couldn't already infer from presence in the list.
  '/api/dispatcher': function (res) {
    upstream.get('/dispatcher')
      .then(function (d) {
        var repoWriteAuthorized = process.env.MOS_ALLOW_REPO_WRITE === 'true';
        var profiles = CONSOLE_PROFILES.map(function (name) {
          return { name: name, authorized: name === 'repo-write' ? repoWriteAuthorized : true };
        });
        var models = modelCatalog.enabledModels().map(function (m) {
          return { provider: m.provider, id: m.id, label: m.label, capability: m.capability,
                   recommended_task_types: m.recommended_task_types };
        });
        ok(res, { running: d.running, max_parallel: d.max_parallel, queued: d.queued, providers: REAL_PROVIDERS,
                  profiles: profiles, models: models });
      })
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

// The deliberate exceptions to "GET/HEAD only", named here so none is ever
// confused with an accident. MOS-2 added the first (start a mission);
// MOS-2.1 added the second (cancel one); MOS-3A adds the third (dispatch
// one that is already QUEUED) — same shape, same discipline: a fixed,
// narrow payload, forwarded to an executor endpoint that already exists
// and is already safe, never a new capability invented at this layer. The
// browser never talks to a provider, never sees a credential, and cannot
// widen scope beyond what is hard-coded in each handler.
// MOS-v2 M-01 adds two more, and one of them carries the only
// `unauthenticated: true` flag in this file: POST /api/login IS the
// authentication step, so requiring a session to reach it would be a
// closed loop. Every other entry -- logout included -- is refused with
// 401 before its handler runs. The flag is explicit and per-route so
// that "which routes may be called without a session" is one grep, not
// an inference from control flow.
var TASK_ID_RE = '[a-z0-9][a-z0-9-]{6,62}[a-z0-9]';
var CANCEL_ROUTE_RE = new RegExp('^/api/missions/(' + TASK_ID_RE + ')/cancel$');
var DISPATCH_ROUTE_RE = new RegExp('^/api/missions/(' + TASK_ID_RE + ')/dispatch$');
var WRITE_ROUTES = [
  { test: function (p) { return p === '/api/login' ? [] : null; }, handler: handleLogin, unauthenticated: true },
  { test: function (p) { return p === '/api/logout' ? [] : null; }, handler: handleLogout },
  { test: function (p) { return p === '/api/missions/start' ? [] : null; }, handler: handleStartMission },
  { test: function (p) { var m = CANCEL_ROUTE_RE.exec(p); return m ? [m[1]] : null; }, handler: handleMissionCancel },
  { test: function (p) { var m = DISPATCH_ROUTE_RE.exec(p); return m ? [m[1]] : null; }, handler: handleMissionDispatch }
];

function matchWriteRoute(pathname) {
  for (var i = 0; i < WRITE_ROUTES.length; i++) {
    var args = WRITE_ROUTES[i].test(pathname);
    if (args) return { handler: WRITE_ROUTES[i].handler, args: args, unauthenticated: WRITE_ROUTES[i].unauthenticated === true };
  }
  return null;
}

// --- MOS-v2 M-01: the authentication boundary -------------------------

// One refusal shape for every unauthenticated request, whatever the
// reason: no cookie, an unknown session, an expired one. The client
// cannot tell them apart, and it does not need to -- the answer is
// always "log in". A cookie that WAS presented and did not resolve is
// cleared on the way out, so a browser holding an expired session does
// not keep sending it until it ages out on its own.
function unauthenticated(res, staleCookie) {
  sendJSON(res, 401, { ok: false, error: 'unauthenticated', detail: 'authentication required' },
           staleCookie ? { 'Set-Cookie': auth.clearedCookie() } : undefined);
}

// The two navigable HTML paths get a redirect instead of a bare 401,
// because an operator who typed the URL should land on the login form
// rather than on a JSON error. Nothing else in this server redirects:
// /app.js, /console.css, /modules.js and every /api/ path answer 401,
// because a redirect to an HTML page is a useless answer to a fetch.
function redirect(res, location, staleCookie) {
  var extra = { Location: location };
  if (staleCookie) extra['Set-Cookie'] = auth.clearedCookie();
  head(res, 302, 'text/plain; charset=utf-8', 0, extra);
  res.end();
}

var LOGIN_MAX_BODY = 4 * 1024;
var LOGIN_FIELDS = ['password'];

/* POST /api/login. The only route that may be reached without a
   session, and the only place a password is ever accepted.

   What it does NOT do is as much of the design as what it does:

     · It never says why a login failed. A wrong password, a secret file
       that is missing, unreadable or group-readable, and a console with
       no secret configured at all are one answer -- 401
       invalid_credentials. The operator diagnoses configuration from
       /api/health and the journal, both of which are behind the
       session; an anonymous caller learns nothing about the deployment.
     · It never echoes the submitted password, in the response or in a
       log line.
     · It never sends the session identifier anywhere JavaScript can
       read it. The identifier exists only in the Set-Cookie header, and
       the response body carries an expiry timestamp and nothing else. */
function handleLogin(req, res) {
  if (!auth.loginAllowed(req)) {
    sendJSON(res, 429, { ok: false, error: 'too_many_attempts',
                         detail: 'too many failed sign-in attempts; wait and try again' });
    return;
  }
  readBoundedBody(req, LOGIN_MAX_BODY).then(function (raw) {
    var payload;
    try { payload = JSON.parse(raw || '{}'); }
    catch (e) { return badRequest(res, 'body is not valid JSON'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return badRequest(res, 'body must be a JSON object');
    }
    var unexpected = Object.keys(payload).filter(function (k) { return LOGIN_FIELDS.indexOf(k) === -1; });
    if (unexpected.length) return badRequest(res, 'unexpected field: ' + unexpected[0].slice(0, 40));

    var password = payload.password;
    if (typeof password !== 'string' || !password || password.length > 512) {
      return badRequest(res, 'password (string, 1-512 chars) is required');
    }

    if (!auth.verifyPassword(password).ok) {
      auth.recordLoginFailure(req);
      sendJSON(res, 401, { ok: false, error: 'invalid_credentials', detail: 'invalid credentials' });
      return;
    }

    auth.clearLoginFailures(req);
    // A caller who already holds a session gets a new identifier and the
    // old one is dropped: signing in again rotates, it does not
    // accumulate.
    var previous = auth.sessionIdFrom(req);
    if (previous) auth.destroySession(previous);
    var session = auth.createSession();
    sendJSON(res, 200, { ok: true, at: new Date().toISOString(),
                         data: { authenticated: true, expires_at: new Date(session.expiresAt).toISOString() } },
             { 'Set-Cookie': auth.sessionCookie(session.id) });
  }).catch(function (e) {
    if (e && e.message === 'BODY_TOO_LARGE') return badRequest(res, 'request body too large');
    problem(res, { code: 'internal_error', message: 'internal error' });
  });
}

/* POST /api/logout. Requires a session, because ending one you do not
   hold is not an operation. The server-side entry is destroyed first --
   clearing the cookie alone would leave a live session behind for
   anyone who kept a copy of the identifier. */
function handleLogout(req, res) {
  readBoundedBody(req, 1024).then(function () {
    auth.destroySession(auth.sessionIdFrom(req));
    sendJSON(res, 200, { ok: true, at: new Date().toISOString(), data: { authenticated: false } },
             { 'Set-Cookie': auth.clearedCookie() });
  }).catch(function () {
    problem(res, { code: 'internal_error', message: 'internal error' });
  });
}

// Read-only detail relays: mirror the executor's own GET /tasks/<id> and
// GET /tasks/<id>/report verbatim in shape, through an explicit field
// allowlist (same discipline as agentsView below) rather than passing an
// upstream object straight to the browser. GET, so these need no entry in
// WRITE_ROUTES and touch no part of the read-only guarantee.
var TASK_DETAIL_RE = new RegExp('^/api/missions/(' + TASK_ID_RE + ')$');
var TASK_REPORT_RE = new RegExp('^/api/missions/(' + TASK_ID_RE + ')/report$');

// --- MOS-2: the one write relay --------------------------------------

var START_MISSION_MAX_BODY = 32 * 1024;
var REAL_PROVIDERS = ['claude-code', 'openai-compat']; // the real, currently
  // runnable enum -- excludes 'mock' (test-only, unreachable in production)
  // and excludes 'gemini' (registered in the agent registry but genuinely
  // unconfigured -- no credential exists -- and not in the Phase 1 provider
  // enum at all). Never invent a name beyond what actually runs.
// MOS-v2 M-04: the console's own execution-profile allowlist, safest first.
// This is a SUBSET of what the executor's lib/policy.js recognises
// ('autonomous' and 'deploy' are never offered here at all) and the console
// enforces it independently -- the executor would refuse an unknown or
// disabled profile too, but a request this server already knows to reject
// should never reach it. 'repo-read' is the default when the field is
// absent. 'repo-write' additionally requires MOS_ALLOW_REPO_WRITE (see
// handleStartMission); repo-read and repo-test need no extra authorization.
var CONSOLE_PROFILES = ['repo-read', 'repo-test', 'repo-write'];
var START_MISSION_FIELDS = ['title', 'instruction', 'provider', 'model', 'execution_profile'];

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
// console operates on), requested_by (identifies the console, distinct
// from 'orchestration-core' so this task is never mistaken for one the
// Phase 2 core owns and drives itself), mode (the executor's own existing
// default). The browser supplies only title/instruction/provider/model and,
// optionally, execution_profile. MOS-v2 M-05: `model` is validated below
// against model-catalog.js's own enabled entries, not accepted as
// free-form text -- see the comment at that check. `execution_profile` is
// validated below against CONSOLE_PROFILES
// (MOS-v2 M-04) and, for 'repo-write', against MOS_ALLOW_REPO_WRITE. The
// executor's own lib/policy.js is the structural enforcement of what each
// profile can actually do; this validation exists so a request this server
// already knows to refuse never reaches it.
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
    // MOS-v2 M-05: model is no longer free-form. Omitted or null relays
    // null to the executor -- each provider's own default applies
    // (documented in the providers/ directory; openai-compat's own code defaults to
    // 'gpt-4o-mini' when task.model is null). Present, it must be a string
    // AND pass modelCatalog.isAllowed(provider, model) -- an enabled
    // catalog entry matching BOTH this provider and this exact id. This
    // check is intentionally placed after the provider check above, so an
    // unknown-model error can name the allowed set for the provider that
    // was actually chosen, not some other provider's list.
    var model = payload.model;
    if (model !== undefined && model !== null) {
      if (typeof model !== 'string' || !modelCatalog.isAllowed(provider, model)) {
        var allowedForProvider = modelCatalog.enabledModels()
          .filter(function (m) { return m.provider === provider; })
          .map(function (m) { return m.id; });
        return badRequest(res, 'model must be one of: ' + allowedForProvider.join(', ') + ' (for provider ' + provider + ')');
      }
    }

    // MOS-v2 M-04: 'repo-read' is the default ceiling when the field is
    // absent. Present, it must be exactly one of CONSOLE_PROFILES --
    // case-sensitive, no coercion -- or the request is refused before it
    // ever reaches the executor.
    var profile = 'repo-read';
    if (payload.execution_profile !== undefined) {
      if (typeof payload.execution_profile !== 'string' || CONSOLE_PROFILES.indexOf(payload.execution_profile) === -1) {
        return badRequest(res, 'execution_profile must be one of: ' + CONSOLE_PROFILES.join(', '));
      }
      profile = payload.execution_profile;
    }
    // repo-write is the one profile that can change files, so it carries
    // its own explicit server-side authorization, read fresh from the
    // environment on every request rather than cached at startup -- an
    // operator flipping the switch takes effect without a restart, in
    // either direction. This is a distinct failure from a malformed
    // request (400 bad_request): the request is well-formed and the
    // profile is real, it is simply not switched on here.
    if (profile === 'repo-write' && process.env.MOS_ALLOW_REPO_WRITE !== 'true') {
      sendJSON(res, 403, { ok: false, error: 'profile_not_authorized',
                           detail: 'repo-write is not authorized on this console' });
      return;
    }

    return upstream.post('/tasks', {
      project: 'mythos-prod',
      stage: title.trim().slice(0, 200),
      instruction: instruction,
      provider: provider,
      model: model || null,
      requested_by: 'mos-console',
      execution_profile: profile,
      expected_delivery: 'report'
    }).then(function (created) {
      var taskId = created && created.task_id;
      if (!taskId) return problem(res, { code: 'upstream_error', message: 'executor did not return a task id' });
      // MOS-3A: the explicit start goes through the executor's capacity-
      // gated dispatcher (POST /tasks/<id>/dispatch), not the old
      // unconditional /resume -- runTask() itself still has no cross-task
      // lock, but now a central in-process counter admits at most
      // MAX_PARALLEL tasks at once, and this console mission is one
      // candidate among possibly several, not a guaranteed immediate start.
      return upstream.post('/tasks/' + taskId + '/dispatch', {})
        .then(function (dispatched) {
          if (dispatched && dispatched.dispatched) {
            return ok(res, { task_id: taskId, status: 'RUNNING', provider: provider, model: model || null });
          }
          if (dispatched && dispatched.queued) {
            return ok(res, { task_id: taskId, status: 'QUEUED', provider: provider, model: model || null,
              note: 'created; at capacity (' + dispatched.running + '/' + dispatched.max_parallel + ')' +
                ' — will start automatically when a slot frees' });
          }
          // Unrecognised shape from the executor: fall back to the same
          // honest "queued, will run" note as an outright dispatch failure.
          ok(res, { task_id: taskId, status: 'QUEUED', provider: provider, model: model || null,
            note: 'created; the explicit start call did not confirm, but the task is queued and will run' });
        })
        .catch(function () {
          // Created but the explicit dispatch call failed (e.g. a race with
          // the daemon's own tick, or the executor briefly unreachable).
          // The task is still safely QUEUED and will run on the next tick
          // or the drain triggered by another task freeing a slot -- this
          // is not a failure to report as one.
          ok(res, { task_id: taskId, status: 'QUEUED', provider: provider, model: model || null,
            note: 'created; the explicit start call did not confirm, but the task is queued and will run' });
        });
    }).catch(function (e) { problem(res, e); });
  }).catch(function (e) {
    if (e && e.message === 'BODY_TOO_LARGE') return badRequest(res, 'request body too large');
    problem(res, { code: 'internal_error', message: 'internal error' });
  });
}

// --- MOS-2.1: execution lifecycle -- two read relays, one cancel relay --

// Mirrors GET /tasks/<id> through an explicit field allowlist, the same
// discipline as agentsView above: an unrecognised upstream field is
// dropped silently rather than passed through by default. Nothing in
// task.json or status.json is a credential (verified in MOS-2's audit;
// claude_session_id is already served today via /api/missions's own
// summaries()), but the allowlist is kept anyway so this relay cannot
// start leaking a field added to either file for an unrelated reason.
var TASK_DETAIL_TASK_FIELDS = ['task_id', 'project', 'stage', 'instruction', 'provider', 'model', 'priority', 'execution_profile', 'created_at'];
var TASK_DETAIL_STATUS_FIELDS = ['status', 'started_at', 'ended_at', 'last_error', 'next_action', 'execution_id', 'retry_count'];

function pick(src, fields) {
  var out = {};
  fields.forEach(function (f) { if (src && Object.prototype.hasOwnProperty.call(src, f)) out[f] = src[f]; });
  return out;
}

function handleMissionDetail(res, taskId) {
  upstream.get('/tasks/' + taskId).then(function (d) {
    ok(res, {
      task: pick(d.task, TASK_DETAIL_TASK_FIELDS),
      status: pick(d.status, TASK_DETAIL_STATUS_FIELDS),
      effective: d.effective
    });
  }).catch(function (e) { problem(res, e); });
}

// Mirrors GET /tasks/<id>/report. Only the two required report fields
// (status, summary) plus problems (structural validation/git-verification
// findings -- strings about report validity, never file content or a
// credential) are surfaced; provider_result_tail and git detail are not.
function handleMissionReport(res, taskId) {
  upstream.get('/tasks/' + taskId + '/report').then(function (d) {
    var report = (d && d.report && d.report.report) || null;
    ok(res, {
      status: report ? report.status : null,
      summary: report ? report.summary : null,
      next_stage: report ? report.next_stage : null,
      problems: (d && d.report && d.report.problems) || []
    });
  }).catch(function (e) { problem(res, e); });
}

// The cancel relay takes no payload beyond the task id already validated
// by the route regex -- there is nothing for the browser to supply, so
// nothing is read from the body except to drain it.
function handleMissionCancel(req, res, taskId) {
  readBoundedBody(req, 1024).then(function () {
    return upstream.post('/tasks/' + taskId + '/cancel', {});
  }).then(function (d) {
    ok(res, { task_id: taskId, status: (d && d.status) || 'CANCELLED' });
  }).catch(function (e) { problem(res, e); });
}

// --- MOS-3A: the dispatch relay --------------------------------------

// Same shape as the cancel relay above: no payload beyond the task id
// already validated by the route regex, so nothing is read from the body
// except to drain it. Forwards to the executor's capacity-gated
// POST /tasks/<id>/dispatch and hands back only an explicit field pick --
// the upstream object is never passed through verbatim.
var MISSION_DISPATCH_FIELDS = ['task_id', 'dispatched', 'queued', 'running', 'max_parallel'];

function handleMissionDispatch(req, res, taskId) {
  readBoundedBody(req, 1024).then(function () {
    return upstream.post('/tasks/' + taskId + '/dispatch', {});
  }).then(function (d) {
    ok(res, pick(d, MISSION_DISPATCH_FIELDS));
  }).catch(function (e) { problem(res, e); });
}

function handler(req, res) {
  var reqPathname = String(req.url || '/').split('?')[0];
  var writeMatch = req.method === 'POST' ? matchWriteRoute(reqPathname) : null;
  if (req.method !== 'GET' && req.method !== 'HEAD' && !writeMatch) {
    // Refused before routing. Every path but the ones named above has no
    // write surface, and the refusal is the surface's definition rather
    // than a gap in it.
    head(res, 405, 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'read_only', detail: 'This console is read-only except for POST /api/login, POST /api/logout, POST /api/missions/start, POST /api/missions/<id>/cancel and POST /api/missions/<id>/dispatch.' }));
    return;
  }
  // --- the authentication boundary ---------------------------------
  //
  // Resolved once, here, before any route runs. Placing it after the
  // 405 check and before everything else is deliberate: the method
  // refusal above is structural (it is what makes this surface
  // read-only) and reveals nothing, so it stays first; from this line
  // on, no handler in this file executes for a caller without a
  // session, except the one route flagged unauthenticated.
  var session = auth.sessionFor(req);
  var staleCookie = !session && auth.hasSessionCookie(req);

  if (writeMatch) {
    if (!writeMatch.unauthenticated && !session) return unauthenticated(res, staleCookie);
    return writeMatch.handler.apply(null, [req, res].concat(writeMatch.args));
  }

  if (Object.prototype.hasOwnProperty.call(PUBLIC_PATHS, reqPathname)) {
    // An operator who already has a session and asks for the login page
    // is sent to the console instead of being shown a form they have no
    // reason to fill in.
    if (session && (reqPathname === '/login' || reqPathname === '/login.html')) return redirect(res, '/');
    return serveStatic(STATIC[reqPathname], res, req.method);
  }

  if (!session) {
    if (reqPathname === '/' || reqPathname === '/index.html') return redirect(res, '/login', staleCookie);
    return unauthenticated(res, staleCookie);
  }

  var split = String(req.url || '/').split('?');
  var pathname = split[0];
  var query = {};
  (split[1] || '').split('&').forEach(function (kv) {
    if (!kv) return;
    var p = kv.split('=');
    try { query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); } catch (e) { /* ignore */ }
  });

  var dm;
  if (req.method === 'GET' && (dm = TASK_REPORT_RE.exec(pathname))) {
    return handleMissionReport(res, dm[1]);
  }
  if (req.method === 'GET' && (dm = TASK_DETAIL_RE.exec(pathname))) {
    return handleMissionDetail(res, dm[1]);
  }

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

module.exports = { start: start, handler: handler, CSP: CSP, VERSION: VERSION, PUBLIC_PATHS: PUBLIC_PATHS };

if (require.main === module) {
  start().then(function (server) {
    var a = server.address();
    // The auth state is named, never valued. A console with no usable
    // secret still starts -- and still refuses every request, because
    // the boundary fails closed -- so that an operator sees WHY on the
    // first line of the journal instead of a unit that will not boot.
    var secret = auth.secretState();
    process.stdout.write('mythos-os-console ' + VERSION + ' listening on ' + a.address + ':' + a.port +
      ' → ' + upstream.target() + (upstream.loadToken() ? '' : ' (NO TOKEN — reads will report unauthorised)') +
      (secret.provisioned ? '' : ' (NO CONSOLE SECRET: ' + secret.reason +
        ' — every request will be refused until MOS_CONSOLE_SECRET_FILE names a 0600 file)') + '\n');
  });
}
