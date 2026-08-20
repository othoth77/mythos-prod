// =====================================================
// MYTHOS STATUS CENTER — read-only git fact collection
// projects/status-center/lib/gitfacts.js
//
// Strict allowlist of read-only git subcommands. The review engine
// never mutates the repository. Every fact carries how it was obtained;
// anything that cannot be obtained is reported NOT_VERIFIED, never
// guessed (order §0.11–0.16, §35).
// =====================================================
'use strict';

const { execFileSync } = require('child_process');

// Only these exact invocation shapes are permitted.
const ALLOWED = Object.freeze([
  'rev-parse', 'log', 'status', 'branch', 'cat-file', 'show', 'remote', 'tag'
]);

function git(repoRoot, args) {
  if (ALLOWED.indexOf(args[0]) === -1) {
    throw new Error('STC_GIT_DENIED: subcommand not allowlisted: ' + args[0]);
  }
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024
  }).trim();
}

function tryGit(repoRoot, args) {
  try {
    return { ok: true, value: git(repoRoot, args) };
  } catch (e) {
    return { ok: false, error: String(e.message || e).split('\n')[0] };
  }
}

// Collect the verifiable local git facts for a review.
function collect(repoRoot) {
  const facts = {
    collected: true,
    head: null,
    branch: null,
    origin_main: null,
    remote_url: null,
    worktree_clean: null,
    last_commit: null,
    recent_commits: [],
    commit_count: null,
    not_verified: []
  };

  let r = tryGit(repoRoot, ['rev-parse', 'HEAD']);
  if (r.ok) facts.head = r.value; else facts.not_verified.push('HEAD: ' + r.error);

  r = tryGit(repoRoot, ['branch', '--show-current']);
  if (r.ok) facts.branch = r.value; else facts.not_verified.push('branch: ' + r.error);

  r = tryGit(repoRoot, ['rev-parse', 'origin/main']);
  if (r.ok) facts.origin_main = r.value; else facts.not_verified.push('origin/main: ' + r.error);

  r = tryGit(repoRoot, ['remote', 'get-url', 'origin']);
  if (r.ok) facts.remote_url = r.value; else facts.not_verified.push('remote: ' + r.error);

  r = tryGit(repoRoot, ['status', '--porcelain']);
  if (r.ok) facts.worktree_clean = (r.value === ''); else facts.not_verified.push('status: ' + r.error);

  r = tryGit(repoRoot, ['log', '-1', '--date=iso-strict', '--pretty=%H%x09%ad%x09%s',
    'origin/main']);
  if (r.ok) {
    const p = r.value.split('\t');
    facts.last_commit = { hash: p[0], date: p[1], subject: p.slice(2).join('\t') };
  } else facts.not_verified.push('last commit: ' + r.error);

  r = tryGit(repoRoot, ['log', '--date=short', '--pretty=%h%x09%ad%x09%s', '-200',
    'origin/main']);
  if (r.ok) {
    facts.recent_commits = r.value.split('\n').filter(Boolean).map(function (line) {
      const p = line.split('\t');
      return { hash: p[0], date: p[1], subject: p.slice(2).join('\t') };
    });
  } else facts.not_verified.push('recent commits: ' + r.error);

  r = tryGit(repoRoot, ['rev-parse', '--is-inside-work-tree']);
  if (!r.ok || r.value !== 'true') {
    facts.collected = false;
    facts.not_verified.push('not a git worktree');
  }

  return facts;
}

// Verify a commit exists in the local object database (evidence check).
function commitExists(repoRoot, hash) {
  if (!/^[0-9a-f]{6,40}$/.test(hash)) return false;
  const r = tryGit(repoRoot, ['cat-file', '-e', hash + '^{commit}']);
  return r.ok;
}

module.exports = { collect: collect, commitExists: commitExists, tryGit: tryGit };
