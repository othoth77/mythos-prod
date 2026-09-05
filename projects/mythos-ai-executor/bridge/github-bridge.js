'use strict';
// =====================================================
// MYTHOS GitHub control bridge
// projects/mythos-ai-executor/bridge/github-bridge.js
//
// The smallest reliable bridge between an external planner (ChatGPT, the
// owner, any AI that can read and write files in GitHub) and the existing
// MYTHOS execution system:
//
//   ChatGPT ──writes──▶ control/tasks/<id>.json   (branch mythos/control, GitHub)
//                              │
//                     bridge tick (this file, runs as deploy on the VPS)
//                              │  fetch + fast-forward/rebase the control branch
//                              │  validate the task (schema, allowed fields, no secrets)
//                              │  create the OTHMODE Task record (RUNNING)
//                              │  create an isolated worktree + branch mythos/gh/<id>
//                              │  executor.createTask(...)   ← the ONE executor, unchanged
//                              │  commit the CLAIM into the task file
//                              ▼
//   mythos-ai-executor daemon runs `claude -p` (othmode contract, profile-bounded)
//                              │
//                     bridge tick maps executor status → task status,
//                     writes control/reports/<id>.json + .md, closes the
//                     OTHMODE record, regenerates control/state.json
//                              │
//   mythos-git-push relay (root, governance-verified, fast-forward only)
//   delivers refs/heads/mythos/* — the control branch AND the task branch
//                              ▼
//   ChatGPT ──reads──▶ control/state.json, control/reports/<id>.json → next task
//
// What this file deliberately does NOT do:
//   - it never runs a provider itself (executor.runTask/tick stay the only
//     execution path; the daemon picks the queued task up on its own tick);
//   - it never pushes (delivery is the root relay, so the governance cage
//     applies to every control commit exactly like any other commit);
//   - it never honours provider / working_directory / tool / MCP /
//     credential selection from a task file: requested_action maps to an
//     execution profile server-side, and everything else is data. The one
//     thing a task MAY choose (Issue #100) is `model`: it selects an entry
//     in the server-side catalog (config/model-policy.json), the executor
//     refuses an unknown or unavailable one rather than substituting, and
//     the choice grants no authority. A task that names none gets the model
//     lib/model-policy.js scores for it — never the CLI's own default;
//   - it never re-executes a task whose claim exists but whose executor
//     record is gone (host or store loss): that task is BLOCKED for a human,
//     because "never silently execute twice" outranks "always finish".
//
// GitHub Issues intake: bridge/github-issues.js converts Issues labelled
// `task` into control/tasks files and reports back on the Issue; the bridge
// itself is unchanged by that layer (a task from an Issue carries `source`).
//
// State of record: the control branch on GitHub. Local files under
// MYTHOS_EXECUTOR_HOME/bridge/ are a cache for crash recovery between
// "executor task created" and "claim committed" — never the authority.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var crypto = require('crypto');

var EXEC_ROOT = path.join(__dirname, '..');
var state = require(path.join(EXEC_ROOT, 'lib', 'state'));
var modelPolicy = require(path.join(EXEC_ROOT, 'lib', 'model-policy'));
var reporting = require(path.join(EXEC_ROOT, 'lib', 'report'));
// THE action/profile/model decision engine (shared with the Issues adapter and
// the executor). PROFILE_BY_ACTION is re-exported from here for callers that
// imported it from the bridge; the map itself has exactly one home.
var engine = require('./action-resolution');
var schema = require(path.join(EXEC_ROOT, '..', 'mythos-orchestrator', 'lib', 'schema'));
var redact = require(path.join(EXEC_ROOT, '..', 'mythos-orchestrator', 'lib', 'redact'));
// Notification sink. It is enqueue-only inside the tick (synchronous, local,
// no network) and delivers out of band from flushNotifications(), so no
// provider outage can reach the execution path. Disabled unless configured.
var whatsapp = require(path.join(__dirname, 'notify', 'whatsapp'));
// Execution lifecycle: the bridge links the executor task to its GitHub
// Issue/control id at claim time and records REPORT_SUBMITTED when the
// control report exists. Evidence only — it never closes anything.
var lifecycle = require(path.join(EXEC_ROOT, 'lib', 'lifecycle'));

var TASK_SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'schemas', 'task.schema.json'), 'utf8'));
var REPORT_SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'schemas', 'report.schema.json'), 'utf8'));

var PROTOCOL = 'mythos-control/1';
var BY = 'github-bridge';
var TASK_ID_RE = /^[a-z0-9][a-z0-9-]{4,38}[a-z0-9]$/;
// A task id becomes a file name and a branch name. Names that would trip
// the root-owned governance path patterns (credential / secret / .env /
// .ssh / sudoers) are refused so a control commit can never be DENIED by
// the relay because of its own file name.
var FORBIDDEN_ID_RE = /credential|secret|\.env|\.ssh|sudoers/i;

var TASK_STATUSES = ['PENDING', 'CLAIMED', 'IN_PROGRESS', 'VALIDATING', 'COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED'];
var TERMINAL = ['COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED'];
// Statuses an EXTERNAL writer may put in a task file. Anything else in a
// file the bridge has never claimed is a forged state and fails validation.
var CREATOR_STATUSES = ['PENDING', 'CANCELLED'];

// requested_action → execution profile. Server-side and closed: a task can
// never name a profile, and `autonomous` / `deploy` are not reachable from
// GitHub at all (deploy is disabled in lib/policy.js regardless). Owned by
// bridge/action-resolution.js; enforced there as ACTION_PROFILE_MISMATCH.
var PROFILE_BY_ACTION = engine.PROFILE_BY_ACTION;
var DELIVERY_BY_ACTION = engine.DELIVERY_BY_ACTION;

// executor status → control status
var STATUS_MAP = {
  QUEUED: 'CLAIMED',
  RUNNING: 'IN_PROGRESS',
  WAITING_FOR_QUOTA: 'IN_PROGRESS',
  WAITING_RETRY: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
  CANCELLED: 'CANCELLED'
};

// --- Configuration -------------------------------------------------------------

function config() {
  var executorHome = state.root();
  return {
    project: process.env.MYTHOS_BRIDGE_PROJECT || 'mythos-prod',
    // The main repository (shared checkout). Only used for `git worktree add`
    // and `git fetch` — the bridge never commits there.
    repo: process.env.MYTHOS_BRIDGE_REPO || '/home/deploy/projects/mythos-prod',
    // Linked worktree holding the control branch.
    controlDir: process.env.MYTHOS_BRIDGE_CONTROL_DIR || '/home/deploy/worktrees/control',
    branch: process.env.MYTHOS_BRIDGE_BRANCH || 'mythos/control',
    prefix: process.env.MYTHOS_BRIDGE_PREFIX || 'control',
    remote: 'origin',
    baseRef: process.env.MYTHOS_BRIDGE_BASE_REF || 'origin/main',
    taskWorktrees: process.env.MYTHOS_BRIDGE_TASK_WORKTREES || path.join(executorHome, 'worktrees', 'gh'),
    home: process.env.MYTHOS_BRIDGE_HOME || path.join(executorHome, 'bridge'),
    author: 'MYTHOS GitHub Bridge <bridge@mythosprod.xyz>',
    claimedBy: BY + '@' + os.hostname(),
    intervalMs: parseInt(process.env.MYTHOS_BRIDGE_INTERVAL_MS || '120000', 10),
    // A bridge lock whose owner stopped heart-beating for this long is taken
    // over (fenced) even if its pid still exists — a hung tick must not stall
    // the channel forever, and the fenced-out worker can no longer commit.
    lockStaleMs: parseInt(process.env.MYTHOS_BRIDGE_LOCK_STALE_MS || String(15 * 60 * 1000), 10),
    // Claim lease grace beyond the executor timeout (informational on the
    // task file: a lease past expiry is reported, never silently re-claimed).
    leaseGraceMs: parseInt(process.env.MYTHOS_BRIDGE_LEASE_GRACE_MS || String(30 * 60 * 1000), 10),
    // With MYTHOS_BRIDGE_EXPECTED_HEAD set, a checkout whose HEAD is not that
    // commit is a runtime identity mismatch; MYTHOS_BRIDGE_STRICT_RUNTIME=1
    // additionally refuses new claims until it is fixed.
    expectedHead: process.env.MYTHOS_BRIDGE_EXPECTED_HEAD || null,
    strictRuntime: process.env.MYTHOS_BRIDGE_STRICT_RUNTIME === '1',
    // A bridge whose own checkout cannot be identified (or contradicts the
    // configured HEAD) makes no new claims — a task must never run on code
    // nobody can name. MYTHOS_BRIDGE_ALLOW_UNVERIFIED_RUNTIME=1 is the
    // explicit opt-out for an installation outside a git checkout.
    allowUnverifiedRuntime: process.env.MYTHOS_BRIDGE_ALLOW_UNVERIFIED_RUNTIME === '1'
  };
}

// Pure: runtime identity + configuration → may this tick claim new tasks?
// { claims_allowed, code, reason, mode }
//
//   RUNTIME_IDENTITY_UNVERIFIED  refuse (unless allowUnverifiedRuntime)
//   RUNTIME_IDENTITY_MISMATCH    refuse — the operator named the HEAD that must run
//   RUNTIME_STALE_CHECKOUT       allow, noted on every claim and report; refuse under
//                                strictRuntime (a deployed service is legitimately
//                                behind origin/main between a merge and its restart,
//                                so this alone must not stall the channel)
//
// A refusal is a deferral, not a terminal state: the task stays PENDING with
// the reason on the tick, in the bridge log and in the STATE.md notes, and
// is claimed by the first tick whose runtime verifies.
function runtimeGate(runtime, cfg) {
  cfg = cfg || config();
  runtime = runtime || {};
  var out = { claims_allowed: true, code: runtime.code || null, reason: runtime.reason || null, mode: cfg.strictRuntime ? 'strict' : 'default' };
  if (!runtime.code) return out;
  if (runtime.code === engine.BLOCKER_CODES.RUNTIME_IDENTITY_UNVERIFIED) {
    out.claims_allowed = cfg.allowUnverifiedRuntime === true;
    out.reason = (out.claims_allowed ? 'MYTHOS_BRIDGE_ALLOW_UNVERIFIED_RUNTIME=1: claiming from an unverifiable checkout — ' : 'no new claims: the running bridge cannot prove which checkout/commit it is — ') + (runtime.reason || '');
    return out;
  }
  if (runtime.code === 'RUNTIME_IDENTITY_MISMATCH') {
    out.claims_allowed = false;
    out.reason = 'no new claims: ' + (runtime.reason || 'runtime identity mismatch');
    return out;
  }
  // RUNTIME_STALE_CHECKOUT (or any future advisory code)
  out.claims_allowed = !cfg.strictRuntime;
  out.reason = (out.claims_allowed ? 'claims continue (recorded on each claim/report): ' : 'MYTHOS_BRIDGE_STRICT_RUNTIME=1: no new claims until the runtime identity is fixed — ') + (runtime.reason || '');
  return out;
}

// --- Runtime identity (which code is actually running) ---------------------------------
//
// A report that cannot say which checkout, branch and commit produced it is
// not evidence. This is measured from the module's own location (never from
// configuration), so a bridge started from a stale worktree or a duplicate
// installation identifies itself as such on every claim and every report.
function runtimeIdentity(cfg) {
  cfg = cfg || config();
  var dir = __dirname;
  var top = git(dir, ['rev-parse', '--show-toplevel']);
  var head = git(dir, ['rev-parse', 'HEAD']);
  var branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  var dirty = top.ok ? git(dir, ['status', '--porcelain', '--', path.join(top.out, 'projects', 'mythos-ai-executor')]) : { ok: false, out: '' };
  var base = git(dir, ['rev-parse', '--verify', '--quiet', cfg.baseRef]);
  var out = {
    module: __filename,
    checkout: top.ok ? top.out : null,
    head: head.ok ? head.out : null,
    branch: branch.ok ? branch.out : null,
    dirty_files: dirty.ok && dirty.out ? dirty.out.split('\n').filter(Boolean).length : 0,
    base_ref: cfg.baseRef,
    base_ref_head: base.ok ? base.out : null,
    expected_head: cfg.expectedHead,
    host: os.hostname(),
    user: (function () { try { return os.userInfo().username; } catch (e) { return null; } })(),
    node: process.version,
    verified: !!(top.ok && head.ok),
    stale: false,
    code: null,
    reason: null,
    measured_at: nowIso()
  };
  if (!out.verified) {
    out.code = engine.BLOCKER_CODES.RUNTIME_IDENTITY_UNVERIFIED;
    out.reason = 'cannot resolve the git checkout/HEAD of ' + dir + ': ' + (top.error || head.error || 'unknown');
  } else if (cfg.expectedHead && out.head.indexOf(cfg.expectedHead) !== 0) {
    out.stale = true;
    out.code = 'RUNTIME_IDENTITY_MISMATCH';
    out.reason = 'running from ' + out.head.slice(0, 12) + ' on ' + out.branch + ' but MYTHOS_BRIDGE_EXPECTED_HEAD=' + cfg.expectedHead.slice(0, 12);
  } else if (base.ok && base.out !== out.head && git(dir, ['merge-base', '--is-ancestor', out.head, base.out]).ok) {
    out.stale = true;
    out.code = 'RUNTIME_STALE_CHECKOUT';
    out.reason = 'checkout HEAD ' + out.head.slice(0, 12) + ' is behind ' + cfg.baseRef + ' ' + base.out.slice(0, 12) + ' — the running bridge is older than what is delivered';
  }
  return out;
}

// F3 — user guard. The bridge shares the executor's store (task queue,
// worktrees, claims cache, lock) by running as the executor's user. Run as
// anyone else it would queue tasks in a store the daemon never reads and
// commit claims that can only degrade to BLOCKED. Refuse, loudly.
var EXPECTED_USER_DEFAULT = 'deploy';

function userGuard() {
  var expected = process.env.MYTHOS_BRIDGE_USER || EXPECTED_USER_DEFAULT;
  var actual;
  try { actual = os.userInfo().username; } catch (e) { actual = String(process.getuid ? process.getuid() : 'unknown'); }
  if (actual !== expected) {
    throw new Error('BRIDGE_WRONG_USER: the bridge must run as "' + expected + '" (the executor user, whose store is ' +
      state.root() + '); it is running as "' + actual + '". Run it via `sudo -u ' + expected + '` or the ' +
      'mythos-github-bridge user timer. MYTHOS_BRIDGE_USER exists for isolated test fixtures only.');
  }
  return actual;
}

// --- Small helpers -------------------------------------------------------------

function nowIso() { return new Date().toISOString(); }

function git(cwd, args, opts) {
  opts = opts || {};
  try {
    var out = cp.execFileSync('git', args, {
      cwd: cwd, encoding: 'utf8', timeout: opts.timeout || 120000,
      stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, opts.env || {})
    });
    return { ok: true, out: (out || '').trim() };
  } catch (e) {
    return { ok: false, out: '', error: String((e.stderr || e.message || '')).trim().slice(0, 600) };
  }
}

function sha256(text) { return crypto.createHash('sha256').update(String(text)).digest('hex'); }

function readJsonFile(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function writeJsonRedacted(file, value) {
  writeAtomic(file, JSON.stringify(redact.redactValue(value), null, 2) + '\n');
}

function isValidTaskId(id) {
  return typeof id === 'string' && TASK_ID_RE.test(id) && !FORBIDDEN_ID_RE.test(id) && id.indexOf('..') === -1;
}

function safeName(name) {
  var s = String(name || '').toLowerCase().replace(/\.json$/, '').replace(/[^a-z0-9-]/g, '-').slice(0, 30);
  return 'invalid-' + (s || 'file');
}

function log(event, fields) {
  var entry = Object.assign({ ts: nowIso(), bridge: event }, fields || {});
  var line = JSON.stringify(redact.redactValue(entry));
  console.log(line);
  try {
    var cfg = config();
    fs.mkdirSync(cfg.home, { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(cfg.home, 'events.log'), line + '\n', { mode: 0o600 });
  } catch (e) { /* logging must never break the tick */ }
}

// --- Paths on the control branch ---------------------------------------------------

function paths(cfg) {
  var root = path.join(cfg.controlDir, cfg.prefix);
  return {
    root: root,
    tasks: path.join(root, 'tasks'),
    reports: path.join(root, 'reports'),
    stateJson: path.join(root, 'state.json'),
    stateMd: path.join(root, 'STATE.md'),
    rel: function (abs) { return path.relative(cfg.controlDir, abs); }
  };
}

function taskFile(cfg, id) { return path.join(paths(cfg).tasks, id + '.json'); }
function reportFile(cfg, id, ext) { return path.join(paths(cfg).reports, id + '.' + (ext || 'json')); }

// --- Lock, lease and fencing (one bridge process per store) --------------------------------
//
// The lock is the claim lease for a tick. It carries a monotonically
// increasing FENCE token (cfg.home/fence.json). A lock whose owner is dead or
// has not heart-beaten within lockStaleMs is taken over with a higher fence;
// the fenced-out worker's later commitControl() calls are refused
// (STALE_WORKER), so a hung or resumed old tick can never write over a newer
// one. Pattern borrowed from Temporal/Hatchet worker leases; no dependency.
var CURRENT_LOCK = null; // { file, pid, fence }

function lockFile(cfg) { return path.join(cfg.home, 'bridge.lock'); }
function fenceFile(cfg) { return path.join(cfg.home, 'fence.json'); }

function readLock(file) {
  if (!fs.existsSync(file)) return null;
  var raw = fs.readFileSync(file, 'utf8').trim();
  if (/^\d+$/.test(raw)) return { pid: parseInt(raw, 10), fence: 0, legacy: true, acquired_at: null, heartbeat_at: null, host: null };
  try { var j = JSON.parse(raw); return j && typeof j === 'object' ? j : null; } catch (e) { return null; }
}

// Strictly greater than both the persisted counter AND the fence on the lock
// being taken over, so a fenced-out worker can never hold the highest token.
function nextFence(cfg, atLeast) {
  var f = fenceFile(cfg);
  var cur = 0;
  try { cur = parseInt((readJsonFile(f) || {}).fence, 10) || 0; } catch (e) { cur = 0; }
  var next = Math.max(cur, parseInt(atLeast, 10) || 0) + 1;
  writeAtomic(f, JSON.stringify({ fence: next, updated_at: nowIso(), by: process.pid }) + '\n');
  return next;
}

function acquireLock(cfg) {
  fs.mkdirSync(cfg.home, { recursive: true, mode: 0o700 });
  var file = lockFile(cfg);
  var held = readLock(file);
  if (held && held.pid !== process.pid) {
    var alive = state.processAlive(held.pid);
    var beat = Date.parse(held.heartbeat_at || held.acquired_at || '');
    var age = isFinite(beat) ? Date.now() - beat : null;
    var stale = !alive || (age !== null && age > cfg.lockStaleMs);
    if (!stale) return null;
    log('lock_takeover', { previous_pid: held.pid, previous_fence: held.fence || 0, alive: alive, age_ms: age, reason: alive ? 'heartbeat older than lockStaleMs' : 'owner process gone' });
  }
  var fence = nextFence(cfg, held ? held.fence : 0);
  var rec = { pid: process.pid, host: os.hostname(), fence: fence, acquired_at: nowIso(), heartbeat_at: nowIso() };
  fs.writeFileSync(file, JSON.stringify(rec), { mode: 0o600 });
  CURRENT_LOCK = { file: file, pid: process.pid, fence: fence };
  return file;
}

function heartbeatLock(cfg) {
  if (!CURRENT_LOCK) return false;
  var held = readLock(CURRENT_LOCK.file);
  if (!held || held.pid !== process.pid || held.fence !== CURRENT_LOCK.fence) return false;
  held.heartbeat_at = nowIso();
  fs.writeFileSync(CURRENT_LOCK.file, JSON.stringify(held), { mode: 0o600 });
  return true;
}

// Throws STALE_WORKER when this process once held the lock but has been
// fenced out since (a newer worker took it over). A process that never
// locked (init, offline tooling) is not fenced.
function assertLockOwned(cfg) {
  if (!CURRENT_LOCK) return { owned: null, fence: null };
  var held = readLock(CURRENT_LOCK.file);
  if (!held || held.pid !== process.pid || held.fence !== CURRENT_LOCK.fence) {
    var e = new Error('STALE_WORKER: this bridge process (pid ' + process.pid + ', fence ' + CURRENT_LOCK.fence + ') no longer holds the bridge lock (' +
      (held ? 'now pid ' + held.pid + ', fence ' + held.fence : 'lock released') + ') — refusing to commit');
    e.code = engine.BLOCKER_CODES.STALE_WORKER;
    throw e;
  }
  return { owned: true, fence: CURRENT_LOCK.fence };
}

function currentFence() { return CURRENT_LOCK ? CURRENT_LOCK.fence : null; }

function releaseLock(lock) {
  try {
    if (lock) {
      var held = readLock(lock);
      // Never delete a lock a newer worker now owns.
      if (!held || held.pid === process.pid) fs.unlinkSync(lock);
    }
  } catch (e) { /* gone */ }
  if (CURRENT_LOCK && CURRENT_LOCK.file === lock) CURRENT_LOCK = null;
}

// --- Claims cache (crash recovery only; GitHub is the record) ----------------------------

function claimsFile(cfg) { return path.join(cfg.home, 'claims.json'); }
function readClaims(cfg) { try { return readJsonFile(claimsFile(cfg)) || {}; } catch (e) { return {}; } }
function writeClaims(cfg, claims) {
  fs.mkdirSync(cfg.home, { recursive: true, mode: 0o700 });
  writeAtomic(claimsFile(cfg), JSON.stringify(claims, null, 2) + '\n');
}

// Finds the executor task that already belongs to a control task, in this
// order: the cache, then the executor store itself (a `github:<id>` stage
// marker + requested_by). The store scan is what makes a crash between
// createTask() and the claim commit harmless: on the next tick the task is
// found and re-claimed, never re-created.
function findExecutorTask(cfg, id) {
  var claims = readClaims(cfg);
  if (claims[id] && claims[id].executor_task_id && state.readStatus(claims[id].executor_task_id)) {
    return claims[id].executor_task_id;
  }
  var marker = 'github:' + id;
  var hits = state.listTasks().filter(function (tid) {
    var t = state.readJSON(tid, 'task.json');
    return t && t.stage === marker && t.requested_by === BY;
  }).sort();
  return hits.length ? hits[0] : null;
}

// --- Control branch: fetch + reconcile ------------------------------------------------------

// Fast-forward when the bridge has nothing local; rebase the bridge's own
// (never-pushed) commits onto origin when both sides moved. The relay only
// ever pushes fast-forward, so a commit that is already on origin is never
// rewritten. A rebase conflict aborts cleanly and the tick makes no claims
// (it still runs on the local view for status sync).
function syncControl(cfg) {
  var dir = cfg.controlDir;
  if (!fs.existsSync(dir)) return { ok: false, reason: 'control worktree missing: ' + dir };
  var fetched = git(dir, ['fetch', '--quiet', cfg.remote, cfg.branch], { timeout: 180000 });
  var remoteRef = cfg.remote + '/' + cfg.branch;
  var remote = git(dir, ['rev-parse', '--verify', '--quiet', remoteRef]);
  if (!fetched.ok || !remote.ok) {
    return { ok: true, fetched: false, reason: fetched.ok ? 'branch not on origin yet' : fetched.error, head: git(dir, ['rev-parse', 'HEAD']).out };
  }
  var local = git(dir, ['rev-parse', 'HEAD']).out;
  if (local === remote.out) return { ok: true, fetched: true, action: 'up-to-date', head: local };
  var remoteIsAncestor = git(dir, ['merge-base', '--is-ancestor', remote.out, local]).ok;
  if (remoteIsAncestor) return { ok: true, fetched: true, action: 'local-ahead', head: local };
  var localIsAncestor = git(dir, ['merge-base', '--is-ancestor', local, remote.out]).ok;
  if (localIsAncestor) {
    var ff = git(dir, ['merge', '--ff-only', remote.out]);
    if (!ff.ok) return { ok: false, reason: 'fast-forward failed: ' + ff.error };
    return { ok: true, fetched: true, action: 'fast-forwarded', head: git(dir, ['rev-parse', 'HEAD']).out };
  }
  var rb = git(dir, ['-c', 'user.name=MYTHOS GitHub Bridge', '-c', 'user.email=bridge@mythosprod.xyz', 'rebase', remote.out]);
  if (!rb.ok) {
    git(dir, ['rebase', '--abort']);
    return { ok: false, reason: 'rebase conflict against ' + remoteRef + ': ' + rb.error };
  }
  return { ok: true, fetched: true, action: 'rebased', head: git(dir, ['rev-parse', 'HEAD']).out };
}

// Commits exactly the named files (never `git add .`).
function commitControl(cfg, files, message) {
  var dir = cfg.controlDir;
  var rel = files.map(function (f) { return path.isAbsolute(f) ? path.relative(dir, f) : f; });
  rel.forEach(function (r) {
    if (r.indexOf('..') === 0 || path.isAbsolute(r) || r.indexOf(cfg.prefix + '/') !== 0) {
      throw new Error('CONTROL_COMMIT_SCOPE: refusing to stage ' + r);
    }
  });
  assertLockOwned(cfg);
  var add = git(dir, ['add', '--'].concat(rel));
  if (!add.ok) throw new Error('git add failed: ' + add.error);
  var staged = git(dir, ['diff', '--cached', '--quiet']);
  if (staged.ok) return { committed: false, reason: 'nothing to commit' };
  var commit = git(dir, ['-c', 'user.name=MYTHOS GitHub Bridge', '-c', 'user.email=bridge@mythosprod.xyz',
    'commit', '--quiet', '-m', message]);
  if (!commit.ok) throw new Error('git commit failed: ' + commit.error);
  var head = git(dir, ['rev-parse', 'HEAD']).out;
  log('control_commit', { commit: head, files: rel, message: message.split('\n')[0], fence: currentFence() });
  return { committed: true, commit: head };
}

// --- Task files -------------------------------------------------------------------

function listTaskFiles(cfg) {
  var dir = paths(cfg).tasks;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).sort();
}

function loadTask(cfg, file) {
  var full = path.join(paths(cfg).tasks, file);
  var raw = fs.readFileSync(full, 'utf8');
  var out = { file: file, full: full, raw: raw, hash: sha256(raw), task: null, parse_error: null };
  try { out.task = JSON.parse(raw); } catch (e) { out.parse_error = 'invalid JSON: ' + e.message.slice(0, 200); }
  return out;
}

function saveTask(cfg, task) {
  writeJsonRedacted(taskFile(cfg, task.task_id), task);
}

// Immutable part of a task, hashed at claim time so a later edit of a
// claimed task is noticed (and ignored) rather than silently executed.
function taskFingerprint(task) {
  var copy = {};
  ['task_id', 'project', 'objective', 'scope', 'constraints', 'priority', 'requested_action', 'action_raw', 'action_source',
    'validation_requirements', 'created_at', 'created_by', 'depends_on', 'timeout_seconds', 'max_turns', 'notes', 'model', 'model_raw', 'model_source']
    .forEach(function (k) { if (task[k] !== undefined) copy[k] = task[k]; });
  return sha256(JSON.stringify(copy));
}

// Validation of a task an external writer produced. Returns [] when valid.
function validateTask(cfg, task, file) {
  var errors = [];
  if (!task || typeof task !== 'object' || Array.isArray(task)) return ['task is not a JSON object'];
  var check = schema.validate(task, TASK_SCHEMA);
  if (!check.valid) errors = errors.concat(check.errors);
  if (!isValidTaskId(task.task_id)) errors.push('task_id is not an acceptable id (lowercase a-z 0-9 -, 6-40 chars, no governance words)');
  if (file && task.task_id && file !== task.task_id + '.json') errors.push('file name must be <task_id>.json (got ' + file + ')');
  if (task.project !== cfg.project) errors.push('project "' + String(task.project).slice(0, 40) + '" is not served by this bridge (expected ' + cfg.project + ')');
  if (!PROFILE_BY_ACTION[task.requested_action]) errors.push('requested_action is not one of ' + Object.keys(PROFILE_BY_ACTION).join(', '));
  if (task.execution !== undefined || task.history !== undefined) {
    errors.push('execution/history are bridge-owned blocks and must not be written by the creator');
  }
  if (CREATOR_STATUSES.indexOf(task.status) === -1) {
    errors.push('status "' + String(task.status).slice(0, 20) + '" cannot be set by the creator (only PENDING or CANCELLED)');
  }
  if (Array.isArray(task.depends_on) && task.depends_on.indexOf(task.task_id) !== -1) errors.push('a task cannot depend on itself');
  // Issue #100: an unusable `model` is caught here, where the reason reaches
  // the creator on the Issue, instead of throwing inside executor.createTask.
  if (task.model !== undefined && task.model !== null && String(task.model).trim() !== '') {
    // Unknown name → the creator made a typo: refuse with the accepted list.
    // Known but disabled → keep the explicit choice; the claim stops the
    // attempt as MODEL_UNAVAILABLE (never a substitute), see preflight().
    if (!modelPolicy.lookupKey(task.model)) errors.push('model: ' + modelPolicy.resolveExplicit(task.model).error);
  }
  if (task.action_source && engine.ACTION_SOURCES.indexOf(task.action_source) === -1) errors.push('action_source is not one of ' + engine.ACTION_SOURCES.join(', '));
  var secretKinds = redact.findSecretKinds(JSON.stringify(task));
  if (secretKinds.length) errors.push('task carries a secret shape (' + secretKinds.join(', ') + ') — credentials never travel in tasks');
  return errors;
}

// --- Instruction the executor receives ----------------------------------------------------

function bullets(list, empty) {
  if (!Array.isArray(list) || !list.length) return '- ' + (empty || 'none');
  return list.map(function (x) { return '- ' + String(x); }).join('\n');
}

// The instruction is DATA to the executor (it cannot change provider,
// profile or paths). It opens with the standalone `othmode` keyword so the
// Claude session runs under the OTHMODE control contract (CLAUDE.md), and
// names the OTHMODE Task record the bridge already opened so the session
// updates it instead of creating a second one.
function buildInstruction(cfg, task, exec) {
  return [
    'othmode — GitHub control task ' + task.task_id + ' (project ' + task.project + ', requested_action ' + task.requested_action +
      ' [source ' + (task.action_source || 'task_file') + (task.action_raw ? ', written "' + task.action_raw + '"' : '') + '] → execution profile ' + (exec.execution_profile || engine.profileFor(task.requested_action)) + ').',
    '',
    'This task was created in GitHub (branch ' + cfg.branch + ', ' + cfg.prefix + '/tasks/' + task.task_id + '.json) by ' +
      task.created_by + (task.source && task.source.kind === 'github-issue' && task.source.issue_url ? ' from GitHub Issue #' + task.source.issue_number + ' (' + task.source.issue_url + '; the Issue is the human interface — do not edit or comment on it, the adapter reports there from the control files)' : '') + ' and dispatched by the MYTHOS GitHub bridge. Your OTHMODE Task record already exists: ' +
      (exec.othmode_task_id || '(none — OTHMODE store unavailable; record nothing)') +
      '. You MAY advance its `phase` and add `sections`/`evidence_texts` with `node projects/command-center/cli/othmode-cli.js task update <id> \'<json>\'`, ' +
      'but you MUST NOT set a terminal `status` (COMPLETED/FAILED/BLOCKED/CANCELLED/REJECTED) and MUST NOT create a second record: ' +
      'the bridge is the only component that closes this record, after it has verified your commits and tests against Git. Your structured final report block is the evidence it uses.',
    '',
    '## Objective',
    '',
    task.objective,
    '',
    '## Scope',
    '',
    bullets(task.scope, 'as implied by the objective'),
    '',
    '## Constraints from the task',
    '',
    bullets(task.constraints, 'none beyond the repository rules'),
    '',
    '## Bridge constraints (non-negotiable)',
    '',
    '- Work ONLY inside ' + exec.worktree + ' on branch `' + exec.branch + '` (based on ' + String(exec.base_commit).slice(0, 12) + '). Never touch the shared checkout ' + cfg.repo + ' or any other worktree.',
    '- Never run `git push`. Delivery to GitHub is performed by the governance relay (mythos-git-push.timer, fast-forward only); committing on your branch is enough. Never merge to main.',
    '- Do not edit anything under `' + cfg.prefix + '/` and do not touch the `' + cfg.branch + '` branch: the bridge writes the report from your structured final report.',
    '- Do not modify governance-protected paths (executor policy/budget/service files, redact.js, .github/, anything matching credential/secret/.env). If the objective requires it, stop and report `blocked`.',
    '- Read-only requested_action (investigate, review, test) means NO file edits and NO commits; report findings only.',
    '',
    '## Validation requirements',
    '',
    bullets(task.validation_requirements, 'the targeted checks you judge necessary; report exactly what you ran'),
    '',
    task.notes ? '## Notes from the creator\n\n' + task.notes + '\n' : ''
  ].join('\n');
}

// --- OTHMODE Task record (the integration point with OTHMODE) ------------------------------------

function othmodeModule() {
  try {
    return require(path.join(EXEC_ROOT, '..', 'command-center', 'reference', 'othmode', 'tasks.js'));
  } catch (e) { return null; }
}

function othmodeCreate(cfg, task, exec) {
  var mod = othmodeModule();
  if (!mod) return { id: null, problem: 'OTHMODE tasks module unavailable' };
  try {
    var rec = mod.createTask({
      command: 'othmode ' + task.task_id + ': ' + String(task.objective).replace(/\s+/g, ' ').slice(0, 300),
      project: task.project,
      source: 'github-bridge:' + cfg.branch + ':' + cfg.prefix + '/tasks/' + task.task_id + '.json',
      status: 'RUNNING',
      phase: 'RUNNING',
      started_at: nowIso(),
      sections: {
        preflight: {
          origin: 'GitHub control task (' + PROTOCOL + ') created by ' + task.created_by + ' at ' + task.created_at,
          requested_action: task.requested_action,
          action_source: task.action_source || 'task_file',
          action_raw: task.action_raw || null,
          execution_profile: exec.execution_profile,
          attempt_id: exec.attempt_id || null,
          model: task.model || null,
          executor_task_id: exec.executor_task_id || null,
          worktree: exec.worktree,
          branch: exec.branch,
          base_commit: exec.base_commit
        }
      }
    }, BY);
    return { id: rec.id, problem: null };
  } catch (e) {
    return { id: null, problem: 'OTHMODE record not created: ' + String(e.message).slice(0, 200) };
  }
}

// F2 — the bridge is the ONLY closer of an OTHMODE record. The executing
// session may advance phase and add sections; the terminal status and the
// evidence sections (outcome, git, validation, tests, problems/risks) are
// written here, from Git-verified data. A record the session closed early
// cannot be amended (the store is append-only and refuses updates after a
// terminal status), so that case is detected and reported as a problem on
// the GitHub REPORT — the evidence then lives there, and the gap is visible.
// Section names are the closed OTHMODE set (tasks.js SECTIONS): tests live
// under `validation` and `evidence`, changed files under `changes`.
function othmodeSections(status, report) {
  return {
    outcome: { status: status, summary: report.summary, next_action: report.next_recommended_action, completed_at: report.completed_at, closed_by: BY },
    git: { commits: report.commits, delivery: report.delivery, branch: report.execution.branch, base_commit: report.execution.base_commit },
    changes: { files_changed: report.files_changed },
    validation: { required_checks: report.validation.required_checks, tests: report.tests, git_verified: report.validation.git_verified, remote_head: report.validation.remote_head, report_problems: report.validation.report_problems },
    evidence: { tests: report.tests, report_file: 'control/reports/' + report.task_id + '.json', executor_report: report.execution.executor_task_id ? 'executor store report.json for ' + report.execution.executor_task_id : null },
    problems: { problems: report.problems, risks: report.risks },
    execution: { executor_task_id: report.execution.executor_task_id, execution_profile: report.execution.execution_profile, claude_session_id: report.execution.claude_session_id, retries: report.execution.retries, quota_waits: report.execution.quota_waits, cost_usd: report.execution.cost_usd, model: report.execution.model, model_selection_reason: report.execution.model_selection_reason }
  };
}

function othmodeFinish(id, status, report) {
  if (!id) return { updated: false, premature: false, reason: 'no OTHMODE record' };
  var mod = othmodeModule();
  if (!mod) return { updated: false, premature: false, reason: 'module unavailable' };
  var map = { COMPLETED: 'COMPLETED', FAILED: 'FAILED', BLOCKED: 'BLOCKED', CANCELLED: 'CANCELLED' };
  try {
    var current = mod.getTask(id);
    if (!current) return { updated: false, premature: false, reason: 'record ' + id + ' not found' };
    if (current.terminal) {
      return {
        updated: false, premature: true,
        reason: 'OTHMODE record ' + id + ' was closed ' + current.status + ' by the executing session before the bridge verified the result; ' +
          'the store is append-only, so outcome/git/validation/tests evidence could not be added there and is recorded in this REPORT only'
      };
    }
    mod.updateTask(id, {
      status: map[status] || 'FAILED',
      phase: 'COMPLETED',
      finished_at: report.completed_at,
      sections: othmodeSections(status, report)
    }, BY);
    return { updated: true, premature: false };
  } catch (e) {
    return { updated: false, premature: false, reason: String(e.message).slice(0, 200) };
  }
}

// --- Per-task worktree -----------------------------------------------------------------

function taskBranch(id) { return 'mythos/gh/' + id; }

// F1 — push guard. The executing session runs with `Bash(git:*)` and the
// deploy SSH identity, so a raw `git push` from the task worktree would
// bypass the governance relay. Each task worktree therefore gets a
// worktree-scoped push URL that no transport can use; `fetch` keeps the
// real URL. This is a guard against instructed or accidental pushes, not
// a hard floor (the floor is lib/policy.js, owner-approved); it applies
// only to task worktrees, never to the shared checkout or its config.
var NO_PUSH_URL = 'no_push://governance-relay-only';

// Effective push URL set of a remote in `cwd`, in git's own order and after
// url.*.insteadOf rewriting — exactly what `git push` would use.
function effectivePushUrls(cwd, remote) {
  var r = git(cwd, ['remote', 'get-url', '--push', '--all', remote]);
  if (!r.ok) return { ok: false, urls: [], error: r.error };
  return { ok: true, urls: r.out.split('\n').map(function (l) { return l.trim(); }).filter(Boolean) };
}

// F1 push guard. Git's remote.<r>.pushurl is MULTI-VALUED and additive across
// config scopes: a worktree-scoped no-push value does not hide a repository-
// level one (the relay legitimately keeps remote.origin.pushurl = SSH on the
// shared checkout since 2026-09-03), and `git push` would deliver to every
// value. The guard therefore (1) requires the worktree scope to carry exactly
// the no-push URL and nothing else — anything else is tampering and is
// refused, never silently repaired; (2) neutralises every push URL inherited
// from outer scopes with a worktree-scoped url.<no_push>.insteadOf rewrite, so
// the inherited value cannot be pushed to from this worktree while the shared
// checkout keeps it untouched; (3) proves the result on the COMPLETE effective
// set (`git remote get-url --push --all`), not on the first entry, and that the
// fetch URL is unchanged. Any deviation throws PUSH_GUARD_FAILED.
function applyPushGuard(cfg, dir) {
  var r = cfg.remote;
  var key = 'remote.' + r + '.pushurl';
  var ext = git(cfg.repo, ['config', '--get', 'extensions.worktreeConfig']);
  if (!ext.ok || ext.out !== 'true') {
    var en = git(cfg.repo, ['config', 'extensions.worktreeConfig', 'true']);
    if (!en.ok) throw new Error('PUSH_GUARD_FAILED: cannot enable extensions.worktreeConfig: ' + en.error);
  }
  // (1) worktree scope: exactly [NO_PUSH_URL]
  var wt = git(dir, ['config', '--worktree', '--get-all', key]);
  var wtUrls = wt.ok ? wt.out.split('\n').map(function (l) { return l.trim(); }).filter(Boolean) : [];
  if (wtUrls.length === 0) {
    var set = git(dir, ['config', '--worktree', key, NO_PUSH_URL]);
    if (!set.ok) throw new Error('PUSH_GUARD_FAILED: ' + set.error);
    wtUrls = [NO_PUSH_URL];
  }
  var foreignWt = wtUrls.filter(function (u) { return u !== NO_PUSH_URL; });
  if (foreignWt.length || wtUrls.length !== 1) {
    throw new Error('PUSH_GUARD_FAILED: unexpected worktree-level push url(s) ' + JSON.stringify(wtUrls) + ' (expected exactly ' + NO_PUSH_URL + ')');
  }
  // (2) neutralise push URLs inherited from repository/global/system scope
  var fetchUrl = git(dir, ['remote', 'get-url', r]);
  if (!fetchUrl.ok || !fetchUrl.out) throw new Error('PUSH_GUARD_FAILED: cannot read fetch url: ' + fetchUrl.error);
  var all = git(dir, ['config', '--show-origin', '--get-all', key]);
  var inherited = [];
  (all.ok ? all.out.split('\n') : []).forEach(function (line) {
    var i = line.indexOf('\t');
    if (i < 0) return;
    var origin = line.slice(0, i), value = line.slice(i + 1).trim();
    if (!value || value === NO_PUSH_URL) return;
    if (/config\.worktree$/.test(origin)) return; // refused above; defensive
    if (inherited.indexOf(value) < 0) inherited.push(value);
  });
  var aliasKey = 'url.' + NO_PUSH_URL + '.insteadOf';
  git(dir, ['config', '--worktree', '--unset-all', aliasKey]); // idempotent re-apply
  inherited.forEach(function (u) {
    if (u === fetchUrl.out) {
      throw new Error('PUSH_GUARD_FAILED: inherited push url equals the fetch url (' + u + '); cannot isolate without breaking fetch');
    }
    var add = git(dir, ['config', '--worktree', '--add', aliasKey, u]);
    if (!add.ok) throw new Error('PUSH_GUARD_FAILED: cannot neutralise inherited push url ' + u + ': ' + add.error);
  });
  // (3) prove the complete effective set and the fetch url
  var eff = effectivePushUrls(dir, r);
  if (!eff.ok || eff.urls.length === 0) throw new Error('PUSH_GUARD_FAILED: cannot read effective push urls: ' + (eff.error || 'empty'));
  var bad = eff.urls.filter(function (u) { return u !== NO_PUSH_URL; });
  if (bad.length) throw new Error('PUSH_GUARD_FAILED: effective push url(s) ' + JSON.stringify(bad) + ' (expected only ' + NO_PUSH_URL + ')');
  var fetchAfter = git(dir, ['remote', 'get-url', r]);
  if (!fetchAfter.ok || fetchAfter.out !== fetchUrl.out) throw new Error('PUSH_GUARD_FAILED: fetch url changed by the guard (' + fetchAfter.out + ')');
  return { ok: true, push_urls: eff.urls, neutralised: inherited, fetch_url: fetchUrl.out };
}

function ensureTaskWorktree(cfg, id) {
  var dir = path.join(cfg.taskWorktrees, id);
  var branch = taskBranch(id);
  if (fs.existsSync(dir)) {
    var head = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (head.ok && head.out === branch) {
      applyPushGuard(cfg, dir);
      return { dir: dir, branch: branch, base: git(dir, ['merge-base', branch, cfg.baseRef]).out || git(dir, ['rev-parse', 'HEAD']).out, reused: true };
    }
    throw new Error('WORKTREE_CONFLICT: ' + dir + ' exists with branch ' + (head.out || '?'));
  }
  // Base on the freshest origin/main the repo knows (best-effort fetch).
  git(cfg.repo, ['fetch', '--quiet', cfg.remote, cfg.baseRef.replace(cfg.remote + '/', '')], { timeout: 180000 });
  var base = git(cfg.repo, ['rev-parse', '--verify', '--quiet', cfg.baseRef]);
  if (!base.ok) base = git(cfg.repo, ['rev-parse', 'HEAD']);
  if (!base.ok) throw new Error('NO_BASE_REF: cannot resolve ' + cfg.baseRef);
  fs.mkdirSync(cfg.taskWorktrees, { recursive: true, mode: 0o700 });
  var existing = git(cfg.repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/' + branch]);
  var add = existing.ok
    ? git(cfg.repo, ['worktree', 'add', dir, branch])
    : git(cfg.repo, ['worktree', 'add', '-b', branch, dir, base.out]);
  if (!add.ok) throw new Error('WORKTREE_ADD_FAILED: ' + add.error);
  applyPushGuard(cfg, dir);
  return { dir: dir, branch: branch, base: existing.ok ? git(dir, ['merge-base', branch, base.out]).out : base.out, reused: false };
}

// --- Claim ------------------------------------------------------------------------

function pushHistory(task, from, to, note) {
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push({ at: nowIso(), from: from, to: to, by: BY, note: note || null });
  if (task.history.length > 60) task.history = task.history.slice(-60);
}

function attemptIdOf(task) {
  var src = task.source && typeof task.source === 'object' ? task.source : {};
  if (src.attempt_id) return src.attempt_id;
  return task.task_id + '#' + (src.attempt || 1);
}

// Everything that must be true BEFORE an executor task exists — evaluated on
// the durable task file, never on a provider's output. Returns null when the
// attempt may run, or a blocker { code, reason, retryable:false, ... }.
//
//   ACTION_PROFILE_MISMATCH  the executor record found for this task (crash
//                            recovery) carries a profile other than the one
//                            requested_action maps to;
//   MODEL_UNAVAILABLE        the task names a model the catalog knows but
//                            this host cannot run — it is never replaced.
function preflight(cfg, task, existingExecTask) {
  var attemptId = attemptIdOf(task);
  var expected = engine.profileFor(task.requested_action);
  var check = engine.checkActionProfile(task.requested_action, existingExecTask ? existingExecTask.execution_profile : expected);
  if (!check.ok) {
    return engine.blocker(check.code, {
      reason: check.reason, requested_action: task.requested_action, action_raw: task.action_raw || null, action_source: task.action_source || 'task_file',
      execution_profile: check.actual_profile, expected_profile: check.expected_profile, actual_profile: check.actual_profile,
      task_id: task.task_id, attempt_id: attemptId, executor_task_id: existingExecTask ? existingExecTask.task_id : null
    });
  }
  if (task.model !== undefined && task.model !== null && String(task.model).trim() !== '') {
    var hit = modelPolicy.lookupKey(task.model);
    if (!hit || !hit.enabled) {
      return engine.blocker(engine.BLOCKER_CODES.MODEL_UNAVAILABLE, {
        reason: hit
          ? 'model "' + hit.display_name + '" (' + hit.model + ') was requested explicitly (' + (task.model_source || 'task_file') + ', written "' + (task.model_raw || task.model) + '") but is not available on this host: ' + (hit.disabled_reason || 'disabled in config/model-policy.json') + '. It was NOT replaced by another model.'
          : 'model "' + String(task.model).slice(0, 40) + '" is not in the catalog on this host. It was NOT replaced by another model.',
        requested_model: task.model_raw || task.model, model_key: hit ? hit.key : null, model_id: hit ? hit.model : null, model_source: task.model_source || 'task_file',
        available_models: modelPolicy.availableLabels(), actual_model: null,
        requested_action: task.requested_action, execution_profile: expected, task_id: task.task_id, attempt_id: attemptId
      });
    }
  }
  return null;
}

function claimTask(cfg, executor, entry, tasksById, runtime) {
  var task = entry.task;
  var id = task.task_id;
  var cache = readClaims(cfg);
  var existingId = findExecutorTask(cfg, id);
  var existingTask = existingId ? state.readJSON(existingId, 'task.json') : null;
  var attemptId = attemptIdOf(task);
  var expectedProfile = engine.profileFor(task.requested_action);

  // Invariant gate — before a worktree, before an OTHMODE record, before the
  // executor: an attempt that cannot run under its own decision does not start.
  var block = preflight(cfg, task, existingTask);
  if (block) return { blocked: block };

  var wt = ensureTaskWorktree(cfg, id);
  var exec = task.execution && typeof task.execution === 'object' ? task.execution : {};
  var modelHit = task.model ? modelPolicy.lookupKey(task.model) : null;
  exec = {
    executor_task_id: existingId || null,
    othmode_task_id: (cache[id] && cache[id].othmode_task_id) || exec.othmode_task_id || null,
    attempt_id: attemptId,
    requested_action: task.requested_action,
    action_raw: task.action_raw || null,
    action_source: task.action_source || 'task_file',
    execution_profile: expectedProfile,
    expected_profile: expectedProfile,
    expected_delivery: DELIVERY_BY_ACTION[task.requested_action],
    model_key: modelHit ? modelHit.key : null,
    model_requested: task.model_raw || task.model || null,
    model_source: task.model ? (task.model_source || 'task_file') : 'none',
    worktree: wt.dir,
    branch: wt.branch,
    base_commit: wt.base,
    claimed_at: (cache[id] && cache[id].claimed_at) || nowIso(),
    claimed_by: cfg.claimedBy,
    fingerprint: taskFingerprint(task),
    executor_status: 'QUEUED',
    updated_at: nowIso()
  };
  // The immutable decision of THIS attempt. Re-checked by the executor before
  // the provider starts (ATTEMPT_SNAPSHOT_MUTATED) and by the bridge on every
  // progress tick; a later edit of the control file can be noticed, never obeyed.
  exec.snapshot_sha256 = engine.attemptSnapshot({
    task_id: id, attempt_id: attemptId, requested_action: task.requested_action, action_raw: task.action_raw || null, action_source: exec.action_source,
    execution_profile: exec.execution_profile, model: task.model || null, objective: task.objective, scope: task.scope, constraints: task.constraints,
    validation_requirements: task.validation_requirements, notes: task.notes || null
  });
  exec.fence = currentFence();
  exec.lease = {
    owner: cfg.claimedBy + ':' + process.pid,
    fence: exec.fence,
    acquired_at: exec.claimed_at,
    expires_at: new Date(Date.parse(exec.claimed_at) + ((task.timeout_seconds || 3600) * 1000) + cfg.leaseGraceMs).toISOString()
  };
  exec.runtime = runtime || runtimeIdentity(cfg);

  var recovered = !!existingId;
  if (!existingId) {
    if (!exec.othmode_task_id) {
      var oth = othmodeCreate(cfg, task, exec);
      exec.othmode_task_id = oth.id;
      if (oth.problem) exec.othmode_problem = oth.problem;
    }
    // The invariant, asserted at the exact point the profile leaves this
    // process. Throws ACTION_PROFILE_MISMATCH — it cannot be caught into a
    // provider start.
    engine.assertActionProfile(task.requested_action, exec.execution_profile, { task_id: id, attempt_id: attemptId });
    var created = executor.createTask({
      project: task.project,
      stage: 'github:' + id,
      instruction: buildInstruction(cfg, task, exec),
      priority: task.priority,
      requested_by: BY,
      mode: 'autonomous',
      // Always the execution provider. The mock is reachable ONLY when the
      // executor itself allows it (tests); production units never set that.
      provider: process.env.MYTHOS_EXECUTOR_ALLOW_MOCK === '1' && process.env.MYTHOS_BRIDGE_PROVIDER === 'mock' ? 'mock' : 'claude-code',
      execution_profile: exec.execution_profile,
      // Optional (Issue #100). Absent → executor.createTask scores the task
      // and chooses haiku/sonnet/opus; present → that model or a refusal.
      model: task.model || null,
      working_directory: wt.dir,
      branch: wt.branch,
      task_category: task.requested_action,
      action_source: exec.action_source,
      action_raw: task.action_raw || null,
      attempt_id: attemptId,
      required_tests: task.validation_requirements,
      constraints: task.constraints,
      expected_delivery: exec.expected_delivery,
      report_to_git: false,
      timeout_seconds: task.timeout_seconds || 3600,
      max_retries: 2,
      max_turns: task.max_turns || null
    });
    exec.executor_task_id = created.task_id;
    exec.model = created.model || null;
    lifecycle.linkTask(created.task_id, { correlation_id: id, control_task_id: id, othmode_task_id: exec.othmode_task_id || null,
      github_issue: task.source && task.source.kind === 'github-issue' ? task.source.issue_number : null,
      issue_url: task.source && task.source.issue_url ? task.source.issue_url : null });
    exec.model_selection_mode = created.model_selection_mode || null;
    // Cache immediately: if the process dies before the commit below, the
    // next tick finds this and re-claims instead of re-creating.
    cache[id] = { executor_task_id: created.task_id, othmode_task_id: exec.othmode_task_id, claimed_at: exec.claimed_at, fence: exec.fence, attempt_id: attemptId };
    writeClaims(cfg, cache);
  } else {
    exec.model = existingTask ? (existingTask.model || null) : null;
    lifecycle.linkTask(existingId, { correlation_id: id, control_task_id: id, othmode_task_id: exec.othmode_task_id || null,
      github_issue: task.source && task.source.kind === 'github-issue' ? task.source.issue_number : null });
    if (!cache[id]) {
      cache[id] = { executor_task_id: existingId, othmode_task_id: exec.othmode_task_id, claimed_at: exec.claimed_at, fence: exec.fence, attempt_id: attemptId };
      writeClaims(cfg, cache);
    }
  }

  task.execution = exec;
  pushHistory(task, 'PENDING', 'CLAIMED', (recovered
    ? 'recovered: executor task ' + exec.executor_task_id + ' already existed (claim commit was lost)'
    : 'executor task ' + exec.executor_task_id + ' queued; OTHMODE ' + (exec.othmode_task_id || 'n/a')) +
    '; action ' + task.requested_action + ' (' + exec.action_source + ') → ' + exec.execution_profile + '; model ' + (exec.model || 'auto') + '; fence ' + exec.fence);
  task.status = 'CLAIMED';
  saveTask(cfg, task);
  tasksById[id] = task;
  log('claimed', { task_id: id, attempt_id: attemptId, executor_task_id: exec.executor_task_id, othmode_task_id: exec.othmode_task_id, recovered: recovered, worktree: wt.dir,
    requested_action: task.requested_action, action_source: exec.action_source, action_raw: task.action_raw || null, execution_profile: exec.execution_profile,
    model: exec.model || null, model_requested: exec.model_requested, fence: exec.fence, runtime_head: exec.runtime ? exec.runtime.head : null, runtime_code: exec.runtime ? exec.runtime.code : null });
  return { file: taskFile(cfg, id), recovered: recovered };
}

// --- Report -----------------------------------------------------------------------

function commitsOnBranch(cfg, exec) {
  var out = [];
  if (!exec || !exec.worktree || !fs.existsSync(exec.worktree) || !exec.base_commit) return out;
  git(exec.worktree, ['fetch', '--quiet', cfg.remote, exec.branch], { timeout: 120000 });
  var remoteRef = cfg.remote + '/' + exec.branch;
  var remoteOk = git(exec.worktree, ['rev-parse', '--verify', '--quiet', remoteRef]).ok;
  var lg = git(exec.worktree, ['log', '--format=%H%x1f%s', exec.base_commit + '..HEAD']);
  if (!lg.ok || !lg.out) return out;
  lg.out.split('\n').forEach(function (line) {
    var p = line.split('\x1f');
    if (!/^[0-9a-f]{40}$/.test(p[0])) return;
    out.push({
      sha: p[0], subject: String(p[1] || '').slice(0, 300), branch: exec.branch,
      on_origin: remoteOk && git(exec.worktree, ['merge-base', '--is-ancestor', p[0], remoteRef]).ok
    });
  });
  return out;
}

function changedFiles(exec) {
  if (!exec || !exec.worktree || !fs.existsSync(exec.worktree) || !exec.base_commit) return [];
  var d = git(exec.worktree, ['diff', '--name-only', exec.base_commit + '..HEAD']);
  return d.ok && d.out ? d.out.split('\n').filter(Boolean) : [];
}

function uniq(list) {
  var seen = {};
  return list.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; });
}

function buildReport(cfg, task, finalStatus, opts) {
  opts = opts || {};
  var exec = task.execution || {};
  var eid = exec.executor_task_id;
  var etask = eid ? state.readJSON(eid, 'task.json') : null;
  var estatus = eid ? state.readStatus(eid) : null;
  var erep = eid ? state.readJSON(eid, 'report.json') : null;
  // The provider's own block when it produced one, else the executor's
  // synthesised one (same shape, synthesized:true): a report ALWAYS exists.
  var structured = (erep && (erep.report || erep.structured)) || opts.structured_report || null;
  var r = structured || {};
  var gitx = (erep && erep.git) || {};
  var problems = [].concat(opts.problems || [], (erep && erep.problems) || []);
  var blocker = opts.blocker || (erep && erep.blocker) || (structured && structured.blocker) || null;
  if (blocker && blocker.code) problems.push(blocker.code + ': ' + String(blocker.reason || '').slice(0, 800));
  if (estatus && estatus.last_error) problems.push('executor: ' + String(estatus.last_error).slice(0, 500));
  var commits = commitsOnBranch(cfg, exec);
  var files = uniq([].concat(Array.isArray(r.files_changed) ? r.files_changed : [], changedFiles(exec)));
  var summary = r.summary || opts.summary ||
    (estatus ? (estatus.next_action || 'executor ended ' + estatus.status) : 'no execution record');
  var runtime = exec.runtime || runtimeIdentity(cfg);
  var report = {
    protocol: PROTOCOL,
    task_id: task.task_id,
    attempt_id: exec.attempt_id || attemptIdOf(task),
    status: finalStatus,
    summary: String(summary).slice(0, 20000),
    resolution: {
      requested_action: task.requested_action,
      action_raw: task.action_raw || null,
      action_source: exec.action_source || task.action_source || 'task_file',
      execution_profile: exec.execution_profile || null,
      expected_profile: engine.profileFor(task.requested_action),
      model_requested: task.model_raw || task.model || null,
      model_key: exec.model_key || null,
      model: etask ? (etask.model || null) : (exec.model || null),
      model_source: exec.model_source || task.model_source || (task.model ? 'task_file' : 'none'),
      model_selection_mode: etask ? (etask.model_selection_mode || null) : null,
      model_selection_reason: etask ? (etask.model_selection_reason || null) : null,
      base_sha: exec.base_commit || null,
      branch: exec.branch || null,
      commit_sha: commits.length ? commits[commits.length - 1].sha : null
    },
    blocker: blocker,
    runtime_identity: runtime,
    structured_report: structured,
    files_changed: files.map(String),
    commits: commits,
    tests: (Array.isArray(r.tests) ? r.tests : []).map(function (t) { return typeof t === 'string' ? t : JSON.stringify(t); }),
    validation: {
      git_verified: gitx.git_verified === undefined ? null : gitx.git_verified,
      remote_head: gitx.remote_head || null,
      report_problems: (gitx.report_problems || []).map(String),
      required_checks: (task.validation_requirements || []).map(String)
    },
    problems: uniq(problems.filter(Boolean).map(String)),
    risks: (Array.isArray(r.residual_risks) ? r.residual_risks : []).map(String),
    next_recommended_action: String(r.next_stage || opts.next || (estatus && estatus.next_action) || 'review this report and create the next task').slice(0, 4000),
    completed_at: nowIso(),
    execution: {
      executor_task_id: eid || null,
      othmode_task_id: exec.othmode_task_id || null,
      execution_profile: exec.execution_profile || null,
      provider: etask ? etask.provider : null,
      model: etask ? (etask.model || 'default') : null,
      // Issue #100: which model ran, and why — a report must be able to
      // answer that without reading the executor store.
      model_requested: task.model_raw || task.model || null,
      model_source: exec.model_source || (task.model ? 'task_file' : 'none'),
      action_source: exec.action_source || task.action_source || 'task_file',
      action_raw: task.action_raw || null,
      attempt_id: exec.attempt_id || null,
      fence: exec.fence === undefined ? null : exec.fence,
      lease: exec.lease || null,
      snapshot_sha256: exec.snapshot_sha256 || null,
      model_selection_mode: etask ? (etask.model_selection_mode || null) : null,
      model_selection_reason: etask ? (etask.model_selection_reason || null) : null,
      claude_session_id: estatus ? estatus.claude_session_id : null,
      executor_status: estatus ? estatus.status : null,
      started_at: estatus ? (estatus.started_at || null) : null,
      ended_at: estatus ? (estatus.ended_at || null) : null,
      retries: estatus ? (estatus.retry_count || 0) : 0,
      last_failure: estatus && estatus.last_failure ? estatus.last_failure : null,
      retry_backoff: estatus && estatus.retry_backoff ? estatus.retry_backoff : null,
      transition_reason: estatus ? (estatus.transition_reason || null) : null,
      // HOSTOPS-1: host operations performed for this task, joined to the
      // root-owned ledger by audit_id. Additive; absent when none ran.
      hostops: (eid && state.readJSON(eid, 'hostops.json')) || null,
      quota_waits: estatus && estatus.quota_state ? (estatus.quota_state.waits || 0) : 0,
      cost_usd: estatus ? (estatus.cost_usd || null) : null,
      worktree: exec.worktree || null,
      branch: exec.branch || null,
      base_commit: exec.base_commit || null
    },
    delivery: {
      branch: exec.branch || null,
      commits_on_origin: commits.length ? commits.every(function (c) { return c.on_origin; }) : null,
      note: 'Task-branch commits reach GitHub through the governance relay (mythos-git-push.timer, fast-forward only, every 5 min) and are NOT merged to main; merging is a human decision.'
    }
  };
  var check = schema.validate(redact.redactValue(report), REPORT_SCHEMA);
  if (!check.valid) throw new Error('REPORT_SCHEMA_INVALID: ' + check.errors.join('; '));
  return report;
}

function renderReportMarkdown(report) {
  var l = [];
  l.push('# Report ' + report.task_id + ' — ' + report.status);
  l.push('');
  l.push('| Field | Value |');
  l.push('|---|---|');
  l.push('| Completed | ' + report.completed_at + ' |');
  l.push('| Executor task | `' + (report.execution.executor_task_id || '—') + '` |');
  l.push('| OTHMODE task | `' + (report.execution.othmode_task_id || '—') + '` |');
  l.push('| Attempt | `' + (report.attempt_id || '—') + '` |');
  l.push('| Action | ' + (report.resolution ? report.resolution.requested_action + ' (source ' + report.resolution.action_source + (report.resolution.action_raw ? ', written "' + report.resolution.action_raw + '"' : '') + ')' : '—') + ' |');
  l.push('| Profile | ' + (report.execution.execution_profile || '—') + ' |');
  l.push('| Blocker | ' + (report.blocker ? '`' + report.blocker.code + '` ' + String(report.blocker.reason || '').replace(/\|/g, '\\|').slice(0, 300) : '—') + ' |');
  l.push('| Runtime | ' + (report.runtime_identity ? '`' + String(report.runtime_identity.head || '?').slice(0, 12) + '` on `' + (report.runtime_identity.branch || '?') + '`' + (report.runtime_identity.code ? ' **' + report.runtime_identity.code + '**' : '') : 'RUNTIME_IDENTITY_UNVERIFIED') + ' |');
  l.push('| Model | `' + (report.execution.model || '—') + '` (' +
    (report.execution.model_selection_reason || report.execution.model_selection_mode || 'no selection recorded') + ') |');
  l.push('| Branch | `' + (report.delivery.branch || '—') + '` |');
  l.push('| Commits on origin | ' + String(report.delivery.commits_on_origin) + ' |');
  l.push('| Git verified | ' + String(report.validation.git_verified) + ' |');
  l.push('');
  l.push('## Summary');
  l.push('');
  l.push(report.summary);
  l.push('');
  l.push('## Commits');
  l.push('');
  l.push(report.commits.length ? report.commits.map(function (c) { return '- `' + c.sha + '` ' + c.subject + (c.on_origin ? ' (on origin)' : ' (awaiting relay)'); }).join('\n') : '- none');
  l.push('');
  l.push('## Files changed');
  l.push('');
  l.push(report.files_changed.length ? report.files_changed.map(function (f) { return '- `' + f + '`'; }).join('\n') : '- none');
  l.push('');
  l.push('## Tests');
  l.push('');
  l.push(bullets(report.tests, 'none reported'));
  l.push('');
  l.push('## Validation');
  l.push('');
  l.push('- required checks: ' + (report.validation.required_checks.length ? report.validation.required_checks.join('; ') : 'none'));
  l.push('- remote head: ' + (report.validation.remote_head || '—'));
  l.push('- report problems: ' + (report.validation.report_problems.length ? report.validation.report_problems.join('; ') : 'none'));
  l.push('');
  l.push('## Problems');
  l.push('');
  l.push(bullets(report.problems, 'none'));
  l.push('');
  l.push('## Risks');
  l.push('');
  l.push(bullets(report.risks, 'none reported'));
  l.push('');
  l.push('## Next recommended action');
  l.push('');
  l.push(report.next_recommended_action);
  l.push('');
  return redact.redact(l.join('\n'));
}

function writeReport(cfg, report) {
  writeJsonRedacted(reportFile(cfg, report.task_id, 'json'), report);
  writeAtomic(reportFile(cfg, report.task_id, 'md'), renderReportMarkdown(report));
  return [reportFile(cfg, report.task_id, 'json'), reportFile(cfg, report.task_id, 'md')];
}

// --- Index (what an external reader looks at first) --------------------------------------------

function writeIndex(cfg, tasksById, extras) {
  var p = paths(cfg);
  var ids = Object.keys(tasksById).sort();
  var counts = {};
  TASK_STATUSES.forEach(function (s) { counts[s] = 0; });
  var rows = ids.map(function (id) {
    var t = tasksById[id];
    counts[t.status] = (counts[t.status] || 0) + 1;
    var hasReport = fs.existsSync(reportFile(cfg, id, 'json'));
    var lastHist = Array.isArray(t.history) && t.history.length ? t.history[t.history.length - 1] : null;
    return {
      task_id: id,
      status: t.status,
      priority: t.priority,
      requested_action: t.requested_action,
      action_source: t.action_source || null,
      execution_profile: t.execution ? (t.execution.execution_profile || null) : null,
      model: t.execution ? (t.execution.model || null) : (t.model || null),
      blocker: t.execution && t.execution.blocker ? t.execution.blocker.code : null,
      created_at: t.created_at,
      created_by: t.created_by,
      updated_at: lastHist ? lastHist.at : t.created_at,
      executor_task_id: t.execution ? (t.execution.executor_task_id || null) : null,
      branch: t.execution ? (t.execution.branch || null) : null,
      task_file: cfg.prefix + '/tasks/' + id + '.json',
      report_file: hasReport ? cfg.prefix + '/reports/' + id + '.json' : null,
      // Origin of the task when it was converted from a GitHub Issue (github-issues.js);
      // null for planner-written tasks. The relation Issue ⇄ task ⇄ executor ⇄ report
      // is readable from this one row.
      source: t.source && typeof t.source === 'object' ? { kind: t.source.kind || null, issue_number: t.source.issue_number || null, issue_url: t.source.issue_url || null, issue_state: t.source.issue_state || null } : null
    };
  });
  var idx = {
    protocol: PROTOCOL,
    generated_at: nowIso(),
    generated_by: cfg.claimedBy,
    branch: cfg.branch,
    project: cfg.project,
    counts: counts,
    pending: rows.filter(function (r) { return r.status === 'PENDING'; }).map(function (r) { return r.task_id; }),
    active: rows.filter(function (r) { return ['CLAIMED', 'IN_PROGRESS', 'VALIDATING'].indexOf(r.status) !== -1; }).map(function (r) { return r.task_id; }),
    awaiting_review: rows.filter(function (r) { return TERMINAL.indexOf(r.status) !== -1 && r.report_file; }).map(function (r) { return r.task_id; }),
    tasks: rows,
    notes: extras && extras.notes ? extras.notes : [],
    how_to: {
      create_task: 'Add ' + cfg.prefix + '/tasks/<task_id>.json (schema: ' + cfg.prefix + '/schemas/task.schema.json) with status PENDING on branch ' + cfg.branch + '.',
      read_report: cfg.prefix + '/reports/<task_id>.json (and .md) appears when the task reaches COMPLETED, BLOCKED, FAILED or CANCELLED.',
      cancel_task: 'Set status to CANCELLED in the task file while it is PENDING, CLAIMED or IN_PROGRESS.',
      protocol_doc: cfg.prefix + '/README.md'
    }
  };
  writeJsonRedacted(p.stateJson, idx);
  var md = [];
  md.push('# MYTHOS control — current state');
  md.push('');
  md.push('Generated ' + idx.generated_at + ' by the bridge on branch `' + cfg.branch + '` (project `' + cfg.project + '`). Machine-readable twin: `' + cfg.prefix + '/state.json`. Protocol: `' + cfg.prefix + '/README.md`.');
  md.push('');
  md.push('| Status | Count |');
  md.push('|---|---|');
  TASK_STATUSES.forEach(function (s) { md.push('| ' + s + ' | ' + counts[s] + ' |'); });
  md.push('');
  md.push('| Task | Status | Action | Priority | Created | Updated | Executor task | Report |');
  md.push('|---|---|---|---|---|---|---|---|');
  rows.slice().reverse().forEach(function (r) {
    md.push('| `' + r.task_id + '` | **' + r.status + '** | ' + r.requested_action + ' | ' + r.priority + ' | ' + r.created_at + ' | ' + r.updated_at + ' | `' + (r.executor_task_id || '—') + '` | ' + (r.report_file ? '`' + r.report_file + '`' : '—') + ' |');
  });
  if (idx.notes.length) {
    md.push('');
    md.push('## Notes');
    md.push('');
    idx.notes.forEach(function (n) { md.push('- ' + n); });
  }
  md.push('');
  writeAtomic(p.stateMd, redact.redact(md.join('\n')));
  return [p.stateJson, p.stateMd];
}

// --- Cancellation (mirrors the executor's /cancel route, same semantics) ---------------------------

function cancelExecutorTask(eid) {
  var st = state.readStatus(eid);
  if (!st) return { cancelled: false, reason: 'no executor record' };
  if (['COMPLETED', 'FAILED', 'CANCELLED'].indexOf(st.status) !== -1) return { cancelled: false, reason: 'already ' + st.status };
  if (st.status === 'RUNNING' && st.pid && state.processAlive(st.pid)) {
    try { process.kill(st.pid, 'SIGTERM'); } catch (e) { /* raced its exit */ }
  }
  state.transition(eid, 'CANCELLED', { pid: null, ended_at: nowIso(), next_action: 'cancelled via GitHub control task' });
  return { cancelled: true };
}

// --- One scheduler step ----------------------------------------------------------------

function finishTask(cfg, task, finalStatus, opts, changed) {
  var from = task.status;
  if (from !== 'VALIDATING') pushHistory(task, from, 'VALIDATING', 'executor ended ' + ((opts && opts.executor_status) || finalStatus) + '; building report');
  task.status = 'VALIDATING';
  var report;
  try {
    report = buildReport(cfg, task, finalStatus, opts);
  } catch (e) {
    task.execution = task.execution || {};
    task.execution.validation_problem = String(e.message).slice(0, 300);
    task.execution.updated_at = nowIso();
    saveTask(cfg, task);
    changed.push(taskFile(cfg, task.task_id));
    log('report_failed', { task_id: task.task_id, error: e.message });
    return;
  }
  var oth = othmodeFinish(task.execution && task.execution.othmode_task_id, finalStatus, report);
  if (oth.premature) {
    // Detected early closure: the evidence is kept on the REPORT and the gap
    // is a recorded problem, never a silent one.
    report.problems = uniq(report.problems.concat(['othmode: ' + oth.reason]));
  }
  report.execution.othmode_closed_by_bridge = oth.updated === true;
  var files = writeReport(cfg, report);
  // The REPORT is on disk and the task status is decided BEFORE a
  // notification exists. This call only appends a durable ledger entry (or
  // does nothing at all when WhatsApp is disabled or already notified for
  // this task+kind); the message itself leaves the host later, from
  // flushNotifications(). Nothing here can change `finalStatus`.
  var notified = { queued: false, skipped: 'notification layer unavailable' };
  try {
    notified = whatsapp.onReport(report, { human_approval: !!(opts && opts.human_approval) });
  } catch (e) {
    notified = { queued: false, error: String(e && e.message).slice(0, 200) };
  }
  if (notified.queued || notified.error) log('whatsapp_queued', { task_id: task.task_id, result: notified });
  pushHistory(task, 'VALIDATING', finalStatus, 'report written (' + report.commits.length + ' commit(s), ' + report.tests.length + ' test line(s)); OTHMODE ' +
    (oth.updated ? 'closed by the bridge' : (oth.premature ? 'CLOSED PREMATURELY by the session (recorded as a problem)' : 'not updated: ' + oth.reason)));
  task.status = finalStatus;
  task.execution = task.execution || {};
  task.execution.executor_status = (opts && opts.executor_status) || null;
  if (report.blocker) task.execution.blocker = { code: report.blocker.code, reason: String(report.blocker.reason || '').slice(0, 500), retryable: report.blocker.retryable === true };
  task.execution.report_file = cfg.prefix + '/reports/' + task.task_id + '.json';
  task.execution.updated_at = nowIso();
  delete task.execution.validation_problem;
  saveTask(cfg, task);
  changed.push(taskFile(cfg, task.task_id));
  files.forEach(function (f) { changed.push(f); });
  log('finished', { task_id: task.task_id, status: finalStatus, executor_task_id: task.execution.executor_task_id, commits: report.commits.length,
    blocker: report.blocker ? report.blocker.code : null, requested_action: task.requested_action, execution_profile: task.execution.execution_profile || null, model: report.execution.model || null });
  if (task.execution.executor_task_id) {
    lifecycle.emit({ type: 'REPORT_SUBMITTED', task_id: task.execution.executor_task_id, correlation_id: task.task_id, report_status: finalStatus.toLowerCase(),
      report_ref: cfg.prefix + '/reports/' + task.task_id + '.json', github_issue: task.source && task.source.kind === 'github-issue' ? task.source.issue_number : null,
      location: 'VPS', source: 'github-bridge', evidence: { commits: report.commits.length, branch: task.execution.branch || null } });
  }
}

function tick(executor, opts) {
  opts = opts || {};
  try { userGuard(); } catch (e) { return { ok: false, reason: e.message }; }
  var cfg = config();
  var lock = acquireLock(cfg);
  if (!lock) return { ok: false, reason: 'another bridge process holds the lock' };
  var actions = [];
  var notes = [];
  try {
    var sync = syncControl(cfg);
    actions.push({ action: 'sync', result: sync });
    heartbeatLock(cfg);
    var claimsAllowed = sync.ok;
    var deferReason = sync.ok ? null : 'sync';
    if (!sync.ok) { notes.push('control branch not reconciled: ' + sync.reason + ' — no new claims this tick'); log('sync_failed', { reason: sync.reason }); }
    var runtime = runtimeIdentity(cfg);
    var gate = runtimeGate(runtime, cfg);
    actions.push({ action: 'runtime', head: runtime.head, branch: runtime.branch, code: runtime.code, verified: runtime.verified, stale: runtime.stale, claims_allowed: gate.claims_allowed, gate_mode: gate.mode });
    if (runtime.code) {
      notes.push('runtime identity: ' + runtime.code + ' — ' + gate.reason);
      log('runtime_identity', { code: runtime.code, reason: runtime.reason, head: runtime.head, branch: runtime.branch, checkout: runtime.checkout, strict: cfg.strictRuntime, claims_allowed: gate.claims_allowed, gate: gate.reason });
      if (!gate.claims_allowed && claimsAllowed) { claimsAllowed = false; deferReason = 'runtime:' + runtime.code; }
    }

    var changed = [];
    var tasksById = {};
    var entries = listTaskFiles(cfg).map(function (f) { return loadTask(cfg, f); });

    // Pass 1: unreadable or invalid files → a FAILED report, once per content hash.
    entries.forEach(function (e) {
      if (e.parse_error) {
        var name = safeName(e.file);
        var existing = readJsonFile(reportFile(cfg, name, 'json'));
        if (existing && existing.execution && existing.execution.task_hash === e.hash) return;
        var rep = {
          protocol: PROTOCOL, task_id: name, status: 'FAILED', summary: 'Task file ' + cfg.prefix + '/tasks/' + e.file + ' is not valid JSON and was not executed.',
          files_changed: [], commits: [], tests: [], validation: { git_verified: null, remote_head: null, report_problems: [], required_checks: [] },
          problems: [e.parse_error], risks: [], next_recommended_action: 'Fix the file or replace it with a valid task under a new task_id.',
          completed_at: nowIso(), execution: { task_hash: e.hash, source_file: e.file }, delivery: { branch: null, commits_on_origin: null, note: 'nothing executed' }
        };
        writeReport(cfg, rep).forEach(function (f) { changed.push(f); });
        actions.push({ action: 'reject_unparseable', file: e.file });
        return;
      }
      var t = e.task;
      var id = t && t.task_id;
      if (isValidTaskId(id) && e.file === id + '.json') tasksById[id] = t;
    });

    // Pass 2: state machine per task, in creation order (priority first).
    var weight = { high: 0, normal: 1, low: 2 };
    var ordered = entries.filter(function (e) { return !e.parse_error; }).sort(function (a, b) {
      var pw = (weight[a.task.priority] === undefined ? 1 : weight[a.task.priority]) - (weight[b.task.priority] === undefined ? 1 : weight[b.task.priority]);
      return pw !== 0 ? pw : String(a.task.created_at || '').localeCompare(String(b.task.created_at || ''));
    });

    ordered.forEach(function (e) {
      var t = e.task;
      var claimed = t && t.execution && t.execution.executor_task_id;
      var hasHistory = t && Array.isArray(t.history) && t.history.length;

      // Never-claimed file: the creator's word — validate it.
      if (!claimed && !hasHistory) {
        if (t && t.status === 'CANCELLED' && isValidTaskId(t.task_id)) {
          actions.push({ action: 'cancelled_before_claim', task_id: t.task_id });
          return;
        }
        var errors = validateTask(cfg, t, e.file);
        if (errors.length) {
          var name = isValidTaskId(t && t.task_id) && e.file === t.task_id + '.json' ? t.task_id : safeName(e.file);
          var prior = readJsonFile(reportFile(cfg, name, 'json'));
          if (prior && prior.execution && prior.execution.task_hash === e.hash) return;
          var rep = {
            protocol: PROTOCOL, task_id: name, status: 'FAILED',
            summary: 'Task ' + e.file + ' was rejected by validation and was not executed.',
            files_changed: [], commits: [], tests: [], validation: { git_verified: null, remote_head: null, report_problems: [], required_checks: [] },
            problems: errors, risks: [], next_recommended_action: 'Create a corrected task under a NEW task_id (task ids are single-use).',
            completed_at: nowIso(), execution: { task_hash: e.hash, source_file: e.file }, delivery: { branch: null, commits_on_origin: null, note: 'nothing executed' }
          };
          writeReport(cfg, rep).forEach(function (f) { changed.push(f); });
          if (name === (t && t.task_id)) {
            pushHistory(t, t.status, 'FAILED', 'validation: ' + errors.join('; ').slice(0, 800));
            t.status = 'FAILED';
            t.execution = { validation_failed: true, report_file: cfg.prefix + '/reports/' + name + '.json', updated_at: nowIso() };
            saveTask(cfg, t);
            changed.push(taskFile(cfg, name));
            tasksById[name] = t;
          }
          actions.push({ action: 'reject_invalid', file: e.file, errors: errors });
          return;
        }
        // Valid PENDING task.
        if (!claimsAllowed) {
          actions.push({ action: 'defer', task_id: t.task_id, reason: deferReason, detail: deferReason === 'sync' ? sync.reason : gate.reason });
          if (deferReason !== 'sync') log('claim_deferred', { task_id: t.task_id, reason: deferReason, detail: gate.reason, runtime_head: runtime.head });
          return;
        }
        if (opts.claimLimit !== undefined && actions.filter(function (a) { return a.action === 'claim'; }).length >= opts.claimLimit) {
          actions.push({ action: 'defer', task_id: t.task_id, reason: 'claim limit' });
          return;
        }
        var unmet = (t.depends_on || []).filter(function (d) { return !tasksById[d] || tasksById[d].status !== 'COMPLETED'; });
        if (unmet.length) { actions.push({ action: 'wait_dependencies', task_id: t.task_id, unmet: unmet }); return; }
        try {
          var c = claimTask(cfg, executor, e, tasksById, runtime);
          if (c.blocked) {
            // The decision cannot run: BLOCKED with a structured report and no
            // executor task, no worktree, no provider. Never retried by itself.
            var b = c.blocked;
            t.execution = { attempt_id: b.attempt_id, requested_action: t.requested_action, action_source: t.action_source || 'task_file', action_raw: t.action_raw || null,
              execution_profile: b.execution_profile || engine.profileFor(t.requested_action), expected_profile: b.expected_profile || engine.profileFor(t.requested_action),
              model_requested: b.requested_model || t.model || null, model_source: t.model_source || (t.model ? 'task_file' : 'none'), executor_task_id: null, runtime: runtime, fence: currentFence(), claimed_by: cfg.claimedBy, updated_at: nowIso() };
            pushHistory(t, 'PENDING', 'BLOCKED', b.code + ': ' + String(b.reason).slice(0, 600));
            finishTask(cfg, t, 'BLOCKED', {
              executor_status: null, blocker: b,
              summary: b.code + ' — ' + b.reason + ' Nothing was executed.',
              problems: [],
              structured_report: reporting.synthesize({ status: 'blocked', synthesized_by: 'github-bridge', task_id: t.task_id, attempt_id: b.attempt_id,
                requested_action: t.requested_action, action_raw: t.action_raw || null, action_source: t.action_source || 'task_file',
                execution_profile: b.execution_profile || null, model: null, blocker: b, summary: b.code + ': ' + b.reason,
                next_stage: b.code === 'MODEL_UNAVAILABLE'
                  ? 'either enable the model on this host (config/model-policy.json) or state another `Model:` explicitly, then add the `rerun` label — the request is never substituted'
                  : 'fix the action/profile decision (see resolution) and add the `rerun` label; this blocker is never retried automatically' }),
              next: b.code === 'MODEL_UNAVAILABLE'
                ? 'Human decision: enable ' + (b.model_id || b.requested_model) + ' on this host or choose one of: ' + (b.available_models || []).join(', ') + '. Then add the `rerun` label.'
                : 'Human decision: the attempt\'s action/profile decision is inconsistent (' + b.reason + '). Fix and add the `rerun` label.'
            }, changed);
            tasksById[t.task_id] = t;
            actions.push({ action: 'blocked_preflight', task_id: t.task_id, code: b.code, reason: String(b.reason).slice(0, 300) });
            log('blocked_preflight', { task_id: t.task_id, attempt_id: b.attempt_id, code: b.code, reason: b.reason, requested_action: t.requested_action, execution_profile: b.execution_profile || null, expected_profile: b.expected_profile || null, actual_profile: b.actual_profile || null, requested_model: b.requested_model || null, available_models: b.available_models || null });
            return;
          }
          changed.push(c.file);
          actions.push({ action: 'claim', task_id: t.task_id, executor_task_id: t.execution.executor_task_id, recovered: c.recovered, attempt_id: t.execution.attempt_id, requested_action: t.requested_action, action_source: t.execution.action_source, execution_profile: t.execution.execution_profile, model: t.execution.model || null, fence: t.execution.fence });
        } catch (err) {
          log('claim_failed', { task_id: t.task_id, error: err.message });
          actions.push({ action: 'claim_failed', task_id: t.task_id, error: String(err.message).slice(0, 300) });
        }
        return;
      }

      // Claimed (or otherwise bridge-touched) task: the executor's word.
      if (!isValidTaskId(t.task_id) || e.file !== t.task_id + '.json') return;
      if (TERMINAL.indexOf(t.status) !== -1 && t.status !== 'CANCELLED') {
        if (!fs.existsSync(reportFile(cfg, t.task_id, 'json')) && claimed) {
          finishTask(cfg, t, t.status, { executor_status: t.execution.executor_status }, changed);
          return;
        }
        // Delivery follow-up: the relay pushes the task branch AFTER the
        // report was written, so re-measure `on_origin` until every commit
        // is confirmed on GitHub, then record it once. Measured, never claimed.
        if (claimed) {
          var rep = readJsonFile(reportFile(cfg, t.task_id, 'json'));
          if (rep && rep.delivery && rep.delivery.commits_on_origin === false) {
            var fresh = commitsOnBranch(cfg, t.execution);
            if (fresh.length && fresh.every(function (c) { return c.on_origin; })) {
              rep.commits = fresh;
              rep.delivery.commits_on_origin = true;
              rep.delivery.confirmed_on_origin_at = nowIso();
              writeReport(cfg, rep).forEach(function (f) { changed.push(f); });
              actions.push({ action: 'delivery_confirmed', task_id: t.task_id, commits: fresh.length });
            }
          }
        }
        return;
      }
      if (!claimed) return; // validation-failed record; nothing to track
      var eid = t.execution.executor_task_id;
      var st = state.readStatus(eid);

      // External cancellation request.
      if (t.status === 'CANCELLED') {
        if (fs.existsSync(reportFile(cfg, t.task_id, 'json'))) return;
        var cx = st ? cancelExecutorTask(eid) : { cancelled: false, reason: 'no executor record' };
        finishTask(cfg, t, 'CANCELLED', { executor_status: st ? state.readStatus(eid).status : null, summary: 'Cancelled by the task creator; executor: ' + (cx.cancelled ? 'cancelled' : cx.reason), next: 'none' }, changed);
        actions.push({ action: 'cancel', task_id: t.task_id, executor: cx });
        return;
      }

      if (!st) {
        // Claim exists on GitHub, executor record gone: never re-execute silently.
        finishTask(cfg, t, 'BLOCKED', {
          executor_status: null,
          summary: 'The claim for this task exists but the executor record ' + eid + ' is missing on this host (store or host loss). The task was NOT re-executed.',
          problems: ['executor record missing: ' + eid],
          next: 'A human decides: create a new task (new task_id) to redo the work, or mark this one CANCELLED.',
          // The one bridge state that stops for a person rather than for a
          // machine: notified as HUMAN_APPROVAL, not as an ordinary BLOCKED.
          human_approval: true
        }, changed);
        actions.push({ action: 'blocked_missing_executor', task_id: t.task_id });
        return;
      }

      var eff = state.effectiveStatus(st) === 'INTERRUPTED' ? 'RUNNING' : st.status;
      var mapped = STATUS_MAP[eff] || 'IN_PROGRESS';
      if (TERMINAL.indexOf(mapped) !== -1) {
        finishTask(cfg, t, mapped, { executor_status: st.status }, changed);
        actions.push({ action: 'finish', task_id: t.task_id, status: mapped });
        return;
      }
      // Drift check: a claimed task edited afterwards is noticed once, never re-read.
      var fp = taskFingerprint(t);
      var dirty = false;
      if (t.execution.fingerprint && fp !== t.execution.fingerprint && !t.execution.drift_noted) {
        var snap = t.execution.snapshot_sha256 ? engine.checkSnapshot({
          task_id: t.task_id, attempt_id: t.execution.attempt_id, requested_action: t.requested_action, action_raw: t.action_raw || null, action_source: t.execution.action_source,
          execution_profile: t.execution.execution_profile, model: t.model || null, objective: t.objective, scope: t.scope, constraints: t.constraints,
          validation_requirements: t.validation_requirements, notes: t.notes || null
        }, t.execution.snapshot_sha256) : { ok: true };
        pushHistory(t, t.status, t.status, snap.ok
          ? 'task edited after claim; the executor keeps the snapshot it was given'
          : 'ATTEMPT_SNAPSHOT_MUTATED: the decision fields (action/profile/model/inputs) were edited after the claim; the executor keeps and re-verifies the snapshot it was given — the edit is NOT obeyed');
        t.execution.drift_noted = true;
        if (!snap.ok) t.execution.snapshot_mutated = { at: nowIso(), expected: t.execution.snapshot_sha256, observed: snap.sha256 };
        dirty = true;
      }
      // Lease check: a claim whose lease (executor timeout + grace) has run out
      // while the executor still reports it non-terminal is recorded ONCE —
      // with the executor's own state — and never silently re-claimed or
      // re-executed. Recovery of the run itself belongs to the executor
      // (INTERRUPTED → WAITING_RETRY, quota resume); the bridge only makes
      // the overrun visible on the task, the log and the index.
      var lease = t.execution.lease;
      if (lease && lease.expires_at && !lease.expired_noted_at && Date.parse(lease.expires_at) < Date.now()) {
        var overrun = Math.round((Date.now() - Date.parse(lease.expires_at)) / 60000);
        lease.expired_noted_at = nowIso();
        lease.expired_executor_status = st.status;
        pushHistory(t, t.status, t.status, 'LEASE_EXPIRED: claim lease ' + lease.expires_at + ' passed ' + overrun + ' min ago while the executor reports ' + st.status +
          (st.retry_at ? ' (retry_at ' + st.retry_at + ')' : '') + (st.quota_state && st.quota_state.resume_after ? ' (quota resume ' + st.quota_state.resume_after + ')' : '') +
          ' — the attempt is not re-claimed or re-run; the executor owns its recovery');
        log('lease_expired', { task_id: t.task_id, attempt_id: t.execution.attempt_id, executor_task_id: eid, executor_status: st.status, expires_at: lease.expires_at, overrun_min: overrun, fence: t.execution.fence });
        actions.push({ action: 'lease_expired', task_id: t.task_id, executor_status: st.status, expires_at: lease.expires_at });
        dirty = true;
      }
      if (mapped !== t.status || t.execution.executor_status !== st.status) {
        if (mapped !== t.status) pushHistory(t, t.status, mapped, 'executor ' + st.status + (st.next_action ? ': ' + String(st.next_action).slice(0, 200) : ''));
        t.status = mapped;
        t.execution.executor_status = st.status;
        t.execution.claude_session_id = st.claude_session_id || null;
        t.execution.updated_at = nowIso();
        dirty = true;
        actions.push({ action: 'progress', task_id: t.task_id, status: mapped, executor_status: st.status });
      }
      if (dirty) { saveTask(cfg, t); changed.push(taskFile(cfg, t.task_id)); }
    });

    if (changed.length) {
      writeIndex(cfg, tasksById, { notes: notes }).forEach(function (f) { changed.push(f); });
      var msg = 'control: ' + uniq(actions.filter(function (a) { return a.task_id; }).map(function (a) { return a.action + ' ' + a.task_id; })).join(', ').slice(0, 200);
      var commit = commitControl(cfg, uniq(changed), msg + '\n\nWritten by the MYTHOS GitHub bridge (' + cfg.claimedBy + '). Delivery: governance relay.');
      actions.push({ action: 'commit', result: commit });
    } else if (opts.forceIndex) {
      var idxFiles = writeIndex(cfg, tasksById, { notes: notes });
      actions.push({ action: 'commit', result: commitControl(cfg, idxFiles, 'control: refresh state index') });
    }
    return { ok: true, actions: actions, head: git(cfg.controlDir, ['rev-parse', 'HEAD']).out };
  } finally {
    releaseLock(lock);
  }
}

// --- Notification delivery (strictly out of band) ---------------------------------------------

// Runs AFTER tick() has already returned: the control branch is committed,
// every status is decided, and nothing that happens here can change any of
// it. Always resolves — a rejection would be a way for a WhatsApp outage to
// reach the caller, which is exactly what this layer must not do.
function flushNotifications(opts) {
  var promise;
  try {
    promise = whatsapp.flush(opts);
  } catch (e) {
    return Promise.resolve({ ok: false, error: String(e && e.message).slice(0, 300) });
  }
  return promise.then(function (r) {
    if (r && (r.attempted || r.reclaimed || r.problems || r.error)) log('whatsapp_flush', r);
    return r;
  }, function (e) {
    var r = { ok: false, error: String(e && e.message).slice(0, 300) };
    log('whatsapp_flush', r);
    return r;
  });
}

// --- Bootstrap of the control branch (idempotent) -------------------------------------------------

function init(opts) {
  opts = opts || {};
  userGuard();
  var cfg = config();
  var dir = cfg.controlDir;
  if (!fs.existsSync(dir)) {
    var remoteHas = git(cfg.repo, ['ls-remote', '--heads', cfg.remote, cfg.branch], { timeout: 60000 });
    var localHas = git(cfg.repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/' + cfg.branch]).ok;
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    var r;
    if (localHas) {
      r = git(cfg.repo, ['worktree', 'add', dir, cfg.branch]);
    } else if (remoteHas.ok && remoteHas.out) {
      git(cfg.repo, ['fetch', '--quiet', cfg.remote, cfg.branch], { timeout: 120000 });
      r = git(cfg.repo, ['worktree', 'add', '--track', '-b', cfg.branch, dir, cfg.remote + '/' + cfg.branch]);
    } else {
      // Orphan branch: the control channel carries ONLY control/ files.
      r = git(cfg.repo, ['worktree', 'add', '--detach', dir]);
      if (r.ok) r = git(dir, ['checkout', '--orphan', cfg.branch]);
      if (r.ok) git(dir, ['rm', '-r', '-q', '--cached', '.']);
      if (r.ok) {
        fs.readdirSync(dir).forEach(function (n) {
          if (n === '.git') return;
          fs.rmSync(path.join(dir, n), { recursive: true, force: true });
        });
      }
    }
    if (!r.ok) throw new Error('CONTROL_WORKTREE: ' + r.error);
  }
  var p = paths(cfg);
  fs.mkdirSync(p.tasks, { recursive: true });
  fs.mkdirSync(p.reports, { recursive: true });
  fs.mkdirSync(path.join(p.root, 'schemas'), { recursive: true });
  var files = [];
  ['task.schema.json', 'report.schema.json'].forEach(function (n) {
    var target = path.join(p.root, 'schemas', n);
    fs.copyFileSync(path.join(__dirname, 'schemas', n), target);
    files.push(target);
  });
  var readmeSrc = path.join(__dirname, 'README.md');
  if (fs.existsSync(readmeSrc)) {
    fs.copyFileSync(readmeSrc, path.join(p.root, 'README.md'));
    files.push(path.join(p.root, 'README.md'));
  }
  [p.tasks, p.reports].forEach(function (d) {
    var keep = path.join(d, '.gitkeep');
    if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
    files.push(keep);
  });
  var tasksById = {};
  listTaskFiles(cfg).forEach(function (f) {
    var e = loadTask(cfg, f);
    if (e.task && isValidTaskId(e.task.task_id)) tasksById[e.task.task_id] = e.task;
  });
  // The index is regenerated only when absent: init must be idempotent, and
  // every tick that changes something regenerates it anyway.
  if (!fs.existsSync(p.stateJson)) writeIndex(cfg, tasksById, {}).forEach(function (f) { files.push(f); });
  var lock = acquireLock(cfg);
  if (!lock) throw new Error('another bridge process holds the lock');
  try {
    var commit = commitControl(cfg, files, 'control: bootstrap ' + PROTOCOL + ' channel (schemas, README, state index)');
  } finally { releaseLock(lock); }
  return { control_dir: dir, branch: cfg.branch, commit: commit };
}

function status() {
  var cfg = config();
  var out = { config: cfg, control_head: null, origin_head: null, tasks: [] };
  if (fs.existsSync(cfg.controlDir)) {
    out.control_head = git(cfg.controlDir, ['rev-parse', 'HEAD']).out || null;
    var o = git(cfg.controlDir, ['rev-parse', '--verify', '--quiet', cfg.remote + '/' + cfg.branch]);
    out.origin_head = o.ok ? o.out : null;
    listTaskFiles(cfg).forEach(function (f) {
      var e = loadTask(cfg, f);
      out.tasks.push({
        file: f, task_id: e.task ? e.task.task_id : null, status: e.task ? e.task.status : 'unparseable',
        executor_task_id: e.task && e.task.execution ? e.task.execution.executor_task_id : null,
        executor_status: e.task && e.task.execution && e.task.execution.executor_task_id
          ? (state.readStatus(e.task.execution.executor_task_id) || {}).status || 'missing' : null
      });
    });
  }
  return out;
}

// --- Audit trail (reconstructed from durable records, no guessing) ----------------------------
//
// Issue received → Action resolved → Profile resolved → Model resolved → Task
// created → Task claimed → Provider started → Provider finished → Report
// generated → GitHub updated. Every entry names its source record and reason.
function trail(taskId, cfgIn) {
  var cfg = cfgIn || config();
  var e = fs.existsSync(taskFile(cfg, taskId)) ? loadTask(cfg, taskId + '.json') : null;
  var t = e && e.task;
  if (!t) return { task_id: taskId, found: false, events: [] };
  var out = [];
  function add(at, stage, reason, src, extra) { out.push(Object.assign({ at: at || null, stage: stage, reason: reason || null, source: src }, extra || {})); }
  var s = t.source || {};
  (s.events || []).forEach(function (ev) { add(ev.at, ev.event, ev.reason, 'control/tasks/' + taskId + '.json#source.events'); });
  if (!s.events || !s.events.length) add(t.created_at, 'task_created', 'written by ' + t.created_by, 'control/tasks/' + taskId + '.json');
  (t.history || []).forEach(function (h) {
    var stage = h.to === 'CLAIMED' ? 'task_claimed' : (h.to === 'VALIDATING' ? 'report_building' : (['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'].indexOf(h.to) !== -1 ? 'report_generated' : 'status_' + String(h.to).toLowerCase()));
    add(h.at, stage, (h.from || '?') + ' → ' + h.to + (h.note ? ': ' + h.note : ''), 'control/tasks/' + taskId + '.json#history', { by: h.by });
  });
  var ex = t.execution || {};
  if (ex.executor_task_id) {
    var raw = state.readText(ex.executor_task_id, 'events.log');
    String(raw || '').split('\n').filter(Boolean).forEach(function (line) {
      var ev; try { ev = JSON.parse(line); } catch (err) { return; }
      var map = { created: 'executor_task_created', model_selected: 'model_selected', provider_launch: 'provider_started', finished: 'provider_finished', preflight_blocked: 'provider_refused',
        quota_exhausted: 'provider_paused_quota', transient_failure: 'provider_retry_scheduled', blocked_failure: 'provider_finished', fatal_failure: 'provider_finished', retries_exhausted: 'provider_finished', transition: null };
      var stage = map[ev.event] === undefined ? 'executor_' + ev.event : map[ev.event];
      if (!stage) return;
      var reason = ev.event === 'model_selected' ? (ev.mode + ' → ' + ev.model + (ev.requested ? ' (requested ' + ev.requested + ')' : '')) :
        ev.event === 'preflight_blocked' ? (ev.code + ': ' + (ev.reason || '')) :
        ev.event === 'finished' ? ('status ' + ev.status) : (ev.status ? 'status ' + ev.status : null);
      add(ev.ts || ev.at || null, stage, reason, 'executor:' + ex.executor_task_id + '/events.log', { event: ev.event });
    });
  }
  var rep = readJsonFile(reportFile(cfg, taskId, 'json'));
  if (rep) add(rep.completed_at, 'report_generated', rep.status + (rep.blocker ? ' ' + rep.blocker.code : ''), 'control/reports/' + taskId + '.json');
  var nf = s.notifications || {};
  ['created', 'claimed', 'report', 'delivered'].forEach(function (k) {
    if (nf[k] && nf[k].at) add(nf[k].at, 'github_updated', k + ' comment ' + (nf[k].existed ? 'adopted' : 'posted') + (nf[k].status ? ' (' + nf[k].status + ')' : ''), 'control/tasks/' + taskId + '.json#source.notifications.' + k);
  });
  out.sort(function (a, b) { return String(a.at || '').localeCompare(String(b.at || '')); });
  return {
    task_id: taskId, found: true, status: t.status, attempt_id: ex.attempt_id || attemptIdOf(t),
    decision: { requested_action: t.requested_action, action_raw: t.action_raw || null, action_source: ex.action_source || t.action_source || 'task_file', execution_profile: ex.execution_profile || engine.profileFor(t.requested_action),
      model: ex.model || null, model_requested: ex.model_requested || t.model || null, model_source: ex.model_source || t.model_source || null, blocker: ex.blocker || (rep && rep.blocker) || null },
    runtime: ex.runtime || null,
    events: out
  };
}

function daemon(executor) {
  userGuard();
  var cfg = config();
  var stopping = false;
  var busy = false;
  var flushing = false;
  function step() {
    if (stopping || busy) return;
    busy = true;
    try {
      var r = tick(executor);
      var meaningful = (r.actions || []).filter(function (a) { return a.action !== 'sync' || (a.result && a.result.action !== 'up-to-date'); });
      if (meaningful.length || !r.ok) console.log(JSON.stringify(redact.redactValue({ ts: nowIso(), tick: r.ok ? meaningful : r })));
    } catch (e) {
      console.error(JSON.stringify({ ts: nowIso(), tick_error: redact.redact(e.message) }));
    }
    busy = false;
    // The tick is over; only now may anything reach a WhatsApp gateway, and
    // it runs on its own guard so a slow provider delays the next
    // NOTIFICATION attempt and never the next tick.
    if (!flushing) {
      flushing = true;
      flushNotifications().then(function () { flushing = false; }, function () { flushing = false; });
    }
  }
  var timer = setInterval(step, cfg.intervalMs);
  step();
  function shutdown() { stopping = true; clearInterval(timer); process.exit(0); }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  console.log(JSON.stringify({ ts: nowIso(), bridge: 'daemon started', pid: process.pid, interval_ms: cfg.intervalMs, control: cfg.controlDir, branch: cfg.branch }));
}

module.exports = {
  PROTOCOL: PROTOCOL,
  TASK_STATUSES: TASK_STATUSES,
  TERMINAL: TERMINAL,
  PROFILE_BY_ACTION: PROFILE_BY_ACTION,
  DELIVERY_BY_ACTION: DELIVERY_BY_ACTION,
  STATUS_MAP: STATUS_MAP,
  engine: engine,
  runtimeIdentity: runtimeIdentity,
  runtimeGate: runtimeGate,
  preflight: preflight,
  attemptIdOf: attemptIdOf,
  heartbeatLock: heartbeatLock,
  assertLockOwned: assertLockOwned,
  currentFence: currentFence,
  readLock: readLock,
  trail: trail,
  config: config,
  userGuard: userGuard,
  acquireLock: acquireLock,
  releaseLock: releaseLock,
  log: log,
  nowIso: nowIso,
  readJsonFile: readJsonFile,
  taskFile: taskFile,
  reportFile: reportFile,
  listTaskFiles: listTaskFiles,
  loadTask: loadTask,
  saveTask: saveTask,
  applyPushGuard: applyPushGuard,
  effectivePushUrls: effectivePushUrls,
  NO_PUSH_URL: NO_PUSH_URL,
  othmodeFinish: othmodeFinish,
  paths: paths,
  isValidTaskId: isValidTaskId,
  validateTask: validateTask,
  buildInstruction: buildInstruction,
  taskFingerprint: taskFingerprint,
  findExecutorTask: findExecutorTask,
  syncControl: syncControl,
  commitControl: commitControl,
  ensureTaskWorktree: ensureTaskWorktree,
  buildReport: buildReport,
  renderReportMarkdown: renderReportMarkdown,
  writeIndex: writeIndex,
  tick: tick,
  init: init,
  status: status,
  daemon: daemon,
  whatsapp: whatsapp,
  flushNotifications: flushNotifications
};
