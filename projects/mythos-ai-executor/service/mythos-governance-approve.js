#!/usr/bin/env node
'use strict';
// =====================================================
// Mythos — governance approval tool (ROOT ONLY)
// projects/mythos-ai-executor/service/mythos-governance-approve.js
//
// Source for the root-owned copy at /usr/local/bin/mythos-governance-approve.
// This is the ONLY way a valid approval comes into existence. It creates a
// signed record binding one decision to ONE commit sha and the exact
// protected paths that commit touches.
//
// What it refuses to do, by construction:
//   - run as anyone but root (a session user cannot create approvals);
//   - approve a commit that does not exist, or touches no protected path;
//   - approve paths a commit does not actually touch (no blanket approvals);
//   - accept a decider identity that looks automated;
//   - infer intent from a commit message. The message is never read.
//
// An approval is DATA ABOUT A SPECIFIC COMMIT. Amend the commit, rebase it,
// or write a second one, and the sha changes and the approval no longer
// applies. That is deliberate: it makes "approved once, delivered forever"
// impossible.
//
// Usage (owner, interactively):
//   sudo mythos-governance-approve --commit <sha> --by "<human name>" \
//        --reason "<why this governance change is acceptable>"
//   sudo mythos-governance-approve --list
//   sudo mythos-governance-approve --revoke <approval-id>
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var cp = require('child_process');

var KEY_FILE = process.env.MYTHOS_GOV_KEY || '/etc/mythos/governance.key';
var STORE_DIR = process.env.MYTHOS_GOV_STORE || '/var/lib/mythos/governance/approvals';
var AUDIT_LOG = process.env.MYTHOS_GOV_AUDIT || '/var/lib/mythos/governance/audit.log';
var REPO = process.env.MYTHOS_REPO || '/home/deploy/projects/mythos-prod';
var VERIFIER = process.env.MYTHOS_GOV_VERIFIER || '/usr/local/lib/mythos/governance-verify.js';

function die(msg, code) {
  process.stderr.write('mythos-governance-approve: ' + msg + '\n');
  process.exit(code === undefined ? 1 : code);
}

function arg(name) {
  var i = process.argv.indexOf('--' + name);
  return i === -1 ? null : process.argv[i + 1];
}

function audit(entry) {
  try {
    fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
    fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + '\n', { mode: 0o640 });
  } catch (e) { /* never let the audit write block the decision record */ }
}

if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
  die('must run as root (try: sudo mythos-governance-approve ...). ' +
      'A session user creating its own approval is precisely what this prevents.', 2);
}

var verifier;
try {
  verifier = require(VERIFIER);
} catch (e) {
  die('cannot load the root-owned verifier at ' + VERIFIER + ': ' + e.message);
}

// --- list / revoke -----------------------------------------------------------

if (process.argv.indexOf('--list') !== -1) {
  if (!fs.existsSync(STORE_DIR)) { process.stdout.write('no approvals\n'); process.exit(0); }
  fs.readdirSync(STORE_DIR).filter(function (f) { return /\.json$/.test(f); })
    .forEach(function (f) {
      var a = JSON.parse(fs.readFileSync(path.join(STORE_DIR, f), 'utf8'));
      process.stdout.write([a.approval_id, a.decision, String(a.commit).slice(0, 12),
        a.decided_by, (a.paths || []).join(' ')].join('  ') + '\n');
    });
  process.exit(0);
}

var revoke = arg('revoke');
if (revoke) {
  var rf = path.join(STORE_DIR, revoke + '.json');
  if (!fs.existsSync(rf)) die('no such approval: ' + revoke);
  fs.unlinkSync(rf);
  audit({ ts: new Date().toISOString(), action: 'REVOKED', approval_id: revoke,
    by: process.env.SUDO_USER || 'root' });
  process.stdout.write('revoked ' + revoke + '\n');
  process.exit(0);
}

// --- grant ---------------------------------------------------------------------

var commit = arg('commit');
var by = arg('by');
var reason = arg('reason');

if (!commit) die('--commit <sha> is required');
if (!by || by.trim().length < 3) die('--by "<human name>" is required: a decision needs a decider');
if (/^(claude|agent|automation|bot|system|n8n|mythos)\b/i.test(by.trim())) {
  die('--by must name a HUMAN. An automated identity cannot approve a governance change.', 2);
}
if (!reason || reason.trim().length < 10) {
  die('--reason "<why>" is required and must be a real sentence');
}

var full;
try {
  full = cp.execFileSync('git', ['-C', REPO, 'rev-parse', '--verify', commit + '^{commit}'],
    { encoding: 'utf8' }).trim();
} catch (e) {
  die('commit not found in ' + REPO + ': ' + commit);
}

// Only the paths this commit ACTUALLY touches, and only the protected ones.
// A blanket approval is not expressible through this tool.
var files;
try {
  files = cp.execFileSync('git', ['-C', REPO, 'show', '--pretty=format:', '--name-only', full],
    { encoding: 'utf8' }).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
} catch (e) {
  die('cannot read the commit diff: ' + e.message);
}
var protectedFiles = files.filter(verifier.isProtectedPath);
if (!protectedFiles.length) {
  die('commit ' + full.slice(0, 12) + ' touches no protected path — it needs no approval, ' +
      'and creating one would be a standing grant for nothing.');
}

var key;
try {
  key = fs.readFileSync(KEY_FILE);
} catch (e) {
  die('governance key unreadable at ' + KEY_FILE + ': ' + e.code);
}

var approval = {
  approval_id: 'ga-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'),
  commit: full,
  paths: protectedFiles.slice().sort(),
  decision: 'GRANTED',
  decided_by: by.trim(),
  reason: reason.trim().slice(0, 1000),
  created_at: new Date().toISOString(),
  created_by_uid: 0,
  sudo_user: process.env.SUDO_USER || null
};
approval.sig = verifier.sign(approval, key);

fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o750 });
var out = path.join(STORE_DIR, approval.approval_id + '.json');
fs.writeFileSync(out, JSON.stringify(approval, null, 2) + '\n', { mode: 0o640 });

audit({
  ts: approval.created_at, action: 'GRANTED', approval_id: approval.approval_id,
  commit: full, paths: approval.paths, decided_by: approval.decided_by,
  sudo_user: approval.sudo_user, reason: approval.reason
});

process.stdout.write('approved ' + approval.approval_id + '\n');
process.stdout.write('  commit : ' + full + '\n');
process.stdout.write('  paths  : ' + approval.paths.join(', ') + '\n');
process.stdout.write('  by     : ' + approval.decided_by + '\n');
