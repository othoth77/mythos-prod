'use strict';
// =====================================================
// Mythos AI Executor — mechanical validation of a worker's actual work
// projects/mythos-ai-executor/lib/work-validation.js
//
// A worker that reports its own success is not evidence of success. This
// module produces the evidence instead, from three sources the worker does
// not control:
//
//   1. the WORKSPACE, snapshotted before and after the attempt, so what
//      changed is measured rather than claimed;
//   2. the ACCEPTANCE CRITERIA, re-run here — the criteria a task declared
//      are executed by the validator itself, not trusted from a summary
//      that says they were;
//   3. the REPORT, checked for shape and for the failure it may be
//      admitting.
//
// It decides nothing new about what "valid" means: the verdict comes from
// core/validation.js's own validators (schema, completeness, security,
// tests), with this module supplying the injected test_runner they were
// always designed to take. What is added here is the one thing that module
// cannot know: which files an attempt was ALLOWED to touch, and whether a
// check's own file was quietly edited to make it pass.
//
// Everything here is fail-closed. An unreadable workspace, an unrunnable
// check and an unparseable report are all failures, never "assume fine".
// =====================================================

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

// Directories whose contents are never part of a work diff. .git is
// excluded because the runner cannot write there at all (and a change
// under it would be a security finding, not a work product); node_modules
// because installing dependencies is not the work being judged.
var IGNORED_DIRS = ['.git', 'node_modules'];
var MAX_SNAPSHOT_FILES = 5000;
var MAX_HASHED_BYTES = 2 * 1024 * 1024;

function hashFile(abs, size) {
  if (size > MAX_HASHED_BYTES) return 'size:' + size;
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  } catch (e) {
    return 'unreadable';
  }
}

// A content snapshot of the workspace: relative path → digest. Symlinks are
// recorded by their target rather than followed, so a link swapped for a
// file is a visible change instead of an invisible one.
function snapshot(workspace) {
  var files = {};
  var count = 0;
  var truncated = false;
  function walk(dir, rel) {
    if (truncated) return;
    var entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var childRel = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (IGNORED_DIRS.indexOf(e.name) !== -1) continue;
        walk(path.join(dir, e.name), childRel);
        continue;
      }
      if (++count > MAX_SNAPSHOT_FILES) { truncated = true; return; }
      var abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        var target = 'broken';
        try { target = fs.readlinkSync(abs); } catch (e2) { /* keep 'broken' */ }
        files[childRel] = 'symlink:' + target;
        continue;
      }
      var st;
      try { st = fs.lstatSync(abs); } catch (e3) { continue; }
      if (!st.isFile()) { files[childRel] = 'special'; continue; }
      files[childRel] = hashFile(abs, st.size);
    }
  }
  walk(workspace, '');
  return { files: files, truncated: truncated, at: new Date().toISOString() };
}

function diffSnapshot(before, after) {
  var b = (before && before.files) || {};
  var a = (after && after.files) || {};
  var created = [], modified = [], deleted = [];
  Object.keys(a).forEach(function (p) {
    if (b[p] === undefined) created.push(p);
    else if (b[p] !== a[p]) modified.push(p);
  });
  Object.keys(b).forEach(function (p) { if (a[p] === undefined) deleted.push(p); });
  return { created: created.sort(), modified: modified.sort(), deleted: deleted.sort() };
}

// Which declared criteria can this validator RUN? A criterion that names a
// command is executed; a criterion written in prose stays a human/reviewer
// matter and is reported as such. Prose is never counted as passed — it is
// counted as not mechanically checked, which is a different thing and is
// said in those words.
var RUNNABLE_RE = /^\s*(?:\$\s*)?(node|npm)\s+(.+?)\s*$/i;

function parseChecks(list) {
  var runnable = [], advisory = [];
  (list || []).forEach(function (raw) {
    var line = String(raw || '').trim().replace(/^[-*\d.)\s]+/, '');
    if (!line) return;
    var m = RUNNABLE_RE.exec(line);
    if (!m) { advisory.push(line); return; }
    var args = m[2].split(/\s+/).filter(Boolean);
    runnable.push({ raw: line, program: m[1].toLowerCase(), args: args });
  });
  return { runnable: runnable, advisory: advisory };
}

// Paths a task declared as its working scope. Only entries that look like a
// path are taken; prose in a Scope section is guidance for the worker, not a
// rule this module can enforce, and pretending otherwise would fail tasks
// for the wrong reason.
var PATHLIKE_RE = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/;

function declaredScope(list) {
  var out = [];
  (list || []).forEach(function (raw) {
    String(raw || '').split(/[\s,]+/).forEach(function (tok) {
      var t = tok.trim().replace(/^[-*]\s*/, '').replace(/[.,;:]$/, '');
      if (!t || t.length < 3) return;
      if (t.indexOf('/') === -1 && t.indexOf('.') === -1) return;
      if (!PATHLIKE_RE.test(t)) return;
      out.push(t.replace(/^\.\//, '').replace(/\/$/, ''));
    });
  });
  return out.filter(function (x, i) { return out.indexOf(x) === i; });
}

function withinScope(file, scope) {
  return scope.some(function (s) { return file === s || file.indexOf(s + '/') === 0; });
}

// The files a criterion names, so "the check's own file was edited" can be
// detected. A worker that makes a test pass by rewriting the test has not
// done the work, and this is the cheapest reliable way to see it.
function filesNamedByChecks(checks) {
  var out = [];
  checks.forEach(function (c) {
    c.args.forEach(function (a) {
      if (a.indexOf('/') !== -1 || /\.(js|json|mjs|cjs|ts)$/.test(a)) {
        out.push(a.replace(/^\.\//, ''));
      }
    });
  });
  return out.filter(function (x, i) { return out.indexOf(x) === i; });
}

// validateWork(input) → { pass, rejections, evidence }
//
// input: {
//   report        the worker's structured report (may be null)
//   workspace     absolute path
//   before, after snapshots
//   checks        declared acceptance criteria (task.required_tests)
//   scope         declared allowed scope (optional)
//   runCommand    (program, args) → { exit_code, stdout, stderr, error }
//   validation    optional core/validation module (injected in tests)
// }
function validateWork(input) {
  input = input || {};
  var rejections = [];
  var report = input.report || null;
  var diff = diffSnapshot(input.before, input.after);
  var parsed = parseChecks(input.checks);
  var scope = declaredScope(input.scope);
  var evidence = {
    changed: diff,
    checks_run: [],
    checks_advisory: parsed.advisory,
    scope_declared: scope,
    // Whether a path scope existed to enforce AT ALL. A task whose
    // constraints are prose ("do not weaken the check") yields no path and
    // therefore no scope rule — which is legitimate, but "stayed in scope"
    // and "there was no scope" are different facts and must never read the
    // same downstream. Recorded for the same reason mechanically_verified
    // is: the difference travels to the reviewer instead of being lost.
    scope_enforced: scope.length > 0,
    out_of_scope: []
  };

  // --- 1. the report's own shape and admissions -----------------------------
  // Reused verbatim from core/validation.js: the same validators that judge
  // an orchestration-core result judge this one. A report that ADMITS
  // failure is a valid shape and never a success — that rule already exists
  // there and is not restated here.
  var core = input.validation || require('../core/validation');
  var coreTask = {
    // Deliberately not 'coding': this worker cannot commit, and the git
    // validator must not demand a commit it was never allowed to make.
    task_type: 'integration',
    policy_classes: ['READ', 'PROJECT_WRITE'],
    metadata: {
      required_tests: [],              // run below, with real evidence
      required_files: (input.requiredFiles || []).map(function (f) {
        return path.join(input.workspace, f);
      })
    }
  };
  var coreVerdict = core.validate(coreTask, report || {}, {});
  coreVerdict.rejections.forEach(function (r) { rejections.push(r); });

  // --- 2. the declared checks, run HERE ------------------------------------
  // A task that declared NOTHING cannot be verified at all, and saying so is
  // the whole point of this module. A task whose criteria are all prose is a
  // different case: prose is legitimate (an investigation's criteria usually
  // are), it simply cannot be machine-checked — so the work passes here and
  // is flagged as not mechanically verified, which is a fact a reviewer
  // needs and which must never be dressed up as a verified pass.
  // Criteria that can be RUN are what makes a pass mechanical. Prose
  // criteria are legitimate (an investigation's usually are) and so is a
  // task that declared none — but neither can be machine-checked, and the
  // difference between "verified" and "nothing contradicted it" must never
  // be lost. It is recorded here and travels into the report, where a
  // reviewer and the review gate can both see it. Failing the worker for
  // what the task author did not declare would punish the wrong party.
  evidence.mechanically_verified = parsed.runnable.length > 0;
  parsed.runnable.forEach(function (check) {
    var r;
    try {
      r = input.runCommand(check.program, check.args);
    } catch (e) {
      r = { error: 'runner threw: ' + String(e && e.message).slice(0, 160) };
    }
    var passed = !r.error && r.exit_code === 0;
    evidence.checks_run.push({
      check: check.raw,
      passed: passed,
      exit_code: r.error ? null : r.exit_code,
      output: String((r.stdout || '') + (r.stderr || '')).slice(0, 1200),
      error: r.error || null
    });
    if (!passed) {
      rejections.push('acceptance: `' + check.raw + '` did not pass — ' +
        (r.error ? r.error : 'exit ' + r.exit_code +
          (r.stderr ? ': ' + String(r.stderr).trim().slice(0, 300) : '') ||
          ''));
    }
  });

  // --- 3. did the attempt change what it was allowed to change? ------------
  var touched = diff.created.concat(diff.modified, diff.deleted);
  if (scope.length) {
    evidence.out_of_scope = touched.filter(function (f) { return !withinScope(f, scope); });
    evidence.out_of_scope.forEach(function (f) {
      rejections.push('scope: ' + f + ' was changed but is not inside the declared scope (' + scope.join(', ') + ')');
    });
  }

  // --- 4. anti-cheating: the check's own file must survive the attempt -----
  var checkFiles = filesNamedByChecks(parsed.runnable);
  checkFiles.forEach(function (f) {
    if (diff.deleted.indexOf(f) !== -1) {
      rejections.push('integrity: ' + f + ' is named by an acceptance check and was DELETED — a check cannot be passed by removing it');
    } else if (diff.modified.indexOf(f) !== -1) {
      rejections.push('integrity: ' + f + ' is named by an acceptance check and was MODIFIED — fix the code under test, not the check');
    }
  });

  // --- 5. did anything happen at all? --------------------------------------
  if (!touched.length && parsed.runnable.length) {
    // Not automatically a failure: a task can be satisfied by work that was
    // already correct. It IS a failure when the report claims changes.
    if (report && Array.isArray(report.files_changed) && report.files_changed.length) {
      rejections.push('evidence: the report claims ' + report.files_changed.length +
        ' changed file(s) but the workspace is byte-identical to before the attempt');
    }
  }

  return { pass: rejections.length === 0, rejections: rejections, evidence: evidence };
}

// The repair brief handed back to the worker. Deliberately the same shape
// the orchestrator already uses for its own repair loop
// (core/orchestrator.js "## REPAIR REQUIRED (attempt N)"), so a worker that
// has seen one has seen both, and there is one format in the system rather
// than two.
// opts (optional): { tool_calls: number of tool calls the rejected round
// made, files_named: files the failing checks exercise }. A round that made
// NO tool call is the failure mode a small model falls into most — it
// "fixes" the file in prose and reports success (gh-issue-373, live) — so
// the brief names it and says what a change actually is.
function renderRepairNotes(verdict, attempt, constraints, opts) {
  opts = opts || {};
  var lines = [
    '## REPAIR REQUIRED (attempt ' + (attempt || 1) + ')',
    '',
    'Your previous attempt was REJECTED by independent validation — not by your own report.',
    'Every line below is measured evidence from the workspace, not an opinion.',
    ''
  ];
  if (opts.tool_calls === 0) {
    lines.push('Your previous reply made NO tool call: nothing was written and nothing ran. Code shown in a ```block is NOT applied — only a write_file call changes the workspace.', '');
  }
  var ev0 = verdict.evidence || {};
  var allRanPassed = (ev0.checks_run || []).length > 0 && (ev0.checks_run || []).every(function (c) { return c.passed; });
  if (opts.out_of_turns) {
    lines.push('Your previous attempt used all ' + opts.out_of_turns + ' tool turns without emitting the final report.');
    if (allRanPassed) {
      lines.push('The validator ran every declared check on the workspace as you left it and ALL OF THEM PASS. Do not change anything: emit the final ```json mythos_report block NOW, with status "completed", the files you changed and the checks that passed. No more tool calls.');
    } else {
      lines.push('The validator ran the declared checks on the workspace as you left it; the ones that still fail are listed below. Fix them, then emit the report.');
    }
    lines.push('');
  }
  lines.push('### What failed');
  verdict.rejections.forEach(function (r) { lines.push('- ' + r); });
  var ev = verdict.evidence || {};
  var ran = (ev.checks_run || []).filter(function (c) { return !c.passed; });
  if (ran.length) {
    lines.push('', '### Output of the checks that failed');
    ran.forEach(function (c) {
      lines.push('', '`' + c.check + '` → ' + (c.error ? c.error : 'exit ' + c.exit_code));
      if (c.output && c.output.trim()) {
        lines.push('```', c.output.trim().slice(0, 800), '```');
      }
    });
  }
  var ch = ev.changed || {};
  lines.push('', '### What you actually changed');
  lines.push('- created: ' + ((ch.created || []).join(', ') || 'nothing'));
  lines.push('- modified: ' + ((ch.modified || []).join(', ') || 'nothing'));
  lines.push('- deleted: ' + ((ch.deleted || []).join(', ') || 'nothing'));
  lines.push('', '### Rules for this attempt');
  lines.push('- Fix the CAUSE. Do not edit, weaken or delete a check to make it pass.');
  lines.push('- Do not delete functionality to remove a failure.');
  lines.push('- Read the failing file before changing it; write the whole file back.');
  if (ev.scope_declared && ev.scope_declared.length) {
    lines.push('- Stay inside: ' + ev.scope_declared.join(', '));
  }
  (constraints || []).forEach(function (c) { lines.push('- ' + String(c).slice(0, 300)); });
  // The order of operations, as tool calls. Prose is not one of them.
  var failingChecks = ran.map(function (c) { return c.check; });
  var targets = (opts.files_named || []).filter(Boolean);
  if (opts.out_of_turns && allRanPassed) {
    lines.push('', '### What to do now');
    lines.push('Emit the final ```json mythos_report block and nothing else. Every check already passes.');
    return lines.join('\n');
  }
  lines.push('', '### What to do now — as TOOL CALLS, in this order');
  lines.push('1. read_file the file you must fix' + (targets.length ? ' (' + targets.join(', ') + ')' : '') + ' if you no longer have its current content.');
  lines.push('2. write_file that path with the COMPLETE corrected file. A code block in your answer changes nothing.');
  lines.push('3. run_command each failing check' + (failingChecks.length ? ': ' + failingChecks.map(function (c) { return '`' + c + '`'; }).join(', ') : '') + ' and read its output.');
  lines.push('4. Only when they pass, emit the report. A report that claims a pass the checks did not produce is rejected again.');
  return lines.join('\n');
}

module.exports = {
  snapshot: snapshot,
  diffSnapshot: diffSnapshot,
  parseChecks: parseChecks,
  declaredScope: declaredScope,
  withinScope: withinScope,
  filesNamedByChecks: filesNamedByChecks,
  validateWork: validateWork,
  renderRepairNotes: renderRepairNotes,
  IGNORED_DIRS: IGNORED_DIRS
};
