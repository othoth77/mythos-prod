'use strict';
// =====================================================
// MYTHOS WP — Communication Receiver tests (MYTHOS-COMMS-2, #202)
// tests/mythos-wp-comms-receiver-test.js
//
// Unit: provider normalisation (text, extended text, image/audio/document/
// sticker/video, location, reaction, LID addressing, groups, status
// broadcasts, own messages, self chat, wrappers, credential + media-key
// stripping). Integration (mythos_wp_test): the real HTTP server on a
// loopback port with the receiver mounted — flag off → 404; bad/missing
// token → 401; oversize → 413; not JSON → 400; unknown instance → 202
// rejected + dead-letter; disabled inbox → dry_run ledger, nothing
// persisted; enabled inbox → contact + conversation + message + attachment
// + event; replay → duplicate, exactly one row; resolved conversation →
// new one opens; connection.update → inbox status. Security: no apikey /
// mediaKey / base64 in wp_messages.raw, in wp_inbound_events.payload or in
// the server log lines emitted during the run.
// =====================================================
var http = require('http');
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var WP = path.join(ROOT, 'projects/mythos-wp');
var TEST_URL = process.env.MYTHOS_WP_TEST_DB_URL || null;
var passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.error('FAIL: ' + name); } }
function finish(code) { console.log('mythos-wp-comms-receiver: ' + passed + ' passed, ' + failed + ' failed'); process.exit(code !== undefined ? code : (failed ? 1 : 0)); }

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-rcv-'));
var tokenFile = path.join(tmp, 'webhook.token');
var TOKEN = 'test-webhook-token-0123456789abcdef';
fs.writeFileSync(tokenFile, TOKEN + '\n', { mode: 0o600 });
process.env.MYTHOS_WP_WEBHOOK_TOKEN_FILE = tokenFile;
process.env.MYTHOS_WP_USERS_FILE = path.join(tmp, 'users.json');
process.env.MYTHOS_WP_INSECURE_COOKIE = '1';
delete process.env.MYTHOS_WP_COMMS_CONFIG;
delete process.env.MYTHOS_WP_RECEIVER_ENABLED;

var provider = require(path.join(WP, 'reference/comms/providers/evolution'));
var receiver = require(path.join(WP, 'reference/comms/receiver'));

// ---------------------------------------------------------------- fixtures
var SECRET = 'B6D711FCDE4D4FD5936544120E713976'; // apikey-shaped value that must never be stored
function body(event, data, extra) {
  return Object.assign({ event: event, instance: 'comms-test-inbox', apikey: SECRET, server_url: 'http://127.0.0.1:8080', sender: '21600000000@s.whatsapp.net', data: data }, extra || {});
}
function textMsg(id, text, from) {
  return { key: { remoteJid: (from || '21699000001') + '@s.whatsapp.net', fromMe: false, id: id }, pushName: 'Client Un', message: { conversation: text }, messageType: 'conversation', messageTimestamp: 1788620000 };
}
var imageMsg = { key: { remoteJid: '21699000001@s.whatsapp.net', fromMe: false, id: 'IMG1' }, pushName: 'Client Un', messageTimestamp: 1788620001, message: { imageMessage: { url: 'https://mmg.whatsapp.net/x', mimetype: 'image/jpeg', caption: 'la pièce', fileSha256: Buffer.alloc(32, 7).toString('base64'), fileLength: '12345', mediaKey: 'MEDIAKEYSECRET==', fileEncSha256: 'enc', jpegThumbnail: 'AAAA', directPath: '/v/x' } } };

// ---------------------------------------------------------------- unit: provider
(function unit() {
  var r = provider.parseInbound(body('messages.upsert', textMsg('T1', 'Bonjour')));
  ok(r.ok && r.kind === 'message' && r.event.message_type === 'text' && r.event.text === 'Bonjour' && r.event.contact.wa_id === '21699000001', 'text message normalised');
  ok(r.event.contact.display_name === 'Client Un' && r.event.provider_timestamp === new Date(1788620000 * 1000).toISOString(), 'pushName + timestamp normalised');
  ok(JSON.stringify(r.event.raw).indexOf(SECRET) === -1 && r.event.raw.apikey === undefined, 'raw carries no apikey');
  r = provider.parseInbound(body('MESSAGES_UPSERT', { key: { remoteJid: '21699000001@s.whatsapp.net', fromMe: false, id: 'T2' }, message: { extendedTextMessage: { text: 'Prix ?', contextInfo: { stanzaId: 'T1' } } } }));
  ok(r.ok && r.event.text === 'Prix ?' && r.event.quoted_provider_message_id === 'T1', 'extended text + quoted id');
  r = provider.parseInbound(body('messages.upsert', imageMsg));
  ok(r.ok && r.event.message_type === 'image' && r.event.text === 'la pièce' && r.event.attachments.length === 1, 'image → attachment metadata');
  var a = r.event.attachments[0];
  ok(a.mime_type === 'image/jpeg' && a.size_bytes === 12345 && a.sha256 === Buffer.alloc(32, 7).toString('hex'), 'attachment mime/size/sha256');
  var rawStr = JSON.stringify(r.event.raw);
  ok(rawStr.indexOf('MEDIAKEYSECRET') === -1 && rawStr.indexOf('mmg.whatsapp.net') === -1 && rawStr.indexOf('AAAA') === -1, 'mediaKey / url / thumbnail stripped from raw');
  ['audioMessage', 'videoMessage', 'documentMessage', 'stickerMessage'].forEach(function (k) {
    var m = {}; m[k] = { mimetype: 'x/y', fileLength: 1 };
    var x = provider.parseInbound(body('messages.upsert', { key: { remoteJid: '21699000001@s.whatsapp.net', fromMe: false, id: 'M' + k }, message: m }));
    ok(x.ok && x.event.attachments.length === 1 && x.event.message_type === x.event.attachments[0].kind, k + ' → ' + (x.ok ? x.event.message_type : x.reason));
  });
  r = provider.parseInbound(body('messages.upsert', { key: { remoteJid: '21699000001@s.whatsapp.net', fromMe: false, id: 'V1' }, message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/png' } } } } }));
  ok(r.ok && r.event.message_type === 'image', 'view-once wrapper unwrapped');
  r = provider.parseInbound(body('messages.upsert', { key: { remoteJid: '21699000001@s.whatsapp.net', fromMe: false, id: 'L1' }, message: { locationMessage: { degreesLatitude: 36.8 } } }));
  ok(r.ok && r.event.message_type === 'location', 'location');
  r = provider.parseInbound(body('messages.upsert', { key: { remoteJid: '21699000001@s.whatsapp.net', fromMe: false, id: 'R1' }, message: { reactionMessage: { text: '👍', key: { id: 'T1' } } } }));
  ok(r.ok && r.event.message_type === 'reaction' && r.event.text === '👍', 'reaction');
  r = provider.parseInbound(body('messages.upsert', { key: { remoteJid: '123456789012345@lid', senderPn: '21699000002@s.whatsapp.net', fromMe: false, id: 'LID1' }, message: { conversation: 'x' } }));
  ok(r.ok && r.event.contact.wa_id === '21699000002' && r.event.contact.lid === '123456789012345', 'LID addressing resolved through senderPn');
  r = provider.parseInbound(body('messages.upsert', { key: { remoteJid: '123456789012345@lid', fromMe: false, id: 'LID2' }, message: { conversation: 'x' } }));
  ok(!r.ok && r.reason === 'SENDER_UNRESOLVED', 'LID without phone refused');
  ok(!provider.parseInbound(body('messages.upsert', { key: { remoteJid: '1203630000@g.us', fromMe: false, id: 'G1' }, message: { conversation: 'x' } })).ok, 'group ignored');
  ok(provider.parseInbound(body('messages.upsert', { key: { remoteJid: 'status@broadcast', fromMe: false, id: 'S1' }, message: {} })).reason === 'STATUS_IGNORED', 'status broadcast ignored');
  ok(provider.parseInbound(body('messages.upsert', { key: { remoteJid: '21699000001@s.whatsapp.net', fromMe: true, id: 'O1' }, message: { conversation: 'x' } })).reason === 'OWN_MESSAGE', 'own message ignored');
  ok(provider.parseInbound(body('messages.upsert', textMsg('SC1', 'x', '21600000000'))).reason === 'SELF_CHAT_IGNORED', 'self chat ignored');
  ok(provider.parseInbound(body('messages.upsert', { key: { remoteJid: '21699000001@s.whatsapp.net', fromMe: false, id: 'bad id!' }, message: {} })).reason === 'MESSAGE_ID', 'bad message id refused');
  ok(provider.parseInbound(body('contacts.update', {})).reason.indexOf('EVENT_IGNORED') === 0, 'other events ignored by name');
  ok(provider.parseInbound(body('messages.upsert', { key: { remoteJid: '21699000001@s.whatsapp.net', fromMe: false, id: 'X' }, message: {} }, { instance: 'bad instance' })).reason === 'INSTANCE_INVALID', 'instance shape enforced');
  r = provider.parseInbound(body('connection.update', { state: 'open' }));
  ok(r.ok && r.kind === 'connection' && r.event.status === 'open', 'connection.update open');
  ok(provider.parseInbound(body('CONNECTION_UPDATE', { state: 'close' })).event.status === 'closed', 'connection close → closed');
  ok(provider.parseInbound(body('connection.update', { state: 'weird' })).reason === 'CONNECTION_STATE_UNKNOWN', 'unknown connection state refused');
  ok(!provider.parseInbound(null).ok && !provider.parseInbound([]).ok, 'non-object bodies refused');
  var d = receiver.describe();
  ok(d.enabled === false && d.token_present === true && d.route === '/hooks/evolution', 'describe(): disabled by default, token readable');
  fs.chmodSync(tokenFile, 0o644);
  ok(receiver.readToken(tokenFile).present === false, 'world-readable token file refused');
  fs.chmodSync(tokenFile, 0o600);
})();

if (!TEST_URL) { console.error('MYTHOS_WP_TEST_DB_URL not set — integration skipped'); finish(process.env.MYTHOS_WP_ALLOW_SKIP === '1' ? 0 : 3); }

// ---------------------------------------------------------------- integration
var u = new URL(TEST_URL);
process.env.MYTHOS_WP_DB_HOST = u.hostname; process.env.MYTHOS_WP_DB_PORT = u.port || '5432';
process.env.MYTHOS_WP_DB_USER = decodeURIComponent(u.username); process.env.MYTHOS_WP_DB_PASSWORD = decodeURIComponent(u.password); process.env.MYTHOS_WP_DB_NAME = u.pathname.slice(1);
var migrate = require(path.join(WP, 'reference/migrate'));
var db = require(path.join(WP, 'reference/db'));
var pool = db.wp();
var logLines = [];
var origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (s) { if (typeof s === 'string' && s.indexOf('"receiver"') !== -1) { logLines.push(s); return true; } return origWrite(s); };
var server = require(path.join(WP, 'reference/server')).createServer();
var PORT = 0;
function post(pathname, payload, opts) {
  opts = opts || {};
  var data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  var headers = Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, opts.headers || {});
  if (opts.token !== null) headers[receiver.TOKEN_HEADER] = opts.token === undefined ? TOKEN : opts.token;
  return new Promise(function (resolve, reject) {
    var req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: opts.method || 'POST', headers: headers, agent: false }, function (res) {
      var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j }); });
    });
    req.on('error', reject); req.end(data);
  });
}
function q(sql, p) { return pool.query(sql, p || []); }
var ids = {};
q("DELETE FROM wp_projects WHERE id='comms-test'").catch(function () {})
  .then(function () { return migrate.up(pool); })
  .then(function () { return q("DELETE FROM wp_inbound_events WHERE instance LIKE 'comms-test%'"); })
  .then(function () { return q("DELETE FROM wp_message_attachments WHERE message_id IN (SELECT id FROM wp_messages WHERE project_id='comms-test')"); })
  .then(function () { return q("DELETE FROM wp_conversation_events WHERE project_id='comms-test'"); })
  .then(function () { return q("DELETE FROM wp_ai_suggestions WHERE conversation_id IN (SELECT id FROM wp_conversations WHERE project_id='comms-test')"); })
  .then(function () { return q("DELETE FROM wp_ai_runs WHERE project_id='comms-test'"); })
  .then(function () { return q("DELETE FROM wp_messages WHERE project_id='comms-test'"); })
  .then(function () { return q("DELETE FROM wp_handoffs WHERE project_id='comms-test'"); })
  .then(function () { return q("DELETE FROM wp_conversations WHERE project_id='comms-test'"); })
  .then(function () { return q("DELETE FROM wp_contacts WHERE project_id='comms-test'"); })
  .then(function () { return q("DELETE FROM wp_inboxes WHERE project_id='comms-test'"); })
  .then(function () { return q("DELETE FROM wp_projects WHERE id='comms-test'"); })
  .then(function () { return q("INSERT INTO wp_projects (id, display_name, catalog_dsn_env) VALUES ('comms-test','Comms test','MYTHOS_WP_CATALOG_TEST')"); })
  .then(function () { return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, inbound_enabled) VALUES ('comms-test','evolution','comms-test-inbox','Live', true) RETURNING id"); })
  .then(function (r) { ids.inbox = r.rows[0].id; return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, inbound_enabled) VALUES ('comms-test','evolution','comms-test-dry','Dry', false) RETURNING id"); })
  .then(function (r) { ids.dry = r.rows[0].id; return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { PORT = server.address().port; resolve(); }); }); })
  // flag OFF → route absent
  .then(function () { return post('/hooks/evolution', body('messages.upsert', textMsg('F1', 'x'))); })
  .then(function (r) { ok(r.status === 404, 'receiver disabled by default → 404'); process.env.MYTHOS_WP_RECEIVER_ENABLED = '1'; })
  .then(function () { return post('/hooks/evolution', body('messages.upsert', textMsg('A1', 'x')), { token: null }); })
  .then(function (r) { ok(r.status === 401 && r.body.reason === 'WEBHOOK_TOKEN_MISSING', 'missing token → 401'); })
  .then(function () { return post('/hooks/evolution', body('messages.upsert', textMsg('A2', 'x')), { token: 'wrong-token-wrong-token-wrong' }); })
  .then(function (r) { ok(r.status === 401 && r.body.reason === 'WEBHOOK_TOKEN_MISMATCH', 'wrong token → 401'); })
  .then(function () { return post('/hooks/evolution?token=' + TOKEN, body('messages.upsert', textMsg('A3', 'query token')), { token: null }); })
  .then(function (r) { ok(r.status === 200 && r.body.persisted === true, 'query-string token accepted'); })
  .then(function () { return post('/hooks/evolution', '{not json', {}); })
  .then(function (r) { ok(r.status === 400 && r.body.reason === 'BODY_NOT_JSON', 'malformed JSON → 400'); })
  .then(function () { return post('/hooks/evolution', JSON.stringify({ event: 'messages.upsert', instance: 'comms-test-inbox', pad: 'x'.repeat(600000) })).catch(function (e) { return { status: 'reset:' + e.code }; }); })
  .then(function (r) { ok(r.status === 413 || r.status === 'reset:ECONNRESET', 'oversize body refused (413 or connection cut): ' + r.status); })
  .then(function () { return post('/hooks/telegram', body('messages.upsert', textMsg('A4', 'x'))); })
  .then(function (r) { ok(r.status === 404, 'unknown provider route → 404'); })
  .then(function () { return post('/hooks/evolution', body('messages.upsert', textMsg('A5', 'x')), { method: 'GET' }); })
  .then(function (r) { ok(r.status === 405, 'GET → 405'); })
  .then(function () { return post('/hooks/evolution', body('messages.upsert', textMsg('U1', 'x'), { instance: 'comms-test-unknown' })); })
  .then(function (r) { ok(r.status === 202 && r.body.reason === 'INBOX_UNKNOWN', 'unknown instance → 202 rejected'); return q("SELECT status, reason, payload FROM wp_inbound_events WHERE instance='comms-test-unknown'"); })
  .then(function (r) { ok(r.rows.length === 1 && r.rows[0].status === 'rejected' && r.rows[0].payload && JSON.stringify(r.rows[0].payload).indexOf(SECRET) === -1, 'dead-letter row kept without apikey'); })
  .then(function () { return post('/hooks/evolution', body('messages.upsert', textMsg('D1', 'dry'), { instance: 'comms-test-dry' })); })
  .then(function (r) { ok(r.status === 200 && r.body.mode === 'dry_run' && r.body.persisted === false, 'disabled inbox → dry_run'); return q("SELECT count(*)::int AS n FROM wp_messages WHERE inbox_id=$1", [ids.dry]); })
  .then(function (r) { ok(r.rows[0].n === 0, 'dry_run persisted nothing'); return q("SELECT status FROM wp_inbound_events WHERE instance='comms-test-dry'"); })
  .then(function (r) { ok(r.rows.length === 1 && r.rows[0].status === 'dry_run', 'dry_run ledgered'); })
  // real persistence
  .then(function () { return post('/hooks/evolution', body('messages.upsert', textMsg('P1', 'Bonjour, prix du filtre ?'))); })
  .then(function (r) { ok(r.status === 200 && r.body.persisted === true && r.body.conversation_id, 'enabled inbox → persisted'); ids.conv = r.body.conversation_id; ids.msg = r.body.message_id; })
  .then(function () { return q("SELECT c.wa_id, c.display_name, c.last_inbound_at IS NOT NULL AS seen FROM wp_contacts c JOIN wp_messages m ON m.contact_id=c.id WHERE m.id=$1", [ids.msg]); })
  .then(function (r) { ok(r.rows[0].wa_id === '21699000001' && r.rows[0].display_name === 'Client Un' && r.rows[0].seen, 'contact upserted from the message'); })
  .then(function () { return q("SELECT status, unread_count, last_inbound_at IS NOT NULL AS li FROM wp_conversations WHERE id=$1", [ids.conv]); })
  .then(function (r) { ok(r.rows[0].status === 'open' && r.rows[0].unread_count === 2 && r.rows[0].li, 'conversation open with unread count (A3 + P1)'); })
  .then(function () { return post('/hooks/evolution', body('messages.upsert', textMsg('P1', 'Bonjour, prix du filtre ?'))); })
  .then(function (r) { ok(r.status === 200 && r.body.duplicate === true && r.body.persisted === false, 'replay → duplicate'); return q("SELECT count(*)::int AS n FROM wp_messages WHERE provider_message_id='P1' AND inbox_id=$1", [ids.inbox]); })
  .then(function (r) { ok(r.rows[0].n === 1, 'exactly one row after replay'); return q("SELECT unread_count FROM wp_conversations WHERE id=$1", [ids.conv]); })
  .then(function (r) { ok(r.rows[0].unread_count === 2, 'replay did not bump counters'); return q("SELECT status FROM wp_inbound_events WHERE provider_message_id='P1' ORDER BY id"); })
  .then(function (r) { ok(r.rows.map(function (x) { return x.status; }).join(',') === 'persisted,duplicate', 'ledger: persisted then duplicate'); })
  .then(function () { return post('/hooks/evolution', body('messages.upsert', imageMsg)); })
  .then(function (r) { ok(r.status === 200 && r.body.persisted, 'image persisted'); return q("SELECT a.kind, a.mime_type, a.size_bytes, a.status, m.text, m.raw::text AS raw FROM wp_message_attachments a JOIN wp_messages m ON m.id=a.message_id WHERE m.provider_message_id='IMG1'"); })
  .then(function (r) { var x = r.rows[0]; ok(x && x.kind === 'image' && x.mime_type === 'image/jpeg' && String(x.size_bytes) === '12345' && x.status === 'pending' && x.text === 'la pièce', 'attachment metadata persisted, bytes not'); ok(x && x.raw.indexOf('MEDIAKEYSECRET') === -1 && x.raw.indexOf(SECRET) === -1, 'stored raw has no mediaKey/apikey'); })
  .then(function () { return q("SELECT count(*)::int AS n FROM wp_conversation_events WHERE conversation_id=$1 AND kind='message_in'", [ids.conv]); })
  .then(function (r) { ok(r.rows[0].n === 3, 'one message_in event per persisted message'); })
  .then(function () { return q("UPDATE wp_conversations SET status='resolved', resolved_at=now() WHERE id=$1", [ids.conv]); })
  .then(function () { return post('/hooks/evolution', body('messages.upsert', textMsg('P2', 'Encore une question'))); })
  .then(function (r) { ok(r.status === 200 && r.body.persisted && r.body.conversation_id !== ids.conv, 'after resolve, a new conversation opens for the same contact'); })
  .then(function () { return post('/hooks/evolution', body('connection.update', { state: 'open' })); })
  .then(function (r) { ok(r.status === 200 && r.body.kind === 'connection', 'connection.update accepted'); return q("SELECT status FROM wp_inboxes WHERE id=$1", [ids.inbox]); })
  .then(function (r) { ok(r.rows[0].status === 'open', 'inbox status follows connection.update'); })
  .then(function () { return post('/hooks/evolution', body('messages.upsert', { key: { remoteJid: '1203630000@g.us', fromMe: false, id: 'G9' }, message: { conversation: 'x' } })); })
  .then(function (r) { ok(r.status === 200 && r.body.accepted === false && r.body.reason === 'GROUP_IGNORED', 'group ignored at HTTP level'); })
  // security: logs
  .then(function () {
    var all = logLines.join('\n');
    ok(all.length > 0, 'receiver emitted structured log lines');
    ok(all.indexOf(SECRET) === -1 && all.indexOf('MEDIAKEYSECRET') === -1 && all.indexOf(TOKEN) === -1, 'logs contain no apikey / mediaKey / webhook token');
    ok(all.indexOf('Bonjour, prix') === -1, 'logs contain no message text');
    return q("SELECT count(*)::int AS n FROM wp_inbound_events WHERE payload::text LIKE '%" + SECRET + "%'");
  })
  .then(function (r) { ok(r.rows[0].n === 0, 'no apikey anywhere in the dead-letter table'); })
  .then(function () { return new Promise(function (resolve) { server.close(resolve); }); })
  .then(function () { return pool.end(); })
  .then(function () { process.stdout.write = origWrite; finish(); })
  .catch(function (e) { process.stdout.write = origWrite; console.error('ERROR: ' + (e && e.stack || e)); failed++; pool.end().catch(function () {}); finish(1); });
