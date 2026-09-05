'use strict';
// =====================================================
// MYTHOS WP — Communication Core (persistence of normalised events)
// projects/mythos-wp/reference/comms/core.js
//
// Provider-neutral. Given an inbox row and a normalised inbound message
// event, in ONE transaction: upsert the contact, find (or open) the live
// conversation for (inbox, contact), insert the message exactly once,
// insert attachment metadata, bump counters, journal the event. A replayed
// delivery hits the unique index and returns { duplicate: true } without
// touching anything else.
// =====================================================
var bus = require('./bus');
function tx(pool, fn) {
  return pool.connect().then(function (client) {
    return client.query('BEGIN').then(function () { return fn(client); })
      .then(function (v) { return client.query('COMMIT').then(function () { client.release(); return v; }); },
        function (e) { return client.query('ROLLBACK').catch(function () {}).then(function () { client.release(); throw e; }); });
  });
}
function upsertContact(c, projectId, ev) {
  return c.query(
    'INSERT INTO wp_contacts (project_id, wa_id, lid, display_name, source, last_seen_at, last_inbound_at) VALUES ($1,$2,$3,$4,\'inbound\', now(), now()) ' +
    'ON CONFLICT (project_id, wa_id) DO UPDATE SET lid = COALESCE(EXCLUDED.lid, wp_contacts.lid), display_name = COALESCE(EXCLUDED.display_name, wp_contacts.display_name), last_seen_at = now(), last_inbound_at = now(), updated_at = now() ' +
    'RETURNING id, status',
    [projectId, ev.contact.wa_id, ev.contact.lid, ev.contact.display_name]
  ).then(function (r) { return r.rows[0]; });
}
function liveConversation(c, inbox, contactId, ev) {
  return c.query("SELECT id, status FROM wp_conversations WHERE inbox_id=$1 AND contact_id=$2 AND status NOT IN ('resolved','archived') LIMIT 1", [inbox.id, contactId])
    .then(function (r) {
      if (r.rows[0]) return { id: r.rows[0].id, status: r.rows[0].status, opened: false };
      return c.query('INSERT INTO wp_conversations (project_id, inbox_id, contact_id, provider_chat_id, status) VALUES ($1,$2,$3,$4,\'open\') RETURNING id', [inbox.project_id, inbox.id, contactId, ev.chat_id])
        .then(function (x) { return { id: x.rows[0].id, status: 'open', opened: true }; });
    });
}
// ingest(pool, inbox, ev) → { persisted, duplicate, message_id, conversation_id, contact_id, opened }
function ingest(pool, inbox, ev) {
  return ingestTx(pool, inbox, ev).then(function (r) {
    if (r.persisted) bus.publish({ type: 'message.in', project_id: inbox.project_id, conversation_id: r.conversation_id, message_id: r.message_id, opened: r.opened, message_type: ev.message_type });
    return r;
  });
}
function ingestTx(pool, inbox, ev) {
  return tx(pool, function (c) {
    return upsertContact(c, inbox.project_id, ev).then(function (contact) {
      return liveConversation(c, inbox, contact.id, ev).then(function (conv) {
        return c.query(
          'INSERT INTO wp_messages (project_id, conversation_id, contact_id, inbox_id, direction, provider, provider_message_id, message_type, text, quoted_provider_message_id, sender_kind, status, provider_timestamp, raw) ' +
          "VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8,$9,'customer','received',$10,$11) ON CONFLICT (inbox_id, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING RETURNING id",
          [inbox.project_id, conv.id, contact.id, inbox.id, ev.provider, ev.provider_message_id, ev.message_type, ev.text || null, ev.quoted_provider_message_id, ev.provider_timestamp, ev.raw ? JSON.stringify(ev.raw) : null]
        ).then(function (r) {
          if (!r.rows[0]) return { persisted: false, duplicate: true, conversation_id: conv.id, contact_id: contact.id, opened: false };
          var msgId = r.rows[0].id;
          var chain = Promise.resolve();
          (ev.attachments || []).forEach(function (a) {
            chain = chain.then(function () { return c.query('INSERT INTO wp_message_attachments (message_id, kind, mime_type, size_bytes, file_name, sha256, status) VALUES ($1,$2,$3,$4,$5,$6,\'pending\')', [msgId, a.kind, a.mime_type, a.size_bytes, a.file_name, a.sha256]); });
          });
          return chain
            .then(function () { return c.query("UPDATE wp_conversations SET last_message_at = now(), last_inbound_at = now(), unread_count = unread_count + 1, status = CASE WHEN status = 'waiting_customer' THEN 'open' ELSE status END, waiting_since = NULL, updated_at = now() WHERE id=$1", [conv.id]); })
            .then(function () { return c.query('INSERT INTO wp_conversation_events (project_id, conversation_id, kind, actor, payload) VALUES ($1,$2,\'message_in\',\'receiver\',$3)', [inbox.project_id, conv.id, JSON.stringify({ message_id: msgId, message_type: ev.message_type, attachments: (ev.attachments || []).length, opened: conv.opened })]); })
            .then(function () { return c.query('UPDATE wp_inboxes SET last_event_at = now(), updated_at = now() WHERE id=$1', [inbox.id]); })
            .then(function () { return { persisted: true, duplicate: false, message_id: msgId, conversation_id: conv.id, contact_id: contact.id, opened: conv.opened }; });
        });
      });
    });
  });
}
// updateStatus(pool, inbox, ev) → { updated, message_id, status } — delivery state from the provider (outbound rows only)
var RANK = { queued: 0, received: 0, sent: 1, delivered: 2, read: 3, failed: 9 };
function updateStatus(pool, inbox, ev) {
  return pool.query("SELECT id, status, conversation_id, project_id FROM wp_messages WHERE inbox_id = $1 AND provider_message_id = $2 AND direction = 'out'", [inbox.id, ev.provider_message_id]).then(function (r) {
    var m = r.rows[0];
    if (!m) return { updated: false, reason: 'MESSAGE_UNKNOWN' };
    if ((RANK[ev.status] || 0) <= (RANK[m.status] || 0) && ev.status !== 'failed') return { updated: false, reason: 'STATUS_NOT_NEWER', message_id: m.id };
    return pool.query('UPDATE wp_messages SET status = $2, updated_at = now() WHERE id = $1', [m.id, ev.status]).then(function () {
      bus.publish({ type: 'message.status', project_id: m.project_id, conversation_id: m.conversation_id, message_id: m.id, status: ev.status });
      return { updated: true, message_id: m.id, status: ev.status, conversation_id: m.conversation_id };
    });
  });
}
function findInbox(pool, provider, instance) {
  return pool.query('SELECT id, project_id, provider, instance, status, inbound_enabled, outbound_enabled FROM wp_inboxes WHERE provider=$1 AND instance=$2', [provider, instance]).then(function (r) { return r.rows[0] || null; });
}
function setInboxState(pool, inboxId, status, err) {
  return pool.query('UPDATE wp_inboxes SET status=$2, last_error=$3, last_event_at=now(), updated_at=now() WHERE id=$1', [inboxId, status, err ? String(err).slice(0, 200) : null]);
}
function recordInbound(pool, rec) {
  return pool.query(
    'INSERT INTO wp_inbound_events (provider, instance, inbox_id, event, provider_message_id, status, reason, message_id, payload_sha256, payload, processed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now()) RETURNING id',
    [rec.provider || 'evolution', rec.instance || null, rec.inbox_id || null, String(rec.event || 'unknown').slice(0, 48), rec.provider_message_id || null, rec.status, rec.reason ? String(rec.reason).slice(0, 80) : null, rec.message_id || null, rec.payload_sha256 || null, rec.payload ? JSON.stringify(rec.payload) : null]
  ).then(function (r) { return r.rows[0].id; }).catch(function () { return null; });
}
module.exports = { ingest: ingest, updateStatus: updateStatus, findInbox: findInbox, setInboxState: setInboxState, recordInbound: recordInbound, tx: tx };
