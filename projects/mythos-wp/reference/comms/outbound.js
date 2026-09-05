'use strict';
// =====================================================
// MYTHOS WP — human outbound (MYTHOS-COMMS-5)
// projects/mythos-wp/reference/comms/outbound.js
//
// send(pool, projectId, convId, actor, { text, client_ref }) →
//   { message_id, status, provider_message_id, duplicate }
// Rules: inbox must be `open` with outbound_enabled=true (412 otherwise);
// one wp_messages row per (conversation, client_ref) — a replay returns the
// existing row without a second send; per-conversation hourly cap; one
// automatic retry on a TRANSPORT error only; every send is journaled and
// audited by the caller; the credential is read at call time from a 0600
// file and never logged. mythos-bridge can never be an inbox (schema CHECK).
// =====================================================
var bus = require('./bus');
var providers = { evolution: require('./providers/evolution') };
var CAP_PER_HOUR = Math.max(1, parseInt(process.env.MYTHOS_WP_OUTBOUND_CAP_PER_HOUR || '30', 10) || 30);
var CLIENT_REF_RE = /^[A-Za-z0-9._:-]{8,64}$/;
function fail(code, status, detail) { var e = new Error(detail || code); e.code = code; e.status = status; return e; }
function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function attempt(provider, inbox, to, text) {
  var key = provider.readApiKey();
  if (!key.present) return Promise.resolve({ ok: false, status: null, provider_message_id: null, error: 'CONFIG: ' + key.reason });
  return provider.sendText({ baseUrl: provider.baseUrl(), instance: inbox.instance, apiKey: key.value, to: to, text: text, timeoutMs: 15000 });
}
function send(pool, projectId, convId, actor, body) {
  body = body || {};
  var text = String(body.text || '').trim();
  var ref = body.client_ref;
  if (!text || text.length > 4096) throw fail('validation', 400, 'text must be 1–4096 characters');
  if (!CLIENT_REF_RE.test(String(ref || ''))) throw fail('validation', 400, 'client_ref required (8–64 chars)');
  return pool.query('SELECT c.id, c.contact_id, c.inbox_id, c.status AS conv_status, i.instance, i.provider, i.status AS inbox_status, i.outbound_enabled, k.wa_id FROM wp_conversations c JOIN wp_inboxes i ON i.id = c.inbox_id JOIN wp_contacts k ON k.id = c.contact_id WHERE c.project_id = $1 AND c.id = $2', [projectId, convId]).then(function (r) {
    var c = r.rows[0];
    if (!c) throw fail('not_found', 404, 'no such conversation');
    var provider = providers[c.provider];
    if (!provider) throw fail('precondition', 412, 'provider not supported');
    return pool.query('SELECT id, status, provider_message_id FROM wp_messages WHERE conversation_id = $1 AND client_ref = $2', [convId, ref]).then(function (d) {
      if (d.rows[0]) return { message_id: d.rows[0].id, status: d.rows[0].status, provider_message_id: d.rows[0].provider_message_id, duplicate: true };
      if (!c.outbound_enabled) throw fail('precondition', 412, 'replies are not enabled for this inbox');
      if (c.inbox_status !== 'open') throw fail('precondition', 412, 'inbox is not connected (' + c.inbox_status + ')');
      return pool.query("SELECT count(*)::int AS n FROM wp_messages WHERE conversation_id = $1 AND direction = 'out' AND created_at > now() - interval '1 hour'", [convId]).then(function (n) {
        if (n.rows[0].n >= CAP_PER_HOUR) throw fail('rate_limited', 429, 'outbound cap reached for this conversation');
        return pool.query("INSERT INTO wp_messages (project_id, conversation_id, contact_id, inbox_id, direction, provider, message_type, text, sender_kind, sender_ref, status, client_ref, attempts) VALUES ($1,$2,$3,$4,'out',$5,'text',$6,'user',$7,'queued',$8,0) RETURNING id", [projectId, convId, c.contact_id, c.inbox_id, c.provider, text, actor, ref])
          .then(function (ins) { return deliver(pool, provider, c, ins.rows[0].id, text, actor, projectId, convId); });
      });
    });
  });
}
function deliver(pool, provider, c, msgId, text, actor, projectId, convId) {
  var inbox = { id: c.inbox_id, instance: c.instance };
  return attempt(provider, inbox, c.wa_id, text).then(function (r1) {
    if (r1.ok || !/^TRANSPORT/.test(String(r1.error || ''))) return { r: r1, attempts: 1 };
    return delay(1500).then(function () { return attempt(provider, inbox, c.wa_id, text); }).then(function (r2) { return { r: r2, attempts: 2 }; });
  }).then(function (x) {
    var r = x.r;
    var status = r.ok ? 'sent' : 'failed';
    return pool.query('UPDATE wp_messages SET status = $2, provider_message_id = COALESCE($3, provider_message_id), error = $4, attempts = attempts + $5, updated_at = now() WHERE id = $1', [msgId, status, r.provider_message_id, r.ok ? null : String(r.error).slice(0, 200), x.attempts])
      .then(function () { return pool.query("UPDATE wp_conversations SET last_message_at = now(), last_outbound_at = now(), first_reply_at = COALESCE(first_reply_at, now()), status = CASE WHEN status IN ('open','pending','needs_human') THEN 'waiting_customer' ELSE status END, waiting_since = now(), updated_at = now() WHERE id = $1 AND $2::text = 'sent'", [convId, status]); })
      .then(function () { return pool.query('INSERT INTO wp_conversation_events (project_id, conversation_id, kind, actor, payload) VALUES ($1,$2,$3,$4,$5)', [projectId, convId, r.ok ? 'message_out' : 'send_failed', actor, JSON.stringify({ message_id: msgId, attempts: x.attempts, error: r.ok ? null : r.error, http_status: r.status })]); })
      .then(function () {
        bus.publish({ type: 'message.out', project_id: projectId, conversation_id: convId, message_id: msgId, status: status });
        return { message_id: msgId, status: status, provider_message_id: r.provider_message_id, duplicate: false, error: r.ok ? null : r.error };
      });
  });
}
// retry(pool, projectId, convId, msgId, actor) → re-sends ONE failed outbound row (human-invoked)
function retry(pool, projectId, convId, msgId, actor) {
  return pool.query("SELECT m.id, m.status, m.text, m.attempts, c.contact_id, c.inbox_id, i.instance, i.provider, i.status AS inbox_status, i.outbound_enabled, k.wa_id FROM wp_messages m JOIN wp_conversations c ON c.id = m.conversation_id JOIN wp_inboxes i ON i.id = c.inbox_id JOIN wp_contacts k ON k.id = c.contact_id WHERE m.project_id = $1 AND m.conversation_id = $2 AND m.id = $3 AND m.direction = 'out'", [projectId, convId, msgId]).then(function (r) {
    var m = r.rows[0];
    if (!m) throw fail('not_found', 404, 'no such outbound message');
    if (m.status !== 'failed') throw fail('precondition', 412, 'only failed messages can be retried');
    if (m.attempts >= 5) throw fail('precondition', 412, 'retry limit reached');
    if (!m.outbound_enabled || m.inbox_status !== 'open') throw fail('precondition', 412, 'inbox not ready');
    var provider = providers[m.provider];
    return pool.query("UPDATE wp_messages SET status = 'queued', error = NULL, updated_at = now() WHERE id = $1", [msgId]).then(function () { return deliver(pool, provider, m, msgId, m.text, actor, projectId, convId); });
  });
}
module.exports = { send: send, retry: retry, CAP_PER_HOUR: CAP_PER_HOUR };
