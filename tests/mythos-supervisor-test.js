'use strict';
// =====================================================
// MYTHOS — autonomous supervisor tests (offline E2E + units)
// tests/mythos-supervisor-test.js
//
// Deterministic and offline. The REAL supervisor, bridge contract, brain and
// advisor run against a simulated world:
//   * GitHub      — an in-memory Issue tracker (fault injection: dropped
//                   create responses, truncated/missing reports);
//   * the bridge  — a simulator that behaves like the live Issues adapter
//                   (created/claimed/report markers, rerun label, report
//                   files on the control branch) and parses every Issue with
//                   the REAL bridge parser (bridge/github-issues.js
//                   issueToTask), so the Issue format is proven compatible;
//   * FABLE       — a scripted executor (success, failure, crash, timeout,
//                   human approval);
//   * OpenAI      — the REAL advisor with a scripted Responses-API transport,
//                   so every decision passes the real schema/secret gates.
// Every network entry point throws; HOME and every store are throwaway.
//
// Run with: node tests/mythos-supervisor-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var crypto = require('crypto');
var http = require('http');
var https = require('https');
var net = require('net');
var tls = require('tls');

var BASE = path.join(__dirname, '..');
var ORCH = path.join(BASE, 'projects', 'mythos-orchestrator');

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-supervisor-test-'));
var SAVED = { HOME: process.env.HOME, ORCH: process.env.MYTHOS_ORCHESTRATOR_HOME, SUP: process.env.MYTHOS_SUPERVISOR_HOME };
process.env.HOME = path.join(TMP, 'home');
process.env.MYTHOS_ORCHESTRATOR_HOME = path.join(TMP, 'orch');
fs.mkdirSync(process.env.HOME, { recursive: true });

var blocked = 0;
function guard(name) { return function () { blocked++; throw Object.assign(new Error('NETWORK_BLOCKED_IN_TEST: ' + name), { code: 'NETWORK_BLOCKED' }); }; }
https.request = guard('https.request'); https.get = guard('https.get');
http.request = guard('http.request'); http.get = guard('http.get');
net.connect = guard('net.connect'); net.createConnection = guard('net.createConnection'); tls.connect = guard('tls.connect');

var MAIN_STARTED = false;
var UNCAUGHT = [];
process.on('uncaughtException', function (e) {
  if (!MAIN_STARTED) { console.log('  FAIL suite did not load: ' + String(e && (e.stack || e.message)).split('\n').slice(0, 3).join(' | ')); console.log('\nMYTHOS supervisor: 0 passed, 1 failed'); process.exit(1); }
  UNCAUGHT.push(String(e && (e.code || e.message)).slice(0, 120));
});

var states = require(path.join(ORCH, 'supervisor', 'states.js'));
var store = require(path.join(ORCH, 'supervisor', 'store.js'));
var bridgeMod = require(path.join(ORCH, 'supervisor', 'bridge.js'));
var monitorMod = require(path.join(ORCH, 'supervisor', 'monitor.js'));
var brainMod = require(path.join(ORCH, 'supervisor', 'brain.js'));
var supMod = require(path.join(ORCH, 'supervisor', 'supervisor.js'));
var ghMod = require(path.join(ORCH, 'supervisor', 'gh.js'));
var advisor = require(path.join(ORCH, 'advisor.js'));
var schemaLib = require(path.join(ORCH, 'lib', 'schema.js'));
var githubIssues = require(path.join(BASE, 'projects', 'mythos-ai-executor', 'bridge', 'github-issues.js'));

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function section(t) { console.log('\n' + t); }

var FAKE_KEY = ['s', 'k', '-', 'proj-'].join('') + crypto.randomBytes(24).toString('hex');
var KEY_FILE = path.join(process.env.HOME, '.config', 'mythos-orchestrator', 'openai.env');
fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
fs.writeFileSync(KEY_FILE, 'OPENAI_API_KEY=' + FAKE_KEY + '\n', { mode: 0o600 });

var BASE_CFG = JSON.parse(fs.readFileSync(path.join(ORCH, 'config', 'supervisor.json'), 'utf8'));

// ---------------------------------------------------------------------------
// Simulated world: GitHub + bridge + executor (FABLE)
// ---------------------------------------------------------------------------
function World(script) {
  this.issues = {};
  this.next = 100;
  this.control = {};
  this.exec = {};
  this.script = script || function () { return { kind: 'success' }; };
  this.faults = {};
  this.offset = 0;
  this.daemonActive = true;
  this.creates = 0;
}

World.prototype.gh = function () {
  var w = this;
  function issueView(i) { return { number: i.number, title: i.title, body: i.body, state: i.state, html_url: 'https://github.test/i/' + i.number, labels: i.labels.map(function (n) { return { name: n }; }) }; }
  return {
    createIssue: function (repo, title, body, labels) {
      var n = w.next++;
      w.creates++;
      w.issues[n] = { number: n, title: title, body: body, labels: labels.slice(), state: 'open', comments: [], attempt: 0 };
      if (w.faults.dropCreate) { w.faults.dropCreate--; return Promise.resolve({ ok: false, error: { code: 'GH_TIMEOUT' } }); }
      return Promise.resolve({ ok: true, data: issueView(w.issues[n]) });
    },
    getIssue: function (repo, n) {
      var i = w.issues[n];
      return Promise.resolve(i ? { ok: true, data: issueView(i) } : { ok: false, error: { code: 'GH_NOT_FOUND', status: 404 } });
    },
    listComments: function (repo, n) {
      var i = w.issues[n];
      if (!i) return Promise.resolve({ ok: false, error: { code: 'GH_NOT_FOUND' } });
      return Promise.resolve({ ok: true, data: i.comments.map(function (c, k) { return { id: k + 1, body: c.body, created_at: c.at }; }) });
    },
    comment: function (repo, n, body) { w.issues[n].comments.push({ body: body, at: new Date().toISOString(), by: 'supervisor' }); return Promise.resolve({ ok: true, data: {} }); },
    addLabels: function (repo, n, labels) {
      labels.forEach(function (l) { if (w.issues[n].labels.indexOf(l) === -1) w.issues[n].labels.push(l); });
      return Promise.resolve({ ok: true, data: [] });
    },
    close: function (repo, n, reason) { w.issues[n].state = 'closed'; w.issues[n].close_reason = reason; return Promise.resolve({ ok: true, data: {} }); },
    recentTaskIssues: function (repo, label) {
      return Promise.resolve({ ok: true, data: Object.keys(w.issues).map(function (k) { return w.issues[k]; })
        .filter(function (i) { return i.labels.indexOf(label) !== -1; }).reverse().map(issueView) });
    },
    controlFile: function (repo, branch, file) {
      var text = w.control[file];
      if (text === undefined) return Promise.resolve({ ok: false, error: { code: 'GH_NOT_FOUND', status: 404 } });
      if (w.faults.truncateReports) return Promise.resolve({ ok: true, data: text.slice(0, Math.floor(text.length / 2)) });
      return Promise.resolve({ ok: true, data: text });
    }
  };
};

World.prototype.monitor = function () {
  var w = this;
  return {
    observe: function (bt) {
      var e = w.exec[bt] || null;
      var t = e ? { task_id: e.id, stage: 'github:' + bt, status: e.status, effective: e.effective, retry_count: e.retry, last_error: e.last_error || null } : null;
      return Promise.resolve({
        monitor_state: monitorMod.classify(t, w.daemonActive), executor_task_id: t ? t.task_id : null,
        executor_status: t ? t.status : null, executor_effective: t ? t.effective : null, retry_count: t ? t.retry : null,
        daemon_active: w.daemonActive, resources: { mem_available_mib: 3000, load1: 0.5 }
      });
    },
    resources: function () { return { mem_available_mib: 3000, load1: 0.5 }; }
  };
};

var ISSUES_CFG = githubIssues.config();

function mark(fields) { return '<!-- mythos-control ' + Object.keys(fields).map(function (k) { return k + '=' + fields[k]; }).join(' ') + ' -->'; }

World.prototype.post = function (i, fields, text) { i.comments.push({ body: mark(fields) + '\n' + (text || ''), at: new Date().toISOString(), by: 'bridge' }); };

World.prototype.writeReport = function (i, tid, status, extra, markerStatus) {
  var report = Object.assign({ protocol: 'mythos-control/1', task_id: tid, status: status, summary: 'executor summary for ' + tid,
    files_changed: [], commits: [], tests: [], validation: { git_verified: true, report_problems: [], required_checks: [] },
    problems: [], risks: [], next_recommended_action: 'none', execution: { execution_profile: 'repo-read', executor_task_id: 't-' + tid } }, extra || {});
  if (!this.faults.withholdReports) this.control['control/reports/' + tid + '.json'] = JSON.stringify(report, null, 2);
  this.post(i, { task_id: tid, event: 'report', status: markerStatus || status });
};

// One bridge tick + one executor step, for every open task Issue.
World.prototype.step = function () {
  var w = this;
  Object.keys(w.issues).forEach(function (k) {
    var i = w.issues[k];
    if (i.state !== 'open' || i.labels.indexOf('task') === -1) return;
    var tid = i.attempt ? githubIssues.issueTaskId(i.number, i.attempt) : null;
    var e = tid ? w.exec[tid] : null;
    if (!i.attempt || (i.labels.indexOf('rerun') !== -1 && e && e.done)) {
      var parsed = githubIssues.issueToTask(ISSUES_CFG, { number: i.number, title: i.title, body: i.body, html_url: 'https://github.test/i/' + i.number, labels: i.labels.map(function (n) { return { name: n }; }) }, (i.attempt || 0) + 1);
      i.parsed = parsed;
      if (!parsed.task) {
        if (!i.rejected) { i.rejected = true; w.post(i, { issue: i.number, event: 'rejected', hash: 'x' }); }
        return;
      }
      i.attempt = (i.attempt || 0) + 1;
      i.labels = i.labels.filter(function (l) { return l !== 'rerun'; });
      tid = githubIssues.issueTaskId(i.number, i.attempt);
      w.post(i, { task_id: tid, event: 'created' });
      w.exec[tid] = { id: 't-' + tid, status: 'QUEUED', effective: 'QUEUED', retry: 0, steps: 0, done: false, plan: w.script(i, i.attempt, w), task: parsed.task };
      return;
    }
    if (!e || e.done) return;
    if (e.status === 'QUEUED') { e.status = e.effective = 'RUNNING'; w.post(i, { task_id: tid, event: 'claimed' }); return; }
    e.steps++;
    var p = e.plan;
    function finish(status, extra, markerStatus) { e.done = true; e.status = e.effective = (status === 'COMPLETED' ? 'COMPLETED' : status); w.writeReport(i, tid, status, extra, markerStatus); }
    if (p.kind === 'success') return finish('COMPLETED', { summary: p.summary || 'done: ' + tid, tests: ['node tests/x-test.js: 5 passed, 0 failed'] });
    if (p.kind === 'failed') return finish('FAILED', { summary: p.summary || 'tests failed', problems: [p.problem || 'node tests/x-test.js: 3 passed, 2 failed'] });
    if (p.kind === 'human') return finish('BLOCKED', { summary: 'owner decision required: protected path' }, 'HUMAN_APPROVAL');
    if (p.kind === 'crash_then_success') {
      if (e.steps === 1) { e.effective = 'INTERRUPTED'; return; }
      if (e.steps === 2) { e.status = e.effective = 'WAITING_RETRY'; e.retry = 1; e.last_error = 'execution interrupted (process gone)'; return; }
      if (e.steps === 3) { e.status = e.effective = 'RUNNING'; return; }
      return finish('COMPLETED', { summary: 'done after an interrupted execution was resumed', tests: ['ok'] });
    }
    if (p.kind === 'crash_exhaust') {
      if (e.steps % 2 === 1 && e.steps < 7) { e.effective = 'INTERRUPTED'; e.status = 'RUNNING'; return; }
      if (e.steps < 7) { e.status = e.effective = 'WAITING_RETRY'; e.retry++; e.last_error = 'execution interrupted (process gone)'; return; }
      return finish('FAILED', { summary: 'transient failures exceeded max_retries: execution interrupted (process gone)', blocker: { code: 'PROVIDER_FAILED', reason: 'retries exhausted' }, problems: ['process gone x4'] });
    }
    if (p.kind === 'timeout_exhaust') {
      if (e.steps < 3) { e.status = e.effective = 'WAITING_RETRY'; e.retry++; e.last_error = 'provider timed out after 60s'; return; }
      return finish('FAILED', { summary: 'transient failures exceeded max_retries: provider timed out', problems: ['timeout 60s x4'] });
    }
    if (p.kind === 'never_reports') { return; }
    return finish('COMPLETED', {});
  });
};

// ---------------------------------------------------------------------------
// Scripted OpenAI (through the REAL advisor)
// ---------------------------------------------------------------------------
function responseBody(obj) {
  return JSON.stringify({ status: 'completed', model: 'gpt-test', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(obj) }] }], usage: { input_tokens: 50, output_tokens: 20, total_tokens: 70 } });
}
function spec(extra) {
  return Object.assign({ title: 'Count orchestrator files', objective: 'Report how many JavaScript files exist under projects/mythos-orchestrator.',
    scope: ['projects/mythos-orchestrator/'], constraints: ['read-only'], validation: ['ls projects/mythos-orchestrator'],
    acceptance_criteria: ['the report states the number of .js files'], action: 'investigate', timeout_seconds: 600 }, extra || {});
}
function OpenAI(overrides) {
  var o = { calls: [], diag: 0, plan: null, review: null, diagnose: null };
  Object.assign(o, overrides || {});
  o.transport = function (req) {
    var role = req.body.text.format.schema.properties.role.enum[0];
    o.calls.push({ role: role, input: req.body.input });
    var input = req.body.input;
    var d;
    if (role === 'supervise_plan') {
      d = o.plan ? o.plan(input) : { schema_version: '1.0.0', role: role, task: spec(), risk_class: 'STATIC_ANALYSIS', requires_human_approval: false, human_reason: null, rationale: 'read-only' };
    } else if (role === 'supervise_review') {
      var good = /"status": "COMPLETED"/.test(input);
      d = o.review ? o.review(input, good) : { schema_version: '1.0.0', role: role, verdict: good ? 'ACCEPT' : 'REJECT',
        criteria: [{ criterion: 'the report states the number of .js files', met: good, evidence: good ? 'report says done' : 'no completed report' }],
        findings: good ? [] : ['not completed'], human_action: null, confidence: 'high' };
    } else {
      o.diag++;
      d = o.diagnose ? o.diagnose(input, o.diag) : { schema_version: '1.0.0', role: role, classification: 'TEST_FAILURE', diagnosis: 'the test step failed',
        recoverable: true, recovery_task: spec({ title: 'Recovery ' + o.diag, objective: 'Recovery attempt ' + o.diag + ': rerun the failing check with a narrower scope and report the evidence.' }),
        what_changes: 'narrower scope, attempt ' + o.diag, human_action: null, confidence: 'medium' };
    }
    return Promise.resolve({ status: 200, body: responseBody(d) });
  };
  return o;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
var scenarioN = 0;
function fresh(script, oaOverrides, cfgOverrides) {
  scenarioN++;
  process.env.MYTHOS_SUPERVISOR_HOME = path.join(TMP, 'sup-' + scenarioN);
  var w = new World(script);
  var oa = OpenAI(oaOverrides);
  var cfg = Object.assign({}, BASE_CFG, { claim_deadline_seconds: 600, report_wait_seconds: 300, stall_grace_seconds: 300 }, cfgOverrides || {});
  var gh = w.gh();
  function build() {
    return supMod.create({
      cfg: cfg,
      bridge: bridgeMod.create(gh, cfg),
      monitor: w.monitor(),
      brain: brainMod.create(cfg, { adviseOpts: { transport: oa.transport, keyFile: KEY_FILE } }),
      now: function () { return Date.now() + w.offset * 1000; }
    });
  }
  return { w: w, oa: oa, cfg: cfg, build: build, sup: build() };
}

async function runUntil(env, taskId, maxTicks, opts) {
  opts = opts || {};
  var t;
  for (var i = 0; i < maxTicks; i++) {
    env.w.step();
    var sup = opts.restartEachTick ? env.build() : env.sup;
    await sup.tick();
    if (opts.afterTick) opts.afterTick(i);
    t = store.loadTask(taskId);
    if (t && states.TERMINAL.indexOf(t.status) !== -1) return { t: t, ticks: i + 1 };
  }
  return { t: t, ticks: maxTicks };
}

function supComments(w, n, event) { return w.issues[n].comments.filter(function (c) { return c.body.indexOf('<!-- mythos-supervisor event=' + event + ' ') === 0; }); }
function allTasks() { return store.listTasks(); }

// ---------------------------------------------------------------------------
async function main() {
  MAIN_STARTED = true;

  section('0. Contracts');
  ['supervise-plan', 'supervise-review', 'supervise-diagnose'].forEach(function (name) {
    var sch = JSON.parse(fs.readFileSync(path.join(ORCH, 'schemas', name + '.schema.json'), 'utf8'));
    var subsetOk = true;
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      ['pattern', 'minLength', 'maxLength', 'minItems', 'maxItems', 'format', 'oneOf', 'anyOf', 'allOf'].forEach(function (kw) { if (kw in node) subsetOk = false; });
      if (node.type === 'object' || (Array.isArray(node.type) && node.type.indexOf('object') !== -1)) {
        if (node.additionalProperties !== false) subsetOk = false;
        var keys = Object.keys(node.properties || {}).sort();
        if (JSON.stringify(keys) !== JSON.stringify((node.required || []).slice().sort())) subsetOk = false;
        keys.forEach(function (k) { walk(node.properties[k]); });
      }
      if (node.items) walk(node.items);
    })(sch);
    ok(subsetOk, '00 ' + name + ' stays inside the strict structured-output subset');
    ok(advisor.schemaFor(sch.properties.role.enum[0]) !== null, '00 advisor maps role ' + sch.properties.role.enum[0] + ' to its schema');
  });
  var cfgAll = advisor.loadConfig();
  ok(cfgAll.valid && cfgAll.config.enabled === true && ['supervise_plan', 'supervise_review', 'supervise_diagnose'].every(function (r) { return cfgAll.config.roles[r]; }),
    '00 shipped OpenAI config is valid, enabled, and configures every supervisor role');

  section('1. State machine');
  var tt = { status: 'PLANNED', history: [] };
  var threw = false; try { states.transition(tt, 'COMPLETED', 'skip'); } catch (e) { threw = e.code === 'ILLEGAL_TRANSITION'; }
  ok(threw && tt.status === 'PLANNED', '01 PLANNED -> COMPLETED is illegal and changes nothing');
  var bt = { status: 'BLOCKED', history: [] }, threw2 = false;
  try { states.transition(bt, 'PLANNED', 'auto'); } catch (e) { threw2 = true; }
  ok(threw2, '01 only a person may leave BLOCKED');
  states.transition(bt, 'PLANNED', 'owner resumed', 'human');
  ok(bt.status === 'PLANNED' && bt.history.length === 1 && bt.history[0].actor === 'human', '01 a human resume is recorded with its actor');
  ok(states.TRANSITIONS.COMPLETED.length === 0, '01 COMPLETED is terminal');
  ok(states.STATES.join(',') === 'PLANNED,READY,WAITING,RUNNING,VERIFYING,FAILED,RECOVERY,COMPLETED,BLOCKED', '01 exactly the nine required states');

  section('2. Issue format is accepted by the REAL bridge parser');
  var t0 = { task_id: 'SUP-ABCDEFGH', correlation_id: 'COR-X', spec: spec({ action: 'test', timeout_seconds: 900, validation: ['node tests/x-test.js'] }) };
  var rendered = bridgeMod.renderIssue(t0, { execution_id: 'EXEC-1234567890' }, BASE_CFG);
  var parsed = githubIssues.issueToTask(ISSUES_CFG, { number: 7, title: rendered.title, body: rendered.body, html_url: 'https://github.test/i/7', labels: [{ name: 'task' }] }, 1);
  ok(parsed.task && !(parsed.errors || []).length, '02 the rendered Issue converts into a bridge task with no errors');
  ok(parsed.task && parsed.task.requested_action === 'test', '02 Action is read by the bridge (test)');
  ok(parsed.task && /Fable 5\.1|claude-fable-5-1|fable/i.test(JSON.stringify(parsed.task.model || parsed.task.model_raw || '')), '02 Model: Fable 5.1 reaches the task (FABLE is the executor)');
  ok(parsed.task && parsed.task.timeout_seconds === 900, '02 Timeout is read by the bridge');
  ok(parsed.task && (parsed.task.validation_requirements || []).join(' ').indexOf('node tests/x-test.js') !== -1, '02 Validation reaches the task');
  ok(rendered.body.indexOf('execution_id=EXEC-1234567890') !== -1, '02 the Issue carries the execution_id marker used for idempotency');

  section('3. E2E-1 SUCCESS: objective → plan → GitHub → bridge → FABLE → report → OpenAI verification → COMPLETED');
  var e1 = fresh();
  var r1t = e1.sup.submitObjective({ objective: 'Report how many JavaScript files exist under projects/mythos-orchestrator.' });
  var r1 = await runUntil(e1, r1t.task_id, 12);
  ok(r1.t.status === 'COMPLETED', '03 the task COMPLETES (' + r1.ticks + ' ticks)');
  var iss1 = e1.w.issues[r1.t.issue_number];
  ok(iss1 && iss1.state === 'closed' && iss1.close_reason === 'completed', '03 the GitHub Issue is closed as completed');
  ok(supComments(e1.w, r1.t.issue_number, 'verified').length === 1, '03 exactly one verification comment');
  ok(e1.w.creates === 1 && r1.t.executions.length === 1 && r1.t.attempt_count === 1, '03 one Issue, one execution, one attempt');
  ok(e1.oa.calls.map(function (c) { return c.role; }).join(',') === 'supervise_plan,supervise_review', '03 OpenAI planned once and verified once');
  var tr1 = store.readJournal(function (e) { return e.correlation_id === r1.t.correlation_id; }).map(function (e) { return e.event; });
  ['objective_submitted', 'planned', 'dispatched', 'bridge_task_bound', 'settled', 'reviewed'].forEach(function (ev) { ok(tr1.indexOf(ev) !== -1, '03 trace contains ' + ev); });
  var ex1 = r1.t.executions[0];
  ok(ex1.bridge_task_id === 'gh-issue-' + r1.t.issue_number && ex1.executor_task_id === 't-' + ex1.bridge_task_id && /^EXEC-/.test(ex1.execution_id) && /^COR-/.test(r1.t.correlation_id),
    '03 task_id, correlation_id, execution_id, bridge task and executor task are all linked');

  section('4. Success exit is not success: a COMPLETED report that fails review does not complete');
  var e1b = fresh(null, { review: function (input) { return { schema_version: '1.0.0', role: 'supervise_review', verdict: 'REJECT', criteria: [{ criterion: 'count stated', met: false, evidence: 'the report does not state a number' }], findings: ['missing count'], human_action: null, confidence: 'high' }; } }, { max_recoveries_per_root: 0 });
  var r1bt = e1b.sup.submitObjective({ objective: 'Report how many JavaScript files exist under projects/mythos-orchestrator.' });
  var r1b = await runUntil(e1b, r1bt.task_id, 12);
  ok(r1b.t.status === 'BLOCKED' && e1b.w.issues[r1b.t.issue_number].state === 'open', '04 a rejected review never closes the Issue (blocked here only because recovery is disabled)');
  ok(r1b.t.history.some(function (h) { return h.to === 'FAILED' && /REVIEW_REJECTED/.test(h.reason); }), '04 the review rejection is an explicit FAILED transition');

  section('5. E2E-2 FABLE FAILURE → diagnosis → recovery task → verification → original COMPLETED');
  var e2 = fresh(function (i, attempt) { return /Recovery/.test(i.title) ? { kind: 'success' } : { kind: 'failed' }; });
  var r2t = e2.sup.submitObjective({ objective: 'Run the orchestrator test suite and report the result.' });
  var r2 = await runUntil(e2, r2t.task_id, 30);
  ok(r2.t.status === 'COMPLETED', '05 the ORIGINAL task completes after recovery (' + r2.ticks + ' ticks)');
  var child2 = store.loadTask(r2t.task_id + '-R1');
  ok(child2 && child2.status === 'COMPLETED' && child2.parent_task_id === r2t.task_id && child2.root_task_id === r2t.task_id && child2.correlation_id === r2t.correlation_id,
    '05 recovery task ' + r2t.task_id + '-R1 is COMPLETED and linked (parent, root, correlation)');
  ok(child2 && e2.w.issues[child2.issue_number].body.indexOf('Recovery for: #' + r2.t.issue_number) !== -1, '05 the recovery Issue links its parent Issue');
  ok(supComments(e2.w, r2.t.issue_number, 'recovery').length === 1 && supComments(e2.w, r2.t.issue_number, 'recovery_dispatched').length === 1, '05 the parent Issue records the diagnosis and the dispatched recovery');
  ok(e2.w.issues[r2.t.issue_number].state === 'closed' && e2.w.issues[child2.issue_number].state === 'closed', '05 both Issues closed only after verification');
  ok(e2.oa.calls.some(function (c) { return c.role === 'supervise_diagnose'; }) && r2.t.decisions.some(function (d) { return d.kind === 'diagnosis'; }), '05 the recovery was based on an OpenAI diagnosis');
  ok(r2.t.history.map(function (h) { return h.to; }).join('>').indexOf('FAILED>RECOVERY>VERIFYING>COMPLETED') !== -1, '05 parent path FAILED → RECOVERY → VERIFYING → COMPLETED');

  section('6. E2E-3 FABLE CRASH: detected, executor resumes, task completes');
  var e3 = fresh(function () { return { kind: 'crash_then_success' }; });
  var r3t = e3.sup.submitObjective({ objective: 'Report how many JavaScript files exist under projects/mythos-orchestrator.' });
  var r3 = await runUntil(e3, r3t.task_id, 15);
  var monEvents3 = store.readJournal(function (e) { return e.task_id === r3t.task_id && e.event === 'monitor'; }).map(function (e) { return e.monitor_state; });
  ok(monEvents3.indexOf('FABLE_CRASHED') !== -1, '06 the crash was detected (FABLE_CRASHED)');
  ok(monEvents3.indexOf('FABLE_RETRYING') !== -1 && r3.t.history.some(function (h) { return h.to === 'WAITING'; }), '06 the resumed retry was observed (WAITING while the executor retried)');
  ok(r3.t.status === 'COMPLETED' && r3.t.executions[0].crashes_seen === 1, '06 the task resumed and COMPLETED; one crash recorded');

  section('7. E2E-3b FABLE CRASH exhausting retries → crash diagnosis → recovery → original COMPLETED');
  var e3b = fresh(function (i) { return /Recovery/.test(i.title) ? { kind: 'success' } : { kind: 'crash_exhaust' }; },
    { diagnose: function (input, n) { return { schema_version: '1.0.0', role: 'supervise_diagnose', classification: 'CRASH', diagnosis: 'the executor process died repeatedly (resources ok)', recoverable: true, recovery_task: spec({ title: 'Recovery crash ' + n, objective: 'Recovery: repeat the report with a smaller read scope so the execution completes quickly.' }), what_changes: 'smaller scope', human_action: null, confidence: 'medium' }; } });
  var r3bt = e3b.sup.submitObjective({ objective: 'Report how many JavaScript files exist under projects/mythos-orchestrator.' });
  var r3b = await runUntil(e3b, r3bt.task_id, 40);
  ok(r3b.t.status === 'COMPLETED' && store.loadTask(r3bt.task_id + '-R1').status === 'COMPLETED', '07 crash → CRASH diagnosis → recovery → original COMPLETED');
  var diagIn = e3b.oa.calls.filter(function (c) { return c.role === 'supervise_diagnose'; })[0];
  ok(diagIn && /FABLE_CRASHED|crashes_seen/.test(diagIn.input) && /mem_available_mib/.test(diagIn.input), '07 the diagnosis received the crash evidence and system resources');

  section('8. E2E-4 BRIDGE FAILURE: truncated / lost responses never become success');
  var e4 = fresh(function (i) { return { kind: 'success' }; }, null, { max_recoveries_per_root: 0 });
  e4.w.faults.truncateReports = true;
  var r4t = e4.sup.submitObjective({ objective: 'Report how many JavaScript files exist under projects/mythos-orchestrator.' });
  var r4 = await runUntil(e4, r4t.task_id, 15);
  ok(r4.t.status !== 'COMPLETED' && !r4.t.history.some(function (h) { return h.to === 'VERIFYING'; }), '08 a truncated report never reaches VERIFYING or COMPLETED');
  ok(r4.t.history.some(function (h) { return h.to === 'FAILED' && /BRIDGE_FAILURE/.test(h.reason) && /unreadable/.test(h.reason); }), '08 truncation becomes a deterministic BRIDGE_FAILURE');
  ok(e4.oa.calls.filter(function (c) { return c.role === 'supervise_review'; }).length === 0, '08 no verification was attempted on an unreadable report');
  var e4b = fresh(function (i) { return /Recovery/.test(i.title) ? { kind: 'success' } : { kind: 'success' }; },
    { diagnose: function (input, n) { return { schema_version: '1.0.0', role: 'supervise_diagnose', classification: 'BRIDGE_FAILURE', diagnosis: 'the report never reached GitHub', recoverable: true, recovery_task: spec({ title: 'Recovery bridge ' + n, objective: 'Recovery: produce the same report again so a readable copy reaches the control branch.' }), what_changes: 'fresh attempt with the relay healthy', human_action: null, confidence: 'medium' }; } });
  e4b.w.faults.withholdReports = true;
  var r4bt = e4b.sup.submitObjective({ objective: 'Report how many JavaScript files exist under projects/mythos-orchestrator.' });
  var r4b;
  for (var k = 0; k < 40; k++) {
    e4b.w.step();
    await e4b.sup.tick();
    r4b = store.loadTask(r4bt.task_id);
    if (r4b.status === 'WAITING' && !e4b.w._advanced) { e4b.w._advanced = true; e4b.w.offset += 400; }
    if (r4b.status === 'RECOVERY') e4b.w.faults.withholdReports = false; // relay healthy again
    if (states.TERMINAL.indexOf(r4b.status) !== -1) break;
  }
  ok(r4b.history.some(function (h) { return h.to === 'WAITING' && /waiting for the relay/.test(h.reason); }), '08 a report marker without the report file waits (WAITING), it is not success');
  ok(r4b.history.some(function (h) { return h.to === 'FAILED' && /never reached GitHub/.test(h.reason); }), '08 after the deadline the lost report is an explicit FAILED');
  ok(r4b.status === 'COMPLETED', '08 the task stayed recoverable and COMPLETED through a recovery task');
  var e4c = fresh();
  e4c.w.faults.dropCreate = 1;
  var r4ct = e4c.sup.submitObjective({ objective: 'Report how many JavaScript files exist under projects/mythos-orchestrator.' });
  var r4c = await runUntil(e4c, r4ct.task_id, 12);
  ok(e4c.w.creates === 1 && r4c.t.status === 'COMPLETED', '08 a create response lost AFTER GitHub created the Issue is adopted by marker — no duplicate Issue');
  ok(store.readJournal(function (e) { return e.task_id === r4ct.task_id && e.event === 'dispatch_adopted'; }).length === 1, '08 the adoption is recorded');

  section('9. E2E-5 RESTART: a new supervisor process every tick; no duplicates');
  var e5 = fresh(function (i) { return /Recovery/.test(i.title) ? { kind: 'success' } : { kind: 'failed' }; });
  var r5t = e5.sup.submitObjective({ objective: 'Run the orchestrator test suite and report the result.' });
  var r5 = await runUntil(e5, r5t.task_id, 30, { restartEachTick: true });
  ok(r5.t.status === 'COMPLETED', '09 the task completes across ' + r5.ticks + ' process restarts');
  ok(e5.w.creates === 2, '09 exactly two Issues (task + one recovery) — no duplicate after any restart');
  var disp5 = store.readJournal(function (e) { return e.correlation_id === r5.t.correlation_id && (e.event === 'dispatched' || e.event === 'dispatch_adopted'); });
  ok(disp5.length === 2, '09 exactly two dispatches (task, recovery) across the restarts — the parent was verified from the recovery evidence');
  var settles5 = store.readJournal(function (e) { return e.correlation_id === r5.t.correlation_id && e.event === 'settled'; });
  var settleKeys = settles5.map(function (e) { return e.execution_id; });
  ok(settleKeys.length === new Set(settleKeys).size, '09 every execution settled exactly once');
  // settle-once and lock, directly
  var e5b = fresh();
  var t5b = e5b.sup.submitObjective({ objective: 'Report how many JavaScript files exist under projects/mythos-orchestrator.' });
  var fake = store.loadTask(t5b.task_id);
  var ex5 = { execution_id: 'EXEC-TEST', settled: false };
  fake.executions.push(ex5);
  var s1 = e5b.sup._internal.settle(fake, ex5, { kind: 'REPORT', status: 'COMPLETED' });
  var s2 = e5b.sup._internal.settle(fake, ex5, { kind: 'REPORT', status: 'FAILED' });
  ok(s1 === true && s2 === false && ex5.outcome.status === 'COMPLETED', '09 a second settlement is ignored (settle-once)');
  var rel = store.acquireLock();
  var tk = await e5b.sup.tick();
  ok(rel && tk.ran === false, '09 a concurrent tick is refused while another holds the lock');
  rel();
  // crash between settlement and routing
  var e5c = fresh();
  var t5c = e5c.sup.submitObjective({ objective: 'Report how many JavaScript files exist under projects/mythos-orchestrator.' });
  for (var j = 0; j < 4; j++) { e5c.w.step(); await e5c.sup.tick(); }
  var mid = store.loadTask(t5c.task_id);
  var exm = mid.executions[0];
  if (mid.status !== 'VERIFYING' && mid.status !== 'COMPLETED') { exm.settled = true; exm.outcome = { kind: 'REPORT', status: 'COMPLETED' }; store.saveTask(mid); }
  var r5c = await runUntil(e5c, t5c.task_id, 10);
  ok(r5c.t.status === 'COMPLETED', '09 a crash between settling and routing does not strand the task');

  section('10. E2E-6 LOOP PROTECTION: the same failure with no progress → BLOCKED, finite');
  var WAYS = ['narrow the scope to the failing module only', 'check the missing dependency before running', 'run the single failing test in verbose mode', 'inspect the test fixtures for stale data'];
  var e6 = fresh(function () { return { kind: 'failed', problem: 'node tests/x-test.js: 3 passed, 2 failed' }; },
    { diagnose: function (input, n) { return { schema_version: '1.0.0', role: 'supervise_diagnose', classification: 'TEST_FAILURE', diagnosis: 'the test step failed', recoverable: true,
      recovery_task: spec({ title: 'Recovery: ' + WAYS[(n - 1) % WAYS.length], objective: 'Recovery: ' + WAYS[(n - 1) % WAYS.length] + ', then report the evidence.' }), what_changes: WAYS[(n - 1) % WAYS.length], human_action: null, confidence: 'medium' }; } });
  var r6t = e6.sup.submitObjective({ objective: 'Run the orchestrator test suite and report the result.' });
  var r6 = await runUntil(e6, r6t.task_id, 60);
  ok(r6.t.status === 'BLOCKED' && r6.ticks < 60, '10 the loop stops in ' + r6.ticks + ' ticks with BLOCKED');
  var all6 = allTasks();
  var loop6 = all6.filter(function (t) { return t.blocked && t.blocked.code === 'LOOP_NO_PROGRESS'; })[0];
  ok(!!loop6, '10 the deepest task is BLOCKED with LOOP_NO_PROGRESS [codes: ' + all6.map(function (t) { return t.task_id.replace(/^SUP-[A-Z0-9]+/, 'T') + '=' + t.status + (t.blocked ? ':' + t.blocked.code : ''); }).join(', ') + ']');
  if (!loop6) loop6 = all6[all6.length - 1];
  ok(loop6 && loop6.blocked.why && loop6.blocked.human_action && loop6.blocked.tried.length && loop6.blocked.evidence && typeof loop6.blocked.attempts === 'number',
    '10 the block records why, attempts, what was tried, evidence and the required human action');
  ok(e6.w.creates <= 1 + BASE_CFG.max_recoveries_per_root, '10 bounded GitHub activity: ' + e6.w.creates + ' Issues');
  ok(all6.every(function (t) { return t.status === 'BLOCKED' || t.status === 'COMPLETED'; }), '10 nothing is left running or silently retrying');
  ok(supComments(e6.w, loop6.issue_number, 'blocked').length === 1, '10 the BLOCKED reason is posted on the Issue once');
  var e6b = fresh(function () { return { kind: 'failed' }; },
    { diagnose: function (input, n) { return { schema_version: '1.0.0', role: 'supervise_diagnose', classification: 'TEST_FAILURE', diagnosis: 'same', recoverable: true, recovery_task: spec({ title: 'Same fix', objective: 'Apply the same fix again and report the result of the test.' }), what_changes: 'nothing', human_action: null, confidence: 'low' }; } },
    { same_failure_limit: 99 });
  var r6bt = e6b.sup.submitObjective({ objective: 'Run the orchestrator test suite and report the result.' });
  await runUntil(e6b, r6bt.task_id, 60);
  ok(allTasks().some(function (t) { return t.blocked && t.blocked.code === 'REPEATED_RECOVERY'; }), '10 a diagnosis that repeats an already-run recovery is refused (REPEATED_RECOVERY)');

  section('11. Human and safety boundaries');
  var e7 = fresh(function () { return { kind: 'human' }; });
  var r7t = e7.sup.submitObjective({ objective: 'Change the protected governance files as described in the handover.' });
  var r7 = await runUntil(e7, r7t.task_id, 12);
  ok(r7.t.status === 'BLOCKED' && r7.t.blocked.code === 'HUMAN_APPROVAL', '11 an executor HUMAN_APPROVAL stop becomes BLOCKED (never auto-approved)');
  ok(e7.oa.calls.filter(function (c) { return c.role === 'supervise_diagnose'; }).length === 0 && e7.w.creates === 1, '11 no diagnosis and no recovery task for an owner decision');
  var e8 = fresh(null, { plan: function () { return { schema_version: '1.0.0', role: 'supervise_plan', task: spec({ action: 'implement' }), risk_class: 'PRODUCTION_DEPLOYMENT', requires_human_approval: false, human_reason: null, rationale: 'deploy' }; } });
  var r8t = e8.sup.submitObjective({ objective: 'Deploy the new release of the status center to production.' });
  var r8 = await runUntil(e8, r8t.task_id, 5);
  ok(r8.t.status === 'BLOCKED' && r8.t.blocked.code === 'HUMAN_APPROVAL_REQUIRED' && e8.w.creates === 0, '11 approval-class work is BLOCKED before any Issue exists');
  var e9 = fresh();
  var secretErr = null;
  try { e9.sup.submitObjective({ objective: 'Use the key ' + FAKE_KEY + ' to call the API and report.' }); } catch (e) { secretErr = e; }
  for (var z = 0; z < 3; z++) { e9.w.step(); await e9.sup.tick(); }
  ok(secretErr && secretErr.code === 'SECRET_IN_OBJECTIVE' && allTasks().length === 0 && e9.oa.calls.length === 0 && e9.w.creates === 0,
    '11 a secret in the objective is refused at submission: nothing stored, nothing sent to OpenAI or GitHub');
  ok(secretErr && String(secretErr.message).indexOf(FAKE_KEY) === -1, '11 the refusal names the kind, never the value');
  var e10 = fresh(null, null, { max_openai_calls_per_root: 1 });
  var r10t = e10.sup.submitObjective({ objective: 'Report how many JavaScript files exist under projects/mythos-orchestrator.' });
  var r10 = await runUntil(e10, r10t.task_id, 12);
  ok(r10.t.status === 'BLOCKED' && /BUDGET/.test(r10.t.blocked.why) && e10.oa.calls.length === 1, '11 the OpenAI call budget is enforced (blocked, not exceeded)');
  var e11 = fresh(function () { return { kind: 'never_reports' }; }, null, { max_recoveries_per_root: 0 });
  var r11t = e11.sup.submitObjective({ objective: 'Report how many JavaScript files exist under projects/mythos-orchestrator.' });
  for (var q = 0; q < 6; q++) { e11.w.step(); await e11.sup.tick(); }
  e11.w.daemonActive = false;
  e11.w.offset += 100;
  for (q = 0; q < 2; q++) { e11.w.step(); await e11.sup.tick(); }
  e11.w.offset += 400;
  var r11 = await runUntil(e11, r11t.task_id, 4);
  ok(r11.t.history.some(function (h) { return h.to === 'FAILED' && /FABLE_UNREACHABLE/.test(h.reason); }), '11 an unreachable executor daemon is its own failure (FABLE_UNREACHABLE)');

  section('12. GitHub transport (real spawn, stub gh binary)');
  var stub = path.join(TMP, 'gh-stub.js');
  fs.writeFileSync(stub, "#!/usr/bin/env node\nvar m=process.env.STUB_MODE;\nif(m==='slow'){setTimeout(function(){},60000);}\nelse if(m==='partial'){process.stdout.write('{\"number\": 1, \"title\": \"x');}\nelse if(m==='notfound'){process.stderr.write('gh: Not Found (HTTP 404)');process.exit(1);}\nelse if(m==='big'){var s='x'.repeat(1024*1024);for(var i=0;i<10;i++)process.stdout.write(s);}\nelse{process.stdout.write('{\"number\": 5}');}\n", { mode: 0o755 });
  process.env.MYTHOS_SUPERVISOR_GH_BIN = stub;
  var g = ghMod.create({ timeoutMs: 800 });
  process.env.STUB_MODE = 'ok'; var gOk = await g.getIssue('o/r', 5);
  process.env.STUB_MODE = 'slow'; var t0s = Date.now(); var gSlow = await g.getIssue('o/r', 5); var slowMs = Date.now() - t0s;
  process.env.STUB_MODE = 'partial'; var gPart = await g.getIssue('o/r', 5);
  process.env.STUB_MODE = 'notfound'; var gNf = await g.getIssue('o/r', 5);
  process.env.STUB_MODE = 'big'; var gBig = await g.getIssue('o/r', 5);
  delete process.env.MYTHOS_SUPERVISOR_GH_BIN; delete process.env.STUB_MODE;
  ok(gOk.ok && gOk.data.number === 5, '12 a normal answer parses');
  ok(!gSlow.ok && gSlow.error.code === 'GH_TIMEOUT' && slowMs < 3000, '12 a hung gh is killed at the hard deadline (' + slowMs + ' ms)');
  ok(!gPart.ok && gPart.error.code === 'GH_MALFORMED', '12 a truncated answer is GH_MALFORMED, never success');
  ok(!gNf.ok && gNf.error.code === 'GH_NOT_FOUND' && gNf.error.status === 404, '12 HTTP 404 is recognised');
  ok(!gBig.ok && gBig.error.code === 'GH_OUTPUT_TOO_LARGE', '12 oversized output is refused');

  section('13. Hygiene');
  var everything = JSON.stringify(allTasks()) + fs.readFileSync(path.join(process.env.MYTHOS_SUPERVISOR_HOME, 'journal.jsonl'), 'utf8');
  ok(everything.indexOf(FAKE_KEY) === -1, '13 no task file or journal line contains the key');
  ok(blocked === 0, '13 no network entry point was ever reached');
  ok(UNCAUGHT.length === 0, '13 no uncaught exception' + (UNCAUGHT.length ? ' [' + UNCAUGHT.join('; ') + ']' : ''));
}

main().catch(function (e) {
  fail++;
  console.log('  FAIL unexpected exception: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
}).then(function () {
  ['HOME', 'ORCH', 'SUP'].forEach(function (k) {
    var name = { HOME: 'HOME', ORCH: 'MYTHOS_ORCHESTRATOR_HOME', SUP: 'MYTHOS_SUPERVISOR_HOME' }[k];
    if (SAVED[k] === undefined) delete process.env[name]; else process.env[name] = SAVED[k];
  });
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  console.log('\nMYTHOS supervisor: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
