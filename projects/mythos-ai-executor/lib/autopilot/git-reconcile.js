'use strict';
// =====================================================
// MYTHOS Autopilot — Safe Git Reconciler (fast-forward only)
// projects/mythos-ai-executor/lib/autopilot/git-reconcile.js
//
//   GitHub main ──▶ detect drift ──▶ inspect local state ──▶ policy gate
//               ──▶ reconcile safely (ff-only) ──▶ verify ──▶ audit
//
// The ONLY mutation this module can ever perform is
//     git merge --ff-only <verified sha>
// on a checkout that is (all of): the expected repository, on the expected
// branch, with a clean tracked tree, with no in-progress git operation, and
// whose HEAD is an ancestor of origin/<branch>. Every other situation is a
// BLOCKED decision that names the exact condition, and nothing is touched.
// There is no reset, no clean, no stash, no merge commit, no force, no
// conflict resolution, no overwriting of local modifications — not as an
// option, not behind a flag.
//
// Idempotent: a second run on a synchronized checkout is NOOP
// (`already_synchronized`), never a second merge. The target SHA is read
// from origin/<branch> AFTER the fetch, re-verified immediately before the
// merge (the remote may have moved), and verified again after it
// (HEAD must equal the target). Applying requires opts.apply === true —
// the default is a plan, so a caller without the enable marker observes.
// =====================================================

var cp = require('child_process');
var path = require('path');
var fs = require('fs');

var CODES = {
  NOOP: 'ALREADY_SYNCHRONIZED',
  AUTO: 'FAST_FORWARD',
  FETCH_FAILED: 'FETCH_FAILED',
  WRONG_REPO: 'WRONG_REPOSITORY',
  WRONG_BRANCH: 'WRONG_BRANCH',
  DIRTY: 'DIRTY_CHECKOUT',
  IN_PROGRESS: 'GIT_OPERATION_IN_PROGRESS',
  DIVERGED: 'DIVERGED',
  AHEAD: 'LOCAL_AHEAD',
  UNVERIFIED: 'TARGET_UNVERIFIED',
  MOVED: 'TARGET_MOVED',
  APPLY_FAILED: 'FAST_FORWARD_FAILED',
  VERIFY_FAILED: 'POST_SYNC_VERIFY_FAILED',
  FENCED: 'FENCED_OUT',
  DRY_RUN: 'DRY_RUN'
};

var SHA_RE = /^[0-9a-f]{40}$/;

function defaultGit(cwd, args, opts) {
  opts = opts || {};
  var env = Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' });
  if (opts.env) Object.assign(env, opts.env);
  var r = cp.spawnSync('git', ['-c', 'core.hooksPath=/var/empty'].concat(args), {
    cwd: cwd, encoding: 'utf8', env: env, timeout: opts.timeout || 60000, maxBuffer: 4 * 1024 * 1024
  });
  if (r.error) return { ok: false, out: '', error: String(r.error.message || r.error) };
  return { ok: r.status === 0, out: String(r.stdout || '').trim(), error: String(r.stderr || '').trim(), status: r.status };
}

function config(opts) {
  opts = opts || {};
  var cfg = {
    repo: opts.repo || process.env.MYTHOS_AUTOPILOT_REPO || '/home/deploy/projects/mythos-prod',
    remote: opts.remote || 'origin',
    branch: opts.branch || 'main',
    expected_remote_url: opts.expected_remote_url || process.env.MYTHOS_AUTOPILOT_REMOTE_URL || null,
    git: opts.git || defaultGit,
    fetch: opts.fetch !== false,
    fetch_timeout_ms: opts.fetch_timeout_ms || 120000
  };
  return cfg;
}

function normaliseRemoteUrl(u) {
  return String(u || '').trim().replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/').replace(/\/+$/, '').toLowerCase();
}

function inProgressOperation(gitDir) {
  var markers = ['MERGE_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG'];
  for (var i = 0; i < markers.length; i++) {
    if (fs.existsSync(path.join(gitDir, markers[i]))) return markers[i];
  }
  return null;
}

// inspect(cfg) — read-only. Every fact the gate needs, measured, not assumed.
function inspect(cfg) {
  cfg = config(cfg);
  var git = cfg.git;
  var out = {
    repo: cfg.repo, remote: cfg.remote, branch: cfg.branch, measured_at: new Date().toISOString(),
    is_repo: false, remote_url: null, remote_url_ok: null, current_branch: null,
    head: null, remote_head: null, fetch_ok: null, fetch_error: null,
    clean: null, dirty_files: [], in_progress: null, relation: null,
    ahead: null, behind: null
  };
  var top = git(cfg.repo, ['rev-parse', '--show-toplevel']);
  if (!top.ok) { out.error = top.error || 'not a git repository'; return out; }
  out.is_repo = path.resolve(top.out) === path.resolve(cfg.repo);
  var url = git(cfg.repo, ['remote', 'get-url', cfg.remote]);
  out.remote_url = url.ok ? url.out : null;
  out.remote_url_ok = cfg.expected_remote_url ? normaliseRemoteUrl(out.remote_url) === normaliseRemoteUrl(cfg.expected_remote_url) : (url.ok ? true : false);
  var br = git(cfg.repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  out.current_branch = br.ok ? br.out : null;
  var gd = git(cfg.repo, ['rev-parse', '--git-dir']);
  out.in_progress = gd.ok ? inProgressOperation(path.resolve(cfg.repo, gd.out)) : 'unknown';
  var st = git(cfg.repo, ['status', '--porcelain', '--untracked-files=no']);
  if (st.ok) { out.dirty_files = st.out ? st.out.split('\n').filter(Boolean) : []; out.clean = out.dirty_files.length === 0; }
  var head = git(cfg.repo, ['rev-parse', '--verify', 'refs/heads/' + cfg.branch]);
  out.head = head.ok && SHA_RE.test(head.out) ? head.out : null;
  if (cfg.fetch) {
    var f = git(cfg.repo, ['fetch', '--quiet', cfg.remote, cfg.branch], { timeout: cfg.fetch_timeout_ms });
    out.fetch_ok = f.ok; out.fetch_error = f.ok ? null : (f.error || 'fetch failed').slice(0, 300);
  }
  var rh = git(cfg.repo, ['rev-parse', '--verify', 'refs/remotes/' + cfg.remote + '/' + cfg.branch]);
  out.remote_head = rh.ok && SHA_RE.test(rh.out) ? rh.out : null;
  if (out.head && out.remote_head) {
    if (out.head === out.remote_head) out.relation = 'same';
    else {
      var hb = git(cfg.repo, ['merge-base', '--is-ancestor', out.head, out.remote_head]).ok;
      var rb = git(cfg.repo, ['merge-base', '--is-ancestor', out.remote_head, out.head]).ok;
      out.relation = hb ? 'behind' : (rb ? 'ahead' : 'diverged');
    }
    var cnt = git(cfg.repo, ['rev-list', '--left-right', '--count', out.head + '...' + out.remote_head]);
    if (cnt.ok) { var p = cnt.out.split(/\s+/); out.ahead = parseInt(p[0], 10); out.behind = parseInt(p[1], 10); }
  }
  return out;
}

// plan(inspection) — the policy gate. Pure: no I/O. Fail-closed: any
// condition that is not positively satisfied blocks.
function plan(ins, cfg) {
  cfg = config(cfg);
  var block = function (code, reason) { return { decision: 'BLOCKED', code: code, reason: reason, from: ins.head, target: ins.remote_head, human_approval: true }; };
  if (!ins || !ins.is_repo) return block(CODES.WRONG_REPO, 'not the expected repository at ' + cfg.repo + (ins && ins.error ? ': ' + ins.error : ''));
  if (ins.remote_url_ok !== true) return block(CODES.WRONG_REPO, 'remote ' + cfg.remote + ' is ' + (ins.remote_url || 'unset') + ', expected ' + (cfg.expected_remote_url || 'a configured url'));
  if (ins.current_branch !== cfg.branch) return block(CODES.WRONG_BRANCH, 'checkout is on ' + (ins.current_branch || 'detached HEAD') + ', expected ' + cfg.branch);
  if (ins.in_progress) return block(CODES.IN_PROGRESS, 'git operation in progress: ' + ins.in_progress);
  if (ins.clean !== true) return block(CODES.DIRTY, 'working tree has ' + ins.dirty_files.length + ' modified tracked file(s); local modifications are never overwritten');
  if (cfg.fetch && ins.fetch_ok !== true) return block(CODES.FETCH_FAILED, 'fetch from ' + cfg.remote + ' failed: ' + (ins.fetch_error || 'unknown'));
  if (!ins.head || !ins.remote_head) return block(CODES.UNVERIFIED, 'cannot resolve HEAD and ' + cfg.remote + '/' + cfg.branch + ' to verified SHAs');
  if (ins.relation === 'same') return { decision: 'NOOP', code: CODES.NOOP, reason: 'already synchronized at ' + ins.head.slice(0, 12), from: ins.head, target: ins.remote_head, human_approval: false };
  if (ins.relation === 'behind') return { decision: 'AUTO', code: CODES.AUTO, reason: 'fast-forward ' + ins.head.slice(0, 12) + ' → ' + ins.remote_head.slice(0, 12) + ' (' + ins.behind + ' commit(s))', from: ins.head, target: ins.remote_head, human_approval: false };
  if (ins.relation === 'ahead') return block(CODES.AHEAD, 'local ' + cfg.branch + ' is ' + ins.ahead + ' commit(s) ahead of ' + cfg.remote + ' — delivery is the relay\'s job, never a reconciler\'s');
  return block(CODES.DIVERGED, 'local ' + cfg.branch + ' has diverged from ' + cfg.remote + ' (' + ins.ahead + ' ahead / ' + ins.behind + ' behind); no automatic merge, no reset');
}

// apply(cfg, p, opts) — the one mutation, guarded three times: the plan must
// be AUTO, the target must still be origin/<branch> at apply time, and the
// caller must still hold its lock (opts.stillHeld). Returns an audit record.
function apply(cfg, p, opts) {
  cfg = config(cfg); opts = opts || {};
  var git = cfg.git;
  var rec = { op: 'git-sync', decision: p.decision, code: p.code, from: p.from, target: p.target, applied: false, verified: false, at: new Date().toISOString() };
  if (p.decision !== 'AUTO') { rec.reason = p.reason; return rec; }
  if (opts.apply !== true) { rec.code = CODES.DRY_RUN; rec.reason = 'dry run: would fast-forward ' + String(p.from).slice(0, 12) + ' → ' + String(p.target).slice(0, 12); return rec; }
  if (typeof opts.stillHeld === 'function' && !opts.stillHeld()) { rec.decision = 'BLOCKED'; rec.code = CODES.FENCED; rec.reason = 'lock lost before apply'; return rec; }
  // Re-verify the target immediately before mutating.
  var rh = git(cfg.repo, ['rev-parse', '--verify', 'refs/remotes/' + cfg.remote + '/' + cfg.branch]);
  if (!rh.ok || rh.out !== p.target) { rec.decision = 'BLOCKED'; rec.code = CODES.MOVED; rec.reason = 'remote moved from ' + String(p.target).slice(0, 12) + ' to ' + (rh.out || 'unknown').slice(0, 12) + ' since planning; re-plan'; return rec; }
  var head = git(cfg.repo, ['rev-parse', '--verify', 'refs/heads/' + cfg.branch]);
  if (!head.ok || head.out !== p.from) { rec.decision = 'BLOCKED'; rec.code = CODES.MOVED; rec.reason = 'local HEAD moved since planning'; return rec; }
  var m = git(cfg.repo, ['merge', '--ff-only', p.target], { timeout: 120000 });
  if (!m.ok) { rec.decision = 'BLOCKED'; rec.code = CODES.APPLY_FAILED; rec.reason = (m.error || 'merge --ff-only failed').slice(0, 300); return rec; }
  rec.applied = true;
  var after = git(cfg.repo, ['rev-parse', '--verify', 'refs/heads/' + cfg.branch]);
  rec.head_after = after.ok ? after.out : null;
  if (rec.head_after !== p.target) { rec.code = CODES.VERIFY_FAILED; rec.reason = 'HEAD after fast-forward is ' + String(rec.head_after).slice(0, 12) + ', expected ' + p.target.slice(0, 12); return rec; }
  rec.verified = true; rec.reason = 'fast-forwarded to ' + p.target.slice(0, 12);
  return rec;
}

// reconcile(cfg, opts) — inspect → plan → (apply) in one call.
function reconcile(cfg, opts) {
  cfg = config(cfg); opts = opts || {};
  var ins = inspect(cfg);
  var p = plan(ins, cfg);
  var rec = apply(cfg, p, opts);
  rec.inspection = ins;
  rec.plan = p;
  return rec;
}

module.exports = { CODES: CODES, config: config, inspect: inspect, plan: plan, apply: apply, reconcile: reconcile, defaultGit: defaultGit, normaliseRemoteUrl: normaliseRemoteUrl };
