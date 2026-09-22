'use strict';
// =====================================================
// Executor classifier: a dropped connection is transient
// tests/mythos-executor-transient-hangup-test.js
//
// Node reports a connection the peer closed mid-request as "socket hang
// up". Measured on Haddad (gh-issue-379-r4): the local runtime aborted
// (Vulkan DeviceLost) and systemd had it back in 10 s, but the executor
// classified the string as permanent and never retried. It belongs with
// ECONNRESET, which is already transient; the retry stays bounded by the
// existing max_retries + backoff. Shared classification — VPS included,
// deliberately: a dropped connection is transient everywhere.
// =====================================================
var assert = require('assert');
var path = require('path');
var quota = require(path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'lib', 'quota.js'));
var pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.message)); } }

t('"socket hang up" is transient and retryable', function () {
  var d = quota.classifyOutcome('HADDAD_AGENT_RUNTIME: FREE_LLM_NETWORK: socket hang up', {});
  assert.strictEqual(d.category, 'transient'); assert.strictEqual(d.retryable, true);
  assert.strictEqual(quota.classifyOutcome('Error: socket hang up', {}).category, 'transient');
});
t('it sits with the other dropped-connection shapes, unchanged', function () {
  ['ECONNRESET', 'connection reset', 'fetch failed'].forEach(function (s) {
    assert.strictEqual(quota.classifyOutcome(s, {}).category, 'transient', s);
  });
});
t('nothing else moved: quota, governance, permission, billing and plain failures classify as before', function () {
  assert.strictEqual(quota.classifyOutcome('usage limit reached', {}).category, 'quota');
  assert.strictEqual(quota.classifyOutcome('GOVERNANCE_DENIED: x', {}).category, 'governance');
  assert.strictEqual(quota.classifyOutcome('permission denied', {}).category, 'permission');
  assert.strictEqual(quota.classifyOutcome('credit balance is too low', {}).category, 'human');
  assert.strictEqual(quota.classifyOutcome('validation failed after 3 attempt(s)', {}).category, 'permanent');
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
