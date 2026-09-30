'use strict';
// =====================================================
// Mythos AI Executor — the measured outcome of a finished attempt
// projects/mythos-ai-executor/lib/measured-outcome.js
//
// A worker's "completed" is a claim. This module decides whether the
// MEASURED state agrees with it, for every provider, before the executor
// settles a task COMPLETED:
//
//   MEASURED STATE → VALIDATION → STATUS      (never MODEL STATUS → STATUS)
//
// Measured, never reported:
//   * the files the task branch changed  — git diff <base>..HEAD, run here;
//   * the commit                          — verifyGit (exists, on the branch);
//   * the declared checks                 — run by the provider's validator
//                                           (haddad-agent) or by
//                                           runDeclaredChecks below;
//   * the model that answered             — the provider's own usage record
//                                           (claude -p modelUsage) or the
//                                           runtime it called (haddad-agent).
//
// Live defect this closes (E2E #542, 2026-09-30): a `document` task whose
// worker created nothing and whose summary said "The task cannot be
// completed as specified" settled COMPLETED — 0 changed files, 0 checks
// run, mechanically_verified:false, no commit — because settleState only
// read the report's status. Every rule below is one of those facts.
//
// Pure except runDeclaredChecks/measureChangedFiles, which read the
// workspace. Everything is fail-closed: what cannot be measured is not
// treated as fine.
// =====================================================

var cp = require('child_process');
var work = require('./work-validation');

// --- the report admitting it did not do the task ------------------------------

// A report may say "completed" while its own summary says the task was not
// done (the model's status and its prose disagree). Deterministic phrases
// only. A phrase describing a defect the task FIXED ("the bug where uploads
// failed to complete") is not an admission: the clause before it names a
// defect, which is checked below.
var ADMISSION_RES = [
  /\b(?:task|work|objective|request|change|it)\s+(?:cannot|can ?not|could not|couldn't|can't|was not|wasn't|is not|isn't)\s+(?:be\s+)?(?:completed|done|finished|accomplished|delivered)\b/ig,
  /\b(?:failed|unable|not able)\s+to\s+(?:complete|create|write|finish|produce|deliver|make|perform|implement|apply)\b/ig,
  /\bcould\s*n(?:o|')t\s+(?:complete|create|write|finish|produce|deliver|implement|apply)\b/ig
];
var DEFECT_CONTEXT_RE = /\b(?:bug|issue|defect|error|regression|where|when|whenever|which|that|previously|used to)\b/i;

function admitsFailure(text) {
  var s = String(text || '');
  for (var i = 0; i < ADMISSION_RES.length; i++) {
    var re = ADMISSION_RES[i];
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(s)) !== null) {
      var start = Math.max(0, m.index - 40);
      var before = s.slice(start, m.index);
      var cut = Math.max(before.lastIndexOf('.'), before.lastIndexOf(';'), before.lastIndexOf('\n'));
      if (cut !== -1) before = before.slice(cut + 1);
      if (!DEFECT_CONTEXT_RE.test(before)) return m[0];
    }
  }
  return null;
}

// --- model identity --------------------------------------------------------------

// `claude -p --output-format json` records usage per model it called
// (modelUsage: { "<model id>": { outputTokens, … } }). The serving model is
// the one that produced the most output; a helper call (a summarizer) never
// outweighs the session that did the work.
function servingModelFromParsed(parsed) {
  var usage = parsed && parsed.modelUsage;
  if (!usage || typeof usage !== 'object') return null;
  var best = null, bestOut = -1;
  Object.keys(usage).forEach(function (k) {
    var u = usage[k] || {};
    var out = Number(u.outputTokens || u.output_tokens || 0);
    if (out > bestOut) { best = k; bestOut = out; }
  });
  return best;
}

// "claude-fable-5-1[1m]" / "claude-fable-5-1-20260901" → "claude-fable-5-1".
function normalizeModelId(id) {
  return String(id || '').trim().toLowerCase().replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
}

function sameModel(a, b) {
  var x = normalizeModelId(a), y = normalizeModelId(b);
  return !!x && x === y;
}

// --- measurement helpers (read the workspace) ------------------------------------

// Files the task branch changed since its base commit. null = not measurable
// (no base recorded, not a repository, git refused) — which the rules treat
// as a failure to measure, never as "nothing to check".
function measureChangedFiles(cwd, base) {
  if (!cwd || !/^[0-9a-f]{40}$/.test(String(base || ''))) return null;
  try {
    var out = cp.execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'diff', '--name-only', base + '..HEAD'],
      { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    return out.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  } catch (e) {
    return null;
  }
}

// Whether `commit` is a real commit ON the task branch since its base: it
// exists, HEAD contains it, and the base does not (so it is the task's own
// work, not a pre-existing commit). Local on purpose: the executor settles
// before the governance relay pushes, and REMOTE delivery is the
// supervisor's check (GitHub itself, supervisor/bridge.js verifyDelivery).
function commitOnTaskBranch(cwd, base, commit) {
  if (!cwd || !/^[0-9a-f]{40}$/.test(String(base || '')) || !/^[0-9a-f]{7,40}$/.test(String(commit || ''))) return false;
  function ok(args) {
    try { cp.execFileSync('git', ['-c', 'core.hooksPath=/dev/null'].concat(args), { cwd: cwd, stdio: 'ignore', timeout: 30000 }); return true; } catch (e) { return false; }
  }
  return ok(['cat-file', '-e', commit + '^{commit}']) && ok(['merge-base', '--is-ancestor', commit, 'HEAD']) && !ok(['merge-base', '--is-ancestor', commit, base]);
}

// The environment a check runs in: NOTHING the executor holds. A check runs
// code from the task's worktree, which the worker just edited; with the
// executor's environment that code could read its bearer or push with its
// SSH agent. The worker itself (repo-write) already runs `node` in this
// tree, so running the check grants nothing it lacked — as long as the
// environment is at most the worker's. An allow-list, not a deny-list.
var CHECK_ENV_KEEP = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'USER'];
function checkEnv(env) {
  var out = {};
  CHECK_ENV_KEEP.forEach(function (k) { if (env && env[k] !== undefined) out[k] = env[k]; });
  return out;
}

// One check, asynchronously: the executor daemon also serves its API and
// other tasks, so a slow suite must never block its event loop.
function runOne(check, cwd, env, timeoutMs) {
  return new Promise(function (resolve) {
    var out = '', done = false, child;
    function finish(code, signal, error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ check: check.raw, passed: !error && !signal && code === 0, exit_code: error || signal ? null : code,
        output: out.slice(0, 1200), error: error || (signal ? 'killed by ' + signal : null) });
    }
    try {
      child = cp.spawn(check.program, check.args, { cwd: cwd, env: env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return finish(null, null, String(e && e.message).slice(0, 200)); }
    var timer = setTimeout(function () { try { child.kill('SIGKILL'); } catch (e) { /* already gone */ } finish(null, null, 'timed out after ' + Math.round(timeoutMs / 1000) + ' s'); }, timeoutMs);
    function take(d) { if (out.length < 8192) out += String(d); }
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', function (e) { finish(null, null, String(e && e.message).slice(0, 200)); });
    child.on('close', function (code, signal) { finish(code, signal, null); });
  });
}

// Runs the task's runnable acceptance criteria (the same `node …`/`npm …`
// grammar the Haddad validator runs) in the worktree AFTER the worker has
// finished, for a provider that brings no validator of its own, one after
// another. Resolves the validator's evidence shape so one set of rules
// judges both.
function runDeclaredChecks(cwd, checks, opts) {
  opts = opts || {};
  var parsed = work.parseChecks(checks);
  var evidence = { mechanically_verified: parsed.runnable.length > 0, checks_run: [], checks_advisory: parsed.advisory, runner: 'executor' };
  var env = checkEnv(opts.env || process.env);
  return parsed.runnable.reduce(function (p, check) {
    return p.then(function () {
      return runOne(check, cwd, env, opts.timeoutMs || 300000).then(function (r) { evidence.checks_run.push(r); });
    });
  }, Promise.resolve()).then(function () { return evidence; });
}

// --- the verdict ---------------------------------------------------------------

function claimedPaths(report) {
  var list = report && Array.isArray(report.files_changed) ? report.files_changed : [];
  var out = [];
  list.forEach(function (entry) {
    work.declaredScope([String(entry).replace(/[`()]/g, ' ')]).forEach(function (p) { out.push(p); });
  });
  return out.filter(function (x, i) { return out.indexOf(x) === i; });
}

// assess(input) → { contradictions: [{ code, detail }], identity }
//
// input: {
//   task          { expected_delivery, fallback_model }
//   report        the extracted structured report (may be null)
//   evidence      validation evidence: { mechanically_verified, checks_run[] }
//                 (haddad-agent's validator, or runDeclaredChecks) or null
//   validationPassed  the provider validator's own verdict, when it had one
//   commitVerified  commitOnTaskBranch(…) for the report's commit
//   scope         the task's declared Scope; its path-like entries bound
//                 what a change task may change (prose enforces nothing)
//   projectScope  the project's write_scope (config/projects.json), if any
//   changedFiles  measureChangedFiles(…) — array, or null when unmeasurable
//   requestedModel  the model id the task named explicitly, or null
//   servingModel  the measured model that answered, or null
// }
//
// Only a report whose status is "completed" is judged: any other status is
// already not a completion (settleState). An empty contradictions list is
// the ONLY way a completion survives.
function assess(input) {
  input = input || {};
  var task = input.task || {};
  var report = input.report || null;
  var out = [];
  function add(code, detail) { out.push({ code: code, detail: detail }); }

  var identity = {
    requested_model: input.requestedModel || null,
    serving_model: input.servingModel || null,
    fallback_model: task.fallback_model || null,
    fallback_used: false,
    match: null
  };
  if (input.requestedModel) {
    if (!input.servingModel) {
      identity.match = false;
    } else if (sameModel(input.requestedModel, input.servingModel)) {
      identity.match = true;
    } else if (task.fallback_model && sameModel(task.fallback_model, input.servingModel)) {
      // The task itself permitted this model as its fallback: recorded as a
      // fallback, never called the requested model.
      identity.match = true;
      identity.fallback_used = true;
    } else {
      identity.match = false;
    }
  }

  if (!report || report.status !== 'completed') return { contradictions: out, identity: identity };

  var admission = admitsFailure(report.summary);
  if (admission) add('REPORT_ADMITS_FAILURE', 'the report says "completed" but its summary says "' + admission + '"');

  if (input.requestedModel && identity.match !== true) {
    add('MODEL_IDENTITY', input.servingModel
      ? 'the task named ' + input.requestedModel + ' but ' + input.servingModel + ' answered'
      : 'the task named ' + input.requestedModel + ' but the model that answered was not measured');
  }

  if (task.expected_delivery === 'commit') {
    var ev = input.evidence || null;
    if (input.commitVerified !== true) add('NO_VERIFIED_COMMIT', 'a commit delivery was required and the report names no commit that git shows on the task branch since its base');
    if (input.changedFiles === null || input.changedFiles === undefined) {
      add('CHANGES_UNMEASURED', 'the changes on the task branch could not be measured (no base commit or git refused)');
    } else if (!input.changedFiles.length) {
      add('NO_MEASURED_CHANGE', 'a change was required and the task branch changed no file since its base');
    } else {
      var notMeasured = claimedPaths(report).filter(function (p) { return input.changedFiles.indexOf(p) === -1; });
      if (notMeasured.length) add('CLAIM_NOT_MEASURED', 'the report claims ' + notMeasured.slice(0, 5).join(', ') + ' changed, but the task branch does not show it');
      var scope = work.declaredScope(input.scope || []);
      var outside = scope.length ? input.changedFiles.filter(function (f) { return !work.withinScope(f, scope); }) : [];
      if (outside.length) add('OUT_OF_SCOPE', outside.slice(0, 5).join(', ') + ' changed, outside the declared scope (' + scope.join(', ') + ')');
      var proj = input.projectScope || [];
      var outsideProject = proj.length ? input.changedFiles.filter(function (f) { return !work.withinScope(f, proj); }) : [];
      if (outsideProject.length) add('OUT_OF_PROJECT', outsideProject.slice(0, 5).join(', ') + ' changed, but this project may only write under ' + proj.join(', '));
    }
    if (!ev || ev.mechanically_verified !== true) {
      add('NOT_MECHANICALLY_VERIFIED', 'a change task needs at least one runnable acceptance check (`node …`/`npm …` in Validation); none ran');
    } else {
      var ran = ev.checks_run || [];
      if (!ran.length) add('NO_CHECK_RAN', 'checks were declared but none ran');
      var failed = ran.filter(function (c) { return !c.passed; });
      if (failed.length) add('CHECK_FAILED', failed.slice(0, 3).map(function (c) { return '`' + c.check + '` ' + (c.error || 'exit ' + c.exit_code); }).join('; '));
    }
    if (input.validationPassed === false) add('VALIDATION_FAILED', 'the provider\'s own validator did not pass this attempt');
  }
  return { contradictions: out, identity: identity };
}

module.exports = {
  admitsFailure: admitsFailure,
  servingModelFromParsed: servingModelFromParsed,
  normalizeModelId: normalizeModelId,
  sameModel: sameModel,
  measureChangedFiles: measureChangedFiles,
  commitOnTaskBranch: commitOnTaskBranch,
  checkEnv: checkEnv,
  runDeclaredChecks: runDeclaredChecks,
  claimedPaths: claimedPaths,
  assess: assess,
  CHECK_ENV_KEEP: CHECK_ENV_KEEP
};
