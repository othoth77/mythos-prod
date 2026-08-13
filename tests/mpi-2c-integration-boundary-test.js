// =====================================================
// MPI-2C — Integration boundary end-to-end suite (SCRATCH ONLY)
// tests/mpi-2c-integration-boundary-test.js
//
// Proves the boundary:
//     pure reference modules → persistence adapters → repositories → PostgreSQL
//
// Unlike mpi-2b-persistence-test.js (which exercises the repositories directly),
// this suite drives the REAL, UNMODIFIED reference modules — learning-engine,
// guard, context-assembler — through the adapters and asserts the resulting
// database state. PostgreSQL remains authoritative throughout.
//
//   MPI_SCRATCH_CONTAINER=<name> MPI_SCRATCH_DB=<db> node tests/mpi-2c-integration-boundary-test.js
// Without those variables the integration cases are reported as skipped, never
// as passed.
//
// All fixture values are synthetic `.invalid`. No production data, ever.
// =====================================================
'use strict';

const path = require('path');
const BASE = path.join(__dirname, '..');
const PERSIST = path.join(BASE, 'projects/personal-intelligence/persistence');
const REF = path.join(BASE, 'projects/personal-intelligence/reference');

const { createClient, KIND, PersistenceError } = require(path.join(PERSIST, 'client'));
const { createRepositories } = require(path.join(PERSIST, 'repositories'));
const lifecycles = require(path.join(PERSIST, 'lifecycles'));
const adapters = require(path.join(PERSIST, 'adapters'));
const learningEngine = require(path.join(REF, 'learning-engine'));
const assembler = require(path.join(REF, 'context-assembler'));

let passed = 0, failed = 0, skipped = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
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
// Offline: the dual-effect hazard the adapter exists to contain.
// ---------------------------------------------------------------------------
function offlineChecks() {
  console.log('\nMPI-2C BOUNDARY CONTRACT (offline)');
  const store = [{ preferenceId: 'P1', userId: 'u', organisationId: 'o', preferenceKey: 'k',
                   preferenceValueSummary: 'old', status: learningEngine.STATUS.CANDIDATE_PREFERENCE,
                   evidenceCount: 1, firstObservedAt: 't', lastObservedAt: 't' }];
  const returned = learningEngine.observe(store, {
    userId: 'u', organisationId: 'o', preferenceKey: 'k',
    preferenceValueSummary: 'new', source: 'OBSERVATION', preferenceId: 'P2' });
  ok(store[0].status === learningEngine.STATUS.SUPERSEDED,
     '1 observe() mutates a DIFFERENT record in place (the hazard is real)');
  ok(returned.preferenceId === 'P2' && returned.supersedesPreferenceId === 'P1',
     '2 returned record points at the record it supersedes (ratified direction)');
  ok(typeof adapters.persistObservation === 'function'
     && typeof adapters.persistGuardDecision === 'function'
     && typeof adapters.loadMemoryStore === 'function', '3 three adapter seams exposed');
  ok(typeof assembler.retrieveRelevantMemory === 'function',
     '4 pure retrieval entry point unchanged (consumes an injected array)');
}

// ---------------------------------------------------------------------------
// End-to-end synthetic lifecycle, steps 1-20 of the order.
// ---------------------------------------------------------------------------
async function integrationChecks(container, database) {
  const { createPsqlDriver } = require(path.join(PERSIST, 'testing', 'psql-driver'));
  const driver = createPsqlDriver({ container: container, database: database });
  const client = createClient({ driver: driver, schema: 'mythos_intelligence' });
  const S = '.invalid';
  const id = {
    dom: 'DOM_2C' + S, cap: 'CAP_2C' + S, org: 'ORG_2C' + S, usr: 'USR_2C' + S,
    m1: 'MEM_2C_1' + S, m2: 'MEM_2C_2' + S, prf: 'PRF_2C' + S
  };

  console.log('\nMPI-2C END-TO-END LIFECYCLE (real PostgreSQL)');

  await client.withTransaction(async function (exec) {
    await exec.query('INSERT INTO pi_domains (domain_id, display_name) VALUES ($1,$2)', [id.dom, 'D']);
    await exec.query(`INSERT INTO pi_domain_capabilities (capability_id, domain_id, display_name, default_automation_level)
                      VALUES ($1,$2,$3,$4)`, [id.cap, id.dom, 'C', 'LEVEL_1_READ_ONLY']);
  });

  // 1 organisation, 2 user
  const org = await client.withTransaction(function (exec) {
    return createRepositories(exec).organisations.create({
      organisationId: id.org, organisationRef: 'OREF' + S,
      organisationRefSource: 'test_source' + S, domainId: id.dom });
  });
  ok(org.organisation_id === id.org, '5 organisation creation');
  const usr = await client.withTransaction(function (exec) {
    return createRepositories(exec).users.create({
      userId: id.usr, userRef: 'UREF' + S, userRefSource: 'mythos_os_core', organisationId: id.org });
  });
  ok(usr.user_id === id.usr, '6 synthetic user creation');

  // 3 memory + 4 provenance (one transaction)
  const c1 = await lifecycles.createMemoryWithProvenance(client, {
    memory: { memoryRecordId: id.m1, userId: id.usr, organisationId: id.org,
              memoryType: 'DECISION', contentSummary: 'synthetic one', observedAt: '2026-02-01T00:00:00Z' },
    provenance: { memoryProvenanceId: 'PRV_2C_1' + S, provider: 'mythos', sourceType: 'observation',
                  sourceReference: 'hash://1' + S, confidence: 'MEDIUM' } });
  ok(c1.memory.state === 'active' && c1.provenance, '7 memory created with provenance attached');

  // 5 evidence
  const ev = await lifecycles.reinforceMemory(client, {
    memoryRecordId: id.m1, observation: { sourceReference: 'hash://2' + S },
    provenance: { memoryProvenanceId: 'PRV_2C_2' + S, provider: 'mythos', sourceType: 'observation',
                  sourceReference: 'hash://2' + S } });
  ok(ev.reinforced && Number(ev.evidenceCount) === 2, '8 evidence attached (independent observation)');

  // 6 second memory, 7 supersede, 8 verify ratified direction
  await lifecycles.createMemoryWithProvenance(client, {
    memory: { memoryRecordId: id.m2, userId: id.usr, organisationId: id.org,
              memoryType: 'DECISION', contentSummary: 'synthetic two', observedAt: '2026-04-01T00:00:00Z' },
    provenance: { memoryProvenanceId: 'PRV_2C_3' + S, provider: 'mythos', sourceType: 'observation',
                  sourceReference: 'hash://3' + S } });
  await lifecycles.supersedeMemory(client, id.m1, id.m2);
  const loser = (await client.read('SELECT state, supersedes_memory_id, superseded_at FROM pi_memory_records WHERE memory_record_id=$1', [id.m1])).rows[0];
  const winner = (await client.read('SELECT supersedes_memory_id FROM pi_memory_records WHERE memory_record_id=$1', [id.m2])).rows[0];
  ok(winner.supersedes_memory_id === id.m1, '9 winner.supersedes_memory_id = loser.memory_id');
  ok(loser.supersedes_memory_id === null, '10 loser.supersedes_memory_id IS NULL');
  ok(loser.state === 'superseded' && loser.superseded_at !== null, '11 loser marked superseded with timestamp');

  // Retrieval hydration through the pure module (seam 3)
  await lifecycles.setMemoryState(client, id.m1, 'active');
  const store = await adapters.loadMemoryStore(client, { userId: id.usr, organisationId: id.org, limit: 10 });
  const ranked = assembler.retrieveRelevantMemory({
    userId: id.usr, organisationId: id.org, memoryStore: store, limit: 10 });
  ok(store.length === 2 && ranked.length === 2, '12 memory store hydrated from PostgreSQL into the pure module');
  ok(ranked[0].memoryRecordId === id.m2, '13 pure ranking applied to hydrated rows (most recent first)');

  // 9 conflict, 10-11 mirrored rejection
  const conflict = await lifecycles.createConflict(client, {
    conflict: { memoryConflictId: 'CFL_2C' + S, userId: id.usr, organisationId: id.org,
                memoryRecordIdA: id.m2, memoryRecordIdB: id.m1, // reversed on purpose
                conflictReason: 'SAME_KEY_DIFFERENT_VALUE' } });
  ok(conflict.memory_record_id_a < conflict.memory_record_id_b, '14 conflict pair normalised before insert');
  await expectKind(function () {
    return lifecycles.createConflict(client, {
      conflict: { memoryConflictId: 'CFL_2C_DUP' + S, userId: id.usr, organisationId: id.org,
                  memoryRecordIdA: id.m1, memoryRecordIdB: id.m2,
                  conflictReason: 'SAME_KEY_DIFFERENT_VALUE' } });
  }, KIND.UNIQUE, '15 mirrored conflict rejected by the database');

  // 12 learned preference + 13 audit, via the REAL learning engine (seam 1)
  await client.withTransaction(function (exec) {
    return createRepositories(exec).preferences.create({
      preferenceId: id.prf, userId: id.usr, organisationId: id.org,
      preferenceKey: 'test.verbosity', preferenceValueSummary: 'old value',
      source: 'OBSERVATION', status: 'CANDIDATE_PREFERENCE' });
  });
  const existing = [{ preferenceId: id.prf, userId: id.usr, organisationId: id.org,
                      preferenceKey: 'test.verbosity', preferenceValueSummary: 'old value',
                      status: learningEngine.STATUS.CANDIDATE_PREFERENCE, evidenceCount: 1,
                      firstObservedAt: '2026-01-01', lastObservedAt: '2026-01-01' }];
  let n = 0;
  const outcome = await adapters.persistObservation(client, {
    existingPreferences: existing,
    observation: { userId: id.usr, organisationId: id.org, preferenceKey: 'test.verbosity',
                   preferenceValueSummary: 'new value', source: 'OBSERVATION',
                   preferenceId: 'PRF_2C_NEW' + S },
    actorRef: 'AREF' + S, actorType: 'HUMAN', reasonSummary: 'synthetic observation',
    auditIdFor: function (pid) { n += 1; return 'AUD_2C_' + n + S + '_' + pid.slice(-6); }
  });
  ok(outcome.supersededInPlace.length === 1 && outcome.supersededInPlace[0] === id.prf,
     '16 adapter detected the in-place supersession observe() performed');
  const oldPref = (await client.read('SELECT status FROM pi_learned_preferences WHERE preference_id=$1', [id.prf])).rows[0];
  const newPref = (await client.read('SELECT status, supersedes_preference_id FROM pi_learned_preferences WHERE preference_id=$1', ['PRF_2C_NEW' + S])).rows[0];
  ok(oldPref.status === 'SUPERSEDED', '17 superseded preference persisted (hazard contained)');
  ok(newPref && newPref.supersedes_preference_id === id.prf, '18 new preference points at the one it supersedes');
  const audits = (await client.read('SELECT count(*)::int AS n FROM pi_preference_audit')).rows[0];
  ok(Number(audits.n) === 2, '19 preference audit recorded for both effects');

  // 14 guard decision, via the REAL guard module (seam 2)
  const guarded = await adapters.persistGuardDecision(client, {
    guardDecisionId: 'GRD_2C' + S, userId: id.usr, organisationId: id.org, domainId: id.dom,
    automationLevelRequested: 'LEVEL_4_AUTONOMOUS',
    evaluation: { permissionDecision: 'ALLOW', capabilityId: id.cap, dataClassification: 'regulated' } });
  ok(guarded.decision === 'REQUIRE_APPROVAL',
     '20 guard narrowed ALLOW to REQUIRE_APPROVAL for regulated data, and it was persisted');

  // 15-16 audit mutation rejected
  await expectKind(function () {
    return client.withTransaction(function (exec) {
      return exec.query("UPDATE pi_guard_decisions SET decision='ALLOW' WHERE guard_decision_id=$1", ['GRD_2C' + S]);
    });
  }, KIND.APPEND_ONLY, '21 F7 guard-decision mutation rejected');
  await expectKind(function () {
    return client.withTransaction(function (exec) {
      return exec.query('DELETE FROM pi_preference_audit');
    });
  }, KIND.APPEND_ONLY, '22 F7 audit deletion rejected');

  // 17-18 rollback leaves no partial write
  const auditsBefore = (await client.read('SELECT count(*)::int AS n FROM pi_preference_audit')).rows[0].n;
  let rolled = false;
  try {
    await client.withTransaction(async function (exec) {
      const repos = createRepositories(exec);
      await repos.preferences.create({ preferenceId: 'PRF_ROLLBACK' + S, userId: id.usr,
        organisationId: id.org, preferenceKey: 'k', preferenceValueSummary: 'v', source: 'OBSERVATION' });
      await repos.preferenceAudit.insert({ preferenceAuditId: 'AUD_ROLLBACK' + S,
        preferenceId: 'PRF_ROLLBACK' + S, actorRef: 'A', actorType: 'HUMAN',
        changeType: 'CREATED', newStatus: 'CANDIDATE_PREFERENCE' });
      throw new Error('forced failure after two successful writes');
    });
  } catch (_) { rolled = true; }
  const prefGone = (await client.read('SELECT count(*)::int AS n FROM pi_learned_preferences WHERE preference_id=$1', ['PRF_ROLLBACK' + S])).rows[0];
  const auditsAfter = (await client.read('SELECT count(*)::int AS n FROM pi_preference_audit')).rows[0];
  ok(rolled && Number(prefGone.n) === 0 && Number(auditsAfter.n) === Number(auditsBefore),
     '23 rollback left no partial write, not even the append-only audit row');

  // 19-20 commit is complete and atomic
  const m3 = 'MEM_2C_3' + S;
  await lifecycles.createMemoryWithProvenance(client, {
    memory: { memoryRecordId: m3, userId: id.usr, organisationId: id.org,
              memoryType: 'DECISION', contentSummary: 'synthetic three' },
    provenance: { memoryProvenanceId: 'PRV_2C_4' + S, provider: 'mythos', sourceType: 'observation',
                  sourceReference: 'hash://4' + S } });
  const both = (await client.read(
    `SELECT (SELECT count(*)::int FROM pi_memory_records WHERE memory_record_id=$1) AS m,
            (SELECT count(*)::int FROM pi_memory_provenance WHERE memory_record_id=$1) AS p`, [m3])).rows[0];
  ok(Number(both.m) === 1 && Number(both.p) === 1, '24 commit persisted the complete atomic result (memory + provenance)');

  // 20 tombstone closes the lifecycle
  await lifecycles.tombstoneMemory(client, {
    tombstone: { memoryTombstoneId: 'TMB_2C' + S, memoryRecordId: m3, userId: id.usr,
                 organisationId: id.org, deletionReason: 'USER_REQUEST' } });
  const tombed = (await client.read('SELECT state FROM pi_memory_records WHERE memory_record_id=$1', [m3])).rows[0];
  const hidden = await adapters.loadMemoryStore(client, { userId: id.usr, organisationId: id.org, limit: 10 });
  ok(tombed.state === 'tombstoned', '25 tombstone applied');
  ok(!hidden.some(function (r) { return r.memoryRecordId === m3; }),
     '26 tombstoned memory excluded from default retrieval hydration');

  await driver.end();
}

(async function main() {
  offlineChecks();
  const container = process.env.MPI_SCRATCH_CONTAINER;
  const database = process.env.MPI_SCRATCH_DB;
  if (!container || !database) {
    skipped = 22;
    console.log('\nMPI-2C END-TO-END: SKIPPED (set MPI_SCRATCH_CONTAINER and MPI_SCRATCH_DB)');
  } else {
    try { await integrationChecks(container, database); }
    catch (e) { failed++; console.log('  FAIL end-to-end suite aborted: ' + (e && e.message)); }
  }
  console.log('\nMPI-2C integration boundary: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
  process.exit(failed === 0 ? 0 : 1);
})();
