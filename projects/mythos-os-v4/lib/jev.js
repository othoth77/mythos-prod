'use strict';
// =====================================================
// MYTHOS OS v4 — JEV, the model selection engine
// projects/mythos-os-v4/lib/jev.js
//
// JEV decides WHICH model serves a task. It never runs one
// (MASTER_STATUS_AND_ROADMAP.md §15: no execution authority, no shell, no
// repository access, structured output, hard restriction to the configured
// pools). The gateway (lib/gateway.js) and the Haddad layer act on its
// decision and report every outcome back here.
//
//   route(request)  -> a ranked decision: candidates in the order they may
//                      be tried, and every rejected model with the reason
//   report(model, outcome) -> updates that model's health
//
// ORDER: tier first — free, then local (Qwen), then paid — exactly DOTS
// policy `models.tier_order`. Inside a tier: healthy before recovering,
// then fewer recent failures, then lower measured latency, then name.
//
// A model is NOT a candidate when it is outside the requested pool, lacks
// the capability, cannot hold the prompt, has no execution authority for
// work, is unavailable on this host, is cooling down after failures, is
// waiting for quota, or is paid while DOTS forbids or has exhausted the
// paid budget. Each of those is recorded, so "why not model X" always has
// an answer.
//
// HEALTH per model (<home>/jev/health.json), a circuit breaker:
//   closed     -> selectable
//   open       -> `failure_threshold` failures; skipped until cooldown_until
//   half_open  -> cooldown over; ONE probe is allowed, success closes it,
//                 failure re-opens with the cooldown multiplied (capped)
// Quota is not failure: it sets quota_until (the provider's reset time when
// it gave one) and leaves the failure count alone.
// =====================================================

var fs = require('fs');
var path = require('path');

var store = require('./store');

var REGISTRY_PATH = path.join(__dirname, '..', 'config', 'jev-models.json');
var TIERS = ['free', 'local', 'paid'];
var NAME_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

function validateRegistry(reg) {
  var errors = [];
  if (!reg || typeof reg !== 'object' || !reg.models || typeof reg.models !== 'object') return ['registry has no models'];
  if (!Array.isArray(reg.pools) || !reg.pools.length) errors.push('pools must be a non-empty list');
  var names = Object.keys(reg.models);
  if (!names.length) errors.push('registry is empty');
  names.forEach(function (name) {
    var m = reg.models[name];
    if (!NAME_RE.test(name)) errors.push('invalid model name "' + name.slice(0, 40) + '"');
    if (!m || typeof m !== 'object') { errors.push(name + ': not an object'); return; }
    if (TIERS.indexOf(m.tier) === -1) errors.push(name + ': tier must be free, local or paid');
    if (typeof m.adapter !== 'string' || !m.adapter) errors.push(name + ': adapter is required');
    if (!Array.isArray(m.pools) || !m.pools.length) errors.push(name + ': pools must be a non-empty list');
    else m.pools.forEach(function (p) { if ((reg.pools || []).indexOf(p) === -1) errors.push(name + ': unknown pool "' + p + '"'); });
    if (!Array.isArray(m.capabilities) || !m.capabilities.length) errors.push(name + ': capabilities must be a non-empty list');
    if (typeof m.execution_authority !== 'boolean') errors.push(name + ': execution_authority must be a boolean');
    if (!Number.isInteger(m.max_prompt_chars) || m.max_prompt_chars <= 0) errors.push(name + ': max_prompt_chars must be a positive integer');
    if (typeof m.enabled !== 'boolean') errors.push(name + ': enabled must be a boolean');
    if (m.work_provider !== undefined && !m.execution_authority) errors.push(name + ': a work_provider requires execution_authority');
    if (m.work_provider !== undefined && !(Array.isArray(m.work_hosts) && m.work_hosts.length && m.work_hosts.every(function (x) { return typeof x === 'string' && x; }))) {
      errors.push(name + ': a work_provider must name the hosts it runs on (work_hosts)');
    }
    if (m.order !== undefined && !(Number.isInteger(m.order) && m.order >= 0)) errors.push(name + ': order must be a non-negative integer');
  });
  return errors;
}

function loadRegistry(opts) {
  opts = opts || {};
  var reg = opts.registry;
  if (!reg) {
    var source = opts.path || process.env.MYTHOS_OS_JEV_MODELS || REGISTRY_PATH;
    try { reg = JSON.parse(fs.readFileSync(source, 'utf8')); } catch (e) {
      throw new Error('JEV_REGISTRY_INVALID: cannot read ' + source);
    }
  }
  var errors = validateRegistry(reg);
  if (errors.length) throw new Error('JEV_REGISTRY_INVALID: ' + errors.join('; '));
  return reg;
}

function healthFile() { return store.file('jev', 'health.json'); }
function spendFile() { return store.file('jev', 'spend.json'); }
function lockFile() { return store.file('jev', '.lock'); }

function freshHealth() {
  return { state: 'closed', consecutive_failures: 0, cooldown_until: null, cooldown_seconds: null, quota_until: null, last_ok: null, last_failure: null, last_code: null, latency_ms: null, calls: 0, failures: 0 };
}

// create({ policy, registry?, adapters, ledger, now })
//   adapters: { [adapterName]: { available(model) -> { ok, detail } } }
function create(deps) {
  var policy = deps.policy;
  var registry = loadRegistry({ registry: deps.registry, path: deps.registryPath });
  var adapters = deps.adapters || {};
  var ledger = deps.ledger;
  var now = deps.now || Date.now;
  var cfg = policy.jev;
  var host = deps.host || null;   // the resolved host profile name, or null
  var availCache = {};

  // The owner's standing preferences name models that must exist.
  Object.keys(policy.models.preferred).forEach(function (cap) {
    if (!registry.models[policy.models.preferred[cap]]) {
      throw new Error('JEV_REGISTRY_INVALID: models.preferred.' + cap + ' names "' + policy.models.preferred[cap] + '", which is not a registered model');
    }
  });

  function readHealth() { return store.readJSON(healthFile(), {}) || {}; }
  function healthOf(all, name) { return Object.assign(freshHealth(), all[name] || {}); }

  function availability(name, model) {
    var cached = availCache[name];
    if (cached && now() - cached.at < cfg.availability_ttl_seconds * 1000) return cached.value;
    var value;
    var adapter = adapters[model.adapter];
    if (!adapter) value = { ok: false, detail: 'no adapter "' + model.adapter + '" on this host' };
    else {
      try { value = adapter.available(model) || { ok: false, detail: 'adapter gave no answer' }; } catch (e) {
        value = { ok: false, detail: 'probe error: ' + String(e && e.message).slice(0, 120) };
      }
    }
    availCache[name] = { at: now(), value: value };
    return value;
  }

  // refresh() -> Promise. Runs each adapter's bounded live probe (when it has
  // one) so the next route() sees whether a runtime is actually answering,
  // not merely installed. Results share the availability TTL.
  function refresh() {
    return Promise.all(Object.keys(registry.models).map(function (name) {
      var m = registry.models[name];
      var adapter = adapters[m.adapter];
      if (!m.enabled || !adapter || typeof adapter.probe !== 'function') return null;
      var cached = availCache[name];
      if (cached && cached.probed && now() - cached.at < cfg.availability_ttl_seconds * 1000) return null;
      return Promise.resolve().then(function () { return adapter.probe(m); }).then(function (value) {
        availCache[name] = { at: now(), value: value || { ok: false, detail: 'probe gave no answer' }, probed: true };
      }, function (e) {
        availCache[name] = { at: now(), value: { ok: false, detail: 'probe error: ' + String(e && e.message).slice(0, 120) }, probed: true };
      });
    }));
  }

  // --- the paid budget (DOTS policy models.paid) ---------------------------
  function today() { return new Date(now()).toISOString().slice(0, 10); }
  function readSpend() {
    var s = store.readJSON(spendFile(), null);
    if (!s || s.day !== today()) return { day: today(), calls: 0, by_goal: {} };
    return s;
  }
  function paidGate(goalId) {
    var paid = policy.models.paid;
    if (!paid.allowed) return 'PAID_NOT_PERMITTED';
    var s = readSpend();
    if (s.calls >= paid.max_calls_per_day) return 'PAID_DAILY_BUDGET_EXHAUSTED';
    if (goalId && (s.by_goal[goalId] || 0) >= paid.max_calls_per_goal) return 'PAID_GOAL_BUDGET_EXHAUSTED';
    return null;
  }
  // Called by the gateway immediately BEFORE a paid call: the check and the
  // increment are one locked step, so two runners cannot both take the last
  // permitted call. Returns null when the call is granted.
  function chargePaid(goalId) {
    return store.withLock(lockFile(), function () {
      var refusal = paidGate(goalId);
      if (refusal) return refusal;
      var s = readSpend();
      s.calls += 1;
      if (goalId) s.by_goal[goalId] = (s.by_goal[goalId] || 0) + 1;
      store.writeJSON(spendFile(), s);
      return null;
    });
  }

  // route(request) -> decision
  //   request { pool, capability, kind:'answer'|'work', prompt_chars, goal_id, trace_id }
  function route(request) {
    request = request || {};
    var problems = [];
    if (registry.pools.indexOf(request.pool) === -1) problems.push('unknown pool "' + String(request.pool).slice(0, 40) + '"');
    if (typeof request.capability !== 'string' || !request.capability) problems.push('capability is required');
    if (request.kind !== 'answer' && request.kind !== 'work') problems.push('kind must be answer or work');
    var promptChars = Number.isInteger(request.prompt_chars) && request.prompt_chars >= 0 ? request.prompt_chars : null;
    if (promptChars === null) problems.push('prompt_chars must be a non-negative integer');
    // A forced or preferred model selects an entry of the registry and
    // nothing else: a name that is not registered is refused outright,
    // never mapped to something similar.
    var forced = request.forced_model || null;
    var preferred = request.preferred_model || policy.models.preferred[request.capability] || null;
    if (forced && !registry.models[forced]) problems.push('forced model "' + String(forced).slice(0, 60) + '" is not a registered model');
    if (request.preferred_model && !registry.models[request.preferred_model]) problems.push('preferred model "' + String(request.preferred_model).slice(0, 60) + '" is not a registered model');
    var decisionId = store.newId('jev', now());
    if (problems.length) {
      var bad = { decision_id: decisionId, ok: false, reason: 'BAD_REQUEST', problems: problems, candidates: [], rejected: [], confidence: 'none' };
      if (ledger) ledger.append({ actor: 'jev', type: 'ROUTE_DECISION', goal_id: request.goal_id, trace_id: request.trace_id, detail: bad });
      return bad;
    }

    var all = readHealth();
    var candidates = [];
    var rejected = [];
    Object.keys(registry.models).sort().forEach(function (name) {
      var m = registry.models[name];
      function reject(reason) { rejected.push({ model: name, tier: m.tier, reason: reason }); }
      if (!m.enabled) return reject('DISABLED');
      if (m.pools.indexOf(request.pool) === -1) return reject('NOT_IN_POOL');
      if (m.capabilities.indexOf(request.capability) === -1) return reject('CAPABILITY_MISSING');
      if (request.kind === 'work' && !(m.execution_authority && m.work_provider)) return reject('NO_EXECUTION_AUTHORITY');
      // Authority is bound to a machine: Qwen executes on Haddad, Claude
      // Code on the VPS. On an unknown host nothing may execute.
      if (request.kind === 'work' && (!host || m.work_hosts.indexOf(host) === -1)) return reject(host ? 'NOT_ON_THIS_HOST' : 'HOST_UNKNOWN');
      // FORCED: exactly that model or nothing. Every filter below still
      // applies to it — forcing selects, it never authorises.
      if (forced && name !== forced) return reject('NOT_FORCED');
      if (promptChars > m.max_prompt_chars) return reject('PROMPT_TOO_LARGE');
      if (m.tier === 'paid') {
        var refusal = paidGate(request.goal_id);
        if (refusal) return reject(refusal);
      }
      var h = healthOf(all, name);
      if (h.quota_until && now() < Date.parse(h.quota_until)) return reject('QUOTA_UNTIL ' + h.quota_until);
      var probing = false;
      if (h.state === 'open') {
        if (h.cooldown_until && now() < Date.parse(h.cooldown_until)) return reject('COOLDOWN_UNTIL ' + h.cooldown_until);
        probing = true; // cooldown over: half-open, one probe
      }
      var avail = availability(name, m);
      if (!avail.ok) return reject('UNAVAILABLE: ' + String(avail.detail || '').slice(0, 120));
      candidates.push({
        model: name, tier: m.tier, adapter: m.adapter, work_provider: m.work_provider || null,
        execution_authority: m.execution_authority, probing: probing,
        order: Number.isInteger(m.order) ? m.order : 0, preferred: name === preferred,
        health: probing ? 'half_open' : h.state, recent_failures: h.consecutive_failures, latency_ms: h.latency_ms
      });
    });

    var order = policy.models.tier_order;
    candidates.sort(function (a, b) {
      // PREFERRED leads when it is selectable at all — the owner's stated
      // preference outranks the tier order, but nothing else: it passed the
      // same filters (pool, capability, budget, health) as every candidate.
      if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
      var t = order.indexOf(a.tier) - order.indexOf(b.tier);
      if (t !== 0) return t;
      if (a.probing !== b.probing) return a.probing ? 1 : -1;
      if (a.order !== b.order) return a.order - b.order;
      if (a.recent_failures !== b.recent_failures) return a.recent_failures - b.recent_failures;
      if (a.latency_ms !== null && b.latency_ms !== null && a.latency_ms !== b.latency_ms) return a.latency_ms - b.latency_ms;
      return a.model < b.model ? -1 : 1;
    });

    var decision = {
      decision_id: decisionId,
      ok: candidates.length > 0,
      reason: candidates.length ? null : (forced ? 'FORCED_MODEL_UNAVAILABLE' : 'NO_ROUTE'),
      request: { pool: request.pool, capability: request.capability, kind: request.kind, prompt_chars: promptChars, host: host, forced_model: forced, preferred_model: preferred },
      // Why a preferred model does not lead, when it does not.
      preferred_unavailable: preferred && !candidates.some(function (c) { return c.model === preferred; })
        ? ((rejected.filter(function (r) { return r.model === preferred; })[0] || {}).reason || 'not a candidate') : null,
      candidates: candidates,
      rejected: rejected,
      // How much room the decision leaves: a single candidate, or only a
      // probing one, is a route with no fallback behind it.
      // (a forced route has, by construction, nothing behind it).
      confidence: !candidates.length ? 'none' : (candidates.length === 1 || candidates[0].probing ? 'low' : 'high')
    };
    if (ledger) ledger.append({ actor: 'jev', type: 'ROUTE_DECISION', goal_id: request.goal_id, trace_id: request.trace_id, detail: decision });
    return decision;
  }

  // report(model, outcome, ctx) — outcome { ok, category, duration_ms, resume_at, code }
  //   category: 'quota' | 'transient' | 'blocked' | 'malformed' | 'fatal'
  function report(name, outcome, ctx) {
    ctx = ctx || {};
    if (!registry.models[name]) return null;
    var at = new Date(now()).toISOString();
    var event = store.withLock(lockFile(), function () {
      var all = readHealth();
      var h = healthOf(all, name);
      var changed = null;
      h.calls += 1;
      h.last_code = outcome.ok ? null : (outcome.code || outcome.category || 'UNKNOWN');
      if (outcome.ok) {
        var wasOpen = h.state !== 'closed';
        h.state = 'closed';
        h.consecutive_failures = 0;
        h.cooldown_until = null;
        h.cooldown_seconds = null;
        h.quota_until = null;
        h.last_ok = at;
        if (typeof outcome.duration_ms === 'number') h.latency_ms = outcome.duration_ms;
        if (wasOpen) changed = { type: 'MODEL_RECOVERED' };
      } else {
        h.failures += 1;
        h.last_failure = at;
        if (outcome.category === 'quota') {
          var resume = outcome.resume_at && outcome.resume_at > now() ? outcome.resume_at : now() + cfg.quota_default_cooldown_seconds * 1000;
          h.quota_until = new Date(resume).toISOString();
          changed = { type: 'MODEL_QUOTA_WAIT', until: h.quota_until };
        } else {
          h.consecutive_failures += 1;
          var blocked = outcome.category === 'blocked';
          if (blocked || h.state === 'open' || h.consecutive_failures >= cfg.failure_threshold) {
            var base = blocked ? cfg.blocked_cooldown_seconds
              : (h.state === 'open' && h.cooldown_seconds ? Math.round(h.cooldown_seconds * cfg.cooldown_factor) : cfg.cooldown_seconds);
            h.cooldown_seconds = Math.min(Math.max(cfg.cooldown_max_seconds, blocked ? cfg.blocked_cooldown_seconds : 0), base);
            h.cooldown_until = new Date(now() + h.cooldown_seconds * 1000).toISOString();
            h.state = 'open';
            changed = { type: 'MODEL_COOLDOWN', until: h.cooldown_until, cooldown_seconds: h.cooldown_seconds, category: outcome.category };
          }
        }
      }
      all[name] = h;
      store.writeJSON(healthFile(), all);
      return changed;
    });
    delete availCache[name];
    if (event && ledger) ledger.append({ actor: 'jev', type: event.type, goal_id: ctx.goal_id, trace_id: ctx.trace_id, detail: Object.assign({ model: name, code: outcome.code || null }, event) });
    return event;
  }

  function status() {
    var all = readHealth();
    var out = {};
    Object.keys(registry.models).sort().forEach(function (name) {
      var m = registry.models[name];
      var avail = availability(name, m);
      var h = healthOf(all, name);
      // What route() would do with it NOW: an open circuit whose cooldown has
      // passed is half-open (one probe allowed), not unusable.
      var cooling = h.state === 'open' && h.cooldown_until && now() < Date.parse(h.cooldown_until);
      var waiting = !!(h.quota_until && now() < Date.parse(h.quota_until));
      out[name] = Object.assign({
        tier: m.tier, enabled: m.enabled, available: avail.ok, availability_detail: avail.detail || null,
        work_only: m.capabilities.length === 1 && m.capabilities[0] === 'repo_work', work_hosts: m.work_hosts || null,
        effective_state: h.state === 'open' ? (cooling ? 'open' : 'half_open') : h.state,
        selectable: m.enabled && avail.ok && !cooling && !waiting
      }, h);
    });
    return { models: out, spend: readSpend(), paid: policy.models.paid };
  }

  function model(name) { return registry.models[name] || null; }
  function resetHealth() { store.writeJSON(healthFile(), {}); availCache = {}; }

  function has(name) { return Object.prototype.hasOwnProperty.call(registry.models, name); }

  return { route: route, report: report, refresh: refresh, has: has, host: host, status: status, model: model, chargePaid: chargePaid, paidGate: paidGate, resetHealth: resetHealth, registry: registry };
}

module.exports = { create: create, loadRegistry: loadRegistry, validateRegistry: validateRegistry, REGISTRY_PATH: REGISTRY_PATH };
