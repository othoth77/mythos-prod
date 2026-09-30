'use strict';
// =====================================================
// Free LLM Resources — one-shot completion CLI tests
// tests/free-llm-complete-cli-test.js
//
// bin/free-llm-complete.js is a thin front to selector.complete(): the
// same fallback, the same health ledger shape. Offline: every HTTP call is
// injected, keys/catalog/health live in a temp dir under $HOME (removed at
// the end) — never the real executor store (tests-can-write-production-defaults).
// Run with: node tests/free-llm-complete-cli-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var FIXTURES = fs.mkdtempSync(path.join(os.homedir(), 'free-llm-complete-test-'));
var KEY_DIR = path.join(FIXTURES, 'keys');
fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
process.env.MYTHOS_FREE_LLM_KEY_DIR = KEY_DIR;
process.env.MYTHOS_EXECUTOR_HOME = FIXTURES;

var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var BIN = path.join(EXEC, 'free-llm', 'bin', 'free-llm-complete.js');
var cli = require(BIN);

var passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.error('FAIL: ' + name); } }

var CATALOG_PATH = path.join(FIXTURES, 'catalog.json');
var ENDPOINTS_PATH = path.join(FIXTURES, 'endpoints.json');
var HEALTH_PATH = path.join(FIXTURES, 'health.json');
function provider(id) {
  return { id: id, name: id, homepage: 'https://' + id + '.example', category: 'free', access_type: 'free_tier', requirements: ['signup'],
    data_policy_note: null, official: null, limits_text: null,
    models: [{ name: id + '-model', api_model_id: id + '-model', api_model_id_confidence: 'literal_text', limits_text: null, modality: 'chat' }] };
}
fs.writeFileSync(CATALOG_PATH, JSON.stringify({ providers: [provider('alpha'), provider('groq')] }));
fs.writeFileSync(ENDPOINTS_PATH, JSON.stringify({ providers: { alpha: { base_url: 'https://alpha.example/v1', wired: true }, groq: { base_url: 'https://groq.example/v1', wired: true } } }));
['alpha', 'groq'].forEach(function (id) {
  fs.writeFileSync(path.join(KEY_DIR, id + '.env'), 'MYTHOS_FREE_LLM_' + id.toUpperCase() + '_API_KEY=sk-fixture-secret-' + id + '\n', { mode: 0o600 });
});
var base = { catalogPath: CATALOG_PATH, endpointsPath: ENDPOINTS_PATH, healthPath: HEALTH_PATH };

function transportWith(map, seen) {
  return function (reqOpts, body) {
    var id = /alpha/.test(reqOpts.url) ? 'alpha' : 'groq';
    seen.push({ id: id, auth: reqOpts.headers.Authorization, body: body });
    var r = map[id];
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
}
var OK = function (t) { return { status: 200, body: JSON.stringify({ model: 'x', choices: [{ message: { content: t } }] }) }; };

(async function main() {
  // 1. validation
  ok(cli.validate({ prompt: 'x' }) === null, 'minimal request is valid');
  ok(cli.validate({}) !== null && cli.validate({ prompt: 'x'.repeat(7000) }) !== null, 'empty / oversized prompt refused');
  ok(cli.validate({ prompt: 'x', only: 'groq' }) !== null, 'only must be a list');

  // 2. pool first (groq excluded) — alpha answers
  var seen = [];
  var a = await cli.run({ prompt: 'p', system: 's', exclude: ['groq'] }, Object.assign({ transport: transportWith({ alpha: OK('from alpha') }, seen) }, base));
  ok(a.ok && a.provider_id === 'alpha' && a.text === 'from alpha', 'pool answer returned');
  ok(seen.every(function (s) { return s.id === 'alpha'; }), 'excluded provider never called');

  // 3. only groq (the fallback call)
  seen = [];
  var g = await cli.run({ prompt: 'p', only: ['groq'] }, Object.assign({ transport: transportWith({ alpha: OK('no'), groq: OK('from groq') }, seen) }, base));
  ok(g.ok && g.provider_id === 'groq' && seen.length === 1 && seen[0].id === 'groq', 'only=[groq] calls groq alone');
  ok(seen[0].auth === 'Bearer sk-fixture-secret-groq', 'the key is used in the request header (inside this process)');
  ok(JSON.stringify(g).indexOf('sk-fixture') === -1, 'the answer never contains a key');

  // 4. failure: sanitized attempts, no provider error text
  seen = [];
  var f = await cli.run({ prompt: 'p', only: ['groq'] }, Object.assign({ transport: transportWith({ groq: { status: 401, body: JSON.stringify({ error: { message: 'Invalid API Key sk-fixture-secret-groq' } }) } }, seen) }, base));
  ok(f.ok === false && f.reason === 'ALL_CANDIDATES_FAILED', 'total failure resolves ok:false');
  ok(f.attempts.length === 1 && Object.keys(f.attempts[0]).sort().join(',') === 'http_status,provider_id,status,timed_out', 'attempts carry status fields only');
  ok(JSON.stringify(f).indexOf('Invalid API Key') === -1 && JSON.stringify(f).indexOf('sk-fixture') === -1, 'provider error text and keys never leave the CLI');
  var none = await cli.run({ prompt: 'p', only: ['nobody'] }, Object.assign({ transport: transportWith({}, []) }, base));
  ok(none.ok === false && none.reason === 'NO_CANDIDATE_AVAILABLE', 'no candidate → ok:false, no call');
  ok(JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8')).groq.status === 'invalid_credentials', 'a 401 marks the provider invalid_credentials in the ledger, so the selector stops offering it (shared behaviour)');
  fs.rmSync(HEALTH_PATH, { force: true });   // fresh ledger for the timeout case
  var net = await cli.run({ prompt: 'p', only: ['groq'] }, Object.assign({ transport: transportWith({ groq: new Error('request timed out') }, []) }, base));
  ok(net.ok === false && net.attempts[0].timed_out === true, 'timeout reported as timed_out');

  // 5. private health ledger seeded from the shared one (shared file only read)
  var sharedDir = path.join(os.homedir(), 'mythos-ai-executor', 'free-llm');
  var priv = path.join(FIXTURES, 'priv', 'free-llm', 'health.json');
  fs.mkdirSync(path.dirname(priv), { recursive: true });
  fs.writeFileSync(priv, JSON.stringify({ zeta: { status: 'active', last_checked: '2099-01-01T00:00:00Z' } }));
  var before = fs.existsSync(path.join(sharedDir, 'health.json')) ? fs.statSync(path.join(sharedDir, 'health.json')).mtimeMs : null;
  cli.seedHealth(priv);
  var merged = JSON.parse(fs.readFileSync(priv, 'utf8'));
  ok(merged.zeta && merged.zeta.status === 'active', 'private records kept when newer');
  var after = fs.existsSync(path.join(sharedDir, 'health.json')) ? fs.statSync(path.join(sharedDir, 'health.json')).mtimeMs : null;
  ok(before === after, 'shared health file is never written');

  // 6. real CLI: bad input exits 2 with a JSON answer and no network
  var bad = cp.spawnSync(process.execPath, [BIN, '--state-dir', path.join(FIXTURES, 'cli')], { input: 'not json', encoding: 'utf8', timeout: 20000 });
  ok(bad.status === 2 && JSON.parse(bad.stdout).ok === false, 'non-JSON input → exit 2 + JSON answer');
  var rel = cp.spawnSync(process.execPath, [BIN, '--state-dir', 'relative/dir'], { input: '{"prompt":"x"}', encoding: 'utf8', timeout: 20000 });
  ok(rel.status === 2, 'relative --state-dir refused');

  var noDir = cp.spawnSync(process.execPath, [BIN], { input: '{"prompt":"x"}', encoding: 'utf8', timeout: 20000 });
  ok(noDir.status === 2 && JSON.parse(noDir.stdout).ok === false, 'missing --state-dir refused (never falls back to the shared store)');

  // 7. a synchronous selector failure still resolves to JSON
  var broken = await cli.run({ prompt: 'p', only: ['groq'] }, Object.assign({ transport: transportWith({}, []) }, base, { catalogPath: path.join(FIXTURES, 'missing-catalog.json') }));
  ok(broken && broken.ok === false && typeof broken.reason === 'string', 'internal failure → ok:false JSON, no throw');

  fs.rmSync(FIXTURES, { recursive: true, force: true });
  console.log('free-llm-complete-cli-test: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); fs.rmSync(FIXTURES, { recursive: true, force: true }); process.exit(1); });
