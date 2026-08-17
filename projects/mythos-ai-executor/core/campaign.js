'use strict';
// =====================================================
// Mythos Orchestration Core — autonomous campaign manager
// projects/mythos-ai-executor/core/campaign.js
//
// The smallest loop capable of developing the rest of Mythos safely:
//
//   Goal → Campaign → select Mission from the roadmap → plan → DAG →
//   agents/tools → policy + budget → execute in an ISOLATED worktree →
//   test → independent review → bounded repair → validate → commit →
//   push → Memory → roadmap → propose the NEXT mission → repeat
//
// Everything durable lives in core/store.js; nothing depends on process
// memory, so a campaign survives restarts, quota pauses and approval
// waits. This module ORCHESTRATES already-proven parts (planner, DAG,
// scheduler, policy, budget, validation, memory, worktrees) — it adds
// sequencing and the governance cage, not a second engine.
//
// GOVERNANCE CAGE (non-negotiable, and this file is itself listed in the
// protected surface): a campaign may never modify policy authority,
// budget enforcement, approval requirements, secret handling, Git
// delivery security, audit integrity, destructive-operation limits or the
// emergency rollback. Such work is only ever PROPOSED for human approval.
// =====================================================

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var domain = require('./domain');
var store = require('./store');
var memory = require('./memory');
var roadmap = require('./roadmap');
var planner = require('./planner');
var selfImprove = require('./self-improve');
var policyEngine = require('./policy-engine');
var budget = require('./budget');
var events = require('./events');
var worktrees = require('./worktrees');
var orchestrator = require('./orchestrator');
var coreWiring = require('./core-wiring');
var gitlib = require('../../mythos-orchestrator/lib/git');

var CAMPAIGN_STATES = ['PLANNING', 'READY', 'RUNNING', 'WAITING_FOR_QUOTA',
  'WAITING_FOR_APPROVAL', 'BLOCKED', 'REVIEWING', 'REPAIRING', 'COMPLETED', 'PAUSED'];

var CAMPAIGN_TRANSITIONS = {
  PLANNING: ['READY', 'BLOCKED', 'WAITING_FOR_APPROVAL', 'PAUSED'],
  READY: ['RUNNING', 'PAUSED', 'BLOCKED', 'COMPLETED'],
  RUNNING: ['REVIEWING', 'REPAIRING', 'WAITING_FOR_QUOTA', 'WAITING_FOR_APPROVAL',
    'BLOCKED', 'READY', 'COMPLETED', 'PAUSED'],
  REVIEWING: ['REPAIRING', 'READY', 'BLOCKED', 'WAITING_FOR_APPROVAL', 'COMPLETED', 'PAUSED'],
  REPAIRING: ['RUNNING', 'REVIEWING', 'WAITING_FOR_APPROVAL', 'BLOCKED', 'READY', 'PAUSED'],
  WAITING_FOR_QUOTA: ['RUNNING', 'READY', 'PAUSED', 'BLOCKED'],
  WAITING_FOR_APPROVAL: ['READY', 'RUNNING', 'BLOCKED', 'PAUSED', 'COMPLETED'],
  BLOCKED: ['PLANNING', 'READY', 'PAUSED'],
  PAUSED: ['READY', 'PLANNING'],
  COMPLETED: []
};

var MAX_REPAIR_CYCLES = 3;
var MAX_MISSIONS_PER_RUN = 1;   // one mission per invocation; the loop is resumable

// --- Failure taxonomy (order §11) ------------------------------------------------

var FAILURE_KINDS = ['TRANSIENT', 'QUOTA', 'POLICY', 'BUDGET', 'AUTH', 'CODE',
  'TEST', 'REVIEW', 'INFRASTRUCTURE', 'UNKNOWN'];

// Maps a failure kind to what the CAMPAIGN does. Nothing collapses every
// failure into FAILED.
var FAILURE_BEHAVIOUR = {
  TRANSIENT: 'retry',
  QUOTA: 'WAITING_FOR_QUOTA',
  POLICY: 'WAITING_FOR_APPROVAL',
  BUDGET: 'WAITING_FOR_APPROVAL',
  AUTH: 'WAITING_FOR_APPROVAL',
  CODE: 'repair',
  TEST: 'repair',
  REVIEW: 'repair',
  INFRASTRUCTURE: 'BLOCKED',
  UNKNOWN: 'BLOCKED'
};

// Classifies a failure from its text. Order matters: a quota message
// often also says "limit", and an infrastructure error often also says
// "failed". Callers must pass the REAL error text — passing a summary
// that merely lists task names (…"review:WAITING"…) would match on the
// wrong keyword, which is why the runner separates the two.
function classifyFailure(text) {
  var t = String(text || '');
  // Acceptance gaps: the agent produced an incomplete result rather than
  // an error. That is repairable, not unknown.
  if (/no commit reported|does not exist|no test results reported|review did not complete/i.test(t) &&
      !/ECONNREFUSED|ETIMEDOUT|quota|budget|policy/i.test(t)) {
    return 'CODE';
  }
  if (/usage limit reached|hit your (usage|session) limit|WAITING_FOR_QUOTA|quota/i.test(t)) return 'QUOTA';
  if (/CUMULATIVE BUDGET|budget|no configured spending/i.test(t)) return 'BUDGET';
  if (/POLICY_DENIED|policy|DESTRUCTIVE|require_approval|approval/i.test(t)) return 'POLICY';
  if (/auth|credential|permission denied|publickey|401|403/i.test(t)) return 'AUTH';
  if (/test .*fail|assertion|\d+ failed/i.test(t)) return 'TEST';
  if (/review|rejected/i.test(t)) return 'REVIEW';
  if (/ENOSPC|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|disk|network|infrastructure/i.test(t)) return 'INFRASTRUCTURE';
  if (/overloaded|529|50[023]|rate.?limit|temporar/i.test(t)) return 'TRANSIENT';
  if (/error|exception|failed|cannot|undefined/i.test(t)) return 'CODE';
  return 'UNKNOWN';
}

// --- Persistence ------------------------------------------------------------------

function campaignsRoot() { return path.join(store.root(), 'campaigns'); }

var CAMPAIGN_ID_RE = /^c-[a-z0-9]{6,12}-[a-z0-9]{4,8}$/;

function newCampaignId() {
  return 'c-' + Date.now().toString(36) + '-' +
    require('crypto').randomBytes(3).toString('hex');
}

function campaignFile(id) {
  if (!CAMPAIGN_ID_RE.test(String(id))) {
    throw new Error('INVALID_CAMPAIGN_ID: ' + String(id).slice(0, 40));
  }
  var file = path.join(campaignsRoot(), id + '.json');
  if (path.dirname(path.resolve(file)) !== path.resolve(campaignsRoot())) {
    throw new Error('CAMPAIGN_PATH_ESCAPE');
  }
  return file;
}

function saveCampaign(c) {
  c.updated_at = new Date().toISOString();
  var file = campaignFile(c.campaign_id);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  var tmp = file + '.tmp-' + process.pid;
  var redact = require('../../mythos-orchestrator/lib/redact');
  fs.writeFileSync(tmp, JSON.stringify(redact.redactValue(c), null, 2) + '\n',
    { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  return c;
}

function loadCampaign(id) {
  var file = campaignFile(id);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function listCampaigns() {
  if (!fs.existsSync(campaignsRoot())) return [];
  return fs.readdirSync(campaignsRoot())
    .filter(function (f) { return /^c-.*\.json$/.test(f); })
    .map(function (f) { return loadCampaign(f.replace(/\.json$/, '')); })
    .filter(Boolean)
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
}

function transition(id, to, fields) {
  var c = loadCampaign(id);
  if (!c) throw new Error('NO_SUCH_CAMPAIGN: ' + id);
  if (CAMPAIGN_STATES.indexOf(to) === -1) throw new Error('UNKNOWN_CAMPAIGN_STATE: ' + to);
  if (c.state !== to && (CAMPAIGN_TRANSITIONS[c.state] || []).indexOf(to) === -1) {
    throw new Error('ILLEGAL_CAMPAIGN_TRANSITION: ' + c.state + ' -> ' + to);
  }
  var from = c.state;
  c.state = to;
  Object.keys(fields || {}).forEach(function (k) { c[k] = fields[k]; });
  saveCampaign(c);
  events.emit('DECISION_MADE', {
    subject_id: id, project: c.project,
    detail: { campaign_state: to, from: from }
  });
  return c;
}

// --- Creation -----------------------------------------------------------------------

function createCampaign(input) {
  coreWiring.assertEnabled();
  input = input || {};
  if (typeof input.objective !== 'string' || input.objective.trim().length < 10) {
    throw new Error('CAMPAIGN_NEEDS_OBJECTIVE (>= 10 chars)');
  }
  var c = {
    campaign_id: newCampaignId(),
    project: input.project || 'mythos-prod',
    objective: input.objective.trim().slice(0, 2000),
    repo_path: input.repo_path || coreWiring.REPO_PATH,
    state: 'PLANNING',
    current_mission: null,
    completed_missions: [],
    blocked_missions: [],
    remaining_missions: [],
    approval_required: [],
    budget: {
      project: input.project || 'mythos-prod',
      spend_estimate_usd: 0,
      note: 'development work consumes provider quota, not money; any real spend is gated by the ledger'
    },
    policy: { policy_id: (input.policy && input.policy.policy_id) || 'mythos-default-v1' },
    max_repair_cycles: input.max_repair_cycles || MAX_REPAIR_CYCLES,
    requested_by: input.requested_by || 'owner',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    history: []
  };
  saveCampaign(c);
  events.emit('GOAL_CREATED', {
    subject_id: c.campaign_id, project: c.project,
    detail: { campaign: true, objective: c.objective.slice(0, 200) }
  });
  return c;
}

function note(c, entry) {
  c.history = (c.history || []).concat([Object.assign({ at: new Date().toISOString() }, entry)]);
  if (c.history.length > 200) c.history = c.history.slice(-200);
  saveCampaign(c);
  return c;
}

// --- Mission selection (the autonomous choice) ---------------------------------------

// Chooses the next capability from the roadmap and turns it into a mission
// proposal. Governance capabilities are never selected — they are recorded
// as approval candidates instead.
function proposeNextMission(campaignId) {
  var c = loadCampaign(campaignId);
  if (!c) throw new Error('NO_SUCH_CAMPAIGN: ' + campaignId);
  var attempted = (c.completed_missions || []).map(function (m) { return m.capability_key; })
    .concat((c.blocked_missions || []).map(function (m) { return m.capability_key; }))
    .filter(Boolean);
  var selection = roadmap.selectNext(c.repo_path, { exclude: attempted });
  if (!selection.selected) {
    c.approval_required = selection.approval_candidates || [];
    note(c, { event: 'no_selectable_capability', reason: selection.reason });
    return { proposal: null, reason: selection.reason,
      approval_candidates: selection.approval_candidates || [] };
  }
  var spec = roadmap.missionSpecFor(selection.selected, {});
  var proposal = {
    capability_key: selection.selected.key,
    title: selection.selected.title,
    objective: spec.objective,
    reason: selection.reason,
    risk: spec.risk,
    budget_estimate_usd: spec.budget_estimate_usd,
    acceptance_criteria: spec.acceptance_criteria,
    runners_up: selection.runners_up || [],
    authority: 'autonomous'
  };
  note(c, { event: 'mission_proposed', capability: proposal.capability_key });
  return { proposal: proposal, reason: selection.reason };
}

// --- Governance gate ---------------------------------------------------------------

// The cage. A mission may not run autonomously when its scope, objective
// or (later) real diff touches governance. Returns
// { allowed, reason, requires_approval }.
function governanceGate(objective, scopePaths) {
  var scope = scopePaths || [];
  var violations = scope.filter(selfImprove.isProtectedPath);
  if (violations.length) {
    return { allowed: false, requires_approval: true,
      reason: 'governance surface in declared scope: ' + violations.join(', ') };
  }
  // Objective text that asks for governance change is refused even when
  // the declared scope looks innocent.
  var intent = /(disable|remove|bypass|weaken|relax|loosen|skip|turn off)[^.]{0,60}(policy|budget|approval|validation|guard|limit|restriction|security|audit|rollback)/i;
  if (intent.test(String(objective || ''))) {
    return { allowed: false, requires_approval: true,
      reason: 'objective proposes weakening a governance boundary — human approval required, never self-authorised' };
  }
  return { allowed: true, requires_approval: false, reason: 'no governance surface involved' };
}

// Records an approval-required mission without running it.
function requireApproval(campaignId, proposal, reason) {
  var c = loadCampaign(campaignId);
  var approval = policyEngine.requestApproval(
    c.campaign_id, 'GOVERNANCE',
    'campaign ' + c.campaign_id + ' proposed: ' + String(proposal.objective).slice(0, 300) +
    ' — ' + reason, c.project);
  c.approval_required = (c.approval_required || []).concat([{
    capability_key: proposal.capability_key || null,
    objective: String(proposal.objective).slice(0, 400),
    reason: reason, approval_id: approval.id, requested_at: new Date().toISOString()
  }]);
  saveCampaign(c);
  if (c.state !== 'WAITING_FOR_APPROVAL') {
    transition(campaignId, 'WAITING_FOR_APPROVAL', {});
  }
  events.emit('APPROVAL_REQUESTED', {
    subject_id: c.campaign_id, project: c.project,
    detail: { reason: reason, approval_id: approval.id }
  });
  return { requires_approval: true, approval_id: approval.id, reason: reason };
}

// --- Mission execution ------------------------------------------------------------

// Builds the development mission DAG for a proposal: parallel inspection
// and analysis, then implementation, tests, independent review, report.
function buildMissionSpec(proposal, opts) {
  var guard = ' HARD LIMITS: work only inside your assigned worktree; never modify policy, budget, ' +
    'validation, events, redaction, credentials, service units, Git configuration or the campaign ' +
    'manager; never force-push. Keep the mythos_report summary dense (max ~1200 chars).';
  return {
    title: 'Autonomous mission: ' + proposal.title,
    tasks: [
      { key: 'inspect', title: 'Inspect the current implementation', task_type: 'inspection',
        capabilities_required: ['repo_inspection'], policy_classes: ['READ'], depends_on: [],
        instruction: 'Inspect what already exists for this capability: ' + proposal.objective +
          ' State precisely what is implemented and what is missing, with file paths.' + guard },
      { key: 'research', title: 'Analyse the design constraints', task_type: 'analysis',
        capabilities_required: ['analysis'], policy_classes: ['READ'], depends_on: [],
        instruction: 'Analyse the design constraints and risks for: ' + proposal.objective +
          ' Consider backward compatibility and the acceptance criteria: ' +
          proposal.acceptance_criteria.join('; ') + guard },
      { key: 'implement', title: 'Implement the smallest coherent change', task_type: 'coding',
        capabilities_required: ['coding'], policy_classes: ['READ', 'PROJECT_WRITE', 'GIT'],
        depends_on: ['inspect', 'research'],
        instruction: 'Implement the smallest coherent change for: ' + proposal.objective +
          ' Add or update targeted tests. Commit inside your worktree with a focused message.' + guard },
      { key: 'test', title: 'Run the targeted tests', task_type: 'testing',
        capabilities_required: ['testing'], policy_classes: ['READ', 'PROJECT_WRITE'],
        depends_on: ['implement'],
        instruction: 'Run the targeted tests for the change and report their REAL results. ' +
          'Never report an unrun test as passed.' + guard },
      { key: 'review', title: 'Independent adversarial review', task_type: 'review',
        capabilities_required: ['review'], policy_classes: ['READ'], depends_on: ['test'],
        instruction: 'Adversarially review the change: correctness, tests, security, policy, ' +
          'regressions, architecture compatibility. Report every genuine problem.' + guard },
      { key: 'report', title: 'Report the reviewable result', task_type: 'reporting',
        capabilities_required: ['summarization', 'repo_inspection'], policy_classes: ['READ'],
        depends_on: ['review'],
        instruction: 'Report branch, commit, tests, review findings and residual risks for: ' +
          proposal.objective + ' Label claims VERIFIED / INFERRED / RECOMMENDED.' + guard }
    ]
  };
}

// Starts one mission for a proposal. Returns { mission_id, goal_id } or an
// approval/blocked outcome. Does not execute — advanceCampaign does.
function startMission(campaignId, proposal, opts) {
  opts = opts || {};
  var c = loadCampaign(campaignId);
  if (!c) throw new Error('NO_SUCH_CAMPAIGN: ' + campaignId);

  var gate = governanceGate(proposal.objective, opts.scope_paths);
  if (!gate.allowed) return requireApproval(campaignId, proposal, gate.reason);

  var goal = domain.createGoal({
    text: proposal.objective, project: c.project,
    requested_by: 'campaign:' + c.campaign_id,
    metadata: { campaign_id: c.campaign_id, capability_key: proposal.capability_key }
  });
  store.create(goal);
  var plan = planner.planFromSpec(goal, buildMissionSpec(proposal, opts));
  var engine = opts.policy || policyEngine.createEngine();
  var vetted = planner.validatePlan(plan, function (req) {
    return engine.checkPolicy({ action_class: req.action_class, project: c.project });
  });
  if (!plan.valid || !vetted.valid) {
    c.blocked_missions = (c.blocked_missions || []).concat([{
      capability_key: proposal.capability_key,
      reason: 'plan invalid: ' + plan.errors.concat(vetted.errors).slice(0, 3).join('; '),
      at: new Date().toISOString()
    }]);
    saveCampaign(c);
    transition(campaignId, 'BLOCKED', {});
    return { blocked: true, reason: plan.errors.concat(vetted.errors).join('; ') };
  }
  var persisted = planner.persistPlan(plan);
  store.transition('mission', persisted.mission.id, 'VALIDATED');
  store.transition('goal', goal.id, 'PLANNING');
  store.transition('goal', goal.id, 'ACTIVE');

  c.current_mission = {
    mission_id: persisted.mission.id, goal_id: goal.id,
    capability_key: proposal.capability_key, title: proposal.title,
    objective: proposal.objective, acceptance_criteria: proposal.acceptance_criteria,
    repair_cycles: 0, started_at: new Date().toISOString()
  };
  saveCampaign(c);
  note(c, { event: 'mission_started', mission_id: persisted.mission.id,
    capability: proposal.capability_key });
  events.emit('MISSION_PLANNED', {
    subject_id: persisted.mission.id, project: c.project,
    detail: { campaign_id: c.campaign_id, capability: proposal.capability_key }
  });
  return { mission_id: persisted.mission.id, goal_id: goal.id };
}

// --- Acceptance ------------------------------------------------------------------

// A mission is COMPLETED only on evidence: every task completed, a real
// commit that Git confirms, tests reported, review passed, and the real
// diff free of governance paths. An agent saying "done" is not enough.
function acceptMission(campaignId, opts) {
  opts = opts || {};
  var c = loadCampaign(campaignId);
  var cm = c.current_mission;
  if (!cm) return { accepted: false, reason: 'no current mission' };
  var mission = store.load('mission', cm.mission_id);
  var tasks = mission.task_ids.map(function (id) { return store.load('task', id); });
  var problems = [];

  var incomplete = tasks.filter(function (t) { return t.status !== 'COMPLETED'; });
  if (incomplete.length) {
    problems.push('tasks not completed: ' + incomplete.map(function (t) {
      return t.metadata.plan_key + ':' + t.status;
    }).join(', '));
  }

  var implementTask = tasks.filter(function (t) { return t.metadata.plan_key === 'implement'; })[0];
  var commit = implementTask && implementTask.result && implementTask.result.commit;
  var worktreeDir = implementTask && implementTask.metadata && implementTask.metadata.worktree_dir;
  if (!commit) {
    problems.push('no commit reported by the implementation task');
  } else if (worktreeDir && fs.existsSync(worktreeDir)) {
    if (!gitlib.commitExists(worktreeDir, commit)) {
      problems.push('claimed commit ' + String(commit).slice(0, 12) + ' does not exist in the worktree');
    } else {
      // The REAL diff decides, not the declared scope.
      try {
        var safety = selfImprove.checkWorktreeSafety(worktreeDir, opts.base_ref);
        if (!safety.safe) {
          problems.push('GOVERNANCE VIOLATION in the real diff: ' + safety.violations.join(', '));
        }
        cm.changed_files = safety.changed;
      } catch (e) {
        problems.push('could not inspect the worktree diff: ' + String(e.message).slice(0, 120));
      }
    }
  }

  var testTask = tasks.filter(function (t) { return t.metadata.plan_key === 'test'; })[0];
  var tests = testTask && testTask.result && testTask.result.tests;
  if (!tests || !tests.length) {
    problems.push('no test results reported');
  } else {
    // REPORTING a test is not RUNNING it. A live campaign was accepted on
    // "tests: NOT RUN (blocked …)" — honest of the agent, but exactly the
    // false completion the acceptance gate exists to prevent. Every
    // reported test must show it actually ran, and none may report failure.
    var notRun = [].concat(tests).filter(function (t) {
      return /\bnot run\b|\bnot executed\b|\bskipped\b|\bpending\b|\bblocked\b|\bcould not run\b|\bunable to run\b|\bn\/a\b/i
        .test(String(t));
    });
    if (notRun.length) {
      problems.push('tests were reported but NOT RUN: ' +
        notRun.map(function (t) { return String(t).slice(0, 120); }).join(' | '));
    }
    var failing = [].concat(tests).filter(function (t) {
      return /\bfail(ed|ing|ures?)?\b|\berror\b/i.test(String(t)) &&
        !/0 fail|no fail|0 error/i.test(String(t));
    });
    if (failing.length) {
      problems.push('reported tests did not pass: ' +
        failing.map(function (t) { return String(t).slice(0, 120); }).join(' | '));
    }
  }

  var reviewTask = tasks.filter(function (t) { return t.metadata.plan_key === 'review'; })[0];
  if (!reviewTask || reviewTask.status !== 'COMPLETED') problems.push('independent review did not complete');

  cm.commit = commit || null;
  cm.tests = tests || null;
  cm.acceptance_problems = problems;
  saveCampaign(c);
  return { accepted: problems.length === 0, problems: problems, commit: commit, tests: tests };
}

// --- Memory and roadmap closure ------------------------------------------------------

// Agent-produced strings are UNTRUSTED input to long-term memory: they
// could otherwise carry instruction-shaped text that steers a later
// mission (memory poisoning, raised by independent review). They are
// flattened to a single line, hard-capped, and stripped of the markup an
// injected instruction would rely on.
function sanitizeAgentText(value, max) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[`*_#>|]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max || 200);
}

function recordMissionOutcome(campaignId, accepted) {
  var c = loadCampaign(campaignId);
  var cm = c.current_mission;
  if (!cm) return null;
  // Only the structural facts are trusted (title and capability come from
  // the committed roadmap; the commit is verified against Git). Everything
  // the agent wrote is sanitised and labelled as agent-reported.
  var safeCommit = /^[0-9a-f]{7,40}$/.test(String(cm.commit || '')) ? String(cm.commit).slice(0, 12) : null;
  var safeTests = [].concat(cm.tests || []).slice(0, 3)
    .map(function (t) { return sanitizeAgentText(t, 120); }).filter(Boolean);
  var safeProblems = [].concat(cm.acceptance_problems || []).slice(0, 3)
    .map(function (t) { return sanitizeAgentText(t, 160); }).filter(Boolean);
  var summary = (accepted ? 'COMPLETED' : 'NOT ACCEPTED') + ': ' +
    sanitizeAgentText(cm.title, 150) +
    ' (capability ' + sanitizeAgentText(cm.capability_key, 20) + ', mission ' + cm.mission_id + ')' +
    (safeCommit ? ', commit ' + safeCommit : '') +
    (safeTests.length ? ', agent-reported tests: ' + safeTests.join(' | ') : '') +
    (safeProblems.length ? ', problems: ' + safeProblems.join('; ') : '');
  var entry = null;
  try {
    entry = memory.remember({
      project: c.project,
      category: accepted ? 'completed_work' : 'known_issue',
      title: 'Campaign mission: ' + cm.title.slice(0, 150),
      content: summary.slice(0, 4000),
      source: 'campaign:' + c.campaign_id + '/mission:' + cm.mission_id,
      // Structural facts are certain; the agent-reported parts are not
      // independently verified, so the entry is not stored as ground truth.
      confidence: 0.8,
      tags: ['campaign', 'autonomous', cm.capability_key]
    });
  } catch (e) { /* memory refusal must not lose the mission outcome */ }

  if (accepted && cm.capability_key && cm.commit && cm.tests) {
    try {
      roadmap.recordProgress(c.repo_path, cm.capability_key, 'IMPLEMENTED', {
        commit: cm.commit, tests: [].concat(cm.tests).slice(0, 5),
        mission_id: cm.mission_id, campaign_id: c.campaign_id,
        recorded_by: 'autonomous campaign'
      });
    } catch (e) {
      note(c, { event: 'roadmap_not_updated', reason: String(e.message).slice(0, 200) });
    }
  }
  return entry;
}

function finishMission(campaignId, accepted, reason) {
  var c = loadCampaign(campaignId);
  var cm = c.current_mission;
  if (!cm) return c;
  recordMissionOutcome(campaignId, accepted);
  c = loadCampaign(campaignId);
  var record = {
    mission_id: cm.mission_id, capability_key: cm.capability_key, title: cm.title,
    commit: cm.commit || null, tests: cm.tests || null,
    repair_cycles: cm.repair_cycles || 0,
    finished_at: new Date().toISOString(), reason: reason || null
  };
  if (accepted) c.completed_missions = (c.completed_missions || []).concat([record]);
  else c.blocked_missions = (c.blocked_missions || []).concat([record]);
  c.current_mission = null;
  saveCampaign(c);
  events.emit(accepted ? 'MISSION_COMPLETED' : 'MISSION_FAILED', {
    subject_id: record.mission_id, project: c.project,
    detail: { campaign_id: c.campaign_id, capability: record.capability_key, accepted: accepted }
  });
  return c;
}

module.exports = {
  CAMPAIGN_STATES: CAMPAIGN_STATES,
  CAMPAIGN_TRANSITIONS: CAMPAIGN_TRANSITIONS,
  MAX_REPAIR_CYCLES: MAX_REPAIR_CYCLES,
  FAILURE_KINDS: FAILURE_KINDS,
  FAILURE_BEHAVIOUR: FAILURE_BEHAVIOUR,
  classifyFailure: classifyFailure,
  campaignsRoot: campaignsRoot,
  createCampaign: createCampaign,
  loadCampaign: loadCampaign,
  listCampaigns: listCampaigns,
  saveCampaign: saveCampaign,
  transition: transition,
  proposeNextMission: proposeNextMission,
  governanceGate: governanceGate,
  requireApproval: requireApproval,
  buildMissionSpec: buildMissionSpec,
  startMission: startMission,
  acceptMission: acceptMission,
  recordMissionOutcome: recordMissionOutcome,
  sanitizeAgentText: sanitizeAgentText,
  finishMission: finishMission,
  note: note
};
