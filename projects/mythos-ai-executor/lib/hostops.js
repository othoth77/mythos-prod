'use strict';
// =====================================================
// Mythos AI Executor — governed host operations (HOSTOPS-1, HOSTOPS-2R)
// projects/mythos-ai-executor/lib/hostops.js
//
// The Executor-side adapter for the installed READ-ONLY boundary
// /usr/local/sbin/mythos-hostops (contract: docs/MYTHOS_HOSTOPS_INTERFACE.md).
// It adds NO authority of its own — the allowlist
// (/etc/mythos/hostops-allowlist.json, source ops/dagu-poc/hostops-allowlist.json)
// remains the single authorization model, and the root-owned helper remains
// the enforcement point. This module decides, in order:
//
//   1. closed request field set              — anything else is refused
//   2. allowlist lookup                      — unknown operation: refused
//   3. governance as declared                — class must be READ; WRITE /
//      RESTART / DEPLOY are refused BY NAME with their class before any
//      process is spawned (approval-carrying classes arrive only in v0.2)
//   4. argument validation                   — anchored allowlist regex plus
//      a metacharacter net, duplicated here as defense in depth
//   5. Resource Guard admission              — a hostops call is an ADMISSION
//      exactly like dispatchTask(): CRITICAL defers it, nothing is spawned,
//      and the reason is recorded. Fail-open on guard errors, like the daemon
//   6. the boundary                          — a Unix domain socket call to
//      the root-owned mythos-hostops-daemon (HOSTOPS-2R). No shell, no sudo,
//      no fallback to docker/systemctl exists anywhere in this path
//   7. verification                          — the helper's stdout must be a
//      single JSON object consistent with its exit code; anything else is
//      HOSTOPS_MALFORMED, never a silent success
//   8. the record                            — every outcome (refusals too)
//      is appended to the task's events.log and to <task>/hostops.json when
//      a task id is given, carrying the helper audit_id so the executor
//      event, the bridge REPORT and the root-owned ledger join on it.
//
// HOSTOPS-2R (GitHub issue #130) replaced the HOSTOPS-1 boundary call. That
// call was `spawnSync('/usr/bin/sudo', ['-n', HELPER, verb, ...])` — but
// mythos-ai-executor.service runs with NoNewPrivileges=true (load-bearing,
// never weakened: docs/MYTHOS_AI_EXECUTOR_ARCHITECTURE.md, mission §23), and under
// that flag the kernel ignores the setuid bit on exec for every child of
// this process, including any `sudo` it spawns. `sudo -n` could therefore
// NEVER actually reach root from inside the executor, no matter what
// sudoers granted — the HOSTOPS-1 boundary was silently non-functional in
// production, always answering HOSTOPS_UNAVAILABLE. The fix is not to relax
// NoNewPrivileges (never an option) but to move the privilege boundary
// out of this process tree entirely: `mythos-hostops.socket` +
// `mythos-hostops.service` (ops/hostops/) run a small root daemon
// (ops/hostops/mythos-hostops-daemon.py) started directly by systemd/PID 1,
// never a child of the hardened executor. Reaching it needs no privilege at
// all — connecting to a local Unix socket is an ordinary syscall — so
// NoNewPrivileges here is unaffected and untouched. The daemon verifies the
// caller with SO_PEERCRED (kernel-reported uid of the actual peer process,
// never a value the client could claim) against the resolved uids of
// `deploy` and `dagu`, then invokes the SAME `/usr/local/sbin/mythos-hostops`
// helper directly, with a fixed argument array and shell=False — the helper
// remains the sole allowlist/class/audit authority, byte-for-byte unchanged.
//
// Dagu is deliberately NOT in this path (mission HOSTOPS-1 §architectural
// question): a single READ verb is one helper call; putting Dagu between the
// Executor and the helper would add a service credential, a run lifecycle
// and a failure mode while enforcing nothing the helper does not already
// enforce. Dagu remains the ORCHESTRATION layer for the future multi-step
// WRITE/DEPLOY workflows (approval gates, retries, rollback handlers), where
// its value is real. `dagu_run_id` is carried as null until then. The socket
// is already sized for Dagu's eventual caller identity (HOSTOPS-2R §1), but
// nothing here calls it.
// =====================================================

var fs = require('fs');
var path = require('path');
var net = require('net');

var state = require('./state');
var resourceGuard = require('./resource-guard');

var VERSION = '1.1.0';
var SOCKET_PATH = process.env.MYTHOS_HOSTOPS_SOCKET || '/run/mythos-hostops/hostops.sock';
var INSTALLED_ALLOWLIST = '/etc/mythos/hostops-allowlist.json';
var REPO_ALLOWLIST = path.join(__dirname, '..', '..', '..', 'ops', 'dagu-poc', 'hostops-allowlist.json');
var TIMEOUT_MS = 20000;
var META_RE = /[;&|`$<>(){}\[\]'"\\\s]/;
var TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
var REQUEST_FIELDS = ['operation', 'arguments', 'task_id', 'othmode_task_id', 'github_task_id', 'requested_by'];
var MAX_TASK_RECORDS = 20;

var HTTP_STATUS = {
  HOSTOPS_INPUT: 400, HOSTOPS_UNKNOWN_OPERATION: 404, HOSTOPS_NOT_READ: 403,
  HOSTOPS_ARG_INVALID: 400, HOSTOPS_ALLOWLIST_UNAVAILABLE: 500,
  RESOURCE_PRESSURE: 503, HOSTOPS_REFUSED: 403, HOSTOPS_CALLER_REFUSED: 403,
  HOSTOPS_EXEC_FAILED: 502, HOSTOPS_AUDIT_UNAVAILABLE: 503,
  HOSTOPS_UNAVAILABLE: 503, HOSTOPS_TIMEOUT: 504, HOSTOPS_MALFORMED: 502
};

function enabled() {
  return String(process.env.MYTHOS_HOSTOPS || 'on').toLowerCase() !== 'off';
}

function loadAllowlist(opts) {
  var candidates = [(opts && opts.allowlist_path) || null, INSTALLED_ALLOWLIST, REPO_ALLOWLIST].filter(Boolean);
  for (var i = 0; i < candidates.length; i++) {
    try { return JSON.parse(fs.readFileSync(candidates[i], 'utf8')); } catch (e) { /* next */ }
  }
  return null;
}

// Resource Guard admission — same options and same fail-open posture as
// executor.js guardGate(); the guard's own hysteresis state is authoritative.
function defaultGuardGate() {
  if (String(process.env.MYTHOS_RESOURCE_GUARD || 'on').toLowerCase() === 'off') {
    return { admit: true, level: 'DISABLED', reason: null };
  }
  try {
    var opts = {
      state_path: path.join(state.root(), 'resource-guard.json'),
      alerts_path: path.join(state.root(), 'resource-guard-alerts.jsonl')
    };
    return resourceGuard.admission(resourceGuard.current(opts));
  } catch (e) { return { admit: true, level: 'UNKNOWN', reason: null }; }
}

function refusal(code, message, extra) {
  var out = { ok: false, version: VERSION, code: code, error: message, http_status: HTTP_STATUS[code] || 500, dagu_run_id: null };
  Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
  return out;
}

// The boundary call (HOSTOPS-2R). Connects to the root daemon's Unix
// socket, sends one newline-terminated JSON request, reads one
// newline-terminated JSON response, and NEVER throws — every failure
// resolves to a value shaped like the old spawnSync() result so the
// outcome-normalization block below stays unchanged:
//   { status, stdout, stderr }        — the helper ran; this is its result
//   { error: { code, message } }      — the boundary itself did not answer
//   { error: { code: 'ETIMEDOUT' }, signal: 'SIGTERM' } — timed out
// No shell, no sudo, no docker, no systemctl — a socket connect() and a
// bounded read, nothing else.
function defaultCallBoundary(verb, args, ids, opts) {
  var socketPath = (opts && opts.socketPath) || SOCKET_PATH;
  return new Promise(function (resolve) {
    var settled = false;
    function done(r) { if (settled) return; settled = true; resolve(r); }

    var conn;
    try {
      conn = net.createConnection({ path: socketPath });
    } catch (e) {
      return done({ error: { code: 'HOSTOPS_SOCKET_ERROR', message: String((e && e.message) || e) } });
    }

    var chunks = [];
    conn.setTimeout(TIMEOUT_MS);
    conn.on('timeout', function () {
      conn.destroy();
      done({ error: { code: 'ETIMEDOUT', message: 'the hostops boundary did not answer within ' + TIMEOUT_MS + 'ms' }, signal: 'SIGTERM' });
    });
    conn.on('error', function (e) {
      done({ error: { code: (e && e.code) || 'HOSTOPS_SOCKET_ERROR', message: String((e && e.message) || e) } });
    });
    conn.on('connect', function () {
      var req = {
        verb: verb, args: args,
        task_id: ids.task_id || null, othmode_task_id: ids.othmode_task_id || null, github_task_id: ids.github_task_id || null
      };
      conn.end(JSON.stringify(req) + '\n');
    });
    conn.on('data', function (d) { chunks.push(d); });
    conn.on('close', function () {
      var raw = Buffer.concat(chunks).toString('utf8').split('\n')[0];
      if (!raw) return done({ error: { code: 'HOSTOPS_EMPTY_RESPONSE', message: 'the boundary closed the connection without a response' } });
      var env;
      try { env = JSON.parse(raw); } catch (e) {
        return done({ error: { code: 'HOSTOPS_PROTOCOL_ERROR', message: 'the boundary response was not parseable JSON' } });
      }
      if (env && env.error) return done({ error: env.error });
      done({ status: env.status, stdout: env.stdout, stderr: env.stderr });
    });
  });
}

// Bounded per-task record: events.log line + hostops.json (last N), joined
// to the root ledger by audit_id. status.json is never touched here —
// transition() stays the single status chokepoint.
// Returns null (no task id), true (recorded) or false (record failed or the
// task is unknown) — the caller attaches this to the outcome as
// `task_recorded`, so a missing executor-side trace is visible, never
// silent; the root-owned ledger still holds the event via audit_id.
function record(taskId, entry) {
  if (!taskId) return null;
  try {
    if (!state.readStatus(taskId)) return false;
    state.appendEvent(taskId, 'hostops_invoked', {
      operation: entry.operation, outcome: entry.outcome, code: entry.code || null,
      audit_id: entry.audit_id || null, hostops_exit: entry.hostops_exit === undefined ? null : entry.hostops_exit
    });
    var list = state.readJSON(taskId, 'hostops.json') || [];
    list.push(entry);
    if (list.length > MAX_TASK_RECORDS) list = list.slice(list.length - MAX_TASK_RECORDS);
    state.writeJSON(taskId, 'hostops.json', list);
    return true;
  } catch (e) { return false; /* the record must never break the call */ }
}

// invoke(payload[, opts]) -> Promise<normalized result object> (never rejects).
// opts (tests only): {callBoundary, guardGate, allowlist_path, socketPath}
function invoke(payload, opts) {
  opts = opts || {};
  var startedAt = Date.now();

  if (!enabled()) return Promise.resolve(refusal('HOSTOPS_INPUT', 'hostops is disabled (MYTHOS_HOSTOPS=off)'));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return Promise.resolve(refusal('HOSTOPS_INPUT', 'request body must be a JSON object'));
  }
  var unexpected = Object.keys(payload).filter(function (k) { return REQUEST_FIELDS.indexOf(k) === -1; });
  if (unexpected.length) return Promise.resolve(refusal('HOSTOPS_INPUT', 'unexpected field: ' + String(unexpected[0]).slice(0, 40)));

  var operation = payload.operation;
  if (typeof operation !== 'string' || !/^[a-z][a-z.\-_]{2,64}$/.test(operation)) {
    return Promise.resolve(refusal('HOSTOPS_INPUT', 'operation must be an allowlist verb or host.* operation name'));
  }
  var ids = {};
  ['task_id', 'othmode_task_id', 'github_task_id', 'requested_by'].forEach(function (f) {
    if (payload[f] === undefined || payload[f] === null) return;
    if (typeof payload[f] !== 'string' || !TASK_ID_RE.test(payload[f])) ids.__bad = f;
    else ids[f] = payload[f];
  });
  if (ids.__bad) return Promise.resolve(refusal('HOSTOPS_INPUT', 'field ' + ids.__bad + ' fails identity validation'));

  // ---- allowlist + governance as declared -----------------------------
  var al = loadAllowlist(opts);
  if (!al || !al.operations) return Promise.resolve(refusal('HOSTOPS_ALLOWLIST_UNAVAILABLE', 'hostops allowlist unavailable; failing closed'));
  var op = null, verb = null;
  Object.keys(al.operations).forEach(function (name) {
    if (name === operation || al.operations[name].helper === operation) { op = al.operations[name]; verb = al.operations[name].helper; op.__name = name; }
  });
  if (!op) return Promise.resolve(refusal('HOSTOPS_UNKNOWN_OPERATION', 'operation "' + operation.slice(0, 64) + '" is not in the hostops allowlist'));
  if (op.class !== 'READ') {
    return Promise.resolve(refusal('HOSTOPS_NOT_READ', 'operation ' + op.__name + ' is class ' + op.class + '; the executor hostops path executes READ operations only (v1)', { operation: op.__name, class: op.class }));
  }

  // ---- argument validation (defense in depth; the helper re-validates) -
  var args = payload.arguments || {};
  if (typeof args !== 'object' || Array.isArray(args)) return Promise.resolve(refusal('HOSTOPS_INPUT', 'arguments must be an object'));
  var declared = op.args || {};
  var bad = null;
  Object.keys(args).forEach(function (k) {
    if (bad) return;
    if (!declared[k]) { bad = 'operation ' + op.__name + ' does not accept argument "' + String(k).slice(0, 32) + '"'; return; }
    var v = args[k];
    if (typeof v !== 'string' || v.length > 256 || !(new RegExp(declared[k])).test(v) || META_RE.test(v)) {
      bad = 'argument "' + k + '" fails validation';
    } else if (k === 'path' && (v.indexOf('..') !== -1 || v !== path.normalize(v))) {
      // the helper refuses traversal too; refusing it here keeps the
      // attempt off the boundary entirely (defense in depth)
      bad = 'argument "path" is not in normal form';
    }
  });
  if (bad) return Promise.resolve(refusal('HOSTOPS_ARG_INVALID', bad, { operation: op.__name }));

  // ---- Resource Guard admission (before any socket connection exists) -
  var gate = (opts.guardGate || defaultGuardGate)();
  if (!gate.admit) {
    var deferred = refusal('RESOURCE_PRESSURE', 'resource guard refuses admission (level ' + gate.level + ')', { operation: op.__name, resource_level: gate.level, deferred: true });
    deferred.task_recorded = record(ids.task_id, { at: new Date().toISOString(), operation: op.__name, outcome: 'deferred', code: 'RESOURCE_PRESSURE', resource_level: gate.level });
    return Promise.resolve(deferred);
  }

  // ---- the boundary (HOSTOPS-2R: Unix socket to the root daemon) ------
  var callBoundary = opts.callBoundary || defaultCallBoundary;
  return callBoundary(verb, args, ids, opts).then(function (r) {
    var outcome;
    if (r.error && (r.error.code === 'ETIMEDOUT' || r.signal === 'SIGTERM')) {
      outcome = refusal('HOSTOPS_TIMEOUT', 'the hostops boundary did not answer within ' + TIMEOUT_MS + 'ms', { operation: op.__name });
    } else if (r.error && r.error.code === 'HOSTOPS_CALLER_REFUSED') {
      // the daemon's own SO_PEERCRED check refused this connection before
      // the helper ever ran — distinct from the helper's own exit-3 refusal
      // below, but the same outcome code: neither is retryable.
      outcome = refusal('HOSTOPS_CALLER_REFUSED', r.error.message || 'the hostops boundary refused this caller', { operation: op.__name });
    } else if (r.error) {
      // socket missing (daemon/unit not installed), connection refused
      // (daemon not running), or a malformed/empty boundary response — all
      // "the boundary could not be reached", never a fallback of any kind.
      outcome = refusal('HOSTOPS_UNAVAILABLE', 'the hostops boundary could not be reached: ' + String(r.error.message || r.error.code || 'unknown').slice(0, 120), { operation: op.__name });
    } else {
      var body = null;
      try { body = JSON.parse(String(r.stdout || '')); } catch (e) { /* malformed */ }
      if (!body || typeof body !== 'object') {
        var tail = String(r.stderr || '').slice(0, 200);
        outcome = r.status === 0
          ? refusal('HOSTOPS_MALFORMED', 'the boundary exited 0 without a parseable JSON body', { operation: op.__name })
          : refusal('HOSTOPS_UNAVAILABLE', 'the boundary refused before running (exit ' + r.status + ')', { operation: op.__name, detail: tail });
      } else if (r.status === 0 && body.ok === true && !(typeof body.audit_id === 'string' && body.audit_id)) {
        // PR #127 review: the helper audit_id is what joins the executor
        // record, the bridge REPORT and the root-owned ledger. A "success"
        // without one would be untraceable — refuse it rather than record it.
        outcome = refusal('HOSTOPS_MALFORMED', 'the boundary reported success without an audit id; result withheld as untraceable', { operation: op.__name, hostops_exit: 0 });
      } else if (r.status === 0 && body.ok === true) {
        outcome = {
          ok: true, version: VERSION, operation: op.__name, class: 'READ',
          audit_id: body.audit_id, dagu_run_id: null,
          result: body.result === undefined ? null : body.result,
          hostops_exit: 0, duration_ms: Date.now() - startedAt, http_status: 200,
          task: { task_id: ids.task_id || null, othmode_task_id: ids.othmode_task_id || null, github_task_id: ids.github_task_id || null }
        };
      } else {
        var code = r.status === 3 ? 'HOSTOPS_CALLER_REFUSED'
          : r.status === 4 ? 'HOSTOPS_EXEC_FAILED'
          : r.status === 5 ? 'HOSTOPS_AUDIT_UNAVAILABLE'
          : r.status === 2 ? 'HOSTOPS_REFUSED'
          : 'HOSTOPS_MALFORMED';
        outcome = refusal(code, (body.error && body.error.message) || 'hostops refused the operation', {
          operation: op.__name, hostops_exit: r.status,
          hostops_code: body.error && body.error.code ? body.error.code : null,
          audit_id: body.audit_id || null
        });
      }
    }

    outcome.task_recorded = record(ids.task_id, {
      at: new Date().toISOString(), operation: op.__name, outcome: outcome.ok ? 'ok' : 'failed',
      code: outcome.ok ? null : outcome.code, audit_id: outcome.audit_id || null,
      hostops_exit: outcome.hostops_exit === undefined ? null : outcome.hostops_exit,
      othmode_task_id: ids.othmode_task_id || null, github_task_id: ids.github_task_id || null,
      dagu_run_id: null, duration_ms: Date.now() - startedAt
    });
    return outcome;
  });
}

function describe() {
  var al = loadAllowlist();
  var reads = [];
  if (al && al.operations) {
    Object.keys(al.operations).forEach(function (n) {
      if (al.operations[n].class === 'READ') reads.push({ operation: n, helper: al.operations[n].helper, args: Object.keys(al.operations[n].args || {}) });
    });
  }
  return { version: VERSION, enabled: enabled(), socket: SOCKET_PATH, read_operations: reads, dagu: 'not in the READ path by design (docs/MYTHOS_HOSTOPS_INTERFACE.md; HOSTOPS-1 decision)' };
}

module.exports = { invoke: invoke, describe: describe, HTTP_STATUS: HTTP_STATUS, VERSION: VERSION };
