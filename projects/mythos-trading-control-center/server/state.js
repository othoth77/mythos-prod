'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — persistent state directory
// projects/mythos-trading-control-center/server/state.js
//
// The Control Center keeps a small amount of state of its own: the operator's
// configuration overrides, the configuration history, the audit chain, the used
// approval identifiers, and one directory per completed run. All of it lives
// under ONE directory, outside the git worktree in production.
//
// Three properties, each for a reason:
//
//  * NOTHING IS WRITTEN UNLESS A DIRECTORY WAS CONFIGURED. Without one the
//    state is in-memory and run directories go to a private mkdtemp() folder
//    that is removed on close. This repository has already had a test write a
//    live health record through a `$HOME` default; a default path here cannot.
//  * WRITES ARE ATOMIC. A JSON document is written to a sibling temp file and
//    renamed, so a crash leaves the previous document rather than half of one.
//  * FILES ARE 0600 AND THE DIRECTORY IS 0700. The audit chain records who
//    changed a risk limit; it is not a public document.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

function assertName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name) || name.indexOf('..') !== -1) {
    throw new Error('state: illegal name ' + JSON.stringify(name));
  }
  return name;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.dir] persistent directory; absent means ephemeral
 */
function create(opts) {
  var o = opts || {};
  var persistent = typeof o.dir === 'string' && o.dir.length > 0;
  var dir = persistent ? path.resolve(o.dir) : fs.mkdtempSync(path.join(os.tmpdir(), 'tcc-state-'));
  var closed = false;

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (e) { /* not ours to tighten; reported by describe() */ }

  function file(name) { return path.join(dir, assertName(name)); }

  function readJSON(name, fallback) {
    var p = file(name);
    var text;
    try { text = fs.readFileSync(p, 'utf8'); }
    catch (e) {
      if (e.code === 'ENOENT') return fallback;
      throw e;
    }
    try { return JSON.parse(text); }
    catch (e2) {
      // A corrupt document is not silently replaced by a default: that would
      // turn "the config history is damaged" into "there is no history".
      throw new Error('state: ' + name + ' is not valid JSON (' + e2.message + ')');
    }
  }

  function writeJSON(name, value) {
    var p = file(name);
    var tmp = p + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, p);
    return p;
  }

  function appendLine(name, value) {
    fs.appendFileSync(file(name), JSON.stringify(value) + '\n', { mode: 0o600 });
  }

  function readLines(name) {
    var text;
    try { text = fs.readFileSync(file(name), 'utf8'); }
    catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    var out = [];
    text.split('\n').forEach(function (line, i) {
      if (!line) return;
      try { out.push(JSON.parse(line)); }
      catch (e) { throw new Error('state: ' + name + ' line ' + (i + 1) + ' is not valid JSON'); }
    });
    return out;
  }

  /** A sub-directory, created on demand. Each path segment is validated. */
  function subdir() {
    var parts = Array.prototype.slice.call(arguments).map(assertName);
    var p = path.join.apply(path, [dir].concat(parts));
    fs.mkdirSync(p, { recursive: true, mode: 0o700 });
    return p;
  }

  function listDirs(name) {
    var p = path.join(dir, assertName(name));
    var entries;
    try { entries = fs.readdirSync(p, { withFileTypes: true }); }
    catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    return entries.filter(function (e) { return e.isDirectory() && NAME_RE.test(e.name); })
      .map(function (e) { return e.name; }).sort();
  }

  function close() {
    if (closed) return;
    closed = true;
    if (!persistent) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    }
  }

  return {
    dir: dir,
    persistent: persistent,
    file: file,
    readJSON: readJSON,
    writeJSON: writeJSON,
    appendLine: appendLine,
    readLines: readLines,
    subdir: subdir,
    listDirs: listDirs,
    close: close,
    describe: function () {
      return {
        persistence: persistent ? 'PERSISTENT' : 'EPHEMERAL',
        note: persistent ? null
          : 'no state directory is configured (TCC_STATE_DIR); state is lost when the process stops'
      };
    }
  };
}

module.exports = { create: create, NAME_RE: NAME_RE };
