'use strict';
// =====================================================
// OTHMODE — the OTHMODE-owned runtime store
// projects/command-center/reference/othmode/store.js
//
// The ONLY data OTHMODE owns outside the mcc database: Evolution Memory,
// health recovery records, and the OthMode switch. Append-only JSONL plus
// content-addressed evidence objects — deliberately the same engineering
// pattern as the oth-knowledge store, and deliberately OUTSIDE Git:
// Git stores code and validated artifacts (genes, capsules); this store
// records history (events, signals, outcomes, evidence).
//
// FAIL-CLOSED: if the store root does not exist, every read reports
// { provisioned: false, reason } and every write throws OTHMODE_STORE_ABSENT.
// A disabled layer is a normal, reportable state — never an invented one.
// The store is never auto-created: provisioning it (0700, deploy-owned)
// is an explicit operator step, exactly like /home/deploy/othk-store.
//
// APPEND-ONLY: there is no update or delete anywhere in this module.
// A correction is a new record referencing the old one. Failed evolutions
// stay visible forever — that is the point of them.
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var resolve = require('./resolve.js');

var LINE_CAP_DEFAULT = 500;

function storeError(msg) {
  var e = new Error('OTHMODE_STORE_ABSENT: ' + msg);
  e.code = 'OTHMODE_STORE_ABSENT';
  return e;
}

function root() { return resolve.storeRoot(); }

function provisioned() {
  try { return fs.statSync(root()).isDirectory(); } catch (e) { return false; }
}

function filePath(name) { return path.join(root(), name); }

// ---------------------------------------------------------------------------
// Append-only JSONL streams
// ---------------------------------------------------------------------------

var STREAMS = {
  evolution: 'evolution/events.jsonl',
  recovery: 'recovery/records.jsonl'
};

function appendRecord(stream, record) {
  if (!STREAMS[stream]) throw new Error('unknown stream: ' + stream);
  if (!provisioned()) throw storeError('store root ' + root() + ' does not exist — provision it first (0700, deploy-owned, outside Git)');
  var target = filePath(STREAMS[stream]);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 448 /* 0700 */ });
  var full = Object.assign({
    id: record.id || newId(record.type || stream),
    ts: new Date().toISOString()
  }, record);
  fs.appendFileSync(target, JSON.stringify(full) + '\n', { encoding: 'utf8', mode: 384 /* 0600 */ });
  return full;
}

function readStream(stream, cap) {
  if (!STREAMS[stream]) throw new Error('unknown stream: ' + stream);
  if (!provisioned()) {
    return { provisioned: false, reason: 'store root ' + root() + ' does not exist (fail-closed; provisioning is an operator step)', rows: [] };
  }
  var res = resolve.readJsonlTail(filePath(STREAMS[stream]), cap || LINE_CAP_DEFAULT);
  return { provisioned: true, rows: res.rows, reason: res.ok ? null : res.reason };
}

function newId(prefix) {
  return (prefix || 'rec') + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

// ---------------------------------------------------------------------------
// Content-addressed evidence — write once, address by sha256, never mutate.
// ---------------------------------------------------------------------------

function putEvidence(text) {
  if (!provisioned()) throw storeError('cannot store evidence without a provisioned store');
  var body = String(text);
  var hash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  var dir = filePath('evolution/evidence');
  fs.mkdirSync(dir, { recursive: true, mode: 448 });
  var target = path.join(dir, hash);
  if (!resolve.exists(target)) fs.writeFileSync(target, body, { encoding: 'utf8', mode: 384 });
  return hash;
}

function getEvidence(hash) {
  if (!/^[0-9a-f]{64}$/.test(String(hash))) return null;
  if (!provisioned()) return null;
  var res = resolve.readText(filePath(path.join('evolution/evidence', hash)));
  return res.ok ? res.data : null;
}

// ---------------------------------------------------------------------------
// The OthMode switch. ON means Claude entry points are instructed to
// operate through OTHMODE conventions; OFF means Claude operates normally.
// This is an instruction/configuration contract, NOT an interceptor: the
// value is a flag that prompts and tooling read. It can therefore never be
// a single point of failure — an absent store simply reads as OFF.
// ---------------------------------------------------------------------------

var CONFIG_FILE = 'config/othmode.json';

function getMode() {
  if (!provisioned()) {
    return { mode: 'OFF', provisioned: false, reason: 'store not provisioned — OthMode reads as OFF (fail-closed)', changed_at: null, changed_by: null };
  }
  var res = resolve.readJson(filePath(CONFIG_FILE));
  if (!res.ok) return { mode: 'OFF', provisioned: true, reason: 'no switch record yet — defaults to OFF', changed_at: null, changed_by: null };
  var mode = res.data.mode === 'ON' ? 'ON' : 'OFF';
  return { mode: mode, provisioned: true, reason: null, changed_at: res.data.changed_at || null, changed_by: res.data.changed_by || null };
}

function setMode(mode, actor) {
  if (mode !== 'ON' && mode !== 'OFF') throw new Error('mode must be ON or OFF');
  if (!provisioned()) throw storeError('cannot switch OthMode without a provisioned store');
  var target = filePath(CONFIG_FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 448 });
  var payload = { mode: mode, changed_at: new Date().toISOString(), changed_by: String(actor || 'unknown') };
  // Atomic replace — the switch is the one mutable file in the store, and
  // its full change history is recorded as evolution events by the caller.
  var tmp = target + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 384 });
  fs.renameSync(tmp, target);
  return payload;
}

module.exports = {
  provisioned: provisioned,
  root: root,
  appendRecord: appendRecord,
  readStream: readStream,
  putEvidence: putEvidence,
  getEvidence: getEvidence,
  getMode: getMode,
  setMode: setMode,
  newId: newId,
  LINE_CAP_DEFAULT: LINE_CAP_DEFAULT
};
