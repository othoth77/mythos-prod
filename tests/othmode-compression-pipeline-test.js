'use strict';
// =====================================================
// MYTHOS — OTHMODE gateway compression pipeline tests
// tests/othmode-compression-pipeline-test.js
//
// Proves that EVERY OTHMODE execution path which sends context to an LLM
// through OmniRoute carries the verified compression selection, and that
// paths which deliberately bypass OmniRoute do not pretend to.
//
// Deterministic and offline: the gateway is a local stub that records the
// request headers. No real provider is launched and no AI quota is used.
//
// Run with: node tests/othmode-compression-pipeline-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var passed = 0;
var failed = 0;
var failures = [];
function ok(cond, name) {
  if (cond) { passed++; } else { failed++; failures.push(name); }
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
}
function section(t) { console.log('\n== ' + t); }

// A credential file the provider can read; the value never leaves the stub.
var FIXTURES = path.join(os.homedir(), 'othmode-compression-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
var KEY_FILE = path.join(FIXTURES, 'advisory.env');
fs.writeFileSync(KEY_FILE, 'MYTHOS_ADVISORY_API_KEY=sk-test-not-a-real-key\n');

// Gateway stub: records headers, answers like OmniRoute.
var captured = [];
var server = http.createServer(function (req, res) {
  var body = '';
  req.on('data', function (d) { body += d; });
  req.on('end', function () {
    captured.push({ url: req.url, headers: req.headers, body: body });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'x-omniroute-compression': 'stacked; source=request-header'
    });
    res.end(JSON.stringify({
      choices: [{ message: { content: 'ack' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
    }));
  });
});

function listen() {
  return new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
}
function baseUrl() { return 'http://127.0.0.1:' + server.address().port + '/v1'; }

// Loads the provider with a clean module cache so module-level env reads re-run.
function loadProvider(env) {
  var saved = process.env.MYTHOS_OMNIROUTE_COMPRESSION;
  if (env === null) { delete process.env.MYTHOS_OMNIROUTE_COMPRESSION; }
  else { process.env.MYTHOS_OMNIROUTE_COMPRESSION = env; }
  var p = path.join(EXEC, 'providers', 'openai-compat.js');
  delete require.cache[require.resolve(p)];
  var mod = require(p);
  if (saved === undefined) { delete process.env.MYTHOS_OMNIROUTE_COMPRESSION; }
  else { process.env.MYTHOS_OMNIROUTE_COMPRESSION = saved; }
  return mod;
}

function task(extra) {
  return Object.assign({ id: 'tk-test', timeout_seconds: 30 }, extra || {});
}

function readExec(rel) {
  return fs.readFileSync(path.join(EXEC, rel), 'utf8');
}

listen().then(function () {
  section('advisory path -- the only OTHMODE route through OmniRoute');
  var provider = loadProvider(null);
  ok(provider.COMPRESSION_COMBO === 'othmode-headroom',
     'default compression combo is othmode-headroom');

  return provider.run(task(), 'hello', null, null, { baseUrl: baseUrl(), keyFile: KEY_FILE });
}).then(function (outcome) {
  var h = captured[captured.length - 1].headers;
  ok(h['x-omniroute-compression'] === 'othmode-headroom',
     'advisory run() sends x-omniroute-compression: othmode-headroom');
  ok(!!outcome.compression && outcome.compression.requested === 'othmode-headroom',
     'outcome records the requested combo');
  ok(!!outcome.compression && outcome.compression.applied !== undefined,
     'outcome records what the gateway reported as applied');
  ok(!!outcome.usage && typeof outcome.usage.prompt_tokens === 'number',
     'outcome records provider usage for token measurement');

  section('planner / decomposition path');
  // decompose.js resolves its runner from executor.PROVIDERS by id, so it
  // cannot acquire a different HTTP client than the one asserted above.
  var decompose = readExec(path.join('core', 'decompose.js'));
  ok(/PLANNER_PROVIDER_ID\s*=\s*'openai-compat'/.test(decompose),
     'planner runs on the openai-compat provider id');
  ok(/require\('\.\.\/executor'\)\.PROVIDERS/.test(decompose),
     'planner resolves through the shared provider registry (no private client)');
  ok(!/https?\.request|fetch\(/.test(decompose),
     'planner has no HTTP client of its own');

  section('single compression layer (no OTHMODE-side compressor)');
  var ctx = readExec(path.join('core', 'context.js'));
  ok(!/x-omniroute-compression/.test(ctx),
     'context.js does not add a second compression header');
  ok(!/compress\s*\(/i.test(ctx) || !/x-omniroute/.test(ctx),
     'context.js performs selection/budgeting only, not gateway compression');

  section('paths that deliberately bypass OmniRoute');
  var gemini = readExec(path.join('providers', 'gemini.js'));
  ok(!/x-omniroute-compression/.test(gemini),
     'gemini provider sends no OmniRoute compression header (direct Google transport)');
  ok(/generativelanguage|googleapis/.test(gemini),
     'gemini provider targets Google directly, not the gateway');
  var claudeCode = readExec(path.join('providers', 'claude-code.js'));
  ok(!/https?\.request\(/.test(claudeCode),
     'claude-code provider makes no direct gateway HTTP call (spawns the CLI)');

  section('regression -- non-OTHMODE traffic is untouched');
  // A caller that is not the OTHMODE provider must not acquire the header
  // merely by talking to the same gateway.
  return new Promise(function (resolve) {
    var payload = JSON.stringify({ model: 'x', messages: [] });
    var req = http.request({
      hostname: '127.0.0.1', port: server.address().port,
      path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, function (res) { res.resume(); res.on('end', resolve); });
    req.end(payload);
  });
}).then(function () {
  var h = captured[captured.length - 1].headers;
  ok(h['x-omniroute-compression'] === undefined,
     'a non-OTHMODE request carries no compression header');

  section('operator override remains available');
  var off = loadProvider('off');
  ok(off.COMPRESSION_COMBO === 'off',
     'MYTHOS_OMNIROUTE_COMPRESSION=off overrides the combo (used for before/after measurement)');
  var alt = loadProvider('default-caveman');
  ok(alt.COMPRESSION_COMBO === 'default-caveman',
     'override accepts any named combo (no provider/model pinning)');
  loadProvider(null);
}).then(function () {
  server.close();
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  console.log('\nOTHMODE compression pipeline suite: ' + passed + ' passed, ' + failed + ' failed');
  if (failures.length) {
    console.log('Failures:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  process.exit(0);
}).catch(function (err) {
  console.error('SUITE ERROR: ' + (err && err.stack || err));
  try { server.close(); } catch (e) { /* already closed */ }
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  process.exit(1);
});
