'use strict';
// =====================================================
// Mythos Automation & Operations — GitHub → Coolify STAGING Delivery
// (INF-DEPLOY-AUTO-0)
// projects/automation/reference/staging-deployment-executor.js
//
// Contract: docs/AUTOMATION_ROADMAP.md §"INF-DEPLOY-AUTO-0", ratified by owner
// decisions O-DEPLOY-1 (scope: STAGING ONLY), O-DEPLOY-2 (no production
// release policy is authorised), and O-DEPLOY-3 (connector split).
//
// PRODUCTION IS STRUCTURALLY UNREACHABLE FROM THIS MODULE.
// There is no parameter, flag, environment variable or argument that can make
// it target production: the environment key is a CONSTANT, the target must
// prove itself staging through TWO agreeing independent sources, and any
// production signal anywhere in the request is an immediate refusal.
//
// WHY THE TWO-SOURCE PROOF EXISTS (a real observation, not a hypothetical):
// on this host the Coolify application running images tagged
// `mythos-staging-web:local` / `mythos-staging-app:local` is labelled by
// Coolify itself as `coolify.environmentName=production`, project
// `darhijama`, application id 3 — and a separate non-Coolify production stack
// (`dar-hijama-production-*`) runs alongside it. An image tag, a container
// name, or any other convenient string is therefore NOT evidence of
// environment. Only a declared environment record corroborated by the
// platform's own metadata counts, and any disagreement between them is a
// refusal rather than something to resolve.
//
// This module never constructs a provider client, never performs a network
// call, never reads a credential value, and never executes a shell command —
// a client is injected by the caller, exactly as every other connector in
// this track requires.
// =====================================================

var crypto = require('crypto');

var AUTOMATION_LEVEL = 'LEVEL_3_APPROVAL_REQUIRED';
var PLAN_LEVEL = 'LEVEL_2_RECOMMEND';

// O-DEPLOY-1: staging only. A CONSTANT — not a parameter, not configurable.
var ENVIRONMENT_KEY = 'staging';

// O-DEPLOY-1: the existing Mythos repository only.
var AUTHORISED_REPOSITORY = 'othoth77/mythos-prod';

// O-DEPLOY-3: the only connector permitted to deploy, and the only capability
// it may use. `deployment.trigger` alone is environment-agnostic and is
// deliberately NOT accepted — a staging-scoped grant is required.
var DEPLOY_CONNECTOR_ID = 'coolify_deployer';
var REQUIRED_DEPLOY_CAPABILITY = 'deployment.trigger.staging';
var DEPLOY_LIVE_FLAG = 'connector_coolify_deployer_live';

// O-DEPLOY-3: source-control connector and its permitted operations.
var SOURCE_CONNECTOR_ID = 'github_repository';
var ALLOWED_GIT_OPERATIONS = ['read', 'commit', 'branch', 'remote'];
var FORBIDDEN_GIT_OPERATIONS = ['force_push', 'history_rewrite', 'reset_hard', 'tag_delete', 'branch_delete'];

// Any of these appearing as an environment signal is an immediate refusal.
var PRODUCTION_TOKENS = ['production', 'prod', 'live', 'prd'];

// Secret-shaped keys. Presence alone is a refusal — values are never handled.
var SECRET_FIELD_PATTERN = /^(api[_-]?key|apikey|api[_-]?token|token|secret|password|passwd|private[_-]?key|credential|ssh[_-]?key|access[_-]?token|authorization)$/i;

// A git ref must be an ordinary ref. This rejects path traversal, absolute
// paths, option injection, command substitution and whitespace tricks.
var SAFE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/;

function refuse(code, detail) {
  var e = new Error('STAGING_DEPLOY_EXECUTOR: ' + code + (detail ? ' — ' + detail : ''));
  e.refused = true;
  e.code = code;
  return e;
}

function sha16(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

// Tokenised on every non-alphanumeric boundary rather than matched as a
// substring, so `deployment.trigger.production`, `mythos-prod` and
// `app_production` are all caught while `staging` is not. A substring or
// prefix/suffix check misses dot-separated capability names — that gap was
// found by test and is the reason this is tokenised.
function looksProduction(value) {
  if (typeof value !== 'string') return false;
  var tokens = value.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some(function (tok) { return PRODUCTION_TOKENS.indexOf(tok) !== -1; });
}

/**
 * Refuses any object carrying a secret-shaped key, at any depth. Applied to
 * every envelope and audit record before it leaves this module.
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

// -----------------------------------------------------------------------
// assertStagingEnvironment(environment) — the declared side of the proof.
//
// An `aut_environments` record must declare itself staging, non-production
// and enabled. `is_production` is checked independently of `environment_key`
// so a record cannot claim to be staging while flagged production.
// -----------------------------------------------------------------------
function assertStagingEnvironment(environment) {
  if (!environment || typeof environment !== 'object') throw refuse('ENVIRONMENT_RECORD_REQUIRED');
  if (environment.environment_key !== ENVIRONMENT_KEY) {
    throw refuse('ENVIRONMENT_NOT_STAGING',
      'declared environment_key is "' + String(environment.environment_key) + '", this stage deploys only to "' + ENVIRONMENT_KEY + '"');
  }
  if (environment.is_production !== false) {
    throw refuse('ENVIRONMENT_FLAGGED_PRODUCTION',
      'is_production must be exactly false; got ' + JSON.stringify(environment.is_production));
  }
  if (environment.enabled !== true) throw refuse('ENVIRONMENT_DISABLED', String(environment.environment_id));
  if (typeof environment.environment_id !== 'string' || !environment.environment_id.trim()) {
    throw refuse('ENVIRONMENT_ID_REQUIRED');
  }
  return { environment_id: environment.environment_id, environment_key: environment.environment_key };
}

// -----------------------------------------------------------------------
// assertTargetIsStaging({ target, environment, platformReported })
//
// The two-source proof. The declared record and the platform's own metadata
// must BOTH say staging, and must agree with each other. Image tags, container
// names and resource names are explicitly rejected as evidence.
// -----------------------------------------------------------------------
function assertTargetIsStaging(input) {
  input = input || {};
  var target = input.target, platform = input.platformReported;
  if (!target || typeof target !== 'object') throw refuse('DEPLOY_TARGET_REQUIRED');
  if (typeof target.application_id !== 'string' || !target.application_id.trim()) {
    throw refuse('APPLICATION_ID_REQUIRED');
  }
  var env = assertStagingEnvironment(input.environment);
  if (target.environment_id !== env.environment_id) {
    throw refuse('TARGET_ENVIRONMENT_MISMATCH',
      'target is bound to ' + String(target.environment_id) + ', declared environment is ' + env.environment_id);
  }
  if (!platform || typeof platform !== 'object') {
    throw refuse('PLATFORM_ENVIRONMENT_UNVERIFIED',
      'the platform must independently report the environment; an unverified target is never assumed staging');
  }
  if (platform.application_id !== target.application_id) {
    throw refuse('PLATFORM_TARGET_MISMATCH',
      'platform reported application ' + String(platform.application_id) + ', request targets ' + target.application_id);
  }
  var reported = typeof platform.environment_name === 'string' ? platform.environment_name.trim().toLowerCase() : null;
  if (!reported) {
    throw refuse('PLATFORM_ENVIRONMENT_UNVERIFIED', 'platform reported no environment name');
  }
  if (looksProduction(reported)) {
    // The exact condition observed on this host: images tagged "staging" on an
    // application the platform itself labels production.
    throw refuse('PLATFORM_REPORTS_PRODUCTION',
      'the platform reports environment "' + platform.environment_name + '" for application ' +
      target.application_id + '; a staging-looking image tag or name is NOT evidence of environment');
  }
  if (reported !== ENVIRONMENT_KEY) {
    throw refuse('ENVIRONMENT_PROOF_DISAGREEMENT',
      'declared "' + env.environment_key + '" but platform reports "' + platform.environment_name + '"');
  }
  return { application_id: target.application_id, environment_id: env.environment_id, proof: 'declared+platform' };
}

// -----------------------------------------------------------------------
// assertSourceScope({ repository, ref, operation }) — O-DEPLOY-3, GitHub side.
// -----------------------------------------------------------------------
function assertSourceScope(input) {
  input = input || {};
  if (input.repository !== AUTHORISED_REPOSITORY) {
    throw refuse('REPOSITORY_NOT_AUTHORISED',
      'this stage may deploy only ' + AUTHORISED_REPOSITORY + '; got ' + String(input.repository));
  }
  var op = input.operation || 'read';
  if (FORBIDDEN_GIT_OPERATIONS.indexOf(op) !== -1) {
    throw refuse('GIT_OPERATION_FORBIDDEN', op + ' is prohibited by O-DEPLOY-3');
  }
  if (ALLOWED_GIT_OPERATIONS.indexOf(op) === -1) {
    throw refuse('GIT_OPERATION_UNKNOWN', String(op));
  }
  var ref = input.ref;
  if (typeof ref !== 'string' || !SAFE_REF_PATTERN.test(ref)) {
    throw refuse('GIT_REF_INVALID', 'ref must match a safe ref pattern; got ' + JSON.stringify(ref));
  }
  if (ref.indexOf('..') !== -1) throw refuse('GIT_REF_INVALID', 'path traversal in ref');
  return { repository: input.repository, ref: ref, operation: op };
}

// -----------------------------------------------------------------------
// assertDeployConnector({ connector, client, catalogue, featureFlags })
// O-DEPLOY-3, Coolify side. Least privilege, staging-scoped, by reference.
// -----------------------------------------------------------------------
function assertDeployConnector(input) {
  input = input || {};
  var connector = input.connector, catalogue = input.catalogue, flags = input.featureFlags || {};
  if (!connector || typeof connector !== 'object') throw refuse('CONNECTOR_REQUIRED');
  if (!Array.isArray(catalogue)) throw refuse('CONNECTOR_CATALOGUE_REQUIRED');
  if (connector.connector_id !== DEPLOY_CONNECTOR_ID) {
    throw refuse('CONNECTOR_NOT_AUTHORISED',
      'only ' + DEPLOY_CONNECTOR_ID + ' may deploy; got ' + String(connector.connector_id));
  }
  var declared = catalogue.filter(function (c) { return c.connector_id === DEPLOY_CONNECTOR_ID; })[0];
  if (!declared) throw refuse('CONNECTOR_NOT_IN_CATALOGUE', DEPLOY_CONNECTOR_ID);
  if (declared.enabled !== true) throw refuse('CONNECTOR_DISABLED', DEPLOY_CONNECTOR_ID);
  if (flags[DEPLOY_LIVE_FLAG] !== true) throw refuse('CONNECTOR_NOT_LIVE', DEPLOY_LIVE_FLAG + ' is not true');
  if (flags.level_3_approval_required_runs !== true) {
    throw refuse('LEVEL_3_RUNS_DISABLED', 'level_3_approval_required_runs is not true');
  }
  // A staging-scoped grant is mandatory. The environment-agnostic
  // `deployment.trigger` is deliberately insufficient (O-DEPLOY-3: no
  // production deployment capability in this stage).
  if ((declared.capabilities || []).indexOf(REQUIRED_DEPLOY_CAPABILITY) === -1) {
    throw refuse('STAGING_CAPABILITY_NOT_GRANTED',
      REQUIRED_DEPLOY_CAPABILITY + ' not in [' + (declared.capabilities || []).join(', ') +
      ']; an environment-agnostic deployment capability is not sufficient');
  }
  (declared.capabilities || []).forEach(function (c) {
    if (looksProduction(c)) throw refuse('PRODUCTION_CAPABILITY_PRESENT', c);
  });
  if (typeof connector.secret_reference_id !== 'string' || !connector.secret_reference_id.trim()) {
    throw refuse('CREDENTIAL_REFERENCE_MISSING', DEPLOY_CONNECTOR_ID);
  }
  Object.keys(connector).forEach(function (k) {
    if (SECRET_FIELD_PATTERN.test(k)) throw refuse('CREDENTIAL_VALUE_PRESENT', 'connector carries a "' + k + '" field');
  });
  var client = input.client;
  if (!client || typeof client !== 'object') throw refuse('CONNECTOR_CLIENT_REQUIRED');
  var allowed = input.allowedClientMethods || [];
  var extra = Object.keys(client).filter(function (k) {
    return typeof client[k] === 'function' && allowed.indexOf(k) === -1;
  });
  if (extra.length) throw refuse('CONNECTOR_SCOPE_ESCAPE', 'client exposes undeclared method(s): ' + extra.join(', '));
  return { connector_id: DEPLOY_CONNECTOR_ID, capabilities: declared.capabilities };
}

// -----------------------------------------------------------------------
// assertApproval({ approval, policy, runId, requestedByRef, now })
// -----------------------------------------------------------------------
function assertApproval(input) {
  input = input || {};
  var a = input.approval, p = input.policy;
  var now = input.now ? new Date(input.now) : new Date();
  if (!a || typeof a !== 'object') throw refuse('APPROVAL_RECORD_REQUIRED');
  if (!p || typeof p !== 'object') throw refuse('APPROVAL_POLICY_REQUIRED');
  if (p.enabled !== true) throw refuse('APPROVAL_POLICY_DISABLED', String(p.policy_key));
  if (p.minimum_automation_level_covered !== AUTOMATION_LEVEL) {
    throw refuse('APPROVAL_LEVEL_INSUFFICIENT', String(p.minimum_automation_level_covered));
  }
  if (p.allow_self_approval !== false) throw refuse('SELF_APPROVAL_PERMITTED_BY_POLICY', String(p.policy_key));
  if (a.decision !== 'APPROVE') throw refuse('APPROVAL_NOT_GRANTED', String(a.decision));
  if (a.is_self_approval !== false) throw refuse('SELF_APPROVAL_REJECTED');
  if (typeof a.decided_by_ref !== 'string' || !a.decided_by_ref.trim()) throw refuse('APPROVER_REFERENCE_REQUIRED');
  if (input.requestedByRef && a.decided_by_ref === input.requestedByRef) {
    throw refuse('SELF_APPROVAL_REJECTED', 'requester and approver are the same reference');
  }
  if (a.run_id !== input.runId) throw refuse('APPROVAL_RUN_MISMATCH', 'approval is bound to ' + String(a.run_id));
  if (a.expires_at !== null && a.expires_at !== undefined && new Date(a.expires_at) <= now) {
    throw refuse('APPROVAL_EXPIRED');
  }
  return { policy_key: p.policy_key, approver: a.decided_by_ref };
}

// -----------------------------------------------------------------------
// buildDeploymentPlan(request) -> deterministic, secret-free plan.
// -----------------------------------------------------------------------
function buildDeploymentPlan(request) {
  request = request || {};
  var source = assertSourceScope({
    repository: request.repository, ref: request.ref, operation: 'read'
  });
  if (typeof request.rollbackRevision !== 'string' || !request.rollbackRevision.trim()) {
    throw refuse('ROLLBACK_REVISION_REQUIRED',
      'a deployment whose rollback target is unknown is refused at plan time');
  }
  if (!SAFE_REF_PATTERN.test(request.rollbackRevision)) {
    throw refuse('ROLLBACK_REVISION_INVALID');
  }
  var plan = {
    automation_level: PLAN_LEVEL,
    execution_level: AUTOMATION_LEVEL,
    authorises_execution: false,
    environment_key: ENVIRONMENT_KEY,
    repository: source.repository,
    ref: source.ref,
    application_id: request.target && request.target.application_id,
    steps: [
      { step_id: 'deploy-001', sequence: 1, kind: 'staging_deploy',
        description: 'Trigger a Coolify staging deployment of ' + source.repository + '@' + source.ref,
        requires_approval: true, allow_self_approval: false },
      { step_id: 'verify-001', sequence: 2, kind: 'staging_verify',
        description: 'Read back the deployed revision and compare to the requested ref',
        requires_approval: false, allow_self_approval: false }
    ],
    rollback: {
      kind: 'staging_redeploy_previous',
      restore_to_revision: request.rollbackRevision,
      is_automatic_eligible: true,
      note: 'staging only; a production rollback path does not exist in this stage'
    }
  };
  assertNoSecrets(plan);
  return plan;
}

// -----------------------------------------------------------------------
// preflight(request) — every gate, in order, with NO side effect.
// -----------------------------------------------------------------------
function preflight(request) {
  request = request || {};
  if (typeof request !== 'object' || Array.isArray(request)) throw refuse('REQUEST_REQUIRED');
  if (typeof request.runId !== 'string' || !request.runId.trim()) throw refuse('RUN_ID_REQUIRED');

  // Any production signal anywhere in the request refuses before anything else.
  ['environmentKeyOverride', 'targetEnvironment', 'promoteTo'].forEach(function (k) {
    if (request[k] !== undefined) {
      throw refuse('PRODUCTION_PROMOTION_FORBIDDEN',
        '"' + k + '" does not exist in this stage; there is no promotion mechanism and no environment selector');
    }
  });
  if (request.env !== undefined || request.environmentVariables !== undefined) {
    throw refuse('ENVIRONMENT_SMUGGLING_REFUSED',
      'this stage never injects environment variables into a deployment');
  }
  if (request.command !== undefined || request.script !== undefined || request.shell !== undefined) {
    throw refuse('ARBITRARY_COMMAND_REFUSED', 'this stage triggers a declared deployment, it never runs a command');
  }

  var plan = buildDeploymentPlan(request);
  var targetProof = assertTargetIsStaging({
    target: request.target, environment: request.environment, platformReported: request.platformReported
  });
  var connector = assertDeployConnector({
    connector: request.connector, client: request.client,
    catalogue: request.connectorCatalogue, featureFlags: request.featureFlags,
    allowedClientMethods: request.allowedClientMethods
  });
  var approval = assertApproval({
    approval: request.approval, policy: request.approvalPolicy,
    runId: request.runId, requestedByRef: request.requestedByRef, now: request.now
  });

  var envelope = {
    run_id: request.runId,
    automation_level: AUTOMATION_LEVEL,
    environment_key: ENVIRONMENT_KEY,
    environment_id: targetProof.environment_id,
    environment_proof: targetProof.proof,
    application_id: targetProof.application_id,
    connector_id: connector.connector_id,
    secret_reference_id: request.connector.secret_reference_id,
    repository: plan.repository,
    ref: plan.ref,
    operation: 'staging_deploy',
    approval_policy_key: approval.policy_key,
    rollback_revision: plan.rollback.restore_to_revision,
    verification_plan: 'read back the deployed revision through the same connector and compare to the requested ref',
    idempotency_key: 'idem-' + sha16([request.runId, connector.connector_id, targetProof.application_id, plan.ref]),
    resource_lock_key: 'lock-' + sha16(['coolify_application', targetProof.application_id]),
    audit_event_id: 'audit-' + sha16([request.runId, targetProof.application_id])
  };
  assertNoSecrets(envelope);
  return { plan: plan, envelope: envelope, target: targetProof, connector: connector, approval: approval };
}

function dryRun(request) {
  return new Promise(function (resolve, reject) {
    var prepared;
    try { prepared = preflight(request); } catch (e) { return reject(e); }
    resolve({
      mode: 'DRY_RUN', mutations_performed: 0, deployments_performed: 0,
      lifecycle_completed: ['DISCOVER', 'SNAPSHOT', 'ANALYSE', 'PLAN', 'DRY_RUN', 'GATE_CHECK', 'APPROVAL'],
      terminated_before: 'APPLY',
      plan: prepared.plan, envelope: prepared.envelope, target: prepared.target
    });
  });
}

function buildAuditEvent(input) {
  var required = ['auditEventId', 'eventType', 'runId', 'actorRef', 'actorType', 'eventSummary', 'occurredAt'];
  required.forEach(function (f) {
    if (!input || input[f] === undefined || input[f] === null) throw refuse('AUDIT_FIELD_MISSING', f);
  });
  if (['HUMAN', 'SYSTEM'].indexOf(input.actorType) === -1) throw refuse('AUDIT_ACTOR_TYPE_INVALID', String(input.actorType));
  var record = {
    audit_event_id: input.auditEventId, event_type: input.eventType, run_id: input.runId,
    connector_id: input.connectorId || null, environment_id: input.environmentId || null,
    actor_ref: input.actorRef, actor_type: input.actorType,
    event_summary: String(input.eventSummary).slice(0, 512),
    event_detail_reference: input.eventDetailReference || null,
    occurred_at: input.occurredAt
  };
  assertNoSecrets(record);
  return record;
}

// -----------------------------------------------------------------------
// executeStagingDeployment(request) — the guarded write path.
// APPLY → VERIFY → (ROLLBACK on verification failure) → AUDIT.
// -----------------------------------------------------------------------
function executeStagingDeployment(request) {
  return new Promise(function (resolve, reject) {
    var prepared;
    try { prepared = preflight(request); } catch (e) { return reject(e); }
    var client = request.client;
    if (typeof client.triggerStagingDeployment !== 'function') return reject(refuse('CONNECTOR_CANNOT_DEPLOY'));
    if (typeof client.readDeployedRevision !== 'function') {
      return reject(refuse('CONNECTOR_CANNOT_VERIFY', 'automatic verification is mandatory for this stage'));
    }
    var envelope = prepared.envelope;
    var now = request.now || new Date().toISOString();
    var audit = [];
    function record(eventType, summary) {
      audit.push(buildAuditEvent({
        auditEventId: envelope.audit_event_id + ':' + eventType, eventType: eventType,
        runId: envelope.run_id, connectorId: envelope.connector_id, environmentId: envelope.environment_id,
        actorRef: request.requestedByRef || 'system', actorType: 'SYSTEM',
        eventSummary: summary, occurredAt: now
      }));
    }
    record('staging_deploy_approved', 'approved staging deployment of ' + envelope.repository + '@' + envelope.ref +
      ' to application ' + envelope.application_id + ' (environment proof: ' + envelope.environment_proof + ')');

    Promise.resolve()
      .then(function () { return client.triggerStagingDeployment(envelope); })
      .then(function (applyResult) {
        record('staging_deploy_applied', 'deployment triggered for application ' + envelope.application_id);
        return Promise.resolve(client.readDeployedRevision(envelope.application_id)).then(function (deployed) {
          if (deployed === envelope.ref) {
            record('staging_deploy_verified', 'verified ' + envelope.ref + ' is live on staging');
            return {
              mode: 'EXECUTED', status: 'SUCCEEDED', deployments_performed: 1, mutations_performed: 1,
              envelope: envelope, apply_result_reference: 'ref:' + sha16(applyResult),
              verified: true, rollback: null, audit_events: audit
            };
          }
          record('verification_failed', 'expected ' + envelope.ref + ', staging reports ' + String(deployed) + '; rolling back');
          return Promise.resolve(client.triggerStagingDeployment(Object.assign({}, envelope, {
            ref: envelope.rollback_revision, operation: 'staging_rollback',
            idempotency_key: 'idem-' + sha16([envelope.run_id, 'rollback', envelope.rollback_revision])
          }))).then(function () {
            record('rollback_executed', 'rolled staging back to ' + envelope.rollback_revision);
            return {
              mode: 'EXECUTED', status: 'ROLLED_BACK', deployments_performed: 2, mutations_performed: 2,
              envelope: envelope, verified: false,
              rollback: { status: 'ROLLED_BACK', trigger_reason: 'VERIFY_FAILED',
                restored_to: envelope.rollback_revision, run_id: envelope.run_id },
              audit_events: audit
            };
          }, function (rollbackError) {
            record('rollback_failed', 'CRITICAL incident raised');
            var e = refuse('ROLLBACK_FAILED_CRITICAL_INCIDENT', 'inc-' + sha16([envelope.run_id, 'rollback-failed']));
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
  PLAN_LEVEL: PLAN_LEVEL,
  ENVIRONMENT_KEY: ENVIRONMENT_KEY,
  AUTHORISED_REPOSITORY: AUTHORISED_REPOSITORY,
  DEPLOY_CONNECTOR_ID: DEPLOY_CONNECTOR_ID,
  SOURCE_CONNECTOR_ID: SOURCE_CONNECTOR_ID,
  REQUIRED_DEPLOY_CAPABILITY: REQUIRED_DEPLOY_CAPABILITY,
  ALLOWED_GIT_OPERATIONS: ALLOWED_GIT_OPERATIONS,
  FORBIDDEN_GIT_OPERATIONS: FORBIDDEN_GIT_OPERATIONS,
  PRODUCTION_TOKENS: PRODUCTION_TOKENS,
  looksProduction: looksProduction,
  assertNoSecrets: assertNoSecrets,
  assertStagingEnvironment: assertStagingEnvironment,
  assertTargetIsStaging: assertTargetIsStaging,
  assertSourceScope: assertSourceScope,
  assertDeployConnector: assertDeployConnector,
  assertApproval: assertApproval,
  buildDeploymentPlan: buildDeploymentPlan,
  buildAuditEvent: buildAuditEvent,
  preflight: preflight,
  dryRun: dryRun,
  executeStagingDeployment: executeStagingDeployment
};
