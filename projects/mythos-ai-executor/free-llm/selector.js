'use strict';
// =====================================================
// Mythos AI Executor — Free LLM Resources: selection + fallback
// projects/mythos-ai-executor/free-llm/selector.js
//
// Point 7 (pick the best free service for a task) + point 8 (A -> B ->
// C fallback on failure/quota/temporary error) + point 9 (log why).
// One candidate per PROVIDER, not per model — many providers share one
// quota across their whole model list (OpenRouter says so explicitly),
// so trying five of its models back-to-back is not five independent
// attempts, it is one exhausted quota tried five times.
//
// complete() NEVER rejects: a total wipe-out across every free
// candidate resolves { ok:false, reason, attempts }, exactly like every
// other provider outcome in this codebase — the caller (providers/
// free-llm-pool.js) turns that into a normal FAILED/unavailable result,
// and the executor's OWN outer fallback (core/provider-router.js) can
// still move on to a different agent entirely. One provider's outage
// never stops Othmode.
// =====================================================

var registry = require('./registry');
var adapter = require('./adapter');
var secrets = require('./secrets');
var reputation = require('../core/reputation');

var HEALTH_RANK = {
  active: 0, degraded: 1, unknown: 2, quota_exhausted: 3,
  unavailable: 9, unconfigured: 9, expired: 9
};

function scoreEntry(entry) {
  var stat = reputation.stats('free-llm:' + entry.provider_id, 'chat');
  return {
    entry: entry,
    health_rank: HEALTH_RANK[entry.health.status] !== undefined ? HEALTH_RANK[entry.health.status] : 9,
    reputation_rate: stat.sufficient ? stat.rate : null,
    latency_ms: (entry.health && entry.health.latency_ms) || null
  };
}

// selectCandidates(requirements, opts) -> ranked list of catalog
// entries, one per provider, most-preferred first. Ranking: availability
// (health status) > historical success rate (once MIN_EVIDENCE exists,
// exactly like core/agent-registry.js's reputation tiebreak) > measured
// latency > deterministic id order. Cost is not a ranking factor because
// every candidate here is free by construction (that is the whole
// point of this subsystem) — the existing COST_RANK in
// core/agent-registry.js already puts "free" ahead of every paid tier
// one layer up, at the free-llm-pool agent itself.
function selectCandidates(requirements, opts) {
  requirements = requirements || {};
  opts = opts || {};
  var wantedModality = requirements.modality || 'chat';
  var entries = registry.listEntries(opts).filter(function (e) {
    if (!e.wired) return false;
    if (!e.model_id) return false; // no catalog-confirmed model id — nothing safe to send as `model`
    if (e.modality !== wantedModality) return false;
    if (e.credential_present === false) return false;
    return ['active', 'degraded', 'unknown', 'quota_exhausted'].indexOf(e.health.status) !== -1;
  });
  var byProvider = {};
  entries.forEach(function (e) { if (!byProvider[e.provider_id]) byProvider[e.provider_id] = e; });
  var scored = Object.keys(byProvider).map(function (id) { return scoreEntry(byProvider[id]); });
  scored.sort(function (a, b) {
    if (a.health_rank !== b.health_rank) return a.health_rank - b.health_rank;
    if (a.reputation_rate !== null && b.reputation_rate !== null && a.reputation_rate !== b.reputation_rate) {
      return b.reputation_rate - a.reputation_rate;
    }
    if (a.latency_ms !== null && b.latency_ms !== null && a.latency_ms !== b.latency_ms) {
      return a.latency_ms - b.latency_ms;
    }
    return a.entry.provider_id < b.entry.provider_id ? -1 : (a.entry.provider_id > b.entry.provider_id ? 1 : 0);
  });
  return scored.map(function (s) { return s.entry; });
}

// complete(prompt, opts) -> Promise<{ ok, provider_id?, model_id?, text?,
// reason?, attempts }>. Tries ranked candidates in order; every attempt
// (success or failure) updates registry health + reputation so the next
// call already sees the result.
function complete(prompt, opts) {
  opts = opts || {};
  var exclude = opts.exclude || [];
  var candidates = selectCandidates(opts.requirements, opts)
    .filter(function (c) { return exclude.indexOf(c.provider_id) === -1; });
  var attempts = [];

  function tryAt(i) {
    if (i >= candidates.length) {
      return Promise.resolve({
        ok: false,
        reason: attempts.length ? 'ALL_CANDIDATES_FAILED' : 'NO_CANDIDATE_AVAILABLE',
        attempts: attempts
      });
    }
    var c = candidates[i];
    var key = secrets.loadKey(c.provider_id, opts.secretsOpts);
    var spec = { providerId: c.provider_id, baseUrl: c.base_url, model: c.model_id, apiKey: key };
    return adapter.chatCompletion(spec, prompt, {
      transport: opts.transport, systemPrompt: opts.systemPrompt, timeoutMs: opts.timeoutMs
    }).then(function (outcome) {
      var status = registry.statusFromOutcome(outcome);
      registry.persistHealthRecord(c.provider_id, status, outcome, opts);
      reputation.recordOutcome('free-llm:' + c.provider_id, 'chat', status === registry.STATUS.ACTIVE);
      attempts.push({ provider_id: c.provider_id, model_id: c.model_id, status: status, ok: status === registry.STATUS.ACTIVE });
      if (status === registry.STATUS.ACTIVE) {
        return { ok: true, provider_id: c.provider_id, model_id: c.model_id, text: outcome.parsed.result, outcome: outcome, attempts: attempts };
      }
      return tryAt(i + 1); // fallback: A -> B -> C, never a thrown error
    });
  }

  return tryAt(0);
}

module.exports = {
  selectCandidates: selectCandidates,
  complete: complete
};
