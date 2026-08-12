'use strict';
// =====================================================
// Mythos Orchestrator — Codex provider adapter
// projects/mythos-orchestrator/providers/codex.js
//
// Wraps the REAL installed Codex CLI. Verified against codex-cli 0.147.0
// on this host; the invocation contract below was read from
// `codex exec --help`, not assumed:
//
//   codex exec [PROMPT]            non-interactive run; '-' or piped stdin
//                                  also supplies the prompt
//     -C, --cd <DIR>               working root
//     -s, --sandbox <MODE>         read-only | workspace-write | danger-full-access
//     -m, --model <MODEL>          model selection
//     --output-schema <FILE>       JSON Schema constraining the final message
//     -o, --output-last-message <FILE>   final message written here
//     --json                       JSONL event stream on stdout
//     --skip-git-repo-check        permit running outside a Git repo
//
// Exit code 0 means the CLI completed, NOT that the task succeeded. The
// authoritative signal is the structured result file; a zero exit with a
// missing or malformed result is a failure, never a success.
//
// Approval handling: the runner never passes
// --dangerously-bypass-approvals-and-sandbox. When Codex cannot proceed
// without an approval it can't obtain, it reports blocked/approval_required
// and Claude escalates to the user.
// =====================================================

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var PROVIDER_ID = 'codex';
var DEFAULT_BIN = process.env.MYTHOS_CODEX_BIN || 'codex';

// Sandbox mode by execution level. Level 1 tasks are read-only; level 2
// tasks may write inside their own worktree. Nothing here ever grants
// danger-full-access — that is a deliberate, permanent omission.
function sandboxForTask(task) {
  if (task.execution_level === 1 && !(task.delivery && task.delivery.commit_required)) {
    return 'read-only';
  }
  return 'workspace-write';
}

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

// Builds the exact argv used to launch Codex. Kept pure and exported so
// tests can assert on the command without executing it.
function buildArgs(task, paths, opts) {
  opts = opts || {};
  var args = ['exec'];

  args.push('--cd', task.working_directory);
  args.push('--sandbox', opts.sandbox || sandboxForTask(task));

  // A linked worktree keeps its HEAD, index, FETCH_HEAD, objects and refs in
  // the MAIN repository's Git directory. With only the worktree writable, the
  // sandbox denies `git fetch`/`git commit` and the worker correctly stops
  // with approval_required. Granting write to the shared Git directory is
  // what any commit from a linked worktree inherently requires; the branch,
  // baseline and diff-scope checks remain the guard against misuse.
  (opts.addDirs || []).forEach(function (dir) {
    if (dir) args.push('--add-dir', dir);
  });
  args.push('--output-schema', paths.resultSchema);
  args.push('--output-last-message', paths.result);
  args.push('--color', 'never');

  if (opts.model) args.push('--model', opts.model);
  if (opts.json) args.push('--json');

  // The prompt is passed via stdin ('-') rather than argv so that a long
  // prompt can never hit ARG_MAX and never appears in the process table.
  args.push('-');

  return args;
}

// Launches Codex synchronously and returns
// { exit_code, timed_out, duration_ms, signal }.
//
// stdout/stderr are streamed to persistent files rather than buffered, so
// a long task cannot exhaust memory and the logs survive a crash.
function run(task, paths, opts) {
  opts = opts || {};
  var bin = opts.bin || DEFAULT_BIN;
  var args = buildArgs(task, paths, opts);
  var prompt = fs.readFileSync(paths.prompt, 'utf8');

  var outFd = fs.openSync(paths.stdout, 'a', 0o600);
  var errFd = fs.openSync(paths.stderr, 'a', 0o600);
  var started = Date.now();

  try {
    var res = cp.spawnSync(bin, args, {
      cwd: task.working_directory,
      input: prompt,
      stdio: ['pipe', outFd, errFd],
      timeout: (task.timeout_seconds || 1800) * 1000,
      killSignal: 'SIGTERM',
      // Inherit the ambient environment (Codex needs CODEX_HOME/HOME to
      // find its own credentials) but never inject secrets ourselves.
      env: process.env
    });

    return {
      provider: PROVIDER_ID,
      command: bin + ' ' + args.join(' '),
      exit_code: typeof res.status === 'number' ? res.status : null,
      signal: res.signal || null,
      timed_out: res.error ? res.error.code === 'ETIMEDOUT' : (res.signal === 'SIGTERM'),
      duration_ms: Date.now() - started,
      spawn_error: res.error ? String(res.error.code || res.error.message) : null
    };
  } finally {
    try { fs.closeSync(outFd); } catch (e) { /* already closed */ }
    try { fs.closeSync(errFd); } catch (e) { /* already closed */ }
  }
}

// Renders the Codex prompt from the task and the shared template.
function renderPrompt(task, templateText) {
  var constraints = (task.constraints || []).length
    ? task.constraints.map(function (c) { return '- ' + c; }).join('\n')
    : '- (none beyond the non-negotiable rules above)';

  var tests = (task.required_tests || []).length
    ? task.required_tests.map(function (t) { return '- **' + t.name + '**: `' + t.command + '`'; }).join('\n')
    : '- (none declared — report an empty `tests` array)';

  var values = {
    TASK_ID: task.task_id,
    STAGE: task.stage,
    REPOSITORY: task.repository,
    WORKING_DIRECTORY: task.working_directory,
    BRANCH: task.branch,
    BASELINE_COMMIT: task.baseline_commit,
    RISK_CLASS: task.risk_class,
    EXECUTION_LEVEL: String(task.execution_level),
    OBJECTIVE: task.objective,
    INSTRUCTIONS: task.instructions,
    CONSTRAINTS: constraints,
    REQUIRED_TESTS: tests,
    COMMIT_REQUIRED: task.delivery.commit_required ? 'yes' : 'no',
    PUSH_REQUIRED: task.delivery.push_required ? 'yes' : 'no',
    HANDOVER_REQUIRED: task.delivery.handover_required ? 'yes' : 'no'
  };

  return templateText.replace(/\{\{([A-Z_]+)\}\}/g, function (match, key) {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });
}

module.exports = {
  PROVIDER_ID: PROVIDER_ID,
  DEFAULT_BIN: DEFAULT_BIN,
  version: version,
  available: available,
  sandboxForTask: sandboxForTask,
  buildArgs: buildArgs,
  renderPrompt: renderPrompt,
  run: run
};
