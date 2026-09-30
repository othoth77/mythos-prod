#!/usr/bin/env node
'use strict';
// =====================================================
// Free LLM Resources — one-shot text completion CLI
// projects/mythos-ai-executor/free-llm/bin/free-llm-complete.js
//
// A thin command-line front to the EXISTING selector.complete() (same
// catalog, same keys, same health ranking, same A -> B -> C fallback) for
// consumers outside this Node process — first user: the Ads Mythos
// dashboard's short read-only explanations. It adds no provider logic of
// its own; it is to selector.js what free-llm-health.js is to registry.js.
//
//   echo '{"system":"…","prompt":"…","only":["groq"],"exclude":[],"timeout_ms":10000,"deadline_ms":20000}' \
//     | node free-llm-complete.js --state-dir <absolute dir>
//
// stdout: ONE JSON line
//   { ok, text?, provider_id?, model_id?, reason?, attempts: [{provider_id, status, timed_out, http_status}] }
// Never prints a key, a request header or a provider's raw error text.
// Exit 0 whenever a JSON answer was written (ok true or false); 2 = bad input.
// timeout_ms bounds each provider attempt; deadline_ms bounds the whole
// call (the CLI answers {ok:false, reason:"DEADLINE"} itself, so a caller's
// kill never lands mid-write).
//
// --state-dir <dir> (REQUIRED): private health + reputation ledgers for the
// consumer, seeded from the executor's shared health file, which is only
// READ — so a consumer never writes into the executor's own store.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var MAX_PROMPT = 6000;
var MAX_SYSTEM = 3000;
var DEFAULT_TIMEOUT_MS = 25000;
var MAX_DEADLINE_MS = 120000;
// Captured before --state-dir redirects MYTHOS_EXECUTOR_HOME: the executor's
// own store, same resolution as registry.js / core/store.js.
var SHARED_HOME = process.env.MYTHOS_EXECUTOR_HOME || path.join(os.homedir(), 'mythos-ai-executor');

function fail(code, message) {
  process.stdout.write(JSON.stringify({ ok: false, reason: message, attempts: [] }) + '\n');
  process.exit(code);
}

function sharedHealthFile() {
  return path.join(SHARED_HOME, 'free-llm', 'health.json');
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

// Newest record per provider wins, so the private ledger starts from what the
// executor already knows (e.g. a provider that is quota-exhausted right now).
function seedHealth(privatePath) {
  var shared = readJson(sharedHealthFile(), {});
  var own = readJson(privatePath, {});
  var merged = {};
  Object.keys(shared).concat(Object.keys(own)).forEach(function (id) {
    var a = shared[id], b = own[id];
    var ta = a && a.last_checked ? Date.parse(a.last_checked) : 0;
    var tb = b && b.last_checked ? Date.parse(b.last_checked) : 0;
    merged[id] = tb >= ta ? (b || a) : a;
  });
  fs.mkdirSync(path.dirname(privatePath), { recursive: true, mode: 0o700 });
  var tmp = privatePath + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(merged), { mode: 0o600 });
  fs.renameSync(tmp, privatePath);
}

function validate(req) {
  if (!req || typeof req !== 'object') return 'request must be a JSON object';
  if (typeof req.prompt !== 'string' || !req.prompt.trim()) return 'prompt required';
  if (req.prompt.length > MAX_PROMPT) return 'prompt too long';
  if (req.system !== undefined && (typeof req.system !== 'string' || req.system.length > MAX_SYSTEM)) return 'system invalid';
  ['only', 'exclude'].forEach(function (k) {
    if (req[k] !== undefined && req[k] !== null && (!Array.isArray(req[k]) || req[k].some(function (x) { return typeof x !== 'string'; }))) {
      req._invalid = k + ' must be a list of provider ids';
    }
  });
  return req._invalid || null;
}

// run(request, opts) -> Promise<answer>. Exported for tests (transport /
// secretsOpts / healthPath injection); the CLI below is a wrapper.
function run(req, opts) {
  return Promise.resolve().then(function () { return runInner(req, opts || {}); }).catch(function (err) {
    return { ok: false, reason: 'FREE_LLM_INTERNAL: ' + (err && err.code ? err.code : 'error'), attempts: [] };
  });
}

function runInner(req, opts) {
  var selector = require('../selector');
  var common = { healthPath: opts.healthPath, catalogPath: opts.catalogPath, endpointsPath: opts.endpointsPath, secretsOpts: opts.secretsOpts };
  var exclude = Array.isArray(req.exclude) ? req.exclude.slice() : [];
  if (Array.isArray(req.only)) {
    selector.selectCandidates({ modality: 'chat' }, common).forEach(function (c) {
      if (req.only.indexOf(c.provider_id) === -1 && exclude.indexOf(c.provider_id) === -1) exclude.push(c.provider_id);
    });
  }
  var timeout = Math.max(1000, Math.min(Number(req.timeout_ms) || DEFAULT_TIMEOUT_MS, 60000));
  return selector.complete(req.prompt, Object.assign({}, common, {
    requirements: { modality: 'chat' },
    systemPrompt: req.system,
    timeoutMs: timeout,
    exclude: exclude,
    transport: opts.transport
  })).then(function (r) {
    var attempts = (r.attempts || []).map(function (a) {
      return { provider_id: a.provider_id, status: a.status, timed_out: !!a.timed_out, http_status: a.http_status };
    });
    if (r.ok) return { ok: true, text: String(r.text || ''), provider_id: r.provider_id, model_id: r.model_id, attempts: attempts };
    return { ok: false, reason: r.reason, attempts: attempts };
  }, function (err) {
    return { ok: false, reason: 'FREE_LLM_INTERNAL: ' + (err && err.code ? err.code : 'error'), attempts: [] };
  });
}

module.exports = { run: run, validate: validate, seedHealth: seedHealth };

if (require.main === module) {
  var argv = process.argv.slice(2);
  var i = argv.indexOf('--state-dir');
  var opts = {};
  var dir = i === -1 ? null : argv[i + 1];
  if (!dir || !path.isAbsolute(dir)) fail(2, '--state-dir <absolute path> is required');
  // reputation (core/store.js root) and health both go to the private dir
  process.env.MYTHOS_EXECUTOR_HOME = dir;
  opts.healthPath = path.join(dir, 'free-llm', 'health.json');
  try { seedHealth(opts.healthPath); } catch (e) { fail(2, 'state dir not writable'); }
  var input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (c) { input += c; if (input.length > 64 * 1024) fail(2, 'request too large'); });
  process.stdin.on('end', function () {
    var req;
    try { req = JSON.parse(input); } catch (e) { fail(2, 'request is not JSON'); }
    var bad = validate(req);
    if (bad) fail(2, bad);
    var deadline = Math.max(1000, Math.min(Number(req.deadline_ms) || MAX_DEADLINE_MS, MAX_DEADLINE_MS));
    var done = false;
    function answer(a) {
      if (done) return;
      done = true;
      process.stdout.write(JSON.stringify(a) + '\n');
      process.exit(0);
    }
    setTimeout(function () { answer({ ok: false, reason: 'DEADLINE', attempts: [] }); }, deadline).unref();
    run(req, opts).then(answer);
  });
}
