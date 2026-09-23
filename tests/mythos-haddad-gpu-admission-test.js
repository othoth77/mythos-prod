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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(fail ? 1 : 0);
