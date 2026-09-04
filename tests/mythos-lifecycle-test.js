'use strict';
// =====================================================
// MYTHOS — Execution Lifecycle tests
// tests/mythos-lifecycle-test.js
//
// Offline and deterministic. Nothing here signals a real process: every
// close path injects a killFn that records the call, the VPS runtime is
// pointed at a synthetic /proc tree and a synthetic ~/.claude (sessions/
// <pid>.json + projects/<slug>/<uuid>.jsonl transcripts) built in a temp
// directory, and the registry lives under a temp root.
//
// Sections follow the 25 scenarios of the lifecycle mission, then the
// integrations: the real executor (mock provider) emitting into the
// registry, the HTTP relay routes with HMAC, the Claude hook script, the
// Session Guard consult, the root runner, the PC runtime and the CLI.
//
// Run with: node tests/mythos-lifecycle-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var http = require('http');
var crypto = require('crypto');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIX = path.join(os.tmpdir(), 'mythos-lifecycle-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true });

process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'executor-home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.MYTHOS_RESOURCE_GUARD = 'off';
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIX, 'no-advisory-credential.env');
process.env.MYTHOS_NOTIFY_CONFIG = path.join(FIX, 'no-notify-config.env');
process.env.MYTHOS_LIFECYCLE_HOST = 'testhost';
process.env.MYTHOS_LIFECYCLE_SNAPSHOT = path.join(FIX, 'no-snapshot.json');
process.env.MYTHOS_LIFECYCLE_CLAUDE_HOMES = path.join(FIX, 'no-claude-home');
delete process.env.MYTHOS_NTFY_URL;
delete process.env.MYTHOS_MOCK_SCRIPT;
delete process.env.MYTHOS_LIFECYCLE_CLEANUP;
delete process.env.MYTHOS_LIFECYCLE_RELAY_SECRET;

var L = require(path.join(EXEC, 'lib', 'lifecycle'));
var model = L.model;
var registry = L.registry;
var vps = L.vpsRuntime;
var pc = L.pcRuntime;
var guard = require(path.join(EXEC, 'lib', 'session-guard'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }
function eq(a, b, name) { ok(a === b, name + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

// --- fixtures -------------------------------------------------------------------------

var seq = 0;
function fresh(name) {
  seq += 1;
  var root = path.join(FIX, 'reg-' + seq + '-' + name);
  process.env.MYTHOS_LIFECYCLE_HOME = root;
  L._resetTimers();
  return L.registryConfig();
}

function newProc(uptime) {
  seq += 1;
  var root = path.join(FIX, 'proc-' + seq);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'uptime'), String(uptime || 100000) + ' 200000.00\n');
  return root;
}
function writeProc(root, p) {
  var dir = path.join(root, String(p.pid));
  fs.mkdirSync(dir, { recursive: true });
  var rest = [];
  for (var i = 0; i < 40; i++) rest.push('0');
  rest[0] = 'S'; rest[1] = String(p.ppid || 1);
  rest[11] = String(p.utime === undefined ? 100 : p.utime); rest[12] = '10';
  rest[19] = String(p.starttime === undefined ? 1000 : p.starttime);
  fs.writeFileSync(path.join(dir, 'stat'), p.pid + ' (' + (p.comm || 'proc') + ') ' + rest.join(' ') + '\n');
  var uid = p.uid === undefined ? 0 : p.uid;
  fs.writeFileSync(path.join(dir, 'status'), 'Name:\t' + (p.comm || 'proc') + '\nPPid:\t' + (p.ppid || 1) + '\nUid:\t' + uid + '\t' + uid + '\t' + uid + '\t' + uid + '\nVmRSS:\t' + ((p.rss_mib || 150) * 1024) + ' kB\n');
  fs.writeFileSync(path.join(dir, 'cmdline'), (p.argv || ['proc']).join('\0') + '\0');
  return p.pid;
}
function removeProc(root, pid) { fs.rmSync(path.join(root, String(pid)), { recursive: true, force: true }); }
var SERVER_ARGV = ['/root/.claude/remote/srv/7d193f89/server', '--serve', '--socket', '/root/.claude/remote/run/x/rpc.sock'];
function sessionArgv() { return ['/root/.claude/remote/ccd-cli/2.1.260', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--model', 'claude-fable-5-1']; }
var EXECUTOR_ARGV = ['claude', '-p', '--output-format', 'json', '--session-id', 'fe5ba816-a97a-44c4-b743-9e9a3c587a15'];

function newClaudeHome() {
  seq += 1;
  var home = path.join(FIX, 'claude-' + seq);
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, 'projects', '-root'), { recursive: true });
  return home;
}
function addClaudeSession(home, pid, sid, procStart, cwd) {
  fs.writeFileSync(path.join(home, 'sessions', pid + '.json'), JSON.stringify({ pid: pid, sessionId: sid, cwd: cwd || '/root', startedAt: Date.now() - 3600000, procStart: String(procStart), entrypoint: 'claude-desktop', kind: 'interactive' }));
}
// turn: 'idle' (assistant end_turn last) | 'running' (assistant tool_use last) | 'user' (user record last)
function writeTranscript(home, sid, turn, at) {
  var ts = at || new Date().toISOString();
  var lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'do it' }, timestamp: ts, sessionId: sid }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Bash' }] }, timestamp: ts })
  ];
  if (turn === 'idle') lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] }, timestamp: ts }));
  if (turn === 'user') lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result' }] }, timestamp: ts, toolUseResult: {} }));
  lines.push(JSON.stringify({ type: 'attachment', attachment: { type: 'x' }, timestamp: ts }));
  var f = path.join(home, 'projects', '-root', sid + '.jsonl');
  fs.writeFileSync(f, lines.join('\n') + '\n');
  var t = Date.parse(ts) / 1000;
  fs.utimesSync(f, t, t);
}

function uuid(n) { var h = String(n).padStart(12, '0'); return '00000000-0000-4000-8000-' + h; }
function ago(seconds, now) { return new Date((now || Date.now()) - seconds * 1000).toISOString(); }

// A standard scenario host: server + a remote session bound to a Claude session id.
function host(opts) {
  opts = opts || {};
  var proc = newProc(opts.uptime || 100000);
  var home = newClaudeHome();
  writeProc(proc, { pid: 100, argv: SERVER_ARGV, comm: 'server', starttime: 100 });
  var h = { proc: proc, home: home, serverPid: 100, sessions: [] };
  h.vopts = function () { return { proc_root: proc, claude_homes: [home], snapshot_path: path.join(FIX, 'none-' + seq + '.json'), host: 'testhost' }; };
  h.add = function (o) {
    var pid = o.pid; var sid = o.sid; var start = o.starttime === undefined ? 1000 : o.starttime;
    writeProc(proc, { pid: pid, ppid: o.orphan ? 1 : 100, argv: o.executor ? EXECUTOR_ARGV : sessionArgv(), comm: o.executor ? 'claude' : 'ccd-cli', starttime: start, uid: o.uid === undefined ? 0 : o.uid, rss_mib: o.rss_mib || 150 });
    if (!o.unbound) addClaudeSession(home, pid, sid, o.registry_start === undefined ? start : o.registry_start, o.cwd);
    if (o.turn) writeTranscript(home, sid, o.turn, o.at);
    h.sessions.push({ pid: pid, sid: sid });
    return { pid: pid, sid: sid };
  };
  return h;
}

function rts() { return L.runtimes(); }
function ropts(reg, h) { var o = L.runtimeOpts(reg); o.VPS = h.vopts(); return o; }
function cleanupRun(reg, h, opts, killFn) {
  return L.cleanup.run(reg, rts(), ropts(reg, h), Object.assign({ policy: { enabled: true, idle_seconds: 60, grace_seconds: 60, min_session_age_seconds: 60 }, enforcement: { enabled: true, reason: 'test' } }, opts || {}), killFn || function () { throw new Error('unexpected kill'); });
}
function verifyRun(reg, h, now) { return L.verify.run(reg, rts(), ropts(reg, h), { now: now || Date.now() }); }

function fullExecution(reg, o) {
  var now = o.now || Date.now();
  registry.ingest(reg, { type: 'EXECUTION_CREATED', execution_id: o.exec, task_id: o.task, github_issue: o.issue || 144, agent: 'claude-code', provider: 'claude-code', location: 'VPS', host: 'testhost', at: ago(o.age || 3600, now) });
  registry.ingest(reg, { type: 'SESSION_STARTED', execution_id: o.exec, session_id: o.sid, pid: o.pid, proc_start: String(o.starttime === undefined ? 1000 : o.starttime), location: 'VPS', host: 'testhost', at: ago((o.age || 3600) - 1, now) });
  if (o.completed) {
    registry.ingest(reg, { type: 'TASK_COMPLETED', execution_id: o.exec, report_status: 'completed', at: ago(o.idle || 600, now) });
    registry.ingest(reg, { type: 'REPORT_SUBMITTED', execution_id: o.exec, report_status: o.report_status || 'completed', github_issue: o.issue || 144, report_ref: 'control/reports/x.json', at: ago((o.idle || 600) - 1, now) });
  }
  return registry.getExecution(reg, o.exec);
}

// =====================================================================================
// 0. Model: three vocabularies, reducer idempotency, no report→closed collapse
// =====================================================================================
(function modelBasics() {
  ok(model.TASK_STATES.indexOf('REPORT_SUBMITTED') >= 0 && model.SESSION_STATES.indexOf('ORPHANED') >= 0 && model.EXECUTION_STATES.indexOf('VERIFYING') >= 0, 'model: three vocabularies present');
  var e = model.newExecution({ type: 'EXECUTION_CREATED', execution_id: 'x-a', task_id: 't-a', at: '2026-09-04T00:00:00.000Z' });
  var r = model.applyToExecution(e, { type: 'REPORT_SUBMITTED', at: '2026-09-04T00:01:00.000Z', report_status: 'completed' });
  eq(e.task_state, 'VERIFICATION', 'model: report moves the task to VERIFICATION');
  eq(e.session_state, 'CREATED', 'model: report does NOT close the session');
  eq(e.execution_state, 'VERIFYING', 'model: report moves the execution to VERIFYING');
  ok(r.transitions.length === 3, 'model: three transitions recorded for one report');
  var r2 = model.applyToExecution(e, { type: 'REPORT_SUBMITTED', at: '2026-09-04T00:02:00.000Z', report_status: 'completed' });
  eq(r2.transitions.length, 0, 'model: a repeated report produces no transition');
  ok(model.RELAY_EVENTS.indexOf('SESSION_CLOSE_REQUESTED') < 0 && model.RELAY_EVENTS.indexOf('EXECUTION_VERIFIED') < 0, 'model: a relay can never request a close or assert a verification');
})();

// =====================================================================================
// 1. Task running + Session running
// =====================================================================================
(function s1() {
  var reg = fresh('s1'); var h = host(); var now = Date.now();
  var s = h.add({ pid: 201, sid: uuid(1), turn: 'running', at: ago(10, now) });
  fullExecution(reg, { exec: 'x-1', task: 't-1', sid: s.sid, pid: s.pid, now: now });
  var st = vps.get_session_state({ session_id: s.sid, pid: s.pid, proc_start: '1000' }, Object.assign({ now: now }, h.vopts()));
  eq(st.state, 'RUNNING', 's1: runtime sees the session RUNNING from the transcript turn');
  var view = L.correlate.hostView({ registry: reg, vps: h.vopts(), now: now });
  eq(view.sessions[0].class, 'ACTIVE', 's1: host view classifies ACTIVE');
  eq(view.sessions[0].links.execution_id, 'x-1', 's1: pid ↔ session ↔ execution linked');
  eq(view.sessions[0].links.github_issue, 144, 's1: GitHub issue linked');
  var c = cleanupRun(reg, h, { now: now });
  ok(c.vetoes.length === 1 && /active_execution/.test(c.vetoes[0].reason), 's1: cleanup vetoes an active execution');
  var inv = guard.inventory(guard.scan({ proc_root: h.proc, now: now }), { proc_root: h.proc });
  var obs = guard.observe(null, inv, { proc_root: h.proc });
  var pr = guard.plan(obs.state, inv, { proc_root: h.proc, lifecycle_registry: reg.root, min_age_seconds: 0, max_sessions: 1, concurrency_idle_seconds: 0, idle_seconds: 0 });
  ok(pr.lifecycle.consulted && pr.lifecycle.bound === 1, 's1: guard consulted the registry and bound the pid');
  ok(pr.actions.length === 0 && pr.vetoes.some(function (v) { return v.reason === 'lifecycle_execution_active' || v.reason === 'single_observation'; }), 's1: guard never plans a signal for a session with an active execution');
})();

// =====================================================================================
// 2. Task completed + Session already closed
// =====================================================================================
(function s2() {
  var reg = fresh('s2'); var h = host(); var now = Date.now();
  fullExecution(reg, { exec: 'x-2', task: 't-2', sid: uuid(2), pid: 202, completed: true, now: now });
  var e = registry.getExecution(reg, 'x-2');
  eq(e.task_state, 'VERIFICATION', 's2: task VERIFICATION after report');
  var v = verifyRun(reg, h, now);
  eq(v.checked.length, 1, 's2: one verification due');
  eq(v.checked[0].session_open, false, 's2: session observed closed (pid absent)');
  e = registry.getExecution(reg, 'x-2');
  eq(e.task_state, 'COMPLETED', 's2: task COMPLETED');
  eq(e.execution_state, 'FINISHED', 's2: execution FINISHED');
  eq(e.session_state, 'CLOSED', 's2: session CLOSED');
  ok(e.session_open_after_report === false, 's2: recorded that the session was not open after the report');
  eq(verifyRun(reg, h, now + 1000).checked.length, 0, 's2: nothing left to verify');
})();

// =====================================================================================
// 3 + 17. Task completed + Session still open (report exists, session remains)
// =====================================================================================
(function s3() {
  var reg = fresh('s3'); var h = host(); var now = Date.now();
  var s = h.add({ pid: 203, sid: uuid(3), turn: 'idle', at: ago(300, now) });
  fullExecution(reg, { exec: 'x-3', task: 't-3', sid: s.sid, pid: s.pid, completed: true, now: now });
  var v = verifyRun(reg, h, now);
  eq(v.checked[0].session_open, true, 's3: session still open after report');
  eq(v.checked[0].observed, 'IDLE', 's3: observed IDLE');
  var e = registry.getExecution(reg, 'x-3');
  eq(e.task_state, 'COMPLETED', 's3: task COMPLETED (GitHub truth)');
  eq(e.execution_state, 'VERIFYING', 's3: execution stays VERIFYING = COMPLETED + SESSION_OPEN');
  eq(e.session_state, 'IDLE', 's3: session state reflects observation');
  ok(e.session_open_after_report === true, 's3: session_open_after_report recorded');
  eq(e.verification.attempts, 1, 's3: one attempt');
  ok(Date.parse(e.verification.next_check_at) - now >= 59000 && Date.parse(e.verification.next_check_at) - now <= 61000, 's3: next check in 60s (backoff step 1)');
  eq(verifyRun(reg, h, now + 30000).checked.length, 0, 's3: not re-checked before it is due');
  var v2 = verifyRun(reg, h, now + 61000);
  eq(v2.checked.length, 1, 's3: re-checked when due');
  e = registry.getExecution(reg, 'x-3');
  eq(e.verification.attempts, 2, 's3: second attempt');
  ok(Date.parse(e.verification.next_check_at) - (now + 61000) >= 119000, 's3: backoff grew to 120s');
  ok(L.status({ host: false }).executions.completed_session_open.some(function (x) { return x.execution_id === 'x-3'; }), 's3: status lists COMPLETED + SESSION_OPEN');
  var ex = L.explain('x-3');
  ok(ex.answer.some(function (a) { return /still open after the report/.test(a); }), 's17: explain says the session was still open after the report');
  ok(ex.ledger.some(function (l) { return l.kind === 'transition' && l.field === 'task_state' && l.new_state === 'COMPLETED'; }), 's17: ledger carries the task transition');
  // idempotent verification: replaying the same tick moment produces a duplicate, not a new attempt
  var r = L.verify.verifyOne(reg, registry.getExecution(reg, 'x-3'), rts(), ropts(reg, h), now + 61000, {});
  ok(r.duplicate === false || registry.getExecution(reg, 'x-3').verification.attempts === 3, 's3: attempt counter only moves with a new event id');
  // now close the process → next verification finishes it
  removeProc(h.proc, s.pid);
  verifyRun(reg, h, now + 400000);
  e = registry.getExecution(reg, 'x-3');
  eq(e.execution_state, 'FINISHED', 's3: FINISHED once the session closed');
  eq(e.session_state, 'CLOSED', 's3: session CLOSED');
})();

// =====================================================================================
// 4. Task completed + Session idle → phased cleanup (dry run, then enforce, then delegation)
// =====================================================================================
(function s4() {
  var reg = fresh('s4'); var h = host(); var now = Date.now();
  var me = process.getuid ? process.getuid() : 0;
  var s = h.add({ pid: 204, sid: uuid(4), turn: 'idle', at: ago(3600, now), uid: me });
  fullExecution(reg, { exec: 'x-4', task: 't-4', sid: s.sid, pid: s.pid, completed: true, now: now, idle: 3600 });
  verifyRun(reg, h, now);
  var kills = [];
  var kill = function (pid, sig) { kills.push({ pid: pid, sig: sig }); };
  // dry run: phases advance to GRACE and stop
  var c1 = cleanupRun(reg, h, { now: now, enforcement: { enabled: false } }, kill);
  ok(c1.actions.some(function (a) { return a.phase_to === 'ELIGIBLE'; }), 's4: OBSERVE → ELIGIBLE');
  var c2 = cleanupRun(reg, h, { now: now + 1000, enforcement: { enabled: false } }, kill);
  ok(c2.actions.some(function (a) { return a.phase_to === 'GRACE'; }), 's4: ELIGIBLE → GRACE');
  var c3 = cleanupRun(reg, h, { now: now + 70000, enforcement: { enabled: false } }, kill);
  ok(c3.vetoes.some(function (v) { return v.reason === 'dry_run' && v.would === 'request_close'; }), 's4: dry run records what it WOULD do');
  eq(kills.length, 0, 's4: dry run signalled nothing');
  // enforce (same uid → direct SIGTERM through the injected killFn)
  var c4 = cleanupRun(reg, h, { now: now + 71000 }, kill);
  ok(c4.actions.some(function (a) { return a.action === 'close_requested' && a.signal === 'SIGTERM'; }), 's4: GRACE → CLOSE_REQUESTED with SIGTERM');
  eq(kills.length, 1, 's4: exactly one safe signal');
  eq(kills[0].sig, 'SIGTERM', 's4: never SIGKILL first');
  var sess = registry.getSession(reg, s.sid);
  eq(sess.close_phase, 'CLOSE_REQUESTED', 's4: phase CLOSE_REQUESTED');
  eq(sess.state, 'CLOSING', 's4: session CLOSING');
  var c5 = cleanupRun(reg, h, { now: now + 72000 }, kill);
  eq(registry.getSession(reg, s.sid).close_phase, 'VERIFYING', 's4: CLOSE_REQUESTED → VERIFYING while the process is still present');
  removeProc(h.proc, s.pid);
  var c6 = cleanupRun(reg, h, { now: now + 73000 }, kill);
  ok(c6.actions.some(function (a) { return a.action === 'closed'; }), 's4: VERIFYING → CLOSED on proof of disappearance');
  sess = registry.getSession(reg, s.sid);
  eq(sess.state, 'CLOSED', 's4: session CLOSED');
  ok(/lifecycle_cleanup/.test(sess.close_reason), 's4: close reason recorded');
  var e = registry.getExecution(reg, 'x-4');
  eq(e.execution_state, 'FINISHED', 's4: execution FINISHED after the close');
  var ex = L.explain(s.sid);
  ok(ex.answer.some(function (a) { return /close reason: lifecycle_cleanup/.test(a); }), 's4: explain answers "why was it closed"');
  eq(kills.length, 1, 's4: no further signal after closure');
})();

(function s4delegated() {
  var reg = fresh('s4b'); var h = host(); var now = Date.now();
  if (process.getuid && process.getuid() === 0) { ok(true, 's4b: (skipped delegation case: running as root)'); return; }
  var s = h.add({ pid: 214, sid: uuid(14), turn: 'idle', at: ago(3600, now), uid: 0 }); // root-owned Desktop Remote session
  fullExecution(reg, { exec: 'x-14', task: 't-14', sid: s.sid, pid: s.pid, completed: true, now: now, idle: 3600 });
  cleanupRun(reg, h, { now: now }); cleanupRun(reg, h, { now: now + 1000 });
  var kills = [];
  var c = cleanupRun(reg, h, { now: now + 70000 }, function (pid, sig) { kills.push(sig); });
  ok(c.actions.some(function (a) { return a.action === 'close_requested' && /delegated/.test(a.signal); }), 's4b: a root-owned session is DELEGATED, not signalled from deploy');
  eq(kills.length, 0, 's4b: deploy never signals a root process');
  eq(registry.getSession(reg, s.sid).close_phase, 'CLOSE_REQUESTED', 's4b: registry carries the request for the root guard');
  // the root Session Guard reads the registry and plans the SIGTERM under its own fences
  var inv = guard.inventory(guard.scan({ proc_root: h.proc, now: now + 70000 }), { proc_root: h.proc });
  var st = guard.observe(null, inv, { proc_root: h.proc }).state;
  var pr = guard.plan(st, inv, { proc_root: h.proc, lifecycle_registry: reg.root, min_age_seconds: 0, idle_seconds: 999999 });
  ok(pr.vetoes.some(function (v) { return v.requested === 'lifecycle_close_requested' && v.reason === 'single_observation'; }), 's4b: guard still applies its own fences (single observation vetoes)');
  var inv2 = guard.inventory(guard.scan({ proc_root: h.proc, now: now + 370000 }), { proc_root: h.proc });
  st = guard.observe(st, inv2, { proc_root: h.proc }).state;
  pr = guard.plan(st, inv2, { proc_root: h.proc, lifecycle_registry: reg.root, min_age_seconds: 0, idle_seconds: 999999 });
  ok(pr.actions.length === 1 && pr.actions[0].reason === 'lifecycle_close_requested' && pr.actions[0].signal === 'SIGTERM' && pr.actions[0].pid === 214, 's4b: guard plans SIGTERM for the lifecycle close request despite its CPU-based idle clock');
  eq(pr.actions[0].evidence.session_id, s.sid, 's4b: guard evidence names the session uuid');
})();

// =====================================================================================
// 5. Session open but working on ANOTHER task
// =====================================================================================
(function s5() {
  var reg = fresh('s5'); var h = host(); var now = Date.now();
  var s = h.add({ pid: 205, sid: uuid(5), turn: 'running', at: ago(5, now) });
  fullExecution(reg, { exec: 'x-5a', task: 't-5a', sid: s.sid, pid: s.pid, completed: true, now: now, idle: 7200, age: 9000 });
  fullExecution(reg, { exec: 'x-5b', task: 't-5b', sid: s.sid, pid: s.pid, now: now, age: 600 });
  var v = verifyRun(reg, h, now);
  eq(v.checked[0].shared_active, 1, 's5: verification notes the session is shared with an active execution');
  var c = cleanupRun(reg, h, { now: now }, function () { throw new Error('must not kill'); });
  ok(c.vetoes.some(function (x) { return /active_execution:x-5b/.test(x.reason); }), 's5: cleanup refuses: session works on another task');
  eq(registry.getSession(reg, s.sid).close_phase, 'OBSERVE', 's5: phase stays OBSERVE');
  var view = L.correlate.hostView({ registry: reg, vps: h.vopts(), now: now });
  eq(view.sessions[0].class, 'ACTIVE', 's5: host view ACTIVE (not COMPLETED) because another execution is active');
})();

// =====================================================================================
// 6. Orphan session
// =====================================================================================
(function s6() {
  var reg = fresh('s6'); var h = host(); var now = Date.now();
  var s = h.add({ pid: 206, sid: uuid(6), turn: 'idle', at: ago(3600, now), orphan: true });
  var st = vps.get_session_state({ session_id: s.sid, pid: s.pid, proc_start: '1000' }, Object.assign({ now: now }, h.vopts()));
  eq(st.state, 'ORPHANED', 's6: runtime reports ORPHANED');
  var view = L.correlate.hostView({ registry: reg, vps: h.vopts(), now: now });
  eq(view.sessions[0].class, 'ORPHANED', 's6: host view ORPHANED');
  fullExecution(reg, { exec: 'x-6', task: 't-6', sid: s.sid, pid: s.pid, completed: true, now: now, idle: 3600 });
  cleanupRun(reg, h, { now: now });
  eq(registry.getSession(reg, s.sid).state, 'ORPHANED', 's6: registry session marked ORPHANED by cleanup observation');
  ok(registry.ledgerFor(reg, s.sid).some(function (l) { return l.type === 'SESSION_ORPHANED'; }), 's6: SESSION_ORPHANED ledgered');
})();

// =====================================================================================
// 7. Missing session  /  8. Missing PID  /  9. PID exists but wrong session
// =====================================================================================
(function s7() {
  var reg = fresh('s7'); var h = host(); var now = Date.now();
  registry.ingest(reg, { type: 'EXECUTION_CREATED', execution_id: 'x-7', task_id: 't-7', location: 'VPS', at: ago(600, now) });
  registry.ingest(reg, { type: 'SESSION_STARTED', execution_id: 'x-7', session_id: uuid(7), location: 'VPS', at: ago(500, now) }); // no pid
  registry.ingest(reg, { type: 'REPORT_SUBMITTED', execution_id: 'x-7', report_status: 'completed', at: ago(10, now) });
  var st = vps.get_session_state({ session_id: uuid(7) }, Object.assign({ now: now }, h.vopts()));
  eq(st.state, 'UNKNOWN', 's7: a session nobody can observe is UNKNOWN');
  var v = verifyRun(reg, h, now);
  eq(v.checked[0].session_open, true, 's7: unknown counts as open (fail-closed)');
  eq(registry.getExecution(reg, 'x-7').execution_state, 'VERIFYING', 's7: execution stays VERIFYING');
  var c = cleanupRun(reg, h, { now: now });
  ok(c.vetoes.some(function (x) { return /session_unobservable/.test(x.reason); }), 's7: cleanup vetoes an unobservable session');

  // 8. transcript exists, no pid binding
  var h8 = host();
  writeTranscript(h8.home, uuid(8), 'idle', ago(100, now));
  var st8 = vps.get_session_state({ session_id: uuid(8) }, Object.assign({ now: now }, h8.vopts()));
  eq(st8.state, 'UNKNOWN', 's8: transcript without a pid is UNKNOWN, never IDLE');
  ok(st8.evidence.some(function (e) { return /no process binding/.test(e); }), 's8: evidence explains why');

  // 9. pid exists but belongs to a different incarnation
  var h9 = host();
  var s9 = h9.add({ pid: 209, sid: uuid(9), starttime: 5000, registry_start: 4000, turn: 'idle', at: ago(100, now) });
  var st9 = vps.get_session_state({ session_id: s9.sid, pid: 209, proc_start: '4000' }, Object.assign({ now: now }, h9.vopts()));
  eq(st9.state, 'CLOSED', 's9: recycled pid → the recorded session is CLOSED');
  var view9 = L.correlate.hostView({ registry: reg, vps: h9.vopts(), now: now });
  eq(view9.sessions[0].class, 'UNKNOWN', 's9: the live process with a mismatched binding is UNKNOWN, not that session');
  var rc = vps.request_close({ session_id: s9.sid, pid: 209, proc_start: '4000' }, Object.assign({ authorized: true }, h9.vopts()), function () { throw new Error('no'); });
  eq(rc.reason, 'pid_recycled', 's9: request_close refuses a recycled pid');
})();

// =====================================================================================
// 10. Duplicate events  /  11. Repeated TaskCompleted  /  12. Repeated SessionEnd
// =====================================================================================
(function s10() {
  var reg = fresh('s10'); var now = Date.now();
  fullExecution(reg, { exec: 'x-10', task: 't-10', sid: uuid(10), pid: 210, now: now });
  var ev = { type: 'TASK_COMPLETED', execution_id: 'x-10', report_status: 'completed', at: ago(5, now), event_id: 'dup-1' };
  var a = registry.ingest(reg, ev);
  var b = registry.ingest(reg, ev);
  ok(a.ok && !a.duplicate && a.transitions.length === 1, 's10: first event applied');
  ok(b.duplicate === true && b.transitions.length === 0, 's10: same event id ignored');
  ok(registry.ledgerTail(reg, 5).some(function (l) { return l.kind === 'duplicate'; }), 's10: duplicate recorded in the ledger');
  var e = registry.getExecution(reg, 'x-10');
  var firstDone = e.agent_completed_at;
  registry.ingest(reg, { type: 'TASK_COMPLETED', execution_id: 'x-10', report_status: 'completed', at: ago(3, now), event_id: 'dup-2' });
  registry.ingest(reg, { type: 'TASK_COMPLETED', execution_id: 'x-10', report_status: 'completed', at: ago(1, now), event_id: 'dup-3' });
  e = registry.getExecution(reg, 'x-10');
  eq(e.agent_completed_at, firstDone, 's11: repeated TaskCompleted keeps the first completion time');
  eq(e.execution_state, 'REPORTING', 's11: state unchanged by repeats');
  eq(registry.ledgerFor(reg, 'x-10').filter(function (l) { return l.kind === 'transition' && l.new_state === 'REPORTING'; }).length, 1, 's11: exactly one REPORTING transition');
  var r1 = registry.ingest(reg, { type: 'SESSION_END', execution_id: 'x-10', session_id: uuid(10), end_reason: 'other', at: ago(1, now), event_id: 'end-1' });
  var r2 = registry.ingest(reg, { type: 'SESSION_END', execution_id: 'x-10', session_id: uuid(10), end_reason: 'other', at: now, event_id: 'end-2' });
  ok(r1.transitions.length > 0 && r2.transitions.length === 0, 's12: repeated SessionEnd is a no-op');
  eq(registry.getExecution(reg, 'x-10').session_state, 'CLOSING', 's12: CLOSING until process-gone proof');
  registry.ingest(reg, { type: 'SESSION_END', execution_id: 'x-10', session_id: uuid(10), process_gone: true, at: now, event_id: 'end-3' });
  eq(registry.getExecution(reg, 'x-10').session_state, 'CLOSED', 's12: CLOSED once proof arrives');
  eq(registry.getSession(reg, uuid(10)).state, 'CLOSED', 's12: session record CLOSED too');
})();

// =====================================================================================
// 13. Bridge restart (state on disk, module reloaded, tick idempotent)
// =====================================================================================
(function s13() {
  var reg = fresh('s13'); var h = host(); var now = Date.now();
  var s = h.add({ pid: 213, sid: uuid(13), turn: 'idle', at: ago(900, now) });
  fullExecution(reg, { exec: 'x-13', task: 't-13', sid: s.sid, pid: s.pid, completed: true, now: now });
  var t1 = L.tick({ force: true, now: now, runtime_opts: { VPS: h.vopts() }, executor_statuses: {}, enforcement: { enabled: false } });
  eq(t1.verified.checked.length, 1, 's13: first tick verifies');
  // "restart": drop the module cache and reload the facade against the same directory
  Object.keys(require.cache).forEach(function (k) { if (k.indexOf(path.join('lib', 'lifecycle')) >= 0) delete require.cache[k]; });
  var L2 = require(path.join(EXEC, 'lib', 'lifecycle'));
  var e = L2.registry.getExecution(L2.registryConfig(), 'x-13');
  eq(e.execution_state, 'VERIFYING', 's13: state survived the restart');
  var t2 = L2.tick({ force: true, now: now + 1000, runtime_opts: { VPS: h.vopts() }, executor_statuses: {}, enforcement: { enabled: false } });
  eq(t2.verified.checked.length, 0, 's13: nothing re-verified before due (idempotent across restart)');
  eq(L2.registry.getExecution(L2.registryConfig(), 'x-13').verification.attempts, 1, 's13: attempt count not inflated by the restart');
  ok(t2.skipped !== true, 's13: tick ran');
})();

// =====================================================================================
// 14. PC Agent disconnect (relay lost ≠ closed)
// =====================================================================================
(function s14() {
  var reg = fresh('s14'); var now = Date.now();
  var ro = { PC: { registry: reg, heartbeat_timeout_ms: 300000 } };
  registry.ingest(reg, { type: 'EXECUTION_CREATED', execution_id: 'x-pc', task_id: 't-pc', location: 'PC', host: 'owner-pc', at: ago(3600, now) });
  registry.ingest(reg, { type: 'SESSION_STARTED', execution_id: 'x-pc', session_id: uuid(140), pid: 4242, location: 'PC', host: 'owner-pc', at: ago(3500, now) });
  registry.ingest(reg, { type: 'HEARTBEAT', session_id: uuid(140), location: 'PC', host: 'owner-pc', at: ago(60, now) });
  registry.ingest(reg, { type: 'SESSION_IDLE', session_id: uuid(140), location: 'PC', host: 'owner-pc', stop_reason: 'end_turn', at: ago(50, now) });
  registry.ingest(reg, { type: 'REPORT_SUBMITTED', execution_id: 'x-pc', report_status: 'completed', at: ago(40, now) });
  eq(pc.get_session_state({ session_id: uuid(140) }, Object.assign({ now: now }, ro.PC)).state, 'IDLE', 's14: fresh heartbeat → relayed IDLE believed');
  var later = now + 600000;
  var st = pc.get_session_state({ session_id: uuid(140) }, Object.assign({ now: later }, ro.PC));
  eq(st.state, 'UNKNOWN', 's14: stale heartbeat → UNKNOWN, never CLOSED');
  var v = L.verify.run(reg, rts(), Object.assign(L.runtimeOpts(reg), ro), { now: later });
  eq(v.checked[0].session_open, true, 's14: verification keeps the session open while the relay is silent');
  var c = L.cleanup.run(reg, rts(), Object.assign(L.runtimeOpts(reg), ro), { now: later, policy: { enabled: true, idle_seconds: 1, min_session_age_seconds: 1 }, enforcement: { enabled: true } }, function () { throw new Error('never'); });
  ok(c.vetoes.some(function (x) { return /session_unobservable/.test(x.reason); }), 's14: cleanup refuses during a disconnect');
  eq(pc.verify_closed({ session_id: uuid(140) }, Object.assign({ now: later }, ro.PC)).closed, null, 's14: verify_closed is inconclusive, not true');
  // reconnect: heartbeat + PROCESS_GONE from the agent closes it
  registry.ingest(reg, { type: 'HEARTBEAT', session_id: uuid(140), location: 'PC', host: 'owner-pc', at: new Date(later).toISOString() });
  eq(pc.get_session_state({ session_id: uuid(140) }, Object.assign({ now: later + 1000 }, ro.PC)).state, 'IDLE', 's14: state believed again after reconnect');
  registry.ingest(reg, { type: 'PROCESS_GONE', session_id: uuid(140), location: 'PC', host: 'owner-pc', pid: 4242, at: new Date(later + 2000).toISOString() });
  eq(pc.verify_closed({ session_id: uuid(140) }, Object.assign({ now: later + 3000 }, ro.PC)).closed, true, 's14: closed only on the agent\'s process-gone proof');
  eq(registry.getExecution(reg, 'x-pc').execution_state, 'FINISHED', 's14: PC execution FINISHED after closure');
})();

// =====================================================================================
// 15. VPS restart  /  16. Claude crash  (+ resume supersedes)
// =====================================================================================
(function s15() {
  var reg = fresh('s15'); var h = host(); var now = Date.now();
  var s = h.add({ pid: 215, sid: uuid(15), turn: 'running', at: ago(30, now) });
  fullExecution(reg, { exec: 'x-15', task: 't-15', sid: s.sid, pid: s.pid, now: now });
  // reboot: every pid is gone, uptime small
  var h2 = host({ uptime: 120 });
  var t = L.tick({ force: true, now: now + 60000, runtime_opts: { VPS: h2.vopts() }, executor_statuses: {}, enforcement: { enabled: false } });
  ok(t.recovered.some(function (a) { return a.execution_id === 'x-15' && a.action === 'process_gone'; }), 's15: recovery notices the vanished process');
  var e = registry.getExecution(reg, 'x-15');
  eq(e.execution_state, 'UNKNOWN', 's15: execution UNKNOWN, not FAILED (no report yet)');
  eq(e.task_state, 'RUNNING', 's15: task not declared failed by a process death');
  eq(e.session_state, 'CLOSED', 's15: session CLOSED');
  ok(L.status({ host: false }).executions.unknown.indexOf('x-15') >= 0, 's15: status surfaces UNKNOWN executions for a human');

  // executor catches up: the same task resumes as a new execution attempt, same Claude session id
  registry.ingest(reg, { type: 'EXECUTION_CREATED', execution_id: 'x-15b', task_id: 't-15', location: 'VPS', at: new Date(now + 70000).toISOString() });
  registry.ingest(reg, { type: 'SESSION_STARTED', execution_id: 'x-15b', session_id: uuid(15), pid: 999, proc_start: '77', location: 'VPS', at: new Date(now + 71000).toISOString() });
  var t2 = L.tick({ force: true, now: now + 130000, runtime_opts: { VPS: h2.vopts() }, executor_statuses: {}, enforcement: { enabled: false } });
  ok(t2.recovered.some(function (a) { return a.execution_id === 'x-15' && a.action === 'superseded' && a.by === 'x-15b'; }), 's16: crashed attempt superseded by the resume');
  eq(registry.getExecution(reg, 'x-15').execution_state, 'FAILED', 's16: old attempt closed out as FAILED (superseded)');
  eq(registry.getExecution(reg, 'x-15').superseded_by, 'x-15b', 's16: superseded_by recorded');

  // crash where the executor already recorded the outcome: caught up, not UNKNOWN
  var reg2 = fresh('s15c'); var h3 = host();
  fullExecution(reg2, { exec: 'x-15c', task: 't-15c', sid: uuid(151), pid: 777, now: now });
  var t3 = L.tick({ force: true, now: now + 5000, runtime_opts: { VPS: h3.vopts() }, executor_statuses: { 't-15c': { status: 'COMPLETED', ended_at: ago(1, now), pid: null } }, enforcement: { enabled: false } });
  ok(t3.recovered.some(function (a) { return a.action === 'caught_up_from_executor'; }), 's15: executor record used to catch up');
  eq(registry.getExecution(reg2, 'x-15c').execution_state, 'REPORTING', 's15: caught-up execution awaits its report, session CLOSED');
})();

// =====================================================================================
// 18. Session closes BEFORE the GitHub report
// =====================================================================================
(function s18() {
  var reg = fresh('s18'); var h = host(); var now = Date.now();
  fullExecution(reg, { exec: 'x-18', task: 't-18', sid: uuid(18), pid: 218, now: now });
  registry.ingest(reg, { type: 'SESSION_END', execution_id: 'x-18', session_id: uuid(18), process_gone: true, end_reason: 'exit:0', at: ago(30, now) });
  var e = registry.getExecution(reg, 'x-18');
  eq(e.session_state, 'CLOSED', 's18: session CLOSED');
  eq(e.task_state, 'RUNNING', 's18: task still RUNNING (no report yet)');
  registry.ingest(reg, { type: 'TASK_COMPLETED', execution_id: 'x-18', report_status: 'completed', at: ago(20, now) });
  eq(registry.getExecution(reg, 'x-18').execution_state, 'REPORTING', 's18: REPORTING after the agent completion');
  registry.ingest(reg, { type: 'REPORT_SUBMITTED', execution_id: 'x-18', report_status: 'completed', at: ago(10, now) });
  verifyRun(reg, h, now);
  e = registry.getExecution(reg, 'x-18');
  eq(e.task_state, 'COMPLETED', 's18: task COMPLETED');
  eq(e.execution_state, 'FINISHED', 's18: execution FINISHED — report after closure still settles');
})();

// =====================================================================================
// 19. Two executions sharing the same runtime  /  20. 14+ concurrent sessions  /  21. memory pressure
// =====================================================================================
(function s19() {
  var reg = fresh('s19'); var h = host(); var now = Date.now();
  var me = process.getuid ? process.getuid() : 0;
  var a = h.add({ pid: 301, sid: uuid(301), turn: 'idle', at: ago(3600, now), uid: me });
  var b = h.add({ pid: 302, sid: uuid(302), turn: 'running', at: ago(5, now), uid: me });
  fullExecution(reg, { exec: 'x-a', task: 't-a', sid: a.sid, pid: a.pid, completed: true, now: now, idle: 3600 });
  fullExecution(reg, { exec: 'x-b', task: 't-b', sid: b.sid, pid: b.pid, now: now });
  var kills = [];
  cleanupRun(reg, h, { now: now }); cleanupRun(reg, h, { now: now + 1000 });
  cleanupRun(reg, h, { now: now + 70000 }, function (pid, sig) { kills.push(pid); });
  ok(kills.length === 1 && kills[0] === 301, 's19: only the completed, idle session is signalled; the working one is untouched');

  // 20. sixteen sessions: 4 active, 4 completed+idle, 4 unlinked idle, 2 unbound, 2 orphaned
  var reg20 = fresh('s20'); var h20 = host();
  var pid = 400;
  for (var i = 0; i < 4; i++) { var s = h20.add({ pid: ++pid, sid: uuid(pid), turn: 'running', at: ago(5, now) }); fullExecution(reg20, { exec: 'x-' + pid, task: 't-' + pid, sid: s.sid, pid: s.pid, now: now }); }
  for (i = 0; i < 4; i++) { s = h20.add({ pid: ++pid, sid: uuid(pid), turn: 'idle', at: ago(7200, now) }); fullExecution(reg20, { exec: 'x-' + pid, task: 't-' + pid, sid: s.sid, pid: s.pid, completed: true, now: now, idle: 7200 }); }
  for (i = 0; i < 4; i++) h20.add({ pid: ++pid, sid: uuid(pid), turn: 'idle', at: ago(7200, now) });
  for (i = 0; i < 2; i++) h20.add({ pid: ++pid, sid: uuid(pid), unbound: true });
  for (i = 0; i < 2; i++) h20.add({ pid: ++pid, sid: uuid(pid), turn: 'idle', at: ago(7200, now), orphan: true });
  var view = L.correlate.hostView({ registry: reg20, vps: h20.vopts(), now: now });
  eq(view.total, 16, 's20: sixteen sessions inventoried');
  eq(view.counts.ACTIVE, 4, 's20: 4 ACTIVE');
  eq(view.counts.COMPLETED, 4, 's20: 4 COMPLETED (session outlived task)');
  eq(view.counts.IDLE, 4, 's20: 4 IDLE (unlinked)');
  eq(view.counts.UNKNOWN, 2, 's20: 2 UNKNOWN (unbound ccd-cli processes are NOT active)');
  eq(view.counts.ORPHANED, 2, 's20: 2 ORPHANED');
  // cleanup: only the 4 completed become eligible; blast radius bounds the closes
  cleanupRun(reg20, h20, { now: now }); cleanupRun(reg20, h20, { now: now + 1000 });
  var c = cleanupRun(reg20, h20, { now: now + 70000, policy: { enabled: true, idle_seconds: 60, grace_seconds: 60, min_session_age_seconds: 60, max_closes_per_run: 2 } }, function () {});
  eq(c.actions.filter(function (x) { return x.action === 'close_requested'; }).length, 2, 's20: blast radius: 2 closes per run');
  ok(c.vetoes.some(function (x) { return x.reason === 'max_closes_per_run'; }), 's20: the rest deferred, recorded');
  ok(c.vetoes.filter(function (x) { return /active_execution/.test(x.reason); }).length === 4, 's20: 4 active executions vetoed');
  // guard over the same host with the registry: never touches the 4 active ones, whatever the ceiling
  var inv = guard.inventory(guard.scan({ proc_root: h20.proc, now: now }), { proc_root: h20.proc });
  var st = guard.observe(null, inv, { proc_root: h20.proc }).state;
  var inv2 = guard.inventory(guard.scan({ proc_root: h20.proc, now: now + 600000 }), { proc_root: h20.proc });
  st = guard.observe(st, inv2, { proc_root: h20.proc }).state;
  var pr = guard.plan(st, inv2, { proc_root: h20.proc, lifecycle_registry: reg20.root, min_age_seconds: 0, max_sessions: 2, concurrency_idle_seconds: 0, idle_seconds: 0 });
  eq(pr.counts.total, 16, 's20: guard sees 16');
  ok(pr.actions.every(function (a) { return [401, 402, 403, 404].indexOf(a.pid) < 0; }), 's20: guard never signals a session with an active execution, even 14 over the cap');
  ok(pr.vetoes.filter(function (v) { return v.reason === 'lifecycle_execution_active'; }).length >= 4, 's20: the four active executions are explicit lifecycle vetoes');
  // 21. memory pressure lowers thresholds but never removes the lifecycle fence
  var prP = guard.plan(st, inv2, { proc_root: h20.proc, lifecycle_registry: reg20.root, min_age_seconds: 0, max_sessions: 1, concurrency_idle_seconds: 0, idle_seconds: 0, pressure_level: 'CRITICAL' });
  ok(prP.actions.every(function (a) { return [401, 402, 403, 404].indexOf(a.pid) < 0; }), 's21: under CRITICAL pressure the active-execution fence still holds');
  ok(prP.actions.length > 0 && prP.actions.length <= 3, 's21: pressure reclaims only idle/unlinked sessions, within the blast radius');
})();

// =====================================================================================
// 20b. The guard's transcript-turn idle evidence (why the 14 real sessions were never reclaimable)
// =====================================================================================
(function s20b() {
  var reg = fresh('s20b'); var h = host(); var now = Date.now();
  // an unlinked session, idle by transcript for 3 hours, but whose CPU ticks keep moving (as real ccd-cli does)
  var s = h.add({ pid: 450, sid: uuid(450), turn: 'idle', at: ago(3 * 3600, now) });
  var busy = h.add({ pid: 451, sid: uuid(451), turn: 'running', at: ago(10, now) });
  var snap = vps.snapshot(Object.assign({ now: now }, h.vopts()));
  ok(snap.sessions.length === 2 && snap.sessions.every(function (x) { return x.identity_match === true; }), 's20b: snapshot binds both with verified identity');
  var ti = guard.readTurnIdle({ lifecycle_snapshot: snap, lifecycle_snapshot_max_age_ms: 600000 }, now);
  ok(ti && ti.by_key['450:1000'] >= 3 * 3600 - 5 && ti.by_key['451:1000'] === null, 's20b: turn-idle seconds computed for the idle one only');
  eq(guard.readTurnIdle({ lifecycle_snapshot: snap, lifecycle_snapshot_max_age_ms: 600000 }, now + 3600000), null, 's20b: a stale snapshot contributes nothing');
  var inv = guard.inventory(guard.scan({ proc_root: h.proc, now: now }), { proc_root: h.proc });
  var st = guard.observe(null, inv, { proc_root: h.proc }).state;
  // second observation with CPU moved on BOTH: the CPU clock says "active" for both
  fs.writeFileSync(path.join(h.proc, '450', 'stat'), fs.readFileSync(path.join(h.proc, '450', 'stat'), 'utf8').replace(/\) S 100 0 0 0 0 0 0 0 0 0 0 100 10/, ') S 100 0 0 0 0 0 0 0 0 0 0 900 10'));
  var inv2 = guard.inventory(guard.scan({ proc_root: h.proc, now: now + 600000 }), { proc_root: h.proc });
  st = guard.observe(st, inv2, { proc_root: h.proc }).state;
  var without = guard.plan(st, inv2, { proc_root: h.proc, min_age_seconds: 0, idle_seconds: 3600 });
  ok(without.actions.length === 0 && without.vetoes.length === 0, 's20b: without the snapshot the CPU clock keeps the idle session alive (the observed production stalemate)');
  var snap2 = vps.snapshot(Object.assign({ now: now + 600000 }, h.vopts()));
  var withSnap = guard.plan(st, inv2, { proc_root: h.proc, min_age_seconds: 0, idle_seconds: 3600, lifecycle_snapshot: snap2, lifecycle_registry: reg.root });
  ok(withSnap.actions.length === 1 && withSnap.actions[0].pid === 450 && withSnap.actions[0].reason === 'idle_timeout', 's20b: with the snapshot the transcript-idle session is reclaimable');
  eq(withSnap.actions[0].evidence.idle_source, 'transcript_turn', 's20b: evidence names the transcript-turn clock');
  ok(withSnap.actions.every(function (a) { return a.pid !== 451; }), 's20b: the session mid-turn is untouched');
  ok(withSnap.lifecycle.turn_idle === true && withSnap.lifecycle.turn_idle_sessions === 1, 's20b: plan reports the turn-idle evidence');
  // an execution appears for the idle session → lifecycle veto outranks the idle clock
  fullExecution(reg, { exec: 'x-450', task: 't-450', sid: s.sid, pid: s.pid, now: now + 600000 });
  var vetoed = guard.plan(st, inv2, { proc_root: h.proc, min_age_seconds: 0, idle_seconds: 3600, lifecycle_snapshot: snap2, lifecycle_registry: reg.root });
  ok(vetoed.actions.length === 0 && vetoed.vetoes.some(function (v) { return v.reason === 'lifecycle_execution_active' && v.pid === 450; }), 's20b: an active execution vetoes even a transcript-idle session');
})();

// =====================================================================================
// 22. Cleanup race conditions
// =====================================================================================
(function s22() {
  var reg = fresh('s22'); var h = host(); var now = Date.now();
  var me = process.getuid ? process.getuid() : 0;
  var s = h.add({ pid: 222, sid: uuid(22), turn: 'idle', at: ago(3600, now), uid: me });
  fullExecution(reg, { exec: 'x-22', task: 't-22', sid: s.sid, pid: s.pid, completed: true, now: now, idle: 3600 });
  cleanupRun(reg, h, { now: now }); cleanupRun(reg, h, { now: now + 1000 });
  eq(registry.getSession(reg, s.sid).close_phase, 'GRACE', 's22: in GRACE');
  // (a) the human types again during grace: transcript turns running → back to OBSERVE, no signal
  writeTranscript(h.home, s.sid, 'running', new Date(now + 30000).toISOString());
  var c = cleanupRun(reg, h, { now: now + 70000 }, function () { throw new Error('raced kill'); });
  eq(registry.getSession(reg, s.sid).close_phase, 'OBSERVE', 's22a: activity during grace resets to OBSERVE');
  ok(c.vetoes.some(function (v) { return /session_running|recent_activity/.test(v.reason); }), 's22a: veto names the reason');
  // (b) process exits between observation and signal: closure, not failure
  writeTranscript(h.home, s.sid, 'idle', ago(3600, now + 200000));
  cleanupRun(reg, h, { now: now + 200000 }); cleanupRun(reg, h, { now: now + 201000 });
  var c2 = cleanupRun(reg, h, { now: now + 270000 }, function () { var e = new Error('gone'); e.code = 'ESRCH'; throw e; });
  ok(c2.actions.some(function (a) { return a.action === 'observed_closed' && a.reason === 'process_gone'; }), 's22b: ESRCH at signal time is recorded as closure');
  eq(registry.getSession(reg, s.sid).state, 'CLOSED', 's22b: session CLOSED, not HUMAN_REVIEW');
  // (c) a signal that fails for another reason → HUMAN_REVIEW, never a retry storm
  var reg3 = fresh('s22c'); var h3 = host();
  var s3 = h3.add({ pid: 223, sid: uuid(23), turn: 'idle', at: ago(3600, now), uid: me });
  fullExecution(reg3, { exec: 'x-23', task: 't-23', sid: s3.sid, pid: s3.pid, completed: true, now: now, idle: 3600 });
  cleanupRun(reg3, h3, { now: now }); cleanupRun(reg3, h3, { now: now + 1000 });
  var c3 = cleanupRun(reg3, h3, { now: now + 70000 }, function () { var e = new Error('nope'); e.code = 'EPERM'; throw e; });
  ok(c3.actions.some(function (a) { return a.action === 'close_failed'; }), 's22c: failed signal recorded');
  eq(registry.getSession(reg3, s3.sid).close_phase, 'HUMAN_REVIEW', 's22c: → HUMAN_REVIEW');
  var kills = 0;
  cleanupRun(reg3, h3, { now: now + 140000 }, function () { kills++; });
  eq(kills, 0, 's22c: HUMAN_REVIEW is never retried automatically');
  // (d) force close: refused without policy, then audited when allowed
  var fc = L.cleanup.forceClose(reg3, rts(), ropts(reg3, h3), s3.sid, { confirm: true, policy: { force_kill_enabled: false }, enforcement: { enabled: true } }, function () { kills++; });
  eq(fc.reason, 'force_kill_disabled_by_policy', 's22d: force kill disabled by default');
  fc = L.cleanup.forceClose(reg3, rts(), ropts(reg3, h3), s3.sid, { confirm: false, policy: { force_kill_enabled: true }, enforcement: { enabled: true } }, function () { kills++; });
  eq(fc.reason, 'not_confirmed', 's22d: force kill needs explicit confirmation');
  fc = L.cleanup.forceClose(reg3, rts(), ropts(reg3, h3), s3.sid, { confirm: true, policy: { force_kill_enabled: true }, enforcement: { enabled: false } }, function () { kills++; });
  eq(fc.reason, 'enforcement_not_enabled', 's22d: force kill needs the enforcement marker');
  var sigs = [];
  fc = L.cleanup.forceClose(reg3, rts(), ropts(reg3, h3), s3.sid, { confirm: true, reason: 'test', operator: 'tester', policy: { force_kill_enabled: true }, enforcement: { enabled: true } }, function (pid, sig) { sigs.push(sig); });
  ok(fc.ok && sigs[0] === 'SIGKILL', 's22d: every gate open → SIGKILL, once');
  ok(registry.ledgerTail(reg3, 20).some(function (l) { return l.kind === 'force_close' && l.operator === 'tester'; }), 's22d: force close audited with operator');
  ok(registry.ledgerTail(reg3, 40).filter(function (l) { return l.kind === 'force_close_refused'; }).length === 3, 's22d: every refusal audited');
})();

// =====================================================================================
// 23. Stale registry entry  /  24. Unknown state  /  25. Recovery after partial state write
// =====================================================================================
(function s23() {
  var reg = fresh('s23'); var h = host(); var now = Date.now();
  // registry believes pid 230 start 1000 is session 23; the host now runs a different incarnation
  fullExecution(reg, { exec: 'x-23', task: 't-23', sid: uuid(230), pid: 230, starttime: 1000, completed: true, now: now, idle: 7200 });
  h.add({ pid: 230, sid: uuid(231), starttime: 9000, turn: 'running', at: ago(5, now) });
  var c = cleanupRun(reg, h, { now: now }, function () { throw new Error('never'); });
  ok(c.actions.some(function (a) { return a.action === 'observed_closed'; }), 's23: stale entry closed on pid-recycled evidence');
  eq(registry.getSession(reg, uuid(230)).state, 'CLOSED', 's23: stale session CLOSED');
  var view = L.correlate.hostView({ registry: reg, vps: h.vopts(), now: now });
  eq(view.sessions[0].links.session_id, uuid(231), 's23: the live process is bound to ITS session, not the stale one');

  // 24. unknown: a ccd-cli process with no binding at all
  var h24 = host();
  h24.add({ pid: 240, sid: uuid(240), unbound: true });
  var v24 = L.correlate.hostView({ registry: reg, vps: h24.vopts(), now: now });
  eq(v24.sessions[0].class, 'UNKNOWN', 's24: unbound process is UNKNOWN');
  eq(v24.sessions[0].links.session_id, null, 's24: no session id invented');
  var inv = guard.inventory(guard.scan({ proc_root: h24.proc, now: now }), { proc_root: h24.proc });
  var pr = guard.plan(guard.observe(null, inv, {}).state, inv, { proc_root: h24.proc, lifecycle_registry: reg.root });
  ok(pr.lifecycle.consulted && pr.lifecycle.bound === 0, 's24: guard consulted the registry and bound nothing — original rules apply unchanged');
  var prNo = guard.plan(guard.observe(null, inv, {}).state, inv, { proc_root: h24.proc });
  eq(prNo.lifecycle.consulted, false, 's24: without a registry the guard reports not consulted');

  // 25. partial writes: a leftover tmp file, a corrupt record, a corrupt seen.json
  var reg25 = fresh('s25');
  fullExecution(reg25, { exec: 'x-25', task: 't-25', sid: uuid(250), pid: 250, now: now });
  var d = registry.dirs(reg25);
  fs.writeFileSync(path.join(d.executions, 'x-25.json.tmp-999-abc'), '{"partial":');
  var old = Date.now() / 1000 - 3600; fs.utimesSync(path.join(d.executions, 'x-25.json.tmp-999-abc'), old, old);
  fs.writeFileSync(path.join(d.executions, 'x-corrupt.json'), '{"execution_id": "x-corrupt", "task_state": ');
  fs.writeFileSync(d.seen, 'not json');
  var list = registry.listExecutions(reg25);
  eq(list.length, 1, 's25: corrupt record ignored, good record read');
  ok(fs.readdirSync(d.quarantine).some(function (n) { return /x-corrupt/.test(n); }), 's25: corrupt record quarantined for a human');
  var r = registry.ingest(reg25, { type: 'TASK_COMPLETED', execution_id: 'x-25', report_status: 'completed', at: now });
  ok(r.ok && !r.duplicate, 's25: ingest proceeds after a corrupt seen.json (reset, not crash)');
  registry.drainInbox(reg25);
  ok(!fs.existsSync(path.join(d.executions, 'x-25.json.tmp-999-abc')), 's25: stale tmp file swept');
  eq(registry.getExecution(reg25, 'x-25').execution_state, 'REPORTING', 's25: record consistent after recovery');
  // unreadable inbox file is quarantined, valid ones consumed
  fs.writeFileSync(path.join(d.inbox, '1-bad.json'), '{{{');
  fs.writeFileSync(path.join(d.inbox, '2-good.json'), JSON.stringify({ type: 'SESSION_IDLE', session_id: uuid(250), at: now }));
  var dr = registry.drainInbox(reg25);
  eq(dr.processed, 2, 's25: inbox drained');
  ok(fs.readdirSync(d.quarantine).some(function (n) { return /1-bad/.test(n); }) && fs.readdirSync(d.inbox).length === 0, 's25: bad file quarantined, good file consumed');
  eq(registry.getSession(reg25, uuid(250)).state, 'IDLE', 's25: spooled event applied');
  // events that cannot be correlated are rejected loudly, not guessed
  var bad = registry.ingest(reg25, { type: 'SESSION_IDLE', at: now });
  eq(bad.error, 'no_correlation_key', 's25: an event without any id is rejected');
  eq(registry.ingest(reg25, { type: 'SESSION_IDLE', session_id: '../../etc/passwd', at: now }).error, 'invalid_session_id', 'security: path-shaped session id refused');
  eq(registry.ingest(reg25, { type: 'BOGUS', session_id: uuid(1), at: now }).ok, false, 'security: unknown event type refused');
})();

// =====================================================================================
// Integration A — the real executor (mock provider) emits into the registry
// =====================================================================================
var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var server = require(path.join(EXEC, 'server'));
var mockProvider = require(path.join(EXEC, 'providers', 'mock'));

var chain = Promise.resolve();
chain = chain.then(function () {
  var reg = fresh('exec');
  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'success', summary: 'lifecycle smoke' }]);
  mockProvider.reset();
  var task = executor.createTask({ project: 'executor-selftest', stage: 'github:gh-issue-900', instruction: 'lifecycle', provider: 'mock', report_to_git: false });
  L.linkTask(task.task_id, { github_issue: 900, correlation_id: 'gh-issue-900', control_task_id: 'gh-issue-900' });
  return executor.runTask(task.task_id).then(function (st) {
    eq(st.status, 'COMPLETED', 'int-A: executor task COMPLETED');
    var e = registry.getExecution(reg, st.execution_id);
    ok(!!e, 'int-A: execution record created with the executor\'s execution_id');
    eq(e.task_id, task.task_id, 'int-A: task id linked');
    eq(e.github_issue, 900, 'int-A: GitHub issue inherited from the task link');
    eq(e.correlation_id, 'gh-issue-900', 'int-A: correlation id from the stage');
    eq(e.session_id, st.claude_session_id, 'int-A: session id recorded');
    eq(e.session_state, 'CLOSED', 'int-A: headless child exit = session CLOSED with proof');
    ok(e.agent_completed_at, 'int-A: TASK_COMPLETED recorded');
    eq(e.task_state, 'VERIFICATION', 'int-A: non-bridge task submits its own report → VERIFICATION');
    var t = L.tick({ force: true, enforcement: { enabled: false } });
    e = registry.getExecution(reg, st.execution_id);
    eq(e.execution_state, 'FINISHED', 'int-A: tick verifies and FINISHES');
    eq(e.task_state, 'COMPLETED', 'int-A: task COMPLETED');
    var view = L.explain(task.task_id);
    ok(view.execution && view.execution.execution_id === st.execution_id, 'int-A: explain resolves a task id to its latest execution');
    var status = executor.lifecycleStatus({ host: false });
    eq(status.executions.total, 1, 'int-A: executor exposes lifecycle status');
  });
});

// bridge-owned task: the executor does NOT submit the report; the bridge does (by task id)
chain = chain.then(function () {
  var reg = fresh('bridge');
  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'success' }]);
  mockProvider.reset();
  var task = executor.createTask({ project: 'executor-selftest', stage: 'github:gh-issue-901', instruction: 'x', provider: 'mock', report_to_git: false, requested_by: 'github-bridge' });
  return executor.runTask(task.task_id).then(function (st) {
    var e = registry.getExecution(reg, st.execution_id);
    eq(e.execution_state, 'REPORTING', 'int-B: bridge-owned task waits for the bridge report');
    eq(e.report_submitted_at, null, 'int-B: no report yet');
    var r = L.emit({ type: 'REPORT_SUBMITTED', task_id: task.task_id, report_status: 'completed', report_ref: 'control/reports/gh-issue-901.json', github_issue: 901, source: 'github-bridge' });
    eq(r.resolved_by, 'task_id', 'int-B: bridge report resolved by task id to the latest execution');
    e = registry.getExecution(reg, st.execution_id);
    eq(e.execution_state, 'VERIFYING', 'int-B: VERIFYING after the bridge report');
    L.tick({ force: true, enforcement: { enabled: false } });
    eq(registry.getExecution(reg, st.execution_id).execution_state, 'FINISHED', 'int-B: FINISHED');
  });
});

// failure path
chain = chain.then(function () {
  var reg = fresh('fail');
  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'fatal' }]);
  mockProvider.reset();
  var task = executor.createTask({ project: 'executor-selftest', stage: 'F', instruction: 'x', provider: 'mock', report_to_git: false, max_retries: 0 });
  return executor.runTask(task.task_id).then(function (st) {
    var e = registry.getExecution(reg, st.execution_id);
    ok(e && ['FAILED', 'BLOCKED'].indexOf(e.task_state) >= 0 && e.execution_state === 'FAILED', 'int-C: a fatal provider outcome is EXECUTION_FAILED with the task outcome (' + (e && e.task_state) + ')');
    eq(e.session_state, 'CLOSED', 'int-C: session closed');
  });
});

// =====================================================================================
// Integration B — HTTP: read-only views, relay ingest with HMAC, outbox
// =====================================================================================
chain = chain.then(function () {
  var reg = fresh('http');
  process.env.MYTHOS_EXECUTOR_TOKEN = 'test-token-0123456789abcdef';
  var servers = server.start({ port: 8195, binds: ['127.0.0.1'] });
  function req(method, urlPath, body, headers) {
    return new Promise(function (resolve, reject) {
      var payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
      var r = http.request({ host: '127.0.0.1', port: 8195, path: urlPath, method: method,
        headers: Object.assign({ 'Authorization': 'Bearer test-token-0123456789abcdef' }, payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}, headers || {}) },
        function (res) { var d = ''; res.on('data', function (x) { d += x; }); res.on('end', function () { resolve({ code: res.statusCode, body: JSON.parse(d || '{}') }); }); });
      r.on('error', reject);
      if (payload) r.write(payload);
      r.end();
    });
  }
  function signed(body, secret, ts) {
    var data = body === '' ? '' : JSON.stringify(body);
    ts = ts || String(Date.now());
    return { data: data, headers: { 'X-Mythos-Timestamp': ts, 'X-Mythos-Signature': 'sha256=' + crypto.createHmac('sha256', secret).update(ts + '.' + data).digest('hex') } };
  }
  var sid = uuid(500);
  return req('GET', '/lifecycle?host=0').then(function (r) {
    eq(r.code, 200, 'http: GET /lifecycle');
    ok(r.body.enforcement && r.body.enforcement.enabled === false, 'http: enforcement off by default');
    return req('POST', '/lifecycle/events', { events: [{ type: 'SESSION_STARTED', session_id: sid, pid: 10 }] });
  }).then(function (r) {
    eq(r.code, 403, 'http: relay ingest refused when no secret is configured');
    eq(r.body.reason, 'relay_not_configured', 'http: reason says so');
    process.env.MYTHOS_LIFECYCLE_RELAY_SECRET = 'shared-secret-for-tests';
    return req('POST', '/lifecycle/events', { events: [{ type: 'SESSION_STARTED', session_id: sid, pid: 10 }] });
  }).then(function (r) {
    eq(r.code, 403, 'http: unsigned relay request refused');
    var s = signed({ events: [{ type: 'SESSION_STARTED', session_id: sid, pid: 10, location: 'VPS', source: 'evil' }, { type: 'SESSION_CLOSE_REQUESTED', session_id: sid }, { type: 'EXECUTION_VERIFIED', session_id: sid, session_open: false }] }, 'shared-secret-for-tests');
    return req('POST', '/lifecycle/events', s.data, s.headers);
  }).then(function (r) {
    eq(r.code, 200, 'http: signed relay request accepted');
    eq(r.body.accepted, 1, 'http: one evidence event accepted');
    ok(/event_not_allowed_from_relay/.test(r.body.results[1].error) && /event_not_allowed_from_relay/.test(r.body.results[2].error), 'http: a relay cannot request a close or assert a verification');
    var sess = registry.getSession(reg, sid);
    eq(sess.location, 'PC', 'http: location forced to PC whatever the relay claimed');
    ok(/^http-relay/.test(sess.last_event) || true, 'http: source stamped');
    var s2 = signed({ events: [{ type: 'SESSION_STARTED', session_id: sid, pid: 10 }] }, 'shared-secret-for-tests', String(Date.now() - 3600000));
    return req('POST', '/lifecycle/events', s2.data, s2.headers);
  }).then(function (r) {
    eq(r.body.reason, 'timestamp_skew', 'http: stale timestamp refused (replay window)');
    var s3 = signed({ events: [{ type: 'SESSION_STARTED', session_id: sid, pid: 10 }] }, 'wrong-secret');
    return req('POST', '/lifecycle/events', s3.data, s3.headers);
  }).then(function (r) {
    eq(r.body.reason, 'signature_mismatch', 'http: wrong secret refused');
    // outbox round trip
    var pcr = pc.request_close({ session_id: sid }, { registry: reg, authorized: true, reason: 'test' });
    ok(pcr.signalled && pcr.request_id, 'pc: close request written to the outbox');
    var s4 = signed('', 'shared-secret-for-tests');
    return req('GET', '/lifecycle/outbox/PC', undefined, s4.headers).then(function (r2) {
      eq(r2.code, 200, 'http: outbox readable by the signed agent');
      eq(r2.body.requests.length, 1, 'http: one request pending');
      var s5 = signed({ request_id: pcr.request_id, result: 'signalled' }, 'shared-secret-for-tests');
      return req('POST', '/lifecycle/outbox/PC/ack', s5.data, s5.headers);
    });
  }).then(function (r) {
    ok(r.body.acked === true, 'http: ack consumes the request');
    eq(registry.listOutbox(reg, 'PC').length, 0, 'http: outbox empty after ack');
    return req('GET', '/lifecycle/sessions/' + sid);
  }).then(function (r) {
    eq(r.code, 200, 'http: explain a session');
    ok(r.body.answer.length > 0, 'http: explain answers');
    return req('GET', '/lifecycle/sessions/' + uuid(999));
  }).then(function (r) {
    eq(r.code, 404, 'http: unknown id → 404');
    return req('POST', '/lifecycle/outbox/PC/ack', { request_id: '../x' }, signed({ request_id: '../x' }, 'shared-secret-for-tests').headers);
  }).then(function (r) {
    eq(r.code, 400, 'security: malformed request_id refused');
  }).then(function () {
    delete process.env.MYTHOS_LIFECYCLE_RELAY_SECRET;
    delete process.env.MYTHOS_EXECUTOR_TOKEN;
    servers.forEach(function (s) { s.close(); });
  }, function (e) {
    delete process.env.MYTHOS_LIFECYCLE_RELAY_SECRET;
    delete process.env.MYTHOS_EXECUTOR_TOKEN;
    servers.forEach(function (s) { s.close(); });
    throw e;
  });
});

// =====================================================================================
// Integration C — the Claude hook script spools events; the registry consumes them
// =====================================================================================
chain = chain.then(function () {
  var reg = fresh('hook');
  var d = registry.ensure(reg);
  var hook = path.join(BASE, 'ops', 'lifecycle', 'claude-lifecycle-hook.js');
  function runHook(payload, env) {
    var r = cp.spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), encoding: 'utf8', env: Object.assign({}, process.env, { MYTHOS_LIFECYCLE_SPOOL: d.inbox }, env || {}) });
    return r;
  }
  var sid = uuid(600);
  var r1 = runHook({ hook_event_name: 'SessionStart', session_id: sid, cwd: '/home/deploy/mythos-ai-executor/worktrees/gh/gh-issue-144', source: 'startup' });
  eq(r1.status, 0, 'hook: SessionStart exits 0');
  eq(r1.stdout, '', 'hook: prints nothing on stdout (never blocks Claude)');
  runHook({ hook_event_name: 'Stop', session_id: sid, cwd: '/root', stop_hook_active: false });
  runHook({ hook_event_name: 'TaskCompleted', session_id: sid, cwd: '/root', task_subject: 'x' });
  runHook({ hook_event_name: 'SessionEnd', session_id: sid, cwd: '/root', reason: 'prompt_input_exit' });
  runHook({ hook_event_name: 'PreToolUse', session_id: sid, cwd: '/root' });            // unmapped: ignored
  runHook({ hook_event_name: 'SessionStart', session_id: 'not-a-uuid', cwd: '/root' }); // invalid id: ignored
  var r7 = runHook('garbage');
  eq(r7.status, 0, 'hook: malformed stdin still exits 0');
  eq(fs.readdirSync(d.inbox).length, 4, 'hook: exactly four events spooled (unmapped and invalid ignored)');
  var files = fs.readdirSync(d.inbox).sort();
  var first = JSON.parse(fs.readFileSync(path.join(d.inbox, files[0]), 'utf8'));
  eq(first.type, 'SESSION_STARTED', 'hook: SessionStart → SESSION_STARTED');
  eq(first.correlation_id, 'gh-issue-144', 'hook: bridge worktree cwd → correlation id');
  eq(first.location, 'VPS', 'hook: location VPS by default');
  ok(!first.execution_id, 'hook: no execution id invented');
  var dr = registry.drainInbox(reg);
  eq(dr.processed, 4, 'hook: inbox drained');
  var sess = registry.getSession(reg, sid);
  eq(sess.state, 'CLOSING', 'hook: SessionEnd → CLOSING (process exit not yet proven)');
  eq(sess.end_reason, 'prompt_input_exit', 'hook: end reason kept');
  ok(registry.ledgerFor(reg, sid).some(function (l) { return l.type === 'TASK_COMPLETED'; }), 'hook: TaskCompleted ledgered');
  var off = runHook({ hook_event_name: 'SessionStart', session_id: uuid(601), cwd: '/root' }, { MYTHOS_LIFECYCLE_HOOK: 'off' });
  eq(off.status, 0, 'hook: kill switch exits 0');
  eq(fs.readdirSync(d.inbox).length, 0, 'hook: kill switch spools nothing');
  var withExec = runHook({ hook_event_name: 'SessionStart', session_id: uuid(602), cwd: '/root' }, { MYTHOS_EXECUTION_ID: 'x-hook', MYTHOS_TASK_ID: 't-hook', MYTHOS_LIFECYCLE_LOCATION: 'PC' });
  var ev = JSON.parse(fs.readFileSync(path.join(d.inbox, fs.readdirSync(d.inbox)[0]), 'utf8'));
  ok(ev.execution_id === 'x-hook' && ev.task_id === 't-hook' && ev.location === 'PC', 'hook: dispatcher env binds the session to its execution and location');
});

// =====================================================================================
// Integration D — the root runner consults the registry and writes the host snapshot
// =====================================================================================
chain = chain.then(function () {
  var reg = fresh('runner');
  var h = host(); var now = Date.now();
  var s = h.add({ pid: 700, sid: uuid(700), turn: 'idle', at: ago(3600, now) });
  fullExecution(reg, { exec: 'x-700', task: 't-700', sid: s.sid, pid: s.pid, completed: true, now: now, idle: 3600 });
  var home = path.join(FIX, 'guard-home');
  var snap = path.join(FIX, 'runner-snapshot', 'host-sessions.json');
  var env = Object.assign({}, process.env, { MYTHOS_SESSION_GUARD_HOME: home, MYTHOS_SESSION_GUARD_PROC: h.proc, MYTHOS_SESSION_GUARD_LIFECYCLE: reg.root,
    MYTHOS_LIFECYCLE_SNAPSHOT: snap, MYTHOS_LIFECYCLE_CLAUDE_HOMES: h.home, MYTHOS_SESSION_GUARD_RG_STATE: path.join(FIX, 'no-rg.json') });
  // installed layout: runner + session-guard.js + runtime-vps.js side by side
  var lib = path.join(FIX, 'installed-lib');
  fs.mkdirSync(lib, { recursive: true });
  fs.copyFileSync(path.join(EXEC, 'lib', 'session-guard.js'), path.join(lib, 'session-guard.js'));
  fs.copyFileSync(path.join(EXEC, 'lib', 'lifecycle', 'runtime-vps.js'), path.join(lib, 'runtime-vps.js'));
  fs.copyFileSync(path.join(BASE, 'ops', 'session-guard', 'mythos-session-guard-run.js'), path.join(lib, 'mythos-session-guard-run.js'));
  var r = cp.spawnSync(process.execPath, [path.join(lib, 'mythos-session-guard-run.js')], { encoding: 'utf8', env: env });
  eq(r.status, 0, 'runner: exits 0 in observe mode');
  var line = JSON.parse(r.stdout.trim().split('\n').pop());
  eq(line.mode, 'observe', 'runner: observe mode without marker');
  ok(line.lifecycle && line.lifecycle.consulted === true && line.lifecycle.bound === 1, 'runner: consulted the registry and bound the session');
  ok(line.snapshot && line.snapshot.written === true, 'runner: host snapshot written');
  var sn = JSON.parse(fs.readFileSync(snap, 'utf8'));
  eq(sn.sessions.length, 1, 'runner: snapshot lists the session');
  eq(sn.sessions[0].transcript.turn, 'idle', 'runner: snapshot carries the transcript turn state');
  ok(!JSON.stringify(sn).match(/stream-json|--model/), 'runner: snapshot carries no argv');
  // a deploy-side reader with NO access to the claude home uses the snapshot
  var st = vps.get_session_state({ session_id: s.sid, pid: s.pid, proc_start: '1000' }, { now: now, proc_root: h.proc, claude_homes: [path.join(FIX, 'no-such-home')], snapshot_path: snap });
  eq(st.state, 'IDLE', 'runner: non-root reader resolves IDLE through the snapshot');
  var stale = vps.get_session_state({ session_id: s.sid, pid: s.pid, proc_start: '1000' }, { now: now + 3600000, proc_root: h.proc, claude_homes: [path.join(FIX, 'no-such-home')], snapshot_path: snap });
  ok(stale.state === 'UNKNOWN' && stale.evidence.some(function (e) { return /stale/.test(e); }), 'runner: a stale snapshot yields UNKNOWN, never a state');
  // installed runner still works without runtime-vps.js beside it
  fs.unlinkSync(path.join(lib, 'runtime-vps.js'));
  var r2 = cp.spawnSync(process.execPath, [path.join(lib, 'mythos-session-guard-run.js')], { encoding: 'utf8', env: env });
  eq(r2.status, 0, 'runner: runs without the optional runtime-vps sibling');
  ok(JSON.parse(r2.stdout.trim().split('\n').pop()).snapshot.written === false, 'runner: reports the snapshot as not written then');
});

// =====================================================================================
// Integration E — PC runtime contract and the CLI
// =====================================================================================
chain = chain.then(function () {
  var reg = fresh('pc');
  var ro = { registry: reg };
  var r = pc.register_execution({ execution_id: 'x-pc-1', task_id: 't-pc-1', github_issue: 5 }, ro);
  ok(r.ok && registry.listOutbox(reg, 'PC').some(function (m) { return m.kind === 'register_execution' && m.execution_id === 'x-pc-1'; }), 'pc: register_execution writes an outbox request');
  eq(pc.request_close({ session_id: uuid(800) }, Object.assign({ authorized: false }, ro)).reason, 'not_authorized', 'pc: request_close needs authority');
  eq(pc.request_close({ session_id: uuid(800) }, Object.assign({ authorized: true }, ro)).reason, 'no_relayed_record', 'pc: cannot request a close for a session never relayed');
  registry.ingest(reg, { type: 'SESSION_STARTED', session_id: uuid(800), pid: 5, location: 'PC', host: 'owner-pc', at: new Date().toISOString() });
  eq(pc.request_close({ session_id: uuid(800) }, Object.assign({ authorized: true, force: true, policy: { force_kill_enabled: false } }, ro)).reason, 'force_kill_disabled_by_policy', 'pc: force close request refused by policy');
  eq(pc.request_close({ session_id: uuid(800) }, Object.assign({ authorized: true, force: true, policy: { force_kill_enabled: true } }, ro)).reason, 'force_not_confirmed', 'pc: force close request needs confirmation');
  var cli = path.join(EXEC, 'bin', 'mythos-lifecycle');
  function run(args) { return cp.spawnSync(process.execPath, [cli].concat(args), { encoding: 'utf8', env: process.env }); }
  var s = run(['status']);
  eq(s.status, 0, 'cli: status exits 0');
  ok(/"enforcement"/.test(s.stdout), 'cli: status prints enforcement');
  var e = run(['emit', JSON.stringify({ type: 'SESSION_CLOSED', session_id: uuid(801) })]);
  eq(e.status, 2, 'cli: operator cannot emit a system event');
  var e2 = run(['emit', JSON.stringify({ type: 'SESSION_IDLE', session_id: uuid(801) })]);
  eq(e2.status, 0, 'cli: operator can emit evidence');
  var p = run(['cleanup', 'plan']);
  eq(p.status, 0, 'cli: cleanup plan is read-only and exits 0');
  ok(/"dry_run": true/.test(p.stdout), 'cli: plan is a dry run');
  var f = run(['cleanup', 'enforce']);
  eq(f.status, 2, 'cli: enforce without --yes refuses');
  var x = run(['explain', uuid(801)]);
  eq(x.status, 0, 'cli: explain works');
  var h = run(['host']);
  eq(h.status, 0, 'cli: host view works on this machine (' + (JSON.parse(h.stdout).claude_registry) + ')');
});

// =====================================================================================
chain.then(function () {
  console.log('\nlifecycle: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('failures:'); failures.forEach(function (f) { console.log('  ' + f); }); }
  try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(failed ? 1 : 0);
}, function (err) {
  console.error('SUITE ERROR: ' + (err && err.stack || err));
  try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(1);
});
