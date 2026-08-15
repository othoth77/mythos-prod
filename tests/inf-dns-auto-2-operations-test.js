'use strict';
// =====================================================
// MYTHOS — Stage INF-DNS-AUTO-2 approved DNS operations tests
// tests/inf-dns-auto-2-operations-test.js
//
// Deterministic and fully offline. No live credential, no network call, no
// DNS mutation. The provider client is always a mock; the "applied" state
// lives in a plain object. The two real files read are the committed owner
// approval gate and the committed automation config — so the gates are tested
// against the repository's actual state, not a convenient fixture.
//
// Run with: node tests/inf-dns-auto-2-operations-test.js
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

var EXEC_PATH = path.join(BASE, 'projects', 'automation', 'reference', 'dns-operations-executor.js');
var exec = require(EXEC_PATH);
var engine = require(path.join(BASE, 'projects', 'automation', 'reference', 'dns-comparison-engine.js'));
var GATE_DOC = fs.readFileSync(path.join(BASE, 'docs', 'CLOUDFLARE_OWNER_APPROVAL_GATE.md'), 'utf8');
var AUT_CONFIG = JSON.parse(fs.readFileSync(path.join(BASE, 'projects', 'automation', 'config', 'automation.example.json'), 'utf8'));
var CATALOGUE = AUT_CONFIG.connector_catalogue.infrastructure;

var DOMAIN = 'example.invalid';
var RUN = 'run-001';

// A plan produced by INF-DNS-AUTO-1 — never hand-written here.
function makePlan(over) {
  over = over || {};
  return engine.generateMigrationPlan({
    domain: over.domain || DOMAIN,
    records: over.records || [{ name: DOMAIN, type: 'A', value: '203.0.113.1',
      proposedCloudflareMode: 'DNS_ONLY', migrationAction: 'RECREATE_EXACTLY' }],
    dnssec: over.dnssec || {},
    nameserverChangePlanned: over.nameserverChangePlanned === true
  });
}
function makeRollback(plan) {
  return engine.generateRollbackPlan(plan, {
    priorState: { nameservers: ['ns1.tn.ovh.net'], dnssecStatus: 'ENABLED',
      records: { 'example.invalid|A': '203.0.113.1' } }
  });
}
// A hypothetical fully-approved world, used ONLY to prove the accept path and
// then to prove each individual gate by removing one thing at a time. None of
// this exists in the repository — that is the point of section 10.
function approvedGate(over) {
  var entry = {};
  exec.APPROVAL_FIELDS.forEach(function (f) { entry[f] = 'APPROVED_FOR_MIGRATION'; });
  return { 'example.invalid': Object.assign(entry, over || {}) };
}
function approvalRecord(over) {
  return Object.assign({
    approval_id: 'apr-1', run_id: RUN, approval_policy_id: 'pol-1', decision: 'APPROVE',
    decided_by_ref: 'owner-ref-A', is_self_approval: false,
    decided_at: '2026-08-15T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', reason: 'approved'
  }, over || {});
}
function approvalPolicy(over) {
  return Object.assign({
    approval_policy_id: 'pol-1', policy_key: 'domain_nameserver_changes',
    display_name: 'DNS nameserver change', required_approval_count: 1,
    allow_self_approval: false, approval_expiry_seconds: 3600,
    minimum_automation_level_covered: 'LEVEL_3_APPROVAL_REQUIRED',
    is_permanent_boundary: true, enabled: true
  }, over || {});
}
function liveFlags(over) {
  return Object.assign({
    level_3_approval_required_runs: true,
    connector_ovh_dns_operator_live: true,
    connector_cloudflare_dns_operator_live: true
  }, over || {});
}
function enabledCatalogue() {
  return CATALOGUE.map(function (c) {
    return c.connector_id === 'ovh_dns_operator' ? Object.assign({}, c, { enabled: true }) : c;
  });
}
var RECORDS = [{ name: DOMAIN, type: 'A', value: '203.0.113.1' }];
function mockClient(state, opts) {
  opts = opts || {};
  return {
    applyOperation: function (envelope) {
      if (opts.applyThrows) return Promise.reject(new Error('provider unavailable'));
      state.applied.push(envelope);
      state.value = opts.writesWrongValue ? '198.51.100.9' : '203.0.113.1';
      return Promise.resolve({ ok: true });
    },
    readRecord: function () { return Promise.resolve(state.value); }
  };
}
function baseRequest(over) {
  var plan = (over && over.plan) || makePlan();
  var rollbackPlan = (over && over.rollbackPlan) || makeRollback(plan);
  var state = { applied: [], value: null };
  return Object.assign({
    _state: state,
    plan: plan, rollbackPlan: rollbackPlan, runId: RUN, domain: DOMAIN, zone: DOMAIN,
    stepId: plan.steps[0].step_id,
    approvalGate: approvedGate(), approval: approvalRecord(), approvalPolicy: approvalPolicy(),
    requestedByRef: 'operator-ref-B',
    connector: { connector_id: 'ovh_dns_operator', secret_reference_id: 'secref-ovh-dns-1' },
    connectorCatalogue: enabledCatalogue(), featureFlags: liveFlags(),
    provider: 'OVHcloud', requiredCapability: 'dns.write',
    allowedClientMethods: ['applyOperation', 'readRecord'],
    client: mockClient(state),
    expectedRecords: RECORDS, observedRecords: RECORDS,
    intendedState: '203.0.113.1',
    now: '2026-08-15T12:00:00Z'
  }, over || {});
}

(async function main() {

console.log('\n1. THE REAL REPOSITORY STATE — no approval exists');
(function () {
  var gate = exec.approvalGateFromDocument(GATE_DOC);
  var domains = Object.keys(gate);
  ok(domains.length === 8, '1 the committed approval gate parses to all eight portfolio domains');
  var values = {};
  domains.forEach(function (d) { exec.APPROVAL_FIELDS.forEach(function (f) { values[gate[d][f]] = true; }); });
  ok(Object.keys(values).length === 1 && values.NOT_REQUESTED === true,
    '2 every approval field of every domain is NOT_REQUESTED — 40/40, no exceptions');
  ok(!Object.keys(gate).some(function (d) {
    return exec.APPROVAL_FIELDS.some(function (f) { return gate[d][f] === 'APPROVED_FOR_MIGRATION'; });
  }), '3 no domain carries APPROVED_FOR_MIGRATION for any action — real execution is gated shut');
  var plan = makePlan({ domain: 'agribee.tn' });
  throwsWith(function () { exec.assertOwnerApproval({ gate: gate, domain: 'agribee.tn', plan: plan }); },
    /OWNER_APPROVAL_MISSING.*NOT_REQUESTED/, '4 a real domain from the real gate refuses execution, naming the missing field');
  ok(exec.APPROVAL_VALUES.length === 6 && exec.EXECUTING_APPROVAL_VALUE === 'APPROVED_FOR_MIGRATION',
    '5 the six-value vocabulary is honoured and only APPROVED_FOR_MIGRATION authorises execution');
  throwsWith(function () {
    exec.approvalGateFromDocument(GATE_DOC.replace('| NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED |',
      '| YES | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED |'));
  }, /APPROVAL_GATE_VALUE_INVALID/, '6 an approval value outside the vocabulary is refused, never coerced into something permissive');
  throwsWith(function () { exec.approvalGateFromDocument('no table here'); },
    /APPROVAL_GATE_TABLE_NOT_FOUND/, '7 a gate document without the table is refused');
  var src = fs.readFileSync(EXEC_PATH, 'utf8');
  ok(!/writeFile|appendFile|CLOUDFLARE_OWNER_APPROVAL_GATE\.md['"]\s*,/.test(src),
    '8 the executor has no code path that writes the approval gate — it can only read it');
})();

console.log('\n2. APPROVED PATH — the accept case works, so every refusal below means something');
await (async function () {
  var req = baseRequest();
  var out = await exec.executeApprovedOperation(req);
  ok(out.status === 'SUCCEEDED' && out.mutations_performed === 1 && out.verified === true,
    '9 a fully-approved, fully-configured operation executes exactly once and verifies');
  ok(req._state.applied.length === 1,
    '10 exactly one provider call was made — no bulk mutation, no speculative extra operation');
  ok(out.audit_events.some(function (a) { return a.event_type === 'operation_approved'; }) &&
     out.audit_events.some(function (a) { return a.event_type === 'operation_applied'; }) &&
     out.audit_events.some(function (a) { return a.event_type === 'operation_verified'; }),
    '11 a successful operation is auditable end to end');
  var dry = await exec.dryRun(baseRequest());
  ok(dry.mutations_performed === 0 && dry.terminated_before === 'APPLY',
    '12 the dry run performs no mutation and stops before APPLY');
  var dreq = baseRequest();
  await exec.dryRun(dreq);
  ok(dreq._state.applied.length === 0 && dreq._state.value === null,
    '13 the dry run touched the provider zero times — nothing was written');
  ok(JSON.stringify(dry.envelope) === JSON.stringify(out.envelope),
    '14 the dry-run envelope is byte-identical to the executed one — a dry run can never describe a different operation');
})();

console.log('\n3. OWNER APPROVAL GATE — per domain, per action');
(function () {
  var plan = makePlan();
  throwsWith(function () {
    exec.assertOwnerApproval({ gate: approvedGate({ 'Nameserver migration approval': 'NOT_REQUESTED' }), domain: DOMAIN, plan: plan });
  }, /OWNER_APPROVAL_MISSING/, '15 missing approval on the field the plan needs is refused');
  throwsWith(function () {
    exec.assertOwnerApproval({ gate: approvedGate({ 'Nameserver migration approval': 'APPROVED_FOR_PREPARATION' }), domain: DOMAIN, plan: plan });
  }, /OWNER_APPROVAL_MISSING.*APPROVED_FOR_PREPARATION/, '16 APPROVED_FOR_PREPARATION is NOT execution approval — insufficient level refused');
  throwsWith(function () {
    exec.assertOwnerApproval({ gate: approvedGate({ 'Nameserver migration approval': 'DEFERRED' }), domain: DOMAIN, plan: plan });
  }, /OWNER_APPROVAL_MISSING.*DEFERRED/, '17 DEFERRED blocks exactly as NOT_REQUESTED does');
  throwsWith(function () {
    exec.assertOwnerApproval({ gate: approvedGate({ 'Nameserver migration approval': 'REJECTED' }), domain: DOMAIN, plan: plan });
  }, /OWNER_APPROVAL_MISSING.*REJECTED/, '18 an explicitly REJECTED action is refused');
  throwsWith(function () {
    exec.assertOwnerApproval({ gate: approvedGate({ 'Nameserver migration approval': 'PENDING' }), domain: DOMAIN, plan: plan });
  }, /OWNER_APPROVAL_MISSING.*PENDING/, '19 PENDING is not approval');
  throwsWith(function () {
    exec.assertOwnerApproval({ gate: approvedGate(), domain: 'other.invalid', plan: plan });
  }, /DOMAIN_NOT_IN_APPROVAL_GATE/, '20 a domain absent from the gate is refused, never treated as unrestricted');

  var dnssecPlan = makePlan({ dnssec: { dsSequencingRequired: true }, nameserverChangePlanned: true });
  var fields = exec.requiredApprovalFields(dnssecPlan);
  ok(fields.indexOf('DNSSEC approval') !== -1 && fields.indexOf('Nameserver migration approval') !== -1,
    '21 a DNSSEC+nameserver plan requires BOTH approval fields — approval is per action');
  throwsWith(function () {
    exec.assertOwnerApproval({ gate: approvedGate({ 'DNSSEC approval': 'NOT_REQUESTED' }), domain: DOMAIN, plan: dnssecPlan });
  }, /OWNER_APPROVAL_MISSING.*DNSSEC approval/,
    '22 nameserver approval does not imply DNSSEC approval — granting one action never grants another');
  throwsWith(function () { exec.requiredApprovalFields({ steps: [{ kind: 'drop_zone' }] }); },
    /UNKNOWN_OPERATION_KIND/, '23 an unknown operation kind maps to no approval field and is refused');
})();

console.log('\n4. APPROVAL RECORD AND POLICY');
(function () {
  var base = { approval: approvalRecord(), policy: approvalPolicy(), runId: RUN, requestedByRef: 'operator-ref-B' };
  ok(exec.assertApprovalRecord(base).approvers === 1, '24 a valid approval record passes');
  throwsWith(function () { exec.assertApprovalRecord(Object.assign({}, base, { approval: null })); },
    /APPROVAL_RECORD_REQUIRED/, '25 a missing approval record is refused');
  throwsWith(function () { exec.assertApprovalRecord(Object.assign({}, base, { approval: approvalRecord({ decision: 'REJECT' }) })); },
    /APPROVAL_NOT_GRANTED/, '26 a REJECTED decision cannot execute');
  throwsWith(function () { exec.assertApprovalRecord(Object.assign({}, base, { approval: approvalRecord({ is_self_approval: true }) })); },
    /SELF_APPROVAL_REJECTED/, '27 a self-approval flag is refused');
  throwsWith(function () { exec.assertApprovalRecord(Object.assign({}, base, { approval: approvalRecord({ decided_by_ref: 'operator-ref-B' }) })); },
    /SELF_APPROVAL_REJECTED.*same reference/, '28 separation of duties: the requester may never be the approver');
  throwsWith(function () { exec.assertApprovalRecord(Object.assign({}, base, { policy: approvalPolicy({ allow_self_approval: true }) })); },
    /SELF_APPROVAL_PERMITTED_BY_POLICY/, '29 a policy permitting self-approval is refused outright');
  throwsWith(function () {
    exec.assertApprovalRecord(Object.assign({}, base, { approval: approvalRecord({ expires_at: '2026-08-15T00:00:00Z' }), now: '2026-08-16T00:00:00Z' }));
  }, /APPROVAL_EXPIRED/, '30 an expired approval cannot be reused');
  throwsWith(function () { exec.assertApprovalRecord(Object.assign({}, base, { approval: approvalRecord({ run_id: 'run-other' }) })); },
    /APPROVAL_RUN_MISMATCH/, '31 an approval granted for another run cannot be carried over — it is not a bearer token');
  throwsWith(function () {
    exec.assertApprovalRecord(Object.assign({}, base, { policy: approvalPolicy({ minimum_automation_level_covered: 'LEVEL_2_RECOMMEND' }) }));
  }, /APPROVAL_LEVEL_INSUFFICIENT/, '32 a policy covering only a lower automation level is insufficient');
  throwsWith(function () { exec.assertApprovalRecord(Object.assign({}, base, { policy: approvalPolicy({ is_permanent_boundary: false }) })); },
    /PERMANENT_BOUNDARY_NOT_DECLARED/, '33 a policy denying the permanent boundary is refused (approval matrix §2)');
  throwsWith(function () { exec.assertApprovalRecord(Object.assign({}, base, { policy: approvalPolicy({ policy_key: 'something_else' }) })); },
    /APPROVAL_POLICY_KEY_UNRECOGNISED/, '34 an undeclared approval-boundary key is refused');
  throwsWith(function () { exec.assertApprovalRecord(Object.assign({}, base, { policy: approvalPolicy({ enabled: false }) })); },
    /APPROVAL_POLICY_DISABLED/, '35 a disabled policy cannot authorise anything');
  throwsWith(function () {
    exec.assertApprovalRecord(Object.assign({}, base, { policy: approvalPolicy({ required_approval_count: 2 }) }));
  }, /APPROVAL_COUNT_INSUFFICIENT/, '36 a two-approver policy is not satisfied by one approver');
  ok(exec.assertApprovalRecord(Object.assign({}, base, {
    policy: approvalPolicy({ required_approval_count: 2 }),
    additionalApprovals: [approvalRecord({ approval_id: 'apr-2', decided_by_ref: 'owner-ref-C' })]
  })).approvers === 2, '37 two DISTINCT approvers satisfy a two-approver policy');
  throwsWith(function () {
    exec.assertApprovalRecord(Object.assign({}, base, {
      policy: approvalPolicy({ required_approval_count: 2 }),
      additionalApprovals: [approvalRecord({ approval_id: 'apr-2', decided_by_ref: 'owner-ref-A' })]
    }));
  }, /APPROVAL_COUNT_INSUFFICIENT/, '38 the same approver twice is one approver — the count cannot be self-generated');
})();

console.log('\n5. CONNECTOR BOUNDARY — least privilege, no escape');
(function () {
  var base = {
    connector: { connector_id: 'ovh_dns_operator', secret_reference_id: 'secref-1' },
    client: { applyOperation: function () {}, readRecord: function () {} },
    catalogue: enabledCatalogue(), featureFlags: liveFlags(),
    provider: 'OVHcloud', requiredCapability: 'dns.write',
    allowedClientMethods: ['applyOperation', 'readRecord']
  };
  ok(exec.assertAuthorisedConnector(base).connector_id === 'ovh_dns_operator', '39 an authorised write connector passes');
  throwsWith(function () { exec.assertAuthorisedConnector(Object.assign({}, base, { catalogue: CATALOGUE })); },
    /CONNECTOR_DISABLED/, '40 the REAL catalogue has ovh_dns_operator disabled — a disabled connector is refused');
  throwsWith(function () {
    exec.assertAuthorisedConnector(Object.assign({}, base, { featureFlags: liveFlags({ connector_ovh_dns_operator_live: false }) }));
  }, /CONNECTOR_NOT_LIVE/, '41 a connector whose live feature flag is false is refused');
  throwsWith(function () {
    exec.assertAuthorisedConnector(Object.assign({}, base, { featureFlags: liveFlags({ level_3_approval_required_runs: false }) }));
  }, /LEVEL_3_RUNS_DISABLED/, '42 LEVEL_3 runs being globally disabled refuses every operation');
  throwsWith(function () {
    exec.assertAuthorisedConnector(Object.assign({}, base, { connector: { connector_id: 'ovh_readonly', secret_reference_id: 's' } }));
  }, /CONNECTOR_NOT_A_WRITE_CONNECTOR|READ_CONNECTOR_CANNOT_MUTATE/,
    '43 the read connector can never be used to mutate — read and write connectors are distinct definitions');
  throwsWith(function () {
    exec.assertAuthorisedConnector(Object.assign({}, base, { connector: { connector_id: 'mock_dns_operator', secret_reference_id: 's' } }));
  }, /CONNECTOR_NOT_IN_CATALOGUE/,
    '44 a mock/test connector cannot reach the write path — the catalogue is the only source of connectors');
  throwsWith(function () { exec.assertAuthorisedConnector(Object.assign({}, base, { provider: 'Cloudflare' })); },
    /PROVIDER_MISMATCH/, '45 a provider mismatch between plan and connector is refused');
  throwsWith(function () { exec.assertAuthorisedConnector(Object.assign({}, base, { requiredCapability: 'proxy.toggle' })); },
    /CAPABILITY_NOT_GRANTED/, '46 a capability the connector was never granted is refused');
  throwsWith(function () {
    exec.assertAuthorisedConnector(Object.assign({}, base, { connector: { connector_id: 'ovh_dns_operator' } }));
  }, /CREDENTIAL_REFERENCE_MISSING/, '47 a connector with no credential REFERENCE is refused (the value is never asked for)');
  throwsWith(function () {
    exec.assertAuthorisedConnector(Object.assign({}, base, {
      connector: { connector_id: 'ovh_dns_operator', secret_reference_id: 's', api_key: 'zzz' }
    }));
  }, /CREDENTIAL_VALUE_PRESENT/, '48 a connector carrying an actual credential value is refused — references only');
  throwsWith(function () {
    exec.assertAuthorisedConnector(Object.assign({}, base, {
      client: { applyOperation: function () {}, readRecord: function () {}, deleteZone: function () {} }
    }));
  }, /CONNECTOR_SCOPE_ESCAPE.*deleteZone/,
    '49 a client exposing a method outside its declared capabilities cannot escape scope');
})();

console.log('\n6. SCOPE — one domain, one step, declared kinds only');
(function () {
  var plan = makePlan();
  ok(exec.assertSingleDomain(plan, DOMAIN) === true, '50 a single-domain plan passes');
  throwsWith(function () { exec.assertSingleDomain(plan, 'other.invalid'); },
    /DOMAIN_MISMATCH/, '51 a plan for a different domain than requested is refused');
  var multi = makePlan();
  multi.steps.push(Object.assign({}, multi.steps[0], { step_id: 'step-999', target: 'elsewhere.invalid|A' }));
  throwsWith(function () { exec.assertSingleDomain(multi, DOMAIN); },
    /MULTI_DOMAIN_PLAN_REJECTED/, '52 a plan touching a second domain is refused — one domain at a time');
  var sub = makePlan();
  sub.steps.push(Object.assign({}, sub.steps[0], { step_id: 'step-998', target: 'www.' + DOMAIN + '|A' }));
  ok(exec.assertSingleDomain(sub, DOMAIN) === true,
    '52a a label under the target domain is in scope');
  var lookalike = makePlan();
  lookalike.steps.push(Object.assign({}, lookalike.steps[0], { step_id: 'step-997', target: DOMAIN + '.attacker.test|A' }));
  throwsWith(function () { exec.assertSingleDomain(lookalike, DOMAIN); },
    /MULTI_DOMAIN_PLAN_REJECTED.*step-997/,
    '52b a lookalike host that merely CONTAINS the domain is refused — the scope check is anchored, not a substring match');
})();
await (async function () {
  await rejects(exec.dryRun(baseRequest({ stepId: 'step-nonexistent' })),
    /STEP_NOT_IN_PLAN/, '53 a step that is not in the plan cannot be executed');
  var blockedPlan = makePlan({ records: [{ name: DOMAIN, type: 'A', value: '203.0.113.1',
    proposedCloudflareMode: 'NEEDS_CONFIRMATION', requiresConfirmation: true }] });
  await rejects(exec.dryRun(baseRequest({ plan: blockedPlan, rollbackPlan: makeRollback(blockedPlan), stepId: blockedPlan.steps[0].step_id })),
    /STEP_BLOCKED_BY_ENTRY_CRITERIA/, '54 a step blocked by an INF-CF-2 entry criterion cannot execute');
  var forged = makePlan();
  forged.steps[0].automation_level = 'LEVEL_4_FULL_AUTOMATIC';
  await rejects(exec.dryRun(baseRequest({ plan: forged, rollbackPlan: makeRollback(forged), stepId: forged.steps[0].step_id })),
    /GATE_CHECK_FAILED/, '55 a plan forged to a lower automation level is caught by the INF-DNS-AUTO-1 gate before anything else runs');
  var noApprovalStep = makePlan();
  noApprovalStep.steps[0].allow_self_approval = true;
  await rejects(exec.dryRun(baseRequest({ plan: noApprovalStep, rollbackPlan: makeRollback(noApprovalStep), stepId: noApprovalStep.steps[0].step_id })),
    /GATE_CHECK_FAILED/, '56 a plan step permitting self-approval never reaches the approval check');
})();

console.log('\n7. PRECONDITIONS — drift invalidates the plan');
(function () {
  ok(exec.assertNoDrift({ expectedRecords: RECORDS, observedRecords: RECORDS }).discrepancies === 0,
    '57 matching state passes the precondition');
  throwsWith(function () {
    exec.assertNoDrift({ expectedRecords: RECORDS, observedRecords: [{ name: DOMAIN, type: 'A', value: '198.51.100.9' }] });
  }, /PRECONDITION_DRIFT_DETECTED/, '58 DNS drift since PLAN time invalidates the plan — refused, not reconciled');
  throwsWith(function () { exec.assertNoDrift({ expectedRecords: RECORDS }); },
    /DRIFT_CHECK_INPUT_REQUIRED/, '59 a precondition check with nothing to compare is refused, never assumed clean');
})();
await rejects(exec.executeApprovedOperation(baseRequest({ observedRecords: [{ name: DOMAIN, type: 'A', value: '198.51.100.9' }] })),
  /PRECONDITION_DRIFT_DETECTED/, '60 a failed precondition prevents the operation');
await (async function () {
  var req = baseRequest({ observedRecords: [{ name: DOMAIN, type: 'A', value: '198.51.100.9' }] });
  try { await exec.executeApprovedOperation(req); } catch (e) { /* expected */ }
  ok(req._state.applied.length === 0 && req._state.value === null,
    '61 a failed precondition mutated nothing — the provider was never called');
})();

console.log('\n8. ROLLBACK — required, approved-only, audited');
await (async function () {
  var plan = makePlan();
  var rb = engine.generateRollbackPlan(plan, {}); // no prior state captured
  await rejects(exec.dryRun(baseRequest({ plan: plan, rollbackPlan: rb, stepId: plan.steps[0].step_id })),
    /ROLLBACK_NOT_RESTORABLE/, '62 an operation whose rollback has no captured prior state is refused');
  var stripped = makeRollback(plan);
  stripped.steps = [];
  await rejects(exec.dryRun(baseRequest({ plan: plan, rollbackPlan: stripped, stepId: plan.steps[0].step_id })),
    /ROLLBACK_STEP_MISSING/, '63 an operation with no matching rollback step is refused — missing rollback blocks execution');
  await rejects(exec.dryRun(baseRequest({ rollbackPlan: null })),
    /ROLLBACK_PLAN_REQUIRED/, '64 no rollback plan at all is refused');

  var st = { applied: [], value: null };
  var req = baseRequest({ client: mockClient(st, { writesWrongValue: true }) });
  req._state = st;
  var out = await exec.executeApprovedOperation(req);
  ok(out.status === 'ROLLED_BACK' && out.verified === false,
    '65 a failed verification triggers the defined rollback automatically');
  ok(out.rollback.trigger_reason === 'VERIFY_FAILED' && out.rollback.status === 'ROLLED_BACK',
    '66 the rollback is a separate, audited execution record with its own trigger reason');
  ok(st.applied.length === 2 && st.applied[1].step_id === out.envelope.rollback_step_id,
    '67 rollback used ONLY the approved rollback step — nothing improvised');
  ok(out.audit_events.some(function (a) { return a.event_type === 'verification_failed'; }) &&
     out.audit_events.some(function (a) { return a.event_type === 'rollback_executed'; }),
    '68 rollback is auditable');

  var st2 = { applied: [], value: null };
  var req2 = baseRequest({ client: {
    applyOperation: function (env) {
      st2.applied.push(env);
      if (st2.applied.length === 1) { st2.value = '198.51.100.9'; return Promise.resolve({ ok: true }); }
      return Promise.reject(new Error('rollback provider failure'));
    },
    readRecord: function () { return Promise.resolve(st2.value); }
  } });
  await rejects(exec.executeApprovedOperation(req2),
    /ROLLBACK_FAILED_CRITICAL_INCIDENT/, '69 a failed rollback raises a CRITICAL incident, never a routine failure');
})();

console.log('\n9. IDEMPOTENCY, LOCKS, AUDIT AND SECRET HYGIENE');
await (async function () {
  var a = await exec.dryRun(baseRequest());
  var b = await exec.dryRun(baseRequest());
  ok(a.envelope.idempotency_key === b.envelope.idempotency_key,
    '70 the idempotency key is deterministic — a retry presents the same key, so the operation is not re-applied');
  var other = await exec.dryRun(baseRequest({ runId: 'run-002', approval: approvalRecord({ run_id: 'run-002' }) }));
  ok(other.envelope.idempotency_key !== a.envelope.idempotency_key,
    '71 a different run gets a different key — keys are scoped, not global');
  ok(/^lock-/.test(a.envelope.resource_lock_key) &&
     a.envelope.resource_lock_key === exec.buildResourceLockKey(a.envelope.record_target, 'OVHcloud'),
    '72 a resource lock key is derived from the resource, preventing conflicting simultaneous operations');
  var blob = JSON.stringify(a);
  ok(blob.indexOf('secref-ovh-dns-1') !== -1 && !/api_?key|password|token"|private_key/i.test(blob),
    '73 the envelope carries a secret REFERENCE and no credential value anywhere in it');
  throwsWith(function () { exec.assertNoSecrets({ nested: { api_key: 'zzz' } }); },
    /CREDENTIAL_VALUE_PRESENT.*api_key/, '74 a credential value nested anywhere in a record is caught');
  throwsWith(function () { exec.buildAuditEvent({ auditEventId: 'a', eventType: 'x', runId: RUN, actorRef: 'r', actorType: 'HUMAN', eventSummary: 's' }); },
    /AUDIT_FIELD_MISSING.*occurredAt/, '75 an incomplete audit record is refused field by field');
  throwsWith(function () { exec.buildAuditEvent({ auditEventId: 'a', eventType: 'x', runId: RUN, actorRef: 'r', actorType: 'ROBOT', eventSummary: 's', occurredAt: 'now' }); },
    /AUDIT_ACTOR_TYPE_INVALID/, '76 an audit actor type outside HUMAN/SYSTEM is refused');
  throwsWith(function () { exec.buildRollbackExecutionRecord({ rollbackExecutionId: 'r', rollbackPlanId: 'p', runId: RUN, triggeredByRef: 'x', triggerReason: 'BECAUSE' }); },
    /ROLLBACK_TRIGGER_REASON_INVALID/, '77 a rollback trigger reason outside the schema vocabulary is refused');
  ok(exec.buildAuditEvent({ auditEventId: 'a', eventType: 'x', runId: RUN, actorRef: 'r', actorType: 'SYSTEM',
      eventSummary: 'y'.repeat(600), occurredAt: 'now' }).event_summary.length === 512,
    '78 an audit summary is truncated to the column width rather than overflowing it');
})();

console.log('\n10. SAFETY PROPERTIES PRESERVED FROM INF-DNS-AUTO-1');
await (async function () {
  var dnssecPlan = makePlan({ dnssec: { dsSequencingRequired: true }, nameserverChangePlanned: true });
  ok(dnssecPlan.steps[0].kind === 'dnssec_ds_change' &&
     dnssecPlan.steps[dnssecPlan.steps.length - 1].kind === 'dnssec_ds_change',
    '79 DNSSEC DS sequencing (removal before cutover, re-publication after) is preserved in the plan this stage executes');
  var rb = makeRollback(dnssecPlan);
  ok(rb.steps[0].inverse_of === dnssecPlan.steps[dnssecPlan.steps.length - 1].step_id && rb.is_automatic_eligible === false,
    '80 rollback sequencing is the reverse of the forward plan and is never automatically eligible');
  var mail = engine.analyseEmailSafety([
    { name: DOMAIN, type: 'MX', value: '1 mx1', proposedCloudflareMode: 'PROXIED' }]);
  ok(mail.safeToMigrate === false,
    '81 email safety rules still refuse a proxied mail record');
  var dnssec = engine.analyseDnssecSafety({ dnssecStatus: 'UNKNOWN' });
  ok(dnssec.findings[0].severity === 'HIGH',
    '82 DNSSEC safety rules still treat an UNKNOWN state as HIGH');
  var req = baseRequest();
  var out = await exec.executeApprovedOperation(req);
  ok(req._state.applied.length === 1 && req._state.applied[0].record_target === DOMAIN + '|A',
    '83 only the targeted record was operated on — no unrelated record was touched');
  ok(out.envelope.domain === DOMAIN && out.envelope.zone === DOMAIN,
    '84 only the targeted zone appears in the operation — no unrelated zone was touched');
})();

console.log('\n11. STRUCTURAL BOUNDARIES');
(function () {
  var src = fs.readFileSync(EXEC_PATH, 'utf8');
  var body = src.replace(/\/\/[^\n]*\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  var requires = (body.match(/require\('([^']+)'\)/g) || []).sort().join(',');
  ok(requires === "require('./dns-comparison-engine.js'),require('crypto')",
    '85 the executor requires only the INF-DNS-AUTO-1 engine and crypto — no http, no fs, no database, no provider SDK');
  ok(!/process\.env/.test(body),
    '86 no environment variable is read — a credential can never be picked up implicitly');
  ok(!/fetch\(|XMLHttpRequest|WebSocket|https?:\/\/[a-z]/i.test(body),
    '87 the executor performs no network call and embeds no provider endpoint');
  ok(!/\b(INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM|writeFileSync|writeFile\()/i.test(body),
    '88 the executor performs no database write and no filesystem write');
  ok(exec.SEPARATION_OF_DUTIES_KEYS.join(',') === 'domain_nameserver_changes,dnssec_or_ds_record_changes,production_dns_record_deletion',
    '89 the separation-of-duties keys are exactly the DNS entries of approval_rules, no more and no less');
  var cfgKeys = AUT_CONFIG.approval_rules.separation_of_duties_required_for;
  ok(exec.SEPARATION_OF_DUTIES_KEYS.every(function (k) { return cfgKeys.indexOf(k) !== -1; }),
    '90 every key the executor enforces is present in the committed automation config — not invented here');
  ok(AUT_CONFIG.approval_rules.self_approval_allowed === false &&
     AUT_CONFIG.approval_rules.expired_approval_reusable === false &&
     AUT_CONFIG.approval_rules.rejected_run_can_execute === false,
    '91 the committed config still forbids self-approval, expired-approval reuse and rejected-run execution');
  ok(Object.keys(exec.STEP_KIND_APPROVAL_FIELD).every(function (k) {
    return engine.PLAN_STEP_KINDS.indexOf(k) !== -1 || k === 'record_delete';
  }), '92 every operation kind the executor maps is a real INF-DNS-AUTO-1 plan step kind');
})();

console.log('\n12. NO LIVE PATH EXISTS IN THIS REPOSITORY TODAY');
await (async function () {
  // The real config, the real gate, the real (absent) credential — the exact
  // request an operator would make today. It must refuse.
  var realGate = exec.approvalGateFromDocument(GATE_DOC);
  var plan = makePlan({ domain: 'agribee.tn', records: [{ name: 'agribee.tn', type: 'A',
    value: '51.91.236.255', proposedCloudflareMode: 'DNS_ONLY', migrationAction: 'RECREATE_EXACTLY' }] });
  await rejects(exec.dryRun({
    plan: plan, rollbackPlan: engine.generateRollbackPlan(plan, { priorState: { records: {} } }),
    runId: RUN, domain: 'agribee.tn', zone: 'agribee.tn', stepId: plan.steps[0].step_id,
    approvalGate: realGate, approval: approvalRecord(), approvalPolicy: approvalPolicy(),
    requestedByRef: 'operator', connector: { connector_id: 'ovh_dns_operator', secret_reference_id: 's' },
    connectorCatalogue: CATALOGUE, featureFlags: AUT_CONFIG.feature_flags,
    provider: 'OVHcloud', requiredCapability: 'dns.write',
    allowedClientMethods: ['applyOperation', 'readRecord'],
    client: { applyOperation: function () {}, readRecord: function () {} },
    expectedRecords: RECORDS, observedRecords: RECORDS
  }), /OWNER_APPROVAL_MISSING|ROLLBACK_NOT_RESTORABLE/,
    '93 against the REAL repository state, even a dry run refuses — no owner approval exists for any domain');
  ok(AUT_CONFIG.feature_flags.level_3_approval_required_runs === false &&
     AUT_CONFIG.feature_flags.connector_ovh_dns_operator_live === false &&
     AUT_CONFIG.feature_flags.connector_cloudflare_dns_operator_live === false &&
     AUT_CONFIG.feature_flags.auto_rollback === false,
    '94 every LEVEL_3 feature flag in the committed config is false — a second, independent block on execution');
  ok(CATALOGUE.filter(function (c) { return /dns_operator/.test(c.connector_id); })
      .every(function (c) { return c.enabled === false; }),
    '95 both DNS write connectors are disabled in the committed catalogue — a third, independent block');
})();

console.log('\nStage INF-DNS-AUTO-2 approved DNS operations: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

})().catch(function (e) {
  console.error('SUITE ABORTED: ' + (e && e.stack || e));
  process.exit(1);
});
