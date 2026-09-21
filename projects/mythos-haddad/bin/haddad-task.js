#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS HADDAD — hand one task to the local Qwen worker
// projects/mythos-haddad/bin/haddad-task.js
//
// The command FABLE runs. A thin front to lib/haddad-runtime.js, in the
// shape of the existing one-shot CLI precedent
// (free-llm/bin/free-llm-complete.js): one JSON object in, ONE JSON line
// out, every wait bounded, never a key or a request header on stdout.
// It adds no logic of its own.
//
//   echo '{"instruction":"…"}' | node haddad-task.js
//   echo '{"instruction":"…","acceptance_criteria":["…"]}' | node haddad-task.js
//   echo '{"instruction":"…","attempt":2,"findings":["…"]}' | node haddad-task.js
//
// stdout: { ok, text?, reason?, detail?, attempt, model?, usage?, duration_ms }
// Exit 0 whenever a JSON answer was written (ok true or false); 2 = bad input.
//
// FABLE owns the loop: send -> read -> REVIEW -> accept, or re-send with
// `findings` and attempt+1. This command never reviews its own output and
// never retries by itself; both are FABLE's call, which is what keeps the
// orchestrator in charge and the worker replaceable.
// =====================================================

var runtime = require('../lib/haddad-runtime.js');

var MAX_STDIN = 64 * 1024;
// Every wait is bounded, including the wait for stdin itself. A caller that
// opens the pipe and never closes it must not hang this process forever —
// free-llm-complete.js answers its own DEADLINE for the same reason, so that
// "a caller's kill never lands mid-write".
var STDIN_DEADLINE_MS = Math.max(1000, Number(process.env.HADDAD_TASK_STDIN_DEADLINE_MS) || 15000);

var done = false;
function out(obj, code) {
  if (done) return;
  done = true;
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exit(code);
}

function main() {
  var input = '';
  var stdinTimer = setTimeout(function () {
    out({ ok: false, reason: 'DEADLINE', detail: 'stdin did not close within ' + STDIN_DEADLINE_MS + 'ms', attempt: 1 }, 2);
  }, STDIN_DEADLINE_MS);
  if (stdinTimer.unref) stdinTimer.unref();

  process.stdin.setEncoding('utf8');
  process.stdin.on('error', function (e) {
    clearTimeout(stdinTimer);
    out({ ok: false, reason: 'BAD_REQUEST', detail: 'stdin unreadable: ' + String(e && e.message).slice(0, 200), attempt: 1 }, 2);
  });
  process.stdin.on('data', function (c) {
    input += c;
    if (input.length > MAX_STDIN) { clearTimeout(stdinTimer); out({ ok: false, reason: 'BAD_REQUEST', detail: 'request too large', attempt: 1 }, 2); }
  });
  process.stdin.on('end', function () {
    clearTimeout(stdinTimer);
    var req;
    try {
      req = JSON.parse(input);
    } catch (e) {
      return out({ ok: false, reason: 'BAD_REQUEST', detail: 'stdin is not valid JSON', attempt: 1 }, 2);
    }
    var invalid = runtime.validateRequest(req);
    if (invalid) return out({ ok: false, reason: 'BAD_REQUEST', detail: invalid, attempt: (req && req.attempt) || 1 }, 2);

    runtime.runTask(req, {}).then(function (result) {
      out(result, 0);
    }).catch(function (e) {
      // runTask resolves rather than rejects; this is belt and braces so a
      // caller never sees a bare stack trace on stdout.
      out({ ok: false, reason: 'RUNTIME_ERROR', detail: String(e && e.message).slice(0, 500), attempt: (req && req.attempt) || 1 }, 0);
    });
  });
}

main();
