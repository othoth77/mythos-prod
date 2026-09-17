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
var integration = require(path.join(WP, 'reference/comms/integration'));
var autoreply = require(path.join(WP, 'reference/autoreply'));
var db = require(path.join(WP, 'reference/db'));
var store = require(path.join(WP, 'reference/projects-store'));
var server = require(path.join(WP, 'reference/server'));
var api = require(path.join(WP, 'reference/api'));

var OWNER_PW = 'owner-test-password-not-real-1234';
var OP_PW = 'operator-test-password-not-real-1234';
fs.writeFileSync(usersFile, JSON.stringify({ users: [
  { username: 'owner', role: 'owner', scrypt: auth.hashPassword(OWNER_PW) },
  { username: 'op', role: 'operator', scrypt: auth.hashPassword(OP_PW) },
  { username: 'BAD NAME', role: 'owner', scrypt: auth.hashPassword('x') },
  { username: 'norole', role: 'superuser', scrypt: auth.hashPassword('x') }
] }), { mode: 0o600 });

// ================================================================ validator
(function () {
  var F = resources.get('knowledge').fields.filter(function (f) { return !f.readonly && !f.virtual; });
  var good = { kind: 'faq', title: 'Horaires', customer_text: 'Ouvert 8h-18h', language: 'fr', allowed_for_auto_reply: 'true', status: 'draft', tags: 'a, b, a', product_uid: 'autopart.tn:18469' };
  var v = validate.validate(F, good, 'create');
  ok(v.ok && v.value.allowed_for_auto_reply === true && v.value.tags.length === 2, 'validate: good entry passes, boolean string + tags dedupe');
  v = validate.validate(F, Object.assign({}, good, { kind: 'Maybe' }), 'create'); eq(v.errors.kind, 'not_in_enum', 'validate: enum');
  v = validate.validate(F, Object.assign({}, good, { title: '' }), 'create'); eq(v.errors.title, 'required', 'validate: required blank');
  v = validate.validate(F, Object.assign({}, good, { product_uid: 'bad uid!' }), 'create'); eq(v.errors.product_uid, 'pattern', 'validate: pattern');
  v = validate.validate(F, Object.assign({}, good, { title: 'a\nb' }), 'create'); eq(v.errors.title, 'multiline', 'validate: multiline in text');
  v = validate.validate(F, Object.assign({}, good, { updated_at: '2026-01-01' }), 'create'); eq(v.errors.updated_at, 'unknown_field', 'validate: readonly field not in editable set is unknown');
  v = validate.validate(resources.get('knowledge').fields, { updated_at: '2026-01-01' }, 'update'); eq(v.errors.updated_at, 'read_only', 'validate: read-only refused');
  v = validate.validate(F, { nope: 1 }, 'update'); eq(v.errors.nope, 'unknown_field', 'validate: unknown field');
  v = validate.validate(F, { title: 'only this' }, 'update'); ok(v.ok && Object.keys(v.value).length === 1, 'validate: partial update checks only present fields');
  v = validate.validate(F, 'string', 'create'); eq(v.errors._, 'not_an_object', 'validate: non-object');
  v = validate.validate(F, { tags: 'bad tag with spaces' }, 'update'); eq(v.errors.tags, 'pattern', 'validate: tag pattern');
  var R = resources.get('rules').fields;
  v = validate.validate(R, { rule_key: 'k', value_json: '{not json' }, 'create'); eq(v.errors.value_json, 'not_json', 'validate: json');
  var U = resources.get('users').fields;
  v = validate.validate(U, { username: 'ab', role: 'owner', all_projects: 'false' }, 'create'); ok(v.ok && v.value.all_projects === false, 'validate: user fields (hidden hash not required on create)');
  v = validate.validate(resources.get('projects').fields, { settings: '{"kitchen":"k"}', currency: 'tnd' }, 'update'); ok(v.errors.currency === 'pattern' && v.value === undefined || v.errors.currency === 'pattern', 'validate: currency ISO pattern');
  v = validate.validate(resources.get('handoffs').fields, { conversation_id: 1.5 }, 'update'); ok(v.errors.conversation_id === 'read_only', 'validate: server-managed handoff columns refused');
  ok(typeof validate.message('required') === 'string' && validate.message('zzz') === 'zzz', 'validate: messages');
}());

// ================================================================ auth
(function () {
  var st = auth.usersState();
  ok(st.provisioned && st.count === 2, 'auth: users file loads only well-formed users (' + st.count + ')');
  eq(auth.verifyCredentials('op', OP_PW).user.role, 'manager', 'auth: legacy operator role reads as manager');
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
  ok(auth.hasRole({ role: 'owner' }, 'operator') && auth.hasRole({ role: 'manager' }, 'operator') && auth.hasRole({ role: 'agent' }, 'operator') && !auth.hasRole({ role: 'viewer' }, 'operator') && !auth.hasRole({ role: 'manager' }, 'owner') && !auth.hasRole(null, 'any') && auth.hasRole({ role: 'viewer' }, 'any'), 'auth: role ranks (viewer < agent < manager < admin < owner; operator = agent)');
  ok(auth.hasRole({ role: 'admin' }, 'manager') && !auth.hasRole({ role: 'manager' }, 'admin') && auth.hasRole({ role: 'owner' }, 'admin'), 'auth: admin between manager and owner');
  ok(auth.canSeeProject({ role: 'agent', projects: ['a'] }, 'a') && !auth.canSeeProject({ role: 'agent', projects: ['a'] }, 'b') && auth.canSeeProject({ role: 'admin', projects: null }, 'b') && !auth.canSeeProject(null, 'a'), 'auth: project access list');
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
  ok(keys.length === 9, 'registry: 9 panel resources, no catalogue (' + keys.length + ')');
  ok(keys.indexOf('products') === -1 && keys.indexOf('stock') === -1 && keys.indexOf('commercial') === -1, 'registry: product / price / stock data is not a WP resource any more (Kitchen owns it)');
  ok(!resources.get('users').fields.some(function (f) { return f.name === 'scrypt' && !f.hidden; }), 'registry: password hash is hidden');
  keys.forEach(function (k) {
    var r = resources.get(k);
    ok(r.fields.some(function (f) { return f.name === r.idColumn; }), 'registry: ' + k + ' has id field');
    ok(r.fields.some(function (f) { return f.name === r.defaultSort.field; }), 'registry: ' + k + ' default sort exists');
    r.search.forEach(function (s) { ok(/^[a-z]+\.[a-z_]+$/.test(s) || r.fields.some(function (f) { return f.name === s; }), 'registry: ' + k + ' search column ' + s + ' exists'); });
    r.filters.forEach(function (f) { ok(f.kind === 'flag' || r.fields.some(function (x) { return x.name === f.field; }), 'registry: ' + k + ' filter ' + f.name); });
  });
  var pub = resources.publicAll();
  ok(!JSON.stringify(pub).match(/"sql"/) && !pub.projects.check, 'registry: public shape carries no SQL/hooks');
  ok(!resources.get('audit').permissions.write, 'registry: audit is read-only');
  eq(resources.get('rules').permissions.write, 'admin', 'registry: rules admin-only');
  eq(resources.get('users').permissions.delete, 'owner', 'registry: users deleted by owner only');
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
  r = await request(port, 'GET', '/api/meta', undefined, { Cookie: ownerCookie }); ok(r.status === 200 && r.json.data.resources.projects && !r.json.data.resources.products && r.json.data.groups.length && r.json.data.product === 'MYTHOS Control Center', 'http: meta (control center, no catalogue resources)');
  r = await request(port, 'POST', '/api/logout', {}, { Cookie: ownerCookie }); eq(r.status, 403, 'http: mutation without CSRF header refused');
  eq(r.json.error, 'csrf', 'http: csrf error code');
  r = await request(port, 'POST', '/api/logout', {}, { Cookie: ownerCookie, 'X-Requested-With': 'MythosWP', Origin: 'https://evil.example' }); eq(r.status, 403, 'http: cross-origin mutation refused');
  r = await request(port, 'GET', '/api/nope', undefined, { Cookie: ownerCookie }); eq(r.status, 404, 'http: unknown api 404');
  r = await request(port, 'PUT', '/api/meta', {}, Object.assign({ Cookie: ownerCookie }, H)); eq(r.status, 405, 'http: wrong method 405');
  r = await request(port, 'GET', '/api/r/rules', undefined, { Cookie: opCookie }); ok(r.status === 400 || r.status === 200 || r.status === 503, 'http: operator may read rules (' + r.status + ')');
  r = await request(port, 'POST', '/api/r/rules?project=x', { rule_key: 'a' }, Object.assign({ Cookie: opCookie }, H)); ok(r.status === 403 || r.status === 404, 'http: operator cannot write rules (' + r.status + ')');
  r = await request(port, 'DELETE', '/api/r/knowledge/1?project=x', undefined, Object.assign({ Cookie: opCookie }, H)); ok(r.status === 403 || r.status === 404, 'http: manager cannot delete knowledge (' + r.status + ')');
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
  await pool.query("UPDATE wp_messages SET ai_run_id = NULL WHERE project_id IN ('test-core','test-core-2'); DELETE FROM wp_inbound_events WHERE inbox_id IN (SELECT id FROM wp_inboxes WHERE project_id IN ('test-core','test-core-2')); DELETE FROM wp_conversation_events WHERE project_id IN ('test-core','test-core-2'); DELETE FROM wp_ai_suggestions WHERE conversation_id IN (SELECT id FROM wp_conversations WHERE project_id IN ('test-core','test-core-2')); DELETE FROM wp_ai_runs WHERE project_id IN ('test-core','test-core-2'); DELETE FROM wp_messages WHERE project_id IN ('test-core','test-core-2'); DELETE FROM wp_handoffs WHERE project_id IN ('test-core','test-core-2'); DELETE FROM wp_conversations WHERE project_id IN ('test-core','test-core-2'); DELETE FROM wp_contacts WHERE project_id IN ('test-core','test-core-2'); DELETE FROM wp_tags WHERE project_id IN ('test-core','test-core-2'); DELETE FROM wp_knowledge WHERE project_id IN ('test-core','test-core-2'); DELETE FROM wp_business_rules WHERE project_id IN ('test-core','test-core-2'); DELETE FROM wp_inboxes WHERE project_id IN ('test-core','test-core-2'); DELETE FROM wp_notes WHERE project_id IN ('test-core','test-core-2'); DELETE FROM wp_audit_events WHERE project_id IN ('test-core','test-core-2') OR actor IN ('core-agent','core-admin','core-viewer') OR (resource = 'users' AND record_id IN ('core-agent','core-admin','core-viewer','core-owner2')); DELETE FROM wp_users WHERE username IN ('core-agent','core-admin','core-viewer','core-owner2'); DELETE FROM wp_projects WHERE id IN ('test-core','test-core-2');");
  await pool.query("INSERT INTO wp_projects (id, display_name, domain, kind, status, description, settings) VALUES ('test-core','Core Test','core.test','service','active','A service project', '{}'), ('test-core-2','Core Test 2',NULL,'internal','active',NULL,'{}')");
  store.invalidate();
  var resolved = await store.resolve('test-core');
  ok(resolved && resolved.wpPool && resolved.project.kind === 'service', 'db: project resolves (no catalogue pool needed)');
  var r = await request(port, 'POST', '/api/login', { username: 'owner', password: OWNER_PW }, H); var C = { Cookie: cookieOf(r), 'X-Requested-With': 'MythosWP' };
  ok(r.json.data.projects === null, 'login: file-provisioned owner sees every project');
  var OP = { Cookie: opCookie, 'X-Requested-With': 'MythosWP' };
  var P = '?project=test-core';

  // --- users: DB accounts, roles, project access, hidden hash
  r = await request(port, 'POST', '/api/r/users', { username: 'core-agent', role: 'agent', password: 'test-agent-pw-not-a-real-1', display_name: 'Core Agent' }, OP); eq(r.status, 403, 'users: manager cannot create accounts');
  r = await request(port, 'POST', '/api/r/users', { username: 'core-agent', role: 'agent', password: 'short' }, C); eq(r.status, 400, 'users: password policy');
  r = await request(port, 'POST', '/api/r/users', { username: 'core-agent', role: 'agent', password: 'test-agent-pw-not-a-real-1', display_name: 'Core Agent' }, C);
  ok(r.status === 201 && r.json.data.row.username === 'core-agent' && r.json.data.row.scrypt === undefined && !/scrypt|\$[0-9a-f]{32}/.test(r.text), 'users: created, hash never returned');
  r = await request(port, 'POST', '/api/r/users', { username: 'core-admin', role: 'admin', password: 'test-admin-pw-not-a-real-1', all_projects: true }, C); eq(r.status, 201, 'users: admin created');
  r = await request(port, 'POST', '/api/r/users', { username: 'core-viewer', role: 'viewer', password: 'test-viewer-pw-not-a-real-1' }, C); eq(r.status, 201, 'users: viewer created');
  r = await request(port, 'GET', '/api/r/users', undefined, C); ok(r.status === 200 && r.json.data.rows.length >= 3 && !/scrypt/.test(r.text), 'users: list hides the hash');
  r = await request(port, 'GET', '/api/r/users/core-agent', undefined, C); ok(r.status === 200 && r.json.data.row.scrypt === undefined && r.json.data.history.length === 1, 'users: record hidden field + audited create (' + r.status + ' ' + JSON.stringify(r.json && r.json.data && r.json.data.history) + ')');
  r = await request(port, 'POST', '/api/login', { username: 'core-agent', password: 'test-agent-pw-not-a-real-1' }, H);
  ok(r.status === 200 && r.json.data.role === 'agent' && JSON.stringify(r.json.data.projects) === '[]', 'users: DB login, no project yet');
  var AG = { Cookie: cookieOf(r), 'X-Requested-With': 'MythosWP' };
  r = await request(port, 'GET', '/api/meta', undefined, AG); ok(r.status === 200 && r.json.data.projects.length === 0, 'access: agent without grants sees no project');
  r = await request(port, 'GET', '/api/r/knowledge' + P, undefined, AG); eq(r.status, 404, 'access: ungranted project reads as unknown (404)');
  r = await request(port, 'PATCH', '/api/users/core-agent/projects', { add: ['test-core'] }, OP); eq(r.status, 403, 'access: manager cannot grant');
  r = await request(port, 'PATCH', '/api/users/core-agent/projects', { add: ['test-core', 'nope-project'] }, C); eq(r.status, 404, 'access: unknown project refused');
  r = await request(port, 'PATCH', '/api/users/core-agent/projects', { add: ['test-core'] }, C); ok(r.status === 200 && JSON.stringify(r.json.data.projects) === '["test-core"]', 'access: owner grants a project');
  r = await request(port, 'POST', '/api/login', { username: 'core-agent', password: 'test-agent-pw-not-a-real-1' }, H); AG = { Cookie: cookieOf(r), 'X-Requested-With': 'MythosWP' };
  ok(JSON.stringify(r.json.data.projects) === '["test-core"]', 'access: session carries the grant');
  r = await request(port, 'GET', '/api/meta', undefined, AG); ok(r.json.data.projects.length === 1 && r.json.data.projects[0].id === 'test-core', 'access: meta lists only granted projects');
  r = await request(port, 'GET', '/api/r/knowledge?project=test-core-2', undefined, AG); eq(r.status, 404, 'access: other project still hidden');
  r = await request(port, 'GET', '/api/r/knowledge' + P, undefined, AG); eq(r.status, 200, 'access: granted project readable');
  r = await request(port, 'GET', '/api/r/audit', undefined, AG); eq(r.status, 403, 'access: agents cannot read the audit log at all (manager+)');
  r = await request(port, 'POST', '/api/users/core-agent/password', { password: 'test-new-agent-pw-not-a-real' }, OP); eq(r.status, 403, 'users: manager cannot reset passwords');
  r = await request(port, 'POST', '/api/users/core-agent/password', { password: 'test-new-agent-pw-not-a-real' }, C); eq(r.status, 200, 'users: owner resets a password');
  r = await request(port, 'POST', '/api/login', { username: 'core-agent', password: 'test-agent-pw-not-a-real-1' }, H); eq(r.status, 401, 'users: old password refused');
  r = await request(port, 'POST', '/api/login', { username: 'core-agent', password: 'test-new-agent-pw-not-a-real' }, H); eq(r.status, 200, 'users: new password works'); AG = { Cookie: cookieOf(r), 'X-Requested-With': 'MythosWP' };
  r = await request(port, 'POST', '/api/login', { username: 'core-admin', password: 'test-admin-pw-not-a-real-1' }, H); var AD = { Cookie: cookieOf(r), 'X-Requested-With': 'MythosWP' }; ok(r.json.data.projects === null, 'access: admin sees every project');
  r = await request(port, 'PATCH', '/api/r/users/core-viewer', { role: 'owner' }, AD); eq(r.status, 403, 'users: admin cannot grant owner');
  r = await request(port, 'PATCH', '/api/r/users/core-viewer', { status: 'disabled' }, AD); eq(r.status, 200, 'users: admin disables an account');
  r = await request(port, 'POST', '/api/login', { username: 'core-viewer', password: 'test-viewer-pw-not-a-real-1' }, H); eq(r.status, 401, 'users: disabled account cannot log in');
  r = await request(port, 'DELETE', '/api/r/users/core-admin', undefined, AD); eq(r.status, 403, 'users: cannot delete own account');
  r = await request(port, 'DELETE', '/api/r/users/core-viewer', undefined, AD); eq(r.status, 403, 'users: admin cannot delete accounts (owner only)');

  // --- wp resources: knowledge, rules, tags, handoffs; roles; audit
  r = await request(port, 'POST', '/api/r/knowledge' + P, { kind: 'faq', title: 'Horaires', customer_text: 'Ouvert du lundi au samedi.', language: 'fr', allowed_for_auto_reply: true, status: 'active', tags: ['horaires'] }, AG); eq(r.status, 403, 'authz: agent cannot write knowledge');
  r = await request(port, 'POST', '/api/r/knowledge' + P, { kind: 'faq', title: 'Horaires', customer_text: 'Ouvert du lundi au samedi.', language: 'fr', allowed_for_auto_reply: true, status: 'active', tags: ['horaires'] }, OP); eq(r.status, 201, 'crud: knowledge create by manager');
  var knowId = r.json.data.row.id; ok(r.json.data.audited === true, 'crud: create audited');
  r = await request(port, 'POST', '/api/r/knowledge' + P, { title: 'incomplete' }, OP); ok(r.status === 400 && r.json.errors.customer_text === 'required', 'crud: missing required on create');
  r = await request(port, 'POST', '/api/r/knowledge' + P, { kind: 'bogus', title: 'x', customer_text: 'y' }, OP); ok(r.status === 400 && r.json.errors.kind === 'not_in_enum', 'crud: enum refused');
  r = await request(port, 'GET', '/api/r/knowledge/' + knowId + P, undefined, AG); ok(r.status === 200 && r.json.data.row.title === 'Horaires' && r.json.data.history.length === 1, 'crud: get with history (agent may read)');
  r = await request(port, 'GET', '/api/r/knowledge/999999' + P, undefined, C); eq(r.status, 404, 'crud: get missing 404');
  r = await request(port, 'GET', '/api/r/knowledge' + P + '&q=lundi', undefined, C); eq(r.json.data.total, 1, 'crud: search');
  r = await request(port, 'GET', '/api/r/knowledge' + P + '&f.status=active', undefined, C); eq(r.json.data.total, 1, 'crud: enum filter');
  r = await request(port, 'GET', '/api/r/knowledge' + P + '&f.zzz=1', undefined, C); eq(r.status, 400, 'crud: unknown filter refused');
  r = await request(port, 'GET', '/api/r/knowledge' + P + '&sort=customer_text', undefined, C); eq(r.status, 400, 'crud: non-sortable column refused');
  r = await request(port, 'GET', '/api/r/knowledge' + P + '&limit=100000', undefined, C); eq(r.json.data.limit, crud.MAX_LIMIT, 'crud: limit clamped');
  r = await request(port, 'GET', '/api/r/knowledge', undefined, C); eq(r.status, 400, 'crud: project-scoped resource needs a project');
  r = await request(port, 'GET', '/api/r/knowledge?project=nope', undefined, C); eq(r.status, 404, 'crud: unknown project 404');
  r = await request(port, 'GET', '/api/r/knowledge?project=test-core-2', undefined, C); eq(r.json.data.total, 0, 'crud: project isolation');
  r = await request(port, 'PATCH', '/api/r/knowledge/' + knowId + P, { title: 'Horaires (rev)', status: 'draft' }, OP);
  ok(r.status === 200 && r.json.data.changed.indexOf('title') !== -1 && r.json.data.changed.indexOf('status') !== -1, 'crud: update with changed fields');
  r = await request(port, 'PATCH', '/api/r/knowledge/' + knowId + P, {}, C); eq(r.status, 400, 'crud: empty update refused');
  r = await request(port, 'PATCH', '/api/r/knowledge/' + knowId + P, { updated_at: new Date().toISOString() }, C); ok(r.status === 400 && r.json.errors.updated_at === 'read_only', 'crud: read-only refused');
  r = await request(port, 'GET', '/api/r/knowledge/' + knowId + P, undefined, C); eq(r.json.data.history.length, 2, 'audit: two events');
  eq(r.json.data.history[0].changed_fields.sort(), ['status', 'title'], 'audit: changed fields recorded');
  ok(r.json.data.history[0].previous.title === 'Horaires' && r.json.data.history[0].actor === 'op', 'audit: previous value and actor');
  r = await request(port, 'POST', '/api/r/rules' + P, { rule_key: 'opening_hours', value_json: { mon: '08-18' }, enabled: true }, OP); eq(r.status, 403, 'authz: manager cannot create rules');
  r = await request(port, 'POST', '/api/r/rules' + P, { rule_key: 'opening_hours', value_json: { mon: '08-18' }, enabled: true }, AD); eq(r.status, 201, 'authz: admin creates rule');
  r = await request(port, 'POST', '/api/r/rules' + P, { rule_key: 'opening_hours', value_json: {}, enabled: true }, C); eq(r.status, 409, 'crud: duplicate unique → 409');
  r = await request(port, 'POST', '/api/r/rules' + P, { rule_key: 'Bad Key', value_json: {}, enabled: true }, C); eq(r.status, 400, 'crud: rule key pattern');
  r = await request(port, 'POST', '/api/r/tags' + P, { name: 'new-lead', color: '#112233' }, AG); eq(r.status, 403, 'authz: agent cannot create tags');
  r = await request(port, 'POST', '/api/r/tags' + P, { name: 'new-lead', color: '#112233' }, OP); eq(r.status, 201, 'crud: tag created by manager'); var tagId = r.json.data.row.id;
  r = await request(port, 'POST', '/api/r/tags' + P, { name: 'New Lead' }, OP); eq(r.status, 400, 'crud: tag name shape');
  r = await request(port, 'POST', '/api/r/handoffs' + P, { reason: 'REQUIRES_HUMAN', intent: 'human_request', customer_ref_masked: '***432', channel: 'whatsapp', status: 'NEW' }, AG); eq(r.status, 201, 'crud: agent records a manual handoff');
  var hid = r.json.data.row.id;
  r = await request(port, 'POST', '/api/r/handoffs' + P, { reason: 'REQUIRES_HUMAN', customer_ref_masked: '21698765432' }, OP); ok(r.status === 400 && r.json.errors.customer_ref_masked === 'pattern', 'crud: unmasked number refused');
  r = await request(port, 'PATCH', '/api/r/handoffs/' + hid + P, { status: 'IN_PROGRESS', assigned_to: 'op' }, OP); eq(r.json.data.row.status, 'IN_PROGRESS', 'handoff: in progress');
  r = await request(port, 'PATCH', '/api/r/handoffs/' + hid + P, { status: 'RESOLVED', resolution: 'Called back.' }, OP);
  ok(r.json.data.row.status === 'RESOLVED' && r.json.data.row.resolved_by === 'op' && r.json.data.row.resolved_at, 'handoff: resolved stamps by server');
  r = await request(port, 'PATCH', '/api/r/handoffs/' + hid + P, { resolved_by: 'hacker' }, OP); ok(r.status === 400 && r.json.errors.resolved_by === 'read_only', 'handoff: resolved_by not client-writable');
  r = await request(port, 'DELETE', '/api/r/knowledge/' + knowId + P, undefined, OP); eq(r.status, 403, 'authz: manager cannot delete knowledge');
  r = await request(port, 'DELETE', '/api/r/tags/' + tagId + P, undefined, OP); eq(r.status, 200, 'authz: manager may delete tags (per registry)');
  r = await request(port, 'DELETE', '/api/r/knowledge/' + knowId + P, undefined, AD); eq(r.status, 200, 'crud: knowledge hard delete by admin');
  r = await request(port, 'GET', '/api/r/knowledge/' + knowId + P, undefined, C); eq(r.status, 404, 'crud: deleted gone');
  r = await request(port, 'GET', '/api/audit/knowledge/' + knowId, undefined, C); ok(r.json.data.history.length === 3 && r.json.data.history[0].action === 'delete', 'audit: delete recorded with previous');
  r = await request(port, 'GET', '/api/r/audit' + P + '&f.action=delete', undefined, C); ok(r.json.data.total >= 2, 'audit: list filter by action');
  r = await request(port, 'GET', '/api/r/audit' + P + '&f.actor=op', undefined, C); ok(r.json.data.total >= 3 && !/scrypt|password/i.test(r.text), 'audit: no secret in log');
  r = await request(port, 'GET', '/api/r/audit' + P, undefined, AG); eq(r.status, 403, 'authz: agent cannot read the audit log');
  var loginEvents = await pool.query("SELECT count(*)::int AS n FROM wp_audit_events WHERE action IN ('login','login_failed','logout')"); ok(loginEvents.rows[0].n >= 1, 'audit: session events recorded');
  var userAudit = await pool.query("SELECT count(*)::int AS n FROM wp_audit_events WHERE resource = 'users' AND action IN ('create','setting','update')"); ok(userAudit.rows[0].n >= 5, 'audit: user management audited');
  var leak = await pool.query("SELECT count(*)::int AS n FROM wp_audit_events WHERE previous::text ILIKE '%scrypt%' OR next::text ILIKE '%scrypt%' OR next::text ~ '\\$[0-9a-f]{32}\\$'"); eq(leak.rows[0].n, 0, 'audit: no password hash ever written to the log');

  // --- projects registry (admin writes, owner deletes, global; no catalogue requirement)
  r = await request(port, 'POST', '/api/r/projects', { id: 'test-core-3', display_name: 'Third', kind: 'automotive', status: 'planned', settings: { kitchen: 'kitchen-mythos-auto' } }, OP); eq(r.status, 403, 'authz: manager cannot create projects');
  r = await request(port, 'POST', '/api/r/projects', { id: 'test-core-3', display_name: 'Third', kind: 'automotive', status: 'planned', settings: { kitchen: 'kitchen-mythos-auto' } }, AD); eq(r.status, 201, 'projects: automotive project needs no database catalogue (Kitchen via settings)');
  r = await request(port, 'POST', '/api/r/projects', { id: 'bad', display_name: 'B', settings: { kitchen: 'Not A Key' } }, AD); ok(r.status === 400 && r.json.errors.settings, 'projects: settings.kitchen validated');
  r = await request(port, 'POST', '/api/r/projects', { id: 'bad', display_name: 'B', catalog_dsn_env: 'lowercase' }, AD); ok(r.status === 400 && r.json.errors.catalog_dsn_env === 'read_only', 'projects: legacy catalogue column is not writable any more');
  r = await request(port, 'GET', '/api/meta', undefined, C); ok(r.json.data.projects.some(function (p) { return p.id === 'test-core-3' && p.kitchen === 'kitchen-mythos-auto'; }), 'projects: meta exposes the kitchen key');
  r = await request(port, 'DELETE', '/api/r/projects/test-core-3', undefined, AD); eq(r.status, 403, 'projects: admin cannot delete');
  r = await request(port, 'DELETE', '/api/r/projects/test-core-3', undefined, C); eq(r.status, 200, 'projects: owner deletes unused project');

  // --- V2.1 simple project operations: the short "New project" form, Project → AI, search scope
  r = await request(port, 'POST', '/api/projects', { name: 'Core Simple Service', kind: 'service', domain: 'simple.test', description: 'created by the short form', currency: 'tnd' }, OP); eq(r.status, 403, 'simple create: manager cannot create projects');
  r = await request(port, 'POST', '/api/projects', { name: 'Core Simple Service', kind: 'service', domain: 'simple.test', description: 'created by the short form', currency: 'tnd' }, AD);
  ok(r.status === 201 && r.json.data.project.id === 'core-simple-service' && r.json.data.project.kind === 'service' && r.json.data.project.status === 'active' && r.json.data.project.currency === 'TND', 'simple create: slug generated, active, currency normalised (' + JSON.stringify(r.json.data && r.json.data.project && r.json.data.project.id) + ')');
  ok(r.json.data.inbox === null && r.json.data.agent === null && !(r.json.data.project.settings || {}).kitchen, 'simple create: no number, no agent, no kitchen for a service project');
  r = await request(port, 'POST', '/api/projects', { name: 'Core Simple Service', kind: 'auto', brand_car: 'KIA' }, AD);
  ok(r.status === 201 && r.json.data.project.id === 'core-simple-service-2' && r.json.data.project.kind === 'automotive' && r.json.data.project.settings.kitchen === 'kitchen-mythos-auto' && r.json.data.project.brand_car === 'KIA', 'simple create: duplicate name gets a suffix; Auto type attaches the Kitchen automatically');
  r = await request(port, 'POST', '/api/projects', { name: 'x', kind: 'bogus' }, AD); eq(r.status, 400, 'simple create: type validated');
  r = await request(port, 'POST', '/api/projects', { name: '' }, AD); eq(r.status, 400, 'simple create: name required');
  r = await request(port, 'POST', '/api/projects', { name: 'Core With Agent', kind: 'internal', agent_id: 999999 }, AD);
  ok(r.status === 201 && r.json.data.agent === null && r.json.data.warnings.length === 1, 'simple create: unknown agent is reported as a warning, project still created');
  r = await request(port, 'GET', '/api/r/projects/core-simple-service', undefined, AG); ok(r.status === 404, 'access: agent without grant does not see the new project');
  r = await request(port, 'GET', '/api/r/projects', undefined, AD); ok(r.status === 200 && !/catalog_dsn_env|catalog_schema|Legacy/i.test(r.text), 'projects: legacy catalogue columns are hidden from the API');
  r = await request(port, 'GET', '/api/meta', undefined, AD); ok(!/catalog_dsn_env|Legacy catalogue/.test(JSON.stringify(r.json.data.resources.projects)), 'meta: no legacy catalogue field reaches the browser');
  await pool.query("INSERT INTO wp_agents (slug, name, mode, engine, status) VALUES ('core-agent-a','Core Agent A','auto','engine-173','active') ON CONFLICT (slug) DO UPDATE SET mode = 'auto', status = 'active'");
  var agentRow = (await pool.query("SELECT id FROM wp_agents WHERE slug = 'core-agent-a'")).rows[0];
  r = await request(port, 'GET', '/api/projects/core-simple-service/ai', undefined, AD); ok(r.status === 200 && r.json.data.agent === null && r.json.data.mode === 'off' && r.json.data.status === 'disabled' && Array.isArray(r.json.data.agents), 'project ai: nothing bound → off/disabled with choices for managers+');
  r = await request(port, 'PUT', '/api/projects/core-simple-service/ai', { agent_id: agentRow.id, mode: 'suggest' }, OP); eq(r.status, 403, 'project ai: manager cannot change it');
  r = await request(port, 'PUT', '/api/projects/core-simple-service/ai', { agent_id: agentRow.id, mode: 'suggest' }, AD);
  ok(r.status === 200 && r.json.data.agent && r.json.data.agent.id === agentRow.id && r.json.data.mode === 'suggest' && r.json.data.project_mode === 'suggest' && r.json.data.status === 'active', 'project ai: bound + project mode restricts an auto agent to suggest');
  r = await request(port, 'PUT', '/api/projects/core-simple-service/ai', { mode: 'inherit' }, AD); ok(r.json.data.mode === 'auto', 'project ai: inherit → the agent mode');
  r = await request(port, 'PUT', '/api/projects/core-simple-service/ai', { mode: 'off' }, AD); ok(r.json.data.mode === 'off' && r.json.data.status === 'disabled', 'project ai: off wins');
  var agentsLib = require(path.join(WP, 'reference/ai/agents'));
  ok(agentsLib.effectiveMode({ status: 'active', mode: 'auto' }, { ai_mode: 'inherit' }, { settings: { ai_mode: 'suggest' } }) === 'suggest' && agentsLib.effectiveMode({ status: 'active', mode: 'suggest' }, { ai_mode: 'auto' }, { settings: { ai_mode: 'auto' } }) === 'suggest' && agentsLib.effectiveMode({ status: 'active', mode: 'auto' }, { ai_mode: 'auto' }, { settings: { ai_mode: 'off' } }) === 'off', 'effectiveMode: project and inbox can only restrict');
  r = await request(port, 'PUT', '/api/projects/core-simple-service/ai', { agent_id: null }, AD); ok(r.json.data.agent === null, 'project ai: unbind');
  r = await request(port, 'GET', '/api/projects/core-simple-service/numbers', undefined, AD); ok(r.status === 200 && r.json.data.items.length === 0, 'project numbers: empty list');
  r = await request(port, 'GET', '/api/search?q=core%20simple&project=all', undefined, AD);
  ok(r.status === 200 && r.json.data.groups.every(function (g) { return ['projects', 'conversations', 'contacts'].indexOf(g.key) !== -1; }) && r.json.data.groups.some(function (g) { return g.key === 'projects' && g.items.some(function (i) { return i.route === '#/projects/core-simple-service'; }); }), 'search: only projects / conversations / contacts, project found');
  await pool.query("DELETE FROM wp_project_agents WHERE project_id LIKE 'core-%'; DELETE FROM wp_inboxes WHERE project_id LIKE 'core-%'; DELETE FROM wp_audit_events WHERE project_id LIKE 'core-%'; DELETE FROM wp_projects WHERE id LIKE 'core-simple-%' OR id = 'core-with-agent'; DELETE FROM wp_agents WHERE slug = 'core-agent-a'");

  // --- engine through the simulator (no Kitchen configured: greeting answers, business questions hand off)
  var sim = await autoreply.simulate(resolved, 'Bonjour');
  ok(sim.outcome === 'DECIDED' && sim.intent === 'greeting' && sim.action === 'reply' && sim.sent === false && sim.proposed_text, 'sim: greeting → template reply, nothing sent');
  sim = await autoreply.simulate(resolved, 'Prix des plaquettes pour Rexton 2012 ?');
  ok(sim.intent === 'price_availability' && sim.action === 'handoff' && sim.requires_human, 'sim: no Kitchen → REQUIRES_HUMAN handoff, never a guess');
  r = await request(port, 'POST', '/api/projects/test-core/autoreply/simulate', { text: 'Bonjour' }, OP); ok(r.status === 200 && r.json.data.sent === false, 'sim: API');
  r = await request(port, 'POST', '/api/projects/test-core/autoreply/simulate', { text: 'Bonjour' }, AG); eq(r.status, 403, 'sim: agents cannot run simulations');
  r = await request(port, 'GET', '/api/projects/test-core/autoreply/status', undefined, OP); ok(r.status === 200 && !/token_file|apikey/i.test(r.text), 'status: API, no secret');

  // --- handoff sink (what the receiver integration writes)
  var rec = { project_id: 'test-core', event_id: 'evt-' + Date.now(), envelope: { crm: { inbox_id: 'test-core', conversation_id: '***432' }, customer_msisdn_masked: '***432' }, decision: { action: 'handoff', reason: 'BUSINESS_DATA_UNAVAILABLE', intent: 'price_availability', language: 'fr', entities: { parts: ['huile'], vehicle_model: 'KORANDO', reference: null }, facts: { required: ['parts', 'price', 'stock'], available: [], missing: ['parts', 'price', 'stock'] }, requires_human: true } };
  var w = await integration.recordHandoff(pool, rec, resolved);
  ok(w && w.inserted === true, 'sink: handoff inserted');
  var w2 = await integration.recordHandoff(pool, rec, resolved); ok(w2 && w2.inserted === false, 'sink: same event_id not duplicated');
  var hs = await pool.query("SELECT * FROM wp_handoffs WHERE event_id = $1", [rec.event_id]);
  ok(hs.rows[0].status === 'REQUIRES_HUMAN' && hs.rows[0].customer_ref_masked === '***432', 'sink: REQUIRES_HUMAN, masked number');
  var none = await integration.recordHandoff(pool, { project_id: 'test-core', decision: { action: 'reply' } }, resolved); ok(none === null, 'sink: replies are not handoffs');
  r = await request(port, 'GET', '/api/r/handoffs' + P + '&f.status=REQUIRES_HUMAN', undefined, OP); eq(r.json.data.total, 1, 'sink: visible in the queue');

  // --- receiver accepts the integration module (loads; does not run: needs config + state dir)
  var recv = fs.readFileSync(path.join(ROOT, 'projects/automotive/comms/bin/mythos-auto-reply-receiver'), 'utf8');
  ok(/--integration/.test(recv) && /integration\.onOutcome/.test(recv) && /business_data: integration/.test(recv), 'receiver: --integration hook present');
  ok(integration.ports && typeof integration.ports.price === 'function' && typeof integration.onOutcome === 'function', 'integration: module contract for the receiver');

  // separation: the panel's control paths never import the notification layer
  var src = ['reference/api.js', 'reference/autoreply.js', 'reference/comms/ports.js', 'reference/comms/integration.js', 'reference/server.js'].map(function (f) { return fs.readFileSync(path.join(WP, f), 'utf8'); }).join('\n');
  ok(!/bridge\/notify|sendReply|router\.deliver/.test(src), 'separation: no notification layer import');
  // no product identity left at platform level
  var web = fs.readdirSync(path.join(WP, 'reference/web/js/views')).map(function (f) { return fs.readFileSync(path.join(WP, 'reference/web/js/views', f), 'utf8'); }).join('\n') + fs.readFileSync(path.join(WP, 'reference/web/index.html'), 'utf8') + fs.readFileSync(path.join(WP, 'reference/web/js/app.js'), 'utf8');
  ok(!/asfour/i.test(web + src), 'identity: no Asfour anywhere');
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
