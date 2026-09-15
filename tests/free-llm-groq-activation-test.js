'use strict';
// =====================================================
// Free LLM Resources — Groq activation flow test
// tests/free-llm-groq-activation-test.js
//
// Exercises the REAL production catalog.json/endpoints.json (not a
// synthetic fixture) to prove, end to end, exactly the flow requested
// for the FREE-LLM-1 activation stage:
//
//   Othmode task -> free provider selection -> Groq
//                -> automatic fallback if Groq fails -> next provider
//
// Every HTTP call is injected (opts.transport) and every credential is
// a FIXTURE value written to an isolated temp key directory — never
// the real ~/.config/mythos-ai-executor/free-llm/ path, never a real
// API key. Fixtures live under the home directory (never /tmp), and
// MYTHOS_EXECUTOR_HOME is isolated so this test cannot write into the
// real production reputation store (see free-llm-selector-test.js).
//
// Run with: node tests/free-llm-groq-activation-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var FIXTURES = path.join(os.homedir(), 'free-llm-groq-activation-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
var KEY_DIR = path.join(FIXTURES, 'keys');
fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
process.env.MYTHOS_FREE_LLM_KEY_DIR = KEY_DIR;
process.env.MYTHOS_EXECUTOR_HOME = FIXTURES;

var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var selector = require(path.join(EXEC, 'free-llm', 'selector'));
var registry = require(path.join(EXEC, 'free-llm', 'registry'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

var HEALTH_PATH = path.join(FIXTURES, 'health.json');
function opts(extra) { return Object.assign({ healthPath: HEALTH_PATH }, extra || {}); }

function writeKey(providerId) {
  var envVar = 'MYTHOS_FREE_LLM_' + providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY';
  fs.writeFileSync(path.join(KEY_DIR, providerId + '.env'), envVar + '=fixture-not-a-real-key\n', { mode: 0o600 });
}

// ---------------------------------------------------------------- 0. Groq is really in the committed catalog, confirmed and wired
var catalog = registry.loadCatalog();
var groqEntry = catalog.providers.find(function (p) { return p.id === 'groq'; });
ok(!!groqEntry, 'the committed catalog.json lists groq');
var endpoints = registry.loadEndpoints();
ok(!!endpoints.groq && endpoints.groq.wired === true, 'endpoints.json wires groq for live calls');
var groqProbeModel = registry.pickProbeModel(groqEntry);
ok(!!groqProbeModel && groqProbeModel.modality === 'chat',
  'groq has a catalog-confirmed CHAT model to call (' + (groqProbeModel && groqProbeModel.api_model_id) + ')');

// ---------------------------------------------------------------- 1. Groq selected first when it is the only/best candidate
writeKey('groq');
writeKey('openrouter');
var groqCands = selector.selectCandidates({ modality: 'chat' }, opts());
ok(groqCands.length >= 1 && groqCands[0].provider_id === 'groq',
  'with groq and openrouter both keyed and equally healthy, groq ranks first (alphabetical tiebreak): got ' +
  groqCands.map(function (c) { return c.provider_id; }).join(','));

// ---------------------------------------------------------------- 2. Othmode task -> selection -> Groq succeeds directly
var openrouterCalled = false;
var successTransport = function (reqOpts, body) {
  if (/groq/.test(reqOpts.url)) {
    var payload = JSON.parse(body);
    return Promise.resolve({ status: 200, body: JSON.stringify({ model: payload.model, choices: [{ message: { content: 'groq says hi' } }] }) });
  }
  openrouterCalled = true;
  return Promise.resolve({ status: 200, body: JSON.stringify({ model: 'x', choices: [{ message: { content: 'should not be reached' } }] }) });
};
var chain = selector.complete('ping', opts({ transport: successTransport })).then(function (result) {
  ok(result.ok === true && result.provider_id === 'groq' && result.text === 'groq says hi',
    'Othmode task -> selection -> Groq: a healthy Groq answers directly');
  ok(openrouterCalled === false, 'openrouter is never called when Groq already succeeded');
}).then(function () {
  // -------------------------------------------------------------- 3. Groq fails (quota) -> automatic fallback -> next provider
  var order = [];
  var fallbackTransport = function (reqOpts, body) {
    if (/groq/.test(reqOpts.url)) {
      order.push('groq');
      return Promise.resolve({ status: 429, body: JSON.stringify({ error: { message: 'usage limit reached' } }) });
    }
    order.push('openrouter');
    var payload = JSON.parse(body);
    return Promise.resolve({ status: 200, body: JSON.stringify({ model: payload.model, choices: [{ message: { content: 'openrouter took over' } }] }) });
  };
  return selector.complete('ping', opts({ transport: fallbackTransport })).then(function (result) {
    ok(order.join(',') === 'groq,openrouter', 'Groq is tried first, THEN the fallback provider — never in parallel (' + order.join(',') + ')');
    ok(result.ok === true && result.provider_id === 'openrouter' && result.text === 'openrouter took over',
      'automatic fallback: Groq quota-exhausted -> the next available provider answers instead');
    ok(result.attempts.length === 2 && result.attempts[0].provider_id === 'groq' && result.attempts[0].status === 'quota_exhausted',
      'the failed Groq attempt is recorded with the correct reason (quota_exhausted), not silently dropped');

    var health = registry.loadHealth(HEALTH_PATH);
    ok(health.groq.status === 'quota_exhausted', 'Groq\'s health state reflects the quota failure for the next selection round');
  });
}).then(function () {
  // -------------------------------------------------------------- 4. Only Groq configured, Groq fails -> Othmode is not stopped
  var groqOnlyFail = function () { return Promise.resolve({ status: 429, body: JSON.stringify({ error: { message: 'usage limit reached' } }) }); };
  return selector.complete('ping', opts({ transport: groqOnlyFail, exclude: ['openrouter'] })).then(function (result) {
    ok(result.ok === false && result.reason === 'ALL_CANDIDATES_FAILED' && result.attempts.length === 1,
      'with only Groq available and it failing, complete() resolves { ok:false } — never throws, never stops Othmode');
  });
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
