'use strict';
// =====================================================
// MYTHOS OS v4 — health checks
// projects/mythos-os-v4/lib/health.js
//
// One check per layer of the chain, measured on this host, and one report:
//
//   PASS  the layer works here
//   WARN  the chain still works, with less behind it (a tier or the
//         failover engine is not configured on this host)
//   FAIL  a critical path is broken
//
// By default nothing is called that costs anything: presence, config and
// the local runtime's /health. `live: true` additionally sends ONE real
// request to each executive engine that is available and ONE real answer
// through the gateway, and reports which model actually served it — the
// only evidence that a route works rather than merely exists.
// A check that cannot run says so; it is never read as a pass.
// =====================================================

var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var store = require('./store');

var PING_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['pong'],
  properties: { pong: { type: 'string', enum: ['pong'] } }
};

function run(system, opts) {
  opts = opts || {};
  var policy = system.policy;
  var checks = [];
  function add(id, status, detail, data) { checks.push({ id: id, status: status, detail: detail, data: data || undefined }); }

  // 1. DOTS: policy, store, ledger, goals
  add('dots_policy', 'PASS', 'policy ' + policy.version + ' validated');
  try {
    var probe = store.file('.health-probe');
    store.writeJSON(probe, { at: new Date().toISOString() });
    fs.unlinkSync(probe);
    add('dots_store', 'PASS', 'writable: ' + store.home());
  } catch (e) {
    add('dots_store', 'FAIL', 'store not writable: ' + String(e && e.code));
  }
  var chain = system.ledger.verify();
  add('ledger_chain', chain.ok ? 'PASS' : 'FAIL', chain.ok ? chain.records + ' records, chain intact' : chain.problems.slice(0, 3).join('; '), { records: chain.records });
  try {
    var goals = system.dots.listGoals();
    var openEsc = system.dots.listEscalations({ status: 'OPEN' });
    var stalled = system.watchdog.stalledGoals(goals);
    add('dots_goals', stalled.length ? 'WARN' : 'PASS',
      goals.length + ' goals, ' + openEsc.length + ' open escalation(s)' + (stalled.length ? ', ' + stalled.length + ' stalled (run: mythos-os watchdog tick)' : ''),
      { goals: goals.length, open_escalations: openEsc.length, stalled: stalled.length });
  } catch (e2) {
    add('dots_goals', 'FAIL', 'goal store unreadable: ' + String(e2 && e2.message).slice(0, 200));
  }

  // 2. the executive: FABLE, and OpenAI as its watchdog/failover
  var fable = system.engines.fable.available();
  add('fable_executive', fable.ok ? 'PASS' : 'FAIL', fable.detail);
  var openai = system.engines.openai.available();
  add('openai_watchdog', openai.ok ? 'PASS' : 'WARN', openai.ok ? openai.detail : 'OpenAI failover not usable on this host: ' + openai.detail);
  var wd = system.watchdog.status();
  add('watchdog_state', wd.mode === 'fable' ? 'PASS' : 'WARN', 'leading: ' + wd.leading + (wd.mode === 'openai' ? ' (takeover since ' + wd.takeover_at + ', FABLE probe ' + (wd.probe_due ? 'due' : 'after ' + wd.cooldown_until) + ')' : '') + ', failures in window: ' + wd.failures_in_window, wd);
  var direct = policy.authority.executive_last_resort === 'direct';
  var executives = (fable.ok ? 1 : 0) + (openai.ok ? 1 : 0) + (direct ? 1 : 0);
  add('executive_no_spof', executives >= 2 ? 'PASS' : 'FAIL', executives + ' executive path(s): ' + [fable.ok && 'fable', openai.ok && 'openai', direct && 'direct'].filter(Boolean).join(', '));

  var live = Promise.resolve();

  // 3. JEV and the three tiers
  if (!system.jev) {
    add('jev', 'FAIL', 'JEV did not load: ' + system.jevError + ' (answers fall back to ' + policy.models.static_fallback_model + ' only)');
  } else {
    live = live.then(function () { return system.jev.refresh(); }).then(function () {
      var st = system.jev.status();
      var byTier = { free: [], local: [], paid: [] };
      Object.keys(st.models).forEach(function (name) {
        var m = st.models[name];
        if (m.enabled) byTier[m.tier].push({ name: name, available: m.available, state: m.state, detail: m.availability_detail });
      });
      function usable(list) { return list.filter(function (m) { return m.available && m.state !== 'open'; }); }
      function describe(list) { return list.map(function (m) { return m.name + '=' + (m.available ? m.state : 'unavailable (' + m.detail + ')'); }).join(', '); }
      add('free_llm_tier', usable(byTier.free).length ? 'PASS' : 'WARN', describe(byTier.free) || 'no free model registered');
      add('qwen_tier', usable(byTier.local).length ? 'PASS' : 'FAIL', describe(byTier.local) || 'no local model registered');
      add('paid_tier', !policy.models.paid.allowed ? 'WARN' : (usable(byTier.paid).length ? 'PASS' : 'WARN'),
        !policy.models.paid.allowed ? 'paid models are switched off by DOTS policy' : describe(byTier.paid),
        { spend: st.spend, budget: policy.models.paid });
      var tiers = ['free', 'local', 'paid'].filter(function (t) { return usable(byTier[t]).length > 0; });
      add('model_no_spof', tiers.length >= 2 ? 'PASS' : 'FAIL', tiers.length + ' usable tier(s): ' + tiers.join(', '));
      // These are real route() decisions, so they land on the ledger like
      // any other (goal_id null): a health run is itself traceable.
      var answerRoute = system.jev.route({ pool: 'execution', capability: 'analysis', kind: 'answer', prompt_chars: 200 });
      add('jev', answerRoute.ok ? 'PASS' : 'FAIL', answerRoute.ok
        ? 'answer route: ' + answerRoute.candidates.map(function (c) { return c.model + '[' + c.tier + ']'; }).join(' → ')
        : 'no route for an answer task', { rejected: answerRoute.rejected });
      var workRoute = system.jev.route({ pool: 'execution', capability: 'repo_work', kind: 'work', prompt_chars: 200 });
      add('jev_work_route', workRoute.ok ? 'PASS' : 'FAIL', workRoute.ok
        ? 'work route: ' + workRoute.candidates.map(function (c) { return c.model + ' via ' + c.work_provider; }).join(', ')
        : 'no model with execution authority is usable: ' + workRoute.rejected.map(function (r) { return r.model + ' ' + r.reason; }).join('; ').slice(0, 300));
    });
  }

  // 4. HADDAD: the executor that runs repository work
  live = live.then(function () {
    var env = system.haddad.executorEnv();
    var root = system.haddad.executorRoot;
    var bin = path.join(root, 'projects', 'mythos-ai-executor', 'bin', 'mythos-ai-executor');
    var problems = [];
    if (!env || !env.MYTHOS_EXECUTOR_HOME) problems.push('no executor env file (' + policy.haddad.executor_env_file + ')');
    else if (!fs.existsSync(env.MYTHOS_EXECUTOR_HOME)) problems.push('executor store missing');
    if (!fs.existsSync(bin)) problems.push('executor CLI missing under ' + root);
    var unit = policy.haddad.executor_unit;
    var active = opts.unitActive ? opts.unitActive(unit) : (function () {
      var r = cp.spawnSync('systemctl', ['--user', 'is-active', unit], { encoding: 'utf8', timeout: 10000 });
      if (r.error) return null;
      return String(r.stdout).trim() === 'active';
    })();
    if (active === false) problems.push(unit + ' is not active');
    if (active === null) problems.push('could not ask systemd about ' + unit);
    add('haddad_executor', problems.length ? 'FAIL' : 'PASS', problems.length ? problems.join('; ') : unit + ' active, store and CLI present');
  });

  // 5. live probes (opt-in: they call real models)
  if (opts.live) {
    live = live.then(function () {
      var ids = ['fable', 'openai'].filter(function (id) { return system.engines[id].available().ok; });
      return ids.reduce(function (p, id) {
        return p.then(function () {
          return system.engines[id].call({
            system: 'Health probe. Answer with the JSON object {"pong":"pong"} and nothing else.', input: 'ping', schema: PING_SCHEMA,
            role: id === 'openai' ? 'smoke' : null, timeoutMs: 90000
          }).then(function (out) {
            var good = out.ok && out.value && out.value.pong === 'pong';
            add('live_' + id, good ? 'PASS' : 'FAIL', good ? 'answered, served by ' + out.model_measured + ' in ' + out.duration_ms + ' ms' : 'no usable answer: ' + (out.error ? out.error.code : 'wrong value'));
            system.ledger.append({ actor: 'health', type: 'LIVE_PROBE', detail: { engine: id, ok: good, model: out.model_measured || null, code: out.error ? out.error.code : null } });
          });
        });
      }, Promise.resolve());
    }).then(function () {
      return system.gateway.complete({ pool: 'execution', capability: 'analysis', prompt: 'Reply with the single word: pong', timeout_seconds: 180, step_id: 'health' }).then(function (r) {
        add('live_answer_route', r.ok ? 'PASS' : 'FAIL', r.ok
          ? 'answered by ' + r.model + ' [' + r.tier + '] (' + r.served_by + ')' + (r.fallback_used ? ' after fallback' : '')
          : 'no model answered: ' + r.reason, { attempts: r.attempts });
      });
    });
  }

  return live.then(function () {
    var fails = checks.filter(function (c) { return c.status === 'FAIL'; }).length;
    var warns = checks.filter(function (c) { return c.status === 'WARN'; }).length;
    return {
      at: new Date().toISOString(), host: require('os').hostname(), live: !!opts.live,
      result: fails ? 'FAIL' : (warns ? 'PASS_WITH_WARNINGS' : 'PASS'),
      counts: { pass: checks.length - fails - warns, warn: warns, fail: fails }, checks: checks
    };
  });
}

module.exports = { run: run };
