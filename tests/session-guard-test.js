'use strict';
// =====================================================
// MYTHOS — Session Guard tests (GitHub Issue #144)
// tests/session-guard-test.js
//
// Deterministic and offline. Nothing here signals a real process: every
// enforcement test injects a `killFn` that records the call instead of
// making it, and the scanner is pointed at a synthetic /proc tree built in
// a temp directory through the guard's documented `proc_root` override.
//
// The one non-synthetic input is tests/fixtures/session-guard/
// host-20260903.json — a real capture of this VPS's claude-related
// processes on 2026-09-03 (argv truncated, UUIDs replaced, the remote
// server's --token-file name redacted). It is the regression that pins the
// classifier against the ACTUAL argv shapes involved, including the
// distinction the whole module rests on: 14 Desktop Remote ccd-cli
// sessions under root vs the MYTHOS executor's own `claude -p` subprocess
// under deploy.
//
// Run with: node tests/session-guard-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var TMP = path.join(os.tmpdir(), 'mythos-session-guard-test-' + process.pid);
fs.mkdirSync(TMP, { recursive: true });

// The executor is required later for its read-only /session-guard view.
// Point its home at the temp tree BEFORE that require so the test can
// neither read nor write the production state directory, and keep
// notification inert (an unconfigured notify.sh exits 0 and sends nothing).
process.env.MYTHOS_EXECUTOR_HOME = path.join(TMP, 'executor-home');
process.env.MYTHOS_NOTIFY_CONFIG = path.join(TMP, 'no-notify-config.env');
delete process.env.MYTHOS_NTFY_URL;

var guard = require(path.join(EXEC, 'lib', 'session-guard'));

var passed = 0;
var failed = 0;
var failures = [];

function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

function eq(actual, expected, name) {
  ok(actual === expected, name + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

// --- Synthetic /proc ---------------------------------------------------------

var procSeq = 0;

// A fresh, empty /proc tree. Each test gets its own so nothing leaks
// between cases.
function newProc(uptimeSeconds) {
  procSeq += 1;
  var root = path.join(TMP, 'proc-' + procSeq);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'uptime'), String(uptimeSeconds || 100000) + ' 200000.00\n');
  return root;
}

// Writes one process. `stat` is built field by field so the parser is
// tested against the real layout: field 3 = state, 14 = utime, 15 = stime,
// 22 = starttime, with a `comm` that is allowed to be hostile.
function writeProc(root, p) {
  var dir = path.join(root, String(p.pid));
  fs.mkdirSync(dir, { recursive: true });

  var rest = [];
  for (var i = 0; i < 40; i++) rest.push('0');
  rest[0] = p.state || 'S';
  rest[1] = String(p.ppid || 1);
  rest[11] = String(p.utime === undefined ? 100 : p.utime);
  rest[12] = String(p.stime === undefined ? 10 : p.stime);
  rest[19] = String(p.starttime === undefined ? 1000 : p.starttime);
  fs.writeFileSync(path.join(dir, 'stat'),
    String(p.pid) + ' (' + (p.comm || 'proc') + ') ' + rest.join(' ') + '\n');

  var uid = p.uid === undefined ? 0 : p.uid;
  fs.writeFileSync(path.join(dir, 'status'),
    'Name:\t' + (p.comm || 'proc') + '\n' +
    'PPid:\t' + (p.ppid || 1) + '\n' +
    'Uid:\t' + uid + '\t' + uid + '\t' + uid + '\t' + uid + '\n' +
    'VmRSS:\t' + ((p.rss_mib === undefined ? 100 : p.rss_mib) * 1024) + ' kB\n');

  fs.writeFileSync(path.join(dir, 'cmdline'), (p.argv || ['proc']).join('\0') + '\0');
  return p.pid;
}

var SERVER_ARGV = ['/root/.claude/remote/srv/7d193f89/server', '--serve', '--socket', '/root/.claude/remote/run/x/rpc.sock'];
var BRIDGE_ARGV = ['/root/.claude/remote/srv/678bbae5/server', '--bridge', '--socket', '/root/.claude/remote/run/x/rpc.sock'];

function sessionArgv(ref) {
  var a = ['/root/.claude/remote/ccd-cli/2.1.255', '--output-format', 'stream-json', '--verbose',
    '--input-format', 'stream-json', '--effort', 'medium', '--model', 'claude-fable-5-1'];
  if (ref) a.push('--resume=' + ref);
  return a;
}

var EXECUTOR_ARGV = ['claude', '-p', '--output-format', 'json', '--session-id',
  'fe5ba816-a97a-44c4-b743-9e9a3c587a15', '--permission-mode', 'acceptEdits'];

// A standard host: one --serve server, one --bridge helper, N sessions,
// the executor daemon and its claude subprocess.
function standardHost(opts) {
  opts = opts || {};
  var root = newProc(opts.uptime || 200000);
  writeProc(root, { pid: 1, comm: 'systemd', ppid: 0, argv: ['/sbin/init'] });
  writeProc(root, { pid: 100, comm: 'server', ppid: 1, argv: SERVER_ARGV, rss_mib: 36 });
  writeProc(root, { pid: 101, comm: 'server', ppid: 1, argv: BRIDGE_ARGV, rss_mib: 2 });
  writeProc(root, { pid: 700, comm: 'node', ppid: 1, uid: 1001, rss_mib: 73,
    argv: ['/usr/bin/node', '/home/deploy/projects/mythos-prod/projects/mythos-ai-executor/bin/mythos-ai-executor', 'serve'] });
  writeProc(root, { pid: 701, comm: 'claude', ppid: 700, uid: 1001, rss_mib: 320, argv: EXECUTOR_ARGV });
  var n = opts.sessions === undefined ? 3 : opts.sessions;
  for (var i = 0; i < n; i++) {
    writeProc(root, {
      pid: 200 + i, comm: '2.1.255', ppid: opts.orphan ? 1 : 100, rss_mib: 150 + i,
      starttime: 1000 + i, utime: 1000, stime: 100,
      argv: sessionArgv('aaaaaaaa-0000-4000-8000-00000000000' + i)
    });
  }
  return root;
}

function cfgFor(root, extra) {
  var c = { proc_root: root, clock_ticks: 100, transcript_root: path.join(root, 'no-transcripts') };
  Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
  return c;
}

function inventoryOf(root, extra) {
  var cfg = guard.config(cfgFor(root, extra));
  return { cfg: cfg, inv: guard.inventory(guard.scan(cfg), cfg) };
}

// =====================================================
// 1. /proc parsing
// =====================================================

(function parsing() {
  // comm is allowed to contain spaces AND parentheses; only the LAST ')'
  // is a valid split point.
  var line = '4242 (weird (name) with spaces) R 7 7 7 0 -1 0 0 0 0 0 555 111 0 0 20 0 3 0 987654 0 0 0 0 0 0 0';
  var st = guard.parseStat(line);
  eq(st.comm, 'weird (name) with spaces', 'parseStat splits at the last )');
  eq(st.state, 'R', 'parseStat reads process state');
  eq(st.cpu_ticks, 666, 'parseStat sums utime + stime');
  eq(st.start_ticks, 987654, 'parseStat reads starttime');
  eq(guard.parseStat('garbage'), null, 'parseStat rejects a malformed line');
  eq(guard.parseStat(null), null, 'parseStat rejects a non-string');

  var status = guard.parseStatus('Name:\tx\nPPid:\t99\nUid:\t1001\t1001\t1001\t1001\nVmRSS:\t204800 kB\n');
  eq(status.ppid, 99, 'parseStatus reads PPid');
  eq(status.uid, 1001, 'parseStatus reads the real Uid');
  eq(status.rss_mib, 200, 'parseStatus converts VmRSS to MiB');
  eq(guard.parseStatus(undefined).ppid, null, 'parseStatus degrades to nulls');

  var root = newProc(100000);
  writeProc(root, { pid: 55, comm: 'x', ppid: 1, starttime: 500000, argv: ['/bin/x'] });
  var p = guard.readProcess(55, guard.config(cfgFor(root)));
  eq(p.pid, 55, 'readProcess returns the process');
  eq(guard.readProcess(9999, guard.config(cfgFor(root))), null, 'readProcess returns null for a pid that is gone');

  // Regression: a caller may pass a bare options object with no
  // clock_ticks. An undefined divisor produced NaN, and NaN silently read
  // as "old enough" in the age fence.
  eq(guard.ageSeconds({ start_ticks: 500000 }, 100000, {}), 95000, 'ageSeconds defaults USER_HZ instead of producing NaN');
  eq(guard.ageSeconds({ start_ticks: 500000 }, null, {}), null, 'ageSeconds is null without uptime');
  eq(guard.ageSeconds({}, 100000, {}), null, 'ageSeconds is null without starttime');
})();

// =====================================================
// 2. Classification — the safety core
// =====================================================

(function classification() {
  var r = inventoryOf(standardHost({ sessions: 2 }));
  var inv = r.inv;
  var byPid = {};
  inv.items.forEach(function (i) { byPid[i.pid] = i; });

  eq(byPid[200].kind, 'remote-session', 'a ccd-cli process is a remote session');
  eq(byPid[100].kind, 'remote-server', 'server --serve is the remote server');
  eq(byPid[101].kind, 'remote-server', 'server --bridge is also protected as a server');
  eq(byPid[701].kind, 'executor', 'the executor claude -p subprocess is classified executor');
  eq(byPid[700].kind, 'executor', 'the executor daemon itself is classified executor');
  eq(byPid[1].kind, 'other', 'init is neither a session nor a server');

  eq(inv.sessions.length, 2, 'exactly the ccd-cli processes are sessions');
  ok(inv.sessions.every(function (s) { return s.uid === 0; }), 'every session is root-owned in this fixture');
  ok(inv.executor.length >= 2, 'executor processes are collected separately');
  ok(inv.sessions.every(function (s) { return s.pid !== 701 && s.pid !== 700; }),
    'no executor process ever appears in the session list');

  // THE precedence test. A process whose argv somehow matches both
  // patterns must be protected, not reclaimed. The reverse ordering would
  // be the one catastrophic bug in this module.
  var root = newProc(200000);
  writeProc(root, { pid: 100, comm: 'server', ppid: 1, argv: SERVER_ARGV });
  writeProc(root, {
    pid: 300, comm: 'x', ppid: 100,
    argv: ['/root/.claude/remote/ccd-cli/2.1.255', '--wrapping', 'claude', '-p', '--output-format', 'json', '--session-id', 'x']
  });
  var amb = inventoryOf(root);
  eq(amb.inv.items.filter(function (i) { return i.pid === 300; })[0].kind, 'executor',
    'an argv matching BOTH patterns is classified executor, never a reclaim candidate');
  eq(amb.inv.sessions.length, 0, 'an ambiguous process is excluded from the session list');

  ok(guard.looksExecutor('claude -p --output-format json --session-id abc'), 'looksExecutor matches the executor invocation');
  ok(guard.looksExecutor('/usr/bin/node /x/projects/mythos-ai-executor/bin/mythos-ai-executor serve'),
    'looksExecutor matches the executor daemon');
  ok(!guard.looksExecutor('/root/.claude/remote/ccd-cli/2.1.255 --output-format stream-json'),
    'looksExecutor does not match a plain Desktop Remote session');

  // parent_is_server distinguishes a live session from an orphan.
  eq(byPid[200].parent_is_server, true, 'a session forked by the live server reports parent_is_server');
  var orph = inventoryOf(standardHost({ sessions: 1, orphan: true }));
  eq(orph.inv.sessions[0].parent_is_server, false, 'a reparented session reports parent_is_server false');
})();

// =====================================================
// 3. Inventory detail: identity, children, truncation
// =====================================================

(function inventoryDetail() {
  var root = standardHost({ sessions: 1 });
  writeProc(root, { pid: 250, comm: 'child', ppid: 200, argv: ['/bin/sh'] });
  var r = inventoryOf(root);
  var s = r.inv.sessions[0];
  eq(s.children, 1, 'a session with a live child reports it');
  eq(s.key, '200:1000', 'the session key is pid:start_ticks, not pid alone');
  eq(s.session_ref, 'aaaaaaaa-0000-4000-8000-000000000000', 'the session uuid is extracted from --resume=');

  eq(guard.sessionRef('x --session-id 11111111-2222-4333-8444-555555555555 y'),
    '11111111-2222-4333-8444-555555555555', 'sessionRef also reads --session-id <uuid>');
  eq(guard.sessionRef('/root/.claude/remote/ccd-cli/2.1.255 --verbose'), null, 'sessionRef is null when the argv carries no uuid');

  // The real argv carries a multi-KiB --settings blob; nothing stored may
  // grow with it.
  var big = newProc(200000);
  writeProc(big, { pid: 100, comm: 'server', ppid: 1, argv: SERVER_ARGV });
  writeProc(big, { pid: 201, comm: 'x', ppid: 100, argv: sessionArgv(null).concat(['--settings', new Array(4000).join('z')]) });
  var bigInv = inventoryOf(big, { cmdline_limit: 200 });
  eq(bigInv.inv.sessions[0].cmdline.length, 200, 'a stored cmdline is truncated to cmdline_limit');
  eq(bigInv.inv.sessions[0].kind, 'remote-session', 'truncation happens after classification, not before');

  // Transcript linkage: readable => timestamp, unreadable => null, never wrong.
  var tRoot = path.join(TMP, 'transcripts-' + procSeq);
  fs.mkdirSync(path.join(tRoot, 'project-a'), { recursive: true });
  fs.writeFileSync(path.join(tRoot, 'project-a', 'aaaaaaaa-0000-4000-8000-000000000000.jsonl'), '{}\n');
  var withT = inventoryOf(standardHost({ sessions: 1 }), { transcript_root: tRoot });
  ok(typeof withT.inv.sessions[0].transcript_mtime_ms === 'number', 'a readable transcript yields an mtime');
  eq(guard.transcriptMtimeMs('aaaaaaaa-0000-4000-8000-000000000000', { transcript_root: '/nonexistent' }), null,
    'an unreadable transcript root yields null, not an error');
  eq(withT.inv.sessions.filter(function (s) { return s.transcript_mtime_ms === undefined; }).length, 0,
    'transcript linkage is always present as a field');
})();

// =====================================================
// 4. Lifecycle tracking
// =====================================================

var HOUR = 3600 * 1000;

// Runs observe() over a list of (proc-root, timestamp) steps and returns
// the final state plus every event.
function track(steps, cfgExtra) {
  var st = null;
  var events = [];
  var last = null;
  steps.forEach(function (step) {
    var cfg = guard.config(cfgFor(step.root, cfgExtra));
    var inv = guard.inventory(guard.scan(Object.assign({}, cfg, { now: step.at })), cfg);
    inv.at = step.at;
    var r = guard.observe(st, inv, cfg);
    st = r.state;
    events = events.concat(r.events);
    last = { state: st, inv: inv, cfg: cfg };
  });
  return { state: st, events: events, inv: last.inv, cfg: last.cfg };
}

(function lifecycle() {
  var t0 = Date.parse('2026-09-03T10:00:00Z');
  var root = standardHost({ sessions: 1 });

  // First sighting: last_active_at is NOW, not the process start. "No
  // history" must never read as "idle since boot".
  var one = track([{ root: root, at: t0 }]);
  var rec = one.state.sessions['200:1000'];
  eq(rec.state, 'active', 'a newly seen session starts active');
  eq(rec.observations, 1, 'first sighting counts one observation');
  eq(rec.last_active_at, new Date(t0).toISOString(), 'first sighting anchors last_active_at at now');
  eq(one.events.filter(function (e) { return e.event === 'session_seen'; }).length, 1, 'first sighting emits session_seen');

  // Unchanged CPU + RSS across an idle window => idle.
  var idle = track([{ root: root, at: t0 }, { root: root, at: t0 + 2 * HOUR }]);
  var idleRec = idle.state.sessions['200:1000'];
  eq(idleRec.state, 'idle', 'no CPU or RSS movement across the window makes a session idle');
  eq(idleRec.observations, 2, 'the second sighting is counted');
  ok(idle.events.some(function (e) { return e.event === 'session_state' && e.to === 'idle'; }),
    'the active -> idle transition is recorded');

  // CPU movement keeps it active — the "never kill a working session" signal.
  var busy = standardHost({ sessions: 1 });
  var busyLater = standardHost({ sessions: 1 });
  writeProc(busyLater, { pid: 200, comm: '2.1.255', ppid: 100, rss_mib: 150, starttime: 1000, utime: 9999, stime: 100, argv: sessionArgv('aaaaaaaa-0000-4000-8000-000000000000') });
  var active = track([{ root: busy, at: t0 }, { root: busyLater, at: t0 + 2 * HOUR }]);
  eq(active.state.sessions['200:1000'].state, 'active', 'CPU movement keeps a session active across an idle window');
  eq(guard.ageSeconds({ start_ticks: 1000 }, 200000, { clock_ticks: 100 }), 199990, 'session age is derived from starttime');

  // RSS movement above the threshold is activity; below it is noise.
  var grown = standardHost({ sessions: 1 });
  writeProc(grown, { pid: 200, comm: '2.1.255', ppid: 100, rss_mib: 300, starttime: 1000, utime: 1000, stime: 100, argv: sessionArgv('aaaaaaaa-0000-4000-8000-000000000000') });
  eq(track([{ root: busy, at: t0 }, { root: grown, at: t0 + 2 * HOUR }]).state.sessions['200:1000'].state, 'active',
    'a large RSS change counts as activity');
  var nudged = standardHost({ sessions: 1 });
  writeProc(nudged, { pid: 200, comm: '2.1.255', ppid: 100, rss_mib: 152, starttime: 1000, utime: 1000, stime: 100, argv: sessionArgv('aaaaaaaa-0000-4000-8000-000000000000') });
  eq(track([{ root: busy, at: t0 }, { root: nudged, at: t0 + 2 * HOUR }]).state.sessions['200:1000'].state, 'idle',
    'an RSS change below rss_activity_mib is noise, not activity');

  // A session that disappears is recorded exactly once.
  var gone = standardHost({ sessions: 0 });
  var exited = track([{ root: root, at: t0 }, { root: gone, at: t0 + 60000 }, { root: gone, at: t0 + 120000 }]);
  eq(exited.events.filter(function (e) { return e.event === 'session_exited'; }).length, 1,
    'a vanished session emits session_exited exactly once');
  eq(exited.state.sessions['200:1000'].state, 'exited', 'the exited record keeps its terminal state');

  // ...and is dropped after the retention window, so state cannot grow.
  var pruned = track([{ root: root, at: t0 }, { root: gone, at: t0 + 60000 }, { root: gone, at: t0 + 48 * HOUR }]);
  eq(pruned.state.sessions['200:1000'], undefined, 'an exited record is pruned after session_retention_ms');

  // PID reuse: same pid, different starttime => a different session, with
  // no inherited idle history.
  var reused = standardHost({ sessions: 0 });
  writeProc(reused, { pid: 200, comm: '2.1.255', ppid: 100, rss_mib: 150, starttime: 777777, utime: 5, stime: 5, argv: sessionArgv(null) });
  var reuse = track([{ root: root, at: t0 }, { root: reused, at: t0 + 3 * HOUR }]);
  eq(reuse.state.sessions['200:777777'].state, 'active', 'a recycled pid is tracked as a new, active session');
  eq(reuse.state.sessions['200:1000'].state, 'exited', 'the previous incarnation of that pid is marked exited');
  eq(reuse.state.sessions['200:777777'].last_active_at, new Date(t0 + 3 * HOUR).toISOString(),
    'the recycled pid inherits no idle history from its predecessor');
})();

// =====================================================
// 5. Planning: idle cleanup and the fences
// =====================================================

// Builds a tracked state where every session has been idle for
// `idleFor` ms and observed at least twice, then plans against it.
function planAfterIdle(root, idleForMs, cfgExtra, t0) {
  t0 = t0 || Date.parse('2026-09-03T10:00:00Z');
  var tracked = track([{ root: root, at: t0 }, { root: root, at: t0 + idleForMs }], cfgExtra);
  var cfg = guard.config(cfgFor(root, cfgExtra));
  var inv = guard.inventory(guard.scan(cfg), cfg);
  inv.at = t0 + idleForMs;
  return { plan: guard.plan(tracked.state, inv, cfg), state: tracked.state, inv: inv, cfg: cfg };
}

(function idleCleanup() {
  var root = standardHost({ sessions: 1 });

  var p = planAfterIdle(root, 2 * HOUR).plan;
  eq(p.actions.length, 1, 'an idle session past the threshold produces exactly one action');
  eq(p.actions[0].signal, 'SIGTERM', 'idle cleanup uses SIGTERM first, never SIGKILL');
  eq(p.actions[0].reason, 'idle_timeout', 'the action carries its reason');
  eq(p.actions[0].pid, 200, 'the action names the session pid');
  ok(p.actions[0].evidence.idle_seconds >= 3600, 'the action carries the measured idle seconds as evidence');
  eq(p.actions[0].evidence.threshold_seconds, 3600, 'the action carries the threshold it was judged against');
  eq(p.actions[0].evidence.session_ref, 'aaaaaaaa-0000-4000-8000-000000000000', 'the action names the session uuid');
  eq(p.dry_run, true, 'a plan is a dry run unless enforcement is configured');
  eq(p.counts.total, 1, 'the plan counts the live sessions');

  // The single most important negative: an ACTIVE session is never planned.
  var busyLater = standardHost({ sessions: 1 });
  writeProc(busyLater, { pid: 200, comm: '2.1.255', ppid: 100, rss_mib: 150, starttime: 1000, utime: 99999, stime: 100, argv: sessionArgv('aaaaaaaa-0000-4000-8000-000000000000') });
  var t0 = Date.parse('2026-09-03T10:00:00Z');
  var trackedBusy = track([{ root: standardHost({ sessions: 1 }), at: t0 }, { root: busyLater, at: t0 + 2 * HOUR }]);
  var cfgB = guard.config(cfgFor(busyLater));
  var invB = guard.inventory(guard.scan(cfgB), cfgB);
  invB.at = t0 + 2 * HOUR;
  var pb = guard.plan(trackedBusy.state, invB, cfgB);
  eq(pb.actions.length, 0, 'a session with real CPU activity is never planned for termination');
  ok(pb.vetoes.some(function (v) { return v.reason === 'recent_activity'; }) || pb.vetoes.length === 0,
    'an active session is either vetoed as recent_activity or never considered');

  // Fences, one at a time.
  var single = guard.plan(track([{ root: root, at: t0 }]).state,
    (function () { var c = guard.config(cfgFor(root)); var i = guard.inventory(guard.scan(c), c); i.at = t0 + 2 * HOUR; return i; })(),
    guard.config(cfgFor(root)));
  ok(single.vetoes.some(function (v) { return v.reason === 'single_observation'; }),
    'a session seen only once is vetoed, whatever its apparent idleness');
  eq(single.actions.length, 0, 'a single observation never produces an action');

  var young = planAfterIdle(root, 2 * HOUR, { min_age_seconds: 10 * 1000 * 1000 });
  ok(young.plan.vetoes.some(function (v) { return v.reason === 'below_min_age'; }), 'a session below min_age_seconds is vetoed');
  eq(young.plan.actions.length, 0, 'min_age_seconds blocks the action');

  var withChild = standardHost({ sessions: 1 });
  writeProc(withChild, { pid: 260, comm: 'child', ppid: 200, argv: ['/bin/sh'] });
  var childPlan = planAfterIdle(withChild, 2 * HOUR);
  ok(childPlan.plan.vetoes.some(function (v) { return v.reason === 'has_child_processes'; }),
    'an idle session with a live child is vetoed');
  eq(childPlan.plan.actions.length, 0, 'a session with children is never terminated');

  var prot = planAfterIdle(root, 2 * HOUR, { protect_pids: [200] });
  ok(prot.plan.vetoes.some(function (v) { return v.reason === 'pid_explicitly_protected'; }), 'an explicitly protected pid is vetoed');
  eq(prot.plan.actions.length, 0, 'protect_pids blocks the action');

  // The executor must never be reachable by any rule, even when the host
  // is deeply idle and over every limit.
  var many = planAfterIdle(standardHost({ sessions: 8 }), 4 * HOUR, { max_terminations_per_run: 99, max_sessions: 1 });
  ok(many.plan.actions.every(function (a) { return a.pid !== 700 && a.pid !== 701; }),
    'no plan, under any pressure, ever targets an executor process');
  ok(many.plan.actions.every(function (a) { return a.pid !== 100 && a.pid !== 101; }),
    'no plan ever targets the remote server or its bridge helper');
  ok(many.plan.actions.every(function (a) { return a.pid >= 200 && a.pid < 300; }),
    'every planned target is a ccd-cli session');
})();

// =====================================================
// 6. Orphan cleanup
// =====================================================

(function orphans() {
  var t0 = Date.parse('2026-09-03T10:00:00Z');
  var root = standardHost({ sessions: 1, orphan: true });

  // Grace not yet elapsed: seen, tracked, not touched.
  var early = track([{ root: root, at: t0 }, { root: root, at: t0 + 60 * 1000 }]);
  var cfgE = guard.config(cfgFor(root));
  var invE = guard.inventory(guard.scan(cfgE), cfgE);
  invE.at = t0 + 60 * 1000;
  var pe = guard.plan(early.state, invE, cfgE);
  eq(pe.actions.length, 0, 'an orphan inside the grace window is not terminated');
  eq(early.state.sessions['200:1000'].state, 'active', 'an orphan inside the grace window is not yet labelled orphaned');

  // Grace elapsed: orphaned, and reclaimable without waiting for the full
  // idle timeout — nothing can ever reconnect to it.
  var late = track([{ root: root, at: t0 }, { root: root, at: t0 + 20 * 60 * 1000 }]);
  eq(late.state.sessions['200:1000'].state, 'orphaned', 'an orphan past the grace window is labelled orphaned');
  var cfgL = guard.config(cfgFor(root));
  var invL = guard.inventory(guard.scan(cfgL), cfgL);
  invL.at = t0 + 20 * 60 * 1000;
  var pl = guard.plan(late.state, invL, cfgL);
  eq(pl.actions.length, 1, 'a settled orphan produces one action');
  eq(pl.actions[0].reason, 'orphaned', 'the orphan action carries reason=orphaned');
  eq(pl.actions[0].signal, 'SIGTERM', 'an orphan is asked to leave before it is killed');
  ok(pl.actions[0].evidence.orphan_since, 'the orphan action carries orphan_since as evidence');
  eq(pl.counts.orphaned, 1, 'the report counts orphaned sessions');

  // A server that comes back clears the orphan clock.
  var back = standardHost({ sessions: 1 });
  var recovered = track([{ root: root, at: t0 }, { root: root, at: t0 + 60000 }, { root: back, at: t0 + 120000 }]);
  eq(recovered.state.sessions['200:1000'].orphan_since, null, 'a reattached session clears its orphan clock');
})();

// =====================================================
// 7. Concurrency guard
// =====================================================

(function concurrency() {
  var t0 = Date.parse('2026-09-03T10:00:00Z');

  // Over the cap but every session busy: reported, never acted on.
  var busyRoot = standardHost({ sessions: 10 });
  var busyLater = standardHost({ sessions: 10 });
  for (var i = 0; i < 10; i++) {
    writeProc(busyLater, { pid: 200 + i, comm: '2.1.255', ppid: 100, rss_mib: 150 + i, starttime: 1000 + i, utime: 50000 + i, stime: 100, argv: sessionArgv(null) });
  }
  var trackedBusy = track([{ root: busyRoot, at: t0 }, { root: busyLater, at: t0 + 20 * 60 * 1000 }]);
  var cfgB = guard.config(cfgFor(busyLater));
  var invB = guard.inventory(guard.scan(cfgB), cfgB);
  invB.at = t0 + 20 * 60 * 1000;
  var pb = guard.plan(trackedBusy.state, invB, cfgB);
  eq(pb.concurrency.sessions, 10, 'the concurrency report counts every session');
  eq(pb.concurrency.max_sessions, 6, 'the default ceiling is 6 concurrent sessions');
  eq(pb.concurrency.over_limit, true, 'exceeding the ceiling is reported');
  eq(pb.concurrency.over_by, 4, 'the report says by how much');
  eq(pb.actions.length, 0, 'a ceiling breach never terminates a busy session');
  eq(pb.concurrency.unreclaimable, 4, 'the excess that could not be reclaimed is reported, not hidden');

  // Over the cap with quiet sessions: exactly the excess is reclaimed —
  // not one more — and only sessions past the concurrency idle floor.
  var quiet = standardHost({ sessions: 10 });
  var quietPlan = planAfterIdle(quiet, 20 * 60 * 1000, { max_terminations_per_run: 99 });
  eq(quietPlan.plan.concurrency.over_by, 4, 'four sessions over the ceiling');
  eq(quietPlan.plan.actions.length, 4, 'exactly the excess is reclaimed, never the whole population');
  ok(quietPlan.plan.actions.every(function (a) { return a.reason === 'concurrency_limit'; }),
    'the ceiling actions are labelled concurrency_limit');
  eq(quietPlan.plan.actions[0].evidence.threshold_seconds, 600, 'the ceiling action records its own idle floor');

  // Below the ceiling's idle floor, a breach reclaims nothing.
  var fresh = planAfterIdle(standardHost({ sessions: 10 }), 60 * 1000, { max_terminations_per_run: 99 });
  eq(fresh.plan.actions.length, 0, 'a session quiet for under concurrency_idle_seconds is never reclaimed for the ceiling');
  eq(fresh.plan.concurrency.unreclaimable, 4, 'the unresolved breach is reported instead');

  // The hard cap cannot be configured away.
  var clamped = guard.config({ max_sessions: 20 });
  eq(clamped.max_sessions, 8, 'a configured ceiling above the hard cap is clamped to 8');
  eq(clamped.max_sessions_clamped, true, 'the clamp is visible in the config');
  eq(guard.config({ max_sessions: 4 }).max_sessions, 4, 'a lower ceiling is honoured');
  eq(guard.config({ hard_max_sessions: 64 }).hard_max_sessions, 8, 'the hard cap itself cannot be raised');

  // Advisory admission.
  eq(guard.admission({ counts: { total: 6 }, pressure_level: 'NORMAL' }, {}).admit, false, 'admission closes at the ceiling');
  eq(guard.admission({ counts: { total: 6 }, pressure_level: 'NORMAL' }, {}).reason, 'concurrency_limit', 'and says why');
  eq(guard.admission({ counts: { total: 2 }, pressure_level: 'NORMAL' }, {}).admit, true, 'admission is open below the ceiling');
  eq(guard.admission({ counts: { total: 2 }, pressure_level: 'NORMAL' }, {}).advisory, true,
    'admission is always flagged advisory: the remote server exposes no admission hook');
})();

// =====================================================
// 8. Memory-pressure guard
// =====================================================

(function memoryPressure() {
  var root = standardHost({ sessions: 2 });
  var idleFor = 20 * 60 * 1000;   // 20 min: under the 1h timeout, over the 15m pressure timeout

  var normal = planAfterIdle(root, idleFor, { max_sessions: 99, pressure_level: 'NORMAL' });
  eq(normal.plan.actions.length, 0, 'at NORMAL a 20-minute-quiet session is left alone');
  eq(normal.plan.idle_threshold_seconds, 3600, 'the standing idle threshold is one hour');

  var critical = planAfterIdle(root, idleFor, { max_sessions: 99, pressure_level: 'CRITICAL' });
  eq(critical.plan.idle_threshold_seconds, 900, 'CRITICAL lowers the idle threshold to pressure_idle_seconds');
  eq(critical.plan.actions.length, 2, 'under CRITICAL the same quiet sessions become reclaimable');
  eq(critical.plan.actions[0].reason, 'idle_timeout_under_pressure', 'pressure-driven reclamation is labelled as such');
  eq(critical.plan.actions[0].evidence.pressure_level, 'CRITICAL', 'the pressure level is recorded as evidence');
  ok(critical.plan.reclaimable_mib > 0, 'the plan reports how much memory it would reclaim');

  var warning = planAfterIdle(root, idleFor, { max_sessions: 99, pressure_level: 'WARNING' });
  eq(warning.plan.actions.length, 2, 'WARNING also lowers the threshold — reclamation starts before OOM, not after');

  // Pressure lowers the threshold; it never removes a fence.
  var busyUnderPressure = standardHost({ sessions: 1 });
  writeProc(busyUnderPressure, { pid: 260, comm: 'child', ppid: 200, argv: ['/bin/sh'] });
  var pp = planAfterIdle(busyUnderPressure, idleFor, { pressure_level: 'CRITICAL' });
  eq(pp.plan.actions.length, 0, 'even at CRITICAL a session with a live child is not reclaimed');

  eq(guard.admission({ counts: { total: 1 }, pressure_level: 'CRITICAL' }, {}).admit, false, 'admission closes under CRITICAL');
  eq(guard.admission({ counts: { total: 1 }, pressure_level: 'CRITICAL' }, {}).reason, 'memory_pressure', 'and names memory pressure');
})();

// =====================================================
// 9. Blast radius, enforcement and identity re-verification
// =====================================================

(function enforcement() {
  var root = standardHost({ sessions: 8 });
  var p = planAfterIdle(root, 4 * HOUR, { max_sessions: 99 });

  eq(p.plan.actions.length, 3, 'no run may terminate more than max_terminations_per_run sessions');
  ok(p.plan.vetoes.some(function (v) { return v.reason === 'max_terminations_per_run'; }),
    'the deferred excess is recorded as a veto, not silently dropped');

  // Dry run signals nothing.
  var calls = [];
  var dry = guard.enforce(p.plan, p.state, guard.config(cfgFor(root, { enforce: false })),
    function (pid, sig) { calls.push([pid, sig]); });
  eq(calls.length, 0, 'a dry run never signals a process');
  ok(dry.results.every(function (r) { return r.outcome === 'dry_run' && r.applied === false; }), 'every dry-run result says so');

  // Enforced run signals exactly the planned pids.
  calls = [];
  var live = guard.enforce(p.plan, p.state, guard.config(cfgFor(root, { enforce: true })),
    function (pid, sig) { calls.push([pid, sig]); });
  eq(calls.length, 3, 'an enforced run signals exactly the planned actions');
  ok(calls.every(function (c) { return c[1] === 'SIGTERM'; }), 'the first signal is always SIGTERM');
  ok(calls.every(function (c) { return c[0] >= 200 && c[0] < 300; }), 'only ccd-cli session pids are signalled');
  ok(live.results.every(function (r) { return r.applied && r.outcome === 'signalled'; }), 'each signalled action is recorded as applied');
  eq(live.events.filter(function (e) { return e.event === 'terminate_signalled'; }).length, 3, 'each termination is written to the ledger');
  ok(live.events.every(function (e) { return e.event !== 'terminate_signalled' || e.evidence; }),
    'every ledger termination carries its evidence');
  eq(live.state.sessions[p.plan.actions[0].key].state, 'terminating', 'a signalled session enters the terminating state');
  ok(live.state.sessions[p.plan.actions[0].key].terminate.signalled_at, 'the signal time is persisted for the escalation window');

  // Identity re-verification, immediately before the signal.
  var check = guard.verifyIdentity({ pid: 200, key: '200:1000' }, guard.config(cfgFor(root)));
  eq(check.ok, true, 'verifyIdentity accepts the same incarnation');
  eq(guard.verifyIdentity({ pid: 200, key: '200:999999' }, guard.config(cfgFor(root))).reason, 'pid_reused',
    'verifyIdentity refuses a recycled pid');
  eq(guard.verifyIdentity({ pid: 55555, key: '55555:1' }, guard.config(cfgFor(root))).reason, 'process_gone',
    'verifyIdentity refuses a pid that has already exited');
  eq(guard.verifyIdentity({ pid: 701, key: '701:1000' }, guard.config(cfgFor(root))).reason, 'is_executor_subprocess',
    'verifyIdentity refuses an executor subprocess even if a plan named it');

  // A pid recycled between plan and enforce is NOT signalled.
  var swapped = standardHost({ sessions: 0 });
  writeProc(swapped, { pid: 200, comm: '2.1.255', ppid: 100, rss_mib: 150, starttime: 424242, utime: 1, stime: 1, argv: sessionArgv(null) });
  calls = [];
  var reuse = guard.enforce(
    { at: new Date().toISOString(), actions: [{ key: '200:1000', pid: 200, signal: 'SIGTERM', reason: 'idle_timeout', evidence: {} }], vetoes: [] },
    p.state, guard.config(cfgFor(swapped, { enforce: true })), function (pid, sig) { calls.push([pid, sig]); });
  eq(calls.length, 0, 'a pid recycled between plan and enforce is never signalled');
  eq(reuse.results[0].outcome, 'pid_reused', 'the aborted signal is recorded with its reason');
  eq(reuse.events[0].event, 'terminate_aborted', 'the abort reaches the ledger');

  // A process that exits between plan and enforce is a clean no-op.
  calls = [];
  var vanished = guard.enforce(
    { at: new Date().toISOString(), actions: [{ key: '200:1000', pid: 200, signal: 'SIGTERM', reason: 'idle_timeout', evidence: {} }], vetoes: [] },
    p.state, guard.config(cfgFor(standardHost({ sessions: 0 }), { enforce: true })), function (pid, sig) { calls.push([pid, sig]); });
  eq(calls.length, 0, 'a session that exited on its own is not signalled');
  eq(vanished.results[0].outcome, 'process_gone', 'its disappearance is recorded');

  // A signal that fails is reported honestly.
  calls = [];
  var failed = guard.enforce(
    { at: new Date().toISOString(), actions: [{ key: '200:1000', pid: 200, signal: 'SIGTERM', reason: 'idle_timeout', evidence: {} }], vetoes: [] },
    p.state, guard.config(cfgFor(root, { enforce: true })),
    function () { var e = new Error('no such process'); e.code = 'ESRCH'; throw e; });
  eq(failed.results[0].applied, false, 'a failed signal is not reported as applied');
  eq(failed.results[0].outcome, 'process_gone', 'ESRCH is reported as the process being gone');
  eq(failed.events[0].event, 'terminate_failed', 'a failed termination reaches the ledger');
})();

// =====================================================
// 10. SIGTERM -> SIGKILL escalation
// =====================================================

(function escalation() {
  var root = standardHost({ sessions: 1 });
  var t0 = Date.parse('2026-09-03T10:00:00Z');
  var tracked = track([{ root: root, at: t0 }, { root: root, at: t0 + 2 * HOUR }]);
  var key = '200:1000';

  function planAt(offsetMs, extra) {
    var st = JSON.parse(JSON.stringify(tracked.state));
    st.sessions[key].terminate = { signalled_at: new Date(t0 + 2 * HOUR).toISOString(), reason: 'idle_timeout', evidence: {} };
    st.sessions[key].state = 'terminating';
    var cfg = guard.config(cfgFor(root, extra));
    var inv = guard.inventory(guard.scan(cfg), cfg);
    inv.at = t0 + 2 * HOUR + offsetMs;
    return guard.plan(st, inv, cfg);
  }

  var early = planAt(30 * 1000);
  eq(early.actions.length, 0, 'a session inside the SIGTERM grace window is left to exit on its own');
  eq(early.counts.terminating, 1, 'it is reported as terminating');

  var late = planAt(300 * 1000);
  eq(late.actions.length, 1, 'a session that ignored SIGTERM past the grace window is escalated');
  eq(late.actions[0].signal, 'SIGKILL', 'the escalation is SIGKILL');
  eq(late.actions[0].reason, 'sigterm_ignored', 'the escalation carries its reason');
  eq(late.actions[0].evidence.original_reason, 'idle_timeout', 'the escalation preserves the original termination reason');
  ok(late.actions[0].evidence.waited_seconds >= 120, 'the escalation records how long it waited');

  var never = planAt(300 * 1000, { escalate: false });
  eq(never.actions.length, 0, 'escalate:false disables SIGKILL entirely');
  ok(never.vetoes.some(function (v) { return v.reason === 'escalation_disabled'; }), 'and the refusal is recorded');

  // A session burning CPU while shutting down must still be escalatable —
  // the idle floor does not apply to a termination already started.
  var shuttingDown = standardHost({ sessions: 0 });
  writeProc(shuttingDown, { pid: 200, comm: '2.1.255', ppid: 100, rss_mib: 150, starttime: 1000, utime: 99999, stime: 100, argv: sessionArgv(null) });
  var st2 = JSON.parse(JSON.stringify(tracked.state));
  st2.sessions[key].terminate = { signalled_at: new Date(t0 + 2 * HOUR).toISOString(), reason: 'idle_timeout', evidence: {} };
  var cfg2 = guard.config(cfgFor(shuttingDown));
  var inv2 = guard.inventory(guard.scan(cfg2), cfg2);
  inv2.at = t0 + 2 * HOUR + 300 * 1000;
  eq(guard.plan(st2, inv2, cfg2).actions.length, 1, 'CPU spent shutting down does not block the SIGKILL escalation');

  // A session that exits after SIGTERM is recorded as guard-terminated.
  var stGone = JSON.parse(JSON.stringify(tracked.state));
  stGone.sessions[key].terminate = { signalled_at: new Date(t0 + 2 * HOUR).toISOString(), reason: 'idle_timeout', evidence: {} };
  var goneCfg = guard.config(cfgFor(standardHost({ sessions: 0 })));
  var goneInv = guard.inventory(guard.scan(goneCfg), goneCfg);
  goneInv.at = t0 + 3 * HOUR;
  var obs = guard.observe(stGone, goneInv, goneCfg);
  var exitEvent = obs.events.filter(function (e) { return e.event === 'session_exited'; })[0];
  eq(exitEvent.terminated_by_guard, true, 'an exit after a guard SIGTERM is attributed to the guard');
  eq(exitEvent.reason, 'idle_timeout', 'and keeps the reason it was terminated for');
})();

// =====================================================
// 11. Kill switch, enable marker, fail-closed posture
// =====================================================

(function switches() {
  var marker = path.join(TMP, 'enable-marker');
  delete process.env.MYTHOS_SESSION_GUARD;

  eq(guard.enforcementEnabled({ enable_marker_path: marker }).enabled, false, 'enforcement is off while the marker is absent');
  eq(guard.enforcementEnabled({ enable_marker_path: marker }).reason, 'marker_absent', 'and says why');
  fs.writeFileSync(marker, '');
  eq(guard.enforcementEnabled({ enable_marker_path: marker }).enabled, true, 'touching the marker enables enforcement');

  process.env.MYTHOS_SESSION_GUARD = 'off';
  eq(guard.enforcementEnabled({ enable_marker_path: marker }).enabled, false, 'the kill switch overrides the marker');
  eq(guard.enforcementEnabled({ enable_marker_path: marker }).reason, 'kill_switch_env', 'and names the kill switch');
  process.env.MYTHOS_SESSION_GUARD = 'on';
  eq(guard.enforcementEnabled({}).enabled, true, 'MYTHOS_SESSION_GUARD=on enables without a marker');
  delete process.env.MYTHOS_SESSION_GUARD;
  fs.unlinkSync(marker);
  eq(guard.enforcementEnabled({ enable_marker_path: marker }).enabled, false, 'removing the marker is the rollback');
  eq(guard.enforcementEnabled({}).enabled, false, 'with no marker configured at all, enforcement stays off');

  // Fail CLOSED. Unreadable telemetry means we cannot prove anything, so
  // nothing is signalled — the opposite of the Resource Guard, which must
  // fail open so it never blocks MYTHOS work.
  var missing = guard.scan({ proc_root: path.join(TMP, 'does-not-exist') });
  ok(missing.error, 'an unreadable /proc reports an error');
  eq(missing.procs.length, 0, 'and yields no processes');
  var emptyInv = guard.inventory(missing, {});
  eq(guard.plan(null, emptyInv, {}).actions.length, 0, 'an unreadable /proc produces no actions');

  // A process whose stat is unreadable is skipped entirely rather than
  // being judged on partial evidence.
  var partial = standardHost({ sessions: 1 });
  fs.unlinkSync(path.join(partial, '200', 'stat'));
  eq(inventoryOf(partial).inv.sessions.length, 0, 'a session with unreadable stat is not judged at all');

  // A corrupt state file restarts tracking rather than throwing.
  var stateFile = path.join(TMP, 'corrupt-state.json');
  fs.writeFileSync(stateFile, '{not json');
  eq(guard.readState({ state_path: stateFile }), null, 'a corrupt state file reads as null');
  var runCorrupt = guard.run(cfgFor(standardHost({ sessions: 1 }), { state_path: stateFile, ledger_path: path.join(TMP, 'corrupt.jsonl') }));
  eq(runCorrupt.ok, true, 'a run over a corrupt state file still completes');
  eq(runCorrupt.plan.actions.length, 0, 'and starts from no history, so it signals nothing');
})();

// =====================================================
// 12. Full cycle: persistence and the ledger
// =====================================================

(function fullCycle() {
  var home = path.join(TMP, 'home');
  var cfg = cfgFor(standardHost({ sessions: 2 }), {
    state_path: path.join(home, 'session-guard.json'),
    ledger_path: path.join(home, 'session-guard.jsonl')
  });

  var r1 = guard.run(cfg);
  eq(r1.ok, true, 'run() completes');
  eq(r1.plan.actions.length, 0, 'the first run of a fresh host signals nothing');
  ok(fs.existsSync(cfg.state_path), 'run() persists its state');
  ok(fs.existsSync(cfg.ledger_path), 'run() appends to the ledger');

  var persisted = JSON.parse(fs.readFileSync(cfg.state_path, 'utf8'));
  eq(Object.keys(persisted.sessions).length, 2, 'both sessions are tracked in the persisted state');
  eq(fs.statSync(cfg.state_path).mode & 0o777, 0o600, 'the state file is private to its owner');

  var lines = fs.readFileSync(cfg.ledger_path, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  eq(lines.filter(function (e) { return e.event === 'session_seen'; }).length, 2, 'each new session is recorded once in the ledger');
  ok(lines.every(function (e) { return e.at && e.event; }), 'every ledger line carries a timestamp and an event');

  var r2 = guard.run(cfg);
  eq(r2.ok, true, 'a second run over the same state completes');
  eq(r2.plan.counts.total, 2, 'and still sees both sessions');
  eq(r2.plan.actions.length, 0, 'and still signals nothing, because nothing has gone idle');

  var rep = guard.report(r2);
  eq(rep.counts.total, 2, 'the report counts sessions');
  eq(rep.planned_terminations.length, 0, 'the report lists planned terminations');
  ok(rep.resident_mib > 0, 'the report totals the memory the sessions hold');
  eq(rep.enforce, false, 'the report states whether enforcement is on');

  // run() never throws, whatever it is handed.
  var broken = guard.run({ proc_root: 12345 });
  eq(broken.plan.actions.length, 0, 'a run over a nonsense config produces no actions');
})();

// =====================================================
// 13. The read-only snapshot and the executor's HTTP view
// =====================================================

(function observationIsFree() {
  var home = path.join(TMP, 'snapshot-home');
  var root = standardHost({ sessions: 2 });
  var cfg = cfgFor(root, {
    state_path: path.join(home, 'session-guard.json'),
    ledger_path: path.join(home, 'session-guard.jsonl')
  });

  guard.run(cfg);                                     // establish tracked state
  var before = fs.readFileSync(cfg.state_path, 'utf8');
  var ledgerBefore = fs.readFileSync(cfg.ledger_path, 'utf8');

  var snap = guard.snapshot(cfg);
  eq(snap.ok, true, 'snapshot() completes against persisted state');
  eq(snap.plan.counts.total, 2, 'snapshot() sees the live sessions');
  eq(snap.state_tracked, 2, 'snapshot() reports how many sessions are tracked');
  eq(snap.plan.dry_run, true, 'a snapshot is always a dry run');
  eq(fs.readFileSync(cfg.state_path, 'utf8'), before, 'snapshot() does not write the state file');
  eq(fs.readFileSync(cfg.ledger_path, 'utf8'), ledgerBefore, 'snapshot() does not append to the ledger');

  // Even handed an enforcing config, a snapshot must stay a dry run: the
  // HTTP view must never become a way to signal a process.
  var forced = guard.snapshot(cfgFor(root, { state_path: cfg.state_path, enforce: true }));
  eq(forced.plan.enforce, false, 'snapshot() refuses to report itself as enforcing');
  eq(forced.plan.dry_run, true, 'snapshot() stays a dry run even when handed enforce:true');

  eq(guard.snapshot({ proc_root: 999 }).ok, false, 'a snapshot over a nonsense config fails softly');
  eq(guard.snapshot({ proc_root: 999 }).plan.actions.length, 0, 'and still produces no actions');

  // The executor's view is read-only and never throws, whatever the host
  // looks like from inside the service.
  var executor = require(path.join(EXEC, 'executor'));
  var view = executor.sessionGuardStatus();
  eq(typeof view, 'object', 'the executor exposes a session guard view');
  eq(view.available, true, 'the view reports itself available');
  eq(view.enforce, false, 'the executor never reports itself as enforcing');
  ok(view.counts && typeof view.counts.total === 'number', 'the view carries active/idle/orphaned counts');
  ok(view.enforcement && typeof view.enforcement.enabled === 'boolean', 'the view states whether enforcement is enabled');
  eq(view.enforcement.enabled, false, 'enforcement is off in the executor by default');
  eq(view.planned_terminations.length, 0, 'the executor view plans no terminations against an untracked host');

  // The route is wired and read-only.
  var serverSrc = fs.readFileSync(path.join(EXEC, 'server.js'), 'utf8');
  ok(/GET.*'\/session-guard'|url === '\/session-guard'/.test(serverSrc), 'server.js exposes GET /session-guard');
  ok(serverSrc.indexOf("'/session-guard'") > 0 && !/POST[\s\S]{0,120}'\/session-guard'/.test(serverSrc),
    'there is no POST /session-guard: the HTTP surface cannot terminate a session');
  var execSrc = fs.readFileSync(path.join(EXEC, 'executor.js'), 'utf8');
  ok(execSrc.indexOf('sessionGuardStatus') > 0, 'the executor exports the session guard view');
  ok(execSrc.indexOf('sessionGuard.enforce') < 0 && execSrc.indexOf('sg.enforce(') < 0,
    'the executor never calls the guard enforcement path');
  ok(execSrc.indexOf('sg.run(') < 0, 'the executor never calls the mutating run() either');
})();

// =====================================================
// 14. Real-host regression: the actual argv shapes
// =====================================================

(function realHost() {
  var fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'session-guard', 'host-20260903.json'), 'utf8'));
  var root = newProc(fixture.uptime_seconds);
  writeProc(root, { pid: 1, comm: 'systemd', ppid: 0, argv: ['/sbin/init'] });
  fixture.processes.forEach(function (p) {
    writeProc(root, {
      pid: p.pid, ppid: p.ppid, uid: p.uid, comm: p.comm, rss_mib: p.rss_mib,
      utime: p.cpu_ticks, stime: 0, starttime: p.start_ticks,
      argv: p.cmdline.split(' ')
    });
  });

  var r = inventoryOf(root, { cmdline_limit: 400 });
  var byPid = {};
  r.inv.items.forEach(function (i) { byPid[i.pid] = i; });

  var wrong = fixture.processes.filter(function (p) { return byPid[p.pid].kind !== p.expected_kind; });
  eq(wrong.length, 0, 'every real captured process is classified as recorded (' +
    wrong.map(function (p) { return p.pid + ':' + byPid[p.pid].kind + '!=' + p.expected_kind; }).join(',') + ')');

  eq(r.inv.sessions.length, 14, 'the 2026-09-03 capture holds the 14 accumulated Desktop Remote sessions');
  eq(r.inv.servers.length, 2, 'and the --serve server plus its --bridge helper');
  ok(r.inv.executor.length >= 2, 'and the MYTHOS executor processes, classified as protected');
  ok(r.inv.sessions.every(function (s) { return s.uid === 0; }), 'every real session is root-owned');
  ok(r.inv.executor.every(function (s) { return s.uid === 1001; }), 'every real executor process is deploy-owned');
  ok(r.inv.sessions.reduce(function (t, s) { return t + s.rss_mib; }, 0) > 2000,
    'the captured sessions held over 2 GiB — the memory this guard exists to bound');
  ok(r.inv.sessions.filter(function (s) { return s.session_ref; }).length > 0,
    'real sessions carry an extractable session uuid');

  // The real capture, tracked and planned: still nothing on first sight.
  var t0 = Date.parse(fixture.captured_at);
  var tracked = track([{ root: root, at: t0 }], { cmdline_limit: 400 });
  var cfg = guard.config(cfgFor(root, { cmdline_limit: 400 }));
  var inv = guard.inventory(guard.scan(cfg), cfg);
  inv.at = t0;
  var p = guard.plan(tracked.state, inv, cfg);
  eq(p.actions.length, 0, 'the real capture produces no action on first observation');
  eq(p.concurrency.over_limit, true, 'but it is correctly reported as over the ceiling');
  eq(p.concurrency.over_by, 8, 'by eight sessions');
})();

// =====================================================
// 15. The root runner and its systemd artifacts
// =====================================================

(function opsArtifacts() {
  var cp = require('child_process');
  var OPS = path.join(BASE, 'ops', 'session-guard');
  var runnerSrc = fs.readFileSync(path.join(OPS, 'mythos-session-guard-run.js'), 'utf8');

  // The runner is deployed as two root-owned files and must require
  // nothing else from the repository.
  var requires = (runnerSrc.match(/require\(([^)]+)\)/g) || []);
  ok(requires.every(function (r) { return /'fs'|'path'|'\.\/session-guard'/.test(r); }),
    'the root runner requires only fs, path and its sibling session-guard.js (' + requires.join(' ') + ')');
  ok(runnerSrc.indexOf('child_process') < 0, 'the root runner never spawns a subprocess');
  ok(runnerSrc.indexOf('/proc/meminfo') < 0,
    'the root runner does not read memory itself — it reads the Resource Guard state');

  var svc = fs.readFileSync(path.join(OPS, 'mythos-session-guard.service'), 'utf8');
  ok(/ExecStart=\/usr\/bin\/node \/usr\/local\/lib\/mythos-session-guard\//.test(svc),
    'the unit runs the installed root-owned copy, never the deploy-writable checkout');
  ok(/^User=root$/m.test(svc), 'the unit runs as root — Desktop Remote sessions are root-owned');
  ok(/^NoNewPrivileges=true$/m.test(svc), 'the unit sets NoNewPrivileges');
  ok(/^ProtectSystem=strict$/m.test(svc), 'the unit cannot write outside its state directory');
  ok(/^ReadWritePaths=\/var\/lib\/mythos-session-guard$/m.test(svc), 'and that directory is the only writable path');
  ok(/^MemoryMax=/m.test(svc), 'the guard itself is memory-capped: it may never be the cause of pressure');
  ok(/^CapabilityBoundingSet=CAP_KILL$/m.test(svc), 'the unit keeps only the capability it exists to use');
  ok(!/^\[Install\]/m.test(svc), 'the oneshot service has no [Install] section: only the timer drives it');

  var timer = fs.readFileSync(path.join(OPS, 'mythos-session-guard.timer'), 'utf8');
  ok(/^OnUnitActiveSec=/m.test(timer), 'the timer re-arms on a fixed interval');
  ok(/^Unit=mythos-session-guard\.service$/m.test(timer), 'the timer drives the guard service');
  ok(/^WantedBy=timers\.target$/m.test(timer), 'the timer is the thing that gets enabled');

  var installer = fs.readFileSync(path.join(OPS, 'install-session-guard.sh'), 'utf8');
  var syn = cp.spawnSync('bash', ['-n', path.join(OPS, 'install-session-guard.sh')], { encoding: 'utf8' });
  eq(syn.status, 0, 'the installer is valid bash (' + (syn.stderr || '').trim() + ')');
  // The marker may only appear in the printed instructions, never in a
  // command the installer executes.
  var installerCode = installer.replace(/cat <<EOF[\s\S]*?\nEOF/g, '').replace(/^#.*$/gm, '');
  ok(installerCode.indexOf('session-guard.enabled') < 0,
    'the installer never creates the enable marker: installing does not start enforcing');
  ok(installerCode.indexOf('touch ') < 0, 'the installer runs no touch at all');
  ok(/systemctl enable --now mythos-session-guard\.timer/.test(installer), 'the installer enables the timer');
  ok(/install -d -m 0700 -o root -g root "\$STATE"/.test(installer), 'the state directory is private to root');

  var slice = fs.readFileSync(path.join(OPS, 'user-0.slice.d', 'memory.conf'), 'utf8');
  ok(/^MemoryHigh=/m.test(slice), 'the slice drop-in sets a soft memory ceiling');
  ok(!/^MemoryMax=/m.test(slice),
    'the slice drop-in sets NO hard cap: a hard cap on the root login slice would OOM-kill, which is what this issue forbids');

  // End-to-end, in the INSTALLED layout, over a fixture /proc. Observe
  // mode: it must complete, write state, and signal nothing.
  var installed = path.join(TMP, 'installed');
  fs.mkdirSync(installed, { recursive: true });
  fs.copyFileSync(path.join(EXEC, 'lib', 'session-guard.js'), path.join(installed, 'session-guard.js'));
  fs.copyFileSync(path.join(OPS, 'mythos-session-guard-run.js'), path.join(installed, 'mythos-session-guard-run.js'));

  var runnerHome = path.join(TMP, 'runner-home');
  var fixtureProc = standardHost({ sessions: 2 });
  function runRunner(env) {
    var e = Object.assign({}, process.env, {
      MYTHOS_SESSION_GUARD_HOME: runnerHome,
      MYTHOS_SESSION_GUARD_PROC: fixtureProc,
      MYTHOS_SESSION_GUARD_RG_STATE: path.join(TMP, 'no-resource-guard-state.json')
    }, env || {});
    delete e.MYTHOS_SESSION_GUARD;
    if (env && env.MYTHOS_SESSION_GUARD) e.MYTHOS_SESSION_GUARD = env.MYTHOS_SESSION_GUARD;
    return cp.spawnSync(process.execPath, [path.join(installed, 'mythos-session-guard-run.js')], { encoding: 'utf8', env: e });
  }

  var r1 = runRunner();
  eq(r1.status, 0, 'the runner exits 0 in observe mode (' + (r1.stderr || '').trim() + ')');
  var line1 = JSON.parse((r1.stdout || '').trim().split('\n').pop());
  eq(line1.mode, 'observe', 'with no enable marker the runner reports observe mode');
  eq(line1.enforcement_reason, 'marker_absent', 'and says the marker is absent');
  eq(line1.counts.total, 2, 'it sees the fixture sessions');
  eq(line1.applied.length, 0, 'and applies nothing');
  eq(line1.pressure_level, 'NORMAL', 'a missing Resource Guard state reads as NORMAL, never as pressure');
  ok(fs.existsSync(path.join(runnerHome, 'session-guard.json')), 'the runner persists its state where the unit expects it');
  ok(fs.existsSync(path.join(runnerHome, 'session-guard.jsonl')), 'and writes its ledger there');

  // The kill switch beats the marker, even for the root runner.
  fs.writeFileSync(path.join(runnerHome, 'session-guard.enabled'), '');
  var r2 = runRunner({ MYTHOS_SESSION_GUARD: 'off' });
  eq(r2.status, 0, 'the runner exits 0 with the kill switch set');
  eq(JSON.parse((r2.stdout || '').trim().split('\n').pop()).mode, 'observe',
    'MYTHOS_SESSION_GUARD=off overrides the enable marker in the root runner too');

  // With the marker and no kill switch it reports enforce mode — and
  // still applies nothing here, because a freshly tracked fixture host has
  // nothing that passes the fences.
  var r3 = runRunner();
  var line3 = JSON.parse((r3.stdout || '').trim().split('\n').pop());
  eq(line3.mode, 'enforce', 'the marker switches the runner to enforce mode');
  eq(line3.applied.length, 0, 'and it still signals nothing without evidence');
  eq(r3.status, 0, 'an enforcing run with nothing to do is a success, not a failure');

  // A Resource Guard state that is stale must not be believed.
  var rgState = path.join(TMP, 'stale-rg.json');
  fs.writeFileSync(rgState, JSON.stringify({ level: 'CRITICAL', updated_at: '2020-01-01T00:00:00.000Z' }));
  var r4 = runRunner({ MYTHOS_SESSION_GUARD_RG_STATE: rgState });
  eq(JSON.parse((r4.stdout || '').trim().split('\n').pop()).pressure_level, 'NORMAL',
    'a stale Resource Guard state is ignored rather than acted on');
  fs.writeFileSync(rgState, JSON.stringify({ level: 'CRITICAL', updated_at: new Date().toISOString() }));
  var r5 = runRunner({ MYTHOS_SESSION_GUARD_RG_STATE: rgState });
  eq(JSON.parse((r5.stdout || '').trim().split('\n').pop()).pressure_level, 'CRITICAL',
    'a fresh CRITICAL from the Resource Guard is carried into the session guard');
})();

// =====================================================
// 16. The operator CLI
// =====================================================

(function cli() {
  var cp = require('child_process');
  var BIN = path.join(EXEC, 'bin', 'mythos-session-guard');
  var home = path.join(TMP, 'cli-home');
  var fixtureProc = standardHost({ sessions: 2 });

  function run(args) {
    return cp.spawnSync(process.execPath, [BIN].concat(args), {
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        MYTHOS_EXECUTOR_HOME: home,
        MYTHOS_SESSION_GUARD_PROC: fixtureProc
      })
    });
  }

  var inv = run(['inventory']);
  eq(inv.status, 0, 'inventory exits 0');
  var invOut = JSON.parse(inv.stdout);
  eq(invOut.counts.remote_sessions, 2, 'inventory counts the sessions');
  eq(invOut.counts.executor_processes >= 2, true, 'inventory lists the protected executor processes explicitly');

  var pl = run(['plan']);
  eq(pl.status, 0, 'plan exits 0');
  eq(JSON.parse(pl.stdout).dry_run, true, 'plan is a dry run');
  eq(JSON.parse(pl.stdout).actions.length, 0, 'plan against a freshly seen host proposes nothing');

  var stt = run(['status']);
  eq(stt.status, 0, 'status exits 0');
  eq(JSON.parse(stt.stdout).enforcement.enabled, false, 'status reports enforcement as disabled');

  // The refusal that matters: `enforce` without --yes must do nothing at all.
  var noYes = run(['enforce']);
  eq(noYes.status, 3, 'enforce without --yes refuses with a distinct exit code');
  eq(JSON.parse(noYes.stdout).enforced, false, 'and reports that it enforced nothing');
  eq(JSON.parse(noYes.stdout).refused, 'missing_--yes', 'and says exactly why');

  // `enforce --yes` without the marker degrades to observe rather than
  // failing: that is what makes the timer safe to install first.
  var observe = run(['enforce', '--yes']);
  eq(observe.status, 0, 'enforce --yes without the marker exits 0 in observe mode');
  eq(JSON.parse(observe.stdout).mode, 'observe', 'and reports observe mode');
  eq(JSON.parse(observe.stdout).enforced, false, 'and enforced nothing');

  var led = run(['ledger', '-n', '5']);
  eq(led.status, 0, 'ledger exits 0 once the guard has written one');
  ok(led.stdout.indexOf('session_seen') >= 0, 'the ledger shows the observed sessions');

  eq(run(['nonsense']).status, 2, 'an unknown command exits 2 with usage');
})();

// --- Summary ----------------------------------------------------------------

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }

console.log('\nsession-guard: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
process.exit(0);
