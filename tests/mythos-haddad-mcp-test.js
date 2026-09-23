'use strict';
// =====================================================
// MYTHOS HADDAD — HAD-3: OTH MCP on Haddad (launcher + configuration layer)
// tests/mythos-haddad-mcp-test.js
//
// The server itself (projects/oth-mcp/server.js) is covered by
// tests/othk-6-mcp-server-test.js and is NOT re-tested here. This suite
// covers what HAD-3 adds around it, and nothing else:
//   * reuse, not duplication: the launcher runs projects/oth-mcp/server.js
//     and no second MCP server exists under projects/mythos-haddad;
//   * the launcher and setup carry no secret and no host-key bypass;
//   * the credential-by-reference path: the executor bearer read from the
//     executor's own env file reaches the upstream — and never the client;
//   * the real chain through the launcher: initialize → tools/list →
//     tools/call → a (fake, loopback) executor → correct result;
//   * fail-closed: no token file → UNCONFIGURED; wrong bearer → 401;
//     traversal-shaped ids rejected; malformed frame → parse error;
//   * lifecycle: stdin end → clean exit, repeated and concurrent clients;
//   * haddad_health: the one Haddad-native tool, present ONLY when the
//     launcher environment names the health report (the VPS keeps 8 tools),
//     reading a fixed path, never a request-named one; stale detection.
// Offline and machine-independent: a fake executor on an ephemeral
// loopback port, a throwaway config dir, an invented token.
// =====================================================
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var DIR = path.join(ROOT, 'projects', 'mythos-haddad');
var LAUNCHER = path.join(DIR, 'bin', 'haddad-mcp-stdio.sh');
var SETUP = path.join(DIR, 'bin', 'haddad-mcp-setup.sh');
var SERVER = path.join(ROOT, 'projects', 'oth-mcp', 'server.js');
var mcp = require(SERVER);

var pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e)); } }
function at(name, fn) { return fn().then(function () { pass++; console.log('ok - ' + name); }, function (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e)); }); }
function run(cmd, args, opts) { return cp.spawnSync(cmd, args, Object.assign({ encoding: 'utf8', timeout: 60000 }, opts || {})); }
// Async variant for probes that must reach the fake executor hosted by THIS process: spawnSync would block the event loop the fake server answers on.
function runAsync(cmd, args, opts) {
  return new Promise(function (resolve) {
    var p = cp.spawn(cmd, args, Object.assign({ stdio: ['ignore', 'pipe', 'pipe'] }, opts || {})); var out = '', err = '';
    p.stdout.on('data', function (d) { out += d; }); p.stderr.on('data', function (d) { err += d; });
    p.on('close', function (code) { resolve({ status: code, stdout: out, stderr: err }); });
  });
}

var TOKEN = 'haddad-test-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'haddad-mcp-'));
var CFG = path.join(TMP, 'cfg'); fs.mkdirSync(CFG, { mode: 448 });
var EXEC_ENV = path.join(TMP, 'executor.env');
fs.writeFileSync(EXEC_ENV, '# executor\nMYTHOS_EXECUTOR_TOKEN=' + TOKEN + '\n', { mode: 384 });

// A loopback stand-in for the executor API: same auth contract as
// projects/mythos-ai-executor/server.js (bearer on every route but /health).
var seen = [];
function fakeExecutor() {
  return new Promise(function (resolve) {
    var srv = http.createServer(function (req, res) {
      seen.push({ url: req.url, auth: req.headers.authorization || null });
      var m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');
      if (!m || m[1] !== TOKEN) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"unauthorized"}'); }
      if (req.url === '/tasks') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ tasks: [{ id: 't-haddad-0001', status: 'COMPLETED' }] })); }
      if (req.url === '/tasks/t-haddad-0001/report') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ report: { summary: 'done on haddad' } })); }
      if (req.url === '/budget/mythos-haddad') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ project: 'mythos-haddad', configured: false, limit: 0 })); }
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"not found"}');
    });
    srv.listen(0, '127.0.0.1', function () { resolve({ srv: srv, port: srv.address().port }); });
  });
}

var REPORT = path.join(TMP, 'health-latest.json');
function writeReport(generatedAt, checks) {
  fs.writeFileSync(REPORT, JSON.stringify({ schema: 'mythos-haddad-health/1', host: 'haddad-test', generated_at: generatedAt, mode: 'full',
    status: 'PASS', counts: { PASS: checks.length, WARN: 0, FAIL: 0 }, checks: checks }));
}
writeReport(new Date().toISOString(), [
  { id: 'gpu_test', status: 'PASS', detail: 'NVIDIA GeForce GTX 1660 SUPER, Vulkan 1.4' },
  { id: 'ai_runtime', status: 'PASS', detail: 'llama-server active', data: { model: 'qwen-test.gguf' } },
]);

function writeEnv(cfgDir, lines) { fs.writeFileSync(path.join(cfgDir, 'mcp.env'), lines.join('\n') + '\n', { mode: 384 }); }

// Drive the launcher as a raw client: newline-delimited JSON-RPC over
// stdio. stdin stays open until every id sent has been answered (a stdio
// server exits with its stdin), then it is closed and the exit awaited.
function client(frames, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var env = Object.assign({}, process.env, { HADDAD_MCP_CONFIG_DIR: opts.cfg || CFG });
    delete env.OTH_MCP_EXECUTOR_TOKEN; delete env.OTH_MCP_EXECUTOR_URL; delete env.OTH_MCP_EXECUTOR_TOKEN_FILE;
    var p = cp.spawn(LAUNCHER, [], { env: env, stdio: ['pipe', 'pipe', 'pipe'] });
    var out = '', err = '', ended = false;
    var expected = {}; frames.forEach(function (f) { if (f && typeof f === 'object' && f.id !== undefined) expected[f.id] = true; });
    var parseErrors = frames.filter(function (f) { return typeof f === 'string'; }).length;
    function answered() {
      var lines = out.split('\n').filter(Boolean), got = {}, perr = 0;
      lines.forEach(function (l) { try { var m = JSON.parse(l); if (m.id !== undefined && m.id !== null) got[m.id] = true; else if (m.error) perr++; } catch (e) { /* partial line */ } });
      return Object.keys(expected).every(function (id) { return got[id]; }) && perr >= parseErrors;
    }
    function endStdin() { if (!ended) { ended = true; clearTimeout(guard); try { p.stdin.end(); } catch (e) { /* gone */ } } }
    var guard = setTimeout(endStdin, 25000);
    p.stdout.on('data', function (d) { out += d; if (answered()) endStdin(); });
    p.stderr.on('data', function (d) { err += d; });
    p.on('close', function (code) {
      var parsed = out.split('\n').filter(Boolean).map(function (l) { try { return JSON.parse(l); } catch (e) { return { unparseable: l }; } });
      var byId = {}; parsed.forEach(function (f) { if (f.id !== undefined) byId[f.id] = f; });
      resolve({ code: code, out: out, err: err, frames: parsed, byId: byId });
    });
    frames.forEach(function (f) { p.stdin.write((typeof f === 'string' ? f : JSON.stringify(f)) + '\n'); });
    if (!Object.keys(expected).length && !parseErrors) endStdin();
  });
}
var INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } };
var LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
function call(id, name, args) { return { jsonrpc: '2.0', id: id, method: 'tools/call', params: { name: name, arguments: args || {} } }; }
function text(frame) { return frame && frame.result && frame.result.content && frame.result.content[0] && frame.result.content[0].text || ''; }

// ---------------------------------------------------------------- static
t('launcher and setup exist, are executable and parse', function () {
  [LAUNCHER, SETUP].forEach(function (f) {
    assert.ok(fs.statSync(f).mode & 64, f + ' not executable');
    var r = run('bash', ['-n', f]); assert.strictEqual(r.status, 0, r.stderr);
  });
});

t('reuse, not duplication: the launcher runs projects/oth-mcp/server.js and no second MCP server exists under mythos-haddad', function () {
  var src = fs.readFileSync(LAUNCHER, 'utf8');
  assert.ok(/projects\/oth-mcp\/server\.js/.test(src), 'launcher does not reference the shared server');
  assert.ok(/exec node "\$SERVER"/.test(src), 'launcher does not exec the shared server');
  var walk = function (d, acc) { fs.readdirSync(d).forEach(function (f) { var p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p, acc); else acc.push(p); }); return acc; };
  walk(DIR, []).forEach(function (f) {
    if (!/\.js$/.test(f)) return;
    var s = fs.readFileSync(f, 'utf8');
    // A server answers these methods; a client (the probe, via the shared mcp-client) only sends them.
    assert.ok(!/method === '(initialize|tools\/list|tools\/call)'/.test(s), 'second MCP server implementation found: ' + f);
  });
});

t('no secret value, no host-key bypass, no sudo in the HAD-3 files', function () {
  [LAUNCHER, SETUP].forEach(function (f) {
    var s = fs.readFileSync(f, 'utf8');
    assert.ok(!/StrictHostKeyChecking\s*=?\s*no/.test(s), f + ' bypasses host key checking');
    assert.ok(!/^\s*sudo\b/m.test(s), f + ' uses sudo');
    assert.ok(!/(TOKEN|KEY|SECRET)=[A-Za-z0-9+\/]{20,}/.test(s), f + ' carries a literal credential');
  });
  // The generated mcp.env carries paths and URLs only — the bearer stays in the executor's file.
  var setup = fs.readFileSync(SETUP, 'utf8');
  var envBlock = /cat > "\$ENV_FILE" <<ENV([\s\S]*?)^ENV$/m.exec(setup);
  assert.ok(envBlock, 'setup does not write mcp.env via heredoc');
  assert.ok(!/OTH_MCP_EXECUTOR_TOKEN=/.test(envBlock[1]), 'mcp.env would carry the token value');
  assert.ok(/OTH_MCP_EXECUTOR_TOKEN_FILE=/.test(envBlock[1]), 'mcp.env does not reference the executor file');
});

t('the shared server is the VPS one: 8 read-only tools without Haddad config, GET is the only upstream verb', function () {
  assert.strictEqual(mcp.TOOLS.length, 8, 'the VPS tool set changed');
  assert.ok(!mcp.TOOL_BY_NAME.haddad_health, 'haddad_health must not exist without OTH_MCP_HADDAD_HEALTH_FILE');
  var withEnv = run('node', ['-e', 'process.env.OTH_MCP_HADDAD_HEALTH_FILE="/x";var m=require(process.argv[1]);process.stdout.write(m.TOOLS.map(function(t){return t.name}).join(","))', SERVER]);
  assert.strictEqual(withEnv.stdout.split(',').length, 9);
  assert.ok(/haddad_health$/.test(withEnv.stdout), 'haddad_health is the 9th tool when configured');
  assert.ok(!mcp.TOOLS.concat().some(function (t) { return /create|write|update|delete|ingest|promote|establish|dispatch|approve|run_/i.test(t.name); }));
  var src0 = fs.readFileSync(SERVER, 'utf8');
  assert.ok(!/fs\.(write|append|unlink|rm|mkdir|rename|chmod|open)/.test(src0), 'a write syscall appeared in the server');
  assert.ok(/OTH_MCP_HADDAD_HEALTH_FILE/.test(src0) && !/readFileSync\((?!LOCAL_REPORT_FILE)/.test(src0), 'the only file read is the launch-time report path');
  var src = fs.readFileSync(SERVER, 'utf8');
  assert.ok(/method: 'GET'/.test(src));
  assert.ok(!/method: '(POST|PUT|PATCH|DELETE)'/.test(src));
  assert.strictEqual(mcp.PROTOCOL_VERSION, '2024-11-05');
});

t('the health check has mcp and worker checks, both optional when uninstalled', function () {
  var s = fs.readFileSync(path.join(DIR, 'bin', 'haddad-health.js'), 'utf8');
  assert.ok(/check\('mcp'/.test(s) && /check\('worker'/.test(s));
  assert.ok(/8160|4444/.test(s), 'no unexpected-listener assertion');
  assert.ok(/haddad-mcp-setup\.sh/.test(s), 'uninstalled hint missing');
});


// ------------------------------------------------------- static: HAD-3b (HTTP transport)
var HTTP_SETUP = path.join(DIR, 'bin', 'haddad-mcp-http-setup.sh');
var HTTP_UNIT = path.join(DIR, 'systemd', 'mythos-haddad-mcp-http.service');
var BRIDGE = path.join(ROOT, 'projects', 'mythos-gateway', 'mcp-http-bridge.js');
var PROBE = path.join(DIR, 'bin', 'haddad-mcp-probe.js');

t('HAD-3b reuse: the HTTP transport is the VPS bridge, unchanged, in front of the stdio launcher — no second server, no second port, loopback pinned', function () {
  var u = fs.readFileSync(HTTP_UNIT, 'utf8');
  assert.ok(/^ExecStart=\/usr\/bin\/node @REPO@\/projects\/mythos-gateway\/mcp-http-bridge\.js$/m.test(u), 'unit does not run the shared bridge');
  assert.ok(/^Environment=MYTHOS_MCP_HTTP_HOST=127\.0\.0\.1$/m.test(u), 'bind not pinned to loopback');
  assert.ok(/^Environment=MYTHOS_MCP_HTTP_PORT=8160$/m.test(u), 'port not pinned');
  assert.ok(/^Environment=MYTHOS_MCP_LAUNCHER=%h\/\.local\/bin\/haddad-mcp-stdio\.sh$/m.test(u), 'bridge does not relay to the installed stdio launcher');
  assert.ok(/^EnvironmentFile=%h\/\.config\/mythos-haddad\/mcp-http\.env$/m.test(u), 'bearer file not referenced');
  assert.ok(!/0\.0\.0\.0|100\.\d+\.\d+\.\d+|\[::\]|MYTHOS_MCP_HTTP_TOKEN=/.test(u), 'unit widens the bind or carries a token');
  assert.ok(/^WantedBy=default\.target$/m.test(u), 'not a user unit');
  // The bridge itself is the file gateway-boundary already pins; it declares no tool.
  var b = fs.readFileSync(BRIDGE, 'utf8');
  assert.ok(!/knowledge_search|execution_status|haddad_health/.test(b), 'the bridge names a tool — it has become a server');
  assert.ok(/MYTHOS_MCP_HTTP_TOKEN is required/.test(b) && /timingSafeEqual/.test(b), 'bridge auth contract changed');
});

t('HAD-3b setup: executable, parses, no sudo, no Funnel, serves /mcp only, never a literal token', function () {
  assert.ok(fs.statSync(HTTP_SETUP).mode & 64, 'not executable');
  var r = run('bash', ['-n', HTTP_SETUP]); assert.strictEqual(r.status, 0, r.stderr);
  var s = fs.readFileSync(HTTP_SETUP, 'utf8');
  assert.ok(!/^\s*sudo\b/m.test(s), 'uses sudo');
  assert.ok(!/\bfunnel\b(?!.*never)/i.test(s.replace(/^#.*$/mg, '')), 'Funnel (public exposure) appears in executable code');
  // Serve strips the --set-path mount point: the target must name the bridge's /mcp route (a bare host:port gives HTTPS 404).
  assert.ok(/serve --bg --https=443 --set-path=\/mcp "http:\/\/\$HOST:\$PORT\/mcp"/.test(s), 'serve target is not the bridge /mcp route');
  assert.ok(!/--set-path=\/mcp "http:\/\/\$HOST:\$PORT"/.test(s), 'serve target lost its /mcp path (HTTPS would reach the bridge at "/" and 404)');
  assert.ok(/\/health is reachable over HTTPS/.test(s), 'setup does not assert that /health stays unserved');
  assert.ok(!/(TOKEN|KEY|SECRET)=[A-Za-z0-9+\/]{20,}/.test(s), 'carries a literal credential');
  assert.ok(/haddad-mcp-setup\.sh first/.test(s), 'does not require the stdio MCP (HAD-3) first');
  assert.ok(/carries something other than MYTHOS_MCP_HTTP_TOKEN/.test(s), 'does not refuse an env file that could widen the bind');
});

t('HAD-3b probe and health: --http drives the shared client\'s streamable-http transport with the bearer by reference; health measures 401, loopback bind and tool-list equality', function () {
  var p = fs.readFileSync(PROBE, 'utf8');
  assert.ok(/createHttpClient\(\{ url: httpUrl, token: token/.test(p), 'probe does not use the shared HTTP client');
  assert.ok(/HADDAD_MCP_HTTP_ENV/.test(p) && !/--token/.test(p), 'token must come from the 0600 file, never argv');
  var h = fs.readFileSync(path.join(DIR, 'bin', 'haddad-health.js'), 'utf8');
  assert.ok(/mythos-haddad-mcp-http\.service/.test(h) && /mcp-http\.env/.test(h));
  assert.ok(/a !== '127\.0\.0\.1:8160'/.test(h), 'health does not refuse a non-loopback 8160 bind');
  assert.ok(/unauth !== '401'/.test(h), 'health does not require 401 without a bearer');
  assert.ok(/hrep\.tools\.join\(','\) !== rep\.tools\.join\(','\)/.test(h), 'health does not compare HTTP and stdio tool lists');
  assert.ok(/'4444'/.test(h), 'the VPS gateway port is no longer refused');
  assert.ok(/!httpInstalled && on8160\.length/.test(h), 'an unowned 8160 listener is no longer refused');
  assert.ok(/8160\\\/mcp\\\/\?\$/.test(h), 'health does not require the Serve target to carry /mcp');
  assert.ok(/serveMiswired/.test(h) && /Serve strips the mount point/.test(h), 'health does not FAIL a Serve target without /mcp');
});

// --------------------------------------------- static: HAD-3c (/mcphaddad on the VPS)
var ROUTE_SNIP = path.join(DIR, 'nginx', 'mythos-mcp-haddad.conf');
var ROUTE_SH = path.join(DIR, 'bin', 'haddad-mcp-vps-route.sh');

t('HAD-3c route: one exact nginx location relays to the existing Serve endpoint with strict TLS, leaves Authorization untouched and never claims /mcp', function () {
  var c = fs.readFileSync(ROUTE_SNIP, 'utf8').replace(/^\s*#.*$/mg, '');
  var locs = c.match(/^\s*location\b.*$/mg) || [];
  assert.deepStrictEqual(locs.map(function (l) { return l.trim(); }), ['location = /mcphaddad {'], 'the snippet must add exactly one exact-match location');
  assert.ok(/proxy_pass https:\/\/100\.78\.7\.10\/mcp;/.test(c), 'upstream is not the Haddad Serve /mcp over the tailnet IP');
  assert.ok(/proxy_ssl_verify on;/.test(c) && /proxy_ssl_name haddad\.tail23f990\.ts\.net;/.test(c) && /proxy_ssl_server_name on;/.test(c), 'upstream TLS is not verified against the node name');
  assert.ok(/proxy_set_header Host haddad\.tail23f990\.ts\.net;/.test(c), 'Host is not the node name');
  // The Haddad bridge is the only authority: nginx must neither strip, replace nor add a credential.
  assert.ok(!/Authorization|auth_request|auth_basic|TOKEN|Bearer/i.test(c), 'the route touches authentication');
  assert.ok(!/resolver\b/.test(c), 'a resolver makes the route depend on MagicDNS on the VPS');
  assert.ok(/proxy_buffering off;/.test(c), 'streamed MCP responses would be buffered');
});

t('HAD-3c install script: parses, root-only, never joins the tailnet or touches Serve/Funnel, refuses without a verified 401 from Haddad, rolls back on nginx -t', function () {
  assert.ok(fs.statSync(ROUTE_SH).mode & 64, 'not executable');
  var r = run('bash', ['-n', ROUTE_SH]); assert.strictEqual(r.status, 0, r.stderr);
  var s = fs.readFileSync(ROUTE_SH, 'utf8').replace(/^#.*$/mg, '');
  assert.ok(!/tailscale (up|login|serve|funnel (on|--)|set)\b/.test(s), 'the script changes tailnet membership, Serve or Funnel');
  assert.ok(/tailscale funnel status/.test(s) && /REFUSED — Funnel is on/.test(s), 'the script does not refuse a Funnel-exposed node');
  assert.ok(/\[ "\$code" = 401 \]/.test(s) && /--resolve "\$NODE_NAME:443:\$NODE_IP"/.test(s), 'preflight does not require the bridge 401 over strict TLS');
  assert.ok(/ANCHOR='include snippets\/mythos-mcp-auth\.conf;'/.test(s), 'not anchored after the existing /mcp include');
  assert.ok(/nginx -t failed — vhost restored/.test(s), 'no rollback when nginx -t fails');
  assert.ok(!/mythos-mcp-auth(-proxy|-dex)?\.conf"?\s*$/m.test(s.replace(/ANCHOR=.*$/m, '')), 'the script writes an /mcp snippet');
  assert.ok(!/(TOKEN|KEY|SECRET)=[A-Za-z0-9+\/]{20,}/.test(s) && !/Authorization/.test(s), 'the script handles a credential');
});

// --------------------------------------------------------------- dynamic
var exec_;
at('fake executor up', function () { return fakeExecutor().then(function (e) { exec_ = e; }); })
.then(function () {
  writeEnv(CFG, ['OTH_MCP_EXECUTOR_URL=http://127.0.0.1:' + exec_.port, 'OTH_MCP_EXECUTOR_TOKEN_FILE=' + EXEC_ENV, 'OTH_MCP_HADDAD_HEALTH_FILE=' + REPORT]);

  return at('real chain: initialize → tools/list → execution_status → fake executor → correct result, token never returned', function () {
    return client([INIT, LIST, call(3, 'execution_status'), call(4, 'execution_report', { task_id: 't-haddad-0001' }), call(5, 'budget_status', { project: 'mythos-haddad' })]).then(function (r) {
      assert.strictEqual(r.code, 0, 'exit ' + r.code + ' ' + r.err);
      assert.strictEqual(r.byId[1].result.serverInfo.name, 'oth-mcp');
      assert.strictEqual(r.byId[2].result.tools.length, 9);
      assert.ok(!r.byId[3].result.isError, text(r.byId[3]));
      assert.deepStrictEqual(JSON.parse(text(r.byId[3])), { tasks: [{ id: 't-haddad-0001', status: 'COMPLETED' }] });
      assert.deepStrictEqual(JSON.parse(text(r.byId[4])).report, { summary: 'done on haddad' });
      assert.strictEqual(JSON.parse(text(r.byId[5])).configured, false);
      assert.strictEqual(seen[seen.length - 1].auth, 'Bearer ' + TOKEN, 'bearer did not reach the upstream by reference');
      assert.ok(r.out.indexOf(TOKEN) === -1 && r.err.indexOf(TOKEN) === -1, 'token leaked to the client side');
    });
  });
})
.then(function () {
  return at('fail closed: no executor token file → UPSTREAM_UNCONFIGURED, nothing invented, no upstream call', function () {
    var cfg = path.join(TMP, 'cfg-notoken'); fs.mkdirSync(cfg);
    writeEnv(cfg, ['OTH_MCP_EXECUTOR_URL=http://127.0.0.1:' + exec_.port, 'OTH_MCP_EXECUTOR_TOKEN_FILE=' + path.join(TMP, 'absent.env')]);
    var before = seen.length;
    return client([INIT, call(3, 'execution_status')], { cfg: cfg }).then(function (r) {
      assert.ok(r.byId[3].result.isError);
      assert.ok(/^UPSTREAM_UNCONFIGURED: Mythos AI Executor/.test(text(r.byId[3])), text(r.byId[3]));
      assert.strictEqual(seen.length, before);
    });
  });
})
.then(function () {
  return at('unauthorized: a wrong bearer is refused by the upstream and reported as UPSTREAM_401', function () {
    var cfg = path.join(TMP, 'cfg-badtoken'); fs.mkdirSync(cfg);
    var bad = path.join(TMP, 'bad.env'); fs.writeFileSync(bad, 'MYTHOS_EXECUTOR_TOKEN=not-the-token\n', { mode: 384 });
    writeEnv(cfg, ['OTH_MCP_EXECUTOR_URL=http://127.0.0.1:' + exec_.port, 'OTH_MCP_EXECUTOR_TOKEN_FILE=' + bad]);
    return client([INIT, call(3, 'execution_status')], { cfg: cfg }).then(function (r) {
      assert.ok(/^UPSTREAM_401/.test(text(r.byId[3])), text(r.byId[3]));
    });
  });
})
.then(function () {
  return at('invalid / malformed / traversal-shaped requests are rejected without reaching the upstream', function () {
    var before = seen.length;
    return client([INIT,
      '{not json',
      { jsonrpc: '2.0', id: 10, method: 'no/such/method' },
      call(11, 'no_such_tool'),
      call(12, 'execution_report', {}),
      call(13, 'execution_report', { task_id: '../../etc/passwd' }),
      call(14, 'budget_status', { project: '../secrets' }),
      call(15, 'execution_status', { task_id: 'x'.repeat(65) }),
    ]).then(function (r) {
      var parseErr = r.frames.filter(function (f) { return f.error && f.error.code === -32700; });
      assert.strictEqual(parseErr.length, 1, 'malformed frame not answered with -32700');
      assert.strictEqual(r.byId[10].error.code, -32601);
      assert.ok(/No such tool/.test(text(r.byId[11])));
      assert.ok(/TOOL_INPUT: task_id is required/.test(text(r.byId[12])));
      // The id is URL-encoded, so the executor route regex never matches it: 404 from the upstream, never a file.
      assert.ok(/UPSTREAM_404/.test(text(r.byId[13])), text(r.byId[13]));
      assert.ok(seen.filter(function (s) { return /passwd/.test(s.url); }).every(function (s) { return s.url.indexOf('..%2F') !== -1; }), 'traversal id sent unencoded');
      assert.ok(/TOOL_INPUT: project must match/.test(text(r.byId[14])));
      assert.ok(/TOOL_INPUT: task_id exceeds/.test(text(r.byId[15])));
      assert.ok(seen.length - before <= 1, 'more than the encoded 404 probe reached the upstream');
    });
  });
})
.then(function () {
  return at('timeout: an upstream that never answers is reported as UPSTREAM_TIMEOUT-class, not hung forever', function () {
    // The server's own 15 s bound applies; here the socket is refused, which is the fast variant of the same fail-closed path.
    var cfg = path.join(TMP, 'cfg-down'); fs.mkdirSync(cfg);
    writeEnv(cfg, ['OTH_MCP_EXECUTOR_URL=http://127.0.0.1:1', 'OTH_MCP_EXECUTOR_TOKEN_FILE=' + EXEC_ENV]);
    return client([INIT, call(3, 'execution_status')], { cfg: cfg }).then(function (r) {
      assert.ok(/^UPSTREAM_UNREACHABLE: Mythos AI Executor/.test(text(r.byId[3])), text(r.byId[3]));
    });
  });
})
.then(function () {
  return at('lifecycle: stdin end → exit 0; three concurrent clients each get their own answers', function () {
    return Promise.all([0, 1, 2].map(function (i) { return client([INIT, call(100 + i, 'execution_status')]); })).then(function (rs) {
      rs.forEach(function (r, i) {
        assert.strictEqual(r.code, 0);
        assert.ok(r.byId[100 + i] && !r.byId[100 + i].result.isError, 'client ' + i + ': ' + text(r.byId[100 + i]));
      });
    });
  });
})
.then(function () {
  return at('haddad_health: whole report, one check, staleness, bad check id, absent/corrupt report, absent config', function () {
    return client([INIT, call(3, 'haddad_health'), call(4, 'haddad_health', { check: 'ai_runtime' }), call(5, 'haddad_health', { check: 'nope' }), call(6, 'haddad_health', { check: '../x' })]).then(function (r) {
      var whole = JSON.parse(text(r.byId[3]));
      assert.strictEqual(whole.host, 'haddad-test'); assert.strictEqual(whole.stale, false); assert.strictEqual(whole.checks.length, 2); assert.ok(whole.age_seconds < 60);
      var one = JSON.parse(text(r.byId[4]));
      assert.strictEqual(one.check.id, 'ai_runtime'); assert.strictEqual(one.check.data.model, 'qwen-test.gguf'); assert.ok(!one.checks);
      assert.ok(/TOOL_INPUT: no such check: nope \(known: gpu_test, ai_runtime\)/.test(text(r.byId[5])), text(r.byId[5]));
      assert.ok(/TOOL_INPUT: check must match/.test(text(r.byId[6])), text(r.byId[6]));
      // stale: a report older than two hours says so, and is still returned
      writeReport(new Date(Date.now() - 3 * 3600 * 1000).toISOString(), [{ id: 'os', status: 'PASS' }]);
      return client([INIT, call(3, 'haddad_health')]);
    }).then(function (r) {
      var rep = JSON.parse(text(r.byId[3])); assert.strictEqual(rep.stale, true); assert.ok(rep.age_seconds > 10000);
      fs.writeFileSync(REPORT, '{not json');
      return client([INIT, call(3, 'haddad_health')]);
    }).then(function (r) {
      assert.ok(/^UPSTREAM_BAD_JSON: Mythos Haddad health report/.test(text(r.byId[3])), text(r.byId[3]));
      fs.unlinkSync(REPORT);
      return client([INIT, call(3, 'haddad_health')]);
    }).then(function (r) {
      assert.ok(/^UPSTREAM_UNREACHABLE: Mythos Haddad health report is not present/.test(text(r.byId[3])), text(r.byId[3]));
      assert.ok(text(r.byId[3]).indexOf(TMP) === -1, 'the report path leaked into the error');
      writeReport(new Date().toISOString(), [{ id: 'os', status: 'PASS' }]);
      // without the variable the tool does not exist at all (the VPS case)
      var cfg = path.join(TMP, 'cfg-nohealth'); fs.mkdirSync(cfg);
      writeEnv(cfg, ['OTH_MCP_EXECUTOR_URL=http://127.0.0.1:' + exec_.port, 'OTH_MCP_EXECUTOR_TOKEN_FILE=' + EXEC_ENV]);
      return client([INIT, LIST, call(3, 'haddad_health')], { cfg: cfg });
    }).then(function (r) {
      assert.strictEqual(r.byId[2].result.tools.length, 8);
      assert.ok(/No such tool: haddad_health/.test(text(r.byId[3])));
    });
  });
})
.then(function () {
  return at('upstream timeout: an executor that accepts and never answers is reported as UPSTREAM_TIMEOUT after the server\'s own bound', function () {
    return new Promise(function (resolve) {
      var hang = http.createServer(function () { /* never answers */ });
      hang.listen(0, '127.0.0.1', function () { resolve(hang); });
    }).then(function (hang) {
      var cfg = path.join(TMP, 'cfg-hang'); fs.mkdirSync(cfg);
      writeEnv(cfg, ['OTH_MCP_EXECUTOR_URL=http://127.0.0.1:' + hang.address().port, 'OTH_MCP_EXECUTOR_TOKEN_FILE=' + EXEC_ENV]);
      var t0 = Date.now();
      return client([INIT, call(3, 'execution_status')], { cfg: cfg }).then(function (r) {
        hang.close();
        assert.ok(/^UPSTREAM_TIMEOUT: Mythos AI Executor did not answer within 15000ms/.test(text(r.byId[3])), text(r.byId[3]));
        assert.ok(Date.now() - t0 >= 14000 && Date.now() - t0 < 24000, 'timeout fired at ' + (Date.now() - t0) + 'ms');
      });
    });
  });
})
.then(function () {
  return at('environment leakage: no launcher environment value reaches a client through any answer', function () {
    var marker = 'CANARY-' + Math.random().toString(36).slice(2);
    var env = { CANARY_SECRET: marker, HADDAD_MCP_CONFIG_DIR: CFG };
    return new Promise(function (resolve) {
      var p = cp.spawn(LAUNCHER, [], { env: Object.assign({}, process.env, env) });
      var out = '';
      p.stdout.on('data', function (d) { out += d; if ((out.match(/\n/g) || []).length >= 5) p.stdin.end(); });
      p.on('close', function () { resolve(out); });
      [INIT, LIST, call(3, 'execution_status'), call(4, 'haddad_health'), call(5, 'system_health')].forEach(function (f) { p.stdin.write(JSON.stringify(f) + '\n'); });
      setTimeout(function () { try { p.stdin.end(); } catch (e) { /* gone */ } }, 20000).unref();
    }).then(function (out) {
      assert.ok(out.indexOf(marker) === -1 && out.indexOf(TOKEN) === -1 && out.indexOf(EXEC_ENV) === -1, 'an environment value leaked');
    });
  });
})
.then(function () {
  return at('knowledge tools stay UNCONFIGURED on Haddad by design — owner decision (a) (never a guess)', function () {
    return client([INIT, call(3, 'knowledge_search', { query: 'anything' })]).then(function (r) {
      assert.ok(/^UPSTREAM_UNCONFIGURED: OTH Knowledge/.test(text(r.byId[3])), text(r.byId[3]));
    });
  });
})
.then(function () {
  return at('setup script dry run into a throwaway home: launcher + mcp.env + executor.env, 8 tools verified, no secret in mcp.env', function () { return Promise.resolve().then(function () {
    var home = path.join(TMP, 'home'); fs.mkdirSync(home);
    var r = run('bash', [SETUP], { env: Object.assign({}, process.env, { HOME: home, HADDAD_MCP_REPO: ROOT }) });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    var launcher = path.join(home, '.local', 'bin', 'haddad-mcp-stdio.sh');
    assert.ok(fs.existsSync(launcher));
    assert.strictEqual(fs.statSync(launcher).mode & 511, 488, 'launcher not 0750');
    assert.ok(fs.readFileSync(launcher, 'utf8').indexOf('REPO="' + ROOT + '"') !== -1, '@REPO@ not substituted');
    var envFile = path.join(home, '.config', 'mythos-haddad', 'mcp.env');
    var execEnv = path.join(home, '.config', 'mythos-ai-executor', 'executor.env');
    [envFile, execEnv].forEach(function (f) { assert.strictEqual(fs.statSync(f).mode & 511, 384, f + ' not 0600'); });
    var env = fs.readFileSync(envFile, 'utf8');
    assert.ok(/^OTH_MCP_EXECUTOR_TOKEN_FILE=/m.test(env) && !/^OTH_MCP_EXECUTOR_TOKEN=/m.test(env));
    var tok = /^MYTHOS_EXECUTOR_TOKEN=([A-Za-z0-9]{40,48})$/m.exec(fs.readFileSync(execEnv, 'utf8'));
    assert.ok(tok, 'executor token not provisioned in the executor idiom');
    assert.ok(r.stdout.indexOf(tok[1]) === -1, 'setup printed the token');
    assert.ok(/OK — 9 tools listed/.test(r.stdout));
    assert.ok(/^OTH_MCP_HADDAD_HEALTH_FILE=.*health-latest\.json$/m.test(env), 'mcp.env does not name the health report');
    assert.ok(/restart the worker/.test(r.stdout), 'new-token restart note missing');
    // Idempotent: a second run keeps the token.
    var r2 = run('bash', [SETUP], { env: Object.assign({}, process.env, { HOME: home, HADDAD_MCP_REPO: ROOT }) });
    assert.strictEqual(r2.status, 0, r2.stdout + r2.stderr);
    assert.strictEqual(/^MYTHOS_EXECUTOR_TOKEN=(.+)$/m.exec(fs.readFileSync(execEnv, 'utf8'))[1], tok[1], 'token rotated on re-run');
    assert.ok(/already provisioned/.test(r2.stdout));
  }); });
})
.then(function () {
  return at('HAD-3b bridge (unchanged) on an ephemeral port in front of the test launcher: 401 without/wrong bearer, 404 elsewhere, 405 GET, same 9 tools as stdio, execution_status via the fake executor, token never in any output', function () {
    var port = 18000 + Math.floor(Math.random() * 20000);
    var btok = 'bridge-test-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    var envFile = path.join(TMP, 'mcp-http.env'); fs.writeFileSync(envFile, 'MYTHOS_MCP_HTTP_TOKEN=' + btok + '\n', { mode: 384 });
    var bridgeOut = '';
    var bridge = cp.spawn('node', [BRIDGE], { env: Object.assign({}, process.env, { MYTHOS_MCP_HTTP_HOST: '127.0.0.1', MYTHOS_MCP_HTTP_PORT: String(port), MYTHOS_MCP_LAUNCHER: LAUNCHER, MYTHOS_MCP_HTTP_TOKEN: btok, HADDAD_MCP_CONFIG_DIR: CFG }), stdio: ['ignore', 'pipe', 'pipe'] });
    bridge.stdout.on('data', function (d) { bridgeOut += d; }); bridge.stderr.on('data', function (d) { bridgeOut += d; });
    function req(method, p, headers, body) {
      return new Promise(function (resolve, reject) {
        var r = http.request({ host: '127.0.0.1', port: port, method: method, path: p, headers: headers || {} }, function (res) { var b = ''; res.on('data', function (d) { b += d; }); res.on('end', function () { resolve({ status: res.statusCode, body: b }); }); });
        r.on('error', reject); r.end(body || undefined);
      });
    }
    function waitUp(n) { return req('GET', '/health').catch(function (e) { if (n <= 0) throw e; return new Promise(function (r) { setTimeout(r, 200); }).then(function () { return waitUp(n - 1); }); }); }
    var list = JSON.stringify(LIST);
    return waitUp(50).then(function (h) {
      assert.strictEqual(h.status, 200); assert.strictEqual(JSON.parse(h.body).service, 'mythos-mcp-http');
      return req('POST', '/mcp', { 'Content-Type': 'application/json' }, list);
    }).then(function (r) {
      assert.strictEqual(r.status, 401, 'no bearer must be 401');
      return req('POST', '/mcp', { 'Content-Type': 'application/json', Authorization: 'Bearer ' + btok + 'x' }, list);
    }).then(function (r) {
      assert.strictEqual(r.status, 401, 'wrong bearer must be 401');
      return req('POST', '/mcp/../etc', { 'Content-Type': 'application/json', Authorization: 'Bearer ' + btok }, list);
    }).then(function (r) {
      assert.strictEqual(r.status, 404, 'any other path must be 404');
      return req('GET', '/mcp', { Authorization: 'Bearer ' + btok });
    }).then(function (r) {
      assert.strictEqual(r.status, 405, 'no standalone stream');
      return runAsync('node', [PROBE, '--http', 'http://127.0.0.1:' + port + '/mcp'], { env: Object.assign({}, process.env, { HADDAD_MCP_HTTP_ENV: envFile }) });
    }).then(function (pr) {
      var rep = JSON.parse(pr.stdout);
      assert.strictEqual(rep.transport, 'streamable-http'); assert.strictEqual(rep.bearer, 'by reference'); assert.strictEqual(rep.launcher, null);
      assert.ok(rep.ok, rep.error); assert.strictEqual(rep.tools.length, 9);
      assert.ok(rep.call.ok, rep.call.error); assert.deepStrictEqual(rep.call.sample, { tasks: 1 });
      return runAsync('node', [PROBE, LAUNCHER], { env: Object.assign({}, process.env, { HADDAD_MCP_CONFIG_DIR: CFG }) }).then(function (sr) {
        var stdioRep = JSON.parse(sr.stdout);
        assert.deepStrictEqual(rep.tools, stdioRep.tools, 'HTTP and stdio list different tools');
        return runAsync('node', [PROBE, '--http', 'http://127.0.0.1:' + port + '/mcp'], { env: Object.assign({}, process.env, { HADDAD_MCP_HTTP_ENV: path.join(TMP, 'absent-http.env') }) });
      }).then(function (un) {
        var unrep = JSON.parse(un.stdout);
        assert.strictEqual(unrep.ok, false); assert.strictEqual(unrep.bearer, 'none'); assert.ok(/UNAUTHORIZED|401/.test(unrep.error), unrep.error);
        assert.strictEqual(un.status, 1);
        [pr.stdout, pr.stderr, un.stdout, bridgeOut].forEach(function (o) { assert.ok(o.indexOf(btok) === -1 && o.indexOf(TOKEN) === -1, 'a token leaked to an output'); });
      });
    }).then(function () { bridge.kill('SIGTERM'); }, function (e) { bridge.kill('SIGTERM'); throw e; });
  });
})
.then(function () {
  return at('HAD-3b setup dry run into a throwaway home: unit 0600 with @REPO@ filled, bearer 0600 and never printed, idempotent, --rotate rotates, a widened env file is refused, --serve without certs / without operator is PENDING (exit 2) and never runs Funnel', function () { return Promise.resolve().then(function () {
    var home = path.join(TMP, 'home-http'); fs.mkdirSync(home, { recursive: true });
    var stub = path.join(TMP, 'stub'); fs.mkdirSync(stub, { recursive: true });
    var sysLog = path.join(TMP, 'systemctl.log'), tsLog = path.join(TMP, 'tailscale.log'), tsStatus = path.join(TMP, 'ts-status.json');
    fs.writeFileSync(path.join(stub, 'systemctl'), '#!/bin/bash\necho "$*" >> ' + sysLog + '\ncase "$*" in *is-active*) echo inactive; exit 3;; esac\nexit 0\n', { mode: 493 });
    fs.writeFileSync(path.join(stub, 'tailscale'), '#!/bin/bash\necho "$*" >> ' + tsLog + '\ncase "$1" in status) cat ' + tsStatus + ';; serve) echo "Use \'sudo tailscale serve\'. To not require root, use \'sudo tailscale set --operator=$USER\' once." >&2; exit 1;; *) exit 1;; esac\n', { mode: 493 });
    var env = function (extra) { return Object.assign({}, process.env, { HOME: home, HADDAD_MCP_REPO: ROOT, HADDAD_MCP_HTTP_SYSTEMCTL: path.join(stub, 'systemctl'), HADDAD_MCP_HTTP_TAILSCALE: path.join(stub, 'tailscale') }, extra || {}); };
    // Without the stdio MCP the HTTP setup refuses — it is a transport for HAD-3, not a replacement.
    var r0 = run('bash', [HTTP_SETUP], { env: env() });
    assert.notStrictEqual(r0.status, 0); assert.ok(/haddad-mcp-setup\.sh first/.test(r0.stdout), r0.stdout);
    var r1 = run('bash', [SETUP], { env: env() }); assert.strictEqual(r1.status, 0, r1.stdout + r1.stderr);
    var r = run('bash', [HTTP_SETUP], { env: env() });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    var unit = path.join(home, '.config', 'systemd', 'user', 'mythos-haddad-mcp-http.service');
    var envFile = path.join(home, '.config', 'mythos-haddad', 'mcp-http.env');
    [unit, envFile].forEach(function (f) { assert.strictEqual(fs.statSync(f).mode & 511, 384, f + ' not 0600'); });
    assert.ok(fs.readFileSync(unit, 'utf8').indexOf('ExecStart=/usr/bin/node ' + ROOT + '/projects/mythos-gateway/mcp-http-bridge.js') !== -1, '@REPO@ not substituted');
    var lines = fs.readFileSync(envFile, 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 1); var tok = /^MYTHOS_MCP_HTTP_TOKEN=([A-Za-z0-9]{48})$/.exec(lines[0]); assert.ok(tok, 'bearer not in the bridge idiom');
    assert.ok(r.stdout.indexOf(tok[1]) === -1 && r.stderr.indexOf(tok[1]) === -1, 'setup printed the bearer');
    assert.ok(/daemon-reload/.test(fs.readFileSync(sysLog, 'utf8')));
    assert.ok(!/enable|restart/.test(fs.readFileSync(sysLog, 'utf8')), 'started without --enable');
    assert.ok(/not started \(pass --enable\)/.test(r.stdout));
    // Idempotent, then rotated.
    var r2 = run('bash', [HTTP_SETUP], { env: env() }); assert.strictEqual(r2.status, 0, r2.stdout);
    assert.strictEqual(fs.readFileSync(envFile, 'utf8'), lines[0] + '\n', 'bearer rotated on re-run'); assert.ok(/already provisioned/.test(r2.stdout));
    var r3 = run('bash', [HTTP_SETUP, '--rotate'], { env: env() }); assert.strictEqual(r3.status, 0, r3.stdout);
    assert.notStrictEqual(fs.readFileSync(envFile, 'utf8'), lines[0] + '\n', '--rotate kept the bearer');
    // A second variable in the env file could override the unit's loopback bind: refused.
    fs.appendFileSync(envFile, 'MYTHOS_MCP_HTTP_HOST=0.0.0.0\n');
    var r4 = run('bash', [HTTP_SETUP], { env: env() });
    assert.notStrictEqual(r4.status, 0); assert.ok(/carries something other than MYTHOS_MCP_HTTP_TOKEN/.test(r4.stdout), r4.stdout);
    fs.writeFileSync(envFile, fs.readFileSync(envFile, 'utf8').split('\n').filter(function (l) { return /^MYTHOS_MCP_HTTP_TOKEN=/.test(l); }).join('\n') + '\n');
    // --serve: certificates not enabled -> PENDING, nothing attempted.
    fs.writeFileSync(tsStatus, JSON.stringify({ Self: { DNSName: 'haddad.example.ts.net.' }, CertDomains: null }));
    var r5 = run('bash', [HTTP_SETUP, '--serve'], { env: env() });
    assert.strictEqual(r5.status, 2, r5.stdout); assert.ok(/PENDING owner action — HTTPS certificates are not enabled/.test(r5.stdout), r5.stdout);
    assert.ok(!/serve/.test(fs.readFileSync(tsLog, 'utf8')), 'serve attempted without certificates');
    // --serve: certificates enabled but no operator grant -> PENDING with the exact owner command; only /mcp, never funnel.
    fs.writeFileSync(tsStatus, JSON.stringify({ Self: { DNSName: 'haddad.example.ts.net.' }, CertDomains: ['haddad.example.ts.net'] }));
    var r6 = run('bash', [HTTP_SETUP, '--serve'], { env: env() });
    assert.strictEqual(r6.status, 2, r6.stdout); assert.ok(/sudo tailscale set --operator=/.test(r6.stdout), r6.stdout);
    var ts = fs.readFileSync(tsLog, 'utf8');
    assert.ok(/serve --bg --https=443 --set-path=\/mcp http:\/\/127\.0\.0\.1:8160\/mcp$/m.test(ts), ts);
    assert.ok(!/funnel/.test(ts), 'funnel was invoked');
    assert.ok(/URL:/.test(r6.stdout) === false, 'an HTTPS URL was announced although serve failed');
  }); });
})
.then(function () {
  exec_.srv.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
