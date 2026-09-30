'use strict';
// =====================================================
// MYTHOS V3.2 — one baseline per attempt, reused by every retried execution
// tests/v32-attempt-baseline-test.js
//
// Measured live on gh-issue-441 (2026-09-25): execution 1 created the seed
// and timed out; the transient retry started over in the SAME worktree with
// a FRESH baseline, so the file it had to create counted as "modified" — a
// false integrity rejection ("fix the code under test, not the check") that
// spent the repair budget — and anything execution 1 wrote was invisible to
// the retry's validator. The executor now takes the baseline once per
// attempt (task dir baseline.json) and hands it to every execution.
// Real files, real sandbox, real validator; the model is scripted.
// Run with: node tests/v32-attempt-baseline-test.js
// =====================================================
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

process.env.MYTHOS_EXECUTOR_HOME = fs.mkdtempSync(path.join(os.homedir(), 'v32-baseline-store-'));
var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var executor = require(path.join(EXEC, 'executor.js'));
var agent = require(path.join(EXEC, 'providers', 'haddad-agent.js'));
var work = require(path.join(EXEC, 'lib', 'work-validation.js'));

var pass = 0, fail = 0, queue = [];
function t(name, fn) {
  queue.push(function () {
    return Promise.resolve().then(fn).then(
      function () { pass++; console.log('ok - ' + name); },
      function (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); });
  });
}
var ROOT = fs.mkdtempSync(path.join(os.homedir(), 'v32-baseline-'));
var SEED = 'projects/oth-knowledge/seeds/x.json';
var CHECK = 'node projects/oth-knowledge/check.js ' + SEED;
function ws(name) {
  var d = path.join(ROOT, name);
  fs.mkdirSync(path.join(d, 'projects', 'oth-knowledge', 'seeds'), { recursive: true });
  fs.mkdirSync(path.join(d, 'projects', 'mythos-ai-executor'), { recursive: true });
  fs.writeFileSync(path.join(d, 'projects', 'mythos-ai-executor', 'executor.js'), '// original\n');
  // the acceptance check NAMES the file the task must create — the gh-issue-441 shape
  fs.writeFileSync(path.join(d, 'projects', 'oth-knowledge', 'check.js'),
    'var p=process.argv[2];JSON.parse(require("fs").readFileSync(p,"utf8"));console.log("ok");\n');
  return d;
}
function mkTaskDir(id) { fs.mkdirSync(path.join(process.env.MYTHOS_EXECUTOR_HOME, 'tasks', id), { recursive: true }); return id; }
function call(id, name, args) { return { role: 'assistant', content: null, tool_calls: [{ id: id, type: 'function', function: { name: name, arguments: JSON.stringify(args) } }] }; }
function say(text) { return { role: 'assistant', content: text }; }
function report() { return '```json\n' + JSON.stringify({ mythos_report: true, status: 'completed', summary: 'done', files_changed: [SEED], tests: [], commit: null }) + '\n```'; }
function retry(dir, opts, project) {
  var i = 0, replies = [call('w', 'write_file', { path: SEED, content: '{"ok":true}' }), say(report())];
  var transport = function (o, body) { var r = replies[Math.min(i++, replies.length - 1)]; return Promise.resolve({ status: 200, body: JSON.stringify({ choices: [{ message: r }] }) }); };
  var task = executor.withProjectScope({ task_id: 't-base', project: project || 'oth-knowledge', working_directory: dir, execution_profile: 'repo-write',
    timeout_seconds: 300, required_tests: [CHECK], constraints: ['Only change ' + SEED] });
  return agent.run(task, 'create the seed', null, 'start', Object.assign({ apiKey: 'k', model: 'm', transport: transport, structuredReport: false }, opts || {}));
}

t('B1 the executor takes the attempt baseline ONCE, persists it, and hands the same one to every later execution', function () {
  var d = ws('persist');
  var id = mkTaskDir('t-v32-base-b1');
  var task = { provider: 'haddad-agent', working_directory: d };
  var first = executor.attemptBaseline(task, id);
  assert.ok(first && first.files && !(SEED in first.files), 'first execution: the seed does not exist yet');
  assert.ok(fs.existsSync(path.join(process.env.MYTHOS_EXECUTOR_HOME, 'tasks', id, 'baseline.json')), 'persisted in the task dir');
  fs.writeFileSync(path.join(d, SEED), '{"half":');   // execution 1 wrote, then timed out
  var second = executor.attemptBaseline(task, id);
  assert.ok(!(SEED in second.files), 'the retry gets the ORIGINAL baseline, not one that includes execution 1\'s write');
  assert.deepStrictEqual(Object.keys(second.files).sort(), Object.keys(first.files).sort());
});

t('B2 only for the provider that measures the workspace; a baseline for another directory is ignored', function () {
  assert.strictEqual(executor.attemptBaseline({ provider: 'claude-code', working_directory: '/x' }, mkTaskDir('t-v32-base-b2a')), null);
  assert.strictEqual(executor.attemptBaseline({ provider: 'haddad-agent' }, mkTaskDir('t-v32-base-b2b')), null);
  var d = ws('moved'), other = ws('other');
  var id = mkTaskDir('t-v32-base-b2c');
  executor.attemptBaseline({ provider: 'haddad-agent', working_directory: other }, id);
  var fresh = executor.attemptBaseline({ provider: 'haddad-agent', working_directory: d }, id);
  assert.strictEqual(fresh.working_directory, d, 'a baseline of a different worktree is replaced, never reused');
});

t('B3 REPRODUCTION of gh-issue-441 without the carried baseline: the retry rejects the file it had to create as MODIFIED', function () {
  var d = ws('repro');
  fs.writeFileSync(path.join(d, SEED), '{"half":');   // left by execution 1
  return retry(d, {}).then(function (o) {
    var rej = ((o.validations || [])[0] || {}).rejections || [];
    assert.ok(rej.some(function (r) { return /integrity: .* was MODIFIED/.test(r); }), 'the old behaviour, measured: ' + JSON.stringify(rej));
  });
});

t('B4 WITH the carried baseline the same retry sees the file as CREATED and passes', function () {
  var d = ws('fixed');
  var base = work.snapshot(d);                        // taken before execution 1
  fs.writeFileSync(path.join(d, SEED), '{"half":');   // execution 1's leftover
  return retry(d, { baseline: base }).then(function (o) {
    assert.strictEqual(o.validation.passed, true, JSON.stringify(o.validations));
    assert.ok(o.validation.evidence.changed.created.indexOf(SEED) !== -1, 'counted as created by the attempt');
    assert.deepStrictEqual(o.validation.evidence.changed.modified, []);
  });
});

t('B5 an earlier execution\'s out-of-project write is no longer invisible: the retry\'s validator rejects it', function () {
  var d = ws('earlier-escape');
  var base = work.snapshot(d);
  fs.writeFileSync(path.join(d, 'projects', 'mythos-ai-executor', 'executor.js'), '// written by execution 1\n');
  return retry(d, { baseline: base }).then(function (o) {
    var rej = ((o.validations || [])[0] || {}).rejections || [];
    assert.ok(rej.some(function (r) { return /^project: projects\/mythos-ai-executor\/executor\.js/.test(r); }), JSON.stringify(rej));
    assert.strictEqual(o.validation.passed, false);
  });
});

t('B6 a baseline recorded for another directory is ignored by the provider (it takes its own)', function () {
  var d = ws('mismatch');
  fs.writeFileSync(path.join(d, SEED), '{"half":');
  return retry(d, { baseline: { files: {}, working_directory: '/somewhere/else' } }).then(function (o) {
    var rej = ((o.validations || [])[0] || {}).rejections || [];
    assert.ok(rej.some(function (r) { return /was MODIFIED/.test(r); }), 'fell back to its own snapshot: ' + JSON.stringify(rej));
  });
});

t('B7 the executor\'s single launch site passes the attempt baseline', function () {
  var src = fs.readFileSync(path.join(EXEC, 'executor.js'), 'utf8');
  assert.strictEqual((src.match(/provider\.run\(/g) || []).length, 1);
  assert.ok(/provider\.run\(withProjectScope\(task\), prompt, sessionId, mode, \{ baseline: attemptBaseline\(task, taskId\) \}/.test(src));
});

queue.reduce(function (c, s) { return c.then(s); }, Promise.resolve()).then(function () {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); fs.rmSync(process.env.MYTHOS_EXECUTOR_HOME, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
