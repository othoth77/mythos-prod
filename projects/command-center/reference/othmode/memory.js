'use strict';
// =====================================================
// OTHMODE — Memory bridge to oth-knowledge
// projects/command-center/reference/othmode/memory.js
//
// READ-FIRST, FAIL-CLOSED, ONE ENGINE. This module opens the existing
// oth-knowledge service boundary (projects/oth-knowledge/lib/
// knowledge-service.js) over the canonical store and exposes search +
// provenance to the OTHMODE UI. It deliberately has:
//   * no ingestion path — curation stays on the operator CLI (othk-cli)
//   * no second memory engine — MPI (personal-intelligence) stays separate
//   * no store creation — an absent store is a normal, reportable state
//
// The store root comes from the executor's knowledge boundary config
// (projects/mythos-ai-executor/config/knowledge.json) so the two consumers
// can never disagree about where the canonical store is. OTHMODE_KNOWLEDGE_ROOT
// overrides for tests only.
// =====================================================

var resolve = require('./resolve.js');

var _service = null;
var _state = null;

function configuredRoot() {
  if (process.env.OTHMODE_KNOWLEDGE_ROOT) return { root: process.env.OTHMODE_KNOWLEDGE_ROOT, source: 'env' };
  var cfg = resolve.cachedJson(resolve.repoPath('projects', 'mythos-ai-executor', 'config', 'knowledge.json'));
  if (!cfg.ok) return { root: null, source: 'config ' + cfg.reason };
  if (cfg.data.enabled !== true || !cfg.data.store_root) return { root: null, source: 'knowledge layer disabled in config' };
  return { root: cfg.data.store_root, source: 'config' };
}

// Lazily open the service once. Every failure mode returns a disabled
// facade with a reason — never a throw to the route layer.
function open() {
  if (_state) return _state;
  var cfg = configuredRoot();
  if (!cfg.root) {
    _state = { enabled: false, reason: 'knowledge store not configured (' + cfg.source + ')' };
    return _state;
  }
  if (!resolve.exists(cfg.root)) {
    _state = { enabled: false, reason: 'store root ' + cfg.root + ' does not exist on this host (fail-closed; a disabled layer is a normal, reportable state)' };
    return _state;
  }
  try {
    var serviceLib = require(resolve.repoPath('projects', 'oth-knowledge', 'lib', 'knowledge-service.js'));
    _service = serviceLib.openService(cfg.root);
    _state = { enabled: true, reason: null, root: cfg.root };
  } catch (e) {
    _state = { enabled: false, reason: 'knowledge service refused to open: ' + (e.code || 'error') };
  }
  return _state;
}

// Test hook — forces a re-open on the next call.
function reset() { _service = null; _state = null; }

function status() {
  var s = open();
  return { enabled: s.enabled, reason: s.reason || null };
}

function search(query, limit) {
  var s = open();
  if (!s.enabled) return { enabled: false, reason: s.reason, hits: [] };
  var q = String(query || '').trim();
  if (!q) return { enabled: true, reason: null, hits: [] };
  var cap = Math.min(Math.max(parseInt(limit || 20, 10) || 20, 1), 50);
  var hits;
  try {
    hits = _service.search(q, { limit: cap });
  } catch (e) {
    return { enabled: true, reason: 'search failed: ' + (e.code || 'error'), hits: [] };
  }
  return {
    enabled: true,
    reason: null,
    hits: (hits || []).slice(0, cap).map(function (h) {
      var rec = h.record || h;
      return {
        id: rec.id || null,
        kind: rec.kind || null,
        title: rec.title || rec.name || null,
        text: typeof rec.text === 'string' ? rec.text.slice(0, 600) : (typeof rec.content === 'string' ? rec.content.slice(0, 600) : null),
        tags: rec.tags || [],
        source_class: rec.provenance ? rec.provenance.source_class : null,
        score: h.score === undefined ? null : h.score
      };
    })
  };
}

function provenance(id) {
  var s = open();
  if (!s.enabled) return { enabled: false, reason: s.reason, provenance: null };
  var out;
  try { out = _service.lookupProvenance(String(id)); } catch (e) { out = null; }
  return { enabled: true, reason: null, provenance: out };
}

module.exports = { status: status, search: search, provenance: provenance, reset: reset };
