'use strict';
// =====================================================
// MYTHOS WP V2 — WhatsApp layer (builder A) — tests/mythos-wp-v2-whatsapp-test.js
// Real HTTP server on loopback + real test DB (MYTHOS_WP_TEST_DB_URL). Nothing external is
// called: Evolution and the Meta Graph API are FAKE servers on 127.0.0.1. Own rows only
// (projects / instances / users prefixed v2wa-), cleaned at start and end in FK order.
//   accounts + numbers CRUD, masking, role gates (401/403)
//   sync against fake Evolution (fetchInstances + webhook/find), check (connectionState)
//   ONE instance linked to TWO projects: identity rule → p1, keyword → p2, default → p2,
//   sticky follows the open conversation, personal number refuses keyword/default (412) and
//   drops unknown senders, dedicated instance routes directly; routed_by recorded end-to-end
//   routing simulate; handoff ai_to_human / human_to_ai + history; templates CRUD / preview /
//   sync 412 / Meta sync with a fake Graph / test-send; meta_cloud provider unit checks;
//   meta-mcp descriptor (no network); contacts 360 across projects with role-based masking.
// =====================================================
var http = require('http');
var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var WP = path.join(ROOT, 'projects/mythos-wp');
var TEST_URL = process.env.MYTHOS_WP_TEST_DB_URL || null;
var passed = 0, failed = 0;
function ok(c, n) { if (c) passed++; else { failed++; console.error('FAIL: ' + n); } }
function finish(code) { console.log('mythos-wp-v2-whatsapp: ' + passed + ' passed, ' + failed + ' failed'); process.exit(code !== undefined ? code : (failed ? 1 : 0)); }
if (!TEST_URL) { console.error('MYTHOS_WP_TEST_DB_URL not set'); finish(process.env.MYTHOS_WP_ALLOW_SKIP === '1' ? 0 : 3); }
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-v2wa-'));
var TOKEN = 'v2wa-webhook-token-0123456789abcdef'; var tokenFile = path.join(tmp, 'webhook.token'); fs.writeFileSync(tokenFile, TOKEN + '\n', { mode: 0o600 });
var EVO_KEY = 'v2wa-evolution-key-ABCDEF0123456789'; var evoKeyFile = path.join(tmp, 'evolution.key'); fs.writeFileSync(evoKeyFile, EVO_KEY + '\n', { mode: 0o600 });
var META_TOKEN = 'v2wa-meta-access-token-0123456789ABCDEF'; var META_SECRET = 'v2wa-app-secret-0123456789'; var META_VERIFY = 'v2wa-verify-token-9876';
var metaTokenFile = path.join(tmp, 'meta.token'), metaSecretFile = path.join(tmp, 'meta.secret'), metaVerifyFile = path.join(tmp, 'meta.verify');
fs.writeFileSync(metaTokenFile, META_TOKEN + '\n', { mode: 0o600 }); fs.writeFileSync(metaSecretFile, META_SECRET + '\n', { mode: 0o600 }); fs.writeFileSync(metaVerifyFile, META_VERIFY + '\n', { mode: 0o600 });
process.env.MYTHOS_WP_USERS_FILE = path.join(tmp, 'users.json'); process.env.MYTHOS_WP_INSECURE_COOKIE = '1';
process.env.MYTHOS_WP_WEBHOOK_TOKEN_FILE = tokenFile; process.env.MYTHOS_WP_RECEIVER_ENABLED = '1'; process.env.MYTHOS_WP_CATALOG_TEST = TEST_URL;
process.env.MYTHOS_WP_EVOLUTION_API_KEY_FILE = evoKeyFile;
delete process.env.MYTHOS_WP_COMMS_CONFIG; delete process.env.MYTHOS_WP_META_ACCESS_TOKEN_FILE; delete process.env.MYTHOS_WP_META_APP_SECRET_FILE; delete process.env.MYTHOS_WP_META_VERIFY_TOKEN_FILE; delete process.env.MYTHOS_WP_META_GRAPH_BASE; delete process.env.MYTHOS_WP_RECEIVER_URL; delete process.env.MYTHOS_WP_PORT;
var u = new URL(TEST_URL); process.env.MYTHOS_WP_DB_HOST = u.hostname; process.env.MYTHOS_WP_DB_PORT = u.port || '5432'; process.env.MYTHOS_WP_DB_USER = decodeURIComponent(u.username); process.env.MYTHOS_WP_DB_PASSWORD = decodeURIComponent(u.password); process.env.MYTHOS_WP_DB_NAME = u.pathname.slice(1);
var auth = require(path.join(WP, 'reference/auth'));
var migrate = require(path.join(WP, 'reference/migrate'));
var db = require(path.join(WP, 'reference/db'));
var receiver = require(path.join(WP, 'reference/comms/receiver'));
var routing = require(path.join(WP, 'reference/comms/routing'));
var meta = require(path.join(WP, 'reference/comms/providers/meta_cloud'));
var metaMcp = require(path.join(WP, 'reference/comms/meta-mcp'));
var pool = db.wp();
fs.writeFileSync(process.env.MYTHOS_WP_USERS_FILE, JSON.stringify({ users: [{ username: 'v2wa-own', role: 'owner', scrypt: auth.hashPassword('owner-password-1') }, { username: 'v2wa-adm', role: 'admin', scrypt: auth.hashPassword('admin-password-1') }, { username: 'v2wa-agt', role: 'agent', scrypt: auth.hashPassword('agent-password-1') }] }), { mode: 0o600 });
process.stdout.write = (function (orig) { return function (s) { if (typeof s === 'string' && (s.indexOf('"receiver"') !== -1 || s.indexOf('"request_id"') !== -1)) return true; return orig.apply(process.stdout, arguments); }; })(process.stdout.write.bind(process.stdout));
var server = require(path.join(WP, 'reference/server')).createServer();
var PORT = 0, COOKIE = {};
function req(method, p, body, who, rawHeaders) {
  return new Promise(function (resolve, reject) {
    var data = body !== undefined ? JSON.stringify(body) : null;
    var h = Object.assign({ 'Content-Type': 'application/json', 'X-Requested-With': 'MythosWP' }, rawHeaders || {}); if (data) h['Content-Length'] = Buffer.byteLength(data); if (who && COOKIE[who]) h.Cookie = COOKIE[who];
    var rq = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: h, agent: false }, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j, data: j && j.data, text: b, headers: res.headers, cookie: (res.headers['set-cookie'] || [''])[0].split(';')[0] }); }); });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}
function hook(payload, o) {
  o = o || {};
  var data = typeof payload === 'string' ? payload : JSON.stringify(payload); var h = Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, o.headers || {}); if (!o.noToken) h[receiver.TOKEN_HEADER] = TOKEN;
  return new Promise(function (resolve, reject) { var rq = http.request({ host: '127.0.0.1', port: PORT, path: o.path || '/hooks/evolution', method: o.method || 'POST', headers: h, agent: false }, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j, text: b, headers: res.headers }); }); }); rq.on('error', reject); if (o.method === 'GET') rq.end(); else rq.end(data); });
}
function q(sql, p) { return pool.query(sql, p || []); }
var P1 = 'v2wa-p1', P2 = 'v2wa-p2';
var SHARED = 'v2wa-shared', PERSONAL = 'v2wa-personal', DED = 'v2wa-ded';
var SHARED_PHONE = '21655550001', PERSONAL_PHONE = '21698000999', DED_PHONE = '21655550003';
var CUST_A = '21655700001', CUST_B = '21655700002', CUST_C = '21655700003', CUST_X = '21655700009';
var WABA = '100200300400';
var PHONE_ID = '109876543210';
function msg(id, from, text, inst, o) { o = o || {}; return { event: 'messages.upsert', instance: inst, sender: (o.owner || SHARED_PHONE) + '@s.whatsapp.net', data: { key: { remoteJid: from + '@s.whatsapp.net', fromMe: false, id: id }, pushName: o.name || 'Client ' + from.slice(-2), message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) } }; }
// ---------------------------------------------------------------- fake Evolution
var evo = { calls: [], mutations: 0, webhooks: { 'v2wa-shared': { enabled: true, url: 'http://127.0.0.1:8170/hooks/evolution' }, 'v2wa-personal': { enabled: true, url: 'http://10.0.0.5:9999/hooks/evolution?token=SHOULD-NEVER-BE-STORED' } }, state: { 'v2wa-ded': 'open' }, sent: [] };
var fakeEvo = http.createServer(function (rq, rs) {
  var b = ''; rq.on('data', function (c) { b += c; });
  rq.on('end', function () {
    evo.calls.push(rq.method + ' ' + rq.url);
    if (rq.method !== 'GET') { if (/\/message\/sendText\//.test(rq.url)) { evo.sent.push({ url: rq.url, body: JSON.parse(b), key: rq.headers.apikey }); rs.writeHead(201, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify({ key: { id: 'EVO-' + evo.sent.length } })); } evo.mutations++; rs.writeHead(400); return rs.end('{}'); }
    if (rq.headers.apikey !== EVO_KEY) { rs.writeHead(401, { 'Content-Type': 'application/json' }); return rs.end('{"status":401}'); }
    var m;
    if (rq.url === '/instance/fetchInstances') { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify([{ id: 'x1', name: SHARED, connectionStatus: 'open', ownerJid: SHARED_PHONE + '@s.whatsapp.net', profileName: 'Shared Business' }, { id: 'x2', name: PERSONAL, connectionStatus: 'open', ownerJid: PERSONAL_PHONE + '@s.whatsapp.net', profileName: 'Owner personal' }, { instance: { instanceName: DED, status: 'close', owner: DED_PHONE + '@s.whatsapp.net' } }, { name: 'bad name with spaces', connectionStatus: 'open' }])); }
    if ((m = /^\/webhook\/find\/([^/?]+)$/.exec(rq.url))) { var w = evo.webhooks[decodeURIComponent(m[1])]; if (!w) { rs.writeHead(404, { 'Content-Type': 'application/json' }); return rs.end('{"status":404,"error":"Not Found"}'); } rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify(w)); }
    if ((m = /^\/instance\/connectionState\/([^/?]+)$/.exec(rq.url))) { rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(JSON.stringify({ instance: { instanceName: decodeURIComponent(m[1]), state: evo.state[decodeURIComponent(m[1])] || 'close' } })); }
    rs.writeHead(404); rs.end('{}');
  });
});
// ---------------------------------------------------------------- fake Meta Graph
var graph = { templates: [], sent: [], calls: [], auth: [] };
var fakeGraph = http.createServer(function (rq, rs) {
  var b = ''; rq.on('data', function (c) { b += c; });
  rq.on('end', function () {
    graph.calls.push(rq.method + ' ' + rq.url); graph.auth.push(rq.headers.authorization || null);
    var send = function (code, obj) { rs.writeHead(code, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(obj)); };
    if (rq.headers.authorization !== 'Bearer ' + META_TOKEN) return send(401, { error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } });
    var uu = new URL('http://x' + rq.url); var m;
    if ((m = /^\/v21\.0\/(\d+)\/message_templates$/.exec(uu.pathname))) {
      if (rq.method === 'GET') { var name = uu.searchParams.get('name'); return send(200, { data: graph.templates.filter(function (t) { return !name || t.name === name; }) }); }
      if (rq.method === 'POST') { var body = JSON.parse(b); var id = String(900000 + graph.templates.length + 1); graph.templates.push({ id: id, name: body.name, language: body.language, category: body.category, status: 'PENDING', components: body.components }); return send(200, { id: id, status: 'PENDING', category: body.category }); }
      if (rq.method === 'DELETE') { graph.templates = graph.templates.filter(function (t) { return t.name !== uu.searchParams.get('name'); }); return send(200, { success: true }); }
    }
    if ((m = /^\/v21\.0\/(\d+)\/messages$/.exec(uu.pathname)) && rq.method === 'POST') { graph.sent.push({ phone_number_id: m[1], body: JSON.parse(b) }); return send(200, { messaging_product: 'whatsapp', contacts: [{ input: '216', wa_id: '216' }], messages: [{ id: 'wamid.TEST' + graph.sent.length }] }); }
    if ((m = /^\/v21\.0\/(\d+)$/.exec(uu.pathname)) && rq.method === 'GET') return send(200, { id: m[1], display_phone_number: '+216 55 555 0007', verified_name: 'MYTHOS Test', quality_rating: 'GREEN' });
    send(404, { error: { message: 'Unsupported get request', type: 'GraphMethodException', code: 100 } });
  });
});
function listen(srv) { return new Promise(function (resolve) { srv.listen(0, '127.0.0.1', function () { resolve(srv.address().port); }); }); }
function cleanup() {
  var mine = [P1, P2];
  var steps = [
    ['UPDATE wp_messages SET ai_run_id = NULL WHERE project_id = ANY($1)', [mine]],
    ['DELETE FROM wp_ai_suggestions WHERE conversation_id IN (SELECT id FROM wp_conversations WHERE project_id = ANY($1))', [mine]],
    ['DELETE FROM wp_ai_runs WHERE project_id = ANY($1)', [mine]],
    ['DELETE FROM wp_message_attachments WHERE message_id IN (SELECT id FROM wp_messages WHERE project_id = ANY($1))', [mine]],
    ['DELETE FROM wp_conversation_events WHERE project_id = ANY($1)', [mine]],
    ['DELETE FROM wp_inbound_events WHERE instance LIKE $2 OR message_id IN (SELECT id FROM wp_messages WHERE project_id = ANY($1))', [mine, 'v2wa-%']],
    ['DELETE FROM wp_messages WHERE project_id = ANY($1)', [mine]],
    ['DELETE FROM wp_handoffs WHERE project_id = ANY($1)', [mine]],
    ['DELETE FROM wp_conversation_tags WHERE conversation_id IN (SELECT id FROM wp_conversations WHERE project_id = ANY($1))', [mine]],
    ['DELETE FROM wp_conversations WHERE project_id = ANY($1)', [mine]],
    ['DELETE FROM wp_contact_identities WHERE project_id = ANY($1)', [mine]],
    ['DELETE FROM wp_contact_tags WHERE contact_id IN (SELECT id FROM wp_contacts WHERE project_id = ANY($1))', [mine]],
    ['DELETE FROM wp_contacts WHERE project_id = ANY($1)', [mine]],
    ['DELETE FROM wp_tags WHERE project_id = ANY($1)', [mine]],
    ['DELETE FROM wp_notes WHERE project_id = ANY($1)', [mine]],
    ['DELETE FROM wp_inbox_members WHERE inbox_id IN (SELECT id FROM wp_inboxes WHERE project_id = ANY($1))', [mine]],
    ['DELETE FROM wp_inbox_routes WHERE project_id = ANY($1) OR instance LIKE $2', [mine, 'v2wa-%']],
    ["DELETE FROM wp_templates WHERE project_id = ANY($1) OR name LIKE 'v2wa_%'", [mine]],
    ['DELETE FROM wp_inbound_events WHERE instance LIKE $1', ['v2wa-%']],
    ['DELETE FROM wp_routing_drops WHERE instance LIKE $1', ['v2wa-%']],
    ['DELETE FROM wp_inboxes WHERE project_id = ANY($1) OR instance LIKE $2', [mine, 'v2wa-%']],
    ['DELETE FROM wp_phone_numbers WHERE instance LIKE $1', ['v2wa-%']],
    ["DELETE FROM wp_wa_accounts WHERE display_name LIKE 'v2wa-%'", []],
    ["DELETE FROM wp_health_checks WHERE component LIKE 'number:v2wa-%'", []],
    ["DELETE FROM wp_audit_events WHERE project_id = ANY($1) OR actor LIKE 'v2wa-%'", [mine]],
    ['DELETE FROM wp_reserved_accounts WHERE account_ref = $1', [PERSONAL_PHONE]],
    ['DELETE FROM wp_projects WHERE id = ANY($1)', [mine]]
  ];
  var chain = Promise.resolve(); steps.forEach(function (s) { chain = chain.then(function () { return q(s[0], s[1]); }); }); return chain;
}
var ids = {}, graphPort;
migrate.up(pool).then(cleanup)
  .then(function () { return listen(fakeEvo); }).then(function (p) { process.env.MYTHOS_WP_EVOLUTION_BASE_URL = 'http://127.0.0.1:' + p; return listen(fakeGraph); }).then(function (p) { graphPort = p; return listen(server); }).then(function (p) { PORT = p; })
  .then(function () { return req('POST', '/api/login', { username: 'v2wa-own', password: 'owner-password-1' }); }).then(function (x) { COOKIE.own = x.cookie; return req('POST', '/api/login', { username: 'v2wa-adm', password: 'admin-password-1' }); }).then(function (x) { COOKIE.adm = x.cookie; ok(x.status === 200 && x.data.role === 'admin', 'login: admin user from the users file'); return req('POST', '/api/login', { username: 'v2wa-agt', password: 'agent-password-1' }); }).then(function (x) { COOKIE.agt = x.cookie; ok(x.status === 200 && x.data.role === 'agent', 'login: agent user'); })
  .then(function () { return q("INSERT INTO wp_projects (id, display_name, kind, catalog_dsn_env) VALUES ($1,'V2WA Project One','service','MYTHOS_WP_CATALOG_TEST'), ($2,'V2WA Project Two','service','MYTHOS_WP_CATALOG_TEST')", [P1, P2]); })
  .then(function () { return q("INSERT INTO wp_reserved_accounts (account_ref, reason) VALUES ($1, 'v2wa personal/notification account') ON CONFLICT DO NOTHING", [PERSONAL_PHONE]); })
  // ---------- auth gates
  .then(function () { return req('GET', '/api/whatsapp/numbers'); })
  .then(function (x) { ok(x.status === 401, 'gate: unauthenticated → 401'); return req('POST', '/api/whatsapp/numbers', { instance: 'v2wa-x', display_name: 'x' }, 'agt'); })
  .then(function (x) { ok(x.status === 403, 'gate: agent cannot create a number (403)'); return req('POST', '/api/whatsapp/numbers/sync', {}, 'agt'); })
  .then(function (x) { ok(x.status === 403, 'gate: agent cannot sync (403)'); return req('GET', '/api/whatsapp/routing-drops', undefined, 'agt'); })
  .then(function (x) { ok(x.status === 403, 'gate: routing drops are admin-only (403)'); return req('GET', '/api/whatsapp/routing-drops', undefined, 'adm'); })
  .then(function (x) { ok(x.status === 200 && Array.isArray(x.data.items), 'gate: admin reads routing drops'); })
  // ---------- accounts
  .then(function () { return req('POST', '/api/whatsapp/accounts', { provider: 'evolution', display_name: 'v2wa-evo-account', external_ref: 'evolution:v2wa-host' }, 'adm'); })
  .then(function (x) { ok(x.status === 201 && x.data.id, 'accounts: created (201)'); ids.acc = x.data.id; return req('POST', '/api/whatsapp/accounts', { provider: 'evolution', display_name: 'v2wa-dup', external_ref: 'evolution:v2wa-host' }, 'adm'); })
  .then(function (x) { ok(x.status === 409, 'accounts: duplicate external_ref → 409'); return req('PATCH', '/api/whatsapp/accounts/' + ids.acc, { business_name: 'V2WA SARL' }, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.business_name === 'V2WA SARL', 'accounts: patched'); return req('GET', '/api/whatsapp/accounts', undefined, 'agt'); })
  .then(function (x) { ok(x.status === 200 && x.data.items.some(function (a) { return a.id === ids.acc; }), 'accounts: listed for any role'); return req('DELETE', '/api/whatsapp/accounts/' + ids.acc, undefined, 'adm'); })
  .then(function (x) { ok(x.status === 403, 'accounts: delete is owner-only (403 for admin)'); })
  // ---------- numbers CRUD + masking
  .then(function () { return req('POST', '/api/whatsapp/numbers', { provider: 'evolution', instance: 'v2wa-manual', phone_ref: '21655551234', display_name: 'Manual number', account_id: ids.acc }, 'adm'); })
  .then(function (x) { ok(x.status === 201 && x.data.phone_masked === '***1234' && x.data.phone_ref === '21655551234' && x.data.account && x.data.account.id === ids.acc, 'numbers: created with masking + phone_ref for admin (' + x.status + ')'); ids.manual = x.data.id; return req('POST', '/api/whatsapp/numbers', { instance: 'v2wa-manual', display_name: 'dup' }, 'adm'); })
  .then(function (x) { ok(x.status === 409, 'numbers: duplicate instance → 409'); return req('POST', '/api/whatsapp/numbers', { instance: 'v2wa-bad', phone_ref: 'abc', display_name: 'x' }, 'adm'); })
  .then(function (x) { ok(x.status === 400, 'numbers: phone_ref must be digits (400)'); return req('GET', '/api/whatsapp/numbers', undefined, 'agt'); })
  .then(function (x) { var n = x.data.items.filter(function (i) { return i.id === ids.manual; })[0]; ok(x.status === 200 && n && n.phone_masked === '***1234' && !('phone_ref' in n) && JSON.stringify(x.data).indexOf('21655551234') === -1, 'numbers: agent sees the mask only, never phone_ref'); return req('PATCH', '/api/whatsapp/numbers/' + ids.manual, { display_name: 'Manual renamed', is_personal: true }, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.display_name === "Manual renamed" && x.data.is_personal === true, "numbers: patched"); return req('DELETE', '/api/whatsapp/numbers/' + ids.manual, undefined, 'adm'); })
  .then(function (x) { ok(x.status === 403, 'numbers: delete is owner-only'); return req('DELETE', '/api/whatsapp/numbers/' + ids.manual, undefined, 'own'); })
  .then(function (x) { ok(x.status === 200 && x.data.deleted === true, 'numbers: owner deletes an unlinked number'); })
  // ---------- sync against the fake Evolution
  .then(function () { return req('POST', '/api/whatsapp/numbers/sync', {}, 'adm'); })
  .then(function (x) {
    ok(x.status === 200 && x.data.discovered === 3 && x.data.created === 3, 'sync: 3 instances discovered and created, malformed entry skipped (' + JSON.stringify(x.data && { d: x.data.discovered, c: x.data.created, u: x.data.updated }) + ')');
    var by = {}; (x.data.items || []).forEach(function (i) { by[i.instance] = i; });
    ids.shared = by[SHARED] && by[SHARED].id; ids.personal = by[PERSONAL] && by[PERSONAL].id; ids.ded = by[DED] && by[DED].id;
    ok(by[SHARED] && by[SHARED].status === 'open' && by[SHARED].phone_masked === '***0001' && by[SHARED].phone_ref === SHARED_PHONE && by[SHARED].is_personal === false && by[SHARED].display_name === 'Shared Business', 'sync: shared instance open, phone from ownerJid, profile name');
    ok(by[SHARED] && by[SHARED].webhook_state === 'ok', 'sync: webhook pointing at the receiver → ok (' + (by[SHARED] && by[SHARED].webhook_state) + ')');
    ok(by[PERSONAL] && by[PERSONAL].is_personal === true, 'sync: reserved account digits → is_personal');
    ok(by[PERSONAL] && by[PERSONAL].webhook_state === 'mismatch' && String(by[PERSONAL].webhook_detail).indexOf('SHOULD-NEVER') === -1 && String(by[PERSONAL].webhook_detail).indexOf('token') === -1, 'sync: foreign webhook → mismatch, query string never stored');
    ok(by[DED] && by[DED].status === 'closed' && by[DED].webhook_state === 'missing' && by[DED].health_state === 'disconnected', 'sync: v1-shaped closed instance → closed / webhook missing');
    ok(evo.mutations === 0 && !evo.calls.some(function (c) { return /^(POST|PUT|DELETE|PATCH)/.test(c) && !/sendText/.test(c); }), 'sync: never creates an instance nor changes a webhook (GET only)');
    return req('POST', '/api/whatsapp/numbers/sync', {}, 'adm');
  })
  .then(function (x) { ok(x.status === 200 && x.data.created === 0 && x.data.updated === 3, 'sync: idempotent (second run updates, creates nothing)'); return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE actor = 'v2wa-adm' AND action = 'sync' AND resource = 'phone_numbers'"); })
  .then(function (r) { ok(r.rows[0].n === 2, 'sync: audited'); return req('POST', '/api/whatsapp/numbers/' + ids.ded + '/check', {}, 'agt'); })
  .then(function (x) { ok(x.status === 403, 'check: manager+ only (agent 403)'); return req('POST', '/api/whatsapp/numbers/' + ids.ded + '/check', {}, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.status === 'open' && x.data.health_state === 'ok', 'check: provider.health (connectionState open) → status open / health ok (' + JSON.stringify(x.data) + ')'); })
  // ---------- project links
  .then(function () { return req('POST', '/api/whatsapp/numbers/' + ids.shared + '/projects', { project_id: P1, account_mode: 'dedicated' }, 'agt'); })
  .then(function (x) { ok(x.status === 403, 'link: admin only (agent 403)'); return req('POST', '/api/whatsapp/numbers/' + ids.shared + '/projects', { project_id: P1, account_mode: 'dedicated' }, 'adm'); })
  .then(function (x) { ok(x.status === 201 && x.data.inbox && x.data.inbox.account_mode === 'dedicated', 'link: dedicated link created (201)'); ids.tmpInbox = x.data.inbox.id; return req('POST', '/api/whatsapp/numbers/' + ids.shared + '/projects', { project_id: P2, account_mode: 'shared' }, 'adm'); })
  .then(function (x) { ok(x.status === 409, 'link: cannot share a number that has a dedicated link (409)'); return req('POST', '/api/whatsapp/numbers/' + ids.shared + '/projects', { project_id: P2, account_mode: 'dedicated' }, 'adm'); })
  .then(function (x) { ok(x.status === 409, 'link: a dedicated number accepts a single link (409)'); return req('DELETE', '/api/whatsapp/numbers/' + ids.shared + '/projects/' + ids.tmpInbox, undefined, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.unlinked === true, 'unlink: dedicated link removed'); return req('POST', '/api/whatsapp/numbers/' + ids.shared + '/projects', { project_id: P1, account_mode: 'shared', display_name: 'One on shared' }, 'adm'); })
  .then(function (x) { ok(x.status === 201 && x.data.inbox.account_mode === 'shared' && x.data.inbox.status === 'open', 'link: shared link → project 1 (201, inbox open)'); ids.ib1 = x.data.inbox.id; return req('POST', '/api/whatsapp/numbers/' + ids.shared + '/projects', { project_id: P2, account_mode: 'shared', display_name: 'Two on shared' }, 'adm'); })
  .then(function (x) { ok(x.status === 201 && x.data.inbox.account_mode === "shared", "link: SAME instance linked to project 2 (201)"); ids.ib2 = x.data.inbox.id; return req('POST', '/api/whatsapp/numbers/' + ids.shared + '/projects', { project_id: P2, account_mode: 'shared' }, 'adm'); })
  .then(function (x) { ok(x.status === 409, 'link: same project twice → 409'); return req('POST', '/api/whatsapp/numbers/' + ids.personal + '/projects', { project_id: P1, account_mode: 'shared' }, 'adm'); })
  .then(function (x) { ok(x.status === 412, 'link: personal number requires the explicit allow_personal_account opt-in (412)'); return req('POST', '/api/whatsapp/numbers/' + ids.personal + '/projects', { project_id: P1, account_mode: 'shared', allow_personal_account: true }, 'adm'); })
  .then(function (x) { ok(x.status === 201 && x.data.inbox.account_mode === 'shared', 'link: personal number shared with the explicit opt-in (201)'); ids.ibP = x.data.inbox.id; return q("SELECT next FROM wp_audit_events WHERE actor = 'v2wa-adm' AND action = 'link' AND record_id = $1 ORDER BY id DESC LIMIT 1", [String(ids.personal)]); })
  .then(function (r) { ok(r.rows[0] && r.rows[0].next.allow_personal_account === true, 'link: opt-in audited'); return req('POST', '/api/whatsapp/numbers/' + ids.ded + '/projects', { project_id: P1, account_mode: 'dedicated' }, 'adm'); })
  .then(function (x) { ok(x.status === 201 && x.data.inbox.account_mode === 'dedicated' && x.data.inbox.status === 'open', 'link: dedicated instance → project 1'); ids.ibD = x.data.inbox.id; return req('GET', '/api/whatsapp/numbers', undefined, 'adm'); })
  .then(function (x) { var s = x.data.items.filter(function (i) { return i.id === ids.shared; })[0]; ok(s && s.projects.length === 2 && s.projects.map(function (p) { return p.project_id; }).sort().join(',') === P1 + ',' + P2 && s.projects.every(function (p) { return p.account_mode === 'shared' && p.inbox_id; }), 'numbers: listing shows both project links of the shared number'); return req('DELETE', '/api/whatsapp/numbers/' + ids.shared, undefined, 'own'); })
  .then(function (x) { ok(x.status === 409, 'numbers: delete refused while inboxes exist (409)'); })
  // inbox switches
  .then(function () { return req('PATCH', '/api/projects/' + P1 + '/inboxes/' + ids.ib1, { inbound_enabled: true, outbound_enabled: true, ai_mode: 'suggest', settings: { allow_personal_account: false, note: 'x' } }, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.inbound_enabled === true && x.data.outbound_enabled === true && x.data.ai_mode === 'suggest' && x.data.settings.note === 'x' && x.data.settings.allow_personal_account === true, 'inbox: switches patched; the sharing opt-in cannot be toggled off via PATCH'); return req('PATCH', '/api/projects/' + P2 + '/inboxes/' + ids.ib1, { inbound_enabled: true }, 'adm'); })
  .then(function (x) { ok(x.status === 404, 'inbox: project isolation (P2 cannot patch P1 inbox)'); return req('PATCH', '/api/projects/' + P2 + '/inboxes/' + ids.ib2, { inbound_enabled: true, outbound_enabled: true }, 'adm'); })
  .then(function (x) { ok(x.status === 200, 'inbox: P2 shared inbox enabled'); return req('PATCH', '/api/projects/' + P1 + '/inboxes/' + ids.ibP, { inbound_enabled: true }, 'adm'); })
  .then(function (x) { ok(x.status === 200, 'inbox: personal inbox enabled'); return req('PATCH', '/api/projects/' + P1 + '/inboxes/' + ids.ibD, { inbound_enabled: true, ai_mode: 'wrong' }, 'adm'); })
  .then(function (x) { ok(x.status === 400, 'inbox: ai_mode validated'); return req('PATCH', '/api/projects/' + P1 + '/inboxes/' + ids.ibD, { inbound_enabled: true }, 'adm'); })
  .then(function (x) { ok(x.status === 200, 'inbox: dedicated inbox enabled'); return q("SELECT next FROM wp_audit_events WHERE actor = 'v2wa-adm' AND resource = 'inboxes' AND record_id = $1 AND action = 'update' ORDER BY id DESC LIMIT 1", [String(ids.ib1)]); })
  .then(function (r) { ok(r.rows[0] && r.rows[0].next.inbound_enabled === true, 'inbox: patch audited'); })
  // ---------- routing rules (identity → p1, keyword → p2, default → p2)
  .then(function () { return req('POST', '/api/projects/' + P1 + '/comms/routes', { inbox_id: ids.ib1, kind: 'allowlist', identity_kind: 'phone', identity_value: CUST_A }, 'own'); })
  .then(function (x) { ok(x.status === 201, 'rules: identity rule → project 1'); ids.r1 = x.data.id; return req('POST', '/api/projects/' + P2 + '/comms/routes', { inbox_id: ids.ib2, kind: 'keyword', identity_value: 'CASSE' }, 'own'); })
  .then(function (x) { ok(x.status === 201 && x.data.entry === 'casse' && x.data.identity_kind === 'entry', 'rules: keyword rule → project 2 (token lower-cased)'); ids.rk = x.data.id; return req('POST', '/api/projects/' + P2 + '/comms/routes', { inbox_id: ids.ib2, kind: 'keyword', identity_value: 'x' }, 'own'); })
  .then(function (x) { ok(x.status === 400, 'rules: entry token too short → 400'); return req('POST', '/api/projects/' + P2 + '/comms/routes', { inbox_id: ids.ib2, kind: 'keyword', identity_value: 'bad token!' }, 'own'); })
  .then(function (x) { ok(x.status === 400, 'rules: entry token charset → 400'); return req('POST', '/api/projects/' + P2 + '/comms/routes', { inbox_id: ids.ib2, kind: 'keyword', identity_value: 'casse' }, 'own'); })
  .then(function (x) { ok(x.status === 409, 'rules: same keyword twice on the instance → 409'); return req('POST', '/api/projects/' + P2 + '/comms/routes', { inbox_id: ids.ib2, kind: 'default' }, 'own'); })
  .then(function (x) { ok(x.status === 201 && x.data.entry === '*' && x.data.identity_kind === 'any', 'rules: default rule → project 2'); ids.rd = x.data.id; return req('POST', '/api/projects/' + P1 + '/comms/routes', { inbox_id: ids.ib1, kind: 'default' }, 'own'); })
  .then(function (x) { ok(x.status === 409, 'rules: one default per instance (409)'); return req('POST', '/api/projects/' + P1 + '/comms/routes', { inbox_id: ids.ibP, kind: 'keyword', identity_value: 'promo' }, 'own'); })
  .then(function (x) { ok(x.status === 412, 'rules: keyword refused on a personal number (412)'); return req('POST', '/api/projects/' + P1 + '/comms/routes', { inbox_id: ids.ibP, kind: 'default' }, 'own'); })
  .then(function (x) { ok(x.status === 412, 'rules: default refused on a personal number (412)'); return req('POST', '/api/projects/' + P1 + '/comms/routes', { inbox_id: ids.ibP, kind: 'allowlist', identity_kind: 'phone', identity_value: CUST_X }, 'own'); })
  .then(function (x) { ok(x.status === 201, 'rules: identity rule allowed on the personal number'); ids.rX = x.data.id; return req('GET', '/api/projects/' + P2 + '/comms/routes', undefined, 'agt'); })
  .then(function (x) { ok(x.status === 200 && x.data.items.length === 2 && x.data.items.some(function (r) { return r.kind === 'keyword' && r.entry === 'casse'; }) && x.data.items.some(function (r) { return r.kind === 'default' && r.entry === '*'; }), 'rules: listing shows entry tokens'); })
  // ---------- simulate (dry-run)
  .then(function () { return req('POST', '/api/whatsapp/routing/simulate', { instance: SHARED, from: CUST_A, text: 'bonjour' }, 'agt'); })
  .then(function (x) { ok(x.status === 403, 'simulate: manager+ only'); return req('POST', '/api/whatsapp/routing/simulate', { instance: SHARED, from: CUST_A, text: 'bonjour' }, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.routed === true && x.data.mode === 'rule' && x.data.project_id === P1 && x.data.inbox_id === ids.ib1 && x.data.rule_id === ids.r1, 'simulate: identity → project 1 (' + JSON.stringify(x.data) + ')'); return req('POST', '/api/whatsapp/routing/simulate', { instance: SHARED, from: CUST_B, text: 'Je cherche une CASSE pour pare-choc' }, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.mode === 'keyword' && x.data.project_id === P2 && x.data.rule_id === ids.rk, 'simulate: keyword (case-insensitive) → project 2'); return req('POST', '/api/whatsapp/routing/simulate', { instance: SHARED, from: CUST_C, text: 'hello' }, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.mode === 'default' && x.data.project_id === P2 && x.data.rule_id === ids.rd, 'simulate: default → project 2'); return req('POST', '/api/whatsapp/routing/simulate', { instance: PERSONAL, from: CUST_C, text: 'casse' }, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.routed === false && x.data.reason === 'UNROUTED' && x.data.personal === true, 'simulate: unknown sender on the personal number → UNROUTED'); return req('POST', '/api/whatsapp/routing/simulate', { instance: DED, from: CUST_C, text: 'x' }, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.mode === 'dedicated' && x.data.project_id === P1, 'simulate: dedicated instance'); return req('POST', '/api/whatsapp/routing/simulate', { instance: SHARED, from: 'abc', text: 'x' }, 'adm'); })
  .then(function (x) { ok(x.status === 400, 'simulate: sender digits validated'); return q('SELECT count(*)::int AS n FROM wp_conversations WHERE project_id = ANY($1)', [[P1, P2]]); })
  .then(function (r) { ok(r.rows[0].n === 0, 'simulate: no conversation written'); })
  // ---------- receiver end-to-end: ONE instance → TWO projects
  .then(function () { return hook(msg('V2A1', CUST_A, 'Bonjour, je cherche une pièce', SHARED)); })
  .then(function (x) { ok(x.status === 200 && x.body.persisted === true, 'e2e: identity-routed message persisted'); return q('SELECT id, project_id, inbox_id, routed_by, route_rule_id FROM wp_conversations WHERE id = $1', [x.body.conversation_id]); })
  .then(function (r) { var c = r.rows[0]; ids.convA = c.id; ok(c.project_id === P1 && c.inbox_id === ids.ib1 && c.routed_by === 'rule' && c.route_rule_id === ids.r1, 'e2e: conversation in project 1 with routed_by=rule + rule id'); return q("SELECT payload FROM wp_conversation_events WHERE conversation_id = $1 AND kind = 'created'", [c.id]); })
  .then(function (r) { ok(r.rows[0] && r.rows[0].payload.routed_by === 'rule' && String(r.rows[0].payload.rule_id) === String(ids.r1), 'e2e: created event payload carries routed_by / rule_id'); return hook(msg('V2B1', CUST_B, 'Bonjour, casse pare-choc Tivoli ?', SHARED)); })
  .then(function (x) { ok(x.body.persisted === true, 'e2e: keyword message persisted'); return q('SELECT id, project_id, inbox_id, routed_by, route_rule_id FROM wp_conversations WHERE id = $1', [x.body.conversation_id]); })
  .then(function (r) { var c = r.rows[0]; ids.convB = c.id; ok(c.project_id === P2 && c.inbox_id === ids.ib2 && c.routed_by === 'keyword' && c.route_rule_id === ids.rk, 'e2e: keyword → project 2 (routed_by=keyword)'); return hook(msg('V2B2', CUST_B, 'suite sans le mot', SHARED)); })
  .then(function (x) { ok(x.body.persisted === true && x.body.conversation_id === ids.convB, 'e2e: sticky — follow-up without the keyword lands in the SAME project-2 conversation'); return hook(msg('V2C1', CUST_C, 'hello?', SHARED)); })
  .then(function (x) { ok(x.body.persisted === true, 'e2e: default-routed message persisted'); return q('SELECT id, project_id, routed_by, route_rule_id FROM wp_conversations WHERE id = $1', [x.body.conversation_id]); })
  .then(function (r) { var c = r.rows[0]; ids.convC = c.id; ok(c.project_id === P2 && c.routed_by === 'default' && c.route_rule_id === ids.rd, 'e2e: default → project 2 (routed_by=default)'); return req('POST', '/api/projects/' + P1 + '/comms/routes', { inbox_id: ids.ib1, kind: 'allowlist', identity_kind: 'phone', identity_value: CUST_C }, 'own'); })
  .then(function (x) { ok(x.status === 201, 'sticky: identity rule for C → project 1 added while C talks to project 2'); ids.rC = x.data.id; return hook(msg('V2C2', CUST_C, 'encore moi', SHARED)); })
  .then(function (x) { ok(x.body.persisted === true && x.body.conversation_id === ids.convC, 'sticky: the live conversation wins over a newer identity rule'); return q("UPDATE wp_conversations SET status = 'resolved', resolved_at = now() WHERE id = $1", [ids.convC]); })
  .then(function () { return hook(msg('V2C3', CUST_C, 'nouvelle demande', SHARED)); })
  .then(function (x) { ok(x.body.persisted === true && x.body.conversation_id !== ids.convC, 'sticky: once resolved, the identity rule routes C to project 1'); return q('SELECT project_id, routed_by FROM wp_conversations WHERE id = $1', [x.body.conversation_id]); })
  .then(function (r) { ids.convC1 = r.rows[0]; ok(r.rows[0].project_id === P1 && r.rows[0].routed_by === 'rule', 'sticky: new conversation in project 1 by rule'); return q('SELECT project_id, count(*)::int AS n FROM wp_conversations WHERE inbox_id IN ($1, $2) GROUP BY project_id ORDER BY project_id', [ids.ib1, ids.ib2]); })
  .then(function (r) { ok(r.rows.length === 2 && r.rows[0].project_id === P1 && r.rows[0].n === 2 && r.rows[1].project_id === P2 && r.rows[1].n === 2, 'e2e: ONE instance delivered into TWO projects (' + JSON.stringify(r.rows) + ')'); })
  // personal number: identity-only
  .then(function () { return hook(msg('V2P1', '21655700077', 'PERSONAL-TEXT-V2WA', PERSONAL, { owner: PERSONAL_PHONE })); })
  .then(function (x) { ok(x.status === 200 && x.body.dropped === true && x.body.reason === 'UNROUTED', 'personal: unknown sender dropped before ledger'); return q("SELECT count(*)::int AS n FROM wp_messages WHERE text LIKE '%PERSONAL-TEXT-V2WA%'"); })
  .then(function (r) { ok(r.rows[0].n === 0, 'personal: dropped content nowhere'); return hook(msg('V2P2', CUST_X, 'je suis inscrit', PERSONAL, { owner: PERSONAL_PHONE })); })
  .then(function (x) { ok(x.body.persisted === true, 'personal: identity-routed sender persisted'); ids.convX = x.body.conversation_id; return req('POST', '/api/projects/' + P1 + '/comms/routes/' + ids.rX + '/disable', {}, 'own'); })
  .then(function (x) { ok(x.status === 200, 'personal: rule disabled'); return hook(msg('V2P3', CUST_X, 'après désactivation', PERSONAL, { owner: PERSONAL_PHONE })); })
  .then(function (x) { ok(x.body.dropped === true && x.body.reason === 'UNROUTED', 'personal: no sticky on a personal number — disabled rule = deny even with an open conversation'); return hook(msg('V2D1', CUST_C, 'dedicated path', DED, { owner: DED_PHONE })); })
  .then(function (x) { ok(x.body.persisted === true, 'dedicated: single link routes directly'); return q('SELECT project_id, routed_by, route_rule_id FROM wp_conversations WHERE id = $1', [x.body.conversation_id]); })
  .then(function (r) { ok(r.rows[0].project_id === P1 && r.rows[0].routed_by === 'dedicated' && r.rows[0].route_rule_id === null, 'dedicated: routed_by=dedicated'); return req('DELETE', '/api/projects/' + P1 + '/comms/routes/' + ids.rC, undefined, 'agt'); })
  .then(function (x) { ok(x.status === 403, 'rules: delete is admin+ (agent 403)'); return req('DELETE', '/api/projects/' + P2 + '/comms/routes/' + ids.rC, undefined, 'adm'); })
  .then(function (x) { ok(x.status === 404, 'rules: delete is project-scoped (404 from the other project)'); return req('DELETE', '/api/projects/' + P1 + '/comms/routes/' + ids.rC, undefined, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.deleted === true, 'rules: deleted'); return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE actor = 'v2wa-adm' AND action = 'delete' AND resource = 'inbox_routes' AND record_id = $1", [String(ids.rC)]); })
  .then(function (r) { ok(r.rows[0].n >= 1, 'rules: delete audited'); })
  // ---------- handoff
  .then(function () { return req('POST', '/api/projects/' + P1 + '/comms/conversations/' + ids.convA + '/handoff', { direction: 'sideways' }, 'agt'); })
  .then(function (x) { ok(x.status === 400, 'handoff: direction validated'); return req('POST', '/api/projects/' + P1 + '/comms/conversations/' + ids.convA + '/handoff', { direction: 'ai_to_human', reason: 'customer asked for a human' }, 'agt'); })
  .then(function (x) { ok(x.status === 200 && x.data.handoff_id && x.data.handler === 'human' && x.data.status === 'needs_human', 'handoff: ai_to_human by an agent (' + JSON.stringify(x.data) + ')'); ids.ho1 = x.data.handoff_id; return req('GET', '/api/projects/' + P1 + '/comms/conversations/' + ids.convA, undefined, 'agt'); })
  .then(function (x) { ok(x.status === 200 && x.data.handler === 'human' && x.data.status === 'needs_human', 'handoff: conversation.handler = human, status needs_human'); return req('POST', '/api/projects/' + P1 + '/comms/conversations/' + ids.convA + '/handoff', { direction: 'ai_to_human', assign_to: 'v2wa-agt' }, 'agt'); })
  .then(function (x) { ok(x.status === 200 && x.data.handoff_id === ids.ho1 && x.data.already === true, 'handoff: repeated ai_to_human is idempotent (same handoff)'); return req('GET', '/api/projects/' + P1 + '/comms/conversations/' + ids.convA + '/handoffs', undefined, 'agt'); })
  .then(function (x) { var h = x.data.items[0]; ok(x.status === 200 && x.data.items.length === 1 && h.direction === 'ai_to_human' && h.status === 'IN_PROGRESS' && h.assigned_to === 'v2wa-agt' && h.previous_state && h.previous_state.handler === 'ai' && h.previous_state.status === 'open' && h.reason === 'CUSTOMER_ASKED_FOR_A_HUMAN', 'handoff: history row with direction / previous_state / assignment'); return req('POST', '/api/projects/' + P1 + '/comms/conversations/' + ids.convA + '/handoff', { direction: 'human_to_ai', reason: 'done' }, 'agt'); })
  .then(function (x) { ok(x.status === 200 && x.data.handler === 'ai' && x.data.status === 'open' && x.data.resolved.indexOf(ids.ho1) !== -1, 'handoff: human_to_ai resolves the open handoff and reopens'); return req('GET', '/api/projects/' + P1 + '/comms/conversations/' + ids.convA + '/handoffs', undefined, 'agt'); })
  .then(function (x) { ok(x.data.items.length === 2 && x.data.items[0].direction === 'human_to_ai' && x.data.items[0].status === 'RESOLVED' && x.data.items[1].status === 'RESOLVED' && x.data.items[1].resolved_by === 'v2wa-agt', 'handoff: history has both directions, first one resolved'); return q("SELECT event_name FROM wp_conversation_events WHERE conversation_id = $1 AND kind = 'handoff' ORDER BY id", [ids.convA]); })
  .then(function (r) { ok(r.rows.map(function (x) { return x.event_name; }).join(',') === 'handoff.created,handoff.resolved', 'handoff: journaled handoff.created + handoff.resolved'); return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE actor = 'v2wa-agt' AND action = 'handoff' AND record_id = $1", [String(ids.convA)]); })
  .then(function (r) { ok(r.rows[0].n === 3, 'handoff: every call audited'); return req('POST', '/api/projects/' + P2 + '/comms/conversations/' + ids.convA + '/handoff', { direction: 'ai_to_human' }, 'agt'); })
  .then(function (x) { ok(x.status === 404, 'handoff: project-scoped (404 from the other project)'); })
  // ---------- templates
  .then(function () { return req('POST', '/api/templates', { project_id: P1, name: 'v2wa_welcome', language: 'fr', category: 'UTILITY', header: 'Bonjour {{name}}', body: 'Votre commande {{1}} est prête. Référence {{ref}}.', footer: 'MYTHOS', variables: [{ name: 'name', example: 'Ali' }, { name: '1', example: 'CMD-12' }, { name: 'ref', example: 'R-1' }] }, 'agt'); })
  .then(function (x) { ok(x.status === 403, 'templates: agent cannot create (403)'); return req('POST', '/api/templates', { project_id: P1, name: 'Bad Name', body: 'x' }, 'adm'); })
  .then(function (x) { ok(x.status === 400, 'templates: name validated (400)'); return req('POST', '/api/templates', { project_id: P1, name: 'v2wa_welcome', language: 'fr', category: 'UTILITY', header: 'Bonjour {{name}}', body: 'Votre commande {{1}} est prête. Référence {{ref}}.', footer: 'MYTHOS', variables: [{ name: 'name', example: 'Ali' }, { name: '1', example: 'CMD-12' }, { name: 'ref', example: 'R-1' }] }, 'adm'); })
  .then(function (x) { ok(x.status === 201 && x.data.id && x.data.status === 'draft' && x.data.placeholders.sort().join(',') === '1,name,ref', 'templates: created (201) with detected placeholders'); ids.tpl = x.data.id; return req('POST', '/api/templates', { project_id: P1, name: 'v2wa_welcome', language: 'fr', body: 'dup' }, 'adm'); })
  .then(function (x) { ok(x.status === 409, 'templates: (project, name, language) unique → 409'); return req('POST', '/api/templates/' + ids.tpl + '/preview', { variables: { name: 'Ali', 1: 'CMD-12', ref: 'R-77' } }, 'agt'); })
  .then(function (x) { ok(x.status === 200 && x.data.text === 'Bonjour Ali\nVotre commande CMD-12 est prête. Référence R-77.\nMYTHOS' && x.data.missing.length === 0, 'templates: preview renders named + positional placeholders'); return req('POST', '/api/templates/' + ids.tpl + '/preview', { variables: ['CMD-13'] }, 'agt'); })
  .then(function (x) { ok(x.status === 200 && x.data.missing.sort().join(',') === 'name,ref' && x.data.text.indexOf('{{name}}') !== -1 && x.data.text.indexOf('CMD-13') !== -1, 'templates: missing variables listed and left in place'); return req('PATCH', '/api/templates/' + ids.tpl, { footer: 'MYTHOS AUTO', category: 'marketing' }, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.footer === 'MYTHOS AUTO' && x.data.category === 'MARKETING', 'templates: patched'); return req('GET', '/api/templates?project=' + P1, undefined, 'agt'); })
  .then(function (x) { ok(x.status === 200 && x.data.items.some(function (t) { return t.id === ids.tpl; }), 'templates: listed per project'); return req('GET', '/api/templates?project=' + P2, undefined, 'agt'); })
  .then(function (x) { ok(x.status === 200 && !x.data.items.some(function (t) { return t.id === ids.tpl; }), 'templates: project 2 does not see project 1 templates'); return req('POST', '/api/templates/' + ids.tpl + '/sync', {}, 'adm'); })
  .then(function (x) { ok(x.status === 412 && x.body.errors && x.body.errors.reason === 'META_CLOUD_NOT_CONFIGURED', 'templates: sync → 412 META_CLOUD_NOT_CONFIGURED when Meta is not configured (' + x.status + ')'); return req('POST', '/api/templates/sync-all', {}, 'adm'); })
  .then(function (x) { ok(x.status === 412, 'templates: sync-all → 412 too'); })
  // configure the fake Meta Graph
  .then(function () { process.env.MYTHOS_WP_META_ACCESS_TOKEN_FILE = metaTokenFile; process.env.MYTHOS_WP_META_APP_SECRET_FILE = metaSecretFile; process.env.MYTHOS_WP_META_VERIFY_TOKEN_FILE = metaVerifyFile; process.env.MYTHOS_WP_META_GRAPH_BASE = 'http://127.0.0.1:' + graphPort + '/v21.0'; return req('POST', '/api/templates/' + ids.tpl + '/sync', {}, 'adm'); })
  .then(function (x) { ok(x.status === 412, 'templates: token present but no WABA account → still 412'); return req('POST', '/api/whatsapp/accounts', { provider: 'meta_cloud', display_name: 'v2wa-meta-waba', external_ref: WABA }, 'adm'); })
  .then(function (x) { ok(x.status === 201, 'accounts: meta_cloud account with WABA id'); ids.waba = x.data.id; return req('POST', '/api/templates/' + ids.tpl + '/sync', {}, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.action === 'created' && x.data.template.status === 'pending' && x.data.template.provider === 'meta_cloud' && x.data.template.provider_template_id === '900001' && x.data.waba_masked === '…0400', 'templates: sync pushes to the WABA (fake Graph) → pending (' + JSON.stringify(x.data && { a: x.data.action, s: x.data.template && x.data.template.status }) + ')'); var created = graph.templates[0]; ok(created && created.name === 'v2wa_welcome' && created.components.some(function (c) { return c.type === 'BODY' && /\{\{1\}\}/.test(c.text); }) && created.components.some(function (c) { return c.type === 'HEADER'; }) && created.components.some(function (c) { return c.type === 'FOOTER' && c.text === 'MYTHOS AUTO'; }), 'templates: Graph payload has HEADER/BODY/FOOTER components'); graph.templates[0].status = 'APPROVED'; return req('POST', '/api/templates/' + ids.tpl + '/sync', {}, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.action === 'refreshed' && x.data.template.status === 'approved', 'templates: second sync reads the remote status → approved'); graph.templates.push({ id: '900777', name: 'v2wa_remote_only', language: 'fr', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hello {{1}}' }] }); return req('POST', '/api/templates/sync-all', {}, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.fetched === 2 && x.data.created === 1 && x.data.updated === 1, 'templates: sync-all imports remote templates as shared rows (' + JSON.stringify(x.data) + ')'); return q("SELECT project_id, status, provider_template_id FROM wp_templates WHERE name = 'v2wa_remote_only'"); })
  .then(function (r) { ok(r.rows[0] && r.rows[0].project_id === null && r.rows[0].status === 'approved' && r.rows[0].provider_template_id === '900777', 'templates: imported row is shared (project NULL) and approved'); ok(graph.auth.every(function (a) { return a === 'Bearer ' + META_TOKEN; }) && JSON.stringify(graph.calls).indexOf(META_TOKEN) === -1, 'templates: token travels only in the Authorization header'); return req('POST', '/api/templates/' + ids.tpl + '/test', { conversation_id: ids.convA, variables: { name: 'Ali', 1: 'CMD-99', ref: 'R-1' } }, 'agt'); })
  .then(function (x) { ok(x.status === 403, 'templates: test-send is manager+ (agent 403)'); return req('POST', '/api/templates/' + ids.tpl + '/test', { conversation_id: ids.convA, variables: { name: 'Ali' } }, 'adm'); })
  .then(function (x) { ok(x.status === 400 && x.body.errors && x.body.errors.missing, 'templates: test-send refuses missing variables (400)'); return req('POST', '/api/templates/' + ids.tpl + '/test', { conversation_id: ids.convA, variables: { name: 'Ali', 1: 'CMD-99', ref: 'R-1' } }, 'adm'); })
  .then(function (x) { ok(x.status === 201 && x.data.status === 'sent' && x.data.provider_message_id === 'EVO-1' && x.data.template_id === ids.tpl, 'templates: test-send goes through outbound.send (fake Evolution) → sent (' + JSON.stringify(x.data) + ')'); var s = evo.sent[0]; ok(s && s.body.number === CUST_A && s.body.text === 'Bonjour Ali\nVotre commande CMD-99 est prête. Référence R-1.\nMYTHOS AUTO' && s.key === EVO_KEY && /v2wa-shared/.test(s.url), 'templates: rendered text sent to the customer through the shared instance'); return q("SELECT client_ref, sender_kind FROM wp_messages WHERE id = $1", [x.data.message_id]); })
  .then(function (r) { ok(r.rows[0] && /^tpl-\d+-\d+$/.test(r.rows[0].client_ref) && r.rows[0].sender_kind === 'user', 'templates: client_ref tpl-<id>-<ts>'); return req('POST', '/api/templates/' + ids.tpl + '/test', { conversation_id: ids.convB, variables: { name: 'A', 1: 'B', ref: 'C' } }, 'adm'); })
  .then(function (x) { ok(x.status === 404, 'templates: project template cannot be sent into another project\'s conversation'); return req('DELETE', '/api/templates/' + ids.tpl, undefined, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.deleted === true, 'templates: deleted by admin'); return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE actor = 'v2wa-adm' AND resource = 'templates' AND action IN ('create','update','sync','test','delete')"); })
  .then(function (r) { ok(r.rows[0].n >= 7, 'templates: every mutation audited (' + r.rows[0].n + ')'); })
  // ---------- meta_cloud provider unit checks
  .then(function () {
    var d = meta.describe();
    ok(d.id === 'meta_cloud' && d.channel === 'whatsapp' && d.official === true && d.configured === true && d.problems.length === 0, 'meta_cloud: describe configured');
    var caps = meta.capabilities(); ok(caps.signed_webhooks === true && caps.templates === true && caps.official === true, 'meta_cloud: capabilities');
    var raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: WABA, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '216 55 555 0007', phone_number_id: PHONE_ID }, contacts: [{ profile: { name: 'Karim' }, wa_id: CUST_B }], messages: [{ from: CUST_B, id: 'wamid.HBgLMjE2NTU3MDAwMDIVAgASGBQzQTRCNTZDRDAyNjc0RjZBRjQ5NwA=', timestamp: '1788620000', type: 'text', text: { body: 'Prix du filtre ?' }, context: { id: 'wamid.PREV' } }] } }] }] });
    var sig = 'sha256=' + crypto.createHmac('sha256', META_SECRET).update(raw).digest('hex');
    ok(meta.verifyWebhook({ method: 'POST', headers: { 'x-hub-signature-256': sig } }, { rawBody: raw }).ok === true, 'meta_cloud: valid X-Hub-Signature-256 accepted');
    ok(meta.verifyWebhook({ method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + 'a'.repeat(64) } }, { rawBody: raw }).reason === 'SIGNATURE_MISMATCH', 'meta_cloud: wrong signature rejected');
    ok(meta.verifyWebhook({ method: 'POST', headers: {} }, { rawBody: raw }).reason === 'SIGNATURE_MISSING', 'meta_cloud: missing signature rejected');
    ok(meta.verifyWebhook({ method: 'POST', headers: { 'x-hub-signature-256': sig } }, { rawBody: raw + ' ' }).ok === false, 'meta_cloud: signature bound to the raw body');
    var g = meta.verifyWebhook({ method: 'GET' }, { method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': META_VERIFY, 'hub.challenge': '1234567' } });
    ok(g.ok === true && g.challenge === '1234567', 'meta_cloud: GET verification returns the challenge');
    ok(meta.verifyWebhook({ method: 'GET' }, { method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' } }).reason === 'VERIFY_TOKEN_MISMATCH', 'meta_cloud: GET verification refuses a wrong token');
    var p = meta.parseInbound(JSON.parse(raw));
    ok(p.ok && p.kind === 'message' && p.event.instance === PHONE_ID && p.event.contact.wa_id === CUST_B && p.event.contact.display_name === 'Karim' && p.event.text === 'Prix du filtre ?' && p.event.message_type === 'text' && p.event.quoted_provider_message_id === 'wamid.PREV' && p.event.provider_timestamp === new Date(1788620000000).toISOString() && p.event.contact.identities[0].value === CUST_B, 'meta_cloud: parseInbound text message');
    var st = meta.parseInbound({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: 'wamid.OUT1', status: 'delivered', recipient_id: CUST_B, timestamp: '1' }] } }] }] });
    ok(st.ok && st.kind === 'status' && st.event.provider_message_id === 'wamid.OUT1' && st.event.status === 'delivered' && st.event.instance === PHONE_ID, 'meta_cloud: parseInbound status update');
    var img = meta.parseInbound({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, messages: [{ from: CUST_B, id: 'wamid.IMG', timestamp: '2', type: 'image', image: { id: '445566', mime_type: 'image/jpeg', sha256: Buffer.alloc(32, 9).toString('base64'), caption: 'la pièce' } }] } }] }] });
    ok(img.ok && img.event.message_type === 'image' && img.event.text === 'la pièce' && img.event.attachments[0].media_id === '445566' && img.event.attachments[0].sha256 === '09'.repeat(32), 'meta_cloud: parseInbound image with caption');
    ok(meta.parseInbound({ object: 'page' }).reason.indexOf('EVENT_IGNORED') === 0 && meta.parseInbound({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'account_update', value: { metadata: { phone_number_id: PHONE_ID } } }] }] }).reason === 'EVENT_IGNORED:account_update', 'meta_cloud: non-message payloads ignored by name');
    return meta.sendText({ instance: PHONE_ID, to: CUST_B, text: 'Bonjour depuis MYTHOS' });
  })
  .then(function (r) {
    ok(r.ok === true && r.status === 200 && r.provider_message_id === 'wamid.TEST1', 'meta_cloud: sendText → provider message id (' + JSON.stringify(r) + ')');
    var s = graph.sent[0]; ok(s && s.phone_number_id === PHONE_ID && s.body.messaging_product === 'whatsapp' && s.body.to === CUST_B && s.body.type === 'text' && s.body.text.body === 'Bonjour depuis MYTHOS', 'meta_cloud: sendText payload shape');
    return meta.sendTemplate({ instance: PHONE_ID, to: CUST_B, name: 'v2wa_welcome', language: 'fr', components: [{ type: 'body', parameters: [{ type: 'text', text: 'x' }] }] });
  })
  .then(function (r) { ok(r.ok && graph.sent[1].body.type === 'template' && graph.sent[1].body.template.name === 'v2wa_welcome' && graph.sent[1].body.template.language.code === 'fr', 'meta_cloud: sendTemplate payload shape'); return meta.health({ instance: PHONE_ID }); })
  .then(function (h) { ok(h.ok === true && h.state === 'open' && h.detail.verified_name === 'MYTHOS Test' && h.detail.display_phone_number_masked === '***0007', 'meta_cloud: health reads the phone number (' + JSON.stringify(h) + ')'); return meta.sendText({ instance: 'not-digits', to: CUST_B, text: 'x' }); })
  .then(function (r) { ok(r.ok === false && /CONFIG/.test(r.error), 'meta_cloud: bad instance refused without a call'); return hook(null, { method: 'GET', path: '/hooks/meta_cloud?hub.mode=subscribe&hub.verify_token=' + encodeURIComponent(META_VERIFY) + '&hub.challenge=98765' }); })
  .then(function (x) { ok(x.status === 200 && x.text === '98765' && /text\/plain/.test(x.headers['content-type']), 'receiver: GET verification answers hub.challenge as text/plain (' + x.status + ')'); return hook(null, { method: 'GET', path: '/hooks/meta_cloud?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=98765' }); })
  .then(function (x) { ok(x.status === 403, 'receiver: GET verification with a wrong token → 403'); return hook(null, { method: 'GET', path: '/hooks/evolution?hub.mode=subscribe&hub.challenge=1' }); })
  .then(function (x) { ok(x.status === 405, 'receiver: GET on an unsigned provider stays 405'); var raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '555000111222' }, messages: [{ from: CUST_B, id: 'wamid.E2E1', timestamp: '3', type: 'text', text: { body: 'hi' } }] } }] }] }); ids.metaRaw = raw; return hook(raw, { path: '/hooks/meta_cloud', noToken: true, headers: { 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', META_SECRET).update(raw).digest('hex') } }); })
  .then(function (x) { ok(x.status === 202 && x.body.reason === 'INBOX_UNKNOWN', 'receiver: signed Cloud API delivery accepted (unknown phone_number_id → 202 dead-letter)'); return hook(ids.metaRaw, { path: '/hooks/meta_cloud', noToken: true, headers: { 'x-hub-signature-256': 'sha256=' + 'b'.repeat(64) } }); })
  .then(function (x) { ok(x.status === 401 && x.body.reason === 'SIGNATURE_MISMATCH', 'receiver: bad signature → 401'); return q("SELECT event, status, reason FROM wp_inbound_events WHERE instance = '555000111222' ORDER BY id DESC LIMIT 1"); })
  .then(function (r) { ok(r.rows[0] && r.rows[0].event === 'messages' && r.rows[0].status === 'rejected', 'receiver: Cloud API ledger row labelled by change kind'); return q("DELETE FROM wp_inbound_events WHERE instance = '555000111222'"); })
  .then(function () { delete process.env.MYTHOS_WP_META_ACCESS_TOKEN_FILE; var d = meta.describe(); ok(d.configured === false && d.problems.length === 1 && d.problems[0] === 'access_token_file_missing' && JSON.stringify(d).indexOf(META_TOKEN) === -1 && JSON.stringify(d).indexOf('SECRET') === -1, 'meta_cloud: describe names the missing file as a code, never a value nor an env var name'); process.env.MYTHOS_WP_META_ACCESS_TOKEN_FILE = metaTokenFile; })
  // ---------- meta MCP descriptor (no network) + probe against loopback only
  .then(function () { return req('GET', '/api/whatsapp/mcp', undefined, 'agt'); })
  .then(function (x) {
    var m = x.data && x.data.mcp;
    ok(x.status === 200 && m && m.endpoint === 'https://mcp.facebook.com/whatsapp_business_tools' && m.transport === 'streamable-http' && m.status === 'beta', 'mcp: descriptor endpoint/transport/status');
    ok(m && m.tools.length === 18 && m.tools.indexOf('whatsapp_biz_send_message') !== -1 && m.tools.every(function (t) { return /^whatsapp_biz_[a-z_]+$/.test(t); }) && m.scopes.join(',') === 'business_management,whatsapp_business_management,whatsapp_business_messaging', 'mcp: 18 documented whatsapp_biz_ tools + 3 scopes');
    ok(m && m.claude_code_command === 'claude mcp add --transport http whatsapp_business_tools https://mcp.facebook.com/whatsapp_business_tools' && /never runtime customer messaging/.test(m.purpose) && m.owner_step && m.invocation === 'not implemented (by design)', 'mcp: claude_code_command / purpose / owner_step, no invocation');
    ok(m && (m.reachable === null || typeof m.reachable === 'boolean') && 'integration' in x.data, 'mcp: GET performs no probe of its own');
    var closed = http.createServer(function (rq, rs) { rs.writeHead(405, { Allow: 'POST' }); rs.end(); });
    return listen(closed).then(function (p) { return metaMcp.probe({ url: 'http://127.0.0.1:' + p + '/whatsapp_business_tools' }).then(function (r) { closed.close(); ok(r.reachable === true && r.http_status === 405 && r.checked_at, 'mcp: probe treats any HTTP answer (405) as reachable'); return metaMcp.probe({ url: 'http://127.0.0.1:' + p + '/x', timeoutMs: 1000 }); }); });
  })
  .then(function (r) { ok(r.reachable === false && r.http_status === null, 'mcp: probe reports an unreachable endpoint'); return metaMcp.probe({ url: 'http://example.invalid/x' }); })
  .then(function (r) { ok(r.reachable === false && /https only/.test(r.detail), 'mcp: probe refuses plain http off loopback'); return req('POST', '/api/whatsapp/mcp/probe', {}, 'agt'); })
  .then(function (x) { ok(x.status === 403, 'mcp: probe endpoint is admin-only (not executed in tests)'); })
  // ---------- contacts 360
  .then(function () { return req('GET', '/api/contacts?project=all', undefined, 'adm'); })
  .then(function (x) {
    var items = x.data.items; var c = items.filter(function (i) { return i.phone === CUST_C; })[0];
    ok(x.status === 200 && c && c.phone_masked === '***0003' && c.projects.length === 2 && c.projects.map(function (p) { return p.project_id; }).sort().join(',') === P1 + ',' + P2 && c.conversations === 3, 'contacts: the same phone across two projects is ONE entry with two project rows (' + JSON.stringify(c && { m: c.phone_masked, n: c.projects.length, conv: c.conversations }) + ')');
    ok(items.filter(function (i) { return i.phone_masked === '***0003'; }).length === 1, 'contacts: no duplicate entry');
    ok(items.every(function (i) { return typeof i.phone === 'string'; }), 'contacts: admin sees the full phone');
    return req('GET', '/api/contacts?project=all', undefined, 'agt');
  })
  .then(function (x) { ok(x.status === 200 && x.data.items.length >= 3 && x.data.items.every(function (i) { return !('phone' in i) && /^\*\*\*\d{4}$/.test(i.phone_masked); }) && JSON.stringify(x.data).indexOf(CUST_C) === -1, 'contacts: agent sees masks only'); return req('GET', '/api/contacts?project=' + P2 + '&q=' + CUST_B.slice(-4), undefined, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.items.length === 1 && x.data.items[0].phone === CUST_B && x.data.items[0].projects.length === 1, 'contacts: project + q filter'); return req('GET', '/api/contacts/360/' + CUST_C, undefined, 'adm'); })
  .then(function (x) {
    var d = x.data;
    ok(x.status === 200 && d.phone === CUST_C && d.phone_masked === '***0003' && d.persons.length === 2 && d.conversations.length === 3, 'contacts 360: persons per project + conversations across projects');
    ok(d.timeline.length > 0 && d.timeline.every(function (t) { return t.kind && t.at && t.project_id && !('text' in t); }) && d.timeline.some(function (t) { return t.summary === 'conversation.created'; }), 'contacts 360: timeline merged, newest first, no message text');
    ok(d.ai && typeof d.ai.runs === 'number' && typeof d.ai.handoffs === 'number' && d.human && typeof d.human.messages_out === 'number' && typeof d.human.notes === 'number', 'contacts 360: ai / human counters');
    ok(d.conversations.every(function (c) { return c.handler && c.status && c.inbox_id; }) && d.persons.every(function (p) { return Array.isArray(p.tags) && Array.isArray(p.notes); }), 'contacts 360: conversation + person shapes');
    return req('GET', '/api/contacts/360/' + CUST_C, undefined, 'agt');
  })
  .then(function (x) { ok(x.status === 200 && !('phone' in x.data) && x.data.phone_masked === '***0003' && JSON.stringify(x.data).indexOf(CUST_C) === -1, 'contacts 360: agent never receives the full phone'); return req('GET', '/api/contacts/360/' + CUST_A, undefined, 'adm'); })
  .then(function (x) { ok(x.status === 200 && x.data.ai.handoffs === 2 && x.data.human.messages_out === 1 && x.data.timeline.some(function (t) { return t.kind === 'handoff'; }), 'contacts 360: handoffs + human replies counted for A'); return req('GET', '/api/contacts/360/21600000000', undefined, 'adm'); })
  .then(function (x) { ok(x.status === 404, 'contacts 360: unknown phone → 404'); return req('GET', '/api/contacts/360/abc', undefined, 'adm'); })
  .then(function (x) { ok(x.status === 404, 'contacts 360: non-digit path does not match'); })
  // ---------- pure decide(): order + personal guard
  .then(function () {
    var ibA = { id: 1, project_id: 'a', account_mode: 'shared', account_ref: '21600000001' }, ibB = { id: 2, project_id: 'b', account_mode: 'shared', account_ref: '21600000001' };
    var ev = function (from, text) { return { provider: 'evolution', text: text, contact: { identities: [{ kind: 'phone', value: from }] } }; };
    var kw = { id: 10, inbox_id: 2, project_id: 'b', kind: 'keyword', identity_kind: 'entry', identity_value: 'casse', enabled: true, priority: 100 };
    var df = { id: 11, inbox_id: 2, project_id: 'b', kind: 'default', identity_kind: 'any', identity_value: '*', enabled: true, priority: 100 };
    var al = { id: 12, inbox_id: 1, project_id: 'a', kind: 'allowlist', identity_kind: 'phone', identity_value: '21655000001', enabled: true, priority: 100 };
    ok(routing.decide([ibA, ibB], [kw, df, al], ev('21655000001', 'CASSE svp')).mode === 'rule', 'decide: identity rule beats keyword');
    ok(routing.decide([ibA, ibB], [kw, df, al], ev('21655000002', 'une CASSE svp')).mode === 'keyword', 'decide: keyword beats default');
    ok(routing.decide([ibA, ibB], [kw, df, al], ev('21655000002', 'bonjour')).mode === 'default', 'decide: default catches the rest');
    ok(routing.decide([ibA, ibB], [kw, df, al], ev('21655000002', 'casse'), { sticky: [{ conversation_id: 9, inbox_id: 1 }] }).mode === 'sticky', 'decide: sticky beats keyword');
    ok(routing.decide([ibA, ibB], [kw, df, al], ev('21655000002', 'casse'), { personal: true }).reason === 'UNROUTED', 'decide: personal ignores keyword + default');
    ok(routing.decide([ibA, ibB], [kw, df, al], ev('21655000001', 'x'), { personal: true, sticky: [{ conversation_id: 9, inbox_id: 2 }] }).mode === 'rule', 'decide: personal ignores sticky, keeps identity rules');
    ok(routing.decide([ibA, ibB], [{ id: 13, inbox_id: 2, project_id: 'b', kind: 'keyword', identity_kind: 'entry', identity_value: 'BAD TOKEN', enabled: true, priority: 1 }], ev('21655000002', 'bad token')).reason === 'RULE_MALFORMED', 'decide: malformed keyword rule fails closed');
    ok(routing.decide([ibA, ibB], [{ id: 14, inbox_id: 1, project_id: 'b', kind: 'default', identity_kind: 'any', identity_value: '*', enabled: true, priority: 1 }], ev('21655000002', 'x')).reason === 'RULE_MALFORMED', 'decide: default rule pointing across projects fails closed');
    ok(routing.decide([ibA, ibB], [df], ev('21600000001', 'x')).reason === 'OWNER_EXCLUDED', 'decide: owner excluded before default');
  })
  // ---------- teardown: owner deletes in order
  .then(function () { return req('DELETE', '/api/whatsapp/accounts/' + ids.acc, undefined, 'own'); })
  .then(function (x) { ok(x.status === 200 && x.data.deleted === true, 'accounts: owner deletes'); return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE actor LIKE 'v2wa-%' AND (next::text LIKE '%' || $1 || '%' OR next::text LIKE '%' || $2 || '%' OR next::text LIKE '%' || $3 || '%')", [EVO_KEY, META_TOKEN, META_SECRET]); })
  .then(function (r) { ok(r.rows[0].n === 0, 'security: no credential value in the audit log'); return q("SELECT count(*)::int AS n FROM wp_phone_numbers WHERE webhook_detail LIKE '%SHOULD-NEVER%' OR health_detail LIKE '%' || $1 || '%'", [EVO_KEY]); })
  .then(function (r) { ok(r.rows[0].n === 0, 'security: no secret in number health/webhook details'); })
  .then(cleanup)
  .then(function () { server.close(); fakeEvo.close(); fakeGraph.close(); return pool.end(); })
  .then(function () { finish(); })
  .catch(function (e) { console.error('ERROR: ' + (e && e.stack || e)); failed++; try { server.close(); fakeEvo.close(); fakeGraph.close(); } catch (x) {} cleanup().catch(function () {}).then(function () { return pool.end().catch(function () {}); }).then(function () { finish(1); }); });
