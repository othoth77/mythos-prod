'use strict';
// =====================================================
// Mythos Orchestrator — Git / worktree safety
// projects/mythos-orchestrator/lib/git.js
//
// Every guard the orchestrator applies before letting a provider write to
// a worktree. The rule this file exists to enforce: never launch two
// writers into the same worktree, and never start work from a baseline
// that is not actually checked out.
//
// All commands run with an explicit cwd and argv array (execFileSync, not
// a shell string) so a branch or path can never be interpreted as shell
// syntax.
// =====================================================

var cp = require('child_process');
var fs = require('fs');
var path = require('path');

function git(args, cwd, opts) {
  opts = opts || {};
  try {
    var out = cp.execFileSync('git', args, {
      cwd: cwd,
      encoding: 'utf8',
      timeout: opts.timeout || 120000,
      stdio: ['ignore', 'pipe', opts.captureStderr ? 'pipe' : 'ignore']
    });
    return { ok: true, out: (out || '').trim() };
  } catch (e) {
    return { ok: false, out: '', error: (e.stderr || e.message || '').toString().trim() };
  }
}

function isRepo(cwd) {
  return fs.existsSync(cwd) && git(['rev-parse', '--git-dir'], cwd).ok;
}

function head(cwd) { var r = git(['rev-parse', 'HEAD'], cwd); return r.ok ? r.out : null; }

function currentBranch(cwd) { var r = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd); return r.ok ? r.out : null; }

// Absolute path of the repository's shared Git directory.
//
// For a LINKED worktree this is the main repository's .git, not something
// inside the worktree: linked worktrees keep their HEAD/index/FETCH_HEAD
// under <main>/.git/worktrees/<name>/, and all objects and refs in
// <main>/.git. A sandboxed worker whose writable root is only the worktree
// therefore cannot fetch or commit until this directory is also writable.
function commonDir(cwd) {
  var r = git(['rev-parse', '--git-common-dir'], cwd);
  if (!r.ok || !r.out) return null;
  return path.resolve(cwd, r.out);
}

// True when the repository's Git directory lives outside the working
// directory, i.e. this is a linked worktree rather than a standalone clone.
function gitDirIsExternal(cwd) {
  var common = commonDir(cwd);
  if (!common) return false;
  return path.resolve(common).indexOf(path.resolve(cwd) + path.sep) !== 0;
}

function isDirty(cwd) {
  var r = git(['status', '--porcelain'], cwd);
  if (!r.ok) return true; // unknown state is treated as unsafe
  return r.out.length > 0;
}

function fetch(cwd) { return git(['fetch', 'origin', '--quiet'], cwd, { timeout: 180000 }); }

function remoteBranchHead(cwd, branch) {
  var r = git(['ls-remote', '--heads', 'origin', branch], cwd, { timeout: 120000 });
  if (!r.ok || !r.out) return null;
  return r.out.split(/\s+/)[0] || null;
}

function localBranchExists(cwd, branch) {
  return git(['rev-parse', '--verify', '--quiet', 'refs/heads/' + branch], cwd).ok;
}

function commitExists(cwd, sha) {
  if (!/^[0-9a-f]{7,40}$/.test(String(sha || ''))) return false;
  var r = git(['cat-file', '-e', sha + '^{commit}'], cwd);
  return r.ok;
}

function isAncestor(cwd, ancestor, descendant) {
  return git(['merge-base', '--is-ancestor', ancestor, descendant], cwd).ok;
}

function changedFiles(cwd, fromSha, toSha) {
  var r = git(['diff', '--name-only', fromSha, toSha], cwd);
  if (!r.ok) return [];
  return r.out.split('\n').filter(Boolean);
}

// Lists every worktree registered on the repository, as
// [{ path, head, branch }]. Used for collision detection.
function listWorktrees(cwd) {
  var r = git(['worktree', 'list', '--porcelain'], cwd);
  if (!r.ok) return [];
  var entries = [];
  var current = null;
  r.out.split('\n').forEach(function (line) {
    if (line.indexOf('worktree ') === 0) {
      if (current) entries.push(current);
      current = { path: line.slice(9).trim(), head: null, branch: null };
    } else if (line.indexOf('HEAD ') === 0 && current) {
      current.head = line.slice(5).trim();
    } else if (line.indexOf('branch ') === 0 && current) {
      current.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    }
  });
  if (current) entries.push(current);
  return entries;
}

// The full pre-flight a task must pass before a provider is launched.
// Returns { ok, blockers[], warnings[], facts{} }. Never mutates anything.
function preflight(task, opts) {
  opts = opts || {};
  var blockers = [];
  var warnings = [];
  var wd = task.working_directory;
  var facts = {};

  if (!isRepo(wd)) {
    return {
      ok: false,
      blockers: ['WORKTREE_MISSING: ' + wd + ' is not a Git worktree'],
      warnings: warnings,
      facts: facts
    };
  }

  // A task must never be able to write into /tmp as its authoritative store.
  var resolved = path.resolve(wd);
  if (resolved === '/tmp' || resolved.indexOf('/tmp/') === 0) {
    blockers.push('EPHEMERAL_WORKTREE: ' + resolved + ' is under /tmp and cannot hold authoritative work');
  }

  if (!opts.skipFetch) {
    var f = fetch(wd);
    if (!f.ok) warnings.push('FETCH_FAILED: continuing with the last known remote state');
  }

  facts.head = head(wd);
  facts.branch = currentBranch(wd);
  facts.dirty = isDirty(wd);

  if (facts.branch === 'main' || facts.branch === 'master') {
    blockers.push('PROTECTED_BRANCH: refusing to run a provider directly on ' + facts.branch);
  }

  if (task.branch && facts.branch !== task.branch) {
    blockers.push('BRANCH_MISMATCH: worktree is on "' + facts.branch + '" but the task requires "' + task.branch + '"');
  }

  if (facts.dirty) {
    blockers.push('DIRTY_WORKTREE: ' + wd + ' has uncommitted changes; refusing to overwrite another agent\'s work');
  }

  if (!commitExists(wd, task.baseline_commit)) {
    blockers.push('BASELINE_MISSING: ' + String(task.baseline_commit).slice(0, 12) + ' does not exist in this repository');
  } else if (facts.head !== task.baseline_commit) {
    blockers.push('BASELINE_MISMATCH: worktree HEAD is ' + String(facts.head).slice(0, 12) +
      ' but the task declares baseline ' + String(task.baseline_commit).slice(0, 12));
  }

  // Two writers must never share a worktree, and a branch may only be
  // checked out in one worktree at a time.
  var worktrees = listWorktrees(wd);
  facts.worktrees = worktrees.length;
  worktrees.forEach(function (w) {
    if (w.branch === task.branch && path.resolve(w.path) !== resolved) {
      blockers.push('BRANCH_COLLISION: branch "' + task.branch + '" is already checked out at ' + w.path);
    }
  });

  return { ok: blockers.length === 0, blockers: blockers, warnings: warnings, facts: facts };
}

module.exports = {
  git: git,
  isRepo: isRepo,
  head: head,
  currentBranch: currentBranch,
  commonDir: commonDir,
  gitDirIsExternal: gitDirIsExternal,
  isDirty: isDirty,
  fetch: fetch,
  remoteBranchHead: remoteBranchHead,
  localBranchExists: localBranchExists,
  commitExists: commitExists,
  isAncestor: isAncestor,
  changedFiles: changedFiles,
  listWorktrees: listWorktrees,
  preflight: preflight
};
