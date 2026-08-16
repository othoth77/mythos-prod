'use strict';
// =====================================================
// Mythos Orchestration Core — isolated git worktrees (Phase 2G)
// projects/mythos-ai-executor/core/worktrees.js
//
// "Never allow two independent coding agents to unknowingly write to the
// same working tree" (vision §10). Every parallel coding task gets its
// own linked worktree on its own branch:
//
//   /home/ubuntu/mythos-ai-executor/worktrees/<mission-id>/<task-id>/
//   branch mythos/<mission-id>/<task-id>
//
// Removal never blindly destroys work: a dirty worktree is refused
// unless force is explicitly passed, and even then the branch survives
// (branches are the rollback path — only the checkout directory goes).
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var domain = require('./domain');
var store = require('./store');
var gitlib = require('../../mythos-orchestrator/lib/git');

function worktreesRoot() {
  return path.join(
    process.env.MYTHOS_EXECUTOR_HOME || path.join(os.homedir(), 'mythos-ai-executor'),
    'worktrees'
  );
}

function git(repoPath, args) {
  return cp.execFileSync('git', args, { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function worktreeDir(missionId, taskId) {
  if (!domain.isValidId(missionId) || !domain.isValidId(taskId)) {
    throw new Error('INVALID_ID_FOR_WORKTREE');
  }
  return path.join(worktreesRoot(), missionId, taskId);
}

function branchName(missionId, taskId) {
  return 'mythos/' + missionId + '/' + taskId;
}

// Creates an isolated worktree for a task. Refuses to reuse a directory
// that already exists (two writers must never share) unless it is the
// recorded worktree for this very task being resumed.
function create(repoPath, missionId, taskId, baseRef) {
  if (!gitlib.isRepo(repoPath)) throw new Error('NOT_A_REPO: ' + repoPath);
  var dir = worktreeDir(missionId, taskId);
  var branch = branchName(missionId, taskId);
  if (fs.existsSync(dir)) {
    // Resume path: same task, same branch — verify it really is ours.
    var head = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (head === branch) {
      return { dir: dir, branch: branch, reused: true };
    }
    throw new Error('WORKTREE_CONFLICT: ' + dir + ' exists with branch ' + head);
  }
  fs.mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
  var base = baseRef || git(repoPath, ['rev-parse', 'HEAD']);
  git(repoPath, ['worktree', 'add', '-b', branch, dir, base]);
  store.appendEventLine({
    event_type: 'WORKTREE_CREATED', subject_id: taskId,
    detail: { dir: dir, branch: branch, base: base, mission_id: missionId }
  });
  return { dir: dir, branch: branch, base: base, reused: false };
}

function isDirty(dir) {
  return git(dir, ['status', '--porcelain']).length > 0;
}

// Removes a worktree checkout. A dirty tree is refused without force;
// the branch is NEVER deleted here — it is the audit/rollback record.
function remove(repoPath, missionId, taskId, opts) {
  opts = opts || {};
  var dir = worktreeDir(missionId, taskId);
  if (!fs.existsSync(dir)) return { removed: false, reason: 'absent' };
  if (isDirty(dir) && !opts.force) {
    return { removed: false, reason: 'dirty — refusing to destroy uncommitted changes without force' };
  }
  git(repoPath, ['worktree', 'remove', opts.force ? '--force' : '--porcelain', dir].filter(function (a) {
    return a !== '--porcelain'; // 'remove' has no porcelain flag; keep argv clean
  }));
  store.appendEventLine({
    event_type: 'WORKTREE_REMOVED', subject_id: taskId,
    detail: { dir: dir, forced: !!opts.force }
  });
  return { removed: true };
}

function list(repoPath) {
  var out = git(repoPath, ['worktree', 'list', '--porcelain']);
  return out.split('\n\n').filter(Boolean).map(function (block) {
    var lines = block.split('\n');
    var entry = {};
    lines.forEach(function (l) {
      var sp = l.indexOf(' ');
      if (sp === -1) entry[l] = true;
      else entry[l.slice(0, sp)] = l.slice(sp + 1);
    });
    return entry;
  });
}

module.exports = {
  worktreesRoot: worktreesRoot,
  worktreeDir: worktreeDir,
  branchName: branchName,
  create: create,
  remove: remove,
  list: list,
  isDirty: isDirty
};
