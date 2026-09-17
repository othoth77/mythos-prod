'use strict';
// =====================================================
// MYTHOS WP — API route table
// projects/mythos-wp/reference/api.js
//
// Every route is declared once with: method, path pattern, required role
// ('any' = authenticated, 'operator', 'owner', or false for the two public
// routes) and a handler(req, res, ctx). server.js resolves the session,
// enforces the role and the CSRF rule for state-changing methods, parses
// the JSON body and calls the handler; handlers return a value (200) or
// throw { code, status } (mapped to one error shape).
//
// Project scope: `?project=<id>` (or the :project path segment) selects
// the registry row through api-util.projectFrom, which also enforces the
// caller's project access (owner/admin: all; others: wp_user_projects).
// V2 route modules (routes/whatsapp.js, routes/ai.js, routes/platform.js)
// are concatenated at the bottom.
// =====================================================

var url = require('url');
var db = require('./db');
var auth = require('./auth');
var resources = require('./resources');
var users = require('./users');
var crud = require('./crud');
var audit = require('./audit');
var store = require('./projects-store');
var dashboard = require('./dashboard');
var autoreply = require('./autoreply');
var receiver = require('./comms/receiver');
var routing = require('./comms/routing');
var inbox = require('./comms/inbox');
var outbound = require('./comms/outbound');
var assistant = require('./comms/assistant');
var commsBus = require('./comms/bus');

var VERSION = require('../package.json').version;
function users_state_of_file() { return auth.usersState(); }
// usersGuard(req, target, body) — an account may only be changed by a caller who outranks it, and a caller may
// never grant a role at or above their own (owner excepted). The last active owner cannot be demoted/disabled/deleted.
function usersGuard(req, target, body) {
  var callerRank = auth.ROLE_RANK[req.session.role] || 0;
  return db.wp().query('SELECT role, status FROM wp_users WHERE username = $1', [target]).then(function (r) {
    var t = r.rows[0]; if (!t) throw fail('not_found', 404, 'no such user');
    var targetRank = auth.ROLE_RANK[t.role] || 0;
    if (req.session.role !== 'owner' && targetRank >= callerRank) throw fail('forbidden', 403, 'you cannot change an account of equal or higher rank');
    if (body.role !== undefined && req.session.role !== 'owner' && (auth.ROLE_RANK[body.role] || 0) >= callerRank) throw fail('forbidden', 403, 'you cannot grant a role at or above your own');
    if (target === req.session.username && (body.role !== undefined || body.status === 'disabled')) throw fail('forbidden', 403, 'you cannot change your own role or disable yourself');
    var demotes = t.role === 'owner' && ((body.role !== undefined && body.role !== 'owner') || body.status === 'disabled' || (body.role === undefined && body.status === undefined));
    if (!demotes) return null;
    return db.wp().query("SELECT count(*)::int AS n FROM wp_users WHERE role = 'owner' AND status = 'active'").then(function (c) { if (c.rows[0].n <= 1) throw fail('forbidden', 403, 'the last active owner cannot be demoted, disabled or deleted'); });
  });
}
var fail = crud.fail;

function q(req) { return url.parse(req.url, true).query || {}; }

var apiUtil = require('./api-util');
var projectFrom = apiUtil.projectFrom;

function resourceOr404(key) {
  var r = resources.get(key);
  if (!r) throw fail('not_found', 404, 'unknown resource');
  return r;
}

function crudCtx(req, r, resolved) {
  if (r.scope !== 'wp') throw fail('not_found', 404, 'unknown resource');
  if (!r.global && !r.projectOptional && !resolved) throw fail('project_required', 400, 'a project is required for this resource');
  // a project-scoped session may list project-optional resources (audit) only inside one of its projects
  if (r.projectOptional && !resolved && req.session && req.session.projects !== null) throw fail('project_required', 400, 'select a project');
  return {
    pool: db.wp(), auditPool: db.wp(),
    project: resolved ? resolved.project : null,
    session: req.session, actor: req.session.username, hasRole: auth.hasRole,
    requestId: req.requestId, client: req.socket.remoteAddress
  };
}

function requireRead(req, r) {
  if (!auth.hasRole(req.session, r.permissions.read || 'agent')) throw fail('forbidden', 403, 'insufficient role');
}

function parseFilters(query) {
  var out = {};
  Object.keys(query).forEach(function (k) { var m = /^f\.([a-z_]+)$/.exec(k); if (m) out[m[1]] = query[k]; });
  return out;
}

// ---------------------------------------------------------------- handlers

var ROUTES = [
  // --- session ---------------------------------------------------------
  { method: 'POST', path: /^\/api\/login$/, role: false, csrf: false, handler: function (req, res, ctx) {
    var body = ctx.body || {};
    if (!auth.loginAllowed(req, body.username)) throw fail('throttled', 429, 'too many failed attempts; try again later');
    var pool = null; try { pool = db.wp(); } catch (e) { pool = null; } // no database env → users file only, never a 500
    return (pool ? users.forLogin(pool) : Promise.resolve([])).then(function (dbUsers) {
      var v = auth.verifyCredentials(body.username, body.password, dbUsers);
      if (!v.ok) {
        auth.recordLoginFailure(req, body.username);
        if (pool) audit.record(pool, { actor: auth.USERNAME_RE.test(String(body.username || '').toLowerCase()) ? String(body.username).toLowerCase() : 'invalid', action: 'login_failed', resource: 'session', request_id: req.requestId, client: req.socket.remoteAddress, next: { reason: v.reason } }).catch(function () {});
        if (v.reason === 'invalid' || v.reason === 'disabled') throw fail('unauthorized', 401, 'invalid credentials');
        throw fail('auth_unavailable', 503, 'authentication is not configured');
      }
      return (pool ? users.accessList(pool, v.user) : Promise.resolve(null)).then(function (access) {
        auth.clearLoginFailures(req, body.username);
        v.user.projects = access;
        var s = auth.createSession(v.user);
        ctx.setCookie(auth.sessionCookie(s.id));
        if (v.user.source === 'db' && pool) users.touchLogin(pool, v.user.username);
        if (pool) audit.record(pool, { actor: v.user.username, role: v.user.role, action: 'login', resource: 'session', request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return { username: v.user.username, role: v.user.role, projects: access, expires_at: new Date(s.expiresAt).toISOString() };
      });
    });
  } },
  { method: 'POST', path: /^\/api\/logout$/, role: 'any', handler: function (req, res, ctx) {
    auth.destroySession(req.session.id);
    ctx.setCookie(auth.clearedCookie());
    audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'logout', resource: 'session', request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
    return { signed_out: true };
  } },
  { method: 'GET', path: /^\/api\/session$/, role: 'any', handler: function (req) {
    return { username: req.session.username, role: req.session.role, projects: req.session.projects, expires_at: new Date(req.session.expiresAt).toISOString() };
  } },

  // --- meta ------------------------------------------------------------
  { method: 'GET', path: /^\/api\/meta$/, role: 'any', handler: function (req) {
    return apiUtil.accessibleProjects(req).then(function (rows) {
      return {
        version: VERSION, product: 'MYTHOS Control Center', unit: 'MYTHOS WP',
        user: { username: req.session.username, role: req.session.role, projects: req.session.projects },
        roles: auth.ROLES, role_rank: auth.ROLE_RANK,
        resources: resources.publicAll(), groups: resources.GROUPS,
        projects: rows.map(function (p) { return { id: p.id, display_name: p.display_name, domain: p.domain, status: p.status, kind: p.kind || 'service', currency: p.currency, description: p.description || null, settings: p.settings || {}, kitchen: p.settings && p.settings.kitchen ? p.settings.kitchen : null }; })
      };
    });
  } },

  // --- health ----------------------------------------------------------
  { method: 'GET', path: /^\/api\/health$/, role: 'any', handler: function () {
    var fileUsers = users_state_of_file();
    return db.wp().query('SELECT 1').then(function () { return true; }, function () { return false; }).then(function (wpOk) {
      return (wpOk ? db.wp().query('SELECT count(*)::int AS n FROM wp_users WHERE status = \'active\'').then(function (r) { return r.rows[0].n; }, function () { return null; }) : Promise.resolve(null)).then(function (dbCount) {
        return {
          ok: wpOk, version: VERSION, node: process.version, uptime_s: Math.round(process.uptime()), rss_mb: Math.round(process.memoryUsage().rss / 1048576),
          database: { wp: wpOk },
          auth: { users_provisioned: fileUsers.provisioned || (dbCount !== null && dbCount > 0), users_reason: fileUsers.reason, users_file_count: fileUsers.count, users_db_count: dbCount, session_ttl_ms: auth.ttlMs() },
          comms_config: autoreply.loadConfig().present ? 'present' : 'absent'
        };
      });
    });
  } },

  // --- generic resources ---------------------------------------------
  { method: 'GET', path: /^\/api\/r\/([a-z_]+)$/, role: 'any', handler: function (req, res, ctx) {
    var r = resourceOr404(ctx.params[1]);
    requireRead(req, r);
    var query = q(req);
    return projectFrom(req).then(function (resolved) {
      return crud.list(r, crudCtx(req, r, resolved), { page: query.page, limit: query.limit, sort: query.sort, dir: query.dir, search: query.q, filters: parseFilters(query) }).then(function (page) {
        if (r.key === 'projects' && req.session.projects !== null) { page.rows = page.rows.filter(function (p) { return auth.canSeeProject(req.session, p.id); }); page.total = page.rows.length; }
        return page;
      });
    });
  } },
  { method: 'GET', path: /^\/api\/r\/([a-z_]+)\/lookup$/, role: 'any', handler: function (req, res, ctx) {
    var r = resourceOr404(ctx.params[1]);
    requireRead(req, r);
    var query = q(req);
    return projectFrom(req).then(function (resolved) {
      return crud.lookup(r, crudCtx(req, r, resolved), { search: query.q, ids: query.ids ? String(query.ids).split(',') : null, display: query.display, by: query.by }).then(function (rows) {
        return r.key === 'projects' && req.session.projects !== null ? rows.filter(function (x) { return auth.canSeeProject(req.session, x.id); }) : rows;
      });
    });
  } },
  { method: 'GET', path: /^\/api\/r\/([a-z_]+)\/([A-Za-z0-9._:-]+)$/, role: 'any', handler: function (req, res, ctx) {
    var r = resourceOr404(ctx.params[1]);
    requireRead(req, r);
    return projectFrom(req).then(function (resolved) {
      var c = crudCtx(req, r, resolved);
      if (r.key === 'projects' && !auth.canSeeProject(req.session, ctx.params[2])) throw fail('not_found', 404, 'no such record');
      return crud.get(r, c, ctx.params[2]).then(function (row) {
        return audit.history(db.wp(), r.key, row[r.idColumn], 20, resolved ? resolved.project.id : null).then(function (h) { return { row: row, history: h }; });
      });
    });
  } },
  { method: 'POST', path: /^\/api\/r\/([a-z_]+)$/, role: 'agent', handler: function (req, res, ctx) {
    var r = resourceOr404(ctx.params[1]);
    return projectFrom(req).then(function (resolved) {
      if (r.key === 'users') {
        // accounts carry a password hash: created through users.upsert (hash never round-trips), audited like a resource
        if (!auth.hasRole(req.session, r.permissions.write)) throw fail('forbidden', 403, 'requires role ' + r.permissions.write);
        var body = ctx.body || {};
        if (body.role === 'owner' && req.session.role !== 'owner') throw fail('forbidden', 403, 'only an owner may create an owner');
        return users.upsert(db.wp(), { username: String(body.username || '').toLowerCase(), role: body.role, password: body.password, display_name: body.display_name, status: body.status, all_projects: body.all_projects === true }, req.session.username).then(function (row) {
          ctx.status(201);
          return audit.record(db.wp(), Object.assign(apiUtil.auditFor(req), { action: 'create', resource: 'users', record_id: row.username, next: { role: row.role, status: row.status, all_projects: row.all_projects } })).then(function (audited) { return { row: row, audited: audited }; });
        });
      }
      return crud.create(r, crudCtx(req, r, resolved), ctx.body).then(function (o) { if (r.key === 'projects') store.invalidate(); ctx.status(201); return o; });
    });
  } },
  { method: 'PATCH', path: /^\/api\/r\/([a-z_]+)\/([A-Za-z0-9._:-]+)$/, role: 'agent', handler: function (req, res, ctx) {
    var r = resourceOr404(ctx.params[1]);
    return projectFrom(req).then(function (resolved) {
      var body = ctx.body || {};
      if (r.key === 'users') return usersGuard(req, ctx.params[2], body).then(function () {
        return crud.update(r, crudCtx(req, r, resolved), ctx.params[2], body).then(function (o) {
          if (body.role !== undefined || body.status !== undefined) auth.revokeUser(ctx.params[2]);
          return o;
        });
      });
      // Handoff resolution stamps: set by the server, never by the client.
      if (r.key === 'handoffs' && body.status === 'RESOLVED') {
        return crud.update(r, crudCtx(req, r, resolved), ctx.params[2], body).then(function (o) {
          return db.wp().query('UPDATE wp_handoffs SET resolved_by = $1, resolved_at = now() WHERE id = $2 AND project_id = $3 RETURNING *', [req.session.username, o.row.id, resolved.project.id]).then(function (u) { o.row = u.rows[0] || o.row; return o; });
        });
      }
      return crud.update(r, crudCtx(req, r, resolved), ctx.params[2], body).then(function (o) { if (r.key === 'projects') store.invalidate(); return o; });
    });
  } },
  { method: 'DELETE', path: /^\/api\/r\/([a-z_]+)\/([A-Za-z0-9._:-]+)$/, role: 'agent', handler: function (req, res, ctx) {
    var r = resourceOr404(ctx.params[1]);
    return projectFrom(req).then(function (resolved) {
      if (r.key === 'users' && ctx.params[2] === req.session.username) throw fail('forbidden', 403, 'you cannot delete your own account');
      if (r.key === 'users') return usersGuard(req, ctx.params[2], {}).then(function () { return crud.remove(r, crudCtx(req, r, resolved), ctx.params[2]).then(function (o) { auth.revokeUser(ctx.params[2]); return o; }); });
      return crud.remove(r, crudCtx(req, r, resolved), ctx.params[2]).then(function (o) { if (r.key === 'projects') store.invalidate(); return o; });
    });
  } },

  // --- users: password + project access (admin) --------------------------
  { method: 'POST', path: /^\/api\/users\/([a-z][a-z0-9._-]{1,31})\/password$/, role: 'admin', handler: function (req, res, ctx) {
    var body = ctx.body || {};
    return db.wp().query('SELECT role FROM wp_users WHERE username = $1', [ctx.params[1]]).then(function (r) {
      if (!r.rows[0]) throw fail('not_found', 404, 'no such user');
      if (r.rows[0].role === 'owner' && req.session.role !== 'owner') throw fail('forbidden', 403, 'only an owner may reset an owner password');
      return users.setPassword(db.wp(), ctx.params[1], body.password, req.session.username).then(function (out) {
        if (ctx.params[1] !== req.session.username) auth.revokeUser(ctx.params[1]);
        return audit.record(db.wp(), Object.assign(apiUtil.auditFor(req), { action: 'setting', resource: 'users', record_id: out.username, next: { password: 'rotated' } })).then(function () { return out; });
      });
    });
  } },
  { method: 'GET', path: /^\/api\/users\/([a-z][a-z0-9._-]{1,31})\/projects$/, role: 'admin', handler: function (req, res, ctx) {
    return users.projectsOf(db.wp(), ctx.params[1]).then(function (rows) { return { username: ctx.params[1], projects: rows }; });
  } },
  { method: 'PATCH', path: /^\/api\/users\/([a-z][a-z0-9._-]{1,31})\/projects$/, role: 'admin', handler: function (req, res, ctx) {
    return users.setProjects(db.wp(), ctx.params[1], ctx.body || {}, req.session.username).then(function (out) {
      auth.refreshUserProjects(ctx.params[1], out.projects);
      return audit.record(db.wp(), Object.assign(apiUtil.auditFor(req), { action: 'setting', resource: 'users', record_id: out.username, next: { projects: out.projects, add: (ctx.body || {}).add, remove: (ctx.body || {}).remove } })).then(function () { return out; });
    });
  } },

  // --- project-centric views -------------------------------------------
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/dashboard$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return typeof dashboard.buildProject === 'function' ? dashboard.buildProject(resolved) : dashboard.build(resolved); });
  } },
  // --- Communication OS: inbox / conversations / contacts / tags / SSE ----
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      var qq = q(req);
      return inbox.scope(db.wp(), req.session.username).then(function (scope) {
        return Promise.all([inbox.listConversations(db.wp(), resolved.project.id, { status: qq.status, assigned: qq.assigned, username: req.session.username, inbox: qq.inbox, tag: qq.tag, handler: qq.handler, agent: qq.agent, q: qq.q, before: qq.before, limit: qq.limit, scope: scope }), inbox.counts(db.wp(), resolved.project.id, scope)])
          .then(function (x) { return { items: x[0].items, next_before: x[0].next_before, counts: x[1], scoped: scope !== null }; });
      });
    });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.scope(db.wp(), req.session.username).then(function (scope) { return inbox.getConversation(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), scope); }); });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/messages$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { var qq = q(req); return inbox.scope(db.wp(), req.session.username).then(function (scope) { return inbox.getConversation(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), scope).then(function () { return inbox.listMessages(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), { before_id: qq.before_id, limit: qq.limit }); }); }); });
  } },
  // --- AI assistant (suggest-only) ------------------------------------
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/suggest$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      var cid = parseInt(ctx.params[2], 10);
      return assistant.suggest(db.wp(), resolved, cid, req.session.username, { message_id: ctx.body && ctx.body.message_id, trigger: 'manual' }).then(function (out) {
        ctx.status(201);
        audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'create', resource: 'ai_runs', record_id: String(out.run_id), project_id: resolved.project.id, next: { conversation_id: cid, decision: out.decision, intent: out.intent, confidence: out.confidence }, request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return out;
      });
    });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/suggestions$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return assistant.listSuggestions(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10)); });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/suggestions\/([0-9]+)\/decide$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      var cid = parseInt(ctx.params[2], 10), sid = parseInt(ctx.params[3], 10);
      return assistant.decide(db.wp(), resolved.project.id, cid, sid, req.session.username, ctx.body || {}).then(function (out) {
        audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'update', resource: 'ai_suggestions', record_id: String(sid), project_id: resolved.project.id, next: { action: (ctx.body || {}).action, conversation_id: cid }, request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return out;
      });
    });
  } },

  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/messages$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      var cid = parseInt(ctx.params[2], 10);
      return outbound.send(db.wp(), resolved.project.id, cid, req.session.username, ctx.body || {}).then(function (r) {
        ctx.status(r.duplicate ? 200 : 201);
        audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'create', resource: 'messages', record_id: String(r.message_id), project_id: resolved.project.id, next: { conversation_id: cid, status: r.status, duplicate: r.duplicate, length: String((ctx.body || {}).text || '').length }, request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return r;
      });
    });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/messages\/([0-9]+)\/retry$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      return outbound.retry(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), parseInt(ctx.params[3], 10), req.session.username).then(function (r) {
        audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'update', resource: 'messages', record_id: String(r.message_id), project_id: resolved.project.id, next: { retry: true, status: r.status }, request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return r;
      });
    });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/read$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.markRead(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), req.session.username); });
  } },
  { method: 'PATCH', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      return inbox.updateConversation(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), req.session.username, ctx.body || {}).then(function (row) {
        audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'update', resource: 'conversations', record_id: String(row.id), project_id: resolved.project.id, next: ctx.body, request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return row;
      });
    });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/notes$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { ctx.status(201); return inbox.addNote(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), req.session.username, ctx.body && ctx.body.text); });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/tags\/([0-9]+)$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.tagConversation(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), parseInt(ctx.params[3], 10), req.session.username, false); });
  } },
  { method: 'DELETE', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/tags\/([0-9]+)$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.tagConversation(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), parseInt(ctx.params[3], 10), req.session.username, true); });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/tags$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.listTags(db.wp(), resolved.project.id); });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/tags$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { ctx.status(201); return inbox.createTag(db.wp(), resolved.project.id, req.session.username, ctx.body || {}); });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/contacts$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { var qq = q(req); return inbox.scope(db.wp(), req.session.username).then(function (scope) { return inbox.listContacts(db.wp(), resolved.project.id, { q: qq.q, status: qq.status, tag: qq.tag, limit: qq.limit, scope: scope }); }); });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/contacts\/([0-9]+)$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.getContact(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10)); });
  } },
  { method: 'PATCH', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/contacts\/([0-9]+)$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      return inbox.updateContact(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), req.session.username, ctx.body || {}).then(function (row) {
        audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'update', resource: 'contacts', record_id: String(row.id), project_id: resolved.project.id, next: ctx.body, request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return row;
      });
    });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/contacts\/([0-9]+)\/tags\/([0-9]+)$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.tagContact(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), parseInt(ctx.params[3], 10), req.session.username, false); });
  } },
  { method: 'DELETE', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/contacts\/([0-9]+)\/tags\/([0-9]+)$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.tagContact(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), parseInt(ctx.params[3], 10), req.session.username, true); });
  } },
  // SSE: per-project change feed (types + ids only; never message text). Heartbeat every 25 s.
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/events$/, role: 'any', stream: true, handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      var pid = resolved.project.id;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 5000\n\n');
      var write = function (ev) { if (ev.project_id !== pid) return; try { res.write('event: ' + ev.type + '\ndata: ' + JSON.stringify(ev) + '\n\n'); } catch (e) { /* closed */ } };
      var hb = setInterval(function () { try { res.write(': hb\n\n'); } catch (e) { /* closed */ } }, 25000);
      commsBus.bus.on('comms', write);
      var done = function () { clearInterval(hb); commsBus.bus.removeListener('comms', write); };
      req.on('close', done); res.on('close', done);
    });
  } },

  // --- Communication providers: contract status + capabilities (non-secret) ---
  { method: 'GET', path: /^\/api\/comms\/providers$/, role: 'any', handler: function () {
    var reg = receiver.registry;
    return { providers: reg.all().map(function (p) { return { id: p.id, describe: p.describe(), capabilities: p.capabilities() }; }) };
  } },

  // --- Shared-account routing (COMMS-11): rules are project-scoped; reads for members, writes for owners; drops are hashes only ---
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/routes$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return routing.listRules(db.wp(), resolved.project.id, { inbox_id: q(req).inbox_id }).then(function (rows) { return { items: rows }; }); });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/routes$/, role: 'admin', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return routing.addRule(db.wp(), resolved.project.id, ctx.body || {}, req.session.username).then(function (row) { ctx.status(201); return row; }); });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/routes\/(\d+)\/(enable|disable)$/, role: 'admin', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return routing.setRuleEnabled(db.wp(), resolved.project.id, ctx.params[2], ctx.params[3] === 'enable', req.session.username); });
  } },
  { method: 'GET', path: /^\/api\/comms\/routing-drops$/, role: 'admin', handler: function (req) {
    return routing.listDrops(db.wp(), { limit: q(req).limit }).then(function (rows) { return { items: rows }; });
  } },

  // --- Multi-service: the caller's inbox memberships (visibility scope) ---
  { method: 'GET', path: /^\/api\/comms\/my-inboxes$/, role: 'any', handler: function (req) {
    return inbox.memberships(db.wp(), req.session.username).then(function (rows) { return { username: req.session.username, scoped: rows.length > 0, inboxes: rows }; });
  } },

  // --- Communication Receiver status (non-secret) ---------------------
  { method: 'GET', path: /^\/api\/comms\/receiver$/, role: 'any', handler: function (req) {
    var d = receiver.describe();
    return db.wp().query("SELECT id, project_id, provider, instance, status, inbound_enabled, outbound_enabled, last_event_at FROM wp_inboxes ORDER BY id").then(function (r) {
      return { receiver: d, inboxes: r.rows.filter(function (i) { return auth.canSeeProject(req.session, i.project_id); }) };
    }, function () { return { receiver: d, inboxes: [] }; });
  } },

  // --- Auto-Reply control centre ---------------------------------------
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/autoreply\/status$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return autoreply.status(resolved); });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/autoreply\/simulate$/, role: 'manager', handler: function (req, res, ctx) {
    var text = ctx.body && typeof ctx.body.text === 'string' ? ctx.body.text : '';
    if (!text.trim()) throw fail('validation', 400, 'text is required', { errors: { text: 'required' } });
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      return autoreply.simulate(resolved, text).then(function (out) {
        audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'simulate', resource: 'autoreply', project_id: resolved.project.id, next: { intent: out.intent, action: out.action, outcome: out.outcome, verified: out.facts.verified, unknown: out.facts.unknown }, request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return out;
      });
    });
  } },
  { method: 'GET', path: /^\/api\/audit\/([a-z_]+)\/([A-Za-z0-9._:-]+)$/, role: 'manager', handler: function (req, res, ctx) {
    // project-scoped sessions must name one of their projects; owner/admin may read platform-wide history
    return projectFrom(req).then(function (resolved) {
      if (!resolved && req.session.projects !== null) throw fail('project_required', 400, 'select a project');
      return audit.history(db.wp(), ctx.params[1], ctx.params[2], q(req).limit, resolved ? resolved.project.id : null).then(function (h) { return { history: h }; });
    });
  } }
];
// V2 route modules (docs/V2_BUILD_CONTRACT.md): WhatsApp / AI / platform. Each exports an array of route objects.
ROUTES = ROUTES.concat(require('./routes/whatsapp'), require('./routes/ai'), require('./routes/platform'));

module.exports = { ROUTES: ROUTES, VERSION: VERSION };
