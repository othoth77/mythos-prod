'use strict';
// =====================================================
// Mythos AI Executor — Gemini provider (Phase 2, architectural)
// projects/mythos-ai-executor/providers/gemini.js
//
// Gemini is supported ARCHITECTURALLY (Phase 2 order §19): this adapter
// exists so Gemini can become active later without redesigning the
// orchestrator. It is advisory-only (no execution authority) and it
// reports itself UNAVAILABLE until a legitimate credential reference
// exists at ~/.config/mythos-ai-executor/gemini.env containing
// MYTHOS_GEMINI_API_KEY=…
//
// A Gemini Plus subscription is NOT an API credential. This module never
// invents, guesses, or scrapes one; without the env file every call
// returns a structured "unconfigured" failure.
// =====================================================

var fs = require('fs');
var https = require('https');

var PROVIDER_ID = 'gemini';
var DEFAULT_KEY_FILE = process.env.MYTHOS_GEMINI_KEY_FILE ||
  (process.env.HOME || '/home/ubuntu') + '/.config/mythos-ai-executor/gemini.env';
var API_HOST = 'generativelanguage.googleapis.com';

function loadKey(keyFile) {
  try {
    var m = /^MYTHOS_GEMINI_API_KEY=(.+)$/m.exec(fs.readFileSync(keyFile || DEFAULT_KEY_FILE, 'utf8'));
    return m ? m[1].trim() : null;
  } catch (e) {
    return null;
  }
}

function available(opts) {
  opts = opts || {};
  return loadKey(opts.keyFile) !== null;
}

function version() { return available({}) ? 'gemini/rest-v1beta' : null; }

// Advisory chat completion. Mirrors the openai-compat outcome shape so
// the router and executor handle every provider uniformly.
function run(task, prompt, _sessionId, _mode, opts) {
  opts = opts || {};
  var key = loadKey(opts.keyFile);
  var started = Date.now();
  return new Promise(function (resolve) {
    if (!key) {
      resolve({
        exit_code: 1, signal: null, timed_out: false, duration_ms: 0,
        stdout: '', stderr: 'GEMINI_UNCONFIGURED: no credential reference at ' + DEFAULT_KEY_FILE,
        parsed: { is_error: true, result: 'gemini provider unconfigured: no API credential reference exists' },
        session_id: null, started_pid: null
      });
      return;
    }
    var model = task.model || 'gemini-2.5-pro';
    var payload = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{ text: 'You are an advisory reviewer for Mythos OS. You analyse and report; you cannot execute anything. End with a fenced json block containing {"mythos_report": true, "status": "completed", "summary": "..."}.' }]
      }
    });
    var req = https.request({
      hostname: API_HOST,
      path: '/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-goog-api-key': key
      },
      timeout: (task.timeout_seconds || 300) * 1000
    }, function (res) {
      var body = '';
      res.on('data', function (d) { body += d; });
      res.on('end', function () {
        var text = null;
        var isError = res.statusCode >= 400;
        try {
          var obj = JSON.parse(body);
          if (isError) {
            text = 'HTTP ' + res.statusCode + ': ' + ((obj.error && obj.error.message) || 'provider error');
          } else {
            var cand = obj.candidates && obj.candidates[0];
            text = cand && cand.content && cand.content.parts
              ? cand.content.parts.map(function (p) { return p.text || ''; }).join('')
              : '';
          }
        } catch (e) {
          isError = true;
          text = 'HTTP ' + res.statusCode + ': unparseable provider response';
        }
        resolve({
          exit_code: isError ? 1 : 0, signal: null, timed_out: false,
          duration_ms: Date.now() - started,
          stdout: '', stderr: isError ? String(text).slice(0, 2000) : '',
          parsed: { is_error: isError, result: text || '' },
          session_id: null, started_pid: null
        });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('gemini request timed out')); });
    req.on('error', function (err) {
      resolve({
        exit_code: 1, signal: null, timed_out: false, duration_ms: Date.now() - started,
        stdout: '', stderr: 'GEMINI_NETWORK: ' + err.message,
        parsed: { is_error: true, result: 'network error: ' + err.message },
        session_id: null, started_pid: null
      });
    });
    req.end(payload);
  });
}

module.exports = {
  PROVIDER_ID: PROVIDER_ID,
  DEFAULT_KEY_FILE: DEFAULT_KEY_FILE,
  loadKey: loadKey,
  available: available,
  version: version,
  run: run,
  executionAuthority: false  // advisory only, permanently
};
