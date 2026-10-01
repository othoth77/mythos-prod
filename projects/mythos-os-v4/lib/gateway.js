'use strict';
// =====================================================
// MYTHOS OS v4 — the model gateway (timeout · retry · deadline · fallback)
// projects/mythos-os-v4/lib/gateway.js
//
// JEV decides the order; the gateway walks it. For one answer task:
//
//   route = jev.route(...)            free → local (Qwen) → paid
//   for each candidate, in order:
//     - stop if the task's deadline has passed
//     - a paid candidate is charged against DOTS's budget first
//     - call it with a HARD per-attempt timeout (never longer than what is
//       left of the deadline)
//     - an empty or unusable answer is a FAILURE of that model (malformed),
//       never a result
//     - a transient failure is retried on the same model at most
//       `max_retries_per_model` times, with capped, jittered backoff
//     - every outcome is reported to JEV (cooldown / quota wait / recovery)
//       and written to the ledger
//     - then the next candidate
//
// Bounded in every direction: candidates are a finite list, retries are
// capped per model, `max_attempts_total` caps the whole call, and the
// deadline ends it regardless. complete() always resolves.
//
// If JEV itself cannot answer (its registry is unreadable), DOTS policy
// names ONE static fallback model — the decision layer failing is not a
// reason for the execution layer to stop.
// =====================================================

function create(deps) {
  var policy = deps.policy;
  var jev = deps.jev;                 // may be null when JEV failed to load
  var adapters = deps.adapters;
  var ledger = deps.ledger;
  var now = deps.now || Date.now;
  var sleep = deps.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var random = deps.random || Math.random;
  var gw = policy.gateway;

  // One call with a hard deadline. The adapter's own timeout is asked for
  // first; this race is what guarantees the bound if it does not honour it.
  function callWithDeadline(adapter, model, req, timeoutMs) {
    var started = now();
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve({ ok: false, text: null, served_by: null, timed_out: true, duration_ms: now() - started, error: { category: 'transient', code: 'TIMEOUT', detail: 'no answer within ' + timeoutMs + 'ms' } });
      }, timeoutMs + 250);
      Promise.resolve().then(function () { return adapter.call(model, { prompt: req.prompt, system: req.system, timeoutMs: timeoutMs }); }).then(function (out) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(out);
      }, function (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, text: null, served_by: null, timed_out: false, duration_ms: now() - started, error: { category: 'fatal', code: 'ADAPTER_THREW', detail: String(e && e.message).slice(0, 300) } });
      });
    });
  }

  // Fail closed on the answer itself.
  function checkOutput(out, validate) {
    if (!out.ok) return out;
    var text = typeof out.text === 'string' ? out.text.trim() : '';
    var problem = null;
    if (!text) problem = 'the model returned an empty answer';
    else if (text.length > gw.max_output_chars) problem = 'the answer exceeds ' + gw.max_output_chars + ' characters';
    else if (typeof validate === 'function') {
      try { problem = validate(text) || null; } catch (e) { problem = 'validator threw: ' + String(e && e.message).slice(0, 200); }
    }
    if (!problem) return Object.assign({}, out, { text: text });
    return { ok: false, text: null, served_by: out.served_by, timed_out: false, duration_ms: out.duration_ms, error: { category: 'malformed', code: 'MALFORMED_OUTPUT', detail: problem } };
  }

  function staticRoute(reason) {
    var name = policy.models.static_fallback_model;
    return { decision_id: null, ok: true, reason: null, static_fallback: reason, candidates: [{ model: name, tier: 'local', adapter: null, probing: false }], rejected: [], confidence: 'low' };
  }

  // complete(request) -> Promise<result>
  //   request { pool, capability, prompt, system?, timeout_seconds?, deadline_at?, validate?, goal_id, trace_id, step_id }
  //   result  { ok, text, model, tier, served_by, fallback_used, attempts[], decision_id, reason? }
  function complete(request) {
    var ctx = { goal_id: request.goal_id, trace_id: request.trace_id };
    var attempts = [];
    var total = 0;
    var deadlineAt = request.deadline_at || (now() + (request.timeout_seconds || gw.attempt_timeout_seconds * 4) * 1000);

    function finish(result) {
      ledger.append({
        actor: 'gateway', type: 'ANSWER_RESULT', goal_id: ctx.goal_id, trace_id: ctx.trace_id,
        detail: { step_id: request.step_id || null, ok: result.ok, reason: result.reason || null, model: result.model || null, tier: result.tier || null, served_by: result.served_by || null, fallback_used: !!result.fallback_used, attempts: attempts, decision_id: result.decision_id || null }
      });
      return result;
    }

    if (typeof request.prompt !== 'string' || !request.prompt.trim()) {
      return Promise.resolve(finish({ ok: false, reason: 'BAD_REQUEST', text: null, attempts: attempts }));
    }

    var prepare = jev ? Promise.resolve().then(function () { return jev.refresh(); }).catch(function () { return null; }) : Promise.resolve();
    return prepare.then(function () {
      var decision;
      var registryModel;
      try {
        if (!jev) throw new Error('JEV_UNAVAILABLE');
        decision = jev.route({ pool: request.pool, capability: request.capability, kind: 'answer', prompt_chars: request.prompt.length, goal_id: ctx.goal_id, trace_id: ctx.trace_id });
        registryModel = function (name) { return jev.model(name); };
      } catch (e) {
        decision = staticRoute(String(e && e.message).slice(0, 120));
        registryModel = deps.staticModel || function () { return null; };
        ledger.append({ actor: 'gateway', type: 'JEV_UNAVAILABLE_STATIC_FALLBACK', goal_id: ctx.goal_id, trace_id: ctx.trace_id, detail: { model: policy.models.static_fallback_model, error: decision.static_fallback } });
      }
      if (!decision.ok) {
        return finish({ ok: false, reason: decision.reason || 'NO_ROUTE', text: null, attempts: attempts, decision_id: decision.decision_id, rejected: decision.rejected });
      }

      var queue = decision.candidates.slice();
      var first = queue[0].model;

      function nextCandidate() {
        if (!queue.length) return finish({ ok: false, reason: 'ALL_MODELS_FAILED', text: null, attempts: attempts, decision_id: decision.decision_id });
        var cand = queue.shift();
        var model = registryModel(cand.model);
        var adapter = model ? adapters[model.adapter] : null;
        if (!model || !adapter) {
          attempts.push({ model: cand.model, tier: cand.tier, ok: false, category: 'blocked', code: 'NO_ADAPTER', duration_ms: 0 });
          return nextCandidate();
        }
        var tries = 0;

        function attempt() {
          var remaining = deadlineAt - now();
          if (remaining <= 1000) return finish({ ok: false, reason: 'DEADLINE', text: null, attempts: attempts, decision_id: decision.decision_id });
          if (total >= gw.max_attempts_total) return finish({ ok: false, reason: 'ATTEMPT_LIMIT', text: null, attempts: attempts, decision_id: decision.decision_id });
          if (model.tier === 'paid' && jev) {
            var refusal = jev.chargePaid(ctx.goal_id);
            if (refusal) {
              attempts.push({ model: cand.model, tier: cand.tier, ok: false, category: 'blocked', code: refusal, duration_ms: 0 });
              return nextCandidate();
            }
          }
          total += 1;
          tries += 1;
          var timeoutMs = Math.max(1000, Math.min(gw.attempt_timeout_seconds * 1000, remaining));
          return callWithDeadline(adapter, model, request, timeoutMs).then(function (raw) {
            var out = checkOutput(raw, request.validate);
            var category = out.ok ? null : out.error.category;
            attempts.push({
              model: cand.model, tier: cand.tier, try: tries, ok: out.ok, category: category, code: out.ok ? null : out.error.code,
              detail: out.ok ? null : out.error.detail, served_by: out.served_by || null, timed_out: !!out.timed_out, duration_ms: out.duration_ms || 0
            });
            if (jev) jev.report(cand.model, { ok: out.ok, category: category, code: out.ok ? null : out.error.code, duration_ms: out.duration_ms, resume_at: raw.resume_at || null }, ctx);
            if (out.ok) {
              return finish({
                ok: true, text: out.text, model: cand.model, tier: cand.tier, served_by: out.served_by || null,
                fallback_used: cand.model !== first, attempts: attempts, decision_id: decision.decision_id
              });
            }
            // Only a transient failure is worth the same model again.
            if (category === 'transient' && tries <= gw.max_retries_per_model) {
              var backoff = Math.min(gw.retry_max_ms, gw.retry_base_ms * Math.pow(2, tries - 1));
              var wait = Math.round(backoff * (0.5 + random() * 0.5));
              if (now() + wait >= deadlineAt) return nextCandidate();
              return sleep(wait).then(attempt);
            }
            return nextCandidate();
          });
        }
        return attempt();
      }
      return nextCandidate();
    });
  }

  return { complete: complete };
}

module.exports = { create: create };
