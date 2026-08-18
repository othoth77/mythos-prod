'use strict';
// =====================================================
// MYTHOS — Stage MYTHOS-AI-EXECUTOR-0 tests
// tests/mythos-ai-executor-test.js
//
// Deterministic and offline. No real provider is ever launched and no
// real AI quota is consumed (mission §21): provider behaviour — success,
// quota exhaustion, transient errors, blocked credentials, malformed
// reports, missing sessions — is exercised through providers/mock.js,
// and Git behaviour against throwaway repositories created per test.
//
// Fixtures cannot live under /tmp: the task schema refuses a /tmp
// working directory outright (same rule as the orchestrator), so the
// fixture root lives under the home directory and is removed at the end.
//
// Run with: node tests/mythos-ai-executor-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

// Fixture root: persistent-capable filesystem, never /tmp.
var FIXTURES = path.join(os.homedir(), 'mythos-ai-executor-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
delete process.env.MYTHOS_MOCK_SCRIPT;

var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var quota = require(path.join(EXEC, 'lib', 'quota'));
var policy = require(path.join(EXEC, 'lib', 'policy'));
var reporting = require(path.join(EXEC, 'lib', 'report'));
var claudeProvider = require(path.join(EXEC, 'providers', 'claude-code'));
var mockProvider = require(path.join(EXEC, 'providers', 'mock'));
var server = require(path.join(EXEC, 'server'));

var passed = 0;
var failed = 0;
var failures = [];

function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

function throws(fn, re, name) {
  try { fn(); ok(false, name + ' (did not throw)'); }
  catch (e) { ok(re.test(e.message), name + ' (threw: ' + e.message.slice(0, 80) + ')'); }
}

function mkTask(overrides) {
  var input = {
    project: 'executor-selftest',
    stage: 'TEST',
    instruction: 'test instruction',
    provider: 'mock',
    report_to_git: false
  };
  Object.keys(overrides || {}).forEach(function (k) { input[k] = overrides[k]; });
  return executor.createTask(input);
}

function setScript(entries) {
  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify(entries);
  mockProvider.reset();
}

function makeThrowawayRepo(name) {
  var dir = path.join(FIXTURES, name);
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  cp.execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  cp.execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: dir });
  cp.execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), name + '\n');
  cp.execFileSync('git', ['add', '.'], { cwd: dir });
  cp.execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function eventsOf(taskId) {
  var text = state.readText(taskId, 'events.log') || '';
  return text.trim().split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
}

// ---------------------------------------------------------------------------
// 1. Store safety
// ---------------------------------------------------------------------------
(function () {
  ok(!state.isValidTaskId('../escape'), 'store: rejects traversal id');
  ok(!state.isValidTaskId('UPPER-CASE-ID'), 'store: rejects uppercase id');
  ok(state.isValidTaskId('t-20260816-abc123'), 'store: accepts valid slug');
  throws(function () { state.taskDir('../../etc'); }, /INVALID_TASK_ID/, 'store: taskDir refuses traversal');
  throws(function () { state.taskFile('t-20260816-abc123', '../task.json'); }, /INVALID_TASK_FILENAME/, 'store: taskFile refuses separator');

  // The production store never defaults to /tmp.
  var saved = process.env.MYTHOS_EXECUTOR_HOME;
  delete process.env.MYTHOS_EXECUTOR_HOME;
  ok(state.root().indexOf('/tmp') !== 0, 'store: production root is not under /tmp');
  process.env.MYTHOS_EXECUTOR_HOME = saved;
})();

// ---------------------------------------------------------------------------
// 2. Quota classification and scheduling
// ---------------------------------------------------------------------------
(function () {
  ok(quota.classifyFailure('Claude AI usage limit reached|1935689600') === 'quota', 'quota: pipe-epoch message classified');
  ok(quota.classifyFailure('5-hour limit reached ∙ resets 3am') === 'quota', 'quota: 5-hour message classified');
  // Live-observed shape (api_error_status 429) from the first real
  // orchestration mission — was misclassified fatal before the fix.
  ok(quota.classifyFailure("You've hit your session limit · resets 9:20pm (UTC)") === 'quota',
    'quota: live 429 session-limit message classified');
  ok(quota.parseResetTime("You've hit your session limit · resets 9:20pm (UTC)", Date.parse('2026-08-16T20:00:00Z')) !== null,
    'quota: live session-limit reset time parsed');
  ok(quota.classifyFailure('API Error: 529 overloaded_error') === 'transient', 'quota: overloaded is transient');
  ok(quota.classifyFailure('ECONNRESET while fetching') === 'transient', 'quota: network error is transient');
  ok(quota.classifyFailure('Credit balance is too low') === 'blocked', 'quota: billing is blocked');
  ok(quota.classifyFailure('please run /login') === 'blocked', 'quota: auth is blocked');
  ok(quota.classifyFailure('segfault in module') === 'fatal', 'quota: unknown is fatal');
  // Precedence: a quota message containing "rate limit" is still quota.
  ok(quota.classifyFailure('usage limit reached due to rate limit') === 'quota', 'quota: quota wins over transient');

  var now = Date.parse('2026-08-16T12:00:00Z');
  ok(quota.parseResetTime('limit reached|1935689600') === 1935689600000, 'quota: parses epoch after pipe');
  var clock = quota.parseResetTime('resets 3am', now);
  ok(clock > now && clock - now <= 24 * 3600 * 1000, 'quota: clock reset lands within 24h');
  ok(quota.parseResetTime('no time here') === null, 'quota: absent reset returns null');

  var resetAt = now + 3600 * 1000;
  ok(quota.quotaResumeAt(resetAt, 0, now) === resetAt + quota.RESET_GRACE_MS, 'quota: resume = reset + grace');
  ok(quota.quotaResumeAt(null, 0, now) === now + quota.QUOTA_BACKOFF_MS[0], 'quota: no reset → first backoff');
  ok(quota.quotaResumeAt(null, 99, now) === now + quota.QUOTA_BACKOFF_MS[quota.QUOTA_BACKOFF_MS.length - 1],
    'quota: backoff is capped, never unbounded');
  ok(quota.retryDelayMs(0) === 60000 && quota.retryDelayMs(2) === 16 * 60000, 'quota: retry backoff 1m/16m');
})();

// ---------------------------------------------------------------------------
// 3. Policy layer
// ---------------------------------------------------------------------------
(function () {
  Object.keys(policy.PROFILES).forEach(function (name) {
    var p = policy.PROFILES[name];
    var joined = p.disallowedTools.join(',');
    ok(/Bash\(sudo/.test(joined) || p.allowedTools.every(function (t) { return !/sudo/.test(t) || /nginx|systemctl/.test(t); }),
      'policy: ' + name + ' never grants open sudo');
  });
  throws(function () { policy.getProfile('deploy'); }, /PROFILE_DISABLED/, 'policy: deploy profile is disabled by default');
  throws(function () { policy.getProfile('nonsense'); }, /UNKNOWN_PROFILE/, 'policy: unknown profile refused');
  var args = policy.claudeArgsForProfile('repo-read').join(' ');
  ok(args.indexOf('Bash(sudo:*)') !== -1 && args.indexOf('--disallowedTools') !== -1, 'policy: repo-read disallows sudo');
  ok(args.indexOf('Write') === -1 || /disallowedTools[^-]*Write/.test(args), 'policy: repo-read does not allow Write');
  // repo-test: a testing task must be able to RUN tests, but nothing more.
  // Under repo-read it could only report "NOT RUN" (observed live), and
  // repo-write would hand a test runner needless write authority.
  var test = policy.claudeArgsForProfile('repo-test').join(' ');
  ok(/Bash\(node:\*\)/.test(test), 'policy: repo-test can execute node');
  ok(/Write/.test(test) && /Bash\(git commit/.test(test) && /Bash\(git push/.test(test),
    'policy: repo-test denies writing, committing and pushing');
  ok(/Bash\(sudo:\*\)/.test(test), 'policy: repo-test still denies sudo');
  ok(policy.PROFILES['repo-test'].commandClasses.join(',') === 'READ',
    'policy: repo-test claims only the READ class');

  var auto = policy.claudeArgsForProfile('autonomous').join(' ');
  ok(auto.indexOf('bypassPermissions') !== -1 && auto.indexOf('Bash(sudo:*)') !== -1,
    'policy: autonomous bypasses prompts but still disallows sudo');
})();

// ---------------------------------------------------------------------------
// 4. Claude provider argv (pure — nothing launched)
// ---------------------------------------------------------------------------
(function () {
  var task = { execution_profile: 'repo-write', model: 'claude-sonnet-5', fallback_model: null, max_turns: 40 };
  var start = claudeProvider.buildArgs(task, 'uuid-1234', 'start');
  ok(start[0] === '-p' && start.indexOf('--output-format') !== -1 && start.indexOf('json') !== -1,
    'claude: headless json output');
  ok(start.indexOf('--session-id') !== -1 && start[start.indexOf('--session-id') + 1] === 'uuid-1234',
    'claude: start pins session id');
  ok(start.indexOf('--resume') === -1, 'claude: start does not resume');
  var resume = claudeProvider.buildArgs(task, 'uuid-1234', 'resume');
  ok(resume.indexOf('--resume') !== -1 && resume[resume.indexOf('--resume') + 1] === 'uuid-1234',
    'claude: resume reuses the SAME session id');
  ok(resume.indexOf('--session-id') === -1, 'claude: resume does not pin a new session');
  ok(start.indexOf('--model') !== -1 && start.indexOf('--max-turns') !== -1, 'claude: model and max-turns pass through');
  ok(claudeProvider.executionAuthority === true, 'claude: has execution authority');
})();

// ---------------------------------------------------------------------------
// 5. Report extraction
// ---------------------------------------------------------------------------
(function () {
  var good = 'work done\n```json\n{"mythos_report": true, "status": "completed", "summary": "did it"}\n```';
  var r = reporting.extractReport(good);
  ok(r.report && r.report.status === 'completed', 'report: extracts fenced block');
  var two = good + '\n```json\n{"mythos_report": true, "status": "failed", "summary": "second"}\n```';
  ok(reporting.extractReport(two).report.status === 'failed', 'report: last block wins');
  ok(reporting.extractReport('no fence at all').report === null, 'report: absent → null with error');
  ok(reporting.extractReport('```json\n{"unrelated": 1}\n```').report === null, 'report: unrelated json ignored');
  var bare = '{"mythos_report": true, "status": "completed", "summary": "bare"}';
  ok(reporting.extractReport(bare).report.summary === 'bare', 'report: bare object accepted');
  ok(reporting.validateReport({ mythos_report: true }).length >= 2, 'report: validation flags missing fields');
})();

// ---------------------------------------------------------------------------
// 6. Task creation and refusals
// ---------------------------------------------------------------------------
(function () {
  var t = mkTask({});
  ok(state.readJSON(t.task_id, 'task.json').project === 'executor-selftest', 'create: task persisted');
  ok(state.readStatus(t.task_id).status === 'QUEUED', 'create: starts QUEUED');
  ok(t.execution_profile === 'repo-write', 'create: default execution profile');
  state.transition(t.task_id, 'CANCELLED', {});

  throws(function () { executor.createTask({ project: 'unregistered', instruction: 'x' }); },
    /UNKNOWN_PROJECT/, 'create: unregistered project refused');
  throws(function () { executor.createTask({ project: 'executor-selftest', instruction: '' }); },
    /INVALID_TASK|empty/, 'create: empty instruction refused');
  throws(function () { executor.createTask({ project: 'executor-selftest', instruction: 'x', provider: 'nope' }); },
    /UNKNOWN_PROVIDER/, 'create: unknown provider refused');
  throws(function () {
    executor.createTask({ project: 'executor-selftest', instruction: 'use ghp_' + 'a1b2c3d4e5f6a1b2c3d4'.slice(0, 20) });
  }, /TASK_CARRIES_SECRET/, 'create: secret-bearing task refused');
  throws(function () {
    executor.createTask({ project: 'executor-selftest', instruction: 'x', provider: 'mock', working_directory: '/tmp/evil' });
  }, /TASK_SCHEMA_INVALID/, 'create: /tmp working directory refused by schema');
  throws(function () {
    executor.createTask({ project: 'executor-selftest', instruction: 'x', execution_profile: 'deploy' });
  }, /PROFILE_DISABLED/, 'create: disabled deploy profile refused at intake');

  // Advisory providers never receive execution surface.
  var adv = executor.createTask({ project: 'executor-selftest', instruction: 'review this design', provider: 'openai-compat' });
  ok(adv.working_directory === null && adv.execution_profile === null,
    'create: advisory provider gets no working directory and no profile');
  state.transition(adv.task_id, 'CANCELLED', {});
})();

// ---------------------------------------------------------------------------
// 7. Illegal transitions refused
// ---------------------------------------------------------------------------
(function () {
  var t = mkTask({});
  throws(function () { state.transition(t.task_id, 'COMPLETED', {}); },
    /ILLEGAL_TRANSITION/, 'state: QUEUED cannot jump to COMPLETED');
  throws(function () { state.transition(t.task_id, 'NONSENSE', {}); },
    /UNKNOWN_STATUS/, 'state: unknown status refused');
  state.transition(t.task_id, 'CANCELLED', {});
  throws(function () { state.transition(t.task_id, 'RUNNING', {}); },
    /ILLEGAL_TRANSITION/, 'state: CANCELLED is terminal');
})();

var chain = Promise.resolve();

// ---------------------------------------------------------------------------
// 8. Normal successful task
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  setScript([{ kind: 'success', summary: 'normal path' }]);
  var t = mkTask({});
  return executor.runTask(t.task_id).then(function (st) {
    ok(st.status === 'COMPLETED', 'run: success → COMPLETED');
    var rep = state.readJSON(t.task_id, 'report.json');
    ok(rep && rep.report && rep.report.summary === 'normal path', 'run: report persisted');
    ok(state.readText(t.task_id, 'report.md').indexOf('normal path') !== -1, 'run: markdown report rendered');
    var cp1 = state.readJSON(t.task_id, 'checkpoint.json');
    ok(cp1 && cp1.current_step === 'done', 'run: final checkpoint written');
    ok(eventsOf(t.task_id).some(function (e) { return e.event === 'finished'; }), 'run: finished event logged');
  });
});

// ---------------------------------------------------------------------------
// 9. Quota exhaustion → WAITING_FOR_QUOTA → automatic resume, same session
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  var resetEpoch = Math.floor(Date.now() / 1000) + 3600;
  setScript([{ kind: 'quota', reset_epoch: resetEpoch }, { kind: 'success', summary: 'resumed fine' }]);
  var t = mkTask({ stage: 'QUOTA-FLOW' });
  var originalSession;
  return executor.runTask(t.task_id).then(function (st) {
    ok(st.status === 'WAITING_FOR_QUOTA', 'quota-flow: exhaustion is NOT a failure');
    ok(st.quota_state.waits === 1, 'quota-flow: wait counted');
    ok(st.quota_state.reset_at !== null, 'quota-flow: reset time captured from provider message');
    ok(Date.parse(st.quota_state.resume_after) > Date.parse(st.quota_state.reset_at),
      'quota-flow: resume scheduled after reset + grace');
    ok(st.claude_session_id, 'quota-flow: session id persisted');
    originalSession = st.claude_session_id;
    ok(eventsOf(t.task_id).some(function (e) { return e.event === 'quota_exhausted'; }), 'quota-flow: quota event logged');

    // Not due yet: the scheduler must NOT resume early.
    return executor.tick();
  }).then(function (actions) {
    ok(!actions.some(function (a) { return a.task_id === t.task_id && a.action === 'resume_quota'; }),
      'quota-flow: no premature resume before the window');
    // Reopen the window.
    var st = state.readStatus(t.task_id);
    st.quota_state.resume_after = new Date(Date.now() - 1000).toISOString();
    state.writeJSON(t.task_id, 'status.json', st);
    return executor.tick();
  }).then(function () {
    var st = state.readStatus(t.task_id);
    ok(st.status === 'COMPLETED', 'quota-flow: automatic resume completed the task');
    ok(st.claude_session_id === originalSession, 'quota-flow: the SAME session was resumed');
  });
});

// ---------------------------------------------------------------------------
// 10. Transient failure → bounded retry → success
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  setScript([{ kind: 'transient' }, { kind: 'success', summary: 'after retry' }]);
  var t = mkTask({ stage: 'RETRY-FLOW' });
  return executor.runTask(t.task_id).then(function (st) {
    ok(st.status === 'WAITING_RETRY', 'retry-flow: transient → WAITING_RETRY');
    ok(st.retry_count === 1, 'retry-flow: retry counted');
    ok(Date.parse(st.retry_at) > Date.now() + 50000, 'retry-flow: backoff is real (≈1m)');
    st.retry_at = new Date(Date.now() - 1000).toISOString();
    state.writeJSON(t.task_id, 'status.json', st);
    return executor.tick();
  }).then(function () {
    ok(state.readStatus(t.task_id).status === 'COMPLETED', 'retry-flow: retry succeeded');
  });
});

// ---------------------------------------------------------------------------
// 11. Retries exhausted → FAILED with preserved state
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  setScript([{ kind: 'transient' }]);
  var t = mkTask({ stage: 'EXHAUST', max_retries: 0 });
  return executor.runTask(t.task_id).then(function (st) {
    ok(st.status === 'FAILED', 'exhaust: retries beyond max_retries → FAILED');
    ok(/re-queue|inspect/.test(st.next_action), 'exhaust: resume information preserved');
    ok(state.readJSON(t.task_id, 'checkpoint.json') !== null, 'exhaust: checkpoint survives failure');
  });
});

// ---------------------------------------------------------------------------
// 12. Blocked (credential/human) and fatal failures
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  setScript([{ kind: 'blocked' }]);
  var t = mkTask({ stage: 'BLOCKED-FLOW' });
  return executor.runTask(t.task_id).then(function (st) {
    ok(st.status === 'BLOCKED', 'blocked: human blocker → BLOCKED, not FAILED');
    setScript([{ kind: 'fatal' }]);
    var t2 = mkTask({ stage: 'FATAL-FLOW', max_retries: 3 });
    return executor.runTask(t2.task_id).then(function (st2) {
      ok(st2.status === 'FAILED', 'fatal: permanent failure → FAILED without retry loop');
      ok(st2.retry_count === 0, 'fatal: fatal errors are not retried');
    });
  });
});

// ---------------------------------------------------------------------------
// 13. Malformed report → BLOCKED for review, never silently green
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  setScript([{ kind: 'malformed' }]);
  var t = mkTask({ stage: 'MALFORMED' });
  return executor.runTask(t.task_id).then(function (st) {
    ok(st.status === 'BLOCKED', 'malformed: missing report block → BLOCKED');
    ok(/no structured report/.test(st.next_action), 'malformed: next action explains why');
    var rep = state.readJSON(t.task_id, 'report.json');
    ok(rep.report === null && rep.problems.length > 0, 'malformed: problems recorded');
  });
});

// ---------------------------------------------------------------------------
// 14. Missing session on resume → single recreation with checkpoint context
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  setScript([{ kind: 'quota' }]);
  var t = mkTask({ stage: 'LOST-SESSION' });
  var lostSession;
  return executor.runTask(t.task_id).then(function (st) {
    ok(st.status === 'WAITING_FOR_QUOTA', 'lost-session: setup paused on quota');
    lostSession = st.claude_session_id;
    st.quota_state.resume_after = new Date(Date.now() - 1000).toISOString();
    state.writeJSON(t.task_id, 'status.json', st);
    setScript([{ kind: 'missing-session' }, { kind: 'success', summary: 'fresh session continued' }]);
    return executor.tick();
  }).then(function () {
    var st = state.readStatus(t.task_id);
    ok(st.status === 'COMPLETED', 'lost-session: recreated session completed the task');
    ok(st.claude_session_id !== lostSession, 'lost-session: a NEW session id was recorded');
    ok(eventsOf(t.task_id).some(function (e) { return e.event === 'session_recreated'; }),
      'lost-session: recreation is evented, not silent');
  });
});

// ---------------------------------------------------------------------------
// 15. Interrupted execution (dead pid) recovered by the scheduler
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  setScript([{ kind: 'success', summary: 'recovered run' }]);
  var t = mkTask({ stage: 'INTERRUPTED' });
  var st = state.transition(t.task_id, 'RUNNING', {
    execution_id: 'x-test', pid: 999999983, daemon_pid: 999999983,
    claude_session_id: 'mock-session-interrupted'
  });
  ok(state.effectiveStatus(st) === 'INTERRUPTED', 'interrupt: dead pid detected');
  return executor.tick().then(function () {
    var after = state.readStatus(t.task_id);
    ok(after.status === 'COMPLETED', 'interrupt: recovered and re-run to completion');
    ok(eventsOf(t.task_id).some(function (e) { return e.event === 'interrupted_recovered'; }),
      'interrupt: recovery evented');
  });
});

// ---------------------------------------------------------------------------
// 16. Priority ordering
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  setScript([{ kind: 'success' }]);
  var low = mkTask({ stage: 'PRIO-LOW', priority: 'low' });
  var high = mkTask({ stage: 'PRIO-HIGH', priority: 'high' });
  return executor.tick().then(function (actions) {
    var started = actions.filter(function (a) { return a.action === 'start'; })[0];
    ok(started && started.task_id === high.task_id, 'priority: high runs before low');
    state.transition(low.task_id, 'CANCELLED', {});
  });
});

// ---------------------------------------------------------------------------
// 17. Secret redaction in provider logs
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  setScript([{ kind: 'fatal', text: 'leaked ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstu123456 during run' }]);
  var t = mkTask({ stage: 'REDACT' });
  return executor.runTask(t.task_id).then(function () {
    var log = state.readText(t.task_id, 'stderr.log') || '';
    ok(log.indexOf('sk-ant-abcdefghijklmnop') === -1, 'redact: raw key never persisted');
    ok(log.indexOf('[REDACTED]') !== -1, 'redact: mask present in log');
    var st = state.readStatus(t.task_id);
    ok(JSON.stringify(st).indexOf('sk-ant-abcdefghijklmnop') === -1, 'redact: status carries no secret');
  });
});

// ---------------------------------------------------------------------------
// 18. Git verification against a throwaway repository
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  var repo = makeThrowawayRepo('verify-repo');
  var head = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  var task = { working_directory: repo, branch: null, expected_delivery: 'commit' };
  var good = executor.verifyGit(task, { commit: head });
  ok(good.git_verified === true, 'git: real commit verifies');
  var bad = executor.verifyGit(task, { commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' });
  ok(bad.git_verified === false && /does not exist/.test(bad.problem), 'git: invented commit refused');
  var none = executor.verifyGit(task, { commit: null });
  ok(none.git_verified === false && /claims none/.test(none.problem), 'git: commit-delivery without commit flagged');
});

// ---------------------------------------------------------------------------
// 19. Report delivery commits into the project repository
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  var repo = makeThrowawayRepo('report-repo');
  executor.PROJECTS['report-target'] = { repository: null, path: repo, default_branch: 'main' };
  setScript([{ kind: 'success', summary: 'report delivery test' }]);
  var t = executor.createTask({
    project: 'report-target', stage: 'DELIVERY', instruction: 'x', provider: 'mock',
    working_directory: repo, report_to_git: true
  });
  return executor.runTask(t.task_id).then(function (st) {
    ok(st.status === 'COMPLETED', 'delivery: task completed');
    var reportFile = path.join(repo, 'docs', 'AI_EXECUTION_REPORT.md');
    ok(fs.existsSync(reportFile), 'delivery: docs/AI_EXECUTION_REPORT.md written');
    var log = cp.execFileSync('git', ['log', '--oneline'], { cwd: repo, encoding: 'utf8' });
    ok(/report\(mythos-ai-executor\)/.test(log), 'delivery: report committed');
    // No remote exists, so push fails — recorded as a problem, never a crash.
    var ev = eventsOf(t.task_id).filter(function (e) { return e.event === 'finished'; })[0];
    ok(ev && ev.report_committed === false && /push|delivery/.test(ev.delivery_problem || ''),
      'delivery: push failure recorded honestly');
    delete executor.PROJECTS['report-target'];
  });
});

// ---------------------------------------------------------------------------
// 19b. SSH agent discovery for daemon-context pushes
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  var net = require('net');
  var fakeHome = path.join(FIXTURES, 'agent-home');
  var agentDir = path.join(fakeHome, '.ssh', 'agent');
  fs.mkdirSync(agentDir, { recursive: true });
  var sockPath = path.join(agentDir, 's.test.agent.abc');
  var srv = net.createServer();
  return new Promise(function (resolve) { srv.listen(sockPath, resolve); }).then(function () {
    var savedHome = process.env.HOME;
    var savedSock = process.env.SSH_AUTH_SOCK;
    process.env.HOME = fakeHome;

    function keyedOnly(target) { return function (sock) { return sock === target; }; }

    // No preset: discovery finds the agent-dir socket when it has keys.
    delete process.env.SSH_AUTH_SOCK;
    var env = executor.sshEnv(keyedOnly(sockPath));
    ok(env.SSH_AUTH_SOCK === sockPath, 'ssh: daemon discovers live keyed agent socket');

    // A preset socket WITH keys wins over discovery.
    process.env.SSH_AUTH_SOCK = 'preset-socket';
    var env2 = executor.sshEnv(keyedOnly('preset-socket'));
    ok(env2.SSH_AUTH_SOCK === 'preset-socket', 'ssh: keyed preset socket wins');

    // A preset socket WITHOUT keys (the gcr trap) falls through to the
    // discovered keyed socket instead of being trusted blindly.
    var env3 = executor.sshEnv(keyedOnly(sockPath));
    ok(env3.SSH_AUTH_SOCK === sockPath, 'ssh: keyless preset (gcr) is not trusted — keyed socket found');

    // No keyed socket anywhere: environment unchanged, failure stays honest.
    var env4 = executor.sshEnv(function () { return false; });
    ok(env4.SSH_AUTH_SOCK === 'preset-socket', 'ssh: no keyed agent → env unchanged');

    process.env.HOME = savedHome;
    if (savedSock === undefined) delete process.env.SSH_AUTH_SOCK;
    else process.env.SSH_AUTH_SOCK = savedSock;
    srv.close();
  });
});

// ---------------------------------------------------------------------------
// 20. Daemon lock refuses a second daemon
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  var first = executor.acquireDaemonLock();
  ok(first !== null, 'daemon: first lock acquired');
  ok(executor.acquireDaemonLock() === null, 'daemon: second daemon refused while first alive');
  fs.unlinkSync(first);
  ok(executor.acquireDaemonLock() !== null, 'daemon: stale lock recoverable');
  fs.unlinkSync(path.join(state.root(), 'daemon.lock'));
});

// ---------------------------------------------------------------------------
// 21. Persistence across restart (fresh read of everything from disk)
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  setScript([{ kind: 'quota' }]);
  var t = mkTask({ stage: 'PERSIST' });
  return executor.runTask(t.task_id).then(function () {
    // Simulate a restart: a brand-new node process reads the store.
    var script = 'var s = require(' + JSON.stringify(path.join(EXEC, 'lib', 'state')) + ');' +
      'var st = s.readStatus(' + JSON.stringify(t.task_id) + ');' +
      'console.log(JSON.stringify({status: st.status, session: st.claude_session_id, waits: st.quota_state.waits}));';
    var out = cp.execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: Object.assign({}, process.env)
    });
    var parsed = JSON.parse(out.trim());
    ok(parsed.status === 'WAITING_FOR_QUOTA', 'persist: state survives process restart');
    ok(!!parsed.session && parsed.waits === 1, 'persist: session and quota state survive restart');
  });
});

// ---------------------------------------------------------------------------
// 22. HTTP API: auth, intake, status, resume
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  process.env.MYTHOS_EXECUTOR_TOKEN = 'test-token-0123456789abcdef';
  var servers = server.start({ port: 8199, binds: ['127.0.0.1'] });

  function req(method, urlPath, body, token) {
    return new Promise(function (resolve, reject) {
      var payload = body ? JSON.stringify(body) : null;
      var r = http.request({
        host: '127.0.0.1', port: 8199, path: urlPath, method: method,
        headers: Object.assign(
          payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
          token ? { 'Authorization': 'Bearer ' + token } : {}
        )
      }, function (res) {
        var data = '';
        res.on('data', function (d) { data += d; });
        res.on('end', function () { resolve({ code: res.statusCode, body: JSON.parse(data || '{}') }); });
      });
      r.on('error', reject);
      if (payload) r.write(payload);
      r.end();
    });
  }

  return new Promise(function (resolve) { setTimeout(resolve, 200); }).then(function () {
    return req('GET', '/health', null, null);
  }).then(function (res) {
    ok(res.code === 200 || res.code === 503, 'http: /health needs no auth');
    ok(res.body.checks && res.body.checks.queue !== undefined, 'http: health reports queue counts');
    return req('POST', '/tasks', { project: 'executor-selftest', instruction: 'via http', provider: 'mock', report_to_git: false }, null);
  }).then(function (res) {
    ok(res.code === 401, 'http: intake without token refused');
    return req('POST', '/tasks', { project: 'executor-selftest', instruction: 'via http', provider: 'mock', report_to_git: false }, 'wrong-token');
  }).then(function (res) {
    ok(res.code === 401, 'http: wrong token refused');
    return req('POST', '/tasks', { project: 'executor-selftest', stage: 'HTTP', instruction: 'via http', provider: 'mock', report_to_git: false }, 'test-token-0123456789abcdef');
  }).then(function (res) {
    ok(res.code === 201 && /^t-/.test(res.body.task_id), 'http: authenticated intake accepted');
    var id = res.body.task_id;
    return req('GET', '/tasks/' + id, null, 'test-token-0123456789abcdef').then(function (res2) {
      ok(res2.code === 200 && res2.body.status.status === 'QUEUED', 'http: task status readable');
      return req('POST', '/tasks/' + id + '/cancel', null, 'test-token-0123456789abcdef');
    }).then(function (res3) {
      ok(res3.code === 200 && res3.body.status === 'CANCELLED', 'http: cancel works');
      return req('POST', '/tasks', { project: 'executor-selftest', instruction: 'x', provider: 'mock', execution_profile: 'deploy' }, 'test-token-0123456789abcdef');
    }).then(function (res4) {
      ok(res4.code === 400 && /PROFILE_DISABLED/.test(res4.body.error), 'http: disabled profile refused at the API');
      servers.forEach(function (s) { s.close(); });
      delete process.env.MYTHOS_EXECUTOR_TOKEN;
    });
  });
});

// ---------------------------------------------------------------------------
// MOS-3C: Dispatcher proof suite (regression pinning)
// ---------------------------------------------------------------------------
chain = chain.then(function () {
  // P10a: dispatchTask on nonexistent task rejects with NO_SUCH_TASK
  return executor.dispatchTask('t-00000000000000-zzzzzz').catch(function (e) {
    ok(/NO_SUCH_TASK/.test(e.message), 'MOS-3C P10a: dispatchTask rejects NO_SUCH_TASK');
  }).then(function () {
    // P10b: dispatchTask on RUNNING task rejects with NOT_DISPATCHABLE
    var task = executor.createTask({ requested_by: 'mos-console', project: 'executor-selftest', stage: 'MOS-3C-P10b', instruction: 'test', provider: 'mock' });
    state.transition(task.task_id, 'RUNNING', { pid: 99999 });
    return executor.dispatchTask(task.task_id).catch(function (e) {
      ok(/NOT_DISPATCHABLE/.test(e.message), 'MOS-3C P10b: dispatchTask rejects NOT_DISPATCHABLE for RUNNING');
    });
  }).then(function () {
    // P10c: createTask with unknown provider throws UNKNOWN_PROVIDER
    throws(function () { executor.createTask({ project: 'executor-selftest', instruction: 'x', provider: 'nope' }); }, /UNKNOWN_PROVIDER/, 'MOS-3C P10c: createTask rejects UNKNOWN_PROVIDER');
    // P10d: dispatcherStatus is callable
    ok(executor.dispatcherStatus().running >= 0, 'MOS-3C P10d: dispatcherStatus is callable');
  });
});

// ---------------------------------------------------------------------------
// MOS-3C: dispatcher concurrency ladder (P2-P9, P12) -- the proofs the
// mandate names. Every state below is asserted on disk via
// state.readStatus, never inferred from a return value alone. The
// wait-file mock kind holds each task genuinely RUNNING until this test
// releases it by creating <dir>/<task_id> (or fails it via .fail), so
// concurrency, queue overflow, auto-drain and failure isolation are all
// REAL, observed behaviour -- not parallel-looking bookkeeping.
// ---------------------------------------------------------------------------

var RELEASE_DIR = path.join(FIXTURES, 'mos3c-release');

// Bounded poll: resolves when fn() is truthy, fails the named assertion at
// timeout instead of hanging the suite forever.
function pollUntil(fn, timeoutMs, label) {
  var deadline = Date.now() + timeoutMs;
  return new Promise(function (resolve) {
    (function attempt() {
      var v;
      try { v = fn(); } catch (e) { v = false; }
      if (v) { ok(true, label); resolve(true); return; }
      if (Date.now() >= deadline) { ok(false, label + ' (timed out after ' + timeoutMs + 'ms)'); resolve(false); return; }
      setTimeout(attempt, 50);
    })();
  });
}

function release(taskId) { fs.writeFileSync(path.join(RELEASE_DIR, taskId), ''); }
function releaseFail(taskId) { fs.writeFileSync(path.join(RELEASE_DIR, taskId + '.fail'), ''); }
function statusOf(taskId) { return (state.readStatus(taskId) || {}).status; }

var L = {}; // ladder task ids, T1..T8

chain = chain.then(function () {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  setScript([{ kind: 'wait-file', dir: RELEASE_DIR }]); // last entry repeats: every run waits

  // Precondition: nothing effective-RUNNING from earlier fixtures. (P10b's
  // deliberately-orphaned RUNNING task has a dead pid, so it reads
  // INTERRUPTED, not RUNNING, and is correctly excluded here.)
  var st0 = executor.dispatcherStatus();
  ok(st0.running === 0, 'MOS-3C precondition: no effective-RUNNING tasks before the ladder (running=' + st0.running +
    (st0.running ? '; offenders: ' + executor.summaries().filter(function (s2) { return s2.effective === 'RUNNING'; }).map(function (s2) { return s2.task_id; }).join(',') : '') + ')');

  // P2: one mission dispatches and genuinely runs.
  L.t1 = mkTask({ stage: 'MOS-3C-T1', requested_by: 'mos-console' }).task_id;
  return executor.dispatchTask(L.t1).then(function (r) {
    ok(r.dispatched === true, 'MOS-3C P2: first dispatch admitted (dispatched:true)');
    ok(statusOf(L.t1) === 'RUNNING', 'MOS-3C P2: task 1 RUNNING on disk');
  });
});

chain = chain.then(function () {
  // P3: two concurrent.
  L.t2 = mkTask({ stage: 'MOS-3C-T2', requested_by: 'mos-console' }).task_id;
  return executor.dispatchTask(L.t2).then(function (r) {
    ok(r.dispatched === true, 'MOS-3C P3: second dispatch admitted');
    ok(statusOf(L.t1) === 'RUNNING' && statusOf(L.t2) === 'RUNNING',
      'MOS-3C P3: tasks 1 and 2 RUNNING simultaneously on disk');
  });
});

chain = chain.then(function () {
  // P4: five concurrent.
  L.t3 = mkTask({ stage: 'MOS-3C-T3', requested_by: 'mos-console' }).task_id;
  L.t4 = mkTask({ stage: 'MOS-3C-T4', requested_by: 'mos-console' }).task_id;
  L.t5 = mkTask({ stage: 'MOS-3C-T5', requested_by: 'mos-console' }).task_id;
  return executor.dispatchTask(L.t3).then(function () { return executor.dispatchTask(L.t4); })
    .then(function () { return executor.dispatchTask(L.t5); })
    .then(function () {
      var running = [L.t1, L.t2, L.t3, L.t4, L.t5].filter(function (id) { return statusOf(id) === 'RUNNING'; });
      ok(running.length === 5, 'MOS-3C P4: five tasks RUNNING simultaneously on disk (got ' + running.length + ')');
      ok(executor.dispatcherStatus().running === 5, 'MOS-3C P4: dispatcherStatus reports running=5');
    });
});

chain = chain.then(function () {
  // P5: the sixth queues instead of blowing past the ceiling.
  L.t6 = mkTask({ stage: 'MOS-3C-T6', requested_by: 'mos-console' }).task_id;
  return executor.dispatchTask(L.t6).then(function (r) {
    ok(r.dispatched === false && r.queued === true, 'MOS-3C P5: sixth dispatch deferred ({dispatched:false, queued:true})');
    ok(statusOf(L.t6) === 'QUEUED', 'MOS-3C P5: sixth task stays QUEUED on disk');
    ok(executor.dispatcherStatus().queued === 1, 'MOS-3C P5: dispatcherStatus reports queued=1');
    var events = fs.readFileSync(state.taskFile(L.t6, 'events.log'), 'utf8');
    ok(/dispatch_deferred/.test(events), 'MOS-3C P5: dispatch_deferred recorded in the sixth task\'s events.log');
  });
});

chain = chain.then(function () {
  // P6: completing one frees one slot. P7: the queued mission starts by
  // itself -- the drain, not this test, dispatches it.
  release(L.t1);
  return pollUntil(function () { return statusOf(L.t1) === 'COMPLETED'; }, 5000,
    'MOS-3C P6: released task 1 reaches COMPLETED')
    .then(function () {
      return pollUntil(function () { return statusOf(L.t6) === 'RUNNING'; }, 5000,
        'MOS-3C P7: queued sixth task auto-started by the drain (no manual dispatch)');
    })
    .then(function () {
      ok(executor.dispatcherStatus().queued === 0, 'MOS-3C P7: dispatcherStatus reports queued=0 after the drain');
    });
});

chain = chain.then(function () {
  // P8: one provider failure is isolated -- siblings keep running.
  releaseFail(L.t2);
  return pollUntil(function () { return statusOf(L.t2) === 'FAILED'; }, 5000,
    'MOS-3C P8: fail-released task 2 reaches FAILED')
    .then(function () {
      var stillRunning = [L.t3, L.t4, L.t5, L.t6].filter(function (id) { return statusOf(id) === 'RUNNING'; });
      ok(stillRunning.length === 4, 'MOS-3C P8: the other four tasks are still RUNNING after the failure (got ' + stillRunning.length + ')');
      release(L.t3); release(L.t4); release(L.t5); release(L.t6);
      return pollUntil(function () {
        return [L.t3, L.t4, L.t5, L.t6].every(function (id) { return statusOf(id) === 'COMPLETED'; });
      }, 5000, 'MOS-3C P8: remaining four all COMPLETED after release');
    })
    .then(function () {
      ok(executor.dispatcherStatus().running === 0, 'MOS-3C P8: capacity fully released (running=0)');
    });
});

chain = chain.then(function () {
  // P9a: a cancelled QUEUED mission is never resurrected by the drain.
  // Created only now, AFTER every P8 settle, so no in-flight drain can
  // race this test by starting it before it is cancelled.
  L.t7 = mkTask({ stage: 'MOS-3C-T7', requested_by: 'mos-console' }).task_id;
  state.transition(L.t7, 'CANCELLED', { pid: null, ended_at: new Date().toISOString(), next_action: 'cancelled by MOS-3C P9a' });
  executor.drainQueue();
  ok(statusOf(L.t7) === 'CANCELLED', 'MOS-3C P9a: cancelled QUEUED mission stays CANCELLED through an explicit drain');

  // P9b: cancelling a RUNNING mission wins over its later completion.
  // HAZARD, neutralised: the mock records the TEST PROCESS's own pid, so
  // the production cancel path's SIGTERM would hit this process -- a no-op
  // handler absorbs it, exactly as specified for this proof.
  var noop = function () {};
  process.on('SIGTERM', noop);
  L.t8 = mkTask({ stage: 'MOS-3C-T8', requested_by: 'mos-console' }).task_id;
  return executor.dispatchTask(L.t8).then(function () {
    ok(statusOf(L.t8) === 'RUNNING', 'MOS-3C P9b: task 8 RUNNING before cancellation');
    var st8 = state.readStatus(L.t8);
    if (st8.pid && state.processAlive(st8.pid)) {
      try { process.kill(st8.pid, 'SIGTERM'); } catch (e) { /* raced */ }
    }
    state.transition(L.t8, 'CANCELLED', { pid: null, ended_at: new Date().toISOString(), next_action: 'cancelled by MOS-3C P9b' });
    ok(statusOf(L.t8) === 'CANCELLED', 'MOS-3C P9b: RUNNING mission cancelled');
    // Release it anyway: the in-flight provider resolves, but the illegal
    // CANCELLED -> COMPLETED transition must refuse -- cancellation wins.
    release(L.t8);
    return new Promise(function (resolve) { setTimeout(resolve, 400); }).then(function () {
      ok(statusOf(L.t8) === 'CANCELLED', 'MOS-3C P9b: cancellation holds after the provider settles (no resurrection)');
      process.removeListener('SIGTERM', noop);
    });
  });
});

chain = chain.then(function () {
  // P9c: terminal states refuse cancellation -- the same guard the HTTP
  // handler answers 409 from.
  throws(function () { state.transition(L.t1, 'CANCELLED', {}); }, /ILLEGAL_TRANSITION/,
    'MOS-3C P9c: cancelling a COMPLETED mission refuses with ILLEGAL_TRANSITION');

  // P12: every result is associated with its own mission and no other.
  [L.t1, L.t3, L.t4, L.t5, L.t6].forEach(function (id) {
    var rep = state.readJSON(id, 'report.json');
    ok(rep && rep.report && rep.report.summary === 'released ' + id,
      'MOS-3C P12: report for ' + id + ' carries exactly its own release marker');
  });
  var rep1 = JSON.stringify(state.readJSON(L.t1, 'report.json'));
  ok(rep1.indexOf(L.t3) === -1, 'MOS-3C P12: task 1\'s report contains no trace of task 3 (cross-association check)');

  fs.rmSync(RELEASE_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
chain.then(function () {
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failures.length) {
    console.log('Failures:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  process.exit(0);
}).catch(function (err) {
  console.error('SUITE ERROR: ' + (err && err.stack || err));
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  process.exit(1);
});
