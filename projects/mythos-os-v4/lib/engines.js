'use strict';
// =====================================================
// MYTHOS OS v4 — executive engines (FABLE 5.1 · OpenAI)
// projects/mythos-os-v4/lib/engines.js
//
// An engine turns one structured request into one JSON value, and nothing
// else: no tools, no shell, no repository. Both speak the same contract so
// the executive layer and the watchdog can treat them alike:
//
//   engine.id
//   engine.available()                      -> { ok, detail }
//   engine.call({ system, input, schema, timeoutMs, role })
//        -> Promise<{ ok, value, error:{code,detail}|null, model_measured, duration_ms }>
//
// FABLE 5.1 is the Claude CLI pinned to the fable model (lib/claude-cli.js);
// its identity is measured from the call's own modelUsage. OpenAI is the
// existing orchestrator provider (mythos-orchestrator/providers/openai.js,
// reused unmodified) with its authoritative on/off switch, key file and role
// models in mythos-orchestrator/config/openai.json — no second key path, no
// second model list.
//
// A call NEVER rejects and never returns a half-parsed value: anything that
// is not exactly one JSON object is MALFORMED (fail closed).
// =====================================================

var fs = require('fs');
var path = require('path');

var claudeCli = require('./claude-cli');
var openaiProvider = require('../../mythos-orchestrator/providers/openai');

var OPENAI_CONFIG_PATH = path.join(__dirname, '..', '..', 'mythos-orchestrator', 'config', 'openai.json');

// extractObject(text) -> the single JSON object a model answered with, or
// null. Accepts a bare object or one fenced block; prose around it, two
// objects, or an array are refused rather than guessed at.
function extractObject(text) {
  if (typeof text !== 'string') return null;
  var body = text.trim();
  var fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(body);
  if (fenced) body = fenced[1].trim();
  if (body[0] !== '{' || body[body.length - 1] !== '}') return null;
  try {
    var value = JSON.parse(body);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (e) {
    return null;
  }
}

function failure(code, detail, extra) {
  return Object.assign({ ok: false, value: null, error: { code: code, detail: detail === undefined ? null : detail }, model_measured: null, duration_ms: 0 }, extra || {});
}

// ---------------------------------------------------------------------------
// FABLE 5.1
function createFable(opts) {
  opts = opts || {};
  var model = opts.model || 'claude-fable-5-1';
  var run = opts.run || claudeCli.run;

  return {
    id: 'fable',
    model: model,
    available: function () {
      var present = opts.available ? opts.available() : claudeCli.available(opts.bin);
      return { ok: !!present, detail: present ? 'claude CLI present' : 'claude CLI not found' };
    },
    call: function (req) {
      var prompt = req.input + '\n\nAnswer with exactly one JSON object that matches this JSON Schema, and nothing else — no prose, no code fence:\n' +
        JSON.stringify(req.schema);
      return run({ model: model, system: req.system, prompt: prompt, timeoutMs: req.timeoutMs }, { bin: opts.bin, spawn: opts.spawn })
        .then(function (out) {
          var measured = (out.models_measured || []).slice();
          if (!out.ok) {
            return failure(out.error.code, out.error.detail, { model_measured: measured.join(',') || null, duration_ms: out.duration_ms, resume_at: out.resume_at || null });
          }
          // Identity: the fable model must be among the models that served
          // this call. Anything else answered under FABLE's name.
          if (measured.indexOf(model) === -1) {
            return failure('IDENTITY_MISMATCH', 'asked for ' + model + ', served by ' + (measured.join(',') || 'an unmeasured model'),
              { model_measured: measured.join(',') || null, duration_ms: out.duration_ms });
          }
          var value = extractObject(out.text);
          if (!value) return failure('MALFORMED', 'the answer is not exactly one JSON object', { model_measured: model, duration_ms: out.duration_ms });
          return { ok: true, value: value, error: null, model_measured: model, duration_ms: out.duration_ms, cost_usd: out.cost_usd };
        });
    }
  };
}

// ---------------------------------------------------------------------------
// OpenAI
function loadOpenAIConfig(configPath) {
  try { return JSON.parse(fs.readFileSync(configPath || OPENAI_CONFIG_PATH, 'utf8')); } catch (e) { return null; }
}

function createOpenAI(opts) {
  opts = opts || {};
  var provider = opts.provider || openaiProvider;

  function config() { return opts.config || loadOpenAIConfig(opts.configPath); }
  function keyFile(cfg) { return opts.keyFile || (cfg && cfg.key_file) || undefined; }

  return {
    id: 'openai',
    available: function () {
      var cfg = config();
      if (!cfg) return { ok: false, detail: 'openai.json unreadable' };
      if (cfg.enabled !== true) return { ok: false, detail: 'disabled by config/openai.json' };
      if (!provider.available({ keyFile: keyFile(cfg) })) return { ok: false, detail: 'no key file on this host' };
      return { ok: true, detail: 'enabled, key present' };
    },
    call: function (req) {
      var cfg = config();
      if (!cfg || cfg.enabled !== true) return Promise.resolve(failure('UNAVAILABLE', 'OpenAI is disabled or unconfigured'));
      var roleCfg = cfg.roles && cfg.roles[req.role];
      if (!roleCfg) return Promise.resolve(failure('MISCONFIGURED', 'no OpenAI role "' + req.role + '"'));
      var built = provider.buildRequest({ instructions: req.system, text: req.input }, roleCfg,
        { base_url: cfg.base_url, timeout_seconds: Math.max(1, Math.round((req.timeoutMs || 120000) / 1000)) }, req.schema);
      return provider.run(built, { transport: opts.transport, keyFile: keyFile(cfg) }).then(function (out) {
        if (!out.ok) {
          var code = out.error && out.error.code;
          var mapped = code === 'KEY_UNAVAILABLE' ? 'UNAVAILABLE'
            : (code === 'TIMEOUT' ? 'TIMEOUT'
              : (code === 'HTTP_429' ? 'QUOTA'
                : (code === 'HTTP_401' || code === 'HTTP_403' ? 'BLOCKED'
                  : (/^HTTP_5/.test(String(code)) || code === 'NETWORK_ERROR' ? 'TRANSIENT'
                    : (code === 'MALFORMED_ADVICE' || code === 'MALFORMED_RESPONSE' || code === 'EMPTY_OUTPUT' || code === 'INCOMPLETE' || code === 'REFUSED' ? 'MALFORMED' : 'PROVIDER_ERROR')))));
          return failure(mapped, code, { model_measured: out.model || null, duration_ms: out.duration_ms || 0 });
        }
        var value = out.advice;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return failure('MALFORMED', 'the answer is not a JSON object', { model_measured: out.model || null, duration_ms: out.duration_ms || 0 });
        }
        return { ok: true, value: value, error: null, model_measured: out.model || roleCfg.model, duration_ms: out.duration_ms || 0, usage: out.usage || null };
      });
    }
  };
}

module.exports = {
  createFable: createFable,
  createOpenAI: createOpenAI,
  extractObject: extractObject,
  loadOpenAIConfig: loadOpenAIConfig,
  OPENAI_CONFIG_PATH: OPENAI_CONFIG_PATH
};
