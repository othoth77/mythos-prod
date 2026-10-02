'use strict';
// =====================================================
// MYTHOS OS v4 — test harness
// tests/support/mythos-os-v4-harness.js
//
// Everything the v4 suites share. Nothing here fakes the code under test:
// it stands up the things OUTSIDE it —
//
//   * a per-run home under the user's home directory (never /tmp, never a
//     real store), exported through the same environment variables
//     production reads;
//   * real HTTP servers on loopback that speak the OpenAI-compatible
//     chat-completions shape (a free provider, the local llama-server), so
//     the real adapters and the real transports are exercised;
//   * an executable `claude` stand-in that reads its script from a file and
//     records every invocation, so lib/claude-cli.js spawns a real process.
//
// setup() must run BEFORE any project module is required: several of them
// resolve their directories from the environment when they load.
// =====================================================

var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');

var BASE = path.join(__dirname, '..', '..');
var V4 = path.join(BASE, 'projects', 'mythos-os-v4');

function setup(name) {
  var root = path.join(os.homedir(), 'mythos-os-v4-test-' + name + '-' + process.pid);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  var dirs = {
    root: root,
    osHome: path.join(root, 'os-home'),
    executorHome: path.join(root, 'executor-home'),
    freeKeys: path.join(root, 'free-llm-keys'),
    bin: path.join(root, 'bin')
  };
  Object.keys(dirs).forEach(function (k) { fs.mkdirSync(dirs[k], { recursive: true }); });
  process.env.MYTHOS_OS_HOME = dirs.osHome;
  process.env.MYTHOS_EXECUTOR_HOME = dirs.executorHome;
  process.env.MYTHOS_FREE_LLM_KEY_DIR = dirs.freeKeys;
  delete process.env.MYTHOS_OS_POLICY;
  delete process.env.MYTHOS_OS_JEV_MODELS;
  return dirs;
}

function cleanup(dirs) {
  try { fs.rmSync(dirs.root, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

// ---- assertions -----------------------------------------------------------
function counter(label) {
  var c = { passed: 0, failed: 0, failures: [] };
  c.ok = function (cond, name) {
    if (cond) { c.passed++; console.log('ok - ' + name); }
    else { c.failed++; c.failures.push(name); console.error('FAIL: ' + name); }
  };
  c.eq = function (actual, expected, name) {
    var same = JSON.stringify(actual) === JSON.stringify(expected);
    if (!same) console.error('   expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    c.ok(same, name);
  };
  c.finish = function (dirs) {
    if (dirs) cleanup(dirs);
    console.log('\n' + label + ': ' + c.passed + ' passed, ' + c.failed + ' failed');
    if (c.failed) { console.error('Failures:\n - ' + c.failures.join('\n - ')); process.exit(1); }
    process.exit(0);
  };
  c.crash = function (dirs) {
    return function (e) {
      if (dirs) cleanup(dirs);
      console.error('suite crashed: ' + (e && e.stack || e));
      process.exit(1);
    };
  };
  return c;
}

// ---- a controllable clock -------------------------------------------------
function clock() {
  var offset = 0;
  var now = function () { return Date.now() + offset; };
  now.advance = function (seconds) { offset += seconds * 1000; };
  return now;
}

// ---- policy / registry ----------------------------------------------------
function policy(overrides) {
  var p = JSON.parse(fs.readFileSync(path.join(V4, 'config', 'dots-policy.json'), 'utf8'));
  Object.keys(overrides || {}).forEach(function (section) {
    p[section] = Object.assign({}, p[section], overrides[section]);
  });
  return p;
}

function registry() {
  return JSON.parse(fs.readFileSync(path.join(V4, 'config', 'jev-models.json'), 'utf8'));
}

// ---- loopback OpenAI-compatible server -------------------------------------
// behaviour: a function (req, body) -> { status, body|json, hang } evaluated
// per request, so a test changes it between calls.
function startServer(behaviour) {
  var state = { calls: [], behaviour: behaviour, sockets: [] };
  var server = http.createServer(function (req, res) {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      var raw = Buffer.concat(chunks).toString('utf8');
      var parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
      state.calls.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body: parsed });
      var answer = state.behaviour(req, parsed) || { status: 404, json: { error: 'not found' } };
      if (answer.hang) return; // never answer: the caller's timeout must end it
      res.writeHead(answer.status, { 'Content-Type': 'application/json' });
      res.end(answer.body !== undefined ? answer.body : JSON.stringify(answer.json));
    });
  });
  server.on('connection', function (s) { state.sockets.push(s); });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      state.port = server.address().port;
      state.url = 'http://127.0.0.1:' + state.port;
      state.close = function () {
        state.sockets.forEach(function (s) { try { s.destroy(); } catch (e) { /* gone */ } });
        return new Promise(function (r) { server.close(function () { r(); }); });
      };
      resolve(state);
    });
  });
}

function chatAnswer(text, model) {
  return { status: 200, json: { model: model || 'fixture-model', choices: [{ message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 5, completion_tokens: 5 } } };
}

// An llama-server stand-in: /health, /v1/models, /v1/chat/completions.
function qwenBehaviour(control) {
  return function (req) {
    if (control.down) return { hang: false, status: 503, json: { error: { message: 'Service Unavailable 503' } } };
    if (req.url === '/health') return { status: control.unhealthy ? 503 : 200, json: { status: control.unhealthy ? 'loading' : 'ok' } };
    if (req.url === '/v1/models') return { status: 200, json: { data: [{ id: 'qwen-fixture.gguf' }] } };
    if (req.url === '/v1/chat/completions') {
      if (control.hang) return { hang: true };
      if (control.status) return { status: control.status, json: { error: { message: control.message || 'error ' + control.status } } };
      return chatAnswer(control.text === undefined ? 'qwen says hello' : control.text, 'qwen-fixture.gguf');
    }
    return null;
  };
}

// ---- free-LLM fixture: catalog + endpoints + key files ----------------------
// providers: [{ id, url }] — each becomes one wired, keyed free provider with
// one confirmed chat model. The "keys" are plain fixture words.
function freeLlmFixture(dirs, providers) {
  var catalog = {
    catalog_version: 'fixture', providers: providers.map(function (p) {
      return {
        id: p.id, name: p.id, homepage: 'https://example.invalid/' + p.id, category: 'free', access_type: 'free_tier',
        requirements: ['signup'], models: [{ name: 'Fixture Chat', api_model_id: p.id + '/chat-fixture', api_model_id_confidence: 'literal_text', modality: 'chat' }]
      };
    })
  };
  var endpoints = { providers: {} };
  providers.forEach(function (p) {
    endpoints.providers[p.id] = { base_url: p.url + '/v1', wired: true };
    var envVar = 'MYTHOS_FREE_LLM_' + p.id.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY';
    fs.writeFileSync(path.join(dirs.freeKeys, p.id + '.env'), envVar + '=fixture-' + p.id + '\n', { mode: 0o600 });
  });
  var catalogPath = path.join(dirs.root, 'free-catalog.json');
  var endpointsPath = path.join(dirs.root, 'free-endpoints.json');
  var overridesPath = path.join(dirs.root, 'free-overrides.json');
  fs.writeFileSync(catalogPath, JSON.stringify(catalog));
  fs.writeFileSync(endpointsPath, JSON.stringify(endpoints));
  fs.writeFileSync(overridesPath, JSON.stringify({ providers: {} }));
  return { catalogPath: catalogPath, endpointsPath: endpointsPath, overridesPath: overridesPath, healthPath: path.join(dirs.root, 'free-health.json') };
}

// ---- the `claude` stand-in --------------------------------------------------
// A real executable. Its behaviour comes from <bin>/fake-claude.json:
//   { "by_model": { "<model id>": [ <response>, ... ] }, "default": <response> }
// Each call takes the next response queued for its --model (the last one
// repeats). A response is one of:
//   { "result": "text", "served_by": ["model-id"] }     a normal answer
//   { "error": "text" }                                  is_error:true
//   { "raw": "not json", "exit": 0 }                     garbage on stdout
//   { "hang": true }                                     never answers
// Every call is appended to <bin>/fake-claude-calls.jsonl (argv, stdin, env keys).
var FAKE_CLAUDE_SOURCE = [
  '#!/usr/bin/env node',
  "'use strict';",
  "var fs = require('fs');",
  "var path = require('path');",
  "var dir = __dirname;",
  "var argv = process.argv.slice(2);",
  "var model = argv[argv.indexOf('--model') + 1];",
  "var input = '';",
  "process.stdin.on('data', function (c) { input += c; });",
  "process.stdin.on('end', function () {",
  "  var scriptFile = path.join(dir, 'fake-claude.json');",
  "  var script = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));",
  "  var queue = (script.by_model && script.by_model[model]) || null;",
  "  var r = queue && queue.length ? (queue.length > 1 ? queue.shift() : queue[0]) : (script.default || { error: 'no scripted response' });",
  "  fs.writeFileSync(scriptFile, JSON.stringify(script));",
  "  fs.appendFileSync(path.join(dir, 'fake-claude-calls.jsonl'), JSON.stringify({ argv: argv, model: model, stdin: input, cwd: process.cwd(), env_keys: Object.keys(process.env).sort() }) + '\\n');",
  "  if (r.hang) { setInterval(function () {}, 1000); return; }",
  "  if (r.raw !== undefined) { process.stdout.write(String(r.raw)); process.exit(r.exit || 0); }",
  "  var usage = {};",
  "  (r.served_by || [model]).forEach(function (m) { usage[m] = { inputTokens: 1, outputTokens: 1 }; });",
  "  var out = { type: 'result', is_error: r.error !== undefined, result: r.error !== undefined ? r.error : r.result, modelUsage: usage, total_cost_usd: 0.001 };",
  "  process.stdout.write(JSON.stringify(out));",
  "  process.exit(r.error !== undefined ? 1 : 0);",
  "});"
].join('\n');

function fakeClaude(dirs) {
  var bin = path.join(dirs.bin, 'claude');
  fs.writeFileSync(bin, FAKE_CLAUDE_SOURCE + '\n', { mode: 0o755 });
  var scriptFile = path.join(dirs.bin, 'fake-claude.json');
  var callsFile = path.join(dirs.bin, 'fake-claude-calls.jsonl');
  var api = {
    bin: bin,
    script: function (script) { fs.writeFileSync(scriptFile, JSON.stringify(script)); },
    calls: function () {
      try { return fs.readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); }); } catch (e) { return []; }
    },
    reset: function () { try { fs.unlinkSync(callsFile); } catch (e) { /* none */ } }
  };
  api.script({ default: { error: 'no scripted response' } });
  return api;
}

// ---- a scripted executive engine (for suites that test what sits above it) --
// queue: array of outcomes; each is a directive object (ok) or
// { fail: 'CODE' }. The last entry repeats.
function scriptedEngine(id, queue, opts) {
  opts = opts || {};
  var engine = {
    id: id, calls: [], queue: queue, up: opts.up !== false,
    available: function () { return { ok: engine.up, detail: engine.up ? 'scripted' : 'scripted: down' }; },
    call: function (req) {
      engine.calls.push(req);
      var next = engine.queue.length > 1 ? engine.queue.shift() : engine.queue[0];
      if (typeof next === 'function') next = next(req);
      if (!next || next.fail) {
        return Promise.resolve({ ok: false, value: null, error: { code: (next && next.fail) || 'CLI_ERROR', detail: null }, model_measured: null, duration_ms: 1 });
      }
      return Promise.resolve({ ok: true, value: JSON.parse(JSON.stringify(next)), error: null, model_measured: id === 'fable' ? 'claude-fable-5-1' : 'gpt-fixture', duration_ms: 1 });
    }
  };
  return engine;
}

function directive(decision, fields) {
  return Object.assign({ decision: decision, rationale: 'fixture', steps: [], final_answer: null, escalation_reason: null }, fields || {});
}

function step(id, kind, action, instruction, extra) {
  return Object.assign({ id: id, kind: kind, action: action, instruction: instruction || 'Explain X.', acceptance: [], timeout_seconds: 60 }, extra || {});
}

module.exports = {
  BASE: BASE, V4: V4,
  setup: setup, cleanup: cleanup, counter: counter, clock: clock, policy: policy, registry: registry,
  startServer: startServer, chatAnswer: chatAnswer, qwenBehaviour: qwenBehaviour, freeLlmFixture: freeLlmFixture,
  fakeClaude: fakeClaude, scriptedEngine: scriptedEngine, directive: directive, step: step
};
