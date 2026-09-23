'use strict';
// =====================================================
// MYTHOS HADDAD V2.2 — FABLE DELEGATION
// tests/mythos-haddad-delegation-test.js
//
// Offline and deterministic: every probe is injected, so what is asserted is
// the DECISION, never the machine this runs on.
//
// The property under test is not "routing works". It is that routing cannot
// widen authority: a routed provider outside the bridge's allow-list is
// refused rather than substituted, which is what stops a Haddad Issue
// reaching Claude when the local runtime is down.
// =====================================================
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var EXEC = path.join(ROOT, 'projects', 'mythos-ai-executor');
var FIXTURES = fs.mkdtempSync(path.join(os.homedir(), 'haddad-delegation-'));
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');
process.env.MYTHOS_RESOURCE_GUARD = 'off';
process.env.MYTHOS_SKILL_TRUST = 'off';
// The agent's own availability must never depend on the host running the suite.
process.env.HADDAD_AGENT_ENABLE_FILE = path.join(FIXTURES, 'no-haddad-agent.enabled');

var agents = require(path.join(EXEC, 'core', 'agent-registry'));
var roles = require(path.join(EXEC, 'lib', 'roles'));
var engine = require(path.join(EXEC, 'bridge', 'action-resolution'));
var ps = require(path.join(EXEC, 'bridge', 'provider-selection'));

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('ok - ' + name); }
  else { fail++; console.log('not ok - ' + name); }
}
function probes(map) {
  agents.resetForTests();
  ['claude-code', 'openai-compat', 'gemini', 'free-llm-pool', 'haddad-agent'].forEach(function (p) {
    agents.registerProbe(p, function () { return map[p] === true; });
  });
}
function select(over) {
  return ps.selectProvider(Object.assign({
    action: 'implement', instruction: 'add a helper', task_id: 'tk-1', project: 'mythos-haddad',
    allowed: ['haddad-agent'], fallback: 'haddad-agent', routerOpts: { fresh: true }
  }, over || {}));
}

// ------------------------------------------------- A. the routed happy path

console.log('# A. a task is routed by capability, not by configuration');
(function () {
  probes({ 'haddad-agent': true, 'claude-code': true });
  var d = select();
  ok(d.action === 'route' && d.provider === 'haddad-agent' && d.agent === 'haddad-qwen',
    'A1 implement routes to haddad-qwen on the haddad-agent provider');
  ok(d.decision.routed === true && d.decision.role === 'coder' && d.decision.task_type === 'coding',
    'A2 the decision names the role and task type it routed on');
  ok(d.decision.capabilities_required.indexOf('coding') !== -1, 'A3 and the capabilities it required');
  ok(d.decision.router_agent === 'haddad-qwen' && d.decision.authority === true,
    'A4 and what the router answered, including the authority it carries');
  var dbg = select({ instruction: 'the test is failing, find the root cause' });
  ok(dbg.decision.role === 'debugger', 'A5 the role comes from V2.1 resolution, so the instruction picks debugger');
  var t = select({ action: 'test', instruction: 'run the suites' });
  ok(t.decision.task_type === 'testing' && t.provider === 'haddad-agent', 'A6 a test action routes on task_type testing');
})();

// ------------------------------------------------- B. the floor

console.log('# B. routing cannot widen authority');
(function () {
  // The runtime is down. The router legitimately prefers claude-code, which
  // is available and has execution authority. The floor must refuse it.
  probes({ 'haddad-agent': false, 'claude-code': true });
  var d = select();
  ok(d.action === 'defer', 'B1 runtime down → DEFER, not a substitution (' + d.reason + ')');
  ok(d.provider === null, 'B2 and no provider is handed back');
  ok(/^not_permitted:claude-code/.test(d.reason), 'B3 the refusal names what was refused: ' + d.reason);
  ok(/refused rather than substituted/.test(d.decision.why), 'B4 and says it was refused, not swapped');
  ok(d.decision.router_agent === 'claude-code', 'B5 while still recording what the router actually wanted');

  // Nothing available at all: still a defer, with a different reason.
  probes({});
  var none = select();
  ok(none.action === 'defer' && /^no_provider/.test(none.reason), 'B6 nothing available → DEFER with no_provider: ' + none.reason);

  // A quota-exhausted agent waits; it is never replaced.
  probes({ 'haddad-agent': true, 'claude-code': true });
  var q = select({ routerOpts: { fresh: true, quota_state: { 'haddad-qwen': { exhausted: true } } } });
  ok(q.action === 'defer' && /wait_for_quota|not_permitted/.test(q.reason),
    'B7 a quota-exhausted route waits or is refused, never substituted: ' + q.reason);

  // Claude is never the executor on an instance whose floor excludes it.
  ['implement', 'test', 'review', 'investigate', 'document'].forEach(function (a) {
    probes({ 'haddad-agent': false, 'claude-code': true });
    var r = select({ action: a, instruction: 'x' });
    ok(r.provider !== 'claude-code', 'B8 ' + a + ' never yields claude-code under the Haddad floor (' + r.action + ')');
  });
})();

// ------------------------------------------------- C. unchanged elsewhere

console.log('# C. an instance that is not an execution worker is unchanged');
(function () {
  probes({ 'haddad-agent': false, 'claude-code': true });
  // No allow-list is the VPS shape: the adapter still answers, and the
  // bridge only consults it at all when EXEC_WORKER_PROVIDER is set.
  var d = select({ allowed: null, fallback: 'claude-code' });
  ok(d.action === 'route' && d.provider === 'claude-code', 'C1 with no floor, claude-code is a legitimate route');

  var src = fs.readFileSync(path.join(EXEC, 'bridge', 'github-bridge.js'), 'utf8');
  ok(/EXEC_WORKER_PROVIDER && pinnedProvider !== 'mock'/.test(src),
    'C2 the bridge routes ONLY on an execution-worker instance, never on the VPS default');
  ok(/pinnedProvider =\s*\n?\s*process\.env\.MYTHOS_EXECUTOR_ALLOW_MOCK/.test(src.replace(/\r/g, '')),
    'C3 and the pre-V2.2 expression is still there, as the pin');

  // A category outside the closed action set has no role, so nothing routes.
  var noRole = select({ action: 'coding' });
  ok(noRole.action === 'route' && noRole.provider === 'haddad-agent' && /^no_role/.test(noRole.reason),
    'C4 a non-bridge action falls back to the configured provider: ' + noRole.reason);
})();

// ------------------------------------------------- D. the decision is a record

console.log('# D. the decision is auditable');
(function () {
  probes({ 'haddad-agent': true, 'claude-code': true });
  var d = select();
  ['routed', 'role', 'role_reason', 'task_type', 'capabilities_required', 'router_action', 'router_agent', 'provider', 'why']
    .forEach(function (f) { ok(Object.prototype.hasOwnProperty.call(d.decision, f), 'D1 decision records ' + f); });
  ok(typeof d.decision.why === 'string' && d.decision.why.length > 20, 'D2 and carries a readable reason');
  var src = fs.readFileSync(path.join(EXEC, 'bridge', 'github-bridge.js'), 'utf8');
  ok(/routing: routing\.decision/.test(src), 'D3 the bridge persists it on the attempt record');
  ok(/action: 'defer', task_id: t\.task_id, reason: c\.deferred\.reason/.test(src),
    'D4 and a deferred task is deferred, never blocked — a blocker is not retried');
  ok(/routing_deferred/.test(src), 'D5 with the decision logged');
})();

// ------------------------------------------------- E. no duplicate machinery

console.log('# E. the adapter connects, it does not re-implement');
(function () {
  var src = fs.readFileSync(path.join(EXEC, 'bridge', 'provider-selection.js'), 'utf8');
  var requires = (src.match(/require\('([^']+)'\)/g) || []).map(function (r) { return r.slice(9, -2); });
  ok(requires.length === 3 && requires.indexOf('../lib/roles') !== -1 &&
     requires.indexOf('../core/provider-router') !== -1 && requires.indexOf('../core/agent-registry') !== -1,
    'E1 it depends on exactly the three things it connects (' + requires.join(',') + ')');
  ok(!/RISK_RANK|COST_RANK|selectCandidates *=|function route\b/.test(src),
    'E2 it contains no ranking, no candidate selection and no route() of its own');
  ok(!/PROFILE_BY_ACTION|execution_profile *[:=]/.test(src),
    'E3 and never touches the execution profile — routing chooses WHO, the action still chooses WHAT');
  ok(!/child_process|setInterval|setTimeout|\.listen\(/.test(src), 'E4 no process, timer or listener');
  // The provider for an agent comes from the registry, not a table here.
  agents.resetForTests();
  ok(ps.providerFor('haddad-qwen') === 'haddad-agent' && ps.providerFor('claude-code') === 'claude-code',
    'E5 agent → provider is read from the registry');
  ok(ps.providerFor('no-such-agent') === null, 'E6 and an unknown agent maps to nothing');
})();

// ------------------------------------------------- F. profile invariant

console.log('# F. routing never touches the action→profile invariant');
(function () {
  probes({ 'haddad-agent': true, 'claude-code': true });
  roles.listForApi().forEach(function (r) {
    var d = select({ action: r.action, instruction: 'x' });
    var profile = engine.profileFor(r.action);
    ok(profile === r.execution_profile, 'F1 ' + r.action + ' → ' + profile + ' regardless of who it routes to');
    ok(!Object.prototype.hasOwnProperty.call(d.decision, 'execution_profile'),
      'F2 and the routing decision carries no profile of its own for ' + r.action);
  });
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
try { fs.rmSync(FIXTURES, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(fail ? 1 : 0);
