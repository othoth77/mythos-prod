#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS WP — production smoke (read-only)
// projects/mythos-wp/tools/smoke.js [--base URL] [--accounts] [--project ID] [--json]
//
// Public part (always, no credentials): TLS + HSTS + security headers, login
// page and asset caching, /healthz, every sampled API answers 401 without a
// session, CSRF refusal, webhook refuses a missing / wrong token, static
// path traversal, http→https redirect, robots.
//
// Role part (--accounts; run as deploy with the service .env loaded, it needs
// MYTHOS_WP_DB_*): creates smoke-admin / smoke-manager / smoke-agent /
// smoke-viewer with a random password (never printed), grants the three
// lower roles ONE project (--project, default: the first active automotive
// or service project), then checks through the public URL: session roles,
// project isolation, the admin-only holding project, role gates (routing
// drops, health center, users, password reset of the owner), hidden fields
// (password hashes, agent instructions), phone digits never shown below
// admin, digit lookup refused below admin, CSRF, search isolation. Every
// session logs out and every smoke account is removed (`users.remove`,
// audited) even when a check fails.
//
// Nothing here writes business data: the only writes are the temporary
// accounts, their sessions and the audit rows those produce.
// Exit 0 = every check passed.
// =====================================================
var http = require('http');
var https = require('https');
var tls = require('tls');
var crypto = require('crypto');
var path = require('path');

var args = process.argv.slice(2);
function arg(name, dflt) { var i = args.indexOf(name); return i !== -1 && args[i + 1] ? args[i + 1] : dflt; }
var BASE = new URL(arg('--base', 'https://wp.mythosprod.xyz'));
var ACCOUNTS = args.indexOf('--accounts') !== -1;
var JSON_OUT = args.indexOf('--json') !== -1;
var results = [];
function check(name, pass, detail) { results.push({ name: name, pass: !!pass, detail: detail === undefined ? null : detail }); if (!JSON_OUT) process.stdout.write((pass ? 'PASS ' : 'FAIL ') + name + (detail !== undefined && !pass ? '  [' + detail + ']' : '') + '\n'); }

function request(method, p, o) {
  o = o || {};
  var u = new URL(p, o.base || BASE);
  var mod = u.protocol === 'https:' ? https : http;
  var body = o.body !== undefined ? (typeof o.body === 'string' ? o.body : JSON.stringify(o.body)) : null;
  var headers = Object.assign({ 'User-Agent': 'mythos-wp-smoke' }, o.headers || {});
  if (body !== null) { headers['Content-Type'] = headers['Content-Type'] || 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
  if (o.cookie) headers.Cookie = o.cookie;
  if (o.xrw !== false && method !== 'GET') headers['X-Requested-With'] = 'MythosWP';
  return new Promise(function (resolve) {
    var rq = mod.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: method, headers: headers, timeout: 15000, servername: u.hostname }, function (res) {
      var chunks = []; res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { var text = Buffer.concat(chunks).toString('utf8'); var j = null; try { j = JSON.parse(text); } catch (e) {} resolve({ status: res.statusCode, headers: res.headers, text: text, json: j, data: j && j.data !== undefined ? j.data : j, cookie: (res.headers['set-cookie'] || []).map(function (c) { return c.split(';')[0]; }).join('; ') }); });
    });
    rq.on('timeout', function () { rq.destroy(new Error('timeout')); });
    rq.on('error', function (e) { resolve({ status: 0, headers: {}, text: '', json: null, data: null, error: e.message }); });
    if (body !== null) rq.write(body); rq.end();
  });
}
function certDays() {
  return new Promise(function (resolve) {
    var s = tls.connect({ host: BASE.hostname, port: 443, servername: BASE.hostname, timeout: 10000 }, function () { var c = s.getPeerCertificate(); s.end(); resolve(c && c.valid_to ? Math.floor((new Date(c.valid_to) - Date.now()) / 86400000) : -1); });
    s.on('error', function () { resolve(-1); }); s.on('timeout', function () { s.destroy(); resolve(-1); });
  });
}
var DIGITS_RE = /(?<![0-9A-Za-z_-])[0-9]{8,}(?![0-9])/; // a phone-like run of digits (ids and ISO timestamps are shorter / punctuated)
function phoneLike(text) { var m = String(text || '').match(DIGITS_RE); return m ? '***' + m[0].slice(-4) : null; }

// ------------------------------------------------------------------ public
function publicChecks() {
  return request('GET', '/').then(function (r) {
    check('GET / redirects to sign-in when anonymous', r.status === 302 && /login/.test(r.headers.location || ''), r.status + ' ' + (r.headers.location || ''));
    return request('GET', r.headers.location || '/login');
  }).then(function (r) {
    var h = r.headers;
    check('login page 200', r.status === 200, r.status);
    check('CSP present, no unsafe-inline script', /script-src/.test(h['content-security-policy'] || '') && !/script-src[^;]*unsafe-inline/.test(h['content-security-policy'] || ''), h['content-security-policy']);
    check('framing refused (frame-ancestors / X-Frame-Options)', /frame-ancestors 'none'/.test(h['content-security-policy'] || '') || /deny|sameorigin/i.test(h['x-frame-options'] || ''));
    check('X-Content-Type-Options nosniff', /nosniff/i.test(h['x-content-type-options'] || ''));
    if (BASE.protocol === 'https:') check('HSTS on the public URL', /max-age=\d{6,}/.test(h['strict-transport-security'] || ''), h['strict-transport-security']);
    var src = (r.text.match(/<script src="([^"]+)"/) || [])[1] || '/js/login.js';
    return request('GET', src);
  }).then(function (r) {
    check('asset served with ETag + no-cache (no stale assets after a deploy)', r.status === 200 && !!r.headers.etag && /no-cache/.test(r.headers['cache-control'] || ''), r.status + ' ' + r.headers['cache-control']);
    return request('GET', '/healthz');
  }).then(function (r) {
    check('/healthz 200 {ok:true}', r.status === 200 && r.json && r.json.ok === true, r.status);
    var apis = ['/api/meta', '/api/session', '/api/dashboard', '/api/contacts', '/api/whatsapp/numbers', '/api/health', '/api/health/center', '/api/r/users', '/api/search?q=a', '/api/ai/agents', '/api/integrations', '/api/projects/unassigned/comms/conversations', '/api/contacts/360/21600000000'];
    return Promise.all(apis.map(function (p) { return request('GET', p).then(function (x) { return [p, x.status]; }); }));
  }).then(function (rows) {
    var bad = rows.filter(function (x) { return x[1] !== 401; });
    check('every sampled API answers 401 without a session (' + rows.length + ')', bad.length === 0, JSON.stringify(bad));
    return request('POST', '/api/login', { body: { username: 'smoke-nobody', password: 'wrong-password-123' } });
  }).then(function (r) {
    check('wrong credentials → 401, no stack trace', r.status === 401 && !/at [A-Za-z].*\.js:\d+/.test(r.text), r.status);
    return request('POST', '/api/login', { body: { username: 'x', password: 'y' }, xrw: false });
  }).then(function (r) {
    check('POST without the CSRF header refused (403)', r.status === 403, r.status);
    return request('POST', '/hooks/evolution', { body: { event: 'messages.upsert', instance: 'smoke', data: {} } });
  }).then(function (r) {
    check('webhook without token → 401', r.status === 401, r.status);
    return request('POST', '/hooks/evolution', { body: { event: 'messages.upsert', instance: 'smoke', data: {} }, headers: { 'x-mythos-webhook-token': crypto.randomBytes(24).toString('hex') } });
  }).then(function (r) {
    check('webhook with a wrong token → 401', r.status === 401, r.status);
    return Promise.all(['/js/..%2f..%2fserver.js', '/..%2f..%2f..%2fetc%2fpasswd', '/brand/..%2f..%2freference%2fserver.js'].map(function (p) { return request('GET', p); }));
  }).then(function (rs) {
    check('static path traversal returns no file', rs.every(function (r) { return r.status !== 200 || (!/require\(|root:x:0/.test(r.text)); }), rs.map(function (r) { return r.status; }).join(','));
    return request('GET', '/robots.txt');
  }).then(function (r) {
    check('robots.txt disallows indexing', r.status === 200 && /Disallow:\s*\//.test(r.text), r.status);
    if (BASE.protocol !== 'https:') return null;
    return request('GET', '/', { base: 'http://' + BASE.hostname }).then(function (x) { check('http → https redirect', (x.status === 301 || x.status === 308) && /^https:/.test(x.headers.location || ''), x.status); return certDays(); })
      .then(function (d) { check('TLS certificate valid ≥ 14 days (' + d + ' d)', d >= 14, d); });
  });
}

// ------------------------------------------------------------------ roles
function roleChecks() {
  var WP = path.resolve(__dirname, '..');
  var users = require(path.join(WP, 'reference/users'));
  var db = require(path.join(WP, 'reference/db'));
  var pool = db.wp();
  var pw = crypto.randomBytes(24).toString('base64url');
  var ROLES = ['admin', 'manager', 'agent', 'viewer'];
  var C = {}, project = arg('--project', null), allProjects = [];
  function as(role, method, p, o) { return request(method, p, Object.assign({ cookie: C[role] }, o || {})); }
  var chain = pool.query("SELECT id, kind, status FROM wp_projects ORDER BY id").then(function (r) {
    allProjects = r.rows.map(function (x) { return x.id; });
    if (!project) { var pick = r.rows.filter(function (x) { return x.status === 'active' && (x.kind === 'automotive' || x.kind === 'service'); })[0]; project = pick ? pick.id : null; }
    if (!project) throw new Error('no active project to grant');
    var c = Promise.resolve();
    ROLES.forEach(function (role) {
      c = c.then(function () { return users.upsert(pool, { username: 'smoke-' + role, role: role, password: pw, display_name: 'Smoke ' + role }, 'smoke'); })
        .then(function () { return role === 'admin' ? null : users.setProjects(pool, 'smoke-' + role, { add: [project] }, 'smoke'); });
    });
    return c;
  }).then(function () {
    var c = Promise.resolve();
    ROLES.forEach(function (role) { c = c.then(function () { return request('POST', '/api/login', { body: { username: 'smoke-' + role, password: pw } }).then(function (r) { C[role] = r.cookie; check('login smoke-' + role, r.status === 200 && !!r.cookie, r.status); }); }); });
    return c;
  }).then(function () {
    return Promise.all(ROLES.map(function (role) { return as(role, 'GET', '/api/session').then(function (r) { return [role, r.data && r.data.role]; }); }));
  }).then(function (rows) {
    check('sessions carry the right roles', rows.every(function (x) { return x[0] === x[1]; }), JSON.stringify(rows));
    return Promise.all(ROLES.map(function (role) { return as(role, 'GET', '/api/meta').then(function (r) { return [role, (r.data && r.data.projects || []).map(function (p) { return p.id; })]; }); }));
  }).then(function (rows) {
    rows.forEach(function (x) {
      if (x[0] === 'admin') check('admin sees every project incl. the holding one (' + x[1].length + ')', x[1].length === allProjects.length && x[1].indexOf('unassigned') !== -1 === (allProjects.indexOf('unassigned') !== -1), x[1].join(','));
      else check(x[0] + ' sees only the granted project (' + project + ')', x[1].length === 1 && x[1][0] === project, x[1].join(','));
    });
    var others = allProjects.filter(function (p) { return p !== project; });
    return Promise.all(['manager', 'agent', 'viewer'].map(function (role) { return Promise.all(others.map(function (p) { return as(role, 'GET', '/api/projects/' + p + '/comms/conversations').then(function (r) { return r.status; }); })).then(function (s) { return [role, s]; }); }));
  }).then(function (rows) {
    rows.forEach(function (x) { check(x[0] + ': every other project answers 404 (isolation)', x[1].every(function (s) { return s === 404; }), x[1].join(',')); });
    return as('admin', 'GET', '/api/projects/unassigned/comms/conversations');
  }).then(function (r) {
    if (allProjects.indexOf('unassigned') !== -1) check('admin reads the holding project', r.status === 200, r.status);
    return Promise.all([as('manager', 'GET', '/api/whatsapp/routing-drops'), as('admin', 'GET', '/api/whatsapp/routing-drops'), as('manager', 'GET', '/api/health/center'), as('agent', 'GET', '/api/health/center'), as('viewer', 'GET', '/api/health/center')]);
  }).then(function (r) {
    check('routing drops: manager 403, admin 200', r[0].status === 403 && r[1].status === 200, r[0].status + '/' + r[1].status);
    check('health center: manager 200, agent 403, viewer 403', r[2].status === 200 && r[3].status === 403 && r[4].status === 403, [r[2].status, r[3].status, r[4].status].join('/'));
    if (r[2].status === 200) {
      var hc = r[2].data || {};
      check('health center reports a status', typeof (hc.status || hc.overall || (hc.summary && 'ok')) === 'string', Object.keys(hc).join(','));
    }
    return Promise.all([as('admin', 'GET', '/api/r/users'), as('manager', 'GET', '/api/r/users'), as('manager', 'GET', '/api/ai/agents'), as('admin', 'GET', '/api/whatsapp/numbers'), as('manager', 'GET', '/api/whatsapp/numbers')]);
  }).then(function (r) {
    check('users list (admin) exposes no password hash', r[0].status === 200 && !/scrypt|\$s0\$|"hash"/i.test(r[0].text), r[0].status);
    check('users list refused to a manager', r[1].status === 403, r[1].status);
    var agents = (r[2].data && (r[2].data.items || r[2].data)) || [];
    check('agent instructions hidden from a manager', r[2].status === 200 && Array.isArray(agents) && agents.every(function (a) { return !a.system_prompt && !a.instructions; }), r[2].status);
    check('numbers: admin sees full digits (control)', r[3].status === 200 && !!phoneLike(r[3].text), r[3].status);
    check('numbers: no phone digits below admin', r[4].status === 200 && !phoneLike(r[4].text), phoneLike(r[4].text));
    var reads = ['/api/contacts?project=all', '/api/projects/' + project + '/comms/conversations', '/api/projects/' + project + '/comms/contacts', '/api/dashboard', '/api/search?q=21'];
    return Promise.all(['manager', 'agent', 'viewer'].map(function (role) { return Promise.all(reads.map(function (p) { return as(role, 'GET', p).then(function (x) { return x.status === 200 ? phoneLike(x.text) : 'HTTP' + x.status; }); })).then(function (leaks) { return [role, leaks]; }); }));
  }).then(function (rows) {
    rows.forEach(function (x) { check(x[0] + ': no phone digits in contacts / conversations / dashboard / search', x[1].every(function (l) { return l === null; }), JSON.stringify(x[1])); });
    return Promise.all([as('manager', 'GET', '/api/contacts/360/21600000000'), as('viewer', 'GET', '/api/contacts/360/21600000000')]);
  }).then(function (r) {
    check('phone-digit 360 lookup refused below admin', r[0].status === 404 && r[1].status === 404, r[0].status + '/' + r[1].status);
    return Promise.all([as('viewer', 'POST', '/api/projects/' + project + '/comms/conversations/999999999/notes', { body: { text: 'smoke' } }), as('agent', 'POST', '/api/projects/' + project + '/comms/conversations/999999999/auto-reply', { body: {} }), as('manager', 'POST', '/api/users/owner/password', { body: { password: '' } }), as('admin', 'POST', '/api/users/owner/password', { body: { password: '' } })]);
  }).then(function (r) {
    check('viewer cannot write (403)', r[0].status === 403, r[0].status);
    check('agent cannot trigger auto-reply (403)', r[1].status === 403, r[1].status);
    check('manager cannot reset passwords (403)', r[2].status === 403, r[2].status);
    check('admin cannot reset the owner password (403)', r[3].status === 403 || r[3].status === 404, r[3].status);
    return as('viewer', 'POST', '/api/logout', { body: {}, xrw: false });
  }).then(function (r) {
    check('logout without the CSRF header refused', r.status === 403, r.status);
  });
  return chain.then(function () { return cleanup(); }, function (e) { check('role checks ran to completion', false, e.message); return cleanup(); });
  function cleanup() {
    var c = Promise.resolve();
    ROLES.forEach(function (role) {
      c = c.then(function () { return C[role] ? request('POST', '/api/logout', { cookie: C[role], body: {} }) : null; }).then(function () { return users.remove(pool, 'smoke-' + role, 'smoke'); }).catch(function (e) { check('cleanup smoke-' + role, false, e.message); });
    });
    return c.then(function () { return pool.query("SELECT count(*)::int AS n FROM wp_users WHERE username LIKE 'smoke-%'"); }).then(function (r) { check('smoke accounts removed', r.rows[0].n === 0, r.rows[0].n); return db.closeAll(); });
  }
}

publicChecks().then(function () { return ACCOUNTS ? roleChecks() : null; }).then(function () {
  var failed = results.filter(function (r) { return !r.pass; });
  if (JSON_OUT) process.stdout.write(JSON.stringify({ base: BASE.origin, accounts: ACCOUNTS, passed: results.length - failed.length, failed: failed.length, results: results }, null, 2) + '\n');
  else process.stdout.write('\nsmoke ' + BASE.origin + ': ' + (results.length - failed.length) + '/' + results.length + ' passed\n');
  process.exit(failed.length ? 1 : 0);
}).catch(function (e) { process.stderr.write('smoke error: ' + e.message + '\n'); process.exit(2); });
