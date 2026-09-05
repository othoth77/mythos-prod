'use strict';
// MYTHOS WP — inboxes resource + receiver status endpoint (MYTHOS-COMMS-3, #205)
// Registry: the `inboxes` resource exists, refuses mythos-bridge by pattern,
// exposes no secret-shaped field, status is server-managed; the meta served
// to the browser carries no table/SQL names. HTTP (loopback): /api/comms/receiver
// requires a session and reports enabled/token_present/route + inbox rows
// without any secret. DB section optional (MYTHOS_WP_TEST_DB_URL).
var http = require('http');
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var WP = path.join(ROOT, 'projects/mythos-wp');
var passed = 0, failed = 0;
function ok(c, n) { if (c) passed++; else { failed++; console.error('FAIL: ' + n); } }
function finish(code) { console.log('mythos-wp-comms-inboxes: ' + passed + ' passed, ' + failed + ' failed'); process.exit(code !== undefined ? code : (failed ? 1 : 0)); }
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-inb-'));
process.env.MYTHOS_WP_USERS_FILE = path.join(tmp, 'users.json');
process.env.MYTHOS_WP_INSECURE_COOKIE = '1';
delete process.env.MYTHOS_WP_RECEIVER_ENABLED; delete process.env.MYTHOS_WP_WEBHOOK_TOKEN_FILE; delete process.env.MYTHOS_WP_COMMS_CONFIG;
var resources = require(path.join(WP, 'reference/resources'));
var validate = require(path.join(WP, 'reference/validate'));
var auth = require(path.join(WP, 'reference/auth'));
var r = resources.get('inboxes');
ok(!!r && r.table === 'wp_inboxes' && r.scope === 'wp', 'inboxes resource registered on wp_inboxes');
ok(r.permissions.write === 'owner' && r.permissions.read === 'operator', 'owner writes, operator reads');
var inst = r.fields.filter(function (f) { return f.name === 'instance'; })[0];
ok(inst && inst.createOnly && !new RegExp(inst.pattern).test('mythos-bridge') && new RegExp(inst.pattern).test('ssangyong-autos'), 'instance pattern refuses mythos-bridge, accepts ssangyong-autos');
ok(r.fields.filter(function (f) { return f.name === 'status'; })[0].readonly === true, 'status is server-managed');
ok(!r.fields.some(function (f) { return /token|secret|key|password/i.test(f.name); }), 'no secret-shaped field on the inbox resource');
var v = validate.validate(r.fields, { provider: 'evolution', instance: 'mythos-bridge', display_name: 'x' }, 'create');
ok(v && (v.ok === false || (Array.isArray(v.errors) && v.errors.length > 0) || (v.problems && Object.keys(v.problems).length > 0)), 'validator refuses mythos-bridge as instance (' + JSON.stringify(v).slice(0, 80) + ')');
var meta = resources.meta ? resources.meta() : null;
if (meta) { var m = JSON.stringify(meta); ok(m.indexOf('wp_inboxes') === -1, 'browser meta carries no table name'); }

// HTTP: session required, then non-secret status
var TEST_URL = process.env.MYTHOS_WP_TEST_DB_URL || null;
if (TEST_URL) { var u = new URL(TEST_URL); process.env.MYTHOS_WP_DB_HOST = u.hostname; process.env.MYTHOS_WP_DB_PORT = u.port || '5432'; process.env.MYTHOS_WP_DB_USER = decodeURIComponent(u.username); process.env.MYTHOS_WP_DB_PASSWORD = decodeURIComponent(u.password); process.env.MYTHOS_WP_DB_NAME = u.pathname.slice(1); }
fs.writeFileSync(process.env.MYTHOS_WP_USERS_FILE, JSON.stringify({ users: [{ username: 'op', role: 'operator', scrypt: auth.hashPassword('operator-password-1') }] }), { mode: 0o600 });
var server = require(path.join(WP, 'reference/server')).createServer();
var PORT = 0;
function req(method, p, body, cookie) {
  return new Promise(function (resolve, reject) {
    var data = body ? JSON.stringify(body) : null;
    var h = { 'Content-Type': 'application/json' }; if (data) h['Content-Length'] = Buffer.byteLength(data); if (cookie) h.Cookie = cookie;
    var rq = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: h, agent: false }, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j, cookie: (res.headers['set-cookie'] || [''])[0].split(';')[0] }); }); });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}
new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { PORT = server.address().port; resolve(); }); })
  .then(function () { return req('GET', '/api/comms/receiver'); })
  .then(function (x) { ok(x.status === 401, 'receiver status requires a session'); return req('POST', '/api/login', { username: 'op', password: 'operator-password-1' }); })
  .then(function (x) { ok(x.status === 200 && x.cookie, 'login'); return req('GET', '/api/comms/receiver', null, x.cookie); })
  .then(function (x) {
    ok(x.status === 200 && x.body.data && x.body.data.receiver, 'receiver status served');
    var d = x.body.data.receiver;
    ok(d.enabled === false && d.token_present === false && d.route === '/hooks/evolution', 'status: disabled, no token, route named');
    ok(JSON.stringify(x.body).indexOf('token_value') === -1 && !/[0-9a-f]{32,}/.test(JSON.stringify(x.body.data.receiver)), 'no secret value in the status');
    ok(Array.isArray(x.body.data.inboxes), 'inbox rows listed (' + x.body.data.inboxes.length + (TEST_URL ? ', db' : ', no db') + ')');
  })
  .then(function () { return new Promise(function (resolve) { server.close(resolve); }); })
  .then(function () { finish(); })
  .catch(function (e) { console.error('ERROR: ' + (e && e.stack || e)); failed++; finish(1); });
