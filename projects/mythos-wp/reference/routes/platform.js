'use strict';
// =====================================================
// MYTHOS WP V2 — platform routes (docs/V2_BUILD_CONTRACT.md, "Platform")
// projects/mythos-wp/reference/routes/platform.js
//
// Dashboard, global search, integrations, health center, automations (+ runs),
// notes and the read-only Kitchen passthroughs. Every route is scoped to the
// projects the session may see (api-util.accessibleProjects / projectFrom);
// every mutation is audited; creates answer 201. No secret is ever returned:
// integrations carry the NAME of a credential variable, never a value.
// =====================================================
var db = require('../db');
var lastManualHealthRun = 0;
var auth = require('../auth');
var audit = require('../audit');
var apiUtil = require('../api-util');
var dashboard = require('../dashboard');
var search = require('../search');
var integrations = require('../integrations');
var health = require('../health');
var automations = require('../automations');
var notes = require('../notes');
var kitchen = require('../kitchen');

var q = apiUtil.q;
var fail = apiUtil.fail;
var projectFrom = apiUtil.projectFrom;
var accessibleProjects = apiUtil.accessibleProjects;

function log(req, e) { return audit.record(db.wp(), Object.assign(apiUtil.auditFor(req), e)).catch(function () { return false; }); }
function idOf(v) { return apiUtil.intParam(v, 'id'); }

// scope(req) → { projects: [rows], project: id | null } after enforcing access to ?project=
function scope(req) {
  var pid = q(req).project;
  return accessibleProjects(req).then(function (rows) {
    if (!pid || pid === 'all') return { projects: rows, project: null };
    return projectFrom(req, { project: pid }).then(function () { return { projects: rows, project: String(pid) }; });
  });
}

function kitchenFor(req, projectId) {
  return projectFrom(req, { project: projectId }).then(function (resolved) {
    return kitchen.forProject(db.wp(), resolved.project).then(function (client) { return { resolved: resolved, client: client }; });
  });
}
// Kitchen answers → HTTP: not found stays 404, transport failures are 503 with the contract's error kind.
function kitchenResult(r, map) {
  if (r.ok) return map(r);
  if (r.kind === 'BAD_STATUS' && r.status === 404) throw fail('not_found', 404, 'not found in the Kitchen');
  throw fail('kitchen_unavailable', 503, 'Kitchen ' + r.kind, { kind: r.kind });
}
function automationAccess(req, row) {
  if (!row) throw fail('not_found', 404, 'no such automation');
  if (row.project_id && !auth.canSeeProject(req.session, row.project_id)) throw fail('not_found', 404, 'no such automation');
  return row;
}

module.exports = [
  // --- dashboard / search --------------------------------------------------
  { method: 'GET', path: /^\/api\/dashboard$/, role: 'any', handler: function (req) {
    return scope(req).then(function (s) { return dashboard.build(db.wp(), s); });
  } },
  { method: 'GET', path: /^\/api\/search$/, role: 'any', handler: function (req) {
    return scope(req).then(function (s) { return search.search(db.wp(), { q: q(req).q, projects: s.projects, project: s.project, admin: auth.hasRole(req.session, 'admin') }); });
  } },

  // --- integrations ----------------------------------------------------------
  { method: 'GET', path: /^\/api\/integrations$/, role: 'any', handler: function (req) {
    return accessibleProjects(req).then(function (rows) { return integrations.list(db.wp(), { kind: q(req).kind, status: q(req).status, projects: req.session.projects === null ? undefined : rows.map(function (r) { return r.id; }) }).then(function (items) { return { items: items }; }); });
  } },
  { method: 'POST', path: /^\/api\/integrations$/, role: 'admin', handler: function (req, res, ctx) {
    return integrations.create(db.wp(), ctx.body || {}).then(function (row) {
      ctx.status(201);
      return log(req, { action: 'create', resource: 'integrations', record_id: row.key, project_id: row.project_id, next: row }).then(function () { return row; });
    });
  } },
  { method: 'PATCH', path: /^\/api\/integrations\/([a-z0-9-]+)$/, role: 'admin', handler: function (req, res, ctx) {
    return integrations.update(db.wp(), ctx.params[1], ctx.body || {}).then(function (o) {
      var d = audit.diff(o.previous, o.row);
      return log(req, { action: 'update', resource: 'integrations', record_id: o.row.key, project_id: o.row.project_id, previous: d.previous, next: d.next, changed_fields: d.fields }).then(function () { return o.row; });
    });
  } },
  { method: 'DELETE', path: /^\/api\/integrations\/([a-z0-9-]+)$/, role: 'owner', handler: function (req, res, ctx) {
    return integrations.remove(db.wp(), ctx.params[1]).then(function (o) {
      return log(req, { action: 'delete', resource: 'integrations', record_id: o.key, project_id: o.previous.project_id, previous: o.previous }).then(function () { return { key: o.key, deleted: true }; });
    });
  } },
  { method: 'POST', path: /^\/api\/integrations\/([a-z0-9-]+)\/test$/, role: 'admin', handler: function (req, res, ctx) {
    return integrations.test(db.wp(), ctx.params[1]).then(function (r) {
      return log(req, { action: 'test', resource: 'integrations', record_id: r.key, next: { status: r.status, detail: r.detail } }).then(function () { return { key: r.key, status: r.status, detail: r.detail, checked_at: r.checked_at, duration_ms: r.duration_ms, health_state: r.row ? r.row.health_state : null, credentials_state: r.row ? r.row.credentials_state : null }; });
    });
  } },

  // --- health center ---------------------------------------------------------
  { method: 'GET', path: /^\/api\/health\/center$/, role: 'any', handler: function () { return health.center(db.wp()); } },
  { method: 'POST', path: /^\/api\/health\/run$/, role: 'manager', handler: function (req) {
    // manual runs are rate-limited (one per minute) and never overlap the scheduler
    if (health.isRunning && health.isRunning()) throw fail('precondition', 412, 'a health run is already in progress');
    if (Date.now() - lastManualHealthRun < 60000 && !auth.hasRole(req.session, 'owner')) throw fail('rate_limited', 429, 'health checks ran less than a minute ago');
    lastManualHealthRun = Date.now();
    return health.runAll(db.wp(), {}).then(function (doc) {
      return log(req, { action: 'run', resource: 'health', next: { summary: doc.summary, components: doc.components.length } }).then(function () { return doc; });
    });
  } },

  // --- automations -----------------------------------------------------------
  { method: 'GET', path: /^\/api\/automations$/, role: 'any', handler: function (req) {
    return scope(req).then(function (s) { return automations.list(db.wp(), { project: s.project, projects: s.projects.map(function (r) { return r.id; }) }).then(function (items) { return { items: items }; }); });
  } },
  { method: 'POST', path: /^\/api\/automations$/, role: 'admin', handler: function (req, res, ctx) {
    var body = ctx.body || {};
    var check = body.project_id ? projectFrom(req, { project: body.project_id }) : Promise.resolve(null);
    return check.then(function () { return automations.create(db.wp(), req.session.username, body); }).then(function (row) {
      ctx.status(201);
      return log(req, { action: 'create', resource: 'automations', record_id: String(row.id), project_id: row.project_id, next: row }).then(function () { return row; });
    });
  } },
  { method: 'PATCH', path: /^\/api\/automations\/(\d+)$/, role: 'admin', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]);
    return automations.get(db.wp(), id).then(function (row) { automationAccess(req, row); return automations.update(db.wp(), id, ctx.body || {}); }).then(function (o) {
      var d = audit.diff(o.previous, o.row);
      return log(req, { action: 'update', resource: 'automations', record_id: String(id), project_id: o.row.project_id, previous: d.previous, next: d.next, changed_fields: d.fields }).then(function () { return o.row; });
    });
  } },
  { method: 'DELETE', path: /^\/api\/automations\/(\d+)$/, role: 'admin', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]);
    return automations.get(db.wp(), id).then(function (row) { automationAccess(req, row); return automations.remove(db.wp(), id); }).then(function (o) {
      return log(req, { action: 'delete', resource: 'automations', record_id: String(id), project_id: o.previous.project_id, previous: o.previous }).then(function () { return { id: id, deleted: true }; });
    });
  } },
  { method: 'POST', path: /^\/api\/automations\/(\d+)\/(enable|disable)$/, role: 'admin', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]); var enabled = ctx.params[2] === 'enable';
    return automations.get(db.wp(), id).then(function (row) { automationAccess(req, row); return automations.setEnabled(db.wp(), id, enabled); }).then(function (row) {
      return log(req, { action: 'status', resource: 'automations', record_id: String(id), project_id: row.project_id, next: { enabled: enabled } }).then(function () { return { id: row.id, enabled: row.enabled }; });
    });
  } },
  { method: 'GET', path: /^\/api\/automations\/(\d+)\/runs$/, role: 'any', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]);
    return automations.get(db.wp(), id).then(function (row) {
      automationAccess(req, row);
      return accessibleProjects(req).then(function (rows) { return automations.listRuns(db.wp(), { automation_id: id, projects: rows.map(function (r) { return r.id; }), limit: q(req).limit }); }).then(function (items) { return { items: items }; });
    });
  } },
  { method: 'GET', path: /^\/api\/automation-runs$/, role: 'any', handler: function (req) {
    return scope(req).then(function (s) { return automations.listRuns(db.wp(), { project: s.project, projects: s.projects.map(function (r) { return r.id; }), limit: q(req).limit, conversation_id: q(req).conversation_id }).then(function (items) { return { items: items }; }); });
  } },

  // --- notes -----------------------------------------------------------------
  { method: 'GET', path: /^\/api\/notes$/, role: 'any', handler: function (req) {
    return scope(req).then(function (s) { return notes.list(db.wp(), { kind: q(req).kind, id: q(req).id, project: s.project, projects: s.projects.map(function (r) { return r.id; }), limit: q(req).limit }); });
  } },
  { method: 'POST', path: /^\/api\/notes$/, role: 'agent', handler: function (req, res, ctx) {
    var body = ctx.body || {};
    var pid = body.project_id || (body.kind === 'project' ? body.id : null);
    if (!pid) throw fail('validation', 400, 'project_id is required', { project_id: 'required' });
    return projectFrom(req, { project: pid }).then(function () { return notes.add(db.wp(), req.session.username, Object.assign({}, body, { project_id: pid })); }).then(function (row) {
      ctx.status(201);
      return log(req, { action: 'create', resource: 'notes', record_id: String(row.id), project_id: row.project_id, next: { target_kind: row.target_kind, target_id: row.target_id, length: row.body.length } }).then(function () { return row; });
    });
  } },
  { method: 'DELETE', path: /^\/api\/notes\/(\d+)$/, role: 'agent', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]);
    return accessibleProjects(req).then(function (rows) {
      return notes.remove(db.wp(), id, { actor: req.session.username, canManage: auth.hasRole(req.session, 'manager'), projects: rows.map(function (r) { return r.id; }) });
    }).then(function (o) {
      return log(req, { action: 'delete', resource: 'notes', record_id: String(id), project_id: o.project_id, previous: { target_kind: o.target_kind, target_id: o.target_id } }).then(function () { return o; });
    });
  } },

  // --- Kitchen passthroughs (read-only) -----------------------------------------
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/kitchen\/describe$/, role: 'any', handler: function (req, res, ctx) {
    return kitchenFor(req, ctx.params[1]).then(function (k) {
      if (!k.client) return { configured: false, key: kitchen.keyFor(k.resolved.project), contract: kitchen.CONTRACT_VERSION };
      return k.client.describe().then(function (r) {
        if (!r.ok) return { configured: true, key: k.client.key, reachable: false, error: r.kind, contract: kitchen.CONTRACT_VERSION };
        return Object.assign({ configured: true, reachable: true }, r.data);
      });
    });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/kitchen\/products$/, role: 'any', handler: function (req, res, ctx) {
    var qq = q(req);
    return kitchenFor(req, ctx.params[1]).then(function (k) {
      if (!k.client) return { configured: false, total: 0, limit: 0, offset: 0, products: [] };
      return k.client.searchProducts({ q: qq.q, ref: qq.ref, category: qq.category, brand_car: qq.brand_car, brand: qq.brand, model_id: qq.model || qq.model_id, motorization_id: qq.motorization_id, limit: qq.limit, offset: qq.offset }).then(function (r) { return kitchenResult(r, function (x) { return Object.assign({ configured: true }, x.data); }); });
    });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/kitchen\/products\/([A-Za-z0-9._:-]+)$/, role: 'any', handler: function (req, res, ctx) {
    return kitchenFor(req, ctx.params[1]).then(function (k) {
      if (!k.client) return { configured: false, product: null };
      return k.client.getProduct(ctx.params[2]).then(function (r) { return kitchenResult(r, function (x) { return { configured: true, product: x.data }; }); });
    });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/kitchen\/vehicle-models$/, role: 'any', handler: function (req, res, ctx) {
    return kitchenFor(req, ctx.params[1]).then(function (k) {
      if (!k.client) return { configured: false, vehicle_models: [] };
      return k.client.listVehicleModels({ brand_car: q(req).brand_car }).then(function (r) { return kitchenResult(r, function (x) { return Object.assign({ configured: true }, x.data); }); });
    });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/kitchen\/part-categories$/, role: 'any', handler: function (req, res, ctx) {
    return kitchenFor(req, ctx.params[1]).then(function (k) {
      if (!k.client) return { configured: false, degraded: false, part_categories: [] };
      return k.client.listPartCategories().then(function (r) { return kitchenResult(r, function (x) { return Object.assign({ configured: true, degraded: x.degraded === true }, x.data); }); });
    });
  } }
];
