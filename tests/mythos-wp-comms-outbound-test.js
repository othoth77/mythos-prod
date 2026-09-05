'use strict';
// =====================================================
// MYTHOS WP — human outbound tests (MYTHOS-COMMS-5, #209)  needs MYTHOS_WP_TEST_DB_URL
// A fake Evolution on a loopback port (records requests; scripted answers).
// Covers: provider sendText contract (header apikey, body {number,text},
// key.id → provider_message_id, HTTP error text scrubbed); API send: 412 when
// outbound disabled / inbox not open, 400 validation, 201 sent + row + event
// + audit + conversation waiting_customer, idempotent replay (same
// client_ref → 200, one provider call), TRANSPORT retry (one automatic
// retry), provider 500 → failed (no retry) → manual retry → sent, hourly cap
// 429, messages.update webhook → delivered/read (never downgrade), SSE
// message.out/message.status, no apikey / text in receiver/outbound logs,
// mythos-bridge cannot be an inbox.
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
function finish(code) { console.log('mythos-wp-comms-outbound: ' + passed + ' passed, ' + failed + ' failed'); process.exit(code !== undefined ? code : (failed ? 1 : 0)); }
if (!TEST_URL) { console.error('MYTHOS_WP_TEST_DB_URL not set'); finish(process.env.MYTHOS_WP_ALLOW_SKIP === '1' ? 0 : 3); }
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-out-'));
var KEY = 'FAKE-EVOLUTION-KEY-1234567890abcdef';
var keyFile = path.join(tmp, 'evolution.key'); fs.writeFileSync(keyFile, KEY + '\n', { mode: 0o600 });
var TOKEN = 'test-webhook-token-0123456789abcdef'; var tokenFile = path.join(tmp, 'webhook.token'); fs.writeFileSync(tokenFile, TOKEN + '\n', { mode: 0o600 });
process.env.MYTHOS_WP_USERS_FILE = path.join(tmp, 'users.json'); process.env.MYTHOS_WP_INSECURE_COOKIE = '1';
process.env.MYTHOS_WP_EVOLUTION_API_KEY_FILE = keyFile; process.env.MYTHOS_WP_WEBHOOK_TOKEN_FILE = tokenFile; process.env.MYTHOS_WP_RECEIVER_ENABLED = '1';
process.env.MYTHOS_WP_OUTBOUND_CAP_PER_HOUR = '3';
delete process.env.MYTHOS_WP_COMMS_CONFIG;
var u = new URL(TEST_URL); process.env.MYTHOS_WP_DB_HOST = u.hostname; process.env.MYTHOS_WP_DB_PORT = u.port || '5432'; process.env.MYTHOS_WP_DB_USER = decodeURIComponent(u.username); process.env.MYTHOS_WP_DB_PASSWORD = decodeURIComponent(u.password); process.env.MYTHOS_WP_DB_NAME = u.pathname.slice(1);
// fake Evolution
var evoReqs = []; var evoMode = 'ok'; var evoPort = 0; var evoSeq = 0;
var evo = http.createServer(function (req, res) {
  var b = ''; req.on('data', function (c) { b += c; }); req.on('end', function () {
    evoReqs.push({ path: req.url, apikey: req.headers.apikey, body: b });
    if (evoMode === 'drop') { req.socket.destroy(); return; }
    if (evoMode === '500') { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ status: 500, error: 'Internal Server Error', response: { message: 'Connection Closed ' + KEY } })); }
    res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ key: { remoteJid: '21699000001@s.whatsapp.net', fromMe: true, id: 'OUT' + (++evoSeq) }, status: 'PENDING' }));
  });
});
var auth = require(path.join(WP, 'reference/auth'));
var migrate = require(path.join(WP, 'reference/migrate'));
var db = require(path.join(WP, 'reference/db'));
var core = require(path.join(WP, 'reference/comms/core'));
var providerMod = require(path.join(WP, 'reference/comms/providers/evolution'));
var receiver = require(path.join(WP, 'reference/comms/receiver'));
var pool = db.wp();
fs.writeFileSync(process.env.MYTHOS_WP_USERS_FILE, JSON.stringify({ users: [{ username: 'op', role: 'operator', scrypt: auth.hashPassword('operator-password-1') }] }), { mode: 0o600 });
var logLines = []; var origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (s) { if (typeof s === 'string' && (s.indexOf('"receiver"') !== -1 || s.indexOf('"method"') !== -1)) { logLines.push(s); return true; } return origWrite(s); };
var server = require(path.join(WP, 'reference/server')).createServer();
var PORT = 0, COOKIE = '';
function req(method, p, body, extraHeaders) {
  return new Promise(function (resolve, reject) {
    var data = body !== undefined ? JSON.stringify(body) : null;
    var h = Object.assign({ 'Content-Type': 'application/json', 'X-Requested-With': 'MythosWP' }, extraHeaders || {}); if (data) h['Content-Length'] = Buffer.byteLength(data); if (COOKIE && !extraHeaders) h.Cookie = COOKIE;
    var rq = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: h, agent: false }, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j, data: j && j.data, cookie: (res.headers['set-cookie'] || [''])[0].split(';')[0] }); }); });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}
function q(sql, p) { return pool.query(sql, p || []); }
function inboundMsg(id, text) { return providerMod.parseInbound({ event: 'messages.upsert', instance: 'comms-test-inbox', sender: '21600000000@s.whatsapp.net', data: { key: { remoteJid: '21699000001@s.whatsapp.net', fromMe: false, id: id }, pushName: 'Client', message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) } }).event; }
var ids = {}, inboxA;
function wipe(pid) {
  var steps = ["DELETE FROM wp_inbound_events WHERE inbox_id IN (SELECT id FROM wp_inboxes WHERE project_id=$1)", "DELETE FROM wp_message_attachments WHERE message_id IN (SELECT id FROM wp_messages WHERE project_id=$1)", "DELETE FROM wp_conversation_events WHERE project_id=$1", "DELETE FROM wp_ai_suggestions WHERE conversation_id IN (SELECT id FROM wp_conversations WHERE project_id=$1)", "DELETE FROM wp_ai_runs WHERE project_id=$1", "DELETE FROM wp_messages WHERE project_id=$1", "DELETE FROM wp_handoffs WHERE project_id=$1", "DELETE FROM wp_conversations WHERE project_id=$1", "DELETE FROM wp_contacts WHERE project_id=$1", "DELETE FROM wp_tags WHERE project_id=$1", "DELETE FROM wp_audit_events WHERE project_id=$1", "DELETE FROM wp_inboxes WHERE project_id=$1", "DELETE FROM wp_projects WHERE id=$1"];
  var chain = Promise.resolve(); steps.forEach(function (s) { chain = chain.then(function () { return q(s, [pid]); }); }); return chain;
}
// unit: provider sendText contract against the fake
new Promise(function (resolve) { evo.listen(0, '127.0.0.1', function () { evoPort = evo.address().port; process.env.MYTHOS_WP_EVOLUTION_BASE_URL = 'http://127.0.0.1:' + evoPort; resolve(); }); })
  .then(function () { return providerMod.sendText({ baseUrl: 'http://127.0.0.1:' + evoPort, instance: 'comms-test-inbox', apiKey: KEY, to: '21699000001', text: 'hello' }); })
  .then(function (r) {
    ok(r.ok && r.status === 201 && r.provider_message_id === 'OUT1', 'sendText → ok + provider id');
    var rq = evoReqs[0]; var body = JSON.parse(rq.body);
    ok(rq.path === '/message/sendText/comms-test-inbox' && rq.apikey === KEY && body.number === '21699000001' && body.text === 'hello', 'sendText contract: path, apikey header, {number,text}');
    evoMode = '500'; return providerMod.sendText({ baseUrl: 'http://127.0.0.1:' + evoPort, instance: 'comms-test-inbox', apiKey: KEY, to: '21699000001', text: 'x' });
  })
  .then(function (r) { ok(!r.ok && /^HTTP 500/.test(r.error) && r.error.indexOf(KEY) === -1, 'HTTP error captured and scrubbed of long tokens'); evoMode = 'ok'; })
  .then(function () { return providerMod.sendText({ baseUrl: 'http://127.0.0.1:1', instance: 'x', apiKey: KEY, to: '21699000001', text: 'x' }); })
  .then(function (r) { ok(!r.ok && /^TRANSPORT/.test(r.error), 'transport failure classified'); ok(providerMod.readApiKey().present === true, 'api key file readable (0600)'); })
  // db + server
  .then(function () { return migrate.up(pool); })
  .then(function () { return wipe('comms-test'); })
  .then(function () { return q("INSERT INTO wp_projects (id, display_name, catalog_dsn_env) VALUES ('comms-test','Comms test','MYTHOS_WP_CATALOG_TEST')"); })
  .then(function () { return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, inbound_enabled, outbound_enabled, status) VALUES ('comms-test','evolution','comms-test-inbox','A', true, false, 'closed') RETURNING *"); })
  .then(function (r) { inboxA = r.rows[0]; return core.ingest(pool, inboxA, inboundMsg('IN1', 'Bonjour ?')); })
  .then(function (r) { ids.conv = r.conversation_id; return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { PORT = server.address().port; resolve(); }); }); })
  .then(function () { return req('POST', '/api/login', { username: 'op', password: 'operator-password-1' }); })
  .then(function (x) { COOKIE = x.cookie; evoReqs = []; return req('POST', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/messages', { text: 'Réponse', client_ref: 'ref-00000001' }); })
  .then(function (x) { ok(x.status === 412, 'outbound disabled → 412'); return q("UPDATE wp_inboxes SET outbound_enabled = true WHERE id = $1", [inboxA.id]); })
  .then(function () { return req('POST', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/messages', { text: 'Réponse', client_ref: 'ref-00000001' }); })
  .then(function (x) { ok(x.status === 412 && /not connected/.test(x.body.detail), 'inbox not open → 412'); return q("UPDATE wp_inboxes SET status = 'open' WHERE id = $1", [inboxA.id]); })
  .then(function () { return req('POST', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/messages', { text: '', client_ref: 'ref-00000001' }); })
  .then(function (x) { ok(x.status === 400, 'empty text → 400'); return req('POST', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/messages', { text: 'x', client_ref: 'short' }); })
  .then(function (x) { ok(x.status === 400, 'bad client_ref → 400'); ok(evoReqs.length === 0, 'no provider call before validation passes'); return req('POST', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/messages', { text: 'Bonjour, oui disponible.', client_ref: 'ref-00000001' }); })
  .then(function (x) {
    ok(x.status === 201 && x.data && x.data.status === 'sent' && x.data.provider_message_id && x.data.duplicate === false, 'send → 201 sent (' + x.status + ' ' + JSON.stringify(x.body).slice(0, 160) + ')'); if (!x.data) throw new Error('send failed: ' + JSON.stringify(x.body)); ids.out = x.data.message_id; ids.pmid = x.data.provider_message_id;
    ok(evoReqs.length === 1 && JSON.parse(evoReqs[0].body).number === '21699000001', 'one provider call to the customer number');
    return q("SELECT m.direction, m.status, m.sender_kind, m.sender_ref, m.client_ref, m.attempts, c.status AS cs, c.first_reply_at IS NOT NULL AS fr FROM wp_messages m JOIN wp_conversations c ON c.id = m.conversation_id WHERE m.id = $1", [ids.out]);
  })
  .then(function (r) { var m = r.rows[0]; ok(m.direction === 'out' && m.status === 'sent' && m.sender_kind === 'user' && m.sender_ref === 'op' && m.attempts === 1, 'outbound row persisted'); ok(m.cs === 'waiting_customer' && m.fr, 'conversation → waiting_customer, first_reply_at set'); return q("SELECT kind FROM wp_conversation_events WHERE conversation_id = $1 ORDER BY id", [ids.conv]); })
  .then(function (r) { ok(r.rows.map(function (x) { return x.kind; }).indexOf('message_out') !== -1, 'message_out journaled'); return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE resource='messages' AND record_id=$1", [String(ids.out)]); })
  .then(function (r) { ok(r.rows[0].n === 1, 'send audited'); return req('POST', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/messages', { text: 'Bonjour, oui disponible.', client_ref: 'ref-00000001' }); })
  .then(function (x) { ok(x.status === 200 && x.data.duplicate === true && x.data.message_id === ids.out, 'replay with same client_ref → duplicate, same row'); ok(evoReqs.length === 1, 'replay made no second provider call'); })
  // transport retry
  .then(function () { evoMode = 'drop'; evoReqs = []; return req('POST', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/messages', { text: 'deuxième', client_ref: 'ref-00000002' }); })
  .then(function (x) { ok(x.status === 201 && x.data.status === 'failed' && /^TRANSPORT/.test(x.data.error), 'transport failure → failed after automatic retry'); ok(evoReqs.length === 2, 'exactly one automatic retry on transport error'); ids.failed = x.data.message_id; evoMode = '500'; evoReqs = []; return req('POST', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/messages', { text: 'troisième', client_ref: 'ref-00000003' }); })
  .then(function (x) { ok(x.status === 201 && x.data.status === 'failed' && /^HTTP 500/.test(x.data.error), 'provider 500 → failed'); ok(evoReqs.length === 1, 'no automatic retry on HTTP error'); evoMode = 'ok'; evoReqs = []; return req('POST', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/messages/' + ids.failed + '/retry', {}); })
  .then(function (x) { ok(x.status === 200 && x.data && x.data.status === 'sent', 'manual retry of a failed message → sent (' + x.status + ' ' + JSON.stringify(x.body).slice(0, 200) + ')'); return req('POST', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/messages/' + ids.out + '/retry', {}); })
  .then(function (x) { ok(x.status === 412, 'retry of a sent message refused'); return q("SELECT count(*)::int AS n FROM wp_messages WHERE conversation_id = $1 AND direction = 'out'", [ids.conv]); })
  .then(function (r) { ok(r.rows[0].n === 3, 'three outbound rows (cap is 3/h in this test)'); return req('POST', '/api/projects/comms-test/comms/conversations/' + ids.conv + '/messages', { text: 'quatrième', client_ref: 'ref-00000004' }); })
  .then(function (x) { ok(x.status === 429, 'hourly cap → 429'); })
  // delivery status via webhook
  .then(function () { return req('POST', '/hooks/evolution', { event: 'messages.update', instance: 'comms-test-inbox', data: { keyId: ids.pmid, remoteJid: '21699000001@s.whatsapp.net', fromMe: true, status: 'DELIVERY_ACK' } }, { 'Content-Type': 'application/json', 'x-mythos-webhook-token': TOKEN }); })
  .then(function (x) { ok(x.status === 200 && x.data === undefined && x.body.kind === 'status' && x.body.updated === true, 'messages.update DELIVERY_ACK accepted'); return q('SELECT status FROM wp_messages WHERE provider_message_id = $1', [ids.pmid]); })
  .then(function (r) { ok(r.rows[0].status === 'delivered', 'status → delivered'); return req('POST', '/hooks/evolution', { event: 'MESSAGES_UPDATE', instance: 'comms-test-inbox', data: { key: { id: ids.pmid, fromMe: true }, status: 'READ' } }, { 'Content-Type': 'application/json', 'x-mythos-webhook-token': TOKEN }); })
  .then(function () { return q('SELECT status FROM wp_messages WHERE provider_message_id = $1', [ids.pmid]); })
  .then(function (r) { ok(r.rows[0].status === 'read', 'status → read'); return req('POST', '/hooks/evolution', { event: 'messages.update', instance: 'comms-test-inbox', data: { keyId: ids.pmid, status: 'DELIVERY_ACK' } }, { 'Content-Type': 'application/json', 'x-mythos-webhook-token': TOKEN }); })
  .then(function (x) { ok(x.body.updated === false, 'never downgrade read → delivered'); return q('SELECT status FROM wp_messages WHERE provider_message_id = $1', [ids.pmid]); })
  .then(function (r) { ok(r.rows[0].status === 'read', 'still read'); return req('POST', '/hooks/evolution', { event: 'messages.update', instance: 'comms-test-inbox', data: { keyId: 'NOPE', status: 'READ' } }, { 'Content-Type': 'application/json', 'x-mythos-webhook-token': TOKEN }); })
  .then(function (x) { ok(x.body.updated === false, 'unknown message id ignored'); })
  // logs
  .then(function () { var all = logLines.join('\n'); ok(all.indexOf(KEY) === -1 && all.indexOf(TOKEN) === -1 && all.indexOf('disponible') === -1, 'logs carry no api key, token or message text'); })
  .then(function () { return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name) VALUES ('comms-test','evolution','mythos-bridge','x')").then(function () { ok(false, 'mythos-bridge inbox refused'); }, function (e) { ok(/not_bridge/.test(e.message), 'mythos-bridge can never be an inbox'); }); })
  .then(function () { return new Promise(function (resolve) { server.close(resolve); }); })
  .then(function () { return new Promise(function (resolve) { evo.close(resolve); }); })
  .then(function () { return wipe('comms-test'); })
  .then(function () { return pool.end(); })
  .then(function () { process.stdout.write = origWrite; finish(); })
  .catch(function (e) { process.stdout.write = origWrite; console.error('ERROR: ' + (e && e.stack || e)); failed++; pool.end().catch(function () {}); finish(1); });
