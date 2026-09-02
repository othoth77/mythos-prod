'use strict';
// =====================================================
// MYTHOS — Resource Guard tests (gh-issue-101)
// tests/resource-guard-test.js
//
// Deterministic and offline. The state machine is exercised as a pure
// function over synthetic samples, the reader against fixture /proc files,
// and the executor admission path against the mock provider — no real
// provider, no real quota, no real notification (MYTHOS_NOTIFY_CONFIG is
// pointed at a path that does not exist, so notify.sh stays unconfigured
// and sends nothing).
//
// The historical replay runs against two real telemetry excerpts committed
// under tests/fixtures/resource-guard/ (metric fields only; the per-process
// and per-cgroup tail of each memwatch line is stripped, and the extension
// is .txt because .gitignore excludes *.log):
//   memwatch-outage.txt   the 2026-09-01 20:41-22:28 pressure episode
//   memwatch-healthy.txt  2026-09-02 21:40-23:38, swap 96-98%, host healthy
//
// Run with: node tests/resource-guard-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIXTURES = path.join(os.homedir(), 'mythos-resource-guard-test-' + process.pid);

fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
delete process.env.MYTHOS_MOCK_SCRIPT;
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIXTURES, 'no-advisory-credential.env');
// Notification must stay inert in tests: an unconfigured notify.sh exits 0
// without contacting anything.
process.env.MYTHOS_NOTIFY_CONFIG = path.join(FIXTURES, 'no-notify-config.env');
delete process.env.MYTHOS_NTFY_URL;

// Fixture /proc files, selected through the guard's documented path
// overrides. Rewritten in place to simulate the host changing.
var PROC = path.join(FIXTURES, 'proc');
fs.mkdirSync(PROC, { recursive: true });
process.env.MYTHOS_RESOURCE_GUARD_MEMINFO = path.join(PROC, 'meminfo');
process.env.MYTHOS_RESOURCE_GUARD_PRESSURE = path.join(PROC, 'pressure');
process.env.MYTHOS_RESOURCE_GUARD_VMSTAT = path.join(PROC, 'vmstat');

var guard = require(path.join(EXEC, 'lib', 'resource-guard'));
var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var mockProvider = require(path.join(EXEC, 'providers', 'mock'));

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

function setScript(entries) {
  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify(entries);
  mockProvider.reset();
}

// availMib / psi60 / oomKill / swapUsedPct → the three fixture files.
function writeProc(availMib, psi60, oomKill, swapUsedPct) {
  var swapTotalKb = 4194296;
  var swapFreeKb = Math.round(swapTotalKb * (1 - (swapUsedPct === undefined ? 100 : swapUsedPct) / 100));
  fs.writeFileSync(process.env.MYTHOS_RESOURCE_GUARD_MEMINFO,
    'MemTotal:        7931936 kB\n' +
    'MemFree:          123456 kB\n' +
    'MemAvailable:    ' + (availMib * 1024) + ' kB\n' +
    'SwapTotal:       ' + swapTotalKb + ' kB\n' +
    'SwapFree:        ' + swapFreeKb + ' kB\n');
  fs.writeFileSync(process.env.MYTHOS_RESOURCE_GUARD_PRESSURE,
    'some avg10=0.00 avg60=' + psi60.toFixed(2) + ' avg300=0.00 total=22240922969\n' +
    'full avg10=0.00 avg60=0.00 avg300=0.00 total=12759768986\n');
  fs.writeFileSync(process.env.MYTHOS_RESOURCE_GUARD_VMSTAT,
    'nr_free_pages 30000\noom_kill ' + oomKill + '\npgfault 12345\n');
}

function removeProc() {
  ['MEMINFO', 'PRESSURE', 'VMSTAT'].forEach(function (k) {
    try { fs.unlinkSync(process.env['MYTHOS_RESOURCE_GUARD_' + k]); } catch (e) { /* already gone */ }
  });
}

function resetGuardState() {
  try { fs.unlinkSync(path.join(state.root(), 'resource-guard.json')); } catch (e) { /* none yet */ }
}

function alertsLog() {
  try {
    return fs.readFileSync(path.join(state.root(), 'resource-guard-alerts.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
  } catch (e) { return []; }
}

function eventsOf(taskId) {
  var text = state.readText(taskId, 'events.log') || '';
  return text.trim().split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
}

// A synthetic sample. Swap is pinned at 100% used everywhere on purpose:
// every state assertion below therefore holds WITH swap exhausted, which
// is the property gh-issue-101 requires.
var T0 = Date.parse('2026-09-02T12:00:00Z');
function sig(n, o) {
  return {
    at: T0 + n * 2 * 60 * 1000,
    mem_available_mib: o.avail,
    mem_total_mib: 7746,
    swap_total_mib: 4095,
    swap_used_mib: 4095,
    swap_used_pct: 100,
    psi_some_avg60: o.psi === undefined ? 0 : o.psi,
    oom_kill: o.kills === undefined ? 1000 : o.kills
  };
}

// Drives evaluate() over a list of samples, collecting what happened.
function feed(st, samples, opts) {
  var transitions = [];
  var alerts = [];
  samples.forEach(function (s) {
    var r = guard.evaluate(st, s, opts);
    st = r.state;
    if (r.transition) transitions.push(r.transition);
    if (r.alert) alerts.push(r.alert);
  });
  return { state: st, transitions: transitions, alerts: alerts };
}

function repeat(n, from, o) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(sig(from + i, o));
  return out;
}

// ---------------------------------------------------------------------------
// 1. Signal reading
// ---------------------------------------------------------------------------
(function () {
  writeProc(2500, 0.00, 1323, 97);
  var s = guard.readSignals();
  eq(s.mem_available_mib, 2500, 'signals: MemAvailable parsed in MiB');
  eq(s.psi_some_avg60, 0, 'signals: PSI some avg60 parsed');
  eq(s.oom_kill, 1323, 'signals: oom_kill counter parsed');
  eq(s.swap_used_pct, 97, 'signals: swap usage reported');
  ok(s.mem_total_mib > 7000, 'signals: MemTotal parsed');

  // The `full` line must not be mistaken for `some`.
  eq(guard.parsePressureSome60('some avg10=1.00 avg60=42.50 avg300=3.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=2'),
    42.5, 'signals: reads the some line, not full');

  removeProc();
  var missing = guard.readSignals();
  eq(missing.mem_available_mib, null, 'signals: unreadable /proc degrades to null');
  eq(missing.psi_some_avg60, null, 'signals: unreadable pressure degrades to null');
  eq(missing.oom_kill, null, 'signals: unreadable vmstat degrades to null');
})();

// ---------------------------------------------------------------------------
// 2. Swap is never a trigger
// ---------------------------------------------------------------------------
(function () {
  // 20 samples at 100% swap on a healthy host: the exact live condition
  // (2.5 GiB available, PSI 0, swap 97-100%) that a swap-percentage
  // trigger would have parked in CRITICAL forever.
  var r = feed(null, repeat(20, 0, { avail: 2500, psi: 0 }));
  eq(r.state.level, 'NORMAL', 'swap: 100% swap with healthy memory stays NORMAL');
  eq(r.transitions.length, 0, 'swap: 100% swap produces no transition at all');
  eq(r.state.last_sample.swap_used_pct, 100, 'swap: usage is still reported in the sample');
})();

// ---------------------------------------------------------------------------
// 3. Escalation needs confirmation; kills do not
// ---------------------------------------------------------------------------
(function () {
  var one = feed(null, repeat(1, 0, { avail: 1100 }));
  eq(one.state.level, 'NORMAL', 'warning: one sample below the enter threshold does not escalate');
  eq(one.state.pending_level, 'WARNING', 'warning: the candidate level is pending');

  var two = feed(null, repeat(2, 0, { avail: 1100 }));
  eq(two.state.level, 'WARNING', 'warning: two consecutive samples confirm WARNING');
  eq(two.alerts[0].kind, 'WARNING', 'warning: the confirmation emits a WARNING alert');

  // A single dip back above the threshold resets the confirmation counter.
  var flap = feed(null, [sig(0, { avail: 1100 }), sig(1, { avail: 2500 }), sig(2, { avail: 1100 })]);
  eq(flap.state.level, 'NORMAL', 'warning: an interrupted run does not confirm');

  var critAvail = feed(null, repeat(2, 0, { avail: 650 }));
  eq(critAvail.state.level, 'CRITICAL', 'critical: MemAvailable <= 700M confirms in two samples');

  var critPsi = feed(null, repeat(2, 0, { avail: 2500, psi: 35 }));
  eq(critPsi.state.level, 'CRITICAL', 'critical: PSI avg60 >= 30 confirms in two samples on its own');

  // First sample only establishes the kill baseline.
  var kill = feed(null, [sig(0, { avail: 2500, kills: 1000 }), sig(1, { avail: 2500, kills: 1003 })]);
  eq(kill.transitions.length, 1, 'oom: exactly one transition');
  eq(kill.state.level, 'CRITICAL', 'oom: a kill delta escalates immediately, without confirmation');
  eq(kill.transitions[0].reason, 'oom_kill', 'oom: the transition records the kill as its reason');

  var baseline = feed(null, [sig(0, { avail: 2500, kills: 999999 })]);
  eq(baseline.state.level, 'NORMAL', 'oom: a fresh guard does not read the historical counter as a new kill');
})();

// ---------------------------------------------------------------------------
// 4. De-escalation, RECOVERED, and the exit thresholds
// ---------------------------------------------------------------------------
(function () {
  var crit = feed(null, repeat(2, 0, { avail: 650 }));
  eq(crit.state.level, 'CRITICAL', 'recovery: setup is CRITICAL');

  // Between the CRITICAL exit floor (1100M) and the WARNING exit floor
  // (1600M): recovery stops at WARNING, it does not jump to NORMAL.
  var half = feed(crit.state, repeat(5, 2, { avail: 1300 }));
  eq(half.state.level, 'WARNING', 'recovery: exiting CRITICAL lands in WARNING while still below the warning exit floor');

  var partial = feed(crit.state, repeat(4, 2, { avail: 3000 }));
  eq(partial.state.level, 'CRITICAL', 'recovery: four healthy samples are not enough to leave CRITICAL');

  var full = feed(crit.state, repeat(5, 2, { avail: 3000 }));
  eq(full.state.level, 'NORMAL', 'recovery: five healthy samples de-escalate to NORMAL');
  var recovered = full.alerts.filter(function (a) { return a.kind === 'RECOVERED'; });
  eq(recovered.length, 1, 'recovery: RECOVERED is emitted exactly once');

  var after = feed(full.state, repeat(10, 7, { avail: 3000 }));
  eq(after.alerts.length, 0, 'recovery: staying NORMAL emits nothing further');
  eq(after.transitions.length, 0, 'recovery: staying NORMAL records no further transition');
})();

// ---------------------------------------------------------------------------
// 5. Alert cooldown (no alert loops)
// ---------------------------------------------------------------------------
(function () {
  // Flap CRITICAL → NORMAL → CRITICAL inside 30 minutes: both transitions
  // are recorded, the second CRITICAL alert is suppressed.
  var r = feed(null, repeat(2, 0, { avail: 650 })
    .concat(repeat(5, 2, { avail: 3000 }))
    .concat(repeat(2, 7, { avail: 650 })));
  var criticalTransitions = r.transitions.filter(function (t) { return t.to === 'CRITICAL'; });
  eq(criticalTransitions.length, 2, 'cooldown: both CRITICAL transitions are recorded');
  eq(r.alerts.filter(function (a) { return a.kind === 'CRITICAL'; }).length, 1,
    'cooldown: only the first CRITICAL alert is sent inside the window');
  eq(criticalTransitions[1].alert_suppressed, 'cooldown', 'cooldown: suppression is recorded, not hidden');

  // Same sequence spread beyond the cooldown window: both alert.
  var slow = feed(null, repeat(2, 0, { avail: 650 })
    .concat(repeat(5, 2, { avail: 3000 }))
    .concat(repeat(2, 40, { avail: 650 })));
  eq(slow.alerts.filter(function (a) { return a.kind === 'CRITICAL'; }).length, 2,
    'cooldown: a repeat beyond 30 minutes alerts again');
})();

// ---------------------------------------------------------------------------
// 6. Fail-open on unreadable telemetry
// ---------------------------------------------------------------------------
(function () {
  var crit = feed(null, repeat(2, 0, { avail: 650 }));
  var blind = [];
  for (var i = 0; i < 5; i++) blind.push({ at: T0 + (10 + i) * 120000, mem_available_mib: null, psi_some_avg60: null, oom_kill: null });
  var r = feed(crit.state, blind);
  eq(r.state.level, 'NORMAL', 'fail-open: sustained unreadable telemetry releases a degraded level');
  eq(r.transitions[0].reason, 'telemetry_unavailable', 'fail-open: the release records why it happened');
  eq(r.alerts.length, 0, 'fail-open: a telemetry release is not an all-clear alert');

  var brief = feed(crit.state, blind.slice(0, 3));
  eq(brief.state.level, 'CRITICAL', 'fail-open: a brief read failure does not release the guard');
})();

// ---------------------------------------------------------------------------
// 7. Admission mapping
// ---------------------------------------------------------------------------
(function () {
  eq(guard.admission({ level: 'NORMAL' }).admit, true, 'admission: NORMAL admits');
  eq(guard.admission({ level: 'WARNING' }).admit, true, 'admission: WARNING still admits (watch band, not a stop)');
  eq(guard.admission({ level: 'CRITICAL' }).admit, false, 'admission: CRITICAL refuses admission');
  eq(guard.admission({ level: 'CRITICAL' }).reason, 'resource_pressure', 'admission: the refusal reason is resource_pressure');
  eq(guard.admission(null).admit, true, 'admission: a missing status admits (fail-open)');
})();

// ---------------------------------------------------------------------------
// 8. Persistence across a restart
// ---------------------------------------------------------------------------
(function () {
  var sp = path.join(FIXTURES, 'guard-restart.json');
  var opts = { state_path: sp };
  writeProc(650, 0, 1000, 100);
  var first = guard.sample(opts);
  eq(first.level, 'NORMAL', 'restart: one pressure sample has not confirmed yet');
  ok(fs.existsSync(sp), 'restart: state is persisted to disk');

  // A second process reading the same file continues the same count.
  var second = guard.sample(opts);
  eq(second.level, 'CRITICAL', 'restart: the confirmation count survives in the state file');
  eq(guard.readState(opts).level, 'CRITICAL', 'restart: the persisted level is the confirmed one');

  // A corrupt state file must not throw and must not block.
  fs.writeFileSync(sp, '{not json');
  var recovered = guard.sample(opts);
  ok(recovered && recovered.level === 'NORMAL', 'restart: a corrupt state file restarts the machine instead of throwing');
})();

// ---------------------------------------------------------------------------
// 9. Historical replay (the thresholds against recorded telemetry)
// ---------------------------------------------------------------------------
(function () {
  var dir = path.join(BASE, 'tests', 'fixtures', 'resource-guard');
  var outage = guard.parseMemwatchLog(fs.readFileSync(path.join(dir, 'memwatch-outage.txt'), 'utf8'));
  var healthy = guard.parseMemwatchLog(fs.readFileSync(path.join(dir, 'memwatch-healthy.txt'), 'utf8'));

  ok(outage.length > 40, 'replay: the outage excerpt parsed (' + outage.length + ' samples)');
  ok(healthy.length > 40, 'replay: the healthy excerpt parsed (' + healthy.length + ' samples)');

  var ro = guard.replay(outage);
  eq(ro.final.level, 'CRITICAL', 'replay: the guard is CRITICAL at the end of the outage window');

  // Kill bursts in the window: samples whose kill counter jumps by more
  // than 5. The property that matters is that admission was ALREADY closed
  // when each burst happened — the guard led the kills, it did not follow
  // them. Replaying only the samples before a burst proves it, because the
  // burst itself cannot have influenced that replay.
  var bursts = [];
  for (var i = 1; i < outage.length; i++) {
    if (outage[i].oom_kill - outage[i - 1].oom_kill > 5) bursts.push(i);
  }
  ok(bursts.length >= 2, 'replay: the excerpt contains the kill bursts (' + bursts.length + ')');

  var leads = bursts.map(function (idx) {
    var before = guard.replay(outage.slice(0, idx));
    return { idx: idx, level: before.final.level, lead_min: (outage[idx].at - Date.parse(before.final.since)) / 60000 };
  });
  ok(leads.every(function (l) { return l.level === 'CRITICAL'; }),
    'replay: the guard was already CRITICAL before EVERY kill burst (' +
    leads.map(function (l) { return l.level + '@+' + Math.round(l.lead_min) + 'min'; }).join(', ') + ')');
  ok(leads[0].lead_min >= 2,
    'replay: CRITICAL preceded the first burst by ' + Math.round(leads[0].lead_min) + ' min (>= one sample)');
  ok(leads[leads.length - 1].lead_min >= 30,
    'replay: admission was closed ' + Math.round(leads[leads.length - 1].lead_min) +
    ' min before the 22:18 mass kill (>= 30)');

  var rh = guard.replay(healthy);
  eq(rh.final.level, 'NORMAL', 'replay: the healthy window ends NORMAL');
  eq(rh.transitions.length, 0, 'replay: the healthy window produces no transition at all');
  var swap = healthy.map(function (s) { return s.swap_used_pct; });
  ok(Math.min.apply(null, swap) > 90,
    'replay: the healthy window ran at ' + Math.min.apply(null, swap) + '-' + Math.max.apply(null, swap) +
    '% swap — a swap trigger would have blocked it');
})();

// ---------------------------------------------------------------------------
// 10. Executor admission path (the part gh-issue-101's investigation found broken)
// ---------------------------------------------------------------------------
function mkTask(overrides) {
  var input = {
    project: 'executor-selftest',
    stage: 'RESOURCE-GUARD-TEST',
    instruction: 'test instruction',
    provider: 'mock',
    report_to_git: false
  };
  Object.keys(overrides || {}).forEach(function (k) { input[k] = overrides[k]; });
  return executor.createTask(input);
}

// Drives the guard to CRITICAL through the executor's own tick sampling.
function tickToCritical() {
  writeProc(500, 60, 2000, 100);
  return executor.tick().then(function () { return executor.tick(); }).then(function () {
    var st = executor.resourceGuardStatus();
    eq(st.level, 'CRITICAL', 'executor: the guard reaches CRITICAL from the tick sampler');
    eq(st.admit, false, 'executor: admission is closed at CRITICAL');
  });
}

var chain = Promise.resolve();

// K. A github-bridge task — the class that never passes through
// dispatchTask/drainQueue — must be deferred by tick() itself.
var bridgeTask;
chain = chain.then(function () {
  resetGuardState();
  setScript([{ kind: 'success', summary: 'must not run under pressure' }]);
  return tickToCritical();
}).then(function () {
  bridgeTask = mkTask({ stage: 'BRIDGE-UNDER-PRESSURE', requested_by: 'github-bridge' });
  return executor.tick();
}).then(function (actions) {
  var deferred = actions.filter(function (a) { return a.action === 'dispatch_deferred'; })[0];
  ok(deferred && deferred.task_id === bridgeTask.task_id, 'bridge-admission: tick defers the github-bridge task');
  eq(deferred && deferred.reason, 'resource_pressure', 'bridge-admission: the deferral reason is resource_pressure');
  ok(!actions.some(function (a) { return a.action === 'start'; }), 'bridge-admission: nothing was started');
  eq(state.readStatus(bridgeTask.task_id).status, 'QUEUED', 'bridge-admission: the task stays QUEUED, is not failed or killed');
  ok(eventsOf(bridgeTask.task_id).some(function (e) {
    return e.event === 'dispatch_deferred' && e.reason === 'resource_pressure';
  }), 'bridge-admission: the deferral is durably evented on the task');

  // The decision repeats without re-writing the event every tick.
  return executor.tick();
}).then(function (actions) {
  var again = actions.filter(function (a) { return a.action === 'dispatch_deferred'; })[0];
  ok(again, 'bridge-admission: the deferral decision repeats on the next tick');
  eq(again.event_logged, false, 'bridge-admission: the event is not rewritten inside its cooldown');
  eq(eventsOf(bridgeTask.task_id).filter(function (e) { return e.event === 'dispatch_deferred'; }).length, 1,
    'bridge-admission: exactly one deferral event so far (no event loop)');
});

// L. In-flight work stays resumable: tick steps 1-3 are exempt.
chain = chain.then(function () {
  setScript([{ kind: 'transient' }, { kind: 'success', summary: 'resumed under pressure' }]);
  var t = mkTask({ stage: 'RETRY-UNDER-PRESSURE' });
  return executor.runTask(t.task_id).then(function (st) {
    eq(st.status, 'WAITING_RETRY', 'exempt: setup parked the task on a transient failure');
    st.retry_at = new Date(Date.now() - 1000).toISOString();
    state.writeJSON(t.task_id, 'status.json', st);
    return executor.tick();
  }).then(function (actions) {
    ok(actions.some(function (a) { return a.action === 'retry'; }), 'exempt: a due retry still runs under CRITICAL');
    eq(state.readStatus(t.task_id).status, 'COMPLETED', 'exempt: the resumed task completed');
  });
});

// N. The console dispatch path is gated too.
chain = chain.then(function () {
  var t = mkTask({ stage: 'CONSOLE-UNDER-PRESSURE', requested_by: 'mos-console' });
  return executor.dispatchTask(t.task_id).then(function (r) {
    eq(r.dispatched, false, 'console: dispatchTask refuses to admit under CRITICAL');
    eq(r.reason, 'resource_pressure', 'console: the refusal names resource pressure');
    eq(r.queued, true, 'console: the task remains queued for later');
    eq(state.readStatus(t.task_id).status, 'QUEUED', 'console: the task is still QUEUED');

    // O. And so is the drain.
    executor.drainQueue();
    eq(state.readStatus(t.task_id).status, 'QUEUED', 'console: drainQueue does not start console missions under CRITICAL');
    state.transition(t.task_id, 'CANCELLED', {});
  });
});

// M. Recovery: healthy telemetry → RECOVERED → the deferred task starts.
chain = chain.then(function () {
  writeProc(3000, 0, 2000, 97);
  setScript([{ kind: 'success', summary: 'ran after recovery' }]);
  var ticks = 0;
  function step() {
    if (state.readStatus(bridgeTask.task_id).status !== 'QUEUED' || ticks >= 10) return Promise.resolve();
    ticks++;
    return executor.tick().then(step);
  }
  return step().then(function () {
    eq(executor.resourceGuardStatus().level, 'NORMAL', 'recovery: the guard returned to NORMAL on healthy telemetry');
    ok(ticks >= 5, 'recovery: de-escalation took the full confirmation window (' + ticks + ' ticks)');
    eq(state.readStatus(bridgeTask.task_id).status, 'COMPLETED',
      'recovery: the task deferred by pressure ran by itself after RECOVERED — no manual re-queue');
    var alerts = alertsLog();
    ok(alerts.some(function (a) { return a.kind === 'CRITICAL'; }), 'recovery: the CRITICAL alert is in the durable ledger');
    ok(alerts.some(function (a) { return a.kind === 'RECOVERED'; }), 'recovery: the RECOVERED alert is in the durable ledger');
    eq(alerts.filter(function (a) { return a.kind === 'RECOVERED'; }).length, 1, 'recovery: RECOVERED appears exactly once');
  });
});

// P. The kill switch.
chain = chain.then(function () {
  resetGuardState();
  process.env.MYTHOS_RESOURCE_GUARD = 'off';
  writeProc(300, 90, 3000, 100);
  setScript([{ kind: 'success', summary: 'ran with the guard off' }]);
  var t = mkTask({ stage: 'GUARD-OFF', requested_by: 'github-bridge' });
  eq(executor.resourceGuardStatus().enabled, false, 'kill-switch: the guard reports itself disabled');
  return executor.tick().then(function (actions) {
    ok(actions.some(function (a) { return a.action === 'start' && a.task_id === t.task_id; }),
      'kill-switch: MYTHOS_RESOURCE_GUARD=off admits the task despite CRITICAL telemetry');
    delete process.env.MYTHOS_RESOURCE_GUARD;
  });
});

// Q. Unreadable /proc must never block admission.
chain = chain.then(function () {
  resetGuardState();
  removeProc();
  setScript([{ kind: 'success', summary: 'ran with blind telemetry' }]);
  var t = mkTask({ stage: 'BLIND-TELEMETRY', requested_by: 'github-bridge' });
  return executor.tick().then(function (actions) {
    ok(actions.some(function (a) { return a.action === 'start' && a.task_id === t.task_id; }),
      'fail-open: unreadable /proc admits the task rather than stalling the queue');
  });
});

// R. The read-only HTTP view (operators and the console read the guard here,
// not from /dispatcher, whose key set the console asserts exactly).
chain = chain.then(function () {
  var http = require('http');
  var server = require(path.join(EXEC, 'server'));
  process.env.MYTHOS_EXECUTOR_TOKEN = 'test-token-0123456789abcdef';
  var servers = server.start({ port: 8207, binds: ['127.0.0.1'] });

  function req(urlPath, token) {
    return new Promise(function (resolve, reject) {
      var r = http.request({
        host: '127.0.0.1', port: 8207, path: urlPath, method: 'GET',
        headers: token ? { 'Authorization': 'Bearer ' + token } : {}
      }, function (res) {
        var data = '';
        res.on('data', function (d) { data += d; });
        res.on('end', function () { resolve({ code: res.statusCode, body: JSON.parse(data || '{}') }); });
      });
      r.on('error', reject);
      r.end();
    });
  }

  writeProc(2500, 0, 4000, 97);
  resetGuardState();
  return new Promise(function (resolve) { setTimeout(resolve, 200); })
    .then(function () { return req('/resource-guard', null); })
    .then(function (res) {
      eq(res.code, 401, 'http: /resource-guard requires the executor token');
      return req('/resource-guard', 'test-token-0123456789abcdef');
    })
    .then(function (res) {
      eq(res.code, 200, 'http: /resource-guard returns 200 for an authorised read');
      eq(res.body.level, 'NORMAL', 'http: the healthy fixture host reads NORMAL');
      eq(res.body.admit, true, 'http: admission is reported open');
      eq(res.body.signals.mem_available_mib, 2500, 'http: the sample behind the decision is exposed');
      eq(res.body.signals.swap_used_pct, 97, 'http: swap is reported at 97% while the level stays NORMAL');
    })
    .then(function () {
      (servers || []).forEach(function (s) { try { s.close(); } catch (e) { /* already closed */ } });
    }, function (err) {
      (servers || []).forEach(function (s) { try { s.close(); } catch (e) { /* already closed */ } });
      throw err;
    });
});

chain.then(function () {
  try { fs.rmSync(FIXTURES, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
  console.log('\nResource Guard: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.error('failures:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  process.exit(0);
}).catch(function (err) {
  console.error('SUITE ERROR: ' + (err && err.stack || err));
  try { fs.rmSync(FIXTURES, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
  process.exit(1);
});
