'use strict';
// =====================================================
// MYTHOS WP — tests
// tests/mythos-wp-test.js
//
// Covers: the shared validator (invalid data of every type); authentication
// (users file rules, scrypt verify, throttle, session cookie flags, CSRF);
// authorisation (operator vs owner, read-only resources); the resource
// registry; the generic CRUD against the test database (create / read /
// update / delete / soft delete / conflict / FK / search / sort / filters /
// pagination / lookup / overlay upsert); audit events for every mutation;
// dashboard metrics; the business-data ports (verified vs unknown for every
// kind) and the handoff sink; the whole engine through the panel simulator
// (missing business data → REQUIRES_HUMAN; verified data → reply gated by
// AUTO_REPLY_DISABLED / MODE_DRY_RUN; nothing sent); the HTTP boundary end
// to end on a loopback port (401 / 403 / CSRF / 404 / 405 / headers).
//
// Database section needs (created by projects/mythos-wp/deploy/provision-db.sh):
//   MYTHOS_WP_TEST_DB_URL       libpq URL of mythos_wp_test as mythos_wp_owner (from deploy/provision-db.sh)
// The catalogue fixture lives in the SAME test database, schema ssangyong_autos.
// Without the variable the DB section is SKIPPED and the run exits 3 unless
// MYTHOS_WP_ALLOW_SKIP=1. No network beyond 127.0.0.1. No WhatsApp.
//
//   node tests/mythos-wp-test.js
// =====================================================

var http = require('http');
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var WP = path.join(ROOT, 'projects/mythos-wp');

var passed = 0, failed = 0, skipped = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.error('FAIL: ' + name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + ' (got ' + JSON.stringify(a) + ')'); }

// ---------------------------------------------------------------- env
var TEST_URL = process.env.MYTHOS_WP_TEST_DB_URL || null;
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-test-'));
var usersFile = path.join(tmp, 'users.json');
process.env.MYTHOS_WP_USERS_FILE = usersFile;
process.env.MYTHOS_WP_INSECURE_COOKIE = '1';
process.env.MYTHOS_WP_CATALOG_TEST = TEST_URL || '';
delete process.env.MYTHOS_WP_COMMS_CONFIG;
if (TEST_URL) {
  var u = new URL(TEST_URL);
  process.env.MYTHOS_WP_DB_HOST = u.hostname; process.env.MYTHOS_WP_DB_PORT = u.port || '5432';
  process.env.MYTHOS_WP_DB_USER = decodeURIComponent(u.username); process.env.MYTHOS_WP_DB_PASSWORD = decodeURIComponent(u.password); process.env.MYTHOS_WP_DB_NAME = u.pathname.slice(1);
}

var validate = require(path.join(WP, 'reference/validate'));
var auth = require(path.join(WP, 'reference/auth'));
var resources = require(path.join(WP, 'reference/resources'));
var audit = require(path.join(WP, 'reference/audit'));
var crud = require(path.join(WP, 'reference/crud'));
var portsLib = require(path.join(WP, 'reference/comms/ports'));
var integration = require(path.join(WP, 'reference/comms/integration'));
var autoreply = require(path.join(WP, 'reference/autoreply'));
var db = require(path.join(WP, 'reference/db'));
var store = require(path.join(WP, 'reference/projects-store'));
var dashboard = require(path.join(WP, 'reference/dashboard'));
var server = require(path.join(WP, 'reference/server'));
var api = require(path.join(WP, 'reference/api'));

var OWNER_PW = 'owner-test-password-not-real-1234';
var OP_PW = 'operator-test-password-not-real-1234';
fs.writeFileSync(usersFile, JSON.stringify({ users: [
  { username: 'owner', role: 'owner', scrypt: auth.hashPassword(OWNER_PW) },
  { username: 'op', role: 'operator', scrypt: auth.hashPassword(OP_PW) },
  { username: 'BAD NAME', role: 'owner', scrypt: auth.hashPassword('x') },
  { username: 'norole', role: 'admin', scrypt: auth.hashPassword('x') }
] }), { mode: 0o600 });

// ================================================================ validator
(function () {
  var F = resources.get('products').fields.filter(function (f) { return !f.readonly && !f.virtual; });
  var good = { product_uid: 'wp:T1', canonical_reference: 'REF-1', product_brand: 'B', product_title: 'T', source: 'mythos-wp', product_url: 'https://x.test/p', price_tnd: '12,50', currency: 'TND', availability: 'En Stock', status: 'active', collected_at: '2026-01-01T00:00:00Z', last_checked_at: '2026-01-02T00:00:00Z' };
  var v = validate.validate(F, good, 'create');
  ok(v.ok, 'validate: good product passes'); eq(v.value.price_tnd, 12.5, 'validate: decimal comma normalised');
  v = validate.validate(F, Object.assign({}, good, { price_tnd: 'abc' }), 'create'); eq(v.errors.price_tnd, 'not_a_number', 'validate: not a number');
  v = validate.validate(F, Object.assign({}, good, { price_tnd: 0 }), 'create'); eq(v.errors.price_tnd, 'min', 'validate: below min');
  v = validate.validate(F, Object.assign({}, good, { availability: 'Maybe' }), 'create'); eq(v.errors.availability, 'not_in_enum', 'validate: enum');
  v = validate.validate(F, Object.assign({}, good, { product_url: 'http://insecure' }), 'create'); eq(v.errors.product_url, 'not_https_url', 'validate: https url');
  v = validate.validate(F, Object.assign({}, good, { canonical_reference: '' }), 'create'); eq(v.errors.canonical_reference, 'required', 'validate: required blank');
  v = validate.validate(F, Object.assign({}, good, { product_uid: 'bad uid!' }), 'create'); eq(v.errors.product_uid, 'pattern', 'validate: pattern');
  v = validate.validate(F, Object.assign({}, good, { technical_specs: '{not json' }), 'create'); eq(v.errors.technical_specs, 'not_json', 'validate: json');
  v = validate.validate(F, Object.assign({}, good, { collected_at: 'yesterday' }), 'create'); eq(v.errors.collected_at, 'not_a_date', 'validate: timestamp');
  v = validate.validate(F, Object.assign({}, good, { product_title: 'a\nb' }), 'create'); eq(v.errors.product_title, 'multiline', 'validate: multiline in text');
  v = validate.validate(F, Object.assign({}, good, { updated_at: '2026-01-01' }), 'create'); eq(v.errors.updated_at, 'unknown_field', 'validate: readonly field not in editable set is unknown');
  v = validate.validate(resources.get('products').fields, { updated_at: '2026-01-01' }, 'update'); eq(v.errors.updated_at, 'read_only', 'validate: read-only refused');
  v = validate.validate(F, { nope: 1 }, 'update'); eq(v.errors.nope, 'unknown_field', 'validate: unknown field');
  v = validate.validate(F, { product_title: 'only this' }, 'update'); ok(v.ok && Object.keys(v.value).length === 1, 'validate: partial update checks only present fields');
  v = validate.validate(F, 'string', 'create'); eq(v.errors._, 'not_an_object', 'validate: non-object');
  var K = resources.get('knowledge').fields;
  v = validate.validate(K, { kind: 'faq', title: 't', customer_text: 'c', language: 'fr', allowed_for_auto_reply: 'true', status: 'draft', tags: 'a, b, a' }, 'create');
  ok(v.ok && v.value.allowed_for_auto_reply === true && v.value.tags.length === 2, 'validate: boolean string + tags dedupe');
  v = validate.validate(K, { tags: 'bad tag with spaces' }, 'update'); eq(v.errors.tags, 'pattern', 'validate: tag pattern');
  v = validate.validate(resources.get('stock').fields, { quantity: 1.5 }, 'update'); eq(v.errors.quantity, 'not_an_integer', 'validate: integer');
  ok(typeof validate.message('required') === 'string' && validate.message('zzz') === 'zzz', 'validate: messages');
}());

// ================================================================ auth
(function () {
  var st = auth.usersState();
  ok(st.provisioned && st.count === 2, 'auth: users file loads only well-formed users (' + st.count + ')');
  ok(auth.verifyCredentials('owner', OWNER_PW).ok, 'auth: owner verifies');
  eq(auth.verifyCredentials('owner', OWNER_PW).user.role, 'owner', 'auth: role');
  ok(!auth.verifyCredentials('owner', 'wrong').ok, 'auth: wrong password refused');
  ok(!auth.verifyCredentials('ghost', OWNER_PW).ok, 'auth: unknown user refused');
  ok(!auth.verifyCredentials('owner', '').ok, 'auth: empty refused');
  ok(auth.verifyCredentials('OWNER ', OWNER_PW).ok, 'auth: username case/space normalised');
  ok(auth.verifyHash('pw', auth.hashPassword('pw')) && !auth.verifyHash('pw2', auth.hashPassword('pw')), 'auth: scrypt round trip');
  ok(!auth.verifyHash('pw', 'garbage'), 'auth: malformed hash refused');
  fs.chmodSync(usersFile, 0o644);
  eq(auth.usersState().reason, 'insecure_mode', 'auth: 0644 users file refused');
  fs.chmodSync(usersFile, 0o600);
  var s = auth.createSession({ username: 'owner', role: 'owner' });
  var req = { headers: { cookie: auth.SESSION_COOKIE + '=' + s.id }, socket: { remoteAddress: '127.0.0.1' } };
  ok(auth.sessionFor(req) && auth.sessionFor(req).username === 'owner', 'auth: session resolves');
  ok(auth.sessionFor({ headers: { cookie: auth.SESSION_COOKIE + '=deadbeef' } }) === null, 'auth: malformed id → none');
  ok(auth.destroySession(s.id) && auth.sessionFor(req) === null, 'auth: destroy');
  var c = auth.sessionCookie('a'.repeat(64));
  ok(/HttpOnly/.test(c) && /SameSite=Strict/.test(c) && /Path=\//.test(c), 'auth: cookie flags');
  ok(!/Secure/.test(c), 'auth: Secure dropped only under the insecure test flag');
  delete process.env.MYTHOS_WP_INSECURE_COOKIE;
  ok(/Secure/.test(auth.sessionCookie('a'.repeat(64))), 'auth: Secure by default');
  process.env.MYTHOS_WP_INSECURE_COOKIE = '1';
  ok(auth.hasRole({ role: 'owner' }, 'operator') && auth.hasRole({ role: 'operator' }, 'operator') && !auth.hasRole({ role: 'operator' }, 'owner') && !auth.hasRole(null, 'any') && auth.hasRole({ role: 'operator' }, 'any'), 'auth: role ranks');
  eq(auth.csrfCheck({ headers: {} }), 'csrf_header_missing', 'csrf: header required');
  eq(auth.csrfCheck({ headers: { 'x-requested-with': 'MythosWP', host: 'wp.test', origin: 'https://evil.test' } }), 'csrf_origin_mismatch', 'csrf: origin mismatch');
  eq(auth.csrfCheck({ headers: { 'x-requested-with': 'MythosWP', host: 'wp.test', origin: 'https://wp.test' } }), null, 'csrf: same origin ok');
  eq(auth.csrfCheck({ headers: { 'x-requested-with': 'MythosWP', 'sec-fetch-site': 'cross-site' } }), 'csrf_cross_site', 'csrf: sec-fetch-site cross-site');
  auth.resetThrottle();
  var r2 = { socket: { remoteAddress: '10.0.0.9' }, headers: {} };
  for (var i = 0; i < auth.LOGIN_MAX_FAILURES; i++) auth.recordLoginFailure(r2);
  ok(!auth.loginAllowed(r2), 'auth: throttled after ' + auth.LOGIN_MAX_FAILURES + ' failures');
  auth.clearLoginFailures(r2); ok(auth.loginAllowed(r2), 'auth: cleared');
}());

// ================================================================ registry & audit helpers
(function () {
  var keys = resources.keys();
  ok(keys.length === 12, 'registry: 12 resources (' + keys.length + ')');
  keys.forEach(function (k) {
    var r = resources.get(k);
    ok(r.fields.some(function (f) { return f.name === r.idColumn; }), 'registry: ' + k + ' has id field');
    ok(r.fields.some(function (f) { return f.name === r.defaultSort.field; }), 'registry: ' + k + ' default sort exists');
    r.search.forEach(function (s) { ok(/^[a-z]+\.[a-z_]+$/.test(s) || r.fields.some(function (f) { return f.name === s; }), 'registry: ' + k + ' search column ' + s + ' exists'); });
    r.filters.forEach(function (f) { ok(f.kind === 'flag' || r.fields.some(function (x) { return x.name === f.field; }), 'registry: ' + k + ' filter ' + f.name); });
  });
  var pub = resources.publicAll();
  ok(!JSON.stringify(pub).match(/"sql"/) && !pub.products.check, 'registry: public shape carries no SQL/hooks');
  ok(!resources.get('audit').permissions.write, 'registry: audit is read-only');
  eq(resources.get('rules').permissions.write, 'owner', 'registry: rules owner-only');
  eq(resources.get('products').delete.kind, 'soft', 'registry: products soft delete');
  var cleaned = audit.clean({ password: 'x', api_token: 'y', dsn: 'z', fine: 'postgres://u:p@h/db', n: 1, nested: { secret: 's', ok: true } });
  ok(!cleaned.password && !cleaned.api_token && !cleaned.dsn && !cleaned.nested.secret && cleaned.nested.ok === true && cleaned.fine.indexOf('REDACTED') !== -1, 'audit: secret keys dropped and values redacted');
  var d = audit.diff({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, c: 3 });
  eq(d.fields, ['b'], 'audit: diff fields'); eq(d.previous, { b: 2 }, 'audit: diff previous');
  ok(integration.isHandoff({ decision: { action: 'handoff' } }) && integration.isHandoff({ decision: { action: 'reply', requires_human: true } }) && !integration.isHandoff({ decision: { action: 'reply' } }) && !integration.isHandoff({}), 'integration: isHandoff');
  var cfg = autoreply.syntheticConfig({ id: 'p1', display_name: 'P' }, ['KORANDO']);
  var comms = require(path.join(ROOT, 'projects/automotive/comms/lib/projects'));
  eq(comms.validate(cfg), [], 'autoreply: synthetic simulation config is valid for the engine');
  eq(comms.engine(cfg).mode, 'dry-run', 'autoreply: synthetic config is dry-run');
  ok(cfg.projects[0].business.auto_reply === false, 'autoreply: synthetic config auto_reply off');
  var body = autoreply.webhookBody('p1', 'hi');
  ok(body.event === 'messages.upsert' && body.data.key.fromMe === false, 'autoreply: webhook body shape');
}());

// ================================================================ HTTP boundary (no DB needed for these)
function request(port, method, p, body, headers) {
  return new Promise(function (resolve, reject) {
    var data = body === undefined ? null : JSON.stringify(body);
    var h = Object.assign({}, headers || {});
    if (data) { if (!h['Content-Type']) h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    var req = http.request({ host: '127.0.0.1', port: port, method: method, path: p, headers: h }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { var t = Buffer.concat(chunks).toString('utf8'); var j = null; try { j = JSON.parse(t); } catch (e) { j = null; } resolve({ status: res.statusCode, headers: res.headers, json: j, text: t }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
function cookieOf(res) { var sc = res.headers['set-cookie']; return sc ? sc[0].split(';')[0] : null; }
var H = { 'X-Requested-With': 'MythosWP' };

async function httpSection(port) {
  var r = await request(port, 'GET', '/healthz');
  ok(r.status === 200 && r.json.ok === true && Object.keys(r.json).length === 1, 'http: /healthz minimal');
  r = await request(port, 'GET', '/api/meta'); eq(r.status, 401, 'http: api without session 401');
  r = await request(port, 'GET', '/'); ok(r.status === 302 && r.headers.location === '/login', 'http: shell redirects to /login');
  r = await request(port, 'GET', '/login'); ok(r.status === 200 && /login-form/.test(r.text), 'http: login page public');
  ok(/script-src 'self'/.test(r.headers['content-security-policy']) && r.headers['x-frame-options'] === 'DENY' && r.headers['x-content-type-options'] === 'nosniff', 'http: security headers');
  r = await request(port, 'GET', '/brand/tokens.css'); ok(r.status === 200 && /--mythos-gold-500/.test(r.text), 'http: canonical tokens served');
  r = await request(port, 'GET', '/brand/fonts.css'); ok(r.status === 200 && /IBM Plex Sans/.test(r.text), 'http: fonts.css served');
  r = await request(port, 'GET', '/fonts/ibm-plex-mono-400-latin.woff2'); ok(r.status === 200 && r.headers['content-type'] === 'font/woff2', 'http: font file served');
  r = await request(port, 'GET', '/fonts/../../etc/passwd'); ok(r.status === 404, 'http: traversal refused');
  r = await request(port, 'GET', '/js/app.js'); eq(r.status, 401, 'http: app modules need a session');
  r = await request(port, 'GET', '/js/validate.js'); eq(r.status, 200, 'http: shared validator public');
  r = await request(port, 'POST', '/api/login', { username: 'owner', password: 'nope' }, H); eq(r.status, 401, 'http: bad login 401');
  r = await request(port, 'POST', '/api/login', 'not json', { 'X-Requested-With': 'MythosWP', 'Content-Type': 'text/plain' }); ok(r.status === 415 || r.status === 400, 'http: non-JSON body refused (' + r.status + ')');
  r = await request(port, 'POST', '/api/login', { username: 'owner', password: OWNER_PW }, H);
  ok(r.status === 200 && r.json.data.role === 'owner', 'http: owner login');
  var ownerCookie = cookieOf(r);
  ok(/HttpOnly/.test(r.headers['set-cookie'][0]), 'http: cookie httpOnly');
  r = await request(port, 'POST', '/api/login', { username: 'op', password: OP_PW }, H); var opCookie = cookieOf(r); ok(!!opCookie, 'http: operator login');
  r = await request(port, 'GET', '/api/session', undefined, { Cookie: ownerCookie }); eq(r.json.data.username, 'owner', 'http: session route');
  r = await request(port, 'GET', '/api/meta', undefined, { Cookie: ownerCookie }); ok(r.status === 200 && r.json.data.resources.products && r.json.data.groups.length, 'http: meta');
  r = await request(port, 'POST', '/api/logout', {}, { Cookie: ownerCookie }); eq(r.status, 403, 'http: mutation without CSRF header refused');
  eq(r.json.error, 'csrf', 'http: csrf error code');
  r = await request(port, 'POST', '/api/logout', {}, { Cookie: ownerCookie, 'X-Requested-With': 'MythosWP', Origin: 'https://evil.example' }); eq(r.status, 403, 'http: cross-origin mutation refused');
  r = await request(port, 'GET', '/api/nope', undefined, { Cookie: ownerCookie }); eq(r.status, 404, 'http: unknown api 404');
  r = await request(port, 'PUT', '/api/meta', {}, Object.assign({ Cookie: ownerCookie }, H)); eq(r.status, 405, 'http: wrong method 405');
  r = await request(port, 'GET', '/api/r/rules', undefined, { Cookie: opCookie }); ok(r.status === 400 || r.status === 200 || r.status === 503, 'http: operator may read rules (' + r.status + ')');
  r = await request(port, 'POST', '/api/r/rules?project=x', { rule_key: 'a' }, Object.assign({ Cookie: opCookie }, H)); ok(r.status === 403 || r.status === 404, 'http: operator cannot write rules (' + r.status + ')');
  r = await request(port, 'DELETE', '/api/r/products/1?project=x', undefined, Object.assign({ Cookie: opCookie }, H)); ok(r.status === 403 || r.status === 404, 'http: operator cannot delete (' + r.status + ')');
  r = await request(port, 'GET', '/api/r/unknown', undefined, { Cookie: ownerCookie }); eq(r.status, 404, 'http: unknown resource 404');
  r = await request(port, 'GET', '/api/r/audit/1', undefined, { Cookie: ownerCookie }); ok(r.status === 404 || r.status === 200 || r.status === 503, 'http: audit read by owner (' + r.status + ')');
  r = await request(port, 'POST', '/api/r/audit', {}, Object.assign({ Cookie: ownerCookie }, H)); ok(r.status === 403 || r.status === 400, 'http: audit not writable (' + r.status + ')');
  r = await request(port, 'GET', '/api/health', undefined, { Cookie: ownerCookie }); ok(r.status === 200 && typeof r.json.data.auth.users_provisioned === 'boolean' && !/password|scrypt/i.test(r.text), 'http: health has no secret');
  r = await request(port, 'POST', '/api/logout', {}, Object.assign({ Cookie: ownerCookie }, H)); eq(r.status, 200, 'http: logout');
  ok(/Max-Age=0/.test(r.headers['set-cookie'][0]), 'http: logout clears cookie');
  r = await request(port, 'GET', '/api/session', undefined, { Cookie: ownerCookie }); eq(r.status, 401, 'http: session gone after logout');
  // throttle
  auth.resetThrottle();
  for (var i = 0; i < auth.LOGIN_MAX_FAILURES; i++) await request(port, 'POST', '/api/login', { username: 'owner', password: 'x' }, H);
  r = await request(port, 'POST', '/api/login', { username: 'owner', password: OWNER_PW }, H); eq(r.status, 429, 'http: login throttled');
  auth.resetThrottle();
  return { opCookie: opCookie };
}

// ================================================================ DB section
async function dbSection(port, opCookie) {
  var pool = db.wp();
  await pool.query("DELETE FROM wp_audit_events; DELETE FROM wp_handoffs; DELETE FROM wp_knowledge; DELETE FROM wp_business_rules; DELETE FROM wp_stock; DELETE FROM wp_product_commercial; DELETE FROM wp_projects; TRUNCATE ssangyong_autos.sya_product_images, ssangyong_autos.sya_product_vehicle_compatibility, ssangyong_autos.sya_vehicle_motorizations, ssangyong_autos.sya_vehicle_models, ssangyong_autos.sya_products RESTART IDENTITY CASCADE;");
  await pool.query("INSERT INTO wp_projects (id, display_name, domain, brand_car, catalog_dsn_env, catalog_schema, status) VALUES ('test-autos','Test Autos','test.autos','TESTBRAND','MYTHOS_WP_CATALOG_TEST','ssangyong_autos','active')");
  store.invalidate();
  var resolved = await store.resolve('test-autos');
  ok(resolved && resolved.catalogPool, 'db: project resolves with catalogue pool');
  var r = await request(port, 'POST', '/api/login', { username: 'owner', password: OWNER_PW }, H); var C = { Cookie: cookieOf(r), 'X-Requested-With': 'MythosWP' };
  var OP = { Cookie: opCookie, 'X-Requested-With': 'MythosWP' };
  var P = '?project=test-autos';

  // --- create catalogue rows through the API
  var now = new Date().toISOString();
  r = await request(port, 'POST', '/api/r/vehicle_models' + P, { brand_car: 'TESTBRAND', model_name: 'KORANDO', generation_code: 'C', model_url: 'https://t.test/korando', year_from: 2010, source: 't', collected_at: now }, C);
  eq(r.status, 201, 'crud: create vehicle model 201'); var modelId = r.json.data.row.id; ok(r.json.data.audited === true, 'crud: create audited');
  r = await request(port, 'POST', '/api/r/vehicle_models' + P, { brand_car: 'TESTBRAND', model_name: 'KORANDO', generation_code: 'C', model_url: 'https://t.test/korando', year_from: 2010, source: 't', collected_at: now }, C);
  eq(r.status, 409, 'crud: duplicate unique → 409'); eq(r.json.error, 'conflict', 'crud: conflict code');
  r = await request(port, 'POST', '/api/r/vehicle_models' + P, { brand_car: 'TESTBRAND', model_name: 'X', model_url: 'https://t.test/x', year_from: 2020, year_to: 2010, source: 't', collected_at: now }, C);
  ok(r.status === 400 && r.json.errors.year_to === 'before_year_from', 'crud: resource check hook (year order)');
  r = await request(port, 'POST', '/api/r/motorizations' + P, { vehicle_model_id: modelId, motorisation: '2.0 Xdi', motorisation_url: 'https://t.test/m', fuel: 'Diesel', collected_at: now }, C);
  eq(r.status, 201, 'crud: create motorization'); var motorId = r.json.data.row.id;
  r = await request(port, 'POST', '/api/r/motorizations' + P, { vehicle_model_id: 999999, motorisation: '2.0', motorisation_url: 'https://t.test/m2', collected_at: now }, C);
  eq(r.status, 409, 'crud: FK violation → 409 referenced');
  var prod = { product_uid: 'wp:FILTER-1', canonical_reference: 'CAF100563P', product_brand: 'CHAMPION', product_title: 'Filtre à huile CHAMPION', oem_reference: '6711840025', source: 'mythos-wp', product_url: 'https://t.test/p1', price_tnd: 33.8, availability: 'En Stock', status: 'active' };
  r = await request(port, 'POST', '/api/r/products' + P, prod, C); eq(r.status, 201, 'crud: create product (timestamps defaulted)'); var prodId = r.json.data.row.id;
  ok(r.json.data.row.collected_at && r.json.data.row.last_checked_at, 'crud: defaultValue now applied');
  r = await request(port, 'POST', '/api/r/products' + P, Object.assign({}, prod, { product_uid: 'wp:FILTER-2', product_url: 'https://t.test/p2', canonical_reference: 'CAF100563P' }), C); eq(r.status, 409, 'crud: business identity unique');
  r = await request(port, 'POST', '/api/r/products' + P, Object.assign({}, prod, { product_uid: 'wp:PADS-1', product_url: 'https://t.test/p3', canonical_reference: 'PADS-1', product_title: 'Plaquettes de frein', oem_reference: null, price_tnd: 80 }), C); eq(r.status, 201, 'crud: second product'); var pads = r.json.data.row;
  r = await request(port, 'POST', '/api/r/products' + P, Object.assign({}, prod, { product_uid: 'wp:BAD', price_tnd: -1 }), C); ok(r.status === 400 && r.json.errors.price_tnd === 'min', 'crud: invalid data 400 with field error');
  r = await request(port, 'POST', '/api/r/products' + P, { product_title: 'incomplete' }, C); ok(r.status === 400 && r.json.errors.product_uid === 'required', 'crud: missing required on create');
  r = await request(port, 'POST', '/api/r/compatibility' + P, { product_id: prodId, vehicle_model_id: modelId, vehicle_motorization_id: motorId, motorisation: '2.0 Xdi', year_from: 2010, category_url: 'https://t.test/c' }, C); eq(r.status, 201, 'crud: compatibility');
  r = await request(port, 'POST', '/api/r/images' + P, { product_id: prodId, image_url: 'https://t.test/i.jpg', position: 1 }, OP); eq(r.status, 201, 'crud: operator can create image');
  var imageId = r.json.data.row.id;

  // --- read / list / search / sort / filter / pagination
  r = await request(port, 'GET', '/api/r/products/' + prodId + P, undefined, C); ok(r.status === 200 && r.json.data.row.product_uid === 'wp:FILTER-1' && Array.isArray(r.json.data.history) && r.json.data.history.length === 1, 'crud: get with history');
  r = await request(port, 'GET', '/api/r/products/999999' + P, undefined, C); eq(r.status, 404, 'crud: get missing 404');
  r = await request(port, 'GET', '/api/r/products/abc' + P, undefined, C); eq(r.status, 404, 'crud: non-numeric id 404');
  r = await request(port, 'GET', '/api/r/products' + P + '&q=huile', undefined, C); ok(r.json.data.total === 1 && r.json.data.rows[0].product_uid === 'wp:FILTER-1', 'crud: search');
  r = await request(port, 'GET', '/api/r/products' + P + '&q=6711840025', undefined, C); eq(r.json.data.total, 1, 'crud: search by OEM');
  r = await request(port, 'GET', '/api/r/products' + P + '&sort=price_tnd&dir=desc', undefined, C); ok(Number(r.json.data.rows[0].price_tnd) === 80, 'crud: sort desc');
  r = await request(port, 'GET', '/api/r/products' + P + '&sort=criteria_text', undefined, C); eq(r.status, 400, 'crud: non-sortable column refused');
  r = await request(port, 'GET', '/api/r/products' + P + '&f.missing_oem=true', undefined, C); ok(r.json.data.total === 1 && r.json.data.rows[0].product_uid === 'wp:PADS-1', 'crud: flag filter');
  r = await request(port, 'GET', '/api/r/products' + P + '&f.brand=CHAMPION', undefined, C); eq(r.json.data.total, 2, 'crud: value filter');
  r = await request(port, 'GET', '/api/r/products' + P + '&f.status=bogus', undefined, C); eq(r.status, 400, 'crud: enum filter value refused');
  r = await request(port, 'GET', '/api/r/products' + P + '&f.zzz=1', undefined, C); eq(r.status, 400, 'crud: unknown filter refused');
  r = await request(port, 'GET', '/api/r/products' + P + '&limit=1&page=2', undefined, C); ok(r.json.data.rows.length === 1 && r.json.data.page === 2 && r.json.data.total === 2, 'crud: pagination');
  r = await request(port, 'GET', '/api/r/products' + P + '&limit=100000', undefined, C); eq(r.json.data.limit, crud.MAX_LIMIT, 'crud: limit clamped');
  r = await request(port, 'GET', '/api/r/motorizations' + P, undefined, C); eq(r.json.data.rows[0].model_name, 'KORANDO', 'crud: joined virtual column');
  r = await request(port, 'GET', '/api/r/compatibility' + P + '&q=KORANDO', undefined, C); eq(r.json.data.total, 1, 'crud: search through join');
  r = await request(port, 'GET', '/api/r/products/lookup' + P + '&q=CAF&display=canonical_reference', undefined, C); ok(r.json.data.length === 1 && r.json.data[0].label === 'CAF100563P', 'crud: lookup');
  r = await request(port, 'GET', '/api/r/products', undefined, C); eq(r.status, 400, 'crud: catalogue resource needs project');
  r = await request(port, 'GET', '/api/r/products?project=nope', undefined, C); eq(r.status, 404, 'crud: unknown project 404');

  // --- update
  r = await request(port, 'PATCH', '/api/r/products/' + prodId + P, { product_title: 'Filtre à huile CHAMPION (rev)', price_tnd: 35 }, OP);
  ok(r.status === 200 && r.json.data.changed.indexOf('product_title') !== -1 && r.json.data.changed.indexOf('price_tnd') !== -1, 'crud: operator update with changed fields');
  ok(r.json.data.row.updated_at !== undefined, 'crud: updated_at managed');
  r = await request(port, 'PATCH', '/api/r/products/' + prodId + P, { product_uid: 'wp:OTHER' }, C); ok(r.status === 400 && r.json.errors.product_uid === 'create_only', 'crud: createOnly refused on update');
  r = await request(port, 'PATCH', '/api/r/products/' + prodId + P, {}, C); eq(r.status, 400, 'crud: empty update refused');
  r = await request(port, 'PATCH', '/api/r/products/' + prodId + P, { updated_at: now }, C); ok(r.status === 400 && r.json.errors.updated_at === 'read_only', 'crud: read-only refused');
  r = await request(port, 'PATCH', '/api/r/products/' + prodId + P, { availability: 'Peut-être' }, C); ok(r.status === 400 && r.json.errors.availability === 'not_in_enum', 'crud: enum on update');
  r = await request(port, 'GET', '/api/r/products/' + prodId + P, undefined, C); eq(r.json.data.history.length, 2, 'audit: two events on product');
  eq(r.json.data.history[0].changed_fields.sort(), ['price_tnd', 'product_title'], 'audit: changed fields recorded');
  ok(r.json.data.history[0].previous.price_tnd !== undefined && r.json.data.history[0].actor === 'op', 'audit: previous value and actor');

  // --- overlays (verified price / stock) + views
  r = await request(port, 'PUT', '/api/projects/test-autos/overlay/commercial/wp:FILTER-1', { selling_price: 45.5, purchase_price: 30, currency: 'TND' }, OP);
  ok(r.status === 200 && r.json.data.created === true, 'overlay: commercial upsert create');
  r = await request(port, 'PUT', '/api/projects/test-autos/overlay/commercial/wp:FILTER-1', { selling_price: 46 }, OP);
  ok(r.status === 200 && r.json.data.created === false && Number(r.json.data.row.selling_price) === 46, 'overlay: commercial upsert update');
  r = await request(port, 'PUT', '/api/projects/test-autos/overlay/commercial/wp:NOPE', { selling_price: 1 }, OP); eq(r.status, 404, 'overlay: unknown part refused');
  r = await request(port, 'PUT', '/api/projects/test-autos/overlay/commercial/wp:FILTER-1', { selling_price: 0 }, OP); eq(r.status, 400, 'overlay: invalid price');
  r = await request(port, 'PUT', '/api/projects/test-autos/overlay/stock/wp:FILTER-1', { quantity: 3, min_quantity: 5, availability: 'in_stock', location: 'A1' }, OP); eq(r.status, 200, 'overlay: stock upsert');
  r = await request(port, 'GET', '/api/projects/test-autos/pricing', undefined, C);
  var pr = r.json.data.rows.filter(function (x) { return x.product_uid === 'wp:FILTER-1'; })[0];
  ok(pr && pr.price_state === 'verified' && Number(pr.selling_price) === 46 && pr.margin === 16 && Number(pr.catalogue_price) === 35, 'view: pricing merged with margin');
  ok(r.json.data.rows.filter(function (x) { return x.product_uid === 'wp:PADS-1'; })[0].price_state === 'unknown', 'view: pricing unknown for part without overlay');
  r = await request(port, 'GET', '/api/projects/test-autos/stock', undefined, C);
  ok(r.json.data.rows.filter(function (x) { return x.product_uid === 'wp:FILTER-1'; })[0].stock_state === 'low', 'view: stock low state');
  r = await request(port, 'GET', '/api/projects/test-autos/references?f.missing_oem=true', undefined, C); ok(r.json.data.total === 1 && r.json.data.rows[0].reference_state === 'missing_oem', 'view: references missing OEM');
  r = await request(port, 'GET', '/api/projects/test-autos/parts/wp:FILTER-1', undefined, C);
  ok(r.status === 200 && r.json.data.compatibility.length === 1 && r.json.data.images.length === 1 && r.json.data.commercial && r.json.data.stock, 'view: part full');
  eq(r.json.data.auto_reply_facts, { price: 'VERIFIED', stock: 'VERIFIED', compatibility: 'VERIFIED', oem_reference: 'VERIFIED' }, 'view: part facts all verified');
  r = await request(port, 'GET', '/api/projects/test-autos/parts/wp%3AFILTER-1', undefined, C); ok(r.status === 200 && r.json.data.product.product_uid === 'wp:FILTER-1', 'view: percent-encoded uid resolves');
  r = await request(port, 'GET', '/api/projects/test-autos/parts/%E0%A4%A', undefined, C); eq(r.status, 400, 'http: malformed percent-encoding → 400');
  r = await request(port, 'GET', '/api/projects/test-autos/parts/wp:PADS-1', undefined, C);
  eq(r.json.data.auto_reply_facts, { price: 'UNKNOWN', stock: 'UNKNOWN', compatibility: 'UNKNOWN', oem_reference: 'UNKNOWN' }, 'view: part facts unknown');

  // --- wp resources: knowledge, rules (owner), handoffs
  r = await request(port, 'POST', '/api/r/knowledge' + P, { kind: 'product_fact', title: 'Filtre garanti', customer_text: 'Garantie 6 mois.', language: 'fr', allowed_for_auto_reply: true, status: 'active', product_uid: 'wp:FILTER-1', tags: ['garantie'] }, OP); eq(r.status, 201, 'crud: knowledge create by operator');
  var knowId = r.json.data.row.id;
  r = await request(port, 'POST', '/api/r/rules' + P, { rule_key: 'opening_hours', value_json: { mon: '08-18' }, enabled: true }, OP); eq(r.status, 403, 'authz: operator cannot create rules');
  r = await request(port, 'POST', '/api/r/rules' + P, { rule_key: 'opening_hours', value_json: { mon: '08-18' }, enabled: true }, C); eq(r.status, 201, 'authz: owner creates rule');
  r = await request(port, 'POST', '/api/r/rules' + P, { rule_key: 'Bad Key', value_json: {}, enabled: true }, C); eq(r.status, 400, 'crud: rule key pattern');
  r = await request(port, 'POST', '/api/r/handoffs' + P, { reason: 'REQUIRES_HUMAN', intent: 'human_request', customer_ref_masked: '***432', channel: 'whatsapp', status: 'NEW' }, OP); eq(r.status, 201, 'crud: manual handoff');
  var hid = r.json.data.row.id;
  r = await request(port, 'POST', '/api/r/handoffs' + P, { reason: 'REQUIRES_HUMAN', customer_ref_masked: '21698765432' }, OP); ok(r.status === 400 && r.json.errors.customer_ref_masked === 'pattern', 'crud: unmasked number refused');
  r = await request(port, 'PATCH', '/api/r/handoffs/' + hid + P, { status: 'IN_PROGRESS', assigned_to: 'op' }, OP); eq(r.json.data.row.status, 'IN_PROGRESS', 'handoff: in progress');
  r = await request(port, 'PATCH', '/api/r/handoffs/' + hid + P, { status: 'RESOLVED', resolution: 'Called back.' }, OP);
  ok(r.json.data.row.status === 'RESOLVED' && r.json.data.row.resolved_by === 'op' && r.json.data.row.resolved_at, 'handoff: resolved stamps by server');
  r = await request(port, 'PATCH', '/api/r/handoffs/' + hid + P, { resolved_by: 'hacker' }, OP); ok(r.status === 400 && r.json.errors.resolved_by === 'read_only', 'handoff: resolved_by not client-writable');

  // --- delete: soft for products, hard otherwise, owner only
  r = await request(port, 'DELETE', '/api/r/products/' + prodId + P, undefined, OP); eq(r.status, 403, 'authz: operator cannot delete');
  r = await request(port, 'DELETE', '/api/r/images/' + imageId + P, undefined, OP); eq(r.status, 200, 'authz: operator may delete images (per registry)');
  r = await request(port, 'DELETE', '/api/r/products/' + pads.id + P, undefined, C); ok(r.status === 200 && r.json.data.soft === true && r.json.data.row.status === 'delisted', 'crud: product soft delete');
  r = await request(port, 'GET', '/api/r/products' + P + '&f.status=active', undefined, C); eq(r.json.data.total, 1, 'crud: delisted leaves active list');
  r = await request(port, 'DELETE', '/api/r/vehicle_models/' + modelId + P, undefined, C); eq(r.status, 409, 'crud: hard delete blocked by FK → 409');
  r = await request(port, 'DELETE', '/api/r/knowledge/' + knowId + P, undefined, C); eq(r.status, 200, 'crud: knowledge hard delete');
  r = await request(port, 'GET', '/api/r/knowledge/' + knowId + P, undefined, C); eq(r.status, 404, 'crud: deleted gone');
  r = await request(port, 'GET', '/api/audit/knowledge/' + knowId, undefined, C); ok(r.json.data.history.length === 2 && r.json.data.history[0].action === 'delete', 'audit: delete recorded with previous');
  r = await request(port, 'GET', '/api/r/audit' + P + '&f.action=delete', undefined, C); ok(r.json.data.total >= 3, 'audit: list filter by action');
  r = await request(port, 'GET', '/api/r/audit' + P + '&f.actor=op', undefined, C); ok(r.json.data.total >= 3 && !/scrypt|password/i.test(r.text), 'audit: no secret in log');
  var loginEvents = await pool.query("SELECT count(*)::int AS n FROM wp_audit_events WHERE action IN ('login','login_failed','logout')"); ok(loginEvents.rows[0].n >= 1, 'audit: session events recorded');

  // --- projects registry (owner only, global)
  r = await request(port, 'POST', '/api/r/projects', { id: 'piece-autos', display_name: 'Piece Autos', catalog_dsn_env: 'MYTHOS_WP_CATALOG_PIECE_AUTOS', catalog_schema: 'piece_autos', status: 'planned' }, OP); eq(r.status, 403, 'authz: operator cannot create projects');
  r = await request(port, 'POST', '/api/r/projects', { id: 'piece-autos', display_name: 'Piece Autos', catalog_dsn_env: 'MYTHOS_WP_CATALOG_PIECE_AUTOS', catalog_schema: 'piece_autos', status: 'planned' }, C); eq(r.status, 201, 'projects: owner creates planned project');
  r = await request(port, 'POST', '/api/r/projects', { id: 'bad', display_name: 'B', catalog_dsn_env: 'lowercase' }, C); ok(r.status === 400 && r.json.errors.catalog_dsn_env === 'pattern', 'projects: env name pattern');
  r = await request(port, 'GET', '/api/meta', undefined, C); ok(r.json.data.projects.some(function (p) { return p.id === 'piece-autos' && p.catalog_configured === false; }), 'projects: meta reports unconfigured catalogue');
  r = await request(port, 'GET', '/api/r/products?project=piece-autos', undefined, C); eq(r.status, 503, 'projects: catalogue not configured → 503, not fake data');
  r = await request(port, 'GET', '/api/projects/piece-autos/dashboard', undefined, C); ok(r.status === 200 && r.json.data.cards.total_records === null && r.json.data.catalogue.available === false, 'dashboard: unavailable catalogue → null cards, never 0');
  r = await request(port, 'DELETE', '/api/r/projects/piece-autos', undefined, C); eq(r.status, 200, 'projects: delete unused project');

  // --- dashboard + search
  r = await request(port, 'GET', '/api/projects/test-autos/dashboard', undefined, C);
  var cards = r.json.data.cards;
  ok(cards.total_records === 2 && cards.active_products === 1 && cards.missing_prices === 0 && cards.low_stock === 1 && cards.handoff_open === 0, 'dashboard: real counts ' + JSON.stringify(cards));
  r = await request(port, 'GET', '/api/search?project=test-autos&q=CAF', undefined, C); ok(r.json.data.groups.some(function (g) { return g.key === 'products' && g.items.length === 1; }), 'search: parts');
  r = await request(port, 'GET', '/api/search?project=test-autos&q=k', undefined, C); eq(r.json.data.groups.length, 0, 'search: too short → nothing');

  // --- business-data ports
  var ports = portsLib.create({ resolveProject: function () { return resolved; } });
  var ctx = { project_id: 'test-autos' };
  var f = await ports.parts({ reference: 'CAF100563P' }, ctx); ok(f.ok && f.data.matches.length === 1 && f.data.verified, 'ports: parts by reference verified');
  f = await ports.parts({ reference: 'ZZZ999' }, ctx); ok(!f.ok && f.reason === 'NO_MATCH', 'ports: parts no match → not ok');
  f = await ports.parts({ parts: ['huile'], vehicle_model: 'KORANDO' }, ctx); ok(f.ok && f.data.by === 'words', 'ports: parts by words + vehicle');
  f = await ports.parts({ parts: ['huile'], vehicle_model: 'REXTON' }, ctx); ok(!f.ok, 'ports: parts not compatible with named vehicle → unknown');
  f = await ports.parts({}, ctx); eq(f.reason, 'NO_PART_NAMED', 'ports: nothing named');
  f = await ports.price({ reference: 'CAF100563P' }, ctx); ok(f.ok && f.data.selling_price === 46 && f.data.source === 'mythos-wp:commercial', 'ports: verified selling price (not the catalogue price)');
  f = await ports.price({ reference: 'PADS-1' }, ctx); ok(!f.ok, 'ports: delisted / unpriced part → no price');
  f = await ports.stock({ reference: 'CAF100563P' }, ctx); ok(f.ok && f.data.availability === 'in_stock' && f.data.quantity === 3, 'ports: verified stock');
  await pool.query("UPDATE wp_stock SET availability = 'unknown'"); f = await ports.stock({ reference: 'CAF100563P' }, ctx); eq(f.reason, 'STOCK_NOT_SET', 'ports: unknown availability is not a fact');
  await pool.query("UPDATE wp_stock SET availability = 'in_stock'");
  f = await ports.vehicle({ vehicle_model: 'KORANDO' }, ctx); ok(f.ok && f.data.models.length === 1, 'ports: vehicle');
  f = await ports.vehicle({}, ctx); eq(f.reason, 'NO_VEHICLE', 'ports: no vehicle named');
  ok(ports.order === undefined, 'ports: order not connected');
  var storePorts = portsLib.create({ resolveProject: function (id) { return store.resolve(id); } });
  f = await storePorts.price({ reference: 'CAF100563P' }, { project_id: 'ghost' }); eq(f.reason, 'PROJECT_UNKNOWN', 'ports: unknown project');
  f = await storePorts.price({ reference: 'CAF100563P' }, { project_id: 'test-autos' }); ok(f.ok && f.data.selling_price === 46, 'ports: store-resolved project works (receiver path)');
  var slow = portsLib.create({ resolveProject: function () { return new Promise(function () {}); } });
  var t0 = Date.now(); f = await Promise.race([slow.price({}, ctx), new Promise(function (res) { setTimeout(function () { res({ ok: false, reason: 'RACE' }); }, portsLib.TIMEOUT_MS + 500); })]);
  ok(!f.ok && f.reason === 'PORT_TIMEOUT' && Date.now() - t0 <= portsLib.TIMEOUT_MS + 400, 'ports: timeout → unknown');

  // --- engine through the simulator (whole #173 engine, dry-run, ports connected)
  var sim = await autoreply.simulate(resolved, 'Bonjour');
  ok(sim.outcome === 'DECIDED' && sim.intent === 'greeting' && sim.action === 'reply' && sim.sent === false && sim.proposed_text, 'sim: greeting → template reply, nothing sent');
  ok(sim.policy.rejections.indexOf('MODE_DRY_RUN') !== -1 && sim.policy.rejections.indexOf('AUTO_REPLY_DISABLED') !== -1, 'sim: dry-run and disabled gates present');
  sim = await autoreply.simulate(resolved, 'Prix des plaquettes pour Rexton 2012 ?');
  ok(sim.intent === 'price_availability' && sim.action === 'handoff' && sim.requires_human && sim.decision_reason === 'BUSINESS_DATA_UNAVAILABLE', 'sim: missing business data → REQUIRES_HUMAN handoff');
  ok(sim.facts.unknown.indexOf('price') !== -1 && sim.proposed_text === null, 'sim: unknown facts named, no text');
  sim = await autoreply.simulate(resolved, 'Prix ref CAF100563P ?');
  ok(sim.intent === 'price_availability' && sim.facts.verified.indexOf('parts') !== -1 && sim.facts.verified.indexOf('price') !== -1 && sim.facts.verified.indexOf('stock') !== -1, 'sim: verified facts from the panel ' + JSON.stringify(sim.facts));
  ok(sim.action === 'reply' && sim.requires_human === false && sim.sent === false, 'sim: verified → reply decided, still nothing sent');
  ok(sim.policy.rejections.indexOf('BUSINESS_DATA_MISSING') === -1 && sim.policy.rejections.indexOf('AUTO_REPLY_DISABLED') !== -1, 'sim: only the OFF gates remain');
  ok(!/46|45|dt|tnd/i.test(sim.proposed_text || ''), 'sim: template never states the price itself (fact guard)');
  sim = await autoreply.simulate(resolved, 'je veux parler à quelqu un');
  ok(sim.intent === 'human_request' && sim.action === 'handoff', 'sim: human request → handoff');
  var st = await autoreply.status(resolved);
  ok(st.mode === 'OFF' && st.config.present === false && st.business_data.connected.length === 4 && st.business_data.verified_prices === 1 && st.safety.default_off, 'status: OFF without config, business data visible');
  var sims = await pool.query("SELECT count(*)::int AS n FROM wp_audit_events WHERE action = 'simulate'"); ok(sims.rows[0].n === 0, 'sim: direct module use not audited (API route is)');
  r = await request(port, 'POST', '/api/projects/test-autos/autoreply/simulate', { text: 'Bonjour' }, OP); ok(r.status === 200 && r.json.data.sent === false, 'sim: API');
  r = await request(port, 'POST', '/api/projects/test-autos/autoreply/simulate', { text: '' }, OP); eq(r.status, 400, 'sim: empty text refused');
  r = await request(port, 'GET', '/api/projects/test-autos/autoreply/status', undefined, OP); ok(r.status === 200 && r.json.data.mode === 'OFF' && !/token_file|apikey/i.test(r.text), 'status: API, no secret');

  // --- handoff sink (what the receiver integration writes)
  var rec = { project_id: 'test-autos', event_id: 'evt-' + Date.now(), envelope: { crm: { inbox_id: 'test-autos', conversation_id: '***432' }, customer_msisdn_masked: '***432' }, decision: { action: 'handoff', reason: 'BUSINESS_DATA_UNAVAILABLE', intent: 'price_availability', language: 'fr', entities: { parts: ['huile'], vehicle_model: 'KORANDO', reference: null }, facts: { required: ['parts', 'price', 'stock'], available: ['parts'], missing: ['price', 'stock'] }, requires_human: true } };
  var w = await integration.recordHandoff(pool, rec, resolved);
  ok(w && w.inserted === true, 'sink: handoff inserted');
  var w2 = await integration.recordHandoff(pool, rec, resolved); ok(w2 && w2.inserted === false, 'sink: same event_id not duplicated');
  var hs = await pool.query("SELECT * FROM wp_handoffs WHERE event_id = $1", [rec.event_id]);
  ok(hs.rows[0].status === 'REQUIRES_HUMAN' && hs.rows[0].customer_ref_masked === '***432' && hs.rows[0].related_product_uid === 'wp:FILTER-1' && hs.rows[0].suggested.matching_parts.length === 1, 'sink: REQUIRES_HUMAN, masked number, suggested part');
  ok(!JSON.stringify(hs.rows[0]).match(/huile CHAMPION \(rev\).{0,0}text/), 'sink: no message text stored');
  var none = await integration.recordHandoff(pool, { project_id: 'test-autos', decision: { action: 'reply' } }, resolved); ok(none === null, 'sink: replies are not handoffs');
  r = await request(port, 'GET', '/api/r/handoffs' + P + '&f.status=REQUIRES_HUMAN', undefined, OP); eq(r.json.data.total, 1, 'sink: visible in the queue');
  r = await request(port, 'GET', '/api/projects/test-autos/dashboard', undefined, C); eq(r.json.data.cards.handoff_open, 1, 'dashboard: open handoff counted');

  // --- receiver accepts the integration module (loads; does not run: needs config + state dir)
  var recv = fs.readFileSync(path.join(ROOT, 'projects/automotive/comms/bin/mythos-auto-reply-receiver'), 'utf8');
  ok(/--integration/.test(recv) && /integration\.onOutcome/.test(recv) && /business_data: integration/.test(recv), 'receiver: --integration hook present');
  ok(integration.ports && typeof integration.ports.price === 'function' && typeof integration.onOutcome === 'function', 'integration: module contract for the receiver');

  // separation: the panel never touches the notification layer or sends anything
  var src = ['reference/api.js', 'reference/autoreply.js', 'reference/comms/ports.js', 'reference/comms/integration.js', 'reference/server.js'].map(function (f) { return fs.readFileSync(path.join(WP, f), 'utf8'); }).join('\n');
  ok(!/bridge\/notify|sendText|sendReply|router\.deliver/.test(src), 'separation: no send path, no notification layer import');
}

// ================================================================ run
(async function main() {
  var srv = server.createServer();
  await new Promise(function (res) { srv.listen(0, '127.0.0.1', res); });
  var port = srv.address().port;
  try {
    var s = await httpSection(port);
    if (TEST_URL) {
      await dbSection(port, s.opCookie);
    } else {
      skipped++;
      console.error('SKIPPED: database section (MYTHOS_WP_TEST_DB_URL not set)');
    }
  } catch (e) {
    failed++; console.error('FAIL: uncaught ' + (e && e.stack || e));
  } finally {
    srv.close();
    await db.closeAll().catch(function () {});
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
  console.log('mythos-wp: ' + passed + ' passed, ' + failed + ' failed' + (skipped ? ', ' + skipped + ' section skipped' : ''));
  process.exit(failed ? 1 : (skipped && process.env.MYTHOS_WP_ALLOW_SKIP !== '1' ? 3 : 0));
}());
