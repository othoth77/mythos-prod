'use strict';
// =====================================================
// MYTHOS WP — dashboard metrics (real data only)
// projects/mythos-wp/reference/dashboard.js
//
// Every number here is a count from a table the panel manages or reads.
// When a source is unavailable the metric is reported as `null` with a
// reason, never as 0 — a zero would be a fabricated number.
// =====================================================

var crud = require('./crud');

function n(row, k) { return row && row[k] !== undefined && row[k] !== null ? Number(row[k]) : null; }

function catalogueMetrics(pool) {
  if (!pool) return Promise.resolve({ available: false, reason: 'CATALOG_NOT_CONFIGURED' });
  var q = [
    "SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('active','updated'))::int AS active, count(*) FILTER (WHERE status = 'delisted')::int AS delisted, count(*) FILTER (WHERE oem_reference IS NULL OR oem_reference = '')::int AS missing_oem, count(*) FILTER (WHERE updated_at > now() - interval '7 days')::int AS modified_7d, count(*) FILTER (WHERE last_checked_at < now() - interval '30 days')::int AS stale_30d FROM sya_products",
    'SELECT (SELECT count(*) FROM sya_vehicle_models)::int AS models, (SELECT count(*) FROM sya_vehicle_motorizations)::int AS motorizations, (SELECT count(*) FROM sya_product_vehicle_compatibility)::int AS compatibility, (SELECT count(*) FROM sya_product_images)::int AS images, (SELECT count(*) FROM sya_products p WHERE NOT EXISTS (SELECT 1 FROM sya_product_vehicle_compatibility c WHERE c.product_id = p.id))::int AS without_compatibility, (SELECT count(*) FROM sya_products p WHERE NOT EXISTS (SELECT 1 FROM sya_product_images i WHERE i.product_id = p.id))::int AS without_images',
    "SELECT product_uid, canonical_reference, product_title, product_brand, status, updated_at FROM sya_products ORDER BY updated_at DESC LIMIT 8",
    "SELECT product_uid FROM sya_products WHERE status IN ('active','updated')"
  ];
  return Promise.all(q.map(function (s) { return pool.query(s); })).then(function (r) {
    return { available: true, products: r[0].rows[0], structure: r[1].rows[0], recent: r[2].rows, activeUids: r[3].rows.map(function (x) { return x.product_uid; }) };
  }, function (e) { var m = crud.mapPgError(e); return { available: false, reason: m.code || 'CATALOG_ERROR' }; });
}

function panelMetrics(wpPool, projectId, activeUids) {
  var uids = activeUids || [];
  return Promise.all([
    wpPool.query('SELECT count(*)::int AS priced, count(*) FILTER (WHERE purchase_price IS NOT NULL)::int AS with_purchase FROM wp_product_commercial WHERE project_id = $1 AND selling_price IS NOT NULL AND product_uid = ANY($2::text[])', [projectId, uids]),
    wpPool.query("SELECT count(*)::int AS tracked, count(*) FILTER (WHERE availability = 'in_stock')::int AS in_stock, count(*) FILTER (WHERE availability = 'unavailable')::int AS unavailable, count(*) FILTER (WHERE quantity <= min_quantity AND availability <> 'unavailable')::int AS low FROM wp_stock WHERE project_id = $1", [projectId]),
    wpPool.query('SELECT status, count(*)::int AS n FROM wp_handoffs WHERE project_id = $1 GROUP BY status', [projectId]),
    wpPool.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active' AND allowed_for_auto_reply)::int AS active_allowed FROM wp_knowledge WHERE project_id = $1", [projectId]),
    wpPool.query('SELECT id, at, actor, action, resource, record_id, changed_fields FROM wp_audit_events WHERE project_id = $1 OR project_id IS NULL ORDER BY at DESC LIMIT 10', [projectId]),
    wpPool.query('SELECT count(*)::int AS rules FROM wp_business_rules WHERE project_id = $1 AND enabled', [projectId])
  ]).then(function (r) {
    var handoffs = { NEW: 0, REQUIRES_HUMAN: 0, IN_PROGRESS: 0, RESOLVED: 0 };
    r[2].rows.forEach(function (x) { handoffs[x.status] = x.n; });
    return {
      commercial: { priced_active: n(r[0].rows[0], 'priced'), with_purchase: n(r[0].rows[0], 'with_purchase') },
      stock: r[1].rows[0],
      handoffs: handoffs,
      knowledge: r[3].rows[0],
      recent_audit: r[4].rows,
      rules_enabled: n(r[5].rows[0], 'rules')
    };
  });
}

// build(resolved) → dashboard document for one project
function build(resolved) {
  return catalogueMetrics(resolved.catalogPool).then(function (cat) {
    return panelMetrics(resolved.wpPool, resolved.project.id, cat.available ? cat.activeUids : []).then(function (panel) {
      var active = cat.available ? n(cat.products, 'active') : null;
      var cards = {
        total_records: cat.available ? n(cat.products, 'total') : null,
        active_products: active,
        missing_prices: cat.available ? active - panel.commercial.priced_active : null,
        missing_references: cat.available ? n(cat.products, 'missing_oem') : null,
        low_stock: panel.stock.low,
        stock_untracked: cat.available ? active - panel.stock.tracked : null,
        recently_modified: cat.available ? n(cat.products, 'modified_7d') : null,
        handoff_open: panel.handoffs.NEW + panel.handoffs.REQUIRES_HUMAN + panel.handoffs.IN_PROGRESS
      };
      return {
        project: { id: resolved.project.id, display_name: resolved.project.display_name, domain: resolved.project.domain, status: resolved.project.status },
        catalogue: cat.available ? { products: cat.products, structure: cat.structure, recent: cat.recent } : { available: false, reason: cat.reason },
        panel: { commercial: panel.commercial, stock: panel.stock, handoffs: panel.handoffs, knowledge: panel.knowledge, rules_enabled: panel.rules_enabled },
        cards: cards,
        recent_audit: panel.recent_audit,
        generated_at: new Date().toISOString()
      };
    });
  });
}

module.exports = { build: build, catalogueMetrics: catalogueMetrics, panelMetrics: panelMetrics };
