'use strict';
// =====================================================
// MYTHOS — GitHub bridge WhatsApp MISSION LIFECYCLE tests (gh-issue-461)
// tests/mythos-bridge-whatsapp-lifecycle-test.js
//
// Covers the V3.2.5 addition only: MISSION_START / MISSION_STOP /
// MISSION_SUCCESS in projects/mythos-ai-executor/bridge/notify/whatsapp.js
// (onMissionEvent, missionTitleOf, buildLifecycleMessage) and the two new
// call sites in bridge/github-bridge.js (claimTask, finishTask). The
// existing detailed COMPLETED/FAILED/BLOCKED/HUMAN_APPROVAL kinds are
// covered by tests/mythos-bridge-whatsapp-notify-test.js and are
// deliberately not re-tested here.
//
// Same offline discipline as the sibling suite: no real WhatsApp message,
// a local http server stands in for the gateway, and the REAL adapter and
// REAL HTTP path are exercised.
//
// Run with: node tests/mythos-bridge-whatsapp-lifecycle-test.js
// =====================================================
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIX = path.join(os.homedir(), 'mythos-wa-lifecycle-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true });

var API_KEY = 'evo-test-apikey-Lc4kM9wYbP2q';
var KEY_FILE = path.join(FIX, 'evolution.key');
fs.writeFileSync(KEY_FILE, API_KEY + '\n', { mode: 0o600 });

process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIX, 'no-advisory-credential.env');
process.env.MYTHOS_BRIDGE_PROJECT = 'executor-selftest';
process.env.MYTHOS_BRIDGE_REPO = path.join(FIX, 'repo');
process.env.MYTHOS_BRIDGE_CONTROL_DIR = path.join(FIX, 'control');
process.env.MYTHOS_BRIDGE_TASK_WORKTREES = path.join(FIX, 'wt');
process.env.MYTHOS_BRIDGE_HOME = path.join(FIX, 'home', 'bridge');
process.env.MYTHOS_BRIDGE_PROVIDER = 'mock';
process.env.MYTHOS_BRIDGE_USER = os.userInfo().username;
process.env.OTHMODE_STORE_ROOT = path.join(FIX, 'othstore');
fs.mkdirSync(process.env.OTHMODE_STORE_ROOT, { recursive: true, mode: 0o700 });
delete process.env.MYTHOS_MOCK_SCRIPT;

process.env.MYTHOS_BRIDGE_WHATSAPP_BREAKER = 'off';
delete process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY;
process.env.MYTHOS_BRIDGE_WHATSAPP_HOME = path.join(FIX, 'home', 'bridge', 'notify');
// Enabled throughout this suite (unlike the sibling suite, whose section 1
// proves the disabled default) — that default-disabled behaviour is
// already covered there, once, for the whole module.
process.env.MYTHOS_BRIDGE_WHATSAPP_ENABLED = '1';
process.env.MYTHOS_BRIDGE_WHATSAPP_PROVIDER = 'evolution';
process.env.MYTHOS_BRIDGE_WHATSAPP_INSTANCE = 'mythos-bridge-test';
process.env.MYTHOS_BRIDGE_WHATSAPP_TO = '216000000001';
process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE = KEY_FILE;

var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var bridge = require(path.join(EXEC, 'bridge', 'github-bridge'));
var whatsapp = require(path.join(EXEC, 'bridge', 'notify', 'whatsapp'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }

function git(cwd, args) {
  return cp.execFileSync('git', args, {
    cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' })
  }).trim();
}
function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }

// --- the fake Evolution API gateway ------------------------------------------------
var received = [];
var gateway = { status: 200, body: '{"key":{"id":"MOCK-MSG-1"},"status":"PENDING"}' };
var server = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    var raw = Buffer.concat(chunks).toString('utf8');
    var body = null;
    try { body = JSON.parse(raw); } catch (e) { /* recorded as null */ }
    received.push({ method: req.method, url: req.url, apikey: req.headers.apikey || null, body: body });
    res.writeHead(gateway.status, { 'content-type': 'application/json' });
    res.end(gateway.status === 200 ? gateway.body : '{"error":"fixture refused this message"}');
  });
});

function ledgerDir() { return whatsapp.config().ledgerDir; }
function entriesByKey() {
  var m = {};
  whatsapp.listEntries(whatsapp.config()).forEach(function (e) { m[e.key] = e; });
  return m;
}
function resetGateway() { received.length = 0; gateway.status = 200; }

function run() {
  var PORT = server.address().port;
  process.env.MYTHOS_BRIDGE_WHATSAPP_BASE_URL = 'http://127.0.0.1:' + PORT;

  // ================================================================
  // 1. Unit — the three fixed templates, verbatim
  // ================================================================
  ok(whatsapp.buildLifecycleMessage('MISSION_START', 'Ship the thing') === '🟢 بدأ العمل: Ship the thing',
    'template: MISSION_START matches gh-issue-461 exactly');
  ok(whatsapp.buildLifecycleMessage('MISSION_STOP', 'Ship the thing') === '🔴 توقف العمل: Ship the thing — مشكلة',
    'template: MISSION_STOP matches gh-issue-461 exactly');
  ok(whatsapp.buildLifecycleMessage('MISSION_SUCCESS', 'Ship the thing') === '✅ اكتمل العمل: Ship the thing',
    'template: MISSION_SUCCESS matches gh-issue-461 exactly');
  ok(whatsapp.buildLifecycleMessage('COMPLETED', 'x') === null, 'template: an unknown/non-mission kind builds nothing');

  // No technical details ever, for any kind — only the wrapper + the title.
  ['MISSION_START', 'MISSION_STOP', 'MISSION_SUCCESS'].forEach(function (k) {
    var msg = whatsapp.buildLifecycleMessage(k, 'gh-issue-461 verification mission');
    ok(msg.indexOf('task_id') === -1 && msg.indexOf('branch') === -1 && msg.indexOf('commit') === -1 &&
      msg.indexOf('OTHMODE') === -1 && !/gh-[a-z0-9-]+__/.test(msg),
    'template ' + k + ': carries no technical field, ever');
  });

  // ================================================================
  // 2. Unit — mission title extraction: only a real GitHub-Issue task
  // ================================================================
  ok(whatsapp.missionTitleOf({ task_id: 'x', source: { kind: 'github-issue', issue_title: 'Do the thing' } }) === 'Do the thing',
    'missionTitleOf: reads task.source.issue_title for a github-issue task');
  ok(whatsapp.missionTitleOf({ task_id: 'x', objective: 'Do the thing', title: 'Do the thing' }) === null,
    'missionTitleOf: a task with no source.kind=github-issue has no mission title (never falls back to objective/title)');
  ok(whatsapp.missionTitleOf({ task_id: 'x', source: { kind: 'github-issue', issue_title: '' } }) === null,
    'missionTitleOf: an empty issue_title is treated as no title');
  ok(whatsapp.missionTitleOf(null) === null, 'missionTitleOf: null task is handled without throwing');

  // ================================================================
  // 3. Unit — onMissionEvent never queues without a mission title,
  //    never queues an unknown kind, and never throws
  // ================================================================
  var noTitle = whatsapp.onMissionEvent('MISSION_START', { task_id: 'gh-lc-notitle-01', requested_action: 'investigate' });
  ok(noTitle.queued === false && /no mission title/.test(noTitle.skipped), 'onMissionEvent: a non-github-issue task queues nothing');
  var badKind = whatsapp.onMissionEvent('COMPLETED', { task_id: 'gh-lc-badkind-01', source: { kind: 'github-issue', issue_title: 't' } });
  ok(badKind.queued === false && /not a mission kind/.test(badKind.skipped), 'onMissionEvent: refuses a non-mission kind');
  ok(whatsapp.onMissionEvent('MISSION_START', null).queued === false, 'onMissionEvent: a null task is handled without throwing');

  return Promise.resolve()
    .then(function () {
      // ================================================================
      // 4. End to end through a REAL bridge tick: START, then STOP and
      //    SUCCESS for two different missions
      // ================================================================
      resetGateway();
      var ORIGIN = path.join(FIX, 'origin.git');
      var REPO = path.join(FIX, 'repo');
      var PLANNER = path.join(FIX, 'planner');
      git(FIX, ['init', '--bare', '-q', '-b', 'main', ORIGIN]);
      git(FIX, ['clone', '-q', ORIGIN, REPO]);
      fs.writeFileSync(path.join(REPO, 'README.md'), '# fixture\n');
      git(REPO, ['add', 'README.md']);
      git(REPO, ['commit', '-q', '-m', 'init']);
      git(REPO, ['push', '-q', 'origin', 'main']);
      git(FIX, ['clone', '-q', ORIGIN, PLANNER]);

      var cfgB = bridge.config();
      bridge.init();
      git(REPO, ['push', '-q', 'origin', 'refs/heads/mythos/control:refs/heads/mythos/control']);

      function plannerWrite(name, content) {
        git(PLANNER, ['fetch', '-q', 'origin', 'mythos/control']);
        var has = cp.spawnSync('git', ['rev-parse', '--verify', '-q', 'mythos/control'], { cwd: PLANNER }).status === 0;
        git(PLANNER, has ? ['checkout', '-q', 'mythos/control'] : ['checkout', '-q', '-b', 'mythos/control', 'origin/mythos/control']);
        if (has) git(PLANNER, ['reset', '-q', '--hard', 'origin/mythos/control']);
        var f = path.join(PLANNER, 'control', 'tasks', name);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify(content, null, 2) + '\n');
        git(PLANNER, ['add', '--', 'control/tasks/' + name]);
        git(PLANNER, ['commit', '-q', '-m', 'planner: ' + name]);
        git(PLANNER, ['push', '-q', 'origin', 'mythos/control']);
      }
      // Mirrors bridge/github-issues.js's real shape (issue_title capped at
      // 300 chars there too) without needing a live GitHub Issue.
      function mkIssueTask(id, issueTitle) {
        return {
          protocol: 'mythos-control/1', task_id: id, project: 'executor-selftest',
          objective: 'Inspect the fixture repository and report its HEAD commit.',
          scope: ['README.md'], constraints: ['read-only'], priority: 'normal', requested_action: 'investigate',
          validation_requirements: ['git rev-parse HEAD'], status: 'PENDING',
          created_at: '2026-09-25T18:00:00.000Z', created_by: 'chatgpt-test',
          source: { kind: 'github-issue', repo: 'othoth77/mythos-prod', issue_number: 461, issue_url: 'https://github.com/othoth77/mythos-prod/issues/461', issue_title: issueTitle }
        };
      }
      function taskOnDisk(id) { return readJson(path.join(cfgB.controlDir, 'control', 'tasks', id + '.json')); }
      function reportOnDisk(id) {
        var f = path.join(cfgB.controlDir, 'control', 'reports', id + '.json');
        return fs.existsSync(f) ? readJson(f) : null;
      }

      var TITLE_OK = 'V3.2.5 lifecycle test — succeeds';
      var TITLE_STOP = 'V3.2.5 lifecycle test — stops';
      plannerWrite('gh-lc-e2e-0001.json', mkIssueTask('gh-lc-e2e-0001', TITLE_OK));
      plannerWrite('gh-lc-e2e-0002.json', mkIssueTask('gh-lc-e2e-0002', TITLE_STOP));
      bridge.tick(executor);

      ok(taskOnDisk('gh-lc-e2e-0001').status === 'CLAIMED', 'e2e: mission 1 was claimed by the bridge');
      var afterClaim = entriesByKey();
      ok(afterClaim['gh-lc-e2e-0001__MISSION_START'] && afterClaim['gh-lc-e2e-0001__MISSION_START'].state === 'PENDING',
        'e2e: claiming queues MISSION_START (not sent yet — the tick never talks to the gateway)');
      ok(afterClaim['gh-lc-e2e-0002__MISSION_START'], 'e2e: mission 2 also queued MISSION_START on claim');
      ok(received.length === 0, 'e2e: nothing reached the gateway during claiming');

      return bridge.flushNotifications().then(function (f0) {
        ok(f0.sent === 2, 'e2e: both MISSION_START notifications delivered after the tick returned');
        ok(received.length === 2, 'e2e: two START messages reached the gateway');
        ok(received.some(function (r) { return r.body.text === '🟢 بدأ العمل: ' + TITLE_OK; }),
          'e2e: mission 1 START carries the exact template with its real Issue title');
        ok(received.some(function (r) { return r.body.text === '🟢 بدأ العمل: ' + TITLE_STOP; }),
          'e2e: mission 2 START carries the exact template with its real Issue title');
        resetGateway();

        process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'success', summary: 'mock run one' }, { kind: 'success', summary: 'mock run two' }]);
        return executor.tick().then(function () { return executor.tick(); }).then(function () {
          // Mission 2 loses its executor record — the bridge's own
          // never-silently-re-execute rule — which reaches a BLOCKED report
          // (mapped to MISSION_STOP, same as a genuine FAILED).
          var t2 = taskOnDisk('gh-lc-e2e-0002');
          fs.rmSync(state.taskDir(t2.execution.executor_task_id), { recursive: true, force: true });

          bridge.tick(executor);
          var rep1 = reportOnDisk('gh-lc-e2e-0001');
          var rep2 = reportOnDisk('gh-lc-e2e-0002');
          ok(rep1 && rep1.status === 'COMPLETED', 'e2e: mission 1 reached a COMPLETED REPORT');
          ok(rep2 && rep2.status === 'BLOCKED', 'e2e: mission 2 reached a BLOCKED REPORT');

          var led = entriesByKey();
          ok(led['gh-lc-e2e-0001__MISSION_SUCCESS'], 'e2e: mission 1 queued MISSION_SUCCESS on COMPLETED');
          ok(!led['gh-lc-e2e-0001__MISSION_STOP'], 'e2e: mission 1 never queues MISSION_STOP');
          ok(led['gh-lc-e2e-0002__MISSION_STOP'], 'e2e: mission 2 (BLOCKED) queued MISSION_STOP');
          ok(!led['gh-lc-e2e-0002__MISSION_SUCCESS'], 'e2e: mission 2 never queues MISSION_SUCCESS');
          // The existing technical channel is untouched and independent.
          ok(led['gh-lc-e2e-0001__COMPLETED'] && led['gh-lc-e2e-0002__HUMAN_APPROVAL'],
            'e2e: the existing detailed COMPLETED/HUMAN_APPROVAL notifications still queue exactly as before');
          ok(received.length === 0, 'e2e: the tick itself never talks to the gateway');

          return bridge.flushNotifications().then(function (f) {
            ok(f.sent === 4, 'e2e: all four due notifications (2 lifecycle + 2 technical) delivered');
            ok(received.some(function (r) { return r.body.text === '✅ اكتمل العمل: ' + TITLE_OK; }),
              'e2e: mission 1 SUCCESS carries the exact template');
            ok(received.some(function (r) { return r.body.text === '🔴 توقف العمل: ' + TITLE_STOP + ' — مشكلة'; }),
              'e2e: mission 2 STOP carries the exact template');
            // No lifecycle message body contains a task id or any other
            // technical fragment — only the fixed wrapper + the title.
            // Match the lifecycle templates precisely — the existing technical
            // COMPLETED message also starts with the ✅ glyph (MARK.COMPLETED),
            // so a bare-emoji prefix would wrongly capture it too.
            var lifecycleTexts = received.map(function (r) { return r.body.text; })
              .filter(function (t) { return /^(🟢 بدأ العمل:|🔴 توقف العمل:|✅ اكتمل العمل:)/.test(t); });
            ok(lifecycleTexts.every(function (t) { return t.indexOf('gh-lc-e2e') === -1; }),
              'e2e: no lifecycle message body contains a task id');
            return { cfgB: cfgB, taskOnDisk: taskOnDisk, reportOnDisk: reportOnDisk };
          });
        });
      });
    })
    .then(function (ctx) {
      // ================================================================
      // 5. Dedup — a retry/repair of the same mission never re-notifies
      // ================================================================
      resetGateway();
      var again1 = whatsapp.onMissionEvent('MISSION_START', { task_id: 'gh-lc-e2e-0001', source: { kind: 'github-issue', issue_title: 'irrelevant now' } });
      ok(again1.queued === false && /already in the ledger/.test(again1.skipped) && again1.state === 'SENT',
        'dedup: a second MISSION_START for an already-SENT mission queues nothing');
      var again2 = whatsapp.onMissionEvent('MISSION_SUCCESS', { task_id: 'gh-lc-e2e-0001', source: { kind: 'github-issue', issue_title: 'irrelevant now' } });
      ok(again2.queued === false && /already in the ledger/.test(again2.skipped),
        'dedup: a second MISSION_SUCCESS for the same mission queues nothing');
      return bridge.flushNotifications().then(function (f) {
        ok(f.attempted === 0 && received.length === 0, 'dedup: repeated flushes after a full mission send nothing more');

        // A "recovered" claim (executor task exists, claim commit lost) is
        // the real repair path in claimTask() — same task_id, claimTask run
        // a second time. It must not re-queue MISSION_START either.
        var beforeCount = whatsapp.listEntries(whatsapp.config()).length;
        bridge.tick(executor); // idempotent: nothing left to claim/finish, but exercises the path again
        var afterCount = whatsapp.listEntries(whatsapp.config()).length;
        ok(afterCount === beforeCount, 'dedup: an idempotent re-tick creates no new ledger entries for missions already notified');
        return ctx;
      });
    })
    .then(function (ctx) {
      // ================================================================
      // 6. Notification failure is isolated from mission/task state
      // ================================================================
      resetGateway();
      var origOnMissionEvent = whatsapp.onMissionEvent;
      whatsapp.onMissionEvent = function () { throw new Error('injected failure: gateway adapter exploded'); };
      try {
        var cfgB = ctx.cfgB;
        var beforeTask = fs.readFileSync(path.join(cfgB.controlDir, 'control', 'tasks', 'gh-lc-e2e-0001.json'), 'utf8');
        var beforeHead = git(cfgB.controlDir, ['rev-parse', 'HEAD']);

        plannerWrite2(cfgB, 'gh-lc-fail-0003.json', {
          protocol: 'mythos-control/1', task_id: 'gh-lc-fail-0003', project: 'executor-selftest',
          objective: 'Inspect the fixture repository and report its HEAD commit.',
          scope: ['README.md'], constraints: ['read-only'], priority: 'normal', requested_action: 'investigate',
          validation_requirements: ['git rev-parse HEAD'], status: 'PENDING',
          created_at: '2026-09-25T18:05:00.000Z', created_by: 'chatgpt-test',
          source: { kind: 'github-issue', repo: 'othoth77/mythos-prod', issue_number: 461, issue_url: 'x', issue_title: 'this must never block a claim' }
        });
        var r = bridge.tick(executor);
        ok(r.ok === true, 'isolation: a tick still succeeds while onMissionEvent (MISSION_START) throws synchronously');
        ok(ctx.taskOnDisk('gh-lc-fail-0003').status === 'CLAIMED', 'isolation: the mission is still claimed even though its START notification blew up');
        ok(fs.readFileSync(path.join(cfgB.controlDir, 'control', 'tasks', 'gh-lc-e2e-0001.json'), 'utf8') === beforeTask,
          'isolation: an unrelated already-finished mission file is untouched');
        ok(git(cfgB.controlDir, ['rev-parse', 'HEAD']) !== beforeHead, 'isolation: the control commit for the new claim still happened');

        process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'success', summary: 'mock run three' }]);
        return executor.tick().then(function () {
          var r2 = bridge.tick(executor);
          ok(r2.ok === true, 'isolation: a tick still succeeds while onMissionEvent (MISSION_SUCCESS) throws synchronously');
          var rep3 = ctx.reportOnDisk('gh-lc-fail-0003');
          ok(rep3 && rep3.status === 'COMPLETED', 'isolation: the mission still reaches its real COMPLETED REPORT despite the notification throwing');
          return ctx;
        });
      } finally {
        whatsapp.onMissionEvent = origOnMissionEvent;
      }
    })
    .then(function (ctx) {
      // ================================================================
      // 7. Security — the credential is nowhere in a lifecycle message,
      //    a ledger entry, or a bridge event log line
      // ================================================================
      var ledgerRaw = fs.existsSync(ledgerDir())
        ? fs.readdirSync(ledgerDir()).filter(function (f) { return /\.json$/.test(f); })
          .map(function (f) { return fs.readFileSync(path.join(ledgerDir(), f), 'utf8'); }).join('\n')
        : '';
      ok(ledgerRaw.indexOf(API_KEY) === -1, 'security: the credential never appears in any ledger entry');
      ['🟢 بدأ العمل:', '🔴 توقف العمل:', '✅ اكتمل العمل:'].forEach(function (prefix) {
        ok(ledgerRaw.split('\n').filter(function (l) { return l.indexOf('"message"') !== -1 && l.indexOf(prefix) !== -1; })
          .every(function (l) { return l.indexOf('task_id') === -1 || l.indexOf('"message"') !== l.indexOf('task_id'); }),
        'security: a lifecycle "message" field line contains only the template (sanity check on ' + prefix + ')');
      });
      // The bridge's own event log legitimately carries task ids (pre-existing
      // behaviour, e.g. the 'claimed' and 'whatsapp_mission_queued' lines) —
      // that is not a WhatsApp message body. What must never be there is the
      // credential itself.
      var evLog = path.join(process.env.MYTHOS_BRIDGE_HOME, 'events.log');
      var evRaw = fs.existsSync(evLog) ? fs.readFileSync(evLog, 'utf8') : '';
      ok(evRaw.indexOf(API_KEY) === -1, 'security: the credential never appears in the bridge event log');
      return ctx;
    });
}

function plannerWrite2(cfgB, name, content) {
  var PLANNER = path.join(FIX, 'planner');
  git(PLANNER, ['fetch', '-q', 'origin', 'mythos/control']);
  git(PLANNER, ['checkout', '-q', 'mythos/control']);
  git(PLANNER, ['reset', '-q', '--hard', 'origin/mythos/control']);
  var f = path.join(PLANNER, 'control', 'tasks', name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(content, null, 2) + '\n');
  git(PLANNER, ['add', '--', 'control/tasks/' + name]);
  git(PLANNER, ['commit', '-q', '-m', 'planner: ' + name]);
  git(PLANNER, ['push', '-q', 'origin', 'mythos/control']);
}

server.listen(0, '127.0.0.1', function () {
  run()
    .then(function () {
      server.close();
      fs.rmSync(FIX, { recursive: true, force: true });
      console.log('bridge whatsapp mission-lifecycle tests: ' + passed + ' passed, ' + failed + ' failed');
      if (failed) { console.error('Failures:\n  ' + failures.join('\n  ')); process.exit(1); }
    })
    .catch(function (e) {
      console.error('SUITE ERROR:', e && e.stack || e);
      server.close();
      process.exit(1);
    });
});
