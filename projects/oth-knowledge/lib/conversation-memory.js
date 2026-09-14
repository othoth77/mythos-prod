// =====================================================
// OTH Knowledge — conversation → memory ingestion (Phase 19)
// projects/oth-knowledge/lib/conversation-memory.js
//
// A clean path from a conversation to durable memory that stores ONLY
// distilled durable knowledge, never every message:
//
//   conversation → normalize → candidates → compare (decide) →
//   ADD/UPDATE/NOOP → promotion gate → staging → (operator promote)
//
// Candidate statements are selected OUTSIDE the engine (the engine never
// calls an LLM); this module attaches conversation provenance, then routes
// each candidate through the gated memory_propose path. The conversation's
// origin (provider + id) is preserved as source_reference so every derived
// memory traces back to the exact conversation.
// =====================================================
'use strict';

const propose = require('./propose.js');

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

// providerToSourceClass: conversation providers map to model-output tier
// classes already registered in the trust model (deepseek/chatgpt/claude/
// gemini). Unknown providers fall back to 'external-provider'.
const PROVIDER_CLASS = { deepseek: 'deepseek', chatgpt: 'chatgpt', claude: 'claude', gemini: 'gemini', notebooklm: 'notebooklm' };

function ingestConversation(stagingStore, canonicalStore, input, opts) {
  const o = opts || {};
  const conv = (input && input.conversation) || {};
  const candidates = (input && input.candidates) || [];
  if (!conv.provider || !conv.id) throw fail('OTHK_CONV_INPUT', 'conversation.provider and conversation.id required (provenance)');
  const sourceClass = PROVIDER_CLASS[conv.provider] || 'external-provider';
  const collection = conv.collection || 'conversations';
  const capturedAt = conv.captured_at || o.captured_at || new Date().toISOString();

  const results = [];
  let staged = 0, noop = 0, rejected = 0;
  for (const cand of candidates) {
    const withProv = Object.assign({}, cand, {
      kind: cand.kind || 'claim',
      asserted_by: cand.asserted_by || (conv.provider + ':' + (cand.role || 'assistant')),
      provenance: {
        source_class: sourceClass,
        source_collection: collection,
        source_reference: conv.provider + '/' + collection + '/' + conv.id + (cand.message_ref ? '#' + cand.message_ref : ''),
        captured_at: capturedAt,
        observed_at: cand.observed_at || undefined,
      },
      namespace: cand.namespace || o.namespace,
    });
    const r = propose.proposeMemory(stagingStore, canonicalStore, withProv, { classes: o.classes, trustModel: o.trustModel });
    if (r.staged) staged++; else if (r.action === 'NOOP') noop++; else rejected++;
    results.push({ text: (withProv.statement || '').slice(0, 120), staged: !!r.staged, action: r.action || (r.rejected ? 'REJECTED' : null), reasons: r.reasons || null });
  }
  return {
    conversation_ref: conv.provider + '/' + collection + '/' + conv.id,
    candidates: candidates.length, staged, noop, rejected, results,
  };
}

module.exports = { ingestConversation, PROVIDER_CLASS };
