'use strict';
// =====================================================
// MYTHOS HADDAD V2.1 — AI TEAM FOUNDATION
// tests/mythos-haddad-ai-team-test.js
//
// Offline and deterministic. Proves the V2.1 gate items that can be proven
// without a GPU: the local Qwen worker is a REGISTERED, PROBED agent the
// existing registry selects by capability and the existing review policy
// refuses for sensitive work; roles are CONFIG over existing vocabulary
// (action → profile is derived, never restated); the role decides which
// trust-attested skill pack the executor injects; the Haddad runner's
// prompt carries the role brief under the grant; read roles are offered no
// write tool. The five live role runs are recorded in
// projects/mythos-haddad/docs/AI_TEAM.md, not here.
// =====================================================
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var EXEC = path.join(ROOT, 'projects', 'mythos-ai-executor');
// Not under /tmp: the task schema refuses a /tmp working directory.
var FIXTURES = fs.mkdtempSync(path.join(os.homedir(), 'haddad-ai-team-'));
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.MYTHOS_RESOURCE_GUARD = 'off';
process.env.MYTHOS_SKILL_TRUST = 'off';
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIXTURES, 'no-advisory.env');
process.env.MYTHOS_FREE_LLM_KEY_DIR = path.join(FIXTURES, 'no-free-llm');
// The provider's stat-only availability is pinned ON with fixture files so
// the probe's RUNTIME leg is what the tests below exercise.
process.env.HADDAD_AGENT_ENABLE_FILE = path.join(FIXTURES, 'agent.enabled');
process.env.HADDAD_AGENT_KEY_FILE = path.join(FIXTURES, 'runtime.key');
fs.writeFileSync(process.env.HADDAD_AGENT_ENABLE_FILE, '');
fs.writeFileSync(process.env.HADDAD_AGENT_KEY_FILE, 'test-key\n');
// The runtime leg of the probe is pointed at a port nothing listens on, so
// the default probe's real curl measures "down" — read at module load.
process.env.HADDAD_AGENT_BASE_URL = 'http://127.0.0.1:1/v1';

var agents = require(path.join(EXEC, 'core', 'agent-registry'));
var validation = require(path.join(EXEC, 'core', 'validation'));
var router = require(path.join(EXEC, 'core', 'provider-router'));
var roles = require(path.join(EXEC, 'lib', 'roles'));
var policy = require(path.join(EXEC, 'lib', 'policy'));
var skillsLib = require(path.join(EXEC, 'lib', 'skills'));
var engine = require(path.join(EXEC, 'bridge', 'action-resolution'));
var agent = require(path.join(EXEC, 'providers', 'haddad-agent'));
var executor = require(path.join(EXEC, 'executor'));

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('ok - ' + name); }
  else { fail++; console.log('not ok - ' + name); }
}
function throws(fn, re, name) {
  try { fn(); ok(false, name + ' (did not throw)'); }
  catch (e) { ok(re.test(String(e && e.message)), name + (re.test(String(e && e.message)) ? '' : ' — ' + e.message)); }
}

var AGENTS_CONFIG = JSON.parse(fs.readFileSync(path.join(EXEC, 'config', 'agents.json'), 'utf8'));
var ROLES_CONFIG = JSON.parse(fs.readFileSync(path.join(EXEC, 'config', 'roles.json'), 'utf8'));

// ---------------------------------------------------------------- A. registry

console.log('# A. haddad-qwen is a registered, probed agent');
(function () {
  var q = AGENTS_CONFIG['haddad-qwen'];
  ok(!!q && q.provider === 'haddad-agent', 'A1 config/agents.json carries haddad-qwen on the haddad-agent provider');
  ok(q.execution_authority === true, 'A2 it has execution authority (it genuinely executes tools)');
  ok(Array.isArray(q.review_scope) && q.review_scope.length === 1 && q.review_scope[0] === 'standard',
    'A3 review_scope is exactly ["standard"] — never sensitive');
  ok(q.risk_level === 'medium' && q.cost && q.cost.tier === 'local', 'A4 medium risk, local cost tier');
  ['coding', 'testing', 'debugging', 'repo_modification', 'repo_inspection', 'research', 'review'].forEach(function (c) {
    ok(q.capabilities.indexOf(c) !== -1, 'A5 advertises ' + c);
  });

  agents.resetForTests();
  agents.registerProbe('claude-code', function () { return false; });
  agents.registerProbe('openai-compat', function () { return false; });
  agents.registerProbe('gemini', function () { return false; });
  agents.registerProbe('free-llm-pool', function () { return false; });
  // No probe registered for haddad-agent: the DEFAULT probe runs, i.e. the
  // provider's own probe() — stat legs pinned on above, runtime leg = curl
  // against a port nothing listens on → unavailable. Fail closed, measured.
  var down = agents.healthCheck('haddad-qwen', { fresh: true });
  ok(down.available === false, 'A6 default probe: runtime down → UNAVAILABLE (fail closed), detail=' + down.detail);

  // Now the runtime "answers": the registry selects it for coding by capability.
  agents.registerProbe('haddad-agent', function () { return true; });
  var coding = agents.selectCandidates({ capabilities: ['coding'], task_type: 'coding', require_execution_authority: true }, { fresh: true });
  ok(coding.length === 1 && coding[0].name === 'haddad-qwen', 'A7 selected by capability for a coding task (claude-code unavailable)');
  var testing = agents.selectCandidates({ capabilities: ['testing'], task_type: 'testing', require_execution_authority: true }, { fresh: true });
  ok(testing.length === 1 && testing[0].name === 'haddad-qwen', 'A8 selected by capability for a testing task');

  // With Claude also available, the registry's own ranking (risk, then cost)
  // puts the medium-risk local worker ahead of the high-risk subscription one.
  agents.registerProbe('claude-code', function () { return true; });
  var both = agents.selectCandidates({ capabilities: ['coding'], task_type: 'coding', require_execution_authority: true }, { fresh: true });
  ok(both.length === 2 && both[0].name === 'haddad-qwen' && both[1].name === 'claude-code',
    'A9 ranks ahead of claude-code on the registry\'s existing risk/cost order — nothing hard-codes either');

  // The router routes a coding task to it, records authority, and never
  // hands an execution task to an advisory agent.
  var routed = router.route({ id: 'tk-x', project: 'p', task_type: 'coding', capabilities_required: ['coding'] }, { fresh: true });
  ok(routed.action === 'route' && routed.agent === 'haddad-qwen' && routed.authority === true, 'A10 provider-router routes coding → haddad-qwen');
  var waiting = router.route({ id: 'tk-y', project: 'p', task_type: 'coding', capabilities_required: ['coding'] },
    { fresh: true, quota_state: { 'haddad-qwen': { exhausted: true }, 'claude-code': { exhausted: true } } });
  ok(waiting.action === 'wait_for_quota', 'A11 exhausted → wait_for_quota, never a silent substitution');
  agents.registerProbe('claude-code', function () { return false; });
  var advisoryOnly = agents.selectCandidates({ capabilities: ['analysis'], forbid_execution_authority: true }, { fresh: true });
  ok(advisoryOnly.every(function (c) { return c.name !== 'haddad-qwen'; }), 'A12 forbid_execution_authority filters it out (authority is registration, not promotion)');
})();

console.log('# B. the review policy refuses it for sensitive work');
(function () {
  agents.resetForTests();
  ['claude-code', 'openai-compat', 'gemini', 'free-llm-pool'].forEach(function (p) { agents.registerProbe(p, function () { return false; }); });
  agents.registerProbe('haddad-agent', function () { return true; });
  var calls = 0;
  var rf = function () { calls++; return { verdict: 'accept', findings: [] }; };
  // Standard work by another author: eligible.
  var std = validation.adversarialReview({ id: 'tk-1', agent_id: 'claude-code', task_type: 'coding' }, { summary: 'x' }, { review_fn: rf, sensitive: false });
  ok(std.performed === true && std.reviewer === 'haddad-qwen', 'B1 may review STANDARD work of another author (performed=' + std.performed + ', reviewer=' + std.reviewer + ')');
  // Sensitive (commit-producing) work: refused as reviewer, named.
  var sens = validation.adversarialReview({ id: 'tk-2', agent_id: 'claude-code', task_type: 'coding' }, { summary: 'x' }, { review_fn: rf, sensitive: true });
  ok(sens.performed === false && sens.verdict === 'reviewer_not_trusted_for_sensitive' &&
     (sens.refused_candidates || []).indexOf('haddad-qwen') !== -1,
    'B2 REFUSED as reviewer of SENSITIVE work: ' + sens.verdict);
  // Its own work: excluded as author regardless of sensitivity.
  var own = validation.adversarialReview({ id: 'tk-3', agent_id: 'haddad-qwen', task_type: 'coding' }, { summary: 'x' }, { review_fn: rf, sensitive: false });
  ok(own.performed === false && own.verdict === 'no_reviewer_available', 'B3 never reviews its own work (author excluded): ' + own.verdict);
  ok(validation.reviewerEligible({ definition: agents.getAgent('haddad-qwen') }, true) === false, 'B4 reviewerEligible(sensitive) is false');
})();

// ---------------------------------------------------------------- C. roles

console.log('# C. roles are config over existing vocabulary');
(function () {
  ok(roles.DEFAULT_TABLE.valid === true, 'C1 config/roles.json validates');
  var list = roles.listForApi();
  var ids = list.map(function (r) { return r.id; });
  ['coder', 'debugger', 'documenter', 'tester', 'reviewer', 'researcher'].forEach(function (id) {
    ok(ids.indexOf(id) !== -1, 'C2 role ' + id + ' defined');
  });
  // The profile is DERIVED from the action — the table cannot even state one.
  list.forEach(function (r) {
    ok(r.execution_profile === engine.PROFILE_BY_ACTION[r.action], 'C3 ' + r.id + ' → ' + r.execution_profile + ' equals PROFILE_BY_ACTION[' + r.action + ']');
    ok(!('execution_profile' in ROLES_CONFIG.roles[r.id]), 'C4 ' + r.id + ' does not restate a profile in config');
    ok(policy.profileNames().indexOf(r.execution_profile) !== -1, 'C5 ' + r.id + ' maps to an existing lib/policy.js profile');
  });
  // Every action of the closed set has exactly one default role.
  Object.keys(engine.PROFILE_BY_ACTION).forEach(function (action) {
    var defaults = list.filter(function (r) { return r.action === action && !r.match; });
    ok(defaults.length === 1, 'C6 action ' + action + ' has exactly one default role (' + defaults.map(function (d) { return d.id; }).join(',') + ')');
  });
  // Every skill category a role names resolves to an EXISTING enabled skill.
  var reg = skillsLib.DEFAULT_REGISTRY;
  list.forEach(function (r) {
    var owner = Object.keys(reg.skills).filter(function (id) { return reg.skills[id].enabled && reg.skills[id].categories.indexOf(r.skill_category) !== -1; });
    ok(owner.length === 1, 'C7 ' + r.id + ' skill_category "' + r.skill_category + '" → existing skill ' + owner.join(','));
  });
  // Every capability a role requires is advertised by haddad-qwen.
  var q = AGENTS_CONFIG['haddad-qwen'];
  list.forEach(function (r) {
    ok(r.capabilities_required.every(function (c) { return q.capabilities.indexOf(c) !== -1; }), 'C8 haddad-qwen advertises everything ' + r.id + ' requires');
  });

  // Resolution is deterministic and action-driven.
  ok(roles.resolveRole({ action: 'implement', instruction: 'Add a helper' }).role.id === 'coder', 'C9 implement → coder');
  ok(roles.resolveRole({ action: 'implement', instruction: 'The test is FAILING; find the root cause' }).role.id === 'debugger', 'C10 implement + failure words → debugger');
  ok(roles.resolveRole({ action: 'test' }).role.id === 'tester', 'C11 test → tester');
  ok(roles.resolveRole({ action: 'review' }).role.id === 'reviewer', 'C12 review → reviewer');
  ok(roles.resolveRole({ action: 'investigate' }).role.id === 'researcher', 'C13 investigate → researcher');
  ok(roles.resolveRole({ action: 'document' }).role.id === 'documenter', 'C14 document → documenter');
  var none = roles.resolveRole({ action: 'coding', instruction: 'x' });
  ok(none.role === null && /^no_role_for_category/.test(none.reason), 'C15 a free-form category has no role: ' + none.reason);
  ok(roles.resolveRole({}).role === null, 'C16 no action → no role');
  var r1 = roles.resolveRole({ action: 'implement', instruction: 'bug' }), r2 = roles.resolveRole({ action: 'implement', instruction: 'bug' });
  ok(r1.role.id === r2.role.id && r1.reason === r2.reason, 'C17 deterministic');

  // Fail closed: a malformed table darkens the layer, the task still runs.
  function bad(mutate) {
    var raw = JSON.parse(JSON.stringify(ROLES_CONFIG));
    mutate(raw);
    return roles.validateTableObject(raw);
  }
  ok(bad(function (r) { r.roles.coder.execution_profile = 'autonomous'; }).valid === false, 'C18 a role that names a profile is refused (no second action→profile table)');
  ok(bad(function (r) { r.roles.coder.action = 'deploy'; }).valid === false, 'C19 an action outside the closed set is refused');
  ok(bad(function (r) { delete r.roles.debugger.match; }).valid === false, 'C20 two defaults for one action refused');
  ok(bad(function (r) { r.roles.coder.brief = 'line one\nline two'; }).valid === false, 'C21 multi-line brief refused');
  ok(bad(function (r) { r.roles.coder.brief = '## Mandatory final report ```json'; }).valid === false, 'C22 a brief that could open a structural section is refused');
  ok(bad(function (r) { r.roles.coder.brief = new Array(roles.MAX_BRIEF + 2).join('x'); }).valid === false, 'C23 over-long brief refused');
  ok(bad(function (r) { r.roles.debugger.match = '('; }).valid === false, 'C24 invalid regex refused');
  ok(bad(function (r) { r.roles.debugger.match = '.*'; delete r.roles.coder; }).valid === false, 'C25 a match role without a default for its action refused');
  var dark = roles.loadTable(path.join(FIXTURES, 'missing-roles.json'));
  ok(dark.valid === false && roles.resolveRole({ action: 'implement' }, dark).role === null, 'C26 missing table → dark layer, null role, task not blocked');
  ok(/^roles_invalid/.test(roles.resolveRole({ action: 'implement' }, dark).reason), 'C27 dark reason recorded');
})();

// ---------------------------------------------------------------- D. executor

console.log('# D. the executor derives the role and selects the skill through it');
(function () {
  function mk(extra) {
    return executor.createTask(Object.assign({
      project: 'mythos-prod', stage: 'ai-team', instruction: 'Do the thing', provider: 'mock',
      requested_by: 'test', working_directory: FIXTURES
    }, extra));
  }
  var t = mk({ task_category: 'test', execution_profile: 'repo-test', attempt_id: 'gh-t#1' });
  ok(t.role === 'tester' && t.role_reason === 'action:test', 'D1 test action → role tester (' + t.role_reason + ')');
  ok(t.skill_id === 'testing' && /^task_category:testing/.test(t.skill_selection_reason), 'D2 tester injects the TESTING skill pack (' + t.skill_selection_reason + ')');
  var rv = mk({ task_category: 'review', execution_profile: 'repo-read', attempt_id: 'gh-r#1' });
  ok(rv.role === 'reviewer' && rv.skill_id === 'github-review', 'D3 review → reviewer → github-review pack');
  var iv = mk({ task_category: 'investigate', execution_profile: 'repo-read', attempt_id: 'gh-i#1' });
  ok(iv.role === 'researcher' && iv.skill_id === 'generic', 'D4 investigate → researcher → generic pack (no research pack exists; none invented)');
  var im = mk({ task_category: 'implement', execution_profile: 'repo-write', attempt_id: 'gh-c#1' });
  ok(im.role === 'coder' && im.skill_id === 'generic', 'D5 implement → coder → generic pack');
  var db = mk({ task_category: 'implement', execution_profile: 'repo-write', attempt_id: 'gh-d#1', instruction: 'pct.test.js is failing — fix the bug in pct.js' });
  ok(db.role === 'debugger' && db.role_reason === 'action:implement+match:debugger', 'D6 implement + failing → debugger');
  var free = mk({ task_category: 'security', instruction: 'run a security audit' });
  ok(free.role === null && /^no_role_for_category:security/.test(free.role_reason) && free.skill_id === 'security-audit',
    'D7 a non-action category keeps pre-V2 selection exactly (role null, skill by category)');
  var noCat = mk({ instruction: 'run the regression tests' });
  ok(noCat.role === null && noCat.skill_id === 'testing', 'D8 no category → no role, keyword rule untouched');
  // The role never changes the profile: the action invariant still bites.
  throws(function () { mk({ task_category: 'test', execution_profile: 'repo-write', attempt_id: 'gh-bad#1' }); }, /ACTION_PROFILE_MISMATCH/,
    'D9 a role cannot loosen the action→profile invariant');
  // Nothing a caller writes names a role.
  var forged = mk({ task_category: 'investigate', execution_profile: 'repo-read', attempt_id: 'gh-f#1', role: 'coder' });
  ok(forged.role === 'researcher', 'D10 a caller-supplied role is ignored; the action decides');
  var events = fs.readFileSync(path.join(process.env.MYTHOS_EXECUTOR_HOME, 'tasks', t.task_id, 'events.log'), 'utf8');
  ok(/"role":"tester"/.test(events) && /"role_reason":"action:test"/.test(events), 'D11 the created event records the role decision (auditable)');
  var persisted = JSON.parse(fs.readFileSync(path.join(process.env.MYTHOS_EXECUTOR_HOME, 'tasks', t.task_id, 'task.json'), 'utf8'));
  ok(persisted.role === 'tester' && persisted.role_reason === 'action:test', 'D12 task.json carries role + role_reason (schema accepts them)');
})();

// ---------------------------------------------------------------- E. runner

console.log('# E. the Haddad runner renders the role under the grant');
(function () {
  var byRole = {};
  roles.listForApi().forEach(function (r) {
    var grant = policy.toolsForProfile(r.execution_profile);
    var schemas = agent.toolSchemas(grant);
    var names = schemas.map(function (s) { return s.function.name; });
    byRole[r.id] = { grant: grant, names: names, delivery: r.delivery,
      prompt: agent.systemPrompt(grant, schemas, roles.getRole(r.id), r.delivery) };
  });
  // Measured live (tester round 2, t-20260922211921): the model ran the
  // tests, saw one fail, wrote nothing — and reported `blocked`, because for
  // a role that cannot fix anything "a test fails" reads as an obstacle. For
  // a TESTER the failure IS the deliverable, and the brief now says so.
  ok(/failing test is your result, not a blocker/.test(byRole.tester.prompt),
    'E0 the tester is told a failing test is its result, not a blocker');
  ['tester', 'reviewer', 'researcher'].forEach(function (id) {
    ok(byRole[id].names.indexOf('write_file') === -1, 'E1 ' + id + ' is offered NO write tool (' + byRole[id].names.join(',') + ')');
    ok(/You cannot write, edit or delete anything/.test(byRole[id].prompt), 'E2 ' + id + ' prompt says it cannot write');
    ok(/You change (nothing|and fix nothing)/.test(byRole[id].prompt), 'E3 ' + id + ' brief says it changes nothing');
  });
  ['coder', 'debugger', 'documenter'].forEach(function (id) {
    ok(byRole[id].names.indexOf('write_file') !== -1, 'E4 ' + id + ' is offered write_file');
  });
  ok(byRole.tester.names.indexOf('run_command') !== -1 || !agent.SANDBOX_BIN, 'E5 tester is offered run_command (repo-test grants node)');
  ok(byRole.reviewer.grant.commands.every(function (c) { return !(c.program === 'node' && c.prefix); }), 'E6 reviewer (repo-read) has no open node command');
  ok(/Your role is DEBUGGER/.test(byRole.debugger.prompt) && /root cause/.test(byRole.debugger.prompt), 'E7 debugger brief rendered');
  ok(/Your role is TESTER/.test(byRole.tester.prompt), 'E8 tester brief rendered');
  // The report is a MESSAGE. Measured live (debugger run t-20260922210645):
  // a correct fix was refused delivery because the model wrote its report to
  // `.mythos_report.json`, an out-of-scope file.
  Object.keys(byRole).forEach(function (id) {
    ok(/never create a report file/.test(byRole[id].prompt), 'E12 ' + id + ' is told the report is a message, not a file');
  });
  // The DELIVERY is stated as a fact of the task, like the tool list. Live
  // (tester run t-20260922230229): a report-delivery task reported a commit
  // hash and two changed files having written nothing; the validator refused
  // all three attempts and the model never withdrew the claim.
  roles.listForApi().forEach(function (r) {
    var isReport = r.delivery === 'report';
    ok(/delivers a REPORT, not a commit/.test(byRole[r.id].prompt) === isReport,
      'E13 ' + r.id + ' (' + r.delivery + ') ' + (isReport ? 'is told there is no commit to mention' : 'is not told a report contract it does not have'));
  });
  var plain = agent.systemPrompt(byRole.coder.grant, agent.toolSchemas(byRole.coder.grant), null);
  ok(!/Your role is/.test(plain), 'E9 no role → no brief (pre-V2 prompt unchanged)');
  var idx = plain.indexOf('Your tools over a single task workspace');
  var idx2 = byRole.coder.prompt.indexOf('Your role is CODER');
  ok(idx !== -1 && idx2 > idx, 'E10 the brief comes AFTER the grant statement, never before it');
  // The brief is one line and mentions no tool the grant did not offer.
  Object.keys(byRole).forEach(function (id) {
    var brief = roles.getRole(id).brief;
    var toolsMentioned = ['read_file', 'list_files', 'write_file', 'run_command'].filter(function (n) { return brief.indexOf(n) !== -1; });
    ok(toolsMentioned.every(function (n) { return byRole[id].names.indexOf(n) !== -1; }), 'E11 ' + id + ' brief names only granted tools (' + toolsMentioned.join(',') + ')');
  });
})();

// ---------------------------------------------------------------- F. probe

console.log('# F. the provider probe');
(function () {
  ok(agent.healthUrl('http://127.0.0.1:8600/v1') === 'http://127.0.0.1:8600/health', 'F1 /v1 base → /health');
  ok(agent.healthUrl('http://127.0.0.1:8600/v1/') === 'http://127.0.0.1:8600/health', 'F2 trailing slash handled');
  ok(agent.probe({ enableFile: path.join(FIXTURES, 'absent'), fetch: function () { return 200; } }) === false, 'F3 no marker → false before any request');
  ok(agent.probe({ keyFile: path.join(FIXTURES, 'absent'), fetch: function () { return 200; } }) === false, 'F4 no key → false');
  var asked = null;
  ok(agent.probe({ fetch: function (u) { asked = u; return 503; } }) === false && /\/health$/.test(asked), 'F5 runtime 503 → false (asked ' + asked + ')');
  ok(agent.probe({ fetch: function () { return 200; } }) === true, 'F6 marker + key + runtime 200 → true');
  ok(agent.available() === true, 'F7 available() (stat-only) stays the executor\'s startup contract');
})();

// ---------------------------------------------------------------- G. evidence

console.log('# G. the executor keeps what the provider MEASURED next to what the model CLAIMED');
(function () {
  ok(executor.providerEvidence(null) === null && executor.providerEvidence({ stdout: 'x' }) === null, 'G1 a provider that measured nothing → evidence null (every non-supervising provider)');
  var ev = executor.providerEvidence({
    validation: { passed: true, attempts: 2, evidence: { checks_run: [{ check: 'node t.js', passed: true }] } },
    validations: [{ attempt: 1, pass: false, rejections: ['check: node t.js failed'] }, { attempt: 2, pass: true, rejections: [] }],
    repair_rounds: 1, tool_calls: 3, duration_ms: 1234,
    tool_trace: [{ tool: 'read_file', target: 'a.js', refused: false, detail: null }, { tool: 'context_compaction', refused: false, detail: 'elided 1', target: null },
      { tool: 'write_file', target: '../x', refused: true, detail: 'REFUSED: outside' }, { tool: 'diagnose', refused: false, target: 'claude' }]
  });
  ok(ev && ev.validation.passed === true && ev.repair_rounds === 1 && ev.tool_calls === 3 && ev.duration_ms === 1234, 'G2 verdict, repair rounds, tool calls and duration carried');
  ok(ev.validations.length === 2 && ev.validations[0].pass === false && ev.validations[1].pass === true, 'G3 per-attempt verdicts carried');
  ok(ev.tool_trace.length === 4 && ev.tool_trace[2].refused === true && /outside/.test(ev.tool_trace[2].detail), 'G4 refusals are in the trace with their reason');
  ok(ev.diagnosis_requested === true && ev.context_compactions === 1, 'G5 diagnosis and compaction are visible as booleans/counts');
  var big = executor.providerEvidence({ tool_trace: new Array(500).fill({ tool: 'read_file', target: 'f', detail: new Array(1000).join('x') }) });
  ok(big.tool_trace.length === 200 && big.tool_trace[0].detail.length === 160, 'G6 bounded: at most 200 entries, 160-char details');
})();

// ---------------------------------------------------------------- H. STD-2

console.log('# H. no duplicate subsystem, and the role layer holds no authority');
(function () {
  var rolesSrc = fs.readFileSync(path.join(EXEC, 'lib', 'roles.js'), 'utf8');
  var requires = (rolesSrc.match(/require\('([^']+)'\)/g) || []).map(function (r) { return r.slice(9, -2); });
  ok(requires.length === 3 && requires.indexOf('fs') !== -1 && requires.indexOf('path') !== -1 &&
     requires.indexOf('../bridge/action-resolution') !== -1,
    'H1 the role layer depends on nothing but fs, path and the existing action table (' + requires.join(',') + ')');
  ok(!/require\('\.\/policy'\)/.test(rolesSrc), 'H2 it does not reach lib/policy — a role never renders a tool grant of its own');
  ok(!/PROFILE_BY_ACTION\s*=|var PROFILES\s*=/.test(rolesSrc), 'H3 it declares no action→profile or profile table of its own');
  ok(!/child_process|spawn|setInterval|setTimeout|\.listen\(/.test(rolesSrc), 'H4 it starts no process, no timer and no listener — it is config, not a runtime');
  ok(!/function\s+(enqueue|schedule|dispatch|route)\b/.test(rolesSrc), 'H5 it defines no queue, scheduler, dispatcher or router');
  // A role entry may carry ONLY the declared fields. A privilege-shaped one
  // (a profile, a provider, a model, a tool list) invalidates the table.
  var FORBIDDEN = ['execution_profile', 'profile', 'provider', 'model', 'allowedTools', 'disallowedTools',
    'permissionMode', 'tools', 'execution_authority', 'review_scope', 'delivery', 'expected_delivery'];
  var offenders = [];
  Object.keys(ROLES_CONFIG.roles).forEach(function (id) {
    FORBIDDEN.forEach(function (f) {
      if (Object.prototype.hasOwnProperty.call(ROLES_CONFIG.roles[id], f)) offenders.push(id + '.' + f);
      var probe = JSON.parse(JSON.stringify(ROLES_CONFIG));
      probe.roles[id][f] = 'x';
      if (roles.validateTableObject(probe).valid) offenders.push('accepted ' + id + '.' + f);
    });
  });
  ok(offenders.length === 0, 'H6 a privilege-shaped field is absent AND refused on every role (' + offenders.slice(0, 4).join(', ') + ')');
  // The registry entry is the ONLY place the new agent is declared: no second
  // catalog, no hardcoded name in the provider or the executor.
  var provSrc = fs.readFileSync(path.join(EXEC, 'providers', 'haddad-agent.js'), 'utf8');
  var execSrc = fs.readFileSync(path.join(EXEC, 'executor.js'), 'utf8');
  ok(provSrc.indexOf('haddad-qwen') === -1 && execSrc.indexOf('haddad-qwen') === -1,
    'H7 the agent name lives only in config/agents.json — nothing hardcodes it');
  ok((execSrc.match(/require\('\.\/lib\/roles'\)/g) || []).length === 1, 'H8 the executor resolves roles in exactly one place');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
try { fs.rmSync(FIXTURES, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(fail ? 1 : 0);
