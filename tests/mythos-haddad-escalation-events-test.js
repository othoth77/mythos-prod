'use strict';
// =====================================================
// MYTHOS V3.1 — escalation facts reach the event stream
// tests/mythos-haddad-escalation-events-test.js
//
// The supervising provider records its escalation decisions in the tool
// trace; the console reads per-task events.log. This pins the seam between
// them: executor.recordProviderEvents() turns trace entries into executor
// events with structured keys only, bounded, and never fails a task.
// Run with: node tests/mythos-haddad-escalation-events-test.js
// =====================================================
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
process.env.MYTHOS_EXECUTOR_HOME = fs.mkdtempSync(path.join(os.homedir(), 'haddad-esc-events-'));
var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var executor = require(path.join(EXEC, 'executor.js'));
var state = require(path.join(EXEC, 'lib', 'state.js'));
var telemetry = require(path.join(__dirname, '..', 'projects', 'mythos-haddad', 'bin', 'haddad-telemetry.js'));

var pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + e.message); } }
function events(id) {
  var p = path.join(process.env.MYTHOS_EXECUTOR_HOME, 'tasks', id, 'events.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
}
function mkTask(id) { fs.mkdirSync(path.join(process.env.MYTHOS_EXECUTOR_HOME, 'tasks', id), { recursive: true }); }

t('E1 escalation, diagnosis and report_turn trace entries become events with structured keys only', function () {
  mkTask('t-esc-events-e1');
  var n = executor.recordProviderEvents('t-esc-events-e1', { tool_trace: [
    { tool: 'read_file', target: 'a.js', refused: false },
    { tool: 'escalation', refused: false, detail: 'tier requested standard, used standard (auto:balanced→sonnet score=2 [execution_profile:repo-write+2])' },
    { tool: 'diagnose', refused: false, target: 'claude' },
    { tool: 'escalation', refused: false, detail: 'tier requested deep, used deep (auto:balanced→sonnet score=2)' },
    { tool: 'diagnose', refused: true, target: 'claude', detail: 'diagnoser exit 1: boom' },
    { tool: 'report_turn', refused: false, detail: 'constrained json_schema report turn answered (192 chars)' }
  ] });
  assert.strictEqual(n, 5, 'five events written, the tool call is not one');
  var ev = events('t-esc-events-e1');
  assert.deepStrictEqual(ev.map(function (e) { return e.event; }), ['escalation', 'diagnosis', 'escalation', 'diagnosis', 'report_turn']);
  assert.strictEqual(ev[0].reason, 'requested=standard used=standard');
  assert.strictEqual(ev[2].reason, 'requested=deep used=deep');
  assert.strictEqual(ev[1].reason, 'answered'); assert.strictEqual(ev[1].model, 'claude');
  assert.strictEqual(ev[3].reason, 'refused');
  assert.strictEqual(ev[4].reason, 'answered');
  ev.forEach(function (e) {
    assert.ok(e.ts && e.task_id === 't-esc-events-e1', 'ts and task_id present');
    assert.ok(!('detail' in e) && !('summary' in e) && !('error' in e), 'no free text field leaks into the stream: ' + JSON.stringify(e));
    var keys = Object.keys(e).filter(function (k) { return ['ts', 'task_id', 'event', 'reason', 'model', 'attempt'].indexOf(k) === -1; });
    assert.deepStrictEqual(keys, [], 'structured keys only');
  });
});

t('E2 bounded: a long trace writes at most MAX_PROVIDER_EVENTS events; no trace writes none; a missing outcome is harmless', function () {
  mkTask('t-esc-events-e2');
  var trace = []; for (var i = 0; i < 40; i++) trace.push({ tool: 'diagnose', refused: false, target: 'claude' });
  assert.strictEqual(executor.recordProviderEvents('t-esc-events-e2', { tool_trace: trace }), 12);
  assert.strictEqual(events('t-esc-events-e2').length, 12);
  mkTask('t-esc-events-e3');
  assert.strictEqual(executor.recordProviderEvents('t-esc-events-e3', { tool_trace: [{ tool: 'write_file' }] }), 0);
  assert.strictEqual(executor.recordProviderEvents('t-esc-events-e3', null), 0);
  assert.strictEqual(executor.recordProviderEvents('t-esc-events-e3', {}), 0);
  assert.strictEqual(events('t-esc-events-e3').length, 0);
});

t('E3 the telemetry agent renders them: severity from the table, detail from the structured keys, and the page vocabulary knows all three', function () {
  assert.strictEqual(telemetry.severityFor({ event: 'escalation' }), 'WARNING');
  assert.strictEqual(telemetry.severityFor({ event: 'diagnosis' }), 'INFO');
  assert.strictEqual(telemetry.severityFor({ event: 'report_turn' }), 'INFO');
  var ev = events('t-esc-events-e1');
  assert.strictEqual(telemetry.eventDetail(ev[2]), 'reason=requested=deep used=deep');
  assert.strictEqual(telemetry.eventDetail(ev[1]), 'reason=answered model=claude');
});

try { fs.rmSync(process.env.MYTHOS_EXECUTOR_HOME, { recursive: true, force: true }); } catch (e) { /* best effort */ }
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
