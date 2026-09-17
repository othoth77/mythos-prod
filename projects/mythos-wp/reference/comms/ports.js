'use strict';
// =====================================================
// MYTHOS WP — business-data ports for the MYTHOS AUTO auto-reply engine
// projects/mythos-wp/reference/comms/ports.js
//
// Implements the port contract of projects/automotive/comms/lib/business-data.js
// (Issue #173) over the project's Shared Kitchen (kitchen.js, contract 1.3.0).
// The panel owns no catalogue, no commercial layer and no stock table any
// more: every fact comes from the Kitchen the project reads.
//
//   vehicle(entities, ctx)  → Kitchen vehicle models whose name starts with
//                             the model the customer named
//   parts(entities, ctx)    → Kitchen products matching a reference (`ref=`,
//                             punctuation-insensitive) or the part words (`q=`)
//   price(entities, ctx)    → exactly one candidate → the Kitchen's PUBLISHED
//                             catalogue price, labelled `indicative: true`
//                             (a market observation the seller confirms, not a
//                             negotiated customer price)
//   stock(entities, ctx)    → the Kitchen availability STATE (IN_STOCK |
//                             ON_ORDER | UNAVAILABLE); UNKNOWN is not a fact
//   order                   → not connected (no order system) → the engine
//                             records PORT_NOT_CONNECTED → handoff
//
// The contract's safety rule is kept literally: a port answers
// { ok: true, data } ONLY for an unambiguous fact. No match, more than one
// candidate (MAX 5 listed, more = TOO_MANY_MATCHES), an UNKNOWN state, a
// Kitchen error or a slow Kitchen all answer { ok: false, reason } and the
// engine treats the kind as MISSING → REQUIRES_HUMAN. Nothing here composes a
// reply. A project without a Kitchen answers KITCHEN_NOT_CONFIGURED for every
// kind.
//
// `ctx.project_id` (set by the handler) selects the project: one ports object
// serves every project. deps.resolveProject(id) → { project, wpPool, kitchen? }
// — when `kitchen` is absent the client is obtained via kitchen.forProject.
// =====================================================

var kitchenLib = require('../kitchen');

var TIMEOUT_MS = 3000;
var MAX_CANDIDATES = 5;
var MAX_WORDS = 4;

function reason(code) { return { ok: false, reason: code }; }

function withTimeout(p, ms) {
  var t;
  var timer = new Promise(function (_, rej) { t = setTimeout(function () { rej(new Error('PORT_TIMEOUT')); }, ms); });
  return Promise.race([p, timer]).then(function (v) { clearTimeout(t); return v; }, function (e) { clearTimeout(t); throw e; });
}

function kitchenReason(r) { return 'KITCHEN_' + (r && r.kind ? String(r.kind) : 'ERROR'); }

function candidate(p) { return { product_uid: p.product_uid, product_brand: p.product_brand, canonical_reference: p.canonical_reference, product_title: p.product_title, oem_reference: p.oem_reference, availability: p.availability, price_tnd: p.price_tnd, currency: p.currency, last_checked_at: p.last_checked_at }; }

// deps = { resolveProject(projectId) → Promise<{ project, wpPool, kitchen? } | null> }
function create(deps) {
  deps = deps || {};

  function project(ctx) {
    var id = ctx && ctx.project_id;
    if (!id || typeof deps.resolveProject !== 'function') return Promise.resolve(null);
    return Promise.resolve(deps.resolveProject(id));
  }

  function clientOf(p) {
    if (!p) return Promise.resolve(null);
    if (p.kitchen && typeof p.kitchen.searchProducts === 'function') return Promise.resolve(p.kitchen);
    if (!p.wpPool || !p.project) return Promise.resolve(null);
    return kitchenLib.forProject(p.wpPool, p.project);
  }

  // --- candidate resolution (shared by parts / price / stock) ------------
  // → { by: 'reference'|'words'|'none', rows } | { error: reason }
  function findProducts(client, entities) {
    entities = entities || {};
    var ref = entities.reference ? String(entities.reference).toUpperCase().replace(/[^A-Z0-9-]/g, '') : null;
    if (ref && ref.length >= 3) {
      return client.searchProducts({ ref: ref, limit: MAX_CANDIDATES + 1 }).then(function (r) {
        if (!r.ok) return { error: kitchenReason(r) };
        return { by: 'reference', rows: r.data.products.map(candidate) };
      });
    }
    var words = Array.isArray(entities.parts) ? entities.parts.map(function (w) { return String(w).trim(); }).filter(function (w) { return w.length >= 3; }).slice(0, MAX_WORDS) : [];
    if (!words.length) return Promise.resolve({ by: 'none', rows: [] });
    var vehicle = entities.vehicle_model ? String(entities.vehicle_model) : null;
    var modelP = vehicle ? client.listVehicleModels().then(function (r) {
      if (!r.ok) return null;
      var hits = r.data.vehicle_models.filter(function (m) { return String(m.model_name || '').toUpperCase().indexOf(vehicle.toUpperCase()) === 0; });
      return hits.length === 1 && /^\d+$/.test(String(hits[0].id)) ? hits[0].id : null; // one model → narrow by fitment; several → do not guess
    }) : Promise.resolve(null);
    return modelP.then(function (modelId) {
      // One query per word (the Kitchen matches one phrase); union by uid, like the previous OR over words.
      return Promise.all(words.map(function (w) { return client.searchProducts({ q: w, model_id: modelId || undefined, limit: MAX_CANDIDATES + 1 }); })).then(function (results) {
        var failed = results.filter(function (r) { return !r.ok; })[0];
        if (failed && results.every(function (r) { return !r.ok; })) return { error: kitchenReason(failed) };
        var seen = {}, rows = [];
        results.forEach(function (r) { if (!r.ok) return; r.data.products.forEach(function (p) { if (!seen[p.product_uid]) { seen[p.product_uid] = true; rows.push(candidate(p)); } }); });
        rows.sort(function (a, b) { return String(a.canonical_reference || '').localeCompare(String(b.canonical_reference || '')); });
        return { by: 'words', rows: rows.slice(0, MAX_CANDIDATES + 1) };
      });
    });
  }

  function single(found) {
    if (found.error) return { error: found.error };
    if (found.by === 'none') return { error: 'NO_PART_NAMED' };
    if (!found.rows.length) return { error: 'NO_MATCH' };
    if (found.rows.length > 1) return { error: 'AMBIGUOUS' };
    return { row: found.rows[0] };
  }

  function guard(fn) {
    return function (entities, ctx) {
      return withTimeout(project(ctx).then(function (p) {
        if (!p) return reason('PROJECT_UNKNOWN');
        return clientOf(p).then(function (client) {
          if (!client) return reason('KITCHEN_NOT_CONFIGURED');
          return fn(client, entities || {}, p);
        });
      }), TIMEOUT_MS).catch(function (e) {
        return reason(e && e.message === 'PORT_TIMEOUT' ? 'PORT_TIMEOUT' : 'PORT_ERROR');
      });
    };
  }

  var ports = {
    vehicle: guard(function (client, entities) {
      if (!entities.vehicle_model) return reason('NO_VEHICLE');
      var prefix = String(entities.vehicle_model).toUpperCase();
      return client.listVehicleModels().then(function (r) {
        if (!r.ok) return reason(kitchenReason(r));
        var models = r.data.vehicle_models.filter(function (m) { return String(m.model_name || '').toUpperCase().indexOf(prefix) === 0; })
          .map(function (m) { return { id: m.id, brand_car: m.brand_car || null, model_name: m.model_name, generation_code: m.generation_code || null, year_from: m.year_from || null, year_to: m.year_to || null }; })
          .sort(function (a, b) { return (a.year_from || 9999) - (b.year_from || 9999); }).slice(0, 10);
        if (!models.length) return reason('NO_MATCH');
        return { ok: true, data: { models: models, verified: true, source: 'kitchen:catalogue' } };
      });
    }),

    parts: guard(function (client, entities) {
      return findProducts(client, entities).then(function (found) {
        if (found.error) return reason(found.error);
        if (found.by === 'none') return reason('NO_PART_NAMED');
        if (!found.rows.length) return reason('NO_MATCH');
        if (found.rows.length > MAX_CANDIDATES) return reason('TOO_MANY_MATCHES');
        return { ok: true, data: { matches: found.rows, by: found.by, verified: true, source: 'kitchen:catalogue' } };
      });
    }),

    price: guard(function (client, entities) {
      return findProducts(client, entities).then(function (found) {
        var s = single(found);
        if (s.error) return reason(s.error);
        if (s.row.price_tnd === null || s.row.price_tnd === undefined || !(s.row.price_tnd > 0)) return reason('PRICE_NOT_SET');
        return { ok: true, data: { product_uid: s.row.product_uid, reference: s.row.canonical_reference, selling_price: Number(s.row.price_tnd), currency: s.row.currency || 'TND', verified: true, source: 'kitchen:catalogue', indicative: true, as_of: s.row.last_checked_at || null } };
      });
    }),

    stock: guard(function (client, entities) {
      return findProducts(client, entities).then(function (found) {
        var s = single(found);
        if (s.error) return reason(s.error);
        var state = kitchenLib.normaliseAvailability(s.row.availability);
        if (state === 'UNKNOWN') return reason('STOCK_UNKNOWN');
        return { ok: true, data: { product_uid: s.row.product_uid, reference: s.row.canonical_reference, availability: state, verified: true, source: 'kitchen:catalogue', as_of: s.row.last_checked_at || null } };
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
