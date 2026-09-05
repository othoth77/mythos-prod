'use strict';
// =====================================================
// MYTHOS WP — delivery reconciliation, inbox heartbeat, dead-letter replay (MYTHOS-COMMS-9)
// projects/mythos-wp/reference/comms/reconcile.js
//
// reconcile(pool, { thresholdMinutes })  outbound rows still `queued`/`sent` after the threshold with no
//                                         acknowledgement get ONE delivery.alarm event and ack_alarm_at;
//                                         nothing is re-sent (a duplicate is worse than a late alarm).
// heartbeat(pool)                         every inbox not `inactive` is probed through its provider's
//                                         health(); heartbeat_state ok|stale|unreachable is recorded and an
//                                         inbox.heartbeat event is journaled only on a change.
// replay(pool, eventId, actor, opts)      re-runs the Core on ONE ledgered failed/rejected delivery whose
//                                         redacted payload was kept; idempotent (unique provider ids), audited
//                                         (wp_audit_events + ledger columns), never accepts a raw payload from
//                                         the caller. Dry-run by default.
// =====================================================
var registry = require('./provider');
var core = require('./core');
var bus = require('./bus');
try { registry.register(require('./providers/evolution')); } catch (e) { /* already registered */ }
function fail(code, status, detail) { var e = new Error(detail || code); e.code = code; e.status = status; return e; }

function reconcile(pool, o) {
  o = o || {};
  var minutes = Math.max(1, parseInt(o.thresholdMinutes || process.env.MYTHOS_WP_ACK_THRESHOLD_MIN || '15', 10) || 15);
  return pool.query("SELECT m.id, m.project_id, m.conversation_id, m.status, m.created_at FROM wp_messages m WHERE m.direction = 'out' AND m.status IN ('queued','sent') AND m.ack_alarm_at IS NULL AND m.created_at < now() - ($1 || ' minutes')::interval ORDER BY m.id LIMIT 500", [String(minutes)]).then(function (r) {
    var chain = Promise.resolve(); var alarmed = [];
    r.rows.forEach(function (m) {
      chain = chain.then(function () { return pool.query('UPDATE wp_messages SET ack_alarm_at = now(), updated_at = now() WHERE id = $1 AND ack_alarm_at IS NULL RETURNING id', [m.id]); })
        .then(function (u) {
          if (!u.rows[0]) return null;
          alarmed.push(m.id);
          return pool.query("INSERT INTO wp_conversation_events (project_id, conversation_id, kind, event_name, actor, payload) VALUES ($1,$2,'delivery_alarm','delivery.alarm','reconcile',$3)", [m.project_id, m.conversation_id, JSON.stringify({ message_id: m.id, status: m.status, threshold_minutes: minutes, resend: false })])
            .then(function () { bus.publish({ type: 'delivery.alarm', event: 'delivery.alarm', project_id: m.project_id, conversation_id: m.conversation_id, message_id: m.id, status: m.status }); });
        });
    });
    return chain.then(function () { return { threshold_minutes: minutes, checked: r.rows.length, alarmed: alarmed }; });
  });
}

function heartbeat(pool, o) {
  o = o || {};
  var staleMinutes = Math.max(1, parseInt(o.staleMinutes || process.env.MYTHOS_WP_HEARTBEAT_STALE_MIN || '10', 10) || 10);
  return pool.query("SELECT id, project_id, provider, instance, status, heartbeat_state, last_event_at FROM wp_inboxes WHERE status <> 'inactive' ORDER BY id").then(function (r) {
    var out = []; var chain = Promise.resolve();
    r.rows.forEach(function (ib) {
      chain = chain.then(function () {
        var p = registry.get(ib.provider);
        var probe = p ? p.health({ instance: ib.instance }) : Promise.resolve({ ok: false, state: 'unknown', reason: 'PROVIDER_UNKNOWN' });
        return probe.then(function (h) {
          var st = h.ok && h.state === 'open' ? 'ok' : (h.state === 'unreachable' ? 'unreachable' : 'stale');
          if (ib.status === 'open' && h.ok && h.state === 'open' && ib.last_event_at && (Date.now() - new Date(ib.last_event_at).getTime()) > staleMinutes * 60000 * 24) st = 'ok'; // open + reachable = ok even if quiet
          return pool.query('UPDATE wp_inboxes SET last_heartbeat_at = now(), heartbeat_state = $2, last_error = CASE WHEN $3::text IS NULL THEN last_error ELSE $3 END, updated_at = now() WHERE id = $1', [ib.id, st, h.ok ? null : String(h.reason || h.state).slice(0, 200)])
            .then(function () {
              var changed = ib.heartbeat_state !== st;
              if (changed) bus.publish({ type: 'inbox.status', event: 'inbox.heartbeat', project_id: ib.project_id, inbox_id: ib.id, heartbeat: st, provider_state: h.state });
              out.push({ inbox_id: ib.id, instance: ib.instance, provider: ib.provider, provider_state: h.state, heartbeat: st, changed: changed });
              return changed ? pool.query("INSERT INTO wp_audit_events (actor, actor_role, action, resource, record_id, project_id, next) VALUES ('system:heartbeat', NULL, 'status', 'inboxes', $1, $2, $3)", [String(ib.id), ib.project_id, JSON.stringify({ heartbeat_state: st, provider_state: h.state })]) : null;
            });
        });
      });
    });
    return chain.then(function () { return { inboxes: out }; });
  });
}

// eligible: failed | rejected, payload kept, not yet replayed
function listReplayable(pool, limit) {
  return pool.query("SELECT id, provider, instance, event, status, reason, received_at FROM wp_inbound_events WHERE status IN ('failed','rejected') AND payload IS NOT NULL AND replayed_at IS NULL ORDER BY id LIMIT $1", [Math.min(500, Math.max(1, limit || 50))]).then(function (r) { return r.rows; });
}
function replay(pool, eventId, actor, o) {
  o = o || {};
  o.dryRun = o.dryRun !== false; // dry-run unless explicitly applied
  var id = parseInt(eventId, 10);
  if (!id) throw fail('validation', 400, 'event id required');
  return pool.query("SELECT * FROM wp_inbound_events WHERE id = $1", [id]).then(function (r) {
    var ev = r.rows[0];
    if (!ev) throw fail('not_found', 404, 'no such inbound event');
    if (['failed', 'rejected'].indexOf(ev.status) === -1) throw fail('precondition', 412, 'only failed/rejected events can be replayed');
    if (!ev.payload) throw fail('precondition', 412, 'no payload kept for this event');
    if (ev.replayed_at) throw fail('precondition', 412, 'already replayed at ' + new Date(ev.replayed_at).toISOString());
    var p = registry.get(ev.provider);
    if (!p) throw fail('precondition', 412, 'provider not registered: ' + ev.provider);
    var parsed = p.parseInbound(ev.payload);
    var mark = function (result, messageId) {
      return pool.query('UPDATE wp_inbound_events SET replayed_at = now(), replay_result = $2, replay_message_id = $3 WHERE id = $1', [id, String(result).slice(0, 80), messageId || null])
        .then(function () { return pool.query("INSERT INTO wp_audit_events (actor, actor_role, action, resource, record_id, next) VALUES ($1, NULL, 'update', 'inbound_events', $2, $3)", [actor || 'cli', String(id), JSON.stringify({ replay: true, result: result, message_id: messageId || null, dry_run: !!o.dryRun })]); });
    };
    if (!parsed.ok) return (o.dryRun ? Promise.resolve() : mark('PARSE:' + parsed.reason)).then(function () { return { id: id, dry_run: !!o.dryRun, result: 'PARSE:' + parsed.reason }; });
    if (parsed.kind !== 'message') return (o.dryRun ? Promise.resolve() : mark('NOT_A_MESSAGE:' + parsed.kind)).then(function () { return { id: id, dry_run: !!o.dryRun, result: 'NOT_A_MESSAGE:' + parsed.kind }; });
    return core.findInbox(pool, p.id, parsed.event.instance).then(function (inbox) {
      if (!inbox) return (o.dryRun ? Promise.resolve() : mark('INBOX_UNKNOWN')).then(function () { return { id: id, dry_run: !!o.dryRun, result: 'INBOX_UNKNOWN' }; });
      if (!inbox.inbound_enabled) return (o.dryRun ? Promise.resolve() : mark('INBOX_INBOUND_DISABLED')).then(function () { return { id: id, dry_run: !!o.dryRun, result: 'INBOX_INBOUND_DISABLED' }; });
      if (o.dryRun) return { id: id, dry_run: true, result: 'WOULD_INGEST', instance: inbox.instance, provider_message_id: parsed.event.provider_message_id };
      return core.ingest(pool, inbox, parsed.event).then(function (res) {
        var result = res.duplicate ? 'DUPLICATE' : 'PERSISTED';
        return pool.query("INSERT INTO wp_conversation_events (project_id, conversation_id, kind, event_name, actor, payload) VALUES ($1,$2,'replay','event.replayed',$3,$4)", [inbox.project_id, res.conversation_id, actor || 'cli', JSON.stringify({ inbound_event_id: id, result: result, message_id: res.message_id || null })])
          .then(function () { return mark(result, res.message_id); })
          .then(function () { return { id: id, dry_run: false, result: result, message_id: res.message_id || null, conversation_id: res.conversation_id }; });
      }, function (e) { return mark('INGEST:' + String(e && e.code || e && e.message || 'error').slice(0, 60)).then(function () { return { id: id, dry_run: false, result: 'INGEST_FAILED', error: String(e && e.message || e).slice(0, 120) }; }); });
    });
  });
}
module.exports = { reconcile: reconcile, heartbeat: heartbeat, listReplayable: listReplayable, replay: replay };
