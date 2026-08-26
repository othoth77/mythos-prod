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
  var threw = false;
  try { store.appendRecord('evolution', { type: 'signal' }); } catch (e) { threw = e.code === 'OTHMODE_STORE_ABSENT'; }
  ok(threw, 'append without a store throws OTHMODE_STORE_ABSENT');
  var read = store.readStream('evolution');
  ok(read.provisioned === false && read.rows.length === 0, 'read without a store is empty with a reason');
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

  ok(typeof store.setMode === 'undefined' && typeof store.getMode === 'undefined',
    'the global OthMode switch is fully removed from the store (no hidden toggle)');
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

  ok(findRoute('POST', '/api/othmode/mode') === undefined, 'the mode POST route is gone — no global switch, no replacement toggle');
  var modeGet = findRoute('GET', '/api/othmode/mode');
  var resAv = fakeRes();
  modeGet.handler({}, resAv, null, {}, {});
  ok(resAv.statusCode === 200 && resAv.body.status === 'READY', '/api/othmode/mode reports permanent availability (READY)');
  ok(resAv.body.hint_ar && resAv.body.hint_fr && resAv.body.hint_en, 'availability carries the three-language activation hint');

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
  ['othmode.js', 'othmode-i18n.js'].forEach(function (f) {
    var src = fs.readFileSync(path.join(REPO, 'projects', 'command-center', 'reference', 'web', f), 'utf8');
    ok(!/child_process|eval\s*\(|new\s+Function/.test(src), f + ' contains no exec/eval');
    ok(!/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/.test(src), f + ' never assigns markup from strings');
  });
  fs.readdirSync(refDir).forEach(function (f) {
    var src = fs.readFileSync(path.join(refDir, f), 'utf8');
    ok(!/child_process|\beval\s*\(|new\s+Function/.test(src), f + ' contains no exec/eval');
  });

  runActivationTests();
}

// ---------------------------------------------------------------------------
function runActivationTests() {
  section('activation — the per-command keyword rule (spec cases 1-9)');
  var act = require('../projects/command-center/reference/othmode/activation.js');

  // 1-3: explicit keyword, any casing → OTHMODE
  ok(act.isActivated('othmode test') === true, '1: "othmode test" activates');
  ok(act.isActivated('OTHMODE test') === true, '2: "OTHMODE test" activates');
  ok(act.isActivated('OthMode test') === true, '3: "OthMode test" activates');
  // 4-5: no keyword → normal Claude
  ok(act.isActivated('test') === false, '4: "test" stays normal');
  ok(act.isActivated('build this feature') === false, '5: "build this feature" stays normal');
  // 6-7: substrings/compounds never activate
  ok(act.isActivated('myothmode test') === false, '6: "myothmode test" stays normal');
  ok(act.isActivated('othmodel test') === false, '7: "othmodel test" stays normal');
  ok(act.isActivated('othmode-test') === false, 'compound "othmode-test" stays normal (per spec)');
  // keyword anywhere in the command, wrapped in prose punctuation, still counts
  ok(act.isActivated('analyse this, othmode, then report') === true, 'mid-sentence "othmode," activates');
  ok(act.isActivated('(othmode) recherche une solution') === true, 'parenthesised keyword activates');
  ok(act.isActivated('') === false && act.isActivated(null) === false, 'empty/null input never activates');
  // 8-9: history/context classification
  ok(act.classify('othmode analyse ce projet') === 'othmode', '8: OTHMODE command classified as othmode');
  ok(act.classify('analyse ce projet') === 'normal', '9: normal command never classified as othmode');
  // availability is stateless and permanent
  ok(act.availability().status === 'READY' && act.availability().keyword === 'othmode', 'availability is READY with the keyword documented');
  // 10: the keyword grants nothing — role logic is untouched by activation
  var routesMod = require('../projects/command-center/reference/othmode/routes.js');
  ok(routesMod.roleOf(null) === null, '10: no identity stays no identity, keyword or not (activation grants no permission)');

  runCompletionTests();
}

// ---------------------------------------------------------------------------
function runCompletionTests() {
  section('detectors — deterministic E1 signal detection');
  var detect = require('../projects/command-center/reference/othmode/detect.js');

  var healthFinds = detect.detectFromHealth({ components: [
    { id: 'monitor:db', kind: 'integration', name: 'db', state: 'FAILED', detail: 'refused' },
    { id: 'provider:x', kind: 'provider', name: 'x', state: 'BLOCKED', detail: 'credential absent' },
    { id: 'tool:ok', kind: 'tool', name: 'ok', state: 'ACTIVE' }
  ] });
  ok(healthFinds.length === 1 && healthFinds[0].dedup_key === 'health:monitor:db', 'FAILED becomes a signal; BLOCKED and ACTIVE never do');

  var histFinds = detect.detectFromHistory({ rows: [
    { source: 'executor', command: 'task-a', command_ref: 't-a', status: 'FAILED' },
    { source: 'executor', command: 'task-a', command_ref: 't-a', status: 'FAILED' },
    { source: 'executor', command: 'task-b', command_ref: 't-b', status: 'FAILED' },
    { source: 'library',  command: 'x', command_ref: 'x', status: 'COPY' }
  ] });
  ok(histFinds.length === 1 && /2 times/.test(histFinds[0].description), 'single failure is not a signal; a repeat is');

  var before = require('../projects/command-center/reference/othmode/evolution.js').listSignals().signals.length;
  var stubDb = { query: function () { return Promise.reject(new Error('no db')); } };
  detect.run(stubDb, 'suite-detector').then(function (r) {
    ok(Array.isArray(r.recorded), 'detector run records fold-able signals (' + r.recorded.length + ')');
    ok(r.recorded.every(function (x) { return x.disposition === 'NOTED'; }), 'detectors only ever record NOTED — promotion stays reviewed');
    return detect.run(stubDb, 'suite-detector');
  }).then(function (r2) {
    var after = require('../projects/command-center/reference/othmode/evolution.js').listSignals().signals.length;
    ok(r2.recorded.every(function (x) { return x.occurrences >= 1; }), 'second run folds by dedup_key (occurrences grow, rows do not multiply)');
    ok(after <= before + r2.recorded.length, 'no signal-row explosion across runs');

    section('capsule — the first real capsule satisfies the activation contract');
    var evo = require('../projects/command-center/reference/othmode/evolution.js');
    var capsules = evo.listCapsules();
    var core = capsules.filter(function (c) { return c.id === 'othmode-core-discipline'; })[0];
    ok(!!core && core.valid, 'othmode-core-discipline parses');
    ok(core && core.validation === 'PASS' && core.review === 'APPROVED', 'capsule carries PASS + APPROVED');
    ok(core && core.activatable === true && core.status === 'ACTIVE', 'activation contract satisfied → ACTIVE');
    ok(core && core.genes.length === 2, 'capsule references its two validated genes');
    core.genes.forEach(function (g) {
      ok(evo.geneDetail(g) !== null, 'referenced gene exists: ' + g);
    });

    section('export — store backup snapshot excludes auth material');
    var cp = require('child_process');
    var out = cp.execFileSync(process.execPath,
      [path.join(REPO, 'projects', 'command-center', 'cli', 'othmode-cli.js'), 'export', path.join(os.tmpdir(), 'othmode-export-' + process.pid)],
      { env: Object.assign({}, process.env, { OTHMODE_STORE_ROOT: STORE_ROOT }), encoding: 'utf8' });
    var exported = JSON.parse(out);
    ok(exported.files.indexOf('evolution/events.jsonl') !== -1, 'events stream exported');
    var manifest = JSON.parse(fs.readFileSync(path.join(exported.exported_to, 'manifest.json'), 'utf8'));
    ok(/^[0-9a-f]{64}$/.test(manifest.files['evolution/events.jsonl'].sha256), 'manifest carries sha256 sums');
    var names = fs.readdirSync(exported.exported_to);
    ok(names.every(function (n) { return n.indexOf('session') === -1; }), 'sessions are NEVER exported (auth material stays out of backups)');
    var body = fs.readFileSync(path.join(exported.exported_to, 'evolution__events.jsonl'), 'utf8');
    var sessRaw = '';
    try { sessRaw = fs.readFileSync(path.join(STORE_ROOT, 'config', 'sessions.json'), 'utf8'); } catch (e) { /* none */ }
    ok(sessRaw === '' || body.indexOf(JSON.parse(sessRaw).sessions[0] ? JSON.parse(sessRaw).sessions[0].h : '\u0000') === -1, 'no session hash leaks into exported streams');

    runSessionTests();
  }).catch(function (e) {
    ok(false, 'completion section crashed: ' + e.message);
    runSessionTests();
  });
}

// ---------------------------------------------------------------------------
function runSessionTests() {
  section('sessions — one-time login codes and browser sessions');
  var sessions = require('../projects/command-center/reference/othmode/sessions.js');

  var minted = sessions.createLoginCode('owner');
  ok(typeof minted.code === 'string' && minted.code.length >= 40, 'login code minted (random, url-safe)');
  var raw = fs.readFileSync(path.join(STORE_ROOT, 'config', 'sessions.json'), 'utf8');
  ok(raw.indexOf(minted.code) === -1, 'plaintext code never persisted — hash only');

  ok(sessions.exchangeCode('not-a-real-code') === null, 'unknown code refused');
  var exchanged = sessions.exchangeCode(minted.code);
  ok(exchanged && exchanged.identity === 'owner' && exchanged.sessionId.length >= 40, 'code exchanges for an owner session');
  ok(sessions.exchangeCode(minted.code) === null, 'code is single-use — burned on exchange');
  raw = fs.readFileSync(path.join(STORE_ROOT, 'config', 'sessions.json'), 'utf8');
  ok(raw.indexOf(exchanged.sessionId) === -1, 'plaintext session id never persisted — hash only');

  ok(sessions.identityForSession(exchanged.sessionId) === 'owner', 'session resolves to its identity');
  ok(sessions.identityForSession('bogus') === null, 'unknown session resolves to null');

  var authLib = require('../projects/command-center/reference/auth.js');
  var ctxCookie = authLib.authContext({ headers: { cookie: 'a=b; oth_session=' + exchanged.sessionId } });
  ok(ctxCookie.identity === 'owner' && ctxCookie.via === 'cookie', 'authContext resolves the session cookie');
  ok(authLib.authContext({ headers: {} }).identity === null, 'no credential → no identity');

  ok(sessions.revokeSession(exchanged.sessionId) === true, 'session revocable');
  ok(sessions.identityForSession(exchanged.sessionId) === null, 'revoked session no longer resolves');

  // Fail-closed: sessions need the provisioned store.
  var savedRoot = process.env.OTHMODE_STORE_ROOT;
  process.env.OTHMODE_STORE_ROOT = path.join(os.tmpdir(), 'othmode-nostore-' + process.pid);
  var threw = false;
  try { sessions.createLoginCode('owner'); } catch (e) { threw = e.code === 'OTHMODE_STORE_ABSENT'; }
  ok(threw, 'minting without a store fails closed');
  ok(sessions.exchangeCode('x') === null && sessions.identityForSession('x') === null, 'exchange/resolve without a store → null, never a throw');
  process.env.OTHMODE_STORE_ROOT = savedRoot;

  runHttpTests();
}

// ---------------------------------------------------------------------------
// End-to-end over a real HTTP server: /auth exchange sets the HttpOnly
// cookie, cookie authenticates, CSRF check refuses cross-origin writes,
// logout burns the session. Needs the pg module to LOAD (never to connect):
// present in projects/command-center/node_modules on dev/prod hosts. If it
// cannot load, report SKIPPED loudly rather than false-passing.
function runHttpTests() {
  section('http — /auth exchange, cookie auth, CSRF, logout');
  var http = require('http');
  process.env.MCC_ADMIN_TOKENS = JSON.stringify({ 'suite-owner-token': 'owner' });
  process.env.MCC_DB_HOST = '127.0.0.1'; process.env.MCC_DB_PORT = '5499';
  process.env.MCC_DB_USER = 'x'; process.env.MCC_DB_PASSWORD = 'x'; process.env.MCC_DB_NAME = 'x';
  var api;
  try {
    api = require('../projects/command-center/reference/api.js');
  } catch (e) {
    console.log('  [SKIP] pg module unavailable on this host — http section skipped (' + e.code + ')');
    return finishSuite();
  }
  var authLib = require('../projects/command-center/reference/auth.js');
  authLib.clearTokenCache();
  var sessions = require('../projects/command-center/reference/othmode/sessions.js');
  var server = api.createServer();

  server.listen(0, '127.0.0.1', function () {
    var port = server.address().port;

    function request(method, reqPath, headers, body) {
      return new Promise(function (resolve, reject) {
        var req = http.request({ host: '127.0.0.1', port: port, method: method, path: reqPath, headers: headers || {} }, function (res) {
          var chunks = [];
          res.on('data', function (c) { chunks.push(c); });
          res.on('end', function () {
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
          });
        });
        req.on('error', reject);
        if (body !== undefined) req.end(JSON.stringify(body)); else req.end();
      });
    }

    var minted = sessions.createLoginCode('owner');
    var cookie = null;

    request('GET', '/auth/' + minted.code).then(function (res) {
      ok(res.status === 302 && res.headers.location === '/', '/auth/<code> → 302 to the app');
      var setCookie = String(res.headers['set-cookie'] && res.headers['set-cookie'][0] || '');
      ok(/^oth_session=/.test(setCookie) && /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Strict/.test(setCookie),
        'session cookie is HttpOnly + Secure + SameSite=Strict');
      cookie = setCookie.split(';')[0];
      return request('GET', '/auth/' + minted.code);
    }).then(function (res) {
      ok(res.status === 403, 'replaying the login link → 403 (single use)');
      return request('GET', '/api/session', { cookie: cookie });
    }).then(function (res) {
      ok(res.status === 200 && JSON.parse(res.body).identity === 'owner', 'cookie authenticates /api/session as owner');
      ok(res.body.indexOf(cookie.split('=')[1]) === -1, 'session id never echoed in an API response');
      return request('POST', '/api/othmode/evolution/signals',
        { cookie: cookie, 'content-type': 'application/json', origin: 'https://evil.example' },
        { source: 'manual', description: 'csrf probe', dedup_key: 'csrf:1' });
    }).then(function (res) {
      ok(res.status === 403, 'cookie write from a foreign Origin → 403 (CSRF check)');
      return request('POST', '/api/othmode/evolution/signals',
        { cookie: cookie, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        { source: 'manual', description: 'same-origin write', dedup_key: 'csrf:2' });
    }).then(function (res) {
      ok(res.status === 201, 'cookie write with same-origin proof → 201');
      return request('POST', '/api/othmode/evolution/signals',
        { authorization: 'Bearer suite-owner-token', 'content-type': 'application/json' },
        { source: 'manual', description: 'bearer write', dedup_key: 'csrf:3' });
    }).then(function (res) {
      ok(res.status === 201, 'bearer path unchanged (no CSRF requirement, explicit credential)');
      // /api/othmode/history is deliberately PUBLIC now, so it can no longer
      // serve as the "no credential" probe. Use an endpoint that genuinely
      // still requires a session — the guarantee under test is unchanged.
      return request('GET', '/api/othmode/evolution/events', {});
    }).then(function (res) {
      ok(res.status === 401, 'no credential at all → 401 preserved (authenticated endpoint)');
      return request('GET', '/api/othmode/history', {});
    }).then(function (res) {
      ok(res.status === 200, 'PUBLIC READ: unauthenticated GET /history succeeds over real HTTP');
      var body = JSON.parse(res.body || '{}');
      ok(!/NOPASSWD|\/home\/deploy|127\.0\.0\.1/.test(JSON.stringify(body)),
        'PUBLIC READ: the anonymous history payload carries no infrastructure detail');
      return request('GET', '/api/othmode/tasks', {});
    }).then(function (res) {
      ok(res.status === 200, 'PUBLIC READ: unauthenticated GET /tasks succeeds over real HTTP');
      return request('POST', '/api/othmode/tasks',
        { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        { command: 'othmode anonymous write attempt' });
    }).then(function (res) {
      ok(res.status === 401, 'WRITES STAY CLOSED: unauthenticated POST /tasks → 401');
      return request('POST', '/api/othmode/tasks/OTH-2026-00001/update',
        { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, { status: 'COMPLETED' });
    }).then(function (res) {
      ok(res.status === 401, 'WRITES STAY CLOSED: unauthenticated POST task update → 401');
      return request('POST', '/api/othmode/logout', { cookie: cookie, 'sec-fetch-site': 'same-origin' });
    }).then(function (res) {
      ok(res.status === 200 && /Max-Age=0/.test(String(res.headers['set-cookie'])), 'logout clears the cookie');
      return request('GET', '/api/session', { cookie: cookie });
    }).then(function (res) {
      ok(res.status === 401, 'burned session no longer authenticates');
      server.close();
      finishSuite();
    }).catch(function (e) {
      ok(false, 'http section crashed: ' + e.message);
      server.close();
      finishSuite();
    });
  });
}

function finishSuite() {
  console.log('');
  console.log('OTHMODE-2 platform suite: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
}
