'use strict';
// =====================================================
// Mythos AI Executor — core engine
// projects/mythos-ai-executor/executor.js
//
// The persistent execution engine between n8n and the AI providers
// (mission §5). One task at a time, every state durable, every
// transition evented, quota exhaustion a scheduled pause rather than a
// failure, and Git as the final arbiter of what actually happened.
//
//   n8n → HTTP API (server.js) → task store (lib/state.js)
//                                     ↓
//                              executor.tick()          ← systemd daemon
//                                     ↓
//                        providers/claude-code.js       (execution)
//                        providers/openai-compat.js     (advisory)
//                                     ↓
//                   report → docs/AI_EXECUTION_REPORT.md → git push
// =====================================================

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var state = require('./lib/state');
var quota = require('./lib/quota');
var policy = require('./lib/policy');
var reporting = require('./lib/report');

var schema = require('../mythos-orchestrator/lib/schema');
var redact = require('../mythos-orchestrator/lib/redact');
var gitlib = require('../mythos-orchestrator/lib/git');

// Feeds this file's own /health reachability probes into core/agent-registry
// selection (capability N — provider health). A leaf module with no
// back-reference to executor.js, so this stays a one-way dependency.
var providerHealth = require('./core/provider-health');

var TASK_SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'schemas', 'task.schema.json'), 'utf8'));
var PROMPT_TEMPLATE = fs.readFileSync(path.join(__dirname, 'templates', 'task-prompt.md'), 'utf8');
var PROJECTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'projects.json'), 'utf8'));

var PROVIDERS = {
  'claude-code': require('./providers/claude-code'),
  'openai-compat': require('./providers/openai-compat')
};
// The mock provider is test-only and must be impossible to reach in
// production: the systemd unit never sets this variable.
if (process.env.MYTHOS_EXECUTOR_ALLOW_MOCK === '1') {
  PROVIDERS.mock = require('./providers/mock');
}

var NOTIFY_SH = path.join(__dirname, '..', 'mythos-orchestrator', 'notify.sh');
var PRIORITY_WEIGHT = { high: 0, normal: 1, low: 2 };

// --- Task creation ----------------------------------------------------------

function newTaskId() {
  var ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  var rand = Math.random().toString(36).slice(2, 8);
  return 't-' + ts + '-' + rand;
}

// Normalises an intake payload (from n8n or the CLI) into a full task
// record, applies defaults, validates against the schema, and refuses
// anything carrying a secret. The INSTRUCTION IS DATA (mission §12):
// nothing in it can change provider, profile, or paths.
function createTask(input) {
  if (!input || typeof input !== 'object') throw new Error('INVALID_TASK: payload is not an object');

  var project = String(input.project || '');
  var projectCfg = PROJECTS[project];
  if (!projectCfg) throw new Error('UNKNOWN_PROJECT: "' + project.slice(0, 60) + '" is not registered in config/projects.json');

  var provider = input.provider || 'claude-code';
  var providerImpl = PROVIDERS[provider];
  if (!providerImpl) throw new Error('UNKNOWN_PROVIDER: ' + String(provider).slice(0, 40));

  var isExecution = providerImpl.executionAuthority === true ||
    (provider === 'mock'); // mock stands in for the execution provider in tests

  var task = {
    schema_version: '1.0.0',
    task_id: newTaskId(),
    project: project,
    stage: input.stage || 'unstaged',
    instruction: String(input.instruction || ''),
    priority: input.priority || 'normal',
    created_at: new Date().toISOString(),
    requested_by: input.requested_by || 'n8n',
    mode: input.mode || 'autonomous',
    provider: provider,
    model: input.model || null,
    fallback_model: input.fallback_model || null,
    // Advisory providers NEVER get a working directory or an execution
    // profile — they reason, they do not act (mission §9).
    execution_profile: isExecution ? (input.execution_profile || policy.DEFAULT_PROFILE) : null,
    working_directory: isExecution ? (input.working_directory || projectCfg.path) : null,
    repository: projectCfg.repository || null,
    branch: input.branch || projectCfg.default_branch || null,
    required_tests: input.required_tests || [],
    constraints: input.constraints || [],
    expected_delivery: input.expected_delivery || 'report',
    report_to_git: input.report_to_git !== false,
    timeout_seconds: input.timeout_seconds || 3600,
    max_retries: input.max_retries === undefined ? 3 : input.max_retries,
    max_turns: input.max_turns || null
  };

  if (!task.instruction.trim()) throw new Error('INVALID_TASK: instruction is empty');

  // Fail closed on disabled profiles before anything persists.
  if (task.execution_profile) policy.getProfile(task.execution_profile);

  var secretKinds = redact.findSecretKinds(JSON.stringify(task));
  if (secretKinds.length) {
    throw new Error('TASK_CARRIES_SECRET: refusing task containing ' + secretKinds.join(', ') +
      ' — credentials never travel in task envelopes');
  }

  var check = schema.validate(task, TASK_SCHEMA);
  if (!check.valid) throw new Error('TASK_SCHEMA_INVALID: ' + check.errors.join('; '));

  state.ensureTaskDir(task.task_id);
  state.writeJSON(task.task_id, 'task.json', task);
  state.writeJSON(task.task_id, 'status.json', {
    task_id: task.task_id,
    status: 'QUEUED',
    execution_id: null,
    claude_session_id: null,
    retry_count: 0,
    quota_state: { waits: 0, detected_at: null, reset_at: null, resume_after: null },
    last_checkpoint: null,
    next_action: 'await daemon pick-up',
    pid: null,
    created_at: task.created_at,
    updated_at: task.created_at
  });
  state.appendEvent(task.task_id, 'created', {
    project: task.project, stage: task.stage, provider: task.provider,
    model: task.model, status: 'QUEUED'
  });
  return task;
}

// --- Checkpointing (mission §15) ---------------------------------------------

function writeCheckpoint(task, status, fields) {
  var git = null;
  if (task.working_directory && gitlib.isRepo(task.working_directory)) {
    git = {
      commit: gitlib.head(task.working_directory),
      branch: gitlib.currentBranch(task.working_directory),
      dirty: gitlib.isDirty(task.working_directory)
    };
  }
  var checkpoint = {
    task_id: task.task_id,
    timestamp: new Date().toISOString(),
    project: task.project,
    stage: task.stage,
    git: git,
    claude_session_id: status.claude_session_id,
    status: status.status,
    completed_steps: (fields && fields.completed_steps) || [],
    current_step: (fields && fields.current_step) || null,
    pending_steps: (fields && fields.pending_steps) || [],
    tests: (fields && fields.tests) || null,
    deployment_state: 'none',
    next_action: (fields && fields.next_action) || status.next_action || null
  };
  state.writeJSON(task.task_id, 'checkpoint.json', checkpoint);
  var st = state.readStatus(task.task_id);
  st.last_checkpoint = checkpoint.timestamp;
  state.writeJSON(task.task_id, 'status.json', st);
  return checkpoint;
}

// --- Prompt construction ------------------------------------------------------

function fill(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, function (_m, key) {
    var v = vars[key];
    return v === undefined || v === null ? '(none)' : String(v);
  });
}

function buildPrompt(task, status, resumeNote) {
  var checkpoint = state.readJSON(task.task_id, 'checkpoint.json');
  var prevReport = state.readJSON(task.task_id, 'report.json');
  return fill(PROMPT_TEMPLATE, {
    TASK_ID: task.task_id,
    PROJECT: task.project,
    REPOSITORY: task.repository,
    BRANCH: task.branch,
    STAGE: task.stage,
    OBJECTIVE: task.instruction,
    CONSTRAINTS: (task.constraints || []).map(function (c) { return '- ' + c; }).join('\n') || '(none beyond repository rules)',
    REQUIRED_TESTS: (task.required_tests || []).map(function (t) { return '- ' + t; }).join('\n') || '(choose targeted tests per AGENTS.md §8)',
    EXPECTED_DELIVERY: task.expected_delivery,
    PREVIOUS_CHECKPOINT: checkpoint ? JSON.stringify(checkpoint, null, 2) : '(first run — none)',
    PREVIOUS_REPORT: prevReport && prevReport.report ? JSON.stringify(prevReport.report, null, 2) : '(none)',
    RESUME_NOTE: resumeNote || '(first run)'
  });
}

// --- Git verification and report delivery -------------------------------------

function verifyGit(task, report) {
  var extras = { git_verified: null, remote_head: null };
  if (!task.working_directory || !gitlib.isRepo(task.working_directory)) return extras;
  try {
    var head = gitlib.head(task.working_directory);
    extras.local_head = head;
    if (task.branch) {
      var remote = gitlib.remoteBranchHead(task.working_directory, task.branch);
      extras.remote_head = remote;
    }
    if (report && report.commit) {
      var exists = gitlib.commitExists(task.working_directory, report.commit);
      extras.git_verified = exists && (!extras.remote_head ||
        gitlib.isAncestor(task.working_directory, report.commit, extras.remote_head));
      if (!exists) extras.problem = 'claimed commit does not exist locally';
    } else if (task.expected_delivery === 'commit') {
      extras.git_verified = false;
      extras.problem = 'delivery expected a commit but the report claims none';
    }
  } catch (e) {
    extras.git_verified = false;
    extras.problem = 'git verification error: ' + e.message;
  }
  return extras;
}

// On this host the GitHub key lives only in an SSH agent created by
// interactive sessions (~/.ssh/agent/<socket>), never on disk. The systemd
// user manager exports SSH_AUTH_SOCK=/run/user/<uid>/gcr/ssh — a GNOME
// keyring agent holding NO identities — so a socket cannot be trusted for
// being set; it must be PROBED. `ssh-add -l` exits 0 only when the agent
// holds at least one identity. Candidates: the preset socket first, then
// every socket under ~/.ssh/agent newest-first. If none holds a key the
// environment is returned unchanged and the push fails honestly.
// Residual risk (documented in the handover): a reboot severs push
// authority until a session recreates the agent or the owner provisions a
// dedicated deploy key.
function agentHasKeys(sock) {
  try {
    cp.execFileSync('ssh-add', ['-l'], {
      env: Object.assign({}, process.env, { SSH_AUTH_SOCK: sock }),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000
    });
    return true;
  } catch (e) {
    return false;
  }
}

function sshEnv(probe) {
  probe = probe || agentHasKeys;
  var env = Object.assign({}, process.env);
  var candidates = [];
  if (env.SSH_AUTH_SOCK) candidates.push(env.SSH_AUTH_SOCK);
  var agentDir = path.join(env.HOME || '/home/ubuntu', '.ssh', 'agent');
  try {
    fs.readdirSync(agentDir)
      .map(function (f) { return path.join(agentDir, f); })
      .filter(function (p) {
        try { return fs.statSync(p).isSocket(); } catch (e) { return false; }
      })
      .sort(function (a, b) { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; })
      .forEach(function (p) { if (candidates.indexOf(p) === -1) candidates.push(p); });
  } catch (e) { /* no agent directory */ }
  for (var i = 0; i < candidates.length; i++) {
    if (probe(candidates[i])) {
      env.SSH_AUTH_SOCK = candidates[i];
      return env;
    }
  }
  return env;
}

// Appends the human-readable report to docs/AI_EXECUTION_REPORT.md in the
// project repository, commits only that file, and pushes. GitHub is the
// durable handover channel (mission §17) — but a push failure degrades to
// a recorded warning, never to a lost task state.
function commitReportToGit(task, status, markdown) {
  var repoPath = (PROJECTS[task.project] || {}).path;
  if (!repoPath || !gitlib.isRepo(repoPath)) return { committed: false, reason: 'no repository for project' };
  var reportFile = path.join(repoPath, 'docs', 'AI_EXECUTION_REPORT.md');
  try {
    var header = '# Mythos AI Executor — Execution Reports\n\n' +
      'Newest first. Written automatically by projects/mythos-ai-executor; no secrets.\n\n---\n\n';
    var existing = fs.existsSync(reportFile) ? fs.readFileSync(reportFile, 'utf8') : '';
    var body = existing.indexOf('# Mythos AI Executor') === 0
      ? existing.replace(header, '')
      : existing;
    fs.writeFileSync(reportFile, header + markdown + '\n\n---\n\n' + body, 'utf8');
    cp.execFileSync('git', ['add', 'docs/AI_EXECUTION_REPORT.md'], { cwd: repoPath, stdio: 'pipe' });
    cp.execFileSync('git', ['commit', '-m',
      'report(mythos-ai-executor): task ' + task.task_id + ' ' + status.status.toLowerCase() +
      '\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>'],
      { cwd: repoPath, stdio: 'pipe' });
    cp.execFileSync('git', ['push'], { cwd: repoPath, stdio: 'pipe', timeout: 60000, env: sshEnv() });
    var head = gitlib.head(repoPath);
    return { committed: true, commit: head };
  } catch (e) {
    return { committed: false, reason: 'git report delivery failed: ' + String(e.message).slice(0, 300) };
  }
}

// --- Notification (best-effort, never control flow) ----------------------------

function notify(event, stage, detail) {
  try {
    var child = cp.spawn(NOTIFY_SH, [event, stage, String(detail || '').slice(0, 180)], {
      detached: true, stdio: 'ignore'
    });
    child.unref();
  } catch (e) { /* notification is telemetry, never control flow */ }
}

// --- Execution ------------------------------------------------------------------

function tailOf(text, n) {
  if (typeof text !== 'string') return '';
  return text.length > n ? text.slice(-n) : text;
}

// Runs (or resumes) one task to its next durable state. Returns the final
// status object. `opts._recreated` guards the single session-recreation
// retry against loops.
function runTask(taskId, opts) {
  opts = opts || {};
  var task = state.readJSON(taskId, 'task.json');
  var status = state.readStatus(taskId);
  if (!task || !status) return Promise.reject(new Error('NO_SUCH_TASK: ' + taskId));

  var from = status.status;
  var eff = state.effectiveStatus(status);
  var startable = ['QUEUED', 'WAITING_RETRY', 'WAITING_FOR_QUOTA'];
  if (startable.indexOf(from) === -1 && eff !== 'INTERRUPTED' && !opts._recreated) {
    return Promise.reject(new Error('NOT_STARTABLE: task ' + taskId + ' is ' + from));
  }

  var provider = PROVIDERS[task.provider];
  if (!provider) return Promise.reject(new Error('UNKNOWN_PROVIDER: ' + task.provider));

  var isResume = !!status.claude_session_id && !opts._recreated;
  var sessionId = status.claude_session_id ||
    (provider.newSessionId ? provider.newSessionId() : null);
  var mode = isResume ? 'resume' : 'start';
  var executionId = 'x-' + Date.now().toString(36);

  if (!opts._recreated) {
    status = state.transition(taskId, 'RUNNING', {
      execution_id: executionId,
      claude_session_id: sessionId,
      started_at: status.started_at || new Date().toISOString(),
      last_run_started_at: new Date().toISOString(),
      daemon_pid: process.pid,
      pid: null,
      next_action: 'provider running'
    });
  }
  writeCheckpoint(task, state.readStatus(taskId), {
    current_step: mode === 'resume' ? 'provider_resume' : 'provider_launch'
  });
  state.appendEvent(taskId, 'provider_launch', {
    execution_id: executionId, project: task.project, stage: task.stage,
    provider: task.provider, model: task.model, mode: mode, status: 'RUNNING'
  });
  if (mode === 'start') notify('task_started', task.stage, taskId + ' ' + task.project);

  var resumeNote = null;
  if (mode === 'resume') {
    resumeNote = 'This is a RESUME of an interrupted execution (' +
      (from === 'WAITING_FOR_QUOTA' ? 'quota window reopened' : 'retry after ' + from) +
      '). Re-read the checkpoint, verify repository state with git status/log before acting, and continue from the last completed step — do not restart work that is already committed.';
  } else if (opts._recreated) {
    resumeNote = 'The previous session could not be resumed (missing session). This is a FRESH session: the previous checkpoint and report above are your only continuity — trust Git over memory.';
  }

  var prompt = buildPrompt(task, status, resumeNote);
  state.writeText(taskId, 'prompt.md', prompt);

  return provider.run(task, prompt, sessionId, mode, {}, function onSpawn(childPid) {
    var st = state.readStatus(taskId);
    st.pid = childPid;
    state.writeJSON(taskId, 'status.json', st);
  }).then(function (outcome) {
    state.writeText(taskId, 'stdout.log', outcome.stdout || '');
    state.writeText(taskId, 'stderr.log', outcome.stderr || '');

    var parsed = outcome.parsed;
    var succeeded = parsed && parsed.is_error === false && !outcome.timed_out && outcome.exit_code === 0;

    if (succeeded) return handleSuccess(task, taskId, outcome, parsed);
    return handleFailure(task, taskId, outcome, mode, opts);
  });
}

function handleSuccess(task, taskId, outcome, parsed) {
  var resultText = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
  var extracted = reporting.extractReport(resultText);
  var problems = extracted.report ? reporting.validateReport(extracted.report) : [extracted.error];
  var report = extracted.report;

  var extras = verifyGit(task, report);
  if (extras.problem) problems.push(extras.problem);
  extras.report_problems = problems.filter(Boolean);

  var finalState = 'COMPLETED';
  var nextAction = report && report.next_stage ? String(report.next_stage) : 'review report';
  if (report && report.status === 'failed') { finalState = 'FAILED'; nextAction = 'inspect failure report'; }
  if (report && report.status === 'blocked') { finalState = 'BLOCKED'; nextAction = 'owner decision required: ' + (report.summary || ''); }
  // A "successful" run that produced no usable report is not a clean
  // completion — it lands BLOCKED for review rather than silently green.
  if (!report) { finalState = 'BLOCKED'; nextAction = 'provider produced no structured report — review stdout.log'; }

  var status = state.transition(taskId, finalState, {
    ended_at: new Date().toISOString(),
    pid: null,
    claude_session_id: outcome.session_id,
    next_action: nextAction,
    last_error: null,
    cost_usd: parsed.total_cost_usd || null
  });

  state.writeJSON(taskId, 'report.json', {
    task_id: taskId, report: report, problems: extras.report_problems,
    git: extras, provider_result_tail: tailOf(resultText, 4000)
  });
  var md = reporting.renderMarkdown(task, status, report, extras);
  state.writeText(taskId, 'report.md', md);
  writeCheckpoint(task, status, {
    current_step: 'done', completed_steps: ['provider_run', 'report'],
    tests: report && report.tests, next_action: nextAction
  });

  var delivery = { committed: false, reason: 'report_to_git disabled for this task' };
  if (task.report_to_git) delivery = commitReportToGit(task, status, md);
  state.appendEvent(taskId, 'finished', {
    project: task.project, stage: task.stage, provider: task.provider,
    status: finalState, report_committed: delivery.committed,
    report_commit: delivery.commit || null, delivery_problem: delivery.reason || null
  });
  notify(finalState === 'COMPLETED' ? 'task_completed' : 'task_failed', task.stage,
    taskId + ' ' + finalState + (delivery.commit ? ' report@' + String(delivery.commit).slice(0, 7) : ''));
  return state.readStatus(taskId);
}

function handleFailure(task, taskId, outcome, mode, opts) {
  var parsedText = outcome.parsed && typeof outcome.parsed.result === 'string' ? outcome.parsed.result : '';
  var text = parsedText + '\n' + tailOf(outcome.stderr, 4000) + '\n' + tailOf(outcome.stdout, 2000);
  var provider = PROVIDERS[task.provider];
  var status = state.readStatus(taskId);

  // Missing session on resume: recreate ONCE with checkpoint context.
  if (mode === 'resume' && provider.isMissingSession && provider.isMissingSession(outcome) && !opts._recreated) {
    state.appendEvent(taskId, 'session_recreated', {
      old_session: status.claude_session_id, status: 'RUNNING'
    });
    var st = state.readStatus(taskId);
    st.claude_session_id = provider.newSessionId ? provider.newSessionId() : null;
    state.writeJSON(taskId, 'status.json', st);
    return runTask(taskId, { _recreated: true });
  }

  var kind = outcome.timed_out ? 'transient' : quota.classifyFailure(text);
  var now = Date.now();

  if (kind === 'quota') {
    // CORE REQUIREMENT (mission §7): not a failure. Same session resumes.
    var waits = (status.quota_state && status.quota_state.waits) || 0;
    var resetAt = quota.parseResetTime(text, now);
    var resumeAfter = quota.quotaResumeAt(resetAt, waits, now);
    var updated = state.transition(taskId, 'WAITING_FOR_QUOTA', {
      pid: null,
      quota_state: {
        waits: waits + 1,
        detected_at: new Date(now).toISOString(),
        reset_at: resetAt ? new Date(resetAt).toISOString() : null,
        resume_after: new Date(resumeAfter).toISOString()
      },
      next_action: 'automatic resume of session after ' + new Date(resumeAfter).toISOString(),
      last_error: 'quota exhausted'
    });
    writeCheckpoint(task, updated, {
      current_step: 'waiting_for_quota',
      next_action: 'resume same claude session ' + (updated.claude_session_id || '')
    });
    state.appendEvent(taskId, 'quota_exhausted', {
      project: task.project, provider: task.provider, status: 'WAITING_FOR_QUOTA',
      reset_at: updated.quota_state.reset_at, resume_after: updated.quota_state.resume_after
    });
    notify('task_failed', task.stage, taskId + ' WAITING_FOR_QUOTA until ' + updated.quota_state.resume_after);
    return updated;
  }

  if (kind === 'transient') {
    var retryCount = (status.retry_count || 0) + 1;
    if (retryCount > (task.max_retries === undefined ? 3 : task.max_retries)) {
      var failed = state.transition(taskId, 'FAILED', {
        pid: null, retry_count: retryCount, ended_at: new Date().toISOString(),
        last_error: 'transient failures exceeded max_retries: ' + tailOf(text.trim(), 300),
        next_action: 'inspect logs; re-queue explicitly if appropriate'
      });
      state.appendEvent(taskId, 'retries_exhausted', { retry_count: retryCount, status: 'FAILED' });
      notify('task_failed', task.stage, taskId + ' FAILED after ' + retryCount + ' retries');
      return failed;
    }
    var retryAt = new Date(now + quota.retryDelayMs(retryCount - 1)).toISOString();
    var waiting = state.transition(taskId, 'WAITING_RETRY', {
      pid: null, retry_count: retryCount, retry_at: retryAt,
      last_error: tailOf(text.trim(), 300),
      next_action: 'automatic retry after ' + retryAt
    });
    state.appendEvent(taskId, 'transient_failure', { retry_count: retryCount, retry_at: retryAt, status: 'WAITING_RETRY' });
    return waiting;
  }

  var terminal = kind === 'blocked' ? 'BLOCKED' : 'FAILED';
  var final = state.transition(taskId, terminal, {
    pid: null, ended_at: new Date().toISOString(),
    last_error: tailOf(text.trim(), 500),
    next_action: terminal === 'BLOCKED'
      ? 'genuine human blocker — resolve credential/authorization and re-queue'
      : 'permanent failure — inspect stderr.log'
  });
  writeCheckpoint(task, final, { current_step: terminal.toLowerCase() });
  state.appendEvent(taskId, kind + '_failure', { status: terminal });
  notify('task_failed', task.stage, taskId + ' ' + terminal);
  return final;
}

// --- Daemon loop ------------------------------------------------------------------

function summaries() {
  return state.listTasks().map(function (id) {
    var st = state.readStatus(id) || {};
    var task = state.readJSON(id, 'task.json') || {};
    return {
      task_id: id, project: task.project, stage: task.stage,
      provider: task.provider, priority: task.priority || 'normal',
      status: st.status, effective: state.effectiveStatus(st),
      created_at: task.created_at, updated_at: st.updated_at,
      retry_count: st.retry_count, quota_state: st.quota_state,
      claude_session_id: st.claude_session_id, next_action: st.next_action,
      core_owned: task.requested_by === CORE_OWNER
    };
  });
}

// Tasks created by the orchestration core are driven BY the core: it
// dispatches, validates, retries and cancels them. The daemon must not
// also pick them up, or both would race for the same task (whoever wins
// the RUNNING transition makes the other fail) and a quota-parked task
// could be resumed behind the core's back. With the core disabled no such
// task exists, so Phase 1 behaviour is unchanged.
var CORE_OWNER = 'orchestration-core';

function daemonOwned(s) { return !s.core_owned; }

// One scheduler step. At most one task runs at a time; recovery precedes
// resumption precedes fresh starts. Returns what it did so tests (and the
// daemon log) can assert on decisions rather than sleep-and-hope.
function tick(now) {
  now = now || Date.now();
  var all = summaries();
  var actions = [];

  // 1. Convert interrupted RUNNING tasks (dead pid) into immediate retries.
  // Core-owned tasks are skipped: the core owns their recovery.
  all.filter(daemonOwned).forEach(function (s) {
    if (s.effective === 'INTERRUPTED') {
      state.transition(s.task_id, 'WAITING_RETRY', {
        pid: null, retry_at: new Date(now).toISOString(),
        last_error: 'execution interrupted (process gone)',
        next_action: 'resume from checkpoint'
      });
      state.appendEvent(s.task_id, 'interrupted_recovered', { status: 'WAITING_RETRY' });
      actions.push({ action: 'recovered', task_id: s.task_id });
    }
  });

  var refreshed = summaries().filter(daemonOwned);
  var running = refreshed.filter(function (s) { return s.status === 'RUNNING'; });
  if (running.length) return Promise.resolve(actions.concat([{ action: 'busy', task_id: running[0].task_id }]));

  // 2. Resume a quota-paused task whose window has reopened.
  var dueQuota = refreshed.filter(function (s) {
    return s.status === 'WAITING_FOR_QUOTA' && s.quota_state &&
      s.quota_state.resume_after && Date.parse(s.quota_state.resume_after) <= now;
  }).sort(function (a, b) { return Date.parse(a.quota_state.resume_after) - Date.parse(b.quota_state.resume_after); });
  if (dueQuota.length) {
    actions.push({ action: 'resume_quota', task_id: dueQuota[0].task_id });
    return runTask(dueQuota[0].task_id).then(function () { return actions; });
  }

  // 3. Retry a task whose backoff has elapsed.
  var dueRetry = refreshed.filter(function (s) {
    var st = state.readStatus(s.task_id);
    return s.status === 'WAITING_RETRY' && st.retry_at && Date.parse(st.retry_at) <= now;
  });
  if (dueRetry.length) {
    actions.push({ action: 'retry', task_id: dueRetry[0].task_id });
    return runTask(dueRetry[0].task_id).then(function () { return actions; });
  }

  // 4. Start the next queued task: priority first, then FIFO.
  var queued = refreshed.filter(function (s) { return s.status === 'QUEUED'; })
    .sort(function (a, b) {
      var pw = (PRIORITY_WEIGHT[a.priority] || 1) - (PRIORITY_WEIGHT[b.priority] || 1);
      return pw !== 0 ? pw : String(a.created_at).localeCompare(String(b.created_at));
    });
  if (queued.length) {
    actions.push({ action: 'start', task_id: queued[0].task_id });
    return runTask(queued[0].task_id).then(function () { return actions; });
  }

  return Promise.resolve(actions.length ? actions : [{ action: 'idle' }]);
}

// --- Health (mission §22) -----------------------------------------------------------

var healthCache = { at: 0, claude: null };

function httpProbe(urlStr, timeoutMs) {
  return new Promise(function (resolve) {
    var http = require('http');
    var req = http.get(urlStr, { timeout: timeoutMs || 2000 }, function (res) {
      res.resume();
      resolve({ ok: res.statusCode < 500, code: res.statusCode });
    });
    req.on('timeout', function () { req.destroy(); resolve({ ok: false, code: null }); });
    req.on('error', function () { resolve({ ok: false, code: null }); });
  });
}

function health() {
  var storeOk = true;
  try {
    fs.mkdirSync(state.tasksRoot(), { recursive: true });
    fs.accessSync(state.tasksRoot(), fs.constants.W_OK);
  } catch (e) { storeOk = false; }

  if (Date.now() - healthCache.at > 5 * 60 * 1000) {
    healthCache.claude = PROVIDERS['claude-code'] ? PROVIDERS['claude-code'].version() : null;
    healthCache.at = Date.now();
  }

  var counts = {};
  summaries().forEach(function (s) { counts[s.status] = (counts[s.status] || 0) + 1; });

  return Promise.all([
    httpProbe('http://127.0.0.1:5678/healthz'),
    httpProbe('http://127.0.0.1:20128/')
  ]).then(function (probes) {
    // Record the real reachability this call just observed so provider
    // selection (core/agent-registry.js) reflects it, not only credential
    // presence — this is the only place that performs these probes.
    providerHealth.record('n8n', probes[0].ok);
    providerHealth.record('omniroute', probes[1].ok);

    var checks = {
      store_writable: storeOk,
      claude_cli: healthCache.claude,
      n8n: probes[0],
      omniroute: probes[1],
      queue: counts
    };
    var ok = storeOk && !!healthCache.claude && probes[0].ok;
    return { ok: ok, time: new Date().toISOString(), checks: checks };
  });
}

// --- Daemon entry -----------------------------------------------------------------

var LOCK_NAME = 'daemon.lock';

function acquireDaemonLock() {
  var lock = path.join(state.root(), LOCK_NAME);
  fs.mkdirSync(state.root(), { recursive: true });
  if (fs.existsSync(lock)) {
    var oldPid = parseInt(fs.readFileSync(lock, 'utf8'), 10);
    if (state.processAlive(oldPid)) return null;
  }
  fs.writeFileSync(lock, String(process.pid), { mode: 0o600 });
  return lock;
}

function daemon(intervalMs) {
  intervalMs = intervalMs || parseInt(process.env.MYTHOS_EXECUTOR_INTERVAL_MS || '15000', 10);
  var lock = acquireDaemonLock();
  if (!lock) {
    console.error('another executor daemon is already running; refusing to double-run');
    process.exit(1);
  }
  var stopping = false;
  var busy = false;
  function step() {
    if (stopping || busy) return;
    busy = true;
    tick().then(function (actions) {
      busy = false;
      var meaningful = actions.filter(function (a) { return a.action !== 'idle'; });
      if (meaningful.length) console.log(JSON.stringify({ ts: new Date().toISOString(), tick: meaningful }));
    }).catch(function (err) {
      busy = false;
      console.error(JSON.stringify({ ts: new Date().toISOString(), tick_error: redact.redact(err.message) }));
    });
  }
  var timer = setInterval(step, intervalMs);
  step();
  function shutdown() {
    stopping = true;
    clearInterval(timer);
    try { fs.unlinkSync(lock); } catch (e) { /* already gone */ }
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  console.log(JSON.stringify({
    ts: new Date().toISOString(), daemon: 'started', pid: process.pid,
    home: state.root(), interval_ms: intervalMs
  }));
}

module.exports = {
  PROVIDERS: PROVIDERS,
  PROJECTS: PROJECTS,
  createTask: createTask,
  buildPrompt: buildPrompt,
  runTask: runTask,
  tick: tick,
  summaries: summaries,
  health: health,
  daemon: daemon,
  writeCheckpoint: writeCheckpoint,
  verifyGit: verifyGit,
  commitReportToGit: commitReportToGit,
  sshEnv: sshEnv,
  acquireDaemonLock: acquireDaemonLock
};
