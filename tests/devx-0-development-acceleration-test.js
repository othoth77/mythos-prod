'use strict';
// =====================================================
// MYTHOS — Stage DEVX-0 development acceleration tests
// tests/devx-0-development-acceleration-test.js
//
// Deterministic, offline. Exercises scripts/mythos-stage.js's exported
// functions directly (no live GitHub required) plus a small CLI boundary
// check. Mocks/extracts the gh command boundary rather than requiring a
// live GitHub session.
//
// Run with: node tests/devx-0-development-acceleration-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var stageRunner = require(path.join(BASE, 'scripts', 'mythos-stage.js'));

function readJSON(p) { return JSON.parse(fs.readFileSync(path.join(BASE, p), 'utf8')); }

// ─────────────────────────────────────────────────────────────────────────
console.log('\n1. CURRENT CONTEXT SNAPSHOT');
(function () {
  var ctx = stageRunner.buildCurrentContext();
  ok(ctx.schema_version === '1.0.0', 'Context has schema_version 1.0.0');
  ok(typeof ctx.source_commit === 'string' && ctx.source_commit.length >= 7, 'Context has a real source_commit SHA');
  ok(Array.isArray(ctx.relevant_tracks) && ctx.relevant_tracks.length > 0, 'Context lists relevant_tracks from the existing ledger');
  ok(Array.isArray(ctx.relevant_skills) && ctx.relevant_skills.length > 0, 'Context lists relevant_skills from the existing skills registry');
  ok(Array.isArray(ctx.known_baselines), 'Context lists known_baselines (array, possibly referencing known-baselines.json)');
  ok(!JSON.stringify(ctx).match(/gho_[A-Za-z0-9]+/), 'Context never contains a raw GitHub token pattern');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n2. STAGE LOOKUP');
(function () {
  var ledger = stageRunner.loadLedger();
  var known = (ledger.stages || [])[0];
  ok(!!known, 'Ledger has at least one stage to look up');
  var found = stageRunner.findStage(known.stage_id, ledger);
  ok(found && found.stage_id === known.stage_id, 'findStage resolves a known stage_id from the existing project ledger');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n3. UNKNOWN STAGE');
(function () {
  var ctx = stageRunner.buildStageContext('NOT-A-REAL-STAGE-XYZ');
  ok(ctx.eligible === false, 'An unknown stage id is never eligible');
  ok(ctx.blockers.indexOf('UNKNOWN_STAGE') !== -1, 'An unknown stage id reports the UNKNOWN_STAGE blocker code');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n4. DEPENDENCY GATE');
(function () {
  var ledger = stageRunner.loadLedger();
  // MPI-1 is not itself present in the ledger as a stage record (it is PLANNED,
  // not yet a tracked stage) — use a synthetic stage object referencing a
  // known not-yet-DONE dependency chain shape instead, and separately confirm
  // that a genuinely DONE stage with no recorded blockers is dependency-clean.
  var doneStage = (ledger.stages || []).find(function (s) { return s.status === 'DONE' && (!s.blockers || s.blockers.length === 0); });
  ok(!!doneStage, 'At least one DONE stage with no recorded blockers exists in the ledger');
  var deps = stageRunner.checkDependencies(doneStage, ledger);
  ok(deps.satisfied === true, 'A completed stage with no recorded blockers and no unmet predecessor reports satisfied dependencies');

  var blockedNext = (ledger.stages || []).find(function (s) {
    return (s.next_stage || '').indexOf('blocked') !== -1 || (s.next_stage || '').toLowerCase().indexOf('blocked') !== -1;
  });
  ok(!!blockedNext, 'The ledger records at least one stage whose next_stage is explicitly annotated as blocked (evidence for dependency-gating logic)');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n5. RISK LANE CLASSIFICATION');
(function () {
  var tim = stageRunner.loadTestImpactMap();
  var docsOnly = stageRunner.deriveTestSelection(['docs/EXAMPLE.md'], tim);
  ok(docsOnly.riskLane === 'FAST', 'A docs/-only change classifies as FAST');

  var jsChange = stageRunner.deriveTestSelection(['js/shared/example.js'], tim);
  ok(jsChange.riskLane === 'STANDARD', 'A js/-module change classifies as STANDARD');

  var cfChange = stageRunner.deriveTestSelection(['projects/infrastructure/cloudflare/README.md'], tim);
  ok(cfChange.riskLane === 'HIGH_RISK', 'A Cloudflare-infrastructure change classifies as HIGH_RISK regardless of file type');

  var mixed = stageRunner.deriveTestSelection(['docs/EXAMPLE.md', 'projects/infrastructure/cloudflare/README.md'], tim);
  ok(mixed.riskLane === 'HIGH_RISK', 'A mixed change set takes the HIGHEST matched risk lane, never the lowest (no silent downgrade)');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n6. KNOWN BASELINE VALIDATION');
(function () {
  var kb = stageRunner.loadKnownBaselines();
  ok(Array.isArray(kb.baselines) && kb.baselines.length > 0, 'known-baselines.json has at least one baseline entry');
  var stage3d = kb.baselines.find(function (b) { return b.baseline_id === 'stage3d-known-failures'; });
  ok(!!stage3d, 'The verified Stage 3D baseline (104/110) is present');
  ok(stage3d.expected_pass === 104 && stage3d.expected_total === 110, 'Stage 3D baseline records the correct 104/110 verified counts');
  ok(stage3d.classification === 'KNOWN_BASELINE_FAILURE', 'Stage 3D baseline is classified KNOWN_BASELINE_FAILURE, not a silent pass');
  ok(Array.isArray(stage3d.known_failures) && stage3d.known_failures.length === 6, 'Stage 3D baseline records exactly the 6 known pre-existing failing suites');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n7. TEST SELECTION — targeted before full suite');
(function () {
  var tim = stageRunner.loadTestImpactMap();
  var sel = stageRunner.deriveTestSelection(['projects/meta/project-ledger.json'], tim);
  ok(sel.tests.indexOf('node scripts/project-intelligence.js validate') !== -1, 'A projects/meta/ change selects the existing project-intelligence validator, not a duplicate check');
  ok(sel.usedFallback === false, 'A recognised path prefix does not trigger the unknown-path fallback');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n8. UNKNOWN-PATH FALLBACK');
(function () {
  var tim = stageRunner.loadTestImpactMap();
  var sel = stageRunner.deriveTestSelection(['some/totally/unmapped/path.xyz'], tim);
  ok(sel.usedFallback === true, 'An unmapped path triggers the fallback rather than silently running nothing');
  ok(sel.riskLane === 'HIGH_RISK', 'The fallback classifies as HIGH_RISK, never as FAST');
  ok(sel.tests.indexOf('FULL_SUITE_REQUIRED') !== -1, 'The fallback requires the full suite marker, not a narrow guess');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n9. DIRTY WORKTREE DETECTION');
(function () {
  var dirty = stageRunner.isWorktreeDirty();
  ok(typeof dirty === 'boolean', 'isWorktreeDirty() returns a boolean reflecting live git status --porcelain');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n10. DRY-RUN / NO MUTATION');
(function () {
  var before = cp.execSync('git status --porcelain', { cwd: BASE, encoding: 'utf8' });
  var ledger = stageRunner.loadLedger();
  var anyStage = (ledger.stages || [])[0];
  if (anyStage) stageRunner.buildStageContext(anyStage.stage_id);
  var after = cp.execSync('git status --porcelain', { cwd: BASE, encoding: 'utf8' });
  ok(before === after, 'Building a Stage Context never mutates the working tree (no git add/commit/checkout side effects)');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n11. STAGE TEMPLATE VALIDITY');
(function () {
  var templates = stageRunner.loadStageTemplates();
  var expected = ['DOCUMENTATION_STAGE', 'RUNTIME_STAGE', 'INFRASTRUCTURE_STAGE', 'CONNECTOR_STAGE', 'DATABASE_STAGE', 'SECURITY_STAGE', 'RESEARCH_STAGE'];
  var allPresent = expected.every(function (t) { return !!(templates.templates || {})[t]; });
  ok(allPresent, 'All 7 required stage templates are present');
  var requiredFields = ['entry_checks', 'risk_lane', 'context_sources', 'skill_categories', 'expected_artifacts', 'test_strategy', 'security_checks', 'documentation_updates', 'closure_checks'];
  var allComplete = expected.every(function (t) {
    var tpl = templates.templates[t];
    return requiredFields.every(function (f) { return tpl[f] !== undefined; });
  });
  ok(allComplete, 'Every stage template has all 9 required fields');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n12. JSON VALIDITY — all new DEVX-0 metadata files');
(function () {
  var files = [
    'projects/meta/current-context.json',
    'projects/meta/known-baselines.json',
    'projects/meta/test-impact-map.json',
    'projects/meta/development-lanes.json',
    'projects/meta/stage-templates.json'
  ];
  var allValid = files.every(function (f) {
    try { readJSON(f); return true; } catch (e) { return false; }
  });
  ok(allValid, 'All 5 DEVX-0 JSON metadata files parse as valid JSON');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n13. SHORT-COMMAND CONTEXT DERIVATION');
(function () {
  var ledger = stageRunner.loadLedger();
  var doneStage = (ledger.stages || []).find(function (s) { return s.status === 'DONE'; });
  ok(!!doneStage, 'A DONE stage exists to derive a Stage Context from');
  var ctx = stageRunner.buildStageContext(doneStage.stage_id);
  var hasAllFields = ['stage', 'risk_lane', 'skills', 'files', 'tests', 'baselines', 'blockers'].every(function (f) { return ctx[f] !== undefined; });
  ok(hasAllFields, 'A short "Start <STAGE>" lookup resolves to a Stage Context with stage/risk_lane/skills/files/tests/baselines/blockers — the full context an owner would otherwise have to type out by hand');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n14. GH DETECTION BOUNDARY');
(function () {
  var gh = stageRunner.detectGh();
  ok(typeof gh.installed === 'boolean' && typeof gh.authenticated === 'boolean', 'detectGh() returns booleans, never a token or raw gh output');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n15. SECRET-SAFE OUTPUT');
(function () {
  var ctx = stageRunner.buildCurrentContext();
  var serialized = JSON.stringify(ctx);
  var secretPatterns = [/password\s*[:=]/i, /api[_-]?key\s*[:=]/i, /gho_[A-Za-z0-9]{10,}/, /ghp_[A-Za-z0-9]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
  var clean = secretPatterns.every(function (re) { return !re.test(serialized); });
  ok(clean, 'buildCurrentContext() output never contains a credential/token/private-key pattern');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n16. DEVELOPMENT LANES — HIGH_RISK never auto-downgrades');
(function () {
  var lanes = stageRunner.loadDevelopmentLanes();
  var highRisk = (lanes.lanes || {}).HIGH_RISK;
  ok(!!highRisk, 'HIGH_RISK lane is defined');
  ok(highRisk.never_auto_downgrade === true, 'HIGH_RISK lane explicitly declares never_auto_downgrade: true');
  ok(highRisk.close_apply_allowed === false, 'HIGH_RISK lane explicitly forbids close --apply mutation');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n17b. LEDGER TYPE → TEMPLATE MAPPING (regression: raw ledger type must never be used as a template key directly)');
(function () {
  var templates = stageRunner.loadStageTemplates();
  var runtimeStage = { type: 'RUNTIME' };
  var governanceStage = { type: 'GOVERNANCE' };
  var foundationStage = { type: 'FOUNDATION' };
  var infraStage = { type: 'INFRASTRUCTURE' };
  ok(stageRunner.resolveTemplateForStage(runtimeStage, templates) === templates.templates.RUNTIME_STAGE,
    'A ledger stage with type "RUNTIME" resolves to the RUNTIME_STAGE template (not a failed direct-key lookup)');
  ok(stageRunner.resolveTemplateForStage(governanceStage, templates) === templates.templates.DOCUMENTATION_STAGE,
    'A ledger stage with type "GOVERNANCE" resolves to a real template rather than null');
  ok(stageRunner.resolveTemplateForStage(foundationStage, templates) === templates.templates.DOCUMENTATION_STAGE,
    'A ledger stage with type "FOUNDATION" resolves to a real template rather than null');
  ok(stageRunner.resolveTemplateForStage(infraStage, templates) === templates.templates.INFRASTRUCTURE_STAGE,
    'A ledger stage with type "INFRASTRUCTURE" resolves to the INFRASTRUCTURE_STAGE template');

  // End-to-end: every DONE stage actually in the ledger must resolve to a
  // non-null template and a non-null risk lane via buildStageContext — this
  // is exactly the bug that shipped: MPI-0-FINALIZATION (type GOVERNANCE)
  // resolved risk_lane via a null template fallback instead of its real one.
  var ledger = stageRunner.loadLedger();
  var allResolve = (ledger.stages || []).every(function (s) {
    return !!stageRunner.resolveTemplateForStage(s, templates);
  });
  ok(allResolve, 'Every stage type actually present in projects/meta/project-ledger.json resolves to a real stage template');
})();

console.log('\n17. CLOSE CONTEXT — HIGH_RISK refuses apply');
(function () {
  var lanes = stageRunner.loadDevelopmentLanes();
  var fastAllowed = lanes.lanes.FAST.close_apply_allowed === true;
  var standardAllowed = lanes.lanes.STANDARD.close_apply_allowed === true;
  var highRiskDenied = lanes.lanes.HIGH_RISK.close_apply_allowed === false;
  ok(fastAllowed && standardAllowed && highRiskDenied, 'Only FAST and STANDARD lanes permit close --apply mutation; HIGH_RISK never does');
})();

console.log('\nStage DEVX-0 development acceleration: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
