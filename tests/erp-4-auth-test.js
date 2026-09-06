'use strict';

/* tests/erp-auth-test.js — Stage 4 authentication, authorization and audit.
 *
 * Runs offline with no dependencies: the database is a fake that pattern-matches
 * the SQL the code issues. That is deliberate — pg is not installed, and these
 * tests assert decision logic, not driver behaviour. Anything that genuinely
 * needs a server (constraints, grants, the role matrix) was verified against a
 * throwaway PostgreSQL 15 instance during Stage 4 design and is not re-faked
 * here, because a fake that agrees with itself proves nothing.
 */

var path = require('path');
var API = path.resolve(__dirname, '..', 'sites', 'erp.mythosprod.xyz', 'api');

var passwords = require(path.join(API, 'lib', 'password'));
var tokens    = require(path.join(API, 'lib', 'tokens'));
var audit     = require(path.join(API, 'lib', 'audit'));
var authz     = require(path.join(API, 'lib', 'authz'));
var auth      = require(path.join(API, 'lib', 'auth'));
var ratelimit = require(path.join(API, 'lib', 'ratelimit'));
var pipeline  = require(path.join(API, 'lib', 'pipeline'));
var migrate   = require(path.join(API, 'migrations', 'migrate'));

var T_A = 'aaaaaaaa-0000-4000-8000-000000000001';   // tenant A
var T_B = 'bbbbbbbb-0000-4000-8000-000000000002';   // tenant B

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// ── Fake database ───────────────────────────────────────────────────────────
function makeDb(seed) {
  var s = seed || {};
  var db = {
    users: s.users || [],
    sessions: s.sessions || [],
    perms: s.perms || {},          // userId -> [permission keys]
    attempts: [],
    audits: [],
    resets: [],
    updates: [],
    memberships: s.memberships || {},
    disabledModules: s.disabledModules || []
  };
  db.query = function (sql, params) {
    var p = params || [];
    var q = sql.replace(/\s+/g, ' ').trim();

    if (/^SELECT id, email, display_name, password_hash/.test(q)) {
      return Promise.resolve({ rows: db.users.filter(function (u) { return u.email === p[0] && !u.deleted_at; }) });
    }
    if (/INSERT INTO login_attempts/.test(q)) {
      db.attempts.push({ email: p[0], userId: p[1], ip: p[2], outcome: p[4] });
      return Promise.resolve({ rows: [] });
    }
    if (/FROM login_attempts WHERE ip/.test(q)) {
      var n = db.attempts.filter(function (a) { return a.ip === p[0] && a.outcome !== 'success'; }).length;
      return Promise.resolve({ rows: [{ n: n }] });
    }
    if (/INSERT INTO audit_log/.test(q)) {
      audit.assertAction(p[2]);
      db.audits.push({ actor_id: p[0], actor_label: p[1], action: p[2], entity_table: p[3],
                       entity_id: p[4], outcome: p[5], detail: JSON.parse(p[6]) });
      return Promise.resolve({ rows: [] });
    }
    if (/^UPDATE users SET failed_attempts = \$2/.test(q)) {
      var u1 = db.users.filter(function (u) { return u.id === p[0]; })[0];
      if (u1) { u1.failed_attempts = p[1]; u1.locked_until = p[2]; }
      return Promise.resolve({ rows: [] });
    }
    if (/^UPDATE users SET failed_attempts = 0/.test(q)) {
      var u2 = db.users.filter(function (u) { return u.id === p[0]; })[0];
      if (u2) { u2.failed_attempts = 0; u2.locked_until = null; }
      return Promise.resolve({ rows: [] });
    }
    if (/INSERT INTO sessions/.test(q)) {
      var sess = { id: 'sess-' + (db.sessions.length + 1), user_id: p[0], token_hash: p[1],
                   csrf_hash: p[2], idle_expires_at: p[3], absolute_expires_at: p[4], revoked_at: null,
                   active_tenant_id: p[7] || null };
      db.sessions.push(sess);
      return Promise.resolve({ rows: [{ id: sess.id }] });
    }
    if (/FROM sessions s JOIN users u/.test(q)) {
      var found = db.sessions.filter(function (x) { return x.token_hash === p[0]; })
        .map(function (x) {
          var u = db.users.filter(function (y) { return y.id === x.user_id; })[0] || {};
          return Object.assign({}, x, { email: u.email, display_name: u.display_name, is_active: u.is_active });
        });
      return Promise.resolve({ rows: found });
    }
    if (/^UPDATE sessions SET last_seen_at/.test(q)) { return Promise.resolve({ rows: [] }); }
    if (/^UPDATE sessions SET revoked_at.*WHERE id = \$1/.test(q)) {
      db.sessions.forEach(function (x) { if (x.id === p[0]) x.revoked_at = new Date(); });
      return Promise.resolve({ rows: [] });
    }
    if (/^UPDATE sessions SET revoked_at.*WHERE user_id = \$1/.test(q)) {
      db.sessions.forEach(function (x) { if (x.user_id === p[0]) x.revoked_at = new Date(); });
      return Promise.resolve({ rows: [] });
    }
    // Permissions resolve per (user, tenant): a grant in one company must not
    // authorise an action in another.
    if (/FROM user_effective_permissions WHERE user_id = \$1 AND tenant_id = \$2 AND permission_key/.test(q)) {
      var keys = db.perms[p[0] + ':' + p[1]] || db.perms[p[0]] || [];
      return Promise.resolve({ rows: keys.indexOf(p[2]) >= 0 ? [{ '?column?': 1 }] : [] });
    }
    if (/SELECT permission_key FROM user_effective_permissions/.test(q)) {
      var all = db.perms[p[0] + ':' + p[1]] || db.perms[p[0]] || [];
      return Promise.resolve({ rows: all.map(function (k) { return { permission_key: k }; }) });
    }
    if (/FROM tenant_memberships tm JOIN tenants t/.test(q)) {
      if (/tm.tenant_id = \$2/.test(q)) {
        var mem = (db.memberships[p[0]] || []).indexOf(p[1]) >= 0;
        return Promise.resolve({ rows: mem ? [{ '?column?': 1 }] : [] });
      }
      return Promise.resolve({ rows: (db.memberships[p[0]] || []).map(function (t, i) {
        return { id: t, key: 't' + i, display_name: 'Tenant ' + i, is_default: i === 0 }; }) });
    }
    if (/FROM tenant_modules WHERE module_key/.test(q)) {
      var off = db.disabledModules || [];
      return Promise.resolve({ rows: [{ enabled: off.indexOf(p[0]) < 0 }] });
    }
    if (/^UPDATE sessions SET active_tenant_id/.test(q)) {
      db.sessions.forEach(function (x) { if (x.id === p[0]) x.active_tenant_id = p[1]; });
      return Promise.resolve({ rows: [] });
    }
    if (/SELECT id FROM users WHERE email/.test(q)) {
      return Promise.resolve({ rows: db.users.filter(function (u) { return u.email === p[0] && u.is_active && !u.deleted_at; })
        .map(function (u) { return { id: u.id }; }) });
    }
    if (/INSERT INTO password_reset_tokens/.test(q)) {
      db.resets.push({ id: 'rst-' + (db.resets.length + 1), user_id: p[0], token_hash: p[1],
                       expires_at: p[2], consumed_at: null });
      return Promise.resolve({ rows: [] });
    }
    if (/FROM password_reset_tokens WHERE token_hash/.test(q)) {
      return Promise.resolve({ rows: db.resets.filter(function (r) { return r.token_hash === p[0]; }) });
    }
    if (/^UPDATE password_reset_tokens SET consumed_at/.test(q)) {
      db.resets.forEach(function (r) { if (r.id === p[0]) r.consumed_at = new Date(); });
      return Promise.resolve({ rows: [] });
    }
    if (/^UPDATE users SET password_hash/.test(q)) {
      var u3 = db.users.filter(function (u) { return u.id === p[0]; })[0];
      if (u3) { u3.password_hash = p[1]; u3.password_algo = p[2]; }
      return Promise.resolve({ rows: [] });
    }
    db.updates.push(q);
    return Promise.resolve({ rows: [] });
  };
  return db;
}

var FAST = { N: 1024, r: 8, p: 1, keylen: 32, saltlen: 16 };   // fast KDF for tests only
function deps(db, over) {
  return Object.assign({
    db: db,
    tx: function (fn) { return Promise.resolve(fn(db)); },
    withTenant: function (tenantId, fn) { db.lastTenant = tenantId; return Promise.resolve(fn(db)); },
    withoutTenant: function (fn) { return Promise.resolve(fn(db)); },
    sleep: function () { return Promise.resolve(); },   // skip the 200ms floor in tests
    nowMs: function () { return 0; }
  }, over || {});
}

(async function () {

// ── §1 password hashing ────────────────────────────────────────────────────
console.log('§1 password hashing');
var h = await passwords.hash('correct horse battery staple', FAST);
check('hash is self-describing with its parameters', /^\$scrypt\$N=1024,r=8,p=1\$/.test(h));
check('hash does not contain the plaintext', h.indexOf('correct horse') < 0);
check('correct password verifies', await passwords.verify('correct horse battery staple', h));
check('wrong password rejected', !(await passwords.verify('wrong horse battery staple', h)));
check('empty password rejected', !(await passwords.verify('', h)));
check('malformed hash returns false instead of throwing', !(await passwords.verify('x', 'not-a-hash')));
check('two hashes of the same password differ (salted)',
  h !== (await passwords.hash('correct horse battery staple', FAST)));
check('weak stored parameters are flagged for rehash', passwords.needsRehash(h));
check('current-policy hash is not flagged', !passwords.needsRehash('$scrypt$N=131072,r=8,p=1$AAAA$AAAA'));
try { await passwords.hash(''); check('empty password refused at hash time', false); }
catch (e) { check('empty password refused at hash time', true); }

// ── §2 tokens ──────────────────────────────────────────────────────────────
console.log('\n§2 tokens and cookies');
var t1 = tokens.generate(), t2 = tokens.generate();
check('tokens are unique', t1 !== t2);
check('token has >= 256 bits of entropy encoded', Buffer.from(t1, 'base64url').length >= 32);
check('stored form is a sha256 digest, not the token', tokens.hashToken(t1).length === 64 && tokens.hashToken(t1) !== t1);
check('same token hashes stably', tokens.hashToken(t1) === tokens.hashToken(t1));
check('safeEqual matches identical', tokens.safeEqual('abc', 'abc'));
check('safeEqual rejects different', !tokens.safeEqual('abc', 'abd'));
check('safeEqual rejects different lengths', !tokens.safeEqual('abc', 'abcd'));
var ck = tokens.cookieHeader(t1, 3600);
check('cookie uses __Host- prefix', /^__Host-erp_session=/.test(ck));
check('cookie is Secure', /; Secure/.test(ck));
check('cookie is HttpOnly', /; HttpOnly/.test(ck));
check('cookie sets SameSite', /; SameSite=Lax/.test(ck));
check('cookie has no Domain attribute (required by __Host-)', !/Domain=/.test(ck));
check('cookie parses back', tokens.readCookie('a=1; __Host-erp_session=' + t1 + '; b=2') === t1);
check('clear cookie expires immediately', /Max-Age=0/.test(tokens.clearCookieHeader()));

// ── §3 authentication ──────────────────────────────────────────────────────
console.log('\n§3 authentication');
var pwHash = await passwords.hash('a-really-long-password', FAST);
function freshDb() {
  return makeDb({ users: [{ id: 'u1', email: 'ana@mythos.test', display_name: 'Ana',
    password_hash: pwHash, password_algo: 'scrypt', is_active: true, failed_attempts: 0, locked_until: null }],
    memberships: { u1: [T_A] } });
}
var db = freshDb();
var ok = await auth.login(deps(db), { email: 'ana@mythos.test', password: 'a-really-long-password', ip: '10.0.0.1' });
check('correct credentials succeed', ok.ok === true);
check('a session token is issued', !!ok.token && ok.token.length > 20);
check('a csrf token is issued and differs from the session token', !!ok.csrf && ok.csrf !== ok.token);
check('session stored as hash, never in the clear',
  db.sessions[0].token_hash !== ok.token && db.sessions[0].token_hash === tokens.hashToken(ok.token));
check('login.success audited', db.audits.some(function (a) { return a.action === 'login.success'; }));
check('successful attempt recorded', db.attempts.some(function (a) { return a.outcome === 'success'; }));

db = freshDb();
var bad = await auth.login(deps(db), { email: 'ana@mythos.test', password: 'nope', ip: '10.0.0.1' });
check('wrong password fails', bad.ok === false);
check('login.failure audited', db.audits.some(function (a) { return a.action === 'login.failure'; }));

db = freshDb();
var ghost = await auth.login(deps(db), { email: 'nobody@mythos.test', password: 'nope', ip: '10.0.0.1' });
check('unknown user fails', ghost.ok === false);
check('unknown user and wrong password give the SAME error (no enumeration)', ghost.error === bad.error);
check('unknown-user attempt still recorded', db.attempts.some(function (a) { return a.outcome === 'unknown_user'; }));

db = freshDb();
for (var i = 0; i < 5; i++) await auth.login(deps(db), { email: 'ana@mythos.test', password: 'nope', ip: '10.0.0.9' });
check('account locks after 5 failures', !!db.users[0].locked_until);
var lockedRes = await auth.login(deps(db), { email: 'ana@mythos.test', password: 'a-really-long-password', ip: '10.0.0.9' });
check('correct password refused while locked', lockedRes.ok === false && lockedRes.error === 'locked');
check('lockout is time-bounded, never permanent', db.users[0].locked_until instanceof Date);
check('lockout backs off exponentially but is capped',
  auth.lockSeconds(5) === 900 && auth.lockSeconds(99) === auth.POLICY.accountLockMaxSeconds);

db = freshDb();
for (var j = 0; j < 20; j++) db.attempts.push({ ip: '10.0.0.5', outcome: 'bad_password' });
var throttled = await auth.login(deps(db), { email: 'ana@mythos.test', password: 'a-really-long-password', ip: '10.0.0.5' });
check('ip throttling refuses even a correct password', throttled.ok === false && throttled.error === 'rate_limited');

db = makeDb({ users: [{ id: 'u2', email: 'off@mythos.test', display_name: 'Off', password_hash: pwHash,
  password_algo: 'scrypt', is_active: false, failed_attempts: 0 }] });
var inactive = await auth.login(deps(db), { email: 'off@mythos.test', password: 'a-really-long-password', ip: '1.1.1.1' });
check('inactive account cannot log in', inactive.ok === false);
check('inactive gives the generic error too', inactive.error === 'invalid_credentials');

check('short passwords rejected by policy', auth.validatePasswordStrength('short').ok === false);
check('12+ character passwords accepted', auth.validatePasswordStrength('123456789012').ok === true);

// ── §4 sessions ────────────────────────────────────────────────────────────
console.log('\n§4 sessions');
db = freshDb();
var s1 = await auth.login(deps(db), { email: 'ana@mythos.test', password: 'a-really-long-password', ip: '10.0.0.1' });
var valid = await auth.validateSession(deps(db), s1.token);
check('valid session resolves to its user', valid && valid.user.id === 'u1');
check('unknown token resolves to null', (await auth.validateSession(deps(db), 'bogus')) === null);
check('absent token resolves to null', (await auth.validateSession(deps(db), null)) === null);

db.sessions[0].idle_expires_at = new Date(Date.now() - 1000);
check('idle-expired session rejected', (await auth.validateSession(deps(db), s1.token)) === null);
db.sessions[0].idle_expires_at = new Date(Date.now() + 3600e3);
db.sessions[0].absolute_expires_at = new Date(Date.now() - 1000);
check('absolute-expired session rejected even when recently used',
  (await auth.validateSession(deps(db), s1.token)) === null);
db.sessions[0].absolute_expires_at = new Date(Date.now() + 3600e3);
db.sessions[0].revoked_at = new Date();
check('revoked session rejected', (await auth.validateSession(deps(db), s1.token)) === null);
db.sessions[0].revoked_at = null;
db.users[0].is_active = false;
check('session dies immediately when the user is deactivated',
  (await auth.validateSession(deps(db), s1.token)) === null);
db.users[0].is_active = true;

var sess = await auth.validateSession(deps(db), s1.token);
check('correct csrf token accepted', auth.checkCsrf(sess, s1.csrf));
check('wrong csrf token rejected', !auth.checkCsrf(sess, 'wrong'));
check('missing csrf token rejected', !auth.checkCsrf(sess, null));
check('csrf rejected when there is no session', !auth.checkCsrf(null, s1.csrf));

// ── §5 authorization ───────────────────────────────────────────────────────
console.log('\n§5 authorization');
check('GET clients requires clients.read', authz.requiredPermission('clients', 'GET') === 'clients.read');
check('POST clients requires clients.write', authz.requiredPermission('clients', 'POST') === 'clients.write');
check('DELETE finance requires finance.delete', authz.requiredPermission('finance', 'DELETE') === 'finance.delete');
check('unknown module has no permission (deny by default)', authz.requiredPermission('nope', 'GET') === null);
check('unmapped verb has no permission (deny by default)', authz.requiredPermission('reports', 'DELETE') === null);
check('planning has no delete verb mapped', authz.requiredPermission('planning', 'DELETE') === null);

var adb = makeDb({ perms: { ['u1:' + T_A]: ['clients.read'] } });
var allowed = await authz.authorize(adb, { user: { id: 'u1', email: 'a@b.c' }, tenantId: T_A, module: 'clients', method: 'GET' });
check('user with the permission is allowed', allowed.allowed === true);
var denied = await authz.authorize(adb, { user: { id: 'u1', email: 'a@b.c' }, tenantId: T_A, module: 'clients', method: 'POST' });
check('user without the permission is denied', denied.allowed === false);
check('denial is audited as permission.denied',
  adb.audits.some(function (a) { return a.action === 'permission.denied' && a.outcome === 'denied'; }));
var anon = await authz.authorize(adb, { user: null, tenantId: T_A, module: 'clients', method: 'GET' });
check('anonymous is denied', anon.allowed === false && anon.reason === 'unauthenticated');
var unknown = await authz.authorize(adb, { user: { id: 'u1', email: 'a@b.c' }, tenantId: T_A, module: 'wat', method: 'GET' });
check('unknown module denied and audited', unknown.allowed === false && unknown.reason === 'no_permission_mapping');
var noTenant = await authz.authorize(adb, { user: { id: 'u1', email: 'a@b.c' }, tenantId: null, module: 'clients', method: 'GET' });
check('a permission-holding user with NO active tenant is denied',
  noTenant.allowed === false && noTenant.reason === 'no_active_tenant');

// ── §6 permission boundaries ───────────────────────────────────────────────
console.log('\n§6 permission boundaries');
var bdb = makeDb({ perms: {
  ['fin:' + T_A]: ['dashboard.read','finance.read','finance.write','reports.read','reports.export','clients.read','projects.read','documents.read'],
  ['prod:' + T_A]: ['dashboard.read','production.read','production.write','planning.read','planning.write','inventory.read','inventory.write','clients.read','documents.read'],
  ['ro:' + T_A]: ['dashboard.read','clients.read','projects.read','planning.read','production.read','finance.read','documents.read','reports.read','inventory.read']
} });
async function may(uid, mod, method) {
  var d = await authz.authorize(bdb, { user: { id: uid, email: uid + '@t' }, tenantId: T_A, module: mod, method: method });
  return d.allowed;
}
check('finance user CAN write finance', await may('fin', 'finance', 'POST'));
check('finance user CANNOT write production', !(await may('fin', 'production', 'POST')));
check('finance user CANNOT delete finance', !(await may('fin', 'finance', 'DELETE')));
check('production user CAN write production', await may('prod', 'production', 'POST'));
check('production user CANNOT read finance', !(await may('prod', 'finance', 'GET')));
check('production user CANNOT write clients', !(await may('prod', 'clients', 'POST')));
check('read-only CAN read clients', await may('ro', 'clients', 'GET'));
check('read-only CANNOT write anything', !(await may('ro', 'clients', 'POST')) && !(await may('ro', 'finance', 'POST')));
check('read-only CANNOT read the audit log', !(await may('ro', 'audit', 'GET')));
check('read-only CANNOT read settings', !(await may('ro', 'settings', 'GET')));

// ── §7 audit log ───────────────────────────────────────────────────────────
console.log('\n§7 audit log');
var udb = makeDb({});
await audit.write(udb, { actor_label: 'x', action: 'record.created', entity_table: 'clients', outcome: 'ok' });
check('valid entry written', udb.audits.length === 1);
try { await audit.write(udb, { actor_label: 'x', action: 'invented.action', entity_table: 'c', outcome: 'ok' });
  check('invented action rejected', false); } catch (e) { check('invented action rejected', true); }
try { await audit.write(udb, { actor_label: 'x', action: 'record.created', entity_table: 'c', outcome: 'maybe' });
  check('invalid outcome rejected', false); } catch (e) { check('invalid outcome rejected', true); }
try { await audit.write(udb, { action: 'record.created', entity_table: 'c', outcome: 'ok' });
  check('missing actor_label rejected', false); } catch (e) { check('missing actor_label rejected', true); }
check('taxonomy covers all required event classes',
  ['login.success','login.failure','record.created','record.updated','record.deleted',
   'permission.denied','role.assigned','backup.restored'].every(function (a) { return audit.ACTIONS.indexOf(a) >= 0; }));
var red = audit.redact({ email: 'a@b.c', password: 'hunter2', nested: { token: 'abc', keep: 1 } });
check('password redacted', red.password === '[redacted]');
check('nested token redacted', red.nested.token === '[redacted]');
check('non-secret fields preserved', red.email === 'a@b.c' && red.nested.keep === 1);
await audit.write(udb, { actor_label: 'x', action: 'password.changed', entity_table: 'users',
  outcome: 'ok', detail: { password: 'hunter2' } });
check('secrets never reach the stored detail',
  JSON.stringify(udb.audits[udb.audits.length - 1].detail).indexOf('hunter2') < 0);

// ── §8 request pipeline ────────────────────────────────────────────────────
console.log('\n§8 request pipeline');
check('login route is public', pipeline.isPublic('POST', '/api/v1/auth/login'));
check('clients route is not public', !pipeline.isPublic('GET', '/api/v1/clients'));
check('module parsed from path', pipeline.moduleFromPath('/api/v1/clients/42') === 'clients');
check('non-api path yields no module', pipeline.moduleFromPath('/etc/passwd') === null);

var pdb = makeDb({ perms: {} });
var ran = false;
var r401 = await pipeline.handle(deps(pdb), { method: 'GET', path: '/api/v1/clients', tenantId: T_A }, function () {
  ran = true;
  return { status: 200, body: {} };
});
check('unauthenticated request refused with 401', r401.status === 401);
// Assert *which* gate refused it. Authorization would also produce a 401 here,
// so a status-only assertion cannot tell a working authentication gate from a
// missing one — mutation testing found exactly that hole.
check('refusal comes from the authentication gate, not a later one',
  r401.body && r401.body.error === 'unauthenticated');
check('the handler never runs for an unauthenticated request', ran === false);

var sdb = freshDb();
var lg = await auth.login(deps(sdb), { email: 'ana@mythos.test', password: 'a-really-long-password', ip: '1.2.3.4' });
sdb.perms = { ['u1:' + T_A]: ['clients.read'] };
var r403 = await pipeline.handle(deps(sdb), { method: 'POST', path: '/api/v1/clients', tenantId: T_A, token: lg.token, csrf: lg.csrf, body: {} },
  function () { return { status: 200, body: {}, audit: { action: 'record.created' } }; });
check('authenticated but unauthorized refused with 403', r403.status === 403);

var r200 = await pipeline.handle(deps(sdb), { method: 'GET', path: '/api/v1/clients', tenantId: T_A, token: lg.token },
  function () { return { status: 200, body: { ok: true } }; });
check('authorized read succeeds', r200.status === 200);

sdb.perms = { ['u1:' + T_A]: ['clients.read', 'clients.write'] };
var rCsrf = await pipeline.handle(deps(sdb), { method: 'POST', path: '/api/v1/clients', tenantId: T_A, token: lg.token, csrf: 'wrong', body: {} },
  function () { return { status: 200, body: {}, audit: { action: 'record.created' } }; });
check('unsafe verb without valid csrf refused with 403', rCsrf.status === 403);
check('csrf failure audited', sdb.audits.some(function (a) {
  return a.action === 'permission.denied' && a.detail && a.detail.reason === 'csrf_failed'; }));

var rOk = await pipeline.handle(deps(sdb), { method: 'POST', path: '/api/v1/clients', tenantId: T_A, token: lg.token, csrf: lg.csrf, body: { name: 'X' } },
  function () { return { status: 201, body: {}, audit: { action: 'record.created', entity_table: 'clients' } }; });
check('authorized write succeeds', rOk.status === 201);
check('write produced an audit record', sdb.audits.some(function (a) { return a.action === 'record.created'; }));

var threw = false;
try {
  await pipeline.handle(deps(sdb), { method: 'POST', path: '/api/v1/clients', tenantId: T_A, token: lg.token, csrf: lg.csrf, body: {} },
    function () { return { status: 200, body: {} }; });   // no audit descriptor
} catch (e) { threw = /unaudited state change/.test(e.message); }
check('a state change without an audit descriptor is refused', threw);

var rVal = await pipeline.handle(deps(sdb), { method: 'POST', path: '/api/v1/clients', tenantId: T_A, token: lg.token, csrf: lg.csrf, body: {} },
  function () { return { status: 201, body: {}, audit: { action: 'record.created' } }; },
  function () { return { ok: false, error: 'name required' }; });
check('validation failure refused with 422', rVal.status === 422);

// ── §9 password reset ──────────────────────────────────────────────────────
console.log('\n§9 password reset');
var rdb = freshDb();
var sLive = await auth.login(deps(rdb), { email: 'ana@mythos.test', password: 'a-really-long-password', ip: '1.1.1.1' });
var req = await auth.requestPasswordReset(deps(rdb), 'ana@mythos.test', '1.1.1.1');
check('reset issued for a real address', req.ok === true && req.dispatched === true);
var ghostReq = await auth.requestPasswordReset(deps(rdb), 'nobody@mythos.test', '1.1.1.1');
check('reset for an unknown address returns the SAME ok (no enumeration)', ghostReq.ok === req.ok);
check('but nothing is dispatched for the unknown address', ghostReq.dispatched === false);
check('reset token stored as a hash', rdb.resets[0].token_hash !== req.token);
check('reset request audited', rdb.audits.some(function (a) { return a.action === 'password.reset_requested'; }));

var done = await auth.completePasswordReset(deps(rdb), req.token, 'a-brand-new-password', '1.1.1.1');
check('reset completes with a strong password', done.ok === true);
check('reset completion audited', rdb.audits.some(function (a) { return a.action === 'password.reset_completed'; }));
check('existing sessions revoked by the reset', rdb.sessions.every(function (x) { return !!x.revoked_at; }));
check('the revoked session no longer validates', (await auth.validateSession(deps(rdb), sLive.token)) === null);
var replay = await auth.completePasswordReset(deps(rdb), req.token, 'another-long-password', '1.1.1.1');
check('reset token is single use', replay.ok === false && replay.error === 'invalid_token');
var weak = await auth.completePasswordReset(deps(rdb), 'x', 'short', '1.1.1.1');
check('weak password refused before the token is even checked', weak.ok === false && /12 characters/.test(weak.error));

var edb = freshDb();
var er = await auth.requestPasswordReset(deps(edb), 'ana@mythos.test', '1.1.1.1');
edb.resets[0].expires_at = new Date(Date.now() - 1000);
var expired = await auth.completePasswordReset(deps(edb), er.token, 'a-brand-new-password', '1.1.1.1');
check('expired reset token rejected', expired.ok === false && expired.error === 'invalid_token');

// ── §10 migrations ─────────────────────────────────────────────────────────
console.log('\n§10 migration runner');
var mdb = { rows: [], applied: [] };
mdb.query = function (sql, params) {
  if (/CREATE TABLE IF NOT EXISTS schema_migrations/.test(sql)) return Promise.resolve({ rows: [] });
  if (/SELECT version, checksum FROM schema_migrations/.test(sql)) return Promise.resolve({ rows: mdb.rows });
  if (/INSERT INTO schema_migrations/.test(sql)) { mdb.rows.push({ version: params[0], checksum: params[1] }); return Promise.resolve({ rows: [] }); }
  mdb.applied.push(sql.slice(0, 20));
  return Promise.resolve({ rows: [] });
};
var fake = [{ version: '001.sql', sql: 'SELECT 1', checksum: 'aaa' }];
var m1 = await migrate.migrate(mdb, { migrations: fake });
check('first run applies the migration', m1.applied.length === 1);
var m2 = await migrate.migrate(mdb, { migrations: fake });
check('second run skips it', m2.applied.length === 0 && m2.skipped.length === 1);
var tampered = false;
try { await migrate.migrate(mdb, { migrations: [{ version: '001.sql', sql: 'SELECT 2', checksum: 'bbb' }] }); }
catch (e) { tampered = /changed after being applied/.test(e.message); }
check('editing an applied migration is detected, not silently skipped', tampered);
check('real migration files are discoverable', migrate.load().length === 6);
check('real migration files checksum stably',
  migrate.load()[0].checksum === migrate.load()[0].checksum && migrate.load()[0].checksum.length === 64);

// ── §11 general rate limiting (Phase 14) ────────────────────────────────────
console.log('\n§11 rate limiting');
ratelimit.reset();
var rlNow = 1000000;
var rlUnder = null;
for (var i = 0; i < ratelimit.MAX_REQUESTS; i++) rlUnder = ratelimit.check('203.0.113.9', rlNow);
check('requests at exactly the limit are still allowed', rlUnder.allowed === true);
var rlOver = ratelimit.check('203.0.113.9', rlNow);
check('the next request in the same window is refused (429)', rlOver.allowed === false && rlOver.retryAfterSeconds > 0);
var rlOther = ratelimit.check('203.0.113.10', rlNow);
check('a different IP is tracked independently, unaffected by the first IP\'s flood', rlOther.allowed === true);
var rlNextWindow = ratelimit.check('203.0.113.9', rlNow + ratelimit.WINDOW_MS + 1);
check('the window resets: the same IP is allowed again once it elapses', rlNextWindow.allowed === true);
ratelimit.reset();

console.log('\nerp-auth: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;

})().catch(function (e) {
  console.error('SUITE CRASHED: ' + e.stack);
  process.exitCode = 1;
});
