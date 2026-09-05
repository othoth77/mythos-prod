'use strict';
// =====================================================
// MYTHOS — Governance redaction: assignment classifier
// tests/redact-governance-false-positive-test.js
//
// The KEY=VALUE ("assigned-secret") pattern is the one place where the
// VALUE decides. Contract under test:
//   * an EXPLICIT placeholder syntax is not a secret  (<X>, ${X}, {{X}}, [X], ***, empty)
//   * everything else after a secret-looking key IS  (there is no safe-word list:
//     `TOKEN: configured` is flagged exactly like `TOKEN: hunter2`)
//   * findSecretKinds / findSecretMatches / redact / redactValue agree with each other
//   * the scan terminates (the 2026-09-05 origin/main version looped forever on
//     the first accepted assignment)
// Fixtures contain no real credentials.
// =====================================================

var assert = require('assert');
var redact = require('../projects/mythos-orchestrator/lib/redact');

var passed = 0;
function check(cond, name) { assert.ok(cond, name); passed++; }
function kinds(text) { return redact.findSecretKinds(text); }
function flagged(text) { return kinds(text).indexOf('assigned-secret') !== -1; }

// --- 1. explicit placeholders are accepted and left untouched ---------------------------
var SAFE = [
  'TOKEN=<EXAMPLE_TOKEN>',
  'API_KEY=<EXAMPLE_VALUE>',
  'PASSWORD=<REDACTED_VALUE>',
  'SECRET=<PLACEHOLDER>',
  'TELEGRAM_TOKEN: <token from @BotFather>',
  'API_KEY="<your key>"',
  'PASSWORD=${DB_PASSWORD}',
  'export MCC_DB_PASSWORD=$MCC_DB_PASSWORD',
  'TOKEN={{ vault.token }}',
  'API_KEY=%API_KEY%',
  'PASSWORD=[REDACTED]',
  'ACCESS_KEY=[MASKED]',
  'TOKEN=***',
  'TOKEN=xxxxxxxx',
  'API_KEY=',
  'API_KEY=""',
  'Secrets: <none>',
  '🔐 Secrets: <none exposed>'
];
SAFE.forEach(function (text) {
  check(!flagged(text), 'placeholder accepted: ' + text);
  check(redact.redact(text) === text, 'placeholder left untouched by redact(): ' + text);
});

// --- 2. no safe-word list: prose after a secret key stays flagged ---------------------------
// These were "safe" under the reverted allowlist (PR #184). A word that passes
// is a password that passes, so they are credential material by design; docs
// and status lines write `<none>` / `<configured>` instead.
var PROSE = [
  'TOKEN: configured',
  'SECRET: fixed',
  'API_KEY: not required',
  'TELEGRAM_TOKEN: configured',
  'Secrets: safe/redacted',
  '🔐 Secrets: safe/redacted',
  'PASSWORD=none',
  'password: sunshine'
];
PROSE.forEach(function (text) {
  check(flagged(text), 'prose value stays flagged (no allowlist): ' + text);
  check(redact.redact(text).indexOf(redact.MASK) !== -1, 'prose value masked by redact(): ' + text);
});

// --- 3. real-looking credential material is rejected in every wrapper ----------------------
var UNSAFE = [
  'PASSWORD=Abcdefgh12345678',
  'TELEGRAM_TOKEN=AbCdEfGhIjKlMnOpQrStUvWx',
  'API_KEY=AbCdEfGhIjKlMnOpQrStUvWx012345',
  'ACCESS_KEY=AbCdEfGhIjKlMnOpQrStUvWx012345',
  'TOKEN="AbCdEfGhIjKlMnOp"',
  "TOKEN='AbCdEfGhIjKlMnOp'",
  'PASSWORD=hunter2',
  'TOKEN=$2b$10$abcdefghijklmnopqrstuv',
  // a placeholder wrapper around pasted material is not a placeholder
  'TOKEN=<AbCdEf0123456789XyZwQq>',
  'TOKEN=[AbCdEf0123456789XyZwQq]',
  'API_KEY=<sk-ant-abcdefghijklmnopqrstu12345>',
  // key: value inside markdown
  '- `TOKEN: AbCdEfGhIjKlMnOp`'
];
UNSAFE.forEach(function (text) {
  check(kinds(text).length > 0, 'credential rejected: ' + text.split(/[:=]/)[0]);
  var out = redact.redact(text);
  check(out.indexOf(redact.MASK) !== -1 && !/AbCdEf|hunter2|abcdefghijklmnop/.test(out), 'credential masked: ' + text.split(/[:=]/)[0]);
});

// --- 4. provider patterns are independent of the assignment classifier --------------------
check(kinds('PRIVATE_KEY=<EXAMPLE>\n-----BEGIN PRIVATE KEY-----\nMIIfixture\n-----END PRIVATE KEY-----').indexOf('private-key-block') !== -1, 'private key block detected next to a placeholder');
check(kinds('token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345').indexOf('github-token') !== -1, 'github token detected in an assignment');
check(kinds('DATABASE_URL=<postgres url>').length === 0 && kinds('DATABASE_URL=postgres://u:p4ssw0rd@db.internal/x').indexOf('db-url') !== -1, 'db url: placeholder vs real');

// --- 5. consistency: findSecretKinds ⇄ redact ⇄ redactValue -----------------------------------
SAFE.concat(PROSE, UNSAFE).forEach(function (text) {
  var once = redact.redact(text);
  check(redact.findSecretKinds(once).length === 0, 'redact() output is clean for findSecretKinds(): ' + text.slice(0, 30));
  check(redact.redact(once) === once, 'redact() is idempotent: ' + text.slice(0, 30));
  var deep = redact.redactValue({ a: [text, { b: text }] });
  check(deep.a[0] === once && deep.a[1].b === once, 'redactValue() agrees with redact(): ' + text.slice(0, 30));
});
check(!flagged('KEY_TOKEN=' + redact.MASK), 'the MASK round-trips as a placeholder (no re-flagging of redacted output)');

// --- 6. matches name the key and line, never the value ------------------------------------
var doc = 'TASK: fixture\nObjective: x\nTOKEN=<EXAMPLE_TOKEN>\nAPI_KEY=AbCdEfGhIjKlMnOp\n🔐 Secrets: safe/redacted\n';
var m = redact.findSecretMatches(doc);
check(m.length === 2 && m[0].kind === 'assigned-secret' && m[0].key === 'API_KEY' && m[0].line === 4, 'match reports kind/key/line of the credential');
check(m[1].key === 'Secrets' && m[1].line === 5, 'match reports the prose false positive by key and line');
check(JSON.stringify(m).indexOf('AbCdEf') === -1, 'match never carries the value');

// --- 7. termination: the 2026-09-05 regression looped forever on an accepted assignment ----
var big = new Array(2000).join('TOKEN=<EXAMPLE_TOKEN>\nPASSWORD: configured\n');
var t0 = Date.now();
redact.findSecretKinds(big);
redact.redact(big);
check(Date.now() - t0 < 2000, 'scan of 4000 assignments terminates quickly');
check(redact.findSecretKinds('').length === 0 && redact.findSecretKinds(null).length === 0 && redact.redact(null) === null, 'non-strings and empty input pass through');

console.log('redact-governance-false-positive-test: PASS (' + passed + ' checks)');
