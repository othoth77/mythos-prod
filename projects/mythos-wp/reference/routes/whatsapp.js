'use strict';
// =====================================================
// MYTHOS WP V2 — WhatsApp routes (builder A; see docs/V2_BUILD_CONTRACT.md)
// projects/mythos-wp/reference/routes/whatsapp.js
//
// Accounts, phone numbers (+ Evolution discovery / health), project links,
// inbox switches, routing rules (delete + simulate), AI ↔ human handoff,
// templates, the Meta MCP descriptor and the cross-project contacts 360.
// Every mutation is audited (audit.record) with the action vocabulary of
// audit.js; phone_ref / full phone are returned to admin+ only.
// =====================================================
var db = require('../db');
var auth = require('../auth');
var audit = require('../audit');
var apiUtil = require('../api-util');
var routing = require('../comms/routing');
var numbers = require('../comms/numbers');
var handoff = require('../comms/handoff');
var inbox = require('../comms/inbox');
var templates = require('../comms/templates');
var metaMcp = require('../comms/meta-mcp');
var contacts360 = require('../comms/contacts360');
var q = apiUtil.q;
var projectFrom = apiUtil.projectFrom;
function fail(code, status, detail) { var e = new Error(detail || code); e.code = code; e.status = status; return e; }
function isAdmin(req) { return auth.hasRole(req.session, 'admin'); }
function rec(req, e) {
  var base = apiUtil.auditFor(req);
  return audit.record(db.wp(), { actor: base.actor, role: base.role, action: e.action, resource: e.resource, record_id: e.record_id === undefined || e.record_id === null ? null : String(e.record_id), project_id: e.project_id || null, previous: e.previous, next: e.next, request_id: base.request_id, client: base.client }).catch(function () { return false; });
}
function idOf(s) { var n = parseInt(s, 10); if (!n) throw fail('validation', 400, 'id required'); return n; }
function scopeOf(req) { return req.session && Array.isArray(req.session.projects) ? req.session.projects : null; }
function requireProjectAccess(req, projectId) { if (projectId && !auth.canSeeProject(req.session, projectId)) throw fail('not_found', 404, 'unknown project'); }
function simulateEvent(body) {
  body = body || {};
  var from = String(body.from || '').replace(/[^0-9]/g, '');
  if (!/^[0-9]{6,20}$/.test(from)) throw fail('validation', 400, 'from: sender digits required');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(body.instance || ''))) throw fail('validation', 400, 'instance shape');
  var provider = body.provider || 'evolution';
  if (!/^[a-z][a-z0-9_]{1,23}$/.test(provider)) throw fail('validation', 400, 'provider shape');
  return { provider: provider, instance: String(body.instance), text: typeof body.text === 'string' ? body.text.slice(0, 4096) : '', contact: { wa_id: from, identities: [{ kind: 'phone', value: from }] } };
}

module.exports = [
  // --- business accounts -----------------------------------------------------
  { method: 'GET', path: /^\/api\/whatsapp\/accounts$/, role: 'manager', handler: function () { return numbers.listAccounts(db.wp()).then(function (rows) { return { items: rows }; }); } },
  { method: 'POST', path: /^\/api\/whatsapp\/accounts$/, role: 'admin', handler: function (req, res, ctx) {
    return numbers.createAccount(db.wp(), ctx.body || {}).then(function (row) { ctx.status(201); return rec(req, { action: 'create', resource: 'wa_accounts', record_id: row.id, next: { provider: row.provider, display_name: row.display_name, external_ref: row.external_ref } }).then(function () { return row; }); });
  } },
  { method: 'PATCH', path: /^\/api\/whatsapp\/accounts\/(\d+)$/, role: 'admin', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]);
    return numbers.updateAccount(db.wp(), id, ctx.body || {}).then(function (row) { return rec(req, { action: 'update', resource: 'wa_accounts', record_id: id, next: ctx.body }).then(function () { return row; }); });
  } },
  { method: 'DELETE', path: /^\/api\/whatsapp\/accounts\/(\d+)$/, role: 'owner', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]);
    return numbers.deleteAccount(db.wp(), id).then(function (out) { return rec(req, { action: 'delete', resource: 'wa_accounts', record_id: id }).then(function () { return out; }); });
  } },

  // --- phone numbers ----------------------------------------------------------------
  { method: 'GET', path: /^\/api\/whatsapp\/numbers$/, role: 'any', handler: function (req) {
    return numbers.listNumbers(db.wp(), { admin: isAdmin(req) }).then(function (rows) {
      // project-scoped sessions see only links to their projects, and only numbers that have such a link
      if (req.session.projects !== null) rows = rows.map(function (n) { n.projects = (n.projects || []).filter(function (l) { return auth.canSeeProject(req.session, l.project_id); }); return n; }).filter(function (n) { return n.projects.length > 0; });
      else rows.forEach(function (n) { n.projects = (n.projects || []).filter(function (l) { return auth.canSeeProject(req.session, l.project_id); }); }); // hides only the admin-only holding link
      return { items: rows };
    });
  } },
  { method: 'POST', path: /^\/api\/whatsapp\/numbers$/, role: 'admin', handler: function (req, res, ctx) {
    return numbers.createNumber(db.wp(), ctx.body || {}).then(function (id) {
      return numbers.getNumber(db.wp(), id, { admin: true }).then(function (row) { ctx.status(201); return rec(req, { action: 'create', resource: 'phone_numbers', record_id: id, next: { provider: row.provider, instance: row.instance, phone_masked: row.phone_masked, display_name: row.display_name, is_personal: row.is_personal, account_id: row.account ? row.account.id : null } }).then(function () { return row; }); });
    });
  } },
  { method: 'POST', path: /^\/api\/whatsapp\/numbers\/sync$/, role: 'admin', handler: function (req) {
    return numbers.sync(db.wp(), { admin: true }).then(function (out) { return rec(req, { action: 'sync', resource: 'phone_numbers', next: { discovered: out.discovered, created: out.created, updated: out.updated } }).then(function () { return out; }); });
  } },
  { method: 'PATCH', path: /^\/api\/whatsapp\/numbers\/(\d+)$/, role: 'admin', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]);
    var body = Object.assign({}, ctx.body || {});
    return numbers.updateNumber(db.wp(), id, body).then(function () {
      return numbers.getNumber(db.wp(), id, { admin: true }).then(function (row) { if (body.phone_ref !== undefined) body.phone_ref = numbers.mask(body.phone_ref); return rec(req, { action: 'update', resource: 'phone_numbers', record_id: id, next: body }).then(function () { return row; }); });
    });
  } },
  { method: 'DELETE', path: /^\/api\/whatsapp\/numbers\/(\d+)$/, role: 'owner', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]);
    return numbers.deleteNumber(db.wp(), id).then(function (out) { return rec(req, { action: 'delete', resource: 'phone_numbers', record_id: id }).then(function () { return out; }); });
  } },
  // Pairing QR for a number that is not connected (admin). The QR is a secret with a 20–45 s life: it is
  // only returned, never logged or stored. One audit row per pairing session; the UI's periodic refreshes
  // pass ?refresh=1 so they do not flood the log.
  { method: 'POST', path: /^\/api\/whatsapp\/numbers\/(\d+)\/connect$/, role: 'admin', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]);
    var refresh = /(^|&)refresh=1(&|$)/.test(String(req.url.split('?')[1] || ''));
    return numbers.connect(db.wp(), id).then(function (out) {
      if (refresh && out.state !== 'open') return out;
      return rec(req, { action: 'check', resource: 'phone_numbers', record_id: id, next: { pairing: out.state === 'open' ? 'connected' : 'qr_issued' } }).then(function () { return out; });
    });
  } },
  { method: 'POST', path: /^\/api\/whatsapp\/numbers\/(\d+)\/check$/, role: 'manager', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]);
    return numbers.check(db.wp(), id).then(function (out) { return rec(req, { action: 'check', resource: 'phone_numbers', record_id: id, next: { status: out.status, health_state: out.health_state } }).then(function () { return out; }); });
  } },
  { method: 'POST', path: /^\/api\/whatsapp\/numbers\/(\d+)\/projects$/, role: 'admin', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]); var body = ctx.body || {};
    if (!body.project_id) throw fail('validation', 400, 'project_id required');
    return projectFrom(req, { project: body.project_id }).then(function (resolved) {
      if (!resolved) throw fail('not_found', 404, 'unknown project');
      return numbers.link(db.wp(), id, Object.assign({}, body, { project_id: resolved.project.id }), req.session.username).then(function (inbox) {
        ctx.status(201);
        return rec(req, { action: 'link', resource: 'phone_numbers', record_id: id, project_id: resolved.project.id, next: { inbox_id: inbox.id, account_mode: inbox.account_mode, allow_personal_account: body.allow_personal_account === true } }).then(function () { return { inbox: inbox }; });
      });
    });
  } },
  { method: 'DELETE', path: /^\/api\/whatsapp\/numbers\/(\d+)\/projects\/(\d+)$/, role: 'admin', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]), inboxId = idOf(ctx.params[2]);
    return numbers.unlink(db.wp(), id, inboxId).then(function (out) { return rec(req, { action: 'unlink', resource: 'phone_numbers', record_id: id, project_id: out.project_id, next: { inbox_id: inboxId } }).then(function () { return out; }); });
  } },
  { method: 'PATCH', path: /^\/api\/projects\/([a-z0-9-]+)\/inboxes\/(\d+)$/, role: 'admin', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      var inboxId = idOf(ctx.params[2]);
      return numbers.updateInbox(db.wp(), resolved.project.id, inboxId, ctx.body || {}).then(function (out) { return rec(req, { action: 'update', resource: 'inboxes', record_id: inboxId, project_id: resolved.project.id, next: out.changed }).then(function () { return out.inbox; }); });
    });
  } },

  // --- routing ------------------------------------------------------------------------
  { method: 'DELETE', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/routes\/(\d+)$/, role: 'admin', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      return routing.removeRule(db.wp(), resolved.project.id, ctx.params[2], req.session.username).then(function (out) { return rec(req, { action: 'delete', resource: 'inbox_routes', record_id: out.id, project_id: resolved.project.id }).then(function () { return out; }); });
    });
  } },
  { method: 'POST', path: /^\/api\/whatsapp\/routing\/simulate$/, role: 'manager', handler: function (req, res, ctx) {
    var ev = simulateEvent(ctx.body);
    return routing.simulate(db.wp(), ev.provider, ev.instance, ev).then(function (d) {
      if (d.project_id && !auth.canSeeProject(req.session, d.project_id)) d = { routed: true, mode: d.mode, reason: null, project_id: null, inbox_id: null, rule_id: null, personal: d.personal, hidden: true };
      return rec(req, { action: 'simulate', resource: 'routing', project_id: d.project_id || null, next: { instance: ev.instance, routed: d.routed, mode: d.mode, reason: d.reason, inbox_id: d.inbox_id, rule_id: d.rule_id } }).then(function () { return d; });
    });
  } },
  { method: 'GET', path: /^\/api\/whatsapp\/routing-drops$/, role: 'admin', handler: function (req) { return routing.listDrops(db.wp(), { limit: q(req).limit }).then(function (rows) { return { items: rows }; }); } },

  // --- handoff -------------------------------------------------------------------------
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/(\d+)\/handoff$/, role: 'agent', handler: function (req, res, ctx) {
    var body = ctx.body || {};
    if (body.direction !== 'ai_to_human' && body.direction !== 'human_to_ai') throw fail('validation', 400, 'direction ai_to_human|human_to_ai');
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      var cid = idOf(ctx.params[2]);
      // inbox membership fences handoffs like every other conversation write
      var p = inbox.scope(db.wp(), req.session.username).then(function (scope) { return inbox.inScope(db.wp(), resolved.project.id, cid, scope); }).then(function () { return body.direction === 'ai_to_human' ? handoff.toHuman(db.wp(), resolved.project.id, cid, req.session.username, { reason: body.reason, assign_to: body.assign_to }) : handoff.toAI(db.wp(), resolved.project.id, cid, req.session.username, { reason: body.reason }); });
      return p.then(function (out) { return rec(req, { action: 'handoff', resource: 'conversations', record_id: cid, project_id: resolved.project.id, next: { direction: body.direction, handoff_id: out.handoff_id, handler: out.handler, status: out.status, reason: body.reason || null, assign_to: body.assign_to || null } }).then(function () { return out; }); });
    });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/(\d+)\/handoffs$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { var cid = idOf(ctx.params[2]); return inbox.scope(db.wp(), req.session.username).then(function (scope) { return inbox.inScope(db.wp(), resolved.project.id, cid, scope); }).then(function () { return handoff.history(db.wp(), resolved.project.id, cid); }).then(function (rows) { return { items: rows }; }); });
  } },

  // --- templates ------------------------------------------------------------------------
  { method: 'GET', path: /^\/api\/templates$/, role: 'any', handler: function (req) {
    var qq = q(req);
    if (qq.project && qq.project !== 'all') return projectFrom(req, { project: qq.project }).then(function (resolved) { return templates.list(db.wp(), { project: resolved.project.id, status: qq.status }).then(function (rows) { return { items: rows }; }); });
    return templates.list(db.wp(), { accessible: scopeOf(req), status: qq.status }).then(function (rows) { return { items: rows }; });
  } },
  { method: 'POST', path: /^\/api\/templates$/, role: 'manager', handler: function (req, res, ctx) {
    var body = ctx.body || {};
    var pid = body.project_id && body.project_id !== 'all' ? String(body.project_id) : null;
    requireProjectAccess(req, pid);
    if (!pid && !isAdmin(req)) throw fail('forbidden', 403, 'a shared template (no project) needs the admin role');
    return templates.create(db.wp(), req.session.username, body).then(function (row) { ctx.status(201); return rec(req, { action: 'create', resource: 'templates', record_id: row.id, project_id: row.project_id, next: { name: row.name, language: row.language, category: row.category, status: row.status } }).then(function () { return row; }); });
  } },
  { method: 'PATCH', path: /^\/api\/templates\/(\d+)$/, role: 'manager', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]); var body = ctx.body || {};
    return templates.get(db.wp(), id).then(function (t) {
      requireProjectAccess(req, t.project_id);
      var newPid = body.project_id !== undefined ? (body.project_id && body.project_id !== 'all' ? String(body.project_id) : null) : t.project_id;
      if (body.project_id !== undefined) requireProjectAccess(req, newPid);
      if ((!t.project_id || !newPid) && !isAdmin(req)) throw fail('forbidden', 403, 'a shared template (no project) needs the admin role');
      return templates.update(db.wp(), id, req.session.username, body).then(function (row) { return rec(req, { action: 'update', resource: 'templates', record_id: id, project_id: row.project_id, next: body }).then(function () { return row; }); });
    });
  } },
  { method: 'DELETE', path: /^\/api\/templates\/(\d+)$/, role: 'admin', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]);
    return templates.get(db.wp(), id).then(function (t) { requireProjectAccess(req, t.project_id); return templates.remove(db.wp(), id).then(function (out) { return rec(req, { action: 'delete', resource: 'templates', record_id: id, project_id: t.project_id, next: { name: t.name, language: t.language } }).then(function () { return out; }); }); });
  } },
  { method: 'POST', path: /^\/api\/templates\/(\d+)\/preview$/, role: 'any', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]);
    return templates.get(db.wp(), id).then(function (t) { requireProjectAccess(req, t.project_id); return templates.render(t, (ctx.body || {}).variables); });
  } },
  { method: 'POST', path: /^\/api\/templates\/sync-all$/, role: 'admin', handler: function (req) {
    return templates.syncAll(db.wp(), req.session.username).then(function (out) { return rec(req, { action: 'sync', resource: 'templates', next: out }).then(function () { return out; }); });
  } },
  { method: 'POST', path: /^\/api\/templates\/(\d+)\/sync$/, role: 'admin', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]);
    return templates.get(db.wp(), id).then(function (t) {
      requireProjectAccess(req, t.project_id);
      return templates.sync(db.wp(), id, req.session.username).then(function (out) { return rec(req, { action: 'sync', resource: 'templates', record_id: id, project_id: t.project_id, next: { action: out.action, status: out.template.status, provider_template_id: out.template.provider_template_id } }).then(function () { return out; }); });
    });
  } },
  { method: 'POST', path: /^\/api\/templates\/(\d+)\/test$/, role: 'manager', handler: function (req, res, ctx) {
    var id = idOf(ctx.params[1]); var body = ctx.body || {};
    return templates.get(db.wp(), id).then(function (t) {
      var pid = body.project_id || t.project_id;
      if (!pid) throw fail('validation', 400, 'project_id required for a shared template');
      return projectFrom(req, { project: pid }).then(function (resolved) {
        return inbox.scope(db.wp(), req.session.username).then(function (scope) { return templates.testSend(db.wp(), resolved.project.id, id, req.session.username, body, scope); }).then(function (r) {
          ctx.status(r.duplicate ? 200 : 201);
          return rec(req, { action: 'test', resource: 'templates', record_id: id, project_id: resolved.project.id, next: { conversation_id: body.conversation_id, message_id: r.message_id, status: r.status, length: r.length } }).then(function () { return r; });
        });
      });
    });
  } },

  // --- Meta WhatsApp Business Tools MCP (descriptor + probe; no tool invocation) ---------------
  { method: 'GET', path: /^\/api\/whatsapp\/mcp$/, role: 'any', handler: function () {
    return metaMcp.integrationRow(db.wp()).then(function (row) {
      var probe = row && row.last_checked_at ? { reachable: row.health_state === 'ok', checked_at: row.last_checked_at, http_status: null } : null;
      return { mcp: metaMcp.describe(probe), integration: row };
    });
  } },
  { method: 'POST', path: /^\/api\/whatsapp\/mcp\/probe$/, role: 'admin', handler: function (req) {
    return metaMcp.probe().then(function (r) { return metaMcp.record(db.wp(), r).then(function (recorded) { r.recorded = recorded; return rec(req, { action: 'check', resource: 'integrations', record_id: metaMcp.INTEGRATION_KEY, next: { reachable: r.reachable, http_status: r.http_status } }).then(function () { return r; }); }); });
  } },

  // --- Contacts 360 (cross-project, scoped to accessible projects) --------------------------------
  { method: 'GET', path: /^\/api\/contacts$/, role: 'any', handler: function (req) {
    var qq = q(req);
    if (qq.project && qq.project !== 'all') return projectFrom(req, { project: qq.project }).then(function (resolved) { return contacts360.list(db.wp(), { q: qq.q, projects: [resolved.project.id], limit: qq.limit, admin: isAdmin(req) }); });
    return contacts360.list(db.wp(), { q: qq.q, projects: scopeOf(req), limit: qq.limit, admin: isAdmin(req) });
  } },
  { method: 'GET', path: /^\/api\/contacts\/360\/([0-9]{6,32})$/, role: 'any', handler: function (req, res, ctx) {
    return contacts360.get360(db.wp(), ctx.params[1], { projects: scopeOf(req), admin: isAdmin(req) });
  } },
  // opaque key form '<project>:<contact_id>' — lets non-admin users (who never see digits) open a 360 page
  { method: 'GET', path: /^\/api\/contacts\/360\/([a-z0-9-]+:[0-9]+)$/, role: 'any', handler: function (req, res, ctx) {
    var o = { projects: scopeOf(req), admin: isAdmin(req) };
    return contacts360.resolveKey(db.wp(), ctx.params[1], o).then(function (phone) { return contacts360.get360(db.wp(), phone, o); });
  } }
];
