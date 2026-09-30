'use strict';
// =====================================================
// MYTHOS TRADING AGENT — structured logging
// projects/mythos-trading-agent/src/core/logger.js
//
// Mission §17 asks the system to be able to answer "why did it enter / reject /
// lose / increase recovery / get blocked". That is a query over records, not a
// grep over prose, so every log line here is an object with a stable `event`
// name and typed fields — never an interpolated sentence.
//
// Two decisions that matter:
//
//  1. TIME IS INJECTED. The logger takes a `now()` provider; a backtest passes
//     the simulated bar time. Logs of one backtest run are therefore identical
//     across reruns, which is what makes them usable as evidence rather than
//     as atmosphere.
//  2. THE DEFAULT SINK IS MEMORY. Nothing writes to disk unless a caller asks
//     for a file sink with an explicit path, so importing this module can never
//     touch the filesystem (the failure mode tests/backup-run-db-test.js hit in
//     this repository on 2026-09-14).
// =====================================================

var enums = require('./enums');

var LEVEL_ORDER = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

/**
 * Field names whose values are replaced by '[redacted]' before a line leaves.
 * Compared LOWER-CASE, so this list must be lower-case too — 'apiKey' here
 * would never match, because the lookup lowercases the incoming key.
 */
var REDACT_KEYS = [
  'token', 'apikey', 'api_key', 'accesstoken', 'access_token', 'refreshtoken',
  'secret', 'password', 'passwd', 'authorization', 'auth', 'bearer',
  'privatekey', 'private_key', 'credentials'
];

function redact(value, depth) {
  var d = depth === undefined ? 0 : depth;
  if (d > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(function (v) { return redact(v, d + 1); });
  var out = {};
  Object.keys(value).forEach(function (k) {
    if (REDACT_KEYS.indexOf(String(k).toLowerCase()) !== -1) out[k] = '[redacted]';
    else out[k] = redact(value[k], d + 1);
  });
  return out;
}

/** In-memory sink. Keeps at most `limit` lines, oldest dropped. */
function memorySink(limit) {
  var cap = limit === undefined ? 100000 : limit;
  var lines = [];
  var dropped = 0;
  return {
    kind: 'memory',
    write: function (rec) {
      lines.push(rec);
      if (lines.length > cap) { lines.shift(); dropped++; }
    },
    lines: function () { return lines.slice(); },
    /** Every record whose event name matches. */
    byEvent: function (event) {
      return lines.filter(function (r) { return r.event === event; });
    },
    count: function () { return lines.length; },
    dropped: function () { return dropped; },
    clear: function () { lines = []; dropped = 0; }
  };
}

/** JSON-lines file sink. Opens lazily on first write. */
function fileSink(filePath) {
  var fs = require('fs');
  var path = require('path');
  var fd = null;
  return {
    kind: 'file',
    path: filePath,
    write: function (rec) {
      if (fd === null) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fd = fs.openSync(filePath, 'a');
      }
      fs.writeSync(fd, JSON.stringify(rec) + '\n');
    },
    close: function () { if (fd !== null) { fs.closeSync(fd); fd = null; } }
  };
}

/** Sink that prints one JSON object per line to stdout. */
function consoleSink() {
  return {
    kind: 'console',
    write: function (rec) { process.stdout.write(JSON.stringify(rec) + '\n'); }
  };
}

/**
 * Creates a logger.
 *
 * @param {object} [opts]
 * @param {string} [opts.level='INFO']
 * @param {object[]} [opts.sinks] defaults to a single memory sink
 * @param {function} [opts.now] returns the timestamp for a record; a backtest
 *        passes its simulated clock so logs stay reproducible
 * @param {object} [opts.bindings] fields merged into every record
 */
function create(opts) {
  var o = opts || {};
  var level = o.level || enums.LogLevel.INFO;
  enums.assertEnum(enums.LogLevel, level, 'log level');
  var sinks = o.sinks && o.sinks.length ? o.sinks.slice() : [memorySink()];
  var now = typeof o.now === 'function' ? o.now : function () { return Date.now(); };
  var bindings = o.bindings ? shallow(o.bindings) : {};

  function emit(lvl, event, fields) {
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[level]) return;
    var rec = { ts: now(), level: lvl, event: String(event) };
    Object.keys(bindings).forEach(function (k) { rec[k] = bindings[k]; });
    if (fields) {
      var safe = redact(fields);
      Object.keys(safe).forEach(function (k) {
        if (k !== 'ts' && k !== 'level' && k !== 'event') rec[k] = safe[k];
      });
    }
    for (var i = 0; i < sinks.length; i++) sinks[i].write(rec);
  }

  var api = {
    debug: function (event, fields) { emit('DEBUG', event, fields); },
    info: function (event, fields) { emit('INFO', event, fields); },
    warn: function (event, fields) { emit('WARN', event, fields); },
    error: function (event, fields) { emit('ERROR', event, fields); },
    /** A logger with extra permanent fields — e.g. child({ asset: 'EURUSD' }). */
    child: function (extra) {
      var merged = shallow(bindings);
      Object.keys(extra || {}).forEach(function (k) { merged[k] = extra[k]; });
      return create({ level: level, sinks: sinks, now: now, bindings: merged });
    },
    level: function () { return level; },
    setLevel: function (l) { enums.assertEnum(enums.LogLevel, l, 'log level'); level = l; },
    sinks: function () { return sinks.slice(); },
    /** The first memory sink, when there is one — the handle tests read. */
    memory: function () {
      for (var i = 0; i < sinks.length; i++) if (sinks[i].kind === 'memory') return sinks[i];
      return null;
    },
    close: function () {
      sinks.forEach(function (s) { if (typeof s.close === 'function') s.close(); });
    }
  };
  return api;
}

function shallow(o) {
  var out = {};
  Object.keys(o).forEach(function (k) { out[k] = o[k]; });
  return out;
}

/** A logger that discards everything — for hot loops and for silent tests. */
function nullLogger() {
  var noop = function () {};
  var api = {
    debug: noop, info: noop, warn: noop, error: noop,
    child: function () { return api; },
    level: function () { return 'ERROR'; },
    setLevel: noop,
    sinks: function () { return []; },
    memory: function () { return null; },
    close: noop
  };
  return api;
}

module.exports = {
  create: create,
  memorySink: memorySink,
  fileSink: fileSink,
  consoleSink: consoleSink,
  nullLogger: nullLogger,
  LEVEL_ORDER: LEVEL_ORDER
};
