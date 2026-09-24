'use strict';
// =====================================================
// MYTHOS V3.2 — project isolation: a project's tasks write only inside it
// tests/v32-project-isolation-test.js
//
// Found by the V3.2 security audit: a task's PROJECT never constrained its
// writes — the validator enforced only the paths an Issue happened to
// declare, so a task on the oth-knowledge intake with a prose-only
// constraint could change any file in the repository, and only the
// director's review stood between it and main. Now a project may declare
// `write_scope` in config/projects.json; the executor passes it to the
// provider (derived from config at launch, never from task.json); the
// runner refuses writes outside it at the tool, and the validator rejects
// any touched file outside it — including one written by a script the model
// ran. Real files, the real sandbox, the real validator; the model is
// scripted so the sequence is deterministic.
// Run with: node tests/v32-project-isolation-test.js
// =====================================================
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

process.env.MYTHOS_EXECUTOR_HOME = process.env.MYTHOS_EXECUTOR_HOME || fs.mkdtempSync(path.join(os.homedir(), 'v32-iso-store-'));
var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var agent = require(path.join(EXEC, 'providers', 'haddad-agent.js'));
var executor = require(path.join(EXEC, 'executor.js'));
var work = require(path.join(EXEC, 'lib', 'work-validation.js'));

var pass = 0, fail = 0, queue = [];
function t(name, fn) {
  queue.push(function () {
    return Promise.resolve().then(fn).then(
      function () { pass++; console.log('ok - ' + name); },
      function (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); });
  });
}
var ROOT = fs.mkdtempSync(path.join(os.homedir(), 'v32-iso-'));   // under $HOME: the sandbox mounts its own /tmp
function ws(name) {
  var d = path.join(ROOT, name);
  fs.mkdirSync(path.join(d, 'projects', 'oth-knowledge', 'seeds'), { recursive: true });
  fs.mkdirSync(path.join(d, 'projects', 'mythos-ai-executor'), { recursive: true });
  fs.writeFileSync(path.join(d, 'projects', 'mythos-ai-executor', 'executor.js'), '// original\n');
  fs.writeFileSync(path.join(d, 'projects', 'oth-knowledge', 'check.js'),
    'var fs=require("fs");process.exit(fs.existsSync(__dirname+"/seeds/x.json")?0:1);\n');
  return d;
}
function say(text) { return { role: 'assistant', content: text }; }
function call(id, name, args) { return { role: 'assistant', content: null, tool_calls: [{ id: id, type: 'function', function: { name: name, arguments: JSON.stringify(args) } }] }; }
function report() { return '```json\n' + JSON.stringify({ mythos_report: true, status: 'completed', summary: 'done', files_changed: [], tests: [], commit: null }) + '\n```'; }
function runAs(project, dir, replies, taskOver) {
  var i = 0, sent = [];
  var transport = function (o, body) { sent.push(JSON.parse(body)); var r = replies[Math.min(i++, replies.length - 1)]; return Promise.resolve({ status: 200, body: JSON.stringify({ choices: [{ message: r }] }) }); };
  var task = Object.assign({ task_id: 't-iso', project: project, working_directory: dir, execution_profile: 'repo-write', timeout_seconds: 300,
    required_tests: ['node projects/oth-knowledge/check.js'], constraints: ['Keep it small.'] }, taskOver || {});
  // Exactly what the executor hands the provider:
  return agent.run(executor.withProjectScope(task), 'do it', null, 'start', { apiKey: 'k', model: 'm', transport: transport, structuredReport: false })
    .then(function (o) { o._sent = sent; return o; });
}
function toolResults(o) {
  return o._sent.map(function (r) { return r.messages.filter(function (m) { return m.role === 'tool'; }).slice(-1)[0]; })
    .filter(Boolean).map(function (m) { return m.content; });
}

t('S1 the scope comes from config/projects.json and only from there', function () {
  assert.deepStrictEqual(executor.projectWriteScope('oth-knowledge'), ['projects/oth-knowledge']);
  assert.strictEqual(executor.projectWriteScope('mythos-haddad'), null, 'a project without write_scope is unchanged');
  assert.strictEqual(executor.projectWriteScope('no-such-project'), null);
  var forged = executor.withProjectScope({ project: 'mythos-haddad', project_write_scope: ['projects/mythos-ai-executor'] });
  assert.strictEqual(forged.project_write_scope, undefined, 'a scope written into the task is dropped, never trusted');
  var widened = executor.withProjectScope({ project: 'oth-knowledge', project_write_scope: [''] });
  assert.deepStrictEqual(widened.project_write_scope, ['projects/oth-knowledge'], 'config wins over whatever the task carries');
});

t('S1b the executor\'s ONLY provider launch goes through withProjectScope', function () {
  var src = fs.readFileSync(path.join(EXEC, 'executor.js'), 'utf8');
  var launches = src.match(/provider\.run\(/g) || [];
  assert.strictEqual(launches.length, 1, 'exactly one provider launch site');
  assert.ok(/return provider\.run\(withProjectScope\(task\), prompt/.test(src), 'and it passes the config-derived scope');
});

t('S2 in-project work passes exactly as before', function () {
  var d = ws('in-project');
  return runAs('oth-knowledge', d, [call('w', 'write_file', { path: 'projects/oth-knowledge/seeds/x.json', content: '{}' }), say(report())]).then(function (o) {
    assert.strictEqual(o.validation.passed, true, JSON.stringify(o.validations));
    assert.deepStrictEqual(o.validation.evidence.project_scope, ['projects/oth-knowledge']);
    assert.deepStrictEqual(o.validation.evidence.out_of_project, []);
  });
});

t('S3 a write outside the project is refused AT THE TOOL, and the file is untouched', function () {
  var d = ws('tool-refusal');
  return runAs('oth-knowledge', d, [
    call('w1', 'write_file', { path: 'projects/mythos-ai-executor/executor.js', content: '// hijacked\n' }),
    call('w2', 'write_file', { path: 'projects/oth-knowledge/seeds/x.json', content: '{}' }),
    say(report())
  ]).then(function (o) {
    assert.ok(toolResults(o).some(function (c) { return /outside this project/.test(c); }), 'the model is told at the write');
    assert.strictEqual(fs.readFileSync(path.join(d, 'projects', 'mythos-ai-executor', 'executor.js'), 'utf8'), '// original\n');
    assert.strictEqual(o.validation.passed, true, 'the in-project remainder still passes');
  });
});

t('S4 a SCRIPT that writes outside the project (bypassing the tool) is caught by the validator', function () {
  var d = ws('script-escape');
  var script = 'require("fs").writeFileSync("projects/mythos-ai-executor/executor.js","// via script\\n");require("fs").writeFileSync("projects/oth-knowledge/seeds/x.json","{}");';
  return runAs('oth-knowledge', d, [
    call('w1', 'write_file', { path: 'projects/oth-knowledge/do.js', content: script }),
    call('r1', 'run_command', { program: 'node', args: ['projects/oth-knowledge/do.js'] }),
    say(report()), say(report()), say(report())
  ]).then(function (o) {
    assert.strictEqual(o.validation.passed, false, 'rejected');
    var rej = (o.validations[0] || {}).rejections || [];
    assert.ok(rej.some(function (r) { return /^project: projects\/mythos-ai-executor\/executor\.js/.test(r); }), JSON.stringify(rej));
    assert.ok(o.validations[0].evidence.out_of_project.indexOf('projects/mythos-ai-executor/executor.js') !== -1);
  });
});

t('S5 the project scope INTERSECTS the declared one: a task that names an out-of-project path still cannot write it', function () {
  var d = ws('intersect');
  return runAs('oth-knowledge', d, [
    call('w1', 'write_file', { path: 'projects/mythos-ai-executor/executor.js', content: '// named by the issue\n' }),
    say(report()), say(report()), say(report())
  ], { constraints: ['Only change projects/mythos-ai-executor/executor.js'], required_tests: [] }).then(function (o) {
    assert.ok(toolResults(o).some(function (c) { return /outside this project/.test(c); }), 'refused at the tool despite the Issue naming it');
    assert.strictEqual(fs.readFileSync(path.join(d, 'projects', 'mythos-ai-executor', 'executor.js'), 'utf8'), '// original\n');
  });
});

t('S6 a project without write_scope is exactly as before: the same out-of-project write passes', function () {
  var d = ws('unscoped');
  return runAs('mythos-haddad', d, [
    call('w1', 'write_file', { path: 'projects/mythos-ai-executor/executor.js', content: '// fine here\n' }),
    call('w2', 'write_file', { path: 'projects/oth-knowledge/seeds/x.json', content: '{}' }),
    say(report())
  ]).then(function (o) {
    assert.strictEqual(o.validation.passed, true, JSON.stringify(o.validations));
    assert.deepStrictEqual(o.validation.evidence.project_scope, []);
  });
});

t('S7 the validator alone (no provider) rejects an out-of-project change', function () {
  var before = { files: {} }, after = { files: {} };
  var d = ws('validator-only');
  var b = work.snapshot(d);
  fs.writeFileSync(path.join(d, 'projects', 'mythos-ai-executor', 'executor.js'), '// changed\n');
  var v = work.validateWork({ report: { mythos_report: true, status: 'completed', summary: 's', files_changed: [], tests: [], commit: null },
    workspace: d, before: b, after: work.snapshot(d), checks: [], scope: [], projectScope: ['projects/oth-knowledge'], requiredFiles: [], runCommand: function () { return { exit_code: 0 }; } });
  assert.strictEqual(v.pass, false);
  assert.ok(v.rejections.some(function (r) { return /^project: /.test(r); }), JSON.stringify(v.rejections));
  void before; void after;
});

queue.reduce(function (c, s) { return c.then(s); }, Promise.resolve()).then(function () {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
