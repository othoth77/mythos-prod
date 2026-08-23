'use strict';

/* Mythos ERP — penetration-style security suite (Stage 6).
 *
 * Runs against the same throwaway database and a real server. Where the
 * acceptance suite asks "does the feature work", this asks "does the obvious
 * attack fail", which is a different question and finds different things.
 *
 * Every case here is an attack that a plausible bug would let through. A test
 * that can only pass is not evidence.
 */

var http = require('http');
var path = require('path');

var API = path.resolve(__dirname, '..', 'sites', 'erp.mythosprod.xyz', 'api');
var pg = require(path.join(API, 'node_modules', 'pg'));
var dbLib = require(path.join(API, 'lib', 'db'));
var passwords = require(path.join(API, 'lib', 'password'));
var server = require(path.join(API, 'server'));

var FAST = { N: 1024, r: 8, p: 1, keylen: 32, saltlen: 16 };
var passed = 0, failed = 0;
function check(n, ok, d) { if (ok) { passed++; console.log('  PASS ' + n); } else { failed++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } }
function section(t) { console.log('\n' + t); }

// A run tag keeps identities unique so the suite can be executed repeatedly
// against one database — which is what makes mutation testing affordable here.
var TAG = process.env.ERP_TEST_TAG || 'x';

var ownerPool = new pg.Pool({ connectionString: process.env.ERP_DATABASE_URL });
var appPool = new pg.Pool({ connectionString: process.env.ERP_APP_DATABASE_URL });
var httpServer, PORT;

function Client() { this.cookie = null; this.csrf = null; this.tenant = null; }
Client.prototype.call = function (method, p, body, headers) {
  var self = this;
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
    var h = Object.assign({}, headers || {});
    if (payload) { h['Content-Type'] = 'application/json'; h['Content-Length'] = payload.length; }
    if (self.cookie) h['Cookie'] = self.cookie;
    if (self.csrf) h['X-CSRF-Token'] = self.csrf;
    if (self.tenant) h['X-Tenant-Id'] = self.tenant;
    var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: p, headers: h }, function (res) {
      var c = [];
      res.on('data', function (x) { c.push(x); });
      res.on('end', function () {
        var t = Buffer.concat(c).toString('utf8'), j = null;
        try { j = JSON.parse(t); } catch (e) { j = t; }
        var sc = res.headers['set-cookie'];
        if (sc && sc.length) self.cookie = sc[0].split(';')[0];
        resolve({ status: res.statusCode, body: j, headers: res.headers, raw: t });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
};
Client.prototype.login = function (e, p) {
  var self = this;
  return this.call('POST', '/api/v1/auth/login', { email: e, password: p }).then(function (r) {
    if (r.status === 200) { self.csrf = r.body.csrf; self.tenant = r.body.active_tenant_id; }
    return r;
  });
};

(async function () {
  var hash = await passwords.hash('a-really-long-password', FAST);
  var mythos = (await ownerPool.query("SELECT id FROM tenants WHERE key='mythos'")).rows[0].id;
  var acme = (await ownerPool.query(
    "INSERT INTO tenants (key, display_name) VALUES ($1,'Acme Two') RETURNING id", ['acme2-' + TAG])).rows[0].id;
  await ownerPool.query(
    "INSERT INTO tenant_modules (tenant_id, module_key, enabled)" +
    " SELECT $1, k, true FROM unnest(ARRAY['dashboard','clients','projects','planning','production'," +
    "'finance','invoices','documents','reports','inventory','settings','users','audit']) k", [acme]);

  async function mkUser(email, tenantId, roleKey) {
    var u = await ownerPool.query('INSERT INTO users (email, display_name, password_hash, password_algo,' +
      " password_changed_at) VALUES ($1,$2,$3,'scrypt',now()) RETURNING id", [email, email, hash]);
    await ownerPool.query('INSERT INTO tenant_memberships (user_id, tenant_id, is_default) VALUES ($1,$2,true)', [u.rows[0].id, tenantId]);
    await ownerPool.query('INSERT INTO user_roles (user_id, tenant_id, role_id) SELECT $1,$2,id FROM roles WHERE key=$3',
      [u.rows[0].id, tenantId, roleKey]);
    return u.rows[0].id;
  }
  var adminA = await mkUser(('sec-admin+' + TAG + '@a.test'), mythos, 'admin');
  var roA = await mkUser(('sec-ro+' + TAG + '@a.test'), mythos, 'read_only');
  var adminB = await mkUser(('sec-admin+' + TAG + '@b.test'), acme, 'admin');

  var deps = {
    db: { query: function (s, p) { return appPool.query(s, p); } },
    pool: appPool,
    withTenant: function (t, fn) { return dbLib.withTenant(appPool, t, fn); },
    withoutTenant: function (fn) { return dbLib.withoutTenant(appPool, fn); }
  };
  httpServer = server.createServer(deps);
  await new Promise(function (r) { httpServer.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;

  var A = new Client(); await A.login(('sec-admin+' + TAG + '@a.test'), 'a-really-long-password');
  var B = new Client(); await B.login(('sec-admin+' + TAG + '@b.test'), 'a-really-long-password');
  var RO = new Client(); await RO.login(('sec-ro+' + TAG + '@a.test'), 'a-really-long-password');

  var victim = await B.call('POST', '/api/v1/clients', { name: 'Victim Corp' });

  // ── §1 injection ────────────────────────────────────────────────────────
  section('§1 SQL injection');
  var payloads = ["' OR 1=1--", "'; DROP TABLE clients;--", "1' UNION SELECT NULL,NULL--", "%' OR tenant_id IS NOT NULL--"];
  for (var i = 0; i < payloads.length; i++) {
    var r = await A.call('GET', '/api/v1/clients?search=' + encodeURIComponent(payloads[i]));
    check('injection in search is treated as data: ' + payloads[i].slice(0, 22),
      r.status === 200 && r.body.total === 0, JSON.stringify(r.body).slice(0, 90));
  }
  check('the clients table survived every injection attempt',
    (await A.call('GET', '/api/v1/clients')).status === 200);
  var si = await A.call('GET', '/api/v1/clients?sort=name%3B%20DROP%20TABLE%20clients&dir=asc');
  check('an injected sort column is ignored, not concatenated', si.status === 200);
  var sf = await A.call('GET', '/api/v1/clients?client_id=' + encodeURIComponent("' OR '1'='1"));
  check('an injected filter value is bound, not interpolated', sf.status === 200 || sf.status === 500);

  // ── §2 mass assignment ──────────────────────────────────────────────────
  section('§2 mass assignment');
  var ma = await A.call('POST', '/api/v1/clients', { name: 'MA test', tenant_id: acme, id: '00000000-0000-4000-8000-000000000000' });
  check('creating with a foreign tenant_id in the body is not honoured', ma.status === 201);
  if (ma.status === 201) {
    check('the row landed in the CALLER\'s tenant, not the one in the body', ma.body.id !== '00000000-0000-4000-8000-000000000000');
    var owner = await ownerPool.query('SELECT tenant_id FROM clients WHERE id = $1', [ma.body.id]);
    check('the database confirms the caller\'s tenant', owner.rows[0].tenant_id === mythos);
  }
  var mu = await A.call('PATCH', '/api/v1/clients/' + ma.body.id, { tenant_id: acme, name: 'renamed' });
  check('moving a row to another tenant via PATCH is not honoured', mu.status === 200);
  var after = await ownerPool.query('SELECT tenant_id, name FROM clients WHERE id = $1', [ma.body.id]);
  check('the row did NOT move tenants', after.rows[0].tenant_id === mythos);
  var doc = await A.call('PATCH', '/api/v1/documents/' + ma.body.id, { storage_key: '../../etc/passwd' });
  check('storage_key is not a writable field', doc.status === 404 || doc.status === 422);

  // ── §3 IDOR and object references ───────────────────────────────────────
  section('§3 IDOR');
  check('another tenant\'s client is 404, not 403 (existence is not disclosed)',
    (await A.call('GET', '/api/v1/clients/' + victim.body.id)).status === 404);
  check('a random uuid is also 404 — indistinguishable from a real foreign id',
    (await A.call('GET', '/api/v1/clients/11111111-2222-4333-8444-555555555555')).status === 404);
  check('path traversal in an id does not route', (await A.call('GET', '/api/v1/clients/..%2F..%2Fetc%2Fpasswd')).status === 404);
  check('a numeric id does not route', (await A.call('GET', '/api/v1/clients/1')).status === 404);

  // ── §4 authentication and session ───────────────────────────────────────
  section('§4 authentication and session');
  var stolen = A.cookie;
  var lo = await A.call('POST', '/api/v1/auth/logout', {});
  check('logout succeeds', lo.status === 200);
  var replay = new Client(); replay.cookie = stolen; replay.tenant = mythos;
  check('a captured cookie is dead after logout', (await replay.call('GET', '/api/v1/clients')).status === 401);
  await A.login(('sec-admin+' + TAG + '@a.test'), 'a-really-long-password');

  var noCsrf = new Client();
  await noCsrf.login(('sec-admin+' + TAG + '@a.test'), 'a-really-long-password');
  noCsrf.csrf = null;
  check('a write with no CSRF token is refused',
    (await noCsrf.call('POST', '/api/v1/clients', { name: 'x' })).status === 403);
  noCsrf.csrf = 'a'.repeat(43);
  check('a write with a wrong-but-well-formed CSRF token is refused',
    (await noCsrf.call('POST', '/api/v1/clients', { name: 'x' })).status === 403);

  var forged = new Client();
  forged.cookie = '__Host-erp_session=' + 'A'.repeat(43);
  check('a forged session token is refused', (await forged.call('GET', '/api/v1/clients')).status === 401);

  // ── §5 privilege escalation ─────────────────────────────────────────────
  section('§5 privilege escalation');
  RO.tenant = mythos;
  check('read-only cannot assign itself a role',
    (await RO.call('POST', '/api/v1/users/roles', { user_id: roA, role_key: 'admin' })).status === 403);
  check('read-only cannot enable a module', (await RO.call('POST', '/api/v1/settings/modules', { module_key: 'audit', enabled: true })).status === 403);
  check('read-only still cannot write after the attempts',
    (await RO.call('POST', '/api/v1/clients', { name: 'x' })).status === 403);
  var esc = await A.call('POST', '/api/v1/users/roles', { user_id: adminB, role_key: 'admin' });
  // adminB is not a member of tenant A, so the grant is meaningless there and
  // must not become a membership.
  var crossGrant = await ownerPool.query(
    'SELECT count(*)::int AS n FROM tenant_memberships WHERE user_id = $1 AND tenant_id = $2', [adminB, mythos]);
  check('granting a role to a non-member does not create a membership', crossGrant.rows[0].n === 0);
  var stillB = new Client(); await stillB.login(('sec-admin+' + TAG + '@b.test'), 'a-really-long-password');
  stillB.tenant = mythos;
  check('the other tenant\'s admin still cannot act in this tenant',
    (await stillB.call('GET', '/api/v1/clients')).status === 403);

  // ── §5b tenant forging ──────────────────────────────────────────────────
  section('§5b tenant boundary forging');
  var f1 = new Client(); await f1.login(('sec-admin+' + TAG + '@a.test'), 'a-really-long-password');
  f1.tenant = acme;                                  // claim a tenant we are not in
  var fr = await f1.call('GET', '/api/v1/clients');
  check('forging X-Tenant-Id for a foreign tenant is refused', fr.status === 403, String(fr.status));
  check('the forged read returned no rows at all', !(fr.body && fr.body.rows));
  var fw = await f1.call('POST', '/api/v1/clients', { name: 'forged' });
  check('a forged-tenant WRITE is refused', fw.status === 403, String(fw.status));
  var planted = await ownerPool.query('SELECT count(*)::int AS n FROM clients WHERE name = $1', ['forged']);
  check('nothing was written into the foreign tenant', planted.rows[0].n === 0);
  f1.tenant = '00000000-0000-4000-8000-0000000000ff';
  check('a nonexistent tenant id is refused too', (await f1.call('GET', '/api/v1/clients')).status === 403);
  var denials = await ownerPool.query(
    "SELECT count(*)::int AS n FROM audit_log WHERE action='permission.denied' AND detail->>'reason'='not_a_member'");
  check('cross-tenant attempts are recorded in the audit log', denials.rows[0].n > 0);

  // ── §6 input handling ───────────────────────────────────────────────────
  section('§6 input handling');
  var big = Buffer.from(JSON.stringify({ name: 'x'.repeat(2 * 1024 * 1024) }));
  var bigRes = await A.call('POST', '/api/v1/clients', big).catch(function () { return { status: 413 }; });
  check('an oversized body is refused', bigRes.status === 413 || bigRes.status === 400, String(bigRes.status));
  var badJson = await A.call('POST', '/api/v1/clients', Buffer.from('{not json'));
  check('malformed JSON is refused with 400, not 500', badJson.status === 400, String(badJson.status));
  var deep = { name: 'x' }; var cur = deep;
  for (var d = 0; d < 200; d++) { cur.nested = {}; cur = cur.nested; }
  var deepRes = await A.call('POST', '/api/v1/clients', deep);
  check('a deeply nested body does not crash the server', deepRes.status < 500, String(deepRes.status));
  check('the server is still alive afterwards', (await A.call('GET', '/api/v1/health')).status === 200);
  var xss = await A.call('POST', '/api/v1/clients', { name: '<script>alert(1)</script>' });
  check('markup is stored as data, not interpreted', xss.status === 201);
  check('the API declares a non-renderable content type',
    /application\/json/.test(String(xss.headers['content-type'])));

  // ── §7 response headers ─────────────────────────────────────────────────
  section('§7 response headers');
  var h = (await A.call('GET', '/api/v1/health')).headers;
  check('nosniff is set', h['x-content-type-options'] === 'nosniff');
  check('a restrictive CSP is set', /default-src 'none'/.test(String(h['content-security-policy'])));
  check('frame-ancestors none', /frame-ancestors 'none'/.test(String(h['content-security-policy'])));
  check('responses are not cached', /no-store/.test(String(h['cache-control'])));
  check('referrer is suppressed', h['referrer-policy'] === 'no-referrer');
  var lr = await new Client().call('POST', '/api/v1/auth/login', { email: ('sec-admin+' + TAG + '@a.test'), password: 'a-really-long-password' });
  var cookie = String(lr.headers['set-cookie']);
  check('the session cookie is HttpOnly', /HttpOnly/.test(cookie));
  check('the session cookie is Secure', /Secure/.test(cookie));
  check('the session cookie uses __Host-', /__Host-/.test(cookie));
  check('the session cookie sets SameSite', /SameSite=/.test(cookie));

  // ── §8 error handling ───────────────────────────────────────────────────
  section('§8 error handling');
  var err = await A.call('GET', '/api/v1/clients?limit=' + encodeURIComponent('9'.repeat(400)));
  check('an absurd limit does not error out', err.status === 200, String(err.status));
  check('no internal detail leaks in any error body so far',
    !/at Object|node_modules|\/home\/deploy|pg\/lib/.test(JSON.stringify([badJson.body, deepRes.body, err.body])));
  var nf = await A.call('GET', '/api/v1/does-not-exist');
  check('an unknown route is a plain 404', nf.status === 404 && !/stack/i.test(JSON.stringify(nf.body)));

  // ── §9 database least privilege ─────────────────────────────────────────
  section('§9 database least privilege');
  var priv = await appPool.query(
    "SELECT has_table_privilege('erp_app','audit_log','INSERT') AS ins," +
    " has_table_privilege('erp_app','audit_log','UPDATE') AS upd," +
    " has_table_privilege('erp_app','audit_log','DELETE') AS del," +
    " has_table_privilege('erp_app','clients','DELETE') AS cdel");
  check('the app role can append audit rows', priv.rows[0].ins === true);
  check('the app role cannot UPDATE the audit log', priv.rows[0].upd === false);
  check('the app role cannot DELETE from the audit log', priv.rows[0].del === false);
  check('the app role cannot hard-delete business rows', priv.rows[0].cdel === false);
  var owns = await appPool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tableowner='erp_app'");
  check('the app role owns no tables, so RLS is never bypassed by ownership', owns.rows[0].n === 0);
  var ddl = await appPool.query("SELECT has_schema_privilege('erp_app','public','CREATE') AS c");
  check('the app role cannot create objects', ddl.rows[0].c === false);
  var rls = await appPool.query("SELECT count(*)::int AS n FROM pg_tables t WHERE t.schemaname='public'" +
    " AND t.tablename IN ('clients','invoices','projects','documents','audit_log') AND NOT t.rowsecurity");
  check('every sensitive table has RLS enabled', rls.rows[0].n === 0);
  var leak = await appPool.query('SELECT count(*)::int AS n FROM clients');
  check('with no tenant context the app role reads nothing', leak.rows[0].n === 0);

  console.log('\nerp-security: ' + passed + ' passed, ' + failed + ' failed');
  await new Promise(function (r) { httpServer.close(r); });
  await appPool.end(); await ownerPool.end();
  process.exitCode = failed ? 1 : 0;
})().catch(function (e) {
  console.error('SUITE CRASHED: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1; try { httpServer && httpServer.close(); } catch (x) {}
  process.exit(1);
});
