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
// KNOWN DUPLICATION (deliberately deferred, not fixed in this stage):
// buildSnapshotRecord() and assertReadOnlyClient() below are structurally
// identical to their counterparts in ovh-readonly-connector.js. Extracting
// a shared helper module was considered and explicitly deferred by owner
// instruction for this stage — do not perform that refactor here. See
// docs/AI_HANDOVER.md's INF-CF-AUTO-0 entry for the deferred-work record.
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
// =====================================================

var OWNER_FIELD_PATTERN = /^(owner|account_owner|contact)[_a-z]*/i;

var MUTATING_METHOD_PATTERN = /^(create|update|set|write|delete|remove|patch|put|mutate|apply)/i;

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
 * Structural read-only enforcement: throws if the supplied client exposes
 * any function whose name matches a mutation-shaped verb. Checked against
 * the client's own enumerable methods, not a fixed allowlist, so a client
 * that grew an unexpected write method fails closed rather than silently
 * being trusted.
 */
function assertReadOnlyClient(client) {
  if (!client || typeof client !== 'object') {
    throw new Error('CLOUDFLARE_CONNECTOR: a client object is required');
  }
  var offending = Object.keys(client).filter(function (key) {
    return typeof client[key] === 'function' && MUTATING_METHOD_PATTERN.test(key);
  });
  if (offending.length) {
    throw new Error('CLOUDFLARE_CONNECTOR: read-only violation — client exposes mutation-shaped method(s): ' + offending.join(', '));
  }
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
 * Builds a snapshot record matching aut_snapshots' column shape. The raw
 * provider data is never embedded directly — callers pass an
 * artifactReference (a URI/hash reference) exactly as the schema column
 * comment requires; storage of the artifact itself is out of scope for
 * this reference implementation.
 */
function buildSnapshotRecord(input) {
  var required = ['snapshotId', 'connectorId', 'resourceType', 'resourceExternalId', 'resourceExternalSource', 'artifactReference', 'observedAt'];
  required.forEach(function (field) {
    if (!input || input[field] === undefined || input[field] === null) {
      throw new Error('CLOUDFLARE_CONNECTOR: buildSnapshotRecord missing required field: ' + field);
    }
  });
  return {
    snapshot_id: input.snapshotId,
    run_id: input.runId || null,
    connector_id: input.connectorId,
    resource_type: input.resourceType,
    resource_external_id: input.resourceExternalId,
    resource_external_source: input.resourceExternalSource,
    artifact_reference: input.artifactReference,
    is_redacted: true,
    observed_at: input.observedAt
  };
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
