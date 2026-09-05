'use strict';
// =====================================================
// MYTHOS WP — audit log (database-backed)
// projects/mythos-wp/reference/audit.js
//
// Every important mutation the panel performs is recorded in
// wp_audit_events: who (username + role), what (action, resource, record),
// when, in which project, which fields changed, previous and new values.
// The console's audit.js (MOS-v2 M-07) writes journal lines; a data panel
// needs a queryable history per record, hence a table — same refusals:
//
//   · never a secret: values pass through the orchestrator's redact.js and
//     any key that LOOKS like a credential is dropped outright;
//   · never a session id: the actor is the username;
//   · bounded: strings are cut at 2,000 characters, JSON documents at
//     16 KiB, so a pathological record cannot bloat the log.
//
// A failed audit write never undoes the business mutation (they live in
// different databases); it is reported on stderr and in the response as
// `audited: false` so the operator sees it.
// =====================================================

var redact = require('../../mythos-orchestrator/lib/redact');

var ACTIONS = ['create', 'update', 'delete', 'login', 'login_failed', 'logout', 'status', 'setting', 'upsert', 'simulate'];
var SECRET_KEY_RE = /(password|passwd|secret|token|api_?key|credential|scrypt|dsn|connection)/i;
var MAX_STRING = 2000;
var MAX_JSON = 16 * 1024;

function clean(v, depth) {
  depth = depth || 0;
  if (v === null || v === undefined) return null;
  if (depth > 6) return '[depth]';
  if (typeof v === 'string') return redact.redact(v.length > MAX_STRING ? v.slice(0, MAX_STRING) + '…' : v);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.slice(0, 200).map(function (x) { return clean(x, depth + 1); });
  if (typeof v === 'object') {
    var out = {};
    Object.keys(v).forEach(function (k) {
      if (SECRET_KEY_RE.test(k)) return;
      out[k] = clean(v[k], depth + 1);
    });
    return out;
  }
  return String(v).slice(0, MAX_STRING);
}

function bounded(obj) {
  if (obj === null || obj === undefined) return null;
  var s = JSON.stringify(obj);
  if (s.length <= MAX_JSON) return obj;
  return { _truncated: true, _bytes: s.length };
}

function changedFields(prev, next) {
  if (!prev || !next) return next ? Object.keys(next) : [];
  var out = [];
  Object.keys(next).forEach(function (k) {
    var a = prev[k], b = next[k];
    var sa = a instanceof Date ? a.toISOString() : JSON.stringify(a);
    var sb = b instanceof Date ? b.toISOString() : JSON.stringify(b);
    if (sa !== sb) out.push(k);
  });
  return out;
}

// Only the changed fields' previous/new values are stored on update, so the
// log answers "what changed" without duplicating the whole record.
function diff(prev, next) {
  var fields = changedFields(prev, next);
  var p = {}, n = {};
  fields.forEach(function (k) { p[k] = prev ? prev[k] : undefined; n[k] = next ? next[k] : undefined; });
  return { fields: fields, previous: prev ? p : null, next: next ? n : null };
}

// record(pool, entry) → Promise<boolean>
//   entry = { actor, role, action, resource, record_id, project_id, previous, next, changed_fields, request_id, client }
function record(pool, e) {
  e = e || {};
  if (ACTIONS.indexOf(e.action) === -1) return Promise.resolve(false);
  var prev = e.previous === undefined ? null : bounded(clean(e.previous));
  var next = e.next === undefined ? null : bounded(clean(e.next));
  var fields = Array.isArray(e.changed_fields) ? e.changed_fields.slice(0, 100).map(String) : null;
  return pool.query(
    'INSERT INTO wp_audit_events (actor, actor_role, action, resource, record_id, project_id, changed_fields, previous, next, request_id, client) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [String(e.actor || 'unknown').slice(0, 64), e.role ? String(e.role).slice(0, 16) : null, e.action, String(e.resource || '').slice(0, 64),
      e.record_id === undefined || e.record_id === null ? null : String(e.record_id).slice(0, 128), e.project_id || null, fields,
      prev === null ? null : JSON.stringify(prev), next === null ? null : JSON.stringify(next),
      e.request_id ? String(e.request_id).slice(0, 32) : null, e.client ? String(e.client).slice(0, 64) : null]
  ).then(function () { return true; }, function (err) {
    process.stderr.write(JSON.stringify({ at: new Date().toISOString(), component: 'audit', error: 'AUDIT_WRITE_FAILED', code: err && err.code ? err.code : null }) + '\n');
    return false;
  });
}

// History of one record, newest first.
function history(pool, resource, recordId, limit) {
  return pool.query(
    'SELECT id, at, actor, actor_role, action, changed_fields, previous, next FROM wp_audit_events WHERE resource = $1 AND record_id = $2 ORDER BY at DESC, id DESC LIMIT $3',
    [resource, String(recordId), Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)]
  ).then(function (r) { return r.rows; });
}

module.exports = { ACTIONS: ACTIONS, clean: clean, changedFields: changedFields, diff: diff, record: record, history: history };
