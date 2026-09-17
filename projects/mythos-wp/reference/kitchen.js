'use strict';
// =====================================================
// MYTHOS WP V2 — read-only client for the MYTHOS AUTO Shared Kitchen
// projects/mythos-wp/reference/kitchen.js
//
// Contract 1.3.0 (piece.autos src/kitchen/contract.ts). The panel owns no
// catalogue any more: an automotive project READS its Kitchen through the
// wp_integrations row named by project.settings.kitchen (default key
// 'kitchen-mythos-auto', base http://127.0.0.1:3011). Every method answers
// { ok:true, data } or { ok:false, kind } with kind ∈ UNREACHABLE | TIMEOUT |
// BAD_STATUS | BAD_PAYLOAD, exactly as the storefronts degrade. A 404 on a
// CAPABILITY route (vehicle-brands, quotes = 1.1; part-categories = 1.2)
// means an older Kitchen: the client degrades ({ ok:true, degraded:true,
// empty data }) instead of failing. Nothing here writes; there is no method
// that could.
//
// Availability is a STATE the Kitchen publishes in French catalogue words;
// it is normalised here once to the closed vocabulary IN_STOCK | ON_ORDER |
// UNAVAILABLE | UNKNOWN. No quantity exists anywhere.
// =====================================================
var http = require('http');
var https = require('https');

var CONTRACT_VERSION = '1.3.0';
var DEFAULT_KEY = 'kitchen-mythos-auto';
var DEFAULT_BASE = 'http://127.0.0.1:3011';
var TIMEOUT_MS = 3000;
var CAPABILITY_TTL_MS = 60000;
var ROW_TTL_MS = 15000;
var AVAILABILITIES = ['IN_STOCK', 'ON_ORDER', 'UNAVAILABLE', 'UNKNOWN'];
var ERROR_KINDS = ['UNREACHABLE', 'TIMEOUT', 'BAD_STATUS', 'BAD_PAYLOAD'];
var CAPABILITIES = { 'vehicle-brands': '/api/vehicle-brands', quotes: '/api/quotes', 'part-categories': '/api/part-categories' };
var KEY_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
var UID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
var MAX_LIMIT = 100;

var FRENCH = { 'en stock': 'IN_STOCK', 'disponible': 'IN_STOCK', 'sur commande': 'ON_ORDER', 'indisponible': 'UNAVAILABLE', 'rupture': 'UNAVAILABLE', 'épuisé': 'UNAVAILABLE', 'epuise': 'UNAVAILABLE' };

function normaliseAvailability(v) {
  if (v === null || v === undefined) return 'UNKNOWN';
  var s = String(v).trim();
  if (AVAILABILITIES.indexOf(s.toUpperCase()) !== -1) return s.toUpperCase();
  var low = s.toLowerCase();
  return FRENCH[low] || 'UNKNOWN';
}

function num(v) { if (v === null || v === undefined || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }

// The list / detail / quote rows share one normalised shape.
function product(p) {
  if (!p || typeof p !== 'object') return null;
  var out = {
    product_uid: p.product_uid, product_brand: p.product_brand || null, canonical_reference: p.canonical_reference || null,
    product_title: p.product_title || null, oem_reference: p.oem_reference || null,
    availability: normaliseAvailability(p.availability), availability_raw: p.availability === undefined ? null : p.availability,
    price_tnd: num(p.price_tnd), currency: p.currency || 'TND', product_url: p.product_url || null,
    last_checked_at: p.last_checked_at || null, main_image_url: p.main_image_url || null
  };
  if (p.pair_reference !== undefined) out.pair_reference = p.pair_reference;
  if (p.technical_specs !== undefined) out.technical_specs = p.technical_specs;
  if (p.criteria_text !== undefined) out.criteria_text = p.criteria_text;
  if (p.delivery_note !== undefined) out.delivery_note = p.delivery_note;
  if (p.status !== undefined) out.status = p.status;
  if (Array.isArray(p.images)) out.images = p.images;
  if (Array.isArray(p.compatibility)) out.compatibility = p.compatibility;
  return out;
}

function failure(kind, extra) { var o = { ok: false, kind: ERROR_KINDS.indexOf(kind) !== -1 ? kind : 'BAD_PAYLOAD' }; if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; }); return o; }

// get(base, pathname, query) → Promise<{ ok:true, status, body, ms } | { ok:false, kind, status?, ms }>
// A non-2xx answer is reported as BAD_STATUS with its status so callers can degrade on 404.
function get(base, pathname, query, timeoutMs) {
  return new Promise(function (resolve) {
    var u;
    try { u = new URL(String(base).replace(/\/+$/, '') + pathname); } catch (e) { return resolve(failure('UNREACHABLE', { reason: 'URL_INVALID' })); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return resolve(failure('UNREACHABLE', { reason: 'URL_SCHEME' }));
    if (query) Object.keys(query).forEach(function (k) { if (query[k] !== undefined && query[k] !== null && query[k] !== '') u.searchParams.set(k, String(query[k])); });
    var mod = u.protocol === 'https:' ? https : http;
    var started = Date.now(), done = false;
    var finish = function (r) { if (!done) { done = true; r.ms = Date.now() - started; resolve(r); } };
    var req = mod.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'GET', headers: { accept: 'application/json' }, timeout: timeoutMs || TIMEOUT_MS }, function (res) {
      var chunks = [], size = 0;
      res.on('data', function (c) { size += c.length; if (size <= 4 * 1024 * 1024) chunks.push(c); });
      res.on('end', function () {
        var body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { body = undefined; }
        if (res.statusCode < 200 || res.statusCode >= 300) return finish(failure('BAD_STATUS', { status: res.statusCode, reason: body && typeof body.error === 'string' ? body.error.slice(0, 120) : null }));
        if (body === undefined || body === null || typeof body !== 'object') return finish(failure('BAD_PAYLOAD', { status: res.statusCode }));
        finish({ ok: true, status: res.statusCode, body: body });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('TIMEOUT')); finish(failure('TIMEOUT')); });
    req.on('error', function (e) { finish(e && e.message === 'TIMEOUT' ? failure('TIMEOUT') : failure('UNREACHABLE', { code: e && e.code ? String(e.code) : null })); });
    req.end();
  });
}

function clampLimit(v, d) { var n = parseInt(v, 10); if (isNaN(n) || n < 1) n = d; return Math.min(n, MAX_LIMIT); }
function clampOffset(v) { var n = parseInt(v, 10); return isNaN(n) || n < 0 ? 0 : n; }

// createClient({ base_url, key }) → the read-only client for one Kitchen.
function createClient(o) {
  o = o || {};
  var base = String(o.base_url || DEFAULT_BASE);
  var key = o.key || DEFAULT_KEY;
  var caps = { at: 0, value: null, pending: null };

  function call(pathname, query) { return get(base, pathname, query); }

  // A 404 on a capability route = the Kitchen predates it → degrade.
  function capability(name, pathname, query, empty) {
    return call(pathname, query).then(function (r) {
      if (r.ok) return r;
      if (r.kind === 'BAD_STATUS' && r.status === 404) return { ok: true, degraded: true, capability: name, body: empty };
      return r;
    });
  }

  function capabilities() {
    var now = Date.now();
    if (caps.value && now - caps.at < CAPABILITY_TTL_MS) return Promise.resolve(caps.value);
    if (caps.pending) return caps.pending;
    caps.pending = Promise.all(Object.keys(CAPABILITIES).map(function (name) {
      var q = name === 'quotes' ? { uids: 'capability-probe' } : null;
      return call(CAPABILITIES[name], q).then(function (r) { return { name: name, supported: r.ok ? true : (r.kind === 'BAD_STATUS' && r.status === 404 ? false : null) }; });
    })).then(function (rows) {
      var out = {};
      rows.forEach(function (x) { out[x.name] = x.supported; });
      caps = { at: Date.now(), value: out, pending: null };
      return out;
    }, function () { caps.pending = null; return { 'vehicle-brands': null, quotes: null, 'part-categories': null }; });
    return caps.pending;
  }

  function describe() {
    return call('/api/health').then(function (r) {
      if (!r.ok) return r;
      var h = r.body || {};
      return capabilities().then(function (c) {
        var host = null; try { host = new URL(base).host; } catch (e) { host = null; }
        return { ok: true, data: { key: key, contract: CONTRACT_VERSION, base_host: host, status: h.status || null, read_only: h.read_only !== false, database: typeof h.database === 'string' ? h.database : null, counts: h.counts && typeof h.counts === 'object' ? h.counts : {}, capabilities: c } };
      });
    });
  }

  function searchProducts(p) {
    p = p || {};
    var query = { q: p.q ? String(p.q).slice(0, 120) : undefined, ref: p.ref ? String(p.ref).slice(0, 64) : undefined, category: p.category ? String(p.category).slice(0, 400) : undefined, brand_car: p.brand_car ? String(p.brand_car).slice(0, 64) : undefined, brand: p.brand ? String(p.brand).slice(0, 64) : undefined, model_id: /^\d+$/.test(String(p.model_id || '')) ? String(p.model_id) : undefined, motorization_id: /^\d+$/.test(String(p.motorization_id || '')) ? String(p.motorization_id) : undefined, limit: clampLimit(p.limit, 20), offset: clampOffset(p.offset) };
    return call('/api/products', query).then(function (r) {
      if (!r.ok) return r;
      if (!Array.isArray(r.body.products)) return failure('BAD_PAYLOAD');
      return { ok: true, data: { total: num(r.body.total) === null ? r.body.products.length : num(r.body.total), limit: num(r.body.limit) === null ? query.limit : num(r.body.limit), offset: num(r.body.offset) === null ? query.offset : num(r.body.offset), products: r.body.products.map(product).filter(Boolean) } };
    });
  }

  function getProduct(uid) {
    if (!UID_RE.test(String(uid || ''))) return Promise.resolve(failure('BAD_STATUS', { status: 404, reason: 'NOT_FOUND' }));
    return call('/api/products/' + encodeURIComponent(String(uid))).then(function (r) {
      if (!r.ok) return r.kind === 'BAD_STATUS' && r.status === 404 ? failure('BAD_STATUS', { status: 404, reason: 'NOT_FOUND' }) : r;
      var p = product(r.body);
      if (!p || !p.product_uid) return failure('BAD_PAYLOAD');
      return { ok: true, data: p };
    });
  }

  function listVehicleModels(p) {
    p = p || {};
    return call('/api/vehicle-models', p.brand_car ? { brand_car: String(p.brand_car).slice(0, 64) } : null).then(function (r) {
      if (!r.ok) return r;
      if (!Array.isArray(r.body.vehicle_models)) return failure('BAD_PAYLOAD');
      return { ok: true, data: { vehicle_models: r.body.vehicle_models } };
    });
  }

  function listMotorizations(modelId) {
    if (!/^\d+$/.test(String(modelId || ''))) return Promise.resolve(failure('BAD_STATUS', { status: 404, reason: 'NOT_FOUND' }));
    return call('/api/vehicle-models/' + String(modelId) + '/motorizations').then(function (r) {
      if (!r.ok) return r;
      if (!Array.isArray(r.body.motorizations)) return failure('BAD_PAYLOAD');
      return { ok: true, data: { vehicle_model_id: num(r.body.vehicle_model_id), motorizations: r.body.motorizations } };
    });
  }

  function listPartBrands() {
    return call('/api/brands').then(function (r) {
      if (!r.ok) return r;
      if (!Array.isArray(r.body.brands)) return failure('BAD_PAYLOAD');
      return { ok: true, data: { brands: r.body.brands } };
    });
  }

  function listPartCategories() {
    return capability('part-categories', '/api/part-categories', null, { part_categories: [] }).then(function (r) {
      if (!r.ok) return r;
      if (!Array.isArray(r.body.part_categories)) return failure('BAD_PAYLOAD');
      return { ok: true, degraded: r.degraded === true, data: { part_categories: r.body.part_categories } };
    });
  }

  function listVehicleBrands() {
    return capability('vehicle-brands', '/api/vehicle-brands', null, { vehicle_brands: [] }).then(function (r) {
      if (!r.ok) return r;
      if (!Array.isArray(r.body.vehicle_brands)) return failure('BAD_PAYLOAD');
      return { ok: true, degraded: r.degraded === true, data: { vehicle_brands: r.body.vehicle_brands } };
    });
  }

  // quote(uids) → { requested, quotes:[normalised], missing:[uid], complete } — 1.1 capability; degraded = every uid missing.
  function quote(uids) {
    var list = (Array.isArray(uids) ? uids : String(uids || '').split(',')).map(function (s) { return String(s).trim(); }).filter(function (s) { return UID_RE.test(s); }).slice(0, 50);
    if (!list.length) return Promise.resolve({ ok: true, data: { requested: 0, quotes: [], missing: [], complete: true } });
    return capability('quotes', '/api/quotes', { uids: list.join(',') }, { requested: list.length, quotes: [], missing: list, complete: false }).then(function (r) {
      if (!r.ok) return r;
      if (!Array.isArray(r.body.quotes)) return failure('BAD_PAYLOAD');
      return { ok: true, degraded: r.degraded === true, data: { requested: num(r.body.requested) === null ? list.length : num(r.body.requested), quotes: r.body.quotes.map(product).filter(Boolean), missing: Array.isArray(r.body.missing) ? r.body.missing : [], complete: r.body.complete === true } };
    });
  }

  // availability(uid) → the normalised state of one product (1.0 route, always available).
  function availability(uid) {
    return getProduct(uid).then(function (r) {
      if (!r.ok) return r;
      return { ok: true, data: { product_uid: r.data.product_uid, availability: r.data.availability, availability_raw: r.data.availability_raw, price_tnd: r.data.price_tnd, currency: r.data.currency, as_of: r.data.last_checked_at, source: 'kitchen:catalogue' } };
    });
  }

  return {
    key: key, base_url: base, contract: CONTRACT_VERSION,
    describe: describe, capabilities: capabilities, searchProducts: searchProducts, getProduct: getProduct,
    listVehicleModels: listVehicleModels, listMotorizations: listMotorizations, listPartBrands: listPartBrands,
    listPartCategories: listPartCategories, listVehicleBrands: listVehicleBrands, quote: quote, availability: availability
  };
}

// keyFor(project) → the integration key this project reads, or null when the project has no Kitchen.
//   settings.kitchen = '<key>' → that key; settings.kitchen = null/false → none;
//   unset → the default key for automotive projects only (service / internal / other projects own no catalogue).
function keyFor(project) {
  if (!project) return null;
  var s = project.settings && typeof project.settings === 'object' ? project.settings : {};
  if (s.kitchen === null || s.kitchen === false) return null;
  if (typeof s.kitchen === 'string') return KEY_RE.test(s.kitchen) ? s.kitchen : null;
  return (project.kind || 'automotive') === 'automotive' ? DEFAULT_KEY : null;
}

var rows = Object.create(null); // key → { at, row }
function invalidate() { rows = Object.create(null); }

// forProject(pool, project) → Promise<client | null>  (null = no Kitchen configured / row missing or disabled)
function forProject(pool, project) {
  var key = keyFor(project);
  if (!key) return Promise.resolve(null);
  var c = rows[key];
  var now = Date.now();
  var rowP = c && now - c.at < ROW_TTL_MS ? Promise.resolve(c.row) : pool.query("SELECT key, base_url, status FROM wp_integrations WHERE key = $1 AND kind = 'kitchen'", [key]).then(function (r) { rows[key] = { at: Date.now(), row: r.rows[0] || null }; return r.rows[0] || null; }, function () { return null; });
  return rowP.then(function (row) {
    if (!row || row.status !== 'enabled' || !row.base_url) return null;
    return createClient({ base_url: row.base_url, key: row.key });
  });
}

module.exports = {
  CONTRACT_VERSION: CONTRACT_VERSION, DEFAULT_KEY: DEFAULT_KEY, DEFAULT_BASE: DEFAULT_BASE, TIMEOUT_MS: TIMEOUT_MS,
  AVAILABILITIES: AVAILABILITIES, ERROR_KINDS: ERROR_KINDS, CAPABILITIES: Object.keys(CAPABILITIES),
  normaliseAvailability: normaliseAvailability, product: product, get: get, createClient: createClient, keyFor: keyFor, forProject: forProject, invalidate: invalidate
};
