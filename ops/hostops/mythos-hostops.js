#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS — mythos-hostops v0.1 (READ-ONLY security boundary)
// ops/hostops/mythos-hostops.js  →  installed as /usr/local/sbin/mythos-hostops
//
// The ONLY path by which the future Dagu host-operations layer reaches
// privileged host state. Design: docs/MYTHOS_DAGU_HOST_OPERATIONS.md §7–§8;
// contract: docs/MYTHOS_HOSTOPS_INTERFACE.md. Same discipline as
// /usr/local/sbin/mythos-logs:
//
//   * NO arbitrary shell — every subprocess is execFile with a fixed
//     absolute binary and an argument ARRAY; nothing is ever parsed by a
//     shell, so metacharacters have no meaning even if they got through.
//   * structured operations only — a verb from the allowlist's READ class,
//     plus named, individually validated arguments. Unknown verbs, unknown
//     flags, WRITE/RESTART/DEPLOY verbs and anything destructive are
//     refused with a structured error, never "tried".
//   * the allowlist (ops/dagu-poc/hostops-allowlist.json, installed at
//     /etc/mythos/hostops-allowlist.json) is the single authorization
//     model. This file adds no operation of its own and hard-refuses any
//     operation whose class is not READ — even if the allowlist file were
//     edited to relax it, v0.1 executes READ verbs only.
//   * fail-closed audit — a successful operation whose audit record cannot
//     be written is reported as a failure. READ-only, so blocking is safe.
//   * caller boundary — under sudo, only SUDO_USER=dagu is accepted.
//     Direct invocation by root (the owner, or a root test run) is allowed.
//     Environment overrides (MYTHOS_HOSTOPS_HOME / _ALLOWLIST, dev/test
//     only) are IGNORED whenever the process was reached through sudo.
//
// Exit codes: 0 ok · 2 validation refused · 3 caller refused ·
//             4 execution failed · 5 audit unavailable
// =====================================================

var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var crypto = require('crypto');

var VERSION = '0.1.0';
var SUDO_USER = process.env.SUDO_USER || null;
var UNDER_SUDO = !!SUDO_USER;
var ALLOWED_SUDO_CALLERS = ['dagu'];

var INSTALLED_ALLOWLIST = '/etc/mythos/hostops-allowlist.json';
var INSTALLED_HOME = '/var/lib/mythos/hostops';
var GUARD_STATE = '/home/deploy/mythos-ai-executor/resource-guard.json';

var BIN = { docker: '/usr/bin/docker', systemctl: '/usr/bin/systemctl' };
var EXEC_TIMEOUT_MS = 10000;
var MAX_FILE_BYTES = 256 * 1024;
var MAX_OUTPUT_BYTES = 512 * 1024;

// Defense in depth: values already passed their anchored allowlist regex;
// this second net refuses every shell metacharacter and all whitespace.
var META_RE = /[;&|`$<>(){}\[\]'"\\\s]/;
// file-read may never return secret material even from an allowed tree.
var SECRET_BASENAME_RE = /(^\.?env$)|\.env(\..*)?$|\.(pem|key|p12|pfx)$|secret|token|credential|password|passwd/i;
var TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
var FILE_READ_ROOTS = ['/home/deploy/deployments/', '/home/deploy/projects/'];

function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }
function nowIso() { return new Date().toISOString(); }

var START = Date.now();
var AUDIT_HOME = UNDER_SUDO ? INSTALLED_HOME : (process.env.MYTHOS_HOSTOPS_HOME || INSTALLED_HOME);

function auditAppend(event) {
  var line = JSON.stringify(event) + '\n';
  fs.mkdirSync(AUDIT_HOME, { recursive: true, mode: 448 /* 0700 */ });
  fs.appendFileSync(path.join(AUDIT_HOME, 'audit.jsonl'), line, { mode: 384 /* 0600 */ });
}

function fail(exitCode, code, message, extra) {
  var event = {
    ts: nowIso(), audit_id: AUDIT_ID, version: VERSION, caller: CALLER,
    verb: RAW_VERB, args: SAFE_ARGS, task: TASK, outcome: 'refused',
    error: code, exit: exitCode, duration_ms: Date.now() - START
  };
  try { auditAppend(event); } catch (e) { /* refusals are reported even if audit is down */ }
  var body = { ok: false, version: VERSION, audit_id: AUDIT_ID, error: { code: code, message: message } };
  if (extra) body.error.detail = extra;
  out(body);
  process.exit(exitCode);
}

var AUDIT_ID = 'hostops-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
var CALLER = { uid: process.getuid(), sudo_user: SUDO_USER };
var RAW_VERB = null, SAFE_ARGS = {}, TASK = {};

// ---- 1. caller boundary (before anything else) -------------------------
if (UNDER_SUDO && ALLOWED_SUDO_CALLERS.indexOf(SUDO_USER) === -1) {
  fail(3, 'CALLER_NOT_ALLOWED', 'sudo caller "' + SUDO_USER + '" is not permitted to use mythos-hostops');
}

// ---- 2. load and verify the allowlist ---------------------------------
function loadAllowlist() {
  var candidates = [];
  if (!UNDER_SUDO && process.env.MYTHOS_HOSTOPS_ALLOWLIST) candidates.push(process.env.MYTHOS_HOSTOPS_ALLOWLIST);
  candidates.push(INSTALLED_ALLOWLIST);
  candidates.push(path.join(__dirname, '..', 'dagu-poc', 'hostops-allowlist.json'));
  for (var i = 0; i < candidates.length; i++) {
    var p = candidates[i];
    var st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (p === INSTALLED_ALLOWLIST) {
      // The installed policy must be root-owned and not writable by group/other.
      if (st.uid !== 0 || (st.mode & 18 /* 0022 */) !== 0) {
        fail(2, 'ALLOWLIST_UNTRUSTED', 'installed allowlist has unsafe ownership or permissions');
      }
    }
    try { return { file: p, doc: JSON.parse(fs.readFileSync(p, 'utf8')) }; } catch (e) {
      fail(2, 'ALLOWLIST_INVALID', 'allowlist unreadable or not JSON: ' + p);
    }
  }
  fail(2, 'ALLOWLIST_MISSING', 'no hostops allowlist found');
}
var AL = loadAllowlist();

// helper verb -> operation record, READ class only. Non-READ verbs are kept
// aside so they can be refused BY NAME with their class.
var READ_VERBS = {}, NON_READ_VERBS = {};
Object.keys(AL.doc.operations || {}).forEach(function (op) {
  var rec = AL.doc.operations[op];
  var entry = { operation: op, class: rec.class, args: rec.args || {} };
  if (rec.class === 'READ') { READ_VERBS[rec.helper] = entry; READ_VERBS[op] = entry; }
  else { NON_READ_VERBS[rec.helper] = entry; NON_READ_VERBS[op] = entry; }
});

// ---- 3. parse and validate the command line ---------------------------
var argv = process.argv.slice(2);
if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
  out({ ok: true, version: VERSION, usage: 'mythos-hostops <verb> [--<arg> <value>]... [--task-id T] [--othmode-task T] [--github-task T]', read_verbs: Object.keys(READ_VERBS).filter(function (v) { return v.indexOf('.') === -1; }) });
  process.exit(0);
}
RAW_VERB = String(argv[0]);

if (NON_READ_VERBS[RAW_VERB]) {
  fail(2, 'OPERATION_NOT_READ', 'operation "' + NON_READ_VERBS[RAW_VERB].operation + '" is class ' + NON_READ_VERBS[RAW_VERB].class + '; mythos-hostops v0.1 executes READ operations only');
}
var OP = READ_VERBS[RAW_VERB];
if (!OP) fail(2, 'UNKNOWN_OPERATION', 'unknown verb "' + RAW_VERB.slice(0, 64) + '" — not in the hostops allowlist');

var OPTIONAL_DEFAULTS = { 'host.docker.logs': { lines: '200' } };
var META_FLAGS = { 'task-id': 'task_id', 'othmode-task': 'othmode_task_id', 'github-task': 'github_task_id' };

var flags = {};
for (var i = 1; i < argv.length; i += 2) {
  var k = argv[i], v = argv[i + 1];
  if (!/^--[a-z][a-z-]{1,24}$/.test(k)) fail(2, 'ARG_INVALID', 'malformed flag "' + String(k).slice(0, 32) + '"');
  if (typeof v !== 'string') fail(2, 'ARG_INVALID', 'flag ' + k + ' has no value');
  var name = k.slice(2);
  if (flags[name] !== undefined) fail(2, 'ARG_INVALID', 'flag ' + k + ' given twice');
  flags[name] = v;
}
Object.keys(flags).forEach(function (name) {
  var v = flags[name];
  if (META_FLAGS[name]) {
    if (!TASK_ID_RE.test(v)) fail(2, 'ARG_INVALID', 'task identity "' + name + '" fails validation');
    TASK[META_FLAGS[name]] = v;
    return;
  }
  var pattern = OP.args[name];
  if (!pattern) fail(2, 'ARG_UNKNOWN', 'operation ' + OP.operation + ' does not accept argument "' + name + '"');
  if (v.length > 256) fail(2, 'ARG_INVALID', 'argument "' + name + '" too long');
  if (!(new RegExp(pattern)).test(v)) fail(2, 'ARG_INVALID', 'argument "' + name + '" fails the allowlist pattern');
  if (META_RE.test(v)) fail(2, 'ARG_INVALID', 'argument "' + name + '" contains a forbidden character');
  SAFE_ARGS[name] = v;
});
Object.keys(OP.args).forEach(function (name) {
  if (SAFE_ARGS[name] !== undefined) return;
  var def = (OPTIONAL_DEFAULTS[OP.operation] || {})[name];
  if (def !== undefined) { SAFE_ARGS[name] = def; return; }
  fail(2, 'ARG_MISSING', 'operation ' + OP.operation + ' requires argument "' + name + '"');
});

// ---- 4. execute (READ implementations only) ---------------------------
function run(bin, args) {
  var r = cp.spawnSync(bin, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf8' });
  if (r.error) fail(4, 'EXEC_FAILED', bin + ': ' + r.error.message);
  return r;
}
function cap(s) {
  s = String(s == null ? '' : s);
  return s.length > MAX_OUTPUT_BYTES ? { text: s.slice(0, MAX_OUTPUT_BYTES), truncated: true } : { text: s, truncated: false };
}
function readProcKv(file, keys) {
  var o = {};
  fs.readFileSync(file, 'utf8').split('\n').forEach(function (l) {
    var m = l.match(/^(\w+):?\s+(\d+)/);
    if (m && keys.indexOf(m[1]) !== -1) o[m[1]] = parseInt(m[2], 10);
  });
  return o;
}

var IMPL = {
  'host.health.check': function () {
    var mem = readProcKv('/proc/meminfo', ['MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree']);
    var vm = readProcKv('/proc/vmstat', ['oom_kill']);
    var psi = (fs.readFileSync('/proc/pressure/memory', 'utf8').split('\n')[0].match(/avg60=([0-9.]+)/) || [null, null])[1];
    var load = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(' ').slice(0, 3);
    var up = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
    return {
      mem_total_mib: Math.round(mem.MemTotal / 1024), mem_available_mib: Math.round(mem.MemAvailable / 1024),
      swap_used_mib: Math.round((mem.SwapTotal - mem.SwapFree) / 1024), swap_total_mib: Math.round(mem.SwapTotal / 1024),
      psi_memory_some_avg60: psi === null ? null : parseFloat(psi), oom_kill: vm.oom_kill,
      load_avg: load.map(parseFloat), uptime_seconds: Math.round(up)
    };
  },
  'host.docker.status': function (a) {
    var r = run(BIN.docker, ['inspect', '--format', '{{json .State}}', a.container]);
    if (r.status !== 0) fail(4, 'EXEC_FAILED', 'docker inspect failed', cap(r.stderr).text.slice(0, 400));
    var st = JSON.parse(r.stdout);
    return { container: a.container, status: st.Status, running: !!st.Running, health: st.Health ? st.Health.Status : null, started_at: st.StartedAt, exit_code: st.ExitCode, oom_killed: !!st.OOMKilled };
  },
  'host.docker.logs': function (a) {
    var r = run(BIN.docker, ['logs', '--tail', a.lines, a.container]);
    if (r.status !== 0) fail(4, 'EXEC_FAILED', 'docker logs failed', cap(r.stderr).text.slice(0, 400));
    var so = cap(r.stdout), se = cap(r.stderr);
    return { container: a.container, lines: parseInt(a.lines, 10), stdout: so.text, stderr: se.text, truncated: so.truncated || se.truncated };
  },
  'host.systemd.status': function (a) {
    var props = 'ActiveState,SubState,UnitFileState,MainPID,NRestarts,MemoryCurrent,ExecMainStartTimestamp';
    var r = run(BIN.systemctl, ['show', a.unit, '--no-pager', '--property=' + props]);
    if (r.status !== 0) fail(4, 'EXEC_FAILED', 'systemctl show failed', cap(r.stderr).text.slice(0, 400));
    var o = { unit: a.unit };
    r.stdout.split('\n').forEach(function (l) { var ix = l.indexOf('='); if (ix > 0) o[l.slice(0, ix)] = l.slice(ix + 1); });
    return o;
  },
  'host.file.read': function (a) {
    var norm = path.normalize(a.path);
    if (norm !== a.path || a.path.indexOf('..') !== -1) fail(2, 'PATH_REFUSED', 'path is not in normal form');
    var real;
    try { real = fs.realpathSync(a.path); } catch (e) { fail(4, 'EXEC_FAILED', 'path does not exist or is unreachable'); }
    var inside = FILE_READ_ROOTS.some(function (root) { return real.indexOf(root) === 0; });
    if (!inside) fail(2, 'PATH_REFUSED', 'resolved path escapes the approved trees');
    if (SECRET_BASENAME_RE.test(path.basename(real))) fail(2, 'PATH_REFUSED', 'refusing a secret-shaped filename');
    var st = fs.lstatSync(real);
    if (!st.isFile()) fail(2, 'PATH_REFUSED', 'not a regular file');
    if (st.size > MAX_FILE_BYTES * 8) fail(2, 'PATH_REFUSED', 'file too large for hostops file-read');
    var buf = fs.readFileSync(real);
    var truncated = buf.length > MAX_FILE_BYTES;
    return { path: real, size: st.size, truncated: truncated, content: buf.slice(0, MAX_FILE_BYTES).toString('utf8') };
  },
  'host.resource.guard': function () {
    var mem = readProcKv('/proc/meminfo', ['MemAvailable']);
    var vm = readProcKv('/proc/vmstat', ['oom_kill']);
    var psi = (fs.readFileSync('/proc/pressure/memory', 'utf8').split('\n')[0].match(/avg60=([0-9.]+)/) || [null, null])[1];
    var persisted = null;
    try { persisted = JSON.parse(fs.readFileSync(GUARD_STATE, 'utf8')); } catch (e) { /* read-only view; absence is reported, never fatal */ }
    // Reported, never decided here: the guard's own state machine (with
    // hysteresis) is the authority; this verb only OBSERVES and never
    // samples/advances it, so root never writes into the deploy state dir.
    return {
      signals: { mem_available_mib: Math.round(mem.MemAvailable / 1024), psi_memory_some_avg60: psi === null ? null : parseFloat(psi), oom_kill: vm.oom_kill },
      persisted_level: persisted && persisted.level ? persisted.level : null,
      persisted_at: persisted && persisted.updated_at ? persisted.updated_at : null,
      state_file: GUARD_STATE
    };
  }
};

var result = IMPL[OP.operation](SAFE_ARGS);

// ---- 5. audit (fail closed on success path) ---------------------------
var event = {
  ts: nowIso(), audit_id: AUDIT_ID, version: VERSION, caller: CALLER,
  verb: RAW_VERB, operation: OP.operation, class: 'READ', args: SAFE_ARGS,
  task: TASK, outcome: 'ok', exit: 0, duration_ms: Date.now() - START
};
try { auditAppend(event); } catch (e) {
  out({ ok: false, version: VERSION, audit_id: AUDIT_ID, error: { code: 'AUDIT_UNAVAILABLE', message: 'operation succeeded but its audit record could not be written; result withheld (fail closed)' } });
  process.exit(5);
}

out({ ok: true, version: VERSION, audit_id: AUDIT_ID, operation: OP.operation, class: 'READ', args: SAFE_ARGS, task: TASK, duration_ms: Date.now() - START, result: result });
