'use strict';
// =====================================================
// Mythos Automation & Operations — Cloudflare Read-Only Connector (INF-CF-AUTO-0)
// projects/automation/reference/cloudflare-readonly-connector.js
//
// Illustrative, in-memory reference implementation — mirrors the pattern
// already established by projects/automation/reference/ovh-readonly-connector.js
// (INF-OVH-API-0) and projects/personal-intelligence/reference/*.js.
//
// Scope (docs/AUTOMATION_ROADMAP.md §"INF-CF-AUTO-0"): LEVEL_1_READ_ONLY
// only — account and zone inventory, current settings inventory. NO WRITES.
//
// This module never constructs a real Cloudflare API client and never
// performs a live network call itself. A real client (built in a later
// stage, reading credentials only from an approved secret store per
// docs/AUTOMATION_SECURITY_AND_SECRETS.md §2 — never committed here) is
// injected by the caller. This module only orchestrates read calls against
// whatever client it is given, and structurally refuses to call anything
// that looks like a mutation.
//
// Redaction: Cloudflare account/zone inventory data is organisational and
// technical (zone name, status, plan, nameservers, security settings), not
// individual WHOIS-style registrant data — but an account object can carry
// an account owner's email in some API responses, so this module redacts
// owner-identifying fields defensively, mirroring the INF-OVH-API-0/
// INF-CF-1 redaction discipline (docs/AUTOMATION_SECURITY_AND_SECRETS.md).
//
// Snapshot records match the aut_snapshots table shape
// (projects/automation/database/control-plane-schema.sql) — draft schema,
// NOT DEPLOYED. This module produces plain JS objects in that shape; it
// does not itself write to any database.
//
// Mutation-method detection and snapshot-record construction are shared,
// provider-neutral logic — owned by ./connector-readonly-helpers.js (Stage
// AUT-CONNECTOR-SHARED-HELPERS-0, resolving the duplication previously
// noted here). This module delegates to it and keeps only what is
// genuinely Cloudflare-specific: owner-field redaction, zone collection
// orchestration, and resource naming.
// =====================================================

var sharedHelpers = require('./connector-readonly-helpers.js');

var OWNER_FIELD_PATTERN = /^(owner|account_owner|contact)[_a-z]*/i;

/**
 * @typedef {Object} CloudflareReadOnlyClient
 * Expected shape of an injected Cloudflare API client. This module never
 * constructs one — the caller supplies it, with credentials sourced only
 * from an approved secret store (see docs/AUTOMATION_SECURITY_AND_SECRETS.md).
 * @property {function(): Promise<Array<string>>} listZones
 * @property {function(string): Promise<Object>} getAccountInfo
 * @property {function(string): Promise<Object>} getZoneSettings
 */

/**
 * Delegates to the shared structural read-only enforcement helper with
 * this provider's error prefix. Not an independent implementation.
 */
function assertReadOnlyClient(client) {
  return sharedHelpers.assertReadOnlyClient(client, { errorPrefix: 'CLOUDFLARE_CONNECTOR' });
}

/**
 * Redacts account-owner-identifying fields from a raw account-info record
 * while retaining organisational and technical fields needed for
 * infrastructure planning (plan, status, zone counts, creation date).
 */
function redactOwnerFields(rawRecord) {
  if (!rawRecord || typeof rawRecord !== 'object') return rawRecord;
  var redacted = {};
  Object.keys(rawRecord).forEach(function (key) {
    if (OWNER_FIELD_PATTERN.test(key)) {
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
  return sharedHelpers.buildSnapshotRecord(input, { errorPrefix: 'CLOUDFLARE_CONNECTOR' });
}

/**
 * Orchestrates the LEVEL_1_READ_ONLY collection scope for one zone: account
 * inventory (redacted) and zone settings inventory. Returns an array of
 * snapshot records — never mutates anything.
 */
function collectForZone(client, zoneId, opts) {
  opts = opts || {};
  var runId = opts.runId || null;
  var connectorId = opts.connectorId || 'cloudflare_readonly';
  var now = opts.observedAt || new Date().toISOString();
  var artifactRefFn = opts.artifactReferenceFn || function (resourceType, z) {
    return 'mem://cloudflare-readonly/' + resourceType + '/' + z + '/' + now;
  };

  return Promise.all([
    client.getAccountInfo(zoneId).then(function (raw) {
      // The redacted payload is computed to enforce/verify the redaction
      // step actually runs, but is deliberately never embedded in the
      // returned snapshot record — only an artifact_reference is, per the
      // aut_snapshots schema comment.
      redactOwnerFields(raw);
      return buildSnapshotRecord({
        snapshotId: connectorId + ':' + zoneId + ':account:' + now,
        runId: runId,
        connectorId: connectorId,
        resourceType: 'cloudflare_account',
        resourceExternalId: zoneId,
        resourceExternalSource: 'Cloudflare',
        artifactReference: artifactRefFn('account', zoneId),
        observedAt: now
      });
    }),
    client.getZoneSettings(zoneId).then(function () {
      return buildSnapshotRecord({
        snapshotId: connectorId + ':' + zoneId + ':settings:' + now,
        runId: runId,
        connectorId: connectorId,
        resourceType: 'cloudflare_zone_settings',
        resourceExternalId: zoneId,
        resourceExternalSource: 'Cloudflare',
        artifactReference: artifactRefFn('settings', zoneId),
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
 * @param {CloudflareReadOnlyClient} client
 * @param {Object} config - shape: { enabled: boolean, authorised_zones: string[], connector_id?: string }
 * @returns {Promise<Array<Object>>} flat array of snapshot records
 */
function runReadOnlyCollection(client, config) {
  // All synchronous validation happens inside this Promise executor so a
  // thrown validation error becomes a rejected promise like every other
  // failure path here, rather than a synchronous throw the caller's
  // .catch() would never see.
  return new Promise(function (resolve, reject) {
    if (!config || config.enabled !== true) {
      return reject(new Error('CLOUDFLARE_CONNECTOR: refusing to run — connector is not explicitly enabled (config.enabled !== true)'));
    }
    if (!Array.isArray(config.authorised_zones) || config.authorised_zones.length === 0) {
      return reject(new Error('CLOUDFLARE_CONNECTOR: refusing to run — no authorised_zones configured'));
    }
    try {
      assertReadOnlyClient(client);
    } catch (e) {
      return reject(e);
    }

    var connectorId = config.connector_id || 'cloudflare_readonly';
    var runId = config.run_id || null;

    resolve(
      Promise.all(
        config.authorised_zones.map(function (zoneId) {
          return collectForZone(client, zoneId, { runId: runId, connectorId: connectorId });
        })
      ).then(function (perZoneArrays) {
        return perZoneArrays.reduce(function (flat, arr) { return flat.concat(arr); }, []);
      })
    );
  });
}

module.exports = {
  assertReadOnlyClient: assertReadOnlyClient,
  redactOwnerFields: redactOwnerFields,
  buildSnapshotRecord: buildSnapshotRecord,
  collectForZone: collectForZone,
  runReadOnlyCollection: runReadOnlyCollection
};
