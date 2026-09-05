'use strict';
// =====================================================
// MYTHOS — GitHub bridge WhatsApp notification tests
// tests/mythos-bridge-whatsapp-notify-test.js
//
// Offline and deterministic. NO real WhatsApp message is ever sent: the
// Evolution API is stood in for by a local http server on 127.0.0.1 that
// records every request it receives. That is deliberately a REAL server and
// the REAL adapter — the HTTP path, the auth header, the URL shape and the
// request body are all exercised, only the far end is a fixture.
//
// The one controlled real message of this stage is `mythos-github-bridge
// notify-test --confirm`, invoked by a human, never from here.
//
// Fixtures never live under /tmp (the task schema refuses it).
// Run with: node tests/mythos-bridge-whatsapp-notify-test.js
// =====================================================
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIX = path.join(os.homedir(), 'mythos-wa-notify-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true });

// The credential used throughout. It must never appear anywhere except in
// the apikey header the fake gateway receives — section 8 proves that.
var API_KEY = 'evo-test-apikey-Zx91nQv7RtL2';
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

// WhatsApp: deliberately NOT enabled yet — section 1 proves the default.
delete process.env.MYTHOS_BRIDGE_WHATSAPP_ENABLED;
// The provider circuit breaker is OFF for this suite, on purpose. Several
// sections here deliberately drive the gateway into repeated 5xx/timeout
// failures to prove the retry, backoff, exhaustion and reclaim paths — which
// is precisely the condition the breaker exists to short-circuit, so leaving
// it on would make this suite test the breaker instead of what it is for.
// The breaker's own behaviour is proven in
// tests/mythos-bridge-whatsapp-resilience-test.js.
process.env.MYTHOS_BRIDGE_WHATSAPP_BREAKER = 'off';
delete process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY;
process.env.MYTHOS_BRIDGE_WHATSAPP_HOME = path.join(FIX, 'home', 'bridge', 'notify');

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
// `status` drives the next response; `failFor` fails only that recipient;
// `delayFor` = { to, ms } holds the response to one recipient open so a
// test can observe ledger state while a sibling recipient's request is
// still in flight (the crash-window regression, section 13).
var gateway = { status: 200, body: '{"key":{"id":"MOCK-MSG-1"},"status":"PENDING"}', failFor: null, delayFor: null };

var server = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    var raw = Buffer.concat(chunks).toString('utf8');
    var body = null;
    try { body = JSON.parse(raw); } catch (e) { /* recorded as null */ }
    received.push({ method: req.method, url: req.url, apikey: req.headers.apikey || null, contentType: req.headers['content-type'] || null, body: body });
    var respond = function () {
      var failThis = gateway.status !== 200 || (gateway.failFor && body && body.number === gateway.failFor);
      if (failThis) {
        res.writeHead(gateway.status === 200 ? 500 : gateway.status, { 'content-type': 'application/json' });
        res.end('{"error":"fixture refused this message"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(gateway.body);
    };
    if (gateway.delayFor && body && body.number === gateway.delayFor.to) {
      setTimeout(respond, gateway.delayFor.ms);
    } else {
      respond();
    }
  });
});

function ledgerDir() { return whatsapp.config().ledgerDir; }
function entriesByKey() {
  var m = {};
  whatsapp.listEntries(whatsapp.config()).forEach(function (e) { m[e.key] = e; });
  return m;
}
function resetGateway() { received.length = 0; gateway.status = 200; gateway.failFor = null; gateway.delayFor = null; }

// A REPORT exactly as buildReport() produces one.
function mkReport(id, status, over) {
  var r = {
    protocol: 'mythos-control/1', task_id: id, status: status,
    summary: 'The agent did the work and reported it.',
    files_changed: ['a.js'], commits: [], tests: ['unit: pass'],
    validation: { git_verified: true, remote_head: null, report_problems: [], required_checks: [] },
    problems: [], risks: [], next_recommended_action: 'review this report',
    completed_at: new Date().toISOString(),
    execution: { executor_task_id: 'x', othmode_task_id: 'OTH-2026-00001', branch: 'mythos/gh/' + id },
    delivery: { branch: 'mythos/gh/' + id, commits_on_origin: null, note: 'n' }
  };
  Object.keys(over || {}).forEach(function (k) { r[k] = over[k]; });
  return r;
}

function run() {
  var PORT = server.address().port;
  var BASE_URL = 'http://127.0.0.1:' + PORT;

  // ================================================================
  // 1. Disabled by default
  // ================================================================
  var d0 = whatsapp.describe();
  ok(d0.enabled === false, 'default: WhatsApp notifications are disabled when nothing is configured');
  var off = whatsapp.onReport(mkReport('gh-wa-off-0001', 'COMPLETED'), {});
  ok(off.queued === false && /disabled/.test(off.skipped), 'default: a COMPLETED report queues nothing while disabled');
  ok(!fs.existsSync(ledgerDir()), 'default: disabled leaves no ledger on disk at all');

  return Promise.resolve()
    .then(function () { return whatsapp.flush(); })
    .then(function (f0) {
      ok(f0.ok === true && f0.enabled === false && f0.attempted === 0, 'default: flush is a no-op while disabled');
      ok(received.length === 0, 'default: no request reached the gateway');

      // ================================================================
      // 2. Configuration, readiness and the private-network rule
      // ================================================================
      ok(whatsapp.isPrivateHost('127.0.0.1') && whatsapp.isPrivateHost('localhost') &&
        whatsapp.isPrivateHost('10.1.2.3') && whatsapp.isPrivateHost('172.20.0.5') &&
        whatsapp.isPrivateHost('192.168.1.9') && whatsapp.isPrivateHost('evolution-api'),
      'network: loopback, RFC1918 and single-label container names are private');
      ok(!whatsapp.isPrivateHost('api.example.com') && !whatsapp.isPrivateHost('8.8.8.8') && !whatsapp.isPrivateHost('172.32.0.1'),
        'network: public hostnames and public IPs are not private');

      process.env.MYTHOS_BRIDGE_WHATSAPP_ENABLED = '1';
      process.env.MYTHOS_BRIDGE_WHATSAPP_PROVIDER = 'evolution';
      process.env.MYTHOS_BRIDGE_WHATSAPP_INSTANCE = 'mythos-bridge';
      process.env.MYTHOS_BRIDGE_WHATSAPP_TO = '21620000000';
      process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE = KEY_FILE;
      process.env.MYTHOS_BRIDGE_WHATSAPP_BASE_URL = 'https://public-gateway.example.com';
      var dPublic = whatsapp.describe();
      ok(dPublic.problems.some(function (p) { return /not private/.test(p); }), 'network: a public base url is refused unless ALLOW_PUBLIC=1');
      var pubTry = whatsapp.onReport(mkReport('gh-wa-pub-0001', 'COMPLETED'), {});
      ok(pubTry.queued === false && pubTry.skipped === 'not configured', 'network: nothing is queued while the configuration is refused');

      process.env.MYTHOS_BRIDGE_WHATSAPP_BASE_URL = BASE_URL;
      var dOk = whatsapp.describe();
      ok(dOk.enabled === true && dOk.problems.length === 0, 'config: a complete private configuration is ready');
      ok(dOk.credential_present === true && dOk.credential_source === 'file', 'config: credential is read from the 0600 file');
      ok(JSON.stringify(dOk).indexOf(API_KEY) === -1, 'config: notify-config output never contains the credential');
      ok(JSON.stringify(dOk).indexOf('21620000000') === -1 && dOk.recipients_configured === 1, 'config: recipients are counted, never printed');
      ok(dOk.kinds.join(',') === 'COMPLETED,FAILED,BLOCKED,HUMAN_APPROVAL', 'config: exactly the four notifying kinds by default');

      // Missing credential is a readiness problem, not a crash.
      var savedKeyFile = process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE;
      process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE = path.join(FIX, 'no-such.key');
      ok(whatsapp.describe().problems.some(function (p) { return /no credential/.test(p); }), 'config: a missing credential file is reported, not thrown');
      process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE = savedKeyFile;

      // ================================================================
      // 3. Which states notify (and which must not)
      // ================================================================
      ok(whatsapp.notificationKind('COMPLETED') === 'COMPLETED', 'kinds: COMPLETED notifies');
      ok(whatsapp.notificationKind('FAILED') === 'FAILED', 'kinds: FAILED notifies');
      ok(whatsapp.notificationKind('BLOCKED') === 'BLOCKED', 'kinds: BLOCKED notifies');
      ok(whatsapp.notificationKind('BLOCKED', { human_approval: true }) === 'HUMAN_APPROVAL', 'kinds: a blocked-for-a-human report notifies as HUMAN_APPROVAL');
      ok(whatsapp.notificationKind('CANCELLED') === null, 'kinds: CANCELLED never notifies (it was the human\'s own action)');
      ['PENDING', 'CLAIMED', 'IN_PROGRESS', 'VALIDATING', 'QUEUED', 'RUNNING'].forEach(function (s) {
        ok(whatsapp.notificationKind(s) === null, 'kinds: non-terminal ' + s + ' never notifies');
      });
      resetGateway();
      ['PENDING', 'CLAIMED', 'IN_PROGRESS', 'VALIDATING', 'CANCELLED'].forEach(function (s) {
        whatsapp.onReport(mkReport('gh-wa-nonterm-01', s), {});
      });
      ok(Object.keys(entriesByKey()).length === 0, 'kinds: non-terminal and cancelled reports produce no ledger entry');

      // ================================================================
      // 4. The four notifying kinds, delivered through the real adapter
      // ================================================================
      resetGateway();
      var cases = [
        { id: 'gh-wa-done-0001', status: 'COMPLETED', opts: {}, kind: 'COMPLETED' },
        { id: 'gh-wa-fail-0001', status: 'FAILED', opts: {}, kind: 'FAILED' },
        { id: 'gh-wa-blok-0001', status: 'BLOCKED', opts: {}, kind: 'BLOCKED' },
        { id: 'gh-wa-appr-0001', status: 'BLOCKED', opts: { human_approval: true }, kind: 'HUMAN_APPROVAL' }
      ];
      cases.forEach(function (c) {
        var res = whatsapp.onReport(mkReport(c.id, c.status), c.opts);
        ok(res.queued === true && res.kind === c.kind, 'notify: ' + c.status + (c.opts.human_approval ? ' (human)' : '') + ' queues as ' + c.kind);
      });
      return whatsapp.flush().then(function (f) {
        ok(f.sent === 4 && f.failed === 0, 'notify: all four notifications delivered in one flush');
        ok(received.length === 4, 'notify: exactly four requests reached the gateway');
        ok(received.every(function (r) { return r.method === 'POST' && r.url === '/message/sendText/mythos-bridge'; }),
          'notify: Evolution endpoint shape POST /message/sendText/{instance}');
        ok(received.every(function (r) { return r.apikey === API_KEY; }), 'notify: the apikey header carries the credential');
        ok(received.every(function (r) { return r.body && r.body.number === '21620000000' && typeof r.body.text === 'string'; }),
          'notify: v2 body shape { number, text }');
        cases.forEach(function (c) {
          var msg = received.filter(function (r) { return r.body.text.indexOf(c.id) !== -1; })[0];
          ok(!!msg && msg.body.text.indexOf('MYTHOS ' + c.kind) !== -1, 'notify: the ' + c.kind + ' message names the kind and the task');
          ok(!!msg && msg.body.text.indexOf('control/reports/' + c.id + '.md') !== -1, 'notify: the ' + c.kind + ' message points at the REPORT on the control branch');
          // gh-issue-191: shared presenter — simple Arabic explanation + explicit "what you must do", no technical detail lines.
          ok(!!msg && msg.body.text.indexOf('ببساطة: ') !== -1 && msg.body.text.indexOf('المطلوب منك: ') !== -1, 'notify: the ' + c.kind + ' message carries the simple Arabic explanation and the owner action');
          ok(!!msg && !/^(Branch|Files changed|OTHMODE|Commits): /m.test(msg.body.text), 'notify: the ' + c.kind + ' message carries no branch/file/commit/OTHMODE detail lines');
          ok(!!msg && msg.body.text.indexOf(c.kind === 'COMPLETED' ? '🟢' : c.kind === 'HUMAN_APPROVAL' ? '🟠' : '🔴') === 0, 'notify: the ' + c.kind + ' message starts with its level icon');
        });
        var appr = received.filter(function (r) { return r.body.text.indexOf('gh-wa-appr-0001') !== -1; })[0];
        ok(appr.body.text.indexOf('قرارك مطلوب') !== -1 && appr.body.text.indexOf('بانتظار قرارك') !== -1, 'notify: the HUMAN_APPROVAL message says a human decision is required');
        var led = entriesByKey();
        ok(led['gh-wa-done-0001__COMPLETED'].state === 'SENT' && led['gh-wa-appr-0001__HUMAN_APPROVAL'].state === 'SENT',
          'notify: the ledger records SENT for delivered notifications');
        ok(led['gh-wa-done-0001__COMPLETED'].results[0].detail[0].provider_message_id === 'MOCK-MSG-1',
          'notify: the provider message id is kept as delivery evidence');

        // The v1 body shape is reachable for an older Evolution deployment.
        resetGateway();
        process.env.MYTHOS_BRIDGE_WHATSAPP_API_VERSION = 'v1';
        whatsapp.onReport(mkReport('gh-wa-vone-0001', 'COMPLETED'), {});
        return whatsapp.flush();
      });
    })
    .then(function () {
      ok(received.length === 1 && received[0].body.textMessage && typeof received[0].body.textMessage.text === 'string' && received[0].body.text === undefined,
        'notify: apiVersion=v1 switches to the { number, textMessage:{ text } } body');
      delete process.env.MYTHOS_BRIDGE_WHATSAPP_API_VERSION;

      // ================================================================
      // 5. Idempotency — duplicate polling and repeated flushes
      // ================================================================
      resetGateway();
      var rep = mkReport('gh-wa-idem-0001', 'COMPLETED');
      var q1 = whatsapp.onReport(rep, {});
      var q2 = whatsapp.onReport(rep, {});
      var q3 = whatsapp.onReport(rep, {});
      ok(q1.queued === true && q2.queued === false && q3.queued === false, 'idempotency: repeated bridge polling queues the notification once');
      ok(/already in the ledger/.test(q2.skipped), 'idempotency: the second enqueue says the ledger already has it');
      var files = fs.readdirSync(ledgerDir()).filter(function (n) { return /^gh-wa-idem-0001__/.test(n); });
      ok(files.length === 1 && files[0] === 'gh-wa-idem-0001__COMPLETED.json', 'idempotency: exactly one ledger file, keyed by task + kind');
      return whatsapp.flush()
        .then(function () { return whatsapp.flush(); })
        .then(function () { return whatsapp.flush(); })
        .then(function () {
          ok(received.length === 1, 'idempotency: three flushes produce exactly one delivered message');
          // Re-reporting the same terminal state (the bridge rewriting a
          // report after the relay confirmed delivery) must not re-notify.
          var again = whatsapp.onReport(mkReport('gh-wa-idem-0001', 'COMPLETED'), {});
          ok(again.queued === false && again.state === 'SENT', 'idempotency: a re-written REPORT for an already-sent task notifies nothing');
          return whatsapp.flush();
        })
        .then(function () { ok(received.length === 1, 'idempotency: still exactly one message after re-reporting'); });
    })
    .then(function () {
      // ================================================================
      // 6. Concurrency — parallel in-process flushes AND parallel processes
      // ================================================================
      resetGateway();
      whatsapp.onReport(mkReport('gh-wa-conc-0001', 'COMPLETED'), {});
      return Promise.all([whatsapp.flush(), whatsapp.flush(), whatsapp.flush(), whatsapp.flush()])
        .then(function (all) {
          ok(received.length === 1, 'concurrency: four parallel flushes in one process send exactly one message');
          ok(all.reduce(function (n, r) { return n + (r.sent || 0); }, 0) === 1, 'concurrency: exactly one flush reports the send');

          // Real concurrent OS processes, the case the bridge timer can
          // actually produce (a tick racing a manual notify-flush).
          resetGateway();
          whatsapp.onReport(mkReport('gh-wa-proc-0001', 'COMPLETED'), {});
          var child = path.join(FIX, 'flush-child.js');
          fs.writeFileSync(child,
            "var w = require(" + JSON.stringify(path.join(EXEC, 'bridge', 'notify', 'whatsapp')) + ");\n" +
            "w.flush().then(function (r) { process.stdout.write(JSON.stringify({ sent: r.sent })); });\n");
          var kids = [0, 1, 2, 3].map(function () {
            return new Promise(function (resolve) {
              cp.execFile(process.execPath, [child], { env: process.env, timeout: 30000 }, function (err, stdout) {
                resolve(stdout || '');
              });
            });
          });
          return Promise.all(kids);
        })
        .then(function (outs) {
          var totalSent = outs.reduce(function (n, s) { try { return n + (JSON.parse(s).sent || 0); } catch (e) { return n; } }, 0);
          ok(received.length === 1, 'concurrency: four concurrent OS processes send exactly one message');
          ok(totalSent === 1, 'concurrency: exactly one process claimed the delivery');
          ok(entriesByKey()['gh-wa-proc-0001__COMPLETED'].state === 'SENT', 'concurrency: the ledger entry ends SENT exactly once');
          ok(fs.readdirSync(ledgerDir()).filter(function (n) { return /\.lock$/.test(n); }).length === 0, 'concurrency: every key lock is released');
        });
    })
    .then(function () {
      // ================================================================
      // 7. Failure, retry, exhaustion — and no effect on task state
      // ================================================================
      resetGateway();
      gateway.status = 500;
      process.env.MYTHOS_BRIDGE_WHATSAPP_MAX_ATTEMPTS = '3';
      process.env.MYTHOS_BRIDGE_WHATSAPP_BACKOFF_MS = '60000';
      whatsapp.onReport(mkReport('gh-wa-retr-0001', 'FAILED'), {});
      var cfgR = whatsapp.config();
      return whatsapp.flush().then(function (f) {
        var e = entriesByKey()['gh-wa-retr-0001__FAILED'];
        ok(f.sent === 0 && f.failed === 1, 'retry: a gateway 500 is reported as a failed delivery');
        ok(e.state === 'PENDING' && e.attempts === 1, 'retry: the entry stays PENDING and counts the attempt');
        ok(Date.parse(e.next_attempt_at) > Date.now(), 'retry: the next attempt is scheduled with backoff');
        ok(/HTTP 500/.test(e.last_error), 'retry: the provider error is recorded');
        ok(e.delivered_to.length === 0, 'retry: nothing is recorded as delivered');

        // Not due yet → a flush must not hammer the gateway.
        return whatsapp.flush().then(function () {
          ok(received.length === 1, 'retry: an entry that is not due yet is not re-attempted');
          // Make it due, keep the gateway broken → second attempt.
          var e2 = whatsapp.readEntry(cfgR, 'gh-wa-retr-0001__FAILED');
          e2.next_attempt_at = new Date(Date.now() - 1000).toISOString();
          fs.writeFileSync(path.join(ledgerDir(), 'gh-wa-retr-0001__FAILED.json'), JSON.stringify(e2, null, 2));
          return whatsapp.flush();
        });
      }).then(function () {
        ok(received.length === 2, 'retry: a due entry is retried');
        // Now the gateway recovers: the retry must succeed, exactly once.
        gateway.status = 200;
        var e3 = whatsapp.readEntry(cfgR, 'gh-wa-retr-0001__FAILED');
        e3.next_attempt_at = new Date(Date.now() - 1000).toISOString();
        fs.writeFileSync(path.join(ledgerDir(), 'gh-wa-retr-0001__FAILED.json'), JSON.stringify(e3, null, 2));
        return whatsapp.flush();
      }).then(function (f) {
        var e = entriesByKey()['gh-wa-retr-0001__FAILED'];
        ok(f.sent === 1 && e.state === 'SENT' && e.attempts === 3, 'retry: delivery succeeds after the gateway recovers');
        ok(received.length === 3 && received.filter(function (r) { return r.body.text.indexOf('gh-wa-retr-0001') !== -1; }).length === 3,
          'retry: three attempts, and only the last one succeeded');
        return whatsapp.flush();
      }).then(function () {
        ok(received.length === 3, 'retry: a SENT entry is never attempted again');

        // Exhaustion: attempts are bounded, and the bridge is never blocked.
        resetGateway();
        gateway.status = 500;
        whatsapp.onReport(mkReport('gh-wa-exha-0001', 'FAILED'), {});
        var seq = Promise.resolve();
        [0, 1, 2].forEach(function () {
          seq = seq.then(function () {
            var e = whatsapp.readEntry(whatsapp.config(), 'gh-wa-exha-0001__FAILED');
            if (e && e.state === 'PENDING') {
              e.next_attempt_at = new Date(Date.now() - 1000).toISOString();
              fs.writeFileSync(path.join(ledgerDir(), 'gh-wa-exha-0001__FAILED.json'), JSON.stringify(e, null, 2));
            }
            return whatsapp.flush();
          });
        });
        return seq;
      }).then(function () {
        var e = entriesByKey()['gh-wa-exha-0001__FAILED'];
        ok(e.state === 'EXHAUSTED' && e.attempts === 3, 'retry: attempts are bounded by MAX_ATTEMPTS, then EXHAUSTED');
        return whatsapp.flush().then(function () {
          ok(received.length === 3, 'retry: an EXHAUSTED entry is never attempted again');
        });
      });
    })
    .then(function () {
      // ================================================================
      // 8. Partial delivery to several recipients
      // ================================================================
      resetGateway();
      process.env.MYTHOS_BRIDGE_WHATSAPP_TO = '21620000000,21630000000';
      process.env.MYTHOS_BRIDGE_WHATSAPP_MAX_ATTEMPTS = '5';
      gateway.failFor = '21630000000';
      whatsapp.onReport(mkReport('gh-wa-part-0001', 'COMPLETED'), {});
      return whatsapp.flush().then(function () {
        var e = entriesByKey()['gh-wa-part-0001__COMPLETED'];
        ok(e.state === 'PENDING' && e.delivered_to.length === 1 && e.delivered_to[0] === '21620000000',
          'partial: the recipient that succeeded is recorded, the entry stays pending for the other');
        gateway.failFor = null;
        var e2 = whatsapp.readEntry(whatsapp.config(), 'gh-wa-part-0001__COMPLETED');
        e2.next_attempt_at = new Date(Date.now() - 1000).toISOString();
        fs.writeFileSync(path.join(ledgerDir(), 'gh-wa-part-0001__COMPLETED.json'), JSON.stringify(e2, null, 2));
        return whatsapp.flush();
      }).then(function () {
        var e = entriesByKey()['gh-wa-part-0001__COMPLETED'];
        ok(e.state === 'SENT' && e.delivered_to.length === 2, 'partial: the retry completes the remaining recipient');
        var toFirst = received.filter(function (r) { return r.body.number === '21620000000'; }).length;
        ok(toFirst === 1, 'partial: the recipient that already succeeded is NOT messaged twice');
        process.env.MYTHOS_BRIDGE_WHATSAPP_TO = '21620000000';
      });
    })
    .then(function () {
      // ================================================================
      // 9. Restart / crash recovery
      // ================================================================
      resetGateway();
      // (a) A crash mid-send leaves a SENDING claim. After the lease it is
      //     requeued and delivered exactly once.
      whatsapp.onReport(mkReport('gh-wa-crsh-0001', 'COMPLETED'), {});
      var cfg9 = whatsapp.config();
      var f9 = path.join(ledgerDir(), 'gh-wa-crsh-0001__COMPLETED.json');
      var e9 = readJson(f9);
      e9.state = 'SENDING';
      e9.attempts = 1;
      e9.sending_pid = 999999;                                  // a pid that is not running
      e9.updated_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      fs.writeFileSync(f9, JSON.stringify(e9, null, 2));
      ok(whatsapp.reclaimStale(cfg9) === 1, 'recovery: an abandoned SENDING claim is reclaimed');
      ok(readJson(f9).state === 'PENDING', 'recovery: the reclaimed entry is PENDING again');
      return whatsapp.flush().then(function () {
        ok(received.length === 1 && readJson(f9).state === 'SENT', 'recovery: the interrupted notification is delivered exactly once');

        // (b) A live sender is NEVER reclaimed — that is how duplicates happen.
        var e9b = readJson(f9);
        e9b.state = 'SENDING';
        e9b.sending_pid = process.pid;
        e9b.updated_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        fs.writeFileSync(f9, JSON.stringify(e9b, null, 2));
        ok(whatsapp.reclaimStale(whatsapp.config()) === 0, 'recovery: a SENDING claim held by a LIVE process is left alone');
        e9b.state = 'SENT';
        fs.writeFileSync(f9, JSON.stringify(e9b, null, 2));

        // (c) A fresh "process" (module state re-read from disk) after a
        //     restart re-reads the ledger and re-sends nothing.
        resetGateway();
        delete require.cache[require.resolve(path.join(EXEC, 'bridge', 'notify', 'whatsapp'))];
        var reloaded = require(path.join(EXEC, 'bridge', 'notify', 'whatsapp'));
        return reloaded.flush().then(function (f) {
          ok(f.attempted === 0 && received.length === 0, 'recovery: after a restart, already-SENT notifications are never re-sent');
          var st = reloaded.ledgerStatus();
          ok(st.counts.SENT > 0 && st.counts.EXHAUSTED === 1, 'recovery: the ledger survives the restart with its states intact');
          ok(JSON.stringify(st).indexOf(API_KEY) === -1, 'recovery: notify-status output never contains the credential');
        });
      });
    })
    .then(function () {
      // ================================================================
      // 10. End to end through a real bridge tick
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
      function mkTask(id) {
        return {
          protocol: 'mythos-control/1', task_id: id, project: 'executor-selftest',
          objective: 'Inspect the fixture repository and report its HEAD commit.',
          scope: ['README.md'], constraints: ['read-only'], priority: 'normal', requested_action: 'investigate',
          validation_requirements: ['git rev-parse HEAD'], status: 'PENDING',
          created_at: '2026-09-02T18:00:00.000Z', created_by: 'chatgpt-test'
        };
      }
      function taskOnDisk(id) { return readJson(path.join(cfgB.controlDir, 'control', 'tasks', id + '.json')); }
      function reportOnDisk(id) {
        var f = path.join(cfgB.controlDir, 'control', 'reports', id + '.json');
        return fs.existsSync(f) ? readJson(f) : null;
      }

      plannerWrite('gh-wa-e2e-0001.json', mkTask('gh-wa-e2e-0001'));
      plannerWrite('gh-wa-e2e-0002.json', mkTask('gh-wa-e2e-0002'));
      bridge.tick(executor);
      ok(taskOnDisk('gh-wa-e2e-0001').status === 'CLAIMED', 'e2e: the task was claimed by the bridge');
      ok(Object.keys(entriesByKey()).filter(function (k) { return /gh-wa-e2e/.test(k); }).length === 0,
        'e2e: a CLAIMED (non-terminal) task queues no notification');
      ok(received.length === 0, 'e2e: nothing reached the gateway during claiming');

      process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify([{ kind: 'success', summary: 'mock run one' }, { kind: 'success', summary: 'mock run two' }]);
      return executor.tick().then(function () { return executor.tick(); }).then(function () {
        // Task 2 loses its executor record: the bridge's one HUMAN_APPROVAL
        // condition (never silently re-execute) — verified end to end.
        var t2 = taskOnDisk('gh-wa-e2e-0002');
        fs.rmSync(state.taskDir(t2.execution.executor_task_id), { recursive: true, force: true });

        var rT = bridge.tick(executor);
        var rep1 = reportOnDisk('gh-wa-e2e-0001');
        var rep2 = reportOnDisk('gh-wa-e2e-0002');
        ok(rep1 && rep1.status === 'COMPLETED', 'e2e: task 1 reached a COMPLETED REPORT');
        ok(rep2 && rep2.status === 'BLOCKED' && /A human decides/.test(rep2.next_recommended_action),
          'e2e: task 2 reached the bridge\'s blocked-for-a-human REPORT');
        ok((rT.actions || []).some(function (a) { return a.action === 'blocked_missing_executor'; }), 'e2e: the bridge took the blocked_missing_executor path');
        var led = entriesByKey();
        ok(led['gh-wa-e2e-0001__COMPLETED'] && led['gh-wa-e2e-0001__COMPLETED'].state === 'PENDING',
          'e2e: the COMPLETED notification is queued by the tick, not sent by it');
        ok(led['gh-wa-e2e-0002__HUMAN_APPROVAL'] && !led['gh-wa-e2e-0002__BLOCKED'],
          'e2e: the blocked-for-a-human report notifies as HUMAN_APPROVAL, not as BLOCKED');
        ok(received.length === 0, 'e2e: the tick itself never talks to the gateway');

        return bridge.flushNotifications().then(function (f) {
          ok(f.sent === 2, 'e2e: flushNotifications delivered both notifications after the tick returned');
          ok(received.length === 2, 'e2e: two messages reached the gateway');
          ok(received.some(function (r) { return /MYTHOS COMPLETED — gh-wa-e2e-0001/.test(r.body.text); }), 'e2e: the COMPLETED message names the task');
          ok(received.some(function (r) { return /MYTHOS HUMAN_APPROVAL — gh-wa-e2e-0002/.test(r.body.text); }), 'e2e: the HUMAN_APPROVAL message names the task');
          // The notification layer left no trace on the control branch.
          var touched = git(cfgB.controlDir, ['log', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean);
          ok(touched.every(function (f2) { return f2.indexOf('control/') === 0; }), 'e2e: bridge commits still touch only control/');
          ok(JSON.stringify(reportOnDisk('gh-wa-e2e-0001')).indexOf('whatsapp') === -1 &&
             JSON.stringify(reportOnDisk('gh-wa-e2e-0001')).indexOf('notification') === -1,
          'e2e: the REPORT carries no notification state (delivery cannot alter the record)');
          return { cfgB: cfgB, taskOnDisk: taskOnDisk, reportOnDisk: reportOnDisk };
        });
      }).then(function (ctx) {
        // A broken gateway after the report exists changes nothing about it.
        resetGateway();
        gateway.status = 500;
        var before = fs.readFileSync(path.join(ctx.cfgB.controlDir, 'control', 'tasks', 'gh-wa-e2e-0001.json'), 'utf8');
        var repBefore = fs.readFileSync(path.join(ctx.cfgB.controlDir, 'control', 'reports', 'gh-wa-e2e-0001.json'), 'utf8');
        whatsapp.onReport(mkReport('gh-wa-brok-0001', 'COMPLETED'), {});
        return bridge.flushNotifications().then(function () {
          var headBefore = git(ctx.cfgB.controlDir, ['rev-parse', 'HEAD']);
          var r = bridge.tick(executor);
          ok(r.ok === true, 'isolation: a tick still succeeds while the WhatsApp gateway is failing');
          ok(fs.readFileSync(path.join(ctx.cfgB.controlDir, 'control', 'tasks', 'gh-wa-e2e-0001.json'), 'utf8') === before,
            'isolation: a failed delivery leaves the TASK file byte-identical');
          ok(fs.readFileSync(path.join(ctx.cfgB.controlDir, 'control', 'reports', 'gh-wa-e2e-0001.json'), 'utf8') === repBefore,
            'isolation: a failed delivery leaves the REPORT byte-identical');
          ok(git(ctx.cfgB.controlDir, ['rev-parse', 'HEAD']) === headBefore, 'isolation: a failed delivery produces no control commit');
          ok(ctx.taskOnDisk('gh-wa-e2e-0001').status === 'COMPLETED' && ctx.reportOnDisk('gh-wa-e2e-0002').status === 'BLOCKED',
            'isolation: task statuses are unchanged by the delivery failure');
          gateway.status = 200;
          return ctx;
        });
      });
    })
    .then(function (ctx) {
      // ================================================================
      // 11. Secrets are nowhere except in the header the gateway saw
      // ================================================================
      function grepTree(dir) {
        var hits = [];
        (function walk(d) {
          var names;
          try { names = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
          names.forEach(function (n) {
            var full = path.join(d, n.name);
            if (n.isDirectory()) { if (n.name !== '.git') walk(full); return; }
            if (!n.isFile()) return;
            if (full === KEY_FILE) return;              // the credential file itself, 0600, never committed
            if (full.indexOf(path.join(FIX, 'flush-child.js')) === 0) return;
            var text;
            try { text = fs.readFileSync(full, 'utf8'); } catch (e) { return; }
            if (text.indexOf(API_KEY) !== -1) hits.push(full);
          });
        })(dir);
        return hits;
      }
      var leaks = grepTree(FIX);
      ok(leaks.length === 0, 'secrets: the credential appears in no ledger file, log, report, task file or worktree (' + leaks.join(', ') + ')');

      var eventsLog = path.join(process.env.MYTHOS_BRIDGE_HOME, 'events.log');
      var logText = fs.existsSync(eventsLog) ? fs.readFileSync(eventsLog, 'utf8') : '';
      ok(logText.indexOf(API_KEY) === -1, 'secrets: the bridge event log never contains the credential');
      ok(/whatsapp_queued|whatsapp_flush/.test(logText), 'secrets: notification activity IS logged (redacted), so the layer is observable');

      var committed = git(ctx.cfgB.controlDir, ['log', '--format=%H']).split('\n').filter(Boolean);
      var leakingTrees = committed.filter(function (sha) {
        return cp.spawnSync('git', ['grep', '-q', API_KEY, sha], { cwd: ctx.cfgB.controlDir }).status === 0;
      });
      ok(leakingTrees.length === 0, 'secrets: no committed tree on the control branch contains the credential');

      // A report whose summary carries a secret shape must be redacted in
      // the message before it leaves the host.
      var poisoned = mkReport('gh-wa-poison-01', 'COMPLETED', {
        summary: 'leaked token ghp_abcdefghijklmnopqrstuvwxyz123456 in the summary'
      });
      var msg = whatsapp.buildMessage(poisoned, 'COMPLETED');
      ok(msg.indexOf('ghp_abcdefghijklmnopqrstuvwxyz123456') === -1 && msg.indexOf('[REDACTED]') !== -1,
        'secrets: a secret shape in an untrusted report summary is redacted out of the message');

      // ================================================================
      // 12. Adapter contract (the migration path off Evolution API)
      // ================================================================
      var evo = require(path.join(EXEC, 'bridge', 'notify', 'providers', 'evolution'));
      ok(typeof evo.sendText === 'function' && typeof evo.describe === 'function' &&
        typeof evo.isValidRecipient === 'function' && Array.isArray(evo.requirements),
      'adapter: the Evolution adapter implements the full provider contract');
      ok(JSON.stringify(evo.describe()).indexOf(API_KEY) === -1, 'adapter: describe() carries no credential');
      ok(evo.isValidRecipient('21620000000') && evo.isValidRecipient('21620000000@s.whatsapp.net'), 'adapter: MSISDN and JID recipients accepted');
      ok(!evo.isValidRecipient('../../etc/passwd') && !evo.isValidRecipient('+216 20 000 000') && !evo.isValidRecipient(''),
        'adapter: a recipient that could inject into the URL or the body is refused');
      // The registry now carries a second adapter (`generic`). What this
      // assertion is really about — a provider is selected BY NAME and the
      // bridge does not change when one is added — is unchanged, and the
      // full multi-provider contract is proven in
      // tests/mythos-bridge-whatsapp-resilience-test.js §1.
      ok(whatsapp.PROVIDERS.evolution === evo && Object.keys(whatsapp.PROVIDERS).length >= 1,
        'adapter: providers are registered and selected by name — adding one is a new file, not a bridge change');
      return Promise.all([
        evo.sendText({ baseUrl: 'http://127.0.0.1:1', instance: '../escape', apiKey: 'k', to: '21620000000', text: 'x' }),
        evo.sendText({ baseUrl: 'http://127.0.0.1:1', instance: 'ok', apiKey: '', to: '21620000000', text: 'x' }),
        evo.sendText({ baseUrl: 'http://127.0.0.1:1', instance: 'ok', apiKey: 'k', to: '21620000000', text: 'x', timeoutMs: 1500 })
      ]).then(function (rs) {
        ok(rs[0].ok === false && /instance name/.test(rs[0].error), 'adapter: a path-traversing instance name is refused before a request is built');
        ok(rs[1].ok === false && /credential missing/.test(rs[1].error), 'adapter: a missing credential is refused, not sent as an empty header');
        ok(rs[2].ok === false && /TRANSPORT/.test(rs[2].error), 'adapter: an unreachable gateway resolves as a failure, it never throws');
        ok(rs.every(function (r) { return String(r.error).indexOf('k') === -1 || !/apiKey|apikey/.test(String(r.error)); }), 'adapter: errors never echo the credential');
      });
    })
    .then(function () {
      // ================================================================
      // 13. task_id length — a 64-char id (the bridge's own max, raised
      //     from 40 to 64 in 82bea23) must reach the ledger, not vanish
      //     into onReport()'s silent try/catch
      // ================================================================
      resetGateway();
      var id64 = 'gh-wa-len64-' + 'b'.repeat(52);                 // 64 chars
      var id65 = 'gh-wa-len65-' + 'c'.repeat(53);                 // 65 chars — over the bridge's own cap
      ok(id64.length === 64 && id65.length === 65, 'task_id length: fixtures are 64 and 65 chars');
      ok(whatsapp.ledgerKey(id64, 'COMPLETED') === id64 + '__COMPLETED', 'task_id length: ledgerKey() accepts a 64-char task_id');
      var q64 = whatsapp.onReport(mkReport(id64, 'COMPLETED'), {});
      ok(q64.queued === true && q64.key === id64 + '__COMPLETED', 'task_id length: a 64-char task_id queues a notification instead of silently vanishing');
      return whatsapp.flush().then(function () {
        var e = whatsapp.readEntry(whatsapp.config(), id64 + '__COMPLETED');
        ok(e && e.state === 'SENT', 'task_id length: the 64-char id\'s notification is delivered');
        ok(received.some(function (r) { return r.body && r.body.text.indexOf(id64) !== -1; }), 'task_id length: the delivered message names the 64-char task');
        // 65 chars is one past the bridge's own maximum (github-bridge.js
        // TASK_ID_RE); the ledger key must refuse it explicitly rather than
        // accept a shape the rest of the control protocol never produces.
        ok((function () { try { whatsapp.ledgerKey(id65, 'COMPLETED'); return false; } catch (e2) { return /NOTIFY_KEY_INVALID/.test(e2.message); } })(),
          'task_id length: a 65-char task_id (over the bridge\'s own max) is refused by ledgerKey()');
      });
    })
    .then(function () {
      // ================================================================
      // 14. Crash/failure window — a recipient's success is durable the
      //     instant the provider acknowledges it, not batched until the
      //     whole delivery attempt (every recipient) finishes. This is the
      //     gap that used to let a crash between two recipients' sends
      //     cause a duplicate to the one that had already succeeded.
      // ================================================================
      resetGateway();
      process.env.MYTHOS_BRIDGE_WHATSAPP_TO = '21620000091,21620000092';
      var slow = '21620000092';
      gateway.delayFor = { to: slow, ms: 250 };
      whatsapp.onReport(mkReport('gh-wa-crashwin-01', 'COMPLETED'), {});
      var f9 = path.join(ledgerDir(), 'gh-wa-crashwin-01__COMPLETED.json');
      var flushPromise = whatsapp.flush();
      // While the second recipient's request is still held open by the
      // fixture, the first recipient's success must already be on disk —
      // proving the write is per-recipient, not deferred to the end of the
      // attempt. Before this fix, the ledger would still show
      // delivered_to: [] here, and a crash in exactly this window would
      // have caused a duplicate send to the first recipient on the next
      // retry.
      return new Promise(function (resolve) { setTimeout(resolve, 90); }).then(function () {
        var mid = readJson(f9);
        ok(mid.state === 'SENDING' && mid.delivered_to.indexOf('21620000091') !== -1,
          'crash-window: the first recipient is durably recorded on disk while the second recipient\'s request is still in flight');
        gateway.delayFor = null;
        return flushPromise;
      }).then(function () {
        var e = entriesByKey()['gh-wa-crashwin-01__COMPLETED'];
        ok(e.state === 'SENT' && e.delivered_to.length === 2, 'crash-window: both recipients are eventually recorded SENT');
        var toFirst = received.filter(function (r) { return r.body.number === '21620000091'; }).length;
        ok(toFirst === 1, 'crash-window: the recipient recorded mid-attempt is never re-sent, even after the attempt continues past it');
        // Now actually simulate the crash: force the entry back to the
        // in-flight shape a crash between the two writes would have left
        // (SENDING, only the first recipient in delivered_to, stale lease)
        // and confirm the reclaim + retry path sends only to the recipient
        // still missing — never a second message to the one already durable.
        resetGateway();
        var e2 = readJson(f9);
        e2.state = 'SENDING';
        e2.delivered_to = ['21620000091'];
        e2.sending_pid = 999999;                                   // not a running pid
        e2.updated_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        fs.writeFileSync(f9, JSON.stringify(e2, null, 2));
        ok(whatsapp.reclaimStale(whatsapp.config()) === 1, 'crash-window: the simulated crash leaves a reclaimable SENDING claim');
        return whatsapp.flush();
      }).then(function () {
        var e = entriesByKey()['gh-wa-crashwin-01__COMPLETED'];
        ok(e.state === 'SENT' && e.delivered_to.length === 2, 'crash-window: the reclaimed retry completes delivery');
        var toFirst = received.filter(function (r) { return r.body.number === '21620000091'; }).length;
        var toSecond = received.filter(function (r) { return r.body.number === '21620000092'; }).length;
        ok(toFirst === 0 && toSecond === 1, 'crash-window: reclaim-and-retry re-sends only to the recipient missing from delivered_to, never the one already recorded');
        process.env.MYTHOS_BRIDGE_WHATSAPP_TO = '21620000000';
      });
    })
    .then(function () {
      // ================================================================
      // 15. writeEntry() durability — the ledger write that backs every
      //     claim above ("durable on disk", "synchronous fsync-then-rename")
      //     must actually fsync, not just write-then-rename and trust the
      //     OS page cache to flush eventually. Spy on fs.fsyncSync so this
      //     fails loudly if a future edit removes the fsync call while
      //     leaving the surrounding prose untouched.
      // ================================================================
      resetGateway();
      var fsyncedFds = [];
      var originalFsyncSync = fs.fsyncSync;
      fs.fsyncSync = function (fd) {
        fsyncedFds.push(fd);
        return originalFsyncSync.call(fs, fd);
      };
      try {
        whatsapp.onReport(mkReport('gh-wa-fsync-01', 'COMPLETED'), {});
      } finally {
        fs.fsyncSync = originalFsyncSync;
      }
      ok(fsyncedFds.length >= 1, 'writeEntry: fsync is actually called when a ledger entry is written, not merely claimed in comments');
      var f10 = path.join(ledgerDir(), 'gh-wa-fsync-01__COMPLETED.json');
      ok(fs.existsSync(f10) && readJson(f10).key === 'gh-wa-fsync-01__COMPLETED', 'writeEntry: the fsynced entry is readable at its final (post-rename) path');
      // No leftover .tmp-<pid> file: the rename happened after the fsync,
      // not instead of it.
      var leftoverTmp = fs.readdirSync(ledgerDir()).filter(function (n) { return /\.tmp-/.test(n); });
      ok(leftoverTmp.length === 0, 'writeEntry: no temp file is left behind once the fsync + rename completes');
    })
    .catch(function (e) {
      ok(false, 'unexpected error: ' + (e && e.stack || e));
    })
    .then(function () {
      server.close();
      fs.rmSync(FIX, { recursive: true, force: true });
      console.log('bridge whatsapp notification tests: ' + passed + ' passed, ' + failed + ' failed');
      if (failed) { console.error(failures.join('\n')); process.exit(1); }
    });
}

server.listen(0, '127.0.0.1', run);
