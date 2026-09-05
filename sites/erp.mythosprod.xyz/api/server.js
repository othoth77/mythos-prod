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
var registry = require('./modules/registry');
var invoices = require('./modules/invoices');
var views = require('./modules/views');

var MAX_BODY = 1024 * 1024;          // 1 MiB of JSON is already generous
var UUID = db.UUID;

/* ── Route table ────────────────────────────────────────────────────────────
   [method, pattern, module, handler, validate]
   :id in a pattern must be a UUID — a non-UUID never reaches a handler. */
var routes = [];
function route(method, pattern, module, handler, validate) {
  var names = [];
  var rx = new RegExp('^' + pattern.replace(/:([a-z_]+)/g, function (_, n) {
    names.push(n);
    return '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
  }) + '$', 'i');
  routes.push({ method: method, rx: rx, names: names, module: module, handler: handler, validate: validate });
}

// ── Public and tenant-free ────────────────────────────────────────────────
route('GET', '/api/v1/health', null, function () {
  return { status: 200, body: { ok: true } };
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

route('GET', '/api/v1/session', null, function (ctx, client) {
  return tenancy.membershipsFor(client, ctx.user.id).then(function (m) {
    return { status: 200, body: {
      user: ctx.user, active_tenant_id: ctx.session.activeTenantId,
      tenants: m.map(function (t) { return { id: t.id, key: t.key, display_name: t.display_name }; })
    } };
  });
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

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0;
    req.on('data', function (c) {
      size += c.length;
      // Refuse oversize before buffering it, not after.
      if (size > MAX_BODY) { reject(new Error('payload too large')); req.destroy(); return; }
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

function createServer(deps) {
  return http.createServer(function (req, res) {
    var parsed = url.parse(req.url, true);
    var found = match(req.method, parsed.pathname);
    if (!found) return send(res, 404, { error: 'not_found' });

    readBody(req).then(function (body) {
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
      send(res, r.status, r.body, r.headers);
    }).catch(function (e) {
      // Never leak an internal message to a client. The detail goes to the log.
      process.stderr.write('[erp-api] ' + (e && e.stack ? e.stack : e) + '\n');
      var status = /payload too large/.test(String(e && e.message)) ? 413
                 : /not valid JSON/.test(String(e && e.message)) ? 400 : 500;
      send(res, status, { error: status === 500 ? 'internal_error' : String(e.message) });
    });
  });
}

function main() {
  var pg = require('pg');
  var pool = db.makePool(pg, {});
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
    process.stdout.write('[erp-api] listening on 127.0.0.1:' + port + '\n');
  });
}

if (require.main === module) main();

module.exports = { createServer: createServer, match: match, routes: routes, MAX_BODY: MAX_BODY };
