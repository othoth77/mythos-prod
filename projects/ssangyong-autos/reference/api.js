'use strict';
// =====================================================
// MYTHOS — SsangYong Parts (SSANGYONG.AUTOS) — read-only catalog API
// projects/ssangyong-autos/reference/api.js
// Stage: SYA-API-1 (storefront/API consumption of the live catalog)
//
// WHAT THIS IS
// ------------
// A GET-only HTTP read layer over the live `ssangyong_autos` PostgreSQL
// catalog deployed and validated in SSANGYONG.AUTOS Stage 5 Phase 3
// (5 tables, 1519 rows, 18/18 validation checks pass). It is the first
// runtime consumer of that catalog.
//
// It follows the repository's existing read-API convention — the same
// no-framework `http` + `pg` shape as projects/idauto/reference/api.js
// (IDA-2C), the only REPOSITORY_VERIFIED read-API precedent in this
// codebase. Nothing here is a new architectural pattern.
//
// WHAT THIS IS NOT — AND WHY (do not "fix" these by widening scope)
// -----------------------------------------------------------------
//  * NOT coupled to the legacy ssangyong.autos MariaDB site. That site
//    (/var/www/ssangyong.autos, api/catalog.php, pro/*.php, MySQL tables
//    models/categories/subcategories/products/product_images) is a
//    SEPARATE system with a SEPARATE data model. MYTHOS_SSANGYONG_DATA_
//    MIGRATION_AND_RESUME_PLAN.md §21 freezes it: "no reads/writes/schema
//    changes from this workstream", and "Mythos is a separate system
//    (Postgres) with no coupling to the MariaDB website." This file honours
//    that: it opens no MySQL connection and reads no legacy file.
//
//  * NOT a decision on how the catalog reaches a shopfront. That plan's §22
//    lists three options — (1) the website reads this API directly,
//    (2) a scheduled Postgres→MariaDB export, (3) a new storefront that
//    consumes Mythos natively — and states explicitly that they are
//    "options, not decisions ... decide post-migration". All three need a
//    read layer over the live catalog; that shared prerequisite is what
//    this stage builds. Choosing among them, and any public exposure that
//    follows, remains an owner decision.
//
//  * NOT deployed and NOT publicly exposed. It binds 127.0.0.1 only, no
//    nginx server block references it, and no process manager starts it.
//    Publishing it is a separate, explicitly-ordered deployment stage.
//
//  * NOT a write path. db.js opens every connection with
//    `default_transaction_read_only=on`, so the server refuses writes on
//    this pool regardless of what any caller asks for.
//
// AUTHENTICATION — deliberately none
// ----------------------------------
// This mirrors the contract the existing SSANGYONG storefront API already
// states for itself ("API publique du catalogue — lecture seule, sans
// authentification"). The data is public product data scraped from a public
// catalogue: no PII column, no secret column, no owner data — see
// database/schema.sql ("No secret-value columns. No PII columns."). Because
// there is nothing to authorise, an auth gate here would add a credential to
// manage without protecting anything. That reasoning holds only while the
// surface stays read-only and PII-free; a future write route MUST bring its
// own gate rather than reuse this one.
//
// RUN
// ---
//   env SSANGYONG_DB_HOST=... SSANGYONG_DB_PORT=... SSANGYONG_DB_USER=... \
//       SSANGYONG_DB_PASSWORD=... SSANGYONG_DB_NAME=... \
//       node projects/ssangyong-autos/reference/api.js
// =====================================================

var http = require('http');
var url = require('url');
var fs = require('fs');
var path = require('path');
var db = require('./db.js');

// Bounds on the only client-controlled sizing parameter. 200 keeps the
// worst-case response well under a megabyte at the current 346-product
// catalog while still allowing a client to page efficiently.
var DEFAULT_LIMIT = 50;
var MAX_LIMIT = 200;

// Upper bound on /api/quotes. A storefront cart is the only caller and the
// Piece.Autos cart is capped at 30 distinct products, so 50 leaves headroom
// without turning this into a bulk-export route: a caller wanting the whole
// catalogue must page /api/products like everyone else.
var MAX_QUOTE_UIDS = 50;

// The single definition of "this part is currently in the catalogue".
//
// database/schema.sql's status domain is ('active','updated','inactive',
// 'delisted') and the value comes straight from the scraper's own status
// column (see migration/generate_import.py, which validates it against that
// same domain). 'updated' means a re-scrape confirmed the row and changed
// something — it is a current, sellable part, not a withdrawn one. Filtering
// on 'active' alone silently drops the 2 rows that currently carry 'updated'
// and makes facet counts disagree with list totals. Only 'inactive' and
// 'delisted' are withheld, and that decision lives here once so every
// endpoint's count and page agree by construction.
var LIVE_STATUS = "status IN ('active', 'updated')";

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    // Catalog data changes only when the scraper re-runs; a short cache is
    // safe and keeps a storefront from hammering the database per page view.
    'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store'
  });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  sendJson(res, 404, { error: 'not found' });
}

function badRequest(message) {
  return Object.assign(new Error(message), { httpStatus: 400 });
}

function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch (err) {
    throw badRequest('invalid URL encoding');
  }
}

// A NUMERIC(8,2) column arrives from `pg` as an exact decimal string. It is
// returned unchanged, on purpose: coercing it to a JS float would introduce a
// rounding step the database deliberately does not have. Clients that need a
// number should parse it at the point of display.
function toInt(value) {
  return parseInt(value, 10);
}

// ---------------------------------------------------------------------------
// Query-parameter parsing — every value is validated before it reaches SQL,
// and every SQL value is passed as a bound parameter, never interpolated.
// ---------------------------------------------------------------------------

function parsePositiveInt(raw, label) {
  if (/^\d+$/.test(raw) === false) throw badRequest(label + ' must be a non-negative integer');
  var n = parseInt(raw, 10);
  if (!Number.isSafeInteger(n)) throw badRequest(label + ' is out of range');
  return n;
}

// A vehicle manufacturer name as the catalog stores it ('SSANGYONG'). Compared
// case-insensitively because it is a human-facing label, not an identifier, and
// bounded in length so a pathological value cannot reach the database.
function parseBrandCar(q) {
  if (q === undefined || q.brand_car === undefined) return null;
  var raw = String(q.brand_car).trim();
  if (raw === '') return null;
  if (raw.length > 64) throw badRequest('brand_car must be at most 64 characters');
  return raw;
}

function parsePaging(q) {
  var limit = DEFAULT_LIMIT;
  var offset = 0;
  if (q.limit !== undefined) {
    limit = parsePositiveInt(q.limit, 'limit');
    if (limit < 1 || limit > MAX_LIMIT) throw badRequest('limit must be between 1 and ' + MAX_LIMIT);
  }
  if (q.offset !== undefined) offset = parsePositiveInt(q.offset, 'offset');
  return { limit: limit, offset: offset };
}

// ---------------------------------------------------------------------------
// GET /api/health
// Identity + live row counts. Cheap enough to be a real liveness probe at
// this catalog size, and it proves the connection is genuinely read-only.
// ---------------------------------------------------------------------------
async function getHealth(res) {
  var result = await db.query(
    'SELECT current_database() AS database, current_schema() AS schema, ' +
    "current_setting('transaction_read_only') AS read_only, " +
    '(SELECT count(*) FROM sya_products) AS products, ' +
    '(SELECT count(*) FROM sya_vehicle_models) AS vehicle_models, ' +
    '(SELECT count(*) FROM sya_vehicle_motorizations) AS vehicle_motorizations, ' +
    '(SELECT count(*) FROM sya_product_vehicle_compatibility) AS compatibility, ' +
    '(SELECT count(*) FROM sya_product_images) AS product_images'
  );
  var row = result.rows[0];
  sendJson(res, 200, {
    status: 'ok',
    database: row.database,
    schema: row.schema,
    read_only: row.read_only === 'on',
    counts: {
      products: toInt(row.products),
      vehicle_models: toInt(row.vehicle_models),
      vehicle_motorizations: toInt(row.vehicle_motorizations),
      compatibility: toInt(row.compatibility),
      product_images: toInt(row.product_images)
    }
  });
}

// ---------------------------------------------------------------------------
// GET /api/vehicle-brands                                            (SYA-API-2)
//
// The vehicle-manufacturer facet. Added because a multi-brand consumer
// otherwise has to fetch every model and derive the brand list client-side —
// correct at today's 17 models, wrong at any real multi-brand scale, and a
// derivation each consumer would have to repeat identically.
//
// `brand_car` lives on sya_vehicle_models, so this is a facet over an existing
// column: no new table, no new taxonomy. The catalog holds one brand today
// (all 17 models are SSANGYONG); this endpoint reports what is there rather
// than implying more.
// ---------------------------------------------------------------------------
async function getVehicleBrands(res) {
  var result = await db.query(
    'SELECT m.brand_car, ' +
    '  count(DISTINCT m.id) AS model_count, ' +
    '  (SELECT count(DISTINCT c.product_id) FROM sya_product_vehicle_compatibility c ' +
    '   JOIN sya_products p ON p.id = c.product_id AND p.' + LIVE_STATUS + ' ' +
    '   JOIN sya_vehicle_models m2 ON m2.id = c.vehicle_model_id ' +
    '   WHERE m2.brand_car = m.brand_car) AS product_count ' +
    'FROM sya_vehicle_models m ' +
    'GROUP BY m.brand_car ' +
    'ORDER BY m.brand_car ASC'
  );
  sendJson(res, 200, {
    vehicle_brands: result.rows.map(function (r) {
      return {
        brand_car: r.brand_car,
        model_count: toInt(r.model_count),
        product_count: toInt(r.product_count)
      };
    })
  });
}

// ---------------------------------------------------------------------------
// GET /api/vehicle-models[?brand_car=...]
// The storefront's top-level browse axis: pick your SsangYong, then its
// engine. Ordered by name then generation so the list is stable.
//
// `brand_car` is optional and additive: omitting it returns every model, which
// is exactly what this route did before SYA-API-2, so existing consumers are
// unaffected. An unknown brand returns an empty list, not a 404 — asking
// "which RENAULT models do you have?" is a valid question with the answer
// "none", and that is not the same as a missing endpoint.
// ---------------------------------------------------------------------------
async function getVehicleModels(res, q) {
  var params = [];
  var where = '';
  var brand = parseBrandCar(q);
  if (brand !== null) {
    params.push(brand);
    where = 'WHERE upper(m.brand_car) = upper($1) ';
  }
  var result = await db.query(
    'SELECT m.id, m.brand_car, m.model_name, m.generation_code, m.year_from, m.year_to, m.model_url, ' +
    '  (SELECT count(*) FROM sya_vehicle_motorizations mo WHERE mo.vehicle_model_id = m.id) AS motorization_count, ' +
    '  (SELECT count(DISTINCT c.product_id) FROM sya_product_vehicle_compatibility c ' +
    '   JOIN sya_products p ON p.id = c.product_id AND p.' + LIVE_STATUS + ' ' +
    '   WHERE c.vehicle_model_id = m.id) AS product_count ' +
    'FROM sya_vehicle_models m ' + where +
    'ORDER BY m.model_name ASC, m.generation_code ASC NULLS FIRST',
    params
  );
  sendJson(res, 200, {
    vehicle_models: result.rows.map(function (r) {
      return {
        id: toInt(r.id),
        brand_car: r.brand_car,
        model_name: r.model_name,
        generation_code: r.generation_code,
        year_from: r.year_from,
        year_to: r.year_to,
        model_url: r.model_url,
        motorization_count: toInt(r.motorization_count),
        product_count: toInt(r.product_count)
      };
    })
  });
}

// ---------------------------------------------------------------------------
// GET /api/vehicle-models/:id/motorizations
// 404s on an unknown model id rather than returning an empty list, so a
// caller can tell "no such model" from "model with no motorizations".
// ---------------------------------------------------------------------------
async function getModelMotorizations(res, rawId) {
  var id = parsePositiveInt(rawId, 'vehicle model id');
  var model = await db.query('SELECT id FROM sya_vehicle_models WHERE id = $1', [id]);
  if (model.rows.length === 0) return notFound(res);

  var result = await db.query(
    'SELECT mo.id, mo.vehicle_model_id, mo.motorisation, mo.year_from, mo.year_to, mo.power, mo.fuel, mo.motorisation_url, ' +
    '  (SELECT count(DISTINCT c.product_id) FROM sya_product_vehicle_compatibility c ' +
    '   JOIN sya_products p ON p.id = c.product_id AND p.' + LIVE_STATUS + ' ' +
    '   WHERE c.vehicle_motorization_id = mo.id) AS product_count ' +
    'FROM sya_vehicle_motorizations mo WHERE mo.vehicle_model_id = $1 ' +
    'ORDER BY mo.motorisation ASC, mo.year_from ASC NULLS FIRST',
    [id]
  );
  sendJson(res, 200, {
    vehicle_model_id: id,
    motorizations: result.rows.map(function (r) {
      return {
        id: toInt(r.id),
        vehicle_model_id: toInt(r.vehicle_model_id),
        motorisation: r.motorisation,
        year_from: r.year_from,
        year_to: r.year_to,
        power: r.power,
        fuel: r.fuel,
        motorisation_url: r.motorisation_url,
        product_count: toInt(r.product_count)
      };
    })
  });
}

// ---------------------------------------------------------------------------
// GET /api/brands
// Facet list for the catalogue filter bar. sya_products_brand_idx exists for
// exactly this access path.
// ---------------------------------------------------------------------------
async function getBrands(res) {
  var result = await db.query(
    'SELECT product_brand, count(*) AS product_count FROM sya_products ' +
    'WHERE ' + LIVE_STATUS + ' GROUP BY product_brand ORDER BY product_brand ASC'
  );
  sendJson(res, 200, {
    brands: result.rows.map(function (r) {
      return { product_brand: r.product_brand, product_count: toInt(r.product_count) };
    })
  });
}

// ---------------------------------------------------------------------------
// GET /api/products
//   ?q=            free text over title / canonical reference / OEM reference
//   ?brand=        exact product_brand
//   ?model_id=     products fitting this vehicle model
//   ?motorization_id= products fitting this specific motorization
//   ?limit= &offset=
//
// Only LIVE_STATUS rows are exposed — a withdrawn part must never surface in
// a storefront, so the filter is applied here rather than left to the caller.
// Filters are composed into a shared WHERE so that the count and the page
// come from identical predicates — a count that disagrees with its own page
// is the classic pagination bug.
// ---------------------------------------------------------------------------
async function getProducts(res, q) {
  var paging = parsePaging(q);
  var where = ['p.' + LIVE_STATUS];
  var params = [];

  if (q.q !== undefined && String(q.q).trim() !== '') {
    params.push('%' + String(q.q).trim() + '%');
    var i = params.length;
    where.push('(p.product_title ILIKE $' + i + ' OR p.canonical_reference ILIKE $' + i +
               ' OR p.oem_reference ILIKE $' + i + ')');
  }
  if (q.brand !== undefined && String(q.brand).trim() !== '') {
    params.push(String(q.brand).trim());
    where.push('p.product_brand = $' + params.length);
  }
  if (q.model_id !== undefined) {
    params.push(parsePositiveInt(q.model_id, 'model_id'));
    where.push('EXISTS (SELECT 1 FROM sya_product_vehicle_compatibility c ' +
               'WHERE c.product_id = p.id AND c.vehicle_model_id = $' + params.length + ')');
  }
  if (q.motorization_id !== undefined) {
    params.push(parsePositiveInt(q.motorization_id, 'motorization_id'));
    where.push('EXISTS (SELECT 1 FROM sya_product_vehicle_compatibility c ' +
               'WHERE c.product_id = p.id AND c.vehicle_motorization_id = $' + params.length + ')');
  }
  // Vehicle manufacturer (SYA-API-2). Reaches brand_car through the fitment
  // edge, which is the only relationship between a part and a vehicle brand
  // that the catalog actually models — a part has no brand_car column of its
  // own, and inventing one would be a second taxonomy.
  var brandCar = parseBrandCar(q);
  if (brandCar !== null) {
    params.push(brandCar);
    where.push('EXISTS (SELECT 1 FROM sya_product_vehicle_compatibility c ' +
               'JOIN sya_vehicle_models m ON m.id = c.vehicle_model_id ' +
               'WHERE c.product_id = p.id AND upper(m.brand_car) = upper($' + params.length + '))');
  }

  var whereSql = 'WHERE ' + where.join(' AND ');

  var countResult = await db.query('SELECT count(*) AS total FROM sya_products p ' + whereSql, params);

  var pageParams = params.concat([paging.limit, paging.offset]);
  var result = await db.query(
    'SELECT p.product_uid, p.product_brand, p.canonical_reference, p.product_title, p.oem_reference, ' +
    '  p.availability, p.price_tnd, p.currency, p.product_url, p.last_checked_at, ' +
    '  (SELECT im.image_url FROM sya_product_images im WHERE im.product_id = p.id ' +
    '   ORDER BY im.position ASC, im.id ASC LIMIT 1) AS main_image_url ' +
    'FROM sya_products p ' + whereSql + ' ' +
    'ORDER BY p.product_brand ASC, p.canonical_reference ASC ' +
    'LIMIT $' + (pageParams.length - 1) + ' OFFSET $' + pageParams.length,
    pageParams
  );

  sendJson(res, 200, {
    total: toInt(countResult.rows[0].total),
    limit: paging.limit,
    offset: paging.offset,
    products: result.rows
  });
}

// ---------------------------------------------------------------------------
// GET /api/products/:product_uid
// Addressed by product_uid ('autopart.tn:<fiche-id>'), never by the BIGSERIAL
// id. database/schema.sql states the rule directly: the serial is internal and
// "external systems never depend on the serial value".
// ---------------------------------------------------------------------------
async function getProduct(res, productUid) {
  var result = await db.query(
    'SELECT id, product_uid, source, product_brand, canonical_reference, product_title, oem_reference, ' +
    '  pair_reference, criteria_text, technical_specs, availability, price_tnd, currency, delivery_note, ' +
    '  product_url, status, collected_at, last_checked_at ' +
    'FROM sya_products WHERE product_uid = $1',
    [productUid]
  );
  if (result.rows.length === 0) return notFound(res);
  var product = result.rows[0];
  // Hide only the internal serial; every other column above is public
  // catalogue data.
  var internalId = product.id;
  delete product.id;

  var images = await db.query(
    'SELECT image_url, image_alt, image_filename, position FROM sya_product_images ' +
    'WHERE product_id = $1 ORDER BY position ASC, id ASC',
    [internalId]
  );

  var compatibility = await db.query(
    'SELECT c.vehicle_model_id, m.model_name, m.generation_code, c.vehicle_motorization_id, ' +
    '  c.motorisation, c.year_from, c.year_to ' +
    'FROM sya_product_vehicle_compatibility c ' +
    'JOIN sya_vehicle_models m ON m.id = c.vehicle_model_id ' +
    'WHERE c.product_id = $1 ' +
    'ORDER BY m.model_name ASC, c.motorisation ASC, c.year_from ASC NULLS FIRST',
    [internalId]
  );

  product.images = images.rows;
  product.compatibility = compatibility.rows.map(function (r) {
    return {
      vehicle_model_id: toInt(r.vehicle_model_id),
      model_name: r.model_name,
      generation_code: r.generation_code,
      vehicle_motorization_id: r.vehicle_motorization_id === null ? null : toInt(r.vehicle_motorization_id),
      motorisation: r.motorisation,
      year_from: r.year_from,
      year_to: r.year_to
    };
  });

  sendJson(res, 200, product);
}

// ---------------------------------------------------------------------------
// GET /api/quotes?uids=a,b,c                                        (SYA-API-2)
//
// Price and availability for several products in ONE request.
//
// Why it exists: a storefront must re-read price and availability from the
// catalog immediately before it turns a cart into an order — the browser's
// copy is never authoritative. Without this route the only way to do that is
// GET /api/products/:uid per line, and each of those runs three queries
// (product, images, compatibility) to return a full document of which the
// caller needs three fields. A five-line cart therefore cost 5 round trips and
// 15 queries; it now costs 1 and 1.
//
// PARTIAL RESULTS ARE EXPLICIT. A uid that is unknown, inactive or delisted is
// not silently dropped from `quotes` — it is named in `missing`. Silence would
// be indistinguishable from "this part is free" to a careless consumer, and a
// checkout must be able to tell "withdrawn" apart from "not asked for".
// ---------------------------------------------------------------------------
function parseQuoteUids(q) {
  if (q === undefined || q.uids === undefined) throw badRequest('uids is required');
  var raw = String(q.uids);
  if (raw.trim() === '') throw badRequest('uids must not be empty');
  var parts = raw.split(',').map(function (u) { return u.trim(); }).filter(function (u) { return u !== ''; });
  if (parts.length === 0) throw badRequest('uids must not be empty');
  if (parts.length > MAX_QUOTE_UIDS) {
    throw badRequest('uids must contain at most ' + MAX_QUOTE_UIDS + ' identifiers');
  }
  parts.forEach(function (u) {
    if (u.length > 128) throw badRequest('a product_uid must be at most 128 characters');
  });
  // De-duplicate while preserving the caller's order, so asking for the same
  // uid twice is answered once rather than rejected or double-counted.
  var seen = Object.create(null);
  var unique = [];
  parts.forEach(function (u) { if (!seen[u]) { seen[u] = true; unique.push(u); } });
  return unique;
}

async function getQuotes(res, q) {
  var uids = parseQuoteUids(q);
  var result = await db.query(
    'SELECT product_uid, canonical_reference, product_title, price_tnd, currency, ' +
    '  availability, last_checked_at ' +
    'FROM sya_products WHERE ' + LIVE_STATUS + ' AND product_uid = ANY($1::text[])',
    [uids]
  );

  var byUid = Object.create(null);
  result.rows.forEach(function (r) { byUid[r.product_uid] = r; });

  var quotes = [];
  var missing = [];
  uids.forEach(function (uid) {
    var row = byUid[uid];
    if (!row) { missing.push(uid); return; }
    quotes.push({
      product_uid: row.product_uid,
      canonical_reference: row.canonical_reference,
      product_title: row.product_title,
      // The exact NUMERIC(8,2) decimal string, unchanged — same rule as
      // everywhere else in this API. A consumer that parses it into a float
      // has reintroduced the rounding the database refuses to have.
      price_tnd: row.price_tnd,
      currency: row.currency,
      availability: row.availability,
      last_checked_at: row.last_checked_at
    });
  });

  sendJson(res, 200, {
    requested: uids.length,
    quotes: quotes,
    missing: missing,
    // When the caller asked for something this catalogue cannot price, say so
    // in the envelope as well as in `missing`, so a consumer cannot treat a
    // partial answer as a complete one by only reading `quotes`.
    complete: missing.length === 0
  });
}

// ---------------------------------------------------------------------------
// Storefront assets (SYA-SHOP-1)
//
// Serving the storefront from this same process is what migration-plan §22
// option 3 — ratified 2026-08-16, "new storefront consumes Mythos natively" —
// makes possible: the page and its data share an origin, so the API needs no
// public exposure and no CORS of its own. Same static-asset-map convention as
// projects/idauto/reference/api.js.
//
// The catalogue pages carry no credential and no user input of any kind. The
// CSP below is default-deny with one deliberate exception: product photography
// is hosted on autopart.tn, the catalog's source site, and `image_url` values
// are constrained at the schema level to `^https://`.
// ---------------------------------------------------------------------------

var SHOP_ASSETS = {
  '/': { file: 'shop.html', contentType: 'text/html; charset=utf-8' },
  '/index.html': { file: 'shop.html', contentType: 'text/html; charset=utf-8' },
  '/shop.css': { file: 'shop.css', contentType: 'text/css; charset=utf-8' },
  '/shop-ui.js': { file: 'shop-ui.js', contentType: 'application/javascript; charset=utf-8' }
};

var SHOP_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; " +
               "img-src 'self' https://autopart.tn; connect-src 'self'; " +
               "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function serveShopAsset(req, res, pathname) {
  var asset = SHOP_ASSETS[pathname];
  if (!asset) return false;
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Allow': 'GET' });
    res.end(JSON.stringify({ error: 'method not allowed' }));
    return true;
  }
  fs.readFile(path.join(__dirname, asset.file), function (err, content) {
    if (err) return sendJson(res, 500, { error: 'storefront unavailable' });
    res.writeHead(200, {
      'Content-Type': asset.contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': SHOP_CSP
    });
    res.end(content);
  });
  return true;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

var ROUTES = [
  { method: 'GET', pattern: /^\/api\/health$/, handler: function (req, res) { return getHealth(res); } },
  { method: 'GET', pattern: /^\/api\/vehicle-brands$/, handler: function (req, res) { return getVehicleBrands(res); } },
  { method: 'GET', pattern: /^\/api\/vehicle-models$/, handler: function (req, res, m, q) { return getVehicleModels(res, q); } },
  { method: 'GET', pattern: /^\/api\/vehicle-models\/([^/]+)\/motorizations$/, handler: function (req, res, m) { return getModelMotorizations(res, decodePathSegment(m[1])); } },
  { method: 'GET', pattern: /^\/api\/brands$/, handler: function (req, res) { return getBrands(res); } },
  { method: 'GET', pattern: /^\/api\/quotes$/, handler: function (req, res, m, q) { return getQuotes(res, q); } },
  { method: 'GET', pattern: /^\/api\/products$/, handler: function (req, res, m, q) { return getProducts(res, q); } },
  { method: 'GET', pattern: /^\/api\/products\/([^/]+)$/, handler: function (req, res, m) { return getProduct(res, decodePathSegment(m[1])); } }
];

function createServer() {
  return http.createServer(function (req, res) {
    var parsed = url.parse(req.url, true);
    var pathname = parsed.pathname;

    if (serveShopAsset(req, res, pathname)) return;

    var matchedPath = ROUTES.filter(function (r) { return r.pattern.test(pathname); });
    if (matchedPath.length === 0) return notFound(res);

    var matchedMethod = matchedPath.filter(function (r) { return r.method === req.method; });
    if (matchedMethod.length === 0) {
      var allowed = matchedPath.map(function (r) { return r.method; }).join(', ');
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Allow': allowed });
      return res.end(JSON.stringify({ error: 'method not allowed' }));
    }

    var route = matchedMethod[0];
    var m = pathname.match(route.pattern);
    Promise.resolve().then(function () { return route.handler(req, res, m, parsed.query); }).catch(function (err) {
      if (err.httpStatus) return sendJson(res, err.httpStatus, { error: err.message });
      // The raw driver message can echo query fragments or connection detail
      // back to an unauthenticated caller, so it never leaves the process.
      sendJson(res, 500, { error: 'internal error' });
    });
  });
}

// Binds loopback only. Exposing this beyond 127.0.0.1 is a deployment
// decision that belongs to a later, explicitly-ordered stage — see the
// §22 note in this file's header.
if (require.main === module) {
  var port = parseInt(process.env.SSANGYONG_API_PORT || '3011', 10);
  createServer().listen(port, '127.0.0.1', function () {
    console.log('SSANGYONG.AUTOS catalog API + storefront listening on http://127.0.0.1:' + port);
  });
}

module.exports = {
  createServer: createServer,
  DEFAULT_LIMIT: DEFAULT_LIMIT,
  MAX_LIMIT: MAX_LIMIT,
  MAX_QUOTE_UIDS: MAX_QUOTE_UIDS,
  SHOP_ASSETS: SHOP_ASSETS,
  SHOP_CSP: SHOP_CSP
};
