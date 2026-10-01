'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — security tests
// projects/mythos-trading-control-center/tests/security-test.js
//
// The mutation contract is "authenticate → authorize → validate → execute →
// audit → deterministic result". This suite attacks each step from outside,
// over HTTP, and walks the route table itself so a route added later is
// covered without anyone remembering to add a test for it.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var http = require('http');
var path = require('path');

var h = require('./helpers');
var serverMod = require(path.join(h.ROOT, 'server', 'server'));

var S, owner, operator, viewer, webDir;

/** A stand-in web directory, so static-file rules are tested without the real UI. */
function makeWebDir() {
  var dir = h.tempDir('tcc-web-');
  fs.mkdirSync(path.join(dir, 'assets', 'js'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>app</title>');
  fs.writeFileSync(path.join(dir, 'login.html'), '<!doctype html><title>login</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'js', 'app.js'), 'var app = 1;');
  fs.writeFileSync(path.join(dir, 'assets', 'js', 'login.js'), 'var login = 1;');
  fs.writeFileSync(path.join(dir, 'assets', 'tokens.css'), ':root{}');
  fs.writeFileSync(path.join(dir, 'assets', 'secret.env'), 'PASSWORD=x');
  fs.writeFileSync(path.join(dir, '.hidden.js'), 'var hidden = 1;');
  return dir;
}

test.before(async function () {
  webDir = makeWebDir();
  S = await h.startApp({ webDir: webDir });
  owner = await S.login('owner');
  operator = await S.login('operator');
  viewer = await S.login('viewer');
});

test.after(async function () {
  await S.close();
  fs.rmSync(webDir, { recursive: true, force: true });
});

/** A concrete path for a route, with parameters that satisfy their patterns. */
function concrete(route) {
  return route.path
    .replace(':candidateId', 'cand-x-000001')
    .replace(':tradeId', 'trade-x-000001')
    .replace(':recordId', 'chal-000001')
    .replace(/\/api\/testing\/runs\/:runId/, '/api/testing/runs/tr-20260101000000-abcdef')
    .replace(':runId', 'bt-20260101000000-abcdef');
}

function raw(method, p, headers, body) {
  return new Promise(function (resolve, reject) {
    var req = http.request({ host: '127.0.0.1', port: S.port, method: method, path: p, headers: headers || {}, agent: false }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// the route table itself
// ---------------------------------------------------------------------------

test('every route declares a role; the only public route is the liveness probe', function () {
  var publicRoutes = S.app.routes.filter(function (r) { return r.role === null; }).map(function (r) { return r.method + ' ' + r.path; });
  assert.deepEqual(publicRoutes, ['GET /api/health']);
  S.app.routes.forEach(function (r) {
    assert.ok(r.role === null || ['VIEWER', 'OPERATOR', 'OWNER'].indexOf(r.role) !== -1, r.path + ' has no valid role');
  });
});

test('every mutation route declares an audit action and requires at least OPERATOR', function () {
  var mutations = S.app.routes.filter(function (r) { return r.method !== 'GET'; });
  assert.ok(mutations.length >= 15);
  mutations.forEach(function (r) {
    assert.ok(typeof r.audit === 'string' && r.audit.length > 3, r.method + ' ' + r.path + ' has no audit action');
    assert.ok(r.role === 'OPERATOR' || r.role === 'OWNER', r.method + ' ' + r.path + ' is open to ' + r.role);
    assert.ok(r.body, r.method + ' ' + r.path + ' declares no body shape');
  });
});

test('no route can express a position size, an order or a live execution', function () {
  var forbiddenPath = /live|order|execute|broker|venue|deposit|withdraw/i;
  var forbiddenField = /^(lots|size|volume|quantity|qty|positionSize|orderSize|leverage|approvedLots|requestedLots)$/i;
  S.app.routes.forEach(function (r) {
    assert.ok(!forbiddenPath.test(r.path), 'route ' + r.path + ' looks like an execution route');
    (function walk(spec, where) {
      if (!spec || typeof spec !== 'object') return;
      if (spec.fields) {
        Object.keys(spec.fields).forEach(function (k) {
          // risk.maxPositionSizeLots is a LIMIT handed to the Risk Engine, not a size.
          assert.ok(!forbiddenField.test(k), r.path + ' accepts a size-like field: ' + where + k);
          walk(spec.fields[k], where + k + '.');
        });
      }
      if (spec.items) walk(spec.items, where + '[].');
      if (spec.values && typeof spec.values === 'object' && !Array.isArray(spec.values)) walk(spec.values, where + '*.');
    })(r.body, '');
  });
});

// ---------------------------------------------------------------------------
// authentication
// ---------------------------------------------------------------------------

test('every non-public route answers 401 without a session, GET and mutation alike', async function () {
  var anon = S.client();
  for (var i = 0; i < S.app.routes.length; i++) {
    var r = S.app.routes[i];
    if (r.role === null) continue;
    var res = await anon.request(r.method, concrete(r), r.method === 'GET' ? null : {});
    assert.equal(res.status, 401, r.method + ' ' + r.path + ' → ' + res.status);
    assert.equal(res.body.error.code, 'UNAUTHENTICATED');
    assert.equal(res.body.result, undefined, r.path + ' leaked a result to an unauthenticated caller');
  }
});

test('the event stream and unknown API paths give nothing to an unauthenticated caller', async function () {
  var anon = S.client();
  assert.equal((await anon.get('/api/paper/stream')).status, 401);
  assert.equal((await anon.get('/api/nope')).status, 404);
  assert.equal((await anon.get('/api')).status, 404);
});

test('an unauthenticated mutation attempt is written to the audit chain', async function () {
  var before = S.app.audit.count();
  await S.client().post('/api/config/trading', { enabled: true, reason: 'no session at all', confirm: 'ENABLE' });
  var last = S.app.audit.list({ limit: 1 }).items[0];
  assert.equal(S.app.audit.count(), before + 1);
  assert.equal(last.action, 'trading.set');
  assert.equal(last.outcome, 'REFUSED');
  assert.equal(last.code, 'UNAUTHENTICATED');
  assert.equal(last.actor.id, 'unauthenticated');
});

test('sign-in fails identically for an unknown user and a wrong password', async function () {
  var a = await S.client().login('owner', 'not-the-password');
  var b = await S.client().login('nobody-here', 'not-the-password');
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(a.body.error, b.body.error, 'the response must not reveal which user names exist');
  assert.equal(a.headers['set-cookie'], undefined);
});

test('a failed sign-in is audited without the password', async function () {
  await S.client().login('owner', 'a-very-secret-wrong-password');
  var last = S.app.audit.list({ action: 'auth.login', limit: 1 }).items[0];
  assert.equal(last.outcome, 'REFUSED');
  assert.equal(last.code, 'INVALID_CREDENTIALS');
  assert.ok(JSON.stringify(last).indexOf('a-very-secret-wrong-password') === -1);
});

test('the session cookie is HttpOnly, SameSite=Strict, Secure, and a fresh id is minted at sign-in', async function () {
  var c = S.client();
  c.setCookie('tcc_session=' + 'f'.repeat(64));     // a cookie an attacker planted
  var res = await c.login('viewer', h.PASSWORDS.viewer);
  var set = res.headers['set-cookie'][0];
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  assert.match(set, /Secure/);
  var id = set.split(';')[0].split('=')[1];
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.notEqual(id, 'f'.repeat(64), 'a pre-existing cookie value must never be adopted (session fixation)');
});

test('signing out destroys the session server-side', async function () {
  var c = await S.login('viewer');
  assert.equal((await c.get('/api/status')).status, 200);
  var cookie = c.cookie();
  var out = await c.logout();
  assert.equal(out.status, 200);
  assert.match(out.headers['set-cookie'][0], /Max-Age=0/);
  var replay = S.client();
  replay.setCookie(cookie);
  assert.equal((await replay.get('/api/status')).status, 401, 'the old cookie must be dead after sign-out');
});

test('a forged or malformed cookie is not a session', async function () {
  var c = S.client();
  for (var value of ['tcc_session=' + 'a'.repeat(64), 'tcc_session=../../etc', 'tcc_session=', 'other=1']) {
    c.setCookie(value);
    assert.equal((await c.get('/api/status')).status, 401, value);
  }
});

test('the session endpoint reveals nothing when signed out and the role when signed in', async function () {
  var anon = (await S.client().get('/api/auth/session')).body.result;
  assert.deepEqual(anon, { authenticated: false });
  var me = (await operator.get('/api/auth/session')).body.result;
  assert.equal(me.user.role, 'OPERATOR');
  assert.deepEqual(me.can, { read: true, operate: true, own: false });
});

// ---------------------------------------------------------------------------
// authorization
// ---------------------------------------------------------------------------

test('a VIEWER is refused on every mutation route', async function () {
  var mutations = S.app.routes.filter(function (r) { return r.method !== 'GET'; });
  for (var i = 0; i < mutations.length; i++) {
    var r = mutations[i];
    var res = await viewer.request(r.method, concrete(r), {});
    assert.equal(res.status, 403, r.method + ' ' + r.path + ' → ' + res.status + ' ' + JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'FORBIDDEN');
  }
});

test('an OPERATOR is refused on every OWNER route', async function () {
  var ownerOnly = S.app.routes.filter(function (r) { return r.role === 'OWNER'; });
  assert.ok(ownerOnly.length >= 4);
  for (var i = 0; i < ownerOnly.length; i++) {
    var r = ownerOnly[i];
    var res = await operator.request(r.method, concrete(r), {});
    assert.equal(res.status, 403, r.method + ' ' + r.path + ' → ' + res.status);
  }
});

test('authorization is checked before validation, so a forbidden caller learns nothing about the body shape', async function () {
  var res = await viewer.patch('/api/config', { nonsense: true });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.problems, undefined);
});

// ---------------------------------------------------------------------------
// CSRF and origin
// ---------------------------------------------------------------------------

test('a mutation without the CSRF token is refused, and so is one with another session\'s token', async function () {
  var body = { enabled: false, reason: 'csrf test, should not apply' };
  var none = await owner.post('/api/config/trading', body, { 'X-TCC-CSRF': null });
  assert.equal(none.status, 403);
  assert.equal(none.body.error.code, 'CSRF');
  var wrong = await owner.post('/api/config/trading', body, { 'X-TCC-CSRF': 'a'.repeat(64) });
  assert.equal(wrong.status, 403);
  var other = await owner.post('/api/config/trading', body, { 'X-TCC-CSRF': operator.csrf() });
  assert.equal(other.status, 403, 'a token is bound to its own session');
  assert.equal((await viewer.get('/api/status')).body.result.tradingEnabled, true);
  var last = S.app.audit.list({ action: 'trading.set', limit: 1 }).items[0];
  assert.equal(last.outcome, 'REFUSED');
  assert.equal(last.code, 'CSRF');
});

test('a state-changing request from a foreign origin is refused', async function () {
  var body = { enabled: false, reason: 'cross-origin, should not apply' };
  var foreign = await owner.post('/api/config/trading', body, { Origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.error.code, 'CROSS_ORIGIN');
  var site = await owner.post('/api/config/trading', body, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(site.status, 403);
  var sameSite = await owner.post('/api/config/trading', body, { 'Sec-Fetch-Site': 'same-site' });
  assert.equal(sameSite.status, 403, 'same-site is not same-origin');
  assert.equal((await viewer.get('/api/status')).body.result.tradingEnabled, true);
  var login = await S.client().request('POST', '/api/auth/login', { user: 'owner', password: h.PASSWORDS.owner }, { Origin: 'https://evil.example' });
  assert.equal(login.status, 403, 'sign-in is also same-origin only');
});

test('with a public origin configured, only that exact origin is accepted', async function () {
  var A = await h.startApp({ publicOrigin: 'https://trading.mythosprod.xyz', webDir: webDir });
  var o = await A.login('owner');
  var body = { enabled: false, reason: 'origin check with a configured origin' };
  assert.equal((await o.post('/api/config/trading', body, { Origin: 'https://trading.mythosprod.xyz.evil.example' })).status, 403);
  assert.equal((await o.post('/api/config/trading', body, { Origin: 'http://trading.mythosprod.xyz' })).status, 403);
  assert.equal((await o.post('/api/config/trading', body, { Origin: 'https://trading.mythosprod.xyz' })).status, 200);
  await A.close();
});

// ---------------------------------------------------------------------------
// CORS and headers
// ---------------------------------------------------------------------------

test('no CORS header is ever sent, including on a preflight', async function () {
  var pre = await raw('OPTIONS', '/api/config', { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'PATCH' });
  assert.equal(pre.status, 204);
  var responses = [pre, await raw('GET', '/api/health', { Origin: 'https://evil.example' }),
    await raw('GET', '/api/status', { Origin: 'https://evil.example' })];
  responses.forEach(function (r) {
    Object.keys(r.headers).forEach(function (k) {
      assert.ok(k.toLowerCase().indexOf('access-control-') !== 0, 'unexpected CORS header ' + k);
    });
  });
});

test('security headers are present on API, error, redirect and static responses', async function () {
  var samples = [
    await raw('GET', '/api/health'),
    await raw('GET', '/api/status'),                 // 401
    await raw('GET', '/dashboard'),                  // 302
    await raw('GET', '/login'),                      // static
    await raw('GET', '/nope')                        // 404
  ];
  samples.forEach(function (r) {
    assert.match(r.headers['content-security-policy'], /default-src 'self'/);
    assert.match(r.headers['content-security-policy'], /script-src 'self'/);
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.match(r.headers['content-security-policy'], /object-src 'none'/);
    assert.ok(r.headers['content-security-policy'].indexOf('unsafe-inline') === -1, 'the CSP must not allow inline script or style');
    assert.ok(r.headers['content-security-policy'].indexOf('unsafe-eval') === -1);
    assert.match(r.headers['strict-transport-security'], /max-age=31536000/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin');
    assert.ok(r.headers['permissions-policy']);
    assert.equal(r.headers['x-powered-by'], undefined);
    assert.equal(r.headers.server, undefined);
  });
});

test('API responses are never cacheable', async function () {
  var r = await viewer.get('/api/dashboard');
  assert.equal(r.headers['cache-control'], 'no-store');
  var e = await S.client().get('/api/dashboard');
  assert.equal(e.headers['cache-control'], 'no-store');
});

// ---------------------------------------------------------------------------
// request handling
// ---------------------------------------------------------------------------

test('only GET, HEAD, POST, PATCH and OPTIONS are accepted', async function () {
  for (var m of ['PUT', 'DELETE', 'TRACE', 'CONNECT']) {
    if (m === 'CONNECT') continue;      // handled by node before the request event
    var r = await raw(m, '/api/status');
    assert.equal(r.status, 405, m);
  }
  assert.equal((await owner.request('POST', '/api/status', {})).status, 405);
  assert.equal((await owner.request('GET', '/api/config/trading')).status, 405);
});

test('HEAD mirrors GET without a body', async function () {
  var r = await raw('HEAD', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.text, '');
});

test('an oversized, malformed or mistyped body is refused before any handler runs', async function () {
  var big = JSON.stringify({ reason: 'x'.repeat(70 * 1024), enabled: false });
  var tooBig = await owner.request('POST', '/api/config/trading', null, { 'Content-Type': 'application/json' }, big);
  assert.equal(tooBig.status, 413);
  var notJson = await owner.request('POST', '/api/config/trading', null, { 'Content-Type': 'application/json' }, '{oops');
  assert.equal(notJson.status, 400);
  var form = await owner.request('POST', '/api/config/trading', null, { 'Content-Type': 'application/x-www-form-urlencoded' }, 'enabled=false');
  assert.equal(form.status, 415);
  var arr = await owner.request('POST', '/api/config/trading', null, { 'Content-Type': 'application/json' }, '[1,2]');
  assert.equal(arr.status, 400);
  assert.equal((await viewer.get('/api/status')).body.result.tradingEnabled, true);
});

test('unknown body fields and wrong types are refused with the list of problems', async function () {
  var res = await owner.post('/api/config/trading', { enabled: 'no', reason: 'wrong type and an extra field', admin: true });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  var paths = res.body.error.problems.map(function (p) { return p.path; });
  assert.ok(paths.indexOf('enabled') !== -1);
  assert.ok(paths.indexOf('admin') !== -1);
});

test('prototype-pollution-shaped input changes nothing', async function () {
  var payload = '{"changes":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}},"reason":"prototype pollution attempt"}';
  var res = await owner.request('PATCH', '/api/config', null, { 'Content-Type': 'application/json' }, payload);
  assert.ok(res.status === 400, 'status was ' + res.status);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('malformed paths, traversal and oversized URLs are refused', async function () {
  for (var p of ['/../server/server.js', '/assets/../../server/auth.js', '/assets/%2e%2e/%2e%2e/server/auth.js',
    '//etc/passwd', '/assets/..%2fserver%2fauth.js', '/assets\\js\\app.js', '/api/trades/%00']) {
    var r = await raw('GET', p, { Cookie: owner.cookie() });
    assert.ok(r.status === 400 || r.status === 404, p + ' → ' + r.status);
    assert.ok(r.text.indexOf('require(') === -1, p + ' returned source code');
  }
  var long = await raw('GET', '/api/status?x=' + 'a'.repeat(3000), { Cookie: owner.cookie() });
  assert.equal(long.status, 414);
});

test('static files come from a whitelist: no dotfiles, no unknown types, nothing outside it', async function () {
  var cookie = { Cookie: owner.cookie() };
  assert.equal((await raw('GET', '/assets/js/app.js', cookie)).status, 200);
  assert.equal((await raw('GET', '/assets/secret.env', cookie)).status, 404, 'an unlisted file type must not be served');
  assert.equal((await raw('GET', '/.hidden.js', cookie)).status, 404, 'dotfiles must not be served');
  assert.equal((await raw('GET', '/index.html', cookie)).status, 404, 'the shell is served only through an application route');
  assert.equal((await raw('GET', '/server/server.js', cookie)).status, 404);
  assert.equal((await raw('GET', '/package.json', cookie)).status, 404);
});

test('an unauthenticated browser gets the login page and its assets, and nothing else', async function () {
  assert.equal((await raw('GET', '/login')).status, 200);
  assert.equal((await raw('GET', '/assets/js/login.js')).status, 200);
  assert.equal((await raw('GET', '/assets/tokens.css')).status, 200);
  assert.equal((await raw('GET', '/assets/js/app.js')).status, 401, 'the application bundle is not public');
  for (var route of serverMod.APP_ROUTES) {
    var r = await raw('GET', route);
    assert.equal(r.status, 302, route);
    assert.equal(r.headers.location, '/login');
  }
});

test('a signed-in browser gets the shell on every application route, uncached', async function () {
  for (var route of serverMod.APP_ROUTES) {
    var r = await raw('GET', route, { Cookie: owner.cookie() });
    if (route === '/') { assert.equal(r.status, 302); continue; }
    assert.equal(r.status, 200, route);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.headers['content-type'], /text\/html/);
  }
  var login = await raw('GET', '/login', { Cookie: owner.cookie() });
  assert.equal(login.status, 302, 'a signed-in user is sent past the login page');
});

test('robots are told to stay out', async function () {
  var r = await raw('GET', '/robots.txt');
  assert.equal(r.status, 200);
  assert.match(r.text, /Disallow: \//);
  assert.match(r.headers['x-robots-tag'], /noindex/);
});

// ---------------------------------------------------------------------------
// error handling and secrets
// ---------------------------------------------------------------------------

test('an unexpected error becomes a generic 500 with an id; no message, path or stack leaks', async function () {
  var original = S.app.platform.status;
  var routesStatus = S.app.routes.filter(function (r) { return r.path === '/api/status'; })[0];
  var originalHandler = routesStatus.handler;
  routesStatus.handler = function () { throw new Error('secret internal detail at /home/deploy/private/path'); };
  try {
    var res = await viewer.get('/api/status');
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL');
    assert.match(res.body.error.errorId, /^[0-9a-f]{12}$/);
    assert.ok(res.text.indexOf('secret internal detail') === -1);
    assert.ok(res.text.indexOf('/home/deploy') === -1);
    assert.ok(res.text.indexOf('at ') === -1 || res.text.indexOf('.js:') === -1, 'a stack trace leaked');
  } finally {
    routesStatus.handler = originalHandler;
    S.app.platform.status = original;
  }
  assert.equal((await viewer.get('/api/status')).status, 200);
  var sys = (await viewer.get('/api/system')).body.result;
  assert.ok(sys.events.some(function (e) { return e.kind === 'INTERNAL_ERROR'; }), 'the failure must be visible to the operator');
});

test('no response carries a password hash, a salt, a session id or another session\'s CSRF token', async function () {
  var secrets = [];
  h.users().forEach(function (u) { secrets.push(u.hash, u.salt); });
  secrets.push(owner.cookie().split('=')[1], operator.cookie().split('=')[1], operator.csrf(), owner.csrf());
  secrets.push(h.PASSWORDS.owner, h.PASSWORDS.operator, h.PASSWORDS.viewer);
  var paths = S.app.routes.filter(function (r) { return r.method === 'GET' && r.path.indexOf(':') === -1; }).map(function (r) { return r.path; });
  for (var i = 0; i < paths.length; i++) {
    var res = await viewer.get(paths[i]);
    secrets.forEach(function (s) {
      assert.ok(res.text.indexOf(s) === -1, paths[i] + ' leaked a secret value');
    });
  }
});

test('the system view does not expose filesystem paths, the users file or environment values', async function () {
  var text = (await viewer.get('/api/system')).text + (await viewer.get('/api/status')).text;
  assert.ok(text.indexOf(S.stateDir) === -1, 'the state directory path leaked');
  assert.ok(text.indexOf('/home/') === -1);
  assert.ok(text.indexOf('TCC_') === -1);
  assert.ok(!/users\.json/.test(text));
});

// ---------------------------------------------------------------------------
// throttling and rate limits
// ---------------------------------------------------------------------------

test('repeated failed sign-ins are throttled, and the throttle is audited', async function () {
  var A = await h.startApp({ webDir: webDir });
  var last;
  for (var i = 0; i < 9; i++) last = await A.client().login('operator', 'wrong-password-' + i);
  assert.equal(last.status, 429);
  assert.equal(last.body.error.code, 'THROTTLED');
  var good = await A.client().login('operator', h.PASSWORDS.operator);
  assert.equal(good.status, 429, 'the correct password must not get through a throttle either');
  var entry = A.app.audit.list({ action: 'auth.login', limit: 1 }).items[0];
  assert.equal(entry.code, 'THROTTLED');
  await A.close();
});

test('the API rate limiter answers 429 with Retry-After, separately for reads, writes and heavy jobs', async function () {
  var A = await h.startApp({ webDir: webDir, rateBuckets: {
    read: { limit: 5, windowMs: 60000 }, write: { limit: 2, windowMs: 60000 },
    heavy: { limit: 1, windowMs: 60000 }, login: { limit: 100, windowMs: 60000 }
  } });
  var o = await A.login('owner');
  var status = [];
  for (var i = 0; i < 7; i++) status.push((await o.get('/api/status')).status);
  assert.deepEqual(status.slice(0, 5), [200, 200, 200, 200, 200]);
  assert.equal(status[5], 429);
  var limited = await o.get('/api/status');
  assert.ok(parseInt(limited.headers['retry-after'], 10) >= 1);

  var w = [];
  for (var j = 0; j < 3; j++) w.push((await o.post('/api/config/trading', { enabled: false, reason: 'rate limit write bucket ' + j })).status);
  assert.deepEqual(w, [200, 200, 429], 'the write bucket is independent of the read bucket');

  var heavy1 = await o.post('/api/testing/run', { scope: 'category', category: 'nope' });
  var heavy2 = await o.post('/api/testing/run', { scope: 'category', category: 'nope' });
  assert.equal(heavy1.status, 400);
  assert.equal(heavy2.status, 429, 'the heavy bucket is the smallest');
  var entry = A.app.audit.list({ action: 'testing.run', limit: 1 }).items[0];
  assert.equal(entry.code, 'RATE_LIMITED');
  await A.close();
});

test('one user\'s rate limit does not consume another\'s', async function () {
  var A = await h.startApp({ webDir: webDir, rateBuckets: {
    read: { limit: 3, windowMs: 60000 }, write: { limit: 50, windowMs: 60000 },
    heavy: { limit: 5, windowMs: 60000 }, login: { limit: 100, windowMs: 60000 }
  } });
  var o = await A.login('owner');
  var v = await A.login('viewer');
  for (var i = 0; i < 4; i++) await o.get('/api/status');
  assert.equal((await o.get('/api/status')).status, 429);
  assert.equal((await v.get('/api/status')).status, 200);
  await A.close();
});

// ---------------------------------------------------------------------------
// the audit chain as seen through the API
// ---------------------------------------------------------------------------

test('the audit chain verifies over the API after everything this suite did', async function () {
  var v = (await viewer.get('/api/audit/verify')).body.result;
  assert.equal(v.ok, true);
  assert.ok(v.entries > 10);
  var list = (await viewer.get('/api/audit?outcome=REFUSED&limit=200')).body.result;
  assert.ok(list.total > 5, 'refusals must be on the record');
  var codes = {};
  list.items.forEach(function (e) { codes[e.code] = true; });
  ['UNAUTHENTICATED', 'FORBIDDEN', 'CSRF', 'CROSS_ORIGIN', 'VALIDATION_FAILED'].forEach(function (c) {
    assert.ok(codes[c], 'no audited refusal with code ' + c);
  });
});
