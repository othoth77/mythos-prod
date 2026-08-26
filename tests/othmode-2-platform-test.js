'use strict';
// =====================================================
// OTHMODE-2 — platform test suite
// tests/othmode-2-platform-test.js
//
// Covers the OTHMODE server layer without requiring PostgreSQL or the
// network: the store (fail-closed, append-only, evidence), the evolution
// rules (signals, selector, review gates, validation gating, terminal
// events, rollback view), the registry read models over the real
// repository files, health aggregation and recovery records, the unified
// history over fixture task dirs and a stubbed db, the memory boundary's
// fail-closed behaviour, route-level role gating and the secret gate.
// The database-backed MCC suite (tests/mcc-1-command-center-test.js)
// remains the regression floor for the library itself.
//
// Run: node tests/othmode-2-platform-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var passed = 0;
var failed = 0;
function ok(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error('  [FAIL] ' + label); }
}
function section(title) { console.log('§ ' + title); }

function tmpRoot(name) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'othmode-' + name + '-'));
  return dir;
}

// Repo root = parent of tests/
var REPO = path.resolve(__dirname, '..');
process.env.OTHMODE_REPO_ROOT = REPO;

// ---------------------------------------------------------------------------
section('store — fail-closed without provisioning');
{
  process.env.OTHMODE_STORE_ROOT = path.join(os.tmpdir(), 'othmode-absent-' + process.pid);
  var store = require('../projects/command-center/reference/othmode/store.js');
  ok(store.provisioned() === false, 'absent root reports unprovisioned');
  var mode = store.getMode();
  ok(mode.mode === 'OFF' && mode.provisioned === false, 'OthMode reads OFF fail-closed');
  var threw = false;
  try { store.appendRecord('evolution', { type: 'signal' }); } catch (e) { threw = e.code === 'OTHMODE_STORE_ABSENT'; }
  ok(threw, 'append without a store throws OTHMODE_STORE_ABSENT');
  var read = store.readStream('evolution');
  ok(read.provisioned === false && read.rows.length === 0, 'read without a store is empty with a reason');
  threw = false;
  try { store.setMode('ON', 'test'); } catch (e) { threw = e.code === 'OTHMODE_STORE_ABSENT'; }
  ok(threw, 'switch without a store refuses');
}

// ---------------------------------------------------------------------------
section('store — provisioned append/read/evidence/mode');
var STORE_ROOT = tmpRoot('store');
process.env.OTHMODE_STORE_ROOT = STORE_ROOT;
var store = require('../projects/command-center/reference/othmode/store.js');
{
  ok(store.provisioned() === true, 'provisioned store detected');
  var rec = store.appendRecord('evolution', { type: 'signal', source: 'manual', description: 'x', dedup_key: 'k', occurrences: 1, disposition: 'NOTED' });
  ok(typeof rec.id === 'string' && typeof rec.ts === 'string', 'append stamps id + ts');
  var rows = store.readStream('evolution').rows;
  ok(rows.length === 1 && rows[0].id === rec.id, 'read returns the appended record');

  var hash = store.putEvidence('evidence body');
  ok(/^[0-9a-f]{64}$/.test(hash), 'evidence is content-addressed by sha256');
  ok(store.getEvidence(hash) === 'evidence body', 'evidence reads back verbatim');
  ok(store.getEvidence('zz') === null, 'malformed evidence hash returns null, never a path read');

  var set = store.setMode('ON', 'owner');
  ok(set.mode === 'ON' && store.getMode().mode === 'ON', 'switch persists ON');
  ok(store.getMode().changed_by === 'owner', 'switch records the actor');
  store.setMode('OFF', 'owner');
  ok(store.getMode().mode === 'OFF', 'switch persists OFF');
}

// ---------------------------------------------------------------------------
section('evolution — signals: dedup, thresholding, dispositions');
var evolution = require('../projects/command-center/reference/othmode/evolution.js');
{
  var s1 = evolution.recordSignal({ source: 'tool-failure', description: 'web.search timeout', dedup_key: 'tool:web.search' }, 'claude');
  ok(s1.occurrences === 1, 'first occurrence counts 1');
  var s2 = evolution.recordSignal({ source: 'tool-failure', description: 'web.search timeout again', dedup_key: 'tool:web.search' }, 'claude');
  ok(s2.occurrences === 2, 'same dedup_key increments occurrences');
  var list = evolution.listSignals();
  ok(list.signals.filter(function (s) { return s.dedup_key === 'tool:web.search'; }).length === 1, 'dedup folds to one row');

  var single = evolution.recordSignal({ source: 'manual', description: 'one-off flake', dedup_key: 'flake:1' }, 'claude');
  var threw = false;
  try { evolution.setDisposition(single.id, 'CANDIDATE', null, 'claude'); } catch (e) { threw = true; }
  ok(threw, 'single occurrence cannot become CANDIDATE without a rationale');
  evolution.setDisposition(single.id, 'CANDIDATE', 'owner judged it systemic', 'owner');
  var after = evolution.listSignals().signals.filter(function (s) { return s.dedup_key === 'flake:1'; })[0];
  ok(after.disposition === 'CANDIDATE', 'rationale-backed promotion sticks');
  threw = false;
  try { evolution.recordSignal({ source: 'not-a-source', description: 'x' }, 'a'); } catch (e) { threw = true; }
  ok(threw, 'unknown signal source refused');
}

// ---------------------------------------------------------------------------
section('evolution — selector proposes with the preference order');
{
  ok(evolution.selectorPropose({ existing_capability: true }).verdict === 'KEEP', 'healthy existing → KEEP');
  ok(evolution.selectorPropose({ existing_capability: true, gap: 'missing X' }).verdict === 'EXTEND', 'existing + gap → EXTEND');
  ok(evolution.selectorPropose({ existing_capability: true, capability_healthy: false, overlap_with_other: true }).verdict === 'MERGE', 'overlap → MERGE');
  ok(evolution.selectorPropose({ external_solution_found: true }).verdict === 'REPLACE', 'Search First hit → REPLACE, not CREATE');
  ok(evolution.selectorPropose({ existing_capability: true, capability_healthy: false, capability_still_needed: false }).verdict === 'DEPRECATE', 'unneeded → DEPRECATE');
  ok(evolution.selectorPropose({}).verdict === 'CREATE', 'nothing found → CREATE (with the Search First caveat)');
}

// ---------------------------------------------------------------------------
section('evolution — events: stages, review gates, validation gating, terminal');
{
  var ev = evolution.createEvent({ title: 'Test evolution', risk_tier: 'HIGH', gene_type: 'routing-strategy', trigger: 'test', rollback_point: 'abc1234' }, 'claude');
  ok(!!ev.id, 'event created');
  var view = evolution.getEvent(ev.id);
  ok(view.stages.length >= 1 && view.stages[0].stage === 'TRIGGER', 'TRIGGER auto-recorded');

  var threw = false;
  try { evolution.addStage(ev.id, { stage: 'SELECTION', data: { verdict: 'CREATE' } }, 'claude', 'editor'); } catch (e) { threw = true; }
  ok(threw, 'SELECTION: CREATE without Search First evidence refused');
  evolution.addStage(ev.id, { stage: 'SELECTION', data: { verdict: 'EXTEND' } }, 'claude', 'editor');

  threw = false;
  try { evolution.addStage(ev.id, { stage: 'VALIDATION', data: { result: 'PASS' } }, 'claude', 'editor'); } catch (e) { threw = true; }
  ok(threw, 'VALIDATION before review refused on HIGH tier');

  threw = false;
  try { evolution.addStage(ev.id, { stage: 'REVIEW', data: { decision: 'APPROVED' } }, 'claude', 'editor'); } catch (e) { threw = e.code === 'OTHMODE_REVIEW_FORBIDDEN'; }
  ok(threw, 'HIGH-risk approval by a non-owner identity refused');
  evolution.addStage(ev.id, { stage: 'REVIEW', data: { decision: 'APPROVED' } }, 'owner-human', 'owner');
  ok(evolution.getEvent(ev.id).review_decision === 'APPROVED', 'owner approval recorded');

  threw = false;
  try { evolution.addStage(ev.id, { stage: 'VALIDATION', data: { result: 'PASS', dimensions: { regression: 'PASS', nonsense: 'PASS' } } }, 'claude', 'owner'); } catch (e) { threw = true; }
  ok(threw, 'unknown validation dimension refused');
  evolution.addStage(ev.id, { stage: 'VALIDATION', data: { result: 'PASS', dimensions: { regression: 'PASS', security: 'PASS' } }, evidence_texts: ['suite output: 0 new failures'] }, 'claude', 'owner');
  ok(evolution.getEvent(ev.id).validation_result === 'PASS', 'validation PASS recorded with evidence');

  evolution.addStage(ev.id, { stage: 'RESULT', data: { outcome: 'APPLIED' } }, 'owner-human', 'owner');
  ok(evolution.getEvent(ev.id).terminal === true, 'RESULT is terminal');
  threw = false;
  try { evolution.addStage(ev.id, { stage: 'VALIDATION', data: { result: 'PASS' } }, 'claude', 'owner'); } catch (e) { threw = true; }
  ok(threw, 'stages after a terminal RESULT refused — a correction is a NEW event');

  var rb = evolution.rollbackView();
  ok(rb.entries.some(function (e) { return e.event_id === ev.id && e.rollback_point === 'abc1234'; }), 'rollback view carries the git rollback point');

  // MEDIUM tier: approval requires SOME authenticated identity
  var evm = evolution.createEvent({ title: 'Medium test', risk_tier: 'MEDIUM' }, 'claude');
  threw = false;
  try { evolution.addStage(evm.id, { stage: 'REVIEW', data: { decision: 'APPROVED' } }, 'anon', null); } catch (e) { threw = e.code === 'OTHMODE_REVIEW_FORBIDDEN'; }
  ok(threw, 'MEDIUM approval without an identity refused');
  evolution.addStage(evm.id, { stage: 'REVIEW', data: { decision: 'APPROVED' } }, 'editor-user', 'editor');
  ok(evolution.getEvent(evm.id).review_decision === 'APPROVED', 'MEDIUM approval with identity accepted');
}

// ---------------------------------------------------------------------------
section('registries — read models over the real repository');
var registries = require('../projects/command-center/reference/othmode/registries.js');
{
  var skills = registries.skills();
  ok(skills.total >= 26, 'both skill registries folded (' + skills.total + ' skills, expected >= 26)');
  ok(skills.skills.some(function (s) { return s.id === 'search-first' && s.registry === 'claude'; }), 'search-first skill visible');
  ok(skills.skills.some(function (s) { return s.registry === 'executor'; }), 'executor skills visible');
  var detail = registries.skillDetail('search-first');
  ok(detail && typeof detail.body === 'string' && /BUILD[^A-Z]+LAST/.test(detail.body), 'skill detail renders SKILL.md');

  var tools = registries.tools();
  ok(tools.tools.some(function (t) { return t.id === 'git.read' && t.policy_class === 'READ'; }), 'tools registry read');

  var providers = registries.providers();
  ok(providers.providers.some(function (p) { return p.id === 'claude-code' && p.execution_authority === true && p.primary === true; }), 'claude-code is primary with execution authority');
  ok(providers.routing && providers.routing.never_for_execution_authority === true, 'router boundary surfaced');
  var leaked = JSON.stringify(providers).match(/(sk-[A-Za-z0-9]|api[_-]?key\s*[:=])/i);
  ok(!leaked, 'provider payload carries no credential-shaped content');
  providers.providers.forEach(function (p) {
    ok(typeof p.credential_present === 'boolean' || p.credential_present === null, 'credential info for ' + p.id + ' is presence-only');
  });

  var projects = registries.projects();
  ok(projects.total > 0 && projects.projects[0].id, 'portfolio tracks folded into projects');
}

// ---------------------------------------------------------------------------
section('health — monitor mapping + recovery records');
var healthMod = require('../projects/command-center/reference/othmode/health.js');
{
  var statusDir = tmpRoot('status');
  process.env.OTHMODE_STATUS_DATA_DIR = statusDir;
  fs.writeFileSync(path.join(statusDir, 'live-status.json'), JSON.stringify({
    generated_at: '2026-08-26T00:00:00Z',
    checks: [
      { id: 'hub', name: 'hub', state: 'LIVE', latency_ms: 40 },
      { id: 'db', name: 'db', state: 'DOWN', error: 'refused' },
      { id: 'x', name: 'x', state: 'NOT_MONITORED' }
    ]
  }));
  var hv = healthMod.overview();
  var byId = {};
  hv.components.forEach(function (c) { byId[c.id] = c; });
  ok(byId['monitor:hub'] && byId['monitor:hub'].state === 'ACTIVE', 'LIVE → ACTIVE');
  ok(byId['monitor:db'] && byId['monitor:db'].state === 'FAILED', 'DOWN → FAILED');
  ok(byId['monitor:x'] && byId['monitor:x'].state === 'BLOCKED', 'NOT_MONITORED → BLOCKED (never silent green)');
  ok(byId['othmode:evolution-store'] && byId['othmode:evolution-store'].state === 'ACTIVE', 'provisioned store reports ACTIVE');
  ok(hv.counts.FAILED >= 1 && hv.total === hv.components.length, 'counts add up');

  var threw = false;
  try { healthMod.recordRecoveryStep({ component: 'web.search', step: 'FLY' }, 'op'); } catch (e) { threw = true; }
  ok(threw, 'unknown recovery step refused');
  healthMod.recordRecoveryStep({ component: 'web.search', step: 'DETECT', note: '3 timeouts/hour', state: 'DEGRADED' }, 'op');
  healthMod.recordRecoveryStep({ component: 'web.search', step: 'NOTIFY' }, 'op');
  var recovery = healthMod.listRecovery();
  var inc = recovery.incidents.filter(function (i) { return i.component === 'web.search'; })[0];
  ok(inc && inc.current_step === 'NOTIFY' && inc.steps.length === 2, 'recovery steps fold in order');
  ok(inc.closed !== true, 'incident stays open before UPDATE_STATUS');
  healthMod.recordRecoveryStep({ component: 'web.search', step: 'UPDATE_STATUS', state: 'ACTIVE' }, 'op');
  inc = healthMod.listRecovery().incidents.filter(function (i) { return i.component === 'web.search'; })[0];
  ok(inc.closed === true && inc.state === 'ACTIVE', 'UPDATE_STATUS closes the incident');
}

// ---------------------------------------------------------------------------
section('history — unified read model over fixtures + stub db');
var history = require('../projects/command-center/reference/othmode/history.js');
{
  var execDir = tmpRoot('exec');
  process.env.OTHMODE_EXECUTOR_TASKS_DIR = execDir;
  process.env.OTHMODE_ORCHESTRATOR_TASKS_DIR = path.join(os.tmpdir(), 'othmode-no-orch-' + process.pid);
  fs.mkdirSync(path.join(execDir, 't-001'));
  fs.writeFileSync(path.join(execDir, 't-001', 'status.json'), JSON.stringify({
    state: 'COMPLETED', started_at: '2026-08-26T10:00:00Z', ended_at: '2026-08-26T10:05:00Z', result_summary: '99/0'
  }));
  fs.writeFileSync(path.join(execDir, 't-001', 'task.json'), JSON.stringify({ title: 'governance suite', project: 'mythos-os' }));

  var stubDb = { query: function () { return Promise.resolve({ rows: [
    { event_type: 'COPY', occurred_at: '2026-08-26T11:00:00Z', slug: 'git-status', title: 'git status -sb', project_slug: null }
  ] }); } };

  history.unified(stubDb, {}).then(function (data) {
    ok(data.rows.length === 2, 'library + executor rows merged (' + data.rows.length + ')');
    ok(data.rows[0].source === 'library', 'newest first (library 11:00 before executor 10:05)');
    var execRow = data.rows.filter(function (r) { return r.source === 'executor'; })[0];
    ok(execRow.duration_ms === 300000, 'duration computed from start/end');
    ok(execRow.command === 'governance suite' && execRow.project === 'mythos-os', 'task fields carried');
    ok(data.sources.orchestrator !== 'loaded', 'absent orchestrator dir reported, not silently empty');
    return history.unified(stubDb, { source: 'executor' });
  }).then(function (filtered) {
    ok(filtered.rows.length === 1 && filtered.rows[0].source === 'executor', 'source filter works');
    return history.unified({ query: function () { return Promise.reject(new Error('no db')); } }, {});
  }).then(function (nodb) {
    ok(nodb.sources.library !== 'loaded' && nodb.rows.length === 1, 'db failure is soft — file sources still served');
    finishAsync();
  }).catch(function (e) {
    ok(false, 'history suite crashed: ' + e.message);
    finishAsync();
  });
}

// ---------------------------------------------------------------------------
function finishAsync() {
  section('memory — fail-closed boundary');
  var memory = require('../projects/command-center/reference/othmode/memory.js');
  process.env.OTHMODE_KNOWLEDGE_ROOT = path.join(os.tmpdir(), 'othmode-no-know-' + process.pid);
  memory.reset();
  var st = memory.status();
  ok(st.enabled === false && /does not exist/.test(st.reason), 'absent knowledge store → disabled with reason');
  var sr = memory.search('anything');
  ok(sr.enabled === false && sr.hits.length === 0, 'search on disabled layer returns empty, never throws');

  section('routes — role gating and the secret gate');
  var routesMod = require('../projects/command-center/reference/othmode/routes.js');
  ok(routesMod.roleOf('owner') === 'owner' && routesMod.roleOf('editor-x') === 'editor' && routesMod.roleOf(null) === null, 'roleOf maps identities');

  var stubAuth = {
    identityFromRequest: function (req) { return req && req.identity ? req.identity : null; }
  };
  var routes = routesMod.buildRoutes({ query: function () { return Promise.resolve({ rows: [] }); } }, stubAuth);
  function findRoute(method, pathStr) {
    return routes.filter(function (r) { return r.method === method && r.pattern.test(pathStr); })[0];
  }
  function fakeRes() {
    return {
      statusCode: null, body: null,
      writeHead: function (s) { this.statusCode = s; },
      end: function (b) { this.body = b ? JSON.parse(b) : null; }
    };
  }

  var modePost = findRoute('POST', '/api/othmode/mode');
  ok(modePost && modePost.role === 'owner', 'mode switch route is owner-gated');

  var signalPost = findRoute('POST', '/api/othmode/evolution/signals');
  var res1 = fakeRes();
  signalPost.handler({ identity: 'editor-x' }, res1, null, {}, {
    source: 'manual',
    description: 'leak test AKIAIOSFODNN7EXAMPLE with -----BEGIN RSA PRIVATE KEY-----'
  });
  ok(res1.statusCode === 422, 'credential-shaped signal description refused by the secret gate (' + res1.statusCode + ')');

  var res2 = fakeRes();
  signalPost.handler({ identity: 'editor-x' }, res2, null, {}, { source: 'manual', description: 'clean signal', dedup_key: 'routes:1' });
  ok(res2.statusCode === 201 && res2.body.signal.id, 'clean signal accepted through the route');

  var stagePost = findRoute('POST', '/api/othmode/evolution/events/x/stages');
  var evH = require('../projects/command-center/reference/othmode/evolution.js')
    .createEvent({ title: 'route gate test', risk_tier: 'HIGH' }, 'claude');
  var res3 = fakeRes();
  stagePost.handler({ identity: 'editor-x' }, res3, ['/x', evH.id], {}, { stage: 'REVIEW', data: { decision: 'APPROVED' } });
  ok(res3.statusCode === 403, 'HIGH-risk approval via route by editor → 403 (' + res3.statusCode + ')');
  var res4 = fakeRes();
  stagePost.handler({ identity: 'owner' }, res4, ['/x', evH.id], {}, { stage: 'REVIEW', data: { decision: 'APPROVED' } });
  ok(res4.statusCode === 201, 'HIGH-risk approval via route by owner → 201 (' + res4.statusCode + ')');

  var ossGet = findRoute('GET', '/api/othmode/oss-registry');
  var res5 = fakeRes();
  ossGet.handler({}, res5, null, {}, {});
  ok(res5.statusCode === 200 && Array.isArray(res5.body.records) && res5.body.records.length >= 8, 'OSS registry served (' + (res5.body.records || []).length + ' records)');
  var rejected = res5.body.records.filter(function (r) { return r.status === 'REJECTED'; });
  ok(rejected.length >= 1 && rejected[0].rejection_reason, 'REJECTED records kept with reasons');

  section('genes and capsules — Git artifacts');
  var evo2 = require('../projects/command-center/reference/othmode/evolution.js');
  var genes = evo2.listGenes();
  ok(genes.length >= 2 && genes.every(function (g) { return g.valid; }), 'seed genes parse (' + genes.length + ')');
  ok(genes.some(function (g) { return g.id === 'quota-wait-over-fallback' && g.type === 'routing-strategy'; }), 'routing-strategy gene present');
  var gd = evo2.geneDetail('quota-wait-over-fallback');
  ok(gd && /WAITING_FOR_QUOTA/.test(gd.body), 'gene body readable');
  ok(evo2.geneDetail('../../../etc/passwd') === null, 'gene id traversal refused');
  ok(Array.isArray(evo2.listCapsules()), 'capsules listing works on the empty set');

  section('no-exec discipline in the new runtime modules');
  var refDir = path.join(REPO, 'projects', 'command-center', 'reference', 'othmode');
  fs.readdirSync(refDir).forEach(function (f) {
    var src = fs.readFileSync(path.join(refDir, f), 'utf8');
    ok(!/child_process|\beval\s*\(|new\s+Function/.test(src), f + ' contains no exec/eval');
  });

  console.log('');
  console.log('OTHMODE-2 platform suite: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
}
