// =====================================================
// Mythos Personal Intelligence — Repositories
// projects/personal-intelligence/persistence/repositories.js
//
// Repository boundaries per docs/MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md §18.7:
// one repository per aggregate, and no repository writes another's tables.
//
// STATUS: scratch implementation (MPI-2B). Validated only against a throwaway
// PostgreSQL 15.18. Never pointed at a production database.
//
// TABLES DELIBERATELY WITHOUT A REPOSITORY (§2 requires stating why):
//   pi_capability_runtime_status — every capability is runtime_available=false;
//       there is no runtime to report status from yet.
//   pi_knowledge_sources        — no connector exists (feature_flags
//       .knowledge_source_connectors = false), so nothing can register a source.
//   pi_context_packages         — written by MPI-1's compiler, which is not
//       persistence-backed; adding a repository now would invent a lifecycle.
//   pi_entity_references        — blocked on owner decision D2 (may MPI
//       originate entities at all).
//   pi_feedback_events          — no runtime emits feedback signals yet.
//   pi_domain_capabilities / pi_domains / pi_user_domain_access — registry data
//       loaded by migration/seed, not by an application lifecycle. Read helpers
//       only, no write repository.
// Each becomes a repository when the lifecycle that writes it exists, not before.
// =====================================================
'use strict';

const APPEND_ONLY_TABLES = [
  'pi_preference_audit',
  'pi_guard_decisions',
  'pi_memory_tombstones',
  'pi_memory_provenance'
];

const MEMORY_STATES = ['active', 'superseded', 'disputed', 'tombstoned'];

// F4 — the persistence layer normalises pair order BEFORE insert. The database
// CHECK (a < b) remains authoritative; this exists so a caller cannot produce a
// hard error simply by passing the pair the other way round.
function canonicalPair(a, b) {
  if (a === b) throw new Error('conflict pair requires two distinct memory records');
  return a < b ? { a: a, b: b } : { a: b, b: a };
}

function assertState(state) {
  if (MEMORY_STATES.indexOf(state) === -1) {
    throw new Error('invalid memory state "' + state + '" — allowed: ' + MEMORY_STATES.join(', '));
  }
}

// ---------------------------------------------------------------------------
// Organisations / users — the control-plane spine.
// ---------------------------------------------------------------------------
function organisationRepository(exec) {
  return {
    async create(o) {
      const r = await exec.query(
        `INSERT INTO pi_organisations
           (organisation_id, organisation_ref, organisation_ref_source, domain_id, automation_policy_ceiling)
         VALUES ($1,$2,$3,$4,COALESCE($5,'LEVEL_1_READ_ONLY'))
         RETURNING organisation_id`,
        [o.organisationId, o.organisationRef, o.organisationRefSource, o.domainId, o.automationPolicyCeiling || null]);
      return r.rows[0];
    },
    async findById(id) {
      const r = await exec.query('SELECT * FROM pi_organisations WHERE organisation_id = $1', [id]);
      return r.rows[0] || null;
    }
  };
}

function userRepository(exec) {
  return {
    async create(u) {
      const r = await exec.query(
        `INSERT INTO pi_users (user_id, user_ref, user_ref_source, organisation_id, locale, memory_enabled)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,TRUE))
         RETURNING user_id`,
        [u.userId, u.userRef, u.userRefSource, u.organisationId, u.locale || null,
         u.memoryEnabled === undefined ? null : u.memoryEnabled]);
      return r.rows[0];
    },
    async findById(id) {
      const r = await exec.query('SELECT * FROM pi_users WHERE user_id = $1', [id]);
      return r.rows[0] || null;
    }
  };
}

// ---------------------------------------------------------------------------
// Memory records — owns the seven MPI-2A columns.
// ---------------------------------------------------------------------------
function memoryRepository(exec) {
  return {
    async create(m) {
      if (m.state !== undefined) assertState(m.state);
      const r = await exec.query(
        `INSERT INTO pi_memory_records
           (memory_record_id, user_id, organisation_id, domain_id, memory_type, scope,
            content_summary, content_reference, is_redacted, session_id, expires_at,
            state, supersedes_memory_id, observed_at, valid_from, valid_to, evidence_count)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,'user'),$7,$8,COALESCE($9,TRUE),$10,$11,
                 COALESCE($12,'active'),$13,$14,$15,$16,COALESCE($17,1))
         RETURNING memory_record_id, state, evidence_count`,
        [m.memoryRecordId, m.userId, m.organisationId, m.domainId || null, m.memoryType,
         m.scope || null, m.contentSummary, m.contentReference || null,
         m.isRedacted === undefined ? null : m.isRedacted, m.sessionId || null,
         m.expiresAt || null, m.state || null, m.supersedesMemoryId || null,
         m.observedAt || null, m.validFrom || null, m.validTo || null,
         m.evidenceCount === undefined ? null : m.evidenceCount]);
      return r.rows[0];
    },

    async findById(id) {
      const r = await exec.query('SELECT * FROM pi_memory_records WHERE memory_record_id = $1', [id]);
      return r.rows[0] || null;
    },

    // §10: includeStates defaults to ['active']; limit is REQUIRED and has no
    // "all" value — loadAllUserMemory() is named an anti-pattern by the policy.
    async retrieve(q) {
      if (typeof q.limit !== 'number' || q.limit <= 0) {
        throw new Error('retrieve: a positive limit is required — unbounded retrieval is forbidden');
      }
      const states = q.includeStates || ['active'];
      states.forEach(assertState);
      const r = await exec.query(
        `SELECT * FROM pi_memory_records
          WHERE user_id = $1 AND organisation_id = $2 AND state = ANY($3)
          ORDER BY observed_at DESC NULLS LAST, memory_record_id
          LIMIT $4`,
        [q.userId, q.organisationId, states, q.limit]);
      return r.rows;
    },

    async setState(id, state) {
      assertState(state);
      const r = await exec.query(
        'UPDATE pi_memory_records SET state = $2, updated_at = NOW() WHERE memory_record_id = $1 RETURNING state',
        [id, state]);
      return r.rows[0] || null;
    },

    // §6.2. POINTER DIRECTION IS RATIFIED (owner ruling, 2026-08-13):
    //     winner.supersedes_memory_id = loser.memory_record_id
    // The surviving, newer record points at the record it supersedes. The loser
    // holds no pointer to the winner; it only gets state='superseded' and
    // superseded_at. The column name describes the action of the row carrying it
    // toward the row it references, matching the pi_learned_preferences
    // precedent. Do not invert this without a new ruling — §6.2 is authoritative.
    async supersede(loserId, winnerId) {
      await exec.query(
        `UPDATE pi_memory_records
            SET state = 'superseded', superseded_at = NOW(), updated_at = NOW()
          WHERE memory_record_id = $1`, [loserId]);
      const r = await exec.query(
        `UPDATE pi_memory_records
            SET supersedes_memory_id = $2, updated_at = NOW()
          WHERE memory_record_id = $1
        RETURNING memory_record_id, supersedes_memory_id`, [winnerId, loserId]);
      return r.rows[0] || null;
    },

    // §6.2 — reinforcement counts INDEPENDENT observations only. Re-importing
    // the same artefact twice must count once, or confidence measures verbosity
    // rather than truth. Independence is decided from existing provenance, so
    // this reads pi_memory_provenance but never writes it.
    async reinforce(id, observation) {
      const existing = await exec.query(
        'SELECT source_reference, observed_at FROM pi_memory_provenance WHERE memory_record_id = $1',
        [id]);
      const sameSource = existing.rows.some(function (row) {
        return row.source_reference === observation.sourceReference;
      });
      if (sameSource && !observation.materiallyLater) {
        return { reinforced: false, reason: 'duplicate observation from the same source' };
      }
      const r = await exec.query(
        `UPDATE pi_memory_records
            SET evidence_count = evidence_count + 1, updated_at = NOW()
          WHERE memory_record_id = $1
        RETURNING evidence_count`, [id]);
      return { reinforced: true, evidenceCount: r.rows[0] ? r.rows[0].evidence_count : null };
    }
  };
}

// ---------------------------------------------------------------------------
// APPEND-ONLY repositories (F7). These expose insert() and read helpers ONLY.
// There is deliberately no update or delete method: the safest guarantee that
// application code never rewrites history is that no code path exists to try.
// The database triggers remain authoritative regardless.
// ---------------------------------------------------------------------------
function provenanceRepository(exec) {
  return {
    async insert(p) {
      const r = await exec.query(
        `INSERT INTO pi_memory_provenance
           (memory_provenance_id, memory_record_id, provider, source_type, source_reference,
            import_batch_ref, observed_at, confidence, actor_ref, actor_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'LOW'),$9,$10)
         RETURNING memory_provenance_id`,
        [p.memoryProvenanceId, p.memoryRecordId, p.provider, p.sourceType,
         p.sourceReference || null, p.importBatchRef || null, p.observedAt || null,
         p.confidence || null, p.actorRef || null, p.actorType || null]);
      return r.rows[0];
    },
    async listForMemory(id) {
      const r = await exec.query(
        'SELECT * FROM pi_memory_provenance WHERE memory_record_id = $1 ORDER BY memory_provenance_pk', [id]);
      return r.rows;
    }
  };
}

function tombstoneRepository(exec) {
  return {
    async insert(t) {
      const r = await exec.query(
        `INSERT INTO pi_memory_tombstones
           (memory_tombstone_id, memory_record_id, user_id, organisation_id,
            deletion_reason, requested_by_ref, import_batch_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING memory_tombstone_id`,
        [t.memoryTombstoneId, t.memoryRecordId, t.userId, t.organisationId,
         t.deletionReason, t.requestedByRef || null, t.importBatchRef || null]);
      return r.rows[0];
    }
  };
}

function preferenceAuditRepository(exec) {
  return {
    async insert(a) {
      const r = await exec.query(
        `INSERT INTO pi_preference_audit
           (preference_audit_id, preference_id, actor_ref, actor_type, change_type,
            previous_status, new_status, reason_summary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING preference_audit_id`,
        [a.preferenceAuditId, a.preferenceId, a.actorRef, a.actorType, a.changeType,
         a.previousStatus || null, a.newStatus, a.reasonSummary || null]);
      return r.rows[0];
    },
    async listForPreference(id) {
      const r = await exec.query(
        'SELECT * FROM pi_preference_audit WHERE preference_id = $1 ORDER BY preference_audit_pk', [id]);
      return r.rows;
    }
  };
}

function guardDecisionRepository(exec) {
  return {
    async insert(g) {
      const r = await exec.query(
        `INSERT INTO pi_guard_decisions
           (guard_decision_id, user_id, organisation_id, domain_id, capability_id,
            automation_level_requested, data_classification, decision)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING guard_decision_id, decision`,
        [g.guardDecisionId, g.userId, g.organisationId, g.domainId || null,
         g.capabilityId || null, g.automationLevelRequested, g.dataClassification || null,
         g.decision]);
      return r.rows[0];
    }
  };
}

// ---------------------------------------------------------------------------
// Conflicts — mutable (resolution_state changes), pair order normalised.
// ---------------------------------------------------------------------------
function conflictRepository(exec) {
  return {
    async create(c) {
      const pair = canonicalPair(c.memoryRecordIdA, c.memoryRecordIdB);
      const r = await exec.query(
        `INSERT INTO pi_memory_conflicts
           (memory_conflict_id, user_id, organisation_id, domain_id,
            memory_record_id_a, memory_record_id_b, conflict_reason, resolution_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'open'))
         RETURNING memory_conflict_id, memory_record_id_a, memory_record_id_b`,
        [c.memoryConflictId, c.userId, c.organisationId, c.domainId || null,
         pair.a, pair.b, c.conflictReason, c.resolutionState || null]);
      return r.rows[0];
    },
    async resolve(id, resolution) {
      const r = await exec.query(
        `UPDATE pi_memory_conflicts
            SET resolution_state = $2, resolved_by_ref = $3, resolution_summary = $4,
                resolved_at = NOW(), updated_at = NOW()
          WHERE memory_conflict_id = $1
        RETURNING memory_conflict_id, resolution_state`,
        [id, resolution.resolutionState, resolution.resolvedByRef || null,
         resolution.resolutionSummary || null]);
      return r.rows[0] || null;
    }
  };
}

// ---------------------------------------------------------------------------
// Preferences — MUTABLE by policy. MYTHOS_USER_MEMORY_POLICY.md: "No learned
// personal preference record is ever immutable." Its audit trail is separate.
// ---------------------------------------------------------------------------
function preferenceRepository(exec) {
  return {
    async create(p) {
      // F13: first/last_observed_at are written explicitly. Relying on their
      // DEFAULT NOW() loses the domain's own observation time, and nothing
      // afterwards would ever move them.
      const r = await exec.query(
        `INSERT INTO pi_learned_preferences
           (preference_id, user_id, organisation_id, domain_id, scope, status,
            preference_key, preference_value_summary, source, evidence_count, confidence,
            supersedes_preference_id, first_observed_at, last_observed_at)
         VALUES ($1,$2,$3,$4,COALESCE($5,'user'),COALESCE($6,'CANDIDATE_PREFERENCE'),
                 $7,$8,$9,COALESCE($10,1),COALESCE($11,'LOW'),$12,
                 COALESCE($13,NOW()),COALESCE($14,NOW()))
         RETURNING preference_id, status, evidence_count, confidence`,
        [p.preferenceId, p.userId, p.organisationId, p.domainId || null, p.scope || null,
         p.status || null, p.preferenceKey, p.preferenceValueSummary, p.source,
         p.evidenceCount === undefined ? null : p.evidenceCount, p.confidence || null,
         p.supersedesPreferenceId || null, p.firstObservedAt || null, p.lastObservedAt || null]);
      return r.rows[0];
    },

    // F13 — the full reinforcement write.
    // MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md §4 rule 5: "Reinforcement ...
    // increments evidence_count and moves last_observed_at on the existing row."
    // The domain (learning-engine.observe) has already computed every value —
    // including the promotion thresholds — so this persists that decision rather
    // than re-deriving it. Duplicating the threshold logic here would give the
    // system two places to disagree about when a preference is established.
    async reinforce(p) {
      const r = await exec.query(
        `UPDATE pi_learned_preferences
            SET status           = COALESCE($2, status),
                confidence       = COALESCE($3, confidence),
                evidence_count   = COALESCE($4, evidence_count),
                last_observed_at = COALESCE($5, NOW()),
                updated_at       = NOW()
          WHERE preference_id = $1
        RETURNING preference_id, status, confidence, evidence_count, last_observed_at`,
        [p.preferenceId, p.status || null, p.confidence || null,
         p.evidenceCount === undefined ? null : p.evidenceCount,
         p.lastObservedAt || null]);
      return r.rows[0] || null;
    },

    // Explicit status transition only (e.g. a governance-driven supersession).
    // Not a reinforcement path — use reinforce() for observation-driven change.
    async updateStatus(id, status) {
      const r = await exec.query(
        `UPDATE pi_learned_preferences SET status = $2, updated_at = NOW()
          WHERE preference_id = $1 RETURNING preference_id, status`, [id, status]);
      return r.rows[0] || null;
    },
    async remove(id) {
      const r = await exec.query(
        'DELETE FROM pi_learned_preferences WHERE preference_id = $1 RETURNING preference_id', [id]);
      return r.rows[0] || null;
    }
  };
}

// ---------------------------------------------------------------------------
// Events — timeline, mutable (validity windows close over time).
// ---------------------------------------------------------------------------
function eventRepository(exec) {
  return {
    async create(e) {
      const r = await exec.query(
        `INSERT INTO pi_memory_events
           (memory_event_id, memory_record_id, user_id, organisation_id, domain_id,
            project_ref, event_type, event_summary, content_reference, occurred_at,
            valid_from, valid_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,NOW()),$11,$12)
         RETURNING memory_event_id`,
        [e.memoryEventId, e.memoryRecordId || null, e.userId, e.organisationId,
         e.domainId || null, e.projectRef || null, e.eventType, e.eventSummary,
         e.contentReference || null, e.occurredAt || null, e.validFrom || null,
         e.validTo || null]);
      return r.rows[0];
    }
  };
}

// Composition root: one call site binds every repository to one executor, so a
// transaction's executor is threaded through all of them consistently.
function createRepositories(exec) {
  return {
    organisations: organisationRepository(exec),
    users: userRepository(exec),
    memory: memoryRepository(exec),
    provenance: provenanceRepository(exec),
    tombstones: tombstoneRepository(exec),
    conflicts: conflictRepository(exec),
    preferences: preferenceRepository(exec),
    preferenceAudit: preferenceAuditRepository(exec),
    guardDecisions: guardDecisionRepository(exec),
    events: eventRepository(exec)
  };
}

module.exports = {
  createRepositories: createRepositories,
  canonicalPair: canonicalPair,
  assertState: assertState,
  MEMORY_STATES: MEMORY_STATES,
  APPEND_ONLY_TABLES: APPEND_ONLY_TABLES
};
