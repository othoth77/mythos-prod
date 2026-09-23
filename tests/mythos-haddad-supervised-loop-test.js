'use strict';
// =====================================================
// MYTHOS HADDAD — supervised execution: validate, repair, stop
// tests/mythos-haddad-supervised-loop-test.js
//
// The claim this file exists to test is not "the worker can write a file".
// It is: a worker's report is never the evidence. The acceptance criteria a
// task declared are RE-RUN by the validator, the workspace is measured
// against a snapshot taken before the attempt, and when the evidence
// disagrees with the claim the claim loses — the worker is handed its own
// measured failures and tries again, up to a bound, and then stops for a
// person.
//
// The model is a scripted transport, so the SEQUENCE is deterministic —
// but every file write, every check, and every verdict below is real: real
// files on disk, real `node` runs inside the real sandbox, the real
// validator. Nothing about the verdict is mocked.
//
// Fixtures live under $HOME, not /tmp: the sandbox mounts a scratch tmpfs
// at /tmp, so a workspace there would not mirror production.
//
// Run with: node tests/mythos-haddad-supervised-loop-test.js
// =====================================================

var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var agent = require(path.join(EXEC, 'providers', 'haddad-agent.js'));
var work = require(path.join(EXEC, 'lib', 'work-validation.js'));
// R1-R3 exercise the executor's delivery gate directly. It needs a store
// path, and it must not be a real one.
process.env.MYTHOS_EXECUTOR_HOME = process.env.MYTHOS_EXECUTOR_HOME ||
  fs.mkdtempSync(path.join(os.homedir(), 'haddad-sup-store-'));
var executor = require(path.join(EXEC, 'executor.js'));

var pass = 0, fail = 0, failures = [];
var queue = [];
function t(name, fn) {
  queue.push(function () {
    return Promise.resolve().then(fn).then(
      function () { pass++; console.log('ok - ' + name); },
      function (e) { fail++; failures.push(name); console.log('not ok - ' + name + '\n  ' + (e && e.message)); }
    );
  });
}

var ROOT = fs.mkdtempSync(path.join(os.homedir(), 'haddad-supervised-'));

// --- a scripted model -------------------------------------------------------
// Each reply is either plain text (the model says it is done) or a tool call.
// The transport records what it was SENT, so the repair brief the worker
// actually receives can be asserted rather than assumed.
function fakeTransport(replies) {
  var i = 0;
  var sent = [];
  var fn = function (opts, body) {
    sent.push(JSON.parse(body));
    var reply = replies[Math.min(i++, replies.length - 1)];
    return Promise.resolve({ status: 200, body: JSON.stringify({ choices: [{ message: reply }] }) });
  };
  fn.sent = sent;
  return fn;
}
function say(text) { return { role: 'assistant', content: text }; }
function callTool(id, name, args) {
  return { role: 'assistant', content: null,
    tool_calls: [{ id: id, type: 'function', function: { name: name, arguments: JSON.stringify(args) } }] };
}
function tc(id, name, args) { return { id: id, type: 'function', function: { name: name, arguments: JSON.stringify(args) } }; }
function msgWithCalls(calls) { return { role: 'assistant', content: null, tool_calls: calls }; }
function report(status, summary, files) {
  return '```json\n' + JSON.stringify({ mythos_report: true, status: status || 'completed',
    summary: summary || 'done', files_changed: files || [], tests: [], commit: null }) + '\n```';
}

function newWorkspace(name) {
  var ws = path.join(ROOT, name);
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

// The task under test everywhere below: a real, checkable unit of work.
// `add` is deliberately wrong to begin with, and the check is a real test
// file that runs it.
function seedBrokenProject(ws) {
  fs.writeFileSync(path.join(ws, 'add.js'), 'module.exports = function add(a, b) { return a - b; };\n');
  // Two cases on purpose: one case can be satisfied by a coincidence
  // (2*2===4) or by a constant, and a check that a wrong answer can pass is
  // not a check.
  fs.writeFileSync(path.join(ws, 'add.test.js'),
    'var add = require("./add");\n' +
    'if (add(2, 2) !== 4) { console.error("add(2,2) returned " + add(2, 2) + ", expected 4"); process.exit(1); }\n' +
    'if (add(2, 5) !== 7) { console.error("add(2,5) returned " + add(2, 5) + ", expected 7"); process.exit(1); }\n' +
    'console.log("add ok");\n');
}

function runTask(ws, replies, over, extraOpts) {
  var task = Object.assign({
    task_id: 't-sup', working_directory: ws, execution_profile: 'repo-write',
    timeout_seconds: 600, required_tests: ['node add.test.js'], constraints: ['Only change add.js']
  }, over || {});
  var transport = fakeTransport(replies);
  return agent.run(task, 'Fix add so its test passes.', null, 'start',
    Object.assign({ apiKey: 'k', model: 'm', transport: transport }, extraOpts || {})).then(function (o) {
      o._sent = transport.sent;
      return o;
    });
}

var FIXED = 'module.exports = function add(a, b) { return a + b; };\n';

// A rejected attempt does not crash: it ends cleanly with a `blocked`
// report so the executor's existing classifier calls it a human decision.
// These two helpers read that contract.
var reporting = require(path.join(EXEC, 'lib', 'report.js'));
function blockedReport(o) {
  var r = reporting.extractReport(o.stdout).report;
  assert.ok(r, 'a structured report was emitted');
  assert.strictEqual(r.status, 'blocked', 'and it asks for a person');
  return r;
}
function rejections(o) { return blockedReport(o).residual_risks.join(' | '); }

// ===========================================================================
// A. The report is not the evidence
// ===========================================================================

t('A1 a worker that claims success while the check fails is REJECTED', function () {
  var ws = newWorkspace('claims-success');
  seedBrokenProject(ws);
  // The model touches nothing and declares victory, three times over.
  return runTask(ws, [say(report('completed', 'All tests pass.'))]).then(function (o) {
    assert.strictEqual(o.validation.passed, false, 'the claim did not survive validation');
    var rep = require(path.join(EXEC, 'lib', 'report.js')).extractReport(o.stdout).report;
    assert.strictEqual(rep.status, 'blocked', 'it stops for a person');
    assert.ok(/add\.test\.js` did not pass/.test(rep.residual_risks.join(' | ')), rep.residual_risks.join(' | '));
    assert.strictEqual(o.repair_rounds, agent.MAX_REPAIR_ROUNDS, 'it used its repair budget first');
  });
});

t('A2 the rejection carries the REAL output of the failing check', function () {
  var ws = newWorkspace('real-output');
  seedBrokenProject(ws);
  return runTask(ws, [say(report('completed', 'Done.'))]).then(function (o) {
    var last = o.validations[o.validations.length - 1];
    var check = last.evidence.checks_run[0];
    assert.strictEqual(check.passed, false);
    assert.strictEqual(check.exit_code, 1, 'a real exit code from a real run');
    assert.ok(/add\(2,2\) returned 0, expected 4/.test(check.output),
      'the real stderr of the real test came back: ' + check.output);
  });
});

t('A3 a report that ADMITS failure is never a pass', function () {
  var ws = newWorkspace('admits-failure');
  seedBrokenProject(ws);
  fs.writeFileSync(path.join(ws, 'add.js'), FIXED);   // work is actually fine
  return runTask(ws, [say(report('failed', 'I could not finish.'))]).then(function (o) {
    assert.strictEqual(o.validation.passed, false, 'an admitted failure is not overridden by passing checks');
    assert.ok(/reports failure/.test(rejections(o)), rejections(o));
  });
});

// ===========================================================================
// B. The repair loop — the experiment this stage exists for
// ===========================================================================

t('B1 fail → diagnose → the worker repairs → checks pass → SUCCESS', function () {
  var ws = newWorkspace('repair-loop');
  seedBrokenProject(ws);
  return runTask(ws, [
    // Attempt 1: writes something that is still wrong, then claims success.
    callTool('c1', 'write_file', { path: 'add.js', content: 'module.exports = function add(a, b) { return a * b; };\n' }),
    // a*b passes add(2,2)===4 by coincidence and fails add(2,5)===7.
    say(report('completed', 'Fixed add.', ['add.js'])),
    // Attempt 2, after the repair brief: the real fix.
    callTool('c2', 'write_file', { path: 'add.js', content: FIXED }),
    say(report('completed', 'add now returns a + b.', ['add.js']))
  ]).then(function (o) {
    assert.strictEqual(o.parsed.is_error, false, 'the task succeeded: ' + o.stderr);
    assert.strictEqual(o.repair_rounds, 1, 'exactly one repair round was needed');
    assert.strictEqual(o.validations.length, 2, 'validation ran after each attempt');
    assert.strictEqual(o.validations[0].pass, false, 'attempt 1 was rejected');
    assert.strictEqual(o.validations[1].pass, true, 'attempt 2 was accepted');
    assert.strictEqual(fs.readFileSync(path.join(ws, 'add.js'), 'utf8'), FIXED,
      'the repaired file is really on disk');
    assert.strictEqual(o.validation.passed, true);
    assert.strictEqual(o.validation.evidence.mechanically_verified, true,
      'and the pass was mechanical, not assumed');
  });
});

t('B4 running out of turns with the work DONE is a rejected attempt, not a stop: the next round is asked only for the report', function () {
  var ws = newWorkspace('out-of-turns');
  seedBrokenProject(ws);
  // Attempt 1: the real fix on the first turn, then 11 more tool turns
  // re-running the check without ever reporting — gh-issue-374, live.
  var replies = [callTool('c1', 'write_file', { path: 'add.js', content: FIXED })];
  for (var i = 0; i < agent.MAX_ITERATIONS - 1; i++) replies.push(callTool('r' + i, 'run_command', { program: 'node', args: ['add.test.js'] }));
  // Attempt 2: the brief says everything passes — it only reports.
  replies.push(say(report('completed', 'add returns a + b; the check passes.', ['add.js'])));
  return runTask(ws, replies).then(function (o) {
    assert.strictEqual(o.parsed.is_error, false, 'the task succeeded: ' + o.stderr + ' ' + JSON.stringify(o.parsed).slice(0, 300));
    assert.strictEqual(o.repair_rounds, 1, 'the cap consumed one repair round');
    assert.strictEqual(o.validations.length, 2);
    assert.strictEqual(o.validations[0].pass, false, 'attempt 1 was rejected (no report)');
    assert.ok(o.validations[0].evidence.checks_run.every(function (c) { return c.passed; }), 'but its checks already passed');
    assert.strictEqual(o.validations[1].pass, true);
    var brief = o._sent[agent.MAX_ITERATIONS].messages.slice(-1)[0].content;
    assert.ok(/used all \d+ tool turns without emitting the final report/.test(brief), brief.slice(0, 300));
    assert.ok(/ALL OF THEM PASS\. Do not change anything: emit the final/.test(brief), 'told to report, not to change');
    assert.ok(!/### What to do now — as TOOL CALLS/.test(brief), 'no tool-call steps when nothing is left to fix');
    assert.strictEqual(o.validation.evidence.mechanically_verified, true);
  });
});

t('B5 running out of turns with a check still FAILING repairs it, and a spent budget stops for a person', function () {
  var ws = newWorkspace('out-of-turns-failing');
  seedBrokenProject(ws);
  var replies = [];
  for (var i = 0; i < agent.MAX_ITERATIONS; i++) replies.push(callTool('r' + i, 'read_file', { path: 'add.js' }));
  // Attempt 2 after the brief: fixes and reports.
  replies.push(callTool('w', 'write_file', { path: 'add.js', content: FIXED }));
  replies.push(say(report('completed', 'fixed', ['add.js'])));
  return runTask(ws, replies).then(function (o) {
    assert.strictEqual(o.parsed.is_error, false, o.stderr);
    assert.strictEqual(o.repair_rounds, 1);
    var brief = o._sent[agent.MAX_ITERATIONS].messages.slice(-1)[0].content;
    assert.ok(/the ones that still fail are listed below/.test(brief), brief.slice(0, 400));
    assert.ok(/### What to do now — as TOOL CALLS/.test(brief));
    // And the bound holds: three cap-outs in a row stop for a person.
    var ws2 = newWorkspace('out-of-turns-x3');
    seedBrokenProject(ws2);
    var r2 = [];
    for (var j = 0; j < agent.MAX_ITERATIONS * 3; j++) r2.push(callTool('q' + j, 'read_file', { path: 'add.js' }));
    return runTask(ws2, r2);
  }).then(function (o) {
    assert.strictEqual(o.repair_rounds, 2);
    assert.strictEqual(o.validations.length, 3);
    var rep = require(path.join(EXEC, 'lib', 'report.js')).extractReport(o.parsed.result).report;
    assert.ok(rep && rep.status === 'blocked' && /repair budget is spent/.test(rep.summary), JSON.stringify(rep).slice(0, 300));
  });
});

t('B6 every model turn is bounded in tokens (a runaway answer cannot eat the request timeout)', function () {
  var ws = newWorkspace('max-tokens');
  seedBrokenProject(ws);
  return runTask(ws, [callTool('c1', 'write_file', { path: 'add.js', content: FIXED }), say(report('completed', 'fixed', ['add.js']))]).then(function (o) {
    assert.ok(o._sent.length >= 2);
    o._sent.forEach(function (req) { assert.strictEqual(req.max_tokens, agent.MAX_TOKENS_PER_TURN, 'max_tokens on every request'); });
    // The adapter's default request shape is unchanged for every other caller.
    var adapter = require(path.join(EXEC, 'free-llm', 'adapter.js'));
    var seen = null;
    return adapter.chatCompletion({ baseUrl: 'http://x', apiKey: 'k', model: 'm' }, 'hi', {
      transport: function (o2, body) { seen = JSON.parse(body); return Promise.resolve({ status: 200, body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }) }); }
    }).then(function () { assert.ok(seen && !('max_tokens' in seen), 'no max_tokens unless asked for'); });
  });
});

t('B7 the tool-call budget is per execution: a repair round is not starved by the round before it', function () {
  var ws = newWorkspace('budget-per-round');
  seedBrokenProject(ws);
  var replies = [];
  // Attempt 1 spends the whole tool budget on reads, then reports.
  var many = []; for (var i = 0; i < agent.MAX_TOOL_CALLS; i++) many.push(tc('m' + i, 'read_file', { path: 'add.js' }));
  replies.push(msgWithCalls(many));
  replies.push(say(report('completed', 'looked', [])));
  // Attempt 2 must still be able to write and run.
  replies.push(callTool('w', 'write_file', { path: 'add.js', content: FIXED }));
  replies.push(callTool('r', 'run_command', { program: 'node', args: ['add.test.js'] }));
  replies.push(say(report('completed', 'fixed', ['add.js'])));
  return runTask(ws, replies).then(function (o) {
    assert.strictEqual(o.parsed.is_error, false, o.stderr);
    assert.strictEqual(o.repair_rounds, 1);
    var refusedInRound2 = o.tool_trace.slice(agent.MAX_TOOL_CALLS).filter(function (x) { return x.refused; });
    assert.strictEqual(refusedInRound2.length, 0, 'round two was not refused: ' + JSON.stringify(refusedInRound2));
    assert.ok(o.tool_calls <= agent.MAX_TOOL_CALLS * (agent.MAX_REPAIR_ROUNDS + 1), 'still bounded overall');
  });
});

t('B8 diagnosis escalation: only on the LAST repair round, only when a diagnoser exists, given the measured failures, and it executes nothing', function () {
  var ws = newWorkspace('diagnosis');
  seedBrokenProject(ws);
  var asks = [];
  var diagnose = function (ask) { asks.push(ask); return 'Cause: add multiplies. Write add.js as:\n```javascript\n' + FIXED + '```'; };
  return runTask(ws, [
    say(report('completed', 'Done.')),                                   // attempt 1: nothing done → rejected
    say(report('completed', 'Done again.')),                             // repair 1: still nothing → rejected (no diagnosis yet)
    callTool('w', 'write_file', { path: 'add.js', content: FIXED }),     // repair 2, after the diagnosis
    say(report('completed', 'fixed as diagnosed', ['add.js']))
  ], {}, { diagnose: diagnose }).then(function (o) {
    assert.strictEqual(o.parsed.is_error, false, o.stderr);
    assert.strictEqual(asks.length, 1, 'the diagnoser was asked exactly once');
    assert.ok(/## Measured failures/.test(asks[0]) && /add\(2,2\) returned 0, expected 4/.test(asks[0]), 'it was given the measured evidence');
    assert.ok(/## Current content of the constrained files/.test(asks[0]));
    var brief1 = o._sent[1].messages.slice(-1)[0].content;
    var brief2 = o._sent[2].messages.slice(-1)[0].content;
    assert.ok(!/### Diagnosis \(escalated/.test(brief1), 'the first repair round is the local model\'s own');
    assert.ok(/### Diagnosis \(escalated — follow it exactly, as tool calls\)\nCause: add multiplies/.test(brief2), 'the last round carries the diagnosis');
    assert.strictEqual(fs.readFileSync(path.join(ws, 'add.js'), 'utf8'), FIXED, 'the LOCAL model wrote the file, through write_file');
    assert.strictEqual(o.validation.passed, true);
  }).then(function () {
    // Without a diagnoser nothing changes: the brief goes alone.
    var ws2 = newWorkspace('no-diagnoser'); seedBrokenProject(ws2);
    delete process.env.HADDAD_AGENT_DIAGNOSER;
    return runTask(ws2, [say(report('completed', 'x')), say(report('completed', 'y')), say(report('completed', 'z'))]);
  }).then(function (o) {
    o._sent.slice(1).forEach(function (req) { assert.ok(!/### Diagnosis/.test(req.messages.slice(-1)[0].content), 'no diagnosis without a diagnoser'); });
  }).then(function () {
    // A diagnoser command that fails is fail-open: the brief still goes.
    var ws3 = newWorkspace('diagnoser-fails'); seedBrokenProject(ws3);
    process.env.HADDAD_AGENT_DIAGNOSER = '/bin/false';
    return runTask(ws3, [say(report('completed', 'x')), say(report('completed', 'y')), say(report('completed', 'z'))]).then(function (o) {
      delete process.env.HADDAD_AGENT_DIAGNOSER;
      var last = o._sent[2].messages.slice(-1)[0].content;
      assert.ok(/## REPAIR REQUIRED \(attempt 2\)/.test(last) && !/### Diagnosis/.test(last), 'brief without diagnosis');
      var d = o.tool_trace.filter(function (x) { return x.tool === 'diagnose'; });
      assert.strictEqual(d.length, 1); assert.ok(d[0].refused && /diagnoser exit 1/.test(d[0].detail), 'the failed escalation is in the trace');
    });
  });
});

t('B9 budget spent, every check passing by measurement, no readable report: completed with a SYNTHESIZED report — never for a check that fails', function () {
  var ws = newWorkspace('verified-no-report');
  seedBrokenProject(ws);
  // Three executions: the fix lands on the first turn, but no execution ever
  // ends in a report (degenerate answers, as measured live on gh-issue-378).
  return runTask(ws, [
    callTool('w', 'write_file', { path: 'add.js', content: FIXED }), say('Ronaldo {{"name": "run_command"}}'),
    say('Ronaldo'), say('Ronaldo')
  ]).then(function (o) {
    assert.strictEqual(o.parsed.is_error, false, o.stderr);
    assert.strictEqual(o.repair_rounds, 2, 'the budget was spent first');
    assert.strictEqual(o.validation.passed, true);
    assert.strictEqual(o.validation.report_synthesized, true, 'and the report is marked synthesized');
    var rep = require(path.join(EXEC, 'lib', 'report.js')).extractReport(o.parsed.result).report;
    assert.ok(rep && rep.status === 'completed' && /synthesized/.test(rep.summary), JSON.stringify(rep).slice(0, 300));
    assert.deepStrictEqual(rep.files_changed, ['add.js']);
    assert.ok(rep.residual_risks.some(function (r) { return /synthesized by the validator/.test(r); }));
    assert.strictEqual(fs.readFileSync(path.join(ws, 'add.js'), 'utf8'), FIXED);
  }).then(function () {
    // The same shape with a check still FAILING stays a stop for a person.
    var ws2 = newWorkspace('unverified-no-report'); seedBrokenProject(ws2);
    return runTask(ws2, [callTool('w', 'write_file', { path: 'add.js', content: 'module.exports = function add(a, b) { return a * b; };\n' }), say('Ronaldo'), say('Ronaldo'), say('Ronaldo')]);
  }).then(function (o) {
    var rep = require(path.join(EXEC, 'lib', 'report.js')).extractReport(o.parsed.result).report;
    assert.ok(rep && rep.status === 'blocked', 'a failing check is never synthesized into a pass');
    assert.strictEqual(o.validation.passed, false);
  }).then(function () {
    // And with NO change at all (nothing done), no synthesis either.
    var ws3 = newWorkspace('nothing-no-report'); seedBrokenProject(ws3);
    return runTask(ws3, [say('Ronaldo'), say('Ronaldo'), say('Ronaldo')], { required_tests: ['node -e "process.exit(0)"'] });
  }).then(function (o) {
    var rep = require(path.join(EXEC, 'lib', 'report.js')).extractReport(o.parsed.result).report;
    assert.ok(rep && rep.status === 'blocked', 'a passing check over an untouched workspace is not work');
  });
});

t('B10 mechanical delivery: the executor commits exactly the validated files, only for a validated pass, never for anything else', function () {
  var cp = require('child_process');
  var executor = require(path.join(EXEC, 'executor.js'));
  var ws = newWorkspace('delivery');
  function sh(args) { return cp.execFileSync('git', args, { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  sh(['init', '-q']); sh(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base']);
  seedBrokenProject(ws);
  sh(['add', '-A']); sh(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed']);
  fs.writeFileSync(path.join(ws, 'add.js'), FIXED);
  fs.writeFileSync(path.join(ws, 'stray.txt'), 'not validated\n');          // present, but NOT in the measured change set
  var task = { task_id: 't-deliver', working_directory: ws, expected_delivery: 'commit' };
  var report = { mythos_report: true, status: 'completed', summary: 'add fixed', files_changed: ['add.js'] };
  var outcome = { validation: { passed: true, evidence: { changed: { created: [], modified: ['add.js'], deleted: [] }, checks_run: [{ check: 'node add.test.js', passed: true }], scope_enforced: true } } };
  // The state module writes events under the executor home; point it at a scratch home.
  var prevHome = process.env.MYTHOS_EXECUTOR_HOME; process.env.MYTHOS_EXECUTOR_HOME = path.join(ROOT, 'exec-home');
  var d;
  try { d = executor.deliverValidatedWork(task, report, outcome); } finally { if (prevHome === undefined) delete process.env.MYTHOS_EXECUTOR_HOME; else process.env.MYTHOS_EXECUTOR_HOME = prevHome; }
  assert.ok(d && d.commit && !d.problem, JSON.stringify(d));
  assert.strictEqual(d.note, null, 'a scope WAS enforced here, so there is nothing to warn the reviewer about');
  assert.strictEqual(sh(['rev-parse', 'HEAD']), d.commit);
  assert.strictEqual(sh(['show', '--name-only', '--format=', 'HEAD']), 'add.js', 'exactly the validated file is in the commit');
  assert.ok(/^\?\? stray\.txt$/m.test(sh(['status', '--porcelain'])), 'the unvalidated file was left alone');
  assert.ok(/mythos-haddad-worker/.test(sh(['log', '-1', '--format=%an'])));
  // Not delivered: validation absent (every other provider), failed, report not completed, or a commit already claimed.
  assert.strictEqual(executor.deliverValidatedWork(task, report, {}), null);
  assert.strictEqual(executor.deliverValidatedWork(task, report, { validation: { passed: false, evidence: outcome.validation.evidence } }), null);
  assert.strictEqual(executor.deliverValidatedWork(task, Object.assign({}, report, { status: 'blocked' }), outcome), null);
  assert.strictEqual(executor.deliverValidatedWork(task, Object.assign({}, report, { commit: 'abc' }), outcome), null);
  assert.strictEqual(executor.deliverValidatedWork(Object.assign({}, task, { expected_delivery: 'report' }), report, outcome), null);
});

// B10 delivers; this pins what happens when it CANNOT. A delivery that
// fails used to land its problem in report_problems and let the task finish
// COMPLETED: the Bridge closed the Issue as done and released anything that
// depended on it, for a change that existed only in a worktree.
t('B10b validated work that git refused is BLOCKED, not COMPLETED — and it is not blamed on the worker', function () {
  var executor = require(path.join(EXEC, 'executor.js'));
  var engine = require(path.join(EXEC, 'bridge/action-resolution.js'));
  var done = { mythos_report: true, status: 'completed', summary: 'fixed', next_stage: 'review' };

  // The normal path is untouched.
  assert.deepStrictEqual(executor.settleState(done, null, null), { state: 'COMPLETED', next_action: 'review' });
  // A delivery problem downgrades it, and says which one.
  var blockedByDelivery = executor.settleState(done, null, 'delivery: commit failed: index.lock exists');
  assert.strictEqual(blockedByDelivery.state, 'BLOCKED');
  assert.ok(/validated work was not delivered — delivery: commit failed/.test(blockedByDelivery.next_action), blockedByDelivery.next_action);
  // It never upgrades a worse verdict: the worker's own admission wins.
  assert.strictEqual(executor.settleState({ status: 'failed' }, null, 'delivery: commit failed').state, 'FAILED');
  assert.strictEqual(executor.settleState({ status: 'blocked', summary: 'need a key' }, null, 'delivery: commit failed').state, 'BLOCKED');
  assert.ok(/owner decision required: need a key/.test(executor.settleState({ status: 'blocked', summary: 'need a key' }, null, 'x').next_action));
  // And an unreadable report still outranks everything, with its diagnosis.
  var noReport = executor.settleState(null, 'no fenced json block', 'delivery: commit failed');
  assert.strictEqual(noReport.state, 'BLOCKED');
  assert.ok(/no fenced json block/.test(noReport.next_action), noReport.next_action);

  // The blocker code names the delivery, not the provider — a rerun must
  // not be sent looking for a fault in work that was validated — and it is
  // retryable, because a lock or a permission is exactly what a rerun fixes.
  assert.strictEqual(engine.BLOCKER_CODES.DELIVERY_FAILED, 'DELIVERY_FAILED');
  assert.strictEqual(engine.isRetryable('DELIVERY_FAILED'), true);
  assert.notStrictEqual(engine.BLOCKER_CODES.DELIVERY_FAILED, engine.BLOCKER_CODES.PROVIDER_FAILED);

  // And a delivery made with no scope to check against still delivers —
  // but hands the reviewer the one fact they cannot recover from the
  // checks: nothing compared these files to an intended set.
  var cp = require('child_process');
  var ws = newWorkspace('delivery-no-scope');
  function sh(args) { return cp.execFileSync('git', args, { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  sh(['init', '-q']); sh(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base']);
  seedBrokenProject(ws);
  sh(['add', '-A']); sh(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed']);
  fs.writeFileSync(path.join(ws, 'add.js'), FIXED);
  var unscoped = { validation: { passed: true, evidence: { changed: { created: [], modified: ['add.js'], deleted: [] }, checks_run: [], scope_enforced: false } } };
  var prev = process.env.MYTHOS_EXECUTOR_HOME; process.env.MYTHOS_EXECUTOR_HOME = path.join(ROOT, 'exec-home');
  var d2;
  try {
    d2 = executor.deliverValidatedWork({ task_id: 't-deliver-2', working_directory: ws, expected_delivery: 'commit' }, done, unscoped);
  } finally { if (prev === undefined) delete process.env.MYTHOS_EXECUTOR_HOME; else process.env.MYTHOS_EXECUTOR_HOME = prev; }
  assert.ok(d2 && d2.commit, 'an undeclared scope does not block delivery: ' + JSON.stringify(d2));
  assert.ok(/declared no path scope/.test(d2.note || ''), d2.note);
  assert.ok(/review the diff itself/.test(d2.note || ''), d2.note);
});

t('B2 the repair brief hands the worker MEASURED evidence, not a scolding', function () {
  var ws = newWorkspace('repair-brief');
  seedBrokenProject(ws);
  return runTask(ws, [
    say(report('completed', 'Done.')),
    callTool('c1', 'write_file', { path: 'add.js', content: FIXED }),
    say(report('completed', 'fixed', ['add.js']))
  ]).then(function (o) {
    // The second request the transport was sent must carry the brief.
    var second = o._sent[1];
    var brief = second.messages[second.messages.length - 1].content;
    assert.ok(/## REPAIR REQUIRED \(attempt 1\)/.test(brief), 'the existing repair format is reused');
    assert.ok(/REJECTED by independent validation/.test(brief), brief.slice(0, 200));
    assert.ok(/add\(2,2\) returned 0, expected 4/.test(brief), 'the real failure output is in the brief');
    assert.ok(/### What you actually changed/.test(brief), 'and what it really changed');
    assert.ok(/Do not edit, weaken or delete a check/.test(brief), 'and the rule against cheating');
    // The round that was rejected made NO tool call (it only said "Done."):
    // the brief must say so and spell out that prose is not a change —
    // the failure mode measured live on gh-issue-373, where the model
    // pasted the fix as a code block and claimed both checks passed.
    assert.ok(/made NO tool call: nothing was written and nothing ran/.test(brief), 'a no-tool-call round is named');
    assert.ok(/### What to do now — as TOOL CALLS, in this order/.test(brief), 'and the next steps are tool calls');
    assert.ok(/write_file that path with the COMPLETE corrected file/.test(brief));
    assert.ok(/run_command each failing check: `node add\.test\.js`/.test(brief), 'naming the failing check to run: ' + brief.slice(-500));
    // And the repair request is COMPACT: system, task, the rejected answer,
    // the brief — the previous round's tool traffic is not replayed, so the
    // context does not grow execution over execution.
    assert.strictEqual(second.messages.length, 4, 'compact repair conversation: ' + second.messages.map(function (m) { return m.role; }).join(','));
    assert.strictEqual(second.messages[0].role, 'system'); assert.strictEqual(second.messages[1].role, 'user');
    assert.strictEqual(second.messages[2].role, 'assistant'); assert.strictEqual(second.messages[3].role, 'user');
  });
});

t('B3 the loop is BOUNDED: three executions, then it stops for a person', function () {
  var ws = newWorkspace('bounded');
  seedBrokenProject(ws);
  var attempts = 0;
  var transport = function (opts, body) {
    var msgs = JSON.parse(body).messages;
    if (msgs[msgs.length - 1].role === 'user') attempts++;
    return Promise.resolve({ status: 200,
      body: JSON.stringify({ choices: [{ message: say(report('completed', 'Done.')) }] }) });
  };
  return agent.run({ task_id: 't-b3', working_directory: ws, execution_profile: 'repo-write',
    timeout_seconds: 600, required_tests: ['node add.test.js'] },
    'fix it', null, 'start', { apiKey: 'k', model: 'm', transport: transport }
  ).then(function (o) {
    assert.strictEqual(o.repair_rounds, 2, 'two repair rounds — the declared bound');
    assert.strictEqual(o.validations.length, 3, 'three executions in total, then it stopped');
    assert.strictEqual(attempts, 3, 'the model was asked exactly three times');
    // It stops FOR A PERSON rather than crashing: the executor's existing
    // "ended cleanly with a blocked report" seam turns this into a human
    // decision (HUMAN_APPROVAL) instead of a bare FAILED.
    assert.strictEqual(o.parsed.is_error, false, 'a spent budget is not an error');
    var rep = require(path.join(EXEC, 'lib', 'report.js')).extractReport(o.stdout).report;
    assert.ok(rep, 'a structured report is emitted');
    assert.strictEqual(rep.status, 'blocked', 'and its status asks for a person');
    assert.ok(/repair budget is spent/.test(rep.summary), rep.summary);
    assert.ok(rep.residual_risks.length, 'carrying the measured rejections');
    assert.strictEqual(o.validation.passed, false);
    // The executor reads the report from parsed.result (handleSuccess →
    // extractReport), NOT from stdout. gh-issue-372 landed as
    // NO_STRUCTURED_REPORT because only stdout carried it.
    var viaExecutorSeam = require(path.join(EXEC, 'lib', 'report.js')).extractReport(o.parsed.result);
    assert.ok(viaExecutorSeam.report && viaExecutorSeam.report.status === 'blocked',
      'the executor seam (parsed.result) carries the same blocked report: ' + (viaExecutorSeam.error || 'ok'));
    // And a person can see what the attempt DID, not just that it stopped.
    assert.ok(/## Tool trace \(\d+ calls, 3 execution\(s\)\)/.test(o.parsed.result), 'the tool trace travels with the record');
  });
});

// ===========================================================================
// C. Anti-cheating — the ways a worker "passes" without doing the work
// ===========================================================================

// C1 and C5 drive their out-of-scope write through a SCRIPT, not through
// write_file. That is deliberate and it is the whole point: write_file now
// answers the declared scope itself (immediate feedback), but a tool rule is
// not a boundary when the tool surface includes "run code" — the V1 `.git`
// escape taught that. What these two prove is that the VALIDATOR, which
// measures the workspace out of band, catches the write that never passed
// through a tool at all. Each task declares the helper as in scope, so the
// helper itself is written legitimately and only what it DOES is out of scope.

t('C1 editing the check itself is caught — by the validator, through a script the tool layer never sees', function () {
  var ws = newWorkspace('edits-check');
  seedBrokenProject(ws);
  var tamper = 'var fs = require("fs");\n' +
    'fs.writeFileSync("add.test.js", "console.log(\'add ok\');\\n");\n';
  return runTask(ws, [
    callTool('c1', 'write_file', { path: 'tamper.js', content: tamper }),
    callTool('c2', 'run_command', { program: 'node', args: ['tamper.js'] }),
    say(report('completed', 'Tests pass now.', ['add.test.js']))
  ], { constraints: ['Only change add.js, tamper.js'] }).then(function (o) {
    var wrote = o.tool_trace.filter(function (e) { return e.tool === 'write_file'; })[0];
    assert.strictEqual(wrote.refused, false, 'the helper itself was in scope and was written');
    assert.strictEqual(o.validation.passed, false, 'a rewritten check is not a pass');
    assert.ok(/integrity: add\.test\.js .*MODIFIED/.test(rejections(o)),
      'and it is named as an integrity failure: ' + rejections(o));
  });
});

t('C1b write_file answers the declared scope immediately — and that is feedback, not the boundary', function () {
  var ws = newWorkspace('scope-feedback');
  seedBrokenProject(ws);
  return runTask(ws, [
    callTool('c1', 'write_file', { path: 'add.test.js', content: 'console.log("add ok");\n' }),
    callTool('c2', 'write_file', { path: 'add.js', content: FIXED }),
    say(report('completed', 'Fixed add.', ['add.js']))
  ], { constraints: ['Only change add.js'] }).then(function (o) {
    var writes = o.tool_trace.filter(function (e) { return e.tool === 'write_file'; });
    assert.strictEqual(writes[0].refused, true, 'the out-of-scope write was refused at the tool');
    assert.ok(/outside the scope this task declared/.test(writes[0].detail), writes[0].detail);
    assert.ok(/add\.js/.test(writes[0].detail), 'the refusal names the scope the task declared: ' + writes[0].detail);
    assert.strictEqual(writes[1].refused, false, 'the in-scope write went through');
    assert.strictEqual(o.validation.passed, true, 'and the attempt then passes on its merits');
    var content = fs.readFileSync(path.join(ws, 'add.test.js'), 'utf8');
    assert.ok(/add\(2, 5\)/.test(content), 'the check file was never touched');
  });
});

t('C1c a task that declares no FILE scope is refused nothing it was not refused before', function () {
  var ws = newWorkspace('no-scope');
  seedBrokenProject(ws);
  return runTask(ws, [
    callTool('c1', 'write_file', { path: 'anything.js', content: 'module.exports = 1;\n' }),
    callTool('c2', 'write_file', { path: 'add.js', content: FIXED }),
    say(report('completed', 'Fixed add.', ['add.js', 'anything.js']))
  ], { constraints: ['Read-only where possible. Be careful.'] }).then(function (o) {
    var writes = o.tool_trace.filter(function (e) { return e.tool === 'write_file'; });
    assert.strictEqual(writes[0].refused, false, 'a prose-only constraint declares no scope, so nothing is refused');
    assert.strictEqual(o.validation.evidence.scope_enforced, false, 'and the validator agrees there was no scope');
  });
});

t('C2 deleting the check is caught', function () {
  var ws = newWorkspace('deletes-check');
  seedBrokenProject(ws);
  var o1 = agent.TOOL_IMPL; // deletion is not a tool; simulate the worker's effect
  return runTask(ws, [say(report('completed', 'Removed the failing test.'))], null).then(function () {
    // The worker has no delete tool at all — so the only way a check can
    // vanish is outside the runner. Assert BOTH: no tool exists, and if a
    // file does vanish the validator still calls it out.
    assert.strictEqual(o1.delete_file, undefined, 'there is no delete tool to begin with');
    fs.unlinkSync(path.join(ws, 'add.test.js'));
    var before = { files: { 'add.js': 'x', 'add.test.js': 'y' } };
    var after = { files: { 'add.js': 'x' } };
    var v = work.validateWork({
      report: { status: 'completed', summary: 'done' }, workspace: ws,
      before: before, after: after, checks: ['node add.test.js'],
      runCommand: function () { return { error: 'no such file' }; }
    });
    assert.strictEqual(v.pass, false);
    assert.ok(v.rejections.join(' ').indexOf('DELETED') !== -1, v.rejections.join(' | '));
  });
});

t('C3 a stub that satisfies the letter but not the behaviour still fails', function () {
  // The real gh-issue-364 failure: the worker invented a second file that
  // hardcoded the answer. The check runs the REAL behaviour, so it fails.
  var ws = newWorkspace('stub');
  seedBrokenProject(ws);
  return runTask(ws, [
    callTool('c1', 'write_file', { path: 'add.js', content: 'module.exports = function add() { return 4; };\n' }),
    say(report('completed', 'add returns 4 as required.', ['add.js']))
  ], { required_tests: ['node add.test.js', 'node other.test.js'] }).then(function (o) {
    // add(2,2)===4 passes the first check; the second check does not exist,
    // so the work is not accepted on the strength of the one it satisfied.
    assert.strictEqual(o.validation.passed, false, 'a partially-satisfying stub is not a pass');
    assert.ok(/other\.test\.js` did not pass/.test(rejections(o)), rejections(o));
  });
});

t('C4 claiming changed files while changing nothing is caught', function () {
  var ws = newWorkspace('claims-changes');
  seedBrokenProject(ws);
  fs.writeFileSync(path.join(ws, 'add.js'), FIXED);   // checks will pass
  return runTask(ws, [say(report('completed', 'Rewrote three modules.',
    ['a.js', 'b.js', 'c.js']))]).then(function (o) {
    assert.strictEqual(o.validation.passed, false, 'the claim contradicted the workspace');
    assert.ok(/byte-identical to before the attempt/.test(rejections(o)), rejections(o));
  });
});

t('C5 work outside the declared scope is caught — by the validator, when a script put it there', function () {
  var ws = newWorkspace('out-of-scope');
  seedBrokenProject(ws);
  var helper = 'var fs = require("fs");\nfs.writeFileSync("unrelated.js", "module.exports = 1;\\n");\n';
  return runTask(ws, [
    callTool('c1', 'write_file', { path: 'add.js', content: FIXED }),
    callTool('c2', 'write_file', { path: 'helper.js', content: helper }),
    callTool('c3', 'run_command', { program: 'node', args: ['helper.js'] }),
    say(report('completed', 'Fixed add.', ['add.js', 'unrelated.js']))
  ], { constraints: ['Only change add.js, helper.js'], required_tests: ['node add.test.js'] }).then(function (o) {
    assert.ok(o.tool_trace.filter(function (e) { return e.tool === 'write_file'; }).every(function (e) { return !e.refused; }),
      'both declared files were written through the tool without complaint');
    assert.strictEqual(o.validation.passed, false, 'the file the SCRIPT created was not allowed');
    assert.ok(/scope: unrelated\.js was changed/.test(rejections(o)), rejections(o));
    assert.strictEqual(o.validation.evidence.scope_enforced, true, 'a path scope existed and was applied');
  });
});

// The other half of C5, and the one that is easy to mistake for it: a task
// whose constraints are PROSE yields no path, so there is no scope rule to
// break and the same work passes. That is correct — the validator cannot
// invent a restriction the task never stated, and the sandbox still keeps
// every write inside the workspace — but "stayed in scope" and "there was
// no scope" must not read the same afterwards. The verdict records which
// one happened, and the executor puts it in front of the reviewer.
t('C5b prose constraints declare no scope — the work passes and says so, it does not silently claim a scope check', function () {
  var ws = newWorkspace('prose-scope');
  seedBrokenProject(ws);
  return runTask(ws, [
    callTool('c1', 'write_file', { path: 'add.js', content: FIXED }),
    callTool('c2', 'write_file', { path: 'unrelated.js', content: 'module.exports = 1;\n' }),
    say(report('completed', 'Fixed add.', ['add.js', 'unrelated.js']))
  ], { constraints: ['Do not weaken the check', 'Keep the change small'], required_tests: ['node add.test.js'] }).then(function (o) {
    assert.strictEqual(o.validation.passed, true, 'prose constraints are not a scope rule: ' + JSON.stringify(o.validation.rejections));
    assert.deepStrictEqual(o.validation.evidence.scope_declared, [], 'no path could be read from prose');
    assert.strictEqual(o.validation.evidence.scope_enforced, false, 'and the verdict says no scope was enforced');
    assert.strictEqual(reporting.extractReport(o.stdout).report.status, 'completed',
      'the worker is not failed for a restriction the task never declared');
  });
});

t('C6 an unreadable report is a rejection with a named reason', function () {
  var ws = newWorkspace('no-report');
  seedBrokenProject(ws);
  fs.writeFileSync(path.join(ws, 'add.js'), FIXED);
  return runTask(ws, [say('I think I am finished but here is no structured block.')]).then(function (o) {
    assert.strictEqual(o.validation.passed, false, 'passing checks do not excuse an unreadable report');
    assert.ok(/report: no fenced/.test(rejections(o)), rejections(o));
  });
});

// ===========================================================================
// D. What the validator must NOT do
// ===========================================================================

t('D1 prose criteria are recorded as unverified, never as verified', function () {
  var ws = newWorkspace('prose-only');
  seedBrokenProject(ws);
  return runTask(ws, [say(report('completed', 'I reviewed it.'))],
    { required_tests: ['The explanation is clear and correct.'] }).then(function (o) {
      assert.strictEqual(o.parsed.is_error, false, 'a prose criterion does not fail the task');
      assert.strictEqual(o.validation.evidence.mechanically_verified, false,
        'but the pass is explicitly NOT mechanical');
      assert.deepStrictEqual(o.validation.evidence.checks_advisory,
        ['The explanation is clear and correct.'], 'and the criterion is carried as advisory');
    });
});

t('D2 checks run inside the sandbox, with the worker\'s own confinement', function () {
  var ws = newWorkspace('checks-confined');
  fs.writeFileSync(path.join(ws, 'escape.test.js'),
    'try { require("fs").readFileSync("/etc/passwd"); console.log("READ"); process.exit(0); }' +
    ' catch (e) { console.error("blocked:" + e.code); process.exit(1); }\n');
  return runTask(ws, [say(report('completed', 'done'))],
    { required_tests: ['node escape.test.js'] }).then(function (o) {
      var check = o.validations[0].evidence.checks_run[0];
      assert.strictEqual(check.passed, false, 'the check could not read outside the workspace');
      assert.ok(/blocked:ENOENT/.test(check.output), check.output);
    });
});

t('D3 a workspace that did not change is not automatically a failure', function () {
  var ws = newWorkspace('already-correct');
  seedBrokenProject(ws);
  fs.writeFileSync(path.join(ws, 'add.js'), FIXED);
  return runTask(ws, [say(report('completed', 'It was already correct; nothing to change.', []))])
    .then(function (o) {
      assert.strictEqual(o.parsed.is_error, false, 'work that was already right passes: ' + o.stderr);
      assert.strictEqual(o.validation.evidence.changed.created.length, 0);
    });
});

t('C7 a report survives a rejection that quotes a code fence', function () {
  // The "no fenced ```json block" diagnosis contains a fence. Embedded
  // verbatim it closes the report's own fence early and corrupts it — which
  // is how this was found: C6 produced a perfectly correct blocked report
  // that could not be parsed back.
  var ws = newWorkspace('fence-in-rejection');
  seedBrokenProject(ws);
  fs.writeFileSync(path.join(ws, 'add.js'), FIXED);
  return runTask(ws, [say('no structured block here.')]).then(function (o) {
    var r = blockedReport(o);
    assert.ok(/no fenced/.test(r.residual_risks.join(' ')), 'the diagnosis survived');
    assert.ok(!/```/.test(JSON.stringify(r)), 'with no fence left inside the report to break it');
  });
});

// ---------------------------------------------------------------- D. context
// V2.1 (measured live, gh researcher run t-20260922204100-lttyji): tool
// results accumulated past the runtime's 8,192-token window and the whole
// attempt failed with HTTP 400. The runner now accounts for the window.

t('D1 context budget: derived from the window, leaves room for the answer, bounds a single tool result', function () {
  assert.strictEqual(agent.CONTEXT_WINDOW_TOKENS, 8192, 'default window is the runtime unit\'s --ctx-size');
  assert.ok(agent.PROMPT_BUDGET_TOKENS <= agent.CONTEXT_WINDOW_TOKENS - agent.MAX_TOKENS_PER_TURN, 'the answer always has its ' + agent.MAX_TOKENS_PER_TURN + ' tokens');
  assert.ok(agent.MAX_TOOL_PAYLOAD_CHARS < agent.MAX_TOOL_OUTPUT_BYTES, 'per-call payload cap is tighter than the byte ceiling');
  assert.ok(agent.MAX_TOOL_PAYLOAD_CHARS * 3 <= agent.PROMPT_BUDGET_TOKENS * 3 + 8, 'one result is at most a third of the budget');
});

t('D2 context budget: a long file is handed over TRUNCATED and says so; the conversation stays under budget', function () {
  var ws = newWorkspace('ctx-truncate');
  seedBrokenProject(ws);
  fs.writeFileSync(path.join(ws, 'big.txt'), new Array(4000).join('0123456789\n'));  // ~44 KB, under MAX_READ_BYTES
  var replies = [callTool('c1', 'read_file', { path: 'big.txt' }), say('done\n' + report('completed', 'read it'))];
  return runTask(ws, replies).then(function (o) {
    var second = o._sent[1];
    var toolMsg = second.messages.filter(function (m) { return m.role === 'tool'; })[0];
    var parsed = JSON.parse(toolMsg.content);
    assert.strictEqual(parsed.truncated, true, 'marked truncated');
    assert.ok(parsed.total_bytes > parsed.content.length, 'total size reported');
    assert.ok(toolMsg.content.length <= agent.MAX_TOOL_PAYLOAD_CHARS, 'payload within the per-call cap');
    var chars = second.messages.reduce(function (n, m) { return n + (typeof m.content === 'string' ? m.content.length : 0); }, 0);
    assert.ok(chars / 3 < agent.PROMPT_BUDGET_TOKENS, 'estimated prompt under budget');
  });
});

t('D3 context budget: accumulated EXCHANGES are elided OLDEST-FIRST, never the system prompt, the task or the newest exchange, and the trace records it', function () {
  var ws = newWorkspace('ctx-compact');
  seedBrokenProject(ws);
  for (var i = 0; i < 6; i++) fs.writeFileSync(path.join(ws, 'f' + i + '.txt'), new Array(600).join('line ' + i + ' 0123456789\n')); // ~10 KB each
  var replies = [];
  for (var j = 0; j < 6; j++) replies.push(callTool('c' + j, 'read_file', { path: 'f' + j + '.txt' }));
  replies.push(say('done\n' + report('completed', 'read them')));
  return runTask(ws, replies).then(function (o) {
    // The 7th request is the one carrying all six results (the answer that
    // follows fails validation and starts a compact repair round, as usual).
    var last = o._sent[6];
    var tools = last.messages.filter(function (m) { return m.role === 'tool'; });
    assert.strictEqual(tools.length, 6, 'every tool message still present (ids intact for the API)');
    var elided = tools.filter(function (m) { return m.content === agent.ELIDED_TOOL_STUB; });
    assert.ok(elided.length >= 1, 'at least one earlier result elided (' + elided.length + ')');
    assert.strictEqual(tools[tools.length - 1].content === agent.ELIDED_TOOL_STUB, false, 'the most recent result is kept');
    assert.strictEqual(tools[0].content, agent.ELIDED_TOOL_STUB, 'the oldest went first');
    // The ASSISTANT half of an elided exchange goes with it — a write_file
    // call's arguments carry a whole file, which is what actually fills the
    // window — while its tool_call ids survive so the message stays valid.
    var assistants = last.messages.filter(function (m) { return m.role === 'assistant' && m.tool_calls; });
    assert.strictEqual(assistants.length, 6, 'every assistant turn still present');
    assert.strictEqual(assistants[0].tool_calls[0].function.arguments, agent.ELIDED_ARGS, 'the oldest exchange\'s arguments went too');
    assert.ok(assistants[0].tool_calls[0].id, 'its tool_call id survives, so the tool message that answers it stays valid');
    assert.strictEqual(assistants[0].tool_calls[0].function.name, 'read_file', 'the call NAME survives, so the model still sees what it did');
    assert.notStrictEqual(assistants[assistants.length - 1].tool_calls[0].function.arguments, agent.ELIDED_ARGS, 'the newest exchange is intact');
    // Elision is paired: an elided assistant turn's results are elided too.
    last.messages.forEach(function (m, i) {
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls[0].function.arguments === agent.ELIDED_ARGS) {
        for (var j = i + 1; j < last.messages.length && last.messages[j].role === 'tool'; j++) {
          assert.strictEqual(last.messages[j].content, agent.ELIDED_TOOL_STUB, 'result of an elided call is elided too');
        }
      }
    });
    assert.strictEqual(last.messages[0].role, 'system');
    assert.ok(/Fix add/.test(last.messages[1].content), 'the task is untouched');
    var chars = last.messages.reduce(function (n, m) { return n + (typeof m.content === 'string' ? m.content.length : 0); }, 0);
    assert.ok(chars / 3 <= agent.PROMPT_BUDGET_TOKENS, 'the final request is under budget (~' + Math.round(chars / 3) + ')');
    assert.ok(o.tool_trace.some(function (e) { return e.tool === 'context_compaction'; }), 'compaction is in the trace');
    // The task still settles normally: a compacted conversation is not a failure.
    assert.strictEqual(o.exit_code, 0);
  });
});

t('D4 context budget: the runtime\'s own usage.prompt_tokens re-anchors the estimate', function () {
  var ws = newWorkspace('ctx-anchor');
  seedBrokenProject(ws);
  fs.writeFileSync(path.join(ws, 'mid.txt'), new Array(300).join('0123456789\n')); // ~3.3 KB: far under the per-call cap
  var sent = [];
  var n = 0;
  // Two small reads, then done. By the CHAR estimate nothing ever needs
  // compacting; the runtime's own accounting says otherwise before the third
  // request, and the runner must believe the measurement.
  var usageByTurn = [600, agent.PROMPT_BUDGET_TOKENS - 800, 600];
  var transport = function (opts, body) {
    sent.push(JSON.parse(body));
    var turn = n++;
    var reply = turn < 2 ? callTool('c' + turn, 'read_file', { path: 'mid.txt' }) : say('done\n' + report('completed', 'x'));
    return Promise.resolve({ status: 200, body: JSON.stringify({ choices: [{ message: reply }], usage: { prompt_tokens: usageByTurn[Math.min(turn, usageByTurn.length - 1)] } }) });
  };
  var task = { task_id: 't-anchor', working_directory: ws, execution_profile: 'repo-write', timeout_seconds: 600, required_tests: ['node add.test.js'], constraints: ['Only change add.js'] };
  return agent.run(task, 'Fix add so its test passes.', null, 'start', { apiKey: 'k', model: 'm', transport: transport }).then(function (o) {
    // After the first answer the anchor says the prompt is already over
    // budget; the one tool result gets elided before the second request.
    assert.ok(sent.length >= 3, 'three requests were made (' + sent.length + ')');
    var third = sent[2];
    var toolMsg = third.messages.filter(function (m) { return m.role === 'tool'; })[0];
    assert.strictEqual(toolMsg.content, agent.ELIDED_TOOL_STUB, 'elided on the runtime\'s measurement, not the estimate');
    var chars = third.messages.reduce(function (n2, m) { return n2 + (typeof m.content === 'string' ? m.content.length : 0); }, 0);
    assert.ok(chars / 3 < agent.PROMPT_BUDGET_TOKENS, 'the char estimate alone would never have compacted this (' + Math.round(chars / 3) + ' tokens)');
    assert.ok(o.tool_trace.some(function (e) { return e.tool === 'context_compaction'; }));
    assert.ok(/exchange/.test(o.tool_trace.filter(function (e) { return e.tool === 'context_compaction'; })[0].detail), 'the trace says what unit was dropped');
  });
});

t('D5 context budget: a task prompt that cannot fit even alone stops with a named code, never an HTTP 400 from the runtime', function () {
  var ws = newWorkspace('ctx-huge');
  seedBrokenProject(ws);
  var calls = 0;
  var transport = function () { calls++; return Promise.resolve({ status: 200, body: JSON.stringify({ choices: [{ message: say('x') }] }) }); };
  var task = { task_id: 't-huge', working_directory: ws, execution_profile: 'repo-write', timeout_seconds: 600, required_tests: [], constraints: [] };
  var huge = new Array(agent.PROMPT_BUDGET_TOKENS * 4).join('word ');
  return agent.run(task, huge, null, 'start', { apiKey: 'k', model: 'm', transport: transport }).then(function (o) {
    assert.strictEqual(calls, 0, 'the runtime was never asked');
    assert.strictEqual(o.parsed.subtype, 'HADDAD_AGENT_CONTEXT_EXHAUSTED');
    assert.strictEqual(o.exit_code, 1);
    // An authoring problem and a run that grew need different answers, so
    // the message says which one this is.
    assert.ok(/task prompt alone/.test(o.stderr), 'named as an over-large task prompt: ' + o.stderr);
    assert.ok(new RegExp(String(agent.PROMPT_BUDGET_TOKENS)).test(o.stderr) && /8192/.test(o.stderr), 'budget and window both stated');
  });
});

t('D6 context budget: a run whose ARGUMENTS keep growing is sustained by compaction — every request stays under budget, and it never dies of HTTP 400', function () {
  var ws = newWorkspace('ctx-grown');
  seedBrokenProject(ws);
  var n = 0;
  var sent = [];
  // Each turn writes a file whose CONTENT is ~30 % of the budget. The
  // arguments — not the results — are what accumulates, and eliding results
  // alone never touched them (measured live, gh-tester t-20260922205205:
  // twelve assistant turns, every result already elided, still ~6,700
  // tokens). This drives more turns than the window could ever hold.
  var big = new Array(Math.floor(agent.PROMPT_BUDGET_TOKENS * 3 * 0.3)).join('x');
  var transport = function (opts, body) {
    sent.push(JSON.parse(body));
    n++;
    return Promise.resolve({ status: 200, body: JSON.stringify({ choices: [{ message: callTool('c' + n, 'write_file', { path: 'grow' + n + '.txt', content: big }) }] }) });
  };
  var task = { task_id: 't-grown', working_directory: ws, execution_profile: 'repo-write', timeout_seconds: 600, required_tests: [], constraints: [] };
  return agent.run(task, 'Fix add so its test passes.', null, 'start', { apiKey: 'k', model: 'm', transport: transport }).then(function (o) {
    assert.ok(sent.length > 12, 'the run went well past a window\'s worth of turns (' + sent.length + ' requests)');
    assert.notStrictEqual(o.parsed.subtype, 'HADDAD_AGENT_CONTEXT_EXHAUSTED', 'compaction kept it alive');
    var over = sent.filter(function (req) {
      return req.messages.reduce(function (c, m) {
        return c + (typeof m.content === 'string' ? m.content.length : 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
      }, 0) / 3 > agent.PROMPT_BUDGET_TOKENS;
    });
    assert.strictEqual(over.length, 0, over.length + ' of ' + sent.length + ' requests exceeded the prompt budget');
    assert.ok(o.tool_trace.filter(function (e) { return e.tool === 'context_compaction'; }).length > 5, 'compaction ran repeatedly and is in the trace');
  });
});

t('D7 context budget: when only the newest exchange is left and it still does not fit, the message blames the conversation, not the task prompt', function () {
  var ws = newWorkspace('ctx-wall');
  seedBrokenProject(ws);
  fs.writeFileSync(path.join(ws, 'big.txt'), new Array(4000).join('0123456789\n'));
  // The runtime reports the prompt as nearly full; the one capped result
  // that follows cannot fit beside it, and the newest exchange is never
  // dropped (dropping what the model just asked for makes it ask forever).
  var n = 0;
  var transport = function () {
    var reply = n++ === 0 ? callTool('c1', 'read_file', { path: 'big.txt' }) : say('done');
    return Promise.resolve({ status: 200, body: JSON.stringify({ choices: [{ message: reply }], usage: { prompt_tokens: agent.PROMPT_BUDGET_TOKENS - 100 } }) });
  };
  var task = { task_id: 't-wall', working_directory: ws, execution_profile: 'repo-write', timeout_seconds: 600, required_tests: [], constraints: [] };
  return agent.run(task, 'Fix add so its test passes.', null, 'start', { apiKey: 'k', model: 'm', transport: transport }).then(function (o) {
    assert.strictEqual(o.parsed.subtype, 'HADDAD_AGENT_CONTEXT_EXHAUSTED');
    assert.ok(/after compacting every earlier exchange/.test(o.stderr), 'blames the conversation: ' + o.stderr);
    assert.ok(!/task prompt alone/.test(o.stderr), 'does not blame the task prompt');
  });
});

t('D8 an identical repeated call is answered with the same result plus a note, never a different result', function () {
  var ws = newWorkspace('repeat');
  seedBrokenProject(ws);
  var replies = [
    callTool('r1', 'read_file', { path: 'add.js' }),
    callTool('r2', 'read_file', { path: 'add.js' }),
    say('done\n' + report('completed', 'x'))
  ];
  return runTask(ws, replies).then(function (o) {
    var toolMsgs = o._sent[2].messages.filter(function (m) { return m.role === 'tool'; });
    assert.strictEqual(toolMsgs.length, 2);
    var first = JSON.parse(toolMsgs[0].content);
    var second = JSON.parse(toolMsgs[1].content);
    assert.strictEqual(second.content, first.content, 'the RESULT is unchanged — the note adds nothing and hides nothing');
    assert.ok(!first.note, 'the first call carries no note');
    assert.ok(/do not repeat it/.test(second.note || ''), 'the repeat is named: ' + second.note);
  });
});

t('D9 a repeated call whose result CHANGED is not called a repeat', function () {
  var ws = newWorkspace('repeat-changed');
  seedBrokenProject(ws);
  var replies = [
    callTool('r1', 'read_file', { path: 'add.js' }),
    callTool('r2', 'write_file', { path: 'add.js', content: FIXED }),
    callTool('r3', 'read_file', { path: 'add.js' }),
    say('done\n' + report('completed', 'x', ['add.js']))
  ];
  return runTask(ws, replies).then(function (o) {
    var toolMsgs = o._sent[3].messages.filter(function (m) { return m.role === 'tool'; });
    var reads = [JSON.parse(toolMsgs[0].content), JSON.parse(toolMsgs[2].content)];
    assert.notStrictEqual(reads[1].content, reads[0].content, 'the file really did change between the two reads');
    assert.ok(!reads[1].note, 'the second read is not flagged as a repeat');
  });
});

t('D10 compaction reaches a FIXED floor: a long run of small exchanges does not accumulate stubs until the window is gone', function () {
  var ws = newWorkspace('ctx-floor');
  seedBrokenProject(ws);
  // Many small tool calls. Eliding each one leaves a stub, and a stub is not
  // free — measured live (tester t-20260922230756), eleven elided exchanges
  // still needed ~6,371 tokens against a 6,272 budget and the attempt died
  // 99 tokens over a floor that grew with the run. The floor must be
  // system + task + newest exchange, whatever N was.
  var replies = [];
  for (var i = 0; i < 11; i++) replies.push(callTool('c' + i, 'read_file', { path: 'add.js' }));
  replies.push(say('done\n' + report('completed', 'read it', [])));
  var sent = [];
  var n = 0;
  // The transport reports prompt_tokens the way a real runtime does —
  // derived from what it was actually sent — plus a fixed head that stands
  // in for a large task prompt. Without that the simulation never feels
  // pressure and proves nothing.
  var HEAD_TOKENS = agent.PROMPT_BUDGET_TOKENS - 900;
  var transport = function (opts, body) {
    var req = JSON.parse(body);
    sent.push(req);
    var chars = req.messages.reduce(function (c, m) {
      return c + (typeof m.content === 'string' ? m.content.length : 0) +
        (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
    }, 0);
    return Promise.resolve({ status: 200, body: JSON.stringify({
      choices: [{ message: replies[Math.min(n++, replies.length - 1)] }],
      usage: { prompt_tokens: HEAD_TOKENS + Math.ceil(chars / 3.5) } }) });
  };
  var task = { task_id: 't-floor', working_directory: ws, execution_profile: 'repo-write',
    timeout_seconds: 600, required_tests: [], constraints: [] };
  return agent.run(task, 'Fix add so its test passes.', null, 'start',
    { apiKey: 'k', model: 'm', transport: transport }).then(function (o) {
    assert.notStrictEqual(o.parsed.subtype, 'HADDAD_AGENT_CONTEXT_EXHAUSTED',
      'the run survived: ' + String(o.stderr).slice(0, 160));
    assert.ok(sent.length >= 11, 'every turn was sent (' + sent.length + ')');
    // The floor holds: the last request carries no more messages than the
    // first few, because exhausted stubs are dropped rather than kept.
    // The property is that growth STOPS, not that the floor is tiny: the
    // runner drops only as much as it must to fit, so the plateau sits
    // wherever the budget allows. Before this fix the count simply climbed
    // until the request was refused.
    var counts = sent.map(function (r) { return r.messages.length; });
    var peak = Math.max.apply(null, counts);
    var peakAt = counts.indexOf(peak);
    assert.ok(peakAt < counts.length - 1, 'the conversation stopped growing before the end: ' + counts.join(','));
    assert.ok(counts.slice(peakAt).every(function (c) { return c <= peak; }),
      'and never grew past that plateau: ' + counts.join(','));
    var last = sent[sent.length - 1];
    assert.strictEqual(last.messages[0].role, 'system');
    assert.ok(/Fix add/.test(last.messages[1].content), 'the task is still there');
    assert.ok(o.tool_trace.some(function (e) { return e.tool === 'context_compaction' && /dropped/.test(e.detail || ''); }),
      'and once elision was exhausted the trace says stubs were DROPPED, which is what makes the floor fixed');
  });
});

// ------------------------------------------------- R. retry and delivery
// Found by the V2.2 E2E (task t-20260923012009-8th6dd): a task retried after
// a transient failure completed with the validator passing and delivered
// NOTHING, because the workspace snapshot is taken at ATTEMPT start and the
// previous attempt's work predates it. Silence was the bug.

t('R1 an attempt that measured no change, in a worktree that is dirty, reports an undelivered delivery instead of silently skipping', function () {
  var ws = newWorkspace('retry-delivery');
  seedBrokenProject(ws);
  cp.execFileSync('git', ['init', '--quiet', ws]);
  cp.execFileSync('git', ['-C', ws, 'config', 'user.email', 'r@example.invalid']);
  cp.execFileSync('git', ['-C', ws, 'config', 'user.name', 'r']);
  cp.execFileSync('git', ['-C', ws, 'add', '-A']);
  cp.execFileSync('git', ['-C', ws, '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'base']);
  // A PREVIOUS attempt fixed the file; this attempt measured nothing.
  fs.writeFileSync(path.join(ws, 'add.js'), FIXED);

  var task = { task_id: 't-retry', working_directory: ws, expected_delivery: 'commit' };
  var report = { status: 'completed', summary: 'no change was needed', commit: null };
  var outcome = { validation: { passed: true, evidence: { changed: { created: [], modified: [], deleted: [] }, checks_run: [{ check: 'node add.test.js', passed: true }] } } };
  var r = executor.deliverValidatedWork(task, report, outcome);
  assert.ok(r && r.problem, 'a problem is reported rather than a silent null: ' + JSON.stringify(r));
  assert.ok(/never delivered/.test(r.problem), 'and it says the work was never delivered: ' + r.problem);
  assert.ok(/Re-run/.test(r.problem), 'and what to do about it');
  // It must NOT commit what the validator never measured.
  var log = cp.execFileSync('git', ['-C', ws, 'log', '--oneline'], { encoding: 'utf8' }).trim().split('\n');
  assert.strictEqual(log.length, 1, 'nothing was committed (' + log.join(' | ') + ')');
});

t('R2 a genuinely clean worktree still delivers nothing, silently and correctly', function () {
  var ws = newWorkspace('retry-clean');
  seedBrokenProject(ws);
  cp.execFileSync('git', ['init', '--quiet', ws]);
  cp.execFileSync('git', ['-C', ws, 'config', 'user.email', 'r@example.invalid']);
  cp.execFileSync('git', ['-C', ws, 'config', 'user.name', 'r']);
  cp.execFileSync('git', ['-C', ws, 'add', '-A']);
  cp.execFileSync('git', ['-C', ws, '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'base']);

  var task = { task_id: 't-clean', working_directory: ws, expected_delivery: 'commit' };
  var report = { status: 'completed', summary: 'nothing to do', commit: null };
  var outcome = { validation: { passed: true, evidence: { changed: { created: [], modified: [], deleted: [] }, checks_run: [] } } };
  assert.strictEqual(executor.deliverValidatedWork(task, report, outcome), null,
    'a task that really changed nothing is still a silent no-op');
});

t('R3 the ordinary path is untouched: measured files are still committed', function () {
  var ws = newWorkspace('retry-normal');
  seedBrokenProject(ws);
  cp.execFileSync('git', ['init', '--quiet', ws]);
  cp.execFileSync('git', ['-C', ws, 'config', 'user.email', 'r@example.invalid']);
  cp.execFileSync('git', ['-C', ws, 'config', 'user.name', 'r']);
  cp.execFileSync('git', ['-C', ws, 'add', '-A']);
  cp.execFileSync('git', ['-C', ws, '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'base']);
  fs.writeFileSync(path.join(ws, 'add.js'), FIXED);

  var task = { task_id: 't-normal', working_directory: ws, expected_delivery: 'commit' };
  var report = { status: 'completed', summary: 'fixed add', commit: null };
  var outcome = { validation: { passed: true, evidence: { changed: { created: [], modified: ['add.js'], deleted: [] }, checks_run: [{ check: 'node add.test.js', passed: true }] } } };
  var r = executor.deliverValidatedWork(task, report, outcome);
  assert.ok(r && r.commit, 'the measured file is committed: ' + JSON.stringify(r));
  var log = cp.execFileSync('git', ['-C', ws, 'log', '--oneline'], { encoding: 'utf8' }).trim().split('\n');
  assert.strictEqual(log.length, 2, 'exactly one delivery commit');
});

// ===========================================================================
queue.reduce(function (c, s) { return c.then(s); }, Promise.resolve()).then(function () {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) console.error('failures:\n  - ' + failures.join('\n  - '));
  process.exit(fail ? 1 : 0);
});
