'use strict';
// =====================================================
// Mythos Orchestrator — OpenAI advisory provider
// projects/mythos-orchestrator/providers/openai.js
//
// An ADVISOR, not a worker. It turns one request into one structured
// answer through the OpenAI Responses API and has no execution authority
// by construction: no working directory, no shell, no tools, no Git. It is
// deliberately NOT in runner.PROVIDERS — the runner's task path (worktree,
// commits, result.schema.json) is for workers; advice goes through
// advisor.js and is only ever data.
//
// Credentials: OPENAI_API_KEY is read from the key file (mode 0600,
// outside Git) at call time, used for exactly one Authorization header,
// and never returned, logged, persisted or included in an error. Error
// bodies are reduced to OpenAI's `type` and `code`: an OpenAI 401 message
// echoes part of the key, so `message` is never read.
//
// buildRequest() and parseResponse() are pure so the whole contract can be
// asserted offline; the network is reached only through opts.transport
// (default: httpsTransport), which tests replace with a fake.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var https = require('https');

var PROVIDER_ID = 'openai';
var KEY_VAR = 'OPENAI_API_KEY';
var MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function homeDir() { return process.env.HOME || os.homedir(); }

function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return homeDir();
  if (p.indexOf('~/') === 0) return path.join(homeDir(), p.slice(2));
  return p;
}

function defaultKeyFile() {
  return path.join(homeDir(), '.config', 'mythos-orchestrator', 'openai.env');
}

// Reads OPENAI_API_KEY=... from the key file. Returns null when the file,
// the variable or a value is missing — the provider then reports itself
// unavailable instead of failing mid-request.
function loadKey(keyFile) {
  var file = expandHome(keyFile) || defaultKeyFile();
  try {
    var text = fs.readFileSync(file, 'utf8');
    var m = new RegExp('^' + KEY_VAR + '=(.*)$', 'm').exec(text);
    var value = m ? m[1].trim() : '';
    return value ? value : null;
  } catch (e) {
    return null;
  }
}

// stat() only — never opens the file. Used by doctor().
function keyFileStatus(keyFile) {
  var file = expandHome(keyFile) || defaultKeyFile();
  try {
    var st = fs.statSync(file);
    return { path: file, present: st.isFile(), mode: (st.mode & 0o777).toString(8), mode_ok: (st.mode & 0o077) === 0 };
  } catch (e) {
    return { path: file, present: false, mode: null, mode_ok: null };
  }
}

function available(opts) {
  opts = opts || {};
  return loadKey(opts.keyFile) !== null;
}

function version() { return 'openai-responses/1'; }

// The schema as sent to OpenAI: the draft-07 `$schema` marker is local
// metadata, not part of the structured-output contract.
function wireSchema(schema) {
  var copy = JSON.parse(JSON.stringify(schema));
  delete copy.$schema;
  return copy;
}

// Builds the exact request. Pure: identical inputs give an identical
// result, and the key is NOT part of it (run() adds the header).
//
//   input      { role, instructions, text }
//   roleConfig { model, reasoning, max_output_tokens }
//   config     { base_url, timeout_seconds }
//   schema     the advice JSON Schema
function buildRequest(input, roleConfig, config, schema) {
  var base = String(config.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  return {
    url: base + '/responses',
    timeout_ms: (config.timeout_seconds || 120) * 1000,
    body: {
      model: roleConfig.model,
      instructions: input.instructions,
      input: input.text,
      max_output_tokens: roleConfig.max_output_tokens,
      reasoning: { effort: roleConfig.reasoning },
      // Responses are not retained by OpenAI for later retrieval.
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: 'mythos_advice',
          strict: true,
          schema: wireSchema(schema)
        }
      }
    }
  };
}

function failure(code, detail) {
  return { ok: false, error: { code: code, detail: detail === undefined ? null : detail } };
}

// Interprets one HTTP exchange. Pure. Never returns error `message` text.
function parseResponse(statusCode, bodyText) {
  var obj = null;
  try { obj = JSON.parse(bodyText); } catch (e) { obj = null; }

  if (statusCode >= 400 || statusCode < 200) {
    var err = obj && obj.error && typeof obj.error === 'object' ? obj.error : {};
    return failure('HTTP_' + statusCode, {
      type: typeof err.type === 'string' ? err.type : null,
      code: typeof err.code === 'string' ? err.code : null
    });
  }
  if (!obj || typeof obj !== 'object') return failure('MALFORMED_RESPONSE', 'response body is not JSON');

  var usage = obj.usage && typeof obj.usage === 'object' ? {
    input_tokens: obj.usage.input_tokens || 0,
    output_tokens: obj.usage.output_tokens || 0,
    reasoning_tokens: (obj.usage.output_tokens_details && obj.usage.output_tokens_details.reasoning_tokens) || 0,
    total_tokens: obj.usage.total_tokens || 0
  } : null;
  var meta = { model: typeof obj.model === 'string' ? obj.model : null, usage: usage, response_status: obj.status || null };

  if (obj.status !== 'completed') {
    var reason = obj.incomplete_details && obj.incomplete_details.reason;
    return Object.assign(failure('INCOMPLETE', { status: obj.status || null, reason: reason || null }), meta);
  }

  var texts = [];
  var refused = false;
  (Array.isArray(obj.output) ? obj.output : []).forEach(function (item) {
    if (!item || item.type !== 'message' || !Array.isArray(item.content)) return;
    item.content.forEach(function (c) {
      if (c && c.type === 'refusal') refused = true;
      if (c && c.type === 'output_text' && typeof c.text === 'string') texts.push(c.text);
    });
  });
  if (refused) return Object.assign(failure('REFUSED', null), meta);
  if (!texts.length) return Object.assign(failure('EMPTY_OUTPUT', null), meta);

  var advice;
  try { advice = JSON.parse(texts.join('')); } catch (e) {
    return Object.assign(failure('MALFORMED_ADVICE', 'output text is not JSON'), meta);
  }
  return Object.assign({ ok: true, advice: advice, error: null }, meta);
}

function codedError(code, message) {
  var e = new Error(message);
  e.code = code;
  return e;
}

// Default transport: one HTTPS POST. Resolves { status, body } or rejects
// with an Error carrying a `code`:
//
//   ETIMEDOUT           the HARD total deadline (spec.timeout_ms, measured
//                       from the start of the call) passed — a slow-drip
//                       response cannot extend it, unlike a socket idle timer
//   RESPONSE_TRUNCATED  the connection closed before the full body arrived
//   RESPONSE_TOO_LARGE  the body exceeded MAX_RESPONSE_BYTES
//   (anything else)     the underlying request/socket error code
//
// Settles exactly once; every later event is ignored. `requestFn` defaults
// to https.request (resolved at call time) and exists so the robustness
// cases can be exercised offline with a scripted request/response pair.
function httpsTransport(spec, requestFn) {
  var request = requestFn || https.request;
  return new Promise(function (resolve, reject) {
    var settled = false;
    var req = null;
    var timeoutMs = typeof spec.timeout_ms === 'number' && spec.timeout_ms > 0 ? spec.timeout_ms : 120000;

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn(value);
    }
    function fail(err) {
      if (settled) return;
      finish(reject, err);
      if (req) { try { req.destroy(); } catch (e) { /* already gone */ } }
    }

    var deadline = setTimeout(function () {
      fail(codedError('ETIMEDOUT', 'request exceeded its total deadline of ' + timeoutMs + 'ms'));
    }, timeoutMs);

    var endpoint = new URL(spec.url);
    var payload = JSON.stringify(spec.body);
    var headers = Object.assign({}, spec.headers, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    });

    try {
      req = request({
        hostname: endpoint.hostname,
        port: endpoint.port || 443,
        path: endpoint.pathname + endpoint.search,
        method: 'POST',
        headers: headers
      }, function (res) {
        var chunks = [];
        var size = 0;
        function truncated() {
          fail(codedError('RESPONSE_TRUNCATED', 'connection closed before the full response arrived'));
        }
        res.on('data', function (d) {
          if (settled) return;
          size += d.length;
          if (size > MAX_RESPONSE_BYTES) {
            fail(codedError('RESPONSE_TOO_LARGE', 'response exceeded size cap'));
            return;
          }
          chunks.push(d);
        });
        res.on('end', function () {
          if (res.complete === false) return truncated();
          finish(resolve, { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
        });
        // A mid-body close surfaces as 'aborted' and/or 'error' and always
        // as 'close' without a complete message. Listening to 'error' also
        // keeps an unhandled stream error from crashing the process.
        res.on('aborted', truncated);
        res.on('error', truncated);
        res.on('close', function () { if (!res.complete) truncated(); });
      });
    } catch (e) {
      fail(e);
      return;
    }
    req.on('error', fail);
    req.end(payload);
  });
}

// Removes every occurrence of the key from a value, as a last line of
// defence behind the rule that the key is never put anywhere but a header.
function scrubKey(value, key) {
  if (!key) return value;
  var text = JSON.stringify(value);
  if (text === undefined || text.indexOf(key) === -1) return value;
  return JSON.parse(text.split(key).join('[REDACTED]'));
}

// Sends one built request. Always resolves (never rejects):
//   { ok, advice, error, model, usage, response_status, duration_ms }
function run(built, opts) {
  opts = opts || {};
  var transport = opts.transport || httpsTransport;
  var key = loadKey(opts.keyFile);
  var started = Date.now();

  if (!key) {
    return Promise.resolve(Object.assign(failure('KEY_UNAVAILABLE', 'no ' + KEY_VAR + ' in the key file'), { duration_ms: 0 }));
  }

  var spec = {
    url: built.url,
    timeout_ms: built.timeout_ms,
    body: built.body,
    headers: { Authorization: 'Bearer ' + key }
  };

  var sent;
  try {
    sent = Promise.resolve(transport(spec));
  } catch (e) {
    sent = Promise.reject(e);
  }

  return sent.then(function (res) {
    var out = parseResponse(res && res.status, res && typeof res.body === 'string' ? res.body : '');
    out.duration_ms = Date.now() - started;
    return scrubKey(out, key);
  }, function (err) {
    var code = err && typeof err.code === 'string' ? err.code : 'NETWORK_ERROR';
    return scrubKey(Object.assign(failure(code === 'ETIMEDOUT' ? 'TIMEOUT' : 'NETWORK_ERROR', { code: code }), {
      duration_ms: Date.now() - started
    }), key);
  });
}

module.exports = {
  PROVIDER_ID: PROVIDER_ID,
  KEY_VAR: KEY_VAR,
  defaultKeyFile: defaultKeyFile,
  expandHome: expandHome,
  loadKey: loadKey,
  keyFileStatus: keyFileStatus,
  available: available,
  version: version,
  buildRequest: buildRequest,
  parseResponse: parseResponse,
  httpsTransport: httpsTransport,
  run: run,
  executionAuthority: false // advisory only, permanently
};
