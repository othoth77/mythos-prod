'use strict';
// =====================================================
// Mythos AI Executor — Free LLM Resources: generic chat-completion call
// projects/mythos-ai-executor/free-llm/adapter.js
//
// The same request/response contract as providers/openai-compat.js
// (same outcome shape: exit_code, parsed.{is_error,result}, duration_ms
// — so a caller that already knows how to read an executor outcome
// reads this one too) generalised to take {baseUrl, apiKey, model} PER
// CALL instead of one module-level default endpoint. openai-compat.js
// itself is untouched — this is a sibling, not a rewrite, because
// openai-compat.js is pinned to OmniRoute for the existing
// omniroute-advisory agent and changing its defaults would be an
// unrelated behavioural change (AGENTS.md §10 scope control).
//
// Transport is injectable (opts.transport), the same pattern as
// personal-intelligence/runtime/openrouter-provider.js's
// defaultTransport, so every test here runs fully offline.
// =====================================================

var http = require('http');
var https = require('https');
var url = require('url');

var DEFAULT_SYSTEM_PROMPT =
  'You are a free-tier advisory model reached through the Mythos free-LLM pool. ' +
  'Answer directly and concisely; you have no execution authority over this system.';

function defaultTransport(options, body) {
  return new Promise(function (resolve, reject) {
    var target = url.parse(options.url);
    var mod = target.protocol === 'https:' ? https : http;
    var req = mod.request({
      hostname: target.hostname, port: target.port, path: target.path,
      method: 'POST', headers: options.headers, timeout: options.timeoutMs || 60000,
      // One connection per request, never a pooled one. Node's default agent
      // keeps sockets alive, a local llama-server closes idle ones after a
      // few seconds, and a caller that blocks the event loop between two
      // requests (the tool runner: sandboxed checks, a diagnoser) never sees
      // the close — the next request goes out on a dead socket and fails as
      // "socket hang up" (gh-issue-375, gh-issue-377, live). A fresh
      // connection costs nothing that matters at these call rates.
      agent: false
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('timeout', function () { req.destroy(); reject(new Error('request timed out')); });
    req.on('error', function (err) { reject(err); });
    req.end(body);
  });
}

function errorOutcome(message, started) {
  return {
    exit_code: 1, signal: null, timed_out: /timed out/i.test(message), duration_ms: Date.now() - started,
    stdout: '', stderr: message,
    parsed: { is_error: true, result: message },
    http_status: null, session_id: null, started_pid: null
  };
}

function buildOutcome(statusCode, body, started, expectedModel) {
  var isError = statusCode >= 400;
  var text = null;
  var reportedModel = null;
  try {
    var obj = JSON.parse(body);
    reportedModel = obj.model || null;
    text = obj.choices && obj.choices[0] && obj.choices[0].message && obj.choices[0].message.content;
    if (isError && obj.error) {
      text = 'HTTP ' + statusCode + ': ' + (typeof obj.error === 'string' ? obj.error : (obj.error.message || 'provider error'));
    } else if (!isError && typeof text !== 'string') {
      isError = true;
      text = 'HTTP ' + statusCode + ': response carried no choices[0].message.content';
    }
  } catch (e) {
    isError = true;
    text = 'HTTP ' + statusCode + ': unparseable provider response';
  }
  return {
    exit_code: isError ? 1 : 0, signal: null, timed_out: false, duration_ms: Date.now() - started,
    stdout: '', stderr: isError ? String(text).slice(0, 2000) : '',
    parsed: { is_error: isError, result: text || '' },
    http_status: statusCode, model_reported: reportedModel, expected_model: expectedModel || null,
    usage: (function () { try { return JSON.parse(body).usage || null; } catch (e2) { return null; } })(),
    // The raw assistant message, ADDED alongside everything above and never
    // in place of it. A tool-calling caller needs `tool_calls`, which cannot
    // survive being flattened into `parsed.result`; every existing caller
    // reads `parsed` and is unaffected by an extra key. Absent on a parse
    // failure, which is why callers must null-check it.
    message: (function () {
      try { return JSON.parse(body).choices[0].message || null; } catch (e3) { return null; }
    })(),
    session_id: null, started_pid: null
  };
}

// chatCompletion(spec, prompt, opts) -> Promise<outcome>
// spec: { baseUrl, apiKey, model, extraHeaders? }
function chatCompletion(spec, prompt, opts) {
  opts = opts || {};
  var started = Date.now();
  if (!spec || !spec.baseUrl || !spec.model) {
    return Promise.resolve(errorOutcome('FREE_LLM_ADAPTER_MISCONFIGURED: baseUrl and model are required', started));
  }
  if (!spec.apiKey) {
    return Promise.resolve(errorOutcome('FREE_LLM_KEY_UNAVAILABLE: no credential configured for ' + (spec.providerId || spec.baseUrl), started));
  }
  var transport = opts.transport || defaultTransport;
  var systemPrompt = typeof opts.systemPrompt === 'string' && opts.systemPrompt.trim() ? opts.systemPrompt : DEFAULT_SYSTEM_PROMPT;
  // `prompt` stays a string for every existing caller, and that path is
  // byte-identical to before. A caller running a tool loop passes the whole
  // message array instead, because turn N+1 must carry the assistant's
  // tool_calls and the tool results verbatim — a string cannot express that.
  var body = {
    model: spec.model,
    stream: false,
    messages: Array.isArray(prompt)
      ? prompt
      : [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]
  };
  // Only sent when a caller asks for it, so no existing request shape changes.
  if (Array.isArray(opts.tools) && opts.tools.length) body.tools = opts.tools;
  // Same rule: a caller that bounds one answer says so. Without it a small
  // local model can run away for thousands of tokens on one turn (measured:
  // ~3,800 tokens, past the request timeout) and the whole task is lost to
  // a timeout instead of ending in a bounded, readable turn.
  if (opts.maxTokens > 0) body.max_tokens = Math.floor(opts.maxTokens);
  var payload = JSON.stringify(body);
  var headers = Object.assign({
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Authorization': 'Bearer ' + spec.apiKey
  }, spec.extraHeaders || {});
  var endpoint = String(spec.baseUrl).replace(/\/$/, '') + '/chat/completions';

  return transport({ url: endpoint, headers: headers, timeoutMs: opts.timeoutMs }, payload)
    .then(function (res) { return buildOutcome(res.status, res.body, started, spec.model); })
    .catch(function (err) { return errorOutcome('FREE_LLM_NETWORK: ' + err.message, started); });
}

module.exports = {
  chatCompletion: chatCompletion,
  defaultTransport: defaultTransport,
  DEFAULT_SYSTEM_PROMPT: DEFAULT_SYSTEM_PROMPT
};
