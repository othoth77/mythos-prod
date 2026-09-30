#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS — mythos-hostops v0.2 (controlled privileged gateway)
// ops/hostops/mythos-hostops.js  →  installed as /usr/local/sbin/mythos-hostops
//
// The ONLY path by which FABLE (the executor's headless Claude sessions, user
// `deploy`), Dagu and the owner reach privileged or out-of-sandbox host state:
//
//   FABLE → policy (this file + the catalog) → HostOps → one catalogued
//   operation → audit (before AND after) → verification → rollback if needed
//
// Contract: docs/MYTHOS_HOSTOPS_INTERFACE.md (v0.2 addendum); tiers:
// docs/MYTHOS_PERMISSION_MODEL.md. v0.1 was READ-only; v0.2 adds the
// CONTROLLED tier without weakening any v0.1 property:
//
//   * NO arbitrary shell — every subprocess is spawnSync with a fixed
//     absolute binary and an argument ARRAY. Operations are structured verbs
//     with named, individually validated arguments; never command strings.
//   * the catalog (ops/dagu-poc/hostops-allowlist.json, installed root-owned
//     at /etc/mythos/hostops-allowlist.json) is the single authorization
//     model; an operation, service, container, config key or tool absent
//     from it is refused (fail closed).
//   * three tiers. NORMAL (READ class) runs autonomously. CONTROLLED runs
//     autonomously but only against catalogued targets, behind: owner kill
//     switch, caller attribution, Resource Guard, hourly and per-tool rate
//     limits, a single-writer lock, an INTENT audit record written before
//     anything executes (fail closed), a pre-change backup, compare-and-swap
//     writes, post-change verification and automatic rollback.
//     HIGHLY_SENSITIVE (OWNER / DESTRUCTIVE classes and the named
//     highly_sensitive_operations) is never executed here, under any caller
//     or argument — the owner does those by hand.
//   * HARD INVARIANTS in code (HARD below) that a catalog edit cannot relax:
//     protected units/containers, secret-shaped or security-toggle env keys,
//     drop-in names, inline secrets, tool binary roots. A tampered catalog
//     still cannot reach them.
//   * least privilege. Deploy-owned state (user units, drop-ins, the bridge)
//     is touched ONLY by the user worker (mythos-hostops-user-worker.js),
//     launched through deploy's own user manager (`systemd-run --user`) with
//     deploy's uid — root never writes into a directory deploy controls, so
//     the symlink/TOCTOU escalation class does not exist here. Root itself
//     only runs catalogued `systemctl` (system units) and `docker restart`.
//   * fail-closed audit — CONTROLLED operations whose intent record cannot be
//     written never execute; a success whose result record cannot be written
//     is reported as a failure.
//   * caller boundary — SUDO_USER must be one of ALLOWED_SUDO_CALLERS (set by
//     real sudo or by the root socket daemon after its SO_PEERCRED check).
//     Direct root invocation with SUDO_USER unset is the owner path; only
//     then are the MYTHOS_HOSTOPS_* dev/test overrides honoured.
//
// Exit codes: 0 ok · 2 refused by policy · 3 caller refused ·
//             4 execution/verification failed (rolled back when possible) ·
//             5 audit unavailable
// =====================================================

var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var crypto = require('crypto');

var VERSION = '0.2.0';
var SUDO_USER = process.env.SUDO_USER || null;
var UNDER_SUDO = !!SUDO_USER;
var ALLOWED_SUDO_CALLERS = ['dagu', 'deploy'];
var IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

var INSTALLED_ALLOWLIST = '/etc/mythos/hostops-allowlist.json';
var INSTALLED_HOME = '/var/lib/mythos/hostops';
var INSTALLED_WORKER = '/usr/local/lib/mythos-hostops/user-worker.js';
var INSTALLED_KILL_SWITCH = '/etc/mythos/hostops-controlled.disabled';
var GUARD_STATE = '/home/deploy/mythos-ai-executor/resource-guard.json';
var EXECUTOR_TASKS = '/home/deploy/mythos-ai-executor/tasks';
var USER_UNIT_DIR = '/home/deploy/.config/systemd/user';
var RUN_AS_USER = 'deploy';
var TOOL_ROOTS = ['/home/deploy/projects/mythos-prod/'];

var BIN = { docker: '/usr/bin/docker', systemctl: '/usr/bin/systemctl', systemdRun: '/usr/bin/systemd-run', node: '/usr/bin/node' };
var EXEC_TIMEOUT_MS = 10000;
var MAX_FILE_BYTES = 256 * 1024;
var MAX_OUTPUT_BYTES = 512 * 1024;

// Dev/test overrides — honoured ONLY when not under sudo/the daemon.
function dev(name, fallback) { return (!UNDER_SUDO && process.env[name]) ? process.env[name] : fallback; }
var AUDIT_HOME = dev('MYTHOS_HOSTOPS_HOME', INSTALLED_HOME);
var WORKER = dev('MYTHOS_HOSTOPS_WORKER', INSTALLED_WORKER);
var KILL_SWITCH = dev('MYTHOS_HOSTOPS_KILL_SWITCH', INSTALLED_KILL_SWITCH);
var UNIT_DIR = dev('MYTHOS_HOSTOPS_USER_UNIT_DIR', USER_UNIT_DIR);
var TASKS_DIR = dev('MYTHOS_HOSTOPS_TASKS_DIR', EXECUTOR_TASKS);
var GUARD_FILE = dev('MYTHOS_HOSTOPS_GUARD_STATE', GUARD_STATE);
var DEV_SYSTEMCTL = dev('MYTHOS_HOSTOPS_SYSTEMCTL', null);      // fake systemctl (system + user) for tests
var DEV_DOCKER = dev('MYTHOS_HOSTOPS_DOCKER', null);
var DEV_TOOL_ROOT = dev('MYTHOS_HOSTOPS_TOOL_ROOT', null);
// 'systemd-run' (production: through deploy's user manager) or 'direct'
// (tests: spawn the worker directly, dropping to RUN_AS when root).
var WORKER_MODE = dev('MYTHOS_HOSTOPS_WORKER_MODE', 'systemd-run');
var RUN_AS = dev('MYTHOS_HOSTOPS_RUN_AS', RUN_AS_USER);           // 'self' = no privilege drop (non-root tests)
if (DEV_TOOL_ROOT) TOOL_ROOTS = TOOL_ROOTS.concat([DEV_TOOL_ROOT]);
if (DEV_SYSTEMCTL) BIN.systemctl = DEV_SYSTEMCTL;
if (DEV_DOCKER) BIN.docker = DEV_DOCKER;

// Defense in depth: values already passed their anchored catalog regex;
// this second net refuses every shell metacharacter and all whitespace.
var META_RE = /[;&|`$<>(){}\[\]'"\\\s%*?!#~]/;
// file-read may never return secret material even from an allowed tree.
var SECRET_BASENAME_RE = /(^\.?env$)|\.env(\..*)?$|\.(pem|key|p12|pfx)$|secret|token|credential|password|passwd/i;
var TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
var FILE_READ_ROOTS = ['/home/deploy/deployments/', '/home/deploy/projects/'];

// ---- HARD INVARIANTS (a catalog edit cannot relax these) ---------------
var HARD = {
  // units no CONTROLLED operation may start/stop/restart
  PROTECTED_UNIT_RE: /^(mythos-hostops|mythos-git-push|mythos-governance|mythos-session-guard|mythos-memwatch|mythos-docker-firewall|mythos-ai-executor|mythos-command-center|mythos-github-bridge\.service|mythos-mcp-http|mythos-gh-runner|mythos-haddad-ingest|mythos-contextforge|ssh|sshd|docker|containerd|dbus|polkit|systemd-|user@|user-runtime-dir@|ufw|nftables|netfilter|iptables|nginx|cron|rsyslog|auditd|apparmor|fail2ban|getty|networkd|resolved)/,
  // security, monitoring, backup and control-channel units may be started, never stopped
  NO_STOP_RE: /^(mythos-guardian|mythos-backup|mythos-restore|mythos-status-monitor|mythos-github-bridge)/,
  // units whose environment is itself a control (executor policy, guards, HostOps)
  CONFIG_PROTECTED_UNIT_RE: /^(mythos-hostops|mythos-ai-executor|mythos-git-push|mythos-governance|mythos-session-guard|mythos-guardian|mythos-memwatch|mythos-docker-firewall|mythos-gh-runner|ssh|sshd|docker|nginx|user@)/,
  // data stores and identity/auth containers are never restarted here
  PROTECTED_CONTAINER_RE: /(postgres|mysql|mariadb|redis|mongo|dex|auth|contextforge|vault|registry)/,
  ENV_NAME_RE: /^MYTHOS_[A-Z0-9_]{3,80}$/,
  SECRET_ENV_RE: /(TOKEN|SECRET|PASSW|CREDENTIAL|PRIVATE|API_?KEY|_KEY$|_KEY_|COOKIE|SESSION|AUTH)/,
  SECURITY_TOGGLE_ENV_RE: /(GUARD|GOVERN|POLICY|HOSTOPS|APPROV|AUDIT|SANDBOX|ALLOW_PUBLIC|ALLOWED_USER|PRIVILEG|SUDO|ROOT)/,
  DROPIN_RE: /^[0-9a-z][a-z0-9-]{0,40}\.conf$/,
  // a drop-in that holds a raw secret value (not a path — absolute, or a
  // systemd specifier path such as %h/…) is itself HIGHLY_SENSITIVE
  INLINE_SECRET_RE: /^\s*Environment=\s*"?[A-Z0-9_]*(TOKEN|SECRET|PASSW|API_?KEY|PRIVATE)[A-Z0-9_]*=(?!\/|%[a-zA-Z]\/)\S/m,
  TOOL_ARG_RE: /^[A-Za-z0-9._=:,+\/-]{1,64}$/
};
var PRESSURE_EXEMPT = { 'service-control': true, 'docker-restart': true, 'change-rollback': true };

function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }
function nowIso() { return new Date().toISOString(); }
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function mask(v) {
  return String(v).split(',').map(function (x) {
    x = x.replace(/^\+/, '');
    return x.length >= 8 ? x.slice(0, 3) + new Array(x.length - 6).join('*') + x.slice(-4) : '****';
  }).join(',');
}

var START = Date.now();
var AUDIT_ID = 'hostops-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
var CALLER = { uid: process.getuid(), sudo_user: SUDO_USER };
var RAW_VERB = null, SAFE_ARGS = {}, AUDIT_ARGS = {}, TASK = {}, OP = null, TIER = null, TASK_VERIFIED = null;
var LOCK_HELD = false;

function auditAppend(event) {
  var line = JSON.stringify(event) + '\n';
  fs.mkdirSync(AUDIT_HOME, { recursive: true, mode: 448 /* 0700 */ });
  fs.appendFileSync(path.join(AUDIT_HOME, 'audit.jsonl'), line, { mode: 384 /* 0600 */ });
}
function baseEvent(phase, outcome) {
  return {
    ts: nowIso(), audit_id: AUDIT_ID, version: VERSION, caller: CALLER, phase: phase,
    verb: RAW_VERB, operation: OP ? OP.operation : undefined, class: OP ? OP.class : undefined, tier: TIER || undefined,
    args: AUDIT_ARGS, task: TASK, task_verified: TASK_VERIFIED, outcome: outcome
  };
}

function releaseLock() {
  if (!LOCK_HELD) return;
  try { fs.unlinkSync(path.join(AUDIT_HOME, 'controlled.lock')); } catch (e) { /* already gone */ }
  LOCK_HELD = false;
}

function fail(exitCode, code, message, extra) {
  var event = baseEvent('result', exitCode === 4 && extra && extra.rolled_back ? 'rolled_back' : (exitCode === 4 ? 'failed' : 'refused'));
  event.error = code; event.exit = exitCode; event.duration_ms = Date.now() - START;
  if (extra && extra.audit) event.detail = extra.audit;
  try { auditAppend(event); } catch (e) { /* refusals are reported even if audit is down */ }
  releaseLock();
  var body = { ok: false, version: VERSION, audit_id: AUDIT_ID, error: { code: code, message: message } };
  if (extra && extra.detail !== undefined) body.error.detail = extra.detail;
  if (extra && extra.result) body.result = extra.result;
  out(body);
  process.exit(exitCode);
}

// Task identity is pre-scanned so that even an early refusal is attributed
// (v0.1 recorded `task: {}` for refused verbs).
var META_FLAGS = { 'task-id': 'task_id', 'othmode-task': 'othmode_task_id', 'github-task': 'github_task_id' };
var argv = process.argv.slice(2);
for (var pi = 1; pi + 1 < argv.length; pi += 2) {
  var pk = String(argv[pi]).replace(/^--/, '');
  if (META_FLAGS[pk] && TASK_ID_RE.test(String(argv[pi + 1]))) TASK[META_FLAGS[pk]] = argv[pi + 1];
}
RAW_VERB = argv.length ? String(argv[0]).slice(0, 64) : null;

// ---- 1. caller boundary (before anything else) -------------------------
if (UNDER_SUDO && ALLOWED_SUDO_CALLERS.indexOf(SUDO_USER) === -1) {
  fail(3, 'CALLER_NOT_ALLOWED', 'sudo caller "' + SUDO_USER + '" is not permitted to use mythos-hostops');
}

// ---- 2. load and verify the catalog ------------------------------------
function loadAllowlist() {
  var candidates = [];
  if (!UNDER_SUDO && process.env.MYTHOS_HOSTOPS_ALLOWLIST) candidates.push(process.env.MYTHOS_HOSTOPS_ALLOWLIST);
  candidates.push(INSTALLED_ALLOWLIST);
  candidates.push(path.join(__dirname, '..', 'dagu-poc', 'hostops-allowlist.json'));
  for (var i = 0; i < candidates.length; i++) {
    var p = candidates[i];
    var st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (p === INSTALLED_ALLOWLIST || UNDER_SUDO) {
      // The installed policy must be root-owned and not writable by group/other.
      if (st.uid !== 0 || (st.mode & 18 /* 0022 */) !== 0) {
        fail(2, 'ALLOWLIST_UNTRUSTED', 'installed allowlist has unsafe ownership or permissions');
      }
    }
    var doc;
    try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
      fail(2, 'ALLOWLIST_INVALID', 'allowlist unreadable or not JSON: ' + p);
    }
    if (!doc || !/^0\.2\./.test(String(doc.schema_version)) || !doc.operations || !doc.classes) {
      fail(2, 'ALLOWLIST_SCHEMA', 'allowlist schema ' + String(doc && doc.schema_version) + ' is not a v0.2 catalog; refusing (fail closed)');
    }
    return { file: p, doc: doc };
  }
  fail(2, 'ALLOWLIST_MISSING', 'no hostops allowlist found');
}
var AL = loadAllowlist();
var CAT = AL.doc;

// helper verb OR operation name -> operation record
var OPS = {};
Object.keys(CAT.operations).forEach(function (name) {
  var rec = CAT.operations[name];
  var cls = CAT.classes[rec.class] || null;
  var entry = { operation: name, class: rec.class, tier: cls ? cls.tier : null, helper: rec.helper, args: rec.args || {}, defaults: rec.defaults || {}, timeout_ms: rec.timeout_ms || EXEC_TIMEOUT_MS, rec: rec };
  OPS[rec.helper] = entry; OPS[name] = entry;
});

// ---- 3. resolve the verb -----------------------------------------------
if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
  out({ ok: true, version: VERSION, usage: 'mythos-hostops <verb> [--<arg> <value>]... [--task-id T] [--othmode-task T] [--github-task T]',
    read_verbs: Object.keys(CAT.operations).filter(function (n) { return CAT.operations[n].class === 'READ'; }).map(function (n) { return CAT.operations[n].helper; }),
    controlled_verbs: Object.keys(CAT.operations).filter(function (n) { return CAT.operations[n].class === 'CONTROLLED'; }).map(function (n) { return CAT.operations[n].helper; }) });
  process.exit(0);
}

var HS = CAT.highly_sensitive_operations || {};
if (Object.prototype.hasOwnProperty.call(HS, RAW_VERB)) {
  TIER = 'HIGHLY_SENSITIVE';
  fail(2, 'HIGHLY_SENSITIVE', 'operation "' + RAW_VERB + '" is HIGHLY_SENSITIVE (' + String(HS[RAW_VERB]).slice(0, 160) + '); HostOps never executes it — owner action outside the system');
}
OP = OPS[RAW_VERB] || null;
if (!OP) fail(2, 'UNKNOWN_OPERATION', 'unknown verb "' + RAW_VERB + '" — not in the hostops catalog');
TIER = OP.tier;
if (OP.class === 'OWNER') fail(2, 'OWNER_APPROVAL_REQUIRED', 'operation "' + OP.operation + '" is class OWNER (HIGHLY_SENSITIVE); HostOps does not execute it — the owner performs it');
if (OP.class === 'DESTRUCTIVE') fail(2, 'DESTRUCTIVE_NEVER', 'operation "' + OP.operation + '" is DESTRUCTIVE; never executable through HostOps');
if (OP.class !== 'READ' && OP.class !== 'CONTROLLED') fail(2, 'CLASS_NOT_EXECUTABLE', 'operation "' + OP.operation + '" has class ' + OP.class + ', which HostOps v0.2 does not execute');

// ---- 4. parse and validate the command line ----------------------------
var flags = {};
for (var i = 1; i < argv.length; i += 2) {
  var k = argv[i], v = argv[i + 1];
  if (!/^--[a-z][a-z-]{1,24}$/.test(k)) fail(2, 'ARG_INVALID', 'malformed flag "' + String(k).slice(0, 32) + '"');
  if (typeof v !== 'string') fail(2, 'ARG_INVALID', 'flag ' + k + ' has no value');
  var name = k.slice(2);
  if (flags[name] !== undefined) fail(2, 'ARG_INVALID', 'flag ' + k + ' given twice');
  flags[name] = v;
}
TASK = {};
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
var OPTIONAL = { 'tool-run': { confirm: true } };
Object.keys(OP.args).forEach(function (name) {
  if (SAFE_ARGS[name] !== undefined) return;
  if (OP.defaults[name] !== undefined) { SAFE_ARGS[name] = OP.defaults[name]; return; }
  if (OPTIONAL[OP.helper] && OPTIONAL[OP.helper][name]) return;
  fail(2, 'ARG_MISSING', 'operation ' + OP.operation + ' requires argument "' + name + '"');
});
AUDIT_ARGS = Object.assign({}, SAFE_ARGS);
// never write a masked config value into the ledger in clear
if (OP.helper === 'config-set' && CAT.config_keys && CAT.config_keys[SAFE_ARGS.key] && CAT.config_keys[SAFE_ARGS.key].mask) {
  AUDIT_ARGS.value = mask(SAFE_ARGS.value); AUDIT_ARGS.value_sha256 = sha256(SAFE_ARGS.value).slice(0, 16);
}

// ---- 5. execution helpers ----------------------------------------------
function run(bin, args, timeoutMs) {
  var r = cp.spawnSync(bin, args, { timeout: timeoutMs || EXEC_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf8' });
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
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

var RUN_AS_IDS = null;
function runAsIds() {
  if (RUN_AS_IDS) return RUN_AS_IDS;
  if (RUN_AS === 'self' || !IS_ROOT) { RUN_AS_IDS = { uid: process.getuid(), gid: process.getgid(), home: process.env.HOME || '/tmp', drop: false }; return RUN_AS_IDS; }
  var line = fs.readFileSync('/etc/passwd', 'utf8').split('\n').filter(function (l) { return l.split(':')[0] === RUN_AS; })[0];
  if (!line) fail(4, 'RUN_AS_MISSING', 'run-as user "' + RUN_AS + '" does not exist');
  var f = line.split(':');
  RUN_AS_IDS = { uid: parseInt(f[2], 10), gid: parseInt(f[3], 10), home: f[5], drop: true };
  if (RUN_AS_IDS.uid === 0) fail(4, 'RUN_AS_ROOT', 'refusing to run the user worker as root');
  return RUN_AS_IDS;
}

// The user worker: deploy-owned state is touched ONLY here, never by root.
function worker(req, timeoutMs) {
  var ids = runAsIds();
  timeoutMs = Math.min(timeoutMs || 30000, OP.timeout_ms + 5000);
  if (DEV_SYSTEMCTL) req.systemctl_bin = DEV_SYSTEMCTL;
  req.timeout_ms = Math.max(1000, timeoutMs - 2000);
  var env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: ids.home, LANG: 'C.UTF-8',
    XDG_RUNTIME_DIR: '/run/user/' + ids.uid, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/' + ids.uid + '/bus' };
  var opts = { input: JSON.stringify(req), encoding: 'utf8', timeout: timeoutMs, env: env, maxBuffer: 4 * 1024 * 1024, cwd: '/' };
  if (ids.drop) { opts.uid = ids.uid; opts.gid = ids.gid; }
  var r;
  if (WORKER_MODE === 'direct') {
    r = cp.spawnSync(BIN.node, [WORKER], opts);
  } else {
    // NODE_OPTIONS/NODE_PATH are blanked: deploy can set its user manager's
    // environment, and must not be able to inject code into the worker that
    // reports verification results back to root.
    r = cp.spawnSync(BIN.systemdRun, ['--user', '--wait', '--pipe', '--quiet', '--collect',
      '-p', 'NoNewPrivileges=yes', '-p', 'MemoryMax=256M', '-p', 'RuntimeMaxSec=' + Math.ceil(timeoutMs / 1000),
      '--setenv=NODE_OPTIONS=', '--setenv=NODE_PATH=',
      BIN.node, WORKER], opts);
  }
  if (r.error) fail(4, 'WORKER_UNAVAILABLE', 'user worker could not run: ' + r.error.message);
  var body = null;
  try { body = JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch (e) { /* malformed */ }
  if (!body) fail(4, 'WORKER_MALFORMED', 'user worker returned no JSON (exit ' + r.status + ')', { detail: String(r.stderr || '').slice(0, 300) });
  if (ids.drop && body.uid !== undefined && body.uid !== ids.uid) fail(4, 'WORKER_IDENTITY', 'user worker reported uid ' + body.uid + ', expected ' + ids.uid);
  return body;
}
function workerOk(req, timeoutMs, codeOnFail) {
  var b = worker(req, timeoutMs);
  if (!b.ok) fail(4, codeOnFail || 'WORKER_FAILED', 'user worker: ' + String(b.code || '') + ' ' + String(b.error || '').slice(0, 200));
  return b;
}

// Environment= line handling — strict, single occurrence, no quoting games.
// `[ \t]*$`, never `\s*$`: under the m flag \s would swallow the newline of a
// following blank line and the rewrite would delete it (caught by the live
// self-test on the real drop-in).
function envLineRe(env) { return new RegExp('^Environment=' + env + '=([^\\s"\\\\]*)[ \\t]*$', 'gm'); }
function envValues(content, env) {
  var m, vals = [], re = envLineRe(env);
  while ((m = re.exec(content)) !== null) vals.push(m[1]);
  return vals;
}

function configEntry(key) {
  var e = (CAT.config_keys || {})[key];
  if (!e) fail(2, 'CONFIG_KEY_UNKNOWN', 'config key "' + key + '" is not declared in the catalog');
  if (!HARD.ENV_NAME_RE.test(String(e.env))) fail(2, 'HARD_ENV_NAME', 'env name ' + String(e.env).slice(0, 40) + ' is not a MYTHOS_* variable');
  if (HARD.SECRET_ENV_RE.test(e.env)) fail(2, 'HIGHLY_SENSITIVE', 'env ' + e.env + ' is secret-shaped; secrets are never set through HostOps');
  if (HARD.SECURITY_TOGGLE_ENV_RE.test(e.env)) fail(2, 'HIGHLY_SENSITIVE', 'env ' + e.env + ' is a security control; changing it is owner-only');
  if (!/^[a-z0-9@._-]{1,64}\.service$/.test(String(e.unit)) || HARD.CONFIG_PROTECTED_UNIT_RE.test(e.unit)) fail(2, 'PROTECTED_UNIT', 'unit ' + String(e.unit).slice(0, 64) + ' may not be reconfigured through HostOps');
  if (!HARD.DROPIN_RE.test(String(e.dropin))) fail(2, 'HARD_DROPIN', 'drop-in name ' + String(e.dropin).slice(0, 40) + ' is not allowed');
  e.path = path.join(UNIT_DIR, e.unit + '.d', e.dropin);
  return e;
}

function normalizeValue(e, raw) {
  var items = e.separator ? String(raw).split(e.separator) : [String(raw)];
  items = items.map(function (x) { return e.normalize === 'strip_plus' ? x.replace(/^\+/, '') : x; });
  var re = new RegExp(e.item_pattern);
  var seen = {}, outItems = [];
  items.forEach(function (x) {
    if (!x || !re.test(x) && !re.test('+' + x)) fail(2, 'CONFIG_VALUE_INVALID', 'value for ' + SAFE_ARGS.key + ' fails its declared pattern');
    if (!seen[x]) { seen[x] = true; outItems.push(x); }
  });
  if (!outItems.length || outItems.length > (e.max_items || 1)) fail(2, 'CONFIG_VALUE_INVALID', 'value for ' + SAFE_ARGS.key + ' must have 1..' + (e.max_items || 1) + ' item(s)');
  return outItems.join(e.separator || '');
}
function shown(e, v) { return v === null || v === undefined ? null : (e.mask ? mask(v) : v); }

function readDropin(e) {
  var f = workerOk({ action: 'file-read', path: e.path }, 20000, 'DROPIN_UNREADABLE');
  if (!f.exists) fail(2, 'DROPIN_MISSING', 'drop-in ' + e.unit + '.d/' + e.dropin + ' does not exist (HostOps never creates unit files)');
  var ids = runAsIds();
  if (ids.drop && f.owner_uid !== ids.uid) fail(2, 'DROPIN_OWNER', 'drop-in is not owned by ' + RUN_AS);
  if (HARD.INLINE_SECRET_RE.test(f.content)) fail(2, 'HIGHLY_SENSITIVE', 'drop-in holds an inline secret value; editing it is owner-only');
  return f;
}
function unitEnv(unit) {
  return workerOk({ action: 'unit-env', unit: unit }, 20000, 'UNIT_ENV_FAILED').env || {};
}
function userDaemonReload() {
  var r = workerOk({ action: 'systemctl', args: ['daemon-reload'] }, 30000, 'DAEMON_RELOAD_FAILED');
  if (r.status !== 0) fail(4, 'DAEMON_RELOAD_FAILED', 'systemctl --user daemon-reload exited ' + r.status, { detail: String(r.stderr || '').slice(0, 200) });
}

function softReload() {
  var r = worker({ action: 'systemctl', args: ['daemon-reload'] }, 30000);
  return !!(r.ok && r.status === 0);
}
function softUnitEnv(unit) {
  var r = worker({ action: 'unit-env', unit: unit }, 20000);
  return r.ok ? (r.env || {}) : null;
}
// A verification tool failure must become a problem (→ rollback), not an exit.
function softTool(t, id) { try { return runToolSoft(t, id); } catch (e) { return null; } }

function changesDir() { var d = path.join(AUDIT_HOME, 'changes'); fs.mkdirSync(d, { recursive: true, mode: 448 }); return d; }
function writeChange(rec) {
  try { fs.writeFileSync(path.join(changesDir(), rec.change_id + '.json'), JSON.stringify(rec, null, 2) + '\n', { mode: 384 }); }
  catch (e) { fail(5, 'AUDIT_UNAVAILABLE', 'the change backup could not be written; nothing was changed (fail closed)'); }
}
function readChange(id) {
  try { return JSON.parse(fs.readFileSync(path.join(changesDir(), id + '.json'), 'utf8')); } catch (e) { return null; }
}

function runTool(t, toolId, extraOut) { return runToolImpl(t, toolId, extraOut, false); }
function runToolSoft(t, toolId) { return runToolImpl(t, toolId, null, true); }
function runToolImpl(t, toolId, extraOut, soft) {
  var env = {};
  if (t.env_from_unit) {
    var ue = soft ? softUnitEnv(t.env_from_unit) : unitEnv(t.env_from_unit);
    if (!ue) return null;
    Object.keys(ue).forEach(function (k) {
      var pass = (t.env_prefixes || []).some(function (p) { return k.indexOf(p) === 0; });
      if (!pass) return;
      if (HARD.SECRET_ENV_RE.test(k) && !(/_FILE$/.test(k) && /^\//.test(ue[k]))) return; // raw secrets never travel; *_FILE paths do
      env[k] = ue[k];
    });
  }
  var r = soft ? worker({ action: 'run', bin: t.bin, argv: t.argv, env: env }, t.timeout_ms || 30000)
               : workerOk({ action: 'run', bin: t.bin, argv: t.argv, env: env }, t.timeout_ms || 30000, 'TOOL_FAILED');
  if (!r.ok) return null;
  var text = String(r.stdout || '');
  var recips = t.mask_recipients_from && env[t.mask_recipients_from] ? String(env[t.mask_recipients_from]).split(',').filter(Boolean) : [];
  recips.forEach(function (x) { text = text.split(x).join(mask(x)); });   // never echo a full recipient
  var parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* not JSON */ }
  var res = { tool: toolId, exit: r.status, output: parsed !== null ? parsed : cap(text).text.slice(0, 20000) };
  if (recips.length) res.recipients_masked = recips.map(mask);
  if (r.status !== 0) res.stderr_tail = String(r.stderr || '').slice(-300);
  return Object.assign(res, extraOut || {});
}

function unitState(scope, unit) {
  var props = ['ActiveState', 'SubState', 'Result', 'UnitFileState', 'LoadState', 'Type'];
  var raw;
  if (scope === 'user') {
    var r = workerOk({ action: 'systemctl', args: ['show', unit, '--property=' + props.join(',')] }, 20000, 'UNIT_STATUS_FAILED');
    raw = String(r.stdout || '');
  } else {
    raw = String(run(BIN.systemctl, ['show', unit, '--no-pager', '--property=' + props.join(',')], 15000).stdout || '');
  }
  var o = {};
  raw.split('\n').forEach(function (l) { var ix = l.indexOf('='); if (ix > 0) o[l.slice(0, ix)] = l.slice(ix + 1); });
  return o;
}

// ---- 6. operation implementations --------------------------------------
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
    if (r.status !== 0) fail(4, 'EXEC_FAILED', 'docker inspect failed', { detail: cap(r.stderr).text.slice(0, 400) });
    var st = JSON.parse(r.stdout);
    return { container: a.container, status: st.Status, running: !!st.Running, health: st.Health ? st.Health.Status : null, started_at: st.StartedAt, exit_code: st.ExitCode, oom_killed: !!st.OOMKilled };
  },
  'host.docker.logs': function (a) {
    var r = run(BIN.docker, ['logs', '--tail', a.lines, a.container]);
    if (r.status !== 0) fail(4, 'EXEC_FAILED', 'docker logs failed', { detail: cap(r.stderr).text.slice(0, 400) });
    var so = cap(r.stdout), se = cap(r.stderr);
    return { container: a.container, lines: parseInt(a.lines, 10), stdout: so.text, stderr: se.text, truncated: so.truncated || se.truncated };
  },
  'host.systemd.status': function (a) {
    var props = 'ActiveState,SubState,UnitFileState,MainPID,NRestarts,MemoryCurrent,ExecMainStartTimestamp';
    var r = run(BIN.systemctl, ['show', a.unit, '--no-pager', '--property=' + props]);
    if (r.status !== 0) fail(4, 'EXEC_FAILED', 'systemctl show failed', { detail: cap(r.stderr).text.slice(0, 400) });
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
    try { persisted = JSON.parse(fs.readFileSync(GUARD_FILE, 'utf8')); } catch (e) { /* read-only view; absence is reported, never fatal */ }
    // Reported, never decided here: the guard's own state machine is the authority.
    return {
      signals: { mem_available_mib: Math.round(mem.MemAvailable / 1024), psi_memory_some_avg60: psi === null ? null : parseFloat(psi), oom_kill: vm.oom_kill },
      persisted_level: persisted && persisted.level ? persisted.level : null,
      persisted_at: persisted && persisted.updated_at ? persisted.updated_at : null,
      state_file: GUARD_FILE
    };
  },

  'host.catalog.describe': function () {
    var ops = {};
    Object.keys(CAT.operations).forEach(function (n) {
      var o = CAT.operations[n];
      ops[n] = { helper: o.helper, class: o.class, tier: (CAT.classes[o.class] || {}).tier || null, args: o.args, defaults: o.defaults || undefined,
        timeout_ms: o.timeout_ms || EXEC_TIMEOUT_MS, idempotent: o.idempotent !== false, rollback: o.rollback || null };
    });
    var tools = {};
    Object.keys(CAT.tools || {}).forEach(function (n) { var t = CAT.tools[n]; tools[n] = { tier: t.tier, argv: t.argv, requires_confirm: !!t.requires_confirm, rate_limit: t.rate_limit || null, rollback: t.rollback || null }; });
    var keys = {};
    Object.keys(CAT.config_keys || {}).forEach(function (n) { var c = CAT.config_keys[n]; keys[n] = { unit: c.unit, dropin: c.dropin, env: c.env, item_pattern: c.item_pattern, max_items: c.max_items || 1, masked: !!c.mask }; });
    return { version: VERSION, schema_version: CAT.schema_version, tiers: CAT.tiers, operations: ops, services: CAT.services || {}, containers: CAT.containers || {},
      config_keys: keys, tools: tools, highly_sensitive_operations: CAT.highly_sensitive_operations || {}, limits: CAT.limits || {},
      controlled_enabled: !fs.existsSync(KILL_SWITCH) };
  },
  'host.userunit.status': function (a) {
    return Object.assign({ unit: a.unit, scope: 'user' }, unitState('user', a.unit));
  },
  'host.config.get': function (a) {
    var e = configEntry(a.key);
    var f = readDropin(e);
    var vals = envValues(f.content, e.env);
    var eff = unitEnv(e.unit)[e.env];
    return { key: a.key, unit: e.unit, dropin: e.dropin, env: e.env, occurrences: vals.length,
      file_value: vals.length === 1 ? shown(e, vals[0]) : null, effective_value: shown(e, eff === undefined ? null : eff),
      in_sync: vals.length === 1 && eff === vals[0], masked: !!e.mask, dropin_sha256: f.sha256 };
  },
  'host.change.list': function (a) {
    var d = changesDir();
    var list = fs.readdirSync(d).filter(function (f) { return /\.json$/.test(f); }).map(function (f) {
      try { var c = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
        return { change_id: c.change_id, ts: c.ts, operation: c.operation, key: c.key, before: c.before_shown, after: c.after_shown, task: c.task, rolled_back_at: c.rolled_back_at || null, rollback_of: c.rollback_of || null };
      } catch (e) { return null; }
    }).filter(Boolean).sort(function (x, y) { return x.ts < y.ts ? 1 : -1; });
    return { changes: list.slice(0, parseInt(a.limit, 10) || 20), total: list.length };
  },

  // ---- CONTROLLED --------------------------------------------------------
  'host.config.set': function (a) {
    var e = configEntry(a.key);
    var wanted = normalizeValue(e, a.value);
    var f = readDropin(e);
    var vals = envValues(f.content, e.env);
    if (vals.length !== 1) fail(2, 'CONFIG_AMBIGUOUS', 'drop-in has ' + vals.length + ' Environment=' + e.env + '= lines; exactly one is required (HostOps never adds directives)');
    var old = vals[0];
    var effBefore = unitEnv(e.unit)[e.env];
    var result = { key: a.key, unit: e.unit, dropin: e.dropin, env: e.env, before: shown(e, old), after: shown(e, wanted), masked: !!e.mask };

    if (old === wanted && effBefore === wanted) {
      result.outcome = 'unchanged'; result.changed = false; result.reloaded = false;
      return result;
    }
    var changeId = null;
    if (old !== wanted) {
      var newContent = f.content.replace(envLineRe(e.env), 'Environment=' + e.env + '=' + wanted);
      if (envValues(newContent, e.env).length !== 1 || envValues(newContent, e.env)[0] !== wanted) fail(4, 'CONFIG_RENDER', 'internal: rendered drop-in did not carry exactly the new value');
      changeId = AUDIT_ID;
      var rec = { change_id: changeId, ts: nowIso(), operation: OP.operation, key: a.key, unit: e.unit, dropin: e.dropin, env: e.env, path: e.path,
        before_value: old, after_value: wanted, before_shown: shown(e, old), after_shown: shown(e, wanted),
        before_content: f.content, before_sha256: f.sha256, after_content: newContent, after_sha256: sha256(newContent),
        caller: CALLER, task: TASK, task_verified: TASK_VERIFIED };
      writeChange(rec);                                       // backup BEFORE the write (fail closed)
      workerOk({ action: 'file-replace', path: e.path, content: newContent, expect_sha256: f.sha256 }, 20000, 'CONFIG_WRITE_FAILED');
    }
    // Everything after the write is SOFT: any failure lands in `problems`
    // and goes through the restore path below, never a bare exit.
    var problems = [];
    var verification = { reloaded: softReload(), effective_env: false, tool: null };
    if (!verification.reloaded) problems.push('systemctl --user daemon-reload failed');
    var envNow = verification.reloaded ? softUnitEnv(e.unit) : null;
    verification.effective_env = !!envNow && envNow[e.env] === wanted;
    if (verification.reloaded && !verification.effective_env) problems.push('effective environment does not carry the new value');
    if (verification.effective_env && e.verify_tool && CAT.tools && CAT.tools[e.verify_tool] && CAT.tools[e.verify_tool].tier === 'NORMAL') {
      var tr = softTool(CAT.tools[e.verify_tool], e.verify_tool);
      var p = tr && tr.output && Array.isArray(tr.output.problems) ? tr.output.problems : null;
      verification.tool = tr ? { tool: e.verify_tool, exit: tr.exit, problems: p, recipients_configured: tr.output && tr.output.recipients_configured, recipients_masked: tr.recipients_masked } : { tool: e.verify_tool, exit: null };
      if (!tr || tr.exit !== 0) problems.push(e.verify_tool + ' did not run cleanly');
      else if (p && p.length) problems.push(e.verify_tool + ' reports: ' + p.join('; ').slice(0, 200));
    }
    result.verification = verification;

    if (problems.length && changeId) {
      // automatic rollback: restore the backed-up content (compare-and-swap
      // against what we wrote), reload, and confirm the old value is back.
      var back = worker({ action: 'file-replace', path: e.path, content: f.content, expect_sha256: sha256(newContent) }, 20000);
      var restored = false;
      if (back.ok && softReload()) { var envBack = softUnitEnv(e.unit); restored = !!envBack && envBack[e.env] === old; }
      var c = readChange(changeId); if (c) { c.rolled_back_at = nowIso(); c.rolled_back_by = 'automatic (verification failed)'; writeChange(c); }
      fail(4, restored ? 'VERIFY_FAILED_ROLLED_BACK' : 'VERIFY_FAILED_ROLLBACK_FAILED', 'verification failed: ' + problems.join('; ').slice(0, 300) + (restored ? ' — previous value restored' : ' — ROLLBACK DID NOT CONFIRM; owner attention needed'),
        { rolled_back: restored, result: result, audit: { problems: problems, restored: restored } });
    }
    if (problems.length) fail(4, 'VERIFY_FAILED', 'verification failed: ' + problems.join('; ').slice(0, 300), { result: result });
    result.outcome = changeId ? 'changed' : 'reloaded';
    result.changed = !!changeId; result.reloaded = true; result.change_id = changeId;
    if (changeId) result.rollback = 'mythos-hostops change-rollback --change ' + changeId;
    return result;
  },

  'host.systemd.user_daemon_reload': function () {
    userDaemonReload();
    return { outcome: 'executed', scope: 'user', user: RUN_AS };
  },

  'host.service.control': function (a) {
    var scope = null, entry = null;
    if (CAT.services && CAT.services.user && CAT.services.user[a.unit]) { scope = 'user'; entry = CAT.services.user[a.unit]; }
    else if (CAT.services && CAT.services.system && CAT.services.system[a.unit]) { scope = 'system'; entry = CAT.services.system[a.unit]; }
    if (!entry) fail(2, 'SERVICE_NOT_CATALOGUED', 'unit ' + a.unit + ' is not declared in the services catalog');
    if (HARD.PROTECTED_UNIT_RE.test(a.unit)) fail(2, 'PROTECTED_UNIT', 'unit ' + a.unit + ' is protected; HostOps never controls it');
    if ((CAT.protected_units_never_restartable || []).some(function (u) { return u === a.unit || u === a.unit.replace(/\.service$/, ''); })) fail(2, 'PROTECTED_UNIT', 'unit ' + a.unit + ' is on the catalog protected list');
    if (a.action === 'stop' && HARD.NO_STOP_RE.test(a.unit)) fail(2, 'HIGHLY_SENSITIVE', 'stopping ' + a.unit + ' disables a security, backup, monitoring or control-channel function; owner-only');
    if ((entry.actions || []).indexOf(a.action) === -1) fail(2, 'ACTION_NOT_ALLOWED', 'action ' + a.action + ' is not allowed for ' + a.unit);

    var before = unitState(scope, a.unit);
    if (before.LoadState && before.LoadState !== 'loaded') fail(4, 'UNIT_NOT_LOADED', a.unit + ' LoadState=' + before.LoadState);
    var verify = entry.verify || 'active';
    if (a.action === 'stop' && (before.ActiveState === 'inactive' || before.ActiveState === 'failed')) return { unit: a.unit, scope: scope, action: a.action, outcome: 'unchanged', before: before, after: before };
    if (a.action === 'start' && verify === 'active' && before.ActiveState === 'active') return { unit: a.unit, scope: scope, action: a.action, outcome: 'unchanged', before: before, after: before };

    var r;
    if (scope === 'user') r = workerOk({ action: 'systemctl', args: [a.action, a.unit] }, OP.timeout_ms, 'SERVICE_CONTROL_FAILED');
    else r = run(BIN.systemctl, [a.action, a.unit], OP.timeout_ms);
    if (r.status !== 0) fail(4, 'SERVICE_CONTROL_FAILED', 'systemctl ' + a.action + ' ' + a.unit + ' exited ' + r.status, { detail: String(r.stderr || '').slice(0, 300) });

    var want = a.action === 'stop' ? /^(inactive|failed)$/ : (verify === 'oneshot' ? /^(inactive|active|activating)$/ : /^active$/);
    var after = before, deadline = Date.now() + 15000;
    do { after = unitState(scope, a.unit); if (want.test(after.ActiveState)) break; sleepMs(500); } while (Date.now() < deadline);
    var ok = want.test(after.ActiveState) && !(verify === 'oneshot' && a.action !== 'stop' && after.Result && after.Result !== 'success');
    var res = { unit: a.unit, scope: scope, action: a.action, outcome: ok ? 'executed' : 'unverified', before: before, after: after,
      rollback: a.action === 'stop' ? 'mythos-hostops service-control --unit ' + a.unit + ' --action start' : 'none (start/restart is self-healing)' };
    if (!ok) fail(4, 'VERIFY_FAILED', a.unit + ' did not reach the expected state after ' + a.action + ' (ActiveState=' + after.ActiveState + ', Result=' + after.Result + ')', { result: res });
    return res;
  },

  'host.docker.restart': function (a) {
    var entry = (CAT.containers || {})[a.container];
    if (!entry) fail(2, 'CONTAINER_NOT_CATALOGUED', 'container ' + a.container + ' is not declared in the containers catalog');
    if (HARD.PROTECTED_CONTAINER_RE.test(a.container)) fail(2, 'PROTECTED_CONTAINER', 'container ' + a.container + ' is a data/identity store; HostOps never restarts it');
    if ((entry.actions || []).indexOf('restart') === -1) fail(2, 'ACTION_NOT_ALLOWED', 'restart is not allowed for ' + a.container);
    var r = run(BIN.docker, ['restart', '--time', '20', a.container], OP.timeout_ms);
    if (r.status !== 0) fail(4, 'EXEC_FAILED', 'docker restart failed', { detail: cap(r.stderr).text.slice(0, 300) });
    var st = null, deadline = Date.now() + 20000;
    do {
      var i = run(BIN.docker, ['inspect', '--format', '{{json .State}}', a.container], 10000);
      try { st = JSON.parse(i.stdout); } catch (e) { st = null; }
      if (st && st.Running) break; sleepMs(500);
    } while (Date.now() < deadline);
    var res = { container: a.container, outcome: st && st.Running ? 'executed' : 'unverified', running: !!(st && st.Running), health: st && st.Health ? st.Health.Status : null, started_at: st ? st.StartedAt : null, rollback: 'none (restart is self-healing)' };
    if (!res.running) fail(4, 'VERIFY_FAILED', a.container + ' is not running after restart', { result: res });
    return res;
  },

  'host.tool.run': function (a) {
    var t = TOOL;          // resolved + gated in section 7
    var res = runTool(t, a.tool, { tier: t.tier, argv: t.argv });
    res.outcome = res.exit === 0 ? 'executed' : 'failed';
    if (res.exit !== 0) fail(4, 'TOOL_FAILED', 'tool ' + a.tool + ' exited ' + res.exit, { result: res });
    return res;
  },

  'host.change.rollback': function (a) {
    var c = readChange(a.change);
    if (!c) fail(2, 'CHANGE_UNKNOWN', 'no recorded change ' + a.change);
    if (c.rolled_back_at) return { change: a.change, outcome: 'unchanged', note: 'already rolled back at ' + c.rolled_back_at };
    var e = configEntry(c.key);
    if (e.path !== c.path) fail(2, 'CHANGE_TARGET_MOVED', 'the catalog no longer maps ' + c.key + ' to the recorded file');
    var f = readDropin(e);
    if (f.sha256 !== c.after_sha256) fail(2, 'CHANGE_CONFLICT', 'the drop-in changed after ' + a.change + '; refusing to overwrite a later change (roll back the later change first)');
    var rec = { change_id: AUDIT_ID, ts: nowIso(), operation: OP.operation, rollback_of: a.change, key: c.key, unit: c.unit, dropin: c.dropin, env: c.env, path: c.path,
      before_value: c.after_value, after_value: c.before_value, before_shown: c.after_shown, after_shown: c.before_shown,
      before_content: f.content, before_sha256: f.sha256, after_content: c.before_content, after_sha256: c.before_sha256, caller: CALLER, task: TASK, task_verified: TASK_VERIFIED };
    writeChange(rec);
    workerOk({ action: 'file-replace', path: e.path, content: c.before_content, expect_sha256: f.sha256 }, 20000, 'ROLLBACK_WRITE_FAILED');
    userDaemonReload();
    var eff = unitEnv(e.unit)[e.env];
    var ok = eff === c.before_value;
    c.rolled_back_at = nowIso(); c.rolled_back_by = AUDIT_ID; writeChange(c);
    var res = { change: a.change, key: c.key, outcome: ok ? 'rolled_back' : 'unverified', restored: shown(e, c.before_value), effective_env_restored: ok, change_id: AUDIT_ID };
    if (!ok) fail(4, 'VERIFY_FAILED', 'rollback written but the effective environment does not carry the restored value', { result: res });
    return res;
  }
};

// ---- 7. CONTROLLED gates -----------------------------------------------
var TOOL = null;
if (OP.helper === 'tool-run') {
  TOOL = (CAT.tools || {})[SAFE_ARGS.tool];
  if (!TOOL) fail(2, 'TOOL_UNKNOWN', 'tool "' + SAFE_ARGS.tool + '" is not declared in the catalog');
  var binNorm = path.normalize(String(TOOL.bin || ''));
  if (binNorm !== TOOL.bin || !TOOL_ROOTS.some(function (r) { return binNorm.indexOf(r) === 0; })) fail(2, 'HARD_TOOL_ROOT', 'tool binary is outside the approved roots');
  if (!Array.isArray(TOOL.argv) || TOOL.argv.some(function (x) { return !HARD.TOOL_ARG_RE.test(String(x)); })) fail(2, 'HARD_TOOL_ARGV', 'tool argv fails the character net');
  if (TOOL.tier !== 'NORMAL' && TOOL.tier !== 'CONTROLLED') fail(2, TOOL.tier === 'HIGHLY_SENSITIVE' ? 'HIGHLY_SENSITIVE' : 'TOOL_TIER', 'tool ' + SAFE_ARGS.tool + ' has tier ' + TOOL.tier + '; not executable');
  if (TOOL.requires_confirm && SAFE_ARGS.confirm !== 'yes') fail(2, 'CONFIRM_REQUIRED', 'tool ' + SAFE_ARGS.tool + ' has a real outward effect; pass --confirm yes');
  TIER = TOOL.tier;                                   // effective tier of this call
}

function verifyTask() {
  if (!TASK.task_id) return null;
  try {
    var st = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, TASK.task_id, 'status.json'), 'utf8'));
    return st && st.status === 'RUNNING';
  } catch (e) { return false; }
}

function rateFile() { return path.join(AUDIT_HOME, 'rate.json'); }
function loadRate() { try { return JSON.parse(fs.readFileSync(rateFile(), 'utf8')); } catch (e) { return { controlled: [], tools: {} }; } }

function acquireLock() {
  var p = path.join(AUDIT_HOME, 'controlled.lock');
  var stale = ((CAT.limits && CAT.limits.lock_stale_seconds) || 300) * 1000;
  try { fs.mkdirSync(AUDIT_HOME, { recursive: true, mode: 448 }); } catch (e) { fail(5, 'AUDIT_UNAVAILABLE', 'the HostOps ledger directory is unusable (' + e.code + '); nothing was executed (fail closed)'); }
  for (var attempt = 0; attempt < 2; attempt++) {
    try { var fd = fs.openSync(p, 'wx', 384); fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now(), audit_id: AUDIT_ID })); fs.closeSync(fd); LOCK_HELD = true; return; }
    catch (e) {
      if (e.code !== 'EEXIST') fail(5, 'AUDIT_UNAVAILABLE', 'lock file could not be created: ' + e.code);
      var holder = null; try { holder = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e2) { /* unreadable */ }
      var alive = false; try { if (holder && holder.pid) { process.kill(holder.pid, 0); alive = true; } } catch (e3) { alive = e3.code === 'EPERM'; }
      if (holder && alive && Date.now() - holder.ts < stale) fail(4, 'LOCKED', 'another CONTROLLED HostOps operation is running (' + holder.audit_id + '); retry shortly');
      try { fs.unlinkSync(p); } catch (e4) { /* raced */ }
    }
  }
  fail(4, 'LOCKED', 'could not acquire the CONTROLLED lock');
}

if (TIER === 'CONTROLLED') {
  if (fs.existsSync(KILL_SWITCH)) fail(2, 'CONTROLLED_DISABLED', 'the owner kill switch ' + KILL_SWITCH + ' is present; CONTROLLED operations are disabled (READ still works)');
  if (UNDER_SUDO && !TASK.task_id && !TASK.github_task_id && !TASK.othmode_task_id) {
    fail(2, 'ATTRIBUTION_REQUIRED', 'CONTROLLED operations from ' + SUDO_USER + ' must carry --task-id, --github-task or --othmode-task');
  }
  TASK_VERIFIED = verifyTask();
  if (!PRESSURE_EXEMPT[OP.helper]) {
    var lvl = null; try { lvl = JSON.parse(fs.readFileSync(GUARD_FILE, 'utf8')).level; } catch (e) { /* unknown → admit, like the executor */ }
    if (lvl === 'CRITICAL') fail(4, 'RESOURCE_PRESSURE', 'Resource Guard level is CRITICAL; CONTROLLED operation deferred');
  }
  acquireLock();
  var rate = loadRate(), hourAgo = Date.now() - 3600 * 1000;
  rate.controlled = (rate.controlled || []).filter(function (x) { return x > hourAgo; });
  var perHour = (CAT.limits && CAT.limits.controlled_per_hour) || 120;
  if (rate.controlled.length >= perHour) fail(4, 'RATE_LIMITED', 'CONTROLLED operations are limited to ' + perHour + ' per hour');
  if (TOOL && TOOL.rate_limit) {
    var win = Date.now() - TOOL.rate_limit.per_seconds * 1000;
    var used = ((rate.tools || {})[SAFE_ARGS.tool] || []).filter(function (x) { return x > win; });
    if (used.length >= TOOL.rate_limit.max) fail(4, 'RATE_LIMITED', 'tool ' + SAFE_ARGS.tool + ' is limited to ' + TOOL.rate_limit.max + ' per ' + TOOL.rate_limit.per_seconds + 's');
  }
  // INTENT record: nothing CONTROLLED executes unless this line is on disk.
  try {
    var intent = baseEvent('intent', 'pending'); intent.timeout_ms = OP.timeout_ms;
    auditAppend(intent);
  } catch (e) { fail(5, 'AUDIT_UNAVAILABLE', 'the intent audit record could not be written; nothing was executed (fail closed)'); }
  rate.controlled.push(Date.now());
  if (TOOL && TOOL.rate_limit) { rate.tools = rate.tools || {}; rate.tools[SAFE_ARGS.tool] = ((rate.tools[SAFE_ARGS.tool] || []).filter(function (x) { return x > hourAgo; })).concat([Date.now()]); }
  try { fs.writeFileSync(rateFile(), JSON.stringify(rate), { mode: 384 }); } catch (e) { fail(5, 'AUDIT_UNAVAILABLE', 'rate state could not be written; nothing was executed (fail closed)'); }
}

// ---- 8. execute ---------------------------------------------------------
var result = IMPL[OP.operation](SAFE_ARGS);

// ---- 9. audit (fail closed on success path) ----------------------------
var event = baseEvent('result', result && result.outcome ? result.outcome : 'ok');
event.exit = 0; event.duration_ms = Date.now() - START;
if (result && result.change_id) event.change_id = result.change_id;
if (OP.helper === 'config-set' && result) event.detail = { before: result.before, after: result.after, verification: result.verification };
if (OP.helper === 'service-control' && result) event.detail = { before: result.before && result.before.ActiveState, after: result.after && result.after.ActiveState };
try { auditAppend(event); } catch (e) {
  releaseLock();
  out({ ok: false, version: VERSION, audit_id: AUDIT_ID, error: { code: 'AUDIT_UNAVAILABLE', message: 'operation completed but its audit record could not be written; result withheld (fail closed)' } });
  process.exit(5);
}
releaseLock();

out({ ok: true, version: VERSION, audit_id: AUDIT_ID, operation: OP.operation, class: OP.class, tier: TIER, args: AUDIT_ARGS, task: TASK,
  task_verified: TASK_VERIFIED, duration_ms: Date.now() - START, result: result });
