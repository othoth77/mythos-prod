'use strict';
// =====================================================
// Mythos Orchestration Core — controlled self-improvement (Phase 2L)
// projects/mythos-ai-executor/core/self-improve.js
//
// The seed of the self-developing system, intentionally small and
// intentionally caged. Mythos can create a development mission against
// its own repository, but:
//
//   * the mission's declared scope may NEVER touch the safeguard
//     surface (policy engine, validation, events/audit, redaction,
//     credential handling, this module, service units) — refused at
//     build time;
//   * the actual diff is re-checked after implementation
//     (checkWorktreeSafety) — a task that quietly edited a protected
//     path fails validation regardless of what it declared;
//   * work happens in an ISOLATED worktree on its own branch, never in
//     the live checkout of the running system; the branch is the
//     rollback path;
//   * tests + adversarial review + policy gates apply exactly as for
//     any other mission — self-work gets no shortcut.
// =====================================================

var cp = require('child_process');

var domain = require('./domain');
var store = require('./store');
var planner = require('./planner');

// The safeguard surface. Substring match on repository-relative paths;
// deliberately broad — false positives are acceptable, false negatives
// are not.
// THE governance surface. Autonomous self-development may never touch
// these, whatever a mission declares or an agent proposes: policy
// authority, budget enforcement, approval, secret handling, Git delivery
// security, audit/event integrity, destructive-operation limits and the
// emergency rollback all live here. Changing any of them is a human
// decision (WAITING_FOR_APPROVAL), never self-authorised.
var SELF_PROTECTED_PATHS = [
  // Policy + approval authority
  'projects/mythos-ai-executor/core/policy-engine.js',
  'projects/mythos-ai-executor/config/policy.json',
  // Budget enforcement and its ledger
  'projects/mythos-ai-executor/core/budget.js',
  'projects/mythos-ai-executor/config/budgets.json',
  // Validation and audit/event integrity
  'projects/mythos-ai-executor/core/validation.js',
  'projects/mythos-ai-executor/core/events.js',
  'projects/mythos-ai-executor/core/store.js',
  // The governance guard itself and the autonomous campaign manager
  'projects/mythos-ai-executor/core/self-improve.js',
  'projects/mythos-ai-executor/core/campaign.js',
  // Emergency rollback + the feature flag that arms it
  'projects/mythos-ai-executor/core/core-wiring.js',
  'projects/mythos-ai-executor/service/',
  // Provider authority routing
  'projects/mythos-ai-executor/config/router.json',
  'projects/mythos-ai-executor/config/agents.json',
  // Secret redaction and Git delivery security
  'projects/mythos-orchestrator/lib/redact.js',
  'mythos-git-push',
  '.github/',
  '.git/'
];

var SELF_PROTECTED_PATTERNS = [/credential/i, /secret/i, /\.env(\.|$)/i, /\.ssh\//i, /sudoers/i];

function isProtectedPath(p) {
  // NORMALISE FIRST. A substring match on a raw path is evadable with
  // non-normalised forms such as
  //   projects/mythos-ai-executor/core/../core/policy-engine.js
  //   ./projects/./mythos-ai-executor/core/policy-engine.js
  // which do not literally contain the protected string. Both resolve to
  // a protected file, so both must be refused (independent review).
  var raw = String(p).replace(/\\/g, '/');
  var norm;
  try {
    norm = require('path').posix.normalize(raw);
  } catch (e) {
    norm = raw;
  }
  norm = norm.replace(/^\.\//, '');
  // Compare BOTH the normalised and the raw form: normalisation closes the
  // evasion, and the raw check keeps catching absolute or prefixed paths.
  var candidates = [norm, raw];
  return SELF_PROTECTED_PATHS.some(function (sp) {
    return candidates.some(function (c) { return c.indexOf(sp) !== -1; });
  }) || SELF_PROTECTED_PATTERNS.some(function (re) {
    return candidates.some(function (c) { return re.test(c); });
  });
}

// Builds a self-improvement mission. Scope paths are mandatory and
// checked against the safeguard surface before anything is persisted.
function buildSelfImprovementMission(goalText, opts) {
  opts = opts || {};
  if (!opts.repo_path) throw new Error('SELF_IMPROVEMENT_NEEDS_REPO');
  var scope = opts.scope_paths || [];
  if (!scope.length) throw new Error('SELF_IMPROVEMENT_NEEDS_SCOPE: declare the paths the change may touch');
  var violations = scope.filter(isProtectedPath);
  if (violations.length) {
    throw new Error('SELF_PROTECTION: refusing a self-improvement mission scoped at safeguard surface: ' +
      violations.join(', '));
  }

  var goal = domain.createGoal({
    text: goalText,
    project: opts.project || 'mythos-self',
    requested_by: opts.requested_by || 'orchestrator',
    metadata: { self_improvement: true, scope_paths: scope }
  });
  store.create(goal);

  var guard = 'HARD LIMITS: modify only ' + scope.join(', ') +
    '. Never touch policy, validation, events, redaction, credentials, service units, or Git configuration. ' +
    'Never force-push. Work only in the assigned isolated worktree.';

  var plan = planner.planFromSpec(goal, {
    title: 'Self-improvement: ' + goalText.slice(0, 120),
    tasks: [
      { key: 'implement', title: 'Implement the change in an isolated worktree', task_type: 'coding',
        instruction: goalText + '\n' + guard, depends_on: [] },
      { key: 'test', title: 'Run tests against the change', task_type: 'testing',
        instruction: 'Run the targeted tests for the change. ' + guard, depends_on: ['implement'] },
      { key: 'review', title: 'Adversarial review of the change', task_type: 'review',
        instruction: 'Hunt for regressions, security issues, protected-path modifications, incompleteness.',
        depends_on: ['test'] },
      { key: 'report', title: 'Report the reviewable commit', task_type: 'reporting',
        instruction: 'Report branch, commit, tests and residual risks. The commit is reviewable, not auto-merged.',
        depends_on: ['review'] }
    ]
  });
  if (!plan.valid) throw new Error('SELF_PLAN_INVALID: ' + plan.errors.join('; '));
  var persisted = planner.persistPlan(plan);
  persisted.tasks.forEach(function (t) {
    t.metadata.self_improvement = true;
    t.metadata.scope_paths = scope;
    store.save(t);
  });
  return { goal: goal, mission: persisted.mission, tasks: persisted.tasks, plan: plan };
}

// Post-implementation safety check: the REAL diff in the worktree is
// compared against the safeguard surface. Declared scope is irrelevant
// here — only what actually changed counts.
function checkWorktreeSafety(worktreeDir, baseRef) {
  var out = cp.execFileSync('git', ['diff', '--name-only', (baseRef || 'HEAD~1') + '..HEAD'],
    { cwd: worktreeDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  var staged = cp.execFileSync('git', ['diff', '--name-only'],
    { cwd: worktreeDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  var changed = (out + '\n' + staged).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  var violations = changed.filter(isProtectedPath);
  return { safe: violations.length === 0, changed: changed, violations: violations };
}

module.exports = {
  SELF_PROTECTED_PATHS: SELF_PROTECTED_PATHS,
  isProtectedPath: isProtectedPath,
  buildSelfImprovementMission: buildSelfImprovementMission,
  checkWorktreeSafety: checkWorktreeSafety
};
