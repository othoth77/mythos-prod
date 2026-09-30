'use strict';
// =====================================================
// MYTHOS TRADING AGENT — append-only record store
// projects/mythos-trading-agent/src/db/store.js
//
// Owner approval §7: "use the project's existing repository/storage
// architecture where appropriate. No new external database/service unless
// technically necessary and documented first." So this is a file-backed
// append-only store in the repository's own idiom (JSON lines, one file per
// table, a manifest beside them) — no server, no driver, no dependency.
//
// Properties that matter, and the reason for each:
//
//  * APPEND-ONLY. insert() only. A state change is a new row with a higher
//    seq. This is what makes the trade log usable as evidence.
//  * IN-MEMORY BY DEFAULT. Constructing a store touches no filesystem path.
//    Persistence happens when a caller passes `dir` AND calls flush()/seal().
//    (This repository has already had a test write a live health record; the
//    default here cannot.)
//  * DETERMINISTIC ROW ORDER. Rows carry a monotonic seq assigned at insert, so
//    two runs of one config produce byte-identical table files — which is how
//    the reproducibility gate is actually checked.
//  * REQUIRED-FIELD VALIDATION at insert. A candidate missing `expectedNetMoney`
//    fails where it was created, not three phases later in an analysis query.
//  * SEALING. seal() writes the manifest and refuses further inserts. A sealed
//    run cannot grow a row after its metrics were computed.
// =====================================================

var schema = require('./schema');
var errors = require('../core/errors');
var hashMod = require('../core/hash');

/**
 * @param {object} [opts]
 * @param {string} [opts.runId='adhoc']
 * @param {string} [opts.dir] directory for flush()/seal(); nothing is written
 *        until one of those is called
 * @param {function} [opts.now] () => epoch ms, injected so runs stay reproducible
 * @param {object} [opts.meta] free-form provenance stored in the manifest
 */
function create(opts) {
  var o = opts || {};
  var runId = o.runId || 'adhoc';
  var dir = o.dir || null;
  var now = typeof o.now === 'function' ? o.now : function () { return Date.now(); };
  var meta = o.meta || {};

  var tables = Object.create(null);
  var indexes = Object.create(null);
  var seq = 0;
  var sealed = false;
  var sealedAt = null;

  schema.TABLE_NAMES.forEach(function (name) {
    tables[name] = [];
    indexes[name] = Object.create(null);
    schema.definition(name).indexed.forEach(function (f) {
      indexes[name][f] = Object.create(null);
    });
  });

  function validate(name, rec) {
    var def = schema.definition(name);
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
      throw errors.StoreError('insert into ' + name + ' requires an object record, got ' + (Array.isArray(rec) ? 'array' : typeof rec));
    }
    var missing = def.required.filter(function (f) { return rec[f] === undefined; });
    if (missing.length) {
      throw errors.StoreError(
        'insert into ' + name + ' missing required field(s): ' + missing.join(', '),
        { table: name, missing: missing }
      );
    }
  }

  function insert(name, rec) {
    if (sealed) {
      throw errors.StoreError('store for run ' + runId + ' is sealed; cannot insert into ' + name, { table: name, runId: runId });
    }
    validate(name, rec);
    seq += 1;
    var row = { _seq: seq, _table: name };
    Object.keys(rec).forEach(function (k) { row[k] = rec[k]; });
    Object.freeze(row); // a stored row is evidence; evidence does not change
    tables[name].push(row);
    var idx = indexes[name];
    Object.keys(idx).forEach(function (f) {
      var v = row[f];
      if (v === undefined || v === null) return;
      var key = String(v);
      if (!idx[f][key]) idx[f][key] = [];
      idx[f][key].push(row);
    });
    return row;
  }

  function table(name) {
    schema.definition(name); // throws on unknown table
    return {
      name: name,
      insert: function (rec) { return insert(name, rec); },
      insertMany: function (recs) { return recs.map(function (r) { return insert(name, r); }); },
      all: function () { return tables[name].slice(); },
      count: function () { return tables[name].length; },
      /** Index lookup when `field` is indexed; linear scan otherwise. */
      by: function (field, value) {
        var idx = indexes[name][field];
        if (idx) return (idx[String(value)] || []).slice();
        return tables[name].filter(function (r) { return r[field] === value; });
      },
      first: function (field, value) {
        var rows = this.by(field, value);
        return rows.length ? rows[0] : null;
      },
      find: function (pred) { return tables[name].filter(pred); },
      last: function () {
        var rows = tables[name];
        return rows.length ? rows[rows.length - 1] : null;
      },
      isIndexed: function (field) { return !!indexes[name][field]; }
    };
  }

  /** Row counts per non-empty table — the shape reports and tests assert on. */
  function counts() {
    var out = {};
    schema.TABLE_NAMES.forEach(function (n) {
      if (tables[n].length) out[n] = tables[n].length;
    });
    return out;
  }

  /**
   * SHA-256 over every non-empty table's canonical rows. Two runs of the same
   * configuration must produce the same digest; that equality IS the
   * reproducibility check.
   */
  function digest() {
    var payload = {};
    schema.TABLE_NAMES.forEach(function (n) {
      if (tables[n].length) {
        payload[n] = tables[n].map(function (r) {
          var c = {};
          Object.keys(r).forEach(function (k) { if (k !== '_table') c[k] = r[k]; });
          return c;
        });
      }
    });
    return hashMod.sha256(payload);
  }

  function manifest() {
    return {
      runId: runId,
      schemaVersion: 1,
      sealed: sealed,
      sealedAt: sealedAt,
      rows: seq,
      counts: counts(),
      digest: digest(),
      meta: meta
    };
  }

  /**
   * Writes every non-empty table to `dir` as JSON lines plus a manifest.
   * Requires `dir`; refuses rather than inventing a path.
   */
  function flush() {
    if (!dir) {
      throw errors.StoreError('flush() needs a store directory; create the store with { dir } to persist it');
    }
    var fs = require('fs');
    var path = require('path');
    fs.mkdirSync(dir, { recursive: true });
    var written = [];
    schema.TABLE_NAMES.forEach(function (n) {
      if (!tables[n].length) return;
      var file = path.join(dir, n + '.jsonl');
      var body = tables[n].map(function (r) { return JSON.stringify(r); }).join('\n') + '\n';
      fs.writeFileSync(file, body);
      written.push(n + '.jsonl');
    });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest(), null, 2) + '\n');
    return { dir: dir, files: written.concat(['manifest.json']) };
  }

  /** Flushes when a directory is configured, then forbids further inserts. */
  function seal() {
    if (sealed) return manifest();
    sealedAt = now();
    sealed = true;
    if (dir) flush();
    return manifest();
  }

  return {
    runId: runId,
    dir: dir,
    table: table,
    insert: insert,
    counts: counts,
    digest: digest,
    manifest: manifest,
    flush: flush,
    seal: seal,
    isSealed: function () { return sealed; },
    rowCount: function () { return seq; },
    tableNames: function () { return schema.TABLE_NAMES.slice(); }
  };
}

/** Reads a previously flushed store directory back into a plain object. */
function readDir(dir) {
  var fs = require('fs');
  var path = require('path');
  var manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw errors.StoreError('no manifest.json in ' + dir + '; not a Mythos trading store');
  }
  var out = { manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), tables: {} };
  fs.readdirSync(dir).forEach(function (f) {
    if (!/\.jsonl$/.test(f)) return;
    var name = f.replace(/\.jsonl$/, '');
    var text = fs.readFileSync(path.join(dir, f), 'utf8');
    out.tables[name] = text.split('\n').filter(function (l) { return l.length > 0; }).map(function (l) { return JSON.parse(l); });
  });
  return out;
}

module.exports = {
  create: create,
  readDir: readDir
};
