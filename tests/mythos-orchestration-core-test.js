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
// Summary
// ===========================================================================
Promise.resolve().then(function () {
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
