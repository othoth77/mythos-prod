'use strict';
// =====================================================
// MYTHOS — measured outcome: a worker's claim is not success
// tests/mythos-measured-outcome-test.js
//
// Regression suite for live E2E #542 (2026-09-30): a `document` task whose
// worker created nothing, committed nothing, ran no check, and summarised
// "The task cannot be completed as specified" settled COMPLETED on the
// Haddad executor — and the task had asked for Fable 5.1 while local Qwen
// answered. Every case below drives the REAL executor (mock provider,
// throwaway git repositories) or the real bridge/provider code, and asserts
// that the MEASURED state — never the report — decides the status.
//
//   A  says completed, creates nothing                 → BLOCKED
//   B  status completed, summary admits failure        → BLOCKED
//   C  zero changed files where a change is required   → BLOCKED
//   D  zero runnable checks on a change task           → BLOCKED
//   E  expected artifact missing (check fails)         → BLOCKED
//   F  expected marker missing (check fails)           → BLOCKED
//   G  no commit where commit delivery is required     → BLOCKED
//   H  mechanically_verified=false (the #542 shape)    → BLOCKED
//   I  report claims files git does not show           → BLOCKED
//   J  artifact + marker + passing check + commit      → COMPLETED
//   M  model identity: requested ≠ serving / unmeasured → BLOCKED;
//      task-permitted fallback → COMPLETED, recorded as fallback
//   S  checks run with none of the executor's secrets
//   P  haddad-agent sends and records ITS runtime model, never task.model
//   R  a Haddad (exec-worker) bridge refuses a named Claude model
//
// Offline and deterministic. Run with: node tests/mythos-measured-outcome-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIXTURES = path.join(os.homedir(), 'mythos-measured-outcome-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.HADDAD_AGENT_ENABLE_FILE = path.join(FIXTURES, 'no-haddad-agent.enabled');
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIXTURES, 'no-advisory-credential.env');
process.env.MYTHOS_FREE_LLM_KEY_DIR = path.join(FIXTURES, 'free-llm-keys-empty');
process.env.MYTHOS_RESOURCE_GUARD = 'off';
process.env.MYTHOS_SKILL_TRUST = 'off';
delete process.env.MYTHOS_MOCK_SCRIPT;

var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var mockProvider = require(path.join(EXEC, 'providers', 'mock'));
var measured = require(path.join(EXEC, 'lib', 'measured-outcome'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) {
  if (cond) { passed++; console.log('ok - ' + name); }
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

function git(cwd, args) { return cp.execFileSync('git', args, { cwd: cwd, encoding: 'utf8' }).trim(); }

// A repository with an existing controlled directory (never a new one: the
// #542 task-design error) and a real check that reads the artifact.
var CHECK_JS =
  'var fs = require("fs");\n' +
  'var f = process.argv[2], marker = process.argv[3];\n' +
  'if (!fs.existsSync(f)) { console.error("missing " + f); process.exit(1); }\n' +
  'var lines = fs.readFileSync(f, "utf8").split("\\n");\n' +
  'if (lines.indexOf("marker: " + marker) === -1) { console.error("no marker line in " + f); process.exit(1); }\n' +
  'console.log("ok " + f);\n';
var repoN = 0;
function makeRepo() {
  var dir = path.join(FIXTURES, 'repo-' + (++repoN));
  fs.mkdirSync(path.join(dir, 'e2e'), { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@test']);
  git(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'e2e', 'README.md'), 'controlled E2E directory\n');
  fs.writeFileSync(path.join(dir, 'check.js'), CHECK_JS);
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'base']);
  return { dir: dir, base: git(dir, ['rev-parse', 'HEAD']) };
}
function writeArtifact(dir, name, content, commit) {
  fs.writeFileSync(path.join(dir, 'e2e', name), content);
  if (!commit) return null;
  git(dir, ['add', 'e2e/' + name]);
  git(dir, ['commit', '-q', '-m', 'e2e: ' + name]);
  return git(dir, ['rev-parse', 'HEAD']);
}

executor.PROJECTS['mo-target'] = { repository: null, path: FIXTURES, default_branch: 'main' };

var GOOD_CHECK = 'node check.js e2e/LIVE.md LIVE-OK-1';

// Runs one attempt through the real executor. `work(repo)` plays the
// worker (it runs after the task exists, i.e. after the base commit) and
// returns what the worker's report claims.
function attempt(opts) {
  var repo = makeRepo();
  var t = executor.createTask({
    project: 'mo-target', stage: 'MO', instruction: 'x', provider: 'mock', report_to_git: false,
    working_directory: repo.dir, branch: null, base_commit: repo.base,
    expected_delivery: opts.delivery || 'commit',
    required_tests: opts.checks === undefined ? [GOOD_CHECK] : opts.checks,
    model: opts.model || undefined, fallback_model: opts.fallback || undefined,
    scope: opts.scope || []
  });
  var claim = opts.work ? opts.work(repo) : {};
  var report = Object.assign({ mythos_report: true, status: 'completed', summary: 'done', tests: [], commit: null }, claim);
  var entry = { kind: 'success', report: report };
  if (Object.prototype.hasOwnProperty.call(opts, 'serving')) entry.serving = opts.serving;
  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([entry]);
  mockProvider.reset();
  return executor.runTask(t.task_id).then(function (st) {
    var rep = state.readJSON(t.task_id, 'report.json');
    return { st: st, rep: rep, task: state.readJSON(t.task_id, 'task.json'), repo: repo,
      codes: (rep && rep.measured ? rep.measured.contradictions : []).map(function (c) { return c.code; }) };
  });
}

var chain = Promise.resolve();
function step(fn) { chain = chain.then(fn); }

// --- pure rules -----------------------------------------------------------------
step(function () {
  ok(measured.admitsFailure('Failed to create the necessary directory structure due to persistent refusal to create the parent directory. The task cannot be completed as specified.') !== null,
    'B-unit: the #542 summary is an admission of failure');
  ok(measured.admitsFailure('The task could not be completed.') !== null, 'B-unit: "could not be completed" is an admission');
  ok(measured.admitsFailure('Created e2e/LIVE.md with the marker line; the check passes.') === null, 'B-unit: a plain success summary is not an admission');
  ok(measured.admitsFailure('Fixed the bug where uploads failed to complete on retry.') === null, 'B-unit: a fixed defect ("the bug where … failed to complete") is not an admission');
  ok(measured.servingModelFromParsed({ modelUsage: { 'claude-haiku-4-5': { outputTokens: 40 }, 'claude-fable-5-1': { outputTokens: 900 } } }) === 'claude-fable-5-1',
    'M-unit: the serving model is the one that produced the most output (a helper call never outweighs the session)');
  ok(measured.servingModelFromParsed({}) === null && measured.servingModelFromParsed(null) === null, 'M-unit: no usage record → unmeasured (null), never a guess');
  ok(measured.sameModel('claude-fable-5-1', 'claude-fable-5-1[1m]') && measured.sameModel('claude-fable-5-1', 'claude-fable-5-1-20260901') && !measured.sameModel('claude-fable-5-1', 'claude-fable-5'),
    'M-unit: model ids compare by base id (context/date suffix ignored; 5 ≠ 5.1)');
  ok(executor.requiredModelId({ model: 'fable-5.1' }) === 'claude-fable-5-1', 'M-unit: a raw catalog request (haddad-agent task) resolves to its model id');
  ok(executor.requiredModelId({ model: 'claude-sonnet-5', model_selection_mode: 'auto' }) === null, 'M-unit: an auto choice is not a requirement');
});

// --- H: the exact #542 outcome, judged by the executor's own measurement ------------
step(function () {
  var repo = makeRepo();
  var task = { task_id: 't-542-shape', expected_delivery: 'commit', working_directory: repo.dir, base_commit: repo.base, model: 'fable-5.1', provider: 'haddad-agent' };
  var report = { mythos_report: true, status: 'completed', commit: null,
    summary: 'Failed to create the necessary directory structure due to persistent refusal to create the parent directory. The task cannot be completed as specified.' };
  var outcome = { model_used: 'qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf',
    validation: { passed: true, attempts: 1, evidence: { changed: { created: [], modified: [], deleted: [] }, checks_run: [], mechanically_verified: false } } };
  var m = executor.measureOutcome(task, report, outcome, { is_error: false });
  var codes = m.verdict.contradictions.map(function (c) { return c.code; });
  ['REPORT_ADMITS_FAILURE', 'MODEL_IDENTITY', 'NO_VERIFIED_COMMIT', 'NO_MEASURED_CHANGE', 'NOT_MECHANICALLY_VERIFIED'].forEach(function (c) {
    ok(codes.indexOf(c) !== -1, 'H: the #542 shape is contradicted by ' + c);
  });
  ok(m.verdict.identity.requested_model === 'claude-fable-5-1' && m.verdict.identity.serving_model === 'qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf' && m.verdict.identity.match === false,
    'H: identity records requested Fable 5.1 vs serving Qwen — never relabelled');
  ok(executor.settleState(report, null, null, m.verdict.contradictions).state === 'BLOCKED', 'H: settleState turns the contradictions into BLOCKED, not COMPLETED');
  ok(executor.settleState(report, null, null, []).state === 'COMPLETED', 'H: with nothing contradicted, the same report would complete (the rule is the evidence, not the text)');
});

// --- A..J through the real executor --------------------------------------------------
step(function () {
  return attempt({ work: function () { return { summary: 'Done.' }; } }).then(function (r) {
    ok(r.st.status === 'BLOCKED' && r.codes.indexOf('NO_VERIFIED_COMMIT') !== -1 && r.codes.indexOf('NO_MEASURED_CHANGE') !== -1,
      'A: "completed" with nothing created → BLOCKED (NO_VERIFIED_COMMIT, NO_MEASURED_CHANGE)');
    ok(r.rep.blocker && r.rep.blocker.code === 'EVIDENCE_CONTRADICTION' && r.rep.blocker.retryable === false, 'A: blocker EVIDENCE_CONTRADICTION, not retried automatically');
  });
});
step(function () {
  return attempt({ delivery: 'report', checks: [], work: function () { return { summary: 'The file could not be created because the parent directory does not exist. The task cannot be completed as specified.' }; } }).then(function (r) {
    ok(r.st.status === 'BLOCKED' && r.codes.indexOf('REPORT_ADMITS_FAILURE') !== -1, 'B: status "completed" + a summary admitting failure → BLOCKED even on a report task');
  });
});
step(function () {
  return attempt({ work: function (repo) { return { summary: 'Nothing needed changing.', commit: repo.base }; } }).then(function (r) {
    ok(r.st.status === 'BLOCKED' && r.codes.indexOf('NO_MEASURED_CHANGE') !== -1, 'C: zero changed files on a change task (commit = base) → BLOCKED (NO_MEASURED_CHANGE)');
    ok(r.codes.indexOf('NO_VERIFIED_COMMIT') !== -1, 'C: the base commit is not the task\'s own commit (NO_VERIFIED_COMMIT)');
  });
});
step(function () {
  return attempt({ work: function (repo) {
    writeArtifact(repo.dir, 'LIVE.md', '# Live\nmarker: LIVE-OK-1\n', true);
    return { summary: 'Created e2e/LIVE.md.', files_changed: ['e2e/LIVE.md'], commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' };
  } }).then(function (r) {
    ok(r.st.status === 'BLOCKED' && r.codes.length === 1 && r.codes[0] === 'NO_VERIFIED_COMMIT',
      'G2: the real change is committed but the report names an invented commit → BLOCKED (NO_VERIFIED_COMMIT) — the report must agree with git');
  });
});
step(function () {
  return attempt({ checks: ['The file exists with the marker text.'], work: function (repo) {
    return { summary: 'Created e2e/LIVE.md.', files_changed: ['e2e/LIVE.md'], commit: writeArtifact(repo.dir, 'LIVE.md', '# Live\nmarker: LIVE-OK-1\n', true) };
  } }).then(function (r) {
    ok(r.st.status === 'BLOCKED' && r.codes.indexOf('NOT_MECHANICALLY_VERIFIED') !== -1, 'D: a change task whose checks are all prose (zero runnable) → BLOCKED');
    ok(r.rep.measured.checks && r.rep.measured.checks.mechanically_verified === false, 'D: the report records mechanically_verified:false');
  });
});
step(function () {
  return attempt({ work: function (repo) {
    return { summary: 'Created the file.', files_changed: ['e2e/OTHER.md'], commit: writeArtifact(repo.dir, 'OTHER.md', '# Live\nmarker: LIVE-OK-1\n', true) };
  } }).then(function (r) {
    ok(r.st.status === 'BLOCKED' && r.codes.indexOf('CHECK_FAILED') !== -1, 'E: expected artifact missing (the check the executor ran fails) → BLOCKED');
    ok(/missing e2e\/LIVE\.md/.test(r.rep.measured.checks.checks_run[0].output), 'E: the failing check output is the measured evidence');
  });
});
step(function () {
  return attempt({ work: function (repo) {
    return { summary: 'Created e2e/LIVE.md.', files_changed: ['e2e/LIVE.md'], commit: writeArtifact(repo.dir, 'LIVE.md', '# Live\nmarker: SOMETHING-ELSE\n', true) };
  } }).then(function (r) {
    ok(r.st.status === 'BLOCKED' && r.codes.indexOf('CHECK_FAILED') !== -1, 'F: expected marker missing → BLOCKED');
  });
});
step(function () {
  return attempt({ work: function (repo) {
    writeArtifact(repo.dir, 'LIVE.md', '# Live\nmarker: LIVE-OK-1\n', false);
    return { summary: 'Created e2e/LIVE.md.', files_changed: ['e2e/LIVE.md'], commit: null };
  } }).then(function (r) {
    ok(r.st.status === 'BLOCKED' && r.codes.indexOf('NO_VERIFIED_COMMIT') !== -1 && r.codes.indexOf('NO_MEASURED_CHANGE') !== -1,
      'G: the right file on disk but never committed → BLOCKED (a worktree file is not a delivery)');
  });
});
step(function () {
  return attempt({ work: function (repo) {
    return { summary: 'Created e2e/LIVE.md and e2e/EXTRA.md.', files_changed: ['e2e/LIVE.md', 'e2e/EXTRA.md'], commit: writeArtifact(repo.dir, 'LIVE.md', '# Live\nmarker: LIVE-OK-1\n', true) };
  } }).then(function (r) {
    ok(r.st.status === 'BLOCKED' && r.codes.indexOf('CLAIM_NOT_MEASURED') !== -1 && r.codes.length === 1,
      'I: the report claims a file git does not show → BLOCKED (CLAIM_NOT_MEASURED), everything else measured fine');
  });
});
step(function () {
  return attempt({ model: 'fable-5.1', work: function (repo) {
    return { summary: 'Created e2e/LIVE.md with the marker line.', files_changed: ['e2e/LIVE.md'], commit: writeArtifact(repo.dir, 'LIVE.md', '# Live\nmarker: LIVE-OK-1\n', true) };
  } }).then(function (r) {
    ok(r.st.status === 'COMPLETED' && r.codes.length === 0, 'J: artifact + marker + passing check + real commit → COMPLETED');
    var mz = r.rep.measured;
    ok(mz.changed_files.length === 1 && mz.changed_files[0] === 'e2e/LIVE.md' && mz.commit_on_task_branch === true && mz.checks.checks_run[0].passed === true && mz.checks.runner === 'executor',
      'J: the report carries what was measured: changed files, verified commit, the executor-run check');
    ok(mz.identity.requested_model === 'claude-fable-5-1' && mz.identity.serving_model === 'claude-fable-5-1' && mz.identity.match === true && r.st.model_used === 'claude-fable-5-1',
      'J: requested = serving = claude-fable-5-1, and model_used is the MEASURED model');
  });
});

step(function () {
  return attempt({ scope: ['e2e/LIVE.md', 'nothing else'], work: function (repo) {
    writeArtifact(repo.dir, 'STRAY.md', 'x\n', true);
    return { summary: 'Created e2e/LIVE.md and e2e/STRAY.md.', files_changed: ['e2e/LIVE.md', 'e2e/STRAY.md'], commit: writeArtifact(repo.dir, 'LIVE.md', '# Live\nmarker: LIVE-OK-1\n', true) };
  } }).then(function (r) {
    ok(r.st.status === 'BLOCKED' && r.codes.indexOf('OUT_OF_SCOPE') !== -1 && /e2e\/STRAY\.md/.test(JSON.stringify(r.rep.measured.contradictions)),
      'K: a change outside the declared Scope (e2e/STRAY.md, scope e2e/LIVE.md) → BLOCKED (OUT_OF_SCOPE); prose scope entries enforce nothing');
  });
});
step(function () {
  return attempt({ scope: ['e2e/LIVE.md'], work: goodWork }).then(function (r) {
    ok(r.st.status === 'COMPLETED' && r.codes.length === 0, 'K: the same task changing only its declared Scope → COMPLETED');
  });
});

// --- M: model identity -----------------------------------------------------------
function goodWork(repo) {
  return { summary: 'Created e2e/LIVE.md.', files_changed: ['e2e/LIVE.md'], commit: writeArtifact(repo.dir, 'LIVE.md', '# Live\nmarker: LIVE-OK-1\n', true) };
}
step(function () {
  return attempt({ model: 'fable-5.1', serving: 'claude-sonnet-5', work: goodWork }).then(function (r) {
    ok(r.st.status === 'BLOCKED' && r.rep.blocker.code === 'MODEL_IDENTITY_MISMATCH' && r.st.model_used === 'claude-sonnet-5' && r.st.model_requested === 'claude-fable-5-1',
      'M: Fable 5.1 requested, Sonnet 5 answered → BLOCKED MODEL_IDENTITY_MISMATCH; recorded as Sonnet, never as Fable');
  });
});
step(function () {
  return attempt({ model: 'fable-5.1', serving: null, work: goodWork }).then(function (r) {
    ok(r.st.status === 'BLOCKED' && r.codes.indexOf('MODEL_IDENTITY') !== -1 && r.st.model_used === null,
      'M: a required model whose answer was not measured → BLOCKED; model_used stays null (unmeasured is not "fable")');
  });
});
step(function () {
  return attempt({ model: 'fable-5.1', fallback: 'claude-sonnet-5', serving: 'claude-sonnet-5', work: goodWork }).then(function (r) {
    ok(r.st.status === 'COMPLETED' && r.rep.measured.identity.fallback_used === true && r.st.model_used === 'claude-sonnet-5',
      'M: a fallback the task itself permitted → COMPLETED, recorded as the fallback model, never as the requested one');
  });
});
step(function () {
  return attempt({ serving: 'claude-haiku-4-5', work: goodWork }).then(function (r) {
    ok(r.st.status === 'COMPLETED' && r.rep.measured.identity.requested_model === null && r.st.model_used === 'claude-haiku-4-5',
      'M: an auto-selected model is recorded as measured and not enforced (the task named none)');
  });
});

// --- S: the check runs with none of the executor's secrets ---------------------------
step(function () {
  var saved = { t: process.env.MYTHOS_EXECUTOR_TOKEN, s: process.env.SSH_AUTH_SOCK, a: process.env.ANTHROPIC_API_KEY };
  process.env.MYTHOS_EXECUTOR_TOKEN = 'executor-bearer-should-not-leak';
  process.env.SSH_AUTH_SOCK = '/run/fake-agent.sock';
  process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
  var dir = makeRepo().dir;
  fs.writeFileSync(path.join(dir, 'envcheck.js'),
    'var bad = Object.keys(process.env).filter(function (k) { return /TOKEN|SECRET|KEY|SSH_AUTH_SOCK|PASSW|COOKIE/i.test(k); });\n' +
    'if (bad.length) { console.error("leaked: " + bad.join(",")); process.exit(1); }\nconsole.log("clean");\n');
  ['MYTHOS_EXECUTOR_TOKEN', 'SSH_AUTH_SOCK', 'ANTHROPIC_API_KEY'].forEach(function (k) { ok(!(k in measured.checkEnv(process.env)), 'S: checkEnv drops ' + k); });
  return measured.runDeclaredChecks(dir, ['node envcheck.js']).then(function (ev) {
    if (saved.t === undefined) delete process.env.MYTHOS_EXECUTOR_TOKEN; else process.env.MYTHOS_EXECUTOR_TOKEN = saved.t;
    if (saved.s === undefined) delete process.env.SSH_AUTH_SOCK; else process.env.SSH_AUTH_SOCK = saved.s;
    if (saved.a === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.a;
    ok(ev.checks_run.length === 1 && ev.checks_run[0].passed === true && /clean/.test(ev.checks_run[0].output),
      'S: a declared check runs with no token, key or SSH agent in its environment (allow-list)');
  });
});
step(function () {
  var dir = makeRepo().dir;
  fs.writeFileSync(path.join(dir, 'slow.js'), 'setTimeout(function () {}, 60000);\n');
  var ticks = 0;
  var iv = setInterval(function () { ticks++; }, 20);
  var t0 = Date.now();
  return measured.runDeclaredChecks(dir, ['node slow.js'], { timeoutMs: 400 }).then(function (ev) {
    clearInterval(iv);
    ok(ev.checks_run[0].passed === false && /timed out/.test(ev.checks_run[0].error) && Date.now() - t0 < 5000, 'S: a check that hangs is killed at its timeout and fails (never assumed fine)');
    ok(ticks >= 5, 'S: the event loop keeps running while a check runs (async — the daemon is never blocked; ' + ticks + ' ticks)');
  });
});
step(function () {
  var o = { validation: { passed: true, evidence: {} } };
  ok(executor.reputationOutcome(o, [{ code: 'NO_MEASURED_CHANGE' }]).validation.passed === false && o.validation.passed === true && executor.reputationOutcome(o, []) === o,
    'R2: a completion the measured state contradicts is learned as a FAIL by reputation, whatever the provider\'s validator said');
});

// --- P: haddad-agent sends and records its runtime model ------------------------------
step(function () {
  var agent = require(path.join(EXEC, 'providers', 'haddad-agent.js'));
  var ws = path.join(FIXTURES, 'haddad-ws');
  fs.mkdirSync(ws, { recursive: true });
  var sent = [];
  var transport = function (o, body) {
    sent.push(JSON.parse(body));
    return Promise.resolve({ status: 200, body: JSON.stringify({ choices: [{ message: { role: 'assistant',
      content: '```json\n{"mythos_report":true,"status":"completed","summary":"read only","files_changed":[],"tests":[],"commit":null}\n```' } }] }) });
  };
  var saved = process.env.HADDAD_AGENT_MODEL;
  process.env.HADDAD_AGENT_MODEL = 'qwen-local-runtime.gguf';
  return agent.run({ task_id: 't-p', working_directory: ws, execution_profile: 'repo-read', timeout_seconds: 60, model: 'fable-5.1', required_tests: [], constraints: [] },
    'Say what you see.', null, 'start', { apiKey: 'k', transport: transport }).then(function (o) {
    if (saved === undefined) delete process.env.HADDAD_AGENT_MODEL; else process.env.HADDAD_AGENT_MODEL = saved;
    ok(sent.length > 0 && sent.every(function (b) { return b.model === 'qwen-local-runtime.gguf'; }), 'P: haddad-agent sends its runtime model, never task.model ("fable-5.1")');
    ok(o.model_used === 'qwen-local-runtime.gguf', 'P: haddad-agent reports model_used = the runtime model that answered');
  });
});

// --- R: a Haddad bridge instance refuses a named Claude model --------------------------
step(function () {
  var probe = [
    'var b = require(' + JSON.stringify(path.join(EXEC, 'bridge', 'github-bridge.js')) + ');',
    'var task = { task_id: "gh-issue-9001", requested_action: "document", model: "fable-5.1", model_raw: "Fable 5.1", model_source: "explicit_current_issue" };',
    'var none = { task_id: "gh-issue-9002", requested_action: "document" };',
    'console.log(JSON.stringify({ named: b.preflight({}, task, null, null), unnamed: b.preflight({}, none, null, null) }));'
  ].join('\n');
  function run(env) {
    var e = Object.assign({}, process.env, env);
    return JSON.parse(cp.execFileSync(process.execPath, ['-e', probe], { env: e, encoding: 'utf8' }).trim().split('\n').pop());
  }
  var haddad = run({ MYTHOS_BRIDGE_EXEC_PROVIDER: 'haddad-agent', MYTHOS_BRIDGE_PROVIDER: '', MYTHOS_BRIDGE_WORKER_PROVIDER: '' });
  ok(haddad.named && haddad.named.code === 'MODEL_UNAVAILABLE' && /NOT replaced/.test(haddad.named.reason) && haddad.named.provider === 'haddad-agent',
    'R: on an exec-worker (Haddad) instance "Model: Fable 5.1" is MODEL_UNAVAILABLE before any run — never served by the local model');
  ok(haddad.unnamed === null, 'R: a Haddad task that names no model is unaffected');
  var vps = run({ MYTHOS_BRIDGE_EXEC_PROVIDER: '', MYTHOS_BRIDGE_PROVIDER: '', MYTHOS_BRIDGE_WORKER_PROVIDER: '' });
  ok(vps.named === null, 'R: the VPS (Claude) instance still accepts Fable 5.1 by name');
});

// --- the E2E acceptance check script ---------------------------------------------
step(function () {
  var af = require(path.join(BASE, 'scripts', 'mythos-assert-file.js'));
  var dir = makeRepo().dir;
  fs.writeFileSync(path.join(dir, 'e2e', 'M.md'), '# M\nmarker: TOKEN-1\n');
  ok(af.check('e2e/M.md', 'TOKEN-1', dir).ok === true, 'assert-file: an existing file with the token passes');
  ok(af.check('e2e/M.md', 'TOKEN-2', dir).ok === false && af.check('e2e/NONE.md', 'TOKEN-1', dir).ok === false &&
    af.check('e2e', 'x', dir).ok === false && af.check('../x', 'x', dir).ok === false && af.check('/etc/passwd', 'root', dir).ok === false,
    'assert-file: wrong token, missing file, a directory, .. and absolute paths all fail');
  return measured.runDeclaredChecks(dir, ['node ' + path.join(BASE, 'scripts', 'mythos-assert-file.js') + ' e2e/M.md TOKEN-1']).then(function (ev) {
    ok(ev.mechanically_verified === true && ev.checks_run[0].passed === true, 'assert-file: runs through the executor check grammar and passes');
  });
});

chain.then(function () {
  delete executor.PROJECTS['mo-target'];
  try { fs.rmSync(FIXTURES, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  console.log('\nmeasured-outcome tests: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.error('Failures:\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
}, function (e) {
  console.error('suite crashed: ' + (e && e.stack || e));
  process.exit(1);
});
