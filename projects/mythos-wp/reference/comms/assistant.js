'use strict';
// =====================================================
// MYTHOS WP — AI assistant, suggest-only (MYTHOS-COMMS-7)
// projects/mythos-wp/reference/comms/assistant.js
//
// Runs the MYTHOS AUTO engine of Issue #173 (intents → verified ports →
// business rules → fact guard → policy) on a conversation's latest inbound
// message, in FORCED dry-run: the engine never sends, this module never
// sends. The outcome becomes one wp_ai_runs row (decision, confidence, facts
// used, policy result, latency — never a prompt, never a credential) and,
// when a reply text was produced, one wp_ai_suggestions row for a human to
// accept / edit / reject. A handoff decision creates the linked wp_handoffs
// row and moves the conversation to needs_human.
//
// The customer text is DATA: it is handed to the engine's intent parser and
// ports; nothing in it can change rules, permissions or the generator.
// =====================================================
var autoreply = require('../autoreply');
var store = require('../projects-store');
var bus = require('./bus');
var MODEL = 'mythos-auto-reply/template';
var PROMPT_VERSION = 'engine-173/v1';
function fail(code, status, detail) { var e = new Error(detail || code); e.code = code; e.status = status; return e; }
function confidence(sim) {
  if (!sim || sim.outcome !== 'DECIDED') return 0;
  if (sim.requires_human || sim.action === 'handoff') return 0.25;
  var unknown = sim.facts && sim.facts.unknown ? sim.facts.unknown.length : 0;
  var verified = sim.facts && sim.facts.verified ? sim.facts.verified.length : 0;
  if (sim.action === 'reply' && sim.proposed_text) return unknown ? 0.55 : (verified ? 0.85 : 0.7);
  return 0.4;
}
function latestInbound(pool, projectId, convId, messageId) {
  var params = [projectId, convId]; var extra = '';
  if (messageId) { params.push(messageId); extra = ' AND id = $3'; }
  return pool.query("SELECT id, text, message_type FROM wp_messages WHERE project_id = $1 AND conversation_id = $2 AND direction = 'in'" + extra + ' ORDER BY created_at DESC, id DESC LIMIT 1', params).then(function (r) { return r.rows[0] || null; });
}
// suggest(pool, resolved, convId, actor, { message_id, trigger }) → run + suggestion
function suggest(pool, resolved, convId, actor, opts) {
  opts = opts || {};
  var projectId = resolved.project.id;
  var t0 = Date.now();
  return pool.query('SELECT id, contact_id, status FROM wp_conversations WHERE project_id = $1 AND id = $2', [projectId, convId]).then(function (r) {
    if (!r.rows[0]) throw fail('not_found', 404, 'no such conversation');
    return latestInbound(pool, projectId, convId, opts.message_id ? parseInt(opts.message_id, 10) : null);
  }).then(function (m) {
    if (!m) throw fail('precondition', 412, 'no inbound message to answer');
    var text = m.text && m.text.trim() ? m.text : (m.message_type !== 'text' ? '[' + m.message_type + ' sans texte]' : '');
    if (!text) throw fail('precondition', 412, 'the latest inbound message has no text');
    return autoreply.simulate(resolved, text).then(function (sim) {
      var decision = sim.outcome !== 'DECIDED' ? 'none' : (sim.action === 'reply' && sim.proposed_text && !sim.requires_human ? 'suggest' : 'handoff');
      var conf = confidence(sim);
      return pool.query('INSERT INTO wp_ai_runs (project_id, conversation_id, message_id, kind, model, prompt_version, facts_used, intent, language, confidence, decision, policy_result, status, latency_ms) VALUES ($1,$2,$3,\'suggest\',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, created_at',
        [projectId, convId, m.id, MODEL, PROMPT_VERSION, JSON.stringify({ verified: sim.facts.verified, unknown: sim.facts.unknown, required: sim.facts.required, entities: sim.entities || null }), sim.intent || null, ['fr', 'ar', 'en'].indexOf(sim.language) !== -1 ? sim.language : null, conf, decision, JSON.stringify({ outcome: sim.outcome, reason: sim.reason, stage: sim.stage, action: sim.action, decision_reason: sim.decision_reason, requires_human: sim.requires_human, rejections: sim.policy ? sim.policy.rejections : null, source: sim.source, trigger: opts.trigger || 'manual' }), sim.outcome === 'DECIDED' ? 'ok' : 'skipped', Date.now() - t0]
      ).then(function (ins) {
        var runId = ins.rows[0].id;
        var out = { run_id: runId, decision: decision, confidence: conf, intent: sim.intent || null, language: sim.language || null, facts: sim.facts, entities: sim.entities || null, policy: sim.policy ? { rejections: sim.policy.rejections } : null, suggestion: null, handoff: null, message_id: m.id };
        var chain = pool.query('INSERT INTO wp_conversation_events (project_id, conversation_id, kind, actor, payload) VALUES ($1,$2,\'ai_run\',$3,$4)', [projectId, convId, actor, JSON.stringify({ run_id: runId, decision: decision, intent: sim.intent || null, confidence: conf })]);
        if (decision === 'suggest') {
          chain = chain.then(function () { return pool.query('INSERT INTO wp_ai_suggestions (run_id, conversation_id, rank, text) VALUES ($1,$2,1,$3) RETURNING id, text, status, created_at', [runId, convId, sim.proposed_text]); })
            .then(function (s) { out.suggestion = s.rows[0]; });
        } else if (decision === 'handoff') {
          chain = chain.then(function () { return pool.query('INSERT INTO wp_handoffs (project_id, event_id, conversation_id, channel, reason, intent, language, entities, facts, status) VALUES ($1,$2,$3,\'whatsapp\',$4,$5,$6,$7,$8,\'REQUIRES_HUMAN\') ON CONFLICT (event_id) DO NOTHING RETURNING id', [projectId, 'ai-run-' + runId, convId, String(sim.decision_reason || 'REQUIRES_HUMAN').slice(0, 64), sim.intent ? String(sim.intent).slice(0, 40) : null, ['fr', 'ar', 'en'].indexOf(sim.language) !== -1 ? sim.language : null, JSON.stringify(sim.entities || {}), JSON.stringify({ required: sim.facts.required, available: sim.facts.verified, missing: sim.facts.unknown })]); })
            .then(function (h) { out.handoff = h.rows[0] ? h.rows[0].id : null; return pool.query("UPDATE wp_conversations SET status = CASE WHEN status IN ('open','pending','waiting_customer') THEN 'needs_human' ELSE status END, last_intent = COALESCE($2, last_intent), updated_at = now() WHERE id = $1", [convId, sim.intent || null]); })
            .then(function () { return pool.query('INSERT INTO wp_conversation_events (project_id, conversation_id, kind, actor, payload) VALUES ($1,$2,\'handoff\',$3,$4)', [projectId, convId, 'ai', JSON.stringify({ run_id: runId, reason: sim.decision_reason || 'REQUIRES_HUMAN', handoff_id: out.handoff })]); });
        }
        if (sim.intent) chain = chain.then(function () { return pool.query('UPDATE wp_conversations SET last_intent = $2, language = COALESCE(language, $3), updated_at = now() WHERE id = $1', [convId, String(sim.intent).slice(0, 40), ['fr', 'ar', 'en'].indexOf(sim.language) !== -1 ? sim.language : null]); });
        return chain.then(function () { bus.publish({ type: 'ai.run', project_id: projectId, conversation_id: convId, run_id: runId, decision: decision, suggestion_id: out.suggestion ? out.suggestion.id : null }); return out; });
      });
    });
  });
}
function listSuggestions(pool, projectId, convId) {
  return pool.query('SELECT s.id, s.run_id, s.rank, s.text, s.status, s.decided_by, s.decided_at, s.edited_text, s.sent_message_id, s.created_at, r.intent, r.confidence, r.decision, r.facts_used, r.policy_result FROM wp_ai_suggestions s JOIN wp_ai_runs r ON r.id = s.run_id WHERE r.project_id = $1 AND s.conversation_id = $2 ORDER BY s.created_at DESC, s.id DESC LIMIT 20', [projectId, convId]).then(function (r) { return r.rows; });
}
// decide(pool, projectId, convId, sid, actor, { action: accept|edit|reject, text }) → { suggestion, send: { text, ai_run_id, suggestion_id } | null }
function decide(pool, projectId, convId, sid, actor, body) {
  body = body || {};
  var action = body.action;
  if (['accept', 'edit', 'reject'].indexOf(action) === -1) throw fail('validation', 400, 'action accept|edit|reject');
  return pool.query('SELECT s.id, s.text, s.status, s.run_id FROM wp_ai_suggestions s JOIN wp_ai_runs r ON r.id = s.run_id WHERE r.project_id = $1 AND s.conversation_id = $2 AND s.id = $3', [projectId, convId, sid]).then(function (r) {
    var s = r.rows[0];
    if (!s) throw fail('not_found', 404, 'no such suggestion');
    if (s.status !== 'proposed') throw fail('precondition', 412, 'suggestion already ' + s.status);
    var status = action === 'reject' ? 'rejected' : action === 'edit' ? 'edited' : 'accepted';
    var edited = action === 'edit' ? String(body.text || '').trim() : null;
    if (action === 'edit' && (!edited || edited.length > 4096)) throw fail('validation', 400, 'edited text required (1–4096)');
    return pool.query('UPDATE wp_ai_suggestions SET status = $2, decided_by = $3, decided_at = now(), edited_text = $4 WHERE id = $1 RETURNING id, status, edited_text, run_id', [sid, status, actor, edited])
      .then(function (u) { return pool.query('INSERT INTO wp_conversation_events (project_id, conversation_id, kind, actor, payload) VALUES ($1,$2,\'ai_decision\',$3,$4)', [projectId, convId, actor, JSON.stringify({ suggestion_id: sid, run_id: s.run_id, action: action })]).then(function () { return u.rows[0]; }); })
      .then(function (row) { return { suggestion: row, send: action === 'reject' ? null : { text: edited || s.text, ai_run_id: s.run_id, suggestion_id: sid } }; });
  });
}
// markSent(pool, sid, messageId) — called by outbound once the accepted text left
function markSent(pool, sid, messageId) {
  return pool.query("UPDATE wp_ai_suggestions SET status = 'sent', sent_message_id = $2 WHERE id = $1 AND status IN ('accepted','edited')", [sid, messageId]);
}
// attach(pool, log) — auto-suggest on message.in for inboxes whose settings.ai_suggest is true (OFF by default)
var attached = false;
function attach(pool, log) {
  if (attached) return; attached = true;
  bus.bus.on('comms', function (ev) {
    if (ev.type !== 'message.in' || !ev.conversation_id) return;
    pool.query("SELECT i.settings, c.project_id FROM wp_conversations c JOIN wp_inboxes i ON i.id = c.inbox_id WHERE c.id = $1", [ev.conversation_id]).then(function (r) {
      var row = r.rows[0];
      if (!row || !row.settings || row.settings.ai_suggest !== true) return null;
      return store.resolve(row.project_id).then(function (resolved) { if (!resolved) return null; return suggest(pool, resolved, ev.conversation_id, 'ai', { message_id: ev.message_id, trigger: 'auto' }); });
    }).then(function (out) { if (out && log) log({ level: 'info', assistant: 'auto', conversation_id: ev.conversation_id, decision: out.decision, confidence: out.confidence, intent: out.intent }); })
      .catch(function (e) { if (log) log({ level: 'warn', assistant: 'auto_failed', conversation_id: ev.conversation_id, reason: String(e && e.message || e).slice(0, 120) }); });
  });
}
module.exports = { suggest: suggest, listSuggestions: listSuggestions, decide: decide, markSent: markSent, attach: attach, MODEL: MODEL, PROMPT_VERSION: PROMPT_VERSION };
