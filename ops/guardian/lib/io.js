'use strict';
// =====================================================
// MYTHOS Guardian — host I/O boundary
// ops/guardian/lib/io.js
//
// Every read of the host and every mutation goes through this object, so
// the tests can inject a synthetic host and the decision code stays pure.
//
// No shell anywhere: commands run with spawnSync(argv array), a timeout and
// a bounded output buffer. Every function degrades to null / an error
// object instead of throwing into the tick.
// =====================================================

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

function createIo(overrides) {
  var io = {
    procRoot: '/proc',

    now: function () { return Date.now(); },

    readFile: function (p) {
      try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
    },

    readJson: function (p) {
      var t = io.readFile(p);
      if (t === null) return null;
      try { return JSON.parse(t); } catch (e) { return null; }
    },

    exists: function (p) {
      try { fs.lstatSync(p); return true; } catch (e) { return false; }
    },

    lstat: function (p) {
      try { return fs.lstatSync(p); } catch (e) { return null; }
    },

    realpath: function (p) {
      try { return fs.realpathSync(p); } catch (e) { return null; }
    },

    readdir: function (p) {
      try { return fs.readdirSync(p); } catch (e) { return null; }
    },

    readlink: function (p) {
      try { return fs.readlinkSync(p); } catch (e) { return null; }
    },

    statfs: function (p) {
      try { return fs.statfsSync(p); } catch (e) { return null; }
    },

    // argv[0] must be an absolute path or a bare command name; never a
    // shell string. Returns { status, stdout, stderr, error }.
    spawn: function (argv, opts) {
      var o = opts || {};
      try {
        var r = cp.spawnSync(argv[0], argv.slice(1), {
          encoding: 'utf8',
          timeout: o.timeout_ms || 15000,
          maxBuffer: o.max_buffer || 4 * 1024 * 1024,
          env: o.env || { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8', HOME: '/root' },
          stdio: ['ignore', 'pipe', 'pipe']
        });
        return {
          status: r.status,
          stdout: r.stdout || '',
          stderr: r.stderr || '',
          error: r.error ? String(r.error.code || r.error.message) : null
        };
      } catch (e) {
        return { status: null, stdout: '', stderr: '', error: String(e.code || e.message) };
      }
    },

    mkdir: function (p, mode) {
      try { fs.mkdirSync(p, { recursive: true, mode: mode || 0o700 }); return true; } catch (e) { return false; }
    },

    // Atomic replace; returns false on any failure (ENOSPC included).
    writeFileAtomic: function (p, data, mode) {
      var tmp = p + '.tmp-' + process.pid;
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
        fs.writeFileSync(tmp, data, { encoding: 'utf8', mode: mode || 0o600 });
        fs.renameSync(tmp, p);
        return true;
      } catch (e) {
        try { fs.unlinkSync(tmp); } catch (e2) { /* nothing to clean */ }
        return false;
      }
    },

    appendFile: function (p, data, mode) {
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
        fs.appendFileSync(p, data, { encoding: 'utf8', mode: mode || 0o600 });
        return true;
      } catch (e) { return false; }
    },

    rename: function (a, b) {
      try { fs.renameSync(a, b); return true; } catch (e) { return false; }
    },

    // Removes one verified path. rmSync never follows symlinks inside the
    // tree (it unlinks them), and the caller has already refused a symlink
    // at the top.
    remove: function (p) {
      try { fs.rmSync(p, { recursive: true, force: false }); return { ok: true }; }
      catch (e) { return { ok: false, error: String(e.code || e.message) }; }
    }
  };
  Object.keys(overrides || {}).forEach(function (k) { io[k] = overrides[k]; });
  return io;
}

module.exports = { createIo: createIo };
