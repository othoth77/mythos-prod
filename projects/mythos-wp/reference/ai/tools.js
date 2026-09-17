'use strict';
// =====================================================
// MYTHOS WP V2 — AI tool registry (read-only, least privilege)
// projects/mythos-wp/reference/ai/tools.js
//
// Every tool = { id, label, description, scope, requires, run(ctx, args) →
// Promise<{ ok, data | reason }> }. No write tool exists: a tool reads the
// project's Kitchen, its knowledge base or the SAME conversation's history,
// or returns a decision flag (handoff.request) that the assistant acts on.
//
// run(toolId, ctx, args) is the only entry point the LLM loop uses:
//   · the agent may only run the tools listed in agent.tools
//     (TOOL_NOT_ALLOWED otherwise — the model cannot widen its own rights);
//   · every call is timed and bounded (TOOL_TIMEOUT) and recorded into
//     ctx.toolsUsed = [{ tool, ok, ms, reason? }] — names and outcomes only;
//   · a tool that throws answers { ok:false, reason:'TOOL_ERROR' }.
//
// ctx = { pool, resolved: { project, wpPool }, project_id, conversation_id,
//         agent, toolsUsed }.  Kitchen tools go through ../kitchen (builder
// B); when the module is absent at runtime they answer
// KITCHEN_MODULE_UNAVAILABLE, when the project names no Kitchen
// KITCHEN_NOT_CONFIGURED — never a guess.
// =====================================================
var TIMEOUT_MS = 5000;
var KNOWLEDGE_LIMIT = 5;
var HISTORY_LIMIT = 10;
var MAX_ARG = 200;

function reason(code, extra) { return Object.assign({ ok: false, reason: code }, extra || {}); }
function str(v, max) { return v === undefined || v === null ? '' : String(v).trim().slice(0, max || MAX_ARG); }
function likeEscape(s) { return s.replace(/[\\%_]/g, function (c) { return '\\' + c; }); }

// --- Kitchen (builder B's kitchen.js; loaded lazily so this module never fails to load) ----
//   kitchen.forProject(pool, project) → Promise<client | null>; client.searchProducts(p) / getProduct(uid) /
//   quote(uids) / availability(uid) / listVehicleModels(); every answer { ok:true, data } | { ok:false, kind }.
var kitchenLoader = function () { return require('../kitchen'); };
function kitchenModule() {
  try { return kitchenLoader(); } catch (e) { if (e && e.code === 'MODULE_NOT_FOUND' && /kitchen/.test(String(e.message))) return null; throw e; }
}
function setKitchenLoader(fn) { kitchenLoader = typeof fn === 'function' ? fn : function () { return require('../kitchen'); }; }
function kitchenClient(ctx) {
  var project = ctx && ctx.resolved && ctx.resolved.project;
  if (!project) return Promise.resolve({ error: reason('PROJECT_UNKNOWN') });
  var mod = kitchenModule();
  if (!mod) return Promise.resolve({ error: reason('KITCHEN_MODULE_UNAVAILABLE') });
  if (typeof mod.forProject !== 'function') return Promise.resolve({ error: reason('KITCHEN_TOOL_UNSUPPORTED') });
  var pool = ctx.pool || (ctx.resolved && ctx.resolved.wpPool);
  try {
    if (typeof mod.keyFor === 'function' && !mod.keyFor(project)) return Promise.resolve({ error: reason('KITCHEN_NOT_CONFIGURED') });
    return Promise.resolve(mod.forProject(pool, project)).then(function (client) { return client ? { client: client } : { error: reason('KITCHEN_NOT_CONFIGURED') }; }, function () { return { error: reason('KITCHEN_CLIENT_ERROR') }; });
  } catch (e) { return Promise.resolve({ error: reason('KITCHEN_CLIENT_ERROR') }); }
}
function kitchenCall(ctx, method, args) {
  return kitchenClient(ctx).then(function (k) {
    if (k.error) return k.error;
    if (typeof k.client[method] !== 'function') return reason('KITCHEN_TOOL_UNSUPPORTED', { tool_method: method });
    var call;
    try { call = Promise.resolve(k.client[method].apply(k.client, args)); } catch (e) { return reason('KITCHEN_ERROR'); }
    return call.then(function (r) {
      if (r && r.ok === true) { var data = r.data !== undefined ? r.data : (r.body !== undefined ? r.body : null); if (data === null || data === undefined) return reason('NO_MATCH'); return { ok: true, data: data, source: 'kitchen', degraded: r.degraded === true }; }
      if (r && r.ok === false) return reason(String(r.kind || r.reason || 'KITCHEN_ERROR').slice(0, 40), r.status ? { status: r.status } : null);
      if (r === null || r === undefined) return reason('NO_MATCH');
      return { ok: true, data: r, source: 'kitchen' };
    }, function (e) { return reason(e && /^[A-Z_]{3,40}$/.test(String(e.message)) ? e.message : 'KITCHEN_ERROR'); });
  });
}

var REGISTRY = [
  { id: 'kitchen.search_products', label: 'Search products', description: 'Search the project catalogue (Kitchen) by free text, reference, category, vehicle brand or model. Read-only.', scope: 'kitchen', requires: 'kitchen', args: { q: 'string', ref: 'string', category: 'string', brand_car: 'string', model: 'string', limit: 'number' },
    run: function (ctx, a) { return kitchenCall(ctx, 'searchProducts', [{ q: str(a.q), ref: str(a.ref, 64), category: str(a.category, 64), brand_car: str(a.brand_car, 64), model: str(a.model, 64), limit: Math.min(Math.max(parseInt(a.limit, 10) || 5, 1), 10) }]); } },
  { id: 'kitchen.get_product', label: 'Get product', description: 'Read one catalogue product by uid (title, references, fitment). Read-only.', scope: 'kitchen', requires: 'kitchen', args: { uid: 'string' },
    run: function (ctx, a) { var uid = str(a.uid, 64); if (!uid) return reason('UID_REQUIRED'); return kitchenCall(ctx, 'getProduct', [uid]); } },
  { id: 'kitchen.quote', label: 'Price quote', description: 'Verified selling price(s) for product uid(s) from the Kitchen. The ONLY source a reply may quote a price from.', scope: 'kitchen', requires: 'kitchen', args: { uids: 'string[]' },
    run: function (ctx, a) { var uids = Array.isArray(a.uids) ? a.uids.map(function (u) { return str(u, 64); }).filter(Boolean).slice(0, 10) : (str(a.uid, 64) ? [str(a.uid, 64)] : []); if (!uids.length) return reason('UIDS_REQUIRED'); return kitchenCall(ctx, 'quote', [uids]); } },
  { id: 'kitchen.availability', label: 'Availability', description: 'Verified stock / availability state of one product uid from the Kitchen.', scope: 'kitchen', requires: 'kitchen', args: { uid: 'string' },
    run: function (ctx, a) { var uid = str(a.uid, 64); if (!uid) return reason('UID_REQUIRED'); return kitchenCall(ctx, 'availability', [uid]); } },
  { id: 'kitchen.vehicle_models', label: 'Vehicle models', description: 'List the vehicle models the project catalogue knows (for identification).', scope: 'kitchen', requires: 'kitchen', args: { q: 'string' },
    run: function (ctx) { return kitchenCall(ctx, 'listVehicleModels', []); } },
  { id: 'knowledge.lookup', label: 'Knowledge lookup', description: 'Search the project knowledge base (active entries allowed for automated replies) by keywords. Returns title, customer text and language; a returned text may be used verbatim.', scope: 'knowledge', requires: null, args: { q: 'string' },
    run: function (ctx, a) {
      var q = str(a.q || a.query || a.text);
      if (q.length < 2) return reason('QUERY_REQUIRED');
      var pool = ctx.pool || (ctx.resolved && ctx.resolved.wpPool);
      if (!pool || !ctx.project_id) return reason('PROJECT_UNKNOWN');
      var terms = q.split(/\s+/).filter(function (w) { return w.length >= 2; }).slice(0, 5);
      if (!terms.length) terms = [q];
      var params = [ctx.project_id]; var conds = [];
      terms.forEach(function (w) { params.push('%' + likeEscape(w) + '%'); conds.push('(title ILIKE $' + params.length + " ESCAPE '\\' OR customer_text ILIKE $" + params.length + " ESCAPE '\\')"); });
      return pool.query("SELECT id, kind, title, customer_text, language FROM wp_knowledge WHERE project_id = $1 AND status = 'active' AND allowed_for_auto_reply AND (" + conds.join(' OR ') + ') ORDER BY updated_at DESC LIMIT ' + KNOWLEDGE_LIMIT, params)
        .then(function (r) { return { ok: true, data: { items: r.rows.map(function (k) { return { id: Number(k.id), kind: k.kind, title: k.title, customer_text: k.customer_text, language: k.language }; }), count: r.rows.length } }; });
    } },
  { id: 'conversation.history', label: 'Conversation history', description: 'The last 10 messages of THIS conversation (direction, sender kind, text, time). Never another conversation.', scope: 'conversation', requires: null, args: {},
    run: function (ctx) {
      var pool = ctx.pool || (ctx.resolved && ctx.resolved.wpPool);
      if (!pool || !ctx.project_id) return reason('PROJECT_UNKNOWN');
      if (!ctx.conversation_id) return reason('NO_CONVERSATION');
      return pool.query("SELECT direction, sender_kind, text, created_at AS at FROM wp_messages WHERE conversation_id = $1 AND project_id = $2 AND direction IN ('in','out') ORDER BY created_at DESC, id DESC LIMIT " + HISTORY_LIMIT, [ctx.conversation_id, ctx.project_id])
        .then(function (r) { return { ok: true, data: { messages: r.rows.reverse().map(function (m) { return { direction: m.direction, sender_kind: m.sender_kind, text: m.text === null ? null : String(m.text).slice(0, 1000), at: m.at }; }), count: r.rows.length } }; });
    } },
  { id: 'handoff.request', label: 'Request handoff', description: 'Ask for a human to take the conversation over (with a reason). Returns a decision flag; the assistant performs the handoff.', scope: 'handoff', requires: null, args: { reason: 'string' },
    run: function (ctx, a) { var why = str(a.reason, 64).toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'AGENT_REQUESTED'; return { ok: true, data: { requested: true, reason: why } }; } }
];
var BY_ID = {}; REGISTRY.forEach(function (t) { BY_ID[t.id] = t; });

function list() { return REGISTRY.map(function (t) { return { id: t.id, label: t.label, description: t.description, scope: t.scope, requires: t.requires, args: t.args || {} }; }); }
function ids() { return REGISTRY.map(function (t) { return t.id; }); }
function get(id) { return BY_ID[id] || null; }

function withTimeout(p, ms) {
  var t; var timer = new Promise(function (_, rej) { t = setTimeout(function () { rej(new Error('TOOL_TIMEOUT')); }, ms); });
  return Promise.race([p, timer]).then(function (v) { clearTimeout(t); return v; }, function (e) { clearTimeout(t); throw e; });
}

// run(toolId, ctx, args) → Promise<{ ok, data | reason }>; records into ctx.toolsUsed
function run(toolId, ctx, args) {
  ctx = ctx || {}; args = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  if (!Array.isArray(ctx.toolsUsed)) ctx.toolsUsed = [];
  var t0 = Date.now();
  var tool = BY_ID[String(toolId || '')];
  var allowed = !!(tool && ctx.agent && Array.isArray(ctx.agent.tools) && ctx.agent.tools.indexOf(tool.id) !== -1);
  var p;
  if (!tool) p = Promise.resolve(reason('TOOL_UNKNOWN'));
  else if (!allowed) p = Promise.resolve(reason('TOOL_NOT_ALLOWED'));
  else {
    try { p = withTimeout(Promise.resolve(tool.run(ctx, args)), ctx.timeoutMs || TIMEOUT_MS); } catch (e) { p = Promise.resolve(reason('TOOL_ERROR')); }
    p = p.catch(function (e) { return reason(e && e.message === 'TOOL_TIMEOUT' ? 'TOOL_TIMEOUT' : 'TOOL_ERROR'); });
  }
  return p.then(function (r) {
    if (!r || typeof r !== 'object') r = reason('TOOL_NO_DATA');
    if (r.ok !== true) { r.ok = false; r.reason = String(r.reason || 'TOOL_NO_DATA').slice(0, 40); }
    var rec = { tool: String(toolId || '').slice(0, 64), ok: r.ok, ms: Date.now() - t0 };
    if (!r.ok) rec.reason = r.reason;
    ctx.toolsUsed.push(rec);
    return r;
  });
}

module.exports = { TIMEOUT_MS: TIMEOUT_MS, KNOWLEDGE_LIMIT: KNOWLEDGE_LIMIT, HISTORY_LIMIT: HISTORY_LIMIT, REGISTRY: REGISTRY, list: list, ids: ids, get: get, run: run, kitchenModule: kitchenModule, setKitchenLoader: setKitchenLoader };
