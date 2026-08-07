'use strict';
// =====================================================
// MYTHOS — Stage MPI-0-FINALIZATION governance tests
// tests/mpi-0-finalization-governance-test.js
//
// Validates the project-intelligence infrastructure added in
// MPI-0-FINALIZATION: portfolio registry, skills registry, project ledger,
// statistics, and daily history — deterministic, offline, no network.
//
// Run with: node tests/mpi-0-finalization-governance-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

function readJSON(p) { return JSON.parse(fs.readFileSync(path.join(BASE, p), 'utf8')); }
function readText(p) { return fs.readFileSync(path.join(BASE, p), 'utf8'); }

// ─────────────────────────────────────────────────────────────────────────
console.log('\n1. PORTFOLIO REGISTRY — schema and consistency');
(function () {
  var reg = readJSON('projects/meta/portfolio-registry.json');
  ok(Array.isArray(reg.tracks) && reg.tracks.length > 0, 'Portfolio registry has a non-empty tracks array');
  var validEvidence = { REPOSITORY_VERIFIED: 1, OWNER_DIRECTION: 1, FUTURE_CONCEPT: 1 };
  var allValid = reg.tracks.every(function (t) { return validEvidence[t.evidence_status]; });
  ok(allValid, 'Every track has a valid evidence_status enum value');
  var ids = reg.tracks.map(function (t) { return t.id; });
  ok(new Set(ids).size === ids.length, 'No duplicate portfolio track ids');
  var fixpert = reg.tracks.find(function (t) { return t.id === 'fixpert'; });
  ok(fixpert && fixpert.evidence_status === 'OWNER_DIRECTION', 'Fixpert is correctly classified OWNER_DIRECTION, not falsely REPOSITORY_VERIFIED as an implemented product');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n2. SKILLS REGISTRY — matches actual .claude/skills/ directories');
(function () {
  var reg = readJSON('projects/personal-intelligence/config/agent-skills-registry.json');
  var skillsDir = path.join(BASE, '.claude/skills');
  var onDisk = fs.readdirSync(skillsDir).filter(function (d) {
    return fs.statSync(path.join(skillsDir, d)).isDirectory();
  });
  var regIds = reg.skills.map(function (s) { return s.skill_id; });

  ok(onDisk.length === regIds.length, 'Registry entry count (' + regIds.length + ') matches on-disk skill directory count (' + onDisk.length + ')');
  ok(onDisk.every(function (id) { return regIds.indexOf(id) !== -1; }), 'Every on-disk skill directory is registered');
  ok(regIds.every(function (id) { return onDisk.indexOf(id) !== -1; }), 'Every registry entry points to an existing skill directory');
  ok(new Set(regIds).size === regIds.length, 'No duplicate skill IDs in the registry');

  var validClassifications = { UPSTREAM_ORIGINAL: 1, MYTHOS_WRAPPER: 1, MYTHOS_ORIGINAL: 1 };
  ok(reg.skills.every(function (s) { return validClassifications[s.classification]; }), 'Every skill has a valid source classification');

  var semverRe = /^\d+\.\d+\.\d+$/;
  ok(reg.skills.every(function (s) { return semverRe.test(s.version); }), 'Every skill has a valid MAJOR.MINOR.PATCH version string');

  ok(reg.skills.every(function (s) { return s.runtime_skill === false; }), 'Every current skill is explicitly marked runtime_skill: false');

  var deprecated = reg.skills.filter(function (s) { return s.status === 'DEPRECATED'; });
  ok(deprecated.length === 0, 'No skill is DEPRECATED in this stage (none was deprecated by the audit)');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n3. PROJECT LEDGER — validity');
(function () {
  var ledger = readJSON('projects/meta/project-ledger.json');
  ok(Array.isArray(ledger.stages) && ledger.stages.length > 0, 'Ledger has a non-empty stages array');

  var shaFormat = /^[0-9a-f]{7,40}$/;
  var shaFields = ['starting_head', 'implementation_commit', 'merge_commit', 'handover_commit'];
  var allShasValid = ledger.stages.every(function (s) {
    return shaFields.every(function (f) {
      return s[f] === null || shaFormat.test(s[f]);
    });
  });
  ok(allShasValid, 'Every non-null commit SHA field matches a valid SHA-shaped string (no fabricated placeholder values)');

  var validStatus = { DONE: 1, DONE_PENDING_MERGE: 1, IN_PROGRESS: 1, PLANNED: 1, BLOCKED: 1 };
  ok(ledger.stages.every(function (s) { return validStatus[s.status]; }), 'Every stage has a valid status enum value');

  var keys = ledger.stages.map(function (s) { return s.track + '/' + s.stage_id; });
  ok(new Set(keys).size === keys.length, 'No duplicate track/stage_id pairs in the ledger');

  var mpi0 = ledger.stages.find(function (s) { return s.stage_id === 'MPI-0'; });
  ok(mpi0 && mpi0.status === 'DONE_PENDING_MERGE', 'MPI-0 is recorded as DONE_PENDING_MERGE, not falsely as fully merged, while PR #4 remains open');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n4. PROJECT STATISTICS — formula validation and no fake global percentage');
(function () {
  var stats = readJSON('projects/meta/project-statistics.json');
  ok(Array.isArray(stats.statistics) && stats.statistics.length > 0, 'Statistics array is non-empty');

  var requiredFields = ['name', 'value', 'unit', 'scope', 'source', 'generated_at', 'source_commit'];
  var allComplete = stats.statistics.every(function (s) {
    return requiredFields.every(function (f) { return s[f] !== undefined; });
  });
  ok(allComplete, 'Every statistic has name/value/unit/scope/source/generated_at/source_commit');

  var mpiRatio = stats.statistics.find(function (s) { return s.name === 'mpi_roadmap_stage_ratio'; });
  ok(mpiRatio && /NOT PRODUCT COMPLETION ESTIMATE/.test(mpiRatio.unit), 'The MPI roadmap ratio is explicitly labelled as a roadmap-stage ratio, not a product completion estimate');
  ok(mpiRatio && mpiRatio.formula && mpiRatio.formula.indexOf('/') !== -1, 'The MPI roadmap ratio documents its formula');

  var noFakeGlobalPercent = !stats.statistics.some(function (s) {
    return /^mythos.*complete/i.test(s.name) || /^\d+%$/.test(String(s.value));
  });
  ok(noFakeGlobalPercent, 'No statistic is a bare "Mythos is X% complete" style single global number');

  ok(stats.scoping_note && stats.scoping_note.length > 0, 'A top-level scoping_note is present explaining ratios are not completion estimates');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n5. DAILY HISTORY — chronological ordering, no duplicate dates, no fabrication markers');
(function () {
  var text = readText('docs/history/DAILY_HISTORY.md');
  var dateRe = /^## (\d{4}-\d{2}-\d{2})$/gm;
  var dates = [];
  var m;
  while ((m = dateRe.exec(text)) !== null) dates.push(m[1]);

  ok(dates.length > 0, 'At least one dated entry exists in DAILY_HISTORY.md');
  ok(new Set(dates).size === dates.length, 'No duplicate date sections in DAILY_HISTORY.md');

  var ascending = true;
  for (var i = 1; i < dates.length; i++) {
    if (dates[i] <= dates[i - 1]) { ascending = false; break; }
  }
  ok(ascending, 'Dated entries are in strictly ascending chronological order');

  ok(text.indexOf('HISTORICAL_CONFLICT') !== -1, 'At least one HISTORICAL_CONFLICT is recorded where evidence genuinely conflicts (2026-07-31), rather than silently picking one source');
  ok(text.toLowerCase().indexOf('chatgpt') === -1, 'No raw private chat-log content (e.g. ChatGPT) is present in the project history');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n6. PROJECT MEMORY vs USER MEMORY — no owner personal data in project history');
(function () {
  var files = ['docs/PROJECT_HISTORY.md', 'docs/history/DAILY_HISTORY.md', 'docs/PROJECT_STATUS.md', 'docs/PROJECT_STATISTICS.md'];
  var emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/;
  var phoneRe = /\b\d{8,}\b/;
  var clean = files.every(function (f) {
    var text = readText(f);
    return !emailRe.test(text) && !phoneRe.test(text);
  });
  ok(clean, 'No personal email address or phone-number-shaped string in any project-history document');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n7. DETERMINISTIC TOOL — offline, no network, no auto-commit');
(function () {
  var toolSrc = readText('scripts/project-intelligence.js');
  ok(toolSrc.indexOf('require(\'http') === -1 && toolSrc.indexOf('require("http') === -1, 'Tool does not require any HTTP client module (no network dependency)');
  ok(toolSrc.indexOf('git commit') === -1 && toolSrc.indexOf('git push') === -1, 'Tool never invokes git commit or git push');
  ok(toolSrc.indexOf('git add') === -1, 'Tool never invokes git add');

  var result = cp.spawnSync(process.execPath, ['scripts/project-intelligence.js', 'validate'], { cwd: BASE, encoding: 'utf8' });
  ok(result.status === 0, 'scripts/project-intelligence.js validate exits 0 (all registries/ledger/history/statistics currently consistent)');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n8. SKILLS EVOLUTION DOC — overlap table replaces the false "no overlap" claim');
(function () {
  var evolutionDoc = readText('docs/SKILLS_EVOLUTION.md');
  ok(evolutionDoc.indexOf('mythos-project-context') !== -1 && evolutionDoc.indexOf('mythos-repo-guardian') !== -1,
    'SKILLS_EVOLUTION.md documents the project-context/repo-guardian overlap resolution');
  ok(evolutionDoc.indexOf('mythos-skill-evolution') !== -1 && evolutionDoc.indexOf('mythos-project-history') !== -1,
    'SKILLS_EVOLUTION.md documents the rationale for both new skills');

  var sourcesDoc = readText('docs/SKILLS_SOURCES.md');
  ok(sourcesDoc.indexOf('None duplicates another') === -1, 'The old false "no overlap" claim has been removed from SKILLS_SOURCES.md');
})();

console.log('\nStage MPI-0-FINALIZATION governance: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
