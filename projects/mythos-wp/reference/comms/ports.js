'use strict';
// =====================================================
// MYTHOS WP — business-data ports for the MYTHOS AUTO auto-reply engine
// projects/mythos-wp/reference/comms/ports.js
//
// Implements the port contract of projects/automotive/comms/lib/business-data.js
// (Issue #173) over the data MYTHOS WP manages:
//
//   vehicle(entities, ctx)  → catalogue vehicle models matching the model the
//                             customer named
//   parts(entities, ctx)    → catalogue products matching a reference, or part
//                             words (+ vehicle) — VERIFIED catalogue facts
//   price(entities, ctx)    → the VERIFIED selling price from the panel's
//                             commercial layer (wp_product_commercial); the
//                             scraped catalogue price is NEVER returned as a
//                             customer price
//   stock(entities, ctx)    → the VERIFIED stock state from wp_stock; an
//                             'unknown' availability is not a fact
//   order                   → not connected (no order system exists) → the
//                             engine records PORT_NOT_CONNECTED → handoff
//
// The contract's safety rule is kept literally: a port answers
// { ok: true, data } ONLY for an unambiguous, verified fact. No match, more
// than one candidate, a missing overlay row, an 'unknown' state, an error
// or a slow database all answer { ok: false, reason } and the engine treats
// the kind as MISSING → REQUIRES_HUMAN. Nothing here composes a reply.
//
// `ctx.project_id` (set by the handler) selects the project: one ports
// object serves every project, so the receiver can pass a single object.
// =====================================================

var TIMEOUT_MS = 3000;
var MAX_CANDIDATES = 5;

function reason(code) { return { ok: false, reason: code }; }

function withTimeout(p, ms) {
  var t;
  var timer = new Promise(function (_, rej) { t = setTimeout(function () { rej(new Error('PORT_TIMEOUT')); }, ms); });
  return Promise.race([p, timer]).then(function (v) { clearTimeout(t); return v; }, function (e) { clearTimeout(t); throw e; });
}

// deps = { resolveProject(projectId) → Promise<{ project, catalogPool, wpPool } | null> }
function create(deps) {
  function project(ctx) {
    var id = ctx && ctx.project_id;
    if (!id) return Promise.resolve(null);
    return Promise.resolve(deps.resolveProject(id));
  }

  // --- candidate resolution (shared by parts / price / stock) ------------
  function findProducts(p, entities) {
    entities = entities || {};
    var ref = entities.reference ? String(entities.reference).toUpperCase().replace(/[^A-Z0-9-]/g, '') : null;
    if (ref && ref.length >= 3) {
      return p.catalogPool.query(
        "SELECT product_uid, product_brand, canonical_reference, product_title, oem_reference FROM sya_products WHERE status IN ('active','updated') AND (upper(regexp_replace(canonical_reference, '[^A-Za-z0-9-]', '', 'g')) = $1 OR upper(regexp_replace(coalesce(oem_reference,''), '[^A-Za-z0-9-]', '', 'g')) LIKE '%' || $1 || '%' OR upper(coalesce(pair_reference,'')) = $1) ORDER BY canonical_reference LIMIT $2",
        [ref, MAX_CANDIDATES + 1]).then(function (r) { return { by: 'reference', rows: r.rows }; });
    }
    var words = Array.isArray(entities.parts) ? entities.parts.map(function (w) { return String(w).trim(); }).filter(function (w) { return w.length >= 3; }).slice(0, 4) : [];
    if (!words.length) return Promise.resolve({ by: 'none', rows: [] });
    var params = [];
    var conds = words.map(function (w) { params.push('%' + w + '%'); return 'unaccent_free(t.product_title) ILIKE $' + params.length; });
    var sql = 'SELECT DISTINCT t.product_uid, t.product_brand, t.canonical_reference, t.product_title, t.oem_reference FROM sya_products t';
    var where = ["t.status IN ('active','updated')", '(' + conds.join(' OR ') + ')'];
    if (entities.vehicle_model) {
      params.push(String(entities.vehicle_model));
      sql += ' JOIN sya_product_vehicle_compatibility c ON c.product_id = t.id JOIN sya_vehicle_models m ON m.id = c.vehicle_model_id';
      where.push('m.model_name ILIKE $' + params.length);
      if (entities.vehicle_year && /^\d{4}$/.test(String(entities.vehicle_year))) {
        params.push(parseInt(entities.vehicle_year, 10));
        where.push('(c.year_from IS NULL OR c.year_from <= $' + params.length + ') AND (c.year_to IS NULL OR c.year_to >= $' + params.length + ')');
      }
    }
    sql += ' WHERE ' + where.join(' AND ') + ' ORDER BY t.canonical_reference LIMIT ' + (MAX_CANDIDATES + 1);
    // No unaccent extension is assumed: plain ILIKE over the title.
    sql = sql.replace(/unaccent_free\(([^)]+)\)/g, '$1');
    return p.catalogPool.query(sql, params).then(function (r) { return { by: 'words', rows: r.rows }; });
  }

  function single(found) {
    if (!found.rows.length) return { error: 'NO_MATCH' };
    if (found.rows.length > 1) return { error: 'AMBIGUOUS' };
    return { row: found.rows[0] };
  }

  function guard(fn) {
    return function (entities, ctx) {
      return withTimeout(project(ctx).then(function (p) {
        if (!p) return reason('PROJECT_UNKNOWN');
        return fn(p, entities || {});
      }), TIMEOUT_MS).catch(function (e) {
        return reason(e && e.message === 'PORT_TIMEOUT' ? 'PORT_TIMEOUT' : 'PORT_ERROR');
      });
    };
  }

  var ports = {
    vehicle: guard(function (p, entities) {
      if (!entities.vehicle_model) return reason('NO_VEHICLE');
      return p.catalogPool.query('SELECT model_name, generation_code, year_from, year_to FROM sya_vehicle_models WHERE model_name ILIKE $1 ORDER BY year_from NULLS LAST LIMIT 10', [String(entities.vehicle_model) + '%']).then(function (r) {
        if (!r.rows.length) return reason('NO_MATCH');
        return { ok: true, data: { models: r.rows, verified: true, source: 'catalogue' } };
      });
    }),

    parts: guard(function (p, entities) {
      return findProducts(p, entities).then(function (found) {
        if (found.by === 'none') return reason('NO_PART_NAMED');
        if (!found.rows.length) return reason('NO_MATCH');
        if (found.rows.length > MAX_CANDIDATES) return reason('TOO_MANY_MATCHES');
        return { ok: true, data: { matches: found.rows, by: found.by, verified: true, source: 'catalogue' } };
      });
    }),

    price: guard(function (p, entities) {
      return findProducts(p, entities).then(function (found) {
        var s = single(found);
        if (s.error) return reason(s.error);
        return p.wpPool.query('SELECT selling_price, currency, updated_at FROM wp_product_commercial WHERE project_id = $1 AND product_uid = $2', [p.project.id, s.row.product_uid]).then(function (r) {
          if (!r.rows.length || r.rows[0].selling_price === null) return reason('PRICE_NOT_SET');
          return { ok: true, data: { product_uid: s.row.product_uid, reference: s.row.canonical_reference, selling_price: Number(r.rows[0].selling_price), currency: r.rows[0].currency, verified: true, source: 'mythos-wp:commercial', as_of: r.rows[0].updated_at } };
        });
      });
    }),

    stock: guard(function (p, entities) {
      return findProducts(p, entities).then(function (found) {
        var s = single(found);
        if (s.error) return reason(s.error);
        return p.wpPool.query('SELECT quantity, min_quantity, availability, lead_time_days, updated_at FROM wp_stock WHERE project_id = $1 AND product_uid = $2', [p.project.id, s.row.product_uid]).then(function (r) {
          if (!r.rows.length || r.rows[0].availability === 'unknown') return reason('STOCK_NOT_SET');
          var row = r.rows[0];
          return { ok: true, data: { product_uid: s.row.product_uid, availability: row.availability, quantity: row.quantity, lead_time_days: row.lead_time_days, verified: true, source: 'mythos-wp:stock', as_of: row.updated_at } };
        });
      });
    })
    // order: deliberately absent → PORT_NOT_CONNECTED (no order system).
  };

  // Which kinds this integration can answer at all — reported by the panel.
  ports.connected = ['vehicle', 'parts', 'price', 'stock'];
  ports.notConnected = ['order'];
  return ports;
}

module.exports = { TIMEOUT_MS: TIMEOUT_MS, MAX_CANDIDATES: MAX_CANDIDATES, create: create };
