'use strict';
// =====================================================
// MYTHOS — GitHub Pull Request → Telegram notification tests
// tests/mythos-github-prs-test.js
//
// Offline and deterministic. The GitHub REST API is stood in for by a local
// http server that serves fixed /pulls, /reviews and /check-runs payloads
// the test controls tick by tick. No network, no real repository.
//
// Sections:
//   1. pure decision helpers (reviewDecision, checksDecision)
//   2. a PR's lifecycle across ticks: opened → updated → review → checks → merged
//   3. a PR closed without merge
//   4. dedup across repeated ticks with no state change
//   5. read-only: the client never calls a write endpoint
// =====================================================
var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIX = path.join(os.homedir(), 'mythos-github-prs-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true });

process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'home');
process.env.MYTHOS_BRIDGE_HOME = path.join(FIX, 'home', 'bridge');
process.env.MYTHOS_BRIDGE_REPO = path.join(FIX, 'repo');
process.env.MYTHOS_ISSUES_REPO = 'othoth77/mythos-prod-fixture';
process.env.MYTHOS_GITHUB_ISSUES_TOKEN = 'ghp_fixture_token_1234567890abcdef';
process.env.MYTHOS_PR_NOTIFY_ENABLED = '1';
process.env.MYTHOS_TELEGRAM_NOTIFY_ENABLED = '1';
process.env.MYTHOS_TELEGRAM_BOT_TOKEN = '11111111:CCtestTOKENabcdefghijklmnopqrstuv';
process.env.MYTHOS_TELEGRAM_ALLOWED_USER_IDS = '999888777';
process.env.MYTHOS_TELEGRAM_NOTIFY_MIN_GAP_MS = '1';
delete process.env.MYTHOS_TELEGRAM_ENABLED;
delete process.env.MYTHOS_ISSUES_ENABLED;

var prs = require(path.join(EXEC, 'bridge', 'github-prs'));
var tn = require(path.join(EXEC, 'bridge', 'notify', 'telegram-notify'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }

// --- fake GitHub API -----------------------------------------------------------------
var writeCalls = [];
var fixture = { pulls: [], reviews: {}, checks: {} };
var server = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    if (req.method !== 'GET') writeCalls.push({ method: req.method, path: req.url });
    function send(code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
    var m1 = /^\/repos\/[^/]+\/[^/]+\/pulls\?/.exec(req.url);
    if (m1) return send(200, /page=2/.test(req.url) ? [] : fixture.pulls);
    var m2 = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/reviews/.exec(req.url);
    if (m2) return send(200, fixture.reviews[m2[1]] || []);
    var m3 = /^\/repos\/[^/]+\/[^/]+\/commits\/([^/]+)\/check-runs/.exec(req.url);
    if (m3) return send(200, { check_runs: fixture.checks[m3[1]] || [] });
    send(404, { message: 'not found' });
  });
});

// listCheckRuns() in github-prs.js expects the raw array from must(), but the
// real GitHub endpoint wraps it as {total_count, check_runs:[...]}. Mirror
// that shape and adjust the client call site under test accordingly by
// reading `.check_runs` — this fixture proves the real response shape.
function pr(n, over) {
  return Object.assign({
    number: n, state: 'open', title: 'PR #' + n, merged_at: null,
    head: { sha: 'sha-' + n + '-a' }
  }, over || {});
}

function run() {
  var PORT = server.address().port;
  process.env.MYTHOS_GITHUB_API_URL = 'http://127.0.0.1:' + PORT;

  // ================================================================
  // 1. pure decision helpers
  // ================================================================
  ok(prs.reviewDecision([]) === null, 'reviewDecision: no reviews -> null');
  ok(prs.reviewDecision([{ user: { login: 'a' }, state: 'COMMENTED', submitted_at: '2026-01-01T00:00:00Z' }]) === null, 'reviewDecision: comments alone never decide');
  ok(prs.reviewDecision([
    { user: { login: 'a' }, state: 'APPROVED', submitted_at: '2026-01-01T00:00:00Z' },
    { user: { login: 'a' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-01-02T00:00:00Z' }
  ]) === 'CHANGES_REQUESTED', 'reviewDecision: the same reviewer\'s later review supersedes an earlier one');
  ok(prs.reviewDecision([
    { user: { login: 'a' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-01-01T00:00:00Z' },
    { user: { login: 'b' }, state: 'APPROVED', submitted_at: '2026-01-02T00:00:00Z' }
  ]) === 'CHANGES_REQUESTED', 'reviewDecision: any outstanding CHANGES_REQUESTED wins over another reviewer\'s approval');

  ok(prs.checksDecision([]) === null, 'checksDecision: no checks configured -> null (never a failure)');
  ok(prs.checksDecision([{ status: 'in_progress' }]) === 'pending', 'checksDecision: an incomplete run is pending');
  ok(prs.checksDecision([{ status: 'completed', conclusion: 'success' }]) === 'success', 'checksDecision: all-success is success');
  ok(prs.checksDecision([{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' }]) === 'failure', 'checksDecision: one failing run fails the whole check');

  return Promise.resolve().then(function () {
    // ================================================================
    // 2. lifecycle across ticks: opened → updated → review → checks → merged
    // ================================================================
    fixture.pulls = [pr(501, { title: 'Add feature X' })];
    fixture.reviews['501'] = [];
    fixture.checks['sha-501-a'] = [];

    return prs.tick({}).then(function (t1) {
      ok(t1.ok === true && t1.touched === 1, 'lifecycle: tick 1 sees the newly opened PR');
      var opened = tn.readEntry(tn.config(), tn.ledgerKey('PR-501', 'PR_OPENED'));
      ok(opened && opened.state === 'PENDING', 'lifecycle: PR_OPENED is queued on first sight');

      // Push a new commit + a passing review + passing checks in the same tick.
      fixture.pulls = [pr(501, { title: 'Add feature X', head: { sha: 'sha-501-b' } })];
      fixture.reviews['501'] = [{ user: { login: 'reviewer1' }, state: 'APPROVED', submitted_at: '2026-01-01T00:00:00Z' }];
      fixture.checks['sha-501-b'] = [{ status: 'completed', conclusion: 'success' }];

      return prs.tick({});
    }).then(function (t2) {
      ok(t2.touched === 1, 'lifecycle: tick 2 detects the new head commit');
      var updated = tn.readEntry(tn.config(), tn.ledgerKey('PR-501', 'PR_UPDATED'));
      ok(updated, 'lifecycle: PR_UPDATED is queued when the head commit changes');
      var review = tn.readEntry(tn.config(), tn.ledgerKey('PR-501', 'PR_REVIEW'));
      ok(review && /تمت الموافقة/.test(review.message), 'lifecycle: PR_REVIEW records the approval');
      var checks = tn.readEntry(tn.config(), tn.ledgerKey('PR-501', 'PR_CHECKS'));
      ok(checks && checks.message.indexOf('✅') === 0, 'lifecycle: PR_CHECKS records the passing mark');

      // Merge it.
      fixture.pulls = [pr(501, { title: 'Add feature X', state: 'closed', merged_at: '2026-01-02T00:00:00Z', head: { sha: 'sha-501-b' } })];
      return prs.tick({});
    }).then(function (t3) {
      ok(t3.touched === 1, 'lifecycle: tick 3 detects the merge');
      var merged = tn.readEntry(tn.config(), tn.ledgerKey('PR-501', 'PR_MERGED'));
      ok(merged, 'lifecycle: PR_MERGED is queued exactly once');

      // ================================================================
      // 3. closed without merge
      // ================================================================
      fixture.pulls = fixture.pulls.concat([pr(502, { title: 'Abandoned idea' })]);
      fixture.reviews['502'] = [];
      fixture.checks['sha-502-a'] = [];
      return prs.tick({});
    }).then(function () {
      fixture.pulls = [
        pr(501, { title: 'Add feature X', state: 'closed', merged_at: '2026-01-02T00:00:00Z', head: { sha: 'sha-501-b' } }),
        pr(502, { title: 'Abandoned idea', state: 'closed', merged_at: null, head: { sha: 'sha-502-a' } })
      ];
      return prs.tick({});
    }).then(function (t5) {
      var closed = tn.readEntry(tn.config(), tn.ledgerKey('PR-502', 'PR_CLOSED'));
      ok(closed && !/تم الدمج/.test(closed.message), 'closed-without-merge: PR_CLOSED is queued, not PR_MERGED');

      // ================================================================
      // 4. dedup across repeated ticks with no state change
      // ================================================================
      var before = tn.listEntries(tn.config()).length;
      return prs.tick({}).then(function () {
        var after = tn.listEntries(tn.config()).length;
        ok(after === before, 'dedup: an unchanged repeat tick queues no new ledger entries');

        // ================================================================
        // 5. read-only: the client never calls a write endpoint
        // ================================================================
        ok(writeCalls.length === 0, 'read-only: github-prs.js never issues a non-GET request to the GitHub API');

        // disabled by default
        delete process.env.MYTHOS_PR_NOTIFY_ENABLED;
        return prs.tick({}).then(function (d) {
          ok(d.enabled === false, 'default: PR polling is disabled unless MYTHOS_PR_NOTIFY_ENABLED=1');
        });
      });
    });
  });
}

server.listen(0, '127.0.0.1', function () {
  run().then(function () {
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    server.close();
    fs.rmSync(FIX, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  }, function (e) {
    console.error('FATAL', e && e.stack || e);
    server.close();
    process.exit(1);
  });
});
