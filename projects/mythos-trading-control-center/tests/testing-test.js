'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — the Testing Center, tested
// projects/mythos-trading-control-center/tests/testing-test.js
//
// The Testing Center runs suites and reports them. What has to be true of it
// is that it NEVER HIDES A FAILURE — so most of this file feeds it suites that
// fail in every way a suite can, and checks each one is reported as what it is:
//
//   a failing test · a file that crashes on load · a file that never ends ·
//   a file that does not exist · a skipped test · a filter that matches nothing
//
// To do that without running the real suites inside themselves, the server is
// started with `testRoots` pointing at small fixture files written here. The
// last section uses the REAL roots, to check the catalogue against what is
// actually on disk and to run one real agent test through the real runner.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');

var h = require('./helpers');

var S, owner, operator, viewer, stateDir, fixtures;

var HEAD = "var test = require('node:test');\nvar assert = require('node:assert/strict');\n";
var FIXTURES = {
  agent: {
    'jev-test.js': HEAD +
      "test('a band is chosen', function () { assert.equal(1, 1); });\n" +
      "test('a threshold holds', function () { assert.equal(2, 2); });\n" +
      "test('needs a venue', { skip: 'no venue exists in this build' }, function () { assert.fail('must not run'); });\n",
    'risk-recovery-test.js': HEAD +
      "test('PROPERTY: the cap holds', function () { assert.ok(true); });\n" +
      "test('the recovery ladder stops at its cap', function () { assert.ok(true); });\n" +
      "test('the risk engine blocks an oversize request', function () { console.log('approved 0.50 lots'); assert.equal(0.5, 0.01, 'approved above the cap'); });\n"
  },
  cc: {
    'jev-test.js': HEAD + "test('the jev view reads the store', function () { assert.ok(true); });\n",
    'property-test.js': HEAD +
      "test('PROPERTY: limits are kept', function () { assert.ok(true); });\n" +
      "test('not a property and it fails', function () { assert.fail('this test is outside the filter'); });\n",
    'security-test.js': "throw new Error('this suite cannot even load');\n",
    'live-lock-test.js': HEAD + "test('never ends', function () { return new Promise(function () { setInterval(function () {}, 1000); }); });\n",
    // Passes only if the child process was given the isolated environment.
    'unit-test.js': HEAD + "var fs = require('fs');\nvar path = require('path');\n" +
      "test('the run has a throwaway HOME and no inherited secrets', function () {\n" +
      "  assert.equal(process.env.TCC_TEST_RUN, '1');\n" +
      "  assert.match(process.env.HOME, /tcc-test-home-/);\n" +
      "  assert.equal(process.env.TCC_SECRET_FOR_TEST, undefined);\n" +
      "  assert.equal(process.env.TCC_USERS_FILE, undefined);\n" +
      "  assert.equal(process.env.TCC_STATE_DIR, undefined);\n" +
      "  assert.equal(process.env.NODE_ENV, 'test');\n" +
      "  fs.writeFileSync(path.join(process.env.HOME, 'written-by-a-test'), 'x');\n" +
      "});\n"
  }
};

async function waitRun(runId, timeoutMs) {
  return h.waitFor(async function () {
    var r = await viewer.get('/api/testing/runs/' + runId);
    return r.body.result.status !== 'RUNNING' ? r.body.result : null;
  }, timeoutMs || 60000, 80);
}
async function run(body, timeoutMs) {
  var res = await operator.post('/api/testing/run', body);
  assert.equal(res.status, 202, JSON.stringify(res.body));
  return waitRun(res.body.result.run.runId, timeoutMs);
}
function fileOf(r, id) { return r.files.filter(function (f) { return f.id === id; })[0]; }

test.before(async function () {
  fixtures = h.tempDir('tcc-testing-fixtures-');
  Object.keys(FIXTURES).forEach(function (project) {
    fs.mkdirSync(path.join(fixtures, project));
    Object.keys(FIXTURES[project]).forEach(function (name) { fs.writeFileSync(path.join(fixtures, project, name), FIXTURES[project][name]); });
  });
  stateDir = h.tempDir('tcc-testing-state-');
  process.env.TCC_SECRET_FOR_TEST = 'must-not-reach-a-test-process';
  S = await h.startApp({ stateDir: stateDir, testRoots: { agent: path.join(fixtures, 'agent'), cc: path.join(fixtures, 'cc') }, testFileTimeoutMs: 2500 });
  owner = await S.login('owner');
  operator = await S.login('operator');
  viewer = await S.login('viewer');
});

test.after(async function () {
  delete process.env.TCC_SECRET_FOR_TEST;
  await S.close();
  [stateDir, fixtures].forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } });
});

// ---------------------------------------------------------------------------
// the catalogue
// ---------------------------------------------------------------------------

test('the catalogue lists the eleven categories, and a category whose file is missing says so', async function () {
  var v = (await viewer.get('/api/testing')).body.result;
  assert.deepEqual(v.categories.map(function (c) { return c.label; }),
    ['Unit', 'Integration', 'Property', 'Backtest', 'Paper', 'Risk', 'Recovery', 'Jev', 'Regression', 'E2E', 'Security']);
  var by = {};
  v.categories.forEach(function (c) { by[c.id] = c; });
  assert.equal(by.jev.testCount, 4);
  assert.deepEqual(by.jev.missingFiles, []);
  assert.equal(by.property.testCount, 2, 'a filtered category counts only the tests its filter selects');
  assert.ok(by.backtest.missingFiles.length >= 1, 'a category does not vanish when its files are absent');
  assert.equal(by.backtest.testCount, 0);
  Object.keys(v.latest).forEach(function (id) { assert.equal(v.latest[id], null, id + ' has never been run and must not show a result'); });
  assert.equal(v.active, null);
  assert.deepEqual(v.runs, []);
});

// ---------------------------------------------------------------------------
// who may run, and what may be asked for
// ---------------------------------------------------------------------------

test('a viewer cannot start or cancel a run, and a malformed request starts nothing', async function () {
  assert.equal((await viewer.post('/api/testing/run', { scope: 'all' })).status, 403);
  assert.equal((await viewer.post('/api/testing/cancel', {})).status, 403);
  var bad = [
    {}, { scope: 'everything' }, { scope: 'category' }, { scope: 'category', category: 'nonsense' }, { scope: 'test', file: 'cc:jev-test.js' },
    { scope: 'test', file: 'cc:../../etc/passwd-test.js', name: 'x' }, { scope: 'test', file: '/etc/passwd', name: 'x' },
    { scope: 'test', file: 'cc:nope-test.js', name: 'x' }, { scope: 'test', file: 'cc:jev-test.js', name: 'no such test' },
    { scope: 'all', args: ['--inspect'] }, { scope: 'category', category: 'jev', command: 'rm -rf /' }
  ];
  for (var body of bad) {
    var res = await operator.post('/api/testing/run', body);
    assert.equal(res.status, 400, JSON.stringify(body) + ' → ' + res.status + ' ' + JSON.stringify(res.body));
  }
  assert.deepEqual((await viewer.get('/api/testing')).body.result.runs, []);
  var none = await operator.post('/api/testing/cancel', {});
  assert.equal(none.status, 404);
  assert.equal(none.body.error.code, 'NO_TEST_RUN');
});

// ---------------------------------------------------------------------------
// what a run reports
// ---------------------------------------------------------------------------

test('a passing category is PASSED, and its skipped test is counted as skipped — not as passed', async function () {
  var r = await run({ scope: 'category', category: 'jev' });
  assert.equal(r.status, 'PASSED');
  assert.deepEqual([r.totals.passed, r.totals.failed, r.totals.skipped, r.totals.total], [3, 0, 1, 4]);
  var skipped = fileOf(r, 'agent:jev-test.js').tests.filter(function (t) { return t.status === 'skipped'; });
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].name, 'needs a venue');
  assert.match(skipped[0].skipReason, /no venue exists/);
  assert.ok(r.finishedAt && r.durationMs >= 0);
  assert.equal(r.actor.id, 'operator');
  assert.equal(r.commit, (await viewer.get('/api/status')).body.result.commit);
  var v = (await viewer.get('/api/testing')).body.result;
  assert.deepEqual([v.latest.jev.status, v.latest.jev.passed, v.latest.jev.skipped, v.latest.jev.failed], ['PASSED', 3, 1, 0]);
  assert.equal(v.latest.jev.runId, r.runId);
  assert.equal(v.latest.risk, null, 'a category that was not run still shows no result');
});

test('one failing test makes the run FAILED however many passed, and its output is kept', async function () {
  var r = await run({ scope: 'category', category: 'risk' });
  assert.equal(r.status, 'FAILED');
  var agentFile = fileOf(r, 'agent:risk-recovery-test.js');
  assert.deepEqual([agentFile.passed, agentFile.failed], [2, 1]);
  var failed = agentFile.tests.filter(function (t) { return t.status === 'failed'; })[0];
  assert.equal(failed.name, 'the risk engine blocks an oversize request');
  assert.match(failed.failure, /approved above the cap/);
  assert.match(agentFile.output, /approved 0\.50 lots/, 'what the file printed is kept beside its failure');
  // the category also names a Control Center file that does not exist in these fixtures
  var missing = fileOf(r, 'cc:risk-recovery-test.js');
  assert.equal(missing.status, 'FAILED');
  assert.equal(missing.problem, 'test file does not exist');
  assert.equal(r.totals.failed, 2, 'the missing file is a failure, not an omission');
  var v = (await viewer.get('/api/testing')).body.result;
  assert.equal(v.latest.risk.status, 'FAILED');
  var events = (await viewer.get('/api/activity?type=error')).body.result.items;
  assert.ok(events.some(function (e) { return /TEST_RUN_FAILED|test run/.test(e.message) && e.message.indexOf(r.runId) !== -1; }), 'a failed run is an error in the activity log');
});

test('a filtered category runs only the tests its filter selects', async function () {
  var r = await run({ scope: 'category', category: 'property' });
  var cc = fileOf(r, 'cc:property-test.js');
  assert.deepEqual(cc.tests.map(function (t) { return t.name; }), ['PROPERTY: limits are kept']);
  assert.equal(cc.pattern, 'PROPERTY');
  assert.deepEqual(fileOf(r, 'agent:risk-recovery-test.js').tests.map(function (t) { return t.name; }), ['PROPERTY: the cap holds']);
  assert.equal(r.status, 'PASSED', 'the failing test outside the filter was not run — and the filter is shown beside the result');
  assert.equal(r.totals.total, 2);
});

test('a file that crashes on load and a file that never ends are both failures, with the reason', async function () {
  var r = await run({ scope: 'category', category: 'security' }, 60000);
  assert.equal(r.status, 'FAILED');
  var crash = fileOf(r, 'cc:security-test.js');
  assert.equal(crash.status, 'FAILED');
  assert.ok(crash.failed >= 1);
  assert.match(crash.output, /this suite cannot even load/, 'the load error is reported, not swallowed');
  var hang = fileOf(r, 'cc:live-lock-test.js');
  assert.equal(hang.status, 'FAILED');
  assert.match(hang.problem, /exceeded 2\.5 s and was stopped/);
  assert.ok(hang.failed >= 1);
});

test('RUN TEST runs exactly the named test', async function () {
  var r = await run({ scope: 'test', file: 'agent:risk-recovery-test.js', name: 'the recovery ladder stops at its cap' });
  assert.equal(r.status, 'PASSED');
  assert.equal(r.totals.total, 1);
  assert.deepEqual(r.target, { file: 'agent:risk-recovery-test.js', name: 'the recovery ladder stops at its cap' });
  assert.equal(r.files[0].tests[0].name, 'the recovery ladder stops at its cap');
  // a name that is a prefix of nothing else, matched exactly: regex characters are data
  var failing = await run({ scope: 'test', file: 'agent:risk-recovery-test.js', name: 'the risk engine blocks an oversize request' });
  assert.equal(failing.status, 'FAILED');
  assert.equal(failing.totals.total, 1);
});

test('tests run with a throwaway HOME and none of the server\'s environment', async function () {
  var r = await run({ scope: 'test', file: 'cc:unit-test.js', name: 'the run has a throwaway HOME and no inherited secrets' });
  assert.equal(r.status, 'PASSED', JSON.stringify(r.files[0].tests));
  var left = fs.readdirSync(os.tmpdir()).filter(function (f) { return /^tcc-test-home-/.test(f); })
    .filter(function (f) { return fs.existsSync(path.join(os.tmpdir(), f, 'written-by-a-test')); });
  assert.deepEqual(left, [], 'the throwaway HOME is removed when the run ends');
});

// ---------------------------------------------------------------------------
// one at a time; cancel
// ---------------------------------------------------------------------------

test('one run at a time, and a cancelled run is CANCELLED — never PASSED', async function () {
  var first = await operator.post('/api/testing/run', { scope: 'category', category: 'security' });
  assert.equal(first.status, 202);
  var second = await operator.post('/api/testing/run', { scope: 'category', category: 'jev' });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'TEST_RUN_IN_PROGRESS');
  var v = (await viewer.get('/api/testing')).body.result;
  assert.equal(v.active.runId, first.body.result.run.runId);
  assert.equal(v.activeProgress.files, 2);
  assert.equal((await viewer.get('/api/status')).body.result.testRun, true);
  var cancelled = await operator.post('/api/testing/cancel', {});
  assert.equal(cancelled.status, 200);
  var r = await waitRun(first.body.result.run.runId);
  assert.equal(r.status, 'CANCELLED');
  assert.equal((await viewer.get('/api/testing')).body.result.active, null);
  var latest = (await viewer.get('/api/testing')).body.result.latest.security;
  assert.notEqual(latest.runId, r.runId, 'a cancelled run does not replace the last finished result');
});

// ---------------------------------------------------------------------------
// RUN ALL
// ---------------------------------------------------------------------------

test('RUN ALL runs every file of both projects and reports every failure it met', async function () {
  var r = await run({ scope: 'all' }, 90000);
  assert.equal(r.status, 'FAILED');
  var ids = r.files.map(function (f) { return f.id; });
  assert.deepEqual(ids, ['agent:jev-test.js', 'agent:risk-recovery-test.js', 'cc:jev-test.js', 'cc:live-lock-test.js', 'cc:property-test.js',
    'cc:security-test.js', 'cc:unit-test.js', 'cc:e2e-browser-test.js']);
  assert.equal(r.totals.files, 8);
  assert.equal(r.totals.filesDone, 8);
  assert.equal(fileOf(r, 'cc:e2e-browser-test.js').problem, 'test file does not exist');
  var failedFiles = r.files.filter(function (f) { return f.status === 'FAILED'; }).map(function (f) { return f.id; });
  assert.deepEqual(failedFiles, ['agent:risk-recovery-test.js', 'cc:live-lock-test.js', 'cc:property-test.js', 'cc:security-test.js', 'cc:e2e-browser-test.js']);
  assert.equal(r.totals.passed + r.totals.failed + r.totals.skipped, r.totals.total, 'every test is in exactly one column');
  var v = (await viewer.get('/api/testing')).body.result;
  // a filtered category reads its own tests out of the full run
  assert.deepEqual([v.latest.property.status, v.latest.property.passed, v.latest.property.failed], ['PASSED', 2, 0]);
  assert.equal(v.latest.regression.status, 'FAILED');
  assert.equal(v.latest.jev.runId, r.runId);
  assert.equal(v.latest.jev.skipped, 1);
});

// ---------------------------------------------------------------------------
// the record
// ---------------------------------------------------------------------------

test('every started run is audited, results survive a restart, and an interrupted run is not left RUNNING', async function () {
  var audit = (await owner.get('/api/audit?action=testing.run&limit=50')).body.result;
  var runs = (await viewer.get('/api/testing')).body.result.runs;
  assert.equal(audit.items.filter(function (e) { return e.outcome === 'ACCEPTED'; }).length, runs.length, 'one accepted audit entry per run');
  assert.ok(audit.items.some(function (e) { return e.outcome === 'REFUSED'; }), 'the refused second run is audited too');
  var started = await operator.post('/api/testing/run', { scope: 'category', category: 'security' });
  var interrupted = started.body.result.run.runId;
  await S.close();
  S = await h.startApp({ stateDir: stateDir, testRoots: { agent: path.join(fixtures, 'agent'), cc: path.join(fixtures, 'cc') }, testFileTimeoutMs: 2500 });
  owner = await S.login('owner');
  operator = await S.login('operator');
  viewer = await S.login('viewer');
  var v = (await viewer.get('/api/testing')).body.result;
  assert.equal(v.active, null);
  assert.equal(v.runs.length, runs.length + 1);
  var rec = (await viewer.get('/api/testing/runs/' + interrupted)).body.result;
  assert.equal(rec.status, 'CANCELLED');
  assert.ok(rec.note && /stopped while this test run was in progress|cancel/i.test(rec.note) || rec.status === 'CANCELLED');
  assert.equal(v.latest.jev.status, 'PASSED', 'the last finished results are still there');
  assert.equal((await viewer.get('/api/testing/runs/tr-00000000000000-ffffff')).status, 404);
  assert.equal((await viewer.get('/api/testing/runs/..%2f..%2fusers')).status >= 400, true);
});

// ---------------------------------------------------------------------------
// the real suites
// ---------------------------------------------------------------------------

test('REAL ROOTS: no category names a file that is missing, and no suite of this project is uncategorised', async function () {
  var R = await h.startApp();
  try {
    var v = (await (await R.login('viewer')).get('/api/testing')).body.result;
    v.categories.forEach(function (c) { assert.deepEqual(c.missingFiles, [], c.label + ' names a file that does not exist'); });
    var named = {};
    v.categories.forEach(function (c) { if (c.id !== 'regression') c.files.forEach(function (f) { named[f.id] = true; }); });
    fs.readdirSync(__dirname).filter(function (f) { return /-test\.js$/.test(f); }).forEach(function (f) {
      assert.ok(named['cc:' + f], f + ' is in no named category, so no category button would ever run it');
    });
    fs.readdirSync(path.join(R.app.platform.agentRoot, 'tests')).filter(function (f) { return /-test\.js$/.test(f); }).forEach(function (f) {
      assert.ok(named['agent:' + f], 'the agent suite ' + f + ' is in no named category');
    });
    var by = {};
    v.categories.forEach(function (c) { by[c.id] = c; });
    var agentTests = by.regression.files.filter(function (f) { return f.project === 'trading-agent'; }).reduce(function (a, f) { return a + f.tests.length; }, 0);
    assert.ok(agentTests >= 572, 'the agent\'s ' + agentTests + ' tests are all in the regression category');
    assert.ok(by.regression.files.every(function (f) { return f.file !== 'e2e-browser-test.js'; }));
  } finally { await R.close(); }
});

test('REAL ROOTS: one real Trading Agent test runs through the real runner and passes', async function () {
  var R = await h.startApp();
  try {
    var op = await R.login('operator');
    var v = (await op.get('/api/testing')).body.result;
    var file = v.categories[0].files.filter(function (f) { return f.id === 'agent:core-primitives-test.js'; })[0];
    assert.ok(file && file.tests.length > 0);
    var res = await op.post('/api/testing/run', { scope: 'test', file: file.id, name: file.tests[0] });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    var r = await h.waitFor(async function () {
      var x = await op.get('/api/testing/runs/' + res.body.result.run.runId);
      return x.body.result.status !== 'RUNNING' ? x.body.result : null;
    }, 60000, 100);
    assert.equal(r.status, 'PASSED', JSON.stringify(r.files));
    assert.deepEqual([r.totals.passed, r.totals.failed, r.totals.total], [1, 0, 1]);
    assert.equal(r.files[0].project, 'trading-agent');
  } finally { await R.close(); }
});
