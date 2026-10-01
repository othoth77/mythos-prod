'use strict';
// =====================================================
// MYTHOS OS v4 — the decision ledger (traceability)
// projects/mythos-os-v4/lib/ledger.js
//
// Every decision and every result in the chain DOTS → executive → JEV →
// Haddad is one line here: who decided (actor), what (type), for which goal
// and trace, and the evidence (detail). Append-only JSONL, and each line
// carries the SHA-256 of the line before it, so a removed, reordered or
// edited record is detectable by verify() — a trace nobody can vouch for is
// not a trace.
//
// Nothing secret is ever written: detail passes through the orchestrator's
// redactor (lib/redact.js, reused unmodified) and strings are bounded.
// =====================================================

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var store = require('./store');
var redact = require('../../mythos-orchestrator/lib/redact');

var GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';
var MAX_STRING = 4000;

function ledgerFile() { return store.file('ledger', 'decisions.jsonl'); }
function headFile() { return store.file('ledger', 'head.json'); }
function lockFile() { return store.file('ledger', '.lock'); }

function bound(value, depth) {
  depth = depth || 0;
  if (typeof value === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING - 1) + '…' : value;
  if (depth > 6) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 60).map(function (v) { return bound(v, depth + 1); });
  if (value && typeof value === 'object') {
    var out = {};
    Object.keys(value).slice(0, 60).forEach(function (k) { out[k] = bound(value[k], depth + 1); });
    return out;
  }
  return value === undefined ? null : value;
}

function hashOf(prev, body) {
  return crypto.createHash('sha256').update(prev + '\n' + JSON.stringify(body)).digest('hex');
}

// append({ actor, type, goal_id, trace_id, detail }) -> the stored record.
function append(entry, opts) {
  opts = opts || {};
  if (!entry || typeof entry.actor !== 'string' || typeof entry.type !== 'string') {
    throw new Error('LEDGER_INVALID_ENTRY: actor and type are required');
  }
  return store.withLock(lockFile(), function () {
    var head = store.readJSON(headFile(), null) || { seq: 0, hash: GENESIS };
    var body = {
      seq: head.seq + 1,
      at: (opts.now ? new Date(opts.now()) : new Date()).toISOString(),
      trace_id: entry.trace_id || null,
      goal_id: entry.goal_id || null,
      actor: entry.actor,
      type: entry.type,
      detail: redact.redactValue(bound(entry.detail === undefined ? null : entry.detail))
    };
    var record = Object.assign({}, body, { prev: head.hash, hash: hashOf(head.hash, body) });
    store.ensureDir(path.dirname(ledgerFile()));
    fs.appendFileSync(ledgerFile(), JSON.stringify(record) + '\n', { mode: 0o600 });
    store.writeJSON(headFile(), { seq: record.seq, hash: record.hash });
    return record;
  });
}

function readAll() {
  var text;
  try { text = fs.readFileSync(ledgerFile(), 'utf8'); } catch (e) { return []; }
  return text.split('\n').filter(Boolean).map(function (line, i) {
    try { return JSON.parse(line); } catch (e) { return { corrupt: true, line: i + 1 }; }
  });
}

// query({ goal_id?, trace_id?, type?, actor? }) -> matching records, oldest first.
function query(filter) {
  filter = filter || {};
  return readAll().filter(function (r) {
    if (r.corrupt) return false;
    return ['goal_id', 'trace_id', 'type', 'actor'].every(function (k) {
      return filter[k] === undefined || r[k] === filter[k];
    });
  });
}

// verify() -> { ok, records, problems[] }. Recomputes the whole chain.
function verify() {
  var records = readAll();
  var problems = [];
  var prev = GENESIS;
  records.forEach(function (r, i) {
    if (r.corrupt) { problems.push('line ' + (i + 1) + ': not JSON'); return; }
    if (r.seq !== i + 1) problems.push('line ' + (i + 1) + ': seq ' + r.seq + ' out of order');
    if (r.prev !== prev) problems.push('line ' + (i + 1) + ': chain broken (prev does not match)');
    var body = { seq: r.seq, at: r.at, trace_id: r.trace_id, goal_id: r.goal_id, actor: r.actor, type: r.type, detail: r.detail };
    if (hashOf(r.prev, body) !== r.hash) problems.push('line ' + (i + 1) + ': hash mismatch (record edited)');
    prev = r.hash;
  });
  var head = store.readJSON(headFile(), null);
  if (records.length && head && (head.seq !== records.length || head.hash !== prev)) {
    problems.push('head does not match the last record (a record was removed or appended outside the ledger)');
  }
  return { ok: problems.length === 0, records: records.length, problems: problems };
}

module.exports = {
  append: append,
  query: query,
  readAll: readAll,
  verify: verify,
  ledgerFile: ledgerFile,
  GENESIS: GENESIS
};
