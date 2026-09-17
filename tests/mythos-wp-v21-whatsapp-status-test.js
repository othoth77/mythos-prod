'use strict';
// =====================================================
// MYTHOS WP V2.1 — WhatsApp connection status (tests/mythos-wp-v21-whatsapp-status-test.js)
//
// The incident this suite locks down: on 2026-09-17 22:07 UTC an Evolution probe TIMED OUT while the
// host was loaded. The health run wrote that failure into the DEVICE status of every number
// (status = 'error'), so the dashboard showed "WhatsApp 0 / 2" and "ERROR" on four project rows while
// the owner's WhatsApp session was in fact open. A project link created during that window kept
// status 'error' for ever, which also blocks outbound replies for that project.
//
// Rules proven here:
//   1. a probe that cannot reach the gateway NEVER changes wp_phone_numbers.status; it records
//      health_state = 'error' and the connection reads 'error' with the last known status kept;
//   2. a successful probe updates the status AND every project link of that number (no stale link);
//   3. connectionOf(): open → connected · closed with digits → disconnected · closed without digits
//      (never paired) → action_required · pairing → action_required · probe failure → error;
//   4. the dashboard and the project-numbers view carry that connection per project number, and the
//      dashboard counts connected numbers;
//   5. ONE NUMBER → MULTIPLE PROJECTS survives every status refresh (links are never dropped).
// Own rows only (prefix v21s-), fake Evolution on loopback, nothing external is called.
// =====================================================
var http = require('http');
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var WP = path.join(ROOT, 'projects/mythos-wp');
var TEST_URL = process.env.MYTHOS_WP_TEST_DB_URL || null;
var passed = 0, failed = 0;
function ok(c, n) { if (c) passed++; else { failed++; console.error('FAIL: ' + n); } }
function finish(code) { console.log('mythos-wp-v21-whatsapp-status: ' + passed + ' passed, ' + failed + ' failed'); process.exit(code !== undefined ? code : (failed ? 1 : 0)); }
if (!TEST_URL) { console.error('MYTHOS_WP_TEST_DB_URL not set'); finish(process.env.MYTHOS_WP_ALLOW_SKIP === '1' ? 0 : 3); }

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-v21s-'));
var EVO_KEY = 'v21s-evolution-key-ABCDEF0123456789';
var evoKeyFile = path.join(tmp, 'evolution.key'); fs.writeFileSync(evoKeyFile, EVO_KEY + '\n', { mode: 0o600 });
process.env.MYTHOS_WP_USERS_FILE = path.join(tmp, 'users.json');
process.env.MYTHOS_WP_INSECURE_COOKIE = '1';
process.env.MYTHOS_WP_EVOLUTION_API_KEY_FILE = evoKeyFile;
process.env.MYTHOS_WP_HEALTH_INTERVAL_MS = '0';
process.env.MYTHOS_WP_DB_CONNECT_TIMEOUT_MS = process.env.MYTHOS_WP_DB_CONNECT_TIMEOUT_MS || '20000';   // this host runs other heavy sessions
delete process.env.MYTHOS_WP_COMMS_CONFIG; delete process.env.MYTHOS_WP_RECEIVER_ENABLED;
var u = new URL(TEST_URL);
process.env.MYTHOS_WP_DB_HOST = u.hostname; process.env.MYTHOS_WP_DB_PORT = u.port || '5432';
process.env.MYTHOS_WP_DB_USER = decodeURIComponent(u.username); process.env.MYTHOS_WP_DB_PASSWORD = decodeURIComponent(u.password);
process.env.MYTHOS_WP_DB_NAME = u.pathname.slice(1);

var auth = require(path.join(WP, 'reference/auth'));
var migrate = require(path.join(WP, 'reference/migrate'));
var db = require(path.join(WP, 'reference/db'));
require(path.join(WP, 'reference/comms/receiver'));   // registers the evolution + meta_cloud providers
var numbers = require(path.join(WP, 'reference/comms/numbers'));
var health = require(path.join(WP, 'reference/health'));
var dashboard = require(path.join(WP, 'reference/dashboard'));
var projectsOps = require(path.join(WP, 'reference/projects'));
var store = require(path.join(WP, 'reference/projects-store'));
var pool = db.wp();
fs.writeFileSync(process.env.MYTHOS_WP_USERS_FILE, JSON.stringify({ users: [{ username: 'v21s-adm', role: 'admin', scrypt: auth.hashPassword('test-admin-pw-not-a-real-1') }] }), { mode: 0o600 });

// --- fake Evolution: `mode` decides what the gateway does on the next probe ------------------
var mode = 'open';                       // open | close | connecting | hang | 500
var evo = http.createServer(function (rq, rs) {
  if (mode === 'hang') return;           // never answers → the provider times out
  if (mode === '500') { rs.writeHead(500, { 'Content-Type': 'application/json' }); return rs.end('{"error":"boom"}'); }
  var state = mode === 'close' ? 'close' : mode === 'connecting' ? 'connecting' : 'open';
  rs.writeHead(200, { 'Content-Type': 'application/json' });
  rs.end(JSON.stringify({ instance: { instanceName: 'x', state: state } }));
});

var q = function (sql, p) { return pool.query(sql, p || []); };
function wipe() {
  return q("DELETE FROM wp_inboxes WHERE project_id LIKE 'v21s-%'")
    .then(function () { return q("DELETE FROM wp_audit_events WHERE project_id LIKE 'v21s-%'"); })
    .then(function () { return q("DELETE FROM wp_projects WHERE id LIKE 'v21s-%'"); })
    .then(function () { return q("DELETE FROM wp_health_checks WHERE component LIKE '%v21s-%'"); })
    .then(function () { return q("DELETE FROM wp_phone_numbers WHERE instance LIKE 'v21s-%'"); });
}

var ids = {};
migrate.up(pool)
  .then(wipe)
  .then(function () { return new Promise(function (res) { evo.listen(0, '127.0.0.1', res); }); })
  .then(function () {
    process.env.MYTHOS_WP_EVOLUTION_BASE_URL = 'http://127.0.0.1:' + evo.address().port;
    return q("INSERT INTO wp_projects (id, display_name, kind, status) VALUES ('v21s-a','V21S A','service','active'), ('v21s-b','V21S B','service','active')");
  })
  .then(function () { store.invalidate(); return q("INSERT INTO wp_phone_numbers (provider, instance, phone_ref, display_name, status, health_state) VALUES ('evolution','v21s-line','21600000777','V21S line','open','ok') RETURNING id"); })
  .then(function (r) {
    ids.num = r.rows[0].id;
    // ONE NUMBER → TWO PROJECTS (shared links, exactly as production)
    return numbers.link(pool, ids.num, { project_id: 'v21s-a', display_name: 'A', account_mode: 'shared' }, 'test')
      .then(function (ib) { ids.inboxA = ib.id; return numbers.link(pool, ids.num, { project_id: 'v21s-b', display_name: 'B', account_mode: 'shared' }, 'test'); })
      .then(function (ib) { ids.inboxB = ib.id; });
  })

  // ---- 3. the connection model ------------------------------------------------------------
  .then(function () {
    var c = numbers.connectionOf({ status: 'open', health_state: 'ok', phone_ref: '21600000777' });
    ok(c.state === 'connected' && c.label === 'Connected', 'connectionOf: open → connected');
    c = numbers.connectionOf({ status: 'closed', health_state: 'disconnected', phone_ref: '21600000777' });
    ok(c.state === 'disconnected' && /re-pair/i.test(c.detail), 'connectionOf: closed with digits → disconnected (was paired)');
    c = numbers.connectionOf({ status: 'closed', health_state: 'disconnected', phone_ref: null });
    ok(c.state === 'action_required' && /not paired yet/i.test(c.detail), 'connectionOf: closed without digits → action required (never paired)');
    c = numbers.connectionOf({ status: 'pairing', health_state: 'warning', phone_ref: null });
    ok(c.state === 'action_required' && /QR/i.test(c.detail), 'connectionOf: pairing → action required');
    c = numbers.connectionOf({ status: 'open', health_state: 'error', phone_ref: '21600000777' });
    ok(c.state === 'error' && /did not answer/i.test(c.detail) && /connected/i.test(c.detail), 'connectionOf: probe failure → error, last known status named');
    c = numbers.connectionOf({ status: 'unknown', health_state: 'unknown', phone_ref: null });
    ok(c.state === 'action_required', 'connectionOf: never checked → action required');
  })

  // ---- 2. a successful probe updates the number AND every link --------------------------
  .then(function () { mode = 'close'; return numbers.check(pool, ids.num); })
  .then(function (out) {
    ok(out.status === 'closed' && out.connection === 'disconnected', 'check: a reported close → closed / disconnected (' + out.status + '/' + out.connection + ')');
    return q('SELECT id, status FROM wp_inboxes WHERE id IN ($1,$2) ORDER BY id', [ids.inboxA, ids.inboxB]);
  })
  .then(function (r) { ok(r.rows.length === 2 && r.rows.every(function (x) { return x.status === 'closed'; }), 'check: both project links follow the number (no stale link)'); })
  .then(function () { mode = 'open'; return numbers.check(pool, ids.num); })
  .then(function (out) {
    ok(out.status === 'open' && out.connection === 'connected', 'check: reported open → open / connected');
    return q('SELECT status FROM wp_inboxes WHERE id IN ($1,$2)', [ids.inboxA, ids.inboxB]);
  })
  .then(function (r) { ok(r.rows.every(function (x) { return x.status === 'open'; }), 'check: links follow the number back to open'); })

  // ---- 1. THE INCIDENT: an unreachable gateway must not become a device status -----------
  .then(function () { mode = 'hang'; return numbers.check(pool, ids.num); })
  .then(function (out) {
    ok(out.status === 'open', 'check: gateway timeout KEEPS the last known device status (got ' + out.status + ')');
    ok(out.health_state === 'error' && out.connection === 'error', 'check: gateway timeout reports connection error');
    return q('SELECT status, health_state FROM wp_phone_numbers WHERE id = $1', [ids.num]);
  })
  .then(function (r) { ok(r.rows[0].status === 'open' && r.rows[0].health_state === 'error', 'check: DB keeps status open, health_state error (never status=error)'); return q('SELECT status FROM wp_inboxes WHERE id IN ($1,$2)', [ids.inboxA, ids.inboxB]); })
  .then(function (r) { ok(r.rows.every(function (x) { return x.status === 'open'; }), 'check: a failed probe never marks the project links broken (outbound stays possible)'); })
  .then(function () { mode = '500'; return numbers.check(pool, ids.num); })
  .then(function (out) { ok(out.status === 'open' && out.connection === 'error', 'check: HTTP 500 from the gateway behaves like a timeout'); })

  // the health run: same rule, through the scheduler's code path
  .then(function () { mode = 'hang'; return health.runAll(pool, { numberInstances: ['v21s-line'], integrationKeys: [] }); })
  .then(function (doc) {
    var c = doc.components.filter(function (x) { return x.component === 'number:v21s-line'; })[0];
    ok(c && c.status === 'error', 'health run: an unreachable gateway is an error component, not "disconnected"');
    ok(c && c.detail && c.detail.kept_status === 'open', 'health run: the component detail names the status it kept');
    return q('SELECT status, health_state FROM wp_phone_numbers WHERE id = $1', [ids.num]);
  })
  .then(function (r) { ok(r.rows[0].status === 'open' && r.rows[0].health_state === 'error', 'health run: device status survives an unreachable gateway'); })
  .then(function () { mode = 'close'; return health.runAll(pool, { numberInstances: ['v21s-line'], integrationKeys: [] }); })
  .then(function () { return q('SELECT status FROM wp_phone_numbers WHERE id = $1', [ids.num]); })
  .then(function (r) { ok(r.rows[0].status === 'closed', 'health run: a reported state does update the device status'); return q('SELECT status FROM wp_inboxes WHERE id IN ($1,$2)', [ids.inboxA, ids.inboxB]); })
  .then(function (r) { ok(r.rows.every(function (x) { return x.status === 'closed'; }), 'health run: links follow the number'); })

  // ---- 4. what the operator sees ---------------------------------------------------------
  .then(function () { mode = 'open'; return numbers.check(pool, ids.num); })
  .then(function () { return numbers.listNumbers(pool, { admin: true }); })
  .then(function (items) {
    var n = items.filter(function (x) { return x.instance === 'v21s-line'; })[0];
    ok(n && n.connection === 'connected' && n.connection_label === 'Connected' && typeof n.connection_detail === 'string', 'numbers list: carries connection + label + detail');
    ok(n && (n.projects || []).length === 2, 'numbers list: ONE NUMBER → TWO PROJECTS intact');
  })
  .then(function () { return store.all(true); })
  .then(function (rows) { return dashboard.build(pool, { projects: rows.filter(function (r) { return /^v21s-/.test(r.id); }), project: null }); })
  .then(function (doc) {
    var a = (doc.projects.activity || []).filter(function (x) { return x.id === 'v21s-a'; })[0];
    ok(a && a.whatsapp.length === 1 && a.whatsapp[0].connection === 'connected', 'dashboard: project row carries the connection state');
    ok(a && a.whatsapp[0].connection_detail && a.whatsapp[0].phone_masked === '***0777', 'dashboard: masked number + plain detail');
  })
  .then(function () { return projectsOps.numbersOf(pool, 'v21s-b'); })
  .then(function (rows) { ok(rows.length === 1 && rows[0].connection === 'connected' && rows[0].inbox_id === ids.inboxB, 'project numbers: connection + link id'); })

  // ---- 5. a never-paired number reads as ACTION REQUIRED, not ERROR ----------------------
  .then(function () { return q("INSERT INTO wp_phone_numbers (provider, instance, phone_ref, display_name, status, health_state) VALUES ('evolution','v21s-unpaired',NULL,'V21S unpaired','closed','disconnected') RETURNING id"); })
  .then(function (r) { ids.unpaired = r.rows[0].id; return numbers.listNumbers(pool, { admin: true }); })
  .then(function (items) {
    var n = items.filter(function (x) { return x.instance === 'v21s-unpaired'; })[0];
    ok(n && n.connection === 'action_required' && /scan the QR/i.test(n.connection_detail), 'never paired → Action required with the QR instruction (not ERROR)');
  })
  .then(function () { return wipe(); })
  .then(function () { evo.close(); return db.closeAll(); })
  .then(function () { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ } finish(); })
  .catch(function (e) { failed++; console.error('FAIL: uncaught ' + (e && e.stack || e)); try { evo.close(); } catch (x) { /* closed */ } db.closeAll().then(function () { finish(1); }, function () { finish(1); }); });
