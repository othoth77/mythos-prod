'use strict';
// =====================================================
// Mythos AI Executor — Free LLM Resources: live registry view + health
// projects/mythos-ai-executor/free-llm/registry.js
//
// Reuses, rather than reimplements:
//   lib/quota.js         classifyOutcome() — the exact same quota /
//                         transient / blocked / permanent categories
//                         the executor already uses for every provider
//   core/reputation.js   recordOutcome()/stats() — the same evidence-
//                         gated (MIN_EVIDENCE=5) success-rate tracker
//                         agent-registry.js already uses for tiebreaks
//
// Health state is mutable runtime data, so — same rule as
// core/store.js / core/reputation.js — it lives under
// $MYTHOS_EXECUTOR_HOME (never Git, 0700 dirs / 0600 files, atomic
// tmp+rename writes), while catalog.json (what sync.js produces) is the
// committed, versioned snapshot.
//
// Required status vocabulary (point 9 of the brief):
//   active | degraded | unavailable | quota_exhausted | expired
// plus two honest states this system adds when no live attempt has been
// made at all — unconfigured (no credential yet) and unknown (wired,
// keyed, but never called or no confirmed model id to probe safely).
// =====================================================

var fs = require('fs');
var path = require('path');
var os = require('os');

var quota = require('../lib/quota');
var reputation = require('../core/reputation');
var secrets = require('./secrets');
var adapter = require('./adapter');

var CATALOG_PATH = path.join(__dirname, 'catalog.json');
var ENDPOINTS_PATH = path.join(__dirname, 'endpoints.json');

function executorHome() {
  return process.env.MYTHOS_EXECUTOR_HOME || path.join(os.homedir(), 'mythos-ai-executor');
}
function defaultHealthFile() { return path.join(executorHome(), 'free-llm', 'health.json'); }

var STATUS = {
  ACTIVE: 'active',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable',
  QUOTA_EXHAUSTED: 'quota_exhausted',
  EXPIRED: 'expired',
  INVALID_CREDENTIALS: 'invalid_credentials',
  UNCONFIGURED: 'unconfigured',
  UNKNOWN: 'unknown'
};

function loadJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function loadCatalog(catalogPath) { return loadJsonSafe(catalogPath || CATALOG_PATH, { providers: [] }); }
function loadEndpoints(endpointsPath) { return (loadJsonSafe(endpointsPath || ENDPOINTS_PATH, { providers: {} }).providers) || {}; }
function loadHealth(healthPath) { return loadJsonSafe(healthPath || defaultHealthFile(), {}); }

function saveHealth(data, healthPath) {
  var file = healthPath || defaultHealthFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  var tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

// A response reporting model === '' with HTTP 404 almost always means
// the specific :free slug was retired (churn the source README itself
// warns about) — surfaced as EXPIRED, distinct from a generic
// UNAVAILABLE, so the operator knows to re-run bin/free-llm-sync.js
// rather than suspect their key.
function statusFromOutcome(outcome) {
  if (!outcome) return STATUS.UNKNOWN;
  if (outcome.parsed && !outcome.parsed.is_error) return STATUS.ACTIVE;
  if (outcome.http_status === 404) return STATUS.EXPIRED;
  // 401/403 mean the credential itself was rejected — a distinct, actionable
  // state ("API key invalid"), never retried, never confused with an outage.
  if (outcome.http_status === 401 || outcome.http_status === 403) return STATUS.INVALID_CREDENTIALS;
  // 429 and 413 on these free tiers are per-minute token budgets (Groq answers
  // 413 "request too large … tokens per minute") — a temporary condition to
  // wait out or route around, never an outage of the service.
  if (outcome.http_status === 429 || outcome.http_status === 413) return STATUS.QUOTA_EXHAUSTED;
  var text = (outcome.parsed && outcome.parsed.result) || '';
  var cls = quota.classifyOutcome(text, { timed_out: outcome.timed_out });
  if (cls.category === 'quota') return STATUS.QUOTA_EXHAUSTED;
  if (cls.category === 'transient') return STATUS.DEGRADED;
  return STATUS.UNAVAILABLE; // permission / governance / human / permanent — not usable right now, never a system crash
}

// persistHealthRecord — the single writer for health.json, called both
// by an explicit probe (checkProviderHealth) and by a real selector
// attempt (selector.js), so ordinary usage keeps the record fresh
// between scheduled checks.
function persistHealthRecord(providerId, status, outcome, opts) {
  opts = opts || {};
  var nowIso = (opts.now ? opts.now() : new Date()).toISOString();
  var health = loadHealth(opts.healthPath);
  var prior = health[providerId] || {};
  var record = {
    status: status,
    last_checked: nowIso,
    last_success: status === STATUS.ACTIVE ? nowIso : (prior.last_success || null),
    last_failure: status !== STATUS.ACTIVE ? nowIso : (prior.last_failure || null),
    // Kept across a later success so the record still explains its own
    // last_failure timestamp (OTHMODE V2: the reason is what a user acts on).
    last_failure_reason: status !== STATUS.ACTIVE ? ((outcome && outcome.parsed && outcome.parsed.result) || null) : (prior.last_failure_reason || null),
    latency_ms: outcome && typeof outcome.duration_ms === 'number' ? outcome.duration_ms : (prior.latency_ms || null),
    consecutive_failures: status === STATUS.ACTIVE ? 0 : (prior.consecutive_failures || 0) + 1,
    probed_model: (outcome && outcome.expected_model) || prior.probed_model || null
  };
  health[providerId] = record;
  saveHealth(health, opts.healthPath);
  return record;
}

// The first CHAT-modality model the catalog itself is confident about
// (link_derived or literal_text) — never a hand-asserted guess. Modality
// matters here: adapter.js only speaks chat/completions, so probing with
// a table row that happens to be a TTS/moderation/embedding model (e.g.
// Groq's confirmed-looking "canopylabs/orpheus-arabic-saudi") would send
// a chat request to a non-chat model and misreport a healthy provider as
// degraded/unavailable for the wrong reason. A provider whose catalog
// entry only ever names a category link ("Various open models") — or
// whose only confirmed ids are non-chat — is correctly left unprobed
// rather than invent a slug or probe with the wrong modality.
function isConfirmedChat(m) {
  return !!(m && m.api_model_id && m.api_model_id_confidence !== 'unconfirmed' && m.modality === 'chat');
}

// OTHMODE V2: official-overrides.json may name a provider's preferred chat
// model (`preferred_chat_model`). Official information is authoritative
// over the README's table order: on Groq the first confirmed chat model in
// table order is `groq/compound`, an agentic model that spends ~15k tokens
// on a 6 KB task prompt against a 30k tokens-per-minute free budget (live:
// 413/429 on real prompts while the tiny health probe passes), whereas
// `openai/gpt-oss-120b` answers the same prompt for ~1.5k tokens. The
// preference only applies when the catalog itself confirms that id as a
// chat model — an override can never invent a model.
var OVERRIDES_PATH = path.join(__dirname, 'official-overrides.json');
function loadOverrides(overridesPath) {
  try { return JSON.parse(fs.readFileSync(overridesPath || OVERRIDES_PATH, 'utf8')); }
  catch (e) { return { providers: {} }; }
}
function preferredChatModel(provider, overrides) {
  var o = overrides && overrides.providers && overrides.providers[provider.id];
  if (!o || !o.preferred_chat_model) return null;
  return (provider.models || []).find(function (m) { return m.api_model_id === o.preferred_chat_model && isConfirmedChat(m); }) || null;
}

function pickProbeModel(provider, opts) {
  return preferredChatModel(provider, loadOverrides(opts && opts.overridesPath)) ||
    (provider.models || []).find(isConfirmedChat) || null;
}

// checkProviderHealth(providerId, opts) -> Promise<record>. One request
// per provider (never per model — many share one quota, and the source
// README explicitly asks callers not to hammer these services).
function checkProviderHealth(providerId, opts) {
  opts = opts || {};
  var catalog = loadCatalog(opts.catalogPath);
  var endpoints = loadEndpoints(opts.endpointsPath);
  var provider = (catalog.providers || []).find(function (p) { return p.id === providerId; });

  if (!provider) {
    return Promise.resolve(persistHealthRecord(providerId, STATUS.UNKNOWN,
      { parsed: { result: 'CATALOG_ENTRY_MISSING: run bin/free-llm-sync.js' } }, opts));
  }
  var ep = endpoints[providerId];
  if (!ep || !ep.wired) {
    return Promise.resolve(persistHealthRecord(providerId, STATUS.UNCONFIGURED,
      { parsed: { result: 'NOT_WIRED: no endpoint configured in endpoints.json yet' } }, opts));
  }
  var key = secrets.loadKey(providerId, opts.secretsOpts);
  if (!key) {
    return Promise.resolve(persistHealthRecord(providerId, STATUS.UNCONFIGURED,
      { parsed: { result: 'NO_CREDENTIAL: ' + secrets.keyFilePath(providerId) + ' not found' } }, opts));
  }
  var probeModel = pickProbeModel(provider, opts);
  if (!probeModel) {
    return Promise.resolve(persistHealthRecord(providerId, STATUS.UNKNOWN,
      { parsed: { result: 'NO_CONFIRMED_MODEL_ID: catalog names no model id confident enough to probe safely' } }, opts));
  }
  var spec = { providerId: providerId, baseUrl: ep.base_url, model: probeModel.api_model_id, apiKey: key };
  var prompt = opts.probePrompt || 'Reply with exactly one word: ok';
  return adapter.chatCompletion(spec, prompt, {
    transport: opts.transport, timeoutMs: opts.timeoutMs || 20000
  }).then(function (outcome) {
    var status = statusFromOutcome(outcome);
    var record = persistHealthRecord(providerId, status, outcome, opts);
    reputation.recordOutcome('free-llm:' + providerId, 'chat', status === STATUS.ACTIVE);
    return record;
  });
}

// checkAllHealth(opts) -> Promise<{providerId: record}>. Sequential by
// design — parallel fan-out into two dozen free services at once is
// exactly the "abuse" the source README asks integrators to avoid.
function checkAllHealth(opts) {
  opts = opts || {};
  var catalog = loadCatalog(opts.catalogPath);
  var ids = (catalog.providers || []).map(function (p) { return p.id; });
  var results = {};
  return ids.reduce(function (chain, id) {
    return chain.then(function () {
      return checkProviderHealth(id, opts).then(function (r) { results[id] = r; });
    });
  }, Promise.resolve()).then(function () { return results; });
}

// listEntries(opts) -> one row per {service, model} pair — exactly the
// record shape requested: name, model, service type, free/free-tier/
// trial, usage limits, status, last checked, latency, url,
// requirements, data policy.
function listEntries(opts) {
  opts = opts || {};
  var catalog = loadCatalog(opts.catalogPath);
  var endpoints = loadEndpoints(opts.endpointsPath);
  var health = loadHealth(opts.healthPath);
  var out = [];
  var overrides = loadOverrides(opts.overridesPath);
  (catalog.providers || []).forEach(function (provider) {
    var ep = endpoints[provider.id] || null;
    var h = health[provider.id] || null;
    var wired = !!(ep && ep.wired);
    // The preferred chat model (official override) leads the provider's
    // rows, so selector.js's one-candidate-per-provider rule picks it.
    var pref = preferredChatModel(provider, overrides);
    var models = pref ? [pref].concat((provider.models || []).filter(function (m) { return m !== pref; })) : (provider.models || []);
    models.forEach(function (model) {
      out.push({
        provider_id: provider.id,
        provider_name: provider.name,
        homepage: provider.homepage,
        category: provider.category,
        access_type: provider.access_type,
        requirements: provider.requirements,
        data_policy_note: provider.data_policy_note,
        official: provider.official,
        model_name: model.name,
        model_id: model.api_model_id,
        model_id_confidence: model.api_model_id_confidence,
        preferred: !!(pref && model === pref),
        modality: model.modality,
        limits_text: model.limits_text || provider.limits_text || provider.credits_text || null,
        wired: wired,
        base_url: wired ? ep.base_url : null,
        credential_present: wired ? secrets.available(provider.id, opts.secretsOpts) : null,
        health: h ? {
          status: h.status, last_checked: h.last_checked, last_success: h.last_success,
          last_failure: h.last_failure, last_failure_reason: h.last_failure_reason,
          latency_ms: h.latency_ms, consecutive_failures: h.consecutive_failures || 0
        } : { status: wired ? STATUS.UNKNOWN : STATUS.UNCONFIGURED, last_checked: null }
      });
    });
  });
  return out;
}

module.exports = {
  STATUS: STATUS,
  loadCatalog: loadCatalog,
  loadEndpoints: loadEndpoints,
  loadHealth: loadHealth,
  statusFromOutcome: statusFromOutcome,
  persistHealthRecord: persistHealthRecord,
  pickProbeModel: pickProbeModel,
  preferredChatModel: preferredChatModel,
  loadOverrides: loadOverrides,
  checkProviderHealth: checkProviderHealth,
  checkAllHealth: checkAllHealth,
  listEntries: listEntries,
  CATALOG_PATH: CATALOG_PATH,
  ENDPOINTS_PATH: ENDPOINTS_PATH,
  defaultHealthFile: defaultHealthFile
};
