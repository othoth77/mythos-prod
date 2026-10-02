'use strict';
// =====================================================
// MYTHOS OS v4 — runtime wiring
// projects/mythos-os-v4/lib/index.js
//
//   DOTS ── executive (FABLE 5.1 ⇄ OpenAI watchdog) ── JEV ── gateway ── HADDAD
//
// build() assembles the production chain from the real components. Every
// dependency is injectable (tests replace the engines, adapters, clock and
// process spawner) — but nothing is replaced by default: what build()
// returns with no options is what runs.
// =====================================================

var adaptersLib = require('./adapters');
var dotsLib = require('./dots');
var enginesLib = require('./engines');
var executiveLib = require('./executive');
var gatewayLib = require('./gateway');
var haddadLib = require('./haddad');
var hostLib = require('./host');
var jevLib = require('./jev');
var ledgerLib = require('./ledger');
var policyLib = require('./policy');
var store = require('./store');
var watchdogLib = require('./watchdog');

// What the gateway may still call when JEV's registry cannot be loaded:
// only the policy's static fallback, and only as the local model.
var STATIC_MODELS = {
  'qwen-local': { tier: 'local', adapter: 'haddad-qwen', max_prompt_chars: 6000, execution_authority: false }
};

function build(opts) {
  opts = opts || {};
  var policy = policyLib.load({ policy: opts.policy, path: opts.policyPath });
  var ledger = opts.ledger || ledgerLib;
  var now = opts.now || Date.now;
  var adapters = opts.adapters || adaptersLib.defaults(opts.adapterOpts);
  var host = hostLib.resolve(policy, opts.host);

  var jev = null;
  var jevError = null;
  try {
    jev = jevLib.create({ policy: policy, adapters: adapters, ledger: ledger, now: now, registry: opts.registry, registryPath: opts.registryPath, host: host.name });
  } catch (e) {
    jevError = String(e && e.message);
  }

  var gateway = gatewayLib.create({
    policy: policy, jev: jev, adapters: adapters, ledger: ledger, now: now, sleep: opts.sleep, random: opts.random,
    staticModel: function (name) { return STATIC_MODELS[name] || null; }
  });

  var engines = opts.engines || {
    fable: enginesLib.createFable({ model: policy.executive.fable_model }),
    openai: enginesLib.createOpenAI()
  };
  var watchdog = watchdogLib.create({ policy: policy, ledger: ledger, engines: engines, now: now });
  var executive = executiveLib.create({ policy: policy, watchdog: watchdog, engines: engines, ledger: ledger, now: now, host: host });
  var haddad = haddadLib.create({
    policy: policy, jev: jev, gateway: gateway, ledger: ledger, now: now, sleep: opts.sleep, spawn: opts.spawn,
    executorRoot: opts.executorRoot, executorEnvFile: opts.executorEnvFile, host: host
  });
  var dots = dotsLib.create({
    policy: policy, ledger: ledger, executive: executive, haddad: haddad, watchdog: watchdog, now: now,
    // DOTS checks a goal's forced / preferred model against JEV's registry.
    modelExists: function (name) { return jev ? jev.has(name) : false; }
  });

  return {
    policy: policy, ledger: ledger, store: store, adapters: adapters, engines: engines, host: host,
    jev: jev, jevError: jevError, gateway: gateway, watchdog: watchdog, executive: executive, haddad: haddad, dots: dots
  };
}

module.exports = { build: build, STATIC_MODELS: STATIC_MODELS };
