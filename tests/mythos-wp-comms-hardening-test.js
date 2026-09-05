'use strict';
// =====================================================
// MYTHOS WP — hardening tests (MYTHOS-COMMS-9, #222)  needs MYTHOS_WP_TEST_DB_URL
// identities: legacy wa_id contact resolved by phone identity; LID/BSUID-only
// inbound resolves to the same contact once an identity is known; a new
// identifier attaches instead of duplicating; contact without phone is valid;
// ordering: provider timestamp first, created_at/id tie-breakers, missing
// timestamps deterministic; assistant gate: 412 on needs_human and on open
// handoff, ai.refused journaled, no run row; reconciliation: alarm once, no
// resend; heartbeat; replay: dry-run default, apply persists, duplicate-safe,
// non-eligible refused, audited, event_name written; receiver on the provider
// registry incl. a signed-provider path; /api/comms/providers.
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
function finish(code) { console.log('mythos-wp-comms-hardening: ' + passed + ' passed, ' + failed + ' failed'); process.exit(code !== undefined ? code : (failed ? 1 : 0)); }
if (!TEST_URL) { console.error('MYTHOS_WP_TEST_DB_URL not set'); finish(process.env.MYTHOS_WP_ALLOW_SKIP === '1' ? 0 : 3); }
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-hard-'));
var TOKEN = 'test-webhook-token-0123456789abcdef'; var tokenFile = path.join(tmp, 'webhook.token'); fs.writeFileSync(tokenFile, TOKEN + '\n', { mode: 0o600 });
process.env.MYTHOS_WP_USERS_FILE = path.join(tmp, 'users.json'); process.env.MYTHOS_WP_INSECURE_COOKIE = '1';
process.env.MYTHOS_WP_WEBHOOK_TOKEN_FILE = tokenFile; process.env.MYTHOS_WP_RECEIVER_ENABLED = '1'; process.env.MYTHOS_WP_CATALOG_TEST = TEST_URL;
delete process.env.MYTHOS_WP_COMMS_CONFIG; delete process.env.MYTHOS_WP_EVOLUTION_API_KEY_FILE;
var u = new URL(TEST_URL); process.env.MYTHOS_WP_DB_HOST = u.hostname; process.env.MYTHOS_WP_DB_PORT = u.port || '5432'; process.env.MYTHOS_WP_DB_USER = decodeURIComponent(u.username); process.env.MYTHOS_WP_DB_PASSWORD = decodeURIComponent(u.password); process.env.MYTHOS_WP_DB_NAME = u.pathname.slice(1);
var auth = require(path.join(WP, 'reference/auth'));
var migrate = require(path.join(WP, 'reference/migrate'));
var db = require(path.join(WP, 'reference/db'));
var registry = require(path.join(WP, 'reference/comms/provider'));
var core = require(path.join(WP, 'reference/comms/core'));
var inbox = require(path.join(WP, 'reference/comms/inbox'));
var assistant = require(path.join(WP, 'reference/comms/assistant'));
var reconcile = require(path.join(WP, 'reference/comms/reconcile'));
var evolution = require(path.join(WP, 'reference/comms/providers/evolution'));
var fake = require(path.join(ROOT, 'tests/fixtures/comms/fake-provider'));
var store = require(path.join(WP, 'reference/projects-store'));
try { registry.register(fake); } catch (e) { /* already */ }
var pool = db.wp();
fs.writeFileSync(process.env.MYTHOS_WP_USERS_FILE, JSON.stringify({ users: [{ username: 'op', role: 'operator', scrypt: auth.hashPassword('operator-password-1') }] }), { mode: 0o600 });
var server = require(path.join(WP, 'reference/server')).createServer();
var PORT = 0, COOKIE = '';
function req(method, p, body, headers) {
  return new Promise(function (resolve, reject) {
    var data = body !== undefined ? JSON.stringify(body) : null;
    var h = Object.assign({ 'Content-Type': 'application/json', 'X-Requested-With': 'MythosWP' }, headers || {}); if (data) h['Content-Length'] = Buffer.byteLength(data); if (COOKIE && !headers) h.Cookie = COOKIE;
    var rq = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: h, agent: false }, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j, data: j && j.data, cookie: (res.headers['set-cookie'] || [''])[0].split(';')[0] }); }); });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}
function q(sql, p) { return pool.query(sql, p || []); }
var pq = { query: function (s, p) { return pool.query(s, p); } };
function evo(id, text, from, opts) { opts = opts || {}; var key = opts.lid ? { remoteJid: opts.lid + '@lid', senderPn: (from || '21699000001') + '@s.whatsapp.net', fromMe: false, id: id } : { remoteJid: (from || '21699000001') + '@s.whatsapp.net', fromMe: false, id: id }; return evolution.parseInbound({ event: 'messages.upsert', instance: 'hard-inbox', sender: '21600000000@s.whatsapp.net', data: { key: key, pushName: opts.name || 'Client', message: { conversation: text }, messageTimestamp: opts.ts === undefined ? Math.floor(Date.now() / 1000) : opts.ts } }).event; }
function wipe() {
  var steps = ["UPDATE wp_messages SET ai_run_id = NULL", "DELETE FROM wp_inbound_events", "DELETE FROM wp_message_attachments", "DELETE FROM wp_conversation_events", "DELETE FROM wp_ai_suggestions", "DELETE FROM wp_ai_runs", "DELETE FROM wp_messages", "DELETE FROM wp_handoffs", "DELETE FROM wp_conversation_tags", "DELETE FROM wp_conversations", "DELETE FROM wp_contact_identities", "DELETE FROM wp_contact_tags", "DELETE FROM wp_contacts", "DELETE FROM wp_tags", "DELETE FROM wp_inbox_members", "DELETE FROM wp_audit_events", "DELETE FROM wp_inboxes", "DELETE FROM wp_reserved_accounts", "DELETE FROM wp_knowledge", "DELETE FROM wp_business_rules", "DELETE FROM wp_stock", "DELETE FROM wp_product_commercial", "DELETE FROM wp_projects"];
  var chain = Promise.resolve(); steps.forEach(function (s) { chain = chain.then(function () { return q(s); }); }); return chain;
}
var ids = {}, ibE;
migrate.up(pool).then(wipe)
  .then(function () { return q("INSERT INTO wp_projects (id, display_name, kind, catalog_dsn_env) VALUES ('hard','Hardening','service','MYTHOS_WP_CATALOG_TEST')"); })
  // legacy contact (phone only) + backfilled phone identity, as migration 0005 does
  .then(function () { return q("INSERT INTO wp_contacts (project_id, wa_id, display_name) VALUES ('hard','21699000001','Legacy') RETURNING id"); })
  .then(function (r) { ids.legacy = r.rows[0].id; return q("INSERT INTO wp_contact_identities (project_id, contact_id, kind, value, provider, verified_at) SELECT project_id, id, 'phone', wa_id, 'evolution', now() FROM wp_contacts WHERE id = $1 ON CONFLICT DO NOTHING", [ids.legacy]); })
  .then(function () { return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, inbound_enabled, outbound_enabled, status) VALUES ('hard','evolution','hard-inbox','E', true, true, 'open') RETURNING *"); })
  .then(function (r) { ibE = r.rows[0]; })
  // ---- identities
  .then(function () { return core.ingest(pool, ibE, evo('H1', 'Bonjour', '21699000001')); })
  .then(function (r) { ok(r.contact_id === ids.legacy && r.contact_created === false, 'legacy phone contact resolved through its phone identity (no duplicate)'); ids.conv = r.conversation_id; return core.ingest(pool, ibE, evo('H2', 'Salut', '21699000001', { lid: '123456789012345' })); })
  .then(function (r) { ok(r.contact_id === ids.legacy, 'LID-addressed message with phone → same contact'); return q("SELECT kind, value FROM wp_contact_identities WHERE contact_id = $1 ORDER BY kind", [ids.legacy]); })
  .then(function (r) { ok(r.rows.length === 2 && r.rows[0].kind === 'lid' && r.rows[1].kind === 'phone', 'LID identity attached to the existing contact'); return core.resolveContact(pq, 'hard', { provider: 'evolution', contact: { identities: [{ kind: 'lid', value: '123456789012345' }], wa_id: null } }, 'evolution'); })
  .then(function (c) { ok(c.id === ids.legacy && c.created === false, 'LID-only event (no phone, BSUID era) resolves to the same contact'); return core.resolveContact(pq, 'hard', { provider: 'fake', contact: { identities: [{ kind: 'bsuid', value: 'BSUID-NEW-1' }], wa_id: null, display_name: 'No phone' } }, 'fake'); })
  .then(function (c) { ok(c.created === true && c.identities_added === 1, 'BSUID-only customer creates a contact without a phone'); ids.bsuid = c.id; return q("SELECT wa_id FROM wp_contacts WHERE id = $1", [ids.bsuid]); })
  .then(function (r) { ok(r.rows[0].wa_id === null, 'contact without phone is valid (wa_id NULL)'); return core.resolveContact(pq, 'hard', { provider: 'fake', contact: { identities: [{ kind: 'bsuid', value: 'BSUID-NEW-1' }, { kind: 'phone', value: '21699000777' }] } }, 'fake'); })
  .then(function (c) { ok(c.id === ids.bsuid && c.created === false && c.identities_added === 1, 'later phone for the BSUID customer attaches, no duplicate'); return q("SELECT wa_id FROM wp_contacts WHERE id = $1", [ids.bsuid]); })
  .then(function (r) { ok(r.rows[0].wa_id === '21699000777', 'phone back-filled onto the contact for compatibility'); return q("INSERT INTO wp_contact_identities (project_id, contact_id, kind, value) VALUES ('hard', $1, 'phone', '21699000777')", [ids.legacy]).then(function () { ok(false, 'identity must be unique per project'); }, function (e) { ok(/wp_contact_identities_unique/.test(e.message), 'one identity value belongs to one contact per project'); }); })
  .then(function () { return core.resolveContact(pq, 'hard', { provider: 'fake', contact: { identities: [] } }, 'fake').then(function () { ok(false, 'no identity must fail'); }, function (e) { ok(e.code === 'CONTACT_IDENTITY_MISSING', 'event without any identity is refused'); }); })
  // ---- ordering
  .then(function () { return core.ingest(pool, ibE, evo('O-late', 'arrived late but sent first', '21699000001', { ts: 1700000000 })); })
  .then(function () { return core.ingest(pool, ibE, evo('O-null', 'no provider timestamp', '21699000001', { ts: 0 })); })
  .then(function () { return inbox.listMessages(pool, 'hard', ids.conv, {}); })
  .then(function (r) { var order = r.items.map(function (m) { return m.provider_message_id; }); ok(order[0] === 'O-late', 'provider timestamp orders first: oldest provider timestamp first (' + order.join(' > ') + ')'); ok(order[order.length - 1] === 'O-null', 'missing provider timestamp falls back to created_at (last arrival last)'); return Promise.all([inbox.listMessages(pool, 'hard', ids.conv, {}), inbox.listMessages(pool, 'hard', ids.conv, {})]); })
  .then(function (x) { ok(JSON.stringify(x[0].items.map(function (m) { return m.id; })) === JSON.stringify(x[1].items.map(function (m) { return m.id; })), 'ordering is deterministic across calls'); return inbox.listConversations(pool, 'hard', {}); })
  .then(function (r) { ok(r.items[0] && r.items[0].last_text === 'no provider timestamp', 'conversation preview follows the same ordering rule'); })
  // ---- assistant gate
  .then(function () { return store.resolve('hard'); })
  .then(function (resolved) { ids.resolved = resolved; return q("UPDATE wp_conversations SET status = 'needs_human' WHERE id = $1", [ids.conv]).then(function () { return assistant.suggest(pool, resolved, ids.conv, 'op', {}); }).then(function () { ok(false, 'gate: needs_human must refuse'); }, function (e) { ok(e.status === 412, 'gate: needs_human → 412'); }); })
  .then(function () { return q("SELECT count(*)::int AS n FROM wp_ai_runs WHERE conversation_id = $1", [ids.conv]); })
  .then(function (r) { ok(r.rows[0].n === 0, 'gate: no run row created'); return q("SELECT count(*)::int AS n FROM wp_conversation_events WHERE conversation_id = $1 AND event_name = 'ai.refused'", [ids.conv]); })
  .then(function (r) { ok(r.rows[0].n === 1, 'gate: ai.refused journaled'); return q("UPDATE wp_conversations SET status = 'open' WHERE id = $1", [ids.conv]).then(function () { return q("INSERT INTO wp_handoffs (project_id, reason, status, conversation_id) VALUES ('hard','REQUIRES_HUMAN','REQUIRES_HUMAN',$1) RETURNING id", [ids.conv]); }); })
  .then(function (r) { ids.handoff = r.rows[0].id; return assistant.suggest(pool, ids.resolved, ids.conv, 'op', {}).then(function () { ok(false, 'gate: open handoff must refuse'); }, function (e) { ok(e.status === 412, 'gate: open handoff → 412'); }); })
  .then(function () { return q("UPDATE wp_handoffs SET status = 'RESOLVED' WHERE id = $1", [ids.handoff]).then(function () { return assistant.suggest(pool, ids.resolved, ids.conv, 'op', {}); }); })
  .then(function (out) { ok(out && out.run_id, 'gate: resolved handoff + open conversation → assistant runs again'); })
  // ---- reconciliation
  .then(function () { return q("INSERT INTO wp_messages (project_id, conversation_id, contact_id, inbox_id, direction, provider, provider_message_id, message_type, text, sender_kind, status, created_at) VALUES ('hard',$1,$2,$3,'out','evolution','OUT-OLD','text','old','user','sent', now() - interval '2 hours') RETURNING id", [ids.conv, ids.legacy, ibE.id]); })
  .then(function (r) { ids.old = r.rows[0].id; return q("INSERT INTO wp_messages (project_id, conversation_id, contact_id, inbox_id, direction, provider, provider_message_id, message_type, text, sender_kind, status) VALUES ('hard',$1,$2,$3,'out','evolution','OUT-NEW','text','new','user','sent') RETURNING id", [ids.conv, ids.legacy, ibE.id]); })
  .then(function (r) { ids.new = r.rows[0].id; return reconcile.reconcile(pool, { thresholdMinutes: 15 }); })
  .then(function (r) { ok(r.alarmed.length === 1 && r.alarmed[0] === ids.old, 'reconcile: only the stale outbound is alarmed'); return reconcile.reconcile(pool, { thresholdMinutes: 15 }); })
  .then(function (r) { ok(r.alarmed.length === 0, 'reconcile: alarm raised once (idempotent)'); return q("SELECT status, ack_alarm_at IS NOT NULL AS alarmed FROM wp_messages WHERE id = $1", [ids.old]); })
  .then(function (r) { ok(r.rows[0].status === 'sent' && r.rows[0].alarmed, 'reconcile: status untouched, no resend, alarm stamped'); return q("SELECT count(*)::int AS n FROM wp_conversation_events WHERE conversation_id = $1 AND event_name = 'delivery.alarm'", [ids.conv]); })
  .then(function (r) { ok(r.rows[0].n === 1, 'reconcile: delivery.alarm event journaled once'); })
  // ---- heartbeat (no credential → evolution health is unknown/unreachable; recorded without touching status)
  .then(function () { return reconcile.heartbeat(pool, {}); })
  .then(function (r) { var e = r.inboxes.filter(function (x) { return x.inbox_id === ibE.id; })[0]; ok(e && ['stale', 'unreachable'].indexOf(e.heartbeat) !== -1, 'heartbeat: unreachable provider recorded as ' + (e && e.heartbeat)); return q("SELECT status, heartbeat_state, last_heartbeat_at IS NOT NULL AS hb FROM wp_inboxes WHERE id = $1", [ibE.id]); })
  .then(function (r) { ok(r.rows[0].status === 'open' && r.rows[0].hb && r.rows[0].heartbeat_state !== 'unknown', 'heartbeat: inbox.status untouched, heartbeat columns set'); return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE actor = 'system:heartbeat' AND record_id = $1", [String(ibE.id)]); })
  .then(function (r) { ok(r.rows[0].n === 1, 'heartbeat: state change audited once'); return reconcile.heartbeat(pool, {}); })
  .then(function () { return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE actor = 'system:heartbeat' AND record_id = $1", [String(ibE.id)]); })
  .then(function (r) { ok(r.rows[0].n === 1, 'heartbeat: unchanged state is not re-audited'); })
  // ---- replay
  .then(function () { return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { PORT = server.address().port; resolve(); }); }); })
  .then(function () { return req('POST', '/hooks/evolution', { event: 'messages.upsert', instance: 'hard-unknown', apikey: 'SECRET', data: { key: { remoteJid: '21699000002@s.whatsapp.net', fromMe: false, id: 'R1' }, message: { conversation: 'replay me' } } }, { 'Content-Type': 'application/json', 'x-mythos-webhook-token': TOKEN }); })
  .then(function (x) { ok(x.status === 202 && x.body.reason === 'INBOX_UNKNOWN', 'dead-letter created (unknown instance)'); return q("SELECT id, event_name, payload::text AS p FROM wp_inbound_events WHERE instance = 'hard-unknown' ORDER BY id DESC LIMIT 1"); })
  .then(function (r) { ids.dl = r.rows[0].id; ok(r.rows[0].event_name === 'event.rejected', 'ledger carries the neutral event name'); ok(r.rows[0].p.indexOf('SECRET') === -1, 'dead-letter payload is redacted'); return reconcile.listReplayable(pool, 10); })
  .then(function (l) { ok(l.some(function (x) { return x.id === ids.dl; }), 'dead-letter listed as replayable'); return reconcile.replay(pool, ids.dl, 'cli:test', {}); })
  .then(function (r) { ok(r.dry_run === true && r.result === 'INBOX_UNKNOWN', 'replay is dry-run by default and reports the outcome without writing'); return q("UPDATE wp_inboxes SET instance = 'hard-unknown' WHERE id = $1", [ibE.id]); })
  .then(function () { return reconcile.replay(pool, ids.dl, 'cli:test', { dryRun: true }); })
  .then(function (r) { ok(r.result === 'WOULD_INGEST', 'replay dry-run: would ingest once the inbox exists'); return reconcile.replay(pool, ids.dl, 'cli:test', { dryRun: false }); })
  .then(function (r) { ok(r.result === 'PERSISTED' && r.message_id, 'replay --apply persisted the message'); ids.replayMsg = r.message_id; return q("SELECT raw->>'apikey' AS k FROM wp_messages WHERE id = $1", [r.message_id]); })
  .then(function (r) { ok(r.rows[0].k === null, 'replayed message carries no credential'); return reconcile.replay(pool, ids.dl, 'cli:test', { dryRun: false }).then(function () { ok(false, 'second replay must be refused'); }, function (e) { ok(e.status === 412 && /already replayed/.test(e.message), 'replay is idempotent: second apply refused'); }); })
  .then(function () { return q("SELECT replayed_at IS NOT NULL AS done, replay_result, replay_message_id FROM wp_inbound_events WHERE id = $1", [ids.dl]); })
  .then(function (r) { ok(r.rows[0].done && r.rows[0].replay_result === 'PERSISTED' && String(r.rows[0].replay_message_id) === String(ids.replayMsg), 'ledger row marked replayed with result and message id'); return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE resource = 'inbound_events' AND record_id = $1", [String(ids.dl)]); })
  .then(function (r) { ok(r.rows[0].n === 1, 'replay audited'); return q("SELECT count(*)::int AS n FROM wp_messages WHERE provider_message_id = 'R1' AND inbox_id = $1", [ibE.id]); })
  .then(function (r) { ok(r.rows[0].n === 1, 'exactly one message after replay (unique provider id)'); return reconcile.replay(pool, 999999999, 'cli:test', {}).then(function () { ok(false, 'unknown id'); }, function (e) { ok(e.status === 404, 'replay of unknown event → 404'); }); })
  .then(function () { return req('POST', '/hooks/evolution', { event: 'messages.upsert', instance: 'hard-unknown', data: { key: { remoteJid: '21699000002@s.whatsapp.net', fromMe: false, id: 'R3' }, message: { conversation: 'live one' } } }, { 'Content-Type': 'application/json', 'x-mythos-webhook-token': TOKEN }); })
  .then(function (x) { ok(x.status === 200 && x.body.persisted === true, 'receiver still persists on the registered provider'); return q("SELECT id, event_name FROM wp_inbound_events WHERE status = 'persisted' AND provider_message_id = 'R3'"); })
  .then(function (r) { ok(r.rows[0] && r.rows[0].event_name === 'message.received', 'persisted ledger row carries message.received'); return reconcile.replay(pool, r.rows[0].id, 'cli:test', {}).then(function () { ok(false, 'persisted event must not be replayable'); }, function (e) { ok(e.status === 412, 'only failed/rejected events are replayable'); }); })
  // ---- receiver on the registry + signed-provider path + providers endpoint
  .then(function () { return req('POST', '/hooks/fake', { event: 'fake.message' }, { 'Content-Type': 'application/json' }); })
  .then(function (x) { ok(x.status === 401 && x.body.reason === 'SIGNATURE_MISMATCH', 'signed provider path: unsigned body refused by the provider verifier (' + x.status + ')'); return req('POST', '/hooks/nope', {}, { 'Content-Type': 'application/json' }); })
  .then(function (x) { ok(x.status === 404, 'unregistered provider route → 404'); return req('POST', '/hooks/evolution', { event: 'messages.upsert', instance: 'hard-unknown', data: { key: { remoteJid: '21699000002@s.whatsapp.net', fromMe: false, id: 'R2' }, message: { conversation: 'x' } } }, { 'Content-Type': 'application/json' }); })
  .then(function (x) { ok(x.status === 401 && x.body.reason === 'WEBHOOK_TOKEN_MISSING', 'evolution verification unchanged: no token → 401'); return req('POST', '/api/login', { username: 'op', password: 'operator-password-1' }); })
  .then(function (x) { COOKIE = x.cookie; return req('GET', '/api/comms/providers'); })
  .then(function (x) { ok(x.status === 200 && x.data.providers.some(function (p) { return p.id === 'evolution' && p.capabilities.signed_webhooks === false; }), 'providers endpoint exposes capabilities'); ok(JSON.stringify(x.data).indexOf('SECRET') === -1 && !/[0-9a-f]{32,}/.test(JSON.stringify(x.data)), 'providers endpoint carries no secret'); })
  .then(function () { return new Promise(function (resolve) { server.close(resolve); }); })
  .then(wipe).then(function () { return pool.end(); }).then(function () { finish(); })
  .catch(function (e) { console.error('ERROR: ' + (e && e.stack || e)); failed++; pool.end().catch(function () {}); finish(1); });
