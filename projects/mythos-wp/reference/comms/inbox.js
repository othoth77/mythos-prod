'use strict';
// =====================================================
// MYTHOS WP — Inbox read/write model over the Communication Core tables
// projects/mythos-wp/reference/comms/inbox.js
//
// Every query is scoped by project_id (the resolved project of the request);
// nothing here can reach another project's rows. Numbers are returned masked
// in lists ('***' + last 3 digits) and in full only on the contact record
// (operators need it to identify a customer). Nothing here sends.
// =====================================================
var bus = require('./bus');
var STATUSES = ['open', 'pending', 'waiting_customer', 'needs_human', 'resolved', 'archived'];
var LIMIT = 50;
function fail(code, status, detail) { var e = new Error(detail || code); e.code = code; e.status = status; return e; }
function mask(n) { n = String(n || ''); return n.length > 3 ? '***' + n.slice(-3) : '***'; }
function clampInt(v, d, lo, hi) { var n = parseInt(v, 10); if (isNaN(n)) n = d; return Math.max(lo, Math.min(hi, n)); }

// scope(pool, username) → null (sees every inbox) | [inbox ids] (member-scoped)
function scope(pool, username) {
  return pool.query('SELECT inbox_id FROM wp_inbox_members WHERE username = $1', [username]).then(function (r) { return r.rows.length ? r.rows.map(function (x) { return x.inbox_id; }) : null; }, function () { return null; });
}
function memberships(pool, username) {
  return pool.query('SELECT m.inbox_id, m.role, m.team, i.project_id, i.instance, i.display_name, i.status FROM wp_inbox_members m JOIN wp_inboxes i ON i.id = m.inbox_id WHERE m.username = $1 ORDER BY i.project_id, i.id', [username]).then(function (r) { return r.rows; });
}
function scopeClause(scope, params, col) {
  if (!scope) return null;
  params.push(scope.length ? scope : [-1]);
  return col + ' = ANY($' + params.length + '::bigint[])';
}
function listConversations(pool, projectId, o) {
  o = o || {};
  var params = [projectId]; var where = ['c.project_id = $1'];
  var sc = scopeClause(o.scope, params, 'c.inbox_id'); if (sc) where.push(sc);
  if (o.status && STATUSES.indexOf(o.status) !== -1) { params.push(o.status); where.push('c.status = $' + params.length); }
  else if (o.status === 'live') where.push("c.status NOT IN ('resolved','archived')");
  if (o.assigned === 'me' && o.username) { params.push(o.username); where.push('c.assigned_to = $' + params.length); }
  else if (o.assigned === 'none') where.push('c.assigned_to IS NULL');
  if (o.inbox) { params.push(parseInt(o.inbox, 10) || 0); where.push('c.inbox_id = $' + params.length); }
  if (o.tag) { params.push(String(o.tag)); where.push('EXISTS (SELECT 1 FROM wp_conversation_tags ct JOIN wp_tags t ON t.id = ct.tag_id WHERE ct.conversation_id = c.id AND t.name = $' + params.length + ')'); }
  if (o.q) { params.push('%' + String(o.q).slice(0, 80) + '%'); where.push('(k.display_name ILIKE $' + params.length + ' OR k.wa_id LIKE $' + params.length + ' OR c.summary ILIKE $' + params.length + ' OR EXISTS (SELECT 1 FROM wp_messages mm WHERE mm.conversation_id = c.id AND mm.text ILIKE $' + params.length + '))'); }
  if (o.before) { params.push(String(o.before)); where.push('c.last_message_at < $' + params.length + '::timestamptz'); }
  var limit = clampInt(o.limit, LIMIT, 1, 200);
  params.push(limit);
  var sql = 'SELECT c.id, c.status, c.priority, c.assigned_to, c.team, c.unread_count, c.language, c.last_intent, c.summary, c.last_message_at, c.last_inbound_at, c.last_outbound_at, c.waiting_since, c.created_at, c.inbox_id, i.instance AS inbox_instance, ' +
    'k.id AS contact_id, k.display_name AS contact_name, k.wa_id AS contact_wa_id, ' +
    "(SELECT m.text FROM wp_messages m WHERE m.conversation_id = c.id AND m.direction <> 'activity' ORDER BY COALESCE(m.provider_timestamp, m.created_at) DESC, m.created_at DESC, m.id DESC LIMIT 1) AS last_text, " +
    "(SELECT m.message_type FROM wp_messages m WHERE m.conversation_id = c.id AND m.direction <> 'activity' ORDER BY COALESCE(m.provider_timestamp, m.created_at) DESC, m.created_at DESC, m.id DESC LIMIT 1) AS last_type, " +
    "(SELECT m.direction FROM wp_messages m WHERE m.conversation_id = c.id AND m.direction <> 'activity' ORDER BY COALESCE(m.provider_timestamp, m.created_at) DESC, m.created_at DESC, m.id DESC LIMIT 1) AS last_direction, " +
    "COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM wp_conversation_tags ct JOIN wp_tags t ON t.id = ct.tag_id WHERE ct.conversation_id = c.id), '{}') AS tags, " +
    "EXISTS (SELECT 1 FROM wp_handoffs hf WHERE hf.conversation_id = c.id AND hf.status IN ('NEW','REQUIRES_HUMAN','IN_PROGRESS')) AS handoff_open " +
    'FROM wp_conversations c JOIN wp_contacts k ON k.id = c.contact_id JOIN wp_inboxes i ON i.id = c.inbox_id WHERE ' + where.join(' AND ') +
    ' ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC LIMIT $' + params.length;
  return pool.query(sql, params).then(function (r) {
    return { items: r.rows.map(function (x) { x.contact_masked = mask(x.contact_wa_id); delete x.contact_wa_id; x.last_text = x.last_text ? String(x.last_text).slice(0, 140) : null; return x; }), next_before: r.rows.length === limit ? r.rows[r.rows.length - 1].last_message_at : null };
  });
}
function counts(pool, projectId, scope) {
  var params = [projectId]; var extra = '';
  var sc = scopeClause(scope, params, 'inbox_id'); if (sc) extra = ' AND ' + sc;
  return pool.query("SELECT status, count(*)::int AS n, coalesce(sum(unread_count),0)::int AS unread FROM wp_conversations WHERE project_id = $1" + extra + " GROUP BY status", params).then(function (r) {
    var out = { total: 0, unread: 0, by_status: {} };
    r.rows.forEach(function (x) { out.by_status[x.status] = x.n; out.total += x.n; if (x.status !== 'resolved' && x.status !== 'archived') out.unread += x.unread; });
    return out;
  });
}
function getConversation(pool, projectId, id, scope) {
  return pool.query('SELECT c.*, i.instance AS inbox_instance, i.provider, i.outbound_enabled, k.display_name AS contact_name, k.wa_id AS contact_wa_id, k.lid AS contact_lid, k.language AS contact_language, k.notes AS contact_notes, k.memory AS contact_memory, k.status AS contact_status, k.first_seen_at, k.last_seen_at FROM wp_conversations c JOIN wp_contacts k ON k.id = c.contact_id JOIN wp_inboxes i ON i.id = c.inbox_id WHERE c.project_id = $1 AND c.id = $2', [projectId, id])
    .then(function (r) {
      if (!r.rows[0]) throw fail('not_found', 404, 'no such conversation');
      if (scope && scope.indexOf(r.rows[0].inbox_id) === -1) throw fail('not_found', 404, 'no such conversation');
      var c = r.rows[0];
      return Promise.all([
        pool.query('SELECT t.id, t.name, t.color FROM wp_conversation_tags ct JOIN wp_tags t ON t.id = ct.tag_id WHERE ct.conversation_id = $1 ORDER BY t.name', [id]),
        pool.query("SELECT id, status, reason, intent, created_at, assigned_to FROM wp_handoffs WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 5", [id]),
        pool.query("SELECT count(*)::int AS n FROM wp_conversations WHERE contact_id = $1 AND project_id = $2", [c.contact_id, projectId])
      ]).then(function (x) {
        c.tags = x[0].rows; c.handoffs = x[1].rows; c.contact_conversations = x[2].rows[0].n;
        c.contact_masked = mask(c.contact_wa_id);
        return c;
      });
    });
}
function listMessages(pool, projectId, convId, o) {
  o = o || {};
  var limit = clampInt(o.limit, 60, 1, 200);
  var params = [projectId, convId, limit]; var extra = '';
  if (o.before_id) { params.push(parseInt(o.before_id, 10) || 0); extra = ' AND m.id < $4'; }
  return pool.query('SELECT m.id, m.direction, m.message_type, m.text, m.sender_kind, m.sender_ref, m.status, m.error, m.provider_message_id, m.quoted_provider_message_id, m.provider_timestamp, m.created_at, m.redacted_at, m.ai_run_id, ' +
    "COALESCE((SELECT json_agg(json_build_object('id', a.id, 'kind', a.kind, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes, 'file_name', a.file_name, 'status', a.status, 'transcript', a.transcript)) FROM wp_message_attachments a WHERE a.message_id = m.id), '[]'::json) AS attachments " +
    'FROM wp_messages m WHERE m.project_id = $1 AND m.conversation_id = $2' + extra + ' ORDER BY COALESCE(m.provider_timestamp, m.created_at) DESC, m.created_at DESC, m.id DESC LIMIT $3', params)
    .then(function (r) { var rows = r.rows.reverse(); return { items: rows, next_before_id: r.rows.length === limit ? rows[0].id : null }; });
}
function markRead(pool, projectId, convId, actor) {
  return pool.query('UPDATE wp_conversations SET unread_count = 0, updated_at = now() WHERE project_id = $1 AND id = $2 RETURNING id', [projectId, convId]).then(function (r) {
    if (!r.rows[0]) throw fail('not_found', 404, 'no such conversation');
    bus.publish({ type: 'conversation.read', project_id: projectId, conversation_id: convId, actor: actor });
    return { id: convId, unread_count: 0 };
  });
}
var events = require('./events');
function event(pool, projectId, convId, kind, actor, payload, eventName) {
  return pool.query('INSERT INTO wp_conversation_events (project_id, conversation_id, kind, event_name, actor, payload) VALUES ($1,$2,$3,$6,$4,$5)', [projectId, convId, kind, actor, JSON.stringify(payload || {}), eventName || events.forKind(kind)]);
}
function updateConversation(pool, projectId, convId, actor, patch) {
  patch = patch || {};
  var sets = [], params = [projectId, convId], changed = {};
  if (patch.status !== undefined) { if (STATUSES.indexOf(patch.status) === -1) throw fail('validation', 400, 'unknown status'); params.push(patch.status); sets.push('status = $' + params.length); changed.status = patch.status; if (patch.status === 'resolved') { params.push(actor); sets.push('resolved_at = now(), resolved_by = $' + params.length); } if (patch.status === 'waiting_customer') sets.push('waiting_since = now()'); }
  if (patch.assigned_to !== undefined) { var a = patch.assigned_to === null || patch.assigned_to === '' ? null : String(patch.assigned_to).slice(0, 64); params.push(a); sets.push('assigned_to = $' + params.length); changed.assigned_to = a; }
  if (patch.priority !== undefined) { var p = clampInt(patch.priority, 0, 0, 3); params.push(p); sets.push('priority = $' + params.length); changed.priority = p; }
  if (patch.team !== undefined) { var t = patch.team ? String(patch.team).slice(0, 64) : null; params.push(t); sets.push('team = $' + params.length); changed.team = t; }
  if (patch.summary !== undefined) { var s = patch.summary ? String(patch.summary).slice(0, 2000) : null; params.push(s); sets.push('summary = $' + params.length); changed.summary = !!s; }
  if (!sets.length) throw fail('validation', 400, 'nothing to change');
  sets.push('updated_at = now()');
  return pool.query('UPDATE wp_conversations SET ' + sets.join(', ') + ' WHERE project_id = $1 AND id = $2 RETURNING id, status, assigned_to, priority, team', params).then(function (r) {
    if (!r.rows[0]) throw fail('not_found', 404, 'no such conversation');
    var en = changed.status === 'resolved' ? 'conversation.resolved' : changed.status === 'open' ? 'conversation.reopened' : changed.assigned_to !== undefined ? 'conversation.assigned' : 'conversation.updated';
    return event(pool, projectId, convId, 'status', actor, changed, en).then(function () {
      bus.publish({ type: 'conversation.updated', project_id: projectId, conversation_id: convId, actor: actor, changed: changed });
      return r.rows[0];
    });
  });
}
function addNote(pool, projectId, convId, actor, text) {
  text = String(text || '').trim();
  if (!text || text.length > 4000) throw fail('validation', 400, 'note must be 1–4000 characters');
  return pool.query('SELECT contact_id, inbox_id FROM wp_conversations WHERE project_id = $1 AND id = $2', [projectId, convId]).then(function (r) {
    if (!r.rows[0]) throw fail('not_found', 404, 'no such conversation');
    return pool.query("INSERT INTO wp_messages (project_id, conversation_id, contact_id, inbox_id, direction, message_type, text, sender_kind, sender_ref, status) VALUES ($1,$2,$3,$4,'activity','text',$5,'user',$6,'received') RETURNING id, created_at", [projectId, convId, r.rows[0].contact_id, r.rows[0].inbox_id, text, actor])
      .then(function (m) { return event(pool, projectId, convId, 'note', actor, { message_id: m.rows[0].id }).then(function () { bus.publish({ type: 'message.note', project_id: projectId, conversation_id: convId, actor: actor, message_id: m.rows[0].id }); return { id: m.rows[0].id, created_at: m.rows[0].created_at }; }); });
  });
}
function listTags(pool, projectId) { return pool.query('SELECT id, name, color, applies_to FROM wp_tags WHERE project_id = $1 ORDER BY name', [projectId]).then(function (r) { return r.rows; }); }
function createTag(pool, projectId, actor, body) {
  var name = String(body && body.name || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(name)) throw fail('validation', 400, 'tag name: a-z 0-9 _ . - (1–48)');
  var color = body && body.color && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : null;
  var applies = ['contact', 'conversation', 'both'].indexOf(body && body.applies_to) !== -1 ? body.applies_to : 'both';
  return pool.query('INSERT INTO wp_tags (project_id, name, color, applies_to) VALUES ($1,$2,$3,$4) ON CONFLICT (project_id, name) DO UPDATE SET color = COALESCE(EXCLUDED.color, wp_tags.color) RETURNING id, name, color, applies_to', [projectId, name, color, applies]).then(function (r) { return r.rows[0]; });
}
function tagConversation(pool, projectId, convId, tagId, actor, remove) {
  return pool.query('SELECT 1 FROM wp_conversations WHERE project_id = $1 AND id = $2', [projectId, convId]).then(function (r) {
    if (!r.rows[0]) throw fail('not_found', 404, 'no such conversation');
    return pool.query('SELECT id, name FROM wp_tags WHERE project_id = $1 AND id = $2', [projectId, tagId]);
  }).then(function (t) {
    if (!t.rows[0]) throw fail('not_found', 404, 'no such tag');
    var qy = remove ? pool.query('DELETE FROM wp_conversation_tags WHERE conversation_id = $1 AND tag_id = $2', [convId, tagId]) : pool.query('INSERT INTO wp_conversation_tags (conversation_id, tag_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [convId, tagId, actor]);
    return qy.then(function () { return event(pool, projectId, convId, 'tag', actor, { tag: t.rows[0].name, removed: !!remove }); }).then(function () { bus.publish({ type: 'conversation.updated', project_id: projectId, conversation_id: convId, actor: actor, changed: { tag: t.rows[0].name, removed: !!remove } }); return { conversation_id: convId, tag: t.rows[0].name, removed: !!remove }; });
  });
}
function listContacts(pool, projectId, o) {
  o = o || {}; var params = [projectId]; var where = ['k.project_id = $1'];
  if (o.q) { params.push('%' + String(o.q).slice(0, 80) + '%'); where.push('(k.display_name ILIKE $' + params.length + ' OR k.wa_id LIKE $' + params.length + ')'); }
  if (o.status && ['active', 'blocked', 'merged'].indexOf(o.status) !== -1) { params.push(o.status); where.push('k.status = $' + params.length); }
  if (o.tag) { params.push(String(o.tag)); where.push('EXISTS (SELECT 1 FROM wp_contact_tags ct JOIN wp_tags t ON t.id = ct.tag_id WHERE ct.contact_id = k.id AND t.name = $' + params.length + ')'); }
  if (o.scope) { params.push(o.scope.length ? o.scope : [-1]); where.push('EXISTS (SELECT 1 FROM wp_conversations cc WHERE cc.contact_id = k.id AND cc.inbox_id = ANY($' + params.length + '::bigint[]))'); }
  var limit = clampInt(o.limit, LIMIT, 1, 200); params.push(limit);
  return pool.query('SELECT k.id, k.display_name, k.wa_id, k.language, k.status, k.source, k.first_seen_at, k.last_seen_at, k.last_inbound_at, k.last_outbound_at, ' +
    "(SELECT count(*)::int FROM wp_conversations c WHERE c.contact_id = k.id) AS conversations, " +
    "COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM wp_contact_tags ct JOIN wp_tags t ON t.id = ct.tag_id WHERE ct.contact_id = k.id), '{}') AS tags " +
    'FROM wp_contacts k WHERE ' + where.join(' AND ') + ' ORDER BY k.last_seen_at DESC NULLS LAST, k.id DESC LIMIT $' + params.length, params)
    .then(function (r) { return { items: r.rows.map(function (x) { x.wa_masked = mask(x.wa_id); delete x.wa_id; return x; }) }; });
}
function getContact(pool, projectId, id) {
  return pool.query('SELECT * FROM wp_contacts WHERE project_id = $1 AND id = $2', [projectId, id]).then(function (r) {
    if (!r.rows[0]) throw fail('not_found', 404, 'no such contact');
    var k = r.rows[0];
    return Promise.all([
      pool.query('SELECT id, status, inbox_id, last_message_at, unread_count, created_at, resolved_at FROM wp_conversations WHERE contact_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 50', [id, projectId]),
      pool.query('SELECT t.id, t.name, t.color FROM wp_contact_tags ct JOIN wp_tags t ON t.id = ct.tag_id WHERE ct.contact_id = $1 ORDER BY t.name', [id])
    ]).then(function (x) { k.conversations = x[0].rows; k.tags = x[1].rows; k.wa_masked = mask(k.wa_id); return k; });
  });
}
function updateContact(pool, projectId, id, actor, patch) {
  patch = patch || {}; var sets = [], params = [projectId, id];
  if (patch.display_name !== undefined) { params.push(patch.display_name ? String(patch.display_name).slice(0, 120) : null); sets.push('display_name = $' + params.length); }
  if (patch.language !== undefined) { if (patch.language !== null && ['fr', 'ar', 'en'].indexOf(patch.language) === -1) throw fail('validation', 400, 'language fr|ar|en'); params.push(patch.language); sets.push('language = $' + params.length); }
  if (patch.notes !== undefined) { params.push(patch.notes ? String(patch.notes).slice(0, 8000) : null); sets.push('notes = $' + params.length); }
  if (patch.status !== undefined) { if (['active', 'blocked'].indexOf(patch.status) === -1) throw fail('validation', 400, 'status active|blocked'); params.push(patch.status); sets.push('status = $' + params.length); }
  if (patch.memory !== undefined) { if (patch.memory === null || typeof patch.memory !== 'object' || Array.isArray(patch.memory) || JSON.stringify(patch.memory).length > 8000) throw fail('validation', 400, 'memory must be a small object'); params.push(JSON.stringify(patch.memory)); sets.push('memory = $' + params.length); }
  if (!sets.length) throw fail('validation', 400, 'nothing to change');
  sets.push('updated_at = now()');
  return pool.query('UPDATE wp_contacts SET ' + sets.join(', ') + ' WHERE project_id = $1 AND id = $2 RETURNING id, display_name, language, status', params).then(function (r) { if (!r.rows[0]) throw fail('not_found', 404, 'no such contact'); return r.rows[0]; });
}
function tagContact(pool, projectId, contactId, tagId, actor, remove) {
  return pool.query('SELECT 1 FROM wp_contacts WHERE project_id = $1 AND id = $2', [projectId, contactId]).then(function (r) {
    if (!r.rows[0]) throw fail('not_found', 404, 'no such contact');
    return pool.query('SELECT id, name FROM wp_tags WHERE project_id = $1 AND id = $2', [projectId, tagId]);
  }).then(function (t) {
    if (!t.rows[0]) throw fail('not_found', 404, 'no such tag');
    return (remove ? pool.query('DELETE FROM wp_contact_tags WHERE contact_id = $1 AND tag_id = $2', [contactId, tagId]) : pool.query('INSERT INTO wp_contact_tags (contact_id, tag_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [contactId, tagId, actor])).then(function () { return { contact_id: contactId, tag: t.rows[0].name, removed: !!remove }; });
  });
}
module.exports = { STATUSES: STATUSES, mask: mask, scope: scope, memberships: memberships, listConversations: listConversations, counts: counts, getConversation: getConversation, listMessages: listMessages, markRead: markRead, updateConversation: updateConversation, addNote: addNote, listTags: listTags, createTag: createTag, tagConversation: tagConversation, listContacts: listContacts, getContact: getContact, updateContact: updateContact, tagContact: tagContact, event: event };
