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

// ---------------------------------------------------------------------------
// OBSERVABILITY (docs/MPI_FINDINGS_REMEDIATION.md, highest-priority item):
// a failed APPEND-ONLY write must never pass silently. Every audit/provenance/
// tombstone/guard insert below runs through this guard: on failure it emits a
// structured event and RETHROWS unchanged, so transaction semantics are
// untouched — the failure stays a failure, it just stops being invisible.
// Fields are a whitelist of the table name, the error kind and opaque ids;
// never summaries, content, PII or SQL text.
async function appendOnlyGuard(client, table, ids, fn) {
  try {
    return await fn();
  } catch (e) {
    client.emit('append_only_write_failed', Object.assign({
      table: table,
      kind: (e && e.kind) || 'UNKNOWN',
      sqlstate: (e && e.sqlstate) || null
    }, ids || {}));
    throw e;
  }
}

// A + F — MEMORY CREATION WITH PROVENANCE. ATOMIC, REQUIRED.
// §5: "Every durable memory row gets a provenance row." A memory that committed
// without its provenance would be permanently unattributable, and provenance is
// immutable so it cannot be backfilled by correction — only by a new row that
// claims an origin nobody observed. One transaction, or neither row.
async function createMemoryWithProvenance(client, input) {
  return client.withTransaction(async function (exec) {
    const repos = createRepositories(exec);
    const memory = await repos.memory.create(input.memory);
    const provenance = await appendOnlyGuard(client, 'pi_memory_provenance',
      { memoryRecordId: input.memory.memoryRecordId }, function () {
        return repos.provenance.insert(
          Object.assign({}, input.provenance, { memoryRecordId: input.memory.memoryRecordId }));
      });
    return { memory: memory, provenance: provenance };
  });
}

// A2 — MEMORY + PROVENANCE + RECORD-ANCHORED EVENT (O-EV-1a, spec §34).
// ATOMIC, REQUIRED. The event is anchored to the memory record created in the
// SAME transaction — memory_record_id is derived, never caller-supplied — so a
// standalone event cannot exist, and batch ref / provenance / F8 idempotency /
// F14 tombstone semantics all inherit through the parent. A failure of any of
// the three inserts rolls back all of them.
async function createMemoryWithProvenanceAndEvent(client, input) {
  return client.withTransaction(async function (exec) {
    const repos = createRepositories(exec);
    const memory = await repos.memory.create(input.memory);
    const provenance = await appendOnlyGuard(client, 'pi_memory_provenance',
      { memoryRecordId: input.memory.memoryRecordId }, function () {
        return repos.provenance.insert(
          Object.assign({}, input.provenance, { memoryRecordId: input.memory.memoryRecordId }));
      });
    // The event inherits its subject from the parent record — anchor, user and
    // organisation are all derived, never caller-supplied (§34).
    const event = await repos.events.create(
      Object.assign({}, input.event, {
        memoryRecordId: input.memory.memoryRecordId,
        userId: input.memory.userId,
        organisationId: input.memory.organisationId
      }));
    return { memory: memory, provenance: provenance, event: event };
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
    const tombstone = await appendOnlyGuard(client, 'pi_memory_tombstones',
      { memoryRecordId: input.tombstone.memoryRecordId }, function () {
        return repos.tombstones.insert(input.tombstone);
      });
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
  // F8 (ratified 2026-08-14): provenance is MANDATORY for a reinforcement.
  // Previously it was optional, so a caller could increment evidence_count
  // while writing no provenance row — a path the unique index
  // idx_pi_provenance_observation cannot protect, because the index guards
  // the tuple, not its absence. Refused before the transaction opens.
  if (!input.provenance) {
    throw new Error('reinforceMemory: provenance is required — a reinforcement without ' +
      'provenance would raise evidence_count with no attributable observation (F8)');
  }
  return client.withTransaction(async function (exec) {
    const repos = createRepositories(exec);
    const outcome = await repos.memory.reinforce(input.memoryRecordId, input.observation);
    if (outcome.reinforced) {
      await appendOnlyGuard(client, 'pi_memory_provenance',
        { memoryRecordId: input.memoryRecordId }, function () {
          return repos.provenance.insert(
            Object.assign({}, input.provenance, { memoryRecordId: input.memoryRecordId }));
        });
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
    const audit = await appendOnlyGuard(client, 'pi_preference_audit',
      { preferenceId: input.preferenceId, preferenceAuditId: input.preferenceAuditId }, function () {
      return repos.preferenceAudit.insert({
      preferenceAuditId: input.preferenceAuditId,
      preferenceId: input.preferenceId,
      actorRef: input.actorRef,
      actorType: input.actorType,
      changeType: input.changeType,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      reasonSummary: input.reasonSummary
    });
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
    return appendOnlyGuard(client, 'pi_guard_decisions',
      { guardDecisionId: decision.guardDecisionId }, function () {
        return createRepositories(exec).guardDecisions.insert(decision);
      });
  });
}

module.exports = {
  createMemoryWithProvenance: createMemoryWithProvenance,
  createMemoryWithProvenanceAndEvent: createMemoryWithProvenanceAndEvent,
  setMemoryState: setMemoryState,
  supersedeMemory: supersedeMemory,
  tombstoneMemory: tombstoneMemory,
  reinforceMemory: reinforceMemory,
  createConflict: createConflict,
  resolveConflict: resolveConflict,
  changePreferenceStatus: changePreferenceStatus,
  recordGuardDecision: recordGuardDecision
};
