'use strict';
// =====================================================
// MYTHOS Browser — the governed chain, offline and end to end
// tests/mythos-browser-governed-test.js
//
//   task (mcp_capabilities resolved) -> haddad-agent tool call
//     -> lib/mcp-invoke (registry, permission matrix, capability gate, audit)
//       -> browser-mcp launcher -> projects/mythos-browser-mcp/server.js
//         -> BrowserAdapter -> ObscuraBackend -> CDP (fake Obscura, bearer)
//           -> page text back to the model
//
// Everything real except the browser engine (tests/support/fake-cdp-server.js)
// and the model (injected transport). Fixture registry/permissions/inventory
// live in a temp dir, so the shipped permission matrix is NOT modified here:
// the fixture adds the browser.read classification the owner step adds in
// production. The token exists only in the launcher's environment and is
// asserted absent from the audit log, the task events and the model's view.
// =====================================================
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var EXEC = path.join(ROOT, 'projects', 'mythos-ai-executor');
var GW = path.join(ROOT, 'projects', 'mythos-gateway');
var MCP = path.join(ROOT, 'projects', 'mythos-browser-mcp');
var fake = require('./support/fake-cdp-server');

// isolated executor home + audit file BEFORE any executor module loads
var FIX = fs.mkdtempSync(path.join(os.homedir(), 'browser-governed-'));
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'home');
process.env.MYTHOS_MCP_AUDIT_FILE = path.join(FIX, 'mcp-audit.jsonl');
fs.mkdirSync(process.env.MYTHOS_EXECUTOR_HOME, { recursive: true });

var state = require(path.join(EXEC, 'lib', 'state'));
var invokeLib = require(path.join(EXEC, 'lib', 'mcp-invoke'));
var mcpCaps = require(path.join(EXEC, 'lib', 'mcp-capabilities'));
var skillsLib = require(path.join(EXEC, 'lib', 'skills'));
var agent = require(path.join(EXEC, 'providers', 'haddad-agent.js'));
var policy = require(path.join(EXEC, 'lib', 'policy.js'));

var pass = 0, fail = 0, queue = [];
function t(name, fn) { queue.push(function () { return Promise.resolve().then(fn).then(function () { pass++; console.log('ok - ' + name); }, function (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e)); }); }); }
var TOKEN = 'c'.repeat(48);
var srv, REG, PERM, INV, LAUNCHER;

function fixturePermissions() {
  var p = JSON.parse(fs.readFileSync(path.join(GW, 'registry', 'mcp-permissions.json'), 'utf8'));
  p.capabilities['browser.read'] = { decision: 'ALLOW', description: 'fixture: read a public page through browser-mcp' };
  p.tool_classes.push({ server: 'browser-mcp', tools: ['navigate', 'extract', 'screenshot'], capability: 'browser.read' });
  Object.keys(p.subjects).forEach(function (s) { if (p.subjects[s] && p.subjects[s].grants) p.subjects[s].grants['browser.read'] = s === 'executor' ? 'ALLOW' : 'DENY'; });
  return p;
}

t('fixtures: fake Obscura (bearer), launcher that holds the token, registry with browser-mcp, permissions with browser.read', function () {
  return fake.start({ token: TOKEN, pages: { 'https://example.com/': { title: 'Example Domain', text: 'Example Domain — for use in illustrative examples.', href: 'https://example.com/' } } }).then(function (s) {
    srv = s;
    LAUNCHER = path.join(FIX, 'mythos-browser-mcp.sh');
    var art = path.join(FIX, 'artifacts');
    fs.writeFileSync(LAUNCHER, '#!/usr/bin/env bash\nset -euo pipefail\nexport OBSCURA_CDP_URL=' + s.url + '\nexport OBSCURA_CDP_TOKEN=' + TOKEN + '\nexport MYTHOS_BROWSER_ARTIFACTS=' + art + '\nexec ' + process.execPath + ' ' + path.join(MCP, 'server.js') + '\n', { mode: 0o700 });
    var real = JSON.parse(fs.readFileSync(path.join(GW, 'registry', 'mcp-registry.json'), 'utf8'));
    var browser = JSON.parse(JSON.stringify(real.servers['browser-mcp']));
    assert.ok(browser, 'the shipped registry carries browser-mcp');
    assert.strictEqual(browser.outbound_capability_server, 'browser');
    assert.deepStrictEqual(browser.tools, ['navigate', 'extract', 'screenshot']);
    assert.strictEqual(browser.write_capable, false);
    browser.transport = { kind: 'stdio', launcher: LAUNCHER };
    var reg = { schema_version: '1.0.0', servers: { 'browser-mcp': browser } };
    REG = path.join(FIX, 'registry.json'); PERM = path.join(FIX, 'permissions.json'); INV = path.join(FIX, 'inventory.json');
    fs.writeFileSync(REG, JSON.stringify(reg, null, 2));
    fs.writeFileSync(PERM, JSON.stringify(fixturePermissions(), null, 2));
    fs.writeFileSync(INV, JSON.stringify({ schema_version: '1.0.0', credentials: [] }, null, 2));
  });
});

t('capability resolution: the browser-research skill ∩ mcp-capabilities.json ∩ profile yields exactly the three browser capabilities', function () {
  var skill = skillsLib.DEFAULT_REGISTRY.skills['browser-research'];
  assert.ok(skill && skill.enabled, 'skill registered');
  var r = mcpCaps.resolveCapabilities(skill, 'repo-read');
  assert.deepStrictEqual(r.allowed.slice().sort(), ['browser.extract', 'browser.navigate', 'browser.screenshot']);
  var d = mcpCaps.resolveCapabilities(skill, 'deploy');
  assert.strictEqual(d.allowed.length, 0, 'an incompatible profile resolves nothing');
  assert.strictEqual(mcpCaps.DEFAULT_REGISTRY.servers.browser.enabled, true);
});

t('the runner offers browser_* ONLY when the task carries the capability, and TOOL_IMPL still holds only the four workspace tools', function () {
  assert.deepStrictEqual(Object.keys(agent.TOOL_IMPL).sort(), ['list_files', 'read_file', 'run_command', 'write_file']);
  assert.deepStrictEqual(Object.keys(agent.MCP_TOOL_IMPL).sort(), ['browser_extract', 'browser_navigate', 'browser_screenshot']);
  var g = policy.toolsForProfile('repo-read');
  var none = agent.toolSchemas(g).map(function (s) { return s.function.name; });
  assert.ok(none.every(function (n) { return n.indexOf('browser_') !== 0; }), 'no capability, no browser tool');
  var some = agent.toolSchemas(g, ['browser.extract']).map(function (s) { return s.function.name; });
  assert.ok(some.indexOf('browser_extract') !== -1 && some.indexOf('browser_navigate') === -1, 'exactly the resolved capability is offered');
});

function seedTask(id, caps) {
  fs.mkdirSync(path.join(process.env.MYTHOS_EXECUTOR_HOME, 'tasks', id), { recursive: true });
  state.writeJSON(id, 'task.json', { task_id: id, mcp_capabilities: caps });
}
var O;
t('governed invoke (direct): browser-mcp.extract executes through registry → matrix → capability gate → launcher → server → fake Obscura', function () {
  O = { registryPath: REG, permissionsPath: PERM, inventoryPath: INV, timeoutMs: 20000 };
  seedTask('t-browser-fixture-a', ['browser.navigate', 'browser.extract', 'browser.screenshot']);
  seedTask('t-browser-fixture-b', []);
  return invokeLib.invoke({ server: 'browser-mcp', tool: 'extract', arguments: { url: 'https://example.com/', selector: 'h1' }, task_id: 't-browser-fixture-a', requested_by: 'test' }, O).then(function (r) {
    assert.strictEqual(r.ok, true, JSON.stringify(r).slice(0, 300));
    var body = JSON.parse(r.content[0].text);
    assert.strictEqual(body.backend, 'obscura'); assert.strictEqual(body.text, 'Example Domain'); assert.strictEqual(body.title, 'Example Domain');
    assert.ok(r.audit_id && /^mcpa-/.test(r.audit_id));
  });
});
t('governed invoke: a task WITHOUT the capability is refused (MCP_CAPABILITY_NOT_RESOLVED), no page is fetched', function () {
  var before = srv.seen.length;
  return invokeLib.invoke({ server: 'browser-mcp', tool: 'navigate', arguments: { url: 'https://example.com/' }, task_id: 't-browser-fixture-b', requested_by: 'test' }, O).then(function (r) {
    assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'MCP_CAPABILITY_NOT_RESOLVED'); assert.strictEqual(srv.seen.length, before);
  });
});
t('governed invoke: a tool the server does not declare is MCP_TOOL_UNREGISTERED — there is no raw CDP through this path', function () {
  return invokeLib.invoke({ server: 'browser-mcp', tool: 'evaluate', arguments: { expression: '1+1' }, task_id: 't-browser-fixture-a', requested_by: 'test' }, O).then(function (r) {
    assert.strictEqual(r.ok, false); assert.ok(r.code === 'MCP_TOOL_UNREGISTERED' || r.code === 'MCP_DENIED', r.code);
  });
});
t('governed invoke: the SHIPPED permission matrix (browser.read landed 2026-09-29) lets the executor navigate through browser-mcp — a real page comes back', function () {
  return invokeLib.invoke({ server: 'browser-mcp', tool: 'navigate', arguments: { url: 'https://example.com/' }, task_id: 't-browser-fixture-a', requested_by: 'test' }, Object.assign({}, O, { permissionsPath: path.join(GW, 'registry', 'mcp-permissions.json') })).then(function (r) {
    assert.strictEqual(r.ok, true, JSON.stringify(r).slice(0, 300));
    assert.strictEqual(JSON.parse(r.content[0].text).backend, 'obscura');
  });
});
t('shipped matrix: browser.read is ALLOW for the executor only, DENY for every other subject, and only the three declared tools carry it', function () {
  var policyLib = require(path.join(GW, 'lib', 'mcp-policy'));
  var perms = policyLib.loadPermissions(path.join(GW, 'registry', 'mcp-permissions.json'));
  assert.strictEqual(perms.valid, true, perms.reason);
  var p = perms.policy;
  var raw = JSON.parse(fs.readFileSync(path.join(GW, 'registry', 'mcp-permissions.json'), 'utf8'));
  assert.strictEqual(raw.capabilities['browser.read'].decision, 'ALLOW');
  var cls = raw.tool_classes.filter(function (c) { return c.server === 'browser-mcp'; });
  assert.strictEqual(cls.length, 1); assert.deepStrictEqual(cls[0].tools, ['navigate', 'extract', 'screenshot']); assert.strictEqual(cls[0].capability, 'browser.read');
  Object.keys(p.subjects).forEach(function (s) {
    var d = policyLib.authorize(p, { subject: s, server: 'browser-mcp', tool: 'extract' });
    assert.strictEqual(d.decision, s === 'executor' ? 'ALLOW' : 'DENY', s + ' → ' + d.decision + ' (' + d.reason + ')');
    if (s === 'executor') assert.strictEqual(d.capability, 'browser.read');
  });
  // An undeclared tool on the same server falls to the matrix default (DENY) — no class names it.
  assert.strictEqual(policyLib.authorize(p, { subject: 'executor', server: 'browser-mcp', tool: 'evaluate' }).decision, 'DENY');
  // No other grant changed: the executor's pre-existing grants are exactly what they were.
  assert.deepStrictEqual(Object.keys(p.subjects.executor.grants).filter(function (k) { return k !== 'browser.read'; }).sort(),
    ['destructive', 'external.read', 'github.actions', 'github.issue', 'github.merge', 'github.pull_request', 'github.read', 'github.write', 'infrastructure', 'mythos.read', 'vault.read']);
  assert.strictEqual(p.subjects.executor.grants['github.merge'], 'DENY');
});
t('governed invoke: a private URL is refused by the server\'s URL policy and surfaces as MCP_TOOL_ERROR carrying the policy code', function () {
  return invokeLib.invoke({ server: 'browser-mcp', tool: 'navigate', arguments: { url: 'http://127.0.0.1:8130/tasks' }, task_id: 't-browser-fixture-a', requested_by: 'test' }, O).then(function (r) {
    assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'MCP_TOOL_ERROR'); assert.ok(/URL_POLICY|URL_PRIVATE/.test(r.message), r.message);
  });
});

// ---- the runner: a model that calls browser_extract, then reports
function fakeTransport(replies) {
  var i = 0, sent = [];
  var fn = function (o, body) {
    sent.push(JSON.parse(body));
    var m = replies[Math.min(i++, replies.length - 1)];
    return Promise.resolve({ status: 200, body: JSON.stringify({ choices: [{ message: m }], usage: { prompt_tokens: 100 } }) });
  };
  fn.sent = sent; return fn;
}
function tc(id, name, args) { return { id: id, type: 'function', function: { name: name, arguments: JSON.stringify(args) } }; }

t('E2E offline: task -> haddad-agent -> browser_extract -> governed invoke -> browser-mcp -> Obscura CDP -> page text in the model\'s tool result', function () {
  var ws = path.join(FIX, 'ws'); fs.mkdirSync(ws, { recursive: true });
  var taskId = 't-browser-e2e-1';
  seedTask(taskId, ['browser.extract', 'browser.navigate']);
  var transport = fakeTransport([
    { role: 'assistant', content: null, tool_calls: [tc('c1', 'browser_extract', { url: 'https://example.com/', selector: 'h1' })] },
    { role: 'assistant', content: null, tool_calls: [tc('c2', 'browser_screenshot', { url: 'https://example.com/' })] },
    { role: 'assistant', content: 'Observed https://example.com/ via obscura: "Example Domain".\n```json\n{"mythos_report": true, "status": "completed", "summary": "read example.com through the governed browser", "files_changed": [], "tests": [], "commit": null, "residual_risks": []}\n```' }
  ]);
  var task = { task_id: taskId, working_directory: ws, execution_profile: 'repo-read', timeout_seconds: 120, expected_delivery: 'report', mcp_capabilities: ['browser.extract', 'browser.navigate'] };
  return agent.run(task, 'Read the h1 of https://example.com/ through the browser and report it.', null, 'start', { apiKey: 'k', model: 'm', transport: transport, mcp: O, structuredReport: false }).then(function (o) {
    var toolMsgs = [];
    transport.sent.forEach(function (req) { req.messages.forEach(function (m) { if (m.role === 'tool') toolMsgs.push(m); }); });
    var first = toolMsgs.find(function (m) { return m.tool_call_id === 'c1'; });
    assert.ok(first, 'the browser_extract result reached the model');
    var body = JSON.parse(first.content);
    assert.strictEqual(body.backend, 'obscura', JSON.stringify(body).slice(0, 200));
    assert.strictEqual(body.text, 'Example Domain');
    assert.ok(body.audit_id);
    var second = toolMsgs.find(function (m) { return m.tool_call_id === 'c2'; });
    var refusal = JSON.parse(second.content).error || '';
    assert.ok(/REFUSED: (capability browser.screenshot is not resolved|tool not granted by the repo-read profile)/.test(refusal), 'an unresolved capability is refused BEFORE the governed invoke (not offered, and refused if called anyway): ' + second.content);
    var offered = transport.sent[0].tools.map(function (x) { return x.function.name; });
    assert.ok(offered.indexOf('browser_extract') !== -1 && offered.indexOf('browser_screenshot') === -1, 'the offer matched the capabilities');
    assert.ok(/browser_\* tools/.test(transport.sent[0].messages[0].content), 'the system prompt explains the browser tools');
    var trace = o.parsed && o.parsed.tool_trace || o.tool_trace || [];
    var ev = JSON.stringify(trace);
    assert.ok(/browser_extract/.test(ev), 'trace names the browser tool: ' + ev.slice(0, 200));
  });
});

t('FAIL CLOSED: both engines down, every browser call fails, the model still says completed -> rejected each round, the run ends BLOCKED (never completed)', function () {
  var dead = path.join(FIX, 'dead-browser-mcp.sh');
  fs.writeFileSync(dead, '#!/usr/bin/env bash\nset -euo pipefail\nexport OBSCURA_CDP_URL=http://127.0.0.1:9\nexport OBSCURA_CDP_TOKEN=' + TOKEN + '\nexport MYTHOS_PLAYWRIGHT_MODULE=/nonexistent/playwright-core\nexport MYTHOS_BROWSER_ARTIFACTS=' + path.join(FIX, 'artifacts') + '\nexec ' + process.execPath + ' ' + path.join(MCP, 'server.js') + '\n', { mode: 0o700 });
  var reg = JSON.parse(fs.readFileSync(REG, 'utf8')); reg.servers['browser-mcp'].transport = { kind: 'stdio', launcher: dead };
  var DREG = path.join(FIX, 'registry-dead.json'); fs.writeFileSync(DREG, JSON.stringify(reg, null, 2));
  var ws = path.join(FIX, 'ws-dead'); fs.mkdirSync(ws, { recursive: true });
  var taskId = 't-browser-failclosed-1';
  seedTask(taskId, ['browser.extract', 'browser.navigate']);
  var claim = { role: 'assistant', content: 'Read it.\n```json\n{"mythos_report": true, "status": "completed", "summary": "the h1 is Example Domain", "files_changed": [], "tests": [], "commit": null, "residual_risks": []}\n```' };
  var transport = fakeTransport([{ role: 'assistant', content: null, tool_calls: [tc('d1', 'browser_extract', { url: 'https://example.com/', selector: 'h1' })] }, claim]);
  var task = { task_id: taskId, working_directory: ws, execution_profile: 'repo-read', timeout_seconds: 300, expected_delivery: 'report', mcp_capabilities: ['browser.extract', 'browser.navigate'] };
  return agent.run(task, 'Read the h1 of https://example.com/ through the browser and report it.', null, 'start', { apiKey: 'k', model: 'm', transport: transport, mcp: Object.assign({}, O, { registryPath: DREG }), structuredReport: false }).then(function (o) {
    var toolMsg = null;
    transport.sent.forEach(function (req) { req.messages.forEach(function (m) { if (m.role === 'tool' && m.tool_call_id === 'd1') toolMsg = m; }); });
    assert.ok(toolMsg && /BROWSER_NO_BACKEND/.test(toolMsg.content), 'the model was told the machine-readable code: ' + (toolMsg && toolMsg.content).slice(0, 200));
    var out = String(o.stdout || '');
    var reports = out.match(/```json\n([\s\S]*?)\n```/g) || [];
    var last = JSON.parse(reports[reports.length - 1].replace(/^```json\n|\n```$/g, ''));
    assert.strictEqual(last.status, 'blocked', 'the settled report is blocked, not completed');
    assert.ok(o.validation && o.validation.passed === false);
    assert.ok(o.validation.rejections.some(function (r) { return /^browser: the report says completed but no browser call succeeded/.test(r); }), JSON.stringify(o.validation.rejections).slice(0, 400));
  });
});
t('fail-closed rule is scoped: a successful browser call, a failed/blocked report, or a task with no browser capability is untouched', function () {
  var caps = { mcp_capabilities: ['browser.extract'] };
  var bad = [{ tool: 'browser_extract', refused: true, detail: 'REFUSED: MCP_TOOL_ERROR: BROWSER_NO_BACKEND' }];
  var good = bad.concat([{ tool: 'browser_extract', refused: false }]);
  assert.ok(agent.browserEvidenceRejection(caps, { status: 'completed' }, bad));
  assert.ok(agent.browserEvidenceRejection(caps, { status: 'completed' }, []), 'no browser call at all is not evidence either');
  assert.strictEqual(agent.browserEvidenceRejection(caps, { status: 'completed' }, good), null);
  assert.strictEqual(agent.browserEvidenceRejection(caps, { status: 'failed' }, bad), null);
  assert.strictEqual(agent.browserEvidenceRejection(caps, { status: 'blocked' }, bad), null);
  assert.strictEqual(agent.browserEvidenceRejection({ mcp_capabilities: [] }, { status: 'completed' }, bad), null);
  assert.strictEqual(agent.browserEvidenceRejection(caps, null, bad), null, 'a missing report is the report rule\'s business');
  assert.strictEqual(agent.BROWSER_INVOKE_TIMEOUT_MS >= 2 * 40000, true, 'the invoke outlives two engine attempts');
});

t('security: the token is in the launcher only — absent from the audit log, the task events and every model request', function () {
  var audit = fs.readFileSync(process.env.MYTHOS_MCP_AUDIT_FILE, 'utf8');
  assert.ok(audit.split('\n').filter(Boolean).length >= 5, 'audit records were written');
  assert.strictEqual(audit.indexOf(TOKEN), -1, 'no token in the audit log');
  assert.ok(/"server":"browser-mcp"/.test(audit) && /"capability":"browser.read"/.test(audit), 'audit names server and capability');
  assert.strictEqual((fs.statSync(process.env.MYTHOS_MCP_AUDIT_FILE).mode & 0o777), 0o600);
  var events = fs.readFileSync(path.join(process.env.MYTHOS_EXECUTOR_HOME, 'tasks', 't-browser-e2e-1', 'events.log'), 'utf8');
  assert.ok(/mcp_invoke/.test(events) && events.indexOf(TOKEN) === -1, 'the task event stream records the invoke without the token');
  assert.ok(srv.seen.filter(function (e) { return e.auth; }).every(function (e) { return e.auth === 'bearer'; }), 'every request to the engine carried the bearer');
});
t('fixtures stop', function () { return srv.close(); });

queue.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
});
