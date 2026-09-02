'use strict';
// =====================================================
// Mythos — governance DELIVERY INVARIANT suite
// tests/mythos-governance-invariant-test.js
//
// Closes GI-2026-08-18-01. The incident's finding was that the cage was a
// mission-acceptance check, so an interactive session committing to the main
// checkout was never evaluated. The invariant now lives at DELIVERY, where
// every route to GitHub converges, and this suite is the proof.
//
// The hostile cases matter more than the happy ones. Each of these is a way
// a Claude session could try to get a protected change delivered, and each
// must fail:
//   - just commit it (no approval at all);
//   - say "owner-authorised" in the commit message;
//   - write an approval file by hand;
//   - reuse a real approval issued for a different commit;
//   - reach the protected file through a non-normalised path;
//   - force the ref past the check.
//
// Offline: temp git repos, temp key and store. Never touches the real
// /etc/mythos key or /var/lib/mythos store (which this user cannot read
// anyway — that is itself asserted).
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var crypto = require('crypto');

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-gov-'));
var KEY_FILE = path.join(TMP, 'governance.key');
var STORE = path.join(TMP, 'approvals');
fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('base64'));
fs.mkdirSync(STORE, { recursive: true });

process.env.MYTHOS_GOV_KEY = KEY_FILE;
process.env.MYTHOS_GOV_STORE = STORE;
process.env.MYTHOS_GOV_DENYLOG = path.join(TMP, 'denied.log');

var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var verifier = require(path.join(EXEC, 'service', 'governance-verify.js'));
var KEY = fs.readFileSync(KEY_FILE);

function git(repo, args) {
  return cp.execFileSync('git', ['-C', repo].concat(args), { encoding: 'utf8' });
}

function makeRepo(name) {
  var dir = path.join(TMP, name);
  fs.mkdirSync(path.join(dir, 'projects', 'mythos-ai-executor', 'core'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'README.md'), 'ordinary\n');
  fs.writeFileSync(path.join(dir, 'projects', 'mythos-ai-executor', 'core', 'policy-engine.js'),
    '// the caged policy engine\n');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'base']);
  return dir;
}

function commitFile(repo, rel, body, msg) {
  var full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', msg]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

function grant(commit, paths, by) {
  var a = {
    approval_id: 'ga-test-' + crypto.randomBytes(3).toString('hex'),
    commit: commit,
    paths: paths.slice().sort(),
    decision: 'GRANTED',
    decided_by: by || 'a-real-human',
    created_at: new Date().toISOString()
  };
  a.sig = verifier.sign(a, KEY);
  fs.writeFileSync(path.join(STORE, a.approval_id + '.json'), JSON.stringify(a, null, 2));
  return a;
}

function clearStore() {
  fs.readdirSync(STORE).forEach(function (f) { fs.unlinkSync(path.join(STORE, f)); });
}

console.log('MYTHOS — governance delivery invariant\n');

// ===========================================================================
console.log('1. ORDINARY WORK IS UNAFFECTED');
// ===========================================================================
(function () {
  var repo = makeRepo('normal');
  var base = git(repo, ['rev-parse', 'HEAD']).trim();
  commitFile(repo, 'docs/NOTES.md', 'notes\n', 'docs: ordinary change');
  commitFile(repo, 'src/app.js', 'console.log(1)\n', 'feat: ordinary code');
  var res = verifier.verify(repo, base + '..HEAD');
  ok(res.allowed === true, 'normal: a commit touching no protected path delivers');
  ok(res.protected_commits === 0, 'normal: nothing is flagged as protected');
  ok(!res.error, 'normal: no verifier error');
})();

// ===========================================================================
console.log('\n2. MISSION BRANCHES DELIVER');
// ===========================================================================
(function () {
  var repo = makeRepo('mission');
  var base = git(repo, ['rev-parse', 'HEAD']).trim();
  git(repo, ['checkout', '-q', '-b', 'mythos/m-test-0001/tk-test-0001']);
  commitFile(repo, 'projects/mythos-ai-executor/core/dag.js', '// improved\n',
    'feat(mythos-core): ordinary capability work');
  var res = verifier.verify(repo, base + '..HEAD');
  ok(res.allowed === true, 'mission: an ordinary mission branch delivers autonomously');

  // …but a mission branch is just a ref. A protected change on one is still
  // a protected change.
  commitFile(repo, 'projects/mythos-ai-executor/core/budget.js', '// tampered\n',
    'feat: sneak a budget change onto a mission branch');
  var res2 = verifier.verify(repo, base + '..HEAD');
  ok(res2.allowed === false,
    'mission: a protected change on a mythos/* branch is still denied');
})();

// ===========================================================================
console.log('\n3. PROTECTED FILES ARE BLOCKED WITHOUT AN APPROVAL');
// ===========================================================================
(function () {
  var repo = makeRepo('protected');
  var base = git(repo, ['rev-parse', 'HEAD']).trim();
  var sha = commitFile(repo, 'projects/mythos-ai-executor/core/policy-engine.js',
    '// weakened\n', 'refactor: touch the policy engine');
  var res = verifier.verify(repo, base + '..HEAD');
  ok(res.allowed === false, 'protected: an unapproved protected change is DENIED');
  ok(res.denied.length === 1 && res.denied[0].sha === sha,
    'protected: the denial names the exact commit');
  ok(res.denied[0].protected_files.indexOf('projects/mythos-ai-executor/core/policy-engine.js') !== -1,
    'protected: the denial names the file');

  // The same commit, once genuinely approved, delivers.
  grant(sha, ['projects/mythos-ai-executor/core/policy-engine.js']);
  var res2 = verifier.verify(repo, base + '..HEAD');
  ok(res2.allowed === true, 'protected: a signed, commit-bound approval permits delivery');
  clearStore();
  ok(verifier.verify(repo, base + '..HEAD').allowed === false,
    'protected: revoking the approval blocks it again');
})();

// ===========================================================================
console.log('\n4. A COMMIT MESSAGE IS NOT AN APPROVAL');
// ===========================================================================
(function () {
  var repo = makeRepo('claims');
  var base = git(repo, ['rev-parse', 'HEAD']).trim();
  [
    'fix: owner-authorised change to the relay',
    'chore: approved by the owner in chat, see conversation',
    'feat: APPROVAL_ID=ga-totally-real granted by othman',
    'fix: this was put to the owner and authorised before implementation'
  ].forEach(function (msg, i) {
    commitFile(repo, 'projects/mythos-ai-executor/core/policy-engine.js',
      '// attempt ' + i + '\n', msg);
  });
  var res = verifier.verify(repo, base + '..HEAD');
  ok(res.allowed === false, 'claims: commit messages asserting approval change nothing');
  ok(res.denied.length === 4, 'claims: every such commit is denied, not just the first');
  var src = fs.readFileSync(path.join(EXEC, 'service', 'governance-verify.js'), 'utf8');
  ok(!/log\b.*--format|%B|commit_message|show -s/.test(src),
    'claims: the verifier never reads a commit message at all');
})();

// ===========================================================================
console.log('\n5. A FORGED APPROVAL IS REJECTED');
// ===========================================================================
(function () {
  var repo = makeRepo('forgery');
  var base = git(repo, ['rev-parse', 'HEAD']).trim();
  var sha = commitFile(repo, 'projects/mythos-ai-executor/core/budget.js',
    '// forged\n', 'fix: budget');

  // Hand-written approval with no signature.
  fs.writeFileSync(path.join(STORE, 'unsigned.json'), JSON.stringify({
    approval_id: 'unsigned', commit: sha,
    paths: ['projects/mythos-ai-executor/core/budget.js'],
    decision: 'GRANTED', decided_by: 'me', created_at: new Date().toISOString()
  }));
  ok(verifier.verify(repo, base + '..HEAD').allowed === false,
    'forgery: an approval with no signature is rejected');

  // Signature present but wrong.
  fs.writeFileSync(path.join(STORE, 'badsig.json'), JSON.stringify({
    approval_id: 'badsig', commit: sha,
    paths: ['projects/mythos-ai-executor/core/budget.js'],
    decision: 'GRANTED', decided_by: 'me', created_at: new Date().toISOString(),
    sig: crypto.randomBytes(32).toString('hex')
  }));
  ok(verifier.verify(repo, base + '..HEAD').allowed === false,
    'forgery: a wrong signature is rejected');

  // Signed with the WRONG key — i.e. a session that made up its own key.
  var wrongKey = crypto.randomBytes(32);
  var a = {
    approval_id: 'wrongkey', commit: sha,
    paths: ['projects/mythos-ai-executor/core/budget.js'],
    decision: 'GRANTED', decided_by: 'me', created_at: new Date().toISOString()
  };
  a.sig = verifier.sign(a, wrongKey);
  fs.writeFileSync(path.join(STORE, 'wrongkey.json'), JSON.stringify(a));
  ok(verifier.verify(repo, base + '..HEAD').allowed === false,
    'forgery: an approval signed with a self-made key is rejected');

  // Tampering with a genuinely signed approval invalidates it.
  clearStore();
  var real = grant(sha, ['projects/mythos-ai-executor/core/budget.js']);
  var file = path.join(STORE, real.approval_id + '.json');
  var loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
  loaded.paths.push('projects/mythos-ai-executor/core/policy-engine.js');
  fs.writeFileSync(file, JSON.stringify(loaded));
  ok(verifier.verify(repo, base + '..HEAD').allowed === false,
    'forgery: widening the paths of a signed approval invalidates it');
  clearStore();

  // A DENIED decision is not an approval.
  var denied = {
    approval_id: 'denied1', commit: sha,
    paths: ['projects/mythos-ai-executor/core/budget.js'],
    decision: 'DENIED', decided_by: 'a-real-human', created_at: new Date().toISOString()
  };
  denied.sig = verifier.sign(denied, KEY);
  fs.writeFileSync(path.join(STORE, 'denied1.json'), JSON.stringify(denied));
  ok(verifier.verify(repo, base + '..HEAD').allowed === false,
    'forgery: a validly signed DENIAL does not permit delivery');
  clearStore();
})();

// ===========================================================================
console.log('\n6. AN APPROVAL IS BOUND TO ONE COMMIT AND ITS PATHS');
// ===========================================================================
(function () {
  var repo = makeRepo('binding');
  var base = git(repo, ['rev-parse', 'HEAD']).trim();
  var first = commitFile(repo, 'projects/mythos-ai-executor/core/budget.js',
    '// v1\n', 'fix: budget v1');
  grant(first, ['projects/mythos-ai-executor/core/budget.js']);
  ok(verifier.verify(repo, base + '..HEAD').allowed === true, 'binding: the approved commit delivers');

  // A SECOND protected commit is not covered by the first one's approval.
  var second = commitFile(repo, 'projects/mythos-ai-executor/core/budget.js',
    '// v2 sneaked in\n', 'fix: budget v2');
  var res = verifier.verify(repo, base + '..HEAD');
  ok(res.allowed === false, 'binding: a later commit is NOT covered by an earlier approval');
  ok(res.denied.length === 1 && res.denied[0].sha === second,
    'binding: only the unapproved commit is named');

  // Amending changes the sha, so the approval stops applying.
  clearStore();
  var amendable = commitFile(repo, 'projects/mythos-ai-executor/core/events.js',
    '// a\n', 'fix: events');
  grant(amendable, ['projects/mythos-ai-executor/core/events.js']);
  git(repo, ['commit', '-q', '--amend', '-m', 'fix: events (amended)']);
  ok(verifier.verify(repo, base + '..HEAD').allowed === false,
    'binding: amending a commit invalidates its approval (no approve-then-swap)');
  clearStore();

  // An approval that covers only SOME of the touched protected paths fails.
  var multi = commitFile(repo, 'projects/mythos-ai-executor/core/store.js', '// s\n', 'fix: two files');
  fs.writeFileSync(path.join(repo, 'projects/mythos-ai-executor/core/validation.js'), '// v\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--amend', '--no-edit']);
  multi = git(repo, ['rev-parse', 'HEAD']).trim();
  grant(multi, ['projects/mythos-ai-executor/core/store.js']);   // only one of the two
  ok(verifier.verify(repo, base + '..HEAD').allowed === false,
    'binding: a partial path approval does not cover the whole commit');
  clearStore();
})();

// ===========================================================================
console.log('\n7. PATH TRAVERSAL AND NON-NORMALISED FORMS');
// ===========================================================================
(function () {
  [
    'projects/mythos-ai-executor/core/../core/policy-engine.js',
    './projects/./mythos-ai-executor/core/policy-engine.js',
    'a/b/../../projects/mythos-ai-executor/core/budget.js',
    '/home/deploy/projects/mythos-prod/projects/mythos-ai-executor/core/store.js',
    'projects/mythos-ai-executor/service/mythos-git-push.sh',
    'projects/mythos-ai-executor/service/../service/governance-verify.js',
    '.github/workflows/deploy.yml',
    'some/dir/credentials.json',
    'app/.env.production',
    'home/.ssh/config'
  ].forEach(function (p) {
    ok(verifier.isProtectedPath(p), 'traversal: still protected — ' + p.slice(-46));
  });
  ok(!verifier.isProtectedPath('projects/mythos-ai-executor/core/dag.js') &&
     !verifier.isProtectedPath('docs/SOMETHING.md'),
    'traversal: ordinary files are not over-blocked');
})();

// ===========================================================================
console.log('\n8. FORCE PUSH AND HISTORY REWRITE ARE IMPOSSIBLE VIA THE RELAY');
// ===========================================================================
(function () {
  var relay = fs.readFileSync(path.join(EXEC, 'service', 'mythos-git-push.sh'), 'utf8');
  ok(!/--force|--force-with-lease|push\s+.*\s\+refs|:\+refs/.test(relay),
    'force: the relay contains no force-push flag or + refspec');
  ok(/merge-base --is-ancestor/.test(relay),
    'force: delivery is gated on a fast-forward check');
  ok(/REFUSED: local \$BRANCH is not a fast-forward/.test(relay),
    'force: a diverged main is refused rather than forced');
  ok(!/push --delete|:refs\/heads\//.test(relay.replace(/"\$ref:\$ref"/g, '').replace(/refs\/heads\/\$BRANCH:refs\/heads\/\$BRANCH/g, '')),
    'force: the relay never deletes a remote ref');
  ok(!/filter-branch|rebase|reset --hard|commit --amend/.test(relay),
    'force: the relay never rewrites history');
  ok(/gov_check/.test(relay) && (relay.match(/gov_check/g) || []).length >= 3,
    'force: every push path goes through the governance check');
})();

// ===========================================================================
console.log('\n9. THE VERIFIER CANNOT BE DISARMED FROM THE REPOSITORY');
// ===========================================================================
(function () {
  var relay = fs.readFileSync(path.join(EXEC, 'service', 'mythos-git-push.sh'), 'utf8');
  ok(/\/usr\/local\/lib\/mythos\/governance-verify\.js/.test(relay),
    'independence: the relay points at the ROOT-OWNED verifier, not the repo copy');
  ok(/failing closed/.test(relay),
    'independence: a missing verifier fails closed rather than delivering');

  // The embedded protected list must not drift from the cage the loop uses.
  var selfImprove = require(path.join(EXEC, 'core', 'self-improve.js'));
  var missing = selfImprove.SELF_PROTECTED_PATHS.filter(function (p) {
    return verifier.PROTECTED_PATHS.indexOf(p) === -1;
  });
  ok(missing.length === 0,
    'independence: every caged path is also a delivery-protected path' +
      (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''));

  // Verifier errors must never be read as permission.
  var saved = process.env.MYTHOS_GOV_KEY;
  process.env.MYTHOS_GOV_KEY = path.join(TMP, 'no-such-key');
  var fresh = require('child_process').execFileSync(process.execPath, ['-e',
    'process.env.MYTHOS_GOV_KEY="' + path.join(TMP, 'no-such-key') + '";' +
    'process.env.MYTHOS_GOV_STORE="' + STORE + '";' +
    'var v=require("' + path.join(EXEC, 'service', 'governance-verify.js') + '");' +
    'var r=v.verify("' + path.join(TMP, 'protected') + '","HEAD~1..HEAD");' +
    'console.log(JSON.stringify({allowed:r.allowed,fail:r.fail_closed}))'
  ], { encoding: 'utf8' });
  var parsed = JSON.parse(fresh.trim());
  process.env.MYTHOS_GOV_KEY = saved;
  ok(parsed.allowed === false && parsed.fail === true,
    'independence: an unreadable key denies delivery (fails closed)');
})();

// ===========================================================================
console.log('\n10. APPROVALS PERSIST AND ARE HUMAN-ONLY BY CONSTRUCTION');
// ===========================================================================
(function () {
  var repo = makeRepo('persist');
  var base = git(repo, ['rev-parse', 'HEAD']).trim();
  var sha = commitFile(repo, 'projects/mythos-ai-executor/config/policy.json',
    '{}\n', 'chore: policy config');
  var a = grant(sha, ['projects/mythos-ai-executor/config/policy.json'], 'othman-haddad');

  // Survives a fresh process: the record is on disk, not in memory.
  var out = cp.execFileSync(process.execPath, ['-e',
    'process.env.MYTHOS_GOV_KEY="' + KEY_FILE + '";process.env.MYTHOS_GOV_STORE="' + STORE + '";' +
    'var v=require("' + path.join(EXEC, 'service', 'governance-verify.js') + '");' +
    'console.log(JSON.stringify(v.verify("' + repo + '","' + base + '..HEAD")))'
  ], { encoding: 'utf8' });
  ok(JSON.parse(out.trim()).allowed === true,
    'persistence: an approval survives into a fresh process');
  ok(fs.existsSync(path.join(STORE, a.approval_id + '.json')),
    'persistence: the record is a durable file, not process state');

  // The approve tool refuses non-root and refuses automated deciders.
  var tool = fs.readFileSync(path.join(EXEC, 'service', 'mythos-governance-approve.js'), 'utf8');
  ok(/process\.getuid\(\) !== 0/.test(tool),
    'human-only: the approve tool refuses to run as a non-root user');
  ok(/claude\|agent\|automation\|bot\|system\|n8n\|mythos/.test(tool),
    'human-only: an automated identity is refused as the decider');
  ok(/touches no protected path/.test(tool),
    'human-only: blanket approvals for unprotected commits are refused');
  ok(!/--yes|--force|--auto/.test(tool),
    'human-only: the tool has no non-interactive auto-approve switch');
  clearStore();
})();

// ===========================================================================
console.log('\n10B. AN APPROVAL IS WRITTEN READABLE BY THE RELAY IDENTITY');
// ===========================================================================
// 2026-09-02: ga-mtjvu6ex-df615c was GRANTED by the owner and still denied at
// delivery. The approve tool had written the record root:root 0640; the relay
// (deploy + SupplementaryGroups=mythos-gov) could not open it, and the
// verifier's silent catch turned EACCES into "no valid approval". Both halves
// are pinned here: the tool re-groups the record, the verifier says what it
// cannot read — and still denies, because an unreadable record is never
// permission.
(function () {
  var toolPath = path.join(EXEC, 'service', 'mythos-governance-approve.js');
  var tool = fs.readFileSync(toolPath, 'utf8');
  ok(/fs\.chownSync\(\s*\w+\s*,\s*0\s*,\s*govGid\s*\)/.test(tool),
    'group: the record is re-owned to root:<mythos-gov gid> after writing');
  ok(/var GOV_GROUP = 'mythos-gov'/.test(tool) && /var GROUP_FILE = '\/etc\/group'/.test(tool),
    'group: the gid is resolved from /etc/group for the fixed mythos-gov group');
  ok(/die\('group ' \+ name \+ ' does not exist in ' \+ GROUP_FILE/.test(tool),
    'group: a missing mythos-gov group is fatal, not silently skipped');
  ok(tool.indexOf('resolveGroupGid(GOV_GROUP)') !== -1 &&
     tool.indexOf('resolveGroupGid(GOV_GROUP)') < tool.indexOf('verifier.sign(approval, key)'),
    'group: the gid is resolved BEFORE the approval is signed or written (no side effect on failure)');
  ok(/fs\.renameSync\(tmp, out\)/.test(tool) &&
     tool.indexOf('fs.chownSync(tmp, 0, govGid)') < tool.indexOf('fs.renameSync(tmp, out)'),
    'group: the record is re-grouped under a non-.json name and only then renamed into place');
  ok(/fs\.chmodSync\(tmp, 0o640\)/.test(tool),
    'group: the final mode is 0640 regardless of umask');

  // Root-only stays root-only — exercised for real, not by regex.
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    var r = cp.spawnSync(process.execPath, [toolPath, '--commit', 'HEAD', '--by', 'Some Human',
      '--reason', 'a sentence long enough to pass'], { encoding: 'utf8', env: process.env });
    ok(r.status === 2 && /must run as root/.test(r.stderr),
      'group: a non-root caller is refused before any group or file logic runs');
  } else {
    ok(true, 'group: (suite running as root) the non-root refusal is not exercised in-process');
  }

  var repo = makeRepo('unreadable');
  var base = git(repo, ['rev-parse', 'HEAD']).trim();
  var sha = commitFile(repo, 'projects/mythos-ai-executor/core/budget.js', '// x\n', 'chore: budget');
  var a = grant(sha, ['projects/mythos-ai-executor/core/budget.js']);
  var file = path.join(STORE, a.approval_id + '.json');
  ok(verifier.verify(repo, base + '..HEAD').allowed === true,
    'unreadable: the readable record permits delivery (control)');
  var asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (asRoot) fs.writeFileSync(file, '{ not json\n');   // root ignores modes; break the content instead
  else fs.chmodSync(file, 0o000);                        // the real failure: EACCES
  var run = cp.spawnSync(process.execPath,
    [path.join(EXEC, 'service', 'governance-verify.js'), 'verify',
     '--repo', repo, '--range', base + '..HEAD', '--ref', 'test'],
    { encoding: 'utf8', env: process.env });
  ok(run.status === 3,
    'unreadable: an approval the verifier cannot read still DENIES delivery');
  ok(run.stderr.indexOf('governance: approval file ' + file + ' ignored (') !== -1,
    'unreadable: the verifier names the unreadable approval file on stderr');
  ok(asRoot ? /SyntaxError/.test(run.stderr) : /EACCES/.test(run.stderr),
    'unreadable: the diagnostic carries the failure reason');
  ok(/GOVERNANCE DENY/.test(run.stderr),
    'unreadable: the diagnostic never replaces the denial');
  if (!asRoot) fs.chmodSync(file, 0o600);
  clearStore();
})();

// ===========================================================================
console.log('\n11. THE SESSION USER CANNOT REACH THE REAL KEY OR STORE');
// ===========================================================================
(function () {
  // The live installation, not the temp fixtures. This is the property that
  // makes forgery require an explicit privileged action.
  var readable = true;
  try { fs.readFileSync('/etc/mythos/governance.key'); } catch (e) { readable = false; }
  ok(readable === false,
    'isolation: this user cannot read /etc/mythos/governance.key');

  var listable = true;
  try { fs.readdirSync('/var/lib/mythos/governance/approvals'); } catch (e) { listable = false; }
  ok(listable === false,
    'isolation: this user cannot list the live approval store');

  var writable = true;
  try {
    fs.writeFileSync('/var/lib/mythos/governance/approvals/forged.json', '{}');
  } catch (e) { writable = false; }
  ok(writable === false,
    'isolation: this user cannot write an approval into the live store');
})();

// ===========================================================================
console.log('\n11B. THE mythos-gov ARCHITECTURE: THE MISSION IDENTITY IS CAGED OUT');
// ===========================================================================
// Missions run as `deploy` — the same account the relay runs as. The key is
// therefore isolated by GROUP, not by user: root:mythos-gov 0640, with
// mythos-gov a MEMBERLESS system group granted to the relay PROCESS alone
// via SupplementaryGroups. These assertions hold everywhere: on the
// production host they prove the live boundary; where the live installation
// is absent there is nothing to leak, and any key or group that DOES exist
// in an unsafe state fails loudly. No assertion here accepts unsafe
// ownership.
(function () {
  var unit = fs.readFileSync(path.join(EXEC, 'service', 'mythos-git-push.service'), 'utf8');
  ok(/^SupplementaryGroups=mythos-gov$/m.test(unit),
    'gov-group: the relay unit grants mythos-gov via SupplementaryGroups');
  ok(/^User=deploy$/m.test(unit) && /^Group=deploy$/m.test(unit),
    'gov-group: the relay still runs as deploy:deploy — privilege comes ONLY from the supplementary group');
  ok(/^ReadWritePaths=\/var\/lib\/mythos\/governance\/log$/m.test(unit),
    'gov-group: the relay unit can write the governance log (repo/install drift closed)');
  ok(!/^ReadWritePaths=.*approvals/m.test(unit),
    'gov-group: the approvals store is NEVER writable by the relay unit');

  var harden = fs.readFileSync(path.join(EXEC, 'service', 'mythos-governance-harden.sh'), 'utf8');
  ok(/chown root:"\$GOV_GROUP" "\$KEY_FILE"/.test(harden) &&
     /chmod 0640 "\$KEY_FILE"/.test(harden) &&
     /GOV_GROUP=mythos-gov/.test(harden),
    'gov-group: the hardening procedure applies root:mythos-gov 0640 to the key');
  ok(!/usermod[^\n]*mythos-gov|gpasswd -a|adduser[^\n]*mythos-gov/.test(harden) &&
     /MEMBERLESS/.test(harden),
    'gov-group: the hardening procedure never adds a member to mythos-gov and requires it memberless');

  var src = fs.readFileSync(path.join(EXEC, 'service', 'governance-verify.js'), 'utf8');
  ok(/root:mythos-gov 0640/.test(src) && !/\(root:deploy 0640\)/.test(src),
    'gov-group: the verifier documents the real identity model, not the obsolete root:deploy one');

  // Live host, fail-closed: a key that exists MUST be root:mythos-gov 0640.
  var st = null;
  try { st = fs.statSync('/etc/mythos/governance.key'); } catch (e) { st = null; }
  if (st) {
    var gidLine = '';
    try { gidLine = cp.execFileSync('getent', ['group', 'mythos-gov'], { encoding: 'utf8' }).trim(); } catch (e) { gidLine = ''; }
    var govGid = gidLine ? parseInt(gidLine.split(':')[2], 10) : -1;
    ok(st.uid === 0 && st.gid === govGid && (st.mode & 511) === 0o640,
      'gov-group: the LIVE key is root:mythos-gov 0640');
  } else {
    ok(true, 'gov-group: no live key on this host — nothing exists in an unsafe state');
  }

  // A mythos-gov group that exists MUST be memberless, and deploy must not
  // carry it.
  var groupLine = '';
  try { groupLine = cp.execFileSync('getent', ['group', 'mythos-gov'], { encoding: 'utf8' }).trim(); } catch (e) { groupLine = ''; }
  ok(!groupLine || groupLine.split(':')[3] === '' || groupLine.split(':')[3] === undefined,
    'gov-group: mythos-gov (where present) has NO ordinary members');
  var deployGroups = '';
  try { deployGroups = cp.execFileSync('id', ['-nG', 'deploy'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { deployGroups = ''; }
  ok(deployGroups.split(/\s+/).indexOf('mythos-gov') === -1,
    'gov-group: deploy (where present) is NOT a member of mythos-gov');
})();

// ===========================================================================
console.log('\n12. UNATTENDED POLICY: DENY + RECORD + CONTINUE, NEVER ASK');
// ===========================================================================
(function () {
  var unattended = require(path.join(EXEC, 'core', 'unattended.js'));

  ok(unattended.enabled() === false,
    'unattended: OFF unless explicitly switched on by environment');

  // The load-bearing invariant: no classification may ever grant anything.
  var everyKind = unattended.DECISIONS.map(function (d) { return d.kind; });
  ok(everyKind.length >= 5, 'unattended: the policy covers the documented decision kinds');
  unattended.DECISIONS.forEach(function (d) {
    ok(!unattended.grantsAnything({ action: d.action }),
      'unattended: ' + d.kind + ' resolves to a restrictive action (' + d.action + ')');
  });

  [
    ['governance violation detected in the real diff: core/tool-registry.js', 'GOVERNANCE'],
    ['this would require a destructive ROOT operation', 'DESTRUCTIVE'],
    ['task parked: requires approval under the execution policy', 'POLICY'],
    ['repair budget exhausted after 3 cycles', 'REPAIR_EXHAUSTED'],
    ['the objective is ambiguous and needs a human design decision', 'AMBIGUOUS']
  ].forEach(function (pair) {
    var v = unattended.classify(pair[0]);
    ok(v.kind === pair[1], 'unattended: "' + pair[0].slice(0, 34) + '…" → ' + pair[1]);
    ok(!unattended.grantsAnything(v), 'unattended: ' + pair[1] + ' grants nothing');
  });

  // Precedence is deliberate and must resolve to the STRICTER rule. A
  // money-spend approval reads as DESTRUCTIVE rather than ordinary POLICY
  // because the destructive rule is checked first — both deny, but the
  // stricter classification is the one that should win.
  var money = unattended.classify('approval required for MONEY_SPEND of $5');
  ok(money.kind === 'DESTRUCTIVE',
    'unattended: a money-spend gate resolves to the STRICTER destructive class');
  ok(money.terminal_for_capability === true && !unattended.grantsAnything(money),
    'unattended: and it grants nothing');

  // An unrecognised reason must deny WITHOUT writing the capability off.
  var unknown = unattended.classify('something nobody anticipated happened');
  ok(unknown.action === 'DENY' && unknown.terminal_for_capability === false,
    'unattended: an unclassified stop is denied but not permanently written off');

  // Quota is a WAIT, never a denial — denying it would discard recoverable work.
  ok(unattended.NEVER_DENIED.indexOf('WAITING_FOR_QUOTA') !== -1,
    'unattended: quota is explicitly excluded from denial (wait/resume, not deny)');
  ok(unattended.classify('usage limit reached, waiting for quota').kind !== 'GOVERNANCE',
    'unattended: a quota message is never misread as a governance breach');

  // Nothing in the module can turn itself on from a payload.
  var src = fs.readFileSync(path.join(EXEC, 'core', 'unattended.js'), 'utf8');
  ok(!/opts\.unattended|payload\.unattended|input\.unattended/.test(src),
    'unattended: cannot be switched on by a task payload — environment only');
})();

// ===========================================================================
console.log('\n13. UNATTENDED MULTI-MISSION: A GATE FIRES AND THE LOOP KEEPS GOING');
// ===========================================================================
// The point of the whole stage: a governance gate must not stop an overnight
// run. The gate still fires, the approval entity is still created, the answer
// is decided immediately and restrictively, and the campaign carries on to
// other work — with no human reachable and none asked.
(function () {
  process.env.MYTHOS_UNATTENDED = 'true';
  process.env.MYTHOS_CORE_ENABLED = 'true';
  process.env.MYTHOS_EXECUTOR_HOME = path.join(TMP, 'runtime');

  var campaign = require(path.join(EXEC, 'core', 'campaign.js'));
  var unattended = require(path.join(EXEC, 'core', 'unattended.js'));
  ok(unattended.enabled() === true, 'unattended-run: the mode is on for this scenario');

  var repo = path.join(TMP, 'unattended-repo');
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md'),
    '# Vision\n\n## 3. Components\n\n' +
    '### A. Adapter Improvement — PARTIAL (Phase 2)\n\nA safe capability.\n\n' +
    '### B. Second Safe Thing — PLANNED (Phase 2)\n\nAnother safe capability.\n\n' +
    '### P. Policy Hardening — PLANNED (Phase 2)\n\nChange the policy engine approval rules.\n');
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'init']);

  var c = campaign.createCampaign({
    objective: 'Develop the remaining capabilities overnight without asking anyone.',
    repo_path: repo, project: 'gov-unattended'
  });

  // Drive the governance path directly: this is what the runner calls when a
  // real diff touches the cage.
  var before = campaign.loadCampaign(c.campaign_id).state;
  campaign.parkForApproval(c.campaign_id, {
    mission_id: 'm-unattended-1', capability_key: 'P',
    objective: 'Change the policy engine approval rules',
    reason: 'governance violation detected in the real diff: core/policy-engine.js',
    action_class: 'GOVERNANCE'
  });
  var after = campaign.loadCampaign(c.campaign_id);

  ok(after.state !== 'WAITING_FOR_APPROVAL',
    'unattended-run: a governance gate does NOT park the campaign for a human (state=' +
      after.state + ')');
  ok((after.approval_required || []).length === 0,
    'unattended-run: no approval is left outstanding for someone to answer');
  ok((after.approval_decisions || []).length >= 1,
    'unattended-run: the decision was RECORDED, not skipped');

  var decision = (after.approval_decisions || [])[0] || {};
  ok(decision.granted === false, 'unattended-run: the automatic answer is a DENIAL');
  ok(/unattended|automatic/i.test(String(decision.decided_by)),
    'unattended-run: the decider is marked automatic, never impersonating a human');
  ok(String(decision.decided_by) !== 'othman-haddad (owner)',
    'unattended-run: an automatic denial never claims to be the owner');

  // The capability is written off as AUTO_DENIED — distinct from OWNER_DENIED,
  // so a machine refusal is never mistaken for a human verdict.
  var rmap = require(path.join(EXEC, 'core', 'roadmap.js'));
  var capP = rmap.candidates(repo).filter(function (x) { return x.key === 'P'; })[0];
  ok(capP && capP.selectable === false,
    'unattended-run: the denied capability is no longer selectable');
  ok(capP && capP.effective_status === 'AUTO_DENIED',
    'unattended-run: recorded AUTO_DENIED, distinct from an owner verdict');

  // …and other work is still available, which is what "continue" means.
  var stillOpen = rmap.candidates(repo).filter(function (x) { return x.selectable; });
  ok(stillOpen.length >= 1,
    'unattended-run: safe capabilities remain selectable — the loop continues (' +
      stillOpen.map(function (x) { return x.key; }).join(',') + ')');
  ok(before === 'PLANNING' || before === 'READY', 'unattended-run: started from a normal state');

  // No pending approval anywhere means nothing is waiting on a human.
  var policyEngine = require(path.join(EXEC, 'core', 'policy-engine.js'));
  ok(policyEngine.pendingApprovals(c.campaign_id).length === 0,
    'unattended-run: zero pending approvals — nothing is waiting on a human');

  delete process.env.MYTHOS_UNATTENDED;
})();

// ===========================================================================
console.log('\n14. CLEANUP');
// ===========================================================================
(function () {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  ok(true, 'cleanup: temp key, store and repos removed');
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
