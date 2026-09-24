'use strict';
// =====================================================
// MYTHOS V3.2 — project intelligence: "do we already have this?"
// tests/v32-project-intelligence-test.js
//
// Pins the read-only questions scripts/project-intelligence.js answers for
// the director before it builds anything: reuse, project, outcomes; that the
// registries it reads are consistent (validate exits 0); that its output is
// labelled data with a file per match; that it writes nothing and opens no
// network; and that OTHMODE's project_context projection now carries the
// capabilities the registry records.
// Run with: node tests/v32-project-intelligence-test.js
// =====================================================
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var TOOL = path.join(ROOT, 'scripts', 'project-intelligence.js');
var pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + e.message); } }
function run(args, env) {
  var r = cp.spawnSync(process.execPath, [TOOL].concat(args), { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function json(args, env) { var r = run(args, env); return { code: r.code, data: JSON.parse(r.out) }; }
function gitStatus() { return cp.execFileSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' }); }

t('P1 validate exits 0: every skill directory is registered, every registry consistent', function () {
  var r = run(['validate']);
  assert.strictEqual(r.code, 0, r.out.slice(-600));
  assert.ok(/validate PASSED/.test(r.out));
});

t('P2 reuse answers across registry, skills, executor config and OTHKM seeds — labelled data, every match cites a real file', function () {
  var r = json(['reuse', 'sandboxed tool execution with validation and repair']);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.data.kind, 'data', 'the envelope says data');
  assert.ok(/decide nothing/.test(r.data.note), 'and says it decides nothing');
  assert.ok(r.data.matches.length >= 5, 'several matches: ' + r.data.matches.length);
  r.data.matches.forEach(function (m) {
    assert.ok(fs.existsSync(path.join(ROOT, m.file)), 'cited file exists: ' + m.file);
    assert.ok(m.score > 0 && m.score <= 1, 'score bounded');
  });
  assert.ok(r.data.matches.some(function (m) { return m.source === 'portfolio-capability' && /^mythos-haddad#/.test(m.id); }), 'the Haddad sandboxed runner is found');
  assert.ok(r.data.matches.some(function (m) { return m.source === 'agent' && m.id === 'haddad-qwen'; }), 'the haddad-qwen agent is found');
  var sources = {}; r.data.matches.forEach(function (m) { sources[m.source] = 1; });
  assert.ok(Object.keys(sources).length >= 3, 'matches come from several registries: ' + Object.keys(sources).join(','));
});

t('P3 reuse finds OTHKM\'s own graph before anyone builds one', function () {
  var r = json(['reuse', 'knowledge graph relationships between projects']);
  assert.ok(r.data.matches.slice(0, 3).some(function (m) { return m.id.indexOf('oth-knowledge#') === 0 && /graph/.test(m.text); }), JSON.stringify(r.data.matches.slice(0, 3).map(function (m) { return m.id; })));
});

t('P4 reuse with an empty need is a usage error, not a match-everything', function () {
  assert.strictEqual(run(['reuse']).code, 2);
});

t('P4b --limit keeps the answer small for an 8k-context worker', function () {
  var r = json(['reuse', 'seed typed relationships between projects', '--limit', '3']);
  assert.strictEqual(r.data.matches.length, 3);
  assert.ok(r.data.matches.every(function (m) { return m.text.length <= 200; }), 'short texts');
  assert.ok(JSON.stringify(r.data).length < 2500, 'whole answer under 2.5 KB: ' + JSON.stringify(r.data).length);
  assert.ok(r.data.terms.indexOf('limit') === -1, 'the flag is not treated as a search word');
});

t('P5 project answers deps, dependents, capabilities and seed relationships in both directions', function () {
  var r = json(['project', 'oth-knowledge']);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.data.found, true);
  ['mythos-ai-executor', 'oth-mcp', 'othmode'].forEach(function (d) { assert.ok(r.data.dependents.indexOf(d) !== -1, 'dependent ' + d); });
  assert.ok(r.data.shared_platform_capabilities.length >= 5);
  assert.ok(r.data.relationships.some(function (x) { return x.dir === 'in' && x.rel_type === 'uses' && x.other === 'mythos-ai-executor'; }), 'executor uses oth-knowledge (in)');
  assert.ok(r.data.relationships.some(function (x) { return x.dir === 'in' && x.rel_type === 'can_execute' && x.other === 'haddad'; }), 'haddad can_execute oth-knowledge (in)');
  assert.ok(r.data.relationships.some(function (x) { return x.dir === 'out' && x.rel_type === 'stored_on'; }), 'an outgoing relationship too');
  var miss = json(['project', 'no-such-project']);
  assert.strictEqual(miss.code, 1); assert.strictEqual(miss.data.found, false);
  assert.ok(miss.data.known.indexOf('mythos-haddad') !== -1, 'an unknown id lists what is known');
});

t('P6 outcomes summarises a store by provider × role, counts context exhaustion, passes reputation through', function () {
  var store = fs.mkdtempSync(path.join(os.tmpdir(), 'v32-outcomes-'));
  function task(id, t, s, r) {
    var d = path.join(store, 'tasks', id); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'task.json'), JSON.stringify(t));
    fs.writeFileSync(path.join(d, 'status.json'), JSON.stringify(s));
    if (r) fs.writeFileSync(path.join(d, 'report.json'), JSON.stringify(r));
  }
  var ev = function (rr, diag, mech) { return { evidence: { repair_rounds: rr, diagnosis_requested: diag, validation: { evidence: { mechanically_verified: mech } } } }; };
  task('t-a', { role: 'coder', project: 'oth-knowledge', provider: 'haddad-agent' }, { status: 'COMPLETED', provider_used: 'haddad-agent' }, ev(0, false, true));
  task('t-b', { role: 'coder', project: 'oth-knowledge', provider: 'haddad-agent' }, { status: 'FAILED', provider_used: 'haddad-agent', last_error: 'HADDAD_AGENT_CONTEXT_EXHAUSTED: x' }, ev(2, true, false));
  task('t-c', { role: 'researcher', project: 'mythos-haddad', provider: 'haddad-agent' }, { status: 'COMPLETED', provider_used: 'haddad-agent' }, ev(0, false, false));
  fs.mkdirSync(path.join(store, 'orchestration'));
  // where core/reputation.js really writes (core/store.root())
  fs.writeFileSync(path.join(store, 'orchestration', 'reputation.json'), JSON.stringify({ 'haddad-qwen': { coding: { n: 2, successes: 1 } } }));
  var r = json(['outcomes', '--store', store]);
  assert.strictEqual(r.code, 0);
  var coder = r.data.groups.filter(function (g) { return g.provider_role === 'haddad-agent × coder'; })[0];
  assert.strictEqual(coder.n, 2); assert.strictEqual(coder.status.COMPLETED, 1); assert.strictEqual(coder.status.FAILED, 1);
  assert.strictEqual(coder.mean_repair_rounds, 1); assert.strictEqual(coder.diagnosis_requested, 1);
  assert.strictEqual(coder.mechanically_verified, 1); assert.strictEqual(coder.context_exhausted, 1);
  assert.strictEqual(r.data.reputation['haddad-qwen'].coding.n, 2, 'reputation passed through as data');
  assert.strictEqual(json(['outcomes', '--store', path.join(store, 'nope')]).code, 1);
  var prev = process.env.MYTHOS_EXECUTOR_HOME; process.env.MYTHOS_EXECUTOR_HOME = store;
  var coreStore = require(path.join(ROOT, 'projects', 'mythos-ai-executor', 'core', 'store.js'));
  assert.strictEqual(coreStore.root(), path.join(store, 'orchestration'), 'the path read is the path core/reputation.js writes');
  if (prev === undefined) delete process.env.MYTHOS_EXECUTOR_HOME; else process.env.MYTHOS_EXECUTOR_HOME = prev;
  fs.rmSync(store, { recursive: true, force: true });
});

t('P7 read-only by construction and by behaviour: no write or network call in the source, the tree unchanged after every command', function () {
  var src = fs.readFileSync(TOOL, 'utf8');
  ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'unlinkSync', "require('http", "require('net", 'fetch(', 'spawn(', 'spawnSync(', 'execFile'].forEach(function (s) {
    assert.ok(src.indexOf(s) === -1, 'the tool contains no ' + s);
  });
  // The one process the tool may start is the pre-existing gitOutput()
  // helper, and only with fixed, read-only git subcommands.
  assert.strictEqual((src.match(/execSync\(/g) || []).length, 1, 'exactly one execSync, inside gitOutput');
  assert.ok(/cp\.execSync\('git ' \+ args/.test(src), 'and it runs git');
  var calls = (src.match(/gitOutput\('([^']*)'\)/g) || []).map(function (c) { return c.replace(/^gitOutput\('|'\)$/g, ''); });
  assert.ok(calls.length >= 1 && calls.every(function (a) { return /^(branch --show-current|rev-parse HEAD|log |status --porcelain)/.test(a); }), 'every gitOutput call is a fixed read-only subcommand: ' + calls.join(' | '));
  assert.ok(!/gitOutput\([^')]/.test(src.replace(/function gitOutput\(args\)/, '')), 'no gitOutput call takes a variable argument');
  var before = gitStatus();
  run(['reuse', 'anything at all']); run(['project', 'mythos-haddad']); run(['validate']);
  assert.strictEqual(gitStatus(), before, 'git status identical after running the commands');
});

t('P8 OTHMODE project_context now carries each track\'s capabilities and notes, bounded', function () {
  var registries = require(path.join(ROOT, 'projects', 'command-center', 'reference', 'othmode', 'registries.js'));
  var p = registries.projects();
  var haddad = p.projects.filter(function (x) { return x.id === 'mythos-haddad'; })[0];
  assert.ok(haddad, 'mythos-haddad is a project in the read model');
  assert.ok(Array.isArray(haddad.shared_platform_capabilities) && haddad.shared_platform_capabilities.length >= 3, 'capabilities passed through');
  assert.ok(typeof haddad.notes === 'string' && haddad.notes.length > 0 && haddad.notes.length <= 800, 'notes passed through, bounded');
  p.projects.forEach(function (x) { assert.ok(x.shared_platform_capabilities.length <= 20); });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
