'use strict';
// =====================================================
// MYTHOS Guardian — incidents, state and public status
// ops/guardian/lib/report.js
//
// Local-first reporting. The Status Center PULLS the public status file
// (projects/status-center/monitor, probe type `guardian-health`), so an
// unavailable Status Center can never block or fail local protection.
//
// Bounded by construction: incidents.jsonl rotates at `max_bytes` keeping
// `keep` generations, the public status is one small overwritten file, and
// every write failure (ENOSPC included) is swallowed and reported in the
// tick result instead of thrown.
// =====================================================

var path = require('path');

var SECRET_RE = /((?:password|passwd|secret|token|api[_-]?key|authorization)["'=:\s]+)([^\s"',;]+)/ig;

function redact(value) {
  if (typeof value !== 'string') return value;
  return value.replace(SECRET_RE, '$1[REDACTED]').slice(0, 2000);
}

function redactDeep(obj, depth) {
  if (depth > 6) return '[depth]';
  if (typeof obj === 'string') return redact(obj);
  if (Array.isArray(obj)) return obj.slice(0, 200).map(function (v) { return redactDeep(v, depth + 1); });
  if (obj && typeof obj === 'object') {
    var out = {};
    Object.keys(obj).forEach(function (k) { out[k] = redactDeep(obj[k], depth + 1); });
    return out;
  }
  return obj;
}

var seq = 0;
function incidentId(nowMs) {
  seq = (seq + 1) % 1000;
  return 'GI-' + new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\..*/, '') + '-' + String(seq).padStart(3, '0');
}

// The OTH incident shape. Every field is always present (null when unknown)
// so a reader never has to guess whether a field was omitted or empty.
function createIncident(f, nowMs) {
  var inc = {
    id: incidentId(nowMs),
    time: new Date(nowMs).toISOString(),
    severity: f.severity || 'WARNING',
    domain: f.domain || null,
    trigger: f.trigger || null,
    evidence: f.evidence || null,
    affected: f.affected || null,
    action: f.action || 'none',
    before: f.before || null,
    after: f.after || null,
    result: f.result || null,
    production_impact: f.production_impact || 'none observed',
    remaining_risk: f.remaining_risk || null,
    next_action: f.next_action || null,
    mode: f.mode || null
  };
  inc = redactDeep(inc, 0);
  inc.oth = othText(inc);
  return inc;
}

function othText(inc) {
  function s(v) { return v === null || v === undefined ? '—' : (typeof v === 'string' ? v : JSON.stringify(v)); }
  return [
    '[GUARDIAN INCIDENT]',
    'Time: ' + inc.time,
    'Severity: ' + inc.severity,
    'Trigger: ' + s(inc.trigger),
    'Evidence: ' + s(inc.evidence),
    'Action: ' + s(inc.action),
    'Result: ' + s(inc.result),
    'Production impact: ' + s(inc.production_impact),
    'Remaining risk: ' + s(inc.remaining_risk),
    'Next action: ' + s(inc.next_action)
  ].join('\n');
}

function rotateIfNeeded(io, file, maxBytes, keep) {
  var st = io.lstat(file);
  if (!st || st.size < maxBytes) return false;
  for (var i = keep; i >= 1; i--) {
    var from = i === 1 ? file : file + '.' + (i - 1);
    if (io.exists(from)) io.rename(from, file + '.' + i);
  }
  return true;
}

function appendIncidents(io, stateDir, incidents, opts) {
  if (!incidents || !incidents.length) return { written: 0, ok: true };
  var o = opts || {};
  var file = path.join(stateDir, 'incidents.jsonl');
  rotateIfNeeded(io, file, o.max_bytes || 5 * 1024 * 1024, o.keep || 3);
  var body = incidents.map(function (i) { return JSON.stringify(i); }).join('\n') + '\n';
  var ok = io.appendFile(file, body, 0o600);
  // A tiny fixed-size copy of the newest incident survives even when the
  // ledger append failed (e.g. disk full): overwrite, never grow.
  io.writeFileAtomic(path.join(stateDir, 'last-incident.json'), JSON.stringify(incidents[incidents.length - 1], null, 2) + '\n', 0o600);
  return { written: ok ? incidents.length : 0, ok: ok };
}

function writePublicStatus(io, publicDir, status) {
  io.mkdir(publicDir, 0o755);
  return io.writeFileAtomic(path.join(publicDir, 'status.json'), JSON.stringify(redactDeep(status, 0), null, 2) + '\n', 0o644);
}

// The session guard's pressure input (MYTHOS_SESSION_GUARD_RG_STATE). Same
// two fields its runner reads from the Resource Guard state: level +
// updated_at. Only the three resource-guard levels are ever written.
function writePressureFile(io, publicDir, level, nowMs) {
  var l = (level === 'EMERGENCY' || level === 'CRITICAL') ? 'CRITICAL'
    : ((level === 'WARNING' || level === 'HIGH') ? 'WARNING' : 'NORMAL');
  io.mkdir(publicDir, 0o755);
  return io.writeFileAtomic(path.join(publicDir, 'memory-level.json'), JSON.stringify({
    level: l, updated_at: new Date(nowMs).toISOString(), source: 'mythos-guardian'
  }) + '\n', 0o644);
}

module.exports = {
  redact: redact,
  redactDeep: redactDeep,
  createIncident: createIncident,
  othText: othText,
  appendIncidents: appendIncidents,
  rotateIfNeeded: rotateIfNeeded,
  writePublicStatus: writePublicStatus,
  writePressureFile: writePressureFile
};
