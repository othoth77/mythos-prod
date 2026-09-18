'use strict';
// =====================================================
// MYTHOS WP V2.1 — simple project operations (the "New project" form and Project → AI)
// projects/mythos-wp/reference/projects.js
//
//   createSimple(pool, body, actor)   name, kind, domain, description, currency, phone_number_id,
//                                    agent_id → project row (slug generated), optional number link,
//                                    optional agent binding. One audited action for the operator.
//   aiGet(pool, projectId)           { agent, mode, status, agents[] } — the project-level AI view
//   aiPut(pool, projectId, body)     binds ONE project-level agent (inbox NULL) and stores the
//                                    project's AI mode in settings.ai_mode (off|suggest|auto|inherit)
//   slugify(name)                    'Dar Hijama' → 'dar-hijama' (unique suffix when taken)
//
// Technical configuration (settings JSON, brand, legacy columns) stays reachable through the
// generic /api/r/projects resource — it is just not part of the simple form.
// =====================================================
var store = require('./projects-store');
var fail = require('./crud').fail;
var KINDS = { service: 'service', auto: 'automotive', automotive: 'automotive', internal: 'internal', other: 'other' };
var AI_MODES = ['off', 'suggest', 'auto', 'inherit'];

function slugify(name) {
  var s = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  if (!/^[a-z0-9]/.test(s)) s = 'p-' + s;
  if (s.length < 2) s = s + '-project';
  return s;
}
function uniqueSlug(pool, base) {
  return pool.query('SELECT id FROM wp_projects WHERE id = $1 OR id LIKE $2', [base, base + '-%']).then(function (r) {
    var taken = {}; r.rows.forEach(function (x) { taken[x.id] = true; });
    if (!taken[base]) return base;
    for (var i = 2; i < 1000; i++) if (!taken[base + '-' + i]) return base + '-' + i;
    throw fail('conflict', 409, 'no free project id for this name');
  });
}

function createSimple(pool, body, actor) {
  body = body || {};
  var name = String(body.name || body.display_name || '').trim();
  if (!name || name.length > 128) throw fail('validation', 400, 'project name required (1–128)', { errors: { name: 'required' } });
  var kindKey = String(body.kind || body.type || 'service').toLowerCase();
  var kind = Object.prototype.hasOwnProperty.call(KINDS, kindKey) ? KINDS[kindKey] : null;   // never a prototype key
  if (!kind) throw fail('validation', 400, 'type must be service, auto or internal', { errors: { kind: 'not_in_enum' } });
  var domain = body.domain ? String(body.domain).trim().toLowerCase().slice(0, 128) : null;
  if (domain && !/^[a-z0-9.-]{3,128}$/.test(domain)) throw fail('validation', 400, 'domain shape', { errors: { domain: 'pattern' } });
  var currency = String(body.currency || 'TND').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw fail('validation', 400, 'currency must be ISO 4217', { errors: { currency: 'pattern' } });
  var description = body.description ? String(body.description).slice(0, 4000) : null;
  var brand = body.brand_car ? String(body.brand_car).trim().slice(0, 64) : null;
  var settings = {};
  if (kind === 'automotive') settings.kitchen = 'kitchen-mythos-auto';      // the Kitchen is attached automatically
  if (body.ai_mode !== undefined && body.ai_mode !== null) { if (AI_MODES.indexOf(body.ai_mode) === -1) throw fail('validation', 400, 'ai_mode off|suggest|auto', { errors: { ai_mode: 'not_in_enum' } }); settings.ai_mode = body.ai_mode; }
  var numberId = body.phone_number_id ? parseInt(body.phone_number_id, 10) : null;
  var agentId = body.agent_id ? parseInt(body.agent_id, 10) : null;
  return uniqueSlug(pool, slugify(name)).then(function (id) {
    return pool.query("INSERT INTO wp_projects (id, display_name, domain, brand_car, kind, status, currency, description, settings) VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8) RETURNING *", [id, name, domain, kind === 'automotive' ? brand : null, kind, currency, description, JSON.stringify(settings)]);
  }).then(function (r) {
    var project = r.rows[0]; store.invalidate();
    var out = { project: project, inbox: null, agent: null, warnings: [] };
    var chain = Promise.resolve();
    if (numberId) chain = chain.then(function () {
      var numbers = require('./comms/numbers');
      return numbers.rawNumber(pool, numberId).then(function (n) {
        // a number already linked elsewhere (or a personal number) can only be shared; a free business number is dedicated
        return numbers.inboxesOfNumber(pool, n).then(function (links) {
          var shared = links.length > 0 || n.is_personal === true;
          // A PERSONAL / reserved number is shared only when the CALLER said so (numbers.link enforces it
          // too). This form never implies that opt-in: without it the project is created and the link is
          // reported as a warning, exactly like any other refused link.
          var linkBody = { project_id: project.id, display_name: project.display_name, account_mode: shared ? 'shared' : 'dedicated' };
          if (body.allow_personal_account === true) linkBody.allow_personal_account = true;
          return numbers.link(pool, numberId, linkBody, actor).then(function (ib) { out.inbox = ib && ib.inbox ? ib.inbox : ib; }, function (e) { out.warnings.push('whatsapp: ' + (e.detail || e.message)); });
        });
      }, function () { out.warnings.push('whatsapp: unknown number'); });
    });
    if (agentId) chain = chain.then(function () {
      var agents = require('./ai/agents');
      return agents.link(pool, agentId, { project_id: project.id }, actor).then(function (l) { out.agent = l; }, function (e) { out.warnings.push('ai: ' + (e.detail || e.message)); });
    });
    return chain.then(function () { return out; });
  });
}

function aiGet(pool, projectId, opts) {
  opts = opts || {};
  return Promise.all([
    pool.query('SELECT settings FROM wp_projects WHERE id = $1', [projectId]),
    pool.query('SELECT pa.id AS link_id, a.id, a.name, a.slug, a.mode, a.engine, a.status FROM wp_project_agents pa JOIN wp_agents a ON a.id = pa.agent_id WHERE pa.project_id = $1 AND pa.inbox_id IS NULL AND pa.enabled ORDER BY pa.priority, pa.id LIMIT 1', [projectId]),
    opts.choices ? pool.query("SELECT id, name, slug, mode, engine FROM wp_agents WHERE status <> 'archived' ORDER BY name") : Promise.resolve({ rows: [] })
  ]).then(function (x) {
    if (!x[0].rows[0]) throw fail('not_found', 404, 'unknown project');
    var settings = x[0].rows[0].settings || {};
    var a = x[1].rows[0] || null;
    var projectMode = AI_MODES.indexOf(settings.ai_mode) !== -1 ? settings.ai_mode : 'inherit';
    var effective = !a || a.status !== 'active' ? 'off' : (projectMode === 'inherit' ? a.mode : (projectMode === 'off' || a.mode === 'off' ? 'off' : projectMode));
    return { agent: a ? { id: a.id, name: a.name, slug: a.slug, mode: a.mode, engine: a.engine, link_id: a.link_id } : null, mode: effective, project_mode: projectMode, status: a && a.status === 'active' && effective !== 'off' ? 'active' : 'disabled', agents: x[2].rows };
  });
}

function aiPut(pool, projectId, body, actor) {
  body = body || {};
  var mode = body.mode === undefined ? undefined : String(body.mode);
  if (body.status === 'disabled') mode = 'off';                       // the AI tab's Status select: Disabled = mode off for this project
  else if (body.status === 'active' && mode === undefined) mode = 'inherit';
  if (mode !== undefined && AI_MODES.indexOf(mode) === -1) throw fail('validation', 400, 'mode off|suggest|auto|inherit', { errors: { mode: 'not_in_enum' } });
  var agentId = body.agent_id === undefined ? undefined : (body.agent_id === null || body.agent_id === '' ? null : parseInt(body.agent_id, 10));
  var agents = require('./ai/agents');
  var chain = Promise.resolve();
  if (agentId !== undefined) chain = chain.then(function () {
    return pool.query('DELETE FROM wp_project_agents WHERE project_id = $1 AND inbox_id IS NULL', [projectId]).then(function () {
      if (!agentId) return null;
      return agents.link(pool, agentId, { project_id: projectId }, actor);
    });
  });
  if (mode !== undefined) chain = chain.then(function () { return pool.query("UPDATE wp_projects SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('ai_mode', $2::text), updated_at = now() WHERE id = $1 RETURNING id", [projectId, mode]).then(function (r) { if (!r.rows[0]) throw fail('not_found', 404, 'unknown project'); store.invalidate(); }); });
  return chain.then(function () { return aiGet(pool, projectId, { choices: true }); });
}

// numbersOf(pool, projectId) → [{ id, phone_masked, status, inbox_id, ai_mode, inbound_enabled }] for the project summary
function numbersOf(pool, projectId) {
  var numbers = require('./comms/numbers');
  return pool.query("SELECT n.id, n.provider, n.instance, n.phone_ref, n.status, n.health_state, n.webhook_state, i.id AS inbox_id, i.ai_mode, i.inbound_enabled, i.outbound_enabled, i.account_mode FROM wp_inboxes i JOIN wp_phone_numbers n ON n.id = i.phone_number_id WHERE i.project_id = $1 ORDER BY n.id", [projectId])
    .then(function (r) { return r.rows.map(function (x) { var conn = numbers.connectionOf(x); return { id: x.id, phone_masked: x.phone_ref ? '***' + String(x.phone_ref).slice(-4) : '***', status: x.status, connection: conn.state, connection_label: conn.label, connection_detail: conn.detail, receiving: x.webhook_state === 'ok' && x.inbound_enabled === true, inbox_id: x.inbox_id, ai_mode: x.ai_mode, account_mode: x.account_mode, inbound_enabled: x.inbound_enabled, outbound_enabled: x.outbound_enabled }; }); });
}

module.exports = { slugify: slugify, uniqueSlug: uniqueSlug, createSimple: createSimple, aiGet: aiGet, aiPut: aiPut, numbersOf: numbersOf, AI_MODES: AI_MODES };
