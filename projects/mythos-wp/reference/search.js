'use strict';
// =====================================================
// MYTHOS WP V2 — global search (command menu)
// projects/mythos-wp/reference/search.js
//
// search(pool, { q, projects: [accessible rows], project: id | null })
//   → { q, groups:[{ key, label, items:[{ id, title, sub, route }] }] }
//
// One query, several sources, bounded results, everything parameterised and
// scoped to the projects the caller may see: contacts (name, or the digits
// of the number as a suffix), phone numbers, conversations (summary / last
// message text), projects, AI agents, templates, integrations and — when a
// single project is selected and it reads a Kitchen — products. Every item
// carries the hash route the UI opens. Numbers are shown masked; the
// contacts route carries the digits because the 360 view is keyed by them.
// =====================================================
var kitchen = require('./kitchen');

var LIMIT = 8;
function mask(n) { n = String(n || ''); return n.length > 3 ? '***' + n.slice(-3) : '***'; }
function group(key, label, items) { return { key: key, label: label, items: items || [] }; }
function safe(p, key, label) { return p.then(function (items) { return group(key, label, items); }, function () { return group(key, label, []); }); }

function search(pool, o) {
  o = o || {};
  var term = String(o.q || '').trim().slice(0, 100);
  if (term.length < 2) return Promise.resolve({ q: term, groups: [] });
  var rows = Array.isArray(o.projects) ? o.projects : [];
  var all = !o.project || o.project === 'all';
  var selected = all ? rows : rows.filter(function (r) { return r.id === String(o.project); });
  var ids = selected.map(function (r) { return r.id; });
  var names = {}; rows.forEach(function (r) { names[r.id] = r.display_name; });
  var like = '%' + term + '%';
  var digits = term.replace(/\D/g, '');
  var digitsLike = digits.length >= 3 ? '%' + digits : null;
  var tasks = [];

  tasks.push(safe(ids.length ? pool.query('SELECT DISTINCT ON (k.wa_id) k.id, k.wa_id, k.display_name, k.project_id, k.last_seen_at, (SELECT count(*)::int FROM wp_contacts k2 WHERE k2.wa_id = k.wa_id AND k2.project_id = ANY($1::text[])) AS projects FROM wp_contacts k WHERE k.project_id = ANY($1::text[]) AND k.wa_id IS NOT NULL AND (k.display_name ILIKE $2' + (digitsLike ? ' OR k.wa_id LIKE $4' : '') + ') ORDER BY k.wa_id, k.last_seen_at DESC NULLS LAST LIMIT $3', digitsLike ? [ids, like, LIMIT, digitsLike] : [ids, like, LIMIT]).then(function (r) {
    return r.rows.map(function (x) { return { id: x.id, title: x.display_name || mask(x.wa_id), sub: mask(x.wa_id) + ' · ' + (x.projects > 1 ? x.projects + ' projects' : (names[x.project_id] || x.project_id)), route: '#/contacts/360/' + (o.admin === true ? x.wa_id : x.project_id + ':' + x.id) }; });
  }) : Promise.resolve([]), 'contacts', 'Contacts'));

  tasks.push(safe(pool.query('SELECT p.id, p.instance, p.display_name, p.phone_ref, p.status, p.provider FROM wp_phone_numbers p WHERE (p.display_name ILIKE $1 OR p.instance ILIKE $1' + (digitsLike ? ' OR p.phone_ref LIKE $4' : '') + ') AND (NOT EXISTS (SELECT 1 FROM wp_inboxes i WHERE i.phone_number_id = p.id) OR EXISTS (SELECT 1 FROM wp_inboxes i WHERE i.phone_number_id = p.id AND i.project_id = ANY($3::text[]))) ORDER BY p.display_name LIMIT $2', digitsLike ? [like, LIMIT, ids, digitsLike] : [like, LIMIT, ids]).then(function (r) {
    return r.rows.map(function (x) { return { id: x.id, title: x.display_name, sub: x.provider + ' · ' + x.instance + ' · ' + (x.phone_ref ? mask(x.phone_ref) : '—') + ' · ' + x.status, route: '#/whatsapp?tab=numbers&id=' + x.id }; });
  }), 'numbers', 'Phone numbers'));

  tasks.push(safe(ids.length ? pool.query("SELECT c.id, c.project_id, c.status, c.handler, c.summary, k.display_name, k.wa_id, (SELECT m.text FROM wp_messages m WHERE m.conversation_id = c.id AND m.direction <> 'activity' ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_text FROM wp_conversations c JOIN wp_contacts k ON k.id = c.contact_id WHERE c.project_id = ANY($1::text[]) AND (c.summary ILIKE $2 OR k.display_name ILIKE $2 OR EXISTS (SELECT 1 FROM wp_messages m WHERE m.conversation_id = c.id AND m.direction <> 'activity' AND m.text ILIKE $2)) ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC LIMIT $3", [ids, like, LIMIT]).then(function (r) {
    return r.rows.map(function (x) { return { id: x.id, title: (x.display_name || mask(x.wa_id)) + ' · ' + (names[x.project_id] || x.project_id), sub: x.status + ' · ' + x.handler + (x.summary ? ' · ' + String(x.summary).slice(0, 80) : (x.last_text ? ' · ' + String(x.last_text).slice(0, 80) : '')), route: '#/inbox/' + x.id }; });
  }) : Promise.resolve([]), 'conversations', 'Conversations'));

  var low = term.toLowerCase();
  tasks.push(Promise.resolve(group('projects', 'Projects', rows.filter(function (r) { return [r.id, r.display_name, r.domain].some(function (v) { return v && String(v).toLowerCase().indexOf(low) !== -1; }); }).slice(0, LIMIT).map(function (r) { return { id: r.id, title: r.display_name, sub: r.id + ' · ' + (r.kind || 'automotive') + ' · ' + r.status, route: '#/projects/' + r.id }; }))));

  tasks.push(safe(pool.query('SELECT id, slug, name, status, mode, engine FROM wp_agents WHERE name ILIKE $1 OR slug ILIKE $1 ORDER BY name LIMIT $2', [like, LIMIT]).then(function (r) {
    return r.rows.map(function (x) { return { id: x.id, title: x.name, sub: x.slug + ' · ' + x.engine + ' · ' + x.mode + ' · ' + x.status, route: '#/ai/agents/' + x.id }; });
  }), 'agents', 'AI agents'));

  tasks.push(safe(pool.query('SELECT id, name, language, category, status, project_id FROM wp_templates WHERE (project_id IS NULL OR project_id = ANY($3::text[])) AND (name ILIKE $1 OR body ILIKE $1) ORDER BY name LIMIT $2', [like, LIMIT, ids]).then(function (r) {
    return r.rows.map(function (x) { return { id: x.id, title: x.name, sub: x.language + ' · ' + x.category + ' · ' + x.status + (x.project_id ? ' · ' + (names[x.project_id] || x.project_id) : ' · shared'), route: '#/whatsapp?tab=templates&id=' + x.id }; });
  }), 'templates', 'Templates'));

  tasks.push(safe(pool.query('SELECT key, kind, name, status, health_state FROM wp_integrations WHERE key ILIKE $1 OR name ILIKE $1 OR kind ILIKE $1 ORDER BY key LIMIT $2', [like, LIMIT]).then(function (r) {
    return r.rows.map(function (x) { return { id: x.key, title: x.name, sub: x.kind + ' · ' + x.status + ' · ' + x.health_state, route: '#/integrations?key=' + x.key }; });
  }), 'integrations', 'Integrations'));

  if (!all && selected.length === 1) {
    var project = selected[0];
    tasks.push(safe(kitchen.forProject(pool, project).then(function (client) {
      if (!client) return [];
      var byRef = /[0-9]/.test(term) ? client.searchProducts({ ref: term, limit: LIMIT }) : Promise.resolve({ ok: true, data: { products: [] } });
      return Promise.all([client.searchProducts({ q: term, limit: LIMIT }), byRef]).then(function (x) {
        var seen = {}, items = [];
        [x[1], x[0]].forEach(function (r) { if (!r.ok) return; r.data.products.forEach(function (p) { if (seen[p.product_uid] || items.length >= LIMIT) return; seen[p.product_uid] = true; items.push({ id: p.product_uid, title: (p.canonical_reference || p.product_uid) + ' — ' + (p.product_title || ''), sub: (p.product_brand || '—') + ' · ' + p.availability + (p.price_tnd !== null ? ' · ' + p.price_tnd + ' ' + p.currency + ' (indicative)' : ''), route: '#/projects/' + project.id + '?tab=catalogue&uid=' + encodeURIComponent(p.product_uid) }); }); });
        return items;
      });
    }), 'products', 'Products'));
  }

  var VISIBLE = { projects: true, conversations: true, contacts: true };   // V2.1: the operator searches people, threads and projects — nothing technical
  return Promise.all(tasks).then(function (groups) {
    groups = groups.filter(function (g) { return VISIBLE[g.key] === true; }); return { q: term, scope: { project: all ? 'all' : String(o.project), project_ids: ids }, groups: groups.filter(function (g) { return g.items.length; }) }; });
}

module.exports = { LIMIT: LIMIT, search: search };
