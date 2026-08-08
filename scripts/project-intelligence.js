#!/usr/bin/env node
// =====================================================
// Mythos — Project Intelligence Tool
// scripts/project-intelligence.js
//
// Deterministic, offline, dependency-free (Node built-ins only) tool that
// reads local Git metadata and repository documentation to validate:
//   - the machine-readable project ledger  (projects/meta/project-ledger.json)
//   - project statistics                    (projects/meta/project-statistics.json)
//   - the portfolio registry                (projects/meta/portfolio-registry.json)
//   - the agent skills registry             (projects/personal-intelligence/config/agent-skills-registry.json)
//   - current status/summary metadata
//
// This tool NEVER:
//   - modifies Git history,
//   - auto-commits,
//   - connects to any external provider,
//   - writes generated metadata unless explicitly invoked to do so.
//
// Commands:
//   node scripts/project-intelligence.js validate       — full consistency check (check-only, CI-suitable)
//   node scripts/project-intelligence.js stats           — print current statistics
//   node scripts/project-intelligence.js history-check    — verify DAILY_HISTORY.md chronological ordering
//   node scripts/project-intelligence.js ledger-check      — verify project-ledger.json shape/uniqueness
//   node scripts/project-intelligence.js summary            — one-screen human summary
// =====================================================
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');

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

function gitOutput(args) {
  try {
    return cp.execSync('git ' + args, { cwd: BASE, encoding: 'utf8' }).trim();
  } catch (e) {
    return null;
  }
}

var errors = [];
var warnings = [];
function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

// -------------------------------------------------------------------------
function checkSkillsRegistry() {
  var registryPath = 'projects/personal-intelligence/config/agent-skills-registry.json';
  var reg = readJSON(registryPath);
  if (reg.__missing) { fail(registryPath + ' is missing'); return; }
  if (reg.__parseError) { fail(registryPath + ' is invalid JSON: ' + reg.error); return; }

  var skillsDir = path.join(BASE, '.claude/skills');
  var onDisk = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir).filter(function (d) {
        return fs.statSync(path.join(skillsDir, d)).isDirectory();
      })
    : [];

  var regIds = (reg.skills || []).map(function (s) { return s.skill_id; });
  var regIdSet = {};
  regIds.forEach(function (id) {
    if (regIdSet[id]) fail('Duplicate skill_id in registry: ' + id);
    regIdSet[id] = true;
  });

  onDisk.forEach(function (id) {
    if (!regIdSet[id]) fail('Skill directory not registered: .claude/skills/' + id);
    var skillFile = path.join(skillsDir, id, 'SKILL.md');
    if (!fs.existsSync(skillFile)) fail('.claude/skills/' + id + ' has no SKILL.md');
  });

  regIds.forEach(function (id) {
    if (onDisk.indexOf(id) === -1) fail('Registry entry has no matching directory: ' + id);
  });

  var validClassifications = { UPSTREAM_ORIGINAL: 1, MYTHOS_WRAPPER: 1, MYTHOS_ORIGINAL: 1 };
  var validStatuses = { ACTIVE: 1, EXPERIMENTAL: 1, DEPRECATED: 1 };
  (reg.skills || []).forEach(function (s) {
    if (!validClassifications[s.classification]) fail('Skill ' + s.skill_id + ' has invalid classification: ' + s.classification);
    if (!validStatuses[s.status]) fail('Skill ' + s.skill_id + ' has invalid status: ' + s.status);
    if (s.runtime_skill !== false) fail('Skill ' + s.skill_id + ' has runtime_skill !== false — every current skill must be false');
    if (!/^\d+\.\d+\.\d+$/.test(s.version || '')) fail('Skill ' + s.skill_id + ' has invalid version format: ' + s.version);
  });

  return { total: onDisk.length, registered: regIds.length };
}

// -------------------------------------------------------------------------
function checkPortfolioRegistry() {
  var p = 'projects/meta/portfolio-registry.json';
  var reg = readJSON(p);
  if (reg.__missing) { fail(p + ' is missing'); return; }
  if (reg.__parseError) { fail(p + ' is invalid JSON: ' + reg.error); return; }

  var validEvidence = { REPOSITORY_VERIFIED: 1, OWNER_DIRECTION: 1, FUTURE_CONCEPT: 1 };
  var validImpl = { ACTIVE: 1, FOUNDATION: 1, PLANNED: 1, BLOCKED: 1, CONCEPT: 1, UNKNOWN: 1 };
  var seenIds = {};
  (reg.tracks || []).forEach(function (t) {
    if (seenIds[t.id]) fail('Duplicate portfolio track id: ' + t.id);
    seenIds[t.id] = true;
    if (!validEvidence[t.evidence_status]) fail('Track ' + t.id + ' has invalid evidence_status: ' + t.evidence_status);
    if (!validImpl[t.implementation_status]) fail('Track ' + t.id + ' has invalid implementation_status: ' + t.implementation_status);
    (t.repository_paths || []).forEach(function (rp) {
      // Only check exact-existing paths; globs/prefixes (e.g. "docs/AUTOMOTIVE_*.md") are documentation shorthand, not literal.
      if (rp.indexOf('*') === -1 && !fs.existsSync(path.join(BASE, rp))) {
        warn('Track ' + t.id + ' repository_paths entry does not exist: ' + rp);
      }
    });
  });
  return { total: (reg.tracks || []).length };
}

// -------------------------------------------------------------------------
function checkLedger() {
  var p = 'projects/meta/project-ledger.json';
  var ledger = readJSON(p);
  if (ledger.__missing) { fail(p + ' is missing'); return; }
  if (ledger.__parseError) { fail(p + ' is invalid JSON: ' + ledger.error); return; }

  var shaFormat = /^[0-9a-f]{7,40}$/;
  var validStageStatus = { DONE: 1, DONE_PENDING_MERGE: 1, IN_PROGRESS: 1, PLANNED: 1, BLOCKED: 1 };
  var seenStageIds = {};
  (ledger.stages || []).forEach(function (s) {
    var key = s.track + '/' + s.stage_id;
    if (seenStageIds[key]) fail('Duplicate stage in ledger: ' + key);
    seenStageIds[key] = true;
    if (!validStageStatus[s.status]) fail('Ledger stage ' + key + ' has invalid status: ' + s.status);
    ['starting_head', 'implementation_commit', 'merge_commit', 'handover_commit'].forEach(function (field) {
      var v = s[field];
      if (v !== null && v !== undefined && !shaFormat.test(v)) {
        fail('Ledger stage ' + key + ' field ' + field + ' is not a valid SHA-shaped string: ' + v);
      }
    });
  });
  return { stages: (ledger.stages || []).length };
}

// -------------------------------------------------------------------------
function checkStatistics() {
  var p = 'projects/meta/project-statistics.json';
  var stats = readJSON(p);
  if (stats.__missing) { fail(p + ' is missing'); return; }
  if (stats.__parseError) { fail(p + ' is invalid JSON: ' + stats.error); return; }

  (stats.statistics || []).forEach(function (s) {
    ['name', 'value', 'unit', 'scope', 'source', 'generated_at', 'source_commit'].forEach(function (field) {
      if (s[field] === undefined) fail('Statistic "' + s.name + '" missing required field: ' + field);
    });
    if (/\b100%\s*complete\b/i.test(String(s.unit)) || /mythos is \d+% complete/i.test(String(s.name))) {
      fail('Statistic "' + s.name + '" looks like a misleading single global completion percentage — forbidden.');
    }
  });
  return { count: (stats.statistics || []).length };
}

// -------------------------------------------------------------------------
function checkHistoryOrdering() {
  var text = readText('docs/history/DAILY_HISTORY.md');
  if (text === null) { fail('docs/history/DAILY_HISTORY.md is missing'); return; }

  var dateRe = /^## (\d{4}-\d{2}-\d{2})$/gm;
  var dates = [];
  var m;
  while ((m = dateRe.exec(text)) !== null) dates.push(m[1]);

  var seen = {};
  dates.forEach(function (d) {
    if (seen[d]) fail('Duplicate date section in DAILY_HISTORY.md: ' + d);
    seen[d] = true;
  });

  for (var i = 1; i < dates.length; i++) {
    if (dates[i] <= dates[i - 1]) {
      fail('DAILY_HISTORY.md dates not in strictly ascending order: ' + dates[i - 1] + ' then ' + dates[i]);
    }
  }
  return { days: dates.length, dates: dates };
}

// -------------------------------------------------------------------------
function cmdValidate() {
  var skills = checkSkillsRegistry();
  var portfolio = checkPortfolioRegistry();
  var ledger = checkLedger();
  var stats = checkStatistics();
  var history = checkHistoryOrdering();

  console.log('Mythos Project Intelligence — validate');
  console.log('  Skills registered: ' + (skills ? skills.registered : 'ERROR'));
  console.log('  Portfolio tracks: ' + (portfolio ? portfolio.total : 'ERROR'));
  console.log('  Ledger stages: ' + (ledger ? ledger.stages : 'ERROR'));
  console.log('  Statistics entries: ' + (stats ? stats.count : 'ERROR'));
  console.log('  History days: ' + (history ? history.days : 'ERROR'));
  console.log('');

  if (warnings.length) {
    console.log('WARNINGS:');
    warnings.forEach(function (w) { console.log('  - ' + w); });
    console.log('');
  }

  if (errors.length) {
    console.log('ERRORS:');
    errors.forEach(function (e) { console.log('  - ' + e); });
    console.log('\n✗ validate FAILED — ' + errors.length + ' error(s)');
    process.exit(1);
  }

  console.log('✓ validate PASSED — 0 errors, ' + warnings.length + ' warning(s)');
  process.exit(0);
}

function cmdStats() {
  var stats = readJSON('projects/meta/project-statistics.json');
  if (stats.__missing || stats.__parseError) { console.error('Cannot read statistics.'); process.exit(1); }
  console.log(stats.scoping_note);
  console.log('');
  (stats.statistics || []).forEach(function (s) {
    console.log(s.name + ': ' + s.value + ' ' + s.unit + ' (scope: ' + s.scope + ')');
  });
  process.exit(0);
}

function cmdHistoryCheck() {
  var result = checkHistoryOrdering();
  if (errors.length) {
    errors.forEach(function (e) { console.log('FAIL ' + e); });
    process.exit(1);
  }
  console.log('✓ history-check PASSED — ' + (result ? result.days : 0) + ' days, chronologically ordered, no duplicates');
  process.exit(0);
}

function cmdLedgerCheck() {
  var result = checkLedger();
  if (errors.length) {
    errors.forEach(function (e) { console.log('FAIL ' + e); });
    process.exit(1);
  }
  console.log('✓ ledger-check PASSED — ' + (result ? result.stages : 0) + ' stages, no duplicates, valid SHA formats');
  process.exit(0);
}

function cmdSummary() {
  var branch = gitOutput('branch --show-current');
  var head = gitOutput('rev-parse HEAD');
  var status = readJSON('projects/meta/project-ledger.json');
  console.log('Mythos — Project Summary');
  console.log('  Branch: ' + branch);
  console.log('  HEAD:   ' + head);
  if (!status.__missing && !status.__parseError) {
    console.log('  Ledger stages: ' + (status.stages || []).length);
    console.log('  Tracks: ' + (status.tracks || []).join(', '));
  }
  console.log('  See docs/PROJECT_STATUS.md for the full human-readable snapshot.');
  process.exit(0);
}

// -------------------------------------------------------------------------
var command = process.argv[2];
switch (command) {
  case 'validate': cmdValidate(); break;
  case 'stats': cmdStats(); break;
  case 'history-check': cmdHistoryCheck(); break;
  case 'ledger-check': cmdLedgerCheck(); break;
  case 'summary': cmdSummary(); break;
  default:
    console.log('Usage: node scripts/project-intelligence.js <validate|stats|history-check|ledger-check|summary>');
    console.log('This tool is read-only against Git metadata; it never modifies Git history, auto-commits, or connects to any external provider.');
    process.exit(command ? 1 : 0);
}
