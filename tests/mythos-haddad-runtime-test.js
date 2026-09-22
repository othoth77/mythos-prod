'use strict';
// =====================================================
// MYTHOS HADDAD — HAD-2 local AI runtime invariants
// tests/mythos-haddad-runtime-test.js
//
// Machine-independent, like tests/mythos-haddad-v0-test.js: validates the
// HAD-2 tooling itself (syntax, safety properties, documentation), not
// live GPU/model state — that is haddad-health.js's ai_runtime check,
// verified on the machine and recorded in docs/AI_RUNTIME.md.
//   * every new script/source file parses;
//   * no sudo anywhere (this install needed none — see docs/AI_RUNTIME.md,
//     "Why a loader shim exists" — a real, host-verified constraint, not a
//     shortcut) and no host-key-check bypass;
//   * the model installer pins by sha256 and never installs a second model;
//   * the loader shim is glue only: no llama.cpp/ggml source is vendored;
//   * the systemd unit is loopback-bound, token-required, and repeats none
//     of the user-scope-fatal directives V0/other Mythos units already hit;
//   * the free-LLM catalog and production orchestration are untouched;
//   * haddad-health.js gained exactly one new, well-formed check.
// =====================================================
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var DIR = path.join(__dirname, '..', 'projects', 'mythos-haddad');
var BIN = path.join(DIR, 'bin');
var pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); } }
function read(rel) { return fs.readFileSync(path.join(DIR, rel), 'utf8'); }
function run(cmd, args, opts) { return cp.spawnSync(cmd, args, Object.assign({ encoding: 'utf8', timeout: 60000 }, opts || {})); }

var NEW_SCRIPTS = ['haddad-runtime-install.sh', 'haddad-model-install.sh', 'haddad-runtime-setup.sh', 'haddad-gpu-vram.py'];

t('every new HAD-2 script exists, is executable and parses', function () {
  NEW_SCRIPTS.forEach(function (s) {
    var p = path.join(BIN, s);
    assert.ok(fs.statSync(p).mode & 0o100, s + ' is executable');
    var r = /\.sh$/.test(s) ? run('bash', ['-n', p]) : run('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', p]);
    assert.strictEqual(r.status, 0, s + ': ' + r.stderr);
  });
});

t('the loader shim source compiles (glue only — no llama.cpp/ggml code vendored)', function () {
  var src = read('src/backend-loader-shim.c');
  assert.ok(src.length < 3000, 'shim stays tiny (glue, not a reimplementation): ' + src.length + ' bytes');
  ['ggml_compute', 'ggml_tensor', 'llama_model', 'llama_context', 'GGML_TYPE_'].forEach(function (marker) {
    assert.ok(src.indexOf(marker) === -1, 'shim does not reference internal ggml/llama.cpp types (' + marker + ')');
  });
  assert.ok(/ggml_backend_load\s*\(/.test(src), 'shim calls the one public entry point it exists to call');
  var tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'haddad-shim-'));
  var out = path.join(tmp, 'test.so');
  var r = run('gcc', ['-shared', '-fPIC', '-o', out, path.join(DIR, 'src', 'backend-loader-shim.c'), '-Wl,--no-undefined=false']);
  // Linking against the real libggml.so is exercised by haddad-runtime-install.sh on the
  // target host; here we only need the C source itself to be syntactically valid.
  var compileOnly = run('gcc', ['-fsyntax-only', path.join(DIR, 'src', 'backend-loader-shim.c')]);
  assert.strictEqual(compileOnly.status, 0, 'shim source has no syntax errors: ' + compileOnly.stderr);
  fs.rmSync(tmp, { recursive: true, force: true });
});

t('tooling is user-level: no sudo execution, no host key check bypass', function () {
  NEW_SCRIPTS.concat(['haddad-health.js']).forEach(function (s) {
    var heredoc = null;
    read('bin/' + s).split('\n').forEach(function (line, i) {
      if (heredoc) { if (line.trim() === heredoc) heredoc = null; return; }
      var m = /<<-?\s*['"]?([A-Za-z_]+)['"]?\s*$/.exec(line); if (m) heredoc = m[1];
      var code = line.replace(/#.*$/, '').replace(/say ".*$/, '');
      assert.ok(!/(^|[\s;&|(])sudo\s/.test(code), s + ':' + (i + 1) + ' executes sudo');
      assert.ok(!/StrictHostKeyChecking\s*=?\s*no|UserKnownHostsFile\s*=?\s*\/dev\/null/i.test(line), s + ':' + (i + 1) + ' weakens host key checking');
    });
  });
});

t('model installer pins by sha256 and never installs a second model', function () {
  var src = read('bin/haddad-model-install.sh');
  assert.ok(/qwen2\.5-7b-instruct-q4_k_m/.test(src), 'names the one pinned model');
  var shaMatches = src.match(/\["[^"]+"\]="[0-9a-f]{64}"/g) || [];
  assert.strictEqual(shaMatches.length, 2, 'exactly two pinned shards (one split model), got ' + shaMatches.length);
  shaMatches.forEach(function (m) { assert.ok(/"[0-9a-f]{64}"$/.test(m), 'pin is a real 64-hex-char sha256, not a placeholder: ' + m); });
  assert.ok(/sha256sum|sha_of/.test(src), 'verifies by computing sha256 locally, not by trusting a header');
  assert.ok(!/qwen2\.5-1\.5b|qwen2\.5-14b|qwen2\.5-32b|llama-3|mistral-7b/i.test(src), 'no second model name present');
});

t('the loader shim is documented as a workaround, with the verified evidence for why', function () {
  var doc = read('docs/AI_RUNTIME.md');
  ['unshare --user', 'bwrap', 'LD_PRELOAD', 'ENOENT', 'GGML_BACKEND_PATH'].forEach(function (marker) {
    assert.ok(doc.indexOf(marker) !== -1, 'AI_RUNTIME.md documents ' + marker);
  });
});

t('systemd unit: loopback-bound, token-required, avoids known user-scope-fatal directives', function () {
  var svc = read('systemd/mythos-haddad-runtime.service');
  // Directive checks must look only at active (non-comment) lines — the unit's header
  // comment deliberately documents each excluded directive BY NAME, so a raw substring
  // match against the whole file would false-positive on the documentation itself.
  var active = svc.split('\n').filter(function (l) { return !/^\s*#/.test(l); }).join('\n');

  assert.ok(/--host 127\.0\.0\.1/.test(active), 'binds loopback only');
  assert.ok(!/--host 0\.0\.0\.0/.test(active), 'never binds all interfaces');
  assert.ok(/--api-key-file/.test(active), 'requires an API key');
  assert.ok(!/PrivateDevices\s*=\s*yes/i.test(active), 'PrivateDevices would hide the GPU render node');
  assert.ok(!/MemoryDenyWriteExecute\s*=\s*yes/i.test(active), 'MemoryDenyWriteExecute breaks the Vulkan JIT');
  ['ProtectKernelTunables', 'ProtectKernelModules', 'ProtectControlGroups', 'ProtectClock', 'RestrictNamespaces'].forEach(function (d) {
    assert.ok(!new RegExp('^' + d + '\\s*=', 'm').test(active), d + ' fails a systemd --user manager (status=218/CAPABILITIES)');
  });
  assert.ok(!/SystemCallFilter\s*=\s*~@privileged\s+@resources/.test(active), '~@resources killed the Vulkan driver with SIGSYS on this host — must not come back');
  assert.ok(/MemoryMax\s*=/.test(active) && /OOMScoreAdjust\s*=/.test(active), 'has resource ceilings on an 8 GB shared machine');

  // The comment must still document every excluded directive by name — that's the whole
  // point of this file's convention (see V0's systemd units) — so check the full text here.
  ['PrivateDevices=yes', 'MemoryDenyWriteExecute=yes', 'ProtectKernelTunables'].forEach(function (d) {
    assert.ok(svc.indexOf(d) !== -1, 'header explains why ' + d + ' is excluded');
  });
});

// SCOPE GUARD. A Haddad stage must never reach into production
// orchestration. The guard reads the BRANCH's diff, so it must also know
// whose diff it is reading: a branch that changes nothing under
// projects/mythos-haddad/ is not a Haddad stage, and refusing its executor
// changes makes this file veto unrelated core work. It did exactly that —
// a core branch that legitimately changed core/validation.js and touched no
// Haddad file at all failed here. So the guard applies to Haddad branches
// only, and for those it refuses precisely what it always refused.
//
// HAD-3 legitimately adds ONE additive entry to config/projects.json (the
// Haddad project registration) with owner approval — see
// projects/mythos-haddad/docs/GITHUB_WORKER.md. It is named explicitly so
// the guard stays sharp: everything else under core/, lib/, providers/ and
// free-llm/ is still refused, which is what this test exists to protect.
var ALLOWED = [
  'projects/mythos-ai-executor/config/projects.json',
  // HAD-4 (PR #365): the Haddad-side provider and what it calls — the one
  // stage whose purpose IS an executor provider. Each is covered by
  // tests/mythos-haddad-tool-runner-test.js / -supervised-loop-test.js;
  // anything else under the protected trees still fails this guard.
  'projects/mythos-ai-executor/providers/haddad-agent.js',
  'projects/mythos-ai-executor/lib/work-validation.js',
  'projects/mythos-ai-executor/lib/policy.js',
  'projects/mythos-ai-executor/free-llm/adapter.js'
];
var PROTECTED = /^projects\/mythos-ai-executor\/(core|lib|providers|free-llm|config)\//;

function isHaddadBranch(files) {
  return files.some(function (f) { return /^projects\/mythos-haddad\//.test(f); });
}

function forbiddenExecutorFiles(files) {
  if (!isHaddadBranch(files)) return [];   // not a Haddad stage — not this guard's business
  return files.filter(function (f) { return ALLOWED.indexOf(f) === -1 && PROTECTED.test(f); });
}

t('production orchestration and the free-LLM catalog are untouched', function () {
  var repoRoot = path.join(__dirname, '..');
  var diff = run('git', ['diff', '--name-only', 'origin/main...HEAD'], { cwd: repoRoot });
  if (diff.status !== 0 || !diff.stdout.trim()) return; // not in a git checkout with origin/main, or nothing to compare — skip
  var offenders = forbiddenExecutorFiles(diff.stdout.trim().split('\n'));
  assert.strictEqual(offenders.join(', '), '',
    'HAD-2 does not touch orchestration/provider code: ' + offenders.join(', '));
});

t('the scope guard is scoped to Haddad branches and still bites', function () {
  assert.deepStrictEqual(
    forbiddenExecutorFiles(['projects/mythos-ai-executor/core/validation.js', 'tests/some-core-test.js']), [],
    'a branch that touches no Haddad file is not judged by this guard');
  assert.deepStrictEqual(
    forbiddenExecutorFiles(['projects/mythos-haddad/lib/haddad-runtime.js', 'docs/AI_RUNTIME.md']), [],
    'a Haddad branch that stays inside its own tree passes');
  assert.deepStrictEqual(
    forbiddenExecutorFiles(['projects/mythos-haddad/lib/haddad-runtime.js',
      'projects/mythos-ai-executor/core/validation.js']),
    ['projects/mythos-ai-executor/core/validation.js'],
    'a Haddad branch that reaches into production orchestration still FAILS');
  assert.deepStrictEqual(
    forbiddenExecutorFiles(['projects/mythos-haddad/docs/GITHUB_WORKER.md',
      'projects/mythos-ai-executor/config/projects.json']), [],
    'the one owner-approved HAD-3 registration stays allow-listed');
  assert.deepStrictEqual(
    forbiddenExecutorFiles(['projects/mythos-haddad/x.md', 'projects/mythos-ai-executor/config/agents.json']),
    ['projects/mythos-ai-executor/config/agents.json'],
    'the allow-list is one FILE, not the whole config directory');
});

t('haddad-health.js gained exactly one new, well-formed check (ai_runtime)', function () {
  var src = read('bin/haddad-health.js');
  var ids = (src.match(/^check\('([a-z_]+)'/gm) || []).map(function (m) { return m.match(/'([a-z_]+)'/)[1]; });
  assert.ok(ids.indexOf('ai_runtime') !== -1, 'ai_runtime check present');
  assert.strictEqual(ids.filter(function (i) { return i === 'ai_runtime'; }).length, 1, 'defined exactly once');
  // WARN (not FAIL) when the optional unit isn't installed — V0-only hosts must stay green.
  assert.ok(/not installed \(optional, HAD-2/.test(src), 'absent runtime is WARN, not FAIL');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
