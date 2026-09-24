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
// MYTHOS V3.2 — ecosystem intelligence, read-only.
//
//   reuse "<need>"            do we already have this? scores the need
//                             against every registry the ecosystem keeps
//   project <id>              one project: deps, dependents, capabilities,
//                             OTHKM seed relationships (both directions)
//   outcomes [--store <dir>]  what an executor task store says about how
//                             each provider × role actually performed
//
// Everything printed is DATA with a `kind: "data"` envelope and a file
// citation per match. Nothing here is an instruction to the reader, nothing
// is written, nothing touches the network: this tool answers a question the
// director (or a sandboxed worker) asks before it builds; it decides nothing.
// -------------------------------------------------------------------------

var STOP = { the: 1, and: 1, for: 1, with: 1, that: 1, this: 1, from: 1, into: 1, are: 1, any: 1, can: 1, have: 1, already: 1, something: 1, what: 1, does: 1, our: 1 };
function tokens(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (t) { return t.length >= 3 && !STOP[t]; });
}
function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

// Share of the need's distinct words present in the text (prefix-tolerant, so
// "validate" finds "validation"). 0 when nothing matches.
function score(needTokens, text) {
  var hay = ' ' + tokens(text).join(' ') + ' ';
  var hit = 0;
  needTokens.forEach(function (t) {
    var stem = t.length > 6 ? t.slice(0, 6) : t;
    if (hay.indexOf(' ' + stem) !== -1) hit++;
  });
  return needTokens.length ? hit / needTokens.length : 0;
}

function seedFiles() {
  var dir = path.join(BASE, 'projects/oth-knowledge/seeds');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).sort()
    .map(function (f) { return 'projects/oth-knowledge/seeds/' + f; });
}

// Every candidate the ecosystem already records, as {source, id, file, text}.
function reuseCandidates() {
  var out = [];
  function add(source, id, file, text) { if (text) out.push({ source: source, id: id, file: file, text: String(text).replace(/\s+/g, ' ').slice(0, 600) }); }

  var reg = readJSON('projects/meta/portfolio-registry.json');
  (reg.tracks || []).forEach(function (t) {
    add('portfolio-track', t.id, 'projects/meta/portfolio-registry.json', [t.name, t.current_stage, t.notes].filter(Boolean).join(' — '));
    (t.shared_platform_capabilities || []).forEach(function (c, i) {
      add('portfolio-capability', t.id + '#' + i, 'projects/meta/portfolio-registry.json', t.name + ': ' + c);
    });
  });

  var sreg = readJSON('projects/personal-intelligence/config/agent-skills-registry.json');
  (sreg.skills || []).forEach(function (s) { add('skill', s.skill_id, s.path, s.skill_id + ': ' + s.purpose); });

  var EX = 'projects/mythos-ai-executor/config/';
  var agents = readJSON(EX + 'agents.json');
  Object.keys(agents.__missing ? {} : agents).forEach(function (k) {
    var a = agents[k];
    add('agent', k, EX + 'agents.json', k + ' (' + a.provider + '): ' + (a.capabilities || []).join(', ') + '. ' + (a.note || ''));
  });
  var roles = readJSON(EX + 'roles.json');
  Object.keys((roles && roles.roles) || {}).forEach(function (k) { add('role', k, EX + 'roles.json', k + ': ' + roles.roles[k].brief); });
  var packs = readJSON(EX + 'skills.json');
  Object.keys(packs.__missing ? {} : packs).forEach(function (k) {
    var p = packs[k] || {};
    add('skill-pack', k, EX + 'skills.json', k + ': ' + [p.description, p.category, (p.task_categories || []).join(' ')].filter(Boolean).join(' '));
  });
  var tools = readJSON(EX + 'tools.json');
  Object.keys(tools.__missing ? {} : tools).forEach(function (k) { add('tool', k, EX + 'tools.json', k + ': ' + ((tools[k] || {}).description || '')); });
  var mcp = readJSON(EX + 'mcp-capabilities.json');
  Object.keys((mcp && mcp.servers) || {}).forEach(function (k) {
    var s = mcp.servers[k];
    add('mcp-server', k, EX + 'mcp-capabilities.json', k + ': ' + (s.description || '') + ' ' + JSON.stringify(s.tools || '').slice(0, 300));
  });

  seedFiles().forEach(function (file) {
    var seed = readJSON(file);
    if (seed.__missing || seed.__parseError) return;
    var nameByKey = {};
    (seed.entities || []).forEach(function (e) {
      nameByKey[e.key] = e.name;
      add('othkm-entity', e.key, file, e.name + ' (' + e.entity_type + ') ' + JSON.stringify(e.metadata || {}));
    });
    (seed.claims || []).forEach(function (c) { add('othkm-claim', c.key, file, c.statement); });
    (seed.relationships || []).forEach(function (r, i) {
      add('othkm-relationship', r.from + '>' + r.to, file, (nameByKey[r.from] || r.from) + ' ' + r.rel_type + ' ' + (nameByKey[r.to] || r.to) + ' — ' + (r.asserted_by || ''));
    });
  });
  return out;
}

function printData(obj) { console.log(JSON.stringify(Object.assign({ kind: 'data', note: 'data from committed registries and seeds; cite the file, decide nothing from it alone' }, obj), null, 2)); }

function cmdReuse(need) {
  if (!need || !String(need).trim()) { console.log('Usage: node scripts/project-intelligence.js reuse "<capability you need>"'); process.exit(2); }
  var q = uniq(tokens(need));
  var limit = 12;
  var matches = reuseCandidates().map(function (c) {
    return { source: c.source, id: c.id, file: c.file, score: Math.round(score(q, c.text) * 100) / 100, text: c.text };
  }).filter(function (m) { return m.score > 0; })
    .sort(function (a, b) { return b.score - a.score || a.source.localeCompare(b.source) || String(a.id).localeCompare(String(b.id)); })
    .slice(0, limit);
  printData({ query: String(need).slice(0, 200), terms: q, sources_searched: ['portfolio-registry', 'agent-skills-registry', 'executor agents/roles/skill-packs/tools/mcp', 'othkm seeds'], matches: matches });
  process.exit(0);
}

function cmdProject(id) {
  var reg = readJSON('projects/meta/portfolio-registry.json');
  var t = (reg.tracks || []).filter(function (x) { return x.id === id; })[0];
  if (!t) { printData({ project: id, found: false, known: (reg.tracks || []).map(function (x) { return x.id; }) }); process.exit(1); }
  var dependents = (reg.tracks || []).filter(function (x) { return (x.dependencies || []).indexOf(id) !== -1; }).map(function (x) { return x.id; });
  var relationships = [];
  seedFiles().forEach(function (file) {
    var seed = readJSON(file);
    if (seed.__missing || seed.__parseError) return;
    var byKey = {};
    (seed.entities || []).forEach(function (e) { byKey[e.key] = e; });
    var mine = Object.keys(byKey).filter(function (k) { var e = byKey[k]; return (e.metadata && e.metadata.registry_id === id) || e.name === id; });
    (seed.relationships || []).forEach(function (r) {
      if (mine.indexOf(r.from) !== -1) relationships.push({ dir: 'out', rel_type: r.rel_type, other: byKey[r.to] ? byKey[r.to].name : r.to, asserted_by: r.asserted_by || null, file: file });
      else if (mine.indexOf(r.to) !== -1) relationships.push({ dir: 'in', rel_type: r.rel_type, other: byKey[r.from] ? byKey[r.from].name : r.from, asserted_by: r.asserted_by || null, file: file });
    });
  });
  printData({
    project: id, found: true, name: t.name, category: t.category, implementation_status: t.implementation_status,
    current_stage: t.current_stage, next_stage: t.next_stage, repository_paths: t.repository_paths,
    dependencies: t.dependencies || [], dependents: dependents,
    shared_platform_capabilities: t.shared_platform_capabilities || [], notes: t.notes || null,
    relationships: relationships
  });
  process.exit(0);
}

function cmdOutcomes(argv) {
  var i = argv.indexOf('--store');
  var store = i !== -1 ? argv[i + 1] : (process.env.MYTHOS_EXECUTOR_HOME || path.join(require('os').homedir(), 'mythos-ai-executor-haddad'));
  var tasksDir = path.join(store, 'tasks');
  if (!fs.existsSync(tasksDir)) { printData({ store: store, found: false }); process.exit(1); }
  function j(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
  var groups = {};
  fs.readdirSync(tasksDir).forEach(function (id) {
    var d = path.join(tasksDir, id);
    var task = j(path.join(d, 'task.json')), st = j(path.join(d, 'status.json'));
    if (!task || !st) return;
    var rep = j(path.join(d, 'report.json')) || {};
    var ev = rep.evidence || {};
    var key = (st.provider_used || task.provider || 'unknown') + ' × ' + (task.role || '(no role)');
    var g = groups[key] = groups[key] || { n: 0, status: {}, with_evidence: 0, repair_rounds_sum: 0, diagnosis: 0, mechanically_verified: 0, context_exhausted: 0, projects: {} };
    g.n++;
    g.status[st.status] = (g.status[st.status] || 0) + 1;
    g.projects[task.project || 'unknown'] = (g.projects[task.project || 'unknown'] || 0) + 1;
    if (typeof ev.repair_rounds === 'number') { g.with_evidence++; g.repair_rounds_sum += ev.repair_rounds; }
    if (ev.diagnosis_requested) g.diagnosis++;
    if (ev.validation && ev.validation.evidence && ev.validation.evidence.mechanically_verified) g.mechanically_verified++;
    if (/CONTEXT_EXHAUSTED/.test(String(st.last_error || ''))) g.context_exhausted++;
  });
  var rows = Object.keys(groups).sort().map(function (k) {
    var g = groups[k];
    return { provider_role: k, n: g.n, status: g.status, projects: g.projects,
      mean_repair_rounds: g.with_evidence ? Math.round(g.repair_rounds_sum / g.with_evidence * 100) / 100 : null,
      diagnosis_requested: g.diagnosis, mechanically_verified: g.mechanically_verified, context_exhausted: g.context_exhausted };
  });
  var reputation = j(path.join(store, 'reputation.json'));
  printData({ store: store, groups: rows, reputation: reputation || {} });
  process.exit(0);
}

var command = process.argv[2];
switch (command) {
  case 'validate': cmdValidate(); break;
  case 'stats': cmdStats(); break;
  case 'history-check': cmdHistoryCheck(); break;
  case 'ledger-check': cmdLedgerCheck(); break;
  case 'summary': cmdSummary(); break;
  case 'reuse': cmdReuse(process.argv.slice(3).join(' ')); break;
  case 'project': cmdProject(process.argv[3]); break;
  case 'outcomes': cmdOutcomes(process.argv.slice(3)); break;
  default:
    console.log('Usage: node scripts/project-intelligence.js <validate|stats|history-check|ledger-check|summary|reuse "<need>"|project <id>|outcomes [--store <dir>]>');
    console.log('This tool is read-only against Git metadata; it never modifies Git history, auto-commits, or connects to any external provider.');
    process.exit(command ? 1 : 0);
}
