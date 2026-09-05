'use strict';

// Regression coverage for the Governance redaction false-positive boundary.
// No real credentials are used in this fixture.

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

console.log('redact-governance-false-positive-test: PASS');
