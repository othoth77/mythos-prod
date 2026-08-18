'use strict';
// =====================================================
// MYTHOS — MCP tool adapter tests (capability L)
// tests/mythos-mcp-tool-layer-test.js
//
// core/mcp-tool-adapter.js reshapes the existing tool registry into the
// Model Context Protocol's tools/list and tools/call wire shapes. It is
// a read-only adapter: no MCP dependency, no server, no transport. This
// suite proves the reshaping is faithful and that grant/schema checks
// still run underneath (the adapter must not become a bypass).
//
// Offline, no real tool side effects beyond the existing builtin
// read-only adapters (git.read against a throwaway repo).
//
// Run with: node tests/mythos-mcp-tool-layer-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIXTURES = path.join(os.homedir(), 'mythos-mcp-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });

var tools = require(path.join(EXEC, 'core', 'tool-registry'));
var mcp = require(path.join(EXEC, 'core', 'mcp-tool-adapter'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

function git(repo, args) { return cp.execFileSync('git', ['-C', repo].concat(args), { encoding: 'utf8' }); }
function makeRepo(name) {
  var dir = path.join(FIXTURES, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'f.txt'), 'x\n');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'base']);
  return dir;
}

tools.resetForTests();

// --- tools/list shape ---------------------------------------------------

var listed = mcp.listMcpTools();
var registryNames = tools.discoverTools().map(function (t) { return t.name; });
var listedNames = listed.map(function (t) { return t.name; });

ok(listed.length === registryNames.length, 'listMcpTools: one MCP entry per registered tool');
ok(registryNames.every(function (n) { return listedNames.indexOf(n) !== -1; }),
  'listMcpTools: every registry tool name is present');
ok(listed.every(function (t) {
  return typeof t.name === 'string' && typeof t.description === 'string' && t.description.length > 0;
}), 'listMcpTools: every entry has a non-empty name and description');
ok(listed.every(function (t) { return t.inputSchema && t.inputSchema.type === 'object'; }),
  'listMcpTools: every entry carries an object-typed inputSchema');

var gitEntry = listed.filter(function (t) { return t.name === 'git.read'; })[0];
var gitDef = tools.getTool('git.read');
ok(!!gitEntry, 'listMcpTools: git.read is listed');
ok(gitEntry.inputSchema === gitDef.input_schema,
  'listMcpTools: inputSchema is passed through from the registry definition, not re-derived');
ok(gitEntry.description.indexOf('repo_inspection') !== -1 &&
   gitEntry.description.indexOf('READ') !== -1 && gitEntry.description.indexOf('low') !== -1,
  'listMcpTools: description is built from real registry metadata (capabilities/policy/risk)');

// A tool with no input_schema still gets a usable (empty object) schema.
tools.registerTool('mcpadapter.noschema', {
  version: '1', capabilities: ['x'], policy_class: 'READ', risk: 'low', provider: 'mock'
});
var noSchemaEntry = mcp.listMcpTools().filter(function (t) { return t.name === 'mcpadapter.noschema'; })[0];
ok(!!noSchemaEntry && noSchemaEntry.inputSchema.type === 'object' &&
   Object.keys(noSchemaEntry.inputSchema.properties || {}).length === 0,
  'listMcpTools: schema-less tool falls back to an empty object schema instead of throwing');

// --- tools/call shape: success -------------------------------------------

var repo = makeRepo('mcp-repo');
var okCall = mcp.callMcpTool('git.read', { repo_path: repo }, ['git.read']);
ok(okCall.isError === false, 'callMcpTool: successful invocation is not flagged as an error');
ok(Array.isArray(okCall.content) && okCall.content.length === 1 && okCall.content[0].type === 'text',
  'callMcpTool: success result uses the MCP content-array shape');
var payload = JSON.parse(okCall.content[0].text);
ok(payload.branch === 'main' && /^[0-9a-f]{40}$/.test(payload.head),
  'callMcpTool: success content carries the real tool result as JSON text');

// --- tools/call shape: underlying checks are NOT bypassed -----------------

var ungranted = mcp.callMcpTool('git.read', { repo_path: repo }, []);
ok(ungranted.isError === true && /NOT_GRANTED/.test(ungranted.content[0].text),
  'callMcpTool: an ungranted call is still refused by the registry, reshaped as isError');

var badInput = mcp.callMcpTool('git.read', { nonsense: true }, ['git.read']);
ok(badInput.isError === true && /INPUT_INVALID/.test(badInput.content[0].text),
  'callMcpTool: schema validation still runs before the adapter can succeed');

var ghost = mcp.callMcpTool('ghost.tool', {}, ['ghost.tool']);
ok(ghost.isError === true && /NO_SUCH_TOOL/.test(ghost.content[0].text),
  'callMcpTool: unknown tool is reported as an MCP error result, not a throw');

// --- Summary ---------------------------------------------------------------

fs.rmSync(FIXTURES, { recursive: true, force: true });
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
process.exit(0);
