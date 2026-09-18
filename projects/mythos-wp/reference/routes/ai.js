'use strict';
// =====================================================
// MYTHOS WP V2 — AI routes (docs/V2_BUILD_CONTRACT.md, "AI" section)
// projects/mythos-wp/reference/routes/ai.js
//
//   GET    /api/ai/agents                       any      agents + project bindings + 24 h stats
//   POST   /api/ai/agents                       admin    201
//   GET    /api/ai/agents/:id                   any
//   PATCH  /api/ai/agents/:id                   admin
//   DELETE /api/ai/agents/:id                   owner    409 while conversations reference it (archive instead)
//   POST   /api/ai/agents/:id/projects          admin    201 { project_id, inbox_id?, priority? }
//   DELETE /api/ai/agents/:id/projects/:link_id admin
//   POST   /api/ai/agents/:id/test              manager  { project_id, text, contact_masked? } → dry-run outcome (no run row, no send)
//   GET    /api/ai/tools                        any      registry
//   GET    /api/ai/runs?project=&agent=&limit=  any      wp_ai_runs joined, no prompt text, scoped to accessible projects
//   GET    /api/ai/status                       any      engine_173 / llm pool / agent counts / defaults
//   POST   /api/projects/:p/comms/conversations/:id/auto-reply  manager  runs assistant.autoReply now (audited 'run')
// Every mutation is audited; no response ever carries a credential (the
// pool status reports presence only).
// =====================================================
var db = require('../db');
var auth = require('../auth');
var audit = require('../audit');
var apiUtil = require('../api-util');
var agents = require('../ai/agents');
var tools = require('../ai/tools');
var llm = require('../ai/llm');
var assistant = require('../comms/assistant');

var fail = apiUtil.fail;
var q = apiUtil.q;

function record(req, entry) {
  var base = apiUtil.auditFor(req);
  return audit.record(db.wp(), Object.assign({ actor: base.actor, role: base.role, request_id: base.request_id, client: base.client }, entry)).catch(function () {});
}
// publicAgent(a, req) — the system prompt is configuration: admin+ only; everybody else sees its length
function publicAgent(a, req) {
  if (!a) return a;
  var out = Object.assign({}, a);
  if (out.system_prompt !== undefined) { out.system_prompt_length = out.system_prompt ? out.system_prompt.length : 0; if (!req || !auth.hasRole(req.session, 'admin')) delete out.system_prompt; }
  return out;
}
function engine173Available() {
  try { require('../autoreply'); return { available: true, model: assistant.MODEL, prompt_version: assistant.PROMPT_VERSION }; } catch (e) { return { available: false, reason: e && e.code ? String(e.code) : 'UNAVAILABLE' }; }
}

module.exports = [
  { method: 'GET', path: /^\/api\/ai\/agents$/, role: 'any', handler: function (req) {
    var qq = q(req);
    return agents.list(db.wp(), { status: qq.status, engine: qq.engine, project: qq.project && qq.project !== 'all' ? qq.project : null }).then(function (items) {
      return { items: items.map(function (a) { a = publicAgent(a, req); if (req.session.projects !== null && Array.isArray(a.projects)) a.projects = a.projects.filter(function (l) { return auth.canSeeProject(req.session, l.project_id); }); return a; }) };
    });
  } },
  { method: 'POST', path: /^\/api\/ai\/agents$/, role: 'admin', handler: function (req, res, ctx) {
    return agents.create(db.wp(), ctx.body || {}, req.session.username).then(function (a) {
      ctx.status(201);
      return record(req, { action: 'create', resource: 'agents', record_id: String(a.id), next: { slug: a.slug, name: a.name, mode: a.mode, engine: a.engine, model: a.model, language: a.language, tools: a.tools, confidence_min: a.confidence_min, status: a.status } }).then(function () { return publicAgent(a, req); });
    });
  } },
  { method: 'GET', path: /^\/api\/ai\/agents\/([0-9]+)$/, role: 'any', handler: function (req, res, ctx) {
    return agents.get(db.wp(), ctx.params[1]).then(function (a) {
      if (!a) throw fail('not_found', 404, 'no such agent');
      a = publicAgent(a, req);
      if (req.session.projects !== null && Array.isArray(a.projects)) a.projects = a.projects.filter(function (l) { return auth.canSeeProject(req.session, l.project_id); });
      return a;
    });
  } },
  { method: 'PATCH', path: /^\/api\/ai\/agents\/([0-9]+)$/, role: 'admin', handler: function (req, res, ctx) {
    return agents.get(db.wp(), ctx.params[1]).then(function (before) {
      if (!before) throw fail('not_found', 404, 'no such agent');
      return agents.update(db.wp(), before.id, ctx.body || {}, req.session.username).then(function (a) {
        var d = audit.diff({ slug: before.slug, name: before.name, description: before.description, status: before.status, mode: before.mode, engine: before.engine, model: before.model, language: before.language, tools: before.tools, knowledge: before.knowledge, confidence_min: before.confidence_min, settings: before.settings, system_prompt_length: before.system_prompt ? before.system_prompt.length : 0 },
          { slug: a.slug, name: a.name, description: a.description, status: a.status, mode: a.mode, engine: a.engine, model: a.model, language: a.language, tools: a.tools, knowledge: a.knowledge, confidence_min: a.confidence_min, settings: a.settings, system_prompt_length: a.system_prompt ? a.system_prompt.length : 0 });
        return record(req, { action: 'update', resource: 'agents', record_id: String(a.id), previous: d.previous, next: d.next, changed_fields: d.fields }).then(function () { return publicAgent(a, req); });
      });
    });
  } },
  { method: 'DELETE', path: /^\/api\/ai\/agents\/([0-9]+)$/, role: 'owner', handler: function (req, res, ctx) {
    return agents.get(db.wp(), ctx.params[1]).then(function (before) {
      if (!before) throw fail('not_found', 404, 'no such agent');
      return agents.remove(db.wp(), before.id).then(function (r) {
        return record(req, { action: 'delete', resource: 'agents', record_id: String(before.id), previous: { slug: before.slug, name: before.name, mode: before.mode, engine: before.engine, status: before.status } }).then(function () { return r; });
      });
    });
  } },
  { method: 'POST', path: /^\/api\/ai\/agents\/([0-9]+)\/projects$/, role: 'admin', handler: function (req, res, ctx) {
    var body = ctx.body || {};
    return apiUtil.projectFrom(req, { project: body.project_id }).then(function (resolved) {
      if (!resolved) throw fail('validation', 400, 'project_id required', { project_id: 'required' });
      return agents.link(db.wp(), ctx.params[1], { project_id: resolved.project.id, inbox_id: body.inbox_id, priority: body.priority }, req.session.username).then(function (row) {
        ctx.status(201);
        return record(req, { action: 'link', resource: 'agents', record_id: String(row.agent_id), project_id: row.project_id, next: { link_id: row.id, project_id: row.project_id, inbox_id: row.inbox_id, priority: row.priority } }).then(function () { return row; });
      });
    });
  } },
  { method: 'DELETE', path: /^\/api\/ai\/agents\/([0-9]+)\/projects\/([0-9]+)$/, role: 'admin', handler: function (req, res, ctx) {
    return agents.unlink(db.wp(), ctx.params[1], ctx.params[2]).then(function (r) {
      return record(req, { action: 'unlink', resource: 'agents', record_id: String(ctx.params[1]), project_id: r.project_id, previous: { link_id: r.id, project_id: r.project_id, inbox_id: r.inbox_id } }).then(function () { return r; });
    });
  } },
  { method: 'POST', path: /^\/api\/ai\/agents\/([0-9]+)\/test$/, role: 'manager', handler: function (req, res, ctx) {
    var body = ctx.body || {};
    var text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) throw fail('validation', 400, 'text is required', { text: 'required' });
    return agents.get(db.wp(), ctx.params[1]).then(function (agent) {
      if (!agent) throw fail('not_found', 404, 'no such agent');
      return apiUtil.projectFrom(req, { project: body.project_id }).then(function (resolved) {
        if (!resolved) throw fail('validation', 400, 'project_id required', { project_id: 'required' });
        return assistant.test(db.wp(), resolved, agent, text).then(function (out) {
          out.contact_masked = body.contact_masked ? String(body.contact_masked).slice(0, 32) : null;
          return record(req, { action: 'test', resource: 'agents', record_id: String(agent.id), project_id: resolved.project.id, next: { decision: out.decision, intent: out.intent, confidence: out.confidence, engine: out.engine, model: out.model, tools_used: out.tools_used, fallback_reason: out.fallback_reason, text_length: text.length } }).then(function () { return out; });
        });
      });
    });
  } },
  { method: 'GET', path: /^\/api\/ai\/tools$/, role: 'any', handler: function () {
    return { items: tools.list(), kitchen_module: !!tools.kitchenModule() };
  } },
  { method: 'GET', path: /^\/api\/ai\/runs$/, role: 'any', handler: function (req) {
    var qq = q(req);
    return apiUtil.projectFrom(req).then(function (resolved) {
      if (resolved) return assistant.listRuns(db.wp(), { project: resolved.project.id, agent: qq.agent, limit: qq.limit });
      return apiUtil.accessibleProjects(req).then(function (rows) { return assistant.listRuns(db.wp(), { projects: rows.map(function (p) { return p.id; }), agent: qq.agent, limit: qq.limit }); });
    }).then(function (items) { return { items: items }; });
  } },
  { method: 'GET', path: /^\/api\/ai\/status$/, role: 'any', handler: function () {
    return agents.counts(db.wp()).then(function (c) {
      var pool = llm.status();
      return {
        engine_173: engine173Available(),
        llm: { configured: pool.configured, providers: pool.providers, reason: pool.reason || null, key_dir_env: pool.key_dir_env || null },
        agents: { active: c.active, auto: c.auto, suggest: c.suggest, off: c.off, paused: c.paused, archived: c.archived, total: c.total },
        defaults: { engine: agents.DEFAULTS.engine, mode: agents.DEFAULTS.mode, language: agents.DEFAULTS.language, confidence_min: agents.DEFAULTS.confidence_min, max_replies_per_hour: agents.DEFAULTS.max_replies_per_hour, tools: agents.DEFAULTS.tools, default_agent_slug: agents.DEFAULT_AGENT.slug },
        tools: tools.ids(),
        generated_at: new Date().toISOString()
      };
    });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/auto-reply$/, role: 'manager', handler: function (req, res, ctx) {
    return apiUtil.projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      var cid = parseInt(ctx.params[2], 10);
      return assistant.autoReply(db.wp(), resolved, cid, { message_id: ctx.body && ctx.body.message_id, trigger: 'manual' }).then(function (out) {
        return record(req, { action: 'run', resource: 'ai_runs', record_id: out.run_id ? String(out.run_id) : null, project_id: resolved.project.id, next: { conversation_id: cid, ran: out.ran, sent: out.sent, reason: out.reason || null, decision: out.decision || null, confidence: out.confidence, agent_id: out.agent_id || null, message_id: out.message_id || null } }).then(function () { return out; });
      });
    });
  } }
];
