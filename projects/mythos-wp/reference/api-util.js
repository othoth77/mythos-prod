'use strict';
// =====================================================
// MYTHOS WP — shared helpers for route modules (V2)
// projects/mythos-wp/reference/api-util.js
//
//   q(req)                       → parsed query string object
//   projectFrom(req, params)     → Promise<{ project, wpPool, kitchen } | null>
//        resolves ?project= / params.project through the registry AND enforces the
//        caller's project access (owner/admin: all; others: wp_user_projects) — an
//        inaccessible project is reported as 404, exactly like an unknown one.
//        `all` / empty → null (caller decides whether a project is required).
//   accessibleProjects(req)      → Promise<[rows]> the projects this session may see
//   fail(code, status, detail)   → error shape used by every handler
//   auditFor(req)                → { actor, role, request_id, client } for audit.record
// =====================================================
var url = require('url');
var auth = require('./auth');
var store = require('./projects-store');
var crud = require('./crud');
var fail = crud.fail;

function q(req) { return url.parse(req.url, true).query || {}; }

function projectFrom(req, params) {
  var id = (params && params.project) || q(req).project;
  if (!id || id === 'all') return Promise.resolve(null);
  return store.resolve(String(id)).then(function (r) {
    if (!r || !auth.canSeeProject(req.session, r.project.id)) throw fail('not_found', 404, 'unknown project');
    return r;
  });
}

function accessibleProjects(req) {
  return store.all().then(function (rows) { return rows.filter(function (p) { return auth.canSeeProject(req.session, p.id); }); });
}

function auditFor(req) {
  return { actor: req.session ? req.session.username : 'anonymous', role: req.session ? req.session.role : null, request_id: req.requestId, client: req.socket && req.socket.remoteAddress };
}

function intParam(v, name) { var n = parseInt(v, 10); if (!n || n < 1) throw fail('validation', 400, name + ' must be a positive integer'); return n; }

module.exports = { q: q, projectFrom: projectFrom, accessibleProjects: accessibleProjects, fail: fail, auditFor: auditFor, intParam: intParam };
