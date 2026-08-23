'use strict';

/* The request boundary: authenticate → resolve tenant → module gate →
 * authorize → validate → execute → audit.
 *
 * Every request passes all seven steps or none. There is no route table that
 * bypasses it, because handlers are registered *through* it — a handler that
 * forgot to check permissions, or forgot the tenant, is not something you can
 * write here.
 *
 * Stage 1 found 16 endpoints, 15 of which required nothing. This is the
 * structural answer: one place to get right, instead of sixteen to get wrong.
 *
 * The tenant step is the one that cannot be left to handlers. Handlers receive
 * a client that is ALREADY inside a transaction with the RLS GUC set, so the
 * database itself refuses another tenant's rows. A handler that writes a bare
 * `SELECT * FROM clients` is still correct — it simply cannot see anyone else.
 */

var auth = require('./auth');
var authz = require('./authz');
var audit = require('./audit');
var tokens = require('./tokens');
var tenancy = require('./tenancy');

var UNSAFE = { POST: true, PUT: true, PATCH: true, DELETE: true };

/* Routes that may run before authentication. Deliberately tiny and explicit:
   anything not listed requires a session. */
var PUBLIC_ROUTES = {
  'POST /api/v1/auth/login': true,
  'POST /api/v1/auth/password-reset/request': true,
  'POST /api/v1/auth/password-reset/complete': true,
  'GET /api/v1/health': true
};

/* Authenticated but deliberately NOT tenant-scoped: choosing which company to
   act in cannot itself require a company. */
var TENANT_FREE_ROUTES = {
  'GET /api/v1/session': true,
  'GET /api/v1/tenants': true,
  'POST /api/v1/session/tenant': true,
  'POST /api/v1/auth/logout': true
};

function isPublic(method, path) {
  return PUBLIC_ROUTES[String(method).toUpperCase() + ' ' + path] === true;
}
function isTenantFree(method, path) {
  return TENANT_FREE_ROUTES[String(method).toUpperCase() + ' ' + path] === true;
}

/* moduleFromPath('/api/v1/clients/123') → 'clients' */
function moduleFromPath(path) {
  var m = /^\/api\/v1\/([a-z][a-z0-9_-]*)/i.exec(String(path || ''));
  return m ? m[1].toLowerCase() : null;
}

/* handler: (ctx, client) => Promise<{status, body, audit}>
 * validate: optional (body) => {ok, error, value}
 *
 * deps: { db, pool, withTenant, withoutTenant }
 *   db          — platform-level executor (no tenant GUC)
 *   withTenant  — (tenantId, fn) => fn runs in a transaction with the GUC set
 */
function handle(deps, req, handler, validate) {
  var db = deps.db;
  var ctx = {
    method: String(req.method || 'GET').toUpperCase(),
    path: req.path,
    // The router may state the module explicitly, because a resource does not
    // always live at a URL named after its module: /api/v1/contacts belongs to
    // the clients module. Deriving it from the path alone would deny-by-default
    // on every such route, which looks like a bug and invites weakening the map.
    module: req.module || moduleFromPath(req.path),
    ip: req.ip || null,
    body: req.body,
    user: null,
    session: null,
    tenantId: null
  };

  // 1. authenticate
  var token = req.cookieHeader ? tokens.readCookie(req.cookieHeader) : req.token;
  return auth.validateSession(deps, token).then(function (session) {
    ctx.session = session;
    ctx.user = session ? session.user : null;

    if (!isPublic(ctx.method, ctx.path) && !ctx.user) {
      return { status: 401, body: { error: 'unauthenticated' } };
    }

    // CSRF on every unsafe verb for an authenticated session. Login is exempt
    // because there is no session yet to bind a token to.
    if (ctx.user && UNSAFE[ctx.method] && !isPublic(ctx.method, ctx.path)) {
      if (!auth.checkCsrf(session, req.csrf)) {
        return audit.write(db, {
          actor_id: ctx.user.id, actor_label: ctx.user.email, action: 'permission.denied',
          entity_table: ctx.module || 'unknown', outcome: 'denied',
          detail: { reason: 'csrf_failed', method: ctx.method, path: ctx.path }, ip: ctx.ip
        }).then(function () { return { status: 403, body: { error: 'csrf_failed' } }; });
      }
    }

    if (isPublic(ctx.method, ctx.path) || isTenantFree(ctx.method, ctx.path)) {
      return runPlatform(deps, ctx, handler, validate);
    }

    // 2. resolve the tenant
    // A client-supplied tenant header is accepted only as a REQUEST to use a
    // tenant the session already has; it is never taken as proof. Membership is
    // re-checked against the database on every request, because a membership
    // can be revoked while a session is open.
    var wanted = req.tenantId || (session && session.activeTenantId) || null;
    if (!wanted) {
      return { status: 409, body: { error: 'no_active_tenant' } };
    }
    // In its own short transaction: the membership check announces the user
    // through a transaction-local setting, which a bare pool query would lose
    // between statements — possibly on a different pooled connection.
    return deps.withoutTenant(function (c) {
      return tenancy.isMember(c, ctx.user.id, wanted);
    }).then(function (member) {
      if (!member) {
        return audit.write(db, {
          actor_id: ctx.user.id, actor_label: ctx.user.email, action: 'permission.denied',
          entity_table: 'tenants', entity_id: wanted, outcome: 'denied',
          detail: { reason: 'not_a_member', path: ctx.path }, ip: ctx.ip
        }).then(function () { return { status: 403, body: { error: 'forbidden' } }; });
      }
      ctx.tenantId = wanted;

      // Everything from here runs inside the tenant transaction.
      return deps.withTenant(wanted, function (client) {
        // 3. module gate — a module a tenant does not have must not be
        // reachable by typing its URL.
        return tenancy.isModuleEnabled(client, ctx.module).then(function (enabled) {
          if (!enabled) return { status: 404, body: { error: 'module_not_enabled' } };

          // 4. authorize
          return authz.authorize(client, ctx).then(function (decision) {
            if (!decision.allowed) {
              return { status: 403, body: { error: 'forbidden', required: decision.key } };
            }

            // 5. validate
            if (validate) {
              var v = validate(ctx.body);
              if (!v || !v.ok) {
                return { status: 422, body: { error: 'validation_failed', detail: (v && v.error) || 'invalid' } };
              }
              ctx.input = v.value;
            }

            // 6. execute + 7. audit, in the same transaction as the change
            return Promise.resolve(handler(ctx, client)).then(function (result) {
              if (!UNSAFE[ctx.method]) return result;
              // A handler that answers 4xx is asserting it changed nothing, so
              // there is nothing to audit. The requirement below applies to
              // SUCCESSFUL state changes, which is where the rule has force.
              if (result && result.status >= 400) return result;
              var a = result && result.audit;
              if (a) {
                return audit.write(client, {
                  actor_id: ctx.user.id, actor_label: ctx.user.email,
                  action: a.action, entity_table: a.entity_table || ctx.module,
                  entity_id: a.entity_id || null, outcome: a.outcome || 'ok',
                  detail: a.detail || {}, ip: ctx.ip, tenant_id: ctx.tenantId
                }).then(function () { return result; });
              }
              // A state-changing handler that returns no audit descriptor is a
              // programming error, not a silent success.
              throw new Error('unaudited state change: ' + ctx.method + ' ' + ctx.path);
            });
          });
        });
      });
    });
  });
}

/* Public and tenant-free routes: no GUC, so every tenant-scoped table is empty
   from this client's point of view — the protection still applies if one of
   these ever touches one by mistake. */
function runPlatform(deps, ctx, handler, validate) {
  if (validate) {
    var v = validate(ctx.body);
    if (!v || !v.ok) {
      return Promise.resolve({ status: 422, body: { error: 'validation_failed', detail: (v && v.error) || 'invalid' } });
    }
    ctx.input = v.value;
  }
  // Always a transaction, including for GET: set_config(..., true) is
  // transaction-local, and a membership lookup outside one would silently lose
  // its scope between statements.
  return deps.withoutTenant(function (client) {
    if (!UNSAFE[ctx.method]) return Promise.resolve(handler(ctx, client));
    return Promise.resolve(handler(ctx, client)).then(function (result) {
      if (result && result.status >= 400) return result;
      var a = result && result.audit;
      if (a) {
        return audit.write(client, {
          actor_id: ctx.user ? ctx.user.id : null,
          actor_label: ctx.user ? ctx.user.email : 'anonymous',
          action: a.action, entity_table: a.entity_table || ctx.module,
          entity_id: a.entity_id || null, outcome: a.outcome || 'ok',
          detail: a.detail || {}, ip: ctx.ip, tenant_id: null
        }).then(function () { return result; });
      }
      throw new Error('unaudited state change: ' + ctx.method + ' ' + ctx.path);
    });
  });
}

module.exports = {
  PUBLIC_ROUTES: PUBLIC_ROUTES,
  TENANT_FREE_ROUTES: TENANT_FREE_ROUTES,
  UNSAFE: UNSAFE,
  isPublic: isPublic,
  isTenantFree: isTenantFree,
  moduleFromPath: moduleFromPath,
  handle: handle
};
