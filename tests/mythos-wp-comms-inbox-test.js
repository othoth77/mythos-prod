'use strict';
// =====================================================
// MYTHOS WP — Inbox / Contacts API + SSE tests (MYTHOS-COMMS-4, #207)
// tests/mythos-wp-comms-inbox-test.js  (needs MYTHOS_WP_TEST_DB_URL)
// Loopback server, operator session. Seeds two projects through the real
// Core ingest, then: list (masking, counts, filters, search), detail,
// timeline, mark read, status/assignee/priority patch + audit + event, notes
// (activity rows, never sent), tags (create, attach, detach, filter),
// contacts (list masked, record full number, patch, tags), project
// isolation (other project's ids → 404), auth (401), SSE feed receives
// message.in for an ingest and nothing for the other project.
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
function finish(code) { console.log('mythos-wp-comms-inbox: ' + passed + ' passed, ' + failed + ' failed'); process.exit(code !== undefined ? code : (failed ? 1 : 0)); }
if (!TEST_URL) { console.error('MYTHOS_WP_TEST_DB_URL not set'); finish(process.env.MYTHOS_WP_ALLOW_SKIP === '1' ? 0 : 3); }
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-inbox-'));
process.env.MYTHOS_WP_USERS_FILE = path.join(tmp, 'users.json');
process.env.MYTHOS_WP_INSECURE_COOKIE = '1';
delete process.env.MYTHOS_WP_RECEIVER_ENABLED; delete process.env.MYTHOS_WP_WEBHOOK_TOKEN_FILE; delete process.env.MYTHOS_WP_COMMS_CONFIG;
var u = new URL(TEST_URL); process.env.MYTHOS_WP_DB_HOST = u.hostname; process.env.MYTHOS_WP_DB_PORT = u.port || '5432'; process.env.MYTHOS_WP_DB_USER = decodeURIComponent(u.username); process.env.MYTHOS_WP_DB_PASSWORD = decodeURIComponent(u.password); process.env.MYTHOS_WP_DB_NAME = u.pathname.slice(1);
var auth = require(path.join(WP, 'reference/auth'));
var migrate = require(path.join(WP, 'reference/migrate'));
var db = require(path.join(WP, 'reference/db'));
var core = require(path.join(WP, 'reference/comms/core'));
var bus = require(path.join(WP, 'reference/comms/bus'));
var provider = require(path.join(WP, 'reference/comms/providers/evolution'));
var pool = db.wp();
fs.writeFileSync(process.env.MYTHOS_WP_USERS_FILE, JSON.stringify({ users: [{ username: 'op', role: 'operator', scrypt: auth.hashPassword('operator-password-1') }] }), { mode: 0o600 });
var server = require(path.join(WP, 'reference/server')).createServer();
var PORT = 0, COOKIE = '';
function req(method, p, body) {
  return new Promise(function (resolve, reject) {
    var data = body !== undefined ? JSON.stringify(body) : null;
    var h = { 'Content-Type': 'application/json', 'X-Requested-With': 'MythosWP' }; if (data) h['Content-Length'] = Buffer.byteLength(data); if (COOKIE) h.Cookie = COOKIE;
    var rq = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: h, agent: false }, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j, data: j && j.data, cookie: (res.headers['set-cookie'] || [''])[0].split(';')[0] }); }); });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}
function q(sql, p) { return pool.query(sql, p || []); }
function msg(instance, id, text, from, name) { return provider.parseInbound({ event: 'messages.upsert', instance: instance, sender: '21600000000@s.whatsapp.net', data: { key: { remoteJid: (from || '21699000001') + '@s.whatsapp.net', fromMe: false, id: id }, pushName: name || 'Client Un', message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) } }).event; }
var ids = {}, inboxA, inboxB;
function wipe(pid) {
  return q("DELETE FROM wp_inbound_events WHERE inbox_id IN (SELECT id FROM wp_inboxes WHERE project_id=$1)", [pid])
    .then(function () { return q("DELETE FROM wp_message_attachments WHERE message_id IN (SELECT id FROM wp_messages WHERE project_id=$1)", [pid]); })
    .then(function () { return q("DELETE FROM wp_conversation_events WHERE project_id=$1", [pid]); })
    .then(function () { return q("UPDATE wp_messages SET ai_run_id = NULL WHERE project_id=$1 AND ai_run_id IS NOT NULL", [pid]); })
    .then(function () { return q("DELETE FROM wp_ai_suggestions WHERE conversation_id IN (SELECT id FROM wp_conversations WHERE project_id=$1)", [pid]); })
    .then(function () { return q("DELETE FROM wp_ai_runs WHERE project_id=$1", [pid]); })
    .then(function () { return q("DELETE FROM wp_messages WHERE project_id=$1", [pid]); })
    .then(function () { return q("DELETE FROM wp_handoffs WHERE project_id=$1", [pid]); })
    .then(function () { return q("DELETE FROM wp_conversation_tags WHERE conversation_id IN (SELECT id FROM wp_conversations WHERE project_id=$1)", [pid]); })
    .then(function () { return q("DELETE FROM wp_conversations WHERE project_id=$1", [pid]); })
    .then(function () { return q("DELETE FROM wp_contact_tags WHERE contact_id IN (SELECT id FROM wp_contacts WHERE project_id=$1)", [pid]); })
    .then(function () { return q("DELETE FROM wp_contacts WHERE project_id=$1", [pid]); })
    .then(function () { return q("DELETE FROM wp_tags WHERE project_id=$1", [pid]); })
    .then(function () { return q("DELETE FROM wp_audit_events WHERE project_id=$1", [pid]); })
    .then(function () { return q("DELETE FROM wp_inboxes WHERE project_id=$1", [pid]); })
    .then(function () { return q("DELETE FROM wp_projects WHERE id=$1", [pid]); });
}
migrate.up(pool)
  .then(function () { return wipe('comms-test').then(function () { return wipe('comms-other'); }); })
  .then(function () { return q("INSERT INTO wp_projects (id, display_name, catalog_dsn_env) VALUES ('comms-test','Comms test','MYTHOS_WP_CATALOG_TEST'), ('comms-other','Other','MYTHOS_WP_CATALOG_TEST')"); })
  .then(function () { return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, inbound_enabled) VALUES ('comms-test','evolution','comms-test-inbox','A', true) RETURNING *"); })
  .then(function (r) { inboxA = r.rows[0]; return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, inbound_enabled) VALUES ('comms-other','evolution','comms-other-inbox','B', true) RETURNING *"); })
  .then(function (r) { inboxB = r.rows[0]; return core.ingest(pool, inboxA, msg('comms-test-inbox', 'M1', 'Bonjour, prix du filtre à huile ?')); })
  .then(function (r) { ids.conv = r.conversation_id; ids.contact = r.contact_id; return core.ingest(pool, inboxA, msg('comms-test-inbox', 'M2', 'Et la disponibilité ?')); })
  .then(function () { return core.ingest(pool, inboxA, msg('comms-test-inbox', 'M3', 'Salut', '21699000002', 'Client Deux')); })
  .then(function (r) { ids.conv2 = r.conversation_id; return core.ingest(pool, inboxB, msg('comms-other-inbox', 'O1', 'other project', '21699000003', 'Autre')); })
  .then(function (r) { ids.otherConv = r.conversation_id; ids.otherContact = r.contact_id; return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { PORT = server.address().port; resolve(); }); }); })
  .then(function () { return req('GET', '/api/projects/comms-test/comms/conversations'); })
  .then(function (x) { ok(x.status === 401, 'conversations require a session'); return req('POST', '/api/login', { username: 'op', password: 'operator-password-1' }); })
  .then(function (x) { ok(x.status === 200, 'login'); COOKIE = x.cookie; return req('GET', '/api/projects/comms-test/comms/conversations'); })
  .then(function (x) {
    ok(x.status === 200 && x.data.items.length === 2, 'list: two live conversations');
    var top = x.data.items[0];
    ok(top.contact_masked === '***002' && top.contact_wa_id === undefined, 'list masks the number');
    ok(x.data.counts.total === 2 && x.data.counts.unread === 3, 'counts: total 2, unread 3');
    ok(x.data.items.every(function (c) { return c.last_text; }), 'last message preview present');
    return req('GET', '/api/projects/comms-test/comms/conversations?q=filtre');
  })
  .then(function (x) { ok(x.status === 200 && x.data.items.length === 1 && x.data.items[0].id === ids.conv, 'search by summary/name/number finds… (name/number only) → ' + x.data.items.length); return req('GET', '/api/projects/comms-test/comms/conversations?q=Deux'); })
  .then(function (x) { ok(x.data.items.length === 1 && x.data.items[0].id === ids.conv2, 'search by contact name'); return req('GET', '/api/projects/comms-test/comms/conversations/' + ids.conv); })
  .then(function (x) { ok(x.status === 200 && x.data.contact_wa_id === '21699000001' && x.data.contact_masked === '***001' && x.data.unread_count === 2, 'detail carries full number, masked form and unread'); return req('GET', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/messages'); })
  .then(function (x) { ok(x.status === 200 && x.data.items.length === 2 && x.data.items[0].text.indexOf('Bonjour') === 0 && x.data.items[1].direction === 'in', 'timeline in order'); return req('POST', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/read', {}); })
  .then(function (x) { ok(x.status === 200 && x.data.unread_count === 0, 'mark read'); return req('PATCH', '/api/projects/comms-test/comms/conversations/' + ids.conv, { status: 'needs_human', assigned_to: 'op', priority: 2 }); })
  .then(function (x) { ok(x.status === 200 && x.data.status === 'needs_human' && x.data.assigned_to === 'op' && x.data.priority === 2, 'patch status/assignee/priority'); return q("SELECT count(*)::int AS n FROM wp_conversation_events WHERE conversation_id=$1 AND kind='status'", [ids.conv]); })
  .then(function (r) { ok(r.rows[0].n === 1, 'status change journaled'); return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE resource='conversations' AND record_id=$1", [String(ids.conv)]); })
  .then(function (r) { ok(r.rows[0].n === 1, 'patch audited'); return req('PATCH', '/api/projects/comms-test/comms/conversations/' + ids.conv, { status: 'nope' }); })
  .then(function (x) { ok(x.status === 400, 'unknown status refused'); return req('GET', '/api/projects/comms-test/comms/conversations?assigned=me'); })
  .then(function (x) { ok(x.data.items.length === 1 && x.data.items[0].id === ids.conv, 'filter assigned=me'); return req('GET', '/api/projects/comms-test/comms/conversations?status=needs_human'); })
  .then(function (x) { ok(x.data.items.length === 1, 'filter status'); return req('POST', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/notes', { text: 'Client fidèle, rappeler demain' }); })
  .then(function (x) { ok(x.status === 201 && x.data.id, 'note added'); return q("SELECT direction, sender_kind, status FROM wp_messages WHERE id=$1", [x.data.id]); })
  .then(function (r) { ok(r.rows[0].direction === 'activity' && r.rows[0].sender_kind === 'user', 'note is an activity row (never sent)'); return req('POST', '/api/projects/comms-test/comms/tags', { name: 'VIP', color: '#ff0000' }); })
  .then(function (x) { ok(x.status === 201 && x.data.name === 'vip', 'tag created (lower-cased)'); ids.tag = x.data.id; return req('POST', '/api/projects/comms-test/comms/tags', { name: 'bad tag!' }); })
  .then(function (x) { ok(x.status === 400, 'bad tag name refused'); return req('POST', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/tags/' + ids.tag, {}); })
  .then(function (x) { ok(x.status === 200 && x.data.tag === 'vip', 'tag attached'); return req('GET', '/api/projects/comms-test/comms/conversations?tag=vip&status='); })
  .then(function (x) { ok(x.data.items.length === 1 && x.data.items[0].tags[0] === 'vip', 'filter by tag'); return req('DELETE', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/tags/' + ids.tag); })
  .then(function (x) { ok(x.status === 200 && x.data.removed === true, 'tag detached'); return req('GET', '/api/projects/comms-test/comms/contacts'); })
  .then(function (x) { ok(x.status === 200 && x.data.items.length === 2 && x.data.items.every(function (k) { return k.wa_id === undefined && /^\*\*\*\d{3}$/.test(k.wa_masked); }), 'contacts list masked'); return req('GET', '/api/projects/comms-test/comms/contacts/' + ids.contact); })
  .then(function (x) { ok(x.status === 200 && x.data.wa_id === '21699000001' && x.data.conversations.length === 1, 'contact record: full number + conversations'); return req('PATCH', '/api/projects/comms-test/comms/contacts/' + ids.contact, { display_name: 'Ahmed B.', language: 'fr', notes: 'garage à Sfax' }); })
  .then(function (x) { ok(x.status === 200 && x.data.display_name === 'Ahmed B.' && x.data.language === 'fr', 'contact patched'); return req('PATCH', '/api/projects/comms-test/comms/contacts/' + ids.contact, { language: 'de' }); })
  .then(function (x) { ok(x.status === 400, 'bad language refused'); return req('POST', '/api/projects/comms-test/comms/contacts/' + ids.contact + '/tags/' + ids.tag, {}); })
  .then(function (x) { ok(x.status === 200, 'contact tagged'); return req('GET', '/api/projects/comms-test/comms/contacts?tag=vip'); })
  .then(function (x) { ok(x.data.items.length === 1 && x.data.items[0].display_name === 'Ahmed B.', 'contacts filter by tag'); })
  // isolation
  .then(function () { return req('GET', '/api/projects/comms-test/comms/conversations/' + ids.otherConv); })
  .then(function (x) { ok(x.status === 404, 'other project conversation invisible (404)'); return req('GET', '/api/projects/comms-test/comms/contacts/' + ids.otherContact); })
  .then(function (x) { ok(x.status === 404, 'other project contact invisible'); return req('PATCH', '/api/projects/comms-test/comms/conversations/' + ids.otherConv, { status: 'resolved' }); })
  .then(function (x) { ok(x.status === 404, 'cannot mutate other project conversation'); return req('GET', '/api/projects/comms-other/comms/conversations'); })
  .then(function (x) { ok(x.data.items.length === 1 && x.data.items[0].id === ids.otherConv, 'other project sees only its own'); })
  // SSE
  .then(function () {
    return new Promise(function (resolve, reject) {
      var got = [];
      var rq = http.request({ host: '127.0.0.1', port: PORT, path: '/api/projects/comms-test/comms/events', method: 'GET', headers: { Cookie: COOKIE, Accept: 'text/event-stream' }, agent: false }, function (res) {
        ok(res.statusCode === 200 && /text\/event-stream/.test(res.headers['content-type']), 'SSE stream opens');
        res.on('data', function (c) { got.push(String(c)); var all = got.join(''); if (all.indexOf('event: message.in') !== -1) { rq.destroy(); resolve(all); } });
        setTimeout(function () {
          core.ingest(pool, inboxB, msg('comms-other-inbox', 'O2', 'noise', '21699000003')).then(function () { return core.ingest(pool, inboxA, msg('comms-test-inbox', 'M4', 'Encore', '21699000001')); });
        }, 100);
        setTimeout(function () { rq.destroy(); resolve(got.join('')); }, 4000);
      });
      rq.on('error', function () { resolve(got.join('')); });
      rq.end();
    });
  })
  .then(function (all) {
    ok(all.indexOf('event: message.in') !== -1, 'SSE delivered message.in for this project');
    ok(all.indexOf('comms-other') === -1, 'SSE did not leak the other project');
    ok(all.indexOf('Encore') === -1 && all.indexOf('noise') === -1, 'SSE carries no message text');
  })
  .then(function () { return new Promise(function (resolve) { server.close(resolve); }); })
  .then(function () { return wipe('comms-test').then(function () { return wipe('comms-other'); }); })
  .then(function () { return pool.end(); })
  .then(function () { finish(); })
  .catch(function (e) { console.error('ERROR: ' + (e && e.stack || e)); failed++; pool.end().catch(function () {}); finish(1); });
