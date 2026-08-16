'use strict';
// =====================================================
// MYTHOS — Stage INF-BACKUP-AUTO-0 backup / verify / isolated-restore tests
// tests/inf-backup-auto-0-backup-test.js
//
// Deterministic and fully offline. No live credential, no network call, no
// backup created, no object uploaded, no restore performed. The storage
// client is always a mock and every "remote" object is an in-memory buffer.
// The real committed automation config is read so the connector gate is
// tested against the repository's actual state, not a convenient fixture.
//
// Run with: node tests/inf-backup-auto-0-backup-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
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

var ORCH_PATH = path.join(BASE, 'projects', 'automation', 'reference', 'backup-operations-orchestrator.js');
var orch = require(ORCH_PATH);
var OFFHOST_PATH = path.join(BASE, 'projects', 'idauto', 'ops', 'offhost-backup.js');
var offhost = require(OFFHOST_PATH);
var AUT_CONFIG = JSON.parse(fs.readFileSync(path.join(BASE, 'projects', 'automation', 'config', 'automation.example.json'), 'utf8'));
var COMMITTED_CATALOGUE = AUT_CONFIG.connector_catalogue.infrastructure;

var RUN = 'run-backup-001';
var PREFIX = '20260816T000000Z';

// ---- fixtures -----------------------------------------------------------
// The catalogue entry as the repository actually commits it, plus an
// "enabled" variant so the gates downstream of enablement are reachable.
function committedBackupConnector() {
  return COMMITTED_CATALOGUE.filter(function (c) { return c.connector_id === 'backup_storage_readonly'; })[0];
}
function catalogue(over) {
  var base = JSON.parse(JSON.stringify(committedBackupConnector()));
  base.enabled = true;
  return [Object.assign(base, over || {})];
}
function connector(over) {
  return Object.assign({ connector_id: 'backup_storage_readonly', secret_reference_id: 'secref-r2-backup' }, over || {});
}
function flags(over) {
  return Object.assign({ level_2_recommend_runs: true, level_3_approval_required_runs: false }, over || {});
}
function policy(over) {
  return Object.assign({
    policy_key: 'pol-backup-l2', enabled: true,
    minimum_automation_level_covered: 'LEVEL_2_RECOMMEND',
    is_permanent_boundary: false, allow_self_approval: false,
    covers_operations: ['backup_create', 'backup_verify', 'restore_test', 'retention_report'],
    covers_retention: true
  }, over || {});
}
function isolatedTarget(over) {
  return Object.assign({
    target_id: 'scratch-restore-01', is_production: false, is_isolated: true,
    restore_path: '/tmp/mythos-restore-scratch/run-1',
    isolation: { network: 'none', published_ports: [], ephemeral: true, volume_kind: 'tmpfs' }
  }, over || {});
}
function readOnlyClient() {
  return { list: function () {}, head: function () {}, get: function () {} };
}
function request(over) {
  return Object.assign({
    runId: RUN, operation: 'backup_verify', prefix: PREFIX,
    connector: connector(), connectorCatalogue: catalogue(), featureFlags: flags(),
    policy: policy(), client: readOnlyClient()
  }, over || {});
}

// An in-memory adapter that satisfies offhost-backup's read surface.
function memoryAdapter(objects) {
  function h(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
  return {
    list: function () { return Promise.resolve(Object.keys(objects)); },
    head: function (k) {
      var b = objects[k];
      return Promise.resolve(b ? { size: b.length, sha256: h(b) } : null);
    },
    get: function (k) {
      var b = objects[k];
      return b ? Promise.resolve(b) : Promise.reject(new Error('missing ' + k));
    }
  };
}
function completeBackupSet() {
  function h(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
  var payload = Buffer.from('dump-bytes');
  var manifest = {
    format_version: offhost.FORMAT_VERSION, created_at_utc: '2026-08-16T00:00:00.000Z',
    objects: [{ path: 'database/idauto.dump', sha256: h(payload), size: payload.length }]
  };
  var mb = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  var objs = {};
  objs[PREFIX + '/manifest.json'] = mb;
  objs[PREFIX + '/COMPLETE'] = Buffer.from(h(mb) + '\n');
  objs[PREFIX + '/database/idauto.dump'] = payload;
  return objs;
}

(async function () {

// =======================================================================
console.log('\n1. Operation authorisation and the permanent LEVEL_3 boundaries (O-BACKUP-2)');
// =======================================================================
ok(orch.AUTHORISED_OPERATIONS.length === 4, '1 exactly four operations are authorised');
['backup_create', 'backup_verify', 'restore_test', 'retention_report'].forEach(function (op, i) {
  ok(orch.OPERATION_LEVELS[op] === 'LEVEL_2_RECOMMEND', (2 + i) + ' ' + op + ' is LEVEL_2');
});
// Asserted against the EXACT refusal code, not a permissive alternation: the
// named-boundary list must bite on its own. A looser regex would let the
// destructive-shape check silently cover for the name list being deleted —
// that gap was found by mutation and is why these are pinned.
orch.PROHIBITED_OPERATIONS.forEach(function (op, i) {
  throwsWith(function () { orch.assertOperationAuthorised({ operation: op }); },
    /PERMANENT_BOUNDARY_OPERATION_REFUSED/,
    (6 + i) + ' "' + op + '" is refused BY NAME — a permanent LEVEL_3 boundary (O-BACKUP-2)');
});
ok(orch.PROHIBITED_OPERATIONS.length === 13, '19 all thirteen named boundaries are pinned above');
// Shape check, not just the name list — an unlisted synonym must still fail.
throwsWith(function () { orch.assertOperationAuthorised({ operation: 'backup_obliterate_everything' }); },
  /OPERATION_NOT_AUTHORISED/, '20 an unlisted operation is refused (allowlist, not denylist)');
throwsWith(function () { orch.assertOperationAuthorised({ operation: 'snapshot_wipe' }); },
  /DESTRUCTIVE_OPERATION_REFUSED/, '21 an unlisted DESTRUCTIVE synonym is caught by shape — the second layer');
throwsWith(function () { orch.assertOperationAuthorised({ operation: 'backup_verify_production' }); },
  /PRODUCTION_OPERATION_REFUSED/, '22 an operation naming production is refused — the third layer');
throwsWith(function () { orch.assertOperationAuthorised({}); }, /OPERATION_REQUIRED/, '23 a missing operation is refused');

// =======================================================================
console.log('\n2. No operation may self-authorise (O-BACKUP-2)');
// =======================================================================
['automation_level', 'level', 'approved', 'is_approved', 'authorised', 'self_approve'].forEach(function (k, i) {
  var r = { operation: 'backup_verify' };
  r[k] = k === 'automation_level' || k === 'level' ? 'LEVEL_4_FULL_AUTOMATIC' : true;
  throwsWith(function () { orch.assertOperationAuthorised(r); },
    /SELF_AUTHORISATION_REFUSED/, (17 + i) + ' a request declaring "' + k + '" is refused');
});
ok(orch.assertOperationAuthorised({ operation: 'backup_verify' }).level === 'LEVEL_2_RECOMMEND',
  '23 the level comes from the constant table, never from the request');
throwsWith(function () { orch.assertPolicy({ policy: policy({ approval_text: 'the owner said yes' }), operation: 'backup_verify', level: 'LEVEL_2_RECOMMEND' }); },
  /APPROVAL_INFERENCE_REFUSED/, '24 approval may never be inferred from user text');
throwsWith(function () { orch.assertPolicy({ policy: policy({ user_said: 'go ahead' }), operation: 'backup_verify', level: 'LEVEL_2_RECOMMEND' }); },
  /APPROVAL_INFERENCE_REFUSED/, '25 a prose field is refused rather than parsed');

// =======================================================================
console.log('\n3. Approval policy gate');
// =======================================================================
ok(orch.assertPolicy({ policy: policy(), operation: 'backup_verify', level: 'LEVEL_2_RECOMMEND' }).policy_key === 'pol-backup-l2',
  '26 a valid LEVEL_2 policy is accepted');
throwsWith(function () { orch.assertPolicy({ operation: 'backup_verify', level: 'LEVEL_2_RECOMMEND' }); },
  /APPROVAL_POLICY_REQUIRED/, '27 a missing policy is refused');
throwsWith(function () { orch.assertPolicy({ policy: policy({ enabled: false }), operation: 'backup_verify', level: 'LEVEL_2_RECOMMEND' }); },
  /POLICY_DISABLED/, '28 a disabled policy is refused');
throwsWith(function () { orch.assertPolicy({ policy: policy({ allow_self_approval: true }), operation: 'backup_verify', level: 'LEVEL_2_RECOMMEND' }); },
  /SELF_APPROVAL_PERMITTED_BY_POLICY/, '29 a policy permitting self-approval is refused');
throwsWith(function () { orch.assertPolicy({ policy: policy({ is_permanent_boundary: true }), operation: 'backup_verify', level: 'LEVEL_2_RECOMMEND' }); },
  /PERMANENT_BOUNDARY_POLICY_REFUSED/, '30 a permanent-boundary policy can never authorise a LEVEL_2 backup op');
throwsWith(function () { orch.assertPolicy({ policy: policy({ minimum_automation_level_covered: 'LEVEL_3_APPROVAL_REQUIRED' }), operation: 'backup_verify', level: 'LEVEL_2_RECOMMEND' }); },
  /POLICY_LEVEL_MISMATCH/, '31 a LEVEL_3 policy does not cover a LEVEL_2 operation');
throwsWith(function () { orch.assertPolicy({ policy: policy({ covers_operations: ['backup_verify'] }), operation: 'restore_test', level: 'LEVEL_2_RECOMMEND' }); },
  /POLICY_DOES_NOT_COVER_OPERATION/, '32 a policy not covering the operation is refused');

// =======================================================================
console.log('\n4. Connector stays read-only and is never broadened (O-BACKUP-3)');
// =======================================================================
ok(orch.READ_CONNECTOR_ID === 'backup_storage_readonly', '33 exactly one connector is authorised');
ok(orch.PERMITTED_CAPABILITIES.join(',') === 'backup.list,backup.verify',
  '34 the permitted capability set is exactly backup.list + backup.verify');
ok(orch.assertReadOnlyConnector({ connector: connector(), catalogue: catalogue(), featureFlags: flags(), client: readOnlyClient() }).connector_id === 'backup_storage_readonly',
  '35 the committed read-only connector (enabled) passes the gate');
throwsWith(function () { orch.assertReadOnlyConnector({ connector: connector({ connector_id: 'coolify_deployer' }), catalogue: catalogue(), featureFlags: flags(), client: readOnlyClient() }); },
  /CONNECTOR_NOT_AUTHORISED/, '36 another connector is refused');
throwsWith(function () { orch.assertReadOnlyConnector({ connector: connector(), catalogue: catalogue({ permission: 'READ_WRITE' }), featureFlags: flags(), client: readOnlyClient() }); },
  /CONNECTOR_PERMISSION_BROADENED/, '37 broadening permission to READ_WRITE is refused');
['backup.create', 'backup.delete', 'backup.restore', 'object.write'].forEach(function (cap, i) {
  throwsWith(function () {
    orch.assertReadOnlyConnector({ connector: connector(), catalogue: catalogue({ capabilities: ['backup.list', 'backup.verify', cap] }), featureFlags: flags(), client: readOnlyClient() });
  }, /CONNECTOR_CAPABILITY_BROADENED/, (38 + i) + ' adding "' + cap + '" is refused as a broadening');
});
throwsWith(function () { orch.assertReadOnlyConnector({ connector: connector(), catalogue: [], featureFlags: flags(), client: readOnlyClient() }); },
  /CONNECTOR_NOT_IN_CATALOGUE/, '42 a connector absent from the catalogue is refused');
throwsWith(function () { orch.assertReadOnlyConnector({ connector: connector(), catalogue: catalogue({ enabled: false }), featureFlags: flags(), client: readOnlyClient() }); },
  /CONNECTOR_DISABLED/, '43 a disabled connector is refused');
throwsWith(function () { orch.assertReadOnlyConnector({ connector: connector(), catalogue: catalogue(), featureFlags: flags({ level_2_recommend_runs: false }), client: readOnlyClient() }); },
  /LEVEL_2_RUNS_DISABLED/, '44 the LEVEL_2 feature flag must be on');
throwsWith(function () { orch.assertReadOnlyConnector({ connector: connector(), catalogue: catalogue(), featureFlags: flags({ level_3_approval_required_runs: true }), client: readOnlyClient() }); },
  /LEVEL_3_FLAG_NOT_PERMITTED/, '45 this stage refuses to run with the global LEVEL_3 gate open');
throwsWith(function () { orch.assertReadOnlyConnector({ connector: connector({ secret_reference_id: undefined }), catalogue: catalogue(), featureFlags: flags(), client: readOnlyClient() }); },
  /CREDENTIAL_REFERENCE_MISSING/, '46 a credential reference is mandatory');
throwsWith(function () { orch.assertReadOnlyConnector({ connector: connector({ secret_access_key: 'AKIAREAL' }), catalogue: catalogue(), featureFlags: flags(), client: readOnlyClient() }); },
  /CREDENTIAL_VALUE_PRESENT/, '47 a credential VALUE on the connector is refused');

// =======================================================================
console.log('\n5. Client least privilege — a mutation-capable client can never be used');
// =======================================================================
['put', 'delete', 'remove', 'destroy', 'purge', 'write', 'upload'].forEach(function (m, i) {
  var c = readOnlyClient(); c[m] = function () {};
  throwsWith(function () { orch.assertReadOnlyConnector({ connector: connector(), catalogue: catalogue(), featureFlags: flags(), client: c }); },
    /MUTATION_CAPABLE_CLIENT_REFUSED/, (48 + i) + ' a client exposing "' + m + '" is refused');
});
var scopeEscape = readOnlyClient(); scopeEscape.exec = function () {};
throwsWith(function () { orch.assertReadOnlyConnector({ connector: connector(), catalogue: catalogue(), featureFlags: flags(), client: scopeEscape }); },
  /CONNECTOR_SCOPE_ESCAPE/, '55 an undeclared non-mutating method is still a scope escape');
throwsWith(function () { orch.assertReadOnlyConnector({ connector: connector(), catalogue: catalogue(), featureFlags: flags() }); },
  /CONNECTOR_CLIENT_REQUIRED/, '56 a missing client is refused');

// =======================================================================
console.log('\n6. Isolated restore target — two independent sources must agree');
// =======================================================================
var proof = orch.assertIsolatedTarget(isolatedTarget());
ok(proof.isolation_proof.sources_agree === true && proof.target_id === 'scratch-restore-01',
  '57 a properly isolated target is accepted and its identity recorded');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ is_production: true })); },
  /TARGET_NOT_DECLARED_NON_PRODUCTION/, '58 a production-flagged target is refused');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ is_production: undefined })); },
  /TARGET_NOT_DECLARED_NON_PRODUCTION/, '59 an UNKNOWN production flag is refused, never defaulted to false');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ is_isolated: false })); },
  /TARGET_NOT_DECLARED_ISOLATED/, '60 a non-isolated target is refused');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ isolation: undefined })); },
  /ISOLATION_EVIDENCE_REQUIRED/, '61 a declaration ALONE is not proof — runtime evidence is required');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ isolation: { network: 'bridge', published_ports: [], ephemeral: true, volume_kind: 'tmpfs' } })); },
  /TARGET_NETWORK_NOT_ISOLATED/, '62 a networked target is refused (--network none required)');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ isolation: { network: 'none', published_ports: [5432], ephemeral: true, volume_kind: 'tmpfs' } })); },
  /TARGET_PUBLISHES_PORTS/, '63 a published port is refused');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ isolation: { network: 'none', ephemeral: true, volume_kind: 'tmpfs' } })); },
  /PUBLISHED_PORTS_UNKNOWN/, '64 UNKNOWN published ports are refused, never treated as zero');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ isolation: { network: 'none', published_ports: [], ephemeral: false, volume_kind: 'tmpfs' } })); },
  /TARGET_NOT_EPHEMERAL/, '65 a persistent target is not a scratch target');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ isolation: { network: 'none', published_ports: [], ephemeral: true, volume_kind: 'named' } })); },
  /TARGET_VOLUME_NOT_ISOLATED/, '66 a named/bind volume is refused (tmpfs only)');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ target_id: 'dar-hijama-production-restore' })); },
  /TARGET_NAMES_PRODUCTION/, '67 a target whose identity names production is refused');
orch.PRODUCTION_DATA_STORES.slice(0, 3).forEach(function (store, i) {
  throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ data_store: store })); },
    /PRODUCTION_DATA_STORE_REFUSED|TARGET_NAMES_PRODUCTION/,
    (68 + i) + ' the production data store "' + store + '" is refused as a restore target');
});

// =======================================================================
console.log('\n7. Restore path safety — production data can never be overwritten');
// =======================================================================
orch.FORBIDDEN_RESTORE_ROOTS.forEach(function (root, i) {
  throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ restore_path: root })); },
    /RESTORE_PATH_FORBIDDEN|RESTORE_PATH_NAMES_PRODUCTION/,
    (71 + i) + ' the forbidden root "' + root + '" is refused as a restore path');
});
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ restore_path: '/home/deploy/deployments/idauto-media/media' })); },
  /RESTORE_PATH_FORBIDDEN/, '80 a path BENEATH the live media directory is refused');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ restore_path: '/home/deploy/projects/mythos-prod/data' })); },
  /RESTORE_PATH_FORBIDDEN/, '81 a path inside the repository is refused');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ restore_path: '/tmp/scratch/../../home/deploy' })); },
  /RESTORE_PATH_TRAVERSAL/, '82 path traversal is refused');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ restore_path: 'relative/path' })); },
  /RESTORE_PATH_NOT_ABSOLUTE/, '83 a relative restore path is refused');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ restore_path: '/tmp/restore\0evil' })); },
  /RESTORE_PATH_INVALID/, '84 a null byte in the path is refused');
throwsWith(function () { orch.assertIsolatedTarget(isolatedTarget({ restore_path: '/tmp/production-restore' })); },
  /RESTORE_PATH_NAMES_PRODUCTION/, '85 a scratch-looking path that names production is refused');
ok(orch.assertIsolatedTarget(isolatedTarget({ restore_path: '/tmp/mythos-restore-scratch/run-1/' })).restore_path === '/tmp/mythos-restore-scratch/run-1',
  '86 a trailing slash is normalised, not treated as a different path');

// =======================================================================
console.log('\n8. Reuse contract — the existing tooling is wrapped, never replaced (O-BACKUP-1)');
// =======================================================================
var orchSrc = fs.readFileSync(ORCH_PATH, 'utf8');
ok(/require\(['"]\.\.\/\.\.\/idauto\/ops\/offhost-backup\.js['"]\)/.test(orchSrc),
  '87 the orchestrator REQUIRES the existing offhost-backup module');
ok(!/createHash\(['"]sha256['"]\)\.update\(fs\.readFileSync/.test(orchSrc),
  '88 the orchestrator does not reimplement file checksumming');
ok(!/function\s+buildManifest/.test(orchSrc), '89 the orchestrator does not reimplement manifest building');
ok(!/require\(['"]fs['"]\)/.test(orchSrc), '90 the orchestrator has NO filesystem capability of its own');
ok(!/require\(['"](http|https|net|child_process)['"]\)/.test(orchSrc),
  '91 the orchestrator has no network or process-execution capability');
ok(orch.buildBackupPlan({ operation: 'backup_create' }).reuses_module === 'projects/idauto/ops/offhost-backup.js',
  '92 every plan declares the module it reuses');
ok(orch.buildBackupPlan({ operation: 'backup_create' }).creates_parallel_mechanism === false,
  '93 every plan declares it creates no parallel mechanism');
throwsWith(function () { orch.gateCheck(Object.assign(orch.buildBackupPlan({ operation: 'backup_verify' }), { reuses_module: 'projects/automation/reference/my-own-backup.js' })); },
  /REUSE_CONTRACT_VIOLATED/, '94 a plan that replaces the tooling is refused by GATE_CHECK');
throwsWith(function () { orch.gateCheck(Object.assign(orch.buildBackupPlan({ operation: 'backup_verify' }), { creates_parallel_mechanism: true })); },
  /PARALLEL_MECHANISM_REFUSED/, '95 a plan declaring a parallel mechanism is refused');

// =======================================================================
console.log('\n9. Separate validation and verification paths (O-BACKUP-1)');
// =======================================================================
var createPlan = orch.buildBackupPlan({ operation: 'backup_create' });
var restorePlan = orch.buildBackupPlan({ operation: 'restore_test' });
ok(createPlan.verification.kind === 'BACKUP_INTEGRITY', '96 the backup path verifies BACKUP_INTEGRITY');
ok(restorePlan.verification.kind === 'RESTORE_STRUCTURAL', '97 the restore path verifies RESTORE_STRUCTURAL');
ok(createPlan.verification.kind !== restorePlan.verification.kind,
  '98 the two verification kinds are genuinely distinct, not one relabelled');
ok(createPlan.steps.map(function (s) { return s.kind; }).join(',') !== restorePlan.steps.map(function (s) { return s.kind; }).join(','),
  '99 the two step sets are distinct');
ok(restorePlan.steps[0].kind === 'prove_isolation',
  '100 the restore path proves isolation FIRST, before the backup is even read');
ok(createPlan.rollback.deletes_anything === false && restorePlan.rollback.deletes_anything === false,
  '101 no rollback in either path deletes anything');
ok(/COMPLETE marker is written last/.test(createPlan.rollback.description),
  '102 an incomplete set is never advertised as restorable');

// =======================================================================
console.log('\n10. GATE_CHECK — a plan may never authorise itself');
// =======================================================================
ok(orch.gateCheck(createPlan).ok === true, '103 a well-formed plan passes GATE_CHECK');
ok(orch.gateCheck(createPlan).entry_gate_open === false, '104 the entry gate is structurally always closed');
ok(createPlan.authorises_execution === false, '105 a plan never claims to authorise execution');
throwsWith(function () { orch.gateCheck(Object.assign({}, createPlan, { authorises_execution: true })); },
  /PLAN_CLAIMS_SELF_AUTHORISATION/, '106 a self-authorising plan is refused');
throwsWith(function () { orch.gateCheck(Object.assign({}, createPlan, { automation_level: 'LEVEL_4_FULL_AUTOMATIC' })); },
  /PLAN_LEVEL_INCONSISTENT/, '107 a plan claiming LEVEL_4 is refused');
throwsWith(function () { orch.gateCheck(Object.assign({}, createPlan, { steps: [{ step_id: 'x', kind: 'rm_rf', performs_external_mutation: false }] })); },
  /UNRECOGNISED_STEP_KIND/, '108 an unrecognised step kind is refused (fail closed)');
throwsWith(function () { orch.gateCheck(Object.assign({}, createPlan, { steps: [{ step_id: 'x', kind: 'verify_local' }] })); },
  /STEP_MUTATION_FLAG_REQUIRED/, '109 a step must declare whether it mutates');
throwsWith(function () { orch.gateCheck(Object.assign({}, createPlan, { rollback: { kind: 'x', deletes_anything: true } })); },
  /ROLLBACK_DELETES_REFUSED/, '110 a rollback that deletes is refused');

// =======================================================================
console.log('\n11. No database write, no command execution, no smuggling (O-BACKUP-4)');
// =======================================================================
['persist', 'persistState', 'writeDatabase', 'table', 'connectionString', 'dsn'].forEach(function (k, i) {
  var r = { operation: 'backup_verify' }; r[k] = 'anything';
  throwsWith(function () { orch.assertNoDatabaseWrite(r); },
    /DATABASE_WRITE_NOT_AUTHORISED/, (111 + i) + ' a request carrying "' + k + '" is refused at the boundary');
});
throwsWith(function () { orch.preflight(request({ command: 'rm -rf /' })); },
  /ARBITRARY_COMMAND_REFUSED/, '117 arbitrary command execution is refused');
throwsWith(function () { orch.preflight(request({ env: { X: '1' } })); },
  /ENVIRONMENT_SMUGGLING_REFUSED/, '118 environment-variable smuggling is refused');
throwsWith(function () { orch.preflight(request({ destructive: true })); },
  /DESTRUCTIVE_FLAG_REFUSED/, '119 a --destructive style flag is refused');
throwsWith(function () { orch.preflight(request({ force: true })); },
  /DESTRUCTIVE_FLAG_REFUSED/, '120 a force flag is refused');
throwsWith(function () { orch.preflight(request({ runId: '' })); }, /RUN_ID_REQUIRED/, '121 a run id is mandatory');

// =======================================================================
console.log('\n12. Evidence record — the O-BACKUP-4 state model, secret-free');
// =======================================================================
var evidence = orch.buildEvidenceRecord({
  runId: RUN, backupReference: PREFIX, sourceScope: ['idauto', 'coolify'],
  creationResult: 'NOT_ATTEMPTED', verificationResult: 'PASS', restoreTestResult: 'NOT_ATTEMPTED',
  isolatedTargetId: 'scratch-restore-01', startedAt: '2026-08-16T00:00:00Z',
  completedAt: '2026-08-16T00:01:00Z', retentionDecision: 'REPORT_ONLY',
  failureState: 'NONE', rollbackResult: 'NOT_REQUIRED'
});
['backup_reference', 'source_scope', 'creation_result', 'verification_result', 'restore_test_result',
  'isolated_target_id', 'timestamps', 'retention_decision', 'failure_state', 'rollback_cleanup_result']
  .forEach(function (f, i) {
    ok(Object.prototype.hasOwnProperty.call(evidence, f),
      (122 + i) + ' the evidence record carries "' + f + '" (O-BACKUP-4)');
  });
ok(evidence.storage === 'DOCUMENTATION_ONLY' && evidence.persisted_to_database === false,
  '132 evidence is documentation-only; nothing is written to a database');
ok(evidence.mutations_performed === 0, '133 the evidence record reports zero mutations');
throwsWith(function () { orch.buildEvidenceRecord({ runId: RUN, sourceScope: [], password: 'hunter2' }); },
  /CREDENTIAL_VALUE_PRESENT/, '134 a secret-shaped field is refused from the evidence record');
ok(!/hunter2|AKIA/.test(JSON.stringify(evidence)), '135 no credential value appears in the evidence record');

// =======================================================================
console.log('\n13. Retention is report-only (O-BACKUP-1)');
// =======================================================================
var sets = [
  { id: 'a', created_at_utc: '2026-08-16T00:00:00Z' },
  { id: 'b', created_at_utc: '2026-08-15T00:00:00Z' },
  { id: 'c', created_at_utc: '2025-01-01T00:00:00Z' }
];
var ret = orch.planRetention({ policy: policy(), sets: sets });
ok(ret.deleted === 0, '136 the retention report deletes nothing');
ok(ret.mutations_performed === 0, '137 retention performs no mutation');
ok(/REPORT_ONLY/.test(ret.decision), '138 dropping a set requires a separate authorisation');
throwsWith(function () { orch.planRetention({ policy: policy({ covers_retention: false }), sets: sets }); },
  /RETENTION_NOT_COVERED_BY_POLICY/, '139 retention is refused unless the policy explicitly covers it');
throwsWith(function () { orch.planRetention({ policy: policy(), sets: 'not-an-array' }); },
  /BACKUP_SETS_REQUIRED/, '140 a malformed set list is refused');
// The deleted-is-zero invariant must be reachable, not a dead assertion: the
// retention function is injected so a tool that ever gained a deletion path
// would be refused here. Found by mutation — the guard previously could not
// be exercised at all.
throwsWith(function () {
  orch.planRetention({ policy: policy(), sets: sets, retentionFn: function () {
    return { keep: [], drop: sets, policy: 'x', deleted: 3 };
  } });
}, /RETENTION_DELETED_NONZERO/, '140a a retention report claiming deletions is refused');
throwsWith(function () {
  orch.planRetention({ policy: policy(), sets: sets, retentionFn: function () { return { deleted: 0 }; } });
}, /RETENTION_REPORT_INVALID/, '140b a malformed retention report is refused');
ok(orch.planRetention({ policy: policy(), sets: sets, retentionFn: offhost.retention }).deleted === 0,
  '140c the injected default is the existing report-only tooling');

// =======================================================================
console.log('\n14. The LEVEL_2 mutation ambiguity is fail-closed');
// =======================================================================
ok(orch.LEVEL_2_MAY_MUTATE_EXTERNALLY === false,
  '141 external mutation is disabled pending the owner clarification');
throwsWith(function () { orch.assertMutationPermitted('backup_create'); },
  /LEVEL_2_MUTATION_NOT_RESOLVED/, '142 a mutating operation is refused fail-closed');
await rejects(orch.executeBackupOperation(request({ operation: 'backup_create', policy: policy() })),
  /LEVEL_2_MUTATION_NOT_RESOLVED/, '143 backup creation refuses rather than writing');

// =======================================================================
console.log('\n15. Read-only operations work end to end through the existing tooling');
// =======================================================================
var adapter = memoryAdapter(completeBackupSet());
var verifyReq = request({ operation: 'backup_verify', client: adapter });
var verified = await orch.verifyBackupIntegrity(verifyReq);
ok(verified.ok === true, '144 a complete, intact backup set verifies via offhost-backup.verifyRemote');
ok(verified.verification_kind === 'BACKUP_INTEGRITY' && verified.mutations_performed === 0,
  '145 verification is BACKUP_INTEGRITY and mutates nothing');

var tampered = completeBackupSet();
tampered[PREFIX + '/database/idauto.dump'] = Buffer.from('tampered-bytes');
var badVerify = await orch.verifyBackupIntegrity(request({ operation: 'backup_verify', client: memoryAdapter(tampered) }));
ok(badVerify.ok === false, '146 a tampered object fails verification');

var incomplete = completeBackupSet();
delete incomplete[PREFIX + '/COMPLETE'];
var noMarker = await orch.verifyBackupIntegrity(request({ operation: 'backup_verify', client: memoryAdapter(incomplete) }));
ok(noMarker.ok === false, '147 a set without its COMPLETE marker is not treated as restorable');

await rejects(orch.verifyBackupIntegrity(request({ operation: 'backup_verify', prefix: '../../etc', client: adapter })),
  /BACKUP_PREFIX_UNSAFE/, '148 a traversing backup prefix is refused');

var exec = await orch.executeBackupOperation(request({ operation: 'backup_verify', client: adapter }));
ok(exec.mutations_performed === 0 && exec.result.ok === true,
  '149 executeBackupOperation runs the read-only path with zero mutations');

// =======================================================================
console.log('\n16. Dry run and the restore path');
// =======================================================================
var dry = await orch.dryRun(request({ operation: 'restore_test', target: isolatedTarget(), client: adapter }));
ok(dry.mode === 'DRY_RUN' && dry.mutations_performed === 0 && dry.terminated_before === 'APPLY',
  '150 a dry run terminates before APPLY and mutates nothing');
ok(dry.envelope.isolated_target_id === 'scratch-restore-01',
  '151 the dry run envelope names the proven-isolated target');
var dryRestore = await orch.runIsolatedRestoreTest(request({ operation: 'restore_test', target: isolatedTarget(), client: adapter, dryRun: true }));
ok(dryRestore.mode === 'DRY_RUN' && dryRestore.mutations_performed === 0,
  '152 the restore dry run performs no restore');
await rejects(orch.runIsolatedRestoreTest(request({ operation: 'restore_test', target: isolatedTarget({ restore_path: '/home/deploy' }), client: adapter })),
  /RESTORE_PATH_FORBIDDEN/, '153 a real restore to a forbidden path refuses before any read');
await rejects(orch.runIsolatedRestoreTest(request({ operation: 'restore_test', target: isolatedTarget(), client: adapter })),
  /LEVEL_2_MUTATION_NOT_RESOLVED/, '154 a real restore refuses fail-closed on the open ambiguity');
throwsWith(function () { orch.preflight(request({ operation: 'restore_test', client: adapter })); },
  /ISOLATED_TARGET_REQUIRED/, '155 a restore test without a target is refused');

// =======================================================================
console.log('\n17. Preflight envelope carries no secret and no production reference');
// =======================================================================
var prepared = orch.preflight(request({ operation: 'backup_verify', client: adapter }));
ok(prepared.envelope.secret_reference_id === 'secref-r2-backup',
  '156 the credential appears BY REFERENCE only');
ok(orch.assertNoSecrets(prepared.envelope) === true, '157 the envelope carries no secret-shaped key');
ok(!orch.looksProduction(JSON.stringify(prepared.envelope)),
  '158 no production token appears anywhere in the envelope');
ok(prepared.envelope.performs_external_mutation === false,
  '159 the verify envelope declares it performs no external mutation');
ok(/^idem-/.test(prepared.envelope.idempotency_key) && /^lock-/.test(prepared.envelope.resource_lock_key),
  '160 deterministic idempotency and resource-lock keys are derived');
ok(orch.preflight(request({ operation: 'backup_verify', client: adapter })).envelope.idempotency_key === prepared.envelope.idempotency_key,
  '161 the idempotency key is deterministic across identical runs');

// =======================================================================
console.log('\n18. looksProduction is tokenised, not substring-matched');
// =======================================================================
ok(orch.looksProduction('backup.delete.production'), '162 a dot-separated production token is caught');
ok(orch.looksProduction('mythos-prod'), '163 a hyphenated prod token is caught');
ok(orch.looksProduction('db_production'), '164 an underscored production token is caught');
ok(!orch.looksProduction('scratch-restore-01'), '165 a scratch identity is not a false positive');
ok(!orch.looksProduction('staging'), '166 staging is not a production token');
ok(!orch.looksProduction('reproduction-study'), '167 "reproduction" does not tokenise to "production"');

// =======================================================================
console.log('\n19. Committed repository facts (not fixtures)');
// =======================================================================
var committed = committedBackupConnector();
ok(committed && committed.permission === 'READ_ONLY',
  '168 the COMMITTED backup connector is READ_ONLY');
ok(committed.enabled === false, '169 the COMMITTED backup connector is disabled — nothing can run today');
ok(committed.capabilities.join(',') === 'backup.list,backup.verify',
  '170 the COMMITTED capabilities are exactly backup.list + backup.verify');
throwsWith(function () {
  orch.assertReadOnlyConnector({ connector: connector(), catalogue: [committed], featureFlags: flags(), client: readOnlyClient() });
}, /CONNECTOR_DISABLED/, '171 against the REAL committed catalogue the gate refuses — the stage is blocked today');
ok(AUT_CONFIG.feature_flags.level_2_recommend_runs === false,
  '172 the committed level_2_recommend_runs flag is false');
ok(AUT_CONFIG.feature_flags.level_3_approval_required_runs === false,
  '173 the committed LEVEL_3 flag is false and this stage never asks for it');
ok(!COMMITTED_CATALOGUE.some(function (c) {
  return (c.capabilities || []).some(function (cap) { return /backup\.(create|delete|restore|write)/.test(cap); });
}), '174 no backup create/delete/restore capability exists anywhere in the committed catalogue');

// =======================================================================
console.log('\n20. The underlying tooling keeps its own refusals (defence in depth)');
// =======================================================================
ok(typeof offhost.retention === 'function' && offhost.retention([]).deleted === 0,
  '175 offhost-backup.retention is report-only at source');
ok(offhost.safeRel('database/x.dump') === true && offhost.safeRel('../etc/passwd') === false,
  '176 offhost-backup.safeRel still rejects traversal');
ok(/\[REDACTED\]/.test(offhost.redact('secret=abc123')), '177 offhost-backup.redact still redacts');
var unsafeRestore = await offhost.restoreVerify(PREFIX, '/home/deploy', adapter, {});
ok(unsafeRestore.refused === true,
  '178 the underlying tool independently refuses an unsafe restore path');

console.log('\nStage INF-BACKUP-AUTO-0 backup operations: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

})().catch(function (e) {
  console.error('SUITE ABORTED: ' + (e && e.stack || e));
  process.exit(1);
});
