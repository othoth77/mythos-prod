'use strict';
// =====================================================
// Mythos AI Executor — Claude Code execution provider
// projects/mythos-ai-executor/providers/claude-code.js
//
// The ONLY provider with repository execution authority (mission §9).
// Wraps the real installed Claude Code CLI in headless mode. Verified
// against claude 2.1.233 on this host; the invocation contract was read
// from `claude --help`, not assumed:
//
//   claude -p [prompt]              non-interactive; stdin supplies the prompt
//     --output-format json          single JSON result object on stdout
//                                   (includes session_id, is_error, result)
//     --session-id <uuid>           pin the session id for a NEW session
//     --resume <session-id>         continue an existing session
//     --permission-mode <mode>      default | acceptEdits | bypassPermissions | plan
//     --allowedTools / --disallowedTools
//     --fallback-model <model>      automatic fallback when overloaded
//
// Model (Issue #100): never inherited from the CLI. lib/model-policy.js
// decides — the task's explicit `Model:` if it named one, otherwise a
// scored choice between haiku/sonnet/opus — and buildArgs always emits
// --model, so `fable` runs only when a task asks for it by name.
//
// Session persistence (mission §6): the first run of a task pins a fresh
// UUID via --session-id and records it; every continuation uses --resume
// with that same id, so quota pauses, crashes and reboots all come back
// to the SAME conversation context.
//
// Exit code 0 means the CLI ran, not that the task succeeded. The
// authoritative outcome is the parsed JSON result plus the task's
// structured mythos_report block.
// =====================================================

var cp = require('child_process');
var crypto = require('crypto');

var policy = require('../lib/policy');
var modelPolicy = require('../lib/model-policy');

var PROVIDER_ID = 'claude-code';
var DEFAULT_BIN = process.env.MYTHOS_CLAUDE_BIN || 'claude';
var KILL_GRACE_MS = 15000;

function version(bin) {
  try {
    return cp.execFileSync(bin || DEFAULT_BIN, ['--version'], {
      encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (e) {
    return null;
  }
}

function available(bin) { return version(bin) !== null; }

function newSessionId() { return crypto.randomUUID(); }

// Builds the exact argv. Pure and exported so tests can assert the
// command without executing it.
//   mode: 'start'  → --session-id <sid>   (new session, pinned id)
//         'resume' → --resume <sid>       (continue prior context)
function buildArgs(task, sessionId, mode) {
  var args = ['-p', '--output-format', 'json'];
  if (mode === 'resume') {
    args.push('--resume', sessionId);
  } else {
    args.push('--session-id', sessionId);
  }
  args = args.concat(policy.claudeArgsForProfile(task.execution_profile));
  // Issue #100: --model is ALWAYS passed. executor.createTask has already
  // resolved one (explicit request or scored choice); this fallback covers
  // records created before that policy existed and any caller that builds a
  // task by hand. Omitting the flag would hand the choice to the CLI's own
  // ambient default (today: the fable family), which must never happen
  // without a task asking for it by name.
  args.push('--model', task.model || modelPolicy.selectModel({
    execution_profile: task.execution_profile, task_category: task.task_category,
    priority: task.priority, instruction: task.instruction,
    constraints: task.constraints, required_tests: task.required_tests
  }).model);
  if (task.fallback_model) args.push('--fallback-model', task.fallback_model);
  if (task.max_turns) args.push('--max-turns', String(task.max_turns));
  return args;
}

// Launches one headless Claude execution. The prompt travels via stdin so
// it never hits ARG_MAX and never appears in the process table.
// Returns { exit_code, signal, timed_out, duration_ms, stdout, stderr,
//           parsed, session_id, started_pid }.
function run(task, prompt, sessionId, mode, opts, onSpawn) {
  opts = opts || {};
  var bin = opts.bin || DEFAULT_BIN;
  var args = buildArgs(task, sessionId, mode);
  var timeoutMs = (task.timeout_seconds || 3600) * 1000;
  var started = Date.now();

  return new Promise(function (resolve) {
    var child = cp.spawn(bin, args, {
      cwd: task.working_directory,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (typeof onSpawn === 'function') onSpawn(child.pid);

    var stdout = '';
    var stderr = '';
    var timedOut = false;
    var settled = false;

    var timer = setTimeout(function () {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch (e) { /* already gone */ }
      setTimeout(function () {
        try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
      }, KILL_GRACE_MS);
    }, timeoutMs);

    child.stdout.on('data', function (d) { stdout += d; });
    child.stderr.on('data', function (d) { stderr += d; });

    child.on('error', function (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exit_code: null, signal: null, timed_out: timedOut,
        duration_ms: Date.now() - started,
        stdout: stdout, stderr: stderr + '\nSPAWN_ERROR: ' + err.message,
        parsed: null, session_id: sessionId, started_pid: child.pid || null
      });
    });

    child.on('close', function (code, signal) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      var parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch (e) {
        // Sometimes progress noise precedes the result object; take the
        // last line that parses as JSON.
        var lines = stdout.trim().split('\n');
        for (var i = lines.length - 1; i >= 0; i--) {
          try { parsed = JSON.parse(lines[i]); break; } catch (e2) { /* keep looking */ }
        }
      }
      resolve({
        exit_code: code, signal: signal, timed_out: timedOut,
        duration_ms: Date.now() - started,
        stdout: stdout, stderr: stderr,
        parsed: parsed,
        session_id: (parsed && parsed.session_id) || sessionId,
        started_pid: child.pid || null
      });
    });

    child.stdin.on('error', function () { /* EPIPE when the CLI exits early */ });
    child.stdin.end(prompt);
  });
}

// A resume attempt against a session the CLI no longer knows about.
function isMissingSession(outcome) {
  var text = (outcome.stderr || '') + '\n' + (outcome.stdout || '');
  return /no conversation found|session.{0,40}not found|could not resume/i.test(text);
}

module.exports = {
  PROVIDER_ID: PROVIDER_ID,
  DEFAULT_BIN: DEFAULT_BIN,
  version: version,
  available: available,
  newSessionId: newSessionId,
  buildArgs: buildArgs,
  run: run,
  isMissingSession: isMissingSession,
  executionAuthority: true   // the one provider allowed to touch repositories
};
