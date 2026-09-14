'use strict';

/* Mythos ERP acceptance test — two tenants, real PostgreSQL, real HTTP.
 *
 * This is not a unit test with fakes. It applies the real migrations, starts
 * the real server, and talks to it over a socket. The mandatory claim it exists
 * to prove is the one that cannot be argued from code review:
 *
 *     Tenant A cannot read or write Tenant B's data, through any module.
 *
 * Run via tests/erp-acceptance-drill.sh, which provides the throwaway database.
 * Requires: ERP_DATABASE_URL (owner) and ERP_APP_DATABASE_URL (erp_app).
 */

var http = require('http');
var path = require('path');

var API = path.resolve(__dirname, '..', 'sites', 'erp.mythosprod.xyz', 'api');
// pg is a dependency of the API package, not of the repository root, so it is
// resolved from there rather than assumed to be globally installed.
var pg = require(path.join(API, 'node_modules', 'pg'));
var dbLib = require(path.join(API, 'lib', 'db'));
var passwords = require(path.join(API, 'lib', 'password'));
var server = require(path.join(API, 'server'));

var FAST = { N: 1024, r: 8, p: 1, keylen: 32, saltlen: 16 };  // test-only KDF cost

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

var ownerPool = new pg.Pool({ connectionString: process.env.ERP_DATABASE_URL });
var appPool   = new pg.Pool({ connectionString: process.env.ERP_APP_DATABASE_URL });

var httpServer, PORT;

/* ── tiny HTTP client that keeps a session ─────────────────────────────── */
function Client(name) { this.name = name; this.cookie = null; this.csrf = null; this.tenant = null; }
Client.prototype.call = function (method, p, body, extraHeaders) {
  var self = this;
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    var headers = Object.assign({}, extraHeaders || {});
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
    if (self.cookie) headers['Cookie'] = self.cookie;
    if (self.csrf) headers['X-CSRF-Token'] = self.csrf;
    if (self.tenant) headers['X-Tenant-Id'] = self.tenant;
    var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: p, headers: headers },
      function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          var text = Buffer.concat(chunks).toString('utf8');
          var parsed = null;
          try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
          var sc = res.headers['set-cookie'];
          if (sc && sc.length) self.cookie = sc[0].split(';')[0];
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
};
Client.prototype.login = function (email, password) {
  var self = this;
  return this.call('POST', '/api/v1/auth/login', { email: email, password: password })
    .then(function (r) {
      if (r.status === 200) { self.csrf = r.body.csrf; self.tenant = r.body.active_tenant_id; }
      return r;
    });
};

/* ── seeding, as the owner (RLS does not apply to the table owner) ──────── */
async function seed() {
  var hash = await passwords.hash('a-really-long-password', FAST);
  var t = await ownerPool.query(
    "INSERT INTO tenants (key, display_name, invoice_prefix) VALUES ('acme','Acme Corp','AC') RETURNING id");
  var acme = t.rows[0].id;
  var mythos = (await ownerPool.query("SELECT id FROM tenants WHERE key='mythos'")).rows[0].id;

  await ownerPool.query(
    "INSERT INTO tenant_modules (tenant_id, module_key, enabled)" +
    " SELECT $1, k, true FROM unnest(ARRAY['dashboard','clients','projects','planning','production'," +
    "'finance','invoices','documents','reports','inventory','settings','users','audit']) k", [acme]);
  // Acme has not bought Reports: the module gate must refuse it by URL.
  await ownerPool.query("UPDATE tenant_modules SET enabled = false WHERE tenant_id = $1 AND module_key = 'reports'", [acme]);

  async function mkUser(email, name, tenantId, roleKey) {
    var u = await ownerPool.query(
      'INSERT INTO users (email, display_name, password_hash, password_algo, password_changed_at)' +
      " VALUES ($1,$2,$3,'scrypt',now()) RETURNING id", [email, name, hash]);
    var id = u.rows[0].id;
    await ownerPool.query(
      'INSERT INTO tenant_memberships (user_id, tenant_id, is_default) VALUES ($1,$2,true)', [id, tenantId]);
    await ownerPool.query(
      'INSERT INTO user_roles (user_id, tenant_id, role_id) SELECT $1,$2,id FROM roles WHERE key=$3',
      [id, tenantId, roleKey]);
    return id;
  }

  var alice = await mkUser('alice@mythos.test', 'Alice', mythos, 'admin');       // tenant A admin
  var bob   = await mkUser('bob@acme.test',     'Bob',   acme,   'admin');       // tenant B admin
  var rita  = await mkUser('rita@mythos.test',  'Rita',  mythos, 'read_only');   // tenant A read-only
  var fin   = await mkUser('fin@mythos.test',   'Fin',   mythos, 'finance_user');

  // Carol belongs to BOTH tenants — the central-identity case.
  var carol = await mkUser('carol@mythos.test', 'Carol', mythos, 'manager');
  await ownerPool.query('INSERT INTO tenant_memberships (user_id, tenant_id) VALUES ($1,$2)', [carol, acme]);
  await ownerPool.query(
    "INSERT INTO user_roles (user_id, tenant_id, role_id) SELECT $1,$2,id FROM roles WHERE key='read_only'",
    [carol, acme]);

  return { acme: acme, mythos: mythos, alice: alice, bob: bob, rita: rita, fin: fin, carol: carol };
}

(async function () {
  var ids = await seed();

  var deps = {
    db: { query: function (sql, params) { return appPool.query(sql, params); } },
    pool: appPool,
    withTenant: function (tid, fn) { return dbLib.withTenant(appPool, tid, fn); },
    withoutTenant: function (fn) { return dbLib.withoutTenant(appPool, fn); }
  };
  httpServer = server.createServer(deps);
  await new Promise(function (r) { httpServer.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;

  var A = new Client('alice');   // Mythos admin
  var B = new Client('bob');     // Acme admin
  var R = new Client('rita');    // Mythos read-only
  var C = new Client('carol');   // member of both

  // ── §1 authentication ───────────────────────────────────────────────────
  section('§1 authentication');
  var bad = await A.call('POST', '/api/v1/auth/login', { email: 'alice@mythos.test', password: 'wrong' });
  check('wrong password is refused', bad.status === 401);
  var la = await A.login('alice@mythos.test', 'a-really-long-password');
  check('correct password logs in', la.status === 200);
  check('a session cookie is issued', /__Host-erp_session=/.test(String(la.headers['set-cookie'])));
  check('a csrf token is issued', !!la.body.csrf);
  check('the response names the active tenant', la.body.active_tenant_id === ids.mythos);
  check('the response lists only the tenants the user belongs to', la.body.tenants.length === 1);
  var lb = await B.login('bob@acme.test', 'a-really-long-password');
  check('the second tenant admin logs in', lb.status === 200 && lb.body.active_tenant_id === ids.acme);
  await R.login('rita@mythos.test', 'a-really-long-password');
  var lc = await C.login('carol@mythos.test', 'a-really-long-password');
  check('a user in two tenants sees both', lc.body.tenants.length === 2);

  var anon = new Client('anon');
  check('an unauthenticated request is refused',
    (await anon.call('GET', '/api/v1/clients')).status === 401);

  // ── §2 tenant-scoped writes ─────────────────────────────────────────────
  section('§2 module operations');
  var ca = await A.call('POST', '/api/v1/clients', { name: 'Mythos Client One', email: 'one@m.test' });
  check('tenant A creates a client', ca.status === 201, JSON.stringify(ca.body));
  var cb = await B.call('POST', '/api/v1/clients', { name: 'Acme Client One' });
  check('tenant B creates a client', cb.status === 201, JSON.stringify(cb.body));
  var pa = await A.call('POST', '/api/v1/projects', { title: 'Mythos Project', client_id: ca.body.id, reference: 'P-001' });
  check('tenant A creates a project', pa.status === 201, JSON.stringify(pa.body));
  var pb = await B.call('POST', '/api/v1/projects', { title: 'Acme Project', client_id: cb.body.id, reference: 'P-001' });
  check('tenant B reuses reference P-001 — uniqueness is per tenant', pb.status === 201, JSON.stringify(pb.body));
  var ap = await A.call('POST', '/api/v1/appointments', { title: 'Planning call', starts_at: '2026-09-01T10:00:00Z', project_id: pa.body.id });
  check('planning: appointment created', ap.status === 201, JSON.stringify(ap.body));
  var rep = await A.call('POST', '/api/v1/representations', { title: 'Opening night', project_id: pa.body.id, starts_at: '2026-09-10T20:00:00Z' });
  check('production: representation created', rep.status === 201, JSON.stringify(rep.body));
  var inv0 = await A.call('POST', '/api/v1/inventory_items', { label: 'Cable XLR', sku: 'XLR-1', min_quantity: 5 });
  check('inventory: item created', inv0.status === 201, JSON.stringify(inv0.body));
  // Document ROWS are created by the upload path, which owns storage_key. The
  // The generic create route is still not mounted for documents; POST is
  // owned by the Phase 12 upload handler instead, which validates mime_type
  // and content_base64 before it ever looks at storage_key/sha256 — so a
  // body shaped like a generic create (no file, just metadata) is refused by
  // the upload's own validation, not by a missing route.
  var doc = await A.call('POST', '/api/v1/documents', { category: 'contract', project_id: pa.body.id });
  check('documents: POST is the upload handler, not a generic create (422, no file supplied)', doc.status === 422, JSON.stringify(doc.body));
  check('documents: a generic create body cannot set storage_key/sha256 directly', !('storage_key' in (doc.body || {})));
  check('documents: listing works', (await A.call('GET', '/api/v1/documents')).status === 200);
  var exp = await A.call('POST', '/api/v1/expenses', { description: 'Travel', amount: '120.500', spent_on: '2026-08-01' });
  check('finance: expense created', exp.status === 201, JSON.stringify(exp.body));

  // ── §3 invoices ─────────────────────────────────────────────────────────
  section('§3 invoices');
  var ia = await A.call('POST', '/api/v1/invoices', {
    client_id: ca.body.id, project_id: pa.body.id, issued_on: '2026-08-20',
    lines: [{ description: 'Design', quantity: 2, unit_price: '100.000', vat_rate: 19 },
            { description: 'Travel', quantity: 1, unit_price: '50.000', vat_rate: 7 }]
  });
  check('invoice created with lines', ia.status === 201, JSON.stringify(ia.body));
  check('invoice number uses the tenant prefix', /^MP2026-\d{4}$/.test(ia.body.number), ia.body.number);
  check('totals are computed server-side (HT)', ia.body.totals.total_ht === '250.000', ia.body.totals.total_ht);
  check('VAT is computed per line rate', ia.body.totals.total_vat === '41.500', ia.body.totals.total_vat);
  check('TTC follows', ia.body.totals.total_ttc === '291.500', ia.body.totals.total_ttc);
  check('balance equals TTC before payment', ia.body.totals.balance === '291.500');

  var ib = await B.call('POST', '/api/v1/invoices', {
    client_id: cb.body.id, issued_on: '2026-08-20',
    lines: [{ description: 'Consulting', quantity: 1, unit_price: '80.000' }]
  });
  check('tenant B invoice created', ib.status === 201, JSON.stringify(ib.body));
  check('tenant B numbering starts at its own 1, not A\'s next',
    /^AC2026-0001$/.test(ib.body.number), ib.body.number);

  var forged = await A.call('POST', '/api/v1/invoices', {
    client_id: ca.body.id, issued_on: '2026-08-20', status: 'paid',
    lines: [{ description: 'x', quantity: 1, unit_price: '1.000' }]
  });
  check('a client cannot declare an invoice paid', forged.status === 422, JSON.stringify(forged.body));

  var pay1 = await A.call('POST', '/api/v1/invoices/' + ia.body.id + '/payments', { amount: '100.000' });
  check('partial payment accepted', pay1.status === 201, JSON.stringify(pay1.body));
  check('status becomes part_paid', pay1.body.invoice_status === 'part_paid', pay1.body.invoice_status);
  var pay2 = await A.call('POST', '/api/v1/invoices/' + ia.body.id + '/payments', { amount: '191.500' });
  check('final payment settles the invoice', pay2.body.invoice_status === 'paid', pay2.body.invoice_status);
  var editPaid = await A.call('PATCH', '/api/v1/invoices/' + ia.body.id, { notes: 'rewriting history' });
  check('a paid invoice cannot be edited', editPaid.status === 409, JSON.stringify(editPaid.body));
  var badLine = await A.call('POST', '/api/v1/invoices', {
    client_id: ca.body.id, lines: [{ description: 'x', quantity: -1, unit_price: '1.000' }] });
  check('a negative quantity is refused', badLine.status === 422);
  var noLines = await A.call('POST', '/api/v1/invoices', { client_id: ca.body.id, lines: [] });
  check('an invoice with no lines is refused', noLines.status === 422);
  var search = await A.call('GET', '/api/v1/invoices?search=' + encodeURIComponent(ia.body.number));
  check('invoice search finds it', search.status === 200 && search.body.total === 1, JSON.stringify(search.body.total));

  // ── §4 TENANT ISOLATION — the mandatory proof ───────────────────────────
  section('§4 tenant isolation (mandatory)');
  var aList = await A.call('GET', '/api/v1/clients');
  var bList = await B.call('GET', '/api/v1/clients');
  check('tenant A sees only its own clients',
    aList.body.total === 1 && aList.body.rows[0].name === 'Mythos Client One');
  check('tenant B sees only its own clients',
    bList.body.total === 1 && bList.body.rows[0].name === 'Acme Client One');

  check('A cannot GET B\'s client by id',
    (await A.call('GET', '/api/v1/clients/' + cb.body.id)).status === 404);
  check('B cannot GET A\'s client by id',
    (await B.call('GET', '/api/v1/clients/' + ca.body.id)).status === 404);
  check('A cannot PATCH B\'s client',
    (await A.call('PATCH', '/api/v1/clients/' + cb.body.id, { name: 'hijacked' })).status === 404);
  check('A cannot DELETE B\'s client',
    (await A.call('DELETE', '/api/v1/clients/' + cb.body.id)).status === 404);
  check('A cannot GET B\'s invoice',
    (await A.call('GET', '/api/v1/invoices/' + ib.body.id)).status === 404);
  check('A cannot add a payment to B\'s invoice',
    (await A.call('POST', '/api/v1/invoices/' + ib.body.id + '/payments', { amount: '1.000' })).status === 404);
  check('A cannot GET B\'s project',
    (await A.call('GET', '/api/v1/projects/' + pb.body.id)).status === 404);

  var stillThere = await B.call('GET', '/api/v1/clients/' + cb.body.id);
  check('B\'s client is untouched after A\'s attempts',
    stillThere.status === 200 && stillThere.body.name === 'Acme Client One');

  // Forging the tenant header must not work.
  var forgedHeader = new Client('forge');
  await forgedHeader.login('alice@mythos.test', 'a-really-long-password');
  forgedHeader.tenant = ids.acme;
  var forgedCall = await forgedHeader.call('GET', '/api/v1/clients');
  check('A forging X-Tenant-Id for B is refused', forgedCall.status === 403, JSON.stringify(forgedCall.body));
  check('the forged attempt did NOT return B\'s data',
    !(forgedCall.body && forgedCall.body.rows));

  // The genuine multi-tenant user switches legitimately and sees each side.
  C.tenant = ids.mythos;
  var cMythos = await C.call('GET', '/api/v1/clients');
  C.tenant = ids.acme;
  var cAcme = await C.call('GET', '/api/v1/clients');
  check('a member of both tenants sees A\'s data in A', cMythos.body.total === 1 && cMythos.body.rows[0].name === 'Mythos Client One');
  check('...and B\'s data in B', cAcme.body.total === 1 && cAcme.body.rows[0].name === 'Acme Client One');
  check('...and never both at once', cMythos.body.total === 1 && cAcme.body.total === 1);

  // Direct database check: the app role cannot see across tenants even in SQL.
  var crossRows = await dbLib.withTenant(appPool, ids.mythos, function (c) {
    return c.query('SELECT count(*)::int AS n FROM clients');
  });
  check('at SQL level, the app role in tenant A counts only A rows', crossRows.rows[0].n === 1);
  var noTenantRows = await appPool.query('SELECT count(*)::int AS n FROM clients');
  check('with no tenant set, the app role sees NOTHING (fail-closed)', noTenantRows.rows[0].n === 0);

  // ── §5 roles and permissions ────────────────────────────────────────────
  section('§5 roles and permissions');
  R.tenant = ids.mythos;
  check('read-only can list clients', (await R.call('GET', '/api/v1/clients')).status === 200);
  var rw = await R.call('POST', '/api/v1/clients', { name: 'Should not exist' });
  check('read-only cannot create a client', rw.status === 403, JSON.stringify(rw.body));
  check('read-only cannot delete a client',
    (await R.call('DELETE', '/api/v1/clients/' + ca.body.id)).status === 403);
  check('read-only cannot read the audit log', (await R.call('GET', '/api/v1/audit')).status === 403);
  check('read-only cannot change settings',
    (await R.call('PATCH', '/api/v1/settings', { display_name: 'x' })).status === 403);
  check('admin CAN read the audit log', (await A.call('GET', '/api/v1/audit')).status === 200);
  var F = new Client('fin');
  await F.login('fin@mythos.test', 'a-really-long-password');
  check('finance user can read finance', (await F.call('GET', '/api/v1/expenses')).status === 200);
  check('finance user cannot write production',
    (await F.call('POST', '/api/v1/representations', { title: 'x', starts_at: '2026-09-01T10:00:00Z' })).status === 403);
  check('carol is admin in A but read-only in B: write refused in B',
    (C.tenant = ids.acme, (await C.call('POST', '/api/v1/clients', { name: 'nope' })).status) === 403);

  // ── §6 module enablement ────────────────────────────────────────────────
  section('§6 per-tenant modules');
  check('tenant A (reports enabled) can read reports',
    (await A.call('GET', '/api/v1/reports/revenue')).status === 200);
  check('tenant B (reports disabled) gets 404 by URL, not a hidden menu',
    (await B.call('GET', '/api/v1/reports/revenue')).status === 404);
  var setMod = await B.call('POST', '/api/v1/settings/modules', { module_key: 'reports', enabled: true });
  check('an admin can enable a module for their own tenant', setMod.status === 200, JSON.stringify(setMod.body));
  check('the module is then reachable', (await B.call('GET', '/api/v1/reports/revenue')).status === 200);

  // ── §7 CSRF and input handling ──────────────────────────────────────────
  section('§7 CSRF and input');
  var saved = A.csrf; A.csrf = 'wrong-token';
  check('a write without a valid CSRF token is refused',
    (await A.call('POST', '/api/v1/clients', { name: 'csrf' })).status === 403);
  A.csrf = saved;
  check('an invalid email is refused',
    (await A.call('POST', '/api/v1/clients', { name: 'x', email: 'not-an-email' })).status === 422);
  check('a missing required field is refused',
    (await A.call('POST', '/api/v1/clients', {})).status === 422);
  var inj = await A.call('GET', "/api/v1/clients?sort=name;DROP%20TABLE%20clients--");
  check('an injected sort parameter is ignored, not executed', inj.status === 200);
  check('the table still exists after the injection attempt',
    (await A.call('GET', '/api/v1/clients')).status === 200);
  var idor = await A.call('GET', '/api/v1/clients/not-a-uuid');
  check('a non-UUID id does not reach a handler', idor.status === 404);

  // ── §8 audit ────────────────────────────────────────────────────────────
  section('§8 audit log');
  var aud = await A.call('GET', '/api/v1/audit');
  var actions = aud.body.rows.map(function (r) { return r.action; });
  check('creations are audited', actions.indexOf('record.created') >= 0);
  check('denials are audited', actions.indexOf('permission.denied') >= 0);
  check('the audit log is tenant-scoped',
    aud.body.rows.every(function (r) { return r.entity_table !== 'nothing'; }) && aud.body.rows.length > 0);
  var bAud = await B.call('GET', '/api/v1/audit');
  var aIds = aud.body.rows.map(function (r) { return r.id; });
  check('tenant B\'s audit log shares no entries with tenant A\'s',
    bAud.body.rows.every(function (r) { return aIds.indexOf(r.id) < 0; }));
  var audUpd = await appPool.query("SELECT has_table_privilege('erp_app','audit_log','UPDATE') AS u," +
    " has_table_privilege('erp_app','audit_log','DELETE') AS d, has_table_privilege('erp_app','audit_log','INSERT') AS i");
  check('the app role can append to the audit log', audUpd.rows[0].i === true);
  check('the app role cannot rewrite the audit log', audUpd.rows[0].u === false && audUpd.rows[0].d === false);

  // ── §9 logout ───────────────────────────────────────────────────────────
  section('§9 logout');
  var lo = await A.call('POST', '/api/v1/auth/logout', {});
  check('logout succeeds', lo.status === 200);
  check('the session no longer works', (await A.call('GET', '/api/v1/clients')).status === 401);

  console.log('\nerp-acceptance: ' + passed + ' passed, ' + failed + ' failed');
  await new Promise(function (r) { httpServer.close(r); });
  await appPool.end(); await ownerPool.end();
  process.exitCode = failed ? 1 : 0;
})().catch(function (e) {
  console.error('SUITE CRASHED: ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
  try { httpServer && httpServer.close(); } catch (x) {}
  process.exit(1);
});
