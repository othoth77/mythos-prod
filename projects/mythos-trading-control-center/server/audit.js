'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — audit chain
// projects/mythos-trading-control-center/server/audit.js
//
// Every state-changing request through the Control Center appends ONE entry
// here: who, what, when, the value before, the value after, the reason given,
// and whether it was allowed. A refused request is recorded exactly like an
// accepted one — "somebody tried to enable trading and was refused" is the
// record that matters most after an incident.
//
// THE CHAIN. Each entry carries the SHA-256 of the previous entry and its own
// hash over its canonical form. Rewriting, deleting or reordering an entry
// breaks every hash after it, and verify() says where. That is not tamper
// PROOFING — whoever can write the file can rewrite the whole chain — it is
// tamper EVIDENCE for the cases that actually happen: a truncated file, a
// hand edit, a partial restore.
//
// WHAT IT REFUSES TO WRITE.
//   * Secret-shaped keys anywhere in a value: dropped and replaced by a marker,
//     so a caller that hands this module a password writes "[REDACTED]".
//   * A session identifier in full: the actor's session is its first 8 hex chars.
//   * Unbounded values: anything larger than MAX_VALUE_BYTES is replaced by its
//     hash and size, which still proves WHAT changed without storing it twice.
// =====================================================

var crypto = require('crypto');

var FILE = 'audit.jsonl';
var MAX_VALUE_BYTES = 8 * 1024;
var MAX_MEMORY = 5000;
var GENESIS = '0'.repeat(64);

var SECRET_KEY_RE = /pass(word|wd)?|secret|token|api[-_]?key|authorization|cookie|csrf|credential|private[-_]?key|bearer|session[-_]?id/i;

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().filter(function (k) { return value[k] !== undefined; })
    .map(function (k) { return JSON.stringify(k) + ':' + canonical(value[k]); }).join(',') + '}';
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Deep copy with secret-shaped keys replaced. Depth-limited; never throws. */
function redact(value, depth) {
  var d = depth || 0;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 2000 ? value.slice(0, 2000) + '…[truncated]' : value;
  if (typeof value === 'number') return isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'object') return null;
  if (d > 8) return '[DEPTH]';
  if (Array.isArray(value)) return value.slice(0, 500).map(function (v) { return redact(v, d + 1); });
  var out = {};
  Object.keys(value).forEach(function (k) {
    out[k] = SECRET_KEY_RE.test(k) ? '[REDACTED]' : redact(value[k], d + 1);
  });
  return out;
}

/** Bounds a value: small ones are kept, large ones become {hash,bytes}. */
function bounded(value) {
  if (value === undefined || value === null) return null;
  var safe = redact(value);
  var text = canonical(safe);
  if (Buffer.byteLength(text, 'utf8') <= MAX_VALUE_BYTES) return safe;
  return { truncated: true, sha256: sha256(text), bytes: Buffer.byteLength(text, 'utf8') };
}

function shortText(v, max) {
  if (v === null || v === undefined) return null;
  var s = String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ');
  return s.length > max ? s.slice(0, max) : s;
}

function actorOf(actor) {
  var a = actor || {};
  var sess = typeof a.sessionId === 'string' && /^[0-9a-f]{64}$/.test(a.sessionId) ? a.sessionId.slice(0, 8) : null;
  return {
    id: shortText(a.id, 64) || 'unauthenticated',
    role: shortText(a.role, 16) || 'NONE',
    session: sess,
    client: shortText(a.client, 64)
  };
}

/**
 * @param {object} spec
 * @param {object} spec.state state directory handle
 * @param {function} [spec.now]
 * @param {function} [spec.sink] (line) => void — defaults to stdout, so the
 *        journal carries the chain as well as the file
 */
function create(spec) {
  var state = spec.state;
  var now = typeof spec.now === 'function' ? spec.now : function () { return Date.now(); };
  var sink = spec.sink === undefined ? defaultSink : spec.sink;

  var entries = state.readLines(FILE);
  var total = entries.length;
  var lastHash = total ? entries[total - 1].hash : GENESIS;
  var loadedIntegrity = verifyList(entries);
  if (entries.length > MAX_MEMORY) entries = entries.slice(entries.length - MAX_MEMORY);

  function defaultSink(line) {
    try { process.stdout.write(line + '\n'); } catch (e) { /* the journal must never break a request */ }
  }

  /**
   * Appends one entry and returns it.
   *
   * @param {object} e
   * @param {object} e.actor { id, role, sessionId, client }
   * @param {string} e.action dotted verb, e.g. 'config.update'
   * @param {string} [e.target] what it acted on
   * @param {string} e.outcome ACCEPTED | REFUSED | FAILED
   * @param {string} [e.reason] operator-supplied reason
   * @param {string} [e.code] machine code for a refusal/failure
   * @param {*} [e.oldValue]
   * @param {*} [e.newValue]
   * @param {object} [e.detail]
   * @param {string} [e.fingerprintBefore]
   * @param {string} [e.fingerprintAfter]
   * @param {string} [e.commit]
   */
  function record(e) {
    var body = {
      seq: total + 1,
      ts: new Date(now()).toISOString(),
      actor: actorOf(e.actor),
      action: shortText(e.action, 64) || 'unknown',
      target: shortText(e.target, 128),
      outcome: shortText(e.outcome, 16) || 'UNKNOWN',
      code: shortText(e.code, 64),
      reason: shortText(e.reason, 500),
      oldValue: bounded(e.oldValue),
      newValue: bounded(e.newValue),
      detail: bounded(e.detail),
      fingerprintBefore: shortText(e.fingerprintBefore, 64),
      fingerprintAfter: shortText(e.fingerprintAfter, 64),
      commit: shortText(e.commit, 64),
      prevHash: lastHash
    };
    body.hash = sha256(canonical(body));
    state.appendLine(FILE, body);
    total = body.seq;
    lastHash = body.hash;
    entries.push(body);
    if (entries.length > MAX_MEMORY) entries.shift();
    if (sink) {
      sink(JSON.stringify({
        log: 'tcc.audit', seq: body.seq, ts: body.ts, actor: body.actor.id, role: body.actor.role,
        action: body.action, target: body.target, outcome: body.outcome, code: body.code, hash: body.hash
      }));
    }
    return body;
  }

  function verifyList(list) {
    var prev = GENESIS;
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      var copy = {};
      Object.keys(row).forEach(function (k) { if (k !== 'hash') copy[k] = row[k]; });
      if (row.prevHash !== prev) {
        return { ok: false, entries: list.length, brokenAtSeq: row.seq, problem: 'prevHash does not match the previous entry' };
      }
      if (sha256(canonical(copy)) !== row.hash) {
        return { ok: false, entries: list.length, brokenAtSeq: row.seq, problem: 'entry hash does not match its content' };
      }
      if (row.seq !== i + 1) {
        return { ok: false, entries: list.length, brokenAtSeq: row.seq, problem: 'sequence gap: expected ' + (i + 1) };
      }
      prev = row.hash;
    }
    return { ok: true, entries: list.length, brokenAtSeq: null, problem: null, head: prev };
  }

  /** Re-reads the file and checks the whole chain. */
  function verify() {
    return verifyList(state.readLines(FILE));
  }

  /**
   * @param {object} [q] { action, actor, outcome, fromTs, toTs, limit, offset }
   * @returns {{total, items}} newest first
   */
  function list(q) {
    var f = q || {};
    var rows = entries.filter(function (r) {
      if (f.action && r.action.indexOf(f.action) !== 0) return false;
      if (f.actor && r.actor.id !== f.actor) return false;
      if (f.outcome && r.outcome !== f.outcome) return false;
      var t = Date.parse(r.ts);
      if (f.fromTs !== undefined && t < f.fromTs) return false;
      if (f.toTs !== undefined && t > f.toTs) return false;
      return true;
    });
    rows = rows.slice().reverse();
    var offset = f.offset || 0;
    var limit = f.limit || 100;
    return { total: rows.length, items: rows.slice(offset, offset + limit) };
  }

  return {
    record: record,
    list: list,
    verify: verify,
    head: function () { return { seq: total, hash: lastHash }; },
    count: function () { return total; },
    loadedIntegrity: function () { return loadedIntegrity; }
  };
}

module.exports = {
  create: create,
  redact: redact,
  canonical: canonical,
  SECRET_KEY_RE: SECRET_KEY_RE,
  GENESIS: GENESIS,
  FILE: FILE
};
