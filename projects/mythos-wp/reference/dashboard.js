'use strict';
var numbers = require('./comms/numbers');
// =====================================================
// MYTHOS WP V2 — control-center dashboard (real data only)
// projects/mythos-wp/reference/dashboard.js
//
// build(pool, { projects: [accessible rows], project: id | null }) → the
// cross-project document of the contract: WhatsApp conversation counts,
// project activity, AI activity (wp_ai_runs / wp_handoffs, 24 h), the
// infrastructure state (latest wp_health_checks row per component) and the
// alerts derived from it. Every number is a count from a table the panel
// manages; a source that is unavailable is reported as null, never as 0.
//
// buildProject(resolved) keeps the per-project page metrics (handoffs by
// status, knowledge, rules, recent audit). The panel owns no catalogue any
// more: catalogue figures come from the project's Kitchen (kitchen.js) and
// are reported under `kitchen`, not invented.
//
// build() also accepts a resolved project object ({ project, wpPool }) as its
// first argument and then answers buildProject(), so the existing
// GET /api/projects/:p/dashboard route keeps working until the integrator
// switches it.
// =====================================================
var health = require('./health');
var kitchen = require('./kitchen');

function n(row, k) { return row && row[k] !== undefined && row[k] !== null ? Number(row[k]) : null; }
function nowIso() { return new Date().toISOString(); }

var LIVE = "status NOT IN ('resolved','archived')";

function whatsappCounts(pool, ids) {
  if (!ids.length) return Promise.resolve({ conversations: 0, unread: 0, ai: 0, human: 0, waiting: 0, waiting_human: 0, needs_attention: 0 });
  return pool.query(
    'SELECT count(*) FILTER (WHERE ' + LIVE + ')::int AS conversations, ' +
    'COALESCE(sum(unread_count) FILTER (WHERE ' + LIVE + '), 0)::int AS unread, ' +
    "count(*) FILTER (WHERE " + LIVE + " AND handler = 'ai')::int AS ai, " +
    "count(*) FILTER (WHERE " + LIVE + " AND handler = 'human')::int AS human, " +
    "count(*) FILTER (WHERE status = 'waiting_customer')::int AS waiting, " +
    'count(*) FILTER (WHERE ' + LIVE + " AND (status = 'needs_human' OR EXISTS (SELECT 1 FROM wp_handoffs h WHERE h.conversation_id = c.id AND h.status IN ('NEW','REQUIRES_HUMAN','IN_PROGRESS'))))::int AS waiting_human, " +
    'count(*) FILTER (WHERE ' + LIVE + " AND (status = 'needs_human' " +
    "OR EXISTS (SELECT 1 FROM wp_handoffs h WHERE h.conversation_id = c.id AND h.status IN ('NEW','REQUIRES_HUMAN','IN_PROGRESS')) " +
    "OR (unread_count > 0 AND last_inbound_at < now() - interval '30 minutes' AND (last_outbound_at IS NULL OR last_outbound_at < last_inbound_at))))::int AS needs_attention " +
    'FROM wp_conversations c WHERE project_id = ANY($1::text[])', [ids]).then(function (r) { return r.rows[0]; });
}

function projectActivity(pool, rows, ids) {
  var byId = {}, wa = {}, ai = {};
  var p = ids.length ? pool.query("SELECT project_id, count(*)::int AS n FROM wp_conversations WHERE project_id = ANY($1::text[]) AND last_message_at > now() - interval '24 hours' GROUP BY project_id", [ids]) : Promise.resolve({ rows: [] });
  var waQ = ids.length ? pool.query("SELECT i.project_id, n.id, n.provider, n.instance, n.phone_ref, n.status, n.health_state, n.webhook_state, i.inbound_enabled FROM wp_inboxes i JOIN wp_phone_numbers n ON n.id = i.phone_number_id WHERE i.project_id = ANY($1::text[]) ORDER BY n.id", [ids]) : Promise.resolve({ rows: [] });
  var aiQ = ids.length ? pool.query("SELECT DISTINCT ON (pa.project_id) pa.project_id, a.name, a.mode, a.status, p.settings FROM wp_project_agents pa JOIN wp_agents a ON a.id = pa.agent_id JOIN wp_projects p ON p.id = pa.project_id WHERE pa.project_id = ANY($1::text[]) AND pa.enabled AND pa.inbox_id IS NULL ORDER BY pa.project_id, pa.priority, pa.id", [ids]) : Promise.resolve({ rows: [] });
  return Promise.all([p, waQ, aiQ]).then(function (all) {
    var r = all[0];
    all[1].rows.forEach(function (x) {
      var conn = numbers.connectionOf(x);
      (wa[x.project_id] = wa[x.project_id] || []).push({ id: x.id, phone_masked: x.phone_ref ? '***' + String(x.phone_ref).slice(-4) : '***', status: x.status, connection: conn.state, connection_label: conn.label, connection_detail: conn.detail, receiving: x.webhook_state === 'ok' && x.inbound_enabled === true });
    });
    all[2].rows.forEach(function (x) { var pm = x.settings && x.settings.ai_mode ? x.settings.ai_mode : 'inherit'; var mode = x.status !== 'active' || x.mode === 'off' || pm === 'off' ? 'off' : (pm === 'inherit' ? x.mode : (pm === 'suggest' ? 'suggest' : x.mode)); ai[x.project_id] = { agent: x.name, mode: mode }; });
    r.rows.forEach(function (x) { byId[x.project_id] = x.n; });
    var selected = rows.filter(function (row) { return ids.indexOf(row.id) !== -1; });
    return {
      active: selected.filter(function (row) { return row.status === 'active'; }).length,
      total: selected.length,
      activity: selected.map(function (row) { return { id: row.id, display_name: row.display_name, kind: row.kind || 'automotive', status: row.status, conversations_24h: byId[row.id] || 0, whatsapp: (wa[row.id] || []), ai: ai[row.id] || { agent: null, mode: 'off' } }; }).sort(function (a, b) { return b.conversations_24h - a.conversations_24h || a.id.localeCompare(b.id); })
    };
  });
}

function aiStats(pool, ids, all) {
  var agentsQ = all
    ? pool.query("SELECT count(*)::int AS n FROM wp_agents WHERE status = 'active'")
    : pool.query("SELECT count(DISTINCT a.id)::int AS n FROM wp_agents a JOIN wp_project_agents pa ON pa.agent_id = a.id AND pa.enabled WHERE a.status = 'active' AND pa.project_id = ANY($1::text[])", [ids]);
  return Promise.all([
    agentsQ.then(function (r) { return r.rows[0].n; }, function () { return null; }),
    ids.length ? pool.query("SELECT count(*) FILTER (WHERE status = 'ok')::int AS handled, count(*) FILTER (WHERE status = 'error')::int AS errors FROM wp_ai_runs WHERE project_id = ANY($1::text[]) AND created_at > now() - interval '24 hours'", [ids]).then(function (r) { return r.rows[0]; }) : Promise.resolve({ handled: 0, errors: 0 }),
    ids.length ? pool.query("SELECT count(*)::int AS n FROM wp_handoffs WHERE project_id = ANY($1::text[]) AND created_at > now() - interval '24 hours'", [ids]).then(function (r) { return r.rows[0].n; }) : Promise.resolve(0)
  ]).then(function (x) { return { active_agents: x[0], handled_24h: n(x[1], 'handled'), handoffs_24h: x[2], errors_24h: n(x[1], 'errors') }; });
}

function integrationAlerts(pool) {
  return pool.query("SELECT key, kind, last_error, last_checked_at, health_state FROM wp_integrations WHERE status = 'enabled' AND last_error IS NOT NULL ORDER BY key").then(function (r) {
    return r.rows.map(function (x) { return { level: x.health_state === 'error' || x.health_state === 'disconnected' ? 'error' : 'warning', component: 'integration:' + x.key, message: x.last_error, at: x.last_checked_at }; });
  }, function () { return []; });
}

function numberAlerts(pool, ids) {
  if (!ids.length) return Promise.resolve([]);
  return pool.query("SELECT p.instance, p.display_name, p.status, p.health_detail, p.last_health_at FROM wp_phone_numbers p WHERE p.status <> 'open' AND EXISTS (SELECT 1 FROM wp_inboxes i WHERE i.phone_number_id = p.id AND i.inbound_enabled AND i.project_id = ANY($1::text[])) ORDER BY p.instance", [ids]).then(function (r) {
    return r.rows.map(function (x) { return { level: x.status === 'error' || x.status === 'closed' ? 'error' : 'warning', component: 'number:' + x.instance, message: (x.display_name || x.instance) + ' is ' + x.status + ' while an inbox is enabled', at: x.last_health_at }; });
  }, function () { return []; });
}

// build(pool, { projects, project }) → control-center document
function build(pool, o) {
  if (pool && pool.project && pool.wpPool && typeof pool.query !== 'function') return buildProject(pool); // legacy call shape (resolved project)
  o = o || {};
  var rows = Array.isArray(o.projects) ? o.projects : [];
  var all = !o.project || o.project === 'all';
  var ids = all ? rows.map(function (r) { return r.id; }) : rows.filter(function (r) { return r.id === String(o.project); }).map(function (r) { return r.id; });
  return Promise.all([
    whatsappCounts(pool, ids),
    projectActivity(pool, rows, ids),
    aiStats(pool, ids, all),
    // platform health and integration errors span every project: shown to manager+ only (same gate as /api/health/center)
    o.platform ? health.center(pool).catch(function () { return { components: [] }; }) : Promise.resolve({ components: [] }),
    o.platform ? integrationAlerts(pool) : Promise.resolve([]),
    numberAlerts(pool, ids)
  ]).then(function (x) {
    var infra = x[3].components.map(function (c) { return { component: c.component, status: c.status, detail: c.detail || {}, checked_at: c.checked_at }; });
    var alerts = infra.filter(function (c) { return c.status === 'error' || c.status === 'disconnected'; }).map(function (c) { return { level: 'error', component: c.component, message: (c.detail && c.detail.reason) || c.status, at: c.checked_at }; })
      .concat(x[4].filter(function (a) { return !infra.some(function (c) { return c.component === a.component && (c.status === 'error' || c.status === 'disconnected'); }); }), x[5]);
    return {
      scope: { project: all ? 'all' : String(o.project), project_ids: ids },
      whatsapp: { conversations: n(x[0], 'conversations'), unread: n(x[0], 'unread'), ai: n(x[0], 'ai'), human: n(x[0], 'human'), waiting: n(x[0], 'waiting'), waiting_human: n(x[0], 'waiting_human'), needs_attention: n(x[0], 'needs_attention') },
      projects: x[1],
      ai: x[2],
      infrastructure: infra,
      alerts: alerts,
      generated_at: nowIso()
    };
  });
}

// buildProject(resolved) → per-project page metrics (no catalogue of its own: the Kitchen is reported, not copied)
function buildProject(resolved) {
  var pool = resolved.wpPool, pid = resolved.project.id;
  return Promise.all([
    pool.query('SELECT status, count(*)::int AS n FROM wp_handoffs WHERE project_id = $1 GROUP BY status', [pid]),
    pool.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active' AND allowed_for_auto_reply)::int AS active_allowed FROM wp_knowledge WHERE project_id = $1", [pid]),
    pool.query('SELECT id, at, actor, action, resource, record_id, changed_fields FROM wp_audit_events WHERE project_id = $1 ORDER BY at DESC LIMIT 10', [pid]),
    pool.query('SELECT count(*)::int AS rules FROM wp_business_rules WHERE project_id = $1 AND enabled', [pid]),
    pool.query('SELECT count(*) FILTER (WHERE ' + LIVE + ")::int AS live, count(*) FILTER (WHERE status = 'needs_human')::int AS needs_human, COALESCE(sum(unread_count) FILTER (WHERE " + LIVE + '), 0)::int AS unread FROM wp_conversations WHERE project_id = $1', [pid]),
    pool.query('SELECT i.id, i.display_name, i.instance, i.status, i.inbound_enabled, i.outbound_enabled, i.ai_mode, i.account_mode, i.phone_number_id FROM wp_inboxes i WHERE i.project_id = $1 ORDER BY i.id', [pid]).catch(function () { return { rows: [] }; }),
    pool.query("SELECT count(*)::int AS n FROM wp_ai_runs WHERE project_id = $1 AND created_at > now() - interval '24 hours'", [pid]),
    kitchen.forProject(pool, resolved.project).then(function (c) { return c ? c.describe().then(function (d) { return d.ok ? { configured: true, key: c.key, reachable: true, counts: d.data.counts, contract: d.data.contract, capabilities: d.data.capabilities } : { configured: true, key: c.key, reachable: false, error: d.kind }; }) : { configured: false, key: kitchen.keyFor(resolved.project) }; }, function () { return { configured: false }; })
  ]).then(function (r) {
    var handoffs = { NEW: 0, REQUIRES_HUMAN: 0, IN_PROGRESS: 0, RESOLVED: 0 };
    r[0].rows.forEach(function (x) { handoffs[x.status] = x.n; });
    var open = handoffs.NEW + handoffs.REQUIRES_HUMAN + handoffs.IN_PROGRESS;
    return {
      project: { id: pid, display_name: resolved.project.display_name, domain: resolved.project.domain, status: resolved.project.status, kind: resolved.project.kind || 'automotive', description: resolved.project.description || null, settings: resolved.project.settings || {} },
      kitchen: r[7],
      panel: { handoffs: handoffs, knowledge: r[1].rows[0], rules_enabled: n(r[3].rows[0], 'rules') },
      whatsapp: { conversations: n(r[4].rows[0], 'live'), needs_human: n(r[4].rows[0], 'needs_human'), unread: n(r[4].rows[0], 'unread'), inboxes: r[5].rows },
      ai: { runs_24h: n(r[6].rows[0], 'n') },
      cards: { handoff_open: open, knowledge_allowed: n(r[1].rows[0], 'active_allowed'), conversations_live: n(r[4].rows[0], 'live'), unread: n(r[4].rows[0], 'unread'), rules_enabled: n(r[3].rows[0], 'rules'), kitchen_products: r[7].counts && r[7].counts.products !== undefined ? Number(r[7].counts.products) : null },
      recent_audit: r[2].rows,
      generated_at: nowIso()
    };
  });
}

module.exports = { build: build, buildProject: buildProject, whatsappCounts: whatsappCounts };
