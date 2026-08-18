#!/usr/bin/env node
'use strict';
// =====================================================
// Mythos — governance DELIVERY INVARIANT verifier
// projects/mythos-ai-executor/service/governance-verify.js
//
// This file is the SOURCE for a ROOT-OWNED copy at
// /usr/local/lib/mythos/governance-verify.js. The delivery relay runs the
// installed copy, never this one. That separation is the whole point:
//
//   Incident GI-2026-08-18-01 showed the governance cage was a
//   MISSION-ACCEPTANCE check, not a repository invariant. It only ran when
//   work arrived as a mission in a mission worktree, so an interactive
//   session committing straight to the main checkout was never evaluated at
//   all — and that is exactly how a caged file reached origin/main.
//
// The invariant is enforced HERE, at delivery, where every path to GitHub
// converges: mission commits, interactive commits, anything. If a commit
// touches a protected path and no valid persisted approval covers it, the
// push is DENIED — the work stays local, nothing is reverted, and the denial
// is recorded.
//
// Five properties this file exists to guarantee:
//
//   1. A COMMIT MESSAGE IS NOT AN APPROVAL. Nothing here reads the message.
//      A commit that says "owner-authorised" is treated exactly like one
//      that says nothing.
//   2. CHAT IS NOT AN APPROVAL. There is no channel from a conversation into
//      this check; only the signed on-disk store counts.
//   3. AN APPROVAL IS BOUND TO ONE COMMIT. The signature covers the commit
//      sha, so approving one change never approves the next.
//   4. THE PROTECTED LIST IS ROOT-OWNED. It is embedded below rather than
//      read from the repository, because a session that can edit the repo
//      could otherwise edit its own cage away. tests/ assert the embedded
//      list matches core/self-improve.js so drift is caught.
//   5. THE KEY IS UNREADABLE BY THE SESSION USER. Approvals are HMAC-signed
//      with a key at /etc/mythos/governance.key (root:deploy 0640). The
//      relay runs as `deploy` with NoNewPrivileges and can read it; a Claude
//      session runs as `ubuntu` and cannot. Forging therefore requires an
//      explicit privileged action rather than an ordinary file write.
//
// Residual, stated plainly: `ubuntu` currently has passwordless sudo, so a
// determined session could still read the key. That is a host configuration
// decision, not something this file can fix; every such use is logged by
// sudo and journald. Removing passwordless sudo for the session user is the
// recommended hardening.
//
// Usage (called by the relay):
//   governance-verify.js verify --repo <path> --range <base>..<tip>
//   exit 0 = deliverable, exit 3 = DENIED (protected + unapproved),
//   exit 1 = verifier error (fail closed: the relay must not deliver)
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var cp = require('child_process');

var KEY_FILE = process.env.MYTHOS_GOV_KEY || '/etc/mythos/governance.key';
var STORE_DIR = process.env.MYTHOS_GOV_STORE || '/var/lib/mythos/governance/approvals';
var DENY_LOG = process.env.MYTHOS_GOV_DENYLOG || '/var/lib/mythos/governance/denied.log';

// Root-owned copy of the caged surface. Deliberately NOT read from the
// repository — see property 4 above.
var PROTECTED_PATHS = [
  'projects/mythos-ai-executor/core/policy-engine.js',
  'projects/mythos-ai-executor/config/policy.json',
  'projects/mythos-ai-executor/lib/policy.js',
  'projects/mythos-ai-executor/core/tool-registry.js',
  'projects/mythos-ai-executor/core/budget.js',
  'projects/mythos-ai-executor/config/budgets.json',
  'projects/mythos-ai-executor/core/validation.js',
  'projects/mythos-ai-executor/core/events.js',
  'projects/mythos-ai-executor/core/store.js',
  'projects/mythos-ai-executor/lib/state.js',
  'projects/mythos-ai-executor/core/self-improve.js',
  'projects/mythos-ai-executor/core/campaign.js',
  'projects/mythos-ai-executor/core/campaign-runner.js',
  'projects/mythos-ai-executor/core/campaign-service.js',
  'projects/mythos-ai-executor/core/roadmap.js',
  'projects/mythos-ai-executor/core/core-wiring.js',
  'projects/mythos-ai-executor/service/',
  'projects/mythos-ai-executor/config/router.json',
  'projects/mythos-ai-executor/config/agents.json',
  'projects/mythos-ai-executor/core/agent-registry.js',
  'projects/mythos-ai-executor/core/provider-router.js',
  'projects/mythos-orchestrator/lib/redact.js',
  'mythos-git-push',
  '.github/',
  '.git/'
];

var PROTECTED_PATTERNS = [/credential/i, /secret/i, /\.env(\.|$)/i, /\.ssh\//i, /sudoers/i];

// Normalise before matching. A raw substring test is evadable with
// non-normalised forms (a/../b, ./a/b, absolute paths), and every one of
// those resolves to the same file on disk.
function isProtectedPath(p) {
  var raw = String(p).replace(/\\/g, '/');
  var norm;
  try { norm = path.posix.normalize(raw); } catch (e) { norm = raw; }
  norm = norm.replace(/^\.\//, '');
  var candidates = [norm, raw];
  return PROTECTED_PATHS.some(function (sp) {
    return candidates.some(function (c) { return c.indexOf(sp) !== -1; });
  }) || PROTECTED_PATTERNS.some(function (re) {
    return candidates.some(function (c) { return re.test(c); });
  });
}

function canonicalPayload(approval) {
  // Sorted paths and a fixed field order: two approvals with the same
  // meaning must produce the same bytes, or the signature is meaningless.
  return JSON.stringify({
    commit: String(approval.commit || '').toLowerCase(),
    paths: (approval.paths || []).map(String).sort(),
    decision: String(approval.decision || ''),
    decided_by: String(approval.decided_by || ''),
    created_at: String(approval.created_at || '')
  });
}

function readKey() {
  return fs.readFileSync(KEY_FILE);   // throws → caller fails closed
}

function sign(approval, key) {
  return crypto.createHmac('sha256', key).update(canonicalPayload(approval)).digest('hex');
}

function signatureValid(approval, key) {
  if (!approval || typeof approval.sig !== 'string') return false;
  var expect = sign(approval, key);
  var a = Buffer.from(expect, 'utf8');
  var b = Buffer.from(approval.sig, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function loadApprovals() {
  if (!fs.existsSync(STORE_DIR)) return [];
  return fs.readdirSync(STORE_DIR)
    .filter(function (f) { return /\.json$/.test(f); })
    .map(function (f) {
      try { return JSON.parse(fs.readFileSync(path.join(STORE_DIR, f), 'utf8')); }
      catch (e) { return null; }
    })
    .filter(Boolean);
}

function git(repo, args) {
  return cp.execFileSync('git', ['-C', repo].concat(args), { encoding: 'utf8' });
}

// Every commit in the range, with the protected paths each one touches.
function protectedCommitsInRange(repo, range) {
  var shas = git(repo, ['rev-list', range]).trim().split('\n').filter(Boolean);
  return shas.map(function (sha) {
    var files = git(repo, ['show', '--pretty=format:', '--name-only', sha])
      .split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var hits = files.filter(isProtectedPath);
    return { sha: sha, files: files, protected_files: hits };
  }).filter(function (c) { return c.protected_files.length > 0; });
}

// An approval covers a commit only if it is GRANTED, signed, names THAT
// commit, and covers every protected path the commit actually touches.
function approvalCovers(approval, commit, key) {
  if (!approval || approval.decision !== 'GRANTED') return false;
  if (String(approval.commit || '').toLowerCase() !== String(commit.sha).toLowerCase()) return false;
  if (!signatureValid(approval, key)) return false;
  var approved = (approval.paths || []).map(String);
  return commit.protected_files.every(function (f) {
    return approved.indexOf(f) !== -1;
  });
}

function verify(repo, range) {
  var key;
  try {
    key = readKey();
  } catch (e) {
    return { allowed: false, error: 'governance key unreadable: ' + e.code,
      denied: [], fail_closed: true };
  }
  var commits;
  try {
    commits = protectedCommitsInRange(repo, range);
  } catch (e) {
    return { allowed: false, error: 'range inspection failed: ' + String(e.message).slice(0, 200),
      denied: [], fail_closed: true };
  }
  if (!commits.length) return { allowed: true, denied: [], protected_commits: 0 };

  var approvals = loadApprovals();
  var denied = commits.filter(function (c) {
    return !approvals.some(function (a) { return approvalCovers(a, c, key); });
  });
  return {
    allowed: denied.length === 0,
    protected_commits: commits.length,
    denied: denied.map(function (c) {
      return { sha: c.sha, protected_files: c.protected_files };
    })
  };
}

function record(entry) {
  try {
    fs.mkdirSync(path.dirname(DENY_LOG), { recursive: true });
    fs.appendFileSync(DENY_LOG, JSON.stringify(entry) + '\n');
  } catch (e) { /* the deny itself must never depend on the log write */ }
}

module.exports = {
  PROTECTED_PATHS: PROTECTED_PATHS,
  isProtectedPath: isProtectedPath,
  canonicalPayload: canonicalPayload,
  sign: sign,
  signatureValid: signatureValid,
  approvalCovers: approvalCovers,
  protectedCommitsInRange: protectedCommitsInRange,
  verify: verify,
  record: record
};

if (require.main === module) {
  var argv = process.argv.slice(2);
  var cmd = argv[0];
  function arg(name) {
    var i = argv.indexOf('--' + name);
    return i === -1 ? null : argv[i + 1];
  }
  if (cmd !== 'verify') {
    process.stderr.write('usage: governance-verify.js verify --repo <path> --range <a>..<b>\n');
    process.exit(1);
  }
  var repo = arg('repo');
  var range = arg('range');
  var ref = arg('ref') || '(unspecified)';
  if (!repo || !range) {
    process.stderr.write('verify needs --repo and --range\n');
    process.exit(1);
  }
  var res = verify(repo, range);
  if (res.error) {
    process.stderr.write('GOVERNANCE VERIFIER ERROR (failing closed): ' + res.error + '\n');
    record({ ts: new Date().toISOString(), ref: ref, range: range, error: res.error });
    process.exit(1);
  }
  if (res.allowed) {
    process.stdout.write('governance: ok (' + (res.protected_commits || 0) +
      ' protected commit(s), all approved)\n');
    process.exit(0);
  }
  res.denied.forEach(function (d) {
    process.stderr.write('GOVERNANCE DENY ' + d.sha.slice(0, 12) + ' touches ' +
      d.protected_files.join(', ') + ' with no valid approval\n');
  });
  record({
    ts: new Date().toISOString(), ref: ref, range: range,
    decision: 'DENIED', denied: res.denied
  });
  process.exit(3);
}
