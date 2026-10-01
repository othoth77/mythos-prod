'use strict';
// =====================================================
// MYTHOS OS v4 — the Haddad execution layer
// projects/mythos-os-v4/lib/haddad.js
//
// Haddad is where an authorised step actually runs. Two kinds:
//
//   answer   a model answers a question. The gateway calls the model JEV
//            chose (free → Qwen → paid), on this host.
//
//   work     the step works inside a repository. That is the EXISTING
//            Haddad executor — nothing here re-implements it. JEV first
//            confirms a model with execution authority is usable (on Haddad
//            that is Qwen, through the haddad-agent provider), then:
//
//              read-only actions (policy haddad.direct_actions)
//                -> one task enqueued into the executor daemon's own store
//                   (`mythos-ai-executor enqueue`), report-only, never
//                   committed to Git, and watched to its terminal status.
//              everything else (test / document / implement)
//                -> the supervised GitHub path (`mythos-supervise.js submit`
//                   + `watch`): an Issue the Haddad bridge claims into an
//                   isolated worktree, with the measured-outcome gate, the
//                   review gate and the Supervisor's own verification.
//
//            A write never takes the direct path: only the bridge gives a
//            task its own worktree and branch.
//
// The executor's status is the result. COMPLETED there is already measured
// (lib/measured-outcome.js); anything else is a failed step with the
// executor's own reason. Every wait is bounded by the step's timeout.
// =====================================================

var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var store = require('./store');

var REPO_ROOT = path.join(__dirname, '..', '..', '..');

var CAPABILITY_BY_ACTION = { analyze: 'analysis', research: 'research', review: 'review', plan: 'planning', summarize: 'summarization' };
var POOL_BY_ACTION = { research: 'research', review: 'assessment' };
// The executor's own closed table (bridge/action-resolution.js), restated
// only for the two read-only actions the direct path may carry.
var READ_PROFILE = 'repo-read';
var TERMINAL = ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'];
var ENV_ALLOW = ['HOME', 'PATH', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME'];

function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  return p.indexOf('~/') === 0 ? path.join(os.homedir(), p.slice(2)) : p;
}

// KEY=VALUE lines of a NON-SECRET env file (the worker's isolation config).
function readEnvFile(file) {
  var out = {};
  var text;
  try { text = fs.readFileSync(expandHome(file), 'utf8'); } catch (e) { return null; }
  text.split('\n').forEach(function (line) {
    var m = /^\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  });
  return out;
}

function baseEnv(extra) {
  var env = {};
  ENV_ALLOW.forEach(function (k) { if (process.env[k] !== undefined) env[k] = process.env[k]; });
  return Object.assign(env, extra || {});
}

// run(cmd, args, { input, env, timeoutMs }, spawn) -> Promise<{ code, stdout, stderr, timed_out }>
function run(cmd, args, opts, spawn) {
  return new Promise(function (resolve) {
    var child;
    var out = '';
    var err = '';
    var settled = false;
    function done(v) { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } }
    try {
      child = (spawn || cp.spawn)(cmd, args, { env: opts.env, cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ code: null, stdout: '', stderr: String(e && e.code), timed_out: false });
    }
    var timer = setTimeout(function () {
      try { child.kill('SIGTERM'); } catch (e) { /* gone */ }
      setTimeout(function () { try { child.kill('SIGKILL'); } catch (e2) { /* gone */ } }, 3000).unref();
      done({ code: null, stdout: out, stderr: err, timed_out: true });
    }, opts.timeoutMs);
    child.stdout.on('data', function (d) { if (out.length < 2 * 1024 * 1024) out += d; });
    child.stderr.on('data', function (d) { if (err.length < 64 * 1024) err += d; });
    child.on('error', function (e) { done({ code: null, stdout: out, stderr: String(e && e.code), timed_out: false }); });
    child.on('close', function (code) { done({ code: code, stdout: out, stderr: err, timed_out: false }); });
    child.stdin.on('error', function () { /* closed early */ });
    child.stdin.end(opts.input || '');
  });
}

function create(deps) {
  var policy = deps.policy;
  var jev = deps.jev;
  var gateway = deps.gateway;
  var ledger = deps.ledger;
  var now = deps.now || Date.now;
  var sleep = deps.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var spawn = deps.spawn;
  var hp = policy.haddad;
  var executorRoot = deps.executorRoot || process.env.MYTHOS_OS_EXECUTOR_ROOT || REPO_ROOT;

  function executorEnv() {
    var fileEnv = readEnvFile(deps.executorEnvFile || process.env.MYTHOS_OS_EXECUTOR_ENV_FILE || hp.executor_env_file);
    return fileEnv ? baseEnv(fileEnv) : null;
  }

  // ---- answer ------------------------------------------------------------
  function answer(step, ctx) {
    var prompt = step.instruction;
    if (step.acceptance && step.acceptance.length) {
      prompt += '\n\nThe answer must satisfy:\n' + step.acceptance.map(function (a) { return '- ' + a; }).join('\n');
    }
    return gateway.complete({
      pool: POOL_BY_ACTION[step.action] || 'execution', capability: CAPABILITY_BY_ACTION[step.action],
      prompt: prompt, deadline_at: Math.min(ctx.deadline_at || Infinity, now() + step.timeout_seconds * 1000),
      goal_id: ctx.goal_id, trace_id: ctx.trace_id, step_id: step.id
    }).then(function (r) {
      return {
        ok: r.ok, kind: 'answer', output: r.ok ? r.text : null, reason: r.ok ? null : r.reason,
        model: r.model || null, tier: r.tier || null, served_by: r.served_by || null, fallback_used: !!r.fallback_used,
        attempts: r.attempts, decision_id: r.decision_id || null
      };
    });
  }

  // ---- work: direct, read-only ------------------------------------------
  function executorCli(args, input, timeoutMs, env) {
    var bin = path.join(executorRoot, 'projects', 'mythos-ai-executor', 'bin', 'mythos-ai-executor');
    return run(process.execPath, [bin].concat(args), { input: input, env: env, timeoutMs: timeoutMs, cwd: executorRoot }, spawn);
  }

  function workDirect(step, cand, ctx) {
    var env = executorEnv();
    if (!env || !env.MYTHOS_EXECUTOR_HOME) {
      return Promise.resolve({ ok: false, kind: 'work', transport: 'executor', reason: 'EXECUTOR_UNCONFIGURED', detail: 'no executor env file with MYTHOS_EXECUTOR_HOME on this host', output: null });
    }
    var payload = {
      project: hp.project, stage: 'mythos-os-v4:' + ctx.goal_id + ':' + step.id, instruction: step.instruction,
      priority: 'normal', requested_by: 'mythos-os-v4', mode: 'autonomous', provider: cand.work_provider,
      task_category: step.action, execution_profile: READ_PROFILE, expected_delivery: 'report', report_to_git: false,
      constraints: (step.acceptance || []).slice(0, policy.plan.max_acceptance_items),
      timeout_seconds: step.timeout_seconds, max_retries: hp.work_max_retries
    };
    // The task's timeout applies PER ATTEMPT and the executor may retry
    // `work_max_retries` times with a backoff in between. The wait covers
    // every attempt, every backoff and the pickup latency, so v4 never gives
    // up on a task the executor is still legitimately running (the same
    // arithmetic as supervisor/qwen.js consultTimeout). Still bounded: the
    // goal's own deadline caps it.
    var attempts = 1 + hp.work_max_retries;
    var worstMs = (step.timeout_seconds * attempts + hp.retry_backoff_seconds * hp.work_max_retries + 60) * 1000;
    var stepDeadline = Math.min(ctx.deadline_at || Infinity, now() + worstMs);
    return executorCli(['enqueue', '-'], JSON.stringify(payload), hp.enqueue_timeout_seconds * 1000, env).then(function (res) {
      var taskId = null;
      try { taskId = JSON.parse(res.stdout).task_id; } catch (e) { taskId = null; }
      if (res.code !== 0 || !taskId) {
        return { ok: false, kind: 'work', transport: 'executor', reason: 'ENQUEUE_REFUSED', detail: String(res.stderr || res.stdout).slice(0, 400), output: null };
      }
      ledger.append({ actor: 'haddad', type: 'WORK_ENQUEUED', goal_id: ctx.goal_id, trace_id: ctx.trace_id, detail: { step_id: step.id, executor_task_id: taskId, action: step.action, provider: cand.work_provider, model: cand.model } });

      function poll() {
        if (now() >= stepDeadline) {
          return { ok: false, kind: 'work', transport: 'executor', reason: 'WORK_TIMEOUT', detail: 'executor task ' + taskId + ' not terminal by the step deadline', executor_task_id: taskId, output: null };
        }
        return executorCli(['status', taskId], '', hp.enqueue_timeout_seconds * 1000, env).then(function (st) {
          var status = null;
          try { status = JSON.parse(st.stdout).effective; } catch (e) { status = null; }
          if (TERMINAL.indexOf(status) === -1) return sleep(hp.poll_interval_seconds * 1000).then(poll);
          var report = null;
          try { report = JSON.parse(fs.readFileSync(path.join(env.MYTHOS_EXECUTOR_HOME, 'tasks', taskId, 'report.json'), 'utf8')); } catch (e2) { report = null; }
          var structured = (report && (report.structured || report.report)) || {};
          var summary = typeof structured.summary === 'string' ? structured.summary : '';
          return {
            ok: status === 'COMPLETED', kind: 'work', transport: 'executor', executor_task_id: taskId, executor_status: status,
            reason: status === 'COMPLETED' ? null : 'EXECUTOR_' + status,
            // The executor's own words: the blocker code AND its reason (the
            // code alone — e.g. HUMAN_APPROVAL — does not say what to change).
            detail: status === 'COMPLETED' ? null : String((report && report.blocker && [report.blocker.code, report.blocker.reason].filter(Boolean).join(': ')) || (report && report.problems && report.problems[0]) || '').slice(0, 400) || null,
            output: summary || null, model: cand.model, tier: cand.tier,
            served_by: (report && report.model_used) || null
          };
        });
      }
      return poll();
    });
  }

  // ---- work: supervised (GitHub Issue → Haddad bridge) -------------------
  function workSupervised(step, cand, ctx) {
    var cfgPath = path.join(executorRoot, hp.supervisor_config);
    if (!fs.existsSync(cfgPath)) {
      return Promise.resolve({ ok: false, kind: 'work', transport: 'supervised', reason: 'SUPERVISOR_UNCONFIGURED', detail: 'missing ' + hp.supervisor_config, output: null });
    }
    var fileEnv = executorEnv() || {};
    var env = baseEnv({ MYTHOS_SUPERVISOR_CONFIG: cfgPath });
    if (fileEnv.MYTHOS_EXECUTOR_HOME) env.MYTHOS_EXECUTOR_HOME = fileEnv.MYTHOS_EXECUTOR_HOME;
    // The Supervisor's default store is the VPS's (/home/deploy/…). v4 keeps
    // its supervised tasks in its own private store unless one is named.
    env.MYTHOS_SUPERVISOR_HOME = process.env.MYTHOS_SUPERVISOR_HOME || store.ensureDir(store.file('supervisor'));
    var script = path.join(executorRoot, 'scripts', 'mythos-supervise.js');
    var isWrite = policy.plan.write_actions.indexOf(step.action) !== -1;
    var args = [script, 'submit', '--objective', step.instruction, '--action', step.action, '--by', 'mythos-os-v4',
      '--timeout', String(step.timeout_seconds), '--check', 'status_completed'];
    if (isWrite) args.push('--check', 'commit_delivered');
    (step.acceptance || []).forEach(function (a) { args.push('--validation', a); });

    return run(process.execPath, args, { env: env, timeoutMs: 120000, cwd: executorRoot }, spawn).then(function (res) {
      var taskId = null;
      try { taskId = JSON.parse(res.stdout).task_id; } catch (e) { taskId = null; }
      // The id becomes a file name below: only the Supervisor's own shape.
      if (res.code !== 0 || !/^SUP-[A-Z0-9]{4,20}$/.test(String(taskId))) {
        return { ok: false, kind: 'work', transport: 'supervised', reason: 'SUBMIT_REFUSED', detail: String(res.stderr || res.stdout).slice(0, 400), output: null };
      }
      ledger.append({ actor: 'haddad', type: 'WORK_SUPERVISED', goal_id: ctx.goal_id, trace_id: ctx.trace_id, detail: { step_id: step.id, supervisor_task_id: taskId, action: step.action, model: cand.model } });
      var budgetMs = Math.max(60000, Math.min((ctx.deadline_at || Infinity) - now(), step.timeout_seconds * 1000 + 600000));
      var minutes = Math.max(1, Math.floor(budgetMs / 60000));
      return run(process.execPath, [script, 'watch', taskId, '--interval', String(hp.supervised_watch_interval_seconds), '--max-minutes', String(minutes)],
        { env: env, timeoutMs: budgetMs + 60000, cwd: executorRoot }, spawn).then(function (w) {
        var tail = String(w.stdout).slice(-6000);
        var summary = null;
        var brace = tail.lastIndexOf('\n{');
        if (brace !== -1) { try { summary = JSON.parse(tail.slice(brace + 1)); } catch (e) { summary = null; } }
        var status = summary && summary.status;
        // The step's RESULT is what the worker reported and the Supervisor
        // verified — read from the Supervisor's own record. Without it the
        // executive only learns that a task ended, not what it found (live,
        // 2026-10-01: FABLE re-planned a test whose counts it never saw).
        var record = null;
        try { record = JSON.parse(fs.readFileSync(path.join(env.MYTHOS_SUPERVISOR_HOME, 'tasks', taskId + '.json'), 'utf8')); } catch (e2) { record = null; }
        var last = (record && record.last_result) || {};
        var reported = typeof last.summary === 'string' && last.summary.trim()
          ? [last.summary.trim()].concat((Array.isArray(last.tests) ? last.tests : []).slice(0, 10).map(function (x) { return 'test: ' + String(x).slice(0, 300); })).join('\n')
          : null;
        return {
          ok: w.code === 0 && status === 'COMPLETED', kind: 'work', transport: 'supervised', supervisor_task_id: taskId,
          issue: summary ? summary.issue : null, executor_status: status || null,
          reason: w.code === 0 && status === 'COMPLETED' ? null : (w.timed_out || w.code === 1 ? 'WORK_TIMEOUT' : 'SUPERVISOR_' + (status || 'UNKNOWN')),
          detail: summary && summary.blocked ? String(summary.blocked.reason || summary.blocked.code || '').slice(0, 400) : (summary ? String(summary.last_error || '').slice(0, 400) || null : null),
          output: reported || (summary ? 'Supervised task ' + taskId + ' on Issue #' + summary.issue + ' ended ' + status + ' (no report summary was recorded). Last action: ' + String(summary.last_action || '').slice(0, 600) : null),
          model: cand.model, tier: cand.tier, served_by: null
        };
      });
    });
  }

  // settleSupervised() -> Promise<{ ran, open, code? }>
  // A supervised task is driven by `watch`, a child of the goal's runner. If
  // the runner dies, nothing ticks that task again and its Issue stays open
  // (found live, Issue #546). The watchdog tick calls this: when v4's own
  // Supervisor store holds a task that is not terminal, ONE `tick` is run —
  // the Supervisor's normal pass, which verifies and closes what finished.
  function settleSupervised() {
    var home = process.env.MYTHOS_SUPERVISOR_HOME || store.file('supervisor');
    var dir = path.join(home, 'tasks');
    var open = 0;
    try {
      fs.readdirSync(dir).forEach(function (f) {
        if (!/^SUP-[A-Z0-9]{4,20}\.json$/.test(f)) return;
        var rec = null;
        try { rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { rec = null; }
        if (rec && ['COMPLETED', 'BLOCKED', 'CANCELLED', 'FAILED'].indexOf(rec.status) === -1) open += 1;
      });
    } catch (e2) { return Promise.resolve({ ran: false, open: 0 }); }
    var cfgPath = path.join(executorRoot, hp.supervisor_config);
    if (!open || !fs.existsSync(cfgPath)) return Promise.resolve({ ran: false, open: open });
    var fileEnv = executorEnv() || {};
    var env = baseEnv({ MYTHOS_SUPERVISOR_CONFIG: cfgPath, MYTHOS_SUPERVISOR_HOME: home });
    if (fileEnv.MYTHOS_EXECUTOR_HOME) env.MYTHOS_EXECUTOR_HOME = fileEnv.MYTHOS_EXECUTOR_HOME;
    return run(process.execPath, [path.join(executorRoot, 'scripts', 'mythos-supervise.js'), 'tick'], { env: env, timeoutMs: 300000, cwd: executorRoot }, spawn).then(function (r) {
      ledger.append({ actor: 'haddad', type: 'SUPERVISED_TICK', detail: { open_tasks: open, exit_code: r.code, timed_out: r.timed_out } });
      return { ran: true, open: open, code: r.code };
    });
  }

  function work(step, ctx) {
    // No static fallback here: without JEV's decision nothing is known to
    // hold execution authority, and repository work fails closed.
    if (!jev) return Promise.resolve({ ok: false, kind: 'work', reason: 'NO_EXECUTION_MODEL', detail: 'JEV is unavailable', output: null });
    return Promise.resolve().then(function () { return jev.refresh(); }).catch(function () { return null; }).then(function () {
      var decision = jev.route({ pool: 'execution', capability: 'repo_work', kind: 'work', prompt_chars: step.instruction.length, goal_id: ctx.goal_id, trace_id: ctx.trace_id });
      if (!decision.ok) {
        return { ok: false, kind: 'work', reason: 'NO_EXECUTION_MODEL', detail: decision.rejected.map(function (r) { return r.model + ': ' + r.reason; }).join('; ').slice(0, 400), output: null, decision_id: decision.decision_id };
      }
      var cand = decision.candidates[0];
      var direct = hp.direct_actions.indexOf(step.action) !== -1;
      var started = now();
      return (direct ? workDirect(step, cand, ctx) : workSupervised(step, cand, ctx)).then(function (r) {
        r.decision_id = decision.decision_id;
        // Infrastructure failures (could not enqueue, never answered) count
        // against the model's health; a task the executor ran and judged
        // BLOCKED/FAILED is a result about the TASK, not about the model.
        var infra = ['ENQUEUE_REFUSED', 'SUBMIT_REFUSED', 'WORK_TIMEOUT', 'EXECUTOR_UNCONFIGURED', 'SUPERVISOR_UNCONFIGURED'].indexOf(r.reason) !== -1;
        if (r.ok) jev.report(cand.model, { ok: true, duration_ms: now() - started }, ctx);
        else if (infra) jev.report(cand.model, { ok: false, category: r.reason === 'WORK_TIMEOUT' ? 'transient' : 'blocked', code: r.reason }, ctx);
        return r;
      });
    });
  }

  // execute(step, ctx) -> Promise<result>; never rejects.
  function execute(step, ctx) {
    var started = now();
    ledger.append({ actor: 'haddad', type: 'STEP_STARTED', goal_id: ctx.goal_id, trace_id: ctx.trace_id, detail: { step_id: step.id, kind: step.kind, action: step.action, timeout_seconds: step.timeout_seconds } });
    return Promise.resolve().then(function () {
      return step.kind === 'answer' ? answer(step, ctx) : work(step, ctx);
    }).catch(function (e) {
      return { ok: false, kind: step.kind, reason: 'EXECUTION_ERROR', detail: String(e && e.message).slice(0, 400), output: null };
    }).then(function (r) {
      r.step_id = step.id;
      r.action = step.action;
      r.duration_ms = now() - started;
      ledger.append({
        actor: 'haddad', type: 'STEP_RESULT', goal_id: ctx.goal_id, trace_id: ctx.trace_id,
        detail: { step_id: step.id, kind: r.kind, action: step.action, ok: r.ok, reason: r.reason || null, detail: r.detail || null, model: r.model || null, tier: r.tier || null, served_by: r.served_by || null, transport: r.transport || null, executor_task_id: r.executor_task_id || null, supervisor_task_id: r.supervisor_task_id || null, issue: r.issue || null, output_chars: r.output ? r.output.length : 0, duration_ms: r.duration_ms, decision_id: r.decision_id || null }
      });
      return r;
    });
  }

  return { execute: execute, settleSupervised: settleSupervised, executorEnv: executorEnv, executorRoot: executorRoot };
}

module.exports = { create: create, readEnvFile: readEnvFile, CAPABILITY_BY_ACTION: CAPABILITY_BY_ACTION, POOL_BY_ACTION: POOL_BY_ACTION };
