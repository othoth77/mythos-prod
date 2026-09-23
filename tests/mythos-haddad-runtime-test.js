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
  'projects/mythos-ai-executor/free-llm/adapter.js',
  // V2.1 (AI team foundation): the stage whose purpose IS to register the
  // Haddad worker as an agent with roles. The registry entry, its probe, the
  // role table and the library that validates it — each named, each covered
  // by tests/mythos-haddad-ai-team-test.js. Everything else under the
  // protected trees still fails this guard, which is the point of naming
  // them rather than widening the pattern.
  'projects/mythos-ai-executor/config/agents.json',
  'projects/mythos-ai-executor/config/roles.json',
  'projects/mythos-ai-executor/lib/roles.js',
  'projects/mythos-ai-executor/core/agent-registry.js'
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
  // The property this pins is per-FILE allow-listing, not per-directory. Its
  // example used to be config/agents.json; V2.1 allow-listed that file by
  // name (the agent registration IS that stage), so the example moves to a
  // config file no stage has named. The property is unchanged.
  assert.deepStrictEqual(
    forbiddenExecutorFiles(['projects/mythos-haddad/x.md', 'projects/mythos-ai-executor/config/model-policy.json']),
    ['projects/mythos-ai-executor/config/model-policy.json'],
    'the allow-list is one FILE, not the whole config directory');
  assert.deepStrictEqual(
    forbiddenExecutorFiles(['projects/mythos-haddad/x.md', 'projects/mythos-ai-executor/core/scheduler.js']),
    ['projects/mythos-ai-executor/core/scheduler.js'],
    'naming one file under core/ did not open core/ — the scheduler is still refused');
});

t('haddad-health.js gained exactly one new, well-formed check (ai_runtime)', function () {
  var src = read('bin/haddad-health.js');
  var ids = (src.match(/^check\('([a-z_]+)'/gm) || []).map(function (m) { return m.match(/'([a-z_]+)'/)[1]; });
  assert.ok(ids.indexOf('ai_runtime') !== -1, 'ai_runtime check present');
  assert.strictEqual(ids.filter(function (i) { return i === 'ai_runtime'; }).length, 1, 'defined exactly once');
  // WARN (not FAIL) when the optional unit isn't installed — V0-only hosts must stay green.
  assert.ok(/not installed \(optional, HAD-2/.test(src), 'absent runtime is WARN, not FAIL');
});


// ── ai_runtime readiness states ────────────────────────────────────
// Drives the REAL check with systemctl and curl stubbed on PATH, so the
// three states can be asserted without restarting the live runtime (which
// is answering E2E traffic) and without waiting for a cold boot. Only
// those two binaries are shadowed; everything else resolves normally.
function runAiRuntime(opts) {
  var tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'haddad-ready-'));
  var stub = path.join(tmp, 'stub');
  fs.mkdirSync(stub, { recursive: true });
  fs.mkdirSync(path.join(tmp, '.config', 'systemd', 'user'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.config', 'mythos-haddad'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.config', 'systemd', 'user', 'mythos-haddad-runtime.service'), '# stub\n');
  fs.writeFileSync(path.join(tmp, '.config', 'mythos-haddad', 'runtime.key'), 'test-key\n');

  // `show` prints the properties the check asks for; `is-active` prints the
  // state. Anything else answers empty, as systemctl would for a stub host.
  var activeSince = new Date(Date.now() - opts.active_for_s * 1000).toUTCString().replace('GMT', 'UTC');
  fs.writeFileSync(path.join(stub, 'systemctl'),
    '#!/bin/sh\n' +
    'case " $* " in\n' +
    '  *" is-active "*) echo "' + opts.active + '" ;;\n' +
    '  *" show "*) echo "ActiveEnterTimestamp=' + activeSince + '"; echo "TimeoutStartUSec=' + opts.budget + '";' +
    (opts.exec_start === undefined ? ' echo "ExecStart={ argv[]=/usr/bin/llama-server --n-gpu-layers auto ; }"' :
      opts.exec_start === null ? '' : ' echo "ExecStart=' + opts.exec_start + '"') + ' ;;\n' +
    '  *) echo "" ;;\n' +
    'esac\nexit 0\n', { mode: 0o755 });
  // The check asks curl for the body plus "\n%{http_code}"; reproduce both.
  fs.writeFileSync(path.join(stub, 'curl'),
    '#!/bin/sh\nprintf \'%s\\n%s\' \'' + opts.body.replace(/'/g, "'\\''") + '\' \'' + opts.code + '\'\nexit 0\n', { mode: 0o755 });
  // The GPU-offload assertion reads llama-server's load accounting through
  // haddad-telemetry.js's parser, which shells out to journalctl. Feed it a
  // recorded boot so the assertion is tested against what the machine really
  // printed, not against a paraphrase of it.
  if (opts.journal !== undefined) {
    fs.writeFileSync(path.join(stub, 'journalctl'),
      '#!/bin/sh\ncat <<\'JEOF\'\n' + opts.journal + '\nJEOF\nexit 0\n', { mode: 0o755 });
  }

  var r = cp.spawnSync(process.execPath, [path.join(BIN, 'haddad-health.js'), '--quick', '--json', '--no-log'],
    { encoding: 'utf8', timeout: 180000,
      env: Object.assign({}, process.env, { HOME: tmp, PATH: stub + ':' + process.env.PATH,
        HADDAD_STATE_DIR: path.join(tmp, 'state'), HADDAD_DATA_DIR: path.join(tmp, 'data') }) });
  var rep = JSON.parse(r.stdout);
  fs.rmSync(tmp, { recursive: true, force: true });
  return rep.checks.filter(function (c) { return c.id === 'ai_runtime'; })[0];
}

var CPU_ONLY_BOOT = fs.readFileSync(path.join(__dirname, 'fixtures', 'haddad-runtime-cpu-only-boot.txt'), 'utf8').trim();
var GPU_BOOT = [
  '2026-09-22T22:40:52+00:00  load_backend: loaded Vulkan backend from /home/othman/.local/share/mythos-haddad/runtime/llama.cpp/usr/lib/x86_64-linux-gnu/ggml/backends0/libggml-vulkan.so',
  '2026-09-22T22:41:20+00:00  llama_params_fit_impl: projected to use 4920 MiB of device memory vs. 5755 MiB of free device memory',
  '2026-09-22T22:41:20+00:00  llama_model_load_from_file_impl: using device Vulkan0 (NVIDIA GeForce GTX 1660 SUPER (NVK TU116)) (0000:29:00.0) - 5755 MiB free',
  '2026-09-22T22:41:21+00:00  load_tensors: offloaded 27/29 layers to GPU',
  '2026-09-22T22:41:21+00:00  load_tensors:      Vulkan0 model buffer size =  3883.68 MiB',
  '2026-09-22T22:42:54+00:00  main: server is listening on http://127.0.0.1:8600'
].join('\n');

var LOADING = '{"error":{"message":"Loading model","type":"unavailable_error","code":503}}';
var LOADED = '{"object":"list","data":[{"id":"qwen2.5-7b-instruct-q4_k_m.gguf"}]}';

t('ai_runtime state 1: unit installed but not active is a FAIL at any age', function () {
  var c = runAiRuntime({ active: 'inactive', active_for_s: 5, budget: '10min', code: 200, body: LOADED });
  assert.strictEqual(c.status, 'FAIL', 'a stopped runtime never gets startup grace');
  assert.ok(/not active/.test(c.detail), c.detail);
});

t('ai_runtime state 2: "Loading model" INSIDE the startup budget is a readiness state, not a failure', function () {
  // The real 2026-09-22 post-reboot case: active 183 s, budget 10 min, 503.
  var c = runAiRuntime({ active: 'active', active_for_s: 183, budget: '10min', code: 503, body: LOADING });
  assert.strictEqual(c.status, 'WARN', 'a normal boot must not be reported as FAIL');
  assert.ok(/STARTING/.test(c.detail), c.detail);
  assert.ok(/Loading model/.test(c.detail), 'the runtime\'s own reason is carried through');
  assert.strictEqual(c.data.ready, false, 'WARN never claims the model is ready');
  assert.strictEqual(c.data.starting, true);
});

t('ai_runtime state 2 expires: the SAME 503 PAST the budget is a real FAIL', function () {
  var c = runAiRuntime({ active: 'active', active_for_s: 601, budget: '10min', code: 503, body: LOADING });
  assert.strictEqual(c.status, 'FAIL', 'readiness grace is bounded, not indefinite');
  assert.ok(!/STARTING/.test(c.detail), c.detail);
  assert.strictEqual(c.data.starting, false);
});

t('ai_runtime grace needs a known clock AND a known budget — never assumed', function () {
  var c = runAiRuntime({ active: 'active', active_for_s: 10, budget: 'infinity', code: 503, body: LOADING });
  assert.strictEqual(c.status, 'FAIL', 'an unbounded budget buys no grace');
  var d = runAiRuntime({ active: 'active', active_for_s: 10, budget: '', code: 503, body: LOADING });
  assert.strictEqual(d.status, 'FAIL', 'an unreadable budget buys no grace');
});

t('ai_runtime state 3: only a real model answer is a PASS', function () {
  // GPU_BOOT is defined below; a model that answers is necessary but, since
  // the offload assertion, no longer sufficient — see the GPU section.
  var c = runAiRuntime({ active: 'active', active_for_s: 5, budget: '10min', code: 200, body: LOADED, journal: GPU_BOOT });
  assert.strictEqual(c.status, 'PASS');
  assert.strictEqual(c.data.ready, true);
  assert.ok(/qwen2\.5-7b/.test(c.detail), c.detail);
  // An empty model list inside the window is STARTING, never PASS.
  var d = runAiRuntime({ active: 'active', active_for_s: 5, budget: '10min', code: 200, body: '{"object":"list","data":[]}', journal: GPU_BOOT });
  assert.strictEqual(d.status, 'WARN');
  assert.strictEqual(d.data.ready, false);
});

t('the runtime unit declares a startup budget above the MEASURED cold start', function () {
  var svc = read('systemd/mythos-haddad-runtime.service');
  var m = /^TimeoutStartSec=(\d+)$/m.exec(svc);
  assert.ok(m, 'TimeoutStartSec is set — it is the readiness budget the health check reads back');
  // Measured on this host 2026-09-22: active 22:14:53, model loaded 22:18:21.
  assert.ok(parseInt(m[1], 10) >= 208, 'budget must exceed the 208 s cold start that produced the false FAIL');
});

t('health reports a timed-out probe as a timeout, not as an absent binary', function () {
  var src = read('bin/haddad-health.js');
  assert.ok(/timed_out/.test(src), 'sh() distinguishes a killed child from a failed one');
  assert.ok(/npm\.timed_out \? 'NOT MEASURED/.test(src), 'a timed-out npm is not reported as MISSING');
});



// ── ai_runtime GPU offload assertion ───────────────────────────────
// The 2026-09-22 false PASS: the runtime answered /v1/models perfectly while
// running entirely on CPU, and health reported 16/16 twice. gpu_test probes
// the card in its own process, so it was also right, and also irrelevant.

t('ai_runtime FAILS a runtime that answers perfectly but runs on CPU', function () {
  // Verbatim from the real 22:14:53 boot: "ggml_vulkan: No devices found",
  // no "offloaded" line anywhere, and the model still answers /v1/models.
  var c = runAiRuntime({ active: 'active', active_for_s: 900, budget: '10min',
    code: 200, body: LOADED, journal: CPU_ONLY_BOOT });
  assert.strictEqual(c.status, 'FAIL', 'a CPU-only runtime must not pass');
  assert.ok(/running ON CPU/.test(c.detail), c.detail);
  assert.ok(/found no GPU device/.test(c.detail), c.detail);
  assert.strictEqual(c.data.no_devices, true);
  assert.ok(/systemctl --user restart/.test(c.detail), 'the failure says what to do about it');
});

t('"loaded Vulkan backend" is NOT accepted as evidence of a GPU', function () {
  // That line is present in the CPU-only fixture. Loading the backend is not
  // using it, and matching it would re-create the exact bug being fixed.
  assert.ok(/loaded Vulkan backend/.test(CPU_ONLY_BOOT), 'the fixture really does contain the trap line');
  var c = runAiRuntime({ active: 'active', active_for_s: 900, budget: '10min',
    code: 200, body: LOADED, journal: CPU_ONLY_BOOT });
  assert.strictEqual(c.status, 'FAIL', 'the trap line did not buy a PASS');
});

t('ai_runtime PASSES on real offload, and reports the layer count', function () {
  var c = runAiRuntime({ active: 'active', active_for_s: 900, budget: '10min',
    code: 200, body: LOADED, journal: GPU_BOOT });
  assert.strictEqual(c.status, 'PASS');
  assert.strictEqual(c.data.gpu_layers, 27);
  assert.strictEqual(c.data.gpu_layers_total, 29);
  assert.strictEqual(c.data.no_devices, false);
  assert.ok(/27\/29 layers on the GPU/.test(c.detail), c.detail);
});

t('unverifiable offload is WARN — never PASS, never invented', function () {
  // An empty journal window: the model answers, but nothing proves where from.
  var c = runAiRuntime({ active: 'active', active_for_s: 900, budget: '10min',
    code: 200, body: LOADED, journal: '' });
  assert.strictEqual(c.status, 'WARN', 'unproven is not proven-good');
  assert.ok(/NOT VERIFIED/.test(c.detail), c.detail);
  assert.strictEqual(c.data.gpu_layers, null);
  assert.notStrictEqual(c.data.no_devices, false, 'silence is never read as "a device was found"');
});

t('offload evidence comes from the EXISTING telemetry parser, not a second one', function () {
  var health = read('bin/haddad-health.js');
  assert.ok(/require\('\.\/haddad-telemetry\.js'\)\.runtimeLoadFacts/.test(health),
    'health reuses runtimeLoadFacts rather than parsing the journal itself');
  // No GPU subsystem of its own: the assertion must not shell out to a probe.
  // Read the CODE, not the commentary: this file documents by name the probes
  // it deliberately does NOT run, and a comment saying so must not read as a
  // violation of the rule it is explaining.
  var block = health.slice(health.indexOf("check('ai_runtime'"), health.indexOf("check('worker'"));
  var code = block.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
  // Invocation, not mention: "journalctl --user -u ..." also appears inside a
  // FAIL message as the command the OPERATOR should run, which is a hint, not
  // a probe. Match the way this file actually starts a process — sh('<name>').
  ['nvidia-smi', 'gpu-vulkan-test', 'haddad-gpu-vram', 'vulkaninfo', 'journalctl', 'python3'].forEach(function (p) {
    assert.ok(code.indexOf("sh('" + p + "'") === -1,
      'ai_runtime must not run ' + p + ' — it reads what the runtime already logged');
  });
  // ...and the only processes it does start are the two it needs.
  var spawned = (code.match(/sh\('([a-z0-9_.-]+)'/g) || []).map(function (m) { return m.slice(4, -1); });
  spawned.forEach(function (c) {
    assert.ok(c === 'systemctl' || c === 'curl', 'ai_runtime starts only systemctl and curl, not ' + c);
  });
});

t('the telemetry parser distinguishes no-device from unknown (tri-state)', function () {
  var src = fs.readFileSync(path.join(BIN, 'haddad-telemetry.js'), 'utf8');
  assert.ok(/no_devices: null/.test(src), 'no_devices starts unknown, not false');
  assert.ok(/no devices with dedicated memory found/.test(src), 'the real second marker is matched too');
  assert.ok(/runtimeLoadFacts: runtimeLoadFacts/.test(src), 'exported for reuse');
});


t('a unit that asked for CPU is not failed for using CPU', function () {
  // --n-gpu-layers 0 is an operator saying "CPU on purpose". Failing that
  // host would be this check inventing a policy nobody set.
  var c = runAiRuntime({ active: 'active', active_for_s: 900, budget: '10min', code: 200, body: LOADED,
    journal: CPU_ONLY_BOOT, exec_start: '{ argv[]=/usr/bin/llama-server --n-gpu-layers 0 ; }' });
  assert.strictEqual(c.status, 'PASS', 'an explicit CPU-only unit passes on CPU');
  assert.strictEqual(c.data.gpu_intended, false);
  assert.ok(/CPU-only by configuration/.test(c.detail), c.detail);
});

t('only an EXPLICIT opt-out disarms the assertion — silence never does', function () {
  // The asymmetry that matters: a missing flag must NOT read as "CPU
  // intended", or this unit could lose its GPU assertion by losing a line.
  var noFlag = runAiRuntime({ active: 'active', active_for_s: 900, budget: '10min', code: 200, body: LOADED,
    journal: CPU_ONLY_BOOT, exec_start: '{ argv[]=/usr/bin/llama-server --ctx-size 8192 ; }' });
  assert.strictEqual(noFlag.status, 'FAIL', 'no --n-gpu-layers flag still asserts the GPU');
  assert.strictEqual(noFlag.data.gpu_intended, true);

  var unreadable = runAiRuntime({ active: 'active', active_for_s: 900, budget: '10min', code: 200, body: LOADED,
    journal: CPU_ONLY_BOOT, exec_start: null });
  assert.strictEqual(unreadable.status, 'FAIL', 'an unreadable ExecStart never softens a real regression');
  assert.strictEqual(unreadable.data.gpu_intended, true);

  // ...and a non-zero value obviously keeps it armed.
  var auto = runAiRuntime({ active: 'active', active_for_s: 900, budget: '10min', code: 200, body: LOADED,
    journal: CPU_ONLY_BOOT, exec_start: '{ argv[]=/usr/bin/llama-server --n-gpu-layers auto ; }' });
  assert.strictEqual(auto.status, 'FAIL', '--n-gpu-layers auto means the GPU is expected');
});

t('a CPU-only unit still has to actually answer', function () {
  // Opting out of the GPU does not opt out of the readiness contract.
  var c = runAiRuntime({ active: 'active', active_for_s: 900, budget: '10min', code: 503, body: LOADING,
    journal: CPU_ONLY_BOOT, exec_start: '{ argv[]=/usr/bin/llama-server --n-gpu-layers 0 ; }' });
  assert.strictEqual(c.status, 'FAIL', 'a stuck CPU-only runtime is still a failure');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
