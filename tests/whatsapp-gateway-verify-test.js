'use strict';
// =====================================================
// ops/whatsapp/evolution/verify.js — readiness verifier guard
// tests/whatsapp-gateway-verify-test.js
//
// Runs the verifier as a child against an out-of-process loopback stub that
// impersonates Evolution API (`GET /` and `GET /instance/connectionState/…`).
// No real WhatsApp, no network beyond 127.0.0.1, and the stub counts every
// non-GET so the "never sends" guarantee is asserted, not assumed.
//
//   node tests/whatsapp-gateway-verify-test.js
// =====================================================

var http = require('http');
var fs = require('fs');
var os = require('os');
var path = require('path');
var execFile = require('child_process').execFile;

var ROOT = path.resolve(__dirname, '..');
var VERIFY = path.join(ROOT, 'ops/whatsapp/evolution/verify.js');
var COMPOSE = path.join(ROOT, 'ops/whatsapp/evolution/docker-compose.yml');
var DROPIN = path.join(ROOT, 'ops/whatsapp/evolution/bridge-dropin.conf.example');

var passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.error('FAIL: ' + name); } }

// raw stdout+stderr of every verifier run, for the key-leak check at the end
var ALL = [];

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-verify-test-'));
var keyFile = path.join(tmp, 'evolution.key');
var KEY = 'test-key-not-a-real-credential-0123456789';
fs.writeFileSync(keyFile, KEY, { mode: 0o600 });

var state = 'close';
var nonGet = 0;
var authOk = [];
var srv = http.createServer(function (req, res) {
  if (req.method !== 'GET') { nonGet++; res.writeHead(405); res.end(); return; }
  authOk.push(req.headers.apikey === KEY);
  if (req.url === '/') { res.end(JSON.stringify({ status: 200, message: 'Welcome to the Evolution API', version: '2.3.7' })); return; }
  if (req.url.indexOf('/instance/connectionState/mythos-bridge') === 0) {
    res.end(JSON.stringify({ instance: { instanceName: 'mythos-bridge', state: state } }));
    return;
  }
  res.writeHead(404); res.end('{}');
});

function run(extra) {
  return new Promise(function (resolve) {
    var env = Object.assign({}, process.env, {
      MYTHOS_BRIDGE_HOME: tmp,
      MYTHOS_BRIDGE_WHATSAPP_BASE_URL: 'http://127.0.0.1:' + srv.address().port,
      MYTHOS_BRIDGE_WHATSAPP_INSTANCE: 'mythos-bridge',
      MYTHOS_BRIDGE_WHATSAPP_TO: '21600000000',
      MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE: keyFile
    });
    delete env.MYTHOS_BRIDGE_WHATSAPP_ENABLED;
    delete env.MYTHOS_BRIDGE_WHATSAPP_API_KEY;
    Object.assign(env, extra || {});
    execFile('node', [VERIFY], { env: env, encoding: 'utf8' }, function (err, stdout, stderr) {
      var out = null;
      try { out = JSON.parse(stdout); } catch (e) { out = null; }
      ALL.push(String(stdout) + String(stderr));
      resolve({ code: err ? err.code : 0, out: out });
    });
  });
}

srv.listen(0, '127.0.0.1', function () {
  (async function () {
    // 1. static fences of the shipped files
    var compose = fs.readFileSync(COMPOSE, 'utf8');
    ok(/127\.0\.0\.1:\$\{EVOLUTION_BIND_PORT:-8080\}:8080/.test(compose), 'compose: API is published on loopback only');
    var pgBlock = compose.slice(compose.indexOf('\n  evolution-postgres:\n'), compose.indexOf('\nnetworks:'));
    ok(pgBlock.length > 0 && !/^\s+ports:/m.test(pgBlock), 'compose: Postgres publishes no port');
    ok(/AUTHENTICATION_API_KEY: "\$\{EVOLUTION_API_KEY:\?/.test(compose), 'compose: API key is a required env-file variable, not a literal');
    ok(/mem_limit:/.test(compose) && /pids_limit:/.test(compose), 'compose: hard memory and pid caps are set');
    ok(!/(apikey|password|key)\s*[:=]\s*"?[A-Za-z0-9]{24,}/i.test(compose), 'compose: no literal that looks like a credential');
    var dropin = fs.readFileSync(DROPIN, 'utf8');
    ok(!/^Environment=MYTHOS_BRIDGE_WHATSAPP_ENABLED=1/m.test(dropin), 'drop-in template: sending is NOT enabled');
    ok(/^Environment=MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE=%h\/mythos-ai-executor\/secrets\/evolution\.key/m.test(dropin), 'drop-in template: credential comes from the 0600 file');
    ok(/^Environment=MYTHOS_BRIDGE_WHATSAPP_TO=REPLACE_WITH_DIGITS_ONLY_MSISDN/m.test(dropin), 'drop-in template: recipient is a placeholder, not a real number');

    // 2. unpaired instance → NOT_READY, exit 2
    var r = await run();
    ok(r.code === 2 && r.out && r.out.verdict === 'NOT_READY', 'unpaired: NOT_READY with exit 2');
    ok(r.out && r.out.gateway_reachable === true && r.out.gateway_version === '2.3.7', 'unpaired: gateway reachable and version reported');
    ok(r.out && r.out.instance_state === 'close', 'unpaired: instance state surfaced');
    ok(r.out && r.out.sending_enabled === false, 'unpaired: sending reported disabled');
    ok(r.out && Array.isArray(r.out.bridge_problems) && r.out.bridge_problems.length === 0, 'unpaired: bridge config itself is clean');

    // 3. paired, sending disabled → READY_FOR_ACTIVATION_REVIEW, exit 0
    state = 'open';
    r = await run();
    ok(r.code === 0 && r.out && r.out.verdict === 'READY_FOR_ACTIVATION_REVIEW', 'paired: READY_FOR_ACTIVATION_REVIEW with exit 0');
    ok(r.out && r.out.ready === true && r.out.sending_enabled === false, 'paired: ready, still not sending');

    // 4. paired + enabled → the verdict names it, so an operator cannot miss it
    r = await run({ MYTHOS_BRIDGE_WHATSAPP_ENABLED: '1' });
    ok(r.code === 0 && r.out && r.out.verdict === 'READY_AND_SENDING_ENABLED', 'enabled: verdict says sending is enabled');

    // 5. public gateway host is refused before any request
    var before = authOk.length;
    r = await run({ MYTHOS_BRIDGE_WHATSAPP_BASE_URL: 'http://example.com:' + srv.address().port });
    ok(r.code === 1 && r.out && r.out.verdict === 'UNUSABLE_CONFIG', 'public host: UNUSABLE_CONFIG, exit 1');
    ok(authOk.length === before, 'public host: no request was made');

    // 6. credential file mode other than 0600 blocks readiness
    fs.chmodSync(keyFile, 0o644);
    r = await run();
    ok(r.code === 2 && r.out && r.out.credential_file && r.out.credential_file.mode === '0644' && r.out.ready === false, '0644 key file: not ready, mode reported');
    fs.chmodSync(keyFile, 0o600);

    // 7. unknown instance → NOT_CREATED
    r = await run({ MYTHOS_BRIDGE_WHATSAPP_INSTANCE: 'other' });
    ok(r.code === 2 && r.out && r.out.instance_state === 'NOT_CREATED', 'unknown instance: NOT_CREATED');

    // 8. unreachable gateway → GATEWAY_UNREACHABLE, exit 1
    r = await run({ MYTHOS_BRIDGE_WHATSAPP_BASE_URL: 'http://127.0.0.1:1' });
    ok(r.code === 1 && r.out && r.out.verdict === 'GATEWAY_UNREACHABLE', 'unreachable: GATEWAY_UNREACHABLE, exit 1');

    // 9. the guarantees: never a non-GET, apikey header present on every GET, key never printed
    ok(nonGet === 0, 'guarantee: the verifier never sent anything but GET');
    ok(authOk.length >= 8 && authOk.every(Boolean), 'guarantee: apikey header carried the file value on every request');
    var leaked = false;
    for (var i = 0; i < ALL.length; i++) if (ALL[i].indexOf(KEY) !== -1) leaked = true;
    ok(!leaked, 'guarantee: the key never appears in stdout/stderr');

    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('whatsapp gateway verify tests: ' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  })().catch(function (e) {
    console.error(e);
    try { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); } catch (e2) { /* best effort */ }
    process.exit(1);
  });
});
