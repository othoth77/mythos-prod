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
var skills = require('./lib/skills');
var mcpCapabilities = require('./lib/mcp-capabilities');
var modelPolicy = require('./lib/model-policy');
var resourceGuard = require('./lib/resource-guard');
// Execution lifecycle registry (task / execution / session are three
// states, not one). Every call below is best-effort: a registry problem
// must never change what happens to a task.
var lifecycle = require('./lib/lifecycle');
// requested_action → execution_profile invariant and attempt immutability
// (shared with the GitHub bridge and the Issues adapter — one engine).
var engine = require('./bridge/action-resolution');

var schema = require('../mythos-orchestrator/lib/schema');
var redact = require('../mythos-orchestrator/lib/redact');
var gitlib = require('../mythos-orchestrator/lib/git');

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

// MOS-3A: the central dispatcher's capacity ceiling. `bin/mythos-ai-executor
// serve` runs server.start() and executor.daemon() in ONE process, so this
// in-process counter is a valid central gate for everything that starts a
// task through this module (tick, quota/retry resume, the /resume route,
// and the new /dispatch route). Clamped so a bad env value can neither
// starve the queue (0) nor blow past what the host can sustain.
var MAX_PARALLEL = (function () {
  var raw = parseInt(process.env.MYTHOS_MAX_PARALLEL, 10);
  if (isNaN(raw)) raw = 5;
  if (raw < 1) raw = 1;
  if (raw > 8) raw = 8;
  return raw;
})();

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
// M-12 PART 2: skill selection, MCP tools and MCP endpoints are all
// SERVER-SIDE decisions. Nothing an inbound payload names for any of
// these is ever honoured — the schema's additionalProperties:false would
// already drop an unrecognised key, but these six are refused explicitly
// and loudly rather than silently ignored, so a caller learns it tried to
// smuggle capability selection into a task envelope.
var FORBIDDEN_INPUT_FIELDS = ['skill_id', 'skill', 'mcp_server', 'mcp_tool', 'mcp_endpoint', 'mcp'];

function createTask(input) {
  if (!input || typeof input !== 'object') throw new Error('INVALID_TASK: payload is not an object');

  var forbidden = FORBIDDEN_INPUT_FIELDS.filter(function (f) {
    return Object.prototype.hasOwnProperty.call(input, f);
  });
  if (forbidden.length) {
    throw new Error('TASK_FORBIDDEN_FIELD: payload must not carry ' + forbidden.join(', ') +
      ' — skill selection and MCP capability resolution are server-side only');
  }

  var project = String(input.project || '');
  var projectCfg = PROJECTS[project];
  if (!projectCfg) throw new Error('UNKNOWN_PROJECT: "' + project.slice(0, 60) + '" is not registered in config/projects.json');

  var provider = input.provider || 'claude-code';
  var providerImpl = PROVIDERS[provider];
  if (!providerImpl) throw new Error('UNKNOWN_PROVIDER: ' + String(provider).slice(0, 40));

  var isExecution = providerImpl.executionAuthority === true ||
    (provider === 'mock'); // mock stands in for the execution provider in tests

  // Advisory providers NEVER get a working directory or an execution
  // profile — they reason, they do not act (mission §9). Resolved before
  // the record because the model policy scores against this profile.
  var executionProfile = isExecution ? (input.execution_profile || policy.DEFAULT_PROFILE) : null;

  // ACTION_PROFILE_MISMATCH — the central invariant. A task whose category is
  // one of the closed bridge actions (investigate/review/test/document/
  // implement) may only be created under the profile that action maps to.
  // Refused here, before anything persists, so no provider can ever start an
  // `implement` under repo-read (gh-issue-111/114/117/118) or an
  // `investigate` under repo-write.
  if (isExecution && input.task_category && engine.PROFILE_BY_ACTION[input.task_category]) {
    engine.assertActionProfile(input.task_category, executionProfile, { task_id: input.attempt_id || input.stage || null, attempt_id: input.attempt_id || null });
  }

  // Issue #100 — model selection. Only the Claude execution provider is
  // governed here: openai-compat and gemini carry THEIR OWN model names
  // (config/agents.json), a Claude model id would be meaningless there, and
  // the test-only mock never launches anything at all.
  // For claude-code the choice is always made — explicitly honoured, or
  // scored — so `--model` is always passed and the CLI's ambient default
  // (the fable family) can never become this system's default by omission.
  var modelChoice = null;
  var fallbackModel = input.fallback_model || null;
  // The mock stands in for the execution provider in tests and resolves the
  // model the same way, so an explicit `Model:` is exercised end to end.
  if (provider === 'claude-code' || provider === 'mock') {
    modelChoice = modelPolicy.selectModel({
      requested: input.model,
      execution_profile: executionProfile,
      task_category: input.task_category,
      priority: input.priority || 'normal',
      instruction: input.instruction,
      constraints: input.constraints,
      required_tests: input.required_tests
    });
    if (!modelChoice.ok) {
      throw new Error('MODEL_NOT_ALLOWED: ' + modelChoice.error +
        ' — a named model is never silently replaced by another one');
    }
    if (input.fallback_model) {
      // The fallback also lands in argv, so it passes the same allow-list.
      // It is never chosen automatically: no fallback means no --fallback-model.
      var fb = modelPolicy.resolveExplicit(input.fallback_model);
      if (!fb.ok) throw new Error('FALLBACK_MODEL_NOT_ALLOWED: ' + fb.error);
      fallbackModel = fb.model;
    }
  }

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
    model: modelChoice ? modelChoice.model : (input.model || null),
    fallback_model: fallbackModel,
    model_selection_mode: modelChoice ? modelChoice.mode : null,
    model_selection_reason: modelChoice ? modelChoice.reason : null,
    execution_profile: executionProfile,
    working_directory: isExecution ? (input.working_directory || projectCfg.path) : null,
    repository: projectCfg.repository || null,
    branch: input.branch || projectCfg.default_branch || null,
    task_category: input.task_category || null,
    action_source: input.action_source || null,
    action_raw: input.action_raw || null,
    attempt_id: input.attempt_id || null,
    required_tests: input.required_tests || [],
    constraints: input.constraints || [],
    expected_delivery: input.expected_delivery || 'report',
    report_to_git: input.report_to_git !== false,
    timeout_seconds: input.timeout_seconds || 3600,
    max_retries: input.max_retries === undefined ? 3 : input.max_retries,
    max_turns: input.max_turns || null
  };

  if (!task.instruction.trim()) throw new Error('INVALID_TASK: instruction is empty');

  // The immutable decision of this attempt, sealed at creation and re-verified
  // before every provider launch (ATTEMPT_SNAPSHOT_MUTATED).
  task.snapshot_sha256 = attemptSnapshotOf(task);

  // Fail closed on disabled profiles before anything persists.
  if (task.execution_profile) policy.getProfile(task.execution_profile);

  var secretKinds = redact.findSecretKinds(JSON.stringify(task));
  if (secretKinds.length) {
    throw new Error('TASK_CARRIES_SECRET: refusing task containing ' + secretKinds.join(', ') +
      ' — credentials never travel in task envelopes');
  }

  var check = schema.validate(task, TASK_SCHEMA);
  if (!check.valid) throw new Error('TASK_SCHEMA_INVALID: ' + check.errors.join('; '));

  // M-12 PART 2/3: skill selection happens AFTER the envelope validates,
  // so the fields it adds below are never part of what a caller could
  // have shaped via the schema. Selection is deterministic and always
  // succeeds with SOME outcome (a skill, or null with a reason) — a
  // malformed skills.json disables the layer, it never blocks the task.
  var selection = skills.selectSkill({
    stage: task.stage, instruction: task.instruction, task_category: task.task_category
  });
  task.skill_id = selection.skill ? selection.skill.id : null;
  task.skill_version = selection.skill ? selection.skill.version : null;
  task.skill_selection_reason = selection.reason;

  // M-12 PART 6/7: resolved once, at creation, against the profile this
  // task actually runs under — never against a profile a caller might
  // later claim. Persisted as a plain array of 'server.tool' strings
  // (names only) so nothing downstream needs to re-resolve or trust an
  // inbound claim about capabilities.
  var mcpResolved = mcpCapabilities.resolveCapabilities(selection.skill, task.execution_profile);
  task.mcp_capabilities = mcpResolved.allowed;

  // M-12 security review #4: the four skill/MCP audit fields were added
  // AFTER the first schema.validate above, so re-validate the COMPLETE record
  // now. The schema (additionalProperties:false) declares exactly these
  // fields; a shape drift here (an over-long reason, a malformed capability
  // spec) fails closed rather than persisting an unvalidated audit record.
  var recheck = schema.validate(task, TASK_SCHEMA);
  if (!recheck.valid) throw new Error('TASK_SCHEMA_INVALID (post-skill): ' + recheck.errors.join('; '));

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
    model: task.model, status: 'QUEUED',
    skill_id: task.skill_id, skill_version: task.skill_version,
    skill_selection_reason: task.skill_selection_reason
  });
  // Issue #100: the model choice is auditable on its own, with every signal
  // that produced it — a run must always be able to answer "why this model?".
  if (modelChoice) {
    state.appendEvent(task.task_id, 'model_selected', {
      model: task.model, key: modelChoice.key, mode: modelChoice.mode,
      requested: modelChoice.requested, score: modelChoice.score,
      signals: modelChoice.signals, policy_source: modelPolicy.DEFAULT_LOADED.source
    });
  }
  state.appendEvent(task.task_id, 'mcp_capabilities_resolved', {
    allowed: task.mcp_capabilities, denied_reason: mcpResolved.denied_reason
  });
  // Fail-safe check (PART 3): a selected skill whose instruction file is
  // missing or unreadable must never block the mission — buildPrompt will
  // independently omit the section on every run, this event just records
  // WHY once, at creation, instead of once per run/resume.
  if (selection.skill && skills.renderSkillSection(selection.skill) === null) {
    state.appendEvent(task.task_id, 'skill_instructions_unavailable', {
      skill_id: selection.skill.id, instruction_source: selection.skill.instruction_source
    });
  }
  return task;
}

function attemptSnapshotOf(task) {
  return engine.attemptSnapshot({
    task_id: task.task_id, attempt_id: task.attempt_id || null, requested_action: task.task_category || null,
    action_raw: task.action_raw || null, action_source: task.action_source || null,
    execution_profile: task.execution_profile || null, model: task.model || null, instruction: task.instruction,
    constraints: task.constraints || [], required_tests: task.required_tests || [],
    working_directory: task.working_directory || null, branch: task.branch || null
  });
}

// Everything that must hold BEFORE a provider process is spawned — checked on
// the durable task.json, on every start AND every resume. Returns null or a
// blocker { code, reason, retryable:false, ... }.
function preflightBlocker(task) {
  if (task.snapshot_sha256) {
    var snap = engine.checkSnapshot({
      task_id: task.task_id, attempt_id: task.attempt_id || null, requested_action: task.task_category || null,
      action_raw: task.action_raw || null, action_source: task.action_source || null,
      execution_profile: task.execution_profile || null, model: task.model || null, instruction: task.instruction,
      constraints: task.constraints || [], required_tests: task.required_tests || [],
      working_directory: task.working_directory || null, branch: task.branch || null
    }, task.snapshot_sha256);
    if (!snap.ok) {
      return engine.blocker(snap.code, { reason: snap.reason, expected: snap.expected, observed: snap.sha256, task_id: task.task_id, attempt_id: task.attempt_id || null,
        requested_action: task.task_category || null, execution_profile: task.execution_profile || null, model: task.model || null });
    }
  }
  if (task.task_category && engine.PROFILE_BY_ACTION[task.task_category]) {
    var c = engine.checkActionProfile(task.task_category, task.execution_profile);
    if (!c.ok) {
      return engine.blocker(c.code, { reason: c.reason, requested_action: task.task_category, action_raw: task.action_raw || null, action_source: task.action_source || null,
        execution_profile: task.execution_profile || null, expected_profile: c.expected_profile, actual_profile: c.actual_profile, task_id: task.task_id, attempt_id: task.attempt_id || null });
    }
  }
  if ((task.provider === 'claude-code' || task.provider === 'mock') && task.model) {
    var hit = modelPolicy.lookupKey(task.model);
    if (!hit || !hit.enabled) {
      return engine.blocker(engine.BLOCKER_CODES.MODEL_UNAVAILABLE, {
        reason: 'model "' + task.model + '" ' + (hit ? 'is not available on this host: ' + (hit.disabled_reason || 'disabled in config/model-policy.json') : 'is not in the model catalog on this host') + ' — it was NOT replaced by another model',
        requested_model: task.model, model_key: hit ? hit.key : null, actual_model: null, available_models: modelPolicy.availableLabels(),
        task_id: task.task_id, attempt_id: task.attempt_id || null, requested_action: task.task_category || null, execution_profile: task.execution_profile || null
      });
    }
  }
  return null;
}

// Stops a RUNNING task on a preflight blocker: BLOCKED, with a structured
// (synthesised) mythos_report on report.json — so the bridge and the Issue
// see the exact code and reason — and NO provider process.
function blockBeforeProvider(task, taskId, blocker) {
  var status = state.transition(taskId, 'BLOCKED', {
    pid: null, ended_at: new Date().toISOString(),
    last_error: blocker.code + ': ' + String(blocker.reason).slice(0, 400),
    last_failure: { category: 'governance', code: blocker.code, retryable: false, timed_out: false, classified_at: new Date().toISOString() },
    transition_reason: 'preflight invariant ' + blocker.code + ' — refused before any provider started; never retried automatically',
    next_action: blocker.code + ' — refused before the provider started: ' + String(blocker.reason).slice(0, 300)
  });
  var structured = reporting.synthesize({
    status: 'blocked', task_id: taskId, attempt_id: task.attempt_id || null, requested_action: task.task_category || null,
    action_raw: task.action_raw || null, action_source: task.action_source || null, execution_profile: task.execution_profile || null,
    model: task.model || null, branch: task.branch || null, blocker: blocker,
    summary: blocker.code + ': ' + blocker.reason + ' No provider process was started.'
  });
  state.writeJSON(taskId, 'report.json', {
    task_id: taskId, report: null, structured: structured, blocker: blocker,
    problems: [blocker.code + ': ' + String(blocker.reason).slice(0, 800)], git: { git_verified: null, remote_head: null, report_problems: [] }, provider_result_tail: ''
  });
  state.writeText(taskId, 'report.md', reporting.renderMarkdown(task, status, structured, { report_problems: [blocker.code] }));
  writeCheckpoint(task, status, { current_step: 'preflight_blocked', next_action: status.next_action });
  state.appendEvent(taskId, 'preflight_blocked', Object.assign({ status: 'BLOCKED' }, blocker));
  notify('task_failed', task.stage, taskId + ' BLOCKED ' + blocker.code);
  return status;
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

// M-12 PART 3: renders the skill section fresh on every call (start AND
// resume) so a section always reflects the skill file on disk right now.
// Never throws: a null render (no skill selected, or file missing) simply
// becomes the fixed placeholder text below — the fail-safe event for a
// missing file was already recorded once, at task creation.
function skillSectionFor(task) {
  if (!task.skill_id) return '(no skill instructions active)';
  var skillObj = skills.getSkill(task.skill_id);
  if (!skillObj) return '(no skill instructions active)';
  var rendered = skills.renderSkillSection(skillObj, { mcpCapabilities: task.mcp_capabilities || [] });
  return rendered === null ? '(no skill instructions active)' : rendered;
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
    SKILL_SECTION: skillSectionFor(task),
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
//
// This is the CORE implementation. The exported `runTask` (defined below,
// near the dispatcher) wraps this function so every caller — tick(), the
// quota/retry resume paths, the session-recreation recursion just below,
// the server's /resume route, and dispatchTask/drainQueue — releases a
// capacity slot back to the console queue when the run settles, without
// this function needing to know that dispatcher exists.
function runTaskCore(taskId, opts) {
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
  var ghStage = /^github:([a-z0-9][a-z0-9-]{4,62}[a-z0-9])$/.exec(String(task.stage || ''));
  lifecycle.emit({ type: 'EXECUTION_CREATED', execution_id: executionId, task_id: taskId, correlation_id: ghStage ? ghStage[1] : null,
    agent: task.provider, provider: task.provider, location: 'VPS', cwd: task.working_directory || null, source: 'executor',
    evidence: { mode: mode, requested_by: task.requested_by || null, stage: String(task.stage || '').slice(0, 80) } });
  lifecycle.emit({ type: 'EXECUTION_DISPATCHED', execution_id: executionId, task_id: taskId, location: 'VPS', source: 'executor' });

  var resumeNote = null;
  if (mode === 'resume') {
    resumeNote = 'This is a RESUME of an interrupted execution (' +
      (from === 'WAITING_FOR_QUOTA' ? 'quota window reopened' : 'retry after ' + from) +
      '). Re-read the checkpoint, verify repository state with git status/log before acting, and continue from the last completed step — do not restart work that is already committed.';
  } else if (opts._recreated) {
    resumeNote = 'The previous session could not be resumed (missing session). This is a FRESH session: the previous checkpoint and report above are your only continuity — trust Git over memory.';
  }

  // Invariant gate: nothing below this line runs for an attempt whose
  // decision is inconsistent, mutated or unrunnable on this host.
  var pre = preflightBlocker(task);
  if (pre) return Promise.resolve(blockBeforeProvider(task, taskId, pre));

  var prompt = buildPrompt(task, status, resumeNote);
  state.writeText(taskId, 'prompt.md', prompt);

  return provider.run(task, prompt, sessionId, mode, {}, function onSpawn(childPid) {
    var st = state.readStatus(taskId);
    st.pid = childPid;
    state.writeJSON(taskId, 'status.json', st);
    lifecycle.emit({ type: 'SESSION_STARTED', execution_id: executionId, task_id: taskId, session_id: sessionId, pid: childPid || null,
      proc_start: procStartTicks(childPid), cwd: task.working_directory || null, location: 'VPS', agent: task.provider, provider: task.provider,
      source: 'executor', evidence: { mode: mode } });
  }).then(function (outcome) {
    state.writeText(taskId, 'stdout.log', outcome.stdout || '');
    state.writeText(taskId, 'stderr.log', outcome.stderr || '');
    // The provider's child has exited: that IS the session end for a headless
    // run, with the process-gone proof in hand. The task's outcome is decided
    // below, separately — a closed session says nothing about it.
    lifecycle.emit({ type: 'SESSION_END', execution_id: executionId, task_id: taskId, session_id: outcome.session_id || sessionId, process_gone: true,
      end_reason: outcome.timed_out ? 'timeout' : (outcome.signal ? 'signal:' + outcome.signal : 'exit:' + outcome.exit_code), location: 'VPS', source: 'executor' });

    var parsed = outcome.parsed;
    var succeeded = parsed && parsed.is_error === false && !outcome.timed_out && outcome.exit_code === 0;

    if (succeeded) return handleSuccess(task, taskId, outcome, parsed);
    return handleFailure(task, taskId, outcome, mode, opts);
  });
}

// Kernel start ticks of a pid: the identity a recycled pid cannot fake.
function procStartTicks(pid) {
  try {
    var stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    var rest = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
    return rest[19] || null;
  } catch (e) { return null; }
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
  // The reason names the exact failure shape (extractReport's diagnosis),
  // not just "no structured report", so a rerun or a human can act on it
  // instead of opening stdout.log to guess (gh-issue-112).
  if (!report) { finalState = 'BLOCKED'; nextAction = 'provider produced no structured report: ' + (extracted.error || 'unknown reason') + ' — review stdout.log'; }

  // A structured report ALWAYS exists from here on: the provider's own, or a
  // synthesised one carrying the diagnosis (never a bare "no report").
  var blocker = null;
  if (report && report.status === 'blocked') {
    var text = [report.summary, report.next_stage].concat(report.residual_risks || []).join('\n');
    var code = quota.classifyBlockedReport(text);
    blocker = engine.blocker(code, { reason: String(report.summary || '').slice(0, 800), task_id: taskId, attempt_id: task.attempt_id || null, requested_action: task.task_category || null, execution_profile: task.execution_profile || null, model: task.model || null });
  } else if (report && report.status === 'failed') {
    blocker = engine.blocker('PROVIDER_FAILED', { reason: String(report.summary || '').slice(0, 800), task_id: taskId, attempt_id: task.attempt_id || null });
  } else if (!report) {
    blocker = engine.blocker('NO_STRUCTURED_REPORT', { reason: extracted.error || 'unknown reason', task_id: taskId, attempt_id: task.attempt_id || null, requested_action: task.task_category || null, execution_profile: task.execution_profile || null, model: task.model || null });
  }
  var structured = report ? Object.assign({}, report, { task_id: taskId, attempt_id: task.attempt_id || null, requested_action: task.task_category || null, action_raw: task.action_raw || null, action_source: task.action_source || null, execution_profile: task.execution_profile || null, model: task.model || null, branch: task.branch || null, blocker: blocker })
    : reporting.synthesize({ status: 'blocked', task_id: taskId, attempt_id: task.attempt_id || null, requested_action: task.task_category || null, action_raw: task.action_raw || null, action_source: task.action_source || null,
        execution_profile: task.execution_profile || null, model: task.model || null, branch: task.branch || null, blocker: blocker, diagnosis: extracted.error,
        summary: 'The provider ended without a usable mythos_report block: ' + (extracted.error || 'unknown reason'), next_stage: nextAction });

  var status = state.transition(taskId, finalState, {
    ended_at: new Date().toISOString(),
    pid: null,
    claude_session_id: outcome.session_id,
    next_action: nextAction,
    last_error: null,
    cost_usd: parsed.total_cost_usd || null
  });

  state.writeJSON(taskId, 'report.json', {
    task_id: taskId, report: report, structured: structured, blocker: blocker, problems: extras.report_problems,
    git: extras, provider_result_tail: tailOf(resultText, 4000)
  });
  var md = reporting.renderMarkdown(task, status, report || structured, extras);
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
  lifecycle.emit({ type: 'TASK_COMPLETED', execution_id: status.execution_id, task_id: taskId, session_id: outcome.session_id || null,
    report_status: finalState.toLowerCase(), location: 'VPS', source: 'executor' });
  // A bridge-owned task gets its REPORT_SUBMITTED from the bridge when the
  // control report is on the GitHub channel. Every other task's report of
  // record is the executor's own report.json (and its git commit when
  // report_to_git is on), so the executor submits that itself.
  if (task.requested_by !== 'github-bridge') {
    lifecycle.emit({ type: 'REPORT_SUBMITTED', execution_id: status.execution_id, task_id: taskId, report_status: finalState.toLowerCase(),
      report_ref: delivery.commit ? 'git:' + String(delivery.commit).slice(0, 12) : 'executor:report.json', location: 'VPS', source: 'executor' });
  }
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
    // Calls the CORE implementation directly, not the exported wrapper: this
    // recreation is a continuation of the same admitted run already in
    // progress inside runTask's own settle chain, not a new entry point, so
    // it must not attach a second drainQueue hook on top of the outer one.
    return runTaskCore(taskId, { _recreated: true });
  }

  // ONE classification decides the retry policy (lib/quota.js): the category
  // is durable on status.json and in events.log, so "why was / wasn't this
  // retried?" is answered from the record, not from re-reading stderr.
  var detail = quota.classifyOutcome(text, { timed_out: !!outcome.timed_out });
  var kind = detail.kind;
  var now = Date.now();
  var lastFailure = { category: detail.category, code: detail.code, retryable: detail.retryable, timed_out: !!outcome.timed_out, classified_at: new Date(now).toISOString() };
  state.appendEvent(taskId, 'failure_classified', { category: detail.category, kind: kind, code: detail.code, retryable: detail.retryable, timed_out: !!outcome.timed_out, retry_policy: detail.policy.strategy });

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
      last_error: 'quota exhausted',
      last_failure: lastFailure,
      transition_reason: 'quota exhausted — not a failure; the same session resumes after the window'
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
    var maxRetries = task.max_retries === undefined ? 3 : task.max_retries;
    if (retryCount > maxRetries) {
      var failed = state.transition(taskId, 'FAILED', {
        pid: null, retry_count: retryCount, ended_at: new Date().toISOString(),
        last_error: 'transient failures exceeded max_retries: ' + tailOf(text.trim(), 300),
        last_failure: lastFailure,
        transition_reason: 'transient failure #' + retryCount + ' exceeds max_retries=' + maxRetries + ' — the bounded retry budget is spent',
        next_action: 'inspect logs; re-queue explicitly if appropriate'
      });
      state.appendEvent(taskId, 'retries_exhausted', { retry_count: retryCount, max_retries: maxRetries, status: 'FAILED' });
      lifecycle.emit({ type: 'EXECUTION_FAILED', execution_id: failed.execution_id, task_id: taskId, task_state: 'FAILED', reason: 'transient failures exceeded max_retries', location: 'VPS', source: 'executor' });
      if (task.requested_by !== 'github-bridge') lifecycle.emit({ type: 'REPORT_SUBMITTED', execution_id: failed.execution_id, task_id: taskId, report_status: 'failed', report_ref: 'executor:report.json', location: 'VPS', source: 'executor' });
      writeFailureReport(task, taskId, failed, 'failed', engine.blocker('PROVIDER_FAILED', { reason: 'transient failures exceeded max_retries (' + retryCount + '): ' + tailOf(text.trim(), 300), task_id: taskId, attempt_id: task.attempt_id || null, retries: retryCount, category: 'transient' }));
      notify('task_failed', task.stage, taskId + ' FAILED after ' + retryCount + ' retries');
      return failed;
    }
    var baseMs = quota.retryBaseDelayMs(retryCount - 1);
    var delayMs = quota.retryDelayMs(retryCount - 1);
    var retryAt = new Date(now + delayMs).toISOString();
    var waiting = state.transition(taskId, 'WAITING_RETRY', {
      pid: null, retry_count: retryCount, retry_at: retryAt,
      last_error: tailOf(text.trim(), 300),
      last_failure: lastFailure,
      retry_backoff: { attempt: retryCount, max_retries: maxRetries, base_ms: baseMs, delay_ms: delayMs, jitter: 'additive', max_ms: quota.RETRY_MAX_MS },
      transition_reason: (outcome.timed_out ? 'provider timed out' : 'transient provider/network failure') + ' — retry ' + retryCount + '/' + maxRetries + ' after ' + delayMs + ' ms (base ' + baseMs + ' ms, additive jitter)',
      next_action: 'automatic retry after ' + retryAt
    });
    state.appendEvent(taskId, 'transient_failure', { retry_count: retryCount, max_retries: maxRetries, retry_at: retryAt, base_ms: baseMs, delay_ms: delayMs, timed_out: !!outcome.timed_out, status: 'WAITING_RETRY' });
    return waiting;
  }

  var terminal = kind === 'blocked' ? 'BLOCKED' : 'FAILED';
  var final = state.transition(taskId, terminal, {
    pid: null, ended_at: new Date().toISOString(),
    last_error: tailOf(text.trim(), 500),
    last_failure: lastFailure,
    transition_reason: detail.category + ' failure (' + detail.code + ') — ' + detail.policy.strategy,
    next_action: terminal === 'BLOCKED'
      ? (detail.category === 'governance'
        ? 'governance denial — re-scope the task or the owner changes the rule, then rerun (never retried automatically)'
        : detail.category === 'permission'
          ? 'permission denial — a human grants the operation or the task is re-scoped, then rerun (never retried automatically)'
          : 'genuine human blocker — resolve credential/authorization and re-queue')
      : 'permanent failure — inspect stderr.log'
  });
  writeCheckpoint(task, final, { current_step: terminal.toLowerCase() });
  var fb = engine.blocker(detail.code || (terminal === 'BLOCKED' ? 'PROVIDER_BLOCKED' : 'PROVIDER_FAILED'), { reason: tailOf(text.trim(), 500), category: detail.category, task_id: taskId, attempt_id: task.attempt_id || null, requested_action: task.task_category || null, execution_profile: task.execution_profile || null, model: task.model || null });
  writeFailureReport(task, taskId, final, terminal.toLowerCase(), fb);
  state.appendEvent(taskId, kind + '_failure', { status: terminal, code: fb.code, category: detail.category });
  notify('task_failed', task.stage, taskId + ' ' + terminal);
  lifecycle.emit({ type: 'EXECUTION_FAILED', execution_id: final.execution_id, task_id: taskId, task_state: terminal, reason: (fb.code || terminal) + ': ' + String(fb.reason || '').slice(0, 120), location: 'VPS', source: 'executor' });
  if (task.requested_by !== 'github-bridge') {
    lifecycle.emit({ type: 'REPORT_SUBMITTED', execution_id: final.execution_id, task_id: taskId, report_status: terminal.toLowerCase(), report_ref: 'executor:report.json', location: 'VPS', source: 'executor' });
  }
  return final;
}

// A provider that died (denied, blocked, fatal, retries exhausted) still ends
// in a structured report: synthesised, marked as such, carrying the blocker.
function writeFailureReport(task, taskId, status, reportStatus, blocker) {
  var structured = reporting.synthesize({
    status: reportStatus, task_id: taskId, attempt_id: task.attempt_id || null, requested_action: task.task_category || null,
    action_raw: task.action_raw || null, action_source: task.action_source || null, execution_profile: task.execution_profile || null,
    model: task.model || null, branch: task.branch || null, blocker: blocker,
    summary: 'The provider did not complete: ' + blocker.code + ' — ' + String(blocker.reason || '').slice(0, 1500)
  });
  state.writeJSON(taskId, 'report.json', {
    task_id: taskId, report: null, structured: structured, blocker: blocker,
    problems: [blocker.code + ': ' + String(blocker.reason || '').slice(0, 800)],
    git: { git_verified: null, remote_head: null, report_problems: [] }, provider_result_tail: ''
  });
  state.writeText(taskId, 'report.md', reporting.renderMarkdown(task, status, structured, { report_problems: [blocker.code] }));
}

// --- Daemon loop ------------------------------------------------------------------

function summaries() {
  return state.listTasks().map(function (id) {
    var st = state.readStatus(id) || {};
    var task = state.readJSON(id, 'task.json') || {};
    return {
      task_id: id, project: task.project, stage: task.stage,
      provider: task.provider, model: task.model || null, priority: task.priority || 'normal',
      status: st.status, effective: state.effectiveStatus(st),
      created_at: task.created_at, updated_at: st.updated_at,
      started_at: st.started_at || null, ended_at: st.ended_at || null,
      retry_count: st.retry_count, quota_state: st.quota_state,
      claude_session_id: st.claude_session_id, next_action: st.next_action,
      last_error: st.last_error || null, execution_id: st.execution_id || null,
      core_owned: task.requested_by === CORE_OWNER,
      // MOS-3A: needed by the dispatcher's drain (to find console-owned
      // QUEUED tasks) and by the console UI to tell its own missions apart
      // from n8n/daemon-originated ones.
      requested_by: task.requested_by || null
    };
  });
}

// --- Resource Guard admission (gh-issue-101) ---------------------------------
//
// Host memory pressure is an ADMISSION concern, never a kill switch: the
// guard only decides whether a NEW task may start. Everything already
// admitted — recovery, quota resumption, retries — is a continuation and
// stays exempt, so in-flight work remains resumable and no task is ever
// lost or killed because the host got tight. A blocked task simply stays
// QUEUED and is picked up on a later tick, exactly like a task waiting on
// capacity.
//
// Read lazily (not captured at load) so an operator can flip the kill
// switch by restarting with MYTHOS_RESOURCE_GUARD=off, and so tests can
// drive the gate deterministically from fixtures.
function guardEnabled() {
  return String(process.env.MYTHOS_RESOURCE_GUARD || 'on').toLowerCase() !== 'off';
}

function guardOptions() {
  return {
    state_path: path.join(state.root(), 'resource-guard.json'),
    alerts_path: path.join(state.root(), 'resource-guard-alerts.jsonl')
  };
}

var ADMIT_ANYWAY = { admit: true, level: 'DISABLED', reason: null, signals: null };

// Fresh reading (one tick = one sample). Returns the guard status plus the
// transition/alert, or null when the guard is off or the read failed —
// fail-open is deliberate: the guard must never become a new way for the
// executor to stop working.
function guardSample() {
  if (!guardEnabled()) return null;
  try { return resourceGuard.sample(guardOptions()); } catch (e) { return null; }
}

// Cheap reading for out-of-band admission (dispatchTask/drainQueue): reuses
// the tick's sample while it is fresh.
function guardGate(status) {
  if (!guardEnabled()) return ADMIT_ANYWAY;
  try {
    return resourceGuard.admission(status || resourceGuard.current(guardOptions()));
  } catch (e) { return ADMIT_ANYWAY; }
}

// One durable dispatch_deferred event per task per cooldown window. The
// decision itself is re-evaluated every tick, but writing an event every
// 15s for the whole length of a pressure episode would bury the task's own
// history — "no alert loops" applies to the event log too.
var DEFER_EVENT_COOLDOWN_MS = 10 * 60 * 1000;
var LAST_DEFER_EVENT = Object.create(null);

function noteDeferred(taskId, gate, now) {
  var last = LAST_DEFER_EVENT[taskId];
  if (last && (now - last) < DEFER_EVENT_COOLDOWN_MS) return false;
  // Bounded: an entry older than the cooldown can no longer suppress
  // anything, so it is dropped rather than accumulated for the lifetime of
  // the daemon.
  Object.keys(LAST_DEFER_EVENT).forEach(function (id) {
    if ((now - LAST_DEFER_EVENT[id]) >= DEFER_EVENT_COOLDOWN_MS) delete LAST_DEFER_EVENT[id];
  });
  LAST_DEFER_EVENT[taskId] = now;
  try {
    state.appendEvent(taskId, 'dispatch_deferred', {
      reason: 'resource_pressure',
      resource_level: gate.level,
      signals: gate.signals || null,
      status: 'QUEUED'
    });
  } catch (e) { /* telemetry must never break admission */ }
  return true;
}

// Alerts leave through the existing orchestrator notification path, which
// is already fire-and-forget (a missing or failing notify.sh cannot affect
// control flow). The WhatsApp channel is NOT wired here: on this branch
// bridge/notify/whatsapp.js does not exist, and merging that sibling line
// is an owner decision (see docs/AI_HANDOVER.md). Every alert is durably
// appended to resource-guard-alerts.jsonl by the guard itself, so a later
// sender can deliver from the ledger without losing history.
function guardNotify(result) {
  if (!result || !result.alert) return;
  notify('resource_' + String(result.alert.kind).toLowerCase(), 'resource-guard',
    resourceGuard.describe(result));
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

  // Resource Guard: one sample per tick. Sampling is unconditional (the
  // state machine needs a regular cadence to confirm and to recover), the
  // gate below is what actually enforces anything.
  var guard = guardSample();
  if (guard && guard.changed) {
    guardNotify(guard);
    actions.push({
      action: 'resource_state', from: guard.transition.from, to: guard.transition.to,
      reason: guard.transition.reason, alert_sent: guard.transition.alert_sent
    });
  }

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
    // THE admission point for daemon-owned work — n8n intake AND the
    // GitHub bridge (requested_by='github-bridge'), which never passes
    // through dispatchTask/drainQueue and would otherwise be admitted
    // straight into a host that is running out of memory.
    var gate = guardGate(guard);
    if (!gate.admit) {
      var logged = noteDeferred(queued[0].task_id, gate, now);
      actions.push({
        action: 'dispatch_deferred', task_id: queued[0].task_id,
        reason: gate.reason, resource_level: gate.level,
        queued: queued.length, event_logged: logged
      });
      return Promise.resolve(actions);
    }
    actions.push({ action: 'start', task_id: queued[0].task_id });
    return runTask(queued[0].task_id).then(function () { return actions; });
  }

  return Promise.resolve(actions.length ? actions : [{ action: 'idle' }]);
}

// --- Capacity-gated dispatch (MOS-3A) ----------------------------------------------
//
// A central dispatcher on top of runTaskCore/tick, not a replacement for
// either. tick() above is UNTOUCHED: it still starts at most one task per
// step, on its own 15s cadence, for daemon-owned work (n8n intake and
// recovery/retry/quota resumption). What this section adds is a second,
// capacity-gated entry point — dispatchTask — that the console's explicit
// "start mission" call now uses instead of the old unconditional /resume,
// plus a drain that keeps pulling queued console missions in as capacity
// frees up.
//
// Design notes:
//   - Quota/retry resumes are CONTINUATIONS of an already-admitted
//     execution (the task was already counted against capacity when it
//     first ran); they are NOT capacity-gated here, only fresh admissions
//     through dispatchTask/drainQueue are.
//   - drainQueue is scoped to requested_by === 'mos-console' missions only,
//     so n8n intake and daemon/tick semantics (one task per tick, its own
//     FIFO) are completely unchanged by this stage.
//   - tick() itself is never modified. It calls the exported `runTask`
//     name below, so a slot a tick-started task frees also drains queued
//     console missions — without tick's own logic changing at all.

// taskId -> true from just before runTaskCore is invoked until the run
// settles. Needed because runningCount() reads summaries(), and a task
// freshly transitioned to RUNNING still shows pid: null (set by the
// provider's onSpawn callback only after the child actually spawns), so
// state.effectiveStatus reports it as INTERRUPTED, not RUNNING, for that
// brief window. Without this set, a burst of dispatches could all read the
// same stale runningCount and blow past MAX_PARALLEL.
var DISPATCH_INFLIGHT = Object.create(null);

// Number of DISTINCT task ids that are either effective RUNNING (per
// summaries()) or in-flight (admitted but not yet visible as RUNNING). A
// union of ids, not a sum, so a task that is briefly both is counted once.
function runningCount() {
  var ids = Object.create(null);
  summaries().forEach(function (s) { if (s.effective === 'RUNNING') ids[s.task_id] = true; });
  Object.keys(DISPATCH_INFLIGHT).forEach(function (id) { ids[id] = true; });
  return Object.keys(ids).length;
}

// Shared admission path for dispatchTask and drainQueue: mark in-flight,
// start the run, and on settle release the slot and try to drain more.
// Never throws and never lets a dispatch_error stop the caller.
function startConsoleTask(taskId) {
  DISPATCH_INFLIGHT[taskId] = true;
  // A synchronous throw out of runTask (e.g. a corrupt task.json making
  // readJSON throw before the promise exists) must not leak the in-flight
  // entry -- a leaked entry would permanently eat one capacity slot until
  // the process restarts.
  var run;
  try {
    run = runTask(taskId);
  } catch (syncErr) {
    delete DISPATCH_INFLIGHT[taskId];
    try {
      state.appendEvent(taskId, 'dispatch_error', {
        message: redact.redact(String((syncErr && syncErr.message) || syncErr))
      });
    } catch (e2) { /* telemetry must never break the drain */ }
    return;
  }
  run.then(function () {
    delete DISPATCH_INFLIGHT[taskId];
    try { drainQueue(); } catch (e) { /* best-effort */ }
  }).catch(function (err) {
    delete DISPATCH_INFLIGHT[taskId];
    try {
      state.appendEvent(taskId, 'dispatch_error', {
        message: redact.redact(String((err && err.message) || err))
      });
    } catch (e2) { /* telemetry must never break the drain */ }
    try { drainQueue(); } catch (e3) { /* best-effort */ }
  });
}

// The capacity-gated entry point the console's explicit start now uses in
// place of the old unconditional /resume. Does NOT await completion — it
// only decides admission and returns immediately.
function dispatchTask(taskId) {
  var status = state.readStatus(taskId);
  if (!status) return Promise.reject(new Error('NO_SUCH_TASK: ' + taskId));
  if (status.status !== 'QUEUED') {
    return Promise.reject(new Error('NOT_DISPATCHABLE: task ' + taskId + ' is ' + status.status));
  }

  var running = runningCount();

  // Host safety is checked before capacity: a free slot on a host that is
  // out of memory is not a slot. The task stays QUEUED and drains later.
  var gate = guardGate();
  if (!gate.admit) {
    noteDeferred(taskId, gate, Date.now());
    return Promise.resolve({
      task_id: taskId, dispatched: false, queued: true,
      reason: gate.reason, resource_level: gate.level,
      running: running, max_parallel: MAX_PARALLEL
    });
  }

  if (running >= MAX_PARALLEL) {
    state.appendEvent(taskId, 'dispatch_deferred', { running: running, max_parallel: MAX_PARALLEL });
    return Promise.resolve({
      task_id: taskId, dispatched: false, queued: true,
      running: running, max_parallel: MAX_PARALLEL
    });
  }

  startConsoleTask(taskId);
  return Promise.resolve({
    task_id: taskId, dispatched: true,
    running: running + 1, max_parallel: MAX_PARALLEL
  });
}

var DRAINING = false; // reentrancy guard: a drain triggered from inside a
                       // drain's own settle hook must not recurse unboundedly.

// Pulls queued console missions in as capacity allows. Never throws; one
// bad task cannot stop the drain from trying the next one.
function drainQueue() {
  if (DRAINING) return;
  DRAINING = true;
  try {
    while (runningCount() < MAX_PARALLEL) {
      // Re-read per iteration: a pressure episode that starts mid-drain
      // must stop the drain, not merely the next drain.
      var gate = guardGate();
      if (!gate.admit) {
        var blocked = summaries().filter(function (s) {
          return s.status === 'QUEUED' && s.requested_by === 'mos-console';
        });
        if (blocked.length) noteDeferred(blocked[0].task_id, gate, Date.now());
        break;
      }
      var candidates = summaries().filter(function (s) {
        return s.status === 'QUEUED' && s.requested_by === 'mos-console';
      }).sort(function (a, b) {
        var pw = (PRIORITY_WEIGHT[a.priority] || 1) - (PRIORITY_WEIGHT[b.priority] || 1);
        return pw !== 0 ? pw : String(a.created_at).localeCompare(String(b.created_at));
      });
      if (!candidates.length) break;
      try {
        startConsoleTask(candidates[0].task_id);
      } catch (e) { /* one bad task must not stop the drain */ }
    }
  } finally {
    DRAINING = false;
  }
}

// Read-only view of the guard for operators and for bin/mythos-resource-guard.
function resourceGuardStatus() {
  if (!guardEnabled()) {
    return { enabled: false, level: 'DISABLED', admit: true, signals: null, since: null, last_transition: null };
  }
  var status;
  try { status = resourceGuard.current(guardOptions()); } catch (e) { status = null; }
  var gate = resourceGuard.admission(status);
  var st = (status && status.state) || {};
  return {
    enabled: true,
    level: gate.level,
    admit: gate.admit,
    signals: (status && status.signals) || null,
    since: st.since || null,
    last_transition: (st.history && st.history.length) ? st.history[st.history.length - 1] : null
  };
}

// Read-only view of the Session Guard (gh-issue-144) for operators and for
// bin/mythos-session-guard. STRICTLY observational: it calls snapshot(),
// which never writes the guard's state and never signals a process, so
// polling this route can neither advance an idle clock nor race the
// enforcing process. The executor itself never terminates a Desktop Remote
// session — that is the enforcing unit's job, and only when the operator
// has enabled it.
function sessionGuardStatus() {
  var sg;
  try { sg = require('./lib/session-guard'); } catch (e) { return { available: false, reason: 'module_unavailable' }; }
  var cfg = {
    state_path: path.join(state.root(), 'session-guard.json'),
    enable_marker_path: path.join(state.root(), 'session-guard.enabled'),
    // The executor observes the SAME memory signal the Resource Guard
    // already owns; it never reads /proc/meminfo a second time.
    pressure_level: resourceGuardStatus().level
  };
  var snap;
  try { snap = sg.snapshot(cfg); } catch (e) { return { available: false, reason: 'snapshot_failed' }; }
  var rep = sg.report(snap);
  rep.available = true;
  rep.enforcement = sg.enforcementEnabled(cfg);
  rep.tracked_sessions = snap.state_tracked;
  return rep;
}

function dispatcherStatus() {
  return {
    running: runningCount(),
    max_parallel: MAX_PARALLEL,
    queued: summaries().filter(function (s) {
      return s.status === 'QUEUED' && s.requested_by === 'mos-console';
    }).length
  };
}

// The exported runTask: wraps runTaskCore so EVERY caller — tick() (via
// this same name, its own code unchanged), quota/retry resume, the
// server's /resume route, and dispatchTask/drainQueue above — drains
// queued console missions when a slot frees, without runTaskCore or tick()
// needing to know the dispatcher exists. Never alters the resolved value
// or rejection runTaskCore produces.
function runTask(taskId, opts) {
  return runTaskCore(taskId, opts).then(function (result) {
    try { drainQueue(); } catch (e) { /* best-effort */ }
    return result;
  }, function (err) {
    try { drainQueue(); } catch (e) { /* best-effort */ }
    throw err;
  });
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
      // Lifecycle housekeeping: inbox → recovery → post-report verification →
      // cleanup phases. Self-throttled to once a minute inside tick(); it
      // never signals a root-owned session (that is delegated to the root
      // Session Guard) and never blocks the executor's own step.
      try { var lc = lifecycle.tick(); if (lc && !lc.skipped && ((lc.verified && lc.verified.checked.length) || (lc.cleanup && lc.cleanup.actions.length) || lc.recovered.length)) console.log(JSON.stringify({ ts: new Date().toISOString(), lifecycle: { verified: lc.verified.checked.length, cleanup: lc.cleanup.actions, recovered: lc.recovered } })); } catch (e) { /* best-effort */ }
      // Timer-driven re-drain. drainQueue was edge-triggered only (it ran
      // when a run settled), so a console queue held back by capacity OR by
      // resource pressure with nothing running had no event left to restart
      // it — the queue would sit still until someone dispatched by hand.
      // One call per daemon step is what makes "tasks resume after
      // RECOVERED" true without any new status or timer.
      try { drainQueue(); } catch (e) { /* best-effort, never fatal */ }
      // A deferral whose event was inside its cooldown is a repeat of a
      // decision already logged; the tick return value still reports it,
      // the journal does not repeat it every 15s for hours.
      var meaningful = actions.filter(function (a) {
        return a.action !== 'idle' && a.event_logged !== false;
      });
      if (meaningful.length) console.log(JSON.stringify({ ts: new Date().toISOString(), tick: meaningful }));
    }).catch(function (err) {
      busy = false;
      try { drainQueue(); } catch (e) { /* best-effort, never fatal */ }
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
  preflightBlocker: preflightBlocker,
  verifyGit: verifyGit,
  commitReportToGit: commitReportToGit,
  sshEnv: sshEnv,
  acquireDaemonLock: acquireDaemonLock,
  dispatchTask: dispatchTask,
  drainQueue: drainQueue,
  dispatcherStatus: dispatcherStatus,
  // Deliberately NOT folded into dispatcherStatus(): the console asserts
  // that view's exact key set, and host health is a separate concern from
  // dispatch capacity.
  resourceGuardStatus: resourceGuardStatus,
  sessionGuardStatus: sessionGuardStatus,
  lifecycleStatus: function (opts) { return lifecycle.status(opts); },
  lifecycle: lifecycle,
  MAX_PARALLEL: MAX_PARALLEL
};
