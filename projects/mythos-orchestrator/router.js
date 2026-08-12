'use strict';
// =====================================================
// Mythos Orchestrator — deterministic model router
// projects/mythos-orchestrator/router.js
//
// Maps a work class to the provider that should execute it and to the
// execution level that governs how much may happen without a human.
// Deliberately a lookup table, not a classifier: the same input must
// always produce the same routing decision, and the decision must be
// auditable by reading this file.
//
// Claude remains the top-level orchestrator in every case — routing to
// CODEX delegates implementation, never accountability. Claude verifies
// the result against Git before anything is called complete.
// =====================================================

var CLAUDE_CLASSES = [
  'ARCHITECTURE',
  'DESIGN',
  'SECURITY_REVIEW',
  'FINAL_REVIEW',
  'PORTFOLIO_DECISION',
  'AMBIGUOUS_REQUIREMENTS',
  'CROSS_PROJECT_DECISION'
];

var CODEX_CLASSES = [
  'CODE_IMPLEMENTATION',
  'REFACTOR',
  'TEST_IMPLEMENTATION',
  'BUG_FIX',
  'STATIC_ANALYSIS',
  'MIGRATION_IMPLEMENTATION',
  'CLI_TOOLING',
  'REPETITIVE_CODE_CHANGES'
];

// Never routed automatically to any provider. These are the classes whose
// blast radius is irreversible, credentialed or production-facing, and they
// map to execution level 3 — see docs/AUTOMATION_APPROVAL_MATRIX.md and
// projects/meta/development-lanes.json, whose HIGH_RISK lane this mirrors.
var APPROVAL_CLASSES = [
  'HIGH_RISK_INFRA',
  'PRODUCTION_DEPLOYMENT',
  'AUTH',
  'DNS_MUTATION',
  'DESTRUCTIVE_DB',
  'SECRET_ROTATION'
];

var DECISIONS = { CLAUDE: 'CLAUDE', CODEX: 'CODEX', USER_APPROVAL_REQUIRED: 'USER_APPROVAL_REQUIRED' };

// Execution levels (PHASE 9 safety gates):
//   1 AUTO              — reads, audits, analysis, tests, docs, isolated implementation
//   2 CLAUDE_CONTROLLED — commits, pushes, branch creation, stage metadata, tooling
//   3 USER_APPROVAL     — never automatic
var LEVELS = { AUTO: 1, CLAUDE_CONTROLLED: 2, USER_APPROVAL: 3 };

function contains(list, value) { return list.indexOf(value) !== -1; }

// Returns the execution level implied by a work class alone, before the
// task's own delivery requirements are considered.
function levelForClass(riskClass) {
  if (contains(APPROVAL_CLASSES, riskClass)) return LEVELS.USER_APPROVAL;
  return LEVELS.AUTO;
}

// Core routing decision.
//
// `options.claudeOverride` lets Claude explicitly keep a Codex-class task
// for itself when it judges the work ambiguous. The override can only move
// work *towards* Claude or towards approval — it can never downgrade an
// approval-class task into automatic execution.
function route(riskClass, options) {
  options = options || {};
  var reasons = [];

  if (!riskClass || typeof riskClass !== 'string') {
    return {
      decision: DECISIONS.USER_APPROVAL_REQUIRED,
      execution_level: LEVELS.USER_APPROVAL,
      provider: null,
      reasons: ['UNKNOWN_RISK_CLASS: routing fails closed to user approval']
    };
  }

  if (contains(APPROVAL_CLASSES, riskClass)) {
    return {
      decision: DECISIONS.USER_APPROVAL_REQUIRED,
      execution_level: LEVELS.USER_APPROVAL,
      provider: null,
      reasons: ['HIGH_RISK_CLASS: ' + riskClass + ' never executes automatically']
    };
  }

  // A task that asks to mutate production is level 3 whatever its class.
  if (options.allowProductionMutation === true) {
    return {
      decision: DECISIONS.USER_APPROVAL_REQUIRED,
      execution_level: LEVELS.USER_APPROVAL,
      provider: null,
      reasons: ['PRODUCTION_MUTATION_REQUESTED: requires explicit user authorisation']
    };
  }

  if (contains(CLAUDE_CLASSES, riskClass)) {
    return {
      decision: DECISIONS.CLAUDE,
      execution_level: LEVELS.AUTO,
      provider: 'claude',
      reasons: ['JUDGEMENT_CLASS: ' + riskClass + ' stays with the orchestrator']
    };
  }

  if (contains(CODEX_CLASSES, riskClass)) {
    if (options.claudeOverride) {
      reasons.push('CLAUDE_OVERRIDE: orchestrator retained an implementation-class task');
      return {
        decision: DECISIONS.CLAUDE,
        execution_level: LEVELS.AUTO,
        provider: 'claude',
        reasons: reasons
      };
    }
    // Committing and pushing is a level 2 action even inside an isolated
    // branch: it changes shared remote state.
    var level = (options.commitRequired || options.pushRequired)
      ? LEVELS.CLAUDE_CONTROLLED
      : LEVELS.AUTO;
    reasons.push('IMPLEMENTATION_CLASS: ' + riskClass + ' delegated to Codex');
    if (level === LEVELS.CLAUDE_CONTROLLED) {
      reasons.push('DELIVERY_REQUIRES_GIT_WRITE: execution level 2 (Claude-controlled)');
    }
    return {
      decision: DECISIONS.CODEX,
      execution_level: level,
      provider: 'codex',
      reasons: reasons
    };
  }

  // Unrecognised but syntactically valid class — fail closed.
  return {
    decision: DECISIONS.USER_APPROVAL_REQUIRED,
    execution_level: LEVELS.USER_APPROVAL,
    provider: null,
    reasons: ['UNROUTABLE_CLASS: ' + riskClass + ' has no routing rule; failing closed']
  };
}

// Convenience wrapper that routes a fully-formed task object.
function routeTask(task) {
  task = task || {};
  return route(task.risk_class, {
    allowProductionMutation: task.allow_production_mutation === true,
    commitRequired: !!(task.delivery && task.delivery.commit_required),
    pushRequired: !!(task.delivery && task.delivery.push_required),
    claudeOverride: task.claude_override === true
  });
}

module.exports = {
  route: route,
  routeTask: routeTask,
  levelForClass: levelForClass,
  DECISIONS: DECISIONS,
  LEVELS: LEVELS,
  CLAUDE_CLASSES: CLAUDE_CLASSES,
  CODEX_CLASSES: CODEX_CLASSES,
  APPROVAL_CLASSES: APPROVAL_CLASSES
};
