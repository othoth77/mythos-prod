'use strict';
// =====================================================
// MYTHOS V3.2 — execution intelligence: outcomes become data the router reads
// tests/v32-execution-intelligence-test.js
//
// executor.recordAgentOutcome() records one outcome per terminal report into
// core/reputation.js — the store provider-router already ranks by — with the
// router's own capability key. This pins: what is recorded and what is not;
// that the key is the one the router reads (a key nothing reads would be
// decoration); the console event; and the security property that learned
// data never moves authority past the bridge's allow-list floor.
// Run with: node tests/v32-execution-intelligence-test.js
// =====================================================
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

process.env.MYTHOS_EXECUTOR_HOME = fs.mkdtempSync(path.join(os.homedir(), 'v32-exec-intel-'));
var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var executor = require(path.join(EXEC, 'executor.js'));
var reputation = require(path.join(EXEC, 'core', 'reputation.js'));
var roles = require(path.join(EXEC, 'lib', 'roles.js'));
var router = require(path.join(EXEC, 'core', 'provider-router.js'));
var agents = require(path.join(EXEC, 'core', 'agent-registry.js'));
var selection = require(path.join(EXEC, 'bridge', 'provider-selection.js'));
var telemetry = require(path.join(__dirname, '..', 'projects', 'mythos-haddad', 'bin', 'haddad-telemetry.js'));

var pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + e.message); } }
function mkTask(id) { fs.mkdirSync(path.join(process.env.MYTHOS_EXECUTOR_HOME, 'tasks', id), { recursive: true }); return id; }
function events(id) {
  var p = path.join(process.env.MYTHOS_EXECUTOR_HOME, 'tasks', id, 'events.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
}
function repFile() { return path.join(process.env.MYTHOS_EXECUTOR_HOME, 'orchestration', 'reputation.json'); }
function resetRep() { try { fs.unlinkSync(repFile()); } catch (e) { /* none */ } }
var PASSED = { validation: { passed: true, evidence: {} } };
var REJECTED = { validation: { passed: false, evidence: {} } };

t('X1 a supervised verdict is recorded against the ROUTER\'S key: haddad-agent → haddad-qwen, capability = role.capabilities_required[0]', function () {
  resetRep();
  // debugger is the role whose first capability differs from its task_type,
  // so a recorder keyed on the wrong field cannot pass by coincidence.
  var dbg = roles.getRole('debugger');
  assert.notStrictEqual(dbg.capabilities_required[0], dbg.task_type, 'fixture precondition: the two keys differ');
  var r = executor.recordAgentOutcome({ role: 'debugger' }, mkTask('t-v32-exec-x1'), PASSED, 'haddad-agent', null);
  assert.deepStrictEqual({ agent: r.agent, capability: r.capability, success: r.success }, { agent: 'haddad-qwen', capability: dbg.capabilities_required[0], success: true });
  var s = reputation.stats('haddad-qwen', dbg.capabilities_required[0]);
  assert.strictEqual(s.n, 1); assert.strictEqual(s.successes, 1);
  assert.strictEqual(reputation.stats('haddad-qwen', dbg.task_type).n, 0, 'nothing under the task_type key');
  // The key is the one provider-router ranks by for the same role.
  var src = fs.readFileSync(path.join(EXEC, 'core', 'provider-router.js'), 'utf8');
  assert.ok(/var capability = \(task\.capabilities_required \|\| \[\]\)\[0\] \|\| task\.task_type;/.test(src), 'router ranks by capabilities_required[0] || task_type');
});

t('X2 a rejected verdict is a failure; a non-transient terminal failure without a verdict is a failure', function () {
  resetRep();
  executor.recordAgentOutcome({ role: 'tester' }, mkTask('t-v32-exec-x2a'), REJECTED, 'haddad-agent', null);
  executor.recordAgentOutcome({ role: 'tester' }, mkTask('t-v32-exec-x2b'), { tool_trace: [] }, 'haddad-agent', 'permanent');
  var s = reputation.stats('haddad-qwen', roles.getRole('tester').capabilities_required[0]);
  assert.strictEqual(s.n, 2); assert.strictEqual(s.successes, 0);
});

t('X3 unknown is not failure: transient failures, missing verdicts, unmapped providers and roleless tasks record nothing', function () {
  resetRep();
  assert.strictEqual(executor.recordAgentOutcome({ role: 'coder' }, mkTask('t-v32-exec-x3a'), { tool_trace: [] }, 'haddad-agent', 'transient'), null);
  assert.strictEqual(executor.recordAgentOutcome({ role: 'coder' }, mkTask('t-v32-exec-x3b'), {}, 'haddad-agent', null), null);
  assert.strictEqual(executor.recordAgentOutcome({ role: 'coder' }, mkTask('t-v32-exec-x3d'), PASSED, 'no-such-provider', null), null);
  assert.strictEqual(executor.recordAgentOutcome({}, mkTask('t-v32-exec-x3e'), PASSED, 'haddad-agent', null), null);
  assert.strictEqual(executor.recordAgentOutcome({ role: 'not-a-role' }, mkTask('t-v32-exec-x3f'), PASSED, 'haddad-agent', null), null);
  // A provider that reports no verdict (claude-code) must not accumulate failure-only data.
  assert.strictEqual(executor.recordAgentOutcome({ role: 'coder' }, mkTask('t-v32-exec-x3g'), { stdout: 'x', exit_code: 1 }, 'claude-code', 'permanent'), null, 'no verdict, no supervision evidence: nothing');
  assert.ok(!fs.existsSync(repFile()), 'nothing was written at all');
});

t('X4 the console event: outcome_recorded with structured keys only, INFO, rendered by telemetry', function () {
  resetRep();
  var id = mkTask('t-v32-exec-x4');
  executor.recordAgentOutcome({ role: 'researcher' }, id, PASSED, 'haddad-agent', null);
  var ev = events(id).filter(function (e) { return e.event === 'outcome_recorded'; });
  assert.strictEqual(ev.length, 1);
  assert.deepStrictEqual(Object.keys(ev[0]).sort(), ['event', 'provider', 'reason', 'task_id', 'ts']);
  assert.strictEqual(ev[0].reason, roles.getRole('researcher').capabilities_required[0] + ':pass');
  assert.strictEqual(telemetry.severityFor(ev[0]), 'INFO');
  assert.ok(/^reason=\S+:pass provider=haddad-qwen$/.test(telemetry.eventDetail(ev[0])), telemetry.eventDetail(ev[0]));
});

t('X5 the executor calls the recorder at BOTH terminal report sites (success and failure)', function () {
  var src = fs.readFileSync(path.join(EXEC, 'executor.js'), 'utf8');
  assert.strictEqual((src.match(/recordAgentOutcome\(task, taskId, outcome, status\.provider_used/g) || []).length, 2, 'two call sites');
  assert.ok(/recordAgentOutcome\(task, taskId, outcome, status\.provider_used \|\| task\.provider, \(blocker && blocker\.category\) \|\| 'unknown'\)/.test(src), 'the failure site passes the failure category');
});

t('X6 AUTHORITY DOES NOT MOVE: with claude-code perfect and haddad-qwen failing in the store, the Haddad decision is still haddad-agent or DEFER, never Claude', function () {
  resetRep();
  // Seed the learned data under EVERY role's own key: an instruction that
  // resolves to a role without evidence would never exercise the ranking
  // (found by mutation — "fix the failing thing" resolves to debugger).
  Object.keys(JSON.parse(fs.readFileSync(path.join(EXEC, 'config', 'roles.json'), 'utf8')).roles).forEach(function (id) {
    var r = roles.getRole(id);
    var k = (r.capabilities_required || [])[0] || r.task_type;
    for (var i = 0; i < 20; i++) { reputation.recordOutcome('claude-code', k, true); reputation.recordOutcome('haddad-qwen', k, false); }
  });
  var cap = roles.getRole('coder').capabilities_required[0];
  assert.strictEqual(reputation.stats('claude-code', cap).rate, 1);
  assert.strictEqual(reputation.stats('haddad-qwen', cap).rate, 0);
  // Probes BEFORE any health check: discoverAgents() would cache an agent
  // with no probe as unavailable for five minutes and the case below would
  // never be exercised (found by mutation: the floor could be removed and
  // this test still passed).
  agents.resetForTests();
  var probeAll = function () { return true; };
  ['claude-code', 'haddad-agent', 'openai-compat', 'gemini', 'free-llm-pool'].forEach(function (p) { agents.registerProbe(p, probeAll); });
  var routed = router.route({ id: 'x6', task_type: 'coding', capabilities_required: roles.getRole('coder').capabilities_required.slice() }, {});
  assert.strictEqual(routed.agent, 'claude-code', 'precondition: the learned data DOES make the router prefer Claude here — the floor is what stops it');
  var deferred = 0;
  [['implement', 'add a helper'], ['implement', 'fix the failing thing'], ['test', 'run the tests'], ['review', 'review the change'], ['investigate', 'explain the module'], ['document', 'document the module']].forEach(function (pair) {
    var action = pair[0];
    var d = selection.selectProvider({ action: action, instruction: pair[1], task_id: 'probe', project: 'mythos-haddad', allowed: ['haddad-agent'], fallback: 'haddad-agent' });
    if (d.action === 'defer') deferred++;
    assert.ok(d.action === 'defer' || d.provider === 'haddad-agent', action + ' → ' + d.action + ' ' + d.provider);
    assert.notStrictEqual(d.provider, 'claude-code', 'never Claude on Haddad: ' + action);
  });
  assert.ok(deferred >= 1, 'the learned preference for Claude was real for at least one action, and the floor turned it into DEFER (' + deferred + ')');
  resetRep();
});

t('X7 NO STARVATION in the production shape: only haddad-qwen accumulates evidence on Haddad, so even a 0 % record never reorders the candidates and Qwen is still routed', function () {
  resetRep();
  var cap = roles.getRole('coder').capabilities_required[0];
  for (var i = 0; i < 20; i++) reputation.recordOutcome('haddad-qwen', cap, false);
  assert.strictEqual(reputation.stats('haddad-qwen', cap).sufficient, true);
  assert.strictEqual(reputation.stats('claude-code', cap).sufficient, false, 'claude-code never executes on Haddad, so it has no evidence there');
  agents.resetForTests();
  ['claude-code', 'haddad-agent', 'openai-compat', 'gemini', 'free-llm-pool'].forEach(function (p) { agents.registerProbe(p, function () { return true; }); });
  var d = selection.selectProvider({ action: 'implement', instruction: 'add a helper', task_id: 'probe', project: 'mythos-haddad', allowed: ['haddad-agent'], fallback: 'haddad-agent' });
  assert.strictEqual(d.action, 'route', d.reason);
  assert.strictEqual(d.provider, 'haddad-agent', 'Qwen is still the executor: ' + d.reason);
  resetRep();
});

try { fs.rmSync(process.env.MYTHOS_EXECUTOR_HOME, { recursive: true, force: true }); } catch (e) { /* best effort */ }
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
