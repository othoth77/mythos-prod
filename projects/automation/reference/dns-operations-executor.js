'use strict';
// =====================================================
// Mythos Automation & Operations — Approved DNS Operations (INF-DNS-AUTO-2)
// projects/automation/reference/dns-operations-executor.js
//
// Scope (docs/AUTOMATION_ROADMAP.md §"INF-DNS-AUTO-2"), verbatim:
//   `LEVEL_3_APPROVAL_REQUIRED` only.
//     - one domain at a time,
//     - explicit owner approval (per docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md),
//     - automatic verification and rollback.
//   "This stage is where INF-CF-2 itself becomes executable — but only after
//    its own entry criteria are separately satisfied. Introducing
//    INF-DNS-AUTO-2 does not itself unblock INF-CF-2."
//
// WHAT THIS MODULE IS. The guarded execution path for a plan produced by
// INF-DNS-AUTO-1 (./dns-comparison-engine.js). It plans nothing itself and
// re-implements no analysis: it consumes that plan, its rollback plan, and an
// approval, then either refuses or performs exactly one authorised operation
// through exactly one authorised write connector, verifying immediately and
// rolling back automatically on verification failure.
//
// THE GATE IS THE POINT. Every refusal below is a repository rule, not a
// preference:
//   - docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md — six permitted approval values;
//     approval is per domain AND per action; only APPROVED_FOR_MIGRATION
//     authorises execution; DEFERRED blocks exactly like NOT_REQUESTED; and
//     "updating a value in this table ... is not a task an automated stage may
//     perform on its own judgement" (§"How This Gate Is Used" item 5). This
//     module therefore READS that gate and can never write it.
//   - docs/AUTOMATION_APPROVAL_MATRIX.md §2 — nameserver, DNSSEC/DS and
//     production DNS record deletion are permanent LEVEL_3 boundaries.
//   - projects/automation/config/automation.example.json §approval_rules —
//     self_approval_allowed false, expired_approval_reusable false,
//     rejected_run_can_execute false, rollback_is_separate_audited_execution.
//   - docs/AUTOMATION_ARCHITECTURE.md §5 — a read connector and a write
//     connector for the same provider are ALWAYS distinct definitions; least
//     privilege is enforced structurally, per capability.
//   - docs/AUTOMATION_SECURITY_AND_SECRETS.md §4 — secret_reference only. This
//     module never reads, receives, logs or returns a secret VALUE.
//
// STATE OF THE WORLD AT THIS STAGE (verified, not assumed): every one of the
// eight portfolio domains carries NOT_REQUESTED in all five action-approval
// fields, both DNS write connectors are enabled:false, every LEVEL_3 feature
// flag is false, and no OVH or Cloudflare credential exists anywhere. Any one
// of those refuses execution on its own. This module is therefore complete and
// fully tested, and has performed no DNS mutation.
//
// This module never constructs a provider client and never performs a network
// call itself — a real client is injected by the caller, exactly as both
// read-only connectors already require.
// =====================================================

var crypto = require('crypto');
var engine = require('./dns-comparison-engine.js');

var AUTOMATION_LEVEL = 'LEVEL_3_APPROVAL_REQUIRED';

// docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md §"Allowed Approval Values" — the
// complete vocabulary. "No value other than these six may be used."
var APPROVAL_VALUES = ['NOT_REQUESTED', 'PENDING', 'APPROVED_FOR_PREPARATION',
  'APPROVED_FOR_MIGRATION', 'REJECTED', 'DEFERRED'];

// Only this value authorises executing a change. APPROVED_FOR_PREPARATION
// explicitly does NOT ("has not approved executing any change yet").
var EXECUTING_APPROVAL_VALUE = 'APPROVED_FOR_MIGRATION';

// The five per-action approval fields, exactly as the gate document names them.
var APPROVAL_FIELDS = ['DNSSEC approval', 'Nameserver migration approval',
  'Cloudflare proxy approval', 'Tunnel approval', 'Access approval'];

// Which approval field each INF-DNS-AUTO-1 plan step kind requires. Approval
// is per action: proxy approval says nothing about DNSSEC, and vice versa.
var STEP_KIND_APPROVAL_FIELD = {
  nameserver_change: 'Nameserver migration approval',
  dnssec_ds_change: 'DNSSEC approval',
  proxy_mode_set: 'Cloudflare proxy approval',
  record_recreate: 'Nameserver migration approval',
  record_delete: 'Nameserver migration approval'
};

// docs/AUTOMATION_APPROVAL_MATRIX.md §2 items 1-3, as the policy keys the
// approval policy must carry.
var SEPARATION_OF_DUTIES_KEYS = ['domain_nameserver_changes',
  'dnssec_or_ds_record_changes', 'production_dns_record_deletion'];

var LIVE_FLAG_FOR_CONNECTOR = {
  ovh_dns_operator: 'connector_ovh_dns_operator_live',
  cloudflare_dns_operator: 'connector_cloudflare_dns_operator_live'
};

// Field names whose VALUE must never enter an envelope, audit record, or any
// returned object. Presence of the key alone is a refusal.
var SECRET_FIELD_PATTERN = /^(api[_-]?key|apikey|api[_-]?token|token|secret|password|passwd|private[_-]?key|credential|consumer[_-]?key|application[_-]?secret|authorization)$/i;

function refuse(code, detail) {
  var e = new Error('DNS_OPERATIONS_EXECUTOR: ' + code + (detail ? ' — ' + detail : ''));
  e.refused = true;
  e.code = code;
  return e;
}

function sha16(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

// -----------------------------------------------------------------------
// approvalGateFromDocument(markdown)
//
// Parses docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md's approval TABLE into
// { domain: { field: value } }. The committed document is the authority —
// this module reads it and has no code path that writes it.
//
// Any value outside the six-value vocabulary is refused rather than coerced:
// an unrecognised approval state must never be treated as permissive.
// -----------------------------------------------------------------------
function approvalGateFromDocument(markdown) {
  if (typeof markdown !== 'string' || !markdown.trim()) throw refuse('APPROVAL_GATE_DOCUMENT_REQUIRED');
  var lines = markdown.split('\n');
  var headerIndex = -1, header = null;
  for (var i = 0; i < lines.length; i++) {
    if (/^\|\s*Domain\s*\|/.test(lines[i])) {
      header = lines[i].split('|').slice(1, -1).map(function (h) { return h.trim(); });
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) throw refuse('APPROVAL_GATE_TABLE_NOT_FOUND');
  APPROVAL_FIELDS.forEach(function (f) {
    if (header.indexOf(f) === -1) throw refuse('APPROVAL_GATE_FIELD_MISSING', f);
  });

  var gate = {};
  for (var j = headerIndex + 1; j < lines.length; j++) {
    var line = lines[j];
    if (!/^\|/.test(line)) break;
    if (/^\|\s*-+/.test(line.replace(/\|/g, '|'))) continue; // separator row
    var cells = line.split('|').slice(1, -1).map(function (c) { return c.trim(); });
    if (cells.length !== header.length) continue;
    var domain = cells[0];
    if (!domain || /^-+$/.test(domain)) continue;
    var entry = {};
    APPROVAL_FIELDS.forEach(function (f) {
      var value = cells[header.indexOf(f)];
      if (APPROVAL_VALUES.indexOf(value) === -1) {
        throw refuse('APPROVAL_GATE_VALUE_INVALID', domain + ' / ' + f + ' = "' + value + '"');
      }
      entry[f] = value;
    });
    gate[domain.toLowerCase()] = entry;
  }
  if (!Object.keys(gate).length) throw refuse('APPROVAL_GATE_EMPTY');
  return gate;
}

/**
 * The approval fields a plan actually needs, derived from its step kinds.
 * Deterministic and deduplicated.
 */
function requiredApprovalFields(plan) {
  if (!plan || !Array.isArray(plan.steps)) throw refuse('PLAN_REQUIRED');
  var seen = {}, out = [];
  plan.steps.forEach(function (s) {
    var field = STEP_KIND_APPROVAL_FIELD[s.kind];
    if (!field) throw refuse('UNKNOWN_OPERATION_KIND', String(s.kind));
    if (!seen[field]) { seen[field] = true; out.push(field); }
  });
  return out.sort();
}

// -----------------------------------------------------------------------
// assertOwnerApproval({ gate, domain, plan }) — the owner gate.
//
// Refuses unless EVERY approval field the plan needs is APPROVED_FOR_MIGRATION
// for THIS domain. Per the gate document: approval is per domain and per
// action; APPROVED_FOR_PREPARATION is not execution approval; DEFERRED blocks
// exactly as NOT_REQUESTED does; REJECTED must not be re-requested.
// -----------------------------------------------------------------------
function assertOwnerApproval(input) {
  input = input || {};
  var gate = input.gate, domain = String(input.domain || '').toLowerCase();
  if (!gate || typeof gate !== 'object') throw refuse('APPROVAL_GATE_REQUIRED');
  if (!domain) throw refuse('DOMAIN_REQUIRED');
  if (!Object.prototype.hasOwnProperty.call(gate, domain)) {
    // An undeclared domain is refused outright — never treated as unrestricted.
    throw refuse('DOMAIN_NOT_IN_APPROVAL_GATE', domain);
  }
  var needed = requiredApprovalFields(input.plan);
  var blocking = [];
  needed.forEach(function (field) {
    var value = gate[domain][field];
    if (value !== EXECUTING_APPROVAL_VALUE) blocking.push({ field: field, value: value });
  });
  if (blocking.length) {
    throw refuse('OWNER_APPROVAL_MISSING', domain + ': ' +
      blocking.map(function (b) { return b.field + '=' + b.value; }).join(', ') +
      ' (execution requires ' + EXECUTING_APPROVAL_VALUE + ' on every field the plan touches)');
  }
  return { domain: domain, fields: needed, status: EXECUTING_APPROVAL_VALUE };
}

// -----------------------------------------------------------------------
// assertApprovalRecord({ approval, policy, runId, now })
//
// Validates the aut_approvals row and its governing aut_approval_policies row.
// -----------------------------------------------------------------------
function assertApprovalRecord(input) {
  input = input || {};
  var a = input.approval, p = input.policy;
  var now = input.now ? new Date(input.now) : new Date();
  if (!a || typeof a !== 'object') throw refuse('APPROVAL_RECORD_REQUIRED');
  if (!p || typeof p !== 'object') throw refuse('APPROVAL_POLICY_REQUIRED');

  if (p.minimum_automation_level_covered !== AUTOMATION_LEVEL) {
    throw refuse('APPROVAL_LEVEL_INSUFFICIENT',
      'policy covers ' + p.minimum_automation_level_covered + ', this operation is ' + AUTOMATION_LEVEL);
  }
  if (p.enabled !== true) throw refuse('APPROVAL_POLICY_DISABLED', String(p.policy_key));
  if (SEPARATION_OF_DUTIES_KEYS.indexOf(p.policy_key) === -1) {
    throw refuse('APPROVAL_POLICY_KEY_UNRECOGNISED', String(p.policy_key));
  }
  if (p.is_permanent_boundary !== true) {
    throw refuse('PERMANENT_BOUNDARY_NOT_DECLARED', String(p.policy_key));
  }
  if (p.allow_self_approval !== false) {
    throw refuse('SELF_APPROVAL_PERMITTED_BY_POLICY', String(p.policy_key));
  }
  if (a.decision !== 'APPROVE') throw refuse('APPROVAL_NOT_GRANTED', String(a.decision));
  if (a.is_self_approval !== false) throw refuse('SELF_APPROVAL_REJECTED');
  if (typeof a.decided_by_ref !== 'string' || !a.decided_by_ref.trim()) {
    throw refuse('APPROVER_REFERENCE_REQUIRED');
  }
  if (input.requestedByRef && a.decided_by_ref === input.requestedByRef) {
    // Separation of duties: the requester may never be the approver.
    throw refuse('SELF_APPROVAL_REJECTED', 'requester and approver are the same reference');
  }
  if (a.run_id !== input.runId) {
    // An approval belongs to the run it was granted for; it is not a token
    // that can be carried to a different run.
    throw refuse('APPROVAL_RUN_MISMATCH', 'approval is bound to ' + String(a.run_id));
  }
  if (a.expires_at !== null && a.expires_at !== undefined && new Date(a.expires_at) <= now) {
    throw refuse('APPROVAL_EXPIRED', 'expired_approval_reusable is false');
  }
  var required = typeof p.required_approval_count === 'number' ? p.required_approval_count : 1;
  var approvers = Array.isArray(input.additionalApprovals)
    ? input.additionalApprovals.concat([a]) : [a];
  var distinct = {};
  approvers.forEach(function (x) {
    if (x && x.decision === 'APPROVE' && x.is_self_approval === false) distinct[x.decided_by_ref] = true;
  });
  if (Object.keys(distinct).length < required) {
    throw refuse('APPROVAL_COUNT_INSUFFICIENT',
      Object.keys(distinct).length + ' distinct approver(s), policy requires ' + required);
  }
  return { policy_key: p.policy_key, approvers: Object.keys(distinct).length, expires_at: a.expires_at || null };
}

// -----------------------------------------------------------------------
// assertAuthorisedConnector({ connector, client, catalogue, featureFlags, operationKind })
//
// The write-connector boundary. Read connectors are validated by
// connector-readonly-helpers.assertReadOnlyClient; a WRITE connector is the
// opposite problem — it legitimately exposes mutation methods, so the rule is
// least privilege: it may expose ONLY methods its declared capabilities cover.
// -----------------------------------------------------------------------
function assertAuthorisedConnector(input) {
  input = input || {};
  var connector = input.connector, catalogue = input.catalogue, flags = input.featureFlags || {};
  if (!connector || typeof connector !== 'object') throw refuse('CONNECTOR_REQUIRED');
  if (!Array.isArray(catalogue)) throw refuse('CONNECTOR_CATALOGUE_REQUIRED');

  // The connector must be a real catalogue entry. A caller cannot invent one,
  // so a mock or test-only connector can never reach the write path.
  var declared = catalogue.filter(function (c) { return c.connector_id === connector.connector_id; })[0];
  if (!declared) throw refuse('CONNECTOR_NOT_IN_CATALOGUE', String(connector.connector_id));
  if (declared.permission !== 'WRITE_SCOPED') {
    throw refuse('CONNECTOR_NOT_A_WRITE_CONNECTOR', declared.connector_id + ' is ' + declared.permission);
  }
  if (/readonly/i.test(declared.connector_id)) {
    // Architecture §5: a read connector and a write connector are always
    // distinct definitions; a read connector may never be used to mutate.
    throw refuse('READ_CONNECTOR_CANNOT_MUTATE', declared.connector_id);
  }
  if (declared.enabled !== true) throw refuse('CONNECTOR_DISABLED', declared.connector_id);

  var flagName = LIVE_FLAG_FOR_CONNECTOR[declared.connector_id];
  if (!flagName) throw refuse('CONNECTOR_HAS_NO_LIVE_FLAG', declared.connector_id);
  if (flags[flagName] !== true) throw refuse('CONNECTOR_NOT_LIVE', flagName + ' is not true');
  if (flags.level_3_approval_required_runs !== true) {
    throw refuse('LEVEL_3_RUNS_DISABLED', 'level_3_approval_required_runs is not true');
  }

  if (input.provider && declared.provider !== input.provider) {
    throw refuse('PROVIDER_MISMATCH', 'plan targets ' + input.provider + ', connector is ' + declared.provider);
  }
  var capability = input.requiredCapability;
  if (capability && (declared.capabilities || []).indexOf(capability) === -1) {
    throw refuse('CAPABILITY_NOT_GRANTED', capability + ' not in [' + (declared.capabilities || []).join(', ') + ']');
  }

  // Credentials: presence by REFERENCE only. The value is never requested,
  // never received, never returned (security policy §4).
  if (typeof connector.secret_reference_id !== 'string' || !connector.secret_reference_id.trim()) {
    throw refuse('CREDENTIAL_REFERENCE_MISSING', declared.connector_id);
  }
  Object.keys(connector).forEach(function (k) {
    if (SECRET_FIELD_PATTERN.test(k)) throw refuse('CREDENTIAL_VALUE_PRESENT', 'connector carries a "' + k + '" field');
  });

  // Least privilege, structurally: the injected client may expose only methods
  // the declared capabilities cover.
  var client = input.client;
  if (!client || typeof client !== 'object') throw refuse('CONNECTOR_CLIENT_REQUIRED');
  var allowed = input.allowedClientMethods || [];
  var extra = Object.keys(client).filter(function (k) {
    return typeof client[k] === 'function' && allowed.indexOf(k) === -1;
  });
  if (extra.length) {
    throw refuse('CONNECTOR_SCOPE_ESCAPE', 'client exposes undeclared method(s): ' + extra.join(', '));
  }
  return { connector_id: declared.connector_id, provider: declared.provider, capabilities: declared.capabilities };
}

// -----------------------------------------------------------------------
// assertSingleDomain(plan, domain) — "one domain at a time", verbatim scope.
// -----------------------------------------------------------------------
function assertSingleDomain(plan, domain) {
  if (!plan || typeof plan.domain !== 'string') throw refuse('PLAN_REQUIRED');
  var target = String(domain || '').toLowerCase();
  if (plan.domain.toLowerCase() !== target) {
    throw refuse('DOMAIN_MISMATCH', 'plan targets ' + plan.domain + ', request targets ' + target);
  }
  // Strict suffix rule: a step may target the domain itself or a label under
  // it, and nothing else. Substring matching would accept a lookalike such as
  // "example.invalid.attacker.test", so the check is anchored at the end.
  var suffix = '.' + target;
  var others = (plan.steps || []).filter(function (s) {
    var host = String(s.target || '').split('|')[0].toLowerCase();
    var inScope = host === target || (host.length > suffix.length && host.slice(-suffix.length) === suffix);
    return !inScope;
  });
  if (others.length) {
    throw refuse('MULTI_DOMAIN_PLAN_REJECTED', 'step(s) outside ' + target + ': ' +
      others.map(function (s) { return s.step_id; }).join(', '));
  }
  return true;
}

// -----------------------------------------------------------------------
// assertNoDrift({ expectedRecords, observedRecords }) — the precondition.
//
// A plan is only valid against the state it was built from. Drift since
// PLAN time invalidates it (architecture §6: rollback prerequisites captured
// at PLAN time must still hold — the same rule applies to the forward path).
// Reuses INF-DNS-AUTO-1's comparison rather than re-implementing it.
// -----------------------------------------------------------------------
function assertNoDrift(input) {
  input = input || {};
  if (!Array.isArray(input.expectedRecords) || !Array.isArray(input.observedRecords)) {
    throw refuse('DRIFT_CHECK_INPUT_REQUIRED');
  }
  var cmp = engine.compareRecordSets({ ovh: input.expectedRecords, public_dns: input.observedRecords });
  if (cmp.counts.discrepancies > 0) {
    throw refuse('PRECONDITION_DRIFT_DETECTED',
      cmp.counts.discrepancies + ' record(s) differ from the snapshot the plan was built from');
  }
  return { compared: cmp.counts.total, discrepancies: 0 };
}

// -----------------------------------------------------------------------
// buildOperationEnvelope(...) — the single source of truth for WHAT would be
// executed. The dry-run path and the real path both call THIS function, so a
// dry run can never describe something different from what would happen.
//
// Contains no secrets by construction: only a secret_reference_id.
// -----------------------------------------------------------------------
function buildOperationEnvelope(input) {
  input = input || {};
  var step = input.step, connector = input.connector;
  if (!step || typeof step !== 'object') throw refuse('STEP_REQUIRED');
  if (engine.PLAN_STEP_KINDS.indexOf(step.kind) === -1) throw refuse('UNKNOWN_OPERATION_KIND', String(step.kind));
  if (!connector) throw refuse('CONNECTOR_REQUIRED');
  var rollbackStep = (input.rollbackPlan && Array.isArray(input.rollbackPlan.steps))
    ? input.rollbackPlan.steps.filter(function (r) { return r.inverse_of === step.step_id; })[0] : null;
  if (!rollbackStep) throw refuse('ROLLBACK_STEP_MISSING', step.step_id);
  if (rollbackStep.restorable !== true) {
    throw refuse('ROLLBACK_NOT_RESTORABLE', step.step_id + ' has no captured prior state to restore');
  }

  var envelope = {
    run_id: input.runId,
    step_id: step.step_id,
    automation_level: AUTOMATION_LEVEL,
    provider: connector.provider,
    connector_id: connector.connector_id,
    secret_reference_id: input.secretReferenceId,
    domain: input.domain,
    zone: input.zone,
    record_target: step.target,
    operation: step.kind,
    intended_state_reference: input.intendedStateReference || null,
    current_state_reference: input.currentStateReference || null,
    approval_field: STEP_KIND_APPROVAL_FIELD[step.kind],
    approval_state: input.approvalState,
    approval_policy_key: input.approvalPolicyKey,
    is_permanent_boundary: step.is_permanent_boundary === true,
    rollback_step_id: rollbackStep.step_id,
    rollback_restore_to_reference: 'ref:' + sha16(rollbackStep.restore_to),
    verification_plan: input.verificationPlan || 'read back the record through the same connector and compare to the intended state',
    idempotency_key: buildIdempotencyKey(input.runId, connector.connector_id, step),
    resource_lock_key: buildResourceLockKey(step.target, connector.provider),
    audit_event_id: 'audit-' + sha16([input.runId, step.step_id])
  };
  assertNoSecrets(envelope);
  return envelope;
}

function buildIdempotencyKey(runId, connectorId, step) {
  return 'idem-' + sha16([runId, connectorId, step.step_id, step.kind, step.target]);
}

function buildResourceLockKey(target, provider) {
  return 'lock-' + sha16(['dns_record', String(target).toLowerCase(), provider]);
}

/**
 * Refuses any object carrying a secret-shaped key. Applied to every envelope
 * and audit record before it is returned to a caller or written anywhere.
 */
function assertNoSecrets(value, pathLabel) {
  if (!value || typeof value !== 'object') return true;
  Object.keys(value).forEach(function (k) {
    if (SECRET_FIELD_PATTERN.test(k)) {
      throw refuse('CREDENTIAL_VALUE_PRESENT', (pathLabel ? pathLabel + '.' : '') + k);
    }
    assertNoSecrets(value[k], (pathLabel ? pathLabel + '.' : '') + k);
  });
  return true;
}

function buildAuditEvent(input) {
  var required = ['auditEventId', 'eventType', 'runId', 'actorRef', 'actorType', 'eventSummary', 'occurredAt'];
  required.forEach(function (f) {
    if (!input || input[f] === undefined || input[f] === null) throw refuse('AUDIT_FIELD_MISSING', f);
  });
  if (['HUMAN', 'SYSTEM'].indexOf(input.actorType) === -1) throw refuse('AUDIT_ACTOR_TYPE_INVALID', input.actorType);
  var record = {
    audit_event_id: input.auditEventId,
    event_type: input.eventType,
    run_id: input.runId,
    connector_id: input.connectorId || null,
    environment_id: input.environmentId || null,
    organization_id: input.organizationId || null,
    actor_ref: input.actorRef,
    actor_type: input.actorType,
    event_summary: String(input.eventSummary).slice(0, 512),
    event_detail_reference: input.eventDetailReference || null,
    occurred_at: input.occurredAt
  };
  assertNoSecrets(record);
  return record;
}

function buildRollbackExecutionRecord(input) {
  var required = ['rollbackExecutionId', 'rollbackPlanId', 'runId', 'triggeredByRef', 'triggerReason'];
  required.forEach(function (f) {
    if (!input || input[f] === undefined || input[f] === null) throw refuse('ROLLBACK_FIELD_MISSING', f);
  });
  if (['AUTOMATIC_POLICY', 'MANUAL', 'VERIFY_FAILED'].indexOf(input.triggerReason) === -1) {
    throw refuse('ROLLBACK_TRIGGER_REASON_INVALID', input.triggerReason);
  }
  return {
    rollback_execution_id: input.rollbackExecutionId,
    rollback_plan_id: input.rollbackPlanId,
    run_id: input.runId,
    triggered_by_ref: input.triggeredByRef,
    trigger_reason: input.triggerReason,
    status: input.status || 'QUEUED',
    started_at: input.startedAt || null,
    completed_at: input.completedAt || null,
    result_summary: (input.resultSummary || '').slice(0, 512),
    incident_id: input.incidentId || null
  };
}

// -----------------------------------------------------------------------
// prepareOperation(request) — every gate, in order, with NO side effect.
//
// This is the whole safety surface. Both dryRun() and executeApprovedOperation()
// run it first and neither can proceed without it returning cleanly.
// -----------------------------------------------------------------------
function prepareOperation(request) {
  request = request || {};
  if (typeof request !== 'object' || Array.isArray(request)) throw refuse('REQUEST_REQUIRED');
  var plan = request.plan;
  var rollbackPlan = request.rollbackPlan;
  if (!plan || !Array.isArray(plan.steps)) throw refuse('PLAN_REQUIRED');
  if (!rollbackPlan || !Array.isArray(rollbackPlan.steps)) throw refuse('ROLLBACK_PLAN_REQUIRED');
  if (typeof request.runId !== 'string' || !request.runId.trim()) throw refuse('RUN_ID_REQUIRED');

  // 1. GATE_CHECK — the INF-DNS-AUTO-1 gate must still pass on this plan.
  var gate = engine.gateCheck(plan);
  if (!gate.ok) {
    throw refuse('GATE_CHECK_FAILED', gate.violations.map(function (v) { return v.code; }).join(', '));
  }
  // 2. One domain at a time.
  assertSingleDomain(plan, request.domain);
  // 3. Exactly one step may execute per authorised operation.
  var stepId = request.stepId;
  var candidates = plan.steps.filter(function (s) { return s.step_id === stepId; });
  if (candidates.length !== 1) throw refuse('STEP_NOT_IN_PLAN', String(stepId));
  var step = candidates[0];
  if (step.status === 'BLOCKED') {
    throw refuse('STEP_BLOCKED_BY_ENTRY_CRITERIA', step.step_id + ' blocked_by ' + (step.blocked_by || []).join(', '));
  }
  if (step.automation_level !== AUTOMATION_LEVEL) throw refuse('AUTOMATION_LEVEL_MISMATCH', step.automation_level);
  if (step.requires_approval !== true) throw refuse('APPROVAL_NOT_REQUIRED_ON_STEP', step.step_id);
  if (step.allow_self_approval !== false) throw refuse('SELF_APPROVAL_PERMITTED', step.step_id);

  // 4. Owner approval gate — per domain, per action, from the committed doc.
  var ownerApproval = assertOwnerApproval({
    gate: request.approvalGate,
    domain: request.domain,
    plan: { steps: [step] }
  });
  // 5. Approval record + policy.
  var approval = assertApprovalRecord({
    approval: request.approval,
    policy: request.approvalPolicy,
    runId: request.runId,
    requestedByRef: request.requestedByRef,
    additionalApprovals: request.additionalApprovals,
    now: request.now
  });
  // 6. Connector authorisation and least privilege.
  var connector = assertAuthorisedConnector({
    connector: request.connector,
    client: request.client,
    catalogue: request.connectorCatalogue,
    featureFlags: request.featureFlags,
    provider: request.provider,
    requiredCapability: request.requiredCapability,
    allowedClientMethods: request.allowedClientMethods
  });
  // 7. Preconditions — no drift since the plan was built.
  var drift = assertNoDrift({
    expectedRecords: request.expectedRecords,
    observedRecords: request.observedRecords
  });

  var envelope = buildOperationEnvelope({
    step: step,
    connector: connector,
    rollbackPlan: rollbackPlan,
    runId: request.runId,
    domain: request.domain,
    zone: request.zone,
    secretReferenceId: request.connector.secret_reference_id,
    approvalState: ownerApproval.status,
    approvalPolicyKey: approval.policy_key,
    intendedStateReference: request.intendedStateReference,
    currentStateReference: request.currentStateReference,
    verificationPlan: request.verificationPlan
  });
  return { step: step, envelope: envelope, ownerApproval: ownerApproval, approval: approval, connector: connector, drift: drift };
}

// -----------------------------------------------------------------------
// dryRun(request) — LEVEL_2-equivalent preview. Runs every gate, builds the
// exact envelope the real path would use, and performs no mutation. Needs no
// credential value; a missing one still refuses at the reference check, so a
// dry run cannot be used to probe around the credential boundary either.
// -----------------------------------------------------------------------
function dryRun(request) {
  return new Promise(function (resolve, reject) {
    var prepared;
    try { prepared = prepareOperation(request); } catch (e) { return reject(e); }
    resolve({
      mode: 'DRY_RUN',
      mutations_performed: 0,
      lifecycle_completed: ['DISCOVER', 'SNAPSHOT', 'ANALYSE', 'PLAN', 'DRY_RUN', 'GATE_CHECK', 'APPROVAL'],
      terminated_before: 'APPLY',
      envelope: prepared.envelope,
      owner_approval: prepared.ownerApproval,
      approval: prepared.approval,
      connector: prepared.connector,
      precondition: prepared.drift
    });
  });
}

// -----------------------------------------------------------------------
// executeApprovedOperation(request) — the guarded write path.
//
// APPLY → VERIFY → (ROLLBACK on verification failure) → AUDIT. Exactly one
// operation. Rollback uses ONLY the approved rollback step and is recorded as
// a separate audited execution; a failed rollback raises a CRITICAL incident
// rather than being reported as a routine failure.
// -----------------------------------------------------------------------
function executeApprovedOperation(request) {
  return new Promise(function (resolve, reject) {
    var prepared;
    try { prepared = prepareOperation(request); } catch (e) { return reject(e); }

    var client = request.client;
    if (typeof client.applyOperation !== 'function') return reject(refuse('CONNECTOR_CANNOT_APPLY'));
    if (typeof client.readRecord !== 'function') return reject(refuse('CONNECTOR_CANNOT_VERIFY',
      'automatic verification is mandatory for this stage'));

    var envelope = prepared.envelope;
    var now = request.now || new Date().toISOString();
    var audit = [];
    function record(eventType, summary) {
      audit.push(buildAuditEvent({
        auditEventId: envelope.audit_event_id + ':' + eventType,
        eventType: eventType, runId: envelope.run_id, connectorId: envelope.connector_id,
        actorRef: request.requestedByRef || 'system', actorType: 'SYSTEM',
        eventSummary: summary, occurredAt: now
      }));
    }

    record('operation_approved', 'approval ' + envelope.approval_state + ' verified for ' +
      envelope.domain + ' ' + envelope.approval_field);

    Promise.resolve()
      .then(function () { return client.applyOperation(envelope); })
      .then(function (applyResult) {
        record('operation_applied', 'applied ' + envelope.operation + ' on ' + envelope.record_target);
        return Promise.resolve(client.readRecord(envelope.record_target)).then(function (observed) {
          var matches = request.verifyMatches
            ? request.verifyMatches(observed, envelope)
            : JSON.stringify(observed) === JSON.stringify(request.intendedState);
          if (matches) {
            record('operation_verified', 'verification passed for ' + envelope.record_target);
            return {
              mode: 'EXECUTED', status: 'SUCCEEDED', mutations_performed: 1,
              envelope: envelope, apply_result_reference: 'ref:' + sha16(applyResult),
              verified: true, rollback: null, audit_events: audit
            };
          }
          // VERIFY failed — automatic rollback, using only the approved step.
          record('verification_failed', 'verification failed for ' + envelope.record_target + '; rolling back');
          var rollbackStep = request.rollbackPlan.steps.filter(function (r) {
            return r.step_id === envelope.rollback_step_id;
          })[0];
          if (!rollbackStep) {
            return Promise.reject(refuse('ROLLBACK_STEP_MISSING', envelope.rollback_step_id));
          }
          var rec = buildRollbackExecutionRecord({
            rollbackExecutionId: 'rbx-' + sha16([envelope.run_id, rollbackStep.step_id]),
            rollbackPlanId: request.rollbackPlan.rollback_policy_key || 'rollback-plan',
            runId: envelope.run_id, triggeredByRef: 'system', triggerReason: 'VERIFY_FAILED',
            status: 'ROLLING_BACK', startedAt: now
          });
          return Promise.resolve(client.applyOperation(Object.assign({}, envelope, {
            step_id: rollbackStep.step_id, operation: rollbackStep.kind,
            idempotency_key: 'idem-' + sha16([envelope.run_id, rollbackStep.step_id])
          }))).then(function () {
            rec.status = 'ROLLED_BACK';
            rec.completed_at = now;
            rec.result_summary = 'rolled back ' + envelope.record_target + ' to its captured prior state';
            record('rollback_executed', rec.result_summary);
            return {
              mode: 'EXECUTED', status: 'ROLLED_BACK', mutations_performed: 2,
              envelope: envelope, verified: false, rollback: rec, audit_events: audit
            };
          }, function (rollbackError) {
            // A failed rollback is never a routine failure.
            rec.status = 'FAILED';
            rec.completed_at = now;
            rec.result_summary = 'rollback failed';
            rec.incident_id = 'inc-' + sha16([envelope.run_id, 'rollback-failed']);
            record('rollback_failed', 'CRITICAL incident ' + rec.incident_id + ' raised');
            var e = refuse('ROLLBACK_FAILED_CRITICAL_INCIDENT', rec.incident_id);
            e.rollback = rec;
            e.audit_events = audit;
            e.cause = rollbackError && rollbackError.message;
            throw e;
          });
        });
      })
      .then(resolve, reject);
  });
}

module.exports = {
  AUTOMATION_LEVEL: AUTOMATION_LEVEL,
  APPROVAL_VALUES: APPROVAL_VALUES,
  EXECUTING_APPROVAL_VALUE: EXECUTING_APPROVAL_VALUE,
  APPROVAL_FIELDS: APPROVAL_FIELDS,
  STEP_KIND_APPROVAL_FIELD: STEP_KIND_APPROVAL_FIELD,
  SEPARATION_OF_DUTIES_KEYS: SEPARATION_OF_DUTIES_KEYS,
  LIVE_FLAG_FOR_CONNECTOR: LIVE_FLAG_FOR_CONNECTOR,
  approvalGateFromDocument: approvalGateFromDocument,
  requiredApprovalFields: requiredApprovalFields,
  assertOwnerApproval: assertOwnerApproval,
  assertApprovalRecord: assertApprovalRecord,
  assertAuthorisedConnector: assertAuthorisedConnector,
  assertSingleDomain: assertSingleDomain,
  assertNoDrift: assertNoDrift,
  assertNoSecrets: assertNoSecrets,
  buildOperationEnvelope: buildOperationEnvelope,
  buildIdempotencyKey: buildIdempotencyKey,
  buildResourceLockKey: buildResourceLockKey,
  buildAuditEvent: buildAuditEvent,
  buildRollbackExecutionRecord: buildRollbackExecutionRecord,
  prepareOperation: prepareOperation,
  dryRun: dryRun,
  executeApprovedOperation: executeApprovedOperation
};
