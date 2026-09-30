'use strict';
// =====================================================
// MYTHOS WP — final closure regressions (2026-09-29)  needs MYTHOS_WP_TEST_DB_URL
// 1. Inbox-membership fence on the routes that skipped it: AI suggest,
//    suggestions list, suggestion decide, manual auto-reply, contact edit,
//    contact tags, Contacts 360 (list, key and digits forms). A member of one
//    inbox gets 404 and nothing changes; an unscoped operator (control) works.
// 2. Phone-digit lookup of a 360 page is admin-only (no lookup oracle below
//    admin; those callers use the opaque '<project>:<id>' key).
// 3. AI `off` means no run, manual ones included: number link ai_mode off,
//    project settings.ai_mode off, a HOLDING inbox (the admin-only
//    'unassigned' project) → 412 + ai.refused event, no wp_ai_runs row.
// 4. The audit trail records the client address nginx forwards (X-Real-IP,
//    trusted only from loopback), not the proxy's own 127.0.0.1.
// 5. `mythos-wp users remove` (users.remove): grants + memberships go, the
//    removal is audited, the last active owner is never removed.
// 6. SSRF: integration URLs / probes never reach link-local (cloud metadata),
//    unspecified addresses, literal or through DNS.
// 7. /api/login passes the CSRF check like every other mutation.
// 8. A conversation opened in a HOLDING inbox or on a link whose AI is off
//    starts with handler 'human' (it waits for a person, it is not "AI").
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
function finish(code) { console.log('mythos-wp-final-closure: ' + passed + ' passed, ' + failed + ' failed'); process.exit(code !== undefined ? code : (failed ? 1 : 0)); }
if (!TEST_URL) { console.error('MYTHOS_WP_TEST_DB_URL not set'); finish(process.env.MYTHOS_WP_ALLOW_SKIP === '1' ? 0 : 3); }
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-fc-'));
process.env.MYTHOS_WP_USERS_FILE = path.join(tmp, 'users.json'); process.env.MYTHOS_WP_INSECURE_COOKIE = '1';
delete process.env.MYTHOS_WP_COMMS_CONFIG; delete process.env.MYTHOS_WP_RECEIVER_ENABLED;
var u = new URL(TEST_URL); process.env.MYTHOS_WP_DB_HOST = u.hostname; process.env.MYTHOS_WP_DB_PORT = u.port || '5432'; process.env.MYTHOS_WP_DB_USER = decodeURIComponent(u.username); process.env.MYTHOS_WP_DB_PASSWORD = decodeURIComponent(u.password); process.env.MYTHOS_WP_DB_NAME = u.pathname.slice(1);
var auth = require(path.join(WP, 'reference/auth'));
var migrate = require(path.join(WP, 'reference/migrate'));
var db = require(path.join(WP, 'reference/db'));
var store = require(path.join(WP, 'reference/projects-store'));
var core = require(path.join(WP, 'reference/comms/core'));
var providerMod = require(path.join(WP, 'reference/comms/providers/evolution'));
var users = require(path.join(WP, 'reference/users'));
var integrations = require(path.join(WP, 'reference/integrations'));
var routing = require(path.join(WP, 'reference/comms/routing'));
var pool = db.wp();
fs.writeFileSync(process.env.MYTHOS_WP_USERS_FILE, JSON.stringify({ users: [{ username: 'own', role: 'owner', scrypt: auth.hashPassword('owner-password-1') }, { username: 'op', role: 'operator', scrypt: auth.hashPassword('operator-password-1') }, { username: 'member1', role: 'operator', scrypt: auth.hashPassword('member-password-1') }, { username: 'viewer1', role: 'viewer', scrypt: auth.hashPassword('viewer-password-1') }] }), { mode: 0o600 });
var server = require(path.join(WP, 'reference/server')).createServer();
var PORT = 0, C = {};
function req(method, p, body, who, extra) {
  return new Promise(function (resolve, reject) {
    var data = body !== undefined ? JSON.stringify(body) : null;
    var h = { 'Content-Type': 'application/json', 'X-Requested-With': 'MythosWP' }; if (data) h['Content-Length'] = Buffer.byteLength(data); if (who && C[who]) h.Cookie = C[who];
    Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
    var rq = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: h, agent: false }, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j || {}, data: j && j.data !== undefined ? j.data : j, cookie: (res.headers['set-cookie'] || []).map(function (c) { return c.split(';')[0]; }).join('; ') }); }); });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}
function q(sql, p) { return pool.query(sql, p || []); }
function inbound(instance, id, text, from, name) { return providerMod.parseInbound({ event: 'messages.upsert', instance: instance, sender: '21600000000@s.whatsapp.net', data: { key: { remoteJid: from + '@s.whatsapp.net', fromMe: false, id: id }, pushName: name || 'Client', message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) } }).event; }
function wipe() {
  var steps = ["UPDATE wp_messages SET ai_run_id = NULL", "DELETE FROM wp_inbound_events", "DELETE FROM wp_message_attachments", "DELETE FROM wp_conversation_events", "DELETE FROM wp_ai_suggestions", "DELETE FROM wp_ai_runs", "DELETE FROM wp_messages", "DELETE FROM wp_handoffs", "DELETE FROM wp_conversation_tags", "DELETE FROM wp_conversations", "DELETE FROM wp_contact_tags", "DELETE FROM wp_contacts", "DELETE FROM wp_tags", "DELETE FROM wp_inbox_members", "DELETE FROM wp_audit_events", "DELETE FROM wp_inboxes", "DELETE FROM wp_reserved_accounts", "DELETE FROM wp_knowledge", "DELETE FROM wp_business_rules", "DELETE FROM wp_stock", "DELETE FROM wp_product_commercial", "DELETE FROM wp_projects"];
  var chain = Promise.resolve(); steps.forEach(function (s) { chain = chain.then(function () { return q(s); }); }); return chain;
}
function login(name, pw) { return req('POST', '/api/login', { username: name, password: pw }).then(function (x) { C[name] = x.cookie; return x; }); }
function settle(v) { return new Promise(function (resolve) { setTimeout(function () { resolve(v); }, 200); }); } // audit.record is fire-and-forget
function runs(convId) { return q('SELECT count(*)::int AS n FROM wp_ai_runs WHERE conversation_id = $1', [convId]).then(function (r) { return r.rows[0].n; }); }
var ids = {};
var B = '/api/projects/svc-a/comms';
migrate.up(pool).then(wipe)
  .then(function () { return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { PORT = server.address().port; resolve(); }); }); })
  .then(function () { return login('own', 'owner-password-1'); })
  .then(function () { return login('op', 'operator-password-1'); })
  .then(function () { return login('member1', 'member-password-1'); })
  .then(function () { return login('viewer1', 'viewer-password-1'); })
  // ---- fixtures: one service project, two inboxes, a customer on each, one customer on both
  .then(function () { return req('POST', '/api/r/projects', { id: 'svc-a', display_name: 'Service A', kind: 'service', status: 'active', currency: 'TND' }, 'own'); })
  .then(function (x) { ok(x.status === 201, 'project created (' + x.status + ')'); store.invalidate(); return req('POST', '/api/r/inboxes?project=svc-a', { provider: 'evolution', instance: 'svc-a-1', display_name: 'A1', account_ref: '21600000011' }, 'own'); })
  .then(function (x) { ids.i1 = x.data.row.id; return req('POST', '/api/r/inboxes?project=svc-a', { provider: 'evolution', instance: 'svc-a-2', display_name: 'A2', account_ref: '21600000012' }, 'own'); })
  .then(function (x) { ids.i2 = x.data.row.id; return q('UPDATE wp_inboxes SET inbound_enabled = true WHERE id = ANY($1::bigint[])', [[ids.i1, ids.i2]]); })
  .then(function () { return q('SELECT * FROM wp_inboxes WHERE id = ANY($1::bigint[]) ORDER BY id', [[ids.i1, ids.i2]]); })
  .then(function (r) { ids.row1 = r.rows[0]; ids.row2 = r.rows[1]; return core.ingest(pool, ids.row1, inbound('svc-a-1', 'FC1', 'Bonjour, un rendez-vous ?', '21699100001', 'Only-A1')); })
  .then(function (r) { ids.conv1 = r.conversation_id; ids.contact1 = r.contact_id; return core.ingest(pool, ids.row2, inbound('svc-a-2', 'FC2', 'Bonjour A2', '21699100002', 'Only-A2')); })
  .then(function (r) { ids.conv2 = r.conversation_id; ids.contact2 = r.contact_id; return q("INSERT INTO wp_tags (project_id, name) VALUES ('svc-a', 'vip') RETURNING id"); })
  .then(function (r) { ids.tag = r.rows[0].id; return req('POST', '/api/r/inbox_members', { inbox_id: ids.i2, username: 'member1', role: 'agent' }, 'own'); })
  .then(function (x) { ok(x.status === 201, 'member1 is a member of inbox A2 only (' + x.status + ')'); return req('POST', B + '/conversations/' + ids.conv1 + '/suggest', {}, 'own'); })
  .then(function (x) { ok(x.status === 201 && x.data.suggestion, 'control: the owner gets a suggestion on A1 (' + x.status + ')'); ids.sug1 = x.data.suggestion && x.data.suggestion.id; return runs(ids.conv1); })
  // ---- 1. the membership fence on the assistant routes
  .then(function (n) { ids.runs1 = n; return req('POST', B + '/conversations/' + ids.conv1 + '/suggest', {}, 'member1'); })
  .then(function (x) { ok(x.status === 404, 'member cannot run the AI on an A1 conversation (' + x.status + ')'); return runs(ids.conv1); })
  .then(function (n) { ok(n === ids.runs1, 'the refused run left no wp_ai_runs row'); return req('GET', B + '/conversations/' + ids.conv1 + '/suggestions', undefined, 'member1'); })
  .then(function (x) { ok(x.status === 404, 'member cannot list A1 suggestions (' + x.status + ')'); return req('POST', B + '/conversations/' + ids.conv1 + '/suggestions/' + ids.sug1 + '/decide', { action: 'reject' }, 'member1'); })
  .then(function (x) { ok(x.status === 404, 'member cannot decide an A1 suggestion (' + x.status + ')'); return q('SELECT status FROM wp_ai_suggestions WHERE id = $1', [ids.sug1]); })
  .then(function (r) { ok(r.rows[0].status === 'proposed', 'the refused decision changed nothing'); return req('POST', B + '/conversations/' + ids.conv1 + '/auto-reply', {}, 'member1'); })
  .then(function (x) { ok(x.status === 404, 'member cannot trigger auto-reply on A1 (' + x.status + ')'); return req('GET', B + '/conversations/' + ids.conv2 + '/suggestions', undefined, 'member1'); })
  .then(function (x) { ok(x.status === 200, 'member still reads suggestions of their own inbox (' + x.status + ')'); return req('GET', B + '/conversations/' + ids.conv1 + '/suggestions', undefined, 'op'); })
  .then(function (x) { ok(x.status === 200 && (x.data.items || x.data).length >= 1, 'control: an unscoped operator lists A1 suggestions (' + x.status + ')'); })
  // ---- 1b. the membership fence on contact writes
  .then(function () { return req('PATCH', B + '/contacts/' + ids.contact1, { notes: 'not mine' }, 'member1'); })
  .then(function (x) { ok(x.status === 404, 'member cannot edit an A1-only contact (' + x.status + ')'); return q('SELECT notes FROM wp_contacts WHERE id = $1', [ids.contact1]); })
  .then(function (r) { ok(r.rows[0].notes === null, 'the refused edit changed nothing'); return req('POST', B + '/contacts/' + ids.contact1 + '/tags/' + ids.tag, {}, 'member1'); })
  .then(function (x) { ok(x.status === 404, 'member cannot tag an A1-only contact (' + x.status + ')'); return req('DELETE', B + '/contacts/' + ids.contact1 + '/tags/' + ids.tag, undefined, 'member1'); })
  .then(function (x) { ok(x.status === 404, 'member cannot untag an A1-only contact (' + x.status + ')'); return q('SELECT count(*)::int AS n FROM wp_contact_tags WHERE contact_id = $1', [ids.contact1]); })
  .then(function (r) { ok(r.rows[0].n === 0, 'no tag was written'); return req('PATCH', B + '/contacts/' + ids.contact2, { notes: 'mine' }, 'member1'); })
  .then(function (x) { ok(x.status === 200, 'member edits a contact of their own inbox (' + x.status + ')'); return req('POST', B + '/contacts/' + ids.contact2 + '/tags/' + ids.tag, {}, 'member1'); })
  .then(function (x) { ok(x.status === 200, 'member tags a contact of their own inbox (' + x.status + ')'); return req('PATCH', B + '/contacts/' + ids.contact1, { language: 'fr' }, 'op'); })
  .then(function (x) { ok(x.status === 200, 'control: an unscoped operator edits the A1 contact (' + x.status + ')'); })
  // ---- 1c. Contacts 360 under the membership fence
  .then(function () { return req('GET', '/api/contacts?project=all', undefined, 'member1'); })
  .then(function (x) { var names = (x.data.items || []).map(function (i) { return i.display_name; }); ok(x.status === 200 && names.indexOf('Only-A2') !== -1 && names.indexOf('Only-A1') === -1, 'member contact list shows A2 customers only (' + names.join(',') + ')'); return req('GET', '/api/contacts?project=svc-a', undefined, 'member1'); })
  .then(function (x) { var names = (x.data.items || []).map(function (i) { return i.display_name; }); ok(names.indexOf('Only-A1') === -1, 'member contact list filtered by project still hides A1 customers'); return req('GET', '/api/contacts/360/svc-a:' + ids.contact1, undefined, 'member1'); })
  .then(function (x) { ok(x.status === 404, 'member cannot open the 360 page of an A1-only customer (' + x.status + ')'); return req('GET', '/api/contacts/360/svc-a:' + ids.contact2, undefined, 'member1'); })
  .then(function (x) { ok(x.status === 200 && x.data.conversations.every(function (c) { return String(c.inbox_id) === String(ids.i2); }), 'member 360 of an A2 customer lists A2 conversations only (' + x.status + ')'); return req('GET', '/api/contacts?project=all', undefined, 'op'); })
  .then(function (x) { var names = (x.data.items || []).map(function (i) { return i.display_name; }); ok(names.indexOf('Only-A1') !== -1 && names.indexOf('Only-A2') !== -1, 'control: an unscoped operator lists both customers'); })
  // ---- 2. digit lookup is admin-only
  .then(function () { return req('GET', '/api/contacts/360/21699100002', undefined, 'op'); })
  .then(function (x) { ok(x.status === 404, 'a manager cannot look a customer up by phone digits (' + x.status + ')'); return req('GET', '/api/contacts/360/21699100002', undefined, 'viewer1'); })
  .then(function (x) { ok(x.status === 404, 'a viewer cannot look a customer up by phone digits (' + x.status + ')'); return req('GET', '/api/contacts/360/21699100099', undefined, 'op'); })
  .then(function (x) { ok(x.status === 404, 'known and unknown digits answer the same below admin (no oracle)'); return req('GET', '/api/contacts/360/21699100002', undefined, 'own'); })
  .then(function (x) { ok(x.status === 200 && x.data.phone === '21699100002', 'the owner still opens a 360 page by digits (' + x.status + ')'); return req('GET', '/api/contacts/360/svc-a:' + ids.contact2, undefined, 'op'); })
  .then(function (x) { ok(x.status === 200 && x.data.phone === undefined && /^\*\*\*/.test(x.data.phone_masked), 'a manager opens the same page by key, digits masked (' + x.status + ')'); })
  // ---- 3. AI off = no run, manual ones included
  .then(function () { return q("UPDATE wp_inboxes SET ai_mode = 'off' WHERE id = $1", [ids.i2]); })
  .then(function () { return runs(ids.conv2); })
  .then(function (n) { ids.runs2 = n; return req('POST', B + '/conversations/' + ids.conv2 + '/suggest', {}, 'own'); })
  .then(function (x) { ok(x.status === 412 && /INBOX_AI_OFF/.test(x.body.detail || ''), 'number link AI off → manual suggest refused 412 (' + x.status + ' ' + (x.body.detail || '') + ')'); return runs(ids.conv2); })
  .then(function (n) { ok(n === ids.runs2, 'no run recorded while AI is off'); return q("SELECT payload FROM wp_conversation_events WHERE conversation_id = $1 AND event_name = 'ai.refused' ORDER BY id DESC LIMIT 1", [ids.conv2]); })
  .then(function (r) { ok(r.rows[0] && r.rows[0].payload.reason === 'INBOX_AI_OFF', 'the refusal is journaled (ai.refused INBOX_AI_OFF)'); return q("UPDATE wp_inboxes SET ai_mode = 'inherit', settings = settings || '{\"holding\": true}'::jsonb WHERE id = $1", [ids.i2]); })
  .then(function () { return req('POST', B + '/conversations/' + ids.conv2 + '/suggest', {}, 'own'); })
  .then(function (x) { ok(x.status === 412 && /HOLDING_INBOX/.test(x.body.detail || ''), 'a HOLDING inbox never runs AI, even for the owner (' + x.status + ')'); return q("UPDATE wp_inboxes SET settings = settings - 'holding' WHERE id = $1", [ids.i2]); })
  .then(function () { return q("UPDATE wp_projects SET settings = COALESCE(settings, '{}'::jsonb) || '{\"ai_mode\": \"off\"}'::jsonb WHERE id = 'svc-a'"); })
  .then(function () { store.invalidate(); return req('POST', B + '/conversations/' + ids.conv2 + '/suggest', {}, 'own'); })
  .then(function (x) { ok(x.status === 412 && /PROJECT_AI_OFF/.test(x.body.detail || ''), 'Project → AI off → manual suggest refused (' + x.status + ')'); return runs(ids.conv2); })
  .then(function (n) { ok(n === ids.runs2, 'still no run'); return q("UPDATE wp_projects SET settings = settings - 'ai_mode' WHERE id = 'svc-a'"); })
  .then(function () { store.invalidate(); return req('POST', B + '/conversations/' + ids.conv2 + '/suggest', {}, 'own'); })
  .then(function (x) { ok(x.status === 201, 'AI back on → manual suggest runs again (' + x.status + ')'); return runs(ids.conv2); })
  .then(function (n) { ok(n === ids.runs2 + 1, 'exactly one run recorded once AI is back on'); })
  // ---- 4. audit client = forwarded address (trusted from loopback only)
  .then(function () { return req('POST', '/api/login', { username: 'op', password: 'operator-password-1' }, null, { 'X-Real-IP': '198.51.100.23' }); })
  .then(function (x) { C.op = x.cookie; return settle(); }).then(function () { return q("SELECT client FROM wp_audit_events WHERE action = 'login' AND actor = 'op' ORDER BY id DESC LIMIT 1"); })
  .then(function (r) { ok(r.rows[0] && r.rows[0].client === '198.51.100.23', 'login audit carries the forwarded client address (' + (r.rows[0] && r.rows[0].client) + ')'); return req('PATCH', B + '/contacts/' + ids.contact1, { language: 'ar' }, 'op', { 'X-Real-IP': '198.51.100.24' }); })
  .then(function (x) { ok(x.status === 200, 'contact edit ok'); return settle(); }).then(function () { return q("SELECT client FROM wp_audit_events WHERE resource = 'contacts' AND actor = 'op' ORDER BY id DESC LIMIT 1"); })
  .then(function (r) { ok(r.rows[0] && r.rows[0].client === '198.51.100.24', 'write audit carries the forwarded client address (' + (r.rows[0] && r.rows[0].client) + ')'); return req('POST', '/api/login', { username: 'op', password: 'operator-password-1' }, null, { 'X-Real-IP': 'not-an-ip; DROP' }); })
  .then(settle).then(function () { return q("SELECT client FROM wp_audit_events WHERE action = 'login' AND actor = 'op' ORDER BY id DESC LIMIT 1"); })
  .then(function (r) { ok(r.rows[0] && /^(127\.|::1|::ffff:127\.)/.test(r.rows[0].client), 'a malformed X-Real-IP is ignored (socket address kept: ' + (r.rows[0] && r.rows[0].client) + ')'); })
  // ---- 7. login passes the CSRF check (no cross-site login)
  .then(function () { return new Promise(function (resolve) { var data = JSON.stringify({ username: 'op', password: 'operator-password-1' }); var rq = http.request({ host: '127.0.0.1', port: PORT, path: '/api/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, agent: false }, function (res) { res.resume(); res.on('end', function () { resolve({ status: res.statusCode, cookie: res.headers['set-cookie'] }); }); }); rq.end(data); }); })
  .then(function (x) { ok(x.status === 403 && !x.cookie, 'login without the CSRF header is refused, no session issued (' + x.status + ')'); return req('POST', '/api/login', { username: 'op', password: 'operator-password-1' }, null, { Origin: 'https://evil.example' }); })
  .then(function (x) { ok(x.status === 403, 'cross-origin login refused (' + x.status + ')'); return req('POST', '/api/login', { username: 'op', password: 'operator-password-1' }); })
  .then(function (x) { ok(x.status === 200, 'same-origin login with the header works (' + x.status + ')'); C.op = x.cookie; })
  // ---- 6. SSRF guard
  .then(function () {
    ok(['169.254.169.254', '[fe80::1]', '0.0.0.0', '[::]', '::ffff:169.254.10.1'].every(integrations.forbiddenAddress), 'link-local / metadata / unspecified addresses are forbidden');
    ok(!['127.0.0.1', '10.1.2.3', 'wp.mythosprod.xyz'].some(integrations.forbiddenAddress), 'loopback, private and public names stay allowed');
    return integrations.httpProbe('https://169.254.169.254/latest/meta-data/');
  })
  .then(function (r) { ok(r.reached === false && r.reason === 'ADDRESS_FORBIDDEN', 'a probe of the metadata address is refused before any connection (' + r.reason + ')'); return req('POST', '/api/integrations', { key: 'fc-meta', kind: 'api', name: 'meta', base_url: 'https://169.254.169.254' }, 'own'); })
  .then(function (x) { ok(x.status === 400 && x.body.errors && /link-local/.test(x.body.errors.base_url || ''), 'an integration URL on the metadata address is refused (' + x.status + ')'); })
  // ---- 8. handler at creation
  .then(function () { return q("SELECT handler FROM wp_conversations WHERE id = $1", [ids.conv1]); })
  .then(function (r) { ok(r.rows[0].handler === 'ai', 'control: a normal link opens conversations with handler ai'); return q("UPDATE wp_inboxes SET ai_mode = 'off' WHERE id = $1", [ids.i1]); })
  .then(function () { return routing.resolve(pool, 'evolution', 'svc-a-1', inbound('svc-a-1', 'FC8a', 'Bonjour', '21699100081', 'Off-link')); })
  .then(function (d) { ok(d && d.routed && d.inbox && d.inbox.ai_mode === 'off', 'the routed inbox row carries ai_mode (receiver / replay path)'); return core.ingest(pool, d.inbox, inbound('svc-a-1', 'FC8a', 'Bonjour', '21699100081', 'Off-link'), { routed_by: d.mode }); })
  .then(function (r) { return q("SELECT handler FROM wp_conversations WHERE id = $1", [r.conversation_id]); })
  .then(function (r) { ok(r.rows[0].handler === 'human', 'AI off on the link → the conversation starts with a human'); return q("UPDATE wp_inboxes SET ai_mode = 'inherit', settings = settings || '{\"holding\": true}'::jsonb WHERE id = $1", [ids.i1]); })
  .then(function () { return q('SELECT * FROM wp_inboxes WHERE id = $1', [ids.i1]); })
  .then(function (r) { return core.ingest(pool, r.rows[0], inbound('svc-a-1', 'FC8b', 'Salam', '21699100082', 'Holding')); })
  .then(function (r) { return q("SELECT handler FROM wp_conversations WHERE id = $1", [r.conversation_id]); })
  .then(function (r) { ok(r.rows[0].handler === 'human', 'a HOLDING inbox opens conversations with a human handler'); return q("UPDATE wp_inboxes SET settings = settings - 'holding' WHERE id = $1", [ids.i1]); })
  // ---- 5. users.remove
  .then(function () { return q("DELETE FROM wp_users WHERE username LIKE 'fc-%'"); })
  .then(function () { return users.upsert(pool, { username: 'fc-temp', role: 'agent', password: 'temporary-password-1' }, 'test'); })
  .then(function () { return users.setProjects(pool, 'fc-temp', { add: ['svc-a'] }, 'test'); })
  .then(function () { return q("INSERT INTO wp_inbox_members (inbox_id, username, role, added_by) VALUES ($1, 'fc-temp', 'agent', 'test')", [ids.i1]); })
  .then(function () { return users.remove(pool, 'fc-temp', 'test'); })
  .then(function (out) { ok(out.removed === 1, 'users.remove removes the account'); return q("SELECT (SELECT count(*)::int FROM wp_users WHERE username = 'fc-temp') AS u, (SELECT count(*)::int FROM wp_user_projects WHERE username = 'fc-temp') AS g, (SELECT count(*)::int FROM wp_inbox_members WHERE username = 'fc-temp') AS m, (SELECT count(*)::int FROM wp_audit_events WHERE action = 'delete' AND resource = 'users' AND record_id = 'fc-temp') AS a"); })
  .then(function (r) { var x = r.rows[0]; ok(x.u === 0 && x.g === 0 && x.m === 0, 'grants and inbox memberships removed with it'); ok(x.a === 1, 'the removal is audited'); return users.remove(pool, 'fc-nobody', 'test'); })
  .then(function (out) { ok(out.removed === 0, 'removing an unknown account is a no-op'); return q("SELECT count(*)::int AS n FROM wp_users WHERE role = 'owner' AND status = 'active'"); })
  .then(function (r) { ids.owners = r.rows[0].n; return ids.owners === 0 ? users.upsert(pool, { username: 'fc-owner', role: 'owner', password: 'temporary-password-1' }, 'test') : null; })
  .then(function () { return q("SELECT username FROM wp_users WHERE role = 'owner' AND status = 'active'"); })
  .then(function (r) {
    if (r.rows.length !== 1) { ok(true, 'last-owner guard: skipped, the test DB holds ' + r.rows.length + ' owners'); return null; }
    return users.remove(pool, r.rows[0].username, 'test').then(function () { ok(false, 'the last active owner must not be removable'); }, function (e) { ok(e.status === 409, 'the last active owner is never removed (409)'); });
  })
  .then(function () { return q("DELETE FROM wp_users WHERE username LIKE 'fc-%'"); })
  .then(function () { return new Promise(function (resolve) { server.close(resolve); }); })
  .then(wipe).then(function () { return pool.end(); }).then(function () { finish(); })
  .catch(function (e) { console.error('ERROR: ' + (e && e.stack || e)); failed++; pool.end().catch(function () {}); finish(1); });
