'use strict';
// =====================================================
// Mythos Automation & Operations — OVH Read-Only Connector (INF-OVH-API-0)
// projects/automation/reference/ovh-readonly-connector.js
//
// Illustrative, in-memory reference implementation — mirrors the pattern
// already established by projects/personal-intelligence/reference/*.js.
//
// Scope (docs/AUTOMATION_ROADMAP.md §"INF-OVH-API-0"): LEVEL_1_READ_ONLY
// only — list authorised domains, collect registrar metadata, collect
// authoritative DNS records, collect DNSSEC state, generate redacted
// structured snapshots. NO WRITES.
//
// This module never constructs a real OVH API client and never performs a
// live network call itself. A real client (built in a later stage, reading
// credentials only from an approved secret store per
// docs/AUTOMATION_SECURITY_AND_SECRETS.md §2 — never committed here) is
// injected by the caller. This module only orchestrates read calls against
// whatever client it is given, and structurally refuses to call anything
// that looks like a mutation.
//
// Redaction policy mirrors docs/CLOUDFLARE_DOMAIN_INVENTORY.md: registrant
// (owner) contact fields are always redacted; registrar, nameservers,
// dates, and DNSSEC state are retained (see docs/AUTOMATION_SECURITY_AND_
// SECRETS.md §"mirrors the redaction discipline already established for
// INF-CF-1/INF-CF-2-PREP").
//
// Snapshot records match the aut_snapshots table shape
// (projects/automation/database/control-plane-schema.sql) — draft schema,
// NOT DEPLOYED. This module produces plain JS objects in that shape; it
// does not itself write to any database.
//
// Mutation-method detection and snapshot-record construction are shared,
// provider-neutral logic — owned by ./connector-readonly-helpers.js (Stage
// AUT-CONNECTOR-SHARED-HELPERS-0). This module delegates to it and keeps
// only what is genuinely OVH-specific: registrant redaction, domain
// collection orchestration, and resource naming.
// =====================================================

var sharedHelpers = require('./connector-readonly-helpers.js');

var REGISTRANT_FIELD_PATTERN = /^registrant/i;

/**
 * @typedef {Object} OvhReadOnlyClient
 * Expected shape of an injected OVH API client. This module never
 * constructs one — the caller supplies it, with credentials sourced only
 * from an approved secret store (see docs/AUTOMATION_SECURITY_AND_SECRETS.md).
 * @property {function(): Promise<Array<string>>} listDomains
 * @property {function(string): Promise<Object>} getRegistrarInfo
 * @property {function(string): Promise<Object>} getDnsRecords
 * @property {function(string): Promise<Object>} getDnssecState
 */

/**
 * Delegates to the shared structural read-only enforcement helper with
 * this provider's error prefix. Not an independent implementation.
 */
function assertReadOnlyClient(client) {
  return sharedHelpers.assertReadOnlyClient(client, { errorPrefix: 'OVH_CONNECTOR' });
}

/**
 * Redacts registrant (owner) contact fields from a raw registrar-info
 * record while retaining organisation-level and technical fields needed
 * for infrastructure planning (registrar, nameservers, dates, DNSSEC
 * state) — mirrors the INF-CF-1 redaction policy.
 */
function redactRegistrantFields(rawRecord) {
  if (!rawRecord || typeof rawRecord !== 'object') return rawRecord;
  var redacted = {};
  Object.keys(rawRecord).forEach(function (key) {
    if (REGISTRANT_FIELD_PATTERN.test(key)) {
      redacted[key] = 'REDACTED';
    } else {
      redacted[key] = rawRecord[key];
    }
  });
  return redacted;
}

/**
 * Delegates to the shared snapshot-record builder with this provider's
 * error prefix. Not an independent implementation — the returned shape,
 * required-field validation, and is_redacted default all come from
 * ./connector-readonly-helpers.js.
 */
function buildSnapshotRecord(input) {
  return sharedHelpers.buildSnapshotRecord(input, { errorPrefix: 'OVH_CONNECTOR' });
}

/**
 * Orchestrates the LEVEL_1_READ_ONLY collection scope for one domain:
 * registrar metadata (redacted), authoritative DNS records, DNSSEC state.
 * Returns an array of snapshot records — never mutates anything.
 */
function collectForDomain(client, domain, opts) {
  opts = opts || {};
  var runId = opts.runId || null;
  var connectorId = opts.connectorId || 'ovh_readonly';
  var now = opts.observedAt || new Date().toISOString();
  var artifactRefFn = opts.artifactReferenceFn || function (resourceType, d) {
    return 'mem://ovh-readonly/' + resourceType + '/' + d + '/' + now;
  };

  return Promise.all([
    client.getRegistrarInfo(domain).then(function (raw) {
      // The redacted payload is computed to enforce/verify the redaction
      // step actually runs, but is deliberately never embedded in the
      // returned snapshot record — only an artifact_reference is, per the
      // aut_snapshots schema comment. A real implementation would persist
      // `redacted` to the artifact store addressed by artifactRefFn's URI.
      redactRegistrantFields(raw);
      return buildSnapshotRecord({
        snapshotId: connectorId + ':' + domain + ':registrar:' + now,
        runId: runId,
        connectorId: connectorId,
        resourceType: 'domain_registrar',
        resourceExternalId: domain,
        resourceExternalSource: 'OVHcloud',
        artifactReference: artifactRefFn('registrar', domain),
        observedAt: now
      });
    }),
    client.getDnsRecords(domain).then(function () {
      return buildSnapshotRecord({
        snapshotId: connectorId + ':' + domain + ':dns:' + now,
        runId: runId,
        connectorId: connectorId,
        resourceType: 'domain_dns_records',
        resourceExternalId: domain,
        resourceExternalSource: 'OVHcloud',
        artifactReference: artifactRefFn('dns', domain),
        observedAt: now
      });
    }),
    client.getDnssecState(domain).then(function () {
      return buildSnapshotRecord({
        snapshotId: connectorId + ':' + domain + ':dnssec:' + now,
        runId: runId,
        connectorId: connectorId,
        resourceType: 'domain_dnssec_state',
        resourceExternalId: domain,
        resourceExternalSource: 'OVHcloud',
        artifactReference: artifactRefFn('dnssec', domain),
        observedAt: now
      });
    })
  ]);
}

/**
 * Top-level entry point. Refuses to run unless the connector config is
 * explicitly enabled (mirrors every other connector_catalogue entry in
 * projects/automation/config/automation.example.json defaulting to
 * enabled: false) and refuses to run against a client exposing any
 * mutation-shaped method.
 *
 * @param {OvhReadOnlyClient} client
 * @param {Object} config - shape: { enabled: boolean, authorised_domains: string[], connector_id?: string }
 * @returns {Promise<Array<Object>>} flat array of snapshot records
 */
function runReadOnlyCollection(client, config) {
  // All synchronous validation happens inside this Promise executor so a
  // thrown validation error becomes a rejected promise like every other
  // failure path here, rather than a synchronous throw the caller's
  // .catch() would never see.
  return new Promise(function (resolve, reject) {
    if (!config || config.enabled !== true) {
      return reject(new Error('OVH_CONNECTOR: refusing to run — connector is not explicitly enabled (config.enabled !== true)'));
    }
    if (!Array.isArray(config.authorised_domains) || config.authorised_domains.length === 0) {
      return reject(new Error('OVH_CONNECTOR: refusing to run — no authorised_domains configured'));
    }
    try {
      assertReadOnlyClient(client);
    } catch (e) {
      return reject(e);
    }

    var connectorId = config.connector_id || 'ovh_readonly';
    var runId = config.run_id || null;

    resolve(
      Promise.all(
        config.authorised_domains.map(function (domain) {
          return collectForDomain(client, domain, { runId: runId, connectorId: connectorId });
        })
      ).then(function (perDomainArrays) {
        return perDomainArrays.reduce(function (flat, arr) { return flat.concat(arr); }, []);
      })
    );
  });
}

module.exports = {
  assertReadOnlyClient: assertReadOnlyClient,
  redactRegistrantFields: redactRegistrantFields,
  buildSnapshotRecord: buildSnapshotRecord,
  collectForDomain: collectForDomain,
  runReadOnlyCollection: runReadOnlyCollection
};
