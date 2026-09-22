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
var fs = require('fs');
var os = require('os');
var path = require('path');

var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var agent = require(path.join(EXEC, 'providers', 'haddad-agent.js'));
var work = require(path.join(EXEC, 'lib', 'work-validation.js'));

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

t('C1 editing the check itself is caught', function () {
  var ws = newWorkspace('edits-check');
  seedBrokenProject(ws);
  return runTask(ws, [
    callTool('c1', 'write_file', { path: 'add.test.js', content: 'console.log("add ok");\n' }),
    say(report('completed', 'Tests pass now.', ['add.test.js']))
  ]).then(function (o) {
    assert.strictEqual(o.validation.passed, false, 'a rewritten check is not a pass');
    assert.ok(/integrity: add\.test\.js .*MODIFIED/.test(rejections(o)),
      'and it is named as an integrity failure: ' + rejections(o));
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

t('C5 work outside the declared scope is caught', function () {
  var ws = newWorkspace('out-of-scope');
  seedBrokenProject(ws);
  return runTask(ws, [
    callTool('c1', 'write_file', { path: 'add.js', content: FIXED }),
    callTool('c2', 'write_file', { path: 'unrelated.js', content: 'module.exports = 1;\n' }),
    say(report('completed', 'Fixed add.', ['add.js', 'unrelated.js']))
  ], { constraints: ['Only change add.js'], required_tests: ['node add.test.js'] }).then(function (o) {
    assert.strictEqual(o.validation.passed, false, 'the extra file was not allowed');
    assert.ok(/scope: unrelated\.js was changed/.test(rejections(o)), rejections(o));
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

// ===========================================================================
queue.reduce(function (c, s) { return c.then(s); }, Promise.resolve()).then(function () {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) console.error('failures:\n  - ' + failures.join('\n  - '));
  process.exit(fail ? 1 : 0);
});
