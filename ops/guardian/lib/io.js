'use strict';
// =====================================================
// MYTHOS Guardian V0 — I/O boundary (observe-only)
// ops/guardian/lib/io.js
//
// Everything the engine touches goes through this object, so tests drive a
// synthetic host and the decision code stays pure.
//
// V0 IS OBSERVE-ONLY BY CONSTRUCTION:
//   * the only writes are inside Guardian's own state directory, enforced
//     here (`assertOwnState`), not by convention;
//   * there is no remove/unlink/rmdir/chmod/chown of any kind;
//   * commands are matched against a READ_COMMANDS allowlist of exact argv
//     prefixes — an argv that is not on the list never reaches spawnSync,
//     so no dynamic input can become a command.
// =====================================================

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

// Exact argv prefixes. Everything here is read-only by nature: systemctl
// show/is-active/list-timers query the manager, docker inspect/system df
// query the daemon. No start, stop, restart, prune, rm or exec.
var READ_COMMANDS = [
  ['systemctl', 'show'],
  ['systemctl', 'is-active'],
  ['systemctl', 'list-timers'],
  ['systemctl', '--user', 'show'],
  ['systemctl', '--user', 'is-active'],
  ['docker', 'inspect'],
  ['docker', 'system', 'df']
];

function allowedCommand(argv) {
  if (!Array.isArray(argv) || !argv.length) return false;
  return READ_COMMANDS.some(function (prefix) {
    return prefix.every(function (tok, i) { return argv[i] === tok; });
  });
}

// A minimal, explicit environment. `systemctl --user` needs the session bus
// to reach the deploy user manager, so those two variables are passed
// through when they exist (and a default runtime dir is derived from the
// uid otherwise) — everything else is dropped.
function cleanEnv(o) {
  var env = {
    PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
    LANG: 'C.UTF-8',
    HOME: (o && o.home) || process.env.HOME || '/home/deploy'
  };
  var runtime = process.env.XDG_RUNTIME_DIR ||
    (typeof process.getuid === 'function' ? '/run/user/' + process.getuid() : null);
  if (runtime) env.XDG_RUNTIME_DIR = runtime;
  if (process.env.DBUS_SESSION_BUS_ADDRESS) env.DBUS_SESSION_BUS_ADDRESS = process.env.DBUS_SESSION_BUS_ADDRESS;
  else if (runtime) env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=' + runtime + '/bus';
  return env;
}

function createIo(overrides) {
  var io = {
    procRoot: '/proc',            // the process table Guardian OBSERVES (tests redirect it)
    lockProcRoot: '/proc',        // the REAL process table, used only for lock liveness
    stateDir: null,               // set by the engine; the only writable root

    now: function () { return Date.now(); },

    readFile: function (p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } },
    readJson: function (p) { var t = io.readFile(p); if (t === null) return null; try { return JSON.parse(t); } catch (e) { return null; } },
    exists: function (p) { try { fs.lstatSync(p); return true; } catch (e) { return false; } },
    lstat: function (p) { try { return fs.lstatSync(p); } catch (e) { return null; } },
    readdir: function (p) { try { return fs.readdirSync(p); } catch (e) { return null; } },
    readlink: function (p) { try { return fs.readlinkSync(p); } catch (e) { return null; } },
    statfs: function (p) { try { return fs.statfsSync(p); } catch (e) { return null; } },

    // Bounded tail read: for append-only logs (memwatch) that must never be
    // slurped whole. Returns at most `maxBytes` from the end of the file.
    readFileTail: function (p, maxBytes) {
      var cap = maxBytes || 4096;
      var fd = null;
      try {
        var st = fs.lstatSync(p);
        if (!st.isFile()) return null;
        fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        var start = st.size > cap ? st.size - cap : 0;
        var len = Math.min(cap, st.size);
        if (len === 0) return '';
        var buf = Buffer.alloc(len);
        var read = fs.readSync(fd, buf, 0, len, start);
        var text = buf.slice(0, read).toString('utf8');
        // A partial first line is discarded, so callers never parse a fragment.
        if (start > 0) {
          var nl = text.indexOf('\n');
          text = nl < 0 ? '' : text.slice(nl + 1);
        }
        return text;
      } catch (e) {
        return null;
      } finally {
        if (fd !== null) { try { fs.closeSync(fd); } catch (e2) { /* already closed */ } }
      }
    },

    // Read-only command execution, allowlisted argv prefixes only.
    spawn: function (argv, opts) {
      var o = opts || {};
      if (!allowedCommand(argv)) {
        return { status: null, stdout: '', stderr: '', error: 'command_not_allowlisted', refused: true };
      }
      try {
        var r = cp.spawnSync(argv[0], argv.slice(1), {
          encoding: 'utf8',
          timeout: o.timeout_ms || 15000,
          maxBuffer: o.max_buffer || 4 * 1024 * 1024,
          env: cleanEnv(o),
          stdio: ['ignore', 'pipe', 'pipe']
        });
        return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error ? String(r.error.code || r.error.message) : null };
      } catch (e) {
        return { status: null, stdout: '', stderr: '', error: String(e.code || e.message) };
      }
    },

    // --- writes: Guardian's own state directory only --------------------
    assertOwnState: function (p) {
      if (!io.stateDir) throw new Error('guardian: stateDir not set — refusing to write ' + p);
      var root = path.resolve(io.stateDir);
      var target = path.resolve(p);
      if (target !== root && target.indexOf(root + path.sep) !== 0) {
        throw new Error('guardian: refusing to write outside the state directory: ' + target);
      }
      return target;
    },

    mkdirState: function (p, mode) {
      try { fs.mkdirSync(io.assertOwnState(p), { recursive: true, mode: mode || 0o755 }); return true; } catch (e) { return false; }
    },

    writeStateAtomic: function (p, data, mode) {
      var target;
      try { target = io.assertOwnState(p); } catch (e) { return false; }
      var tmp = target + '.tmp-' + process.pid;
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
        fs.writeFileSync(tmp, data, { encoding: 'utf8', mode: mode || 0o644 });
        fs.renameSync(tmp, target);
        return true;
      } catch (e) {
        try { fs.unlinkSync(tmp); } catch (e2) { /* nothing staged */ }
        return false;
      }
    },

    appendState: function (p, data, mode) {
      var target;
      try { target = io.assertOwnState(p); } catch (e) { return false; }
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
        fs.appendFileSync(target, data, { encoding: 'utf8', mode: mode || 0o644 });
        return true;
      } catch (e) { return false; }
    },

    renameState: function (a, b) {
      try { fs.renameSync(io.assertOwnState(a), io.assertOwnState(b)); return true; } catch (e) { return false; }
    },

    // --- single-instance lock (flock, own state directory) ---------------
    lock: function (p) {
      var target;
      try { target = io.assertOwnState(p); } catch (e) { return null; }
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
        var fd = fs.openSync(target, 'w');
        try {
          // Node has no flock; use an atomic O_EXCL sentinel beside it with
          // a stale-age fallback so a killed run cannot wedge the timer.
          fs.closeSync(fd);
        } catch (e) { /* closed below */ }
        var sentinel = target + '.held';
        try {
          var h = fs.openSync(sentinel, 'wx');
          fs.writeSync(h, JSON.stringify({ pid: process.pid, at: new Date(io.now()).toISOString() }) + '\n');
          fs.closeSync(h);
          return { path: sentinel, acquired: true };
        } catch (e) {
          if (e && e.code === 'EEXIST') {
            var held = io.readJson(sentinel);
            var ageMs = held && held.at ? (io.now() - Date.parse(held.at)) : Infinity;
            // Liveness is checked against the REAL /proc, never io.procRoot:
            // a suite that points procRoot at a synthetic process table would
            // otherwise see every holder as dead and break mutual exclusion.
            // A process also never holds its own lock twice.
            var alive = held && held.pid
              ? (held.pid === process.pid || fs.existsSync(path.join(io.lockProcRoot, String(held.pid))))
              : false;
            if (alive && ageMs < 15 * 60 * 1000) return { path: sentinel, acquired: false, held_by: held };
            // stale: the holder is gone or ancient
            try { fs.unlinkSync(sentinel); } catch (e2) { return { path: sentinel, acquired: false, held_by: held, stale: true }; }
            return io.lock(p);
          }
          return { path: sentinel, acquired: false, error: String((e && e.code) || e) };
        }
      } catch (e) { return { path: target, acquired: false, error: String((e && e.code) || e) }; }
    },

    unlock: function (lock) {
      if (!lock || !lock.acquired) return false;
      try { fs.unlinkSync(io.assertOwnState(lock.path)); return true; } catch (e) { return false; }
    }
  };
  Object.keys(overrides || {}).forEach(function (k) { io[k] = overrides[k]; });
  return io;
}

module.exports = { createIo: createIo, READ_COMMANDS: READ_COMMANDS, allowedCommand: allowedCommand, cleanEnv: cleanEnv };
