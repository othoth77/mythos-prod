'use strict';
// =====================================================
// MYTHOS WP — global search (command menu)
// projects/mythos-wp/reference/search.js
//
// One query, several sources, bounded results: catalogue parts (reference,
// OEM, title, brand), vehicle models, knowledge entries, open handoffs.
// Everything parameterised; results carry the route the UI opens.
// =====================================================

var LIMIT = 8;

function search(resolved, q) {
  var term = String(q || '').trim().slice(0, 100);
  if (term.length < 2) return Promise.resolve({ q: term, groups: [] });
  var like = '%' + term + '%';
  var tasks = [];
  if (resolved.catalogPool) {
    tasks.push(resolved.catalogPool.query(
      "SELECT id, product_uid, canonical_reference, product_title, product_brand, status FROM sya_products WHERE canonical_reference ILIKE $1 OR oem_reference ILIKE $1 OR product_title ILIKE $1 OR product_brand ILIKE $1 OR product_uid ILIKE $1 ORDER BY (canonical_reference ILIKE $2) DESC, canonical_reference LIMIT $3",
      [like, term + '%', LIMIT]).then(function (r) {
      return { key: 'products', label: 'Parts', items: r.rows.map(function (x) { return { id: x.id, title: x.canonical_reference + ' — ' + x.product_title, sub: x.product_brand + ' · ' + x.status, route: '#/r/products/' + x.id }; }) };
    }).catch(function () { return { key: 'products', label: 'Parts', items: [], error: 'CATALOG_UNAVAILABLE' }; }));
    tasks.push(resolved.catalogPool.query(
      'SELECT id, model_name, generation_code, year_from, year_to FROM sya_vehicle_models WHERE model_name ILIKE $1 OR generation_code ILIKE $1 ORDER BY model_name LIMIT $2', [like, LIMIT]).then(function (r) {
      return { key: 'vehicle_models', label: 'Vehicles', items: r.rows.map(function (x) { return { id: x.id, title: x.model_name + (x.generation_code ? ' (' + x.generation_code + ')' : ''), sub: (x.year_from || '?') + ' – ' + (x.year_to || 'now'), route: '#/r/vehicle_models/' + x.id }; }) };
    }).catch(function () { return { key: 'vehicle_models', label: 'Vehicles', items: [] }; }));
  }
  tasks.push(resolved.wpPool.query('SELECT id, title, kind, status FROM wp_knowledge WHERE project_id = $1 AND (title ILIKE $2 OR customer_text ILIKE $2) ORDER BY updated_at DESC LIMIT $3', [resolved.project.id, like, LIMIT]).then(function (r) {
    return { key: 'knowledge', label: 'Knowledge', items: r.rows.map(function (x) { return { id: x.id, title: x.title, sub: x.kind + ' · ' + x.status, route: '#/r/knowledge/' + x.id }; }) };
  }));
  tasks.push(resolved.wpPool.query("SELECT id, reason, intent, status, customer_ref_masked FROM wp_handoffs WHERE project_id = $1 AND status <> 'RESOLVED' AND (reason ILIKE $2 OR intent ILIKE $2 OR customer_ref_masked ILIKE $2 OR notes ILIKE $2) ORDER BY created_at DESC LIMIT $3", [resolved.project.id, like, LIMIT]).then(function (r) {
    return { key: 'handoffs', label: 'Handoffs', items: r.rows.map(function (x) { return { id: x.id, title: '#' + x.id + ' ' + x.reason, sub: (x.intent || '—') + ' · ' + x.status + (x.customer_ref_masked ? ' · ' + x.customer_ref_masked : ''), route: '#/r/handoffs/' + x.id }; }) };
  }));
  return Promise.all(tasks).then(function (groups) { return { q: term, groups: groups.filter(function (g) { return g.items.length || g.error; }) }; });
}

module.exports = { LIMIT: LIMIT, search: search };
