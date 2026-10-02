'use strict';
// =====================================================
// MYTHOS OS v4 — persistent store
// projects/mythos-os-v4/lib/store.js
//
// Runtime state lives under MYTHOS_OS_HOME (default
// ~/.local/state/mythos-os-v4): goals, escalations, the decision ledger,
// the watchdog's and JEV's health records. Never /tmp, never Git.
// Every write is whole-file atomic (temp + rename); the directories are
// 0700 and the files 0600 because a goal may quote private text.
// =====================================================

var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var path = require('path');

function home() {
  return process.env.MYTHOS_OS_HOME || path.join(os.homedir(), '.local', 'state', 'mythos-os-v4');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function file() {
  var parts = Array.prototype.slice.call(arguments);
  return path.join.apply(path, [home()].concat(parts));
}

function readJSON(target, fallback) {
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch (e) { return fallback; }
}

function writeJSON(target, value) {
  ensureDir(path.dirname(target));
  var tmp = target + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, target);
  return value;
}

var ID_RE = /^[a-z][a-z0-9]{1,8}-[0-9]{14}-[a-z0-9]{6}$/;

function newId(prefix, now) {
  var d = now ? new Date(now) : new Date();
  var stamp = d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  var rand = '';
  var alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var bytes = crypto.randomBytes(6);
  for (var i = 0; i < 6; i++) rand += alphabet[bytes[i] % alphabet.length];
  return prefix + '-' + stamp + '-' + rand;
}

function isValidId(id) { return typeof id === 'string' && ID_RE.test(id); }

// A bounded, synchronous, cross-process lock: O_EXCL create, short sleeps,
// and a stale lock (its holder died) is broken after `staleMs`. Callers hold
// it for one read-modify-write, never across a model call.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(lockFile, fn, opts) {
  opts = opts || {};
  var waitMs = opts.waitMs || 5000;
  var staleMs = opts.staleMs || 15000;
  ensureDir(path.dirname(lockFile));
  var started = Date.now();
  var fd = null;
  for (;;) {
    try {
      fd = fs.openSync(lockFile, 'wx', 0o600);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        var st = fs.statSync(lockFile);
        if (Date.now() - st.mtimeMs > staleMs) { fs.unlinkSync(lockFile); continue; }
      } catch (e2) { continue; }
      if (Date.now() - started > waitMs) throw new Error('STORE_LOCK_TIMEOUT: ' + path.basename(lockFile));
      sleepSync(15);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch (e3) { /* already closed */ }
    try { fs.unlinkSync(lockFile); } catch (e4) { /* already gone */ }
  }
}

module.exports = {
  home: home,
  ensureDir: ensureDir,
  file: file,
  readJSON: readJSON,
  writeJSON: writeJSON,
  newId: newId,
  isValidId: isValidId,
  withLock: withLock
};
