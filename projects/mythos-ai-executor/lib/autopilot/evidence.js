'use strict';
// =====================================================
// MYTHOS Autopilot — evidence collector
// projects/mythos-ai-executor/lib/autopilot/evidence.js
//
// Rebuilds the facts a handover entry repeats by hand — branch, HEAD, base,
// remote HEAD, commits, changed files, test results, runtime identity,
// deployment state, next action — from their sources of truth: git in the
// worktree, the test runner's JSON artifact, and the drift report. Nothing
// is typed from memory; a fact that cannot be measured is reported as
// NOT_VERIFIED, never guessed (the Status Center rule).
// =====================================================

var fs = require('fs');

function collect(opts) {
  opts = opts || {};
  var git = opts.git || require('./git-reconcile').defaultGit;
  var cwd = opts.cwd || process.cwd();
  var remote = opts.remote || 'origin';
  var main = opts.main || 'main';
  var ev = { collected_at: new Date().toISOString(), cwd: cwd, not_verified: [] };
  var nv = function (k, why) { ev.not_verified.push({ field: k, reason: why }); return null; };
  var top = git(cwd, ['rev-parse', '--show-toplevel']);
  ev.checkout = top.ok ? top.out : nv('checkout', top.error);
  var br = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  ev.branch = br.ok ? br.out : nv('branch', br.error);
  var head = git(cwd, ['rev-parse', 'HEAD']);
  ev.head = head.ok ? head.out : nv('head', head.error);
  if (opts.fetch !== false) git(cwd, ['fetch', '--quiet', remote, main], { timeout: 60000 });
  var rh = git(cwd, ['rev-parse', '--verify', '--quiet', 'refs/remotes/' + remote + '/' + main]);
  ev.remote_head = rh.ok ? rh.out : nv('remote_head', 'cannot resolve ' + remote + '/' + main);
  var mb = ev.head && ev.remote_head ? git(cwd, ['merge-base', ev.head, ev.remote_head]) : { ok: false };
  ev.base = mb.ok ? mb.out : nv('base', 'no merge-base with ' + remote + '/' + main);
  if (ev.base) {
    var lg = git(cwd, ['log', '--format=%H%x1f%s', ev.base + '..HEAD']);
    ev.commits = lg.ok && lg.out ? lg.out.split('\n').map(function (l) { var p = l.split('\x1f'); return { sha: p[0], subject: String(p[1] || '').slice(0, 200) }; }) : [];
    var df = git(cwd, ['diff', '--name-status', ev.base + '..HEAD']);
    ev.files_changed = df.ok && df.out ? df.out.split('\n').filter(Boolean).map(function (l) { var p = l.split('\t'); return { status: p[0], path: p[p.length - 1] }; }) : [];
  } else { ev.commits = []; ev.files_changed = []; }
  var st = git(cwd, ['status', '--porcelain', '--untracked-files=no']);
  ev.tree_clean = st.ok ? st.out === '' : nv('tree_clean', st.error);
  if (ev.branch && ev.head) {
    var ob = git(cwd, ['rev-parse', '--verify', '--quiet', 'refs/remotes/' + remote + '/' + ev.branch]);
    ev.branch_on_origin = ob.ok ? git(cwd, ['merge-base', '--is-ancestor', ev.head, ob.out]).ok : false;
    ev.merged_into_main = ev.remote_head ? git(cwd, ['merge-base', '--is-ancestor', ev.head, ev.remote_head]).ok : nv('merged_into_main', 'remote head unknown');
  }
  ev.tests = null;
  if (opts.tests_file) {
    try { ev.tests = JSON.parse(fs.readFileSync(opts.tests_file, 'utf8')); } catch (e) { nv('tests', 'cannot read ' + opts.tests_file); }
  } else if (opts.tests) ev.tests = opts.tests;
  else nv('tests', 'no test artifact supplied');
  // The runner artifact (`mythos-autopilot tests --run --out`) nests the run
  // under `run`; a bare run object is accepted too.
  if (ev.tests && ev.tests.run && ev.tests.run.results && !ev.tests.results) ev.tests = ev.tests.run;
  ev.runtime = opts.drift || nv('runtime', 'no drift report supplied');
  ev.deployment = ev.runtime ? { state: ev.runtime.state, next_action: ev.runtime.next_action } : null;
  ev.next_action = nextAction(ev);
  return ev;
}

function nextAction(ev) {
  if (ev.tree_clean === false) return 'commit or discard the local modifications before delivery';
  if (ev.commits && ev.commits.length && !ev.branch_on_origin) return 'the governance relay (mythos-git-push.timer) delivers this branch on its next tick; no manual push';
  if (ev.branch_on_origin && ev.merged_into_main === false) return 'open a PR to main; review and merge are a human decision';
  if (ev.merged_into_main === true && ev.deployment && ev.deployment.state !== 'CURRENT') return ev.deployment.next_action ? ev.deployment.next_action.text : 'reconcile the deployment';
  if (ev.merged_into_main === true) return 'merged and deployed; nothing pending';
  return 'no commits beyond base';
}

function short(s) { return s ? String(s).slice(0, 12) : 'NOT_VERIFIED'; }

function renderMarkdown(ev) {
  var lines = [];
  lines.push('| Field | Value |', '|---|---|');
  lines.push('| Branch | `' + (ev.branch || 'NOT_VERIFIED') + '` |');
  lines.push('| HEAD | `' + short(ev.head) + '` |');
  lines.push('| Base (merge-base with origin/main) | `' + short(ev.base) + '` |');
  lines.push('| Remote HEAD (origin/main) | `' + short(ev.remote_head) + '` |');
  lines.push('| Commits over base | ' + (ev.commits ? ev.commits.length : 'NOT_VERIFIED') + (ev.commits && ev.commits.length ? ' — ' + ev.commits.map(function (c) { return '`' + c.sha.slice(0, 7) + '` ' + c.subject; }).join('; ') : '') + ' |');
  lines.push('| Files changed | ' + (ev.files_changed ? ev.files_changed.length : 'NOT_VERIFIED') + ' |');
  lines.push('| Tree clean | ' + String(ev.tree_clean) + ' |');
  lines.push('| Branch on origin | ' + String(ev.branch_on_origin) + ' · merged into main: ' + String(ev.merged_into_main) + ' |');
  if (ev.tests && ev.tests.results) lines.push('| Tests | ' + ev.tests.results.map(function (r) { return r.suite.replace(/^tests\//, '') + ' **' + (r.passed === null ? (r.ok ? 'ok' : 'FAIL') : r.passed + '/' + r.failed) + '**'; }).join(' · ') + (ev.tests.stopped_at ? ' — STOPPED at ' + ev.tests.stopped_at : '') + ' |');
  else lines.push('| Tests | NOT_VERIFIED (no artifact) |');
  if (ev.runtime) lines.push('| Runtime identity | source `' + short(ev.runtime.source && ev.runtime.source.sha) + '` · checkout `' + short(ev.runtime.code && ev.runtime.code.sha) + '` · executor `' + short(ev.runtime.executor && ev.runtime.executor.sha) + '` (' + ((ev.runtime.executor && ev.runtime.executor.source) || 'unverified') + ') |');
  lines.push('| Deployment | ' + (ev.deployment ? ev.deployment.state : 'NOT_VERIFIED') + ' |');
  lines.push('| Next action | ' + ev.next_action + ' |');
  if (ev.not_verified.length) lines.push('| Not verified | ' + ev.not_verified.map(function (n) { return n.field; }).join(', ') + ' |');
  return lines.join('\n');
}

module.exports = { collect: collect, renderMarkdown: renderMarkdown, nextAction: nextAction };
