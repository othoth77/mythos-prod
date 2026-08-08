'use strict';
// =====================================================
// Mythos Automation & Operations — Shared Read-Only Connector Helpers
// projects/automation/reference/connector-readonly-helpers.js
//
// Stage: AUT-CONNECTOR-SHARED-HELPERS-0
//
// Provider-neutral, deliberately small helpers shared by every LEVEL_1_
// READ_ONLY connector reference implementation. Owns ONLY the two genuinely
// provider-independent responsibilities:
//
//   A. Mutation-method detection / fail-closed client validation
//   B. Snapshot record construction matching the aut_snapshots table shape
//      (projects/automation/database/control-plane-schema.sql — draft
//      schema, NOT DEPLOYED)
//
// Everything provider-specific stays in each provider's own module and is
// NOT moved here: redaction rules (OVH's redactRegistrantFields, Cloudflare's
// redactOwnerFields), collection orchestration, resource naming/types,
// authorised-domain vs. authorised-zone config shape, and run orchestration.
// See docs/AI_HANDOVER.md's AUT-CONNECTOR-SHARED-HELPERS-0 entry for the
// full rationale.
//
// This module never makes a network call, never reads a credential, and
// never constructs a provider client — it only validates and shapes data
// the caller already has.
// =====================================================

var MUTATING_METHOD_PATTERN = /^(create|update|set|write|delete|remove|patch|put|mutate|apply)/i;

/**
 * Structural read-only enforcement: throws if the supplied client exposes
 * any function whose name matches a mutation-shaped verb. Checked against
 * the client's own enumerable methods, not a fixed allowlist, so a client
 * that grows an unexpected write method fails closed rather than silently
 * being trusted — this guard cannot be bypassed by a provider omitting a
 * name from some list, because there is no such list.
 *
 * @param {Object} client
 * @param {Object} [opts]
 * @param {string} [opts.errorPrefix] - provider-specific error prefix (e.g. 'OVH_CONNECTOR')
 */
function assertReadOnlyClient(client, opts) {
  opts = opts || {};
  var prefix = opts.errorPrefix || 'CONNECTOR';
  if (!client || typeof client !== 'object') {
    throw new Error(prefix + ': a client object is required');
  }
  var offending = Object.keys(client).filter(function (key) {
    return typeof client[key] === 'function' && MUTATING_METHOD_PATTERN.test(key);
  });
  if (offending.length) {
    throw new Error(prefix + ': read-only violation — client exposes mutation-shaped method(s): ' + offending.join(', '));
  }
}

/**
 * Builds a snapshot record matching aut_snapshots' column shape. The raw
 * provider data is never embedded directly — callers pass an
 * artifactReference (a URI/hash reference) exactly as the schema column
 * comment requires; storage of the artifact itself is out of scope for
 * every reference implementation using this helper.
 *
 * @param {Object} input
 * @param {Object} [opts]
 * @param {string} [opts.errorPrefix] - provider-specific error prefix (e.g. 'CLOUDFLARE_CONNECTOR')
 */
function buildSnapshotRecord(input, opts) {
  opts = opts || {};
  var prefix = opts.errorPrefix || 'CONNECTOR';
  var required = ['snapshotId', 'connectorId', 'resourceType', 'resourceExternalId', 'resourceExternalSource', 'artifactReference', 'observedAt'];
  required.forEach(function (field) {
    if (!input || input[field] === undefined || input[field] === null) {
      throw new Error(prefix + ': buildSnapshotRecord missing required field: ' + field);
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

module.exports = {
  MUTATING_METHOD_PATTERN: MUTATING_METHOD_PATTERN,
  assertReadOnlyClient: assertReadOnlyClient,
  buildSnapshotRecord: buildSnapshotRecord
};
