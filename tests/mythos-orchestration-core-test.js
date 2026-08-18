'use strict';
// =====================================================
// MYTHOS — Phase 2 Orchestration Core tests
// tests/mythos-orchestration-core-test.js
//
// Grows with each Phase 2 sub-stage (2A → 2M); every commit runs the
// whole file, so later stages are permanent regression cover for earlier
// ones. Deterministic and offline: providers, money, advertising, image
// generation and external APIs are mocks; Git behaviour runs against
// throwaway repositories; NO real AI quota is consumed.
//
// Fixture root lives under the home directory (never /tmp — the same
// contract as the Phase 1 suites) and is removed at the end.
//
// Run with: node tests/mythos-orchestration-core-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIXTURES = path.join(os.homedir(), 'mythos-core-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');

var domain = require(path.join(EXEC, 'core', 'domain'));
var store = require(path.join(EXEC, 'core', 'store'));

var passed = 0;
var failed = 0;
var failures = [];

function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

function throws(fn, re, name) {
  try { fn(); ok(false, name + ' (did not throw)'); }
  catch (e) { ok(re.test(e.message), name + ' (threw: ' + e.message.slice(0, 90) + ')'); }
}

// ===========================================================================
// PHASE 2A — domain model + persistent orchestration state
// ===========================================================================

// --- Identity and construction ---------------------------------------------
(function () {
  var id = domain.newId('task');
  ok(/^tk-/.test(id) && domain.isValidId(id), '2A id: task ids are prefixed and valid');
  ok(!domain.isValidId('../../etc/passwd'), '2A id: traversal is not a valid id');
  ok(!domain.isValidId('tk-UPPER-case'), '2A id: uppercase refused');
  throws(function () { domain.newId('nonsense'); }, /UNKNOWN_ENTITY_TYPE/, '2A id: unknown entity type refused');

  var goal = domain.createGoal({ text: 'Improve product search', project: 'ssangyong-autos' });
  ok(goal.status === 'RECEIVED' && goal.correlation_id === goal.id, '2A goal: constructed with defaults');
  throws(function () { domain.createGoal({}); }, /MISSING_FIELD: text/, '2A goal: empty text refused');

  var mission = domain.createMission({
    goal_id: goal.id, title: 'Search improvement', correlation_id: goal.correlation_id, parent_id: goal.id
  });
  ok(mission.correlation_id === goal.id && mission.parent_id === goal.id, '2A mission: correlation threads through');

  var task = domain.createTask({ title: 'Inspect current search', mission_id: mission.id });
  ok(task.status === 'QUEUED' && task.max_attempts === 3, '2A task: defaults sane');
  throws(function () { domain.createEvent({ event_type: 'NOT_A_REAL_EVENT' }); },
    /UNKNOWN_EVENT_TYPE/, '2A event: unknown type refused');
})();

// --- Transition tables -----------------------------------------------------
(function () {
  ok(domain.taskTransitionAllowed('QUEUED', 'READY'), '2A transitions: QUEUED→READY legal');
  ok(domain.taskTransitionAllowed('RUNNING', 'WAITING_FOR_QUOTA'), '2A transitions: RUNNING→WAITING_FOR_QUOTA legal');
  ok(domain.taskTransitionAllowed('WAITING_FOR_QUOTA', 'RUNNING'), '2A transitions: quota resume legal');
  ok(domain.taskTransitionAllowed('VALIDATING', 'RETRYING'), '2A transitions: validation rejection → repair legal');
  throws(function () { domain.taskTransitionAllowed('QUEUED', 'COMPLETED'); },
    /ILLEGAL_TRANSITION/, '2A transitions: QUEUED cannot jump to COMPLETED');
  throws(function () { domain.taskTransitionAllowed('COMPLETED', 'RUNNING'); },
    /ILLEGAL_TRANSITION/, '2A transitions: COMPLETED is terminal');
  throws(function () { domain.taskTransitionAllowed('NOWHERE', 'READY'); },
    /UNKNOWN_STATE/, '2A transitions: unknown state refused');

  // Compat adapter: Phase 1 executor vocabulary maps both ways, and an
  // executor COMPLETED enters core VALIDATING — never trusted directly.
  ok(domain.TASK_STATE_COMPAT.fromExecutor.COMPLETED === 'VALIDATING',
    '2A compat: executor COMPLETED → core VALIDATING');
  ok(domain.TASK_STATE_COMPAT.fromExecutor.WAITING_RETRY === 'RETRYING' &&
     domain.TASK_STATE_COMPAT.toExecutor.RETRYING === 'WAITING_RETRY',
    '2A compat: retry states round-trip');
  Object.keys(domain.TASK_STATE_COMPAT.fromExecutor).forEach(function (k) {
    ok(domain.TASK_STATES.indexOf(domain.TASK_STATE_COMPAT.fromExecutor[k]) !== -1,
      '2A compat: fromExecutor["' + k + '"] lands in a real core state');
  });
})();

// --- Persistence, duplicates, transitions through the store -----------------
(function () {
  var goal = domain.createGoal({ text: 'persist me', project: 'mythos-prod' });
  store.create(goal);
  var loaded = store.load('goal', goal.id);
  ok(loaded && loaded.text === 'persist me', '2A store: goal persists and loads');
  throws(function () { store.create(goal); }, /DUPLICATE_ENTITY/, '2A store: duplicate id refused');

  var task = domain.createTask({ title: 'stored task', correlation_id: goal.id });
  store.create(task);
  store.transition('task', task.id, 'READY');
  store.transition('task', task.id, 'RUNNING');
  ok(store.load('task', task.id).status === 'RUNNING', '2A store: transitions persist');
  throws(function () { store.transition('task', task.id, 'READY'); },
    /ILLEGAL_TRANSITION/, '2A store: illegal transition refused at the store');
  throws(function () { store.transition('task', 'tk-000000-zzzz', 'READY'); },
    /NO_SUCH_ENTITY/, '2A store: missing entity refused');

  // Secrets never persist raw.
  var dirty = domain.createTask({ title: 'leaky', instruction: 'use TOKEN=ghp_abcdefghijklmnopqrstuv123' });
  store.create(dirty);
  var raw = fs.readFileSync(store.entityFile('task', dirty.id), 'utf8');
  ok(raw.indexOf('ghp_abcdefghijklmnop') === -1 && raw.indexOf('[REDACTED]') !== -1,
    '2A store: persisted entities are redacted');

  // Store root is never /tmp in production.
  var saved = process.env.MYTHOS_EXECUTOR_HOME;
  delete process.env.MYTHOS_EXECUTOR_HOME;
  ok(store.root().indexOf('/tmp') !== 0, '2A store: production root not under /tmp');
  process.env.MYTHOS_EXECUTOR_HOME = saved;
})();

// --- Durable events ----------------------------------------------------------
(function () {
  var before = store.readEvents().length;
  store.appendEventLine({ event_type: 'GOAL_CREATED', subject_id: 'g-abc123-def4', detail: { note: 'x' } });
  store.appendEventLine({ event_type: 'QUOTA_EXHAUSTED', subject_id: 'tk-abc123-def4' });
  var events = store.readEvents();
  ok(events.length === before + 2, '2A events: appended durably');
  ok(events[events.length - 1].event_type === 'QUOTA_EXHAUSTED', '2A events: order preserved');
  throws(function () { store.appendEventLine({ event_type: 'FAKE' }); },
    /UNKNOWN_EVENT_TYPE/, '2A events: type enum enforced');

  // A torn tail line (crash mid-append) must not break reading.
  fs.appendFileSync(path.join(store.root(), 'events.log'), '{"half":');
  ok(store.readEvents().length === before + 2, '2A events: torn tail line tolerated');
  // Clean the torn line so later stages append valid JSONL.
  var content = fs.readFileSync(path.join(store.root(), 'events.log'), 'utf8');
  fs.writeFileSync(path.join(store.root(), 'events.log'),
    content.slice(0, content.lastIndexOf('{"half":')));
})();

// --- Restart recovery: a fresh process sees identical state -------------------
(function () {
  var goal = domain.createGoal({ text: 'survive restart', project: 'mythos-prod' });
  store.create(goal);
  var task = domain.createTask({ title: 'restartable', correlation_id: goal.id });
  store.create(task);
  store.transition('task', task.id, 'READY');

  var script =
    'var s = require(' + JSON.stringify(path.join(EXEC, 'core', 'store')) + ');' +
    'var t = s.load("task", ' + JSON.stringify(task.id) + ');' +
    'var g = s.load("goal", ' + JSON.stringify(goal.id) + ');' +
    'console.log(JSON.stringify({t: t.status, g: g.text, ev: s.readEvents().length > 0}));';
  var out = JSON.parse(cp.execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8', env: Object.assign({}, process.env)
  }).trim());
  ok(out.t === 'READY' && out.g === 'survive restart' && out.ev === true,
    '2A restart: fresh process recovers entities and events');
})();

// ===========================================================================
// PHASE 2B — project memory + context engine
// ===========================================================================

var memory = require(path.join(EXEC, 'core', 'memory'));
var context = require(path.join(EXEC, 'core', 'context'));

function makeRepo(name) {
  var dir = path.join(FIXTURES, name);
  fs.mkdirSync(dir, { recursive: true });
  cp.execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  cp.execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  cp.execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), name + '\n');
  cp.execFileSync('git', ['add', '.'], { cwd: dir });
  cp.execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

// --- Memory basics -----------------------------------------------------------
(function () {
  var e = memory.remember({
    project: 'sya', category: 'constraint', title: 'Legacy site frozen',
    content: 'Never modify /var/www/ssangyong.autos; ratified §22 option 3.',
    source: 'docs/AI_HANDOVER.md', confidence: 1.0, tags: ['legacy', 'freeze']
  });
  ok(e.id.indexOf('me-') === 0 && e.status === 'ACTIVE', '2B memory: entry recorded');
  throws(function () {
    memory.remember({ project: 'sya', category: 'gossip', title: 'x', content: 'y' });
  }, /UNKNOWN_MEMORY_CATEGORY/, '2B memory: unknown category refused');
  throws(function () {
    memory.remember({
      project: 'sya', category: 'decision', title: 'creds',
      content: 'API_KEY=sk-ant-abcdefghijklmnopqrstu12345'
    });
  }, /MEMORY_REFUSES_SECRETS/, '2B memory: secrets refused, not silently redacted');

  memory.remember({
    project: 'sya', category: 'architecture', title: 'Catalog search uses ILIKE',
    content: 'Product search endpoint /api/products?q= uses ILIKE with no index; fine at 346 products.',
    source: 'projects/ssangyong-autos/reference/api.js', confidence: 0.9, tags: ['search', 'api']
  });
  memory.remember({
    project: 'sya', category: 'completed_work', title: 'Storefront implemented',
    content: 'shop.html consumes catalog natively; no innerHTML; prices exact NUMERIC strings.',
    source: 'docs/AI_HANDOVER.md', confidence: 0.9, tags: ['storefront']
  });
  memory.remember({
    project: 'darhijama', category: 'architecture', title: 'Search in Laravel app',
    content: 'Dar Hijama search is a Laravel scout feature, unrelated to SsangYong.',
    source: 'x', confidence: 0.9, tags: ['search']
  });

  var hits = memory.recall('sya', 'improve product search API');
  ok(hits.length >= 1 && hits[0].entry.title === 'Catalog search uses ILIKE',
    '2B memory: most relevant entry ranks first');
  ok(hits.every(function (h) { return h.entry.project === 'sya'; }),
    '2B memory: project isolation — no cross-project entries');
  var none = memory.recall('sya', 'quantum blockchain kubernetes');
  ok(none.length === 0, '2B memory: irrelevant query returns nothing, not noise');
})();

// --- Supersede ----------------------------------------------------------------
(function () {
  var old = memory.remember({
    project: 'sya', category: 'known_issue', title: 'Search button clipped on mobile',
    content: 'min-width bug at 360px.', confidence: 0.9, tags: ['search', 'mobile']
  });
  var next = memory.supersede(old.id, {
    category: 'completed_work', title: 'Mobile search clipping fixed',
    content: 'Fixed with min-width:0 on .search in 1bcba2c; measured 360/390 clean.',
    confidence: 1.0, tags: ['search', 'mobile']
  });
  var reloaded = store.load('memory_entry', old.id);
  ok(reloaded.status === 'SUPERSEDED' && reloaded.metadata.superseded_by === next.id,
    '2B memory: supersede links and retires the old entry');
  var hits = memory.recall('sya', 'mobile search clipping');
  ok(hits.every(function (h) { return h.entry.id !== old.id; }),
    '2B memory: superseded entries never recalled');
})();

// --- Restart recovery -----------------------------------------------------------
(function () {
  var script =
    'var m = require(' + JSON.stringify(path.join(EXEC, 'core', 'memory')) + ');' +
    'var hits = m.recall("sya", "product search api");' +
    'console.log(JSON.stringify({n: hits.length, first: hits[0] ? hits[0].entry.title : null}));';
  var out = JSON.parse(cp.execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8', env: Object.assign({}, process.env)
  }).trim());
  ok(out.n >= 1 && out.first === 'Catalog search uses ILIKE',
    '2B memory: recall survives process restart');
})();

// --- Context engine ---------------------------------------------------------------
(function () {
  throws(function () { context.assembleContext({}); }, /CONTEXT_REQUIRES_PROJECT/,
    '2B context: project is mandatory');

  var repo = makeRepo('ctx-repo');
  // A completed prior core task for relatedness.
  var prior = domain.createTask({
    title: 'Tune product search ranking', project: 'sya',
    status: 'QUEUED', instruction: 'search ranking experiment'
  });
  store.create(prior);
  ['READY', 'RUNNING', 'VALIDATING', 'COMPLETED'].reduce(function (_, s) {
    return store.transition('task', prior.id, s);
  }, null);

  var ctx = context.assembleContext({
    project: 'sya', instruction: 'Modify the SSANGYONG catalog search API',
    repo_path: repo
  });
  var kinds = ctx.items.map(function (i) { return i.kind; });
  ok(kinds[0] === 'repository_state', '2B context: live repo state always included first');
  ok(kinds.some(function (k) { return k === 'memory:architecture'; }),
    '2B context: relevant memory included');
  ok(kinds.some(function (k) { return k === 'prior_task'; }),
    '2B context: related prior task included');
  ok(!ctx.items.some(function (i) { return /Laravel/.test(i.content); }),
    '2B context: other projects excluded');
  ok(!ctx.items.some(function (i) { return /Photo non disponible|storefront/i.test(i.kind); }),
    '2B context: unrelated categories not force-included');
  ok(ctx.items.every(function (i) {
    return i.relevance !== undefined && i.source && i.timestamp && i.confidence !== undefined;
  }), '2B context: every item carries relevance/source/timestamp/confidence');

  // Budget enforcement: a tiny budget admits strictly fewer items.
  var tiny = context.assembleContext({
    project: 'sya', instruction: 'Modify the SSANGYONG catalog search API',
    repo_path: repo, max_chars: 120
  });
  ok(tiny.items.length < ctx.items.length && tiny.total_chars <= 120,
    '2B context: hard character budget enforced');

  var rendered = context.renderContext(ctx);
  ok(rendered.indexOf('repository_state') !== -1 && rendered.indexOf('relevance') !== -1,
    '2B context: renderable for prompt injection');
})();

// ===========================================================================
// PHASE 2C — agent registry
// ===========================================================================

var agents = require(path.join(EXEC, 'core', 'agent-registry'));

(function () {
  agents.resetForTests();
  // Inject probes so the suite never shells out or touches the network.
  agents.registerProbe('claude-code', function () { return true; });
  agents.registerProbe('openai-compat', function () { return false; });
  agents.registerProbe('gemini', function () { return false; });

  var all = agents.discoverAgents();
  var names = all.map(function (a) { return a.name; });
  ok(names.indexOf('claude-code') !== -1 && names.indexOf('gemini-advisor') !== -1 &&
     names.indexOf('omniroute-advisory') !== -1, '2C agents: config agents discovered');
  var gemini = all.filter(function (a) { return a.name === 'gemini-advisor'; })[0];
  ok(gemini.available === false && gemini.execution_authority === false,
    '2C agents: Gemini registered but UNAVAILABLE without a real credential (never invented)');

  throws(function () { agents.registerAgent('Bad Name!', {}); },
    /INVALID_AGENT_NAME/, '2C agents: bad name refused');
  throws(function () {
    agents.registerAgent('half-agent', { provider: 'x', capabilities: ['a'], task_types: [], risk_level: 'low' });
  }, /AGENT_MISSING_FIELD/, '2C agents: missing execution_authority refused');
  throws(function () {
    agents.registerAgent('vague-agent', {
      provider: 'x', capabilities: ['a'], task_types: [], risk_level: 'low', execution_authority: 'yes'
    });
  }, /MUST_BE_BOOLEAN/, '2C agents: string authority refused');

  // Capability-driven selection: coding with execution authority.
  var coding = agents.selectCandidates({
    capabilities: ['coding'], task_type: 'coding', require_execution_authority: true
  }, { fresh: true });
  ok(coding.length === 1 && coding[0].name === 'claude-code',
    '2C agents: capability match finds the execution agent');

  // Claude is NOT hard-coded: a second execution agent competes on merit.
  agents.registerAgent('mock-coder', {
    provider: 'mock-exec', capabilities: ['coding', 'testing'], task_types: ['coding'],
    execution_authority: true, risk_level: 'low', cost: { tier: 'free' }
  });
  agents.registerProbe('mock-exec', function () { return true; });
  var two = agents.selectCandidates({
    capabilities: ['coding'], task_type: 'coding', require_execution_authority: true
  }, { fresh: true });
  ok(two.length === 2 && two[0].name === 'mock-coder',
    '2C agents: nothing hard-codes Claude — lower-risk available agent ranks first');

  // Advisory selection can never be promoted to execution authority.
  var advisors = agents.selectCandidates({
    capabilities: ['review'], forbid_execution_authority: true
  }, { fresh: true, include_unavailable: true });
  ok(advisors.every(function (c) { return c.definition.execution_authority === false; }),
    '2C agents: forbid_execution_authority is a hard filter');

  // Exclusion supports "reviewer must differ from author".
  var excluded = agents.selectCandidates({
    capabilities: ['coding'], require_execution_authority: true, exclude: ['claude-code']
  }, { fresh: true });
  ok(excluded.every(function (c) { return c.name !== 'claude-code'; }),
    '2C agents: exclusion honoured');

  // A crashing probe degrades to unavailable, never crashes selection.
  agents.registerAgent('flaky-agent', {
    provider: 'flaky', capabilities: ['research'], task_types: ['research'],
    execution_authority: false, risk_level: 'low'
  });
  agents.registerProbe('flaky', function () { throw new Error('probe exploded'); });
  var flaky = agents.healthCheck('flaky-agent', { fresh: true });
  ok(flaky.available === false && /probe_error/.test(flaky.detail),
    '2C agents: provider failure → unavailable, not a crash');
  var research = agents.selectCandidates({ capabilities: ['research'] }, { fresh: true });
  ok(research.every(function (c) { return c.name !== 'flaky-agent'; }),
    '2C agents: unavailable agents excluded from selection');
  ok(agents.getCapabilities('claude-code').indexOf('coding') !== -1,
    '2C agents: getCapabilities works');

  // Config completeness: every task type the planner can emit (except
  // marketing, which has no real agent yet by design) must be routable
  // by at least one CONFIGURED agent — found live when a planner
  // 'validation' task had no provider.
  var plannerTypes = require(path.join(EXEC, 'core', 'planner')).TASK_TYPES;
  var configAgents = JSON.parse(fs.readFileSync(
    path.join(EXEC, 'config', 'agents.json'), 'utf8'));
  var coveredTypes = {};
  Object.keys(configAgents).forEach(function (n) {
    (configAgents[n].task_types || []).forEach(function (tt) { coveredTypes[tt] = true; });
  });
  plannerTypes.filter(function (t) { return t !== 'marketing'; }).forEach(function (t) {
    ok(coveredTypes[t] === true, '2C agents: planner task type "' + t + '" routable by config');
  });
})();

// ===========================================================================
// PHASE 2D — tool registry
// ===========================================================================

var tools = require(path.join(EXEC, 'core', 'tool-registry'));

(function () {
  tools.resetForTests();
  var all = tools.discoverTools();
  var names = all.map(function (t) { return t.name; });
  ok(names.indexOf('git.read') !== -1 && names.indexOf('meta.create_campaign') !== -1,
    '2D tools: config tools discovered');

  throws(function () { tools.registerTool('NotDotted', { version: '1', capabilities: [], policy_class: 'READ', risk: 'low', provider: 'mock' }); },
    /INVALID_TOOL_NAME/, '2D tools: name must be namespace.action');
  throws(function () { tools.registerTool('x.y', { version: '1', capabilities: [], policy_class: 'MAGIC', risk: 'low', provider: 'mock' }); },
    /UNKNOWN_POLICY_CLASS/, '2D tools: unknown policy class refused');
  throws(function () { tools.registerTool('x.y', { version: '1', capabilities: [], policy_class: 'READ', risk: 'volcanic', provider: 'mock' }); },
    /UNKNOWN_RISK/, '2D tools: unknown risk refused');
  throws(function () {
    tools.registerTool('x.y', {
      version: '1', capabilities: [], policy_class: 'READ', risk: 'low', provider: 'mock',
      input_schema: { type: 'object', patternProperties: {} }
    });
  }, /TOOL_SCHEMA_UNSUPPORTED/, '2D tools: unsupported schema keyword caught at registration');

  // Least-privilege grants through a policy check.
  var allowReadOnly = function (req) {
    return { decision: req.action_class === 'READ' ? 'allow' : 'deny' };
  };
  var grants = tools.grantTools(['repo_inspection', 'research'], allowReadOnly);
  ok(grants.indexOf('git.read') !== -1 && grants.indexOf('web.search') === -1,
    '2D tools: policy filters grants — EXTERNAL_API denied means web.search not granted');
  ok(grants.indexOf('meta.create_campaign') === -1,
    '2D tools: capabilities not required are never granted');
  throws(function () { tools.grantTools(['x'], null); }, /GRANT_REQUIRES_POLICY/,
    '2D tools: grants impossible without a policy function');

  // Invocation: grant-checked, schema-checked.
  var repo = makeRepo('tool-repo');
  var denied = tools.invoke('git.read', { repo_path: repo }, []);
  ok(denied.ok === false && /NOT_GRANTED/.test(denied.error),
    '2D tools: ungranted invocation refused');
  var result = tools.invoke('git.read', { repo_path: repo }, ['git.read']);
  ok(result.ok === true && result.result.branch === 'main' && /^[0-9a-f]{40}$/.test(result.result.head),
    '2D tools: granted git.read returns real repo facts');
  var badInput = tools.invoke('git.read', { nonsense: true }, ['git.read']);
  ok(badInput.ok === false && /INPUT_INVALID/.test(badInput.error),
    '2D tools: input schema enforced');
  var noAdapter = tools.invoke('database.query', {}, ['database.query']);
  ok(noAdapter.ok === false && /NO_ADAPTER/.test(noAdapter.error),
    '2D tools: declarative-only tool cannot execute');
  var ghost = tools.invoke('ghost.tool', {}, ['ghost.tool']);
  ok(ghost.ok === false && /NO_SUCH_TOOL/.test(ghost.error),
    '2D tools: unknown tool handled');

  tools.registerTool('broken.tool', {
    version: '1', capabilities: ['x'], policy_class: 'READ', risk: 'low',
    provider: 'mock', available: false
  });
  var unavailable = tools.invoke('broken.tool', {}, ['broken.tool']);
  ok(unavailable.ok === false && /UNAVAILABLE/.test(unavailable.error),
    '2D tools: unavailable tool refused');

  // The campaign tool is mock/sandbox by construction — no spend path.
  var campaign = tools.invoke('meta.create_campaign',
    { daily_budget_usd: 5, duration_days: 1 }, ['meta.create_campaign']);
  ok(campaign.ok === true && campaign.mocked === true &&
     campaign.result.sandbox === true && campaign.result.published === false,
    '2D tools: campaign tool is sandbox-only, publishes nothing, spends nothing');
})();

// ===========================================================================
// PHASE 2E — mission planner
// ===========================================================================

var planner = require(path.join(EXEC, 'core', 'planner'));
var dag = require(path.join(EXEC, 'core', 'dag'));

(function () {
  var goal = domain.createGoal({ text: 'Improve SSANGYONG.AUTOS product search.', project: 'sya' });
  store.create(goal);

  var plan = planner.planMission(goal);
  ok(plan.valid && plan.tasks.length === 7, '2E planner: template plan is structured and valid');
  ok(plan.order && plan.order[0] === 'inspect' && plan.order[plan.order.length - 1] === 'report',
    '2E planner: topological order inspect→…→report');
  ok(plan.tasks.every(function (t) { return t.policy_classes.length > 0; }),
    '2E planner: every task carries policy classes');

  var parallel = planner.planMission(goal, { components: ['api', 'db'] });
  var keys = parallel.tasks.map(function (t) { return t.key; });
  ok(keys.indexOf('implement-api') !== -1 && keys.indexOf('implement-db') !== -1 &&
     keys.indexOf('integrate') !== -1, '2E planner: components fork parallel branches with integration');

  // LLM-supplied specs are validated, never trusted.
  var badSpec = planner.planFromSpec(goal, {
    title: 'sneaky plan',
    tasks: [
      { key: 'a', title: 'ok task', task_type: 'analysis', depends_on: [] },
      { key: 'b', title: 'weird', task_type: 'rm_rf_everything', depends_on: ['a'] },
      { key: 'c', title: 'sneaky', task_type: 'coding', depends_on: ['ghost'], shell_command: 'rm -rf /' },
      { key: 'a', title: 'dup', task_type: 'analysis', depends_on: [] }
    ]
  });
  ok(!badSpec.valid, '2E planner: malicious/malformed spec is invalid');
  ok(badSpec.errors.some(function (e) { return /UNKNOWN_TASK_TYPE/.test(e); }),
    '2E planner: unknown task type refused');
  ok(badSpec.errors.some(function (e) { return /UNKNOWN_FIELD.*shell_command/.test(e); }),
    '2E planner: extra fields (generated instructions) refused');
  ok(badSpec.errors.some(function (e) { return /UNKNOWN_DEPENDENCY/.test(e); }),
    '2E planner: missing dependency refused');
  ok(badSpec.errors.some(function (e) { return /DUPLICATE_TASK/.test(e); }),
    '2E planner: duplicate keys refused');
  throws(function () { planner.persistPlan(badSpec); }, /PLAN_INVALID/,
    '2E planner: invalid plan cannot persist');

  // Policy validation gate.
  var denyMoney = function (req) {
    return { decision: req.action_class === 'MONEY_SPEND' ? 'deny' : 'allow', reason: 'no budget configured' };
  };
  var marketing = planner.planFromSpec(goal, {
    title: 'campaign', tasks: [{ key: 'ad', title: 'Publish ad', task_type: 'marketing', depends_on: [] }]
  });
  var vetted = planner.validatePlan(marketing, denyMoney);
  ok(!vetted.valid && vetted.errors.some(function (e) { return /POLICY_DENIED.*MONEY_SPEND/.test(e); }),
    '2E planner: policy validation rejects unbudgeted spend before anything runs');

  ok(/MISSION:/.test(planner.explainPlan(plan)) && /⇐ after inspect/.test(planner.explainPlan(plan)),
    '2E planner: plan is inspectable before execution');

  // Persistence: mission + tasks with resolved dependency ids and states.
  var persisted = planner.persistPlan(plan);
  ok(persisted.mission.task_ids.length === 7, '2E planner: mission persisted with task ids');
  var first = persisted.tasks[0];
  var second = persisted.tasks[1];
  ok(first.status === 'QUEUED' && second.status === 'WAITING_FOR_DEPENDENCY' &&
     second.depends_on[0] === first.id,
    '2E planner: initial states and resolved dependency ids correct');
  var reloaded = store.load('mission', persisted.mission.id);
  ok(reloaded && reloaded.plan_explanation.indexOf('MISSION:') === 0,
    '2E planner: persisted mission carries its explanation');
})();

// ===========================================================================
// PHASE 2F — task DAG
// ===========================================================================

(function () {
  function t(id, status, deps) { return { id: id, status: status, depends_on: deps || [] }; }

  // Linear chain.
  var linear = [t('a', 'COMPLETED'), t('b', 'WAITING_FOR_DEPENDENCY', ['a']), t('c', 'WAITING_FOR_DEPENDENCY', ['b'])];
  var a1 = dag.assess(linear);
  ok(a1.valid && a1.ready.join(',') === 'b' && a1.waiting_dependency.join(',') === 'c',
    '2F dag: linear graph unlocks exactly the next task');

  // Branch + merge; independent branches ready in parallel.
  var branch = [
    t('api', 'QUEUED'), t('db', 'QUEUED'),
    t('integration', 'WAITING_FOR_DEPENDENCY', ['api', 'db']),
    t('tests', 'WAITING_FOR_DEPENDENCY', ['integration'])
  ];
  var a2 = dag.assess(branch);
  ok(a2.ready.sort().join(',') === 'api,db', '2F dag: independent branches ready in parallel');
  ok(a2.waiting_dependency.sort().join(',') === 'integration,tests',
    '2F dag: merge point waits for both branches');

  // Merge unlocks only when ALL parents complete.
  branch[0].status = 'COMPLETED';
  ok(dag.assess(branch).ready.indexOf('integration') === -1,
    '2F dag: merge stays blocked while one parent is open');
  branch[1].status = 'COMPLETED';
  ok(dag.assess(branch).ready.join(',') === 'integration',
    '2F dag: merge unlocks when all parents complete');

  // Cycle detection.
  var cyclic = dag.validateGraph([t('x', 'QUEUED', ['z']), t('y', 'QUEUED', ['x']), t('z', 'QUEUED', ['y'])]);
  ok(!cyclic.valid && /CYCLE_DETECTED/.test(cyclic.errors[0]), '2F dag: cycles detected');
  var selfDep = dag.validateGraph([t('x', 'QUEUED', ['x'])]);
  ok(!selfDep.valid && /SELF_DEPENDENCY/.test(selfDep.errors[0]), '2F dag: self-dependency detected');
  var missing = dag.validateGraph([t('x', 'QUEUED', ['nope'])]);
  ok(!missing.valid && /UNKNOWN_DEPENDENCY/.test(missing.errors[0]), '2F dag: missing dependency detected');

  // Failure propagation: FAILED ancestor dooms all descendants, transitively.
  var failed = [
    t('root', 'FAILED'), t('mid', 'WAITING_FOR_DEPENDENCY', ['root']),
    t('leaf', 'WAITING_FOR_DEPENDENCY', ['mid']), t('free', 'QUEUED')
  ];
  var a3 = dag.assess(failed);
  ok(a3.doomed.map(function (d) { return d.id; }).sort().join(',') === 'leaf,mid',
    '2F dag: failure propagates transitively');
  ok(a3.doomed.every(function (d) { return d.blocked_by.indexOf('root') !== -1; }),
    '2F dag: doomed tasks name the blocking ancestor');
  ok(a3.ready.join(',') === 'free', '2F dag: unrelated tasks unaffected by the failure');
  ok(!a3.all_terminal, '2F dag: mission with doomed tasks is not terminal-complete');

  // Restart recovery is recomputation over persisted statuses (purity).
  var persistedStates = JSON.parse(JSON.stringify(branch));
  var recovered = dag.assess(persistedStates);
  ok(recovered.ready.join(',') === 'integration',
    '2F dag: assessment over persisted statuses IS restart recovery');
})();

// ===========================================================================
// PHASE 2H — policy engine
// ===========================================================================

var policyEngine = require(path.join(EXEC, 'core', 'policy-engine'));

(function () {
  var engine = policyEngine.createEngine();
  ok(engine.checkPolicy({ action_class: 'READ' }).decision === 'allow', '2H policy: READ auto-allowed');
  ok(engine.checkPolicy({ action_class: 'GIT' }).decision === 'allow', '2H policy: GIT allowed');
  ok(engine.checkPolicy({ action_class: 'DEPLOY' }).decision === 'require_approval', '2H policy: DEPLOY needs approval');
  ok(engine.checkPolicy({ action_class: 'ROOT' }).decision === 'deny', '2H policy: ROOT denied');
  ok(engine.checkPolicy({ action_class: 'DESTRUCTIVE' }).decision === 'deny', '2H policy: DESTRUCTIVE denied');
  ok(engine.checkPolicy({ action_class: 'TELEPATHY' }).decision === 'deny', '2H policy: unknown class → deny');

  // The hard floor beats hostile configuration.
  var hostile = policyEngine.createEngine({
    policy_id: 'hostile-v1',
    classes: { READ: 'allow', PROJECT_WRITE: 'allow', GIT: 'allow', SERVICE: 'allow',
      DEPLOY: 'allow', ROOT: 'allow', EXTERNAL_API: 'allow', DESTRUCTIVE: 'allow' },
    money_spend: { enabled: true, daily_limit_usd: 100000 }
  });
  var rootCheck = hostile.checkPolicy({ action_class: 'ROOT' });
  ok(rootCheck.decision === 'deny' && /HARD FLOOR/.test(rootCheck.reason),
    '2H policy: config cannot loosen ROOT — hard floor wins and says so');
  ok(hostile.checkPolicy({ action_class: 'DESTRUCTIVE' }).decision === 'deny',
    '2H policy: config cannot loosen DESTRUCTIVE');

  // Money: disabled → deny; configured → threshold behavior. Limits come
  // from configuration only, never hard-coded.
  ok(engine.checkPolicy({ action_class: 'MONEY_SPEND', amount_usd: 1 }).decision === 'deny',
    '2H policy: spending disabled by default');
  var budget = policyEngine.createEngine({
    policy_id: 'budget-v1',
    classes: { READ: 'allow', PROJECT_WRITE: 'allow', GIT: 'allow', SERVICE: 'require_approval',
      DEPLOY: 'require_approval', ROOT: 'deny', EXTERNAL_API: 'allow', DESTRUCTIVE: 'deny' },
    money_spend: { enabled: true, daily_limit_usd: 5 }
  });
  ok(budget.checkPolicy({ action_class: 'MONEY_SPEND', amount_usd: 5 }).decision === 'allow',
    '2H policy: within configured limit → allow');
  ok(budget.checkPolicy({ action_class: 'MONEY_SPEND', amount_usd: 5.01 }).decision === 'require_approval',
    '2H policy: above configured limit → approval, not silent spend');
  ok(budget.checkPolicy({ action_class: 'MONEY_SPEND' }).decision === 'deny',
    '2H policy: undeclared amount → deny');

  // Aggregation: deny > approval > allow.
  ok(engine.checkClasses(['READ', 'SERVICE']).decision === 'require_approval',
    '2H policy: aggregate escalates to approval');
  ok(engine.checkClasses(['READ', 'SERVICE', 'ROOT']).decision === 'deny',
    '2H policy: aggregate deny wins over approval');
  ok(/Policy .* decided/.test(engine.explainPolicyDecision({ action_class: 'DEPLOY' })),
    '2H policy: decisions are explainable');

  // No bypass surface: frozen, no mutators, config path is committed file.
  ok(Object.isFrozen(engine) && engine.setPolicy === undefined && engine.allow === undefined,
    '2H policy: engine exposes no mutation API');

  // Approval lifecycle: a state, not a prompt.
  var approval = policyEngine.requestApproval('tk-aaaaaa-0001', 'DEPLOY', 'deploy to staging');
  ok(approval.status === 'PENDING', '2H approvals: request creates PENDING record');
  ok(policyEngine.pendingApprovals('tk-aaaaaa-0001').length === 1, '2H approvals: pending queryable');
  throws(function () { policyEngine.decideApproval(approval.id, true, ''); },
    /NEEDS_DECIDER/, '2H approvals: decision requires a recorded human identity');
  var granted = policyEngine.decideApproval(approval.id, true, 'othman');
  ok(granted.status === 'GRANTED' && granted.decided_by === 'othman' && granted.decided_at,
    '2H approvals: grant recorded with decider and time');
  throws(function () { policyEngine.decideApproval(approval.id, false, 'othman'); },
    /ALREADY_DECIDED/, '2H approvals: no re-deciding');
})();

// ===========================================================================
// PHASE 2G — parallel execution + worktree isolation
// ===========================================================================

var scheduler = require(path.join(EXEC, 'core', 'scheduler'));
var worktrees = require(path.join(EXEC, 'core', 'worktrees'));

function buildMission(goalText, specTasks, hints) {
  var goal = domain.createGoal({ text: goalText, project: 'core-test' });
  store.create(goal);
  var plan = planner.planFromSpec(goal, { title: goalText, tasks: specTasks });
  if (!plan.valid) throw new Error('test mission invalid: ' + plan.errors.join('; '));
  var persisted = planner.persistPlan(plan);
  store.transition('mission', persisted.mission.id, 'VALIDATED');
  if (hints && hints.max_parallel) {
    var m = store.load('mission', persisted.mission.id);
    m.max_parallel_agents = hints.max_parallel;
    store.save(m);
  }
  return persisted;
}

var chain2 = Promise.resolve();

// --- Bounded parallelism over independent tasks ------------------------------
chain2 = chain2.then(function () {
  var spec = ['w1', 'w2', 'w3', 'w4'].map(function (k) {
    return { key: k, title: 'independent ' + k, task_type: 'analysis', depends_on: [] };
  });
  var m = buildMission('four independent analyses', spec, { max_parallel: 2 });
  var concurrent = 0, peak = 0;
  return scheduler.runMission(m.mission.id, {
    runner: function () {
      concurrent += 1; peak = Math.max(peak, concurrent);
      return new Promise(function (resolve) {
        setTimeout(function () { concurrent -= 1; resolve({ status: 'COMPLETED', result: { ok: 1 } }); }, 25);
      });
    }
  }).then(function (mission) {
    ok(mission.status === 'COMPLETED', '2G parallel: mission completes');
    ok(peak === 2, '2G parallel: concurrency bounded at max_parallel=2 (peak ' + peak + ')');
    ok(mission.metadata.peak_concurrency === 2, '2G parallel: peak recorded on the mission');
    var states = m.tasks.map(function (t) { return store.load('task', t.id).status; });
    ok(states.every(function (s) { return s === 'COMPLETED'; }), '2G parallel: all tasks completed');
  });
});

// --- True overlap of independent tasks; dependent task waits ------------------
chain2 = chain2.then(function () {
  var spec = [
    { key: 'api', title: 'api branch', task_type: 'analysis', depends_on: [] },
    { key: 'db', title: 'db branch', task_type: 'analysis', depends_on: [] },
    { key: 'integrate', title: 'merge', task_type: 'validation', depends_on: ['api', 'db'] }
  ];
  var m = buildMission('branch and merge', spec, { max_parallel: 4 });
  var events = [];
  return scheduler.runMission(m.mission.id, {
    runner: function (task) {
      events.push({ key: task.metadata.plan_key, at: 'start', t: Date.now() });
      return new Promise(function (resolve) {
        setTimeout(function () {
          events.push({ key: task.metadata.plan_key, at: 'end', t: Date.now() });
          resolve({ status: 'COMPLETED' });
        }, 20);
      });
    }
  }).then(function (mission) {
    ok(mission.status === 'COMPLETED', '2G overlap: mission completes');
    var apiStart = events.filter(function (e) { return e.key === 'api' && e.at === 'start'; })[0];
    var dbEnd = events.filter(function (e) { return e.key === 'db' && e.at === 'end'; })[0];
    var apiEnd = events.filter(function (e) { return e.key === 'api' && e.at === 'end'; })[0];
    var integrateStart = events.filter(function (e) { return e.key === 'integrate' && e.at === 'start'; })[0];
    ok(apiStart.t < dbEnd.t, '2G overlap: independent branches ran concurrently');
    ok(integrateStart.t >= apiEnd.t && integrateStart.t >= dbEnd.t,
      '2G overlap: dependent merge waited for BOTH branches');
  });
});

// --- Isolated worktrees for parallel coding tasks ------------------------------
chain2 = chain2.then(function () {
  var repo = makeRepo('parallel-repo');
  var spec = [
    { key: 'code-a', title: 'feature A', task_type: 'coding', depends_on: [] },
    { key: 'code-b', title: 'feature B', task_type: 'coding', depends_on: [] }
  ];
  var m = buildMission('parallel coding', spec, { max_parallel: 2 });
  var seenDirs = {};
  return scheduler.runMission(m.mission.id, {
    repo_path: repo,
    runner: function (task, ctx) {
      seenDirs[task.metadata.plan_key] = ctx.worktree.dir;
      // Each agent writes and commits in ITS OWN tree.
      fs.writeFileSync(path.join(ctx.worktree.dir, task.metadata.plan_key + '.txt'), 'work\n');
      cp.execFileSync('git', ['add', '.'], { cwd: ctx.worktree.dir });
      cp.execFileSync('git', ['commit', '-q', '-m', task.metadata.plan_key], { cwd: ctx.worktree.dir });
      return Promise.resolve({ status: 'COMPLETED' });
    }
  }).then(function (mission) {
    ok(mission.status === 'COMPLETED', '2G worktrees: mission completes');
    ok(seenDirs['code-a'] && seenDirs['code-b'] && seenDirs['code-a'] !== seenDirs['code-b'],
      '2G worktrees: two coding agents never share a working tree');
    var branches = cp.execFileSync('git', ['branch', '--list', 'mythos/*'], { cwd: repo, encoding: 'utf8' });
    ok(branches.split('\n').filter(Boolean).length === 2,
      '2G worktrees: each task committed on its own branch');
    ok(!fs.existsSync(path.join(repo, 'code-a.txt')),
      '2G worktrees: the main checkout is untouched');
    // Dirty worktree removal refused without force.
    var taskA = m.tasks.filter(function (t) { return t.metadata.plan_key === 'code-a'; })[0];
    fs.writeFileSync(path.join(seenDirs['code-a'], 'uncommitted.txt'), 'precious\n');
    var refused = worktrees.remove(repo, m.mission.id, taskA.id);
    ok(refused.removed === false && /refusing to destroy/.test(refused.reason),
      '2G worktrees: dirty tree never destroyed without force');
  });
});

// --- Failure isolation: one branch fails, independent work finishes ------------
chain2 = chain2.then(function () {
  var spec = [
    { key: 'doomed-root', title: 'will fail', task_type: 'analysis', depends_on: [] },
    { key: 'dependent', title: 'depends on failure', task_type: 'analysis', depends_on: ['doomed-root'] },
    { key: 'independent', title: 'unrelated', task_type: 'analysis', depends_on: [] }
  ];
  var m = buildMission('failure isolation', spec);
  return scheduler.runMission(m.mission.id, {
    runner: function (task) {
      if (task.metadata.plan_key === 'doomed-root') {
        return Promise.resolve({ status: 'FAILED', error: 'deterministic failure' });
      }
      return Promise.resolve({ status: 'COMPLETED' });
    }
  }).then(function (mission) {
    ok(mission.status === 'FAILED', '2G failure: mission reports failure');
    var byKey = {};
    m.tasks.forEach(function (t) { byKey[t.metadata.plan_key] = store.load('task', t.id); });
    ok(byKey['independent'].status === 'COMPLETED', '2G failure: independent branch finished');
    ok(byKey['dependent'].status === 'WAITING_FOR_DEPENDENCY',
      '2G failure: dependent task remains blocked, never run');
    ok(mission.metadata.doomed.some(function (d) { return d.id === byKey['dependent'].id; }),
      '2G failure: doomed task recorded on the mission');
  });
});

// --- Policy denial cancels the task; approval parks and resumes -----------------
chain2 = chain2.then(function () {
  var spec = [
    { key: 'nuke', title: 'destroy database', task_type: 'generic',
      policy_classes: ['DESTRUCTIVE'], depends_on: [] }
  ];
  var m = buildMission('destructive request', spec);
  return scheduler.runMission(m.mission.id, {
    runner: function () { throw new Error('runner must never be called for denied tasks'); }
  }).then(function (mission) {
    var task = store.load('task', m.tasks[0].id);
    ok(task.status === 'CANCELLED' && /HARD FLOOR|deny/.test(task.metadata.policy_denied),
      '2G policy: DESTRUCTIVE task cancelled before any execution');
    ok(mission.status === 'FAILED', '2G policy: mission honestly fails');
  });
}).then(function () {
  var spec = [
    { key: 'svc', title: 'reload service', task_type: 'generic',
      policy_classes: ['SERVICE'], depends_on: [] }
  ];
  var m = buildMission('service change needs approval', spec);
  var ran = { count: 0 };
  var runner = function () { ran.count += 1; return Promise.resolve({ status: 'COMPLETED' }); };
  return scheduler.runMission(m.mission.id, { runner: runner }).then(function (mission) {
    var task = store.load('task', m.tasks[0].id);
    ok(mission.status === 'WAITING' && task.status === 'WAITING_FOR_APPROVAL' && ran.count === 0,
      '2G approval: task parks in WAITING_FOR_APPROVAL without executing');
    var pending = policyEngine.pendingApprovals(task.id);
    ok(pending.length === 1, '2G approval: approval record created once');
    scheduler.applyApproval(pending[0].id, 'othman');
    ok(store.load('task', task.id).status === 'READY', '2G approval: grant releases the task');
    return scheduler.runMission(m.mission.id, { runner: runner });
  }).then(function (mission) {
    ok(mission.status === 'COMPLETED' && ran.count === 1,
      '2G approval: approved task ran exactly once — no repeated prompting');
  });
});

// ===========================================================================
// PHASE 2I — validation + adversarial review
// ===========================================================================

var validation = require(path.join(EXEC, 'core', 'validation'));

(function () {
  var task = domain.createTask({ title: 'validated work', project: 'core-test', policy_classes: ['READ', 'GIT'] });
  var good = { status: 'completed', summary: 'did the thing', actions_used: ['READ'] };
  ok(validation.validate(task, good).pass, '2I validate: sound result passes');
  ok(!validation.validate(task, { status: 'completed' }).pass, '2I validate: missing summary rejected');
  ok(!validation.validate(task, { status: 'victory', summary: 'x' }).pass, '2I validate: invalid status rejected');

  var leaky = { status: 'completed', summary: 'here is sk-ant-abcdefghijklmnopqrstu12345 for you' };
  var sec = validation.validate(task, leaky);
  ok(!sec.pass && sec.rejections.some(function (r) { return /security/.test(r); }),
    '2I validate: secret shapes rejected by security validator');

  var overreach = { status: 'completed', summary: 'x', actions_used: ['DEPLOY'] };
  var pol = validation.validate(task, overreach);
  ok(!pol.pass && pol.rejections.some(function (r) { return /never granted/.test(r); }),
    '2I validate: undeclared action class rejected by policy validator');

  var needy = domain.createTask({
    title: 'needy', project: 'core-test',
    metadata: { required_fields: ['commit'], required_tests: ['unit-suite'] }
  });
  var incomplete = validation.validate(needy, { status: 'completed', summary: 'x' }, {
    test_runner: function () { return { pass: true }; }
  });
  ok(!incomplete.pass && incomplete.rejections.some(function (r) { return /required field missing: commit/.test(r); }),
    '2I validate: completeness enforces required fields');
  var failingTests = validation.validate(needy, { status: 'completed', summary: 'x', commit: 'abc' }, {
    test_runner: function () { return { pass: false, detail: '3 assertions failed' }; }
  });
  ok(!failingTests.pass && failingTests.rejections.some(function (r) { return /required test failed/.test(r); }),
    '2I validate: failing required tests reject');

  var repo = makeRepo('validate-repo');
  var head = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  ok(validation.validate(task, { status: 'completed', summary: 'x', commit: head }, { repo_path: repo }).pass,
    '2I validate: real commit verifies');
  var fake = validation.validate(task, {
    status: 'completed', summary: 'x', commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
  }, { repo_path: repo });
  ok(!fake.pass && fake.rejections.some(function (r) { return /does not exist/.test(r); }),
    '2I validate: invented commit rejected');

  // PLACEHOLDER commits: an agent writing the string "null"/"none"/"N/A"
  // means it produced NO commit, not a fabricated one. Failing an analysis
  // task for that blocked a live campaign, so it is treated as absent —
  // while a task that genuinely owes a commit still fails.
  var analysisTask = domain.createTask({ title: 'analysis', project: 'core-test', task_type: 'analysis' });
  ['null', 'none', 'N/A', '', '  ', 'TBD'].forEach(function (ph) {
    ok(validation.validate(analysisTask, { status: 'completed', summary: 'x', commit: ph },
      { repo_path: repo }).pass,
      '2I validate: placeholder commit "' + ph + '" is absent, not invented, on a non-coding task');
  });
  var codingTask = domain.createTask({ title: 'coding', project: 'core-test', task_type: 'coding' });
  ok(!validation.validate(codingTask, { status: 'completed', summary: 'x', commit: 'null' },
    { repo_path: repo }).pass,
    '2I validate: a coding task claiming "null" still fails — it owed a commit');
  ok(!validation.validate(codingTask, { status: 'completed', summary: 'x', commit: 'not-a-sha!' },
    { repo_path: repo }).pass,
    '2I validate: a malformed hash on a coding task still fails');
  ok(!validation.validate(codingTask, { status: 'completed', summary: 'x' },
    { repo_path: repo }).pass,
    '2I validate: a coding task with no commit at all still fails');
})();

(function () {
  // Adversarial review: reviewer must differ from author.
  agents.registerAgent('mock-reviewer', {
    provider: 'mock-rev', capabilities: ['review', 'analysis'], task_types: ['review'],
    execution_authority: false, risk_level: 'low', cost: { tier: 'free' }
  });
  agents.registerProbe('mock-rev', function () { return true; });

  var task = domain.createTask({ title: 'authored work', project: 'core-test', agent_id: 'mock-reviewer' });
  var review = validation.adversarialReview(task, { status: 'completed', summary: 'x' }, {
    review_fn: function (reviewer) {
      return { verdict: 'pass', findings: [], _reviewer: reviewer };
    }
  });
  ok(review.performed && review.reviewer !== 'mock-reviewer',
    '2I review: the author never reviews itself');

  var reject = validation.adversarialReview(
    domain.createTask({ title: 'buggy work', project: 'core-test', agent_id: 'claude-code' }),
    { status: 'completed', summary: 'looks done' },
    { review_fn: function () { return { verdict: 'reject', findings: ['edge case: empty input crashes'] }; } });
  ok(reject.verdict === 'reject' && reject.findings.length === 1,
    '2I review: adversarial findings reject a "completed" result');

  // Repair loop: reject → RETRYING with findings → repaired → COMPLETED.
  var t = domain.createTask({ title: 'repairable', project: 'core-test', max_attempts: 3 });
  store.create(t);
  store.transition('task', t.id, 'READY');
  store.transition('task', t.id, 'RUNNING', { attempt: 1 });
  store.transition('task', t.id, 'VALIDATING');
  var afterReject = validation.validateAndSettle(t.id, { status: 'completed' }, { review: false });
  ok(afterReject.status === 'RETRYING' &&
     afterReject.metadata.validation_rejections.some(function (r) { return /summary/.test(r); }),
    '2I settle: rejection → RETRYING with findings recorded for the repairing agent');
  store.transition('task', t.id, 'RUNNING', { attempt: 2 });
  store.transition('task', t.id, 'VALIDATING');
  var afterRepair = validation.validateAndSettle(t.id,
    { status: 'completed', summary: 'repaired properly' }, { review: false });
  ok(afterRepair.status === 'COMPLETED', '2I settle: repaired result passes and completes');

  // A result that REPORTS failure never settles as COMPLETED (found live
  // in the first real mission: an executor failure surfaced as a
  // schema-valid "failed" result).
  var honest = domain.createTask({ title: 'honest failure', project: 'core-test', max_attempts: 3 });
  store.create(honest);
  store.transition('task', honest.id, 'READY');
  store.transition('task', honest.id, 'RUNNING', { attempt: 1 });
  store.transition('task', honest.id, 'VALIDATING');
  var settledFail = validation.validateAndSettle(honest.id,
    { status: 'failed', summary: 'executor task x → FAILED' }, { review: false });
  ok(settledFail.status === 'RETRYING' &&
     settledFail.metadata.validation_rejections.some(function (r) { return /reports failure/.test(r); }),
    '2I settle: a failure-reporting result rejects into repair, never COMPLETED');

  // Attempt budget: rejection with no attempts left → FAILED.
  var doomed = domain.createTask({ title: 'unfixable', project: 'core-test', max_attempts: 1 });
  store.create(doomed);
  store.transition('task', doomed.id, 'READY');
  store.transition('task', doomed.id, 'RUNNING', { attempt: 1 });
  store.transition('task', doomed.id, 'VALIDATING');
  ok(validation.validateAndSettle(doomed.id, { status: 'completed' }, { review: false }).status === 'FAILED',
    '2I settle: attempt budget exhausted → FAILED, never an infinite repair loop');
  throws(function () { validation.validateAndSettle(doomed.id, {}, {}); }, /NOT_VALIDATING/,
    '2I settle: only VALIDATING tasks settle');
})();

// ===========================================================================
// PHASE 2J — multi-provider routing + fallback
// ===========================================================================

var router = require(path.join(EXEC, 'core', 'provider-router'));
var reputation = require(path.join(EXEC, 'core', 'reputation'));

(function () {
  // Two available advisory research agents for fallback exercises.
  agents.registerAgent('adv-a', {
    provider: 'adv1', capabilities: ['research', 'review'], task_types: ['research', 'review'],
    execution_authority: false, risk_level: 'low', cost: { tier: 'free' }
  });
  agents.registerAgent('adv-b', {
    provider: 'adv2', capabilities: ['research', 'review'], task_types: ['research', 'review'],
    execution_authority: false, risk_level: 'low', cost: { tier: 'metered' }
  });
  agents.registerProbe('adv1', function () { return true; });
  agents.registerProbe('adv2', function () { return true; });

  var coding = domain.createTask({ title: 'implement feature', project: 'core-test', task_type: 'coding', capabilities_required: ['coding'] });
  var routed = router.route(coding, { fresh: true });
  ok(routed.action === 'route' && routed.authority === true,
    '2J route: coding routes to an execution-authority agent');

  // Quota exhaustion on an execution task: WAIT — never a downgrade, never failure.
  var quotaState = {};
  quotaState[routed.agent] = { exhausted: true, resume_after: '2099-01-01T00:00:00Z' };
  var waiting = router.route(coding, { quota_state: quotaState, fresh: true });
  ok(waiting.action === 'wait_for_quota' && /never fall back/.test(waiting.reason),
    '2J route: execution task under quota waits — authority never silently changes');

  // Advisory fallback within the same (non-)authority, policy-permitted.
  var research = domain.createTask({ title: 'market research', project: 'core-test', task_type: 'research', capabilities_required: ['research'] });
  var primary = router.route(research, { fresh: true });
  ok(primary.action === 'route' && primary.agent === 'adv-a',
    '2J route: research routes to the preferred advisory agent');
  var qs = { 'adv-a': { exhausted: true } };
  var fb = router.route(research, { quota_state: qs, fresh: true });
  ok(fb.action === 'fallback' && fb.agent === 'adv-b' && fb.from === 'adv-a' && fb.authority === false,
    '2J route: quota-exhausted advisory task falls back to a SAME-authority alternate');
  ok(store.readEvents().some(function (e) {
    return e.event_type === 'PROVIDER_FALLBACK' && e.detail.to === 'adv-b';
  }), '2J route: fallback is evented with from/to');

  // Fallback failure: everyone exhausted → wait, task preserved.
  var allOut = { 'adv-a': { exhausted: true }, 'adv-b': { exhausted: true } };
  var stuck = router.route(research, { quota_state: allOut, fresh: true });
  ok(stuck.action === 'wait_for_quota' && /no same-authority fallback/.test(stuck.reason),
    '2J route: fallback exhaustion degrades to waiting, never to failure');

  // Resume: quota restored → same primary again.
  var resumed = router.route(research, { quota_state: {}, fresh: true });
  ok(resumed.action === 'route' && resumed.agent === 'adv-a', '2J route: resume returns to the primary');

  // No suitable provider at all.
  var weird = domain.createTask({ title: 'quantum embroidery', project: 'core-test', task_type: 'research', capabilities_required: ['quantum_embroidery'] });
  var none = router.route(weird, { fresh: true });
  ok(none.action === 'no_provider', '2J route: impossible capability → structured no_provider');
  ok(store.readEvents().some(function (e) { return e.event_type === 'PROVIDER_UNAVAILABLE'; }),
    '2J route: unavailability is evented');

  // Reputation: only sufficient evidence reorders; never one result.
  reputation.recordOutcome('adv-b', 'research', true);
  var one = reputation.stats('adv-b', 'research');
  ok(one.rate === null && one.sufficient === false,
    '2J reputation: a single outcome yields NO rate — unknown is not invented');
  var after1 = router.route(research, { fresh: true });
  ok(after1.agent === 'adv-a', '2J reputation: one good result does not flip priority');
  for (var i = 0; i < 5; i++) {
    reputation.recordOutcome('adv-b', 'research', true);
    reputation.recordOutcome('adv-a', 'research', i === 0); // 1 success, 4 failures
  }
  reputation.recordOutcome('adv-a', 'research', false);
  var informed = router.route(research, { fresh: true });
  ok(informed.agent === 'adv-b',
    '2J reputation: sufficient historical evidence reorders candidates');
})();

// ===========================================================================
// PHASE 2K — event engine
// ===========================================================================

var events = require(path.join(EXEC, 'core', 'events'));

(function () {
  events.resetSubscribersForTests();
  var seen = [];
  var wild = [];
  var un = events.subscribe('TASK_COMPLETED', function (e) { seen.push(e); });
  events.subscribe('*', function (e) { wild.push(e.event_type); });
  events.subscribe('TASK_FAILED', function () { throw new Error('bad subscriber'); });

  var before = events.replay().length;
  var emitted = events.emit('TASK_COMPLETED', { subject_id: 'tk-aaaaaa-0002', detail: { note: 'done' } });
  ok(emitted.event_type === 'TASK_COMPLETED' && seen.length === 1 && wild.indexOf('TASK_COMPLETED') !== -1,
    '2K events: emit reaches typed and wildcard subscribers');
  ok(events.replay().length === before + 1, '2K events: emission is durable');

  // A throwing subscriber cannot break emit or durability.
  var failEvent = events.emit('TASK_FAILED', { subject_id: 'tk-aaaaaa-0002' });
  ok(failEvent.event_type === 'TASK_FAILED', '2K events: throwing subscriber never breaks emit');
  ok(events.replay().some(function (e) {
    return e.detail && e.detail.subscriber_error && e.detail.for_event === 'TASK_FAILED';
  }), '2K events: subscriber failure recorded, not hidden');

  throws(function () { events.emit('NOT_A_TYPE', {}); }, /UNKNOWN_EVENT_TYPE/,
    '2K events: type enum enforced at emit');
  throws(function () { events.subscribe('NOT_A_TYPE', function () {}); }, /UNKNOWN_EVENT_TYPE/,
    '2K events: type enum enforced at subscribe');

  un();
  events.emit('TASK_COMPLETED', { subject_id: 'tk-aaaaaa-0003' });
  ok(seen.length === 1, '2K events: unsubscribe works');

  // n8n stays an adapter: forwarding is injectable and fire-and-forget.
  var forwarded = [];
  events.emit('COMMIT_CREATED', { subject_id: 'tk-aaaaaa-0003', detail: { commit: 'abc123' } },
    { forwarder: function (e) { forwarded.push(e.event_type); } });
  ok(forwarded.join(',') === 'COMMIT_CREATED', '2K events: webhook forwarder receives the event');
  var sinceAll = events.replay('2099-01-01T00:00:00Z');
  ok(sinceAll.length === 0, '2K events: replay respects the since filter');
})();

// ===========================================================================
// PHASE 2L — controlled self-improvement (+ §34 TEST S)
// ===========================================================================

var selfImprove = require(path.join(EXEC, 'core', 'self-improve'));
var orchestrator = require(path.join(EXEC, 'core', 'orchestrator'));

(function () {
  ok(selfImprove.isProtectedPath('projects/mythos-ai-executor/core/policy-engine.js'),
    '2L guard: policy engine is protected');
  ok(selfImprove.isProtectedPath('some/dir/credentials.json') &&
     selfImprove.isProtectedPath('app/.env.production') &&
     selfImprove.isProtectedPath('home/.ssh/config'),
    '2L guard: credential-shaped paths are protected by pattern');
  ok(!selfImprove.isProtectedPath('projects/mythos-ai-executor/core/dag.js'),
    '2L guard: ordinary core code is improvable');

  throws(function () {
    selfImprove.buildSelfImprovementMission('weaken the policy', {
      repo_path: '/anywhere', scope_paths: ['projects/mythos-ai-executor/config/policy.json']
    });
  }, /SELF_PROTECTION/, '2L guard: mission scoped at the safeguard surface refused at build time');
  throws(function () {
    selfImprove.buildSelfImprovementMission('touch secrets', {
      repo_path: '/anywhere', scope_paths: ['ops/credentials/github.env']
    });
  }, /SELF_PROTECTION/, '2L guard: credential-path scope refused');
  throws(function () {
    selfImprove.buildSelfImprovementMission('no scope', { repo_path: '/anywhere' });
  }, /NEEDS_SCOPE/, '2L guard: undeclared scope refused');
})();

chain2 = chain2.then(function () {
  // TEST S — a real controlled self-improvement cycle on a throwaway
  // repo: isolated worktree, small safe change, tests, review, a
  // reviewable commit on its own branch, main checkout untouched.
  var repo = makeRepo('self-repo');
  var mainHeadBefore = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  var setup = selfImprove.buildSelfImprovementMission(
    'Add docs/NOTES.md explaining the fixture repo.', {
      repo_path: repo, scope_paths: ['docs/NOTES.md'], project: 'mythos-self-test'
    });
  ok(setup.mission.status === 'PLANNED' && setup.tasks.length === 4,
    'S self: mission planned with implement→test→review→report shape');
  store.transition('mission', setup.mission.id, 'VALIDATED');

  var implementCommit = null;
  var safety = null;
  return orchestrator.advanceMission(setup.mission.id, {
    repo_path: repo,
    agent_runner: function (agentName, task, ctx) {
      if (task.task_type === 'coding') {
        fs.mkdirSync(path.join(ctx.worktree.dir, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(ctx.worktree.dir, 'docs', 'NOTES.md'), '# Notes\nFixture repo.\n');
        cp.execFileSync('git', ['add', '.'], { cwd: ctx.worktree.dir });
        cp.execFileSync('git', ['commit', '-q', '-m', 'docs: add NOTES.md'], { cwd: ctx.worktree.dir });
        implementCommit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.worktree.dir, encoding: 'utf8' }).trim();
        safety = selfImprove.checkWorktreeSafety(ctx.worktree.dir, ctx.worktree.base);
        var t = store.load('task', task.id);
        t.metadata.worktree_dir = ctx.worktree.dir;
        store.save(t);
        return { status: 'completed', summary: 'NOTES.md added in isolated worktree', commit: implementCommit };
      }
      return { status: 'completed', summary: task.task_type + ' pass: 1/1' };
    },
    review_fn: function (reviewer, task, result) {
      return { verdict: 'pass', findings: [] };
    }
  }).then(function (mission) {
    ok(mission.status === 'COMPLETED', 'S self: controlled self-improvement mission completed');
    ok(safety && safety.safe === true && safety.changed.indexOf('docs/NOTES.md') !== -1,
      'S self: real diff verified inside declared scope');
    var mainHeadAfter = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    ok(mainHeadAfter === mainHeadBefore, 'S self: live checkout NEVER modified — commit is reviewable, not merged');
    var branches = cp.execFileSync('git', ['branch', '--list', 'mythos/*'], { cwd: repo, encoding: 'utf8' });
    ok(/mythos\//.test(branches), 'S self: change lives on an isolated mythos/ branch');
    ok(cp.execFileSync('git', ['log', '--oneline', '--all'], { cwd: repo, encoding: 'utf8' }).indexOf('NOTES.md') !== -1,
      'S self: reviewable commit exists');

    // The post-hoc diff guard catches a protected-path edit regardless of
    // declared scope.
    var wtDir = path.join(FIXTURES, 'sneaky-wt');
    cp.execFileSync('git', ['worktree', 'add', '-b', 'sneaky', wtDir], { cwd: repo });
    fs.mkdirSync(path.join(wtDir, 'projects', 'mythos-ai-executor', 'config'), { recursive: true });
    fs.writeFileSync(path.join(wtDir, 'projects', 'mythos-ai-executor', 'config', 'policy.json'), '{}');
    cp.execFileSync('git', ['add', '.'], { cwd: wtDir });
    cp.execFileSync('git', ['commit', '-q', '-m', 'sneaky policy edit'], { cwd: wtDir });
    var sneaky = selfImprove.checkWorktreeSafety(wtDir, 'HEAD~1');
    ok(sneaky.safe === false && sneaky.violations.length === 1,
      'S self: undeclared protected-path modification detected in the REAL diff');
  });
});

// ===========================================================================
// PHASE 2M — §34 acceptance: integrated goal→…→next-decision (TESTS A–R)
// ===========================================================================

chain2 = chain2.then(function () {
  var repo = makeRepo('accept-repo');
  var timeline = [];
  var grantsSeen = {};

  // TEST A/B/C: goal → mission → DAG.
  var submitted = orchestrator.submitGoal('Build the acceptance feature across two components.', {
    project: 'core-accept',
    spec: {
      title: 'Acceptance mission',
      tasks: [
        { key: 'code-x', title: 'Implement X', task_type: 'coding', capabilities_required: ['coding'], depends_on: [] },
        { key: 'code-y', title: 'Implement Y', task_type: 'coding', capabilities_required: ['coding'], depends_on: [] },
        { key: 'integrate', title: 'Integrate X+Y', task_type: 'integration', capabilities_required: ['coding'], depends_on: ['code-x', 'code-y'] },
        { key: 'summarize', title: 'Summarize', task_type: 'reporting', capabilities_required: ['repo_inspection'], depends_on: ['integrate'] }
      ]
    }
  });
  ok(!submitted.rejected && submitted.goal.status === 'ACTIVE',
    'A accept: goal created and activated');
  ok(events.replay().some(function (e) { return e.event_type === 'GOAL_CREATED' && e.subject_id === submitted.goal.id; }),
    'A accept: GOAL_CREATED evented');
  ok(submitted.mission.status === 'VALIDATED' && submitted.mission.task_ids.length === 4,
    'B accept: goal became a validated mission');
  var graph = dag.assess(submitted.tasks);
  ok(graph.valid && graph.ready.length === 2,
    'C accept: mission is a valid DAG with two independent roots');

  return orchestrator.advanceMission(submitted.mission.id, {
    repo_path: repo,
    max_parallel: 2,
    agent_runner: function (agentName, task, ctx) {
      timeline.push({ key: task.metadata.plan_key, at: 'start', t: Date.now() });
      grantsSeen[task.metadata.plan_key] = ctx.tool_grants;
      var work;
      if (task.task_type === 'coding' || task.task_type === 'integration') {
        fs.writeFileSync(path.join(ctx.worktree.dir, task.metadata.plan_key + '.js'), '// ' + task.title + '\n');
        cp.execFileSync('git', ['add', '.'], { cwd: ctx.worktree.dir });
        cp.execFileSync('git', ['commit', '-q', '-m', task.metadata.plan_key], { cwd: ctx.worktree.dir });
        var sha = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.worktree.dir, encoding: 'utf8' }).trim();
        var t = store.load('task', task.id);
        t.metadata.worktree_dir = ctx.worktree.dir;
        store.save(t);
        work = { status: 'completed', summary: task.title + ' done', commit: sha };
      } else {
        // The reporting task exercises tool grants (TEST D).
        var toolResult = ctx.tools.invoke('git.read', { repo_path: repo }, ctx.tool_grants);
        work = { status: 'completed', summary: 'summary over ' + (toolResult.ok ? toolResult.result.branch : 'n/a') };
      }
      return new Promise(function (resolve) {
        setTimeout(function () {
          timeline.push({ key: task.metadata.plan_key, at: 'end', t: Date.now() });
          resolve(work);
        }, 15);
      });
    },
    review_fn: function () { return { verdict: 'pass', findings: [] }; }
  }).then(function (mission) {
    ok(mission.status === 'COMPLETED', '2M accept: integrated mission completed');
    var tasksNow = mission.task_ids.map(function (id) { return store.load('task', id); });
    ok(tasksNow.every(function (t) { return t.agent_id; }),
      'D accept: every task was routed to a selected agent');
    ok(grantsSeen['summarize'] && grantsSeen['summarize'].indexOf('git.read') !== -1,
      'D accept: least-privilege tool grant reached the agent and worked');
    ok(mission.metadata.peak_concurrency >= 2, 'E accept: independent tasks ran in parallel');
    var xEnd = timeline.filter(function (e) { return e.key === 'code-x' && e.at === 'end'; })[0];
    var yEnd = timeline.filter(function (e) { return e.key === 'code-y' && e.at === 'end'; })[0];
    var intStart = timeline.filter(function (e) { return e.key === 'integrate' && e.at === 'start'; })[0];
    ok(intStart.t >= xEnd.t && intStart.t >= yEnd.t, 'F accept: dependent task waited for both parents');
    ok(events.replay().filter(function (e) { return e.event_type === 'COMMIT_CREATED'; }).length >= 3,
      'N accept: commits created and evented');

    // TEST P: memory closed the loop.
    var recalled = memory.recall('core-accept', 'acceptance mission');
    ok(recalled.length >= 1 && recalled[0].entry.category === 'completed_work',
      'P accept: mission outcome stored in provider-independent memory');
    // TEST Q: decision + report events emitted.
    ok(events.replay().some(function (e) {
      return e.event_type === 'DECISION_MADE' && e.detail && e.detail.mission_status === 'COMPLETED';
    }), 'Q accept: next-decision event emitted with the report reference');
    ok(store.load('goal', submitted.goal.id).status === 'COMPLETED',
      '2M accept: goal closed from the mission outcome');

    // TEST R: restart — a fresh process sees the whole finished state.
    var script =
      'var s = require(' + JSON.stringify(path.join(EXEC, 'core', 'store')) + ');' +
      'var m = s.load("mission", ' + JSON.stringify(mission.id) + ');' +
      'console.log(JSON.stringify({st: m.status, n: m.task_ids.length, ev: s.readEvents().length > 20, rep: !!m.metadata.report_id}));';
    var out = JSON.parse(cp.execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8', env: Object.assign({}, process.env)
    }).trim());
    ok(out.st === 'COMPLETED' && out.n === 4 && out.ev && out.rep,
      'R accept: restart loses nothing — mission, tasks, report, events all recovered');
  });
});

// --- TESTS G/H/I/J: quota → waiting → fallback → resume -------------------------
chain2 = chain2.then(function () {
  var submitted = orchestrator.submitGoal('Research market pricing.', {
    project: 'core-accept',
    spec: {
      title: 'Quota exercise',
      tasks: [{ key: 'research', title: 'Research pricing', task_type: 'research',
        capabilities_required: ['research'], policy_classes: ['READ'], depends_on: [] }]
    }
  });
  var taskId = submitted.tasks[0].id;
  var runnerCalls = [];
  function runnerFactory() {
    return function (agentName, task) {
      runnerCalls.push(agentName);
      return Promise.resolve({ status: 'completed', summary: 'research done by ' + agentName });
    };
  }
  // Round 1: every research provider quota-exhausted → WAITING_FOR_QUOTA.
  return orchestrator.advanceMission(submitted.mission.id, {
    agent_runner: runnerFactory(),
    quota_state: { 'adv-a': { exhausted: true }, 'adv-b': { exhausted: true } },
    review: false
  }).then(function (mission) {
    var task = store.load('task', taskId);
    ok(task.status === 'WAITING_FOR_QUOTA' && runnerCalls.length === 0,
      'G/H accept: quota exhaustion parks the task in WAITING_FOR_QUOTA without execution');
    ok(mission.status === 'WAITING', 'H accept: mission waits, does not fail');

    // Round 2: the reputation-preferred primary (adv-b) is still
    // exhausted → policy-permitted SAME-authority fallback to adv-a.
    orchestrator.resumeQuota(submitted.mission.id);
    return orchestrator.advanceMission(submitted.mission.id, {
      agent_runner: runnerFactory(),
      quota_state: { 'adv-b': { exhausted: true } },
      review: false
    });
  }).then(function (mission) {
    var task = store.load('task', taskId);
    ok(mission.status === 'COMPLETED' && task.status === 'COMPLETED',
      'J accept: task resumed and completed');
    ok(task.agent_id === 'adv-a' && task.metadata.fallback_from === 'adv-b',
      'I accept: fallback provider selected under policy, provenance recorded');
    ok(events.replay().some(function (e) { return e.event_type === 'TASK_RESUMED' && e.subject_id === taskId; }),
      'J accept: resume evented');
  });
});

// --- TESTS K/L/M: validation rejects → agent repairs → passes --------------------
chain2 = chain2.then(function () {
  var submitted = orchestrator.submitGoal('Produce a correct analysis.', {
    project: 'core-accept',
    spec: {
      title: 'Repair exercise',
      tasks: [{ key: 'analyze', title: 'Analyze data', task_type: 'analysis',
        capabilities_required: ['analysis'], depends_on: [], max_attempts: 3 }]
    }
  });
  var attempts = 0;
  var repairNotesSeen = null;
  return orchestrator.advanceMission(submitted.mission.id, {
    agent_runner: function (agentName, task, ctx) {
      attempts += 1;
      if (attempts === 1) {
        return Promise.resolve({ status: 'completed' }); // missing summary → schema reject
      }
      repairNotesSeen = ctx.repair_notes;
      return Promise.resolve({ status: 'completed', summary: 'repaired analysis, all fields present' });
    },
    review: false
  }).then(function (mission) {
    ok(typeof repairNotesSeen === 'string' && /REPAIR REQUIRED/.test(repairNotesSeen) &&
       /summary/.test(repairNotesSeen),
      'L accept: the repairing agent SEES the rejection findings (feedback channel)');
    return mission;
  }).then(function (mission) {
    var task = store.load('task', submitted.tasks[0].id);
    ok(attempts === 2 && task.status === 'COMPLETED' && task.attempt === 2,
      'K/L/M accept: validation rejected the wrong result, the agent repaired it, validation passed');
    var evs = events.replay();
    ok(evs.some(function (e) { return e.event_type === 'VALIDATION_FAILED' && e.subject_id === task.id; }) &&
       evs.some(function (e) { return e.event_type === 'VALIDATION_PASSED' && e.subject_id === task.id; }),
      'K/M accept: both validation verdicts evented');
    ok(mission.status === 'COMPLETED', 'M accept: repaired mission completes');
  });
});

// --- TEST O: persistent GitHub delivery mechanism exists and is active ------------
chain2 = chain2.then(function () {
  ok(fs.existsSync('/etc/systemd/system/mythos-git-push.service'),
    'O accept: persistent delivery relay unit exists');
  var timerState = 'unknown';
  try {
    timerState = cp.execFileSync('systemctl', ['is-active', 'mythos-git-push.timer'],
      { encoding: 'utf8' }).trim();
  } catch (e) {
    timerState = (e.stdout || '').trim() || 'inactive';
  }
  ok(timerState === 'active', 'O accept: delivery relay timer is active (' + timerState + ')');
});

// ===========================================================================
// §18 — campaign mission integration test (mocks only, no money, no publishing)
// ===========================================================================

chain2 = chain2.then(function () {
  agents.registerAgent('mock-marketer', {
    provider: 'mock-mkt',
    capabilities: ['marketing_campaign', 'image_generation', 'image_validation', 'analysis', 'research'],
    task_types: ['marketing', 'analysis', 'generic', 'research', 'reporting'],
    execution_authority: false, risk_level: 'medium', cost: { tier: 'metered' }
  });
  agents.registerProbe('mock-mkt', function () { return true; });

  // Spending now needs BOTH a per-request policy allowance AND a
  // configured cumulative budget (core/budget.js). The sandbox ledger
  // below grants the campaign project $5/day for this test; without it
  // the ledger correctly refuses, since an unbudgeted project may never
  // spend.
  var budgetLedger = require(path.join(EXEC, 'core', 'budget'));
  var CAMPAIGN_BUDGETS = {
    defaults: { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 0 },
    projects: { 'core-campaign': { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 5 } }
  };
  var campaignLedger = {
    check: function (r) { return budgetLedger.check(Object.assign({ config: CAMPAIGN_BUDGETS }, r)); },
    reserve: function (r) { return budgetLedger.reserve(Object.assign({ config: CAMPAIGN_BUDGETS }, r)); },
    settle: function (r) { return budgetLedger.settle(Object.assign({ config: CAMPAIGN_BUDGETS }, r)); },
    release: function (r) { return budgetLedger.release(Object.assign({ config: CAMPAIGN_BUDGETS }, r)); },
    reserveScoped: function (r) { return budgetLedger.reserveScoped(Object.assign({ config: CAMPAIGN_BUDGETS }, r)); },
    settleScoped: function (r) { return budgetLedger.settleScoped(Object.assign({ config: CAMPAIGN_BUDGETS }, r)); },
    releaseScoped: function (r) { return budgetLedger.releaseScoped(Object.assign({ config: CAMPAIGN_BUDGETS }, r)); },
    reservationIdFor: budgetLedger.reservationIdFor
  };
  var campaignPolicy = policyEngine.createEngine({
    policy_id: 'campaign-test-v1',
    classes: { READ: 'allow', PROJECT_WRITE: 'allow', GIT: 'allow', SERVICE: 'require_approval',
      DEPLOY: 'require_approval', ROOT: 'deny', EXTERNAL_API: 'allow', DESTRUCTIVE: 'deny' },
    money_spend: { enabled: true, daily_limit_usd: 5 }
  }, { ledger: campaignLedger });

  var submitted = orchestrator.submitGoal(
    'Prepare a professional advertising campaign for the flagship product with a $5/day budget for one day.', {
      project: 'core-campaign',
      policy: campaignPolicy,
      spec: {
        title: 'Ad campaign ($5/day, 1 day, sandbox)',
        tasks: [
          { key: 'product', title: 'Read product data', task_type: 'analysis', capabilities_required: ['analysis'], depends_on: [] },
          { key: 'brand', title: 'Retrieve brand context', task_type: 'analysis', capabilities_required: ['analysis'], depends_on: ['product'] },
          { key: 'image', title: 'Generate campaign visual', task_type: 'generic', capabilities_required: ['image_generation'], policy_classes: ['EXTERNAL_API'], depends_on: ['brand'] },
          { key: 'check-image', title: 'Validate visual', task_type: 'generic', capabilities_required: ['image_validation'], policy_classes: ['READ'], depends_on: ['image'] },
          { key: 'copy', title: 'Write advertising copy', task_type: 'analysis', capabilities_required: ['analysis'], depends_on: ['brand'] },
          { key: 'campaign', title: 'Create campaign (sandbox)', task_type: 'marketing', capabilities_required: ['marketing_campaign'], policy_classes: ['EXTERNAL_API', 'MONEY_SPEND'], budget_usd: 5, depends_on: ['check-image', 'copy'] },
          { key: 'report', title: 'Report campaign', task_type: 'reporting', capabilities_required: ['analysis'], depends_on: ['campaign'] }
        ]
      }
    });
  ok(!submitted.rejected, '§18 campaign: plan valid under the configured budget policy');

  var campaignResult = null;
  return orchestrator.advanceMission(submitted.mission.id, {
    policy: campaignPolicy,
    agent_runner: function (agentName, task, ctx) {
      switch (task.metadata.plan_key) {
        case 'image': {
          var img = ctx.tools.invoke('image.generate', { prompt: 'flagship product hero shot' }, ctx.tool_grants);
          return Promise.resolve({ status: 'completed', summary: 'visual ' + img.result.image_ref, image_ref: img.result.image_ref });
        }
        case 'check-image': {
          var val = ctx.tools.invoke('image.validate', { image_ref: 'mock://image/x' }, ctx.tool_grants);
          return Promise.resolve({ status: 'completed', summary: 'visual valid: ' + val.result.valid });
        }
        case 'campaign': {
          var c = ctx.tools.invoke('meta.create_campaign',
            { daily_budget_usd: 5, duration_days: 1, copy: 'Great product.' }, ctx.tool_grants);
          campaignResult = c;
          return Promise.resolve({
            status: c.ok ? 'completed' : 'failed',
            summary: c.ok ? 'sandbox campaign ' + c.result.campaign_id : c.error
          });
        }
        default:
          return Promise.resolve({ status: 'completed', summary: task.title + ' done (mock)' });
      }
    },
    review_fn: function () { return { verdict: 'pass', findings: [] }; }
  }).then(function (mission) {
    ok(mission.status === 'COMPLETED', '§18 campaign: mission completed end to end');
    ok(campaignResult && campaignResult.ok && campaignResult.mocked === true &&
       campaignResult.result.sandbox === true && campaignResult.result.published === false,
      '§18 campaign: campaign tool ran SANDBOXED — nothing published, nothing spent');
    ok(!!campaignResult && !!campaignResult.result && campaignResult.result.daily_budget_usd === 5,
      '§18 campaign: $5/day budget carried through policy into the tool call');
    ok(memory.recall('core-campaign', 'ad campaign sandbox').length >= 1,
      '§18 campaign: outcome recorded in project memory');

    // Over-budget variant: $6 > limit → the spend gate demands approval,
    // so the campaign task parks instead of spending.
    var over = orchestrator.submitGoal('Same campaign at $6/day.', {
      project: 'core-campaign',
      policy: campaignPolicy,
      spec: {
        title: 'Over-budget campaign',
        tasks: [{ key: 'campaign', title: 'Create over-budget campaign', task_type: 'marketing',
          capabilities_required: ['marketing_campaign'], policy_classes: ['EXTERNAL_API', 'MONEY_SPEND'],
          budget_usd: 6, depends_on: [] }]
      }
    });
    // The first campaign consumed the whole $5/day budget, so the
    // cumulative ledger now refuses the $6 follow-up at the PLAN gate —
    // stricter than the old per-request-only behaviour, which would have
    // planned it and only parked it at dispatch.
    ok(over.rejected === true && /CUMULATIVE BUDGET|exceeds remaining/.test(over.errors.join(' ')),
      '§18 campaign: over-budget follow-up REFUSED at the plan gate by the cumulative ledger');
    var afterBudget = budgetLedger.status('core-campaign', { config: CAMPAIGN_BUDGETS });
    ok(afterBudget.spent === 5 && afterBudget.remaining === 0,
      '§18 campaign: the refused follow-up spent nothing (cumulative total unchanged)');
    return null;
  });
});

// ===========================================================================
// PHASE 2N — project data layer (vision §5 / capability G)
// ===========================================================================

var projectData = require(path.join(EXEC, 'core', 'project-data'));

(function () {
  projectData.resetForTests();

  var sya = projectData.describeSource('ssangyong_autos');
  ok(!!sya && sya.project === 'ssangyong-autos' && sya.kind === 'postgres' && sya.read_only === true,
    '2N data: known precursor ssangyong_autos discoverable and read-only');
  ok(sya.required_env.indexOf('SSANGYONG_DB_PASSWORD') !== -1,
    '2N data: descriptor lists required env var NAMES');
  ok(Object.keys(sya).sort().join(',') === 'available,configured,description,kind,name,project,read_only,required_env',
    '2N data: describeSource() exposes only metadata fields, never raw env values');
  ok(sya.available === false, '2N data: declarative-only source has no adapter wired yet');

  var mcc = projectData.describeSource('mythos_command_center');
  ok(!!mcc && mcc.read_only === false, '2N data: mythos_command_center discoverable and read-write');

  var names = projectData.listSources().map(function (s) { return s.name; });
  ok(names.indexOf('ssangyong_autos') !== -1 && names.indexOf('mythos_command_center') !== -1,
    '2N data: listSources returns every registered source');
  ok(projectData.listSources('ssangyong-autos').length === 1,
    '2N data: listSources filters by project');

  ok(projectData.describeSource('ghost_source') === null, '2N data: unknown source returns null, not a throw');

  throws(function () { projectData.registerSource('bad name', { project: 'x', kind: 'postgres', description: 'd', read_only: true, required_env: [] }); },
    /INVALID_DATA_SOURCE_NAME/, '2N data: source name must be lowercase snake_case');
  throws(function () { projectData.registerSource('x', { project: 'x', kind: 'carrier-pigeon', description: 'd', read_only: true, required_env: [] }); },
    /UNKNOWN_KIND/, '2N data: unknown kind refused');
  throws(function () { projectData.registerSource('x', { project: 'x', kind: 'postgres', description: 'd', read_only: true, required_env: ['DB_PASSWORD=hunter2'] }); },
    /REFUSES_SECRETS/, '2N data: a descriptor carrying a secret-shaped value is refused');
  throws(function () { projectData.registerAdapter('ghost_source', { query: function () {} }); },
    /UNKNOWN_DATA_SOURCE/, '2N data: cannot wire an adapter onto an unregistered source');

  projectData.registerSource('sheet_x', {
    project: 'sheet-proj', kind: 'sheet', description: 'A read-only sheet.', read_only: true, required_env: []
  });
  ok(projectData.describeSource('sheet_x').configured === true,
    '2N data: a source with no required env is always configured');
})();

chain2 = chain2.then(function () {
  return projectData.query('ghost_source', 'select 1').then(
    function () { ok(false, '2N data: query on unknown source should reject'); },
    function (err) { ok(/UNKNOWN_DATA_SOURCE/.test(err.message), '2N data: query on unknown source rejects'); }
  );
}).then(function () {
  return projectData.query('ssangyong_autos', 'select 1').then(
    function () { ok(false, '2N data: query on unwired source should reject'); },
    function (err) { ok(/HAS_NO_ADAPTER/.test(err.message), '2N data: query on a declarative-only source rejects'); }
  );
}).then(function () {
  var calls = [];
  projectData.registerAdapter('ssangyong_autos', {
    query: function (text, params) { calls.push([text, params]); return Promise.resolve({ rows: [{ ok: 1 }] }); }
  });
  ok(projectData.describeSource('ssangyong_autos').available === true,
    '2N data: source becomes available once an adapter is wired');
  return projectData.query('ssangyong_autos', 'SELECT * FROM sya_products WHERE id = $1', [7]).then(function (result) {
    ok(result.rows[0].ok === 1, '2N data: query() delegates to the wired adapter and returns its result');
    ok(calls.length === 1 && calls[0][0] === 'SELECT * FROM sya_products WHERE id = $1' && calls[0][1][0] === 7,
      '2N data: query() forwards the exact statement and params — no rewriting');
  });
}).then(function () {
  return projectData.query('ssangyong_autos', 'DELETE FROM sya_products').then(
    function () { ok(false, '2N data: write-shaped statement on a read-only source should reject'); },
    function (err) { ok(/READ_ONLY/.test(err.message), '2N data: read-only source refuses a write-shaped statement even with an adapter wired'); }
  );
});

// ===========================================================================
// Summary
// ===========================================================================
chain2.then(function () {
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failures.length) {
    console.log('Failures:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  process.exit(0);
}).catch(function (err) {
  console.error('SUITE ERROR: ' + (err && err.stack || err));
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  process.exit(1);
});
