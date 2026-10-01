'use strict';
// =====================================================
// MYTHOS OS v4 — DOTS, the General Manager
// projects/mythos-os-v4/lib/dots.js
//
// DOTS is the top of the chain and it is deterministic code, not a model:
//
//     DOTS  (goals · priorities · policy · escalations)
//       └─ executive: FABLE 5.1 — OpenAI watches it and takes over on failure
//            └─ JEV: which model (free → Qwen → paid)
//                 └─ HADDAD: the step actually runs
//
// What DOTS owns, and nobody below it can change:
//   GOALS        submitGoal() is the only way work enters. An executive
//                cannot create, widen or re-prioritise a goal.
//   PRIORITIES   nextGoal(): critical → high → normal → low, oldest first.
//   POLICY       authorize(): every directive is checked against
//                config/dots-policy.json before one step runs. A directive
//                that is malformed, exceeds a limit, names a forbidden
//                operation, carries a secret, or writes without the owner's
//                approval is REFUSED — never trimmed into something
//                acceptable.
//   ESCALATIONS  whatever the chain may not decide stops as an OPEN
//                escalation for the owner, with a machine-readable code.
//
// NO INFINITE LOOPS. One run of a goal is bounded five ways: plan cycles
// (loop.max_cycles), executed steps (loop.max_total_steps), refused
// directives (loop.max_refusals), an identical plan seen twice
// (REPEATED_PLAN), and a wall-clock deadline (loop.goal_deadline_seconds).
// Re-runs are bounded too (goal.max_runs_per_goal). Every exit is a
// recorded state, never a spin.
//
// A goal is COMPLETED only on evidence: the executive may say "complete"
// only after at least one step actually succeeded in this run's history.
// =====================================================

var crypto = require('crypto');
var fs = require('fs');

var store = require('./store');
var schema = require('../../mythos-orchestrator/lib/schema');
var redact = require('../../mythos-orchestrator/lib/redact');
var DIRECTIVE_SCHEMA = require('./executive').DIRECTIVE_SCHEMA;

var OPEN_STATUSES = ['QUEUED', 'RUNNING', 'WAITING'];
var RUNNABLE = ['QUEUED', 'WAITING'];
var STEP_ID_RE = /^[a-z][a-z0-9_-]{0,15}$/;

function cut(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function create(deps) {
  var policy = deps.policy;
  var ledger = deps.ledger;
  var executive = deps.executive;
  var haddad = deps.haddad;
  var watchdog = deps.watchdog;
  var now = deps.now || Date.now;

  function goalFile(id) { return store.file('goals', id + '.json'); }
  function escFile(id) { return store.file('escalations', id + '.json'); }
  function lockFile() { return store.file('goals', '.lock'); }
  function iso() { return new Date(now()).toISOString(); }

  function loadGoal(id) { return store.isValidId(id) ? store.readJSON(goalFile(id), null) : null; }
  function saveGoal(goal) { goal.updated_at = iso(); store.writeJSON(goalFile(goal.goal_id), goal); return goal; }

  function listGoals() {
    var dir = store.file('goals');
    var names;
    try { names = fs.readdirSync(dir); } catch (e) { return []; }
    return names.filter(function (n) { return /\.json$/.test(n) && store.isValidId(n.slice(0, -5)); })
      .map(function (n) { return store.readJSON(dir + '/' + n, null); }).filter(Boolean)
      .sort(function (a, b) { return a.created_at < b.created_at ? -1 : (a.created_at > b.created_at ? 1 : 0); });
  }

  function listEscalations(filter) {
    var dir = store.file('escalations');
    var names;
    try { names = fs.readdirSync(dir); } catch (e) { return []; }
    return names.filter(function (n) { return /\.json$/.test(n); }).map(function (n) { return store.readJSON(dir + '/' + n, null); })
      .filter(function (e) { return e && (!filter || !filter.status || e.status === filter.status); })
      .sort(function (a, b) { return a.at < b.at ? -1 : 1; });
  }

  function goalView(goal) {
    return { title: goal.title, objective: goal.objective, priority: goal.priority, write_approved: goal.write_approved === true };
  }

  // ---- GOALS --------------------------------------------------------------
  // submitGoal({ title, objective, priority?, requested_by?, allow_write? })
  function submitGoal(input) {
    input = input || {};
    var g = policy.goal;
    var problems = [];
    var title = typeof input.title === 'string' ? input.title.trim() : '';
    var objective = typeof input.objective === 'string' ? input.objective.trim() : '';
    var priority = input.priority === undefined ? 'normal' : input.priority;
    if (!title) problems.push('title is required');
    if (title.length > g.max_title_chars) problems.push('title exceeds ' + g.max_title_chars + ' characters');
    if (!objective) problems.push('objective is required');
    if (objective.length > g.max_objective_chars) problems.push('objective exceeds ' + g.max_objective_chars + ' characters');
    if (g.priorities.indexOf(priority) === -1) problems.push('priority must be one of ' + g.priorities.join(', '));
    if (input.allow_write !== undefined && typeof input.allow_write !== 'boolean') problems.push('allow_write must be a boolean');
    var kinds = redact.findSecretKinds(title + '\n' + objective);
    if (kinds.length) problems.push('GOAL_CARRIES_SECRET: ' + kinds.join(', ') + ' — credentials never travel in a goal');
    if (problems.length) throw new Error('GOAL_REFUSED: ' + problems.join('; '));

    return store.withLock(lockFile(), function () {
      var open = listGoals().filter(function (x) { return OPEN_STATUSES.indexOf(x.status) !== -1; });
      if (open.length >= g.max_open_goals) throw new Error('GOAL_REFUSED: ' + open.length + ' goals are already open (limit ' + g.max_open_goals + ')');
      var id = store.newId('goal', now());
      var goal = {
        goal_id: id, trace_id: store.newId('trace', now()), title: title, objective: objective, priority: priority,
        requested_by: cut(input.requested_by || 'owner', 64), write_approved: input.allow_write === true,
        status: 'QUEUED', created_at: iso(), updated_at: iso(), runs: 0, cycles: 0, steps_executed: 0,
        runner_pid: null, deadline_at: null, history: [], refusals: [], result: null, escalation_id: null, last_engine: null
      };
      saveGoal(goal);
      ledger.append({ actor: 'dots', type: 'GOAL_SUBMITTED', goal_id: id, trace_id: goal.trace_id, detail: { title: title, priority: priority, requested_by: goal.requested_by, write_approved: goal.write_approved, objective_chars: objective.length } });
      return goal;
    });
  }

  // ---- PRIORITIES ---------------------------------------------------------
  function nextGoal() {
    var rank = policy.goal.priorities;
    var runnable = listGoals().filter(function (g) { return RUNNABLE.indexOf(g.status) !== -1 && g.runs < policy.goal.max_runs_per_goal; });
    runnable.sort(function (a, b) {
      var p = rank.indexOf(a.priority) - rank.indexOf(b.priority);
      if (p !== 0) return p;
      return a.created_at < b.created_at ? -1 : (a.created_at > b.created_at ? 1 : 0);
    });
    return runnable[0] || null;
  }

  // ---- POLICY -------------------------------------------------------------
  // authorize(goal, directive, state) -> { ok, problems:[{code,detail}], approval_required, directive }
  // `directive` in the answer is the authorised copy: identical except that
  // step timeouts are clamped into the policy's range (recorded as adjusted).
  function authorize(goal, directive, state) {
    var p = policy.plan;
    var problems = [];
    function refuse(code, detail) { problems.push({ code: code, detail: cut(detail, 300) }); }

    var check = schema.validate(directive, DIRECTIVE_SCHEMA);
    if (!check.valid) {
      check.errors.slice(0, 5).forEach(function (e) { refuse('MALFORMED', e); });
      return { ok: false, problems: problems, approval_required: false, directive: null };
    }
    var out = JSON.parse(JSON.stringify(directive));
    out.rationale = cut(out.rationale, 2000);
    var adjusted = [];

    if (out.decision === 'execute') {
      if (!out.steps.length) refuse('MALFORMED', 'decision execute carries no step');
      if (out.steps.length > p.max_steps) refuse('STEP_LIMIT', out.steps.length + ' steps exceed plan.max_steps ' + p.max_steps);
      if (state.steps_executed + out.steps.length > policy.loop.max_total_steps) {
        refuse('STEP_BUDGET', 'the goal would run ' + (state.steps_executed + out.steps.length) + ' steps, over loop.max_total_steps ' + policy.loop.max_total_steps);
      }
      if (out.final_answer !== null) refuse('MALFORMED', 'decision execute must not carry a final_answer');
      var seen = {};
      out.steps.forEach(function (s, i) {
        var where = 'steps[' + i + ']';
        if (!STEP_ID_RE.test(s.id)) refuse('MALFORMED', where + ': invalid id');
        if (seen[s.id]) refuse('MALFORMED', where + ': duplicate id ' + s.id);
        seen[s.id] = true;
        var allowed = s.kind === 'answer' ? p.answer_actions : p.work_actions;
        if (allowed.indexOf(s.action) === -1) refuse('ACTION_NOT_ALLOWED', where + ': action "' + s.action + '" is not a ' + s.kind + ' action');
        if (!s.instruction.trim()) refuse('MALFORMED', where + ': empty instruction');
        if (s.instruction.length > p.max_instruction_chars) refuse('INSTRUCTION_TOO_LONG', where + ': ' + s.instruction.length + ' characters exceed ' + p.max_instruction_chars);
        if (s.acceptance.length > p.max_acceptance_items) refuse('MALFORMED', where + ': too many acceptance items');
        if (s.acceptance.some(function (a) { return a.length > 500; })) refuse('MALFORMED', where + ': an acceptance item exceeds 500 characters');
        var text = (s.instruction + '\n' + s.acceptance.join('\n'));
        var kinds = redact.findSecretKinds(text);
        if (kinds.length) refuse('SECRET_IN_DIRECTIVE', where + ': carries ' + kinds.join(', '));
        var lower = text.toLowerCase();
        p.forbidden_terms.forEach(function (term) {
          if (lower.indexOf(term) !== -1) refuse('POLICY_FORBIDDEN', where + ': names an owner-only operation ("' + term + '")');
        });
        if (s.kind === 'work' && p.write_actions.indexOf(s.action) !== -1 && goal.write_approved !== true) {
          refuse('OWNER_APPROVAL_REQUIRED', where + ': action "' + s.action + '" changes files and the goal has no write approval');
        }
        // A work step is queued, picked up by the executor daemon and run in
        // several model turns: it gets a higher floor than an answer (live,
        // 2026-10-01: a 120 s investigate step outlived its own deadline).
        var floor = s.kind === 'work' ? Math.max(p.min_step_timeout_seconds, p.min_work_timeout_seconds) : p.min_step_timeout_seconds;
        var clamped = Math.min(p.max_step_timeout_seconds, Math.max(floor, s.timeout_seconds));
        if (clamped !== s.timeout_seconds) { adjusted.push({ step: s.id, timeout_seconds: { from: s.timeout_seconds, to: clamped } }); s.timeout_seconds = clamped; }
      });
    } else {
      if (out.steps.length) refuse('MALFORMED', 'decision ' + out.decision + ' must not carry steps');
      if (out.decision === 'complete') {
        if (typeof out.final_answer !== 'string' || !out.final_answer.trim()) refuse('MALFORMED', 'decision complete needs a final_answer');
        else {
          if (out.final_answer.length > policy.gateway.max_output_chars) refuse('MALFORMED', 'final_answer too long');
          var fk = redact.findSecretKinds(out.final_answer);
          if (fk.length) refuse('SECRET_IN_DIRECTIVE', 'final_answer carries ' + fk.join(', '));
        }
        // Completion is a claim; the evidence is a step that really succeeded.
        if (!state.history.some(function (h) { return h.ok; })) {
          refuse('COMPLETE_WITHOUT_EVIDENCE', 'no step has succeeded for this goal — "complete" needs a result to stand on');
        }
      } else if (typeof out.escalation_reason !== 'string' || !out.escalation_reason.trim()) {
        refuse('MALFORMED', 'decision escalate needs an escalation_reason');
      }
    }

    var approval = problems.length > 0 && problems.every(function (x) { return x.code === 'OWNER_APPROVAL_REQUIRED'; });
    return { ok: problems.length === 0, problems: problems, approval_required: approval, directive: problems.length ? null : out, adjusted: adjusted };
  }

  function planHash(directive) {
    var basis = directive.steps.map(function (s) { return [s.kind, s.action, s.instruction]; });
    return crypto.createHash('sha256').update(JSON.stringify(basis)).digest('hex');
  }

  // ---- ESCALATIONS --------------------------------------------------------
  function escalate(goal, code, reason, extra) {
    var esc = {
      escalation_id: store.newId('esc', now()), goal_id: goal.goal_id, trace_id: goal.trace_id, code: code,
      reason: cut(reason, 1500), at: iso(), status: 'OPEN', resolution: null, detail: extra || null
    };
    store.writeJSON(escFile(esc.escalation_id), esc);
    goal.status = 'ESCALATED';
    goal.escalation_id = esc.escalation_id;
    goal.runner_pid = null;
    saveGoal(goal);
    ledger.append({ actor: 'dots', type: 'ESCALATED', goal_id: goal.goal_id, trace_id: goal.trace_id, detail: { escalation_id: esc.escalation_id, code: code, reason: esc.reason } });
    return goal;
  }

  // The owner's answer to an escalation. action: approve_write | retry | cancel
  function resolveEscalation(escalationId, action, by) {
    var esc = store.isValidId(escalationId) ? store.readJSON(escFile(escalationId), null) : null;
    if (!esc) throw new Error('NO_SUCH_ESCALATION');
    if (esc.status !== 'OPEN') throw new Error('ESCALATION_NOT_OPEN: ' + esc.status);
    if (['approve_write', 'retry', 'cancel'].indexOf(action) === -1) throw new Error('INVALID_RESOLUTION: ' + cut(action, 40));
    return store.withLock(lockFile(), function () {
      var goal = loadGoal(esc.goal_id);
      if (!goal) throw new Error('NO_SUCH_GOAL');
      if (action !== 'cancel' && goal.runs >= policy.goal.max_runs_per_goal) {
        throw new Error('RUN_LIMIT: the goal has run ' + goal.runs + ' times (limit ' + policy.goal.max_runs_per_goal + ') — cancel it and submit a new goal');
      }
      if (action === 'approve_write') goal.write_approved = true;
      goal.status = action === 'cancel' ? 'CANCELLED' : 'QUEUED';
      goal.escalation_id = null;
      saveGoal(goal);
      esc.status = 'RESOLVED';
      esc.resolution = { action: action, by: cut(by || 'owner', 64), at: iso() };
      store.writeJSON(escFile(esc.escalation_id), esc);
      ledger.append({ actor: 'owner', type: 'ESCALATION_RESOLVED', goal_id: goal.goal_id, trace_id: goal.trace_id, detail: { escalation_id: esc.escalation_id, action: action, by: esc.resolution.by } });
      return { escalation: esc, goal: goal };
    });
  }

  function cancelGoal(goalId, by) {
    return store.withLock(lockFile(), function () {
      var goal = loadGoal(goalId);
      if (!goal) throw new Error('NO_SUCH_GOAL');
      if (OPEN_STATUSES.indexOf(goal.status) === -1 && goal.status !== 'ESCALATED') throw new Error('GOAL_NOT_OPEN: ' + goal.status);
      goal.status = 'CANCELLED';
      goal.runner_pid = null;
      saveGoal(goal);
      ledger.append({ actor: 'owner', type: 'GOAL_CANCELLED', goal_id: goal.goal_id, trace_id: goal.trace_id, detail: { by: cut(by || 'owner', 64) } });
      return goal;
    });
  }

  // ---- THE RUN ------------------------------------------------------------
  function claim(goalId) {
    return store.withLock(lockFile(), function () {
      var goal = loadGoal(goalId);
      if (!goal) throw new Error('NO_SUCH_GOAL');
      if (RUNNABLE.indexOf(goal.status) === -1) throw new Error('GOAL_NOT_RUNNABLE: ' + goal.status);
      if (goal.runs >= policy.goal.max_runs_per_goal) throw new Error('RUN_LIMIT: the goal has already run ' + goal.runs + ' times');
      goal.status = 'RUNNING';
      goal.runs += 1;
      goal.runner_pid = process.pid;
      goal.started_at = iso();
      goal.deadline_at = new Date(now() + policy.loop.goal_deadline_seconds * 1000).toISOString();
      // A re-run plans from a clean slate: it keeps the record of what
      // happened (ledger) but not last run's cycle budget.
      goal.cycles = 0;
      goal.steps_executed = 0;
      goal.history = [];
      goal.refusals = [];
      saveGoal(goal);
      ledger.append({ actor: 'dots', type: 'GOAL_STARTED', goal_id: goal.goal_id, trace_id: goal.trace_id, detail: { run: goal.runs, deadline_at: goal.deadline_at, priority: goal.priority } });
      return goal;
    });
  }

  // runGoal(goalId) -> Promise<goal> in a terminal or waiting state.
  function runGoal(goalId) {
    var goal;
    try { goal = claim(goalId); } catch (e) { return Promise.reject(e); }
    var ctx = { goal_id: goal.goal_id, trace_id: goal.trace_id, deadline_at: Date.parse(goal.deadline_at) };
    var seenPlans = {};

    function state() { return { cycle: goal.cycles, steps_executed: goal.steps_executed, history: goal.history, refusals: goal.refusals }; }

    function cycle() {
      // A cancel from another process wins over the loop.
      var fresh = loadGoal(goal.goal_id);
      if (fresh && fresh.status === 'CANCELLED') { goal = fresh; return goal; }
      if (now() >= ctx.deadline_at) return escalate(goal, 'GOAL_DEADLINE', 'The goal did not finish within ' + policy.loop.goal_deadline_seconds + ' s.');
      if (goal.cycles >= policy.loop.max_cycles) return escalate(goal, 'CYCLE_LIMIT', 'The executive used all ' + policy.loop.max_cycles + ' plan cycles without completing the goal.');
      goal.cycles += 1;
      saveGoal(goal);

      return executive.plan(goalView(goal), state(), ctx).then(function (planned) {
        if (!planned.ok) {
          if (planned.reason === 'DEADLINE') return escalate(goal, 'GOAL_DEADLINE', 'The deadline passed while waiting for an executive.');
          if (policy.executive.on_no_executive === 'escalate') {
            return escalate(goal, 'NO_EXECUTIVE', 'Neither FABLE nor OpenAI could plan this goal.', { attempts: planned.attempts });
          }
          goal.status = 'WAITING';
          goal.runner_pid = null;
          saveGoal(goal);
          ledger.append({ actor: 'dots', type: 'GOAL_HELD', goal_id: goal.goal_id, trace_id: goal.trace_id, detail: { reason: 'NO_EXECUTIVE', attempts: planned.attempts } });
          return goal;
        }
        goal.last_engine = planned.engine;

        var auth = authorize(goal, planned.directive, state());
        ledger.append({
          actor: 'dots', type: auth.ok ? 'DIRECTIVE_AUTHORIZED' : 'DIRECTIVE_REFUSED', goal_id: goal.goal_id, trace_id: goal.trace_id,
          detail: { cycle: goal.cycles, engine: planned.engine, failover: planned.failover, decision: planned.directive && planned.directive.decision, steps: auth.ok ? auth.directive.steps.map(function (s) { return { id: s.id, kind: s.kind, action: s.action, timeout_seconds: s.timeout_seconds }; }) : null, problems: auth.problems, adjusted: auth.adjusted || [] }
        });
        if (!auth.ok) {
          if (auth.approval_required) {
            return escalate(goal, 'HUMAN_APPROVAL', 'The plan needs to change files and the goal has no write approval. Approve with: escalation resolve <id> approve_write.', { problems: auth.problems, engine: planned.engine });
          }
          executive.reportRefusal(planned.engine, 'REFUSED_BY_DOTS', ctx);
          goal.refusals.push({ cycle: goal.cycles, engine: planned.engine, problems: auth.problems.slice(0, 6).map(function (x) { return x.code + ': ' + x.detail; }) });
          saveGoal(goal);
          if (goal.refusals.length > policy.loop.max_refusals) {
            return escalate(goal, 'DIRECTIVE_REFUSED_LIMIT', 'DOTS refused ' + goal.refusals.length + ' directives for this goal.', { last_problems: auth.problems });
          }
          return cycle();
        }
        var directive = auth.directive;

        if (directive.decision === 'complete') {
          goal.status = 'COMPLETED';
          goal.runner_pid = null;
          goal.result = {
            final_answer: directive.final_answer, completed_by: planned.engine, degraded: planned.engine === 'direct',
            failover: planned.failover, completed_at: iso(),
            evidence: goal.history.filter(function (h) { return h.ok; }).map(function (h) { return { cycle: h.cycle, step_id: h.step_id, model: h.model, tier: h.tier, transport: h.transport || null }; })
          };
          saveGoal(goal);
          ledger.append({ actor: 'dots', type: 'GOAL_COMPLETED', goal_id: goal.goal_id, trace_id: goal.trace_id, detail: { completed_by: planned.engine, degraded: goal.result.degraded, cycles: goal.cycles, steps_executed: goal.steps_executed, evidence: goal.result.evidence, answer_chars: directive.final_answer.length } });
          return goal;
        }
        if (directive.decision === 'escalate') {
          return escalate(goal, 'EXECUTIVE_ESCALATION', directive.escalation_reason, { engine: planned.engine });
        }

        // decision: execute
        var hash = planHash(directive);
        if (seenPlans[hash]) {
          return escalate(goal, 'REPEATED_PLAN', 'The executive produced the same plan twice; running it again would loop.', { engine: planned.engine });
        }
        seenPlans[hash] = true;

        var hasWrite = directive.steps.some(function (s) { return s.kind === 'work' && policy.plan.write_actions.indexOf(s.action) !== -1; });
        var reviewed = hasWrite && policy.watchdog.review_write_plans
          ? watchdog.review(goalView(goal), directive, ctx, planned.engine)
          : Promise.resolve(null);

        return reviewed.then(function (verdict) {
          if (verdict) {
            if (!verdict.ok && policy.watchdog.on_review_unavailable === 'escalate') {
              return escalate(goal, 'WRITE_PLAN_UNREVIEWED', 'A plan that changes files could not be reviewed by the other executive engine (' + verdict.code + ').', { engine: planned.engine });
            }
            if (verdict.ok && verdict.verdict === 'reject') {
              goal.refusals.push({ cycle: goal.cycles, engine: planned.engine, problems: verdict.reasons.map(function (r) { return 'WATCHDOG_REJECTED: ' + r; }) });
              saveGoal(goal);
              if (goal.refusals.length > policy.loop.max_refusals) {
                return escalate(goal, 'DIRECTIVE_REFUSED_LIMIT', 'The watchdog and DOTS refused ' + goal.refusals.length + ' directives for this goal.', { reasons: verdict.reasons });
              }
              return cycle();
            }
          }
          return runSteps(directive.steps.slice()).then(function (stopped) { return stopped || cycle(); });
        });
      });
    }

    // Steps run in order. A failed step does not abort the plan's record:
    // the executive sees every result on the next cycle and decides.
    function runSteps(steps) {
      if (!steps.length) return Promise.resolve(null);
      if (now() >= ctx.deadline_at) return Promise.resolve(escalate(goal, 'GOAL_DEADLINE', 'The deadline passed between steps.'));
      var step = steps.shift();
      return haddad.execute(step, ctx).then(function (r) {
        goal.steps_executed += 1;
        goal.history.push({
          cycle: goal.cycles, step_id: step.id, kind: step.kind, action: step.action, ok: r.ok === true,
          reason: r.ok ? null : (r.reason || 'FAILED'), detail: r.ok ? null : cut(r.detail || '', 300) || null,
          model: r.model || null, tier: r.tier || null, transport: r.transport || null, fallback_used: !!r.fallback_used,
          output: r.output ? cut(r.output, policy.loop.history_output_chars) : null
        });
        saveGoal(goal);
        return runSteps(steps);
      });
    }

    return Promise.resolve().then(cycle).catch(function (e) {
      // A bug must not leave a goal RUNNING forever.
      return escalate(loadGoal(goal.goal_id) || goal, 'INTERNAL_ERROR', String(e && e.message));
    });
  }

  function runNext() {
    var goal = nextGoal();
    return goal ? runGoal(goal.goal_id) : Promise.resolve(null);
  }

  // tick(): the deterministic half of the watchdog — a RUNNING goal whose
  // runner died, or that overran its deadline, becomes an escalation.
  function tick() {
    var stalled = watchdog.stalledGoals(listGoals());
    return stalled.map(function (g) {
      var goal = loadGoal(g.goal_id);
      if (!goal || goal.status !== 'RUNNING') return null;
      return escalate(goal, 'STALLED', 'The goal was RUNNING but its runner (pid ' + goal.runner_pid + ') is gone or its deadline passed.').goal_id;
    }).filter(Boolean);
  }

  return {
    submitGoal: submitGoal, nextGoal: nextGoal, listGoals: listGoals, getGoal: loadGoal,
    authorize: authorize, runGoal: runGoal, runNext: runNext, cancelGoal: cancelGoal,
    listEscalations: listEscalations, resolveEscalation: resolveEscalation, tick: tick, goalView: goalView
  };
}

module.exports = { create: create };
