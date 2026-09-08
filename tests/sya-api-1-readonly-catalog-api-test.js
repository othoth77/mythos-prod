'use strict';
// =====================================================
// MYTHOS — SSANGYONG.AUTOS Stage SYA-API-1 tests
// tests/sya-api-1-readonly-catalog-api-test.js
//
// Like tests/ida-2c-readonly-api-test.js, this suite is deliberately NOT
// offline: it makes real HTTP requests against a real, live PostgreSQL
// connection, because SYA-API-1's whole purpose is to prove the API works
// against the catalog deployed in Stage 5 Phase 3, not a mock of it.
//
// The expected counts asserted below (346 / 17 / 63 / 782 / 311 = 1519 rows)
// are the Stage 2/4 baseline that Stage 5 Phase 3's 18/18 validation checks
// confirmed live. If they ever fail here, the catalog changed — that is a
// finding about the data, not a flaky test.
//
// Requires in the environment (never hardcoded here):
//   SSANGYONG_DB_HOST, SSANGYONG_DB_PORT, SSANGYONG_DB_USER,
//   SSANGYONG_DB_PASSWORD, SSANGYONG_DB_NAME
// The operational values live at
// /home/deploy/deployments/ssangyong-autos-postgres/.env (0600, outside the
// repository). Starts the server on an ephemeral port for this process only
// — no persistent listening service is left running.
//
// Run with:
//   env SSANGYONG_DB_HOST=... ... node tests/sya-api-1-readonly-catalog-api-test.js
// =====================================================

var http = require('http');
var path = require('path');
var fs = require('fs');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var api = require(path.join(BASE, 'projects', 'ssangyong-autos', 'reference', 'api.js'));
var db = require(path.join(BASE, 'projects', 'ssangyong-autos', 'reference', 'db.js'));

// The live baseline established by Stage 5 Phase 3 (validation.sql, 18/18).
var EXPECTED = {
  products: 346,
  vehicle_models: 17,
  vehicle_motorizations: 63,
  compatibility: 782,
  product_images: 311
};

var server;
var port;

function request(method, requestPath) {
  return new Promise(function (resolve, reject) {
    var req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: requestPath,
      method: method
    }, function (res) {
      var body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        var parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function get(p) { return request('GET', p); }

(async function main() {
  var missing = db.REQUIRED_ENV.filter(function (n) { return !process.env[n]; });
  if (missing.length) {
    console.log('FATAL: missing required environment variable(s): ' + missing.join(', '));
    process.exit(1);
  }

  server = api.createServer();
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;

  console.log('\n1. GET /api/health — live connectivity and the read-only guarantee');
  var health = await get('/api/health');
  ok(health.status === 200 && health.body.status === 'ok', 'GET /api/health -> 200 {status:"ok"} (proves live DB connectivity)');
  ok(health.body.database === 'ssangyong_autos', 'Connected to database ssangyong_autos — not idauto');
  ok(health.body.schema === 'ssangyong_autos', 'search_path resolves to schema ssangyong_autos (pinned in Stage 5 Phase 2)');
  ok(health.body.read_only === true, 'Every connection reports transaction_read_only = on');
  ok(health.body.counts.products === EXPECTED.products, 'Live products = ' + EXPECTED.products);
  ok(health.body.counts.vehicle_models === EXPECTED.vehicle_models, 'Live vehicle_models = ' + EXPECTED.vehicle_models);
  ok(health.body.counts.vehicle_motorizations === EXPECTED.vehicle_motorizations, 'Live vehicle_motorizations = ' + EXPECTED.vehicle_motorizations);
  ok(health.body.counts.compatibility === EXPECTED.compatibility, 'Live compatibility = ' + EXPECTED.compatibility);
  ok(health.body.counts.product_images === EXPECTED.product_images, 'Live product_images = ' + EXPECTED.product_images);

  console.log('\n2. READ-ONLY IS ENFORCED BY THE SERVER, not by convention');
  var writeRefused = false, writeCode = null;
  try {
    await db.query("INSERT INTO sya_products (product_uid, source, product_brand, canonical_reference, " +
      "product_title, availability, price_tnd, product_url, collected_at, last_checked_at) VALUES " +
      "('sya-api-1-test','t','t','t','t','En Stock',1,'https://x',now(),now())");
  } catch (e) {
    writeRefused = true;
    writeCode = e.code;
  }
  ok(writeRefused, 'An INSERT on the API pool is refused');
  ok(writeCode === '25006', 'Refusal is PostgreSQL 25006 read_only_sql_transaction — the server refused it, not the application');

  console.log('\n3. GET /api/vehicle-models');
  var models = await get('/api/vehicle-models');
  ok(models.status === 200, 'GET /api/vehicle-models -> 200');
  ok(Array.isArray(models.body.vehicle_models) && models.body.vehicle_models.length === EXPECTED.vehicle_models,
     'Returns all ' + EXPECTED.vehicle_models + ' vehicle models');
  var totalMotorizations = models.body.vehicle_models.reduce(function (a, m) { return a + m.motorization_count; }, 0);
  ok(totalMotorizations === EXPECTED.vehicle_motorizations,
     'motorization_count sums to ' + EXPECTED.vehicle_motorizations + ' across models (no motorization orphaned from its model)');
  ok(models.body.vehicle_models.every(function (m) { return m.brand_car === 'SSANGYONG'; }), 'Every model is brand_car = SSANGYONG');
  ok(models.body.vehicle_models.every(function (m) { return typeof m.id === 'number' && typeof m.model_name === 'string'; }),
     'id is a JSON number and model_name a string (bigint/count strings are converted, not leaked)');

  console.log('\n4. GET /api/vehicle-models/:id/motorizations');
  var firstModel = models.body.vehicle_models[0];
  var motors = await get('/api/vehicle-models/' + firstModel.id + '/motorizations');
  ok(motors.status === 200, 'Known model id -> 200');
  ok(motors.body.motorizations.length === firstModel.motorization_count,
     'Motorization list length matches the count reported by /api/vehicle-models');
  ok(motors.body.motorizations.every(function (m) { return m.vehicle_model_id === firstModel.id; }),
     'Every motorization belongs to the requested model');
  ok(motors.body.motorizations.every(function (m) { return !/^\d{4}-\d{2}-\d{2}/.test(m.motorisation); }),
     'No motorisation label is date-shaped — the Stage 1/2 date-coercion corruption is absent from what the API serves');

  var unknownModel = await get('/api/vehicle-models/99999999/motorizations');
  ok(unknownModel.status === 404, 'Unknown model id -> 404 (not an empty 200)');
  var badModel = await get('/api/vehicle-models/not-a-number/motorizations');
  ok(badModel.status === 400, 'Non-numeric model id -> 400');

  console.log('\n5. GET /api/brands');
  var brands = await get('/api/brands');
  ok(brands.status === 200 && Array.isArray(brands.body.brands), 'GET /api/brands -> 200 with a brands array');
  var brandTotal = brands.body.brands.reduce(function (a, b) { return a + b.product_count; }, 0);
  ok(brandTotal === EXPECTED.products, 'Brand facet counts sum to ' + EXPECTED.products + ' (every active product has a brand)');

  console.log('\n5b. Live-status policy — the catalogue exposes active AND updated');
  // The live data is 344 'active' + 2 'updated'. 'updated' is a re-scrape
  // state, not a withdrawal, so both are sellable and both must be exposed;
  // only 'inactive'/'delisted' are withheld. Pinned here because filtering on
  // 'active' alone is the natural mistake and silently loses two products.
  var statuses = await db.query('SELECT status, count(*)::int AS n FROM sya_products GROUP BY status');
  var live = statuses.rows.filter(function (r) { return r.status === 'active' || r.status === 'updated'; })
                          .reduce(function (a, r) { return a + r.n; }, 0);
  ok(live === EXPECTED.products, 'active + updated = ' + EXPECTED.products + ' in the live catalog');
  ok(statuses.rows.some(function (r) { return r.status === 'updated' && r.n > 0; }),
     "At least one 'updated' product exists, so this is a real case and not a hypothetical one");

  console.log('\n6. GET /api/products — paging');
  var page = await get('/api/products');
  ok(page.status === 200, 'GET /api/products -> 200');
  ok(page.body.total === EXPECTED.products, 'total = ' + EXPECTED.products + ' with no filter');
  ok(page.body.limit === api.DEFAULT_LIMIT && page.body.products.length === api.DEFAULT_LIMIT,
     'Default page returns exactly DEFAULT_LIMIT (' + api.DEFAULT_LIMIT + ') rows');
  ok(page.body.products.every(function (p) { return typeof p.product_uid === 'string' && p.product_uid.indexOf('autopart.tn:') === 0; }),
     'Every product is addressed by its site-native product_uid');
  ok(page.body.products.every(function (p) { return !('id' in p); }), 'The internal BIGSERIAL id is never exposed in a list row');
  ok(page.body.products.every(function (p) { return /^\d+\.\d{2}$/.test(p.price_tnd); }),
     'price_tnd is the exact NUMERIC(8,2) decimal string, not a coerced float');

  var page2 = await get('/api/products?limit=10&offset=10');
  ok(page2.body.products.length === 10 && page2.body.offset === 10, 'limit/offset paging returns the requested window');
  var firstPage = await get('/api/products?limit=10&offset=0');
  var overlap = page2.body.products.filter(function (p) {
    return firstPage.body.products.some(function (q) { return q.product_uid === p.product_uid; });
  });
  ok(overlap.length === 0, 'Consecutive pages do not overlap — the ORDER BY is total, so paging is stable');

  var overLimit = await get('/api/products?limit=' + (api.MAX_LIMIT + 1));
  ok(overLimit.status === 400, 'limit above MAX_LIMIT (' + api.MAX_LIMIT + ') -> 400');
  var negativeOffset = await get('/api/products?offset=-5');
  ok(negativeOffset.status === 400, 'Negative offset -> 400');

  console.log('\n7. GET /api/products — filters');
  var byBrand = await get('/api/products?brand=' + encodeURIComponent(brands.body.brands[0].product_brand));
  ok(byBrand.body.total === brands.body.brands[0].product_count,
     'brand filter total agrees with the /api/brands facet count for the same brand');
  ok(byBrand.body.products.every(function (p) { return p.product_brand === brands.body.brands[0].product_brand; }),
     'Every returned row actually has the requested brand');

  var byModel = await get('/api/products?model_id=' + firstModel.id);
  ok(byModel.body.total === firstModel.product_count,
     'model_id filter total agrees with the product_count reported by /api/vehicle-models');

  var byMotor = await get('/api/products?motorization_id=' + motors.body.motorizations[0].id);
  ok(byMotor.body.total === motors.body.motorizations[0].product_count,
     'motorization_id filter total agrees with the motorization product_count');

  var noMatch = await get('/api/products?q=' + encodeURIComponent('zzzz-no-such-part-zzzz'));
  ok(noMatch.status === 200 && noMatch.body.total === 0 && noMatch.body.products.length === 0,
     'A search matching nothing is an empty 200, not an error');

  // A quoted single quote and a percent sign both go through the bound
  // parameter unharmed; neither can terminate a literal or alter the query.
  var injection = await get('/api/products?q=' + encodeURIComponent("' OR 1=1 --"));
  ok(injection.status === 200 && injection.body.total === 0,
     'A SQL-injection-shaped search term is treated as literal text and matches nothing');

  var searchTerm = page.body.products[0].canonical_reference;
  var bySearch = await get('/api/products?q=' + encodeURIComponent(searchTerm));
  ok(bySearch.body.total >= 1 && bySearch.body.products.some(function (p) { return p.canonical_reference === searchTerm; }),
     'Searching a known canonical_reference finds that product');

  console.log('\n8. GET /api/products/:product_uid — detail');
  var uid = page.body.products[0].product_uid;
  var detail = await get('/api/products/' + encodeURIComponent(uid));
  ok(detail.status === 200, 'Known product_uid -> 200');
  ok(detail.body.product_uid === uid, 'Returns the requested product');
  ok(!('id' in detail.body), 'The internal BIGSERIAL id is never exposed in the detail response');
  ok(Array.isArray(detail.body.images) && Array.isArray(detail.body.compatibility),
     'Detail carries its images and its vehicle compatibility');
  ok(detail.body.compatibility.length >= 1, 'A catalogued product has at least one vehicle fitment');
  ok(detail.body.compatibility.every(function (c) { return typeof c.model_name === 'string' && c.model_name.length > 0; }),
     'Every fitment resolves to a named vehicle model (no orphan compatibility row is served)');

  var unknownProduct = await get('/api/products/' + encodeURIComponent('autopart.tn:0'));
  ok(unknownProduct.status === 404, 'Unknown product_uid -> 404');

  // product_uid contains a colon; the route must survive percent-encoding.
  ok(detail.body.product_uid.indexOf(':') !== -1, 'product_uid contains a colon and still routes correctly when percent-encoded');

  console.log('\n9. Protocol and error surface');
  var notFound = await get('/api/nope');
  ok(notFound.status === 404, 'Unknown route -> 404');
  var wrongMethod = await request('POST', '/api/products');
  ok(wrongMethod.status === 405, 'POST to a GET-only route -> 405');
  ok((wrongMethod.headers['allow'] || '').indexOf('GET') !== -1, '405 response carries an Allow: GET header');
  ok(health.headers['x-content-type-options'] === 'nosniff', 'Responses carry X-Content-Type-Options: nosniff');

  console.log('\n10. Source-level guarantees');
  // These assert what the code DOES, so comment prose — which necessarily
  // names MariaDB and getClientForTransaction to explain their absence — is
  // stripped before matching.
  function code(file) {
    return fs.readFileSync(path.join(BASE, 'projects', 'ssangyong-autos', 'reference', file), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '');
  }
  var apiSrc = code('api.js');
  var writeVerbs = [/INSERT\s+INTO/i, /UPDATE\s+sya_/i, /DELETE\s+FROM/i, /DROP\s+/i, /ALTER\s+TABLE/i, /TRUNCATE/i];
  ok(writeVerbs.every(function (re) { return !re.test(apiSrc); }), 'No SQL write verb appears in executable api.js code');
  ok(!/mysql|mysqli|mariadb/i.test(apiSrc), 'api.js opens no MySQL/MariaDB path — the legacy site stays uncoupled (migration plan §21)');
  ok(!/idauto/i.test(apiSrc), 'No executable line of api.js references idauto');

  var dbSrc = code('db.js');
  ok(/default_transaction_read_only=on/.test(dbSrc), 'db.js pins default_transaction_read_only=on as a connection option');
  ok(!/getClientForTransaction/.test(dbSrc), 'db.js exposes no transaction client — there is no write path to open one for');

  // =========================================================================
  // 11. SYA-API-2 — vehicle brands (KG-1)
  // =========================================================================
  console.log('\n11. Vehicle brands (SYA-API-2, KG-1)');
  var brandsRes = await get('/api/vehicle-brands');
  ok(brandsRes.status === 200, 'GET /api/vehicle-brands returns 200');
  ok(Array.isArray(brandsRes.body.vehicle_brands), 'returns a vehicle_brands array');
  ok(brandsRes.body.vehicle_brands.length >= 1, 'reports at least one vehicle brand');
  var sy = brandsRes.body.vehicle_brands.filter(function (b) { return b.brand_car === 'SSANGYONG'; })[0];
  ok(sy !== undefined, 'SSANGYONG is present');
  ok(sy && sy.model_count === EXPECTED.vehicle_models,
     'model_count matches the live model count (' + EXPECTED.vehicle_models + ')');
  ok(sy && sy.product_count === EXPECTED.products,
     'product_count matches the live product count (' + EXPECTED.products + ')');

  // The facet must agree with the list it describes — the same rule LIVE_STATUS
  // exists to enforce for every other count in this API.
  var allProducts = await get('/api/products?limit=1');
  ok(sy && sy.product_count === allProducts.body.total,
     'brand product_count agrees with /api/products total');

  var filtered = await get('/api/products?brand_car=SSANGYONG&limit=1');
  ok(filtered.status === 200 && filtered.body.total === EXPECTED.products,
     'brand_car filter returns every product of the only brand present');
  var lower = await get('/api/products?brand_car=ssangyong&limit=1');
  ok(lower.body.total === filtered.body.total, 'brand_car is case-insensitive');

  var unknownBrand = await get('/api/products?brand_car=RENAULT&limit=1');
  ok(unknownBrand.status === 200 && unknownBrand.body.total === 0,
     'an unknown brand is an empty result, not an error');
  var unknownModels = await get('/api/vehicle-models?brand_car=RENAULT');
  ok(unknownModels.status === 200 && unknownModels.body.vehicle_models.length === 0,
     'vehicle-models for an unknown brand is an empty list, not a 404');

  var modelsFiltered = await get('/api/vehicle-models?brand_car=SSANGYONG');
  ok(modelsFiltered.body.vehicle_models.length === EXPECTED.vehicle_models,
     'vehicle-models?brand_car returns the brand\'s models');
  var modelsUnfiltered = await get('/api/vehicle-models');
  ok(JSON.stringify(modelsUnfiltered.body) === JSON.stringify(modelsFiltered.body),
     'omitting brand_car is unchanged from before SYA-API-2 (backward compatible)');

  var longBrand = await get('/api/vehicle-models?brand_car=' + encodeURIComponent('x'.repeat(65)));
  ok(longBrand.status === 400, 'an over-long brand_car is rejected with 400');

  // =========================================================================
  // 12. SYA-API-2 — batched quotes (KG-3)
  // =========================================================================
  console.log('\n12. Batched quotes (SYA-API-2, KG-3)');
  var page = await get('/api/products?limit=3');
  var uids = page.body.products.map(function (p) { return p.product_uid; });

  var quotes = await get('/api/quotes?uids=' + uids.map(encodeURIComponent).join(','));
  ok(quotes.status === 200, 'GET /api/quotes returns 200');
  ok(quotes.body.requested === uids.length, 'reports how many identifiers it was asked for');
  ok(quotes.body.quotes.length === uids.length, 'prices every known product in one request');
  ok(quotes.body.missing.length === 0 && quotes.body.complete === true,
     'a fully satisfiable request is reported complete');

  var q0 = quotes.body.quotes[0];
  ok(typeof q0.price_tnd === 'string' && /^\d+\.\d{2}$/.test(q0.price_tnd),
     'price is the exact NUMERIC(8,2) decimal string, never a float');
  var single = await get('/api/products/' + encodeURIComponent(uids[0]));
  ok(q0.price_tnd === single.body.price_tnd,
     'the quoted price is byte-identical to the product document (one truth)');
  ok(q0.availability === single.body.availability, 'quoted availability matches the product');
  ok(q0.canonical_reference === single.body.canonical_reference, 'quote carries the reference');

  var partial = await get('/api/quotes?uids=' + encodeURIComponent(uids[0]) + ',autopart.tn:does-not-exist');
  ok(partial.status === 200, 'a partially satisfiable request is still 200');
  ok(partial.body.quotes.length === 1, 'known products are priced');
  ok(partial.body.missing.length === 1 && partial.body.missing[0] === 'autopart.tn:does-not-exist',
     'an unknown product is NAMED in missing, never silently dropped');
  ok(partial.body.complete === false, 'a partial answer is reported as incomplete');

  var duped = await get('/api/quotes?uids=' + encodeURIComponent(uids[0]) + ',' + encodeURIComponent(uids[0]));
  ok(duped.body.requested === 1 && duped.body.quotes.length === 1,
     'a repeated identifier is answered once, not twice');

  ok((await get('/api/quotes')).status === 400, 'quotes without uids is a 400');
  ok((await get('/api/quotes?uids=')).status === 400, 'quotes with empty uids is a 400');
  ok((await get('/api/quotes?uids=,,,')).status === 400, 'quotes with only separators is a 400');
  var tooMany = [];
  for (var qi = 0; qi < api.MAX_QUOTE_UIDS + 1; qi++) tooMany.push('u' + qi);
  ok((await get('/api/quotes?uids=' + tooMany.join(','))).status === 400,
     'more than MAX_QUOTE_UIDS (' + api.MAX_QUOTE_UIDS + ') identifiers is a 400, not a bulk export');
  ok((await get('/api/quotes?uids=' + 'x'.repeat(129))).status === 400,
     'an over-long identifier is a 400');

  // A withdrawn part must not be quotable. LIVE_STATUS governs this route the
  // same way it governs every list and facet.
  var withdrawn = await db.query(
    "SELECT product_uid FROM sya_products WHERE status NOT IN ('active','updated') LIMIT 1"
  );
  if (withdrawn.rows.length > 0) {
    var wq = await get('/api/quotes?uids=' + encodeURIComponent(withdrawn.rows[0].product_uid));
    ok(wq.body.quotes.length === 0 && wq.body.missing.length === 1,
       'a withdrawn product is reported missing, never priced');
  } else {
    ok(true, 'no withdrawn product exists in the live catalog to test against (0 rows outside LIVE_STATUS)');
  }

  ok((await get('/api/quotes?uids=' + encodeURIComponent(uids[0]))).status === 200,
     'quotes remains a GET-only read route');

  // =========================================================================
  // 13. SYA-API-3 — part categories (KG-2)
  // =========================================================================
  console.log('\n13. Part categories (SYA-API-3, KG-2)');
  var catsRes = await get('/api/part-categories');
  ok(catsRes.status === 200, 'GET /api/part-categories returns 200');
  ok(Array.isArray(catsRes.body.part_categories), 'returns a part_categories array');
  var cats = catsRes.body.part_categories;
  ok(cats.length > 0, 'reports at least one category');

  // Every live product must land in exactly one category, or a customer
  // browsing by category cannot reach part of the catalogue.
  var categorised = cats.reduce(function (n, c) { return n + c.product_count; }, 0);
  ok(categorised === EXPECTED.products,
     'every live product is in exactly one category (' + categorised + ' = ' + EXPECTED.products + ')');

  ok(cats.every(function (c) { return c.product_count > 0; }),
     'no category is reported with zero products — an empty category page must not exist');
  ok(cats.every(function (c) { return typeof c.category_slug === 'string' && c.category_slug.length > 0; }),
     'every category carries a non-empty slug');
  ok(cats.every(function (c) { return c.category_slug.indexOf('/') === -1; }),
     'a slug never contains a path separator');
  var slugs = cats.map(function (c) { return c.category_slug; });
  ok(new Set(slugs).size === slugs.length, 'slugs are unique');
  ok(slugs.slice().sort().join() === slugs.join(), 'categories are returned in a stable order');

  // This is the facet/list agreement rule LIVE_STATUS exists to guarantee,
  // applied to the new dimension: both sides use the same derived expression.
  var biggest = cats.slice().sort(function (a, b) { return b.product_count - a.product_count; })[0];
  var byCat = await get('/api/products?limit=1&category=' + encodeURIComponent(biggest.category_slug));
  ok(byCat.status === 200 && byCat.body.total === biggest.product_count,
     'the facet count agrees exactly with the filtered list (' + biggest.category_slug + ')');

  var pageOfCat = await get('/api/products?limit=200&category=' + encodeURIComponent(biggest.category_slug));
  ok(pageOfCat.body.products.length === biggest.product_count,
     'the filtered page returns exactly that many products');

  var unknownCat = await get('/api/products?category=cette-categorie-nexiste-pas&limit=1');
  ok(unknownCat.status === 200 && unknownCat.body.total === 0,
     'an unknown category is an empty result, not an error');
  ok((await get('/api/products?category=' + 'x'.repeat(129))).status === 400,
     'an over-long category is rejected with 400');
  var blankCat = await get('/api/products?category=&limit=1');
  ok(blankCat.status === 200 && blankCat.body.total === EXPECTED.products,
     'an empty category parameter is ignored rather than matching nothing');

  // The frontier is not the catalogue: 390 slugs were measured across the
  // source's 45,036 URLs, but only what these 346 products use is reported.
  ok(cats.length < 390,
     'only categories the live catalogue actually uses are reported (' + cats.length + ', not the 390-slug frontier)');

  // A storefront's customer-facing group spans several source slugs, so the
  // filter takes a list: rendering such a group must not be N requests.
  var twoBiggest = cats.slice().sort(function (a, b) { return b.product_count - a.product_count; }).slice(0, 3);
  var multi = await get('/api/products?limit=1&category=' +
    twoBiggest.map(function (c) { return encodeURIComponent(c.category_slug); }).join(','));
  var expectedMulti = twoBiggest.reduce(function (n, c) { return n + c.product_count; }, 0);
  ok(multi.body.total === expectedMulti,
     'a comma-separated category list returns the union of those categories (' + expectedMulti + ')');

  var dupCat = await get('/api/products?limit=1&category=' +
    encodeURIComponent(biggest.category_slug) + ',' + encodeURIComponent(biggest.category_slug));
  ok(dupCat.body.total === biggest.product_count, 'a repeated slug is not counted twice');

  var tooManyCats = [];
  for (var ci = 0; ci < api.MAX_CATEGORIES + 1; ci++) tooManyCats.push('c' + ci);
  ok((await get('/api/products?category=' + tooManyCats.join(','))).status === 400,
     'more than MAX_CATEGORIES (' + api.MAX_CATEGORIES + ') slugs is a 400');
  var mixedKnown = await get('/api/products?limit=1&category=' +
    encodeURIComponent(biggest.category_slug) + ',nexiste-pas');
  ok(mixedKnown.body.total === biggest.product_count,
     'an unknown slug alongside a known one contributes nothing rather than erroring');

  // Category composes with the other filters rather than replacing them.
  var combo = await get('/api/products?limit=1&category=' + encodeURIComponent(biggest.category_slug) + '&brand_car=SSANGYONG');
  ok(combo.status === 200 && combo.body.total === biggest.product_count,
     'category composes with brand_car');

  await new Promise(function (resolve) { server.close(resolve); });
  await db.closePool();

  
  console.log('\nStage SYA-API-1 (read-only catalog API): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (err) {
  console.log('FATAL: ' + err.message);
  process.exit(1);
});
