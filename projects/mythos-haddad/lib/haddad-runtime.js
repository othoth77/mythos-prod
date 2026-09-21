'use strict';
// =====================================================
// MYTHOS HADDAD — local worker client for the HAD-2 AI runtime
// projects/mythos-haddad/lib/haddad-runtime.js
//
// Lets FABLE (the orchestrator — a Claude session on this machine) hand a
// task to the local Qwen runtime and get back a result it can review.
//
// THIS FILE ADDS NO PROVIDER, TRANSPORT, QUEUE OR REVIEW LOGIC. It binds
// three things that already exist:
//
//   1. the HTTP client — projects/mythos-ai-executor/free-llm/adapter.js,
//      required unmodified. Its own header describes it as "generalised to
//      take {baseUrl, apiKey, model} PER CALL", so a local server needs no
//      catalog entry; nothing in free-llm/{catalog,endpoints}.json is read
//      or written here. It already returns the executor's provider-outcome
//      shape (exit_code / timed_out / parsed / usage …), which is why this
//      file does not define an outcome shape of its own.
//   2. the success oracle — executor.js:680,
//      `parsed && parsed.is_error === false && !timed_out && exit_code === 0`,
//      reimplemented here as one expression (ok()) rather than re-derived,
//      so a result judged "ok" here is judged "ok" by the executor too.
//   3. the repair-feedback convention — core/orchestrator.js:122-135. The
//      correction text FABLE sends on a retry is rendered in the SAME
//      "## REPAIR REQUIRED (attempt N)" form the executor's own repair loop
//      uses, so a task moved onto the executor later needs no reformatting.
//
// Review is deliberately NOT implemented here. FABLE reviews; Qwen answers.
// core/validation.js:176-191 makes reviewer-is-not-author a structural
// invariant, and the one thing a local 7B worker must never be is the judge
// of its own output. The verdict shape FABLE produces ({verdict, findings})
// is core/validation.js's, so wiring it in as that module's `review_fn`
// later is a drop-in.
// =====================================================

var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');

var adapter = require('../../mythos-ai-executor/free-llm/adapter.js');

var DEFAULT_BASE_URL = process.env.HADDAD_RUNTIME_BASE_URL || 'http://127.0.0.1:8600/v1';
var DEFAULT_KEY_FILE = process.env.HADDAD_RUNTIME_KEY_FILE ||
  path.join(os.homedir(), '.config', 'mythos-haddad', 'runtime.key');

// Bounds mirror free-llm/bin/free-llm-complete.js — the existing one-shot
// CLI precedent — rather than inventing a second set of limits.
var MAX_INSTRUCTION = 6000;
var MAX_SYSTEM = 3000;
var MAX_FINDINGS = 20;
var MAX_FINDING_LEN = 500;
var DEFAULT_TIMEOUT_MS = 120000;
var MAX_TIMEOUT_MS = 600000;

// A local, GPU-resident worker is told to answer the task and nothing else.
// It is never told it may act, only that it may answer — this model has no
// execution authority (see docs/FABLE_WORKER.md).
var DEFAULT_SYSTEM = [
  'You are a local worker model. Answer the task directly and completely.',
  'Do not ask follow-up questions. Do not claim to have run commands, edited files,',
  'or tested anything — you cannot. State assumptions explicitly.',
  'If the task cannot be answered from what you were given, say exactly what is missing.'
].join(' ');

function readKey(keyFile) {
  try {
    var text = fs.readFileSync(keyFile || DEFAULT_KEY_FILE, 'utf8').trim();
    return text || null;
  } catch (e) {
    return null;
  }
}

// The runtime serves one model and names it by GGUF filename; asking it
// beats hardcoding a filename that changes when the pinned model changes.
function discoverModel(baseUrl, apiKey, timeoutMs, cb) {
  var u = new URL(String(baseUrl).replace(/\/$/, '') + '/models');
  var req = http.request({
    hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET',
    headers: { Authorization: 'Bearer ' + apiKey }, timeout: timeoutMs
  }, function (res) {
    var body = '';
    res.on('data', function (c) { body += c; });
    res.on('end', function () {
      try {
        var d = JSON.parse(body);
        var id = d && d.data && d.data[0] && d.data[0].id;
        cb(id || null);
      } catch (e) { cb(null); }
    });
  });
  req.on('timeout', function () { req.destroy(); cb(null); });
  req.on('error', function () { cb(null); });
  req.end();
}

// core/orchestrator.js:122-135, verbatim in form. A repairing worker that
// cannot see what was rejected converges only by luck.
function renderRepairNotes(findings, attempt) {
  var list = (findings || [])
    .filter(function (f) { return typeof f === 'string' && f.trim(); })
    .slice(0, MAX_FINDINGS)
    .map(function (f) { return '- ' + f.trim().slice(0, MAX_FINDING_LEN); });
  if (!list.length) return null;
  return '## REPAIR REQUIRED (attempt ' + (attempt || 1) + ')\n' +
    'Your previous attempt was REJECTED by independent review. ' +
    'Fix every finding below in this attempt:\n' + list.join('\n');
}

function buildPrompt(req) {
  var parts = [String(req.instruction)];
  if (req.acceptance_criteria && req.acceptance_criteria.length) {
    parts.push('## ACCEPTANCE CRITERIA\nThe answer is only complete if it satisfies all of:\n' +
      req.acceptance_criteria
        .filter(function (c) { return typeof c === 'string' && c.trim(); })
        .map(function (c) { return '- ' + c.trim().slice(0, MAX_FINDING_LEN); })
        .join('\n'));
  }
  var repair = renderRepairNotes(req.findings, req.attempt);
  if (repair) parts.push(repair);
  return parts.join('\n\n');
}

function validateRequest(req) {
  if (!req || typeof req !== 'object') return 'request must be a JSON object';
  if (typeof req.instruction !== 'string' || !req.instruction.trim()) return 'instruction is required';
  if (req.instruction.length > MAX_INSTRUCTION) return 'instruction too long (max ' + MAX_INSTRUCTION + ')';
  if (req.system !== undefined && (typeof req.system !== 'string' || req.system.length > MAX_SYSTEM)) return 'system invalid';
  if (req.acceptance_criteria !== undefined && !Array.isArray(req.acceptance_criteria)) return 'acceptance_criteria must be an array';
  if (req.findings !== undefined && !Array.isArray(req.findings)) return 'findings must be an array';
  if (req.attempt !== undefined && (!Number.isInteger(req.attempt) || req.attempt < 1)) return 'attempt must be a positive integer';
  return null;
}

// executor.js:680 — the same four conditions, not a second opinion on them.
function ok(outcome) {
  return !!(outcome && outcome.parsed && outcome.parsed.is_error === false &&
    !outcome.timed_out && outcome.exit_code === 0);
}

// runTask(req, opts) -> Promise<result>. Never rejects: a failure is a
// result with ok:false, matching how every executor provider reports.
// opts.transport is forwarded to the adapter so tests stay offline.
function runTask(req, opts) {
  opts = opts || {};
  var invalid = validateRequest(req);
  if (invalid) return Promise.resolve({ ok: false, reason: 'BAD_REQUEST', detail: invalid, attempt: (req && req.attempt) || 1 });

  var baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  var keyFile = opts.keyFile || DEFAULT_KEY_FILE;
  var apiKey = opts.apiKey || readKey(keyFile);
  var attempt = req.attempt || 1;
  var timeoutMs = Math.max(1000, Math.min(Number(req.timeout_ms) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS));

  if (!apiKey) {
    return Promise.resolve({
      ok: false, reason: 'RUNTIME_UNCONFIGURED', attempt: attempt,
      detail: 'no API key at ' + keyFile + ' — run bin/haddad-runtime-setup.sh'
    });
  }

  var started = Date.now();
  return new Promise(function (resolve) {
    function withModel(model) {
      if (!model) {
        return resolve({
          ok: false, reason: 'RUNTIME_UNAVAILABLE', attempt: attempt,
          detail: 'no model served at ' + baseUrl + ' — check: systemctl --user status mythos-haddad-runtime'
        });
      }
      adapter.chatCompletion(
        { baseUrl: baseUrl, apiKey: apiKey, model: model, providerId: 'haddad-local' },
        buildPrompt(req),
        { timeoutMs: timeoutMs, systemPrompt: req.system || DEFAULT_SYSTEM, transport: opts.transport }
      ).then(function (outcome) {
        var good = ok(outcome);
        resolve({
          ok: good,
          reason: good ? null : (outcome.timed_out ? 'TIMEOUT' : 'RUNTIME_ERROR'),
          // The adapter's stderr carries no key, header or provider error
          // text by construction; it is the only diagnostic passed through.
          detail: good ? null : (String(outcome.stderr || '').slice(0, 500) || null),
          text: good ? (outcome.parsed && outcome.parsed.result) || '' : null,
          attempt: attempt,
          model: outcome.model_reported || model,
          timed_out: !!outcome.timed_out,
          duration_ms: Date.now() - started,
          usage: outcome.usage || null
        });
      });
    }
    if (opts.model || req.model) return withModel(opts.model || req.model);
    discoverModel(baseUrl, apiKey, Math.min(timeoutMs, 10000), withModel);
  });
}

module.exports = {
  runTask: runTask,
  renderRepairNotes: renderRepairNotes,
  buildPrompt: buildPrompt,
  validateRequest: validateRequest,
  ok: ok,
  DEFAULT_BASE_URL: DEFAULT_BASE_URL,
  DEFAULT_KEY_FILE: DEFAULT_KEY_FILE,
  DEFAULT_SYSTEM: DEFAULT_SYSTEM,
  MAX_INSTRUCTION: MAX_INSTRUCTION
};
