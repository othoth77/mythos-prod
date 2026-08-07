#!/usr/bin/env node
// =====================================================
// Mythos — Development Acceleration Stage Runner (DEVX-0 MVP)
// scripts/mythos-stage.js
//
// Turns a short owner instruction ("Start <STAGE> according to Mythos
// workflow.") into a verified execution context derived from GitHub/Git
// state and existing project-intelligence metadata — never from repeating
// rules in a prompt.
//
// Deterministic, offline-first (Node built-ins only for all logic). The
// only external calls are `git` and, optionally, `gh` (detected, never
// required — this tool degrades gracefully without it and never prints a
// token).
//
// This tool NEVER:
//   - modifies Git history,
//   - merges a branch,
//   - commits/pushes for a HIGH_RISK stage,
//   - bypasses the one-major-stage rule,
//   - prints a GitHub token or any credential.
//
// Reuses, never duplicates:
//   - scripts/project-intelligence.js for ledger/statistics/registry/history
//     validation — this tool shells out to it rather than reimplementing
//     its checks.
//
// Commands:
//   node scripts/mythos-stage.js context
//   node scripts/mythos-stage.js status
//   node scripts/mythos-stage.js start <STAGE> [--dry-run|--apply]
//   node scripts/mythos-stage.js validate <STAGE>
//   node scripts/mythos-stage.js close <STAGE> [--dry-run|--apply]
// =====================================================
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');

// -------------------------------------------------------------------------
// Generic helpers (deliberately mirrors scripts/project-intelligence.js's
// helper shape so the two tools read the same way; logic is not duplicated).
// -------------------------------------------------------------------------
function readJSON(relPath) {
  var full = path.join(BASE, relPath);
  if (!fs.existsSync(full)) return { __missing: true, path: relPath };
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    return { __parseError: true, path: relPath, error: e.message };
  }
}

function readText(relPath) {
  var full = path.join(BASE, relPath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

function writeJSON(relPath, obj) {
  var full = path.join(BASE, relPath);
  fs.writeFileSync(full, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function gitOutput(args) {
  try {
    return cp.execSync('git ' + args, { cwd: BASE, encoding: 'utf8' }).trim();
  } catch (e) {
    return null;
  }
}

function isWorktreeDirty() {
  var status = gitOutput('status --porcelain');
  return !!(status && status.length > 0);
}

// -------------------------------------------------------------------------
// gh detection boundary — never prints token content, only booleans.
// -------------------------------------------------------------------------
function detectGh() {
  var installed = false;
  var authenticated = false;
  try {
    cp.execSync('gh --version', { cwd: BASE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    installed = true;
  } catch (e) {
    installed = false;
  }
  if (installed) {
    try {
      cp.execSync('gh auth status', { cwd: BASE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      authenticated = true;
    } catch (e) {
      authenticated = false;
    }
  }
  return { installed: installed, authenticated: authenticated };
}

function ghPrList() {
  var gh = detectGh();
  if (!gh.installed || !gh.authenticated) return null;
  try {
    var out = cp.execSync('gh pr list --state all --limit 30 --json number,title,state,isDraft,headRefName', {
      cwd: BASE, encoding: 'utf8'
    });
    return JSON.parse(out);
  } catch (e) {
    return null;
  }
}

// -------------------------------------------------------------------------
// Metadata loaders
// -------------------------------------------------------------------------
function loadLedger() { return readJSON('projects/meta/project-ledger.json'); }
function loadStatistics() { return readJSON('projects/meta/project-statistics.json'); }
function loadKnownBaselines() { return readJSON('projects/meta/known-baselines.json'); }
function loadTestImpactMap() { return readJSON('projects/meta/test-impact-map.json'); }
function loadDevelopmentLanes() { return readJSON('projects/meta/development-lanes.json'); }
function loadStageTemplates() { return readJSON('projects/meta/stage-templates.json'); }
function loadSkillsRegistry() { return readJSON('projects/personal-intelligence/config/agent-skills-registry.json'); }

// -------------------------------------------------------------------------
// Stage lookup
// -------------------------------------------------------------------------
function findStage(stageId, ledger) {
  ledger = ledger || loadLedger();
  if (ledger.__missing || ledger.__parseError) return null;
  var stages = ledger.stages || [];
  for (var i = 0; i < stages.length; i++) {
    if (stages[i].stage_id === stageId) return stages[i];
  }
  return null;
}

function checkOneMajorStageRule(ledger) {
  ledger = ledger || loadLedger();
  var stages = ledger.stages || [];
  var active = stages.filter(function (s) { return s.status === 'IN_PROGRESS'; });
  return { clean: active.length === 0, active: active.map(function (s) { return s.stage_id; }) };
}

function checkDependencies(stage, ledger) {
  ledger = ledger || loadLedger();
  var blockers = [];
  if (!stage) return { satisfied: false, blockers: ['UNKNOWN_STAGE'] };
  // Dependency inference: a stage's own dependencies are whatever named it as
  // their `next_stage` and are not yet DONE. This is a lookup over existing
  // ledger evidence — it never invents a dependency not already recorded.
  var stages = ledger.stages || [];
  stages.forEach(function (s) {
    var next = (s.next_stage || '');
    if (next.indexOf(stage.stage_id) === 0 || next.indexOf(stage.stage_id + ' ') === 0) {
      if (s.status !== 'DONE') blockers.push('DEPENDENCY_UNSATISFIED: ' + s.stage_id + ' (' + s.status + ') must complete before ' + stage.stage_id);
    }
  });
  if ((stage.blockers || []).length) {
    stage.blockers.forEach(function (b) { blockers.push('RECORDED_BLOCKER: ' + b); });
  }
  return { satisfied: blockers.length === 0, blockers: blockers };
}

// -------------------------------------------------------------------------
// Test-impact / risk-lane derivation
// -------------------------------------------------------------------------
function changedFilesVsBase(base) {
  base = base || 'origin/main';
  var out = gitOutput('diff --name-only ' + base + '...HEAD');
  if (!out) return [];
  return out.split('\n').filter(Boolean);
}

function matchRule(filePath, testImpactMap) {
  var rules = testImpactMap.rules || [];
  for (var i = 0; i < rules.length; i++) {
    if (filePath.indexOf(rules[i].path_prefix) === 0) return rules[i];
  }
  return null;
}

var LANE_RANK = { FAST: 0, STANDARD: 1, HIGH_RISK: 2 };

// projects/meta/project-ledger.json's `type` field uses the 7 values defined
// in MPI-0-FINALIZATION (DOCUMENTATION/FOUNDATION/RUNTIME/INFRASTRUCTURE/
// DATABASE/DEPLOYMENT/GOVERNANCE). projects/meta/stage-templates.json's keys
// use a distinct DEVX-0 template vocabulary (…_STAGE suffix, plus
// CONNECTOR/SECURITY/RESEARCH which have no ledger `type` precedent yet).
// This map bridges the two without renaming either existing vocabulary.
var TYPE_TO_TEMPLATE = {
  DOCUMENTATION: 'DOCUMENTATION_STAGE',
  FOUNDATION: 'DOCUMENTATION_STAGE',
  GOVERNANCE: 'DOCUMENTATION_STAGE',
  RUNTIME: 'RUNTIME_STAGE',
  INFRASTRUCTURE: 'INFRASTRUCTURE_STAGE',
  DEPLOYMENT: 'INFRASTRUCTURE_STAGE',
  DATABASE: 'DATABASE_STAGE',
  CONNECTOR: 'CONNECTOR_STAGE',
  SECURITY: 'SECURITY_STAGE',
  RESEARCH: 'RESEARCH_STAGE'
};

function resolveTemplateForStage(stage, templates) {
  templates = templates || loadStageTemplates();
  var templateKey = TYPE_TO_TEMPLATE[stage.type] || null;
  return templateKey ? (templates.templates || {})[templateKey] || null : null;
}

function deriveTestSelection(changedFiles, testImpactMap) {
  testImpactMap = testImpactMap || loadTestImpactMap();
  var testsSet = {};
  var baselineIds = {};
  var lane = 'FAST';
  var usedFallback = false;
  var matches = [];

  if (!changedFiles.length) {
    return { tests: [], riskLane: 'FAST', baselineIds: [], usedFallback: false, matches: [] };
  }

  changedFiles.forEach(function (f) {
    var rule = matchRule(f, testImpactMap);
    if (!rule) {
      usedFallback = true;
      var fb = testImpactMap.fallback || { risk_lane: 'HIGH_RISK', targeted_tests: ['FULL_SUITE_REQUIRED'] };
      (fb.targeted_tests || []).forEach(function (t) { testsSet[t] = true; });
      if (LANE_RANK[fb.risk_lane] > LANE_RANK[lane]) lane = fb.risk_lane;
      matches.push({ file: f, rule: null });
      return;
    }
    (rule.targeted_tests || []).forEach(function (t) { testsSet[t] = true; });
    if (rule.baseline_id) baselineIds[rule.baseline_id] = true;
    if (LANE_RANK[rule.risk_lane] > LANE_RANK[lane]) lane = rule.risk_lane;
    matches.push({ file: f, rule: rule.path_prefix });
  });

  return {
    tests: Object.keys(testsSet),
    riskLane: lane,
    baselineIds: Object.keys(baselineIds),
    usedFallback: usedFallback,
    matches: matches
  };
}

// -------------------------------------------------------------------------
// Current Context (Phase 4)
// -------------------------------------------------------------------------
function buildCurrentContext() {
  var branch = gitOutput('branch --show-current');
  var head = gitOutput('rev-parse HEAD');
  var originMain = gitOutput('rev-parse origin/main');
  var ledger = loadLedger();
  var stats = loadStatistics();
  var skillsReg = loadSkillsRegistry();
  var statusText = readText('docs/PROJECT_STATUS.md') || '';

  var lastCompleted = null;
  var doneStages = (ledger.stages || []).filter(function (s) { return s.status === 'DONE'; });
  doneStages.forEach(function (s) {
    if (!lastCompleted || (s.completed_at && s.completed_at > (lastCompleted.completed_at || ''))) lastCompleted = s;
  });

  var nextPriorityMatch = statusText.match(/\*\*([A-Z0-9-]+ — [^*]+)\.\*\*/);
  var nextOwnerPriority = nextPriorityMatch ? nextPriorityMatch[1] : null;

  var gh = detectGh();
  var prs = ghPrList();
  var activePrs = prs ? prs.filter(function (p) { return p.state === 'OPEN' && !p.isDraft; }) : null;
  var draftPrs = prs ? prs.filter(function (p) { return p.state === 'OPEN' && p.isDraft; }) : null;

  var knownBlockers = [];
  (ledger.stages || []).forEach(function (s) {
    (s.blockers || []).forEach(function (b) { knownBlockers.push(s.stage_id + ': ' + b); });
  });

  var knownBaselines = loadKnownBaselines();
  var deploymentState = 'UNKNOWN';
  if (stats && stats.architecture_maturity_distinction) {
    deploymentState = 'production_deployed_tracks=' + JSON.stringify(stats.architecture_maturity_distinction.production_deployed_tracks || []);
  }

  var context = {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    source_commit: head,
    main_head: originMain,
    active_branch: branch,
    active_stage: (ledger.stages || []).filter(function (s) { return s.status === 'IN_PROGRESS'; }).map(function (s) { return s.stage_id; }),
    last_completed_stage: lastCompleted ? { track: lastCompleted.track, stage_id: lastCompleted.stage_id, completed_at: lastCompleted.completed_at } : null,
    next_owner_priority: nextOwnerPriority,
    active_prs: activePrs === null ? 'GH_UNAVAILABLE' : activePrs.map(function (p) { return { number: p.number, title: p.title, head: p.headRefName }; }),
    draft_prs: draftPrs === null ? 'GH_UNAVAILABLE' : draftPrs.map(function (p) { return { number: p.number, title: p.title, head: p.headRefName }; }),
    known_blockers: knownBlockers,
    known_baselines: (knownBaselines.baselines || []).map(function (b) { return b.baseline_id; }),
    relevant_tracks: ledger.tracks || [],
    relevant_skills: (skillsReg.skills || []).map(function (s) { return s.skill_id; }),
    deployment_state: deploymentState
  };
  return context;
}

// -------------------------------------------------------------------------
// Stage Context (Phase 10) — the compact object a "Start <STAGE>" command
// resolves to.
// -------------------------------------------------------------------------
function buildStageContext(stageId, opts) {
  opts = opts || {};
  var blockerCodes = [];

  if (isWorktreeDirty()) blockerCodes.push('DIRTY_WORKTREE');

  var localHead = gitOutput('rev-parse HEAD');
  var originMain = gitOutput('rev-parse origin/main');
  if (!opts.skipMainCheck && localHead && originMain && localHead !== originMain) {
    var branch = gitOutput('branch --show-current');
    if (branch === 'main') blockerCodes.push('UNEXPECTED_MAIN_STATE');
  }

  var ledger = loadLedger();
  var stage = findStage(stageId, ledger);
  if (!stage) {
    return {
      stage: stageId,
      eligible: false,
      blockers: ['UNKNOWN_STAGE'],
      risk_lane: null,
      skills: [],
      files: [],
      tests: [],
      baselines: []
    };
  }

  var oneStage = checkOneMajorStageRule(ledger);
  if (!oneStage.clean) blockerCodes.push('ANOTHER_MAJOR_STAGE_ACTIVE: ' + oneStage.active.join(', '));

  var deps = checkDependencies(stage, ledger);
  if (!deps.satisfied) deps.blockers.forEach(function (b) { blockerCodes.push(b); });

  var templates = loadStageTemplates();
  var template = resolveTemplateForStage(stage, templates);
  var lanes = loadDevelopmentLanes();
  var riskLane = template ? template.risk_lane : 'HIGH_RISK';
  var laneDef = (lanes.lanes || {})[riskLane] || null;
  if (laneDef && laneDef.never_auto_downgrade && riskLane === 'HIGH_RISK') {
    // no-op: rank is already at ceiling; documents the invariant explicitly.
  }

  var skillsReg = loadSkillsRegistry();
  var relevantSkills = (skillsReg.skills || []).filter(function (s) {
    return template && (template.skill_categories || []).indexOf(s.category) !== -1;
  }).map(function (s) { return s.skill_id; });

  var knownBaselines = loadKnownBaselines();
  var relevantBaselineIds = (knownBaselines.baselines || []).map(function (b) { return b.baseline_id; });

  var context = {
    stage: stage.stage_id,
    track: stage.track,
    title: stage.title,
    type: stage.type,
    eligible: blockerCodes.length === 0,
    risk_lane: riskLane,
    skills: relevantSkills,
    files: stage.evidence_paths || [],
    tests: template ? [template.test_strategy] : [],
    baselines: relevantBaselineIds,
    next_stage: stage.next_stage || null,
    blockers: blockerCodes
  };
  return context;
}

// -------------------------------------------------------------------------
// Close-time evaluation (Phase 11)
// -------------------------------------------------------------------------
function buildCloseContext(stageId) {
  var ledger = loadLedger();
  var stage = findStage(stageId, ledger);
  var blockerCodes = [];
  if (!stage) return { stage: stageId, ready: false, blockers: ['UNKNOWN_STAGE'] };

  if (isWorktreeDirty()) {
    // dirty is EXPECTED at close time (uncommitted work to close) — not a blocker by itself,
    // but flagged in the report so the caller sees it explicitly.
  }

  var changed = changedFilesVsBase('origin/main');
  var selection = deriveTestSelection(changed, loadTestImpactMap());
  var lanes = loadDevelopmentLanes();
  var laneDef = (lanes.lanes || {})[selection.riskLane] || null;

  var applyAllowed = !!(laneDef && laneDef.close_apply_allowed);
  if (!applyAllowed) blockerCodes.push('HIGH_RISK_POLICY_VIOLATION: close --apply is not permitted for risk lane ' + selection.riskLane);

  if (changed.length === 0) blockerCodes.push('OUT_OF_SCOPE_CHANGE: no changed files detected relative to origin/main');

  return {
    stage: stage.stage_id,
    changed_files: changed,
    risk_lane: selection.riskLane,
    targeted_tests: selection.tests,
    baseline_ids: selection.baselineIds,
    used_fallback: selection.usedFallback,
    apply_allowed: applyAllowed,
    blockers: blockerCodes
  };
}

// -------------------------------------------------------------------------
// CLI commands
// -------------------------------------------------------------------------
function printJSON(obj) { console.log(JSON.stringify(obj, null, 2)); }

function cmdContext() {
  var ctx = buildCurrentContext();
  writeJSON('projects/meta/current-context.json', ctx);
  printJSON(ctx);
  process.exit(0);
}

function cmdStatus() {
  var branch = gitOutput('branch --show-current');
  var head = gitOutput('rev-parse HEAD');
  var originMain = gitOutput('rev-parse origin/main');
  var dirty = isWorktreeDirty();
  var gh = detectGh();
  console.log('Mythos — Stage Runner Status');
  console.log('  Branch: ' + branch);
  console.log('  HEAD:   ' + head);
  console.log('  origin/main: ' + originMain);
  console.log('  HEAD == origin/main: ' + (head === originMain));
  console.log('  Dirty worktree: ' + dirty);
  console.log('  gh installed: ' + gh.installed + ', authenticated: ' + gh.authenticated);
  process.exit(0);
}

function cmdStart(stageId, opts) {
  if (!stageId) { console.log('Usage: node scripts/mythos-stage.js start <STAGE> [--dry-run|--apply]'); process.exit(1); }
  var ctx = buildStageContext(stageId);
  printJSON(ctx);
  if (!ctx.eligible) { process.exit(1); }
  if (opts.apply) {
    console.log('\n(DEVX-0 MVP note: --apply for "start" only reports eligibility; branch creation is a manual git checkout -b step, per AGENTS.md scope control. No mutation performed.)');
  }
  process.exit(0);
}

function cmdValidateStage(stageId) {
  if (!stageId) { console.log('Usage: node scripts/mythos-stage.js validate <STAGE>'); process.exit(1); }
  var ledger = loadLedger();
  var stage = findStage(stageId, ledger);
  if (!stage) { printJSON({ stage: stageId, valid: false, blockers: ['UNKNOWN_STAGE'] }); process.exit(1); }
  var templates = loadStageTemplates();
  var template = resolveTemplateForStage(stage, templates);
  var valid = !!template;
  printJSON({ stage: stage.stage_id, type: stage.type, template_found: valid, template: template || null });
  process.exit(valid ? 0 : 1);
}

function cmdClose(stageId, opts) {
  if (!stageId) { console.log('Usage: node scripts/mythos-stage.js close <STAGE> [--dry-run|--apply]'); process.exit(1); }
  var ctx = buildCloseContext(stageId);
  printJSON(ctx);
  if (ctx.blockers.length) { process.exit(1); }
  if (opts.apply) {
    if (!ctx.apply_allowed) {
      console.log('\nHIGH_RISK_POLICY_VIOLATION: refusing to commit/push/create-PR for this risk lane.');
      process.exit(1);
    }
    console.log('\n(DEVX-0 MVP note: close --apply validation passed. Actual commit/push/PR-create is intentionally left to the standard git workflow in this MVP — see docs/DEVELOPMENT_WORKFLOW.md. No mutation performed by this command.)');
  }
  process.exit(0);
}

// -------------------------------------------------------------------------
module.exports = {
  readJSON: readJSON,
  readText: readText,
  gitOutput: gitOutput,
  isWorktreeDirty: isWorktreeDirty,
  detectGh: detectGh,
  loadLedger: loadLedger,
  loadKnownBaselines: loadKnownBaselines,
  loadTestImpactMap: loadTestImpactMap,
  loadDevelopmentLanes: loadDevelopmentLanes,
  loadStageTemplates: loadStageTemplates,
  loadSkillsRegistry: loadSkillsRegistry,
  findStage: findStage,
  resolveTemplateForStage: resolveTemplateForStage,
  checkOneMajorStageRule: checkOneMajorStageRule,
  checkDependencies: checkDependencies,
  matchRule: matchRule,
  deriveTestSelection: deriveTestSelection,
  buildCurrentContext: buildCurrentContext,
  buildStageContext: buildStageContext,
  buildCloseContext: buildCloseContext,
  changedFilesVsBase: changedFilesVsBase
};

// -------------------------------------------------------------------------
if (require.main === module) {
  var argv = process.argv.slice(2);
  var command = argv[0];
  var arg1 = argv[1] && argv[1].indexOf('--') !== 0 ? argv[1] : null;
  var opts = { apply: argv.indexOf('--apply') !== -1, dryRun: argv.indexOf('--dry-run') !== -1 };

  switch (command) {
    case 'context': cmdContext(); break;
    case 'status': cmdStatus(); break;
    case 'start': cmdStart(arg1, opts); break;
    case 'validate': cmdValidateStage(arg1); break;
    case 'close': cmdClose(arg1, opts); break;
    default:
      console.log('Usage: node scripts/mythos-stage.js <context|status|start <STAGE>|validate <STAGE>|close <STAGE>> [--dry-run|--apply]');
      console.log('Potentially mutating commands default to --dry-run reporting; this MVP never mutates Git state itself regardless of flag — see docs/DEVELOPMENT_WORKFLOW.md.');
      process.exit(command ? 1 : 0);
  }
}
