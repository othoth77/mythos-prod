'use strict';
// =====================================================
// MYTHOS — V3.2.5 durable WhatsApp lifecycle outbox
// tests/mythos-bridge-whatsapp-durable-test.js
//
// What gh-issue-461 / gh-issue-464 exposed, proven fixed end to end:
//   - a provider OUTAGE (timeout, transport, 5xx "Connection Closed") never
//     destroys a notification (was: EXHAUSTED after 5 attempts);
//   - an interrupted send is requeued, never exhausted;
//   - recovery does not wait out the breaker cooldown: a connected gateway
//     (read-only connectionState) half-opens the circuit, a successful probe
//     closes it and the backlog drains in the same flush — no human step;
//   - a mission is the Issue, not the attempt: a rerun never repeats START;
//   - per-mission order: SUCCESS never overtakes START;
//   - duplicates: two flushes / two PROCESSES at once send each event once;
//   - a real crash (SIGKILL mid-send) is recovered after the lease;
//   - a notification never changes the mission: real bridge ticks with the
//     gateway down, and with the notification store unwritable.
//
// No mocks of the module under test: a real HTTP server shaped like the
// Evolution API, the real evolution adapter, the real on-disk ledger, real
// child processes, and real bridge ticks with the executor's mock provider.
// Offline. Run with: node tests/mythos-bridge-whatsapp-durable-test.js
// =====================================================
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var WA = path.join(EXEC, 'bridge', 'notify', 'whatsapp');
var FIX = path.join(os.homedir(), 'mythos-wa-durable-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true });

var API_KEY = 'evo-durable-test-key-Zq81';
var KEY_FILE = path.join(FIX, 'evolution.key');
fs.writeFileSync(KEY_FILE, API_KEY + '\n', { mode: 0o600 });

process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIX, 'no-advisory-credential.env');
process.env.MYTHOS_RESOURCE_GUARD = 'off';
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

var passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.error('FAIL: ' + name); } }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function git(cwd, args) {
  return cp.execFileSync('git', args, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' }) }).trim();
}

// ---------------------------------------------------------------- Evolution-shaped gateway
// mode: 'ok' (201 + key.id + status PENDING, like Evolution v2), 'closed' (500
// "Connection Closed", what a disconnected WhatsApp session returns),
// 'reject' (400), 'hang' (never answers → client timeout).
var gw = { mode: 'ok', health: 'open', delayMs: 0, seq: 0 };
var sends = [];      // every sendText POST that reached the gateway
var accepted = [];   // sends the gateway accepted (the "phone" view)
var healthChecks = [];
var server = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    if (req.method === 'GET' && /\/instance\/connectionState\//.test(req.url)) {
      healthChecks.push(req.url);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ instance: { instanceName: 'mythos-bridge-test', state: gw.health } }));
      return;
    }
    var body = null;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { body = null; }
    sends.push({ apikey: req.headers.apikey, text: body && body.text });
    if (gw.mode === 'hang') return;   // the client's timeout ends it
    setTimeout(function () {
      if (gw.mode === 'ok') {
        var id = 'EVO-' + (++gw.seq);
        accepted.push({ id: id, text: body && body.text });
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ key: { remoteJid: 'x@s.whatsapp.net', fromMe: true, id: id }, status: 'PENDING', message: { conversation: body && body.text } }));
      } else if (gw.mode === 'reject') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end('{"status":400,"error":"Bad Request","response":{"message":["exists: false"]}}');
      } else {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"status":500,"error":"Internal Server Error","response":{"message":"Connection Closed"}}');
      }
    }, gw.delayMs);
  });
});

// Each section gets its own notification home (ledger + breaker).
function section(name, env) {
  Object.keys(process.env).forEach(function (k) { if (/^MYTHOS_BRIDGE_WHATSAPP_/.test(k)) delete process.env[k]; });
  process.env.MYTHOS_BRIDGE_WHATSAPP_ENABLED = '1';
  process.env.MYTHOS_BRIDGE_WHATSAPP_PROVIDER = 'evolution';
  process.env.MYTHOS_BRIDGE_WHATSAPP_BASE_URL = 'http://127.0.0.1:' + server.address().port;
  process.env.MYTHOS_BRIDGE_WHATSAPP_INSTANCE = 'mythos-bridge-test';
  process.env.MYTHOS_BRIDGE_WHATSAPP_TO = '216000000001';
  process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE = KEY_FILE;
  process.env.MYTHOS_BRIDGE_WHATSAPP_HOME = path.join(FIX, 'notify-' + name);
  process.env.MYTHOS_BRIDGE_WHATSAPP_TIMEOUT_MS = '400';
  process.env.MYTHOS_BRIDGE_WHATSAPP_BACKOFF_MS = '1000';
  process.env.MYTHOS_BRIDGE_WHATSAPP_MAX_ATTEMPTS = '3';
  Object.keys(env || {}).forEach(function (k) { process.env[k] = env[k]; });
  gw.mode = 'ok'; gw.health = 'open'; gw.delayMs = 0;
  sends.length = 0; accepted.length = 0; healthChecks.length = 0;
}
function wa() { delete require.cache[require.resolve(WA)]; return require(WA); }   // a fresh "process" view
function W() { return require(WA); }
function entry(key) { return W().readEntry(W().config(), key); }
function makeDue() {
  var cfg = W().config();
  W().listEntries(cfg).forEach(function (e) {
    if (e.state !== 'PENDING') return;
    e.next_attempt_at = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(path.join(cfg.ledgerDir, e.key + '.json'), JSON.stringify(e, null, 2));
  });
}
function makeDueKey(key) {
  var cfg = W().config();
  var e = W().readEntry(cfg, key);
  e.next_attempt_at = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(path.join(cfg.ledgerDir, key + '.json'), JSON.stringify(e, null, 2));
}
function issueTask(n, title, attempt) {
  return { task_id: 'gh-issue-' + n + (attempt > 1 ? '-r' + attempt : ''), source: { kind: 'github-issue', issue_number: n, issue_title: title } };
}

// ---------------------------------------------------------------- Part 1 — the outbox, real HTTP
function part1() {
  var chain = Promise.resolve();

  // 7 + 8. timeout and 5xx "Connection Closed" (the #461/#464 outage) never exhaust.
  chain = chain.then(function () {
    section('outage', { MYTHOS_BRIDGE_WHATSAPP_BREAKER: 'off' });
    W().onMissionEvent('MISSION_START', issueTask(701, 'Outage mission'));
    gw.mode = 'hang';
    return W().flush().then(function () {
      var e = entry('gh-issue-701__MISSION_START');
      ok(e.state === 'PENDING' && e.provider_failures === 1 && !e.message_failures && /TIMEOUT/.test(e.last_error), '7 provider timeout: stays PENDING, counted as a provider failure');
      gw.mode = 'closed';
      var seq = Promise.resolve();
      for (var i = 0; i < 8; i++) seq = seq.then(function () { makeDue(); return W().flush(); });
      return seq;
    }).then(function () {
      var e = entry('gh-issue-701__MISSION_START');
      ok(e.state === 'PENDING' && e.attempts === 9 && e.provider_failures === 9,
        '8 provider 500 "Connection Closed" x8 after a timeout: 9 attempts > MAX_ATTEMPTS(3) and still PENDING — an outage never exhausts (the gh-issue-461__FAILED loss)');
      ok(Date.parse(e.next_attempt_at) - Date.now() <= 30 * 60 * 1000 + 5000, '8 outage backoff is capped (30 min), so recovery is never pushed out indefinitely');
      // 13 + 14. retry after recovery, then never again.
      gw.mode = 'ok';
      makeDue();
      return W().flush();
    }).then(function () {
      var e = entry('gh-issue-701__MISSION_START');
      var last = e.results[e.results.length - 1].detail[0];
      ok(e.state === 'SENT' && accepted.length === 1 && /^EVO-/.test(last.provider_message_id) && last.provider_status === 'PENDING',
        '13 retry: after the outage the same event is delivered; evidence = provider message id + provider status');
      return W().flush().then(function () { return W().flush(); });
    }).then(function () {
      ok(accepted.length === 1 && sends.filter(function (s) { return /Outage mission/.test(s.text); }).length === 10, '14 no duplicate after retry: a SENT event is never sent again (10 tries, 1 acceptance)');
    });
  });

  // A message the provider REJECTS is still bounded (and does not trip the breaker).
  chain = chain.then(function () {
    section('reject', {});
    W().onMissionEvent('MISSION_START', issueTask(702, 'Rejected mission'));
    gw.mode = 'reject';
    var seq = Promise.resolve();
    for (var i = 0; i < 3; i++) seq = seq.then(function () { makeDue(); return W().flush(); });
    return seq.then(function () {
      var e = entry('gh-issue-702__MISSION_START');
      ok(e.state === 'EXHAUSTED' && e.message_failures === 3, 'bounded: a message the provider REJECTS (4xx) x MAX_ATTEMPTS is EXHAUSTED');
      ok(W().breakerStatus().state === 'closed', 'bounded: rejections say nothing about gateway health — the circuit stays closed');
      var local = W().isMessageFailure({ ok: false, status: null, error: 'CONFIG: recipient is not a digits-only MSISDN or a WhatsApp JID' });
      ok(local === true && W().isProviderFailure({ ok: false, status: null, error: 'CONFIG: empty message' }) === false, 'bounded: a local CONFIG refusal is a message failure, never an outage');
    });
  });

  // 9 + 10 + 18 + #464: breaker open, automatic recovery without waiting the cooldown.
  chain = chain.then(function () {
    section('breaker', { MYTHOS_BRIDGE_WHATSAPP_BREAKER_THRESHOLD: '2', MYTHOS_BRIDGE_WHATSAPP_BREAKER_COOLDOWN_MS: '600000', MYTHOS_BRIDGE_WHATSAPP_HEALTH_INTERVAL_MS: '1000' });
    W().onMissionEvent('MISSION_START', issueTask(464, 'V3.2.9 — WhatsApp E2E smoke test'));
    W().onMissionEvent('MISSION_START', issueTask(465, 'Second mission'));
    W().onMissionEvent('MISSION_START', issueTask(466, 'Third mission'));
    gw.mode = 'closed'; gw.health = 'close';
    return W().flush().then(function () {
      ok(W().breakerStatus().state === 'open' && sends.length === 2, '9 breaker: two outage failures open the circuit (10-minute cooldown here)');
      var before = sends.length;
      return W().flush().then(function (r) {
        ok(sends.length === before && r.skipped === 'provider circuit breaker is open', '9 breaker open: zero sends');
        ok(healthChecks.length === 0, '9 breaker open: health checks are rate-limited (none within the first interval after opening)');
        return wait(1100);
      });
    }).then(function () {
      return W().flush();   // gateway still disconnected
    }).then(function (r) {
      ok(healthChecks.length === 1 && W().breakerStatus().state === 'open' && W().breakerStatus().last_health_state === 'close' && r.attempted === 0,
        '9 breaker open: a read-only health check that says "close" keeps it open and sends nothing');
      // The owner re-pairs WhatsApp: the session is connected again.
      gw.mode = 'ok'; gw.health = 'open';
      return wait(1100).then(function () { return W().flush(); });
    }).then(function (r) {
      var st = W().breakerStatus();
      ok(r.probe === true && st.state === 'closed', '10 recovery: connected gateway → half-open NOW (cooldown not waited out) → probe accepted → circuit closed');
      ok(['gh-issue-464', 'gh-issue-465', 'gh-issue-466'].every(function (m) { return entry(m + '__MISSION_START').state === 'SENT'; }) && accepted.length === 3,
        '18 + #464: every pending event is flushed in the SAME flush as the successful probe — no human step, no resetBreaker');
    });
  });

  // Recovery must not wait for each entry's own OUTAGE backoff (production
  // backoff: 60 s doubling to 30 min). Found while preparing the real E2E:
  // with a 1 s test backoff the gap was invisible.
  chain = chain.then(function () {
    section('recovery-backoff', { MYTHOS_BRIDGE_WHATSAPP_BACKOFF_MS: '60000', MYTHOS_BRIDGE_WHATSAPP_BREAKER_THRESHOLD: '3',
      MYTHOS_BRIDGE_WHATSAPP_BREAKER_COOLDOWN_MS: '600000', MYTHOS_BRIDGE_WHATSAPP_HEALTH_INTERVAL_MS: '1000' });
    W().onMissionEvent('MISSION_START', issueTask(790, 'Backoff mission'));
    W().onMissionEvent('MISSION_START', issueTask(791, 'Rejected earlier'));
    gw.mode = 'reject';
    return W().flush().then(function () {        // 791 and 790 both rejected once (4xx: message class)
      var cfg = W().config();
      var e790 = entry('gh-issue-790__MISSION_START');
      // 790 then suffers an outage three times (provider class) and opens the circuit.
      e790.message_failures = 0; e790.last_failure_class = null;
      fs.writeFileSync(path.join(cfg.ledgerDir, e790.key + '.json'), JSON.stringify(e790, null, 2));
      gw.mode = 'closed';
      var seq = Promise.resolve();
      for (var i = 0; i < 3; i++) seq = seq.then(function () { makeDueKey('gh-issue-790__MISSION_START'); return W().flush(); });
      return seq;
    }).then(function () {
      var e790 = entry('gh-issue-790__MISSION_START');
      var e791 = entry('gh-issue-791__MISSION_START');
      ok(W().breakerStatus().state === 'open' && e790.last_failure_class === 'provider' && Date.parse(e790.next_attempt_at) - Date.now() > 60000,
        'recovery/backoff: after 3 outage failures the circuit is open and the entry is backing off for minutes');
      ok(e791.last_failure_class === 'message' && Date.parse(e791.next_attempt_at) > Date.now(), 'recovery/backoff: a rejected entry is backing off from a MESSAGE failure');
      gw.mode = 'ok'; gw.health = 'open';
      return wait(1100).then(function () { return W().flush(); });
    }).then(function (r) {
      ok(r.probe === true && entry('gh-issue-790__MISSION_START').state === 'SENT' && W().breakerStatus().state === 'closed',
        'recovery/backoff: the recovered gateway delivers the outage-delayed entry NOW, not after its own multi-minute backoff');
      ok(entry('gh-issue-791__MISSION_START').state === 'PENDING', 'recovery/backoff: an entry backing off from a message REJECTION keeps its schedule');
    });
  });

  // Health says connected but the send still fails: the probe decides.
  chain = chain.then(function () {
    section('lying-health', { MYTHOS_BRIDGE_WHATSAPP_BREAKER_THRESHOLD: '1', MYTHOS_BRIDGE_WHATSAPP_BREAKER_COOLDOWN_MS: '600000', MYTHOS_BRIDGE_WHATSAPP_HEALTH_INTERVAL_MS: '1000' });
    W().onMissionEvent('MISSION_START', issueTask(467, 'A'));
    W().onMissionEvent('MISSION_START', issueTask(468, 'B'));
    gw.mode = 'closed';
    return W().flush().then(function () { return wait(1100); }).then(function () {
      gw.health = 'open';   // says connected…
      return W().flush();   // …but sends still fail
    }).then(function () {
      ok(sends.length === 2 && W().breakerStatus().state === 'open', 'recovery: a connected-looking gateway whose probe fails re-opens the circuit; only ONE probe is spent');
      ok(entry('gh-issue-467__MISSION_START').state === 'PENDING' && entry('gh-issue-468__MISSION_START').state === 'PENDING', 'recovery: nothing is marked delivered by a health answer alone');
    });
  });

  // 11. restart with a PENDING event: a fresh process delivers it.
  chain = chain.then(function () {
    section('restart', { MYTHOS_BRIDGE_WHATSAPP_BREAKER: 'off' });
    W().onMissionEvent('MISSION_SUCCESS', issueTask(711, 'Restarted mission'));
    gw.mode = 'closed';
    return W().flush().then(function () {
      gw.mode = 'ok';
      makeDue();
      return wa().flush();   // module reloaded from disk: a restarted bridge
    }).then(function () {
      ok(entry('gh-issue-711__MISSION_SUCCESS').state === 'SENT' && accepted.length === 1, '11 restart: a PENDING event survives the restart and is delivered by the next process');
    });
  });

  // 12. a REAL crash during SENDING (SIGKILL of a flushing process).
  chain = chain.then(function () {
    section('crash', { MYTHOS_BRIDGE_WHATSAPP_BREAKER: 'off', MYTHOS_BRIDGE_WHATSAPP_LEASE_MS: '10000', MYTHOS_BRIDGE_WHATSAPP_TIMEOUT_MS: '8000' });
    W().onMissionEvent('MISSION_STOP', issueTask(712, 'Crashed mission'));
    gw.mode = 'hang';
    var child = cp.spawn(process.execPath, ['-e', 'require(' + JSON.stringify(WA) + ').flush().then(function(){})'], { env: process.env, stdio: 'ignore' });
    var t0 = Date.now();
    return (function poll() {
      return (sends.length ? Promise.resolve() : (Date.now() - t0 > 8000 ? Promise.resolve() : wait(50).then(poll)));
    })().then(function () {
      child.kill('SIGKILL');
      return wait(200);
    }).then(function () {
      var e = entry('gh-issue-712__MISSION_STOP');
      ok(e.state === 'SENDING' && e.sending_pid === child.pid, '12 crash: the killed process left the event SENDING (its claim is on disk)');
      gw.mode = 'ok';
      return W().flush().then(function () {
        ok(entry('gh-issue-712__MISSION_STOP').state === 'SENDING', '12 crash: within the lease the claim is respected (no concurrent resend)');
        return wait(10200);
      });
    }).then(function () {
      return W().flush();
    }).then(function (r) {
      var e = entry('gh-issue-712__MISSION_STOP');
      ok(r.reclaimed === 1 && e.state === 'SENT' && !e.message_failures, '12 crash: after the lease the event is reclaimed (never EXHAUSTED) and delivered');
      ok(accepted.length === 1, '12 crash: delivered exactly once to the phone (the killed attempt never got an answer)');
    });
  });

  // 5 + 6. duplicate flush — in one process and across two PROCESSES at once.
  chain = chain.then(function () {
    section('dupflush', { MYTHOS_BRIDGE_WHATSAPP_BREAKER: 'off', MYTHOS_BRIDGE_WHATSAPP_FLUSH_LIMIT: '20' });
    for (var n = 720; n < 730; n++) W().onMissionEvent('MISSION_START', issueTask(n, 'Concurrent ' + n));
    gw.delayMs = 150;
    return Promise.all([W().flush(), W().flush()]).then(function () {
      ok(accepted.length === 10 && sends.length === 10, '6 duplicate flush (same process, concurrent): 10 events → exactly 10 sends');
      for (var n2 = 730; n2 < 740; n2++) W().onMissionEvent('MISSION_START', issueTask(n2, 'Cross-process ' + n2));
      var code = 'require(' + JSON.stringify(WA) + ').flush().then(function(){process.exit(0)})';
      var a = cp.spawn(process.execPath, ['-e', code], { env: process.env, stdio: 'ignore' });
      var b = cp.spawn(process.execPath, ['-e', code], { env: process.env, stdio: 'ignore' });
      return Promise.all([a, b].map(function (c) { return new Promise(function (r) { c.on('exit', r); }); }));
    }).then(function () {
      var cross = accepted.filter(function (x) { return /Cross-process/.test(x.text); });
      var texts = cross.map(function (x) { return x.text; });
      ok(cross.length === 10 && new Set(texts).size === 10, '6 duplicate flush (two processes at once): 10 events → exactly 10 sends, no duplicate');
    });
  });

  // 16 + 17. many missions at once, and per-mission order.
  chain = chain.then(function () {
    section('order', { MYTHOS_BRIDGE_WHATSAPP_BREAKER: 'off', MYTHOS_BRIDGE_WHATSAPP_FLUSH_LIMIT: '20' });
    W().onMissionEvent('MISSION_START', issueTask(750, 'Ordered mission'));
    gw.mode = 'closed';
    return W().flush().then(function () {   // START fails, backs off
      W().onMissionEvent('MISSION_SUCCESS', issueTask(750, 'Ordered mission'));
      gw.mode = 'ok';
      return W().flush();   // SUCCESS is due, START is not
    }).then(function () {
      ok(entry('gh-issue-750__MISSION_SUCCESS').state === 'PENDING' && accepted.length === 0, '17 ordering: SUCCESS never overtakes a START that is still backing off');
      makeDue();
      return W().flush();
    }).then(function () {
      ok(accepted.length === 2 && /^🟢/.test(accepted[0].text) && /^✅/.test(accepted[1].text), '17 ordering: once START is due, START then SUCCESS, in that order');
      accepted.length = 0;
      for (var n = 760; n < 768; n++) { W().onMissionEvent('MISSION_START', issueTask(n, 'Parallel ' + n)); W().onMissionEvent('MISSION_SUCCESS', issueTask(n, 'Parallel ' + n)); }
      return W().flush().then(function () { return W().flush(); });
    }).then(function () {
      var ok16 = true;
      for (var n3 = 760; n3 < 768; n3++) {
        var i1 = accepted.findIndex(function (x) { return x.text === '🟢 بدأ العمل: Parallel ' + n3; });
        var i2 = accepted.findIndex(function (x) { return x.text === '✅ اكتمل العمل: Parallel ' + n3; });
        if (i1 === -1 || i2 === -1 || i1 > i2) ok16 = false;
      }
      ok(ok16 && accepted.length === 16, '16 eight simultaneous missions: 16 events delivered, each mission START before SUCCESS');
    });
  });

  // Mission identity: a rerun is the same mission.
  chain = chain.then(function () {
    section('identity', { MYTHOS_BRIDGE_WHATSAPP_BREAKER: 'off' });
    ok(W().missionIdOf({ task_id: 'gh-issue-461-r2' }) === 'gh-issue-461' && W().missionIdOf({ task_id: 'gh-issue-461' }) === 'gh-issue-461', 'identity: gh-issue-N and its reruns share one mission id');
    var a = W().onMissionEvent('MISSION_START', issueTask(461, 'V3.2.5', 1));
    var b = W().onMissionEvent('MISSION_START', issueTask(461, 'V3.2.5', 2));
    var c = W().onMissionEvent('MISSION_STOP', issueTask(461, 'V3.2.5', 1));
    var d = W().onMissionEvent('MISSION_STOP', issueTask(461, 'V3.2.5', 3));
    ok(a.queued && !b.queued && /already in the ledger/.test(b.skipped) && c.queued && !d.queued, 'identity: a rerun never queues a second START or STOP for the same mission');
    ok(entry('gh-issue-461__MISSION_START').task_id === 'gh-issue-461' && entry('gh-issue-461__MISSION_START').mission_id === 'gh-issue-461', 'identity: the entry records mission id and attempt id');
    return W().flush().then(function () {
      ok(accepted.length === 2, 'identity: START once, STOP once');
    });
  });

  // Bounded pending: EXPIRED, never sent late.
  chain = chain.then(function () {
    section('expiry', { MYTHOS_BRIDGE_WHATSAPP_BREAKER: 'off', MYTHOS_BRIDGE_WHATSAPP_MAX_AGE_HOURS: '1' });
    W().onMissionEvent('MISSION_START', issueTask(770, 'Old mission'));
    var cfg = W().config();
    var e = entry('gh-issue-770__MISSION_START');
    e.created_at = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    fs.writeFileSync(path.join(cfg.ledgerDir, e.key + '.json'), JSON.stringify(e, null, 2));
    return W().flush().then(function (r) {
      ok(r.expired === 1 && entry('gh-issue-770__MISSION_START').state === 'EXPIRED' && sends.length === 0, 'expiry: an event older than MAX_AGE is EXPIRED (visible), never sent late — PENDING is never forever');
      ok(W().ledgerStatus().counts.EXPIRED === 1, 'expiry: notify-status counts EXPIRED');
    });
  });

  return chain;
}

// ---------------------------------------------------------------- Part 2 — real bridge ticks
function part2() {
  section('bridge', { MYTHOS_BRIDGE_WHATSAPP_BREAKER_THRESHOLD: '2', MYTHOS_BRIDGE_WHATSAPP_BREAKER_COOLDOWN_MS: '600000', MYTHOS_BRIDGE_WHATSAPP_HEALTH_INTERVAL_MS: '1000' });
  var executor = require(path.join(EXEC, 'executor'));
  var bridge = require(path.join(EXEC, 'bridge', 'github-bridge'));
  var ORIGIN = path.join(FIX, 'origin.git'), REPO = path.join(FIX, 'repo'), PLANNER = path.join(FIX, 'planner');
  git(FIX, ['init', '--bare', '-q', '-b', 'main', ORIGIN]);
  git(FIX, ['clone', '-q', ORIGIN, REPO]);
  fs.writeFileSync(path.join(REPO, 'README.md'), '# fixture\n');
  git(REPO, ['add', 'README.md']); git(REPO, ['commit', '-q', '-m', 'init']); git(REPO, ['push', '-q', 'origin', 'main']);
  git(FIX, ['clone', '-q', ORIGIN, PLANNER]);
  var cfgB = bridge.config();
  bridge.init();
  function relay() { git(REPO, ['push', '-q', 'origin', 'refs/heads/mythos/control:refs/heads/mythos/control']); }
  relay();
  function plannerWrite(task) {
    git(PLANNER, ['fetch', '-q', 'origin', 'mythos/control']);
    var has = cp.spawnSync('git', ['rev-parse', '--verify', '-q', 'mythos/control'], { cwd: PLANNER }).status === 0;
    git(PLANNER, has ? ['checkout', '-q', 'mythos/control'] : ['checkout', '-q', '-b', 'mythos/control', 'origin/mythos/control']);
    if (has) git(PLANNER, ['reset', '-q', '--hard', 'origin/mythos/control']);
    var f = path.join(PLANNER, 'control', 'tasks', task.task_id + '.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(task, null, 2) + '\n');
    git(PLANNER, ['add', '--', 'control/tasks/' + task.task_id + '.json']);
    git(PLANNER, ['commit', '-q', '-m', 'planner: ' + task.task_id]);
    git(PLANNER, ['push', '-q', 'origin', 'mythos/control']);
  }
  function mk(n, title) {
    return { protocol: 'mythos-control/1', task_id: 'gh-issue-' + n, project: 'executor-selftest',
      objective: 'Inspect the fixture repository and report its HEAD commit.', scope: ['README.md'], constraints: ['read-only'],
      priority: 'normal', requested_action: 'investigate', validation_requirements: ['git rev-parse HEAD'], status: 'PENDING',
      created_at: '2026-09-25T18:00:00.000Z', created_by: 'durable-test',
      source: { kind: 'github-issue', repo: 'othoth77/mythos-prod', issue_number: n, issue_url: 'https://github.com/othoth77/mythos-prod/issues/' + n, issue_title: title } };
  }
  function taskOnDisk(id) { return JSON.parse(fs.readFileSync(path.join(cfgB.controlDir, 'control', 'tasks', id + '.json'), 'utf8')); }

  // Three missions: one succeeds, one fails, one is blocked. The gateway is
  // DOWN for the whole lifecycle (the #464 outage), then comes back.
  gw.mode = 'closed'; gw.health = 'close';
  plannerWrite(mk(801, 'Durable mission succeeds'));
  plannerWrite(mk(802, 'Durable mission fails'));
  var t1 = bridge.tick(executor);
  ok(t1.ok === true, 'bridge tick 1 ok');
  var e801 = entry('gh-issue-801__MISSION_START'), e802 = entry('gh-issue-802__MISSION_START');
  ok(e801 && e801.state === 'PENDING' && e802 && e802.state === 'PENDING', '1 START persisted: a real claim writes a durable PENDING START before any send');
  ok(taskOnDisk('gh-issue-801').status === 'CLAIMED' && taskOnDisk('gh-issue-802').status === 'CLAIMED', '15 isolation: both missions CLAIMED although the gateway is down');
  relay();
  return bridge.flushNotifications().then(function () {
    ok(W().breakerStatus().state === 'open', 'bridge: the outage opens the circuit');
    process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'success', summary: 'ok run' }, { kind: 'fatal', summary: 'controlled failure' }]);
    return executor.tick().then(function () { return executor.tick(); });
  }).then(function () {
    var t2 = bridge.tick(executor);
    ok(t2.ok === true, 'bridge tick 2 ok');
    ok(taskOnDisk('gh-issue-801').status === 'COMPLETED' && taskOnDisk('gh-issue-802').status === 'FAILED', '15 isolation: mission outcomes are exactly the executor\'s (COMPLETED / FAILED) with WhatsApp down');
    ok(entry('gh-issue-801__MISSION_SUCCESS').state === 'PENDING' && entry('gh-issue-802__MISSION_STOP').state === 'PENDING', 'SUCCESS and STOP persisted during the outage');
    relay();
    var t3 = bridge.tick(executor);
    var dupKeys = W().listEntries(W().config()).filter(function (e) { return /gh-issue-80[12]__MISSION/.test(e.key); }).length;
    ok(t3.ok === true && dupKeys === 4, '5 duplicate tick: another tick creates no second lifecycle entry');
    relay();
    return bridge.flushNotifications();
  }).then(function () {
    ok(accepted.length === 0, 'nothing reaches the phone while the gateway is down');
    // The owner re-pairs WhatsApp. No reset, no rerun, no manual send.
    gw.mode = 'ok'; gw.health = 'open';
    return wait(1100).then(function () { return bridge.flushNotifications(); }).then(function () { return bridge.flushNotifications(); });
  }).then(function () {
    var byText = accepted.map(function (x) { return x.text; });
    ok(byText.indexOf('🟢 بدأ العمل: Durable mission succeeds') !== -1, '2 START delivered (after recovery, automatically)');
    ok(byText.indexOf('✅ اكتمل العمل: Durable mission succeeds') !== -1, '3 SUCCESS delivered');
    ok(byText.indexOf('🔴 توقف العمل: Durable mission fails — مشكلة') !== -1, '4 STOP/FAILURE delivered');
    ok(byText.indexOf('🟢 بدأ العمل: Durable mission succeeds') < byText.indexOf('✅ اكتمل العمل: Durable mission succeeds') &&
       byText.indexOf('🟢 بدأ العمل: Durable mission fails') < byText.indexOf('🔴 توقف العمل: Durable mission fails — مشكلة'), '17 per-mission order held across the outage');
    ['gh-issue-801__MISSION_START', 'gh-issue-801__MISSION_SUCCESS', 'gh-issue-802__MISSION_START', 'gh-issue-802__MISSION_STOP'].forEach(function (k) {
      var e = entry(k);
      ok(e.state === 'SENT' && e.results.some(function (r) { return r.detail.some(function (d) { return /^EVO-/.test(d.provider_message_id); }); }), 'ledger ' + k + ' = SENT with the provider message id');
    });
    ok(taskOnDisk('gh-issue-801').status === 'COMPLETED' && taskOnDisk('gh-issue-802').status === 'FAILED', '15 isolation: delivery changed no mission state');
    var countBefore = accepted.length;
    return bridge.flushNotifications().then(function () {
      ok(accepted.length === countBefore, 'no duplicate: a further flush sends nothing');
    });
  }).then(function () {
    // Notification store unwritable: the claim must still succeed.
    var home = W().config().home;
    fs.chmodSync(path.join(home, 'ledger'), 0o500);
    plannerWrite(mk(803, 'Mission with a broken notification store'));
    var t4 = bridge.tick(executor);
    fs.chmodSync(path.join(home, 'ledger'), 0o700);
    ok(t4.ok === true && taskOnDisk('gh-issue-803').status === 'CLAIMED', '15 isolation: an unwritable notification ledger never fails a claim');
    relay();
    // Next project/task is unaffected: another mission is claimed normally.
    plannerWrite(mk(804, 'Next mission'));
    var t5 = bridge.tick(executor);
    ok(t5.ok === true && taskOnDisk('gh-issue-804').status === 'CLAIMED', '15 isolation: the next mission is claimed normally');
  });
}

server.listen(0, '127.0.0.1', function () {
  part1().then(part2).catch(function (e) { failed++; console.error('FAIL: exception ' + (e && e.stack || e)); }).then(function () {
    server.close();
    try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    console.log('whatsapp durable outbox tests: ' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
});
