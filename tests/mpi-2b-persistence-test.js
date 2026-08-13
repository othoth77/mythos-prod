// =====================================================
// MPI-2B — Persistence layer integration suite (SCRATCH ONLY)
// tests/mpi-2b-persistence-test.js
//
// Runs every case against a REAL PostgreSQL 15 scratch container. PostgreSQL is
// authoritative: foreign keys, CHECK constraints and the F7 append-only triggers
// decide pass/fail. Nothing is stubbed.
//
// Requires an isolated scratch container with the ratified schema applied:
//   MPI_SCRATCH_CONTAINER=<name> MPI_SCRATCH_DB=<db> node tests/mpi-2b-persistence-test.js
// Without those variables the suite runs its offline contract checks only and
// reports the integration cases as skipped — it never invents a result.
//
// All fixture values are synthetic `.invalid`. No production data, ever.
// =====================================================
'use strict';

const path = require('path');
const root = path.join(__dirname, '..', 'projects/personal-intelligence/persistence');
const { createClient, KIND, PersistenceError } = require(path.join(root, 'client'));
const { createRepositories, canonicalPair, assertState } = require(path.join(root, 'repositories'));
const lifecycles = require(path.join(root, 'lifecycles'));

let passed = 0, failed = 0, skipped = 0;
function ok(value, label) {
  if (value) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
async function expectKind(fn, kind, label) {
  try { await fn(); ok(false, label + ' (expected ' + kind + ', but it succeeded)'); }
  catch (e) {
    if (e instanceof PersistenceError && e.kind === kind) ok(true, label);
    else ok(false, label + ' (got ' + (e && e.kind ? e.kind : e && e.message) + ')');
  }
}

// ---------------------------------------------------------------------------
// Offline contract checks — no database required.
// ---------------------------------------------------------------------------
function offlineChecks() {
  console.log('\nMPI-2B OFFLINE CONTRACT');
  ok(canonicalPair('B', 'A').a === 'A' && canonicalPair('B', 'A').b === 'B', '1 F4 pair normalised (B,A)->(A,B)');
  ok(canonicalPair('A', 'B').a === 'A', '2 F4 already-canonical pair unchanged');
  let threw = false; try { canonicalPair('A', 'A'); } catch (_) { threw = true; }
  ok(threw, '3 F4 identical pair rejected before the database');
  threw = false; try { assertState('nonsense'); } catch (_) { threw = true; }
  ok(threw, '4 invalid memory state rejected by the layer');
  ok(assertState('active') === undefined, '5 valid memory state accepted');
  threw = false; try { createClient({ driver: { query: function () {} }, schema: 'public' }); } catch (_) { threw = true; }
  ok(threw, '6 F1 guard — schema "public" refused at construction');
  threw = false; try { createClient({}); } catch (_) { threw = true; }
  ok(threw, '7 driver is required (no implicit connection)');
  const repos = createRepositories({ query: async function () { return { rows: [] }; } });
  ok(typeof repos.preferenceAudit.insert === 'function'
     && repos.preferenceAudit.update === undefined
     && repos.preferenceAudit.remove === undefined, '8 F7 audit repository exposes no update/delete path');
  ok(repos.guardDecisions.update === undefined && repos.guardDecisions.remove === undefined,
     '9 F7 guard repository exposes no update/delete path');
  ok(repos.provenance.update === undefined && repos.tombstones.remove === undefined,
     '10 F7 provenance/tombstone repositories are insert-only');
  ok(typeof repos.preferences.remove === 'function',
     '11 preferences remain mutable (memory policy: never immutable)');
}

// ---------------------------------------------------------------------------
// Integration cases — real PostgreSQL.
// ---------------------------------------------------------------------------
async function integrationChecks(container, database) {
  const { createPsqlDriver } = require(path.join(root, 'testing', 'psql-driver'));
  const driver = createPsqlDriver({ container: container, database: database });
  const client = createClient({ driver: driver, schema: 'mythos_intelligence' });
  const S = '.invalid';
  const ids = {
    dom: 'DOM_2B' + S, cap: 'CAP_2B' + S, org: 'ORG_2B' + S, usr: 'USR_2B' + S,
    memA: 'MEM_2B_A' + S, memB: 'MEM_2B_B' + S, memC: 'MEM_2B_C' + S,
    prf: 'PRF_2B' + S, aud: 'AUD_2B' + S, grd: 'GRD_2B' + S
  };

  console.log('\nMPI-2B INTEGRATION (real PostgreSQL)');

  // Registry rows are migration/seed data, so they are inserted directly.
  await client.withTransaction(async function (exec) {
    await exec.query("INSERT INTO pi_domains (domain_id, display_name) VALUES ($1,$2)", [ids.dom, 'Test Domain']);
    await exec.query(`INSERT INTO pi_domain_capabilities (capability_id, domain_id, display_name, default_automation_level)
                      VALUES ($1,$2,$3,$4)`, [ids.cap, ids.dom, 'Cap', 'LEVEL_1_READ_ONLY']);
  });

  // 1 organisation creation
  const org = await client.withTransaction(async function (exec) {
    return createRepositories(exec).organisations.create({
      organisationId: ids.org, organisationRef: 'OREF' + S,
      organisationRefSource: 'test_source' + S, domainId: ids.dom });
  });
  ok(org && org.organisation_id === ids.org, '12 organisation creation');

  // 2 user creation
  const usr = await client.withTransaction(async function (exec) {
    return createRepositories(exec).users.create({
      userId: ids.usr, userRef: 'UREF' + S, userRefSource: 'mythos_os_core',
      organisationId: ids.org, locale: 'ar-TN' });
  });
  ok(usr && usr.user_id === ids.usr, '13 user creation');

  // 3 + 4 memory creation with provenance, one transaction
  const created = await lifecycles.createMemoryWithProvenance(client, {
    memory: { memoryRecordId: ids.memA, userId: ids.usr, organisationId: ids.org,
              memoryType: 'DECISION', contentSummary: 'synthetic A', observedAt: '2026-03-01T00:00:00Z' },
    provenance: { memoryProvenanceId: 'PRV_2B_A' + S, provider: 'mythos',
                  sourceType: 'observation', sourceReference: 'hash://a' + S, confidence: 'MEDIUM' }
  });
  ok(created.memory.state === 'active' && created.memory.evidence_count === 1, '14 memory creation defaults state=active, evidence_count=1');
  ok(created.provenance && created.provenance.memory_provenance_id === 'PRV_2B_A' + S, '15 provenance insertion (atomic with memory)');

  // 5 evidence: duplicate source must NOT inflate confidence (§6.2)
  const dup = await lifecycles.reinforceMemory(client, {
    memoryRecordId: ids.memA, observation: { sourceReference: 'hash://a' + S, materiallyLater: false } });
  ok(dup.reinforced === false, '16 reinforcement rejected for duplicate source (no confidence inflation)');
  const indep = await lifecycles.reinforceMemory(client, {
    memoryRecordId: ids.memA, observation: { sourceReference: 'hash://b' + S, materiallyLater: false },
    provenance: { memoryProvenanceId: 'PRV_2B_B' + S, provider: 'mythos', sourceType: 'observation', sourceReference: 'hash://b' + S } });
  ok(indep.reinforced === true && Number(indep.evidenceCount) === 2, '17 reinforcement accepted for independent observation');

  // 6 memory state transition
  const st = await lifecycles.setMemoryState(client, ids.memA, 'disputed');
  ok(st && st.state === 'disputed', '18 memory state transition');
  await lifecycles.setMemoryState(client, ids.memA, 'active');

  // 7 supersession
  await lifecycles.createMemoryWithProvenance(client, {
    memory: { memoryRecordId: ids.memB, userId: ids.usr, organisationId: ids.org,
              memoryType: 'DECISION', contentSummary: 'synthetic B' },
    provenance: { memoryProvenanceId: 'PRV_2B_C' + S, provider: 'mythos', sourceType: 'observation', sourceReference: 'hash://c' + S }
  });
  await lifecycles.supersedeMemory(client, ids.memA, ids.memB);
  const loser = (await client.read('SELECT state, superseded_at FROM pi_memory_records WHERE memory_record_id=$1', [ids.memA])).rows[0];
  const winner = (await client.read('SELECT supersedes_memory_id FROM pi_memory_records WHERE memory_record_id=$1', [ids.memB])).rows[0];
  ok(loser.state === 'superseded' && loser.superseded_at !== null, '19 supersession marks loser superseded with timestamp');
  ok(winner.supersedes_memory_id === ids.memA, '20 supersession points winner at loser');

  // 8 retrieval honours includeStates default
  const active = await client.withTransaction(async function (exec) {
    return createRepositories(exec).memory.retrieve({ userId: ids.usr, organisationId: ids.org, limit: 10 });
  });
  ok(active.every(function (r) { return r.state === 'active'; }), '21 retrieval returns only active by default');
  let unbounded = false;
  try {
    await client.withTransaction(async function (exec) {
      return createRepositories(exec).memory.retrieve({ userId: ids.usr, organisationId: ids.org });
    });
  } catch (_) { unbounded = true; }
  ok(unbounded, '22 unbounded retrieval refused (limit required)');

  // 9 tombstone
  await lifecycles.createMemoryWithProvenance(client, {
    memory: { memoryRecordId: ids.memC, userId: ids.usr, organisationId: ids.org,
              memoryType: 'DECISION', contentSummary: 'synthetic C' },
    provenance: { memoryProvenanceId: 'PRV_2B_D' + S, provider: 'mythos', sourceType: 'observation', sourceReference: 'hash://d' + S }
  });
  await lifecycles.tombstoneMemory(client, {
    tombstone: { memoryTombstoneId: 'TMB_2B' + S, memoryRecordId: ids.memC, userId: ids.usr,
                 organisationId: ids.org, deletionReason: 'USER_REQUEST' } });
  const tombed = (await client.read('SELECT state FROM pi_memory_records WHERE memory_record_id=$1', [ids.memC])).rows[0];
  ok(tombed.state === 'tombstoned', '23 tombstoning sets state and records the tombstone atomically');

  // 10 conflict creation, and 11 mirrored rejection
  await lifecycles.setMemoryState(client, ids.memA, 'active');
  const conflict = await lifecycles.createConflict(client, {
    conflict: { memoryConflictId: 'CFL_2B' + S, userId: ids.usr, organisationId: ids.org,
                memoryRecordIdA: ids.memB, memoryRecordIdB: ids.memA, // deliberately reversed
                conflictReason: 'SAME_KEY_DIFFERENT_VALUE' } });
  ok(conflict.memory_record_id_a < conflict.memory_record_id_b, '24 F4 layer normalised a reversed pair before insert');
  await expectKind(function () {
    return lifecycles.createConflict(client, {
      conflict: { memoryConflictId: 'CFL_2B_DUP' + S, userId: ids.usr, organisationId: ids.org,
                  memoryRecordIdA: ids.memA, memoryRecordIdB: ids.memB,
                  conflictReason: 'SAME_KEY_DIFFERENT_VALUE' } });
  }, KIND.UNIQUE, '25 F4 mirrored duplicate rejected by the database');

  // 12 preference + 13 immutable audit insertion
  await client.withTransaction(async function (exec) {
    return createRepositories(exec).preferences.create({
      preferenceId: ids.prf, userId: ids.usr, organisationId: ids.org,
      preferenceKey: 'test.verbosity', preferenceValueSummary: 'concise', source: 'OBSERVATION' });
  });
  const changed = await lifecycles.changePreferenceStatus(client, {
    preferenceId: ids.prf, preferenceAuditId: ids.aud, actorRef: 'AREF' + S, actorType: 'HUMAN',
    changeType: 'PROMOTED', previousStatus: 'CANDIDATE_PREFERENCE', newStatus: 'ESTABLISHED_PREFERENCE' });
  ok(changed.preference.status === 'ESTABLISHED_PREFERENCE' && changed.audit.preference_audit_id === ids.aud,
     '26 preference update and audit written in one transaction');

  // 14 guard decision insertion
  const guard = await lifecycles.recordGuardDecision(client, {
    guardDecisionId: ids.grd, userId: ids.usr, organisationId: ids.org, domainId: ids.dom,
    capabilityId: ids.cap, automationLevelRequested: 'LEVEL_3_APPROVAL',
    dataClassification: 'regulated', decision: 'REQUIRE_APPROVAL' });
  ok(guard.decision === 'REQUIRE_APPROVAL', '27 guard decision insertion');

  // 15 + 16 forbidden audit UPDATE / DELETE — the database must refuse even when
  // a caller bypasses the repositories and issues raw SQL.
  await expectKind(function () {
    return client.withTransaction(async function (exec) {
      return exec.query("UPDATE pi_preference_audit SET new_status='TAMPERED' WHERE preference_audit_id=$1", [ids.aud]);
    });
  }, KIND.APPEND_ONLY, '28 F7 raw UPDATE on audit rejected by trigger');
  await expectKind(function () {
    return client.withTransaction(async function (exec) {
      return exec.query('DELETE FROM pi_preference_audit WHERE preference_audit_id=$1', [ids.aud]);
    });
  }, KIND.APPEND_ONLY, '29 F7 raw DELETE on audit rejected by trigger');
  await expectKind(function () {
    return client.withTransaction(async function (exec) {
      return exec.query("UPDATE pi_guard_decisions SET decision='ALLOW' WHERE guard_decision_id=$1", [ids.grd]);
    });
  }, KIND.APPEND_ONLY, '30 F7 regulated REQUIRE_APPROVAL cannot be flipped to ALLOW');
  const stillGuard = (await client.read('SELECT decision FROM pi_guard_decisions WHERE guard_decision_id=$1', [ids.grd])).rows[0];
  ok(stillGuard.decision === 'REQUIRE_APPROVAL', '31 guard decision unchanged after rejected tamper attempt');

  // 17 invalid FK rejection
  await expectKind(function () {
    return client.withTransaction(async function (exec) {
      return createRepositories(exec).memory.create({
        memoryRecordId: 'MEM_ORPHAN' + S, userId: 'USR_DOES_NOT_EXIST' + S,
        organisationId: ids.org, memoryType: 'DECISION', contentSummary: 'orphan' });
    });
  }, KIND.FOREIGN_KEY, '32 F2 invalid foreign key rejected by the database');

  // 18 invalid state rejection at the database (bypassing the layer's guard)
  await expectKind(function () {
    return client.withTransaction(async function (exec) {
      return exec.query("UPDATE pi_memory_records SET state='not_a_state' WHERE memory_record_id=$1", [ids.memB]);
    });
  }, KIND.CHECK, '33 invalid state rejected by CHECK even when the layer is bypassed');

  // 19 transaction rollback
  let rolled = false;
  try {
    await client.withTransaction(async function (exec) {
      await exec.query("INSERT INTO pi_domains (domain_id, display_name) VALUES ($1,$2)", ['DOM_ROLLBACK' + S, 'vanishes']);
      throw new Error('forced failure after a successful write');
    });
  } catch (_) { rolled = true; }
  const gone = (await client.read('SELECT count(*)::int AS n FROM pi_domains WHERE domain_id=$1', ['DOM_ROLLBACK' + S])).rows[0];
  ok(rolled && Number(gone.n) === 0, '34 transaction rollback discards a committed-in-progress write');

  // 20 transaction commit
  await client.withTransaction(async function (exec) {
    await exec.query("INSERT INTO pi_domains (domain_id, display_name) VALUES ($1,$2)", ['DOM_COMMIT' + S, 'persists']);
  });
  const stayed = (await client.read('SELECT count(*)::int AS n FROM pi_domains WHERE domain_id=$1', ['DOM_COMMIT' + S])).rows[0];
  ok(Number(stayed.n) === 1, '35 transaction commit persists');

  // 21 F1 — the layer never silently uses public
  const where = (await client.read("SELECT current_schema() AS s")).rows[0];
  ok(where.s === 'mythos_intelligence', '36 F1 search_path explicitly targets mythos_intelligence');

  await driver.end();
}

(async function main() {
  offlineChecks();
  const container = process.env.MPI_SCRATCH_CONTAINER;
  const database = process.env.MPI_SCRATCH_DB;
  if (!container || !database) {
    skipped = 25;
    console.log('\nMPI-2B INTEGRATION: SKIPPED (set MPI_SCRATCH_CONTAINER and MPI_SCRATCH_DB)');
  } else {
    try { await integrationChecks(container, database); }
    catch (e) { failed++; console.log('  FAIL integration suite aborted: ' + (e && e.message)); }
  }
  console.log('\nMPI-2B persistence: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
  process.exit(failed === 0 ? 0 : 1);
})();
