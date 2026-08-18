'use strict';
// =====================================================
// Mythos Automation & Operations — Tool Registry Catalogue (precursor)
// projects/automation/reference/tool-registry-catalogue.js
//
// Roadmap capability K (Tool Registry, docs/MYTHOS_AI_ORCHESTRATOR_MASTER_
// VISION.md §7) is PLANNED as a runtime-wide catalog of tools with schemas,
// permissions, cost, and risk level. This module is the per-track precursor
// the vision doc names explicitly: it reads the automation track's existing
// connector_catalogue (projects/automation/config/automation.example.json)
// — capability-scoped, least-privilege, already carrying provider/
// capabilities/permission/enabled — and composes it with two additions that
// close the gap to the K vision fields:
//
//   - risk_level / cost_class: read directly off each connector entry in the
//     JSON catalogue (this module only validates them, never assigns them,
//     so the JSON stays the single source of truth for connector metadata).
//   - schema: a per-capability input/output descriptor, kept here rather
//     than duplicated on every connector, since a capability's shape does
//     not depend on which connector exposes it.
//
// Deliberately NOT this module's job: enabling a connector, granting a
// capability, or changing a permission — those remain owner decisions
// recorded in the JSON catalogue and its governance docs. This module is
// read-only over the catalogue and throws (fails closed) rather than
// silently tolerating a malformed or under-scoped entry.
// =====================================================

var fs = require('fs');
var path = require('path');

var CATALOGUE_PATH = path.join(__dirname, '..', 'config', 'automation.example.json');

var RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
var COST_CLASSES = ['NEGLIGIBLE', 'VARIABLE', 'UNMEASURED_NO_LIVE_CALLS'];

// Mechanical, auditable mapping — risk level is derived from permission,
// never assigned by feel. A connector whose declared risk_level drifts from
// this table is a structural error, not a judgement call (see
// assertLeastPrivilege). WRITE_SCOPED is HIGH unconditionally: this
// catalogue never combines read and write permission on one connector
// (enforced upstream by the JSON's own least_privilege_rule), so there is
// no lower-risk write tier to encode here.
var RISK_BY_PERMISSION = { READ_ONLY: 'LOW', WRITE_SCOPED: 'HIGH' };

// A capability name shaped like a mutation is never permitted on a
// READ_ONLY connector, mirroring connector-readonly-helpers.js's
// MUTATING_METHOD_PATTERN but applied to capability strings (e.g.
// "dns.write") rather than injected-client method names.
var MUTATING_CAPABILITY_PATTERN = /\.(write|create|update|set|delete|remove|patch|put|mutate|apply|send|trigger|toggle)$/i;

// One entry per unique capability string across connector_catalogue.
// Placeholder shapes (this whole catalogue is pre-implementation, see the
// JSON's own "_note"), intended as documentation, not a runtime-enforced
// JSON Schema.
var CAPABILITY_SCHEMAS = {
  'domain.list': { input: {}, output: { domains: 'string[]' } },
  'dns.read': { input: { domain: 'string' }, output: { records: 'DnsRecord[]' } },
  'dnssec.read': { input: { domain: 'string' }, output: { dnssec_status: 'string', ds_records: 'string[]' } },
  'dns.write': { input: { domain: 'string', changes: 'DnsRecordChange[]' }, output: { applied: 'boolean', plan_reference: 'string' } },
  'zone.list': { input: {}, output: { zones: 'string[]' } },
  'settings.read': { input: { zone_id: 'string' }, output: { settings: 'object' } },
  'proxy.toggle': { input: { zone_id: 'string', record_id: 'string', proxied: 'boolean' }, output: { applied: 'boolean' } },
  'repo.read': { input: { repo: 'string' }, output: { metadata: 'object' } },
  'pr.read': { input: { repo: 'string', pr_number: 'number' }, output: { pull_request: 'object' } },
  'pr.write': { input: { repo: 'string', pr_number: 'number', action: 'string' }, output: { applied: 'boolean' } },
  'deployment.trigger': { input: { application_id: 'string', git_ref: 'string' }, output: { deployment_id: 'string', status: 'string' } },
  'service.read': { input: { service_id: 'string' }, output: { status: 'string' } },
  'health.read': { input: {}, output: { status: 'string', checks: 'object' } },
  'log.read': { input: { since: 'string' }, output: { lines: 'string[]' } },
  'query.read': { input: { sql: 'string (SELECT-only)' }, output: { rows: 'object[]' } },
  'object.list': { input: { prefix: 'string' }, output: { objects: 'string[]' } },
  'object.read': { input: { key: 'string' }, output: { artifact_reference: 'string' } },
  'backup.list': { input: { prefix: 'string' }, output: { backups: 'object[]' } },
  'backup.verify': { input: { backup_id: 'string' }, output: { verified: 'boolean', checksum: 'string' } },
  'metrics.read': { input: { signal: 'string', range: 'string' }, output: { series: 'object[]' } },
  'alert.read': { input: { since: 'string' }, output: { alerts: 'object[]' } },
  'workflow.trigger': { input: { workflow_id: 'string', payload: 'object' }, output: { run_id: 'string' } },
  'email.send': { input: { to: 'string', subject: 'string', body: 'string' }, output: { message_id: 'string' } },
  'message.send': { input: { to: 'string', body: 'string' }, output: { message_id: 'string' } },
  'payment.read': { input: { payment_id: 'string' }, output: { status: 'string' } },
  'document.read': { input: { document_id: 'string' }, output: { artifact_reference: 'string' } },
  'document.write': { input: { document_id: 'string', content_reference: 'string' }, output: { applied: 'boolean' } },
  'api.read': { input: { endpoint: 'string' }, output: { data: 'object' } }
};

/**
 * Structural validation of one connector_catalogue entry against the Tool
 * Registry field set (name/capability/permissions/cost/risk already exist
 * or are added here; schema is resolved from CAPABILITY_SCHEMAS). Throws on
 * the first missing/invalid field — fails closed rather than returning a
 * partially-valid entry.
 */
function validateToolCatalogueEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('TOOL_REGISTRY: a connector entry object is required');
  }
  ['connector_id', 'provider', 'permission', 'risk_level', 'cost_class'].forEach(function (field) {
    if (!entry[field]) {
      throw new Error('TOOL_REGISTRY: ' + (entry.connector_id || '<unknown>') + ' is missing required field: ' + field);
    }
  });
  if (!Array.isArray(entry.capabilities) || entry.capabilities.length === 0) {
    throw new Error('TOOL_REGISTRY: ' + entry.connector_id + ' must declare a non-empty capabilities array');
  }
  if (RISK_LEVELS.indexOf(entry.risk_level) === -1) {
    throw new Error('TOOL_REGISTRY: ' + entry.connector_id + ' has an unknown risk_level: ' + entry.risk_level);
  }
  if (COST_CLASSES.indexOf(entry.cost_class) === -1) {
    throw new Error('TOOL_REGISTRY: ' + entry.connector_id + ' has an unknown cost_class: ' + entry.cost_class);
  }
  entry.capabilities.forEach(function (cap) {
    if (!CAPABILITY_SCHEMAS[cap]) {
      throw new Error('TOOL_REGISTRY: ' + entry.connector_id + ' declares capability "' + cap + '" with no registered schema');
    }
  });
  return true;
}

/**
 * Least-privilege structural checks beyond field presence:
 *   - risk_level must match the mechanical RISK_BY_PERMISSION mapping for
 *     the entry's permission (drift protection — nobody may hand-tune a
 *     connector's risk down while its permission stays WRITE_SCOPED).
 *   - a READ_ONLY connector may never declare a mutation-shaped capability.
 * Throws on violation.
 */
function assertLeastPrivilege(entry) {
  var expectedRisk = RISK_BY_PERMISSION[entry.permission];
  if (!expectedRisk) {
    throw new Error('TOOL_REGISTRY: ' + entry.connector_id + ' has an unknown permission: ' + entry.permission);
  }
  if (entry.risk_level !== expectedRisk) {
    throw new Error('TOOL_REGISTRY: ' + entry.connector_id + ' declares risk_level ' + entry.risk_level +
      ' but permission ' + entry.permission + ' requires ' + expectedRisk);
  }
  if (entry.permission === 'READ_ONLY') {
    var offending = entry.capabilities.filter(function (cap) { return MUTATING_CAPABILITY_PATTERN.test(cap); });
    if (offending.length) {
      throw new Error('TOOL_REGISTRY: ' + entry.connector_id + ' is READ_ONLY but declares mutation-shaped capability(ies): ' + offending.join(', '));
    }
  }
}

/**
 * Reads the committed connector_catalogue and returns it as a flat Tool
 * Registry view: every connector's declared fields plus each capability
 * resolved to its schema. Read-only over the JSON file — never writes,
 * enables, or grants anything. Fails closed: any entry that does not pass
 * validateToolCatalogueEntry + assertLeastPrivilege aborts the whole load.
 */
function loadCatalogue() {
  var raw = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf8'));
  var groups = raw.connector_catalogue || {};
  var tools = [];
  Object.keys(groups).forEach(function (groupName) {
    if (!Array.isArray(groups[groupName])) return;
    groups[groupName].forEach(function (entry) {
      validateToolCatalogueEntry(entry);
      assertLeastPrivilege(entry);
      tools.push({
        connector_id: entry.connector_id,
        provider: entry.provider,
        track: groupName,
        permission: entry.permission,
        risk_level: entry.risk_level,
        cost_class: entry.cost_class,
        enabled: entry.enabled === true,
        secret_reference_id: entry.secret_reference_id || null,
        capabilities: entry.capabilities.map(function (cap) {
          return { name: cap, schema: CAPABILITY_SCHEMAS[cap] };
        })
      });
    });
  });
  return tools;
}

module.exports = {
  RISK_LEVELS: RISK_LEVELS,
  COST_CLASSES: COST_CLASSES,
  RISK_BY_PERMISSION: RISK_BY_PERMISSION,
  MUTATING_CAPABILITY_PATTERN: MUTATING_CAPABILITY_PATTERN,
  CAPABILITY_SCHEMAS: CAPABILITY_SCHEMAS,
  validateToolCatalogueEntry: validateToolCatalogueEntry,
  assertLeastPrivilege: assertLeastPrivilege,
  loadCatalogue: loadCatalogue
};
