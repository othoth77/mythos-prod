'use strict';
// =====================================================
// Mythos Orchestrator — public API
// projects/mythos-orchestrator/orchestrator.js
//
// The surface Claude drives. Everything below is provider-neutral:
// provider-specific behaviour lives in providers/, so adding Gemini,
// DeepSeek, a local model or a future agent means adding one adapter,
// not editing this file.
//
//   delegate(task)  validate → route → run → verify → structured outcome
//   status(id)      one task's live state (running/completed/orphaned/...)
//   list()          every persisted task
//   inspect(id)     task, prompt, result, status and log tails
//   cancelSafe(id)  cooperative stop — SIGTERM only, never SIGKILL
//
// A task is only ever reported complete when the runner accepted the
// structured result AND the verifier independently confirmed it against
// Git.
// =====================================================

var fs = require('fs');
var path = require('path');

var runner = require('./runner');
var router = require('./router');
var verifier = require('./verifier');
var store = require('./lib/store');
var gitlib = require('./lib/git');
var redact = require('./lib/redact');

var BASE = __dirname;

// ---------------------------------------------------------------------------
// Task construction helper — produces a deterministic task envelope.
// Given identical inputs (including created_at), the JSON is byte-identical.
// ---------------------------------------------------------------------------
function buildTask(input) {
  var routed = router.route(input.risk_class, {
    allowProductionMutation: input.allow_production_mutation === true,
    commitRequired: !!(input.delivery && input.delivery.commit_required),
    pushRequired: !!(input.delivery && input.delivery.push_required),
    claudeOverride: input.claude_override === true
  });

  var task = {
    schema_version: '1.0.0',
    task_id: input.task_id,
    project: input.project || 'mythos-prod',
    stage: input.stage,
    created_at: input.created_at || new Date().toISOString(),
    requested_by: input.requested_by || 'claude',
    assigned_provider: routed.provider || 'claude',
    repository: input.repository || 'othoth77/mythos-prod',
    working_directory: input.working_directory,
    branch: input.branch,
    baseline_commit: input.baseline_commit,
    objective: input.objective,
    instructions: input.instructions,
    constraints: input.constraints || [],
    required_tests: input.required_tests || [],
    delivery: {
      commit_required: !!(input.delivery && input.delivery.commit_required),
      push_required: !!(input.delivery && input.delivery.push_required),
      handover_required: !!(input.delivery && input.delivery.handover_required),
      tests_required: !!(input.delivery && input.delivery.tests_required)
    },
    timeout_seconds: input.timeout_seconds || 1800,
    risk_class: input.risk_class,
    execution_level: routed.execution_level,
    allow_production_mutation: input.allow_production_mutation === true,
    result_path: input.result_path || 'result.json'
  };
  if (input.notes) task.notes = input.notes;

  // Key order is fixed above, so JSON.stringify is deterministic.
  return task;
}

// ---------------------------------------------------------------------------
// delegate — the Claude → Codex → Claude loop
// ---------------------------------------------------------------------------
function delegate(task, opts) {
  opts = opts || {};

  var routed = router.routeTask(task);
  var outcome = {
    task_id: task && task.task_id,
    stage: task && task.stage,
    routing: routed,
    status: 'failed',
    verified: false,
    result: null,
    execution: null,
    verification: null,
    blockers: [],
    warnings: []
  };

  if (routed.decision === router.DECISIONS.USER_APPROVAL_REQUIRED) {
    outcome.status = 'user_approval_required';
    outcome.blockers = routed.reasons;
    runner.notify('approval_required', task && task.stage, task && task.task_id);
    return outcome;
  }

  var run = runner.execute(task, opts);
  outcome.status = run.status;
  outcome.result = run.result;
  outcome.execution = run.execution;
  outcome.blockers = run.blockers;
  outcome.warnings = run.warnings;
  outcome.paths = run.paths;

  // Verification runs only when the provider actually claimed completion.
  // Anything else is already a non-success and needs no Git evidence.
  if (run.status === 'completed' && run.result) {
    var ver = verifier.verify(task, run.result, { skipFetch: opts.skipFetch });
    outcome.verification = ver;
    outcome.verified = ver.verified;
    if (!ver.verified) {
      outcome.status = 'verification_failed';
      outcome.blockers = outcome.blockers.concat(ver.failures);
    }
    outcome.warnings = outcome.warnings.concat(ver.warnings);
  }

  return outcome;
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------
function status(taskId) {
  var st = store.readJSON(taskId, 'status.json');
  if (!st) return { task_id: taskId, state: 'unknown', detail: 'no status file' };
  return Object.assign({}, st, { state: store.effectiveStatus(st) });
}

function list() {
  return store.listTasks().map(function (id) {
    var st = store.readJSON(id, 'status.json') || {};
    return {
      task_id: id,
      stage: st.stage || null,
      provider: st.provider || null,
      state: store.effectiveStatus(st),
      started_at: st.started_at || null,
      finished_at: st.finished_at || null
    };
  });
}

function tail(text, lines) {
  if (!text) return null;
  var parts = text.split('\n');
  return parts.slice(Math.max(0, parts.length - (lines || 40))).join('\n');
}

function inspect(taskId, opts) {
  opts = opts || {};
  return {
    task_id: taskId,
    status: status(taskId),
    task: store.readJSON(taskId, 'task.json'),
    result: store.readJSON(taskId, 'result.json'),
    stdout_tail: redact.redact(tail(store.readText(taskId, 'stdout.log'), opts.lines)),
    stderr_tail: redact.redact(tail(store.readText(taskId, 'stderr.log'), opts.lines))
  };
}

// Cooperative cancellation. SIGTERM only — the orchestrator never
// force-kills, because a SIGKILL mid-commit can leave a worktree in a
// state another agent then inherits.
function cancelSafe(taskId) {
  var st = store.readJSON(taskId, 'status.json');
  if (!st) return { task_id: taskId, cancelled: false, reason: 'UNKNOWN_TASK' };
  var effective = store.effectiveStatus(st);
  if (effective !== 'running') {
    return { task_id: taskId, cancelled: false, reason: 'NOT_RUNNING: state is ' + effective };
  }
  if (!st.pid || !store.processAlive(st.pid)) {
    return { task_id: taskId, cancelled: false, reason: 'NO_LIVE_PROCESS' };
  }
  try {
    process.kill(st.pid, 'SIGTERM');
  } catch (e) {
    return { task_id: taskId, cancelled: false, reason: 'SIGNAL_FAILED: ' + e.code };
  }
  runner.writeStatus({ task_id: taskId }, { state: 'cancelled', pid: null, finished_at: new Date().toISOString() });
  return { task_id: taskId, cancelled: true, signal: 'SIGTERM' };
}

// Environment/contract report used by the runbook and by `doctor`.
function doctor() {
  return {
    orchestrator_home: store.root(),
    tasks_root: store.tasksRoot(),
    providers: {
      codex: { available: runner.PROVIDERS.codex.available(), version: runner.PROVIDERS.codex.version() },
      claude: { available: runner.PROVIDERS.claude.available(), version: runner.PROVIDERS.claude.version() }
    },
    notify_script: path.join(BASE, 'notify.sh'),
    notify_executable: (function () {
      try { fs.accessSync(path.join(BASE, 'notify.sh'), fs.constants.X_OK); return true; } catch (e) { return false; }
    })(),
    schemas: {
      task: path.join(BASE, 'schemas', 'task.schema.json'),
      result: path.join(BASE, 'schemas', 'result.schema.json')
    }
  };
}

module.exports = {
  buildTask: buildTask,
  delegate: delegate,
  status: status,
  list: list,
  inspect: inspect,
  cancelSafe: cancelSafe,
  doctor: doctor,
  router: router,
  runner: runner,
  verifier: verifier,
  store: store,
  git: gitlib
};
