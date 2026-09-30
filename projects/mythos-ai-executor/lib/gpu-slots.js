'use strict';
// =====================================================
// Mythos AI Executor — local GPU occupancy signal (V2.3)
// projects/mythos-ai-executor/lib/gpu-slots.js
//
// One question, answered from the only source on this host that can answer
// it honestly: **is there room on the GPU for another inference right now?**
//
// WHY NOT THE OS. `projects/mythos-haddad/bin/haddad-gpu-vram.py` exists and
// is reused elsewhere, but on this driver stack it reports
// `vram_used_mib: 0.0` with a model demonstrably resident on the card — the
// OS-level Vulkan budget query is unreliable on NVK/nouveau, which
// AI_RUNTIME.md already records. A signal that reads 0 while the GPU is full
// is worse than no signal, so this does not use it.
//
// WHAT IT USES INSTEAD. llama-server's own `/slots`, which is the runtime's
// accounting of its own occupancy: how many slots exist, and how many are
// processing. That is exactly the quantity an admission decision needs.
//
// THE TRAP THIS ENCODES. `n_slots = 4` does NOT mean four concurrent tasks.
// The runtime is started with `kv_unified = true`, so the four slots SHARE
// one KV pool of `--ctx-size` tokens — the 8192 each slot advertises is the
// same 8192, not four of them. A supervised Haddad task spends roughly
// 2,000–6,000 prompt tokens (measured across the V2.1 role runs), so two
// concurrent supervised tasks routinely do not fit in the shared pool even
// though two slots are free. Slot count is therefore a CEILING, never a
// budget, and `kvBudgetedCapacity()` is what an admission decision should
// ask.
//
// FAIL-OPEN, DELIBERATELY. No URL, no key, no runtime, an unparseable answer
// — all return null, and a null signal must never hold the queue shut. This
// runs on hosts with no GPU at all (the VPS), where the right behaviour is
// to be absent rather than to deny.
// =====================================================

var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

// The same endpoint and key file the Haddad provider already uses, so there
// is one place that knows where the local runtime lives.
var DEFAULT_BASE_URL = process.env.HADDAD_AGENT_BASE_URL || 'http://127.0.0.1:8600/v1';
var DEFAULT_KEY_FILE = process.env.HADDAD_AGENT_KEY_FILE ||
  path.join(os.homedir(), '.config', 'mythos-haddad', 'runtime.key');
var ENABLE_MARKER = process.env.HADDAD_AGENT_ENABLE_FILE ||
  path.join(os.homedir(), '.config', 'mythos-haddad', 'agent.enabled');

// What one supervised task is worth in shared-KV tokens. Measured, not
// guessed: across the six V2.1 role runs a task's prompt ran from ~1,800
// (a small read-only task) to ~6,400 (a repair round carrying a diagnosis).
// The ceiling is what admission must budget against, because admitting on
// the average is how two tasks deadlock on a pool that fits one.
var TASK_KV_TOKENS = (function () {
  var raw = parseInt(process.env.HADDAD_TASK_KV_TOKENS, 10);
  return isNaN(raw) || raw < 512 ? 6400 : raw;
})();

var CURL_BIN = (function () {
  var candidates = ['/usr/bin/curl', '/bin/curl', '/usr/local/bin/curl'];
  for (var i = 0; i < candidates.length; i++) {
    try { if (fs.statSync(candidates[i]).isFile()) return candidates[i]; } catch (e) { /* keep looking */ }
  }
  return null;
})();

function slotsUrl(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/v1\/?$/, '').replace(/\/$/, '') + '/slots';
}

function readKey(file) {
  try {
    var t = fs.readFileSync(file || DEFAULT_KEY_FILE, 'utf8').trim();
    return t || null;
  } catch (e) { return null; }
}

// Reads the runtime's own occupancy. Returns null whenever it cannot be
// answered honestly — never a guess, never a zero standing in for unknown.
//   { slots_total, slots_busy, slots_free, n_ctx, kv_pool_tokens, at }
function read(opts) {
  opts = opts || {};
  if (typeof opts.fetch === 'function') return shape(opts.fetch(), opts);   // test injection
  try {
    if (!fs.existsSync(opts.enableFile || ENABLE_MARKER)) return null;
  } catch (e) { return null; }
  var key = readKey(opts.keyFile);
  if (!key || !CURL_BIN) return null;
  var r = cp.spawnSync(CURL_BIN, ['-s', '-m', '3', '-H', 'Authorization: Bearer ' + key, slotsUrl(opts.baseUrl)],
    { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin' } });
  if (r.status !== 0 || !r.stdout) return null;
  var parsed;
  try { parsed = JSON.parse(r.stdout); } catch (e) { return null; }
  return shape(parsed, opts);
}

function shape(raw, opts) {
  if (!Array.isArray(raw) || !raw.length) return null;
  var busy = 0;
  raw.forEach(function (s) { if (s && s.is_processing === true) busy++; });
  var nCtx = Number((raw[0] || {}).n_ctx) || null;
  return {
    slots_total: raw.length,
    slots_busy: busy,
    slots_free: raw.length - busy,
    n_ctx: nCtx,
    // kv_unified: the slots share ONE pool of n_ctx tokens. This is the
    // number that actually limits concurrency, and it is not slots * n_ctx.
    kv_pool_tokens: nCtx,
    task_kv_tokens: (opts && opts.taskKvTokens) || TASK_KV_TOKENS,
    at: new Date().toISOString()
  };
}

// How many supervised tasks this runtime can hold AT ONCE, budgeted against
// the SHARED KV pool rather than the slot count. On the measured Haddad
// configuration (pool 8192, task ceiling 6400) this is 1 — the answer the
// plan predicted, now derived from measurement rather than assumed, and the
// reason V2.3 does not raise MAX_PARALLEL for GPU work even though three
// small tasks were demonstrably able to run together.
function kvBudgetedCapacity(signal) {
  if (!signal || !signal.kv_pool_tokens || !signal.task_kv_tokens) return null;
  var byKv = Math.floor(signal.kv_pool_tokens / signal.task_kv_tokens);
  return Math.max(0, Math.min(signal.slots_total, byKv));
}

// Is there room for one more supervised task right now?
//   { room: bool, reason, capacity, in_flight }  — or null when unknown.
function roomForAnother(signal, inFlight) {
  if (!signal) return null;
  var capacity = kvBudgetedCapacity(signal);
  if (capacity === null) return null;
  var running = typeof inFlight === 'number' ? inFlight : signal.slots_busy;
  if (capacity < 1) {
    return { room: false, reason: 'kv_pool_too_small_for_one_task', capacity: capacity, in_flight: running };
  }
  if (running >= capacity) {
    return { room: false, reason: 'gpu_at_capacity', capacity: capacity, in_flight: running };
  }
  return { room: true, reason: null, capacity: capacity, in_flight: running };
}

// ------------------------------------------------------------ the GPU lease
//
// V2.3 (scheduler half). The GPU signal alone cannot overlap anything,
// because `gpu_in_flight` was the count of RUNNING tasks — and a task counts
// as running for its whole life, including the minutes it spends in
// validation, declared checks, git and snapshots, none of which touch the
// GPU. With capacity 1 that made "one task at a time" and "one INFERENCE at
// a time" the same sentence, and the second task was refused admission
// while the card sat idle.
//
// A lease separates them. It is held only around a model turn, so:
//
//   task A:  [prompt]--GPU--[validate][checks][git]        <- lease released
//   task B:            waits ----------[prompt]--GPU--...  <- lease acquired
//
// GPU work stays strictly serialised — the thing the KV budget requires —
// while everything that is not GPU work overlaps freely.
//
// IN-PROCESS ON PURPOSE. `bin/mythos-ai-executor serve` runs server.js and
// executor.js in ONE process, and the Haddad provider's run() is called in
// that process, so a module-level registry is a valid central gate for every
// inference this executor starts. It is NOT a cross-process lock and does
// not pretend to be: a second executor process would have its own, which is
// why the KV budget (not this) remains the real ceiling.
//
// A LEASE THAT LEAKS IS WORSE THAN NO LEASE, so every acquire carries a
// deadline and `heldCount()` ignores expired ones. A provider that dies
// mid-turn cannot wedge the GPU shut for the life of the daemon.
var LEASE_TTL_MS = (function () {
  var raw = parseInt(process.env.HADDAD_GPU_LEASE_TTL_MS, 10);
  return isNaN(raw) || raw < 1000 ? 360000 : raw;   // 6 min > the longest observed single turn
})();
var leases = Object.create(null);

function acquire(taskId, opts) {
  if (!taskId) return false;
  var ttl = (opts && opts.ttlMs) || LEASE_TTL_MS;
  leases[taskId] = { at: Date.now(), expires_at: Date.now() + ttl };
  return true;
}

// Acquire ONLY when the card is free, waiting if it is not.
//
// This is the difference between accounting and serialisation, and the
// demonstration that forced it: with a plain `acquire()` the lease records
// who is on the GPU but stops nobody, so two tasks admitted by the gate both
// entered a model turn and the observed maximum was 2 concurrent leases, not
// 1. Admission gates a task ONCE, at its start; nothing then coordinates the
// turns it takes minutes later. An overlap design that only counts is an
// overlap design that does not serialise.
//
// Bounded three ways, because a turn that waits forever is worse than a turn
// that is refused: the caller's own deadline, a hard ceiling, and the TTL
// sweep in heldCount() that stops a dead holder from blocking anyone.
// Resolves { acquired: true } or { acquired: false, reason } — never throws,
// never queues, and grants in no particular order: this is mutual exclusion,
// not fairness, and pretending otherwise would be a scheduler.
function acquireWhenFree(taskId, opts) {
  opts = opts || {};
  var capacity = typeof opts.capacity === 'number' && opts.capacity > 0 ? opts.capacity : 1;
  var deadline = opts.deadline || (Date.now() + (opts.maxWaitMs || LEASE_TTL_MS));
  var pollMs = opts.pollMs || 200;
  var sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  if (!taskId) return Promise.resolve({ acquired: false, reason: 'no_task_id' });

  function attempt() {
    // Already holding it (a repair round re-entering) is not a second claim.
    if (leases[taskId] && leases[taskId].expires_at > Date.now()) {
      return Promise.resolve({ acquired: true, reason: 'already_held', waited_ms: 0 });
    }
    if (heldCount() < capacity) {
      acquire(taskId, opts);
      return Promise.resolve({ acquired: true, reason: null, waited_ms: Date.now() - started });
    }
    if (Date.now() >= deadline) {
      return Promise.resolve({ acquired: false, reason: 'gpu_busy_deadline', waited_ms: Date.now() - started });
    }
    return sleep(Math.min(pollMs, Math.max(1, deadline - Date.now()))).then(attempt);
  }
  var started = Date.now();
  return attempt();
}

function release(taskId) {
  if (taskId && leases[taskId]) { delete leases[taskId]; return true; }
  return false;
}

// Live holders only. An expired lease is swept here rather than by a timer:
// nothing needs to happen when it expires except that it stops counting.
function heldCount(now) {
  var t = now || Date.now();
  var n = 0;
  Object.keys(leases).forEach(function (id) {
    if (leases[id].expires_at > t) n++;
    else delete leases[id];
  });
  return n;
}

function heldBy(now) {
  var t = now || Date.now();
  return Object.keys(leases).filter(function (id) { return leases[id].expires_at > t; });
}

function resetLeasesForTests() { leases = Object.create(null); }

module.exports = {
  TASK_KV_TOKENS: TASK_KV_TOKENS,
  LEASE_TTL_MS: LEASE_TTL_MS,
  acquire: acquire,
  acquireWhenFree: acquireWhenFree,
  release: release,
  heldCount: heldCount,
  heldBy: heldBy,
  resetLeasesForTests: resetLeasesForTests,
  slotsUrl: slotsUrl,
  read: read,
  shape: shape,
  kvBudgetedCapacity: kvBudgetedCapacity,
  roomForAnother: roomForAnother
};
