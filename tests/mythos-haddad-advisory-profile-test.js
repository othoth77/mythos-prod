'use strict';
// =====================================================
// MYTHOS HADDAD — advisory-provider profile invariant
// tests/mythos-haddad-advisory-profile-test.js
//
// Guards the one change HAD-3 makes to the bridge's preflight: an executor
// task whose provider has NO execution authority legitimately carries
// execution_profile === null, and that is the EMPTY tool grant, not a
// missing one. Everything else must still be refused exactly as before.
//
// Deterministic and offline: preflight is exercised through the bridge's
// exported surface with a synthetic PROVIDERS map, so there is no GitHub,
// no executor store, no model and no network.
//
// The security properties under test, each with its negative case:
//   * an execution-authority provider is NEVER exempt (claude-code with a
//     null profile must still be refused — that is the case the original
//     guard exists for);
//   * an unknown provider is never exempt (fail closed);
//   * a non-null profile is always checked, advisory or not;
//   * a wrong profile on an execution provider is still a mismatch.
// =====================================================
var assert = require('assert');
var path = require('path');

var BRIDGE = path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'bridge', 'github-bridge.js');
var bridge = require(BRIDGE);
var pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); } }

// Stand-ins with only the field preflight is allowed to consult.
var ADVISORY = { executionAuthority: false };
var EXECUTION = { executionAuthority: true };
var executorStub = { PROVIDERS: { 'openai-compat': ADVISORY, 'free-llm-pool': ADVISORY, 'claude-code': EXECUTION, 'delegate': EXECUTION } };

function task(action) {
  return { task_id: 'gh-issue-1', requested_action: action, project: 'mythos-haddad', attempt: 1 };
}
function execTask(provider, profile) {
  return { task_id: 't-x', provider: provider, execution_profile: profile };
}
// preflight is module-internal; the bridge exposes it for exactly this kind
// of invariant test. If that ever stops being true this test fails loudly
// rather than silently testing nothing.
var preflight = bridge.preflight;

t('preflight is reachable for testing', function () {
  assert.strictEqual(typeof preflight, 'function', 'bridge must export preflight for invariant testing');
});

t('advisory provider + null profile is ACCEPTED (the empty tool grant)', function () {
  ['openai-compat', 'free-llm-pool'].forEach(function (p) {
    ['investigate', 'review', 'test'].forEach(function (action) {
      var block = preflight({}, task(action), execTask(p, null), executorStub);
      assert.strictEqual(block, null, p + ' + ' + action + ' must not be blocked, got ' + JSON.stringify(block && block.code));
    });
  });
});

t('EXECUTION-authority provider + null profile is still REFUSED', function () {
  ['claude-code', 'delegate'].forEach(function (p) {
    var block = preflight({}, task('investigate'), execTask(p, null), executorStub);
    assert.ok(block, p + ' with a null profile must still be blocked — this is the case the guard exists for');
    assert.strictEqual(block.code, 'ACTION_PROFILE_MISMATCH');
  });
});

t('UNKNOWN provider is never exempt (fail closed)', function () {
  var block = preflight({}, task('investigate'), execTask('something-new', null), executorStub);
  assert.ok(block, 'an unrecognised provider must not be exempted');
  assert.strictEqual(block.code, 'ACTION_PROFILE_MISMATCH');
});

t('a NON-NULL profile is always checked, advisory or not', function () {
  // Advisory provider carrying a write profile: not the exempt shape, so the
  // normal check runs and refuses it against a read-only action.
  var block = preflight({}, task('investigate'), execTask('openai-compat', 'repo-write'), executorStub);
  assert.ok(block, 'a non-null profile must go through the normal check');
  assert.strictEqual(block.code, 'ACTION_PROFILE_MISMATCH');
});

t('a wrong profile on an execution provider is still a mismatch', function () {
  var block = preflight({}, task('investigate'), execTask('claude-code', 'repo-write'), executorStub);
  assert.ok(block);
  assert.strictEqual(block.code, 'ACTION_PROFILE_MISMATCH');
  var ok = preflight({}, task('investigate'), execTask('claude-code', 'repo-read'), executorStub);
  assert.strictEqual(ok, null, 'the matching profile must still pass');
});

t('a first claim (no executor task yet) is unchanged', function () {
  assert.strictEqual(preflight({}, task('investigate'), null, executorStub), null);
  assert.strictEqual(preflight({}, task('implement'), null, executorStub), null);
});

t('missing executor argument cannot exempt anything (fail closed)', function () {
  var block = preflight({}, task('investigate'), execTask('openai-compat', null), undefined);
  assert.ok(block, 'without the PROVIDERS map there is nothing to verify against — must refuse');
  assert.strictEqual(block.code, 'ACTION_PROFILE_MISMATCH');
});

t('the exemption is not reachable from the task file alone', function () {
  // A task file claiming an advisory provider the executor does not have
  // must not be believed: the lookup is against the real PROVIDERS map.
  var block = preflight({}, task('investigate'), execTask('openai-compat', null), { PROVIDERS: {} });
  assert.ok(block, 'an empty PROVIDERS map must exempt nothing');
  assert.strictEqual(block.code, 'ACTION_PROFILE_MISMATCH');
});

// ---------------------------------------------------------------------
// The SAME invariant, in the executor's own gate. There are two guards, not
// one: the bridge refuses an attempt before claiming it, and the executor
// refuses it again before spawning a provider. The executor's is the one
// that actually blocked the first live run, so it gets the same negative
// cases rather than being taken on trust.
// ---------------------------------------------------------------------
var executor = require(path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'executor.js'));
function exPre(provider, profile, category) {
  return executor.preflightBlocker({ task_id: 't-x', task_category: category, provider: provider, execution_profile: profile });
}

t('executor gate: advisory + null is ACCEPTED for every read-only action', function () {
  ['investigate', 'review', 'test'].forEach(function (a) {
    assert.strictEqual(exPre('openai-compat', null, a), null, a + ' must pass the executor gate');
  });
});

t('executor gate: execution-authority provider + null is still REFUSED', function () {
  ['claude-code', 'delegate'].forEach(function (p) {
    var b = exPre(p, null, 'investigate');
    assert.ok(b, p + ' with a null profile must still be refused');
    assert.strictEqual(b.code, 'ACTION_PROFILE_MISMATCH');
  });
});

t('executor gate: unknown provider is never exempt', function () {
  var b = exPre('not-a-provider', null, 'investigate');
  assert.ok(b);
  assert.strictEqual(b.code, 'ACTION_PROFILE_MISMATCH');
});

t('executor gate: a non-null profile is always checked', function () {
  var b = exPre('openai-compat', 'repo-write', 'investigate');
  assert.ok(b, 'an advisory provider carrying a write profile must not be exempted');
  assert.strictEqual(b.code, 'ACTION_PROFILE_MISMATCH');
});

t('executor gate: the correct profile on an execution provider still passes', function () {
  assert.strictEqual(exPre('claude-code', 'repo-read', 'investigate'), null);
  var b = exPre('claude-code', 'repo-read', 'implement');
  assert.ok(b, 'implement needs repo-write, so repo-read must still be a mismatch');
  assert.strictEqual(b.code, 'ACTION_PROFILE_MISMATCH');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
