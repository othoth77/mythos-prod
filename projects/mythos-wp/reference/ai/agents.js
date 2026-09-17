'use strict';
// =====================================================
// MYTHOS WP V2 — AI agents (wp_agents / wp_project_agents)
// projects/mythos-wp/reference/ai/agents.js
//
// CRUD helpers with server-side validation (the schema CHECKs are the last
// line, this module gives named 400s), the project/inbox binding table,
// and the two decisions the assistant asks for:
//
//   resolveForConversation(pool, convId) → the agent that serves a
//     conversation, by priority: the conversation's own agent_id → a
//     binding for (project, inbox) → a binding for (project, every inbox)
//     → null. Only ACTIVE agents and ENABLED bindings resolve; a paused or
//     archived agent is skipped as if it were not bound.
//   effectiveMode(agent, inbox) → 'off' | 'suggest' | 'auto'. The inbox
//     switch (wp_inboxes.ai_mode) inherits the agent's mode by default,
//     `off` wins on either side, and an inbox may RESTRICT (auto → suggest)
//     but never escalate an agent beyond its own mode.
//
// ensureDefaults(pool) creates one 'mythos-assistant' (engine-173, suggest)
// when no agent exists at all; it binds nothing — binding is an admin act.
// No field here is a secret; system_prompt is persona text, never a key.
// =====================================================
var tools = require('./tools');

var SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
var MODES = ['off', 'suggest', 'auto'];
var ENGINES = ['engine-173', 'llm'];
var LANGUAGES = ['fr', 'ar', 'en'];
var STATUSES = ['active', 'paused', 'archived'];
var MAX_PROMPT = 8000;
var MODE_RANK = { off: 0, suggest: 1, auto: 2 };
var DEFAULTS = { engine: 'engine-173', mode: 'suggest', language: 'fr', confidence_min: 0.8, max_replies_per_hour: 5, knowledge: true, tools: ['knowledge.lookup', 'handoff.request', 'conversation.history'] };
var DEFAULT_AGENT = { slug: 'mythos-assistant', name: 'MYTHOS Assistant', description: 'Default deterministic assistant (engine-173): greets, asks for vehicle + part, never states an unverified fact.', engine: 'engine-173', mode: 'suggest', language: 'fr', tools: DEFAULTS.tools };
var SELECT = 'id, slug, name, description, status, mode, engine, model, system_prompt, language, tools, knowledge, confidence_min, settings, created_by, created_at, updated_at';

function fail(code, status, detail, errors) { var e = new Error(detail || code); e.code = code; e.status = status; if (errors) e.errors = errors; return e; }

function shape(row) {
  if (!row) return null;
  var out = Object.assign({}, row);
  out.id = Number(row.id);
  out.confidence_min = row.confidence_min === null || row.confidence_min === undefined ? null : Number(row.confidence_min);
  out.tools = Array.isArray(row.tools) ? row.tools.slice() : [];
  out.settings = row.settings && typeof row.settings === 'object' ? row.settings : {};
  return out;
}

// validate(body, partial) → { fields, errors } — fields only carries keys present in body (partial) or every column (create)
function validate(body, partial) {
  body = body || {};
  var errors = {}; var f = {};
  var has = function (k) { return Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined; };
  var known = tools.ids();
  if (!partial || has('slug')) {
    var slug = String(body.slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) errors.slug = 'lowercase letters, digits and dashes (2–63 chars)'; else f.slug = slug;
  }
  if (!partial || has('name')) {
    var name = String(body.name || '').trim();
    if (!name || name.length > 120) errors.name = 'required (1–120 chars)'; else f.name = name;
  }
  if (has('description')) { var d = body.description === null ? null : String(body.description); if (d !== null && d.length > 4000) errors.description = 'max 4000 chars'; else f.description = d; }
  if (has('status')) { if (STATUSES.indexOf(body.status) === -1) errors.status = 'active|paused|archived'; else f.status = body.status; }
  if (!partial || has('mode')) { var mode = has('mode') ? body.mode : DEFAULTS.mode; if (MODES.indexOf(mode) === -1) errors.mode = 'off|suggest|auto'; else f.mode = mode; }
  if (!partial || has('engine')) { var engine = has('engine') ? body.engine : DEFAULTS.engine; if (ENGINES.indexOf(engine) === -1) errors.engine = 'engine-173|llm'; else f.engine = engine; }
  if (has('model')) { var model = body.model === null || body.model === '' ? null : String(body.model).trim(); if (model !== null && !/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,63}$/.test(model)) errors.model = 'model id (max 64 chars)'; else f.model = model; }
  if (has('system_prompt')) { var sp = body.system_prompt === null ? null : String(body.system_prompt); if (sp !== null && sp.length > MAX_PROMPT) errors.system_prompt = 'max ' + MAX_PROMPT + ' chars'; else f.system_prompt = sp; }
  if (!partial || has('language')) { var lang = has('language') ? body.language : DEFAULTS.language; if (LANGUAGES.indexOf(lang) === -1) errors.language = 'fr|ar|en'; else f.language = lang; }
  if (!partial || has('tools')) {
    var list = has('tools') ? body.tools : DEFAULTS.tools;
    if (!Array.isArray(list) || list.some(function (t) { return typeof t !== 'string'; })) errors.tools = 'array of tool ids';
    else {
      var bad = list.filter(function (t) { return known.indexOf(t) === -1; });
      if (bad.length) errors.tools = 'unknown tool(s): ' + bad.slice(0, 5).join(', ');
      else f.tools = list.filter(function (t, i) { return list.indexOf(t) === i; });
    }
  }
  if (has('knowledge')) { if (typeof body.knowledge !== 'boolean') errors.knowledge = 'boolean'; else f.knowledge = body.knowledge; }
  if (!partial || has('confidence_min')) {
    var c = has('confidence_min') ? Number(body.confidence_min) : DEFAULTS.confidence_min;
    if (typeof c !== 'number' || isNaN(c) || c < 0 || c > 1) errors.confidence_min = 'number between 0 and 1'; else f.confidence_min = Math.round(c * 1000) / 1000;
  }
  if (has('settings')) {
    var s = body.settings;
    if (!s || typeof s !== 'object' || Array.isArray(s)) errors.settings = 'object';
    else if (require('../audit').hasSecretKey(s)) errors.settings = 'settings must not carry a credential';
    else if (s.max_replies_per_hour !== undefined && (typeof s.max_replies_per_hour !== 'number' || s.max_replies_per_hour < 1 || s.max_replies_per_hour > 60)) errors.settings = 'max_replies_per_hour 1–60';
    else if (JSON.stringify(s).length > 16384) errors.settings = 'max 16 KiB';
    else f.settings = s;
  }
  return { fields: f, errors: errors };
}

function projectsOf(pool, agentIds) {
  if (!agentIds.length) return Promise.resolve({});
  return pool.query('SELECT pa.id, pa.agent_id, pa.project_id, pa.inbox_id, pa.priority, pa.enabled, pa.added_by, pa.created_at, p.display_name, i.display_name AS inbox_name FROM wp_project_agents pa JOIN wp_projects p ON p.id = pa.project_id LEFT JOIN wp_inboxes i ON i.id = pa.inbox_id WHERE pa.agent_id = ANY($1::bigint[]) ORDER BY pa.project_id, pa.priority, pa.id', [agentIds]).then(function (r) {
    var by = {};
    r.rows.forEach(function (x) { var k = String(x.agent_id); (by[k] = by[k] || []).push({ id: Number(x.id), project_id: x.project_id, display_name: x.display_name, inbox_id: x.inbox_id === null ? null : Number(x.inbox_id), inbox_name: x.inbox_name, priority: x.priority, enabled: x.enabled, added_by: x.added_by, created_at: x.created_at }); });
    return by;
  });
}
function statsOf(pool, agentIds) {
  if (!agentIds.length) return Promise.resolve({});
  return pool.query("SELECT agent_id, count(*)::int AS runs_24h, count(*) FILTER (WHERE decision = 'handoff')::int AS handoffs_24h, count(*) FILTER (WHERE decision = 'auto_reply')::int AS auto_replies_24h, count(*) FILTER (WHERE status = 'error')::int AS errors_24h FROM wp_ai_runs WHERE agent_id = ANY($1::bigint[]) AND created_at > now() - interval '24 hours' GROUP BY agent_id", [agentIds]).then(function (r) {
    var by = {};
    r.rows.forEach(function (x) { by[String(x.agent_id)] = { runs_24h: x.runs_24h, handoffs_24h: x.handoffs_24h, auto_replies_24h: x.auto_replies_24h, errors_24h: x.errors_24h }; });
    return by;
  });
}
function decorate(pool, rows) {
  var ids = rows.map(function (r) { return Number(r.id); });
  return Promise.all([projectsOf(pool, ids), statsOf(pool, ids)]).then(function (x) {
    return rows.map(function (r) { var a = shape(r); a.projects = x[0][String(a.id)] || []; a.stats = x[1][String(a.id)] || { runs_24h: 0, handoffs_24h: 0, auto_replies_24h: 0, errors_24h: 0 }; return a; });
  });
}

// list(pool, { status, project, engine }) → [agent + projects + stats]
function list(pool, opts) {
  opts = opts || {};
  var where = []; var params = [];
  if (opts.status && STATUSES.indexOf(opts.status) !== -1) { params.push(opts.status); where.push('a.status = $' + params.length); }
  if (opts.engine && ENGINES.indexOf(opts.engine) !== -1) { params.push(opts.engine); where.push('a.engine = $' + params.length); }
  if (opts.project) { params.push(String(opts.project)); where.push('EXISTS (SELECT 1 FROM wp_project_agents pa WHERE pa.agent_id = a.id AND pa.project_id = $' + params.length + ')'); }
  return pool.query('SELECT ' + SELECT.split(', ').map(function (c) { return 'a.' + c; }).join(', ') + ' FROM wp_agents a' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY a.status = \'archived\', a.name, a.id', params).then(function (r) { return decorate(pool, r.rows); });
}
function get(pool, id) {
  id = parseInt(id, 10);
  if (!id || id < 1) return Promise.resolve(null);
  return pool.query('SELECT ' + SELECT + ' FROM wp_agents WHERE id = $1', [id]).then(function (r) { return r.rows[0] ? decorate(pool, r.rows).then(function (x) { return x[0]; }) : null; });
}
function getOr404(pool, id) { return get(pool, id).then(function (a) { if (!a) throw fail('not_found', 404, 'no such agent'); return a; }); }

function create(pool, body, actor) {
  var v = validate(body, false);
  if (Object.keys(v.errors).length) throw fail('validation', 400, 'invalid agent', v.errors);
  var f = v.fields;
  return pool.query('INSERT INTO wp_agents (slug, name, description, status, mode, engine, model, system_prompt, language, tools, knowledge, confidence_min, settings, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ' + SELECT,
    [f.slug, f.name, f.description || null, f.status || 'active', f.mode, f.engine, f.model || null, f.system_prompt || null, f.language, f.tools, f.knowledge === undefined ? DEFAULTS.knowledge : f.knowledge, f.confidence_min, JSON.stringify(f.settings || {}), actor || null])
    .then(function (r) { return decorate(pool, r.rows).then(function (x) { return x[0]; }); }, function (e) {
      if (e && e.code === '23505') throw fail('conflict', 409, 'an agent with this slug already exists', { slug: 'taken' });
      throw e;
    });
}
function update(pool, id, body, actor) {
  var v = validate(body, true);
  if (Object.keys(v.errors).length) throw fail('validation', 400, 'invalid agent', v.errors);
  var f = v.fields; var keys = Object.keys(f);
  return getOr404(pool, id).then(function (before) {
    if (!keys.length) return before;
    var sets = []; var params = [before.id];
    keys.forEach(function (k) { params.push(k === 'settings' ? JSON.stringify(f[k]) : f[k]); sets.push(k + ' = $' + params.length); });
    return pool.query('UPDATE wp_agents SET ' + sets.join(', ') + ', updated_at = now() WHERE id = $1 RETURNING ' + SELECT, params)
      .then(function (r) { return decorate(pool, r.rows).then(function (x) { return x[0]; }); }, function (e) {
        if (e && e.code === '23505') throw fail('conflict', 409, 'an agent with this slug already exists', { slug: 'taken' });
        throw e;
      });
  });
}
// remove(pool, id) → { deleted:true } | 409 when conversations still reference the agent (archive instead)
function remove(pool, id) {
  return getOr404(pool, id).then(function (a) {
    return pool.query('SELECT count(*)::int AS n FROM wp_conversations WHERE agent_id = $1', [a.id]).then(function (r) {
      if (r.rows[0].n > 0) throw fail('conflict', 409, r.rows[0].n + ' conversation(s) reference this agent; archive it instead');
      return pool.query('DELETE FROM wp_agents WHERE id = $1', [a.id]).then(function () { return { deleted: true, id: a.id }; });
    });
  });
}

// link(pool, agentId, { project_id, inbox_id?, priority? }, actor) → binding row (201)
function link(pool, agentId, body, actor) {
  body = body || {};
  var pid = String(body.project_id || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(pid)) throw fail('validation', 400, 'project_id required', { project_id: 'required' });
  var inboxId = body.inbox_id === undefined || body.inbox_id === null || body.inbox_id === '' ? null : parseInt(body.inbox_id, 10);
  if (inboxId !== null && (!inboxId || inboxId < 1)) throw fail('validation', 400, 'inbox_id must be a positive integer', { inbox_id: 'integer' });
  var priority = body.priority === undefined ? 100 : parseInt(body.priority, 10);
  if (isNaN(priority) || priority < 0 || priority > 10000) throw fail('validation', 400, 'priority 0–10000', { priority: 'range' });
  return getOr404(pool, agentId).then(function (a) {
    return pool.query('SELECT id FROM wp_projects WHERE id = $1', [pid]).then(function (p) {
      if (!p.rows[0]) throw fail('not_found', 404, 'unknown project');
      if (inboxId === null) return null;
      return pool.query('SELECT id FROM wp_inboxes WHERE id = $1 AND project_id = $2', [inboxId, pid]).then(function (i) { if (!i.rows[0]) throw fail('validation', 400, 'inbox does not belong to this project', { inbox_id: 'not_in_project' }); });
    }).then(function () {
      return pool.query('INSERT INTO wp_project_agents (agent_id, project_id, inbox_id, priority, enabled, added_by) VALUES ($1,$2,$3,$4,true,$5) RETURNING id, agent_id, project_id, inbox_id, priority, enabled, added_by, created_at', [a.id, pid, inboxId, priority, actor || null])
        .then(function (r) { var row = r.rows[0]; row.id = Number(row.id); row.agent_id = Number(row.agent_id); row.inbox_id = row.inbox_id === null ? null : Number(row.inbox_id); return row; }, function (e) {
          if (e && e.code === '23505') throw fail('conflict', 409, 'this agent is already bound to that project/inbox');
          throw e;
        });
    });
  });
}
function unlink(pool, agentId, linkId) {
  linkId = parseInt(linkId, 10);
  if (!linkId || linkId < 1) throw fail('validation', 400, 'link id required');
  return getOr404(pool, agentId).then(function (a) {
    return pool.query('DELETE FROM wp_project_agents WHERE id = $1 AND agent_id = $2 RETURNING id, project_id, inbox_id', [linkId, a.id]).then(function (r) {
      if (!r.rows[0]) throw fail('not_found', 404, 'no such binding');
      return { deleted: true, id: linkId, project_id: r.rows[0].project_id, inbox_id: r.rows[0].inbox_id === null ? null : Number(r.rows[0].inbox_id) };
    });
  });
}

// resolveForConversation(pool, convId) → agent row | null (see header for the priority)
function resolveForConversation(pool, convId) {
  convId = parseInt(convId, 10);
  if (!convId) return Promise.resolve(null);
  return pool.query('SELECT project_id, inbox_id, agent_id FROM wp_conversations WHERE id = $1', [convId]).then(function (r) {
    var c = r.rows[0];
    if (!c) return null;
    var own = c.agent_id ? pool.query('SELECT ' + SELECT + " FROM wp_agents WHERE id = $1 AND status = 'active'", [c.agent_id]).then(function (x) { return x.rows[0] || null; }) : Promise.resolve(null);
    return own.then(function (a) {
      if (a) return Object.assign(shape(a), { resolved_by: 'conversation' });
      return pool.query('SELECT ' + SELECT.split(', ').map(function (k) { return 'a.' + k; }).join(', ') + ", pa.inbox_id AS bound_inbox FROM wp_project_agents pa JOIN wp_agents a ON a.id = pa.agent_id WHERE pa.project_id = $1 AND pa.enabled AND a.status = 'active' AND (pa.inbox_id = $2 OR pa.inbox_id IS NULL) ORDER BY (pa.inbox_id IS NULL), pa.priority, pa.id LIMIT 1", [c.project_id, c.inbox_id]).then(function (x) {
        if (!x.rows[0]) return null;
        var row = x.rows[0]; var by = row.bound_inbox === null ? 'project' : 'inbox'; delete row.bound_inbox;
        return Object.assign(shape(row), { resolved_by: by });
      });
    });
  });
}

// effectiveMode(agent, inbox) → 'off' | 'suggest' | 'auto'
function effectiveMode(agent, inbox) {
  if (!agent || agent.status !== 'active') return 'off';
  var a = MODES.indexOf(agent.mode) !== -1 ? agent.mode : 'off';
  var i = inbox && inbox.ai_mode ? inbox.ai_mode : 'inherit';
  if (a === 'off' || i === 'off') return 'off';
  if (i === 'inherit' || MODES.indexOf(i) === -1) return a;
  return MODE_RANK[i] < MODE_RANK[a] ? i : a;
}

// ensureDefaults(pool) → { created: boolean, agent } — one default agent when the table is empty; binds nothing
function ensureDefaults(pool) {
  return pool.query('SELECT count(*)::int AS n FROM wp_agents').then(function (r) {
    if (r.rows[0].n > 0) return { created: false };
    return pool.query('INSERT INTO wp_agents (slug, name, description, status, mode, engine, language, tools, knowledge, confidence_min, settings, created_by) VALUES ($1,$2,$3,\'active\',$4,$5,$6,$7,true,$8,$9,\'system:defaults\') ON CONFLICT (slug) DO NOTHING RETURNING ' + SELECT,
      [DEFAULT_AGENT.slug, DEFAULT_AGENT.name, DEFAULT_AGENT.description, DEFAULT_AGENT.mode, DEFAULT_AGENT.engine, DEFAULT_AGENT.language, DEFAULT_AGENT.tools, DEFAULTS.confidence_min, JSON.stringify({ max_replies_per_hour: DEFAULTS.max_replies_per_hour })])
      .then(function (x) { return { created: !!x.rows[0], agent: x.rows[0] ? shape(x.rows[0]) : null }; });
  });
}

// counts(pool) → { active, auto, suggest, off, paused, archived, total } for /api/ai/status
function counts(pool) {
  return pool.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'active' AND mode = 'auto')::int AS auto, count(*) FILTER (WHERE status = 'active' AND mode = 'suggest')::int AS suggest, count(*) FILTER (WHERE status = 'active' AND mode = 'off')::int AS off, count(*) FILTER (WHERE status = 'paused')::int AS paused, count(*) FILTER (WHERE status = 'archived')::int AS archived FROM wp_agents").then(function (r) { return r.rows[0]; });
}

module.exports = {
  SLUG_RE: SLUG_RE, MODES: MODES, ENGINES: ENGINES, LANGUAGES: LANGUAGES, STATUSES: STATUSES, MAX_PROMPT: MAX_PROMPT, DEFAULTS: DEFAULTS, DEFAULT_AGENT: DEFAULT_AGENT,
  validate: validate, shape: shape, list: list, get: get, create: create, update: update, remove: remove, link: link, unlink: unlink,
  resolveForConversation: resolveForConversation, effectiveMode: effectiveMode, ensureDefaults: ensureDefaults, counts: counts
};
