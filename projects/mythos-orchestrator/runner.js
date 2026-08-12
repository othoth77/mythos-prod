'use strict';
// =====================================================
// Mythos Orchestrator — task runner
// projects/mythos-orchestrator/runner.js
//
// Owns one delegated task end to end:
//
//   validate task → route → safety gate → Git preflight → prepare
//   persistent task dir → render prompt → launch provider → capture
//   exit code + duration → read structured result → validate result
//
// Two invariants this file exists to protect:
//
//   1. A missing, malformed or unparsable result is NEVER success. Exit
//      code 0 from the provider CLI only means the CLI ran.
//   2. Nothing is launched until the Git preflight passes, so two writers
//      can never enter the same worktree.
// =====================================================

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var schema = require('./lib/schema');
var redact = require('./lib/redact');
var store = require('./lib/store');
var gitlib = require('./lib/git');
var router = require('./router');

var BASE = __dirname;
var TASK_SCHEMA = JSON.parse(fs.readFileSync(path.join(BASE, 'schemas', 'task.schema.json'), 'utf8'));
var RESULT_SCHEMA = JSON.parse(fs.readFileSync(path.join(BASE, 'schemas', 'result.schema.json'), 'utf8'));

var PROVIDERS = {
  codex: require('./providers/codex'),
  claude: require('./providers/claude')
};

// ---------------------------------------------------------------------------
// Task validation
// ---------------------------------------------------------------------------

// Fields scanned for accidentally-embedded credentials. A task must never
// carry a secret: providers get their credentials from their own user-local
// configuration, never from the task envelope.
var SECRET_SCANNED_FIELDS = ['objective', 'instructions', 'notes'];

function validateTask(task) {
  var errors = [];
  var result = schema.validate(task, TASK_SCHEMA);
  if (!result.valid) errors = errors.concat(result.errors);

  if (task && typeof task === 'object') {
    SECRET_SCANNED_FIELDS.forEach(function (field) {
      var kinds = redact.findSecretKinds(task[field]);
      if (kinds.length) {
        errors.push('SECRET_IN_TASK: field "' + field + '" matches ' + kinds.join(', ') + ' — refusing to dispatch');
      }
    });
    (task.constraints || []).forEach(function (c, i) {
      var kinds = redact.findSecretKinds(c);
      if (kinds.length) errors.push('SECRET_IN_TASK: constraints[' + i + '] matches ' + kinds.join(', '));
    });

    // The declared provider must agree with the deterministic router.
    if (result.valid) {
      var routed = router.routeTask(task);
      if (routed.decision === router.DECISIONS.USER_APPROVAL_REQUIRED) {
        errors.push('APPROVAL_REQUIRED: ' + routed.reasons.join('; '));
      } else if (routed.provider !== task.assigned_provider) {
        errors.push('PROVIDER_MISMATCH: router assigned ' + routed.provider +
          ' but the task declares ' + task.assigned_provider);
      }
      if (routed.execution_level !== task.execution_level) {
        errors.push('EXECUTION_LEVEL_MISMATCH: router derived level ' + routed.execution_level +
          ' but the task declares ' + task.execution_level);
      }
    }

    if (task.execution_level === 3) {
      errors.push('LEVEL_3_NOT_AUTOMATIC: execution level 3 requires explicit user authorisation and is never dispatched by the runner');
    }
    if (task.allow_production_mutation === true) {
      errors.push('PRODUCTION_MUTATION_FORBIDDEN: the runner never dispatches a task requesting production mutation');
    }
  }

  return { valid: errors.length === 0, errors: errors };
}

function validateResult(result) {
  return schema.validate(result, RESULT_SCHEMA);
}

// ---------------------------------------------------------------------------
// Task directory preparation
// ---------------------------------------------------------------------------

function taskPaths(task) {
  var dir = store.taskDir(task.task_id);
  return {
    dir: dir,
    task: store.taskFile(task.task_id, 'task.json'),
    prompt: store.taskFile(task.task_id, 'prompt.md'),
    stdout: store.taskFile(task.task_id, 'stdout.log'),
    stderr: store.taskFile(task.task_id, 'stderr.log'),
    status: store.taskFile(task.task_id, 'status.json'),
    // result_path is schema-constrained to a bare filename, and taskFile
    // re-checks it, so a task can never redirect its result outside its dir.
    result: store.taskFile(task.task_id, task.result_path),
    resultSchema: path.join(BASE, 'schemas', 'result.schema.json')
  };
}

function writeStatus(task, patch) {
  var existing = store.readJSON(task.task_id, 'status.json') || {};
  var merged = Object.assign({}, existing, patch, { updated_at: new Date().toISOString() });
  store.writeJSON(task.task_id, 'status.json', merged);
  return merged;
}

// ---------------------------------------------------------------------------
// Notification boundary — always non-fatal
// ---------------------------------------------------------------------------
function notify(event, stage, detail) {
  try {
    cp.execFileSync(path.join(BASE, 'notify.sh'), [event, String(stage || 'unknown'), String(detail || '')], {
      timeout: 12000,
      stdio: 'ignore'
    });
    return { sent: true };
  } catch (e) {
    // An ntfy outage, a missing config, a non-executable script — none of
    // these may alter task status. Warning only, by design.
    return { sent: false, warning: 'NOTIFY_FAILED_NONFATAL' };
  }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

// Runs one task to completion. Returns
// { dispatched, status, result, execution, blockers, warnings }.
//
// `status` is the orchestrator's own view and is intentionally independent
// of whatever the provider claimed.
function execute(task, opts) {
  opts = opts || {};
  var warnings = [];

  var v = validateTask(task);
  if (!v.valid) {
    return {
      dispatched: false,
      status: 'rejected',
      result: null,
      execution: null,
      blockers: v.errors,
      warnings: warnings
    };
  }

  var routed = router.routeTask(task);

  // Claude-retained work never becomes a subprocess.
  if (routed.decision === router.DECISIONS.CLAUDE) {
    return {
      dispatched: false,
      status: 'retained',
      result: PROVIDERS.claude.run(task).result,
      execution: null,
      blockers: [],
      warnings: warnings.concat(['ROUTED_TO_CLAUDE: performed by the orchestrating session'])
    };
  }

  var pre = gitlib.preflight(task, { skipFetch: opts.skipFetch });
  warnings = warnings.concat(pre.warnings);
  if (!pre.ok) {
    return {
      dispatched: false,
      status: 'blocked',
      result: null,
      execution: null,
      blockers: pre.blockers,
      warnings: warnings
    };
  }

  var provider = PROVIDERS[task.assigned_provider];
  if (!provider) {
    return {
      dispatched: false, status: 'rejected', result: null, execution: null,
      blockers: ['UNKNOWN_PROVIDER: ' + task.assigned_provider], warnings: warnings
    };
  }
  if (!opts.dryRun && !provider.available(opts.bin)) {
    return {
      dispatched: false, status: 'blocked', result: null, execution: null,
      blockers: ['PROVIDER_UNAVAILABLE: ' + task.assigned_provider + ' CLI not runnable'], warnings: warnings
    };
  }

  store.ensureTaskDir(task.task_id);
  var paths = taskPaths(task);

  store.writeJSON(task.task_id, 'task.json', task);
  var templateText = fs.readFileSync(path.join(BASE, 'templates', 'codex-task.md'), 'utf8');
  store.writeText(task.task_id, 'prompt.md', provider.renderPrompt(task, templateText));

  // A stale result from a previous attempt must never be mistaken for this
  // run's output.
  if (fs.existsSync(paths.result)) fs.unlinkSync(paths.result);

  writeStatus(task, {
    task_id: task.task_id,
    stage: task.stage,
    provider: task.assigned_provider,
    branch: task.branch,
    baseline: task.baseline_commit,
    state: 'running',
    pid: process.pid,
    started_at: new Date().toISOString(),
    provider_version: provider.version(opts.bin),
    execution_level: task.execution_level,
    risk_class: task.risk_class
  });

  if (opts.dryRun) {
    writeStatus(task, { state: 'dry-run', finished_at: new Date().toISOString() });
    return {
      dispatched: false,
      status: 'dry-run',
      result: null,
      execution: { command: provider.buildArgs(task, paths, opts).join(' ') },
      blockers: [],
      warnings: warnings.concat(['DRY_RUN: provider not launched'])
    };
  }

  var notifyStart = notify('task_started', task.stage, task.task_id);
  if (!notifyStart.sent) warnings.push(notifyStart.warning);

  var execution = provider.run(task, paths, opts);

  // ---- Result capture. Exit code alone never decides the outcome. ----
  var raw = null, parsed = null, parseError = null;
  if (fs.existsSync(paths.result)) {
    raw = fs.readFileSync(paths.result, 'utf8');
    try { parsed = JSON.parse(raw); } catch (e) { parseError = e.message; }
  }

  var blockers = [];
  var status;

  if (execution.timed_out) {
    status = 'failed';
    blockers.push('TIMEOUT: provider exceeded ' + task.timeout_seconds + 's and was terminated');
  } else if (parsed === null) {
    status = 'failed';
    blockers.push(parseError
      ? 'MALFORMED_RESULT: result file is not valid JSON (' + parseError + ')'
      : 'MISSING_RESULT: provider produced no structured result — this is never treated as success');
  } else {
    var rv = validateResult(parsed);
    if (!rv.valid) {
      status = 'failed';
      blockers.push('INVALID_RESULT: ' + rv.errors.join('; '));
    } else if (parsed.task_id !== task.task_id) {
      status = 'failed';
      blockers.push('RESULT_TASK_ID_MISMATCH: result claims ' + parsed.task_id);
    } else if (execution.exit_code !== 0) {
      status = 'failed';
      blockers.push('NONZERO_EXIT: provider exited ' + execution.exit_code);
    } else {
      status = parsed.status; // completed | blocked | failed | cancelled
    }
  }

  writeStatus(task, {
    state: status,
    pid: null,
    finished_at: new Date().toISOString(),
    exit_code: execution.exit_code,
    duration_ms: execution.duration_ms,
    timed_out: execution.timed_out,
    provider_status: parsed ? parsed.status : null
  });

  var event = status === 'completed' ? 'task_completed'
    : (parsed && parsed.blocked_reason === 'approval_required') ? 'approval_required'
      : status === 'blocked' ? 'approval_required' : 'task_failed';
  var n = notify(event, task.stage, task.task_id);
  if (!n.sent) warnings.push(n.warning);

  return {
    dispatched: true,
    status: status,
    result: parsed ? redact.redactValue(parsed) : null,
    execution: {
      exit_code: execution.exit_code,
      duration_ms: execution.duration_ms,
      timed_out: execution.timed_out,
      signal: execution.signal,
      provider: execution.provider
    },
    blockers: blockers,
    warnings: warnings,
    paths: { dir: paths.dir, stdout: paths.stdout, stderr: paths.stderr, result: paths.result }
  };
}

module.exports = {
  validateTask: validateTask,
  validateResult: validateResult,
  taskPaths: taskPaths,
  writeStatus: writeStatus,
  notify: notify,
  execute: execute,
  TASK_SCHEMA: TASK_SCHEMA,
  RESULT_SCHEMA: RESULT_SCHEMA,
  PROVIDERS: PROVIDERS
};
