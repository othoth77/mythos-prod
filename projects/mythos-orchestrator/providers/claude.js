'use strict';
// =====================================================
// Mythos Orchestrator — Claude provider adapter
// projects/mythos-orchestrator/providers/claude.js
//
// Claude is the ORCHESTRATOR, not a worker process. When the router
// returns CLAUDE, the work is performed by the Claude session that is
// already driving the orchestrator — architecture, design, review and
// verification are exactly the judgement work that must not be handed to
// a detached subprocess.
//
// This adapter therefore does NOT spawn `claude`. It returns a
// "retained" outcome telling the caller that the task stays in the
// current session. That is a deliberate architectural decision, not a
// missing feature:
//
//   * spawning a second Claude to do the thinking would make the
//     orchestrator unaccountable for its own decisions, and
//   * AGENTS.md §9 forbids using subagents without explicit authorisation.
//
// The adapter still implements the provider interface (version /
// available / run) so that provider selection stays uniform and a future
// provider can be added without special-casing the router.
// =====================================================

var cp = require('child_process');

var PROVIDER_ID = 'claude';
var DEFAULT_BIN = process.env.MYTHOS_CLAUDE_BIN || 'claude';

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

// Never launches a process. Returns the retained-work outcome.
function run(task) {
  return {
    provider: PROVIDER_ID,
    retained: true,
    exit_code: 0,
    signal: null,
    timed_out: false,
    duration_ms: 0,
    command: null,
    note: 'Task retained by the orchestrating Claude session; no subprocess launched.',
    result: {
      task_id: task.task_id,
      provider: PROVIDER_ID,
      status: 'blocked',
      blocked_reason: 'missing_prerequisite',
      baseline: task.baseline_commit,
      branch: task.branch,
      implementation_commit: null,
      handover_commit: null,
      remote_head: null,
      tests: [],
      files_changed: [],
      blockers: ['RETAINED_BY_ORCHESTRATOR: this work class is performed by the Claude session itself, not by a delegated worker process'],
      warnings: [],
      next_stage: null,
      summary: 'Routed to CLAUDE. The orchestrating session performs this task directly; no provider subprocess was started.'
    }
  };
}

module.exports = {
  PROVIDER_ID: PROVIDER_ID,
  DEFAULT_BIN: DEFAULT_BIN,
  version: version,
  available: available,
  run: run
};
