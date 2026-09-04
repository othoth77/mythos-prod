'use strict';

// tests/mythos-bridge-push-guard-test.js — F1 push guard vs. multi-valued
// remote.<r>.pushurl (gh-issue-136 regression). Offline: throwaway bare origin,
// a shared checkout with a repository-level SSH-shaped pushurl (what the
// delivery relay legitimately needs), task worktrees guarded by applyPushGuard.
// Nothing external is contacted; the "SSH" URLs are unresolvable fixtures.

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var bridge = require(path.join(ROOT, 'projects', 'mythos-ai-executor', 'bridge', 'github-bridge'));
var NO_PUSH = bridge.NO_PUSH_URL;

var passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function git(cwd, args) {
  var r = cp.spawnSync('git', args, { cwd: cwd, encoding: 'utf8', env: Object.assign({}, process.env, {
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }) });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function lines(s) { return s ? s.split('\n').map(function (l) { return l.trim(); }).filter(Boolean) : []; }
function guardError(cfg, dir) { try { bridge.applyPushGuard(cfg, dir); return null; } catch (e) { return String(e.message); } }

var work = fs.mkdtempSync(path.join(os.tmpdir(), 'push-guard-test-'));
var ORIGIN = path.join(work, 'origin.git');
var REPO = path.join(work, 'repo');
var SSH_PUSH = 'git@github.invalid:owner/repo.git';       // relay-style repository-level pushurl (never contacted)
var FETCH_HTTPS = 'https://github.invalid/owner/repo.git';  // fetch url kept HTTPS (owner's choice)

git(work, ['init', '--bare', '-q', ORIGIN]);
git(work, ['clone', '-q', ORIGIN, REPO]);
git(REPO, ['commit', '-q', '--allow-empty', '-m', 'init']);
git(REPO, ['push', '-q', 'origin', 'HEAD:main']);
git(REPO, ['fetch', '-q', 'origin']);
var cfg = { repo: REPO, remote: 'origin', baseRef: 'origin/main', taskWorktrees: path.join(work, 'wt') };

function worktree(name) {
  var dir = path.join(cfg.taskWorktrees, name);
  fs.mkdirSync(cfg.taskWorktrees, { recursive: true });
  git(REPO, ['worktree', 'add', '-q', '-b', 'mythos/gh/' + name, dir, 'origin/main']);
  return dir;
}

console.log('§1 baseline: no repository-level pushurl (pre-2026-09-03 shape)');
var w1 = worktree('base');
var r1 = bridge.applyPushGuard(cfg, w1);
ok(r1.ok === true && r1.neutralised.length === 0, 'guard passes with nothing to neutralise');
ok(lines(git(w1, ['remote', 'get-url', '--push', '--all', 'origin']).out).join(',') === NO_PUSH, 'effective push set is exactly [no_push]');
ok(git(w1, ['remote', 'get-url', 'origin']).out === ORIGIN, 'fetch url untouched');
ok(git(REPO, ['config', '--get', 'extensions.worktreeConfig']).out === 'true', 'extensions.worktreeConfig enabled on the repository');

console.log('§2 repository-level SSH pushurl (relay) + worktree no_push → isolated PASS');
git(REPO, ['remote', 'set-url', 'origin', FETCH_HTTPS]);
git(REPO, ['config', 'remote.origin.pushurl', SSH_PUSH]);
var w2 = worktree('relay');
git(w2, ['config', '--worktree', 'remote.origin.pushurl', NO_PUSH]);            // what a previous guard run left behind
var before = lines(git(w2, ['remote', 'get-url', '--push', '--all', 'origin']).out);
ok(before.length === 2 && before[0] === SSH_PUSH, 'reproduction: before the guard, git would push to the inherited SSH url first (' + before.join(',') + ')');
var r2 = bridge.applyPushGuard(cfg, w2);
ok(r2.ok === true, 'guard passes');
ok(r2.neutralised.length === 1 && r2.neutralised[0] === SSH_PUSH, 'guard reports the neutralised inherited url');
var after = lines(git(w2, ['remote', 'get-url', '--push', '--all', 'origin']).out);
ok(after.length >= 1 && after.every(function (u) { return u === NO_PUSH; }), 'complete effective push set is only no_push (' + after.join(',') + ')');
ok(git(w2, ['remote', 'get-url', 'origin']).out === FETCH_HTTPS, 'fetch url unchanged in the worktree');
var pushTry = git(w2, ['push', '--dry-run', 'origin', 'HEAD:refs/heads/mythos/gh/should-never-land']);
ok(pushTry.status !== 0 && /no_push/.test(pushTry.err), 'git push from the guarded worktree fails on the no_push scheme (' + pushTry.err.split('\n')[0] + ')');
ok(lines(git(w2, ['config', '--worktree', '--get-all', 'url.' + NO_PUSH + '.insteadOf']).out).join(',') === SSH_PUSH, 'neutralisation lives in the worktree scope only');
var r2b = bridge.applyPushGuard(cfg, w2);
ok(r2b.ok && lines(git(w2, ['config', '--worktree', '--get-all', 'url.' + NO_PUSH + '.insteadOf']).out).length === 1, 'guard is idempotent (re-apply does not duplicate the rewrite)');

console.log('§3 unexpected additional worktree-level push url → FAIL, not repaired');
var w3 = worktree('tampered');
git(w3, ['config', '--worktree', 'remote.origin.pushurl', NO_PUSH]);
git(w3, ['config', '--worktree', '--add', 'remote.origin.pushurl', 'git@github.invalid:attacker/repo.git']);
var e3 = guardError(cfg, w3);
ok(/^PUSH_GUARD_FAILED: unexpected worktree-level push url/.test(e3 || ''), 'guard refuses (' + e3 + ')');
ok(lines(git(w3, ['config', '--worktree', '--get-all', 'remote.origin.pushurl']).out).length === 2, 'guard did not silently rewrite the tampered worktree config');
var w3b = worktree('tampered-only');
git(w3b, ['config', '--worktree', 'remote.origin.pushurl', 'git@github.invalid:attacker/repo.git']);
var e3b = guardError(cfg, w3b);
ok(/PUSH_GUARD_FAILED: unexpected worktree-level push url/.test(e3b || ''), 'a single wrong worktree-level push url is refused too');

console.log('§4 expected no_push only (fresh worktree) → PASS');
var w4 = worktree('fresh');
var r4 = bridge.applyPushGuard(cfg, w4);
ok(r4.ok === true, 'fresh worktree gets the guard');
ok(lines(git(w4, ['config', '--worktree', '--get-all', 'remote.origin.pushurl']).out).join(',') === NO_PUSH, 'worktree scope carries exactly the no_push url');
ok(lines(git(w4, ['remote', 'get-url', '--push', '--all', 'origin']).out).every(function (u) { return u === NO_PUSH; }), 'effective push set is only no_push');

console.log('§5 shared checkout / relay behaviour unaffected');
ok(git(REPO, ['config', '--get-all', 'remote.origin.pushurl']).out === SSH_PUSH, 'repository-level SSH pushurl preserved on the shared checkout');
ok(lines(git(REPO, ['remote', 'get-url', '--push', '--all', 'origin']).out).join(',') === SSH_PUSH, 'shared checkout still pushes to the SSH url only');
ok(git(REPO, ['config', '--get-all', 'url.' + NO_PUSH + '.insteadOf']).status !== 0, 'no insteadOf rewrite leaked into the repository scope');
ok(git(REPO, ['remote', 'get-url', 'origin']).out === FETCH_HTTPS, 'shared checkout fetch url unchanged');

console.log('§6 inherited push url equal to the fetch url → FAIL (cannot isolate without breaking fetch)');
git(REPO, ['config', '--replace-all', 'remote.origin.pushurl', FETCH_HTTPS]);
var w6 = worktree('samefetch');
var e6 = guardError(cfg, w6);
ok(/PUSH_GUARD_FAILED: inherited push url equals the fetch url/.test(e6 || ''), 'guard refuses (' + e6 + ')');
git(REPO, ['config', '--replace-all', 'remote.origin.pushurl', SSH_PUSH]);

try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { /* ignore */ }
console.log('\npush-guard: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
