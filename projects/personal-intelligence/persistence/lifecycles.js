// =====================================================
// Mythos Personal Intelligence — Lifecycle Transaction Boundaries
// projects/personal-intelligence/persistence/lifecycles.js
//
// Implements the transaction requirements in docs/MYTHOS_MEMORY_ENGINE_
// ARCHITECTURE.md §18.7. Each exported function is ONE unit of work; the
// comment above it states why atomicity is or is not required.
//
// STATUS: scratch implementation (MPI-2B). Not production-wired.
// =====================================================
'use strict';

const { createRepositories } = require('./repositories');

// A + F — MEMORY CREATION WITH PROVENANCE. ATOMIC, REQUIRED.
// §5: "Every durable memory row gets a provenance row." A memory that committed
// without its provenance would be permanently unattributable, and provenance is
// immutable so it cannot be backfilled by correction — only by a new row that
// claims an origin nobody observed. One transaction, or neither row.
async function createMemoryWithProvenance(client, input) {
  return client.withTransaction(async function (exec) {
    const repos = createRepositories(exec);
    const memory = await repos.memory.create(input.memory);
    const provenance = await repos.provenance.insert(
      Object.assign({}, input.provenance, { memoryRecordId: input.memory.memoryRecordId }));
    return { memory: memory, provenance: provenance };
  });
}

// B — MEMORY UPDATE (state only). ATOMIC, TRIVIALLY.
// Single statement; a transaction adds nothing but is used for search_path
// consistency, which is the F1 guard.
async function setMemoryState(client, memoryRecordId, state) {
  return client.withTransaction(async function (exec) {
    return createRepositories(exec).memory.setState(memoryRecordId, state);
  });
}

// C — SUPERSESSION. ATOMIC, REQUIRED.
// Two rows change: the loser becomes `superseded`, the winner gains the pointer.
// A partial commit would leave either two active contradictory memories or a
// superseded row nothing supersedes — §6.2 forbids both.
async function supersedeMemory(client, loserId, winnerId) {
  return client.withTransaction(async function (exec) {
    return createRepositories(exec).memory.supersede(loserId, winnerId);
  });
}

// D — TOMBSTONING. ATOMIC, REQUIRED.
// §4 rule 4: deletion is a tombstone, never a row removal. The tombstone row and
// the state change are one fact. A tombstone without the state change would let
// retrieval keep returning deleted memory, which is the exact failure the
// tombstone exists to prevent.
async function tombstoneMemory(client, input) {
  return client.withTransaction(async function (exec) {
    const repos = createRepositories(exec);
    const tombstone = await repos.tombstones.insert(input.tombstone);
    const state = await repos.memory.setState(input.tombstone.memoryRecordId, 'tombstoned');
    return { tombstone: tombstone, state: state };
  });
}

// E — EVIDENCE ATTACHMENT / REINFORCEMENT. ATOMIC, REQUIRED.
// §6.2: reinforcement counts independent observations only. The independence
// check reads provenance and the increment writes the memory row; without one
// transaction, two concurrent imports of the same artefact could both observe
// "no matching source" and both increment — the precise double-count the rule
// forbids. Recorded provenance and the increment must agree.
async function reinforceMemory(client, input) {
  return client.withTransaction(async function (exec) {
    const repos = createRepositories(exec);
    const outcome = await repos.memory.reinforce(input.memoryRecordId, input.observation);
    if (outcome.reinforced && input.provenance) {
      await repos.provenance.insert(
        Object.assign({}, input.provenance, { memoryRecordId: input.memoryRecordId }));
    }
    return outcome;
  });
}

// G — CONFLICT CREATION. ATOMIC, REQUIRED.
// §6.2: both rows move to `disputed` and the conflict row links them. A conflict
// row whose subjects are still `active` would be invisible to retrieval, which
// filters on state — the contradiction would be recorded and never surfaced.
async function createConflict(client, input) {
  return client.withTransaction(async function (exec) {
    const repos = createRepositories(exec);
    const conflict = await repos.conflicts.create(input.conflict);
    await repos.memory.setState(input.conflict.memoryRecordIdA, 'disputed');
    await repos.memory.setState(input.conflict.memoryRecordIdB, 'disputed');
    return conflict;
  });
}

// G — CONFLICT RESOLUTION. ATOMIC, REQUIRED.
// Resolution flips the conflict and returns the surviving memory to `active`
// while the loser becomes `superseded`. Whether precedence may resolve this
// automatically at all is owner decision D4; this function only executes an
// already-made decision.
async function resolveConflict(client, input) {
  return client.withTransaction(async function (exec) {
    const repos = createRepositories(exec);
    const resolved = await repos.conflicts.resolve(input.memoryConflictId, input.resolution);
    if (input.winnerId && input.loserId) {
      await repos.memory.supersede(input.loserId, input.winnerId);
      await repos.memory.setState(input.winnerId, 'active');
    }
    return resolved;
  });
}

// H + I — PREFERENCE CHANGE WITH AUDIT. ATOMIC, REQUIRED.
// The audit row is the only durable record of who changed what. If the
// preference change committed and the audit did not, the system would hold a
// changed preference with no provenance for the change — and the audit table is
// append-only, so it could never be corrected afterwards.
async function changePreferenceStatus(client, input) {
  return client.withTransaction(async function (exec) {
    const repos = createRepositories(exec);
    const updated = await repos.preferences.updateStatus(input.preferenceId, input.newStatus);
    const audit = await repos.preferenceAudit.insert({
      preferenceAuditId: input.preferenceAuditId,
      preferenceId: input.preferenceId,
      actorRef: input.actorRef,
      actorType: input.actorType,
      changeType: input.changeType,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      reasonSummary: input.reasonSummary
    });
    return { preference: updated, audit: audit };
  });
}

// J — GUARD DECISION. ATOMIC, SINGLE-ROW, AND DELIBERATELY STANDALONE.
// §9: MPI consumes permission decisions and records them. The audit row must be
// written even when the action it authorised subsequently fails, so it is never
// enlisted in the caller's transaction — a rolled-back action must not erase the
// record that a decision was made.
async function recordGuardDecision(client, decision) {
  return client.withTransaction(async function (exec) {
    return createRepositories(exec).guardDecisions.insert(decision);
  });
}

module.exports = {
  createMemoryWithProvenance: createMemoryWithProvenance,
  setMemoryState: setMemoryState,
  supersedeMemory: supersedeMemory,
  tombstoneMemory: tombstoneMemory,
  reinforceMemory: reinforceMemory,
  createConflict: createConflict,
  resolveConflict: resolveConflict,
  changePreferenceStatus: changePreferenceStatus,
  recordGuardDecision: recordGuardDecision
};
