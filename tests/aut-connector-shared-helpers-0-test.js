'use strict';
// =====================================================
// MYTHOS — Stage AUT-CONNECTOR-SHARED-HELPERS-0 tests
// tests/aut-connector-shared-helpers-0-test.js
//
// Deterministic, offline. Verifies the shared read-only connector helper
// contract (projects/automation/reference/connector-readonly-helpers.js)
// and that both provider connectors genuinely delegate to it rather than
// carrying a second behavioral implementation. No live network call, no
// credential, no provider SDK anywhere in this suite.
//
// Run with: node tests/aut-connector-shared-helpers-0-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var SHARED_PATH = path.join(BASE, 'projects', 'automation', 'reference', 'connector-readonly-helpers.js');
var OVH_PATH = path.join(BASE, 'projects', 'automation', 'reference', 'ovh-readonly-connector.js');
var CF_PATH = path.join(BASE, 'projects', 'automation', 'reference', 'cloudflare-readonly-connector.js');

var shared = require(SHARED_PATH);
var ovh = require(OVH_PATH);
var cf = require(CF_PATH);

function mockReadOnlyClient() {
  return {
    listX: function () { return Promise.resolve([]); },
    getY: function () { return Promise.resolve({}); }
  };
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n1. SHARED HELPER MODULE EXISTS AND EXPORTS THE EXPECTED CONTRACT');
(function () {
  ok(fs.existsSync(SHARED_PATH), 'projects/automation/reference/connector-readonly-helpers.js exists');
  ok(typeof shared.assertReadOnlyClient === 'function', 'shared module exports assertReadOnlyClient');
  ok(typeof shared.buildSnapshotRecord === 'function', 'shared module exports buildSnapshotRecord');
  ok(shared.MUTATING_METHOD_PATTERN instanceof RegExp, 'shared module exports MUTATING_METHOD_PATTERN as a RegExp');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n2. BOTH CONNECTORS CONSUME THE SAME SHARED HELPER (not a second implementation)');
(function () {
  var ovhSrc = fs.readFileSync(OVH_PATH, 'utf8');
  var cfSrc = fs.readFileSync(CF_PATH, 'utf8');
  ok(ovhSrc.indexOf("require('./connector-readonly-helpers.js')") !== -1, 'ovh-readonly-connector.js requires the shared helper module');
  ok(cfSrc.indexOf("require('./connector-readonly-helpers.js')") !== -1, 'cloudflare-readonly-connector.js requires the shared helper module');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n3. EXACTLY ONE BEHAVIORAL assertReadOnlyClient IMPLEMENTATION ACROSS ACTIVE CONNECTOR REFERENCE CODE');
(function () {
  var ovhSrc = fs.readFileSync(OVH_PATH, 'utf8');
  var cfSrc = fs.readFileSync(CF_PATH, 'utf8');
  var sharedSrc = fs.readFileSync(SHARED_PATH, 'utf8');

  // The only place MUTATING_METHOD_PATTERN may be *defined* (assigned a
  // regex literal) is the shared module. Provider modules must not carry
  // their own copy of the pattern.
  var patternDefRe = /MUTATING_METHOD_PATTERN\s*=\s*\/\^/;
  ok(patternDefRe.test(sharedSrc), 'MUTATING_METHOD_PATTERN is defined in the shared module');
  ok(!patternDefRe.test(ovhSrc), 'MUTATING_METHOD_PATTERN is NOT redefined in ovh-readonly-connector.js');
  ok(!patternDefRe.test(cfSrc), 'MUTATING_METHOD_PATTERN is NOT redefined in cloudflare-readonly-connector.js');

  // Each provider's assertReadOnlyClient must be a thin delegator — its
  // function body must call sharedHelpers.assertReadOnlyClient rather than
  // repeating the Object.keys/.filter mutation-detection logic itself.
  var ovhFnMatch = ovhSrc.match(/function assertReadOnlyClient\(client\)\s*\{([\s\S]*?)\n\}/);
  var cfFnMatch = cfSrc.match(/function assertReadOnlyClient\(client\)\s*\{([\s\S]*?)\n\}/);
  ok(!!ovhFnMatch && ovhFnMatch[1].indexOf('sharedHelpers.assertReadOnlyClient') !== -1, 'OVH assertReadOnlyClient delegates to sharedHelpers.assertReadOnlyClient');
  ok(!!cfFnMatch && cfFnMatch[1].indexOf('sharedHelpers.assertReadOnlyClient') !== -1, 'Cloudflare assertReadOnlyClient delegates to sharedHelpers.assertReadOnlyClient');
  ok(!!ovhFnMatch && ovhFnMatch[1].indexOf('Object.keys(client).filter') === -1, 'OVH assertReadOnlyClient body does not re-implement the Object.keys/.filter mutation scan');
  ok(!!cfFnMatch && cfFnMatch[1].indexOf('Object.keys(client).filter') === -1, 'Cloudflare assertReadOnlyClient body does not re-implement the Object.keys/.filter mutation scan');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n4. EXACTLY ONE BEHAVIORAL buildSnapshotRecord IMPLEMENTATION');
(function () {
  var ovhSrc = fs.readFileSync(OVH_PATH, 'utf8');
  var cfSrc = fs.readFileSync(CF_PATH, 'utf8');
  var ovhFnMatch = ovhSrc.match(/function buildSnapshotRecord\(input\)\s*\{([\s\S]*?)\n\}/);
  var cfFnMatch = cfSrc.match(/function buildSnapshotRecord\(input\)\s*\{([\s\S]*?)\n\}/);
  ok(!!ovhFnMatch && ovhFnMatch[1].indexOf('sharedHelpers.buildSnapshotRecord') !== -1, 'OVH buildSnapshotRecord delegates to sharedHelpers.buildSnapshotRecord');
  ok(!!cfFnMatch && cfFnMatch[1].indexOf('sharedHelpers.buildSnapshotRecord') !== -1, 'Cloudflare buildSnapshotRecord delegates to sharedHelpers.buildSnapshotRecord');
  ok(!!ovhFnMatch && ovhFnMatch[1].indexOf('snapshot_id:') === -1, 'OVH buildSnapshotRecord body does not re-implement the snapshot object construction');
  ok(!!cfFnMatch && cfFnMatch[1].indexOf('snapshot_id:') === -1, 'Cloudflare buildSnapshotRecord body does not re-implement the snapshot object construction');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n5. OVH KEEPS COMPATIBLE PUBLIC EXPORTS');
(function () {
  var expected = ['assertReadOnlyClient', 'redactRegistrantFields', 'buildSnapshotRecord', 'collectForDomain', 'runReadOnlyCollection'];
  var allPresent = expected.every(function (k) { return typeof ovh[k] === 'function'; });
  ok(allPresent, 'ovh-readonly-connector.js still exports assertReadOnlyClient, redactRegistrantFields, buildSnapshotRecord, collectForDomain, runReadOnlyCollection as functions');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n6. CLOUDFLARE KEEPS COMPATIBLE PUBLIC EXPORTS');
(function () {
  var expected = ['assertReadOnlyClient', 'redactOwnerFields', 'buildSnapshotRecord', 'collectForZone', 'runReadOnlyCollection'];
  var allPresent = expected.every(function (k) { return typeof cf[k] === 'function'; });
  ok(allPresent, 'cloudflare-readonly-connector.js still exports assertReadOnlyClient, redactOwnerFields, buildSnapshotRecord, collectForZone, runReadOnlyCollection as functions');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n7. NULL/MISSING CLIENT FAILS (shared helper, both provider prefixes)');
(function () {
  var threwShared = false, threwOvh = false, threwCf = false;
  try { shared.assertReadOnlyClient(null); } catch (e) { threwShared = /a client object is required/.test(e.message); }
  try { ovh.assertReadOnlyClient(null); } catch (e) { threwOvh = /OVH_CONNECTOR: a client object is required/.test(e.message); }
  try { cf.assertReadOnlyClient(null); } catch (e) { threwCf = /CLOUDFLARE_CONNECTOR: a client object is required/.test(e.message); }
  ok(threwShared, 'shared.assertReadOnlyClient(null) rejects with a generic prefix by default');
  ok(threwOvh, 'ovh.assertReadOnlyClient(null) rejects with the OVH_CONNECTOR prefix (provider identity preserved)');
  ok(threwCf, 'cf.assertReadOnlyClient(null) rejects with the CLOUDFLARE_CONNECTOR prefix (provider identity preserved)');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n8. MUTATION-SHAPED METHOD FAILS (known verb)');
(function () {
  var client = mockReadOnlyClient();
  client.deleteZone = function () { return Promise.resolve(); };
  var threw = false;
  try { shared.assertReadOnlyClient(client, { errorPrefix: 'TEST' }); } catch (e) { threw = /read-only violation/.test(e.message); }
  ok(threw, 'A client exposing deleteZone is rejected by the shared helper');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n9. UNKNOWN FUTURE MUTATION-SHAPED METHOD MATCHING THE PATTERN ALSO FAILS');
(function () {
  // Not a name anyone hardcoded anywhere — proves detection is pattern-based,
  // never an allowlist that could silently miss a newly added method.
  var client = mockReadOnlyClient();
  client.mutateBillingProfileForTenant = function () { return Promise.resolve(); };
  var threw = false;
  try { shared.assertReadOnlyClient(client, { errorPrefix: 'TEST' }); } catch (e) { threw = /mutateBillingProfileForTenant/.test(e.message); }
  ok(threw, 'A never-before-seen mutation-shaped method name is still caught by the pattern, not an allowlist');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n10. READ-ONLY CLIENT PASSES');
(function () {
  var threw = false;
  try { shared.assertReadOnlyClient(mockReadOnlyClient(), { errorPrefix: 'TEST' }); } catch (e) { threw = true; }
  ok(!threw, 'A legitimate read-only client passes the shared helper');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n11. SNAPSHOT REQUIRED-FIELD VALIDATION WORKS');
(function () {
  var threwShared = false, threwOvh = false, threwCf = false;
  try { shared.buildSnapshotRecord({ snapshotId: 'x' }, { errorPrefix: 'TEST' }); } catch (e) { threwShared = /missing required field/.test(e.message); }
  try { ovh.buildSnapshotRecord({ snapshotId: 'x' }); } catch (e) { threwOvh = /OVH_CONNECTOR: buildSnapshotRecord missing required field/.test(e.message); }
  try { cf.buildSnapshotRecord({ snapshotId: 'x' }); } catch (e) { threwCf = /CLOUDFLARE_CONNECTOR: buildSnapshotRecord missing required field/.test(e.message); }
  ok(threwShared, 'shared.buildSnapshotRecord rejects a payload missing required fields');
  ok(threwOvh, 'ovh.buildSnapshotRecord rejects with the OVH_CONNECTOR prefix (provider identity preserved)');
  ok(threwCf, 'cf.buildSnapshotRecord rejects with the CLOUDFLARE_CONNECTOR prefix (provider identity preserved)');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n12. SNAPSHOT SHAPE IS UNCHANGED');
(function () {
  var input = {
    snapshotId: 'shared:test:2026-08-08T00:00:00Z',
    connectorId: 'test_connector',
    resourceType: 'test_resource',
    resourceExternalId: 'ext-1',
    resourceExternalSource: 'TestProvider',
    artifactReference: 'mem://test/1',
    observedAt: '2026-08-08T00:00:00Z'
  };
  var record = shared.buildSnapshotRecord(input, { errorPrefix: 'TEST' });
  var expectedKeys = ['snapshot_id', 'run_id', 'connector_id', 'resource_type', 'resource_external_id', 'resource_external_source', 'artifact_reference', 'is_redacted', 'observed_at'];
  ok(JSON.stringify(Object.keys(record).sort()) === JSON.stringify(expectedKeys.slice().sort()), 'Shared builder returns exactly the aut_snapshots column set, unchanged from the pre-refactor shape');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n13. is_redacted REMAINS TRUE');
(function () {
  var record = shared.buildSnapshotRecord({
    snapshotId: 's', connectorId: 'c', resourceType: 'r', resourceExternalId: 'e',
    resourceExternalSource: 'S', artifactReference: 'a', observedAt: 'o'
  }, { errorPrefix: 'TEST' });
  ok(record.is_redacted === true, 'is_redacted defaults to true from the shared builder');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n14. artifact_reference REMAINS REFERENCE-ONLY (no raw payload embedding)');
(function () {
  var record = shared.buildSnapshotRecord({
    snapshotId: 's', connectorId: 'c', resourceType: 'r', resourceExternalId: 'e',
    resourceExternalSource: 'S', artifactReference: 'mem://ref/1', observedAt: 'o'
  }, { errorPrefix: 'TEST' });
  var keys = Object.keys(record);
  ok(keys.indexOf('payload') === -1 && keys.indexOf('raw') === -1 && keys.indexOf('data') === -1, 'No raw-payload-shaped key exists on the returned snapshot record — only artifact_reference');
  ok(record.artifact_reference === 'mem://ref/1', 'artifact_reference is passed through verbatim as a reference string');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n15. PROVIDER-SPECIFIC REDACTORS REMAIN SEPARATE (not moved into the shared module)');
(function () {
  ok(typeof shared.redactRegistrantFields === 'undefined', 'The shared helper module does NOT export redactRegistrantFields — that stays OVH-specific');
  ok(typeof shared.redactOwnerFields === 'undefined', 'The shared helper module does NOT export redactOwnerFields — that stays Cloudflare-specific');
  ok(typeof ovh.redactRegistrantFields === 'function', 'ovh-readonly-connector.js still owns redactRegistrantFields');
  ok(typeof cf.redactOwnerFields === 'function', 'cloudflare-readonly-connector.js still owns redactOwnerFields');

  var ovhRedacted = ovh.redactRegistrantFields({ registrant_name: 'Jane', registrar: 'OVH' });
  var cfRedacted = cf.redactOwnerFields({ owner_email: 'a@b.com', plan: 'Free' });
  ok(ovhRedacted.registrant_name === 'REDACTED' && ovhRedacted.registrar === 'OVH', 'OVH redaction behaviour is unchanged post-refactor');
  ok(cfRedacted.owner_email === 'REDACTED' && cfRedacted.plan === 'Free', 'Cloudflare redaction behaviour is unchanged post-refactor');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n16. NO LIVE-NETWORK DEPENDENCY IS INTRODUCED');
(function () {
  var sharedSrc = fs.readFileSync(SHARED_PATH, 'utf8');
  var clean = sharedSrc.indexOf('http') === -1 && sharedSrc.indexOf('fetch(') === -1 && sharedSrc.indexOf("require('http") === -1 && sharedSrc.indexOf('require("http') === -1;
  ok(clean, 'connector-readonly-helpers.js never performs or references a network call');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n17. NO CREDENTIAL/TOKEN DEPENDENCY IS INTRODUCED');
(function () {
  var sharedSrc = fs.readFileSync(SHARED_PATH, 'utf8');
  var credentialPatterns = [/applicationSecret/i, /consumerKey/i, /apiToken/i, /apiKey\s*[:=]/i, /password\s*[:=]/i, /process\.env\./];
  var clean = credentialPatterns.every(function (re) { return !re.test(sharedSrc); });
  ok(clean, 'connector-readonly-helpers.js never reads an environment variable or references a credential-shaped field name');
})();

console.log('\nStage AUT-CONNECTOR-SHARED-HELPERS-0: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
