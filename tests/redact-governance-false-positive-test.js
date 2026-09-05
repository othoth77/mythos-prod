'use strict';

// Regression coverage for Governance redaction assignment false positives.
// Fixtures contain no real credentials.

var assert = require('assert');
var redact = require('../projects/mythos-orchestrator/lib/redact');

function has(kind, text) {
  return redact.findSecretKinds(text).indexOf(kind) !== -1;
}

[
  'TOKEN: configured',
  'SECRET: fixed',
  'API_KEY: not required',
  'TELEGRAM_TOKEN: configured',
  'Production impact: none',
  'Secrets: safe/redacted',
  'Redaction false positive: fixed/not fixed'
].forEach(function (text) {
  assert.strictEqual(has('assigned-secret', text), false, 'false positive: ' + text);
});

[
  'PASSWORD=Abcdefgh12345678',
  'TELEGRAM_TOKEN=AbCdEfGhIjKlMnOpQrStUvWx',
  'API_KEY=AbCdEfGhIjKlMnOpQrStUvWx012345',
  'ACCESS_KEY=AbCdEfGhIjKlMnOpQrStUvWx012345'
].forEach(function (text) {
  assert.strictEqual(has('assigned-secret', text), true, 'must detect: ' + text.split('=')[0]);
});

assert.strictEqual(redact.redact('TOKEN: configured'), 'TOKEN: configured');
assert.ok(redact.redact('TOKEN=AbCdEfGhIjKlMnOpQrStUvWx').indexOf('[REDACTED]') !== -1);

console.log('redact-governance-false-positive-test: PASS');
