#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS HADDAD V2.1 — live role evidence runner
// projects/mythos-haddad/bin/haddad-role-e2e.js
//
// Runs ONE real task per AI-team role through the EXISTING executor
// (executor.createTask → executor.runTask → providers/haddad-agent → bwrap →
// lib/work-validation → deliverValidatedWork) against the real local
// runtime, in an isolated executor home and an isolated git worktree per
// role, and writes measured evidence: status, validation verdict, tool
// trace, workspace writes (git status of the workspace, before and after),
// duration, repair rounds, whether a diagnosis was requested.
//
// It schedules nothing, adds no provider and bypasses no gate: the only
// thing it does that the GitHub bridge would not is build the task envelope
// itself, exactly as the bridge does (action → profile via
// bridge/action-resolution.js, delivery via the same table). This is the
// V2.1 gate's "one real Qwen task per role, with measured evidence".
//
//   HADDAD_E2E_HOME=~/mythos-ai-executor-haddad-e2e \
//   node projects/mythos-haddad/bin/haddad-role-e2e.js [role ...]
//
// Roles default to all six. Evidence: $HADDAD_E2E_HOME/evidence/<role>.json
// =====================================================
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var REPO = path.resolve(__dirname, '..', '..', '..');
var EXEC = path.join(REPO, 'projects', 'mythos-ai-executor');
var HOME = process.env.HADDAD_E2E_HOME || path.join(os.homedir(), 'mythos-ai-executor-haddad-e2e');
process.env.MYTHOS_EXECUTOR_HOME = HOME;
process.env.MYTHOS_MAX_PARALLEL = '1';
if (!process.env.HADDAD_AGENT_MODEL) {
  // Mirror the production worker's model choice; the diagnoser mirrors too
  // when the caller exported it (L2 is production behaviour, not a test aid).
  try {
    var envText = fs.readFileSync(path.join(os.homedir(), '.config', 'mythos-haddad', 'worker.env'), 'utf8');
    var m = /^HADDAD_AGENT_MODEL=(.+)$/m.exec(envText);
    if (m) process.env.HADDAD_AGENT_MODEL = m[1].trim();
  } catch (e) { /* caller must export it */ }
}
fs.mkdirSync(path.join(HOME, 'evidence'), { recursive: true });

var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var engine = require(path.join(EXEC, 'bridge', 'action-resolution'));
var roles = require(path.join(EXEC, 'lib', 'roles'));

function sh(cmd, args, cwd) {
  var r = cp.spawnSync(cmd, args, { cwd: cwd, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: os.homedir(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  if (r.status !== 0) throw new Error(cmd + ' ' + args.join(' ') + ' failed: ' + (r.stderr || r.stdout));
  return r.stdout;
}
function gitStatus(ws) { return sh('git', ['-c', 'core.hooksPath=/dev/null', 'status', '--porcelain', '--untracked-files=all'], ws).trim(); }
function gitHead(ws) { return sh('git', ['rev-parse', 'HEAD'], ws).trim(); }

// One isolated worktree per role, on its own scratch branch, with the
// fixture files COMMITTED so "what changed" is measured against a clean tree.
function workspaceFor(role, fixtures) {
  var ws = path.join(HOME, 'ws', role);
  var branch = 'mythos-haddad/v2e2e-' + role + '-' + Date.now().toString(36);
  try { sh('git', ['worktree', 'remove', '--force', ws], REPO); } catch (e) { /* none */ }
  fs.rmSync(ws, { recursive: true, force: true });
  sh('git', ['worktree', 'add', '-q', ws, '-b', branch, 'HEAD'], REPO);
  Object.keys(fixtures).forEach(function (rel) {
    var abs = path.join(ws, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, fixtures[rel]);
  });
  if (Object.keys(fixtures).length) {
    sh('git', ['add', '-A'], ws);
    sh('git', ['-c', 'user.name=haddad-e2e', '-c', 'user.email=haddad-e2e@localhost', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'e2e fixture for role ' + role], ws);
  }
  return { dir: ws, branch: branch, base: gitHead(ws) };
}

var FIX = 'projects/mythos-haddad/lib/e2e/';
var SUM_JS = "'use strict';\n// sum(list): the sum of a list of numbers.\nfunction sum(list) {\n  var total = 0;\n  for (var i = 1; i < list.length; i++) total += list[i];\n  return total;\n}\nmodule.exports = sum;\n";
var SUM_TEST = "'use strict';\nvar assert = require('assert');\nvar sum = require('./sum');\nassert.strictEqual(sum([]), 0);\nassert.strictEqual(sum([5]), 5);\nassert.strictEqual(sum([1, 2, 3]), 6);\nconsole.log('sum: 3 passed, 0 failed');\n";
var SUM_OK_JS = SUM_JS.replace('var i = 1', 'var i = 0');
var GREET_JS = "'use strict';\n// greet(name): TODO — must return 'Hello, <name>!'\nfunction greet(name) {\n  return '';\n}\nmodule.exports = greet;\n";
var GREET_TEST = "'use strict';\nvar assert = require('assert');\nvar greet = require('./greet');\nassert.strictEqual(greet('Haddad'), 'Hello, Haddad!');\nassert.strictEqual(greet(''), 'Hello, !');\nconsole.log('greet: 2 passed, 0 failed');\n";
var PCT_JS = "'use strict';\n// pct(done, total): integer percentage of done out of total.\nfunction pct(done, total) {\n  return Math.floor(done / total * 100);\n}\nmodule.exports = pct;\n";
var PCT_TEST = "'use strict';\nvar assert = require('assert');\nvar pct = require('./pct');\nassert.strictEqual(pct(0, 0), 0, 'zero total must give 0, never NaN');\nassert.strictEqual(pct(1, 3), 33);\nassert.strictEqual(pct(2, 3), 67, 'rounded to nearest, not floored');\nassert.strictEqual(pct(5, 5), 100);\nconsole.log('pct: 4 passed, 0 failed');\n";
var NOTES_MD = "# e2e notes\n\nThis file documents the e2e helpers.\n";
// The DOCUMENTER's acceptance criterion has to measure the deliverable. A
// test of sum.js passes whether or not the documentation was written (found
// live: the first documenter run reported `blocked`, wrote nothing, and its
// declared check still passed), so the criterion is a file that reads
// NOTES.md itself.
var NOTES_CHECK = "'use strict';\nvar fs = require('fs');\nvar path = require('path');\nvar notes = fs.readFileSync(path.join(__dirname, 'NOTES.md'), 'utf8');\nvar need = [['the function name', /\\bsum\\b/], ['its parameter', /\\blist\\b/], ['the test command', /node projects\\/mythos-haddad\\/lib\\/e2e\\/sum\\.test\\.js/]];\nvar missing = need.filter(function (n) { return !n[1].test(notes); }).map(function (n) { return n[0]; });\nif (missing.length) { console.error('NOTES.md does not document: ' + missing.join(', ')); process.exit(1); }\nif (!/^# e2e notes/m.test(notes)) { console.error('NOTES.md lost its title line'); process.exit(1); }\nconsole.log('notes: 4 passed, 0 failed');\n";

var SCENARIOS = {
  coder: {
    action: 'implement',
    fixtures: (function () { var f = {}; f[FIX + 'greet.js'] = GREET_JS; f[FIX + 'greet.test.js'] = GREET_TEST; return f; })(),
    instruction: 'Implement `greet(name)` in `' + FIX + 'greet.js` so that it returns the string "Hello, <name>!" (for example greet("Haddad") → "Hello, Haddad!"). Every path below is complete: use each one exactly as written, never a bare file name. Read `' + FIX + 'greet.js` and `' + FIX + 'greet.test.js` first, then write `' + FIX + 'greet.js` — that exact path, complete content. Run `node ' + FIX + 'greet.test.js` once, then report. Create no other file. This task is SUPERVISED: independent validation re-runs the check below after your report.',
    constraints: ['Only change ' + FIX + 'greet.js', 'Do NOT modify or delete any test file.', 'No new dependency.'],
    required_tests: ['node ' + FIX + 'greet.test.js']
  },
  debugger: {
    action: 'implement',
    fixtures: (function () { var f = {}; f[FIX + 'pct.js'] = PCT_JS; f[FIX + 'pct.test.js'] = PCT_TEST; return f; })(),
    instruction: 'The test `' + FIX + 'pct.test.js` is FAILING. Find the bug in `' + FIX + 'pct.js` and fix it: `pct(done, total)` must return the integer percentage of done out of total ROUNDED to the nearest whole number, and must return 0 when total is 0 (never NaN, never a division by zero). Every path below is complete: use each one exactly as written, never a bare file name. Read both files, run `node ' + FIX + 'pct.test.js` to see the failure, then write `' + FIX + 'pct.js` — that exact path, complete content. Run the test once more, then report with the root cause. Create no other file. This task is SUPERVISED: independent validation re-runs the check below after your report.',
    constraints: ['Only change ' + FIX + 'pct.js', 'Do NOT modify or delete any test file. Fix the code under test.', 'Keep it under 15 lines.'],
    required_tests: ['node ' + FIX + 'pct.test.js']
  },
  documenter: {
    action: 'document',
    fixtures: (function () { var f = {}; f[FIX + 'sum.js'] = SUM_OK_JS; f[FIX + 'sum.test.js'] = SUM_TEST; f[FIX + 'NOTES.md'] = NOTES_MD; f[FIX + 'notes.check.js'] = NOTES_CHECK; return f; })(),
    instruction: 'Update the file `' + FIX + 'NOTES.md` so that it documents the function exported by `' + FIX + 'sum.js`. Every path below is complete: use each one exactly as written, never a bare file name. Read `' + FIX + 'sum.js` with read_file first. Then write `' + FIX + 'NOTES.md` with write_file — that exact path, one file, complete content — keeping its first line `# e2e notes` and stating: the function name `sum`, that its one parameter is called `list`, what it returns, and the exact command `node ' + FIX + 'sum.test.js` that runs its test. Then run `node ' + FIX + 'notes.check.js` once to confirm, then report. Change no .js file and create no other file. This task is SUPERVISED: independent validation re-runs the check below after your report.',
    constraints: ['Only change ' + FIX + 'NOTES.md', 'Do NOT modify any .js file.'],
    required_tests: ['node ' + FIX + 'notes.check.js']
  },
  tester: {
    action: 'test',
    fixtures: (function () { var f = {}; f[FIX + 'sum.js'] = SUM_JS; f[FIX + 'sum.test.js'] = SUM_TEST; f[FIX + 'greet.js'] = GREET_JS.replace("return '';", "return 'Hello, ' + name + '!';"); f[FIX + 'greet.test.js'] = GREET_TEST; return f; })(),
    instruction: 'Run the two test files `' + FIX + 'sum.test.js` and `' + FIX + 'greet.test.js` with run_command (node <file>), one at a time. Report, for each file, the exact exit code and what it printed, and classify any failure. You must not change any file.',
    constraints: ['Read-only: no file edits, no commits.'],
    required_tests: ['node ' + FIX + 'greet.test.js']
  },
  reviewer: {
    action: 'review',
    fixtures: (function () { var f = {}; f[FIX + 'sum.js'] = SUM_JS; f[FIX + 'sum.test.js'] = SUM_TEST; return f; })(),
    instruction: 'Review `' + FIX + 'sum.js` against its test `' + FIX + 'sum.test.js`. sum(list) must return the sum of every number in the list. List concrete findings with the file path and line, and end with a verdict: approve or request changes. Read-only.',
    constraints: ['Read-only: no file edits, no commits.'],
    required_tests: []
  },
  researcher: {
    action: 'investigate',
    fixtures: {},
    instruction: 'Answer from the repository files only: which file under projects/mythos-ai-executor/lib defines the execution profiles, and what are the names of the profiles it defines? Cite the file you read. Read-only; there is no network.',
    constraints: ['Read-only: no file edits, no commits.', 'Answer from repository files only.'],
    required_tests: []
  }
};

function runRole(role) {
  var sc = SCENARIOS[role];
  if (!sc) return Promise.reject(new Error('unknown role ' + role));
  var ws = workspaceFor(role, sc.fixtures);
  var before = gitStatus(ws.dir);
  var t0 = Date.now();
  var task = executor.createTask({
    project: 'mythos-haddad',
    stage: 'v2e2e:' + role,
    instruction: sc.instruction,
    priority: 'normal',
    requested_by: 'haddad-role-e2e',
    mode: 'autonomous',
    provider: 'haddad-agent',
    execution_profile: engine.profileFor(sc.action),
    working_directory: ws.dir,
    branch: ws.branch,
    task_category: sc.action,
    action_source: 'explicit_current_issue',
    action_raw: sc.action,
    attempt_id: 'v2e2e-' + role + '#1',
    required_tests: sc.required_tests,
    constraints: sc.constraints,
    expected_delivery: engine.deliveryFor(sc.action),
    report_to_git: false,
    timeout_seconds: 1800,
    // Production retries a TRANSIENT failure and resumes the task; so does
    // this, for the same reason. Measured on 2026-09-22: four roles in a row
    // were recorded FAILED with zero tool calls because the local runtime
    // did not answer — once under a load average of 18, and once because
    // llama-server had come up CPU-only after a reboot (a /dev/dri ACL race
    // that health passes straight through). Neither was the task. Evidence
    // has to survive the machine, so a blip costs a retry, not a run.
    max_retries: 2
  });
  console.log('[' + role + '] task ' + task.task_id + ' role=' + task.role + ' skill=' + task.skill_id + ' profile=' + task.execution_profile + ' delivery=' + task.expected_delivery);
  // The daemon is what normally resumes a WAITING_RETRY task; this runner
  // has no daemon, so it does the same thing itself, bounded by the task's
  // own retry budget.
  function runToTerminal(attempt) {
    return executor.runTask(task.task_id).then(function () {
      var st = state.readStatus(task.task_id);
      if (st.status !== 'WAITING_RETRY' || attempt >= 2) return st;
      console.log('[' + role + '] transient failure, retrying (' + (attempt + 1) + '/2): ' + String(st.last_error || '').slice(0, 90));
      return new Promise(function (res) { setTimeout(res, 20000); }).then(function () { return runToTerminal(attempt + 1); });
    });
  }
  return runToTerminal(0).then(function () {
    var status = state.readStatus(task.task_id);
    var report = state.readJSON(task.task_id, 'report.json');
    // report.json carries what the provider MEASURED (executor V2.1
    // `evidence`): validator verdicts, tool trace, repair rounds.
    var ev = report && report.evidence ? report.evidence : null;
    var trace = ev ? ev.tool_trace.map(function (e, i) { return (i + 1) + '. ' + e.tool + (e.target ? ' ' + e.target : '') + (e.refused ? ' → REFUSED: ' + (e.detail || '') : ''); }) : [];
    var after = gitStatus(ws.dir);
    var head = gitHead(ws.dir);
    var evidence = {
      role: role, action: sc.action, task_id: task.task_id,
      role_recorded: task.role, role_reason: task.role_reason, skill_id: task.skill_id,
      execution_profile: task.execution_profile, expected_delivery: task.expected_delivery,
      status: status.status, duration_ms: Date.now() - t0, retry_count: status.retry_count,
      validation: ev ? ev.validation : null,
      validations: ev ? ev.validations : null,
      repair_rounds: ev ? ev.repair_rounds : null,
      tool_calls: ev ? ev.tool_calls : null,
      context_compactions: ev ? ev.context_compactions : null,
      report_status: report && report.report ? report.report.status : null,
      summary: report && report.report ? String(report.report.summary || '').slice(0, 600) : null,
      blocker: report && report.blocker ? report.blocker.code : null,
      workspace: { dir: ws.dir, branch: ws.branch, base: ws.base, head_after: head,
        status_before: before, status_after: after, delivered_commit: head !== ws.base,
        files_changed_vs_base: sh('git', ['diff', '--name-only', ws.base, head], ws.dir).trim().split('\n').filter(Boolean) },
      tool_trace: trace,
      diagnosis_requested: ev ? ev.diagnosis_requested : false,
      measured_at: new Date().toISOString()
    };
    fs.writeFileSync(path.join(HOME, 'evidence', role + '.json'), JSON.stringify(evidence, null, 2));
    console.log('[' + role + '] ' + evidence.status + ' in ' + Math.round(evidence.duration_ms / 1000) + 's; writes(after)=' + JSON.stringify(after) + '; delivered=' + evidence.workspace.delivered_commit + '; files=' + evidence.workspace.files_changed_vs_base.join(','));
    return evidence;
  });
}

var wanted = process.argv.slice(2);
if (!wanted.length) wanted = Object.keys(SCENARIOS);
var chain = Promise.resolve();
var results = [];
wanted.forEach(function (role) {
  chain = chain.then(function () { return runRole(role); }).then(function (ev) { results.push(ev); }, function (e) {
    console.error('[' + role + '] ERROR ' + (e && e.message));
    results.push({ role: role, error: String(e && e.message) });
  });
});
// A harness that registers a git worktree per role and never removes one is
// a worktree leak, which is on the V2 gate list by name. The evidence lives
// in evidence/<role>.json (it records the base and delivered SHAs and the
// files changed), so the worktree itself is disposable once measured.
// HADDAD_E2E_KEEP=1 keeps them for a post-mortem.
function cleanupWorkspaces() {
  if (process.env.HADDAD_E2E_KEEP === '1') { console.log('\nworktrees kept (HADDAD_E2E_KEEP=1)'); return; }
  var removed = 0;
  results.forEach(function (r) {
    if (!r || !r.workspace) return;
    try { sh('git', ['worktree', 'remove', '--force', r.workspace.dir], REPO); removed++; } catch (e) { /* already gone */ }
    try { sh('git', ['branch', '-D', r.workspace.branch], REPO); } catch (e) { /* already gone */ }
  });
  try { sh('git', ['worktree', 'prune'], REPO); } catch (e) { /* best effort */ }
  console.log('\ncleaned up ' + removed + ' role worktree(s) and their branches');
}

chain.then(function () {
  fs.writeFileSync(path.join(HOME, 'evidence', 'summary.json'), JSON.stringify(results, null, 2));
  console.log('\nSUMMARY');
  results.forEach(function (r) {
    console.log('  ' + r.role + ': ' + (r.error ? 'ERROR ' + r.error : r.status + ' role=' + r.role_recorded + ' writes=' + (r.workspace.status_after ? 'YES' : 'none') + ' delivered=' + r.workspace.delivered_commit + ' validation=' + (r.validation ? (r.validation.passed ? 'PASS' : 'FAIL') : 'n/a')));
  });
  try { cleanupWorkspaces(); } catch (e) { console.error('cleanup failed: ' + e.message); }
  process.exit(0);
});
