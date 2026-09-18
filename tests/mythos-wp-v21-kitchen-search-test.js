'use strict';
// =====================================================
// MYTHOS WP V2.1 — Kitchen search behaviour (tests/mythos-wp-v21-kitchen-search-test.js)
//
// The limitation this suite closes, inside the EXISTING Kitchen contract (no Kitchen change):
//   * the catalogue can hold SEVERAL rows with the same model name (the live SsangYong Kitchen has
//     three "KORANDO" generations), so narrowing by one of them would be a guess and narrowing by none
//     buried the answer under every generation → now every row carrying that name is queried and unioned;
//   * the Kitchen's title match is literal, so "filtre a huile" (no accents) found nothing while
//     "filtre à huile" found twenty → the accent-free CATEGORY facet (contract 1.2) is matched first and
//     becomes a `category=` filter, which also narrows far better than a phrase.
// And the rule that must never bend: when the catalogue cannot single out a product, the port answers
// not-ok and the engine hands the conversation to a human — it never invents a reference, price or stock.
//
// Fake Kitchen on loopback; no database, no network. (The platform suite covers the 1.1 Kitchen whose
// part-categories route 404s; case 5 here repeats it for the search path specifically.)
// =====================================================
var http = require('http');
var path = require('path');
var WP = path.resolve(__dirname, '..', 'projects/mythos-wp');
var kitchen = require(path.join(WP, 'reference/kitchen.js'));
var ports = require(path.join(WP, 'reference/comms/ports.js'));
var passed = 0, failed = 0;
function ok(c, n) { if (c) passed++; else { failed++; console.error('FAIL: ' + n); } }
function finish(code) { console.log('mythos-wp-v21-kitchen-search: ' + passed + ' passed, ' + failed + ' failed'); process.exit(code !== undefined ? code : (failed ? 1 : 0)); }

// --- catalogue fixture: two generations share the name KORANDO, one product each; one shared family --
var MODELS = [
  { id: 1, brand_car: 'SSANGYONG', model_name: 'KORANDO', generation_code: 'C200', year_from: 2010 },
  { id: 2, brand_car: 'SSANGYONG', model_name: 'KORANDO', generation_code: 'C300', year_from: 2019 },
  { id: 3, brand_car: 'SSANGYONG', model_name: 'REXTON', generation_code: 'Y400', year_from: 2017 }
];
var PRODUCTS = [
  { product_uid: 'k:OIL1', canonical_reference: 'OIL-1', product_title: 'Filtre à huile CHAMPION', product_brand: 'CHAMPION', oem_reference: 'A66', availability: 'En Stock', price_tnd: '24.30', currency: 'TND', product_url: 'https://t.test/1', last_checked_at: '2026-09-01T00:00:00.000Z', cats: ['filtre-a-huile'], models: [1] },
  { product_uid: 'k:OIL2', canonical_reference: 'OIL-2', product_title: 'Filtre à huile ASHIKA', product_brand: 'ASHIKA', oem_reference: 'A67', availability: 'En Stock', price_tnd: '26.00', currency: 'TND', product_url: 'https://t.test/2', last_checked_at: '2026-09-01T00:00:00.000Z', cats: ['filtre-a-huile'], models: [2] },
  { product_uid: 'k:ALT3', canonical_reference: 'ALT-3', product_title: 'Alternateur VALEO', product_brand: 'VALEO', oem_reference: null, availability: 'Sur Commande', price_tnd: '410.00', currency: 'TND', product_url: 'https://t.test/3', last_checked_at: '2026-09-01T00:00:00.000Z', cats: ['alternateur'], models: [1] },
  { product_uid: 'k:BRK4', canonical_reference: 'BRK-4', product_title: 'Disque de frein TRW', product_brand: 'TRW', oem_reference: null, availability: 'Indisponible', price_tnd: null, currency: 'TND', product_url: 'https://t.test/4', last_checked_at: '2026-09-01T00:00:00.000Z', cats: ['disque-de-frein'], models: [3] }
];
// a family with more rows than a port may call a fact (MAX_CANDIDATES = 5)
for (var i = 0; i < 7; i++) PRODUCTS.push({ product_uid: 'k:PAD' + i, canonical_reference: 'PAD-' + i, product_title: 'Plaquette de frein N' + i, product_brand: 'BREMBO', oem_reference: null, availability: 'En Stock', price_tnd: '80.00', currency: 'TND', product_url: 'https://t.test/p' + i, last_checked_at: '2026-09-01T00:00:00.000Z', cats: ['plaquette-de-frein'], models: [1, 2] });

var categoriesEnabled = true;
var calls = [];
function row(p) { var o = Object.assign({}, p); delete o.cats; delete o.models; return o; }
var kit = http.createServer(function (rq, rs) {
  var u = new URL(rq.url, 'http://x'); var q = Object.fromEntries(u.searchParams); var p = u.pathname;
  var send = function (code, body) { var s = JSON.stringify(body); rs.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) }); rs.end(s); };
  if (p === '/api/health') return send(200, { status: 'ok', read_only: true, database: 'fake', counts: { products: PRODUCTS.length, vehicle_models: MODELS.length } });
  if (p === '/api/vehicle-models') return send(200, { vehicle_models: MODELS });
  if (p === '/api/part-categories') { if (!categoriesEnabled) return send(404, { error: 'not found' }); var by = {}; PRODUCTS.forEach(function (x) { x.cats.forEach(function (c) { by[c] = (by[c] || 0) + 1; }); }); return send(200, { part_categories: Object.keys(by).sort().map(function (c) { return { category_slug: c, product_count: by[c] }; }) }); }
  if (p === '/api/products') {
    calls.push({ q: q.q || null, category: q.category || null, model_id: q.model_id || null });
    var rows = PRODUCTS.slice();
    if (q.q) rows = rows.filter(function (x) { return String(x.product_title).toLowerCase().indexOf(String(q.q).toLowerCase()) !== -1; });   // literal, accent-sensitive, like the real Kitchen
    if (q.category) rows = rows.filter(function (x) { return x.cats.indexOf(q.category) !== -1; });
    if (q.model_id) rows = rows.filter(function (x) { return x.models.indexOf(parseInt(q.model_id, 10)) !== -1; });
    if (q.ref) rows = rows.filter(function (x) { return String(x.canonical_reference).toUpperCase().replace(/[^A-Z0-9-]/g, '').indexOf(String(q.ref).toUpperCase()) !== -1; });
    var limit = parseInt(q.limit || '50', 10);
    return send(200, { total: rows.length, limit: limit, offset: 0, products: rows.slice(0, limit).map(row) });
  }
  if (/^\/api\/products\//.test(p)) { var uid = decodeURIComponent(p.slice('/api/products/'.length)); var hit = PRODUCTS.filter(function (x) { return x.product_uid === uid; })[0]; return hit ? send(200, row(hit)) : send(404, { error: 'not found' }); }
  send(404, { error: 'not found' });
});

var P;    // ports bound to the fake Kitchen
var CTX = { project_id: 'k-probe' };
function parts(entities) { calls = []; return P.parts(entities, CTX); }

kit.listen(0, '127.0.0.1', function () {
  var client = kitchen.createClient({ base_url: 'http://127.0.0.1:' + kit.address().port, key: 'k-fake' });
  P = ports.create({ resolveProject: function () { return { project: { id: 'k-probe', display_name: 'Probe', settings: { kitchen: 'k-fake' } }, kitchen: client }; } });
  Promise.resolve()
    // 1. accent-free words reach the catalogue through the category facet
    .then(function () { return parts({ parts: ['filtre a huile'] }); })
    .then(function (r) {
      ok(r.ok && r.data.by === 'category' && r.data.matches.length === 2, 'accent-free words find the family through the category facet (' + (r.ok ? r.data.by + '/' + r.data.matches.length : r.reason) + ')');
      ok(calls.every(function (c) { return c.category === 'filtre-a-huile'; }), 'the query carries category=filtre-a-huile, not a phrase');
    })
    // 2. the same words with accents behave identically
    .then(function () { return parts({ parts: ['filtre à huile'] }); })
    .then(function (r) { ok(r.ok && r.data.matches.length === 2, 'accented words give the same answer'); })
    // 3. a model name shared by two generations narrows by BOTH, never by one
    .then(function () { return parts({ parts: ['filtre a huile'], vehicle_model: 'Korando' }); })
    .then(function (r) {
      var ids = calls.map(function (c) { return c.model_id; }).filter(Boolean).sort();
      ok(r.ok && r.data.matches.length === 2, 'two KORANDO generations → both products, unioned');
      ok(ids.length === 2 && ids[0] === '1' && ids[1] === '2', 'both model ids were queried (' + ids.join(',') + ') — no generation was guessed');
    })
    .then(function () { return parts({ parts: ['filtre a huile'], vehicle_model: 'Rexton' }); })
    .then(function (r) { ok(!r.ok && r.reason === 'NO_MATCH', 'a model that carries none of the family → NO_MATCH, never a substitute'); })
    // 4. a single match is a fact: price and stock follow
    .then(function () { return parts({ parts: ['alternateur'] }); })
    .then(function (r) { ok(r.ok && r.data.matches.length === 1 && r.data.matches[0].canonical_reference === 'ALT-3', 'a narrow family resolves to one product'); return P.price({ parts: ['alternateur'] }, CTX); })
    .then(function (r) { ok(r.ok && r.data.selling_price === 410 && r.data.indicative === true, 'price of the single match is answered, flagged indicative'); return P.stock({ parts: ['alternateur'] }, CTX); })
    .then(function (r) { ok(r.ok && r.data.availability === 'ON_ORDER', 'stock of the single match is answered'); })
    // 5. too many candidates is never a fact
    .then(function () { return parts({ parts: ['plaquette de frein'], vehicle_model: 'Korando' }); })
    .then(function (r) { ok(!r.ok && r.reason === 'TOO_MANY_MATCHES', 'a family with more candidates than a fact allows → not-ok (' + (r.ok ? 'OK — WRONG' : r.reason) + ')'); return P.price({ parts: ['plaquette de frein'] }, CTX); })
    .then(function (r) { ok(!r.ok, 'no price is invented for an ambiguous family'); })
    // 6. words that match no category fall back to the literal search
    .then(function () { return parts({ parts: ['CHAMPION'] }); })
    .then(function (r) { ok(r.ok && r.data.by === 'words' && r.data.matches.length === 1, 'no category match → literal word search still works'); })
    // 7. a category that holds nothing for this vehicle falls back to words rather than answering nothing
    .then(function () { return parts({ parts: ['disque de frein'], vehicle_model: 'Korando' }); })
    .then(function (r) { ok(!r.ok && r.reason === 'NO_MATCH', 'category + wrong vehicle → NO_MATCH after the word fallback'); })
    // 8. an older Kitchen without the category facet keeps working on words
    .then(function () { categoriesEnabled = false; kitchen.invalidate(); return parts({ parts: ['Filtre à huile'] }); })
    .then(function (r) { ok(r.ok && r.data.by === 'words' && r.data.matches.length === 2, 'Kitchen without part-categories (1.1) → the word path answers'); })
    .then(function () { return parts({ parts: ['filtre a huile'] }); })
    .then(function (r) { ok(!r.ok, 'on a 1.1 Kitchen accent-free words find nothing — and nothing is invented (' + (r.ok ? 'OK — WRONG' : r.reason) + ')'); categoriesEnabled = true; kitchen.invalidate(); })
    // 9. a Kitchen that is down is never a product answer
    .then(function () {
      var dead = ports.create({ resolveProject: function () { return { project: { id: 'k-probe', settings: {} }, kitchen: kitchen.createClient({ base_url: 'http://127.0.0.1:1', key: 'dead' }) }; } });
      return dead.parts({ parts: ['filtre a huile'] }, CTX).then(function (r) { ok(!r.ok && /KITCHEN|PORT/.test(r.reason), 'Kitchen down → not-ok (' + r.reason + ')'); return dead.price({ reference: 'OIL-1' }, CTX); });
    })
    .then(function (r) { ok(!r.ok, 'Kitchen down → no price'); })
    // 10. a reference always wins over words
    .then(function () { return parts({ reference: 'OIL-2', parts: ['filtre a huile'], vehicle_model: 'Korando' }); })
    .then(function (r) { ok(r.ok && r.data.by === 'reference' && r.data.matches.length === 1 && r.data.matches[0].product_uid === 'k:OIL2', 'a reference is answered directly, not through the family'); })
    .then(function () { kit.close(); finish(); })
    .catch(function (e) { failed++; console.error('FAIL: uncaught ' + (e && e.stack || e)); kit.close(); finish(1); });
});
