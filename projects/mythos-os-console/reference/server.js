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

   THE GOAL LAYER IS APPROVAL-FIRST (MOS-v2 M-09).

     · A goal submitted here is relayed with require_plan_approval fixed
       true, server-side, on every request. The executor answers by
       building the proposed plan, attaching it, and parking the campaign
       in WAITING_FOR_APPROVAL BEFORE any mission starts. The AI may
       propose; it never authorises itself.
     · The only exit from that state is POST /api/goals/<id>/approvals --
       an explicit boolean decision by a signed-in operator, with the
       decider identity composed from the SESSION and never from the
       payload.
     · Dispatch remains the executor's own continueCampaign, which
       refuses WAITING_FOR_APPROVAL and BLOCKED. No planner, queue,
       dispatcher or approval store is duplicated at this layer.

   EVERY WRITE IS AUDITED (MOS-v2 M-07).

     · audit.js writes one append-only JSON line to stdout for each
       state-changing action -- sign-in (success, failure, throttled),
       sign-out, mission start (accepted, rejected, profile-denied,
       upstream failure), cancel and dispatch -- plus every write refused
       for want of a session. Reads are not audited; they change nothing.
     · The line carries a truncated actor, never a session identifier in
       full, never a password, and never instruction or title text. That
       is enforced by an allowlist inside audit.js, not by discipline at
       the call sites here.
   ===================================================== */

var fs = require('fs');
var http = require('http');
var path = require('path');

var auth = require('./auth');
var audit = require('./audit');
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
  '/mission-report.js': { file: path.join(WEB, 'mission-report.js'), type: 'application/javascript; charset=utf-8' },
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

/* MOS-v2 M-07: the executor's own /health body, reduced to an explicit
   shape before it is served.

   Every other relay in this file field-picks what it forwards (agentsView,
   TASK_DETAIL_*_FIELDS, MISSION_DISPATCH_FIELDS) precisely so a field
   added upstream for an unrelated reason cannot become a console
   response. The health body was the one exception: whatever the executor
   returned was passed through verbatim. Nothing in it is a credential
   today -- executor.health() reports a store-writability boolean, a CLI
   version string, two loopback probe results and a status histogram -- so
   this closes a passthrough, not an active leak. The queue histogram is
   copied key by key, admitting only the executor's own uppercase status
   names with numeric counts, because it is the one map here whose keys
   are not known in advance. */
function upstreamHealthView(detail) {
  if (!detail || typeof detail !== 'object') return null;
  var checks = (detail.checks && typeof detail.checks === 'object') ? detail.checks : {};
  var queue = {};
  Object.keys((checks.queue && typeof checks.queue === 'object') ? checks.queue : {}).forEach(function (k) {
    if (/^[A-Z_]{3,32}$/.test(k) && typeof checks.queue[k] === 'number') queue[k] = checks.queue[k];
  });
  return {
    ok: detail.ok === true,
    time: typeof detail.time === 'string' ? detail.time : null,
    checks: {
      store_writable: checks.store_writable === true,
      claude_cli: typeof checks.claude_cli === 'string' ? checks.claude_cli : null,
      n8n: !!(checks.n8n && checks.n8n.ok),
      omniroute: !!(checks.omniroute && checks.omniroute.ok),
      queue: queue
    }
  };
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
          detail: upstreamHealthView(up.detail)
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
                  profiles: profiles, models: models,
                  // MOS-v2 M-11: the UI renders the auto-routing choice
                  // ONLY from this field -- no client-side assumption that
                  // routing exists. `enabled` names whether the server
                  // offers it at all (always true today; a future kill
                  // switch flips one boolean here, nothing in the browser);
                  // `task_types` is the exact, exhaustive set the browser
                  // may send back as `task_type` when provider is 'auto'.
                  auto_routing: { enabled: true, task_types: CONSOLE_TASK_TYPES } });
      })
      .catch(function (e) { problem(res, e); });
  },

  '/api/campaigns': function (res) {
    upstream.get('/campaigns')
      .then(function (b) { ok(res, { campaigns: b.campaigns || [] }); })
      .catch(function (e) { problem(res, e); });
  },

  // MOS-v2 M-09: the goal layer's list view. Same upstream source as
  // /api/campaigns -- one control plane, one campaign store -- but
  // field-picked to the summary a goal list needs, so the two relays
  // cannot drift into two shapes of the same thing by accident.
  '/api/goals': function (res) {
    upstream.get('/campaigns')
      .then(function (b) { ok(res, { goals: pickList(b && b.campaigns, GOAL_SUMMARY_FIELDS) }); })
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
// MOS-v2 M-09: a campaign id, exactly as the executor's own route regex
// spells it. Narrower than TASK_ID_RE on purpose -- a goal route may only
// ever address a campaign, and an id that does not look like one is not
// forwarded to the control plane at all.
var CAMPAIGN_ID_RE = 'c-[a-z0-9-]{8,40}';
var GOAL_DETAIL_RE = new RegExp('^/api/goals/(' + CAMPAIGN_ID_RE + ')$');
var GOAL_APPROVE_ROUTE_RE = new RegExp('^/api/goals/(' + CAMPAIGN_ID_RE + ')/approvals$');
var GOAL_CONTINUE_ROUTE_RE = new RegExp('^/api/goals/(' + CAMPAIGN_ID_RE + ')/continue$');
var WRITE_ROUTES = [
  { test: function (p) { return p === '/api/login' ? [] : null; }, handler: handleLogin, unauthenticated: true },
  { test: function (p) { return p === '/api/logout' ? [] : null; }, handler: handleLogout },
  { test: function (p) { return p === '/api/missions/start' ? [] : null; }, handler: handleStartMission },
  { test: function (p) { var m = CANCEL_ROUTE_RE.exec(p); return m ? [m[1]] : null; }, handler: handleMissionCancel },
  { test: function (p) { var m = DISPATCH_ROUTE_RE.exec(p); return m ? [m[1]] : null; }, handler: handleMissionDispatch },
  { test: function (p) { return p === '/api/goals' ? [] : null; }, handler: handleGoalCreate },
  { test: function (p) { var m = GOAL_APPROVE_ROUTE_RE.exec(p); return m ? [m[1]] : null; }, handler: handleGoalApproval },
  { test: function (p) { var m = GOAL_CONTINUE_ROUTE_RE.exec(p); return m ? [m[1]] : null; }, handler: handleGoalContinue }
];

// The audit label for a matched write route. Derived from the same two
// regexes and the same two literals WRITE_ROUTES uses, so a route added
// there without a label here reads as 'write' rather than as something
// else's name.
function writeRouteLabel(pathname) {
  if (pathname === '/api/login') return 'login';
  if (pathname === '/api/logout') return 'logout';
  if (pathname === '/api/missions/start') return 'mission.start';
  if (CANCEL_ROUTE_RE.test(pathname)) return 'mission.cancel';
  if (DISPATCH_ROUTE_RE.test(pathname)) return 'mission.dispatch';
  if (pathname === '/api/goals') return 'goal.create';
  if (GOAL_APPROVE_ROUTE_RE.test(pathname)) return 'goal.approve';
  if (GOAL_CONTINUE_ROUTE_RE.test(pathname)) return 'goal.continue';
  return 'write';
}

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
    audit.record({ action: 'login', outcome: 'throttled' });
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
      // The reason the VERDICT was negative is never logged either -- a
      // wrong password and an unreadable secret file are one line here,
      // exactly as they are one response to the caller. The operator
      // diagnoses configuration from /api/health, not from the audit log.
      audit.record({ action: 'login', outcome: 'invalid_credentials' });
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
    // The NEW session is the actor: every later action by this operator
    // carries the same truncated prefix, so a sign-in and the missions
    // that followed it read as one sequence.
    audit.record({ action: 'login', outcome: 'success', actor: session.id });
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
    var ending = auth.sessionIdFrom(req);
    auth.destroySession(ending);
    audit.record({ action: 'logout', outcome: 'success', actor: ending });
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
// MOS-v2 M-06: the executor's own fixed priority vocabulary
// (PRIORITY_WEIGHT), mirrored here for validation only -- this server does
// not invent an ordering, it just refuses anything the executor would not
// recognise before the request ever reaches it.
var CONSOLE_PRIORITIES = ['high', 'normal', 'low'];
// MOS-v2 M-11: the governed auto-routing task-type vocabulary. This is
// exactly planner.js's own TASK_TYPES (projects/mythos-ai-executor/core/
// planner.js) -- named as its own list rather than required from the
// executor's files (upstream.js reads config, never code, from the
// executor; this preserves that boundary) but never allowed to drift from
// it, because both are pinned by tests/mos-1-console-test.js. Provider is
// never one of these -- 'auto' means the SERVER picks the provider, not
// that the browser picks nothing.
var CONSOLE_TASK_TYPES = ['inspection', 'research', 'analysis', 'design', 'coding',
  'testing', 'review', 'integration', 'validation', 'documentation',
  'reporting', 'marketing', 'generic'];

// Simplified mission flow: when the operator picks 'auto' and names no
// task_type, the type is inferred HERE, server-side, from the title +
// instruction text -- the same ordered keyword-rule idiom the executor's
// own lib/skills.js uses for skill selection. First match wins, every
// answer is a member of CONSOLE_TASK_TYPES, and nothing matching fails
// CLOSED to 'generic' -- the vocabulary's own documented catch-all (the
// skill registry defines generic as "the default when no more specific
// rule matched"). This inference feeds ONLY the provider router (M-11):
// it never touches execution_profile, task_category, model or any
// authorization check, so an instruction can influence WHICH provider is
// asked to run it, never what that run is allowed to do -- the M-04
// profile gate and MOS_ALLOW_REPO_WRITE run exactly as before, on the
// operator's explicit field or the repo-read default, blind to this text.
var TASK_TYPE_RULES = [
  { type: 'testing', re: /\btests?\b|\btesting\b|regression|coverage/ },
  { type: 'review', re: /\breview\b|\baudit\b|pull request/ },
  { type: 'documentation', re: /\bdocument|\bdocs\b|readme|changelog/ },
  { type: 'validation', re: /validat|\bverify\b|verification/ },
  { type: 'research', re: /\bresearch\b|investigate|\bsurvey\b|\bcompare\b/ },
  { type: 'design', re: /\bdesign\b|architect/ },
  { type: 'coding', re: /implement|refactor|\bfix\b|\bbug\b|\bbuild\b|\bcode\b|\bcoding\b|\bfeature\b/ },
  { type: 'analysis', re: /analy[sz]/ },
  { type: 'inspection', re: /\binspect|read-only/ },
  { type: 'reporting', re: /\breport\b|summar/ }
];

function inferTaskType(title, instruction) {
  var text = (String(title || '') + ' ' + String(instruction || '')).toLowerCase();
  for (var i = 0; i < TASK_TYPE_RULES.length; i++) {
    if (TASK_TYPE_RULES[i].re.test(text)) return TASK_TYPE_RULES[i].type;
  }
  return 'generic';
}
// M-12: the runtime skill registry's own category vocabulary
// (projects/mythos-ai-executor/config/skills.json's categories, one per
// skill), hardcoded here rather than fetched over a network call — the
// registry is this list's SOURCE OF TRUTH; a category added there must be
// added here too, and tests/mos-1-console-test.js pins both to the same
// content so the two cannot silently drift. task_category is optional and,
// when present, is relayed to the executor verbatim; skill selection
// itself is entirely server-side from there (lib/skills.js selectSkill),
// never something this console computes or chooses.
var CONSOLE_TASK_CATEGORIES = ['security', 'frontend', 'testing', 'github-review', 'general'];
var START_MISSION_FIELDS = ['title', 'instruction', 'provider', 'model', 'execution_profile', 'priority', 'task_type', 'task_category'];

// Auto-title fallback: the first non-empty line of the instruction, trimmed
// and capped to the same 200-char ceiling the title field itself enforces,
// or null when the instruction has no non-empty line — the caller's own
// validation error applies then, never an invented title. This is the ONE
// place a mission title is ever derived; the browser form sends no title at
// all when its field is blank and relies on this.
function deriveTitleFromInstruction(instruction) {
  if (typeof instruction !== 'string') return null;
  var lines = instruction.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line) return line.slice(0, 200).trim();
  }
  return null;
}

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
// optionally, execution_profile and priority. MOS-v2 M-05: `model` is
// validated below against model-catalog.js's own enabled entries, not
// accepted as free-form text -- see the comment at that check.
// `execution_profile` is validated below against CONSOLE_PROFILES
// (MOS-v2 M-04) and, for 'repo-write', against MOS_ALLOW_REPO_WRITE. The
// executor's own lib/policy.js is the structural enforcement of what each
// profile can actually do; this validation exists so a request this server
// already knows to refuse never reaches it. MOS-v2 M-06: `priority` is
// validated below against CONSOLE_PRIORITIES, defaulting to 'normal' when
// absent, and relayed verbatim -- the executor's own PRIORITY_WEIGHT is the
// structural enforcement of ordering, this is just an early refusal.
/* MOS-v2 M-07: a refused mission is a state-changing action that did not
   happen, and that is exactly what an audit log is for -- ten refusals in
   a minute is a different event from one. `reason` is a fixed code naming
   WHICH check refused, never the caller's value and never the human
   message: the message can quote the operator's own input (an unexpected
   field name is echoed, truncated, in the 400 body), the code cannot. */
function rejectStart(req, res, reason, detail) {
  audit.record({ action: 'mission.start', outcome: 'rejected',
                 actor: auth.sessionIdFrom(req), detail: { reason: reason } });
  return badRequest(res, detail);
}

function handleStartMission(req, res) {
  readBoundedBody(req, START_MISSION_MAX_BODY).then(function (raw) {
    var payload;
    try { payload = JSON.parse(raw || '{}'); }
    catch (e) { return rejectStart(req, res, 'bad_json', 'body is not valid JSON'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return rejectStart(req, res, 'bad_body', 'body must be a JSON object');
    }
    var unexpected = Object.keys(payload).filter(function (k) { return START_MISSION_FIELDS.indexOf(k) === -1; });
    if (unexpected.length) return rejectStart(req, res, 'unexpected_field', 'unexpected field: ' + unexpected[0].slice(0, 40));

    var title = payload.title;
    // A title the caller actually provided is preserved exactly (including
    // a non-string one, which stays a rejection below — never silently
    // replaced). Only an absent, null, empty or whitespace-only title is
    // derived from the instruction; a failed derivation (no non-empty line)
    // leaves `title` as sent, so the existing rejection below applies
    // unchanged. Nothing but the title is affected: every other field is
    // validated exactly as before, whichever way the title was obtained.
    if (title === undefined || title === null || (typeof title === 'string' && !title.trim())) {
      var derivedTitle = deriveTitleFromInstruction(payload.instruction);
      if (derivedTitle !== null) title = derivedTitle;
    }
    if (typeof title !== 'string' || !title.trim() || title.length > 200) {
      return rejectStart(req, res, 'title', 'title (string, 1-200 chars) is required');
    }
    var instruction = payload.instruction;
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 20000) {
      return rejectStart(req, res, 'instruction', 'instruction (string, 1-20000 chars) is required');
    }
    var provider = payload.provider;
    // MOS-v2 M-11: 'auto' asks the SERVER to pick the provider -- the
    // executor's own core/provider-router.js, called below, after profile
    // validation and the repo-write gate. It is accepted here as an
    // additional allowed value, never a replacement for the explicit
    // REAL_PROVIDERS enum: an operator who names a real provider still gets
    // exactly the M-06 behaviour, byte-identical.
    var isAuto = provider === 'auto';
    if (!isAuto && REAL_PROVIDERS.indexOf(provider) === -1) {
      return rejectStart(req, res, 'provider', 'provider must be one of: ' + REAL_PROVIDERS.join(', ') + ', or "auto"');
    }

    // task_type exists ONLY to feed the router, so it is legal only when
    // provider is 'auto' -- an explicit-provider request naming one is
    // refused rather than silently ignored, so a caller cannot carry a
    // field it thinks does something on a path where it does not.
    var taskType = null;
    if (isAuto) {
      // Simplified flow: an ABSENT task_type is inferred deterministically
      // from the title + instruction (TASK_TYPE_RULES above, fail-closed to
      // 'generic'). A PRESENT one is validated exactly as before -- the
      // operator's explicit choice is never replaced, and an unrecognised
      // value is still refused, never coerced.
      if (payload.task_type === undefined || payload.task_type === null) {
        taskType = inferTaskType(title, instruction);
      } else {
        taskType = payload.task_type;
        if (typeof taskType !== 'string' || CONSOLE_TASK_TYPES.indexOf(taskType) === -1) {
          return rejectStart(req, res, 'task_type',
            'task_type must be one of: ' + CONSOLE_TASK_TYPES.join(', '));
        }
      }
      // The router owns the provider/model pairing when auto-routing: a
      // request that ALSO names a model is contradictory, not a hint, and
      // is refused rather than guessed at.
      if (payload.model !== undefined && payload.model !== null) {
        return rejectStart(req, res, 'model', 'model must be absent when provider is "auto" — the router chooses it');
      }
    } else if (payload.task_type !== undefined) {
      return rejectStart(req, res, 'task_type', 'task_type is only accepted when provider is "auto"');
    }

    // MOS-v2 M-05: model is no longer free-form. Omitted or null relays
    // null to the executor -- each provider's own default applies
    // (documented in the providers/ directory; openai-compat's own code defaults to
    // 'gpt-4o-mini' when task.model is null). Present, it must be a string
    // AND pass modelCatalog.isAllowed(provider, model) -- an enabled
    // catalog entry matching BOTH this provider and this exact id. This
    // check is intentionally placed after the provider check above, so an
    // unknown-model error can name the allowed set for the provider that
    // was actually chosen, not some other provider's list. Skipped
    // entirely when auto -- the check above already refused a model
    // alongside 'auto', so `model` is always absent here in that case.
    var model = payload.model;
    if (!isAuto && model !== undefined && model !== null) {
      if (typeof model !== 'string' || !modelCatalog.isAllowed(provider, model)) {
        var allowedForProvider = modelCatalog.enabledModels()
          .filter(function (m) { return m.provider === provider; })
          .map(function (m) { return m.id; });
        return rejectStart(req, res, 'model', 'model must be one of: ' + allowedForProvider.join(', ') + ' (for provider ' + provider + ')');
      }
    }

    // MOS-v2 M-04: 'repo-read' is the default ceiling when the field is
    // absent. Present, it must be exactly one of CONSOLE_PROFILES --
    // case-sensitive, no coercion -- or the request is refused before it
    // ever reaches the executor.
    var profile = 'repo-read';
    if (payload.execution_profile !== undefined) {
      if (typeof payload.execution_profile !== 'string' || CONSOLE_PROFILES.indexOf(payload.execution_profile) === -1) {
        return rejectStart(req, res, 'execution_profile', 'execution_profile must be one of: ' + CONSOLE_PROFILES.join(', '));
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
      // The single most important line this log can carry: somebody asked
      // this console for repository write authority and was refused.
      audit.record({ action: 'mission.start', outcome: 'denied_profile',
                     actor: auth.sessionIdFrom(req), detail: { profile: profile, reason: 'repo_write_not_authorized' } });
      sendJSON(res, 403, { ok: false, error: 'profile_not_authorized',
                           detail: 'repo-write is not authorized on this console' });
      return;
    }

    // MOS-v2 M-06: 'normal' is the default when the field is absent.
    // Present, it must be exactly one of CONSOLE_PRIORITIES -- case-
    // sensitive, no coercion -- same discipline as execution_profile above.
    var priority = 'normal';
    if (payload.priority !== undefined) {
      if (typeof payload.priority !== 'string' || CONSOLE_PRIORITIES.indexOf(payload.priority) === -1) {
        return rejectStart(req, res, 'priority', 'priority must be one of: ' + CONSOLE_PRIORITIES.join(', '));
      }
      priority = payload.priority;
    }

    // M-12: task_category is optional, and when present must be one of the
    // registry's own category vocabulary above -- case-sensitive, no
    // coercion, same discipline as execution_profile and priority. Absent
    // entirely relays nothing, so the executor's own keyword-rule
    // selection applies (lib/skills.js selectSkill).
    var taskCategory = null;
    if (payload.task_category !== undefined) {
      if (typeof payload.task_category !== 'string' || CONSOLE_TASK_CATEGORIES.indexOf(payload.task_category) === -1) {
        return rejectStart(req, res, 'task_category', 'task_category must be one of: ' + CONSOLE_TASK_CATEGORIES.join(', '));
      }
      taskCategory = payload.task_category;
    }

    // The one write /tasks itself, whatever provider/model this request
    // ends with -- explicit (byte-identical to M-06) or router-resolved
    // (MOS-v2 M-11). `routed` marks the audit line only; nothing about the
    // relayed payload itself differs by how the provider/model were chosen.
    function startWithProvider(finalProvider, finalModel, routed) {
      return upstream.post('/tasks', {
        project: 'mythos-prod',
        stage: title.trim().slice(0, 200),
        instruction: instruction,
        provider: finalProvider,
        model: finalModel || null,
        priority: priority,
        requested_by: 'mos-console',
        execution_profile: profile,
        expected_delivery: 'report',
        // M-12: relayed only when the operator picked one -- an absent
        // task_category leaves the upstream payload byte-identical to
        // before this stage, and the executor's own keyword-rule selection
        // (lib/skills.js selectSkill) applies exactly as it does for any
        // n8n-originated task that never named one either.
        task_category: taskCategory || undefined
      }).then(function (created) {
        var taskId = created && created.task_id;
        if (!taskId) {
          audit.record({ action: 'mission.start', outcome: 'upstream_error', actor: auth.sessionIdFrom(req),
                         detail: { reason: 'no_task_id' } });
          return problem(res, { code: 'upstream_error', message: 'executor did not return a task id' });
        }
        // MOS-v2 M-07: the task now exists upstream, so the audit line is
        // written whichever way the dispatch below goes -- what is being
        // recorded is that this operator caused this task to be created
        // under this profile, not whether a slot happened to be free. The
        // instruction that was relayed is deliberately NOT in the line;
        // the executor's own task.json holds it.
        function accepted(status, note) {
          var detail = { profile: profile, provider: finalProvider, model: finalModel || null,
                         priority: priority, status: status };
          // M-12: recorded only when the operator named one, same
          // discipline as `routed` immediately below.
          if (taskCategory) detail.task_category = taskCategory;
          // MOS-v2 M-11: `routed` records only THAT the router chose this
          // provider, never why -- the router's reason text is never audit
          // material, same discipline as every other refusal code in this
          // file. Absent entirely for an explicit-provider request, so an
          // M-06 mission's audit line stays byte-identical.
          if (routed) detail.routed = true;
          audit.record({ action: 'mission.start', outcome: 'accepted', actor: auth.sessionIdFrom(req),
                         task_id: taskId, detail: detail });
          // Phase-5 honesty: the browser shows what the SERVER actually
          // selected, not what the form assumed -- the profile that will
          // govern the run and, for an auto-routed mission, the task_type
          // the router was actually asked about (operator-named or
          // inferred, the same field either way).
          var data = { task_id: taskId, status: status, provider: finalProvider, model: finalModel || null,
                       execution_profile: profile };
          if (isAuto) data.task_type = taskType;
          if (note) data.note = note;
          return ok(res, data);
        }
        // MOS-3A: the explicit start goes through the executor's capacity-
        // gated dispatcher (POST /tasks/<id>/dispatch), not the old
        // unconditional /resume -- runTask() itself still has no cross-task
        // lock, but now a central in-process counter admits at most
        // MAX_PARALLEL tasks at once, and this console mission is one
        // candidate among possibly several, not a guaranteed immediate start.
        return upstream.post('/tasks/' + taskId + '/dispatch', {})
          .then(function (dispatched) {
            if (dispatched && dispatched.dispatched) {
              return accepted('RUNNING');
            }
            if (dispatched && dispatched.queued) {
              return accepted('QUEUED',
                'created; at capacity (' + dispatched.running + '/' + dispatched.max_parallel + ')' +
                  ' — will start automatically when a slot frees');
            }
            // Unrecognised shape from the executor: fall back to the same
            // honest "queued, will run" note as an outright dispatch failure.
            accepted('QUEUED', 'created; the explicit start call did not confirm, but the task is queued and will run');
          })
          .catch(function () {
            // Created but the explicit dispatch call failed (e.g. a race with
            // the daemon's own tick, or the executor briefly unreachable).
            // The task is still safely QUEUED and will run on the next tick
            // or the drain triggered by another task freeing a slot -- this
            // is not a failure to report as one.
            accepted('QUEUED', 'created; the explicit start call did not confirm, but the task is queued and will run');
          });
      }).catch(function (e) {
        audit.record({ action: 'mission.start', outcome: 'upstream_error', actor: auth.sessionIdFrom(req),
                       detail: { profile: profile, provider: finalProvider, reason: (e && e.code) || 'internal_error' } });
        problem(res, e);
      });
    }

    if (!isAuto) {
      return startWithProvider(provider, model, false);
    }

    /* MOS-v2 M-11: governed auto-routing.

       The console never decides which provider runs an auto-routed
       mission -- it asks the executor's OWN core/provider-router.js
       (POST /route, same bearer channel every other relay uses) and
       relays exactly, and only, what comes back:

         · 'route' / 'fallback': the resolved provider MUST already be one
           this console recognises (REAL_PROVIDERS) -- an agent the router
           picked whose provider this console cannot name is an honest 502,
           never a silent pass-through of an unknown string to /tasks. The
           model is chosen HERE, from model-catalog.js's own enabled
           entries for that provider (never the router's business, and
           never a caller's business either -- the M-11 field check above
           already refused a request naming both 'auto' and a model): the
           first entry whose recommended_task_types includes the operator's
           task_type, or none, so the provider's own default applies. That
           choice is asserted against modelCatalog.isAllowed() as a belt
           the catalog's own construction already guarantees, and a failed
           assertion is a 500 this console raises on itself rather than
           relaying a model nothing has vetted.
         · 'wait_for_quota' / 'no_provider': 409, and /tasks is never
           called -- an auto-routed mission is never queued against a
           provider the router itself just refused. */
    return upstream.post('/route', { task_type: taskType, execution_profile: profile }).then(function (routed) {
      var action = routed && routed.action;
      if (action === 'wait_for_quota' || action === 'no_provider') {
        var refusalCode = action === 'wait_for_quota' ? 'wait_for_quota' : 'no_provider_available';
        audit.record({ action: 'mission.start', outcome: refusalCode, actor: auth.sessionIdFrom(req),
                       detail: { profile: profile, reason: (routed && routed.reason) || null } });
        sendJSON(res, 409, { ok: false, error: refusalCode, detail: (routed && routed.reason) || 'no provider is available for this task' });
        return;
      }
      if (action !== 'route' && action !== 'fallback') {
        audit.record({ action: 'mission.start', outcome: 'upstream_error', actor: auth.sessionIdFrom(req),
                       detail: { profile: profile, reason: 'unrecognised_route_action' } });
        return problem(res, { code: 'upstream_error', message: 'the router returned an unrecognised action' });
      }
      var resolvedProvider = routed.provider;
      if (REAL_PROVIDERS.indexOf(resolvedProvider) === -1) {
        audit.record({ action: 'mission.start', outcome: 'upstream_error', actor: auth.sessionIdFrom(req),
                       detail: { profile: profile, reason: 'router_chose_unrecognised_provider' } });
        return problem(res, { code: 'upstream_error', message: 'the router chose a provider this console does not recognise' });
      }
      var resolvedModel = null;
      var candidates = modelCatalog.enabledModels().filter(function (m) {
        return m.provider === resolvedProvider &&
          Array.isArray(m.recommended_task_types) && m.recommended_task_types.indexOf(taskType) !== -1;
      });
      if (candidates.length) resolvedModel = candidates[0].id;
      if (resolvedModel !== null && !modelCatalog.isAllowed(resolvedProvider, resolvedModel)) {
        // Unreachable by construction (resolvedModel came from
        // enabledModels() for this exact provider) -- fails loudly rather
        // than relaying an unvetted model if that construction is ever
        // broken.
        audit.record({ action: 'mission.start', outcome: 'upstream_error', actor: auth.sessionIdFrom(req),
                       detail: { profile: profile, reason: 'resolved_model_not_allowed' } });
        return problem(res, { code: 'internal_error', message: 'internal error' });
      }
      return startWithProvider(resolvedProvider, resolvedModel, true);
    }).catch(function (e) {
      audit.record({ action: 'mission.start', outcome: 'upstream_error', actor: auth.sessionIdFrom(req),
                     detail: { profile: profile, reason: (e && e.code) || 'internal_error' } });
      problem(res, e);
    });
  }).catch(function (e) {
    if (e && e.message === 'BODY_TOO_LARGE') return rejectStart(req, res, 'body_too_large', 'request body too large');
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
// M-12: skill_id/skill_version and mcp_capabilities are safe -- names only,
// never instruction content or MCP internals. mcp_capabilities is an array
// of 'server.tool' strings the executor already resolved server-side
// (lib/mcp-capabilities.js); this console never re-resolves or interprets it.
// task_category joins the allowlist for the same reason skill_id did: a
// name from a fixed vocabulary the console itself validated at start, never
// content. The detail panel and the copyable mission report both show it.
var TASK_DETAIL_TASK_FIELDS = ['task_id', 'project', 'stage', 'instruction', 'provider', 'model', 'priority', 'execution_profile',
  'created_at', 'skill_id', 'skill_version', 'mcp_capabilities', 'task_category'];
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
    var status = (d && d.status) || 'CANCELLED';
    audit.record({ action: 'mission.cancel', outcome: 'accepted', actor: auth.sessionIdFrom(req),
                   task_id: taskId, detail: { status: status } });
    ok(res, { task_id: taskId, status: status });
  }).catch(function (e) {
    // A cancel the executor refused (409 on an already-terminal task) is
    // recorded too: an operator repeatedly trying to stop something is
    // information, and it is exactly the trace a post-incident read wants.
    audit.record({ action: 'mission.cancel', outcome: 'failed', actor: auth.sessionIdFrom(req),
                   task_id: taskId, detail: { reason: (e && e.code) || 'internal_error' } });
    problem(res, e);
  });
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
    audit.record({ action: 'mission.dispatch', outcome: 'accepted', actor: auth.sessionIdFrom(req),
                   task_id: taskId, detail: { status: d && d.dispatched ? 'RUNNING' : 'QUEUED' } });
    ok(res, pick(d, MISSION_DISPATCH_FIELDS));
  }).catch(function (e) {
    audit.record({ action: 'mission.dispatch', outcome: 'failed', actor: auth.sessionIdFrom(req),
                   task_id: taskId, detail: { reason: (e && e.code) || 'internal_error' } });
    problem(res, e);
  });
}

/* =====================================================================
   MOS-v2 M-09: THE GOAL LAYER

   GOAL → PROPOSED PLAN → MISSIONS → DEPENDENCIES → HUMAN APPROVAL →
   DISPATCH → RESULTS.

   The console does not plan, schedule, dispatch or decide. Every one of
   those already exists in the executor's orchestration core
   (core/campaign.js, core/campaign-service.js, core/planner.js) and this
   layer is three relays onto it -- no second planner, no second queue, no
   second approval store, no second notion of what a campaign state means.

   What this layer DOES own is that a goal created here can never run
   without a human saying so:

     · POST /api/goals always sends require_plan_approval: true. It is
       not a field the browser may set, omit or falsify -- it is written
       here, server-side, on every single request. The executor answers by
       building the plan, attaching it, and parking the campaign in
       WAITING_FOR_APPROVAL before any mission starts.
     · The campaign leaves that state ONLY through POST
       /api/goals/<id>/approvals, which is a human decision, and the
       identity recorded against it is derived from the SESSION, never
       from the payload. A payload carrying decided_by is refused as an
       unexpected field, so an operator cannot approve as someone else and
       a script cannot approve as an operator.
     · Dispatch is still POST /api/goals/<id>/continue, which the
       executor's own continueCampaign refuses while the campaign is
       WAITING_FOR_APPROVAL or BLOCKED. Approving does not run anything;
       it only makes running possible.
   ===================================================================== */

var GOAL_MAX_BODY = 8 * 1024;
// MOS-v2 M-10 adds `decompose`: a boolean asking that the PROPOSED PLAN be
// written by a planner model rather than taken from the roadmap template.
// It is the only planning field a browser may send, it is validated as a
// strict boolean, and it is relayed only when it is exactly true -- so a
// goal submitted without it produces the byte-identical upstream payload
// M-09 produced. It chooses no model, no provider and no profile: the
// executor decides all three, the plan is validated there, and it is still
// parked for this operator's approval before anything runs.
var GOAL_CREATE_FIELDS = ['objective', 'title', 'decompose'];
var GOAL_APPROVAL_FIELDS = ['approval_id', 'granted', 'note'];
// The executor's own approval-entity id shape (core/domain.js ID_PREFIX +
// ID_RE). Validated here so a malformed value is refused before it is
// relayed, and so nothing outside this alphabet can reach the audit log.
var APPROVAL_ID_RE = /^ap-[a-z0-9]{6,12}-[a-z0-9]{4,8}$/;

// Every field of a goal summary the console will serve. The upstream list
// is the executor's own GET /campaigns; an extra field added there for an
// unrelated reason never becomes a console response.
var GOAL_SUMMARY_FIELDS = ['campaign_id', 'project', 'state', 'objective', 'completed', 'updated_at'];
var GOAL_DETAIL_FIELDS = ['campaign_id', 'project', 'objective', 'state', 'running',
                          'continuable', 'needs_human', 'plan_approval_required', 'updated_at'];
// The three advisory fields (M-10) are what the PLANNER MODEL suggested,
// relayed for a human to read and used by nothing: pick() only emits a
// field the upstream object actually carries, so a template plan's tasks
// keep exactly the M-09 shape.
var PLAN_TASK_FIELDS = ['key', 'title', 'task_type', 'depends_on', 'policy_classes',
                        'recommended_model', 'execution_profile', 'expected_result'];
var PLAN_FIELDS = ['available', 'reason', 'capability_key', 'title', 'objective', 'risk',
                   'acceptance_criteria', 'source', 'planner_provider', 'planner_model'];
var APPROVAL_FIELDS = ['approval_id', 'capability_key', 'mission_id', 'reason', 'objective', 'requested_at'];
var COMPLETED_MISSION_FIELDS = ['capability_key', 'mission_id', 'commit', 'tests', 'repair_cycles'];
var BLOCKED_MISSION_FIELDS = ['capability_key', 'mission_id', 'reason'];
var CURRENT_MISSION_FIELDS = ['capability_key', 'mission_id'];
var MISSION_TASK_FIELDS = ['task_id', 'plan_key', 'status'];

function pickList(list, fields) {
  return (Array.isArray(list) ? list : []).map(function (item) { return pick(item, fields); });
}

function planView(plan) {
  if (!plan || typeof plan !== 'object') return null;
  var out = pick(plan, PLAN_FIELDS);
  out.tasks = pickList(plan.tasks, PLAN_TASK_FIELDS);
  return out;
}

function goalDetailView(d) {
  var out = pick(d, GOAL_DETAIL_FIELDS);
  out.proposed_plan = planView(d && d.proposed_plan);
  out.approval_required = pickList(d && d.approval_required, APPROVAL_FIELDS);
  out.completed_missions = pickList(d && d.completed_missions, COMPLETED_MISSION_FIELDS);
  out.blocked_missions = pickList(d && d.blocked_missions, BLOCKED_MISSION_FIELDS);
  var cm = d && d.current_mission;
  if (cm) {
    out.current_mission = pick(cm, CURRENT_MISSION_FIELDS);
    out.current_mission.tasks = pickList(cm.tasks, MISSION_TASK_FIELDS);
  } else {
    out.current_mission = null;
  }
  return out;
}

function handleGoalDetail(res, campaignId) {
  upstream.get('/campaigns/' + campaignId).then(function (d) {
    ok(res, { goal: goalDetailView(d) });
  }).catch(function (e) { problem(res, e); });
}

// A refused write is a state-changing action that did not happen, and the
// reason code names WHICH check refused -- never the caller's value.
function rejectGoal(req, res, action, reason, detail) {
  audit.record({ action: action, outcome: 'rejected',
                 actor: auth.sessionIdFrom(req), detail: { reason: reason } });
  return badRequest(res, detail);
}

/* POST /api/goals -- submit a goal.
   project is fixed here ('mythos-prod', the only project this console
   operates on), requested_by is fixed here ('mos-console'), and
   require_plan_approval is fixed here (always true). None of the three is
   read from the payload, so no browser request can widen what a goal is
   allowed to be or skip the approval the next step depends on. `title` is
   accepted and deliberately not relayed: the executor's campaign carries
   the objective, and a second free-text field would be a second truth. */
function handleGoalCreate(req, res) {
  readBoundedBody(req, GOAL_MAX_BODY).then(function (raw) {
    var payload;
    try { payload = JSON.parse(raw || '{}'); }
    catch (e) { return rejectGoal(req, res, 'goal.create', 'bad_json', 'body is not valid JSON'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return rejectGoal(req, res, 'goal.create', 'bad_body', 'body must be a JSON object');
    }
    var unexpected = Object.keys(payload).filter(function (k) { return GOAL_CREATE_FIELDS.indexOf(k) === -1; });
    if (unexpected.length) {
      return rejectGoal(req, res, 'goal.create', 'unexpected_field', 'unexpected field: ' + unexpected[0].slice(0, 40));
    }
    var objective = payload.objective;
    if (typeof objective !== 'string' || !objective.trim() || objective.length > 2000) {
      return rejectGoal(req, res, 'goal.create', 'objective', 'objective (string, 1-2000 chars) is required');
    }
    if (payload.title !== undefined &&
        (typeof payload.title !== 'string' || payload.title.length > 200)) {
      return rejectGoal(req, res, 'goal.create', 'title', 'title, when present, must be a string of at most 200 chars');
    }
    // A boolean or it is nothing: 'true', 1 and 'yes' are refused rather
    // than coerced, exactly as the approval verdict is.
    if (payload.decompose !== undefined && typeof payload.decompose !== 'boolean') {
      return rejectGoal(req, res, 'goal.create', 'decompose', 'decompose, when present, must be a boolean');
    }

    var relay = {
      objective: objective.trim(),
      project: 'mythos-prod',
      requested_by: 'mos-console',
      require_plan_approval: true
    };
    // Relayed ONLY when the operator asked for it. An absent or false
    // value leaves the upstream payload exactly as it was before M-10.
    if (payload.decompose === true) relay.decompose = true;

    return upstream.post('/campaigns', relay).then(function (created) {
      var campaignId = created && created.campaign_id;
      if (!campaignId) {
        audit.record({ action: 'goal.create', outcome: 'upstream_error',
                       actor: auth.sessionIdFrom(req), detail: { reason: 'no_campaign_id' } });
        return problem(res, { code: 'upstream_error', message: 'executor did not return a campaign id' });
      }
      // The objective text is NOT in the audit line: it is operator-
      // authored free text and belongs in the executor's campaign record.
      audit.record({ action: 'goal.create', outcome: 'accepted', actor: auth.sessionIdFrom(req),
                     task_id: campaignId,
                     detail: { status: created.state || null,
                               decompose: payload.decompose === true,
                               reason: created.created === false ? 'existing_campaign' : null } });
      ok(res, {
        campaign_id: campaignId,
        created: created.created === true,
        state: created.state || null,
        needs_approval: created.state === 'WAITING_FOR_APPROVAL',
        approval_id: created.approval_id || null,
        proposed_plan: planView(created.proposed_plan)
      });
    }).catch(function (e) {
      audit.record({ action: 'goal.create', outcome: 'upstream_error', actor: auth.sessionIdFrom(req),
                     detail: { reason: (e && e.code) || 'internal_error' } });
      problem(res, e);
    });
  }).catch(function (e) {
    if (e && e.message === 'BODY_TOO_LARGE') return rejectGoal(req, res, 'goal.create', 'body_too_large', 'request body too large');
    problem(res, { code: 'internal_error', message: 'internal error' });
  });
}

/* POST /api/goals/<id>/approvals -- the human decision.

   decided_by is composed HERE from the session that made the request and
   is never read from the payload: 'decided_by' is not in
   GOAL_APPROVAL_FIELDS, so a body that carries one is refused as an
   unexpected field rather than quietly ignored. The identity is the same
   truncated form the audit log uses (audit.actor), so the journal line
   and the executor's approval record name the same operator. */
function handleGoalApproval(req, res, campaignId) {
  readBoundedBody(req, GOAL_MAX_BODY).then(function (raw) {
    var payload;
    try { payload = JSON.parse(raw || '{}'); }
    catch (e) { return rejectGoal(req, res, 'goal.approve', 'bad_json', 'body is not valid JSON'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return rejectGoal(req, res, 'goal.approve', 'bad_body', 'body must be a JSON object');
    }
    var unexpected = Object.keys(payload).filter(function (k) { return GOAL_APPROVAL_FIELDS.indexOf(k) === -1; });
    if (unexpected.length) {
      return rejectGoal(req, res, 'goal.approve', 'unexpected_field', 'unexpected field: ' + unexpected[0].slice(0, 40));
    }
    if (typeof payload.approval_id !== 'string' || !APPROVAL_ID_RE.test(payload.approval_id)) {
      return rejectGoal(req, res, 'goal.approve', 'approval_id', 'approval_id (an executor approval identifier) is required');
    }
    // No coercion: a decision is true or it is false. 'true', 1 and
    // undefined are all refused, because "I could not tell what they
    // meant" must never resolve to a grant.
    if (typeof payload.granted !== 'boolean') {
      return rejectGoal(req, res, 'goal.approve', 'granted', 'granted (boolean) is required');
    }
    if (payload.note !== undefined && (typeof payload.note !== 'string' || payload.note.length > 500)) {
      return rejectGoal(req, res, 'goal.approve', 'note', 'note, when present, must be a string of at most 500 chars');
    }

    var decidedBy = 'mos-console-operator:' + audit.actor(auth.sessionIdFrom(req));
    return upstream.post('/campaigns/' + campaignId + '/approvals/resolve', {
      approval_id: payload.approval_id,
      granted: payload.granted,
      decided_by: decidedBy,
      note: payload.note || ''
    }).then(function (d) {
      audit.record({ action: 'goal.approve', outcome: 'accepted', actor: auth.sessionIdFrom(req),
                     task_id: campaignId,
                     detail: { granted: payload.granted, approval_id: payload.approval_id,
                               status: (d && d.state) || null } });
      ok(res, {
        campaign_id: campaignId,
        approval_id: payload.approval_id,
        granted: payload.granted,
        state: (d && d.state) || null,
        remaining_approvals: (d && d.remaining_approvals) === undefined ? null : d.remaining_approvals
      });
    }).catch(function (e) {
      audit.record({ action: 'goal.approve', outcome: 'failed', actor: auth.sessionIdFrom(req),
                     task_id: campaignId,
                     detail: { granted: payload.granted, approval_id: payload.approval_id,
                               reason: (e && e.code) || 'internal_error' } });
      problem(res, e);
    });
  }).catch(function (e) {
    if (e && e.message === 'BODY_TOO_LARGE') return rejectGoal(req, res, 'goal.approve', 'body_too_large', 'request body too large');
    problem(res, { code: 'internal_error', message: 'internal error' });
  });
}

/* POST /api/goals/<id>/continue -- ask the executor to advance the
   campaign. Takes no payload beyond the id already validated by the route
   regex; max_steps is not offered, so the executor's own default bound
   applies. The executor still refuses a campaign that is
   WAITING_FOR_APPROVAL or BLOCKED -- this route cannot talk it past that,
   and a refusal comes back as an upstream error, recorded as one. */
function handleGoalContinue(req, res, campaignId) {
  readBoundedBody(req, 1024).then(function () {
    return upstream.post('/campaigns/' + campaignId + '/continue', { requested_by: 'mos-console' });
  }).then(function (d) {
    audit.record({ action: 'goal.continue', outcome: 'accepted', actor: auth.sessionIdFrom(req),
                   task_id: campaignId, detail: { status: (d && d.from_state) || null } });
    ok(res, {
      campaign_id: campaignId,
      accepted: !!(d && d.accepted),
      from_state: (d && d.from_state) || null
    });
  }).catch(function (e) {
    audit.record({ action: 'goal.continue', outcome: 'failed', actor: auth.sessionIdFrom(req),
                   task_id: campaignId, detail: { reason: (e && e.code) || 'internal_error' } });
    problem(res, e);
  });
}

function handler(req, res) {
  var reqPathname = String(req.url || '/').split('?')[0];
  var writeMatch = req.method === 'POST' ? matchWriteRoute(reqPathname) : null;
  if (req.method !== 'GET' && req.method !== 'HEAD' && !writeMatch) {
    // Refused before routing. Every path but the ones named above has no
    // write surface, and the refusal is the surface's definition rather
    // than a gap in it.
    head(res, 405, 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'read_only', detail: 'This console is read-only except for POST /api/login, POST /api/logout, POST /api/missions/start, POST /api/missions/<id>/cancel, POST /api/missions/<id>/dispatch, POST /api/goals, POST /api/goals/<id>/approvals and POST /api/goals/<id>/continue.' }));
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

  // MOS-v2 M-07: a write attempted with no session is the event most worth
  // having a record of, and the one nothing downstream can record -- it
  // never reaches the executor, so the executor's own task events cannot
  // know it happened. Audited here, immediately before the refusal below,
  // and kept OUT of that refusal so the boundary itself stays the single
  // unconditional line the suite pins it as. `route` is the matched
  // route's own label, never the raw request path, so the log cannot be
  // written into by choosing a URL.
  if (writeMatch && !writeMatch.unauthenticated && !session) {
    audit.record({ action: 'write.denied', outcome: 'unauthenticated',
                   task_id: writeMatch.args[0], detail: { route: writeRouteLabel(reqPathname) } });
  }

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
  if (req.method === 'GET' && (dm = GOAL_DETAIL_RE.exec(pathname))) {
    return handleGoalDetail(res, dm[1]);
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
