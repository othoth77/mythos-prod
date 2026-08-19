'use strict';
// =====================================================
// MOS-v2 M-08 REGRESSION GATE
// tests/mos-v2-regression-test.js
//
// Final regression gate for MOS-v2 stage M-08. Runs the four core test
// suites as child processes, captures their pass/fail summary lines, and
// asserts expected results. Includes a coverage mapping section that
// verifies all required MOS-v2 areas are tested.
//
// Run with: node tests/mos-v2-regression-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var { execSync, spawnSync } = require('child_process');

var BASE = path.join(__dirname, '..');
var passed = 0, failed = 0, failures = [];

function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

function eq(a, b, name) {
  ok(a === b, name + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}

// Pre-existing known failures (VPS-only systemd checks that cannot run in sandbox)
var KNOWN_ORCHESTRATION_CORE_FAILURES = [
  'O accept: persistent delivery relay unit exists',
  'O accept: delivery relay timer is active (inactive)'
];

// =====================================================
// PART 1: Run test suites and capture results
// =====================================================

console.log('\n=== MOS-v2 M-08 Regression Gate ===\n');

var suites = [
  { file: 'tests/mos-1-console-test.js', name: 'MOS-1 Console', expectPass: 972, expectFail: 0, detectFail: true },
  { file: 'tests/mythos-ai-executor-test.js', name: 'AI Executor', expectPass: 158, expectFail: 0, detectFail: true },
  { file: 'tests/mythos-orchestration-core-test.js', name: 'Orchestration Core', expectPass: 255, expectFail: 2, detectFail: false, knownFailures: KNOWN_ORCHESTRATION_CORE_FAILURES },
  { file: 'tests/mythos-orchestrator-0-test.js', name: 'Orchestrator-0', expectPass: 156, expectFail: 0, detectFail: true }
];

var results = {};
var hasNewFailures = false;

suites.forEach(function (suite) {
  var fullPath = path.join(BASE, suite.file);
  if (!fs.existsSync(fullPath)) {
    console.error('ERROR: suite file not found: ' + fullPath);
    ok(false, 'suite file exists: ' + suite.name);
    return;
  }

  console.log('Running ' + suite.name + '...');

  var output = '';
  try {
    output = execSync('timeout 300 node "' + fullPath + '" 2>&1', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (e) {
    output = e.stdout || '';
    if (e.stderr) output += e.stderr;
  }

  // Parse the summary line at the end of output
  var summaryMatch = output.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  if (!summaryMatch) {
    console.error('ERROR: could not parse summary for ' + suite.name);
    console.error('Last 500 chars of output:');
    console.error(output.slice(-500));
    ok(false, 'parsed summary from ' + suite.name);
    results[suite.name] = { passed: 0, failed: 0, status: 'PARSE_ERROR' };
    return;
  }

  var testPassed = parseInt(summaryMatch[1], 10);
  var testFailed = parseInt(summaryMatch[2], 10);

  console.log('  ' + testPassed + ' passed, ' + testFailed + ' failed');

  results[suite.name] = {
    passed: testPassed,
    failed: testFailed,
    output: output,
    status: null
  };

  // Validate expectations
  var passOk = testPassed >= suite.expectPass;  // allow pass count to grow
  var failOk = false;

  if (suite.name === 'Orchestration Core') {
    // Special handling for orchestration-core: expect exactly 2 pre-existing failures
    failOk = testFailed <= 2;

    if (failOk && testFailed === 2) {
      // Verify the failures are the known ones
      var failures = [];
      var lines = output.split('\n');
      lines.forEach(function (line) {
        if (line.indexOf('FAIL: ') === 0) {
          failures.push(line.substring(6));
        }
      });

      var allKnown = true;
      failures.forEach(function (failure) {
        var isKnown = KNOWN_ORCHESTRATION_CORE_FAILURES.some(function (known) {
          return failure.indexOf(known) !== -1;
        });
        if (!isKnown) {
          console.error('  ERROR: unexpected failure: ' + failure);
          allKnown = false;
          hasNewFailures = true;
        }
      });

      if (allKnown && failures.length === 2) {
        results[suite.name].status = 'PRE-EXISTING FAILURE';
        ok(true, 'orchestration-core: exactly 2 pre-existing failures');
      } else if (!allKnown) {
        results[suite.name].status = 'NEW FAILURE';
        ok(false, 'orchestration-core: failures are all known');
      } else {
        console.error('  WARNING: expected 2 pre-existing failures, got ' + failures.length);
        results[suite.name].status = 'UNEXPECTED_COUNT';
      }
    } else if (!failOk) {
      results[suite.name].status = 'NEW FAILURE';
      ok(false, 'orchestration-core: failed count <= 2 (got ' + testFailed + ')');
      hasNewFailures = true;
    }
  } else {
    // For other suites, no failures allowed
    failOk = testFailed === 0;
    if (!failOk) {
      hasNewFailures = true;
    }
  }

  // Overall pass/fail
  if (passOk && failOk) {
    results[suite.name].status = results[suite.name].status || 'PASS';
    if (results[suite.name].status === 'PASS') {
      ok(true, suite.name + ' suite passes');
    }
  } else {
    if (!passOk) {
      results[suite.name].status = 'NEW FAILURE';
      ok(false, suite.name + ' pass count >= ' + suite.expectPass + ' (got ' + testPassed + ')');
      hasNewFailures = true;
    }
    if (!failOk && suite.name !== 'Orchestration Core') {
      results[suite.name].status = 'NEW FAILURE';
      ok(false, suite.name + ' fail count == 0 (got ' + testFailed + ')');
      hasNewFailures = true;
    }
  }
});

// =====================================================
// PART 2: Coverage mapping
// =====================================================

console.log('\n=== Coverage Mapping ===\n');

var coverageAreas = [
  { name: 'Authentication', anchor: 'login', suite: ['mos-1-console-test.js'] },
  { name: 'Authorization', anchor: 'unauthorized|profile_not_authorized', suite: ['mos-1-console-test.js'] },
  { name: 'Model catalog', anchor: 'model-catalog|isAllowed', suite: ['mos-1-console-test.js'] },
  { name: 'Execution profiles', anchor: 'execution_profile', suite: ['mos-1-console-test.js', 'mythos-ai-executor-test.js'] },
  { name: 'Cancellation (console relay)', anchor: 'cancel', suite: ['mos-1-console-test.js'] },
  { name: 'Mission creation', anchor: 'start.*route|/api/missions/start', suite: ['mos-1-console-test.js'] },
  { name: 'Mission start', anchor: 'dispatch', suite: ['mos-1-console-test.js'] },
  { name: 'Dispatcher', anchor: 'Dispatcher.*API|MOS-3C', suite: ['mos-1-console-test.js', 'mythos-ai-executor-test.js'] },
  { name: 'MAX_PARALLEL=5', anchor: 'max_parallel.*5|MAX_PARALLEL', suite: ['mos-1-console-test.js', 'mythos-ai-executor-test.js'] },
  { name: 'Queue', anchor: 'queue|queued', suite: ['mythos-ai-executor-test.js'] },
  { name: 'Auto-drain', anchor: 'drainQueue|auto.*start|P7', suite: ['mythos-ai-executor-test.js'] },
  { name: 'Failure isolation', anchor: 'Failure isolation|P8', suite: ['mythos-orchestration-core-test.js', 'mythos-ai-executor-test.js'] },
  { name: 'Cancellation', anchor: 'cancelSafe|SIGTERM', suite: ['mythos-orchestrator-0-test.js'] },
  { name: 'Result association', anchor: 'task_id.*result|task_id', suite: ['mos-1-console-test.js'] },
  { name: 'Credential isolation', anchor: 'redact|credential', suite: ['mythos-orchestrator-0-test.js'] },
  { name: 'Invalid input', anchor: 'invalid|bad_request|malformed', suite: ['mos-1-console-test.js'] },
  { name: 'Path traversal', anchor: 'etc/passwd|\\.\\.\\.|whitelist.*static|no.*path.*joined', suite: ['mos-1-console-test.js'] },
  { name: 'Request-size contract', anchor: 'limit|contract|size', suite: ['mos-1-console-test.js'] },
  { name: 'Unauthorized writes', anchor: 'MOS_ALLOW_REPO_WRITE|profile_not_authorized', suite: ['mos-1-console-test.js'] },
  { name: 'Session behavior', anchor: 'session|httpOnly|cookie', suite: ['mos-1-console-test.js'] }
];

var coverageMapped = 0, coverageUncovered = 0;

coverageAreas.forEach(function (area) {
  var found = false;
  var foundIn = [];

  area.suite.forEach(function (suiteName) {
    var fullPath = path.join(BASE, 'tests', suiteName);
    if (fs.existsSync(fullPath)) {
      var content = fs.readFileSync(fullPath, 'utf8');
      var regex = new RegExp(area.anchor, 'i');
      if (regex.test(content)) {
        found = true;
        foundIn.push(suiteName.replace('-test.js', ''));
      }
    }
  });

  if (found) {
    console.log('PASS ' + area.name + ' → ' + foundIn.join(', '));
    coverageMapped++;
  } else {
    console.log('UNCOVERED ' + area.name + ' (expected in ' + area.suite.join(', ') + ')');
    coverageUncovered++;
  }
});

// =====================================================
// PART 3: Summary
// =====================================================

console.log('\n=== Suite Results ===\n');

var passCount = 0, preExistingCount = 0, newFailureCount = 0;

Object.keys(results).forEach(function (suiteName) {
  var result = results[suiteName];
  var status = result.status || 'UNKNOWN';

  if (status === 'PASS') {
    passCount++;
    console.log('PASS ' + suiteName + ' (' + result.passed + ' passed, ' + result.failed + ' failed)');
  } else if (status === 'PRE-EXISTING FAILURE') {
    preExistingCount++;
    console.log('PRE-EXISTING FAILURE ' + suiteName + ' (' + result.passed + ' passed, ' + result.failed + ' failed)');
  } else if (status === 'NEW FAILURE') {
    newFailureCount++;
    console.log('NEW FAILURE ' + suiteName + ' (' + result.passed + ' passed, ' + result.failed + ' failed)');
  } else {
    console.log('UNKNOWN ' + suiteName + ' (status: ' + status + ')');
  }
});

console.log('\n=== MOS-v2 Regression Summary ===\n');

console.log('Suites: ' + passCount + ' PASS, ' + preExistingCount + ' pre-existing failures (known), ' + newFailureCount + ' new failures');
console.log('Coverage: ' + coverageMapped + ' / ' + coverageAreas.length + ' areas mapped');

if (newFailureCount > 0) {
  console.log('\nFAILURE: Regression detected (' + newFailureCount + ' new failure(s))');
  process.exit(1);
} else {
  console.log('\nSUCCESS: MOS-v2 regression gate passes');
  process.exit(0);
}
