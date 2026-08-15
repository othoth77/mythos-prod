// =====================================================
// Mythos Personal Intelligence — O-4-1 OpenRouter Free Provider
// projects/personal-intelligence/runtime/openrouter-provider.js
//
// The ONE authorized external egress path (MPI_4_RUNTIME_SPECIFICATION.md
// §2.2), implemented behind the existing M4-1 provider contract
// ({ name, complete }) — no second LLM abstraction.
//
// FREE-ONLY, STRUCTURALLY:
//   - the model is a CONSTANT ('nvidia/nemotron-3-ultra-550b-a55b:free');
//     no parameter, argument, or environment value can change it
//   - provider.allow_fallbacks: false and provider.max_price {0,0} are set
//     on every request (documented OpenRouter fields)
//   - a response reporting a different model is refused:
//     FREE_MODEL_POLICY_VIOLATION
//   - 404/no-route -> FREE_MODEL_UNAVAILABLE · 429 -> FREE_RATE_LIMITED
//   - there is no retry, no fallback, no alternate route of any kind
//
// MINIMAL EGRESS SERIALIZER: only the ContextPackage's intent and item
// SUMMARIES plus the user message are rendered into the prompt. Item keys,
// provenance references, permissions, content-reference strings and
// _diagnostics are STRIPPED before egress (§2.1 strip candidates, ratified
// in §2.2). Content bodies never exist in packages (D3).
//
// SECRET: the key is read from the owner-created 0600 env file
// (OPENROUTER_API_KEY). It exists only in process memory, is sent only in
// the Authorization header, and never appears in errors, diagnostics,
// logs, or return values.
//
// The HTTPS transport is injectable so every test runs fully offline.
// =====================================================
'use strict';

const fs = require('fs');
const https = require('https');

const PROVIDER_NAME = 'openrouter-free';
const SELECTED_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_KEY_FILE = '/home/ubuntu/.config/mythos/openrouter.env';
const DEFAULT_MAX_TOKENS = 1024;

function refusal(code) {
  const e = new Error(code);
  e.refused = true;
  return e;
}

// loadKey(file) — same discipline as the S3 adapter's loadConfig: mode 600
// enforced, value never returned in any error.
function loadKey(file) {
  const f = file || DEFAULT_KEY_FILE;
  let st;
  try {
    st = fs.statSync(f);
  } catch (e) {
    throw refusal('OPENROUTER_KEY_MISSING (owner-created key file not found)');
  }
  if ((st.mode & 0o777) !== 0o600) throw refusal('OPENROUTER_KEY_FILE_MODE (must be 0600)');
  const m = /^OPENROUTER_API_KEY=(.+)$/m.exec(fs.readFileSync(f, 'utf8'));
  if (!m || !m[1].trim().length) throw refusal('OPENROUTER_KEY_MISSING (OPENROUTER_API_KEY not set in key file)');
  return m[1].trim();
}

// serializeEgress(request) — the ONLY content that crosses the boundary.
function serializeEgress(request) {
  const pkg = request.contextPackage;
  const lines = [];
  lines.push('You answer using ONLY the personal context below. Context intent: ' +
    (pkg.intent === null ? 'none' : pkg.intent));
  const sections = [
    ['Facts', pkg.requiredFacts], ['Preferences', pkg.relevantPreferences],
    ['Organisation rules', pkg.organisationRules], ['Domain instructions', pkg.domainInstructions]
  ];
  sections.forEach(function (s) {
    if (s[1].length) {
      lines.push(s[0] + ':');
      s[1].forEach(function (item) { lines.push('- ' + item.value); }); // summaries only
    }
  });
  return { system: lines.join('\n'), user: request.userMessage };
}

function defaultTransport(options, body) {
  return new Promise(function (resolve, reject) {
    const u = new URL(options.url);
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname, method: 'POST',
      headers: options.headers, timeout: 120000
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
      });
    });
    req.on('timeout', function () { req.destroy(); reject(new Error('provider unavailable')); });
    req.on('error', function () { reject(new Error('provider unavailable')); });
    req.write(body);
    req.end();
  });
}

// createOpenRouterProvider({ keyFile, transport, maxTokens })
// Deliberately NO model/provider/endpoint options exist.
function createOpenRouterProvider(opts) {
  const o = opts || {};
  const transport = o.transport || defaultTransport;
  const maxTokens = o.maxTokens || DEFAULT_MAX_TOKENS;
  return {
    name: PROVIDER_NAME,
    model: SELECTED_MODEL,
    async complete(request) {
      const key = loadKey(o.keyFile); // fail-closed before anything else
      const prompt = serializeEgress(request);
      const body = JSON.stringify({
        model: SELECTED_MODEL,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ],
        max_tokens: maxTokens,
        provider: { allow_fallbacks: false, max_price: { prompt: 0, completion: 0 } }
      });
      const res = await transport({
        url: ENDPOINT,
        headers: {
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json'
        }
      }, body);
      if (res.status === 404) throw refusal('FREE_MODEL_UNAVAILABLE');
      if (res.status === 429) throw refusal('FREE_RATE_LIMITED');
      if (res.status === 401 || res.status === 403) throw refusal('OPENROUTER_KEY_REJECTED');
      if (res.status < 200 || res.status >= 300) throw new Error('provider request failed (HTTP ' + res.status + ')');
      let parsed;
      try {
        parsed = JSON.parse(res.body);
      } catch (e) {
        throw new Error('provider response unparseable');
      }
      if (parsed.error) {
        const code = parsed.error.code;
        if (code === 404) throw refusal('FREE_MODEL_UNAVAILABLE');
        if (code === 429) throw refusal('FREE_RATE_LIMITED');
        throw new Error('provider error (code ' + code + ')');
      }
      // FREE-ONLY response verification: a different model is a policy violation.
      if (typeof parsed.model === 'string' && parsed.model.length &&
          parsed.model !== SELECTED_MODEL &&
          parsed.model !== SELECTED_MODEL.replace(/:free$/, '')) {
        throw refusal('FREE_MODEL_POLICY_VIOLATION (response model differs from the ratified slug)');
      }
      const choice = parsed.choices && parsed.choices[0];
      const text = choice && choice.message && choice.message.content;
      if (typeof text !== 'string') throw new Error('provider response malformed');
      return {
        text: text,
        meta: {
          provider: PROVIDER_NAME,
          model: parsed.model || SELECTED_MODEL,
          requestId: parsed.id || null,
          usage: parsed.usage || null
        }
      };
    }
  };
}

module.exports = {
  createOpenRouterProvider: createOpenRouterProvider,
  serializeEgress: serializeEgress,
  loadKey: loadKey,
  PROVIDER_NAME: PROVIDER_NAME,
  SELECTED_MODEL: SELECTED_MODEL,
  DEFAULT_KEY_FILE: DEFAULT_KEY_FILE
};
