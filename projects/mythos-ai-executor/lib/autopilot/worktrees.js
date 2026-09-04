'use strict';
// =====================================================
// MYTHOS Autopilot — worktree / branch reconciler
// projects/mythos-ai-executor/lib/autopilot/worktrees.js
//
// Classifies every linked worktree of the shared checkout and every local
// mythos/* branch, then plans. The audit found 85 worktrees and 50 task
// branches with no tool that ever removes one (MYTHOS_GITHUB_BRIDGE.md:
// "the bridge never deletes").
//
// A worktree is AUTO-removable only when ALL hold (fail-closed otherwise):
//   - it is a bridge TASK worktree (under the task-worktree root, branch
//     mythos/gh/*) — ownership is unambiguous; everything else is APPROVAL;
//   - its branch head is an ancestor of origin/main (merged);
//   - it is on origin (origin/<branch> exists and contains the head) — the
//     work is durable on GitHub; no unique commits exist anywhere;
//   - the tracked tree is clean (no local modifications to lose);
//   - no task is active on it (bridge claim → executor task non-terminal),
//     and it is not the current working directory of any live process we
//     can see (best effort: /proc cwd scan is optional, injected);
//   - it is older than min_age.
// Removal = `git worktree remove` (refuses a dirty tree by itself) and
// `git branch -d` (refuses an unmerged branch by itself). Remote branches
// are NEVER deleted here — GitHub is the owner's. Every removal is ledgered
// with path, branch, head and the evidence that made it safe.
// Applying requires opts.apply === true (marker `worktrees.enabled`).
// =====================================================

var fs = require('fs');
var path = require('path');

var TERMINAL = { COMPLETED: 1, FAILED: 1, BLOCKED: 1, CANCELLED: 1 };

function config(opts) {
  opts = opts || {};
  return {
    repo: opts.repo || process.env.MYTHOS_AUTOPILOT_REPO || '/home/deploy/projects/mythos-prod',
    remote: opts.remote || 'origin',
    main: opts.main || 'main',
    git: opts.git || require('./git-reconcile').defaultGit,
    task_root: opts.task_root || null,               // e.g. /home/deploy/mythos-ai-executor/worktrees/gh
    task_branch_prefix: opts.task_branch_prefix || 'mythos/gh/',
    min_age_ms: opts.min_age_ms === undefined ? 24 * 3600 * 1000 : opts.min_age_ms,
    claims: opts.claims || {},                       // bridge claims.json {task_id: {executor_task_id}}
    status_of: opts.status_of || function () { return null; }, // executor task id → status record
    live_cwds: opts.live_cwds || null,               // optional array of cwd paths of live processes
    now: opts.now || Date.now()
  };
}

function parseWorktreeList(out) {
  var items = [], cur = null;
  String(out || '').split('\n').forEach(function (line) {
    if (line.indexOf('worktree ') === 0) { cur = { path: line.slice(9), head: null, branch: null, bare: false, detached: false, locked: false, prunable: false }; items.push(cur); }
    else if (!cur) return;
    else if (line.indexOf('HEAD ') === 0) cur.head = line.slice(5);
    else if (line.indexOf('branch ') === 0) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'bare') cur.bare = true;
    else if (line === 'detached') cur.detached = true;
    else if (line.indexOf('locked') === 0) cur.locked = true;
    else if (line.indexOf('prunable') === 0) cur.prunable = true;
  });
  return items;
}

function classify(cfg) {
  var git = cfg.git;
  var wl = git(cfg.repo, ['worktree', 'list', '--porcelain']);
  var mainRef = 'refs/remotes/' + cfg.remote + '/' + cfg.main;
  var mainSha = git(cfg.repo, ['rev-parse', '--verify', '--quiet', mainRef]);
  var items = parseWorktreeList(wl.ok ? wl.out : '');
  var primary = items.length ? path.resolve(items[0].path) : path.resolve(cfg.repo);
  var out = [];
  items.forEach(function (w) {
    var rec = { path: w.path, branch: w.branch, head: w.head, primary: path.resolve(w.path) === primary, detached: w.detached, locked: w.locked, prunable: w.prunable,
      exists: fs.existsSync(w.path), task_worktree: false, task_id: null, merged: null, on_origin: null, unique_commits: null, clean: null, active_task: null, age_ms: null, in_use: null };
    if (rec.primary) { rec.decision = 'KEEP'; rec.code = 'PRIMARY_CHECKOUT'; out.push(rec); return; }
    rec.task_worktree = !!(cfg.task_root && path.resolve(w.path).indexOf(path.resolve(cfg.task_root) + path.sep) === 0 && w.branch && w.branch.indexOf(cfg.task_branch_prefix) === 0);
    if (rec.task_worktree) rec.task_id = w.branch.slice(cfg.task_branch_prefix.length);
    if (w.head && mainSha.ok) rec.merged = git(cfg.repo, ['merge-base', '--is-ancestor', w.head, mainSha.out]).ok;
    if (w.branch) {
      var remoteRef = 'refs/remotes/' + cfg.remote + '/' + w.branch;
      var rr = git(cfg.repo, ['rev-parse', '--verify', '--quiet', remoteRef]);
      // Durable on GitHub when origin/<branch> contains the head, OR when the head
      // is already inside origin/main (merged ⇒ on origin, whatever the branch ref).
      rec.on_origin = (rr.ok && w.head ? git(cfg.repo, ['merge-base', '--is-ancestor', w.head, rr.out]).ok : false) || rec.merged === true;
      if (mainSha.ok && w.head) { var c = git(cfg.repo, ['rev-list', '--count', w.head, '^' + mainSha.out].concat(rr.ok ? ['^' + rr.out] : [])); rec.unique_commits = c.ok ? parseInt(c.out, 10) : null; }
    }
    if (rec.exists) { var st = git(w.path, ['status', '--porcelain', '--untracked-files=no']); rec.clean = st.ok ? st.out === '' : null; }
    if (rec.task_id) {
      var claim = cfg.claims[rec.task_id];
      var s = claim && claim.executor_task_id ? cfg.status_of(claim.executor_task_id) : null;
      rec.active_task = s ? !TERMINAL[s.status] : false;
      rec.executor_task_id = claim ? claim.executor_task_id : null;
      rec.executor_status = s ? s.status : null;
    }
    try { rec.age_ms = cfg.now - fs.statSync(w.path).mtimeMs; } catch (e) { rec.age_ms = null; }
    if (cfg.live_cwds) rec.in_use = cfg.live_cwds.some(function (c) { return String(c).indexOf(path.resolve(w.path)) === 0; });
    decide(rec, cfg);
    out.push(rec);
  });
  return { measured_at: new Date(cfg.now).toISOString(), origin_main: mainSha.ok ? mainSha.out : null, worktrees: out, branches: classifyBranches(cfg, out, mainSha.ok ? mainSha.out : null) };
}

function decide(rec, cfg) {
  var block = function (code, mode) { rec.decision = mode || 'APPROVAL'; rec.code = code; };
  if (!rec.exists) return block('PATH_MISSING', 'APPROVAL');          // `git worktree prune` territory: a human confirms
  if (rec.locked) return block('LOCKED', 'KEEP');
  if (rec.detached || !rec.branch) return block('DETACHED', 'APPROVAL');
  if (rec.active_task) return block('TASK_ACTIVE', 'KEEP');
  if (rec.in_use) return block('IN_USE', 'KEEP');
  if (rec.clean !== true) return block('DIRTY_OR_UNREADABLE', 'MANUAL');
  if (rec.merged !== true) return block('NOT_MERGED', 'APPROVAL');
  if (rec.on_origin !== true) return block('NOT_ON_ORIGIN', 'APPROVAL');
  if (rec.unique_commits !== 0) return block('UNIQUE_COMMITS', 'APPROVAL');
  if (!rec.task_worktree) return block('OWNERSHIP_AMBIGUOUS', 'APPROVAL');
  if (rec.age_ms === null || rec.age_ms < cfg.min_age_ms) return block('TOO_RECENT', 'KEEP');
  rec.decision = 'AUTO'; rec.code = 'SAFE_MERGED_UNUSED';
}

// Local branches in the mythos/* namespace with no worktree: merged + on
// origin + no unique commits → AUTO `branch -d`; otherwise APPROVAL.
function classifyBranches(cfg, worktrees, mainSha) {
  var git = cfg.git;
  var r = git(cfg.repo, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/mythos/']);
  if (!r.ok || !r.out) return [];
  var attached = {};
  worktrees.forEach(function (w) { if (w.branch) attached[w.branch] = w; });
  return r.out.split('\n').filter(Boolean).map(function (line) {
    var p = line.split(' ');
    var b = { branch: p[0], head: p[1], has_worktree: !!attached[p[0]], merged: null, on_origin: null, unique_commits: null };
    if (mainSha) b.merged = git(cfg.repo, ['merge-base', '--is-ancestor', b.head, mainSha]).ok;
    var rr = git(cfg.repo, ['rev-parse', '--verify', '--quiet', 'refs/remotes/' + cfg.remote + '/' + b.branch]);
    b.on_origin = (rr.ok ? git(cfg.repo, ['merge-base', '--is-ancestor', b.head, rr.out]).ok : false) || b.merged === true;
    if (mainSha) { var c = git(cfg.repo, ['rev-list', '--count', b.head, '^' + mainSha].concat(rr.ok ? ['^' + rr.out] : [])); b.unique_commits = c.ok ? parseInt(c.out, 10) : null; }
    if (b.has_worktree) { b.decision = 'DEFER'; b.code = 'WORKTREE_ATTACHED'; }
    else if (b.merged && b.on_origin && b.unique_commits === 0 && b.branch.indexOf(cfg.task_branch_prefix) === 0) { b.decision = 'AUTO'; b.code = 'SAFE_MERGED_DELIVERED'; }
    else if (b.merged && b.on_origin && b.unique_commits === 0) { b.decision = 'APPROVAL'; b.code = 'OWNERSHIP_AMBIGUOUS'; }
    else { b.decision = 'APPROVAL'; b.code = b.merged ? 'NOT_ON_ORIGIN' : 'NOT_MERGED'; }
    return b;
  });
}

function plan(cfg) {
  cfg = config(cfg);
  var c = classify(cfg);
  var summary = { AUTO: 0, APPROVAL: 0, MANUAL: 0, KEEP: 0, DEFER: 0 };
  c.worktrees.forEach(function (w) { summary[w.decision] = (summary[w.decision] || 0) + 1; });
  c.branches.forEach(function (b) { summary[b.decision] = (summary[b.decision] || 0) + 1; });
  c.summary = summary;
  c.state = summary.AUTO || summary.APPROVAL || summary.MANUAL ? 'STALE' : 'HEALTHY';
  return c;
}

// apply(cfg, planned, opts) — removes AUTO worktrees and AUTO branches only,
// re-verifying each right before acting. Returns audit records.
function apply(cfg, planned, opts) {
  cfg = config(cfg); opts = opts || {};
  var git = cfg.git;
  var records = [];
  if (opts.apply !== true) return { applied: false, reason: 'dry_run', would_remove: planned.worktrees.filter(function (w) { return w.decision === 'AUTO'; }).map(function (w) { return w.path; }), would_delete: planned.branches.filter(function (b) { return b.decision === 'AUTO'; }).map(function (b) { return b.branch; }), records: records };
  var limit = opts.max_per_run || 5;
  planned.worktrees.filter(function (w) { return w.decision === 'AUTO'; }).slice(0, limit).forEach(function (w) {
    var rec = { kind: 'worktree', path: w.path, branch: w.branch, head: w.head, evidence: { merged: w.merged, on_origin: w.on_origin, unique_commits: w.unique_commits, clean: w.clean, task_id: w.task_id, executor_status: w.executor_status } };
    if (typeof opts.stillHeld === 'function' && !opts.stillHeld()) { rec.outcome = 'skipped'; rec.reason = 'lock lost'; records.push(rec); return; }
    // Re-verify immediately before acting (identity re-check).
    var cur = plan(Object.assign({}, cfg, { now: Date.now() })).worktrees.filter(function (x) { return x.path === w.path; })[0];
    if (!cur || cur.decision !== 'AUTO' || cur.head !== w.head) { rec.outcome = 'skipped'; rec.reason = 'state changed since plan: ' + (cur ? cur.code : 'gone'); records.push(rec); return; }
    var r = git(cfg.repo, ['worktree', 'remove', w.path]);   // no --force: git refuses dirty/locked trees itself
    if (!r.ok) { rec.outcome = 'failed'; rec.reason = r.error.slice(0, 300); records.push(rec); return; }
    rec.outcome = 'removed';
    var b = git(cfg.repo, ['branch', '-d', w.branch]);        // -d, never -D: git refuses unmerged
    rec.branch_deleted = b.ok; if (!b.ok) rec.branch_error = b.error.slice(0, 300);
    records.push(rec);
  });
  planned.branches.filter(function (b) { return b.decision === 'AUTO'; }).slice(0, limit).forEach(function (b) {
    var rec = { kind: 'branch', branch: b.branch, head: b.head, evidence: { merged: b.merged, on_origin: b.on_origin, unique_commits: b.unique_commits } };
    if (typeof opts.stillHeld === 'function' && !opts.stillHeld()) { rec.outcome = 'skipped'; rec.reason = 'lock lost'; records.push(rec); return; }
    var head = git(cfg.repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/' + b.branch]);
    if (!head.ok || head.out !== b.head) { rec.outcome = 'skipped'; rec.reason = 'branch moved since plan'; records.push(rec); return; }
    var r = git(cfg.repo, ['branch', '-d', b.branch]);
    rec.outcome = r.ok ? 'deleted' : 'failed'; if (!r.ok) rec.reason = r.error.slice(0, 300);
    records.push(rec);
  });
  return { applied: true, records: records };
}

module.exports = { config: config, classify: classify, plan: plan, apply: apply, decide: decide, parseWorktreeList: parseWorktreeList };
