'use strict';
// =====================================================
// Free LLM Resources — registry (health state + live view) tests
// tests/free-llm-registry-test.js
//
// Fixtures live under the home directory (never /tmp), same discipline
// as tests/mythos-budget-ledger-test.js, and are removed at the end.
// Every HTTP call is injected (opts.transport) — no network.
//
// Run with: node tests/free-llm-registry-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var FIXTURES = path.join(os.homedir(), 'free-llm-registry-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });

// checkProviderHealth() calls core/reputation.js, which persists under
// core/store.js's root() — MUST be isolated here, before requiring
// registry.js, or every run pollutes the REAL production orchestration
// store at ~/mythos-ai-executor/orchestration/reputation.json with fake
// "free-llm:provider-a" evidence (found live during FREE-LLM activation,
// 2026-09-15 — same class of bug as tests-can-write-production-defaults).
process.env.MYTHOS_EXECUTOR_HOME = FIXTURES;

var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var registry = require(path.join(EXEC, 'free-llm', 'registry'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

var CATALOG_PATH = path.join(FIXTURES, 'catalog.json');
var ENDPOINTS_PATH = path.join(FIXTURES, 'endpoints.json');
var HEALTH_PATH = path.join(FIXTURES, 'health.json');
var KEY_FILE_A = path.join(FIXTURES, 'provider-a.env');

var CATALOG = {
  providers: [
    {
      id: 'provider-a', name: 'Provider A', homepage: 'https://a.example', category: 'free', access_type: 'free_tier',
      requirements: ['signup'], data_policy_note: null, official: null, limits_text: '10 requests/day',
      models: [{ name: 'model-a', api_model_id: 'model-a', api_model_id_confidence: 'literal_text', limits_text: null, modality: 'chat' }]
    },
    {
      id: 'provider-b-no-confirmed-model', name: 'Provider B', homepage: 'https://b.example', category: 'free', access_type: 'free_tier',
      requirements: ['signup'], data_policy_note: null, official: null, limits_text: null,
      models: [{ name: 'Display Name Only', api_model_id: null, api_model_id_confidence: 'unconfirmed', limits_text: null, modality: 'chat' }]
    },
    {
      id: 'provider-c-unwired', name: 'Provider C', homepage: 'https://c.example', category: 'trial', access_type: 'trial',
      requirements: ['signup'], data_policy_note: null, official: null, limits_text: null,
      models: [{ name: 'model-c', api_model_id: 'model-c', api_model_id_confidence: 'literal_text', limits_text: null, modality: 'chat' }]
    }
  ]
};
var ENDPOINTS = { providers: { 'provider-a': { base_url: 'https://a.example/v1', wired: true } } };

fs.writeFileSync(CATALOG_PATH, JSON.stringify(CATALOG));
fs.writeFileSync(ENDPOINTS_PATH, JSON.stringify(ENDPOINTS));
fs.writeFileSync(KEY_FILE_A, 'MYTHOS_FREE_LLM_PROVIDER_A_API_KEY=sk-fixture\n', { mode: 0o600 });

function opts(extra) {
  return Object.assign({
    catalogPath: CATALOG_PATH, endpointsPath: ENDPOINTS_PATH, healthPath: HEALTH_PATH,
    secretsOpts: { keyFile: KEY_FILE_A }
  }, extra || {});
}

// ---------------------------------------------------------------- 1. statusFromOutcome mapping
ok(registry.statusFromOutcome({ parsed: { is_error: false, result: 'hi' } }) === 'active',
  'a clean success maps to active');
ok(registry.statusFromOutcome({ parsed: { is_error: true, result: 'usage limit reached' } }) === 'quota_exhausted',
  'a quota-shaped message (lib/quota.js pattern) maps to quota_exhausted');
ok(registry.statusFromOutcome({ parsed: { is_error: true, result: 'rate limit exceeded' } }) === 'degraded',
  'a transient-shaped message maps to degraded, not unavailable');
ok(registry.statusFromOutcome({ parsed: { is_error: true, result: 'HTTP 404: model not found' }, http_status: 404 }) === 'expired',
  'an HTTP 404 maps to expired (the :free slug likely rotated out)');
ok(registry.statusFromOutcome({ parsed: { is_error: true, result: 'HTTP 429: Rate limit reached … tokens per minute (TPM)' }, http_status: 429 }) === 'quota_exhausted',
  'HTTP 429 -> quota_exhausted (per-minute budget, not an outage)');
ok(registry.statusFromOutcome({ parsed: { is_error: true, result: 'HTTP 413: Request Entity Too Large' }, http_status: 413 }) === 'quota_exhausted',
  'HTTP 413 -> quota_exhausted (Groq answers 413 for requests over the TPM budget — observed live 2026-09-17)');
ok(registry.statusFromOutcome({ parsed: { is_error: true, result: 'invalid api key' } }) === 'unavailable',
  'a blocked/permanent-shaped message maps to unavailable, never a crash');

// ---------------------------------------------------------------- 2. checkProviderHealth: unwired / no-credential / no-confirmed-model
var chain = registry.checkProviderHealth('provider-c-unwired', opts()).then(function (r) {
  ok(r.status === 'unconfigured' && /NOT_WIRED/.test(r.last_failure_reason),
    'an unwired provider reports unconfigured with a NOT_WIRED reason, never a network attempt');
}).then(function () {
  return registry.checkProviderHealth('provider-a', opts({ secretsOpts: { keyFile: path.join(FIXTURES, 'missing.env') } }));
}).then(function (r) {
  ok(r.status === 'unconfigured' && /NO_CREDENTIAL/.test(r.last_failure_reason),
    'a wired provider with no key file reports unconfigured with a NO_CREDENTIAL reason');
}).then(function () {
  return registry.checkProviderHealth('provider-b-no-confirmed-model', opts());
}).then(function (r) {
  // provider-b is not in ENDPOINTS at all -> also unconfigured (NOT_WIRED wins before the model-confidence check is even reached)
  ok(r.status === 'unconfigured', 'an unwired provider never reaches the confirmed-model check either');
}).then(function () {
  // ---------------------------------------------------------------- 3. checkProviderHealth: a real (mocked) probe
  var calls = 0;
  var transport = function (reqOpts, body) {
    calls++;
    var payload = JSON.parse(body);
    ok(payload.model === 'model-a', 'the probe request carries the catalog-confirmed model id, never a guess');
    return Promise.resolve({ status: 200, body: JSON.stringify({ model: 'model-a', choices: [{ message: { content: 'ok' } }] }) });
  };
  return registry.checkProviderHealth('provider-a', opts({ transport: transport })).then(function (r) {
    ok(calls === 1, 'exactly one HTTP call was made for the probe');
    ok(r.status === 'active' && r.last_success && (r.last_failure ? true : !r.last_failure_reason),
      'a successful probe records active + last_success; a failure reason only ever accompanies a last_failure timestamp (V2 keeps it for the reader)');
    ok(r.probed_model === 'model-a', 'the health record remembers which model was actually probed');
  });
}).then(function () {
  // ---------------------------------------------------------------- 4. persisted health survives a reload + consecutive_failures accumulates
  var failing = function () { return Promise.resolve({ status: 429, body: JSON.stringify({ error: { message: 'usage limit reached' } }) }); };
  return registry.checkProviderHealth('provider-a', opts({ transport: failing })).then(function (r1) {
    ok(r1.status === 'quota_exhausted' && r1.consecutive_failures === 1, 'first failure after a success resets to consecutive_failures=1');
    return registry.checkProviderHealth('provider-a', opts({ transport: failing }));
  }).then(function (r2) {
    ok(r2.consecutive_failures === 2, 'a second consecutive failure increments the counter');
    ok(r2.last_success, 'last_success from the earlier successful probe is preserved across later failures');
    var onDisk = JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8'));
    ok(onDisk['provider-a'].status === 'quota_exhausted', 'health.json on disk reflects the latest state');
  });
}).then(function () {
  // ---------------------------------------------------------------- 4b. preferred chat model (official override) — OTHMODE V2
  var CAT2 = path.join(FIXTURES, 'catalog-pref.json'), OVR = path.join(FIXTURES, 'overrides-pref.json');
  fs.writeFileSync(CAT2, JSON.stringify({ providers: [{ id: 'provider-a', name: 'Provider A', models: [
    { name: 'heavy', api_model_id: 'heavy-agentic', api_model_id_confidence: 'literal_text', modality: 'chat' },
    { name: 'light', api_model_id: 'light-plain', api_model_id_confidence: 'literal_text', modality: 'chat' },
    { name: 'tts', api_model_id: 'tts-model', api_model_id_confidence: 'literal_text', modality: 'text-to-speech' }
  ] }] }));
  var provA = JSON.parse(fs.readFileSync(CAT2, 'utf8')).providers[0];
  ok(registry.pickProbeModel(provA, { overridesPath: path.join(FIXTURES, 'no-such-overrides.json') }).api_model_id === 'heavy-agentic',
    'without an override the first confirmed chat model is used (table order)');
  fs.writeFileSync(OVR, JSON.stringify({ providers: { 'provider-a': { preferred_chat_model: 'light-plain' } } }));
  ok(registry.pickProbeModel(provA, { overridesPath: OVR }).api_model_id === 'light-plain', 'an official preferred_chat_model wins the probe');
  var prefRows = registry.listEntries(opts({ catalogPath: CAT2, overridesPath: OVR })).filter(function (r) { return r.provider_id === 'provider-a'; });
  ok(prefRows[0].model_id === 'light-plain' && prefRows[0].preferred === true && prefRows.length === 3, 'listEntries leads with the preferred model (so the selector picks it) and keeps every row');
  fs.writeFileSync(OVR, JSON.stringify({ providers: { 'provider-a': { preferred_chat_model: 'tts-model' } } }));
  ok(registry.pickProbeModel(provA, { overridesPath: OVR }).api_model_id === 'heavy-agentic', 'a preference naming a non-chat model is ignored — an override can never invent a chat model');
  fs.writeFileSync(OVR, JSON.stringify({ providers: { 'provider-a': { preferred_chat_model: 'ghost' } } }));
  ok(registry.pickProbeModel(provA, { overridesPath: OVR }).api_model_id === 'heavy-agentic', 'a preference the catalog does not confirm is ignored');
  var realOv = registry.loadOverrides();
  var realCat = JSON.parse(fs.readFileSync(path.join(EXEC, 'free-llm', 'catalog.json'), 'utf8'));
  var realGroq = realCat.providers.filter(function (p) { return p.id === 'groq'; })[0];
  ok(realOv.providers.groq && realOv.providers.groq.preferred_chat_model === 'openai/gpt-oss-120b' && registry.preferredChatModel(realGroq, realOv) !== null,
    'the committed Groq preference (openai/gpt-oss-120b) is a catalog-confirmed chat model');

  // ---------------------------------------------------------------- 5. listEntries shape
  var rows = registry.listEntries(opts());
  ok(rows.length === 3, 'listEntries returns one row per {provider, model} pair (' + rows.length + ')');
  var a = rows.find(function (r) { return r.provider_id === 'provider-a'; });
  ok(a.wired === true && a.credential_present === true, 'provider-a: wired + credential_present reflect the fixture');
  ok(a.health.status === 'quota_exhausted', 'provider-a: listEntries surfaces the persisted health status');
  var c = rows.find(function (r) { return r.provider_id === 'provider-c-unwired'; });
  ok(c.wired === false && c.credential_present === null,
    'provider-c: unwired providers report credential_present=null (not tracked), never a false negative');
  var b = rows.find(function (r) { return r.provider_id === 'provider-b-no-confirmed-model'; });
  ok(b.model_id === null && b.model_id_confidence === 'unconfirmed',
    'provider-b: an unconfirmed catalog model id is surfaced honestly, never invented');
}).then(function () {
  // ---------------------------------------------------------------- 6. reliability matrix (OTHMODE V1 §6):
  // timeout / invalid key / forbidden / 5xx / garbage body — Othmode never
  // crashes, every case lands in a named state with a safe reason, and the
  // credential value never enters the record.
  function probeWith(transport) { return registry.checkProviderHealth('provider-a', opts({ transport: transport })); }
  return probeWith(function () { return Promise.reject(new Error('request timed out')); }).then(function (r) {
    ok(r.status === 'degraded' && /timed out/.test(r.last_failure_reason), 'provider timeout -> degraded (transient), reason recorded');
    return probeWith(function () { return Promise.resolve({ status: 401, body: JSON.stringify({ error: { message: 'Invalid API Key' } }) }); });
  }).then(function (r) {
    ok(r.status === 'invalid_credentials' && /401/.test(r.last_failure_reason), 'invalid API key (401) -> invalid_credentials with the HTTP reason, never a crash');
    ok(JSON.stringify(r).indexOf('sk-fixture') === -1, 'the health record never carries the credential value');
    return probeWith(function () { return Promise.resolve({ status: 403, body: 'forbidden' }); });
  }).then(function (r) {
    ok(r.status === 'invalid_credentials', 'forbidden (403) -> invalid_credentials (the key was rejected, not the service down)');
    return probeWith(function () { return Promise.resolve({ status: 500, body: 'Internal Server Error' }); });
  }).then(function (r) {
    ok(r.status === 'degraded', 'provider 500 -> degraded (transient), retried on the next tick');
    return probeWith(function () { return Promise.resolve({ status: 200, body: 'not json at all' }); });
  }).then(function (r) {
    ok(r.status === 'unavailable' && /unparseable/.test(r.last_failure_reason), 'a garbage 200 body -> unavailable with a clear reason');
    return probeWith(function () { return Promise.resolve({ status: 200, body: JSON.stringify({ model: 'model-a', choices: [{ message: { content: 'ok' } }] }) }); });
  }).then(function (r) {
    ok(r.status === 'active' && r.consecutive_failures === 0, 'recovery: the first success after a failure run resets the counter and returns to active');
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
