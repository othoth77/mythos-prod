'use strict';
// =====================================================
// MYTHOS Autopilot — facade + tick
// projects/mythos-ai-executor/lib/autopilot/index.js
//
// One bounded cycle, always in this order, always under the `tick` lock:
//
//   inspect git ──▶ drift ──▶ [git-sync if enabled] ──▶ drift again
//     ──▶ restart request / [governed restart] ──▶ task watchdog
//     ──▶ worktree plan / [apply if enabled] ──▶ unified state ──▶ ledger
//
// Enablement (house pattern: env kill switch > env on > marker > off):
//   MYTHOS_AUTOPILOT=off                 everything observes, nothing mutates
//   <root>/sync.enabled                  AUTO fast-forward of the checkout
//   <root>/worktrees.enabled             AUTO removal of safe task worktrees
//   <root>/restart.auto.enabled          policy self-approval of restarts
// Without a marker every capability still RUNS and REPORTS — observe mode —
// so the first days of operation are proof, not trust.
//
// Root: MYTHOS_AUTOPILOT_HOME, else <executor home>/autopilot
// Files: state.json (current), ledger.jsonl (append-only changes + actions),
//        locks/, restart/{requests,approvals}/, last-fingerprint
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var lock = require('./lock');
var gitReconcile = require('./git-reconcile');
var drift = require('./drift');
var restart = require('./restart');
var watchdog = require('./watchdog');
var worktrees = require('./worktrees');
var status = require('./status');
var evidence = require('./evidence');
var testImpact = require('./test-impact');

function executorHome() {
  if (process.env.MYTHOS_EXECUTOR_HOME) return process.env.MYTHOS_EXECUTOR_HOME;
  try { return require('../state').root(); } catch (e) { return path.join(os.homedir(), 'mythos-ai-executor'); }
}
function root() { return process.env.MYTHOS_AUTOPILOT_HOME || path.join(executorHome(), 'autopilot'); }

function enablement(name) {
  var env = String(process.env.MYTHOS_AUTOPILOT || '').toLowerCase();
  if (env === 'off') return { enabled: false, reason: 'kill_switch_env' };
  var specific = String(process.env['MYTHOS_AUTOPILOT_' + name.toUpperCase()] || '').toLowerCase();
  if (specific === 'off') return { enabled: false, reason: 'kill_switch_env' };
  if (specific === 'on') return { enabled: true, reason: 'env' };
  try { fs.statSync(path.join(root(), name + '.enabled')); return { enabled: true, reason: 'marker' }; }
  catch (e) { return { enabled: false, reason: 'marker_absent' }; }
}

function enablementSummary() {
  var e = { autopilot: String(process.env.MYTHOS_AUTOPILOT || '').toLowerCase() === 'off' ? 'disabled' : 'enabled' };
  ['sync', 'worktrees'].forEach(function (n) { e[n] = enablement(n).enabled ? 'enabled' : 'disabled'; });
  e.restart_auto = restart.autoPolicy(root()).enabled ? 'enabled' : 'disabled';
  return e;
}

function appendLedger(rec) {
  try {
    fs.mkdirSync(root(), { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(root(), 'ledger.jsonl'), JSON.stringify(Object.assign({ at: new Date().toISOString() }, rec)) + '\n', { mode: 0o600 });
  } catch (e) { /* best-effort */ }
}
function writeState(st) {
  try {
    fs.mkdirSync(root(), { recursive: true, mode: 0o700 });
    var f = path.join(root(), 'state.json'), tmp = f + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(st, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, f);
  } catch (e) { /* best-effort */ }
}
function readState() { try { return JSON.parse(fs.readFileSync(path.join(root(), 'state.json'), 'utf8')); } catch (e) { return null; } }

function gitConfig(opts) {
  return gitReconcile.config(Object.assign({ expected_remote_url: process.env.MYTHOS_AUTOPILOT_REMOTE_URL || 'https://github.com/othoth77/mythos-prod' }, opts || {}));
}

function driftOpts(cfg, inspection, extra) {
  return Object.assign({
    inspection: inspection, git: cfg.git, repo: cfg.repo, branch: cfg.branch,
    executor_home: executorHome(),
    health_url: process.env.MYTHOS_AUTOPILOT_HEALTH_URL || ('http://127.0.0.1:' + (process.env.MYTHOS_EXECUTOR_PORT || '8130') + '/health')
  }, extra || {});
}

function detectDrift(cfg, extra) {
  var ins = gitReconcile.inspect(cfg);
  return drift.detect(driftOpts(cfg, ins, extra)).then(function (d) { d.inspection = ins; return d; });
}

function defaultRestartFn() {
  var cp = require('child_process');
  var unit = process.env.MYTHOS_AUTOPILOT_EXECUTOR_UNIT || 'mythos-ai-executor.service';
  var env = Object.assign({}, process.env);
  if (!env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = '/run/user/' + process.getuid();
  var r = cp.spawnSync('systemctl', ['--user', 'restart', unit], { encoding: 'utf8', env: env, timeout: 60000 });
  return { ok: r.status === 0 && !r.error, error: r.error ? r.error.message : (r.status !== 0 ? String(r.stderr || '').trim().slice(0, 300) : null) };
}

function bridgeInputs() {
  var home = executorHome();
  var claims = {};
  try { claims = JSON.parse(fs.readFileSync(path.join(home, 'bridge', 'claims.json'), 'utf8')) || {}; } catch (e) { claims = {}; }
  var tasks = [];
  var controlDir = process.env.MYTHOS_BRIDGE_CONTROL_DIR || '/home/deploy/worktrees/control';
  try {
    var dir = path.join(controlDir, 'control', 'tasks');
    fs.readdirSync(dir).filter(function (n) { return /\.json$/.test(n); }).forEach(function (n) { try { tasks.push(JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))); } catch (e) { /* skip */ } });
  } catch (e) { /* no control checkout */ }
  return { claims: claims, tasks: tasks };
}

// tick(opts) → Promise<summary>. Every mutation is gated twice: by its
// marker and by opts (tests inject git/state/restartFn/alive).
function tick(opts) {
  opts = opts || {};
  var R = root();
  var got = lock.acquire(R, 'tick', { stale_ms: opts.lock_stale_ms || 15 * 60 * 1000 });
  if (!got.acquired) return Promise.resolve({ skipped: true, reason: got.reason, holder: got.holder });
  var lk = got.lock;
  var held = function () { return lock.stillHeld(lk); };
  var cfg = gitConfig(opts.git_config);
  var state = opts.state || require('../state');
  var summary = { at: new Date().toISOString(), fence: lk.fence, actions: [] };
  var ins, d1, syncRec, d2, wd, wt, restartInfo;
  return detectDrift(cfg, opts.drift).then(function (d) {
    d1 = d; ins = d.inspection;
    var p = gitReconcile.plan(ins, cfg);
    var syncOn = enablement('sync');
    syncRec = gitReconcile.apply(cfg, p, { apply: syncOn.enabled && opts.apply !== false, stillHeld: held });
    syncRec.enablement = syncOn.reason;
    if (syncRec.applied) { summary.actions.push({ op: 'git-sync', from: syncRec.from, to: syncRec.target, verified: syncRec.verified }); appendLedger({ op: 'git-sync', decision: 'AUTO', from: syncRec.from, to: syncRec.target, applied: true, verified: syncRec.verified, code: syncRec.code, fence: lk.fence }); }
    else if (p.decision === 'BLOCKED') appendLedgerOnce('git-sync-blocked', { op: 'git-sync', decision: 'BLOCKED', code: p.code, reason: p.reason, from: p.from, target: p.target });
    else if (syncRec.code !== gitReconcile.CODES.NOOP) appendLedgerOnce('git-sync-dry', { op: 'git-sync', decision: syncRec.decision === 'BLOCKED' ? 'BLOCKED' : 'DRY_RUN', code: syncRec.code, plan_code: p.code, reason: syncRec.reason, from: p.from, target: p.target, enablement: syncOn.reason });
    return syncRec.applied ? detectDrift(cfg, opts.drift) : d1;
  }).then(function (d) {
    d2 = d; ins = d.inspection;
    var req = restart.request(R, d2);
    if (req.created) { summary.actions.push({ op: 'restart-request', expected_sha: req.record.expected_sha }); }
    var open = restart.openRequest(R);
    if (open && open.state === 'APPROVED' || (open && open.state === 'REQUIRED' && restart.autoPolicy(R).enabled)) {
      if (opts.apply === false) { restartInfo = { skipped: 'apply disabled' }; return; }
      return restart.apply(R, {
        expected_sha: open.expected_sha, detect: function () { return detectDrift(cfg, opts.drift); },
        restartFn: opts.restartFn || defaultRestartFn, executor_home: executorHome(), state: state,
        approval_auto: restart.autoPolicy(R), health_wait_ms: opts.health_wait_ms, health_poll_ms: opts.health_poll_ms
      }).then(function (r) {
        restartInfo = { code: r.code, ok: r.ok, vetoes: r.vetoes || null };
        summary.actions.push({ op: 'restart', code: r.code, ok: r.ok });
        if (r.ok) return detectDrift(cfg, opts.drift).then(function (dd) { d2 = dd; ins = dd.inspection; });
      });
    }
  }).then(function () {
    var bi = bridgeInputs();
    wd = watchdog.scan({ state: state, alive: opts.alive, claims: bi.claims, bridge_tasks: bi.tasks });
    wd.fresh.forEach(function (f) { appendLedger({ op: 'watchdog', code: f.code, mode: f.mode, task_id: f.task_id, detail: f.detail }); });
    var statusOf = function (id) { try { return state.readStatus(id); } catch (e) { return null; } };
    wt = worktrees.plan({ repo: cfg.repo, git: cfg.git, task_root: process.env.MYTHOS_BRIDGE_TASK_WORKTREES || path.join(executorHome(), 'worktrees', 'gh'), claims: bi.claims, status_of: statusOf, live_cwds: opts.live_cwds || liveCwds() });
    var wtOn = enablement('worktrees');
    var applied = worktrees.apply({ repo: cfg.repo, git: cfg.git, task_root: process.env.MYTHOS_BRIDGE_TASK_WORKTREES || path.join(executorHome(), 'worktrees', 'gh'), claims: bi.claims, status_of: statusOf, live_cwds: opts.live_cwds || liveCwds() }, wt, { apply: wtOn.enabled && opts.apply !== false, stillHeld: held });
    if (applied.applied) applied.records.forEach(function (r) { appendLedger(Object.assign({ op: 'worktree-reconcile', fence: lk.fence }, r)); summary.actions.push({ op: 'worktree-reconcile', kind: r.kind, target: r.path || r.branch, outcome: r.outcome }); });
    if (applied.applied) wt = worktrees.plan({ repo: cfg.repo, git: cfg.git, task_root: process.env.MYTHOS_BRIDGE_TASK_WORKTREES || path.join(executorHome(), 'worktrees', 'gh'), claims: bi.claims, status_of: statusOf, live_cwds: opts.live_cwds || liveCwds() });
    summary.worktrees = { summary: wt.summary, dry_run: !applied.applied, would_remove: applied.would_remove || null };
    var st = status.build({ drift: d2, inspection: ins, watchdog: wd, worktrees: wt, executor_home: executorHome(), enablement: enablementSummary(), sync: syncRec, restart: restart.status(R).open });
    var fp = status.fingerprint(st);
    var prev = readState();
    if (!prev || prev.fingerprint !== fp) appendLedger({ op: 'state-change', from: prev ? prev.fingerprint : null, to: fp, DEPLOYMENT: st.DEPLOYMENT.state, RUNTIME: st.RUNTIME.drift, EXECUTOR: st.EXECUTOR.state, TASKS: st.TASKS.state, WORKTREES: st.WORKTREES.state });
    st.fingerprint = fp;
    writeState(st);
    summary.state = st;
    summary.sync = { decision: syncRec.decision, code: syncRec.code, reason: syncRec.reason };
    summary.drift = d2.state;
    summary.restart = restartInfo || null;
    summary.watchdog = { state: wd.state, counts: wd.counts };
    return summary;
  }).then(function (s) { lock.release(lk); return s; }, function (e) { lock.release(lk); appendLedger({ op: 'tick-error', error: String(e && e.message).slice(0, 300) }); throw e; });
}

// A dedupe for repeating decisions: the same (key, code, from, target) is
// ledgered once until it changes.
var lastKeyed = {};
function appendLedgerOnce(key, rec) {
  var sig = key + '|' + rec.code + '|' + rec.from + '|' + rec.target;
  var f = path.join(root(), 'last-' + key);
  var prev = null;
  try { prev = fs.readFileSync(f, 'utf8'); } catch (e) { prev = lastKeyed[key] || null; }
  if (prev === sig) return false;
  appendLedger(rec);
  lastKeyed[key] = sig;
  try { fs.mkdirSync(root(), { recursive: true, mode: 0o700 }); fs.writeFileSync(f, sig, { mode: 0o600 }); } catch (e) { /* best-effort */ }
  return true;
}

// cwd of live processes we can read (same uid): best-effort veto input for
// worktree removal. Root sees everything; deploy sees deploy's.
function liveCwds() {
  var out = [];
  try {
    fs.readdirSync('/proc').filter(function (n) { return /^\d+$/.test(n); }).forEach(function (pid) {
      try { out.push(fs.readlinkSync('/proc/' + pid + '/cwd')); } catch (e) { /* not ours */ }
    });
  } catch (e) { /* no /proc */ }
  return out;
}

function ledgerTail(n) {
  try { var lines = fs.readFileSync(path.join(root(), 'ledger.jsonl'), 'utf8').trim().split('\n'); return lines.slice(-(n || 50)).map(function (l) { try { return JSON.parse(l); } catch (e) { return { raw: l }; } }); } catch (e) { return []; }
}

module.exports = {
  root: root, executorHome: executorHome, enablement: enablement, enablementSummary: enablementSummary,
  tick: tick, detectDrift: detectDrift, gitConfig: gitConfig, readState: readState, ledgerTail: ledgerTail, liveCwds: liveCwds, bridgeInputs: bridgeInputs, defaultRestartFn: defaultRestartFn,
  lock: lock, gitReconcile: gitReconcile, drift: drift, restart: restart, watchdog: watchdog, worktrees: worktrees, status: status, evidence: evidence, testImpact: testImpact
};
