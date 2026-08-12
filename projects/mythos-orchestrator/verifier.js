'use strict';
// =====================================================
// Mythos Orchestrator — independent result verification
// projects/mythos-orchestrator/verifier.js
//
// The provider's own report is a CLAIM. This file turns claims into
// evidence by re-deriving every material fact from Git, which is the
// source of truth (AGENTS.md §2). A task is only ever "verified" when
// the repository itself agrees.
//
// Checks performed:
//   * declared commits actually exist (a fabricated SHA fails)
//   * the baseline really is an ancestor of the implementation commit
//   * the branch exists, locally and on the remote when a push was required
//   * the claimed remote head matches what origin actually reports
//   * the claimed files_changed matches the real diff
//   * every required test is present in the report and passed
//   * no prohibited path was touched
//   * the diff contains no obvious secret
// =====================================================

var gitlib = require('./lib/git');
var redact = require('./lib/redact');

// Paths a delegated task must never modify. These correspond to the
// non-negotiable production boundaries: deployment configuration, live
// credentials, and the orchestrator's own control plane.
var PROHIBITED_PATH_PREFIXES = [
  '.github/workflows/',
  '.env',
  'docker-compose',
  'Dockerfile'
];

var PROHIBITED_PATH_SUBSTRINGS = [
  'jellyfin',
  'id_rsa',
  'credentials',
  'secrets'
];

function isProhibitedPath(p) {
  var lower = String(p).toLowerCase();
  var hit = PROHIBITED_PATH_PREFIXES.some(function (prefix) { return lower.indexOf(prefix.toLowerCase()) === 0; });
  if (hit) return true;
  return PROHIBITED_PATH_SUBSTRINGS.some(function (frag) { return lower.indexOf(frag) !== -1; });
}

function sameSet(a, b) {
  var sa = a.slice().sort();
  var sb = b.slice().sort();
  return sa.length === sb.length && sa.every(function (v, i) { return v === sb[i]; });
}

// Verifies a provider result against the repository.
// Returns { verified, checks[], failures[], warnings[] }.
function verify(task, result, opts) {
  opts = opts || {};
  var cwd = task.working_directory;
  var checks = [];
  var failures = [];
  var warnings = [];

  // `detail` explains a FAILURE. Attaching it to a passing check produces a
  // report that reads as though the check failed ("no commit reported" next
  // to passed:true), so it is dropped unless the check actually failed.
  function check(name, passed, detail) {
    checks.push({ name: name, passed: !!passed, detail: passed ? '' : (detail || '') });
    if (!passed) failures.push(name + (detail ? ': ' + detail : ''));
    return !!passed;
  }

  if (!result || typeof result !== 'object') {
    return { verified: false, checks: [], failures: ['NO_RESULT: nothing to verify'], warnings: warnings };
  }

  check('result_task_id_matches', result.task_id === task.task_id,
    'result claims ' + result.task_id);

  // ---- Nothing is verifiable unless the repository is reachable ----
  if (!gitlib.isRepo(cwd)) {
    return {
      verified: false, checks: checks,
      failures: failures.concat(['WORKTREE_UNAVAILABLE: ' + cwd]),
      warnings: warnings
    };
  }

  if (!opts.skipFetch) {
    var f = gitlib.fetch(cwd);
    if (!f.ok) warnings.push('FETCH_FAILED: remote checks use the last known state');
  }

  // ---- Baseline ----
  check('baseline_matches_task', result.baseline === task.baseline_commit,
    'result baseline ' + String(result.baseline).slice(0, 12));
  check('baseline_exists', gitlib.commitExists(cwd, task.baseline_commit));

  // ---- Branch ----
  check('branch_matches_task', result.branch === task.branch,
    'result branch ' + result.branch);
  check('branch_exists_locally', gitlib.localBranchExists(cwd, task.branch));

  // ---- Commit claims. A fabricated SHA must fail here. ----
  var commit = result.implementation_commit;
  if (task.delivery.commit_required) {
    if (check('implementation_commit_present', !!commit, 'no commit reported')) {
      check('implementation_commit_sha_shape', /^[0-9a-f]{40}$/.test(commit),
        'not a 40-character SHA');
      var exists = gitlib.commitExists(cwd, commit);
      check('implementation_commit_exists', exists, 'commit not found in the repository');
      if (exists) {
        check('baseline_is_ancestor_of_commit',
          gitlib.isAncestor(cwd, task.baseline_commit, commit),
          'declared baseline is not an ancestor of the implementation commit');
      }
    }
  } else if (commit) {
    warnings.push('UNEXPECTED_COMMIT: task did not require a commit but one was reported');
  }

  if (result.handover_commit) {
    check('handover_commit_exists', gitlib.commitExists(cwd, result.handover_commit),
      'handover commit not found');
  } else if (task.delivery.handover_required) {
    check('handover_commit_present', false, 'task required a handover commit');
  }

  // ---- Remote state ----
  if (task.delivery.push_required) {
    var remoteHead = gitlib.remoteBranchHead(cwd, task.branch);
    if (check('remote_branch_exists', !!remoteHead, 'origin has no branch ' + task.branch)) {
      check('remote_head_matches_claim', remoteHead === result.remote_head,
        'origin reports ' + String(remoteHead).slice(0, 12) +
        ' but the result claims ' + String(result.remote_head).slice(0, 12));
      if (commit && gitlib.commitExists(cwd, commit)) {
        check('commit_reachable_from_remote_head',
          gitlib.isAncestor(cwd, commit, remoteHead),
          'the implementation commit is not contained in the pushed branch');
      }
    }
  }

  // ---- Diff scope ----
  if (commit && gitlib.commitExists(cwd, commit) && gitlib.commitExists(cwd, task.baseline_commit)) {
    var actual = gitlib.changedFiles(cwd, task.baseline_commit, commit);
    check('files_changed_matches_diff', sameSet(actual, result.files_changed || []),
      'git reports [' + actual.join(', ') + ']');

    var prohibited = actual.filter(isProhibitedPath);
    check('no_prohibited_paths_touched', prohibited.length === 0,
      prohibited.join(', '));

    // Secret scan over the actual diff content, not the provider's summary.
    var diff = gitlib.git(['diff', task.baseline_commit, commit], cwd);
    if (diff.ok) {
      var kinds = redact.findSecretKinds(diff.out);
      check('no_secret_in_diff', kinds.length === 0, kinds.join(', '));
    } else {
      warnings.push('DIFF_UNREADABLE: secret scan over the diff was skipped');
    }
  }

  // ---- Test evidence ----
  if (task.delivery.tests_required) {
    var reported = result.tests || [];
    var required = task.required_tests || [];
    check('all_required_tests_reported',
      required.every(function (rt) {
        return reported.some(function (t) { return t.name === rt.name; });
      }),
      'reported [' + reported.map(function (t) { return t.name; }).join(', ') + ']');
    check('all_reported_tests_passed',
      reported.length > 0 && reported.every(function (t) { return t.passed === true; }),
      reported.filter(function (t) { return !t.passed; }).map(function (t) { return t.name; }).join(', ') || 'no tests reported');
  }

  // ---- Status coherence ----
  // A failing check can never coexist with a "completed" claim.
  check('status_is_completed', result.status === 'completed',
    'provider reported ' + result.status);

  return {
    verified: failures.length === 0,
    checks: checks,
    failures: failures,
    warnings: warnings
  };
}

module.exports = {
  verify: verify,
  isProhibitedPath: isProhibitedPath,
  PROHIBITED_PATH_PREFIXES: PROHIBITED_PATH_PREFIXES,
  PROHIBITED_PATH_SUBSTRINGS: PROHIBITED_PATH_SUBSTRINGS
};
