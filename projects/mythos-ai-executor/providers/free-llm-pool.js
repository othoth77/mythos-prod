'use strict';
// =====================================================
// Mythos AI Executor — Free LLM Resources pool provider
// projects/mythos-ai-executor/providers/free-llm-pool.js
//
// A meta-agent: one registry entry (config/agents.json "free-llm-pool")
// that fronts the whole free-llm/ subsystem, so the EXISTING selection
// machinery (core/agent-registry.js health cache, core/provider-router.js
// fallback policy, lib/quota.js classification, core/reputation.js
// tiebreak) treats "try the best free service, then the next" as one
// ordinary agent — no change to any of those files' selection logic was
// needed, only one more registered provider.
//
// Advisory only, permanently, like providers/openai-compat.js and
// providers/gemini.js: it can only turn a prompt into text, never gets a
// working directory, and free-llm/selector.js's own internal A -> B -> C
// fallback happens BEFORE this adapter ever reports failure upward.
// =====================================================

var selector = require('../free-llm/selector');

var PROVIDER_ID = 'free-llm-pool';

function available(opts) {
  return selector.selectCandidates({}, opts).length > 0;
}

function version() { return 'free-llm-pool/1'; }

var DEFAULT_SYSTEM_PROMPT =
  'You are an advisory reviewer for Mythos OS, reached through the free-tier LLM pool. ' +
  'You analyse and report; you cannot execute anything. ' +
  'End with a fenced json block containing {"mythos_report": true, "status": "completed", "summary": "..."}.';

function run(task, prompt, _sessionId, _mode, opts) {
  opts = opts || {};
  var systemPrompt = typeof opts.systemPrompt === 'string' && opts.systemPrompt.trim() ? opts.systemPrompt : DEFAULT_SYSTEM_PROMPT;
  return selector.complete(prompt, {
    requirements: { modality: 'chat' },
    systemPrompt: systemPrompt,
    timeoutMs: (task.timeout_seconds || 300) * 1000,
    transport: opts.transport
  }).then(function (result) {
    if (result.ok) {
      return {
        exit_code: 0, signal: null, timed_out: false,
        duration_ms: result.outcome ? result.outcome.duration_ms : null,
        stdout: '', stderr: '',
        parsed: { is_error: false, result: result.text },
        provider_used: result.provider_id, model_used: result.model_id, attempts: result.attempts,
        session_id: null, started_pid: null
      };
    }
    return {
      exit_code: 1, signal: null, timed_out: false, duration_ms: null,
      stdout: '', stderr: 'FREE_LLM_POOL_EXHAUSTED: ' + result.reason,
      parsed: { is_error: true, result: 'free LLM pool exhausted: ' + result.reason },
      attempts: result.attempts,
      session_id: null, started_pid: null
    };
  });
}

module.exports = {
  PROVIDER_ID: PROVIDER_ID,
  version: version,
  available: available,
  run: run,
  executionAuthority: false
};
