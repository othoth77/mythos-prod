'use strict';
// =====================================================
// MYTHOS WP V2 — cross-project contacts & 360 document (builder A)
// projects/mythos-wp/reference/comms/contacts360.js
//
// One customer = one phone identity across projects (wp_contact_identities
// kind phone, fallback wp_contacts.wa_id). list() groups the per-project
// contact rows by phone; get360() assembles persons / conversations /
// timeline / counters. Scope: `projects` = the ids the caller may see (null =
// every project). Numbers are masked ('***' + last 4); the full phone is
// returned only when o.admin === true. No message text ever leaves here.
// =====================================================
var PHONE_RE = /^[0-9]{6,32}$/;
function fail(code, status, detail) { var e = new Error(detail || code); e.code = code; e.status = status; return e; }
function mask(n) { n = String(n || ''); return n.length >= 4 ? '***' + n.slice(-4) : '***'; }
function clampInt(v, d, lo, hi) { var n = parseInt(v, 10); if (isNaN(n)) n = d; return Math.max(lo, Math.min(hi, n)); }
var PHONE_EXPR = "COALESCE((SELECT ci.value FROM wp_contact_identities ci WHERE ci.contact_id = k.id AND ci.kind = 'phone' ORDER BY ci.id LIMIT 1), k.wa_id)";
// an unscoped session below admin still never reads the admin-only holding project ('unassigned')
function scopeClause(projects, params, admin) { if (projects === null || projects === undefined) return admin === true ? null : "k.project_id <> 'unassigned'"; params.push(projects.length ? projects : ['-']); return 'k.project_id = ANY($' + params.length + '::text[])'; }
function later(a, b) { if (!a) return b; if (!b) return a; return new Date(a) > new Date(b) ? a : b; }

// list(pool, { q, projects, limit, admin }) → { items }
function list(pool, o) {
  o = o || {}; var params = []; var where = ["k.status <> 'merged'"];
  var sc = scopeClause(o.projects, params, o.admin); if (sc) where.push(sc);
  if (o.q) { var qq = String(o.q).slice(0, 80); params.push('%' + qq + '%'); where.push('(k.display_name ILIKE $' + params.length + ' OR ' + PHONE_EXPR + ' LIKE $' + params.length + ')'); }
  var limit = clampInt(o.limit, 50, 1, 200); params.push(limit * 5);
  return pool.query('SELECT k.id, k.project_id, p.display_name AS project_name, k.display_name, k.status, k.last_seen_at, ' + PHONE_EXPR + ' AS phone, ' +
    '(SELECT count(*)::int FROM wp_conversations c WHERE c.contact_id = k.id) AS conversations, ' +
    "COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM wp_contact_tags ct JOIN wp_tags t ON t.id = ct.tag_id WHERE ct.contact_id = k.id), '{}') AS tags " +
    'FROM wp_contacts k JOIN wp_projects p ON p.id = k.project_id WHERE ' + where.join(' AND ') + ' ORDER BY k.last_seen_at DESC NULLS LAST, k.id DESC LIMIT $' + params.length, params)
    .then(function (r) {
      var groups = {}, order = [];
      r.rows.forEach(function (x) {
        var key = x.phone || ('id:' + x.id);
        var g = groups[key];
        if (!g) { g = groups[key] = { phone_masked: mask(x.phone), key: x.project_id + ':' + x.id, display_name: null, projects: [], conversations: 0, last_seen_at: null, tags: [] }; if (o.admin === true) g.phone = x.phone; order.push(key); }
        if (!g.display_name && x.display_name) g.display_name = x.display_name;
        g.projects.push({ project_id: x.project_id, project_name: x.project_name, contact_id: x.id, display_name: x.display_name, status: x.status, last_seen_at: x.last_seen_at, conversations: x.conversations });
        g.conversations += x.conversations;
        g.last_seen_at = later(g.last_seen_at, x.last_seen_at);
        (x.tags || []).forEach(function (t) { if (g.tags.indexOf(t) === -1) g.tags.push(t); });
      });
      return { items: order.slice(0, limit).map(function (k) { return groups[k]; }), truncated: order.length > limit };
    });
}
// get360(pool, phone, { projects, admin }) → the 360 document (404 when no accessible contact carries the phone)
function get360(pool, phone, o) {
  o = o || {}; phone = String(phone || '').replace(/[^0-9]/g, '');
  if (!PHONE_RE.test(phone)) throw fail('validation', 400, 'phone digits required');
  var params = [phone]; var where = ['(k.wa_id = $1 OR EXISTS (SELECT 1 FROM wp_contact_identities ci WHERE ci.contact_id = k.id AND ci.kind = \'phone\' AND ci.value = $1))', "k.status <> 'merged'"];
  var sc = scopeClause(o.projects, params, o.admin); if (sc) where.push(sc);
  return pool.query('SELECT k.id, k.project_id, p.display_name AS project_name, k.display_name, k.language, k.status, k.source, k.memory, k.notes AS contact_notes, k.first_seen_at, k.last_seen_at, k.last_inbound_at, k.last_outbound_at, ' +
    "COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY t.name) FROM wp_contact_tags ct JOIN wp_tags t ON t.id = ct.tag_id WHERE ct.contact_id = k.id), '[]'::json) AS tags, " +
    "COALESCE((SELECT json_agg(json_build_object('id', n.id, 'author', n.author, 'body', n.body, 'created_at', n.created_at) ORDER BY n.created_at DESC) FROM wp_notes n WHERE n.target_kind = 'contact' AND n.target_id = k.id::text AND (n.project_id IS NULL OR n.project_id = k.project_id)), '[]'::json) AS notes " +
    'FROM wp_contacts k JOIN wp_projects p ON p.id = k.project_id WHERE ' + where.join(' AND ') + ' ORDER BY k.project_id, k.id', params)
    .then(function (r) {
      if (!r.rows.length) throw fail('not_found', 404, 'no contact with this phone');
      var persons = r.rows; var ids = persons.map(function (x) { return x.id; });
      return Promise.all([
        pool.query('SELECT c.id, c.project_id, c.inbox_id, i.display_name AS inbox_name, c.status, c.handler, c.agent_id, c.assigned_to, c.routed_by, c.last_message_at, c.unread_count, c.created_at, c.resolved_at FROM wp_conversations c JOIN wp_inboxes i ON i.id = c.inbox_id WHERE c.contact_id = ANY($1::bigint[]) ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC LIMIT 100', [ids]),
        pool.query("SELECT 'event' AS kind, e.at, e.project_id, e.conversation_id, e.event_name AS summary, e.actor FROM wp_conversation_events e JOIN wp_conversations c ON c.id = e.conversation_id WHERE c.contact_id = ANY($1::bigint[]) " +
          "UNION ALL SELECT 'ai_run', r.created_at, r.project_id, r.conversation_id, r.kind || ':' || r.decision || COALESCE(' (' || r.intent || ')', ''), 'ai' FROM wp_ai_runs r JOIN wp_conversations c ON c.id = r.conversation_id WHERE c.contact_id = ANY($1::bigint[]) " +
          "UNION ALL SELECT 'handoff', h.created_at, h.project_id, h.conversation_id, h.direction || ':' || h.reason || ' [' || h.status || ']', COALESCE(h.taken_by, 'system') FROM wp_handoffs h JOIN wp_conversations c ON c.id = h.conversation_id WHERE c.contact_id = ANY($1::bigint[]) " +
          'ORDER BY 2 DESC LIMIT 200', [ids]),
        pool.query("SELECT (SELECT count(*)::int FROM wp_ai_runs r JOIN wp_conversations c ON c.id = r.conversation_id WHERE c.contact_id = ANY($1::bigint[])) AS runs, (SELECT count(*)::int FROM wp_ai_suggestions s JOIN wp_conversations c ON c.id = s.conversation_id WHERE c.contact_id = ANY($1::bigint[])) AS suggestions, (SELECT count(*)::int FROM wp_handoffs h JOIN wp_conversations c ON c.id = h.conversation_id WHERE c.contact_id = ANY($1::bigint[])) AS handoffs, (SELECT count(*)::int FROM wp_messages m WHERE m.contact_id = ANY($1::bigint[]) AND m.direction = 'out' AND m.sender_kind = 'user') AS messages_out, (SELECT count(*)::int FROM wp_messages m WHERE m.contact_id = ANY($1::bigint[]) AND m.direction = 'in') AS messages_in, (SELECT count(*)::int FROM wp_messages m WHERE m.contact_id = ANY($1::bigint[]) AND m.direction = 'activity') AS activity_notes", [ids])
      ]).then(function (x) {
        var cnt = x[2].rows[0];
        var notes = persons.reduce(function (n, p) { return n + (p.notes ? p.notes.length : 0); }, 0);
        var out = { phone_masked: mask(phone), display_name: persons.map(function (p) { return p.display_name; }).filter(Boolean)[0] || null, persons: persons, conversations: x[0].rows, timeline: x[1].rows, ai: { runs: cnt.runs, suggestions: cnt.suggestions, handoffs: cnt.handoffs }, human: { messages_out: cnt.messages_out, notes: notes + cnt.activity_notes }, messages_in: cnt.messages_in };
        if (o.admin === true) out.phone = phone;
        return out;
      });
    });
}
// resolveKey(pool, key, o) → phone digits for '<project>:<contact_id>' (only within the caller's project scope)
function resolveKey(pool, key, o) {
  var m = /^([a-z0-9][a-z0-9-]{1,62}):(\d{1,15})$/.exec(String(key || ''));
  if (!m) throw fail('validation', 400, 'phone digits or <project>:<contact_id> required');
  if (o && Array.isArray(o.projects) && o.projects.indexOf(m[1]) === -1) throw fail('not_found', 404, 'no such contact');
  return pool.query('SELECT ' + PHONE_EXPR + ' AS phone FROM wp_contacts k WHERE k.project_id = $1 AND k.id = $2', [m[1], parseInt(m[2], 10)]).then(function (r) {
    if (!r.rows[0] || !r.rows[0].phone) throw fail('not_found', 404, 'no such contact');
    return r.rows[0].phone;
  });
}
module.exports = { resolveKey: resolveKey, list: list, get360: get360, mask: mask };
