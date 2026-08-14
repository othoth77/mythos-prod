-- =============================================================================
-- Mythos Personal Intelligence — MPI-2A Remediation Delta (PROPOSAL)
-- Stage:   MPI-2-DESIGN-GATE — resolution of Stage A/B findings F1, F2, F3, F4, F7
-- Date:    2026-08-13
-- Schema:  mythos_intelligence
--
-- STATUS: PROPOSAL — NOT APPLIED. NOT DEPLOYED. NOT PRODUCTION.
-- Validated only against a throwaway PostgreSQL 15.18 scratch container.
--
-- THIS FILE DOES NOT RESTATE THE 20-TABLE DESIGN. It is a delta on the two
-- existing authoritative files, in the same way memory-engine-schema.sql is a
-- delta on control-plane-schema.sql:
--   1. projects/personal-intelligence/database/control-plane-schema.sql  (15 tables)
--   2. projects/personal-intelligence/database/memory-engine-schema.sql  (5 tables)
--   3. THIS FILE                                                         (remediation)
-- Those two files remain the source of truth for table definitions and are
-- deliberately unmodified. Rationale for every choice below is recorded in
-- docs/MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md §13.
--
-- Apply order is strict: 1 -> 2 -> 3.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- F1 — SCHEMA BOUNDARY.  Decision: mythos_intelligence (option B).
--
-- Evidence, not preference:
--   - docs/MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md §2.1 fixes the schema name.
--   - §2.2 defines the MPI backup unit as `pg_dump --schema=mythos_intelligence`,
--     which is unimplementable if the tables live in public.
--   - §2.2 defines per-schema, independently versioned migrations.
--   - config/personal-intelligence.example.json sets logical_schema.
--
-- The two existing files do NOT schema-qualify their CREATE TABLE statements.
-- They are deliberately left that way: qualifying 20 tables inline would edit
-- the ratified files and hard-code placement into them. The migration sets
-- search_path instead, which keeps the files portable and makes placement a
-- property of the migration, not of the schema definition.
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS mythos_intelligence;

-- The migration runner MUST issue this before applying files 1 and 2:
--     SET search_path TO mythos_intelligence;
-- and MUST verify afterwards that 0 pi_* tables exist in public.


-- -----------------------------------------------------------------------------
-- F7 — APPEND-ONLY ENFORCEMENT.  Defined BEFORE the FK section because the
-- audit tables' immutability is what determines that they get no FK.
--
-- Roles are NOLOGIN and carry no password: they are privilege boundaries, not
-- credentials. Login roles and any credential remain out of scope here.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mythos_intelligence_owner') THEN
    CREATE ROLE mythos_intelligence_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mythos_intelligence_app') THEN
    CREATE ROLE mythos_intelligence_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mythos_intelligence_maint') THEN
    CREATE ROLE mythos_intelligence_maint NOLOGIN;
  END IF;
END $$;

-- Layer 1 — privilege. The application role can never UPDATE or DELETE an
-- audit row. This alone is insufficient: a table owner bypasses it silently,
-- which is exactly how F7 went unnoticed.
-- Layer 2 — trigger. Applies to EVERY role including the owner, so immutability
-- does not depend on nobody ever connecting as the owner.
CREATE OR REPLACE FUNCTION mythos_intelligence.pi_forbid_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The single legitimate maintenance path: an explicit session GUC AND
  -- membership of the maintenance role. Either alone is not enough.
  IF current_setting('mythos_intelligence.maintenance', true) = 'on'
     AND pg_has_role(current_user, 'mythos_intelligence_maint', 'MEMBER') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION
    'append-only violation: % on %.% is forbidden by MPI audit-integrity policy',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

-- Row triggers never fire for TRUNCATE, so TRUNCATE needs its own statement
-- trigger. Without this, `TRUNCATE pi_guard_decisions` would empty the audit
-- trail while every row trigger stayed silent.
CREATE OR REPLACE FUNCTION mythos_intelligence.pi_forbid_truncate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mythos_intelligence.maintenance', true) = 'on'
     AND pg_has_role(current_user, 'mythos_intelligence_maint', 'MEMBER') THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION
    'append-only violation: TRUNCATE on %.% is forbidden by MPI audit-integrity policy',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

-- The immutable set. Each entry is justified by an explicit written statement,
-- not inferred:
--   pi_preference_audit    control-plane-schema.sql header + "never updated or deleted after insert"
--   pi_guard_decisions     control-plane-schema.sql header + "never updated or deleted after insert"
--   pi_memory_tombstones   memory-engine-schema.sql "never updated or deleted after insert"
--   pi_memory_provenance   MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md §5 "Provenance is immutable"
--
-- DELIBERATELY EXCLUDED — pi_learned_preferences. docs/MYTHOS_USER_MEMORY_POLICY.md
-- states "No learned personal preference record is ever immutable." Locking it
-- would break correction and erasure, which the policy requires. Its audit trail
-- is pi_preference_audit; the subject stays mutable, the audit does not.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pi_preference_audit','pi_guard_decisions',
                           'pi_memory_tombstones','pi_memory_provenance']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_append_only ON mythos_intelligence.%I', t, t);
    EXECUTE format($f$CREATE TRIGGER trg_%s_append_only
                      BEFORE UPDATE OR DELETE ON mythos_intelligence.%I
                      FOR EACH ROW EXECUTE FUNCTION mythos_intelligence.pi_forbid_mutation()$f$, t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_no_truncate ON mythos_intelligence.%I', t, t);
    EXECUTE format($f$CREATE TRIGGER trg_%s_no_truncate
                      BEFORE TRUNCATE ON mythos_intelligence.%I
                      FOR EACH STATEMENT EXECUTE FUNCTION mythos_intelligence.pi_forbid_truncate()$f$, t, t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON mythos_intelligence.%I FROM mythos_intelligence_app', t);
    EXECUTE format('GRANT SELECT, INSERT ON mythos_intelligence.%I TO mythos_intelligence_app', t);
    -- The maintenance role needs the privilege to reach the trigger at all;
    -- the trigger, not the grant, is what actually gates it.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON mythos_intelligence.%I TO mythos_intelligence_maint', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA mythos_intelligence TO mythos_intelligence_app, mythos_intelligence_maint;


-- -----------------------------------------------------------------------------
-- F3 — ADDITIVE COLUMNS.  memory-engine-schema.sql §21 stated these as comments
-- with no executable ALTER. They are required by the §6.1 state model and the
-- §10 retrieval contract (includeStates defaults to ['active']).
-- All are MPI-2A: the retrieval adapter (MPI-2E) cannot be built without them.
-- -----------------------------------------------------------------------------
ALTER TABLE mythos_intelligence.pi_memory_records
  ADD COLUMN IF NOT EXISTS state                VARCHAR(16)  NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS supersedes_memory_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS superseded_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS observed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS valid_from           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS valid_to             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_count       INTEGER      NOT NULL DEFAULT 1;

-- §6.1 names exactly four states. possible_match is excluded by design: it is an
-- entity-resolution outcome, not a memory state.
ALTER TABLE mythos_intelligence.pi_memory_records
  ADD CONSTRAINT chk_pi_memory_state
  CHECK (state IN ('active','superseded','disputed','tombstoned'));

-- Mirrors chk_pi_event_window so a validity window means the same thing on both
-- tables that carry one.
ALTER TABLE mythos_intelligence.pi_memory_records
  ADD CONSTRAINT chk_pi_memory_window
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from);

-- Reinforcement counts independent observations only (§6.2); a count below 1 is
-- meaningless.
ALTER TABLE mythos_intelligence.pi_memory_records
  ADD CONSTRAINT chk_pi_memory_evidence_positive CHECK (evidence_count >= 1);

-- Retrieval default is includeStates=['active'], so the hot path is a partial
-- index on active rows ordered the way §10 specifies.
CREATE INDEX IF NOT EXISTS idx_pi_memory_active
  ON mythos_intelligence.pi_memory_records (user_id, organisation_id, observed_at DESC)
  WHERE state = 'active';
CREATE INDEX IF NOT EXISTS idx_pi_memory_state       ON mythos_intelligence.pi_memory_records (state);
CREATE INDEX IF NOT EXISTS idx_pi_memory_supersedes  ON mythos_intelligence.pi_memory_records (supersedes_memory_id);


-- -----------------------------------------------------------------------------
-- F4 — CANONICAL CONFLICT PAIRS.
-- Chosen: canonical ordering enforced at storage (CHECK a < b).
-- Rejected: LEAST/GREATEST expression index — it dedupes but leaves the stored
-- order arbitrary, and every later query would have to re-derive the canonical
-- form. §10 makes determinism a binding property, so one canonical stored form
-- is preferable to two equivalent ones.
-- With a < b enforced, the EXISTING idx_pi_conflict_pair becomes sufficient and
-- is not modified.
-- -----------------------------------------------------------------------------
ALTER TABLE mythos_intelligence.pi_memory_conflicts
  ADD CONSTRAINT chk_pi_conflict_canonical_order
  CHECK (memory_record_id_a < memory_record_id_b);


-- -----------------------------------------------------------------------------
-- F2 — FOREIGN KEYS.
-- The "no foreign key" rule in MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md §2.1/§2.3 is
-- scoped to CROSS-SCHEMA links ("no foreign key ... crosses into idauto";
-- "cross-schema links stay opaque reference columns"). Nothing in the
-- architecture forbids an FK between two mythos_intelligence tables, and §2.2's
-- per-schema migration and schema-scoped dump/restore boundary makes intra-schema
-- FKs safe to restore as one unit.
--
-- Every referenced column below is already UNIQUE in the ratified files, so no
-- new uniqueness is introduced to make these possible.
--
-- INTENTIONALLY ABSENT — and these are the load-bearing decisions:
--   * Every *_ref / *_ref_source / entity_external_id / connector_id / project_ref /
--     content_reference / source_reference column. These are cross-schema or
--     external by construction (§2.3).
--   * pi_preference_audit.preference_id -> pi_learned_preferences. An audit row
--     must OUTLIVE its subject. ON DELETE CASCADE would let erasing a preference
--     erase its own audit trail; RESTRICT would block the erasure the memory
--     policy requires. Both are wrong, so there is no FK by design.
--   * pi_guard_decisions.user_id / organisation_id. Same reasoning: a permission
--     decision must remain provable after the user record is erased.
--   * pi_memory_tombstones.memory_record_id. A tombstone is evidence of deletion
--     and must survive an eventual hard purge of the record it describes.
--   * pi_memory_provenance.memory_record_id. Immutable under F7; an FK with any
--     delete action would either break immutability or block maintenance.
-- In short: nothing in the immutable set takes a foreign key, because a
-- referential action is a write, and these tables do not accept writes.
-- -----------------------------------------------------------------------------

-- Control-plane spine
ALTER TABLE mythos_intelligence.pi_domain_capabilities
  ADD CONSTRAINT fk_pi_capability_domain FOREIGN KEY (domain_id)
  REFERENCES mythos_intelligence.pi_domains (domain_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE mythos_intelligence.pi_organisations
  ADD CONSTRAINT fk_pi_org_domain FOREIGN KEY (domain_id)
  REFERENCES mythos_intelligence.pi_domains (domain_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE mythos_intelligence.pi_users
  ADD CONSTRAINT fk_pi_user_org FOREIGN KEY (organisation_id)
  REFERENCES mythos_intelligence.pi_organisations (organisation_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE mythos_intelligence.pi_user_domain_access
  ADD CONSTRAINT fk_pi_uda_user FOREIGN KEY (user_id)
  REFERENCES mythos_intelligence.pi_users (user_id) ON UPDATE CASCADE ON DELETE CASCADE,
  ADD CONSTRAINT fk_pi_uda_domain FOREIGN KEY (domain_id)
  REFERENCES mythos_intelligence.pi_domains (domain_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pi_uda_org FOREIGN KEY (organisation_id)
  REFERENCES mythos_intelligence.pi_organisations (organisation_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE mythos_intelligence.pi_sessions
  ADD CONSTRAINT fk_pi_session_user FOREIGN KEY (user_id)
  REFERENCES mythos_intelligence.pi_users (user_id) ON UPDATE CASCADE ON DELETE CASCADE,
  ADD CONSTRAINT fk_pi_session_org FOREIGN KEY (organisation_id)
  REFERENCES mythos_intelligence.pi_organisations (organisation_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pi_session_domain FOREIGN KEY (active_domain_id)
  REFERENCES mythos_intelligence.pi_domains (domain_id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Memory core
ALTER TABLE mythos_intelligence.pi_memory_records
  ADD CONSTRAINT fk_pi_memory_user FOREIGN KEY (user_id)
  REFERENCES mythos_intelligence.pi_users (user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pi_memory_org FOREIGN KEY (organisation_id)
  REFERENCES mythos_intelligence.pi_organisations (organisation_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pi_memory_domain FOREIGN KEY (domain_id)
  REFERENCES mythos_intelligence.pi_domains (domain_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT fk_pi_memory_session FOREIGN KEY (session_id)
  REFERENCES mythos_intelligence.pi_sessions (session_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT fk_pi_memory_supersedes FOREIGN KEY (supersedes_memory_id)
  REFERENCES mythos_intelligence.pi_memory_records (memory_record_id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE mythos_intelligence.pi_learned_preferences
  ADD CONSTRAINT fk_pi_pref_user FOREIGN KEY (user_id)
  REFERENCES mythos_intelligence.pi_users (user_id) ON UPDATE CASCADE ON DELETE CASCADE,
  ADD CONSTRAINT fk_pi_pref_org FOREIGN KEY (organisation_id)
  REFERENCES mythos_intelligence.pi_organisations (organisation_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT fk_pi_pref_domain FOREIGN KEY (domain_id)
  REFERENCES mythos_intelligence.pi_domains (domain_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT fk_pi_pref_supersedes FOREIGN KEY (supersedes_preference_id)
  REFERENCES mythos_intelligence.pi_learned_preferences (preference_id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Conflicts, tags, events
ALTER TABLE mythos_intelligence.pi_memory_conflicts
  ADD CONSTRAINT fk_pi_conflict_a FOREIGN KEY (memory_record_id_a)
  REFERENCES mythos_intelligence.pi_memory_records (memory_record_id) ON UPDATE CASCADE ON DELETE CASCADE,
  ADD CONSTRAINT fk_pi_conflict_b FOREIGN KEY (memory_record_id_b)
  REFERENCES mythos_intelligence.pi_memory_records (memory_record_id) ON UPDATE CASCADE ON DELETE CASCADE,
  ADD CONSTRAINT fk_pi_conflict_user FOREIGN KEY (user_id)
  REFERENCES mythos_intelligence.pi_users (user_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE mythos_intelligence.pi_memory_tags
  ADD CONSTRAINT fk_pi_tag_memory FOREIGN KEY (memory_record_id)
  REFERENCES mythos_intelligence.pi_memory_records (memory_record_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE mythos_intelligence.pi_memory_events
  ADD CONSTRAINT fk_pi_event_memory FOREIGN KEY (memory_record_id)
  REFERENCES mythos_intelligence.pi_memory_records (memory_record_id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT fk_pi_event_user FOREIGN KEY (user_id)
  REFERENCES mythos_intelligence.pi_users (user_id) ON UPDATE CASCADE ON DELETE CASCADE,
  ADD CONSTRAINT fk_pi_event_org FOREIGN KEY (organisation_id)
  REFERENCES mythos_intelligence.pi_organisations (organisation_id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- Remaining organisation-scoped tables
ALTER TABLE mythos_intelligence.pi_entity_references
  ADD CONSTRAINT fk_pi_entity_org FOREIGN KEY (organisation_id)
  REFERENCES mythos_intelligence.pi_organisations (organisation_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE mythos_intelligence.pi_knowledge_sources
  ADD CONSTRAINT fk_pi_knowledge_org FOREIGN KEY (organisation_id)
  REFERENCES mythos_intelligence.pi_organisations (organisation_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE mythos_intelligence.pi_capability_runtime_status
  ADD CONSTRAINT fk_pi_crs_capability FOREIGN KEY (capability_id)
  REFERENCES mythos_intelligence.pi_domain_capabilities (capability_id) ON UPDATE CASCADE ON DELETE CASCADE,
  ADD CONSTRAINT fk_pi_crs_org FOREIGN KEY (organisation_id)
  REFERENCES mythos_intelligence.pi_organisations (organisation_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE mythos_intelligence.pi_context_packages
  ADD CONSTRAINT fk_pi_ctx_session FOREIGN KEY (session_id)
  REFERENCES mythos_intelligence.pi_sessions (session_id) ON UPDATE CASCADE ON DELETE CASCADE,
  ADD CONSTRAINT fk_pi_ctx_user FOREIGN KEY (user_id)
  REFERENCES mythos_intelligence.pi_users (user_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE mythos_intelligence.pi_feedback_events
  ADD CONSTRAINT fk_pi_feedback_user FOREIGN KEY (user_id)
  REFERENCES mythos_intelligence.pi_users (user_id) ON UPDATE CASCADE ON DELETE CASCADE,
  ADD CONSTRAINT fk_pi_feedback_session FOREIGN KEY (session_id)
  REFERENCES mythos_intelligence.pi_sessions (session_id) ON UPDATE CASCADE ON DELETE SET NULL;


-- -----------------------------------------------------------------------------
-- F6 (minor, carried) — enumerated vocabularies.
-- Constrained here only where the value is a security or lifecycle decision.
-- The remaining free-text vocabularies are left open deliberately: constraining
-- every one of them would make adding a memory_type a migration.
-- -----------------------------------------------------------------------------
ALTER TABLE mythos_intelligence.pi_guard_decisions
  ADD CONSTRAINT chk_pi_guard_decision
  CHECK (decision IN ('ALLOW','DENY','REQUIRE_APPROVAL','READ_ONLY','DRY_RUN_ONLY'));

ALTER TABLE mythos_intelligence.pi_learned_preferences
  ADD CONSTRAINT chk_pi_pref_status
  CHECK (status IN ('SESSION_OBSERVATION','CANDIDATE_PREFERENCE','ESTABLISHED_PREFERENCE',
                    'EXPLICIT_USER_RULE','SUPERSEDED','DISCARDED'));

-- -----------------------------------------------------------------------------
-- F8 — CONCURRENT REINFORCEMENT INTEGRITY (ratified 2026-08-14).
-- Structural backstop for the §6.2 independence rule: an exact repeat of the
-- same observation (same memory, same source, same observed_at — including
-- NULL observed_at, hence NULLS NOT DISTINCT, PostgreSQL 15+) cannot create a
-- second provenance row, so a concurrent duplicate loses at commit and its
-- evidence_count increment rolls back with it. A same-source observation at a
-- MATERIALLY LATER observed_at remains insertable — that distinction is the
-- ratified boundary, proven in docs/MPI_FINDINGS_REMEDIATION.md and
-- docs/MPI_CRITICAL_FINDINGS.md. The lock ordering half of F8 lives in
-- repositories.js memory.reinforce() (SELECT ... FOR UPDATE before the
-- provenance read); this index is the half the application cannot forget.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX idx_pi_provenance_observation
  ON mythos_intelligence.pi_memory_provenance
     (memory_record_id, source_reference, observed_at) NULLS NOT DISTINCT;

-- -----------------------------------------------------------------------------
-- F9 — AUDIT SUBJECT LOOKUP (ratified 2026-08-14).
-- pi_preference_audit is append-only and only grows; its single real read path
-- (listForPreference, WHERE preference_id) was a sequential scan discarding
-- 49,990 of 50,000 rows. Measured at 500k rows: 8,883 buffers -> 28. The
-- two-column, reversed-order, covering and partial variants were rejected with
-- evidence — see docs/MPI_CRITICAL_FINDINGS.md § F9.
-- -----------------------------------------------------------------------------
CREATE INDEX idx_pi_preference_audit_subject
  ON mythos_intelligence.pi_preference_audit (preference_id);

-- =============================================================================
-- END OF PROPOSAL. Nothing here has been applied to any production database.
-- MPI-2A remains blocked on owner decisions D1, D2 and D3.
-- =============================================================================
