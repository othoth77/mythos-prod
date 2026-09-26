'use strict';
// =====================================================
// MYTHOS supervisor — the autonomous supervision loop
// projects/mythos-orchestrator/supervisor/supervisor.js
//
//   ROUTER (escalation.js) deterministic LOCAL → QWEN → OPENAI → HUMAN ladder;
//                      no model ever decides which model to call
//   LOCAL (monitor.js, verify.js) process/heartbeat/timeout/exit/bridge/
//                      service/resource state and machine-check verification
//   QWEN  (qwen.js)    local model on Haddad, reached through a `mythos:haddad`
//                      consult Issue served by Haddad's own bridge
//   OPENAI (brain.js)  plans · reviews · diagnoses — only when LOCAL and QWEN
//                      cannot decide; per-task/recovery/root/day call limits
//   GITHUB (gh.js)     every task is an Issue: record, audit trail, history
//   TASK   (this file) state machine (states.js), durable store (store.js),
//                      parent/child recovery, loop protection, cost accounting
//   BRIDGE (bridge.js) the EXISTING Issues → control → executor pipeline
//   FABLE              the executor the bridge dispatches to (Model: Fable 5.1)
//   HOSTOPS            untouched: the supervisor never runs commands, never
//                      pushes, never merges, never touches a protected path
//
// Monitoring is event-driven over local state: a tick reads GitHub/control
// files and the executor record and calls a model ONLY on a decision point
// that local rules cannot settle. A structured objective whose acceptance
// criteria are all `check:` machine checks is planned and verified locally:
// a normal success makes zero OpenAI calls.
//
// tick() is idempotent and restart-safe: every side effect is preceded by a
// persisted intent carrying its execution_id, GitHub is searched for that id
// before anything is created again, a report is settled once, and a task is
// completed once. A COMPLETED report is not success: only machine checks (all
// criteria `check:`) or OpenAI review plus the deterministic checks can
// complete a task, and only then is the Issue closed.
// =====================================================

var crypto = require('crypto');
var states = require('./states');
var store = require('./store');
var router = require('../router');
var advisor = require('../advisor');
var escalation = require('./escalation');
var verify = require('./verify');
var qwen = require('./qwen');

function sha(x) { return crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 16); }
function nowIso() { return new Date().toISOString(); }
function secondsSince(iso, now) { return iso ? ((now || Date.now()) - Date.parse(iso)) / 1000 : Infinity; }
function norm(s) { return String(s || '').toLowerCase().replace(/[0-9a-f]{7,}/g, '#').replace(/\d+/g, 'n').replace(/\s+/g, ' ').trim().slice(0, 200); }

function clampSpec(spec, cfg) {
  var t = parseInt(spec.timeout_seconds, 10);
  if (!(t > 0)) t = cfg.default_timeout_seconds;
  return {
    title: String(spec.title || '').trim().slice(0, 100),
    objective: String(spec.objective || '').trim(),
    scope: (spec.scope || []).map(String).slice(0, 20),
    constraints: (spec.constraints || []).map(String).slice(0, 20),
    validation: (spec.validation || []).map(String).slice(0, 15),
    acceptance_criteria: (spec.acceptance_criteria || []).map(String).slice(0, 15),
    action: spec.action,
    timeout_seconds: Math.max(cfg.min_timeout_seconds, Math.min(cfg.max_timeout_seconds, t))
  };
}

function specProblems(spec, cfg) {
  var p = [];
  if (cfg.allowed_actions.indexOf(spec.action) === -1) p.push('action "' + spec.action + '" is not allowed');
  if (spec.objective.length < 10) p.push('objective too short');
  if (!spec.acceptance_criteria.length) p.push('no acceptance criteria');
  return p;
}

function create(deps) {
  var cfg = deps.cfg;
  var bridge = deps.bridge;
  var monitor = deps.monitor;
  var brain = deps.brain;
  var now = deps.now || function () { return Date.now(); };
  var cfgProblems = qwen.configProblems(cfg);
  if (cfgProblems.length) { var ce = new Error('CONFIG_INVALID: ' + cfgProblems.join('; ')); ce.code = 'CONFIG_INVALID'; throw ce; }

  // Core trace fields are applied LAST so no detail object can overwrite
  // them (a detail key named `event` once hid a refused-comment record).
  function log(task, event, detail, exec) {
    return store.journal(Object.assign({}, detail || {}, {
      correlation_id: task.correlation_id,
      task_id: task.task_id,
      root_task_id: task.root_task_id,
      issue: task.issue_number || null,
      execution_id: exec ? exec.execution_id : null,
      bridge_task_id: exec ? exec.bridge_task_id || null : null,
      executor_task_id: exec ? exec.executor_task_id || null : null,
      status: task.status,
      event: event
    }));
  }

  function move(task, to, reason, actor) {
    var from = task.status;
    states.transition(task, to, reason, actor);
    store.saveTask(task);
    log(task, 'transition', { from: from, to: to, reason: String(reason || '').slice(0, 300) });
  }

  function current(task) { return task.executions && task.executions.length ? task.executions[task.executions.length - 1] : null; }
  function root(task) { return task.root_task_id === task.task_id ? task : (store.loadTask(task.root_task_id) || task); }

  // ---------------------------------------------------------------- submit
  function submitObjective(input) {
    var objective = String(input.objective || '').trim();
    if (objective.length < 10) throw new Error('OBJECTIVE_TOO_SHORT');
    // Refuse at the door: a credential in an objective must never be stored
    // (it would be redacted into a different objective) nor sent anywhere.
    var kinds = advisor.advisorSecretKinds([objective].concat(input.acceptance || [], input.scope || [], input.constraints || [], input.validation || [], [input.title || '']).join('\n'));
    if (kinds.length) {
      var se = new Error('SECRET_IN_OBJECTIVE: matches ' + kinds.join(', ') + ' — remove it; nothing was stored or sent');
      se.code = 'SECRET_IN_OBJECTIVE';
      throw se;
    }
    var id = store.newId('SUP-', 8);
    var task = {
      task_id: id,
      parent_task_id: null,
      root_task_id: id,
      correlation_id: store.newId('COR-', 10),
      objective: objective,
      owner_acceptance: (input.acceptance || []).map(String),
      requested_by: input.requested_by || 'owner',
      // An owner-set timeout overrides the plan's for THIS task only (its
      // recovery tasks are planned freely) — e.g. a deliberately short budget.
      owner_timeout_seconds: input.timeout_seconds ? parseInt(input.timeout_seconds, 10) : null,
      scope: null,
      spec: null,
      status: 'PLANNED',
      executor: cfg.executor_model,
      attempt_count: 0,
      recovery_count: 0,
      recovery_total: 0,
      last_error: null,
      last_result: null,
      last_action: 'submitted',
      progress_marker: null,
      last_failure_signature: null,
      executions: [],
      failure_log: [],
      recovery_spec_hashes: [],
      children: [],
      active_child: null,
      decisions: [],
      history: [],
      created_at: nowIso(),
      updated_at: nowIso()
    };
    // LOCAL planning: a structured submission (an action plus acceptance
    // criteria) IS the plan — validated deterministically, no model asked.
    if (input.action && (input.acceptance || []).length) {
      var spec = clampSpec({
        title: input.title || objective.slice(0, 80), objective: objective, scope: input.scope || [], constraints: input.constraints || [],
        validation: input.validation || [], acceptance_criteria: input.acceptance, action: input.action,
        timeout_seconds: input.timeout_seconds || cfg.default_timeout_seconds
      }, cfg);
      var probs = specProblems(spec, cfg);
      if (probs.length) { var pe = new Error('INVALID_STRUCTURED_OBJECTIVE: ' + probs.join('; ')); pe.code = 'INVALID_STRUCTURED_OBJECTIVE'; throw pe; }
      task.spec = spec;
      task.scope = spec.scope;
      task.decisions.push({ at: nowIso(), kind: 'plan', tier: 'LOCAL', reason: 'structured objective (action + acceptance criteria)' });
      var cs = brain.ensureCosts(task);
      cs.local += 1;
      cs.escalations.push({ at: nowIso(), tier: 'LOCAL', purpose: 'plan', reason: 'structured objective' });
    }
    store.saveTask(task);
    log(task, 'objective_submitted', { objective: objective.slice(0, 300), plan_tier: task.spec ? 'LOCAL' : 'pending' });
    return task;
  }

  // ----------------------------------------------------------------- block
  function block(task, code, why, humanAction, evidence) {
    task.blocked = {
      code: code,
      why: String(why || '').slice(0, 1500),
      human_action: humanAction || 'Review the task history and decide; resume with `mythos-supervise resume ' + task.task_id + '`.',
      attempts: task.attempt_count,
      recoveries: task.recovery_count,
      tried: (task.executions || []).map(function (e) {
        return { execution_id: e.execution_id, bridge_task_id: e.bridge_task_id || null, outcome: e.outcome ? e.outcome.kind + (e.outcome.status ? ':' + e.outcome.status : '') : 'unsettled' };
      }).concat((task.children || []).map(function (c) { return { recovery_task: c }; })),
      evidence: evidence || (task.last_result ? { status: task.last_result.status, summary: String(task.last_result.summary || '').slice(0, 600), problems: task.last_result.problems } : null),
      at: nowIso()
    };
    task.last_action = 'blocked:' + code;
    move(task, 'BLOCKED', code + ': ' + why);
    if (!task.issue_number) return Promise.resolve(task);
    var b = task.blocked;
    var text = [
      '### MYTHOS supervisor — BLOCKED (`' + code + '`)',
      '',
      '**Why:** ' + b.why,
      '',
      '**Required human action:** ' + b.human_action,
      '',
      '| | |', '|---|---|',
      '| Supervisor task | `' + task.task_id + '` (root `' + task.root_task_id + '`, correlation `' + task.correlation_id + '`) |',
      '| Attempts | ' + b.attempts + ' |',
      '| Recovery tasks | ' + b.recoveries + ' |',
      '| What was tried | ' + (b.tried.map(function (t) { return t.recovery_task ? 'recovery ' + t.recovery_task : t.execution_id + ' → ' + t.outcome; }).join('<br>') || 'nothing dispatched') + ' |',
      '',
      'Automation has stopped for this task. It resumes only by an explicit human decision.'
    ].join('\n');
    return bridge.postOnce(task.issue_number, { event: 'blocked', task_id: task.task_id, code: code }, text)
      .then(function (c) {
        if (c && !c.ok) log(task, 'comment_refused', { comment: 'blocked', code: c.error && c.error.code });
        return bridge.label(task.issue_number, ['mythos:supervisor-blocked']);
      })
      .then(function () { return task; }, function () { return task; });
  }

  // -------------------------------------------------------------- dispatch
  function dispatch(task) {
    if (task.attempt_count >= cfg.max_attempts_per_task) {
      return block(task, 'ATTEMPT_LIMIT', 'attempt limit ' + cfg.max_attempts_per_task + ' reached for this task', null);
    }
    var exec = current(task);
    if (!exec || exec.dispatch === 'SUBMITTED' || exec.dispatch === 'RERUN_REQUESTED') {
      var prev = exec;
      exec = {
        execution_id: store.newId('EXEC-', 10),
        attempt: task.attempt_count + 1,
        issue_number: task.issue_number || null,
        bridge_task_id: null,
        min_attempt: prev && prev.bridge_task_id ? (parseInt((/-r(\d+)$/.exec(prev.bridge_task_id) || [0, 1])[1], 10) + 1) : 1,
        dispatch: task.issue_number ? 'RERUN_INTENT' : 'INTENT',
        settled: false,
        created_at: nowIso()
      };
      task.executions.push(exec);
      store.saveTask(task); // intent persisted BEFORE the side effect
      log(task, 'dispatch_intent', { mode: exec.dispatch }, exec);
    }
    if (exec.dispatch === 'INTENT') {
      return bridge.submitTask(task, exec).then(function (r) {
        if (!r.ok) return dispatchFailed(task, exec, r.error);
        exec.issue_number = r.issue_number;
        exec.dispatch = 'SUBMITTED';
        exec.dispatched_at = nowIso();
        task.issue_number = r.issue_number;
        task.issue_url = r.url || task.issue_url || null;
        task.attempt_count += 1;
        task.last_action = 'dispatched';
        log(task, r.adopted ? 'dispatch_adopted' : 'dispatched', { issue: r.issue_number }, exec);
        move(task, 'READY', (r.adopted ? 'adopted existing Issue #' : 'created Issue #') + r.issue_number);
        if (task.parent) {
          return bridge.postOnce(task.parent.issue_number, { event: 'recovery_dispatched', task_id: task.task_id },
            'MYTHOS supervisor: recovery task `' + task.task_id + '` dispatched as #' + r.issue_number + ' for this task.').then(function () { return task; }, function () { return task; });
        }
        return task;
      });
    }
    // RERUN_INTENT: never add the label twice — adopt an attempt the bridge already created.
    return bridge.getStatus(exec).then(function (st) {
      if (!st.ok) return dispatchFailed(task, exec, st.error);
      var already = st.phase !== 'SUBMITTED' || st.issue_labels.indexOf(cfg.rerun_label) !== -1;
      var go = already ? Promise.resolve({ ok: true }) : bridge.rerunTask(task, exec);
      return go.then(function (r) {
        if (!r.ok) return dispatchFailed(task, exec, r.error);
        exec.dispatch = 'RERUN_REQUESTED';
        exec.dispatched_at = nowIso();
        task.attempt_count += 1;
        task.last_action = 'rerun_requested';
        log(task, 'rerun_requested', { adopted: already }, exec);
        move(task, 'READY', 'requested a new attempt of Issue #' + task.issue_number);
        return task;
      });
    });
  }

  function dispatchFailed(task, exec, error) {
    if (error && (error.code === 'TASK_INTEGRITY' || error.code === 'OUTBOUND_SECRET')) {
      exec.last_error = error;
      task.last_error = error;
      store.saveTask(task);
      log(task, 'dispatch_refused', { code: error.code, detail: String(error.detail || '').slice(0, 300) }, exec);
      return block(task, error.code, error.detail || error.code,
        error.code === 'TASK_INTEGRITY'
          ? 'The generated Issue did not round-trip through the bridge parser with the validated metadata; nothing was created. Review the plan/diagnosis text.'
          : 'The generated Issue contained a credential-shaped string; nothing was sent to GitHub. Review the plan/diagnosis text.');
    }
    exec.dispatch_failures = (exec.dispatch_failures || 0) + 1;
    exec.last_error = error;
    task.last_error = error;
    store.saveTask(task);
    log(task, 'dispatch_failed', { error: error }, exec);
    if (exec.dispatch_failures >= 4) {
      return block(task, 'BRIDGE_UNAVAILABLE', 'could not dispatch to the bridge after ' + exec.dispatch_failures + ' tries: ' + (error && error.code), 'Check GitHub access for the deploy user (`gh auth status`) and the bridge timer.');
    }
    return Promise.resolve(task);
  }

  // ------------------------------------------------------------------ plan
  function stepPlanned(task) {
    if (task.spec) return dispatch(task);
    return brain.plan(task).then(function (p) {
      if (!p.ok) {
        task.planning_failures = (task.planning_failures || 0) + 1;
        task.last_error = { code: p.code, detail: p.detail };
        store.saveTask(task);
        log(task, 'plan_failed', { code: p.code, transient: p.transient });
        if (!p.transient || task.planning_failures >= 3) {
          return block(task, p.code === 'SECRET_IN_REQUEST' ? 'SECRET_GATE' : 'PLANNING_FAILED',
            'OpenAI planning did not produce a usable plan: ' + p.code + ' ' + (p.detail || ''),
            p.code === 'SECRET_IN_REQUEST' ? 'Remove the credential-shaped text from the objective and submit it again.' : null);
        }
        return task;
      }
      var d = p.decision;
      var spec = clampSpec(task.owner_timeout_seconds ? Object.assign({}, d.task, { timeout_seconds: task.owner_timeout_seconds }) : d.task, cfg);
      var probs = specProblems(spec, cfg);
      task.decisions.push({ at: nowIso(), kind: 'plan', advice_id: p.advice_id, risk_class: d.risk_class, requires_human_approval: d.requires_human_approval });
      if (probs.length) return block(task, 'PLAN_INVALID', probs.join('; '), null);
      if (d.requires_human_approval || router.APPROVAL_CLASSES.indexOf(d.risk_class) !== -1) {
        task.spec = spec;
        task.risk_class = d.risk_class;
        return block(task, 'HUMAN_APPROVAL_REQUIRED', (d.human_reason || 'risk class ' + d.risk_class + ' is approval-only'), 'Approve or reject this objective explicitly; the supervisor never runs approval-class work automatically.');
      }
      task.spec = spec;
      task.scope = spec.scope;
      task.risk_class = d.risk_class;
      store.saveTask(task);
      log(task, 'planned', { advice_id: p.advice_id, action: spec.action, risk_class: d.risk_class });
      return dispatch(task);
    });
  }

  // ------------------------------------------------------------ settlement
  // Settle-once: the first outcome for an execution wins; later ones are ignored.
  function settle(task, exec, outcome) {
    if (exec.settled) {
      log(task, 'duplicate_settle_ignored', { attempted: outcome.kind, kept: exec.outcome && exec.outcome.kind }, exec);
      return false;
    }
    exec.settled = true;
    exec.settled_at = nowIso();
    exec.outcome = outcome;
    store.saveTask(task);
    log(task, 'settled', { outcome: outcome.kind, report_status: outcome.status || null }, exec);
    return true;
  }

  function failTask(task, exec, kind, detail) {
    if (exec && !exec.settled) settle(task, exec, { kind: kind, detail: String(detail || '').slice(0, 600) });
    task.last_error = { code: kind, detail: String(detail || '').slice(0, 600) };
    task.last_failure = {
      kind: kind, detail: String(detail || '').slice(0, 600),
      monitor_state: exec && exec.monitor ? exec.monitor.monitor_state : null,
      crashes_seen: exec ? exec.crashes_seen || 0 : 0,
      resources: exec && exec.monitor && exec.monitor.resources ? exec.monitor.resources : (monitor.resources ? monitor.resources() : null),
      execution_id: exec ? exec.execution_id : null
    };
    move(task, 'FAILED', kind + ': ' + detail);
    return task;
  }

  // ------------------------------------------------------------------ poll
  function stepActive(task) {
    var exec = current(task);
    if (!exec || !exec.issue_number) return dispatch(task);
    return bridge.getStatus(exec).then(function (st) {
      if (!st.ok) {
        exec.poll_errors = (exec.poll_errors || 0) + 1;
        store.saveTask(task);
        log(task, 'poll_failed', { code: st.error && st.error.code, count: exec.poll_errors }, exec);
        if (exec.poll_errors >= 10) return failTask(task, exec, 'BRIDGE_FAILURE', 'GitHub/bridge unreadable for ' + exec.poll_errors + ' consecutive ticks: ' + (st.error && st.error.code));
        return task;
      }
      exec.poll_errors = 0;
      if (st.bridge_task_id && !exec.bridge_task_id) {
        exec.bridge_task_id = st.bridge_task_id;
        log(task, 'bridge_task_bound', {}, exec);
      }
      if (st.phase === 'LOST') return block(task, 'TASK_STATE_LOST', 'the GitHub Issue #' + exec.issue_number + ' no longer exists', 'Find out who deleted the Issue; resubmit the objective if it should still run.');
      if (st.issue_state === 'closed' && st.phase !== 'REPORTED') {
        return block(task, 'CLOSED_EXTERNALLY', 'Issue #' + exec.issue_number + ' was closed by someone else before a report', 'Reopen the Issue and resume, or leave it closed.');
      }
      if (st.phase === 'INVALID') return failTask(task, exec, 'SPEC_REJECTED_BY_BRIDGE', 'the bridge rejected the Issue as an invalid task');
      if (st.phase === 'SUBMITTED' || st.phase === 'QUEUED') {
        if (secondsSince(exec.dispatched_at, now()) > cfg.claim_deadline_seconds) {
          return failTask(task, exec, 'BRIDGE_FAILURE', 'the bridge did not claim the task within ' + cfg.claim_deadline_seconds + ' s (phase ' + st.phase + (st.deferred ? ', rerun deferred' : '') + ')');
        }
        store.saveTask(task);
        return task;
      }
      if (st.phase === 'CLAIMED') return stepClaimed(task, exec, st);
      if (st.phase === 'REPORTED') return stepReported(task, exec, st);
      return task;
    });
  }

  function stepClaimed(task, exec, st) {
    exec.claimed_at = exec.claimed_at || nowIso();
    return monitor.observe(exec.bridge_task_id).then(function (m) {
      var prevState = exec.monitor && exec.monitor.monitor_state;
      exec.monitor = m;
      if (m.executor_task_id) exec.executor_task_id = m.executor_task_id;
      if (m.monitor_state !== prevState) log(task, 'monitor', { monitor_state: m.monitor_state, executor_effective: m.executor_effective, retry_count: m.retry_count, daemon_active: m.daemon_active, resources: m.resources }, exec);
      if (m.monitor_state === 'FABLE_CRASHED') exec.crashes_seen = (exec.crashes_seen || 0) + (prevState === 'FABLE_CRASHED' ? 0 : 1);
      if (m.monitor_state === 'FABLE_UNREACHABLE') exec.unreachable_since = exec.unreachable_since || nowIso(); else exec.unreachable_since = null;
      if (m.monitor_state === 'FABLE_UNKNOWN') exec.unknown_since = exec.unknown_since || nowIso(); else exec.unknown_since = null;
      store.saveTask(task);

      if (exec.unreachable_since && secondsSince(exec.unreachable_since, now()) > cfg.stall_grace_seconds) {
        return failTask(task, exec, 'FABLE_UNREACHABLE', 'the executor daemon has not been active for ' + Math.round(secondsSince(exec.unreachable_since, now())) + ' s');
      }
      if (exec.unknown_since && secondsSince(exec.unknown_since, now()) > cfg.stall_grace_seconds) {
        return failTask(task, exec, 'TASK_STATE_LOST', 'the bridge claimed ' + exec.bridge_task_id + ' but the executor has no record of it');
      }
      var hardLimit = (task.spec.timeout_seconds * 4) + cfg.stall_grace_seconds;
      if (secondsSince(exec.claimed_at, now()) > hardLimit) {
        return failTask(task, exec, 'STALLED', 'no report ' + Math.round(secondsSince(exec.claimed_at, now())) + ' s after the claim (limit ' + hardLimit + ' s, monitor ' + m.monitor_state + ')');
      }
      var want = (m.monitor_state === 'FABLE_TIMED_OUT' || m.monitor_state === 'FABLE_RETRYING' || m.monitor_state === 'FABLE_UNREACHABLE') ? 'WAITING' : 'RUNNING';
      if (task.status !== want && states.canTransition(task.status, want)) move(task, want, 'monitor: ' + m.monitor_state);
      return task;
    });
  }

  function stepReported(task, exec, st) {
    return bridge.getResult(exec).then(function (r) {
      if (!r.ok) {
        var code = r.error && r.error.code;
        if (code === 'REPORT_NOT_YET') {
          exec.report_seen_at = exec.report_seen_at || nowIso();
          store.saveTask(task);
          if (task.status !== 'WAITING' && states.canTransition(task.status, 'WAITING')) move(task, 'WAITING', 'report marker seen; waiting for the relay to push the report');
          if (secondsSince(exec.report_seen_at, now()) > cfg.report_wait_seconds) {
            return failTask(task, exec, 'BRIDGE_FAILURE', 'the report for ' + exec.bridge_task_id + ' never reached GitHub within ' + cfg.report_wait_seconds + ' s');
          }
          return task;
        }
        exec.unreadable = (exec.unreadable || 0) + 1;
        store.saveTask(task);
        log(task, 'report_unreadable', { code: code, count: exec.unreadable }, exec);
        if (exec.unreadable >= 3) return failTask(task, exec, 'BRIDGE_FAILURE', 'report for ' + exec.bridge_task_id + ' unreadable ' + exec.unreadable + ' times: ' + code);
        return task;
      }
      var report = r.report;
      // Reports are immutable, so routing an already-settled one again is
      // deterministic: a crash between settle and the transition cannot strand the task.
      if (!exec.settled) settle(task, exec, { kind: 'REPORT', status: report.status, marker_status: st.report_marker_status });
      else if (exec.outcome && exec.outcome.kind !== 'REPORT') return task;
      var curated = brain.curateReport(report);
      task.last_result = curated;
      task.last_delivery = {
        commits: (report.commits || []).map(function (c) { return { sha: c.sha, branch: c.branch || null, on_origin: c.on_origin === true }; }),
        delivery_branch: report.delivery && report.delivery.branch || null,
        git_verified: !!(report.validation && report.validation.git_verified === true),
        remote_head: report.validation && report.validation.remote_head || null
      };
      task.progress_marker = sha([curated.files_changed, (curated.commits || []).map(function (c) { return c.sha; }), curated.tests, curated.status]);
      store.saveTask(task);
      if (report.status === 'COMPLETED') {
        task.last_action = 'reported_completed';
        move(task, 'VERIFYING', 'report COMPLETED for ' + exec.bridge_task_id + ' — verification owed (exit is not success)');
        return task;
      }
      if (report.status === 'CANCELLED') return block(task, 'CANCELLED_BY_HUMAN', 'the attempt was cancelled on the control branch', null);
      if (report.status === 'BLOCKED' && st.report_marker_status === 'HUMAN_APPROVAL') {
        return block(task, 'HUMAN_APPROVAL', 'the executor stopped for an owner decision: ' + String(report.summary || '').slice(0, 800),
          'Read the report on Issue #' + exec.issue_number + ' and decide; the supervisor never approves on the owner\'s behalf.');
      }
      return failTask(task, exec, report.status === 'BLOCKED' ? 'EXECUTION_BLOCKED' : 'EXECUTION_FAILED', String(report.summary || '').slice(0, 600));
    });
  }

  // ---------------------------------------------------------------- verify
  function stepVerifying(task) {
    var r = task.last_result || {};
    var evidence = task.resume_pending ? { recovery_child_report: task.resume_evidence || null } : null;
    if (task.verified) return complete(task, task.verified.review, task.verified.advice_id); // close retry, no second review
    if (!task.resume_pending && r.status !== 'COMPLETED') return Promise.resolve(failTask(task, current(task), 'VERIFY_PRECONDITION', 'no COMPLETED report to verify'));
    var writes = ['implement', 'document'].indexOf(task.spec.action) !== -1;
    var exec = current(task);
    var delivered = (writes && !task.resume_pending)
      ? bridge.verifyDelivery(task.last_delivery, exec && exec.bridge_task_id)
      : Promise.resolve({ ok: true, skipped: true });
    return delivered.then(function (dv) {
      if (!dv.ok) {
        task.delivery_check = { at: nowIso(), pending: !!dv.pending, problems: dv.problems };
        store.saveTask(task);
        log(task, 'delivery_unverified', { pending: !!dv.pending, problems: dv.problems }, exec);
        if (dv.pending && secondsSince(exec && exec.settled_at, now()) <= cfg.report_wait_seconds) return task; // relay not done yet; stay VERIFYING, no review, no close
        return failTask(task, exec, dv.pending ? 'WRITE_NOT_DELIVERED' : 'WRITE_NOT_VERIFIED', dv.problems.join('; '));
      }
      if (!dv.skipped) { task.delivery_check = { at: nowIso(), verified: dv.verified, branch: dv.branch, head: dv.head }; store.saveTask(task); log(task, 'delivery_verified', { verified: dv.verified, branch: dv.branch }, exec); }
      // LOCAL first: when every criterion is a machine check, no model is asked.
      var det = verify.evaluate(task.spec.acceptance_criteria, task.resume_pending ? (task.resume_evidence || {}) : r,
        task.resume_pending ? task.resume_delivery : task.delivery_check);
      if (det.decided) {
        var cs = brain.ensureCosts(task);
        cs.local += 1;
        cs.escalations.push({ at: nowIso(), tier: 'LOCAL', purpose: 'review', reason: 'every acceptance criterion is a machine check' });
        log(task, 'verified_locally', { passed: det.passed, unmet: det.results.filter(function (x) { return !x.met; }).map(function (x) { return x.criterion; }) });
        if (det.passed) {
          task.verified = { advice_id: 'local-deterministic', review: { verdict: 'ACCEPT', criteria: det.results, findings: [], human_action: null, confidence: 'high' }, at: nowIso() };
          keepEvidence(task, r);
          store.saveTask(task);
          return complete(task, task.verified.review, task.verified.advice_id);
        }
        var unmetWhy = det.results.filter(function (x) { return !x.met; }).map(function (x) { return 'unmet: ' + x.criterion + ' — ' + x.evidence; }).join('; ');
        if (task.resume_pending) { task.resume_pending = false; store.saveTask(task); return dispatchResume(task, unmetWhy); }
        return failTask(task, exec, 'VERIFICATION_FAILED', unmetWhy);
      }
      return review(task, r, evidence, writes);
    });
  }

  // The evidence a task was actually verified on: its own report, or — when it
  // completed through a recovery — the recovery's evidence. A parent resumes
  // on THIS, never on the child's own last (failed) report.
  function keepEvidence(task, r) {
    task.verified_evidence = task.resume_pending ? (task.resume_evidence || null) : r;
    task.verified_delivery = task.resume_pending ? (task.resume_delivery || null) : (task.delivery_check || null);
  }

  function review(task, r, evidence, writes) {
    return brain.review(task, r, evidence).then(function (v) {
      if (!v.ok) {
        task.review_failures = (task.review_failures || 0) + 1;
        store.saveTask(task);
        log(task, 'review_failed', { code: v.code, transient: v.transient });
        if (!v.transient || task.review_failures >= 3) return block(task, 'REVIEW_UNAVAILABLE', 'OpenAI verification failed: ' + v.code + ' ' + (v.detail || ''), null);
        return task;
      }
      var d = v.decision;
      var unmet = (d.criteria || []).filter(function (c) { return !c.met; });
      var mechanical = [];
      if (!task.resume_pending && r.status !== 'COMPLETED') mechanical.push('report status is ' + r.status);
      if (writes && !task.resume_pending && !(r.commits || []).length) mechanical.push('a ' + task.spec.action + ' task produced no commit');
      if (!(d.criteria || []).length) mechanical.push('review listed no criteria');
      task.decisions.push({ at: nowIso(), kind: 'review', advice_id: v.advice_id, verdict: d.verdict, unmet: unmet.length, confidence: d.confidence, mechanical: mechanical });
      store.saveTask(task);
      log(task, 'reviewed', { advice_id: v.advice_id, verdict: d.verdict, unmet: unmet.length, confidence: d.confidence, mechanical: mechanical });
      if (d.verdict === 'BLOCK') return block(task, 'REVIEW_BLOCK', (d.findings || []).join('; ') || 'the reviewer requires a person', d.human_action);
      if (d.verdict === 'ACCEPT' && !unmet.length && d.confidence !== 'low' && !mechanical.length) {
        task.verified = { advice_id: v.advice_id, review: d, at: nowIso() };
        keepEvidence(task, r);
        store.saveTask(task);
        return complete(task, d, v.advice_id);
      }
      var why = mechanical.concat(unmet.map(function (c) { return 'unmet: ' + c.criterion + ' — ' + c.evidence; })).concat(d.findings || []).join('; ');
      if (task.resume_pending) {
        task.resume_pending = false;
        task.last_action = 'resume_after_recovery';
        store.saveTask(task);
        log(task, 'resume_redispatch', { why: why.slice(0, 300) });
        return dispatchResume(task, why);
      }
      return failTask(task, current(task), 'REVIEW_REJECTED', why || ('verdict ' + d.verdict + ', confidence ' + d.confidence));
    });
  }

  // Parent resumes after a completed recovery: a NEW attempt of its own Issue.
  function dispatchResume(task, why) {
    var exec = {
      execution_id: store.newId('EXEC-', 10),
      attempt: task.attempt_count + 1,
      issue_number: task.issue_number,
      bridge_task_id: null,
      min_attempt: (function () { var p = current(task); return p && p.bridge_task_id ? (parseInt((/-r(\d+)$/.exec(p.bridge_task_id) || [0, 1])[1], 10) + 1) : 2; })(),
      dispatch: 'RERUN_INTENT',
      settled: false,
      created_at: nowIso(),
      resume_reason: String(why || '').slice(0, 300)
    };
    if (task.attempt_count >= cfg.max_attempts_per_task) return block(task, 'ATTEMPT_LIMIT', 'attempt limit reached while resuming after recovery', null);
    task.executions.push(exec);
    store.saveTask(task);
    return bridge.getStatus(exec).then(function (st) {
      if (!st.ok) return dispatchFailed(task, exec, st.error);
      var already = st.phase !== 'SUBMITTED' || st.issue_labels.indexOf(cfg.rerun_label) !== -1;
      return (already ? Promise.resolve({ ok: true }) : bridge.rerunTask(task, exec)).then(function (r) {
        if (!r.ok) return dispatchFailed(task, exec, r.error);
        exec.dispatch = 'RERUN_REQUESTED';
        exec.dispatched_at = nowIso();
        task.attempt_count += 1;
        move(task, 'READY', 'resumed after recovery: new attempt of Issue #' + task.issue_number);
        return task;
      });
    });
  }

  function complete(task, review, adviceId) {
    if (task.status === 'COMPLETED') return Promise.resolve(task); // complete-once
    var rows = (review.criteria || []).map(function (c) { return '| ' + String(c.criterion).replace(/\|/g, '/') + ' | ✅ | ' + String(c.evidence).replace(/\|/g, '/').slice(0, 300) + ' |'; });
    var text = [
      '### MYTHOS supervisor — VERIFIED, task complete',
      '',
      (adviceId === 'local-deterministic'
        ? 'Local deterministic verification (machine checks, no model) found every acceptance criterion met.'
        : 'OpenAI verification (`' + adviceId + '`, confidence ' + review.confidence + ') found every acceptance criterion met, and the deterministic checks passed.'),
      '',
      '| Criterion | Met | Evidence |', '|---|---|---|'
    ].concat(rows).concat([
      '',
      'Supervisor task `' + task.task_id + '` · root `' + task.root_task_id + '` · correlation `' + task.correlation_id + '` · attempts ' + task.attempt_count + ' · recovery tasks ' + task.recovery_count + '.',
      'Closing this Issue. Merging any task branch remains a human decision.'
    ]).join('\n');
    return bridge.postOnce(task.issue_number, { event: 'verified', task_id: task.task_id }, text).then(function (c) {
      if (!c.ok && c.error && c.error.code === 'OUTBOUND_SECRET') {
        return block(task, 'OUTBOUND_SECRET', 'the verification comment contained a credential-shaped string and was not posted; the Issue was NOT closed', null);
      }
      if (!c.ok) { log(task, 'verify_comment_failed', { code: c.error && c.error.code }); return task; } // retried next tick, still VERIFYING
      return bridge.closeIssue(task.issue_number, 'completed').then(function (cl) {
        if (!cl.ok) { log(task, 'close_failed', { code: cl.error && cl.error.code }); return task; }
        task.last_action = 'completed';
        task.completed_at = nowIso();
        move(task, 'COMPLETED', 'verified by ' + adviceId + '; Issue #' + task.issue_number + ' closed');
        return task;
      });
    });
  }

  // --------------------------------------------------------------- recover
  function failureSignature(task) {
    var f = task.last_failure || {};
    var r = task.last_result || {};
    return sha([f.kind, r.status || null, r.blocker ? r.blocker.code : null, norm((r.problems || [])[0] || f.detail), f.monitor_state || null]);
  }

  var HUMAN_ACTIONS = {
    SERVICE_DOWN: 'Restore the executor service (as deploy: systemctl --user status/restart mythos-ai-executor.service), then resume this task.',
    RESOURCE: 'Free host memory/disk (see /opt/mythos-memwatch/memwatch.log and df), then resume this task.',
    STATE_LOST: 'Find out what removed the Issue or the executor record; resubmit the objective if it should still run.',
    WRITE_UNDELIVERED: 'Check the governance relay (mythos-git-push) for the task branch; resume once the commit is on GitHub.'
  };

  function markTried(rt, task, key, tier) {
    rt.escalations = rt.escalations || {};
    rt.escalations[key] = (rt.escalations[key] || []).concat([tier]);
    if (rt !== task) store.saveTask(rt);
    store.saveTask(task);
  }

  function stepFailed(task) {
    var rt = root(task);
    var sig = failureSignature(task);
    task.last_failure_signature = sig;
    rt.failure_log = rt.failure_log || [];
    var curExec = (current(task) || {}).execution_id || null;
    var same = rt.failure_log.filter(function (f) { return f.signature === sig && f.progress_marker === (task.progress_marker || null) && f.execution_id !== curExec; });
    if (!task.failure_logged_for || task.failure_logged_for !== curExec) {
      rt.failure_log.push({ at: nowIso(), task_id: task.task_id, execution_id: curExec, signature: sig, progress_marker: task.progress_marker || null, kind: (task.last_failure || {}).kind });
      task.failure_logged_for = curExec;
      if (rt !== task) store.saveTask(rt);
      store.saveTask(task);
    }
    if (same.length + 1 > cfg.same_failure_limit) {
      return block(task, 'LOOP_NO_PROGRESS', 'the same failure (' + (task.last_failure || {}).kind + ', signature ' + sig + ') occurred ' + (same.length + 1) + ' times with no progress',
        'Diagnose manually: repeated recovery did not change the outcome.', { failure: task.last_failure, signatures: rt.failure_log.slice(-6) });
    }
    if ((rt.recovery_total || 0) >= cfg.max_recoveries_per_root) {
      return block(task, 'RECOVERY_LIMIT', 'the root task already used ' + rt.recovery_total + ' recovery tasks (limit ' + cfg.max_recoveries_per_root + ')', null);
    }
    var c = escalation.classify(task, cfg);
    var key = sig + '|' + (task.progress_marker || '');
    if (task.consult && task.consult.key === key && !task.consult.done) return pollConsult(task, rt, c, key);
    return decide(task, rt, c, key);
  }

  // The deterministic ladder for ONE unchanged failure: LOCAL → QWEN → OPENAI → HUMAN.
  function decide(task, rt, c, key) {
    var tried = (rt.escalations || {})[key] || [];
    var r = escalation.route(c.cls, tried, cfg);
    log(task, 'route', { cls: c.cls, why: c.why, tier: r.tier, reason: r.reason, tried: tried });
    if (r.tier === 'HUMAN') {
      return block(task, escalation.RULES[c.cls] === 'HUMAN' ? c.cls : 'ESCALATION_EXHAUSTED', r.reason + ' — ' + c.why,
        HUMAN_ACTIONS[c.cls] || 'Diagnose manually; every automatic tier was already tried for this unchanged failure.', { classification: c.cls, tried: tried, failure: task.last_failure });
    }
    markTried(rt, task, key, r.tier);
    if (r.tier === 'LOCAL') {
      var spec = escalation.localRecovery(c.cls, task, cfg);
      if (!spec) return decide(task, root(task), c, key); // no local rule after all → next tier
      var cs = brain.ensureCosts(task);
      cs.local += 1;
      cs.escalations.push({ at: nowIso(), tier: 'LOCAL', purpose: 'diagnose', reason: r.reason });
      return createChild(task, root(task), spec, { tier: 'LOCAL', classification: c.cls, diagnosis: 'deterministic rule: ' + c.why, what_changes: spec.constraints[spec.constraints.length - 1], advice_id: null, confidence: 'high' });
    }
    if (r.tier === 'QWEN') return requestConsult(task, rt, c, key, r.reason);
    return openaiDiagnose(task, rt, c, key, r.reason);
  }

  function failureEvidence(task, c) {
    var exec = current(task) || {};
    return {
      cls: c.cls, kind: (task.last_failure || {}).kind, detail: (task.last_failure || {}).detail,
      monitor_state: (task.last_failure || {}).monitor_state, crashes_seen: (task.last_failure || {}).crashes_seen || 0,
      resources: (task.last_failure || {}).resources || null,
      monitor: exec.monitor ? { monitor_state: exec.monitor.monitor_state, executor_effective: exec.monitor.executor_effective, retry_count: exec.monitor.retry_count, daemon_active: exec.monitor.daemon_active } : null,
      report: task.last_result
    };
  }

  function history(rt) {
    return (rt.failure_log || []).slice(-6).map(function (f) { return { task_id: f.task_id, kind: f.kind }; })
      .concat((rt.recovery_specs_seen || []).slice(-4).map(function (s) { return { previous_recovery: s }; }));
  }

  // ---- QWEN tier: a read-only consult through Haddad's own bridge (async).
  function requestConsult(task, rt, c, key, reason) {
    if (!task.consult || task.consult.key !== key) {
      if (task.consult && task.consult.issue_number && !task.consult.closed) {
        // Keep the previous consult on record so the sweep still closes it.
        if (!task.consult.done) { task.consult.done = true; task.consult.outcome = 'superseded by a new failure'; task.consult.settled_at = nowIso(); }
        task.consults_prior = (task.consults_prior || []).concat([task.consult]);
      }
      task.consult = { key: key, execution_id: store.newId('EXEC-', 10), requested_at: nowIso(), issue_number: null, done: false, failures: 0, reason: reason };
      store.saveTask(task); // intent before the side effect
    }
    var consultTask = { task_id: task.task_id, correlation_id: task.correlation_id, parent: null,
      spec: clampSpec(qwen.request(task, failureEvidence(task, c), history(rt), cfg), cfg) };
    var cexec = { execution_id: task.consult.execution_id, issue_number: task.consult.issue_number };
    return bridge.submitTask(consultTask, cexec, { label: cfg.qwen_label, labels: [cfg.qwen_label, cfg.supervised_label], model: null, titlePrefix: 'CONSULT: [supervised] ' }).then(function (res) {
      if (!res.ok) {
        task.consult.failures += 1;
        store.saveTask(task);
        log(task, 'consult_failed', { code: res.error && res.error.code });
        var hard = res.error && (res.error.code === 'TASK_INTEGRITY' || res.error.code === 'OUTBOUND_SECRET');
        if (hard || task.consult.failures >= 3) return escalateFromQwen(task, rt, c, key, 'QWEN consult could not be sent: ' + (res.error && res.error.code));
        return task;
      }
      if (!task.consult.issue_number) {
        task.consult.issue_number = res.issue_number;
        var cs = brain.ensureCosts(task);
        cs.qwen += 1;
        cs.escalations.push({ at: nowIso(), tier: 'QWEN', purpose: 'diagnose', reason: reason });
        store.saveTask(task);
        log(task, res.adopted ? 'consult_adopted' : 'consult_requested', { consult_issue: res.issue_number, cls: c.cls });
      }
      return task; // the answer arrives on a later tick — no model is polled
    });
  }

  function pollConsult(task, rt, c, key) {
    // HARD deadline, checked before anything is read: past it the consult is
    // settled and escalated whatever GitHub or Haddad would say — an answer
    // that is late, or unreadable because of a GitHub outage, never counts.
    if (secondsSince(task.consult.requested_at, now()) > cfg.qwen_deadline_seconds) {
      return escalateFromQwen(task, rt, c, key, 'QWEN_TIMEOUT: no usable answer within ' + cfg.qwen_deadline_seconds + ' s');
    }
    if (!task.consult.issue_number) return requestConsult(task, rt, c, key, task.consult.reason);
    return bridge.readConsult({ issue_number: task.consult.issue_number }).then(function (st) {
      if (!st.ok) return task; // GitHub blip: try again next tick (the deadline still applies)
      if (st.phase === 'PENDING') return task;
      if (st.phase !== 'ANSWERED') return escalateFromQwen(task, rt, c, key, 'QWEN_CONSULT_' + (st.status || st.phase));
      var norm = qwen.normalizeAnswer(st.body);
      if (!norm.ok) return escalateFromQwen(task, rt, c, key, norm.reason);
      var parsed = qwen.parseAnswer(norm.answer, task);
      if (!parsed.ok) return escalateFromQwen(task, rt, c, key, parsed.reason);
      finishConsult(task, 'answered');
      var d = parsed.decision;
      task.decisions.push({ at: nowIso(), kind: 'diagnosis', tier: 'QWEN', consult_issue: task.consult.issue_number, classification: d.classification, confidence: d.confidence });
      log(task, 'diagnosed', { tier: 'QWEN', classification: d.classification, consult_issue: task.consult.issue_number });
      return createChild(task, root(task), d.recovery_task, { tier: 'QWEN', classification: d.classification, diagnosis: d.diagnosis, what_changes: d.what_changes, advice_id: 'qwen-consult-#' + task.consult.issue_number, confidence: d.confidence });
    });
  }

  // Settles the consult exactly once (persisted before any escalation). Its
  // Issue is closed by sweepConsults at the end of the tick — closing is what
  // cancels any Haddad attempt or retry still pending — and the close is
  // retried every tick until GitHub confirms it.
  function finishConsult(task, outcome) {
    if (task.consult.done) return;
    task.consult.done = true;
    task.consult.outcome = outcome;
    task.consult.settled_at = nowIso();
    store.saveTask(task);
  }

  function consultRecords(t) { return [t.consult].concat(t.consults_prior || []).filter(Boolean); }

  function closeConsultsOf(task) {
    var waiting = task.status === 'FAILED' && task.consult && !task.consult.done;
    return consultRecords(task).reduce(function (p, rec) {
      return p.then(function () {
        if (!rec.issue_number || rec.closed || (rec === task.consult && waiting)) return;
        if (!rec.done) { // the task moved on (blocked, cancelled, completed…) while Qwen was still working
          rec.done = true;
          rec.outcome = 'abandoned: task is ' + task.status;
          rec.settled_at = nowIso();
          store.saveTask(task);
          log(task, 'consult_abandoned', { consult_issue: rec.issue_number, status: task.status });
        }
        var n = rec.issue_number;
        var fail = function (why) {
          rec.close_failures = (rec.close_failures || 0) + 1;
          store.saveTask(task);
          log(task, 'consult_close_failed', { consult_issue: n, why: String(why).slice(0, 200), failures: rec.close_failures });
        };
        var close = function () { return bridge.closeIssue(n, rec.outcome === 'answered' ? 'completed' : 'not_planned'); };
        return bridge.postOnce(n, { event: 'consult_consumed', task_id: task.task_id }, 'Settled by the MYTHOS supervisor (' + String(rec.outcome).slice(0, 200) + '). Closing this consult cancels any attempt still running or waiting to retry.')
          .then(close, close)
          .then(function (r) {
            if (!r || !r.ok) return fail(r && r.error ? r.error.code : 'close failed');
            rec.closed = true;
            rec.closed_at = nowIso();
            store.saveTask(task);
            log(task, 'consult_closed', { consult_issue: n, outcome: rec.outcome });
          }, function (e) { return fail(e && e.message); });
      });
    }, Promise.resolve());
  }

  // Every consult Issue that is settled (or whose task moved on) but not yet
  // confirmed closed — including tasks that are no longer active.
  function sweepConsults() {
    var pending = store.listTasks().filter(function (t) { return consultRecords(t).some(function (r) { return r.issue_number && !r.closed; }); });
    return pending.reduce(function (p, t) {
      return p.then(function () { var fresh = store.loadTask(t.task_id); return fresh ? closeConsultsOf(fresh) : null; });
    }, Promise.resolve());
  }

  function escalateFromQwen(task, rt, c, key, why) {
    finishConsult(task, 'escalated: ' + why);
    log(task, 'qwen_escalated', { why: String(why).slice(0, 300) });
    var rt2 = root(task);
    var tried = (rt2.escalations || {})[key] || [];
    var r = escalation.route(c.cls, tried, cfg);
    if (r.tier !== 'OPENAI') return decide(task, rt2, c, key);
    markTried(rt2, task, key, 'OPENAI');
    return openaiDiagnose(task, rt2, c, key, 'QWEN could not resolve it (' + why + ')');
  }

  // ---- OPENAI tier: only when the ladder says so.
  function openaiDiagnose(task, rt, c, key, reason) {
    return brain.diagnose(task, failureEvidence(task, c), history(rt), reason).then(function (dg) {
      if (!dg.ok) {
        task.diagnosis_failures = (task.diagnosis_failures || 0) + 1;
        store.saveTask(task);
        log(task, 'diagnosis_failed', { code: dg.code, transient: dg.transient });
        if (!dg.transient || task.diagnosis_failures >= 3) return block(task, /BUDGET/.test(dg.code) ? dg.code : 'DIAGNOSIS_UNAVAILABLE', 'OpenAI diagnosis failed: ' + dg.code + ' ' + (dg.detail || ''), null);
        // Retry OpenAI next tick for the same failure without a new tier decision.
        var rt3 = root(task);
        rt3.escalations[key] = (rt3.escalations[key] || []).filter(function (t, i, a) { return !(t === 'OPENAI' && i === a.lastIndexOf('OPENAI')); });
        if (rt3 !== task) store.saveTask(rt3);
        store.saveTask(task);
        return task;
      }
      var d = dg.decision;
      task.decisions.push({ at: nowIso(), kind: 'diagnosis', tier: 'OPENAI', advice_id: dg.advice_id, classification: d.classification, recoverable: d.recoverable });
      log(task, 'diagnosed', { tier: 'OPENAI', advice_id: dg.advice_id, classification: d.classification, recoverable: d.recoverable });
      if (!d.recoverable || d.classification === 'HUMAN_REQUIRED') {
        return block(task, 'HUMAN_REQUIRED', d.diagnosis, d.human_action || null, { classification: d.classification, failure: (task.last_failure || {}).kind });
      }
      return createChild(task, root(task), d.recovery_task, { tier: 'OPENAI', classification: d.classification, diagnosis: d.diagnosis, what_changes: d.what_changes, advice_id: dg.advice_id, confidence: d.confidence });
    });
  }

  // One recovery child, whatever tier produced it: validated, never more
  // privileged than the root task, never a repeat of an earlier recovery.
  function createChild(task, rt, rawSpec, meta) {
    var spec = clampSpec(rawSpec, cfg);
    // A model never weakens what counts as success: when the parent is
    // verified by machine checks, the recovery inherits those checks as its
    // acceptance; the model's free-text criteria become extra validation
    // guidance for the executor, not acceptance.
    if (verify.allDeterministic(task.spec.acceptance_criteria)) {
      var modelChecks = spec.acceptance_criteria.filter(function (c) { return verify.parse(c) !== null; });
      var guidance = spec.acceptance_criteria.filter(function (c) { return verify.parse(c) === null; }).map(function (c) { return 'Also show evidence that: ' + c; });
      spec.acceptance_criteria = task.spec.acceptance_criteria.concat(modelChecks.filter(function (c) { return task.spec.acceptance_criteria.indexOf(c) === -1; }));
      spec.validation = spec.validation.concat(guidance).slice(0, 15);
    }
    var probs = specProblems(spec, cfg);
    if (probs.length) return block(task, 'RECOVERY_INVALID', 'the proposed recovery task is not executable: ' + probs.join('; '), null);
    var rootAction = (rt.spec && rt.spec.action) || task.spec.action;
    if (escalation.actionRank(spec.action) > escalation.actionRank(rootAction)) {
      return block(task, 'PRIVILEGE_ESCALATION_REFUSED', 'the ' + meta.tier + ' recovery asked for "' + spec.action + '", more privileged than the original "' + rootAction + '"',
        'Approve the wider action explicitly by submitting a new objective; recovery never widens privilege on its own.');
    }
    var specHash = sha([norm(spec.objective), spec.action, spec.validation.map(norm), spec.scope.map(norm), spec.constraints.map(norm), spec.timeout_seconds]);
    if ((rt.recovery_spec_hashes || []).indexOf(specHash) !== -1) {
      return block(task, 'REPEATED_RECOVERY', 'the ' + meta.tier + ' diagnosis proposed a recovery identical to one that already ran', 'Diagnose manually; the automatic recovery would repeat itself.');
    }
    var child = {
      task_id: task.task_id + '-R' + (task.recovery_count + 1),
      parent_task_id: task.task_id,
      root_task_id: task.root_task_id,
      correlation_id: task.correlation_id,
      objective: spec.objective,
      owner_acceptance: [],
      requested_by: 'supervisor:' + meta.tier.toLowerCase(),
      scope: spec.scope,
      spec: spec,
      diagnosis: { tier: meta.tier, classification: meta.classification, diagnosis: String(meta.diagnosis || '').slice(0, 1200), what_changes: String(meta.what_changes || '').slice(0, 600), advice_id: meta.advice_id || null },
      parent: { task_id: task.task_id, issue_number: task.issue_number },
      status: 'PLANNED',
      executor: cfg.executor_model,
      attempt_count: 0,
      recovery_count: 0,
      last_error: null,
      last_result: null,
      last_action: 'created_by_' + meta.tier.toLowerCase(),
      progress_marker: null,
      last_failure_signature: null,
      executions: [],
      failure_log: [],
      children: [],
      active_child: null,
      decisions: [],
      history: [],
      created_at: nowIso(),
      updated_at: nowIso()
    };
    if (store.loadTask(child.task_id)) child = store.loadTask(child.task_id); // idempotent across a crash here
    else store.saveTask(child);
    rt = root(task);
    rt.recovery_total = (rt.recovery_total || 0) + 1;
    rt.recovery_spec_hashes = (rt.recovery_spec_hashes || []).concat([specHash]);
    rt.recovery_specs_seen = (rt.recovery_specs_seen || []).concat([{ tier: meta.tier, classification: meta.classification, objective: spec.objective.slice(0, 200), action: spec.action }]);
    if (rt !== task) store.saveTask(rt);
    else { task.recovery_total = rt.recovery_total; task.recovery_spec_hashes = rt.recovery_spec_hashes; task.recovery_specs_seen = rt.recovery_specs_seen; task.escalations = rt.escalations; }
    task.children.push(child.task_id);
    task.active_child = child.task_id;
    task.recovery_count += 1;
    task.last_action = 'recovery_created_' + meta.tier.toLowerCase();
    log(task, 'recovery_created', { child: child.task_id, tier: meta.tier, classification: meta.classification });
    move(task, 'RECOVERY', meta.tier + ' ' + meta.classification + ' → recovery task ' + child.task_id);
    var text = [
      '### MYTHOS supervisor — diagnosis and recovery (' + meta.tier + ')',
      '',
      '**Failure:** `' + ((task.last_failure || {}).kind || 'unknown') + '`' + ((task.last_failure || {}).monitor_state ? ' (monitor: `' + task.last_failure.monitor_state + '`)' : ''),
      '**Diagnosis** (' + meta.tier + (meta.advice_id ? ', `' + meta.advice_id + '`' : '') + ', ' + meta.classification + ', confidence ' + (meta.confidence || 'n/a') + '): ' + String(meta.diagnosis || '').slice(0, 1200),
      '**What the recovery changes:** ' + String(meta.what_changes || '').slice(0, 600),
      '',
      'Recovery task `' + child.task_id + '` is being dispatched as a new Issue. This task resumes when it completes.'
    ].join('\n');
    return bridge.postOnce(task.issue_number, { event: 'recovery', task_id: task.task_id, child: child.task_id }, text)
      .then(function (cm) { if (cm && !cm.ok) log(task, 'comment_refused', { comment: 'recovery', code: cm.error && cm.error.code }); return stepPlanned(child); },
        function () { return stepPlanned(child); })
      .then(function () { return task; });
  }

  function stepRecovery(task) {
    var child = task.active_child ? store.loadTask(task.active_child) : null;
    if (!child) return block(task, 'TASK_STATE_LOST', 'recovery task ' + task.active_child + ' is missing from the store', null);
    if (child.status === 'COMPLETED') {
      task.resume_pending = true;
      task.resume_evidence = child.verified_evidence || child.last_result;
      task.resume_delivery = child.verified ? (child.verified_delivery || null) : (child.delivery_check || null);
      task.active_child = null;
      task.last_action = 'recovery_completed';
      move(task, 'VERIFYING', 'recovery ' + child.task_id + ' COMPLETED — re-verifying this task with its evidence');
      return Promise.resolve(task);
    }
    if (child.status === 'BLOCKED') {
      return block(task, 'RECOVERY_BLOCKED', 'recovery task ' + child.task_id + ' is BLOCKED: ' + (child.blocked ? child.blocked.code + ' — ' + child.blocked.why : ''),
        child.blocked && child.blocked.human_action);
    }
    return Promise.resolve(task);
  }

  // ------------------------------------------------------------------ tick
  function step(task) {
    switch (task.status) {
      case 'PLANNED': return stepPlanned(task);
      case 'READY': case 'WAITING': case 'RUNNING': return stepActive(task);
      case 'VERIFYING': return stepVerifying(task);
      case 'FAILED': return stepFailed(task);
      case 'RECOVERY': return stepRecovery(task);
      default: return Promise.resolve(task);
    }
  }

  function depth(t) { return (t.task_id.match(/-R\d+/g) || []).length; }

  function tick() {
    var release = store.acquireLock();
    if (!release) return Promise.resolve({ ran: false, reason: 'another tick holds the lock' });
    var summary = { ran: true, processed: [], errors: [] };
    // Deepest first: a recovery settles before its parent looks at it.
    var active = store.listTasks().filter(function (t) { return states.ACTIVE.indexOf(t.status) !== -1; })
      .sort(function (a, b) { return depth(b) - depth(a); });
    return active.reduce(function (p, t) {
      return p.then(function () {
        var fresh = store.loadTask(t.task_id); // a sibling step may have changed it
        if (!fresh || states.ACTIVE.indexOf(fresh.status) === -1) return;
        var before = fresh.status;
        return step(fresh).then(function (after) {
          summary.processed.push({ task_id: fresh.task_id, from: before, to: (after && after.status) || before });
        }, function (e) {
          summary.errors.push({ task_id: fresh.task_id, error: String(e && e.message).slice(0, 200) });
          log(fresh, 'step_error', { error: String(e && e.message).slice(0, 300) });
        });
      });
    }, Promise.resolve()).then(function () {
      return sweepConsults().then(null, function (e) { summary.errors.push({ task_id: null, error: 'consult sweep: ' + String(e && e.message).slice(0, 200) }); });
    }).then(function () { release(); return summary; }, function (e) { release(); throw e; });
  }

  function resume(taskId, reason) {
    var t = store.loadTask(taskId);
    if (!t) throw new Error('NO_SUCH_TASK');
    t.blocked = null;
    t.review_failures = 0;
    t.diagnosis_failures = 0;
    t.planning_failures = 0;
    states.transition(t, 'PLANNED', 'human resume: ' + reason, 'human');
    store.saveTask(t);
    log(t, 'human_resume', { reason: String(reason || '').slice(0, 300) });
    return t;
  }

  return { submitObjective: submitObjective, tick: tick, resume: resume, step: step, _internal: { failureSignature: failureSignature, settle: settle } };
}

module.exports = { create: create, clampSpec: clampSpec, specProblems: specProblems };
