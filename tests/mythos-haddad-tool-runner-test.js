'use strict';
// =====================================================
// MYTHOS HADDAD — V1a tool runner: grant, confinement, limits
// tests/mythos-haddad-tool-runner-test.js
//
// Offline and deterministic: the model transport is injected, so no GPU, no
// llama-server and no network are needed. The live loop is covered by the
// real GitHub E2E and recorded in projects/mythos-haddad/docs/TOOL_RUNNER.md.
//
// The negatives are the point of this file. A runner that executes tool calls
// is only as good as what it refuses, so every refusal below is asserted
// against the real implementation rather than against a description of it.
// =====================================================
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var agent = require(path.join(EXEC, 'providers', 'haddad-agent.js'));
var policy = require(path.join(EXEC, 'lib', 'policy.js'));

var pass = 0, fail = 0;
var queue = [];
function t(name, fn) {
  queue.push(function () {
    return Promise.resolve().then(fn).then(
      function () { pass++; console.log('ok - ' + name); },
      function (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); }
    );
  });
}

// ---- a real workspace on disk, plus a real escape target outside it -------
// NOT under /tmp, and not only because the repo's other suites keep fixtures
// out of it: the sandbox mounts a scratch tmpfs at /tmp, so a workspace
// placed there would have a writable parent INSIDE the namespace and would
// not mirror production, where task worktrees live under $HOME.
var ROOT = fs.mkdtempSync(path.join(os.homedir(), 'haddad-runner-'));
var WS = path.join(ROOT, 'workspace');
var OUTSIDE = path.join(ROOT, 'outside');
fs.mkdirSync(WS); fs.mkdirSync(OUTSIDE);
fs.mkdirSync(path.join(WS, 'sub'));
fs.writeFileSync(path.join(WS, 'hello.txt'), 'inside the workspace\n');
fs.writeFileSync(path.join(WS, 'sub', 'nested.txt'), 'nested\n');
fs.writeFileSync(path.join(OUTSIDE, 'secret.txt'), 'SHOULD NEVER BE READ\n');
try { fs.symlinkSync(path.join(OUTSIDE, 'secret.txt'), path.join(WS, 'escape-link')); } catch (e) { /* skipped below */ }
try { fs.symlinkSync(OUTSIDE, path.join(WS, 'escape-dir')); } catch (e) { /* skipped below */ }

var ctxRead = { workspace: WS, grant: policy.toolsForProfile('repo-read') };
var ctxTest = { workspace: WS, grant: policy.toolsForProfile('repo-test') };
function call(tool, ctx, args) { return agent.TOOL_IMPL[tool](ctx, args); }

// ---------------------------------------------------------------- A. grant

t('the grant comes from policy.js, not a second dictionary', function () {
  var src = fs.readFileSync(path.join(EXEC, 'providers', 'haddad-agent.js'), 'utf8');
  assert.ok(/require\('\.\.\/lib\/policy'\)/.test(src), 'requires lib/policy');
  assert.ok(/policy\.toolsForProfile\(/.test(src), 'derives the grant from the profile');
  assert.ok(!/allowedTools\s*[:=]\s*\[/.test(src), 'does not restate a tool allow-list of its own');
});

t('writing exists ONLY as write_file, and only where the profile grants it', function () {
  // The capability the owner authorised, and nothing beside it: there is
  // still no edit, no delete, no move, no chmod.
  assert.deepStrictEqual(Object.keys(agent.TOOL_IMPL).sort(),
    ['list_files', 'read_file', 'run_command', 'write_file']);
  assert.strictEqual(agent.TOOL_IMPL.edit_file, undefined);
  assert.strictEqual(agent.TOOL_IMPL.delete_file, undefined);
  assert.strictEqual(agent.TOOL_IMPL.move_file, undefined);

  // The offer follows the PROFILE, which the action already resolved — an
  // investigate or a test task never sees a write tool in its vocabulary.
  function offered(profile) {
    return agent.toolSchemas(policy.toolsForProfile(profile)).map(function (s) { return s.function.name; });
  }
  assert.ok(offered('repo-write').indexOf('write_file') !== -1, 'repo-write offers it');
  assert.ok(offered('repo-read').indexOf('write_file') === -1, 'repo-read does not');
  assert.ok(offered('repo-test').indexOf('write_file') === -1, 'repo-test does not');
  assert.strictEqual(policy.toolsForProfile('repo-read').write_file, false, 'and the policy agrees for repo-read');
  assert.strictEqual(policy.toolsForProfile('repo-test').write_file, false, 'and for repo-test');
});

t('the prompt never denies a capability the run actually has', function () {
  var wGrant = policy.toolsForProfile('repo-write');
  var wPrompt = agent.systemPrompt(wGrant, agent.toolSchemas(wGrant));
  assert.ok(/write_file/.test(wPrompt), 'a writing run is told it can write');
  assert.ok(!/cannot write/.test(wPrompt), 'and is not simultaneously told it cannot');
  assert.ok(/commit, push or merge/.test(wPrompt), 'and is told delivery is not its job');
  assert.ok(/Never weaken or delete a test/.test(wPrompt), 'and is told not to fake a pass');
  var rGrant = policy.toolsForProfile('repo-read');
  var rPrompt = agent.systemPrompt(rGrant, agent.toolSchemas(rGrant));
  assert.ok(/cannot write/.test(rPrompt), 'a read-only run is told it cannot write');
  assert.ok(!/write_file/.test(rPrompt), 'and write_file is not even named to it');
});

t('read-only actions are offered only read tools', function () {
  ['repo-read', 'repo-test'].forEach(function (p) {
    var names = agent.toolSchemas(policy.toolsForProfile(p)).map(function (s) { return s.function.name; });
    assert.ok(names.indexOf('read_file') !== -1, p + ' offers read_file');
    assert.ok(names.every(function (n) { return ['read_file', 'list_files', 'run_command'].indexOf(n) !== -1; }),
      p + ' offers nothing beyond the three V1a tools, got ' + names.join(','));
  });
});

// ------------------------------------------------------------ B. positives

t('read_file returns the real content of a file inside the workspace', function () {
  var r = call('read_file', ctxRead, { path: 'hello.txt' });
  assert.ok(!r.error, 'not refused: ' + r.error);
  assert.strictEqual(r.content, 'inside the workspace\n');
  assert.strictEqual(call('read_file', ctxRead, { path: 'sub/nested.txt' }).content, 'nested\n');
});

t('list_files lists the workspace and marks directories', function () {
  var r = call('list_files', ctxRead, { path: '.' });
  assert.ok(!r.error, 'not refused: ' + r.error);
  assert.ok(r.entries.indexOf('hello.txt') !== -1);
  assert.ok(r.entries.indexOf('sub/') !== -1, 'directories are marked, got ' + r.entries.join(','));
});

t('run_command runs a profile-permitted command and returns its output', function () {
  if (!agent.ALLOWED_PROGRAMS.node) throw new Error('node not found in the allowed program map');
  // A FILE in the workspace, not `-e`: inline code was the vector that walked
  // through every check that was not a namespace, and is now refused outright.
  fs.writeFileSync(path.join(WS, 'tool-ran.js'), 'console.log("TOOL-RAN-OK");\n');
  var r = call('run_command', ctxTest, { program: 'node', args: ['tool-ran.js'] });
  assert.ok(!r.error, 'not refused: ' + r.error);
  assert.strictEqual(r.exit_code, 0);
  assert.ok(/TOOL-RAN-OK/.test(r.stdout), 'real stdout came back, got ' + JSON.stringify(r.stdout));
});

// ------------------------------------------------ C. confinement negatives

t('path traversal is refused', function () {
  ['../outside/secret.txt', '../../etc/passwd', 'sub/../../outside/secret.txt'].forEach(function (p) {
    var r = call('read_file', ctxRead, { path: p });
    assert.ok(r.error, p + ' must be refused');
    assert.ok(/outside the task workspace|not resolvable/.test(r.error), p + ' -> ' + r.error);
  });
});

t('absolute paths outside the workspace are refused', function () {
  ['/etc/passwd', '/etc/shadow', '/root/.ssh/id_rsa', os.homedir() + '/.ssh/id_ed25519',
   os.homedir() + '/.config/mythos-haddad/runtime.key', path.join(OUTSIDE, 'secret.txt')].forEach(function (p) {
    var r = call('read_file', ctxRead, { path: p });
    assert.ok(r.error, p + ' must be refused');
  });
});

t('a symlink pointing out of the workspace is refused', function () {
  if (!fs.existsSync(path.join(WS, 'escape-link'))) return; // symlinks unavailable here
  var r = call('read_file', ctxRead, { path: 'escape-link' });
  assert.ok(r.error, 'symlink escape must be refused');
  assert.ok(!/SHOULD NEVER BE READ/.test(JSON.stringify(r)), 'the target content must never appear');
});

t('a symlinked DIRECTORY cannot be listed or read through', function () {
  if (!fs.existsSync(path.join(WS, 'escape-dir'))) return;
  var l = call('list_files', ctxRead, { path: 'escape-dir' });
  assert.ok(l.error, 'listing through a symlinked dir must be refused');
  var r = call('read_file', ctxRead, { path: 'escape-dir/secret.txt' });
  assert.ok(r.error, 'reading through a symlinked dir must be refused');
  assert.ok(!/SHOULD NEVER BE READ/.test(JSON.stringify(r)));
});

t('absolute path INSIDE the workspace is accepted (containment, not a ban on absolutes)', function () {
  var r = call('read_file', ctxRead, { path: path.join(WS, 'hello.txt') });
  assert.ok(!r.error, 'an absolute path inside the workspace is legitimate: ' + r.error);
});

t('null bytes and non-string paths are refused', function () {
  assert.ok(call('read_file', ctxRead, { path: 'hello.txt .png' }).error);
  assert.ok(call('read_file', ctxRead, { path: 123 }).error);
  assert.ok(call('read_file', ctxRead, {}).error);
});

// -------------------------------------------- D. run_command negatives

t('no shell, ever: sh and bash are not executables this runner will start', function () {
  ['sh', 'bash', '/bin/sh', '/bin/bash', 'zsh'].forEach(function (p) {
    var r = call('run_command', ctxTest, { program: p, args: ['-c', 'echo pwned'] });
    assert.ok(r.error, p + ' must be refused');
    assert.ok(/not an executable this runner will start/.test(r.error), p + ' -> ' + r.error);
  });
  assert.strictEqual(agent.ALLOWED_PROGRAMS.sh, undefined);
  assert.strictEqual(agent.ALLOWED_PROGRAMS.bash, undefined);
});

t('sudo is refused and is not in the program map', function () {
  var r = call('run_command', ctxTest, { program: 'sudo', args: ['ls'] });
  assert.ok(r.error && /not an executable/.test(r.error));
  assert.strictEqual(agent.ALLOWED_PROGRAMS.sudo, undefined);
});

t('arbitrary executables are refused even when they exist on the host', function () {
  ['ls', 'cat', 'curl', 'git', 'python3', 'rm', '/usr/bin/env'].forEach(function (p) {
    var r = call('run_command', ctxTest, { program: p, args: [] });
    assert.ok(r.error, p + ' must be refused by the code ceiling');
  });
});

t('the code ceiling sits BELOW the profile: repo-write grants more, the runner still refuses', function () {
  var ctxWrite = { workspace: WS, grant: policy.toolsForProfile('repo-write') };
  var permitted = agent.commandPermittedByProfile(ctxWrite.grant, 'git', ['status']);
  assert.strictEqual(permitted, true, 'repo-write does permit git by policy');
  var r = call('run_command', ctxWrite, { program: 'git', args: ['status'] });
  assert.ok(r.error && /not an executable this runner will start/.test(r.error),
    'but the runner refuses it anyway: ' + JSON.stringify(r));
});

t('command injection through argv cannot escape: there is no shell to escape into', function () {
  var r = call('run_command', ctxTest, {
    program: 'node',
    args: ['-e', 'console.log("A")', ';', 'rm', '-rf', '/', '&&', 'echo', 'pwned', '$(whoami)', '`id`']
  });
  // Either the profile/arg checks refuse it, or node receives the metacharacters
  // as inert literal argv. What must never happen is a second command running.
  if (!r.error) {
    assert.ok(!/pwned/.test(r.stdout || ''), 'no injected command may run, got ' + JSON.stringify(r.stdout));
    assert.ok(!/uid=/.test((r.stdout || '') + (r.stderr || '')), 'no substitution may occur');
  }
  assert.ok(fs.existsSync(path.join(WS, 'hello.txt')), 'the workspace must be intact');
});

t('the profile bounds arguments: repo-read permits only `node --version`', function () {
  var ok = call('run_command', ctxRead, { program: 'node', args: ['--version'] });
  assert.ok(!ok.error, 'node --version is permitted under repo-read: ' + ok.error);
  var no = call('run_command', ctxRead, { program: 'node', args: ['-e', 'console.log(1)'] });
  assert.ok(no.error && /profile does not permit/.test(no.error), 'anything else is not: ' + JSON.stringify(no));
});

t('repo-test denies git commit/push even though the program map would not', function () {
  var g = policy.toolsForProfile('repo-test');
  assert.strictEqual(agent.commandPermittedByProfile(g, 'git', ['commit', '-m', 'x']), false);
  assert.strictEqual(agent.commandPermittedByProfile(g, 'git', ['push']), false);
});

t('malformed run_command arguments are refused', function () {
  assert.ok(call('run_command', ctxTest, { program: 123 }).error);
  assert.ok(call('run_command', ctxTest, { program: 'node', args: 'not-an-array' }).error);
  assert.ok(call('run_command', ctxTest, { program: 'node', args: [null] }).error);
  assert.ok(call('run_command', ctxTest, { program: 'node', args: ['x y'] }).error);
  assert.ok(call('run_command', ctxTest, { program: 'node', args: new Array(40).fill('-e') }).error);
});

// ------------------------------------------------- E. runner-level failures

function fakeTransport(replies) {
  var i = 0;
  return function () {
    var r = replies[Math.min(i++, replies.length - 1)];
    return Promise.resolve({ status: 200, body: JSON.stringify(r) });
  };
}
function msg(content, toolCalls) {
  return { choices: [{ message: toolCalls ? { content: null, tool_calls: toolCalls } : { content: content } }] };
}
function tc(id, name, args) {
  return { id: id, type: 'function', function: { name: name, arguments: JSON.stringify(args) } };
}
function runAgent(task, replies, extra) {
  return agent.run(task, 'do the thing', null, 'start',
    Object.assign({ apiKey: 'k', model: 'm', transport: fakeTransport(replies) }, extra || {}));
}
function baseTask(over) {
  return Object.assign({ task_id: 't-1', working_directory: WS, execution_profile: 'repo-test', timeout_seconds: 600 }, over || {});
}

t('missing working_directory fails closed, before the model is called', function () {
  var called = false;
  return agent.run(baseTask({ working_directory: null }), 'x', null, 'start',
    { apiKey: 'k', model: 'm', transport: function () { called = true; return Promise.resolve({ status: 200, body: '{}' }); } }
  ).then(function (o) {
    assert.strictEqual(o.parsed.is_error, true);
    assert.strictEqual(o.parsed.subtype, 'HADDAD_AGENT_NO_WORKSPACE');
    assert.strictEqual(called, false, 'the model must never be contacted without a workspace');
  });
});

t('a non-existent working_directory fails closed', function () {
  return runAgent(baseTask({ working_directory: path.join(ROOT, 'nope') }), [msg('x')]).then(function (o) {
    assert.strictEqual(o.parsed.subtype, 'HADDAD_AGENT_NO_WORKSPACE');
  });
});

t('an invalid or disabled profile fails closed', function () {
  return runAgent(baseTask({ execution_profile: 'not-a-profile' }), [msg('x')]).then(function (o) {
    assert.strictEqual(o.parsed.is_error, true);
    assert.strictEqual(o.parsed.subtype, 'HADDAD_AGENT_PROFILE_INVALID');
    return runAgent(baseTask({ execution_profile: 'deploy' }), [msg('x')]);
  }).then(function (o) {
    assert.strictEqual(o.parsed.is_error, true, 'the disabled deploy profile must fail closed');
  });
});

t('an unknown tool call is refused and reported back to the model', function () {
  return runAgent(baseTask(), [
    msg(null, [tc('c1', 'delete_everything', { path: '/' })]),
    msg('done```json\n{"mythos_report":true,"status":"completed","summary":"s"}\n```')
  ]).then(function (o) {
    assert.strictEqual(o.parsed.is_error, false, 'the loop continues after a refusal');
    var refused = o.tool_trace.filter(function (x) { return x.refused; });
    assert.strictEqual(refused.length, 1);
    assert.ok(/unknown tool/.test(refused[0].detail), refused[0].detail);
  });
});

t('a tool the profile did not grant is refused', function () {
  // write_file EXISTS now, so this is the real test of the grant boundary:
  // a repo-read task asking to write must be refused by the profile check,
  // not merely by the tool being unimplemented.
  return runAgent(baseTask({ execution_profile: 'repo-read' }), [
    msg(null, [tc('c1', 'write_file', { path: 'x', content: 'y' })]),
    msg('ok```json\n{"mythos_report":true,"status":"completed","summary":"s"}\n```')
  ]).then(function (o) {
    var refused = o.tool_trace.filter(function (x) { return x.refused; });
    assert.strictEqual(refused.length, 1);
    assert.ok(/not granted by the repo-read profile/.test(refused[0].detail), refused[0].detail);
    assert.ok(!fs.existsSync(path.join(WS, 'x')), 'nothing was written');
  });
});

t('the iteration budget stops the loop, and stops it FOR A PERSON', function () {
  var forever = msg(null, [tc('c1', 'list_files', { path: '.' })]);
  return runAgent(baseTask(), [forever]).then(function (o) {
    // Running out of turns is a rejected attempt that re-enters the bounded
    // repair path (supervised loop B4/B5), so a model that never answers
    // gets MAX_ITERATIONS turns per execution for MAX_REPAIR_ROUNDS + 1
    // executions — and not one more. Executed tool calls stay under the
    // tool-call budget; everything past it is refused, not run.
    assert.ok(o.tool_calls <= agent.MAX_ITERATIONS * (agent.MAX_REPAIR_ROUNDS + 1), 'turns stayed bounded: ' + o.tool_calls);
    assert.ok(o.tool_trace.filter(function (x) { return !x.refused; }).length <= agent.MAX_TOOL_CALLS * (agent.MAX_REPAIR_ROUNDS + 1),
      'executed calls stayed under the per-execution tool-call budget, three executions');
    assert.strictEqual(o.repair_rounds, agent.MAX_REPAIR_ROUNDS, 'every repair round was spent before stopping');
    // A loop that ran out of turns is not a crash: it ends cleanly with a
    // `blocked` report, which the executor already classifies as a human
    // decision, and the report says how far it got rather than only that
    // it stopped.
    assert.strictEqual(o.parsed.is_error, false, 'not reported as a provider error');
    var rep = require(path.join(EXEC, 'lib', 'report.js')).extractReport(o.stdout).report;
    assert.ok(rep && rep.status === 'blocked', 'a blocked report is emitted');
    assert.ok(/model turns/.test(rep.summary), rep.summary);
  });
});

t('the tool-call budget refuses further calls', function () {
  var many = [];
  for (var i = 0; i < 30; i++) many.push(tc('c' + i, 'list_files', { path: '.' }));
  return runAgent(baseTask(), [
    msg(null, many),
    msg('done```json\n{"mythos_report":true,"status":"completed","summary":"s"}\n```')
  ]).then(function (o) {
    var budgetRefusals = o.tool_trace.filter(function (x) { return x.refused && /budget/.test(x.detail || ''); });
    assert.ok(budgetRefusals.length > 0, 'the budget must start refusing');
  });
});

t('an expired task deadline stops the loop', function () {
  return runAgent(baseTask({ timeout_seconds: -1 }), [msg('x')]).then(function (o) {
    assert.strictEqual(o.timed_out, true);
    assert.strictEqual(o.parsed.subtype, 'HADDAD_AGENT_TIMEOUT');
  });
});

t('an oversized tool result is replaced, never streamed back whole', function () {
  var big = 'x'.repeat(agent.MAX_TOOL_OUTPUT_BYTES + 5000);
  fs.writeFileSync(path.join(WS, 'big.txt'), big);
  var r = call('read_file', ctxRead, { path: 'big.txt' });
  // Either the file cap refuses it outright, or the result cap replaces it.
  assert.ok(r.error || r.content.length <= 64 * 1024, 'a large file is bounded');
  fs.unlinkSync(path.join(WS, 'big.txt'));
});

t('a full loop reaches a final answer and carries the tool result into it', function () {
  return runAgent(baseTask(), [
    msg(null, [tc('c1', 'read_file', { path: 'hello.txt' })]),
    msg('The file says: inside the workspace.\n```json\n{"mythos_report":true,"status":"completed","summary":"read it"}\n```')
  ]).then(function (o) {
    assert.strictEqual(o.parsed.is_error, false);
    assert.strictEqual(o.exit_code, 0);
    assert.ok(/inside the workspace/.test(o.parsed.result), 'the final answer used the tool result');
    assert.ok(/mythos_report/.test(o.parsed.result), 'and carries the report block the executor extracts');
    assert.strictEqual(o.tool_trace.filter(function (x) { return x.refused; }).length, 0);
  });
});

// ------------------------------------------------ F. authority + VPS safety

t('executionAuthority is true, and honestly so — there is a real tool surface', function () {
  assert.strictEqual(agent.executionAuthority, true);
  assert.ok(Object.keys(agent.TOOL_IMPL).length >= 3, 'it really does implement tools');
  var advisory = require(path.join(EXEC, 'providers', 'openai-compat.js'));
  assert.strictEqual(advisory.executionAuthority, false, 'advisory providers keep theirs at false');
});

t('available() is false without the enable marker — the VPS case', function () {
  assert.strictEqual(agent.available({ enableFile: path.join(ROOT, 'absent-marker') }), false);
});

t('available() is false with a marker but no key', function () {
  var m = path.join(ROOT, 'marker');
  fs.writeFileSync(m, '');
  assert.strictEqual(agent.available({ enableFile: m, keyFile: path.join(ROOT, 'no-key') }), false);
});

t('the bridge keeps advisory and execution provider gates separate', function () {
  var src = fs.readFileSync(path.join(EXEC, 'bridge', 'github-bridge.js'), 'utf8');
  assert.ok(/WORKER_PROVIDER_ALLOWED = \['openai-compat', 'free-llm-pool'\]/.test(src),
    'the advisory list still contains only advisory providers');
  assert.ok(/EXEC_WORKER_PROVIDER_ALLOWED = \['haddad-agent'\]/.test(src),
    'execution-capable providers have their own list');
  assert.ok(/BRIDGE_PROVIDER_CONFLICT/.test(src), 'setting both is refused');
});

// ===========================================================================
// W. write_file — the capability authorised for this stage, and its walls.
// Every refusal below is asserted against the real filesystem: real
// symlinks, real system paths, real .git directory.
// ===========================================================================

var ctxWrite = { workspace: WS, grant: policy.toolsForProfile('repo-write') };

t('W1 normal write: a new file lands inside the workspace', function () {
  var r = call('write_file', ctxWrite, { path: 'sub/created.txt', content: 'written by the runner\n' });
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.created, true);
  assert.strictEqual(fs.readFileSync(path.join(WS, 'sub', 'created.txt'), 'utf8'), 'written by the runner\n');
});

t('W2 normal write: an existing file is replaced, and reads back', function () {
  var r = call('write_file', ctxWrite, { path: 'hello.txt', content: 'replaced\n' });
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.created, false);
  assert.strictEqual(call('read_file', ctxWrite, { path: 'hello.txt' }).content, 'replaced\n');
  fs.writeFileSync(path.join(WS, 'hello.txt'), 'inside the workspace\n');
});

t('W3 path traversal is refused', function () {
  ['../outside/planted.txt', 'sub/../../outside/planted.txt', '../../../../tmp/planted.txt'].forEach(function (p) {
    var r = call('write_file', ctxWrite, { path: p, content: 'x' });
    assert.ok(r.error && /outside the task workspace|not resolvable/.test(r.error), p + ' → ' + r.error);
  });
  assert.ok(!fs.existsSync(path.join(OUTSIDE, 'planted.txt')), 'nothing landed outside');
});

t('W4 an absolute path outside the workspace is refused', function () {
  [path.join(OUTSIDE, 'planted.txt'), '/tmp/planted-by-runner.txt', '/etc/cron.d/planted'].forEach(function (p) {
    var r = call('write_file', ctxWrite, { path: p, content: 'x' });
    assert.ok(r.error && /outside the task workspace/.test(r.error), p + ' → ' + r.error);
  });
  assert.ok(!fs.existsSync('/tmp/planted-by-runner.txt'), 'nothing landed in /tmp');
});

t('W5 symlink escape is refused — through a link, and through a linked directory', function () {
  if (!fs.existsSync(path.join(WS, 'escape-link'))) return; // symlinks unsupported here
  var viaFile = call('write_file', ctxWrite, { path: 'escape-link', content: 'OVERWRITTEN' });
  assert.ok(viaFile.error && /outside the task workspace/.test(viaFile.error), viaFile.error);
  var viaDir = call('write_file', ctxWrite, { path: 'escape-dir/planted.txt', content: 'x' });
  assert.ok(viaDir.error && /outside the task workspace/.test(viaDir.error), viaDir.error);
  assert.strictEqual(fs.readFileSync(path.join(OUTSIDE, 'secret.txt'), 'utf8'), 'SHOULD NEVER BE READ\n',
    'the file the link pointed at is untouched');
  assert.ok(!fs.existsSync(path.join(OUTSIDE, 'planted.txt')), 'nothing was planted through the linked directory');
});

t('W5b a symlink created INSIDE the workspace after the fact is still not written through', function () {
  var link = path.join(WS, 'sub', 'later-link');
  try { fs.unlinkSync(link); } catch (e) { /* first run */ }
  try { fs.symlinkSync(path.join(OUTSIDE, 'secret.txt'), link); } catch (e) { return; }
  var r = call('write_file', ctxWrite, { path: 'sub/later-link', content: 'OVERWRITTEN' });
  assert.ok(r.error && /(symbolic link|outside the task workspace)/.test(r.error), r.error);
  assert.strictEqual(fs.readFileSync(path.join(OUTSIDE, 'secret.txt'), 'utf8'), 'SHOULD NEVER BE READ\n');
});

t('W6 forbidden system paths are refused', function () {
  ['/etc/passwd', '/etc/ssh/sshd_config', '/root/.ssh/authorized_keys',
   path.join(os.homedir(), '.ssh', 'authorized_keys'),
   path.join(os.homedir(), '.config', 'systemd', 'user', 'planted.service'),
   path.join(os.homedir(), '.config', 'mythos-haddad', 'runtime.key')
  ].forEach(function (p) {
    var r = call('write_file', ctxWrite, { path: p, content: 'x' });
    assert.ok(r.error && /outside the task workspace/.test(r.error), p + ' → ' + String(r.error));
    var rd = call('read_file', ctxWrite, { path: p });
    assert.ok(rd.error, 'and it cannot be read either: ' + p);
  });
});

t('W7 .git is refused for write AND read — a hook there would run as someone else', function () {
  fs.mkdirSync(path.join(WS, '.git', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(WS, '.git', 'config'), '[core]\n');
  ['.git/hooks/pre-commit', '.git/config', 'sub/../.git/hooks/post-checkout'].forEach(function (p) {
    var r = call('write_file', ctxWrite, { path: p, content: '#!/bin/sh\necho pwned\n' });
    assert.ok(r.error && /\.git is not writable/.test(r.error), p + ' → ' + String(r.error));
  });
  assert.ok(!fs.existsSync(path.join(WS, '.git', 'hooks', 'pre-commit')), 'no hook was planted');
  assert.ok(call('read_file', ctxWrite, { path: '.git/config' }).error, '.git is not readable either');
});

t('W8 privileged and shell commands stay refused, with write granted', function () {
  ['sudo', 'sh', 'bash', 'git', 'chmod', 'ssh', 'systemctl', 'curl'].forEach(function (prog) {
    var r = call('run_command', ctxWrite, { program: prog, args: [] });
    assert.ok(r.error && /is not an executable this runner will start/.test(r.error), prog + ' → ' + String(r.error));
  });
  // git is permitted by the repo-write PROFILE and still refused by the code
  // ceiling — which is what keeps commit, push and merge unreachable.
  assert.ok(policy.toolsForProfile('repo-write').commands.some(function (c) { return c.program === 'git'; }),
    'the profile really does permit git');
  assert.strictEqual(agent.ALLOWED_PROGRAMS.git, undefined, 'and the runner still cannot start it');
});

t('W9 workspace isolation: another task workspace is untouchable', function () {
  var other = path.join(ROOT, 'other-workspace');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'theirs.txt'), 'another project\n');
  var r = call('write_file', ctxWrite, { path: path.join(other, 'theirs.txt'), content: 'STOLEN' });
  assert.ok(r.error && /outside the task workspace/.test(r.error), String(r.error));
  assert.strictEqual(fs.readFileSync(path.join(other, 'theirs.txt'), 'utf8'), 'another project\n');
  // …and from the other side, with its own context.
  var ctxOther = { workspace: other, grant: policy.toolsForProfile('repo-write') };
  var back = call('write_file', ctxOther, { path: path.join(WS, 'hello.txt'), content: 'STOLEN' });
  assert.ok(back.error && /outside the task workspace/.test(back.error), String(back.error));
});

t('W10 malformed write requests are refused, not guessed at', function () {
  [{ path: 'x.txt' },
   { path: 'x.txt', content: 123 },
   { path: 'x.txt', content: null },
   { path: '', content: 'x' },
   { path: 'has\u0000null.txt', content: 'x' },
   { content: 'x' },
   { path: 'sub', content: 'x' },
   { path: 'missing-dir/deep/x.txt', content: 'x' }
  ].forEach(function (args) {
    var r = call('write_file', ctxWrite, args);
    assert.ok(r.error, JSON.stringify(args) + ' should be refused');
  });
  assert.ok(!fs.existsSync(path.join(WS, 'x.txt')), 'no file was created by a malformed request');
  var big = call('write_file', ctxWrite, { path: 'big.txt', content: 'x'.repeat(300 * 1024) });
  assert.ok(big.error && /larger than/.test(big.error), String(big.error));
});

t('W11 the runner can run the tests it just changed', function () {
  fs.writeFileSync(path.join(WS, 'check.js'), 'process.exit(0);\n');
  var r = call('run_command', ctxWrite, { program: 'node', args: ['check.js'] });
  assert.ok(!r.error, String(r.error));
  assert.strictEqual(r.exit_code, 0);
  var w = call('write_file', ctxWrite, { path: 'check.js', content: 'console.log("changed"); process.exit(3);\n' });
  assert.ok(!w.error, String(w.error));
  var again = call('run_command', ctxWrite, { program: 'node', args: ['check.js'] });
  assert.strictEqual(again.exit_code, 3, 'the command observes the write that preceded it');
  assert.ok(/changed/.test(again.stdout), 'and its output comes back');
});

// ===========================================================================
// S. THE SANDBOX — the boundary run_command actually runs behind.
//
// Everything in this section executes for real: a real bwrap namespace, a
// real node process, real attempts at the real filesystem. `node -e` was
// demonstrated writing outside the workspace, spawning a shell as this user
// and reaching the network, straight through the allow-list and the argv
// checks. Those checks are still here and still refuse — but they are not
// what makes the escape impossible, so this section proves the namespace.
// ===========================================================================

var SANDBOXED = !!agent.SANDBOX_BIN;
var OUTSIDE_MARK = path.join(ROOT, 'ESCAPED.txt');

t('S0 the sandbox is present, and commands fail closed without one', function () {
  assert.ok(SANDBOXED, 'bwrap is available on this host');
  var src = fs.readFileSync(path.join(EXEC, 'providers', 'haddad-agent.js'), 'utf8');
  assert.ok(/no sandbox available on this host, so no command runs/.test(src),
    'there is an explicit refusal when no sandbox exists');
  assert.ok(!/cp\.spawnSync\(bin,/.test(src), 'no code path starts the program outside the sandbox');
  assert.ok(/cp\.spawnSync\(SANDBOX_BIN, sandboxArgv\(/.test(src), 'the only spawn goes through sandboxArgv');
  var argv = agent.sandboxArgv('/ws', '/usr/bin/node', ['x.js']);
  assert.ok(argv.indexOf('--unshare-all') !== -1, 'namespaces are unshared (network included)');
  assert.ok(argv.indexOf('--remount-ro') !== -1, 'the invented root is read-only');
  assert.ok(argv.indexOf('--clearenv') !== -1, 'the environment does not leak in');
  assert.ok(argv.join(' ').indexOf('--ro-bind /usr /usr') !== -1, '/usr is read-only');
  assert.ok(argv.join(' ').indexOf('/etc') === -1, '/etc is never mounted');
  assert.ok(argv.join(' ').indexOf('--bind /ws /ws') !== -1, 'the workspace is the writable mount');
});

t('S1 a test file inside the workspace runs and reports its exit code', function () {
  if (!SANDBOXED) return;
  fs.writeFileSync(path.join(WS, 'passing.test.js'), 'console.log("2 passed"); process.exit(0);\n');
  var r = call('run_command', ctxWrite, { program: 'node', args: ['passing.test.js'] });
  assert.ok(!r.error, String(r.error));
  assert.strictEqual(r.exit_code, 0);
  assert.ok(/2 passed/.test(r.stdout), r.stdout);
  fs.writeFileSync(path.join(WS, 'failing.test.js'), 'console.error("1 failed"); process.exit(1);\n');
  var f = call('run_command', ctxWrite, { program: 'node', args: ['failing.test.js'] });
  assert.strictEqual(f.exit_code, 1, 'a real failure comes back as a real non-zero exit');
});

t('S2 npm test is permitted; install and other scripts are not', function () {
  if (!SANDBOXED) return;
  fs.writeFileSync(path.join(WS, 'package.json'),
    JSON.stringify({ name: 'ws', version: '1.0.0', scripts: { test: 'node passing.test.js', build: 'node evil.js' } }) + '\n');
  var ok = call('run_command', ctxWrite, { program: 'npm', args: ['test'] });
  assert.ok(!ok.error, 'npm test is allowed: ' + String(ok.error));
  [['install'], ['install', 'left-pad'], ['run', 'build'], ['ci'], ['publish'], ['exec', 'x']].forEach(function (argv) {
    var r = call('run_command', ctxWrite, { program: 'npm', args: argv });
    assert.ok(r.error && /only run the test script/.test(r.error), 'npm ' + argv.join(' ') + ' → ' + String(r.error));
  });
});

t('S3 node -e and every other inline-code flag are refused', function () {
  ['-e', '--eval', '-p', '--print', '-r', '--require', '--input-type', '-i', '--interactive'].forEach(function (flag) {
    var r = call('run_command', ctxWrite, { program: 'node', args: [flag, 'console.log(1)'] });
    assert.ok(r.error && /evaluates code given as an argument|cannot take a program on stdin/.test(r.error),
      'node ' + flag + ' → ' + String(r.error));
  });
  assert.ok(call('run_command', ctxWrite, { program: 'node', args: ['--eval=1'] }).error, '--eval=1 is refused too');
  assert.ok(call('run_command', ctxWrite, { program: 'node', args: ['-'] }).error, 'a program on stdin is refused');
});

t('S4 THE ORIGINAL EXPLOIT, from a file the runner is allowed to run', function () {
  if (!SANDBOXED) return;
  // The argv rules cannot stop this: writing a file and running it is exactly
  // what the runner exists for. Only the namespace can, so this is the test
  // that matters most in this file.
  try { fs.unlinkSync(OUTSIDE_MARK); } catch (e) { /* first run */ }
  fs.writeFileSync(path.join(WS, 'attack.js'), [
    'var fs = require("fs"), out = [];',
    'function tryIt(l, f) { try { out.push(l + ":" + f()); } catch (e) { out.push(l + ":blocked(" + e.code + ")"); } }',
    'tryIt("write-outside", function () { fs.writeFileSync(' + JSON.stringify(OUTSIDE_MARK) + ', "escaped"); return "WROTE"; });',
    'tryIt("read-etc", function () { return "READ" + fs.readFileSync("/etc/passwd", "utf8").length; });',
    'tryIt("read-ssh", function () { return "READ" + fs.readdirSync(' + JSON.stringify(path.join(os.homedir(), '.ssh')) + '); });',
    'tryIt("shell", function () { return "SHELL" + require("child_process").execSync("whoami").toString().trim(); });',
    'tryIt("write-home", function () { fs.writeFileSync(' + JSON.stringify(path.join(os.homedir(), 'ESCAPED.txt')) + ', "x"); return "WROTE"; });',
    'console.log(out.join("\\n"));'
  ].join('\n'));
  var r = call('run_command', ctxWrite, { program: 'node', args: ['attack.js'] });
  assert.ok(!r.error, 'the command itself is allowed to run: ' + String(r.error));
  var out = String(r.stdout || '');
  ['write-outside', 'read-etc', 'read-ssh', 'shell', 'write-home'].forEach(function (label) {
    assert.ok(new RegExp(label + ':blocked').test(out), label + ' must be blocked — got: ' + out.replace(/\n/g, ' | '));
  });
  // And the only claim that counts: the real filesystem is untouched.
  assert.ok(!fs.existsSync(OUTSIDE_MARK), 'nothing was written outside the workspace');
  assert.ok(!fs.existsSync(path.join(os.homedir(), 'ESCAPED.txt')), 'nothing was written into $HOME');
});

t('S5 secrets outside the workspace are absent, not merely forbidden', function () {
  if (!SANDBOXED) return;
  fs.writeFileSync(path.join(WS, 'read-secrets.js'), [
    'var fs = require("fs"), out = [];',
    [path.join(os.homedir(), '.config', 'mythos-haddad', 'runtime.key'),
     path.join(os.homedir(), '.config', 'mythos-haddad', 'github-issues.env'),
     '/etc/shadow', '/etc/ssh/sshd_config'].map(function (p) {
      return 'try { out.push("READ:" + fs.readFileSync(' + JSON.stringify(p) + ', "utf8").length); } catch (e) { out.push("blocked:" + e.code); }';
    }).join('\n'),
    'console.log(out.join("\\n"));'
  ].join('\n'));
  var r = call('run_command', ctxWrite, { program: 'node', args: ['read-secrets.js'] });
  assert.ok(!/READ:/.test(String(r.stdout)), 'no secret was readable: ' + String(r.stdout).replace(/\n/g, ' | '));
});

t('S6 there is no network inside the sandbox', function () {
  if (!SANDBOXED) return;
  fs.writeFileSync(path.join(WS, 'net.js'),
    'require("http").get("http://127.0.0.1:8600/v1/models", function (r) { console.log("REACHED", r.statusCode); })' +
    '.on("error", function (e) { console.log("blocked:" + e.code); });\n');
  var r = call('run_command', ctxWrite, { program: 'node', args: ['net.js'] });
  assert.ok(!/REACHED/.test(String(r.stdout)), 'the local runtime was not reachable: ' + String(r.stdout).trim());
});

t('S7 a symlink planted in the workspace leads nowhere from inside a command', function () {
  if (!SANDBOXED) return;
  var link = path.join(WS, 'cmd-escape-link');
  try { fs.unlinkSync(link); } catch (e) { /* first run */ }
  try { fs.symlinkSync(path.join(OUTSIDE, 'secret.txt'), link); } catch (e) { return; }
  fs.writeFileSync(path.join(WS, 'follow.js'),
    'try { console.log("READ:" + require("fs").readFileSync("cmd-escape-link", "utf8").trim()); }' +
    ' catch (e) { console.log("blocked:" + e.code); }\n');
  var r = call('run_command', ctxWrite, { program: 'node', args: ['follow.js'] });
  assert.ok(!/SHOULD NEVER BE READ/.test(String(r.stdout)), 'the link resolved to nothing: ' + String(r.stdout).trim());
});

t('S8 traversal from inside a command fails with a real error', function () {
  if (!SANDBOXED) return;
  fs.writeFileSync(path.join(WS, 'traverse.js'), [
    'var fs = require("fs"), out = [];',
    'try { fs.writeFileSync("../traversed.txt", "x"); out.push("WROTE"); } catch (e) { out.push("blocked:" + e.code); }',
    'try { fs.writeFileSync("../../traversed.txt", "x"); out.push("WROTE"); } catch (e) { out.push("blocked:" + e.code); }',
    'console.log(out.join("\\n"));'
  ].join('\n'));
  var r = call('run_command', ctxWrite, { program: 'node', args: ['traverse.js'] });
  assert.ok(!/WROTE/.test(String(r.stdout)), 'traversal was refused: ' + String(r.stdout).replace(/\n/g, ' | '));
  assert.ok(/EROFS|ENOENT|EACCES/.test(String(r.stdout)), 'and failed with a real errno, not a phantom success');
  assert.ok(!fs.existsSync(path.join(ROOT, 'traversed.txt')), 'nothing landed above the workspace');
});

t('S9 another task workspace is not visible from inside a command', function () {
  if (!SANDBOXED) return;
  var other = path.join(ROOT, 'other-workspace');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'theirs.txt'), 'another project\n');
  fs.writeFileSync(path.join(WS, 'peek.js'),
    'try { console.log("READ:" + require("fs").readFileSync(' + JSON.stringify(path.join(other, 'theirs.txt')) + ', "utf8").trim()); }' +
    ' catch (e) { console.log("blocked:" + e.code); }\n');
  var r = call('run_command', ctxWrite, { program: 'node', args: ['peek.js'] });
  assert.ok(!/another project/.test(String(r.stdout)), 'the other workspace was invisible: ' + String(r.stdout).trim());
  assert.strictEqual(fs.readFileSync(path.join(other, 'theirs.txt'), 'utf8'), 'another project\n');
});

t('S10 ordinary work inside the workspace is unaffected', function () {
  if (!SANDBOXED) return;
  // Read a file, write a file, run the thing you wrote — the whole point.
  assert.ok(!call('write_file', ctxWrite, { path: 'lib.js', content: 'module.exports = function (a, b) { return a + b; };\n' }).error);
  assert.ok(!call('write_file', ctxWrite, { path: 'lib.test.js',
    content: 'var add = require("./lib"); if (add(2, 2) !== 4) { console.error("FAIL"); process.exit(1); } console.log("ok"); \n' }).error);
  var r = call('run_command', ctxWrite, { program: 'node', args: ['lib.test.js'] });
  assert.strictEqual(r.exit_code, 0, 'the test it wrote passes: ' + JSON.stringify(r));
  assert.ok(/ok/.test(r.stdout));
  assert.strictEqual(call('read_file', ctxWrite, { path: 'lib.js' }).content.indexOf('module.exports'), 0,
    'and the file is readable back through the tools');
});

// ---- U: the daemon's own unit must not stop the sandbox from starting ----
// On a host with kernel.apparmor_restrict_unprivileged_userns=1 a service
// that has a private mount namespace (PrivateTmp, ProtectSystem,
// ProtectHome, ReadWritePaths, …) cannot create the user namespace bwrap
// needs, and --unshare-all needs a NETLINK_ROUTE socket for loopback.
// Measured live (gh-issue-370, gh-issue-371); this pins the template.
t('U1 the worker unit template creates no mount namespace and allows NETLINK', function () {
  var unit = fs.readFileSync(path.join(__dirname, '..', 'projects', 'mythos-haddad', 'systemd', 'mythos-haddad-worker.service'), 'utf8');
  var active = unit.split('\n').filter(function (l) { return /^[A-Za-z]+=/.test(l); });
  ['PrivateTmp', 'ProtectSystem', 'ProtectHome', 'ReadWritePaths', 'ReadOnlyPaths', 'InaccessiblePaths', 'PrivateDevices', 'ProtectKernelTunables', 'RestrictNamespaces', 'TemporaryFileSystem', 'BindPaths', 'RootDirectory'].forEach(function (k) {
    assert.ok(!active.some(function (l) { return l.indexOf(k + '=') === 0; }), k + '= would give the daemon a mount namespace and break bwrap');
  });
  var af = active.filter(function (l) { return l.indexOf('RestrictAddressFamilies=') === 0; })[0] || '';
  assert.ok(/\bAF_NETLINK\b/.test(af), 'RestrictAddressFamilies must include AF_NETLINK for bwrap loopback');
  assert.ok(active.indexOf('NoNewPrivileges=true') !== -1, 'NoNewPrivileges stays (it does not block bwrap)');
});

// The tool layer refuses .git, but the runner's whole purpose is to execute
// the model's OWN code, and that code is not bound by a tool rule. Measured
// before this was closed: a script written to an ordinary path and started
// with the permitted `node <file>` appended `core.hooksPath` to .git/config.
// Nothing caught it — .git is in work-validation's IGNORED_DIRS, so the diff
// was empty and the attempt could still pass — and the executor then commits
// in that workspace OUTSIDE the sandbox, where `--no-verify` does not stop a
// post-commit hook (verified: it ran). Arbitrary code as the host user.
//
// So this asserts the BOUNDARY, not the rule: EROFS from inside, whatever is
// running. Real bwrap, real script, real repository.
t('U2 a script the model runs cannot write .git — the sandbox, not the tool rule, refuses it', function () {
  var cp = require('child_process');
  var ws = path.join(ROOT, 'git-boundary');
  fs.mkdirSync(ws, { recursive: true });
  cp.execFileSync('git', ['init', '-q'], { cwd: ws, stdio: ['ignore', 'ignore', 'ignore'] });
  var cfg = path.join(ws, '.git', 'config');
  var before = fs.readFileSync(cfg, 'utf8');
  fs.writeFileSync(path.join(ws, 'attack.js'),
    "require('fs').appendFileSync('.git/config','\\n[core]\\n\\thooksPath = ../evil\\n');console.log('MODIFIED');\n");

  var argv = agent.sandboxArgv(ws, '/usr/bin/node', ['attack.js']);
  var ro = argv.indexOf('--ro-bind-try');
  assert.notStrictEqual(ro, -1, 'the argv mounts .git read-only');
  assert.strictEqual(argv[ro + 1], path.join(ws, '.git'));
  assert.strictEqual(argv[ro + 2], path.join(ws, '.git'));

  var r = cp.spawnSync(agent.SANDBOX_BIN, argv, { encoding: 'utf8', timeout: 25000 });
  assert.notStrictEqual(r.status, 0, 'the write must fail: ' + (r.stdout || '').trim());
  assert.ok(/EROFS|read-only/i.test(String(r.stderr)), 'and fail as read-only, not as "file not found": ' + String(r.stderr).slice(0, 200));
  assert.strictEqual(fs.readFileSync(cfg, 'utf8'), before, '.git/config is byte-identical afterwards');

  // The workspace itself is still writable — the fix must not have made the
  // runner useless.
  fs.writeFileSync(path.join(ws, 'ok.js'), "require('fs').writeFileSync('proof.txt','x');console.log('OK');\n");
  var ok = cp.spawnSync(agent.SANDBOX_BIN, agent.sandboxArgv(ws, '/usr/bin/node', ['ok.js']), { encoding: 'utf8', timeout: 25000 });
  assert.strictEqual(ok.status, 0, 'ordinary workspace writes still work: ' + String(ok.stderr).slice(0, 200));
  assert.ok(fs.existsSync(path.join(ws, 'proof.txt')));
});

// U2 uses `git init`, where .git is a DIRECTORY. Every real Haddad workspace
// is a git WORKTREE, where .git is a FILE pointing into the parent repo —
// a different thing to mount, and a --ro-bind that could not handle it would
// fail the sandbox at startup and refuse every command on the host while the
// unit tests stayed green. So the production shape is asserted, not assumed.
t('U2b the same boundary holds in a git WORKTREE, where .git is a file, and the sandbox still starts', function () {
  var cp = require('child_process');
  var base = path.join(ROOT, 'wt-base');
  fs.mkdirSync(base, { recursive: true });
  function g(a, cwd) { return cp.execFileSync('git', a, { cwd: cwd || base, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  g(['init', '-q', '.']);
  fs.writeFileSync(path.join(base, 'a.js'), 'module.exports = 1;\n');
  g(['add', '-A']); g(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed']);
  var ws = path.join(ROOT, 'wt-workspace');
  g(['worktree', 'add', '-q', '--detach', ws]);

  assert.ok(fs.lstatSync(path.join(ws, '.git')).isFile(), 'a worktree .git is a file — the case this pins');
  var gitFileBefore = fs.readFileSync(path.join(ws, '.git'), 'utf8');

  fs.writeFileSync(path.join(ws, 'probe.js'),
    "var fs=require('fs');fs.writeFileSync('ok.txt','x');" +
    "try{fs.appendFileSync('.git','HACK');console.log('GIT_WRITE_OK')}catch(e){console.log('BLOCKED '+e.code)}\n");
  var r = cp.spawnSync(agent.SANDBOX_BIN, agent.sandboxArgv(ws, '/usr/bin/node', ['probe.js']), { encoding: 'utf8', timeout: 25000 });

  assert.strictEqual(r.status, 0, 'the sandbox still STARTS over a .git file: ' + String(r.stderr).slice(0, 200));
  assert.ok(/BLOCKED EROFS/.test(r.stdout), 'and the .git file is read-only inside: ' + String(r.stdout).trim());
  assert.ok(fs.existsSync(path.join(ws, 'ok.txt')), 'ordinary writes still land');
  assert.strictEqual(fs.readFileSync(path.join(ws, '.git'), 'utf8'), gitFileBefore, '.git file untouched');
  try { g(['worktree', 'remove', '--force', ws]); } catch (e) { /* cleaned with ROOT anyway */ }
});

// The second lock, on the door that opens outside the sandbox: the executor
// commits as the host user in a workspace the worker could write to, and a
// repository can make git run a script by configuration alone.
t('U3 the executor delivers with hooks disabled, so a workspace cannot make git run its code', function () {
  var src = fs.readFileSync(path.join(EXEC, 'executor.js'), 'utf8');
  var fn = src.slice(src.indexOf('function deliverValidatedWork'), src.indexOf('function verifyGit'));
  assert.ok(/NO_HOOKS = \['-c', 'core\.hooksPath=\/dev\/null'\]/.test(fn), 'delivery pins core.hooksPath');
  // EVERY git invocation in the delivery path must start from NO_HOOKS —
  // checked by shape rather than by proximity, so adding a fourth git call
  // without it fails here instead of shipping.
  var calls = fn.match(/gitlib\.git\(([\s\S]*?), cwd\)/g) || [];
  assert.ok(calls.length >= 3, 'found the delivery git calls: ' + calls.length);
  calls.forEach(function (c) {
    assert.ok(/gitlib\.git\(NO_HOOKS\./.test(c),
      'this delivery git call does not disable hooks: ' + c.replace(/\s+/g, ' ').slice(0, 120));
  });
});

queue.reduce(function (c, s) { return c.then(s); }, Promise.resolve()).then(function () {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
