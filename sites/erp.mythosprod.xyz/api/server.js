#!/usr/bin/env node
'use strict';

/* Mythos ERP API server.
 *
 * Node builtins plus pg. No framework: the request boundary in lib/pipeline.js
 * is the thing that must be right, and a framework's own routing would be a
 * second place where a route could be registered without it.
 *
 * Every route below is declared with the module it belongs to, so authorization
 * and the per-tenant module gate apply to all of them by construction.
 */

var http = require('http');
var url = require('url');

var db = require('./lib/db');
var pipeline = require('./lib/pipeline');
var auth = require('./lib/auth');
var tenancy = require('./lib/tenancy');
var tokens = require('./lib/tokens');
var resource = require('./lib/resource');
var ratelimit = require('./lib/ratelimit');
var registry = require('./modules/registry');
var prospects = require('./modules/prospects');
var accounting = require('./modules/accounting');
var invoices = require('./modules/invoices');
var documents = require('./modules/documents');
var views = require('./modules/views');

var MAX_BODY = 1024 * 1024;          // 1 MiB of JSON is already generous
var UUID = db.UUID;

// What this running process actually is, not what the checkout on disk holds
// right now: a long-lived daemon runs what its checkout held when it
// started, which silently drifts from HEAD the moment `main` moves and
// nobody restarts it (Phase 15: production sat many commits behind origin
// for hours with no signal). Measured once at startup, from this file's own
// location (never from configuration, which can lie), and reported in
// GET /health as `code_identity` — the same pattern already used by
// mythos-ai-executor's health check for the identical problem.
var CODE_IDENTITY = (function () {
  var out = { head: null, branch: null, checkout: null, measured_at: new Date().toISOString(),
    started_at: new Date(Date.now() - process.uptime() * 1000).toISOString(), pid: process.pid, verified: false, reason: null };
  try {
    var cp = require('child_process');
    var run = function (args) {
      var r = cp.spawnSync('git', ['-c', 'core.hooksPath=/var/empty'].concat(args),
        { cwd: __dirname, encoding: 'utf8', timeout: 5000,
          env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }) });
      return r.status === 0 ? String(r.stdout).trim() : null;
    };
    out.checkout = run(['rev-parse', '--show-toplevel']);
    out.head = run(['rev-parse', 'HEAD']);
    out.branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
    out.verified = !!(out.checkout && out.head && /^[0-9a-f]{40}$/.test(out.head));
    if (!out.verified) out.reason = 'cannot resolve the git checkout/HEAD of ' + __dirname;
  } catch (e) { out.reason = String(e.message).slice(0, 200); }
  return out;
})();

/* ── Route table ────────────────────────────────────────────────────────────
   [method, pattern, module, handler, validate]
   :id in a pattern must be a UUID — a non-UUID never reaches a handler. */
var routes = [];
function route(method, pattern, module, handler, validate, maxBody) {
  var names = [];
  var rx = new RegExp('^' + pattern.replace(/:([a-z_]+)/g, function (_, n) {
    names.push(n);
    return '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
  }) + '$', 'i');
  // maxBody: almost every route is fine with the 1 MiB global cap; a document
  // upload is base64 JSON and needs more room. Declared per route, never
  // globally, so raising it for uploads cannot quietly raise it everywhere.
  routes.push({ method: method, rx: rx, names: names, module: module, handler: handler, validate: validate, maxBody: maxBody || MAX_BODY });
}

// ── Public and tenant-free ────────────────────────────────────────────────
// Readiness, not liveness: the answer comes from the database through the
// same pool the requests use, so "ok" means "can serve", and it also states
// which role the pool authenticated as — an operator can see at a glance that
// the runtime is erp_app and not the owner.
route('GET', '/api/v1/health', null, function (ctx, client) {
  return client.query('SELECT current_user AS role, 1 AS one').then(function (r) {
    var role = r.rows && r.rows[0] && r.rows[0].role;
    var ok = !!(r.rows && r.rows[0] && r.rows[0].one === 1) && role !== 'erp_owner';
    return { status: ok ? 200 : 503, body: { ok: ok, db: ok ? 'ready' : 'not_ready', role: role || null, code_identity: CODE_IDENTITY } };
  }).catch(function () {
    return { status: 503, body: { ok: false, db: 'unreachable', role: null, code_identity: CODE_IDENTITY } };
  });
});

route('POST', '/api/v1/auth/login', null, function (ctx, client) {
  return auth.login({ db: client, sleep: null }, {
    email: ctx.body && ctx.body.email, password: ctx.body && ctx.body.password,
    ip: ctx.ip, userAgent: ctx.userAgent
  }).then(function (r) {
    if (!r.ok) return { status: 401, body: { error: r.error }, audit: null };
    return {
      status: 200,
      headers: { 'Set-Cookie': r.cookie },
      body: { user: r.user, tenants: r.tenants, active_tenant_id: r.active_tenant_id, csrf: r.csrf },
      // login.success is already audited inside auth.login, in the same
      // transaction; re-auditing here would double-count every sign-in.
      audit: null, skipAudit: true
    };
  });
});

route('POST', '/api/v1/auth/logout', null, function (ctx, client) {
  if (!ctx.session) return { status: 200, body: { ok: true }, skipAudit: true };
  return auth.revokeSession({ db: client }, ctx.session.sessionId, 'logout', ctx.user)
    .then(function () {
      return { status: 200, headers: { 'Set-Cookie': tokens.clearCookieHeader() },
               body: { ok: true }, skipAudit: true };
    });
});

// Session restore for a reloaded or newly opened tab. The CSRF token is stored
// only as a hash, so it cannot be handed back; instead a fresh one is issued
// here and bound to the session (rotation). The previous token stops working —
// the price of never persisting the plain token anywhere server-side.
route('GET', '/api/v1/session', null, function (ctx, client) {
  var csrf = tokens.generate();
  return client.query('UPDATE sessions SET csrf_hash = $2 WHERE id = $1', [ctx.session.sessionId, tokens.hashToken(csrf)])
    .then(function () { return tenancy.membershipsFor(client, ctx.user.id); })
    .then(function (m) {
      return { status: 200, body: {
        user: ctx.user, active_tenant_id: ctx.session.activeTenantId, csrf: csrf,
        tenants: m.map(function (t) { return { id: t.id, key: t.key, display_name: t.display_name }; })
      } };
    });
});

// Contract metadata for the browser: resources, fields, filters, statuses.
// Authenticated (it describes the API surface) but tenant-free (identical for
// every tenant). Nothing here is data.
route('GET', '/api/v1/meta', null, function () {
  var meta = registry.publicMeta();
  meta.modules = tenancy.MODULES;
  return Promise.resolve({ status: 200, body: meta });
});

route('GET', '/api/v1/tenants', null, function (ctx, client) {
  return tenancy.membershipsFor(client, ctx.user.id).then(function (m) {
    return { status: 200, body: { rows: m } };
  });
});

route('POST', '/api/v1/session/tenant', null, function (ctx, client) {
  var wanted = ctx.body && ctx.body.tenant_id;
  if (!UUID.test(String(wanted || ''))) return { status: 422, body: { error: 'tenant_id must be a uuid' } };
  return auth.switchTenant({ db: client }, ctx.session, wanted).then(function (r) {
    if (!r.ok) return { status: 403, body: { error: r.error }, skipAudit: true };
    return { status: 200, body: { active_tenant_id: r.tenant_id }, skipAudit: true };
  });
});

// ── Dashboard and reports ─────────────────────────────────────────────────
route('GET', '/api/v1/dashboard', 'dashboard', views.dashboard.summary);
route('GET', '/api/v1/reports/revenue', 'reports', views.reports.revenue);
route('GET', '/api/v1/reports/receivables', 'reports', views.reports.receivables);
route('GET', '/api/v1/reports/expenses', 'reports', views.reports.expenses);
route('GET', '/api/v1/reports/prospects', 'reports', views.reports.prospects);
route('GET', '/api/v1/reports/inventory', 'reports', views.reports.inventory);

// ── Settings, users, audit ────────────────────────────────────────────────
route('GET', '/api/v1/settings', 'settings', views.settings.read);
route('PATCH', '/api/v1/settings', 'settings', views.settings.update);
route('POST', '/api/v1/settings/modules', 'settings', views.settings.setModule);
route('GET', '/api/v1/users', 'users', views.users.list);
route('POST', '/api/v1/users/roles', 'users', views.users.assignRole);
route('GET', '/api/v1/audit', 'audit', views.audit.list);

// ── Invoices ──────────────────────────────────────────────────────────────
route('GET',    '/api/v1/invoices', 'invoices', invoices.handlers.list);
route('POST',   '/api/v1/invoices', 'invoices', invoices.handlers.create,
      function (b) { return invoices.validateHeader(b, false); });
route('GET',    '/api/v1/invoices/:id', 'invoices', invoices.handlers.get);
route('PATCH',  '/api/v1/invoices/:id', 'invoices', invoices.handlers.update,
      function (b) { return invoices.validateHeader(b, true); });
route('DELETE', '/api/v1/invoices/:id', 'invoices', invoices.handlers.retire);
route('POST',   '/api/v1/invoices/:id/payments', 'invoices', invoices.handlers.addPayment);

// ── Comptabilité / general ledger (0005-accounting.sql) ───────────────────
// All tenant-scoped, module 'accounting': GET = accounting.read, POST/PATCH =
// accounting.write; post/reverse add accounting.post, close/setup add
// accounting.close inside the handlers. Declared before the generic resources
// (accounts, journals) so the specific paths match first.
route('GET',   '/api/v1/accounting/setup', 'accounting', accounting.setup.status);
route('POST',  '/api/v1/accounting/setup', 'accounting', accounting.setup.run);
route('GET',   '/api/v1/accounting/periods', 'accounting', accounting.periods.list);
route('POST',  '/api/v1/accounting/periods/:id/close', 'accounting', accounting.periods.close);
route('GET',   '/api/v1/accounting/trial-balance', 'accounting', accounting.reports.trialBalance);
route('GET',   '/api/v1/accounting/ledger', 'accounting', accounting.reports.ledger);
route('GET',   '/api/v1/accounting/vat', 'accounting', accounting.reports.vat);
route('GET',   '/api/v1/accounting/entries', 'accounting', accounting.entries.list);
route('POST',  '/api/v1/accounting/entries', 'accounting', accounting.entries.create);
route('GET',   '/api/v1/accounting/entries/:id', 'accounting', accounting.entries.get);
route('PATCH', '/api/v1/accounting/entries/:id', 'accounting', accounting.entries.update);
route('POST',  '/api/v1/accounting/entries/:id/post', 'accounting', accounting.entries.post);
route('POST',  '/api/v1/accounting/entries/:id/reverse', 'accounting', accounting.entries.reverse);
route('POST',  '/api/v1/accounting/entries/:id/void', 'accounting', accounting.entries.void);

// ── Secure documents: upload and download (Phase 12) ──────────────────────
// documents.write gates the upload (module GET/POST map in lib/authz.js);
// download reuses documents.read, same as the generic GET. 21 MiB body cap:
// documents.MAX_BYTES (15 MiB) as base64 (~+33%) plus headroom for the other
// JSON fields — every other route keeps the 1 MiB default.
route('POST', '/api/v1/documents', 'documents', documents.handlers.upload, null, 21 * 1024 * 1024);
route('GET',  '/api/v1/documents/:id/download', 'documents', documents.handlers.download);

// ── Prospects: conversion into a client (0004-prospects.sql) ─────────────
// Gated by the pipeline on prospects.write (POST on the module) and, inside
// the handler, on prospects.convert. Declared before the generic resources so
// the more specific path is matched first.
route('POST', '/api/v1/prospects/:id/convert', 'prospects', prospects.convert);

// ── Declarative resources ─────────────────────────────────────────────────
Object.keys(registry.DEFS).forEach(function (name) {
  var d = registry.DEFS[name];
  var h = resource.handlers(d);
  var base = '/api/v1/' + name;
  route('GET',    base, d.module, h.list);
  // documents rows are created by the upload path, which owns storage_key,
  // sha256 and byte_size. Exposing generic create would either insert a row
  // pointing at no blob or invite a caller to supply those fields — which is
  // how a document row ends up pointing at someone else's file.
  if (name !== 'documents') {
    route('POST', base, d.module, h.create, function (b) { return resource.validate(d, b, false); });
  }
  route('GET',    base + '/:id', d.module, h.get);
  route('PATCH',  base + '/:id', d.module, h.update, function (b) { return resource.validate(d, b, true); });
  route('DELETE', base + '/:id', d.module, h.retire);
});

function match(method, pathname) {
  for (var i = 0; i < routes.length; i++) {
    var r = routes[i];
    if (r.method !== method) continue;
    var m = r.rx.exec(pathname);
    if (!m) continue;
    var params = {};
    r.names.forEach(function (n, j) { params[n] = m[j + 1]; });
    return { route: r, params: params };
  }
  return null;
}

function readBody(req, limit) {
  var cap = limit || MAX_BODY;
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0;
    req.on('data', function (c) {
      size += c.length;
      // Refuse oversize before buffering it, not after.
      if (size > cap) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      if (!chunks.length) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers) {
  var payload = Buffer.from(JSON.stringify(body === undefined ? null : body));
  var h = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // The API never renders HTML; a browser must not be talked into treating
    // a response as a document.
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
  }, headers || {});
  res.writeHead(status, h);
  res.end(payload);
}

// A handler that answers with a file body (document download) sets
// `raw: <Buffer>` instead of `body`; everything else about the response goes
// through the same headers path (nosniff, no-store by default, CSP), so a
// download cannot accidentally skip a security header the JSON path always
// sets. The content type is never guessed from a filename — it is whatever
// the handler explicitly put in `headers['Content-Type']`.
function sendRaw(res, status, buf, headers) {
  var h = Object.assign({
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox"
  }, headers || {});
  res.writeHead(status, h);
  res.end(buf);
}

/* Optional same-origin serving of the browser app (sites/erp.mythosprod.xyz/app).
 * Off unless ERP_SERVE_APP=1: in production nginx serves the static files and
 * proxies /api/; this exists so the drills and a headless browser can exercise
 * the real app against the real API on one loopback origin, and as a fallback
 * deployment shape. Read-only, no directory listing, no dotfiles, no traversal
 * (the resolved path must stay inside APP_ROOT), fixed MIME map, CSP that
 * matches the app's own rules (no inline script or style). */
var fs = require('fs');
var pathMod = require('path');
var APP_ROOT = pathMod.resolve(__dirname, '..', 'app');
var MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
var APP_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function serveApp(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, { error: 'method_not_allowed' }); return; }
  var rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel.split('/').some(function (seg) { return seg[0] === '.'; })) { send(res, 404, { error: 'not_found' }); return; }
  var full = pathMod.resolve(APP_ROOT, '.' + rel);
  if (full !== APP_ROOT && full.indexOf(APP_ROOT + pathMod.sep) !== 0) { send(res, 404, { error: 'not_found' }); return; }
  var ext = pathMod.extname(full).toLowerCase();
  if (!MIME[ext]) { send(res, 404, { error: 'not_found' }); return; }
  fs.readFile(full, function (err, buf) {
    if (err) { send(res, 404, { error: 'not_found' }); return; }
    var h = {
      'Content-Type': MIME[ext], 'Content-Length': buf.length,
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    };
    if (ext === '.html') { h['Content-Security-Policy'] = APP_CSP; h['X-Frame-Options'] = 'DENY'; }
    res.writeHead(200, h);
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

function createServer(deps) {
  var serveStatic = process.env.ERP_SERVE_APP === '1';
  return http.createServer(function (req, res) {
    // The single, authoritative rate-limit decision for this connection: made
    // before routing, before the body-size check, before static serving —
    // anything reachable from here at all has already been counted. A check
    // placed inside pipeline.handle() (where it lived at first) never saw an
    // unmatched route or an oversize-declared body, because both return
    // before pipeline.handle() is ever called; this is the one point every
    // request passes through regardless of what it turns out to be.
    var ip = (req.socket && req.socket.remoteAddress) || null;
    var rl = ratelimit.check(ip);
    if (!rl.allowed) {
      return send(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfterSeconds) });
    }
    var parsed = url.parse(req.url, true);
    if (serveStatic && parsed.pathname.indexOf('/api/') !== 0) return serveApp(req, res, parsed.pathname);
    var found = match(req.method, parsed.pathname);
    if (!found) return send(res, 404, { error: 'not_found' });
    // A declared oversize body is refused before a byte of it is read, with a
    // real 413 the client can see. (The streaming guard below still covers
    // chunked or lying senders, but destroying the socket mid-body means the
    // client sees a reset rather than a status — found in Phase 5 live checks.)
    var cap = found.route.maxBody;
    var declared = Number(req.headers['content-length'] || 0);
    if (declared > cap) {
      res.on('finish', function () { req.destroy(); });
      return send(res, 413, { error: 'payload too large' }, { Connection: 'close' });
    }

    readBody(req, cap).then(function (body) {
      var request = {
        method: req.method,
        path: parsed.pathname,
        module: found.route.module,
        query: parsed.query,
        body: body,
        ip: (req.socket && req.socket.remoteAddress) || null,
        userAgent: req.headers['user-agent'] || null,
        cookieHeader: req.headers.cookie || null,
        csrf: req.headers['x-csrf-token'] || null,
        // A tenant header is a REQUEST to act in a tenant, never proof of it:
        // membership is re-checked server-side on every call.
        tenantId: UUID.test(String(req.headers['x-tenant-id'] || '')) ? req.headers['x-tenant-id'] : null
      };
      return pipeline.handle(deps, request, function (ctx, client) {
        ctx.id = found.params.id || null;
        ctx.query = parsed.query;
        ctx.userAgent = request.userAgent;
        var out = found.route.handler(ctx, client);
        return Promise.resolve(out).then(function (r) {
          // Routes that audit internally say so with skipAudit: true, which
          // lib/pipeline.js honours. (This used to substitute a fake 'logout'
          // descriptor here, writing a spurious logout audit row on every
          // login and tenant switch.)
          return r;
        });
      }, found.route.validate);
    }).then(function (r) {
      if (r && r.raw) return sendRaw(res, r.status, r.raw, r.headers);
      send(res, r.status, r.body, r.headers);
    }).catch(function (e) {
      // Never leak an internal message to a client. The detail goes to the log.
      process.stderr.write('[erp-api] ' + (e && e.stack ? e.stack : e) + '\n');
      // PostgreSQL constraint and cast errors are CLIENT errors with a stable
      // vocabulary, never 500s (Phase 7: a duplicate quote number surfaced as
      // internal_error). The constraint name is not echoed — only the class.
      var PG = { '23505': [409, 'duplicate'], '23503': [422, 'invalid_reference'], '23502': [422, 'missing_value'],
                 '23514': [422, 'constraint_violation'], '22P02': [422, 'invalid_value'], '22007': [422, 'invalid_value'],
                 '22008': [422, 'invalid_value'], '22003': [422, 'out_of_range'], '22001': [422, 'value_too_long'] };
      var pg = e && e.code && PG[e.code];
      // A module may raise a deliberate business refusal from inside another
      // module's transaction (e.g. the ledger refusing an invoice issue into a
      // closed period): it carries a 4xx status and a safe message.
      if (e && e.expose === true && e.status >= 400 && e.status < 500) {
        return send(res, e.status, { error: String(e.message).replace(/^accounting: /, '') });
      }
      var status = pg ? pg[0]
                 : /payload too large/.test(String(e && e.message)) ? 413
                 : /not valid JSON/.test(String(e && e.message)) ? 400 : 500;
      send(res, status, { error: pg ? pg[1] : (status === 500 ? 'internal_error' : String(e.message)) });
    });
  });
}

function main() {
  var pg = require('pg');
  var pool = db.makePool(pg, {});
  // The application never runs as the table owner: erp_owner bypasses RLS by
  // ownership, so a misconfigured unit would silently disable tenant isolation.
  // Refuse to serve rather than serve unsafely.
  pool.query('SELECT current_user AS role').then(function (r) {
    var role = r.rows && r.rows[0] && r.rows[0].role;
    if (role !== 'erp_app') {
      process.stderr.write('[erp-api] REFUSED: runtime database role is "' + role + '", expected erp_app\n');
      process.exit(3);
    }
    listen();
  }).catch(function (e) {
    process.stderr.write('[erp-api] REFUSED: database not reachable at start: ' + (e && e.message) + '\n');
    process.exit(2);
  });
  function listen() {
  var deps = {
    db: { query: function (sql, params) { return pool.query(sql, params); } },
    pool: pool,
    withTenant: function (tenantId, fn) { return db.withTenant(pool, tenantId, fn); },
    withoutTenant: function (fn) { return db.withoutTenant(pool, fn); }
  };
  var port = Number(process.env.ERP_API_PORT || 8787);
  // Loopback only. Public exposure is a deliberate nginx decision, not a
  // side-effect of starting the process.
  createServer(deps).listen(port, '127.0.0.1', function () {
    process.stdout.write('[erp-api] listening on 127.0.0.1:' + port + ' as erp_app\n');
  });
  }
}

if (require.main === module) main();

module.exports = { createServer: createServer, match: match, routes: routes, MAX_BODY: MAX_BODY };
