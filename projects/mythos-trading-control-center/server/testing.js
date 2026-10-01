'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — testing center
// projects/mythos-trading-control-center/server/testing.js
//
// Runs the real suites — the Trading Agent's and this project's — with the
// same command a developer would type (`node --test`), one file per process,
// and reports what the runner reported.
//
// THE RULE IS "NEVER HIDE A FAILURE", and it shapes three decisions:
//
//  * A file whose process crashed, timed out, or exited non-zero without a
//    single failing test line is recorded as FAILED with the reason. "No
//    failures were parsed" is not the same as "nothing failed".
//  * A skipped test is counted and shown as skipped, with the runner's reason.
//    It is never folded into "passed".
//  * A run's status is FAILED if anything failed, however many passed.
//
// Tests run with a throwaway HOME and an empty-ish environment. This
// repository has already had a suite write a live health record through a
// `$HOME` default path; a test run started from a production console must not
// be able to do that.
// =====================================================

var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');

var RUNS_DIR = 'test-runs';
var FILE_TIMEOUT_MS = 240 * 1000;
var MAX_KEPT = 30;

var CATEGORY_ORDER = ['unit', 'integration', 'property', 'backtest', 'paper', 'risk', 'recovery', 'jev', 'regression', 'e2e', 'security'];

/**
 * Category → files. `agent:` and `cc:` name the project a file belongs to.
 * `pattern` restricts a file to tests whose name matches (node --test-name-pattern).
 * A category whose files do not exist yet reports that; it does not vanish.
 */
var CATEGORIES = Object.freeze({
  unit: {
    label: 'Unit',
    description: 'Primitives, configuration, store, indicators, data layer, strategies, regime, mode controller, costs; this project\'s own modules and the static rules of its interface.',
    files: ['agent:core-primitives-test.js', 'agent:config-test.js', 'agent:store-test.js', 'agent:indicators-test.js',
      'agent:data-layer-test.js', 'agent:strategy-test.js', 'agent:regime-test.js', 'agent:mode-controller-test.js',
      'agent:execution-and-costs-test.js', 'cc:unit-test.js', 'cc:web-test.js']
  },
  integration: {
    label: 'Integration',
    description: 'The whole agent in mission order; the three agents and the champion gate; the Control Center API, decisions, research, this testing center and the activity and system views against the real agent.',
    files: ['agent:integration-test.js', 'agent:trading-agent-test.js', 'agent:analysis-agent-test.js',
      'agent:research-agent-test.js', 'agent:champion-test.js', 'cc:api-test.js', 'cc:control-test.js',
      'cc:decision-test.js', 'cc:research-test.js', 'cc:testing-test.js', 'cc:activity-system-test.js']
  },
  property: {
    label: 'Property',
    description: 'Randomised properties: approved size never breaches a cap; recovery never exceeds the risk limits at any rung.',
    files: ['agent:risk-recovery-test.js', 'cc:property-test.js'],
    pattern: 'PROPERTY'
  },
  backtest: {
    label: 'Backtest',
    description: 'The engine, walk-forward and stress; the Backtest Center\'s runs.',
    files: ['agent:backtest-engine-test.js', 'agent:stress-test.js', 'cc:backtest-test.js']
  },
  paper: {
    label: 'Paper',
    description: 'Paper session equivalence with the backtest; the paper control room.',
    files: ['agent:paper-test.js', 'cc:paper-test.js']
  },
  risk: {
    label: 'Risk',
    description: 'The Risk Engine. The agent ships risk and recovery as one suite, because recovery is only meaningful against the clamp that bounds it.',
    files: ['agent:risk-recovery-test.js', 'cc:risk-recovery-test.js']
  },
  recovery: {
    label: 'Recovery',
    description: 'The recovery ladder. Same shared agent suite as Risk, plus the Control Center\'s recovery views.',
    files: ['agent:risk-recovery-test.js', 'cc:risk-recovery-test.js'],
    pattern: 'recovery|ladder|rung|Recovery'
  },
  jev: {
    label: 'Jev',
    description: 'The Jev decision gate and its bands.',
    files: ['agent:jev-test.js', 'cc:jev-test.js']
  },
  regression: {
    label: 'Regression',
    description: 'Every suite of both projects, except the browser end-to-end run.',
    files: 'ALL'
  },
  e2e: {
    label: 'E2E',
    description: 'End-to-end flows through the HTTP API and, when a headless browser is available, through the real interface.',
    files: ['cc:e2e-test.js', 'cc:e2e-browser-test.js']
  },
  security: {
    label: 'Security',
    description: 'Authentication, authorization, CSRF, headers, CORS, rate limits, secret protection, and the LIVE lock.',
    files: ['cc:security-test.js', 'cc:live-lock-test.js']
  }
});

var Status = Object.freeze({ RUNNING: 'RUNNING', PASSED: 'PASSED', FAILED: 'FAILED', CANCELLED: 'CANCELLED' });

function refusal(code, message) {
  var e = new Error(message);
  e.code = code;
  e.refusal = true;
  return e;
}

/** Parses `node --test --test-reporter=tap` output for top-level tests. */
function parseTap(text) {
  var lines = String(text).split('\n');
  var tests = [];
  var current = null;
  var inYaml = false;
  var summary = {};
  // What the file printed (and the stack of a file that crashed on load)
  // arrives as TAP comments. The runner does not tie that output to a test, so
  // it is kept per FILE — and shown with the file's failures, where it is
  // usually the diagnosis.
  var printed = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m = /^(not ok|ok) (\d+) - (.*?)(?: # (SKIP|TODO)\b ?(.*))?$/.exec(line);
    if (m) {
      current = {
        name: m[3],
        status: m[4] === 'SKIP' ? 'skipped' : (m[4] === 'TODO' ? 'todo' : (m[1] === 'ok' ? 'passed' : 'failed')),
        durationMs: null,
        skipReason: m[4] ? (m[5] || null) : null,
        failure: null
      };
      tests.push(current);
      inYaml = false;
      continue;
    }
    if (/^# Subtest: /.test(line)) continue;
    if (/^  ---\s*$/.test(line)) { inYaml = true; continue; }
    if (/^  \.\.\.\s*$/.test(line)) { inYaml = false; continue; }
    if (inYaml && current) {
      var d = /^  duration_ms: ([0-9.]+)/.exec(line);
      if (d) { current.durationMs = Math.round(parseFloat(d[1]) * 100) / 100; continue; }
      if (current.status === 'failed') {
        if (!current.failure) current.failure = '';
        if (current.failure.length < 4000) current.failure += line.replace(/^  /, '') + '\n';
      }
      continue;
    }
    var s = /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([0-9.]+)/.exec(line);
    if (s) { summary[s[1]] = parseFloat(s[2]); continue; }
    if (/^# /.test(line) && printed.length < 60) printed.push(line.slice(2));
  }
  return { tests: tests, summary: summary, output: printed.join('\n').slice(0, 4000) };
}

/** Static discovery of test names, for the "run one test" picker. */
function discoverTests(file) {
  var text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  var out = [];
  var re = /^\s*test\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gm;
  var m;
  while ((m = re.exec(text)) !== null) out.push(m[2].replace(/\\(['"`\\])/g, '$1'));
  return out;
}

/**
 * @param {object} spec
 * @param {object} spec.state
 * @param {string} spec.agentRoot
 * @param {string} spec.projectRoot this project's root
 * @param {string} spec.commit
 * @param {function} [spec.now]
 * @param {object} [spec.env] extra environment for test processes (e.g. TCC_CHROME)
 */
function create(spec) {
  var state = spec.state;
  var now = typeof spec.now === 'function' ? spec.now : function () { return Date.now(); };
  // `spec.roots` points the runner at other test directories. The suite that
  // tests this module uses it to run small fixture files — a passing one, a
  // failing one, a crashing one — instead of running the real suites inside
  // themselves.
  var roots = { agent: path.join(spec.agentRoot, 'tests'), cc: path.join(spec.projectRoot, 'tests') };
  var projectDirs = { agent: spec.agentRoot, cc: spec.projectRoot };
  if (spec.roots) {
    ['agent', 'cc'].forEach(function (k) { if (spec.roots[k]) { roots[k] = spec.roots[k]; projectDirs[k] = spec.roots[k]; } });
  }
  var fileTimeoutMs = spec.fileTimeoutMs || FILE_TIMEOUT_MS;
  var extraEnv = spec.env || {};

  var active = null;       // the running run
  var runsIndex = [];      // newest first, summaries only
  state.subdir(RUNS_DIR);

  (function loadExisting() {
    var dir = path.join(state.dir, RUNS_DIR);
    var files = [];
    try { files = fs.readdirSync(dir).filter(function (f) { return /^tr-[0-9a-z-]+\.json$/.test(f); }); } catch (e) { files = []; }
    files.forEach(function (f) {
      try {
        var run = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (run.status === Status.RUNNING) {
          run.status = Status.CANCELLED;
          run.note = 'the Control Center stopped while this test run was in progress';
          fs.writeFileSync(path.join(dir, f), JSON.stringify(run) + '\n', { mode: 0o600 });
        }
        runsIndex.push(summaryOf(run));
      } catch (e) { /* an unreadable record is skipped, not invented */ }
    });
    runsIndex.sort(function (a, b) { return a.startedAt < b.startedAt ? 1 : -1; });
  })();

  function resolve(entry) {
    var i = entry.indexOf(':');
    var project = entry.slice(0, i);
    var name = entry.slice(i + 1);
    return { id: entry, project: project, name: name, path: path.join(roots[project], name) };
  }

  function allFiles() {
    var out = [];
    ['agent', 'cc'].forEach(function (project) {
      var names = [];
      try { names = fs.readdirSync(roots[project]).filter(function (f) { return /-test\.js$/.test(f); }).sort(); } catch (e) { names = []; }
      names.forEach(function (n) {
        // The browser run needs a headless browser and is its own category.
        if (project === 'cc' && n === 'e2e-browser-test.js') return;
        out.push(resolve(project + ':' + n));
      });
    });
    return out;
  }

  function filesFor(category) {
    var def = CATEGORIES[category];
    if (!def) throw refusal('UNKNOWN_CATEGORY', 'unknown test category ' + category);
    return def.files === 'ALL' ? allFiles() : def.files.map(resolve);
  }

  function catalog() {
    return CATEGORY_ORDER.map(function (id) {
      var def = CATEGORIES[id];
      var files = filesFor(id).map(function (f) {
        var exists = fs.existsSync(f.path);
        var tests = exists ? discoverTests(f.path) : [];
        if (exists && def.pattern) {
          var re = new RegExp(def.pattern);
          tests = tests.filter(function (t) { return re.test(t); });
        }
        return { id: f.id, project: f.project === 'agent' ? 'trading-agent' : 'control-center', file: f.name, exists: exists, tests: tests };
      });
      return {
        id: id, label: def.label, description: def.description, pattern: def.pattern || null,
        files: files, testCount: files.reduce(function (a, f) { return a + f.tests.length; }, 0),
        missingFiles: files.filter(function (f) { return !f.exists; }).map(function (f) { return f.id; })
      };
    });
  }

  function summaryOf(run) {
    return {
      runId: run.runId, scope: run.scope, category: run.category || null, target: run.target || null,
      status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, durationMs: run.durationMs,
      commit: run.commit, actor: run.actor, totals: run.totals, note: run.note || null
    };
  }

  function persist(run) {
    var file = path.join(state.dir, RUNS_DIR, run.runId + '.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(run) + '\n', { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }

  function prune() {
    while (runsIndex.length > MAX_KEPT) {
      var old = runsIndex.pop();
      try { fs.unlinkSync(path.join(state.dir, RUNS_DIR, old.runId + '.json')); } catch (e) { /* already gone */ }
    }
  }

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /**
   * @param {object} q { scope: 'all'|'category'|'test', category, file, name }
   */
  function start(q, actor) {
    if (active) throw refusal('TEST_RUN_IN_PROGRESS', 'a test run is already in progress (' + active.run.runId + ')');
    var plan = [];
    if (q.scope === 'all') {
      plan = allFiles().concat([resolve('cc:e2e-browser-test.js')]).map(function (f) { return { file: f, pattern: null }; });
    } else if (q.scope === 'category') {
      var def = CATEGORIES[q.category];
      if (!def) throw refusal('UNKNOWN_CATEGORY', 'unknown test category ' + q.category);
      plan = filesFor(q.category).map(function (f) { return { file: f, pattern: def.pattern || null }; });
    } else if (q.scope === 'test') {
      var known = allFiles().concat([resolve('cc:e2e-browser-test.js')]);
      var target = known.filter(function (f) { return f.id === q.file; })[0];
      if (!target) throw refusal('UNKNOWN_TEST_FILE', 'unknown test file ' + q.file);
      if (discoverTests(target.path).indexOf(q.name) === -1) throw refusal('UNKNOWN_TEST', 'no test named that in ' + q.file);
      plan = [{ file: target, pattern: '^' + escapeRegex(q.name) + '$' }];
    } else {
      throw refusal('UNKNOWN_SCOPE', 'scope must be all, category or test');
    }

    var t = now();
    var run = {
      runId: 'tr-' + new Date(t).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex'),
      scope: q.scope,
      category: q.scope === 'category' ? q.category : null,
      target: q.scope === 'test' ? { file: q.file, name: q.name } : null,
      status: Status.RUNNING,
      startedAt: new Date(t).toISOString(),
      finishedAt: null,
      durationMs: null,
      commit: spec.commit || null,
      actor: actor ? { id: actor.id, role: actor.role } : null,
      totals: { passed: 0, failed: 0, skipped: 0, total: 0, files: plan.length, filesDone: 0 },
      files: []
    };
    var home = fs.mkdtempSync(path.join(os.tmpdir(), 'tcc-test-home-'));
    active = { run: run, plan: plan, index: 0, child: null, home: home, cancelled: false };
    persist(run);
    runsIndex.unshift(summaryOf(run));
    prune();
    setImmediate(next);
    return summaryOf(run);
  }

  function next() {
    if (!active) return;
    if (active.cancelled || active.index >= active.plan.length) return finishRun();
    var step = active.plan[active.index++];
    var file = step.file;
    var record = {
      id: file.id, project: file.project === 'agent' ? 'trading-agent' : 'control-center', file: file.name,
      pattern: step.pattern, passed: 0, failed: 0, skipped: 0, total: 0, durationMs: null,
      exitCode: null, status: 'RUNNING', problem: null, tests: []
    };
    active.run.files.push(record);

    if (!fs.existsSync(file.path)) {
      // A missing file is a failure of the suite's definition, and says so.
      record.status = 'FAILED';
      record.failed = 1;
      record.total = 1;
      record.problem = 'test file does not exist';
      return fileDone(record);
    }

    var args = ['--test', '--test-reporter=tap'];
    if (step.pattern) args.push('--test-name-pattern=' + step.pattern);
    args.push(file.path);
    var started = Date.now();
    var out = '';
    var err = '';
    var child = childProcess.spawn(process.execPath, args, {
      cwd: projectDirs[file.project],
      env: Object.assign({
        PATH: process.env.PATH || '/usr/bin:/bin', HOME: active.home, TMPDIR: os.tmpdir(),
        NODE_ENV: 'test', TZ: 'UTC', TCC_TEST_RUN: '1'
      }, extraEnv),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    active.child = child;
    child.stdout.on('data', function (d) { if (out.length < 8 * 1024 * 1024) out += String(d); });
    child.stderr.on('data', function (d) { if (err.length < 16000) err += String(d); });
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; try { child.kill('SIGKILL'); } catch (e) { /* gone */ } }, fileTimeoutMs);
    child.on('error', function (e) {
      clearTimeout(timer);
      record.status = 'FAILED';
      record.failed = 1; record.total = 1;
      record.problem = 'could not start the test process: ' + String(e.message).slice(0, 300);
      fileDone(record);
    });
    child.on('close', function (code, signal) {
      clearTimeout(timer);
      if (record.status !== 'RUNNING') return;
      var parsed = parseTap(out);
      record.tests = parsed.tests;
      record.passed = parsed.tests.filter(function (x) { return x.status === 'passed'; }).length;
      record.failed = parsed.tests.filter(function (x) { return x.status === 'failed'; }).length;
      record.skipped = parsed.tests.filter(function (x) { return x.status === 'skipped' || x.status === 'todo'; }).length;
      record.total = parsed.tests.length;
      record.durationMs = Date.now() - started;
      record.exitCode = code;
      if (timedOut) {
        record.problem = 'the file exceeded ' + (fileTimeoutMs / 1000) + ' s and was stopped';
        record.failed += 1; record.total += 1;
      } else if (code !== 0 && record.failed === 0) {
        // Non-zero exit with no failing test line: something failed outside a
        // test (a syntax error, a crash on load). It is a failure.
        record.problem = 'the process exited ' + (signal || code) + ' without reporting a failing test' +
          (err ? ': ' + err.slice(-800) : '');
        record.failed += 1; record.total += 1;
      } else if (record.total === 0) {
        record.problem = step.pattern ? 'no test in this file matched the pattern' : 'the file reported no tests';
      }
      record.status = record.failed > 0 ? 'FAILED' : 'PASSED';
      // Kept only where it helps: beside a failure.
      if (record.failed > 0 && parsed.output) record.output = parsed.output;
      fileDone(record);
    });
  }

  function fileDone(record) {
    if (!active) return;
    var totals = active.run.totals;
    totals.passed += record.passed;
    totals.failed += record.failed;
    totals.skipped += record.skipped;
    totals.total += record.total;
    totals.filesDone += 1;
    active.child = null;
    persist(active.run);
    updateIndex(active.run);
    setImmediate(next);
  }

  function updateIndex(run) {
    for (var i = 0; i < runsIndex.length; i++) {
      if (runsIndex[i].runId === run.runId) { runsIndex[i] = summaryOf(run); return; }
    }
  }

  function finishRun() {
    var run = active.run;
    var t = now();
    run.finishedAt = new Date(t).toISOString();
    run.durationMs = t - Date.parse(run.startedAt);
    run.status = active.cancelled ? Status.CANCELLED : (run.totals.failed > 0 ? Status.FAILED : Status.PASSED);
    if (!active.cancelled && run.totals.total === 0) {
      run.status = Status.FAILED;
      run.note = 'no test ran';
    }
    try { fs.rmSync(active.home, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    persist(run);
    updateIndex(run);
    var cb = spec.onFinished;
    active = null;
    if (typeof cb === 'function') { try { cb(summaryOf(run)); } catch (e) { /* listener errors are not ours */ } }
  }

  function get(runId) {
    if (active && active.run.runId === runId) return active.run;
    if (!/^tr-[0-9a-z-]+$/.test(String(runId))) return null;
    try { return JSON.parse(fs.readFileSync(path.join(state.dir, RUNS_DIR, runId + '.json'), 'utf8')); }
    catch (e) { return null; }
  }

  /** The most recent finished run that covered each category. */
  function latestByCategory() {
    var out = {};
    CATEGORY_ORDER.forEach(function (id) {
      var ids = filesFor(id).map(function (f) { return f.id; });
      var pattern = CATEGORIES[id].pattern || null;
      for (var i = 0; i < runsIndex.length; i++) {
        var s = runsIndex[i];
        // A cancelled run is a partial result: it never replaces the last
        // finished one.
        if (s.status === Status.RUNNING || s.status === Status.CANCELLED) continue;
        var covers = (s.scope === 'category' && s.category === id) || s.scope === 'all';
        if (!covers) continue;
        var run = get(s.runId);
        if (!run) continue;
        var files = run.files.filter(function (f) { return ids.indexOf(f.id) !== -1; });
        if (!files.length) continue;
        var agg = { passed: 0, failed: 0, skipped: 0, total: 0, durationMs: 0 };
        files.forEach(function (f) {
          var tests = f.tests;
          if (pattern && s.scope === 'all') {
            var re = new RegExp(pattern);
            tests = tests.filter(function (t) { return re.test(t.name); });
            agg.passed += tests.filter(function (t) { return t.status === 'passed'; }).length;
            agg.failed += tests.filter(function (t) { return t.status === 'failed'; }).length + (f.problem ? 1 : 0);
            agg.skipped += tests.filter(function (t) { return t.status === 'skipped' || t.status === 'todo'; }).length;
            agg.total += tests.length + (f.problem ? 1 : 0);
          } else {
            agg.passed += f.passed; agg.failed += f.failed; agg.skipped += f.skipped; agg.total += f.total;
          }
          agg.durationMs += f.durationMs || 0;
        });
        out[id] = {
          runId: s.runId, scope: s.scope, status: agg.failed > 0 ? 'FAILED' : (agg.total === 0 ? 'NO_TESTS' : 'PASSED'),
          passed: agg.passed, failed: agg.failed, skipped: agg.skipped, total: agg.total,
          durationMs: agg.durationMs, finishedAt: s.finishedAt, commit: s.commit
        };
        break;
      }
      if (!out[id]) out[id] = null;
    });
    return out;
  }

  function view() {
    return {
      categories: catalog(),
      latest: latestByCategory(),
      active: active ? summaryOf(active.run) : null,
      activeProgress: active ? { filesDone: active.run.totals.filesDone, files: active.run.totals.files,
        current: active.run.files.length ? active.run.files[active.run.files.length - 1].id : null } : null,
      runs: runsIndex.slice(0, MAX_KEPT),
      commit: spec.commit || null
    };
  }

  function cancel() {
    if (!active) throw refusal('NO_TEST_RUN', 'no test run is in progress');
    active.cancelled = true;
    if (active.child) { try { active.child.kill('SIGKILL'); } catch (e) { /* gone */ } }
    return summaryOf(active.run);
  }

  function shutdown() {
    if (active) {
      active.cancelled = true;
      if (active.child) { try { active.child.kill('SIGKILL'); } catch (e) { /* gone */ } }
    }
  }

  return {
    Status: Status,
    start: start,
    cancel: cancel,
    get: get,
    view: view,
    catalog: catalog,
    latestByCategory: latestByCategory,
    busy: function () { return !!active; },
    latestFull: function () {
      for (var i = 0; i < runsIndex.length; i++) {
        if (runsIndex[i].scope === 'all' && runsIndex[i].status !== Status.RUNNING) return runsIndex[i];
      }
      return null;
    },
    shutdown: shutdown
  };
}

module.exports = {
  create: create,
  parseTap: parseTap,
  discoverTests: discoverTests,
  CATEGORIES: CATEGORIES,
  CATEGORY_ORDER: CATEGORY_ORDER,
  Status: Status
};
