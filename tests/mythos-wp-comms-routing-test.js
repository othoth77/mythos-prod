'use strict';
// =====================================================
// MYTHOS WP — shared-account routing & privacy guard (MYTHOS-COMMS-11, #228)
// One provider instance ("shared-inst") hosts TWO logical inboxes (projects A and B).
// Proves, through the real receiver (HTTP, token, DB):
//   privacy   — an unrouted personal message is DROPPED before any ledger row: no contact,
//               no conversation, no message, no payload, no dead-letter; hashes only
//   routing   — allowlist, opt-in (identity + optional token + window), priority, disabled,
//               LID identity; default deny
//   isolation — routes are bound to (inbox, project, instance) at schema level; A never sees B
//   owner     — the account owner / self-chat / own messages never create customer data
//   security  — malformed rule, missing account_ref, missing policy, unknown inbox fail closed;
//               reserved-account guard stays strict outside the explicit shared opt-in
//   idempotency, replay through the guard, delivery status on a shared instance
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
function finish(code) { console.log('mythos-wp-comms-routing: ' + passed + ' passed, ' + failed + ' failed'); process.exit(code !== undefined ? code : (failed ? 1 : 0)); }
if (!TEST_URL) { console.error('MYTHOS_WP_TEST_DB_URL not set'); finish(process.env.MYTHOS_WP_ALLOW_SKIP === '1' ? 0 : 3); }
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-route-'));
var TOKEN = 'test-webhook-token-0123456789abcdef'; var tokenFile = path.join(tmp, 'webhook.token'); fs.writeFileSync(tokenFile, TOKEN + '\n', { mode: 0o600 });
process.env.MYTHOS_WP_USERS_FILE = path.join(tmp, 'users.json'); process.env.MYTHOS_WP_INSECURE_COOKIE = '1';
process.env.MYTHOS_WP_WEBHOOK_TOKEN_FILE = tokenFile; process.env.MYTHOS_WP_RECEIVER_ENABLED = '1'; process.env.MYTHOS_WP_CATALOG_TEST = TEST_URL;
delete process.env.MYTHOS_WP_COMMS_CONFIG; delete process.env.MYTHOS_WP_EVOLUTION_API_KEY_FILE;
var u = new URL(TEST_URL); process.env.MYTHOS_WP_DB_HOST = u.hostname; process.env.MYTHOS_WP_DB_PORT = u.port || '5432'; process.env.MYTHOS_WP_DB_USER = decodeURIComponent(u.username); process.env.MYTHOS_WP_DB_PASSWORD = decodeURIComponent(u.password); process.env.MYTHOS_WP_DB_NAME = u.pathname.slice(1);
var auth = require(path.join(WP, 'reference/auth'));
var migrate = require(path.join(WP, 'reference/migrate'));
var db = require(path.join(WP, 'reference/db'));
var receiver = require(path.join(WP, 'reference/comms/receiver'));
var routing = require(path.join(WP, 'reference/comms/routing'));
var reconcile = require(path.join(WP, 'reference/comms/reconcile'));
var inbox = require(path.join(WP, 'reference/comms/inbox'));
var pool = db.wp();
fs.writeFileSync(process.env.MYTHOS_WP_USERS_FILE, JSON.stringify({ users: [{ username: 'own', role: 'owner', scrypt: auth.hashPassword('owner-password-1') }, { username: 'op', role: 'operator', scrypt: auth.hashPassword('operator-password-1') }] }), { mode: 0o600 });
process.stdout.write = (function (orig) { return function (s) { if (typeof s === 'string' && s.indexOf('"receiver"') !== -1) return true; return orig.apply(process.stdout, arguments); }; })(process.stdout.write.bind(process.stdout));
var server = require(path.join(WP, 'reference/server')).createServer();
var PORT = 0, COOKIE = {};
function req(method, p, body, who) {
  return new Promise(function (resolve, reject) {
    var data = body !== undefined ? JSON.stringify(body) : null;
    var h = { 'Content-Type': 'application/json', 'X-Requested-With': 'MythosWP' }; if (data) h['Content-Length'] = Buffer.byteLength(data); if (who && COOKIE[who]) h.Cookie = COOKIE[who];
    var rq = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: h, agent: false }, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j, data: j && j.data, cookie: (res.headers['set-cookie'] || [''])[0].split(';')[0] }); }); });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}
function hook(payload) {
  var data = JSON.stringify(payload); var h = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }; h[receiver.TOKEN_HEADER] = TOKEN;
  return new Promise(function (resolve, reject) { var rq = http.request({ host: '127.0.0.1', port: PORT, path: '/hooks/evolution', method: 'POST', headers: h, agent: false }, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j }); }); }); rq.on('error', reject); rq.end(data); });
}
function q(sql, p) { return pool.query(sql, p || []); }
var OWNER = '21698000660';
var INST = 'shared-inst';
function msg(id, from, text, o) { o = o || {}; var key = o.lid ? { remoteJid: o.lid + '@lid', senderPn: from + '@s.whatsapp.net', fromMe: !!o.fromMe, id: id } : { remoteJid: from + '@s.whatsapp.net', fromMe: !!o.fromMe, id: id }; return { event: 'messages.upsert', instance: o.instance || INST, sender: OWNER + '@s.whatsapp.net', data: { key: key, pushName: o.name || 'Someone', message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) } }; }
function status(id, st) { return { event: 'messages.update', instance: INST, data: { keyId: id, status: st, fromMe: true } }; }
function counts() {
  return Promise.all([q('SELECT count(*)::int AS n FROM wp_contacts'), q('SELECT count(*)::int AS n FROM wp_conversations'), q('SELECT count(*)::int AS n FROM wp_messages'), q('SELECT count(*)::int AS n FROM wp_inbound_events'), q('SELECT count(*)::int AS n FROM wp_routing_drops'), q('SELECT count(*)::int AS n FROM wp_ai_runs'), q('SELECT count(*)::int AS n FROM wp_handoffs')])
    .then(function (r) { return { contacts: r[0].rows[0].n, conversations: r[1].rows[0].n, messages: r[2].rows[0].n, ledger: r[3].rows[0].n, drops: r[4].rows[0].n, ai_runs: r[5].rows[0].n, handoffs: r[6].rows[0].n }; });
}
// content leak scan across every table that could hold text (payload, raw, text, next/previous, notes)
function leak(marker) {
  return q("SELECT (SELECT count(*) FROM wp_inbound_events WHERE payload::text LIKE $1) + (SELECT count(*) FROM wp_messages WHERE coalesce(text,'') LIKE $1 OR coalesce(raw::text,'') LIKE $1) + (SELECT count(*) FROM wp_conversation_events WHERE payload::text LIKE $1) + (SELECT count(*) FROM wp_audit_events WHERE coalesce(next::text,'') LIKE $1 OR coalesce(previous::text,'') LIKE $1) + (SELECT count(*) FROM wp_contacts WHERE coalesce(display_name,'') LIKE $1 OR coalesce(wa_id,'') LIKE $1) + (SELECT count(*) FROM wp_contact_identities WHERE value LIKE $1) AS n", ['%' + marker + '%']).then(function (r) { return parseInt(r.rows[0].n, 10); });
}
function wipe() {
  var steps = ["UPDATE wp_messages SET ai_run_id = NULL", "DELETE FROM wp_routing_drops", "DELETE FROM wp_inbox_routes", "DELETE FROM wp_inbound_events", "DELETE FROM wp_message_attachments", "DELETE FROM wp_conversation_events", "DELETE FROM wp_ai_suggestions", "DELETE FROM wp_ai_runs", "DELETE FROM wp_messages", "DELETE FROM wp_handoffs", "DELETE FROM wp_conversation_tags", "DELETE FROM wp_conversations", "DELETE FROM wp_contact_identities", "DELETE FROM wp_contact_tags", "DELETE FROM wp_contacts", "DELETE FROM wp_tags", "DELETE FROM wp_inbox_members", "DELETE FROM wp_audit_events", "DELETE FROM wp_inboxes", "DELETE FROM wp_reserved_accounts", "DELETE FROM wp_knowledge", "DELETE FROM wp_business_rules", "DELETE FROM wp_stock", "DELETE FROM wp_product_commercial", "DELETE FROM wp_projects"];
  var chain = Promise.resolve(); steps.forEach(function (s) { chain = chain.then(function () { return q(s); }); }); return chain;
}
function expectDbError(p, re, name) { return p.then(function () { ok(false, name + ' (no error)'); }, function (e) { ok(re.test(e.message) || re.test(e.constraint || ''), name + ' (' + (e.constraint || e.message).slice(0, 60) + ')'); }); }
var ids = {}, base;
migrate.up(pool).then(wipe)
  .then(function () { return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { PORT = server.address().port; resolve(); }); }); })
  .then(function () { return req('POST', '/api/login', { username: 'own', password: 'owner-password-1' }); }).then(function (x) { COOKIE.own = x.cookie; return req('POST', '/api/login', { username: 'op', password: 'operator-password-1' }); }).then(function (x) { COOKIE.op = x.cookie; })
  .then(function () { return q("INSERT INTO wp_projects (id, display_name, kind, catalog_dsn_env) VALUES ('svc-a','Service A','service','MYTHOS_WP_CATALOG_TEST'), ('svc-b','Service B','service','MYTHOS_WP_CATALOG_TEST'), ('ded','Dedicated','service','MYTHOS_WP_CATALOG_TEST')"); })
  .then(function () { return q("INSERT INTO wp_reserved_accounts (account_ref, reason) VALUES ($1, 'notification channel')", [OWNER]); })
  // ---------- reserved-account guard: strict outside the explicit shared opt-in
  .then(function () { return expectDbError(q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, account_ref) VALUES ('svc-a','evolution',$1,'x',$2)", [INST, OWNER]), /account_reserved/, 'guard: reserved account refused in dedicated mode'); })
  .then(function () { return expectDbError(q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, account_ref, settings) VALUES ('svc-a','evolution',$1,'x',$2,'{\"allow_personal_account\":true}')", [INST, OWNER]), /account_reserved/, 'guard: reserved account refused with opt-in but WITHOUT shared mode'); })
  .then(function () { return expectDbError(q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, account_ref, account_mode) VALUES ('svc-a','evolution',$1,'x',$2,'shared')", [INST, OWNER]), /account_reserved/, 'guard: shared mode WITHOUT opt-in refused'); })
  .then(function () { return expectDbError(q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, account_mode, settings) VALUES ('svc-a','evolution',$1,'x','shared','{\"allow_personal_account\":true}')", [INST]), /shared_needs_account/, 'guard: shared mode with NULL account_ref fails closed'); })
  .then(function () { return expectDbError(q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name) VALUES ('svc-a','evolution','mythos-bridge','x')"), /not_bridge/, 'guard: mythos-bridge still refused as a dedicated inbox'); })
  .then(function () { return expectDbError(q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, account_mode) VALUES ('svc-a','evolution','x','x','wildcard')"), /account_mode_domain/, 'guard: unknown account_mode refused'); })
  // ---------- explicit shared opt-in (audited), two logical inboxes on ONE instance
  .then(function () { return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, account_ref, account_mode, settings, inbound_enabled, status) VALUES ('svc-a','evolution',$1,'Service A on shared',$2,'shared','{\"allow_personal_account\":true}', true, 'open') RETURNING id", [INST, OWNER]); })
  .then(function (r) { ids.a = r.rows[0].id; ok(!!ids.a, 'shared inbox A created with explicit opt-in'); return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, account_ref, account_mode, settings, inbound_enabled, status) VALUES ('svc-b','evolution',$1,'Service B on shared',$2,'shared','{\"allow_personal_account\":true}', true, 'open') RETURNING id", [INST, OWNER]); })
  .then(function (r) { ids.b = r.rows[0].id; ok(!!ids.b, 'second logical inbox B on the SAME instance'); return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE actor = 'db:wp_inboxes_guard' AND resource = 'inboxes' AND (next->>'shared_account_optin')::boolean"); })
  .then(function (r) { ok(r.rows[0].n === 2, 'shared opt-in audited per inbox (' + r.rows[0].n + ')'); return q("SELECT next::text AS t FROM wp_audit_events WHERE actor = 'db:wp_inboxes_guard' LIMIT 1"); })
  .then(function (r) { ok(r.rows[0].t.indexOf(OWNER) === -1 && r.rows[0].t.indexOf(OWNER.slice(-4)) !== -1, 'audit masks the account number'); return expectDbError(q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name) VALUES ('ded','evolution',$1,'x')", [INST]), /dedicated_uidx/, 'guard: a dedicated inbox cannot join a shared instance'); })
  .then(function () { return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, inbound_enabled, status) VALUES ('ded','evolution','ded-inst','Dedicated', true, 'open') RETURNING id"); })
  .then(function (r) { ids.ded = r.rows[0].id; return expectDbError(q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, account_ref, account_mode, settings) VALUES ('svc-a','evolution','ded-inst','x','21600000009','shared','{\"allow_personal_account\":true}')"), /dedicated_uidx/, 'guard: a shared inbox cannot join a dedicated instance'); })
  .then(function () { return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, account_ref, account_mode, settings) VALUES ('svc-a','evolution','mythos-bridge','Bridge shared',$1,'shared','{\"allow_personal_account\":true}') RETURNING id", [OWNER]); })
  .then(function (r) { ok(!!r.rows[0].id, 'mythos-bridge accepted ONLY as an explicit shared inbox (architecture change, tested)'); return q('DELETE FROM wp_inboxes WHERE id = $1', [r.rows[0].id]); })
  // ---------- PRIVACY: unrouted personal message → drop before ledger
  .then(function () { return counts(); }).then(function (c) { base = c; return hook(msg('P1', '21655000111', 'PERSONAL-SECRET-TEXT-1 rendezvous ce soir')); })
  .then(function (x) { ok(x.status === 200 && x.body.dropped === true && x.body.reason === 'UNROUTED', 'privacy: unrouted personal message dropped (UNROUTED)'); return counts(); })
  .then(function (c) {
    ok(c.contacts === base.contacts, 'privacy: no contact created'); ok(c.conversations === base.conversations, 'privacy: no conversation created'); ok(c.messages === base.messages, 'privacy: no message created');
    ok(c.ledger === base.ledger, 'privacy: no dead-letter / ledger row at all'); ok(c.drops === base.drops + 1, 'privacy: exactly one hash-only drop record');
    return q('SELECT * FROM wp_routing_drops ORDER BY id DESC LIMIT 1');
  })
  .then(function (r) { var d = r.rows[0]; var t = JSON.stringify(d); ok(d.reason === 'UNROUTED' && d.decision === 'drop' && /^[0-9a-f]{64}$/.test(d.identity_sha256) && /^[0-9a-f]{64}$/.test(d.payload_sha256), 'privacy: drop record = decision + reason + hashes'); ok(t.indexOf('21655000111') === -1 && t.indexOf('PERSONAL') === -1 && t.indexOf('P1') === -1, 'privacy: drop record carries no number, no message id, no text'); return leak('PERSONAL-SECRET-TEXT-1'); })
  .then(function (n) { ok(n === 0, 'privacy: message content nowhere in the database'); return leak('21655000111'); })
  .then(function (n) { ok(n === 0, 'privacy: personal sender number nowhere in the database'); })
  // ---------- ROUTING: allowlist
  .then(function () { return req('POST', '/api/projects/svc-a/comms/routes', { inbox_id: ids.a, kind: 'allowlist', identity_kind: 'phone', identity_value: '21655000222', note: 'customer A' }, 'own'); })
  .then(function (x) { ok(x.status === 201 && x.data && x.data.id, 'route: allowlist rule created via API (' + x.status + ')'); ids.r1 = x.data && x.data.id; return req('POST', '/api/projects/svc-a/comms/routes', { inbox_id: ids.a, kind: 'allowlist', identity_kind: 'phone', identity_value: '21655000333' }, 'op'); })
  .then(function (x) { ok(x.status === 403, 'route: operators cannot create rules (' + x.status + ')'); return hook(msg('A1', '21655000222', 'Bonjour, je cherche une pièce')); })
  .then(function (x) { ok(x.status === 200 && x.body.accepted === true && x.body.persisted === true, 'route: allowlisted sender persisted'); return q("SELECT c.project_id, c.inbox_id, m.text FROM wp_conversations c JOIN wp_messages m ON m.conversation_id = c.id"); })
  .then(function (r) { ok(r.rows.length === 1 && r.rows[0].project_id === 'svc-a' && r.rows[0].inbox_id === ids.a, 'route: conversation lands in project A / inbox A'); ids.convA = null; return q('SELECT id FROM wp_conversations LIMIT 1'); })
  .then(function (r) { ids.convA = r.rows[0].id; return hook(msg('A1', '21655000222', 'Bonjour, je cherche une pièce')); })
  .then(function (x) { ok(x.status === 200 && x.body.duplicate === true, 'idempotency: same provider message id → duplicate'); return counts(); })
  .then(function (c) { ok(c.conversations === base.conversations + 1 && c.messages === base.messages + 1, 'idempotency: one conversation, one message'); })
  // ---------- ROUTING: second project on the same instance, isolation
  .then(function () { return req('POST', '/api/projects/svc-b/comms/routes', { inbox_id: ids.a, kind: 'allowlist', identity_kind: 'phone', identity_value: '21655000444' }, 'own'); })
  .then(function (x) { ok(x.status === 404, 'isolation: project B cannot bind a rule to inbox A (' + x.status + ')'); return expectDbError(q("INSERT INTO wp_inbox_routes (project_id, inbox_id, provider, instance, kind, identity_kind, identity_value) VALUES ('svc-b', $1, 'evolution', $2, 'allowlist', 'phone', '21655000444')", [ids.a, INST]), /wp_inbox_routes_inbox_fk/, 'isolation: schema refuses a route whose inbox belongs to another project'); })
  .then(function () { return expectDbError(q("INSERT INTO wp_inbox_routes (project_id, inbox_id, provider, instance, kind, identity_kind, identity_value) VALUES ('svc-b', $1, 'evolution', 'other-inst', 'allowlist', 'phone', '21655000444')", [ids.b]), /wp_inbox_routes_inbox_fk/, 'isolation: schema refuses a route whose instance differs from the inbox'); })
  .then(function () { return req('POST', '/api/projects/svc-b/comms/routes', { inbox_id: ids.b, kind: 'allowlist', identity_kind: 'phone', identity_value: '21655000444' }, 'own'); })
  .then(function (x) { ok(x.status === 201, 'route: allowlist for project B'); return hook(msg('B1', '21655000444', 'Salam, rendez-vous?')); })
  .then(function (x) { ok(x.body.persisted === true, 'route: B sender persisted'); return q("SELECT project_id, inbox_id FROM wp_conversations WHERE contact_id IN (SELECT id FROM wp_contacts WHERE wa_id = '21655000444')"); })
  .then(function (r) { ok(r.rows.length === 1 && r.rows[0].project_id === 'svc-b' && r.rows[0].inbox_id === ids.b, 'isolation: B traffic lands in project B / inbox B only'); return inbox.listConversations(pool, 'svc-a', {}); })
  .then(function (r) { ok(r.items.length === 1 && r.items.every(function (c) { return c.inbox_id === ids.a; }), 'isolation: project A lists only its own conversation'); return req('GET', '/api/projects/svc-a/comms/routes', undefined, 'own'); })
  .then(function (x) { ok(x.status === 200 && x.data.items.length === 1 && x.data.items[0].identity_tail === '0222' && !('identity_value' in x.data.items[0]), 'isolation: rule listing is project-scoped and shows only the identity tail'); return expectDbError(q("INSERT INTO wp_inbox_routes (project_id, inbox_id, provider, instance, kind, identity_kind, identity_value) VALUES ('svc-a', $1, 'evolution', $2, 'allowlist', 'phone', '21655000222')", [ids.a, INST]), /one_target/, 'route: one identity → one target per instance'); })
  // ---------- ROUTING: opt-in (identity pre-registered + token second factor + window)
  .then(function () { return routing.addRule(pool, 'svc-a', { inbox_id: ids.a, kind: 'opt_in', identity_kind: 'phone', identity_value: '21655000555', opt_in_code: 'SYA-4F7K2', ttl_hours: 1 }, 'own'); })
  .then(function (r) { ids.optin = r.id; ok(r.kind === 'opt_in' && r.expires_at, 'opt-in: rule pre-registers the identity with a window'); return hook(msg('O1', '21655000555', 'hello without code')); })
  .then(function (x) { ok(x.body.dropped === true && x.body.reason === 'TOKEN_REQUIRED', 'opt-in: pre-registered identity WITHOUT the token is still dropped'); return hook(msg('O1x', '21655000999', 'SYA-4F7K2 I know the code')); })
  .then(function (x) { ok(x.body.dropped === true && x.body.reason === 'UNROUTED', 'opt-in: the token alone (unknown identity) never routes — keyword is not the boundary'); return hook(msg('O2', '21655000555', 'Bonjour SYA-4F7K2 je confirme')); })
  .then(function (x) { ok(x.body.persisted === true, 'opt-in: identity + token → routed'); return q('SELECT activated_at FROM wp_inbox_routes WHERE id = $1', [ids.optin]); })
  .then(function (r) { ok(!!r.rows[0].activated_at, 'opt-in: rule activated on first routed inbound'); return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE actor = 'system:routing' AND record_id = $1", [String(ids.optin)]); })
  .then(function (r) { ok(r.rows[0].n === 1, 'opt-in: activation audited'); return hook(msg('O3', '21655000555', 'suite sans code')); })
  .then(function (x) { ok(x.body.persisted === true, 'opt-in: once activated, later messages route without the token'); return q("UPDATE wp_inbox_routes SET activated_at = NULL, expires_at = now() - interval '1 minute' WHERE id = $1", [ids.optin]); })
  .then(function () { return hook(msg('O4', '21655000555', 'SYA-4F7K2 trop tard')); })
  .then(function (x) { ok(x.body.dropped === true && x.body.reason === 'RULE_EXPIRED', 'opt-in: expired window fails closed'); return routing.setRuleEnabled(pool, 'svc-a', ids.r1, false, 'own'); })
  .then(function () { return hook(msg('A9', '21655000222', 'après désactivation')); })
  .then(function (x) { ok(x.body.dropped === true && x.body.reason === 'UNROUTED', 'route: disabled rule = deny'); return routing.setRuleEnabled(pool, 'svc-a', ids.r1, true, 'own'); })
  .then(function () { return routing.setRuleEnabled(pool, 'svc-b', ids.r1, false, 'own').then(function () { ok(false, 'cross-project disable must fail'); }, function (e) { ok(e.status === 404, 'isolation: project B cannot disable a project A rule'); }); })
  // LID-addressed sender routed by its phone identity; LID-only rule too
  .then(function () { return hook(msg('L1', '21655000222', 'via lid', { lid: '123456789012345' })); })
  .then(function (x) { ok(x.body.persisted === true, 'route: LID-addressed message resolves through the phone identity'); return routing.addRule(pool, 'svc-b', { inbox_id: ids.b, kind: 'allowlist', identity_kind: 'lid', identity_value: '555555555555555' }, 'own'); })
  .then(function () { return hook(msg('L2', '21655000777', 'lid rule', { lid: '555555555555555' })); })
  .then(function (x) { ok(x.body.persisted === true, 'route: LID identity rule routes'); return q("SELECT project_id FROM wp_conversations WHERE contact_id IN (SELECT contact_id FROM wp_contact_identities WHERE kind = 'lid' AND value = '555555555555555')"); })
  .then(function (r) { ok(r.rows.length === 1 && r.rows[0].project_id === 'svc-b', 'route: LID rule lands in its project'); })
  // ---------- OWNER / SELF exclusion
  .then(function () { return routing.addRule(pool, 'svc-a', { inbox_id: ids.a, kind: 'allowlist', identity_kind: 'phone', identity_value: OWNER }, 'own').then(function () { ok(false, 'owner route must be refused'); }, function (e) { ok(e.status === 412, 'owner: cannot be allowlisted as a customer (' + e.status + ')'); }); })
  .then(function () { return expectDbError(q("INSERT INTO wp_inbox_routes (project_id, inbox_id, provider, instance, kind, identity_kind, identity_value) VALUES ('svc-a', $1, 'evolution', $2, 'allowlist', 'phone', $3)", [ids.a, INST, OWNER]), /owner_excluded/, 'owner: schema refuses a route for the account owner'); })
  .then(function () { return counts(); }).then(function (c) { base = c; return hook(msg('S1', OWNER, 'note to self', { name: 'Me' })); })
  .then(function (x) { ok(x.status === 200 && x.body.accepted === false && /SELF_CHAT_IGNORED/.test(x.body.reason), 'owner: self-chat ignored by the adapter'); return hook(msg('S2', '21655000222', 'reply typed on the phone', { fromMe: true })); })
  .then(function (x) { ok(x.body.accepted === false && /OWN_MESSAGE/.test(x.body.reason), 'owner: own message (phone-side reply / bridge notification) not ingested'); return hook({ event: 'messages.upsert', instance: INST, sender: '21600000000@s.whatsapp.net', data: { key: { remoteJid: OWNER + '@s.whatsapp.net', fromMe: false, id: 'S3' }, pushName: 'Owner', message: { conversation: 'inbound from the owner number' }, messageTimestamp: Math.floor(Date.now() / 1000) } }); })
  .then(function (x) { ok(x.body.dropped === true && x.body.reason === 'OWNER_EXCLUDED', 'owner: inbound from the account owner number is dropped even on a routed instance'); return hook(status('NOTIF-1', 'DELIVERY_ACK')); })
  .then(function (x) { ok(x.status === 200 && x.body.updated === false, 'owner: delivery event for a bridge notification is ignored'); return hook(status('NOTIF-1', 'READ')); })
  .then(function (x) { ok(x.status === 200 && x.body.updated === false, 'owner: read event for a bridge notification is ignored'); return counts(); })
  .then(function (c) { ok(c.contacts === base.contacts && c.conversations === base.conversations && c.messages === base.messages && c.ai_runs === 0 && c.handoffs === 0, 'owner: no contact / conversation / message / AI run / handoff from any owner-side event'); return q("SELECT count(*)::int AS n FROM wp_inbound_events WHERE payload IS NOT NULL AND instance = $1", [INST]); })
  .then(function (r) { ok(r.rows[0].n === 0, 'owner: no payload kept for any ignored owner-side event'); return leak(OWNER); })
  .then(function (n) { ok(n === 0, 'owner: the owner number never appears as contact/identity data'); })
  // ---------- delivery status for OUR outbound on a shared instance
  .then(function () { return q("INSERT INTO wp_messages (project_id, conversation_id, contact_id, inbox_id, direction, provider, provider_message_id, message_type, text, sender_kind, status) SELECT 'svc-a', id, contact_id, inbox_id, 'out', 'evolution', 'OUT-A1', 'text', 'reply', 'user', 'sent' FROM wp_conversations WHERE id = $1", [ids.convA]); })
  .then(function () { return hook(status('OUT-A1', 'READ')); })
  .then(function (x) { ok(x.body.updated === true && x.body.status === 'read', 'status: our outbound on the shared instance is updated by instance-level lookup'); })
  // ---------- SECURITY: fail closed
  .then(function () {
    var ibA = { id: ids.a, project_id: 'svc-a', account_mode: 'shared', account_ref: OWNER }; var ibB = { id: ids.b, project_id: 'svc-b', account_mode: 'shared', account_ref: OWNER };
    var ev = { provider: 'evolution', text: 'x', contact: { identities: [{ kind: 'phone', value: '21655000888' }] } };
    ok(routing.decide([], [], ev).reason === 'INBOX_UNKNOWN', 'fail closed: unknown inbox');
    ok(routing.decide([ibA, ibB], [], ev).reason === 'UNROUTED', 'fail closed: shared instance without any policy = deny');
    ok(routing.decide([ibA, { id: 9, project_id: 'ded', account_mode: 'dedicated' }], [], ev).reason === 'ROUTING_AMBIGUOUS', 'fail closed: dedicated + shared on one instance');
    ok(routing.decide([ibA], [{ id: 1, inbox_id: ids.a, project_id: 'svc-a', kind: 'wildcard', identity_kind: 'phone', identity_value: '21655000888', enabled: true, priority: 1 }], ev).reason === 'RULE_MALFORMED', 'fail closed: malformed rule kind');
    ok(routing.decide([ibA], [{ id: 1, inbox_id: ids.a, project_id: 'svc-a', kind: 'allowlist', identity_kind: 'phone', identity_value: '*', enabled: true, priority: 1 }], { provider: 'evolution', contact: { identities: [{ kind: 'phone', value: '*' }] } }).routed === false, 'fail closed: wildcard identity refused');
    ok(routing.decide([ibA], [{ id: 1, inbox_id: ids.b, project_id: 'svc-b', kind: 'allowlist', identity_kind: 'phone', identity_value: '21655000888', enabled: true, priority: 1 }], ev).reason === 'RULE_MALFORMED', 'fail closed: rule pointing outside the instance inboxes');
    ok(routing.decide([ibA], [{ id: 1, inbox_id: ids.a, project_id: 'svc-a', kind: 'allowlist', identity_kind: 'phone', identity_value: '21655000888', enabled: false, priority: 1 }], ev).reason === 'UNROUTED', 'fail closed: disabled rule');
    ok(routing.decide([ibA], [], { provider: 'evolution', contact: { identities: [] } }).reason === 'IDENTITY_MISSING', 'fail closed: no identity');
    ok(routing.decide([ibA], [], { provider: 'evolution', contact: { identities: [{ kind: 'phone', value: OWNER }] } }).reason === 'OWNER_EXCLUDED', 'fail closed: owner identity');
    ok(routing.decide([ibA], [], { provider: 'evolution', contact: { identities: [{ kind: 'phone', value: '21600000660' }] } }, { reserved: ['21600000660'] }).reason === 'OWNER_EXCLUDED', 'fail closed: reserved account identity');
    var both = routing.decide([ibA, ibB], [{ id: 2, inbox_id: ids.b, project_id: 'svc-b', kind: 'allowlist', identity_kind: 'phone', identity_value: '21655000888', enabled: true, priority: 5 }, { id: 1, inbox_id: ids.a, project_id: 'svc-a', kind: 'allowlist', identity_kind: 'phone', identity_value: '21655000888', enabled: true, priority: 50 }], ev);
    ok(both.routed && both.inbox.id === ids.b, 'priority: lower priority value wins deterministically');
    ok(routing.decide([{ id: ids.ded, project_id: 'ded', account_mode: 'dedicated' }], [], ev).routed === true, 'compat: a dedicated instance keeps COMMS-1..9 behaviour (no rule needed)');
  })
  .then(function () { return hook(msg('U1', '21655000222', 'unknown instance', { instance: 'nope-inst' })); })
  .then(function (x) { ok(x.status === 202 && x.body.reason === 'INBOX_UNKNOWN', 'fail closed: unknown instance → 202 rejected (dead-letter, redacted) unchanged'); return hook(msg('D1', '21655000222', 'dedicated path', { instance: 'ded-inst' })); })
  .then(function (x) { ok(x.body.persisted === true, 'compat: dedicated instance ingests without any routing rule'); })
  // ---------- replay goes through the same guard
  .then(function () { return q("UPDATE wp_inbound_events SET instance = $1 WHERE instance = 'nope-inst' AND status = 'rejected'", [INST]); })
  .then(function () { return q("SELECT id FROM wp_inbound_events WHERE instance = $1 AND status = 'rejected' AND payload IS NOT NULL ORDER BY id DESC LIMIT 1", [INST]); })
  .then(function (r) { ids.dl = r.rows[0].id; return q("UPDATE wp_inbound_events SET payload = jsonb_set(payload, '{instance}', to_jsonb($2::text)) WHERE id = $1", [ids.dl, INST]); })
  .then(function () { return routing.setRuleEnabled(pool, 'svc-a', ids.r1, false, 'own'); })
  .then(function () { return reconcile.replay(pool, ids.dl, 'cli', { dryRun: false }); })
  .then(function (r) { ok(r.result === 'UNROUTED', 'replay: a dead-letter cannot bypass the guard (' + r.result + ')'); return routing.setRuleEnabled(pool, 'svc-a', ids.r1, true, 'own'); })
  .then(function () { return q("SELECT count(*)::int AS n FROM wp_routing_drops"); })
  .then(function (r) { ok(r.rows[0].n >= 6, 'drops ledger accumulates hash-only records (' + r.rows[0].n + ')'); return req('GET', '/api/comms/routing-drops?limit=5', undefined, 'op'); })
  .then(function (x) { ok(x.status === 403, 'drops listing is owner-only (' + x.status + ')'); return req('GET', '/api/comms/routing-drops?limit=5', undefined, 'own'); })
  .then(function (x) { ok(x.status === 200 && x.data.items.length === 5 && JSON.stringify(x.data.items).indexOf('2165') === -1, 'drops listing exposes no identities'); })
  .then(function () { return q("SELECT count(*)::int AS n FROM wp_inbound_events WHERE instance = $1 AND status = 'persisted' AND event_name = 'message.received'", [INST]); })
  .then(function (r) { ok(r.rows[0].n >= 5, 'ledger: routed messages are ledgered as usual (' + r.rows[0].n + ')'); })
  .then(function () { return wipe(); })
  .then(function () { server.close(); return pool.end(); })
  .then(function () { finish(); })
  .catch(function (e) { console.error('ERROR: ' + (e && e.stack || e)); failed++; try { server.close(); } catch (x) {} pool.end().catch(function () {}).then(function () { finish(1); }); });
