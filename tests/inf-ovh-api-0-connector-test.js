'use strict';
// =====================================================
// MYTHOS — Stage INF-OVH-API-0 OVH read-only connector tests
// tests/inf-ovh-api-0-connector-test.js
//
// Deterministic, offline. Every provider response is mocked — this suite
// never makes a live network call and never requires a real OVH
// credential. See projects/automation/reference/ovh-readonly-connector.js.
//
// Run with: node tests/inf-ovh-api-0-connector-test.js
// =====================================================

var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var connector = require(path.join(BASE, 'projects', 'automation', 'reference', 'ovh-readonly-connector.js'));

function mockClient(overrides) {
  overrides = overrides || {};
  return Object.assign({
    listDomains: function () { return Promise.resolve(['example-a.tn', 'example-b.tn']); },
    getRegistrarInfo: function (domain) {
      return Promise.resolve({
        registrar: 'OVH',
        registrant_name: 'Jane Example',
        registrant_email: 'jane@example-owner.tn',
        registrant_phone: '+21600000000',
        creation_date: '2026-01-01',
        status: 'Active',
        domain: domain
      });
    },
    getDnsRecords: function (domain) {
      return Promise.resolve({ domain: domain, records: [{ type: 'A', value: '203.0.113.10' }] });
    },
    getDnssecState: function (domain) {
      return Promise.resolve({ domain: domain, dnssec: 'UNSIGNED' });
    }
  }, overrides);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n1. REGISTRANT REDACTION — owner PII stripped, technical fields retained');
(function () {
  var raw = {
    registrar: 'OVH',
    registrant_name: 'Jane Example',
    registrant_email: 'jane@example-owner.tn',
    registrant_phone: '+21600000000',
    creation_date: '2026-01-01',
    status: 'Active'
  };
  var redacted = connector.redactRegistrantFields(raw);
  ok(redacted.registrant_name === 'REDACTED', 'registrant_name is redacted');
  ok(redacted.registrant_email === 'REDACTED', 'registrant_email is redacted');
  ok(redacted.registrant_phone === 'REDACTED', 'registrant_phone is redacted');
  ok(redacted.registrar === 'OVH', 'registrar (technical/org field) is retained');
  ok(redacted.creation_date === '2026-01-01', 'creation_date (technical field) is retained');
  ok(redacted.status === 'Active', 'status (technical field) is retained');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n2. SNAPSHOT RECORD SHAPE — matches aut_snapshots columns exactly, never embeds raw payload');
(function () {
  var record = connector.buildSnapshotRecord({
    snapshotId: 'ovh_readonly:example.tn:registrar:2026-08-08T00:00:00Z',
    connectorId: 'ovh_readonly',
    resourceType: 'domain_registrar',
    resourceExternalId: 'example.tn',
    resourceExternalSource: 'OVHcloud',
    artifactReference: 'mem://ovh-readonly/registrar/example.tn',
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
  ok(!threw1, 'A legitimate read-only client (listDomains/getRegistrarInfo/getDnsRecords/getDnssecState) passes assertReadOnlyClient');

  var writeClient = mockClient({ updateDnsRecord: function () { return Promise.resolve(); } });
  var threw2 = false;
  try { connector.assertReadOnlyClient(writeClient); } catch (e) { threw2 = true; }
  ok(threw2, 'A client exposing a mutation-shaped method (updateDnsRecord) is rejected by assertReadOnlyClient');

  var deleteClient = mockClient({ deleteZone: function () { return Promise.resolve(); } });
  var threw3 = false;
  try { connector.assertReadOnlyClient(deleteClient); } catch (e) { threw3 = true; }
  ok(threw3, 'A client exposing deleteZone is also rejected');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n4. RUN GATE — refuses to run unless explicitly enabled');
(function (done) {
  connector.runReadOnlyCollection(mockClient(), { enabled: false, authorised_domains: ['example.tn'] })
    .then(function () { ok(false, 'runReadOnlyCollection must reject when enabled is false'); })
    .catch(function (e) { ok(/not explicitly enabled/.test(e.message), 'runReadOnlyCollection refuses to run when config.enabled !== true'); });
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n5. RUN GATE — refuses to run with no authorised domains');
(function () {
  connector.runReadOnlyCollection(mockClient(), { enabled: true, authorised_domains: [] })
    .then(function () { ok(false, 'runReadOnlyCollection must reject an empty authorised_domains list'); })
    .catch(function (e) { ok(/no authorised_domains configured/.test(e.message), 'runReadOnlyCollection refuses to run with an empty domain list'); });
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n6. RUN GATE — refuses to run against a client exposing a write method, even when enabled');
(function () {
  var writeClient = mockClient({ setDnsRecord: function () { return Promise.resolve(); } });
  connector.runReadOnlyCollection(writeClient, { enabled: true, authorised_domains: ['example.tn'] })
    .then(function () { ok(false, 'runReadOnlyCollection must reject a write-capable client regardless of the enabled flag'); })
    .catch(function (e) { ok(/read-only violation/.test(e.message), 'runReadOnlyCollection refuses a write-capable client even when enabled: true'); });
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n6b. RUN GATE REJECTION IS ASYNC (regression: a rejected promise, never a synchronous throw)');
(function () {
  var writeClient = mockClient({ setDnsRecord: function () { return Promise.resolve(); } });
  var threwSynchronously = false;
  var resultPromise;
  try {
    resultPromise = connector.runReadOnlyCollection(writeClient, { enabled: true, authorised_domains: ['example.tn'] });
  } catch (e) {
    threwSynchronously = true;
  }
  ok(!threwSynchronously, 'runReadOnlyCollection never throws synchronously — every failure path is a rejected promise the caller can .catch()');
  ok(resultPromise && typeof resultPromise.then === 'function', 'runReadOnlyCollection always returns a real Promise, even on the read-only-violation path');
  if (resultPromise) resultPromise.catch(function () { /* expected rejection, already asserted above via §6 */ });
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n7. FULL COLLECTION — enabled + read-only client produces 3 snapshots per domain, no leaked PII');
(function () {
  var domains = ['example-a.tn', 'example-b.tn'];
  return connector.runReadOnlyCollection(mockClient(), { enabled: true, authorised_domains: domains, connector_id: 'ovh_readonly', run_id: 'run_test_1' })
    .then(function (snapshots) {
      ok(Array.isArray(snapshots) && snapshots.length === domains.length * 3, 'runReadOnlyCollection returns 3 snapshots (registrar, dns, dnssec) per authorised domain');
      var resourceTypes = snapshots.map(function (s) { return s.resource_type; });
      ok(resourceTypes.indexOf('domain_registrar') !== -1 && resourceTypes.indexOf('domain_dns_records') !== -1 && resourceTypes.indexOf('domain_dnssec_state') !== -1,
        'All 3 scoped resource types are covered (domain_registrar, domain_dns_records, domain_dnssec_state)');
      ok(snapshots.every(function (s) { return s.is_redacted === true; }), 'Every returned snapshot is marked is_redacted: true');
      ok(snapshots.every(function (s) { return s.connector_id === 'ovh_readonly'; }), 'Every snapshot carries the correct connector_id');
      ok(snapshots.every(function (s) { return s.run_id === 'run_test_1'; }), 'Every snapshot carries the supplied run_id');

      var serialized = JSON.stringify(snapshots);
      var piiPatterns = [/Jane Example/, /jane@example-owner\.tn/, /\+21600000000/];
      var noPii = piiPatterns.every(function (re) { return !re.test(serialized); });
      ok(noPii, 'No registrant PII (name/email/phone) appears anywhere in the returned snapshot records — they only ever carry an artifact_reference');
    })
    .catch(function (e) { ok(false, 'Full collection run should not throw: ' + e.message); });
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n8. NO SECRET/CREDENTIAL HANDLING — module never accepts or references a credential value');
(function () {
  var fs = require('fs');
  var src = fs.readFileSync(path.join(BASE, 'projects', 'automation', 'reference', 'ovh-readonly-connector.js'), 'utf8');
  var credentialPatterns = [/applicationSecret/i, /consumerKey/i, /apiKey\s*[:=]/i, /password\s*[:=]/i, /process\.env\./];
  var clean = credentialPatterns.every(function (re) { return !re.test(src); });
  ok(clean, 'The connector module source never reads an environment variable or references a credential-shaped field name — credentials are strictly the injected client\'s concern, never this module\'s');
  ok(src.indexOf('http') === -1 && src.indexOf('fetch(') === -1 && src.indexOf('require(\'http') === -1, 'The connector module never performs a network call itself — all provider I/O goes through the injected client');
})();

// Allow the async sections above (§4-§7) to settle before printing totals.
setTimeout(function () {
  console.log('\nStage INF-OVH-API-0 connector: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
  process.exit(0);
}, 200);
