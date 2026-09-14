'use strict';
// =====================================================
// Free LLM Resources — selection + A -> B -> C fallback tests
// tests/free-llm-selector-test.js
//
// Reproduces, as an assertable regression test, the exact scenario
// manually verified during development: provider A quota-exhausted,
// provider B transiently down, provider C succeeds — Othmode gets an
// answer and never sees a thrown error. Fixtures under the home
// directory, removed at the end; every HTTP call injected.
//
// Run with: node tests/free-llm-selector-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var FIXTURES = path.join(os.homedir(), 'free-llm-selector-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });

// secrets.js reads MYTHOS_FREE_LLM_KEY_DIR once at require-time, so this
// MUST be set before requiring selector.js (which requires secrets.js
// transitively) — same ordering rule tests/mythos-budget-ledger-test.js
// follows for MYTHOS_EXECUTOR_HOME.
var KEY_DIR = path.join(FIXTURES, 'keys');
fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
process.env.MYTHOS_FREE_LLM_KEY_DIR = KEY_DIR;

var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var selector = require(path.join(EXEC, 'free-llm', 'selector'));
var registry = require(path.join(EXEC, 'free-llm', 'registry'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

var CATALOG_PATH = path.join(FIXTURES, 'catalog.json');
var ENDPOINTS_PATH = path.join(FIXTURES, 'endpoints.json');
var HEALTH_PATH = path.join(FIXTURES, 'health.json');

function provider(id, modelId, confidence) {
  return {
    id: id, name: id, homepage: 'https://' + id + '.example', category: 'free', access_type: 'free_tier',
    requirements: ['signup'], data_policy_note: null, official: null, limits_text: null,
    models: [{ name: modelId, api_model_id: modelId, api_model_id_confidence: confidence || 'literal_text', limits_text: null, modality: 'chat' }]
  };
}

var CATALOG = { providers: [provider('alpha', 'alpha-model'), provider('bravo', 'bravo-model'), provider('charlie', 'charlie-model')] };
var ENDPOINTS = {
  providers: {
    alpha: { base_url: 'https://alpha.example/v1', wired: true },
    bravo: { base_url: 'https://bravo.example/v1', wired: true },
    charlie: { base_url: 'https://charlie.example/v1', wired: true }
  }
};
fs.writeFileSync(CATALOG_PATH, JSON.stringify(CATALOG));
fs.writeFileSync(ENDPOINTS_PATH, JSON.stringify(ENDPOINTS));
['alpha', 'bravo', 'charlie'].forEach(function (id) {
  fs.writeFileSync(path.join(KEY_DIR, id + '.env'),
    'MYTHOS_FREE_LLM_' + id.toUpperCase() + '_API_KEY=sk-fixture-' + id + '\n', { mode: 0o600 });
});

function opts(extra) {
  return Object.assign({ catalogPath: CATALOG_PATH, endpointsPath: ENDPOINTS_PATH, healthPath: HEALTH_PATH }, extra || {});
}

// ---------------------------------------------------------------- 1. ranking / filtering
var cands = selector.selectCandidates({ modality: 'chat' }, opts());
ok(cands.length === 3, 'all three fully-wired, keyed, chat-modality providers are candidates (' + cands.length + ')');
ok(cands.every(function (c) { return c.model_id; }), 'every candidate carries a confirmed model id');

// ---------------------------------------------------------------- 2. A -> B -> C fallback: quota, then transient, then success
var order = [];
function transport(reqOpts) {
  if (/alpha/.test(reqOpts.url)) {
    order.push('alpha');
    return Promise.resolve({ status: 429, body: JSON.stringify({ error: { message: 'usage limit reached' } }) });
  }
  if (/bravo/.test(reqOpts.url)) {
    order.push('bravo');
    return Promise.resolve({ status: 503, body: 'Service Unavailable' });
  }
  if (/charlie/.test(reqOpts.url)) {
    order.push('charlie');
    return Promise.resolve({ status: 200, body: JSON.stringify({ model: 'charlie-model', choices: [{ message: { content: 'the answer' } }] }) });
  }
  return Promise.resolve({ status: 500, body: '{}' });
}

var chain = selector.complete('ping', opts({ transport: transport })).then(function (result) {
  ok(result.ok === true && result.provider_id === 'charlie' && result.text === 'the answer',
    'the pool falls through alpha -> bravo -> charlie and returns charlie\'s answer');
  ok(order.join(',') === 'alpha,bravo,charlie', 'candidates were tried in ranked order, not all at once (' + order.join(',') + ')');
  ok(result.attempts.length === 3 &&
    result.attempts[0].status === 'quota_exhausted' && result.attempts[1].status === 'degraded' && result.attempts[2].status === 'active',
    'each attempt records the exact failure/success reason, in order');

  var health = registry.loadHealth(HEALTH_PATH);
  ok(health.alpha.status === 'quota_exhausted' && health.bravo.status === 'degraded' && health.charlie.status === 'active',
    'the fallback run persisted health for all three providers, not just the winner');
}).then(function () {
  // ---------------------------------------------------------------- 3. total wipeout never throws/rejects
  var allFail = function () { return Promise.resolve({ status: 500, body: 'boom' }); };
  return selector.complete('ping', opts({ transport: allFail })).then(function (result) {
    ok(result.ok === false && result.reason === 'ALL_CANDIDATES_FAILED',
      'when every candidate fails, complete() resolves { ok:false }, never rejects — Othmode keeps running');
    ok(result.attempts.length === 3, 'all three candidates were actually attempted before giving up');
  });
}).then(function () {
  // ---------------------------------------------------------------- 4. no candidates at all is also a clean resolve
  return selector.complete('ping', opts({ transport: function () { return Promise.reject(new Error('should not be called')); }, exclude: ['alpha', 'bravo', 'charlie'] }))
    .then(function (result) {
      ok(result.ok === false && result.reason === 'NO_CANDIDATE_AVAILABLE' && result.attempts.length === 0,
        'excluding every candidate resolves NO_CANDIDATE_AVAILABLE without attempting a single call');
    });
});

chain.then(function () {
  delete process.env.MYTHOS_FREE_LLM_KEY_DIR;
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failures.length) { console.log('Failures:\n  ' + failures.join('\n  ')); process.exit(1); }
  process.exit(0);
}).catch(function (err) {
  console.error('SUITE ERROR: ' + (err && err.stack || err));
  delete process.env.MYTHOS_FREE_LLM_KEY_DIR;
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  process.exit(1);
});
