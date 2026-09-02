'use strict';
// =====================================================
// MCP-ECOSYSTEM-1 — the MCP ecosystem, end to end, offline
// tests/mcp-ecosystem-test.js
//
// Drives every new component as its real consumer would, against
// fixtures that live only for this run: the real OTH MCP server behind a
// throwaway launcher and fake upstreams; a fixture Streamable-HTTP server
// (JSON and SSE flavours, bearer-gated); a fixture gateway with the admin
// API shape ContextForge exposes; a closed port. No production system is
// contacted, no real credential is read, no real ledger is touched.
//
//   §A registry      loads, fails closed, refuses values and secret shapes
//   §B policy        the matrix: ceilings, grants, hard floor, RESTRICTED
//   §C client/stdio  real OTH MCP over the launcher; timeouts; closed pipe
//   §D client/http   bearer, session id, SSE, unreachable, timeout
//   §E check         the registry check measures every status honestly
//   §F invoke        the governed path: every refusal, every success, audited
//   §G route         the executor API: 401, closed field set, 200
//   §H othmode       discovery: five states, no path or URL in public view
//   §I vault         inventory: metadata only, stat-only check, drift
//   §J boundaries    no secret anywhere, OTH MCP still exposes no write
//
// Run: node tests/mcp-ecosystem-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var cp = require('child_process');

var BASE = path.resolve(__dirname, '..');
var GW = path.join(BASE, 'projects', 'mythos-gateway');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var VAULT = path.join(BASE, 'projects', 'mythos-vault');
var OTHMODE = path.join(BASE, 'projects', 'command-center', 'reference', 'othmode');

// Fixtures live under the home directory, never /tmp (the executor's own
// rule for task working directories), and are removed at the end.
var FIX = path.join(os.homedir(), 'mythos-mcp-ecosystem-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true, mode: 0o700 });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIX, 'no-advisory-credential.env');
process.env.MYTHOS_MCP_AUDIT_FILE = path.join(FIX, 'mcp-audit.jsonl');
process.env.OTHMODE_REPO_ROOT = BASE;
delete process.env.OTHMODE_MCP_STATUS_FILE;

var registryLib = require(path.join(GW, 'lib', 'mcp-registry'));
var policyLib = require(path.join(GW, 'lib', 'mcp-policy'));
var clientLib = require(path.join(GW, 'lib', 'mcp-client'));
var inventoryLib = require(path.join(VAULT, 'lib', 'inventory'));
var redact = require(path.join(BASE, 'projects', 'mythos-orchestrator', 'lib', 'redact'));

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error('  [FAIL] ' + label); }
}
function section(t) { console.log('§ ' + t); }
function listen(server) { return new Promise(function (r) { server.listen(0, '127.0.0.1', function () { r(server); }); }); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
// The fixture servers live in THIS process. A blocking spawnSync would
// freeze their event loop and every HTTP check would time out, so child
// processes that must reach a fixture are awaited, never joined.
function spawnAsync(cmd, args, opts) {
  return new Promise(function (resolve) {
    var out = '', err = '';
    var child = cp.spawn(cmd, args, { env: opts.env || process.env });
    var timer = setTimeout(function () { child.kill('SIGKILL'); }, opts.timeout || 120000);
    child.stdout.on('data', function (d) { out += d; });
    child.stderr.on('data', function (d) { err += d; });
    child.on('close', function (code) { clearTimeout(timer); resolve({ status: code, stdout: out, stderr: err }); });
  });
}

// Real processes on this host can take many seconds to START under the
// memory and CPU pressure the agent sessions impose (load average 93 was
// measured while writing this). Waits that mean "did it answer at all" use
// this generous bound; waits that TEST a timeout keep their own short one.
var WAIT_MS = parseInt(process.env.MCP_TEST_WAIT_MS || '60000', 10);

var FIXTURE_TOKEN = 'fixture-http-token-' + 'q'.repeat(24);
var FIXTURE_GW_PASSWORD = 'fixture-gw-pass-' + 'w'.repeat(16);
var FIXTURE_JWT = 'fixture-jwt-' + 'e'.repeat(24);

// ----------------------------------------------------------------- fixtures

// Fake upstreams for the real OTH MCP server: every GET answers JSON.
function upstreamServer() {
  return http.createServer(function (req, res) {
    if (req.method !== 'GET') { res.writeHead(405); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (/live-status/.test(req.url)) return res.end(JSON.stringify({ summary: { LIVE: 1, DEGRADED: 0, DOWN: 0 }, fixture: true }));
    if (/\/search/.test(req.url)) return res.end(JSON.stringify({ hits: [{ id: 'claim-fixture', statement: 'fixture' }] }));
    res.end(JSON.stringify({ ok: true, path: req.url, fixture: true }));
  });
}

// Streamable-HTTP MCP fixture (+ SSE flavour + gateway admin shape).
function mcpFixtureServer() {
  function rpc(msg, cb) {
    if (msg.id === undefined || msg.id === null) return cb(null);
    var tools = [{ name: 'echo', inputSchema: { type: 'object' } }, { name: 'create_pull_request' }, { name: 'delete_repository' }, { name: 'slow' }, { name: 'boom' }];
    if (msg.method === 'initialize') return cb({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture-mcp', version: '1' } } });
    if (msg.method === 'tools/list') return cb({ jsonrpc: '2.0', id: msg.id, result: { tools: tools } });
    if (msg.method === 'tools/call') {
      var name = msg.params && msg.params.name; var args = (msg.params && msg.params.arguments) || {};
      if (name === 'echo') return cb({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(args) }] } });
      if (name === 'create_pull_request') return cb({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'pr created' }] } });
      if (name === 'delete_repository') return cb({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'deleted' }] } });
      if (name === 'boom') return cb({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'boom: upstream refused' }], isError: true } });
      if (name === 'slow') return setTimeout(function () { cb({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'late' }] } }); }, 2000);
      return cb({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'No such tool: ' + name }], isError: true } });
    }
    return cb({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
  function bearer(req) { var m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || ''); return m ? m[1] : null; }
  function body(req, cb) { var c = []; req.on('data', function (d) { c.push(d); }); req.on('end', function () { var t = Buffer.concat(c).toString('utf8'); try { cb(JSON.parse(t || '{}')); } catch (e) { cb(null); } }); }
  return http.createServer(function (req, res) {
    var url = req.url.split('?')[0];
    if (req.method === 'GET' && url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"ok"}'); }
    if (req.method === 'GET' && url === '/gw/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"healthy"}'); }
    if (req.method === 'POST' && url === '/gw/auth/login') {
      return body(req, function (b) {
        if (b && b.password === FIXTURE_GW_PASSWORD) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ access_token: FIXTURE_JWT })); }
        res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"detail":"nope"}');
      });
    }
    if (url === '/gw/gateways' || url === '/gw/tools') {
      if (bearer(req) !== FIXTURE_JWT) { res.writeHead(401); return res.end('{}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      if (url === '/gw/gateways') return res.end(JSON.stringify([{ name: 'bridge-fixture', slug: 'bridge-fixture', enabled: true, reachable: true }]));
      return res.end(JSON.stringify([{ name: 'bridge-fixture-echo', original_name: 'echo' }]));
    }
    var isMcp = url === '/mcp' || url === '/mcp-sse' || url === '/gw/mcp';
    if (!isMcp) { res.writeHead(404); return res.end('{}'); }
    var want = url === '/gw/mcp' ? FIXTURE_JWT : FIXTURE_TOKEN;
    if (bearer(req) !== want) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"unauthorized"}'); }
    if (req.method === 'DELETE') { res.writeHead(200); return res.end('{}'); }
    if (req.method !== 'POST') { res.writeHead(405); return res.end('{}'); }
    body(req, function (msg) {
      if (!msg) { res.writeHead(400); return res.end('{}'); }
      rpc(msg, function (reply) {
        if (!reply) { res.writeHead(202); return res.end(); }
        var headers = {};
        if (msg.method === 'initialize') headers['Mcp-Session-Id'] = 'fixture-session-' + Date.now();
        if (url === '/mcp') { headers['content-type'] = 'application/json'; res.writeHead(200, headers); return res.end(JSON.stringify(reply)); }
        headers['content-type'] = 'text/event-stream';
        res.writeHead(200, headers);
        res.end('event: message\ndata: ' + JSON.stringify(reply) + '\n\n');
      });
    });
  });
}

function writeLauncher(file, upstreamPort) {
  var lines = [
    '#!/bin/bash',
    '# throwaway OTH MCP launcher for tests/mcp-ecosystem-test.js',
    'export OTH_MCP_KNOWLEDGE_URL=http://127.0.0.1:' + upstreamPort,
    'export OTH_MCP_KNOWLEDGE_TOKEN=fixture-knowledge-' + 'k'.repeat(20),
    'export OTH_MCP_OTHMODE_URL=http://127.0.0.1:' + upstreamPort,
    'export OTH_MCP_EXECUTOR_URL=http://127.0.0.1:' + upstreamPort,
    'export OTH_MCP_EXECUTOR_TOKEN=fixture-executor-' + 'x'.repeat(20),
    'export OTH_MCP_STATUS_URL=http://127.0.0.1:' + upstreamPort,
    'exec ' + process.execPath + ' ' + path.join(BASE, 'projects', 'oth-mcp', 'server.js')
  ];
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o700 });
}

var OTH_TOOLS = ['knowledge_search', 'knowledge_get', 'project_context', 'capability_registry', 'execution_status', 'execution_report', 'budget_status', 'system_health'];

function fixtureRegistry(launcher, port) {
  var base = 'http://127.0.0.1:' + port;
  function httpServer(extra) {
    return Object.assign({
      purpose: 'fixture', direction: 'inbound', transport: { kind: 'streamable-http', url: base + '/mcp', health_url: base + '/health' },
      auth: { required: true, scheme: 'bearer', credential: 'cred_fixture_http_token' }, credentials: [],
      tools: ['echo', 'create_pull_request', 'delete_repository', 'slow', 'boom'], write_capable: true, enabled: true, consumers: []
    }, extra);
  }
  return {
    schema_version: '1.0.0',
    servers: {
      'oth-mcp': { purpose: 'the real OTH MCP behind a throwaway launcher', direction: 'inbound', transport: { kind: 'stdio', launcher: launcher },
        auth: { required: false, scheme: 'host-access', credential: null }, credentials: [], tools: OTH_TOOLS.slice(), write_capable: false, enabled: true, consumers: [] },
      'bridge-fixture': httpServer({}),
      'sse-fixture': httpServer({ transport: { kind: 'streamable-http', url: base + '/mcp-sse', health_url: null }, write_capable: false }),
      'github-fixture': httpServer({ enabled: false, enabled_note: 'fixture disabled', tools: ['echo'], outbound_capability_server: 'github' }),
      'governed-fixture': httpServer({ tools: ['echo'], outbound_capability_server: 'github' }),
      'offline-fixture': { purpose: 'nothing listens here', direction: 'inbound', transport: { kind: 'streamable-http', url: 'http://127.0.0.1:1/mcp', health_url: null },
        auth: { required: false, scheme: 'none', credential: null }, credentials: [], tools: ['echo'], write_capable: false, enabled: true, consumers: [] },
      'noauth-fixture': httpServer({ auth: { required: true, scheme: 'bearer', credential: 'cred_fixture_missing' }, tools: ['echo'], write_capable: false }),
      'drift-fixture': httpServer({ tools: ['echo', 'nonexistent_tool'], write_capable: false }),
      'gateway-fixture': { purpose: 'fixture gateway', direction: 'gateway', transport: { kind: 'gateway-http', url: base + '/gw', health_url: base + '/gw/health', mcp_url: base + '/gw/mcp' },
        auth: { required: true, scheme: 'jwt', credential: 'cred_fixture_gw_client' }, admin_credential: 'cred_fixture_gw_admin', credentials: [], peers: ['bridge-fixture'], tools: [], write_capable: false, enabled: true, consumers: [] }
    }
  };
}

function fixturePermissions() {
  var p = readJson(path.join(GW, 'registry', 'mcp-permissions.json'));
  p.tool_classes.push(
    { server: 'bridge-fixture', tools: ['delete_*'], capability: 'destructive' },
    { server: 'bridge-fixture', tools: ['create_pull_request'], capability: 'github.pull_request' },
    { server: 'bridge-fixture', tools: ['echo', 'slow', 'boom'], capability: 'mythos.read' },
    { server: 'sse-fixture', tools: ['*'], capability: 'mythos.read' },
    { server: 'github-fixture', tools: ['*'], capability: 'github.read' },
    { server: 'governed-fixture', tools: ['*'], capability: 'github.read' },
    { server: 'offline-fixture', tools: ['*'], capability: 'mythos.read' },
    { server: 'noauth-fixture', tools: ['*'], capability: 'mythos.read' },
    { server: 'drift-fixture', tools: ['*'], capability: 'mythos.read' },
    { server: 'gateway-fixture', tools: ['*'], capability: 'mythos.read' }
  );
  return p;
}

function fixtureInventory(dir) {
  function entry(id, extra) {
    return Object.assign({ id: id, provider: 'fixture', purpose: 'fixture', environment: 'development', owner: os.userInfo().username,
      location: path.join(dir, 'fixture.env'), expected_mode: '0600', expected_owner: os.userInfo().username, env_var: null,
      consumers: [], status: 'active', created_at: null, rotated_at: null, expires_at: null, rotation_policy: 'fixture' }, extra);
  }
  return {
    schema_version: '1.0.0',
    credentials: [
      entry('cred_fixture_http_token', { env_var: 'FIXTURE_HTTP_TOKEN' }),
      entry('cred_fixture_gw_admin', { env_var: 'FIXTURE_GW_PASSWORD' }),
      entry('cred_fixture_gw_client', { location: null, expected_mode: null, expected_owner: null, status: 'absent' }),
      entry('cred_fixture_missing', { location: path.join(dir, 'missing.env'), env_var: 'FIXTURE_MISSING_TOKEN' }),
      entry('cred_fixture_wide', { location: path.join(dir, 'wide.env') }),
      entry('cred_fixture_absent', { location: null, expected_mode: null, expected_owner: null, status: 'absent' })
    ]
  };
}

// ------------------------------------------------------------------- run

async function run() {
  var upstream = await listen(upstreamServer());
  var fixture = await listen(mcpFixtureServer());
  var upstreamPort = upstream.address().port;
  var fixturePort = fixture.address().port;

  var launcher = path.join(FIX, 'oth-mcp-stdio.sh');
  writeLauncher(launcher, upstreamPort);
  fs.writeFileSync(path.join(FIX, 'fixture.env'), '# fixture — no real value\n', { mode: 0o600 });
  fs.writeFileSync(path.join(FIX, 'wide.env'), '# fixture — deliberately 0644\n', { mode: 0o644 });
  var REG = path.join(FIX, 'mcp-registry.json');
  var PERM = path.join(FIX, 'mcp-permissions.json');
  var INV = path.join(FIX, 'credential-inventory.json');
  var SNAP = path.join(FIX, 'mcp-registry-status.json');
  fs.writeFileSync(REG, JSON.stringify(fixtureRegistry(launcher, fixturePort), null, 2));
  fs.writeFileSync(PERM, JSON.stringify(fixturePermissions(), null, 2));
  fs.writeFileSync(INV, JSON.stringify(fixtureInventory(FIX), null, 2));
  process.env.FIXTURE_HTTP_TOKEN = FIXTURE_TOKEN;
  process.env.FIXTURE_GW_PASSWORD = FIXTURE_GW_PASSWORD;
  process.env.PLATFORM_ADMIN_EMAIL = 'fixture@example.test';
  delete process.env.FIXTURE_MISSING_TOKEN;

  // ---------------------------------------------------------------- §A
  section('A. registry — loads, fails closed, refuses values');
  {
    var real = registryLib.loadRegistry();
    ok(real.valid, 'the shipped registry is valid: ' + (real.reason || 'ok'));
    ok(real.valid && Object.keys(real.servers).length === 6, 'six servers registered (' + Object.keys(real.servers).length + ')');
    ok(real.valid && real.servers['oth-mcp'].tools.length === 8, 'oth-mcp declares its 8 tools');
    ok(real.valid && registryLib.declaredTools(real.servers, 'mythos-mcp-http').length === 8, 'the bridge relays oth-mcp\'s 8 tools without declaring any');
    ok(real.valid && real.servers['github-mcp-rw'].tools.length === 57 && real.servers['github-mcp-rw'].tools.indexOf('delete_file') === -1 && real.servers['github-mcp-rw'].tools.indexOf('create_branch') !== -1, 'github-mcp-rw declares the 57 measured v1.10.1 tools — delete_file excluded at the container (drift is reported from now on)');
    ok(real.valid && real.servers['github-mcp-rw'].enabled === true && /2026-09-02/.test(real.servers['github-mcp-rw'].enabled_note), 'github-mcp-rw is enabled by the owner (2026-09-02, credential bound by reference)');
    ok(real.valid && typeof real.servers['contextforge'].public === 'boolean' && typeof real.servers['contextforge'].note === 'string' && /measured/i.test(real.servers['contextforge'].note), 'the gateway records whether it is public, with the measurement that says so');

    var fx = registryLib.loadRegistry(REG);
    ok(fx.valid, 'the fixture registry is valid: ' + (fx.reason || 'ok'));
    var raw = readJson(REG);

    var bad = clone(raw); bad.servers['oth-mcp'].surprise = 1;
    ok(!registryLib.validateRegistryObject(bad).valid, 'an unknown field invalidates the registry');
    bad = clone(raw); bad.servers['bridge-fixture'].auth.credential = 'not-a-reference';
    ok(!registryLib.validateRegistryObject(bad).valid, 'auth.credential must be a cred_ reference');
    bad = clone(raw); bad.servers['bridge-fixture'].credentials = ['cred_ok', 'plain-value'];
    ok(!registryLib.validateRegistryObject(bad).valid, 'a key that names a secret may hold only references');
    bad = clone(raw); bad.servers['bridge-fixture'].transport.url = 'http://user:pass@127.0.0.1:1/mcp';
    ok(!registryLib.validateRegistryObject(bad).valid, 'a URL with an embedded credential is refused');
    bad = clone(raw); bad.servers['bridge-fixture'].note = 'leaked ghp_' + 'A'.repeat(30);
    ok(!registryLib.validateRegistryObject(bad, JSON.stringify(bad)).valid, 'a secret-shaped string anywhere invalidates the registry');
    bad = clone(raw); bad.servers['sse-fixture'].relays = 'nobody';
    ok(!registryLib.validateRegistryObject(bad).valid, 'relays must name a registered server');
    bad = clone(raw); delete bad.servers['oth-mcp'].enabled;
    ok(!registryLib.validateRegistryObject(bad).valid, 'enabled is required');
    bad = clone(raw); bad.servers['bridge-fixture'].auth = { required: true, scheme: 'bearer', credential: null };
    ok(!registryLib.validateRegistryObject(bad).valid, 'a bearer scheme must name its credential reference');
    ok(!registryLib.loadRegistry(path.join(FIX, 'nope.json')).valid, 'an unreadable registry is invalid, not empty');
  }

  // ---------------------------------------------------------------- §B
  section('B. policy — ceilings, grants, hard floor, RESTRICTED');
  {
    var perms = policyLib.loadPermissions();
    ok(perms.valid, 'the shipped matrix is valid: ' + (perms.reason || 'ok'));
    var P = perms.policy;
    function dec(s, srv, t) { return policyLib.authorize(P, { subject: s, server: srv, tool: t }); }
    ok(dec('executor', 'oth-mcp', 'knowledge_search').decision === 'ALLOW', 'executor may read MYTHOS');
    ok(dec('executor', 'github-mcp-rw', 'delete_repository').decision === 'DENY', 'destructive is denied to the executor');
    ok(dec('owner', 'github-mcp-rw', 'delete_repository').decision === 'DENY', 'destructive is denied even to the owner (hard floor is a ceiling)');
    var pr = dec('executor', 'github-mcp-rw', 'create_pull_request');
    ok(pr.decision === 'CONTROLLED' && pr.requires_approval === true, 'a pull request is CONTROLLED and requires approval');
    ok(dec('executor', 'github-mcp-rw', 'merge_pull_request').decision === 'DENY', 'merge is denied to the executor by its own grant');
    ok(dec('claude', 'github-mcp-rw', 'merge_pull_request').decision === 'CONTROLLED', 'merge is CONTROLLED for claude');
    ok(dec('chatgpt', 'github-mcp-rw', 'create_issue').decision === 'CONTROLLED', 'chatgpt narrows github.issue to CONTROLLED');
    ok(dec('chatgpt', 'github-mcp-rw', 'push_files').decision === 'DENY', 'an unnamed grant is DENY by default');
    ok(dec('anonymous', 'oth-mcp', 'system_health').decision === 'DENY', 'anonymous is denied everything');
    ok(dec('nobody', 'oth-mcp', 'system_health').decision === 'DENY', 'an unknown subject is denied');
    ok(dec('executor', 'oth-mcp', 'made_up').decision === 'ALLOW', 'oth-mcp.* is mythos.read (the server exposes no write)');
    ok(dec('executor', 'github-mcp-rw', 'totally_unknown').decision === 'DENY' && /unclassified/.test(dec('executor', 'github-mcp-rw', 'totally_unknown').reason), 'an unclassified tool is denied');
    ok(dec('executor', 'github-mcp-rw', 'delete_workflow_run_logs').capability === 'destructive', 'delete_* is classified before the broad globs');
    ok(policyLib.authorize(null, { subject: 'executor', server: 'oth-mcp', tool: 'x' }).decision === 'DENY', 'no policy ⇒ DENY');

    var rawP = readJson(path.join(GW, 'registry', 'mcp-permissions.json'));
    var badP = clone(rawP); badP.capabilities.destructive.decision = 'ALLOW';
    ok(!policyLib.validatePermissionsObject(badP).valid, 'raising destructive above the hard floor is refused');
    badP = clone(rawP); badP['default'] = 'ALLOW';
    ok(!policyLib.validatePermissionsObject(badP).valid, 'default must be DENY');
    badP = clone(rawP); badP.subjects.executor.grants['nonexistent.cap'] = 'ALLOW';
    ok(!policyLib.validatePermissionsObject(badP).valid, 'a grant on an undeclared capability is refused');
    badP = clone(rawP); badP.tool_classes.push({ server: 'x', tools: [], capability: 'mythos.read' });
    ok(!policyLib.validatePermissionsObject(badP).valid, 'a rule with no tools is refused');

    var restricted = policyLib.validatePermissionsObject({
      schema_version: '1.0.0', 'default': 'DENY',
      capabilities: { infra: { decision: 'RESTRICTED' }, destructive: { decision: 'DENY' } },
      tool_classes: [{ server: '*', tools: ['reboot'], capability: 'infra' }],
      subjects: { agent: { grants: { infra: 'ALLOW' } }, human: { human: true, grants: { infra: 'ALLOW' } } }
    });
    ok(restricted.valid, 'a RESTRICTED matrix validates');
    ok(policyLib.authorize(restricted.policy, { subject: 'agent', server: 'h', tool: 'reboot' }).decision === 'DENY', 'RESTRICTED ⇒ DENY for an agent even with an ALLOW grant');
    var h = policyLib.authorize(restricted.policy, { subject: 'human', server: 'h', tool: 'reboot' });
    ok(h.decision === 'CONTROLLED' && h.requires_approval, 'RESTRICTED ⇒ CONTROLLED for a human subject');
  }

  // ---------------------------------------------------------------- §C
  section('C. client/stdio — the real OTH MCP over the launcher');
  {
    var c = clientLib.createStdioClient({ command: '/bin/bash', args: [launcher], timeoutMs: WAIT_MS });
    var init = await c.initialize({ name: 'mcp-ecosystem-test', version: '1' });
    ok(init && init.serverInfo && init.serverInfo.name === 'oth-mcp', 'initialize reaches the real server (' + (init && init.serverInfo && init.serverInfo.name) + ')');
    var tools = await c.listTools();
    ok(tools.length === 8 && tools.every(function (t) { return OTH_TOOLS.indexOf(t.name) !== -1; }), 'tools/list returns the 8 declared tools');
    var health = await c.callTool('system_health', {});
    ok(!health.isError && /fixture/.test(health.content[0].text), 'tools/call reaches the fixture upstream through the real server');
    var nope = await c.callTool('knowledge_write', {});
    ok(nope.isError === true && /No such tool/.test(nope.content[0].text), 'an unknown tool is an isError result, not a crash');
    await c.close();

    var slowChild = clientLib.createStdioClient({ command: process.execPath, args: ['-e', 'setInterval(function(){},1000)'], timeoutMs: 1500 });
    var code = await slowChild.request('initialize', {}).then(function () { return 'none'; }, function (e) { return e.code; });
    ok(code === clientLib.CODES.TIMEOUT, 'a silent process is MCP_TIMEOUT (' + code + ')');
    await slowChild.close();

    var dead = clientLib.createStdioClient({ command: process.execPath, args: ['-e', 'process.exit(0)'], timeoutMs: WAIT_MS });
    await new Promise(function (r) { setTimeout(r, 3000); });
    code = await dead.request('initialize', {}).then(function () { return 'none'; }, function (e) { return e.code; });
    ok(code === clientLib.CODES.TRANSPORT_CLOSED || code === clientLib.CODES.UNREACHABLE, 'an exited process is MCP_TRANSPORT_CLOSED (' + code + ')');

    var missing = clientLib.createStdioClient({ command: path.join(FIX, 'no-such-binary'), args: [], timeoutMs: WAIT_MS });
    code = await missing.request('initialize', {}).then(function () { return 'none'; }, function (e) { return e.code; });
    ok(code === clientLib.CODES.UNREACHABLE || code === clientLib.CODES.TRANSPORT_CLOSED, 'a missing binary is MCP_UNREACHABLE (' + code + ')');
  }

  // ---------------------------------------------------------------- §D
  section('D. client/http — bearer, session, SSE, unreachable, timeout');
  {
    var base = 'http://127.0.0.1:' + fixturePort;
    var noTok = clientLib.createHttpClient({ url: base + '/mcp', timeoutMs: WAIT_MS });
    var code = await noTok.initialize().then(function () { return 'none'; }, function (e) { return e.code; });
    ok(code === clientLib.CODES.UNAUTHORIZED, 'no bearer ⇒ MCP_UNAUTHORIZED');
    var hc = clientLib.createHttpClient({ url: base + '/mcp', token: FIXTURE_TOKEN, timeoutMs: WAIT_MS });
    var init = await hc.initialize();
    ok(init.serverInfo.name === 'fixture-mcp', 'initialize over JSON');
    ok(typeof hc.sessionId() === 'string' && /fixture-session/.test(hc.sessionId()), 'Mcp-Session-Id captured');
    var tl = await hc.listTools();
    ok(tl.length === 5, 'tools/list over JSON');
    var echo = await hc.callTool('echo', { a: 1 });
    ok(echo.content[0].text === '{"a":1}', 'tools/call echoes arguments');
    await hc.close();
    var sse = clientLib.createHttpClient({ url: base + '/mcp-sse', token: FIXTURE_TOKEN, timeoutMs: WAIT_MS });
    var sinit = await sse.initialize();
    ok(sinit.serverInfo.name === 'fixture-mcp', 'initialize over SSE');
    var secho = await sse.callTool('echo', { b: 2 });
    ok(secho.content[0].text === '{"b":2}', 'tools/call over SSE');
    var off = clientLib.createHttpClient({ url: 'http://127.0.0.1:1/mcp', timeoutMs: WAIT_MS });
    code = await off.initialize().then(function () { return 'none'; }, function (e) { return e.code; });
    ok(code === clientLib.CODES.UNREACHABLE, 'a closed port is MCP_UNREACHABLE');
    var slow = clientLib.createHttpClient({ url: base + '/mcp', token: FIXTURE_TOKEN, timeoutMs: 500 });
    code = await slow.callTool('slow', {}).then(function () { return 'none'; }, function (e) { return e.code; });
    ok(code === clientLib.CODES.TIMEOUT, 'a slow tool is MCP_TIMEOUT');
    var rpc = await hc.request('nonexistent/method', {}).then(function () { return 'none'; }, function (e) { return e.code; });
    ok(rpc === clientLib.CODES.RPC_ERROR, 'a JSON-RPC error is MCP_RPC_ERROR');
  }

  // ---------------------------------------------------------------- §E
  section('E. registry check — every status measured, none guessed');
  var snapshot = null;
  {
    var env = Object.assign({}, process.env);
    var res = await spawnAsync(process.execPath, [path.join(GW, 'bin', 'mcp-registry-check'), '--registry', REG, '--permissions', PERM, '--inventory', INV, '--out', SNAP, '--json', '--quiet', '--timeout', String(WAIT_MS)], { env: env, timeout: WAIT_MS * 12 });
    ok(res.status === 1, 'exit 1 because an enabled server is not ONLINE (status ' + res.status + ')');
    try { snapshot = JSON.parse(res.stdout); } catch (e) { snapshot = null; }
    ok(!!snapshot && snapshot.ok === false, 'the snapshot says ok:false');
    ok(fs.existsSync(SNAP) && readJson(SNAP).generated_at === snapshot.generated_at, 'the snapshot file is written atomically');
    var S = snapshot ? snapshot.servers : {};
    function st(n) { return S[n] ? S[n].status : 'absent'; }
    ok(st('oth-mcp') === 'ONLINE' && S['oth-mcp'].tools_discovered.length === 8, 'oth-mcp ONLINE via a real stdio handshake (' + st('oth-mcp') + ')');
    ok(st('bridge-fixture') === 'DEGRADED' && S['bridge-fixture'].policy_findings.some(function (f) { return /delete_repository/.test(f); }), 'an enabled server exposing a DENY tool is DEGRADED with the finding named (' + st('bridge-fixture') + ')');
    ok(st('sse-fixture') === 'ONLINE', 'the SSE server is ONLINE (' + st('sse-fixture') + ')');
    ok(st('offline-fixture') === 'OFFLINE', 'a closed port is OFFLINE (' + st('offline-fixture') + ')');
    ok(st('noauth-fixture') === 'UNAUTHORIZED' && S['noauth-fixture'].reachable === true, 'reachable but no credential ⇒ UNAUTHORIZED, still reachable (' + st('noauth-fixture') + ')');
    ok(S['noauth-fixture'] && S['noauth-fixture'].credential_findings.length > 0, 'the missing credential is named as a finding');
    ok(st('drift-fixture') === 'DEGRADED' && S['drift-fixture'].drift.missing[0] === 'nonexistent_tool', 'declared-but-undiscovered is drift ⇒ DEGRADED');
    ok(st('gateway-fixture') === 'ONLINE' && S['gateway-fixture'].peers['bridge-fixture'].reachable === true && S['gateway-fixture'].federated_tools === 1, 'the gateway is ONLINE through liveness + admin api (' + st('gateway-fixture') + ')');
    ok(S['github-fixture'] && S['github-fixture'].enabled === false && S['github-fixture'].status !== null, 'a disabled server is measured but does not fail the run');
    ok(snapshot && snapshot.summary.enabled === 8 && snapshot.summary.disabled === 1, 'summary counts enabled/disabled');
    var snapText = fs.readFileSync(SNAP, 'utf8');
    ok(snapText.indexOf(FIXTURE_TOKEN) === -1 && snapText.indexOf(FIXTURE_GW_PASSWORD) === -1 && snapText.indexOf(FIXTURE_JWT) === -1, 'no credential value reaches the snapshot');
    ok(redact.findSecretKinds(snapText).length === 0, 'the snapshot carries no secret shape');

    var one = await spawnAsync(process.execPath, [path.join(GW, 'bin', 'mcp-registry-check'), '--registry', REG, '--permissions', PERM, '--inventory', INV, '--server', 'oth-mcp', '--quiet', '--json', '--timeout', String(WAIT_MS)], { env: env, timeout: WAIT_MS * 3 });
    ok(one.status === 0 && JSON.parse(one.stdout).ok === true, '--server oth-mcp alone exits 0');
    var partial = await spawnAsync(process.execPath, [path.join(GW, 'bin', 'mcp-registry-check'), '--registry', REG, '--permissions', PERM, '--inventory', INV, '--server', 'oth-mcp', '--out', SNAP, '--quiet', '--timeout', String(WAIT_MS)], { env: env, timeout: WAIT_MS * 3 });
    var merged = readJson(SNAP);
    ok(partial.status === 1 && Object.keys(merged.servers).length === 9 && merged.servers['offline-fixture'].status === 'OFFLINE' && merged.ok === false, 'a --server run merges into the snapshot instead of erasing the other servers (exit reflects the whole)');

    var noGw = await spawnAsync(process.execPath, [path.join(GW, 'bin', 'mcp-registry-check'), '--registry', REG, '--permissions', PERM, '--inventory', INV, '--server', 'gateway-fixture', '--quiet', '--json', '--timeout', String(WAIT_MS)], { env: Object.assign({}, env, { FIXTURE_GW_PASSWORD: '' }), timeout: WAIT_MS * 3 });
    var noGwSnap = JSON.parse(noGw.stdout);
    ok(noGwSnap.servers['gateway-fixture'].status === 'UNAUTHORIZED' && noGwSnap.servers['gateway-fixture'].reachable === true, 'gateway without admin credential ⇒ UNAUTHORIZED (liveness only)');

    var badReg = await spawnAsync(process.execPath, [path.join(GW, 'bin', 'mcp-registry-check'), '--registry', path.join(FIX, 'nope.json'), '--quiet'], { env: env });
    ok(badReg.status === 2, 'an invalid registry exits 2 (fail closed)');
  }

  // ---------------------------------------------------------------- §F
  section('F. governed invoke — every refusal, every success, audited');
  {
    var invokeLib = require(path.join(EXEC, 'lib', 'mcp-invoke'));
    var state = require(path.join(EXEC, 'lib', 'state'));
    var policyEngine = require(path.join(EXEC, 'core', 'policy-engine'));
    var O = { registryPath: REG, permissionsPath: PERM, inventoryPath: INV, timeoutMs: WAIT_MS };
    var calls = 0;
    function inv(req, extra) { calls++; return invokeLib.invoke(req, Object.assign({}, O, extra || {})); }

    var r = await inv({ server: 'oth-mcp', tool: 'system_health', requested_by: 'test-suite' });
    ok(r.ok === true && Array.isArray(r.content) && /fixture/.test(r.content[0].text) && r.http_status === 200, 'oth-mcp.system_health executes through the governed path');
    r = await inv({ server: 'bridge-fixture', tool: 'echo', arguments: { hello: 'world' } });
    ok(r.ok === true && r.content[0].text === '{"hello":"world"}', 'a bearer server executes with the credential resolved by reference');
    r = await inv({ server: 'bridge-fixture', tool: 'delete_repository' });
    ok(r.ok === false && r.code === 'MCP_DENIED' && r.http_status === 403, 'destructive ⇒ MCP_DENIED 403');
    r = await inv({ server: 'bridge-fixture', tool: 'create_pull_request' });
    ok(r.ok === false && r.code === 'MCP_APPROVAL_REQUIRED', 'CONTROLLED without approval ⇒ MCP_APPROVAL_REQUIRED');

    var ap = policyEngine.requestApproval('executor', 'mcp:github.pull_request', 'test', null);
    r = await inv({ server: 'bridge-fixture', tool: 'create_pull_request', approval_id: ap.id });
    ok(r.ok === false && r.code === 'MCP_APPROVAL_INVALID' && /PENDING/.test(r.message), 'a pending approval is not an approval');
    policyEngine.decideApproval(ap.id, true, 'Test Human');
    r = await inv({ server: 'bridge-fixture', tool: 'create_pull_request', approval_id: ap.id });
    ok(r.ok === true && r.content[0].text === 'pr created', 'a GRANTED approval lets a CONTROLLED call through');
    r = await inv({ server: 'bridge-fixture', tool: 'create_pull_request', approval_id: ap.id });
    ok(r.ok === false && r.code === 'MCP_APPROVAL_INVALID' && /consumed/.test(r.message), 'an approval is consumed by its one call — no replay');
    var wrong = policyEngine.requestApproval('executor', 'mcp:github.write', 'test', null);
    policyEngine.decideApproval(wrong.id, true, 'Test Human');
    r = await inv({ server: 'bridge-fixture', tool: 'create_pull_request', approval_id: wrong.id });
    ok(r.ok === false && r.code === 'MCP_APPROVAL_INVALID' && /not mcp:github.pull_request/.test(r.message), 'an approval for another capability is refused');
    var denied = policyEngine.requestApproval('executor', 'mcp:github.pull_request', 'test', null);
    policyEngine.decideApproval(denied.id, false, 'Test Human');
    r = await inv({ server: 'bridge-fixture', tool: 'create_pull_request', approval_id: denied.id });
    ok(r.ok === false && r.code === 'MCP_APPROVAL_INVALID' && /DENIED/.test(r.message), 'a DENIED approval is refused');
    r = await inv({ server: 'bridge-fixture', tool: 'create_pull_request', approval_id: 'no-such-approval' });
    ok(r.ok === false && r.code === 'MCP_APPROVAL_INVALID', 'an unknown approval is refused');

    r = await inv({ server: 'github-fixture', tool: 'echo' });
    ok(r.ok === false && r.code === 'MCP_SERVER_DISABLED' && r.http_status === 409, 'a disabled server ⇒ MCP_SERVER_DISABLED 409');
    r = await inv({ server: 'governed-fixture', tool: 'echo' });
    ok(r.ok === false && r.code === 'MCP_CAPABILITY_NOT_RESOLVED', 'a capability-governed server without a task ⇒ NOT_RESOLVED');
    state.ensureTaskDir('t-mcp-fixture-a');
    state.writeJSON('t-mcp-fixture-a', 'task.json', { task_id: 't-mcp-fixture-a', mcp_capabilities: ['github.echo'] });
    state.ensureTaskDir('t-mcp-fixture-b');
    state.writeJSON('t-mcp-fixture-b', 'task.json', { task_id: 't-mcp-fixture-b', mcp_capabilities: [] });
    r = await inv({ server: 'governed-fixture', tool: 'echo', task_id: 't-mcp-fixture-a', arguments: { via: 'task' } });
    ok(r.ok === true && r.content[0].text === '{"via":"task"}', 'a task that resolved github.echo may call it');
    r = await inv({ server: 'governed-fixture', tool: 'echo', task_id: 't-mcp-fixture-b' });
    ok(r.ok === false && r.code === 'MCP_CAPABILITY_NOT_RESOLVED', 'a task that did not resolve it may not');
    var evt = fs.readFileSync(state.taskFile('t-mcp-fixture-a', 'events.log'), 'utf8');
    ok(/"event":"mcp_invoke"/.test(evt) && /"audit_id":"mcpa-/.test(evt), 'a task-bound call is recorded on the task events too');

    r = await inv({ server: 'noauth-fixture', tool: 'echo' });
    ok(r.ok === false && r.code === 'MCP_CREDENTIAL_UNAVAILABLE' && r.status === 'UNAUTHORIZED' && r.http_status === 503, 'a credential the executor does not hold ⇒ MCP_CREDENTIAL_UNAVAILABLE');
    r = await inv({ server: 'offline-fixture', tool: 'echo' });
    ok(r.ok === false && r.code === 'MCP_UNREACHABLE' && r.status === 'UNAVAILABLE', 'a closed port ⇒ MCP_UNREACHABLE');
    r = await inv({ server: 'gateway-fixture', tool: 'echo' });
    ok(r.ok === false && r.code === 'MCP_CREDENTIAL_UNAVAILABLE' && /cred_fixture_gw_client/.test(r.message), 'the gateway needs an ISSUED client token — the admin credential is never used as one');
    r = await inv({ server: 'nobody', tool: 'echo' });
    ok(r.ok === false && r.code === 'MCP_SERVER_UNREGISTERED' && r.http_status === 404, 'an unregistered server ⇒ 404');
    r = await inv({ server: 'bridge-fixture', tool: 'undeclared' });
    ok(r.ok === false && r.code === 'MCP_DENIED', 'an undeclared, unclassified tool is denied by the matrix first');
    r = await inv({ server: 'drift-fixture', tool: 'create_pull_request' });
    ok(r.ok === false && r.code === 'MCP_TOOL_UNREGISTERED', 'a classified but undeclared tool ⇒ MCP_TOOL_UNREGISTERED');
    r = await inv({ server: 'bridge-fixture', tool: 'boom' });
    ok(r.ok === false && r.code === 'MCP_TOOL_ERROR' && r.status === 'TOOL_ERROR' && /boom/.test(r.message), 'isError ⇒ MCP_TOOL_ERROR, never a silent success');
    r = await inv({ server: 'bridge-fixture', tool: 'slow' }, { timeoutMs: 500 });
    ok(r.ok === false && r.code === 'MCP_TIMEOUT' && r.http_status === 504, 'a slow tool ⇒ MCP_TIMEOUT 504');
    r = await inv({ server: 'bridge-fixture', tool: 'echo', arguments: { t: 'ghp_' + 'B'.repeat(30) } });
    ok(r.ok === false && r.code === 'MCP_INPUT' && r.http_status === 400, 'secret-shaped arguments are refused before anything is called');
    r = await inv({ server: '../etc', tool: 'echo' });
    ok(r.ok === false && r.code === 'MCP_INPUT', 'a malformed server name is refused');
    r = await inv({ server: 'bridge-fixture', tool: 'echo', arguments: [1, 2] });
    ok(r.ok === false && r.code === 'MCP_INPUT', 'arguments must be an object');
    r = await inv({ server: 'sse-fixture', tool: 'echo', arguments: { sse: true } });
    ok(r.ok === true && r.content[0].text === '{"sse":true}', 'an SSE-answering server executes');

    var auditLines = fs.readFileSync(process.env.MYTHOS_MCP_AUDIT_FILE, 'utf8').trim().split('\n');
    ok(auditLines.length === calls, 'every invocation is audited, denials included (' + auditLines.length + '/' + calls + ')');
    var parsedAudit = auditLines.map(function (l) { return JSON.parse(l); });
    ok(parsedAudit.every(function (e) { return e.ts && e.audit_id && e.actor && e.agent === 'mythos-ai-executor' && e.subject === 'executor' && e.authorization && e.execution && 'error' in e; }), 'each audit record carries timestamp, actor, agent, subject, authorization, execution, error');
    ok(parsedAudit.some(function (e) { return e.authorization.decision === 'DENY' && e.error && e.error.code === 'MCP_DENIED'; }), 'a denial is recorded with its authorization result');
    ok(parsedAudit.some(function (e) { return e.authorization.approved_by === 'Test Human' && e.execution.status === 'OK'; }), 'an approved call records who approved it');
    var auditText = auditLines.join('\n');
    ok(auditText.indexOf(FIXTURE_TOKEN) === -1 && auditText.indexOf(FIXTURE_GW_PASSWORD) === -1, 'no credential value reaches the audit log');
    ok(redact.findSecretKinds(auditText).length === 0, 'the audit log carries no secret shape (the ghp_ argument was refused, not logged)');
    var mode = fs.statSync(process.env.MYTHOS_MCP_AUDIT_FILE).mode & 0o777;
    ok(mode === 0o600, 'the audit log is 0600');

    var described = invokeLib.describeRegistry({ registryPath: REG, permissionsPath: PERM, statusFile: SNAP });
    ok(described.registry_valid && described.snapshot_present && described.servers.length === 9, 'describeRegistry joins the registry with the snapshot');
    var d0 = described.servers.filter(function (s) { return s.name === 'oth-mcp'; })[0];
    ok(d0.status === 'ONLINE' && d0.tools[0].available === true && d0.tools[0].decision === 'ALLOW', 'described tools carry measured availability and the executor\'s decision');
    ok(!/\/home\/|https?:\/\//.test(JSON.stringify(described.servers)), 'the description carries no path or URL');
  }

  // ---------------------------------------------------------------- §G
  section('G. executor route — 401, closed field set, 200');
  {
    process.env.MYTHOS_MCP_REGISTRY_FILE = REG;
    process.env.MYTHOS_MCP_PERMISSIONS_FILE = PERM;
    process.env.MYTHOS_VAULT_INVENTORY_FILE = INV;
    process.env.MYTHOS_MCP_STATUS_FILE = SNAP;
    var server = require(path.join(EXEC, 'server'));
    var TOKEN = 'fixture-executor-bearer-' + 'z'.repeat(24);
    var api = await listen(http.createServer(function (req, res) { server.handler(req, res, TOKEN); }));
    var port = api.address().port;
    function call(method, p, body, auth) {
      return new Promise(function (resolve) {
        var data = body === undefined ? null : JSON.stringify(body);
        var headers = { 'content-type': 'application/json' };
        if (auth !== false) headers.authorization = 'Bearer ' + TOKEN;
        if (data !== null) headers['content-length'] = Buffer.byteLength(data);
        var rq = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (rs) {
          var c = []; rs.on('data', function (d) { c.push(d); }); rs.on('end', function () { var t = Buffer.concat(c).toString('utf8'); var j = null; try { j = JSON.parse(t); } catch (e) { j = null; } resolve({ status: rs.statusCode, json: j }); });
        });
        if (data !== null) rq.write(data);
        rq.end();
      });
    }
    var x = await call('POST', '/mcp/invoke', { server: 'oth-mcp', tool: 'system_health' }, false);
    ok(x.status === 401, 'POST /mcp/invoke without bearer ⇒ 401');
    x = await call('POST', '/mcp/invoke', { server: 'oth-mcp', tool: 'system_health', subject: 'owner' });
    ok(x.status === 400 && x.json.error === 'UNEXPECTED_FIELD' && x.json.fields[0] === 'subject', 'a caller cannot choose its subject (closed field set)');
    x = await call('POST', '/mcp/invoke', { server: 'oth-mcp', tool: 'system_health', requested_by: 'route-test' });
    ok(x.status === 200 && x.json.ok === true && Array.isArray(x.json.content) && !('http_status' in x.json), 'an allowed call answers 200 with content');
    x = await call('POST', '/mcp/invoke', { server: 'bridge-fixture', tool: 'delete_repository' });
    ok(x.status === 403 && x.json.code === 'MCP_DENIED', 'a denied call answers 403 with its code');
    x = await call('POST', '/mcp/invoke', { server: 'nobody', tool: 'x' });
    ok(x.status === 404 && x.json.code === 'MCP_SERVER_UNREGISTERED', 'an unregistered server answers 404');
    x = await call('GET', '/mcp/registry');
    ok(x.status === 200 && x.json.registry_valid === true && x.json.servers.length === 9 && x.json.snapshot_present === true, 'GET /mcp/registry describes the registry with the snapshot');
    x = await call('GET', '/mcp/registry', undefined, false);
    ok(x.status === 401, 'GET /mcp/registry needs the bearer too');
    api.close();
    delete process.env.MYTHOS_MCP_REGISTRY_FILE; delete process.env.MYTHOS_MCP_PERMISSIONS_FILE; delete process.env.MYTHOS_VAULT_INVENTORY_FILE; delete process.env.MYTHOS_MCP_STATUS_FILE;
  }

  // ---------------------------------------------------------------- §H
  section('H. OTHMODE discovery — five states, nothing leaks');
  {
    var registries = require(path.join(OTHMODE, 'registries.js'));
    // A real snapshot may exist at the production default; "no snapshot"
    // must be an explicit absent path, not an assumption about the host.
    process.env.OTHMODE_MCP_STATUS_FILE = path.join(FIX, 'no-such-snapshot.json');
    var t = registries.tools();
    ok(t.sources.mcp_capabilities === 'loaded' && t.sources.mcp_registry === 'loaded', 'both MCP sources load (' + JSON.stringify(t.sources) + ')');
    ok(!t.tools.some(function (x) { return x.id === 'mcp:servers'; }), 'the bogus mcp:servers row is gone');
    var gh = t.tools.filter(function (x) { return x.id === 'mcp:github'; })[0];
    ok(gh && gh.source === 'mcp-capabilities' && gh.capabilities.length === 3 && gh.enabled === true && gh.direction === 'outbound', 'the outbound github capability server is rendered with its 3 review tools and enabled:true (owner, 2026-09-02)');
    var ks = t.tools.filter(function (x) { return x.id === 'oth-mcp.knowledge_search'; })[0];
    ok(ks && ks.source === 'mcp-registry' && ks.registered === true && ks.authorized === true && ks.policy_class === 'ALLOW', 'oth-mcp.knowledge_search is registered and authorized for othmode');
    ok(ks && ks.available === null && ks.healthy === null && ks.executable === null, 'without a snapshot the measured states are null, never guessed');
    ok(t.tools.some(function (x) { return x.id === 'git.read' && x.policy_class === 'READ'; }), 'the executor tools are still rendered');

    // A snapshot for the REAL registry names: oth-mcp ONLINE, the bridge UNAUTHORIZED.
    var realSnap = path.join(FIX, 'real-status.json');
    fs.writeFileSync(realSnap, JSON.stringify({ schema_version: '1.0.0', generated_at: '2026-09-01T23:00:00.000Z', ok: false, servers: {
      'oth-mcp': { status: 'ONLINE', reachable: true, tools_discovered: OTH_TOOLS.slice(), drift: { missing: [], extra: [] }, policy_findings: [], credential_findings: [] },
      'mythos-mcp-http': { status: 'UNAUTHORIZED', reachable: true, tools_discovered: [], drift: { missing: OTH_TOOLS.slice(), extra: [] }, policy_findings: [], credential_findings: ['checker holds no value'] }
    } }));
    process.env.OTHMODE_MCP_STATUS_FILE = realSnap;
    t = registries.tools();
    ks = t.tools.filter(function (x) { return x.id === 'oth-mcp.knowledge_search'; })[0];
    ok(ks.available === true && ks.healthy === true && ks.authorized === true && ks.executable === true, 'with the snapshot, oth-mcp.knowledge_search is available, healthy, authorized, executable');
    var bs = t.tools.filter(function (x) { return x.id === 'mythos-mcp-http.knowledge_search'; })[0];
    ok(bs && bs.available === false && bs.healthy === false && bs.authorized === true && bs.executable === false, 'the bridge tool is registered+authorized but not available/healthy/executable');
    var cf = t.tools.filter(function (x) { return x.id === 'contextforge.knowledge_search'; })[0];
    ok(!cf, 'the gateway declares no tool of its own in the read model');
    var view = registries.mcp();
    ok(view.total === 6 && view.checked_at === '2026-09-01T23:00:00.000Z' && view.checked_ok === false, 'the MCP view lists six servers with the snapshot time');
    var o = view.servers.filter(function (s) { return s.name === 'oth-mcp'; })[0];
    ok(o.status === 'ONLINE' && o.transport === 'stdio' && o.tools.length === 8 && o.credential_ref === null, 'oth-mcp view row');
    var b = view.servers.filter(function (s) { return s.name === 'mythos-mcp-http'; })[0];
    ok(b.status === 'UNAUTHORIZED' && b.credential_ref === 'cred_mcp_http_bridge_token' && b.findings.length === 1, 'the bridge row names its credential by reference and its finding');
    var viewText = JSON.stringify(view);
    ok(!/\/home\/|https?:\/\/|launcher|"url"/.test(viewText), 'the public view carries no path, URL or launcher');
    ok(redact.findSecretKinds(viewText).length === 0, 'the public view carries no secret shape');
    ok(view.sources.mcp_status === 'loaded', 'the snapshot source is reported');
    delete process.env.OTHMODE_MCP_STATUS_FILE;
  }

  // ---------------------------------------------------------------- §I
  section('I. Vault inventory — metadata only, stat-only check');
  {
    var real = inventoryLib.loadInventory(path.join(VAULT, 'credential-inventory.json'));
    ok(real.valid && real.list.length >= 19, 'the shipped inventory is valid with ' + real.list.length + ' entries');
    ok(real.valid && real.credentials['cred_github_gateway'].status === 'active' && real.credentials['cred_github_gateway'].env_var === 'MYTHOS_GITHUB_MCP_RW_TOKEN' && /github-mcp-rw\.env$/.test(real.credentials['cred_github_gateway'].location), 'the gateway GitHub credential is recorded active by reference (owner decision #1, 2026-09-02)');
    ok(real.valid && real.excluded.some(function (x) { return /governance\.key/.test(x.location); }), 'the governance key is excluded by name, not forgotten');
    ok(inventoryLib.envVarFor(real, 'cred_mcp_http_bridge_token') === 'MYTHOS_MCP_HTTP_TOKEN', 'a reference resolves to an env var NAME');
    ok(inventoryLib.valueFromEnv(real, 'cred_mcp_http_bridge_token', {}) === null, 'a reference resolves to null when the environment does not carry it');
    var rawI = readJson(path.join(VAULT, 'credential-inventory.json'));
    var badI = clone(rawI); badI.credentials[0].value = 'abc';
    ok(!inventoryLib.validateInventoryObject(badI).valid, 'a value-bearing key is refused');
    badI = clone(rawI); badI.credentials[0].note = 'github_pat_' + 'A'.repeat(30);
    ok(!inventoryLib.validateInventoryObject(badI, JSON.stringify(badI)).valid, 'a secret-shaped string is refused');
    badI = clone(rawI); badI.credentials[0].env_var = 'lowercase';
    ok(!inventoryLib.validateInventoryObject(badI).valid, 'env_var must be a variable NAME');
    badI = clone(rawI); badI.credentials[0].status = 'absent';
    ok(!inventoryLib.validateInventoryObject(badI).valid, 'absent entries carry no location; present ones must');
    var fxI = inventoryLib.loadInventory(INV);
    ok(fxI.valid, 'the fixture inventory is valid');
    var chk = inventoryLib.checkInventory(fxI);
    var by = {}; chk.results.forEach(function (r) { by[r.id] = r; });
    ok(by.cred_fixture_http_token.ok && by.cred_fixture_http_token.exists === true && by.cred_fixture_http_token.mode_actual === '0600', 'a present 0600 file checks ok');
    ok(!by.cred_fixture_missing.ok && by.cred_fixture_missing.exists === false && /missing/.test(by.cred_fixture_missing.drift[0]), 'a missing file is drift');
    ok(!by.cred_fixture_wide.ok && /wider/.test(by.cred_fixture_wide.drift[0]), 'a mode wider than expected is drift');
    ok(by.cred_fixture_absent.ok && by.cred_fixture_absent.exists === false, 'an absent entry with no file is consistent');
    ok(chk.ok === false && chk.summary.drift === 2 && chk.summary.absent === 3, 'the check reports drift');
    var src = fs.readFileSync(path.join(VAULT, 'lib', 'inventory.js'), 'utf8');
    ok((src.match(/readFileSync\(/g) || []).length === 2 && !/readFileSync\([^)]*location/.test(src), 'the inventory module opens only the inventory and /etc/passwd — never a listed file');
    var bin = cp.spawnSync(process.execPath, [path.join(VAULT, 'bin', 'vault-inventory-check'), '--inventory', INV, '--quiet', '--json'], { encoding: 'utf8' });
    ok(bin.status === 1 && JSON.parse(bin.stdout).summary.drift === 2, 'the check binary exits 1 on drift');
    var binBad = cp.spawnSync(process.execPath, [path.join(VAULT, 'bin', 'vault-inventory-check'), '--inventory', path.join(FIX, 'nope.json'), '--quiet'], { encoding: 'utf8' });
    ok(binBad.status === 2, 'an invalid inventory exits 2');
  }

  // ---------------------------------------------------------------- §J
  section('J. boundaries — no secret anywhere, no write anywhere');
  {
    ['registry/mcp-registry.json', 'registry/mcp-permissions.json'].forEach(function (f) {
      ok(redact.findSecretKinds(fs.readFileSync(path.join(GW, f), 'utf8')).length === 0, 'no secret shape in ' + f);
    });
    // Source files legitimately ASSIGN a variable named token (`token = null`),
    // which the assigned-secret pattern flags by design; what must never
    // appear in source is a literal credential — every other pattern.
    function literalSecrets(text) { return redact.findSecretKinds(text).filter(function (k) { return k !== 'assigned-secret'; }); }
    ['lib/mcp-registry.js', 'lib/mcp-policy.js', 'lib/mcp-client.js', 'bin/mcp-registry-check', 'bin/mcp-registry-check.sh'].forEach(function (f) {
      ok(literalSecrets(fs.readFileSync(path.join(GW, f), 'utf8')).length === 0, 'no literal secret in ' + f);
    });
    ok(literalSecrets(fs.readFileSync(path.join(EXEC, 'lib', 'mcp-invoke.js'), 'utf8')).length === 0, 'no literal secret in lib/mcp-invoke.js');
    ok(redact.findSecretKinds(fs.readFileSync(path.join(VAULT, 'credential-inventory.json'), 'utf8')).length === 0, 'no secret shape in the inventory');
    var clientSrc = fs.readFileSync(path.join(GW, 'lib', 'mcp-client.js'), 'utf8').replace(/\/\/.*$/gm, '');
    ok(!/console\.(log|error)\(/.test(clientSrc), 'the client never logs (so it can never log a credential)');
    var invokeSrc = fs.readFileSync(path.join(EXEC, 'lib', 'mcp-invoke.js'), 'utf8');
    ok(/token = null;/.test(invokeSrc), 'the invoke path drops its credential reference as soon as the transport holds it');
    ok(!/console\.(log|error)\([^)]*token/i.test(invokeSrc), 'the invoke path never prints a token');
    var oth = require(path.join(BASE, 'projects', 'oth-mcp', 'server.js'));
    ok(oth.TOOLS.length === 8 && !oth.TOOLS.some(function (t) { return /create|write|update|delete|ingest|promote|dispatch|approve|run_/i.test(t.name); }), 'OTH MCP still exposes no write-shaped tool');
    var bridgeSrc = fs.readFileSync(path.join(GW, 'mcp-http-bridge.js'), 'utf8');
    ok(bridgeSrc.indexOf('mcp-registry') === -1 && bridgeSrc.indexOf('mcp-policy') === -1, 'the bridge stays a transport: it knows nothing of the registry or the matrix');
    var units = fs.readFileSync(path.join(GW, 'systemd', 'mythos-mcp-registry-check.service'), 'utf8');
    ok(/User=deploy/.test(units) && /ProtectSystem=strict/.test(units) && /MemoryMax=/.test(units) && /NoNewPrivileges=yes/.test(units), 'the check unit is confined like the bridge unit');
    var probes = readJson(path.join(BASE, 'projects', 'status-center', 'monitor', 'probes.json')).probes;
    ok(probes.some(function (p) { return p.id === 'mcp-bridge-loopback' && p.url === 'http://127.0.0.1:8160/health'; }) && probes.some(function (p) { return p.id === 'mcp-gateway-loopback' && p.url === 'http://127.0.0.1:4444/health'; }), 'the Status Center monitors the bridge and the gateway at their origins');
  }

  upstream.close();
  fixture.close();
  fs.rmSync(FIX, { recursive: true, force: true });
  console.log('\nmcp-ecosystem: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

run().catch(function (e) {
  console.error(e && e.stack || e);
  try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (x) { /* best effort */ }
  process.exit(1);
});
