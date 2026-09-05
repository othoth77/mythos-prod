'use strict';
// =====================================================
// MYTHOS WP — multi-service foundation tests (MYTHOS-COMMS-8, #217)  needs MYTHOS_WP_TEST_DB_URL
// Projects: automotive needs a catalogue (400), service/internal do not (201),
// meta carries kind. Inboxes: two per project, account_ref shape, shared
// account refused (unique) unless allow_personal_account, reserved account
// (the notification channel) always refused (trigger), mythos-bridge refused
// (pattern + CHECK), settings keys validated. Data: same customer across two
// inboxes of one project = one contact / two conversations; other project =
// separate contact; project isolation (404s); membership scope: a member of
// one inbox sees only that inbox's conversations/contacts, my-inboxes, an
// unscoped operator sees all; assistant on a service project without a
// catalogue never fabricates facts.
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
function finish(code) { console.log('mythos-wp-comms-multiservice: ' + passed + ' passed, ' + failed + ' failed'); process.exit(code !== undefined ? code : (failed ? 1 : 0)); }
if (!TEST_URL) { console.error('MYTHOS_WP_TEST_DB_URL not set'); finish(process.env.MYTHOS_WP_ALLOW_SKIP === '1' ? 0 : 3); }
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-ms-'));
process.env.MYTHOS_WP_USERS_FILE = path.join(tmp, 'users.json'); process.env.MYTHOS_WP_INSECURE_COOKIE = '1';
process.env.MYTHOS_WP_CATALOG_TEST = TEST_URL; delete process.env.MYTHOS_WP_COMMS_CONFIG; delete process.env.MYTHOS_WP_RECEIVER_ENABLED;
var u = new URL(TEST_URL); process.env.MYTHOS_WP_DB_HOST = u.hostname; process.env.MYTHOS_WP_DB_PORT = u.port || '5432'; process.env.MYTHOS_WP_DB_USER = decodeURIComponent(u.username); process.env.MYTHOS_WP_DB_PASSWORD = decodeURIComponent(u.password); process.env.MYTHOS_WP_DB_NAME = u.pathname.slice(1);
var auth = require(path.join(WP, 'reference/auth'));
var migrate = require(path.join(WP, 'reference/migrate'));
var db = require(path.join(WP, 'reference/db'));
var store = require(path.join(WP, 'reference/projects-store'));
var core = require(path.join(WP, 'reference/comms/core'));
var assistant = require(path.join(WP, 'reference/comms/assistant'));
var providerMod = require(path.join(WP, 'reference/comms/providers/evolution'));
var pool = db.wp();
fs.writeFileSync(process.env.MYTHOS_WP_USERS_FILE, JSON.stringify({ users: [{ username: 'own', role: 'owner', scrypt: auth.hashPassword('owner-password-1') }, { username: 'op', role: 'operator', scrypt: auth.hashPassword('operator-password-1') }, { username: 'agent1', role: 'operator', scrypt: auth.hashPassword('agent-password-1') }] }), { mode: 0o600 });
var server = require(path.join(WP, 'reference/server')).createServer();
var PORT = 0, C = {};
function req(method, p, body, who) {
  return new Promise(function (resolve, reject) {
    var data = body !== undefined ? JSON.stringify(body) : null;
    var h = { 'Content-Type': 'application/json', 'X-Requested-With': 'MythosWP' }; if (data) h['Content-Length'] = Buffer.byteLength(data); if (who && C[who]) h.Cookie = C[who];
    var rq = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: h, agent: false }, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j, data: j && j.data, cookie: (res.headers['set-cookie'] || [''])[0].split(';')[0] }); }); });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}
function q(sql, p) { return pool.query(sql, p || []); }
function inbound(instance, id, text, from, name) { return providerMod.parseInbound({ event: 'messages.upsert', instance: instance, sender: '21600000000@s.whatsapp.net', data: { key: { remoteJid: (from || '21699000001') + '@s.whatsapp.net', fromMe: false, id: id }, pushName: name || 'Client', message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) } }).event; }
function wipe() {
  var steps = ["UPDATE wp_messages SET ai_run_id = NULL", "DELETE FROM wp_inbound_events", "DELETE FROM wp_message_attachments", "DELETE FROM wp_conversation_events", "DELETE FROM wp_ai_suggestions", "DELETE FROM wp_ai_runs", "DELETE FROM wp_messages", "DELETE FROM wp_handoffs", "DELETE FROM wp_conversation_tags", "DELETE FROM wp_conversations", "DELETE FROM wp_contact_tags", "DELETE FROM wp_contacts", "DELETE FROM wp_tags", "DELETE FROM wp_inbox_members", "DELETE FROM wp_audit_events", "DELETE FROM wp_inboxes", "DELETE FROM wp_reserved_accounts", "DELETE FROM wp_knowledge", "DELETE FROM wp_business_rules", "DELETE FROM wp_stock", "DELETE FROM wp_product_commercial", "DELETE FROM wp_projects"];
  var chain = Promise.resolve(); steps.forEach(function (s) { chain = chain.then(function () { return q(s); }); }); return chain;
}
var ids = {};
migrate.up(pool).then(wipe)
  .then(function () { return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { PORT = server.address().port; resolve(); }); }); })
  .then(function () { return req('POST', '/api/login', { username: 'own', password: 'owner-password-1' }); }).then(function (x) { C.own = x.cookie; return req('POST', '/api/login', { username: 'op', password: 'operator-password-1' }); }).then(function (x) { C.op = x.cookie; return req('POST', '/api/login', { username: 'agent1', password: 'agent-password-1' }); }).then(function (x) { C.agent1 = x.cookie; })
  // ---- projects
  .then(function () { return req('POST', '/api/r/projects', { id: 'auto-a', display_name: 'Auto A', kind: 'automotive', status: 'active', currency: 'TND' }, 'own'); })
  .then(function (x) { ok(x.status === 400 && x.body.errors && x.body.errors.catalog_dsn_env, 'automotive without catalogue refused (' + x.status + ')'); return req('POST', '/api/r/projects', { id: 'auto-a', display_name: 'Auto A', kind: 'automotive', status: 'active', currency: 'TND', catalog_dsn_env: 'MYTHOS_WP_CATALOG_TEST', catalog_schema: 'ssangyong_autos' }, 'own'); })
  .then(function (x) { ok(x.status === 201, 'automotive with catalogue created (' + x.status + ')'); return req('POST', '/api/r/projects', { id: 'dar-hijama', display_name: 'Dar Hijama', kind: 'service', status: 'active', currency: 'TND' }, 'own'); })
  .then(function (x) { ok(x.status === 201 && x.data.row.kind === 'service' && x.data.row.catalog_dsn_env === null, 'service project without catalogue created'); return req('POST', '/api/r/projects', { id: 'mythos-prod', display_name: 'MYTHOS PROD', kind: 'internal', status: 'active', currency: 'TND' }, 'own'); })
  .then(function (x) { ok(x.status === 201 && x.data.row.kind === 'internal', 'internal project without catalogue created'); return q("INSERT INTO wp_projects (id, display_name, kind) VALUES ('bad-auto','x','automotive')").then(function () { ok(false, 'db: automotive without catalogue must fail'); }, function (e) { ok(/wp_projects_catalog_required/.test(e.message), 'db CHECK: automotive requires catalogue'); }); })
  .then(function () { store.invalidate(); return req('GET', '/api/meta', undefined, 'op'); })
  .then(function (x) { var kinds = {}; x.data.projects.forEach(function (p) { kinds[p.id] = p.kind; }); ok(kinds['auto-a'] === 'automotive' && kinds['dar-hijama'] === 'service' && kinds['mythos-prod'] === 'internal', 'meta carries project kind'); ok(x.data.projects.filter(function (p) { return p.id === 'dar-hijama'; })[0].catalog_configured === false, 'service project reports no catalogue'); })
  // ---- inboxes
  .then(function () { return q("INSERT INTO wp_reserved_accounts (account_ref, reason) VALUES ('21600000660', 'notification channel')"); })
  .then(function () { return req('POST', '/api/r/inboxes?project=auto-a', { provider: 'evolution', instance: 'auto-a', display_name: 'Auto A main', account_ref: '21600000001' }, 'own'); })
  .then(function (x) { ok(x.status === 201, 'inbox A1 created (' + x.status + ')'); ids.a1 = x.data.row.id; return req('POST', '/api/r/inboxes?project=auto-a', { provider: 'evolution', instance: 'auto-a-2', display_name: 'Auto A second', account_ref: '21600000002' }, 'own'); })
  .then(function (x) { ok(x.status === 201, 'inbox A2 created'); ids.a2 = x.data.row.id; return req('POST', '/api/r/inboxes?project=dar-hijama', { provider: 'evolution', instance: 'dar-hijama', display_name: 'Dar Hijama', account_ref: '21600000003' }, 'own'); })
  .then(function (x) { ok(x.status === 201, 'inbox B1 created'); ids.b1 = x.data.row.id; return req('POST', '/api/r/inboxes?project=dar-hijama', { provider: 'evolution', instance: 'dar-hijama-2', display_name: 'Shared', account_ref: '21600000001' }, 'own'); })
  .then(function (x) { ok(x.status === 409 && /wp_inboxes_account_uidx/.test(x.body.constraint || ''), 'shared account refused (' + x.status + ' ' + (x.body.constraint || '') + ')'); return req('POST', '/api/r/inboxes?project=mythos-prod', { provider: 'evolution', instance: 'mythos-prod', display_name: 'Internal', account_ref: '21600000001', settings: { allow_personal_account: true } }, 'own'); })
  .then(function (x) { ok(x.status === 201, 'shared account allowed with allow_personal_account opt-in (' + x.status + ')'); ids.internal = x.data.row.id; return req('POST', '/api/r/inboxes?project=mythos-prod', { provider: 'evolution', instance: 'mythos-prod-2', display_name: 'Bad', account_ref: '21600000660', settings: { allow_personal_account: true } }, 'own'); })
  .then(function (x) { ok(x.status === 400 && /wp_inboxes_account_reserved/.test(x.body.constraint || ''), 'reserved (notification) account refused even with opt-in (' + x.status + ' ' + (x.body.constraint || '') + ')'); return req('PATCH', '/api/r/inboxes/' + ids.b1 + '?project=dar-hijama', { account_ref: '21600000660' }, 'own'); })
  .then(function (x) { ok(x.status === 400, 'cannot move an inbox onto the reserved account (' + x.status + ')'); return req('POST', '/api/r/inboxes?project=mythos-prod', { provider: 'evolution', instance: 'mythos-bridge', display_name: 'x' }, 'own'); })
  .then(function (x) { ok(x.status === 400, 'mythos-bridge refused as instance by the resource'); return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name) VALUES ('mythos-prod','evolution','mythos-bridge','x')").then(function () { ok(false, 'db must refuse mythos-bridge'); }, function (e) { ok(/not_bridge/.test(e.message), 'db CHECK refuses mythos-bridge'); }); })
  .then(function () { return req('POST', '/api/r/inboxes?project=dar-hijama', { provider: 'evolution', instance: 'dar-hijama-3', display_name: 'x', settings: { ai_suggest: 'yes' } }, 'own'); })
  .then(function (x) { ok(x.status === 400, 'settings keys validated as booleans'); return req('POST', '/api/r/inboxes?project=dar-hijama', { provider: 'evolution', instance: 'dar-hijama-3', display_name: 'x', account_ref: 'abc' }, 'own'); })
  .then(function (x) { ok(x.status === 400, 'account_ref must be digits'); return req('POST', '/api/r/inboxes?project=dar-hijama', { provider: 'evolution', instance: 'x', display_name: 'x' }, 'op'); })
  .then(function (x) { ok(x.status === 403, 'operators cannot create inboxes'); })
  // ---- data isolation
  .then(function () { return q('SELECT * FROM wp_inboxes WHERE id = ANY($1::bigint[])', [[ids.a1, ids.a2, ids.b1]]); })
  .then(function (r) { var by = {}; r.rows.forEach(function (x) { by[x.id] = x; }); ids.rowA1 = by[ids.a1]; ids.rowA2 = by[ids.a2]; ids.rowB1 = by[ids.b1]; return q('UPDATE wp_inboxes SET inbound_enabled = true WHERE id = ANY($1::bigint[])', [[ids.a1, ids.a2, ids.b1]]); })
  .then(function () { return core.ingest(pool, ids.rowA1, inbound('auto-a', 'A1M1', 'Bonjour A1', '21699000001', 'Karim')); })
  .then(function (r) { ids.convA1 = r.conversation_id; ids.contactA = r.contact_id; return core.ingest(pool, ids.rowA2, inbound('auto-a-2', 'A2M1', 'Bonjour A2', '21699000001', 'Karim')); })
  .then(function (r) { ids.convA2 = r.conversation_id; ok(r.contact_id === ids.contactA && r.conversation_id !== ids.convA1, 'same customer on two inboxes of one project = one contact, two conversations'); return core.ingest(pool, ids.rowB1, inbound('dar-hijama', 'B1M1', 'Salam', '21699000001', 'Karim')); })
  .then(function (r) { ids.convB1 = r.conversation_id; ok(r.contact_id !== ids.contactA, 'same customer on another project = separate contact'); return req('GET', '/api/projects/auto-a/comms/conversations', undefined, 'op'); })
  .then(function (x) { ok(x.status === 200 && x.data.items.length === 2 && x.data.scoped === false, 'unscoped operator sees both inboxes of project A'); return req('GET', '/api/projects/auto-a/comms/conversations?inbox=' + ids.a2, undefined, 'op'); })
  .then(function (x) { ok(x.data.items.length === 1 && x.data.items[0].id === ids.convA2, 'inbox filter'); return req('GET', '/api/projects/auto-a/comms/conversations/' + ids.convB1, undefined, 'op'); })
  .then(function (x) { ok(x.status === 404, 'project isolation: B conversation invisible through A'); return req('GET', '/api/projects/dar-hijama/comms/conversations', undefined, 'op'); })
  .then(function (x) { ok(x.data.items.length === 1 && x.data.items[0].id === ids.convB1, 'project B sees only its own'); })
  // ---- membership scope
  .then(function () { return req('POST', '/api/r/inbox_members', { inbox_id: ids.a2, username: 'agent1', role: 'agent' }, 'own'); })
  .then(function (x) { ok(x.status === 201 && x.data.row.added_by === 'own', 'membership created with added_by (' + x.status + ')'); return req('POST', '/api/r/inbox_members', { inbox_id: ids.a2, username: 'agent1', role: 'lead' }, 'own'); })
  .then(function (x) { ok(x.status === 409, 'duplicate membership refused'); return req('GET', '/api/comms/my-inboxes', undefined, 'agent1'); })
  .then(function (x) { ok(x.status === 200 && x.data.scoped === true && x.data.inboxes.length === 1 && x.data.inboxes[0].inbox_id === ids.a2, 'my-inboxes: scoped to A2'); return req('GET', '/api/comms/my-inboxes', undefined, 'op'); })
  .then(function (x) { ok(x.data.scoped === false, 'my-inboxes: operator without membership is unscoped'); return req('GET', '/api/projects/auto-a/comms/conversations', undefined, 'agent1'); })
  .then(function (x) { ok(x.status === 200 && x.data.scoped === true && x.data.items.length === 1 && x.data.items[0].id === ids.convA2 && x.data.counts.total === 1, 'member sees only A2 conversations'); return req('GET', '/api/projects/auto-a/comms/conversations/' + ids.convA1, undefined, 'agent1'); })
  .then(function (x) { ok(x.status === 404, 'member cannot open an A1 conversation'); return req('GET', '/api/projects/auto-a/comms/conversations/' + ids.convA1 + '/messages', undefined, 'agent1'); })
  .then(function (x) { ok(x.status === 404, 'member cannot read A1 messages'); return req('GET', '/api/projects/auto-a/comms/contacts', undefined, 'agent1'); })
  .then(function (x) { ok(x.status === 200 && x.data.items.length === 1, 'member sees contacts through A2 only (' + x.data.items.length + ')'); return req('GET', '/api/projects/dar-hijama/comms/conversations', undefined, 'agent1'); })
  .then(function (x) { ok(x.data.items.length === 0, 'member sees nothing in project B'); })
  // ---- assistant on a service project (no catalogue) never fabricates
  .then(function () { return store.resolve('dar-hijama'); })
  .then(function (resolved) { ok(resolved && resolved.catalogPool === null, 'service project resolves without a catalogue pool'); return assistant.suggest(pool, resolved, ids.convB1, 'op', {}); })
  .then(function (out) { ok(out && out.decision !== undefined && (!out.facts || !out.facts.verified || out.facts.verified.length === 0), 'assistant on a service project: no verified catalogue facts claimed (decision ' + out.decision + ')'); ok(!(out.suggestion && /\d{2,}/.test(out.suggestion.text)), 'no fabricated numbers'); })
  .then(function () { return new Promise(function (resolve) { server.close(resolve); }); })
  .then(wipe).then(function () { return pool.end(); }).then(function () { finish(); })
  .catch(function (e) { console.error('ERROR: ' + (e && e.stack || e)); failed++; pool.end().catch(function () {}); finish(1); });
