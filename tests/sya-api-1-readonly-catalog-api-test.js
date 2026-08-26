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

  console.log('\n7b. SYA-SHOP-2 additions — sort, availability, availability facet');
  var avail = await get('/api/availabilities');
  ok(avail.status === 200 && Array.isArray(avail.body.availabilities) && avail.body.availabilities.length >= 1,
     'GET /api/availabilities returns the availability facet');
  var availTotal = avail.body.availabilities.reduce(function (sum, a) { return sum + a.product_count; }, 0);
  ok(availTotal === page.body.total,
     'Availability facet counts sum to the catalogue total (' + page.body.total + ') — same LIVE_STATUS predicate');

  var firstAvail = avail.body.availabilities[0].availability;
  var byAvail = await get('/api/products?availability=' + encodeURIComponent(firstAvail));
  ok(byAvail.body.total === avail.body.availabilities[0].product_count &&
     byAvail.body.products.every(function (p) { return p.availability === firstAvail; }),
     'availability= filters exactly, and its total matches the facet count');

  var priceAsc = await get('/api/products?sort=price_asc&limit=50');
  var ascPrices = priceAsc.body.products.map(function (p) { return parseFloat(p.price_tnd); });
  ok(ascPrices.every(function (v, i) { return i === 0 || ascPrices[i - 1] <= v; }),
     'sort=price_asc pages in non-decreasing price order');
  var priceDesc = await get('/api/products?sort=price_desc&limit=50');
  var descPrices = priceDesc.body.products.map(function (p) { return parseFloat(p.price_tnd); });
  ok(descPrices.every(function (v, i) { return i === 0 || descPrices[i - 1] >= v; }),
     'sort=price_desc pages in non-increasing price order');
  ok(priceAsc.body.total === page.body.total, 'Sorting never changes the result set, only its order');

  var defaultOrder = await get('/api/products?limit=10&offset=0');
  var explicitRef = await get('/api/products?sort=reference&limit=10&offset=0');
  ok(JSON.stringify(defaultOrder.body.products) === JSON.stringify(explicitRef.body.products),
     'sort=reference is the default order — omitting ?sort= is unchanged behaviour');

  var badSort = await get('/api/products?sort=price;DROP');
  ok(badSort.status === 400, 'An unknown sort value -> 400 (whitelist, never interpolated)');

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

  await new Promise(function (resolve) { server.close(resolve); });
  await db.closePool();

  console.log('\nStage SYA-API-1 (read-only catalog API): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (err) {
  console.log('FATAL: ' + err.message);
  process.exit(1);
});
