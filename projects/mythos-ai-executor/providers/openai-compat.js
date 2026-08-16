'use strict';
// =====================================================
// Mythos AI Executor — advisory provider (OpenAI-compatible)
// projects/mythos-ai-executor/providers/openai-compat.js
//
// Mission §9: reasoning providers are SEPARATE from the execution runtime.
// This adapter reaches any OpenAI-compatible endpoint — on this host that
// is OmniRoute at http://127.0.0.1:20128/v1 — for analysis, planning,
// review, summarization and second opinions.
//
// It has NO execution authority by construction: it can only turn a prompt
// into text. It never receives a working directory, never spawns a shell,
// and the executor never feeds its output into anything but the report.
// "Never give a normal chat model arbitrary shell access merely because it
// can generate code."
//
// Credentials: the API key is read at call time from an env-file path in
// the provider config (mode 0600, outside Git). The key value is never
// logged, never stored in task state, never included in errors.
// =====================================================

var fs = require('fs');
var http = require('http');
var https = require('https');
var url = require('url');

var PROVIDER_ID = 'openai-compat';
var DEFAULT_BASE_URL = process.env.MYTHOS_ADVISORY_BASE_URL || 'http://127.0.0.1:20128/v1';
var DEFAULT_KEY_FILE = process.env.MYTHOS_ADVISORY_KEY_FILE ||
  (process.env.HOME || '/home/ubuntu') + '/.config/mythos-ai-executor/advisory.env';

// Reads MYTHOS_ADVISORY_API_KEY=... from the referenced env file.
// Returns null when unavailable — the provider then reports itself
// unavailable instead of failing mid-task.
function loadKey(keyFile) {
  var file = keyFile || DEFAULT_KEY_FILE;
  try {
    var text = fs.readFileSync(file, 'utf8');
    var m = /^MYTHOS_ADVISORY_API_KEY=(.+)$/m.exec(text);
    return m ? m[1].trim() : null;
  } catch (e) {
    return null;
  }
}

function available(opts) {
  opts = opts || {};
  return loadKey(opts.keyFile) !== null;
}

function version() { return 'openai-compat/1'; }

// One chat completion. Returns a Promise of
// { exit_code, parsed: {result, is_error}, stdout, stderr, duration_ms }.
// The shape mirrors the claude-code outcome so executor.js handles both
// uniformly, but there is no session, no pid and no shell.
function run(task, prompt, _sessionId, _mode, opts) {
  opts = opts || {};
  var baseUrl = opts.baseUrl || task.base_url || DEFAULT_BASE_URL;
  var key = loadKey(opts.keyFile);
  var started = Date.now();

  return new Promise(function (resolve) {
    if (!key) {
      resolve({
        exit_code: 1, signal: null, timed_out: false,
        duration_ms: 0, stdout: '', stderr: 'ADVISORY_KEY_UNAVAILABLE: no credential file configured',
        parsed: { is_error: true, result: 'advisory provider unavailable: missing credential reference' },
        session_id: null, started_pid: null
      });
      return;
    }
    var endpoint = url.parse(baseUrl.replace(/\/$/, '') + '/chat/completions');
    var payload = JSON.stringify({
      model: task.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an advisory reviewer for Mythos OS. You analyse and report; you cannot execute anything. End with a fenced json block containing {"mythos_report": true, "status": "completed", "summary": "..."}.' },
        { role: 'user', content: prompt }
      ]
    });
    var mod = endpoint.protocol === 'https:' ? https : http;
    var req = mod.request({
      hostname: endpoint.hostname,
      port: endpoint.port,
      path: endpoint.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': 'Bearer ' + key
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
          text = obj.choices && obj.choices[0] && obj.choices[0].message && obj.choices[0].message.content;
          if (isError && obj.error) text = 'HTTP ' + res.statusCode + ': ' + (obj.error.message || 'provider error');
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
    req.on('timeout', function () { req.destroy(new Error('advisory request timed out')); });
    req.on('error', function (err) {
      resolve({
        exit_code: 1, signal: null, timed_out: false,
        duration_ms: Date.now() - started,
        stdout: '', stderr: 'ADVISORY_NETWORK: ' + err.message,
        parsed: { is_error: true, result: 'network error: ' + err.message },
        session_id: null, started_pid: null
      });
    });
    req.end(payload);
  });
}

module.exports = {
  PROVIDER_ID: PROVIDER_ID,
  DEFAULT_BASE_URL: DEFAULT_BASE_URL,
  version: version,
  available: available,
  run: run,
  executionAuthority: false  // advisory only, permanently
};
