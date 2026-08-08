'use strict';
// =====================================================
// MYTHOS — Stage INF-CF-AUTO-0 Cloudflare read-only connector tests
// tests/inf-cf-auto-0-connector-test.js
//
// Deterministic, offline. Every provider response is mocked — this suite
// never makes a live network call and never requires a real Cloudflare
// credential. See projects/automation/reference/cloudflare-readonly-connector.js.
//
// Run with: node tests/inf-cf-auto-0-connector-test.js
// =====================================================

var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var connector = require(path.join(BASE, 'projects', 'automation', 'reference', 'cloudflare-readonly-connector.js'));

function mockClient(overrides) {
  overrides = overrides || {};
  return Object.assign({
    listZones: function () { return Promise.resolve(['zone-a', 'zone-b']); },
    getAccountInfo: function (zoneId) {
      return Promise.resolve({
        plan: 'Free',
        status: 'active',
        owner_email: 'owner@example-account.tn',
        account_owner_name: 'Jane Example',
        created_at: '2026-01-01',
        zone_id: zoneId
      });
    },
    getZoneSettings: function (zoneId) {
      return Promise.resolve({ zone_id: zoneId, ssl_mode: 'full_strict', security_level: 'medium' });
    }
  }, overrides);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n1. OWNER FIELD REDACTION — account owner PII stripped, technical fields retained');
(function () {
  var raw = {
    plan: 'Free',
    status: 'active',
    owner_email: 'owner@example-account.tn',
    account_owner_name: 'Jane Example',
    contact_phone: '+21600000000',
    created_at: '2026-01-01'
  };
  var redacted = connector.redactOwnerFields(raw);
  ok(redacted.owner_email === 'REDACTED', 'owner_email is redacted');
  ok(redacted.account_owner_name === 'REDACTED', 'account_owner_name is redacted');
  ok(redacted.contact_phone === 'REDACTED', 'contact_phone is redacted');
  ok(redacted.plan === 'Free', 'plan (technical/org field) is retained');
  ok(redacted.status === 'active', 'status (technical field) is retained');
  ok(redacted.created_at === '2026-01-01', 'created_at (technical field) is retained');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n2. SNAPSHOT RECORD SHAPE — matches aut_snapshots columns exactly, never embeds raw payload');
(function () {
  var record = connector.buildSnapshotRecord({
    snapshotId: 'cloudflare_readonly:zone-a:account:2026-08-08T00:00:00Z',
    connectorId: 'cloudflare_readonly',
    resourceType: 'cloudflare_account',
    resourceExternalId: 'zone-a',
    resourceExternalSource: 'Cloudflare',
    artifactReference: 'mem://cloudflare-readonly/account/zone-a',
    observedAt: '2026-08-08T00:00:00Z'
  });
  var expectedKeys = ['snapshot_id', 'run_id', 'connector_id', 'resource_type', 'resource_external_id', 'resource_external_source', 'artifact_reference', 'is_redacted', 'observed_at'];
  var actualKeys = Object.keys(record).sort();
  ok(JSON.stringify(actualKeys) === JSON.stringify(expectedKeys.slice().sort()), 'Snapshot record has exactly the aut_snapshots columns, no extra/leaked fields');
  ok(record.is_redacted === true, 'is_redacted defaults to true');
  ok(typeof record.artifact_reference === 'string' && record.artifact_reference.length > 0, 'artifact_reference is a reference string, not embedded raw data');

  var threw = false;
  try { connector.buildSnapshotRecord({ snapshotId: 'x' }); } catch (e) { threw = true; }
  ok(threw, 'buildSnapshotRecord throws when a required field is missing (fails closed, not silently)');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n3. READ-ONLY CLIENT ENFORCEMENT — structural, not just conventional');
(function () {
  var readOnlyClient = mockClient();
  var threw1 = false;
  try { connector.assertReadOnlyClient(readOnlyClient); } catch (e) { threw1 = true; }
  ok(!threw1, 'A legitimate read-only client (listZones/getAccountInfo/getZoneSettings) passes assertReadOnlyClient');

  var writeClient = mockClient({ updateZoneSettings: function () { return Promise.resolve(); } });
  var threw2 = false;
  try { connector.assertReadOnlyClient(writeClient); } catch (e) { threw2 = true; }
  ok(threw2, 'A client exposing a mutation-shaped method (updateZoneSettings) is rejected by assertReadOnlyClient');

  var deleteClient = mockClient({ deleteZone: function () { return Promise.resolve(); } });
  var threw3 = false;
  try { connector.assertReadOnlyClient(deleteClient); } catch (e) { threw3 = true; }
  ok(threw3, 'A client exposing deleteZone is also rejected');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n4. RUN GATE — refuses to run unless explicitly enabled');
(function () {
  connector.runReadOnlyCollection(mockClient(), { enabled: false, authorised_zones: ['zone-a'] })
    .then(function () { ok(false, 'runReadOnlyCollection must reject when enabled is false'); })
    .catch(function (e) { ok(/not explicitly enabled/.test(e.message), 'runReadOnlyCollection refuses to run when config.enabled !== true'); });
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n5. RUN GATE — refuses to run with no authorised zones');
(function () {
  connector.runReadOnlyCollection(mockClient(), { enabled: true, authorised_zones: [] })
    .then(function () { ok(false, 'runReadOnlyCollection must reject an empty authorised_zones list'); })
    .catch(function (e) { ok(/no authorised_zones configured/.test(e.message), 'runReadOnlyCollection refuses to run with an empty zone list'); });
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n6. RUN GATE — refuses to run against a client exposing a write method, even when enabled');
(function () {
  var writeClient = mockClient({ setZoneSetting: function () { return Promise.resolve(); } });
  var threwSynchronously = false;
  var resultPromise;
  try {
    resultPromise = connector.runReadOnlyCollection(writeClient, { enabled: true, authorised_zones: ['zone-a'] });
  } catch (e) {
    threwSynchronously = true;
  }
  ok(!threwSynchronously, 'runReadOnlyCollection never throws synchronously — every failure path is a rejected promise the caller can .catch()');
  ok(resultPromise && typeof resultPromise.then === 'function', 'runReadOnlyCollection always returns a real Promise, even on the read-only-violation path');
  resultPromise
    .then(function () { ok(false, 'runReadOnlyCollection must reject a write-capable client regardless of the enabled flag'); })
    .catch(function (e) { ok(/read-only violation/.test(e.message), 'runReadOnlyCollection refuses a write-capable client even when enabled: true'); });
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n7. FULL COLLECTION — enabled + read-only client produces 2 snapshots per zone, no leaked PII');
(function () {
  var zones = ['zone-a', 'zone-b'];
  return connector.runReadOnlyCollection(mockClient(), { enabled: true, authorised_zones: zones, connector_id: 'cloudflare_readonly', run_id: 'run_test_1' })
    .then(function (snapshots) {
      ok(Array.isArray(snapshots) && snapshots.length === zones.length * 2, 'runReadOnlyCollection returns 2 snapshots (account, settings) per authorised zone');
      var resourceTypes = snapshots.map(function (s) { return s.resource_type; });
      ok(resourceTypes.indexOf('cloudflare_account') !== -1 && resourceTypes.indexOf('cloudflare_zone_settings') !== -1,
        'Both scoped resource types are covered (cloudflare_account, cloudflare_zone_settings)');
      ok(snapshots.every(function (s) { return s.is_redacted === true; }), 'Every returned snapshot is marked is_redacted: true');
      ok(snapshots.every(function (s) { return s.connector_id === 'cloudflare_readonly'; }), 'Every snapshot carries the correct connector_id');
      ok(snapshots.every(function (s) { return s.run_id === 'run_test_1'; }), 'Every snapshot carries the supplied run_id');

      var serialized = JSON.stringify(snapshots);
      var piiPatterns = [/Jane Example/, /owner@example-account\.tn/, /\+21600000000/];
      var noPii = piiPatterns.every(function (re) { return !re.test(serialized); });
      ok(noPii, 'No account-owner PII (name/email/phone) appears anywhere in the returned snapshot records — they only ever carry an artifact_reference');
    })
    .catch(function (e) { ok(false, 'Full collection run should not throw: ' + e.message); });
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n8. NO SECRET/CREDENTIAL HANDLING — module never accepts or references a credential value');
(function () {
  var fs = require('fs');
  var src = fs.readFileSync(path.join(BASE, 'projects', 'automation', 'reference', 'cloudflare-readonly-connector.js'), 'utf8');
  var credentialPatterns = [/apiToken/i, /apiKey\s*[:=]/i, /password\s*[:=]/i, /process\.env\./];
  var clean = credentialPatterns.every(function (re) { return !re.test(src); });
  ok(clean, 'The connector module source never reads an environment variable or references a credential-shaped field name — credentials are strictly the injected client\'s concern, never this module\'s');
  ok(src.indexOf('http') === -1 && src.indexOf('fetch(') === -1 && src.indexOf('require(\'http') === -1, 'The connector module never performs a network call itself — all provider I/O goes through the injected client');
})();

// Allow the async sections above (§4-§7) to settle before printing totals.
setTimeout(function () {
  console.log('\nStage INF-CF-AUTO-0 connector: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
  process.exit(0);
}, 200);
