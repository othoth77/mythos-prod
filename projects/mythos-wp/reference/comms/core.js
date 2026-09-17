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
var events = require('./events');
function tx(pool, fn) {
  return pool.connect().then(function (client) {
    return client.query('BEGIN').then(function () { return fn(client); })
      .then(function (v) { return client.query('COMMIT').then(function () { client.release(); return v; }); },
        function (e) { return client.query('ROLLBACK').catch(function () {}).then(function () { client.release(); throw e; }); });
  });
}
// identitiesOf(ev) → [{ kind, value }] from the normalised event (provider-neutral); phone/lid derived when absent
function identitiesOf(ev) {
  var ids = Array.isArray(ev.contact && ev.contact.identities) ? ev.contact.identities.slice() : [];
  if (ev.contact && ev.contact.wa_id && !ids.some(function (i) { return i.kind === 'phone'; })) ids.push({ kind: 'phone', value: ev.contact.wa_id });
  if (ev.contact && ev.contact.lid && !ids.some(function (i) { return i.kind === 'lid'; })) ids.push({ kind: 'lid', value: ev.contact.lid });
  return ids.filter(function (i) { return i && /^(phone|lid|bsuid|provider_user)$/.test(i.kind) && /^[A-Za-z0-9._:@+-]{3,128}$/.test(String(i.value || '')); }).map(function (i) { return { kind: i.kind, value: String(i.value) }; });
}
// resolveContact(c, projectId, ev, provider) → { id, created, identities_added }
// One customer = one contact per project even when the provider exposes several identifiers: any known
// identity wins; a phone-only legacy contact (wa_id) is matched too; new identities are attached, never duplicated.
function resolveContact(c, projectId, ev, provider) {
  var ids = identitiesOf(ev);
  var phone = ids.filter(function (i) { return i.kind === 'phone'; }).map(function (i) { return i.value; })[0] || null;
  var lid = ids.filter(function (i) { return i.kind === 'lid'; }).map(function (i) { return i.value; })[0] || null;
  var name = ev.contact && ev.contact.display_name ? ev.contact.display_name : null;
  var lookup = ids.length
    ? c.query('SELECT contact_id AS id FROM wp_contact_identities WHERE project_id = $1 AND (kind, value) IN (' + ids.map(function (_, i) { return '($' + (2 + i * 2) + ', $' + (3 + i * 2) + ')'; }).join(', ') + ') ORDER BY id LIMIT 1', [projectId].concat(ids.reduce(function (a, i) { return a.concat([i.kind, i.value]); }, [])))
    : Promise.resolve({ rows: [] });
  return lookup.then(function (r) {
    if (r.rows[0]) return { id: r.rows[0].id, created: false };
    if (phone) return c.query('SELECT id FROM wp_contacts WHERE project_id = $1 AND wa_id = $2', [projectId, phone]).then(function (x) { return x.rows[0] ? { id: x.rows[0].id, created: false } : null; });
    return null;
  }).then(function (found) {
    if (found) return c.query('UPDATE wp_contacts SET wa_id = COALESCE(wa_id, $2), lid = COALESCE($3, lid), display_name = COALESCE($4, display_name), last_seen_at = now(), last_inbound_at = now(), updated_at = now() WHERE id = $1', [found.id, phone, lid, name]).then(function () { return found; });
    if (!ids.length) throw Object.assign(new Error('no identity in event'), { code: 'CONTACT_IDENTITY_MISSING' });
    return c.query("INSERT INTO wp_contacts (project_id, wa_id, lid, display_name, source, last_seen_at, last_inbound_at) VALUES ($1,$2,$3,$4,'inbound', now(), now()) RETURNING id", [projectId, phone, lid, name]).then(function (x) { return { id: x.rows[0].id, created: true }; });
  }).then(function (contact) {
    var added = 0; var chain = Promise.resolve();
    ids.forEach(function (i) {
      chain = chain.then(function () { return c.query('INSERT INTO wp_contact_identities (project_id, contact_id, kind, value, provider, verified_at) VALUES ($1,$2,$3,$4,$5, now()) ON CONFLICT (project_id, kind, value) DO NOTHING RETURNING id', [projectId, contact.id, i.kind, i.value, provider || ev.provider || null]).then(function (x) { if (x.rows[0]) added++; }); });
    });
    return chain.then(function () { contact.identities_added = added; return contact; });
  });
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
    if (r.persisted) { bus.publish({ type: 'message.in', event: 'message.received', project_id: inbox.project_id, conversation_id: r.conversation_id, message_id: r.message_id, opened: r.opened, message_type: ev.message_type }); if (r.contact_created) bus.publish({ type: 'contact.created', event: 'contact.created', project_id: inbox.project_id, contact_id: r.contact_id }); }
    return r;
  });
}
function ingestTx(pool, inbox, ev) {
  return tx(pool, function (c) {
    return resolveContact(c, inbox.project_id, ev, inbox.provider).then(function (contact) {
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
            .then(function () { return c.query('INSERT INTO wp_conversation_events (project_id, conversation_id, kind, event_name, actor, payload) VALUES ($1,$2,\'message_in\',$4,\'receiver\',$3)', [inbox.project_id, conv.id, JSON.stringify({ message_id: msgId, message_type: ev.message_type, attachments: (ev.attachments || []).length, opened: conv.opened, contact_created: contact.created, identities_added: contact.identities_added }), events.forKind('message_in')]); })
            .then(function () { if (!conv.opened) return null; return c.query('INSERT INTO wp_conversation_events (project_id, conversation_id, kind, event_name, actor, payload) VALUES ($1,$2,\'created\',$3,\'receiver\',$4)', [inbox.project_id, conv.id, 'conversation.created', JSON.stringify({ status: 'open' })]); })
            .then(function () { return c.query('UPDATE wp_inboxes SET last_event_at = now(), updated_at = now() WHERE id=$1', [inbox.id]); })
            .then(function () { return { persisted: true, duplicate: false, message_id: msgId, conversation_id: conv.id, contact_id: contact.id, opened: conv.opened, contact_created: contact.created === true }; });
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
      bus.publish({ type: 'message.status', event: events.forStatus(ev.status), project_id: m.project_id, conversation_id: m.conversation_id, message_id: m.id, status: ev.status });
      return { updated: true, message_id: m.id, status: ev.status, conversation_id: m.conversation_id };
    });
  });
}
// updateStatusOnInstance(pool, provider, instance, ev) — same as updateStatus, but the outbound row is looked up across
// every inbox hosted by the instance (shared accounts). Notification messages sent by the bridge have no row → ignored.
function updateStatusOnInstance(pool, provider, instance, ev) {
  return pool.query("SELECT m.id, m.status, m.conversation_id, m.project_id, m.inbox_id FROM wp_messages m JOIN wp_inboxes i ON i.id = m.inbox_id WHERE i.provider = $1 AND i.instance = $2 AND m.provider_message_id = $3 AND m.direction = 'out'", [provider, instance, ev.provider_message_id]).then(function (r) {
    var m = r.rows[0];
    if (!m) return { updated: false, reason: 'MESSAGE_UNKNOWN' };
    if ((RANK[ev.status] || 0) <= (RANK[m.status] || 0) && ev.status !== 'failed') return { updated: false, reason: 'STATUS_NOT_NEWER', message_id: m.id, inbox_id: m.inbox_id };
    return pool.query('UPDATE wp_messages SET status = $2, updated_at = now() WHERE id = $1', [m.id, ev.status]).then(function () {
      bus.publish({ type: 'message.status', event: events.forStatus(ev.status), project_id: m.project_id, conversation_id: m.conversation_id, message_id: m.id, status: ev.status });
      return { updated: true, message_id: m.id, status: ev.status, conversation_id: m.conversation_id, inbox_id: m.inbox_id };
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
    'INSERT INTO wp_inbound_events (provider, instance, inbox_id, event, event_name, provider_message_id, status, reason, message_id, payload_sha256, payload, processed_at) VALUES ($1,$2,$3,$4,$11,$5,$6,$7,$8,$9,$10, now()) RETURNING id',
    [rec.provider || 'evolution', rec.instance || null, rec.inbox_id || null, String(rec.event || 'unknown').slice(0, 48), rec.provider_message_id || null, rec.status, rec.reason ? String(rec.reason).slice(0, 80) : null, rec.message_id || null, rec.payload_sha256 || null, rec.payload ? JSON.stringify(rec.payload) : null, rec.event_name || null]
  ).then(function (r) { return r.rows[0].id; }).catch(function () { return null; });
}
module.exports = { ingest: ingest, updateStatus: updateStatus, updateStatusOnInstance: updateStatusOnInstance, resolveContact: resolveContact, identitiesOf: identitiesOf, findInbox: findInbox, setInboxState: setInboxState, recordInbound: recordInbound, tx: tx };
