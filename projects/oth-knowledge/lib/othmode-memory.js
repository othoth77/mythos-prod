// =====================================================
// OTH Knowledge — OTHMODE / project integration surface (Phase 17 / 18)
// projects/oth-knowledge/lib/othmode-memory.js
//
// The binding OTHMODE (and any project) uses to consume OTHKM as its
// SINGLE memory/knowledge source. OTHMODE keeps NO competing permanent
// store: it reads context/search from OTHKM and proposes new memory
// through the gated staging path (capped at model-output tier, so an
// orchestrator/AI can never self-declare owner authority). Each scope is a
// namespace — global, personal, or projects/<slug> — so project memory is
// isolated by construction and shared knowledge stays one global record
// referenced from projects, never duplicated.
// =====================================================
'use strict';

const namespace = require('./namespace.js');
const propose = require('./propose.js');

// bind({ service, canonicalStore, stagingStore, classes, trustModel })
function bind(opts) {
  const o = opts || {};
  const svc = o.service;
  if (!svc) throw new Error('OTHK_OTHMODE_INPUT: a knowledge service is required');

  function scope(ns) {
    return {
      namespace: ns,
      // READ: relevance search constrained to this scope
      search(query, so) { return svc.retrieveConstrained(query, Object.assign({ namespace: ns }, so || {})); },
      // READ: assembled context for the AI/orchestrator
      context(co) { return svc.buildContext(Object.assign({ namespace: ns }, co || {})); },
      // READ: bi-temporal subject timeline
      timeline(to) { return svc.timeline(to); },
      // WRITE (gated, staged only): propose new memory for this scope
      propose(candidate, po) {
        if (!o.stagingStore || !o.canonicalStore) throw new Error('OTHK_OTHMODE_INPUT: propose needs staging + canonical stores');
        const cand = Object.assign({}, candidate, { namespace: ns });
        return propose.proposeMemory(o.stagingStore, o.canonicalStore, cand,
          { classes: o.classes, trustModel: o.trustModel, maxTier: (po && po.maxTier) || 'model-output' });
      },
    };
  }

  return {
    global() { return scope(namespace.GLOBAL); },
    personal() { return scope(namespace.PERSONAL); },
    project(slug) { return scope(namespace.projectNamespace(slug)); },
  };
}

module.exports = { bind };
