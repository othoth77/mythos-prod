'use strict';
// =====================================================
// MYTHOS Autopilot — per-operation lock with a fencing token
// projects/mythos-ai-executor/lib/autopilot/lock.js
//
// One lock file per OPERATION (git-sync, restart, worktrees, watchdog, ...),
// so a timer tick, a webhook-driven run and a manual CLI invocation of the
// same operation can never execute concurrently: the second caller gets
// { acquired:false, reason:'already_running' } and simply skips — it does
// not queue and it does not wait (GitHub Actions `concurrency` with
// `queue: single`, minus the pending slot, which a periodic reconciler does
// not need: the next tick is the retry).
//
// Semantics are the bridge's (bridge/github-bridge.js acquireLock): the
// lock is created with O_EXCL, carries pid/host/fence/heartbeat, and a lock
// whose owner is dead or whose heartbeat is older than staleMs is taken over
// with a strictly higher fence. A fenced-out holder can detect it via
// stillHeld() and must not apply a mutation.
//
// Nothing here is shared with the bridge's own lock file: a different
// operation, a different file.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var DEFAULT_STALE_MS = 10 * 60 * 1000;

function nowIso(now) { return new Date(now || Date.now()).toISOString(); }

function processAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function lockFile(root, op) { return path.join(root, 'locks', op + '.lock'); }
function fenceFile(root) { return path.join(root, 'locks', 'fence.json'); }

function writeAtomic(file, text) {
  var tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function nextFence(root, atLeast) {
  var f = fenceFile(root);
  var cur = 0;
  try { cur = parseInt((readJson(f) || {}).fence, 10) || 0; } catch (e) { cur = 0; }
  var next = Math.max(cur, atLeast || 0) + 1;
  writeAtomic(f, JSON.stringify({ fence: next, updated_at: nowIso(), by: process.pid }) + '\n');
  return next;
}

// acquire(root, op, opts) → { acquired, lock, reason, holder }
function acquire(root, op, opts) {
  opts = opts || {};
  var staleMs = opts.stale_ms || DEFAULT_STALE_MS;
  var now = opts.now || Date.now();
  var file = lockFile(root, op);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  var held = readJson(file);
  var takeover = null;
  if (held) {
    var alive = (opts.alive || processAlive)(held.pid);
    var hb = Date.parse(held.heartbeat_at || held.acquired_at || 0);
    var age = isNaN(hb) ? Infinity : now - hb;
    var sameHost = !held.host || held.host === os.hostname();
    if (alive && sameHost && age < staleMs) {
      return { acquired: false, reason: 'already_running', holder: { pid: held.pid, fence: held.fence, acquired_at: held.acquired_at, heartbeat_at: held.heartbeat_at } };
    }
    takeover = { previous_pid: held.pid, previous_fence: held.fence || 0, alive: alive, age_ms: age };
    try { fs.unlinkSync(file); } catch (e) { /* raced: O_EXCL below decides */ }
  }
  var fence = nextFence(root, held ? held.fence : 0);
  var rec = { op: op, pid: process.pid, host: os.hostname(), fence: fence, acquired_at: nowIso(now), heartbeat_at: nowIso(now) };
  var fd;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch (e) {
    if (e.code === 'EEXIST') return { acquired: false, reason: 'already_running', holder: readJson(file) };
    throw e;
  }
  fs.writeSync(fd, JSON.stringify(rec) + '\n');
  fs.closeSync(fd);
  return { acquired: true, lock: { file: file, op: op, pid: process.pid, fence: fence, takeover: takeover }, reason: null };
}

function stillHeld(lock) {
  if (!lock) return false;
  var held = readJson(lock.file);
  return !!(held && held.pid === lock.pid && held.fence === lock.fence);
}

function heartbeat(lock, now) {
  if (!stillHeld(lock)) return false;
  var held = readJson(lock.file);
  held.heartbeat_at = nowIso(now);
  writeAtomic(lock.file, JSON.stringify(held) + '\n');
  return true;
}

function release(lock) {
  if (!lock) return false;
  if (!stillHeld(lock)) return false; // fenced out: someone else's lock now
  try { fs.unlinkSync(lock.file); return true; } catch (e) { return false; }
}

// withLock(root, op, fn, opts): runs fn(lock) under the lock; never runs it
// when the lock is held elsewhere. Returns fn's result or the skip record.
function withLock(root, op, fn, opts) {
  var got = acquire(root, op, opts);
  if (!got.acquired) return { skipped: true, reason: got.reason, holder: got.holder, op: op };
  try { return fn(got.lock); }
  finally { release(got.lock); }
}

module.exports = {
  DEFAULT_STALE_MS: DEFAULT_STALE_MS,
  acquire: acquire,
  release: release,
  heartbeat: heartbeat,
  stillHeld: stillHeld,
  withLock: withLock,
  lockFile: lockFile,
  processAlive: processAlive
};
