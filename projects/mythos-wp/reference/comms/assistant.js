'use strict';
// =====================================================
// MYTHOS WP — AI assistant: suggestions and policy-gated automatic replies
// projects/mythos-wp/reference/comms/assistant.js   (MYTHOS-COMMS-7 → V2)
//
// One inbound message → one wp_ai_runs row (decision, confidence, facts
// used, policy result, tools used, latency — never a prompt, never the
// customer text, never a credential) and, when a reply text was produced,
// one wp_ai_suggestions row. The agent that answers is resolved by
// ai/agents.js (conversation → inbox binding → project binding); when no
// agent is bound the behaviour of MYTHOS-COMMS-7 is unchanged: the #173
// engine runs in FORCED dry-run (MODEL 'mythos-auto-reply/template').
//
//   engine 'engine-173'  autoreply.simulate: intents → verified ports →
//                        rules → fact guard → policy. Deterministic, offline.
//   engine 'llm'         ai/llm.js: the free-LLM pool with the agent's tools
//                        (least privilege), JSON tool protocol, #173 factGuard
//                        on the final text. Any failure (no provider,
//                        malformed answer, guard violation) FALLS BACK to the
//                        template path with a lowered confidence — the LLM
//                        can phrase, it cannot know.
//
//   suggest()    → proposes; a human accepts / edits / rejects (decide()).
//   autoReply()  → suggest + every gate of the build contract (agent mode
//                  auto, decision suggest, confidence ≥ confidence_min, inbox
//                  outbound_enabled and open, handler 'ai', no open handoff,
//                  per-conversation hourly cap) → outbound.send with
//                  client_ref 'auto-<run id>' and the suggestion marked sent.
//                  Any failed gate leaves a plain suggestion.
//   attach()     → bus listener: settings.ai_suggest (legacy, no agent) and,
//                  for conversations handled by 'ai' with a resolved agent,
//                  autoReply (mode auto) / suggest (mode suggest) / nothing
//                  (off). One run per inbound message, whoever triggers it.
//   test()       → runs an agent on a synthetic message (kind 'test'): no
//                  conversation, no run row, no send — the outcome only.
//
// Handoff decisions go through comms/handoff.js (builder A) when present;
// otherwise the inline wp_handoffs insert of COMMS-7 is kept AND the
// conversation handler is set to 'human'. The customer text is DATA.
// =====================================================
var path = require('path');
var autoreply = require('../autoreply');
var store = require('../projects-store');
var bus = require('./bus');
var agents = require('../ai/agents');
var llm = require('../ai/llm');
var MODEL = 'mythos-auto-reply/template';
var PROMPT_VERSION = 'engine-173/v1';
var LANGS = ['fr', 'ar', 'en'];
var FALLBACK_CONFIDENCE_MAX = 0.5;
var DEFAULT_MAX_REPLIES_PER_HOUR = 5;
var inflight = Object.create(null); // message_id → true while an automatic run is in progress

function fail(code, status, detail) { var e = new Error(detail || code); e.code = code; e.status = status; return e; }
function lang(l) { return LANGS.indexOf(l) !== -1 ? l : null; }
function handoffModule() { try { return require('./handoff'); } catch (e) { if (e && e.code === 'MODULE_NOT_FOUND' && /handoff/.test(String(e.message))) return null; throw e; } }
function intentsModule() { try { return require(path.join(__dirname, '..', '..', '..', 'automotive', 'comms', 'lib', 'intents')); } catch (e) { return null; } }
function clientRef(runId) { var s = String(runId); while (s.length < 6) s = '0' + s; return 'auto-' + s; }

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
function loadConversation(pool, projectId, convId) {
  return pool.query("SELECT c.id, c.contact_id, c.status, c.handler, c.agent_id, c.inbox_id, c.project_id, i.ai_mode, i.outbound_enabled, i.status AS inbox_status, i.settings AS inbox_settings, EXISTS (SELECT 1 FROM wp_handoffs h WHERE h.conversation_id = c.id AND h.status IN ('NEW','REQUIRES_HUMAN','IN_PROGRESS')) AS handoff_open FROM wp_conversations c JOIN wp_inboxes i ON i.id = c.inbox_id WHERE c.project_id = $1 AND c.id = $2", [projectId, convId]).then(function (r) { return r.rows[0] || null; });
}
function inboxOf(c) { return { id: c.inbox_id, ai_mode: c.ai_mode, outbound_enabled: c.outbound_enabled, status: c.inbox_status, settings: c.inbox_settings }; }

// ------------------------------------------------------------------ engines
// Both engines produce one outcome: { engine, model, prompt_version, decision none|suggest|handoff, confidence, intent,
//   language, entities, facts:{ verified, unknown, required }, text, handoff_reason, policy, status ok|skipped|error, tools_used }
function runEngine173(resolved, text, trigger) {
  return autoreply.simulate(resolved, text).then(function (sim) {
    var decision = sim.outcome !== 'DECIDED' ? 'none' : (sim.action === 'reply' && sim.proposed_text && !sim.requires_human ? 'suggest' : 'handoff');
    return {
      engine: 'engine-173', model: MODEL, prompt_version: PROMPT_VERSION, decision: decision, confidence: confidence(sim),
      intent: sim.intent || null, language: lang(sim.language), entities: sim.entities || null,
      facts: { verified: sim.facts.verified, unknown: sim.facts.unknown, required: sim.facts.required },
      text: decision === 'suggest' ? sim.proposed_text : null, handoff_reason: String(sim.decision_reason || 'REQUIRES_HUMAN').slice(0, 64),
      policy: { engine: 'engine-173', outcome: sim.outcome, reason: sim.reason, stage: sim.stage, action: sim.action, decision_reason: sim.decision_reason, requires_human: sim.requires_human, rejections: sim.policy ? sim.policy.rejections : null, source: sim.source, trigger: trigger || 'manual' },
      status: sim.outcome === 'DECIDED' ? 'ok' : 'skipped', tools_used: []
    };
  });
}
function hintFor(text, agent) {
  var mod = intentsModule();
  if (!mod) return { intent: null, language: agent.language || null, entities: null };
  try { var c = mod.classify(text, { content_type: 'text', attachments: 0, languages: LANGS }); return { intent: c.intent || null, language: lang(c.language) || agent.language || null, entities: c.entities || null }; } catch (e) { return { intent: null, language: agent.language || null, entities: null }; }
}
function runLlm(pool, resolved, agent, text, ctx) {
  ctx = ctx || {};
  var hint = hintFor(text, agent);
  return llm.runAgent({ agent: agent, resolved: resolved, pool: pool, conversation_id: ctx.conversation_id || null, text: text, hint: hint, transport: ctx.transport, poolOpts: ctx.poolOpts, timeoutMs: ctx.timeoutMs }).then(function (r) {
    var model = r.provider_id && r.model_id ? (r.provider_id + '/' + r.model_id).slice(0, 64) : null;
    var base = { provider_id: r.provider_id, model_id: r.model_id, rounds: r.rounds, calls: r.calls, llm_latency_ms: r.latency_ms, guard: r.guard, trigger: ctx.trigger || 'manual' };
    if (r.ok && r.decision === 'reply') {
      return { engine: 'llm', model: model, prompt_version: r.prompt_version, decision: 'suggest', confidence: r.confidence, intent: r.intent || hint.intent, language: hint.language, entities: hint.entities,
        facts: { verified: r.facts.available, unknown: [], required: [] }, text: r.text, handoff_reason: null, policy: Object.assign({ engine: 'llm', action: 'reply' }, base), status: 'ok', tools_used: r.tools_used };
    }
    if (r.ok && r.decision === 'handoff') {
      return { engine: 'llm', model: model, prompt_version: r.prompt_version, decision: 'handoff', confidence: Math.min(r.confidence, 0.25), intent: r.intent || hint.intent, language: hint.language, entities: hint.entities,
        facts: { verified: r.facts.available, unknown: [], required: [] }, text: null, handoff_reason: String(r.reason || 'AGENT_REQUESTED').slice(0, 64), policy: Object.assign({ engine: 'llm', action: 'handoff', decision_reason: r.reason }, base), status: 'ok', tools_used: r.tools_used };
    }
    // Fallback: the deterministic template path, confidence capped — the failure is recorded, never hidden.
    return runEngine173(resolved, text, ctx.trigger).then(function (o) {
      o.confidence = Math.min(o.confidence, FALLBACK_CONFIDENCE_MAX);
      o.policy.fallback = Object.assign({ from: 'llm', reason: r.reason || 'LLM_FAILED' }, base);
      o.policy.fallback_reason = r.reason || 'LLM_FAILED';
      o.tools_used = r.tools_used || [];
      o.llm_reason = r.reason || 'LLM_FAILED';
      return o;
    });
  });
}
function runEngine(pool, resolved, agent, text, ctx) {
  if (agent && agent.engine === 'llm') return runLlm(pool, resolved, agent, text, ctx);
  return runEngine173(resolved, text, ctx && ctx.trigger);
}

// ---------------------------------------------------------------- suggest
// suggest(pool, resolved, convId, actor, { message_id, trigger, kind, agent, transport, poolOpts }) → run + suggestion
function suggest(pool, resolved, convId, actor, opts) {
  opts = opts || {};
  var projectId = resolved.project.id;
  var kind = opts.kind === 'auto_reply' ? 'auto_reply' : 'suggest';
  var t0 = Date.now();
  var agent;
  return loadConversation(pool, projectId, convId).then(function (c) {
    if (!c) throw fail('not_found', 404, 'no such conversation');
    // Safety gate (enforced here, not only documented): a conversation flagged for a human gets no AI run.
    if (c.status === 'needs_human' || c.handoff_open) {
      return pool.query('INSERT INTO wp_conversation_events (project_id, conversation_id, kind, event_name, actor, payload) VALUES ($1,$2,\'ai_refused\',\'ai.refused\',$3,$4)', [projectId, convId, actor, JSON.stringify({ reason: c.status === 'needs_human' ? 'NEEDS_HUMAN' : 'HANDOFF_OPEN', trigger: opts.trigger || 'manual' })])
        .then(function () { throw fail('precondition', 412, 'conversation is flagged for a human; the assistant does not run'); });
    }
    return opts.agent !== undefined ? opts.agent : agents.resolveForConversation(pool, convId);
  }).then(function (a) {
    agent = a || null;
    return latestInbound(pool, projectId, convId, opts.message_id ? parseInt(opts.message_id, 10) : null);
  }).then(function (m) {
    if (!m) throw fail('precondition', 412, 'no inbound message to answer');
    var text = m.text && m.text.trim() ? m.text : (m.message_type !== 'text' ? '[' + m.message_type + ' sans texte]' : '');
    if (!text) throw fail('precondition', 412, 'the latest inbound message has no text');
    return runEngine(pool, resolved, agent, text, { conversation_id: convId, trigger: opts.trigger || 'manual', transport: opts.transport, poolOpts: opts.poolOpts }).then(function (o) {
      return pool.query('INSERT INTO wp_ai_runs (project_id, conversation_id, message_id, kind, model, prompt_version, facts_used, intent, language, confidence, decision, policy_result, status, latency_ms, agent_id, tools_used) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id, created_at',
        [projectId, convId, m.id, kind, o.model, o.prompt_version, JSON.stringify({ verified: o.facts.verified, unknown: o.facts.unknown, required: o.facts.required, entities: o.entities || null }), o.intent ? String(o.intent).slice(0, 40) : null, o.language, o.confidence, o.decision, JSON.stringify(o.policy), o.status, Date.now() - t0, agent ? agent.id : null, JSON.stringify(o.tools_used || [])]
      ).then(function (ins) {
        var runId = ins.rows[0].id;
        var out = { run_id: runId, kind: kind, decision: o.decision, confidence: o.confidence, intent: o.intent || null, language: o.language, facts: o.facts, entities: o.entities || null, policy: o.policy && o.policy.rejections !== undefined ? { rejections: o.policy.rejections } : (o.policy ? { engine: o.policy.engine } : null), suggestion: null, handoff: null, message_id: m.id, agent_id: agent ? agent.id : null, agent_slug: agent ? agent.slug : null, engine: o.engine, model: o.model, tools_used: o.tools_used || [], fallback_reason: o.llm_reason || null };
        var chain = pool.query('INSERT INTO wp_conversation_events (project_id, conversation_id, kind, event_name, actor, payload) VALUES ($1,$2,\'ai_run\',$5,$3,$4)', [projectId, convId, actor, JSON.stringify({ run_id: runId, decision: o.decision, intent: o.intent || null, confidence: o.confidence, agent_id: agent ? agent.id : null, engine: o.engine }), o.decision === 'suggest' ? 'ai.suggested' : 'ai.run']);
        if (o.decision === 'suggest') {
          chain = chain.then(function () { return pool.query('INSERT INTO wp_ai_suggestions (run_id, conversation_id, rank, text) VALUES ($1,$2,1,$3) RETURNING id, text, status, created_at', [runId, convId, o.text]); })
            .then(function (s) { out.suggestion = s.rows[0]; });
        } else if (o.decision === 'handoff') {
          chain = chain.then(function () { return handoffToHuman(pool, projectId, convId, runId, o); }).then(function (hid) { out.handoff = hid; });
        }
        if (o.intent) chain = chain.then(function () { return pool.query('UPDATE wp_conversations SET last_intent = $2, language = COALESCE(language, $3), updated_at = now() WHERE id = $1', [convId, String(o.intent).slice(0, 40), o.language]); });
        return chain.then(function () { bus.publish({ type: 'ai.run', project_id: projectId, conversation_id: convId, run_id: runId, decision: o.decision, suggestion_id: out.suggestion ? out.suggestion.id : null, agent_id: out.agent_id }); return out; });
      });
    });
  });
}

// handoffToHuman: comms/handoff.js (builder A) when present; else the COMMS-7 inline insert + handler = 'human'
function handoffToHuman(pool, projectId, convId, runId, o) {
  var mod = handoffModule();
  var reason = String(o.handoff_reason || 'REQUIRES_HUMAN').slice(0, 64);
  if (mod && typeof mod.toHuman === 'function') {
    return Promise.resolve(mod.toHuman(pool, projectId, convId, 'ai', { reason: reason, run_id: runId, intent: o.intent || null, language: o.language, entities: o.entities || null, facts: o.facts })).then(function (h) {
      if (!h) return null;
      return h.handoff_id !== undefined ? h.handoff_id : (h.id !== undefined ? h.id : null);
    });
  }
  return pool.query('INSERT INTO wp_handoffs (project_id, event_id, conversation_id, channel, reason, intent, language, entities, facts, status) VALUES ($1,$2,$3,\'whatsapp\',$4,$5,$6,$7,$8,\'REQUIRES_HUMAN\') ON CONFLICT (event_id) DO NOTHING RETURNING id', [projectId, 'ai-run-' + runId, convId, reason, o.intent ? String(o.intent).slice(0, 40) : null, o.language, JSON.stringify(o.entities || {}), JSON.stringify({ required: o.facts.required, available: o.facts.verified, missing: o.facts.unknown })])
    .then(function (h) {
      var hid = h.rows[0] ? h.rows[0].id : null;
      return pool.query("UPDATE wp_conversations SET handler = 'human', status = CASE WHEN status IN ('open','pending','waiting_customer') THEN 'needs_human' ELSE status END, last_intent = COALESCE($2, last_intent), updated_at = now() WHERE id = $1", [convId, o.intent ? String(o.intent).slice(0, 40) : null])
        .then(function () { return pool.query('INSERT INTO wp_conversation_events (project_id, conversation_id, kind, event_name, actor, payload) VALUES ($1,$2,\'handoff\',\'handoff.created\',$3,$4)', [projectId, convId, 'ai', JSON.stringify({ run_id: runId, reason: reason, handoff_id: hid, direction: 'ai_to_human' })]); })
        .then(function () { bus.publish({ type: 'handoff', event: 'handoff.created', project_id: projectId, conversation_id: convId, direction: 'ai_to_human', run_id: runId }); return hid; });
    });
}

// -------------------------------------------------------------- autoReply
function alreadyRan(pool, messageId) {
  if (!messageId) return Promise.resolve(false);
  return pool.query('SELECT 1 FROM wp_ai_runs WHERE message_id = $1 LIMIT 1', [messageId]).then(function (r) { return r.rows.length > 0; });
}
function setPolicy(pool, runId, patch) {
  return pool.query('UPDATE wp_ai_runs SET policy_result = COALESCE(policy_result, \'{}\'::jsonb) || $2::jsonb WHERE id = $1', [runId, JSON.stringify(patch)]);
}
// autoReply(pool, resolved, convId, { message_id, trigger, agent, transport, poolOpts }) →
//   { ran, sent, reason, mode, gates, run_id, decision, confidence, suggestion, message_id (sent row), … }
function autoReply(pool, resolved, convId, opts) {
  opts = opts || {};
  var projectId = resolved.project.id;
  var trigger = opts.trigger || 'manual';
  var msgId = opts.message_id ? parseInt(opts.message_id, 10) : null;
  var agent, mode;
  return loadConversation(pool, projectId, convId).then(function (c) {
    if (!c) throw fail('not_found', 404, 'no such conversation');
    if (c.handler !== 'ai') return { ran: false, sent: false, reason: 'HANDLER_NOT_AI', handler: c.handler };
    return (opts.agent !== undefined ? Promise.resolve(opts.agent) : agents.resolveForConversation(pool, convId)).then(function (a) {
      agent = a || null;
      if (!agent) return { ran: false, sent: false, reason: 'NO_AGENT' };
      mode = agents.effectiveMode(agent, inboxOf(c), resolved && resolved.project);
      if (mode === 'off') return { ran: false, sent: false, reason: 'MODE_OFF', mode: mode, agent_id: agent.id };
      if (msgId && trigger !== 'manual' && inflight[msgId]) return { ran: false, sent: false, reason: 'DUPLICATE_MESSAGE', mode: mode, agent_id: agent.id };
      return (trigger !== 'manual' ? alreadyRan(pool, msgId) : Promise.resolve(false)).then(function (dup) {
        if (dup) return { ran: false, sent: false, reason: 'DUPLICATE_MESSAGE', mode: mode, agent_id: agent.id };
        if (msgId) inflight[msgId] = true;
        return suggest(pool, resolved, convId, 'ai', { message_id: msgId, trigger: trigger, kind: mode === 'auto' ? 'auto_reply' : 'suggest', agent: agent, transport: opts.transport, poolOpts: opts.poolOpts })
          .then(function (out) { return gateAndSend(pool, resolved, convId, agent, mode, out); })
          .then(function (r) { if (msgId) delete inflight[msgId]; return r; }, function (e) { if (msgId) delete inflight[msgId]; throw e; });
      });
    });
  });
}
function gateAndSend(pool, resolved, convId, agent, mode, out) {
  var projectId = resolved.project.id;
  var cap = agent.settings && agent.settings.max_replies_per_hour ? Number(agent.settings.max_replies_per_hour) : DEFAULT_MAX_REPLIES_PER_HOUR;
  return Promise.all([
    loadConversation(pool, projectId, convId),
    pool.query("SELECT count(*)::int AS n FROM wp_messages WHERE conversation_id = $1 AND direction = 'out' AND sender_kind = 'ai' AND created_at > now() - interval '1 hour'", [convId]).then(function (r) { return r.rows[0].n; })
  ]).then(function (x) {
    var c = x[0]; var replies = x[1];
    var gates = [
      { gate: 'MODE_AUTO', pass: mode === 'auto' },
      { gate: 'DECISION_SUGGEST', pass: out.decision === 'suggest' && !!out.suggestion },
      { gate: 'CONFIDENCE_MIN', pass: Number(out.confidence) >= Number(agent.confidence_min), value: out.confidence, min: Number(agent.confidence_min) },
      { gate: 'OUTBOUND_ENABLED', pass: !!(c && c.outbound_enabled) },
      { gate: 'INBOX_OPEN', pass: !!(c && c.inbox_status === 'open') },
      { gate: 'HANDLER_AI', pass: !!(c && c.handler === 'ai') },
      { gate: 'NO_OPEN_HANDOFF', pass: !!(c && !c.handoff_open) },
      { gate: 'REPLY_CAP', pass: replies < cap, value: replies, cap: cap }
    ];
    var blocked = gates.filter(function (g) { return !g.pass; }).map(function (g) { return g.gate; });
    var base = Object.assign({}, out, { ran: true, mode: mode, gates: gates, blocked_by: blocked });
    if (blocked.length) {
      var reason = { MODE_AUTO: 'MODE_NOT_AUTO', DECISION_SUGGEST: 'DECISION_NOT_SUGGEST', CONFIDENCE_MIN: 'CONFIDENCE_BELOW_MIN', OUTBOUND_ENABLED: 'OUTBOUND_DISABLED', INBOX_OPEN: 'INBOX_NOT_OPEN', HANDLER_AI: 'HANDLER_NOT_AI', NO_OPEN_HANDOFF: 'HANDOFF_OPEN', REPLY_CAP: 'REPLY_RATE_EXCEEDED' }[blocked[0]];
      return setPolicy(pool, out.run_id, { auto_reply: { sent: false, blocked_by: blocked, reason: reason, cap: cap, replies_last_hour: replies } }).then(function () { return Object.assign(base, { sent: false, reason: reason }); });
    }
    var outbound = require('./outbound');
    var sendP;
    try { sendP = outbound.send(pool, projectId, convId, 'ai:' + out.run_id, { text: out.suggestion.text, client_ref: clientRef(out.run_id), ai_run_id: out.run_id, suggestion_id: out.suggestion.id }); } catch (e) { sendP = Promise.reject(e); }
    return sendP.then(function (r) {
      if (r.status !== 'sent') return setPolicy(pool, out.run_id, { auto_reply: { sent: false, reason: 'SEND_FAILED', error: r.error ? String(r.error).slice(0, 120) : null, message_id: r.message_id } }).then(function () { return Object.assign(base, { sent: false, reason: 'SEND_FAILED', message_id: r.message_id, error: r.error || null }); });
      return pool.query("UPDATE wp_ai_suggestions SET status = 'sent', sent_message_id = $2, decided_by = 'ai', decided_at = now() WHERE id = $1 AND status IN ('proposed','accepted')", [out.suggestion.id, r.message_id])
        .then(function () { return pool.query("UPDATE wp_ai_runs SET decision = 'auto_reply', policy_result = COALESCE(policy_result, '{}'::jsonb) || $2::jsonb WHERE id = $1", [out.run_id, JSON.stringify({ auto_reply: { sent: true, message_id: r.message_id, client_ref: clientRef(out.run_id), cap: cap, replies_last_hour: replies } })]); })
        .then(function () { return pool.query('INSERT INTO wp_conversation_events (project_id, conversation_id, kind, event_name, actor, payload) VALUES ($1,$2,\'ai_run\',\'ai.sent\',\'ai\',$3)', [projectId, convId, JSON.stringify({ run_id: out.run_id, suggestion_id: out.suggestion.id, message_id: r.message_id, agent_id: agent.id })]); })
        .then(function () {
          bus.publish({ type: 'ai.run', event: 'ai.sent', project_id: projectId, conversation_id: convId, run_id: out.run_id, suggestion_id: out.suggestion.id, message_id: r.message_id, agent_id: agent.id });
          out.suggestion.status = 'sent'; out.suggestion.sent_message_id = r.message_id;
          return Object.assign(base, { sent: true, decision: 'auto_reply', reason: null, message_id: r.message_id, client_ref: clientRef(out.run_id) });
        });
    }, function (e) {
      var code = e && e.code ? String(e.code) : 'SEND_ERROR';
      return setPolicy(pool, out.run_id, { auto_reply: { sent: false, reason: 'SEND_REFUSED', error: code } }).then(function () { return Object.assign(base, { sent: false, reason: 'SEND_REFUSED', error: code }); });
    });
  });
}

// ------------------------------------------------------------------- test
// test(pool, resolved, agent, text, { transport, poolOpts }) → outcome only (kind 'test'): no conversation, no run row, no send
function test(pool, resolved, agent, text, opts) {
  opts = opts || {};
  text = String(text || '').trim();
  if (!text || text.length > 2000) throw fail('validation', 400, 'text required (1–2000 chars)');
  if (!agent) throw fail('validation', 400, 'agent required');
  var t0 = Date.now();
  return runEngine(pool, resolved, agent, text, { conversation_id: null, trigger: 'test', transport: opts.transport, poolOpts: opts.poolOpts }).then(function (o) {
    return { kind: 'test', agent_id: agent.id, agent_slug: agent.slug, decision: o.decision, intent: o.intent || null, confidence: o.confidence, language: o.language, text: o.text, facts: o.facts, entities: o.entities || null, tools_used: o.tools_used || [], engine: o.engine, model: o.model, prompt_version: o.prompt_version, handoff_reason: o.decision === 'handoff' ? o.handoff_reason : null, fallback_reason: o.llm_reason || null, policy: o.policy, latency_ms: Date.now() - t0, dry_run: true };
  });
}

// ------------------------------------------------------- suggestions API
function listSuggestions(pool, projectId, convId) {
  return pool.query('SELECT s.id, s.run_id, s.rank, s.text, s.status, s.decided_by, s.decided_at, s.edited_text, s.sent_message_id, s.created_at, r.intent, r.confidence, r.decision, r.facts_used, r.policy_result, r.agent_id, r.model, r.kind FROM wp_ai_suggestions s JOIN wp_ai_runs r ON r.id = s.run_id WHERE r.project_id = $1 AND s.conversation_id = $2 ORDER BY s.created_at DESC, s.id DESC LIMIT 20', [projectId, convId]).then(function (r) { return r.rows; });
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
      .then(function (u) { return pool.query('INSERT INTO wp_conversation_events (project_id, conversation_id, kind, event_name, actor, payload) VALUES ($1,$2,\'ai_decision\',\'ai.decided\',$3,$4)', [projectId, convId, actor, JSON.stringify({ suggestion_id: sid, run_id: s.run_id, action: action })]).then(function () { return u.rows[0]; }); })
      .then(function (row) { return { suggestion: row, send: action === 'reject' ? null : { text: edited || s.text, ai_run_id: s.run_id, suggestion_id: sid } }; });
  });
}
// markSent(pool, sid, messageId) — called by outbound once the accepted text left
function markSent(pool, sid, messageId) {
  return pool.query("UPDATE wp_ai_suggestions SET status = 'sent', sent_message_id = $2 WHERE id = $1 AND status IN ('accepted','edited')", [sid, messageId]);
}
// listRuns(pool, { projects: [ids] | null, project, agent, limit }) → rows without any text
function listRuns(pool, opts) {
  opts = opts || {};
  var where = []; var params = [];
  if (opts.project) { params.push(String(opts.project)); where.push('r.project_id = $' + params.length); }
  else if (Array.isArray(opts.projects)) { params.push(opts.projects.map(String)); where.push('r.project_id = ANY($' + params.length + '::text[])'); }
  if (opts.agent) { params.push(parseInt(opts.agent, 10) || 0); where.push('r.agent_id = $' + params.length); }
  var limit = Math.min(Math.max(parseInt(opts.limit, 10) || 50, 1), 200);
  return pool.query('SELECT r.id, r.project_id, r.conversation_id, r.message_id, r.kind, r.model, r.prompt_version, r.intent, r.language, r.confidence, r.decision, r.status, r.error, r.latency_ms, r.agent_id, a.slug AS agent_slug, a.name AS agent_name, r.tools_used, r.facts_used, r.policy_result, r.created_at, (SELECT s.status FROM wp_ai_suggestions s WHERE s.run_id = r.id ORDER BY s.id LIMIT 1) AS suggestion_status FROM wp_ai_runs r LEFT JOIN wp_agents a ON a.id = r.agent_id' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY r.created_at DESC, r.id DESC LIMIT ' + limit, params)
    .then(function (r) { return r.rows.map(function (x) { x.confidence = x.confidence === null ? null : Number(x.confidence); x.agent_id = x.agent_id === null ? null : Number(x.agent_id); return x; }); });
}

// ------------------------------------------------------------------ attach
// attach(pool, log) — bus listener (see header). One listener per process.
var attached = false;
function attach(pool, log) {
  if (attached) return; attached = true;
  bus.bus.on('comms', function (ev) {
    if (ev.type !== 'message.in' || !ev.conversation_id) return;
    var msgId = ev.message_id ? parseInt(ev.message_id, 10) : null;
    if (msgId && inflight[msgId]) return;
    var row, resolved;
    pool.query('SELECT c.project_id, c.handler, i.settings FROM wp_conversations c JOIN wp_inboxes i ON i.id = c.inbox_id WHERE c.id = $1', [ev.conversation_id]).then(function (r) {
      row = r.rows[0];
      if (!row) return null;
      return store.resolve(row.project_id).then(function (res) {
        resolved = res;
        if (!resolved) return null;
        return agents.resolveForConversation(pool, ev.conversation_id).then(function (agent) {
          if (agent && row.handler === 'ai') {
            return loadConversation(pool, row.project_id, ev.conversation_id).then(function (c) {
              var mode = agents.effectiveMode(agent, inboxOf(c), resolved.project);
              if (mode === 'off') return { ran: false, reason: 'MODE_OFF', agent_id: agent.id };
              if (mode === 'auto') return autoReply(pool, resolved, ev.conversation_id, { message_id: msgId, trigger: 'auto', agent: agent });
              return alreadyRan(pool, msgId).then(function (dup) {
                if (dup) return { ran: false, reason: 'DUPLICATE_MESSAGE', agent_id: agent.id };
                if (msgId) inflight[msgId] = true;
                return suggest(pool, resolved, ev.conversation_id, 'ai', { message_id: msgId, trigger: 'auto', kind: 'suggest', agent: agent })
                  .then(function (out) { if (msgId) delete inflight[msgId]; return Object.assign(out, { ran: true, sent: false, mode: 'suggest' }); }, function (e) { if (msgId) delete inflight[msgId]; throw e; });
              });
            });
          }
          // Legacy (COMMS-7): no agent bound → inbox settings.ai_suggest decides, engine-173 as before.
          if (!row.settings || row.settings.ai_suggest !== true) return null;
          return alreadyRan(pool, msgId).then(function (dup) { if (dup) return null; return suggest(pool, resolved, ev.conversation_id, 'ai', { message_id: msgId, trigger: 'auto', agent: null }); });
        });
      });
    }).then(function (out) { if (out && log) log({ level: 'info', assistant: out.sent ? 'auto_reply' : 'auto', conversation_id: ev.conversation_id, run_id: out.run_id || null, decision: out.decision || null, confidence: out.confidence, intent: out.intent, sent: out.sent === true, reason: out.reason || null, agent_id: out.agent_id || null }); })
      .catch(function (e) { if (log) log({ level: 'warn', assistant: 'auto_failed', conversation_id: ev.conversation_id, reason: String(e && e.message || e).slice(0, 120) }); });
  });
}

module.exports = { suggest: suggest, autoReply: autoReply, test: test, listSuggestions: listSuggestions, decide: decide, markSent: markSent, listRuns: listRuns, attach: attach, runEngine: runEngine, clientRef: clientRef, MODEL: MODEL, PROMPT_VERSION: PROMPT_VERSION, DEFAULT_MAX_REPLIES_PER_HOUR: DEFAULT_MAX_REPLIES_PER_HOUR, FALLBACK_CONFIDENCE_MAX: FALLBACK_CONFIDENCE_MAX };
