'use strict';
// =====================================================
// Mythos AI Executor — mock provider (tests only)
// projects/mythos-ai-executor/providers/mock.js
//
// Mission §21: quota and provider failures are exercised with fixtures,
// never by burning real AI quota. The mock replays a scripted sequence of
// outcomes — one per invocation — from MYTHOS_MOCK_SCRIPT (a JSON array)
// or from opts.script. Each entry:
//
//   { "kind": "success" | "quota" | "transient" | "blocked" | "fatal"
//            | "malformed" | "missing-session" | "hang",
//     "text": optional result text override,
//     "reset_epoch": optional epoch seconds for quota entries }
//
// The mock is NEVER selectable from task input in production: executor.js
// only routes to it when MYTHOS_EXECUTOR_ALLOW_MOCK=1, which the systemd
// unit does not set.
// =====================================================

var fs = require('fs');

var PROVIDER_ID = 'mock';
var callCount = 0;

function reset() { callCount = 0; }

function version() { return 'mock/1'; }
function available() { return true; }
function newSessionId() { return 'mock-session-' + Date.now(); }

function scriptEntries(opts) {
  if (opts && Array.isArray(opts.script)) return opts.script;
  var raw = process.env.MYTHOS_MOCK_SCRIPT;
  if (!raw) return [{ kind: 'success' }];
  if (raw[0] === '@') return JSON.parse(fs.readFileSync(raw.slice(1), 'utf8'));
  return JSON.parse(raw);
}

function outcomeFor(entry, sessionId) {
  var base = {
    exit_code: 0, signal: null, timed_out: false, duration_ms: 5,
    stdout: '', stderr: '', parsed: null, session_id: sessionId, started_pid: process.pid
  };
  switch (entry.kind) {
    case 'success':
      base.parsed = {
        is_error: false,
        result: (entry.text || 'done') +
          '\n```json\n{"mythos_report": true, "status": "completed", "summary": "' +
          (entry.summary || 'mock success') + '", "tests": ["mock: pass"], "commit": null}\n```'
      };
      return base;
    case 'malformed':
      base.parsed = { is_error: false, result: entry.text || 'finished but forgot the report block' };
      return base;
    case 'quota':
      base.exit_code = 1;
      base.parsed = null;
      base.stderr = entry.text ||
        ('Claude AI usage limit reached|' + (entry.reset_epoch || Math.floor(Date.now() / 1000) + 7200));
      return base;
    case 'transient':
      base.exit_code = 1;
      base.stderr = entry.text || 'API Error: 529 overloaded_error';
      return base;
    case 'blocked':
      base.exit_code = 1;
      base.stderr = entry.text || 'Credit balance is too low';
      return base;
    case 'missing-session':
      base.exit_code = 1;
      base.stderr = 'No conversation found with session ID ' + sessionId;
      return base;
    case 'fatal':
    default:
      base.exit_code = 1;
      base.stderr = entry.text || 'command failed: something deterministic and permanent';
      return base;
  }
}

function run(task, prompt, sessionId, mode, opts, onSpawn) {
  var entries = scriptEntries(opts);
  var entry = entries[Math.min(callCount, entries.length - 1)];
  callCount += 1;
  if (typeof onSpawn === 'function') onSpawn(process.pid);
  if (entry.kind === 'hang') {
    return new Promise(function () { /* never resolves; caller's timeout owns this */ });
  }
  return Promise.resolve(outcomeFor(entry, sessionId));
}

function isMissingSession(outcome) {
  return /no conversation found/i.test((outcome.stderr || '') + (outcome.stdout || ''));
}

module.exports = {
  PROVIDER_ID: PROVIDER_ID,
  version: version,
  available: available,
  newSessionId: newSessionId,
  run: run,
  reset: reset,
  isMissingSession: isMissingSession,
  executionAuthority: false
};
