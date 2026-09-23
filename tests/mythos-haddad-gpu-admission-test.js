'use strict';
// =====================================================
// MYTHOS HADDAD V2.3 — GPU occupancy signal and admission
// tests/mythos-haddad-gpu-admission-test.js
//
// Offline: every reading is injected, so what is asserted is the DECISION
// and never the machine the suite runs on. The live numbers this encodes are
// recorded in projects/mythos-haddad/docs/RESOURCE.md.
// =====================================================
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var FIX = fs.mkdtempSync(path.join(os.homedir(), 'haddad-gpu-adm-'));
process.env.HADDAD_AGENT_ENABLE_FILE = path.join(FIX, 'absent.enabled');

var gpu = require(path.join(EXEC, 'lib', 'gpu-slots'));
var guard = require(path.join(EXEC, 'lib', 'resource-guard'));

var pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('ok - ' + n); } else { fail++; console.log('not ok - ' + n); } }
function slots(total, busy, nCtx) {
  return Array.from({ length: total }, function (_, i) {
    return { id: i, is_processing: i < busy, n_ctx: nCtx === undefined ? 8192 : nCtx };
  });
}

console.log('# A. the signal reads the runtime, not the OS');
(function () {
  var s = gpu.shape(slots(4, 1), {});
  ok(s.slots_total === 4 && s.slots_busy === 1 && s.slots_free === 3, 'A1 slot occupancy is read straight from /slots');
  ok(s.kv_pool_tokens === 8192, 'A2 the KV pool is n_ctx — ONE pool, not one per slot (kv_unified)');
  ok(s.task_kv_tokens === gpu.TASK_KV_TOKENS, 'A3 and the task ceiling it is budgeted against is recorded on the signal');
  // The OS VRAM reader is deliberately not used: on this driver it reports
  // 0.0 MiB with a model resident, and a signal that reads 0 while the GPU
  // is full is worse than no signal.
  var src = fs.readFileSync(path.join(EXEC, 'lib', 'gpu-slots.js'), 'utf8');
  ok(!/haddad-gpu-vram|nvidia-smi|vram_used_mib\s*[:=]/.test(src.replace(/\/\/.*$/gm, '')),
    'A4 it never reads the unreliable OS-level VRAM query in code (only discusses it in comments)');
})();

console.log('# B. capacity is budgeted against the SHARED pool, not the slot count');
(function () {
  var four = gpu.shape(slots(4, 0), {});
  ok(gpu.kvBudgetedCapacity(four) === 1,
    'B1 four slots, one 8192 pool, a 6400-token task ceiling → capacity 1, not 4');
  var roomy = gpu.shape(slots(4, 0, 32768), { taskKvTokens: 6400 });
  ok(gpu.kvBudgetedCapacity(roomy) === 4,
    'B2 a bigger pool raises it, but never past the slot count (' + gpu.kvBudgetedCapacity(roomy) + ')');
  var tiny = gpu.shape(slots(4, 0, 2048), { taskKvTokens: 6400 });
  ok(gpu.kvBudgetedCapacity(tiny) === 0, 'B3 a pool too small for one task is 0, not 1');
  ok(gpu.kvBudgetedCapacity(null) === null, 'B4 no signal → null, never a number');
})();

console.log('# C. room for another');
(function () {
  var idle = gpu.shape(slots(4, 0), {});
  ok(gpu.roomForAnother(idle, 0).room === true, 'C1 idle → room');
  var r1 = gpu.roomForAnother(idle, 1);
  ok(r1.room === false && r1.reason === 'gpu_at_capacity', 'C2 one already in flight → at capacity (' + r1.reason + ')');
  var tiny = gpu.roomForAnother(gpu.shape(slots(4, 0, 2048), { taskKvTokens: 6400 }), 0);
  ok(tiny.room === false && tiny.reason === 'kv_pool_too_small_for_one_task',
    'C3 a pool that cannot hold one task says so specifically: ' + tiny.reason);
  ok(gpu.roomForAnother(null, 0) === null, 'C4 unknown stays unknown');
  // in_flight is what the EXECUTOR knows it started, and it is trusted over
  // slots_busy: a task between turns holds no slot but still owns the pool.
  var between = gpu.roomForAnother(gpu.shape(slots(4, 0), {}), 1);
  ok(between.room === false, 'C5 a task between model turns still counts — slots_busy 0 does not mean free');
})();

console.log('# D. admission: the GPU rule adds denials, never removes them');
(function () {
  var sig = gpu.shape(slots(4, 0), {});
  ok(guard.admission({ level: 'NORMAL' }).admit === true, 'D1 an existing call site is untouched (no opts)');
  ok(guard.admission({ level: 'NORMAL' }, {}).admit === true, 'D2 and untouched without needs_gpu');
  ok(guard.admission({ level: 'NORMAL' }, { needs_gpu: true, gpu_signal: sig, gpu_in_flight: 0 }).admit === true,
    'D3 GPU work is admitted when there is room');
  var denied = guard.admission({ level: 'NORMAL' }, { needs_gpu: true, gpu_signal: sig, gpu_in_flight: 1 });
  ok(denied.admit === false && denied.reason === 'gpu_at_capacity', 'D4 and denied when there is not: ' + denied.reason);
  ok(denied.gpu && denied.gpu.capacity === 1 && denied.gpu.kv_pool_tokens === 8192,
    'D5 the denial carries the numbers it was made on');
  // Memory pressure still wins, and the GPU rule cannot relax it.
  var crit = guard.admission({ level: 'CRITICAL' }, { needs_gpu: true, gpu_signal: sig, gpu_in_flight: 0 });
  ok(crit.admit === false && crit.reason === 'resource_pressure', 'D6 CRITICAL memory denies GPU work regardless of room');
  // Fail-open: a signal we cannot read must not hold the queue shut.
  ok(guard.admission({ level: 'NORMAL' }, { needs_gpu: true, gpu_signal: null }).admit === true,
    'D7 an unreadable GPU signal ADMITS — absent is not zero');
})();

console.log('# E. absent where there is no runtime');
(function () {
  ok(gpu.read({ enableFile: path.join(FIX, 'nope') }) === null, 'E1 no enable marker → null (the VPS case), no request made');
  ok(gpu.read({ fetch: function () { return []; } }) === null, 'E2 an empty slots array is not a signal');
  ok(gpu.read({ fetch: function () { return { error: 'nope' }; } }) === null, 'E3 nor is a non-array');
  ok(/\/slots$/.test(gpu.slotsUrl('http://127.0.0.1:8600/v1')), 'E4 the /v1 base resolves to /slots');
})();

console.log('# F. the executor actually ASKS the GPU question');
(function () {
  var home = fs.mkdtempSync(path.join(os.homedir(), 'haddad-gw-'));
  process.env.MYTHOS_EXECUTOR_HOME = home;
  var executor = require(path.join(EXEC, 'executor.js'));
  // The rule existing is not the same as the rule being consulted. Before
  // this, `needs_gpu` was supported by admission() and passed by nobody, so
  // the signal was dormant in the live path.
  ok(typeof executor.needsGpu === 'function', 'F1 the executor decides whether work needs the GPU');
  ok(executor.needsGpu({ provider: 'haddad-agent' }) === true, 'F2 the local Qwen provider needs it');
  ok(executor.needsGpu({ provider: 'claude-code' }) === false, 'F3 claude-code does not');
  ok(executor.needsGpu({ provider: 'openai-compat' }) === false, 'F4 nor an advisory provider');
  ok(executor.needsGpu(null) === false && executor.needsGpu({}) === false, 'F5 and no task means no GPU claim');
  var src = fs.readFileSync(path.join(EXEC, 'executor.js'), 'utf8');
  ok(/guardGate\(guard, state\.readJSON\(queued\[0\]\.task_id/.test(src),
    'F6 tick() asks about the task at the head of the queue, not in the abstract');
  ok(/guardGate\(null, state\.readJSON\(taskId/.test(src), 'F7 dispatchTask() asks about the task it is dispatching');
  // F8 asserted `runningCount()` until V2.3's scheduler half. That was the
  // right answer while a task held the GPU for its whole life, and the wrong
  // one once the provider took a per-TURN lease: a running task in
  // validation occupies no card. The property it protects is unchanged —
  // in-flight is the EXECUTOR's own accounting, never the runtime's
  // `slots_busy`, which reads 0 between turns and would admit a second task
  // into a pool the first has not finished with.
  ok(/opts\.gpu_in_flight = resourceGuard\.gpuSlots\.heldCount\(\)/.test(src),
    'F8 in-flight is the executor\'s own lease count, never the runtime\'s slots_busy');
  ok(!/gpu_in_flight = .*slots_busy/.test(src),
    'F8b and slots_busy is never used for admission');
  try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) { /* best effort */ }
})();

console.log('# G. the GPU lease — held around a TURN, not around a task');
(function () {
  gpu.resetLeasesForTests();
  ok(gpu.heldCount() === 0, 'G1 nothing held to begin with');
  gpu.acquire('task-a');
  ok(gpu.heldCount() === 1 && gpu.heldBy()[0] === 'task-a', 'G2 a turn acquires the card');
  gpu.release('task-a');
  ok(gpu.heldCount() === 0, 'G3 and releases it when the turn ends — before validation, checks and git');
  ok(gpu.release('task-a') === false, 'G4 releasing twice is not an error and does not go negative');
  ok(gpu.acquire(null) === false && gpu.heldCount() === 0, 'G5 a lease needs an id');

  // THE POINT OF THE WHOLE CHANGE: a task that is RUNNING but between turns
  // holds nothing, so another task may take the card. Before this, in_flight
  // was runningCount() and a task held the GPU through its validation.
  gpu.acquire('task-a');
  ok(gpu.heldCount() === 1, 'G6 task A is in a turn');
  gpu.release('task-a');                       // A moves to validation / checks / git
  ok(gpu.heldCount() === 0, 'G7 task A is still RUNNING but no longer on the GPU');
  var sig = gpu.shape(slots(4, 0), {});
  ok(guard.admission({ level: 'NORMAL' }, { needs_gpu: true, gpu_signal: sig, gpu_in_flight: gpu.heldCount() }).admit === true,
    'G8 so task B is admitted to the card while task A finishes off it — this is the overlap');
  gpu.acquire('task-b');
  ok(guard.admission({ level: 'NORMAL' }, { needs_gpu: true, gpu_signal: sig, gpu_in_flight: gpu.heldCount() }).reason === 'gpu_at_capacity',
    'G9 and a third is refused while B holds it — GPU work stays strictly serialised');
  gpu.release('task-b');

  // A leaked lease must not wedge the card shut for the life of the daemon.
  gpu.acquire('task-dead', { ttlMs: 1 });
  var held = gpu.heldCount(Date.now() + 50);
  ok(held === 0, 'G10 a lease from a provider that died expires instead of wedging the GPU (' + held + ')');
  ok(gpu.LEASE_TTL_MS >= 60000, 'G11 and the TTL is longer than any real turn, so it never cuts a live one short');
  gpu.resetLeasesForTests();
})();

console.log('# H. the provider takes the lease around the turn only');
(function () {
  var src = fs.readFileSync(path.join(EXEC, 'providers', 'haddad-agent.js'), 'utf8');
  // H1 asserted a plain acquire() until the live demo showed that counting
  // is not serialising: two admitted tasks both entered a turn and the
  // observed maximum was 2 concurrent leases. The turn must WAIT for the
  // card, not merely record that it took it.
  ok(/gpuSlots\.acquireWhenFree\(leaseId, \{ deadline: deadline/.test(src),
    'H1 the turn WAITS for a free card, bounded by the task\'s own deadline');
  ok(/HADDAD_AGENT_GPU_BUSY/.test(src),
    'H1b and a task that never gets the card inside its deadline fails with a named code, not silently');
  ok(/\)\.then\(function \(res\) \{\s*\n\s*gpuSlots\.release\(leaseId\);/.test(src),
    'H2 and released the moment the model answers — not when the task ends');
  ok(/already_held/.test(fs.readFileSync(path.join(EXEC, 'lib', 'gpu-slots.js'), 'utf8')),
    'H2b a holder re-entering (a repair round) is not treated as a second claim, so it cannot deadlock on itself');
  ok(/gpuSlots\.release\(\(task && task\.task_id\) \|\| null\);/.test(src),
    'H3 and released on the throw path too: a failure is not a reason to hold the card');
  // Validation and delivery must NOT be inside the lease.
  var acquireAt = src.indexOf('gpuSlots.acquire(leaseId)');
  var releaseAt = src.indexOf('gpuSlots.release(leaseId)');
  var between = src.slice(acquireAt, releaseAt);
  ok(!/validateWork|deliverValidatedWork|work\.snapshot/.test(between),
    'H4 nothing between acquire and release validates, snapshots or delivers — those are off the card');
  var exec = fs.readFileSync(path.join(EXEC, 'executor.js'), 'utf8');
  ok(/gpu_in_flight = resourceGuard\.gpuSlots\.heldCount\(\)/.test(exec),
    'H5 the gate counts LEASES, not running tasks');
  ok(!/gpu_in_flight = runningCount\(\)/.test(exec),
    'H6 and no longer counts a task as occupying the GPU for its whole life');
})();

console.log('# I. acquireWhenFree: mutual exclusion, bounded');
var queue = [];
function it(name, fn) { queue.push(function () { return Promise.resolve().then(fn).then(
  function () { pass++; console.log('ok - ' + name); },
  function (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); }); }); }

it('I1 a second turn WAITS while the card is held, then takes it', function () {
  gpu.resetLeasesForTests();
  gpu.acquire('holder');
  var waited = null;
  var p = gpu.acquireWhenFree('waiter', { maxWaitMs: 2000, pollMs: 20 }).then(function (r) { waited = r; });
  return new Promise(function (r) { setTimeout(r, 120); }).then(function () {
    assert.strictEqual(waited, null, 'it is still waiting while the card is held');
    assert.strictEqual(gpu.heldCount(), 1, 'and only the holder has it');
    gpu.release('holder');
    return p;
  }).then(function () {
    assert.strictEqual(waited.acquired, true, 'it acquires once the card frees');
    assert.ok(waited.waited_ms >= 100, 'and reports how long it waited (' + waited.waited_ms + ' ms)');
    assert.strictEqual(gpu.heldCount(), 1, 'exactly one holder throughout');
  });
});

it('I2 waiting is bounded: a card never freed fails with a named reason, it does not hang', function () {
  gpu.resetLeasesForTests();
  gpu.acquire('hog');
  return gpu.acquireWhenFree('loser', { maxWaitMs: 200, pollMs: 20 }).then(function (r) {
    assert.strictEqual(r.acquired, false);
    assert.strictEqual(r.reason, 'gpu_busy_deadline');
    assert.strictEqual(gpu.heldCount(), 1, 'and it did not take the card anyway');
  });
});

it('I3 a holder re-entering does not deadlock on itself', function () {
  gpu.resetLeasesForTests();
  gpu.acquire('same');
  return gpu.acquireWhenFree('same', { maxWaitMs: 200, pollMs: 20 }).then(function (r) {
    assert.strictEqual(r.acquired, true);
    assert.strictEqual(r.reason, 'already_held', 'a repair round re-entering is not a second claim');
  });
});

it('I4 an EXPIRED lease does not block anyone — a dead holder cannot wedge the card', function () {
  gpu.resetLeasesForTests();
  gpu.acquire('dead', { ttlMs: 1 });
  return new Promise(function (r) { setTimeout(r, 30); }).then(function () {
    return gpu.acquireWhenFree('live', { maxWaitMs: 300, pollMs: 20 });
  }).then(function (r) {
    assert.strictEqual(r.acquired, true, 'the live turn gets the card despite the dead holder');
  });
});

it('I5 under contention the maximum concurrent holders is 1', function () {
  gpu.resetLeasesForTests();
  var maxSeen = 0;
  var probe = setInterval(function () { maxSeen = Math.max(maxSeen, gpu.heldCount()); }, 5);
  var ids = ['t1', 't2', 't3', 't4', 't5'];
  return Promise.all(ids.map(function (id) {
    return gpu.acquireWhenFree(id, { maxWaitMs: 3000, pollMs: 10 }).then(function (r) {
      if (!r.acquired) return r;
      return new Promise(function (res) { setTimeout(res, 25); }).then(function () { gpu.release(id); return r; });
    });
  })).then(function (rs) {
    clearInterval(probe);
    assert.strictEqual(maxSeen, 1, 'never two on the card at once (saw ' + maxSeen + ')');
    assert.ok(rs.filter(function (r) { return r.acquired; }).length === ids.length, 'and every one of them eventually got it');
  });
});

queue.reduce(function (c, s2) { return c.then(s2); }, Promise.resolve()).then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
});
return;
