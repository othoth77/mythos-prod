'use strict';
// =====================================================
// MYTHOS supervisor — the OpenAI brain (plan · review · diagnose)
// projects/mythos-orchestrator/supervisor/brain.js
//
// All reasoning goes through advisor.advise(), so every call inherits the
// advisor's guarantees: the authoritative on/off switch (config/openai.json),
// the secret gate (a credential-shaped string is REFUSED, never sent), the
// strict per-role JSON schema, the hard transport deadline, the per-call
// record under <orchestrator home>/advice/, and store:false.
//
// This module adds: evidence curation (bounded, hash-masked, never the raw
// report), the supervisor's call budget, and one result shape:
//   { ok:true, decision, advice_id }  |  { ok:false, code, detail, transient }
// OpenAI output is data. The supervisor re-checks every decision
// deterministically before it acts on it.
// =====================================================

var advisor = require('../advisor');
var store = require('./store');

function cut(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function cutList(a, n, each) { return (Array.isArray(a) ? a : []).slice(0, n).map(function (x) { return typeof x === 'string' ? cut(x, each) : x; }); }

// Hashes are not evidence a reviewer needs and bare 32+ hex runs trip the
// advisor's secret gate; mask them (a 40-hex git SHA is kept: the gate
// allows it and a reviewer may need it).
function maskHashes(text) {
  return String(text).replace(/(?<![0-9A-Fa-f])[0-9A-Fa-f]{32,}(?![0-9A-Fa-f])/g, function (h) { return h.length === 40 ? h : '[hash]'; });
}

function curateReport(report) {
  if (!report) return null;
  var v = report.validation || {};
  return {
    task_id: report.task_id,
    status: report.status,
    summary: cut(report.summary, 3000),
    files_changed: cutList(report.files_changed, 40, 200),
    commits: (report.commits || []).slice(0, 10).map(function (c) {
      return { sha: c.sha, subject: cut(c.subject, 200), on_origin: !!c.on_origin };
    }),
    tests: cutList(report.tests, 30, 300),
    validation: { git_verified: v.git_verified === true, report_problems: cutList(v.report_problems, 15, 300), required_checks: cutList(v.required_checks, 15, 300) },
    problems: cutList(report.problems, 20, 400),
    risks: cutList(report.risks, 15, 300),
    blocker: report.blocker ? { code: report.blocker.code || null, reason: cut(report.blocker.reason || report.blocker.message || '', 600) } : null,
    next_recommended_action: cut(report.next_recommended_action, 600),
    execution_profile: report.execution && report.execution.execution_profile || null
  };
}

function specView(spec) {
  return {
    title: spec.title, objective: spec.objective, scope: spec.scope, constraints: spec.constraints,
    validation: spec.validation, acceptance_criteria: spec.acceptance_criteria, action: spec.action,
    timeout_seconds: spec.timeout_seconds
  };
}

// Per-task cost ledger: every model call and every local decision, with why.
function ensureCosts(task) {
  task.costs = task.costs || { openai: { total: 0, plan: 0, review: 0, diagnose: 0 }, qwen: 0, local: 0, escalations: [] };
  return task.costs;
}

function create(cfg, opts) {
  opts = opts || {};
  var advise = opts.advise || advisor.advise;

  function call(task, role, question, context, reason) {
    var root = task.root_task_id || task.task_id;
    var b = store.budgetState(root);
    var costs = ensureCosts(task);
    var perTask = task.parent_task_id ? cfg.max_openai_calls_per_recovery : cfg.max_openai_calls_per_task;
    if (b.day >= cfg.max_openai_calls_per_day) return Promise.resolve({ ok: false, code: 'OPENAI_BUDGET_DAY', detail: b.day + ' calls today', transient: false });
    if (b.root >= cfg.max_openai_calls_per_root) return Promise.resolve({ ok: false, code: 'OPENAI_BUDGET_ROOT', detail: b.root + ' calls for ' + root, transient: false });
    if (costs.openai.total >= perTask) {
      return Promise.resolve({ ok: false, code: task.parent_task_id ? 'OPENAI_BUDGET_RECOVERY' : 'OPENAI_BUDGET_TASK', detail: costs.openai.total + ' calls for ' + task.task_id + ' (limit ' + perTask + ')', transient: false });
    }
    var purpose = role.replace('supervise_', '');
    costs.openai.total += 1;
    costs.openai[purpose] = (costs.openai[purpose] || 0) + 1;
    costs.escalations.push({ at: new Date().toISOString(), tier: 'OPENAI', purpose: purpose, reason: String(reason || purpose).slice(0, 300) });
    task.openai_calls = (task.openai_calls || 0) + 1;
    // A random suffix keeps the id unique even if a crash lost the counter.
    var adviceId = ('sup-' + task.task_id.toLowerCase() + '-' + role.replace('supervise_', '') + '-' + task.openai_calls + '-' +
      require('crypto').randomBytes(3).toString('hex')).slice(0, 64);
    store.countCall(root);
    return Promise.resolve(advise({
      advice_id: adviceId,
      role: role,
      question: question,
      context: maskHashes(JSON.stringify(context, null, 2))
    }, opts.adviseOpts || {})).then(function (out) {
      out = out || {};
      if (out.status === 'completed') return { ok: true, decision: out.advice, advice_id: adviceId, usage: out.usage || null };
      var code = (out.blockers && out.blockers[0]) ? String(out.blockers[0]).split(':')[0] : ('ADVISOR_' + String(out.status || 'UNKNOWN').toUpperCase());
      var transient = /^(TIMEOUT|NETWORK_ERROR|HTTP_5|HTTP_429|INCOMPLETE|EMPTY_OUTPUT|MALFORMED)/.test(code);
      return { ok: false, code: code, detail: cut((out.blockers || []).join('; '), 500), transient: transient, advice_id: adviceId };
    }, function (e) {
      return { ok: false, code: 'ADVISOR_INTERNAL', detail: cut(e && e.message, 300), transient: true };
    });
  }

  function plan(task, reason) {
    return call(task, 'supervise_plan',
      'Plan ONE executable task for this owner objective. The executor is FABLE (Claude, model ' + cfg.executor_model + ') working in a sandboxed worktree of ' +
      cfg.repository + ' through the MYTHOS bridge. Choose the least-privileged action: investigate/review (read-only report), test (run tests, read-only), ' +
      'document (docs commit), implement (code commit to a task branch; never merged automatically). Acceptance criteria must be checkable from the executor\'s report.',
      { objective: task.objective, owner_acceptance: task.owner_acceptance || [], allowed_actions: cfg.allowed_actions,
        timeout_bounds_seconds: [cfg.min_timeout_seconds, cfg.max_timeout_seconds],
        never_automatic: ['deployment', 'credentials or secrets', 'DNS', 'destructive database work', 'privileged host operations', 'merging to main'],
        prefer_machine_checks: 'Where possible write acceptance criteria as machine checks the supervisor verifies without a model: check:status_completed, check:tests_pass, check:no_problems, check:mentions:<text>, check:files_changed:<path>, check:commit_delivered.' }, reason || 'unstructured objective needs planning');
  }

  function review(task, report, evidence, reason) {
    return call(task, 'supervise_review',
      'Verify this execution report against EVERY acceptance criterion. Use only the evidence given. A successful exit or a COMPLETED status is not proof by itself.',
      { task: specView(task.spec), report: curateReport(report), additional_evidence: evidence || null }, reason || 'free-text acceptance criteria need judgement');
  }

  function diagnose(task, failure, history, reason) {
    return call(task, 'supervise_diagnose',
      'Diagnose this failed execution and propose ONE recovery task that changes something concrete. It must differ from every previous attempt listed. ' +
      'If only a person can fix it (credential, owner decision, governance, privileged host step), set recoverable=false and name the human action.',
      { task: specView(task.spec), failure: failure, previous_attempts: history || [] }, reason || 'escalated diagnosis');
  }

  return { plan: plan, review: review, diagnose: diagnose, curateReport: curateReport, ensureCosts: ensureCosts };
}

module.exports = { create: create, curateReport: curateReport, maskHashes: maskHashes, ensureCosts: ensureCosts };
