'use strict';
// =====================================================
// MYTHOS HADDAD — FABLE local-worker invariants
// tests/mythos-haddad-fable-worker-test.js
//
// Offline, like every other suite here: the HTTP transport is injected, so
// no GPU, no model and no running llama-server is required. The live path
// is covered by haddad-health.js's ai_runtime check and recorded in
// docs/FABLE_WORKER.md.
//
// What must hold:
//   * the client reuses the executor's existing adapter and success oracle
//     rather than restating either;
//   * a rejection's findings actually reach the worker's prompt, in the
//     executor's own repair format (a blind retry converges only by luck —
//     core/orchestrator.js:122 records that being found live);
//   * the worker never reviews itself and never retries itself;
//   * failures are fail-closed, named, and never carry the API key;
//   * nothing under mythos-ai-executor/ is modified by this integration.
// =====================================================
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var DIR = path.join(__dirname, '..', 'projects', 'mythos-haddad');
var runtime = require(path.join(DIR, 'lib', 'haddad-runtime.js'));
var pass = 0, fail = 0, skipped = 0;
// Async-aware runner: several bodies return a Promise, and a plain
// try/catch would return before such a body settled — silently turning a
// failed assertion into a pass. Each test is queued and awaited in order.
var queue = [];
function t(name, fn) {
  queue.push(function () {
    return Promise.resolve().then(fn).then(
      function () { pass++; console.log('ok - ' + name); },
      function (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); }
    );
  });
}
function read(rel) { return fs.readFileSync(path.join(DIR, rel), 'utf8'); }

// A transport in the shape adapter.js expects: (options, body) -> Promise<{status, body}>.
function fakeTransport(capture, reply) {
  return function (options, body) {
    capture.options = options;
    capture.body = JSON.parse(body);
    return Promise.resolve(reply || {
      status: 200,
      body: JSON.stringify({
        model: 'qwen-test',
        choices: [{ message: { content: 'WORKER ANSWER' } }],
        usage: { total_tokens: 7 }
      })
    });
  };
}
function runWith(req, capture, reply) {
  return runtime.runTask(req, {
    apiKey: 'test-key-not-real', model: 'qwen-test',
    baseUrl: 'http://127.0.0.1:8600/v1', transport: fakeTransport(capture, reply)
  });
}

t('reuses the executor free-llm adapter rather than a second HTTP client', function () {
  var src = read('lib/haddad-runtime.js');
  assert.ok(/require\(['"]\.\.\/\.\.\/mythos-ai-executor\/free-llm\/adapter\.js['"]\)/.test(src),
    'requires the existing adapter');
  assert.ok(!/https?\.request\([^)]*chat\/completions/.test(src),
    'does not hand-roll a second chat-completions client');
});

t('success oracle is the executor\'s four conditions, not a looser restatement', function () {
  assert.strictEqual(runtime.ok({ parsed: { is_error: false }, timed_out: false, exit_code: 0 }), true);
  assert.strictEqual(runtime.ok({ parsed: { is_error: true }, timed_out: false, exit_code: 0 }), false, 'is_error must fail');
  assert.strictEqual(runtime.ok({ parsed: { is_error: false }, timed_out: true, exit_code: 0 }), false, 'timeout must fail');
  assert.strictEqual(runtime.ok({ parsed: { is_error: false }, timed_out: false, exit_code: 1 }), false, 'nonzero exit must fail');
  assert.strictEqual(runtime.ok({ timed_out: false, exit_code: 0 }), false, 'missing parsed must fail');
});

t('a rejection\'s findings reach the prompt in the executor repair format', function () {
  var p = runtime.buildPrompt({ instruction: 'Do X.', attempt: 3, findings: ['alpha', 'beta'] });
  assert.ok(p.indexOf('## REPAIR REQUIRED (attempt 3)') !== -1, 'carries the executor repair header + attempt number');
  assert.ok(p.indexOf('- alpha') !== -1 && p.indexOf('- beta') !== -1, 'every finding is listed');
  assert.ok(p.indexOf('Do X.') !== -1, 'the original instruction survives the repair');
  // Mutation guard: no findings must mean no repair block at all.
  assert.strictEqual(runtime.renderRepairNotes([], 2), null);
  assert.strictEqual(runtime.renderRepairNotes(undefined, 2), null);
});

t('acceptance criteria are passed to the worker, not silently dropped', function () {
  var p = runtime.buildPrompt({ instruction: 'Do X.', acceptance_criteria: ['must be short'] });
  assert.ok(p.indexOf('ACCEPTANCE CRITERIA') !== -1 && p.indexOf('- must be short') !== -1);
});

t('findings actually travel over the wire on a correction attempt', function () {
  var cap = {};
  return runWith({ instruction: 'Do X.', attempt: 2, findings: ['too long'] }, cap).then(function (res) {
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.attempt, 2, 'attempt number is reported back to FABLE');
    var sent = JSON.stringify(cap.body);
    assert.ok(sent.indexOf('REPAIR REQUIRED') !== -1, 'repair block reached the request body');
    assert.ok(sent.indexOf('too long') !== -1, 'the finding itself reached the request body');
  });
});

t('the worker is told it cannot act — no execution authority in its instructions', function () {
  assert.ok(/cannot/i.test(runtime.DEFAULT_SYSTEM), 'system prompt denies capability to act');
  assert.ok(/not claim to have run|do not claim/i.test(runtime.DEFAULT_SYSTEM),
    'worker is told not to claim it ran or edited anything');
});

t('the worker never reviews itself and never retries itself', function () {
  var lib = read('lib/haddad-runtime.js');
  var cli = read('bin/haddad-task.js');
  [['lib/haddad-runtime.js', lib], ['bin/haddad-task.js', cli]].forEach(function (pair) {
    assert.ok(!/\bsetTimeout\([^)]*retry|\bfor\s*\([^)]*attempt|while\s*\([^)]*attempt/i.test(pair[1]),
      pair[0] + ' contains no retry loop — retrying is FABLE\'s decision');
    assert.ok(!/verdict\s*[:=]\s*['"](pass|reject)['"]/.test(pair[1]),
      pair[0] + ' never emits a review verdict about its own output');
  });
});

t('failures are fail-closed, named, and never carry the key', function () {
  var cases = [
    [{ instruction: '' }, 'BAD_REQUEST'],
    [{ instruction: 'x', attempt: 0 }, 'BAD_REQUEST'],
    [{ instruction: 'x', findings: 'not-an-array' }, 'BAD_REQUEST']
  ];
  return Promise.all(cases.map(function (c) {
    return runtime.runTask(c[0], { apiKey: 'k', model: 'm', transport: fakeTransport({}) })
      .then(function (r) {
        assert.strictEqual(r.ok, false, JSON.stringify(c[0]) + ' must fail');
        assert.strictEqual(r.reason, c[1]);
      });
  })).then(function () {
    return runtime.runTask({ instruction: 'x' }, { keyFile: '/nonexistent-key-file', model: 'm' });
  }).then(function (r) {
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'RUNTIME_UNCONFIGURED', 'absent key is unconfigured, never invented');
  });
});

t('an upstream error surfaces as ok:false without leaking the key', function () {
  var cap = {};
  var secret = 'super-secret-key-value';
  return runtime.runTask({ instruction: 'Do X.' }, {
    apiKey: secret, model: 'qwen-test', transport: fakeTransport(cap, { status: 500, body: 'upstream exploded' })
  }).then(function (res) {
    assert.strictEqual(res.ok, false);
    assert.ok(res.reason === 'RUNTIME_ERROR' || res.reason === 'TIMEOUT', 'named failure, got ' + res.reason);
    assert.ok(JSON.stringify(res).indexOf(secret) === -1, 'the key never appears in the result');
  });
});

t('the CLI writes one JSON line and uses the documented exit codes', function () {
  var cli = path.join(DIR, 'bin', 'haddad-task.js');
  var bad = cp.spawnSync(process.execPath, [cli], { input: 'not json', encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(bad.status, 2, 'bad input exits 2');
  var parsed = JSON.parse(bad.stdout.trim());
  assert.strictEqual(parsed.ok, false);
  assert.strictEqual(bad.stdout.trim().split('\n').length, 1, 'exactly one JSON line on stdout');

  var unconfigured = cp.spawnSync(process.execPath, [cli], {
    input: JSON.stringify({ instruction: 'hi' }), encoding: 'utf8', timeout: 30000,
    env: Object.assign({}, process.env, { HADDAD_RUNTIME_KEY_FILE: '/nonexistent-key-file' })
  });
  assert.strictEqual(unconfigured.status, 0, 'a JSON answer (ok:false) still exits 0');
  assert.strictEqual(JSON.parse(unconfigured.stdout.trim()).reason, 'RUNTIME_UNCONFIGURED');
});

// SCOPE GUARD. This asserts that a HADDAD stage reuses the executor rather
// than editing it — so it must first establish that the branch it is
// reading IS a Haddad stage. A branch that changes nothing under
// projects/mythos-haddad/ is not one, and judging its executor changes here
// makes this file veto unrelated core work. It did: a core branch that
// changed core/validation.js and no Haddad file at all failed this check.
// Scoped to Haddad branches, the guard refuses exactly what it always did.
//
// HAD-2b itself modifies nothing here, and that still holds. HAD-3 later
// changes exactly three files under the executor tree, each with owner
// approval and its own coverage in tests/mythos-haddad-advisory-profile-test.js:
// the two preflight gates that reconcile "an advisory provider carries no
// execution profile" with "every action must carry its profile", plus one
// additive project registration. Naming them keeps this guard meaningful —
// any OTHER file under the executor tree still fails it.
var HAD3_ALLOWED = [
  'projects/mythos-ai-executor/bridge/github-bridge.js',
  'projects/mythos-ai-executor/executor.js',
  'projects/mythos-ai-executor/config/projects.json'
];
// HAD-4 (local tool runner + supervised execution, PR #365) is the stage
// that gives the executor a Haddad-side provider, so its surface under the
// executor tree is larger and equally named: the provider itself, the
// mechanical validation it calls, the profile grant it reads, the adapter's
// tool-call plumbing and the one schema field. Covered by
// tests/mythos-haddad-tool-runner-test.js and
// tests/mythos-haddad-supervised-loop-test.js. Anything else still fails.
// bridge/action-resolution.js is allow-listed for ONE reason: it is the only
// place blocker codes are declared, and the merge audit gave the executor a
// new one to raise (DELIVERY_FAILED — validated work git refused, distinct
// from PROVIDER_FAILED because the provider did its part). A code that is
// raised but not declared there is precisely the drift that registry exists
// to prevent: the next person adding to NON_RETRYABLE would never see it.
// Leaving it undeclared to keep this list short would have been hiding the
// change from the guard rather than making it.
//
// So the entry is deliberately NOT a general licence over that file — the
// test below pins the diff to registry entries and comments, and anything
// else in it fails exactly as before.
var HAD4_ALLOWED = [
  'projects/mythos-ai-executor/providers/haddad-agent.js',
  'projects/mythos-ai-executor/lib/work-validation.js',
  'projects/mythos-ai-executor/lib/policy.js',
  'projects/mythos-ai-executor/free-llm/adapter.js',
  'projects/mythos-ai-executor/schemas/task.schema.json',
  'projects/mythos-ai-executor/bridge/action-resolution.js'
];
var REGISTRY_ONLY = 'projects/mythos-ai-executor/bridge/action-resolution.js';

function touchesHaddad(files) {
  return files.some(function (f) { return /^projects\/mythos-haddad\//.test(f); });
}

function executorFilesModified(files) {
  if (!touchesHaddad(files)) return [];   // not a Haddad stage — not this guard's business
  return files.filter(function (f) {
    return HAD3_ALLOWED.indexOf(f) === -1 && HAD4_ALLOWED.indexOf(f) === -1 && /^projects\/mythos-ai-executor\//.test(f);
  });
}

t('this integration modifies nothing under mythos-ai-executor/', function () {
  var repoRoot = path.join(__dirname, '..');
  var diff = cp.spawnSync('git', ['diff', '--name-only', 'origin/main...HEAD'], { cwd: repoRoot, encoding: 'utf8', timeout: 30000 });
  if (diff.status !== 0 || !diff.stdout.trim()) return; // no origin/main to compare against — skip
  var modified = executorFilesModified(diff.stdout.trim().split('\n'));
  assert.strictEqual(modified.join(', '), '',
    'executor is reused, never modified: ' + modified.join(', '));

  // The narrow half of the allow-list above: action-resolution.js may gain
  // blocker-code declarations and comments, nothing else. Measured from the
  // real diff, so the entry cannot quietly grow into permission to edit the
  // action grammar, the profile mapping or the snapshot rules.
  var reg = cp.spawnSync('git', ['diff', '--unified=0', 'origin/main...HEAD', '--', REGISTRY_ONLY],
    { cwd: repoRoot, encoding: 'utf8', timeout: 30000 });
  if (reg.status !== 0) return;
  var regLines = reg.stdout.split('\n').filter(function (l) {
    return /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l) && l.slice(1).trim();
  });
  // Codes ADDED by this diff, so a removal can be recognised as the comma
  // reflow of the entry that used to be last rather than a deletion.
  var added = {};
  regLines.forEach(function (l) {
    var m = /^\+\s*([A-Z_]+): '[A-Z_]+',?$/.exec(l);
    if (m) added[m[1]] = true;
  });
  var offending = regLines.filter(function (l) {
    var body = l.slice(1).trim();
    if (body.indexOf('//') === 0) return false;                       // a comment
    var m = /^([A-Z_]+): '[A-Z_]+',?$/.exec(body);
    if (!m) return true;                                              // anything else at all
    if (l[0] === '+') return false;                                   // a new code
    return !added[m[1]];    // a removal is only OK as the reflow of a re-added line
  });
  assert.strictEqual(offending.join(' | '), '',
    'action-resolution.js is allow-listed for blocker-code declarations ONLY; this diff changes more: ' + offending.join(' | '));
});

t('the scope guard is scoped to Haddad branches and still bites', function () {
  assert.deepStrictEqual(
    executorFilesModified(['projects/mythos-ai-executor/core/validation.js', 'docs/AI_HANDOVER.md']), [],
    'a branch that touches no Haddad file is not judged by this guard');
  assert.deepStrictEqual(
    executorFilesModified(['projects/mythos-haddad/lib/haddad-runtime.js']), [],
    'a Haddad branch that stays inside its own tree passes');
  assert.deepStrictEqual(
    executorFilesModified(['projects/mythos-haddad/lib/haddad-runtime.js',
      'projects/mythos-ai-executor/core/validation.js']),
    ['projects/mythos-ai-executor/core/validation.js'],
    'a Haddad branch that edits the executor outside the named surfaces still FAILS');
  assert.deepStrictEqual(
    executorFilesModified(['projects/mythos-haddad/bin/x.sh'].concat(HAD4_ALLOWED)), [],
    'the six HAD-4 files stay allow-listed');
  assert.deepStrictEqual(
    executorFilesModified(['projects/mythos-haddad/bin/x.sh', 'projects/mythos-ai-executor/bridge/review-gate.js']),
    ['projects/mythos-ai-executor/bridge/review-gate.js'],
    'allow-listing one bridge file did not open bridge/ as a whole');
  assert.deepStrictEqual(
    executorFilesModified(['projects/mythos-haddad/systemd/x.service'].concat(HAD3_ALLOWED)), [],
    'the three owner-approved HAD-3 files stay allow-listed');
});

// ---------------------------------------------------------------------
// LIVE section. Everything above is offline with an injected transport,
// which proves the wiring but cannot prove that Haddad actually executes a
// task. These hit the real loopback runtime when it is up, and SKIP loudly
// (never silently pass) when it is not, so the suite stays runnable on a
// host with no GPU or no model while still being a real end-to-end check
// on `haddad` itself.
// ---------------------------------------------------------------------
function liveAvailable() {
  return runtime.runTask({ instruction: 'ping', timeout_ms: 8000 }, {})
    .then(function (r) { return r.ok || (r.reason !== 'RUNTIME_UNAVAILABLE' && r.reason !== 'RUNTIME_UNCONFIGURED'); })
    .catch(function () { return false; });
}

function live(name, fn) {
  queue.push(function () {
    return liveAvailable().then(function (up) {
      if (!up) { skipped++; console.log('SKIP - ' + name + ' (local runtime not available on this host)'); return; }
      return Promise.resolve().then(fn).then(
        function () { pass++; console.log('ok - ' + name + ' [LIVE]'); },
        function (e) { fail++; console.log('not ok - ' + name + ' [LIVE]\n  ' + (e && e.message)); }
      );
    });
  });
}

live('LIVE: Haddad really executes a task through the OpenAI-compatible endpoint', function () {
  return runtime.runTask({
    instruction: 'Reply with exactly this token and nothing else: HADDAD-LIVE-OK',
    timeout_ms: 120000
  }, {}).then(function (res) {
    assert.strictEqual(res.ok, true, 'live task failed: ' + res.reason + ' ' + (res.detail || ''));
    assert.ok(typeof res.text === 'string' && res.text.length, 'a real answer came back');
    assert.ok(res.text.indexOf('HADDAD-LIVE-OK') !== -1, 'the model followed the instruction, got: ' + JSON.stringify(res.text.slice(0, 120)));
    assert.ok(res.model && /qwen/i.test(res.model), 'served by the pinned Qwen model, got: ' + res.model);
    assert.ok(res.usage && res.usage.total_tokens > 0, 'real token usage reported');
    assert.ok(res.duration_ms > 0, 'real elapsed time');
  });
});

// Behavioural evidence that the loop works end to end on a real model —
// NOT the deterministic guarantee. That belongs to the offline test above
// ("findings actually travel over the wire"), which inspects the request
// body and fails if the repair block is ever dropped. This one can only
// observe what the model did with it; measured 83->8, 93->10, 101->8 words
// across three runs, so the margin is wide rather than marginal.
live('LIVE: a correction round actually changes the worker output', function () {
  var task = { instruction: 'Describe what a CPU is.', timeout_ms: 120000 };
  return runtime.runTask(task, {}).then(function (first) {
    assert.strictEqual(first.ok, true, 'attempt 1 failed: ' + first.reason);
    var firstWords = first.text.trim().split(/\s+/).length;
    // FABLE reviews and rejects: too long. Re-send with findings.
    return runtime.runTask({
      instruction: task.instruction, timeout_ms: 120000, attempt: 2,
      findings: ['Answer was too long; reply with a single sentence of at most 12 words', 'No bullet points, no headings']
    }, {}).then(function (second) {
      assert.strictEqual(second.ok, true, 'attempt 2 failed: ' + second.reason);
      assert.strictEqual(second.attempt, 2, 'attempt number round-trips');
      var secondWords = second.text.trim().split(/\s+/).length;
      assert.ok(secondWords < firstWords,
        'the correction must measurably shorten the answer (' + firstWords + ' -> ' + secondWords + ' words)');
    });
  });
});

live('LIVE: the real API key never reaches the result object', function () {
  var key = null;
  try { key = fs.readFileSync(runtime.DEFAULT_KEY_FILE, 'utf8').trim(); } catch (e) { /* covered by the skip */ }
  if (!key) { throw new Error('expected a readable key file for this live check'); }
  return runtime.runTask({ instruction: 'Say OK', timeout_ms: 60000 }, {}).then(function (res) {
    assert.ok(JSON.stringify(res).indexOf(key) === -1, 'the live key must never appear in a result');
  });
});

queue.reduce(function (chain, step) { return chain.then(step); }, Promise.resolve())
  .then(function () {
    console.log('\n' + pass + ' passed, ' + fail + ' failed' + (skipped ? ', ' + skipped + ' skipped (runtime not available)' : ''));
    process.exit(fail ? 1 : 0);
  });
