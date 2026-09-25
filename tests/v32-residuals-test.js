'use strict';
// =====================================================
// MYTHOS V3.2 residuals 3, 4, 5 — review decision, GPU envelope + recovery,
// task sizing + prompt compaction
// tests/v32-residuals-test.js
//
// Real runner, real validator, real sandbox; the model and the runtime's
// health are scripted so the sequences are deterministic.
// Run with: node tests/v32-residuals-test.js
// =====================================================
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var OWN_STORE = !process.env.MYTHOS_EXECUTOR_HOME;
process.env.MYTHOS_EXECUTOR_HOME = process.env.MYTHOS_EXECUTOR_HOME || fs.mkdtempSync(path.join(os.homedir(), 'v32-res-store-'));
var ROOT_REPO = path.join(__dirname, '..');
var EXEC = path.join(ROOT_REPO, 'projects', 'mythos-ai-executor');
var agent = require(path.join(EXEC, 'providers', 'haddad-agent.js'));
var executor = require(path.join(EXEC, 'executor.js'));
var bridge = require(path.join(EXEC, 'bridge', 'github-bridge.js'));
var reviewGate = require(path.join(EXEC, 'bridge', 'review-gate.js'));
var reporting = require(path.join(EXEC, 'lib', 'report.js'));

var pass = 0, fail = 0, queue = [];
function t(name, fn) {
  queue.push(function () {
    return Promise.resolve().then(fn).then(
      function () { pass++; console.log('ok - ' + name); },
      function (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); });
  });
}
var WS_ROOT = fs.mkdtempSync(path.join(os.homedir(), 'v32-res-'));
function ws(name) {
  var d = path.join(WS_ROOT, name); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'add.js'), 'module.exports = function add(a, b) { return a - b; };\n');
  fs.writeFileSync(path.join(d, 'add.test.js'), 'var add=require("./add");if(add(2,5)!==7){console.error("bad");process.exit(1)}console.log("ok");\n');
  return d;
}
var FIXED = 'module.exports = function add(a, b) { return a + b; };\n';
function say(x) { return { role: 'assistant', content: x }; }
function call(id, n, a) { return { role: 'assistant', content: null, tool_calls: [{ id: id, type: 'function', function: { name: n, arguments: JSON.stringify(a) } }] }; }
function report() { return '```json\n' + JSON.stringify({ mythos_report: true, status: 'completed', summary: 'done', files_changed: ['add.js'], tests: [], commit: null }) + '\n```'; }
function task(d, over) { return Object.assign({ task_id: 't-res', working_directory: d, execution_profile: 'repo-write', timeout_seconds: 600, required_tests: ['node add.test.js'], constraints: ['Only change add.js'] }, over || {}); }

// ---------------------------------------------------------------- R5: prompt compaction
t('P1 the executor gives the local runner a compact prompt; every other provider keeps the full template', function () {
  var base = { task_id: 't-20260925000000-abcdef', project: 'mythos-haddad', repository: 'r', branch: 'b', stage: 's', instruction: 'Fix add.', constraints: ['Only change add.js'], required_tests: ['node add.test.js'], expected_delivery: 'commit' };
  var local = executor.buildPrompt(Object.assign({ provider: 'haddad-agent' }, base), {}, null);
  var full = executor.buildPrompt(Object.assign({ provider: 'claude-code' }, base), {}, null);
  ['## Continuity', '## Mandatory final report', '## Execution contract'].forEach(function (h) {
    assert.ok(local.indexOf(h) === -1, 'local omits ' + h);
    assert.ok(full.indexOf(h) !== -1, 'full keeps ' + h);
  });
  ['Fix add.', 'Only change add.js', 'node add.test.js', 'never print, commit or persist secrets'].forEach(function (x) { assert.ok(local.indexOf(x) !== -1, 'local keeps ' + x); });
  assert.ok(full.length - local.length > 1500, 'saves > 1.5 KB: ' + (full.length - local.length));
});

t('P2 the bridge gives Haddad tasks a one-line header instead of the OTHMODE paragraph; other providers unchanged', function () {
  var cfg = { branch: 'mythos/control-haddad', prefix: 'control', repo: '/repo' };
  var tk = { task_id: 'gh-issue-1', project: 'mythos-haddad', requested_action: 'implement', created_by: 'x', objective: 'Do it.', scope: [], constraints: [], validation_requirements: [],
    source: { kind: 'github-issue', issue_number: 1, issue_url: 'u' } };
  var exec = { execution_profile: 'repo-write', worktree: '/w', branch: 'b', base_commit: 'abc' };
  var h = bridge.buildInstruction(cfg, tk, exec, 'haddad-agent');
  var c = bridge.buildInstruction(cfg, tk, exec, 'claude-code');
  assert.ok(!/othmode-cli|OTHMODE Task record/.test(h), 'no OTHMODE record paragraph for the local runner');
  assert.ok(/^Task gh-issue-1 \(project mythos-haddad/.test(h), 'short header');
  assert.ok(/othmode — GitHub control task gh-issue-1/.test(c) && /OTHMODE Task record/.test(c), 'the paragraph is intact for every other provider');
  ['## Objective', 'Do it.', '## Bridge constraints (non-negotiable)', 'Never run `git push`'].forEach(function (x) { assert.ok(h.indexOf(x) !== -1, 'kept: ' + x); });
  assert.ok(c.length - h.length > 600, 'saves > 600 chars: ' + (c.length - h.length));
});

// ---------------------------------------------------------------- R5: sizing
t('Z1 sizeTask: fits a small task; refuses an oversized one with numbers; the hint names the largest contributor', function () {
  var small = agent.sizeTask({ baseChars: 6000, scopeFiles: [{ path: 'a.js', bytes: 400 }], largestFenceChars: 0, budget: 5000 });
  assert.strictEqual(small.fits, true, JSON.stringify(small));
  var bigFile = agent.sizeTask({ baseChars: 9000, scopeFiles: [{ path: 'big.json', bytes: 2800 }], largestFenceChars: 300, budget: 5000 });
  assert.strictEqual(bigFile.fits, false); assert.ok(/target file is too large/.test(bigFile.hint), bigFile.hint);
  var twoFiles = agent.sizeTask({ baseChars: 8000, scopeFiles: [{ path: 'a.js', bytes: 1800 }, { path: 'b.js', bytes: 1800 }], largestFenceChars: 0, budget: 5000 });
  assert.strictEqual(twoFiles.fits, false); assert.ok(/split per file/.test(twoFiles.hint), twoFiles.hint);
  var fence = agent.sizeTask({ baseChars: 9000, scopeFiles: [], largestFenceChars: 6000, budget: 5000 });
  assert.strictEqual(fence.fits, false); assert.ok(/content spelled out/.test(fence.hint), fence.hint);
  var fixed = agent.sizeTask({ baseChars: 12000, scopeFiles: [], largestFenceChars: 0, budget: 5000 });
  assert.ok(fixed.reasons.some(function (r) { return /fixed prompt alone/.test(r); }), 'a prompt eating > 75 % is refused on its own');
});

t('Z2 a too-large task is refused BEFORE any GPU time, as a structured blocked report with a decomposition hint', function () {
  var d = ws('too-large');
  fs.writeFileSync(path.join(d, 'add.js'), '// ' + new Array(9000).join('x') + '\n');   // a ~9 KB target file
  var calls = 0;
  var transport = function () { calls++; return Promise.resolve({ status: 200, body: JSON.stringify({ choices: [{ message: say('x') }] }) }); };
  return agent.run(task(d), 'Fix add.', null, 'start', { apiKey: 'k', model: 'm', transport: transport }).then(function (o) {
    assert.strictEqual(calls, 0, 'the runtime was never asked');
    var r = reporting.extractReport(o.stdout).report;
    assert.strictEqual(r.status, 'blocked');
    assert.ok(/TASK_TOO_LARGE/.test(r.summary) && /no GPU time/.test(r.summary), r.summary);
    assert.ok(/decompose/.test(r.next_stage) && /add\.js/.test(r.next_stage), r.next_stage);
    assert.ok(o.tool_trace.some(function (e) { return e.tool === 'task_sizing' && e.refused; }));
    assert.strictEqual(o.validation, undefined, 'no verdict, so the outcome recorder records nothing against Qwen');
  });
});

t('Z3 a task that fits runs as before, with the sizing numbers in its trace', function () {
  var d = ws('fits');
  return agent.run(task(d), 'Fix add.', null, 'start', { apiKey: 'k', model: 'm', structuredReport: false,
    transport: (function () { var i = 0, r = [call('w', 'write_file', { path: 'add.js', content: FIXED }), say(report())];
      return function () { return Promise.resolve({ status: 200, body: JSON.stringify({ choices: [{ message: r[Math.min(i++, 1)] }] }) }); }; })() }).then(function (o) {
    assert.strictEqual(o.validation.passed, true, JSON.stringify(o.validations));
    var s = o.tool_trace.filter(function (e) { return e.tool === 'task_sizing'; })[0];
    assert.ok(s && !s.refused && /need ~\d+ of 5000 tokens/.test(s.detail), s && s.detail);
  });
});

// ---------------------------------------------------------------- R4: envelope
t('E1 the prompt budget is capped by the measured safe envelope (5000), never above the window budget', function () {
  assert.strictEqual(agent.SAFE_PROMPT_TOKENS, 5000);
  assert.strictEqual(agent.PROMPT_BUDGET_TOKENS, Math.min(agent.CONTEXT_WINDOW_TOKENS - agent.MAX_TOKENS_PER_TURN - 384, 5000));
  var r = cp.spawnSync(process.execPath, ['-e', 'console.log(require(process.argv[1]).PROMPT_BUDGET_TOKENS)', path.join(EXEC, 'providers', 'haddad-agent.js')],
    { env: Object.assign({}, process.env, { HADDAD_AGENT_SAFE_PROMPT_TOKENS: '3500' }), encoding: 'utf8' });
  assert.strictEqual(r.stdout.trim(), '3500', 'a host with another card sets its own envelope');
  var r2 = cp.spawnSync(process.execPath, ['-e', 'console.log(require(process.argv[1]).PROMPT_BUDGET_TOKENS)', path.join(EXEC, 'providers', 'haddad-agent.js')],
    { env: Object.assign({}, process.env, { HADDAD_AGENT_SAFE_PROMPT_TOKENS: '99999' }), encoding: 'utf8' });
  assert.strictEqual(r2.stdout.trim(), String(agent.CONTEXT_WINDOW_TOKENS - agent.MAX_TOKENS_PER_TURN - 384), 'never above what the window allows');
});

// ---------------------------------------------------------------- R4: runtime recovery
function flaky(losses, errText) {
  var i = 0, sent = 0;
  var good = [call('w', 'write_file', { path: 'add.js', content: FIXED }), say(report())], gi = 0;
  var fn = function () {
    sent++;
    if (i < losses) { i++; return Promise.reject(new Error(errText || 'socket hang up')); }
    return Promise.resolve({ status: 200, body: JSON.stringify({ choices: [{ message: good[Math.min(gi++, 1)] }] }) });
  };
  fn.sent = function () { return sent; };
  return fn;
}
t('R1 the runtime dies under a turn (DeviceLost -> socket hang up): the SAME execution waits for it, replays the turn and passes', function () {
  var d = ws('recover'); var probes = 0;
  var tr = flaky(1);
  return agent.run(task(d), 'Fix add.', null, 'start', { apiKey: 'k', model: 'm', structuredReport: false, transport: tr, runtimePollMs: 5,
    runtimeProbe: function () { probes++; return probes >= 3; } }).then(function (o) {
    assert.strictEqual(o.validation.passed, true, JSON.stringify(o.validations || o.stderr));
    var rec = o.tool_trace.filter(function (e) { return e.tool === 'runtime_recovered'; });
    assert.strictEqual(rec.length, 1); assert.strictEqual(rec[0].refused, false);
    assert.ok(/runtime answered again/.test(rec[0].detail), rec[0].detail);
    assert.ok(probes >= 3, 'it waited for the runtime rather than retrying blind');
  });
});

t('R2 bounded: after two recoveries a third loss ends the execution with the runtime code (then the executor\'s transient retry applies)', function () {
  var d = ws('recover-bound');
  return agent.run(task(d), 'Fix add.', null, 'start', { apiKey: 'k', model: 'm', transport: flaky(5), runtimePollMs: 1, runtimeProbe: function () { return true; } }).then(function (o) {
    assert.strictEqual(o.parsed.subtype, 'HADDAD_AGENT_RUNTIME');
    assert.strictEqual(o.tool_trace.filter(function (e) { return e.tool === 'runtime_recovered'; }).length, 2);
  });
});

t('R3 a runtime that stays down within the wait ends the execution honestly; a non-network error is never "recovered"', function () {
  var d = ws('recover-down');
  return agent.run(task(d), 'Fix add.', null, 'start', { apiKey: 'k', model: 'm', transport: flaky(9), runtimePollMs: 1, runtimeWaitMs: 50, runtimeProbe: function () { return false; } }).then(function (o) {
    assert.strictEqual(o.parsed.subtype, 'HADDAD_AGENT_RUNTIME');
    var rec = o.tool_trace.filter(function (e) { return e.tool === 'runtime_recovered'; });
    assert.ok(rec.length >= 1 && rec.every(function (e) { return e.refused; }), 'recorded as not recovered');
    var d2 = ws('no-recover-400');
    return agent.run(task(d2), 'Fix add.', null, 'start', { apiKey: 'k', model: 'm', runtimePollMs: 1, runtimeProbe: function () { return true; },
      transport: function () { return Promise.resolve({ status: 400, body: JSON.stringify({ error: { message: 'bad request' } }) }); } });
  }).then(function (o) {
    assert.strictEqual(o.parsed.subtype, 'HADDAD_AGENT_RUNTIME');
    assert.strictEqual(o.tool_trace.filter(function (e) { return e.tool === 'runtime_recovered'; }).length, 0, 'an HTTP 400 is not a lost runtime');
  });
});

// ---------------------------------------------------------------- R3: review decision
t('V1 review_fn is NOT on the live path: the bridge review gate never auto-approves; only a human continuation satisfies it', function () {
  var prev = process.env.MYTHOS_BRIDGE_REVIEW_GATE; process.env.MYTHOS_BRIDGE_REVIEW_GATE = '1';
  try {
    var commitTask = { task_id: 'gh-issue-9', requested_action: 'implement', execution: { execution_profile: 'repo-write' } };
    var rep = { status: 'completed', commit: 'abc123', files_changed: ['a.js'] };
    var held = reviewGate.evaluate(commitTask, rep);
    assert.strictEqual(held.required, true); assert.strictEqual(held.satisfied, false, 'held for review');
    var approved = reviewGate.evaluate(Object.assign({}, commitTask, { continues: { task_id: 'gh-issue-9', reason: 'review_required' } }), rep);
    assert.strictEqual(approved.satisfied, true); assert.strictEqual(approved.approved_by, 'gh-issue-9', 'approval = the owner\'s rerun of the held task');
  } finally { if (prev === undefined) delete process.env.MYTHOS_BRIDGE_REVIEW_GATE; else process.env.MYTHOS_BRIDGE_REVIEW_GATE = prev; }
  var gateSrc = fs.readFileSync(path.join(EXEC, 'bridge', 'review-gate.js'), 'utf8');
  assert.ok(!/review_fn|adversarialReview\(/.test(gateSrc.replace(/\/\/.*$/gm, '')), 'the live gate calls no in-process reviewer');
  ['executor.js', 'bridge/github-bridge.js', 'providers/haddad-agent.js'].forEach(function (f) {
    assert.ok(!/review_fn/.test(fs.readFileSync(path.join(EXEC, f), 'utf8')), f + ' does not wire review_fn');
  });
});

queue.reduce(function (c, s) { return c.then(s); }, Promise.resolve()).then(function () {
  try { fs.rmSync(WS_ROOT, { recursive: true, force: true }); if (OWN_STORE) fs.rmSync(process.env.MYTHOS_EXECUTOR_HOME, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
