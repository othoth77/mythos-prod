'use strict';
// =====================================================
// MYTHOS — GitHub bridge WhatsApp provider-independence and resilience tests
// tests/mythos-bridge-whatsapp-resilience-test.js
//
// Companion to tests/mythos-bridge-whatsapp-notify-test.js, which proves the
// two-phase design, idempotency and the ledger. This suite proves the four
// things gh-issue-147 is about:
//
//   1  MYTHOS is not bound to one WhatsApp provider. Every registered adapter
//      satisfies one contract, and a different gateway can be driven by
//      configuration alone through `providers/generic.js` — no new file, no
//      bridge change, no deploy of new code.
//   2  A provider that is down or hung cannot cost the bridge unbounded time
//      and cannot destroy the queued notifications (circuit breaker).
//   3  A flush is bounded in wall clock no matter how many entries and
//      recipients are due (flush budget), and a budget cut is not a failure.
//   4  A terminal notification is never lost because the credential file was
//      momentarily unreadable (queue-scope vs delivery-scope readiness).
//
// Plus the regression guard for the defect that made the whole layer inert in
// production: `tick` in Issues mode never flushed.
//
// Offline and deterministic. NO real WhatsApp message is ever sent: the far
// end is a local http server on 127.0.0.1 that records every request, while
// the REAL adapters and the REAL HTTP path are exercised.
// Fixtures never live under /tmp (the task schema refuses it).
// Run with: node tests/mythos-bridge-whatsapp-resilience-test.js
// =====================================================
var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIX = path.join(os.homedir(), 'mythos-wa-resilience-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true });

var API_KEY = 'wa-res-test-apikey-Kq83MtV1pZ';
var KEY_FILE = path.join(FIX, 'gateway.key');
fs.writeFileSync(KEY_FILE, API_KEY + '\n', { mode: 0o600 });

process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.MYTHOS_BRIDGE_HOME = path.join(FIX, 'home', 'bridge');

var whatsapp = require(path.join(EXEC, 'bridge', 'notify', 'whatsapp'));
var evolution = require(path.join(EXEC, 'bridge', 'notify', 'providers', 'evolution'));
var generic = require(path.join(EXEC, 'bridge', 'notify', 'providers', 'generic'));

var passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.error('FAIL: ' + name); } }

// --- the fake gateway --------------------------------------------------------------

var received = [];
var gateway = { status: 200, body: '{"key":{"id":"MOCK-1"},"status":"PENDING"}', delayMs: 0 };

var server = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    var raw = Buffer.concat(chunks).toString('utf8');
    var body = null;
    try { body = JSON.parse(raw); } catch (e) { /* recorded as null */ }
    received.push({ url: req.url, headers: req.headers, body: body, raw: raw });
    setTimeout(function () {
      res.writeHead(gateway.status, { 'content-type': 'application/json' });
      res.end(gateway.status >= 200 && gateway.status < 300 ? gateway.body : '{"error":"gateway said no"}');
    }, gateway.delayMs);
  });
});

// --- helpers -----------------------------------------------------------------------

var BASE_URL = null;

// Every section gets its own ledger home, so no section can be influenced by
// another's entries or breaker state.
function section(name, env) {
  var home = path.join(FIX, 'ledger-' + name);
  Object.keys(process.env).forEach(function (k) {
    if (/^MYTHOS_BRIDGE_WHATSAPP_/.test(k)) delete process.env[k];
  });
  process.env.MYTHOS_BRIDGE_WHATSAPP_ENABLED = '1';
  process.env.MYTHOS_BRIDGE_WHATSAPP_BASE_URL = BASE_URL;
  process.env.MYTHOS_BRIDGE_WHATSAPP_INSTANCE = 'mythos-bridge';
  process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE = KEY_FILE;
  process.env.MYTHOS_BRIDGE_WHATSAPP_TO = '21620000001';
  process.env.MYTHOS_BRIDGE_WHATSAPP_HOME = home;
  Object.keys(env || {}).forEach(function (k) { process.env[k] = env[k]; });
  received.length = 0;
  gateway.status = 200;
  gateway.delayMs = 0;
  return home;
}

function report(id, status) {
  return {
    task_id: id, status: status, summary: 'resilience fixture', tests: [], files_changed: [],
    commits: [], problems: [], next_recommended_action: 'none',
    execution: { branch: 'mythos/x', othmode_task_id: 'OTH-2026-00001' }, delivery: { branch: 'mythos/x' }
  };
}

function entriesIn() { return whatsapp.listEntries(whatsapp.config()); }
function entryFor(id, kind) {
  return whatsapp.readEntry(whatsapp.config(), id + '__' + (kind || 'COMPLETED'));
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function run() {
  return Promise.resolve()

  // =================================================================
  // 1. Every registered adapter satisfies one contract
  // =================================================================
  .then(function () {
    section('contract');
    var names = Object.keys(whatsapp.PROVIDERS);
    ok(names.length >= 2, 'registry: more than one adapter is registered — the layer is not written around a single provider');
    ok(names.indexOf('evolution') !== -1 && names.indexOf('generic') !== -1, 'registry: evolution and generic are both selectable by name');

    names.forEach(function (name) {
      var p = whatsapp.PROVIDERS[name];
      ok(p.id === name, 'contract[' + name + ']: id matches the registry key (it is the MYTHOS_BRIDGE_WHATSAPP_PROVIDER value)');
      ok(Array.isArray(p.requirements) && p.requirements.length > 0, 'contract[' + name + ']: declares its requirements');
      ok(typeof p.describe === 'function' && typeof p.isValidRecipient === 'function' && typeof p.sendText === 'function',
        'contract[' + name + ']: implements describe / isValidRecipient / sendText');
      var d = p.describe();
      ok(d && d.id === name && Array.isArray(d.capabilities) && d.capabilities.length === 1 && d.capabilities[0] === 'sendText',
        'contract[' + name + ']: describes exactly one capability, sendText — the scope fence holds for every adapter');
      ok(JSON.stringify(d).indexOf(API_KEY) === -1, 'contract[' + name + ']: describe() carries no credential');
      ok(p.isValidRecipient('21620000000') && p.isValidRecipient('21620000000@s.whatsapp.net'),
        'contract[' + name + ']: MSISDN and JID recipients accepted');
      ok(!p.isValidRecipient('../../etc/passwd') && !p.isValidRecipient('+216 20 000 000') && !p.isValidRecipient(''),
        'contract[' + name + ']: a recipient that could inject into the URL or the body is refused');
    });

    // The contract's hard rule: a bad call is a resolved failure, never a throw.
    var bad = names.map(function (name) {
      return whatsapp.PROVIDERS[name].sendText({ baseUrl: BASE_URL, instance: 'x', apiKey: '', to: 'nope', text: '' });
    });
    return Promise.all(bad).then(function (rs) {
      ok(rs.every(function (r) { return r && r.ok === false && typeof r.error === 'string'; }),
        'contract: every adapter resolves ok:false for an unusable call instead of throwing');
      ok(rs.every(function (r) { return JSON.stringify(r).indexOf(API_KEY) === -1; }),
        'contract: no adapter echoes a credential in its result');
    });
  })

  // =================================================================
  // 2. The generic adapter: a different gateway is configuration, not code
  // =================================================================
  .then(function () {
    section('generic-shape');
    // Default configuration reproduces the currently supported gateway
    // exactly — which is what makes `generic` a safe drop-in.
    return evolution.sendText({ baseUrl: BASE_URL, instance: 'mythos-bridge', apiKey: API_KEY, to: '21620000001', text: 'same text' })
      .then(function () {
        return generic.sendText({ baseUrl: BASE_URL, instance: 'mythos-bridge', apiKey: API_KEY, to: '21620000001', text: 'same text', options: null });
      })
      .then(function () {
        ok(received.length === 2, 'generic: both adapters reached the gateway');
        ok(received[0].url === received[1].url, 'generic: the default path template reproduces the Evolution endpoint exactly');
        ok(JSON.stringify(received[0].body) === JSON.stringify(received[1].body), 'generic: the default body template reproduces the Evolution body exactly');
        ok(received[1].headers.apikey === API_KEY, 'generic: the credential is sent as the configured header and nothing else');
      });
  })
  .then(function () {
    section('generic-custom');
    // A completely different gateway shape, driven by configuration only.
    var opts = {
      path: '/api/v1/sessions/{instance}/messages/{to}',
      authHeader: 'authorization',
      authPrefix: 'Bearer ',
      bodyTemplate: '{"chatId":"{{to}}","payload":{"kind":"text","content":"{{text}}"},"session":"{{instance}}"}',
      idPath: 'result.messageId'
    };
    gateway.body = '{"result":{"messageId":"WAHA-9"}}';
    return generic.sendText({ baseUrl: BASE_URL, instance: 'mythos-bridge', apiKey: API_KEY, to: '21620000001', text: 'hello', options: opts })
      .then(function (r) {
        ok(received.length === 1 && received[0].url === '/api/v1/sessions/mythos-bridge/messages/21620000001',
          'generic: the path template drives a different endpoint shape, with both placeholders substituted');
        ok(received[0].headers.authorization === 'Bearer ' + API_KEY, 'generic: a Bearer-token gateway is a configuration change, not a code change');
        ok(received[0].headers.apikey === undefined, 'generic: no other auth header is sent');
        var b = received[0].body;
        ok(b && b.chatId === '21620000001' && b.session === 'mythos-bridge' && b.payload && b.payload.content === 'hello',
          'generic: the body template drives a nested body shape');
        ok(r.ok === true && r.provider_message_id === 'WAHA-9', 'generic: the message id is read from the configured dotted path');
        gateway.body = '{"key":{"id":"MOCK-1"},"status":"PENDING"}';
      });
  })
  .then(function () {
    section('generic-injection');
    // A REPORT summary is untrusted text. It must land in a JSON string slot
    // and be unable to add structure, whatever it contains.
    var hostile = '"},"admin":true,"note":"' + '\n' + '{{to}}';
    return generic.sendText({ baseUrl: BASE_URL, instance: 'mythos-bridge', apiKey: API_KEY, to: '21620000001', text: hostile, options: null })
      .then(function () {
        var b = received[0].body;
        ok(b && b.admin === undefined, 'generic: hostile text cannot inject a JSON key — the template is parsed before substitution, never concatenated');
        // Substitution is a single pass over the TEMPLATE: a placeholder that
        // arrives inside untrusted content is never itself expanded.
        ok(b && b.text === hostile, 'generic: the text arrives byte-identical, and a placeholder inside it is not re-expanded');
        ok(Object.keys(b).length === 2, 'generic: the body carries exactly the templated fields');
      });
  })
  .then(function () {
    // Static configuration faults are caught before anything is queued.
    section('generic-config', { MYTHOS_BRIDGE_WHATSAPP_PROVIDER: 'generic', MYTHOS_BRIDGE_WHATSAPP_GENERIC_BODY: 'not json at all' });
    var d = whatsapp.describe();
    ok(d.problems.some(function (p) { return /GENERIC_BODY is not valid JSON/.test(p); }), 'generic: an unparseable body template is a readiness problem');
    var q = whatsapp.onReport(report('gh-res-badcfg', 'COMPLETED'), {});
    ok(q.queued === false, 'generic: nothing is queued while the adapter configuration is refused');
    ok(entriesIn().length === 0, 'generic: no ledger entry exists for a refused configuration');

    section('generic-config2', { MYTHOS_BRIDGE_WHATSAPP_PROVIDER: 'generic', MYTHOS_BRIDGE_WHATSAPP_GENERIC_PATH: '/a/../../etc/passwd' });
    ok(whatsapp.describe().problems.some(function (p) { return /GENERIC_PATH/.test(p); }), 'generic: a dot-segment path template is refused');

    section('generic-config3', { MYTHOS_BRIDGE_WHATSAPP_PROVIDER: 'generic', MYTHOS_BRIDGE_WHATSAPP_GENERIC_AUTH_HEADER: 'bad header: x' });
    ok(whatsapp.describe().problems.some(function (p) { return /AUTH_HEADER/.test(p); }), 'generic: an invalid auth header name is refused');
  })

  // =================================================================
  // 3. End to end through a non-default provider
  .then(function () {
    section('generic-waha');
    // The WAHA mapping documented in docs/MYTHOS_WHATSAPP_PROVIDER_STRATEGY.md
    // §3.2 (live-verified upstream 2026-09-04: POST /api/sendText, header
    // X-Api-Key, body {session, chatId "<msisdn>@c.us", text}, WAMessage with a
    // top-level `id`) must be drivable by `generic` with NO code change. If
    // generic.js ever stops substituting inside a string value, or stops
    // reading a top-level id, this is where it shows.
    var opts = {
      path: '/api/sendText',
      authHeader: 'X-Api-Key',
      bodyTemplate: '{"session":"{{instance}}","chatId":"{{to}}@c.us","text":"{{text}}"}',
      idPath: 'id'
    };
    gateway.body = '{"id":"true_21620000001@c.us_3EB0A1B2","timestamp":1756990000,"from":"mythos-bridge","fromMe":true,"body":"hello WAHA","ack":1}';
    return generic.sendText({ baseUrl: BASE_URL, instance: 'mythos-bridge', apiKey: API_KEY, to: '21620000001', text: 'hello WAHA', options: opts })
      .then(function (r) {
        ok(received.length === 1 && received[0].url === '/api/sendText', 'waha mapping: the documented endpoint is used');
        ok(received[0].headers['x-api-key'] === API_KEY && received[0].headers.apikey === undefined, 'waha mapping: the credential travels as X-Api-Key only');
        var b = received[0].body;
        ok(b && b.session === 'mythos-bridge' && b.chatId === '21620000001@c.us' && b.text === 'hello WAHA',
          'waha mapping: session, chatId with the @c.us suffix composed inside the template, and text are all substituted');
        ok(r.ok === true && r.provider_message_id === 'true_21620000001@c.us_3EB0A1B2', 'waha mapping: the WAMessage top-level id is recorded as the provider message id');
        gateway.body = '{"key":{"id":"MOCK-1"},"status":"PENDING"}';
      });
  })
  .then(function () {
    section('evolution-wa-evolution');
    // wa-evolution (live-verified 2026-09-04, internal/api/messages.go) answers
    // the same request with HTTP 201 and {key:{remoteJid,fromMe,id},status}.
    // The existing Evolution adapter must accept that reply unchanged.
    gateway.status = 201;
    gateway.body = '{"key":{"remoteJid":"21620000001@s.whatsapp.net","fromMe":true,"id":"3EB0WAEVO01"},"status":"PENDING"}';
    return evolution.sendText({ baseUrl: BASE_URL, instance: 'mythos-bridge', apiKey: API_KEY, to: '21620000001', text: 'hello wa-evolution' })
      .then(function (r) {
        ok(received.length === 1 && received[0].url === '/message/sendText/mythos-bridge' && received[0].headers.apikey === API_KEY,
          'wa-evolution: the Evolution adapter sends the byte-identical request it already sends');
        ok(r.ok === true && r.provider_message_id === '3EB0WAEVO01', 'wa-evolution: a 201 + key.id reply is accepted by the Evolution adapter unchanged');
        gateway.status = 200;
        gateway.body = '{"key":{"id":"MOCK-1"},"status":"PENDING"}';
      });
  })

  // =================================================================
  .then(function () {
    section('generic-e2e', {
      MYTHOS_BRIDGE_WHATSAPP_PROVIDER: 'generic',
      MYTHOS_BRIDGE_WHATSAPP_GENERIC_PATH: '/api/sendText/{instance}',
      MYTHOS_BRIDGE_WHATSAPP_GENERIC_BODY: '{"to":"{{to}}","message":"{{text}}"}'
    });
    var q = whatsapp.onReport(report('gh-res-e2e-01', 'COMPLETED'), {});
    ok(q.queued === true, 'generic e2e: the notification is queued with the non-default provider selected');
    return whatsapp.flush().then(function (r) {
      ok(r.sent === 1, 'generic e2e: delivered through the generic adapter');
      ok(received.length === 1 && received[0].url === '/api/sendText/mythos-bridge', 'generic e2e: the configured endpoint was used');
      ok(received[0].body.message.indexOf('gh-res-e2e-01') !== -1, 'generic e2e: the message names the task');
      ok(entryFor('gh-res-e2e-01').state === 'SENT', 'generic e2e: the ledger records the delivery');
      return whatsapp.flush().then(function () {
        ok(received.length === 1, 'generic e2e: a second flush sends nothing — idempotency is a property of the ledger, not of the provider');
      });
    });
  })

  // =================================================================
  // 4. Circuit breaker
  // =================================================================
  .then(function () {
    section('breaker-open', {
      MYTHOS_BRIDGE_WHATSAPP_BREAKER_THRESHOLD: '2',
      MYTHOS_BRIDGE_WHATSAPP_BREAKER_COOLDOWN_MS: '1500',
      MYTHOS_BRIDGE_WHATSAPP_FLUSH_LIMIT: '5'
    });
    ok(whatsapp.breakerStatus().state === 'closed', 'breaker: closed with no history');
    ['gh-res-brk-01', 'gh-res-brk-02', 'gh-res-brk-03', 'gh-res-brk-04', 'gh-res-brk-05'].forEach(function (id) {
      whatsapp.onReport(report(id, 'COMPLETED'), {});
    });
    ok(entriesIn().length === 5, 'breaker: five notifications are queued');
    gateway.status = 500;
    return whatsapp.flush().then(function (r) {
      ok(received.length === 2, 'breaker: the outage costs exactly THRESHOLD requests, not one per due entry');
      ok(r.results.filter(function (x) { return x.skipped === 'provider circuit breaker is open'; }).length === 3,
        'breaker: the remaining due entries are skipped by the open circuit inside the same flush');
      ok(whatsapp.breakerStatus().state === 'open', 'breaker: two consecutive 5xx open the circuit');
      var untouched = entriesIn().filter(function (e) { return e.attempts === 0; });
      ok(untouched.length === 3, 'breaker: a skipped entry consumes no attempt — an outage delays notifications, it does not exhaust them');
      ok(entriesIn().every(function (e) { return e.state === 'PENDING'; }), 'breaker: every entry is still PENDING');

      // While open, further flushes are free and change nothing.
      return whatsapp.flush().then(function (r2) {
        ok(r2.attempted === 0 && received.length === 2, 'breaker: while open, a flush reaches the gateway zero times');
        ok(r2.skipped === 'provider circuit breaker is open', 'breaker: the flush reports why it did nothing');
        ok(entriesIn().filter(function (e) { return e.attempts === 0; }).length === 3, 'breaker: still no attempt consumed');
      });
    });
  })
  .then(function () {
    // Cooldown expiry → exactly one probe decides the circuit.
    return wait(1600).then(function () {
      ok(whatsapp.breakerStatus().state === 'half-open', 'breaker: the circuit reports half-open once the cooldown expires');
      gateway.status = 500;
      return whatsapp.flush().then(function () {
        ok(received.length === 3, 'breaker: a half-open flush sends exactly ONE probe, not a whole batch');
        ok(whatsapp.breakerStatus().state === 'open', 'breaker: a failed probe re-opens the circuit');
        var st = whatsapp.breakerStatus();
        ok(st.cooldown_ms === 3000, 'breaker: each consecutive open doubles the cooldown');
      });
    });
  })
  .then(function () {
    // Operator repair path: reset closes the circuit without sending.
    var before = received.length;
    var st = whatsapp.resetBreaker();
    ok(st.state === 'closed' && st.failures === 0, 'breaker: notify-breaker-reset closes the circuit after a gateway repair');
    ok(received.length === before, 'breaker: the reset itself sends nothing');
    gateway.status = 200;
    return whatsapp.flush().then(function (r) {
      ok(r.sent >= 1, 'breaker: delivery resumes immediately after the reset');
      ok(whatsapp.breakerStatus().state === 'closed', 'breaker: a success keeps the circuit closed');
    });
  })
  .then(function () {
    // A 4xx is the gateway rejecting THIS message, not an outage.
    section('breaker-4xx', { MYTHOS_BRIDGE_WHATSAPP_BREAKER_THRESHOLD: '2', MYTHOS_BRIDGE_WHATSAPP_FLUSH_LIMIT: '5' });
    ['gh-res-4xx-01', 'gh-res-4xx-02', 'gh-res-4xx-03'].forEach(function (id) { whatsapp.onReport(report(id, 'FAILED'), {}); });
    gateway.status = 400;
    return whatsapp.flush().then(function (r) {
      ok(received.length === 3, 'breaker: a 4xx never opens the circuit — all three entries were attempted');
      ok(whatsapp.breakerStatus().state === 'closed', 'breaker: the circuit stays closed for message-level rejections');
      ok(r.failed === 3, 'breaker: the rejections are still recorded as failed attempts on their own entries');
    });
  })
  .then(function () {
    // The kill switch, and fail-closed on a corrupt breaker file.
    section('breaker-off', { MYTHOS_BRIDGE_WHATSAPP_BREAKER: 'off', MYTHOS_BRIDGE_WHATSAPP_FLUSH_LIMIT: '5' });
    ok(whatsapp.breakerStatus().enabled === false, 'breaker: MYTHOS_BRIDGE_WHATSAPP_BREAKER=off disables it entirely');
    ['gh-res-off-01', 'gh-res-off-02', 'gh-res-off-03'].forEach(function (id) { whatsapp.onReport(report(id, 'FAILED'), {}); });
    gateway.status = 500;
    return whatsapp.flush().then(function () {
      ok(received.length === 3, 'breaker: with the breaker off, behaviour is exactly what it was before this change');

      section('breaker-corrupt', { MYTHOS_BRIDGE_WHATSAPP_BREAKER_THRESHOLD: '2' });
      var cfg = whatsapp.config();
      fs.mkdirSync(cfg.home, { recursive: true, mode: 0o700 });
      fs.writeFileSync(cfg.breakerFile, '{ this is not json', { mode: 0o600 });
      ok(whatsapp.breakerGate(cfg, Date.now()).allow === true,
        'breaker: a corrupt breaker file fails CLOSED (towards attempting delivery) — it can never silently suppress notifications');
    });
  })

  // =================================================================
  // 5. Flush budget
  // =================================================================
  .then(function () {
    section('budget', {
      MYTHOS_BRIDGE_WHATSAPP_TO: '21620000001,21620000002,21620000003,21620000004',
      MYTHOS_BRIDGE_WHATSAPP_FLUSH_BUDGET_MS: '1000',
      MYTHOS_BRIDGE_WHATSAPP_BREAKER: 'off'
    });
    whatsapp.onReport(report('gh-res-budget-1', 'COMPLETED'), {});
    gateway.delayMs = 400;   // 4 recipients x 400 ms = 1600 ms > the 1000 ms budget
    var started = Date.now();
    return whatsapp.flush().then(function (r) {
      var elapsed = Date.now() - started;
      ok(elapsed < 2000, 'budget: the flush returns inside its wall-clock budget instead of running to completion (' + elapsed + ' ms)');
      ok(received.length >= 1 && received.length < 4, 'budget: only the recipients that fitted the budget were sent (' + received.length + ' of 4)');
      var e = entryFor('gh-res-budget-1');
      ok(e.state === 'PENDING', 'budget: the entry stays PENDING — it is NOT marked SENT just because nothing failed');
      ok(e.delivered_to.length === received.length, 'budget: exactly the delivered recipients are recorded');
      ok(e.attempts === 0, 'budget: a budget cut consumes no attempt — it is a local scheduling decision, not a delivery failure');
      ok(r.failed === 0 && r.deferred >= 1, 'budget: the flush reports the cut as deferred work, not as a failure');

      // The next flush finishes the job, and never re-sends.
      var deliveredFirst = e.delivered_to.slice();
      gateway.delayMs = 0;
      return whatsapp.flush().then(function () {
        var e2 = entryFor('gh-res-budget-1');
        ok(e2.state === 'SENT' && e2.delivered_to.length === 4, 'budget: the deferred recipients are delivered by the next flush');
        var counts = {};
        received.forEach(function (x) { counts[x.body.number] = (counts[x.body.number] || 0) + 1; });
        ok(Object.keys(counts).length === 4 && Object.keys(counts).every(function (k) { return counts[k] === 1; }),
          'budget: every recipient received exactly one message across both flushes');
        ok(deliveredFirst.every(function (to) { return counts[to] === 1; }), 'budget: a recipient delivered before the cut is never messaged again');
      });
    });
  })
  .then(function () {
    // The budget also bounds the number of ENTRIES a single flush processes.
    section('budget-entries', { MYTHOS_BRIDGE_WHATSAPP_FLUSH_BUDGET_MS: '900', MYTHOS_BRIDGE_WHATSAPP_FLUSH_LIMIT: '5', MYTHOS_BRIDGE_WHATSAPP_BREAKER: 'off' });
    ['gh-res-bge-01', 'gh-res-bge-02', 'gh-res-bge-03', 'gh-res-bge-04', 'gh-res-bge-05'].forEach(function (id) {
      whatsapp.onReport(report(id, 'COMPLETED'), {});
    });
    gateway.delayMs = 400;
    var started = Date.now();
    return whatsapp.flush().then(function (r) {
      var elapsed = Date.now() - started;
      ok(elapsed < 2000, 'budget: five due entries against a slow gateway still return inside the budget (' + elapsed + ' ms)');
      ok(r.results.some(function (x) { return x.skipped === 'flush budget exhausted'; }), 'budget: the entries that did not fit are explicitly deferred');
      ok(entriesIn().filter(function (e) { return e.state === 'PENDING'; }).length >= 1, 'budget: deferred entries remain PENDING and due');
      gateway.delayMs = 0;
    });
  })

  // =================================================================
  // 6. A notification is never lost because the credential was unreadable
  // =================================================================
  .then(function () {
    section('credential-loss', { MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE: path.join(FIX, 'missing.key') });
    var d = whatsapp.describe();
    ok(d.problems.some(function (p) { return /no credential/.test(p); }), 'credential: the missing credential is a readiness problem');
    ok(d.queue_problems.length === 0, 'credential: it is NOT a queue-scope problem — the entry can still be built');

    var q = whatsapp.onReport(report('gh-res-cred-01', 'FAILED'), {});
    ok(q.queued === true, 'credential: the terminal notification is queued even though the credential file is unreadable');
    ok(entryFor('gh-res-cred-01', 'FAILED').state === 'PENDING', 'credential: it waits in the ledger instead of being lost — the REPORT is written once and never revisited');

    return whatsapp.flush().then(function (r) {
      ok(r.ok === false && received.length === 0, 'credential: the flush refuses to send while the credential is missing');
      ok(entryFor('gh-res-cred-01', 'FAILED').attempts === 0, 'credential: the refusal consumes no attempt');
      // The operator repairs the credential; the queued notification survives.
      process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE = KEY_FILE;
      return whatsapp.flush().then(function () {
        ok(received.length === 1, 'credential: once the credential is readable again the queued notification is delivered');
        ok(entryFor('gh-res-cred-01', 'FAILED').state === 'SENT', 'credential: and the ledger records it exactly once');
      });
    });
  })
  .then(function () {
    // The documented security fence is unchanged: a non-private gateway
    // queues NOTHING, because that is a deliberate human decision, not a
    // transient failure.
    section('public-host', { MYTHOS_BRIDGE_WHATSAPP_BASE_URL: 'https://gateway.example.com' });
    var q = whatsapp.onReport(report('gh-res-public-1', 'COMPLETED'), {});
    ok(q.queued === false, 'private-network fence: a non-private gateway still queues nothing');
    ok(entriesIn().length === 0, 'private-network fence: no ledger entry is created');
    ok(whatsapp.queueReadiness(whatsapp.config()).some(function (p) { return /ALLOW_PUBLIC/.test(p); }),
      'private-network fence: the rule is a queue-scope problem, exactly as documented');
  })

  // =================================================================
  // 7. Regression guard: the Issues-mode tick must flush notifications
  // =================================================================
  .then(function () {
    var src = fs.readFileSync(path.join(EXEC, 'bin', 'mythos-github-bridge'), 'utf8');
    var start = src.indexOf("case 'tick':");
    var end = src.indexOf("case 'issues-tick':");
    ok(start !== -1 && end > start, 'cli: the tick command block was located');
    var block = src.slice(start, end);
    var issuesBranch = block.slice(block.indexOf('MYTHOS_ISSUES_ENABLED'), block.indexOf("var r = bridge.tick("));
    ok(issuesBranch.indexOf('flushNotifications') !== -1,
      'cli: the Issues-mode tick flushes notifications — without this the whole layer is inert in the only configuration production runs');
    ok((block.match(/flushNotifications/g) || []).length >= 2, 'cli: both tick paths flush, so the delivery behaviour does not depend on the mode');
    ok(src.indexOf('notify-breaker-reset') !== -1, 'cli: the breaker reset command is available to the operator');
  })

  // =================================================================
  // 8. No credential anywhere it should not be
  // =================================================================
  .then(function () {
    var leaked = [];
    (function walk(dir) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
        var p = path.join(dir, d.name);
        if (d.isDirectory()) return walk(p);
        if (p === KEY_FILE) return;
        var txt;
        try { txt = fs.readFileSync(p, 'utf8'); } catch (e) { return; }
        if (txt.indexOf(API_KEY) !== -1) leaked.push(p);
      });
    })(FIX);
    ok(leaked.length === 0, 'security: the credential appears in no ledger entry, breaker file or fixture — only in the 0600 key file');
    ok(JSON.stringify(whatsapp.describe()).indexOf(API_KEY) === -1, 'security: notify-config carries no credential');
    ok(JSON.stringify(whatsapp.ledgerStatus()).indexOf(API_KEY) === -1, 'security: notify-status carries no credential');
  });
}

server.listen(0, '127.0.0.1', function () {
  BASE_URL = 'http://127.0.0.1:' + server.address().port;
  run().then(function () {
    server.close();
    try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    console.log('bridge whatsapp resilience tests: ' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  }, function (e) {
    server.close();
    console.error('SUITE ERROR: ' + (e && e.stack || e));
    process.exit(1);
  });
});
