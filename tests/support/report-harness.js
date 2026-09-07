'use strict';
// =====================================================
// Test support — minimal executor harness for report tests
// tests/support/report-harness.js
//
// Runs real executor tasks through providers/mock.js so the Mission
// Report contract can be exercised end to end without launching a
// provider or consuming quota. It mirrors the environment
// tests/mythos-ai-executor-test.js establishes; the fixture root is under
// the home directory because the task schema refuses a /tmp working
// directory outright.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var BASE = path.join(__dirname, '..', '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIXTURES = path.join(os.homedir(), 'mythos-report-contract-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIXTURES, 'no-advisory-credential.env');
process.env.MYTHOS_RESOURCE_GUARD = 'off';
process.env.MYTHOS_SKILL_TRUST = 'off';
delete process.env.MYTHOS_MOCK_SCRIPT;

var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var mockProvider = require(path.join(EXEC, 'providers', 'mock'));

function cleanup() {
  try { fs.rmSync(FIXTURES, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

// Runs each case in order. `check(status, reportJson)` receives the
// persisted status and report.json; reportJson.__dir is the task
// directory so a case can read report.md too.
function run(cases) {
  return cases.reduce(function (chain, c) {
    return chain.then(function () {
      process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([c.script]);
      mockProvider.reset();
      var task = executor.createTask({
        project: 'executor-selftest',
        stage: 'REPORT-CONTRACT',
        instruction: 'report contract case: ' + c.name,
        provider: 'mock',
        report_to_git: false
      });
      return executor.runTask(task.task_id).then(function (st) {
        var rep = state.readJSON(task.task_id, 'report.json') || {};
        rep.__dir = path.dirname(state.taskFile(task.task_id, 'report.json'));
        c.check(st, rep);
      });
    });
  }, Promise.resolve()).then(cleanup, function (e) { cleanup(); throw e; });
}

module.exports = { run: run, FIXTURES: FIXTURES };
