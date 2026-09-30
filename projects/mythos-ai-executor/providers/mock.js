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
//            | "malformed" | "missing-session" | "hang" | "wait-file",
//     "text": optional result text override,
//     "dir": required for "wait-file" kind — absolute directory to poll,
//     "reset_epoch": optional epoch seconds for quota entries }
//
// The mock is NEVER selectable from task input in production: executor.js
// only routes to it when MYTHOS_EXECUTOR_ALLOW_MOCK=1, which the systemd
// unit does not set.
// =====================================================

var fs = require('fs');
var path = require('path');

var PROVIDER_ID = 'mock';
var callCount = 0;

function reset() { callCount = 0; }
function calls() { return callCount; }

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

// Like `claude -p --output-format json`, a mock success records which model
// answered in modelUsage: the task's model, or entry.serving to simulate a
// different one (entry.serving === null: no usage record at all).
function modelUsageFor(entry, task) {
  var serving = Object.prototype.hasOwnProperty.call(entry, 'serving') ? entry.serving : (task && task.model) || null;
  if (!serving) return undefined;
  var u = {};
  u[serving] = { inputTokens: 10, outputTokens: 10 };
  return u;
}

// entry.deliver (tests only): on a commit-delivery task the mock behaves like
// a worker that did the work — writes the files (default MOCK_DELIVERY.md),
// commits them on the task's branch and reports that REAL commit — so a
// fixture that needs a completion produces one lib/measured-outcome.js can
// measure, instead of a claim it would (rightly) refuse.
function deliver(entry, task, report) {
  if (!entry.deliver || !task || task.expected_delivery !== 'commit' || !task.working_directory) return report;
  var cp = require('child_process');
  var files = (entry.deliver && typeof entry.deliver === 'object') ? entry.deliver : { 'MOCK_DELIVERY.md': 'mock-delivered\n' };
  var names = Object.keys(files);
  names.forEach(function (f) { fs.writeFileSync(path.join(task.working_directory, f), files[f]); });
  var g = function (args) { return cp.execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=mock', '-c', 'user.email=mock@mock.invalid'].concat(args), { cwd: task.working_directory, encoding: 'utf8' }).trim(); };
  g(['add', '--'].concat(names));
  g(['commit', '-q', '--no-verify', '-m', 'mock: deliver ' + names.join(', ')]);
  return Object.assign({}, report, { commit: g(['rev-parse', 'HEAD']), files_changed: names });
}

function outcomeFor(entry, sessionId, task) {
  var base = {
    exit_code: 0, signal: null, timed_out: false, duration_ms: 5,
    stdout: '', stderr: '', parsed: null, session_id: sessionId, started_pid: process.pid
  };
  switch (entry.kind) {
    case 'success':
      base.parsed = {
        is_error: false,
        result: (entry.text || 'done') +
          '\n```json\n' + JSON.stringify(deliver(entry, task, entry.report || { mythos_report: true, status: 'completed', summary: entry.summary || 'mock success', tests: ['mock: pass'], commit: null })) + '\n```',
        modelUsage: modelUsageFor(entry, task)
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
  if (entry.kind === 'wait-file') {
    // Poll for file existence every 25ms. If dir/<task_id>.fail exists,
    // resolve with 'fatal' outcome. If dir/<task_id> exists, resolve with
    // 'success' outcome but summary = 'released <task_id>'.
    var dir = entry.dir;
    var taskId = task.task_id;
    var failPath = path.join(dir, taskId + '.fail');
    var succPath = path.join(dir, taskId);
    return new Promise(function (resolve) {
      var timer = setInterval(function () {
        var failExists = fs.existsSync(failPath);
        var succExists = fs.existsSync(succPath);
        if (failExists) {
          clearInterval(timer);
          resolve(outcomeFor({
            kind: 'fatal',
            text: 'permanent failure: ' + taskId + ' marked as failed'
          }, sessionId));
          return;
        }
        if (succExists) {
          clearInterval(timer);
          resolve(outcomeFor({
            kind: 'success',
            summary: 'released ' + taskId
          }, sessionId));
          return;
        }
      }, 25);
    });
  }
  return Promise.resolve(outcomeFor(entry, sessionId, task));
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
  calls: calls,
  isMissingSession: isMissingSession,
  executionAuthority: false
};
