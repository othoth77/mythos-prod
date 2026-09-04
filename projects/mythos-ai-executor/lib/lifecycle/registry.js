'use strict';
// =====================================================
// MYTHOS Execution Lifecycle — durable registry
// projects/mythos-ai-executor/lib/lifecycle/registry.js
//
// One directory, plain JSON, no daemon, no database:
//
//   <root>/executions/<execution_id>.json   one record per execution attempt
//   <root>/sessions/<session_id>.json       one record per agent session (linked or not)
//   <root>/inbox/*.json                     spooled events (hooks, PC relay, CLI) — consumed
//   <root>/outbox/<location>/*.json         requests for a remote runtime (PC agent) — consumed there
//   <root>/quarantine/                      unreadable inputs, kept for a human
//   <root>/ledger.jsonl                     append-only: every accepted event + every transition
//   <root>/seen.json                        bounded ring of accepted event ids (replay protection)
//
// Writes are tmp+rename so a crash mid-write leaves the previous complete
// file, never a torn one; a leftover `.tmp-*` is ignored and swept. A record
// that fails to parse is moved to quarantine and treated as absent — the
// registry recovers to a consistent (if smaller) state rather than throwing
// forever. Nothing here signals a process or talks to the network.
//
// Correlation. An event names its execution directly (execution_id), or
// indirectly (task_id → latest execution for that task; session_id →
// the session's linked execution). When nothing resolves, the event still
// updates the SESSION record (a session we cannot link is UNKNOWN, not
// ACTIVE), and is ledgered as unlinked.
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var model = require('./model');

var DEFAULTS = {
  seen_limit: 2000,               // event ids remembered for replay protection
  ledger_max_bytes: 8 * 1024 * 1024,
  finished_retention_ms: 14 * 24 * 3600 * 1000,
  closed_session_retention_ms: 7 * 24 * 3600 * 1000,
  tmp_sweep_ms: 10 * 60 * 1000,
  inbox_batch: 200,
  max_field: 300
};

function config(opts) {
  var cfg = {};
  Object.keys(DEFAULTS).forEach(function (k) { cfg[k] = DEFAULTS[k]; });
  Object.keys(opts || {}).forEach(function (k) { cfg[k] = opts[k]; });
  if (!cfg.root) throw new Error('LIFECYCLE_ROOT_REQUIRED');
  return cfg;
}

function dirs(cfg) {
  return {
    root: cfg.root,
    executions: path.join(cfg.root, 'executions'),
    sessions: path.join(cfg.root, 'sessions'),
    inbox: path.join(cfg.root, 'inbox'),
    outbox: path.join(cfg.root, 'outbox'),
    quarantine: path.join(cfg.root, 'quarantine'),
    ledger: path.join(cfg.root, 'ledger.jsonl'),
    seen: path.join(cfg.root, 'seen.json')
  };
}

function ensure(cfg) {
  var d = dirs(cfg);
  ['root', 'executions', 'sessions', 'inbox', 'outbox', 'quarantine'].forEach(function (k) {
    try { fs.mkdirSync(d[k], { recursive: true, mode: 0o700 }); } catch (e) { /* exists */ }
  });
  return d;
}

function nowIso(cfg) { return new Date((cfg && cfg.now) || Date.now()).toISOString(); }

// --- Atomic JSON ---------------------------------------------------------------

function writeAtomic(file, value) {
  var tmp = file + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(file, cfg) {
  var raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  try { return JSON.parse(raw); }
  catch (e) {
    // Partial/corrupt write: quarantine, do not throw, do not trust.
    try {
      var d = ensure(cfg);
      fs.renameSync(file, path.join(d.quarantine, path.basename(file) + '.' + Date.now() + '.corrupt'));
    } catch (e2) { /* best effort */ }
    return null;
  }
}

function safeName(id) {
  if (!model.validId(id)) throw new Error('LIFECYCLE_INVALID_ID: ' + JSON.stringify(String(id)).slice(0, 80));
  return id;
}

function executionFile(cfg, id) { return path.join(dirs(cfg).executions, safeName(id) + '.json'); }
function taskLinkFile(cfg, id) { return path.join(dirs(cfg).root, 'tasks', safeName(id) + '.json'); }

// GitHub linkage is a property of the TASK (issue, control task id, PR);
// every execution attempt of that task inherits it at creation. Written by
// the bridge at claim time, read by ingest().
function putTaskLink(cfg0, taskId, link) {
  var cfg = config(cfg0);
  ensure(cfg);
  var file = taskLinkFile(cfg, taskId);
  try { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); } catch (e) { /* exists */ }
  var cur = readJson(file, cfg) || { task_id: taskId };
  ['github_issue', 'github_pr', 'correlation_id', 'issue_url', 'control_task_id', 'othmode_task_id'].forEach(function (k) { if (link && link[k] != null) cur[k] = link[k]; });
  cur.updated_at = nowIso(cfg);
  writeAtomic(file, cur);
  return cur;
}
function getTaskLink(cfg0, taskId) {
  var cfg = config(cfg0);
  if (!model.validId(taskId)) return null;
  return readJson(taskLinkFile(cfg, taskId), cfg);
}
function sessionFile(cfg, id) { return path.join(dirs(cfg).sessions, safeName(id) + '.json'); }

function appendLedger(cfg, lines) {
  if (!lines || !lines.length) return;
  var d = ensure(cfg);
  try {
    var st = null;
    try { st = fs.statSync(d.ledger); } catch (e) { /* new */ }
    if (st && st.size > cfg.ledger_max_bytes) {
      // Rotate once; the previous generation is kept for audit.
      try { fs.renameSync(d.ledger, d.ledger + '.1'); } catch (e) { /* ignore */ }
    }
    fs.appendFileSync(d.ledger, lines.map(function (l) { return JSON.stringify(l); }).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch (e) { /* the ledger must never take the registry down */ }
}

// --- Event normalisation ----------------------------------------------------------

var STRING_FIELDS = ['execution_id', 'task_id', 'correlation_id', 'session_id', 'agent', 'provider', 'location', 'host', 'cwd',
  'entrypoint', 'reason', 'stop_reason', 'end_reason', 'report_status', 'report_ref', 'source', 'event_id', 'task_state', 'session_state', 'next_check_at'];
var INT_FIELDS = ['pid', 'github_issue', 'github_pr'];
var BOOL_FIELDS = ['process_gone', 'session_open'];

function clip(v, n) { return typeof v === 'string' ? v.slice(0, n) : v; }

function normalise(raw, cfg) {
  if (!raw || typeof raw !== 'object') return { error: 'not_an_object' };
  var ev = {};
  var type = String(raw.type || raw.event || '');
  if (model.EVENTS.indexOf(type) < 0) return { error: 'unknown_event_type:' + clip(type, 40) };
  ev.type = type;
  STRING_FIELDS.forEach(function (k) { if (raw[k] != null) ev[k] = clip(String(raw[k]), cfg.max_field); });
  INT_FIELDS.forEach(function (k) {
    if (raw[k] != null) { var n = parseInt(raw[k], 10); if (!isNaN(n) && n > 0) ev[k] = n; }
  });
  BOOL_FIELDS.forEach(function (k) { if (raw[k] === true || raw[k] === false) ev[k] = raw[k]; });
  if (raw.proc_start != null) ev.proc_start = clip(String(raw.proc_start), 32);
  if (raw.evidence && typeof raw.evidence === 'object') {
    // Bounded, flat, string-only evidence — no nested secrets can ride along.
    ev.evidence = {};
    Object.keys(raw.evidence).slice(0, 12).forEach(function (k) {
      var v = raw.evidence[k];
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') ev.evidence[clip(k, 40)] = clip(String(v), 200);
    });
  }
  var at = raw.at ? Date.parse(raw.at) : NaN;
  ev.at = isNaN(at) ? nowIso(cfg) : new Date(at).toISOString();
  ev.received_at = nowIso(cfg);
  if (ev.execution_id && !model.validId(ev.execution_id)) return { error: 'invalid_execution_id' };
  if (ev.task_id && !model.validId(ev.task_id)) return { error: 'invalid_task_id' };
  if (ev.session_id && !model.validSessionId(ev.session_id)) return { error: 'invalid_session_id' };
  if (ev.location && model.LOCATIONS.indexOf(ev.location) < 0) return { error: 'invalid_location' };
  if (!ev.execution_id && !ev.task_id && !ev.session_id) return { error: 'no_correlation_key' };
  if (!ev.event_id) {
    ev.event_id = crypto.createHash('sha256').update([ev.type, ev.execution_id || '', ev.task_id || '', ev.session_id || '', ev.at, raw.seq == null ? '' : String(raw.seq), ev.source || ''].join('|')).digest('hex').slice(0, 32);
  } else {
    ev.event_id = clip(ev.event_id, 96);
  }
  return { event: ev };
}

// --- Replay protection --------------------------------------------------------------

function readSeen(cfg) {
  var v = readJson(dirs(cfg).seen, cfg);
  return v && Array.isArray(v.ids) ? v : { ids: [] };
}
function markSeen(cfg, seen, id) {
  seen.ids.push(id);
  if (seen.ids.length > cfg.seen_limit) seen.ids = seen.ids.slice(-cfg.seen_limit);
  writeAtomic(dirs(cfg).seen, seen);
}

// --- Records -----------------------------------------------------------------------

function getExecution(cfg, id) {
  if (!model.validId(id)) return null;
  return readJson(executionFile(cfg, id), cfg);
}
function getSession(cfg, id) {
  if (!model.validSessionId(id)) return null;
  return readJson(sessionFile(cfg, id), cfg);
}
function putExecution(cfg, rec) { ensure(cfg); writeAtomic(executionFile(cfg, rec.execution_id), rec); }
function putSession(cfg, rec) { ensure(cfg); writeAtomic(sessionFile(cfg, rec.session_id), rec); }

function listDir(dir, cfg) {
  var out = [];
  var names;
  try { names = fs.readdirSync(dir); } catch (e) { return out; }
  names.forEach(function (n) {
    if (!/\.json$/.test(n)) return;
    var rec = readJson(path.join(dir, n), cfg);
    if (rec) out.push(rec);
  });
  return out;
}

function listExecutions(cfg, filter) {
  var all = listDir(dirs(cfg).executions, cfg);
  if (!filter) return all;
  return all.filter(function (r) {
    return Object.keys(filter).every(function (k) { return filter[k] === undefined || r[k] === filter[k]; });
  });
}
function listSessions(cfg, filter) {
  var all = listDir(dirs(cfg).sessions, cfg);
  if (!filter) return all;
  return all.filter(function (r) {
    return Object.keys(filter).every(function (k) { return filter[k] === undefined || r[k] === filter[k]; });
  });
}

// Latest execution for a task id (executions rotate on resume/recreate).
function findByTask(cfg, taskId) {
  var list = listExecutions(cfg).filter(function (r) { return r.task_id === taskId; });
  if (!list.length) return null;
  list.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  return list[0];
}
function findBySession(cfg, sessionId) {
  var direct = listExecutions(cfg).filter(function (r) { return r.session_id === sessionId; });
  if (direct.length) {
    direct.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    return direct[0];
  }
  var s = getSession(cfg, sessionId);
  return s && s.execution_id ? getExecution(cfg, s.execution_id) : null;
}
// Every execution that references this session, any state — the "is it
// working on ANOTHER task" question needs all of them, not the latest.
function executionsForSession(cfg, sessionId) {
  return listExecutions(cfg).filter(function (r) { return r.session_id === sessionId; });
}
function findByPid(cfg, pid, host) {
  return listSessions(cfg).filter(function (s) { return s.pid === pid && (!host || !s.host || s.host === host) && s.state !== 'CLOSED'; });
}

// --- Ingest ----------------------------------------------------------------------------

function inheritLink(cfg, ev) {
  if (!ev.task_id) return ev;
  var link = getTaskLink(cfg, ev.task_id);
  if (!link) return ev;
  var out = Object.assign({}, ev);
  ['github_issue', 'github_pr', 'correlation_id'].forEach(function (k) { if (out[k] == null && link[k] != null) out[k] = link[k]; });
  return out;
}

// The single write path. Returns a structured result, never throws for a
// bad event (the caller — a hook, a relay, a daemon — must not die on it).
function ingest(cfg0, raw) {
  var cfg = config(cfg0);
  ensure(cfg);
  var norm = normalise(raw, cfg);
  if (norm.error) {
    appendLedger(cfg, [{ at: nowIso(cfg), kind: 'rejected', error: norm.error, type: raw && (raw.type || raw.event) || null, source: raw && raw.source || null }]);
    return { ok: false, error: norm.error, duplicate: false, transitions: [] };
  }
  var ev = norm.event;
  var seen = readSeen(cfg);
  if (seen.ids.indexOf(ev.event_id) >= 0) {
    appendLedger(cfg, [{ at: ev.received_at, kind: 'duplicate', event_id: ev.event_id, type: ev.type, execution_id: ev.execution_id || null, session_id: ev.session_id || null }]);
    return { ok: true, duplicate: true, event: ev, transitions: [] };
  }

  // Resolve the execution.
  var exec = null;
  var resolvedBy = null;
  if (ev.execution_id) { exec = getExecution(cfg, ev.execution_id); resolvedBy = exec ? 'execution_id' : null; }
  if (!exec && !ev.execution_id && ev.task_id) { exec = findByTask(cfg, ev.task_id); if (exec) resolvedBy = 'task_id'; }
  if (!exec && !ev.execution_id && ev.session_id) { exec = findBySession(cfg, ev.session_id); if (exec) resolvedBy = 'session_id'; }
  if (!exec && ev.type === 'EXECUTION_CREATED' && ev.execution_id) { exec = model.newExecution(inheritLink(cfg, ev)); resolvedBy = 'created'; }
  if (!exec && ev.execution_id && ev.type !== 'EXECUTION_CREATED') {
    // An event for an execution we never saw created (crash before the
    // create was persisted, or a relay ahead of us): create it UNKNOWN so
    // nothing is lost, and let the reducer take it from there.
    exec = model.newExecution(inheritLink(cfg, ev));
    exec.execution_state = 'UNKNOWN';
    exec.task_state = 'RUNNING';
    resolvedBy = 'implicit';
  }

  var transitions = [];
  var linked = !!exec;
  if (exec) {
    if (!ev.execution_id) ev.execution_id = exec.execution_id;
    if (!ev.task_id && exec.task_id) ev.task_id = exec.task_id;
    var r = model.applyToExecution(exec, ev);
    transitions = transitions.concat(r.transitions);
    putExecution(cfg, exec);
  }

  var sess = null;
  if (ev.session_id) {
    sess = getSession(cfg, ev.session_id) || model.newSession(ev);
    if (exec && !sess.execution_id) sess.execution_id = exec.execution_id;
    if (exec && !sess.task_id && exec.task_id) sess.task_id = exec.task_id;
    var rs = model.applyToSession(sess, ev);
    transitions = transitions.concat(rs.transitions);
    putSession(cfg, sess);
  }

  markSeen(cfg, seen, ev.event_id);
  var lines = [{ at: ev.received_at, kind: 'event', event_id: ev.event_id, type: ev.type, at_event: ev.at, execution_id: ev.execution_id || null,
    task_id: ev.task_id || null, session_id: ev.session_id || null, pid: ev.pid || null, location: ev.location || null, source: ev.source || null,
    linked: linked, resolved_by: resolvedBy, reason: ev.reason || null, evidence: ev.evidence || null }];
  transitions.forEach(function (t) { lines.push(Object.assign({ kind: 'transition' }, t)); });
  appendLedger(cfg, lines);
  return { ok: true, duplicate: false, event: ev, execution: exec, session: sess, transitions: transitions, linked: linked, resolved_by: resolvedBy };
}

// --- Inbox / outbox -------------------------------------------------------------------------

// A spooled event file: one event object, or { events: [...] }. Consumed on
// success; quarantined when unreadable. Files are processed in name order,
// so a producer that names them <epoch>-<seq>.json gets ordering for free.
function drainInbox(cfg0) {
  var cfg = config(cfg0);
  var d = ensure(cfg);
  var names;
  try { names = fs.readdirSync(d.inbox).filter(function (n) { return /\.json$/.test(n); }).sort(); } catch (e) { return { processed: 0, results: [] }; }
  var results = [];
  names.slice(0, cfg.inbox_batch).forEach(function (n) {
    var file = path.join(d.inbox, n);
    var raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) {
      try { fs.renameSync(file, path.join(d.quarantine, n + '.' + Date.now() + '.unreadable')); } catch (e2) { /* ignore */ }
      results.push({ file: n, ok: false, error: 'unreadable' });
      return;
    }
    var events = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.events) ? raw.events : [raw]);
    var outs = events.map(function (e) { return ingest(cfg, e); });
    try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
    results.push({ file: n, ok: true, events: outs.length, accepted: outs.filter(function (o) { return o.ok && !o.duplicate; }).length });
  });
  sweepTmp(cfg);
  return { processed: results.length, results: results };
}

// A request for a remote runtime. The remote agent polls its outbox through
// an authenticated channel; nothing here reaches the network.
function writeOutbox(cfg0, location, message) {
  var cfg = config(cfg0);
  var d = ensure(cfg);
  if (model.LOCATIONS.indexOf(location) < 0) throw new Error('LIFECYCLE_INVALID_LOCATION');
  var dir = path.join(d.outbox, location);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  var name = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.json';
  var msg = Object.assign({ created_at: nowIso(cfg), request_id: crypto.randomBytes(8).toString('hex') }, message);
  writeAtomic(path.join(dir, name), msg);
  return msg;
}
function listOutbox(cfg0, location) {
  var cfg = config(cfg0);
  var dir = path.join(dirs(cfg).outbox, location);
  return listDir(dir, cfg);
}
function ackOutbox(cfg0, location, requestId) {
  var cfg = config(cfg0);
  var dir = path.join(dirs(cfg).outbox, location);
  var names;
  try { names = fs.readdirSync(dir); } catch (e) { return false; }
  var done = false;
  names.forEach(function (n) {
    var rec = readJson(path.join(dir, n), cfg);
    if (rec && rec.request_id === requestId) { try { fs.unlinkSync(path.join(dir, n)); done = true; } catch (e) { /* ignore */ } }
  });
  return done;
}

function sweepTmp(cfg) {
  var d = dirs(cfg);
  var cutoff = Date.now() - cfg.tmp_sweep_ms;
  [d.executions, d.sessions, d.root].forEach(function (dir) {
    var names;
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    names.forEach(function (n) {
      if (n.indexOf('.tmp-') < 0) return;
      var f = path.join(dir, n);
      try { if (fs.statSync(f).mtimeMs < cutoff) fs.unlinkSync(f); } catch (e) { /* ignore */ }
    });
  });
}

// Retention: finished executions and closed sessions age out; anything
// open, unknown or under review is kept indefinitely (it is a question
// waiting for an answer, not garbage).
function prune(cfg0) {
  var cfg = config(cfg0);
  var now = (cfg.now || Date.now());
  var removed = { executions: 0, sessions: 0 };
  listExecutions(cfg).forEach(function (r) {
    if (!model.isExecutionTerminalState(r.execution_state)) return;
    var t = Date.parse(r.finished_at || r.updated_at);
    if (!isNaN(t) && now - t > cfg.finished_retention_ms) { try { fs.unlinkSync(executionFile(cfg, r.execution_id)); removed.executions++; } catch (e) { /* ignore */ } }
  });
  listSessions(cfg).forEach(function (s) {
    if (s.state !== 'CLOSED') return;
    var t = Date.parse(s.closed_at || s.updated_at);
    if (!isNaN(t) && now - t > cfg.closed_session_retention_ms) { try { fs.unlinkSync(sessionFile(cfg, s.session_id)); removed.sessions++; } catch (e) { /* ignore */ } }
  });
  return removed;
}

function ledgerTail(cfg0, n) {
  var cfg = config(cfg0);
  var text;
  try { text = fs.readFileSync(dirs(cfg).ledger, 'utf8'); } catch (e) { return []; }
  var lines = text.trim().split('\n').filter(Boolean);
  return lines.slice(-(n || 50)).map(function (l) { try { return JSON.parse(l); } catch (e) { return { corrupt: true }; } });
}

// Every ledger line about one id — the "explain" primitive.
function ledgerFor(cfg0, id, n) {
  var cfg = config(cfg0);
  var text;
  try { text = fs.readFileSync(dirs(cfg).ledger, 'utf8'); } catch (e) { return []; }
  var out = [];
  text.trim().split('\n').forEach(function (l) {
    if (!l || l.indexOf(id) < 0) return;
    try { var o = JSON.parse(l); if (o.execution_id === id || o.session_id === id || o.task_id === id) out.push(o); } catch (e) { /* skip */ }
  });
  return out.slice(-(n || 200));
}

module.exports = {
  DEFAULTS: DEFAULTS,
  config: config,
  dirs: dirs,
  ensure: ensure,
  normalise: normalise,
  ingest: ingest,
  drainInbox: drainInbox,
  writeOutbox: writeOutbox,
  listOutbox: listOutbox,
  ackOutbox: ackOutbox,
  getExecution: getExecution,
  getSession: getSession,
  putExecution: putExecution,
  putTaskLink: putTaskLink,
  getTaskLink: getTaskLink,
  putSession: putSession,
  listExecutions: listExecutions,
  listSessions: listSessions,
  findByTask: findByTask,
  findBySession: findBySession,
  executionsForSession: executionsForSession,
  findByPid: findByPid,
  prune: prune,
  sweepTmp: sweepTmp,
  appendLedger: appendLedger,
  ledgerTail: ledgerTail,
  ledgerFor: ledgerFor,
  writeAtomic: writeAtomic,
  readJson: readJson
};
