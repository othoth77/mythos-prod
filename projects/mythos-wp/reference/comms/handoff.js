'use strict';
// =====================================================
// MYTHOS WP V2 — AI ↔ human handoff (builder A)
// projects/mythos-wp/reference/comms/handoff.js
//
//   toHuman(pool, projectId, convId, actor, { reason, assign_to, run_id })
//     → wp_handoffs row (direction ai_to_human, previous_state), wp_conversations.handler = 'human'
//       (+ status needs_human, assigned_to), journal handoff.created, bus { type:'handoff', event:'handoff.created' }
//   toAI(pool, projectId, convId, actor, { reason })
//     → resolves the open handoffs, records a human_to_ai row, handler = 'ai' (+ needs_human → open),
//       journal handoff.resolved, bus { type:'handoff', event:'handoff.resolved' }
//   history(pool, projectId, convId) → newest first, no message text
// Idempotent: a conversation already in human hands with an open handoff returns that handoff.
// =====================================================
var bus = require('./bus');
var OPEN = "('NEW','REQUIRES_HUMAN','IN_PROGRESS')";
function fail(code, status, detail) { var e = new Error(detail || code); e.code = code; e.status = status; return e; }
function reasonOf(r, dflt) { r = String(r || dflt).toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 64); return r || dflt; }
function mask(n) { n = String(n || ''); return n.length > 3 ? '***' + n.slice(-3) : '***'; }
function load(pool, projectId, convId) {
  return pool.query('SELECT c.id, c.project_id, c.inbox_id, c.status, c.handler, c.agent_id, c.assigned_to, c.last_intent, k.wa_id, (SELECT r.id FROM wp_ai_runs r WHERE r.conversation_id = c.id ORDER BY r.id DESC LIMIT 1) AS last_run_id, (SELECT h.id FROM wp_handoffs h WHERE h.conversation_id = c.id AND h.status IN ' + OPEN + ' ORDER BY h.id DESC LIMIT 1) AS open_handoff_id FROM wp_conversations c JOIN wp_contacts k ON k.id = c.contact_id WHERE c.project_id = $1 AND c.id = $2', [projectId, convId])
    .then(function (r) { if (!r.rows[0]) throw fail('not_found', 404, 'no such conversation'); return r.rows[0]; });
}
function previousState(c) { return { handler: c.handler, agent_id: c.agent_id, status: c.status, last_intent: c.last_intent, last_run_id: c.last_run_id }; }
function journal(pool, projectId, convId, actor, eventName, payload) {
  return pool.query("INSERT INTO wp_conversation_events (project_id, conversation_id, kind, event_name, actor, payload) VALUES ($1,$2,'handoff',$3,$4,$5)", [projectId, convId, eventName, String(actor || 'system').slice(0, 64), JSON.stringify(payload || {})]);
}
function toHuman(pool, projectId, convId, actor, o) {
  o = o || {};
  var reason = reasonOf(o.reason, 'REQUIRES_HUMAN');
  var assign = o.assign_to ? String(o.assign_to).slice(0, 64) : null;
  var runId = o.run_id ? parseInt(o.run_id, 10) || null : null;
  return load(pool, projectId, convId).then(function (c) {
    if (c.handler === 'human' && c.open_handoff_id) {
      var upd = assign ? pool.query("UPDATE wp_handoffs SET assigned_to = $2, taken_by = $2, taken_at = COALESCE(taken_at, now()), status = 'IN_PROGRESS', updated_at = now() WHERE id = $1", [c.open_handoff_id, assign]).then(function () { return pool.query('UPDATE wp_conversations SET assigned_to = $2, updated_at = now() WHERE id = $1', [c.id, assign]); }) : Promise.resolve();
      return upd.then(function () { return { handoff_id: c.open_handoff_id, handler: 'human', status: c.status, already: true }; });
    }
    var eventId = runId ? 'ai-run-' + runId : 'handoff-' + c.id + '-' + Date.now();
    var status = assign ? 'IN_PROGRESS' : 'REQUIRES_HUMAN';
    var takenBy = assign || (actor && actor !== 'ai' && actor !== 'system' && actor.indexOf('system:') !== 0 ? String(actor).slice(0, 64) : null);
    return pool.query("INSERT INTO wp_handoffs (project_id, event_id, conversation_id, customer_ref_masked, channel, reason, intent, status, assigned_to, direction, taken_by, taken_at, previous_state) VALUES ($1,$2,$3,$4,'whatsapp',$5,$6,$7,$8,'ai_to_human',$9,$10,$11) ON CONFLICT (event_id) DO NOTHING RETURNING id", [projectId, eventId, c.id, mask(c.wa_id), reason, c.last_intent ? String(c.last_intent).slice(0, 40) : null, status, assign, takenBy, takenBy ? new Date() : null, JSON.stringify(previousState(c))])
      .then(function (r) {
        if (r.rows[0]) return r.rows[0].id;
        return pool.query('SELECT id FROM wp_handoffs WHERE event_id = $1', [eventId]).then(function (x) { return x.rows[0] ? x.rows[0].id : null; });
      })
      .then(function (handoffId) {
        return pool.query("UPDATE wp_conversations SET handler = 'human', status = CASE WHEN status IN ('open','pending','waiting_customer') THEN 'needs_human' ELSE status END, assigned_to = COALESCE($2, assigned_to), waiting_since = NULL, updated_at = now() WHERE id = $1 RETURNING status, handler", [c.id, assign])
          .then(function (u) {
            var row = u.rows[0];
            return journal(pool, projectId, c.id, actor, 'handoff.created', { handoff_id: handoffId, direction: 'ai_to_human', reason: reason, run_id: runId, assign_to: assign, previous: previousState(c) }).then(function () {
              bus.publish({ type: 'handoff', event: 'handoff.created', project_id: projectId, conversation_id: c.id, direction: 'ai_to_human', handoff_id: handoffId, reason: reason, actor: actor || 'system' });
              return { handoff_id: handoffId, handler: row.handler, status: row.status };
            });
          });
      });
  });
}
function toAI(pool, projectId, convId, actor, o) {
  o = o || {};
  var reason = reasonOf(o.reason, 'HANDED_BACK_TO_AI');
  return load(pool, projectId, convId).then(function (c) {
    return pool.query("UPDATE wp_handoffs SET status = 'RESOLVED', resolved_by = $2, resolved_at = now(), resolution = COALESCE(resolution, $3), updated_at = now() WHERE conversation_id = $1 AND status IN " + OPEN + ' RETURNING id', [c.id, String(actor || 'system').slice(0, 64), reason])
      .then(function (res) {
        var resolved = res.rows.map(function (x) { return x.id; });
        return pool.query("INSERT INTO wp_handoffs (project_id, event_id, conversation_id, customer_ref_masked, channel, reason, intent, status, direction, taken_by, taken_at, resolved_by, resolved_at, previous_state) VALUES ($1,$2,$3,$4,'whatsapp',$5,$6,'RESOLVED','human_to_ai',$7, now(), $7, now(), $8) RETURNING id", [projectId, 'handback-' + c.id + '-' + Date.now(), c.id, mask(c.wa_id), reason, c.last_intent ? String(c.last_intent).slice(0, 40) : null, String(actor || 'system').slice(0, 64), JSON.stringify(previousState(c))])
          .then(function (ins) {
            var handoffId = ins.rows[0].id;
            return pool.query("UPDATE wp_conversations SET handler = 'ai', status = CASE WHEN status = 'needs_human' THEN 'open' ELSE status END, updated_at = now() WHERE id = $1 RETURNING status, handler", [c.id]).then(function (u) {
              var row = u.rows[0];
              return journal(pool, projectId, c.id, actor, 'handoff.resolved', { handoff_id: handoffId, direction: 'human_to_ai', reason: reason, resolved: resolved, previous: previousState(c) }).then(function () {
                bus.publish({ type: 'handoff', event: 'handoff.resolved', project_id: projectId, conversation_id: c.id, direction: 'human_to_ai', handoff_id: handoffId, resolved: resolved, actor: actor || 'system' });
                return { handoff_id: handoffId, handler: row.handler, status: row.status, resolved: resolved };
              });
            });
          });
      });
  });
}
function history(pool, projectId, convId) {
  return pool.query('SELECT h.id, h.direction, h.status, h.reason, h.intent, h.assigned_to, h.taken_by, h.taken_at, h.resolved_by, h.resolved_at, h.previous_state, h.created_at FROM wp_handoffs h WHERE h.project_id = $1 AND h.conversation_id = $2 ORDER BY h.created_at DESC, h.id DESC LIMIT 100', [projectId, convId]).then(function (r) { return r.rows; });
}
module.exports = { toHuman: toHuman, toAI: toAI, history: history };
