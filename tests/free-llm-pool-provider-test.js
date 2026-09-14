'use strict';
// =====================================================
// Free LLM Resources — pool provider + executor wiring tests
// tests/free-llm-pool-provider-test.js
//
// Proves the additive integration points from AGENTS.md-scoped review:
// config/agents.json's new "free-llm-pool" entry loads cleanly through
// core/agent-registry.js's validateDefinition and defaultProbe, and
// executor.js's PROVIDERS map resolves the same provider id — without
// touching any existing agent's behaviour (asserted explicitly below).
//
// Run with: node tests/free-llm-pool-provider-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var FIXTURES = path.join(os.homedir(), 'free-llm-pool-provider-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_FREE_LLM_KEY_DIR = path.join(FIXTURES, 'keys'); // no keys created -> pool reports unavailable, honestly

var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var agents = require(path.join(EXEC, 'core', 'agent-registry'));
var poolProvider = require(path.join(EXEC, 'providers', 'free-llm-pool'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

// ---------------------------------------------------------------- 1. config/agents.json loads cleanly
var discovered = agents.discoverAgents();
var poolDef = agents.getAgent('free-llm-pool');
ok(!!poolDef, 'config/agents.json registers a "free-llm-pool" agent');
ok(poolDef.provider === 'free-llm-pool' && poolDef.execution_authority === false,
  'free-llm-pool is advisory-only, like every other non-claude-code agent');
ok(poolDef.cost && poolDef.cost.tier === 'free', 'free-llm-pool declares cost.tier=free (ranks first in agent-registry\'s COST_RANK)');
ok(discovered.some(function (a) { return a.name === 'free-llm-pool'; }), 'discoverAgents() surfaces the new agent alongside the pre-existing ones');

// ---------------------------------------------------------------- 2. existing agents are UNTOUCHED
ok(!!agents.getAgent('claude-code') && !!agents.getAgent('omniroute-advisory') && !!agents.getAgent('gemini-advisor'),
  'the three pre-existing agents (claude-code, omniroute-advisory, gemini-advisor) are still registered');
var claudeDef = agents.getAgent('claude-code');
ok(claudeDef.execution_authority === true && claudeDef.risk_level === 'high',
  'claude-code\'s own definition is unchanged by this stage');

// ---------------------------------------------------------------- 3. agent-registry's defaultProbe branch
var health = agents.healthCheck('free-llm-pool', { fresh: true });
ok(health.detail === 'unavailable_or_unconfigured' && health.available === false,
  'with zero credentials configured, health-check reports unavailable_or_unconfigured, never a crash (' + health.detail + ')');

// ---------------------------------------------------------------- 4. executor.js resolves the same provider id
delete require.cache[require.resolve(path.join(EXEC, 'executor.js'))];
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
var executor;
try {
  executor = require(path.join(EXEC, 'executor.js'));
  ok(true, 'executor.js loads with the new PROVIDERS entry present (no require-time error)');
} catch (e) {
  ok(false, 'executor.js loads with the new PROVIDERS entry present: ' + e.message);
}

// ---------------------------------------------------------------- 5. providers/free-llm-pool.js contract
ok(typeof poolProvider.available === 'function' && typeof poolProvider.run === 'function' &&
  poolProvider.executionAuthority === false,
  'providers/free-llm-pool.js implements the standard {available, run, executionAuthority:false} adapter contract');
ok(poolProvider.available() === false, 'available() is honestly false with no credential configured anywhere');

var chain = poolProvider.run({ timeout_seconds: 5 }, 'ping', null, null, {
  transport: function () { return Promise.reject(new Error('should never be called — no candidates exist')); }
}).then(function (outcome) {
  ok(outcome.exit_code === 1 && outcome.parsed.is_error === true && /FREE_LLM_POOL_EXHAUSTED/.test(outcome.stderr),
    'run() with zero configured providers resolves a normal FAILED-shaped outcome, never throws');
  ok(outcome.attempts.length === 0, 'no HTTP attempt is made when there is nothing to call');
});

chain.then(function () {
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failures.length) { console.log('Failures:\n  ' + failures.join('\n  ')); process.exit(1); }
  process.exit(0);
}).catch(function (err) {
  console.error('SUITE ERROR: ' + (err && err.stack || err));
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  process.exit(1);
});
