'use strict';
// =====================================================
// MYTHOS WP — Communication Core schema tests (MYTHOS-COMMS-1, #197)
// tests/mythos-wp-comms-schema-test.js
//
// Against mythos_wp_test (MYTHOS_WP_TEST_DB_URL, see deploy/provision-db.sh):
//   apply migration 0001 → tables + constraints present
//   fixtures: inbox/contact/conversation/message → exactly-once (duplicate
//   provider message id refused), one live conversation per contact+inbox,
//   mythos-bridge refused as an inbox, wa_id must be digits, handoff links to
//   a conversation, AI run/suggestion chain, cascade on attachments/tags
//   privacy: no column named like a secret in any new table; raw payload
//   with an apikey is refused by the receiver contract (checked here at the
//   schema level: the column exists, the test strips the key before insert)
//   rollback 0001 → every new table gone, wp_handoffs.conversation_id gone,
//   base tables intact; re-apply → idempotent.
// Without MYTHOS_WP_TEST_DB_URL the run exits 3 (MYTHOS_WP_ALLOW_SKIP=1 → 0).
// =====================================================
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var WP = path.join(ROOT, 'projects/mythos-wp');
var TEST_URL = process.env.MYTHOS_WP_TEST_DB_URL || null;
var passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.error('FAIL: ' + name); } }
function done(code) { console.log('mythos-wp-comms-schema: ' + passed + ' passed, ' + failed + ' failed'); process.exit(code !== undefined ? code : (failed ? 1 : 0)); }
if (!TEST_URL) { console.error('MYTHOS_WP_TEST_DB_URL not set — database tests skipped'); done(process.env.MYTHOS_WP_ALLOW_SKIP === '1' ? 0 : 3); }

var Pool = require(path.join(WP, 'node_modules/pg')).Pool;
var migrate = require(path.join(WP, 'reference/migrate'));
var pool = new Pool({ connectionString: TEST_URL, max: 2 });
var NEW_TABLES = ['wp_inboxes', 'wp_contacts', 'wp_conversations', 'wp_messages', 'wp_message_attachments', 'wp_conversation_events', 'wp_tags', 'wp_contact_tags', 'wp_conversation_tags', 'wp_ai_runs', 'wp_ai_suggestions', 'wp_schema_migrations'];
var SECRET_COL = /(^|_)(token|secret|password|passwd|apikey|api_key|private_key|session_key|credential)($|_)/i; // token COUNTS (input_tokens) are not secrets

function q(sql, params) { return pool.query(sql, params || []); }
function tables() {
  return q("SELECT table_name FROM information_schema.tables WHERE table_schema='public'").then(function (r) { return r.rows.map(function (x) { return x.table_name; }); });
}
function expectError(p, re, name) {
  return p.then(function () { ok(false, name + ' (no error)'); }, function (e) { ok(re.test(String(e.message)), name + ' (' + String(e.message).slice(0, 80) + ')'); });
}
function cleanup() {
  // remove any leftover from a previous run before rollback checks
  return migrate.status(pool).then(function (s) {
    return s.applied.indexOf('0001_comms_core') !== -1 ? migrate.down(pool, '0001_comms_core') : null;
  }).then(function () { return q("DELETE FROM wp_handoffs WHERE project_id='comms-test'"); })
    .then(function () { return q("DELETE FROM wp_projects WHERE id='comms-test'"); });
}

var ids = {};
cleanup()
  .then(function () { return migrate.up(pool); })
  .then(function (r) {
    ok(r.applied.indexOf('0001_comms_core') !== -1, 'migration 0001 applied');
    return tables();
  })
  .then(function (t) {
    NEW_TABLES.forEach(function (n) { ok(t.indexOf(n) !== -1, 'table exists: ' + n); });
    return q("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name = ANY($1)", [NEW_TABLES]);
  })
  .then(function (r) {
    var leaks = r.rows.filter(function (c) { return SECRET_COL.test(c.column_name); });
    ok(leaks.length === 0, 'no secret-shaped column in new tables' + (leaks.length ? ' ' + JSON.stringify(leaks) : ''));
    return q("SELECT column_name FROM information_schema.columns WHERE table_name='wp_handoffs' AND column_name='conversation_id'");
  })
  .then(function (r) { ok(r.rows.length === 1, 'wp_handoffs.conversation_id added'); })
  // ---------------------------------------------------------- fixtures
  .then(function () { return q("INSERT INTO wp_projects (id, display_name, catalog_dsn_env) VALUES ('comms-test', 'Comms test', 'MYTHOS_WP_CATALOG_TEST')"); })
  .then(function () { return expectError(q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name) VALUES ('comms-test','evolution','mythos-bridge','x')"), /wp_inboxes_not_bridge/, 'mythos-bridge refused as an inbox'); })
  .then(function () { return expectError(q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name) VALUES ('comms-test','other','x','x')"), /provider_domain/, 'unknown provider refused'); })
  .then(function () { return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name) VALUES ('comms-test','evolution','comms-test-inbox','Test inbox') RETURNING id"); })
  .then(function (r) { ids.inbox = r.rows[0].id; ok(!!ids.inbox, 'inbox created (inbound_enabled default false)'); return q('SELECT inbound_enabled, outbound_enabled, status FROM wp_inboxes WHERE id=$1', [ids.inbox]); })
  .then(function (r) { ok(r.rows[0].inbound_enabled === false && r.rows[0].outbound_enabled === false && r.rows[0].status === 'inactive', 'inbox defaults are OFF/inactive'); })
  .then(function () { return expectError(q("INSERT INTO wp_contacts (project_id, wa_id) VALUES ('comms-test','+216 99 000')"), /wa_id_digits/, 'wa_id must be digits'); })
  .then(function () { return q("INSERT INTO wp_contacts (project_id, wa_id, display_name) VALUES ('comms-test','21699000000','Client Test') RETURNING id"); })
  .then(function (r) { ids.contact = r.rows[0].id; return expectError(q("INSERT INTO wp_contacts (project_id, wa_id) VALUES ('comms-test','21699000000')"), /wp_contacts_unique/, 'one contact per (project, wa_id)'); })
  .then(function () { return q("INSERT INTO wp_conversations (project_id, inbox_id, contact_id, provider_chat_id) VALUES ('comms-test',$1,$2,'21699000000') RETURNING id", [ids.inbox, ids.contact]); })
  .then(function (r) { ids.conv = r.rows[0].id; return expectError(q("INSERT INTO wp_conversations (project_id, inbox_id, contact_id, provider_chat_id) VALUES ('comms-test',$1,$2,'21699000000')", [ids.inbox, ids.contact]), /wp_conversations_live_uidx/, 'only one live conversation per contact+inbox'); })
  .then(function () { return q("UPDATE wp_conversations SET status='resolved', resolved_at=now() WHERE id=$1", [ids.conv]); })
  .then(function () { return q("INSERT INTO wp_conversations (project_id, inbox_id, contact_id, provider_chat_id) VALUES ('comms-test',$1,$2,'21699000000') RETURNING id", [ids.inbox, ids.contact]); })
  .then(function (r) { ok(!!r.rows[0].id, 'a new conversation can start once the previous one is resolved'); ids.conv2 = r.rows[0].id; })
  .then(function () {
    var raw = { key: { remoteJid: '21699000000@s.whatsapp.net', fromMe: false, id: 'ABC123' }, message: { conversation: 'Bonjour' }, apikey: 'SHOULD-NOT-BE-STORED' };
    delete raw.apikey; // receiver contract: credentials stripped before persistence
    return q("INSERT INTO wp_messages (project_id, conversation_id, contact_id, inbox_id, direction, provider_message_id, message_type, text, sender_kind, raw, provider_timestamp) VALUES ('comms-test',$1,$2,$3,'in','ABC123','text','Bonjour','customer',$4, now()) RETURNING id", [ids.conv2, ids.contact, ids.inbox, JSON.stringify(raw)]);
  })
  .then(function (r) { ids.msg = r.rows[0].id; return expectError(q("INSERT INTO wp_messages (project_id, conversation_id, contact_id, inbox_id, direction, provider_message_id, message_type, text, sender_kind) VALUES ('comms-test',$1,$2,$3,'in','ABC123','text','Bonjour again','customer')", [ids.conv2, ids.contact, ids.inbox]), /wp_messages_provider_uidx/, 'duplicate provider message id refused (exactly once)'); })
  .then(function () { return expectError(q("INSERT INTO wp_messages (project_id, conversation_id, contact_id, inbox_id, direction, message_type, text, sender_kind) VALUES ('comms-test',$1,$2,$3,'in','text','x','customer')", [ids.conv2, ids.contact, ids.inbox]), /provider_id_req/, 'inbound message without provider id refused'); })
  .then(function () { return q("INSERT INTO wp_messages (project_id, conversation_id, contact_id, inbox_id, direction, message_type, text, sender_kind, sender_ref) VALUES ('comms-test',$1,$2,$3,'activity','other','assigned','system','system:test') RETURNING id", [ids.conv2, ids.contact, ids.inbox]); })
  .then(function (r) { ok(!!r.rows[0].id, 'activity row allowed without provider id'); })
  .then(function () { return q("SELECT raw->>'apikey' AS k FROM wp_messages WHERE id=$1", [ids.msg]); })
  .then(function (r) { ok(r.rows[0].k === null, 'stored raw payload carries no apikey'); })
  .then(function () { return q("INSERT INTO wp_message_attachments (message_id, kind, mime_type, size_bytes, storage_ref) VALUES ($1,'image','image/jpeg',1234,'media/comms-test/abc') RETURNING id", [ids.msg]); })
  .then(function (r) { ids.att = r.rows[0].id; return expectError(q("INSERT INTO wp_message_attachments (message_id, kind) VALUES ($1,'exe')", [ids.msg]), /kind_domain/, 'unknown attachment kind refused'); })
  .then(function () { return q("INSERT INTO wp_tags (project_id, name, applies_to) VALUES ('comms-test','vip','both') RETURNING id"); })
  .then(function (r) { ids.tag = r.rows[0].id; return q("INSERT INTO wp_contact_tags (contact_id, tag_id, added_by) VALUES ($1,$2,'tester')", [ids.contact, ids.tag]); })
  .then(function () { return q("INSERT INTO wp_conversation_tags (conversation_id, tag_id, added_by) VALUES ($1,$2,'tester')", [ids.conv2, ids.tag]); })
  .then(function () { return expectError(q("INSERT INTO wp_tags (project_id, name) VALUES ('comms-test','VIP Client')"), /name_shape/, 'tag name shape enforced'); })
  .then(function () { return q("INSERT INTO wp_conversation_events (project_id, conversation_id, kind, actor, payload) VALUES ('comms-test',$1,'message_in','receiver','{}') RETURNING id", [ids.conv2]); })
  .then(function (r) { ok(!!r.rows[0].id, 'conversation event recorded'); })
  .then(function () { return q("INSERT INTO wp_ai_runs (project_id, conversation_id, message_id, kind, model, prompt_version, confidence, decision) VALUES ('comms-test',$1,$2,'suggest','test-model','v1',0.87,'suggest') RETURNING id", [ids.conv2, ids.msg]); })
  .then(function (r) { ids.run = r.rows[0].id; return expectError(q("INSERT INTO wp_ai_runs (project_id, conversation_id, confidence) VALUES ('comms-test',$1,1.5)", [ids.conv2]), /confidence/, 'confidence bounded to [0,1]'); })
  .then(function () { return q("INSERT INTO wp_ai_suggestions (run_id, conversation_id, text) VALUES ($1,$2,'Bonjour, la pièce est disponible.') RETURNING id", [ids.run, ids.conv2]); })
  .then(function (r) { ids.sugg = r.rows[0].id; return q("INSERT INTO wp_messages (project_id, conversation_id, contact_id, inbox_id, direction, provider_message_id, message_type, text, sender_kind, sender_ref, status, ai_run_id) VALUES ('comms-test',$1,$2,$3,'out','OUT1','text','Bonjour, la pièce est disponible.','user','tester','queued',$4) RETURNING id", [ids.conv2, ids.contact, ids.inbox, ids.run]); })
  .then(function (r) { ids.out = r.rows[0].id; return q("UPDATE wp_ai_suggestions SET status='sent', decided_by='tester', decided_at=now(), sent_message_id=$1 WHERE id=$2", [ids.out, ids.sugg]); })
  .then(function () { return q("SELECT s.status, m.ai_run_id FROM wp_ai_suggestions s JOIN wp_messages m ON m.id = s.sent_message_id WHERE s.id=$1", [ids.sugg]); })
  .then(function (r) { ok(r.rows[0].status === 'sent' && String(r.rows[0].ai_run_id) === String(ids.run), 'suggestion → outbound message → run chain links'); })
  .then(function () { return q("INSERT INTO wp_handoffs (project_id, reason, status, conversation_id) VALUES ('comms-test','REQUIRES_HUMAN','REQUIRES_HUMAN',$1) RETURNING id", [ids.conv2]); })
  .then(function (r) { ok(!!r.rows[0].id, 'handoff links to a conversation'); return expectError(q("INSERT INTO wp_handoffs (project_id, reason, conversation_id) VALUES ('comms-test','REQUIRES_HUMAN', 999999999)"), /foreign key/i, 'handoff to unknown conversation refused'); })
  // retention marker
  .then(function () { return q("UPDATE wp_messages SET text=NULL, raw=NULL, redacted_at=now() WHERE id=$1", [ids.msg]); })
  .then(function () { return q("SELECT count(*)::int AS n FROM wp_messages WHERE conversation_id=$1", [ids.conv2]); })
  .then(function (r) { ok(r.rows[0].n === 3, 'purged message row survives for counters (retention = redact, not delete)'); })
  // cascade
  .then(function () { return expectError(q("DELETE FROM wp_messages WHERE id=$1", [ids.msg]), /foreign key/i, 'a message referenced by an AI run cannot be deleted (integrity)'); })
  .then(function () { return q("UPDATE wp_ai_runs SET message_id=NULL WHERE message_id=$1", [ids.msg]); })
  .then(function () { return q("DELETE FROM wp_messages WHERE id=$1", [ids.msg]); })
  .then(function () { return q("SELECT count(*)::int AS n FROM wp_message_attachments WHERE id=$1", [ids.att]); })
  .then(function (r) { ok(r.rows[0].n === 0, 'attachments cascade with their message'); })
  // ---------------------------------------------------------- rollback
  .then(function () { return q("DELETE FROM wp_handoffs WHERE project_id='comms-test'"); })
  .then(function () { return migrate.down(pool, '0001_comms_core'); })
  .then(function (r) { ok(r.rolled_back === '0001_comms_core', 'rollback ran'); return tables(); })
  .then(function (t) {
    NEW_TABLES.filter(function (n) { return n !== 'wp_schema_migrations'; }).forEach(function (n) { ok(t.indexOf(n) === -1, 'table dropped: ' + n); });
    ['wp_projects', 'wp_handoffs', 'wp_audit_events', 'wp_knowledge', 'wp_stock', 'wp_product_commercial', 'wp_business_rules'].forEach(function (n) { ok(t.indexOf(n) !== -1, 'base table intact: ' + n); });
    return q("SELECT column_name FROM information_schema.columns WHERE table_name='wp_handoffs' AND column_name='conversation_id'");
  })
  .then(function (r) { ok(r.rows.length === 0, 'wp_handoffs.conversation_id removed on rollback'); })
  .then(function () { return migrate.up(pool); })
  .then(function (r) { ok(r.applied.indexOf('0001_comms_core') !== -1, 're-apply after rollback'); return migrate.up(pool); })
  .then(function (r) { ok(r.applied.length === 0, 'second up is a no-op (idempotent ledger)'); return migrate.status(pool); })
  .then(function (s) { ok(s.pending.length === 0 && s.applied.indexOf('0001_comms_core') !== -1, 'status reports applied/pending'); })
  .then(function () { return q("DELETE FROM wp_projects WHERE id='comms-test'"); })
  .then(function () { return pool.end(); })
  .then(function () { done(); })
  .catch(function (e) { console.error('ERROR: ' + (e && e.stack || e)); pool.end().catch(function () {}); failed++; done(1); });
