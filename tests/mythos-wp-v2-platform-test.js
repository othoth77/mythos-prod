'use strict';
var ADMIN_SEARCH = false; // search results carry phone digits only for admin+ sessions
// =====================================================
// MYTHOS WP V2 — platform layer tests (builder B)  needs MYTHOS_WP_TEST_DB_URL
// tests/mythos-wp-v2-platform-test.js
//
// Loopback server + a FAKE Kitchen (contract-shaped payloads), a fake Evolution
// and a fake n8n on loopback; nothing real is called. Users admin / owner /
// agent / viewer from a 0600 users file. Rows are prefixed 'v2pf-' and only
// those rows are cleaned (other builders share the test database).
//
// Covers: kitchen client (capability probe, degrade on 404, error kinds on
// 500 / timeout / unreachable, availability normalisation), ports (parts
// found / ambiguous / none, indicative price, stock unknown, kitchen not
// configured), integrations (defaults seeded once, test endpoint updates
// health, secrets never returned), health center (run persists, prune),
// automations (defaults, keyword → handoff or MODULE_UNAVAILABLE, n8n webhook
// without text, runs ledger, enable/disable, sweep, 403 for viewer), notes
// CRUD, dashboard document, search groups + routes, Kitchen passthroughs.
// =====================================================
var http = require('http');
var fs = require('fs');
var os = require('os');
var path = require('path');
var url = require('url');
var ROOT = path.resolve(__dirname, '..');
var WP = path.join(ROOT, 'projects/mythos-wp');
var TEST_URL = process.env.MYTHOS_WP_TEST_DB_URL || null;
var passed = 0, failed = 0;
function ok(c, n) { if (c) passed++; else { failed++; console.error('FAIL: ' + n); } }
function finish(code) { console.log('mythos-wp-v2-platform: ' + passed + ' passed, ' + failed + ' failed'); process.exit(code !== undefined ? code : (failed ? 1 : 0)); }
if (!TEST_URL) { console.error('MYTHOS_WP_TEST_DB_URL not set'); finish(process.env.MYTHOS_WP_ALLOW_SKIP === '1' ? 0 : 3); }
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-v2pf-'));
var EVO_KEY = 'V2PF-FAKE-EVOLUTION-KEY-0123456789';
var keyFile = path.join(tmp, 'evolution.key'); fs.writeFileSync(keyFile, EVO_KEY + '\n', { mode: 0o600 });
process.env.MYTHOS_WP_USERS_FILE = path.join(tmp, 'users.json'); process.env.MYTHOS_WP_INSECURE_COOKIE = '1';
process.env.V2PF_EVO_KEY_FILE = keyFile; process.env.MYTHOS_WP_EVOLUTION_API_KEY_FILE = keyFile;
process.env.MYTHOS_WP_HEALTH_ONLY_KEYS = 'v2pf-kitchen,v2pf-broken,v2pf-evolution'; process.env.MYTHOS_WP_HEALTH_ONLY_INSTANCES = 'v2pf-number';
delete process.env.MYTHOS_WP_COMMS_CONFIG; delete process.env.MYTHOS_WP_RECEIVER_ENABLED; delete process.env.MYTHOS_WP_CATALOG_TEST;
var u = new URL(TEST_URL); process.env.MYTHOS_WP_DB_HOST = u.hostname; process.env.MYTHOS_WP_DB_PORT = u.port || '5432'; process.env.MYTHOS_WP_DB_USER = decodeURIComponent(u.username); process.env.MYTHOS_WP_DB_PASSWORD = decodeURIComponent(u.password); process.env.MYTHOS_WP_DB_NAME = u.pathname.slice(1);

// ---- fake Kitchen (contract 1.3.0 shapes; part-categories deliberately 404 = a 1.1 Kitchen) ----
var PRODUCTS = [
  { product_uid: 'v2pf:CAF1', product_brand: 'CHAMPION', canonical_reference: 'CAF100563P', product_title: 'Filtre à huile CHAMPION', oem_reference: '6711840025', availability: 'En Stock', price_tnd: '46.00', currency: 'TND', product_url: 'https://t.test/p1', last_checked_at: '2026-09-01T00:00:00.000Z', main_image_url: null, model_ids: [1, 2] },
  { product_uid: 'v2pf:AIR2', product_brand: 'KAMOKA', canonical_reference: 'AF-200', product_title: 'Filtre à air KAMOKA', oem_reference: '2313009000', availability: 'Sur Commande', price_tnd: '30.00', currency: 'TND', product_url: 'https://t.test/p2', last_checked_at: '2026-09-01T00:00:00.000Z', main_image_url: null, model_ids: [1] },
  { product_uid: 'v2pf:BOU3', product_brand: 'BOSCH', canonical_reference: 'BG-300', product_title: 'Bougie de préchauffage BOSCH', oem_reference: null, availability: 'Bientôt disponible', price_tnd: '55.00', currency: 'TND', product_url: 'https://t.test/p3', last_checked_at: '2026-09-01T00:00:00.000Z', main_image_url: null, model_ids: [2] },
  { product_uid: 'v2pf:DSQ4', product_brand: 'TRW', canonical_reference: 'DF-400', product_title: 'Disque de frein TRW', oem_reference: null, availability: 'Indisponible', price_tnd: null, currency: 'TND', product_url: 'https://t.test/p4', last_checked_at: '2026-09-01T00:00:00.000Z', main_image_url: null, model_ids: [1] }
];
var MODELS = [{ id: 1, brand_car: 'SSANGYONG', model_name: 'REXTON', generation_code: 'Y250', year_from: 2006, year_to: null, motorization_count: 1, product_count: 3 }, { id: 2, brand_car: 'SSANGYONG', model_name: 'KORANDO', generation_code: 'CK', year_from: 2010, year_to: null, motorization_count: 1, product_count: 2 }];
var kitchenMode = 'ok', kitchenHits = [];
function listRow(p) { var o = Object.assign({}, p); delete o.model_ids; return o; }
function norm(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
var fakeKitchen = http.createServer(function (req, res) {
  var pu = url.parse(req.url, true); kitchenHits.push(pu.pathname);
  var json = function (code, body) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (kitchenMode === 'hang') return; // never answers → client TIMEOUT
  if (kitchenMode === 'error') return json(500, { error: 'boom' });
  var p = pu.pathname, qq = pu.query, m;
  if (p === '/api/health') return json(200, { status: 'ok', database: 'v2pf_fake', schema: 'v2pf', read_only: true, counts: { products: PRODUCTS.length, vehicle_models: MODELS.length, vehicle_motorizations: 2, compatibility: 7, product_images: 0 } });
  if (p === '/api/products') {
    var rows = PRODUCTS.slice();
    if (qq.q) rows = rows.filter(function (x) { var t = String(qq.q).toLowerCase(); return [x.product_title, x.canonical_reference, x.oem_reference].some(function (v) { return v && String(v).toLowerCase().indexOf(t) !== -1; }); });
    if (qq.ref) rows = rows.filter(function (x) { var r = norm(qq.ref); return norm(x.canonical_reference).indexOf(r) !== -1 || norm(x.oem_reference).indexOf(r) !== -1; });
    if (qq.model_id) rows = rows.filter(function (x) { return x.model_ids.indexOf(parseInt(qq.model_id, 10)) !== -1; });
    var limit = parseInt(qq.limit || '50', 10), offset = parseInt(qq.offset || '0', 10);
    return json(200, { total: rows.length, limit: limit, offset: offset, products: rows.slice(offset, offset + limit).map(listRow) });
  }
  if ((m = /^\/api\/products\/(.+)$/.exec(p))) { var uid = decodeURIComponent(m[1]); var hit = PRODUCTS.filter(function (x) { return x.product_uid === uid; })[0]; if (!hit) return json(404, { error: 'not found' }); return json(200, Object.assign(listRow(hit), { source: 'v2pf', pair_reference: null, technical_specs: { 'pour numéro OE': hit.oem_reference }, status: 'active', images: [], compatibility: hit.model_ids.map(function (id) { return { vehicle_model_id: id, model_name: MODELS[id - 1].model_name, generation_code: MODELS[id - 1].generation_code, vehicle_motorization_id: id, motorisation: '2.0', year_from: 2006, year_to: null }; }) })); }
  if (p === '/api/vehicle-models') return json(200, { vehicle_models: MODELS });
  if ((m = /^\/api\/vehicle-models\/(\d+)\/motorizations$/.exec(p))) return json(200, { vehicle_model_id: parseInt(m[1], 10), motorizations: [{ id: parseInt(m[1], 10), vehicle_model_id: parseInt(m[1], 10), motorisation: '2.0 Xdi', year_from: 2006, year_to: null, power: '141.0', fuel: 'Diesel', product_count: 2 }] });
  if (p === '/api/brands') return json(200, { brands: [{ product_brand: 'CHAMPION', product_count: 1 }, { product_brand: 'KAMOKA', product_count: 1 }] });
  if (p === '/api/vehicle-brands') return json(200, { vehicle_brands: [{ brand_car: 'SSANGYONG', model_count: 2, product_count: 4 }] });
  if (p === '/api/part-categories') return json(404, { error: 'not found' });
  if (p === '/api/quotes') { var uids = String(qq.uids || '').split(',').filter(Boolean); if (!uids.length) return json(400, { error: 'uids must not be empty' }); var quotes = [], missing = []; uids.forEach(function (id) { var x = PRODUCTS.filter(function (y) { return y.product_uid === id; })[0]; if (x) quotes.push({ product_uid: x.product_uid, canonical_reference: x.canonical_reference, product_title: x.product_title, price_tnd: x.price_tnd, currency: x.currency, availability: x.availability, last_checked_at: x.last_checked_at }); else missing.push(id); }); return json(200, { requested: uids.length, quotes: quotes, missing: missing, complete: !missing.length }); }
  json(404, { error: 'not found' });
});
// ---- fake Evolution (key-gated) and fake n8n (records webhook payloads) ----
var fakeEvo = http.createServer(function (req, res) {
  var json = function (code, body) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.headers.apikey !== EVO_KEY) return json(401, { status: 401, error: 'Unauthorized' });
  if (req.url === '/instance/fetchInstances') return json(200, [{ instance: { instanceName: 'v2pf-number', status: 'open' } }]);
  var m = /^\/instance\/connectionState\/(.+)$/.exec(req.url);
  if (m) return json(200, { instance: { instanceName: decodeURIComponent(m[1]), state: 'open' } });
  json(404, { error: 'not found' });
});
var hooks = [];
var fakeN8n = http.createServer(function (req, res) { var b = ''; req.on('data', function (c) { b += c; }); req.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} hooks.push({ path: req.url, body: j }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }); });

var auth = require(path.join(WP, 'reference/auth'));
var migrate = require(path.join(WP, 'reference/migrate'));
var db = require(path.join(WP, 'reference/db'));
var store = require(path.join(WP, 'reference/projects-store'));
var core = require(path.join(WP, 'reference/comms/core'));
var providerMod = require(path.join(WP, 'reference/comms/providers/evolution'));
var kitchen = require(path.join(WP, 'reference/kitchen'));
var portsLib = require(path.join(WP, 'reference/comms/ports'));
var integrations = require(path.join(WP, 'reference/integrations'));
var health = require(path.join(WP, 'reference/health'));
var automations = require(path.join(WP, 'reference/automations'));
var pool = db.wp();
fs.writeFileSync(process.env.MYTHOS_WP_USERS_FILE, JSON.stringify({ users: [
  { username: 'v2pf-admin', role: 'admin', scrypt: auth.hashPassword('admin-password-1') }, { username: 'v2pf-owner', role: 'owner', scrypt: auth.hashPassword('owner-password-1') },
  { username: 'v2pf-agent', role: 'agent', scrypt: auth.hashPassword('agent-password-1') }, { username: 'v2pf-viewer', role: 'viewer', scrypt: auth.hashPassword('viewer-password-1') }
] }), { mode: 0o600 });
var server = require(path.join(WP, 'reference/server')).createServer();
var PORT = 0, ADMIN = '', OWNER = '', AGENT = '', VIEWER = '';
function req(method, p, body, cookie) {
  return new Promise(function (resolve, reject) {
    var data = body !== undefined ? JSON.stringify(body) : null;
    var h = { 'Content-Type': 'application/json', 'X-Requested-With': 'MythosWP' }; if (data) h['Content-Length'] = Buffer.byteLength(data); var ck = cookie === undefined ? ADMIN : cookie; if (ck) h.Cookie = ck;
    var rq = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: h, agent: false }, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j, data: j && j.data, cookie: (res.headers['set-cookie'] || [''])[0].split(';')[0] }); }); });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}
function q(sql, p) { return pool.query(sql, p || []); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function inbound(instance, id, text, from, name) { return providerMod.parseInbound({ event: 'messages.upsert', instance: instance, sender: '21600000000@s.whatsapp.net', data: { key: { remoteJid: (from || '21699100001') + '@s.whatsapp.net', fromMe: false, id: id }, pushName: name || 'Client V2PF', message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) } }).event; }
function walk(v, fn, k) { if (v && typeof v === 'object') Object.keys(v).forEach(function (kk) { walk(v[kk], fn, kk); }); else fn(k, v); }
var KITCHEN_URL, ids = {}, inboxA, inboxC;
var PIDS = ['v2pf-a', 'v2pf-b', 'v2pf-c'];
function wipe() {
  var steps = [
    ["DELETE FROM wp_automation_runs WHERE project_id = ANY($1) OR automation_id IN (SELECT id FROM wp_automations WHERE project_id = ANY($1) OR name LIKE 'v2pf-%')", [PIDS]],
    ["DELETE FROM wp_automations WHERE project_id = ANY($1) OR name LIKE 'v2pf-%'", [PIDS]],
    ["DELETE FROM wp_notes WHERE project_id = ANY($1)", [PIDS]],
    ["DELETE FROM wp_health_checks WHERE component LIKE '%v2pf%'", []],
    ["DELETE FROM wp_integrations WHERE key LIKE 'v2pf-%'", []],
    ["DELETE FROM wp_templates WHERE project_id = ANY($1) OR name LIKE 'v2pf_%'", [PIDS]],
    ["DELETE FROM wp_project_agents WHERE project_id = ANY($1)", [PIDS]],
    ["DELETE FROM wp_agents WHERE slug LIKE 'v2pf-%'", []],
    ["DELETE FROM wp_inbound_events WHERE inbox_id IN (SELECT id FROM wp_inboxes WHERE project_id = ANY($1))", [PIDS]],
    ["DELETE FROM wp_message_attachments WHERE message_id IN (SELECT id FROM wp_messages WHERE project_id = ANY($1))", [PIDS]],
    ["DELETE FROM wp_conversation_events WHERE project_id = ANY($1)", [PIDS]],
    ["UPDATE wp_messages SET ai_run_id = NULL WHERE project_id = ANY($1) AND ai_run_id IS NOT NULL", [PIDS]],
    ["DELETE FROM wp_ai_suggestions WHERE conversation_id IN (SELECT id FROM wp_conversations WHERE project_id = ANY($1))", [PIDS]],
    ["DELETE FROM wp_ai_runs WHERE project_id = ANY($1)", [PIDS]],
    ["DELETE FROM wp_messages WHERE project_id = ANY($1)", [PIDS]],
    ["DELETE FROM wp_handoffs WHERE project_id = ANY($1)", [PIDS]],
    ["DELETE FROM wp_conversation_tags WHERE conversation_id IN (SELECT id FROM wp_conversations WHERE project_id = ANY($1))", [PIDS]],
    ["DELETE FROM wp_conversations WHERE project_id = ANY($1)", [PIDS]],
    ["DELETE FROM wp_contact_identities WHERE project_id = ANY($1)", [PIDS]],
    ["DELETE FROM wp_contact_tags WHERE contact_id IN (SELECT id FROM wp_contacts WHERE project_id = ANY($1))", [PIDS]],
    ["DELETE FROM wp_contacts WHERE project_id = ANY($1)", [PIDS]],
    ["DELETE FROM wp_tags WHERE project_id = ANY($1)", [PIDS]],
    ["DELETE FROM wp_inbox_routes WHERE project_id = ANY($1)", [PIDS]],
    ["DELETE FROM wp_inbox_members WHERE inbox_id IN (SELECT id FROM wp_inboxes WHERE project_id = ANY($1))", [PIDS]],
    ["DELETE FROM wp_inboxes WHERE project_id = ANY($1)", [PIDS]],
    ["DELETE FROM wp_phone_numbers WHERE instance LIKE 'v2pf-%'", []],
    ["DELETE FROM wp_audit_events WHERE project_id = ANY($1) OR actor LIKE 'v2pf-%'", [PIDS]],
    ["DELETE FROM wp_user_projects WHERE project_id = ANY($1)", [PIDS]],
    ["DELETE FROM wp_projects WHERE id = ANY($1)", [PIDS]]
  ];
  var chain = Promise.resolve(); steps.forEach(function (s) { chain = chain.then(function () { return q(s[0], s[1]); }); }); return chain;
}
function listen(srv) { return new Promise(function (resolve) { srv.listen(0, '127.0.0.1', function () { resolve('http://127.0.0.1:' + srv.address().port); }); }); }

migrate.up(pool).then(wipe)
  .then(function () { return listen(fakeKitchen); }).then(function (b) { KITCHEN_URL = b; return listen(fakeEvo); })
  .then(function (b) { ids.evo = b; process.env.MYTHOS_WP_EVOLUTION_BASE_URL = b; return listen(fakeN8n); })
  .then(function (b) { ids.n8n = b; return listen(server); }).then(function (b) { PORT = parseInt(b.split(':')[2], 10); })
  .then(function () { return q("INSERT INTO wp_projects (id, display_name, domain, kind, catalog_dsn_env, status, settings) VALUES ('v2pf-a','V2PF Autos','v2pf.test','automotive','MYTHOS_WP_CATALOG_TEST','active','{\"kitchen\":\"v2pf-kitchen\"}'), ('v2pf-b','V2PF Service',NULL,'service','MYTHOS_WP_CATALOG_TEST','active','{}'), ('v2pf-c','V2PF Dash',NULL,'service','MYTHOS_WP_CATALOG_TEST','active','{}')"); })
  .then(function () { return q("INSERT INTO wp_integrations (key, kind, name, base_url, config, status) VALUES ('v2pf-kitchen','kitchen','V2PF fake Kitchen',$1,'{}','enabled'), ('v2pf-broken','api','V2PF unreachable API','http://127.0.0.1:1','{}','enabled'), ('v2pf-evolution','whatsapp_provider','V2PF fake Evolution',$2,'{\"provider\":\"evolution\"}','enabled'), ('v2pf-n8n','n8n','V2PF fake n8n',$3,$4,'enabled')", [KITCHEN_URL, ids.evo, ids.n8n, JSON.stringify({ webhook_base: ids.n8n + '/webhook' })]); })
  .then(function () { return q("UPDATE wp_integrations SET credential_env = 'V2PF_EVO_KEY_FILE' WHERE key = 'v2pf-evolution'"); })
  .then(function () { return q("INSERT INTO wp_phone_numbers (provider, instance, phone_ref, display_name, status) VALUES ('evolution','v2pf-number','21650000001','V2PF business line','unknown') RETURNING id"); })
  .then(function (r) { ids.number = r.rows[0].id; return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, inbound_enabled, outbound_enabled, status, phone_number_id) VALUES ('v2pf-a','evolution','v2pf-number','A', true, true, 'open', $1) RETURNING *", [ids.number]); })
  .then(function (r) { inboxA = r.rows[0]; return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, inbound_enabled) VALUES ('v2pf-b','evolution','v2pf-b-inbox','B', true) RETURNING *"); })
  .then(function () { return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, inbound_enabled) VALUES ('v2pf-c','evolution','v2pf-c-inbox','C', true) RETURNING *"); })
  .then(function (r) { inboxC = r.rows[0]; store.invalidate(); kitchen.invalidate(); })
  .then(function () { return req('POST', '/api/login', { username: 'v2pf-admin', password: 'admin-password-1' }, ''); }).then(function (x) { ok(x.status === 200, 'login admin'); ADMIN = x.cookie; return req('POST', '/api/login', { username: 'v2pf-owner', password: 'owner-password-1' }, ''); })
  .then(function (x) { OWNER = x.cookie; return req('POST', '/api/login', { username: 'v2pf-agent', password: 'agent-password-1' }, ''); }).then(function (x) { AGENT = x.cookie; return req('POST', '/api/login', { username: 'v2pf-viewer', password: 'viewer-password-1' }, ''); }).then(function (x) { VIEWER = x.cookie; })

  // ---- 1. kitchen client ------------------------------------------------------
  .then(function () { var c = kitchen.createClient({ base_url: KITCHEN_URL, key: 'v2pf-kitchen' }); ids.client = c; return c.describe(); })
  .then(function (d) {
    ok(d.ok && d.data.contract === '1.3.0' && d.data.counts.products === 4 && d.data.read_only === true, 'kitchen describe → contract + counts');
    ok(d.data.capabilities['part-categories'] === false && d.data.capabilities.quotes === true && d.data.capabilities['vehicle-brands'] === true, 'capability probe: part-categories 404 → unsupported, quotes/vehicle-brands supported ' + JSON.stringify(d.data.capabilities));
    return ids.client.listPartCategories();
  })
  .then(function (r) { ok(r.ok === true && r.degraded === true && r.data.part_categories.length === 0, 'part-categories degrades on 404 (older Kitchen)'); return ids.client.searchProducts({ q: 'filtre' }); })
  .then(function (r) { ok(r.ok && r.data.total === 2 && r.data.products.length === 2 && r.data.products[0].availability === 'IN_STOCK' && r.data.products[1].availability === 'ON_ORDER' && r.data.products[0].price_tnd === 46, 'search q=filtre → 2 normalised rows (En Stock→IN_STOCK, Sur Commande→ON_ORDER, price number)'); return ids.client.searchProducts({ ref: 'caf 100563-p' }); })
  .then(function (r) { ok(r.ok && r.data.products.length === 1 && r.data.products[0].product_uid === 'v2pf:CAF1', 'search ref= is punctuation-insensitive'); return ids.client.getProduct('v2pf:BOU3'); })
  .then(function (r) { ok(r.ok && r.data.availability === 'UNKNOWN' && r.data.availability_raw === 'Bientôt disponible' && Array.isArray(r.data.compatibility), 'product detail: unlisted French state → UNKNOWN, raw kept'); return ids.client.getProduct('v2pf:DSQ4'); })
  .then(function (r) { ok(r.ok && r.data.availability === 'UNAVAILABLE' && r.data.price_tnd === null, 'Indisponible → UNAVAILABLE; null price stays null'); return ids.client.getProduct('nope'); })
  .then(function (r) { ok(!r.ok && r.kind === 'BAD_STATUS' && r.status === 404, 'unknown product → BAD_STATUS 404'); return ids.client.quote(['v2pf:CAF1', 'v2pf:ZZZ']); })
  .then(function (r) { ok(r.ok && r.data.quotes.length === 1 && r.data.missing[0] === 'v2pf:ZZZ' && r.data.complete === false, 'quotes: partial answer names the missing uid'); return ids.client.availability('v2pf:CAF1'); })
  .then(function (r) { ok(r.ok && r.data.availability === 'IN_STOCK' && r.data.source === 'kitchen:catalogue', 'availability(uid) → IN_STOCK'); return ids.client.listMotorizations(1); })
  .then(function (r) { ok(r.ok && r.data.motorizations.length === 1, 'motorizations'); return ids.client.listVehicleBrands(); })
  .then(function (r) { ok(r.ok && !r.degraded && r.data.vehicle_brands.length === 1, 'vehicle-brands supported'); kitchenMode = 'error'; return ids.client.searchProducts({ q: 'x' }); })
  .then(function (r) { ok(!r.ok && r.kind === 'BAD_STATUS' && r.status === 500, '500 → { ok:false, kind:BAD_STATUS }'); kitchenMode = 'hang'; return kitchen.createClient({ base_url: KITCHEN_URL }).listVehicleModels(); })
  .then(function (r) { ok(!r.ok && r.kind === 'TIMEOUT', 'silent Kitchen → TIMEOUT after 3 s (' + r.kind + ')'); kitchenMode = 'ok'; return kitchen.createClient({ base_url: 'http://127.0.0.1:1' }).describe(); })
  .then(function (r) { ok(!r.ok && r.kind === 'UNREACHABLE', 'closed port → UNREACHABLE'); })
  .then(function () {
    ok(kitchen.normaliseAvailability('En Stock') === 'IN_STOCK' && kitchen.normaliseAvailability('Sur Commande') === 'ON_ORDER' && kitchen.normaliseAvailability('Indisponible') === 'UNAVAILABLE' && kitchen.normaliseAvailability('n/a') === 'UNKNOWN' && kitchen.normaliseAvailability(null) === 'UNKNOWN' && kitchen.normaliseAvailability('on_order') === 'ON_ORDER', 'availability normalisation table');
    ok(kitchen.keyFor({ kind: 'service', settings: {} }) === null && kitchen.keyFor({ kind: 'automotive', settings: {} }) === 'kitchen-mythos-auto' && kitchen.keyFor({ kind: 'automotive', settings: { kitchen: false } }) === null && kitchen.keyFor({ kind: 'service', settings: { kitchen: 'v2pf-kitchen' } }) === 'v2pf-kitchen', 'keyFor: default for automotive only, explicit key wins, false disables');
    return kitchen.forProject(pool, { id: 'v2pf-b', kind: 'service', settings: {} });
  })
  .then(function (c) { ok(c === null, 'forProject: service project without settings.kitchen → null'); return kitchen.forProject(pool, { id: 'v2pf-a', kind: 'automotive', settings: { kitchen: 'v2pf-kitchen' } }); })
  .then(function (c) { ok(c && c.key === 'v2pf-kitchen' && c.base_url === KITCHEN_URL, 'forProject: reads base_url from the integration row'); })

  // ---- 2. ports over the Kitchen -------------------------------------------------
  .then(function () { ids.ports = portsLib.create({ resolveProject: function (id) { return store.resolve(id); } }); return ids.ports.parts({ parts: ['filtre'] }, { project_id: 'v2pf-a' }); })
  .then(function (r) { ok(r.ok && r.data.matches.length === 2 && r.data.by === 'words' && r.data.source === 'kitchen:catalogue', 'parts: words → 2 matches'); return ids.ports.price({ parts: ['filtre'] }, { project_id: 'v2pf-a' }); })
  .then(function (r) { ok(!r.ok && r.reason === 'AMBIGUOUS', 'price: two candidates → AMBIGUOUS'); return ids.ports.price({ reference: 'CAF100563P' }, { project_id: 'v2pf-a' }); })
  .then(function (r) { ok(r.ok && r.data.selling_price === 46 && r.data.currency === 'TND' && r.data.indicative === true && r.data.verified === true && r.data.source === 'kitchen:catalogue' && r.data.product_uid === 'v2pf:CAF1' && r.data.as_of, 'price: single reference → indicative catalogue price ' + JSON.stringify(r)); return ids.ports.stock({ reference: 'CAF100563P' }, { project_id: 'v2pf-a' }); })
  .then(function (r) { ok(r.ok && r.data.availability === 'IN_STOCK', 'stock: IN_STOCK state'); return ids.ports.stock({ reference: 'BG-300' }, { project_id: 'v2pf-a' }); })
  .then(function (r) { ok(!r.ok && r.reason === 'STOCK_UNKNOWN', 'stock: unlisted state → STOCK_UNKNOWN'); return ids.ports.price({ reference: 'DF-400' }, { project_id: 'v2pf-a' }); })
  .then(function (r) { ok(!r.ok && r.reason === 'PRICE_NOT_SET', 'price: null catalogue price → PRICE_NOT_SET'); return ids.ports.parts({ parts: ['plaquettes'] }, { project_id: 'v2pf-a' }); })
  .then(function (r) { ok(!r.ok && r.reason === 'NO_MATCH', 'parts: nothing → NO_MATCH'); return ids.ports.parts({}, { project_id: 'v2pf-a' }); })
  .then(function (r) { ok(!r.ok && r.reason === 'NO_PART_NAMED', 'parts: no words → NO_PART_NAMED'); return ids.ports.parts({ parts: ['filtre'], vehicle_model: 'Korando' }, { project_id: 'v2pf-a' }); })
  .then(function (r) { ok(r.ok && r.data.matches.length === 1 && r.data.matches[0].product_uid === 'v2pf:CAF1', 'parts: one vehicle model narrows by fitment'); return ids.ports.vehicle({ vehicle_model: 'rex' }, { project_id: 'v2pf-a' }); })
  .then(function (r) { ok(r.ok && r.data.models.length === 1 && r.data.models[0].model_name === 'REXTON', 'vehicle: name prefix → Kitchen models'); return ids.ports.parts({ parts: ['filtre'] }, { project_id: 'v2pf-b' }); })
  .then(function (r) { ok(!r.ok && r.reason === 'KITCHEN_NOT_CONFIGURED', 'ports: project without a Kitchen → KITCHEN_NOT_CONFIGURED'); return ids.ports.price({ reference: 'CAF100563P' }, { project_id: 'nope-v2pf' }); })
  .then(function (r) { ok(!r.ok && r.reason === 'PROJECT_UNKNOWN', 'ports: unknown project'); kitchenMode = 'error'; return ids.ports.parts({ parts: ['filtre'] }, { project_id: 'v2pf-a' }); })
  .then(function (r) { ok(!r.ok && r.reason === 'KITCHEN_BAD_STATUS', 'ports: Kitchen 500 → KITCHEN_BAD_STATUS'); kitchenMode = 'ok'; ok(ids.ports.connected.length === 4 && ids.ports.notConnected[0] === 'order', 'connected / notConnected arrays'); })

  // ---- 3. integrations -----------------------------------------------------------
  .then(function () { return integrations.ensureDefaults(pool).then(function () { return integrations.ensureDefaults(pool); }); })
  .then(function () { return q('SELECT key, count(*)::int AS n FROM wp_integrations WHERE key = ANY($1) GROUP BY key', [integrations.DEFAULTS.map(function (d) { return d.key; })]); })
  .then(function (r) { ok(r.rows.length === integrations.DEFAULTS.length && r.rows.every(function (x) { return x.n === 1; }), 'defaults seeded once (' + r.rows.length + ' keys)'); return q("SELECT status, credentials_state, config FROM wp_integrations WHERE key = 'meta-whatsapp-business-mcp'"); })
  .then(function (r) { ok(r.rows[0] && r.rows[0].status === 'disabled' && r.rows[0].credentials_state === 'missing' && r.rows[0].config.tool_namespace === 'whatsapp_biz_' && Array.isArray(r.rows[0].config.tools) && r.rows[0].config.tools.length >= 18, 'meta MCP row: disabled, credentials missing, tool list'); return req('GET', '/api/integrations', undefined, VIEWER); })
  .then(function (x) {
    ok(x.status === 200 && x.data.items.some(function (i) { return i.key === 'v2pf-kitchen'; }), 'viewer lists integrations');
    var leak = false; walk(x.data, function (k, v) { if (/^(token|secret|password|api_?key|apikey|credential)$/i.test(String(k || ''))) leak = true; if (typeof v === 'string' && v.indexOf(EVO_KEY) !== -1) leak = true; });
    ok(!leak, 'no secret field or value in the integrations list');
    var evo = x.data.items.filter(function (i) { return i.key === 'v2pf-evolution'; })[0];
    ok(evo && evo.credential_env === 'V2PF_EVO_KEY_FILE' && evo.credentials_state === 'present', 'credential referenced by env NAME; state present with a 0600 file');
    fs.chmodSync(keyFile, 0o644); return req('GET', '/api/integrations', undefined, VIEWER);
  })
  .then(function (x) { var evo = x.data.items.filter(function (i) { return i.key === 'v2pf-evolution'; })[0]; ok(evo.credentials_state === 'missing', 'a group-readable key file counts as missing'); fs.chmodSync(keyFile, 0o600); return req('POST', '/api/integrations', { key: 'v2pf-created', kind: 'api', name: 'Created', base_url: 'https://example.invalid/api' }, VIEWER); })
  .then(function (x) { ok(x.status === 403, 'viewer cannot create an integration'); return req('POST', '/api/integrations', { key: 'v2pf-created', kind: 'api', name: 'Created', base_url: 'http://10.0.0.1/api' }); })
  .then(function (x) { ok(x.status === 400 && x.body.errors && x.body.errors.base_url, 'plain http off loopback refused'); return req('POST', '/api/integrations', { key: 'v2pf-created', kind: 'api', name: 'Created', base_url: 'https://example.invalid/api', config: { api_key: 'nope' } }); })
  .then(function (x) { ok(x.status === 400 && x.body.errors && x.body.errors.config, 'a credential-looking config key is refused'); return req('POST', '/api/integrations', { key: 'v2pf-created', kind: 'api', name: 'Created', base_url: 'https://example.invalid/api', credential_env: 'MYTHOS_WP_INTEGRATION_V2PF_CREATED_TOKEN' }); })
  .then(function (x) { ok(x.status === 201 && x.data.key === 'v2pf-created' && x.data.credentials_state === 'missing', 'admin creates → 201, env unset → missing'); return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE resource = 'integrations' AND record_id = 'v2pf-created' AND action = 'create'"); })
  .then(function (r) { ok(r.rows[0].n === 1, 'create audited'); return req('PATCH', '/api/integrations/v2pf-created', { name: 'Created 2', status: 'disabled' }); })
  .then(function (x) { ok(x.status === 200 && x.data.name === 'Created 2' && x.data.status === 'disabled', 'patch'); return req('POST', '/api/integrations/v2pf-kitchen/test', {}); })
  .then(function (x) { ok(x.status === 200 && x.data.status === 'ok' && x.data.detail.counts.products === 4 && x.data.health_state === 'ok', 'test endpoint probes the Kitchen → ok'); return q("SELECT health_state, last_ok_at, last_error, last_checked_at FROM wp_integrations WHERE key = 'v2pf-kitchen'"); })
  .then(function (r) { ok(r.rows[0].health_state === 'ok' && r.rows[0].last_ok_at && r.rows[0].last_error === null && r.rows[0].last_checked_at, 'health columns updated'); return req('POST', '/api/integrations/v2pf-broken/test', {}); })
  .then(function (x) { ok(x.status === 200 && x.data.status === 'disconnected', 'unreachable → disconnected'); return q("SELECT health_state, last_error FROM wp_integrations WHERE key = 'v2pf-broken'"); })
  .then(function (r) { ok(r.rows[0].health_state === 'disconnected' && r.rows[0].last_error, 'last_error recorded'); return req('POST', '/api/integrations/v2pf-evolution/test', {}); })
  .then(function (x) { ok(x.status === 200 && x.data.status === 'ok' && x.data.detail.instances === 1, 'evolution probe with the key file → ok ' + JSON.stringify(x.data)); ok(JSON.stringify(x.data).indexOf(EVO_KEY) === -1, 'probe result carries no key value'); return req('POST', '/api/integrations/v2pf-nope/test', {}); })
  .then(function (x) { ok(x.status === 404, 'unknown key → 404'); return req('DELETE', '/api/integrations/v2pf-created'); })
  .then(function (x) { ok(x.status === 403, 'admin cannot delete (owner only)'); return req('DELETE', '/api/integrations/v2pf-created', undefined, OWNER); })
  .then(function (x) { ok(x.status === 200 && x.data.deleted === true, 'owner deletes'); })

  // ---- 4. health center ------------------------------------------------------------
  .then(function () { return health.runAll(pool, { integrationKeys: ['v2pf-kitchen', 'v2pf-broken', 'v2pf-evolution'], numberInstances: ['v2pf-number'] }); })
  .then(function (doc) {
    var by = {}; doc.components.forEach(function (c) { by[c.component] = c; });
    ok(by.database && by.database.status === 'ok', 'database ok');
    ok(by.backend && by.backend.status === 'ok' && by.backend.detail.node, 'backend ok');
    ok(by.receiver && by.receiver.status === 'warning', 'receiver disabled → warning');
    ok(by['kitchen:v2pf-kitchen'] && by['kitchen:v2pf-kitchen'].status === 'ok', 'kitchen component ok');
    ok(by['integration:v2pf-broken'] && by['integration:v2pf-broken'].status === 'disconnected', 'integration probe error → disconnected');
    ok(by['whatsapp:evolution'] && by['whatsapp:evolution'].status === 'ok', 'whatsapp:evolution ok');
    ok(by['number:v2pf-number'] && by['number:v2pf-number'].status === 'ok' && by['number:v2pf-number'].detail.state === 'open', 'number probe ok');
    ok(doc.summary.ok >= 5 && doc.summary.disconnected === 1, 'summary counts ' + JSON.stringify(doc.summary));
    return q("SELECT status, health_state FROM wp_phone_numbers WHERE id = $1", [ids.number]);
  })
  .then(function (r) { ok(r.rows[0].status === 'open' && r.rows[0].health_state === 'ok', 'wp_phone_numbers updated from connectionState'); return q("SELECT count(*)::int AS n FROM wp_health_checks WHERE component = 'kitchen:v2pf-kitchen'"); })
  .then(function (r) { ok(r.rows[0].n === 1, 'run persisted one row per component'); return req('GET', '/api/health/center', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 200 && x.data.components.some(function (c) { return c.component === 'kitchen:v2pf-kitchen' && c.status === 'ok'; }) && x.data.summary && x.data.generated_at, 'center document (latest per component)'); return req('POST', '/api/health/run', {}, VIEWER); })
  .then(function (x) { ok(x.status === 403, 'viewer cannot run health'); return req('POST', '/api/health/run', {}, AGENT); })
  .then(function (x) { ok(x.status === 403, 'agent cannot run health'); return req('POST', '/api/health/run', {}); })
  .then(function (x) { ok(x.status === 200 && x.data.components.length >= 6, 'manager+ runs every check (' + x.data.components.length + ')'); return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE resource = 'health' AND action = 'run' AND actor = 'v2pf-admin'"); })
  .then(function (r) { ok(r.rows[0].n === 1, 'health run audited'); var vals = []; for (var i = 0; i < 2100; i++) vals.push("('test:v2pf-prune','ok','{}',1)"); return q('INSERT INTO wp_health_checks (component, status, detail, duration_ms) VALUES ' + vals.join(',')); })
  .then(function () { return health.prune(pool); }).then(function (n) { ok(n >= 100, 'prune deleted ' + n + ' rows'); return q('SELECT count(*)::int AS n FROM wp_health_checks'); })
  .then(function (r) { ok(r.rows[0].n <= 2000, 'table kept at ≤ 2000 rows (' + r.rows[0].n + ')'); return health.runAll(pool, { integrationKeys: ['v2pf-kitchen', 'v2pf-broken', 'v2pf-evolution'], numberInstances: ['v2pf-number'] }); })
  .then(function (doc) { ok(doc.components.length >= 6, 'a run after the prune repopulates the center'); })

  // ---- 5. automations --------------------------------------------------------------
  .then(function () { return automations.ensureDefaults(pool).then(function () { return automations.ensureDefaults(pool); }); })
  .then(function () { return q('SELECT name, count(*)::int AS n FROM wp_automations WHERE project_id IS NULL AND name = ANY($1) GROUP BY name', [automations.DEFAULTS.map(function (d) { return d.name; })]); })
  .then(function (r) { ok(r.rows.length === 3 && r.rows.every(function (x) { return x.n === 1; }), 'three global defaults seeded once'); automations.attach(pool, function () {}); return req('POST', '/api/automations', { project_id: 'v2pf-a', name: 'v2pf-human', trigger: 'message.received', conditions: { keywords: ['humain'] }, actions: [{ type: 'handoff', reason: 'CUSTOMER_REQUESTED_HUMAN' }, { type: 'tag', name: 'v2pf-human' }] }, VIEWER); })
  .then(function (x) { ok(x.status === 403, 'viewer cannot create an automation'); return req('POST', '/api/automations', { project_id: 'v2pf-a', name: 'v2pf-human', trigger: 'message.received', position: 1, conditions: { keywords: ['humain'] }, actions: [{ type: 'handoff', reason: 'CUSTOMER_REQUESTED_HUMAN' }, { type: 'tag', name: 'v2pf-human' }] }); })
  .then(function (x) { ok(x.status === 201 && x.data && x.data.id && x.data.enabled === true, 'admin creates → 201 (got ' + x.status + ' ' + JSON.stringify(x.body).slice(0, 200) + ')'); ids.autoHuman = x.data ? x.data.id : null; return req('POST', '/api/automations', { project_id: 'v2pf-a', name: 'v2pf-bad', trigger: 'nope', actions: [] }); })
  .then(function (x) { ok(x.status === 400 && x.body.errors.trigger && x.body.errors.actions, 'validation errors named'); return req('POST', '/api/automations', { project_id: 'v2pf-a', name: 'v2pf-devis', trigger: 'message.received', conditions: { keywords: ['devis'] }, actions: [{ type: 'n8n_webhook', path: 'v2pf/hook', integration: 'v2pf-n8n' }] }); })
  .then(function (x) { ok(x.status === 201, 'n8n automation created'); ids.autoDevis = x.data.id; return core.ingest(pool, inboxA, inbound('v2pf-number', 'V2PF-H1', 'je veux parler à un humain svp', '21699100001')); })
  .then(function (r) { ids.convHuman = r.conversation_id; ids.contactA = r.contact_id; return wait(900); })
  .then(function () { return req('GET', '/api/automations/' + ids.autoHuman + '/runs'); })
  .then(function (x) {
    ok(x.status === 200 && x.data.items.length === 1, 'keyword rule ran once (' + x.data.items.length + ')');
    var run = x.data.items[0] || {}; var a = run.detail && run.detail.actions ? run.detail.actions : [];
    ok(String(run.conversation_id) === String(ids.convHuman) && run.trigger === 'message.received', 'run row carries conversation + trigger');
    ok(a[0] && a[0].type === 'handoff' && (a[0].result === 'ok' || (a[0].result === 'skipped' && a[0].reason === 'MODULE_UNAVAILABLE')), 'handoff action executed or skipped MODULE_UNAVAILABLE (' + JSON.stringify(a[0]) + ')');
    ok(a[1] && a[1].type === 'tag' && a[1].result === 'ok', 'tag action ok');
    ok(JSON.stringify(run).indexOf('humain svp') === -1, 'run detail carries no message text');
    return q('SELECT t.name FROM wp_conversation_tags ct JOIN wp_tags t ON t.id = ct.tag_id WHERE ct.conversation_id = $1', [ids.convHuman]);
  })
  .then(function (r) { ok(r.rows.some(function (t) { return t.name === 'v2pf-human'; }), 'conversation tagged by the automation'); return core.ingest(pool, inboxA, inbound('v2pf-number', 'V2PF-D1', 'un devis pour le filtre', '21699100002', 'Client Devis')); })
  .then(function (r) { ids.convDevis = r.conversation_id; return wait(900); })
  .then(function () {
    var h = hooks.filter(function (x) { return x.path === '/webhook/v2pf/hook'; });
    ok(h.length === 1 && h[0].body && String(h[0].body.conversation_id) === String(ids.convDevis) && h[0].body.event === 'message.received' && h[0].body.contact_masked === '***002', 'n8n webhook posted identifiers (' + h.length + ')');
    ok(h.length === 1 && h[0].body.text === undefined && JSON.stringify(h[0].body).indexOf('devis pour') === -1, 'webhook carries no message text by default');
    return req('PATCH', '/api/automations/' + ids.autoDevis, { actions: [{ type: 'n8n_webhook', path: 'v2pf/hook', integration: 'v2pf-n8n', include_text: true }] });
  })
  .then(function (x) { ok(x.status === 200 && x.data.actions[0].include_text === true, 'patch actions'); return core.ingest(pool, inboxA, inbound('v2pf-number', 'V2PF-D2', 'encore un devis', '21699100002')); })
  .then(function () { return wait(900); })
  .then(function () { var h = hooks.filter(function (x) { return x.path === '/webhook/v2pf/hook'; }); ok(h.length === 2 && h[1].body.text === 'encore un devis', 'include_text:true sends the text'); return req('POST', '/api/automations/' + ids.autoDevis + '/disable', {}); })
  .then(function (x) { ok(x.status === 200 && x.data.enabled === false, 'disable'); return core.ingest(pool, inboxA, inbound('v2pf-number', 'V2PF-D3', 'devis numéro trois', '21699100002')); })
  .then(function () { return wait(700); })
  .then(function () { ok(hooks.filter(function (x) { return x.path === '/webhook/v2pf/hook'; }).length === 2, 'disabled rule does not run'); return req('POST', '/api/automations/' + ids.autoDevis + '/enable', {}); })
  .then(function (x) { ok(x.status === 200 && x.data.enabled === true, 'enable'); return req('GET', '/api/automations?project=v2pf-a', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 200 && x.data.items.some(function (a) { return a.id === ids.autoHuman; }) && x.data.items.some(function (a) { return a.project_id === null; }), 'list: project rows + global rows'); ok(x.data.items.filter(function (a) { return a.id === ids.autoHuman; })[0].runs_24h === 1, 'runs_24h on the row'); return req('GET', '/api/automation-runs?project=v2pf-a&limit=50', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 200 && x.data.items.length >= 3 && x.data.items.every(function (r) { return r.project_id === 'v2pf-a'; }), 'runs ledger scoped to the project (' + x.data.items.length + ')'); return req('GET', '/api/automations/' + ids.autoHuman + '/runs', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 200 && x.data.items.length === 1, 'viewer reads runs of one automation'); return req('POST', '/api/automations', { project_id: 'v2pf-a', name: 'v2pf-inactive', trigger: 'conversation.inactive', conditions: { inactive_minutes: 5 }, actions: [{ type: 'note', text: 'Relance automatique' }, { type: 'set_status', status: 'waiting_customer' }] }); })
  .then(function (x) { ok(x.status === 201, 'inactive automation created'); ids.autoInactive = x.data.id; return q("UPDATE wp_conversations SET last_inbound_at = now() - interval '10 minutes' WHERE id = $1", [ids.convDevis]); })
  .then(function () { return automations.sweepInactive(pool); })
  .then(function (runs) { ok(runs.length === 1 && runs[0].result === 'ok' && runs[0].actions[0].type === 'note' && runs[0].actions[0].result === 'ok', 'sweep ran the inactive rule once ' + JSON.stringify(runs.map(function (r) { return r.result; }))); return automations.sweepInactive(pool); })
  .then(function (runs) { ok(runs.length === 0, 'sweep does not repeat within 24 h'); return q("SELECT status FROM wp_conversations WHERE id = $1", [ids.convDevis]); })
  .then(function (r) { ok(r.rows[0].status === 'waiting_customer', 'set_status applied by the sweep'); return req('DELETE', '/api/automations/' + ids.autoInactive, undefined, VIEWER); })
  .then(function (x) { ok(x.status === 403, 'viewer cannot delete'); return req('DELETE', '/api/automations/' + ids.autoInactive); })
  .then(function (x) { ok(x.status === 200 && x.data.deleted === true, 'admin deletes'); return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE resource = 'automations' AND actor = 'v2pf-admin'"); })
  .then(function (r) { ok(r.rows[0].n >= 6, 'automation mutations audited (' + r.rows[0].n + ')'); })

  // ---- 6. notes ---------------------------------------------------------------------
  .then(function () { return req('POST', '/api/notes', { kind: 'contact', id: ids.contactA, project_id: 'v2pf-a', body: 'Client fidèle' }, VIEWER); })
  .then(function (x) { ok(x.status === 403, 'viewer cannot add a note'); return req('POST', '/api/notes', { kind: 'contact', id: ids.contactA, project_id: 'v2pf-a', body: 'Client fidèle' }, AGENT); })
  .then(function (x) { ok(x.status === 201 && x.data.id && x.data.author === 'v2pf-agent', 'agent adds a contact note → 201'); ids.note1 = x.data.id; return req('POST', '/api/notes', { kind: 'project', id: 'v2pf-a', body: 'Projet pilote' }, AGENT); })
  .then(function (x) { ok(x.status === 201 && x.data.project_id === 'v2pf-a' && x.data.target_kind === 'project', 'project note'); ids.note2 = x.data.id; return req('POST', '/api/notes', { kind: 'contact', id: ids.contactA, project_id: 'v2pf-a', body: '' }, AGENT); })
  .then(function (x) { ok(x.status === 400, 'empty body refused'); return req('GET', '/api/notes?kind=contact&id=' + ids.contactA + '&project=v2pf-a', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 200 && x.data.items.length === 1 && x.data.items[0].body === 'Client fidèle', 'list contact notes'); return req('DELETE', '/api/notes/' + ids.note1, undefined, VIEWER); })
  .then(function (x) { ok(x.status === 403, 'viewer cannot delete'); return req('DELETE', '/api/notes/' + ids.note1, undefined, AGENT); })
  .then(function (x) { ok(x.status === 200 && x.data.deleted === true, 'author deletes own note'); return req('DELETE', '/api/notes/' + ids.note2); })
  .then(function (x) { ok(x.status === 200, 'manager+ deletes any note'); return req('DELETE', '/api/notes/' + ids.note2); })
  .then(function (x) { ok(x.status === 404, 'deleted note → 404'); })

  // ---- 7. dashboard (project v2pf-c seeded with known states) -----------------------
  .then(function () { return core.ingest(pool, inboxC, inbound('v2pf-c-inbox', 'V2PF-C1', 'Bonjour', '21699200001', 'Dash Un')); })
  .then(function (r) { ids.c1 = r.conversation_id; return core.ingest(pool, inboxC, inbound('v2pf-c-inbox', 'V2PF-C2', 'Salut', '21699200002', 'Dash Deux')); })
  .then(function (r) { ids.c2 = r.conversation_id; return core.ingest(pool, inboxC, inbound('v2pf-c-inbox', 'V2PF-C3', 'Hello', '21699200003', 'Dash Trois')); })
  .then(function (r) { ids.c3 = r.conversation_id; return core.ingest(pool, inboxC, inbound('v2pf-c-inbox', 'V2PF-C4', 'Fini', '21699200004', 'Dash Quatre')); })
  .then(function (r) { ids.c4 = r.conversation_id; return wait(500); })
  .then(function () { return q("UPDATE wp_conversations SET last_inbound_at = now() - interval '40 minutes' WHERE id = $1", [ids.c1]); })
  .then(function () { return q("UPDATE wp_conversations SET handler = 'human', status = 'waiting_customer' WHERE id = $1", [ids.c2]); })
  .then(function () { return q("UPDATE wp_conversations SET status = 'needs_human' WHERE id = $1", [ids.c3]); })
  .then(function () { return q("UPDATE wp_conversations SET status = 'resolved', unread_count = 0 WHERE id = $1", [ids.c4]); })
  .then(function () { return req('GET', '/api/dashboard?project=v2pf-c', undefined, VIEWER); })
  .then(function (x) {
    var d = x.data || {};
    ok(x.status === 200 && d.whatsapp && d.projects && d.ai && Array.isArray(d.infrastructure) && Array.isArray(d.alerts) && d.generated_at, 'dashboard document shape');
    ok(d.whatsapp.conversations === 3 && d.whatsapp.unread === 3 && d.whatsapp.ai === 2 && d.whatsapp.human === 1 && d.whatsapp.waiting === 1 && d.whatsapp.needs_attention === 2, 'whatsapp counts (live 3, unread 3, ai 2, human 1, waiting 1, attention 2) ' + JSON.stringify(d.whatsapp));
    var act = d.projects.activity.filter(function (p) { return p.id === 'v2pf-c'; })[0];
    ok(d.projects.total === 1 && d.projects.active === 1 && act && act.conversations_24h === 4, 'project activity ' + JSON.stringify(d.projects));
    ok(d.ai.handled_24h === 0 && d.ai.handoffs_24h === 0 && d.ai.errors_24h === 0 && typeof d.ai.active_agents === 'number', 'ai stats');
    ok(d.infrastructure.some(function (c) { return c.component === 'database'; }), 'infrastructure from health checks');
    ok(d.alerts.some(function (a) { return a.component === 'integration:v2pf-broken'; }), 'alerts include the disconnected integration');
    return req('GET', '/api/dashboard?project=all', undefined, VIEWER);
  })
  .then(function (x) { ok(x.status === 200 && x.data.whatsapp.conversations >= 3 && x.data.projects.total >= 3 && x.data.scope.project === 'all', 'all projects → aggregated'); return req('GET', '/api/dashboard?project=nope-v2pf', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 404, 'unknown project → 404'); return req('GET', '/api/dashboard', undefined, ''); })
  .then(function (x) { ok(x.status === 401, 'dashboard requires a session'); return req('GET', '/api/projects/v2pf-a/dashboard'); })
  .then(function (x) { ok(x.status === 200 && x.data.project.id === 'v2pf-a' && x.data.kitchen && x.data.kitchen.configured === true && x.data.panel.handoffs && x.data.cards.kitchen_products === 4, 'legacy project dashboard route still answers (buildProject via build)'); })

  // ---- 8. search ------------------------------------------------------------------
  .then(function () { return q("INSERT INTO wp_agents (slug, name) VALUES ('v2pf-agent-slug','V2PF Sales agent') RETURNING id"); })
  .then(function (r) { ids.agent = r.rows[0].id; return q("INSERT INTO wp_templates (project_id, name, body) VALUES ('v2pf-a','v2pf_welcome','Bonjour {{1}}') RETURNING id"); })
  .then(function (r) { ids.tpl = r.rows[0].id; return req('GET', '/api/search?q=Dash%20Deux&project=v2pf-c', undefined, VIEWER); })
  .then(function (x) { var g = (x.data.groups || []).filter(function (g) { return g.key === 'contacts'; })[0]; ok(x.status === 200 && g && /^#\/contacts\/360\/(21699200002|v2pf-c:\d+)$/.test(g.items[0].route) && g.items[0].sub.indexOf('***002') !== -1 && (g.items[0].route.indexOf('2169') === -1 || ADMIN_SEARCH), 'contacts by name → 360 route (digits only for admin)'); return req('GET', '/api/search?q=200003&project=v2pf-c', undefined, VIEWER); })
  .then(function (x) { var g = (x.data.groups || []).filter(function (g) { return g.key === 'contacts'; })[0]; ok(g && g.items.length === 1 && /^#\/contacts\/360\/(21699200003|v2pf-c:\d+)$/.test(g.items[0].route), 'contacts by digits suffix'); return req('GET', '/api/search?q=Hello&project=v2pf-c', undefined, VIEWER); })
  .then(function (x) { var g = (x.data.groups || []).filter(function (g) { return g.key === 'conversations'; })[0]; ok(g && g.items.length === 1 && g.items[0].route === '#/inbox/' + ids.c3, 'conversations by last text → inbox route'); return req('GET', '/api/search?q=filtre&project=v2pf-a', undefined, VIEWER); })
  .then(function (x) { var g = (x.data.groups || []).filter(function (g) { return g.key === 'products'; })[0]; ok(g && g.items.length === 2 && g.items[0].route === '#/projects/v2pf-a?tab=catalogue&uid=v2pf%3ACAF1' && g.items[0].sub.indexOf('indicative') !== -1, 'products via the project Kitchen → catalogue route'); return req('GET', '/api/search?q=filtre&project=all', undefined, VIEWER); })
  .then(function (x) { ok(!(x.data.groups || []).some(function (g) { return g.key === 'products'; }), 'no product group without a single project'); return req('GET', '/api/search?q=v2pf', undefined, VIEWER); })
  .then(function (x) {
    var by = {}; (x.data.groups || []).forEach(function (g) { by[g.key] = g; });
    ok(by.projects && by.projects.items.some(function (i) { return i.route === '#/projects/v2pf-a'; }), 'projects group + route');
    ok(by.integrations && by.integrations.items.some(function (i) { return i.route === '#/integrations?key=v2pf-kitchen'; }), 'integrations group + route');
    ok(by.numbers && by.numbers.items.some(function (i) { return i.route === '#/whatsapp?tab=numbers&id=' + ids.number && i.sub.indexOf('21650000001') === -1; }), 'numbers group + route, phone masked');
    ok(by.agents && by.agents.items.some(function (i) { return i.route === '#/ai/agents/' + ids.agent; }), 'agents group + route');
    ok(by.templates && by.templates.items.some(function (i) { return i.route === '#/whatsapp?tab=templates&id=' + ids.tpl; }), 'templates group + route');
    return req('GET', '/api/search?q=v', undefined, VIEWER);
  })
  .then(function (x) { ok(x.status === 200 && x.data.groups.length === 0, 'one-character query → empty'); })

  // ---- 9. Kitchen passthroughs ----------------------------------------------------
  .then(function () { return req('GET', '/api/projects/v2pf-a/kitchen/describe', undefined, ''); })
  .then(function (x) { ok(x.status === 401, 'kitchen describe requires a session'); return req('GET', '/api/projects/v2pf-a/kitchen/describe', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 200 && x.data.configured === true && x.data.key === 'v2pf-kitchen' && x.data.capabilities['part-categories'] === false && x.data.counts.products === 4, 'describe passthrough'); return req('GET', '/api/projects/v2pf-a/kitchen/products?q=filtre&limit=1', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 200 && x.data.total === 2 && x.data.products.length === 1 && x.data.products[0].availability === 'IN_STOCK', 'products passthrough (normalised, paged)'); return req('GET', '/api/projects/v2pf-a/kitchen/products/v2pf:AIR2', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 200 && x.data.product.availability === 'ON_ORDER', 'product detail passthrough'); return req('GET', '/api/projects/v2pf-a/kitchen/products/nope', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 404, 'unknown product → 404'); return req('GET', '/api/projects/v2pf-a/kitchen/vehicle-models', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 200 && x.data.vehicle_models.length === 2, 'vehicle-models passthrough'); return req('GET', '/api/projects/v2pf-a/kitchen/part-categories', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 200 && x.data.degraded === true && x.data.part_categories.length === 0, 'part-categories degraded on an older Kitchen'); return req('GET', '/api/projects/v2pf-b/kitchen/describe', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 200 && x.data.configured === false, 'no Kitchen → configured:false'); return req('GET', '/api/projects/v2pf-b/kitchen/products?q=filtre', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 200 && x.data.configured === false && x.data.products.length === 0, 'no Kitchen → empty product list'); kitchenMode = 'error'; return req('GET', '/api/projects/v2pf-a/kitchen/products?q=filtre', undefined, VIEWER); })
  .then(function (x) { ok(x.status === 503 && x.body.error === 'kitchen_unavailable', 'Kitchen failure → 503 kitchen_unavailable'); kitchenMode = 'ok'; ok(kitchenHits.every(function (p) { return p.indexOf('/api/') === 0; }), 'the client only ever issued GETs on /api/*'); })

  // ---- done ---------------------------------------------------------------------
  .then(function () { automations.stop(); health.stop(); return new Promise(function (resolve) { server.close(resolve); }); })
  .then(function () { return Promise.all([fakeKitchen, fakeEvo, fakeN8n].map(function (s) { return new Promise(function (resolve) { s.close(resolve); }); })); })
  .then(wipe).then(function () { return pool.end(); }).then(function () { finish(); })
  .catch(function (e) { console.error('ERROR: ' + (e && e.stack || e)); failed++; wipe().catch(function () {}).then(function () { return pool.end().catch(function () {}); }).then(function () { finish(1); }); });
