// =====================================================
// Mythos Personal Intelligence — Persistence Adapters (integration boundary)
// projects/personal-intelligence/persistence/adapters.js
//
// The seam between the PURE reference modules and the PostgreSQL repositories:
//
//     pure domain logic (reference/*.js — unchanged)
//              ↓
//     persistence adapter (this file — translation + transaction)
//              ↓
//     repositories (repositories.js) → PostgreSQL
//
// The reference modules are deliberately NOT rewritten to be persistent. They
// are pure, deterministic and already covered by MPI-0/MPI-1 tests; making them
// database-aware would destroy that property and couple domain rules to storage.
// Every impedance mismatch is absorbed here instead.
//
// STATUS: scratch validation (MPI-2C). Not wired into any application, never
// pointed at a production database.
//
// ---------------------------------------------------------------------------
// THE HAZARD THIS FILE EXISTS TO CONTAIN
//
// learning-engine.observe(existingPreferences, observation) has TWO effects:
//   1. it RETURNS a new/updated preference record, and
//   2. it MUTATES IN PLACE a *different* record in the array it was passed,
//      setting existing.status = 'SUPERSEDED' (or incrementing evidenceCount).
//
// An adapter that persists only the return value would leave the superseded
// record still ACTIVE in the database — two live preferences for the same key,
// which is exactly the state MYTHOS_USER_MEMORY_POLICY forbids. Verified
// empirically before this file was written. persistObservation() therefore
// diffs the input array and persists both effects in ONE transaction.
// ---------------------------------------------------------------------------
// =====================================================
'use strict';

const path = require('path');
const REF = path.join(__dirname, '..', 'reference');
const learningEngine = require(path.join(REF, 'learning-engine'));
const guard = require(path.join(REF, 'guard'));
const { createRepositories } = require('./repositories');

// Observability: audit inserts in this module run through the same
// append-only failure guard as lifecycles — see docs/MPI_FINDINGS_REMEDIATION.md.
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

// Snapshot the fields observe() is known to mutate, so the mutation can be
// detected rather than assumed.
function snapshot(preferences) {
  const map = Object.create(null);
  (preferences || []).forEach(function (p) {
    map[p.preferenceId] = { status: p.status, evidenceCount: p.evidenceCount };
  });
  return map;
}

// ---------------------------------------------------------------------------
// SEAM 1 — learning. Pure observe(), then persist BOTH of its effects.
// Transaction: REQUIRED. The new/updated preference, the in-place supersession
// of the previous record, and the audit row are one fact.
// ---------------------------------------------------------------------------
async function persistObservation(client, input) {
  const before = snapshot(input.existingPreferences);
  // Pure call — no database involvement, fully deterministic.
  const result = learningEngine.observe(input.existingPreferences, input.observation);
  const after = snapshot(input.existingPreferences);

  // Which pre-existing records did observe() change in place?
  const mutated = Object.keys(after).filter(function (id) {
    return before[id] && (before[id].status !== after[id].status
                          || before[id].evidenceCount !== after[id].evidenceCount);
  });

  return client.withTransaction(async function (exec) {
    const repos = createRepositories(exec);

    // (a) the in-place mutations observe() applied to OTHER records
    for (const id of mutated) {
      // When the mutated record IS the returned one (a reinforcement mutates
      // and returns the same object), reinforce() below writes it in full —
      // a status-only update here would be a redundant write. The audit row is
      // still emitted, because the transition genuinely happened.
      if (id !== result.preferenceId) {
        await repos.preferences.updateStatus(id, after[id].status);
      }
      await appendOnlyGuard(client, 'pi_preference_audit', { preferenceId: id }, function () {
      return repos.preferenceAudit.insert({
        preferenceAuditId: input.auditIdFor(id),
        preferenceId: id,
        actorRef: input.actorRef,
        actorType: input.actorType,
        changeType: after[id].status === learningEngine.STATUS.SUPERSEDED ? 'SUPERSEDED' : 'PROMOTED',
        previousStatus: before[id].status,
        newStatus: after[id].status,
        reasonSummary: input.reasonSummary || null
      });
      });
    }

    // (b) the returned record. A brand-new preferenceId is an INSERT; an id
    //     already in the array means observe() reinforced an existing row.
    const isExisting = Object.prototype.hasOwnProperty.call(before, result.preferenceId);
    let persisted;
    if (isExisting) {
      // F13: observe() returns the SAME object it mutated, so `result` already
      // carries the incremented evidenceCount, the moved lastObservedAt and any
      // promotion the domain applied. Persist all of it. Previously this called
      // updateStatus(), which wrote only `status` — silently discarding the
      // evidence count and timestamp, so promotion could never survive a reload.
      persisted = await repos.preferences.reinforce({
        preferenceId: result.preferenceId,
        status: result.status,
        confidence: result.confidence,
        evidenceCount: result.evidenceCount,
        lastObservedAt: result.lastObservedAt
      });
    } else {
      persisted = await repos.preferences.create({
        preferenceId: result.preferenceId,
        userId: result.userId,
        organisationId: result.organisationId,
        domainId: result.domainId,
        scope: result.scope,
        status: result.status,
        preferenceKey: result.preferenceKey,
        preferenceValueSummary: result.preferenceValueSummary,
        source: result.source,
        evidenceCount: result.evidenceCount,
        confidence: result.confidence,
        // F13: carry the domain's observation timestamps into storage.
        firstObservedAt: result.firstObservedAt,
        lastObservedAt: result.lastObservedAt,
        // Same ratified direction as memory: the NEW record points at the one
        // it supersedes. §6.2 / owner ruling 2026-08-13.
        supersedesPreferenceId: result.supersedesPreferenceId
      });
      await appendOnlyGuard(client, 'pi_preference_audit', { preferenceId: result.preferenceId }, function () {
      return repos.preferenceAudit.insert({
        preferenceAuditId: input.auditIdFor(result.preferenceId),
        preferenceId: result.preferenceId,
        actorRef: input.actorRef,
        actorType: input.actorType,
        changeType: 'CREATED',
        previousStatus: null,
        newStatus: result.status,
        reasonSummary: input.reasonSummary || null
      });
      });
    }
    return { domainResult: result, persisted: persisted, supersededInPlace: mutated };
  });
}

// ---------------------------------------------------------------------------
// SEAM 2 — governance. Pure evaluate(), then record the decision.
// Transaction: standalone by design. The decision audit must survive the
// failure or rollback of whatever action it authorised — a rolled-back action
// must not erase the record that a decision was taken. So this is NEVER
// enlisted in the caller's transaction.
//
// ORDERING: the decision is evaluated and PERSISTED BEFORE the protected
// action runs. Persisting afterwards would lose the record precisely when it
// matters most — when the action crashed.
// ---------------------------------------------------------------------------
async function persistGuardDecision(client, input) {
  const decision = guard.evaluate(input.evaluation); // pure, may throw on bad input
  const row = await client.withTransaction(async function (exec) {
    return createRepositories(exec).guardDecisions.insert({
      guardDecisionId: input.guardDecisionId,
      userId: input.userId,
      organisationId: input.organisationId,
      domainId: input.domainId,
      capabilityId: input.evaluation.capabilityId,
      automationLevelRequested: input.automationLevelRequested,
      dataClassification: input.evaluation.dataClassification,
      decision: decision
    });
  });
  return { decision: decision, persisted: row };
}

// ---------------------------------------------------------------------------
// SEAM 3 — retrieval hydration. context-assembler.retrieveRelevantMemory()
// consumes an injected `memoryStore` ARRAY. This loads that array from
// PostgreSQL and maps column names to the field names the pure module reads
// (lastObservedAt / createdAt for its ordering).
//
// Transaction: NOT required — a single consistent read. `limit` is mandatory:
// the repository refuses unbounded retrieval, and loadAllUserMemory() is named
// an anti-pattern by the memory policy.
// ---------------------------------------------------------------------------
async function loadMemoryStore(client, query) {
  const rows = await client.withTransaction(async function (exec) {
    return createRepositories(exec).memory.retrieve({
      userId: query.userId,
      organisationId: query.organisationId,
      includeStates: query.includeStates,
      limit: query.limit
    });
  });
  return rows.map(function (r) {
    return {
      memoryRecordId: r.memory_record_id,
      userId: r.user_id,
      organisationId: r.organisation_id,
      domainId: r.domain_id,
      scope: r.scope,
      memoryType: r.memory_type,
      contentSummary: r.content_summary,
      state: r.state,
      evidenceCount: r.evidence_count,
      lastObservedAt: r.observed_at || r.updated_at,
      createdAt: r.created_at
    };
  });
}

module.exports = {
  persistObservation: persistObservation,
  persistGuardDecision: persistGuardDecision,
  loadMemoryStore: loadMemoryStore
};
