'use strict';
// =====================================================
// MYTHOS supervisor — deterministic escalation router
// projects/mythos-orchestrator/supervisor/escalation.js
//
// Decides WHO handles a failure: LOCAL rules → QWEN (local model on Haddad)
// → OPENAI → HUMAN. It is a lookup over local evidence (failure kind,
// executor monitor state, report text, host resources) — it never calls a
// model to decide which model to call, so the same evidence always routes
// the same way and the decision is auditable by reading this file.
//
//   classify(task, cfg)          → { cls, why }
//   route(cls, tried, cfg)       → { tier, reason }   tier ∈ LOCAL|QWEN|OPENAI|HUMAN
//   localRecovery(cls, task, cfg)→ recovery spec (deterministic, no model)
//   actionRank(action)           privilege order used to refuse escalation
//
// Escalation is monotone and bounded per failure signature: a tier already
// tried for the same unchanged failure is skipped, and when LOCAL, QWEN and
// OPENAI have all been tried the answer is HUMAN — never another model call.
// =====================================================

var TIERS = ['LOCAL', 'QWEN', 'OPENAI'];

// First tier for each failure class. HUMAN classes never reach a model:
// they need an operator (service, host resources, delivery/governance).
var RULES = {
  SERVICE_DOWN: 'HUMAN',       // executor daemon inactive — a host/service action
  RESOURCE: 'HUMAN',           // host memory/disk exhaustion — an operator action
  STATE_LOST: 'HUMAN',         // Issue or executor record vanished
  WRITE_UNDELIVERED: 'HUMAN',  // commit never reached GitHub — relay/governance
  TIMEOUT: 'LOCAL',            // known Fable pattern: more time, smaller steps
  CRASH: 'LOCAL',              // process gone with healthy resources
  BRIDGE: 'LOCAL',             // lost/unreadable report, never claimed
  TEST_FAILURE: 'QWEN',        // obvious test failure
  DEPENDENCY: 'QWEN',          // simple dependency/module/path problem
  SPEC_REJECTED: 'OPENAI',     // the task itself was malformed: re-planning
  REVIEW_REJECTED: 'OPENAI',   // semantic disagreement with the criteria
  WRITE_UNVERIFIED: 'OPENAI',  // commit on the wrong branch / not contained
  STALLED: 'OPENAI',           // no report and no clear local cause
  UNKNOWN: 'OPENAI'            // ambiguous
};

var ACTION_RANK = { investigate: 1, review: 1, test: 2, document: 3, implement: 4 };
function actionRank(a) { return ACTION_RANK[a] || 99; }

function text(task) {
  var r = task.last_result || {};
  var f = task.last_failure || {};
  return [f.detail, r.summary].concat(r.problems || [], r.tests || [], (r.validation && r.validation.report_problems) || [])
    .map(function (x) { return String(x == null ? '' : x); }).join('\n');
}

function classify(task, cfg) {
  var f = task.last_failure || {};
  var kind = f.kind || '';
  var mon = f.monitor_state || null;
  var res = f.resources || null;
  var t = text(task);
  var floor = cfg.resource_floor_mib || 300;
  if (kind === 'FABLE_UNREACHABLE') return { cls: 'SERVICE_DOWN', why: 'executor daemon not active' };
  if (kind === 'TASK_STATE_LOST') return { cls: 'STATE_LOST', why: 'task state lost' };
  if (kind === 'WRITE_NOT_DELIVERED') return { cls: 'WRITE_UNDELIVERED', why: 'commit never reached GitHub' };
  if (kind === 'WRITE_NOT_VERIFIED') return { cls: 'WRITE_UNVERIFIED', why: 'commit not verifiable on the task branch' };
  if (kind === 'SPEC_REJECTED_BY_BRIDGE') return { cls: 'SPEC_REJECTED', why: 'the bridge rejected the task' };
  if (kind === 'REVIEW_REJECTED') return { cls: 'REVIEW_REJECTED', why: 'verification rejected the result' };
  if ((res && typeof res.mem_available_mib === 'number' && res.mem_available_mib < floor) || /\b(ENOMEM|out of memory|OOM[- ]?kill|oom_kill|No space left on device)\b/i.test(t)) {
    return { cls: 'RESOURCE', why: 'host resources exhausted' };
  }
  if (kind === 'BRIDGE_FAILURE') return { cls: 'BRIDGE', why: 'bridge transport failure' };
  // Crash/timeout signals describe the EXECUTION. A verification failure
  // (unmet criteria on a report that did arrive) is judged on its text only.
  var executionFailure = kind !== 'VERIFICATION_FAILED' && kind !== 'VERIFY_PRECONDITION';
  if (executionFailure && (mon === 'FABLE_TIMED_OUT' || /\btimed out\b|\btimeout\b/i.test(t))) return { cls: 'TIMEOUT', why: 'execution timed out' };
  if (executionFailure && (mon === 'FABLE_CRASHED' || (f.crashes_seen || 0) > 0 || /process gone|interrupted \(|\bSIGKILL\b|killed by signal/i.test(t))) return { cls: 'CRASH', why: 'executor process died' };
  if (/Cannot find module|ModuleNotFoundError|No module named|command not found|ENOENT|No such file or directory|missing dependency/i.test(t)) return { cls: 'DEPENDENCY', why: 'missing module/file/command' };
  if (/\b[1-9]\d*\s+failed\b|\bFAIL\b|\bFAILED\b|AssertionError|test(s)? fail/i.test(t)) return { cls: 'TEST_FAILURE', why: 'failing tests' };
  if (kind === 'STALLED') return { cls: 'STALLED', why: 'no report and no local cause' };
  return { cls: 'UNKNOWN', why: 'no deterministic pattern matched' };
}

// tried: tiers already attempted for THIS failure signature (unchanged failure).
function route(cls, tried, cfg) {
  tried = tried || [];
  var start = RULES[cls] || 'OPENAI';
  if (start === 'HUMAN') return { tier: 'HUMAN', reason: cls + ' needs an operator' };
  var i = TIERS.indexOf(start);
  var skipped = [];
  for (; i < TIERS.length; i++) {
    var tier = TIERS[i];
    if (tried.indexOf(tier) !== -1) { skipped.push(tier + ' already tried for this unchanged failure'); continue; }
    if (tier === 'QWEN' && cfg.qwen_enabled === false) { skipped.push('QWEN disabled'); continue; }
    return { tier: tier, reason: cls + ' → ' + tier + (skipped.length ? ' (' + skipped.join('; ') + ')' : '') };
  }
  return { tier: 'HUMAN', reason: cls + ': LOCAL, QWEN and OPENAI already tried for this unchanged failure' };
}

// Deterministic recoveries for the known Fable patterns. Same objective,
// scope, validation, acceptance and action — never more privilege — plus
// the concrete change the diagnosis implies.
function localRecovery(cls, task, cfg) {
  var s = task.spec;
  var spec = {
    title: 'Recovery (' + cls.toLowerCase() + '): ' + String(s.title || '').slice(0, 70),
    objective: s.objective,
    scope: (s.scope || []).slice(),
    constraints: (s.constraints || []).slice(),
    validation: (s.validation || []).slice(),
    acceptance_criteria: (s.acceptance_criteria || []).slice(),
    action: s.action,
    timeout_seconds: s.timeout_seconds
  };
  if (cls === 'TIMEOUT') {
    spec.timeout_seconds = Math.min(cfg.max_timeout_seconds, Math.max(s.timeout_seconds * 2, s.timeout_seconds + 300));
    spec.constraints.push('The previous attempt timed out after ' + s.timeout_seconds + ' s: work in small steps and report evidence as soon as each criterion is checked.');
  } else if (cls === 'CRASH') {
    spec.constraints.push('The previous execution was interrupted (process gone) while host resources were healthy: keep each step small and report early.');
  } else if (cls === 'BRIDGE') {
    spec.constraints.push('The previous report never reached the supervisor intact (bridge transport failure): produce the same report again.');
  } else {
    return null;
  }
  return spec;
}

module.exports = { TIERS: TIERS, RULES: RULES, classify: classify, route: route, localRecovery: localRecovery, actionRank: actionRank, ACTION_RANK: ACTION_RANK };
