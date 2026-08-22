'use strict';

/* The request boundary: authenticate → authorize → validate → execute → audit.
 *
 * Every request passes all five steps or none. There is no route table that
 * bypasses it, because handlers are registered *through* it — a handler that
 * forgot to check permissions is not something you can write here.
 *
 * Stage 1 found 16 endpoints, 15 of which required nothing. This is the
 * structural answer to that: one place to get right, instead of sixteen places
 * to get wrong.
 */

var auth = require('./auth');
var authz = require('./authz');
var audit = require('./audit');
var tokens = require('./tokens');

var UNSAFE = { POST: true, PUT: true, PATCH: true, DELETE: true };

/* Routes that may run before authentication. Deliberately tiny and explicit:
   anything not listed requires a session. */
var PUBLIC_ROUTES = {
  'POST /api/v1/auth/login': true,
  'POST /api/v1/auth/password-reset/request': true,
  'POST /api/v1/auth/password-reset/complete': true,
  'GET /api/v1/health': true
};

function isPublic(method, path) {
  return PUBLIC_ROUTES[String(method).toUpperCase() + ' ' + path] === true;
}

/* moduleFromPath('/api/v1/clients/123') → 'clients' */
function moduleFromPath(path) {
  var m = /^\/api\/v1\/([a-z][a-z0-9_-]*)/i.exec(String(path || ''));
  return m ? m[1].toLowerCase() : null;
}

/* handler: (ctx) => Promise<{status, body}>
 * validate: optional (body) => {ok, error, value} */
function handle(deps, req, handler, validate) {
  var db = deps.db;
  var ctx = {
    method: String(req.method || 'GET').toUpperCase(),
    path: req.path,
    module: moduleFromPath(req.path),
    ip: req.ip || null,
    body: req.body,
    user: null,
    session: null
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

    // 2. authorize
    var step2 = isPublic(ctx.method, ctx.path)
      ? Promise.resolve({ allowed: true, key: null })
      : authz.authorize(db, ctx);

    return step2.then(function (decision) {
      if (!decision.allowed) {
        return { status: ctx.user ? 403 : 401, body: { error: 'forbidden', required: decision.key } };
      }

      // 3. validate
      if (validate) {
        var v = validate(ctx.body);
        if (!v || !v.ok) {
          return { status: 422, body: { error: 'validation_failed', detail: (v && v.error) || 'invalid' } };
        }
        ctx.input = v.value;
      }

      // 4. execute + 5. audit, in one transaction when the verb is unsafe
      if (!UNSAFE[ctx.method]) return handler(ctx, db);

      return deps.tx(function (client) {
        return Promise.resolve(handler(ctx, client)).then(function (result) {
          var a = result && result.audit;
          if (a) {
            return audit.write(client, {
              actor_id: ctx.user ? ctx.user.id : null,
              actor_label: ctx.user ? ctx.user.email : 'anonymous',
              action: a.action, entity_table: a.entity_table || ctx.module,
              entity_id: a.entity_id || null, outcome: a.outcome || 'ok',
              detail: a.detail || {}, ip: ctx.ip
            }).then(function () { return result; });
          }
          // A state-changing handler that returns no audit descriptor is a
          // programming error, not a silent success.
          throw new Error('unaudited state change: ' + ctx.method + ' ' + ctx.path);
        });
      });
    });
  });
}

module.exports = {
  PUBLIC_ROUTES: PUBLIC_ROUTES,
  UNSAFE: UNSAFE,
  isPublic: isPublic,
  moduleFromPath: moduleFromPath,
  handle: handle
};
